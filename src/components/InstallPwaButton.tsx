import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

// Хук — возвращает состояние PWA-установки для использования в других компонентах
export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  );
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    // Уже установлено?
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMqChange = (e: MediaQueryListEvent) => { if (e.matches) setIsInstalled(true); };
    mq.addEventListener("change", onMqChange);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const evt = e as BeforeInstallPromptEvent;
      setDeferred(evt);
      setIsInstallable(true);
      // Сохраняем глобально — для доступа из меню Файл → Установить
      (window as unknown as { __pwaPrompt?: BeforeInstallPromptEvent }).__pwaPrompt = evt;
    };
    const onInstalled = () => setIsInstalled(true);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") { setIsInstalled(true); return true; }
      setDeferred(null);
      setIsInstallable(false);
      return false;
    } catch {
      setDeferred(null);
      setIsInstallable(false);
      return false;
    }
  };

  return { isInstalled, isInstallable, install };
}

// Баннер снизу-справа — показывается один раз при первом визите
export default function InstallPwaButton() {
  const { isInstalled, isInstallable, install } = usePwaInstall();
  const [hidden, setHidden] = useState(() =>
    localStorage.getItem("pwa-install-dismissed") === "1"
  );
  const [show, setShow] = useState(false);

  // Показываем с задержкой 3 сек чтобы не мешать загрузке
  useEffect(() => {
    if (isInstallable && !hidden && !isInstalled) {
      const t = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(t);
    }
  }, [isInstallable, hidden, isInstalled]);

  const handleDismiss = () => {
    localStorage.setItem("pwa-install-dismissed", "1");
    setHidden(true);
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
        background: "linear-gradient(135deg, #f0f7ff 0%, #e8f0fe 100%)",
        fontFamily: "Segoe UI, Arial, sans-serif",
        maxWidth: 340,
        animation: "pwaSlideIn 0.4s cubic-bezier(.16,1,.3,1)",
      }}>
      <style>{`
        @keyframes pwaSlideIn {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
      <img
        src="/icon-192.png"
        alt="ПВ-Система"
        className="w-10 h-10 flex-shrink-0 rounded-lg"
        draggable={false}
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-900 text-[13px]">Установить ПВ-Система</div>
        <div className="text-[11px] text-gray-500 leading-snug mt-0.5">
          Работайте как с настольным приложением — без браузера
        </div>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button
          onClick={handleInstall}
          className="h-7 px-3 rounded-lg text-white text-[11px] font-semibold"
          style={{ background: "#2563eb" }}>
          Установить
        </button>
        <button
          onClick={handleDismiss}
          className="h-6 text-[10px] text-gray-400 hover:text-gray-600 text-center">
          Не сейчас
        </button>
      </div>
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-black/10 rounded">
        <Icon name="X" size={11} />
      </button>
    </div>
  );
}