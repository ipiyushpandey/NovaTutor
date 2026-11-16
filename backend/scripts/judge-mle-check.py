#!/usr/bin/env python3
"""Dedicated memory-limit verification for NovaTutor's judge.

Two independent probes:

1. Provider probe — submits a controlled Python allocation directly to the
   configured Judge0-compatible provider with a real ``memory_limit``. This
   establishes whether the provider itself enforces memory, independently of
   NovaTutor's mapping.
2. NovaTutor probe — submits a Python DSA solution that allocates ~400 MB to a
   running NovaTutor backend and asserts the user-facing verdict is
   ``MEMORY_LIMIT``.

Judge0 has no dedicated MLE status. Its sandbox kills an over-limit process
with SIGKILL, reported as a runtime-error status (typically NZEC id 11) with
``memory`` pinned to the configured limit and a 137/Killed notice. The probe
checks those provider fields instead of assuming every kill is an MLE.

Usage:
    python3 backend/scripts/judge-mle-check.py
    BASE_URL=https://novatutor-api.onrender.com RUNNER_URL=https://ce.judge0.com \
        ADMIN_EMAIL=... ADMIN_PASSWORD=... python3 backend/scripts/judge-mle-check.py

The allocation is 400 MB inside the provider sandbox; nothing runs on this
machine. No credentials are printed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")
RUNNER = os.environ.get("RUNNER_URL", "https://ce.judge0.com").rstrip("/")
SLUG = os.environ.get("JUDGE_SLUG", "build-array-from-permutation")
MEMORY_KB = int(os.environ.get("JUDGE_MEMORY_KB", "262144"))
ALLOC_MB = int(os.environ.get("JUDGE_ALLOC_MB", "400"))

PROVIDER_PROGRAM = f"""import sys
try:
    ballast = bytearray({ALLOC_MB} * 1024 * 1024)
    for i in range(0, len(ballast), 4096):
        ballast[i] = 1
    print('ALLOCATED', len(ballast))
except MemoryError:
    print('MEMORYERROR')
    sys.exit(137)
"""

# The DSA harness calls solve() once per test line. The first call exceeds the
# judge's memory cap, so the provider kills the process before any result line.
NOVA_MLE_SOLUTION = f"""def solve(nums):
    ballast = bytearray({ALLOC_MB} * 1024 * 1024)
    for i in range(0, len(ballast), 4096):
        ballast[i] = 1
    return nums
"""


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


def http(method, url, body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json", "Accept": "application/json",
         "User-Agent": "NovaTutor-Judge/2.2"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def nova_request(method, path, body=None, token=None, timeout=300):
    headers = {"Authorization": "Bearer " + token} if token else {}
    return http(method, BASE + path, body, headers, timeout)


def auth_token():
    token = os.environ.get("TOKEN")
    if token:
        return token
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    if not email or not password:
        sys.exit("Set TOKEN, or ADMIN_EMAIL + ADMIN_PASSWORD (or deploy/secrets.env).")
    status, body = nova_request("POST", "/api/auth/login",
                                {"email": email, "password": password}, timeout=120)
    if status != 200 or not isinstance(body, dict) or "token" not in body:
        sys.exit(f"login failed (HTTP {status})")
    return body["token"]


def provider_probe():
    """Return (enforced, detail) from the provider's own response fields."""
    body = {
        "source_code": PROVIDER_PROGRAM,
        "language_id": 71,  # Python 3
        "stdin": "",
        "cpu_time_limit": 5,
        "wall_time_limit": 10,
        "memory_limit": MEMORY_KB,
    }
    status, result = http("POST", RUNNER + "/submissions?base64_encoded=false&wait=true",
                          body, timeout=120)
    if status != 200 or not isinstance(result, dict):
        return False, f"provider HTTP {status} {str(result)[:160]}"
    status_id = (result.get("status") or {}).get("id")
    memory = result.get("memory") or 0
    message = str(result.get("message") or "")
    stderr = str(result.get("stderr") or "")
    near_limit = memory * 100 >= MEMORY_KB * 98
    kill_signal = any(s in (message + " " + stderr).lower()
                      for s in ("137", "killed", "sigkill", "memory limit"))
    enforced = status_id in range(7, 13) and near_limit and kill_signal
    detail = (f"status={status_id} memory={memory}KB/{MEMORY_KB}KB "
              f"message={message[:50]!r} stderr={stderr.strip()[:50]!r}")
    return enforced, detail


def nova_probe(token):
    status, result = nova_request(
        "POST", f"/api/dsa/problems/{SLUG}/run",
        {"language": "python", "code": NOVA_MLE_SOLUTION}, token=token, timeout=180)
    if status != 200 or not isinstance(result, dict):
        return None, f"HTTP {status} {str(result)[:200]}"
    return result.get("status"), json.dumps({
        "status": result.get("status"),
        "message": result.get("message"),
        "memoryKb": result.get("memoryKb"),
        "passed": result.get("passed"),
        "total": result.get("total"),
    })[:300]


def main():
    load_secrets()
    print(f"Memory-limit verification")
    print(f"  provider: {RUNNER} (limit {MEMORY_KB // 1024} MB)")
    print(f"  backend : {BASE}\n")

    started = time.time()
    enforced, detail = provider_probe()
    print(f"{'PASS' if enforced else 'FAIL'}  provider enforcement  {detail}")

    token = auth_token()
    verdict, raw = nova_probe(token)
    mapped = verdict == "MEMORY_LIMIT"
    print(f"{'PASS' if mapped else 'FAIL'}  NovaTutor verdict     {raw}")

    print()
    if enforced:
        print("Provider memory enforcement: VERIFIED (real sandbox kill at the configured limit).")
    else:
        print("Provider memory enforcement: NOT VERIFIED — the provider did not return a "
              "recognisable kill at the configured limit. The application mapping is still "
              "tested by unit tests, but no claim is made that this provider enforces memory.")
    if mapped:
        print("NovaTutor MLE mapping: VERIFIED for this provider response.")
    else:
        print("NovaTutor MLE mapping: NOT VERIFIED for this live response.")
    print(f"Elapsed {time.time() - started:.1f}s")
    return 0 if (enforced and mapped) else 1


if __name__ == "__main__":
    sys.exit(main())
