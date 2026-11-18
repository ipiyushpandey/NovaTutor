# 05 — Navigation, Scroll Restoration & UI/CSS Report

## 1. Desktop TopNav Zero-CLS Redesign

### Problem Found
- `TopNav` initialized `openMenu` to `activeGroup || null`, forcing a dropdown open on initial page render.
- `styles.css` applied `@media(min-width:961px){body:has(.topnav.subnav-open) .main-topnav{padding-top:calc(var(--topbar-h) + 210px)}}`, causing a ~210 px layout jump whenever any menu opened/closed and still overlapping taller 5-item panels.
- The chevron rotation selector targeted `.topnav-menu-btn svg` instead of `.nova-icon`.

### Fix Implemented
- Initialized `openMenu` to `null` in [`TopNav`](file:///Users/piyushpandey/Downloads/NovaTutor/frontend/src/main.jsx#L1807-L1815).
- Removed the `body:has(.topnav.subnav-open)` padding hack from [`styles.css`](file:///Users/piyushpandey/Downloads/NovaTutor/frontend/src/styles.css#L3095-L3106) and elevated `.topnav-panel` (`position: absolute; z-index: 120; box-shadow: var(--shadow-2)`).
- Updated chevron rotation to target both `svg` and `.nova-icon`.
- **Verified (Playwright Pass 1A):** Opening and closing all 4 desktop menus (`Learn`, `Practice`, `AI`, `More`) produces **0 px shift** on `<main class="main-topnav">` (`|openY - beforeY| <= 1px`).

## 2. Deep Hash Routing & Exact Back/Forward Scroll Restoration

### Problem Found
- Deep views (course lectures, DSA problem detail, GATE CSE tabs) lived only in local React state, so browser Back/Forward jumped out of context or reset to the wrong screen.
- Async content loading caused naive `window.scrollTo` on Back to clamp to `0`, and a `scroll` listener fired during mount clamp and overwrote the saved `scrollY` in `sessionStorage` with `0`.

### Fix Implemented
- Unified `parseAppHash` and `ALLOWED_PAGES` in [`main.jsx`](file:///Users/piyushpandey/Downloads/NovaTutor/frontend/src/main.jsx#L511-L580) supporting:
  - `#/course/:courseId` and `#/course/:courseId/lesson/:lessonId`
  - `#/dsa/:slug`
  - `#/gatecse/:tab`
  - Public/legal pages (`#/about`, `#/privacy`, `#/terms`, `#/contact`)
- Wired `Dashboard`, `MyLearningHub`, `Courses`, `CoursePage`, `CourseDetail`, `DsaPractice`, and `GateCse` to push/pop deep hash entries cleanly.
- Implemented `ResizeObserver`-backed scroll restoration keyed by full `routeKey` (`nova_scroll_v2:${routeKey}`) with `restoringScrollRef` locking out `saveCurrentScroll()` during Back/Forward transitions until target scroll settles or the user interacts.
- **Verified (Playwright Pass 1B & 1C):**
  - `Home (scrolled) -> Course 1 -> Lecture 2 -> AI Teacher -> Back -> Back -> Back` restores `#/course/1/lesson/102`, `#/course/1`, and `#/dashboard` at the exact saved scroll position (`<= 15px` delta).
  - `#/dsa -> #/dsa/two-sum -> Back` returns cleanly to `#/dsa`.

## 3. UI, Contrast, Theme & Responsive Fixes

| Area | Fix | Verification |
|---|---|---|
| Light-mode `.danger-btn` | Replaced trailing `.danger-btn{color:#fff}` override with high-contrast `color:var(--danger)` on tinted background (keeping `#fff` only on solid red `.ac-modal-actions .danger-btn`). | Playwright Pass 3 confirms computed color is not white. |
| Dark-mode GATE selected option | Fixed `:root.dark .gate-options button.selected` to use `background:var(--ink); color:var(--on-ink)` instead of dark-on-dark. | Verified in `styles.css`. |
| Light-mode `.dsa-hero` | Replaced dark hardcoded gradient with theme-aware `linear-gradient(135deg,var(--surface),var(--surface-2))`. | Verified in `styles.css`. |
| Dark-mode reload flash | Added synchronous pre-hydration script in [`index.html`](file:///Users/piyushpandey/Downloads/NovaTutor/frontend/index.html#L19) adding both `class="dark"` and `data-theme="dark"` before React mounts. | Playwright Pass 3 reload test + `stabilization.test.mjs`. |
| Voice Tutor clipping | Changed `.voice-main` from fixed `height:530px; overflow:hidden` to `min-height:460px; height:auto; overflow:visible` and removed duplicate CSS block. | Verified in `styles.css`. |
| Admin modal z-index on mobile | Raised `.ac-modal-backdrop` from `z-index:70` to `z-index:320` (above mobile admin toggle `270`). | Verified in `styles.css`. |
| Mobile auth & small phones | Switched `.auth`/`.auth-form` to `min-height:100dvh` and tuned `.main-topnav` padding for `<=480px` and `<=360px`. | Playwright Pass 3 passed all **12 viewports** (`320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1366, 1440, 1920`) with **zero horizontal overflow**. |
