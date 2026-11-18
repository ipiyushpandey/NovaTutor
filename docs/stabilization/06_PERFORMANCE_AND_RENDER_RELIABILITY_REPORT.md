# 06 — Performance & Render/TiDB Reliability Report

## 1. Render Free Tier (512 MB RAM + Cold Start) & TiDB Cloud Hardening

| Bottleneck / Risk | Remediation | Impact |
|---|---|---|
| **Eager LOB loading on 512 MB heap** | Replaced entity list fetches with metadata projections in `GateNoteRepository`, `KnowledgeDocumentRepository`, and removed dead 105-lesson LOB query in `ProgressController`. | Eliminates multi-megabyte heap spikes on dashboard/notes/library loads. |
| **TiDB 6 MB single-entry limit** | Capped `GateNote` uploads at 5 MB and truncated stored `KnowledgeDocument` preview text to 16 KB (full text chunked in `knowledge_chunks`). | Prevents TiDB write rejections on large study PDFs. |
| **HikariCP connection pool sizing (`application-prod.yml`)** | Tuned `maximum-pool-size: 8` (`DB_POOL_MAX`), `minimum-idle: 2` (`DB_POOL_MIN`), `connection-timeout: 10000` (`DB_POOL_CONNECTION_TIMEOUT_MS`), `max-lifetime: 600000` (`DB_POOL_MAX_LIFETIME_MS`), `keepalive-time: 180000` (`DB_POOL_KEEPALIVE_MS`). | Prevents connection exhaustion and stale TiDB socket errors under free-tier memory limits. |
| **Render cold-start resilience (`api.js` + `App`)** | Added bounded exponential backoff + jitter retry on idempotent `GET`/`HEAD` requests (`502/503/504/408`/network/timeout) while strictly refusing to retry mutating `POST` requests. Added non-intrusive `"Waking up NovaTutor server…"` status banner if bootstrap exceeds 4 seconds. | Smooth cold-start recovery without duplicate writes or premature login eviction. |
| **Unbounded rate-limit map & SSE executors** | Bounded IP bucket map eviction in `RequestRateLimitFilter`; added `@PreDestroy` executor shutdown and SSE disconnect cleanup in `AiController`. | Prevents slow memory/thread leaks across long-running Render instances. |
| **Request-path guest cleanup & DSA catalog rebuilds** | Removed synchronous guest purge from request path (`GuestService`); cached immutable problem summary list in `DsaCatalog`. | Lower p95 latency and fewer DB writes on hot endpoints. |

## 2. Frontend API Traffic & Browser Memory Optimization

| Bottleneck | Before | After | Verification |
|---|---|---|---|
| **Dashboard `/intelligence/:id` waterfall** | 3 parallel duplicate calls (`NovaLearningBrain`, `IntelligenceSnapshot`, `MasterySnapshot`) + 10s/15s timers even in background tabs. | Single shared `/intelligence/:id` fetch in `Dashboard`, passed via props, polled at 60s only when `!document.hidden`. | Playwright Pass 1A confirms `intelligence === 1` on mount. |
| **`/auth/me` bootstrap & token rotation** | Multiple bootstrap invocations + token rotated on every `/auth/me`. | Single guarded bootstrap per distinct user ID (`bootstrappedUserRef`) + `JwtService.shouldRotate()` threshold. | Playwright Pass 1A confirms `authMe === 1`. |
| **`Analytics` & `AdminControlCenter` polling** | `Analytics` polled every 3s unconditionally; `AdminControlCenter` polled in hidden tabs. | 60s visibility-aware polling paused when `document.hidden`, refreshing immediately on `visibilitychange` or `nova:learning-updated`. | Code verified + build tested. |
| **GATE CSE `hard_quiz.json` fetch** | Fetched ~320 KB JSON twice per load and doubled the in-memory question list. | Single fetch (`counts.hardQuiz === 1`), 620 unique questions preserved. | Playwright Pass 1D confirms `hardQuiz === 1`. |
| **Knowledge Hub `localStorage` bloat** | Entire extracted PDF `chunks` array written into `localStorage` via runtime store on every change. | `chunks` held strictly in React state; `useModulePersistence` debounces durable writes by 1.2s with synchronous flush on navigation/unmount. | Playwright Pass 1E confirms zero chunk text in `localStorage`. |

## 3. Production Bundle Baseline (Vite `v5.4.19`)

- `dist/index.html`: `2.69 kB` (`1.31 kB` gzip)
- `dist/assets/index-*.css`: `392.17 kB` (`69.74 kB` gzip)
- `dist/assets/index-*.js`: `545.56 kB` (`155.21 kB` gzip)
- `dist/assets/lottie-*.js`: `307.82 kB` (`79.08 kB` gzip)
- Code-splitting the main chunk below 500 kB is tracked in `09_DEFERRED_REFACTORING_PLAN.md`.
