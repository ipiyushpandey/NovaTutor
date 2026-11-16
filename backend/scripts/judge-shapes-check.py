#!/usr/bin/env python3
"""Live judge verification across problem shapes and languages.

Correct solutions for every problem-shape family (array, scalar, string, matrix,
multiple parameters) must be Accepted in every supported language. This catches
harness bugs that only appear for one signature kind — for example a C++ harness
that cannot bind its array argument.

Usage:
    BASE_URL=http://127.0.0.1:8080 python3 backend/scripts/judge-shapes-check.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080").rstrip("/")

# (problem, language, code, note)
CASES = [
    # --- array -> array
    ("build-array-from-permutation", "java", """class Solution {
    public static int[] solve(int[] nums) {
        int[] a = new int[nums.length];
        for (int i = 0; i < nums.length; i++) a[i] = nums[nums[i]];
        return a;
    }
}""", "array->array"),
    ("build-array-from-permutation", "go", """func solve(nums []int) []int {
    a := make([]int, len(nums))
    for i := range nums { a[i] = nums[nums[i]] }
    return a
}""", "array->array (go)"),

    # --- array -> int
    # rows are flattened row-by-row, two columns per customer (see statement)
    ("richest-customer-wealth", "java", """class Solution {
    public static int solve(int[] nums) {
        int best = 0;
        for (int i = 0; i + 1 < nums.length; i += 2) best = Math.max(best, nums[i] + nums[i + 1]);
        return best;
    }
}""", "array->int (flat rows)"),
    ("richest-customer-wealth", "python", """def solve(nums):
    return max(nums[i] + nums[i + 1] for i in range(0, len(nums) - 1, 2))
""", "array->int (flat rows, python)"),

    # --- array + int -> int
    ("binary-search", "java", """class Solution {
    public static int solve(int[] nums, int n) {
        int lo = 0, hi = nums.length - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            if (nums[mid] == n) return mid;
            if (nums[mid] < n) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }
}""", "array+int->int"),
    ("binary-search", "c", """void solve(const int* nums, int nums_len, int n, Result* out) {
    int lo = 0, hi = nums_len - 1;
    out->i = -1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (nums[mid] == n) { out->i = mid; return; }
        if (nums[mid] < n) lo = mid + 1; else hi = mid - 1;
    }
}""", "array+int->int (c)"),

    # --- int -> int
    ("fibonacci-number", "java", """class Solution {
    public static int solve(int n) {
        int a = 0, b = 1;
        for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; }
        return a;
    }
}""", "int->int"),
    ("fibonacci-number", "javascript", """function solve(n) {
    let a = 0, b = 1;
    for (let i = 0; i < n; i++) { const t = a + b; a = b; b = t; }
    return a;
}""", "int->int (js)"),

    # --- int -> array
    ("gray-code-n", "java", """class Solution {
    public static int[] solve(int n) {
        int size = 1 << n;
        int[] a = new int[size];
        for (int i = 0; i < size; i++) a[i] = i ^ (i >> 1);
        return a;
    }
}""", "int->array"),

    # --- int -> matrix
    ("pascals-triangle", "java", """class Solution {
    public static int[][] solve(int n) {
        int[][] rows = new int[n][];
        for (int r = 0; r < n; r++) {
            rows[r] = new int[r + 1];
            rows[r][0] = rows[r][r] = 1;
            for (int c = 1; c < r; c++) rows[r][c] = rows[r - 1][c - 1] + rows[r - 1][c];
        }
        return rows;
    }
}""", "int->matrix"),
    ("pascals-triangle", "c++", """vector<vector<int>> solve(int n) {
    vector<vector<int>> rows(n);
    for (int r = 0; r < n; r++) {
        rows[r].assign(r + 1, 1);
        for (int c = 1; c < r; c++) rows[r][c] = rows[r-1][c-1] + rows[r-1][c];
    }
    return rows;
}""", "int->matrix (c++)"),

    # --- string -> string
    ("reverse-string", "java", """class Solution {
    public static String solve(String s) {
        return new StringBuilder(s).reverse().toString();
    }
}""", "string->string"),
    ("reverse-string", "c++", """string solve(string s) {
    reverse(s.begin(), s.end());
    return s;
}""", "string->string (c++)"),
    ("reverse-string", "c", """void solve(const char* s, Result* out) {
    int n = (int)strlen(s);
    for (int i = 0; i < n; i++) out->str[i] = s[n - 1 - i];
    out->str[n] = 0;
}""", "string->string (c)"),
    ("reverse-string", "python", """def solve(s):
    return s[::-1]
""", "string->string (python)"),
    ("reverse-string", "javascript", """function solve(s) {
    return s.split('').reverse().join('');
}""", "string->string (js)"),
    ("reverse-string", "go", """func solve(s string) string {
    r := []rune(s)
    for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 { r[i], r[j] = r[j], r[i] }
    return string(r)
}""", "string->string (go)"),

    # --- string -> int
    ("first-unique-character", "java", """class Solution {
    public static int solve(String s) {
        int[] f = new int[26];
        for (char c : s.toCharArray()) f[c - 'a']++;
        for (int i = 0; i < s.length(); i++) if (f[s.charAt(i) - 'a'] == 1) return i;
        return -1;
    }
}""", "string->int"),

    # --- two strings -> int
    ("valid-anagram", "java", """class Solution {
    public static int solve(String s, String t) {
        if (s.length() != t.length()) return 0;
        int[] f = new int[26];
        for (int i = 0; i < s.length(); i++) { f[s.charAt(i) - 'a']++; f[t.charAt(i) - 'a']--; }
        for (int v : f) if (v != 0) return 0;
        return 1;
    }
}""", "string+string->int"),
]


def load_secrets():
    path = "deploy/secrets.env"
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v)


def request(method, path, body=None, token=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def main():
    load_secrets()
    token = os.environ.get("TOKEN")
    if not token:
        status, body = request("POST", "/api/auth/login",
                               {"email": os.environ.get("ADMIN_EMAIL"), "password": os.environ.get("ADMIN_PASSWORD")})
        if status != 200:
            sys.exit(f"login failed (HTTP {status})")
        token = body["token"]

    print(f"Shape/language sweep against {BASE}\n")
    failures = 0
    for problem, lang, code, note in CASES:
        status, res = request("POST", f"/api/dsa/problems/{problem}/run",
                              {"language": lang, "code": code}, token=token)
        if status != 200:
            print(f"  FAIL {problem:<30} {lang:<11} HTTP {status} {str(res)[:80]}")
            failures += 1
            continue
        verdict = res.get("status")
        ok = verdict == "PASSED"
        if not ok:
            failures += 1
        detail = f"{res.get('passed')}/{res.get('total')}"
        if res.get("durationMs"):
            detail += f" {res.get('durationMs')}ms"
        print(f"  {'PASS' if ok else 'FAIL'} {problem:<30} {lang:<11} {verdict:<14} {detail}  ({note})")
        if not ok:
            bad = [t for t in res.get("tests", []) if not t["passed"]]
            if bad:
                b = bad[0]
                print(f"        first failing: in={b['input'][:60]} exp={b['expected'][:60]} got={b['actual'][:60]}")
            elif res.get("message"):
                print(f"        message: {str(res['message'])[:160]}")
    print()
    if failures:
        print(f"{failures} case(s) failed")
        return 1
    print(f"All {len(CASES)} shape/language cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
