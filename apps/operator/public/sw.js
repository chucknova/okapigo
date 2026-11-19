/**
 * The operator app's service worker (stage 15c-1): it makes the APP open with no signal.
 *
 * A service worker is a small script the browser keeps between visits. It sits between the
 * page and the network, so when there's no signal it can answer from its own cache.
 *
 * What it caches: the app's own files only (HTML, JavaScript, CSS, icons), listed by the build
 * in precache.json. NOT the data: today's departures and the changes waiting to send are kept
 * by the app itself (in IndexedDB, src/lib/store.js), where it decides what's stale.
 *
 *   install    save every file in precache.json
 *   activate   forget files from older versions
 *   fetch      the page itself: network first (to get updates), the saved copy if offline
 *              /app/assets/*: the saved copy (their names change with every new version)
 *              anything else (the API): untouched, straight to the network
 */
const CACHE = 'okapigo-app';
const LIST = 'precache.json';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const list = await fetch(LIST, { cache: 'no-store' });
      const { files } = await list.clone().json();
      await cache.addAll(files);
      await cache.put(LIST, list);
      // Take over straight away; the next time the app opens, it runs the new version.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const list = await cache.match(LIST);
      if (list) {
        const keep = new Set(
          (await list.json()).files.map(
            (/** @type {string} */ f) => new URL(f, self.registration.scope).href,
          ),
        );
        keep.add(new URL(LIST, self.registration.scope).href);
        for (const request of await cache.keys()) {
          if (!keep.has(request.url)) await cache.delete(request);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (
    request.method !== 'GET' ||
    url.origin !== scope.origin ||
    !url.pathname.startsWith(scope.pathname)
  ) {
    return; // the API, and anything else: the network, as normal
  }
  if (request.mode === 'navigate') {
    // Opening the app (any of its pages: they're all the same index.html).
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) (await caches.open(CACHE)).put('./', fresh.clone());
          return fresh;
        } catch {
          return (await caches.match('./', { ignoreSearch: true })) ?? Response.error();
        }
      })(),
    );
    return;
  }
  event.respondWith((async () => (await caches.match(request)) ?? fetch(request))());
});
