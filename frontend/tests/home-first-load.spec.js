import { test, expect } from '@playwright/test';

test.describe('Home Dashboard First-Load & Visual Stability', () => {
  const validJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTk5IiwiZXhwIjoxNzk1MjkwMTI5fQ.sig';

  const mockUser = {
    id: 9999,
    name: 'Alex Learner',
    email: 'alex@novatutor.test',
    role: 'STUDENT',
    token: validJwt,
    profileComplete: true,
    learningGoal: 'GATE CSE Master',
    interests: 'Algorithms',
    weaknesses: 'Dynamic Programming',
    learningStyle: 'Hands-on',
  };

  const mockCourses = [
    { id: 1, title: 'Data Structures & Algorithms', description: 'Core CS foundation', level: 'Beginner', totalLessons: 12, icon: '⚡' },
    { id: 2, title: 'Operating Systems', description: 'Processes and concurrency', level: 'Intermediate', totalLessons: 10, icon: '💻' },
    { id: 3, title: 'Computer Networks', description: 'Protocols and architecture', level: 'Advanced', totalLessons: 8, icon: '🌐' },
  ];

  const mockCourse1 = {
    course: mockCourses[0],
    lessons: [
      { id: 101, title: 'Lesson 1 — Introduction to Arrays', topic: 'Arrays', orderIndex: 1 },
      { id: 102, title: 'Lesson 2 — Linked Lists', topic: 'Linked Lists', orderIndex: 2 },
    ],
  };

  const mockProgress = [
    { courseId: 1, completedLessons: 3, totalLessons: 12, percent: 25 },
  ];

  const mockAnalytics = {
    streak: 4,
    xp: 1250,
    quizzesTaken: 5,
    lessonsCompleted: 3,
  };

  const mockIntelligence = {
    streak: 4,
    quizzes: 5,
    studyMinutes: 140,
    weakAreas: [{ subject: 'Dynamic Programming', topic: 'Knapsack', accuracy: 45, reason: 'Edge case boundaries' }],
    recommendations: [{ title: 'Practice Dynamic Programming', description: 'Focus on 0/1 knapsack problems', action: 'Start practice', target: 'practice' }],
    mastery: [
      { subject: 'Dynamic Programming', accuracy: 45, state: 'needs work', trend: 'steady' },
      { subject: 'Binary Trees', accuracy: 88, state: 'mastered', trend: 'improving' },
    ],
  };

  test.beforeEach(async ({ page }) => {
    // Intercept backend API routes via regex so sub-paths are accurately fulfilled
    await page.route(/\/api\/courses\/\d+/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockCourse1) });
    });
    await page.route(/\/api\/courses$/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockCourses) });
    });
    await page.route(/\/api\/progress/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockProgress) });
    });
    await page.route(/\/api\/analytics/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockAnalytics) });
    });
    await page.route(/\/api\/intelligence/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockIntelligence) });
    });
    await page.route(/\/api\/users/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) });
    });
    await page.route(/\/api\/ai\/status/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, model: 'gemini-3.5-flash-lite' }) });
    });
    await page.route(/\/api\/auth\/me/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUser) });
    });
    await page.route(/\/api\/auth\/providers/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ googleEnabled: false, emailDeliveryConfigured: false }) });
    });
  });

  test('First visit to dashboard renders all cards immediately without blank or black holes', async ({ page }) => {
    await page.addInitScript(user => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'dashboard');
    }, mockUser);

    await page.goto('/#/dashboard');

    // 1. Dash morning strip
    await expect(page.locator('.dash-morning')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dash-morning h1')).toContainText(/Alex/);

    // 2. Feature strip
    await expect(page.locator('.nova-ticker-container')).toBeVisible();

    // 3. Continue card
    await expect(page.locator('.dash-continue')).toBeVisible();
    await expect(page.locator('.dash-continue h2')).toContainText(/Data Structures/);

    // 4. Nova learning brain
    await expect(page.locator('.nova-brain')).toBeVisible();

    // 5. Intelligence snapshot
    await expect(page.locator('.intelligence-snapshot')).toBeVisible();

    // 6. Mastery snapshot
    await expect(page.locator('.mastery-snapshot')).toBeVisible();

    // 7. Course grid
    await expect(page.locator('.course-grid')).toBeVisible();
    await expect(page.locator('.course-grid .course-card')).toHaveCount(3);

    // Wait for the 240ms page-in entrance animation to complete
    await page.waitForTimeout(300);

    // Ensure all cards have computed opacity: 1 and non-zero dimensions
    const cardVisibilities = await page.evaluate(() => {
      const selectors = [
        '.dash-morning',
        '.nova-ticker-container',
        '.dash-continue',
        '.nova-brain',
        '.intelligence-snapshot',
        '.mastery-snapshot',
        '.course-grid',
      ];
      return selectors.map(sel => {
        const el = document.querySelector(sel);
        if (!el) return { selector: sel, found: false };
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          selector: sel,
          found: true,
          opacity: parseFloat(style.opacity),
          visibility: style.visibility,
          width: rect.width,
          height: rect.height,
        };
      });
    });

    for (const item of cardVisibilities) {
      expect(item.found, `Element ${item.selector} must be in DOM`).toBeTruthy();
      expect(item.opacity, `Element ${item.selector} must have opacity >= 0.9`).toBeGreaterThanOrEqual(0.9);
      expect(item.visibility, `Element ${item.selector} must be visible`).toBe('visible');
      expect(item.width, `Element ${item.selector} must have positive width`).toBeGreaterThan(100);
      expect(item.height, `Element ${item.selector} must have positive height`).toBeGreaterThan(30);
    }
  });

  test('Page reload maintains stable dashboard without flicker or blank states', async ({ page }) => {
    await page.addInitScript(user => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'dashboard');
    }, mockUser);

    await page.goto('/#/dashboard');
    await expect(page.locator('.dash-continue')).toBeVisible({ timeout: 10_000 });

    // Reload
    await page.reload();

    // Immediately verify all elements exist and are visible
    await expect(page.locator('.dash-morning')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dash-continue')).toBeVisible();
    await expect(page.locator('.nova-brain')).toBeVisible();
    await expect(page.locator('.intelligence-snapshot')).toBeVisible();
    await expect(page.locator('.mastery-snapshot')).toBeVisible();
    await expect(page.locator('.course-grid .course-card').first()).toBeVisible();

    const anyZeroOpacity = await page.evaluate(() => {
      const els = document.querySelectorAll('.dash-continue, .nova-brain, .intelligence-snapshot, .mastery-snapshot, .course-card');
      let zeroCount = 0;
      els.forEach(el => {
        const op = parseFloat(window.getComputedStyle(el).opacity);
        if (op === 0) zeroCount++;
      });
      return zeroCount;
    });

    expect(anyZeroOpacity, 'No dashboard card should have opacity 0 on reload').toBe(0);
  });

  test('Guest first-load renders gracefully without errors or infinite skeletons', async ({ page }) => {
    const guestUser = {
      id: 8888,
      name: 'Guest Learner',
      email: 'guest@novatutor.test',
      role: 'GUEST',
      token: validJwt,
      profileComplete: true,
    };

    await page.addInitScript(user => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'dashboard');
    }, guestUser);

    await page.goto('/#/dashboard');

    await expect(page.locator('.dash-morning')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.dash-continue')).toBeVisible();
    await expect(page.locator('.course-grid')).toBeVisible();
    await expect(page.locator('.intelligence-snapshot')).toBeVisible();
  });
});
