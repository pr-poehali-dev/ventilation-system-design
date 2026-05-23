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