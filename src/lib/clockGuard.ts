/**
 * Защита от перевода системных часов назад.
 *
 * ЗАЧЕМ. Аварийный оффлайн-ключ и сохранённая лицензия проверяются локально:
 * срок сравнивается с часами компьютера. Интернета на руднике нет, спросить
 * точное время не у кого. Поэтому достаточно было отвести дату назад — и
 * просроченный ключ снова считался действующим бессрочно.
 *
 * КАК РАБОТАЕТ. Программа запоминает САМОЕ ПОЗДНЕЕ время, которое когда-либо
 * видела («отметка максимума»), и число запусков. При старте сравнивает:
 *   • часы идут вперёд   → нормально, отметка обновляется;
 *   • часы отведены назад больше чем на сутки → лицензия не принимается,
 *     пока дату не вернут.
 *
 * ГДЕ ХРАНИТСЯ. В десктопе — не только в браузерном хранилище, но и в файле
 * рядом с программой (через локальное ядро, /api/license-store). Файл
 * переживает чистку кэша WebView2, поэтому отметку не сбросить очисткой
 * данных браузера. Восстановление файла в localStorage при запуске делает
 * storage.init() в license.ts — там же, где поднимается сама лицензия.
 *
 * ЧЕСТНАЯ ОГОВОРКА. Полная защита офлайн невозможна: при доступе к файлам
 * отметку теоретически можно найти и стереть. Задача — чтобы обход требовал
 * осознанных действий, а не одного клика по часам. От перевода даты защищает
 * полностью.
 */

const MARK_KEY = "pvs_time_mark";

// Допуск на отставание часов. Перевод даты назад «на чуть-чуть» может быть
// и обычной синхронизацией времени (NTP подтянул часы, села батарейка BIOS),
// поэтому реагируем только на заметный откат. Часовые пояса и переход на
// летнее время на это не влияют: Date.now() всегда считает от единой точки.
const ROLLBACK_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 1 сутки

interface TimeMark {
  /** Самое позднее время, которое программа когда-либо видела (мс) */
  t: number;
  /** Число запусков — растёт всегда, даже если часы не трогали */
  n: number;
  /** Контрольная сумма — чтобы случайная правка файла не осталась незамеченной */
  c: number;
}

/** Простая контрольная сумма (не криптография — защита от правки «на глаз»). */
function checksum(t: number, n: number): number {
  let h = 2166136261;
  const s = `${t}:${n}:pvs`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function readMark(): TimeMark | null {
  try {
    const raw = localStorage.getItem(MARK_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<TimeMark>;
    if (typeof m.t !== "number" || typeof m.n !== "number") return null;
    // Сумма не сошлась — файл правили вручную. Считаем отметку недействительной,
    // но НЕ блокируем работу: при первом же выходе в интернет всё встанет на место.
    if (m.c !== checksum(m.t, m.n)) return null;
    return { t: m.t, n: m.n, c: m.c };
  } catch { return null; }
}

/**
 * Записать отметку. Пишем и в браузерное хранилище, и в файл ядра (десктоп) —
 * тем же способом, что и лицензию.
 */
function writeMark(t: number, n: number): void {
  const mark: TimeMark = { t, n, c: checksum(t, n) };
  const value = JSON.stringify(mark);
  try { localStorage.setItem(MARK_KEY, value); } catch { /* ignore */ }
  const isDesktop = !!(window as Window & { __IS_DESKTOP__?: boolean }).__IS_DESKTOP__;
  if (!isDesktop) return;
  // Запись в файл — фоновая, ответа не ждём: она не должна задерживать запуск.
  try {
    fetch("/api/license-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: MARK_KEY, value }),
    }).catch(() => { /* ignore */ });
  } catch { /* ignore */ }
}

export interface ClockCheck {
  /** Часы в порядке (или отметки ещё нет — первый запуск) */
  ok: boolean;
  /** На сколько суток отведены назад (только при ok=false) */
  daysBack?: number;
  /** Самое позднее известное время (ISO) — показываем пользователю */
  lastSeen?: string;
}

/**
 * Проверить часы, НЕ изменяя отметку. Вызывается перед тем, как принять
 * локально проверенную лицензию (аварийный ключ или сохранённый кэш).
 */
export function checkClock(): ClockCheck {
  const mark = readMark();
  if (!mark) return { ok: true };           // первый запуск — сравнивать не с чем
  const now = Date.now();
  const back = mark.t - now;
  if (back > ROLLBACK_TOLERANCE_MS) {
    return {
      ok: false,
      daysBack: Math.floor(back / (24 * 60 * 60 * 1000)),
      lastSeen: new Date(mark.t).toISOString(),
    };
  }
  return { ok: true };
}

/**
 * Отметить текущий момент: сдвигает отметку вперёд, если часы ушли дальше.
 * Назад отметка не сдвигается НИКОГДА — в этом весь смысл защиты.
 * Вызывается при запуске и периодически во время работы.
 */
export function noteTimeMark(): void {
  const mark = readMark();
  const now = Date.now();
  if (!mark) { writeMark(now, 1); return; }
  const t = Math.max(mark.t, now);
  writeMark(t, mark.n + 1);
}

/**
 * Подтверждение от сервера — единственный надёжный источник времени.
 * Когда связь есть, серверу верим: отметку переставляем на текущий момент,
 * даже если она «убежала» вперёд из-за неверно выставленных часов.
 * Это же чинит ситуацию, когда человек случайно поставил дату на годы вперёд:
 * достаточно один раз запустить программу с интернетом.
 */
export function trustServerTime(serverNowMs?: number): void {
  const now = serverNowMs && serverNowMs > 0 ? serverNowMs : Date.now();
  const mark = readMark();
  writeMark(now, (mark?.n ?? 0) + 1);
}
