# NovaTutor UI Evidence Catalog

This catalog documents the 23 browser screenshots captured during automated visual testing across Desktop, Laptop, Tablet, Mobile, and Small Mobile viewports.

## Screenshot Index

### 1. Desktop 1440 × 900
1. `desktop_1440_dashboard_light.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** Baseline light-mode Dashboard with top navigation closed. Verifies initial layout coordinates (`rect.top = 57px`).
2. `desktop_1440_dashboard_dark.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** Dark theme (`data-theme="dark"`) Dashboard presentation. Verifies contrast, card boundaries, and dark typography.
3. `desktop_1440_topnav_learn_open.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** "Learn" dropdown overlay panel open over Dashboard. Verifies zero layout shift on `<main>` (`deltaY = 0px`), item icons, active indicator (`•`), and shadow elevation.
4. `desktop_1440_topnav_practice_open.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** "Practice" dropdown overlay panel open over Dashboard. Verifies Practice Hub, DSA Practice, Exam Simulator, GATE CSE, and Revision links.
5. `desktop_1440_topnav_ai_open.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** "AI" dropdown overlay panel open over Dashboard. Verifies AI Teacher, AI Chat, Nova Brain, and AI Mentor links.
6. `desktop_1440_topnav_more_open.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** "More" dropdown overlay panel open over Dashboard. Verifies Community, Achievements, Career, About, and Admin Panel links.
7. `desktop_1440_topnav_account_open.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** Account avatar dropdown panel open at right viewport edge (`.account-panel`). Verifies user name, role badge, Settings link, and Log out action.
8. `desktop_1440_topnav_learn_dark.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** "Learn" dropdown overlay panel open under dark theme. Verifies dark-mode contrast, elevated panel surface (`#151927`), and border styling.
9. `desktop_1440_course_detail.png`
   - **Viewport:** 1440 × 900
   - **Tested Behavior:** Course 1 detail view (`#/course/1`). Verifies breadcrumb Back navigation, chapter navigation sidebar, and lecture reading card.
10. `desktop_1440_course_scroll_restored.png`
    - **Viewport:** 1440 × 900
    - **Tested Behavior:** Dashboard view after browser Back (`history.back()`). Verifies exact scroll restoration to the "Continue learning" course cards (`|restored - saved| <= 2px`).
11. `desktop_1440_dsa_practice.png`
    - **Viewport:** 1440 × 900
    - **Tested Behavior:** DSA Practice arena (`#/dsa`). Verifies hero statistics, filter controls (difficulty, topic, status), and problem list rows.
12. `desktop_1440_gate_cse.png`
    - **Viewport:** 1440 × 900
    - **Tested Behavior:** GATE CSE Command Center (`#/gatecse`). Verifies hero card, subject counters, tab navigation, and preparation curriculum cards.
13. `desktop_1440_learning_studio.png`
    - **Viewport:** 1440 × 900
    - **Tested Behavior:** AI Teacher / Learning Studio workspace (`#/learning-studio`). Verifies tab headers and teaching workspace.
14. `desktop_1440_practice_hub.png`
    - **Viewport:** 1440 × 900
    - **Tested Behavior:** Practice Hub (`#/practice`). Verifies practice tracks, quick action tiles, and course practice lists.
15. `desktop_1440_settings.png`
    - **Viewport:** 1440 × 900
    - **Tested Behavior:** Settings workspace (`#/settings`). Verifies theme switcher, session management, and profile customization cards.

### 2. Laptop 1280 × 800
16. `laptop_1280_admin_panel.png`
    - **Viewport:** 1280 × 800
    - **Tested Behavior:** Admin Control Center (`#/admin`) viewed on standard laptop screen. Verifies zero horizontal overflow (`scrollWidth <= innerWidth`), left administrative sidebar, 4-column metric card grid, and operational snapshot.

### 3. Tablet 768 × 1024
17. `tablet_768_dashboard.png`
    - **Viewport:** 768 × 1024
    - **Tested Behavior:** Tablet Dashboard presentation. Verifies compact TopNav header with hamburger button replacing horizontal dropdown menus (`max-width: 960px` breakpoint).
18. `tablet_768_mobile_sheet_open.png`
    - **Viewport:** 768 × 1024
    - **Tested Behavior:** Tablet slide-in navigation sheet open (`.topnav-sheet`). Verifies fully opaque solid background, grouped menu sections, and touch-target button dimensions.

### 4. Mobile 390 × 844
19. `mobile_390_dashboard.png`
    - **Viewport:** 390 × 844
    - **Tested Behavior:** Mobile smartphone Dashboard. Verifies single-column responsive stacking, hero text scaling, and zero horizontal page overflow.
20. `mobile_390_mobile_sheet.png`
    - **Viewport:** 390 × 844
    - **Tested Behavior:** Mobile navigation drawer open on smartphone. Verifies grouped sections (Learn, Practice, AI, Account), active item styling, and dismiss 'X' control.
21. `mobile_390_gate_cse.png`
    - **Viewport:** 390 × 844
    - **Tested Behavior:** GATE CSE page stacked responsively on mobile. Verifies hero card reordering, stat pill wrapping, and zero horizontal overflow.

### 5. Small Mobile 320 × 700
22. `mobile_320_dashboard.png`
    - **Viewport:** 320 × 700
    - **Tested Behavior:** Ultra-narrow (320px) viewport Dashboard. Verifies complete horizontal containment (`scrollWidth <= 321px`), badge wrapping, and text readability.
23. `mobile_320_mobile_sheet.png`
    - **Viewport:** 320 × 700
    - **Tested Behavior:** Ultra-narrow navigation drawer open at full opacity (`opacity = 1.0`). Verifies zero bleed-through of underlying dashboard text, icon alignment, and touch-target usability.
