import { createContext, useContext, ReactNode } from "react";
import { useLicense, type LicenseStatus, type UseLicenseReturn } from "@/hooks/useLicense";
import type { LicenseInfo } from "@/lib/license";

const LicenseContext = createContext<UseLicenseReturn | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const license = useLicense();
  return <LicenseContext.Provider value={license}>{children}</LicenseContext.Provider>;
}

export function useLicenseContext(): UseLicenseReturn {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicenseContext must be used within LicenseProvider");
  return ctx;
}

export type { LicenseStatus, LicenseInfo };
