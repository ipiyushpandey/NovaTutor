# 01 — Baseline & Current Commits

## 1. Repository & Branch State

| Property | Value |
|---|---|
| Repository | `https://github.com/ipiyushpandey/NovaTutor` |
| Production Branch | `main` (untouched) |
| Baseline Commit (`origin/main`) | `e6a00349b455b031d6b96d2643ca4b795a8b9349` — *"Fix admin landing, direct course routes and navbar layout"* |
| Rollback Tag | `baseline/pre-stabilization-e6a0034` -> `e6a00349b455b031d6b96d2643ca4b795a8b9349` |
| Remediation Branch | `stabilization/v2.4-security-reliability` |
| Reference Snapshot (Read-Only) | `/Users/piyushpandey/Desktop/NovaTutor_Deep_Analysis` (215 verified files, unmodified) |

## 2. Production Baseline Comparison

- Prior to Wave 0, `origin/main` was checked and confirmed at `e6a00349b455b031d6b96d2643ca4b795a8b9349`, matching the audited snapshot (`SNAPSHOT_SHA256SUMS.txt`).
- No local uncommitted user edits were overwritten or discarded.
- No production credentials, live TiDB rows, or Render deployments were modified during this mission.

## 3. Remediation Commit Log (`stabilization/v2.4-security-reliability`)

| Order | Commit | Scope | Verification |
|---|---|---|---|
| Base | `e6a0034` | Baseline `main` (`baseline/pre-stabilization-e6a0034`) | Reference |
| Wave 0 | `6879c5c` | Reproducible H2 test profile, Java 21 ByteBuddy surefire agent, `@AutoConfigureMockMvc`, CI alignment | Maven tests pass |
| Wave 1 | `1849425` | Critical security remediation (Chat DTOs, iframe XSS sandbox, rate-limit hardening, LOB bounds, JWT `pwf` revocation, anti-enumeration, guest isolation, DSA hidden test redaction, `SecurityConfig`, `GlobalExceptionHandler`, `ProductionConfigValidator`) + `SecurityRemediationTest` | 84/84 Maven tests pass |
| Wave 2A | `b81f050` | Backend functional, DSA harnesses, sandbox deadlock/`--memory-swap`, draft course visibility + `/api/admin/courses`, idempotent progress, `LearningEvent` concurrency, HikariCP 512MB tuning, DevOps (`nginx.conf`, `docker-compose.prod.yml`, `fill-secrets.command`) + `Wave2BackendFunctionalTest` | 90/90 Maven tests pass |
| Wave 2B/3/4 | `fe8fd99` | Frontend functional bugs (`api.js`, `AiMarkdown`, `gateCse`, `dsa`, `AdminControlCenter`, `main.jsx`), deep routing & scroll restoration, Desktop TopNav zero-CLS, CSS contrast/layout fixes, `index.html` pre-hydration dark theme + `stabilization.test.mjs` | 17/17 frontend tests + Vite build pass |
| Pass 1–3 | `b477ace` | Browser-caught `useCallback` import fix, `restoringScrollRef` pop-navigation race fix, direct `#/admin` non-admin guard + Playwright `stabilization.spec.js` | 8/8 Playwright tests pass |

## 4. Runtime & Toolchain Versions Verified Locally

- **Java:** OpenJDK 21.0.8 (IntelliJ JBR)
- **Maven:** 3.x (offline `-o -B` execution against cached repository)
- **Node.js / npm:** Node `v24.19.0`, npm `11.17.0`
- **Vite:** `v5.4.19`
- **Playwright:** Chromium headless shell `chromium-1255` (macOS ARM64)
