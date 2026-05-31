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

// ─── Характеристики горючих материалов ───────────────────────────────────────
export interface CombustibleProps {
  id: string;
  name: string;
  coYield: number;      // кг CO / кг горючего
  co2Yield: number;     // кг CO₂ / кг горючего
  smokeYield: number;   // кг дыма / кг горючего
  heatValue: number;    // МДж/кг — удельная теплота горения
  spreadRate: number;   // м/мин — скорость распространения
}

export const COMBUSTIBLES: CombustibleProps[] = [
  { id: "coal",    name: "Уголь",             coYield: 0.04, co2Yield: 2.2,  smokeYield: 0.03,  heatValue: 25, spreadRate: 0.5 },
  { id: "timber",  name: "Древесина (крепь)", coYield: 0.05, co2Yield: 1.5,  smokeYield: 0.015, heatValue: 16, spreadRate: 1.0 },
  { id: "cable",   name: "Кабель",            coYield: 0.10, co2Yield: 1.8,  smokeYield: 0.12,  heatValue: 18, spreadRate: 0.3 },
  { id: "oil",     name: "Масло/горючее",     coYield: 0.06, co2Yield: 3.1,  smokeYield: 0.08,  heatValue: 42, spreadRate: 2.0 },
  { id: "conveyor",name: "Конвейерная лента", coYield: 0.08, co2Yield: 2.0,  smokeYield: 0.10,  heatValue: 20, spreadRate: 0.8 },
  { id: "custom",  name: "Произвольный",      coYield: 0.05, co2Yield: 2.0,  smokeYield: 0.05,  heatValue: 25, spreadRate: 1.0 },
];

export function getCombustible(id: string): CombustibleProps {
  return COMBUSTIBLES.find(c => c.id === id) ?? COMBUSTIBLES[COMBUSTIBLES.length - 1];
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
  coConc: number;
  co2Conc: number;
  smokeDensity: number;
  visibility: number;
  hazardLevel: "safe" | "warning" | "danger" | "lethal";
  // Изменение расхода воздуха из-за тепловой депрессии (м³/с)
  flowDelta?: number;
}

export interface FireCalculationResult {
  fireTemp: number;
  fireThermalDep: number;
  branches: Map<string, FireBranchResult>;
  reversedBranches: Set<string>;
  log: string[];
}

// ─── Физические формулы ───────────────────────────────────────────────────────

export function calcFireTemp(
  heatRelease_MW: number,
  airFlow_m3s: number,
  ambientTemp_C = 20,
): number {
  if (airFlow_m3s <= 0) return ambientTemp_C + 500;
  const Q_W = heatRelease_MW * 1e6;
  const rho = RHO_AIR_0 * 293 / (273 + ambientTemp_C);
  const massFlow = rho * airFlow_m3s;
  const deltaT = Q_W / (massFlow * CP_AIR * 1000);
  return Math.min(1200, ambientTemp_C + deltaT);
}

export function calcThermalDepression(
  fireTemp_C: number,
  ambientTemp_C: number,
  branchLength_m: number,
  branchAngle_deg: number,
): number {
  const Tf = fireTemp_C + 273;
  const T0 = ambientTemp_C + 273;
  const sinA = Math.sin((branchAngle_deg * Math.PI) / 180);
  const rho = RHO_AIR_0 * 293 / T0;
  return G * branchLength_m * Math.abs(sinA) * ((Tf - T0) / T0) * rho * Math.sign(sinA);
}

export function calcGasConcentrations(
  heatRelease_MW: number,
  airFlow_m3s: number,
  combustible: CombustibleProps,
): { coConc: number; co2Conc: number; smokeDensity: number; visibility: number } {
  if (airFlow_m3s <= 0) {
    return { coConc: 2.0, co2Conc: 15.0, smokeDensity: 10, visibility: 0 };
  }
  const burnRate_kgs = (heatRelease_MW * 1e3) / combustible.heatValue;
  const airFlow_Nm3s = airFlow_m3s * (RHO_AIR_0 / 1.293);

  const coVolRate = (burnRate_kgs * combustible.coYield) / 1.25;
  const coConc = Math.min(2.0, (coVolRate / (airFlow_Nm3s + coVolRate)) * 100);

  const co2VolRate = (burnRate_kgs * combustible.co2Yield) / 1.977;
  const co2Conc = Math.min(20.0, (co2VolRate / (airFlow_Nm3s + co2VolRate)) * 100 + 0.04);

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
): FireCalculationResult {
  const log: string[] = [];
  const resultMap = new Map<string, FireBranchResult>();
  const reversedBranches = new Set<string>();

  // Индекс узлов для быстрого поиска
  void nodes;

  // ── Шаг 1: Находим ветви с пожарами ──────────────────────────────────────
  const fireBranches = branches.filter(b => b.hasFire);
  if (fireBranches.length === 0) {
    return { fireTemp: ambientTemp_C, fireThermalDep: 0, branches: resultMap, reversedBranches, log: ["Очагов пожара не обнаружено"] };
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

  const getNC = (nid: string): NodeContrib => {
    if (!nodeContribs.has(nid)) nodeContribs.set(nid, { smokedQ: 0, freshQ: 0, wCO: 0, wCO2: 0, wSmoke: 0, wTemp: 0 });
    return nodeContribs.get(nid)!;
  };

  for (const fb of fireBranches) {
    const Q_MW = fb.fireMode === "heat" ? fb.fireHeatRelease : 0;
    const airQ = Math.abs(fb.flow ?? 0);

    // Температура на выходе очага
    const fireTemp = fb.fireMode === "temp"
      ? fb.fireTemperature
      : calcFireTemp(Q_MW, airQ, ambientTemp_C);

    // Тепловая депрессия
    const thermalDep = calcThermalDepression(fireTemp, ambientTemp_C, fb.length, fb.angle ?? 0);

    // Концентрации
    const comb = getCombustible(fb.fireCombustible ?? "coal");
    const { coConc, co2Conc, smokeDensity, visibility } = calcGasConcentrations(Q_MW, airQ, comb);

    // Опрокидывание: нисходящая ветвь, тепловая депрессия > аэродинамической депрессии ветви
    const isDescending = (fb.angle ?? 0) < -1;
    const willReverse = isDescending && Math.abs(thermalDep) > Math.abs(fb.dP ?? 0) * 0.5;

    // Оценка изменения расхода из-за тепловой депрессии
    // ΔQ ≈ h_t / (2 * R * Q) — линеаризованная формула для малых изменений
    const R = fb.resistance ?? 0;
    const flowDelta = (R > 0 && airQ > 0)
      ? Math.abs(thermalDep) / (2 * R * airQ) * (isDescending ? -1 : 1)
      : 0;

    const hazard = calcHazardLevel(coConc, co2Conc, smokeDensity, fireTemp);

    resultMap.set(fb.id, {
      branchId: fb.id,
      airTempOut: Math.round(fireTemp * 10) / 10,
      thermalDepression: Math.round(thermalDep * 10) / 10,
      willReverse,
      coConc: Math.round(coConc * 1000) / 1000,
      co2Conc: Math.round(co2Conc * 100) / 100,
      smokeDensity: Math.round(smokeDensity * 100) / 100,
      visibility: Math.round(visibility * 10) / 10,
      hazardLevel: hazard,
      flowDelta: Math.round(flowDelta * 100) / 100,
    });
    if (willReverse) reversedBranches.add(fb.id);

    log.push(`Ветвь ${fb.id}: Q_пожара=${Q_MW} МВт, T=${Math.round(fireTemp)}°C, h_t=${Math.round(thermalDep)} Па, CO=${coConc.toFixed(3)}%, вид.=${Math.round(visibility)} м${willReverse ? " ⚠️ ОПРОКИДЫВАНИЕ" : ""}`);

    // Вносим задымление в ВЫХОДНОЙ узел очага
    // Выходной узел = куда идёт поток из этой ветви
    const outNodeId = (fb.flow ?? 0) >= 0 ? fb.toId : fb.fromId;
    const nc = getNC(outNodeId);
    nc.smokedQ += airQ;
    nc.wCO += coConc * airQ;
    nc.wCO2 += co2Conc * airQ;
    nc.wSmoke += smokeDensity * airQ;
    nc.wTemp += fireTemp * airQ;
  }

  // ── Шаг 3: BFS распространения по потоку ──────────────────────────────────
  // Одновременно учитываем свежие потоки, входящие в каждый узел

  // Сначала добавляем свежие потоки в узлы (те ветви, что не являются очагами)
  // Это нужно чтобы правильно разбавлять дым в узлах с несколькими входами
  const processedBranches = new Set<string>(fireBranches.map(b => b.id));

  // Итерационный обход: топологическая сортировка по направлению потока
  // Простой вариант: MAX_HOPS итераций (достаточно для любой сети)
  const MAX_HOPS = branches.length + 5;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let changed = false;

    for (const b of branches) {
      if (processedBranches.has(b.id)) continue;
      const flow = b.flow ?? 0;
      if (Math.abs(flow) < 0.01) continue;

      // Входной узел этой ветви (откуда приходит воздух)
      const inNodeId = flow >= 0 ? b.fromId : b.toId;
      // Выходной узел (куда уходит воздух)
      const outNodeId = flow >= 0 ? b.toId : b.fromId;

      const nc = nodeContribs.get(inNodeId);
      if (!nc || nc.smokedQ < 0.001) {
        // Входной узел чистый — эта ветвь несёт свежий воздух
        // Добавляем её свежий поток в выходной узел (разбавление в следующих узлах)
        const outNc = getNC(outNodeId);
        outNc.freshQ += Math.abs(flow);
        processedBranches.add(b.id);
        changed = true;
        continue;
      }

      // Входной узел задымлён — считаем концентрацию с учётом разбавления
      const totalIn = nc.smokedQ + nc.freshQ;
      if (totalIn < 0.001) continue;

      // Взвешенная концентрация (разбавление свежим воздухом!)
      const mixFactor = nc.smokedQ / totalIn; // доля задымлённого потока
      const coIn    = (nc.wCO    / nc.smokedQ) * mixFactor;
      const co2In   = (nc.wCO2   / nc.smokedQ) * mixFactor;
      const smokeIn = (nc.wSmoke / nc.smokedQ) * mixFactor;
      const tempIn  = ambientTemp_C + ((nc.wTemp / nc.smokedQ) - ambientTemp_C) * mixFactor;

      // Затухание вдоль длины ветви
      const lengthFactor = Math.max(0.05, Math.exp(-b.length * 0.002));
      const coOut    = coIn    * lengthFactor;
      const smokeOut = smokeIn * lengthFactor;
      const co2Out   = Math.max(0.04, co2In * lengthFactor);
      const tempOut  = ambientTemp_C + (tempIn - ambientTemp_C) * Math.exp(-b.length * 0.003);
      const visOut   = smokeOut > 0 ? Math.min(100, 3 / smokeOut) : 100;

      // Порог значимости — не распространяем несущественное задымление
      if (coOut < 0.002 && smokeOut < 0.05) {
        // Свежий (разбавленный до нуля) — вносим как свежий в выходной
        const outNc = getNC(outNodeId);
        outNc.freshQ += Math.abs(flow);
        processedBranches.add(b.id);
        changed = true;
        continue;
      }

      const hazard = calcHazardLevel(coOut, co2Out, smokeOut, tempOut);
      resultMap.set(b.id, {
        branchId: b.id,
        airTempOut: Math.round(tempOut * 10) / 10,
        thermalDepression: 0,
        willReverse: false,
        coConc: Math.round(coOut * 1000) / 1000,
        co2Conc: Math.round(co2Out * 100) / 100,
        smokeDensity: Math.round(smokeOut * 100) / 100,
        visibility: Math.round(visOut * 10) / 10,
        hazardLevel: hazard,
      });

      // Вносим задымлённый поток в выходной узел
      const outNc = getNC(outNodeId);
      outNc.smokedQ += Math.abs(flow);
      outNc.wCO    += coOut    * Math.abs(flow);
      outNc.wCO2   += co2Out   * Math.abs(flow);
      outNc.wSmoke += smokeOut * Math.abs(flow);
      outNc.wTemp  += tempOut  * Math.abs(flow);

      processedBranches.add(b.id);
      changed = true;
    }

    if (!changed) break;
  }

  // ── Итоговая статистика ───────────────────────────────────────────────────
  const smokedCount = resultMap.size;
  log.push(`Задымлено ветвей: ${smokedCount} из ${branches.length}`);
  if (reversedBranches.size > 0) {
    log.push(`⚠️ Опрокидывание струи в ветвях: ${[...reversedBranches].join(", ")}`);
  }

  const firstFire = fireBranches[0];
  const firstResult = resultMap.get(firstFire.id)!;

  return {
    fireTemp: firstResult.airTempOut,
    fireThermalDep: firstResult.thermalDepression,
    branches: resultMap,
    reversedBranches,
    log,
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
