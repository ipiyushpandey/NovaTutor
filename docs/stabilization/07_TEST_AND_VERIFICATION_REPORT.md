# 07 — Test & Verification Report (Three Independent Passes)

All test counts and outputs below are exact, observed results from commands executed against branch `stabilization/v2.4-security-reliability`.

## Pass 1 — Functional & Regression Verification

### 1.1 Backend Maven Test Suite (H2 `test` Profile + MockMvc)
- **Command:** `JAVA_HOME="/Applications/IntelliJ IDEA CE.app/Contents/jbr/Contents/Home" mvn -o -B test` (in `backend/`)
- **Result:** **90 / 90 PASS** (`0` failures, `0` errors, `0` skipped, `8.999 s`)
- **Test Classes Executed:**
  - `SecurityConfigTest` (4)
  - `SecurityRemediationTest` (8)
  - `DsaLangHarnessTest` (13)
  - `DsaDatasetAuditTest` (6)
  - `DsaOutputComparisonTest` (6)
  - `Wave2BackendFunctionalTest` (3)
  - `RemoteCodeRunnerVerdictTest` (11)
  - `AiMetricsTest` (2)
  - `GoogleIdTokenVerifierTest` (8)
  - `EmailVerificationServiceTest` (8)
  - `AuthServiceTest` (12)
  - `ProductionConfigValidatorTest` + remaining unit suites (9)

### 1.2 Frontend Unit Tests & Production Build
- **Command:** `npm test && npm run build` (in `frontend/`)
- **Unit Test Result:** **17 / 17 PASS** (`aiText.test.mjs`: 13, `stabilization.test.mjs`: 4)
  - Verifies `api.js` `silentUpdate` suppression, idempotent `GET` 503 retry vs non-idempotent `POST` no-retry, `apiStream` 401 `/auth/me` refresh + `AbortSignal` cancellation, and source security/UI invariants.
- **Production Build:** `vite build` succeeded cleanly in `1.35 s`.

### 1.3 Browser E2E Verification (Playwright Chromium against built `vite preview` + mocked API)
- **Command:** `E2E_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/stabilization.spec.js --project=desktop`
- **Defects Caught & Fixed During Pass 1 Browser Run:**
  1. Missing `useCallback` import on line 1 of `frontend/src/main.jsx` (caught immediately by real browser runtime — fixed in `b477ace`).
  2. Scroll-save race during Back/Forward transitions where browser mount clamp overwrote `sessionStorage` scrollY before restoration ran (fixed via `restoringScrollRef` in `b477ace`).
  3. Direct initial `#/admin` load by non-admin redirected without firing the denial toast (fixed via `initialNonAdminBlocked` in `b477ace`).
- **Post-Fix Pass 1 Browser Result:**
  - `Pass 1A` (Single `/auth/me`, single `/intelligence`, Desktop TopNav 0px CLS across all 4 menus): **PASS** (`1.5 s`)
  - `Pass 1B` (`Home -> Course 1 -> Lecture 2 -> AI Teacher -> Back -> Back -> Back` + exact scroll restoration): **PASS** (`2.6 s`)
  - `Pass 1C` (DSA list -> `#/dsa/two-sum` -> Back): **PASS** (`648 ms`)
  - `Pass 1D` (GATE CSE single `hard_quiz.json` fetch + Q65 `Finish paper` -> `DETAILED TEST REPORT`): **PASS** (`1.6 s`)
  - `Pass 1E` (Knowledge Hub zero chunk persistence in `localStorage` + green `.success-banner` on save): **PASS** (`747 ms`)

## Pass 2 — Security & Adversarial Verification

1. **Backend Security Suite (`SecurityRemediationTest` + `SecurityConfigTest` + `ProductionConfigValidatorTest`):** **PASS** (included in 90/90 Maven run). Verified Chat DTO field redaction, JWT `pwf` invalidation on password change, anti-enumeration `202` responses, guest write blocks, hidden DSA test redaction, rate-limit headers/enforcement, and 405 error handling.
2. **Adversarial Browser XSS Isolation (`Pass 2A`):** **PASS** (`979 ms`). Malicious `<script>` attempting to write `window.parent.localStorage` and mutate `window.parent.document.title` inside Course IDE HTML preview was completely isolated by `sandbox="allow-scripts" referrerPolicy="no-referrer"`.
3. **Non-Admin Direct Route Guard (`Pass 2B`):** **PASS** (`347 ms`). Direct navigation to `#/admin` as `STUDENT` immediately redirected to `#/dashboard` and displayed the restriction toast.
4. **Secret Scan:**
   - Tracked repository files (`git grep`): `NO_TRACKED_SECRETS_FOUND`
   - Built frontend bundle (`frontend/dist/`): `NO_DIST_SECRETS_FOUND`

## Pass 3 — Independent Final Review & 12-Viewport Responsive Audit

1. **12-Viewport Responsive Audit (`Pass 3` Playwright):** **PASS** (`1.1 s`). Verified across ALL 12 widths (`320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1366, 1440, 1920`):
   - Zero horizontal overflow (`scrollWidth <= innerWidth + 1`) at every width.
   - Zero uncaught browser `pageerror` exceptions.
   - Light-mode `.danger-btn` computed text color verified non-white.
   - Synchronous pre-hydration dark mode verified across `page.reload()`.
2. **Full Diff & Snapshot Integrity Check:**
   - Reviewed `git diff --stat baseline/pre-stabilization-e6a0034..HEAD` (70 files changed across targeted security, functional, UI, test, and deployment files; zero extraneous edits).
   - Desktop reference snapshot `/Users/piyushpandey/Desktop/NovaTutor_Deep_Analysis` remained untouched.
3. **Honest Scope Notes (`PARTIALLY VERIFIED`):**
   - Playwright browser tests executed against the real production `frontend/dist/` bundle served by `vite preview` with deterministic mocked `/api/**` routes; live Render/TiDB/Gemini/Docker daemon end-to-end smoke checks remain to be executed during staged deployment approval (see `08_DEPLOYMENT_AND_ROLLBACK_PLAN.md`).
