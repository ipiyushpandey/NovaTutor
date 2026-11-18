# NovaTutor — Master Remediation Final Report (`v2.5`)

**Remediation Branch:** `remediation/v2.5-audit-fixes`  
**Prior Stabilization Base:** `stabilization/v2.4-security-reliability` (`40999f0`)  
**Original Baseline Tag:** `baseline/pre-stabilization-e6a0034` (`e6a0034`)  
**Audit Source of Truth:** `/Users/piyushpandey/Desktop/NovaTutor_Independent_Audit/` (read-only)  
**Production Deployment Performed:** **NONE** (strictly prohibited by mission rules)

---

## 1. Executive Summary & Honest Merge Verdict

### Final Verdict: **B — READY TO MERGE WITH MANDATORY PRE-DEPLOY MIGRATION & LIVE-DEPENDENCY SMOKE CHECKS**

All **14 mandatory finding groups** identified by the independent adversarial audit — including both **CRITICAL** security blockers (`CRITICAL-SEC-01`, `CRITICAL-SEC-02`), all **HIGH** security/database/AI/DSA/frontend defects, all targeted **MEDIUM** security/operations issues, and the automated test coverage gaps — have been remediated across 9 controlled, independently committed waves on `remediation/v2.5-audit-fixes`.

Every remediation was verified against automated backend suites (`107/107` JUnit/MockMvc tests), frontend unit tests (`18/18` Node tests), Vite production build, Playwright desktop + mobile suites (`20/20` stabilization tests, `22/22` applicable live `e2e.spec.js` tests), and a **13-step real full-stack browser E2E suite** (`live_local_e2e.mjs`) running against a live local Spring Boot + H2 + Vite stack with **zero mocked APIs** and visual screenshot inspection.

### Why Verdict B (and Not Unconditional A)
Per strict engineering honesty rules, four production infrastructure dependencies cannot be proven by local H2/mocked/sandboxed verification alone and require a controlled pre-deploy/staging smoke check:
1. **TiDB Cloud DDL Migration (`database/migrations/V2026_11_18__stabilization_v25.sql`):** Must be executed against TiDB Cloud **before** deploying the new backend image (`spring.jpa.hibernate.ddl-auto: validate` will refuse boot if `pending_registrations` or `dsa_problem_state.last_code MEDIUMTEXT` is missing). Local verification ran on H2 `MODE=MySQL`, not live TiDB Cloud.
2. **Live Gemini Upstream Streaming:** Bounded thread pools, upstream stream close, and exception scrubbing are implemented and verified locally, but live Gemini API streaming was not invoked without a production API key.
3. **Live Docker Sandbox Execution:** `SandboxExecutionService` hardening (`--user 65534:65534`, `:ro` workspace mount, `/tmp` compilation, separated stdout/stderr, `99 -> COMPILE_ERROR`, forced container kill on interrupt) and all 6 language harnesses (`DsaLang`) were verified by unit tests (`DsaLangHarnessTest`, `DsaDatasetAuditTest`), not against a live Docker daemon.
4. **Live Production Authenticated Flows:** Production (`https://novatutor.onrender.com`) was strictly READ-ONLY during this mission; public pages, cold-start timing, and 12-viewport layout were verified live (`docs/stabilization/PRODUCTION_BROWSER_BASELINE.md`), while authenticated production flows remain `UNVERIFIED ON LIVE PRODUCTION`.

---

## 2. Complete Audit Traceability Matrix (All 14 Finding Groups)

| Group | Audit ID(s) | Severity | Root Defect Remediated | Commit | Key Files Modified | Verification Proof |
|---|---|---|---|---|---|---|
| **1** | `CRITICAL-SEC-01` | CRITICAL | `forward-headers-strategy: framework` conflicted with `RequestRateLimitFilter` XFF parsing; servlet filters double-registered (`FilterRegistrationBean`); `ProductionConfigValidator` allowed unsafe proxy config | `4ac8a19` | `application-prod.yml`, `RequestRateLimitFilter.java`, `SecurityConfig.java`, `ProductionConfigValidator.java` | `ProductionConfigValidatorTest`, `SecurityRemediationTest`, live Tomcat boot logs (`disable*AutoRegistration` disabled) |
| **2** | `CRITICAL-SEC-02` | CRITICAL | Pre-registration account takeover via `users` table rows before verification; weak forgot-password cooldown & guest leakage; Google login preserved legacy unverified hashes/tokens; login enumeration before disabled check | `4ac8a19` | `PendingRegistration.java`, `PendingRegistrationRepository.java`, `EmailVerificationService.java`, `AuthService.java`, `AuthController.java`, `V2026_11_18__stabilization_v25.sql` | `EmailVerificationServiceTest` (10), `AuthServiceTest` (14), `live_local_e2e.mjs` Step 2 (`register=202`, unverified `login=401`) |
| **3** | `HIGH-SEC-01` | HIGH | DSA judge executed sample + hidden tests in one sandbox run and leaked hidden test `stderr` / stack traces | `90e03e7` | `DsaJudgeService.java` | `SecurityRemediationTest` (separate sandbox calls + hidden `stderr` scrubbed to generic message) |
| **4** | `HIGH-SEC-02` | HIGH | Unauthenticated floods bypassed rate limit before `JwtAuthenticationFilter`; `/api/code/analyze` misbucketed; unbounded guest account creation; loose prod rate limits | `90e03e7` | `PreAuthRateLimitFilter.java`, `RequestRateLimitFilter.java`, `SecurityConfig.java`, `GuestService.java`, `UserRepository.java`, `application-prod.yml` | `SecurityRemediationTest` (pre-auth throttle, `/api/code/analyze` -> `ai`, active guest cap & isolated purge) |
| **5** | `MEDIUM-SEC-01`, `MEDIUM-SEC-02` | MEDIUM | Unpublished/draft courses leaked across 6 student endpoints; `QuizController.submit` mutated shared `QuizQuestion.topic`; AI adaptive & self-reported study XP farming; admin could promote `GUEST` | `8ecd206` | `AuthenticatedUser.java`, `QuizController.java`, `MentorController.java`, `DppController.java`, `ProgressController.java`, `AdaptiveController.java`, `LearningRecommendationController.java`, `IntelligenceController.java`, `AdminController.java` | `SecurityRemediationTest` + `live_local_e2e.mjs` Step 4 (draft course hidden from `/api/courses`, `/api/quizzes/course/:id` -> 404) |
| **6** | `MEDIUM-SEC-04`, `MEDIUM-SEC-05` | MEDIUM | Missing HTTP security headers (CSP, HSTS, Referrer-Policy, Permissions-Policy); overly broad `permitAll()` verbs; raw upstream/provider errors leaked to clients; Course IDE HTML preview lacked inner CSP & persisted preview flag | `8ecd206` | `SecurityConfig.java`, `render.yaml`, `deploy/nginx.conf`, `GeminiProvider.java`, `GlobalExceptionHandler.java`, `frontend/src/main.jsx` | `SecurityConfigTest`, `live_local_e2e.mjs` Steps 1, 9, 13 (real headers verified, iframe `ISOLATED:SecurityError`, zero Lottie CSP violations) |
| **7** | `HIGH-DB-01`, `HIGH-DB-02`, `HIGH-DB-03` | HIGH | `@Transactional` held DB connection during Gemini call (`AdaptiveController`); concurrent `ProgressController.complete` race & duplicate `LearningEvent` inserts; `AdminController` lesson add/delete drifted `Progress.totalLessons`/`percent`; `DataSeeder` crash/detach/N+1 save bugs | `b30fb4f` | `AdaptiveController.java`, `LearningEventService.java`, `ProgressRepository.java`, `ProgressController.java`, `AdminController.java`, `DataSeeder.java`, `ConversationRepository.java`, `LearningEventRepository.java`, `QuizQuestionRepository.java` | `Wave2BackendFunctionalTest` (6-thread concurrent completion test + delete-lesson reconciliation), `live_local_e2e.mjs` Step 5 |
| **8** | `HIGH-AI-01` | HIGH | Unbounded executor threads in `AiController` and `MentorController`; SSE client disconnect didn't abort upstream Gemini HTTP `InputStream`; missing 180s deadline; null `task` 500; error completion semantics | `b30fb4f` | `StreamCancellation.java`, `AiController.java`, `MentorController.java`, `AiService.java`, `GeminiProvider.java` | `Wave2BackendFunctionalTest` (null task -> 400, bounded pool), `mvn test` (107/107) |
| **9** | `HIGH-DB-04`, `NEW-18` | HIGH / LOW | `DsaProblemState.lastCode` `TEXT` truncation risk & singular table name (`dsa_problem_state`); missing `DsaController.saveCode` size cap; `application-test.yml` key hygiene | `34bebfc` | `DsaProblemState.java`, `DsaController.java`, `V2026_11_18__stabilization_v25.sql`, `application-test.yml` | `mvn test` (107/107), SQL schema audit |
| **10** | `HIGH-DSA-01`, `HIGH-DSA-02`, `HIGH-DSA-03` | HIGH | Go block imports, C `strtok` pipe splitting & matrix row parsing, Java comment-trailing imports & non-final Solution; Docker sandbox ran as root with `:rw` mount, mixed stdout/stderr, leaked orphan containers on interrupt | `34bebfc` | `DsaLang.java`, `SandboxExecutionService.java`, `DsaLangHarnessTest.java` | `DsaLangHarnessTest` (16/16), `DsaDatasetAuditTest` (6/6), `DsaOutputComparisonTest` (6/6) |
| **11** | `NEW-20`, `REG-09` | MEDIUM | `deploy/fill-secrets.command` clobbered `EXISTING_CORS_ORIGINS` & mishandled `@` in MySQL passwords; `docker-compose.prod.yml` missing prod env vars; Nginx/Spring/Multipart timeout & upload limit drift; doc drift | `a902894` | `deploy/fill-secrets.command`, `deploy/docker-compose.prod.yml`, `deploy/nginx.conf`, `application-prod.yml`, `06_PERFORMANCE_AND_RENDER_RELIABILITY_REPORT.md`, `08_DEPLOYMENT_AND_ROLLBACK_PLAN.md` | `bash -n`, `ruby -ryaml`, URL `@`-password parsing test |
| **12** | `HIGH-FE-01`, `HIGH-FE-02` | HIGH | Unmount persistence race re-wrote logged-out user state; logout/switch-account/expiry leaked 12 unscoped `localStorage` keys, `nova_scroll_v2:*` `sessionStorage` keys, and guest runtime state | `a6a5d12` | `frontend/src/main.jsx` | `stabilization.spec.js` Pass 2C (desktop + mobile), `live_local_e2e.mjs` Step 12 (`DELETE /api/auth/guest` 200, zero residual keys) |
| **13** | `HIGH-FE-03..08` | HIGH | Course Back from Lecture 2 stayed stuck on Lecture 2; LearningStudio ignored `#/voice` & let persisted voice tab override Course `launchTeacher`; `ResizeObserver` rAF leak & scroll lock on invalid hash; WHATWG SSE leading-space bug; non-session 401 & `/auth/me` network blip wiped `ai_user`; DSA async bookmark/code sync & Back history loop; `.nv-toast` unreadable in dark mode; TopNav Escape missed mobile sheet | `e27142a`, `be94194` | `frontend/src/main.jsx`, `frontend/src/lib/api.js`, `frontend/src/dsa.jsx`, `frontend/src/styles.css` | `stabilization.test.mjs` (18/18), `stabilization.spec.js` (20/20), `live_local_e2e.mjs` Steps 5–11 |
| **14** | Test Coverage Gaps | HIGH | Broken desktop TopNav assertion in `e2e.spec.js`; wrong `sessionStorage` key, stale Admin/DSA mocks, weak iframe/Course-Back assertions, and missing mobile/isolation/contrast tests in `stabilization.spec.js` & `stabilization.test.mjs` | `be94194` | `frontend/tests/e2e.spec.js`, `frontend/tests/stabilization.spec.js`, `frontend/src/lib/stabilization.test.mjs` | `npm test` (18/18), Playwright `stabilization.spec.js` (20/20), Playwright `e2e.spec.js` (22/22 applicable), `live_local_e2e.mjs` (13/13) |

---

## 3. Known Remaining Limitations & Pre-Existing Constraints (Honest Disclosure)

1. **Out-of-Order Lesson Checkmarks in `CourseDetail`:** The existing `Progress` table stores an aggregate `completedLessons` count rather than a per-lesson completion bitset. The backend (`LearningEvent`) accurately deduplicates every individual `(userId, courseId, lessonId)` completion event, while `CourseDetail` renders lesson checkmarks sequentially (`sequenceFor(l) <= completed`). Preserved intentionally to avoid unrequested schema/API refactoring.
2. **In-Memory Single-Instance Rate Limiting:** `PreAuthRateLimitFilter` and `RequestRateLimitFilter` use bounded in-memory sliding windows sized for Render's single-instance deployment (`numInstances: 1`). Scaling horizontally beyond 1 instance will require Redis-backed rate limiting.
3. **Vite Bundle Chunk Size Warning:** `dist/assets/index-*.js` (`551 kB`, `157 kB` gzip) triggers Vite's default 500 kB advisory warning; route-level code splitting was intentionally deferred to avoid broad architectural refactoring during a stabilization mission.
4. **`lottie-web` Bundler Warning:** `lottie-web` contains an internal `eval` reference for After Effects expressions. Confirmed via live local Chromium run (`live_local_e2e.mjs` Step 13) that `lottie-logo.json` triggers **zero** CSP violations under our strict `Content-Security-Policy` (no `unsafe-eval`).
5. **Local `e2e.spec.js` Environment-Dependent Skips/Assumptions:** Against local H2 without SMTP (`emailDeliveryConfigured=false`), the forgot-password button is intentionally disabled (`"Email delivery unavailable"`), and with only 1–2 seeded users the Admin Users table fits within `740px` without vertical scrolling (`maxScroll === 0`). All 22 environment-applicable assertions in `e2e.spec.js` passed across desktop and mobile.

---

## 4. Mandatory Pre-Deploy Operator Checklist

Before merging and deploying `remediation/v2.5-audit-fixes` to production:

1. **Apply SQL Migration on TiDB Cloud FIRST:**
   Execute `database/migrations/V2026_11_18__stabilization_v25.sql` against the target TiDB Cloud database (creates `pending_registrations`, widens `dsa_problem_state.last_code` to `MEDIUMTEXT`).
2. **Verify Render Environment Variables:**
   Confirm `APP_RATE_LIMIT_TRUST_PROXY=true`, `SPRING_PROFILES_ACTIVE=prod`, `JWT_SECRET` (≥64 bytes), `GEMINI_API_KEY`, `APP_CORS_ALLOWED_ORIGINS`, and SMTP settings are populated.
3. **Deploy Backend & Verify Startup:**
   Confirm `ddl-auto: validate` passes, `ProductionConfigValidator` passes, and `/api/health` returns HTTP 200 with `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Permissions-Policy`.
4. **Deploy Frontend & Run Staging/Prod Smoke Checks:**
   Smoke-test: (a) authenticated login + `/auth/me` once, (b) live Gemini streaming response + client abort, (c) live Docker sandbox execution (if enabled) across Java/Python/C/Go, and (d) registration + email verification via `pending_registrations`.
