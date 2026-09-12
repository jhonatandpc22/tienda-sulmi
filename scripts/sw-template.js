const CACHE_NAME = 'sulmi-v-__VERSION__';
const ASSETS = __ASSETS__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('sulmi-v-') || key.startsWith('cajapos-')) && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Sólo recursos del sitio: Firebase y autenticación usan su propia persistencia.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match('./index.html');
      // HTML y scripts pertenecen a la misma versión hasta activar el nuevo SW.
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }
  if (!ASSETS.some(path => new URL(path, self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => (await cache.match(request)) || fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  })));
});
