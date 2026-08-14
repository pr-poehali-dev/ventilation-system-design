/**
 * Выбор расчётного сервера с аварийным резервом (failover).
 *
 * Схема отказоустойчивости расчётов:
 *   1. Основной сервер (primary) — облачная функция airflow из func2url.json.
 *   2. Аварийный сервер (backup) — резервный URL, задаётся администратором
 *      в админ-панели (на случай, когда на основном аккаунте кончилось
 *      вычислительное время).
 *
 * Администратор через админ-панель может:
 *   • жёстко переключить всех на резерв (active = 'backup');
 *   • включить автопереключение (autofailover): клиент сам уходит на резерв,
 *     если основной сервер ответил ошибкой лимита/таймаутом.
 *
 * Конфигурацию клиент читает публичной функцией compute-config при старте.
 */
import { API_URLS, isDesktop } from "./api-urls";

export interface ComputeConfig {
  active: "primary" | "backup";
  backupUrl: string;
  autofailover: boolean;
}

const PRIMARY_URL = API_URLS.airflow;
const CONFIG_URL = API_URLS.computeConfig;
const CACHE_KEY = "pvs_compute_cfg";

let cfg: ComputeConfig = { active: "primary", backupUrl: "", autofailover: true };

// Флаг: основной сервер отвалился в этой сессии → временно шлём на резерв.
let primaryDown = false;

function loadCached(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      cfg = {
        active: j.active === "backup" ? "backup" : "primary",
        backupUrl: typeof j.backupUrl === "string" ? j.backupUrl : "",
        autofailover: j.autofailover !== false,
      };
    }
  } catch { /* ignore */ }
}
loadCached();

/** Подтягивает актуальную конфигурацию сервера с backend (вызывается при старте). */
export async function refreshComputeConfig(): Promise<void> {
  // В десктопе расчёт всегда идёт на локальное ядро (server.exe) — облачная
  // конфигурация резерва не применяется. Иначе на объекте без связи (рудник,
  // ВГСЧ) запрос конфигурации впустую ждал бы сеть, а админ мог бы случайно
  // увести локальный расчёт в облако.
  if (isDesktop) return;
  if (!CONFIG_URL) return;
  try {
    const res = await fetch(CONFIG_URL, { method: "GET" });
    if (!res.ok) return;
    const j = await res.json();
    cfg = {
      active: j.active === "backup" ? "backup" : "primary",
      backupUrl: typeof j.backup_url === "string" ? j.backup_url : "",
      autofailover: j.autofailover !== false,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
    // Новая конфигурация — сбрасываем метку падения, пробуем основной заново.
    primaryDown = false;
  } catch { /* оффлайн/ошибка — работаем по кэшу */ }
}

/** URL сервера, который нужно использовать прямо сейчас. */
export function activeComputeUrl(): string {
  // Десктоп — жёстко локальное ядро, без вариантов.
  if (isDesktop) return PRIMARY_URL;
  const useBackup = cfg.active === "backup" || (primaryDown && cfg.autofailover);
  if (useBackup && cfg.backupUrl) return cfg.backupUrl;
  return PRIMARY_URL;
}

/** Сейчас расчёт идёт на резервном сервере? */
export function isOnBackup(): boolean {
  if (isDesktop) return false;
  return activeComputeUrl() === cfg.backupUrl && !!cfg.backupUrl;
}

/** Ошибка означает исчерпание лимита/недоступность → стоит уйти на резерв. */
function isFailoverError(status: number): boolean {
  // 402 Payment Required — типовой код «кончился лимит»,
  // 429 — превышение квоты, 5xx — недоступность сервера.
  return status === 402 || status === 429 || status >= 500;
}

/**
 * Отправляет тело расчёта на активный сервер. При ошибке лимита/недоступности
 * основного и включённом autofailover — автоматически повторяет на резерве.
 * Возвращает {response, url} — какой сервер реально ответил.
 */
export async function postCompute(
  makeRequest: (url: string) => Promise<Response>,
): Promise<{ response: Response; url: string; usedBackup: boolean }> {
  const firstUrl = activeComputeUrl();

  // ДЕСКТОП: считаем только на локальном ядре. Никакого ухода в облако —
  // ошибка локального ядра должна показываться как ошибка, а не молча
  // отправлять данные шахты наружу (и падать там, где нет интернета).
  if (isDesktop) {
    const r = await makeRequest(firstUrl);
    return { response: r, url: firstUrl, usedBackup: false };
  }

  let response: Response;
  try {
    response = await makeRequest(firstUrl);
  } catch (err) {
    // Сетевая ошибка основного — пробуем резерв, если он есть.
    if (firstUrl === PRIMARY_URL && cfg.autofailover && cfg.backupUrl) {
      primaryDown = true;
      const r = await makeRequest(cfg.backupUrl);
      return { response: r, url: cfg.backupUrl, usedBackup: true };
    }
    throw err;
  }

  // Основной ответил ошибкой лимита → повторяем на резерве.
  if (
    firstUrl === PRIMARY_URL &&
    cfg.autofailover &&
    cfg.backupUrl &&
    isFailoverError(response.status)
  ) {
    primaryDown = true;
    const r = await makeRequest(cfg.backupUrl);
    return { response: r, url: cfg.backupUrl, usedBackup: true };
  }

  return { response, url: firstUrl, usedBackup: firstUrl === cfg.backupUrl };
}