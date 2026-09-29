// Service worker: guarda la app para que funcione sin internet
importScripts('version.js');
const CACHE = 'mis-finanzas-' + VERSION;
const ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './version.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ARCHIVOS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (así siempre tienes la versión más nueva si hay internet);
// sin conexión o si tarda más de 4 s, usa la copia guardada.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const limite = new Promise((_, no) => setTimeout(() => no(new Error('lento')), 4000));
      const r = await Promise.race([fetch(e.request.url, { cache: 'no-cache' }), limite]);
      // Las consultas con ?t=… (buscar actualización) no se guardan
      if (r.ok && !new URL(e.request.url).search) cache.put(e.request, r.clone());
      return r;
    } catch {
      return (await cache.match(e.request, { ignoreSearch: true }))
        || (await cache.match('./index.html'))
        || Response.error();
    }
  })());
});
