importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
const CACHE_NAME = 'cinestream-offline-v7';
// NOTE: Vite bundles and hashes JS files, so raw /js/*.js paths don't exist at runtime.
// Only cache assets that are truly served at these static paths.
// The Vite-built JS bundle is cached dynamically by the fetch handler below.
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/css/detail.css',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          fetch(url).then(response => {
            if (!response.ok) throw new TypeError('Bad response status');
            return cache.put(url, response);
          }).catch(error => {
            console.warn('Failed to cache:', url, error);
          })
        )
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // ── Pass-through: Never intercept these external APIs / assets ──
  // Intercepting failed CORS requests causes "Failed to convert value to 'Response'" errors.
  const PASSTHROUGH_PATTERNS = [
    'espn.com',
    'api.espn.com',
    'placeholder.com',
    'placehold.co',
    'supabase.co',
    'tmdb.org',
    'themoviedb.org',
    'googleapis.com',
    'gstatic.com',
    'jsdelivr.net',
    'ui-avatars.com',
    'image.tmdb.org',
    'firebaseapp.com',
    'vidsrc.to',
    'embed.su',
  ];

  if (PASSTHROUGH_PATTERNS.some(pattern => url.includes(pattern))) {
    // Let the browser handle these natively — do NOT intercept
    return;
  }

  // For in-app API requests, always try network first, no caching
  if (url.includes('/api/') || url.includes('/tmdb-api/')) {
    event.respondWith(
      fetch(event.request).catch(err => {
        return new Response(JSON.stringify({ success: false, error: 'Offline or API unreachable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // HTML pages: ALWAYS fetch fresh from network — never serve from cache
  // This ensures UI changes show up immediately without needing to clear cache
  if (url.includes('.html') || event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/index.html').then(res => {
          return res || new Response('<h1>Offline - CineStream</h1><p>Check connection.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html' }
          });
        });
      })
    );
    return;
  }

  // For static assets (own domain), try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(event.request).then((networkResponse) => {
          // Only cache successful same-origin responses
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
            return networkResponse;
          }
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      }).catch(() => {
        // If both cache and network fail, return offline index or fallback
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html').then(res => {
            return res || new Response('<h1>Offline - CineStream</h1>', {
              status: 503,
              headers: { 'Content-Type': 'text/html' }
            });
          });
        }
        return new Response('Network connection lost.', {
          status: 408,
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => clients.claim())
  );
});
