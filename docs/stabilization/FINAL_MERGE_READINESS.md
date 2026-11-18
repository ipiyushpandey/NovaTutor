# NovaTutor v2.5.2 — Final Merge Readiness Review (Read-Only)

**Review Date:** 2026-11-18  
**Branch Reviewed:** `remediation/v2.5.1-independent-audit-fixes`  
**Verified HEAD:** `69c3259` (`69c32590aa47260102301ee3314df73d5d4a09b3`)  
**Baseline Compared:** `e6a0034` (`main` / `baseline/pre-stabilization-e6a0034`)  
**Review Mode:** Strictly Read-Only (zero source edits, zero commits, zero merges, pushes, deployments, or production DB operations)

---

## Final Recommendation

### **NOT READY** *(1 surgical 2-line cross-account replay blocker remaining)*

All backend, database-locking, timezone, XP-cap, SSE `ASYNC`-dispatch, production-CSP, migration-parity, and secret-hygiene checks **PASS**. However, independent line-by-line inspection of the v2.5.2 session-race guards uncovered **1 concrete cross-account 401-retry replay bug** in `frontend/src/lib/api.js:130` and `frontend/src/lib/api.js:201`:

> **Blocker (`MERGE-BLOCKER-01`):** When User A initiates an API/SSE request (`session = User A`), switches to User B, and User A's in-flight request returns HTTP `401`, lines `130` and `201` omit `&& isSameSession(session)` before calling `refreshSessionTokenWithStatus()`. Because `readUser()` now returns **User B**, `/auth/me` succeeds (`200 OK`) for User B, returns `'ok'`, and lines `132` / `206` **replay User A's original request (URL, HTTP method, and body) authenticated with User B's JWT** — executing User A's mutation (e.g., `POST /api/quizzes/course/{id}/submit`, `POST /api/community/posts`, `DELETE /api/auth/guest`) against **User B's account**.  
> **Exact Fix (2 lines + test update):** Add `&& isSameSession(session)` to `frontend/src/lib/api.js:130` and `frontend/src/lib/api.js:201`, and update `frontend/src/lib/stabilization.test.mjs:240-255` so `/auth/me` returns `200` for User B and asserts User A's stale `401` triggers zero `/auth/me` calls and zero retries.

Once that 2-line fix is applied and re-tested, the branch is ready for merge review (subject to the staging verification gates in Section 4).

---

## 1. Repository State, Hygiene & Branch Integrity

| Check | Result | Evidence |
|---|---|---|
| Branch & HEAD match expected `69c3259` | **PASS** | `remediation/v2.5.1-independent-audit-fixes` @ `69c32590aa47260102301ee3314df73d5d4a09b3` |
| Working tree clean before report | **PASS** | `git status -sb` showed zero staged, unstaged, or untracked files |
| `main` & previous branches untouched | **PASS** | `main` (`e6a0034`), `stabilization/v2.4-security-reliability` (`40999f0`), `remediation/v2.5-audit-fixes` (`d3020d4`) all preserved |
| Secret scan (`e6a0034..69c3259`) | **PASS** | `SECRET_SCAN_CLEAN` across all non-doc/non-test source files (zero API keys, private keys, tokens) |
| Accidental files / destructive DB ops | **PASS** | Zero debug artifacts, zero `DROP TABLE` / `TRUNCATE` statements; v2.5.2 diff (`f79bd0e..69c3259`) touches only 13 tightly scoped files |

---

## 2. Finding-by-Finding Verification Matrix

### A. Original CRITICAL & HIGH Audit Findings (`e6a0034..69c3259`)

| Finding ID | Scope | Exact File & Line Evidence | Verification Status |
|---|---|---|---|
| **SEC-01** | Chat API `User` entity credential leak | `ChatController.java`, `ChatConversation.java`, `ChatMessage.java`, `User.java` (`@JsonIgnore`) | **PASS** (Verified locally via `SecurityRemediationTest`) |
| **CRITICAL-SEC-01** | Production proxy trust & `X-Forwarded-For` spoofing | `application-prod.yml:107,113-116`, `ProductionConfigValidator.java:72-75`, `RequestRateLimitFilter.java:204-244`, `SecurityConfig.java:85-107,149-151` | **PASS** (Local unit/MockMvc verified; Render live proxy headers staging-only) |
| **CRITICAL-SEC-02** | Pre-registration & Google OAuth account takeover | `PendingRegistration.java`, `EmailVerificationService.java:73-197`, `AuthService.java:57-137,206-254`, `JwtService.java:63,98-122` | **PASS** (Verified locally via `AuthServiceTest`, `EmailVerificationServiceTest`, `SecurityRemediationTest`) |
| **HIGH-SEC-01** | Hidden DSA test exfiltration | `DsaJudgeService.java:108-242`, `DsaController.java:103-126` | **PASS** (Separate sandbox execution + `exposeStderr=false` + blank hidden fields) |
| **HIGH-SEC-02** | Pre-auth flood, `/api/code/analyze` bucket, guest cap | `PreAuthRateLimitFilter.java:24-88`, `RequestRateLimitFilter.java:45-102,157-173`, `GuestService.java:56-97`, `application-prod.yml:34-44` | **PASS** (Bounded LRU maps, filter ordering, guest cap verified) |
| **MEDIUM-SEC-01** | Draft course exposure across student endpoints | `CourseController`, `QuizController`, `ProgressController`, `DppController`, `MentorController`, `LearningRecommendationController`, `AdaptiveController`, `IntelligenceController` | **PASS** (Verified across all 7 live H2 student endpoints) |
| **MEDIUM-SEC-02** | XP farming & daily caps | `QuizController.java:100-154`, `AdaptiveController.java:187-287`, `IntelligenceController.java:26-70`, `UserRepository.java:15-17`, `LearningEventAnalyticsService.java:19-27` | **PASS** (Empty/invalid quiz rejected with 400; persistent concurrency-safe IST daily caps across Quiz, Adaptive, Revision, DPP, Study Sprints) |
| **MEDIUM-SEC-04/05** | Production CSP, HSTS, Course IDE iframe isolation | `render.yaml:96-117`, `deploy/nginx.conf:6-41`, `frontend/index.html:19`, `theme-init.js`, `ide-preview.html`, `main.jsx:1262-1331`, `SecurityConfig.java:119-126` | **PASS** (Locally verified in real Chromium against built `dist/` with exact `render.yaml` headers; live Render header override check required post-deploy) |
| **HIGH-DB-01/02/03** | Progress concurrency, `AdaptiveController` lazy init & pool safety, `DataSeeder` | `ProgressController.java:21-56`, `ProgressRepository.java:15-32`, `QuizAttemptRepository.java:11-14`, `AdaptiveController.java:109-148`, `AdminController.java:427-488`, `DataSeeder.java:108-216` | **PASS** (Verified locally on H2; zero DB connection held during Gemini calls) |
| **HIGH-DB-04 / NEW-18** | `DsaProblemState.lastCode` `MEDIUMTEXT`, 250 KB cap, test config | `DsaProblemState.java:48`, `DsaController.java:160-162`, `V2026_11_18__stabilization_v25.sql:21`, `application-test.yml:42-44` | **PASS (Static & H2)** / **UNVERIFIED (TiDB Cloud)** |
| **HIGH-AI-01** | Bounded SSE executors, cancellation, 503 JSON on `Accept: text/event-stream` | `AiController.java:27-110`, `MentorController.java:35-114`, `GlobalExceptionHandler.java:37-160`, `StreamCancellation.java:14-64`, `api.js:143` | **PASS** (Verified locally via MockMvc + real Tomcat) |
| **HIGH-DSA-01/02/03** | Go/C/Java harnesses & Docker sandbox flags | `DsaLang.java`, `SandboxExecutionService.java:55-135,186-265` | **PASS (Static + Local JDK 21 `javac`/`java`)** / **UNVERIFIED (Live Docker)** |
| **NEW-20 / REG-09** | Docker Compose `TRUSTED_PROXY_REGEX`, `fill-secrets.command`, rollback docs | `deploy/docker-compose.prod.yml:58`, `deploy/fill-secrets.command:16,130`, `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md` | **PASS** |
| **HIGH-FE-01..08** | Unmount flush, guest/user cleanup, routing, scroll restore, SSE parsing, DSA restore, dark contrast | `main.jsx`, `dsa.jsx`, `api.js`, `styles.css`, `stabilization.spec.js` (26/26 PASS), `e2e.spec.js` | **PARTIAL — Blocked by `MERGE-BLOCKER-01`** (`api.js:130, 201`) |

### B. v2.5.2 Targeted HIGH Findings (`REAUDIT-01`..`REAUDIT-05`)

| Finding ID | Exact File & Line Evidence | Verification Status | Notes |
|---|---|---|---|
| **REAUDIT-01** (UTC timezone daily XP caps) | `LearningEventAnalyticsService.java:19-27`, `AdaptiveController.java:205-212`, `IntelligenceController.java:37-42`, `Wave2BackendFunctionalTest.java:511-584` | **PASS** | Uses naive IST `LocalDateTime` matching `learning_events.created_at`; verified under `TimeZone.setDefault(UTC)`. |
| **REAUDIT-02** (Empty quiz XP exploit & Adaptive cap) | `QuizController.java:100-154`, `AdaptiveController.java:232-287`, `UserRepository.java:15-17`, `Wave2BackendFunctionalTest.java:586-674` | **PASS** | Empty/invalid quiz -> HTTP `400`; `QUIZ_COMPLETED` 10/day + `ADAPTIVE_QUESTION` 30/day under `PESSIMISTIC_WRITE` user lock; zero deadlock inversion with `ProgressController`; UI backward compatibility confirmed (`main.jsx:1828,1834` blocks empty quiz submit and restricts options to `0..3`). |
| **REAUDIT-03** (Spring Security `ASYNC` SSE dispatch) | `SecurityConfig.java:128-131`, `SseAsyncSecurityTomcatTest.java:41-145` | **PASS** | `DispatcherType.ASYNC` & `ERROR` cannot be forged by external HTTP clients; ordinary `REQUEST` auth strictly preserved (verified `401` on unauthenticated SSE and clean EOF on `/api/ai/ask/stream` & `/api/mentor/ask/stream` against real embedded Apache Tomcat `10.1.42`). |
| **REAUDIT-04** (Async `/auth/me` session resurrection / overwrite) | `frontend/src/lib/api.js:25-78, 130-142, 201-218`, `frontend/src/main.jsx:590, 655-683, 909`, `stabilization.test.mjs:197-256`, `stabilization.spec.js:628-700` | **FAIL (`MERGE-BLOCKER-01`)** | Direct `/auth/me` logout & switch races are fixed and pass (`19/19` unit + `26/26` Playwright), **but `api.js:130` & `api.js:201` omit `&& isSameSession(session)` before retrying a stale User A `401` via User B's `/auth/me`**, allowing User A's mutation to replay under User B's token. |
| **REAUDIT-05** (Related async profile/cache writes) | `frontend/src/main.jsx:280, 692-712, 2045-2080` | **PASS** | `/users/:id`, `AILearningProfile` (`alive` + active ID check), and `NovaCoach` cache writes all guard against active `readUser().id`. *(Minor dead-code nit: unused `const activeToken = user.token;` at `main.jsx:665`.)* |

---

## 3. Independent Deep-Check Highlights

1. **Deadlock & Transaction Safety (`PASS`):** All 4 XP-capping endpoints (`QuizController.submit`, `AdaptiveController.revisionComplete`, `AdaptiveController.answer`, `IntelligenceController.event`) acquire `UserRepository.findByIdForUpdate(userId)` first and never touch `progress`. `ProgressController.complete` only locks `progress` after `INSERT IGNORE INTO learning_events` and never upgrades to an X-lock on `users`. `LearningEventService.recordIfAbsent` uses native `INSERT IGNORE` so duplicate keys return `0` without poisoning enclosing `@Transactional` sessions.
2. **Migration & Production Configuration (`PASS` static / `UNVERIFIED` live TiDB):** Zero entity/schema changes were introduced in v2.5.2. Full delta from `e6a0034` matches `database/migrations/V2026_11_18__stabilization_v25.sql` (`pending_registrations` + `dsa_problem_state.last_code MEDIUMTEXT`). Deployment order in `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md` (apply SQL migration before deploying backend with `JPA_DDL_AUTO=validate`) and rollback limitations (`JPA_DDL_AUTO=none` fast rollback vs `OCTET_LENGTH <= 65535` check before downgrading to `TEXT`) are accurate.

---

## 4. Explicit Runtime Verification Boundaries

Do **NOT** treat local test results as full production proof until external runtime gates are executed:

| Layer | Status | Scope Actually Verified |
|---|---|---|
| **Locally Verified** | **VERIFIED** | Backend Maven **114/114 PASS** (Spring Boot 3.5.3, H2 `MODE=MySQL`, real embedded Apache Tomcat `10.1.42` SSE completion, UTC timezone test, local JDK 21 `javac`/`java` harness); Frontend unit tests **19/19 PASS**; Vite production build **PASS**; Playwright `stabilization.spec.js` **26/26 PASS** (`desktop` + `mobile`); real Chromium built-`dist/` CSP test with exact `render.yaml` headers **PASS**; real local full-stack H2+Vite E2E **13/13 PASS**. |
| **Docker Container Execution** | **NOT VERIFIED** | Docker Desktop daemon is not running on the local host (`docker.sock` absent) and native `go` CLI is absent. Live `eclipse-temurin:21-jdk-alpine` / `golang:1.22-alpine` container execution was NOT run. *(Render production uses `CODE_RUNNER_PROVIDER=remote`; self-hosted Docker users must run a Java + Go container smoke test on a Docker host.)* |
| **TiDB Cloud Serverless Migration** | **NOT VERIFIED** | `database/migrations/V2026_11_18__stabilization_v25.sql`, Hibernate `JPA_DDL_AUTO=validate`, `INSERT IGNORE` unique-index behavior, and `PESSIMISTIC_WRITE` row locking were NOT executed against live TiDB Cloud or MySQL 8. Must be verified on staging TiDB Cloud before production cutover. |
| **Render Live Edge & SMTP** | **NOT VERIFIED** | Render static-site header override (`curl -I https://<host>/ide-preview.html` returning a single overridden CSP), Render/Cloudflare multi-hop `X-Forwarded-For`, live Gemini SSE, and live SMTP verification/reset delivery require staging verification. |

---

## 5. Remaining Low/Medium Non-Blocking Risks

Already documented in `docs/stabilization/FINAL_V25_1_INDEPENDENT_REAUDIT.md` (out of scope for v2.5.2, track as follow-up):
- `REAUDIT-06` (MEDIUM): `DsaController.problem()` (`DsaController.java:56-80`) omits `"cSupported"`, disabling C (`C (n/a)`) in the DSA editor UI.
- `REAUDIT-07`..`REAUDIT-12` (LOW-MEDIUM): `ide-preview.html` regex `<head>` meta-CSP edge case & dead `nova-ide-ready`; `AdaptiveController.revisionComplete` explicit JSON `null` -> `"null"`; `GlobalExceptionHandler` case-sensitive `Accept`; `dsa.jsx:401` `Reset starter` missing `try/catch`; minor Compose/shell quoting nits; `SecurityRemediationTest:370-398` missing post-verify login assertion; unused `activeToken` at `main.jsx:665`.

---

## 6. Complete Git Diff Summary

- **Full delta vs original baseline (`e6a0034..69c3259`):** `111 files changed, 8251 insertions(+), 1195 deletions(-)`
  - Backend main & config (`backend/src/main/**`): 62 files (security filters, JWT revocation, `PendingRegistration`, draft/XP guards, SSE bounded pools/cancellation/ASYNC dispatch, DSA judge & harnesses, `application-prod.yml`)
  - Backend tests (`backend/src/test/**`): 10 files (114 tests total, incl. `SseAsyncSecurityTomcatTest`, `Wave2BackendFunctionalTest`, `SecurityRemediationTest`, `ProductionConfigValidatorTest`, `DsaLangHarnessTest`)
  - Database migration (`database/migrations/V2026_11_18__stabilization_v25.sql`): 1 file (+21 lines)
  - Deploy & CI (`render.yaml`, `deploy/nginx.conf`, `deploy/docker-compose.prod.yml`, `deploy/fill-secrets.command`, `.github/workflows/ci.yml`): 5 files
  - Frontend (`frontend/**`): 14 files (CSP `/theme-init.js` + `/ide-preview.html`, `api.js`, `main.jsx`, `dsa.jsx`, `gateCse.jsx`, `AdminControlCenter.jsx`, `AiMarkdown.jsx`, `styles.css`, unit & Playwright suites)
  - Stabilization & Audit Docs (`docs/stabilization/**`): 19 files
- **v2.5.2 targeted delta (`f79bd0e..69c3259`):** `13 files changed, 689 insertions(+), 53 deletions(-)` (6 backend main, 2 backend tests, 2 frontend main, 2 frontend tests, 1 remediation report).
