// Pentopia service worker — makes the installed app playable with no
// network at all. The app itself never calls out to a server (puzzles are
// generated in-browser, progress lives in localStorage), so the only job
// here is caching the static shell.
//
// Strategy:
//   - Hashed build assets (/assets/*.js, *.css) are content-addressed by
//     Vite — a given URL's content never changes, so cache-first forever.
//   - Everything else same-origin (HTML, manifest, icons) is network-first
//     so a re-install of the app always ships the latest shell when
//     online, falling back to the cache when offline.
//   - Navigations fall back to the cached app shell regardless of the
//     requested path/query, since routing (puzzle deep links) happens
//     client-side off `?p=`/hash — any cached copy of the shell can serve
//     any URL under the app's scope.

const SHELL_CACHE = 'pentopia-shell-v1';
const ASSET_CACHE = 'pentopia-assets-v1';

const SHELL_URLS = [
  './',
  './index.html',
  './challenge.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Awaited (not fire-and-forget): the browser can kill the worker as soon
  // as the fetch event's response settles, which would otherwise abort an
  // in-flight cache write before it lands.
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function navigationFallback(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) return response;
    // A non-OK response (e.g. offline captive portal) is worse than the
    // cached shell — fall through to it below.
  } catch {
    // Offline: fall through to the cached shell below.
  }
  const shell = await cache.match('./index.html');
  if (shell) return shell;
  throw new Error('pentopia: no cached shell available offline');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, SHELL_CACHE));
});
