const LICENSE_URL = "https://functions.poehali.dev/a1965362-df5e-40d6-ab62-0b523b49b023";
const STORAGE_KEY      = "pvs_license";
const HW_FP_KEY        = "pvs_hw_fp";
const MACHINE_UUID_KEY = "pvs_machine_uuid";
const CACHE_TTL_MS     = 12 * 60 * 60 * 1000; // 12 часов

export interface LicenseInfo {
  licensed: boolean;
  key?: string;
  owner?: string;
  seats?: { max: number; used: number };
  checkedAt?: number;
}

export interface MachineInfo {
  fingerprint: string;    // SHA-256(UUID + железо) — точный, меняется при сбросе PWA
  hwFingerprint: string;  // SHA-256(только железо) — выживает после переустановки PWA/ОС
  hostname: string;
  platform: string;
  screen: string;
}

// ── SHA-256 ───────────────────────────────────────────────────────────────────
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── ОС/платформа ─────────────────────────────────────────────────────────────
function detectPlatform(): string {
  const ua = navigator.userAgent;
  const pl = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform ?? "";
  if (/Win/i.test(pl) || /Windows/i.test(ua)) {
    const ver = ua.match(/Windows NT ([\d.]+)/);
    const names: Record<string, string> = {
      "10.0": "Win 10/11", "6.3": "Win 8.1", "6.2": "Win 8",
      "6.1": "Win 7", "6.0": "Vista", "5.1": "XP",
    };
    return "Windows " + (ver ? (names[ver[1]] ?? ver[1]) : "");
  }
  if (/Mac/i.test(pl) || /Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(pl) || /Linux/i.test(ua))   return "Linux";
  if (/Android/i.test(ua))  return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  return pl || "Unknown";
}

// ── UUID машины (localStorage) ────────────────────────────────────────────────
// Живёт пока не сброшен PWA/браузер. Используется как дополнительный компонент
// для точного fingerprint — чтобы различать два одинаковых ПК.
function getMachineUUID(): string {
  try {
    const existing = localStorage.getItem(MACHINE_UUID_KEY);
    if (existing) return existing;
    const uuid = crypto.randomUUID();
    localStorage.setItem(MACHINE_UUID_KEY, uuid);
    return uuid;
  } catch {
    return "fallback";
  }
}

// ── Аппаратные компоненты (без UUID) ─────────────────────────────────────────
// Эти данные НЕ зависят от localStorage — выживают после переустановки PWA.
// Используются как hw_fingerprint для восстановления лицензии после переустановки.
function getHwComponents(): string[] {
  return [
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    String(navigator.hardwareConcurrency ?? 0),
    detectPlatform(),
    String((navigator as { deviceMemory?: number }).deviceMemory ?? 0),
  ];
}

// ── Генерация MachineInfo ─────────────────────────────────────────────────────
// fingerprint    = SHA256(UUID + железо) — точный идентификатор сессии
// hwFingerprint  = SHA256(только железо) — стабилен при переустановке PWA
export async function getMachineInfo(): Promise<MachineInfo> {
  // Кэш на 30 дней
  try {
    const cached = localStorage.getItem(HW_FP_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as MachineInfo & { cachedAt: number };
      if (Date.now() - (parsed.cachedAt ?? 0) < 30 * 24 * 3600 * 1000 && parsed.hwFingerprint) {
        return { fingerprint: parsed.fingerprint, hwFingerprint: parsed.hwFingerprint,
                 hostname: parsed.hostname, platform: parsed.platform, screen: parsed.screen };
      }
    }
  } catch { /* ignore */ }

  const hwComponents = getHwComponents();
  const hwFingerprint = await sha256hex(hwComponents.join("||"));

  // Точный fingerprint = UUID + аппаратные компоненты
  const uuid = getMachineUUID();
  const fingerprint = await sha256hex([uuid, ...hwComponents].join("||"));

  const platform = detectPlatform();
  const scr = `${window.screen.width}×${window.screen.height}`;
  const ua = navigator.userAgent;
  const browser = ua.includes("Chrome") && !ua.includes("Edg") ? "Chrome"
    : ua.includes("Firefox") ? "Firefox"
    : ua.includes("Safari") && !ua.includes("Chrome") ? "Safari"
    : ua.includes("Edg") ? "Edge" : "Browser";
  const hostname = `${browser} / ${platform}`;

  const info: MachineInfo = { fingerprint, hwFingerprint, hostname, platform, screen: scr };

  try {
    localStorage.setItem(HW_FP_KEY, JSON.stringify({ ...info, cachedAt: Date.now() }));
  } catch { /* ignore */ }

  return info;
}

// ── Кэш лицензии ─────────────────────────────────────────────────────────────
export function loadCachedLicense(): LicenseInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LicenseInfo & { checkedAt?: number };
    if (Date.now() - (data.checkedAt ?? 0) > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function saveCache(info: LicenseInfo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...info, checkedAt: Date.now() }));
  } catch { /* ignore */ }
}

export function clearLicenseCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(HW_FP_KEY);
  } catch { /* ignore */ }
}

export function clearFingerprintCache() {
  try { localStorage.removeItem(HW_FP_KEY); } catch { /* ignore */ }
}

// ── Проверка лицензии ─────────────────────────────────────────────────────────
export async function checkLicense(fingerprint: string, machineInfo?: MachineInfo): Promise<LicenseInfo> {
  const res = await fetch(LICENSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "check",
      fingerprint,
      hw_fingerprint: machineInfo?.hwFingerprint,
      hostname:    machineInfo?.hostname,
      platform:    machineInfo?.platform,
      screen_info: machineInfo?.screen,
    }),
  });
  const data = await res.json();

  // Если сервер обновил fingerprint (восстановление после переустановки) — сбрасываем кэш
  if (data.fingerprint_updated) clearFingerprintCache();

  const info: LicenseInfo = {
    licensed: !!data.licensed,
    key: data.key,
    owner: data.owner,
    seats: data.seats,
  };
  saveCache(info);
  return info;
}

// ── Активация лицензии ────────────────────────────────────────────────────────
export async function activateLicense(
  fingerprint: string,
  key: string,
  machineInfo?: MachineInfo,
): Promise<LicenseInfo> {
  const res = await fetch(LICENSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "activate",
      fingerprint,
      hw_fingerprint: machineInfo?.hwFingerprint,
      key,
      hostname:    machineInfo?.hostname,
      platform:    machineInfo?.platform,
      screen_info: machineInfo?.screen,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msgs: Record<string, string> = {
      key_not_found:      "Ключ не найден",
      invalid_key_format: "Неверный формат ключа (PVS-XXXX-XXXX-XXXX-XXXX)",
      license_disabled:   "Лицензия отозвана",
      license_expired:    "Срок лицензии истёк",
      seats_exhausted:    `Все ${data.max_seats ?? 5} рабочих мест заняты`,
    };
    throw new Error(msgs[data.error] ?? "Ошибка активации");
  }

  // Если сервер восстановил seat по hw_fingerprint — сбрасываем кэш fp чтобы пересчитать
  if (data.fingerprint_updated) clearFingerprintCache();

  const info: LicenseInfo = {
    licensed: true,
    key: data.key,
    owner: data.owner,
    seats: data.seats,
  };
  saveCache(info);
  return info;
}
