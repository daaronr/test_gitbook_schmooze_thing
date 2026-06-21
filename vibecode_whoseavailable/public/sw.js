// Bump this version when static assets change to clear old caches
const CACHE_VERSION = 21;
const CACHE_NAME = `whos-available-v${CACHE_VERSION}`;
const SCOPE_URL = new URL(self.registration.scope);
const STATIC_ASSETS = [
  '.',
  'index.html',
  'app.js',
  'styles.css',
  'walkthrough.html',
  'status.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
].map(path => new URL(path, SCOPE_URL).toString());

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log('Cache addAll failed:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip socket.io and API requests (always need fresh data)
  if (url.pathname.includes('/socket.io') || url.pathname.includes('/api')) {
    return;
  }

  // For page navigations and static assets: network first, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone and cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match(new URL('.', SCOPE_URL).toString());
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
