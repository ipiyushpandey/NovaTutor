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

const MOCK_GUEST = {
  id: 777,
  name: 'Guest Explorer',
  email: 'guest-777@guest.novatutor.local',
  role: 'GUEST',
  profileComplete: true,
  token: 'mock-jwt-token-guest',
  learningGoal: 'Explore NovaTutor',
};

async function installMockApi(page, { user = MOCK_USER, trackers = null, dsaProgress = null, starterDelayMs = 0 } = {}) {
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
    if (p === '/auth/guest' && method === 'DELETE') {
      return json({ ok: true });
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
      return json(dsaProgress || { problems: [{ slug: 'valid-parentheses', status: 'SOLVED', bookmarked: false }] });
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
        signature: 'twoSum(nums, target)',
        tags: ['HashMap', 'Array'],
        cSupported: true,
        statement: 'Return indices of two numbers that add up to target.',
        constraints: '2 <= nums.length <= 10^4',
        samples: [{ input: '2,7,11,15\n9', expected: '0,1' }],
        hiddenTestCount: 4,
      });
    }
    if (p === '/dsa/problems/two-sum/starter') {
      const reqLang = url.searchParams.get('language') || 'java';
      if (starterDelayMs > 0) {
        await new Promise((r) => setTimeout(r, starterDelayMs));
      }
      const code = reqLang === 'python'
        ? 'def twoSum(nums, target):\n    return [0, 1]\n'
        : 'class Solution { public int[] twoSum(int[] a, int t) { return new int[]{0,1}; } }';
      return json({ language: reqLang, code });
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
    if (p === '/health') return json({ status: 'UP', app: 'NovaTutor', database: 'UP' });
    if (p === '/admin/dashboard' || p === '/admin/overview') {
      return json({
        users: 2,
        activeUsers: 2,
        blockedUsers: 0,
        courses: 6,
        publishedCourses: 6,
        lessons: 24,
        questions: 50,
        attempts: 3,
        auditEvents: 4,
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
    if (p === '/admin/ai/usage') {
      return json({
        totalRequests: 5,
        failureRate: 0,
        tasks: [{ task: 'CHAT', requests: 5, medianMs: 120, averageMs: 140, maxMs: 250, firstTokenAvgMs: 80, failureRate: 0 }],
      });
    }
    if (p === '/admin/sandbox/usage') {
      return json({
        provider: 'docker-local',
        submissions: 2,
        lastLatencyMs: 95,
        activePermitsFree: 4,
        concurrency: 4,
        verdicts: { PASSED: 2 },
      });
    }
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
    if (window.self !== window.top) return;
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

  test('Pass 2A (Security): Course IDE HTML preview renders via isolated /ide-preview.html, blocks parent access & outbound network', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/dpp');
    const langSelect = page.locator('select[aria-label="Language"]');
    await langSelect.selectOption('HTML');

    const payload = `<!doctype html><html><body><p id="out">init</p><p id="net">pending</p><script>
      try {
        window.parent.localStorage.setItem('xss_pwned', '1');
        window.parent.document.title = 'XSS_PWNED';
        document.getElementById('out').textContent = 'ESCAPED';
      } catch (e) {
        document.getElementById('out').textContent = 'ISOLATED:' + e.name;
      }
      fetch('https://example.com/exfil').then(
        () => { document.getElementById('net').textContent = 'NET_ALLOWED'; },
        () => { document.getElementById('net').textContent = 'NET_BLOCKED'; }
      );
    </script></body></html>`;

    await page.locator('textarea[aria-label="Code editor"]').fill(payload);
    await page.getByRole('button', { name: /Run preview/i }).click();

    const iframe = page.locator('iframe.html-preview');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('src', '/ide-preview.html');
    expect(await iframe.getAttribute('srcdoc')).toBeNull();
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(iframe).toHaveAttribute('allow', '');

    // Verify the script actually executed, parent access failed (SecurityError), AND outbound fetch was blocked by inner CSP
    await expect(iframe.contentFrame().locator('#out')).toHaveText(/ISOLATED:SecurityError/);
    await expect(iframe.contentFrame().locator('#net')).toHaveText('NET_BLOCKED');

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

  test('Pass 2C (Isolation): Guest & student logout from active module purges ALL scoped/unscoped state and preserves theme', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installMockApi(page, { user: MOCK_GUEST });
    await seedSignedIn(page, MOCK_GUEST, {
      nova_theme: 'dark',
      nova_career_goal: 'Guest Secret Goal',
      nova_teaching_mode: 'Socratic',
      nova_learning_studio_tab: 'voice',
      daily_goal: '90',
      nova_workspace_v1_777_studio: JSON.stringify({ note: 'guest secret workspace' }),
      nova_module_state_777_studio: JSON.stringify({ draft: 'guest secret module' }),
      nova_quiz_seen_777_1: JSON.stringify([101, 102]),
      nova_today_done_777_2026_11_18: '1',
      nova_challenge_seen_777_2026_11_18: '1',
      dsa_code_777_two_sum_python: '# guest secret solution',
    });

    // Mount an active module that uses useModulePersistence so unmount-flush race is exercised
    await page.goto('/#/learning-studio');
    await expect(page.getByRole('tab', { name: /AI Teacher/i })).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('nova_scroll_v2:learning-studio', '420'));

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/#\/login/);
    // Wait past useModulePersistence debounce/unmount window to ensure nothing is resurrected
    await page.waitForTimeout(450);

    const residual = await page.evaluate(() => ({
      aiUser: localStorage.getItem('ai_user'),
      career: localStorage.getItem('nova_career_goal'),
      teachingMode: localStorage.getItem('nova_teaching_mode'),
      studioTab: localStorage.getItem('nova_learning_studio_tab'),
      dailyGoal: localStorage.getItem('daily_goal'),
      coursesCache: localStorage.getItem('nova_courses_cache'),
      theme: localStorage.getItem('nova_theme'),
      leakedGuestKeys: Object.keys(localStorage).filter((k) =>
        k.startsWith('nova_workspace_v1_777') ||
        k.startsWith('nova_module_state_777') ||
        k.startsWith('nova_quiz_seen_777') ||
        k.startsWith('nova_today_done_777') ||
        k.startsWith('nova_challenge_seen_777') ||
        k.startsWith('dsa_code_777')
      ),
      scrollKeys: Object.keys(sessionStorage).filter((k) => k.startsWith('nova_scroll_v2:')),
    }));

    expect(residual.aiUser).toBeNull();
    expect(residual.career).toBeNull();
    expect(residual.teachingMode).toBeNull();
    expect(residual.studioTab).toBeNull();
    expect(residual.dailyGoal).toBeNull();
    expect(residual.coursesCache).toBeNull();
    expect(residual.leakedGuestKeys).toEqual([]);
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

  test('Pass 2E (DSA Direct-Link): Slow starter cannot overwrite server lastCode, and local draft wins while preserving language', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // Scenario 1: Slow default Java starter (450ms) vs fast /dsa/progress returning saved Python code + bookmark
    await installMockApi(page, {
      user: MOCK_USER,
      starterDelayMs: 450,
      dsaProgress: {
        problems: [{
          slug: 'two-sum',
          status: 'ATTEMPTED',
          bookmarked: true,
          lastLanguage: 'python',
          lastCode: '# SERVER SAVED PYTHON\ndef twoSum(nums, target):\n    return [0, 1]\n',
        }],
      },
    });
    await seedSignedIn(page, MOCK_USER);

    await page.goto('/#/dsa/two-sum');
    const langSel = page.locator('select[aria-label="Language"]');
    const editor = page.locator('.dsa-editor textarea');
    await expect(langSel).toHaveValue('python');
    await expect(editor).toHaveValue(/# SERVER SAVED PYTHON/);
    await expect(page.getByRole('button', { name: /Remove bookmark/i })).toHaveAttribute('aria-pressed', 'true');

    // Wait well past the 450ms slow Java starter response to prove it does NOT overwrite Python code
    await page.waitForTimeout(700);
    await expect(langSel).toHaveValue('python');
    await expect(editor).toHaveValue(/# SERVER SAVED PYTHON/);

    // Scenario 2: Local draft for saved language exists -> MUST restore saved language AND keep local draft over server lastCode
    await page.evaluate(() => {
      localStorage.setItem('dsa_code_42_two-sum_python', '# LOCAL PYTHON DRAFT\ndef twoSum(nums, target):\n    return [1, 2]\n');
    });
    await page.reload();
    await expect(langSel).toHaveValue('python');
    await expect(editor).toHaveValue(/# LOCAL PYTHON DRAFT/);
    await page.waitForTimeout(600);
    await expect(editor).toHaveValue(/# LOCAL PYTHON DRAFT/);
  });

  test('Pass 2F (Navigation): Invalid hashchange on Dashboard does not lock subsequent Back scroll restoration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installMockApi(page);
    await seedSignedIn(page);

    await page.goto('/#/dashboard');
    const firstCard = page.locator('.course-card').first();
    await expect(firstCard).toBeVisible();

    // Trigger hashchange to an invalid hash while already on Dashboard (the exact HIGH-FE-05 trigger
    // that previously set restoringScrollRef.current = true without re-running useEffect([routeKey])).
    await page.evaluate(() => { window.location.hash = '#/nonexistent-route-xyz'; });
    await page.waitForTimeout(150);

    await firstCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    await firstCard.click();
    await expect(page).toHaveURL(/#\/course\/1$/);
    const savedScroll = await page.evaluate(() => Number(sessionStorage.getItem('nova_scroll_v2:dashboard') || 0));
    expect(savedScroll).toBeGreaterThanOrEqual(120);

    await page.goBack();
    await page.waitForTimeout(450);
    await expect(firstCard).toBeVisible();
    const restoredScroll = await page.evaluate(() => window.scrollY);
    expect(Math.abs(restoredScroll - savedScroll)).toBeLessThanOrEqual(15);
  });

  test('Pass 2G (REAUDIT-04 Session Race): Delayed /auth/me cannot resurrect logged-out session or overwrite switched user', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const USER_B = {
      id: 99,
      name: 'User Beta',
      email: 'userb@novatutor.test',
      role: 'STUDENT',
      profileComplete: true,
      token: 'mock-jwt-token-user-b',
    };

    await installMockApi(page, { user: MOCK_USER });
    // Override /auth/me and /auth/login so User A's /auth/me is delayed 450ms (outliving Logout & Account Switch)
    await page.route('**/api/auth/me', async (route) => {
      const auth = route.request().headers()['authorization'] || '';
      if (auth.includes(MOCK_USER.token)) {
        await new Promise((r) => setTimeout(r, 450));
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_USER, token: 'mock-jwt-token-student-rotated' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(USER_B),
      });
    });
    await page.route('**/api/auth/login', async (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(USER_B),
      });
    });

    // Scenario 1: Logout while User A's /auth/me is in-flight -> must STAY on #/login with ai_user === null
    await seedSignedIn(page, MOCK_USER);
    await page.goto('/#/dashboard');
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/#\/login/);

    // Wait well past the 450ms delayed /auth/me response
    await page.waitForTimeout(750);
    await expect(page).toHaveURL(/#\/login/);
    expect(await page.evaluate(() => localStorage.getItem('ai_user'))).toBeNull();

    // Scenario 2: Re-enter as User A, immediately log out while /auth/me is in-flight, and sign in as User B
    await page.evaluate((u) => {
      localStorage.setItem('ai_user', JSON.stringify(u));
      window.location.hash = '#/dashboard';
    }, MOCK_USER);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/#\/login/);

    await page.locator('#auth-email').fill(USER_B.email);
    await page.locator('#auth-pass').fill('ValidPassword123!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/#\/dashboard/);

    // Wait well past User A's 450ms delayed /auth/me response -> User B MUST still own ai_user
    await page.waitForTimeout(750);
    const activeAfterDelay = await page.evaluate(() => JSON.parse(localStorage.getItem('ai_user') || 'null'));
    expect(activeAfterDelay?.id).toBe(USER_B.id);
    expect(activeAfterDelay?.email).toBe(USER_B.email);
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
