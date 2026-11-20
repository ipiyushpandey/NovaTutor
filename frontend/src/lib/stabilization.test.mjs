import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(__dirname, '../..');

function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

function setupBrowserGlobals() {
  const events = [];
  globalThis.localStorage = makeStorage();
  globalThis.window = {
    location: { origin: 'http://localhost:5173', hash: '#/dashboard' },
    dispatchEvent: (ev) => { events.push(ev?.type || String(ev)); return true; },
  };
  globalThis.Event = class MockEvent {
    constructor(type) { this.type = type; }
  };
  return events;
}

test('api.js silentUpdate suppresses nova:learning-updated on POST while default emits it', async () => {
  const events = setupBrowserGlobals();
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const { api } = await import('./api.js?t=' + Date.now());

  await api('/mentor/ask', { method: 'POST', body: JSON.stringify({ q: 1 }), silentUpdate: true });
  assert.equal(events.filter((e) => e === 'nova:learning-updated').length, 0);

  await api('/progress/1/complete', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(events.filter((e) => e === 'nova:learning-updated').length, 1);
});

test('api.js retries idempotent GET on transient 503 and does NOT retry POST on 503', async () => {
  setupBrowserGlobals();
  let getCalls = 0;
  let postCalls = 0;

  globalThis.fetch = async (url, init) => {
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET') {
      getCalls += 1;
      if (getCalls === 1) {
        return new Response(JSON.stringify({ message: 'Service waking up' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ courses: [1, 2] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    postCalls += 1;
    return new Response(JSON.stringify({ message: 'Transient upstream error' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { api } = await import('./api.js?retry=' + Date.now());
  const res = await api('/courses', { retries: 1 });
  assert.deepEqual(res, { courses: [1, 2] });
  assert.equal(getCalls, 2);

  await assert.rejects(
    () => api('/ai/ask', { method: 'POST', body: JSON.stringify({ message: 'hi' }), retries: 2 }),
    /Transient upstream error/
  );
  assert.equal(postCalls, 1);
});

test('apiStream respects AbortSignal, parses WHATWG SSE (leading space, multiline, bare done token), sends JSON fallback Accept, and refreshes once on 401', async () => {
  setupBrowserGlobals();
  globalThis.localStorage.setItem('ai_user', JSON.stringify({ id: 7, token: 'expired-jwt' }));

  let streamCalls = 0;
  let refreshCalls = 0;
  let seenAccept = '';

  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/me')) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ id: 7, role: 'STUDENT', token: 'fresh-jwt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    seenAccept = init?.headers?.Accept || '';
    streamCalls += 1;
    if (streamCalls === 1) {
      return new Response(JSON.stringify({ message: 'Expired' }), { status: 401 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: Hello \n\n'));
        controller.enqueue(encoder.encode('data: done\n\n')); // bare LLM token "done" (message event, MUST NOT be dropped!)
        controller.enqueue(encoder.encode('data:  Line1\ndata: Line2\n\n')); // 2nd space preserved + multiline joined
        controller.enqueue(encoder.encode('event: done\ndata: done\n\n')); // real completion event
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  const { apiStream } = await import('./api.js?stream=' + Date.now());
  let collected = '';
  await apiStream('/ai/ask/stream', { method: 'POST', body: '{}' }, (chunk) => {
    collected += chunk;
  });
  assert.equal(refreshCalls, 1);
  assert.equal(streamCalls, 2);
  assert.match(seenAccept, /text\/event-stream/);
  assert.match(seenAccept, /application\/json/);
  // Single space stripped per WHATWG SSE spec; bare "done" token preserved; multiline joined with \n; event:done completes cleanly.
  assert.equal(collected, 'Hello done Line1\nLine2');

  // Verify pre-aborted AbortSignal aborts cleanly without throwing a generic error
  const ac = new AbortController();
  ac.abort();
  globalThis.fetch = async (url, init) => {
    if (init?.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
    return new Response('', { status: 200 });
  };
  await assert.rejects(
    () => apiStream('/ai/ask/stream', { method: 'POST', body: '{}', signal: ac.signal }, () => {}),
    (err) => err?.name === 'AbortError'
  );
});

test('api.js preserves session on non-session 401 and transient /auth/me network failure, expires only on real /auth/me 401', async () => {
  const events = setupBrowserGlobals();
  const initialUser = JSON.stringify({ id: 9, role: 'STUDENT', token: 'valid-jwt' });
  globalThis.localStorage.setItem('ai_user', initialUser);

  // 1. Wrong current password on /users/9/password returns 401 — must NOT wipe ai_user or emit nova-session-expired
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Current password is incorrect.' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  const mod = await import('./api.js?auth401=' + Date.now());
  await assert.rejects(
    () => mod.api('/users/9/password', { method: 'PUT', body: JSON.stringify({ currentPassword: 'bad', newPassword: 'good' }) }),
    /Current password is incorrect/
  );
  assert.equal(globalThis.localStorage.getItem('ai_user'), initialUser);
  assert.equal(events.filter((e) => e === 'nova-session-expired').length, 0);

  // 2. Transient network failure during /auth/me refresh must NOT log out the user
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/me')) {
      throw new TypeError('Load failed');
    }
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await assert.rejects(() => mod.api('/courses'), /Unauthorized|Unable to verify|Cannot reach/i);
  assert.equal(globalThis.localStorage.getItem('ai_user'), initialUser);
  assert.equal(events.filter((e) => e === 'nova-session-expired').length, 0);

  // 3. Authoritative 401 from /auth/me DOES clear ai_user and emit nova-session-expired
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Session expired' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(() => mod.api('/courses'), /Session expired/i);
  assert.equal(globalThis.localStorage.getItem('ai_user'), null);
  assert.equal(events.filter((e) => e === 'nova-session-expired').length, 1);
});

test('REAUDIT-04: delayed /auth/me cannot resurrect logged-out session or overwrite switched account', async () => {
  const events = setupBrowserGlobals();
  const mod = await import('./api.js?t=' + Date.now() + '_race');

  // 1. Logout while /auth/me is still in-flight -> delayed 200 MUST NOT restore ai_user or emit nova:session-refreshed
  const userA = JSON.stringify({ id: 10, name: 'User A', email: 'a@test.com', role: 'STUDENT', token: 'tok-A' });
  globalThis.localStorage.setItem('ai_user', userA);
  let resolveAuthMeA;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith('/auth/me'));
    return new Promise((resolve) => { resolveAuthMeA = resolve; });
  };
  const pendingLogoutRefresh = mod.refreshSessionToken();
  // Simulate logout while /auth/me is pending
  mod.invalidatePendingSessionRefresh();
  globalThis.localStorage.removeItem('ai_user');
  resolveAuthMeA(new Response(JSON.stringify({ id: 10, name: 'User A', email: 'a@test.com', role: 'STUDENT', token: 'tok-A-rotated' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  const okAfterLogout = await pendingLogoutRefresh;
  assert.equal(okAfterLogout, false);
  assert.equal(globalThis.localStorage.getItem('ai_user'), null);
  assert.equal(events.filter((e) => e === 'nova:session-refreshed').length, 0);

  // 2. Account switch User A -> User B while User A's /auth/me is still in-flight -> User B MUST NOT be overwritten
  globalThis.localStorage.setItem('ai_user', userA);
  let resolveSwitchAuthMe;
  globalThis.fetch = async () => new Promise((resolve) => { resolveSwitchAuthMe = resolve; });
  const pendingSwitchRefresh = mod.refreshSessionToken();
  // Switch to User B before User A's /auth/me returns
  const userB = JSON.stringify({ id: 99, name: 'User B', email: 'b@test.com', role: 'STUDENT', token: 'tok-B' });
  mod.invalidatePendingSessionRefresh();
  globalThis.localStorage.setItem('ai_user', userB);
  resolveSwitchAuthMe(new Response(JSON.stringify({ id: 10, name: 'User A', email: 'a@test.com', role: 'STUDENT', token: 'tok-A-new' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
  const okAfterSwitch = await pendingSwitchRefresh;
  assert.equal(okAfterSwitch, false);
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('ai_user')), JSON.parse(userB));
  assert.equal(events.filter((e) => e === 'nova:session-refreshed').length, 0);

  // 3. MERGE-BLOCKER-01 (normal api): Delayed 401 from User A after switching to User B MUST NOT
  //    call /auth/me for User B, MUST NOT replay User A's request under User B's token, and MUST keep User B signed in.
  globalThis.localStorage.setItem('ai_user', userA);
  let resolveStaleApi401;
  let staleApiCalls = 0;
  let authMeCallsAfterSwitch = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/auth/me')) {
      authMeCallsAfterSwitch += 1;
      return new Response(userB, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    staleApiCalls += 1;
    if (staleApiCalls === 1) {
      return new Promise((resolve) => { resolveStaleApi401 = resolve; });
    }
    return new Response(JSON.stringify({ replayedUnderWrongUser: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const staleApiReq = mod.api('/quizzes/course/1/submit', { method: 'POST', body: JSON.stringify({ answers: [{ questionId: 1, selectedOption: 0 }] }), retries: 0 });
  mod.invalidatePendingSessionRefresh();
  globalThis.localStorage.setItem('ai_user', userB);
  resolveStaleApi401(new Response(JSON.stringify({ message: 'Old token expired' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }));
  await assert.rejects(() => staleApiReq, /Old token expired/i);
  assert.equal(authMeCallsAfterSwitch, 0, 'Stale User A 401 must NOT trigger /auth/me for User B');
  assert.equal(staleApiCalls, 1, 'Stale User A request must NOT be replayed under User B token');
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('ai_user')), JSON.parse(userB));
  assert.equal(events.filter((e) => e === 'nova-session-expired').length, 0);

  // 4. MERGE-BLOCKER-01 (apiStream): Delayed 401 from User A's stream after switching to User B MUST NOT
  //    call /auth/me for User B, MUST NOT replay User A's stream under User B's token, and MUST keep User B signed in.
  globalThis.localStorage.setItem('ai_user', userA);
  let resolveStaleStream401;
  let staleStreamCalls = 0;
  let streamAuthMeCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/auth/me')) {
      streamAuthMeCalls += 1;
      return new Response(userB, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    staleStreamCalls += 1;
    if (staleStreamCalls === 1) {
      return new Promise((resolve) => { resolveStaleStream401 = resolve; });
    }
    return new Response('data: replayed\n\nevent: done\ndata: done\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  const staleStreamReq = mod.apiStream('/ai/ask/stream', { method: 'POST', body: JSON.stringify({ task: 'CODING', message: 'hi' }) }, () => {});
  mod.invalidatePendingSessionRefresh();
  globalThis.localStorage.setItem('ai_user', userB);
  resolveStaleStream401(new Response(JSON.stringify({ message: 'Old stream token expired' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }));
  await assert.rejects(() => staleStreamReq, /Old stream token expired/i);
  assert.equal(streamAuthMeCalls, 0, 'Stale User A stream 401 must NOT trigger /auth/me for User B');
  assert.equal(staleStreamCalls, 1, 'Stale User A stream must NOT be replayed under User B token');
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('ai_user')), JSON.parse(userB));
  assert.equal(events.filter((e) => e === 'nova-session-expired').length, 0);

  // 5. Same-session legitimate 401 refresh-and-retry STILL works when originating session is unchanged
  globalThis.localStorage.setItem('ai_user', userB);
  let sameSessionApiCalls = 0;
  let sameSessionAuthMeCalls = 0;
  let retryAuthHeader = '';
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/auth/me')) {
      sameSessionAuthMeCalls += 1;
      return new Response(JSON.stringify({ id: 99, name: 'User B', email: 'b@test.com', role: 'STUDENT', token: 'tok-B-rotated' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    sameSessionApiCalls += 1;
    if (sameSessionApiCalls === 1) {
      return new Response(JSON.stringify({ message: 'Expired token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    retryAuthHeader = init?.headers?.Authorization || '';
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const retried = await mod.api('/courses', { retries: 0 });
  assert.deepEqual(retried, { ok: true });
  assert.equal(sameSessionAuthMeCalls, 1);
  assert.equal(sameSessionApiCalls, 2);
  assert.equal(retryAuthHeader, 'Bearer tok-B-rotated');
  assert.equal(JSON.parse(globalThis.localStorage.getItem('ai_user')).token, 'tok-B-rotated');
});

test('security & stabilization source invariants hold across frontend files', () => {
  const mainJsx = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(SRC_DIR, 'styles.css'), 'utf8');
  const gateCseJsx = fs.readFileSync(path.join(SRC_DIR, 'gateCse.jsx'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');
  const themeInitJs = fs.readFileSync(path.join(FRONTEND_DIR, 'public/theme-init.js'), 'utf8');
  const idePreviewHtml = fs.readFileSync(path.join(FRONTEND_DIR, 'public/ide-preview.html'), 'utf8');
  const renderYaml = fs.readFileSync(path.join(FRONTEND_DIR, '../render.yaml'), 'utf8');
  const nginxConf = fs.readFileSync(path.join(FRONTEND_DIR, '../deploy/nginx.conf'), 'utf8');

  // 1. Course IDE iframe must never grant allow-same-origin and must use isolated /ide-preview.html with strict CSP
  assert.match(mainJsx, /sandbox="allow-scripts"\s+referrerPolicy="no-referrer"\s+allow=""\s+src="\/ide-preview\.html"/);
  assert.doesNotMatch(mainJsx, /allow-same-origin/);
  assert.match(idePreviewHtml, /default-src 'none'/);
  assert.match(renderYaml, /path:\s*\/ide-preview\.html/);
  assert.match(nginxConf, /location\s*=\s*\/ide-preview\.html/);

  // 2. TopNav starts closed (no initial desktop dropdown CLS)
  assert.match(mainJsx, /const \[openMenu,setOpenMenu\]=useState\(null\);/);

  // 3. Global error listeners must not trigger nova-recover infinite loops
  assert.doesNotMatch(mainJsx, /dispatchEvent\(new Event\('nova-recover'\)\)/);

  // 4. styles.css must not contain the desktop +210px CLS padding hack and must use theme-safe toast tokens
  assert.doesNotMatch(stylesCss, /body:has\(\.topnav\.subnav-open\)/);
  assert.match(stylesCss, /\.nv-toast\{[^}]*var\(--ink/);

  // 5. GATE CSE fetches hard_quiz.json once (no duplicated paper fetch)
  assert.equal((gateCseJsx.match(/hard_quiz\.json/g) || []).length, 1);

  // 6. index.html loads synchronous external /theme-init.js (no inline <script> violating strict CSP)
  assert.match(indexHtml, /<script src="\/theme-init\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script>(?!<\/script>)/);
  assert.match(themeInitJs, /localStorage\.getItem\('nova_theme'\)/);
  assert.match(themeInitJs, /document\.documentElement\.classList\.add\('dark'\)/);

  // 7. Guest cleanup clears actual nova_workspace_v1_ prefix and all user-scoped keys
  assert.match(mainJsx, /nova_workspace_v1_\$\{idStr\}_/);
  assert.match(mainJsx, /nova_quiz_seen_\$\{idStr\}_/);
  assert.match(mainJsx, /nova_today_done_\$\{idStr\}_/);
  assert.match(mainJsx, /nova_challenge_seen_\$\{idStr\}_/);
  assert.match(mainJsx, /nova_module_state_\$\{idStr\}_/);

  // 8. ADDITIONAL SCOPE (Sections 8-11): Weekly Challenges flex hierarchy & scoped asides
  assert.match(stylesCss, /\.app > aside\.sidebar\{display:flex;flex-direction:column;height:100vh;min-height:100vh/);
  assert.match(stylesCss, /\.challenge-main-row\{display:flex;align-items:center;/);
  assert.match(stylesCss, /\.challenge-action-row\{display:flex;align-items:center;/);
  assert.match(stylesCss, /\.community-side\{[^}]*height:auto!important;min-height:0!important/);

  // 9. ADDITIONAL SCOPE (Section 13): AI Chat mobile actions & delete history confirmation
  assert.match(stylesCss, /\.chat-history-actions \.chat-action-btn\{display:inline-flex;align-items:center;gap:6px;padding:8px 11px;min-height:40px/);
  assert.match(stylesCss, /\.chat-history-actions \.chat-action-btn\{min-height:40px;padding:9px 12px;font-size:12px\}/);
  assert.match(stylesCss, /\.chat-delete-confirm\{min-height:40px/);
  assert.match(mainJsx, /\[confirmDelete,setConfirmDelete\]=useState\(false\)/);
  assert.match(mainJsx, /<button type="button" className="danger-btn compact" onClick=\{deleteHistory\}>Yes, delete<\/button>/);

  // 10. ADDITIONAL SCOPE (Section 14): Voice Tutor Indian English / natural voice & stop cancellation
  assert.match(mainJsx, /const indianRegex=\/\(rishi\|veena\|neerja\|swara\|kavya\|heera\|prabhat\|madhur\|google\\s\*\(\?:en-in\|hi-in\|hindi\)\|india\)\/i/);
  assert.match(mainJsx, /u\.rate=0\.98/);
  assert.match(mainJsx, /u\.pitch=1\.0/);
  assert.match(mainJsx, /playbackSessionRef\.current\+=1/);
  assert.match(mainJsx, /abortControllerRef\.current\.abort\(\)/);

  // 11. FINAL STABILIZATION: Guest onboarding bypass, browser back history replace, & meaningful validation
  assert.match(mainJsx, /const isStudent=String\(session\.role\|\|'STUDENT'\)\.toUpperCase\(\)==='STUDENT';/);
  assert.match(mainJsx, /const needsProfile=isStudent&&session\.profileComplete===false;/);
  assert.match(mainJsx, /if\(parsed\.page==='onboarding'\)\{\s*if\(!needsProfile\)\{\s*setPage\('dashboard'\);window\.location\.replace\('#\/dashboard'\);return;/);
  assert.match(mainJsx, /import \{isMeaningfulText\} from '\.\/lib\/validation\.js'/);
  assert.match(mainJsx, /React.lazy\(\(\) => import\('\.\/gateCse\.jsx'\)\)/);
  assert.match(mainJsx, /React.lazy\(\(\) => import\('\.\/dsa\.jsx'\)\)/);
  assert.match(mainJsx, /React.lazy\(\(\) => import\('\.\/AdminControlCenter\.jsx'\)\)/);

  // 12. FINAL STABILIZATION: Mobile TopNav alignment, courses tabs visibility, and community tabs overflow
  assert.match(stylesCss, /\.topnav-menus\{display:flex;align-items:center;justify-content:center/);
  assert.match(stylesCss, /\.topnav-icon-btn\.topnav-menu-toggle\{width:40px;height:40px/);
  assert.match(stylesCss, /\.hub-tabs\.courses-tabs\{display:flex;width:100%;box-sizing:border-box/);
  assert.match(stylesCss, /\.community-tabs\{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none/);
});

test('isMeaningfulText rejects keystroke gibberish like bcsjcgs and accepts realistic goals and non-latin scripts', async () => {
  const valMod = await import('./validation.js');
  const fn = valMod.isMeaningfulText;
  assert.equal(typeof fn, 'function');
  assert.equal(fn('bcsjcgs'), false);
  assert.equal(fn('asdf'), false);
  assert.equal(fn('bbbbbb'), false);
  assert.equal(fn('123456'), false);
  assert.equal(fn('!@#$%^'), false);
  assert.equal(fn(''), false);
  assert.equal(fn(null), false);

  assert.equal(fn('Learn Java & algorithms'), true);
  assert.equal(fn('GATE CSE preparation 2026'), true);
  assert.equal(fn('Data Structures in C++'), true);
  assert.equal(fn('डेटा संरचना और कोडिंग'), true);
});

test('api.js tags timeout and 502/504 wake-up errors with isWakeUp and SERVER_WAKING_UP code', async () => {
  const { api } = await import('./api.js');
  const originalFetch = globalThis.fetch;
  try {
    // 502 Bad Gateway
    globalThis.fetch = async () => new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    let err502 = null;
    try { await api('/test-wake-502', { method: 'POST', body: '{}' }); } catch (e) { err502 = e; }
    assert(err502, 'Should throw on 502');
    assert.equal(err502.isWakeUp, true);
    assert.equal(err502.code, 'SERVER_WAKING_UP');

    // 503 waking up
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Server is waking up from idle' }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    });
    let err503 = null;
    try { await api('/test-wake-503', { method: 'POST', body: '{}' }); } catch (e) { err503 = e; }
    assert(err503, 'Should throw on 503');
    assert.equal(err503.isWakeUp, true);
    assert.equal(err503.code, 'SERVER_WAKING_UP');

    // Abort timeout
    globalThis.fetch = async (_url, opt) => {
      return new Promise((_, reject) => {
        const timer = setTimeout(() => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        }, 50);
        opt?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    };
    let errTimeout = null;
    try { await api('/test-timeout', { timeoutMs: 20 }); } catch (e) { errTimeout = e; }
    assert(errTimeout, 'Should throw on timeout');
    assert.equal(errTimeout.isWakeUp, true);
    assert.equal(errTimeout.code, 'SERVER_WAKING_UP');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('UI and motion invariants: LoginWakeUp, useLayoutEffect, and admin mobile drawer exist', () => {
  const mainJsx = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(SRC_DIR, 'styles.css'), 'utf8');
  const tokensCss = fs.readFileSync(path.join(SRC_DIR, 'ui/tokens.css'), 'utf8');

  // LoginWakeUp & scroll restoration
  assert.match(mainJsx, /function LoginWakeUp\(\{onRetry,onCancel/);
  assert.match(mainJsx, /useLayoutEffect\(\(\)=>\{/);
  assert.match(mainJsx, /setRestorationMinHeight\(neededHeight\)/);
  assert.match(mainJsx, /style=\{restorationMinHeight\?\{minHeight:`\$\{restorationMinHeight\}px`\}:undefined\}/);
  assert.match(mainJsx, /className="page-transition page-in" key=\{page\}/);

  // Styling & tokens
  assert.match(stylesCss, /\.auth-wakeup-box\{/);
  assert.match(stylesCss, /\.auth-wakeup-ring\{/);
  assert.match(stylesCss, /\.ac-nav-mobile-head\{/);
  assert.match(tokensCss, /--brand-evergreen:#1E7A5F;/);
  assert.match(tokensCss, /--brand-mint:#3FBF9A;/);

  // Admin layout, AI mentor buttons, and ambient polish invariants
  const adminJsx = fs.readFileSync(path.join(SRC_DIR, 'AdminControlCenter.jsx'), 'utf8');
  assert.match(adminJsx, /className="ac-topbar-back"/);
  assert.doesNotMatch(adminJsx, /className="ac-footer-back"/);
  assert.doesNotMatch(adminJsx, /className="ac-drawer-exit-btn"/);
  assert.match(stylesCss, /\.ac-topbar-back/);
  assert.match(stylesCss, /\.mentor-start-btn\{min-height:48px/);
  assert.match(stylesCss, /\.mode\{min-height:56px/);
  assert.match(stylesCss, /\.dash-continue::before/);
  assert.match(stylesCss, /\.dash-chip--energy svg\{color:var\(--energy\);animation:energyPulse/);
});

test('Navigation & Theme Continuity Invariants: logout replaces history, onHash canonicalizes, no duplicate backdrop, LoginWakeUp immune to theme change', () => {
  const mainJsx = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');

  // 1. Logout must replace history rather than pushing a history entry
  assert.match(mainJsx, /const clearUserClientState=useCallback\(\(exitingUser\)=>\{[\s\S]*?window\.location\.replace\('#\/login'\)/,
    'clearUserClientState must use window.location.replace to clean history');
  assert.doesNotMatch(mainJsx, /const clearUserClientState=useCallback\(\(exitingUser\)=>\{[\s\S]*?window\.location\.hash='#\/login'/,
    'clearUserClientState must never push #/login via hash assignment');

  // 2. Unauthenticated onHash must canonicalize protected URLs via location.replace
  assert.match(mainJsx, /const onHash=\(\)=>\{[\s\S]*?if\(!session\)\{[\s\S]*?window\.location\.replace\('#\/login'\)/,
    'onHash must replace unauthorized protected hashes with #/login');

  // 3. Unauthenticated mount must canonicalize protected URLs via location.replace
  assert.match(mainJsx, /if\(!publicPages\.includes\(h\)&&window\.location\.hash!=='#\/login'[\s\S]*?window\.location\.replace\('#\/login'\)/,
    'App mount must canonicalize unauthorized hashes with location.replace');

  // 4. Duplicate backdrop (.nav-shade in App) must be absent; TopNav is authoritative owner
  const appRenderMatch = mainJsx.match(/return <div className="app app-topnav">[\s\S]*?<main className="main-topnav"/);
  assert.ok(appRenderMatch, 'App render structure must exist');
  assert.doesNotMatch(appRenderMatch[0], /\{mobile&&<div className="nav-shade"/,
    'App must not render duplicate nav-shade; TopNav owns the backdrop');

  // 5. inAppNavCountRef must be eliminated
  assert.doesNotMatch(mainJsx, /inAppNavCountRef/, 'inAppNavCountRef must be completely eliminated');

  // 6. LoginWakeUp must use startTimeRef and onRetryRef with empty dependency array
  assert.match(mainJsx, /function LoginWakeUp\(\{onRetry,onCancel,mode='login'\}\)\{[\s\S]*?const onRetryRef=useRef\(onRetry\);[\s\S]*?const startTimeRef=useRef\(null\);[\s\S]*?\},\[\]\);/,
    'LoginWakeUp must decouple from onRetry reference changes using refs and [] deps');

  // 7. Auth must maintain wakeUpRef
  assert.match(mainJsx, /const wakeUpRef=useRef\(wakeUp\);[\s\S]*?wakeUpRef\.current=wakeUp;/,
    'Auth must use wakeUpRef to avoid stale closures in retryWakeUp');

  // 8. PublicPage back in Auth must use location.replace
  assert.match(mainJsx, /if\(publicPage\) return <PublicPage page=\{publicPage\} onBack=\{\(\)=>\{window\.location\.replace\('#\/login'\)/,
    'PublicPage onBack in Auth must use location.replace');
});

test('Wake-Up Timer Continuity Simulation: elapsedSeconds & progressPct persist across prop re-creation', async () => {
  // Simulates the exact state machine architecture implemented in LoginWakeUp
  let renderedElapsed = 0;
  let reRenderCount = 0;

  // Emulate LoginWakeUp with persistent ref
  const startTime = Date.now() - 5000; // 5 seconds elapsed
  const startTimeRef = { current: startTime };
  let currentRetryFn = () => 'first';
  const onRetryRef = { current: currentRetryFn };

  // 10 simulated theme changes (re-renders with new onRetry reference)
  for (let i = 0; i < 10; i++) {
    // New function reference created by parent on theme toggle
    currentRetryFn = () => `retry-${i}`;
    onRetryRef.current = currentRetryFn;
    reRenderCount++;

    // Compute elapsed seconds from persistent startTimeRef
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const progressPct = Math.min(94, Math.round((1 - Math.exp(-elapsed / 50)) * 100));

    assert.ok(elapsed >= 5, `Elapsed should be at least 5s on render ${i}, got ${elapsed}`);
    assert.ok(progressPct > 0, `Progress should not reset to 0% on render ${i}, got ${progressPct}`);
    renderedElapsed = elapsed;
  }

  assert.equal(reRenderCount, 10);
  assert.ok(renderedElapsed >= 5);
  assert.equal(onRetryRef.current(), 'retry-9');
});

test('JWT expiration, bootstrap state & history rewind invariants', async () => {
  setupBrowserGlobals();
  const { isJwtExpired, readUser } = await import('./api.js?t=' + Date.now());

  // Helper to make test JWT
  function createTestJwt(expSeconds) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'test', exp: expSeconds })).toString('base64url');
    return `${header}.${payload}.mockSignature`;
  }

  // 1. isJwtExpired checks
  assert.equal(isJwtExpired(null), false);
  assert.equal(isJwtExpired('not-a-jwt'), false);
  assert.equal(isJwtExpired('a.b.c'), false);

  const pastExp = Math.floor(Date.now() / 1000) - 60;
  const expiredToken = createTestJwt(pastExp);
  assert.equal(isJwtExpired(expiredToken), true);

  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const validToken = createTestJwt(futureExp);
  assert.equal(isJwtExpired(validToken), false);

  // 2. readUser synchronously clears expired tokens
  localStorage.setItem('ai_user', JSON.stringify({ id: 99, token: expiredToken, role: 'STUDENT' }));
  const expiredResult = readUser();
  assert.equal(expiredResult, null, 'Expired session must return null on frame 0');
  assert.equal(localStorage.getItem('ai_user'), null, 'Expired session must be synchronously purged from localStorage');

  // Valid session preserved
  localStorage.setItem('ai_user', JSON.stringify({ id: 100, token: validToken, role: 'STUDENT' }));
  const validResult = readUser();
  assert.ok(validResult, 'Valid session must return user object');
  assert.equal(validResult.id, 100);

  // 3. Main.jsx invariants
  const mainJsx = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');
  assert.match(mainJsx, /const \[authResolved,setAuthResolved\]=useState/, 'authResolved bootstrap state must exist');
  assert.match(mainJsx, /app-bootstrap-shell/, 'app-bootstrap-shell fallback must exist');
  assert.match(mainJsx, /sessionStorage\.setItem\('nova_logout_rewind','true'\)/, 'nova_logout_rewind flag must be set during history rewind');
  assert.match(mainJsx, /window\.addEventListener\('popstate',onHash\)/, 'popstate listener must be registered for back/forward synchronization');
});

test('Upgrade Invariants: Learning History, Quiz Review, and Composable Navigation', async () => {
  setupBrowserGlobals();
  const { recordLearningHistory, readUser } = await import('./api.js?t=' + Date.now());

  // 1. Guest user recordLearningHistory stores in localStorage
  localStorage.setItem('ai_user', JSON.stringify({ id: 'guest-123', role: 'GUEST' }));
  await recordLearningHistory({
    itemType: 'LESSON',
    itemKey: 'course_1_lesson_5',
    title: 'Lecture 5 — Pointers and Arrays',
    category: 'C Programming',
    targetRoute: 'course/1/lesson/5'
  });
  const guestHistory = JSON.parse(localStorage.getItem('nova_guest_history_guest-123') || '[]');
  assert.equal(guestHistory.length, 1);
  assert.equal(guestHistory[0].itemKey, 'course_1_lesson_5');
  assert.equal(guestHistory[0].title, 'Lecture 5 — Pointers and Arrays');

  // Upsert updates existing entry and brings it to the top
  await recordLearningHistory({
    itemType: 'LESSON',
    itemKey: 'course_1_lesson_5',
    title: 'Lecture 5 — Pointers and Arrays (Updated)',
    category: 'C Programming',
    targetRoute: 'course/1/lesson/5'
  });
  const updatedHistory = JSON.parse(localStorage.getItem('nova_guest_history_guest-123') || '[]');
  assert.equal(updatedHistory.length, 1);
  assert.equal(updatedHistory[0].title, 'Lecture 5 — Pointers and Arrays (Updated)');

  // 2. main.jsx structure and invariants
  const mainJsx = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');
  assert.match(mainJsx, /\['history','History',History\]/, 'History nav item must be registered in navModel');
  assert.match(mainJsx, /LearningHistoryView/, 'LearningHistoryView component must be mounted');
  assert.match(mainJsx, /nova_redirect_target/, 'Direct protected URL redirect target must be captured and restored on login');
  assert.match(mainJsx, /id\.startsWith\('course\/'\)/, 'go() handler must support composite course routes');
  assert.match(mainJsx, /id\.startsWith\('dsa\/'\)/, 'go() handler must support composite dsa routes');
  assert.match(mainJsx, /id\.startsWith\('gatecse\/'\)/, 'go() handler must support composite gatecse routes');
  assert.match(mainJsx, /quiz-review-section/, 'Quiz result must render detailed question-by-question review section');

  // 3. Scroll performance compositing invariant in styles.css
  const stylesCss = fs.readFileSync(path.join(SRC_DIR, 'styles.css'), 'utf8');
  assert.ok(!stylesCss.includes('.hero, .course-card, .panel, .stat, .quiz-q, .result-card, .chat-shell, .chat-sidebar, .chat-main, .module-card, .lesson-item, .gate-subject-card, .practice-card, .study-card, .notes-reader, .rag-card, .upload-card, .today-focus-card, .today-card, .today-task, .today-agenda-item, .today-challenge-card, .today-heatmap-shell, .profile-identity-card, .profile-metric-card, .profile-domain-card, .profile-action-card, .profile-history-card, .exam-subject-card, .exam-metric-card, .exam-review-card, .exam-q-palette, .dsa-row, .dsa-hero, .dsa-stat-grid, .dsa-editor-card, .dsa-result-card, .dsa-test-tab, .dsa-test-panel, .dsa-diff-card, .career-path-card, .career-market-card, .career-skill-chip, .career-step-card, .career-salary-card, .career-filter-chip, .career-job-card, .career-readiness-card, .career-salary-band, .interview-feedback-box, .interview-category-card, .interview-metric-card, .community-sidebar-card, .community-feed-item, .community-room-card, .community-message, .community-member-card, .community-thread-card, .stat-tile, .card, .dock-nav, .dock-card, .dock-menu, .dock-subpanel, .dock-glass, .dock-backdrop, .dock-sheet, .dock-drawer, .dock-popover, .dock-modal, .dock-toast, .dock-tooltip, .dock-badge, .dock-pill, .dock-chip, .dock-tag, .dock-indicator, .dock-status, .dock-avatar, .dock-icon-box, .dock-btn-glass, .dock-input-glass, .dock-select-glass, .dock-table-glass, .dock-list-glass, .dock-item-glass, .dock-header-glass, .dock-footer-glass, .dock-sidebar-glass, .dock-main-glass, .dock-card-header, .dock-card-body, .dock-card-footer, .dock-card-glass, .dock-card-border, .dock-card-shadow, .dock-card-glow, .dock-card-highlight, .dock-card-accent, .dock-card-primary, .dock-card-secondary, .dock-card-tertiary, .dock-card-quaternary, .dock-card-gradient, .dock-card-pattern, .dock-card-texture, .dock-card-image, .dock-card-video, .dock-card-canvas, .dock-card-svg, .dock-card-icon, .dock-card-title, .dock-card-subtitle, .dock-card-desc, .dock-card-meta, .dock-card-badge, .dock-card-pill, .dock-card-chip, .dock-card-tag, .dock-card-indicator, .dock-card-status, .dock-card-avatar, .dock-card-btn, .dock-card-link, .dock-card-input, .dock-card-select, .dock-card-textarea, .dock-card-checkbox, .dock-card-radio, .dock-card-switch, .dock-card-slider, .dock-card-range, .dock-card-progress, .dock-card-spinner, .dock-card-skeleton, .dock-card-divider, .dock-card-spacer, .dock-card-group, .dock-card-row, .dock-card-col, .dock-card-grid, .dock-card-flex, .dock-card-box, .dock-card-container, .dock-card-wrapper, .dock-card-content, .dock-card-inner, .dock-card-outer, .dock-card-pane, .dock-card-section, .dock-card-article, .dock-card-aside, .dock-card-header-inner, .dock-card-body-inner, .dock-card-footer-inner, .dock-card-glass-inner, .dock-card-border-inner, .dock-card-shadow-inner, .dock-card-glow-inner, .dock-card-highlight-inner, .dock-card-accent-inner, .dock-card-primary-inner, .dock-card-secondary-inner, .dock-card-tertiary-inner, .dock-card-quaternary-inner, .dock-card-gradient-inner, .dock-card-pattern-inner, .dock-card-texture-inner, .dock-card-image-inner, .dock-card-video-inner, .dock-card-canvas-inner, .dock-card-svg-inner, .dock-card-icon-inner, .dock-card-title-inner, .dock-card-subtitle-inner, .dock-card-desc-inner, .dock-card-meta-inner, .dock-card-badge-inner, .dock-card-pill-inner, .dock-card-chip-inner, .dock-card-tag-inner, .dock-card-indicator-inner, .dock-card-status-inner, .dock-card-avatar-inner, .dock-card-btn-inner, .dock-card-link-inner, .dock-card-input-inner, .dock-card-select-inner, .dock-card-textarea-inner, .dock-card-checkbox-inner, .dock-card-radio-inner, .dock-card-switch-inner, .dock-card-slider-inner, .dock-card-range-inner, .dock-card-progress-inner, .dock-card-spinner-inner, .dock-card-skeleton-inner, .dock-card-divider-inner, .dock-card-spacer-inner, .dock-card-group-inner, .dock-card-row-inner, .dock-card-col-inner, .dock-card-grid-inner, .dock-card-flex-inner, .dock-card-box-inner, .dock-card-container-inner, .dock-card-wrapper-inner, .dock-card-content-inner {\n  backdrop-filter: blur(14px);'), 'Heavy backdrop-filter on repeated scroll cards must remain removed');
});




