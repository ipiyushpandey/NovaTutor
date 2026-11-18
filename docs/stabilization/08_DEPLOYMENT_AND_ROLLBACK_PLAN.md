# 08 — Deployment & Rollback Plan

> **Safety Gate:** No push to `main`, production database mutation, credential change, or Render deployment was executed during this stabilization mission. Execute this plan only after reviewing the branch diff and approving release.

## 1. Pre-Deployment Checklist

1. **Review branch diff against baseline:**
   ```bash
   git checkout remediation/v2.5.1-independent-audit-fixes
   git log --oneline baseline/pre-stabilization-e6a0034..HEAD
   ```
2. **Verify required Render backend environment variables** (enforced by `ProductionConfigValidator` under `SPRING_PROFILES_ACTIVE=prod`):
   - `JWT_SECRET` (strong >= 32 bytes, not a default placeholder)
   - `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` (TiDB Cloud TLS JDBC URL)
   - `CORS_ORIGINS` (exact `https://` production frontend origin(s), no `*`, no localhost/loopback)
   - `GEMINI_API_KEY` (valid server-side key)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` (owner account; password >= 12 chars)
   - `RATE_LIMIT_TRUST_PROXY=true` (only behind trusted reverse proxy such as Render/Nginx; uses `server.forward-headers-strategy=native` and RFC1918/loopback `TRUSTED_PROXY_REGEX` default)
   - `JPA_DDL_AUTO=validate` (after applying SQL migration), `APP_SEED_ENABLED=false`
3. **Database Migration Requirement (v2.5 / v2.5.1 Audit Remediation):**
   - On an **existing** production DB, apply [`database/migrations/V2026_11_18__stabilization_v25.sql`](../../database/migrations/V2026_11_18__stabilization_v25.sql) **before** deploying with `JPA_DDL_AUTO=validate`:
     - Creates `pending_registrations` (for token-bound email verification preventing pre-registration takeover).
     - Widens `dsa_problem_state.last_code` from `TEXT` (64 KiB) to `MEDIUMTEXT` (16 MiB).
   - On a **brand-new empty** database (e.g., fresh Docker Compose MySQL volume), boot once with `JPA_DDL_AUTO=update` to create base tables before switching to `JPA_DDL_AUTO=validate` (because `ALTER TABLE dsa_problem_state` assumes base tables already exist).

## 2. Deployment Sequence (User-Approved)

1. Merge `remediation/v2.5.1-independent-audit-fixes` into `main` via PR (letting `.github/workflows/ci.yml` run full Maven + Node tests + Vite build on GitHub Actions):
   ```bash
   git push -u origin remediation/v2.5.1-independent-audit-fixes
   ```
2. Apply `database/migrations/V2026_11_18__stabilization_v25.sql` against the production TiDB/MySQL database.
3. Deploy **Backend** first on Render; confirm `/actuator/health/readiness` returns `200 OK` and logs show `HikariPool-1 - Start completed` with `maximumPoolSize=8` and zero `ProductionConfigValidator` errors.
4. Deploy **Frontend** static site; confirm `VITE_API_URL` points to the production backend.
5. Run post-deploy live smoke checks:
   - Sign in as student + guest; verify `/auth/me` fires once, Dashboard loads cleanly, and guest cannot post in Community.
   - Open `Course -> Lecture -> AI Teacher -> Back` and verify exact scroll restoration.
   - Open `DPP & IDE` HTML preview and verify `sandbox="allow-scripts"` with zero CSP errors in DevTools console.
   - Sign in as admin; confirm `/api/admin/courses` shows drafts and non-admins are blocked from `#/admin`.
   - Check `Chat` response in DevTools Network tab to confirm zero sensitive user fields (`passwordHash`, etc.).

## 3. Rollback Plan & Schema Compatibility Limitations

> **Important Schema Compatibility Notice (`TEXT` vs `MEDIUMTEXT`):**
> `V2026_11_18__stabilization_v25.sql` widens `dsa_problem_state.last_code` from `TEXT` to `MEDIUMTEXT` and adds `pending_registrations`. Existing user data is **not** destroyed, **however `e6a0034` declares `DsaProblemState.lastCode` as `columnDefinition = "TEXT"`**. Rolling back directly to `e6a0034` while `JPA_DDL_AUTO=validate` is enabled will fail Hibernate schema validation at startup (`Found: mediumtext, expected: text`).

To roll back safely to `e6a0034`:

1. **Choose a schema-compatible rollback path:**
   - **Fastest zero-DDL rollback (< 2 min):** Temporarily set `JPA_DDL_AUTO=none` on the Render backend service, then trigger "Rollback to this deploy" on the previous `e6a0034` backend and frontend deploys. (`pending_registrations` is ignored by `e6a0034` and `MEDIUMTEXT` reads/writes normally at runtime.)
   - **Strict `validate` rollback (only if reverting `last_code` to `TEXT`):** First confirm no row exceeds 64 KiB:
     ```sql
     SELECT COUNT(*) FROM dsa_problem_state WHERE OCTET_LENGTH(last_code) > 65535;
     ```
     Only if the count is `0`, run `ALTER TABLE dsa_problem_state MODIFY COLUMN last_code TEXT;` (reverting >64 KiB rows would truncate data and is unsafe), then deploy `e6a0034` with `JPA_DDL_AUTO=validate`.
2. **Git Rollback:**
   ```bash
   git checkout main
   git revert --no-commit baseline/pre-stabilization-e6a0034..HEAD
   git commit -m "revert: rollback stabilization release to baseline e6a0034"
   git push origin main
   ```
3. **Preserved Tag:** `baseline/pre-stabilization-e6a0034` permanently marks the pre-stabilization commit `e6a00349b455b031d6b96d2643ca4b795a8b9349`.
