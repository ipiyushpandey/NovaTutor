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
  assert.match(stylesCss, /\.chat-history-actions \.chat-action-btn\{display:inline-flex;align-items:center;gap:6px;padding:8px 11px;min-height:38px/);
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
});

