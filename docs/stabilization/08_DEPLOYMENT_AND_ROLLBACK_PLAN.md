# 08 — Deployment & Rollback Plan

> **Safety Gate:** No push to `main`, production database mutation, credential change, or Render deployment was executed during this stabilization mission. Execute this plan only after reviewing the branch diff and approving release.

## 1. Pre-Deployment Checklist

1. **Review branch diff against baseline:**
   ```bash
   git checkout stabilization/v2.4-security-reliability
   git log --oneline baseline/pre-stabilization-e6a0034..HEAD
   ```
2. **Verify required Render backend environment variables** (enforced by `ProductionConfigValidator` under `SPRING_PROFILES_ACTIVE=prod`):
   - `JWT_SECRET` (strong >= 32 bytes, not a default placeholder)
   - `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` (TiDB Cloud TLS JDBC URL)
   - `CORS_ORIGINS` (exact `https://` production frontend origin(s), no `*`, no localhost/loopback)
   - `GEMINI_API_KEY` (valid server-side key)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` (owner account; password >= 12 chars)
   - `RATE_LIMIT_TRUST_PROXY=true` (only behind trusted reverse proxy such as Render/Nginx; uses `server.forward-headers-strategy=native`)
   - `JPA_DDL_AUTO=validate` (after applying SQL migration), `APP_SEED_ENABLED=false`
3. **Database Migration Requirement (v2.5 Audit Remediation):**
   - Before deploying with `JPA_DDL_AUTO=validate`, apply [`database/migrations/V2026_11_18__stabilization_v25.sql`](../../database/migrations/V2026_11_18__stabilization_v25.sql):
     - Creates `pending_registrations` (for token-bound email verification preventing pre-registration takeover).
     - Widens `dsa_problem_state.last_code` from `TEXT` to `MEDIUMTEXT`.
   - No destructive column drops or data-loss migrations are performed; existing tables remain backward-compatible for rollback.

## 2. Deployment Sequence (User-Approved)

1. Merge `remediation/v2.5-audit-fixes` into `main` via PR (letting `.github/workflows/ci.yml` run full Maven + Node tests + Vite build on GitHub Actions):
   ```bash
   git push -u origin remediation/v2.5-audit-fixes
   ```
2. Apply `database/migrations/V2026_11_18__stabilization_v25.sql` against the production TiDB/MySQL database.
3. Deploy **Backend** first on Render; confirm `/actuator/health/readiness` returns `200 OK` and logs show `HikariPool-1 - Start completed` with `maximumPoolSize=8` and zero `ProductionConfigValidator` errors.
3. Deploy **Frontend** static site; confirm `VITE_API_URL` points to the production backend.
4. Run post-deploy live smoke checks:
   - Sign in as student + guest; verify `/auth/me` fires once, Dashboard loads cleanly, and guest cannot post in Community.
   - Open `Course -> Lecture -> AI Teacher -> Back` and verify exact scroll restoration.
   - Open `DPP & IDE` HTML preview and verify `sandbox="allow-scripts"`.
   - Sign in as admin; confirm `/api/admin/courses` shows drafts and non-admins are blocked from `#/admin`.
   - Check `Chat` response in DevTools Network tab to confirm zero sensitive user fields (`passwordHash`, etc.).

## 3. Instant Rollback Plan

Because schema compatibility with `e6a0034` is preserved, rollback is fast and lossless:

1. **Render Dashboard Rollback (fastest, < 2 min):** Trigger "Rollback to this deploy" on the previous `e6a0034` deploy for backend and/or frontend.
2. **Git Rollback:**
   ```bash
   git checkout main
   git revert --no-commit baseline/pre-stabilization-e6a0034..HEAD
   git commit -m "revert: rollback stabilization release to baseline e6a0034"
   git push origin main
   ```
3. **Preserved Tag:** `baseline/pre-stabilization-e6a0034` permanently marks the pre-stabilization commit `e6a00349b455b031d6b96d2643ca4b795a8b9349`.
