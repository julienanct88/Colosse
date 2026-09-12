/* Colosse Adaptive — generated service worker */
const CACHE_VERSION = 'colosse-adaptive-v3-forge-360';
const CACHE_NAME = CACHE_VERSION;
const PRECACHE_URLS = [
  "./",
  "./app.js",
  "./colosse-app.html",
  "./data/database.js",
  "./data/legacy.js",
  "./defaults.js",
  "./engine/duration.js",
  "./engine/activity.js",
  "./engine/math.js",
  "./engine/session.js",
  "./engine/execution.js",
  "./engine/warmup.js",
  "./engine/timer.js",
  "./engine/timer-effects.js",
  "./ui/execution.js",
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
  "./forge.css",
  "./ui/forge.js",
  "./types.js",
  "./ui/templates.js"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('colosse-') && name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

// Les fichiers du shell sont servis depuis LE cache de cette version.
// Une nouvelle version attend le bouton de mise à jour : pas de reload en pleine série.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) {
      if (event.request.mode === 'navigate') return (await cache.match('./colosse-app.html')) || (await cache.match('./index.html'));
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
