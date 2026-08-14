// ─────────────────────────────────────────────────────────────────────────────
// ventPipeCalc.ts — расчёт вентиляционного става при ВМП (нагнетательная схема).
//
// ЗАЧЕМ ЭТО НУЖНО.
// Вентилятор местного проветривания (ВМП) стоит в устье тупиковой выработки и
// гонит воздух в забой по гибкому рукаву (ставу). По дороге часть воздуха
// теряется — через стыки звеньев и через саму мембрану. Поэтому в забой
// приходит МЕНЬШЕ, чем даёт вентилятор:
//
//     Q_вент (у вентилятора)  →  утечки по длине  →  Q_забой (в забое)
//
// Отношение Q_забой / Q_вент называется КОЭФФИЦИЕНТОМ ДОСТАВКИ ВОЗДУХА (Kу.т).
// Именно он отвечает на главный вопрос: на какую длину хватит става, чтобы в
// забой пришло требуемое по газу/людям/ВВ количество воздуха.
//
// СХЕМА — ТОЛЬКО НАГНЕТАТЕЛЬНАЯ. Вентилятор нагнетает свежий воздух по ставу
// в забой, отработанный выходит по выработке. Всасывающая и комбинированная
// схемы считаются иначе (там утечки работают на подсос) и здесь не поддержаны.
//
// ЕДИНИЦЫ. Сопротивление R по всему проекту хранится в кМюрг (кгс·с²/м⁸),
// поэтому R·Q² даёт мм вод. ст., а не паскали — перевод делает depression().
// ─────────────────────────────────────────────────────────────────────────────
import { resistanceFromPipe, depression } from "@/lib/aerodynamics";

/**
 * Методика расчёта утечек воздуха в ставе.
 *
 * • "passport" — по паспорту рукава. Изготовитель указывает удельные потери
 *   на 100 м става (для KolaVent Flex AS это 1,2 %). Утечки нарастают по длине
 *   геометрически: каждые следующие 100 м теряют свой процент от того, что до
 *   них дошло. Метод простой и точный для нового рукава известной марки.
 *
 * • "normative" — по нормативной формуле коэффициента доставки воздуха
 *   (Руководство по проектированию вентиляции угольных шахт). Утечки
 *   выражаются через удельный стыковой расход, длину звена, диаметр и
 *   сопротивление става. Метод учитывает, что утечка зависит от ДАВЛЕНИЯ в
 *   ставе: чем длиннее став, тем выше давление у вентилятора и тем сильнее
 *   «продавливает» воздух через стыки. Подходит, когда марка рукава неизвестна
 *   или став собран в шахте из разнородных звеньев.
 *
 * Какая методика строже — зависит от данных: у нового рукава с хорошим
 * паспортом строже обычно паспортная, у става с плохими стыками — нормативная.
 * Инженер выбирает ту, которой доверяет, и может сравнить обе.
 */
export type VpLeakMethod = "passport" | "normative";

/** Исходные данные для расчёта става */
export interface VentPipeInput {
  /** Методика расчёта утечек */
  method: VpLeakMethod;
  /** Внутренний диаметр рукава, мм */
  diameter: number;
  /** Длина става, м */
  length: number;
  /** Коэффициент α трубопровода, ×10⁻⁴ Н·с²/м⁴ */
  alpha: number;
  /** Паспортные потери на 100 м става, % (для метода "passport") */
  lossPer100m: number;
  /** Длина одного звена рукава, м (для метода "normative") */
  linkLength: number;
  /** Удельный стыковой расход k_ст, м³/(с·даПа^0,5) — качество сборки стыков.
   *  0 или не задан = 0,003 (рукав с внутренними кольцами, обычная сборка). */
  jointLeakK?: number;
  /** Количество стыков на ставе */
  jointCount: number;
  /** Сумма коэффициентов местных сопротивлений ξ (повороты, фасонины) */
  localXi: number;
  /** Расход воздуха, подаваемый вентилятором в став, м³/с */
  fanFlow: number;
  /** Плотность воздуха, кг/м³ (по умолчанию 1.2) */
  density?: number;
}

/** Результат расчёта става */
export interface VentPipeResult {
  /** Аэродинамическое сопротивление става, кМюрг (Н·с²/м⁸ ×10⁻⁴) */
  R: number;
  /** Площадь сечения рукава, м² */
  area: number;
  /** Коэффициент доставки воздуха Kу.т = Q_забой / Q_вент (0..1) */
  delivery: number;
  /** Расход воздуха у вентилятора (вход в став), м³/с */
  flowFan: number;
  /** Расход воздуха в забое (выход из става), м³/с */
  flowFace: number;
  /** Утечки воздуха по длине става, м³/с */
  leakage: number;
  /** Утечки в процентах от подачи вентилятора, % */
  leakagePercent: number;
  /** Средняя скорость воздуха в ставе, м/с */
  velocity: number;
  /** Потери давления в ставе (депрессия става), Па */
  deltaP: number;
  /** Скорость воздуха на выходе в забой, м/с */
  velocityFace: number;
}

/** Плотность воздуха по умолчанию, кг/м³ */
const RHO_DEFAULT = 1.2;

/**
 * Площадь сечения круглого рукава по внутреннему диаметру в мм.
 */
export function ductArea(diameterMm: number): number {
  const d = diameterMm / 1000;
  return d > 0 ? (Math.PI * d * d) / 4 : 0;
}

/**
 * Аэродинамическое сопротивление става, кМюрг.
 *
 * Формула горной аэродинамики: R = 6.48 · α · L / D⁵
 *   α — коэффициент аэродинамического сопротивления, ×10⁻⁴ Н·с²/м⁴
 *   L — длина става, м
 *   D — внутренний диаметр, м
 *
 * Стыки увеличивают шероховатость: каждый стык добавляет 2 % к α.
 * Местные сопротивления (повороты, переходы) добавляются отдельным слагаемым
 * R_мест = ξ · ρ / (2 · S²).
 */
export function ductResistance(
  alpha: number,
  length: number,
  diameterMm: number,
  jointCount: number,
  localXi: number,
  density: number = RHO_DEFAULT,
): number {
  const D = diameterMm / 1000;
  if (D <= 0 || length <= 0) return 0;

  // Стыки ухудшают гладкость рукава: +2 % к α за каждый стык.
  const effAlpha = alpha * (1 + Math.max(0, jointCount) * 0.02);

  // Сопротивление по длине, кМюрг — общая формула проекта R = 6.48·α·L/D⁵.
  const rFriction = resistanceFromPipe(effAlpha, length, D);

  // Местные сопротивления: R = ξ·ρ/(2·S²) даёт Н·с²/м⁸, а R по проекту
  // хранится в кМюрг (кгс·с²/м⁸) — делим на 9,81, чтобы единицы совпали.
  const S = ductArea(diameterMm);
  const rLocal = S > 0 ? (localXi * density) / (2 * S * S) / 9.81 : 0;

  const total = rFriction + rLocal;
  return isFinite(total) ? Math.min(total, 1e6) : 0;
}

/**
 * Коэффициент доставки воздуха ПО ПАСПОРТУ рукава.
 *
 * Изготовитель даёт потери p % на каждые 100 м става. Утечки нарастают
 * геометрически: на первых 100 м теряется p % от подачи вентилятора, на
 * вторых — p % от ОСТАВШЕГОСЯ, и так далее. Отсюда:
 *
 *     Kу.т = (1 − p/100) ^ (L/100)
 *
 * Например, при p = 1,2 % и L = 500 м: Kу.т = 0.988⁵ ≈ 0.941 → в забой
 * приходит 94 % воздуха.
 */
export function deliveryByPassport(lossPer100m: number, length: number): number {
  if (length <= 0) return 1;
  const p = Math.max(0, Math.min(99, lossPer100m)) / 100;
  const k = Math.pow(1 - p, length / 100);
  return Math.max(0.01, Math.min(1, k));
}

/**
 * Коэффициент доставки воздуха ПО НОРМАТИВНОЙ ФОРМУЛЕ.
 *
 * Нормативная методика (Руководство по проектированию вентиляции шахт)
 * рассчитывает утечки через стыки звеньев с учётом ДАВЛЕНИЯ в ставе:
 *
 *     Kу.т = 1 / (1 + (k_ст · √(R_ст) · L) / (3 · l_зв · √D) )²
 *
 * где
 *   k_ст   — удельный стыковой расход (для рукавов с внутренними кольцами
 *            принимается 0,003 м³/(с·даПа^0,5) на один стык);
 *   R_ст   — аэродинамическое сопротивление става, кМюрг;
 *   L      — длина става, м;
 *   l_зв   — длина одного звена рукава, м;
 *   D      — диаметр става, м.
 *
 * Физический смысл: утечка через стык пропорциональна корню из давления, а
 * давление в ставе растёт вместе с его сопротивлением и длиной. Поэтому с
 * ростом длины доставка падает быстрее, чем по паспортной методике — это
 * запасной (осторожный) вариант расчёта.
 */
export function deliveryByNormative(
  R: number,
  length: number,
  diameterMm: number,
  linkLength: number,
  jointLeakK?: number,
): number {
  const D = diameterMm / 1000;
  const l = linkLength > 0 ? linkLength : 20;
  if (length <= 0 || D <= 0 || R <= 0) return 1;

  // Удельный стыковой расход. По умолчанию 0,003 — гибкий рукав с внутренними
  // кольцами при обычной сборке. Плохо затянутые стыки, изношенный или
  // латаный рукав — больше (до 0,01); тщательная сборка нового — меньше.
  const kSt = (jointLeakK ?? 0) > 0 ? jointLeakK! : 0.003;

  const denom = 3 * l * Math.sqrt(D);
  if (denom <= 0) return 1;

  const x = (kSt * Math.sqrt(R) * length) / denom;
  const k = 1 / Math.pow(1 + x, 2);
  return Math.max(0.01, Math.min(1, k));
}

/**
 * Полный расчёт вентиляционного става (нагнетательная схема).
 *
 * Возвращает сопротивление, коэффициент доставки, расход в забое, утечки,
 * скорость и депрессию става.
 */
export function calcVentPipe(input: VentPipeInput): VentPipeResult {
  const rho = input.density ?? RHO_DEFAULT;
  const area = ductArea(input.diameter);

  const R = ductResistance(
    input.alpha,
    input.length,
    input.diameter,
    input.jointCount,
    input.localXi,
    rho,
  );

  const delivery = input.method === "normative"
    ? deliveryByNormative(R, input.length, input.diameter, input.linkLength, input.jointLeakK)
    : deliveryByPassport(input.lossPer100m, input.length);

  const flowFan = Math.max(0, input.fanFlow);
  const flowFace = flowFan * delivery;
  const leakage = flowFan - flowFace;

  // Депрессия става считается по СРЕДНЕМУ расходу: у вентилятора расход
  // максимальный, у забоя — минимальный, воздух утекает постепенно.
  // Использовать полную подачу вентилятора было бы завышением, а расход
  // забоя — занижением потерь.
  const qAvg = (flowFan + flowFace) / 2;
  // Депрессия ΔP = R·Q². Сопротивление хранится в кМюрг (кгс·с²/м⁸), поэтому
  // произведение R·Q² выходит в мм вод. ст. — умножаем на 9,81, чтобы
  // получить паскали. Те же единицы, что у напора вентилятора.
  const deltaP = depression(R, qAvg);

  const velocity = area > 0 ? qAvg / area : 0;
  const velocityFace = area > 0 ? flowFace / area : 0;

  return {
    R,
    area,
    delivery,
    flowFan,
    flowFace,
    leakage,
    leakagePercent: flowFan > 0 ? (leakage / flowFan) * 100 : 0,
    velocity,
    deltaP,
    velocityFace,
  };
}

/** Результат расчёта предельной длины става */
export interface VentPipeLimitResult {
  /** Предельная длина става, м (0 = требуемый расход недостижим даже вблизи) */
  maxLength: number;
  /** Ограничение, которое сработало первым */
  limitedBy: "flow" | "pressure" | "none";
  /** Расход в забое на предельной длине, м³/с */
  flowAtLimit: number;
  /** Депрессия става на предельной длине, Па */
  deltaPAtLimit: number;
  /** Запас длины относительно текущей, м (отрицательный = став уже длиннее) */
  reserve: number;
}

/**
 * ОБРАТНАЯ ЗАДАЧА: на какую максимальную длину хватит става?
 *
 * Задаём требуемый расход в забое (по газу, людям, взрывным работам) и ищем
 * длину, при которой воздуха ещё хватает. С ростом длины одновременно:
 *   • растут утечки → в забой приходит меньше воздуха;
 *   • растёт сопротивление → нужен больший напор вентилятора.
 *
 * Поэтому проверяются ДВА ограничения, и берётся то, что наступит раньше:
 *   1. по расходу   — в забое должно быть не меньше требуемого;
 *   2. по давлению  — депрессия става не должна превышать напор вентилятора
 *                     (и паспортное рабочее давление рукава).
 *
 * Ищем методом половинного деления: обе величины монотонно ухудшаются с
 * длиной, поэтому решение единственное.
 */
export function calcVentPipeMaxLength(
  input: Omit<VentPipeInput, "length">,
  requiredFaceFlow: number,
  maxPressure: number,
  currentLength: number,
  searchLimit: number = 5000,
): VentPipeLimitResult {
  /** Проверяет, годится ли став длиной L: хватает и воздуха, и давления */
  const check = (L: number): { okFlow: boolean; okPressure: boolean; res: VentPipeResult } => {
    const res = calcVentPipe({ ...input, length: L });
    return {
      okFlow: res.flowFace >= requiredFaceFlow,
      okPressure: maxPressure <= 0 || res.deltaP <= maxPressure,
      res,
    };
  };

  // Проверяем минимальную длину: если даже 1 м не проходит — задача нерешаема
  // (вентилятор слаб или требование завышено).
  const atMin = check(1);
  if (!atMin.okFlow || !atMin.okPressure) {
    return {
      maxLength: 0,
      limitedBy: !atMin.okFlow ? "flow" : "pressure",
      flowAtLimit: atMin.res.flowFace,
      deltaPAtLimit: atMin.res.deltaP,
      reserve: -currentLength,
    };
  }

  // Проверяем верхнюю границу поиска: если и там всё хорошо — ограничения нет.
  const atMax = check(searchLimit);
  if (atMax.okFlow && atMax.okPressure) {
    return {
      maxLength: searchLimit,
      limitedBy: "none",
      flowAtLimit: atMax.res.flowFace,
      deltaPAtLimit: atMax.res.deltaP,
      reserve: searchLimit - currentLength,
    };
  }

  // Половинное деление: lo — заведомо годная длина, hi — заведомо негодная.
  let lo = 1;
  let hi = searchLimit;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const c = check(mid);
    if (c.okFlow && c.okPressure) lo = mid; else hi = mid;
    if (hi - lo < 0.5) break;
  }

  const final = check(lo);
  // Определяем, какое ограничение сработало: смотрим чуть дальше предела.
  const beyond = check(lo + 1);
  const limitedBy: "flow" | "pressure" = !beyond.okFlow ? "flow" : "pressure";

  return {
    maxLength: lo,
    limitedBy,
    flowAtLimit: final.res.flowFace,
    deltaPAtLimit: final.res.deltaP,
    reserve: lo - currentLength,
  };
}

/**
 * Строит кривую «расход в забое от длины става» для графика.
 * Показывает пользователю, где начинается провал по воздуху.
 */
export function buildDeliveryCurve(
  input: Omit<VentPipeInput, "length">,
  maxLength: number,
  points: number = 40,
): { length: number; flowFace: number; deltaP: number }[] {
  const out: { length: number; flowFace: number; deltaP: number }[] = [];
  const step = Math.max(1, maxLength / points);
  for (let L = 0; L <= maxLength + 0.01; L += step) {
    const r = calcVentPipe({ ...input, length: Math.max(1, L) });
    out.push({ length: L, flowFace: r.flowFace, deltaP: r.deltaP });
  }
  return out;
}