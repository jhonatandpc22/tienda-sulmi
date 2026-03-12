const CACHE_NAME = 'cajapos-v4';

// Archivos esenciales a guardar
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// 1. Instalar y forzar a que tome el control INMEDIATAMENTE
self.addEventListener('install', e => {
  self.skipWaiting(); // No espera a que se cierre la app para actualizar
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Limpiar versiones viejas de la memoria cuando hay una actualización
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== CACHE_NAME) {
          console.log('Borrando versión antigua:', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// 3. ESTRATEGIA: NETWORK FIRST (Primero Internet, luego Caché)
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(networkResponse => {
        // Si hay internet y la petición es exitosa, guardamos una copia fresca en caché y la devolvemos
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(e.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // SI NO HAY INTERNET, usamos la copia guardada (Caché)
        return caches.match(e.request);
      })
  );
});