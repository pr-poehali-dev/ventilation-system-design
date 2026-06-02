// ─────────────────────────────────────────────────────────────────────────────
// explosionCalculator.ts — Расчёт параметров воздушных ударных волн при взрывах
//
// Реализованы две методики:
//
//  1. «Методика газодинамического расчёта параметров воздушных ударных волн
//     при взрывах газа и пыли» (основная, рекомендуемая для горных выработок)
//
//  2. «ФНиП №494: Правила безопасности при производстве, хранении и применении
//     взрывчатых материалов промышленного назначения»
//
// Способы задания источника:
//   • По газу    — объём горючего газа (CH₄ или H₂) в м³, концентрация
//   • По массе   — масса взрывчатого вещества (ВВ) в кг
//
// Выходные параметры:
//   • Избыточное давление ΔP_ф (кПа) во фронте ударной волны
//   • Импульс i (Па·с)
//   • Скорость фронта D (м/с)
//   • Зоны поражения (безопасная, лёгкая, средняя, тяжёлая)
//   • Тротиловый эквивалент Q_tnt (кг ТНТ) — для единообразия методик
//
// Ориентир: Аэросеть / ВНИМИ / методика Садовского–Ефремова
// ─────────────────────────────────────────────────────────────────────────────

// ─── Константы ────────────────────────────────────────────────────────────────
const Q_TNT   = 4520;   // кДж/кг — теплота взрыва ТНТ
const P0      = 101.3;  // кПа    — атмосферное давление
const RHO_AIR = 1.2;    // кг/м³  — плотность воздуха
const C0      = 340;    // м/с    — скорость звука

// ─── Типы взрывчатых веществ (метод «по массе») ───────────────────────────────
export interface ExplosiveType {
  id: string;
  name: string;
  qSpec: number;   // кДж/кг — удельная теплота взрыва
  tntEq: number;   // коэффициент тротилового эквивалента
}

export const EXPLOSIVE_TYPES: ExplosiveType[] = [
  { id: "tnt",       name: "ТНТ",                       qSpec: 4520, tntEq: 1.00 },
  { id: "ammonit",   name: "Аммонит 6ЖВ",               qSpec: 3700, tntEq: 0.97 },
  { id: "granulite", name: "Гранулит АС-8",              qSpec: 3800, tntEq: 0.85 },
  { id: "igdanit",   name: "Игданит",                    qSpec: 3900, tntEq: 0.90 },
  { id: "anfo",      name: "ANFO",                       qSpec: 3800, tntEq: 0.82 },
  { id: "emulsion",  name: "Эмульсионное ВВ",            qSpec: 3500, tntEq: 0.80 },
  { id: "custom",    name: "Произвольное ВВ",            qSpec: 4520, tntEq: 1.00 },
];

// ─── Виды горючих газов (метод «по газу») ────────────────────────────────────
export interface GasType {
  id: string;
  name: string;
  qCombust: number;   // МДж/м³ — теплота сгорания при н.у.
  lowerLimit: number; // % — нижний концентрационный предел взрываемости
  upperLimit: number; // % — верхний концентрационный предел взрываемости
  stoichConc: number; // % — стехиометрическая концентрация
  efficiency: number; // коэффициент преобразования хим. энергии → механическая
}

export const GAS_TYPES: GasType[] = [
  { id: "methane",   name: "Метан (CH₄)",       qCombust: 33.8, lowerLimit: 5.0,  upperLimit: 15.0, stoichConc: 9.5,  efficiency: 0.08 },
  { id: "hydrogen",  name: "Водород (H₂)",       qCombust: 10.8, lowerLimit: 4.0,  upperLimit: 75.0, stoichConc: 29.5, efficiency: 0.10 },
  { id: "propane",   name: "Пропан (C₃H₈)",      qCombust: 93.2, lowerLimit: 2.1,  upperLimit: 9.5,  stoichConc: 4.0,  efficiency: 0.07 },
  { id: "acetylene", name: "Ацетилен (C₂H₂)",    qCombust: 56.0, lowerLimit: 2.5,  upperLimit: 80.0, stoichConc: 7.7,  efficiency: 0.12 },
  { id: "coal_dust", name: "Угольная пыль",       qCombust: 22.0, lowerLimit: 60.0, upperLimit: 400.0,stoichConc: 200,  efficiency: 0.05 },
];

// ─── Параметры расчёта ────────────────────────────────────────────────────────
export type ExplosionMethod = "gas_dynamics" | "fnip_494";
export type ExplosionSourceType = "gas" | "mass";

export interface ExplosionParams {
  method: ExplosionMethod;
  sourceType: ExplosionSourceType;
  // По газу
  gasId: string;
  gasVolume_m3: number;        // м³ — объём взрывоопасной смеси
  gasConcentration: number;    // % — концентрация газа в смеси
  // По массе
  explosiveId: string;
  explosiveMass_kg: number;    // кг — масса ВВ
  // Геометрия выработки
  excavationArea_m2: number;   // м² — сечение выработки
  excavationLength_m: number;  // м — длина зоны взрыва
  // Дополнительно
  ambientPressure_kPa: number; // кПа — атмосферное давление (высота)
  considerWalls: boolean;      // учёт отражения от стенок выработки
}

// ─── Результаты расчёта ───────────────────────────────────────────────────────
export interface ExplosionZone {
  name: string;
  description: string;
  radius_m: number;
  deltaP_kPa: number;
  impulse_Pas: number;
  hazardLevel: "safe" | "light" | "medium" | "heavy" | "lethal";
}

export interface ExplosionResult {
  // Тротиловый эквивалент
  q_tnt_kg: number;
  // Основные параметры в эпицентре
  maxDeltaP_kPa: number;
  maxImpulse_Pas: number;
  waveFrontSpeed_ms: number;
  // Распределение по расстоянию
  zones: ExplosionZone[];
  // Зоны поражения на конкретных расстояниях
  pressureAtDistance: (r_m: number) => number;
  impulseAtDistance: (r_m: number) => number;
  // Лог расчёта
  log: string[];
  // Предупреждения (газ вне зоны взрываемости и т.п.)
  warnings: string[];
}

// ─── Вспомогательные функции ─────────────────────────────────────────────────

/** Тротиловый эквивалент из объёма газа и его параметров */
function gasToTnt(gas: GasType, volume_m3: number, concentration_pct: number): number {
  // Эффективный объём горючего газа (только горючая фракция)
  const fuelFraction = concentration_pct / 100;
  const fuelVol = volume_m3 * fuelFraction;
  // Химическая энергия (МДж)
  const E_chem = fuelVol * gas.qCombust;
  // Механическая энергия взрыва с учётом КПД газовой детонации
  const E_mech = E_chem * gas.efficiency * 1000; // → кДж
  // Тротиловый эквивалент
  return E_mech / Q_TNT;
}

/** Тротиловый эквивалент из массы ВВ */
function massToTnt(expl: ExplosiveType, mass_kg: number): number {
  return mass_kg * expl.tntEq;
}

/**
 * Давление во фронте ударной волны по формуле Садовского (Методика ГД):
 * ΔP = 0.84/r̄ + 2.7/r̄² + 7.15/r̄³ (для r̄ > 0.5)
 * где r̄ = r / Q_tnt^(1/3) — приведённое расстояние
 */
function sadovskyDeltaP(r_m: number, q_tnt: number): number {
  if (q_tnt <= 0 || r_m <= 0) return 0;
  const rBar = r_m / Math.pow(q_tnt, 1 / 3);
  if (rBar < 0.1) return 10000; // очень близко к эпицентру
  // Формула Садовского (ΔP в кПа)
  const dP = P0 * (0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar));
  return Math.round(dP * 10) / 10;
}

/**
 * Импульс положительной фазы (кПа·мс → Па·с):
 * i = 200 * Q_tnt^(1/3) / r (эмпирика по Садовскому)
 */
function sadovskyImpulse(r_m: number, q_tnt: number): number {
  if (q_tnt <= 0 || r_m <= 0) return 0;
  const i_kPa_ms = 200 * Math.pow(q_tnt, 1 / 3) / r_m;
  return Math.round(i_kPa_ms * 10) / 10; // Па·с (1 кПа·мс = 1 Па·с)
}

/**
 * ФНиП №494: формула для определения давления во фронте взрывной волны
 * при подземных взрывных работах.
 * ΔP = 1.07 * (Q_tnt / r³)^(1/3) * P0
 */
function fnip494DeltaP(r_m: number, q_tnt: number): number {
  if (q_tnt <= 0 || r_m <= 0) return 0;
  const dP = 1.07 * Math.pow(q_tnt / (r_m * r_m * r_m), 1 / 3) * P0;
  return Math.round(dP * 10) / 10;
}

/** Скорость фронта ударной волны (м/с) через давление: D = C0 * √(1 + 6/7 * ΔP/P0) */
function waveFrontSpeed(deltaP_kPa: number): number {
  return Math.round(C0 * Math.sqrt(1 + (6 / 7) * (deltaP_kPa / P0)) * 10) / 10;
}

/** Коэффициент отражения от стенок горной выработки */
function wallReflectionFactor(area_m2: number): number {
  // Эмпирический коэффициент: чем уже выработка, тем сильнее эффект канализирования волны
  // Типичные выработки 15–40 м² → коэффициент 1.5–2.0
  if (area_m2 <= 0) return 1.5;
  if (area_m2 < 10) return 2.0;
  if (area_m2 < 20) return 1.8;
  if (area_m2 < 40) return 1.5;
  return 1.3;
}

// ─── Пороги поражения (кПа) ───────────────────────────────────────────────────
const HAZARD_THRESHOLDS = {
  lethal:  100,   // > 100 кПа — летальный исход
  heavy:    50,   // 50–100 кПа — тяжёлые повреждения
  medium:   30,   // 30–50 кПа — средние повреждения
  light:    10,   // 10–30 кПа — лёгкие повреждения
  safe:      0,   // < 10 кПа — безопасно
};

function hazardLevel(dP: number): ExplosionZone["hazardLevel"] {
  if (dP >= HAZARD_THRESHOLDS.lethal)  return "lethal";
  if (dP >= HAZARD_THRESHOLDS.heavy)   return "heavy";
  if (dP >= HAZARD_THRESHOLDS.medium)  return "medium";
  if (dP >= HAZARD_THRESHOLDS.light)   return "light";
  return "safe";
}

/** Радиус, при котором давление падает до порогового значения */
function radiusAtPressure(targetP_kPa: number, q_tnt: number, method: ExplosionMethod, wallFactor: number): number {
  if (targetP_kPa <= 0 || q_tnt <= 0) return 0;
  // Бинарный поиск радиуса
  let lo = 0.1, hi = 5000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const dP = (method === "gas_dynamics" ? sadovskyDeltaP(mid, q_tnt) : fnip494DeltaP(mid, q_tnt)) * wallFactor;
    if (dP > targetP_kPa) lo = mid; else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

// ─── Главная функция расчёта ──────────────────────────────────────────────────
export function calcExplosion(params: ExplosionParams): ExplosionResult {
  const log: string[] = [];
  const warnings: string[] = [];

  // 1. Тротиловый эквивалент
  let q_tnt = 0;

  if (params.sourceType === "gas") {
    const gas = GAS_TYPES.find(g => g.id === params.gasId) ?? GAS_TYPES[0];
    const conc = params.gasConcentration;
    // Проверка взрываемости
    if (conc < gas.lowerLimit) {
      warnings.push(`⚠ Концентрация ${conc}% ниже НПВ (${gas.lowerLimit}%) — смесь не взрывоопасна`);
    } else if (conc > gas.upperLimit) {
      warnings.push(`⚠ Концентрация ${conc}% выше ВПВ (${gas.upperLimit}%) — смесь не взрывоопасна`);
    }
    // Максимум мощности при стехиометрической концентрации
    const effectiveConc = Math.min(conc, gas.stoichConc * 1.2);
    q_tnt = gasToTnt(gas, params.gasVolume_m3, effectiveConc);
    log.push(`Газ: ${gas.name}, объём смеси: ${params.gasVolume_m3} м³, концентрация: ${conc}%`);
    log.push(`Тротиловый эквивалент: Q_tnt = ${Math.round(q_tnt * 100) / 100} кг ТНТ`);
  } else {
    const expl = EXPLOSIVE_TYPES.find(e => e.id === params.explosiveId) ?? EXPLOSIVE_TYPES[0];
    q_tnt = massToTnt(expl, params.explosiveMass_kg);
    log.push(`ВВ: ${expl.name}, масса: ${params.explosiveMass_kg} кг, k_тнт = ${expl.tntEq}`);
    log.push(`Тротиловый эквивалент: Q_tnt = ${Math.round(q_tnt * 100) / 100} кг ТНТ`);
  }

  if (q_tnt <= 0) {
    warnings.push("⚠ Тротиловый эквивалент = 0 — расчёт невозможен");
    q_tnt = 0.001;
  }

  // 2. Коэффициент эффекта выработки (канализирование волны)
  const wallFactor = params.considerWalls
    ? wallReflectionFactor(params.excavationArea_m2)
    : 1.0;
  if (params.considerWalls) {
    log.push(`Коэффициент отражения от стенок выработки: k = ${wallFactor}`);
  }

  // 3. Функции давления и импульса
  const pressureAtDistance = (r: number) => {
    const dP = params.method === "gas_dynamics"
      ? sadovskyDeltaP(r, q_tnt)
      : fnip494DeltaP(r, q_tnt);
    return Math.round(dP * wallFactor * 10) / 10;
  };

  const impulseAtDistance = (r: number) => {
    const i = sadovskyImpulse(r, q_tnt);
    return Math.round(i * wallFactor * 10) / 10;
  };

  // 4. Основные параметры в эпицентре (r = 1 м)
  const maxDeltaP = pressureAtDistance(1);
  const maxImpulse = impulseAtDistance(1);
  const waveFrontSpeed_ms = waveFrontSpeed(maxDeltaP);

  log.push(`Методика: ${params.method === "gas_dynamics" ? "Газодинамическая (Садовский)" : "ФНиП №494"}`);
  log.push(`Давление во фронте (r=1м): ΔP = ${maxDeltaP} кПа`);
  log.push(`Скорость фронта: D = ${waveFrontSpeed_ms} м/с`);

  // 5. Зоны поражения
  const zones: ExplosionZone[] = [
    {
      name: "Летальная",
      description: "ΔP > 100 кПа — летальный исход, полное разрушение",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.lethal, q_tnt, params.method, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.lethal,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.lethal, q_tnt, params.method, wallFactor)),
      hazardLevel: "lethal",
    },
    {
      name: "Тяжёлые поражения",
      description: "ΔP 50–100 кПа — тяжёлые травмы, обрушение конструкций",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.heavy, q_tnt, params.method, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.heavy,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.heavy, q_tnt, params.method, wallFactor)),
      hazardLevel: "heavy",
    },
    {
      name: "Средние поражения",
      description: "ΔP 30–50 кПа — средние травмы, повреждение оборудования",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.medium, q_tnt, params.method, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.medium,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.medium, q_tnt, params.method, wallFactor)),
      hazardLevel: "medium",
    },
    {
      name: "Лёгкие поражения",
      description: "ΔP 10–30 кПа — контузии, звуковая травма, лёгкие повреждения",
      radius_m: radiusAtPressure(HAZARD_THRESHOLDS.light, q_tnt, params.method, wallFactor),
      deltaP_kPa: HAZARD_THRESHOLDS.light,
      impulse_Pas: impulseAtDistance(radiusAtPressure(HAZARD_THRESHOLDS.light, q_tnt, params.method, wallFactor)),
      hazardLevel: "light",
    },
    {
      name: "Безопасная зона",
      description: "ΔP < 10 кПа — незначительное воздействие",
      radius_m: radiusAtPressure(5, q_tnt, params.method, wallFactor),
      deltaP_kPa: 5,
      impulse_Pas: impulseAtDistance(radiusAtPressure(5, q_tnt, params.method, wallFactor)),
      hazardLevel: "safe",
    },
  ];

  zones.forEach(z => {
    log.push(`${z.name}: r = ${z.radius_m} м, ΔP = ${z.deltaP_kPa} кПа`);
  });

  return {
    q_tnt_kg: Math.round(q_tnt * 100) / 100,
    maxDeltaP_kPa: maxDeltaP,
    maxImpulse_Pas: maxImpulse,
    waveFrontSpeed_ms,
    zones,
    pressureAtDistance,
    impulseAtDistance,
    log,
    warnings,
  };
}

/** Уровень опасности по давлению (для окраски ветвей) */
export function explosionHazardLevel(deltaP_kPa: number): ExplosionZone["hazardLevel"] {
  return hazardLevel(deltaP_kPa);
}

/** Цвет ветви по уровню поражения */
export const EXPLOSION_HAZARD_COLORS: Record<ExplosionZone["hazardLevel"], string> = {
  lethal:  "#7c1010",
  heavy:   "#dc2626",
  medium:  "#f97316",
  light:   "#fbbf24",
  safe:    "#22c55e",
};
