import { API_URLS } from "@/lib/api-urls";
import { APP_VERSION } from "@/lib/appVersion";
import { isOfflineKey, verifyOfflineKey, saveOfflineKey, loadOfflineKey, clearOfflineKey } from "@/lib/offlineKey";
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
    const res = await fetchLocal("/api/status", { cache: "no-store" });
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
// Версия формулы отпечатка. Увеличивается при изменении состава характеристик,
// чтобы кэш, посчитанный по прежней формуле, не использовался после обновления.
// v2 — отпечаток без браузерозависимых характеристик (один ПК = одно место
// во всех браузерах).
const FP_VERSION = 2;

const IS_DESKTOP = !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;

// ── Запрос к локальному ядру с ограничением времени ──────────────────────────
// Локальное ядро (server.exe) запускается рядом с окном программы и обычно
// отвечает мгновенно. Но если оно ещё догружается или не поднялось вовсе,
// запрос без ограничения висел бы неопределённо долго и задерживал запуск.
// Две секунды с запасом хватает для локального обращения.
async function fetchLocal(url: string, init?: RequestInit, timeoutMs = 2000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
      // Ограничение по времени: локальное ядро могло ещё не подняться.
      // Без него запуск ждал бы ответа неопределённо долго.
      const res = await fetchLocal("/api/license-store", { cache: "no-store" });
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
  emergency?: boolean;     // true — активирован аварийный оффлайн-ключ (без интернета)
}

export interface MachineInfo {
  fingerprint: string;    // SHA-256(UUID + железо) — точный, меняется при сбросе PWA
  hwFingerprint: string;  // SHA-256(только железо) — выживает после переустановки PWA/ОС
  /**
   * Отпечаток по СТАРОЙ (браузерозависимой) формуле. Передаётся на сервер, пока
   * не все рабочие места перешли на новую: по нему находится ранее
   * активированное место и перепривязывается к новому отпечатку — без
   * повторного ввода ключа и без расхода лишнего места.
   */
  legacyHwFingerprint?: string;
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

// ── Семейство ОС (грубо) ─────────────────────────────────────────────────────
// Только Windows/macOS/Linux/Android/iOS, БЕЗ версии. Версию Windows разные
// браузеры сообщают по-разному (Chrome «замораживает» её в User-Agent), поэтому
// в отпечаток она не годится.
function detectOsFamily(): string {
  const p = detectPlatform();
  if (p.startsWith("Windows")) return "Windows";
  return p;
}

// ── Аппаратные компоненты (без UUID) ─────────────────────────────────────────
// Эти данные НЕ зависят от localStorage — выживают после переустановки PWA.
// Используются как hw_fingerprint для восстановления лицензии после переустановки.
//
// ВАЖНО: здесь допустимы ТОЛЬКО характеристики самого компьютера, одинаковые во
// всех браузерах на нём. Раньше сюда входили значения, которые у каждого
// браузера свои, из-за чего Chrome, Firefox и Edge на одном ПК давали РАЗНЫЕ
// отпечатки: программа требовала ключ заново в каждом браузере и занимала
// отдельное рабочее место. Исключены:
//   • deviceMemory — сообщает только Chrome, у Firefox/Safari его нет;
//   • hardwareConcurrency — Firefox в режиме защиты от слежки занижает;
//   • navigator.language — «ru» против «ru-RU» в разных браузерах;
//   • версия Windows — Chrome «замораживает» её в User-Agent.
function getHwComponents(): string[] {
  return [
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    detectOsFamily(),
  ];
}

// Прежний (браузерозависимый) состав отпечатка. Нужен ТОЛЬКО для переноса уже
// активированных мест: по нему сервер находит старую запись и перепривязывает
// её к новому отпечатку, чтобы человеку не пришлось вводить ключ заново и не
// расходовалось лишнее рабочее место.
function getLegacyHwComponents(): string[] {
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
  // Локальное ядро (server.exe) может ещё догружаться после старта окна.
  // Один неудачный запрос раньше означал machineId = "" → отпечаток считался
  // по браузерным характеристикам и НЕ совпадал с уже занятым местом: программа
  // требовала активацию заново. Поэтому повторяем попытки ~3 секунды.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetchLocal("/api/machine", { cache: "no-store" });
      const data = await res.json();
      const machineId = data?.machineId ? String(data.machineId) : "";
      if (machineId) {
        return { machineId, hostname: data?.hostname ? String(data.hostname) : "" };
      }
    } catch { /* ядро ещё не поднялось — пробуем снова */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { machineId: "", hostname: "" };
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
      const parsed = JSON.parse(cached) as MachineInfo & { cachedAt: number; fpVersion?: number };
      // fpVersion: помечает, по какой формуле посчитан кэш. Кэш старой версии
      // (без метки) игнорируем — иначе после обновления программы отпечаток
      // ещё 30 дней оставался бы браузерозависимым и ключ по-прежнему
      // спрашивался бы в каждом браузере.
      const fresh = Date.now() - (parsed.cachedAt ?? 0) < 30 * 24 * 3600 * 1000;
      if (fresh && parsed.hwFingerprint && parsed.fpVersion === FP_VERSION) {
        return { fingerprint: parsed.fingerprint, hwFingerprint: parsed.hwFingerprint,
                 legacyHwFingerprint: parsed.legacyHwFingerprint,
                 hostname: parsed.hostname, platform: parsed.platform, screen: parsed.screen };
      }
    }
  } catch { /* ignore */ }

  const { machineId, hostname: pcName } = await getDesktopMachine();

  // Основа отпечатка: в десктопе — настоящий machine-id ОС; иначе — браузерное железо.
  // В десктопе отпечаток строим ТОЛЬКО из machine-id ОС. Раньше к нему
  // подмешивались браузерные характеристики (разрешение экрана, число ядер,
  // объём памяти, таймзона) — из-за этого подключение второго монитора, смена
  // разрешения, поездка в другой часовой пояс или апгрейд ОЗУ меняли отпечаток.
  // Программа считала это новым компьютером, занимала ещё одно рабочее место и
  // в итоге отказывала в активации: «места кончились».
  const hwComponents = machineId
    ? [`mid:${machineId}`]
    : getHwComponents();
  const hwFingerprint = await sha256hex(hwComponents.join("||"));

  // Отпечаток по ПРЕЖНЕЙ формуле — только для веба и только чтобы сервер смог
  // опознать уже активированное место и перенести его на новый отпечаток.
  // В десктопе отпечаток и раньше строился из machine-id, переносить нечего.
  const legacyHwFingerprint = machineId
    ? undefined
    : await sha256hex(getLegacyHwComponents().join("||"));

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

  const info: MachineInfo = {
    fingerprint, hwFingerprint, legacyHwFingerprint, hostname, platform, screen: scr,
  };

  // В десктопе НЕ кэшируем отпечаток, посчитанный без machine-id (ядро не
  // ответило): иначе временный сбой запомнился бы на 30 дней и всё это время
  // программа считала бы ПК другим компьютером.
  const trustworthy = !IS_DESKTOP || !!machineId;
  if (trustworthy) {
    try {
      storage.set(HW_FP_KEY, JSON.stringify({ ...info, cachedAt: Date.now(), fpVersion: FP_VERSION }));
    } catch { /* ignore */ }
  }

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
    clearOfflineKey();
  } catch { /* ignore */ }
}

// ── Аварийный оффлайн-ключ ────────────────────────────────────────────────────
// Проверяет сохранённый аварийный ключ (локально, без интернета). Возвращает
// действующую лицензию, если ключ валиден и не истёк. Используется как резерв,
// когда сервер лицензий недоступен (нет связи на руднике/ВГСЧ).
export function checkOfflineEmergency(): LicenseInfo | null {
  const loaded = loadOfflineKey();
  if (!loaded) return null;
  const { key, info } = loaded;
  if (!info.valid) {
    if (info.expired) return { licensed: false, emergency: true, offlineExpired: true, daysLeft: 0 };
    return null;
  }
  return {
    licensed: true,
    emergency: true,
    key,
    owner: info.org,
    daysLeft: info.daysLeft,
  };
}

export function clearFingerprintCache() {
  try { storage.remove(HW_FP_KEY); } catch { /* ignore */ }
}

// ── Проверка лицензии ─────────────────────────────────────────────────────────
// Ограничение времени ожидания ответа.
//
// ЗАЧЕМ: на руднике и в ВГСЧ интернета часто нет. Раньше запрос ждал ответа
// без ограничения (а в десктопе локальное ядро держало соединение до 30 секунд),
// и запуск программы «подвисал» на полминуты — хотя лицензия сохранена на диске
// и действует. Теперь ждём несколько секунд и уходим на сохранённую лицензию.
//
// В десктопе ограничение жёстче: там запрос идёт через локальное ядро, которое
// само ретранслирует его в облако, и «подвисание» ощущается как зависание окна.
const CHECK_TIMEOUT_MS = IS_DESKTOP ? 4000 : 8000;

export async function checkLicense(fingerprint: string, machineInfo?: MachineInfo): Promise<LicenseInfo> {
  const coreVersion = await getCoreVersion();
  // AbortController обрывает ожидание, если ответа нет в отведённое время.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(LICENSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        action: "check",
        fingerprint,
        hw_fingerprint: machineInfo?.hwFingerprint,
        legacy_hw_fingerprint: machineInfo?.legacyHwFingerprint,
        hostname:    machineInfo?.hostname,
        platform:    machineInfo?.platform,
        screen_info: machineInfo?.screen,
        app_version: APP_VERSION,
        core_version: coreVersion || undefined,
        is_desktop: IS_DESKTOP,
      }),
    });
  } finally {
    clearTimeout(timer);
  }
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
  // Аварийный оффлайн-ключ: распознаём по префиксу и проверяем ЛОКАЛЬНО,
  // без обращения к серверу (работает без интернета — рудник/ВГСЧ).
  if (isOfflineKey(key)) {
    const v = verifyOfflineKey(key);
    if (!v.valid) {
      const msgs: Record<string, string> = {
        bad_format:    "Неверный формат аварийного ключа",
        bad_signature: "Аварийный ключ повреждён или поддельный",
        expired:       "Срок аварийного ключа истёк",
        no_expiry:     "В аварийном ключе не указан срок",
      };
      throw new Error(msgs[v.reason ?? ""] ?? "Аварийный ключ недействителен");
    }
    saveOfflineKey(key.trim());
    const info: LicenseInfo = {
      licensed: true,
      emergency: true,
      key: key.trim(),
      owner: v.org,
      daysLeft: v.daysLeft,
    };
    saveCache(info);
    return info;
  }

  const coreVersion = await getCoreVersion();
  const res = await fetch(LICENSE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "activate",
      fingerprint,
      hw_fingerprint: machineInfo?.hwFingerprint,
      legacy_hw_fingerprint: machineInfo?.legacyHwFingerprint,
      key,
      hostname:    machineInfo?.hostname,
      platform:    machineInfo?.platform,
      screen_info: machineInfo?.screen,
      app_version: APP_VERSION,
      core_version: coreVersion || undefined,
      is_desktop: IS_DESKTOP,
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