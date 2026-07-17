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
  const [progress, setProgress] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Десктоп (C#) шлёт прогресс скачивания обновления сюда.
  useEffect(() => {
    const w = window as Window & { __pvsUpdateProgress?: (p: number) => void };
    w.__pvsUpdateProgress = (p: number) => setProgress(Math.max(0, Math.min(100, p)));
    return () => { w.__pvsUpdateProgress = undefined; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
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
    };

    // 1. При старте — с небольшой задержкой, чтобы не мешать загрузке интерфейса.
    const t = window.setTimeout(check, 4000);
    // 2. Периодически — чтобы длительно открытая вкладка узнала о новой версии.
    const iv = window.setInterval(check, 30 * 60 * 1000);
    // 3. При возврате на вкладку — самый частый сценарий, когда вышло обновление.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!version || dismissed) return null;

  const isDesktop = !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;

  const handleUpdate = () => {
    if (busy) return;
    setBusy(true);
    if (isDesktop) setProgress(0);   // покажем полосу загрузки
    downloadAndInstall();
    // В браузере скачивание идёт фоном — снимаем «загрузку» через пару секунд.
    // В десктопе состояние держим: C# сам закроет приложение и перезапустит его
    // после установки, полоса прогресса дойдёт до 100%.
    if (!isDesktop) window.setTimeout(() => setBusy(false), 3000);
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
        {busy && progress !== null ? (
          <span className="opacity-90 ml-2 text-[12px]">
            {progress < 100 ? `Загрузка обновления… ${progress}%` : "Установка и перезапуск…"}
          </span>
        ) : (
          notes && <span className="opacity-80 ml-2 text-[12px]">{notes}</span>
        )}
      </div>

      {/* Полоса загрузки (десктоп) */}
      {busy && progress !== null && (
        <div className="flex-shrink-0 w-40 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.3)" }}>
          <div className="h-full rounded-full transition-all duration-200"
            style={{ width: `${progress}%`, background: "#fff" }} />
        </div>
      )}

      <button
        onClick={handleUpdate}
        disabled={busy}
        className="h-7 px-4 rounded-md text-[12px] font-semibold flex items-center gap-1.5 flex-shrink-0 disabled:opacity-60"
        style={{ background: "#fff", color: "#1d4ed8" }}>
        {busy ? (
          <><Icon name="Loader2" size={13} className="animate-spin" />
            {progress !== null && progress < 100 ? `${progress}%` : "Обновление…"}</>
        ) : (
          <><Icon name="Download" size={13} />Обновить</>
        )}
      </button>
      {!busy && (
        <>
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
        </>
      )}
    </div>
  );
}