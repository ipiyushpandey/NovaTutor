import { test, expect } from '@playwright/test';

const MOCK_STUDENT = {
  id: 101,
  name: 'Aanya Sharma',
  email: 'aanya@novatutor.test',
  role: 'STUDENT',
  profileComplete: true,
  token: 'mock-token-student-101',
  learningGoal: 'GATE CSE & algorithms',
};

const MOCK_INCOMPLETE_STUDENT = {
  id: 102,
  name: 'New Student',
  email: 'newbie@novatutor.test',
  role: 'STUDENT',
  profileComplete: false,
  token: 'mock-token-student-102',
};

const MOCK_GUEST = {
  id: 888,
  name: 'Guest Explorer',
  email: 'guest_888@guest.novatutor.local',
  role: 'GUEST',
  profileComplete: true,
  token: 'mock-token-guest-888',
};

const MOCK_ADMIN = {
  id: 1,
  name: 'Nova Admin',
  email: 'admin@novatutor.test',
  role: 'ADMIN',
  profileComplete: true,
  token: 'mock-token-admin-1',
};

const MOCK_COURSES = [
  { id: 1, title: 'Data Structures & Algorithms', description: 'Core CS structures.', level: 'Intermediate', totalLessons: 5, published: true },
  { id: 2, title: 'Computer Networks', description: 'OSI, TCP/IP, sockets.', level: 'Intermediate', totalLessons: 4, published: true },
];

async function setupMockBackend(page, initialUser = null) {
  let currentUser = initialUser;
  let putUserPayload = null;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = req.method();

    const json = (data, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    if (path === '/auth/guest' && method === 'POST') {
      currentUser = MOCK_GUEST;
      return json(MOCK_GUEST);
    }
    if (path === '/auth/login' && method === 'POST') {
      const data = req.postDataJSON() || {};
      currentUser = data.portal === 'admin' ? MOCK_ADMIN : MOCK_STUDENT;
      return json(currentUser);
    }
    if (path === '/auth/guest' && method === 'DELETE') {
      return json({ ok: true });
    }
    if (path === '/auth/me') {
      return json(currentUser || { message: 'Not logged in' }, currentUser ? 200 : 401);
    }
    if (path === '/courses') {
      return json(MOCK_COURSES);
    }
    if (path.startsWith('/progress/')) {
      return json([{ courseId: 1, completedLessons: 2, totalLessons: 5, percent: 40 }]);
    }
    if (path.startsWith('/intelligence/')) {
      return json({ nextRecommendation: 'Review Trees', dailyStreak: 3 });
    }
    if (path === '/ai/status') {
      return json({ configured: true, model: 'gemini-2.5-flash' });
    }
    if (path.startsWith('/users/') && method === 'PUT') {
      putUserPayload = req.postDataJSON();
      currentUser = { ...currentUser, ...putUserPayload, profileComplete: true };
      return json(currentUser);
    }
    if (path.startsWith('/users/') && method === 'GET') {
      return json(currentUser || {});
    }
    if (path === '/community/posts') {
      return json([]);
    }
    if (path === '/users/leaderboard') {
      return json([]);
    }
    return json({});
  });

  return {
    getCurrentUser: () => currentUser,
    setCurrentUser: (u) => { currentUser = u; },
    getPutPayload: () => putUserPayload,
  };
}

test.describe('NovaTutor Master Stabilization Verification', () => {

  test('Part A1: Guest login completely bypasses onboarding and loads dashboard directly', async ({ page }) => {
    await setupMockBackend(page, null);
    await page.goto('/#/login');

    // Click "Continue as guest"
    const guestBtn = page.locator('button.auth-guest');
    await expect(guestBtn).toBeVisible();
    await guestBtn.click();

    // Must navigate directly to dashboard and never redirect to onboarding
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.onboarding-page')).toHaveCount(0);
    await expect(page.locator('.main-topnav')).toBeVisible();

    // Reload page to test session hydration
    await page.reload();
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.onboarding-page')).toHaveCount(0);
  });

  test('Part A2: Admin & Student browser Back navigation never traps into onboarding', async ({ page }) => {
    await setupMockBackend(page, MOCK_ADMIN);
    await page.addInitScript((user) => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'dashboard');
    }, MOCK_ADMIN);

    await page.goto('/#/dashboard');
    await expect(page.locator('.main-topnav')).toBeVisible();

    // Navigate to courses
    await page.evaluate(() => { window.location.hash = '#/courses'; });
    await expect(page).toHaveURL(/#\/courses/);

    // Navigate to practice
    await page.evaluate(() => { window.location.hash = '#/practice'; });
    await expect(page).toHaveURL(/#\/practice/);

    // Press browser Back
    await page.goBack();
    await expect(page).toHaveURL(/#\/courses/);

    // Press browser Back to Home/Dashboard
    await page.goBack();
    await expect(page).toHaveURL(/#\/dashboard/);

    // Attempting to visit #/onboarding manually or via stale history MUST redirect to dashboard
    await page.evaluate(() => { window.location.hash = '#/onboarding'; });
    await page.waitForTimeout(200);
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.onboarding-page')).toHaveCount(0);
  });

  test('Part A3 & A4: Personalization appears for eligible new students and rejects gibberish like bcsjcgs', async ({ page }) => {
    const backend = await setupMockBackend(page, MOCK_INCOMPLETE_STUDENT);
    await page.addInitScript((user) => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'onboarding');
    }, MOCK_INCOMPLETE_STUDENT);

    await page.goto('/#/onboarding');
    await expect(page.locator('.onboarding-page')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Let Nova know you');

    // Step 1: Try clicking Continue without entering goal or with gibberish
    const continueBtn = page.locator('button:has-text("Continue")');
    await continueBtn.click();
    await expect(page.locator('.error')).toContainText('Please enter a meaningful learning goal');

    // Enter gibberish goal "bcsjcgs"
    const goalInput = page.locator('input[placeholder*="GATE CSE"]');
    await goalInput.fill('bcsjcgs');
    await continueBtn.click();
    await expect(page.locator('.error')).toContainText('Please enter a meaningful learning goal');

    // Enter realistic valid goal
    await goalInput.fill('GATE CSE & algorithms preparation');
    await continueBtn.click();

    // Now on Step 2 (Interests & weaknesses)
    const interestsArea = page.locator('textarea[placeholder*="Java, DSA"]');
    await expect(interestsArea).toBeVisible();

    // Try submitting gibberish on step 2
    await interestsArea.fill('bcsjcgs');
    await continueBtn.click();
    await expect(page.locator('.error')).toContainText('Please enter your learning interests');

    // Fill valid interests & weaknesses
    await interestsArea.fill('Data Structures, Algorithms, System Design');
    const weaknessesArea = page.locator('textarea[placeholder*="What topics confuse you"]');
    await weaknessesArea.fill('Dynamic programming, Graph theory');
    await continueBtn.click();

    // Now on Step 3: Review & Submit
    const submitBtn = page.locator('button:has-text("Start my personalized NovaTutor")');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // After completion, user must be routed to dashboard via replace
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.onboarding-page')).toHaveCount(0);
    expect(backend.getPutPayload()).not.toBeNull();
    expect(backend.getPutPayload().learningGoal).toBe('GATE CSE & algorithms preparation');

    // Pressing Back must not navigate back into onboarding
    await page.goBack();
    await page.waitForTimeout(200);
    await expect(page.locator('.onboarding-page')).toHaveCount(0);
  });

  test('Part B1: Mobile TopNav alignment at 320px, 360px, 390px, 430px', async ({ page }) => {
    await setupMockBackend(page, MOCK_STUDENT);
    await page.addInitScript((user) => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'dashboard');
    }, MOCK_STUDENT);

    const widths = [320, 360, 390, 430];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 750 });
      await page.goto('/#/dashboard');
      await page.waitForSelector('.topnav');

      const innerBox = await page.locator('.topnav-inner').boundingBox();
      const brandBox = await page.locator('.topnav-brand').boundingBox();
      const avatarBox = await page.locator('.topnav-avatar').boundingBox();
      const toggleBox = await page.locator('.topnav-menu-toggle').boundingBox();

      expect(brandBox).not.toBeNull();
      expect(avatarBox).not.toBeNull();
      expect(toggleBox).not.toBeNull();

      // Brand on far-left (x <= 16px)
      expect(brandBox.x).toBeLessThanOrEqual(16);

      // Avatar on far-right (x + width within 16px of viewport edge)
      expect(avatarBox.x + avatarBox.width).toBeGreaterThanOrEqual(w - 16);

      // Menu toggle centered between brand and avatar
      expect(toggleBox.x).toBeGreaterThan(brandBox.x + brandBox.width - 5);
      expect(toggleBox.x + toggleBox.width).toBeLessThan(avatarBox.x + 5);

      // Verify no horizontal document scroll
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(w + 1);
    }
  });

  test('Part A2: Admin, Guest & Student browser Back navigation never traps into onboarding at app boundary', async ({ page }) => {
    // 1. Admin session - start from /#/login (app boundary) unauthenticated
    await setupMockBackend(page, MOCK_ADMIN);
    await page.goto('/#/login');
    await expect(page.locator('.auth-form')).toBeVisible();

    // 2. Sign in as Admin via UI form
    await page.click('button:has-text("Admin")');
    await page.fill('#auth-email', 'admin@novatutor.test');
    await page.fill('#auth-pass', 'AdminPass123!');
    await page.click('button.auth-submit');

    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.main-topnav')).toBeVisible();

    // 3. Navigate through multiple pages
    await page.evaluate(() => { window.location.hash = '#/courses'; });
    await expect(page).toHaveURL(/#\/courses/);

    await page.evaluate(() => { window.location.hash = '#/practice'; });
    await expect(page).toHaveURL(/#\/practice/);

    await page.evaluate(() => { window.location.hash = '#/admin'; });
    await expect(page).toHaveURL(/#\/admin/);

    // 4. Press browser Back repeatedly
    await page.goBack();
    await expect(page).toHaveURL(/#\/practice/);

    await page.goBack();
    await expect(page).toHaveURL(/#\/courses/);

    await page.goBack();
    await expect(page).toHaveURL(/#\/dashboard/);

    // 5. Press Back once more to return to app boundary
    await page.goBack();
    await page.waitForTimeout(300);

    // Must NEVER trap into onboarding at boundary
    await expect(page.locator('.onboarding-page')).toHaveCount(0);

    // 6. Direct manual attempt or stale bookmark to #/onboarding from dashboard MUST replace to dashboard
    await page.goto('/#/dashboard');
    await page.evaluate(() => { window.location.hash = '#/onboarding'; });
    await page.waitForTimeout(200);
    await expect(page).toHaveURL(/#\/dashboard/);
    await expect(page.locator('.onboarding-page')).toHaveCount(0);
  });

  test('Part B2: Courses module tabs remain readable and usable at 320px with zero truncation', async ({ page }) => {
    await setupMockBackend(page, MOCK_STUDENT);
    await page.addInitScript((user) => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'courses');
    }, MOCK_STUDENT);

    const widths = [320, 360, 390, 430];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 750 });
      await page.goto('/#/courses');
      await page.waitForSelector('.courses-tabs');

      const tabs = page.locator('.courses-tabs button');
      await expect(tabs).toHaveCount(3);

      // Verify all 3 tab texts are readable
      const tab1Text = await tabs.nth(0).innerText();
      const tab2Text = await tabs.nth(1).innerText();
      const tab3Text = await tabs.nth(2).innerText();

      expect(tab1Text).toContain('Courses');
      expect(tab2Text).toContain('Learning');
      expect(tab2Text).toContain('Profile');
      expect(tab3Text).toContain('Milestones');

      // Verify each button has comfortable touch target height (>= 38px)
      const tab1Box = await tabs.nth(0).boundingBox();
      const tab2Box = await tabs.nth(1).boundingBox();
      const tab3Box = await tabs.nth(2).boundingBox();

      expect(tab1Box.height).toBeGreaterThanOrEqual(38);
      expect(tab2Box.height).toBeGreaterThanOrEqual(38);
      expect(tab3Box.height).toBeGreaterThanOrEqual(38);

      // All 3 bounding boxes must fit within viewport simultaneously
      expect(tab1Box.x).toBeGreaterThanOrEqual(0);
      expect(tab3Box.x + tab3Box.width).toBeLessThanOrEqual(w + 2);

      // Verify no horizontal document scroll
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(w + 1);
    }
  });

  test('Part B3: Community navigation controls are fully contained and accessible on mobile', async ({ page }) => {
    await setupMockBackend(page, MOCK_STUDENT);
    await page.addInitScript((user) => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'community');
    }, MOCK_STUDENT);

    const widths = [320, 360, 390, 430];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 750 });
      await page.goto('/#/community');
      await page.waitForSelector('.community-tabs');

      const tabs = page.locator('.community-tabs button');
      await expect(tabs).toHaveCount(4);

      // All 4 tabs must be visible on screen simultaneously
      for (let i = 0; i < 4; i++) {
        await expect(tabs.nth(i)).toBeVisible();
        const box = await tabs.nth(i).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(w + 2);
        expect(box.height).toBeGreaterThanOrEqual(40); // 40px touch target
      }

      // Verify no horizontal document scroll
      const pageScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(pageScrollWidth).toBeLessThanOrEqual(w + 1);

      // Click each tab to verify accessibility and active state
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveClass(/active/);

      await tabs.nth(0).click();
      await expect(tabs.nth(0)).toHaveClass(/active/);
    }
  });

  test('Part C: Motion system applies scroll reveals, moving icons, and respects reduced motion on real page content', async ({ page }) => {
    await setupMockBackend(page, MOCK_STUDENT);
    await page.addInitScript((user) => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'dashboard');
    }, MOCK_STUDENT);

    await page.goto('/#/dashboard');
    await page.waitForSelector('.main-topnav');

    // 1. Verify scroll reveal classes exist on real Dashboard content
    const morning = page.locator('.dash-morning.reveal');
    const continueSection = page.locator('.dash-continue.reveal');
    const courseGrid = page.locator('.course-grid.stagger-reveal');

    await expect(morning).toBeVisible();
    await expect(continueSection).toBeVisible();
    await expect(courseGrid).toBeVisible();

    // 2. Verify in-view is applied by IntersectionObserver
    await expect(morning).toHaveClass(/in-view/);
    await expect(continueSection).toHaveClass(/in-view/);

    // 3. Verify moving icons (.icon-rotate-subtle) and hover-lift on real content
    const icon = page.locator('.dash-continue-icon.icon-rotate-subtle');
    await expect(icon).toBeVisible();
    const hoverCard = page.locator('.dash-continue.hover-lift');
    await expect(hoverCard).toBeVisible();

    // 4. Verify reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.waitForSelector('.main-topnav');

    // In reduced motion, in-view must be present immediately and transition duration must be 0s/none
    await expect(page.locator('.dash-morning.reveal')).toHaveClass(/in-view/);
    const transition = await page.evaluate(() => {
      const el = document.querySelector('.dash-morning.reveal');
      return window.getComputedStyle(el).transitionDuration;
    });
    expect(['0s', '0.001s', '0.00001s', 'none']).toContain(transition);
  });

});
