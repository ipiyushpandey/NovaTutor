# NOVATUTOR V2.5.1 — INDEPENDENT AUDIT BLOCKER REMEDIATION REPORT

**Date:** 2026-11-18  
**Branch:** `remediation/v2.5.1-independent-audit-fixes`  
**Starting HEAD:** `d3020d4` (`remediation/v2.5-audit-fixes`, preserved untouched)  
**Baseline:** `e6a0034` (`main` & `baseline/pre-stabilization-e6a0034`, preserved untouched)  
**Prior Audit Branch:** `40999f0` (`stabilization/v2.4-security-reliability`, preserved untouched)  
**Source of Truth:** `docs/stabilization/FINAL_INDEPENDENT_VERIFICATION.md` (committed at `ccfc43d`, verdict **B — READY ONLY AFTER SPECIFIC FIXES**)  
**Implementation Commits:**
- `ccfc43d` — `docs: record v2.5 independent verification findings before v2.5.1 blocker remediation`
- `af7da22` — `fix(backend,deploy): remediate v2.5.1 audit blockers (Groups 2, 3, 4, 5, 8)`
- `253838d` — `fix(frontend,csp): remediate v2.5.1 CSP, guest cleanup, DSA restoration and E2E blockers (Groups 1, 6, 7)`

---

## Executive Summary

All **8 blocker groups** identified in `docs/stabilization/FINAL_INDEPENDENT_VERIFICATION.md` have been remediated with targeted, minimal changes and verified with deterministic regression tests that would fail against `d3020d4`.

| Blocker Group | Scope | Status | Regression Tests Verified |
|---|---|---|---|
| **GROUP 1** | Production CSP (`render.yaml`, `deploy/nginx.conf`, `frontend/index.html`, `CourseDppIde` iframe) | **RESOLVED** | Real Chromium production-CSP test (`verify_prod_csp.mjs` 4/4 PASS), `stabilization.spec.js` Pass 2A, `stabilization.test.mjs` |
| **GROUP 2** | `AdaptiveController.aiQuestion` `LazyInitializationException` | **RESOLVED** | `Wave2BackendFunctionalTest.adaptiveAiQuestionWithExistingQuizAttemptDoesNotThrowLazyInit500` |
| **GROUP 3** | `SandboxExecutionService` Java & Go `PATH` (`sh -lc` -> `sh -c`), `/tmp` `mode=1777`, Go alias regex | **RESOLVED** (local `javac`/`java` + command-vector verified; Docker daemon stopped on host — see Limitations) | `Wave2BackendFunctionalTest.dsaSaveCodePersistsLargeSubmissionsAbove64KbAndRejectsOversizedPayloads`, `localJavaHarnessCompilesAndExecutesCleanlyWithJavac`, `DsaLangHarnessTest.goHarnessHoistsAndDeduplicatesSingleAndBlockImports` |
| **GROUP 4** | `docker-compose.prod.yml` `TRUSTED_PROXY_REGEX`, `fill-secrets.command` `grep` exit, rollback docs | **RESOLVED** | `bash -n`, `ruby -ryaml`, dummy `secrets.env` without `CORS_ORIGINS=` |
| **GROUP 5** | SSE HTTP 406 on executor saturation / `ApiException` (`Accept: text/event-stream`) | **RESOLVED** | `Wave2BackendFunctionalTest.sseErrorsReturnRealHttp503And400EvenWithAcceptTextEventStreamOnly`, `stabilization.test.mjs` |
| **GROUP 6** | Guest & cross-user client state cleanup (`nova_workspace_v1_` typo, missed prefixes, late `load()` cache) | **RESOLVED** | `stabilization.spec.js` Pass 2C (active `useModulePersistence` guest logout), `live_local_e2e.mjs` Step 12, `stabilization.test.mjs` |
| **GROUP 7** | DSA direct-link restoration race & local-draft precedence + bare SSE `done` token | **RESOLVED** | `stabilization.spec.js` Pass 2E (slow starter + local draft), `stabilization.test.mjs` (bare `done` token) |
| **GROUP 8** | Remaining draft leakage (`AdaptiveController.shown`), permanent DB XP caps, `ProductionConfigValidator` `framework` guard, E2E unskip + mock alignment | **RESOLVED** | `Wave2BackendFunctionalTest.adaptiveShownBlocksDraftLeaksAndAntiXpFarmingCapsArePermanentAndIdempotent`, `ProductionConfigValidatorTest`, `e2e.spec.js` (Back/scroll unskipped), `stabilization.spec.js` Pass 2F |

---

## Detailed Blocker-by-Blocker Remediation

### GROUP 1 — Production CSP (`render.yaml`, `deploy/nginx.conf`, `frontend/index.html`, `CourseDppIde`)

- **Original Blocker:** `render.yaml` and `deploy/nginx.conf` enforced `script-src 'self' https://accounts.google.com/gsi/client` (no `'unsafe-inline'`), which blocked BOTH (1) the inline synchronous dark-mode bootstrap `<script>` in `frontend/index.html:19` and (2) student `<script>` tags inside `CourseDppIde`'s `srcDoc` iframe (since `srcDoc` inherits the parent's CSP in Chromium).
- **Root Cause:** Inline bootstrap script lived directly inside `index.html`, and `CourseDppIde` used `srcDoc` (inheriting parent document CSP) rather than an isolated preview document with its own CSP header.
- **Files Changed:**
  - `frontend/public/theme-init.js` (new) — synchronous external dark-mode initialization script (same origin `'self'`).
  - `frontend/index.html` — replaced inline `<script>` with `<script src="/theme-init.js"></script>` (zero inline `<script>` tags in `index.html`).
  - `frontend/public/ide-preview.html` (new) — isolated preview host that enforces `if (window.self === window.top || window.origin !== 'null') return;` (defense-in-depth refusing to render outside a sandboxed opaque-origin iframe), receives HTML exclusively via `postMessage` from `window.parent`, injects strict `<meta http-equiv="Content-Security-Policy" ...>`, and renders into its isolated document.
  - `frontend/src/main.jsx` (`CourseDppIde`) — replaced `srcDoc` with `<iframe key={previewKey} ref={previewFrameRef} className="html-preview" title="HTML preview" sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" src="/ide-preview.html" onLoad={sendPreviewToIframe} />` and `postMessage` delivery (`nova-ide-ready` / `nova-ide-render`).
  - `render.yaml` & `deploy/nginx.conf` — kept the main SPA `Content-Security-Policy` strictly free of `'unsafe-inline'` in `script-src`, added `Strict-Transport-Security`, and added a dedicated, route-specific `Content-Security-Policy` override exclusively for `/ide-preview.html`:
    ```
    default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'
    ```
- **Verification & Browser Evidence:**
  - Real built `frontend/dist` served with the exact `render.yaml` HTTP headers in headless Chromium (`scratch/verify_prod_csp.mjs`, 4/4 PASS):
    1. `/theme-init.js` applies `.dark` synchronously before hydration with **0 CSP console violations**.
    2. Full SPA Dashboard renders under strict `script-src 'self' https://accounts.google.com/gsi/client` with **0 CSP violations**.
    3. `CourseDppIde` HTML preview renders `#rendered="Hello from Course IDE"`, executes student `<script>`, blocks parent `localStorage`/`document` access (`#out="ISOLATED:SecurityError"`), and blocks outbound `fetch('https://example.com/exfil')` (`#net="NET_BLOCKED"`), with **0 CSP violations** during legitimate preview rendering.
    4. Direct top-level navigation to `/ide-preview.html` refuses `postMessage` rendering (`0` injected nodes).
  - Visual screenshot inspected: `scratch/v251_screenshots/csp_ide_preview_1280.png`.
  - Automated Playwright coverage: `frontend/tests/stabilization.spec.js` (`Pass 2A`, desktop + mobile) and `frontend/src/lib/stabilization.test.mjs`.

---

### GROUP 2 — `AdaptiveController.aiQuestion` `LazyInitializationException`

- **Original Blocker:** Removing `@Transactional` from `AdaptiveController.aiQuestion()` (to avoid holding DB connections open during Gemini calls) caused `a.getCourse().getTitle()` to throw `LazyInitializationException` (HTTP 500) whenever a user had at least one existing `QuizAttempt`.
- **Root Cause:** `QuizAttempt.course` is `@ManyToOne(fetch = FetchType.LAZY)`, and `findTop100ByUserIdOrderBySubmittedAtDesc` did not eagerly fetch `course` before the persistence context closed.
- **Files Changed:**
  - `backend/src/main/java/com/aitutor/intelligence/QuizAttemptRepository.java` — added `@EntityGraph(attributePaths = "course")` on `findTop100ByUserIdOrderBySubmittedAtDesc` and `findTop200ByUserIdOrderBySubmittedAtDesc`.
  - `backend/src/main/java/com/aitutor/intelligence/AdaptiveController.java` — kept `aiQuestion()` non-transactional so DB reads finish completely before Gemini is called, and filtered attempts to `a.getCourse() != null && (admin || a.getCourse().isPublished())` so draft courses cannot influence student AI question prompts.
- **Regression Test:**
  - `Wave2BackendFunctionalTest.adaptiveAiQuestionWithExistingQuizAttemptDoesNotThrowLazyInit500` — persists a real `QuizAttempt` for a student, invokes `POST /api/adaptive/ai-question`, and asserts HTTP 200 (never 500 `LazyInitializationException`).

---

### GROUP 3 — Docker Java & Go `PATH` + `/tmp` Permissions + Go Import Alias

- **Original Blocker:** `SandboxExecutionService.command()` invoked `sh -lc` (login shell) for compiled languages, which sources `/etc/profile` in Debian/Alpine images and resets `PATH`, dropping `/opt/java/openjdk/bin` (`eclipse-temurin:21-jdk-alpine`) and `/usr/local/go/bin` (`golang:1.22-alpine`). Additionally, `--tmpfs /tmp:rw,nosuid,size=64m` omitted explicit `mode=1777` for `--user 65534:65534`, and `DsaLang.java` Go import hoisting regex only matched single-char aliases (`[A-Za-z0-9_.]`).
- **Root Cause:** Login shell flag `-l` reinitialized `PATH`; implicit tmpfs mode varied across container runtimes; Go alias regex lacked `+` quantifier.
- **Files Changed:**
  - `backend/src/main/java/com/aitutor/controller/SandboxExecutionService.java` — replaced `sh -lc` with `sh -c` for `java`, `go`, `c++`, and `c` (preserving image `ENV PATH`), and changed `--tmpfs /tmp:rw,nosuid,size=64m` to `--tmpfs /tmp:rw,nosuid,mode=1777,size=64m` without weakening `--network=none`, `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--pids-limit=64`, `--user 65534:65534`, `:ro` workspace bind, or `docker rm -f` timeout/interrupt cleanup.
  - `backend/src/main/java/com/aitutor/dsa/DsaLang.java` — fixed Go alias regex to `(?:[A-Za-z0-9_.]+\\s+)?` so multi-character aliases (`import str "strings"`) hoist and deduplicate cleanly.
- **Regression Tests:**
  - `Wave2BackendFunctionalTest.dsaSaveCodePersistsLargeSubmissionsAbove64KbAndRejectsOversizedPayloads` — asserts `SandboxExecutionService.command(...)` for `java`, `go`, `c++`, `c` uses `sh -c` (never `-lc`), includes `mode=1777`, `--user 65534:65534`, `:ro`, and `exit 99`.
  - `Wave2BackendFunctionalTest.localJavaHarnessCompilesAndExecutesCleanlyWithJavac` — compiles and executes real `DsaLang.wrapJava(...)` output with the local JDK 21 `javac`/`java` toolchain (`"2,4,6,8\n"` -> `"20"`).
  - `DsaLangHarnessTest.goHarnessHoistsAndDeduplicatesSingleAndBlockImports` — verifies multi-char `import str "strings"` alongside block imports and deduplication.
- **Honest Limitation:** Docker Desktop daemon is NOT running on the audit host (`dial unix /Users/piyushpandey/.docker/run/docker.sock: connect: no such file or directory`), and native `go` CLI is not installed on this host. Live Docker container execution of `eclipse-temurin:21-jdk-alpine` and `golang:1.22-alpine` was NOT executed locally and should be smoke-tested on a Docker-enabled host if self-hosted `CODE_RUNNER_PROVIDER=docker` is used (production Render uses `CODE_RUNNER_PROVIDER=remote`).

---

### GROUP 4 — Docker Compose `TRUSTED_PROXY_REGEX`, `fill-secrets.command`, and Rollback Docs

- **Original Blocker:**
  1. `deploy/docker-compose.prod.yml:58` set `TRUSTED_PROXY_REGEX: ${TRUSTED_PROXY_REGEX:-}`, exporting an empty string when unset, which overrode `application-prod.yml`'s RFC1918/loopback default and caused `ProductionConfigValidator` to fail startup when `RATE_LIMIT_TRUST_PROXY=true`.
  2. `deploy/fill-secrets.command` ran under `set -euo pipefail`, so `grep "^$1=" "$SECRETS"` inside `current()` exited non-zero and aborted the script whenever an optional key (e.g., `CORS_ORIGINS=`) was absent from `secrets.env`.
  3. `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md` contained a stale branch reference, duplicate step `3.`, unclear fresh-DB `JPA_DDL_AUTO=update` ordering, and claimed an unsafe `TEXT` downgrade without explaining `ddl-auto: validate` (`MEDIUMTEXT`) impact.
- **Files Changed:**
  - `deploy/docker-compose.prod.yml` — set default `TRUSTED_PROXY_REGEX` to the exact RFC1918/loopback regex matching `application-prod.yml:116`.
  - `deploy/fill-secrets.command` — added `|| true` to `grep` inside `current()` so missing keys cleanly evaluate to empty string.
  - `docs/stabilization/08_DEPLOYMENT_AND_ROLLBACK_PLAN.md` — updated branch name, fixed step numbering, documented fresh-DB vs existing-DB ordering, and documented safe fast rollback (`JPA_DDL_AUTO=none`) vs verified `OCTET_LENGTH <= 65535` downgrade.
- **Verification:** `bash -n deploy/fill-secrets.command` (exit 0), `ruby -ryaml` parse of `deploy/docker-compose.prod.yml` (exit 0), and isolated subshell test of `current()` against a dummy `secrets.env` missing `CORS_ORIGINS=` (exit 0, returned `""`).

---

### GROUP 5 — SSE HTTP 406 on Executor Saturation / `ApiException`

- **Original Blocker:** Streaming endpoints (`/api/ai/ask/stream`, `/api/mentor/ask/stream`) declare `produces = MediaType.TEXT_EVENT_STREAM_VALUE`, and `frontend/src/lib/api.js` sent `Accept: text/event-stream`. When the bounded stream executor saturated (`RejectedExecutionException` -> `ApiException(503, "AI_BUSY")`) or validation threw `ApiException(400)`, Spring MVC's `GlobalExceptionHandler` returned `ResponseEntity<Map<String, Object>>`, which failed content negotiation against `text/event-stream` and converted the 503/400 response into HTTP `406 Not Acceptable`.
- **Root Cause:** `HandlerMapping.PRODUCIBLE_MEDIA_TYPES_ATTRIBUTE` constrained the handler to `text/event-stream`, and `Accept` did not include `application/json`.
- **Files Changed:**
  - `backend/src/main/java/com/aitutor/controller/GlobalExceptionHandler.java` — injected `ObjectMapper` and routed error handlers through `errorResponse(...)`, which clears `HandlerMapping.PRODUCIBLE_MEDIA_TYPES_ATTRIBUTE` and writes UTF-8 JSON directly to `HttpServletResponse` when `Accept` requests `text/event-stream` without `application/json` or `*/*` (while preserving standard `ResponseEntity<Map<String, Object>>` JSON for normal requests).
  - `backend/src/main/java/com/aitutor/controller/AiController.java` & `MentorController.java` — added package-private constructors accepting an `ExecutorService` for deterministic pool-saturation tests while keeping the `@Autowired` bounded `ThreadPoolExecutor(4, 16, 60s, ArrayBlockingQueue(32), AbortPolicy)` unchanged in production.
  - `frontend/src/lib/api.js` — updated `apiStream` `Accept` header to `'text/event-stream, application/json;q=0.9'`.
- **Regression Tests:**
  - `Wave2BackendFunctionalTest.sseErrorsReturnRealHttp503And400EvenWithAcceptTextEventStreamOnly` — sends `Accept: text/event-stream` (strictly without `application/json`) and asserts BOTH HTTP `400` (`INVALID_AI_REQUEST`) AND saturated-pool HTTP `503` (`AI_BUSY`) return valid JSON (never HTTP `406`).
  - `frontend/src/lib/stabilization.test.mjs` — verifies `apiStream` sends `Accept: text/event-stream, application/json;q=0.9`.

---

### GROUP 6 — Guest & Cross-User Client State Cleanup

- **Original Blocker:**
  1. `clearUserClientState` in `frontend/src/main.jsx` removed `nova_workspace_${idStr}_`, missing the actual `workspaceStore` prefix `nova_workspace_v1_${idStr}_`.
  2. Guest logout missed `nova_module_state_`, `nova_quiz_seen_`, `nova_today_done_`, `nova_challenge_seen_`.
  3. `clearRuntimeUser(exitingId)` was not called for all exiting users (allowing in-memory runtime store state to linger on user switch).
  4. Late in-flight `/courses` or `/progress` promises in `App.load()` could resolve after logout and rewrite `nova_courses_cache`.
- **Files Changed:**
  - `frontend/src/main.jsx` — fixed prefix to `nova_workspace_v1_${idStr}_`, added `nova_module_state_`, `nova_quiz_seen_`, `nova_today_done_`, `nova_challenge_seen_` cleanup for guests, called `clearRuntimeUser(exitingId)` for all exiting users, and guarded `load()` callbacks with `if (!readUser() || String(readUser()?.id) !== String(activeId)) return;`.
- **Regression Tests:**
  - `frontend/tests/stabilization.spec.js` (`Pass 2C`, desktop + mobile) — logs out a `GUEST` user from an active `useModulePersistence` module (`#/learning-studio`), waits past unmount/debounce, and asserts zero leaked `nova_workspace_v1_777*`, `nova_module_state_777*`, `nova_quiz_seen_777*`, `nova_today_done_777*`, `nova_challenge_seen_777*`, `dsa_code_777*`, `nova_courses_cache`, or `nova_scroll_v2:*` keys while `nova_theme` survives.
  - `live_local_e2e.mjs` Step 12 (real backend `DELETE /api/auth/guest` -> 200 + browser storage check) and `frontend/src/lib/stabilization.test.mjs`.

---

### GROUP 7 — DSA Direct-Link Restoration & Bare SSE `done` Token

- **Original Blocker:**
  1. In `frontend/src/dsa.jsx`, direct-loading `#/dsa/:slug` could let a slow initial `/starter?language=java` response overwrite `saved.lastCode` after async `/dsa/progress` restored the user's saved language/code.
  2. When a local draft existed for `savedLang` (`dsa_code_${userScope}_${slug}_${savedLang}`), the `saved` sync effect skipped language restoration or allowed server `lastCode` to fight with the local draft.
  3. `p.tags` filter compared without `.toLowerCase()`, and `Reset starter` did not increment `langSeqRef`.
  4. In `frontend/src/lib/api.js`, `if (eventName === 'done' || data === 'done')` prematurely aborted an SSE stream if an LLM legitimately streamed the literal word `"done"` as a token.
- **Files Changed:**
  - `frontend/src/dsa.jsx` — added `codeSourceRef` (`'none' | 'starter' | 'saved' | 'draft' | 'user'`), `savedAppliedRef`, and `langSeqRef` cancellation establishing strict precedence (`user edit > local draft > saved server lastCode > starter code`); fixed `.toLowerCase()` on `p.tags` search; incremented `langSeqRef` in `Reset starter`.
  - `frontend/src/lib/api.js` — terminated SSE streams ONLY on `eventName === 'done'`, preserving bare `"done"` message tokens.
- **Regression Tests:**
  - `frontend/tests/stabilization.spec.js` (`Pass 2E`, desktop + mobile) — verifies BOTH: (1) slow 450ms Java starter cannot overwrite server-saved Python `lastCode` or bookmark; (2) local draft `dsa_code_42_two-sum_python` wins over server `lastCode` AND restores language to `python`.
  - `frontend/src/lib/stabilization.test.mjs` — streams `data: Work is `, `data: done`, `data:  now!`, `event: done\ndata: done` and asserts exact concatenated output `"Work is done now!"`.

---

### GROUP 8 — Remaining Draft Exposure, Permanent DB XP Caps, `ProductionConfigValidator`, & Test Hardening

- **Original Blocker:**
  1. `AdaptiveController.shown()` allowed students to probe/record question IDs belonging to unpublished draft courses, lacked batch cap / ID validation, and could record duplicate events.
  2. `AdaptiveController.revisionComplete()` and `IntelligenceController.recordEvent()` capped daily XP using `findTop200ByUserIdOrderByCreatedAtDesc` (which could be evicted after 200 events in one day!), accepted negative `score`/`durationSeconds`, and did not validate subjects against published courses.
  3. `ProductionConfigValidator` allowed `server.forward-headers-strategy=framework` when `trustProxy=false` (still trusting spoofable `Forwarded`/`X-Forwarded-*` headers in Spring).
  4. `frontend/tests/e2e.spec.js` placed the disposable-guest `browser Back restores the previous page and scroll position` test inside the `STUDENT`-credential skip block; `frontend/tests/stabilization.spec.js` had outdated Admin/DSA mock schemas and lacked a `HIGH-FE-05` invalid-hashchange test.
- **Files Changed:**
  - `backend/src/main/java/com/aitutor/intelligence/LearningEventRepository.java` — added `countByUserIdAndTypeInAndCreatedAtGreaterThanEqual(Long userId, Collection<String> types, LocalDateTime since)`.
  - `backend/src/main/java/com/aitutor/intelligence/AdaptiveController.java` — hardened `shown()` (max 20 IDs, rejects `<= 0`, enforces `admin || q.getCourse().isPublished()`, idempotent `recordIfAbsent`) and `revisionComplete()` (validates published course subject, permanent DB 3/day cap via `countByUserIdAndTypeInAndCreatedAtGreaterThanEqual`, idempotent `recordIfAbsent`, returns `saved`/`capped`).
  - `backend/src/main/java/com/aitutor/intelligence/IntelligenceController.java` — injected `CourseRepository`, rejects negative `score`/`durationSeconds` (HTTP 400), validates `DPP_COMPLETED` subject against published courses or `"Course Practice"`, enforces permanent DB caps (6/day study sprints, 4/day DPP), uses idempotent `recordIfAbsent`.
  - `backend/src/main/java/com/aitutor/config/ProductionConfigValidator.java` — rejects `server.forward-headers-strategy=framework` unconditionally in `prod` regardless of `trustProxy`.
  - `frontend/tests/e2e.spec.js` — moved `browser Back restores the previous page and scroll position` into `guest + portal security` so it always runs without `E2E_EMAIL`/`E2E_PASSWORD`.
  - `frontend/tests/stabilization.spec.js` — aligned Admin/DSA mock schemas with real backend DTOs and added `Pass 2F` (`HIGH-FE-05` invalid hashchange scroll restoration).
- **Regression Tests:**
  - `Wave2BackendFunctionalTest.adaptiveShownBlocksDraftLeaksAndAntiXpFarmingCapsArePermanentAndIdempotent`
  - `ProductionConfigValidatorTest.rejectsFrameworkForwardHeaderStrategyEvenWhenTrustProxyIsFalse`
  - `frontend/tests/e2e.spec.js` (`browser Back restores the previous page and scroll position`, desktop + mobile PASS)
  - `frontend/tests/stabilization.spec.js` (`Pass 2F`, desktop + mobile PASS)

---

## Verification Summary

| Suite | Result | Notes |
|---|---|---|
| Backend Maven (`mvn -o -B test`) | **111 / 111 PASS** (0 fail, 0 skip) | Real Spring Boot + H2 + MockMvc + local `javac`/`java` |
| Frontend Unit Tests (`npm test`) | **18 / 18 PASS** | Real Node test runner |
| Frontend Production Build (`npm run build`) | **PASS** (1.44s) | Verified `dist/theme-init.js` & `dist/ide-preview.html` |
| Production CSP Chromium (`verify_prod_csp.mjs`) | **4 / 4 PASS** | Real Chromium against built `dist/` with exact `render.yaml` headers |
| Playwright Stabilization (`stabilization.spec.js`) | **24 / 24 PASS** (`desktop` + `mobile`) | Mocked APIs aligned to real backend DTOs |
| Live Local Full-Stack E2E (`live_local_e2e.mjs`) | **13 / 13 PASS** | Real Chromium + real Spring Boot H2 + real Vite |
| Playwright E2E (`e2e.spec.js`, local H2) | **24 / 30 PASS**, 2 skipped, 4 env-dependent | `Back/scroll` now **PASSES** on desktop + mobile; see Matrix for honest breakdown of 2 skipped + 4 env-dependent |
| DevOps Static Checks (`bash -n`, `ruby -ryaml`, secret scan) | **ALL PASS** | Zero secrets in diff |

---

## Remaining Limitations (Honestly Documented)

1. **Docker Daemon Unavailable Locally:** `/usr/local/bin/docker` CLI is present, but Docker Desktop is stopped (`docker.sock` missing) and `go` is not installed natively on this machine. Group 3 fixes (`sh -c`, `mode=1777`, Go alias regex) are verified by unit tests + real local `javac`/`java` harness execution, NOT live Docker container execution. Render production uses `CODE_RUNNER_PROVIDER=remote` (Judge0-compatible remote runner), so Render deployment is unaffected; self-hosted Docker deployments should run one live Java + Go container smoke test on a Docker host.
2. **Local H2 Environment Differences in `e2e.spec.js`:**
   - `verified student signs in and reaches the dashboard` (2 viewports) skipped because `E2E_EMAIL`/`E2E_PASSWORD` are not provided without SMTP.
   - `forgot-password flow shows an honest generic response` (2 viewports) fails on local H2 because SMTP is intentionally unconfigured (`emailDeliveryConfigured: false`), so the UI hides `"Send reset link"` and displays the honest unavailable notice.
   - `admin workspace stays within supported widths without false vertical scroll` (2 viewports) fails on fresh local H2 because only 1 user (`admin@novatutor.test`) and 0 audit logs exist, so the Admin dashboard / Users table is shorter than the 900px/740px viewport (`blankTail=224`, `maxScroll=0`).
3. **Production Migration Timing:** As in v2.5, `database/migrations/V2026_11_18__stabilization_v25.sql` must be applied to TiDB Cloud BEFORE deploying the new backend container with `JPA_DDL_AUTO=validate`.

---

## Final Decision

**A — READY FOR MERGE REVIEW (AND INDEPENDENT RE-AUDIT)**

All 8 blocker groups from `FINAL_INDEPENDENT_VERIFICATION.md` are resolved, verified by automated tests and real Chromium production-CSP testing, and cleanly committed on `remediation/v2.5.1-independent-audit-fixes` without touching `main`, `remediation/v2.5-audit-fixes`, or production systems.
