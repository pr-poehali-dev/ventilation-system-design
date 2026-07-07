import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { APP_VERSION } from "@/lib/appVersion";
import { fetchRemoteVersion, isNewerVersion, downloadAndInstall } from "@/lib/updater";

/**
 * Единый баннер обновления приложения — работает и в браузере, и в десктопе
 * (C# WebView2). При старте проверяет версию на сервере и, если доступна более
 * новая, показывает верхний баннер с кнопкой «Обновить».
 *
 * Кнопка «Обновить» использует общую логику updater.ts: качает установщик по
 * ?file=exe (браузер) или отдаёт команду C#-оболочке (десктоп).
 */
export default function AppUpdateBanner() {
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Небольшая задержка, чтобы не мешать первичной загрузке интерфейса.
    const t = window.setTimeout(async () => {
      try {
        const d = await fetchRemoteVersion();
        if (cancelled) return;
        if (d.version && isNewerVersion(d.version, APP_VERSION)) {
          // «Позже» скрывает баннер до следующего запуска (сессии).
          // Если появилась ещё более новая версия — баннер покажем снова.
          if (sessionStorage.getItem("pvsUpdateSnooze") === d.version) return;
          setVersion(d.version);
          setNotes(d.notes);
        }
      } catch {
        // молча игнорируем — сеть недоступна или сервер молчит
      }
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, []);

  if (!version || dismissed) return null;

  const handleUpdate = () => {
    if (busy) return;
    setBusy(true);
    downloadAndInstall();
    // Через пару секунд снимаем состояние «загрузка» на случай, если окно
    // осталось открытым (в браузере скачивание идёт фоном).
    window.setTimeout(() => setBusy(false), 3000);
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100000] flex items-center gap-3 px-4 h-11"
      style={{
        background: "linear-gradient(90deg,#2563eb,#1d4ed8)",
        color: "#fff",
        fontFamily: "Segoe UI, Arial, sans-serif",
        fontSize: 13,
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      }}>
      <Icon name="Sparkles" size={16} className="flex-shrink-0" />
      <div className="flex-1 min-w-0 truncate">
        <b>Доступно обновление v{version}</b>
        {notes && <span className="opacity-80 ml-2 text-[12px]">{notes}</span>}
      </div>
      <button
        onClick={handleUpdate}
        disabled={busy}
        className="h-7 px-4 rounded-md text-[12px] font-semibold flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60"
        style={{ background: "#fff", color: "#1d4ed8" }}>
        {busy ? (
          <><Icon name="Loader2" size={13} className="animate-spin" />Загрузка…</>
        ) : (
          <><Icon name="Download" size={13} />Обновить</>
        )}
      </button>
      <button
        onClick={() => {
          try { sessionStorage.setItem("pvsUpdateSnooze", version); } catch { /* ignore */ }
          setDismissed(true);
        }}
        className="h-7 px-3 rounded-md text-[12px] font-medium flex-shrink-0 hover:bg-white/20 border border-white/40">
        Позже
      </button>
      <button
        onClick={() => setDismissed(true)}
        title="Закрыть"
        className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/20 flex-shrink-0">
        <Icon name="X" size={15} />
      </button>
    </div>
  );
}