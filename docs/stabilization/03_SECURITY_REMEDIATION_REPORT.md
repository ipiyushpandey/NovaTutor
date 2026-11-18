# 03 — Security Remediation Report

## 1. Critical Vulnerabilities Remediated

### 1.1 Chat API Sensitive Entity Exposure (`ChatController`)
- **Root Cause:** Returning raw Hibernate-managed `ChatConversation` and `ChatMessage` entities allowed Jackson to traverse `@ManyToOne User` references, exposing sensitive columns (`passwordHash`, `verificationTokenHash`, `resetTokenHash`, `googleSub`, internal account flags).
- **Fix:** Replaced raw entity responses in [`ChatController.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/chat/ChatController.java) with explicit response DTOs (`ConversationSummary`, `MessageView`) and explicit field mapping. Added `@JsonIgnore` / lazy boundary guards on persistence entities as defense-in-depth.
- **Verification:** `SecurityRemediationTest` creates conversations and messages and asserts the serialized JSON payloads contain zero occurrences of `passwordHash`, `verificationTokenHash`, `resetTokenHash`, `googleSub`, or nested `user` objects.

### 1.2 Course IDE HTML Preview XSS (`CourseDppIde`)
- **Root Cause:** The HTML preview `<iframe>` rendered untrusted user-authored HTML/JS via `srcDoc` without strict origin isolation, allowing scripts to read `window.parent.localStorage.getItem('ai_user')` (containing the active JWT) or mutate the parent DOM.
- **Fix:** Restricted the preview iframe in [`main.jsx`](file:///Users/piyushpandey/Downloads/NovaTutor/frontend/src/main.jsx) to `sandbox="allow-scripts" referrerPolicy="no-referrer"` (strictly omitting `allow-same-origin`).
- **Verification:**
  - Static invariant test in `stabilization.test.mjs` asserts `sandbox="allow-scripts"` and absence of `allow-same-origin`.
  - Adversarial Playwright test (`Pass 2A`) injects `<script>window.parent.localStorage.setItem('xss_pwned','1'); window.parent.document.title='XSS_PWNED';</script>` into the HTML editor, executes preview, and confirms `localStorage.getItem('xss_pwned') === null` and `document.title !== 'XSS_PWNED'`.

### 1.3 Rate Limiter Hardening (`RequestRateLimitFilter`)
- **Root Cause:** Blindly trusting `X-Forwarded-For` enabled trivial IP spoofing to bypass auth/AI rate limits, and an unbounded map of IP buckets created a memory exhaustion vector under distributed probing.
- **Fix:** Hardened [`RequestRateLimitFilter.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/security/RequestRateLimitFilter.java) with trusted-proxy-aware IP extraction, bounded map eviction to cap heap usage, and separated rate buckets across auth, guest, AI, code execution, and general API endpoints.

### 1.4 JWT Revocation, Rotation Threshold & Session Security (`JwtService`, `AuthController`, `UserController`)
- **Root Cause:** Changing or resetting a password left previously issued JWTs valid until natural expiry; `/auth/me` rotated tokens unnecessarily on every poll.
- **Fix:** Embedded a truncated password fingerprint (`pwf`) claim in [`JwtService.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/security/JwtService.java) validated on every request in [`JwtAuthenticationFilter.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/security/JwtAuthenticationFilter.java), added `shouldRotate()` so `/auth/me` only mints a new token near expiry, and enforced anti-enumeration (`202 Accepted`) + pre-registration takeover guards in [`AuthService.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/service/AuthService.java).
- **Verification:** `SecurityRemediationTest` confirms a JWT issued before a password change is immediately rejected (`401`) afterward, and `forgot-password` / `resend-verification` return identical `202 Accepted` payloads for existing and non-existent emails.

### 1.5 Authorization, Ownership & Guest Isolation
- **Fixes:**
  - Enforced `ownAccount(id, authentication)` in [`UserController.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/controller/UserController.java) and ownership checks across `AdaptiveController` and `ChatController`.
  - Blocked `GUEST` accounts from persistent write operations in `CommunityController` and account mutation endpoints.
  - Redacted hidden DSA test inputs/expected outputs in [`DsaJudgeService.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/dsa/DsaJudgeService.java).
  - Hardened frontend `#/admin` route guard (both direct initial URL and `hashchange`) to redirect non-admins immediately to `#/dashboard` (verified in Playwright `Pass 2B`).

### 1.6 LOB / Heap Exhaustion & Production Configuration Guards
- **Fixes:**
  - Replaced eager LOB fetches on list endpoints (`GateNoteRepository`, `KnowledgeDocumentRepository`, `ProgressController`) with lightweight metadata projections.
  - Bounded `GateNote` uploads at 5 MB and `KnowledgeDocument` preview text at 16 KB (preventing TiDB 6 MB entry limit failures and 512 MB heap OOMs).
  - Hardened [`SecurityConfig.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/config/SecurityConfig.java), [`GlobalExceptionHandler.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/controller/GlobalExceptionHandler.java) (explicit `405` instead of `500`), and [`ProductionConfigValidator.java`](file:///Users/piyushpandey/Downloads/NovaTutor/backend/src/main/java/com/aitutor/config/ProductionConfigValidator.java).

## 2. Secret Scanning Results (Pass 2)

- Tracked repository scan (`git grep` for Google/OpenAI/GitHub keys, private keys, embedded JDBC passwords): **0 findings (`NO_TRACKED_SECRETS_FOUND`)**.
- Production bundle scan (`frontend/dist/`): **0 findings (`NO_DIST_SECRETS_FOUND`)**.
- `GeminiProvider.safeMessage()` verified to redact both `key=...` query params and the literal configured API key from exception strings before logging or returning messages.
