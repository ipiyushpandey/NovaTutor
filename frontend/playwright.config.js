import { defineConfig } from '@playwright/test';

/**
 * NovaTutor browser checks.
 *
 * Run against a live backend + Vite server:
 *   E2E_BASE_URL=http://127.0.0.1:5173 \
 *   E2E_EMAIL=verified@example.com E2E_PASSWORD=... \
 *   E2E_ADMIN_EMAIL=owner@example.com E2E_ADMIN_PASSWORD=... \
 *   npx playwright test
 *
 * Account-dependent specs skip themselves when those variables are absent;
 * layout and signed-out flows always run.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
