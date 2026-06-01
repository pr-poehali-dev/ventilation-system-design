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
  // Время прихода задымления от очага до ветви (минуты)
  smokeArrivalTime: number;
}

export interface FireCalculationResult {
  fireTemp: number;
  fireThermalDep: number;
  branches: Map<string, FireBranchResult>;
  reversedBranches: Set<string>;
  log: string[];
  // Максимальное время распространения задымления (минуты)
  maxSmokeTime: number;
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
    return { fireTemp: ambientTemp_C, fireThermalDep: 0, branches: resultMap, reversedBranches, log: ["Очагов пожара не обнаружено"], maxSmokeTime: 60 };
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

    // Вносим задымление в ВЫХОДНОЙ узел очага
    const outNodeId = (fb.flow ?? 0) >= 0 ? fb.toId : fb.fromId;
    const inNodeId  = (fb.flow ?? 0) >= 0 ? fb.fromId : fb.toId;
    const nc = getNC(outNodeId);
    nc.smokedQ += airQ;
    nc.wCO += coConc * airQ;
    nc.wCO2 += co2Conc * airQ;
    nc.wSmoke += smokeDensity * airQ;
    nc.wTemp += fireTemp * airQ;

    // Позиция очага вдоль ветви: 0=fromId, 1=toId
    // Если поток идёт от fromId→toId (flow>=0), очаг находится на расстоянии fireT*length от входа
    // Время от очага до выходного узла = (1 - fireT) * length / speed
    const fireT = (fb.fireT ?? 0.5);
    // Доля ветви ОТ очага ДО выходного узла
    const fracToOut = (fb.flow ?? 0) >= 0 ? (1 - fireT) : fireT;
    const smokeSpeed = airQ > 0 && (fb.area ?? 0) > 0 ? airQ / fb.area : 0.5;
    const outTime = (fb.length ?? 0) > 0 && smokeSpeed > 0
      ? (fb.length * fracToOut) / smokeSpeed / 60
      : 0;

    // Входной узел очага помечаем как "уже прошли" (дым туда не идёт назад)
    if (!nodeArrivalTime.has(inNodeId)) nodeArrivalTime.set(inNodeId, 0);
    // Выходной узел получает дым через outTime минут от начала пожара
    if (!nodeArrivalTime.has(outNodeId) || nodeArrivalTime.get(outNodeId)! > outTime) {
      nodeArrivalTime.set(outNodeId, outTime);
    }

    // smokeArrivalTime самой ветви-очага = 0 (горит сразу, видна всегда)
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
      smokeArrivalTime: 0,
    });
    if (willReverse) reversedBranches.add(fb.id);

    log.push(`Ветвь ${fb.id}: Q_пожара=${Q_MW} МВт, T=${Math.round(fireTemp)}°C, h_t=${Math.round(thermalDep)} Па, CO=${coConc.toFixed(3)}%, вид.=${Math.round(visibility)} м${willReverse ? " ⚠️ ОПРОКИДЫВАНИЕ" : ""}`);
  }

  // ── Шаг 3: Предварительно регистрируем свежие потоки в узлах ─────────────
  // Нужно для правильного разбавления дыма при смешении струй в узлах
  const fireBranchIds = new Set<string>(fireBranches.map(b => b.id));
  for (const b of branches) {
    if (fireBranchIds.has(b.id)) continue;
    const flow = b.flow ?? 0;
    if (Math.abs(flow) < 0.01) continue;
    const outNodeId = flow >= 0 ? b.toId : b.fromId;
    // Регистрируем как потенциальный свежий поток (будет уточнён в BFS)
    const outNc = getNC(outNodeId);
    outNc.freshQ += Math.abs(flow);
  }

  // ── Шаг 4: BFS распространения задымления ─────────────────────────────────
  // Алгоритм: очередь узлов, у которых появилось задымление.
  // Для каждого задымлённого узла обходим все ветви, которые из него выходят.

  // Начальная очередь — все выходные узлы очагов пожара
  const smokedNodes = new Set<string>();
  for (const fb of fireBranches) {
    const outNodeId = (fb.flow ?? 0) >= 0 ? fb.toId : fb.fromId;
    smokedNodes.add(outNodeId);
  }

  // Итеративно распространяем дым: пока есть новые задымлённые узлы
  const MAX_ITER = branches.length * 2 + 10;
  let iter = 0;
  let frontier = new Set<string>(smokedNodes);

  while (frontier.size > 0 && iter++ < MAX_ITER) {
    const nextFrontier = new Set<string>();

    for (const b of branches) {
      if (fireBranchIds.has(b.id)) continue;
      const flow = b.flow ?? 0;
      if (Math.abs(flow) < 0.01) continue;

      const inNodeId  = flow >= 0 ? b.fromId : b.toId;
      const outNodeId = flow >= 0 ? b.toId   : b.fromId;

      // Обрабатываем ветвь, если её входной узел задымлён
      if (!smokedNodes.has(inNodeId)) continue;

      const nc = nodeContribs.get(inNodeId);
      if (!nc || nc.smokedQ < 0.001) continue;

      const totalIn = nc.smokedQ + nc.freshQ;
      if (totalIn < 0.001) continue;

      // Взвешенная концентрация с учётом разбавления свежим воздухом
      const mixFactor = nc.smokedQ / totalIn;
      const coIn    = (nc.wCO    / nc.smokedQ) * mixFactor;
      const co2In   = (nc.wCO2   / nc.smokedQ) * mixFactor;
      const smokeIn = (nc.wSmoke / nc.smokedQ) * mixFactor;
      const tempIn  = ambientTemp_C + ((nc.wTemp / nc.smokedQ) - ambientTemp_C) * mixFactor;

      // Небольшое затухание вдоль длины (оседание, охлаждение)
      const lengthFactor = Math.max(0.3, Math.exp(-b.length * 0.001));
      const coOut    = coIn    * lengthFactor;
      const smokeOut = smokeIn * lengthFactor;
      const co2Out   = Math.max(0.04, co2In * lengthFactor);
      const tempOut  = ambientTemp_C + (tempIn - ambientTemp_C) * Math.exp(-b.length * 0.002);
      const visOut   = smokeOut > 0 ? Math.min(100, 3 / smokeOut) : 100;

      // Слабый порог — не останавливаем распространение преждевременно
      if (coOut < 0.0001 && smokeOut < 0.001) continue;

      const hazard = calcHazardLevel(coOut, co2Out, smokeOut, tempOut);

      // Время прихода дыма к ВХОДУ этой ветви
      const branchArrivalTime = nodeArrivalTime.get(inNodeId) ?? 0;
      // Скорость движения дыма = скорость воздуха = Q / S
      const bSmokeSpeed = Math.abs(flow) > 0 && b.area > 0 ? Math.abs(flow) / b.area : 0.5;
      // Время прохода дыма через всю ветвь до выходного узла (мин)
      const bTransitMin = b.length > 0 && bSmokeSpeed > 0 ? b.length / bSmokeSpeed / 60 : 0;
      const bOutTime = branchArrivalTime + bTransitMin;

      // Обновляем время прихода в выходной узел
      const prevOut = nodeArrivalTime.get(outNodeId);
      if (prevOut === undefined || bOutTime < prevOut) {
        nodeArrivalTime.set(outNodeId, bOutTime);
        nextFrontier.add(outNodeId);
      }

      // Если выходной узел ещё не был задымлён — добавляем
      if (!smokedNodes.has(outNodeId)) {
        smokedNodes.add(outNodeId);
        nextFrontier.add(outNodeId);
      }

      // Записываем результат по ветви (smokeArrivalTime = когда дым вошёл в ветвь)
      const existing = resultMap.get(b.id);
      if (!existing || branchArrivalTime < existing.smokeArrivalTime) {
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
          smokeArrivalTime: Math.round(branchArrivalTime * 10) / 10,
        });
      }

      // Вносим задымлённый поток в выходной узел (если ещё не было)
      const outNc = getNC(outNodeId);
      // Убираем ранее добавленный свежий поток этой ветви — теперь она несёт дым
      outNc.freshQ = Math.max(0, outNc.freshQ - Math.abs(flow));
      outNc.smokedQ += Math.abs(flow);
      outNc.wCO    += coOut    * Math.abs(flow);
      outNc.wCO2   += co2Out   * Math.abs(flow);
      outNc.wSmoke += smokeOut * Math.abs(flow);
      outNc.wTemp  += tempOut  * Math.abs(flow);
    }

    frontier = nextFrontier;
  }

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
  maxSmokeTime = Math.ceil(maxSmokeTime) || 60;

  return {
    fireTemp: firstResult.airTempOut,
    fireThermalDep: firstResult.thermalDepression,
    branches: resultMap,
    reversedBranches,
    log,
    maxSmokeTime,
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