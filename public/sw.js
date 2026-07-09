/* PWA отключён. Этот SW самоудаляется: снимает регистрацию и чистит кэш,
   чтобы у пользователей, ранее установивших приложение, PWA был удалён. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) { /* noop */ }
  })());
});
