// Единый механизм проверки и скачивания обновлений ПВ-Система.
// Используется и веб-баннером (AppUpdateBanner), и окном «О программе»
// (UpdateCheckButton), чтобы логика была в ОДНОМ месте.

// URL функции версий: отдаёт { version, notes, download_url } и по ?file=exe —
// 302-редирект на свежий установщик с именем PVS-Setup-{версия}.exe.
export const VERSION_URL =
  "https://functions.poehali.dev/0ddfea8a-386f-4cb2-9fe0-37274caf2e16";

// Прямая ссылка на скачивание установщика (одинаковая для веба и десктопа).
export const INSTALLER_URL = `${VERSION_URL}?file=exe`;

export interface RemoteVersion {
  version: string;
  notes: string;
  downloadUrl: string;
}

/** Десктопная сборка (WebView2/C#) инжектирует window.__IS_DESKTOP__ = true. */
export function isDesktopApp(): boolean {
  const w = window as Window & { __IS_DESKTOP__?: boolean };
  return !!w.__IS_DESKTOP__ || window.location.protocol === "file:";
}

/** Сравнение версий вида "2.3.25" — true если remote новее local. */
export function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split(".").map((n) => parseInt(n, 10) || 0);
  const l = local.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

/** Запрашивает у сервера актуальную версию. Бросает при ошибке сети/формата. */
export async function fetchRemoteVersion(): Promise<RemoteVersion> {
  const res = await fetch(VERSION_URL, { cache: "no-store" });
  const text = await res.text();
  if (!text.trim().startsWith("{")) throw new Error("bad response");
  const d = JSON.parse(text);
  return {
    version: String(d.version || ""),
    notes: String(d.notes || ""),
    downloadUrl: String(d.download_url || ""),
  };
}

/**
 * Запускает скачивание/установку обновления. ЕДИНАЯ точка для веба и десктопа.
 * - Десктоп (C# WebView2): шлём команду в C# через postMessage. Если оболочка
 *   команду не обрабатывает — C# всё равно может открыть ссылку сам; как
 *   подстраховку дополнительно пробуем открыть установщик.
 * - Браузер: скачиваем .exe по ?file=exe (сервер отдаёт корректное имя файла).
 */
export function downloadAndInstall(): void {
  if (isDesktopApp()) {
    const w = window as Window & {
      chrome?: { webview?: { postMessage: (s: string) => void } };
      __pvsDownloadUpdate?: (url: string) => void;
    };
    // Способ 1: нативный колбэк, если C# его зарегистрировал.
    if (typeof w.__pvsDownloadUpdate === "function") {
      w.__pvsDownloadUpdate(INSTALLER_URL);
      return;
    }
    // Способ 2: сообщение в C# (WebView2). C# скачивает и запускает установщик.
    if (w.chrome?.webview?.postMessage) {
      w.chrome.webview.postMessage(
        JSON.stringify({ cmd: "download-update", url: INSTALLER_URL })
      );
      return;
    }
    // Fallback: открыть ссылку (C# перехватит навигацию/скачивание).
    window.location.href = INSTALLER_URL;
    return;
  }

  // Браузер — обычное скачивание файла.
  const a = document.createElement("a");
  a.href = INSTALLER_URL;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
