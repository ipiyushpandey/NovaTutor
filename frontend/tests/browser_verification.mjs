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

  // -------------------------------------------------------------
  // Test Suite 8: Home Page First-Load/Refresh Visibility & History Complete Repair
  // -------------------------------------------------------------
  console.log('\n--- 8. Testing Home Page Visibility & Learning History Complete Repair ---');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const validJwt = makeDummyJwt(Math.floor(Date.now() / 1000) + 7200);

    let historyStore = [
      {
        id: 101,
        itemType: 'LESSON',
        itemKey: 'course_1_lesson_1',
        title: 'Lecture 1 — Introduction to Binary Search',
        category: 'Data Structures & Algorithms',
        targetRoute: 'course/1/lesson/1',
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: 102,
        itemType: 'LESSON',
        itemKey: 'course_999_lesson_1',
        title: 'Lecture 1 — Retired Legacy Topic',
        category: 'Archived Course',
        targetRoute: 'course/999/lesson/1',
        updatedAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: 103,
        itemType: 'AI_TEACHER',
        itemKey: 'teacher_session_1',
        title: 'Dynamic Programming Subproblems',
        category: 'AI Teacher',
        targetRoute: 'learning-studio',
        contentSnapshot: JSON.stringify({ topic: 'Dynamic Programming', message: 'Explain memoization', answer: 'Memoization stores subproblem solutions.' }),
        updatedAt: new Date(Date.now() - 10800000).toISOString(),
      }
    ];

    await page.route('**/api/**', route => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/auth/login') || url.includes('/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 202, name: 'Taylor Student', email: 'taylor@novatutor.local', role: 'STUDENT', profileComplete: true, token: validJwt }),
        });
      }
      if (url.includes('/users/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 202, name: 'Taylor Student', role: 'STUDENT', profileComplete: true }) });
      }
      if (url.includes('/courses')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            { id: 1, title: 'Data Structures & Algorithms', level: 'Beginner', totalLessons: 10, icon: '🌳', description: 'Master foundational algorithms.' },
            { id: 2, title: 'Computer Networks', level: 'Intermediate', totalLessons: 8, icon: '🌐', description: 'TCP/IP, routing, and DNS.' },
            { id: 3, title: 'Operating Systems', level: 'Advanced', totalLessons: 12, icon: '⚡', description: 'Threads, virtual memory, and concurrency.' }
          ]),
        });
      }
      if (url.includes('/analytics/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ streak: 5, xp: 1250, studyMinutes: 180, courses: [] }) });
      }
      if (url.includes('/intelligence/')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            streak: 5,
            quizzes: 4,
            studyMinutes: 180,
            weakAreas: [{ subject: 'Binary Search', topic: 'Boundary conditions', accuracy: 55, reason: 'Off-by-one errors' }],
            recommendations: [{ title: 'Practice Binary Search range queries', description: 'Refine your edge-case handling.', action: 'Start revision', target: 'revision' }],
            mastery: [{ subject: 'Arrays & Two Pointers', accuracy: 88, state: 'Mastered', trend: 'Improving' }, { subject: 'Binary Trees', accuracy: 62, state: 'Practicing', trend: 'Steady' }]
          }),
        });
      }
      if (url.includes('/progress/')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ courseId: 1, percent: 30, completedLessons: 3, totalLessons: 10 }]) });
      }
      if (url.includes('/ai/status')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, model: 'gemini' }) });
      }
      if (url.includes('/history')) {
        if (method === 'DELETE') {
          const match = url.match(/\/history\/(\d+)/);
          if (match) {
            const delId = Number(match[1]);
            historyStore = historyStore.filter(x => x.id !== delId);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ deleted: true }) });
          } else {
            historyStore = [];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cleared: true }) });
          }
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(historyStore) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Sign in to Dashboard
    await page.goto('http://localhost:5188/#/login');
    await page.waitForTimeout(300);
    await page.fill('input[type="email"]', 'taylor@novatutor.local');
    await page.fill('input[type="password"]', 'Password123');
    await page.click('button.auth-submit');
    await page.waitForTimeout(600);

    assert.equal(await page.locator('.app-topnav').count(), 1, 'TopNav must mount on login');
    assert.match(page.url(), /#\/dashboard/);

    // 1. Initial Load Visibility Verification: zero invisible elements
    console.log('  → Verifying Home page initial load visibility...');
    await page.waitForSelector('.dash-morning');
    await page.waitForSelector('.course-grid');
    await page.waitForTimeout(400);

    const invisibleElements = await page.evaluate(() => {
      const candidates = document.querySelectorAll('.dash-morning, .dash-continue, .nova-brain, .intelligence-snapshot, .mastery-snapshot, .course-card');
      const bad = [];
      const vh = window.innerHeight;
      candidates.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < vh && rect.bottom > 0) {
          const style = window.getComputedStyle(el);
          if (style.opacity === '0' || style.visibility === 'hidden') {
            bad.push({ tag: el.tagName, className: el.className });
          }
        }
      });
      return bad;
    });

    assert.equal(invisibleElements.length, 0, `All Home page visible elements must have opacity > 0 on initial load, found hidden: ${JSON.stringify(invisibleElements)}`);
    console.log('  ✓ Home page initial load: Zero invisible/black elements in viewport');

    // Capture desktop light screenshot
    await page.screenshot({ path: 'docs/stabilization/ui-evidence/dashboard-desktop-light.png', fullPage: false });

    // 2. Refresh Page Verification: zero invisible elements after reload
    console.log('  → Refreshing Home page...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dash-morning');
    await page.waitForTimeout(500);

    const invisibleAfterRefresh = await page.evaluate(() => {
      const candidates = document.querySelectorAll('.dash-morning, .dash-continue, .nova-brain, .intelligence-snapshot, .mastery-snapshot, .course-card');
      const bad = [];
      const vh = window.innerHeight;
      candidates.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.top < vh && rect.bottom > 0) {
          const style = window.getComputedStyle(el);
          if (style.opacity === '0' || style.visibility === 'hidden') {
            bad.push({ tag: el.tagName, className: el.className });
          }
        }
      });
      return bad;
    });

    assert.equal(invisibleAfterRefresh.length, 0, `All Home page elements must remain visible after refresh, found hidden: ${JSON.stringify(invisibleAfterRefresh)}`);
    console.log('  ✓ Home page after refresh: Zero invisible/black elements in viewport');

    // 3. Dark Mode Toggle Verification
    console.log('  → Toggling dark mode...');
    await page.click('button.theme-toggle');
    await page.waitForTimeout(300);

    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    assert.ok(isDark, 'HTML element must have .dark class');

    const morningBg = await page.evaluate(() => window.getComputedStyle(document.querySelector('.dash-morning')).backgroundColor);
    console.log(`  ✓ Dark mode active, dash-morning computed background: ${morningBg}`);
    await page.screenshot({ path: 'docs/stabilization/ui-evidence/dashboard-desktop-dark.png', fullPage: false });

    // Switch back to light mode
    await page.click('button.theme-toggle');
    await page.waitForTimeout(200);

    // 4. Mobile Viewport Check
    console.log('  → Verifying mobile viewport (390px)...');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(mobileOverflow, false, 'Mobile Home page must not have horizontal overflow');
    await page.screenshot({ path: 'docs/stabilization/ui-evidence/dashboard-mobile.png', fullPage: false });
    console.log('  ✓ Mobile Home page verified with zero horizontal overflow');

    // Restore desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);

    // 5. Learning History Repair Verification
    console.log('  → Navigating to Learning History (#/history)...');
    await page.evaluate(() => { window.location.hash = '#/history'; });
    await page.waitForSelector('.learning-history-page');
    await page.waitForSelector('.history-card');
    await page.waitForTimeout(300);

    const initialCardCount = await page.locator('.history-card').count();
    assert.equal(initialCardCount, 3, 'Must render 3 history items');
    await page.screenshot({ path: 'docs/stabilization/ui-evidence/history-desktop.png', fullPage: false });

    // Test inline individual delete confirmation
    console.log('  → Testing individual delete with inline confirmation...');
    const firstTrashBtn = page.locator('.history-card:nth-child(1) .history-delete-item-btn');
    await firstTrashBtn.click();
    await page.waitForTimeout(200);

    // Verify inline confirmation prompt appears
    const confirmPrompt = await page.locator('.history-item-confirm').count();
    assert.equal(confirmPrompt, 1, 'Inline confirmation prompt "Remove? Yes / No" must appear');
    await page.screenshot({ path: 'docs/stabilization/ui-evidence/history-delete-confirm.png', fullPage: false });

    // Click Yes to delete
    await page.click('.history-item-confirm button.danger-btn');
    await page.waitForTimeout(300);

    const cardCountAfterDelete = await page.locator('.history-card').count();
    assert.equal(cardCountAfterDelete, 2, 'Item must be removed immediately upon confirmed deletion');
    console.log('  ✓ Individual delete with confirmation: Item cleanly removed');

    // Test missing/unavailable resource fallback
    console.log('  → Testing reopening unavailable/retired course from history...');
    const retiredCard = page.locator('.history-card:has-text("Retired Legacy Topic")');
    await retiredCard.click();
    await page.waitForTimeout(300);

    const toastVisible = await page.locator('.nv-toast').count();
    assert.ok(toastVisible >= 1, 'Graceful toast notification must appear when opening unavailable resource');
    const toastText = await page.locator('.nv-toast').textContent();
    assert.ok(toastText.includes('no longer available'), `Toast must inform user resource is unavailable, got: "${toastText}"`);
    console.log(`  ✓ Graceful unavailable resource fallback verified: "${toastText}"`);

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
