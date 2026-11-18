import { test, expect } from '@playwright/test';

const STUDENT = { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD };
const ADMIN = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - window.innerWidth;
  });
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1);
}

test.describe('signed-out experience', () => {
  test('login screen renders the brand and account choices', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page.locator('.auth-brand')).toBeVisible();
    await expect(page.locator('.auth-brand b')).toHaveText('NovaTutor');
    await expect(page.getByRole('button', { name: 'Student' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-pass')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('registration asks for name, password confirmation and consent links', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Create account' }).first().click();
    await expect(page.locator('#auth-name')).toBeVisible();
    await expect(page.locator('#auth-confirm')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Privacy Policy', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Terms', exact: true })).toBeVisible();
  });

  test('forgot-password flow shows an honest generic response', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.locator('#auth-email').fill('nobody-' + Date.now() + '@novatutor.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.locator('.auth-notice')).toContainText(/If an account exists/i);
  });

  test('invalid verification link is handled gracefully', async ({ page }) => {
    await page.goto('/#/verify-email?token=not-a-real-token');
    await expect(page.getByRole('heading', { name: 'Verification failed' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Continue to sign in' })).toBeVisible();
  });

  test('About, Privacy, Terms and Contact are real public routes with a footer', async ({ page }) => {
    await page.goto('/#/about');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Learning should feel/i);
    await expect(page.getByRole('button', { name: 'About us' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Contact & support' })).toBeVisible();

    await page.getByRole('button', { name: 'Privacy policy' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Your data/i);

    await page.getByRole('button', { name: 'Terms & conditions' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Fair use/i);

    await page.getByRole('button', { name: 'Contact & support' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/real person/i);
    await expect(page.getByRole('link', { name: /issue tracker/i })).toHaveAttribute('href', /github\.com/);
    await noHorizontalOverflow(page);
  });

  test('unverified login shows an honest warning when email delivery is off', async ({ page }) => {
    await page.route('**/api/auth/providers', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ googleEnabled: false, googleClientId: '', emailDeliveryConfigured: false }),
    }));
    await page.route('**/api/auth/login', route => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'EMAIL_UNVERIFIED', message: 'Verify your email address before signing in.' }),
    }));
    await page.goto('/#/login');
    await page.locator('#auth-email').fill('unverified@novatutor.test');
    await page.locator('#auth-pass').fill('SomePass123456');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Email verification is unavailable' })).toBeVisible();
    await expect(page.locator('.auth-warning')).toContainText(/cannot send email/i);
    await expect(page.getByRole('button', { name: 'Contact support' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeDisabled();
    await expect(page.locator('.auth-notice')).toHaveCount(0);
    await noHorizontalOverflow(page);
  });

  test('320px viewport keeps the auth screen usable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/#/login');
    await expect(page.locator('#auth-email')).toBeVisible();
    await expect(page.locator('#auth-pass')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('favicon and document title carry the new brand', async ({ page }) => {
    await page.goto('/#/login');
    await expect(page).toHaveTitle(/NovaTutor/);
    const icon = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(icon).toBe('/favicon.svg');
  });
});

test.describe('authenticated experience', () => {
  test.skip(!STUDENT.email || !STUDENT.password, 'E2E_EMAIL/E2E_PASSWORD not provided');

  test('verified student signs in and reaches the dashboard', async ({ page }) => {
    await page.goto('/#/login');
    await page.locator('#auth-email').fill(STUDENT.email);
    await page.locator('#auth-pass').fill(STUDENT.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/#\/(dashboard|onboarding)/, { timeout: 25_000 });
    if (/#\/onboarding/.test(page.url())) {
      // A fresh verified account is intentionally sent to profile onboarding.
      await expect(page.getByText(/Let Nova know you/i)).toBeVisible();
    } else {
      await expect(page.locator('.topnav-brand')).toBeVisible();
    }
    await expect(page.locator('.auth-warning')).toHaveCount(0);

    // Session restoration must not demote or re-warn a verified account.
    await page.reload();
    await expect(page).toHaveURL(/#\/(dashboard|onboarding)/, { timeout: 25_000 });
    await expect(page.locator('.auth-warning')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Email verification is unavailable/i })).toHaveCount(0);
    await noHorizontalOverflow(page);
  });

  test('browser Back restores the previous page and scroll position', async ({ page, request }) => {
    // A disposable, profile-complete guest gives this navigation test a stable
    // signed-in shell without mutating the shared E2E student.
    const created = await request.post('/api/auth/guest');
    const guest = await created.json();
    const headers = { Authorization: `Bearer ${guest.token}` };
    await request.put(`/api/users/${guest.id}`, { headers, data: {
      name: 'Guest Navigator', learningGoal: 'Navigation regression', interests: 'Routes',
      weaknesses: 'Scroll restoration', learningStyle: 'Visual + practical'
    }});
    try {
      await page.addInitScript(user => {
        localStorage.setItem('ai_user', JSON.stringify({ ...user, profileComplete: true }));
        localStorage.setItem('nova_page', 'dashboard');
      }, guest);
      await page.goto('/#/dashboard');
      await expect(page.locator('.course-card').first()).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 420));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
      await page.locator('.course-card').first().click();
      // Home opens the specific course directly; the My Learning catalog is not
      // mounted as an intermediate screen.
      await expect(page).toHaveURL(/#\/course\/\d+/, { timeout: 15_000 });
      await expect(page.locator('.lesson-layout')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.page-title h1')).not.toHaveText(/My Learning/i);
      await page.goBack();
      await expect(page).toHaveURL(/#\/dashboard/);
      await expect(page.locator('.course-card').first()).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8_000 }).toBeGreaterThan(100);
    } finally {
      await request.delete('/api/auth/guest', { headers });
    }
  });
});

test.describe('guest + portal security', () => {
  test('guest mode starts an isolated session and cannot open Admin', async ({ page }) => {
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Continue as guest' }).click();
    await expect(page).toHaveURL(/#\/onboarding/, { timeout: 25_000 });
    await page.reload();
    await expect(page).toHaveURL(/#\/onboarding/, { timeout: 25_000 });
    await page.goto('/#/admin');
    await expect(page.locator('.admin-center')).toHaveCount(0);
    await expect(page).not.toHaveURL(/#\/admin/);
  });

  test('admin credentials are rejected by the student portal', async ({ page }) => {
    test.skip(!ADMIN.email || !ADMIN.password, 'E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD not provided');
    await page.goto('/#/login');
    await page.locator('#auth-email').fill(ADMIN.email);
    await page.locator('#auth-pass').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/Administrator accounts must use the Admin sign-in/i, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/#\/dashboard/);
  });
});

test.describe('admin workspace', () => {
  test.skip(!ADMIN.email || !ADMIN.password, 'E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD not provided');

  test('admin signs in and navigates the panel on this viewport', async ({ page }, testInfo) => {
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Admin' }).click();
    await page.locator('#auth-email').fill(ADMIN.email);
    await page.locator('#auth-pass').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in to Admin' }).click();
    // Admin authentication no longer forces the control center; Home is the landing page.
    await expect(page).toHaveURL(/#\/dashboard/, { timeout: 30_000 });
    await expect(page.locator('.admin-center')).toHaveCount(0);
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.locator('.topnav-sheet .sheet-item').first()).toBeVisible();
      await page.locator('.topnav-sheet').getByRole('button', { name: 'Admin Panel' }).click();
    } else {
      // Desktop TopNav dropdowns start closed to avoid initial CLS, then open cleanly as overlays.
      const learnBtn = page.getByRole('button', { name: 'Learn', exact: true });
      await expect(learnBtn).toHaveAttribute('aria-expanded', 'false');
      await learnBtn.click();
      await expect(learnBtn).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.topnav-panel').first()).toBeVisible();
      await page.locator('.topnav-menu-btn').filter({ hasText: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Admin Panel' }).click();
    }
    await expect(page.locator('.admin-center')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /NovaTutor Admin/i })).toBeVisible();

    if (testInfo.project.name === 'mobile') {
      // Compact three-dot menu replaces the permanent sidebar.
      const toggle = page.getByRole('button', { name: 'Admin sections menu' });
      await expect(toggle).toBeVisible();
      await expect(page.locator('#admin-nav')).toBeHidden();
      await toggle.click();
      await expect(page.locator('#admin-nav')).toBeVisible();
      await page.locator('#admin-nav').getByRole('button', { name: 'Users' }).click();
      await expect(page.locator('#admin-nav')).toBeHidden();
      await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
      await noHorizontalOverflow(page);
    } else {
      await expect(page.getByRole('button', { name: 'Admin sections menu' })).toBeHidden();
      await page.locator('#admin-nav').getByRole('button', { name: 'Users' }).click();
      await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    }
  });

  test('admin workspace stays within supported widths without false vertical scroll', async ({ page, request }) => {
    const response = await request.post('/api/auth/login', { data: {
      email: ADMIN.email, password: ADMIN.password, portal: 'admin'
    }});
    expect(response.ok()).toBeTruthy();
    const session = await response.json();
    await page.addInitScript(user => {
      localStorage.setItem('ai_user', JSON.stringify(user));
      localStorage.setItem('nova_page', 'admin');
    }, session);
    await page.goto('/#/admin');
    await expect(page.locator('.admin-center')).toBeVisible({ timeout: 30_000 });
    const widths = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 600 ? 740 : 900 });
      await page.waitForTimeout(120);
      const metrics = await page.evaluate(() => {
        const root = document.querySelector('.admin-center');
        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          shellWidth: root ? root.scrollWidth : 0,
          shellClient: root ? root.clientWidth : 0,
          shellScrollHeight: root ? root.scrollHeight : 0,
          shellHeight: root ? root.clientHeight : 0,
          blankTail: root ? (() => {
            const content = [...root.children].filter(el => !el.classList.contains('ac-nav') && !el.classList.contains('ac-nav-backdrop'));
            const bottom = content.reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom + root.scrollTop), 0);
            return Math.max(0, Math.round(root.scrollHeight - bottom));
          })() : 0
        };
      });
      expect(metrics.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(metrics.viewport + 1);
      expect(metrics.shellWidth, `admin overflow at ${width}px`).toBeLessThanOrEqual(metrics.shellClient + 1);
      // Content may legitimately be taller than the viewport; only a large empty
      // tail after the last real section counts as false vertical scrolling.
      expect(metrics.blankTail, `excess blank tail at ${width}px`).toBeLessThan(200);
    }
    // The user table (verification badges, bulk controls, many actions) is the
    // densest screen, so check it at the narrowest supported width too.
    await page.setViewportSize({ width: 320, height: 740 });
    await page.getByRole('button', { name: 'Admin sections menu' }).click();
    await page.locator('#admin-nav').getByRole('button', { name: 'Users' }).click();
    await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
    const bottomMetrics = await page.evaluate(() => {
      const root = document.querySelector('.admin-center');
      root.style.scrollBehavior = 'auto';
      root.scrollTop = root.scrollHeight;
      const content = [...root.children].filter(el => !el.classList.contains('ac-nav') && !el.classList.contains('ac-nav-backdrop') && !el.classList.contains('ac-nav-toggle'));
      const last = content[content.length - 1];
      return {
        viewport: window.innerHeight,
        shellBottom: root.getBoundingClientRect().bottom,
        lastBottom: last.getBoundingClientRect().bottom,
        scrollTop: root.scrollTop,
        maxScroll: root.scrollHeight - root.clientHeight
      };
    });
    // The admin shell must sit in the real viewport and its final section must
    // be fully reachable above the bottom edge after scrolling.
    expect(bottomMetrics.shellBottom).toBeLessThanOrEqual(bottomMetrics.viewport + 1);
    expect(bottomMetrics.lastBottom).toBeLessThanOrEqual(bottomMetrics.viewport + 1);
    expect(bottomMetrics.maxScroll).toBeGreaterThan(0);
    expect(bottomMetrics.scrollTop).toBeGreaterThanOrEqual(bottomMetrics.maxScroll - 1);
    const usersMetrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shellWidth: document.querySelector('.admin-center')?.scrollWidth || 0,
      shellClient: document.querySelector('.admin-center')?.clientWidth || 0
    }));
    expect(usersMetrics.documentWidth).toBeLessThanOrEqual(usersMetrics.viewport + 1);
    expect(usersMetrics.shellWidth).toBeLessThanOrEqual(usersMetrics.shellClient + 1);
  });
});

test.describe('appearance + account menu', () => {
  test('theme moves to Settings and persists across reload', async ({ page, request }) => {
    const created = await request.post('/api/auth/guest');
    const guest = await created.json();
    const headers = { Authorization: `Bearer ${guest.token}` };
    await request.put(`/api/users/${guest.id}`, { headers, data: {
      name: 'Theme Guest', learningGoal: 'Theme check', interests: 'UI',
      weaknesses: 'Contrast', learningStyle: 'Visual + practical'
    }});
    try {
      await page.addInitScript(user => localStorage.setItem('ai_user', JSON.stringify({ ...user, profileComplete: true })), guest);
      await page.goto('/#/settings');
      await expect(page.locator('.topnav-icon-btn[aria-label*="appearance"]')).toHaveCount(0);
      await page.getByRole('button', { name: /Dark/ }).first().click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      expect(await page.evaluate(() => localStorage.getItem('nova_theme'))).toBe('dark');
      await page.reload();
      await expect(page.locator('html')).toHaveClass(/dark/);
      const avatar = page.getByRole('button', { name: 'Account menu' });
      await avatar.click();
      await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeHidden();
    } finally {
      await request.delete('/api/auth/guest', { headers });
    }
  });
});
