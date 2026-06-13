import { useState, useEffect, useCallback } from "react";
import {
  getBrowserFingerprint,
  loadCachedLicense,
  checkLicense,
  activateLicense,
  clearLicenseCache,
  type LicenseInfo,
} from "@/lib/license";

export type LicenseStatus = "loading" | "demo" | "licensed";

export interface UseLicenseReturn {
  status: LicenseStatus;
  info: LicenseInfo | null;
  fingerprint: string;
  activate: (key: string) => Promise<void>;
  deactivate: () => void;
  error: string | null;
}

export function useLicense(): UseLicenseReturn {
  const [status, setStatus]           = useState<LicenseStatus>("loading");
  const [info, setInfo]               = useState<LicenseInfo | null>(null);
  const [fingerprint, setFingerprint] = useState<string>("");
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fp = await getBrowserFingerprint();
      if (cancelled) return;
      setFingerprint(fp);

      // 1. Смотрим кэш
      const cached = loadCachedLicense();
      if (cached?.licensed) {
        setInfo(cached);
        setStatus("licensed");
      }

      // 2. Проверяем на сервере (в фоне)
      try {
        const fresh = await checkLicense(fp);
        if (cancelled) return;
        setInfo(fresh);
        setStatus(fresh.licensed ? "licensed" : "demo");
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
    const fp = fingerprint || (await getBrowserFingerprint());
    const result = await activateLicense(fp, key);
    setInfo(result);
    setStatus("licensed");
  }, [fingerprint]);

  const deactivate = useCallback(() => {
    clearLicenseCache();
    setInfo(null);
    setStatus("demo");
  }, []);

  return { status, info, fingerprint, activate, deactivate, error };
}
