const CACHE_NAME = 'campusafe-public-v2';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './db.js',
  './app.js'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Forzar actualización inmediata
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Borrar cachés viejos (v1)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name.startsWith('campusafe-')).map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Tomar control de inmediato
});

// Estrategia: Network First (Siempre intenta internet primero, si falla usa caché)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
