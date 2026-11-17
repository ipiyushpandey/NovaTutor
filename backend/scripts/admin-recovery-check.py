#!/usr/bin/env python3
"""Verifies the no-email account recovery path.

Creates a disposable unverified student, then uses the ADMIN panel APIs to
verify it and reset its password. Proves:
  - unverified accounts cannot sign in;
  - a student cannot call the admin recovery endpoints;
  - manual verification lets the student sign in;
  - an admin password reset invalidates the old password;
  - the disposable account is deleted afterwards.

Usage:
    BASE_URL=http://127.0.0.1:8080 ADMIN_EMAIL=... ADMIN_PASSWORD=... \
        python3 backend/scripts/admin-recovery-check.py

No real user data is touched and no credentials are printed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")
results = []


def load_secrets():
    for path in ("deploy/secrets.env", "backend/.env.properties"):
        if not os.path.exists(path):
            continue
        try:
            for line in open(path):
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v)
        except OSError:
            pass


def call(method, path, body=None, token=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw[:300]


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  [{detail}]' if detail else ''}", flush=True)


def login(email, password):
    return call("POST", "/api/auth/login", {"email": email, "password": password})


def main():
    load_secrets()
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        sys.exit("ADMIN_EMAIL and ADMIN_PASSWORD are required.")

    status, admin = login(admin_email, admin_password)
    if status != 200 or not isinstance(admin, dict):
        sys.exit(f"admin login failed (HTTP {status})")
    admin_token = admin["token"]
    check("admin signs in", admin.get("role") == "ADMIN")

    email = f"recovery-{int(time.time())}@novatutor.test"
    old_password = "RecoveryOld123"
    new_password = "RecoveryNew456"
    status, reg = call("POST", "/api/auth/register",
                       {"name": "Recovery Check", "email": email, "password": old_password})
    check("disposable account registered pending", status == 202 and reg.get("pending") is True, str(status))
    user_id = None
    if status == 202:
        status, listing = call("GET", "/api/admin/users", token=admin_token)
        rows = listing if isinstance(listing, list) else []
        match = next((u for u in rows if u.get("email") == email), None)
        user_id = match.get("id") if match else None
        check("admin list exposes verification state",
              match is not None and match.get("emailVerified") is False,
              f"id={user_id}")
    if not user_id:
        return finish()

    status, body = login(email, old_password)
    check("unverified account cannot sign in", status == 403
          and isinstance(body, dict) and body.get("error") == "EMAIL_UNVERIFIED", str(status))

    student_token = None
    status, body = call("POST", f"/api/admin/users/{user_id}/verify-email", token=student_token)
    check("anonymous cannot verify an account", status in (401, 403), str(status))

    status, body = call("POST", f"/api/admin/users/{user_id}/verify-email", token=admin_token)
    check("admin verifies the account", status == 200 and body.get("emailVerified") is True, str(status))

    status, body = login(email, old_password)
    check("verified account signs in", status == 200 and isinstance(body, dict) and "token" in body, str(status))
    student_token = body.get("token") if isinstance(body, dict) else None

    status, body = call("POST", f"/api/admin/users/{user_id}/verify-email", token=student_token)
    check("student cannot call admin verification", status == 403, str(status))
    status, body = call("POST", f"/api/admin/users/{user_id}/reset-password",
                        {"newPassword": new_password}, token=student_token)
    check("student cannot call admin password reset", status == 403, str(status))

    status, body = call("POST", f"/api/admin/users/{user_id}/reset-password",
                        {"newPassword": new_password}, token=admin_token)
    check("admin resets the password", status == 200 and body.get("updated") is True, str(status))

    status, _ = login(email, old_password)
    check("old password no longer works", status == 401, str(status))
    status, body = login(email, new_password)
    check("temporary password signs in", status == 200 and isinstance(body, dict), str(status))

    status, body = call("DELETE", f"/api/admin/users/{user_id}", token=admin_token)
    check("disposable account cleaned up", status == 200 and body.get("deleted") is True, str(status))
    return finish()


def finish():
    failed = [name for name, ok in results if not ok]
    print()
    if failed:
        print(f"{len(failed)} check(s) failed")
        return 1
    print(f"All {len(results)} admin recovery checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
