/* global caches, fetch, Response */

const CACHE_VERSION = 'v3-felicidade';
const LEGACY_CACHE = 'chama-v1';
const REGISTRATION_SCOPE = new URL(
  self.registration?.scope || self.location?.href || 'http://localhost/'
);
const SCOPE_URL = new URL('./', REGISTRATION_SCOPE);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith('/')
  ? SCOPE_URL.pathname
  : `${SCOPE_URL.pathname}/`;
const SCOPE_KEY = SCOPE_PATH
  .replace(/^\/+|\/+$/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '-')
  .toLowerCase() || 'root';
const CACHE_PREFIX = `chama-${SCOPE_KEY}-`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const INDEX_URL = new URL('./index.html', SCOPE_URL).href;

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/app.js',
  './js/core.js',
  './js/catalog.js',
  './manifest.json?v=felicidade-20261104',
  './icon-192.png?v=felicidade-20261104',
  './icon-512.png?v=felicidade-20261104',
  './apple-touch-icon.png?v=felicidade-20261104',
  './favicon-32.png?v=felicidade-20261104',
].map((asset) => new URL(asset, SCOPE_URL).href);
const STATIC_ASSET_PATHS = new Set(
  SHELL_ASSETS.map((asset) => new URL(asset).pathname)
);

function urlFor(value) {
  try {
    return new URL(
      typeof value === 'string' ? value : value?.url,
      SCOPE_URL
    );
  } catch {
    return null;
  }
}

function isInScope(url) {
  return Boolean(
    url &&
    url.origin === SCOPE_URL.origin &&
    url.pathname.startsWith(SCOPE_PATH)
  );
}

function isRequestInScope(request) {
  return isInScope(urlFor(request));
}

function isNavigationRequest(request) {
  if (request.mode === 'navigate' || request.destination === 'document') {
    return true;
  }

  const accept = request.headers?.get?.('accept') || '';
  return accept.toLowerCase().includes('text/html');
}

function isStaticAssetRequest(request) {
  const url = urlFor(request);
  return Boolean(url && STATIC_ASSET_PATHS.has(url.pathname));
}

function isCacheableResponse(response) {
  return Boolean(response) && response.ok !== false && response.status !== 206;
}

async function openAppCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function putResponse(cache, requestOrUrl, response) {
  if (!cache || !isCacheableResponse(response)) return;

  try {
    await cache.put(
      requestOrUrl,
      typeof response.clone === 'function' ? response.clone() : response
    );
  } catch {
    // A cache write must never turn a successful network response into an error.
  }
}

async function matchResponse(cache, requestOrUrl) {
  if (!cache) return undefined;

  try {
    return await cache.match(requestOrUrl);
  } catch {
    return undefined;
  }
}

function offlineResponse(request, navigation = false) {
  const url = urlFor(request);
  const pathname = url?.pathname || '';
  let contentType = 'text/plain; charset=utf-8';
  let body = 'Offline: este recurso ainda não está disponível.';

  if (navigation) {
    contentType = 'text/html; charset=utf-8';
    body = '<!doctype html><title>Offline</title><p>Você está offline.</p>';
  } else if (/\.m?js$/i.test(pathname)) {
    // Never return the HTML shell for a JavaScript module request.
    contentType = 'application/javascript; charset=utf-8';
    body = '// Offline: módulo JavaScript indisponível.\n';
  } else if (/\.css$/i.test(pathname)) {
    contentType = 'text/css; charset=utf-8';
    body = '/* Offline: folha de estilos indisponível. */\n';
  } else if (/\.json$/i.test(pathname)) {
    contentType = 'application/json; charset=utf-8';
    body = '{"offline":true}';
  }

  return new Response(body, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': contentType },
  });
}

async function handleNavigation(request) {
  let networkResponse;

  try {
    networkResponse = await fetch(request);
  } catch {
    networkResponse = undefined;
  }

  const cache = await openAppCache();
  if (networkResponse) {
    const requestURL = urlFor(request);
    if (
      cache &&
      isCacheableResponse(networkResponse) &&
      requestURL &&
      (requestURL.href === SCOPE_URL.href || requestURL.href === INDEX_URL)
    ) {
      await putResponse(cache, INDEX_URL, networkResponse);
    }
    return networkResponse;
  }

  const cachedIndex = await matchResponse(cache, INDEX_URL);
  return cachedIndex || offlineResponse(request, true);
}

async function handleAsset(request) {
  // Only the known shell assets are persisted; same-origin data requests are
  // fetched but never written to Cache Storage.
  const cache = isStaticAssetRequest(request) ? await openAppCache() : null;

  try {
    const networkResponse = await fetch(request);
    await putResponse(cache, request, networkResponse);
    return networkResponse;
  } catch {
    const cachedResponse = await matchResponse(cache, request);
    return cachedResponse || offlineResponse(request);
  }
}

async function cleanCaches() {
  const keys = await caches.keys();
  const canRemoveLegacy = SCOPE_PATH.endsWith('/chama-da-felicidade/');
  const removable = keys.filter((key) =>
    (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
    (canRemoveLegacy && key === LEGACY_CACHE)
  );

  await Promise.all(removable.map((key) => caches.delete(key)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      cleanCaches(),
      typeof self.clients?.claim === 'function' ? self.clients.claim() : undefined,
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SKIP_WAITING') return;

  const waiting = self.skipWaiting();
  if (typeof event.waitUntil === 'function') event.waitUntil(waiting);
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (
    !request ||
    String(request.method || 'GET').toUpperCase() !== 'GET' ||
    !isRequestInScope(request)
  ) {
    return;
  }

  event.respondWith(
    isNavigationRequest(request)
      ? handleNavigation(request)
      : handleAsset(request)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close?.();

  const openAppWindow = async () => {
    const clientsAPI = self.clients;
    if (!clientsAPI) return undefined;

    if (typeof clientsAPI.matchAll === 'function') {
      const appClients = await clientsAPI.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const existingClient = appClients.find((client) =>
        isInScope(urlFor(client))
      );
      if (existingClient && typeof existingClient.focus === 'function') {
        return existingClient.focus();
      }
    }

    if (typeof clientsAPI.openWindow === 'function') {
      return clientsAPI.openWindow(SCOPE_URL.href);
    }
    return undefined;
  };

  if (typeof event.waitUntil === 'function') {
    event.waitUntil(openAppWindow());
  }
});
