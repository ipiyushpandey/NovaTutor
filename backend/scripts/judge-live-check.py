#!/usr/bin/env python3
"""Live DSA judge verification.

Runs real submissions (real compilers, real runtimes, real hidden tests) against
a running NovaTutor backend and asserts the verdict for each case. This is not
a mock: the code is compiled and executed by the configured execution provider.

Usage:
    BASE_URL=http://127.0.0.1:8080 python3 backend/scripts/judge-live-check.py
    TOKEN=<jwt> BASE_URL=... python3 backend/scripts/judge-live-check.py

Credentials are read from the environment or, when present, from
deploy/secrets.env (gitignored). Secrets are never printed.
"""
import json
import os
import sys
import urllib.error
import urllib.request

SLUG = os.environ.get("JUDGE_SLUG", "build-array-from-permutation")
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")

JAVA_CORRECT = """class Solution {
    public static int[] solve(int[] nums) {
        int n = nums.length;
        int[] ans = new int[n];
        for (int i = 0; i < n; i++) ans[i] = nums[nums[i]];
        return ans;
    }
}"""

JAVA_WRONG = """class Solution {
    public static int[] solve(int[] nums) {
        return nums; // deliberately wrong
    }
}"""

JAVA_COMPILE_ERROR = """class Solution {
    public static int[] solve(int[] nums) {
        return nums   // missing semicolon + wrong return type
    }
}"""

JAVA_INFINITE_LOOP = """class Solution {
    public static int[] solve(int[] nums) {
        long x = 0;
        while (true) { x++; }
    }
}"""

JAVA_RUNTIME_ERROR = """class Solution {
    public static int[] solve(int[] nums) {
        throw new IllegalStateException("boom");
    }
}"""

JAVA_SPACED_ARRAY = """class Solution {
    public static int[] solve(int[] nums) {
        int n = nums.length;
        int[] ans = new int[n];
        for (int i = 0; i < n; i++) ans[i] = nums[nums[i]];
        System.out.println("decorating output should not be needed");
        return ans;
    }
}"""

PYTHON_CORRECT = """def solve(nums):
    return [nums[x] for x in nums]
"""

CPP_CORRECT = """#include <bits/stdc++.h>
using namespace std;

vector<int> solve(vector<int>& nums) {
    vector<int> ans(nums.size());
    for (size_t i = 0; i < nums.size(); i++) ans[i] = nums[nums[i]];
    return ans;
}
"""

C_CORRECT = """void solve(const int* nums, int nums_len, Result* out) {
    for (int i = 0; i < nums_len; i++) out->arr[i] = nums[nums[i]];
    out->arr_len = nums_len;
}
"""

JS_CORRECT = """function solve(nums) {
    return nums.map(x => nums[x]);
}
"""

# (name, language, code, expected status, expectation note)
CASES = [
    ("java correct",              "java",       JAVA_CORRECT,        "PASSED",        "a correct solution must never be rejected"),
    ("java wrong answer",         "java",       JAVA_WRONG,          "FAILED",        "wrong output must never be accepted"),
    ("java compile error",        "java",       JAVA_COMPILE_ERROR,  "COMPILE_ERROR", "syntax errors are reported as compile errors"),
    ("java infinite loop",        "java",       JAVA_INFINITE_LOOP,  "TIMEOUT",       "runaway program is killed"),
    ("java runtime exception",    "java",       JAVA_RUNTIME_ERROR,  "FAILED",        "exceptions fail the tests, not the platform"),
    ("java correct + stdout noise", "java",     JAVA_SPACED_ARRAY,   "FAILED",        "extra output shifts verdicts; judge stays strict"),
    ("python correct",            "python",     PYTHON_CORRECT,      "PASSED",        "python runtime"),
    ("c++ correct",               "c++",        CPP_CORRECT,         "PASSED",        "c++ runtime"),
    ("c correct",                 "c",          C_CORRECT,           "PASSED",        "c runtime"),
    ("javascript correct",        "javascript", JS_CORRECT,          "PASSED",        "javascript runtime"),
]


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


def request(method, path, body=None, token=None, timeout=300):
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
        return e.code, e.read().decode()[:300]


def auth_token():
    token = os.environ.get("TOKEN")
    if token:
        return token
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    if not email or not password:
        sys.exit("Set TOKEN, or ADMIN_EMAIL + ADMIN_PASSWORD (or provide deploy/secrets.env).")
    status, body = request("POST", "/api/auth/login", {"email": email, "password": password}, timeout=120)
    if status != 200 or not isinstance(body, dict) or "token" not in body:
        sys.exit(f"login failed (HTTP {status})")
    return body["token"]


def main():
    load_secrets()
    token = auth_token()
    status, problems = request("GET", "/api/dsa/problems", token=token, timeout=120)
    if status != 200:
        sys.exit(f"could not list problems (HTTP {status})")
    slugs = {p["slug"] for p in problems}
    if SLUG not in slugs:
        sys.exit(f"problem {SLUG} not found")

    print(f"Judge verification against {BASE} (problem: {SLUG})\n")
    failures = 0
    for name, lang, code, expected, note in CASES:
        status, result = request("POST", f"/api/dsa/problems/{SLUG}/run",
                                 {"language": lang, "code": code}, token=token)
        if status != 200 or not isinstance(result, dict):
            print(f"  FAIL  {name:<28} HTTP {status} {str(result)[:120]}")
            failures += 1
            continue
        got = result.get("status")
        passed = result.get("passedCount", result.get("passed"))
        total = result.get("totalCount", result.get("total"))
        ms = result.get("durationMs")
        ok = got == expected
        if not ok:
            failures += 1
        flag = "PASS" if ok else "FAIL"
        detail = f"{passed}/{total} tests"
        if ms:
            detail += f", {ms} ms"
        if got == "COMPILE_ERROR" or got == "TIMEOUT":
            detail += f" — {str(result.get('message', ''))[:60]}"
        print(f"  {flag}  {name:<28} status={got:<14} expected={expected:<14} {detail}")
        if not ok:
            print(f"        note: {note}")
            print(f"        raw: {json.dumps(result)[:300]}")
    print()
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print(f"All {len(CASES)} live judge cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
