// ─────────────────────────────────────────────────────────────────────────────
// fireStability.ts — Пакетный расчёт устойчивости вентиляционных режимов
// при пожаре (Акт устойчивости). Ориентир: ПО «АэроСеть» / «Вентиляция 2.0».
//
// Идея:
//   • Отбираем ветви с пожарной нагрузкой и наклоном ≥ фильтра (по модулю).
//   • Направление (нисходящее/восходящее) определяем ПО ПОТОКУ ВОЗДУХА:
//     учитываем знак расхода b.flow и знак угла b.angle.
//   • Для каждой ветви считаем мощность пожара (сумма всех источников),
//     температуру пожара и тепловую депрессию.
//   • Критерий устойчивости (как в АэроСети): для НИСХОДЯЩЕЙ струи тепловая
//     депрессия пожара направлена против движения воздуха. Если она превышает
//     располагаемую депрессию ветви — струя опрокидывается → «Неустойчиво».
//     Восходящие струи считаются устойчивыми (тяга усиливает поток).
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode } from "./topology";
import { calcBranchAngle } from "./topology";
import {
  calcVehicleFire, calcBelt, calcLinearFire,
  calcFireTemp, calcThermalDepression,
} from "./fireCalculator";

// Категория ветви по направлению и характеру выработки
export type StabilityCategory =
  | "descending-incline"  // нисходящее наклонное
  | "descending-vertical" // нисходящее вертикальное
  | "ascending-incline"   // восходящее наклонное
  | "ascending-vertical"; // восходящее вертикальное

export interface StabilityRow {
  branchId: string;
  index: number;             // № п/п в своей категории
  branchNumber: string;      // № ветви
  position: string;          // позиция ПЛА (если привязана)
  name: string;              // наименование ветви
  angleDeg: number;          // угол наклона (по модулю), град
  signedAngleFlow: number;   // угол в направлении потока (знак: - вниз, + вверх)
  length: number;            // длина, м
  area: number;              // сечение, м²
  velocity: number;          // скорость воздуха, м/с
  flow: number;              // расход воздуха, м³/с (модуль)
  firePower_MW: number;      // расчётная мощность пожара, МВт
  fireTemp_C: number;        // расчётная температура пожара, °C
  thermalDep_Pa: number;     // тепловая депрессия пожара, Па
  branchDep_Pa: number;      // располагаемая депрессия ветви, Па
  stable: boolean;           // устойчиво?
  stability: string;         // "Устойчиво" / "Неустойчиво"
  fireLoadDesc: string;      // описание пожарной нагрузки
  category: StabilityCategory;
}

export interface StabilityResult {
  rows: StabilityRow[];
  byCategory: Record<StabilityCategory, StabilityRow[]>;
  angleFilter: number;       // применённый фильтр угла, град
  lengthFilter: number;      // применённый фильтр длины, м
  ambientTemp: number;       // °C
  totalUnstable: number;     // сколько неустойчивых ветвей
}

// Порог «вертикальная» выработка: угол ≥ этого значения считается вертикальным
const VERTICAL_ANGLE_DEG = 80;

// ─── Суммарная мощность пожара ветви (все источники) ────────────────────────
export function calcBranchFirePower(b: TopoBranch, airFlow: number): number {
  let power = 0;

  if (b.fireLoadTech) {
    const r = calcVehicleFire(
      [b.fireVehicleMassRubber ?? 0, b.fireVehicleMassDiesel ?? 0, b.fireVehicleMassOil ?? 0],
      airFlow,
    );
    power += r.power_MW;
  }
  if (b.fireLoadConveyor) {
    const r = calcBelt({
      burnRate: b.fireBeltBurnRate, density: b.fireBeltDensity,
      width: b.fireBeltWidth, length: b.fireBeltLength,
      thickness: b.fireBeltThickness, flameSpeed: b.fireBeltFlameSpeed,
    }, airFlow);
    if (r) power += r.powerMax;
  }
  if (b.fireLoadCable) {
    const r = calcLinearFire({
      heatValue: b.fireCableHeatValue, burnRate: b.fireCableBurnRate,
      density: b.fireCableDensity, length: b.fireCableLength,
      sectionWidth: b.fireCableWidth, sectionThick: b.fireCableThick,
    }, airFlow);
    if (r) power += r.powerMW;
  }
  if (b.fireLoadWoodSupport) {
    const r = calcLinearFire({
      heatValue: b.fireWoodHeatValue, burnRate: b.fireWoodBurnRate,
      density: b.fireWoodDensity, length: b.fireWoodLength,
      sectionWidth: b.fireWoodWidth, sectionThick: b.fireWoodThick,
      flameSpeed: b.fireWoodFlameSpeed, calcTime: b.fireWoodCalcTime,
    }, airFlow);
    if (r) power += r.powerMW;
  }
  return power;
}

// ─── Текстовое описание пожарной нагрузки ───────────────────────────────────
export function describeFireLoad(b: TopoBranch): string {
  const parts: string[] = [];
  if (b.fireLoadTech) {
    const name = b.fireVehicleName || "Техника";
    const r = b.fireVehicleMassRubber ?? 0, d = b.fireVehicleMassDiesel ?? 0, o = b.fireVehicleMassOil ?? 0;
    parts.push(`Техника: ${name}, резина — ${r}кг., дизель — ${d}л., масло — ${o}л.`);
  }
  if (b.fireLoadConveyor)    parts.push(b.fireBeltName || "Конвейерная лента");
  if (b.fireLoadCable)       parts.push(b.fireCableName || "Электрокабель");
  if (b.fireLoadWoodSupport) parts.push(b.fireWoodName || "Деревянная крепь");
  return parts.join("; ");
}

// Есть ли на ветви пожарная нагрузка
export function hasFireLoad(b: TopoBranch): boolean {
  return !!(b.fireLoadTech || b.fireLoadConveyor || b.fireLoadCable || b.fireLoadWoodSupport);
}

// ─── Основной пакетный расчёт устойчивости ──────────────────────────────────
export function calcFireStability(
  branches: TopoBranch[],
  nodes: TopoNode[],
  opts: {
    angleFilter?: number;   // мин. угол наклона (по модулю), град. По умолчанию 5
    lengthFilter?: number;  // мин. длина, м. По умолчанию 30
    ambientTemp?: number;   // °C. По умолчанию 20
    positions?: { branchIds?: string[]; number?: number; name?: string }[]; // позиции ПЛА
  } = {},
): StabilityResult {
  const angleFilter  = opts.angleFilter  ?? 5;
  const lengthFilter = opts.lengthFilter ?? 30;
  const ambientTemp  = opts.ambientTemp  ?? 20;

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Позиция ПЛА по ветви (первая привязанная)
  const posByBranch = new Map<string, string>();
  (opts.positions ?? []).forEach(p => {
    const label = p.number != null ? String(p.number) : (p.name || "");
    (p.branchIds ?? []).forEach(bid => {
      if (bid && !posByBranch.has(bid)) posByBranch.set(bid, label);
    });
  });

  const byCategory: Record<StabilityCategory, StabilityRow[]> = {
    "descending-incline": [],
    "descending-vertical": [],
    "ascending-incline": [],
    "ascending-vertical": [],
  };

  for (const b of branches) {
    if (!hasFireLoad(b)) continue;

    const from = nodeById.get(b.fromId);
    const to   = nodeById.get(b.toId);

    // Геометрический угол (знак: to выше from → +)
    const geomAngle = (from && to) ? calcBranchAngle(from, to) : (b.angle ?? 0);
    const absAngle  = Math.abs(geomAngle);

    // Фильтр по наклону и длине
    if (absAngle < angleFilter) continue;
    if ((b.length ?? 0) < lengthFilter) continue;

    // Направление проветривания ПО ПОТОКУ:
    // flow>0 → воздух идёт from→to (в сторону +угла), flow<0 → наоборот.
    const flow = b.flow ?? 0;
    if (Math.abs(flow) < 1e-6) continue; // без потока — вне анализа
    const flowSign = flow >= 0 ? 1 : -1;
    const signedAngleFlow = geomAngle * flowSign; // <0 нисходящее, >0 восходящее
    const descending = signedAngleFlow < 0;

    const isVertical = absAngle >= VERTICAL_ANGLE_DEG;
    const category: StabilityCategory = descending
      ? (isVertical ? "descending-vertical" : "descending-incline")
      : (isVertical ? "ascending-vertical"  : "ascending-incline");

    const airFlow = Math.abs(flow);
    const firePower = calcBranchFirePower(b, airFlow);
    const fireTemp  = calcFireTemp(firePower, airFlow, ambientTemp);

    // ── Устойчивость: используем ТОТ ЖЕ критерий, что и аварийный режим
    //    (fireCalculator.calcFireMode), чтобы результаты полностью совпадали.
    //
    // Тепловая депрессия пожара считается по ЗНАКОВОМУ углу в направлении
    // потока: нисходящая струя → отрицательная депрессия → способствует
    // опрокидыванию. Знак берём из signedAngleFlow (учёт направления воздуха).
    const thermalDepSigned = calcThermalDepression(
      fireTemp, ambientTemp, b.length ?? 0, signedAngleFlow,
    );
    const thermalDep = Math.abs(thermalDepSigned);
    const branchDep  = Math.abs(b.dP ?? 0);

    // Критерий опрокидывания (идентичен calcFireMode, строка 488-489):
    //   нисходящая ветвь (угол по потоку < -1°) И
    //   |тепловая депрессия| > |депрессия ветви| × 0.5
    // Иначе — струя устойчива. Восходящие всегда устойчивы.
    const willReverse = (signedAngleFlow < -1) && (thermalDep > branchDep * 0.5);
    const stable = !willReverse;

    const row: StabilityRow = {
      branchId: b.id,
      index: 0, // проставим ниже
      branchNumber: b.id.slice(-4),
      position: posByBranch.get(b.id) || "",
      name: b.type || "",
      angleDeg: +absAngle.toFixed(2),
      signedAngleFlow: +signedAngleFlow.toFixed(2),
      length: +(b.length ?? 0).toFixed(2),
      area: +(b.area ?? 0).toFixed(2),
      velocity: +(b.velocity ?? 0).toFixed(3),
      flow: +airFlow.toFixed(3),
      firePower_MW: +firePower.toFixed(2),
      fireTemp_C: +fireTemp.toFixed(1),
      thermalDep_Pa: +thermalDep.toFixed(1),
      branchDep_Pa: +branchDep.toFixed(1),
      stable,
      stability: stable ? "Устойчиво" : "Неустойчиво",
      fireLoadDesc: describeFireLoad(b),
      category,
    };
    byCategory[category].push(row);
  }

  // Нумерация внутри каждой категории
  const rows: StabilityRow[] = [];
  (Object.keys(byCategory) as StabilityCategory[]).forEach(cat => {
    byCategory[cat].forEach((r, i) => { r.index = i + 1; rows.push(r); });
  });

  const totalUnstable = rows.filter(r => !r.stable).length;

  return { rows, byCategory, angleFilter, lengthFilter, ambientTemp, totalUnstable };
}