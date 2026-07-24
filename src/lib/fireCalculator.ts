// ─────────────────────────────────────────────────────────────────────────────
// fireCalculator.ts — Расчёт аварийного вентиляционного режима при пожаре
//
// Физическая модель:
//   • Тепловыделение Q (МВт) → температура продуктов горения T (°C)
//   • Тепловая депрессия пожара h_t (Па) → влияние на вентиляционный режим
//   • Оценка устойчивости: опрокинется ли нисходящая струя
//   • Распределение продуктов горения: ТОЛЬКО по исходящим (вниз по потоку) ветвям
//     Свежая струя (до очага) — всегда чистая.
//
// Ориентир: методика ПО Аэросеть / ВНИМИ / ИГД им. Скочинского
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoBranch, type TopoNode } from "./topology";

// ─── Константы ────────────────────────────────────────────────────────────────
const CP_AIR = 1.005;          // кДж/(кг·К)
const RHO_AIR_0 = 1.2;        // кг/м³ при 20°C
const G = 9.81;                // м/с²

// Коэффициент теплоотдачи продуктов горения в стенки выработки, Вт/(м²·К).
// По мере движения по выработке горячий воздух остывает, отдавая тепло породе,
// и его температура экспоненциально приближается к температуре стенок (≈ ambient):
//   T_out = T_ст + (T_in − T_ст)·exp( −α·P·L / (ρ·cp·Q) )
// где P — периметр (м), L — длина (м), Q — расход (м³/с). Чем длиннее выработка
// и меньше расход — тем сильнее остывание (как в Аэросети). Значение α подобрано
// по эталону Аэросети (падение ~595→147°C на транспортном съезде).
const WALL_HEAT_ALPHA = 14.0;  // Вт/(м²·К)

// ─── Характеристики горючих материалов ───────────────────────────────────────
export interface CombustibleProps {
  id: string;
  name: string;
  coYield: number;      // кг CO / кг горючего
  co2Yield: number;     // кг CO₂ / кг горючего
  smokeYield: number;   // кг дыма / кг горючего
  heatValue: number;    // МДж/кг — удельная теплота горения
  spreadRate: number;   // м/мин — скорость распространения
  burnRate: number;     // кг/(м²·с) — удельная массовая скорость выгорания (ψ)
  defaultArea: number;  // м² — типовая площадь очага по умолчанию
}

export const COMBUSTIBLES: CombustibleProps[] = [
  { id: "vehicle", name: "Техника",           coYield: 0.07, co2Yield: 2.5,  smokeYield: 0.09,  heatValue: 38, spreadRate: 1.5, burnRate: 0.030, defaultArea: 10 },
  { id: "cable",   name: "Кабель",            coYield: 0.10, co2Yield: 1.8,  smokeYield: 0.12,  heatValue: 18, spreadRate: 0.3, burnRate: 0.007, defaultArea: 1 },
  { id: "conveyor",name: "Конвейерная лента", coYield: 0.08, co2Yield: 2.0,  smokeYield: 0.10,  heatValue: 20, spreadRate: 0.8, burnRate: 0.013, defaultArea: 2 },
  { id: "timber",  name: "Деревянная крепь",  coYield: 0.05, co2Yield: 1.5,  smokeYield: 0.015, heatValue: 16, spreadRate: 1.0, burnRate: 0.027, defaultArea: 5 },
  { id: "oil",     name: "Масло/горючее",     coYield: 0.06, co2Yield: 3.1,  smokeYield: 0.08,  heatValue: 42, spreadRate: 2.0, burnRate: 0.040, defaultArea: 3 },
  { id: "custom",  name: "Произвольный",      coYield: 0.05, co2Yield: 2.0,  smokeYield: 0.05,  heatValue: 25, spreadRate: 1.0, burnRate: 0.015, defaultArea: 3 },
  { id: "coal",    name: "Уголь",             coYield: 0.04, co2Yield: 2.2,  smokeYield: 0.03,  heatValue: 25, spreadRate: 0.5, burnRate: 0.013, defaultArea: 5 },
];

// ─── Параметры составляющих материалов техники ────────────────────────────────
export interface VehicleMaterial {
  name: string;           // название материала
  density: number;        // кг/м³ — плотность
  burnRate: number;       // кг/(м²·с) — скорость выгорания (ψ)
  heatValue: number;      // МДж/кг — низшая теплота сгорания
}

export const VEHICLE_MATERIALS: VehicleMaterial[] = [
  { name: "Резина",  density: 1200, burnRate: 0.020, heatValue: 33.5 },
  { name: "Дизель",  density: 830,  burnRate: 0.043, heatValue: 42.6 },
  { name: "Масло",   density: 900,  burnRate: 0.043, heatValue: 41.8 },
];

export interface VehicleMatItem {
  name: string;
  mass_kg: number;
  volume_m3: number;
  radius_m: number;
  surface_m2: number;
  energy_MJ: number;
  burnTime_h: number;
}

export interface VehicleFireResult {
  power_MW: number;         // МВт — мощность пожара Q
  burnTime_h: number;       // ч — время горения
  burnTime_min: number;     // мин — время горения
  deltaT_C: number;         // °C — расчётная температура горения
  materials: VehicleMatItem[];
  airFlow_m3s: number;      // м³/с — расход воздуха (из расчёта сети)
}

/**
 * Расчёт мощности пожара техники по 8 шагам (методика ВНИМИ/ИГД).
 * Материалы: резина, дизель, масло — с заданными массами.
 *
 * @param masses  - массы [резина, дизель, масло] в кг
 * @param airFlow - расход воздуха в выработке, м³/с
 */
export function calcVehicleFire(
  masses: [number, number, number],
  airFlow: number,
): VehicleFireResult {
  const mats = VEHICLE_MATERIALS;

  // Шаг 1: Объём материала (используем максимальную плотность как нормировку)
  const rhoMax = Math.max(...mats.map(m => m.density));

  const items: VehicleMatItem[] = [];
  for (let i = 0; i < mats.length; i++) {
    const mat  = mats[i];
    const mass = masses[i];
    if (mass <= 0) continue;

    // Шаг 1
    const volume = mass / rhoMax;
    // Шаг 2: радиус эквивалентного шара
    const radius = Math.pow((3 * volume) / (4 * Math.PI), 1 / 3);
    // Шаг 3: поверхность горения F = r × 4π (по методике ВНИМИ)
    const surface = radius * 4 * Math.PI;
    // Шаг 4: запас тепловой энергии (МДж)
    const energy = mass * mat.heatValue;
    // Шаг 5: время выгорания (ч)
    const burnTime = mass / (surface * mat.burnRate * 3600);

    items.push({ name: mat.name, mass_kg: mass, volume_m3: volume, radius_m: radius, surface_m2: surface, energy_MJ: energy, burnTime_h: burnTime });
  }

  if (items.length === 0) {
    return { power_MW: 0, burnTime_h: 0, burnTime_min: 0, deltaT_C: 0, materials: [], airFlow_m3s: airFlow };
  }

  // Шаг 6: суммарная энергия и максимальное время выгорания → мощность
  const totalEnergy_MJ = items.reduce((s, it) => s + it.energy_MJ, 0);
  const maxBurnTime_h  = Math.max(...items.map(it => it.burnTime_h));
  // Защита от деления на ноль/NaN: при вырожденных исходных данных возвращаем
  // нулевой результат, а не NaN/Infinity (иначе .toFixed() в UI роняет рендер).
  const power_MW = maxBurnTime_h > 0 ? totalEnergy_MJ / (maxBurnTime_h * 3600) : 0;
  if (!Number.isFinite(power_MW) || power_MW <= 0) {
    return { power_MW: 0, burnTime_h: 0, burnTime_min: 0, deltaT_C: 0, materials: items, airFlow_m3s: airFlow };
  }

  // Шаг 7: время горения всей техники
  const burnTime_h   = totalEnergy_MJ / (power_MW * 3600);
  const burnTime_min = burnTime_h * 60;

  // Шаг 8: расчётная температура горения по методике ВНИМИ
  // Δt = Q×10⁶ / (L × 1.25 × 1005)
  const fireAbsTemp = calcFireTemp(power_MW, airFlow);
  const deltaT_C = airFlow > 0 ? fireAbsTemp - 20 : 500;

  return {
    power_MW,
    burnTime_h,
    burnTime_min,
    deltaT_C,
    materials: items,
    airFlow_m3s: airFlow,
  };
}

export function getCombustible(id: string): CombustibleProps {
  return COMBUSTIBLES.find(c => c.id === id) ?? COMBUSTIBLES[COMBUSTIBLES.length - 1];
}

// ─── Мощность очага пожара из свойств горючего материала ──────────────────────
// Единый источник мощности (МВт) для ОЧАГА ПОЖАРА: считаем ровно так же, как во
// вкладке «Пожарная нагрузка», чтобы температура продуктов совпадала.
// Для vehicle — по массам техники, для cable/timber/conveyor — по линейной/
// ленточной модели. Возвращает null, если авто-расчёт для материала невозможен
// (тогда используется мощность, заданная пользователем вручную).
export interface FireMaterialProps {
  fireCombustible?: string;
  flow?: number;
  length?: number;
  // Техника
  fireVehicleMassRubber?: number;
  fireVehicleMassDiesel?: number;
  fireVehicleMassOil?: number;
  // Кабель
  fireCableHeatValue?: string; fireCableBurnRate?: string; fireCableDensity?: string;
  fireCableLength?: string; fireCableWidth?: string; fireCableThick?: string;
  // Деревянная крепь
  fireWoodHeatValue?: string; fireWoodBurnRate?: string; fireWoodDensity?: string;
  fireWoodLength?: string; fireWoodWidth?: string; fireWoodThick?: string;
  fireWoodFlameSpeed?: string; fireWoodCalcTime?: string;
  // Конвейерная лента
  fireBeltBurnRate?: string; fireBeltDensity?: string; fireBeltWidth?: string;
  fireBeltLength?: string; fireBeltThickness?: string; fireBeltFlameSpeed?: string;
  // Уголь / масло / произвольный — модель «площадь очага»
  fireSourceArea?: number;   // м² — площадь горения очага
  fireSourceBurnRate?: number; // кг/(м²·с) — скорость выгорания (переопределение)
}

// Мощность пожара по площади очага: N = ψ × S × Q_н [МВт]
// (ψ в кг/(м²·с), S в м², Q_н в МДж/кг → кг/с × МДж/кг = МВт).
export function calcAreaFire(kind: string, area: number, burnRateOverride?: number): number | null {
  const c = getCombustible(kind);
  const psi = (burnRateOverride && burnRateOverride > 0) ? burnRateOverride : c.burnRate;
  const S = area > 0 ? area : c.defaultArea;
  if (!(psi > 0) || !(S > 0) || !(c.heatValue > 0)) return null;
  return psi * S * c.heatValue;
}

export function calcFirePowerFromMaterial(b: FireMaterialProps): number | null {
  const kind = b.fireCombustible ?? "coal";
  const airFlow = Math.abs(b.flow ?? 0);
  const lenStr = b.length && b.length > 0 ? String(b.length) : "";

  if (kind === "vehicle") {
    const masses: [number, number, number] = [
      b.fireVehicleMassRubber ?? 1200,
      b.fireVehicleMassDiesel ?? 400,
      b.fireVehicleMassOil    ?? 200,
    ];
    const vfr = calcVehicleFire(masses, airFlow);
    return vfr.power_MW > 0 ? vfr.power_MW : null;
  }

  if (kind === "cable") {
    const r = calcLinearFire({
      heatValue:    b.fireCableHeatValue ?? "25",
      burnRate:     b.fireCableBurnRate  ?? "0.007",
      density:      b.fireCableDensity   ?? "900",
      length:       b.fireCableLength    ?? (lenStr || "100"),
      sectionWidth: b.fireCableWidth     ?? "0.05",
      sectionThick: b.fireCableThick     ?? "0.05",
    }, airFlow);
    return r && r.powerMW > 0 ? r.powerMW : null;
  }

  if (kind === "timber") {
    const r = calcLinearFire({
      heatValue:    b.fireWoodHeatValue   ?? "13.8",
      burnRate:     b.fireWoodBurnRate    ?? "0.027",
      density:      b.fireWoodDensity     ?? "500",
      length:       b.fireWoodLength      ?? (lenStr || "50"),
      sectionWidth: b.fireWoodWidth       ?? "8.9",
      sectionThick: b.fireWoodThick       ?? "0.08",
      flameSpeed:   b.fireWoodFlameSpeed  ?? "0.024",
      calcTime:     b.fireWoodCalcTime    ?? "10",
    }, airFlow);
    return r && r.powerMW > 0 ? r.powerMW : null;
  }

  if (kind === "conveyor") {
    const r = calcBelt({
      burnRate:   b.fireBeltBurnRate   ?? "0.0125",
      density:    b.fireBeltDensity    ?? "1100",
      width:      b.fireBeltWidth      ?? "1.2",
      length:     b.fireBeltLength     ?? (lenStr || "100"),
      thickness:  b.fireBeltThickness  ?? "0.016",
      flameSpeed: b.fireBeltFlameSpeed ?? "0.013",
    }, airFlow);
    return r && r.powerMax > 0 ? r.powerMax : null;
  }

  // coal / oil / custom — модель «площадь очага»: N = ψ × S × Q_н
  if (kind === "coal" || kind === "oil" || kind === "custom") {
    return calcAreaFire(kind, b.fireSourceArea ?? 0, b.fireSourceBurnRate);
  }

  return null;
}

// ─── Расчёт пожара конвейерной ленты ─────────────────────────────────────────

export interface BeltInputs {
  burnRate: string;       // ψ — скорость выгорания, кг/(м²·с)
  density: string;        // ρ — плотность ленточного полотна, кг/м³
  width: string;          // w — ширина ленты, м
  length: string;         // L — общая длина конвейера, м
  thickness: string;      // h — толщина ленты, м
  flameSpeed: string;     // скорость продвижения пламени, м/с
}

export interface BeltRow {
  t: number;
  dist: number;
  area: number;
  massBurned: number;
  lengthBurned: number;
  powerMW: number;
}

export interface BeltFireResult {
  rows: BeltRow[];
  volume: number;
  mass: number;
  heatTotal: number;
  power30: number;
  power60: number;
  powerMax: number;
  deltaT_C: number;
  burnTime_h: number;
  burnTime_min: number;
}

const BELT_STEPS = [
  1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,
  21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
  41,42,45,48,51,54,57,60,
];

export function calcBelt(inp: BeltInputs, airFlow: number): BeltFireResult | null {
  const psi    = parseFloat(inp.burnRate.replace(",", "."));
  const rho    = parseFloat(inp.density.replace(",", "."));
  const w      = parseFloat(inp.width.replace(",", "."));
  const L      = parseFloat(inp.length.replace(",", "."));
  const h      = parseFloat(inp.thickness.replace(",", "."));
  const vFlame = parseFloat(inp.flameSpeed.replace(",", ".")) * 60; // м/с → м/мин

  if ([psi, rho, w, L, h, vFlame].some(isNaN) || psi <= 0 || rho <= 0 || w <= 0 || L <= 0 || h <= 0 || vFlame <= 0) return null;

  const Q_н    = 33.5; // МДж/кг — НТС резины конвейерной ленты
  const volume  = L * w * h * 2;   // два слоя: верхняя + нижняя ветвь
  const mass    = volume * rho;
  const heatTotal = mass * Q_н;

  // k — параметр затухания
  const k = (psi * 60) / (2 * rho * h * 2 * vFlame);

  const rows: BeltRow[] = BELT_STEPS.map(t => {
    const dist         = Math.min(vFlame * t, L);
    const lengthBurned = Math.min(dist * (1 - Math.exp(-k * t)), dist);
    const area         = Math.max(dist - lengthBurned, 0) * w;
    const massBurned   = Math.min(lengthBurned * w * h * 2 * rho, mass);
    const powerMW      = psi * area * Q_н;
    return { t, dist, area, massBurned, lengthBurned, powerMW };
  });

  const power30   = rows.find(r => r.t === 30)?.powerMW ?? 0;
  const power60   = rows.find(r => r.t === 60)?.powerMW ?? 0;
  const powerMax  = Math.max(power30, power60);
  const deltaTRaw = (airFlow > 0)
    ? powerMax * 1_000_000 / (airFlow * 1.25 * 1005)
    : 0;
  const deltaT_C  = Math.min(deltaTRaw, 1200);

  // burnTime: масса / (ψ × S_макс × 3600) → часы; S_макс = max area по всем шагам
  const areaMax      = Math.max(...rows.map(r => r.area));
  const burnTime_h   = (psi > 0 && areaMax > 0) ? mass / (psi * areaMax * 3600) : 0;
  const burnTime_min = burnTime_h * 60;

  return { rows, volume, mass, heatTotal, power30, power60, powerMax, deltaT_C, burnTime_h, burnTime_min };
}

// ─── Расчёт линейной пожарной нагрузки (кабель, деревянная крепь) ────────────
// Модель: линейный источник тепловыделения вдоль выработки
// Q = ψ × S × Q_н, S = sectionArea × length; время горения = mass / (ψ × S)

export interface LinearFireInputs {
  heatValue: string;      // Q_н, МДж/кг — низшая теплота сгорания
  burnRate: string;       // ψ, кг/(м²·с) — скорость выгорания
  density: string;        // ρ, кг/м³ — плотность материала
  length: string;         // L, м — длина вдоль выработки
  sectionWidth: string;   // периметр выработки, м (для деревянной крепи)
  sectionThick: string;   // толщина доски/элемента крепи, м
  flameSpeed?: string;    // v_пл, м/с — скорость продвижения пламени
  calcTime?: string;      // t, мин — время расчёта (нарастающий пожар)
}

export interface LinearFireResult {
  mass: number;           // кг — масса горючего
  heatTotal: number;      // МДж — теплозапас
  surfaceArea: number;    // м² — площадь горения
  powerMW: number;        // МВт — мощность пожара
  deltaT_C: number;       // °C — нагрев воздушного потока
  burnTime_h: number;     // ч — время горения
  burnTime_min: number;   // мин
}

export function calcLinearFire(inp: LinearFireInputs, airFlow: number): LinearFireResult | null {
  const Q_н   = parseFloat(inp.heatValue.replace(",", "."));
  const psi   = parseFloat(inp.burnRate.replace(",", "."));
  const rho   = parseFloat(inp.density.replace(",", "."));
  const L     = parseFloat(inp.length.replace(",", "."));
  const perim = parseFloat(inp.sectionWidth.replace(",", "."));  // периметр выработки, м
  const b     = parseFloat(inp.sectionThick.replace(",", "."));  // толщина доски крепи, м

  if ([Q_н, psi, rho, L, perim, b].some(isNaN) || [Q_н, psi, rho, L, perim, b].some(v => v <= 0)) return null;

  // Суммарный объём и масса деревянной крепи (периметр × длина × толщина доски)
  const volume    = perim * L * b;
  const mass      = volume * rho;
  const heatTotal = mass * Q_н;

  // Скорость продвижения пламени и время расчёта
  const v_пл = inp.flameSpeed ? parseFloat(inp.flameSpeed.replace(",", ".")) : null;
  const t_мин = inp.calcTime ? parseFloat(inp.calcTime.replace(",", ".")) : null;

  // Площадь горения
  let surfaceArea: number;
  if (v_пл && v_пл > 0 && t_мин && t_мин > 0) {
    // Нарастающий пожар: площадь горения нарастает по мере продвижения фронта пламени
    // S(t) = Периметр × (v_пл × t_с), ограниченная длиной крепи L
    const l_горения = Math.min(v_пл * t_мин * 60, L); // длина охваченного участка, м
    surfaceArea = perim * l_горения;
  } else {
    // Установившийся режим: вся крепь охвачена огнём
    surfaceArea = perim * L;
  }

  // Мощность: N = ψ × S × Q_н [МВт]
  const powerMW = psi * surfaceArea * Q_н;

  // ΔT воздушного потока, ограниченная 1200°C
  const deltaTRaw = airFlow > 0 ? powerMW * 1_000_000 / (airFlow * 1.25 * 1005) : 0;
  const deltaT_C  = Math.min(deltaTRaw, 1200);

  // Время полного выгорания: масса / (ψ × S_макс)
  const surfaceFull  = perim * L;
  const burnTime_s   = psi * surfaceFull > 0 ? mass / (psi * surfaceFull) : 0;
  const burnTime_h   = burnTime_s / 3600;
  const burnTime_min = burnTime_h * 60;

  return { mass, heatTotal, surfaceArea, powerMW, deltaT_C, burnTime_h, burnTime_min };
}

// ─── Типы результатов ─────────────────────────────────────────────────────────

export interface SmokeState {
  coConc: number;        // % CO
  co2Conc: number;       // % CO₂
  smokeDensity: number;  // м⁻¹
  temp: number;          // °C
}

export interface FireBranchResult {
  branchId: string;
  airTempOut: number;
  thermalDepression: number;
  willReverse: boolean;
  // Реальное опрокидывание: знак flow изменился после итеративного расчёта
  // (в отличие от willReverse — это факт, а не оценка)
  actuallyReversed: boolean;
  coConc: number;
  co2Conc: number;
  smokeDensity: number;
  visibility: number;
  hazardLevel: "safe" | "warning" | "danger" | "lethal";
  // Изменение расхода воздуха из-за тепловой депрессии (м³/с)
  flowDelta?: number;
  // Время прихода задымления от очага до ветви (минуты)
  smokeArrivalTime: number;
  // Скорость воздуха в ветви после расчёта пожара (м/с), мин. 0.3 для отображения fillTime
  airSpeed: number;
  // Знак потока на момент расчёта: +1 = from→to, -1 = to→from
  // Сохраняем чтобы избежать race condition со state React (branch.flow может быть устаревшим)
  flowSign: 1 | -1;
}

export interface FireCalculationResult {
  fireTemp: number;
  fireThermalDep: number;
  branches: Map<string, FireBranchResult>;
  reversedBranches: Set<string>;
  log: string[];
  // Максимальное время распространения задымления (минуты)
  maxSmokeTime: number;
  // Время прихода задымления в каждый узел (минуты). Нужно фронтенду, чтобы
  // корректно дорисовывать задымление внутри ветви-очага, когда дым по кольцу
  // возвращается к входному узлу очага.
  nodeArrivalTime: Map<string, number>;
  // Концентрации продуктов горения и температуры в каждом задымлённом узле.
  // Заполняется при обходе распространения дыма по узлам сети.
  //  • co, co2 — % CO и % CO₂;
  //  • airTemp — температура воздуха в узле, °C;
  //  • wallTemp — температура стенок выработки в узле, °C.
  nodeGas: Map<string, { co: number; co2: number; airTemp: number; wallTemp: number }>;
}

// ─── Физические формулы ───────────────────────────────────────────────────────

export function calcFireTemp(
  heatRelease_MW: number,
  airFlow_m3s: number,
  ambientTemp_C = 20,
): number {
  if (airFlow_m3s <= 0) return ambientTemp_C + 500;
  // Δt = Q×10⁶ / (L × 1.25 × 1005) — методика ВНИМИ (как в Аэросети).
  // Вся тепловая мощность идёт в нагрев струи (без коэффициента теплопотерь) —
  // так считает Аэросеть: при 8.52 МВт и 31.8 м³/с даёт ~233°C (Аэросеть 226.5°C).
  // ρ = 1.25 кг/м³ фиксированная, CP = 1005 Дж/(кг·К)
  const Q_W = heatRelease_MW * 1e6;
  const massFlow = 1.25 * airFlow_m3s;
  const deltaT = Q_W / (massFlow * CP_AIR * 1000);
  return Math.min(1200, ambientTemp_C + deltaT);
}

// Обратная формула к calcFireTemp: мощность пожара (МВт) из заданной
// температуры продуктов горения. Нужна в режиме «температурой», чтобы
// концентрации газов считались по реальному тепловыделению.
export function tempToPower_MW(
  fireTemp_C: number,
  airFlow_m3s: number,
  ambientTemp_C = 20,
): number {
  if (!(airFlow_m3s > 0)) return 0;
  const deltaT = Math.max(0, fireTemp_C - ambientTemp_C);
  const massFlow = 1.25 * airFlow_m3s;
  const Q_W = deltaT * massFlow * CP_AIR * 1000;
  return Q_W / 1e6;
}

export function calcThermalDepression(
  fireTemp_C: number,
  ambientTemp_C: number,
  branchLength_m: number,
  branchAngle_deg: number,
): number {
  const tf = Number(fireTemp_C);
  const t0 = Number(ambientTemp_C);
  const len = Number(branchLength_m);
  const ang = Number(branchAngle_deg);
  if (!Number.isFinite(tf) || !Number.isFinite(t0) || !Number.isFinite(len) || !Number.isFinite(ang)) return 0;
  // Строгая физика теплового столба (как в Аэросети):
  //   h_t = g · Δz · (ρ₀ − ρ_гор),  Δz = L·sinα  — высота столба горячего воздуха,
  //   ρ = 353/(273+T)               — плотность воздуха по идеальному газу.
  // Раньше применялась линеаризация ρ·(ΔT/T₀), которая при большом перегреве
  // (ΔT > 100°) завышала депрессию на ~40%. Строгая разность плотностей точнее.
  // Знак Δz (= sinα) сам задаёт направление тяги (восходящая/нисходящая ветвь),
  // поэтому дополнительный Math.sign не нужен.
  const sinA = Math.sin((ang * Math.PI) / 180);
  const dz   = len * sinA;                 // высота столба, м (со знаком)
  const rho0   = 353.0 / (273.0 + t0);     // плотность холодного воздуха
  const rhoHot = 353.0 / (273.0 + tf);     // плотность горячих продуктов горения
  const res = G * dz * (rho0 - rhoHot);
  return Number.isFinite(res) ? res : 0;
}

export function calcGasConcentrations(
  heatRelease_MW: number,
  airFlow_m3s: number,
  combustible: CombustibleProps,
): { coConc: number; co2Conc: number; smokeDensity: number; visibility: number } {
  if (airFlow_m3s <= 0) {
    return { coConc: 2.0, co2Conc: 15.0, smokeDensity: 10, visibility: 0 };
  }
  // Скорость выгорания: мощность (кВт=кДж/с) / низшую теплоту сгорания (кДж/кг).
  // heatValue задаётся в МДж/кг → переводим в кДж/кг (×1000).
  const burnRate_kgs = (heatRelease_MW * 1e3) / (combustible.heatValue * 1e3);
  const airFlow_Nm3s = airFlow_m3s * (RHO_AIR_0 / 1.293);

  const coVolRate = (burnRate_kgs * combustible.coYield) / 1.25;
  const coConc = (coVolRate / (airFlow_Nm3s + coVolRate)) * 100;

  const co2VolRate = (burnRate_kgs * combustible.co2Yield) / 1.977;
  const co2Conc = (co2VolRate / (airFlow_Nm3s + co2VolRate)) * 100 + 0.04;

  const smokeMassRate = burnRate_kgs * combustible.smokeYield;
  const smokeSpec = 7700;
  const smokeDensity = Math.min(10, (smokeMassRate * smokeSpec) / airFlow_Nm3s);
  const visibility = smokeDensity > 0 ? Math.min(100, 3 / smokeDensity) : 100;

  return { coConc, co2Conc, smokeDensity, visibility };
}

export function calcHazardLevel(
  coConc: number,
  co2Conc: number,
  smokeDensity: number,
  airTempOut: number,
): "safe" | "warning" | "danger" | "lethal" {
  if (coConc > 0.4 || co2Conc > 10 || airTempOut > 60) return "lethal";
  if (coConc > 0.1 || co2Conc > 5 || airTempOut > 40 || smokeDensity > 2) return "danger";
  if (coConc > 0.02 || co2Conc > 1 || smokeDensity > 0.5) return "warning";
  return "safe";
}

// ─── Главная функция расчёта ──────────────────────────────────────────────────
//
// ПРАВИЛЬНАЯ ЛОГИКА РАСПРОСТРАНЕНИЯ ЗАДЫМЛЕНИЯ:
//
// 1. Для каждой ветви направление потока определяется знаком b.flow:
//    flow > 0: воздух идёт от fromId → toId  (выходной узел = toId)
//    flow < 0: воздух идёт от toId → fromId  (выходной узел = fromId)
//
// 2. Очаг пожара генерирует продукты горения на ВЫХОДЕ ветви-очага.
//    Всё что ДО очага по потоку — свежий воздух, задымлению НЕ подвергается.
//
// 3. BFS ведётся по графу потоков:
//    nodeSmoke[nodeId] = взвешенная смесь ВСЕХ задымлённых потоков, входящих в узел
//    Смешение: если в узел входит и свежий (Q_fresh) и задымлённый (Q_smoke),
//    концентрация на выходе = conc * Q_smoke / (Q_smoke + Q_fresh) — разбавление!
//
// 4. Ветвь задымляется только если её входной узел содержит задымление.

export function calcFireMode(
  branches: TopoBranch[],
  nodes: TopoNode[],
  ambientTemp_C = 20,
  smokeVisThreshold = 50,
): FireCalculationResult {
  const log: string[] = [];
  const resultMap = new Map<string, FireBranchResult>();
  const reversedBranches = new Set<string>();

  // Индекс узлов для быстрого поиска
  void nodes;

  // ── Шаг 1: Находим ветви с пожарами ──────────────────────────────────────
  const fireBranches = branches.filter(b => b.hasFire);
  if (fireBranches.length === 0) {
    return { fireTemp: ambientTemp_C, fireThermalDep: 0, branches: resultMap, reversedBranches, log: ["Очагов пожара не обнаружено"], maxSmokeTime: 60, nodeArrivalTime: new Map(), nodeGas: new Map() };
  }
  log.push(`Обнаружено очагов пожара: ${fireBranches.length}`);

  // ── Шаг 2: Расчёт параметров в каждом очаге ──────────────────────────────
  // nodeSmoke[nodeId] = задымление, которое очаг вносит в выходной узел
  // Структура: { totalSmokedQ, totalQ, weighted sums }
  // Для каждого узла собираем все задымлённые потоки входящих в него ветвей
  interface NodeContrib {
    smokedQ: number;      // расход задымлённого воздуха (м³/с)
    freshQ: number;       // расход свежего воздуха (м³/с)
    wCO: number;          // взвешенная сумма CO * Q
    wCO2: number;
    wSmoke: number;
    wTemp: number;
  }
  const nodeContribs = new Map<string, NodeContrib>();
  // Время прихода задымления в каждый узел (минуты от начала пожара)
  const nodeArrivalTime = new Map<string, number>();

  const getNC = (nid: string): NodeContrib => {
    if (!nodeContribs.has(nid)) nodeContribs.set(nid, { smokedQ: 0, freshQ: 0, wCO: 0, wCO2: 0, wSmoke: 0, wTemp: 0 });
    return nodeContribs.get(nid)!;
  };

  for (const fb of fireBranches) {
    // Расход воздуха для расчёта ТЕМПЕРАТУРЫ/МОЩНОСТИ/концентраций очага берём
    // по ШТАТНОМУ режиму (до пожара), как в Аэросети. Тепловая депрессия при
    // пожаре может локально снижать расход в самой ветви очага (обратная связь
    // h_t→расход↓), и если считать t продуктов по этому уменьшённому расходу,
    // температура нефизично взлетает (например 729°C вместо ~226°C). Штатный
    // расход даёт температуру, совпадающую с Аэросетью.
    const airQ = Math.abs(fb.originalFlow ?? fb.flow ?? 0);

    // Температура на выходе очага.
    // В режиме «температурой» берём заданную T (с защитой от пустого/битого
    // значения и ограничением потолком 1200°C), иначе считаем из мощности.
    let Q_MW: number;
    let fireTemp: number;
    if (fb.fireMode === "temp") {
      const tRaw = Number(fb.fireTemperature);
      fireTemp = Number.isFinite(tRaw) && tRaw > ambientTemp_C
        ? Math.min(1200, tRaw)
        : ambientTemp_C + 500; // дефолт, если температура не задана/битая
      // Эквивалентная мощность из температуры — чтобы концентрации газов
      // считались корректно (обратная формула к calcFireTemp).
      Q_MW = tempToPower_MW(fireTemp, airQ, ambientTemp_C);
    } else {
      Q_MW = Number.isFinite(fb.fireHeatRelease) ? fb.fireHeatRelease : 0;
      fireTemp = calcFireTemp(Q_MW, airQ, ambientTemp_C);
    }

    // Знаковый угол: из высот узлов (to выше from → +, to ниже → −).
    // Геометрический знак в ориентации ветви from→to — тот же, что и у
    // естественной тяги. Направление потока НЕ домножаем: это лишь оценка
    // риска/знак отображаемой депрессии, а реальное опрокидывание берётся из
    // сравнения originalFlow/flow (actuallyReversed).
    const fromNode = nodes.find(n => n.id === fb.fromId);
    const toNode   = nodes.find(n => n.id === fb.toId);
    const dz = (toNode?.z ?? 0) - (fromNode?.z ?? 0);
    const signedAngle = Math.abs(fb.angle ?? 0) * (dz !== 0 ? Math.sign(dz) : (Math.sign(fb.angle ?? 0) || 1));

    // Тепловая депрессия (знаковый угол: нисходящая → отрицательная депрессия → опрокидывание)
    const thermalDep = calcThermalDepression(fireTemp, ambientTemp_C, fb.length, signedAngle);

    // Концентрации
    const comb = getCombustible(fb.fireCombustible ?? "coal");
    const { coConc, co2Conc, smokeDensity, visibility } = calcGasConcentrations(Q_MW, airQ, comb);

    // Опрокидывание: нисходящая ветвь (signedAngle < 0), тепловая депрессия > аэродинамической
    const isDescending = signedAngle < -1;
    const willReverse = isDescending && Math.abs(thermalDep) > Math.abs(fb.dP ?? 0) * 0.5;

    // Фактическое изменение расхода: разница между расходом после расчёта пожара и до пожара
    // originalFlow передаётся из итеративного расчёта в Cad.tsx
    const originalFlow = fb.originalFlow ?? fb.flow ?? 0;
    const flowDelta = (fb.flow ?? 0) - originalFlow;

    const hazard = calcHazardLevel(coConc, co2Conc, smokeDensity, fireTemp);

    // Вносим задымление в ВЫХОДНОЙ узел очага
    const outNodeId = (fb.flow ?? 0) >= 0 ? fb.toId : fb.fromId;
    const inNodeId  = (fb.flow ?? 0) >= 0 ? fb.fromId : fb.toId;

    // Позиция очага вдоль ветви: fireT=0 → у fromId, fireT=1 → у toId
    const fireT = (fb.fireT ?? 0.5);
    const smokeSpeed = Math.max(airQ > 0 && (fb.area ?? 0) > 0 ? airQ / fb.area : 0.5, 0.3);
    const branchLen = fb.length ?? 0;

    // Время от очага до ВЫХОДНОГО узла (по направлению потока)
    const fracToOut = (fb.flow ?? 0) >= 0 ? (1 - fireT) : fireT;

    // Остывание продуктов горения от точки очага до ВЫХОДНОГО узла очага
    // (сток тепла в стенки на участке ветви очага длиной branchLen·fracToOut).
    // Без этого выходной узел очага получал полную температуру очага (468°C),
    // а не остывшую (~147°C, как в Аэросети).
    const fbPer = (fb.perimeter && fb.perimeter > 0) ? fb.perimeter : 4 * Math.sqrt(Math.max(1, fb.area ?? 1));
    const fbSegLen = branchLen * fracToOut;
    // Остывание считаем по ФАКТИЧЕСКОМУ расходу продуктов горения (после пожара),
    // а не по штатному: продукты движутся с реальной, часто малой, скоростью —
    // чем меньше расход, тем сильнее остывание о стенки.
    const fbActualQ = Math.abs(fb.flow ?? airQ);
    const fbMassFlow = Math.max(0.5, 1.25 * fbActualQ);
    const fbCoolExp = Math.max(0.3, Math.exp(-(WALL_HEAT_ALPHA * fbPer * fbSegLen) / (fbMassFlow * CP_AIR * 1000)));
    const fireTempAtOut = ambientTemp_C + (fireTemp - ambientTemp_C) * fbCoolExp;

    const nc = getNC(outNodeId);
    nc.smokedQ += airQ;
    nc.wCO += coConc * airQ;
    nc.wCO2 += co2Conc * airQ;
    nc.wSmoke += smokeDensity * airQ;
    nc.wTemp += fireTempAtOut * airQ;
    const outTime = branchLen > 0 ? (branchLen * fracToOut) / smokeSpeed / 60 : 0;

    // Время от очага до ВХОДНОГО узла (против направления потока — при опрокидывании/диффузии)
    // Дым всегда распространяется от точки очага в ОБЕ стороны
    const fracToIn = 1 - fracToOut;
    const inTime = branchLen > 0 ? (branchLen * fracToIn) / smokeSpeed / 60 : 0;

    // Только выходной узел очага получает время прихода задымления.
    // Входной узел (inNodeId) — источник свежего воздуха, дым туда не идёт.
    if (!nodeArrivalTime.has(outNodeId) || nodeArrivalTime.get(outNodeId)! > outTime) {
      nodeArrivalTime.set(outNodeId, outTime);
    }
    void inTime;

    // Реальное опрокидывание: знак flow изменился после итеративного расчёта.
    // Сравниваем fb.flow (после итераций) с fb.originalFlow (до пожара).
    // Если originalFlow не задан — fallback на статическую оценку willReverse.
    const origFlow = fb.originalFlow;
    const flowNow  = fb.flow ?? 0;
    const actuallyReversed = origFlow !== undefined
      ? (Math.sign(origFlow || 1) !== Math.sign(flowNow || 1)) && Math.abs(flowNow) > 0.05
      : willReverse;

    // smokeArrivalTime самой ветви-очага = 0 (горит сразу, видна всегда)
    const fbFlow = fb.flow ?? 0;
    resultMap.set(fb.id, {
      branchId: fb.id,
      airTempOut: Math.round(fireTemp * 10) / 10,
      thermalDepression: Math.round(thermalDep * 10) / 10,
      willReverse,
      actuallyReversed,
      coConc: Math.round(coConc * 1000) / 1000,
      co2Conc: Math.round(co2Conc * 100) / 100,
      smokeDensity: Math.round(smokeDensity * 100) / 100,
      visibility: Math.round(visibility * 10) / 10,
      hazardLevel: hazard,
      flowDelta: Math.round(flowDelta * 100) / 100,
      smokeArrivalTime: 0,
      airSpeed: Math.max(smokeSpeed, 0.3),
      flowSign: fbFlow >= 0 ? 1 : -1,
    });
    // В множество опрокинутых (синяя подсветка + счётчик) добавляем ТОЛЬКО
    // ветви с РЕАЛЬНЫМ опрокидыванием потока. Риск (willReverse) отражается
    // лишь в логе/тексте, без подсветки и без учёта в счётчике.
    if (actuallyReversed) reversedBranches.add(fb.id);

    log.push(`Ветвь ${fb.id}: Q_пожара=${Q_MW} МВт, T=${Math.round(fireTemp)}°C, h_t=${Math.round(thermalDep)} Па, CO=${coConc.toFixed(3)}%, вид.=${Math.round(visibility)} м${actuallyReversed ? " 🔄 ОПРОКИНУТА (расчёт)" : willReverse ? " ⚠️ РИСК ОПРОКИДЫВАНИЯ" : ""}`);
  }

  // ── Шаг 3: Строим карту inNodeId→ветви для быстрого поиска downstream ─────
  // Для каждого узла — список ветвей, у которых он является входным (по знаку потока)
  const fireBranchIds = new Set<string>(fireBranches.map(b => b.id));

  // branchesByInNode[nodeId] = ветви ВНИЗ по потоку от этого узла (не очаги)
  const branchesByInNode = new Map<string, typeof branches>();
  for (const b of branches) {
    if (fireBranchIds.has(b.id)) continue;
    const flow = b.flow ?? 0;
    if (Math.abs(flow) < 0.001) continue;
    // Входной узел = откуда приходит воздух
    const inNodeId = flow >= 0 ? b.fromId : b.toId;
    if (!branchesByInNode.has(inNodeId)) branchesByInNode.set(inNodeId, []);
    branchesByInNode.get(inNodeId)!.push(b);
  }

  // Суммарный расход воздуха, ВХОДЯЩИЙ в каждый узел (по всем ветвям, где узел
  // является выходным). Нужен для разбавления дыма свежим воздухом в узлах
  // слияния: концентрация на выходе = (задымлённый_Q × конц) / полный_Q_узла.
  // Именно разбавление обрывает фронт задымления там, где к дыму подмешивается
  // много чистого воздуха (модель Аэросеть/Вентиляция).
  const nodeInflowQ = new Map<string, number>();
  for (const b of branches) {
    const flow = b.flow ?? 0;
    if (Math.abs(flow) < 0.001) continue;
    const outNodeId = flow >= 0 ? b.toId : b.fromId; // куда воздух ВТЕКАЕТ
    nodeInflowQ.set(outNodeId, (nodeInflowQ.get(outNodeId) ?? 0) + Math.abs(flow));
  }

  // ── Шаг 4: Dijkstra-BFS распространения задымления ────────────────────────
  // Используем Dijkstra (priority queue по времени прихода) вместо простого BFS,
  // чтобы корректно обрабатывать сети с циклами: каждый узел обрабатывается
  // ТОЛЬКО ОДИН РАЗ — когда найден кратчайший путь к нему.
  interface SmokeParams { coC: number; co2C: number; smokeC: number; tempC: number; }
  const smokeAtNode = new Map<string, SmokeParams>();
  // Итоговые концентрации CO / CO₂ в задымлённых узлах (для панели свойств узла)
  const nodeGas = new Map<string, { co: number; co2: number }>();

  // Инициализация: только ВЫХОДНЫЕ узлы очагов попадают в начало обхода.
  // Входной узел очага (inNodeId) — источник свежего воздуха, НЕ задымляется.
  // При опрокидывании (actuallyReversed) очаг уже находится в reverserBranches,
  // и его входной/выходной узлы поменяются местами по знаку flow.
  for (const fb of fireBranches) {
    // outNodeId определяется знаком flow ПОСЛЕ итеративного расчёта
    const outNodeId = (fb.flow ?? 0) >= 0 ? fb.toId : fb.fromId;
    const nc = nodeContribs.get(outNodeId);
    if (!nc || nc.smokedQ < 0.0001) continue;
    const sp: SmokeParams = {
      coC:    nc.wCO    / nc.smokedQ,
      co2C:   nc.wCO2   / nc.smokedQ,
      smokeC: nc.wSmoke / nc.smokedQ,
      tempC:  nc.wTemp  / nc.smokedQ,
    };
    smokeAtNode.set(outNodeId, sp);
  }

  // Dijkstra: min-heap priority queue по времени прихода.
  // Используем бинарную кучу для корректной работы на больших схемах (>800 ветвей).
  // finalized[nodeId] = true когда узел обработан окончательно.
  const finalized = new Set<string>();

  type PQEntry = [number, string]; // [arrivalTime, nodeId]
  const pq: PQEntry[] = [];

  const pqPush = (entry: PQEntry) => {
    pq.push(entry);
    // Просеивание вверх (sift-up) для min-heap
    let i = pq.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pq[parent][0] <= pq[i][0]) break;
      [pq[parent], pq[i]] = [pq[i], pq[parent]];
      i = parent;
    }
  };

  const pqPop = (): PQEntry => {
    const top = pq[0];
    const last = pq.pop()!;
    if (pq.length > 0) {
      pq[0] = last;
      // Просеивание вниз (sift-down) для min-heap
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < pq.length && pq[l][0] < pq[smallest][0]) smallest = l;
        if (r < pq.length && pq[r][0] < pq[smallest][0]) smallest = r;
        if (smallest === i) break;
        [pq[smallest], pq[i]] = [pq[i], pq[smallest]];
        i = smallest;
      }
    }
    return top;
  };

  // Добавляем стартовые узлы (выходные узлы очагов)
  for (const [nodeId, time] of nodeArrivalTime) {
    if (smokeAtNode.has(nodeId)) {
      pqPush([time, nodeId]);
    }
  }

  // Порог задымления по видимости (модель Аэросеть/Вентиляция): дым считается
  // «дошедшим» в ветвь, только пока видимость в дыму НИЖЕ порога. Как только
  // при затухании вдоль струи видимость восстанавливается выше порога —
  // дальше идёт практически чистый воздух, и фронт задымления ОБРЫВАЕТСЯ.
  // Это гарантирует связность: задымлены только ветви на непрерывном пути от
  // очага, где концентрация ещё опасна (никаких «оторванных» задымлённых ветвей).
  const SMOKE_VIS_THRESHOLD = smokeVisThreshold > 0 ? smokeVisThreshold : 50; // м — граница различимого задымления
  const SMOKE_DENS_THRESHOLD = 3 / SMOKE_VIS_THRESHOLD; // соответствующая плотность

  while (pq.length > 0) {
    const [entryTime, smokedNodeId] = pqPop();

    // Пропускаем если уже обработан (Dijkstra гарантирует оптимальность).
    // Также пропускаем «устаревшие» записи в куче: если время в записи больше
    // текущего оптимального времени узла — этот путь неактуален (в куче могло
    // остаться несколько записей для одного узла с разным временем).
    if (finalized.has(smokedNodeId)) continue;
    const optArrival = nodeArrivalTime.get(smokedNodeId) ?? 0;
    if (entryTime > optArrival + 1e-9) continue;
    finalized.add(smokedNodeId);

    const sp = smokeAtNode.get(smokedNodeId);
    if (!sp) continue;
    // Узел задымлён по порогу? Если дым сюда пришёл уже рассеянным (плотность
    // ниже порога) — дальше он НЕ распространяется (обрыв фронта, чистый воздух).
    if (sp.smokeC < SMOKE_DENS_THRESHOLD) continue;
    // Фиксируем концентрации продуктов горения и температуры в задымлённом узле.
    // Температура стенок выработки нагревается медленнее воздуха (сток тепла в
    // породу) — принимаем как ambient + 0.5·(t_возд − ambient).
    const nodeAirTemp  = sp.tempC;
    const nodeWallTemp = ambientTemp_C + 0.5 * (nodeAirTemp - ambientTemp_C);
    nodeGas.set(smokedNodeId, {
      co:  Math.round(sp.coC  * 1000) / 1000,
      co2: Math.round(sp.co2C * 100)  / 100,
      airTemp:  Math.round(nodeAirTemp  * 100) / 100,
      wallTemp: Math.round(nodeWallTemp * 100) / 100,
    });
    // Время задымления ВХОДНОГО узла — оно уже оптимально (узел финализирован).
    const arrivalAtIn = optArrival;

    // Все ветви, для которых этот узел — входной (дым идёт вниз по потоку)
    const downBranches = branchesByInNode.get(smokedNodeId) ?? [];

    for (const b of downBranches) {
      const flow = b.flow ?? 0;
      const outNodeId = flow >= 0 ? b.toId : b.fromId;

      const rawSpeed = Math.abs(flow) > 0 && (b.area ?? 0) > 0
        ? Math.abs(flow) / b.area : 0;
      const speed = Math.max(rawSpeed, 0.3); // мин. 0.3 м/с
      const transitMin = (b.length ?? 0) > 0 ? b.length / speed / 60 : 0;
      const arrivalAtOut = Math.min(600, arrivalAtIn + transitMin);

      // Затухание концентраций вдоль ветви
      const lf     = Math.max(0.5, Math.exp(-(b.length ?? 0) * 0.0005));
      const coOut    = sp.coC    * lf;
      const smokeOut = sp.smokeC * lf;
      const co2Out   = Math.max(0.04, sp.co2C * lf);
      // Остывание продуктов горения о стенки выработки (сток тепла в породу).
      // Температура экспоненциально приближается к температуре стенок (≈ ambient)
      // по мере движения: T = T_ст + (T_вх − T_ст)·exp(−α·P·L/(ρ·cp·Q)).
      // Чем длиннее выработка и меньше расход — тем сильнее остывание (как в
      // Аэросети). Раньше стоял слабый exp(−L·0.001) без учёта периметра и
      // расхода — температура почти не падала (435°C в узле вместо ~147°C).
      const bLen  = b.length ?? 0;
      const bPer  = (b.perimeter && b.perimeter > 0) ? b.perimeter : 4 * Math.sqrt(Math.max(1, b.area ?? 1));
      const bMassFlow = Math.max(0.5, 1.25 * Math.abs(flow)); // кг/с
      // Ограничиваем остывание на ОДНОЙ ветви: за один короткий участок воздух
      // не успевает полностью сравняться со стенками — оставляем ≥30% перегрева,
      // чтобы на коротких приочаговых ветвях температура не «схлопывалась».
      const coolExp = Math.max(0.3, Math.exp(-(WALL_HEAT_ALPHA * bPer * bLen) / (bMassFlow * CP_AIR * 1000)));
      const tempOut  = ambientTemp_C + (sp.tempC - ambientTemp_C) * coolExp;
      const visOut   = smokeOut > 0 ? Math.min(100, 3 / smokeOut) : 100;
      const hazard   = calcHazardLevel(coOut, co2Out, smokeOut, tempOut);

      // Порог: если дым в этой ветви уже рассеялся ниже порога видимости —
      // ветвь НЕ задымляется и дальше по ней распространение не идёт.
      if (smokeOut < SMOKE_DENS_THRESHOLD) continue;

      // Реальное опрокидывание: знак расхода изменился по сравнению с исходным
      const bOrigFlow = (b as TopoBranch & { originalFlow?: number }).originalFlow;
      const bActuallyReversed = bOrigFlow !== undefined
        ? (Math.sign(bOrigFlow || 1) !== Math.sign(flow || 1)) && Math.abs(flow) > 0.01
        : false;
      if (bActuallyReversed) reversedBranches.add(b.id);

      // У каждой ветви ровно один входной узел (по знаку flow), поэтому она
      // обрабатывается ровно один раз — когда её входной узел финализирован
      // Dijkstra с гарантированно оптимальным (минимальным) временем прихода.
      // Дым начинает вползать в ветвь именно с момента arrivalAtIn — фронтенд
      // рисует прогресс от этого времени со скоростью speed. Очаги исключены
      // из branchesByInNode, поэтому их smokeArrivalTime=0 не перезаписывается.
      if (!resultMap.has(b.id)) {
        resultMap.set(b.id, {
          branchId: b.id,
          airTempOut:        Math.round(tempOut  * 10)  / 10,
          thermalDepression: 0,
          willReverse:       false,
          actuallyReversed:  bActuallyReversed,
          coConc:            Math.round(coOut    * 1000) / 1000,
          co2Conc:           Math.round(co2Out   * 100)  / 100,
          smokeDensity:      Math.round(smokeOut * 100)  / 100,
          visibility:        Math.round(visOut   * 10)   / 10,
          hazardLevel:       hazard,
          smokeArrivalTime:  Math.round(arrivalAtIn * 100) / 100,
          airSpeed:          Math.round(speed * 100) / 100,
          flowSign:          flow >= 0 ? 1 : -1,
        });
      }

      // Обновляем выходной узел в Dijkstra только если новый путь строго быстрее
      if (finalized.has(outNodeId)) continue;
      const prevArrival = nodeArrivalTime.get(outNodeId);
      if (prevArrival !== undefined && arrivalAtOut >= prevArrival - 1e-9) continue;

      // Разбавление в узле слияния: дым, принесённый этой ветвью (расход |flow|),
      // смешивается со ВСЕМ воздухом, входящим в узел (nodeInflowQ). Чем больше
      // подмешивается свежего воздуха — тем сильнее падает концентрация. Это
      // естественно обрывает фронт задымления в узлах с большим притоком воздуха.
      const totalInQ = Math.max(nodeInflowQ.get(outNodeId) ?? Math.abs(flow), Math.abs(flow));
      const dil = totalInQ > 0 ? Math.abs(flow) / totalInQ : 1;

      nodeArrivalTime.set(outNodeId, arrivalAtOut);
      smokeAtNode.set(outNodeId, {
        coC:    coOut    * dil,
        co2C:   Math.max(0.04, co2Out * dil),
        smokeC: smokeOut * dil,
        tempC:  ambientTemp_C + (tempOut - ambientTemp_C) * dil,
      });
      pqPush([arrivalAtOut, outNodeId]);
    }
  }

  log.push(`Dijkstra: задымлено узлов=${finalized.size}, ветвей=${resultMap.size} из ${branches.length}`);

  // ── Итоговая статистика ───────────────────────────────────────────────────
  const smokedCount = resultMap.size;
  log.push(`Задымлено ветвей: ${smokedCount} из ${branches.length}`);
  if (reversedBranches.size > 0) {
    log.push(`⚠️ Опрокидывание струи в ветвях: ${[...reversedBranches].join(", ")}`);
  }

  const firstFire = fireBranches[0];
  const firstResult = resultMap.get(firstFire.id)!;

  // Максимальное время = максимум времён прихода дыма в узлы (включает транзит через ветви)
  let maxSmokeTime = 0;
  nodeArrivalTime.forEach(t => { if (t > maxSmokeTime) maxSmokeTime = t; });
  // Также проверяем smokeArrivalTime ветвей
  resultMap.forEach(fr => { if (fr.smokeArrivalTime > maxSmokeTime) maxSmokeTime = fr.smokeArrivalTime; });
  maxSmokeTime = Math.min(600, Math.ceil(maxSmokeTime)) || 60;

  return {
    fireTemp: firstResult.airTempOut,
    fireThermalDep: firstResult.thermalDepression,
    branches: resultMap,
    reversedBranches,
    log,
    maxSmokeTime,
    nodeArrivalTime,
    nodeGas,
  };
}

// ─── Цвет ветви по уровню опасности ──────────────────────────────────────────
export function hazardColor(level: "safe" | "warning" | "danger" | "lethal"): string {
  switch (level) {
    case "lethal":  return "#7f1d1d";
    case "danger":  return "#dc2626";
    case "warning": return "#f59e0b";
    default:        return "";
  }
}