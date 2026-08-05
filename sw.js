/* Colosse Adaptive — generated service worker */
const CACHE_VERSION = 'colosse-adaptive-v3-78d2caa3465b';
const CACHE_NAME = CACHE_VERSION;
const PRECACHE_URLS = [
  "./",
  "./app.js",
  "./colosse-app.html",
  "./data/database.js",
  "./data/legacy.js",
  "./defaults.js",
  "./engine/duration.js",
  "./engine/math.js",
  "./engine/progression.js",
  "./engine/recovery.js",
  "./engine/weight.js",
  "./icon-192.png",
  "./icon-512.png",
  "./index.html",
  "./manifest.json",
  "./program.js",
  "./pwa.js",
  "./styles.css",
  "./types.js",
  "./ui/templates.js"
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('colosse-') && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || (await caches.match('./colosse-app.html')) || (await caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
