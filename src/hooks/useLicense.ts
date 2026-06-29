import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMachineInfo,
  loadCachedLicense,
  checkLicense,
  activateLicense,
  clearLicenseCache,
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
      // Получаем стабильный аппаратный fingerprint
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

      // 2. Проверяем на сервере (обновляем сведения о ПК)
      try {
        const fresh = await checkLicense(mi.fingerprint, mi);
        if (cancelled) return;
        setInfo(fresh);
        if (fresh.offlineExpired) {
          // Оффлайн-кэш просрочен — требуется подключение к интернету
          setStatus("offline_expired");
        } else {
          setStatus(fresh.licensed ? "licensed" : "demo");
        }
      } catch {
        if (cancelled) return;
        // Нет сети — используем кэш или демо
        if (cached?.licensed) {
          setStatus("licensed");
        } else {
          setStatus("demo");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

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