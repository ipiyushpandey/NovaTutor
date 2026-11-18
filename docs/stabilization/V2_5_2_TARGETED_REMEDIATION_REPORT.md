# NovaTutor v2.5.2 — Targeted HIGH-Severity Remediation Report

**Date:** 2026-11-18  
**Branch:** `remediation/v2.5.1-independent-audit-fixes`  
**Starting HEAD:** `9fbfb50`  
**Re-Audit Record Commit:** `f79bd0e` (`docs/stabilization/FINAL_V25_1_INDEPENDENT_REAUDIT.md`)  
**Code & Regression Test Commit:** `98c0501` (`fix(security,sse,session): remediate v2.5.2 HIGH findings (REAUDIT-01..05)`)  
**Preserved Branches (Untouched):** `main` (`e6a0034`), `stabilization/v2.4-security-reliability` (`40999f0`), `remediation/v2.5-audit-fixes` (`d3020d4`)

---

## 1. Exact Files Changed & Rationale

Only the **4 HIGH-severity findings (`REAUDIT-01..04`)** and the directly related **`REAUDIT-05`** async session-overwrite guards were modified (zero unrelated refactors, zero UI/CSS changes):

| File | Finding(s) | Change & Why |
|---|---|---|
| `backend/src/main/java/com/aitutor/intelligence/LearningEventAnalyticsService.java` | `REAUDIT-01` | Added canonical `todayIst()` and `startOfTodayIst()` helpers returning naive `LocalDateTime` at IST midnight (`LocalDate.now(LEARNING_ZONE).atStartOfDay()`), matching how `learning_events.created_at` is persisted across `LearningEvent` and `LearningEventService` regardless of host JVM timezone. |
| `backend/src/main/java/com/aitutor/repository/UserRepository.java` | `REAUDIT-02` | Added `findByIdForUpdate(@Param("id") Long id)` with `LockModeType.PESSIMISTIC_WRITE` to serialize per-user daily XP cap checks + inserts without schema changes or gap-lock deadlocks. |
| `backend/src/main/java/com/aitutor/intelligence/AdaptiveController.java` | `REAUDIT-01`, `REAUDIT-02` | Switched `revisionComplete()` to `startOfTodayIst()` + `findByIdForUpdate()`. Hardened `answer()` to validate `questionId` and `selectedOption` (`0..3`), lock `User`, and enforce a persistent concurrency-safe daily cap of `30` `ADAPTIVE_QUESTION` XP events per IST day (consuming single-use AI questions via zero-XP `ADAPTIVE_QUESTION_CAPPED` when capped while keeping grading & `xpCapped` flag intact). |
| `backend/src/main/java/com/aitutor/intelligence/IntelligenceController.java` | `REAUDIT-01`, `REAUDIT-02` | Made `event()` `@Transactional`, locked `User` via `findByIdForUpdate()`, and replaced `.withZoneSameInstant(ZoneId.systemDefault())` with `LearningEventAnalyticsService.startOfTodayIst()`. |
| `backend/src/main/java/com/aitutor/quiz/QuizController.java` | `REAUDIT-02` | Made `submit()` `@Transactional`; rejected empty/null answers, missing `questionId`, out-of-range `selectedOption` (`0..3`), and submissions with zero valid course questions with HTTP `400` before any DB write; switched `QUIZ_QUESTION` dedupe to daily per-outcome (`todayIst`) to preserve revision tracking while preventing per-minute replay; capped `QUIZ_COMPLETED` XP at `10`/day (IST) under `findByIdForUpdate()` while preserving legitimate grading & `QuizAttempt` history. |
| `backend/src/main/java/com/aitutor/config/SecurityConfig.java` | `REAUDIT-03` | Added `.dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll()` in `authorizeHttpRequests` so Tomcat's internal `ASYNC` dispatch on `SseEmitter.complete()` never fails with `AuthorizationDeniedException`, while keeping ordinary `REQUEST` authentication/authorization completely unchanged. |
| `frontend/src/lib/api.js` | `REAUDIT-04` | Added `sessionGeneration`, `isSameSession(originating)`, and exported `invalidatePendingSessionRefresh()` (aborting any in-flight `/auth/me` controller). `refreshSessionTokenWithStatus()` now verifies `gen === sessionGeneration && isSameSession(current)` before writing `ai_user` or dispatching `nova:session-refreshed`. `api()` and `apiStream()` verify `isSameSession(session)` before expiring a session on 401 so stale 401s from a previous user cannot wipe a newly signed-in user. |
| `frontend/src/main.jsx` | `REAUDIT-04`, `REAUDIT-05` | Called `invalidatePendingSessionRefresh()` in `clearUserClientState` and `Auth.onLogin`; guarded `nova:session-refreshed` listener, bootstrap `/auth/me` callback, `/users/:id` profile effect (`ai_user` & `nova_ai_language`), `AILearningProfile` (`useEffect` `alive` + `save()` `ai_user` writes), and `NovaCoach` cache write against the active `readUser().id`. |
| `backend/src/test/java/com/aitutor/controller/Wave2BackendFunctionalTest.java` | `REAUDIT-01`, `REAUDIT-02` | Added `dailyXpCapsRespectIstBoundariesWhenHostTimezoneIsUtc()` (explicitly running under `TimeZone.setDefault(UTC)`) and `emptyAndInvalidQuizSubmissionsRejectedAndQuizAndAdaptiveXpAreCapped()`. |
| `backend/src/test/java/com/aitutor/controller/SseAsyncSecurityTomcatTest.java` (new) | `REAUDIT-03` | Real embedded Tomcat (`WebEnvironment.RANDOM_PORT`) integration test verifying unauthenticated SSE still returns `401`, and authenticated `/api/ai/ask/stream` & `/api/mentor/ask/stream` stream chunks + `event:done` to clean EOF with zero socket abort or `AuthorizationDeniedException`. |
| `frontend/src/lib/stabilization.test.mjs` | `REAUDIT-04` | Added deterministic unit tests covering delayed `/auth/me` after Logout, delayed `/auth/me` after Account Switch (User A -> User B), and delayed 401 from User A after switching to User B. |
| `frontend/tests/stabilization.spec.js` | `REAUDIT-04` | Added `Pass 2G (REAUDIT-04 Session Race)` verifying in real Chromium (desktop + mobile) that a 450ms-delayed `/api/auth/me` neither resurrects a logged-out session nor overwrites switched User B. |

---

## 2. Before / After Behavior per Finding

| Finding | Before (`9fbfb50`) | After (`98c0501`) |
|---|---|---|
| **REAUDIT-01** *(UTC Daily XP Boundaries)* | `todayIst.atStartOfDay(ist).withZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime()` evaluated to **yesterday `18:30:00`** on UTC hosts (Render/Docker), miscounting 5.5 hours of yesterday evening's IST events against today's cap and locking students out. | Uses `LearningEventAnalyticsService.startOfTodayIst()` (`LocalDate.now(Asia/Kolkata).atStartOfDay()`), matching the naive IST `LocalDateTime` persisted in `learning_events.created_at` identically on UTC, IST, or any other JVM timezone. |
| **REAUDIT-02** *(Empty Quiz & Uncapped Adaptive XP)* | `POST /api/quizzes/course/{id}/submit` with `{"answers":[]}` created a `QuizAttempt` (`total=0`) and awarded `+20 XP` (`QUIZ_COMPLETED`) per request (~4,800 XP/min); `QUIZ_QUESTION` could be replayed every minute; `AdaptiveController.answer` had no daily XP cap. | Empty answers, non-course question IDs, and out-of-range options (`<0` or `>3`) are rejected with HTTP `400` (zero attempts, zero XP). Valid quizzes still grade & save attempts, with `QUIZ_QUESTION` deduped daily per outcome and `QUIZ_COMPLETED` XP capped at `10`/day (IST). `AdaptiveController.answer` validates options and enforces a concurrency-safe `30`/day IST XP cap (keeping grading & single-use AI consumption intact). |
| **REAUDIT-03** *(Spring Security ASYNC SSE Failure)* | Completing `SseEmitter.complete()` on `/api/ai/ask/stream` or `/api/mentor/ask/stream` in real Tomcat triggered an `ASYNC` dispatch rejected by `AuthorizationFilter` (`AuthorizationDeniedException: Access Denied` on committed response), logging an ERROR stack trace and aborting the TCP socket. | `SecurityConfig` permits internal `DispatcherType.ASYNC` and `DispatcherType.ERROR` dispatches while keeping `DispatcherType.REQUEST` authentication/authorization untouched. Real Tomcat streams complete cleanly to EOF with zero errors while unauthenticated requests still return `401`. |
| **REAUDIT-04 & REAUDIT-05** *(Async Session Resurrection / Overwrite)* | An in-flight `/auth/me` (or `/users/:id` / `AILearningProfile` / `NovaCoach`) resolving after Logout or Account Switch could rewrite User A into `localStorage['ai_user']` and dispatch `nova:session-refreshed`, signing the logged-out user back in or overwriting User B. | Every session transition invalidates pending refreshes (`sessionGeneration++` + abort) and all async session/profile callbacks verify `readUser()` still matches the originating user ID/token before touching `localStorage` or React state. |

---

## 3. Tests Executed & Actual Pass/Fail Counts

| Suite | Command | Result |
|---|---|---|
| **Backend Maven Suite** *(incl. UTC timezone test, Quiz/Adaptive XP cap test, and real embedded Tomcat SSE test)* | `mvn -o -B test` (cwd: `backend/`) | **114 / 114 PASS** (`0` fail, `0` error, `0` skip; `12.45s`) — `SseAsyncSecurityTomcatTest` ran against real embedded Apache Tomcat `10.1.42` over loopback HTTP (`1/1 PASS`), `Wave2BackendFunctionalTest` (`12/12 PASS`) |
| **Frontend Unit Tests** *(incl. `REAUDIT-04` deterministic race test)* | `npm test` (cwd: `frontend/`) | **19 / 19 PASS** (`0` fail, `0` skip; `840ms`) |
| **Frontend Production Build** | `npm run build` (cwd: `frontend/`) | **PASS** (`1.50s`, `0` errors) |
| **Playwright `stabilization.spec.js`** *(desktop + mobile, incl. `Pass 2G` session race)* | `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/stabilization.spec.js --project=desktop --project=mobile` | **26 / 26 PASS** (`13` desktop + `13` mobile; `40.3s`) |

---

## 4. Remaining Limitations & Unverified External Dependencies

1. **Docker Container Execution (`UNVERIFIED`):** Docker Desktop daemon is not running on this host (`docker.sock` absent); live Docker Java/Go execution remains unverified locally (Render production uses `CODE_RUNNER_PROVIDER=remote`).
2. **TiDB Cloud Serverless Migration (`UNVERIFIED`):** Backend tests ran against H2 (`MODE=MySQL`); `database/migrations/V2026_11_18__stabilization_v25.sql` + `JPA_DDL_AUTO=validate` must still be verified against a staging TiDB Cloud instance before production cutover.
3. **Render Static-Site CSP Header Override (`UNVERIFIED LIVE`):** Must verify via `curl -I https://<render-host>/ide-preview.html` after deploy that Render overrides (rather than appends) `Content-Security-Policy` on `/ide-preview.html`.
4. **Non-HIGH Findings from `FINAL_V25_1_INDEPENDENT_REAUDIT.md`:** Medium/Low findings (`REAUDIT-06..12`: `DsaController` `cSupported`, `ide-preview.html` `<head>` regex hardening, `AdaptiveController` JSON `null`, `GlobalExceptionHandler` case-insensitive `Accept`, `Reset starter` `try/catch`, minor ops nits) were intentionally left out of scope per v2.5.2 instructions.

---

## 5. Git Diff Summary (`f79bd0e..98c0501`)

```text
 backend/src/main/java/com/aitutor/config/SecurityConfig.java                  |   3 +
 backend/src/main/java/com/aitutor/intelligence/AdaptiveController.java        |  56 ++++++--
 backend/src/main/java/com/aitutor/intelligence/IntelligenceController.java    |   6 +-
 .../com/aitutor/intelligence/LearningEventAnalyticsService.java               |  10 ++
 backend/src/main/java/com/aitutor/quiz/QuizController.java                    |  47 +++++--
 backend/src/main/java/com/aitutor/repository/UserRepository.java              |   8 ++
 .../java/com/aitutor/controller/SseAsyncSecurityTomcatTest.java               | 145 +++++++++++++++++++
 .../java/com/aitutor/controller/Wave2BackendFunctionalTest.java               | 156 +++++++++++++++++++++
 frontend/src/lib/api.js                                                       |  57 ++++++--
 frontend/src/lib/stabilization.test.mjs                                       |  61 ++++++++
 frontend/src/main.jsx                                                         |  40 ++++--
 frontend/tests/stabilization.spec.js                                          |  73 ++++++++++
 12 files changed, 609 insertions(+), 53 deletions(-)
```
