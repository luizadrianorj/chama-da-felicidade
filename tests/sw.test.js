import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const SW_PATH = new URL('../sw.js', import.meta.url);
const SCOPE = 'https://example.test/chama-da-felicidade/';
const INDEX_URL = `${SCOPE}index.html`;

class TestResponse {
  constructor(body = '', { status = 200, headers = {} } = {}) {
    this.body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = new Map(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    );
  }

  clone() {
    return new TestResponse(this.body, {
      status: this.status,
      headers: Object.fromEntries(this.headers),
    });
  }

  async text() {
    return this.body;
  }
}

class TestRequest {
  constructor(url, { method = 'GET', mode = 'cors', destination = '', accept = '' } = {}) {
    this.url = url;
    this.method = method;
    this.mode = mode;
    this.destination = destination;
    this.headers = {
      get: (name) => name.toLowerCase() === 'accept' ? accept : '',
    };
  }
}

class TestCache {
  constructor() {
    this.entries = new Map();
    this.addAllCalls = [];
    this.putCalls = [];
  }

  async addAll(requests) {
    this.addAllCalls.push([...requests]);
  }

  async put(request, response) {
    const key = typeof request === 'string' ? request : request.url;
    this.putCalls.push(key);
    this.entries.set(key, response);
  }

  async match(request) {
    const key = typeof request === 'string' ? request : request.url;
    return this.entries.get(key);
  }
}

function createHarness({
  scope = SCOPE,
  cacheNames = [],
  fetchImpl = async () => new TestResponse('network'),
} = {}) {
  const listeners = new Map();
  const cachesByName = new Map();
  const deleted = [];
  const opened = [];
  let skipWaitingCalls = 0;

  for (const name of cacheNames) cachesByName.set(name, new TestCache());

  const caches = {
    async open(name) {
      opened.push(name);
      if (!cachesByName.has(name)) cachesByName.set(name, new TestCache());
      return cachesByName.get(name);
    },
    async keys() {
      return [...cachesByName.keys()];
    },
    async delete(name) {
      deleted.push(name);
      cachesByName.delete(name);
      return true;
    },
  };

  const clients = {
    async claim() {},
    async matchAll() { return []; },
    async openWindow(url) { return { url }; },
  };

  const self = {
    registration: { scope },
    clients,
    skipWaiting() {
      skipWaitingCalls += 1;
      return Promise.resolve();
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };

  const context = vm.createContext({
    self,
    caches,
    fetch: fetchImpl,
    Response: TestResponse,
    URL,
    Promise,
    console,
  });
  const source = globalThis.__swSource;
  vm.runInContext(source, context, { filename: 'public/sw.js' });

  function event(type, properties = {}) {
    const waits = [];
    const eventObject = {
      ...properties,
      waitUntil(value) { waits.push(Promise.resolve(value)); },
    };
    if (type === 'fetch') {
      eventObject.respondWith = (value) => { eventObject.responsePromise = Promise.resolve(value); };
    }
    listeners.get(type)(eventObject);
    return {
      eventObject,
      async settle() {
        await Promise.all(waits);
        return eventObject.responsePromise;
      },
    };
  }

  return {
    caches,
    cachesByName,
    deleted,
    opened,
    event,
    get skipWaitingCalls() { return skipWaitingCalls; },
  };
}

const source = await readFile(SW_PATH, 'utf8');
globalThis.__swSource = source;

// Keep the VM setup independent of browser globals while still using the same SW source.
test.after(() => {
  delete globalThis.__swSource;
});

test('activate removes only this scope cache versions and safe legacy cache', async () => {
  const scopeKey = 'chama-chama-da-felicidade-';
  const harness = createHarness({
    cacheNames: [
      `${scopeKey}v1`,
      `${scopeKey}v2`,
      `${scopeKey}v3-felicidade`,
      'chama-v1',
      'kpi-tracker-v4',
      'other-app-cache',
    ],
  });

  await harness.event('activate').settle();

  assert.deepEqual(harness.deleted.sort(), [
    'chama-v1',
    `${scopeKey}v1`,
    `${scopeKey}v2`,
  ].sort());
  assert.ok(harness.cachesByName.has(`${scopeKey}v3-felicidade`));
  assert.ok(harness.cachesByName.has('kpi-tracker-v4'));
  assert.ok(harness.cachesByName.has('other-app-cache'));
});

test('external Firebase and neighboring app requests are ignored', async () => {
  let fetchCalls = 0;
  const harness = createHarness({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new TestResponse('unexpected');
    },
  });

  for (const request of [
    new TestRequest('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    new TestRequest('https://example.test/other-app/js/app.js'),
  ]) {
    const dispatched = harness.event('fetch', { request });
    assert.equal(dispatched.eventObject.responsePromise, undefined);
  }

  assert.equal(fetchCalls, 0);
});

test('POST requests are ignored even inside the app scope', async () => {
  const harness = createHarness();
  const dispatched = harness.event('fetch', {
    request: new TestRequest(`${SCOPE}api/private`, { method: 'POST' }),
  });

  assert.equal(dispatched.eventObject.responsePromise, undefined);
});

test('navigation uses cached index.html when the network is offline', async () => {
  const harness = createHarness({ fetchImpl: async () => { throw new Error('offline'); } });
  const cache = await harness.caches.open('placeholder');
  cache.entries.set(INDEX_URL, new TestResponse('<!doctype html><main>cached shell</main>'));
  harness.cachesByName.delete('placeholder');

  // Populate the cache selected by the SW after its version is derived from scope.
  const ownCacheName = 'chama-chama-da-felicidade-v3-felicidade';
  harness.cachesByName.set(ownCacheName, cache);

  const dispatched = harness.event('fetch', {
    request: new TestRequest(SCOPE, { mode: 'navigate', destination: 'document' }),
  });
  const response = await dispatched.settle();

  assert.equal(await response.text(), '<!doctype html><main>cached shell</main>');
});

test('a failed JavaScript request gets a typed offline response, never HTML', async () => {
  const harness = createHarness({ fetchImpl: async () => { throw new Error('offline'); } });
  const dispatched = harness.event('fetch', {
    request: new TestRequest(`${SCOPE}js/missing.js`, { destination: 'script' }),
  });
  const response = await dispatched.settle();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.doesNotMatch(await response.text(), /<\/?html|doctype/i);
});

test('install resolves the complete shell from registration scope', async () => {
  const harness = createHarness();
  const dispatched = harness.event('install');
  await dispatched.settle();

  const [cacheName] = harness.opened;
  assert.equal(cacheName, 'chama-chama-da-felicidade-v3-felicidade');
  const [assets] = harness.cachesByName.get(cacheName).addAllCalls;
  assert.deepEqual(assets, [
    `${SCOPE}`,
    `${SCOPE}index.html`,
    `${SCOPE}styles.css`,
    `${SCOPE}js/app.js`,
    `${SCOPE}js/core.js`,
    `${SCOPE}js/catalog.js`,
    `${SCOPE}manifest.json?v=felicidade-20261104`,
    `${SCOPE}icon-192.png?v=felicidade-20261104`,
    `${SCOPE}icon-512.png?v=felicidade-20261104`,
    `${SCOPE}apple-touch-icon.png?v=felicidade-20261104`,
    `${SCOPE}favicon-32.png?v=felicidade-20261104`,
  ]);
  assert.ok(assets.every((asset) => new URL(asset).origin === new URL(SCOPE).origin));
});

test('SKIP_WAITING message requests activation without install auto-skip', async () => {
  const harness = createHarness();
  await harness.event('install').settle();
  assert.equal(harness.skipWaitingCalls, 0);

  await harness.event('message', { data: { type: 'SKIP_WAITING' } }).settle();
  assert.equal(harness.skipWaitingCalls, 1);
});
