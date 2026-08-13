// ─────────────────────────────────────────────────────────────────────────────
// cadCompute.ts — обращение к расчётному ядру и общие числовые хелперы
// страницы CAD.
//
// Вынесено из Cad.tsx БЕЗ изменений логики: те же имена, комментарии,
// лимиты кэша, порог сжатия и порядок действий.
// ─────────────────────────────────────────────────────────────────────────────
import { API_URLS } from "@/lib/api-urls";
import { postCompute } from "@/lib/computeServer";

export const AIRFLOW_URL      = API_URLS.airflow;
export const EXPLOSION_URL    = API_URLS.explosionCalculator;
export const WATER_URL        = API_URLS.waterHydraulics;

// Безопасное форматирование числа: не роняет рендер на NaN/undefined/Infinity.
export const safeFixed = (v: unknown, digits = 1): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
};


// ─── Память расчётов ядра (общая для всех видов расчёта) ─────────────────────
// Расчёт пожара и проверка устойчивости проветривания устроены итерационно:
// внутри одного нажатия кнопки сеть пересчитывается несколько раз подряд, а
// раунды нередко повторяются с ТЕМИ ЖЕ исходными данными — когда сценарий уже
// сошёлся и его параметры между раундами перестали меняться. Такие повторы
// раньше уходили на сервер и считались заново.
//
// Память живёт на уровне отправки запроса, поэтому одинаково работает для всех
// расчётов: воздухораспределение (F9), пожар, устойчивость, батч-сценарии.
//
// Ограничения сделаны намеренно:
//   • храним последние 24 ответа — этого хватает на раунды одного расчёта,
//     при этом память не растёт бесконечно на больших схемах;
//   • ключ = полное тело запроса, поэтому любое изменение данных (сопротивление,
//     температура, депрессия пожара, метод, допуски) даёт новый расчёт;
//   • ошибочные ответы не запоминаются — см. postAirflow ниже.
const AIRFLOW_CACHE_LIMIT = 24;
const airflowCache = new Map<string, string>();

/** Сбрасывает память расчётов (вызывается при загрузке другого проекта). */
export function clearAirflowCache(): void {
  airflowCache.clear();
}

/** Есть ли готовый результат для такого запроса (для пояснения в журнале). */
export function wasAirflowCached(body: unknown): boolean {
  return airflowCache.has(JSON.stringify(body));
}

// Отправка запроса на расчёт воздухораспределения. Большие схемы (тысячи
// ветвей) весят несколько МБ и упираются в лимит размера тела запроса —
// поэтому крупный JSON сжимаем gzip прямо в браузере (CompressionStream).
//
// ВАЖНО: сжатое тело передаём НЕ бинарно и НЕ через заголовок
// Content-Encoding: gzip. И то, и другое ненадёжно — прокси/шлюз (особенно
// десктопный WebView2/C#) может распаковать тело сам, потерять заголовок или
// «испортить» бинарные байты, и функция получала мусор → «Ошибка парсинга
// JSON» на схемах >2000 ветвей.
//
// Надёжный транспорт: gzip → base64 → кладём строкой в обычный JSON-конверт
// {"__gzip__": "<base64>"}. Content-Type остаётся application/json, тело —
// чистый текст, который ни один прокси не трогает. Бэкенд первым делом
// распознаёт конверт и распаковывает.
export async function postAirflow(body: unknown): Promise<Response> {
  const json = JSON.stringify(body);

  // Точно такой же запрос уже считался — отдаём сохранённый ответ.
  // Возвращаем новый Response, т.к. тело ответа читается только один раз.
  const hit = airflowCache.get(json);
  if (hit !== undefined) {
    return new Response(hit, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const canGzip = typeof (globalThis as { CompressionStream?: unknown }).CompressionStream !== "undefined";
  // Готовим финальное тело запроса (со сжатием для крупных схем > 512 КБ).
  let payload = json;
  if (canGzip && json.length > 512_000) {
    try {
      const stream = new Response(json).body!.pipeThrough(
        new CompressionStream("gzip"),
      );
      const gzBuf = await new Response(stream).arrayBuffer();
      // Uint8Array → base64 порциями (btoa не принимает большие строки целиком)
      const bytes = new Uint8Array(gzBuf);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      payload = JSON.stringify({ __gzip__: btoa(bin) });
    } catch {
      payload = json;
    }
  }
  // Отправка на активный расчётный сервер с аварийным failover на резерв
  // (переключается администратором либо автоматически при исчерпании лимита).
  const { response } = await postCompute((url) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }),
  );

  // Успешный расчёт запоминаем. Ошибки (в т.ч. «error» в теле ответа) НЕ
  // сохраняем: повторная попытка должна честно уйти на сервер.
  // Тело читаем в текст и отдаём копию — исходный Response одноразовый.
  if (response.ok) {
    try {
      const text = await response.clone().text();
      if (!text.includes('"error"')) {
        if (airflowCache.size >= AIRFLOW_CACHE_LIMIT) {
          // Вытесняем самую старую запись (Map хранит порядок вставки).
          const oldest = airflowCache.keys().next().value;
          if (oldest !== undefined) airflowCache.delete(oldest);
        }
        airflowCache.set(json, text);
      }
    } catch { /* не смогли прочитать — просто не запоминаем */ }
  }

  return response;
}
