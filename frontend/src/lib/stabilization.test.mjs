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
  const res = await api('/courses', { retries: 1, retryDelayMs: 5 });
  assert.deepEqual(res, { courses: [1, 2] });
  assert.equal(getCalls, 2);

  await assert.rejects(
    () => api('/ai/ask', { method: 'POST', body: JSON.stringify({ message: 'hi' }), retries: 2, retryDelayMs: 5 }),
    /Transient upstream error/
  );
  assert.equal(postCalls, 1);
});

test('apiStream respects AbortSignal and refreshes once on 401', async () => {
  setupBrowserGlobals();
  globalThis.localStorage.setItem('ai_user', JSON.stringify({ id: 7, token: 'expired-jwt' }));

  let streamCalls = 0;
  let refreshCalls = 0;

  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/auth/me')) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ id: 7, role: 'STUDENT', token: 'fresh-jwt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    streamCalls += 1;
    if (streamCalls === 1) {
      return new Response(JSON.stringify({ message: 'Expired' }), { status: 401 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data:Hello \n\n'));
        controller.enqueue(encoder.encode('data:Nova\n\n'));
        controller.enqueue(encoder.encode('data:done\n\n'));
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
  assert.equal(collected, 'Hello Nova');

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

test('security & stabilization source invariants hold across frontend files', () => {
  const mainJsx = fs.readFileSync(path.join(SRC_DIR, 'main.jsx'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(SRC_DIR, 'styles.css'), 'utf8');
  const gateCseJsx = fs.readFileSync(path.join(SRC_DIR, 'gateCse.jsx'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8');

  // 1. Course IDE iframe must never grant allow-same-origin
  assert.match(mainJsx, /sandbox="allow-scripts"\s+referrerPolicy="no-referrer"/);
  assert.doesNotMatch(mainJsx, /allow-same-origin/);

  // 2. TopNav starts closed (no initial desktop dropdown CLS)
  assert.match(mainJsx, /const \[openMenu,setOpenMenu\]=useState\(null\);/);

  // 3. Global error listeners must not trigger nova-recover infinite loops
  assert.doesNotMatch(mainJsx, /dispatchEvent\(new Event\('nova-recover'\)\)/);

  // 4. styles.css must not contain the desktop +210px CLS padding hack
  assert.doesNotMatch(stylesCss, /body:has\(\.topnav\.subnav-open\)/);

  // 5. GATE CSE fetches hard_quiz.json once (no duplicated paper fetch)
  assert.equal((gateCseJsx.match(/hard_quiz\.json/g) || []).length, 1);

  // 6. index.html applies persisted dark theme synchronously before React mounts
  assert.match(indexHtml, /localStorage\.getItem\('nova_theme'\)/);
  assert.match(indexHtml, /document\.documentElement\.classList\.add\('dark'\)/);
});
