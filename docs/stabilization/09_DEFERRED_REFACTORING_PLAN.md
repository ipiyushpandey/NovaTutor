# 09 — Deferred Refactoring & Future Architecture Plan

During this stabilization mission, broad architectural rewrites were deliberately avoided to keep regressions near zero while closing every critical security, functional, navigation, and reliability gap. The following high-value refactors are recommended for the next planned engineering cycle:

## 1. Frontend Monolith Decomposition & Code Splitting
- **Current State:** `frontend/src/main.jsx` (~2,000 lines) bundles 25+ modules into a single `545 kB` JS chunk (`155 kB` gzip), and `frontend/src/styles.css` (~3,480 lines) compiles into a single `392 kB` CSS asset (`70 kB` gzip).
- **Recommended Refactor:**
  1. Extract feature modules (`Dashboard`, `CourseDetail`, `AiPanel`, `ChatWorkspace`, `KnowledgeHub`, `ExamSimulator`, `Interviewer`, `VoiceTutor`, `CodeLab`, `CourseDppIde`, `SettingsPage`, `Auth`) into `frontend/src/features/*`.
  2. Lazy-load heavy views (`AdminControlCenter`, `GateCse`, `DsaPractice`, `KnowledgeHub`, `LottiePlayer`) with `React.lazy()` + `<Suspense>` to bring initial JS payload under `200 kB` gzipped.
  3. Adopt a lightweight router (e.g., React Router v7 hash/browser router) preserving the deep route schema (`#/course/:id/lesson/:lid`, `#/dsa/:slug`, `#/gatecse/:tab`) and scroll restoration contract.

## 2. CSS Architecture Cleanup
- **Current State:** Legacy styles (`styles.css`) and redesign tokens (`ui/tokens.css`, `ui/primitives.css`, `ui/premium.css`) overlap via cascade order and specificity overrides.
- **Recommended Refactor:** Consolidate duplicate component selectors, eliminate remaining `!important` overrides, and split CSS per feature module or adopt CSS Modules.

## 3. Database Migrations & Indexing (TiDB / MySQL)
- **Current State:** Schema relies on Hibernate `ddl-auto` + `DatabaseBootstrap` / `DataSeeder` rather than versioned migrations, and several frequently filtered columns lack explicit composite indexes.
- **Recommended Refactor:**
  1. Introduce **Flyway** (or Liquibase) with a baseline migration matching current production TiDB tables and switch Hibernate to `ddl-auto: validate` in `prod`.
  2. Add composite indexes on:
     - `learning_events(user_id, created_at)`
     - `quiz_attempts(user_id, created_at)`
     - `chat_messages(conversation_id, created_at)`
     - `chat_conversations(user_id, updated_at)`
     - `knowledge_chunks(document_id, page)`
     - `users(role, expires_at)` (for scheduled guest cleanup)

## 4. Refresh Tokens & Stateless Revocation Store
- **Current State:** Short-lived/rotatable JWT with `pwf` claim validated against the `users` table on each request.
- **Recommended Refactor:** Move to `HttpOnly; Secure; SameSite=Lax` refresh cookies paired with short-lived in-memory access tokens (removing JWT storage from `localStorage` altogether) and optional Redis-backed rate limiting + revocation once scaling beyond a single Render instance.

## 5. Dedicated Sandbox Worker & Live E2E CI Job
- Run code execution (`SandboxExecutionService`) in an isolated, network-disabled worker container with strict seccomp/cgroup quotas rather than co-locating with the Spring Boot API container.
- Add a CI job in `.github/workflows/ci.yml` that runs Playwright `stabilization.spec.js` against `vite preview` (and optionally a live H2 Spring Boot instance) on every PR.
