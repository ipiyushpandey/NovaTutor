# NovaTutor — Remediation Verification & Test Matrix (`v2.5`)

This matrix strictly separates **what was executed and proven locally** from **what used mocks or in-memory H2** and **what remains unverified against external production infrastructure**.

---

## 1. Automated & Browser Test Execution Summary

| Test Layer | Environment / Backing Store | Exact Command | Result | Scope Verified |
|---|---|---|---|---|
| **Backend Unit & Security/Concurrency Integration** | Java 21, Spring Boot 3.5.3, **H2 in-memory (`MODE=MySQL`)**, MockMvc, no real Gemini/Docker/TiDB | `mvn -o -B test` (in `backend/`) | **107 / 107 PASS** (`0` failures, `0` errors, `0` skipped; `10.0s`) | `ProductionConfigValidatorTest`, `SecurityConfigTest` (4), `SecurityRemediationTest` (13), `AuthServiceTest` (14), `EmailVerificationServiceTest` (10), `GoogleIdTokenVerifierTest` (8), `Wave2BackendFunctionalTest` (6 — incl. 6-thread concurrent progress completion & delete-lesson reconciliation), `DsaLangHarnessTest` (16), `DsaDatasetAuditTest` (6), `DsaOutputComparisonTest` (6), `RemoteCodeRunnerVerdictTest` (11), `AiMetricsTest` (2), + existing unit tests |
| **Frontend Unit & Security Invariant Tests** | Node.js `v24.19.0` (`node --test`), mocked `fetch` / storage | `npm test` (in `frontend/`) | **18 / 18 PASS** (`0.8s`) | `aiText.test.mjs` (13), `stabilization.test.mjs` (5 — `silentUpdate`, GET retry vs POST no-retry, WHATWG SSE leading-space stripping + `event: done`, non-session 401 & `/auth/me` transient network error session preservation vs authoritative 401 expiry, IDE iframe sandbox + inner CSP + toast CSS invariants) |
| **Frontend Production Bundle Build** | Vite `5.4.19` | `npm run build` (in `frontend/`) | **PASS** (`1.51s`, 0 errors) | Production bundle builds cleanly (`dist/index.html`, `index-*.js`, `lottie-*.js`, `index-*.css`) |
| **Playwright Stabilization Suite (Mocked API)** | Real Chromium `1255` against live local Vite (`127.0.0.1:5173`), **mocked `/api/**`**, real DOM/iframe/CSS/routing | `npx playwright test tests/stabilization.spec.js --project=desktop --project=mobile` | **20 / 20 PASS** (`10 desktop + 10 mobile`; `26.8s`) | Single `/auth/me` & `/intelligence`, Desktop TopNav zero-CLS, Course Lecture 1->2->Back reset->Forward restore & exact scroll restore, DSA deep slug & Back, GATE CSE single `hard_quiz.json` & Q65 Finish, Knowledge Hub no-`localStorage` chunks & green save banner, Course IDE iframe opaque origin `ISOLATED:SecurityError` & no `htmlPreview` persistence, non-admin `#/admin` replace + dark-mode `.nv-toast` contrast, Logout full storage cleanup & theme preservation, `#/voice` + Course `launchTeacher` override, 12-viewport Dashboard + 7-page desktop/mobile overflow + Escape mobile sheet |
| **Live Local Full-Stack Browser E2E (Zero API Mocks)** | Real Chromium `1255` + real local **Vite (`5173`)** + real local **Spring Boot (`8080`, `test` profile, H2 `MODE=MySQL`, `app.seed.enabled=true`)** | `node .../scratch/live_local_e2e.mjs` | **13 / 13 PASS** | Real backend security headers (`CSP`, `Referrer-Policy`, `nosniff`, `DENY`, `Permissions-Policy`), real `PendingRegistration` (`202` -> unverified login `401`), real Admin UI + draft course creation & student 404 isolation, real Guest 3-step onboarding + 13 seeded courses + single `/auth/me`, real L1 & L2 completion + DB repeat-click idempotency (`completedLessons=2`) + Back resets L1 + Forward restores L2 + exact `770->770` Dashboard scroll restore, LearningStudio Voice reload & `launchTeacher` override, real DSA catalog + language switch + Back, GATE CSE tab routing, real iframe `ISOLATED:SecurityError`, Dark mode `.nv-toast` contrast (`rgb(237,238,242)` on `rgb(20,22,27)`), mobile `390px`/`320px` overflow + Escape close, real `DELETE /api/auth/guest` (`200`) + clean storage, 0 `pageerror`, 0 CSP violations (Lottie verified), 0 broken images |
| **Playwright `e2e.spec.js` (Real Local Backend)** | Real Chromium `1255` + real local Vite (`5173`) + real local Spring Boot H2 (`8080`, `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`) | `E2E_BASE_URL=http://127.0.0.1:5173 E2E_ADMIN_EMAIL=admin@novatutor.test E2E_ADMIN_PASSWORD='AdminTestPassword123!' npx playwright test tests/e2e.spec.js --project=desktop --project=mobile` | **22 / 22 applicable PASS** (`4` skipped for absent student creds; `4` env-specific failures: 2 forgot-password disabled due to no local SMTP, 2 admin `maxScroll > 0` due to 1-row H2 Users table fitting inside 740px) | Signed-out layout & public routes, invalid verification link, guest isolation & admin denial, admin portal separation, admin login & fixed closed-by-default Desktop TopNav + mobile sheet navigation, multi-width admin layout overflow checks (`320..1440`), theme persistence across reload |
| **Config, Shell & Secret Validation** | Local shell / Ruby YAML parser / Git diff grep | `bash -n deploy/fill-secrets.command`, `ruby -ryaml`, secret regex scan over `40999f0..HEAD` | **PASS** (`SECRET_SCAN_CLEAN`) | Valid shell syntax, valid YAML across `application-prod.yml`, `docker-compose.prod.yml`, `render.yaml`, `@`-in-password MySQL URL parsing, zero leaked keys/tokens |
| **Live Production Baseline (Read-Only)** | Real Chromium `1255` against live `https://novatutor.onrender.com` & `https://novatutor-api.onrender.com` | Read-only baseline script (`docs/stabilization/PRODUCTION_BROWSER_BASELINE.md`) | **PASS (Public Read-Only)** | Verified 12 viewports (`320..1920`), light/dark themes, 4 public routes (`#/about`, `#/privacy`, `#/terms`, `#/contact`), 0 console/page/image errors, 0 horizontal overflow, measured Render cold start `>60s` then `/api/courses` 200 (13 courses) |

---

## 2. Visual Verification Artifacts Captured (Local Real Full-Stack)

Screenshots captured during `live_local_e2e.mjs` and visually inspected via `view_file`:
- `local_dashboard_1280.png` — Light-mode authenticated Guest Dashboard with closed-by-default TopNav.
- `local_course_1280.png` — CourseDetail (`HTML Mastery`, 105 lessons); visual inspection caught inline alignment of `← Back` beside eyebrow, fixed immediately in `frontend/src/main.jsx` (`be94194`).
- `local_dsa_1280.png` — Real DSA problem view (`Build Array from Permutation`) switched to Python starter.
- `local_dark_1280.png` — Dark-mode Dashboard with verified high-contrast `.nv-toast`.
- `local_admin_1280.png` — Real Admin Control Center (`1365` lessons, `1260` questions, `13` published courses, live audit events).
- `local_mobile_390.png` — Mobile `390px` dark-mode Dashboard with zero horizontal overflow.

---

## 3. Explicitly Unverified External Dependencies (Do Not Overclaim)

| Dependency | Status | Reason & Required Action |
|---|---|---|
| **TiDB Cloud MySQL (`ddl-auto: validate` + SQL migration)** | **UNVERIFIED LOCALLY** | Local backend tests ran on H2 `MODE=MySQL`. Apply `database/migrations/V2026_11_18__stabilization_v25.sql` on TiDB Cloud before deploying backend and verify Hibernate `validate` succeeds on boot. |
| **Live Gemini API (`generativelanguage.googleapis.com`)** | **UNVERIFIED LOCALLY** | No live Gemini API key configured in local test runs. Smoke-test `/api/ai/ask/stream` and client abort in staging/production after deploy. |
| **Live Docker Daemon (`SandboxExecutionService`)** | **UNVERIFIED LOCALLY** | Docker sandbox invocation (`--user 65534:65534`, `:ro`, `/tmp`) was audited and harness-tested without launching live Docker containers. Smoke-test all 6 languages (`Java`, `Python`, `C++`, `C`, `JavaScript`, `Go`) if Docker runner is enabled in production. |
| **Authenticated Live Production (`novatutor.onrender.com`)** | **UNVERIFIED ON LIVE PRODUCTION** | Production was strictly read-only during this mission; no accounts or mutations were created on live Render/TiDB. |
