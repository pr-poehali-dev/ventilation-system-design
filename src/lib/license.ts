import { API_URLS } from "@/lib/api-urls";
import { APP_VERSION } from "@/lib/appVersion";
const LICENSE_URL = API_URLS.license;

// ── Версия расчётного ядра (server.exe) ───────────────────────────────────────
// Доступна только в десктопе — там локальный сервер отдаёт её через /api/status.
// В браузере ядра нет, поэтому возвращаем "". Кешируем, чтобы не дёргать каждый раз.
let _coreVersion: string | null = null;
export async function getCoreVersion(): Promise<string> {
  if (_coreVersion !== null) return _coreVersion;
  const isDesktop = !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;
  if (!isDesktop) { _coreVersion = ""; return ""; }
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    const data = await res.json();
    _coreVersion = data?.version ? String(data.version) : "";
  } catch {
    _coreVersion = "";
  }
  return _coreVersion;
}
const STORAGE_KEY      = "pvs_license";
const HW_FP_KEY        = "pvs_hw_fp";
const CACHE_TTL_MS     = 12 * 60 * 60 * 1000; // 12 часов

const IS_DESKTOP = !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;

// ── Слой хранилища ───────────────────────────────────────────────────────────
// Веб:     localStorage.
// Десктоп: localStorage (быстрый синхронный доступ) + файл на диске через
//          server.exe (/api/license-store). Файл переживает чистку кэша WebView2,
//          поэтому лицензия не слетает.
async function fileStoreSet(key: string, value: string): Promise<void> {
  try {
    await fetch("/api/license-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch { /* ignore */ }
}
async function fileStoreRemove(key: string): Promise<void> {
  try {
    await fetch("/api/license-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, remove: true }),
    });
  } catch { /* ignore */ }
}

const storage = {
  get(key: string): string | null {
    return localStorage.getItem(key);
  },
  set(key: string, value: string): void {
    localStorage.setItem(key, value);
    if (IS_DESKTOP) fileStoreSet(key, value);
  },
  remove(key: string): void {
    localStorage.removeItem(key);
    if (IS_DESKTOP) fileStoreRemove(key);
  },
  // Восстановление значений с диска в localStorage при запуске (десктоп).
  async init(): Promise<void> {
    if (!IS_DESKTOP) return;
    try {
      const res = await fetch("/api/license-store", { cache: "no-store" });
      const data = await res.json();
      const store = (data?.store ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(store)) {
        if (typeof v === "string" && !localStorage.getItem(k)) {
          localStorage.setItem(k, v);
        }
      }
    } catch { /* ignore */ }
  },
};

// Восстанавливаем лицензию с диска при загрузке (десктоп)
export const storageReady: Promise<void> = storage.init();

export interface LicenseInfo {
  licensed: boolean;
  key?: string;
  owner?: string;
  seats?: { max: number; used: number };
  checkedAt?: number;
  offline?: boolean;       // true — ответ из оффлайн-кэша
  daysLeft?: number;       // дней до истечения оффлайн-кэша (только при offline=true)
  offlineExpired?: boolean; // кэш просрочен (>14 дней без интернета)
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

// ── Настоящий аппаратный ID машины (только десктоп) ──────────────────────────
// server.exe отдаёт реальный machine-id ОС (MachineGuid/UUID платы,
// /etc/machine-id) и имя компьютера. В браузере эндпоинта нет — вернём пусто.
async function getDesktopMachine(): Promise<{ machineId: string; hostname: string }> {
  if (!IS_DESKTOP) return { machineId: "", hostname: "" };
  try {
    const res = await fetch("/api/machine", { cache: "no-store" });
    const data = await res.json();
    return {
      machineId: data?.machineId ? String(data.machineId) : "",
      hostname: data?.hostname ? String(data.hostname) : "",
    };
  } catch {
    return { machineId: "", hostname: "" };
  }
}

// ── Генерация MachineInfo ─────────────────────────────────────────────────────
// hwFingerprint = SHA256(железо). fingerprint = hwFingerprint.
//   Веб:     железо = браузерные характеристики (screen/CPU/ОС/таймзона).
//   Десктоп: железо = настоящий machine-id ОС (стабильнее, привязка к ПК).
export async function getMachineInfo(): Promise<MachineInfo> {
  // Кэш на 30 дней
  try {
    const cached = storage.get(HW_FP_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as MachineInfo & { cachedAt: number };
      if (Date.now() - (parsed.cachedAt ?? 0) < 30 * 24 * 3600 * 1000 && parsed.hwFingerprint) {
        return { fingerprint: parsed.fingerprint, hwFingerprint: parsed.hwFingerprint,
                 hostname: parsed.hostname, platform: parsed.platform, screen: parsed.screen };
      }
    }
  } catch { /* ignore */ }

  const { machineId, hostname: pcName } = await getDesktopMachine();

  // Основа отпечатка: в десктопе — настоящий machine-id ОС; иначе — браузерное железо.
  const hwComponents = machineId
    ? [`mid:${machineId}`, ...getHwComponents()]
    : getHwComponents();
  const hwFingerprint = await sha256hex(hwComponents.join("||"));

  // Привязка к рабочему месту — ТОЛЬКО по железу: fingerprint = hwFingerprint.
  const fingerprint = hwFingerprint;

  const platform = detectPlatform();
  const scr = `${window.screen.width}×${window.screen.height}`;
  const ua = navigator.userAgent;
  const browser = ua.includes("Chrome") && !ua.includes("Edg") ? "Chrome"
    : ua.includes("Firefox") ? "Firefox"
    : ua.includes("Safari") && !ua.includes("Chrome") ? "Safari"
    : ua.includes("Edg") ? "Edge" : "Browser";
  // В десктопе показываем имя компьютера, в браузере — браузер/ОС.
  const hostname = IS_DESKTOP
    ? `ПВ-Система (десктоп)${pcName ? ` · ${pcName}` : ""} / ${platform}`
    : `${browser} / ${platform}`;

  const info: MachineInfo = { fingerprint, hwFingerprint, hostname, platform, screen: scr };

  try {
    storage.set(HW_FP_KEY, JSON.stringify({ ...info, cachedAt: Date.now() }));
  } catch { /* ignore */ }

  return info;
}

// ── Кэш лицензии ─────────────────────────────────────────────────────────────
export function loadCachedLicense(): LicenseInfo | null {
  try {
    const raw = storage.get(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LicenseInfo & { checkedAt?: number };
    if (Date.now() - (data.checkedAt ?? 0) > CACHE_TTL_MS) return null;
    return data;
  } catch { return null; }
}

function saveCache(info: LicenseInfo) {
  try {
    storage.set(STORAGE_KEY, JSON.stringify({ ...info, checkedAt: Date.now() }));
  } catch { /* ignore */ }
}

export function clearLicenseCache() {
  try {
    storage.remove(STORAGE_KEY);
    storage.remove(HW_FP_KEY);
  } catch { /* ignore */ }
}

export function clearFingerprintCache() {
  try { storage.remove(HW_FP_KEY); } catch { /* ignore */ }
}

// ── Проверка лицензии ─────────────────────────────────────────────────────────
export async function checkLicense(fingerprint: string, machineInfo?: MachineInfo): Promise<LicenseInfo> {
  const coreVersion = await getCoreVersion();
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
      app_version: APP_VERSION,
      core_version: coreVersion || undefined,
    }),
  });
  const data = await res.json();

  // Если сервер обновил fingerprint (восстановление после переустановки) — сбрасываем кэш
  if (data.fingerprint_updated) clearFingerprintCache();

  // Кэш просрочен (>14 дней без интернета)
  if (data.reason === "offline_cache_expired") {
    return { licensed: false, offlineExpired: true, daysLeft: 0 };
  }

  const info: LicenseInfo = {
    licensed:  !!data.licensed,
    key:       data.key,
    owner:     data.owner,
    seats:     data.seats,
    offline:   !!data.offline,
    daysLeft:  data.days_left,
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
  const coreVersion = await getCoreVersion();
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
      app_version: APP_VERSION,
      core_version: coreVersion || undefined,
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

// ── Heartbeat: «я жива» ───────────────────────────────────────────────────────
// Периодический лёгкий пинг для мониторинга онлайн-сессий. modules — какие
// разделы программы сейчас используются (например "vent" / "water" / "fire").
export async function sendHeartbeat(
  fingerprint: string,
  machineInfo?: MachineInfo,
  modules?: string,
): Promise<void> {
  try {
    const coreVersion = await getCoreVersion();
    await fetch(LICENSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "heartbeat",
        fingerprint,
        hostname:    machineInfo?.hostname,
        platform:    machineInfo?.platform,
        app_version: APP_VERSION,
        core_version: coreVersion || undefined,
        modules:     modules || undefined,
      }),
    });
  } catch { /* сеть недоступна — не критично */ }
}