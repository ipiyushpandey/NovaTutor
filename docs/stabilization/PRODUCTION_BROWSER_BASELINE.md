# NovaTutor — Production Browser Baseline Inspection (Read-Only)

**Inspection Timestamp (UTC):** `2026-11-18T15:04:43Z`  
**Inspection Mode:** Strictly READ-ONLY (zero mutations, zero login writes, zero production database operations)  
**Production Frontend URL:** `https://novatutor.onrender.com`  
**Production Backend URL:** `https://novatutor-api.onrender.com`  
**Local Repository Baseline Commit at Inspection:** `40999f0cc9e91f84e6d72f71624b58721b2b5d3c` (`stabilization/v2.4-security-reliability`)  
**Tooling:** Headless Chromium (Playwright `chromium-1255`) via standalone read-only inspection script

---

## 1. Executive Summary

The live Render production deployment was inspected in read-only mode across all **12 mandatory viewport widths** (`320px` through `1920px`), light & dark themes, public informational routes (`#/about`, `#/privacy`, `#/terms`, `#/contact`), and unauthenticated public API endpoints (`/api/health`, `/api/courses`).

### Key Live Production Findings
1. **Cold-Start Latency Confirmed (`>60s`):** `GET https://novatutor-api.onrender.com/api/health` timed out after **60,009 ms** on the first request while the Render free-tier container woke from sleep. Once awake (~70s later during the same inspection run), `GET https://novatutor-api.onrender.com/api/courses` returned **HTTP 200** with **13 published courses**.
2. **Missing Security Response Headers Confirmed on Live Production API:**
   - `Content-Security-Policy`: **MISSING** (`null`)
   - `Referrer-Policy`: **MISSING** (`null`)
   - `Strict-Transport-Security`: `max-age=31536000 ; includeSubDomains` (present)
   - `X-Content-Type-Options`: `nosniff` (present)
3. **Frontend Shell & Public Routes:**
   - Initial frontend shell load (`https://novatutor.onrender.com`): **443 ms**.
   - **0** browser console errors, **0** uncaught `pageerror` exceptions, **0** failed frontend network requests, **0** broken images.
   - **0 horizontal overflow** across all **12 viewports** (`scrollWidth === innerWidth` on every width from `320px` to `1920px`).
   - Dark theme rendered cleanly (`body` background `rgb(14, 16, 19)`, text `rgb(237, 238, 242)`).
4. **Honesty Boundary (Authenticated Production Flows):**
   - Because this mission forbids creating production accounts, mutating production data, or using production credentials, authenticated flows (Dashboard, Courses detail, AI Teacher, DSA, GATE CSE, Admin) were **NOT** executed against live production and are marked **`UNVERIFIED ON LIVE PRODUCTION (read-only boundary)`**. All authenticated full-stack browser journeys are instead verified locally against a real Spring Boot + H2 backend and Vite frontend in Wave 9.

---

## 2. Live API & Cold-Start Observations (Read-Only)

| Endpoint | HTTP Status | Observed Latency | Key Findings |
|---|---|---|---|
| `GET https://novatutor.onrender.com/` | `200` | `443 ms` | Static Render site loaded cleanly; auth shell rendered immediately. |
| `GET https://novatutor-api.onrender.com/api/health` | `TIMEOUT` | `60,009 ms` | Render free-tier cold start exceeded 60s on initial wake request. |
| `GET https://novatutor-api.onrender.com/api/courses` | `200` | Post-wake | Returned 13 courses; `Content-Security-Policy` and `Referrer-Policy` headers absent. |

---

## 3. Responsive Matrix — All 12 Mandatory Viewports (Live Production)

| Viewport Width | `scrollWidth` | `innerWidth` | Horizontal Overflow | `scrollHeight` | Visual Check |
|---:|---:|---:|:---:|---:|---|
| `320 px` | `320` | `320` | `false` | `1008` | Verified (`prod_login_320.png`) — stacked mobile header, form controls and footer fit cleanly without clipping |
| `360 px` | `360` | `360` | `false` | `973` | Pass |
| `375 px` | `375` | `375` | `false` | `973` | Pass |
| `390 px` | `390` | `390` | `false` | `973` | Verified (`prod_login_390.png`) |
| `414 px` | `414` | `414` | `false` | `959` | Pass |
| `430 px` | `430` | `430` | `false` | `959` | Pass |
| `768 px` | `768` | `768` | `false` | `948` | Verified (`prod_login_768.png`) |
| `1024 px` | `1024` | `1024` | `false` | `887` | Pass |
| `1280 px` | `1280` | `1280` | `false` | `887` | Verified (`prod_login_1280_light.png`, `prod_login_1280_dark.png`) — two-column desktop split cleanly balanced |
| `1366 px` | `1366` | `1366` | `false` | `887` | Pass |
| `1440 px` | `1440` | `1440` | `false` | `887` | Pass |
| `1920 px` | `1920` | `1920` | `false` | `887` | Verified (`prod_login_1920.png`) |

---

## 4. Public Routes & Theme Inspection (Live Production)

| Route | Heading Observed | `scrollWidth` / `innerWidth` | Console / Page Errors |
|---|---|---:|---:|
| `#/about` | `"Learning should feel clear, personal and possible."` | `1280 / 1280` | `0 / 0` |
| `#/privacy` | `"Your data, plainly explained."` | `1280 / 1280` | `0 / 0` |
| `#/terms` | `"Fair use of a learning tool."` | `1280 / 1280` | `0 / 0` |
| `#/contact` | `"Talk to a real person."` | `1280 / 1280` | `0 / 0` |

- **Light / Dark Theme Switch:** Verified toggling `data-theme="dark"` produces `background: rgb(14, 16, 19)` and `color: rgb(237, 238, 242)` with readable contrast on the authentication screen. (The `.nv-toast` dark-mode contrast defect identified in the audit occurs on authenticated toast notifications and is reproduced and fixed locally in Wave 8 / Wave 9.)

---

## 5. Verification Boundary

- **Verified against live production:** Static frontend load, Render API cold-start behavior, live HTTP security headers, all 12 viewport widths on public/auth shell, public legal/info routes, dark mode toggle, zero console/page/image errors.
- **NOT verified against live production (strict read-only constraint):** Guest creation, student/admin login, course enrollment, lesson completion, AI streaming, DSA execution, GATE CSE, Admin mutations. These are executed end-to-end against a real local Spring Boot + H2 + Vite stack in Wave 9.
