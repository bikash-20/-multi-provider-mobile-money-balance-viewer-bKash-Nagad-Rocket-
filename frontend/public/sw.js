/**
 * WalletSync Service Worker — v1
 *
 * Strategy:
 *  - `_next/static/*` → Cache-First (immutable, content-hash-versioned)
 *  - `/icons/*`, `/manifest.json` → Cache-First (static)
 *  - `/` (navigation) → Network-First with cache fallback
 *  - `/api/*` (data) → Network-First with cache fallback
 *  - Everything else → Network-only
 *
 * Offline mutation replay is handled client-side via IndexedDB
 * (src/features/pwa/syncQueue.ts); this SW only handles caching
 * and basic background sync registration.
 */

/* global self, caches, Response, fetch, CacheQueryOptions */

const CACHE_STATIC = 'walletsync-static-v1';
const CACHE_API = 'walletsync-api-v1';
const CACHE_NAV = 'walletsync-nav-v1';

const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /^\/icons\//,
  /^\/manifest\.json$/,
];

const API_PATTERN = /^\/api\//;

const MAX_API_CACHE_AGE_MS = 5 * 60 * 1000; // 5 minutes

/* ── Install ──────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  // Pre-cache minimal shell so the app loads offline on first visit.
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) =>
      cache.addAll([
        '/manifest.json',
        '/icons/icon.svg',
        '/icons/icon-192.svg',
        '/icons/icon-512.svg',
      ]),
    ),
  );
  // Bypass the waiting phase — activate immediately so returning users
  // get the latest SW without a second tab-refresh.
  self.skipWaiting();
});

/* ── Activate ─────────────────────────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Remove stale caches from previous SW versions.
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== CACHE_STATIC &&
                k !== CACHE_API &&
                k !== CACHE_NAV,
            )
            .map((k) => caches.delete(k)),
        ),
      ),
      // Take control of all open clients immediately so the new SW
      // handles their fetch events without a page reload.
      self.clients.claim(),
    ]),
  );
});

/* ── Notification click ────────────────────────────────────────────── */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Focus an existing WalletSync tab, or open a new one.
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow('/');
      }),
  );
});

/* ── Fetch ────────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // 1) Static assets — cache-first (fast, no network)
  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 2) API requests — network-first with cache fallback
  if (API_PATTERN.test(url.pathname)) {
    event.respondWith(apiNetworkFirst(request));
    return;
  }

  // 3) Navigation (HTML pages) — network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNav(request));
    return;
  }

  // 4) Everything else — network-only (don't cache third-party resources)
});

/* ── Caching helpers ──────────────────────────────────────────────── */

/**
 * Cache-First: respond from cache, falling back to network on miss.
 * Cache on success (opaque or basic).
 */
async function cacheFirst(
  request: Request,
  cacheName: string,
): Promise<Response> {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;

  try {
    const network = await fetch(request);
    if (network.ok || network.type === 'opaque') {
      const cache = await caches.open(cacheName);
      // Don't block the response on cache write — fire-and-forget.
      void cache.put(request, network.clone());
    }
    return network;
  } catch {
    // Offline and not cached — return a basic fallback for known paths.
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith('/icons/') || pathname === '/manifest.json') {
      return new Response('', { status: 204 });
    }
    throw new Error('Network unavailable and no cached response.');
  }
}

/**
 * Network-First for API responses. Cache successful responses for
 * offline reading. Stale entries older than MAX_API_CACHE_AGE_MS are
 * NOT served (the app should show a loading state instead of stale
 * data).
 */
async function apiNetworkFirst(request: Request): Promise<Response> {
  try {
    const network = await fetch(request);
    if (network.ok) {
      const cache = await caches.open(CACHE_API);
      // Clone: one goes to the client, one to the cache.
      const cloned = network.clone();
      void cache.put(request, cloned);
    }
    return network;
  } catch {
    // Offline — try cache.
    const cached = await caches.match(request, { cacheName: CACHE_API });
    if (cached) {
      const cachedAt = getCachedAt(cached);
      const age = cachedAt ? Date.now() - cachedAt : Infinity;
      if (age < MAX_API_CACHE_AGE_MS) return cached;
    }
    // Stale or missing — return a 503 so the client can surface an
    // offline indicator rather than silently showing old data.
    return new Response(
      JSON.stringify({
        error: 'offline',
        entries: [],
        transfers: [],
        nextCursor: null,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

/**
 * Network-First for navigation requests. Cache successful HTML
 * responses so the app shell loads offline.
 */
async function networkFirstNav(request: Request): Promise<Response> {
  try {
    const network = await fetch(request);
    if (network.ok) {
      const cache = await caches.open(CACHE_NAV);
      void cache.put(request, network.clone());
    }
    return network;
  } catch {
    const cached = await caches.match(request, { cacheName: CACHE_NAV });
    if (cached) return cached;

    // Last resort: serve the manifest (the app can show its shell).
    const manifest = await caches.match('/manifest.json', {
      cacheName: CACHE_STATIC,
    });
    return (
      manifest ??
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}

/** Extract the Date header from a cached response (if any). */
function getCachedAt(response: Response): number | null {
  const date = response.headers.get('Date');
  if (!date) return null;
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? null : ms;
}
