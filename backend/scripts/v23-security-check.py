#!/usr/bin/env python3
"""Live security + regression checks for the V2.3 fixes.

Covers backend portal separation, guest isolation, protected deletion,
bulk deletion and quiz wrong-answer revision against a running API.
Disposable accounts only; no production data.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8080/api").rstrip("/")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "owner-v21@novatutor.test")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "OwnerPass123456")
results = []


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw[:200]


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def login(email, password, portal=None):
    body = {"email": email, "password": password}
    if portal:
        body["portal"] = portal
    return call("POST", "/auth/login", body)


def main():
    t0 = time.time()
    status, admin = login(ADMIN_EMAIL, ADMIN_PASSWORD, "admin")
    admin_login_ms = round((time.time() - t0) * 1000)
    if status != 200:
        sys.exit(f"admin login failed: {status} {admin}")
    admin_token = admin["token"]
    check("admin signs in through the admin portal", admin.get("role") == "ADMIN", f"{admin_login_ms} ms")

    status, body = login(ADMIN_EMAIL, ADMIN_PASSWORD, "student")
    check("admin credentials rejected by student portal", status == 403, f"HTTP {status}")

    stamp = int(time.time() * 1000)
    email = f"v23-{stamp}@novatutor.test"
    password = "V23StudentPass1"
    status, reg = call("POST", "/auth/register", {"name": "V23 Student", "email": email, "password": password})
    check("disposable student registered", status == 202, f"HTTP {status}")
    status, listing = call("GET", "/admin/users", token=admin_token)
    row = next((u for u in listing if u.get("email") == email), None) if isinstance(listing, list) else None
    check("new student visible to admin", row is not None)
    if not row:
        return finish()
    student_id = row["id"]
    call("POST", f"/admin/users/{student_id}/verify-email", token=admin_token)
    status, student = login(email, password, "student")
    check("student signs in through the student portal", status == 200 and student.get("role") == "STUDENT", f"HTTP {status}")
    student_token = student.get("token") if isinstance(student, dict) else None

    status, body = login(email, password, "admin")
    check("student credentials rejected by admin portal", status == 403, f"HTTP {status}")
    status, body = call("GET", "/admin/users", token=student_token)
    check("student JWT denied admin API", status == 403, f"HTTP {status}")

    # Guest isolation: four independent sessions, each with its own user id.
    guests = []
    for i in range(4):
        status, g = call("POST", "/auth/guest")
        if status == 200:
            guests.append(g)
    check("four simultaneous guest sessions created", len(guests) == 4, f"{len(guests)}/4")
    for i, g in enumerate(guests):
        call("PUT", f"/users/{g['id']}", {"name": f"Guest {i}"}, token=g["token"])
    isolated = True
    for i, g in enumerate(guests):
        status, me = call("GET", f"/users/{g['id']}", token=g["token"])
        if status != 200 or me.get("name") != f"Guest {i}":
            isolated = False
        other = guests[(i + 1) % len(guests)]
        status, _ = call("GET", f"/users/{other['id']}", token=g["token"])
        if status not in (400, 403):
            isolated = False
    check("guest profile data is isolated per session", isolated)
    cross_denied = True
    for i, g in enumerate(guests):
        call("POST", f"/intelligence/{g['id']}/events",
             {"type": "STUDY_SESSION_COMPLETED", "subject": "Isolation", "topic": f"guest-{i}", "durationSeconds": 60},
             token=g["token"])
        status, _ = call("POST", f"/intelligence/{guests[(i + 1) % 4]['id']}/events",
                         {"type": "STUDY_SESSION_COMPLETED", "subject": "Leak", "durationSeconds": 60}, token=g["token"])
        if status not in (400, 403):
            cross_denied = False
    check("guest cannot write another guest's learning data", cross_denied)
    status, _ = call("GET", "/admin/users", token=guests[0]["token"])
    check("guest JWT denied admin API", status == 403, f"HTTP {status}")
    status, page = call("GET", "/admin/users", token=admin_token)
    ids = {u["id"] for u in page} if isinstance(page, list) else set()
    check("guest sessions excluded from admin user list", all(g["id"] not in ids for g in guests))

    # Wrong-answer revision + dedupe.
    status, courses = call("GET", "/courses")
    course_id = courses[0]["id"] if isinstance(courses, list) and courses else None
    if not course_id:
        check("a course exists for quiz checks", False)
        return finish()
    created_questions = []
    fixture_status = []
    for i in range(3):
        status, q = call("POST", "/admin/questions", {
            "courseId": course_id,
            "question": f"V23 isolation question {stamp}-{i}: what is {i} + 1?",
            "optionA": str(i + 1), "optionB": str(i + 2), "optionC": str(i + 3), "optionD": str(i + 4),
            "correctOption": 0, "explanation": "Fixture question.", "difficulty": "Easy"
        }, token=admin_token)
        fixture_status.append(status)
        if status in (200, 201) and q.get("id"):
            created_questions.append(q["id"])
    status, admin_questions = call("GET", "/admin/questions", token=admin_token)
    status, questions = call("GET", f"/quizzes/course/{course_id}", token=student_token)
    qs = questions if isinstance(questions, list) else []
    keys = [str(q.get("question", "")).strip().lower() for q in qs]
    check("quiz payload has no duplicate question text", len(keys) == len(set(keys)), f"{len(keys)} questions")
    wrong_ids = [q["id"] for q in qs if q["id"] in created_questions][:3]
    check("quiz fixture questions available", len(wrong_ids) >= 1, f"{len(wrong_ids)} available create={fixture_status}")
    status, submitted = call("POST", f"/quizzes/course/{course_id}/submit",
                             {"answers": [{"questionId": q, "selectedOption": 99} for q in wrong_ids]},
                             token=student_token)
    check("wrong answers recorded", status == 200 and len(submitted.get("wrongQuestionIds", [])) == len(wrong_ids))
    status, revision = call("GET", f"/quizzes/course/{course_id}/revision", token=student_token)
    revision_ids = [q["id"] for q in revision] if isinstance(revision, list) else []
    check("revision returns only unique wrong questions",
          bool(revision_ids) and len(revision_ids) == len(set(revision_ids)) and all(q in wrong_ids for q in revision_ids))

    by_id = {q["id"]: q for q in admin_questions} if isinstance(admin_questions, list) else {}
    correct_target = next((q for q in qs if q["id"] in by_id and q["id"] in wrong_ids), None)
    if correct_target:
        correct_option = by_id[correct_target["id"]]["correctOption"]
        call("POST", f"/quizzes/course/{course_id}/submit",
             {"answers": [{"questionId": correct_target["id"], "selectedOption": correct_option}]},
             token=student_token)
        status, revision2 = call("GET", f"/quizzes/course/{course_id}/revision", token=student_token)
        ids2 = [q["id"] for q in revision2] if isinstance(revision2, list) else []
        check("correctly answered question excluded from revision", correct_target["id"] not in ids2)

    # Deletion + protected records.
    status, _ = call("DELETE", f"/admin/users/{student_id}", token=student_token)
    check("student cannot delete an account through admin API", status == 403, f"HTTP {status}")
    status, _ = call("DELETE", f"/admin/users/{admin['id']}", token=admin_token)
    check("owner/admin self-deletion blocked", status in (400, 403), f"HTTP {status}")
    status, deleted = call("DELETE", f"/admin/users/{student_id}", token=admin_token)
    check("admin deletes a student and owned data", status == 200 and deleted.get("deleted") is True, f"HTTP {status}")
    for qid in created_questions:
        call("DELETE", f"/admin/questions/{qid}", token=admin_token)

    # Guest session end + bulk deletion.
    status, ended = call("DELETE", "/auth/guest", token=guests[0]["token"])
    check("guest can end its own session", status == 200 and ended.get("ended") is True)
    status, _ = call("GET", "/auth/me", token=guests[0]["token"])
    check("ended guest session rejected", status in (401, 403), f"HTTP {status}")
    remaining = [g["id"] for g in guests[1:]]
    status, bulk = call("POST", "/admin/users/bulk-delete", {"ids": remaining}, token=admin_token)
    check("authorized bulk deletion succeeds",
          status == 200 and bulk.get("deletedCount") == len(remaining), f"HTTP {status}")
    status, bulk2 = call("POST", "/admin/users/bulk-delete", {"ids": [admin["id"]]}, token=admin_token)
    check("bulk deletion skips protected owner/admin",
          status == 200 and not bulk2.get("deleted") and bulk2.get("skipped"), f"HTTP {status}")
    return finish()


def finish():
    failed = [n for n, ok in results if not ok]
    print()
    if failed:
        print(f"{len(failed)} check(s) failed")
        return 1
    print(f"All {len(results)} security/regression checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
