import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMachineInfo,
  loadCachedLicense,
  checkLicense,
  activateLicense,
  clearLicenseCache,
  checkOfflineEmergency,
  sendHeartbeat,
  storageReady,
  type LicenseInfo,
  type MachineInfo,
} from "@/lib/license";

export type LicenseStatus = "loading" | "demo" | "licensed" | "offline_expired";

export interface UseLicenseReturn {
  status: LicenseStatus;
  info: LicenseInfo | null;
  fingerprint: string;
  machineInfo: MachineInfo | null;
  activate: (key: string) => Promise<void>;
  deactivate: () => void;
  error: string | null;
}

export function useLicense(): UseLicenseReturn {
  const [status, setStatus]             = useState<LicenseStatus>("loading");
  const [info, setInfo]                 = useState<LicenseInfo | null>(null);
  const [fingerprint, setFingerprint]   = useState<string>("");
  const [machineInfo, setMachineInfo]   = useState<MachineInfo | null>(null);
  const [error, setError]               = useState<string | null>(null);
  const machineInfoRef                  = useRef<MachineInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Дожидаемся восстановления лицензии с диска (десктоп), затем — fingerprint
      await storageReady;
      const mi = await getMachineInfo();
      if (cancelled) return;
      setFingerprint(mi.fingerprint);
      setMachineInfo(mi);
      machineInfoRef.current = mi;

      // 1. Смотрим кэш
      const cached = loadCachedLicense();
      if (cached?.licensed) {
        setInfo(cached);
        setStatus("licensed");
      }

      // 1a. Аварийный оффлайн-ключ (локальная проверка, без интернета) —
      // если обычной лицензии в кэше нет, но есть действующий аварийный ключ.
      const emergency = checkOfflineEmergency();
      if (!cached?.licensed && emergency?.licensed) {
        setInfo(emergency);
        setStatus("licensed");
      }

      // 2. Проверяем на сервере (обновляем сведения о ПК)
      try {
        const fresh = await checkLicense(mi.fingerprint, mi);
        if (cancelled) return;
        // Онлайн-лицензия в приоритете. Но если сервер её не подтвердил,
        // а аварийный ключ действует — остаёмся в аварийном режиме.
        if (!fresh.licensed && emergency?.licensed) {
          setInfo(emergency);
          setStatus("licensed");
          return;
        }
        setInfo(fresh);
        if (fresh.offlineExpired) {
          // Оффлайн-кэш просрочен — требуется подключение к интернету
          setStatus("offline_expired");
        } else {
          setStatus(fresh.licensed ? "licensed" : "demo");
        }
      } catch {
        if (cancelled) return;
        // Нет сети — приоритет: обычный кэш → аварийный ключ → демо
        if (cached?.licensed) {
          setStatus("licensed");
        } else if (emergency?.licensed) {
          setInfo(emergency);
          setStatus("licensed");
        } else {
          setStatus("demo");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Периодический heartbeat, пока лицензия активна — для мониторинга онлайн-сессий
  useEffect(() => {
    if (status !== "licensed" || !fingerprint) return;
    const mi = machineInfoRef.current ?? machineInfo ?? undefined;
    sendHeartbeat(fingerprint, mi);
    const id = setInterval(() => {
      sendHeartbeat(fingerprint, machineInfoRef.current ?? undefined);
    }, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [status, fingerprint, machineInfo]);

  const activate = useCallback(async (key: string) => {
    setError(null);
    const mi = machineInfoRef.current ?? await getMachineInfo();
    const result = await activateLicense(mi.fingerprint, key, mi);
    setInfo(result);
    setStatus("licensed");
  }, []);

  const deactivate = useCallback(() => {
    clearLicenseCache();
    setInfo(null);
    setStatus("demo");
  }, []);

  return { status, info, fingerprint, machineInfo, activate, deactivate, error };
}