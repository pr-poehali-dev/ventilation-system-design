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

    // При смене активного SW — перезагружаем страницу один раз
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

const splash = document.getElementById('app-splash');
if (splash) {
  const minShowMs = 900;
  const startedAt = (window as unknown as { __splashStartedAt?: number }).__splashStartedAt ?? performance.now();
  const elapsed = performance.now() - startedAt;
  const wait = Math.max(0, minShowMs - elapsed);
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 600);
  }, wait);
}