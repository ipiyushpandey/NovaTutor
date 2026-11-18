# NovaTutor v2.5 — Final Independent Verification Report (Read-Only)

**Verification Date:** 2026-11-18  
**Branch Verified:** `remediation/v2.5-audit-fixes`  
**Verified HEAD:** `d3020d4` (`d3020d487ff1fad92e83b908cfff30a057e01248`)  
**Comparison Bases:** `40999f0` (`stabilization/v2.4-security-reliability`) & `e6a0034` (`baseline/pre-stabilization-e6a0034`)  
**Verification Mode:** Strictly Read-Only (zero source edits, zero commits, zero branch/push/deploy/production changes)

---

## Final Decision

### **B. READY ONLY AFTER SPECIFIC FIXES**

The remediation branch `remediation/v2.5-audit-fixes` (`d3020d4`) makes substantial, well-structured progress across both CRITICAL security findings (`CRITICAL-SEC-01`, `CRITICAL-SEC-02`), hidden DSA test isolation (`HIGH-SEC-01`), concurrency/reconciliation (`HIGH-DB-01`), Course Back/LearningStudio/dark-toast UX (`HIGH-FE-03`, `HIGH-FE-04`, `HIGH-FE-05`, `HIGH-FE-08`), and local full-stack E2E validation.

**However, independent source-code inspection uncovered concrete newly introduced regressions and incomplete high-severity fixes** that must be corrected and covered by regression tests before merge review or production deployment.

---

## 1. Repository State, Diff Scope & Artifact Verification

- **Current Branch:** `remediation/v2.5-audit-fixes`
- **Current HEAD:** `d3020d4` (matches expected `d3020d4`)
- **Working Tree Before Writing This Report:** Clean (zero staged/unstaged/untracked changes)
- **Diff vs `40999f0` (`stabilization/v2.4-security-reliability`):** `62 files changed, 2758 insertions(+), 538 deletions(-)`
- **Diff vs `e6a0034` (`baseline/pre-stabilization-e6a0034`):** `102 files changed, 6285 insertions(+), 1120 deletions(-)`
- **Browser Evidence & Screenshots Verified on Disk:**
  - Production read-only baseline (`scratch/prod_screenshots/`): **7 PNGs + `prod_baseline.json`** (`prod_about_1280.png`, `prod_login_1280_dark.png`, `prod_login_1280_light.png`, `prod_login_1920.png`, `prod_login_320.png`, `prod_login_390.png`, `prod_login_768.png`).
  - Local full-stack E2E (`scratch/local_e2e_screenshots/`): **6 PNGs** (`local_admin_1280.png`, `local_course_1280.png`, `local_dark_1280.png`, `local_dashboard_1280.png`, `local_dsa_1280.png`, `local_mobile_390.png`).

---

## 2. Independent Test Suite Re-Execution Results

All test suites were independently re-executed on `d3020d4` without modifying code:

| Suite | Command & Environment | Result | Notes |
|---|---|---|---|
| **Backend Maven Suite** | `mvn -o -B test` (Java 21, H2 `MODE=MySQL`, `ddl-auto: create-drop`) | **107 / 107 PASS** (`0` fail, `0` skip; `9.83s`) | Does not execute `V2026_11_18__stabilization_v25.sql`, TiDB `ddl-auto: validate`, live Gemini, or live Docker. |
| **Frontend Unit Tests** | `npm test` (Node `v24.19.0`, `node --test "src/lib/*.test.mjs"`) | **18 / 18 PASS** (`1.04s`) | Covers `aiText.js`, `api.js`, `apiStream`, and regex source invariants. |
| **Frontend Prod Build** | `npm run build` (Vite `5.4.19`) | **PASS** (`1.51s`, `0` errors) | Advisory 500 kB chunk warning & `lottie-web` `eval` warning unchanged. |
| **Playwright Full Run (`desktop` + `mobile`)** | `E2E_BASE_URL=http://127.0.0.1:5173 E2E_ADMIN_EMAIL=admin@novatutor.test E2E_ADMIN_PASSWORD=... npx playwright test --project=desktop --project=mobile` against live local Spring Boot H2 + Vite | **42 PASS, 4 SKIP, 4 FAIL** (`2.3m`) | `stabilization.spec.js`: **20 / 20 PASS** (10 desktop + 10 mobile). `e2e.spec.js`: **22 PASS, 4 SKIP, 4 FAIL** (see Section 5 for exact failure & skip analysis). |

---

## 3. Newly Introduced Regressions & Must-Fix Blockers Before Merge

These concrete defects were verified directly in `d3020d4` source code and must be resolved before merge:

| Priority | Area | Exact File & Line(s) | Concrete Defect |
|---|---|---|---|
| **P0 (New Regression)** | `MEDIUM-SEC-04` / `MEDIUM-SEC-05` | `render.yaml:111`, `deploy/nginx.conf:11`, `frontend/index.html:19`, `frontend/src/main.jsx:1267,1319` | Production CSP header emits `script-src 'self' https://accounts.google.com/gsi/client` (no `'sha256-...'` hash, no `'unsafe-inline'`). In production (Render / Nginx), browsers will **block `frontend/index.html:19`** (dark-mode pre-hydration inline `<script>`, causing dark-mode flash + CSP error on every page load) AND **block inline `<script>` inside `CourseDppIde`'s `srcdoc` HTML preview** (because `srcdoc` iframes enforce the intersection of parent CSP and child `<meta>` CSP). Missed by local Playwright because Vite dev server does not emit `render.yaml` / `nginx.conf` headers. |
| **P0 (New Regression)** | `HIGH-DB-02` | `backend/src/main/java/com/aitutor/intelligence/AdaptiveController.java:109-115`, `QuizAttempt.java:16`, `QuizAttemptRepository.java:11`, `application.yml:11` | Removing `@Transactional` from `AdaptiveController.aiQuestion()` while `spring.jpa.open-in-view: false` and `QuizAttempt.course` is `FetchType.LAZY` without `JOIN FETCH` / `@EntityGraph` causes `a.getCourse().getTitle()` (`line 114`) to throw **`org.hibernate.LazyInitializationException` -> HTTP 500** for every student who has ≥1 `QuizAttempt`. |
| **P1 (New Regression)** | `HIGH-DSA-03` | `backend/src/main/java/com/aitutor/controller/SandboxExecutionService.java:257, 260, 261, 262` | `sh -lc` invokes a login shell, which executes `/etc/profile` inside `golang:1.24-alpine` and `eclipse-temurin:21-jdk`, overwriting `PATH` and dropping `/usr/local/go/bin` and `/opt/java/openjdk/bin` -> `go: not found` / `javac: not found` -> exit 99 (`COMPILE_ERROR`) on every local Docker Java/Go run. Must use `sh -c`. |
| **P1 (New Regression)** | `NEW-20` | `deploy/docker-compose.prod.yml:58` vs `application-prod.yml:116` | `TRUSTED_PROXY_REGEX: ${TRUSTED_PROXY_REGEX:-}` passes empty string `""` into the backend container when unset, overriding `application-prod.yml:116`'s RFC1918 default regex with `""` and disabling Tomcat `RemoteIpValve` behind Nginx (collapsing all users into a single IP rate-limit bucket). |
| **P1 (New/Remaining Bug)** | `HIGH-AI-01` | `backend/src/main/java/com/aitutor/controller/AiController.java:99-102`, `MentorController.java:103-106`, `GlobalExceptionHandler.java:19-22`, `frontend/src/lib/api.js:143` | Real frontend `apiStream` sends `Accept: text/event-stream`, while `GlobalExceptionHandler.apiException` returns `ResponseEntity<Map<String,String>>` without explicit JSON/SSE media handling -> Spring MVC throws `HttpMediaTypeNotAcceptableException` (**HTTP 406 Not Acceptable**) instead of HTTP 503 JSON on pool exhaustion (or 400 on null task). |
| **P1 (Incomplete Fix)** | `HIGH-FE-02` | `frontend/src/main.jsx:607-612` vs `frontend/src/persistence/workspaceStore.js:10,20` | Guest logout filter checks `k.startsWith('nova_workspace_' + idStr)` instead of the actual prefix **`nova_workspace_v1_${idStr}_`**, leaking all non-transient guest workspace keys in `localStorage`. Also misses `nova_quiz_seen_${id}_*`, `nova_today_done_${id}_*`, `nova_challenge_seen_${id}_*`, and `nova_module_state_${id}_*`. |
| **P1 (Incomplete Fix)** | `HIGH-FE-07` | `frontend/src/dsa.jsx:213-246` | Direct-link `#/dsa/:slug` async `saved` restore has two remaining bugs: (1) `/starter?language=java` resolves after `/dsa/progress` and overwrites `saved.lastCode` with Java starter while dropdown stays on Python (`userEditedRef.current` stays `false`); (2) when a localStorage draft exists for `savedLang`, `if (draft === null)` is false so `setLang(savedLang)` never runs and editor stays stuck on `java`. |
| **P1 (Missed Security Leak)** | `MEDIUM-SEC-01` | `backend/src/main/java/com/aitutor/intelligence/AdaptiveController.java:154-171` | `POST /api/adaptive/{userId}/shown` fetches `questions.findById(qid)` without checking `q.getCourse().isPublished()`, writing unpublished draft course titles into `learning_events` (exposed back via `/api/intelligence/{id}` & `/api/nova-brain/{id}`), and accepts unbounded un-deduplicated lists (table spam). |
| **P1 (Incomplete Fix)** | `MEDIUM-SEC-02` | `AdaptiveController.java:173-183`, `IntelligenceController.java:32-47, 127` | Unlimited XP farming remains open via `POST /api/adaptive/{uid}/revision-complete` (25 XP/req, arbitrary client `subject`/`topic`, no daily cap) and `POST /api/intelligence/{uid}/events` with `type="DPP_COMPLETED"` (35 XP/req, omitted from the 6/day study-sprint cap); plus the 6/day study-sprint count uses `findTop200` (evictable via 200 `shown` events). |
| **P2 (Operational / Edge Bugs)** | `NEW-20`, `REG-09`, `HIGH-FE-06`, `CRITICAL-SEC-01/02`, `HIGH-DSA-01` | Multiple (see Section 4) | (1) `deploy/fill-secrets.command:16, 130` aborts under `set -euo pipefail` if `CORS_ORIGINS=` is absent in an existing `secrets.env`; (2) `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md:44` falsely claims lossless rollback to `e6a0034` despite `MEDIUMTEXT` vs `TEXT` `ddl-auto: validate` incompatibility (and line 9 cites old branch name, duplicate step `3.`); (3) `frontend/src/lib/api.js:205` retains `\|\| data==='done'`, dropping bare LLM `"done"` tokens; (4) `ProductionConfigValidator.java:72` misses `framework` when `trustProxy=false`; (5) `DsaLang.java:696` missing `+` breaks multi-char Go import aliases; (6) `DataSeeder.java:192-216` `ensureQuizExpansion` duplicates rows on mid-seed crash; (7) `EmailVerificationService.java:36, 79-82` `MAX_PENDING_PER_EMAIL=5` permits 24h registration lockout DoS. |

---

## 4. Complete Finding-by-Finding Independent Verification Matrix (All 14 Groups)

### Group 1 — `CRITICAL-SEC-01` (`X-Forwarded-For` Spoofing / Proxy & Filter Conflict)
- **Original Finding ID:** `CRITICAL-SEC-01` (`NEW-01`)
- **Relevant Source Files & Lines:** `backend/src/main/resources/application-prod.yml:102-116`, `RequestRateLimitFilter.java:200-244`, `SecurityConfig.java:85-107`, `ProductionConfigValidator.java:72-75`
- **Fix Verified:** **PARTIAL**
- **Regression Test Verified:** **YES** *(unit-level only: `ProductionConfigValidatorTest.rejectsFrameworkForwardHeadersWhenTrustProxyIsEnabled:64-71`, `SecurityRemediationTest.rateLimitFilterIgnoresSpoofedXRealIpAndPrependedForwardedFor:328-347`, `SecurityRemediationTest.rateLimitFilterIgnoresXForwardedForWhenDirectPeerIsNotTrustedProxy:350-367`)*
- **Remaining Risk:**
  1. `ProductionConfigValidator.java:72` checks `if (trustProxy && "framework".equalsIgnoreCase(...))` — misses `forward-headers-strategy: framework` when `trustProxy=false` (where `ForwardedHeaderFilter` still rewrites `getRemoteAddr()` to spoofable leftmost XFF).
  2. Render/Cloudflare multi-hop public edge IPs may collapse users sharing a Cloudflare PoP into one rate-limit bucket if `TRUSTED_PROXY_REGEX` only matches RFC1918; `RequestRateLimitFilter.isTrustedProxy()` (`lines 225-244`) hardcodes RFC1918/loopback (ignores `TRUSTED_PROXY_REGEX` and IPv4-mapped IPv6 `::ffff:10.x.x.x`).
  3. `RequestRateLimitFilter.java:207` reads `getHeader("X-Forwarded-For")` (first header only) instead of merging `getHeaders(...)`.
- **Evidence:** Traced `native` + Tomcat `RemoteIpValve` (`application-prod.yml:107, 113-116`) + `RequestRateLimitFilter.resolveClientAddress` (`lines 204-223`): once `RemoteIpValve` resolves the client's public IP into `remoteAddr`, `isTrustedProxy(remoteAddr)` returns `false`, so spoofed prepended XFF values are ignored. `SecurityConfig.java:85-107` disables double Servlet registration (confirmed in Tomcat boot logs).

### Group 2 — `CRITICAL-SEC-02` (Pre-Registration Account Takeover & Auth Hardening)
- **Original Finding ID:** `CRITICAL-SEC-02` (`NEW-02`)
- **Relevant Source Files & Lines:** `PendingRegistration.java:13-70`, `PendingRegistrationRepository.java:11-21`, `EmailVerificationService.java:36, 72-197, 224-241`, `AuthService.java:57-137, 183-254`, `AuthController.java:52-98, 125, 155, 168-209`, `JwtService.java:63, 71-81, 98-106`
- **Fix Verified:** **YES** *(core Path A & Path B takeover vectors, login enumeration, forgot-password cooldown/guest skip, and `pwf` JWT revocation all fixed)*
- **Regression Test Verified:** **YES** *(`AuthServiceTest:54-97`, `EmailVerificationServiceTest:124-199`, `SecurityRemediationTest:133-154, 370-398`; minor gap: `AuthServiceTest.setUp()` uses the 4-arg constructor leaving `pendingRegistrations == null`, so `googleLogin` deleting pending rows is untested)*
- **Remaining Risk:**
  1. `MAX_PENDING_PER_EMAIL = 5` (`EmailVerificationService.java:36, 79-82`) allows an attacker to POST `/api/auth/register` 5 times for a victim email and block legitimate registration/resend for 24 hours.
  2. Concurrent `verify()` / `googleLogin()` tie on unique `users.email` (`AuthService.java:79-99, 247-251`) is uncaught (`400` constraint error).
  3. Production boot with `JPA_DDL_AUTO=validate` requires executing `V2026_11_18__stabilization_v25.sql` first.
- **Evidence:** `PendingRegistration` binds each verification token hash (`uk_pending_reg_token_hash`) to its own `(email, name, passwordHash)` without touching `users`; `resendVerification` (`lines 137-140`) suppresses delivery if `active.size() > 1`; `googleLogin` (`lines 206, 228-240, 252`) purges pending rows and rotates password/clears tokens on legacy unverified `User` rows; `AuthService.login` (`lines 122-134`) verifies password before checking blocked/disabled/unverified.

### Group 3 — `HIGH-SEC-01` (Hidden DSA Test Case Exfiltration)
- **Original Finding ID:** `HIGH-SEC-01` (`NEW-03`)
- **Relevant Source Files & Lines:** `DsaJudgeService.java:79-242`, `DsaController.java:103-126`
- **Fix Verified:** **YES**
- **Regression Test Verified:** **YES** *(`SecurityRemediationTest.hiddenDsaTestCasesAreRedactedInJudgeResults:285-325`, `SecurityRemediationTest.hiddenDsaTestsRunInSeparateSandboxExecutionAndSuppressStderrExfiltration:401-437`)*
- **Remaining Risk:** None security-wise (minor latency note: 2 sandbox runs per submit).
- **Evidence:** `DsaJudgeService` runs sample tests (`lines 108-132`) and hidden tests (`lines 134-159`) in separate `sandbox.execute()` calls, passing `exposeStderr = false` (`line 149`). Hidden compile/runtime/TLE/MLE errors return only static generic messages (`lines 154-157, 219-238`), and `TestResult` fields (`input`, `expected`, `actual`) are empty strings for hidden cases (`lines 178-194`), double-enforced in `DsaController.runToMap` (`lines 106-114`).

### Group 4 — `HIGH-SEC-02` (Pre-Auth Flood, `/api/code/analyze` Bucket, Prod Quotas, Guest Cap)
- **Original Finding ID:** `HIGH-SEC-02` (`NEW-04`)
- **Relevant Source Files & Lines:** `PreAuthRateLimitFilter.java:24-87`, `RequestRateLimitFilter.java:139, 157-163`, `SecurityConfig.java:77-107, 149-151`, `GuestService.java:46-97`, `UserDataCleanupService.java:59-72`, `UserRepository.java:12-19`, `application-prod.yml:33-44`
- **Fix Verified:** **PARTIAL**
- **Regression Test Verified:** **YES** *(unit-level: `SecurityRemediationTest.preAuthRateLimitBlocksIpFloodAndCodeAnalyzeUsesAiBucketAndGuestCapEnforced:440-481`; no MockMvc filter-order integration test)*
- **Remaining Risk:** Unsynchronized TOCTOU race in `GuestService.create()` (`lines 56-72`): concurrent `POST /api/auth/guest` calls near capacity (`maxActiveGuests = 200`) span ~100ms BCrypt hashing before `users.save(u)`, allowing cap overshoot and concurrent duplicate `purgeExpired()` sweeps.
- **Evidence:** Filter chain order `PreAuthRateLimitFilter -> JwtAuthenticationFilter -> RequestRateLimitFilter` (`SecurityConfig.java:149-151`); bounded LRU map (`MAX_ENTRIES = 10_000`); `/api/code/analyze` routed to `ai` bucket (`RequestRateLimitFilter.java:157-159`); prod quotas tightened (`application-prod.yml:34-44`); `GuestService.purgeExpired()` delegates per-user cleanup to `@Transactional` `UserDataCleanupService.deleteUserAndData`.

### Group 5 — `MEDIUM-SEC-01` (Draft Course Isolation / Guest Role) & `MEDIUM-SEC-02` (XP Farming)
- **Original Finding IDs:** `MEDIUM-SEC-01` (`NEW-21`), `MEDIUM-SEC-02` (`NEW-22`)
- **Relevant Source Files & Lines:** `AuthenticatedUser.java:32-42`, `QuizController.java:28-33, 53-59, 100-128`, `MentorController.java:54-71`, `DppController.java:22-25`, `ProgressController.java:21-29`, `LearningRecommendationController.java:29-36`, `AdaptiveController.java:93, 115, 137-143, 154-183, 196-249`, `IntelligenceController.java:26-48, 123-133`, `AdminController.java:138-142, 203-210`
- **Fix Verified:** **PARTIAL** *(both `MEDIUM-SEC-01` and `MEDIUM-SEC-02`)*
- **Regression Test Verified:** **PARTIAL** *(`SecurityRemediationTest:484-525` tests only `/quizzes/course/{draftId}`, `/dpp/generate`, `PATCH /admin/users/{guestId}/role`, and `questionId: -999999`; zero tests for `MentorController`/`ProgressController`/`AdaptiveController` draft checks, AI question single-use consumption, `revision-complete`, or `IntelligenceController` caps)*
- **Remaining Risk:**
  1. **`AdaptiveController.shown()` (`lines 154-171`) leaks draft course titles** via `questions.findById(qid)` without checking `q.getCourse().isPublished()` and writes unbounded `learning_events` rows.
  2. **Unlimited XP farming remains live** via `POST /api/adaptive/{uid}/revision-complete` (`lines 173-183`, 25 XP/req, arbitrary `subject`/`topic`) and `POST /api/intelligence/{uid}/events` with `type="DPP_COMPLETED"` (`lines 32-47, 127`, 35 XP/req, excluded from 6/day cap).
  3. Study-sprint 6/day cap (`IntelligenceController.java:35-41`) reads `findTop200` (evictable by posting 200 other events).
  4. `AdminController.overview()` (`lines 138-142`) still counts `GUEST` rows via `users.count()`; `ADMIN`/`OWNER` role check drift persists across `SecurityConfig` vs `AuthenticatedUser`.
- **Evidence:** Direct inspection of `AdaptiveController.java:154-183` and `IntelligenceController.java:32-47, 127`.

### Group 6 — `MEDIUM-SEC-04` (Headers / `permitAll` / Error Scrubbing) & `MEDIUM-SEC-05` (Course IDE Sandbox + CSP)
- **Original Finding IDs:** `MEDIUM-SEC-04` (`NEW-24`), `MEDIUM-SEC-05`
- **Relevant Source Files & Lines:** `SecurityConfig.java:119-137`, `render.yaml:96-111`, `deploy/nginx.conf:7-12`, `GeminiProvider.java:105-135, 328-335`, `GlobalExceptionHandler.java:38-43`, `frontend/index.html:19`, `frontend/src/main.jsx:1252-1320`
- **Fix Verified:** `MEDIUM-SEC-04`: **PARTIAL (NEW PROD CSP REGRESSION)**; `MEDIUM-SEC-05`: **YES** *(subject to parent CSP conflict)*
- **Regression Test Verified:** **PARTIAL** *(`SecurityRemediationTest:527-538` asserts 5 backend headers + `DELETE /api/courses/{id}` -> 401; `stabilization.spec.js:382-421` verifies iframe `ISOLATED:SecurityError` + `allow=""` + no `htmlPreview` persistence. Missing: `SecurityConfigTest` untouched, zero tests for `GeminiProvider` redaction or `GlobalExceptionHandler` scrubbing, no Playwright test for outbound `fetch()` CSP block inside iframe)*
- **Remaining Risk:**
  1. **NEW PRODUCTION REGRESSION:** `render.yaml:111` & `deploy/nginx.conf:11` emit `script-src 'self' https://accounts.google.com/gsi/client`, which in production will block `frontend/index.html:19` inline theme script AND block inline `<script>` inside `CourseDppIde`'s `srcdoc` HTML preview.
  2. Frontend HSTS missing from `render.yaml` and `deploy/nginx.conf`; `render.yaml:111` hardcodes `https://novatutor-api.onrender.com` in `connect-src`.
- **Evidence:** Direct inspection of `render.yaml:111`, `deploy/nginx.conf:11`, `frontend/index.html:19`, `frontend/src/main.jsx:1256, 1267, 1319`.

### Group 7 — `HIGH-DB-01`, `HIGH-DB-02`, `HIGH-DB-03` (Concurrency, Transactions, Reconciliation, Seeder)
- **Original Finding IDs:** `HIGH-DB-01`, `HIGH-DB-02`, `HIGH-DB-03`
- **Relevant Source Files & Lines:** `Progress.java:3-4`, `ProgressController.java:21-56`, `ProgressRepository.java:15-32`, `LearningEventService.java:32-87`, `AdminController.java:436-488`, `ConversationRepository.java:1`, `QuizQuestionRepository.java:6-8`, `AdaptiveController.java:109-144`, `QuizAttempt.java:16`, `QuizAttemptRepository.java:11`, `DataSeeder.java:108-216`
- **Fix Verified:**
  - `HIGH-DB-01`: **YES** (`Progress` unique constraint verified; `INSERT IGNORE` + `PESSIMISTIC_WRITE` + `reconcileCourseProgress` + `@Modifying` flush/clear verified; minor `AdminController.audit()` rollback-poisoning risk remains).
  - `HIGH-DB-02`: **NO (NEW HTTP 500 REGRESSION!)** — removing `@Transactional` from `AdaptiveController.aiQuestion()` without `JOIN FETCH` on `QuizAttemptRepository.findTop200ByUserIdOrderBySubmittedAtDesc` crashes with `LazyInitializationException` at `AdaptiveController.java:114` for any user with ≥1 `QuizAttempt`.
  - `HIGH-DB-03`: **PARTIAL** (`progress.saveAll` and curriculum/base-quiz per-course guards fixed, but `ensureQuizExpansion` `lines 192-216` still duplicates rows on mid-seed crash and `DataSeeder` remains non-transactional).
- **Regression Test Verified:** `HIGH-DB-01`: **PARTIAL** (`Wave2BackendFunctionalTest:133-222` tests same-lesson 6-thread race & `deleteLesson` reconciliation; lacks distinct-lesson concurrency test & `dedupeKey > 180` test). `HIGH-DB-02`: **NO**. `HIGH-DB-03`: **NO**.
- **Evidence:** Direct inspection of `AdaptiveController.java:109-115`, `QuizAttempt.java:16`, `application.yml:11`, `DataSeeder.java:192-216`, `ProgressController.java:21-56`.

### Group 8 — `HIGH-AI-01` (SSE Bounded Executors, Cancellation, Null Task, 503 Overflow)
- **Original Finding ID:** `HIGH-AI-01`
- **Relevant Source Files & Lines:** `StreamCancellation.java:14-64`, `AiController.java:27-31, 44-104`, `MentorController.java:35-39, 65-108`, `AiService.java:14-39`, `GeminiProvider.java:105-207`, `GlobalExceptionHandler.java:19-22`, `frontend/src/lib/api.js:143`
- **Fix Verified:** **PARTIAL**
- **Regression Test Verified:** **PARTIAL** *(`Wave2BackendFunctionalTest:225-249` verifies null-task 400 without `Accept: text/event-stream` and `StreamCancellation.attachStream/cancel`; zero test for pool overflow 503, `Accept: text/event-stream` error responses, or stalled-stream thread release)*
- **Remaining Risk:**
  1. Real frontend sends `Accept: text/event-stream` (`api.js:143`); `GlobalExceptionHandler.apiException` returns `ResponseEntity<Map<String,String>>` -> Spring MVC returns **HTTP 406 Not Acceptable** instead of HTTP 503 JSON on pool overflow (or 400 on null task).
  2. `GeminiProvider.java:169-180` checks the 180s deadline only after `readLine()` returns (silent stall waits for the 240s `SseEmitter` timeout before cancelling).
  3. `PromptEngine.build(null)` (`PromptEngine.java:7`) still dereferences `r.task()` if called directly.
- **Evidence:** Bounded `ThreadPoolExecutor(4, 16, 60s, ArrayBlockingQueue(32), AbortPolicy)` + `StreamCancellation` closing `HttpResponse<InputStream>` verified in `AiController.java:27-31, 69-102`, `MentorController.java:35-39, 80-106`, `GeminiProvider.java:170-171`.

### Group 9 — `HIGH-DB-04` / `NEW-18` (`DsaProblemState.lastCode`, Save Cap, `application-test.yml`)
- **Original Finding IDs:** `HIGH-DB-04`, `NEW-18`
- **Relevant Source Files & Lines:** `DsaProblemState.java:48-49`, `DsaController.java:153-175`, `V2026_11_18__stabilization_v25.sql:21`, `application-test.yml:42-44`
- **Fix Verified:** **YES**
- **Regression Test Verified:** **PARTIAL** *(`Wave2BackendFunctionalTest:252-272` verifies 75k char save -> 200 and 260k char save -> 400 `CODE_TOO_LARGE` on H2; does not verify MySQL/TiDB `ddl-auto: validate`)*
- **Remaining Risk:** `DsaController.saveCode` / `DsaJudgeService.record` remain non-transactional on concurrent first-insert for `(user_id, slug)`.
- **Evidence:** `DsaProblemState.java:48` (`MEDIUMTEXT`), `DsaController.java:160-162` (250k cap), `application-test.yml:42-44` (`ai.gemini.api-key: ""`).

### Group 10 — `HIGH-DSA-01`, `HIGH-DSA-02`, `HIGH-DSA-03` (Go/C/Java Harnesses & Docker Sandbox)
- **Original Finding IDs:** `HIGH-DSA-01`, `HIGH-DSA-02`, `HIGH-DSA-03`
- **Relevant Source Files & Lines:** `DsaLang.java:238-250, 529-558, 578-588, 660-715`, `SandboxExecutionService.java:55-135, 186-265`
- **Fix Verified:** `HIGH-DSA-01`: **YES** *(minor multi-char alias regex bug)*; `HIGH-DSA-02`: **YES**; `HIGH-DSA-03`: **PARTIAL (JAVA & GO BROKEN BY `sh -lc`)**
- **Regression Test Verified:** `HIGH-DSA-01`: **YES** (string-level, `DsaLangHarnessTest:121-147, 158-164`); `HIGH-DSA-02`: **PARTIAL** (string-level, `DsaLangHarnessTest:150-155`); `HIGH-DSA-03`: **PARTIAL** (`Wave2BackendFunctionalTest:274-281` inspects only Go command array; zero test for Java/C/C++, interrupt kill, exit 99 -> `COMPILE_ERROR`, or live Docker execution).
- **Remaining Risk:**
  1. **Local Docker Java & Go broken:** `SandboxExecutionService.java:257, 260, 261, 262` use `sh -lc`, which resets `PATH` via `/etc/profile` in `golang:1.24-alpine` and `eclipse-temurin:21-jdk` (`go: not found` / `javac: not found` -> exit 99 `COMPILE_ERROR`).
  2. `DsaLang.java:696`: `[A-Za-z0-9_.]` missing `+` breaks multi-char Go import aliases (`import str "strings"`).
  3. `SandboxExecutionService.java:253`: `--tmpfs /tmp:rw,nosuid,size=64m` omits explicit `mode=1777`; `docker pull` preflight (`lines 226-235`) waits before draining stdout/stderr (pipe deadlock risk).
- **Evidence:** Direct inspection of `SandboxExecutionService.java:245-265` and `DsaLang.java:529-588, 660-715`.

### Group 11 — `NEW-20` & `REG-09` (DevOps Scripts, Docker Compose, Nginx & Docs)
- **Original Finding IDs:** `NEW-20`, `REG-09`
- **Relevant Source Files & Lines:** `deploy/fill-secrets.command:10, 16, 129-145`, `deploy/docker-compose.prod.yml:23-65`, `deploy/nginx.conf:6-26`, `application-prod.yml:10-27, 102-117`, `06_PERFORMANCE_AND_RENDER_RELIABILITY_REPORT.md:9`, `08_DEPLOYMENT_AND_ROLLBACK_PLAN.md:9, 13-24, 28-35, 44`
- **Fix Verified:** **PARTIAL** *(both `NEW-20` and `REG-09`)*
- **Regression Test Verified:** **NO**
- **Remaining Risk:**
  1. `deploy/docker-compose.prod.yml:58`: `TRUSTED_PROXY_REGEX: ${TRUSTED_PROXY_REGEX:-}` exports `""` and disables Tomcat `RemoteIpValve` behind Nginx.
  2. `deploy/docker-compose.prod.yml:33`: defaults `JPA_DDL_AUTO: ${JPA_DDL_AUTO:-validate}`, breaking fresh `docker compose up` on an empty MySQL volume unless overridden.
  3. `deploy/fill-secrets.command:10, 16, 130`: `current()` runs `grep` without `|| true` under `set -euo pipefail`, aborting if an existing `secrets.env` lacks a `CORS_ORIGINS=` line.
  4. `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md:44` falsely claims lossless rollback to `e6a0034` despite `MEDIUMTEXT` vs `TEXT` `validate` failure; line 9 cites `stabilization/v2.4-security-reliability`; lines 33–34 have duplicate step `3.`.
- **Evidence:** Direct inspection of `deploy/docker-compose.prod.yml:33, 58`, `deploy/fill-secrets.command:10, 16, 130`, `08_DEPLOYMENT_AND_ROLLBACK_PLAN.md:9, 33-34, 44`.

### Group 12 — `HIGH-FE-01` & `HIGH-FE-02` (Unmount Flush Race & Cross-User/Guest Isolation)
- **Original Finding IDs:** `HIGH-FE-01` (`NEW-05`), `HIGH-FE-02` (`NEW-06`)
- **Relevant Source Files & Lines:** `frontend/src/main.jsx:100-154, 587-630, 677-680, 895-898`, `frontend/src/persistence/workspaceStore.js:10, 19-23`
- **Fix Verified:** `HIGH-FE-01`: **YES**; `HIGH-FE-02`: **PARTIAL**
- **Regression Test Verified:** `HIGH-FE-01`: **NO** (`Pass 2C` logs out from `#/dashboard`, which does not mount `useModulePersistence`); `HIGH-FE-02`: **PARTIAL** (`stabilization.spec.js:442-480` tests 6 unscoped keys + `nova_scroll_v2:*` on student logout, but has no Guest logout or Switch Account User A -> User B test).
- **Remaining Risk:**
  1. **Guest `localStorage` cleanup prefix typo (`main.jsx:610`):** checks `nova_workspace_${idStr}` instead of `nova_workspace_v1_${idStr}_`, permanently leaking all non-transient guest workspace keys plus `nova_quiz_seen_${id}_*`, `nova_today_done_${id}_*`, `nova_challenge_seen_${id}_*`, `nova_module_state_${id}_*`.
  2. In-flight `/courses` response (`main.jsx:678`) lacks a `readUser()` check before writing `nova_courses_cache`.
- **Evidence:** `workspaceStore.js:10,20` (`WORKSPACE_PREFIX = 'nova_workspace_v1'`) vs `main.jsx:607-612`.

### Group 13 — `HIGH-FE-03` .. `HIGH-FE-08` (Routing, Scroll, SSE, DSA Sync, Dark Toast Contrast)
- **Original Finding IDs:** `HIGH-FE-03` (`NEW-07`), `HIGH-FE-04` (`NEW-08`), `HIGH-FE-05` (`NEW-09`), `HIGH-FE-06` (`NEW-12`), `HIGH-FE-07` (`NEW-13`), `HIGH-FE-08` (`NEW-11`), plus Frontend Medium #1, #4, #5, #8, #11
- **Relevant Source Files & Lines:** `frontend/src/main.jsx:544-555, 574-581, 637, 726-879, 908, 1515-1574, 1621-1664, 1704-1764, 1945-1951`, `frontend/src/lib/api.js:28-54, 70-71, 98-118, 155-225`, `frontend/src/dsa.jsx:68, 78-91, 191-266, 367-371`, `frontend/src/styles.css:2883`
- **Fix Verified:**
  - `HIGH-FE-03` (Course Back reset + Back button): **YES** — Regression test: **YES** (`stabilization.spec.js:267-320`).
  - `HIGH-FE-04` (`LearningStudio` `#/voice` + `launchTeacher` override): **YES** — Regression test: **PARTIAL** (`stabilization.spec.js:482-496`; lacks `#/learning-studio/voice` reload/Back & auto-ask assertions).
  - `HIGH-FE-05` (Scroll lock on invalid hash, `scrollRestoration='manual'`, `ResizeObserver` rAF cancel, `keydown`/`pointerdown`, `location.replace`): **YES** — Regression test: **NO**.
  - `HIGH-FE-06` (WHATWG SSE + non-session 401 + `/auth/me` transient error + 45s GET retry): **PARTIAL** — `api.js:205` retains `|| data==='done'` (silently drops bare LLM `"done"` token & falsely sets `sawDone=true`), and `apiStream` ignores `opt.timeoutMs`. Regression test: **YES** for implemented parts (`stabilization.test.mjs:89-190`).
  - `HIGH-FE-07` (DSA async bookmark/code sync, `langSeqRef`, history-loop-free Back): **PARTIAL** — 2 real bugs remain in `dsa.jsx:213-246` (starter-overwrite race and local-draft language-skip bug), plus `p.tags` case-sensitive search (`dsa.jsx:68`) and `Tab` trap (`dsa.jsx:371`). Regression test: **NO**.
  - `HIGH-FE-08` (Dark-mode `.nv-toast` contrast): **YES** — Regression test: **YES** (`stabilization.test.mjs:211`, `stabilization.spec.js:423-440`).
  - Medium #1 (`AiPanel` `askRef`/`prefillTimerRef`), #5 (`PrepareHub` props), #11 (`TopNav` Escape): **YES** — Regression tests: **NO** (#1, #5), **YES** (#11, `stabilization.spec.js:533-539`).

### Group 14 — Test Coverage Repair, Skipped Tests & Mock Fidelity
- **Original Finding ID:** Test Coverage Gaps (`NEW-10` + audit report `06_TEST_COVERAGE_GAP_ANALYSIS.md`)
- **Relevant Source Files & Lines:** `frontend/tests/e2e.spec.js:36-43, 111, 135-167, 183, 194, 210-217, 240-312`, `frontend/tests/stabilization.spec.js:119-218, 267-555`, `frontend/src/lib/stabilization.test.mjs:75-219`
- **Fix Verified:** **PARTIAL**
- **Regression Test Verified:** **PARTIAL**
- **Evidence & Findings:** See Section 5 below.

---

## 5. SQL Migration Safety & Skipped-Test Analysis

### A. Complete Audit of `database/migrations/V2026_11_18__stabilization_v25.sql`
- **Column & Type Parity with Hibernate 6 `ddl-auto: validate`:** **VERIFIED** for `PendingRegistration.java:13-42` (`pending_registrations`: `id`, `email`, `name`, `password_hash`, `token_hash` unique, `expires_at`, `sent_at`, `created_at`) and `DsaProblemState.java:48` (`dsa_problem_state.last_code MEDIUMTEXT`). Engine/charset/collation (`InnoDB`, `utf8mb4`, `utf8mb4_unicode_ci`) are TiDB-compatible.
- **Ordering / Idempotency Hazards:**
  1. `CREATE TABLE IF NOT EXISTS pending_registrations` is idempotent on both fresh and existing DBs.
  2. `ALTER TABLE dsa_problem_state MODIFY COLUMN last_code MEDIUMTEXT;` is idempotent on an **existing** DB (metadata-only in TiDB), **but fails if executed on an empty DB** before `dsa_problem_state` exists.
  3. **Rollback Hazard:** Applying line 21 breaks `ddl-auto: validate` if rolling back to `e6a0034` (`columnDefinition = "TEXT"`), directly contradicting `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md:44`.
  4. **Never executed against real MySQL/TiDB** in automated tests (only H2 `ddl-auto: create-drop`).

### B. Do Skipped or Environment-Failing Tests in `e2e.spec.js` Hide Important Regressions?
- **4 Skipped Tests (`2 desktop + 2 mobile`):**
  1. `e2e.spec.js:113-133` (`verified student signs in and reaches the dashboard`) — skipped when `E2E_EMAIL`/`E2E_PASSWORD` unset; hides live student login + `/auth/me` reload checks.
  2. `e2e.spec.js:135-167` (`browser Back restores the previous page and scroll position`) — **unnecessarily skipped!** This test creates its own disposable guest (`POST /api/auth/guest`) and never uses `STUDENT` credentials, yet sits inside `test.skip(!STUDENT.email || !STUDENT.password)`.
  3. *(Note: when `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` are unset in CI, 3 additional tests skip — including the repaired `NEW-10` Desktop TopNav test at `e2e.spec.js:211-215`!)*
- **4 Local-Environment Failures Observed in Independent Re-Run (`2 desktop + 2 mobile`):**
  1. `e2e.spec.js:36-43` (`forgot-password flow`, desktop + mobile): fails because local `application-test.yml` has no SMTP (`emailDeliveryConfigured=false`), so `Auth` intentionally disables the submit button as `"Email delivery unavailable"`. **Does not hide an app bug**, though live SMTP forgot-password UI remains unverified locally.
  2. `e2e.spec.js:240-312` (`admin workspace stays within supported widths without false vertical scroll`, desktop + mobile): desktop failed with `excess blank tail at 1280px: 224` (expected `< 200`, because a fresh 1-user/2-audit-row H2 Admin Dashboard is shorter than the `900px` `min-height: 100vh` shell) and mobile failed `maxScroll > 0` (`Received: 0`, because 1 user fits inside `740px`). **Environmental data-volume mismatch, not an overflow regression** — all width overflow checks (`320..1440`) passed cleanly.
- **Mock Schema Mismatches Still Masking Real UI Rendering in `stabilization.spec.js`:**
  - `/admin/dashboard` mock (`lines 167-180`) returns `totalUsers`/`totalCourses`/`totalLessons` instead of `users`/`activeUsers`/`courses`/`publishedCourses`/`lessons`/`questions`/`attempts`/`auditEvents` (`AdminControlCenter.jsx:158`), plus `/admin/ai/usage` and `/admin/sandbox/usage` schemas mismatch -> Admin KPIs render `0` in mocked tests.
  - `/dsa/problems/two-sum` mock (`lines 131-145`) returns `examples`/`visibleTests`/`starters` + array `constraints` instead of `samples`/`signature`/`tags`/`cSupported` + string `constraints`, and `/dsa/progress` omits `two-sum` (masking the two remaining `HIGH-FE-07` bugs!).

---

## 6. Minimum Required Fix List to Reach Decision `A`

Before merging `remediation/v2.5-audit-fixes`:

1. **Fix Production CSP (`render.yaml:111`, `deploy/nginx.conf:11`):** Move `frontend/index.html:19` dark-mode bootstrap into an external script (e.g. `/theme-init.js` under `'self'`) OR add its exact `'sha256-...'` hash, and verify `CourseDppIde` HTML preview script execution under the actual Nginx/Render CSP headers (e.g., dedicated preview policy or blob/document strategy that does not break legitimate HTML/JS previews while keeping parent origin isolated).
2. **Fix `AdaptiveController.aiQuestion()` `LazyInitializationException` (`HIGH-DB-02`):** Add `@EntityGraph(attributePaths = "course")` or `JOIN FETCH a.course` on the `QuizAttemptRepository` query (or fetch the course title inside a tiny read-only helper transaction before calling `aiProvider.generate(...)`), and add a regression test with ≥1 persisted `QuizAttempt`.
3. **Fix `SandboxExecutionService` `sh -lc` -> `sh -c` (`HIGH-DSA-03`):** Change lines `257, 260, 261, 262` from `sh -lc` to `sh -c` and add explicit `mode=1777` to `--tmpfs /tmp:rw,nosuid,mode=1777,size=64m`.
4. **Fix `deploy/docker-compose.prod.yml:58` & `deploy/fill-secrets.command:16` (`NEW-20`) + `08_DEPLOYMENT_AND_ROLLBACK_PLAN.md:9,33-34,44` (`REG-09`):** Remove empty-string override `TRUSTED_PROXY_REGEX: ${TRUSTED_PROXY_REGEX:-}` (or provide the RFC1918 default), add `|| true` in `current()`, and correct the rollback plan's false claim about `e6a0034` schema compatibility under `ddl-auto: validate`.
5. **Fix SSE `Accept: text/event-stream` Error Negotiation (`HIGH-AI-01`):** Return explicit `MediaType.APPLICATION_JSON` (or SSE `event: error`) from `GlobalExceptionHandler` when `Accept: text/event-stream` is sent so pool overflow returns HTTP 503 instead of HTTP 406, and add a MockMvc test with `Accept: text/event-stream`.
6. **Close Remaining Security Leaks (`MEDIUM-SEC-01`, `MEDIUM-SEC-02`, `CRITICAL-SEC-01`):** Enforce `q.getCourse().isPublished()` + list cap in `AdaptiveController.shown()`; enforce real daily caps (using date-bounded count query, not `Top200`) on `revision-complete` and `DPP_COMPLETED`; reject `forward-headers-strategy: framework` in `ProductionConfigValidator` regardless of `trustProxy`.
7. **Fix Frontend Remaining Bugs & Missing Regression Tests (`HIGH-FE-02`, `HIGH-FE-06`, `HIGH-FE-07`, Group 14):**
   - Fix `main.jsx:610` guest cleanup prefix to `nova_workspace_v1_${idStr}_` + include `nova_quiz_seen_`/`nova_today_done_`/`nova_challenge_seen_`/`nova_module_state_`, and guard `main.jsx:678` with `if (!readUser()) return;`.
   - Fix `dsa.jsx:213-246` direct-link async `saved` starter-overwrite race & local-draft language-skip bug.
   - Remove `|| data==='done'` at `api.js:205` (rely on `eventName === 'done'`).
   - Add regression tests for `HIGH-FE-01` (logout from active `useModulePersistence` module), `HIGH-FE-02` (Guest logout + Switch Account), `HIGH-FE-05` (`#/invalid` scroll lock), `HIGH-FE-07` (direct `#/dsa/:slug` async restore), and move `e2e.spec.js:135-167` out of the `STUDENT`-credential skip block.
