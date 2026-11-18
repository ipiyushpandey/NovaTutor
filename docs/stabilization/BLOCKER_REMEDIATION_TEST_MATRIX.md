# NOVATUTOR V2.5.1 — BLOCKER REMEDIATION TEST MATRIX

**Date:** 2026-11-18  
**Branch:** `remediation/v2.5.1-independent-audit-fixes`  
**Code Commits:** `af7da22` (Backend & DevOps), `253838d` (Frontend, CSP & Playwright)

This matrix separates **real full-stack / real browser / real compiler** execution from **mocked Playwright / unit tests** and honestly documents **environment-dependent** tests and unavailable host runtimes.

---

## 1. Real Execution Suites (No Mocked Backend)

| # | Suite | Exact Command | Execution Type | Result | Key Assertions Verified |
|---|---|---|---|---|---|
| 1 | **Backend Maven Test Suite** | `JAVA_HOME="/Applications/IntelliJ IDEA CE.app/Contents/jbr/Contents/Home" "/Applications/IntelliJ IDEA CE.app/Contents/plugins/maven/lib/maven3/bin/mvn" -o -B test` (cwd: `backend/`) | Real Spring Boot 3.5.3 + Hibernate + H2 (`MODE=MySQL`) + MockMvc + real local JDK 21 `javac`/`java` | **111 / 111 PASS** (0 fail, 0 err, 0 skip; 10.45s) | Group 2 (`LazyInitializationException` with persisted `QuizAttempt`), Group 3 (`sh -c`, `mode=1777`, real `javac`/`java` harness execution `2,4,6,8 -> 20`, Go multi-char alias), Group 5 (SSE HTTP 400 + saturated-pool HTTP 503 JSON under strict `Accept: text/event-stream`), Group 8 (draft `shown()` 404, permanent DB XP caps, `ProductionConfigValidator` rejecting `framework`), plus all v2.4/v2.5 security & functional suites |
| 2 | **Frontend Unit Tests** | `npm test` (cwd: `frontend/`) | Real Node `v24.19.0` `node --test` | **18 / 18 PASS** (1.10s) | `aiText` normalization (13 tests), `api.js` `silentUpdate` & GET-only retry, `apiStream` WHATWG SSE + bare `"done"` token + `Accept: text/event-stream, application/json;q=0.9` + 401 refresh, non-session 401 handling, source invariants (`/theme-init.js`, `/ide-preview.html`, `render.yaml`, `nginx.conf`, Group 6 guest cleanup) |
| 3 | **Frontend Production Build** | `npm run build` (cwd: `frontend/`) | Real Vite `v5.4.19` production build | **PASS** (1.44s) | Clean bundle build with `dist/theme-init.js` and `dist/ide-preview.html` emitted |
| 4 | **Production-CSP Real Chromium Verification** | `node .../scratch/verify_prod_csp.mjs` (cwd: `frontend/`, serving built `frontend/dist` with exact `render.yaml` HTTP headers) | **Real Chromium 1255 + Real built `dist/` + Exact `render.yaml` CSP headers** (API mocked for static dist) | **4 / 4 PASS** | 1) `/theme-init.js` dark mode pre-hydration + full SPA Dashboard under strict `script-src 'self' https://accounts.google.com/gsi/client` (**0 CSP violations**); 2) `CourseDppIde` renders legitimate HTML/JS via `/ide-preview.html`, blocks parent access (`ISOLATED:SecurityError`), **0 CSP violations**; 3) outbound `fetch('https://example.com/exfil')` blocked by `connect-src 'none'` (`NET_BLOCKED`); 4) direct top-level `/ide-preview.html` refuses `postMessage` rendering; screenshot `scratch/v251_screenshots/csp_ide_preview_1280.png` inspected |
| 5 | **Live Local Full-Stack E2E** | `SHOT_DIR=.../scratch/v251_screenshots node .../scratch/live_local_e2e.mjs` against live local `spring-boot:test-run` (`test` profile, `app.seed.enabled=true`) + Vite `127.0.0.1:5173` | **Real Chromium + Real Spring Boot + Real H2 DB + Real HTTP** | **13 / 13 PASS** | Real backend security headers, `PendingRegistration` flow (`202` + `401`), Admin login + draft course creation + student draft isolation (`404`), Course lesson completion idempotency + Back/Forward + exact scroll restore (`770->770`), `LearningStudio` Voice route + `launchTeacher`, DSA catalog/lang/Back, GATE CSE deep tabs, Course IDE `/ide-preview.html` sandbox isolation (`ISOLATED:SecurityError`), dark-mode toast contrast, 390px/320px responsive + Escape close, Guest logout `DELETE /api/auth/guest` (`200`) + clean storage, zero pageErrors / CSP violations / broken images |
| 6 | **DevOps & Shell Validation** | `bash -n deploy/fill-secrets.command`, `ruby -ryaml -e "YAML.load_file('deploy/docker-compose.prod.yml')"`, dummy `secrets.env` missing `CORS_ORIGINS=`, secret scan `git diff \| grep -iE ...` | Real bash / Ruby YAML / grep | **ALL PASS** | Zero syntax errors, `current()` succeeds with missing optional keys under `set -euo pipefail`, `TRUSTED_PROXY_REGEX` preserves RFC1918 default, `SECRET_SCAN_CLEAN` |

---

## 2. Playwright E2E Suite Against Live Local H2 Stack (`frontend/tests/e2e.spec.js`)

**Command:**
```bash
E2E_BASE_URL=http://127.0.0.1:5173 \
E2E_ADMIN_EMAIL=admin@novatutor.test \
E2E_ADMIN_PASSWORD='AdminTestPassword123!' \
npx playwright test tests/e2e.spec.js --project=desktop --project=mobile
```

**Result:** **24 PASS / 2 SKIPPED / 4 ENV-DEPENDENT FAILURES** (out of 30 total = 15 tests × 2 projects)

| Test Name | Desktop | Mobile | Classification & Explanation |
|---|---|---|---|
| `login screen renders the brand and account choices` | PASS | PASS | Real full-stack |
| `registration asks for name, password confirmation and consent links` | PASS | PASS | Real full-stack |
| `invalid verification link is handled gracefully` | PASS | PASS | Real full-stack |
| `About, Privacy, Terms and Contact are real public routes with a footer` | PASS | PASS | Real full-stack |
| `unverified login shows an honest warning when email delivery is off` | PASS | PASS | Route-mocked auth response |
| `320px viewport keeps the auth screen usable` | PASS | PASS | Real full-stack |
| `favicon and document title carry the new brand` | PASS | PASS | Real full-stack |
| **`browser Back restores the previous page and scroll position`** | **PASS** | **PASS** | **Previously skipped behind `STUDENT` credentials; moved to `guest + portal security` in v2.5.1 and now verified LIVE on both desktop & mobile!** |
| `guest mode starts an isolated session and cannot open Admin` | PASS | PASS | Real full-stack |
| `admin credentials are rejected by the student portal` | PASS | PASS | Real full-stack |
| `admin signs in and navigates the panel on this viewport` | PASS | PASS | Real full-stack |
| `theme moves to Settings and persists across reload` | PASS | PASS | Real full-stack (verifies `/theme-init.js` reload!) |
| `verified student signs in and reaches the dashboard` | SKIP | SKIP | **Env-dependent:** requires pre-verified `E2E_EMAIL`/`E2E_PASSWORD` (no SMTP on localhost to verify a `PendingRegistration`) |
| `forgot-password flow shows an honest generic response` | FAIL (env) | FAIL (env) | **Env-dependent:** local H2 backend has `emailDeliveryConfigured: false` (no SMTP), so UI intentionally hides `"Send reset link"` rather than faking email delivery |
| `admin workspace stays within supported widths without false vertical scroll` | FAIL (env) | FAIL (env) | **Env-dependent:** fresh local H2 DB has only 1 user (`admin@novatutor.test`) and 0 audit logs, so Admin dashboard is shorter than 900px (`blankTail=224`) and 320px Users table fits without vertical scroll (`maxScroll=0`); zero horizontal overflow occurred at any width (`320px–1440px`) |

---

## 3. Mocked-API Playwright Stabilization Suite (`frontend/tests/stabilization.spec.js`)

**Command:**
```bash
E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/stabilization.spec.js --project=desktop --project=mobile
```

**Result:** **24 / 24 PASS** (12 tests × 2 projects: `desktop` + `mobile`, 36.1s)

> **Mock Transparency:** `stabilization.spec.js` intercepts `/api/**` with deterministic responses (now aligned with exact backend DTO schemas for `/admin/dashboard`, `/admin/ai/usage`, `/admin/sandbox/usage`, and `/dsa/problems/two-sum`) to deterministically reproduce async timing races (e.g., 450ms slow DSA starter), 12-viewport layout checks, and unmount/cleanup edge cases. Real backend persistence is covered separately in Sections 1 & 2 above.

| Test | Desktop | Mobile | Regression Group Covered |
|---|---|---|---|
| `Pass 1A: Single /auth/me, deduplicated /intelligence, and Desktop TopNav zero-CLS` | PASS | PASS | Bootstrap & TopNav CLS |
| `Pass 1B: Deep Back/Forward routing, Lecture 1 reset, Forward restore & exact scroll restoration` | PASS | PASS | `HIGH-FE-03`, scroll restore |
| `Pass 1C: DSA deep slug routing & Back navigation without history loop` | PASS | PASS | DSA routing |
| `Pass 1D: GATE CSE single hard_quiz.json fetch and Q65 Finish paper button` | PASS | PASS | GATE CSE exam |
| `Pass 1E: Knowledge Hub keeps chunks out of localStorage and shows green save banner` | PASS | PASS | Knowledge Hub storage |
| `Pass 2A: Course IDE HTML preview renders via isolated /ide-preview.html, blocks parent access & outbound network` | PASS | PASS | **Group 1** (CSP + iframe isolation + `fetch` block) |
| `Pass 2B: Non-admin denied #/admin via replace and dark-mode toast stays readable` | PASS | PASS | Admin route guard & dark contrast |
| `Pass 2C: Guest & student logout from active module purges ALL scoped/unscoped state and preserves theme` | PASS | PASS | **Group 6** (guest logout from active `useModulePersistence`, `nova_workspace_v1_` + all prefixes) |
| `Pass 2D: #/voice opens Voice Tutor and Course launchTeacher overrides persisted Voice tab` | PASS | PASS | `LearningStudio` routing |
| `Pass 2E: Slow starter cannot overwrite server lastCode, and local draft wins while preserving language` | PASS | PASS | **Group 7** (DSA slow-starter race + local-draft precedence) |
| `Pass 2F: Invalid hashchange on Dashboard does not lock subsequent Back scroll restoration` | PASS | PASS | **Group 8 / `HIGH-FE-05`** |
| `Pass 3: 12-Viewport Dashboard Audit, multi-page desktop+mobile overflow, Escape mobile sheet & theme contrast` | PASS | PASS | Responsive 320px–1920px, `/theme-init.js` dark reload |

---

## 4. Docker & Native Toolchain Status (Group 3 Transparency)

| Check | Status | Details |
|---|---|---|
| Local JDK 21 (`javac` + `java`) | **EXECUTED & PASSED** | `Wave2BackendFunctionalTest.localJavaHarnessCompilesAndExecutesCleanlyWithJavac` compiled and ran real `DsaLang.wrapJava(...)` (`2,4,6,8` -> `20`) |
| `SandboxExecutionService` command vector (`java`, `go`, `c++`, `c`) | **EXECUTED & PASSED** | Verified `sh -c` (no `-lc`), `--tmpfs /tmp:rw,nosuid,mode=1777,size=64m`, `--user 65534:65534`, `:ro`, `--network=none`, `--read-only`, `exit 99` |
| Go harness generation & multi-char alias hoisting | **EXECUTED & PASSED** | `DsaLangHarnessTest` (16/16 PASS) |
| Live Docker container execution (`eclipse-temurin:21-jdk-alpine`, `golang:1.22-alpine`) | **NOT EXECUTED (HOST DAEMON STOPPED)** | `/usr/local/bin/docker` exists, `docker info` returned `dial unix /Users/piyushpandey/.docker/run/docker.sock: connect: no such file or directory`. Native `go` binary not installed. Recommend running one container smoke test on a Docker-enabled host before enabling self-hosted `CODE_RUNNER_PROVIDER=docker` (Render production uses `CODE_RUNNER_PROVIDER=remote`). |
