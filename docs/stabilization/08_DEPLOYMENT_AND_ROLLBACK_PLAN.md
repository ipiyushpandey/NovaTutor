# 08 — Deployment & Rollback Plan

> **Safety Gate:** No push to `main`, production database mutation, credential change, or Render deployment was executed during this stabilization mission. Execute this plan only after reviewing the branch diff and approving release.

## 1. Pre-Deployment Checklist

1. **Review branch diff against baseline:**
   ```bash
   git checkout stabilization/v2.4-security-reliability
   git log --oneline baseline/pre-stabilization-e6a0034..HEAD
   ```
2. **Verify required Render backend environment variables** (enforced by `ProductionConfigValidator` under `SPRING_PROFILES_ACTIVE=prod`):
   - `JWT_SECRET` (strong >= 32 chars, not a default placeholder)
   - `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` (TiDB Cloud TLS JDBC URL)
   - `APP_CORS_ALLOWED_ORIGINS` (exact production frontend origin, no `*`)
   - `GEMINI_API_KEY` (valid server-side key)
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` (if bootstrapping owner account)
   - `APP_TRUST_FORWARDED_HEADERS=true` (only behind trusted reverse proxy such as Render/Nginx)
3. **Database Compatibility Check:**
   - No destructive schema migrations or column drops were introduced.
   - Existing `users`, `courses`, `lessons`, `progress`, `chat_conversations`, `chat_messages`, `gate_notes`, `knowledge_documents`, `knowledge_chunks`, `learning_events`, and `dsa_problem_states` tables remain forward- and backward-compatible with baseline `e6a0034`.

## 2. Deployment Sequence (User-Approved)

1. Merge `stabilization/v2.4-security-reliability` into `main` via PR (letting `.github/workflows/ci.yml` run full Maven + Node tests + Vite build on GitHub Actions):
   ```bash
   git push -u origin stabilization/v2.4-security-reliability
   ```
2. Deploy **Backend** first on Render; confirm `/actuator/health` returns `200 OK` and logs show `HikariPool-1 - Start completed` with `maximumPoolSize=6` and zero `ProductionConfigValidator` errors.
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
