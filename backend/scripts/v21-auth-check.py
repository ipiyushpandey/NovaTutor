#!/usr/bin/env python3
"""End-to-end checks for NovaTutor V2.1 against a running backend.

Covers real email verification through an SMTP sink, password reset, duplicate
prevention, admin authentication, AI latency and provider reliability.

    MAIL_DIR=/tmp/nova-mail BASE_URL=http://127.0.0.1:8080 \
    ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 backend/scripts/v21-auth-check.py
"""
import email
import glob
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")
MAIL_DIR = os.environ.get("MAIL_DIR", "/tmp/nova-mail")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
PASSWORD = "SecurePass123!"
NEW_PASSWORD = "ChangedPass456!"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""), flush=True)
    return ok


def call(method, path, body=None, token=None, timeout=120):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        status = error.code
    elapsed = (time.time() - started) * 1000
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = {"raw": raw}
    return status, parsed, elapsed


def wait_for_email(recipient, timeout=20):
    """Returns (subject, html_text) of the newest message for the recipient."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        for path in sorted(glob.glob(os.path.join(MAIL_DIR, "*.eml")), reverse=True):
            with open(path, "rb") as handle:
                message = email.message_from_binary_file(handle)
            to_header = " ".join(
                str(value) for value in message.get_all("X-Test-To", []) + message.get_all("To", [])
            ).lower()
            if recipient.lower() not in to_header:
                continue
            subject = str(message.get("Subject", ""))
            body = ""
            if message.is_multipart():
                for part in message.walk():
                    if part.get_content_type() == "text/html":
                        payload = part.get_payload(decode=True) or b""
                        body += payload.decode("utf-8", "replace")
            else:
                payload = message.get_payload(decode=True) or b""
                body = payload.decode("utf-8", "replace")
            return subject, body
        time.sleep(0.5)
    return None, None


def link_token(body, route):
    match = re.search(r"https?://[^\s\"'<>]+/#/" + re.escape(route) + r"\?token=([A-Za-z0-9_\-]+)", body)
    return match.group(1) if match else None


def main():
    for _ in range(60):
        for probe in ("/actuator/health", "/api/health"):
            try:
                status, _, _ = call("GET", probe, timeout=3)
                if status == 200:
                    break
            except Exception:
                status = 0
        if status == 200:
            break
        time.sleep(2)
    else:
        print("Backend did not become ready", file=sys.stderr)
        return 1

    status, health, _ = call("GET", "/api/health")
    check("health endpoint is UP", status == 200 and health.get("status") == "UP", str(status))

    stamp = int(time.time() * 1000)
    student_email = f"v21check{stamp}@novatutor.test"
    admin_email = ADMIN_EMAIL or f"v21admin{stamp}@novatutor.test"
    admin_password = ADMIN_PASSWORD or "AdminPass123!"

    # ---- email verification flow -------------------------------------
    status, pending, _ = call("POST", "/api/auth/register", {
        "name": "V21 Check", "email": student_email, "password": PASSWORD})
    check("registration is accepted as pending", status == 202 and pending.get("pending") is True, str(status))
    check("registration reports real delivery status", "verificationSent" in pending,
          f"sent={pending.get('verificationSent')} smtp={pending.get('emailDeliveryConfigured')}")

    status, login, _ = call("POST", "/api/auth/login", {"email": student_email, "password": PASSWORD})
    check("unverified account cannot sign in", status == 403 and login.get("error") == "EMAIL_UNVERIFIED",
          f"{status} {login.get('error')}")

    status, duplicate, _ = call("POST", "/api/auth/register", {
        "name": "V21 Check", "email": student_email, "password": PASSWORD})
    check("unverified duplicate does not create a second account", status == 202,
          f"{status} {duplicate.get('message', '')[:40]}")

    subject, body = wait_for_email(student_email)
    check("verification email was actually delivered to SMTP", subject is not None, subject or "no email")
    token = link_token(body or "", "verify-email")
    check("verification email contains a single-use link", bool(token))
    if not token:
        return finish()

    status, verified, _ = call("POST", "/api/auth/verify-email", {"token": token})
    check("verification token is accepted", status == 200 and verified.get("verified") is True, str(status))

    status, replay, _ = call("POST", "/api/auth/verify-email", {"token": token})
    check("verification token cannot be reused", status == 400 and replay.get("error") == "VERIFICATION_INVALID",
          f"{status} {replay.get('error')}")

    status, login, _ = call("POST", "/api/auth/login", {"email": student_email, "password": PASSWORD})
    student_token = login.get("token")
    check("verified account can sign in", status == 200 and bool(student_token), str(status))
    check("login response confirms verified email", login.get("emailVerified") is True)

    status, me, _ = call("GET", "/api/auth/me", token=student_token)
    check("session restores through /auth/me", status == 200 and me.get("email") == student_email, str(status))

    status, duplicate, _ = call("POST", "/api/auth/register", {
        "name": "Duplicate", "email": student_email, "password": PASSWORD})
    check("verified duplicate registration is rejected", status == 409 and duplicate.get("error") == "EMAIL_TAKEN",
          f"{status} {duplicate.get('error')}")

    # ---- password reset ---------------------------------------------
    status, forgot, _ = call("POST", "/api/auth/forgot-password", {"email": student_email})
    check("forgot-password returns a generic acceptance", status == 202, str(status))
    _, reset_body = wait_for_email(student_email)
    reset_token = link_token(reset_body or "", "reset-password")
    check("password reset email contains a token", bool(reset_token))
    if reset_token:
        status, reset, _ = call("POST", "/api/auth/reset-password",
                                {"token": reset_token, "password": NEW_PASSWORD})
        check("password reset succeeds", status == 200 and reset.get("reset") is True, str(status))
        status, _, _ = call("POST", "/api/auth/login", {"email": student_email, "password": NEW_PASSWORD})
        check("new password signs in", status == 200, str(status))
        status, replay, _ = call("POST", "/api/auth/reset-password",
                                 {"token": reset_token, "password": PASSWORD})
        check("reset token cannot be reused", status == 400 and replay.get("error") == "INVALID_RESET_TOKEN",
              f"{status} {replay.get('error')}")

    # ---- admin -------------------------------------------------------
    status, admin_login, _ = call("POST", "/api/auth/login",
                                  {"email": admin_email, "password": admin_password})
    if status != 200:
        # First run against a fresh database: provision and verify the owner.
        call("POST", "/api/auth/register",
             {"name": "Nova Owner", "email": admin_email, "password": admin_password})
        _, admin_body = wait_for_email(admin_email)
        admin_verify = link_token(admin_body or "", "verify-email")
        if admin_verify:
            call("POST", "/api/auth/verify-email", {"token": admin_verify})
        status, admin_login, _ = call("POST", "/api/auth/login",
                                      {"email": admin_email, "password": admin_password})
    admin_token = admin_login.get("token")
    check("admin can sign in", status == 200 and admin_login.get("role") == "ADMIN",
          f"{status} role={admin_login.get('role')}")
    if admin_token:
        status, users, _ = call("GET", "/api/admin/users", token=admin_token)
        check("admin endpoint authorises ADMIN role", status == 200 and isinstance(users, list), str(status))
        status, denied, _ = call("GET", "/api/admin/users", token=student_token)
        check("student is forbidden from admin endpoints", status == 403, str(status))
        status, usage, _ = call("GET", "/api/admin/ai/usage", token=admin_token)
        check("admin AI metrics endpoint responds", status == 200 and "tasks" in usage, str(status))
        status, sandbox, _ = call("GET", "/api/admin/sandbox/usage", token=admin_token)
        check("admin sandbox metrics endpoint responds", status == 200 and "submissions" in sandbox, str(status))

    # ---- AI latency and reliability ---------------------------------
    samples = []
    failures = 0
    for i in range(3):
        status, answer, elapsed = call("POST", "/api/ai/ask", {
            "task": "QA", "topic": "Binary search trees", "level": "B.Tech",
            "language": "English",
            "message": f"In two short sentences, state one property of a binary search tree. Attempt {i + 1}."},
            token=student_token)
        text = answer.get("answer", "") if isinstance(answer, dict) else ""
        lowered = text[:120].lower()
        ok = (status == 200 and len(text) > 20
              and "temporarily" not in lowered
              and "could not complete" not in lowered
              and "http 401" not in lowered)
        if not ok:
            failures += 1
        samples.append(elapsed)
        print(f"      ai/ask attempt {i + 1}: {status} {elapsed:.0f} ms {len(text)} chars :: {text[:90]!r}", flush=True)
    if samples:
        median = statistics.median(samples)
        p95 = sorted(samples)[max(0, int(round(0.95 * len(samples))) - 1)]
        check("AI short answers return content", failures == 0, f"{failures}/3 failures")
        check("AI median latency is within the 4-5 s target", median <= 5000, f"median={median:.0f} ms p95={p95:.0f} ms")
        print(f"      AI latency samples: {[round(s) for s in samples]} ms", flush=True)

    status, stream_meta = stream_check(student_token)
    check("AI streaming emits incremental chunks", stream_meta.get("incremental"),
          f"chunks={stream_meta.get('chunks')} chars={stream_meta.get('chars')} ttfb={stream_meta.get('ttfbMs')} ms total={stream_meta.get('totalMs')} ms")

    # ---- DSA judge sanity -------------------------------------------
    if student_token:
        status, problems, _ = call("GET", "/api/dsa/problems", token=student_token)
        check("DSA problem catalogue is available", status == 200, str(status))

    return finish()


def stream_check(token):
    payload = json.dumps({
        "task": "QA", "topic": "Stacks", "level": "B.Tech", "language": "English",
        "message": "Explain why a stack is LIFO in about 250 words, with a short example and three bullet points."}).encode()
    request = urllib.request.Request(BASE + "/api/ai/ask/stream", data=payload, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "text/event-stream")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    started = time.time()
    ttfb = None
    chunks = 0
    characters = 0
    stream_error = False
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            for raw_line in response:
                line = raw_line.decode("utf-8", "replace").strip()
                if line.startswith("event:error"):
                    stream_error = True
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:]
                if not data or data == "done":
                    continue
                if ttfb is None:
                    ttfb = (time.time() - started) * 1000
                chunks += 1
                characters += len(data)
    except Exception as error:
        print(f"      streaming error: {error}", flush=True)
    total = (time.time() - started) * 1000
    # Providers may coalesce a fast short answer into one HTTP event. Incremental
    # delivery is proven when several events arrive, or when the first event
    # reaches the client clearly before the stream completes with a real body.
    incremental = (not stream_error) and chunks >= 2 and characters > 200
    if stream_error:
        print("      streaming returned an error event", flush=True)
    return 200, {"chunks": chunks, "chars": characters, "ttfbMs": round(ttfb or 0),
                 "totalMs": round(total), "incremental": incremental}


def finish():
    failed = [name for name, ok, _ in results if not ok]
    print("\n" + "=" * 70)
    print(f"{len(results) - len(failed)}/{len(results)} checks passed")
    if failed:
        print("FAILED:")
        for name in failed:
            print("  - " + name)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
