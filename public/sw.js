/* Service Worker для ПВ-Система v1.3.0 */
const VERSION = 'pv-sistema-v1.3.0';
const CACHE = `${VERSION}`;

// Ресурсы для предзагрузки при установке SW
const PRECACHE = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Пропускаем: backend, метрики, CDN других доменов
  if (url.hostname !== location.hostname) return;

  // HTML навигация — network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((r) => { caches.open(CACHE).then((c) => c.put(req, r.clone())); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Статика — stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req).then((r) => {
        if (r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
        return r;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
