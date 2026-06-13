import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";

export default function PwaUpdateBanner() {
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const checkRegistration = (reg: ServiceWorkerRegistration) => {
      // Новый SW уже ждёт активации
      if (reg.waiting) {
        setWaitingSW(reg.waiting);
        return;
      }
      // SW устанавливается прямо сейчас
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingSW(sw);
          }
        });
      });
    };

    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg) checkRegistration(reg);
    });

    // Периодически проверяем обновления (каждые 5 минут)
    const interval = setInterval(() => {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          reg.update().then(() => checkRegistration(reg));
        }
      });
    }, 5 * 60 * 1000);

    // При получении контроля новым SW — перезагружаем страницу
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      window.location.reload();
    });

    return () => clearInterval(interval);
  }, [reloading]);

  const handleUpdate = () => {
    if (!waitingSW) return;
    setReloading(true);
    // Говорим ожидающему SW — активируйся немедленно
    waitingSW.postMessage("SKIP_WAITING");
    // Fallback: перезагрузка через 1.5с если controllerchange не сработал
    setTimeout(() => window.location.reload(), 1500);
  };

  const handleDismiss = () => setWaitingSW(null);

  if (!waitingSW) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[99999] flex items-center gap-3 rounded-lg shadow-2xl border border-blue-200 px-4 py-2.5"
      style={{
        transform: "translateX(-50%)",
        background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
        fontFamily: "Segoe UI, Arial, sans-serif",
        fontSize: 13,
        minWidth: 320,
        maxWidth: 480,
        animation: "slideUp 0.3s ease",
      }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
        }
      `}</style>
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: "#2563eb" }}>
        <Icon name="RefreshCw" size={16} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-blue-900">Доступно обновление</div>
        <div className="text-[11px] text-blue-700 leading-tight">
          Новая версия ПВ-Системы готова к установке
        </div>
      </div>
      <button
        onClick={handleUpdate}
        disabled={reloading}
        className="h-7 px-3 rounded text-white text-[11px] font-medium flex-shrink-0 flex items-center gap-1"
        style={{ background: reloading ? "#93c5fd" : "#2563eb", transition: "background 0.2s" }}>
        {reloading
          ? <><Icon name="Loader2" size={11} className="animate-spin" /> Обновление…</>
          : "Обновить"}
      </button>
      <button
        onClick={handleDismiss}
        className="w-6 h-6 hover:bg-blue-200 rounded flex items-center justify-center text-blue-600 flex-shrink-0">
        <Icon name="X" size={12} />
      </button>
    </div>
  );
}
