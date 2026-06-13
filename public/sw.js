/* Service Worker для ПВ-Система
 * Стратегия:
 *  - HTML (navigation) — network-first, fallback на кэш
 *  - Иконки /icon-*.png — проксируем с CDN и кэшируем локально
 *  - Статика (js/css/png/svg/woff2) — stale-while-revalidate
 */
const VERSION = 'pv-sistema-v1.1.0';
const CACHE_STATIC = `${VERSION}-static`;
const CACHE_RUNTIME = `${VERSION}-runtime`;

// CDN-источники иконок (проксируем как локальные /icon-*.png)
const ICON_MAP = {
  '/icon-512.png': 'https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/54f363e3-a3a0-4a8d-9e99-b6c32172dfdd.png',
  '/icon-192.png': 'https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/54f363e3-a3a0-4a8d-9e99-b6c32172dfdd.png',
};

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon-512.png',
  '/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(async (cache) => {
      // Кэшируем иконки через проксирование с CDN
      for (const [path, cdnUrl] of Object.entries(ICON_MAP)) {
        try {
          const resp = await fetch(cdnUrl, { mode: 'cors' });
          if (resp.ok) await cache.put(new Request(path), resp);
        } catch { /* игнорируем */ }
      }
      // Кэшируем остальные ресурсы
      await cache.addAll(['/', '/manifest.webmanifest']).catch(() => null);
    }).then(() => self.skipWaiting())
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

  // Иконки — отдаём из кэша (были загружены при install)
  if (url.pathname === '/icon-512.png' || url.pathname === '/icon-192.png') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        // Fallback: проксируем напрямую
        const cdnUrl = ICON_MAP[url.pathname];
        return fetch(cdnUrl, { mode: 'cors' });
      })
    );
    return;
  }

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

  // Статика — stale-while-revalidate
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
