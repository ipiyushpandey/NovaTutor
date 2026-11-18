# NovaTutor — Remediation Changelog (`remediation/v2.5-audit-fixes`)

**Branch:** `remediation/v2.5-audit-fixes`  
**Base Commit:** `40999f0` (`stabilization/v2.4-security-reliability`)  
**Total Scope:** 59 files changed (`+2,574 / -538` lines across 10 commits)

---

## Wave 0 — Production Browser Baseline (Read-Only)
- **`a2ceb90`** — `docs: record read-only live production browser baseline across 12 viewports`
  - Added `docs/stabilization/PRODUCTION_BROWSER_BASELINE.md` documenting live Chromium inspection of `https://novatutor.onrender.com` and `https://novatutor-api.onrender.com` across all 12 widths (`320..1920`), light/dark modes, public routes, cold-start latency, and missing production API headers.

## Wave 1 — CRITICAL-SEC-01 & CRITICAL-SEC-02 (Proxy/Filter Hardening & Pre-Registration Takeover)
- **`4ac8a19`** — `fix(wave-1): remediate CRITICAL-SEC-01 proxy/filter conflict and CRITICAL-SEC-02 pre-registration takeover`
  - Switched `application-prod.yml` to `server.forward-headers-strategy: native` with Tomcat `remoteip` internal proxy configuration.
  - Hardened `RequestRateLimitFilter.clientAddress()` to trust `X-Forwarded-For` only from loopback/private proxy peers (walking right-to-left) and disabled automatic Servlet container double-registration via `FilterRegistrationBean.setEnabled(false)`.
  - Tightened `ProductionConfigValidator` to reject conflicting proxy/rate-limit configurations.
  - Introduced token-bound `PendingRegistration` entity + `PendingRegistrationRepository` + SQL migration `database/migrations/V2026_11_18__stabilization_v25.sql` so unverified signups never occupy permanent `users` rows.
  - Hardened `EmailVerificationService`, `AuthService`, and `AuthController`: pending registration issuance/verification/resend, 60s forgot-password cooldown with guest exclusion, Google OAuth password rotation & legacy token purge, and anti-enumeration login ordering.

## Wave 2 — HIGH-SEC-01 & HIGH-SEC-02 (DSA Hidden Test Isolation & Pre-Auth / Guest Caps)
- **`90e03e7`** — `fix(wave-2): remediate HIGH-SEC-01 DSA hidden test exfiltration and HIGH-SEC-02 pre-auth flood, code/analyze bucket, and guest cap`
  - Split `DsaJudgeService` execution into separate sample and hidden `sandbox.execute()` calls and suppressed hidden-suite `stderr` from API responses.
  - Added `PreAuthRateLimitFilter` wired before `JwtAuthenticationFilter` (with auto-registration disabled).
  - Classified `/api/code/analyze` into the `ai` rate-limit bucket and tightened production quotas in `application-prod.yml`.
  - Added active guest cap (`app.guest.max-active: 200`), purge-before-reject, and per-user isolated cleanup in `GuestService` / `UserRepository`.

## Wave 3 — MEDIUM-SEC-01/02/04/05 (Draft Isolation, XP Farming, Security Headers, IDE CSP)
- **`8ecd206`** — `fix(wave-3): remediate MEDIUM-SEC-01/02 draft course leaks, XP farming, and MEDIUM-SEC-04/05 security headers, error scrubbing, and IDE CSP`
  - Added `AuthenticatedUser.isAdmin(...)` and blocked draft course access in `QuizController`, `MentorController`, `DppController`, `ProgressController`, `AdaptiveController`, and `LearningRecommendationController`.
  - Stopped `QuizController.submit()` from mutating shared `QuizQuestion.topic`.
  - Added single-use `transientId` consumption & daily deduplication in `AdaptiveController`, hourly dedupe + 6/day + 3600s caps in `IntelligenceController.event()`, and blocked promoting/modifying `GUEST` accounts in `AdminController.updateUserRole`.
  - Added `Content-Security-Policy`, HSTS, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`, and `X-Frame-Options` across `SecurityConfig`, `render.yaml`, and `deploy/nginx.conf`; restricted `/api/courses/**` and `/api/gate-cse/notes/**` `permitAll()` to `HttpMethod.GET`.
  - Scrubbed raw Gemini/upstream exceptions and closed non-2xx bodies in `GeminiProvider`; made raw `IllegalStateException` responses generic in `GlobalExceptionHandler`.
  - Hardened `CourseDppIde` HTML preview in `frontend/src/main.jsx` with strict inner CSP `<meta>`, `allow=""`, and non-persisted local React state for `htmlPreview`.

## Wave 4 — HIGH-DB-01/02/03 & HIGH-AI-01 (Concurrency, Reconciliation, Seeder, Bounded SSE Pools)
- **`b30fb4f`** — `fix(wave-4): remediate HIGH-DB-01/02/03 concurrency/reconciliation/seeder bugs and HIGH-AI-01 bounded SSE pools and stream abort`
  - Removed `@Transactional` from `AdaptiveController.aiQuestion()` so DB connections are not held during Gemini calls.
  - Added atomic `LearningEventService.recordIfAbsent(...)` with field/dedupeKey length clamping + SHA-256 fallback; added `ProgressRepository.ensureRowExists(...)` (`INSERT IGNORE`) and `findByUserIdAndCourseIdForUpdate(...)` (`PESSIMISTIC_WRITE`); refactored `ProgressController.complete()` for race-free idempotency.
  - Added `@Transactional` to `AdminController.createLesson` and `reconcileCourseProgress` to `createLesson` / `deleteLesson`; added `(flushAutomatically=true, clearAutomatically=true)` to remaining `@Modifying` deletes.
  - Fixed `DataSeeder` per-course crash recovery, explicit detached `progress.saveAll(...)`, and batched `quizzes.saveAll(...)`.
  - Created `StreamCancellation` and replaced unbounded executors in `AiController` and `MentorController` with bounded `ThreadPoolExecutor(4, 16, 60s, ArrayBlockingQueue(32), AbortPolicy -> 503)`, wired real upstream `InputStream` close + thread interrupt + 180s deadline in `GeminiProvider`, validated null `task` (400), and normalized SSE error completion.

## Wave 5 — HIGH-DB-04, NEW-18 & HIGH-DSA-01/02/03 (Schema & DSA Harnesses / Docker Sandbox)
- **`34bebfc`** — `fix(wave-5): remediate HIGH-DB-04 MEDIUMTEXT/test-config and HIGH-DSA-01/02/03 Go/C/Java harnesses and Docker sandbox hardening`
  - Updated `DsaProblemState.lastCode` to `MEDIUMTEXT`, aligned `dsa_problem_state` in `V2026_11_18__stabilization_v25.sql`, added 250k char save cap in `DsaController.saveCode`, and cleaned `application-test.yml`.
  - Hardened `DsaLang` (Go single/block import hoisting & dedup, C `strchr` pipe splitting + matrix row bounds, Java comment-trailing import hoisting & `public final class Solution`).
  - Hardened `SandboxExecutionService` (`--user 65534:65534`, `:ro` workspace mount, `/tmp` compile targets & Go caches, separated stdout/stderr drains, exit code `99` -> `COMPILE_ERROR`, forced container kill on interrupt, preflight `destroyForcibly()`).

## Wave 6 — NEW-20 & REG-09 (Deployment Scripts, Docker Compose, Nginx & Docs)
- **`a902894`** — `fix(wave-6): remediate NEW-20/REG-09 fill-secrets, docker-compose, nginx timeouts, prod upload caps, and doc drift`
  - Fixed `deploy/fill-secrets.command` (`EXISTING_CORS_ORIGINS` preservation before truncation and `@`-safe MySQL password parsing).
  - Synced `deploy/docker-compose.prod.yml` env vars and rate-limit defaults, `deploy/nginx.conf` (`300s` timeouts, `Connection ""`, `16m` body), `application-prod.yml` (`keepalive-time: 180000`, `16MB` multipart), and `06_PERFORMANCE_AND_RENDER_RELIABILITY_REPORT.md` / `08_DEPLOYMENT_AND_ROLLBACK_PLAN.md`.

## Wave 7 — HIGH-FE-01 & HIGH-FE-02 (Logout Race & Cross-User/Guest Isolation)
- **`a6a5d12`** — `fix(wave-7): remediate HIGH-FE-01/02 logout unmount flush race and cross-user/guest client state isolation`
  - Guarded `useModulePersistence` flush/unmount/debounce callbacks against writing when `readUser()` is null or belongs to a different user.
  - Added `clearUserClientState(exitingUser)` across `logout`, `switchAccount`, and `nova-session-expired` clearing React state, 12 unscoped user `localStorage` keys (preserving `nova_theme`), `nova_scroll_v2:*` `sessionStorage` keys, and guest runtime/scoped keys.

## Wave 8 — HIGH-FE-03..08 (Routing, Scroll, SSE, DSA Sync, Dark Toast Contrast)
- **`e27142a`** — `fix(wave-8): remediate HIGH-FE-03..08 routing, scroll, SSE, DSA sync, and dark toast contrast`
  - Updated `frontend/src/lib/api.js`: WHATWG SSE leading-space stripping, `event: done`/`error`, `reader.cancel()`, `refreshSessionTokenWithStatus()` preserving `ai_user` on non-session 401s and transient `/auth/me` network errors, Safari `Load failed` handling, 45s per-attempt GET retry timeout cap.
  - Updated `frontend/src/main.jsx`: `window.history.scrollRestoration = 'manual'`, `inAppNavCountRef`, `#/learning-studio/voice` + `#/voice` route sync, `CourseDetail` Back reset to Lecture 1, `AiPanel` `askRef`/`prefillTimerRef` cleanup, `LearningStudio` prefill Teacher override, `PrepareHub` GATE/DSA route props, `window.location.replace` for denied/invalid hashes, `ResizeObserver` rAF cancellation & `keydown`/`pointerdown` scroll-restore cancellation, `TopNav` Escape closing mobile sheet.
  - Updated `frontend/src/dsa.jsx`: async `saved` bookmark/language/code sync, `langSeqRef` language-switch race guard, history-loop-free Back navigation.
  - Updated `frontend/src/styles.css`: theme-safe high-contrast `.nv-toast` (`var(--ink)` / `var(--on-ink)`).

## Wave 9 — Automated Test Repair, Expansion & Live Local Full-Stack Browser Verification
- **`be94194`** — `test(wave-9): repair e2e/stabilization suites and add SSE, 401, isolation, and multi-page browser tests`
  - Repaired `frontend/tests/e2e.spec.js` desktop TopNav closed-by-default assertion.
  - Repaired `frontend/tests/stabilization.spec.js` (`nova_app_session_marker`, Admin/DSA mock schemas, real iframe `ISOLATED:SecurityError` assertion, Course Back Lecture 1 reset + Forward Lecture 2 restore) and added tests for logout isolation, `#/voice` + `launchTeacher` override, dark-mode `.nv-toast` contrast, and multi-page desktop/mobile overflow + Escape mobile sheet.
  - Expanded `frontend/src/lib/stabilization.test.mjs` with WHATWG SSE, non-session 401, transient `/auth/me` failure, and inner-CSP/toast invariants.
  - Added two small UX polish fixes discovered during live local full-stack E2E + screenshot inspection in `frontend/src/main.jsx`: skip saving `nova_scroll_v2:login` on signed-out login screen, and place `CourseDetail`'s `← Back` button on its own block line above the course eyebrow.
