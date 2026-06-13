import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";

export default function PwaUpdateBanner() {
  const [waitingSW, setWaitingSW] = useState<ServiceWorker | null>(null);
  const [reloading, setReloading] = useState(false);
  // Флаг чтобы не показывать баннер сразу после перезагрузки по обновлению
  const didReloadRef = useRef(
    sessionStorage.getItem("pwa-just-reloaded") === "1"
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Если только что перезагрузились — сбрасываем флаг и не показываем баннер
    if (didReloadRef.current) {
      sessionStorage.removeItem("pwa-just-reloaded");
      return;
    }

    const checkReg = (reg: ServiceWorkerRegistration) => {
      // Есть ожидающий SW — это реальное обновление
      if (reg.waiting) {
        setWaitingSW(reg.waiting);
        return;
      }
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          // installed + есть активный контроллер = новая версия готова
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingSW(sw);
          }
        });
      });
    };

    navigator.serviceWorker.ready.then(checkReg);

    // Проверка каждые 10 минут
    const interval = setInterval(() => {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) reg.update().catch(() => null);
      });
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const handleUpdate = () => {
    if (!waitingSW || reloading) return;
    setReloading(true);
    sessionStorage.setItem("pwa-just-reloaded", "1");
    waitingSW.postMessage("SKIP_WAITING");
    setTimeout(() => window.location.reload(), 1000);
  };

  if (!waitingSW) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[99999] flex items-center gap-3 rounded-xl shadow-2xl border border-blue-200 px-4 py-2.5"
      style={{
        transform: "translateX(-50%)",
        background: "linear-gradient(135deg,#eff6ff,#dbeafe)",
        fontFamily: "Segoe UI,Arial,sans-serif",
        fontSize: 13,
        minWidth: 300,
        maxWidth: 460,
        animation: "swSlideUp 0.35s cubic-bezier(.16,1,.3,1)",
      }}>
      <style>{`@keyframes swSlideUp{from{transform:translateX(-50%) translateY(16px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}`}</style>
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#2563eb" }}>
        <Icon name="RefreshCw" size={15} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-blue-900 text-[13px]">Доступно обновление</div>
        <div className="text-[11px] text-blue-600 leading-tight">Новая версия ПВ-Системы готова</div>
      </div>
      <button onClick={handleUpdate} disabled={reloading}
        className="h-7 px-3 rounded-lg text-white text-[11px] font-semibold flex items-center gap-1 flex-shrink-0"
        style={{ background: reloading ? "#93c5fd" : "#2563eb" }}>
        {reloading ? <><Icon name="Loader2" size={11} className="animate-spin" /> Обновление…</> : "Обновить"}
      </button>
      <button onClick={() => setWaitingSW(null)}
        className="w-6 h-6 flex items-center justify-center text-blue-500 hover:bg-blue-100 rounded flex-shrink-0">
        <Icon name="X" size={12} />
      </button>
    </div>
  );
}
