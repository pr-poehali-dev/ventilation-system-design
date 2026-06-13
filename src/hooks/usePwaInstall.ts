import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window { __pwaPrompt?: BeforeInstallPromptEvent; }
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  );
  const [isInstallable, setIsInstallable] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMqChange = (e: MediaQueryListEvent) => { if (e.matches) setIsInstalled(true); };
    mq.addEventListener("change", onMqChange);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const evt = e as BeforeInstallPromptEvent;
      setDeferred(evt);
      setIsInstallable(true);
      window.__pwaPrompt = evt;
    };
    const onInstalled = () => { setIsInstalled(true); setIsInstallable(false); };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
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
