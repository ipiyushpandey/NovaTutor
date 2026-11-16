# NovaTutor — public deployment runbook

Target architecture (all free tier, no payment method required):

```text
Browser (desktop / mobile, HTTPS)
        |
        |  https://<frontend>
        v
Free static site  (React + Vite build, SPA rewrite /* -> /index.html)
        |
        |  https://<backend>/api/**   (Authorization: Bearer <JWT>, CORS allowlisted)
        v
Render free Docker web service   (Java 21, Spring Boot 3.5.3, profile "prod", /actuator/health/readiness)
        |
        |  JDBC over TLS
        v
TiDB Cloud Serverless Starter    (MySQL-compatible: 5 GiB row storage, free quota)
```

## Why these providers

| Need | Provider | Free-tier reality |
| --- | --- | --- |
| Backend (Java 21 + Docker) | Render web service, `plan: free` | 512 MB RAM / 0.1 CPU, 750 instance-hours per month, no credit card. Sleeps after 15 min without traffic, ~1 min cold start. |
| Frontend (static) | Render static site | Always free, no sleep, HTTPS, custom domains. |
| Database (MySQL) | TiDB Cloud Starter | MySQL-protocol compatible, 5 GiB row storage + request-unit quota per month, no credit card, permanent free plan. |
| PDF / file storage | Application database | NovaTutor stores uploaded PDF bytes and GATE notes in MySQL (`KnowledgeDocument`, `GateNote`), so no separate object store or persistent disk is needed. |

Rejected on current facts (checked November 2026):

- **Aiven free MySQL** — retired: no new free MySQL services since 6 Nov 2026, EOL 21 Dec 2026.
- **Render free Postgres** — wrong engine and expires 30 days after creation.
- **Koyeb, Fly.io, Heroku, Glitch** — no card-free permanent free tier for this workload.
- **Render persistent disks** — paid plans only, so local-disk uploads would be lost on every deploy. Not used.
- **Docker-in-Docker code sandbox** — unavailable on any free host; `CODE_RUNNER_ENABLED=false` in production (the app degrades gracefully).

## Configuration changes made for deployment

| File | Change | Why |
| --- | --- | --- |
| `backend/src/main/resources/application.properties` | `server.port=${PORT:8080}` | Hosts assign the port at runtime (Render sets `PORT`). |
| `backend/src/main/resources/application.yml` | `server.port: ${PORT:8080}` | Same, for the YAML copy of the setting. |
| `backend/src/main/resources/application-prod.yml` | `ddl-auto: ${JPA_DDL_AUTO:validate}` | Managed DBs start empty; first deploy uses `update` to create the schema, later deploys `validate`. |
| `backend/src/main/resources/application-prod.yml` | `app.seed.enabled: ${APP_SEED_ENABLED:false}` | Lets the first deploy seed the 13 courses / 105-lesson curriculum and quiz bank on an empty schema. The seeder never wipes existing data. |
| `render.yaml` (new) | Blueprint for backend + static frontend | Declarative infra; secrets referenced with `sync: false`. |
| `deploy/backend.Dockerfile` | Creates a writable `/app/gate-notes`, sets `GATE_NOTES_DIR` | The app creates that directory at startup as an unprivileged user. |

Nothing else in the application, UI, security config or business logic was changed.

## Required environment variables (backend)

| Variable | Notes |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `prod` |
| `DB_URL` | `jdbc:mysql://<host>:4000/ai_tutor?sslMode=VERIFY_IDENTITY&serverTimezone=Asia/Kolkata&allowPublicKeyRetrieval=true` |
| `DB_USERNAME` / `DB_PASSWORD` | Database user, not the cluster admin. |
| `JPA_DDL_AUTO` | `update` for the very first deploy, then `validate`. |
| `JWT_SECRET` | ≥ 32 bytes, random, unique per environment (HS512 signing key). |
| `GEMINI_API_KEY` | Server-side only; never in the frontend bundle. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Owner account, password ≥ 12 chars. |
| `CORS_ORIGINS` | Exact frontend origin, e.g. `https://novatutor.onrender.com`. No localhost (the app refuses to start). |
| `APP_SEED_ENABLED` | `true` first deploy only. |
| `CODE_RUNNER_ENABLED` | `false` (no Docker-in-Docker on free hosting). |

The `prod` profile refuses to boot if any of these are missing, if `JWT_SECRET` is under 32 bytes, if the admin password is under 12 characters, or if `CORS_ORIGINS` contains a localhost origin. That validator is intentional and was left in place.

## Deployed environment

| Item | Value |
| --- | --- |
| Public frontend | https://novatutor.onrender.com |
| Public backend API | https://novatutor-api.onrender.com |
| Health / readiness | https://novatutor-api.onrender.com/actuator/health |
| Frontend service | `srv-dbth426tlv9c73fc68b0` (static site) |
| Backend service | `srv-dbth3son74is73btgai0` (Docker web service, free) |
| Database | TiDB Cloud Serverless Starter, `gateway01.ap-southeast-1.prod.aws.tidbcloud.com:4000`, database `ai_tutor` |
| Owner workspace | `tea-dbtgmodckfvc73eqmh30` |
| Deployed commit | `1a61886` |

Seeded content: 13 courses, 1365 lessons (13 × 105), 1260 quiz questions, 1 owner account.

`deploy/secrets.env` holds every credential (gitignored, mode 600). The owner/admin login is `ADMIN_EMAIL` + `ADMIN_PASSWORD` from that file.

## Redeploying after a GitHub push

A push to `main` is the normal workflow:

```bash
git add -A
git commit -m "your change"
git push origin main
```

Pushes build and deploy both services. If a push does not produce a new deploy, the Render GitHub App is not wired to the repo yet — either fix that in Render → **Account Settings → GitHub**, or deploy immediately from the dashboard with **Manual Deploy → Deploy latest commit**.

Backend changes take 4–6 minutes (Maven build inside Docker). Frontend changes rebuild in about a minute.

## Deployment notes and gotchas

- **`publishPath`, not `staticPublishPath`.** The Render API field for a static site's output directory is `publishPath`. A `PATCH` on `serviceDetails` replaces the whole object, so always resend `buildCommand` with it — omitting it silently publishes an empty site.
- **Hash routing.** The frontend routes with `#/login`, `#/dashboard`, so no server-side SPA rewrite is required; every deep link resolves to `/`. The `routes` rewrite in `render.yaml` is optional hardening.
- **Writable directory.** `AdminController` creates the GATE notes directory in its constructor. The image runs as UID 10001, so the Dockerfile creates `/app/gate-notes` with that owner and sets `GATE_NOTES_DIR`. Without this the container fails at startup with `Could not initialize GATE notes storage`.
- **Schema init.** The TiDB schema was created once with `JPA_DDL_AUTO=update` and then switched to `validate`. Never use `create`/`create-drop` here.
- **Environment variables** are managed in Render (service → Environment). Rotating `JWT_SECRET` signs every user out; rotating `ADMIN_PASSWORD` only affects the next login.

## Accessing NovaTutor from any device

Open `https://<frontend-host>` on any phone, tablet or laptop. No install, no tunnel, no local server. Sessions are JWT-based in `localStorage`, so signing in on one device does not sign you out on another.

## Known free-tier limitations

- The backend sleeps after 15 idle minutes; the first request afterwards takes ~1 minute (the frontend shows a slow first load, not an error).
- 512 MB RAM / 0.1 CPU: AI streaming works, but concurrent load is limited; 750 instance-hours per month is roughly one always-on service.
- 5 GB outbound bandwidth per month across both services.
- No Docker sandbox: DSA/coding judge execution is disabled in production; problem browsing, progress and AI hints still work.
- Database: 5 GiB storage and a monthly request-unit quota. Reaching the quota suspends new connections until the month resets.
- Free tiers carry no SLA and Render marks free instances as "not for production use".
