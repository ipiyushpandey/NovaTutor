#!/usr/bin/env python3
"""Live AI Teacher streaming completeness + latency check.

Uses a disposable guest session, so no student account is needed. Measures
time-to-first-token and total duration for a fixed short prompt, verifies that
the stream ends with the server's done event and that content is non-empty.
"""
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080/api").rstrip("/")
RUNS = int(os.environ.get("AI_RUNS", "5"))
PROMPT = "Explain in three short sentences why a primary key must be unique."


def call(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
        return r.status, (json.loads(raw) if raw.strip() else None)


def stream_once(token):
    body = json.dumps({"task": "TUTOR", "topic": "Databases", "message": PROMPT,
                       "level": "beginner", "language": "English"}).encode()
    req = urllib.request.Request(BASE + "/ai/ask/stream", data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "text/event-stream",
        "Authorization": "Bearer " + token,
    })
    started = time.perf_counter()
    first = None
    text = []
    done = False
    with urllib.request.urlopen(req, timeout=120) as response:
        for raw in response:
            line = raw.decode("utf-8").rstrip("\r\n")
            if not line.startswith("data:"):
                continue
            data = line[5:]
            if data == "done":
                done = True
                continue
            if data == "AI request failed. Please try again.":
                raise RuntimeError(data)
            if data:
                if first is None:
                    first = time.perf_counter() - started
                text.append(data)
    total = time.perf_counter() - started
    return first, total, "".join(text), done


def p95(values):
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round(0.95 * (len(ordered) - 1)))))
    return ordered[index]


def main():
    status, guest = call("POST", "/auth/guest")
    if status != 200:
        sys.exit(f"guest session failed: {status}")
    token = guest["token"]
    ttfts, totals = [], []
    try:
        for i in range(RUNS):
            try:
                first, total, text, done = stream_once(token)
            except urllib.error.HTTPError as e:
                print(f"FAIL run {i + 1}: HTTP {e.code} {e.read().decode()[:200]}")
                return 1
            ok = bool(text.strip()) and done and first is not None
            print(("PASS" if ok else "FAIL") + f"  run {i + 1}: first token {round((first or 0) * 1000)} ms, "
                  f"total {round(total * 1000)} ms, {len(text)} chars, done={done}")
            if not ok:
                return 1
            ttfts.append(first * 1000)
            totals.append(total * 1000)
    finally:
        try:
            call("DELETE", "/auth/guest", token=token)
        except Exception:
            pass
    print()
    print(f"AI TTFT median {round(statistics.median(ttfts))} ms | P95 {round(p95(ttfts))} ms")
    print(f"AI total median {round(statistics.median(totals))} ms | P95 {round(p95(totals))} ms")
    print(f"All {RUNS} streams completed with the done event")
    return 0


if __name__ == "__main__":
    sys.exit(main())
