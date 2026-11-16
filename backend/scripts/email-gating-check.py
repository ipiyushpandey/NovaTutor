#!/usr/bin/env python3
"""Regression check for the email-verification delivery contract.

Run against a backend whose SMTP state matches EXPECT_MAIL:

    EXPECT_MAIL=false BASE_URL=http://127.0.0.1:8082 python3 backend/scripts/email-gating-check.py
    EXPECT_MAIL=true  BASE_URL=https://novatutor-api.onrender.com python3 backend/scripts/email-gating-check.py

When delivery is not configured it proves that registration never pretends to
send mail, resend stays honest, and the unverified account still cannot sign in.
When delivery is configured it only checks that the provider flag is exposed;
the full mail-delivery flow is covered by v21-auth-check.py against a sink.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")
EXPECT_MAIL = os.environ.get("EXPECT_MAIL", "false").strip().lower() in ("1", "true", "yes")
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{f'  [{detail}]' if detail else ''}", flush=True)


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


def main():
    status, providers = call("GET", "/api/auth/providers")
    configured = providers.get("emailDeliveryConfigured") if isinstance(providers, dict) else None
    check("providers endpoint exposes delivery state", status == 200 and isinstance(configured, bool),
          f"configured={configured}")
    if not isinstance(configured, bool):
        return finish()
    check(f"delivery configuration matches EXPECT_MAIL={EXPECT_MAIL}", configured == EXPECT_MAIL,
          f"server={configured}")

    if not EXPECT_MAIL:
        email = f"delivery-off-{int(time.time())}@novatutor.test"
        password = "NoMailPass123456"
        status, reg = call("POST", "/api/auth/register",
                           {"name": "Delivery Check", "email": email, "password": password})
        ok = (status == 202 and isinstance(reg, dict) and reg.get("pending") is True
              and reg.get("verificationSent") is False
              and reg.get("emailDeliveryConfigured") is False)
        check("registration does not claim a sent email", ok,
              f"{status} sent={reg.get('verificationSent') if isinstance(reg, dict) else '?'}")
        message = str(reg.get("message", "")) if isinstance(reg, dict) else ""
        check("registration explains the missing email service", "cannot send email" in message.lower(),
              message[:80])

        status, resend = call("POST", "/api/auth/resend-verification", {"email": email})
        honest = (status == 202 and isinstance(resend, dict)
                  and resend.get("sent") is False
                  and resend.get("emailDeliveryConfigured") is False
                  and "once email delivery is available" in str(resend.get("message", "")).lower())
        check("resend stays honest when delivery is off", honest,
              f"{status} {str(resend)[:90]}")

        status, login = call("POST", "/api/auth/login", {"email": email, "password": password})
        check("unverified account cannot sign in", status == 403
              and isinstance(login, dict) and login.get("error") == "EMAIL_UNVERIFIED", str(status))

        status, reset = call("POST", "/api/auth/forgot-password", {"email": email})
        reset_message = str(reset.get("message", "")) if isinstance(reset, dict) else ""
        check("password reset does not claim an unavailable email", status == 202
              and "once email delivery is configured" in reset_message.lower(), reset_message[:80])

    return finish()


def finish():
    failed = [name for name, ok, _ in results if not ok]
    print()
    if failed:
        print(f"{len(failed)} check(s) failed")
        return 1
    print(f"All {len(results)} email-delivery checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
