import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// Helper to generate a dummy JWT with specific expiration timestamp
function makeDummyJwt(expSeconds) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'student@novatutor.local',
    id: 42,
    role: 'STUDENT',
    exp: expSeconds,
    iat: Math.floor(Date.now() / 1000) - 300,
  })).toString('base64url');
  return `${header}.${payload}.mockSignature1234567890`;
}

async function runBrowserVerification() {
  console.log('🚀 Starting NovaTutor Playwright Real Browser Verification Pass...');
  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { name: '320px (iPhone SE)', width: 320, height: 600 },
    { name: '390px (iPhone 14 / Android standard)', width: 390, height: 844 },
    { name: '768px (iPad portrait)', width: 768, height: 1024 },
    { name: '1024px (Tablet landscape / small laptop)', width: 1024, height: 768 },
    { name: '1280px (Standard laptop)', width: 1280, height: 800 },
    { name: '1440px (Desktop wide)', width: 1440, height: 900 },
  ];

  let passedChecks = 0;

  // -------------------------------------------------------------
  // Test Suite 1: Unauthenticated Cold Start Across All Viewports
  // -------------------------------------------------------------
  console.log('\n--- 1. Testing Unauthenticated Cold Start Across 6 Viewports ---');
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto('http://localhost:5188/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    // Verify Login page is rendered
    const hasAuth = await page.locator('.auth').count();
    const hasTopNav = await page.locator('.app-topnav').count();
    const hasDashboard = await page.locator('.dashboard').count();

    assert.equal(hasAuth, 1, `[${vp.name}] Auth page must be visible on cold start`);
    assert.equal(hasTopNav, 0, `[${vp.name}] Authenticated TopNav must NOT be visible`);
    assert.equal(hasDashboard, 0, `[${vp.name}] Dashboard must NOT be visible`);

    // Verify horizontal overflow
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false, `[${vp.name}] Page must not have horizontal overflow`);

    console.log(`  ✓ ${vp.name}: Direct to Login, 0 protected elements, 0 overflow`);
    passedChecks++;
    await context.close();
  }

  // -------------------------------------------------------------
  // Test Suite 2: Cold Start with Expired JWT Session
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Cold Start with Expired JWT Session ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const expiredJwt = makeDummyJwt(Math.floor(Date.now() / 1000) - 3600); // Expired 1 hour ago

    let homeFlashed = false;
    await page.addInitScript(({ token }) => {
      localStorage.setItem('ai_user', JSON.stringify({
        id: 99,
        name: 'Stale Student',
        email: 'stale@novatutor.local',
        role: 'STUDENT',
        token,
      }));
      localStorage.setItem('nova_page', 'dashboard');
    }, { token: expiredJwt });

    // Track if dashboard or topnav is ever added to the DOM
    await page.exposeFunction('onProtectedDomNode', () => { homeFlashed = true; });
    await page.addInitScript(() => {
      const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && (node.classList?.contains('dashboard') || node.classList?.contains('app-topnav'))) {
              window.onProtectedDomNode();
            }
          }
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });

    await page.goto('http://localhost:5188/#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    assert.equal(homeFlashed, false, 'Dashboard or TopNav must NEVER flash to an expired session');
    const authCount = await page.locator('.auth').count();
    assert.equal(authCount, 1, 'Expired session must resolve directly to Login');

    const storedUser = await page.evaluate(() => localStorage.getItem('ai_user'));
    assert.equal(storedUser, null, 'Expired session in localStorage must be cleared');

    console.log('  ✓ Expired session: Synchronously cleaned up, 0 Home flash, Login rendered');
    passedChecks++;
    await context.close();
  }

  // -------------------------------------------------------------
  // Test Suite 3: Cold Start with Stale Session (Server 401 on /auth/me)
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Stale Session (Server 401 on /auth/me) ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const validLookingJwt = makeDummyJwt(Math.floor(Date.now() / 1000) + 7200); // 2 hours in future

    let homeFlashed = false;
    await page.addInitScript(({ token }) => {
      localStorage.setItem('ai_user', JSON.stringify({
        id: 88,
        name: 'Revoked Student',
        email: 'revoked@novatutor.local',
        role: 'STUDENT',
        token,
      }));
      localStorage.setItem('nova_page', 'dashboard');
    }, { token: validLookingJwt });

    await page.route('**/api/auth/me', route => route.fulfill({ status: 401, body: JSON.stringify({ message: 'Token revoked' }) }));
    await page.exposeFunction('onProtectedDomNode2', () => { homeFlashed = true; });
    await page.addInitScript(() => {
      const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && (node.classList?.contains('dashboard') || node.classList?.contains('app-topnav'))) {
              window.onProtectedDomNode2();
            }
          }
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });

    await page.goto('http://localhost:5188/#/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    assert.equal(homeFlashed, false, 'Dashboard or TopNav must NEVER flash before /auth/me confirms session');
    const authCount = await page.locator('.auth').count();
    assert.equal(authCount, 1, 'Revoked session must transition cleanly to Login');

    console.log('  ✓ Stale session: Protected UI prevented during bootstrap, transitioned to Login on 401');
    passedChecks++;
    await context.close();
  }

  // -------------------------------------------------------------
  // Test Suite 4: Multi-Page Navigation and Logout History Rewind
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Multi-Page Navigation & Logout History Rewind ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const validJwt = makeDummyJwt(Math.floor(Date.now() / 1000) + 7200);

    // Mock API endpoints for authenticated student
    await page.route('**/api/**', route => {
      const url = route.request().url();
      if (url.includes('/auth/login') || url.includes('/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 101, name: 'Alex Student', email: 'alex@novatutor.local', role: 'STUDENT', profileComplete: true, token: validJwt }),
        });
      }
      if (url.includes('/users/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 101, name: 'Alex Student', role: 'STUDENT', profileComplete: true }) });
      }
      if (url.includes('/courses')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (url.includes('/progress/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (url.includes('/ai/status')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, model: 'gemini' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Start on Login
    await page.goto('http://localhost:5188/#/login');
    await page.waitForTimeout(300);

    // Perform real form submission login
    await page.fill('input[type="email"]', 'alex@novatutor.local');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button.auth-submit');
    await page.waitForTimeout(600);

    // Verify authenticated Dashboard is mounted
    assert.equal(await page.locator('.app-topnav').count(), 1, 'Authenticated TopNav must be present');
    console.log('  ✓ Authenticated session active on Dashboard');

    // Perform multiple page navigations
    const pagesToVisit = ['courses', 'gatecse', 'dsa', 'learning-studio'];
    for (const p of pagesToVisit) {
      await page.evaluate(target => {
        // Trigger in-app go navigation
        const brand = document.querySelector(`button.topnav-item[role="menuitem"], .sheet-item`);
        window.location.hash = '#/' + target;
      }, p);
      await page.waitForTimeout(300);
      assert.match(page.url(), new RegExp(`#/${p}`));
    }
    console.log('  ✓ Visited pages: Dashboard → Courses → GATE CSE → DSA → Learning Studio');

    // Test Back button while authenticated
    await page.goBack();
    await page.waitForTimeout(300);
    assert.match(page.url(), /#\/dsa/, 'Browser Back while authenticated should land on DSA');

    await page.goBack();
    await page.waitForTimeout(300);
    assert.match(page.url(), /#\/gatecse/, 'Browser Back while authenticated should land on GATE CSE');

    // Test Forward button while authenticated
    await page.goForward();
    await page.waitForTimeout(300);
    assert.match(page.url(), /#\/dsa/, 'Browser Forward while authenticated should land on DSA');

    console.log('  ✓ Back and Forward work seamlessly while authenticated');

    // Click Log Out from account menu
    const avatar = page.locator('button.topnav-avatar');
    await avatar.click();
    await page.waitForTimeout(200);
    const logoutBtn = page.locator('.account-panel button.danger');
    await logoutBtn.click();
    await page.waitForTimeout(500);

    // Verify we are cleanly on Login
    assert.match(page.url(), /#\/login/, 'Logout must navigate to #/login');
    assert.equal(await page.locator('.auth').count(), 1, 'Auth page must be visible');
    assert.equal(await page.locator('.app-topnav').count(), 0, 'TopNav must be unmounted');
    console.log('  ✓ Logged out successfully to #/login');

    // Now test Back button after logout
    console.log('  → Pressing Back button after logout...');
    await page.goBack();
    await page.waitForTimeout(400);

    // Verify URL does NOT cycle through protected routes and protected content is never shown
    const afterBackUrl = page.url();
    const afterBackProtected = await page.locator('.app-topnav, .dashboard, .gate-grid').count();
    assert.equal(afterBackProtected, 0, 'Protected content must NEVER appear after pressing Back after logout');
    assert.ok(afterBackUrl.includes('#/login') || !afterBackUrl.includes('#/'), `URL must not point to protected endpoints, got: ${afterBackUrl}`);

    // Press Back again
    await page.goBack();
    await page.waitForTimeout(400);
    const afterBack2Protected = await page.locator('.app-topnav, .dashboard, .gate-grid').count();
    assert.equal(afterBack2Protected, 0, 'Protected content must NEVER appear after repeated Back presses');

    // Press Forward
    console.log('  → Pressing Forward button after logout...');
    await page.goForward();
    await page.waitForTimeout(400);
    const afterForwardProtected = await page.locator('.app-topnav, .dashboard, .gate-grid').count();
    assert.equal(afterForwardProtected, 0, 'Protected content must NEVER appear after pressing Forward after logout');

    console.log('  ✓ Back/Forward after logout: Zero protected content leaks, zero endpoint cycling');
    passedChecks++;
    await context.close();
  }

  // -------------------------------------------------------------
  // Test Suite 5: Wake-Up Timer Continuity Across Theme Switches
  // -------------------------------------------------------------
  console.log('\n--- 5. Testing Wake-Up Timer Continuity Across Theme Switches ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    // Mock login endpoint to fail with cold-start wake-up error
    await page.route('**/api/auth/login', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Server is waking up, please wait.' }),
    }));
    await page.route('**/api/health', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'STARTING' }),
    }));

    await page.goto('http://localhost:5188/#/login');
    await page.waitForTimeout(300);

    // Fill credentials and click Sign in to trigger LoginWakeUp box
    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button.auth-submit');

    // Wait for wake-up box
    const wakeUpBox = page.locator('.auth-wakeup-box');
    await wakeUpBox.waitFor({ state: 'visible', timeout: 5000 });
    console.log('  ✓ LoginWakeUp box displayed');

    // Let 2.5 seconds elapse
    await page.waitForTimeout(2500);
    const initialElapsedText = await page.locator('.auth-wakeup-timer-row span:first-child').innerText();
    const elapsedMatch = initialElapsedText.match(/(\d+)\s*s/);
    const initialSeconds = elapsedMatch ? parseInt(elapsedMatch[1], 10) : 0;
    assert.ok(initialSeconds >= 2, `Elapsed seconds should be at least 2s, got: ${initialSeconds}`);

    // Rapidly toggle Theme 6 times (Light -> Dark -> Light -> Dark -> Light -> Dark)
    console.log('  → Toggling Theme 6 times rapidly...');
    const themeBtn = page.locator('.auth-theme, .theme-toggle');
    for (let i = 0; i < 6; i++) {
      await themeBtn.click();
      await page.waitForTimeout(150);
    }

    // Check timer immediately after theme toggles
    const postToggleText = await page.locator('.auth-wakeup-timer-row span:first-child').innerText();
    const postToggleMatch = postToggleText.match(/(\d+)\s*s/);
    const postToggleSeconds = postToggleMatch ? parseInt(postToggleMatch[1], 10) : 0;

    assert.ok(postToggleSeconds >= initialSeconds,
      `Elapsed seconds must NOT reset after theme toggles! Was ${initialSeconds}s, now ${postToggleSeconds}s`);

    // Let another second pass to verify timer continues ticking
    await page.waitForTimeout(1200);
    const finalText = await page.locator('.auth-wakeup-timer-row span:first-child').innerText();
    const finalSeconds = parseInt(finalText.match(/(\d+)\s*s/)[1], 10);
    assert.ok(finalSeconds > postToggleSeconds, `Timer must continue ticking forward! Was ${postToggleSeconds}s, now ${finalSeconds}s`);

    console.log(`  ✓ Wake-Up timer continuity verified: ${initialSeconds}s → ${postToggleSeconds}s → ${finalSeconds}s across 6 theme toggles`);
    passedChecks++;
    await context.close();
  }

  // -------------------------------------------------------------
  // Test Suite 6: Public Routes Integrity
  // -------------------------------------------------------------
  console.log('\n--- 6. Testing Public Routes Integrity ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const publicRoutes = ['about', 'privacy', 'terms', 'contact'];
    for (const r of publicRoutes) {
      await page.goto(`http://localhost:5188/#/${r}`);
      await page.waitForTimeout(300);
      assert.match(page.url(), new RegExp(`#/${r}`), `Public route #${r} must stay on #${r}`);
      const hasContent = await page.locator('.public-page, .auth').count();
      assert.ok(hasContent > 0, `Public page #${r} must render`);
      console.log(`  ✓ Public route #${r} accessible without auth`);
    }
    passedChecks++;
    await context.close();
  }

  // -------------------------------------------------------------
  // Test Suite 7: Learning History, Redirect Restoration & Quiz Review
  // -------------------------------------------------------------
  console.log('\n--- 7. Testing Learning History, Redirect Restoration & Quiz Review ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const validJwt = makeDummyJwt(Math.floor(Date.now() / 1000) + 7200);

    // Mock API endpoints for Suite 7
    await page.route('**/api/**', route => {
      const url = route.request().url();
      if (url.includes('/auth/login') || url.includes('/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 42, name: 'Alex Rivera', email: 'alex@novatutor.local', role: 'STUDENT', profileComplete: true, token: validJwt }),
        });
      }
      if (url.includes('/auth/providers')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ googleEnabled: false, googleClientId: '', emailDeliveryConfigured: true }) });
      }
      if (url.includes('/users/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 42, name: 'Alex Rivera', role: 'STUDENT', profileComplete: true }) });
      }
      if (url.includes('/quizzes/course/1/submit')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            score: 100,
            correct: 1,
            total: 1,
            message: 'Mastery achieved!',
            reviews: [
              {
                id: 1,
                question: 'What is the worst-case time complexity of linear search?',
                options: ['O(1)', 'O(log n)', 'O(n)', 'O(n^2)'],
                selectedOption: 2,
                correctOption: 2,
                correct: true,
                difficulty: 'EASY',
                explanation: 'Linear search must examine every element in the worst case, taking O(n) comparisons.'
              }
            ]
          }),
        });
      }
      if (url.includes('/quizzes/course/1')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 1, question: 'What is the worst-case time complexity of linear search?', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n^2)'], difficulty: 'EASY' }
          ]),
        });
      }
      if (url.includes('/history')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 101,
              itemType: 'LESSON',
              itemKey: 'course_1_lesson_1',
              title: 'Lecture 1 — Introduction to Data Structures',
              category: 'Data Structures & Algorithms',
              targetRoute: 'course/1/lesson/1',
              updatedAt: new Date().toISOString()
            },
            {
              id: 102,
              itemType: 'DSA',
              itemKey: 'dsa_two-sum',
              title: 'Two Sum',
              category: 'Array',
              targetRoute: 'dsa/two-sum',
              updatedAt: new Date(Date.now() - 3600000).toISOString()
            }
          ]),
        });
      }
      if (url.includes('/courses')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 1, title: 'Data Structures & Algorithms', level: 'Beginner', totalLessons: 12, lessons: [] }
          ]),
        });
      }
      if (url.includes('/progress/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      if (url.includes('/ai/status')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, model: 'gemini' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // 1. Unauthenticated direct deep link to #/courses -> captured in sessionStorage and canonicalized to #/login
    await page.goto('http://localhost:5188/#/courses', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(300);

    assert.match(page.url(), /#\/login/, 'Direct protected link #/courses must canonicalize immediately to #/login');
    const redirectTarget = await page.evaluate(() => sessionStorage.getItem('nova_redirect_target'));
    assert.equal(redirectTarget, 'courses', 'Direct deep link target must be remembered in sessionStorage');

    // 2. Perform login & verify auto-redirection to saved target (#/courses)
    await page.fill('input[type="email"]', 'alex@novatutor.local');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button.auth-submit');
    await page.waitForTimeout(800);

    assert.match(page.url(), /#\/courses/, 'Login must restore intended redirect destination #/courses');
    console.log('  ✓ Deep link target remembered and restored upon login');

    // 3. Test Learning History view
    await page.evaluate(() => { window.location.hash = '#/history'; });
    await page.waitForTimeout(400);

    const hasHistoryPage = await page.locator('.learning-history-page').count();
    assert.equal(hasHistoryPage, 1, 'LearningHistoryView must render on #/history');
    const historyCards = await page.locator('.history-card').count();
    assert.equal(historyCards, 2, 'History cards should render correctly');
    console.log('  ✓ Learning History page mounted with recorded items and filter pills');

    // 4. Test Quiz question-by-question review rendering
    await page.evaluate(() => { window.location.hash = '#/quiz'; });
    await page.waitForTimeout(400);

    // Start quiz
    await page.click('.quiz-toolbar button.primary');
    await page.waitForTimeout(400);

    // Answer first question
    await page.click('.quiz-q label:nth-child(5)'); // option index 2: O(n)
    await page.waitForTimeout(200);

    // Submit quiz
    await page.click('.quiz-list button.primary');
    await page.waitForTimeout(600);

    // Verify Quiz Review Breakdown
    const hasReviewSection = await page.locator('.quiz-review-section').count();
    assert.equal(hasReviewSection, 1, 'Quiz review breakdown section must be rendered');
    const hasCorrectBadge = await page.locator('.quiz-review-badge.badge-correct').count();
    assert.equal(hasCorrectBadge, 1, 'Quiz review badge-correct must be visible');
    const hasExplanation = await page.locator('.quiz-review-explanation').count();
    assert.equal(hasExplanation, 1, 'Quiz explanation must be visible');
    console.log('  ✓ Quiz result renders complete answer review, badges, and explanations');

    passedChecks++;
    await context.close();
  }

  await browser.close();
  console.log(`\n🎉 All ${passedChecks} Playwright Real Browser Verification Test Suites PASSED!`);
}

runBrowserVerification().catch(err => {
  console.error('\n❌ Browser verification failed:', err);
  process.exit(1);
});
