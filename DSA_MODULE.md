# DSA Practice Module

The DSA Practice module is a standalone, judge-style coding arena inside NovaTutor. It ships **328 curated problems** (easy → hard) across Arrays, Strings, Binary Search / Sorting, Linked Lists / Heaps / Stacks & Queues, Trees, Graphs and Dynamic Programming, each backed by a **reference oracle** so hidden tests are always consistent with the visible samples.

## Features

- **Judge protocol** — implement one `solve(...)` function per problem; the harness reads every test from stdin and prints exactly one canonical output line per test.
- **6 sandbox languages** — Java, Python, C++, C, JavaScript and Go (C is unavailable for problems that return a matrix).
- **Visible samples + hidden tests** — samples are shown in the UI; hidden tests run server-side and never leave the backend.
- **Progress tracking** — per-user attempts, solved/attempted status, bookmarks and auto-saved code per problem and language (`dsa_problem_states` table).
- **Nova AI mentor** — three hint levels (nudge, approach, review) powered by the existing Gemini AI service.
- **Premium standalone page** — `#/dsa` with hero, stats, filters (difficulty/topic/status/search/bookmarks) and a full problem workspace.

## Backend layout (`backend/src/main/java/com/aitutor/dsa/`)

| File | Purpose |
| --- | --- |
| `DsaProblem` | Record holding statement, signature, tests and oracle; parses test lines, canonicalizes outputs |
| `DsaSig` / `DsaKind` / `DsaFns` | The 15 supported signatures (A2A, A2I, AI2I, AS2I, I2A, I2I, I2M, II2I, S2I, S2S, SI2I, SI2S, SS2I, SS2S, SSS2I) and their functional interfaces |
| `DsaLang` | Per-language starter code + judge harness templates |
| `DsaCatalog` / `DsaTopics` | Registry and the six topic banks (328 problems total) |
| `DsaBankArrays` … `DsaBankGraphs` | Curated problem banks with oracle lambdas |
| `DsaJudgeService` | Executes a submission once in the Docker sandbox and grades all tests from its output |
| `DsaController` | `/api/dsa/**` REST endpoints (all authenticated except catalog reads) |
| `DsaProblemState` (+ repository) | JPA entity for per-user progress |

## Judging protocol

Each test case is **one line on stdin**; parameters are joined by `|`:

- Arrays: comma-separated ints (`2,7,11,15`)
- Matrices: rows separated by `;` (`1,2;3,4`)
- Strings: raw text (a scalar named `k`/`n` is written as `n=1994` to avoid collisions)
- Scalars: plain integers

The generated `main` prints exactly one line per test: `[a,b]` for arrays, `[r1;r2]` for matrices, raw values otherwise. Expected outputs for hidden tests are computed server-side by running the problem's oracle, so the hidden set can never disagree with the samples.

## API endpoints (`/api/dsa`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/problems` | Full catalog summary (JSON) |
| GET | `/stats` | Totals by difficulty and topic |
| GET | `/problems/{slug}` | Problem detail + visible samples |
| GET | `/problems/{slug}/starter?language=` | Starter code for a language |
| POST | `/problems/{slug}/run` | Judge a submission `{language, code}` |
| POST | `/problems/{slug}/hint` | AI hint `{mode: hint\|approach\|review, code?}` |
| GET | `/progress` | Per-problem status/attempts/bookmarks/saved code |
| POST | `/progress/{slug}/code` | Save editor code for later |
| POST | `/progress/{slug}/bookmark` | Toggle bookmark |
| GET | `/progress/summary` | Solved/attempted/bookmarked totals and breakdowns |

## Frontend

- `frontend/src/dsa.jsx` — the module (hero + browser + problem workspace with editor, judge results, AI mentor)
- Wired into `main.jsx` (sidebar nav, `#/dsa` route, GlobalSearch, Prepare hub tab) with `dsa-*` styles in `styles.css` including full dark-mode support.

## Sandbox requirement

Judging runs through the existing Docker-based `SandboxExecutionService`. Without Docker the UI surfaces a clear `SANDBOX_NOT_ENABLED` message; catalog browsing, progress and AI hints still work.

## Dev tooling (`tools/`, not needed at runtime)

- `regen_banks.py` — rewrites/normalizes bank factories; re-run the lowercase fix pass afterwards (`DsaCatalog.A2A(` → `DsaCatalog.a2a(`).
- `gen_core.py` — regenerates `DsaSig`/`DsaFns` from bank factory names; manual additions (SI2S) are preserved only if a bank uses them.
- Bank backups: `/tmp/dsa_backup/DsaBank*.java` (session-local).
