# NovaTutor — Preview & Redesign Run Guide

This thread runs the **frontend redesign** (backend frozen). Workspace root:
`/Users/piyushpandey/Downloads/NovaTutor_PUBLIC_GITHUB`

## How to reproduce the artifacts (fresh checkout)

1. **Dependencies** — frontend only; the redesign adds no new packages:
   ```bash
   cd frontend && npm install
   ```
2. **Env files** — the frontend needs no secrets (only optional `VITE_API_URL`).
   Optionally copy `frontend/.env.example` to `frontend/.env.local` and adapt.
3. **Backend secrets (only if you also run the API):** copy the setup template
   and fill in real values — never commit the filled copy:
   ```bash
   cp backend/.env.properties.example backend/.env.properties
   # then edit backend/.env.properties: MySQL creds, JWT secret, Gemini key
   ```
   The template is committed; the filled `backend/.env.properties` is gitignored.
4. **Rollback baseline:** the pre-redesign frontend source is snapshotted at
   `.freebuff/redesign-baseline/` (src/, index.html, package.json, vite.config.js).
   Restore by copying those files back over `frontend/`.

## How to run the servers

**Frontend (Vite dev server on the default port 5173):**
```bash
cd frontend && node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort
```
For a detached run that survives this conversation (macOS):
```bash
printf '#!/bin/bash\ncd /Users/piyushpandey/Downloads/NovaTutor_PUBLIC_GITHUB/frontend\nexec /usr/local/bin/node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort\n' > /tmp/novatutor-vite.sh
chmod +x /tmp/novatutor-vite.sh
launchctl submit -l novatutor-preview -o /tmp/novatutor-vite.out -e /tmp/novatutor-vite.err -- /bin/bash /tmp/novatutor-vite.sh
# verify: curl -s -o /dev/null -w "%{http_code}" http://localhost:5173  -> 200
# stop:  launchctl remove novatutor-preview
```
Dev-server log file for this thread: `.freebuff/preview-<threadid>.log`.

**Backend (Spring Boot on 8080, needed for login/data):**
```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
cd backend && "/Applications/IntelliJ IDEA CE.app/Contents/plugins/maven/lib/maven3/bin/mvn" -q spring-boot:run
```
Health check: `curl http://localhost:8080/api/health` → `{"status":"UP",...}`.
Vite proxies `/api → http://localhost:8080` (see `frontend/vite.config.js`), so the
frontend works on any Vite port while the backend stays on 8080.

**Verification account (seeded locally):** `novaverify.1790708583@example.com` /
`Novatest#2026` — student role, used for UI verification. Admin credentials are
seeded externally and are not known to this thread.

## Redesign notes

- Design foundation lives in `frontend/src/ui/` (tokens.css, motion.css,
  primitives.css, primitives.jsx) and `frontend/src/lib/api.js`.
- Backend is FROZEN: no changes to `backend/` in any phase.
