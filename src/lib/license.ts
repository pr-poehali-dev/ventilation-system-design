const LICENSE_URL = "https://functions.poehali.dev/a1965362-df5e-40d6-ab62-0b523b49b023";
const STORAGE_KEY = "pvs_license";
const MACHINE_ID_KEY = "pvs_machine_id";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

export interface LicenseInfo {
  licensed: boolean;
  key?: string;
  owner?: string;
  seats?: { max: number; used: number };
  checkedAt?: number;
}

// ── Стабильный Machine ID ─────────────────────────────────────────────────────
// Генерируется один раз и навсегда хранится в localStorage.
// Не зависит от браузера, разрешения, обновлений — пока не очищен localStorage.
export function getMachineId(): string {
  try {
    const existing = localStorage.getItem(MACHINE_ID_KEY);
    if (existing && existing.length === 64) return existing;
    // Генерируем новый: случайные байты + хэш
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const id = Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(MACHINE_ID_KEY, id);
    return id;
  } catch {
    // Fallback если localStorage недоступен
    return "fallback-" + Math.random().toString(36).slice(2);
  }
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
export async function checkLicense(fingerprint: string): Promise<LicenseInfo> {
  const res = await fetch(LICENSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "check", fingerprint }),
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
export async function activateLicense(fingerprint: string, key: string): Promise<LicenseInfo> {
  const res = await fetch(LICENSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "activate", fingerprint, key }),
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
