import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";
import { usePwaInstall } from "@/hooks/usePwaInstall";

const LOGO = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/e6a37e59-abfb-4f45-a7d8-89802209b5f4.png";

export default function InstallPwaButton() {
  const { isInstalled, isInstallable, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem("pwa-install-dismissed") === "1"
  );
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isInstallable && !dismissed && !isInstalled) {
      const t = setTimeout(() => setShow(true), 4000);
      return () => clearTimeout(t);
    }
  }, [isInstallable, dismissed, isInstalled]);

  const handleDismiss = () => {
    localStorage.setItem("pwa-install-dismissed", "1");
    setDismissed(true);
    setShow(false);
  };

  const handleInstall = async () => {
    const ok = await install();
    if (ok) setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-[9998] flex items-center gap-3 rounded-xl shadow-2xl border border-blue-100 px-4 py-3"
      style={{
        background: "linear-gradient(135deg,#f0f7ff,#e8f0fe)",
        fontFamily: "Segoe UI,Arial,sans-serif",
        maxWidth: 340,
        animation: "pwaSlideIn 0.4s cubic-bezier(.16,1,.3,1)",
      }}>
      <style>{`@keyframes pwaSlideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <img src={LOGO} alt="ПВ" className="w-10 h-10 flex-shrink-0 rounded-xl" draggable={false} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-900 text-[13px]">Установить ПВ-Система</div>
        <div className="text-[11px] text-gray-500 leading-snug mt-0.5">Работайте без браузера как обычная программа</div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button onClick={handleInstall}
          className="h-7 px-3 rounded-lg text-white text-[11px] font-semibold"
          style={{ background: "#2563eb" }}>
          Установить
        </button>
        <button onClick={handleDismiss} className="h-6 text-[10px] text-gray-400 hover:text-gray-600 text-center">
          Не сейчас
        </button>
      </div>
      <button onClick={handleDismiss}
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-black/10 rounded">
        <Icon name="X" size={11} />
      </button>
    </div>
  );
}