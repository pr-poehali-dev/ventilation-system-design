const LICENSE_URL = "https://functions.poehali.dev/a1965362-df5e-40d6-ab62-0b523b49b023";
const STORAGE_KEY = "pvs_license";
const HW_FP_KEY   = "pvs_hw_fp";      // кэш аппаратного fingerprint
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

export interface LicenseInfo {
  licensed: boolean;
  key?: string;
  owner?: string;
  seats?: { max: number; used: number };
  checkedAt?: number;
}

// ── Информация о рабочем месте ────────────────────────────────────────────────
export interface MachineInfo {
  fingerprint: string;   // SHA-256 стабильных характеристик ПК
  hostname: string;      // navigator.userAgent краткий вариант
  platform: string;      // OS + архитектура
  screen: string;        // разрешение экрана
}

// ── Вычисление SHA-256 через Web Crypto API ───────────────────────────────────
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Определение ОС/платформы ──────────────────────────────────────────────────
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

// ── Стабильные характеристики ПК (не зависят от localStorage) ────────────────
// Используем: разрешение + глубина цвета + часовой пояс + язык + CPU cores + платформа
// + Canvas fingerprint (рендеринг текста — стабилен для одной видеокарты/драйвера/ОС)
async function getHardwareComponents(): Promise<string[]> {
  const components: string[] = [
    // Экран
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    // Часовой пояс
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Язык браузера
    navigator.language,
    // Количество логических процессоров
    String(navigator.hardwareConcurrency ?? 0),
    // Платформа
    detectPlatform(),
    // Память (если доступна)
    String((navigator as { deviceMemory?: number }).deviceMemory ?? 0),
  ];

  // Canvas fingerprint — стабилен для одной GPU/драйвера/ОС
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.font = "14px Arial";
      ctx.fillText("PVS-fingerprint", 2, 15);
      ctx.fillStyle = "rgba(102,204,0,0.7)";
      ctx.font = "18px Georgia";
      ctx.fillText("PVS-fingerprint", 4, 30);
      components.push(canvas.toDataURL().slice(-50)); // последние 50 символов
    }
  } catch { /* ignore */ }

  // WebGL renderer — очень стабилен для конкретного железа
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (gl) {
      const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbgInfo) {
        const renderer = gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) as string;
        const vendor   = gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL) as string;
        components.push(`${vendor}|${renderer}`);
      }
    }
  } catch { /* ignore */ }

  return components;
}

// ── Генерация стабильного аппаратного fingerprint ─────────────────────────────
// Кэшируется в sessionStorage (в рамках сессии) + localStorage (между сессиями).
// При переустановке приложения — fingerprint НЕ изменится, т.к. зависит от железа.
export async function getMachineInfo(): Promise<MachineInfo> {
  // Проверяем кэш (localStorage для персистентности)
  try {
    const cached = localStorage.getItem(HW_FP_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as MachineInfo & { cachedAt: number };
      // Кэш аппаратного fingerprint живёт 30 дней
      if (Date.now() - (parsed.cachedAt ?? 0) < 30 * 24 * 3600 * 1000) {
        return { fingerprint: parsed.fingerprint, hostname: parsed.hostname,
                 platform: parsed.platform, screen: parsed.screen };
      }
    }
  } catch { /* ignore */ }

  const components = await getHardwareComponents();
  const raw = components.join("||");
  const fingerprint = await sha256hex(raw);

  const platform = detectPlatform();
  const screen   = `${window.screen.width}×${window.screen.height}`;

  // hostname — краткое описание машины из UA (браузер + ОС)
  const ua = navigator.userAgent;
  const browser = ua.includes("Chrome") && !ua.includes("Edg") ? "Chrome"
    : ua.includes("Firefox") ? "Firefox"
    : ua.includes("Safari") && !ua.includes("Chrome") ? "Safari"
    : ua.includes("Edg") ? "Edge" : "Browser";
  const hostname = `${browser} / ${platform}`;

  const info: MachineInfo = { fingerprint, hostname, platform, screen };

  // Сохраняем в кэш
  try {
    localStorage.setItem(HW_FP_KEY, JSON.stringify({ ...info, cachedAt: Date.now() }));
  } catch { /* ignore */ }

  return info;
}

// ── Загрузить кэш из localStorage ────────────────────────────────────────────
export function loadCachedLicense(): LicenseInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as LicenseInfo & { checkedAt?: number };
    const age = Date.now() - (data.checkedAt ?? 0);
    if (age > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(info: LicenseInfo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...info, checkedAt: Date.now() }));
  } catch { /* ignore */ }
}

export function clearLicenseCache() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// ── Проверить machine ID на сервере ──────────────────────────────────────────
export async function checkLicense(fingerprint: string, machineInfo?: MachineInfo): Promise<LicenseInfo> {
  const res = await fetch(LICENSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "check",
      fingerprint,
      hostname: machineInfo?.hostname,
      platform: machineInfo?.platform,
      screen_info: machineInfo?.screen,
    }),
  });
  const data = await res.json();
  const info: LicenseInfo = {
    licensed: !!data.licensed,
    key: data.key,
    owner: data.owner,
    seats: data.seats,
  };
  saveCache(info);
  return info;
}

// ── Активировать лицензионный ключ ────────────────────────────────────────────
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
      key,
      hostname: machineInfo?.hostname,
      platform: machineInfo?.platform,
      screen_info: machineInfo?.screen,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msgs: Record<string, string> = {
      key_not_found: "Ключ не найден",
      invalid_key_format: "Неверный формат ключа (PVS-XXXX-XXXX-XXXX-XXXX)",
      license_disabled: "Лицензия отозвана",
      license_expired: "Срок лицензии истёк",
      seats_exhausted: `Все ${data.max_seats ?? 5} рабочих мест заняты`,
    };
    throw new Error(msgs[data.error] ?? "Ошибка активации");
  }
  const info: LicenseInfo = {
    licensed: true,
    key: data.key,
    owner: data.owner,
    seats: data.seats,
  };
  saveCache(info);
  return info;
}
