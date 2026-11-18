# 04 — Functional & Bug Fix Report

## 1. Backend Functional & DevOps Fixes (Wave 2A — `b81f050`)

1. **AI Task & Prompt Completeness (`AiTask`, `PromptEngine`, `GeminiProvider`):**
   - Added missing `CODING` and `EXAM_STRATEGY` task variants so Code Lab hint ladders and Exam Simulator AI strategy requests resolve to dedicated tutor prompts instead of failing or falling back generically.
   - Redacted API key values in `GeminiProvider.safeMessage()` while preserving `?key=` stream compatibility.
2. **DSA Execution Harnesses (`DsaLang.java`):**
   - Fixed Go harness duplicate `package main` compile error when user code already declares `package main`.
   - Fixed Python and JavaScript matrix literal parsing (`[1,2;3,4]`) in test input conversion.
   - Hoisted user `import` statements in Java harness above generated wrapper classes.
   - Replaced unsafe `String.replaceAll` with `Matcher.quoteReplacement` for `%USER%` substitution so `$` / `\` in user code cannot corrupt harness generation.
   - Verified with 13/13 tests in `DsaLangHarnessTest`.
3. **Docker Sandbox Reliability (`SandboxExecutionService.java`):**
   - Prevented infinite-loop stdout deadlocks by draining stdout/stderr concurrently with bounded output caps and deterministic process termination.
   - Added explicit `--memory-swap` cap alongside `--memory` so containers cannot bypass memory limits via swap.
4. **Course Draft Visibility & Admin Separation (`CourseController`, `CourseRepository`):**
   - Filtered student `/api/courses` list and detail queries to published courses only.
   - Added admin-only `/api/admin/courses` so draft courses remain editable in the Admin Control Center without leaking to learners.
5. **Idempotent Progress & Query Cleanup (`ProgressController.java`):**
   - Made `/progress/{userId}/course/{courseId}/lesson/{lessonId}/complete` idempotent so repeated clicks cannot inflate completed lesson counts or XP.
   - Removed dead query that eagerly fetched 105 full lesson LOB rows on completion checks.
6. **Concurrency & Lifecycle (`LearningEventService`, `DataSeeder`, `DsaCatalog`, `GuestService`, `AiController`):**
   - Hardened `LearningEventService` against `REPEATABLE READ` concurrent insert races.
   - Marked seeded accounts `emailVerified=true` in `DataSeeder`.
   - Cached immutable problem summary views in `DsaCatalog`.
   - Decoupled guest purge from synchronous request paths (`GuestService`).
   - Added `@PreDestroy` executor shutdown and SSE disconnect cancellation in `AiController`.
7. **DevOps & Deployment Config (`deploy/*`):**
   - Enabled `microphone=(self)` in `deploy/nginx.conf` so Voice Tutor & AI Interviewer microphone access works behind Nginx.
   - Fixed `$${...}` escaping in `deploy/docker-compose.prod.yml` and hardened `deploy/fill-secrets.command`.

## 2. Frontend Functional Fixes (Wave 2B & Wave 4 — `fe8fd99`, `b477ace`)

1. **Transport Layer (`frontend/src/lib/api.js`):**
   - Fixed inverted `silentUpdate` guard so Lesson Doubt requests (`silentUpdate: true`) no longer trigger global `nova:learning-updated` refreshes.
   - Added bounded exponential backoff + jitter retries exclusively for idempotent `GET`/`HEAD` requests on transient `502`/`503`/`504`/`408`/network errors (never retrying mutating `POST` requests).
   - Added `AbortSignal` passthrough and single 401 session-refresh retry to `apiStream`.
2. **Markdown Rendering (`frontend/src/AiMarkdown.jsx`):**
   - Fixed bold-heading regexes and soft-wrapped paragraph joining.
   - Cleaned up `CodeBlock` copy-confirmation timeout on component unmount.
3. **GATE CSE (`frontend/src/gateCse.jsx`):**
   - Eliminated duplicate `hard_quiz.json` fetch that doubled question banks per paper (`hard_quiz.json` verified at 620 unique questions: 105 GA + 515 CS, 0 malformed answers).
   - Fixed Q65 primary button to invoke `finish()`.
   - Fixed split-origin notes URL resolution (`${API}/gate-cse/notes` + `resolveNoteUrl`), timer `finishRef` drift, and user-scoped history key.
4. **DSA Practice (`frontend/src/dsa.jsx`):**
   - Fixed `api()` call argument positions (`timeoutMs` inside 2nd options object instead of 3rd `_retry` boolean).
   - User-scoped local code draft storage (`dsa_code_${userScope}_${slug}_${lang}`) and wired deep problem slug routing.
5. **AI Teacher, Chat, Knowledge Hub, Mentor, Planner, Exam, Interviewer, Voice Tutor (`frontend/src/main.jsx`):**
   - **AiPanel:** Used `effectiveMessage` in `teacherRequest`, resolved `nova_ai_prefill` consumption race before `lessonContext` sync, added `AbortController` stream cancellation, and preserved partial streamed answers with an explicit error banner when streams drop mid-response.
   - **ChatWorkspace:** Added `skipFetchIdRef` so newly auto-created conversations do not wipe optimistic user messages; preserved UI state with inline error banner when clear/delete requests fail.
   - **KnowledgeHub:** Moved large PDF `chunks` out of `localStorage` persistence into React state (eliminating quota exhaustion), removed duplicate `/chunks` fetch, and switched `savePack` confirmation from red error banner to green `.success-banner`.
   - **AdaptiveMentor:** Reset `lessonId` when switching courses.
   - **StudyPlanner:** Rendered generated roadmaps via `<AiMarkdown>` instead of plain text.
   - **ExamSimulator:** Fixed stale timer closure via `finishRef` (preventing 0/20 score on expiry) and user-scoped best score.
   - **Interviewer:** Removed premature `setFinished(true)` in `askNext` so Question 10 is shown and answered before completing.
   - **VoiceTutor:** Fixed `clearSession` to clear `saveVoiceTutorMemory` (not AI Teacher memory) and fixed "Stop voice" button toggle.
   - **CodeLab / CourseDppIde / CommunityHub / CareerHub:** Fixed stale functional setter closures, challenge score double-counting, Career goal navigation (`dsa` vs `code`), and removed hardcoded local-dev Spring Boot/MySQL/Docker copy from user-facing errors.
   - **AdminControlCenter:** Switched `loadAll()` to `Promise.allSettled`, fetched `/admin/courses`, gated destructive user warning strictly on `modal.danger && modal.user`, replaced broken Knowledge "Inspect" anchor with authenticated chunk modal, aligned GATE subject keys, deduplicated settings inputs, and paused 60s polling when `document.hidden`.
   - **ErrorBoundary & Global Listeners:** Removed `nova-recover` event dispatch/listener loop; fixed missing `useCallback` import caught during Pass 1 browser verification.
