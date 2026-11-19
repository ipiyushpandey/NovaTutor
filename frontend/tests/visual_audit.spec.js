import { test, expect } from '@playwright/test';
import path from 'path';

const EVIDENCE_DIR = path.resolve('../docs/stabilization/ui-evidence');

const MOCK_USER = {
  id: 42,
  name: 'Piyush Student',
  email: 'student@novatutor.test',
  role: 'STUDENT',
  profileComplete: true,
  token: 'mock-jwt-token-student',
  learningGoal: 'GATE CSE + DSA',
};

const MOCK_ADMIN = {
  id: 1,
  name: 'Nova Owner',
  email: 'admin@novatutor.test',
  role: 'ADMIN',
  profileComplete: true,
  token: 'mock-jwt-token-admin',
};

const MOCK_COURSES = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  title: `Course ${i + 1}: Core Computer Science`,
  description: `Structured theory and examples for module ${i + 1}.`,
  level: i % 2 === 0 ? 'Beginner' : 'Intermediate',
  icon: '📘',
  totalLessons: 4,
  published: true,
}));

const MOCK_LESSONS = Array.from({ length: 4 }, (_, i) => ({
  id: 101 + i,
  courseId: 1,
  orderIndex: i + 1,
  topic: i < 2 ? 'Foundations' : 'Advanced Patterns',
  title: `Lesson ${i + 1} — Topic Concept ${i + 1}`,
  content: `## Concept ${i + 1}\n\n${'Detailed explanation paragraph for testing scroll height and typography rendering. '.repeat(35)}\n\n- Key takeaway 1\n- Key takeaway 2\n`,
}));

const MOCK_DSA_PROBLEMS = [
  {
    slug: 'two-sum',
    number: 1,
    title: 'Two Sum',
    difficulty: 'Easy',
    topic: 'Arrays',
    solved: false,
    attempted: false,
  },
  {
    slug: 'valid-parentheses',
    number: 2,
    title: 'Valid Parentheses',
    difficulty: 'Easy',
    topic: 'Stack',
    solved: true,
    attempted: true,
  },
];

async function installMockApi(page, { user = MOCK_USER } = {}) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api/, '');
    const method = req.method();

    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (p === '/auth/me') return json(user);
    if (p === '/auth/guest' && method === 'DELETE') return json({ ok: true });
    if (p === '/ai/status') return json({ configured: true, model: 'gemini-2.5-flash' });
    if (p === '/courses' && method === 'GET') return json(MOCK_COURSES);
    if (p.match(/^\/courses\/\d+$/) && method === 'GET') {
      return json({ course: MOCK_COURSES[0], lessons: MOCK_LESSONS });
    }
    if (p.startsWith('/progress/')) {
      return json([
        { courseId: 1, completedLessons: 1, totalLessons: 4, percent: 25 },
        { courseId: 2, completedLessons: 0, totalLessons: 4, percent: 0 },
      ]);
    }
    if (p.startsWith('/analytics/')) {
      return json({
        level: 3,
        xp: 450,
        streak: 5,
        coursesStarted: 2,
        lessonsCompleted: 3,
        overallProgress: 25,
        courses: [{ courseId: 1, title: MOCK_COURSES[0].title, completedLessons: 1, totalLessons: 4, percent: 25 }],
        badges: ['First Steps'],
      });
    }
    if (p.startsWith('/intelligence/')) {
      return json({
        learningEvents: 12,
        quizzes: 3,
        studyMinutes: 95,
        streak: 5,
        weakAreas: [{ subject: 'Operating Systems', topic: 'Deadlocks', accuracy: 52, reason: 'Needs practice' }],
        recommendations: [
          { type: 'FOCUS', title: 'Review Operating Systems', description: 'Practice deadlock avoidance', action: 'Practice now', target: 'courses' },
        ],
        mastery: [{ subject: 'Data Structures', state: 'learning', trend: 'up', accuracy: 78 }],
      });
    }
    if (p.startsWith('/mentor/state/')) return json({ activeTopic: 'Deadlocks', mood: 'curious', confidence: 68 });
    if (p.startsWith('/adaptive/')) return json({ recommendedCourseId: 1, nextLessonId: 102, reviewIds: [] });
    if (p.match(/^\/users\/\d+$/)) return json(user);
    if (p === '/dsa/problems') return json(MOCK_DSA_PROBLEMS);
    if (p === '/dsa/progress') return json({ solvedCount: 1, attemptedCount: 2, points: 15 });
    if (p.match(/^\/dsa\/problems\/[^/]+$/)) return json({ problem: MOCK_DSA_PROBLEMS[0], starterCode: 'class Solution {\n  public int[] twoSum() {}\n}' });
    if (p === '/admin/stats' || p === '/admin/overview' || p === '/admin/dashboard') {
      return json({
        users: 142,
        activeUsers: 89,
        blockedUsers: 2,
        courses: 6,
        publishedCourses: 6,
        lessons: 24,
        questions: 48,
        attempts: 12,
        auditEvents: 25,
      });
    }
    if (p === '/admin/users') {
      return json(Array.from({ length: 8 }, (_, i) => ({
        id: 10 + i,
        name: `User ${i + 1}`,
        email: `user${i + 1}@example.test`,
        role: i === 0 ? 'ADMIN' : 'STUDENT',
        emailVerified: true,
        active: true,
        blocked: false,
        createdAt: '2026-11-18T10:00:00Z',
      })));
    }
    if (p === '/admin/ai/usage') return json({ totalRequests: 54, failureRate: 0, tasks: [{ task: 'CHAT', requests: 30, medianMs: 120, averageMs: 140, maxMs: 350, failureRate: 0 }] });
    if (p === '/admin/sandbox/usage') return json({ provider: 'docker', submissions: 12, lastLatencyMs: 250, activePermitsFree: 4, concurrency: 4, verdicts: { ACCEPTED: 10, WRONG_ANSWER: 2 } });
    if (p === '/admin/courses') return json(MOCK_COURSES);
    if (p === '/admin/announcements') return json([]);
    if (p === '/admin/audit-logs' || p === '/admin/audit') return json([]);
    if (p === '/admin/settings') return json({ 'platform.name': 'NovaTutor', 'maintenance.mode': 'false' });
    if (p === '/admin/questions') return json([]);
    if (p === '/admin/gate-notes') return json([]);
    if (p === '/knowledge') return json([]);
    if (p === '/admin/community/posts' || p === '/admin/community') return json([]);

    return json({});
  });
}

async function seedSignedIn(page, user = MOCK_USER, pageName = 'dashboard') {
  await page.addInitScript(({ u, p }) => {
    if (window.self !== window.top) return;
    localStorage.setItem('ai_user', JSON.stringify(u));
    localStorage.setItem('nova_page', p);
    sessionStorage.setItem('nova_app_session_marker', '1');
  }, { u: user, p: pageName });
}

test.describe('Visual & Navigation Stabilization Suite', () => {

  test('Desktop 1440x900 — TopNav dropdown zero-shift, dismissals, submodules & dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, 'dashboard');

    await page.goto('/#/dashboard');

    const main = page.locator('main.main-topnav');
    await expect(main).toBeVisible();

    // Baseline bounding box of main content before opening any menu
    const initialBox = await main.boundingBox();
    expect(initialBox).not.toBeNull();

    // 1. Light mode Dashboard screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_dashboard_light.png`, fullPage: false });

    // 2. Open Learn menu
    const learnBtn = page.locator('.topnav-menu-btn', { hasText: 'Learn' });
    await learnBtn.click();
    const learnPanel = page.locator('.topnav-panel[role="menu"]');
    await expect(learnPanel).toBeVisible();
    await page.waitForTimeout(200);

    // Verify main content top position has NOT shifted
    const boxWithLearn = await main.boundingBox();
    expect(Math.abs(boxWithLearn.y - initialBox.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_topnav_learn_open.png` });

    // 3. Switch to Practice menu (opening Practice closes Learn)
    const practiceBtn = page.locator('.topnav-menu-btn', { hasText: 'Practice' });
    await practiceBtn.click();
    await expect(learnPanel).toContainText('Practice hub');
    await page.waitForTimeout(200);
    const boxWithPractice = await main.boundingBox();
    expect(Math.abs(boxWithPractice.y - initialBox.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_topnav_practice_open.png` });

    // 4. Switch to AI menu
    const aiBtn = page.locator('.topnav-menu-btn', { hasText: 'AI' });
    await aiBtn.click();
    await expect(learnPanel).toContainText('AI Teacher');
    await page.waitForTimeout(200);
    const boxWithAi = await main.boundingBox();
    expect(Math.abs(boxWithAi.y - initialBox.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_topnav_ai_open.png` });

    // 5. Switch to More menu
    const moreBtn = page.locator('.topnav-menu-btn', { hasText: 'More' });
    await moreBtn.click();
    await expect(learnPanel).toContainText('Achievements');
    await page.waitForTimeout(200);
    const boxWithMore = await main.boundingBox();
    expect(Math.abs(boxWithMore.y - initialBox.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_topnav_more_open.png` });

    // 6. Account avatar menu
    const avatarBtn = page.locator('.topnav-avatar');
    await avatarBtn.click();
    const accountPanel = page.locator('.account-panel');
    await expect(accountPanel).toBeVisible();
    await page.waitForTimeout(200);
    const boxWithAccount = await main.boundingBox();
    expect(Math.abs(boxWithAccount.y - initialBox.y)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_topnav_account_open.png` });

    // 7. Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(accountPanel).not.toBeVisible();
    await expect(learnPanel).not.toBeVisible();

    // 8. Dismiss with Outside Click
    await learnBtn.click();
    await expect(learnPanel).toBeVisible();
    await page.locator('main.main-topnav').click({ position: { x: 200, y: 300 } });
    await expect(learnPanel).not.toBeVisible();

    // 9. Submodule navigation: open Practice -> click 'DSA Practice' -> navigates to #/dsa
    await practiceBtn.click();
    await page.getByRole('menuitem', { name: /DSA Practice/ }).click();
    await expect(page).toHaveURL(/#\/dsa/);
    await expect(learnPanel).not.toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_dsa_practice.png` });

    // 10. Dark Mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('nova_theme', 'dark');
    });
    const learnBtnDark = page.locator('.topnav-menu-btn', { hasText: 'Learn' });
    await learnBtnDark.click();
    await page.getByRole('menuitem', { name: /Home/ }).click();
    await expect(page).toHaveURL(/#\/dashboard/);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_dashboard_dark.png` });

    await learnBtnDark.click();
    await expect(learnPanel).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_topnav_learn_dark.png` });
    await page.keyboard.press('Escape');
  });

  test('Laptop 1280x800 — Admin panel layout and horizontal overflow check', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installMockApi(page, { user: MOCK_ADMIN });
    await seedSignedIn(page, MOCK_ADMIN, 'admin');

    await page.goto('/#/admin');

    const adminCenter = page.locator('.admin-center');
    await expect(adminCenter).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(300);

    // Verify no horizontal overflow on window or admin workspace
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/laptop_1280_admin_panel.png` });
  });

  test('Tablet 768x1024 — Mobile drawer navigation and layout stability', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, 'dashboard');

    await page.goto('/#/dashboard');
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${EVIDENCE_DIR}/tablet_768_dashboard.png` });

    // Open hamburger menu
    const menuBtn = page.getByRole('button', { name: /Open navigation|Navigation/i });
    await menuBtn.click();

    const sheet = page.locator('.topnav-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300); // Wait for sheet-in animation to complete
    await page.screenshot({ path: `${EVIDENCE_DIR}/tablet_768_mobile_sheet_open.png` });

    // Dismiss with Escape
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
  });

  test('Mobile 390x844 — Mobile sheet, submodules and responsiveness', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, 'dashboard');

    await page.goto('/#/dashboard');
    await page.waitForTimeout(200);

    // Check zero horizontal overflow
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile_390_dashboard.png` });

    const menuBtn = page.getByRole('button', { name: /Open navigation/i });
    await menuBtn.click();
    const sheet = page.locator('.topnav-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300); // Wait for sheet-in animation to complete
    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile_390_mobile_sheet.png` });

    // Click submodule in sheet
    await page.getByRole('button', { name: /GATE CSE/i }).click();
    await expect(page).toHaveURL(/#\/gatecse/);
    await expect(sheet).not.toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile_390_gate_cse.png` });
  });

  test('Small Mobile 320x700 — Ultra-narrow viewport overflow & usability check', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, 'dashboard');

    await page.goto('/#/dashboard');
    await page.waitForTimeout(200);

    // Check zero horizontal overflow at 320px
    const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const winWidth = await page.evaluate(() => window.innerWidth);
    expect(docScrollWidth).toBeLessThanOrEqual(winWidth + 1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile_320_dashboard.png` });

    const menuBtn = page.getByRole('button', { name: /Open navigation/i });
    await menuBtn.click();
    const sheet = page.locator('.topnav-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300); // Wait for sheet-in animation to complete

    const sheetScrollWidth = await sheet.evaluate((el) => el.scrollWidth);
    const sheetClientWidth = await sheet.evaluate((el) => el.clientWidth);
    expect(sheetScrollWidth).toBeLessThanOrEqual(sheetClientWidth + 1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile_320_mobile_sheet.png` });
    await page.keyboard.press('Escape');
  });

  test('Scroll restoration & Back/Forward navigation — Module A -> scroll -> Module B -> Back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, 'dashboard');

    // Start on Dashboard
    await page.goto('/#/dashboard');
    const firstCard = page.locator('.course-card').first();
    await expect(firstCard).toBeVisible();

    // Scroll down to course card and record exact scroll
    await firstCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const savedHomeScroll = await page.evaluate(() => window.scrollY);
    expect(savedHomeScroll).toBeGreaterThanOrEqual(100);

    // Navigate to Course 1 -> #/course/1
    await firstCard.click();
    await expect(page).toHaveURL(/#\/course\/1$/);
    await expect(page.locator('.lesson-item').nth(1)).toBeVisible();
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_course_detail.png` });

    // Click Lecture 2 -> #/course/1/lesson/102
    await page.locator('.lesson-item').nth(1).click();
    await expect(page).toHaveURL(/#\/course\/1\/lesson\/102$/);

    // Hit browser Back -> Course 1 restored
    await page.goBack();
    await expect(page).toHaveURL(/#\/course\/1$/);

    // Hit browser Back -> Dashboard restored with exact scroll
    await page.goBack();
    await expect(page).toHaveURL(/#\/dashboard$/);

    // Wait for scroll restoration
    await page.waitForTimeout(500);
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(Math.abs(restoredScroll - savedHomeScroll)).toBeLessThanOrEqual(2);

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_course_scroll_restored.png` });
  });

  test('Core Modules visual integrity — GATE CSE, Learning Studio, Practice Hub, Settings', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, 'gatecse');

    // 1. GATE CSE
    await page.goto('/#/gatecse');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_gate_cse.png` });

    // 2. Learning Studio
    await page.goto('/#/learning-studio');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_learning_studio.png` });

    // 3. Practice Hub
    await page.goto('/#/practice');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_practice_hub.png` });

    // 4. Settings
    await page.goto('/#/settings');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop_1440_settings.png` });
  });

});
