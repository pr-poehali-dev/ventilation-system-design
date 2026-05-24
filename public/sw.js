/* Service Worker для ПВ-Система
 * Стратегия:
 *  - HTML (navigation) — network-first, fallback на кэш и оффлайн-страницу
 *  - Статика (js/css/png/svg/woff2) — stale-while-revalidate
 *  - Кросс-доменные CDN запросы — cache-first
 */
const VERSION = 'pv-sistema-v1.0.8';
const CACHE_STATIC = `${VERSION}-static`;
const CACHE_RUNTIME = `${VERSION}-runtime`;

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не кэшируем backend-функции и метрики
  if (url.hostname.includes('functions.poehali.dev')) return;
  if (url.hostname.includes('mc.yandex.ru')) return;

  // HTML-навигация — network-first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Статика и CDN-ассеты — stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_RUNTIME).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Принимаем сообщение от страницы для немедленного обновления
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});