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
//   • Критерий для НИСХОДЯЩЕЙ струи (Прил. 5): опрокидывание наступает, когда
//     тепловая депрессия достигает критической h_кр (ф. 5.3–5.5).
//   • Критерий для ВОСХОДЯЩЕЙ струи (Прил. 7): условие стабильности h_т < R·Q₀²
//     (ф. 7.1); при его нарушении считается сопротивление перемычки R_доп (7.6).
//   • Степень устойчивости — показатель p_у = h_кр/h_т (Прил. 3, ф. 3.1):
//     p_у > 1 — устойчиво, 0.3…1 — неустойчиво, < 0.3 — весьма неустойчиво.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch, TopoNode } from "./topology";
import { calcBranchAngle } from "./topology";
import {
  calcVehicleFire, calcBelt, calcLinearFire,
  calcFireTemp, calcThermalDepression, calcCriticalDepression, FLAT_ANGLE_DEG,
} from "./fireCalculator";

// Факт пожара по ветви из реального итеративного расчёта сети (как в
// аварийном режиме): развернулся ли поток + параметры ПРИ ПОЖАРЕ.
export interface FireStabilityFact {
  reversed: boolean;     // поток фактически развернулся
  fireFlow: number;      // расход воздуха ПРИ ПОЖАРЕ, м³/с (модуль)
  firePower: number;     // мощность пожара, МВт
  fireTemp: number;      // температура продуктов горения, °C
  thermalDep: number;    // тепловая депрессия пожара, Па (модуль)
}

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
  velocityNormal: number;    // скорость воздуха ДО пожара, м/с
  flowNormal: number;        // расход воздуха ДО пожара, м³/с (модуль)
  velocity: number;          // скорость воздуха ПРИ ПОЖАРЕ, м/с
  flow: number;              // расход воздуха ПРИ ПОЖАРЕ, м³/с (модуль)
  firePower_MW: number;      // расчётная мощность пожара, МВт
  fireTemp_C: number;        // расчётная температура пожара, °C
  thermalDep_Pa: number;     // тепловая депрессия пожара, Па
  branchDep_Pa: number;      // располагаемая депрессия ветви, Па
  hKr_Pa: number | null;     // критическая депрессия h_кр (5.3), Па (null — нет параллельной выработки)
  exceedsCritical: boolean;  // |h_т| ≥ h_кр (опрокидывание по нормативу)
  p_u: number | null;        // показатель устойчивости p_у = h_кр/h_т (Прил. 3, ф. 3.1)
  stabilityClass: StabilityClass; // класс по p_у (Прил. 3)
  // ── Приложение 7: восходящие выработки ──────────────────────────────
  Q0_m3s: number | null;     // критический расход Q₀ (ф. 7.3), м³/с
  R_calc: number | null;     // расчётное сопротивление R_р = h_т/Q₀² (ф. 7.5)
  R_fact: number | null;     // фактическое сопротивление ветви R
  R_dop: number | null;      // требуемое сопротивление перемычки R_доп (ф. 7.6)
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
  totalVeryUnstable: number; // из них «весьма неустойчивых» (p_у < 0.3)
}

// Порог «вертикальная» выработка: угол ≥ этого значения считается вертикальным
const VERTICAL_ANGLE_DEG = 80;

// Класс устойчивости по показателю p_у (Прил. 3):
//   p_у > 1 — устойчивая; 0.3 ≤ p_у ≤ 1 — неустойчивая; p_у < 0.3 — весьма неустойчивая.
export type StabilityClass = "stable" | "unstable" | "very-unstable";

export const P_U_VERY_UNSTABLE = 0.3;

export function classifyByPu(p_u: number): StabilityClass {
  if (p_u > 1) return "stable";
  return p_u < P_U_VERY_UNSTABLE ? "very-unstable" : "unstable";
}

export const STABILITY_CLASS_LABEL: Record<StabilityClass, string> = {
  "stable": "Устойчиво",
  "unstable": "Неустойчиво",
  "very-unstable": "Весьма неустойчиво",
};

// ─── Суммарная мощность пожара ветви (все источники) ────────────────────────
export function calcBranchFirePower(b: TopoBranch, airFlow: number): number {
  let power = 0;

  // Длина ветви — дефолт для длины горючего материала, если поле не заполнено.
  const branchLenStr = b.length && b.length > 0 ? String(b.length) : "";

  if (b.fireLoadTech) {
    const r = calcVehicleFire(
      [b.fireVehicleMassRubber ?? 0, b.fireVehicleMassDiesel ?? 0, b.fireVehicleMassOil ?? 0],
      airFlow,
    );
    power += r.power_MW;
  }
  if (b.fireLoadConveyor) {
    const r = calcBelt({
      burnRate: b.fireBeltBurnRate ?? "0.0125", density: b.fireBeltDensity ?? "1100",
      width: b.fireBeltWidth ?? "1.2", length: b.fireBeltLength ?? (branchLenStr || "100"),
      thickness: b.fireBeltThickness ?? "0.016", flameSpeed: b.fireBeltFlameSpeed ?? "0.013",
    }, airFlow);
    if (r) power += r.powerMax;
  }
  if (b.fireLoadCable) {
    const r = calcLinearFire({
      heatValue: b.fireCableHeatValue ?? "25", burnRate: b.fireCableBurnRate ?? "0.007",
      density: b.fireCableDensity ?? "900", length: b.fireCableLength ?? (branchLenStr || "100"),
      sectionWidth: b.fireCableWidth ?? "0.05", sectionThick: b.fireCableThick ?? "0.05",
    }, airFlow);
    if (r) power += r.powerMW;
  }
  if (b.fireLoadWoodSupport) {
    // ВАЖНО: flameSpeed и calcTime задают «нарастающий пожар» — площадь горения
    // за расчётное время, а не по всей длине ветви. Без них calcLinearFire берёт
    // полную площадь и завышает мощность. Дефолты должны совпадать с вкладкой
    // «Пожарная нагрузка» (BranchPropsPanel), чтобы результаты не расходились.
    const r = calcLinearFire({
      heatValue: b.fireWoodHeatValue ?? "13.8", burnRate: b.fireWoodBurnRate ?? "0.027",
      density: b.fireWoodDensity ?? "500", length: b.fireWoodLength ?? (branchLenStr || "50"),
      sectionWidth: b.fireWoodWidth ?? "8.9", sectionThick: b.fireWoodThick ?? "0.08",
      flameSpeed: b.fireWoodFlameSpeed ?? "0.024", calcTime: b.fireWoodCalcTime ?? "10",
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
    // Факты пожара из реального итеративного расчёта сети (branchId → факт).
    // Если переданы — устойчивость И параметры (расход/температура/депрессия)
    // берутся ПО ФАКТУ пожара, а не по локальной оценке на дожаровых расходах.
    reversalFacts?: Map<string, FireStabilityFact>;
  } = {},
): StabilityResult {
  const angleFilter  = opts.angleFilter  ?? 5;
  const lengthFilter = opts.lengthFilter ?? 30;
  const ambientTemp  = opts.ambientTemp  ?? 20;

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  // Высотные отметки узлов — нужны формуле 5.4, чтобы отличить сбойки
  // выше очага (R₁) от сбоек ниже очага (R₂).
  const nodeElevations = new Map(nodes.map(n => [n.id, n.z ?? 0]));

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

    // Факт пожара по этой ветви из реального итеративного расчёта сети (если есть).
    const fact = opts.reversalFacts?.get(b.id);

    // Расход/мощность/температура/депрессия — ПРИ ПОЖАРЕ (по факту), иначе
    // предварительная оценка на дожаровом расходе. С фактом цифры совпадают
    // со вкладкой «Аварии» (расход при пожаре меньше → температура выше).
    const dojarFlow = Math.abs(flow);
    const airFlow   = fact ? fact.fireFlow : dojarFlow;
    const firePower = fact ? fact.firePower : calcBranchFirePower(b, dojarFlow);
    const fireTemp  = fact ? fact.fireTemp  : calcFireTemp(firePower, dojarFlow, ambientTemp);

    // Тепловая депрессия пожара. С фактом — из итеративного расчёта; без факта —
    // локальная оценка по знаковому углу в направлении потока.
    const thermalDep = fact
      ? fact.thermalDep
      : Math.abs(calcThermalDepression(fireTemp, ambientTemp, b.length ?? 0, signedAngleFlow));
    const branchDep  = Math.abs(b.dP ?? 0);

    // ── Критическая депрессия (Прил. 5, формулы 5.3–5.5) ────────────────
    // Передаём ΔP ветви и высотные отметки узлов — без них не работали
    // формула 5.4 (сбойки с перемычками) и случай «уклонное поле с одной
    // воздухоподающей выработкой», из-за чего h_кр часто не рассчитывалась.
    // Высота очага — интерполяция по fireT между узлами from→to.
    const fireZ = (from?.z ?? 0) + ((to?.z ?? 0) - (from?.z ?? 0)) * (b.fireT ?? 0.5);
    const crit = descending
      ? calcCriticalDepression({
          fireBranchId: b.id, fireFromId: b.fromId, fireToId: b.toId,
          fireFlow_m3s: airFlow, fireDP_pa: b.dP, branches,
          nodeElevations, fireElevation: fireZ,
        })
      : null;
    const hKr_Pa = (crit && crit.hasParallel && crit.h_kr > 0) ? +crit.h_kr.toFixed(1) : null;
    const exceedsCritical = hKr_Pa != null && thermalDep >= hKr_Pa;

    // ── Определение устойчивости ────────────────────────────────────────
    // Приоритет — ФАКТ опрокидывания из реального итеративного расчёта сети
    // (reversalFacts). Если факт передан — используем его: ветвь устойчива,
    // если поток НЕ развернулся, даже при большой тепловой депрессии
    // (соседние ветви компенсируют). Это совпадает с аварийным режимом.
    //
    // Без факта — тот же нормативный критерий, что и в calcFireMode:
    // нисходящая струя опрокидывается, когда тепловая депрессия достигает
    // критической h_кр (Прил. 5). Если h_кр рассчитать нельзя — сравниваем
    // с депрессией самого участка |ΔP|. Прежний порог 0.5·|ΔP| был
    // эвристическим и занижал границу вдвое (акт расходился с «Авариями»).
    const reversalThreshold = hKr_Pa != null ? hKr_Pa : branchDep;
    const willReverse = (signedAngleFlow < -FLAT_ANGLE_DEG)
      && reversalThreshold > 0 && thermalDep >= reversalThreshold;

    // ── Приложение 7: пожар в выработке с ВОСХОДЯЩИМ движением воздуха ──
    // Под действием тепловой депрессии может опрокинуться струя в параллельной
    // выработке. Условие стабильного проветривания (7.1): h_т < R·Q₀².
    //   Q₀  — критический расход, ориентировочно (7.3): Q₀ = Q₁ + 0.03·h₁;
    //   R_р — расчётное сопротивление (7.5): R_р = h_т / Q₀²;
    //   R_доп — сопротивление перемычки ниже очага (7.6): R_доп > R_р − R.
    let Q0_m3s: number | null = null;
    let R_calc: number | null = null;
    let R_dop: number | null = null;
    let ascendingUnstable = false;
    const R_fact = (b.resistance ?? 0) > 0 ? +(b.resistance ?? 0).toFixed(6) : null;

    if (!descending && absAngle > FLAT_ANGLE_DEG && thermalDep > 0) {
      // (7.3) Q₀ = Q₁ + 0.03·h₁ — расход и депрессия в нормальном режиме.
      const Q0 = dojarFlow + 0.03 * branchDep;
      if (Q0 > 0) {
        Q0_m3s = +Q0.toFixed(3);
        // (7.5) расчётное сопротивление, при котором исключается опрокидывание
        R_calc = +(thermalDep / (Q0 * Q0)).toFixed(6);
        // (7.1) устойчиво, пока h_т < R·Q₀²
        if (R_fact != null) {
          ascendingUnstable = thermalDep >= R_fact * Q0 * Q0;
          // (7.6) требуемое сопротивление перемычки — только если факт < расчётного
          if (R_calc > R_fact) R_dop = +(R_calc - R_fact).toFixed(6);
        }
      }
    }

    const stable = fact ? !fact.reversed : !(willReverse || ascendingUnstable);

    // ── Показатель устойчивости p_у (Прил. 3, ф. 3.1): p_у = h_кр / h_т ──
    // Для восходящих выработок роль критической депрессии играет R·Q₀² (7.1).
    const puBase = descending
      ? hKr_Pa
      : (R_fact != null && Q0_m3s != null ? R_fact * Q0_m3s * Q0_m3s : null);
    const p_u = (puBase != null && puBase > 0 && thermalDep > 0.01)
      ? +(puBase / thermalDep).toFixed(2)
      : null;
    // Класс согласуем с вердиктом: вердикт может опираться на ФАКТ пожара
    // (реальный расчёт сети), поэтому он главнее показателя. Показатель p_у
    // уточняет степень неустойчивости («весьма неустойчиво» при p_у < 0.3).
    const stabilityClass: StabilityClass = stable
      ? "stable"
      : (p_u != null && p_u < P_U_VERY_UNSTABLE ? "very-unstable" : "unstable");

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
      velocityNormal: +(b.velocity ?? 0).toFixed(3),
      flowNormal: +dojarFlow.toFixed(3),
      velocity: +((b.area ?? 0) > 0 ? airFlow / (b.area ?? 1) : (b.velocity ?? 0)).toFixed(3),
      flow: +airFlow.toFixed(3),
      firePower_MW: +firePower.toFixed(2),
      fireTemp_C: +fireTemp.toFixed(1),
      thermalDep_Pa: +thermalDep.toFixed(1),
      branchDep_Pa: +branchDep.toFixed(1),
      hKr_Pa,
      exceedsCritical,
      p_u,
      stabilityClass,
      Q0_m3s,
      R_calc,
      R_fact,
      R_dop,
      stable,
      stability: STABILITY_CLASS_LABEL[stabilityClass],
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
  const totalVeryUnstable = rows.filter(r => r.stabilityClass === "very-unstable").length;

  return { rows, byCategory, angleFilter, lengthFilter, ambientTemp, totalUnstable, totalVeryUnstable };
}