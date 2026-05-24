import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

createRoot(document.getElementById("root")!).render(<App />);

// ─── Регистрация Service Worker (PWA) ──────────────────────────────
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        // Авто-обновление: если появилась новая версия — активируем её
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch(() => { /* SW не критичен — приложение работает и без него */ });

    // При смене активного SW — НЕ перезагружаем автоматически,
    // чтобы не зациклить сплеш. Новая версия подхватится при следующем открытии.
  });
}

const splash = document.getElementById('app-splash');
if (splash) {
  const hideSplash = () => {
    if (!document.getElementById('app-splash')) return;
    const el = document.getElementById('app-splash')!;
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
    setTimeout(() => el.remove(), 600);
  };
  // Убираем через 1.5 сек — гарантированно, независимо от React
  setTimeout(hideSplash, 1500);
}