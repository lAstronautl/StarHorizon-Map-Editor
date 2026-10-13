// Minimal service worker whose only job is making sure users get the latest
// index.html after a deploy, since GitHub Pages doesn't let us set cache-control
// headers. Hashed assets (dist/assets/*.js/css, textures, prototype YAML) already
// have content hashes in their filenames and are left to the browser's normal
// HTTP cache — this worker only intercepts navigation requests.
//
// __BUILD_ID__ is replaced with the deploy's git SHA by .github/workflows/deploy.yml.
// Changing this string is what makes the browser see a "new" sw.js file and go
// through install/activate again; without it, an unmodified sw.js is byte-identical
// across deploys and never updates.
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = `shme-shell-${BUILD_ID}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw new Error('Network request failed and no cached page is available.');
      }
    })(),
  );
});
