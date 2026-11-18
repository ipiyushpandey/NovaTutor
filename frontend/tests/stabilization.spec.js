import { test, expect } from '@playwright/test';

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
  content: `## Concept ${i + 1}\n\n${'Detailed explanation paragraph for testing scroll height and typography rendering. '.repeat(25)}\n\n- Key takeaway 1\n- Key takeaway 2\n`,
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

async function installMockApi(page, { user = MOCK_USER, trackers = null } = {}) {
  const counts = trackers || { authMe: 0, intelligence: 0, hardQuiz: 0 };

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

    if (p === '/auth/me') {
      counts.authMe += 1;
      return json(user);
    }
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
      counts.intelligence += 1;
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
    if (p === '/dsa/problems') {
      return json(MOCK_DSA_PROBLEMS);
    }
    if (p === '/dsa/stats') {
      return json({ total: 2, easy: 2, medium: 0, hard: 0 });
    }
    if (p === '/dsa/progress') {
      return json({ problems: [{ slug: 'valid-parentheses', status: 'SOLVED', bookmarked: false }] });
    }
    if (p === '/dsa/progress/summary') {
      return json({ solved: 1, total: 2 });
    }
    if (p === '/dsa/problems/two-sum') {
      return json({
        slug: 'two-sum',
        number: 1,
        title: 'Two Sum',
        difficulty: 'Easy',
        topic: 'Arrays',
        statement: 'Return indices of two numbers that add up to target.',
        examples: [{ input: 'nums=[2,7,11,15], target=9', output: '[0,1]' }],
        constraints: ['2 <= nums.length <= 10^4'],
        starters: { python: 'def twoSum(nums, target):\n    return [0, 1]\n', javascript: 'function twoSum(nums, target) { return [0, 1]; }' },
        visibleTests: [{ input: '[2,7,11,15]\n9', expected: '[0,1]' }],
        hiddenTestCount: 4,
      });
    }
    if (p === '/dsa/problems/two-sum/starter') {
      return json({ language: url.searchParams.get('language') || 'java', code: 'class Solution { public int[] twoSum(int[] a, int t) { return new int[]{0,1}; } }' });
    }
    if (p === '/knowledge' && method === 'GET') {
      return json([{ id: 9, fileName: 'OS_Notes.pdf', sizeBytes: 120000, uploadedAt: new Date().toISOString() }]);
    }
    if (p === '/knowledge/9/chunks') {
      // Simulate large extracted chunks (50 KB) that must NEVER be written to localStorage
      return json(
        Array.from({ length: 10 }, (_, idx) => ({
          id: idx + 1,
          page: idx + 1,
          content: `Page ${idx + 1} extracted notes: ${'Operating systems paging and virtual memory details. '.repeat(90)}`,
        }))
      );
    }
    if (p === '/knowledge/9/pack') {
      return json({ answer: '## Exam Summary\n\n- Virtual memory enables process isolation.' });
    }
    if (p === '/gate-cse/notes') return json([]);
    if (p === '/health') return json({ status: 'UP', database: 'UP' });
    if (p === '/admin/dashboard' || p === '/admin/overview') {
      return json({
        totalUsers: 2,
        totalStudents: 1,
        totalAdmins: 1,
        totalGuests: 0,
        totalCourses: 6,
        totalLessons: 24,
        totalQuestions: 50,
        totalDocuments: 1,
        totalPosts: 0,
        totalEvents: 12,
        totalQuizAttempts: 3,
      });
    }
    if (p === '/admin/courses') return json(MOCK_COURSES);
    if (p === '/admin/users') return json([MOCK_ADMIN, MOCK_USER]);
    if (p === '/admin/questions') return json([]);
    if (p === '/admin/announcements') return json([]);
    if (p === '/admin/audit-logs' || p === '/admin/audit') return json([]);
    if (p === '/admin/settings') return json({ 'platform.name': 'NovaTutor', 'maintenance.mode': 'false' });
    if (p === '/admin/gate-notes') return json([]);
    if (p === '/admin/knowledge') return json([]);
    if (p === '/admin/community/posts' || p === '/admin/community') return json([]);
    if (p === '/admin/ai/usage') return json({ totalCalls: 5, byTask: {}, byModel: {} });
    if (p === '/admin/sandbox/usage') return json({ totalRuns: 0, active: 0 });
    if (p === '/ai/ask' && method === 'POST') return json({ answer: '## Mock Explanation\n\nHere is a clear explanation.\n\n**Mini Question:** What is the base case?' });
    if (p === '/ai/ask/stream' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: Mock streamed explanation.\n\nevent: done\ndata: done\n\n',
      });
    }
    return json({});
  });

  await page.route('**/gate-cse/hard_quiz.json', async (route) => {
    counts.hardQuiz += 1;
    return route.continue();
  });

  return counts;
}

async function seedSignedIn(page, user = MOCK_USER, extraStorage = {}) {
  await page.addInitScript(({ u, extra }) => {
    localStorage.setItem('ai_user', JSON.stringify(u));
    localStorage.setItem('nova_page', 'dashboard');
    sessionStorage.setItem('nova_app_session_marker', '1');
    for (const [k, v] of Object.entries(extra)) {
      localStorage.setItem(k, v);
    }
  }, { u: user, extra: extraStorage });
}

test.describe('NovaTutor Stabilization Verification (Pass 1, Pass 2, Pass 3)', () => {
  test('Pass 1A: Single /auth/me, deduplicated /intelligence, and Desktop TopNav zero-CLS', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    const counts = await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/dashboard');
    await expect(page.locator('.dash-morning')).toBeVisible();
    await page.waitForTimeout(350);

    // 1. Single /auth/me on bootstrap (no token-rotation loop)
    expect(counts.authMe).toBe(1);
    // 2. Single /intelligence call on Dashboard mount (not 3 duplicate calls)
    expect(counts.intelligence).toBe(1);

    // 3. Desktop TopNav starts CLOSED and opening/closing EVERY dropdown causes 0px shift on <main>
    const main = page.locator('main.main-topnav');
    const beforeBox = await main.boundingBox();
    expect(beforeBox).not.toBeNull();
    expect(await page.locator('.topnav-panel').count()).toBe(0);

    for (const label of ['Learn', 'Practice', 'AI', 'More']) {
      const btn = page.locator('.topnav-menu-btn', { hasText: label });
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.topnav-panel')).toBeVisible();

      const openBox = await main.boundingBox();
      expect(Math.abs(openBox.y - beforeBox.y)).toBeLessThanOrEqual(1);

      // Click again to close
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      const closedBox = await main.boundingBox();
      expect(Math.abs(closedBox.y - beforeBox.y)).toBeLessThanOrEqual(1);
    }

    expect(errors).toEqual([]);
  });

  test('Pass 1B: Deep Back/Forward routing, Lecture 1 reset, Forward restore & exact scroll restoration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/dashboard');
    const firstCard = page.locator('.course-card').first();
    await expect(firstCard).toBeVisible();

    // Scroll course card into view cleanly and record the exact click-time scrollY
    await firstCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const savedHomeScroll = await page.evaluate(() => window.scrollY);
    expect(savedHomeScroll).toBeGreaterThanOrEqual(150);

    // Open first course -> #/course/1 (Lecture 1 visible)
    await firstCard.click();
    await expect(page).toHaveURL(/#\/course\/1$/);
    await expect(page.locator('.lesson-ai > h3')).toContainText(/Topic Concept 1/i);
    await expect(page.locator('.lesson-item').nth(1)).toBeVisible();

    // Click Lecture 2 -> #/course/1/lesson/102
    await page.locator('.lesson-item').nth(1).click();
    await expect(page).toHaveURL(/#\/course\/1\/lesson\/102$/);
    await expect(page.locator('.lesson-ai > h3')).toContainText(/Topic Concept 2/i);

    // Click "Learn with AI Teacher" -> #/learning-studio
    await page.getByRole('button', { name: /Learn with AI Teacher/i }).click();
    await expect(page).toHaveURL(/#\/learning-studio$/);

    // Back -> Lecture 2
    await page.goBack();
    await expect(page).toHaveURL(/#\/course\/1\/lesson\/102$/);
    await expect(page.locator('.lesson-ai > h3')).toContainText(/Topic Concept 2/i);

    // Back -> Course 1 must ACTUALLY reset active lesson to Lecture 1 (HIGH-FE-03)
    await page.goBack();
    await expect(page).toHaveURL(/#\/course\/1$/);
    await expect(page.locator('.lesson-ai > h3')).toContainText(/Topic Concept 1/i);

    // Forward -> Lecture 2 restores again cleanly
    await page.goForward();
    await expect(page).toHaveURL(/#\/course\/1\/lesson\/102$/);
    await expect(page.locator('.lesson-ai > h3')).toContainText(/Topic Concept 2/i);

    // Back twice -> Dashboard with exact scroll restored
    await page.goBack();
    await expect(page).toHaveURL(/#\/course\/1$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await page.waitForTimeout(450);
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(Math.abs(restoredScroll - savedHomeScroll)).toBeLessThanOrEqual(15);
  });

  test('Pass 1C: DSA deep slug routing & Back navigation without history loop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/dsa');
    await expect(page.getByText('Two Sum')).toBeVisible();

    await page.getByText('Two Sum').click();
    await expect(page).toHaveURL(/#\/dsa\/two-sum$/);
    await expect(page.getByText(/Return indices of two numbers/i)).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/#\/dsa$/);
    await expect(page.getByText('Valid Parentheses')).toBeVisible();
  });

  test('Pass 1D: GATE CSE single hard_quiz.json fetch and Q65 Finish paper button', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const counts = await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/gatecse');
    await page.getByRole('button', { name: /PYQ & Test Series/i }).click();
    const startBtn = page.getByRole('button', { name: /^Start test$/i }).first();
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    await expect(page.getByText(/QUESTION 1 \/ 65/i)).toBeVisible();
    expect(counts.hardQuiz).toBe(1);

    // Jump directly to Q65 in palette and verify Finish paper completes the exam
    await page.locator('.gate-question-grid button', { hasText: /^65$/ }).click();
    await expect(page.getByText(/QUESTION 65 \/ 65/i)).toBeVisible();
    await page.getByRole('button', { name: /Finish paper/i }).click();
    await expect(page.getByText(/DETAILED TEST REPORT/i)).toBeVisible();
  });

  test('Pass 1E: Knowledge Hub keeps chunks out of localStorage and shows green save banner', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/knowledge');
    await expect(page.getByText('OS_Notes.pdf')).toBeVisible();
    await page.getByText('OS_Notes.pdf').click();
    await expect(page.getByText(/10 extracted note sections/i)).toBeVisible();

    // Verify large PDF chunks were NEVER persisted into localStorage
    const lsDump = await page.evaluate(() => JSON.stringify(localStorage));
    expect(lsDump).not.toContain('Operating systems paging and virtual memory details');

    // Generate & save pack -> green success banner (not red error banner)
    await page.getByRole('button', { name: /^Summary$/ }).click();
    await expect(page.getByText(/Virtual memory enables process isolation/i)).toBeVisible();
    await page.getByRole('button', { name: /Save pack/i }).click();
    await expect(page.locator('.success-banner')).toContainText(/Study pack saved/i);
    await expect(page.locator('.error.settings-error')).toHaveCount(0);
  });

  test('Pass 2A (Security): Course IDE HTML preview iframe executes in opaque origin and blocks parent access', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/dpp');
    const langSelect = page.locator('select[aria-label="Language"]');
    await langSelect.selectOption('HTML');

    const payload = `<!doctype html><html><body><p id="out">init</p><script>
      try {
        window.parent.localStorage.setItem('xss_pwned', '1');
        window.parent.document.title = 'XSS_PWNED';
        document.getElementById('out').textContent = 'ESCAPED';
      } catch (e) {
        document.getElementById('out').textContent = 'ISOLATED:' + e.name;
      }
    </script></body></html>`;

    await page.locator('textarea[aria-label="Code editor"]').fill(payload);
    await page.getByRole('button', { name: /Run preview/i }).click();

    const iframe = page.locator('iframe.html-preview');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(iframe).toHaveAttribute('allow', '');

    // Verify the script actually executed AND was blocked by opaque origin (SecurityError)
    await expect(iframe.contentFrame().locator('#out')).toHaveText(/ISOLATED:SecurityError/);

    const pwned = await page.evaluate(() => localStorage.getItem('xss_pwned'));
    const title = await page.title();
    expect(pwned).toBeNull();
    expect(title).not.toBe('XSS_PWNED');

    // Verify htmlPreview is NOT persisted in workspace localStorage
    const lsDump = await page.evaluate(() => JSON.stringify(localStorage));
    expect(lsDump).not.toContain('htmlPreview');
  });

  test('Pass 2B (Security & Contrast): Non-admin denied #/admin via replace and dark-mode toast stays readable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, { nova_theme: 'dark' });

    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\/dashboard$/);
    const toast = page.locator('.nv-toast');
    await expect(toast).toContainText(/restricted to administrator/i);

    const colors = await toast.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, fg: s.color, dark: document.documentElement.classList.contains('dark') };
    });
    expect(colors.dark).toBe(true);
    expect(colors.bg).not.toBe(colors.fg);
    expect(colors.fg).not.toBe('rgb(255, 255, 255)');
  });

  test('Pass 2C (Isolation): Logout clears user localStorage, scroll sessionStorage, and preserves theme', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER, {
      nova_theme: 'dark',
      nova_career_goal: 'Staff Engineer',
      nova_teaching_mode: 'Socratic',
      nova_learning_studio_tab: 'voice',
      daily_goal: '90',
    });

    await page.goto('/#/dashboard');
    await expect(page.locator('.dash-morning')).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('nova_scroll_v2:dashboard', '420'));

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/#\/login/);

    const residual = await page.evaluate(() => ({
      aiUser: localStorage.getItem('ai_user'),
      career: localStorage.getItem('nova_career_goal'),
      teachingMode: localStorage.getItem('nova_teaching_mode'),
      studioTab: localStorage.getItem('nova_learning_studio_tab'),
      dailyGoal: localStorage.getItem('daily_goal'),
      coursesCache: localStorage.getItem('nova_courses_cache'),
      theme: localStorage.getItem('nova_theme'),
      scrollKeys: Object.keys(sessionStorage).filter((k) => k.startsWith('nova_scroll_v2:')),
    }));

    expect(residual.aiUser).toBeNull();
    expect(residual.career).toBeNull();
    expect(residual.teachingMode).toBeNull();
    expect(residual.studioTab).toBeNull();
    expect(residual.dailyGoal).toBeNull();
    expect(residual.coursesCache).toBeNull();
    expect(residual.scrollKeys).toEqual([]);
    expect(residual.theme).toBe('dark');
  });

  test('Pass 2D (Navigation): #/voice opens Voice Tutor and Course launchTeacher overrides persisted Voice tab', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/voice');
    await expect(page.getByRole('tab', { name: /Voice Tutor/i })).toHaveAttribute('aria-selected', 'true');

    // Now navigate to a course and click "Learn with AI Teacher" — must override persisted voice tab!
    await page.goto('/#/course/1');
    await expect(page.locator('.lesson-ai > h3')).toBeVisible();
    await page.getByRole('button', { name: /Learn with AI Teacher/i }).click();
    await expect(page).toHaveURL(/#\/learning-studio$/);
    await expect(page.getByRole('tab', { name: /AI Teacher/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('Pass 3: 12-Viewport Dashboard Audit, multi-page desktop+mobile overflow, Escape mobile sheet & theme contrast', async ({ page }) => {
    const widths = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1366, 1440, 1920];
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await installMockApi(page, { user: MOCK_ADMIN });
    await seedSignedIn(page, MOCK_ADMIN);

    for (const width of widths) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto('/#/dashboard');
      await expect(page.locator('.dash-morning')).toBeVisible();

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(overflow.scrollWidth, `Horizontal overflow at ${width}px on Dashboard`).toBeLessThanOrEqual(overflow.innerWidth + 1);
    }

    // Multi-page overflow check across core modules on desktop (1280) and mobile (390)
    const routes = ['#/courses', '#/course/1', '#/learning-studio', '#/dsa', '#/gatecse', '#/settings', '#/admin'];
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of routes) {
        await page.goto('/' + route);
        await page.waitForTimeout(150);
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(overflow.scrollWidth, `Horizontal overflow at ${width}px on ${route}`).toBeLessThanOrEqual(overflow.innerWidth + 1);
      }
    }

    // Verify mobile navigation sheet closes on Escape
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/dashboard');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.locator('.topnav-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.topnav-sheet')).toHaveCount(0);

    // Verify light-mode .danger-btn text is NOT white-on-white
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto('/#/exam');
    await page.getByRole('button', { name: /Start mock test/i }).click();
    const dangerColor = await page.locator('.exam-palette .danger-btn').evaluate((el) => getComputedStyle(el).color);
    expect(dangerColor).not.toBe('rgb(255, 255, 255)');

    // Verify synchronous pre-hydration dark theme applies dark class before paint
    await page.evaluate(() => localStorage.setItem('nova_theme', 'dark'));
    await page.reload();
    const hasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(hasDark).toBe(true);

    expect(errors).toEqual([]);
  });
});
