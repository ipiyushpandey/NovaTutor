# NovaTutor — MERGE-BLOCKER-01 Surgical Fix Report

**Date:** 2026-11-18  
**Branch:** `remediation/v2.5.1-independent-audit-fixes`  
**Starting HEAD:** `69c3259`  
**Readiness Review Record Commit:** `261db75` (`docs/stabilization/FINAL_MERGE_READINESS.md`)  
**Fix & Test Commit:** `ea2e4a7` (`fix(frontend): guard 401 refresh-and-retry with isSameSession (MERGE-BLOCKER-01)`)  
**Preserved Branches (Untouched):** `main` (`e6a0034`), `stabilization/v2.4-security-reliability` (`40999f0`), `remediation/v2.5-audit-fixes` (`d3020d4`)

---

## 1. Exact Production Code Diff (`frontend/src/lib/api.js`)

```diff
diff --git a/frontend/src/lib/api.js b/frontend/src/lib/api.js
index ac7918a..935deab 100644
--- a/frontend/src/lib/api.js
+++ b/frontend/src/lib/api.js
@@ -127,7 +127,7 @@ async function api(path,opt={},_retry=false){
     // A short-lived/stale JWT can happen while a workspace is open. Refresh once
     // through /auth/me and retry the original request before declaring the session dead.
     let refreshStatus='unauthorized';
-    if(r.status===401&&!_retry&&session?.token&&path!=='/auth/me'&&!isCredentialCheckPath(path)){
+    if(r.status===401&&!_retry&&session?.token&&isSameSession(session)&&path!=='/auth/me'&&!isCredentialCheckPath(path)){
      refreshStatus=await refreshSessionTokenWithStatus();
      if(refreshStatus==='ok'){clearTimeout(timeout);if(externalSignal)externalSignal.removeEventListener('abort',onExternalAbort);return api(path,opt,true);}
     }
@@ -198,7 +198,7 @@ async function apiStream(path,opt={},onChunk,_retry=false){
   resetIdleTimer();
   if(!r.ok){
    let refreshStatus='unauthorized';
-   if(r.status===401&&!_retry&&session?.token){
+   if(r.status===401&&!_retry&&session?.token&&isSameSession(session)){
     refreshStatus=await refreshSessionTokenWithStatus();
     if(refreshStatus==='ok'){
      clearTimeout(idleTimer);
```

### Diff Summary (`261db75..ea2e4a7`)

```text
 frontend/src/lib/api.js                 |  4 +-
 frontend/src/lib/stabilization.test.mjs | 89 ++++++++++++++++++++++++++++++---
 2 files changed, 83 insertions(+), 10 deletions(-)
```

---

## 2. Regression Coverage Added (`frontend/src/lib/stabilization.test.mjs`)

1. **Normal API (`api()`) Cross-Account Stale 401 (`lines 240–269`):** User A initiates `POST /quizzes/course/1/submit`, switches to User B before User A's request returns `401`, `/auth/me` is mocked to return `200 OK` for User B if called — verified `authMeCallsAfterSwitch === 0`, `staleApiCalls === 1` (zero replay under User B's token), User B remains authenticated in `localStorage['ai_user']`, and `nova-session-expired` count === `0`.
2. **Streaming API (`apiStream()`) Cross-Account Stale 401 (`lines 271–300`):** User A initiates `POST /ai/ask/stream`, switches to User B before User A's stream returns `401`, `/auth/me` is mocked to return `200 OK` for User B if called — verified `streamAuthMeCalls === 0`, `staleStreamCalls === 1` (zero replay under User B's token), User B remains authenticated, and `nova-session-expired` count === `0`.
3. **Same-Session Refresh & Retry Preserved (`lines 302–329` + existing `apiStream` 401 test):** Verified that when the originating session remains unchanged, a `401` still calls `/auth/me` once, rotates the token, and retries the original request with `Bearer tok-B-rotated` to `200 OK`.

---

## 3. Validation Results

| Suite | Command | Result |
|---|---|---|
| **Frontend Unit Tests** | `npm test` (cwd: `frontend/`) | **19 / 19 PASS** (`0` fail, `0` skip; `1.10s`) |
| **Vite Production Build** | `npm run build` (cwd: `frontend/`) | **PASS** (`1.38s`, `0` errors) |
| **Playwright `stabilization.spec.js`** | `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/stabilization.spec.js --project=desktop --project=mobile` | **26 / 26 PASS** (`13` desktop + `13` mobile; `40.7s`) |

---

## 4. Merge Readiness Status

`MERGE-BLOCKER-01` — the sole remaining local blocker identified in `docs/stabilization/FINAL_MERGE_READINESS.md` — is **RESOLVED**. External staging verification gates (TiDB Cloud migration, Render live `/ide-preview.html` CSP header check, and Docker host smoke test if self-hosted Docker mode is used) remain documented in `FINAL_MERGE_READINESS.md`.
