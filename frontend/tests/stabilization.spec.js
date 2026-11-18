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
    if (p === '/admin/overview') {
      return json({
        usersCount: 2,
        coursesCount: 6,
        lessonsCount: 24,
        postsCount: 0,
        documentsCount: 1,
        quizQuestionsCount: 50,
        activeGuests: 0,
        aiUsage: { totalCalls: 5, estimatedCostUsd: 0.01 },
      });
    }
    if (p === '/admin/courses') return json(MOCK_COURSES);
    if (p === '/admin/users') return json([MOCK_ADMIN, MOCK_USER]);
    if (p === '/admin/announcements') return json([]);
    if (p === '/admin/audit') return json([]);
    if (p === '/admin/settings') return json({ 'platform.name': 'NovaTutor', 'maintenance.mode': 'false' });
    if (p === '/admin/knowledge') return json([]);
    if (p === '/admin/community') return json([]);
    if (p === '/admin/ai/usage') return json({ totalCalls: 5, byTask: {}, byModel: {} });
    if (p === '/ai/ask' && method === 'POST') return json({ answer: '## Mock Explanation\n\nHere is a clear explanation.\n\n**Mini Question:** What is the base case?' });
    if (p === '/ai/ask/stream' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data:Mock streamed explanation.\n\ndata:done\n\n',
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
    sessionStorage.setItem('nova_tab_booted_v2', '1');
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

  test('Pass 1B: Deep Back/Forward routing & exact scroll restoration (Home -> Course -> Lecture -> AI Teacher -> Back)', async ({ page }) => {
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

    // Open first course -> #/course/1
    await firstCard.click();
    await expect(page).toHaveURL(/#\/course\/1$/);
    await expect(page.locator('.lesson-item').nth(1)).toBeVisible();

    // Click Lecture 2 -> #/course/1/lesson/102
    await page.locator('.lesson-item').nth(1).click();
    await expect(page).toHaveURL(/#\/course\/1\/lesson\/102$/);

    // Click "Learn with AI Teacher" -> #/learning-studio
    await page.getByRole('button', { name: /Learn with AI Teacher/i }).click();
    await expect(page).toHaveURL(/#\/learning-studio$/);

    // Back -> Lecture 2
    await page.goBack();
    await expect(page).toHaveURL(/#\/course\/1\/lesson\/102$/);

    // Back -> Course 1
    await page.goBack();
    await expect(page).toHaveURL(/#\/course\/1$/);

    // Back -> Dashboard with exact scroll restored
    await page.goBack();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await page.waitForTimeout(450);
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(Math.abs(restoredScroll - savedHomeScroll)).toBeLessThanOrEqual(15);
  });

  test('Pass 1C: DSA deep slug routing & Back navigation', async ({ page }) => {
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

  test('Pass 2A (Security): Course IDE HTML preview iframe blocks XSS access to parent DOM & localStorage', async ({ page }) => {
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

    await page.waitForTimeout(300);
    const pwned = await page.evaluate(() => localStorage.getItem('xss_pwned'));
    const title = await page.title();
    expect(pwned).toBeNull();
    expect(title).not.toBe('XSS_PWNED');
  });

  test('Pass 2B (Security): Non-admin cannot access #/admin route', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page, { user: MOCK_USER });
    await seedSignedIn(page, MOCK_USER);

    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(page.locator('.nv-toast')).toContainText(/restricted to administrator/i);
  });

  test('Pass 3: 12-Viewport Responsive Audit (320px to 1920px), zero horizontal overflow & theme contrast', async ({ page }) => {
    const widths = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1366, 1440, 1920];
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await installMockApi(page);
    await seedSignedIn(page);

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
