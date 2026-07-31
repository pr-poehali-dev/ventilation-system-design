import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { APP_VERSION } from "@/lib/appVersion";
import { fetchRemoteVersion, isNewerVersion, downloadAndInstall, reloadBrowserToUpdate } from "@/lib/updater";

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
  const [showSavePrompt, setShowSavePrompt] = useState(false);

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

  // Есть ли в проекте несохранённые изменения (проброшено из Cad.tsx через window)
  const hasUnsaved = (): boolean => {
    try {
      const fn = (window as Window & { __pvsIsDirty?: () => boolean }).__pvsIsDirty;
      return typeof fn === "function" ? !!fn() : false;
    } catch { return false; }
  };

  const handleUpdate = () => {
    if (busy) return;
    // Десктоп: C# сам скачает и перезапустит приложение (проект остаётся в файле).
    if (isDesktop) {
      setBusy(true);
      setProgress(0);
      downloadAndInstall();
      return;
    }
    // Браузер: нужно перезагрузить страницу на свежую версию. Если есть
    // несохранённые изменения — сначала предложим сохранить проект.
    if (hasUnsaved()) {
      setShowSavePrompt(true);
      return;
    }
    void reloadBrowserToUpdate();
  };

  // Сохранить проект и затем перезагрузиться на новую версию
  const handleSaveAndReload = async () => {
    setBusy(true);
    try {
      const save = (window as Window & { __pvsSaveProject?: () => Promise<void> | void }).__pvsSaveProject;
      if (typeof save === "function") await save();
    } catch {
      // если сохранение не удалось — не перезагружаем, снимаем занятость
      setBusy(false);
      return;
    }
    await reloadBrowserToUpdate();
  };

  return (
   <>
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
          <><Icon name={isDesktop ? "Download" : "RefreshCw"} size={13} />
            {isDesktop ? "Обновить" : "Обновить страницу"}</>
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

    {/* Браузер: предупреждение о несохранённом проекте перед перезагрузкой */}
    {showSavePrompt && (
      <div
        className="fixed inset-0 z-[100001] flex items-center justify-center"
        style={{ background: "rgba(15,23,42,0.55)", fontFamily: "Segoe UI, Arial, sans-serif" }}>
        <div className="bg-white rounded-xl shadow-2xl w-[440px] max-w-[92vw] overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-2.5 border-b border-gray-100">
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: "#fef3c7" }}>
              <Icon name="TriangleAlert" size={18} style={{ color: "#b45309" }} />
            </div>
            <div className="font-semibold text-[15px]" style={{ color: "#1a3a6b" }}>
              Сохраните проект перед обновлением
            </div>
          </div>
          <div className="px-5 py-4 text-[13px] text-gray-600 leading-relaxed">
            В проекте есть несохранённые изменения. При обновлении страница
            перезагрузится, и несохранённые данные будут потеряны.
            <br /><br />
            Рекомендуем сначала сохранить проект.
          </div>
          <div className="px-5 py-3 bg-gray-50 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowSavePrompt(false)}
              disabled={busy}
              className="h-9 px-4 rounded-md text-[13px] font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50">
              Отмена
            </button>
            <button
              onClick={() => { setShowSavePrompt(false); void reloadBrowserToUpdate(); }}
              disabled={busy}
              className="h-9 px-4 rounded-md text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
              Обновить без сохранения
            </button>
            <button
              onClick={handleSaveAndReload}
              disabled={busy}
              className="h-9 px-4 rounded-md text-[13px] font-semibold text-white flex items-center gap-1.5 disabled:opacity-60"
              style={{ background: "#2563eb" }}>
              {busy
                ? <><Icon name="Loader2" size={14} className="animate-spin" />Сохранение…</>
                : <><Icon name="Save" size={14} />Сохранить и обновить</>}
            </button>
          </div>
        </div>
      </div>
    )}
   </>
  );
}