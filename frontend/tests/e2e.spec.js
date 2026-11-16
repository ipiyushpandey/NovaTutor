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
});

test.describe('admin workspace', () => {
  test.skip(!ADMIN.email || !ADMIN.password, 'E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD not provided');

  test('admin signs in and navigates the panel on this viewport', async ({ page }, testInfo) => {
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Admin' }).click();
    await page.locator('#auth-email').fill(ADMIN.email);
    await page.locator('#auth-pass').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in to Admin' }).click();
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
});
