// Service Worker for SENAVISION PWA
// Version: 1.0.4

const CACHE_NAME = 'senavision-v1.0.4';
const RUNTIME_CACHE = 'senavision-runtime-v1.0.4';

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/map/map.html',
  '/map/map.css',
  '/map/index.js',
  '/map/firebase-app.js',
  '/map/mode-detector-integration.js',
  '/image/logo.png',
  '/image/smansa.png',
  '/image/enuma.png',
  '/image/mersiflab.png',
  '/image/mersifacademy.jpg',
  '/js/voiceNavigation.js',
  '/js/postprocessing.js'
];

// External CDN resources (cached separately)
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Nunito:wght@400;600;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching static assets');
        // Cache static assets
        return Promise.all([
          cache.addAll(STATIC_ASSETS.map(url => {
            return new Request(url, { cache: 'reload' });
          })).catch((error) => {
            console.warn('[Service Worker] Failed to cache some static assets:', error);
            return Promise.resolve();
          }),
          // Cache external assets separately (may fail due to CORS)
          cache.addAll(EXTERNAL_ASSETS).catch((error) => {
            console.warn('[Service Worker] Failed to cache some external assets (this is normal):', error);
            return Promise.resolve();
          })
        ]);
      })
  );
  
  // Force activation of new service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete ALL old caches (force refresh)
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      ).then(() => {
        // Force delete runtime cache to ensure fresh files
        return caches.delete(RUNTIME_CACHE).then(() => {
          console.log('[Service Worker] Runtime cache cleared for fresh files');
          // Recreate runtime cache
          return caches.open(RUNTIME_CACHE);
        });
      });
    })
  );
  
  // Take control of all pages immediately
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip cross-origin requests (except for CDN resources we want to cache)
  if (url.origin !== location.origin && 
      !url.href.includes('fonts.googleapis.com') &&
      !url.href.includes('unpkg.com') &&
      !url.href.includes('gstatic.com') &&
      !url.href.includes('nominatim.openstreetmap.org')) {
    return;
  }
  
  // Strategy: Network ONLY for JS files (no cache) - ensures always fresh
  // This ensures JS files are always fresh and never served from cache
  if (request.url.includes('.js') && !request.url.includes('node_modules') && !request.url.includes('unpkg.com') && !request.url.includes('gstatic.com')) {
    // For JS files, ALWAYS fetch from network, never use cache
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          // Don't cache JS files at all - always get fresh version
          return response;
        })
        .catch((error) => {
          console.error('[Service Worker] Failed to fetch JS from network:', request.url, error);
          // Only fallback to cache if network completely fails
          return caches.match(request).then((cached) => {
            if (cached) {
              console.warn('[Service Worker] Using cached JS (network failed):', request.url);
            }
            return cached || new Response('Network error', { status: 503 });
          });
        })
    );
    return;
  }
  
  // Strategy: Cache First, Network Fallback (for non-JS files)
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          console.log('[Service Worker] Serving from cache:', request.url);
          return cachedResponse;
        }
        
        // Otherwise, fetch from network
        console.log('[Service Worker] Fetching from network:', request.url);
        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // Clone the response for caching
            const responseToCache = response.clone();
            
            // Cache dynamic resources in runtime cache
            caches.open(RUNTIME_CACHE)
              .then((cache) => {
                // Only cache certain types of resources
                if (request.url.includes('.html') ||
                    request.url.includes('.css') ||
                    request.url.includes('.js') ||
                    request.url.includes('.png') ||
                    request.url.includes('.jpg') ||
                    request.url.includes('fonts.googleapis.com') ||
                    request.url.includes('unpkg.com')) {
                  cache.put(request, responseToCache);
                }
              });
            
            return response;
          })
          .catch((error) => {
            console.error('[Service Worker] Fetch failed:', error);
            
            // Return offline page for navigation requests
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            throw error;
          });
      })
  );
});

// Background sync for offline actions (if needed in future)
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-routes') {
    event.waitUntil(
      // Sync saved routes when online
      Promise.resolve()
    );
  }
});

// Push notifications (if needed in future)
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'Notifikasi dari SENAVISION',
    icon: '/image/logo.png',
    badge: '/image/logo.png',
    vibrate: [200, 100, 200],
    tag: 'senavision-notification',
    requireInteraction: false
  };
  
  event.waitUntil(
    self.registration.showNotification('SENAVISION', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification clicked');
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

