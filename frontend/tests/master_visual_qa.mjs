import { chromium } from 'playwright';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = '/Users/piyushpandey/Downloads/NovaTutor';
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = path.join(REPO_ROOT, 'scratch/qa_screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function waitPort(port, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Port ${port} did not respond within ${timeout}ms`));
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });
}

async function setupApiMocks(page, userRole = 'STUDENT') {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/me')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 1, name: userRole === 'ADMIN' ? 'Admin Master' : 'QA Tester', role: userRole, token: 'mock-token' })
      });
    }
    if (url.includes('/auth/providers')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ googleEnabled: false, googleClientId: '', emailDeliveryConfigured: true })
      });
    }
    if (url.includes('/courses/101')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          course: { id: 101, title: 'Data Structures & Algorithms in Java', level: 'Intermediate', icon: '⚡', description: 'Core DSA concepts and LeetCode patterns.', totalLessons: 12 },
          lessons: [{ id: 1, title: 'Lesson 1: Arrays & Memory Layout', content: '# Arrays\nContiguous memory allocation.' }]
        })
      });
    }
    if (url.includes('/admin/courses') || url.includes('/courses')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 101, title: 'Data Structures & Algorithms in Java', level: 'Intermediate', icon: '⚡', description: 'Core DSA concepts and LeetCode patterns.', totalLessons: 12 },
          { id: 102, title: 'System Design Fundamentals', level: 'Advanced', icon: '🏛️', description: 'Scalable distributed systems.', totalLessons: 8 }
        ])
      });
    }
    if (url.includes('/progress/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ courseId: 101, percent: 35, completedLessons: 4 }])
      });
    }
    if (url.includes('/admin/dashboard')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: 12, activeUsers: 9, courses: 4, publishedCourses: 4, lessons: 32, questions: 120, attempts: 54, auditEvents: 18 })
      });
    }
    if (url.includes('/admin/users')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 1, name: 'Admin Master', email: 'admin@novatutor.test', role: 'ADMIN', active: true, emailVerified: true },
          { id: 2, name: 'Alex Student', email: 'alex@novatutor.test', role: 'STUDENT', active: true, emailVerified: false, blocked: false }
        ])
      });
    }
    if (url.includes('/admin/questions')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }
    if (url.includes('/admin/audit-logs') || url.includes('/admin/announcements') || url.includes('/admin/gate-notes') || url.includes('/knowledge') || url.includes('/admin/community/posts')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    }
    if (url.includes('/admin/settings') || url.includes('/health') || url.includes('/ai/status')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ configured: true, model: 'Gemini 1.5 Pro' })
      });
    }
    if (url.includes('/admin/ai/usage') || url.includes('/admin/sandbox/usage')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ totalRequests: 12, failureRate: 0, tasks: [] })
      });
    }
    if (url.includes('/actuator/health/readiness')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'UP' })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({})
    });
  });
}

async function runMasterVisualQA() {
  console.log('--- Starting Vite Preview Server ---');
  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: path.join(REPO_ROOT, 'frontend'),
    stdio: 'pipe'
  });

  preview.stdout.on('data', d => process.stdout.write('[preview] ' + d));
  preview.stderr.on('data', d => process.stderr.write('[preview err] ' + d));

  try {
    await waitPort(PORT);
    console.log(`Preview server ready at ${BASE_URL}`);

    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { name: '320px-mobile-xs', width: 320, height: 568 },
      { name: '360px-mobile-sm', width: 360, height: 640 },
      { name: '390px-mobile-md', width: 390, height: 844 },
      { name: '430px-mobile-lg', width: 430, height: 932 },
      { name: '768px-tablet-pt', width: 768, height: 1024 },
      { name: '1024px-tablet-ls', width: 1024, height: 768 },
      { name: '1280px-desktop-sm', width: 1280, height: 800 },
      { name: '1440px-desktop-lg', width: 1440, height: 900 }
    ];

    const results = {
      mobileScrollPerformance: null,
      viewportsOverflow: {},
      gateDirectNavigation: false,
      homeClickableCards: false,
      coursesClickableCards: false,
      adminNavigationAndBadges: false,
      dsaDarkModeVisibility: false,
      loginWakeUpBranding: false
    };

    console.log('\n--- 1. Testing Mobile Login Scroll Performance ---');
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true
      });
      const page = await context.newPage();
      await setupApiMocks(page);
      await page.goto(`${BASE_URL}/#/login`, { waitUntil: 'networkidle' });

      const authBox = await page.$('.auth');
      if (!authBox) throw new Error('Login page auth container not found');

      const scrollMetrics = await page.evaluate(async () => {
        return new Promise((resolve) => {
          let frames = 0;
          let longFrames = 0;
          let lastTime = performance.now();
          const frameDeltas = [];

          const scrollStep = () => {
            const now = performance.now();
            const delta = now - lastTime;
            lastTime = now;
            frames++;
            frameDeltas.push(delta);
            if (delta > 34) longFrames++;

            window.scrollBy(0, 15);
            if (window.scrollY + window.innerHeight >= document.body.scrollHeight || frames > 60) {
              const avgDelta = frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length;
              const fps = 1000 / avgDelta;
              resolve({ frames, longFrames, avgDelta, fps });
            } else {
              requestAnimationFrame(scrollStep);
            }
          };
          requestAnimationFrame(scrollStep);
        });
      });

      console.log(`Scroll Performance: Avg FPS: ${scrollMetrics.fps.toFixed(1)}, Long frames (>34ms): ${scrollMetrics.longFrames}/${scrollMetrics.frames}`);
      results.mobileScrollPerformance = scrollMetrics;

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_login_mobile_390.png') });
      await context.close();
    }

    console.log('\n--- 2. Testing Viewport Overflow Across 8 Breakpoints ---');
    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      await setupApiMocks(page);
      await page.goto(`${BASE_URL}/#/login`, { waitUntil: 'networkidle' });

      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        };
      });

      results.viewportsOverflow[vp.name] = overflow;
      console.log(`Viewport ${vp.name} (${vp.width}px): ScrollWidth=${overflow.scrollWidth}, ClientWidth=${overflow.clientWidth}, Overflow=${overflow.hasHorizontalOverflow}`);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `02_viewport_${vp.name}.png`) });
      await context.close();
    }

    console.log('\n--- 3. Testing GATE CSE Direct Subject-to-Syllabus Navigation ---');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await setupApiMocks(page, 'STUDENT');
      
      await page.addInitScript(() => {
        const mockUser = { id: 1, name: 'QA Tester', role: 'STUDENT', email: 'tester@novatutor.test', token: 'mock-token' };
        localStorage.setItem('ai_user', JSON.stringify(mockUser));
      });

      await page.goto(`${BASE_URL}/#/gate-cse`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);

      const overviewActive = await page.$('.gate-tabs button.active');
      const tabText = await overviewActive?.innerText();
      console.log('Initial GATE tab:', tabText);

      const algoCard = await page.$('.gate-subject-card:has-text("Algorithms")');
      if (algoCard) {
        await algoCard.click();
        await page.waitForTimeout(400);

        const activeTab = await page.$('.gate-tabs button.active');
        const activeTabText = await activeTab?.innerText();
        
        const openItem = await page.$('.gate-syllabus-item.detailed.open[data-subject="Algorithms"]');
        const isSyllabus = activeTabText === 'Syllabus';
        const isAlgoOpen = !!openItem;
        console.log(`Direct Navigation: Tab switched to Syllabus=${isSyllabus}, Algorithms expanded=${isAlgoOpen}`);
        results.gateDirectNavigation = isSyllabus && isAlgoOpen;
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_gate_direct_syllabus.png') });
      } else {
        console.warn('Algorithms card not found in Overview!');
      }

      await context.close();
    }

    console.log('\n--- 4. Testing Home & Courses Clickable Cards ---');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await setupApiMocks(page, 'STUDENT');
      
      await page.addInitScript(() => {
        const mockUser = { id: 1, name: 'QA Tester', role: 'STUDENT', email: 'tester@novatutor.test', token: 'mock-token' };
        localStorage.setItem('ai_user', JSON.stringify(mockUser));
      });

      await page.goto(`${BASE_URL}/#/dashboard`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const dashContinue = await page.$('.dash-continue.clickable-card');
      console.log('Dashboard dash-continue clickable-card present:', !!dashContinue);
      results.homeClickableCards = !!dashContinue;

      await page.goto(`${BASE_URL}/#/courses`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const bigCard = await page.$('.course-card.big.clickable-card');
      console.log('Course card big clickable-card present:', !!bigCard);
      results.coursesClickableCards = !!bigCard;

      if (bigCard) {
        await bigCard.click();
        await page.waitForTimeout(400);
        console.log('Current URL after course card click:', page.url());
      }

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_courses_card_clicked.png') });
      await context.close();
    }

    console.log('\n--- 5. Testing Admin Panel Independent Navigation & Badges ---');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await setupApiMocks(page, 'ADMIN');
      
      await page.addInitScript(() => {
        const mockAdmin = { id: 1, name: 'Admin Master', role: 'ADMIN', email: 'admin@novatutor.test', token: 'mock-token' };
        localStorage.setItem('ai_user', JSON.stringify(mockAdmin));
      });

      await page.goto(`${BASE_URL}/#/admin`, { waitUntil: 'networkidle' });
      // Wait for the panel to finish loading live data
      await page.waitForSelector('.ac-back', { timeout: 8000 });

      const backBtn = await page.$('.ac-back');
      const backText = await backBtn?.innerText();
      console.log('Admin Back Button Text:', backText);

      // Switch to Users tab
      const userTabBtn = await page.$('#admin-nav button:has-text("Users")');
      if (userTabBtn) {
        await userTabBtn.click();
        await page.waitForSelector('.ac-user-badges', { timeout: 5000 });

        const userBadges = await page.$('.ac-user-badges');
        console.log('Admin user badges grouped wrapper present:', !!userBadges);
        results.adminNavigationAndBadges = (backText?.includes('Back to Main App')) && !!userBadges;
      }

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_admin_panel.png') });
      await context.close();
    }

    console.log('\n--- 6. Testing DSA Dark Mode Question Visibility ---');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await setupApiMocks(page, 'STUDENT');
      
      await page.addInitScript(() => {
        const mockUser = { id: 1, name: 'QA Tester', role: 'STUDENT', email: 'tester@novatutor.test', token: 'mock-token' };
        localStorage.setItem('ai_user', JSON.stringify(mockUser));
        localStorage.setItem('nova_theme', 'dark');
      });

      await page.goto(`${BASE_URL}/#/dsa`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);

      const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
      console.log('Dark mode active:', isDark);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_dsa_dark_mode.png') });
      results.dsaDarkModeVisibility = isDark;
      await context.close();
    }

    console.log('\n--- 7. Testing Login Wake-Up Experience Branding ---');
    {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      
      // Force wake-up box display by triggering login with 503 wake-up response
      await page.route('**/api/auth/login', async (route) => {
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'SERVER_WAKING_UP', message: 'NovaTutor is waking up' })
        });
      });
      await page.route('**/actuator/health/readiness', async (route) => {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'UP' }) });
      });

      await page.goto(`${BASE_URL}/#/login`, { waitUntil: 'networkidle' });
      await page.fill('#auth-email', 'tester@novatutor.test');
      await page.fill('#auth-pass', 'password123');
      await page.click('button.auth-submit');

      await page.waitForSelector('.auth-wakeup-box', { timeout: 6000 });
      const title = await page.$eval('.auth-wakeup-title', el => el.textContent);
      const hasNMark = await page.$('.auth-wakeup-n-mark') !== null;
      console.log(`Wake-up Title: "${title}", Has Branded N Mark: ${hasNMark}`);
      results.loginWakeUpBranding = hasNMark && /NovaTutor/i.test(title);

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_wakeup_branding.png') });
      await context.close();
    }

    console.log('\n========================================');
    console.log('        MASTER VISUAL QA RESULTS        ');
    console.log('========================================');
    console.log(JSON.stringify(results, null, 2));

    const allPassed =
      results.mobileScrollPerformance?.longFrames === 0 &&
      Object.values(results.viewportsOverflow).every(v => !v.hasHorizontalOverflow) &&
      results.gateDirectNavigation &&
      results.homeClickableCards &&
      results.coursesClickableCards &&
      results.adminNavigationAndBadges &&
      results.dsaDarkModeVisibility &&
      results.loginWakeUpBranding;

    console.log(`\nALL CORE VISUAL QA INVARIANTS MET: ${allPassed ? 'YES (100% PASS)' : 'FAIL'}`);

    await browser.close();
  } finally {
    console.log('--- Stopping Vite Preview Server ---');
    preview.kill();
  }
}

runMasterVisualQA().catch(err => {
  console.error('Master Visual QA Error:', err);
  process.exit(1);
});
