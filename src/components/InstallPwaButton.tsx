import { useEffect, useState } from "react";
import Icon from "@/components/ui/icon";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export default function InstallPwaButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => {
    return localStorage.getItem("pwa-install-dismissed") === "1";
  });
  const [installed, setInstalled] = useState<boolean>(() => {
    return window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  });

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || hidden || !deferred) return null;

  const handleInstall = async () => {
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } catch {
      setDeferred(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem("pwa-install-dismissed", "1");
    setHidden(true);
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 bg-white rounded-lg shadow-2xl border border-gray-300 px-3 py-2"
      style={{ fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 12, maxWidth: 320 }}>
      <img
        src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/dd1fabee-50f5-490e-a8d0-19501520690c.png"
        alt="ПВ-Система"
        className="w-8 h-8 flex-shrink-0"
        draggable={false}
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-800 truncate">Установить ПВ-Система</div>
        <div className="text-[11px] text-gray-500 leading-tight">Работайте как с настольным приложением</div>
      </div>
      <button
        onClick={handleInstall}
        className="h-7 px-3 rounded text-white text-[11px] font-medium flex-shrink-0"
        style={{ background: "#2563eb" }}>
        Установить
      </button>
      <button
        onClick={handleDismiss}
        className="w-6 h-6 hover:bg-black/10 rounded flex items-center justify-center text-gray-500 flex-shrink-0"
        title="Скрыть">
        <Icon name="X" size={12} />
      </button>
    </div>
  );
}