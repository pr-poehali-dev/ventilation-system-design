// ─────────────────────────────────────────────────────────────────────────────
// waterFireCheck.ts — Пакетная проверка пожарно-оросительного трубопровода
// на обеспеченность пожаротушения (нормативная проверка ППЗ).
//
// Идея (по образцу Акта устойчивости, см. fireStability.ts):
//   • Перебираем ВСЕ пожарные краны (узлы-потребители) сети по очереди.
//   • Для каждого крана моделируем расчётный пожар: открываем ТОЛЬКО его
//     (и, если норматив требует одновременной работы нескольких стволов —
//     ещё k−1 ближайших по сети крана), закрывая все остальные.
//   • Гоняем штатный гидравлический расчёт calcWaterNetwork на этом сценарии.
//   • Снимаем напор и расход у проверяемого крана и сверяем с нормативом:
//       − напор не ниже минимального (иначе струя не добьёт до очага);
//       − напор не выше максимального (иначе рвёт рукава, нужен редуктор);
//       − расход не ниже требуемого на ствол;
//       − время работы от запаса воды не ниже нормативного.
//   • Результат — таблица «худших точек сети»: где вода есть, где её не хватает
//     и чего именно не хватает (напора, расхода или запаса).
//
// Норматив задаётся параметрами (у разных предприятий свои требования),
// дефолты соответствуют типовым требованиям к подземному ППЗ.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoNode, TopoBranch } from "./topology";
import { calcWaterNetwork } from "./waterHydraulics";

/** Нормативные требования к точке водоразбора */
export interface WaterNorms {
  /** Минимальный свободный напор у крана, МПа */
  minPressure: number;
  /** Максимальный допустимый напор у крана, МПа */
  maxPressure: number;
  /** Минимальный расход через ствол, м³/ч */
  minFlow: number;
  /** Минимальное время работы от запаса воды, мин */
  minDuration: number;
  /** Сколько стволов работает одновременно (расчётный сценарий) */
  simultaneous: number;
  /** Максимальная допустимая скорость воды в трубе, м/с */
  maxVelocity: number;
}

export const DEFAULT_WATER_NORMS: WaterNorms = {
  minPressure: 0.6,
  maxPressure: 1.5,
  minFlow: 30,
  minDuration: 180,
  simultaneous: 2,
  maxVelocity: 5,
};

/** Причина несоответствия точки нормативу */
export type WaterFailKind =
  | "no-pressure"    // напор ниже минимального
  | "over-pressure"  // напор выше максимального
  | "low-flow"       // расход ниже требуемого
  | "short-duration" // запаса воды не хватает на нормативное время
  | "no-water"       // до крана вода вообще не доходит
  | "no-data";       // не задан диаметр/модель ствола — расчёт невозможен

export const FAIL_LABEL: Record<WaterFailKind, string> = {
  "no-pressure":    "Недостаточный напор",
  "over-pressure":  "Избыточный напор",
  "low-flow":       "Недостаточный расход",
  "short-duration": "Мало запаса воды",
  "no-water":       "Вода не поступает",
  "no-data":        "Не заданы параметры ствола",
};

/** Строка результата — одна точка водоразбора */
export interface WaterCheckRow {
  index: number;
  nodeId: string;
  nodeNumber: string;
  nodeName: string;
  description: string;
  /** Модель ствола / тип потребителя */
  consumerName: string;
  /** Диаметр выходного отверстия, мм */
  outletDiameter: number;
  /** Высотная отметка точки, м */
  elevation: number;
  /** Напор у крана при расчётном сценарии, МПа */
  pressure: number;
  /** Расход через ствол, м³/ч */
  flow: number;
  /** Требуемый расход (из свойств узла или норматива), м³/ч */
  requiredFlow: number;
  /** Время работы от запаса резервуара, мин */
  duration: number;
  /** Максимальная скорость воды на пути к крану, м/с */
  maxVelocity: number;
  /** Суммарные потери напора от резервуара до крана, МПа */
  pressureLoss: number;
  /** Дефицит напора (0 если нормы выполнены), МПа */
  pressureDeficit: number;
  /** Дефицит расхода (0 если нормы выполнены), м³/ч */
  flowDeficit: number;
  /** Точка соответствует нормативу */
  ok: boolean;
  /** Перечень нарушений */
  fails: WaterFailKind[];
  /** Текстовый вердикт */
  verdict: string;
  /** Рекомендация по устранению */
  recommendation: string;
}

export interface WaterCheckResult {
  rows: WaterCheckRow[];
  norms: WaterNorms;
  /** Всего проверено точек */
  total: number;
  /** Сколько не проходит норматив */
  failed: number;
  /** Худшая точка сети (наименьший напор среди проверенных) */
  worst: WaterCheckRow | null;
  /** Сеть непригодна к расчёту (нет резервуара / нет труб / нет кранов) */
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// РЕЖИМ «ПО ОЧАГУ ПОЖАРА»
// Для конкретного очага находим ближайшие к нему пожарные краны и проверяем,
// хватит ли им напора при совместной работе именно на этот очаг.
// Расстояние считаем по длине выработок (реальный путь прокладки рукавов),
// а не по прямой — рукава тянут по горным выработкам.
// ─────────────────────────────────────────────────────────────────────────────

/** Кран, обслуживающий очаг */
export interface FireHydrantRow extends WaterCheckRow {
  /** Длина пути от крана до очага по выработкам, м */
  distanceToFire: number;
  /** Сколько рукавов нужно (по длине стандартного рукава) */
  hoseCount: number;
  /** Кран дотягивается до очага рукавами */
  reachesFire: boolean;
}

export interface FireWaterResult {
  /** Ветвь с очагом */
  fireBranchId: string;
  fireBranchName: string;
  /** Краны, отсортированные по удалённости от очага */
  hydrants: FireHydrantRow[];
  /** Краны, реально дотягивающиеся до очага рукавами */
  reaching: FireHydrantRow[];
  /** Суммарный расход воды, который можно подать на очаг, м³/ч */
  totalFlow: number;
  /** Требуемый расход на тушение по интенсивности, м³/ч */
  requiredFlow: number;
  /** Воды хватает на тушение этого очага */
  sufficient: boolean;
  /** Время подачи воды от запаса резервуаров, мин */
  duration: number;
  /** Вердикт по очагу */
  verdict: string;
  error: string | null;
}

/** Параметры тушения очага */
export interface FireWaterOptions {
  /** Длина одного напорного рукава, м */
  hoseLength: number;
  /** Максимальное число рукавов в линии */
  maxHoses: number;
  /** Интенсивность подачи воды, л/(с·м²) */
  intensity: number;
  /** Площадь тушения (0 = взять площадь сечения выработки), м² */
  fireArea: number;
}

export const DEFAULT_FIRE_WATER_OPTIONS: FireWaterOptions = {
  hoseLength: 20,
  maxHoses: 4,
  intensity: 0.15,
  fireArea: 0,
};

/**
 * Кратчайшие расстояния по выработкам от узла-очага до всех узлов (Дейкстра).
 * Вес ребра — длина выработки. Идём по ВСЕМ выработкам, а не только по трубам:
 * рукава тянут по горным выработкам независимо от прокладки трубопровода.
 */
function distancesFromNode(
  startIds: string[],
  branches: TopoBranch[],
  nodes: TopoNode[],
): Map<string, number> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map<string, { to: string; len: number }[]>();
  const link = (a: string, b: string, len: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, len });
  };
  for (const b of branches) {
    // Длина: заданная в свойствах либо геометрическая по координатам узлов
    let len = b.length ?? 0;
    if (!(len > 0)) {
      const f = nodeById.get(b.fromId), t = nodeById.get(b.toId);
      len = f && t ? Math.hypot(t.x - f.x, t.y - f.y, t.z - f.z) : 0;
    }
    link(b.fromId, b.toId, len);
    link(b.toId, b.fromId, len);
  }

  const dist = new Map<string, number>();
  for (const id of startIds) dist.set(id, 0);
  // Простая очередь с выбором минимума — сетей на десятки тысяч узлов тут нет
  const queue = new Set<string>(startIds);
  while (queue.size > 0) {
    let cur = "";
    let best = Infinity;
    for (const id of queue) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) { best = d; cur = id; }
    }
    if (!cur) break;
    queue.delete(cur);
    for (const { to, len } of adj.get(cur) ?? []) {
      const nd = best + len;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        queue.add(to);
      }
    }
  }
  return dist;
}

/**
 * Проверка обеспеченности водой конкретного очага пожара.
 * fireBranch — ветвь с установленным очагом.
 */
export function checkFireWaterSupply(
  fireBranch: TopoBranch,
  nodes: TopoNode[],
  branches: TopoBranch[],
  optsPartial: Partial<FireWaterOptions> = {},
  normsPartial: Partial<WaterNorms> = {},
  consumerNameById?: (id: string | undefined) => string,
): FireWaterResult {
  const opts = { ...DEFAULT_FIRE_WATER_OPTIONS, ...optsPartial };
  const norms: WaterNorms = { ...DEFAULT_WATER_NORMS, ...normsPartial };

  // Имя выработки: у ветви нет отдельного поля name — используем её тип
  // (так же, как в Акте устойчивости, см. fireStability.ts).
  const branchName = fireBranch.type || `${fireBranch.fromId.slice(-4)}–${fireBranch.toId.slice(-4)}`;
  const empty = (error: string): FireWaterResult => ({
    fireBranchId: fireBranch.id, fireBranchName: branchName,
    hydrants: [], reaching: [], totalFlow: 0, requiredFlow: 0,
    sufficient: false, duration: 0, verdict: "Расчёт невозможен", error,
  });

  const consumers = nodes.filter(n => (n.fireNodeType ?? "none") === "consumer");
  if (consumers.length === 0) return empty("В схеме нет пожарных кранов.");
  const reservoirs = nodes.filter(n => (n.fireNodeType ?? "none") === "reservoir");
  if (reservoirs.length === 0) return empty("В схеме нет резервуара (источника воды).");

  // ── Требуемый расход на тушение: q = I × S ──────────────────────────────
  // I — интенсивность подачи воды, л/(с·м²); S — площадь тушения, м².
  const area = opts.fireArea > 0 ? opts.fireArea : (fireBranch.area ?? 0);
  const requiredFlow = area > 0
    ? +(opts.intensity * area * 3.6).toFixed(2)  // л/с → м³/ч
    : norms.minFlow;

  // ── Расстояния от очага до каждого крана по выработкам ──────────────────
  // Очаг лежит внутри ветви в точке fireT — считаем от обоих её концов
  // и берём минимум с поправкой на положение внутри выработки.
  const fireLen = fireBranch.length ?? 0;
  const t = Math.min(1, Math.max(0, fireBranch.fireT ?? 0.5));
  const distFrom = distancesFromNode([fireBranch.fromId], branches, nodes);
  const distTo   = distancesFromNode([fireBranch.toId], branches, nodes);
  const distToFire = (nodeId: string): number => {
    const a = (distFrom.get(nodeId) ?? Infinity) + fireLen * t;
    const b = (distTo.get(nodeId)   ?? Infinity) + fireLen * (1 - t);
    return Math.min(a, b);
  };

  const maxReach = opts.hoseLength * opts.maxHoses;

  // Краны, отсортированные по удалённости — ближние тушат первыми
  const ranked = consumers
    .map(c => ({ node: c, dist: distToFire(c.id) }))
    .filter(x => Number.isFinite(x.dist))
    .sort((a, b) => a.dist - b.dist);

  if (ranked.length === 0) return empty("Ни один пожарный кран не связан с очагом по выработкам.");

  // ── Сценарий: открываем краны, дотягивающиеся до очага ──────────────────
  const reachingIds = new Set(ranked.filter(x => x.dist <= maxReach).map(x => x.node.id));
  // Если ни один не дотягивается — считаем по ближайшему, чтобы показать
  // фактические параметры (и явно указать, что рукавов не хватает).
  if (reachingIds.size === 0) reachingIds.add(ranked[0].node.id);

  const scenarioNodes = nodes.map(n => {
    if ((n.fireNodeType ?? "none") !== "consumer") return n;
    const open = reachingIds.has(n.id);
    return open === (n.fireHydrantOpen ?? false) ? n : { ...n, fireHydrantOpen: open };
  });

  const { nodeResults, branchResults } = calcWaterNetwork(scenarioNodes, branches);

  let maxVelAll = 0;
  branchResults.forEach(br => {
    if ((br.flow ?? 0) > 0.01) maxVelAll = Math.max(maxVelAll, br.velocity ?? 0);
  });
  const srcP = Math.max(...reservoirs.map(r => r.fireInitPressure ?? 0));

  const sumFlow = ranked.reduce((s, x) => s + (nodeResults.get(x.node.id)?.flow ?? 0), 0);
  const capacity = reservoirs.reduce((s, r) => s + (r.fireCapacity ?? 0), 0);
  const duration = sumFlow > 0 ? +((capacity / sumFlow) * 60).toFixed(1) : 0;

  const hydrants: FireHydrantRow[] = ranked.map((x, i) => {
    const c = x.node;
    const res = nodeResults.get(c.id);
    const pressure = res ? +(res.staticP ?? 0).toFixed(4) : 0;
    const flow = res ? +(res.flow ?? 0).toFixed(2) : 0;
    const outlet = c.fireHydrantDiameter ?? 0;
    const hasData = outlet > 0 || (c.fireResistanceMode === "manual" && (c.fireManualR ?? 0) > 0);
    const hoseCount = Math.ceil(x.dist / Math.max(1, opts.hoseLength));
    const reaches = x.dist <= maxReach;

    const fails: WaterFailKind[] = [];
    if (!hasData) fails.push("no-data");
    else if (!reachingIds.has(c.id)) { /* кран не задействован — не проверяем */ }
    else if (pressure <= 0.0001) fails.push("no-water");
    else {
      if (pressure < norms.minPressure) fails.push("no-pressure");
      if (pressure > norms.maxPressure) fails.push("over-pressure");
    }

    const pressureDeficit = fails.includes("no-pressure")
      ? +(norms.minPressure - pressure).toFixed(4) : 0;

    let recommendation = "";
    if (!reaches) {
      recommendation = `Не дотягивается: нужно ${hoseCount} рукавов при лимите ${opts.maxHoses}`;
    } else if (fails.includes("no-data")) {
      recommendation = "Задать модель ствола или диаметр насадка";
    } else if (fails.includes("no-water")) {
      recommendation = "Вода не поступает — проверить вентили и связность трубопровода";
    } else if (fails.includes("no-pressure")) {
      recommendation = `Не хватает напора ${pressureDeficit.toFixed(2)} МПа — нужен насос`;
    } else if (fails.includes("over-pressure")) {
      recommendation = "Избыточный напор — установить редукционный клапан";
    }

    return {
      index: i + 1,
      nodeId: c.id,
      nodeNumber: c.number || c.id.slice(-4),
      nodeName: c.name || "",
      description: c.fireDescription || "",
      consumerName: consumerNameById ? consumerNameById(c.fireConsumerModelId) : (c.fireConsumerModelId || ""),
      outletDiameter: outlet,
      elevation: +(c.z ?? 0).toFixed(1),
      pressure,
      flow: reachingIds.has(c.id) ? flow : 0,
      requiredFlow: +requiredFlow.toFixed(2),
      duration,
      maxVelocity: +maxVelAll.toFixed(2),
      pressureLoss: +Math.max(0, srcP - pressure).toFixed(4),
      pressureDeficit,
      flowDeficit: 0,
      ok: reaches && fails.length === 0,
      fails,
      verdict: !reaches
        ? "Не дотягивается рукавами"
        : fails.length === 0 ? "Обеспечено" : fails.map(f => FAIL_LABEL[f]).join(", "),
      recommendation,
      distanceToFire: +x.dist.toFixed(1),
      hoseCount,
      reachesFire: reaches,
    };
  });

  const reaching = hydrants.filter(h => h.reachesFire);
  const totalFlow = +reaching.reduce((s, h) => s + h.flow, 0).toFixed(2);
  const sufficient = reaching.length > 0
    && reaching.some(h => h.ok)
    && totalFlow >= requiredFlow;

  let verdict: string;
  if (reaching.length === 0) {
    verdict = "Очаг не обеспечен водой: ни один кран не дотягивается рукавами";
  } else if (!reaching.some(h => h.ok)) {
    verdict = "Очаг не обеспечен: краны рядом есть, но напора недостаточно";
  } else if (totalFlow < requiredFlow) {
    verdict = `Расхода недостаточно: подаётся ${totalFlow} м³/ч при требуемых ${requiredFlow} м³/ч`;
  } else if (duration > 0 && duration < norms.minDuration) {
    verdict = `Воды хватит только на ${Math.round(duration)} мин при норме ${norms.minDuration} мин`;
  } else {
    verdict = `Очаг обеспечен водой: ${reaching.filter(h => h.ok).length} кран(ов), ${totalFlow} м³/ч`;
  }

  return {
    fireBranchId: fireBranch.id,
    fireBranchName: branchName,
    hydrants,
    reaching,
    totalFlow,
    requiredFlow,
    sufficient,
    duration,
    verdict,
    error: null,
  };
}

// ─── Ближайшие краны по сети (для сценария одновременной работы) ────────────
function nearestConsumers(
  startId: string,
  consumerIds: Set<string>,
  adj: Map<string, string[]>,
  count: number,
): string[] {
  if (count <= 0) return [];
  const found: string[] = [];
  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  while (queue.length > 0 && found.length < count) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      if (consumerIds.has(nb)) {
        found.push(nb);
        if (found.length >= count) break;
      }
      queue.push(nb);
    }
  }
  return found;
}

// ─── Основной пакетный расчёт ───────────────────────────────────────────────
export function checkWaterNetwork(
  nodes: TopoNode[],
  branches: TopoBranch[],
  normsPartial: Partial<WaterNorms> = {},
  /** Подпись модели потребителя по её id (справочник стволов) */
  consumerNameById?: (id: string | undefined) => string,
): WaterCheckResult {
  const norms: WaterNorms = { ...DEFAULT_WATER_NORMS, ...normsPartial };

  const waterBranches = branches.filter(b => b.hasWaterPipe);
  const reservoirs = nodes.filter(n => (n.fireNodeType ?? "none") === "reservoir");
  const consumers  = nodes.filter(n => (n.fireNodeType ?? "none") === "consumer");

  const empty = (error: string): WaterCheckResult =>
    ({ rows: [], norms, total: 0, failed: 0, worst: null, error });

  if (waterBranches.length === 0) return empty("В схеме нет участков водопровода. Отметьте выработки с трубопроводом ППЗ.");
  if (reservoirs.length === 0)    return empty("В схеме нет резервуара (источника воды). Добавьте узел типа «Резервуар».");
  if (consumers.length === 0)     return empty("В схеме нет пожарных кранов. Добавьте узлы типа «Потребитель».");

  // Граф смежности по трубам — для поиска ближайших кранов и путей
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const b of waterBranches) { link(b.fromId, b.toId); link(b.toId, b.fromId); }

  const consumerIds = new Set(consumers.map(c => c.id));
  const rows: WaterCheckRow[] = [];

  consumers.forEach((c, i) => {
    // ── Сценарий: открыт проверяемый кран + ближайшие (одновременная работа)
    const alsoOpen = new Set(
      nearestConsumers(c.id, consumerIds, adj, Math.max(0, norms.simultaneous - 1)),
    );
    const scenarioNodes = nodes.map(n => {
      if ((n.fireNodeType ?? "none") !== "consumer") return n;
      const open = n.id === c.id || alsoOpen.has(n.id);
      return open === (n.fireHydrantOpen ?? false) ? n : { ...n, fireHydrantOpen: open };
    });

    const { nodeResults, branchResults } = calcWaterNetwork(scenarioNodes, branches);
    const res = nodeResults.get(c.id);

    // Диаметр выходного отверстия — без него расход не определить
    const outlet = c.fireHydrantDiameter ?? 0;
    const hasData = outlet > 0 || (c.fireResistanceMode === "manual" && (c.fireManualR ?? 0) > 0);

    const pressure = res ? +(res.staticP ?? 0).toFixed(4) : 0;
    const flow     = res ? +(res.flow ?? 0).toFixed(2) : 0;

    // Время работы: запас самого ёмкого резервуара при суммарном расходе сценария
    const totalFlow = consumers.reduce((s, x) => {
      const r = nodeResults.get(x.id);
      return s + (r ? (r.flow ?? 0) : 0);
    }, 0);
    const capacity = reservoirs.reduce((s, r) => s + (r.fireCapacity ?? 0), 0);
    const duration = totalFlow > 0 ? +((capacity / totalFlow) * 60).toFixed(1) : 0;

    // Максимальная скорость воды на трубах, по которым реально идёт вода
    let maxVel = 0;
    branchResults.forEach(br => {
      if ((br.flow ?? 0) > 0.01) maxVel = Math.max(maxVel, br.velocity ?? 0);
    });

    // Потери от резервуара до крана: начальный напор источника минус то,
    // что осталось у крана (наглядно показывает «где просело»).
    const srcP = Math.max(...reservoirs.map(r => r.fireInitPressure ?? 0));
    const pressureLoss = +Math.max(0, srcP - pressure).toFixed(4);

    const requiredFlow = (c.fireRequiredFlow ?? 0) > 0 ? c.fireRequiredFlow : norms.minFlow;

    // ── Сверка с нормативом ────────────────────────────────────────────────
    const fails: WaterFailKind[] = [];
    if (!hasData) {
      fails.push("no-data");
    } else if (pressure <= 0.0001) {
      fails.push("no-water");
    } else {
      if (pressure < norms.minPressure) fails.push("no-pressure");
      if (pressure > norms.maxPressure) fails.push("over-pressure");
      if (flow < requiredFlow)          fails.push("low-flow");
      if (duration > 0 && duration < norms.minDuration) fails.push("short-duration");
    }

    const pressureDeficit = fails.includes("no-pressure")
      ? +(norms.minPressure - pressure).toFixed(4) : 0;
    const flowDeficit = fails.includes("low-flow")
      ? +(requiredFlow - flow).toFixed(2) : 0;

    const ok = fails.length === 0;

    // ── Рекомендация: конкретное действие, а не общая фраза ────────────────
    let recommendation = "";
    if (fails.includes("no-data")) {
      recommendation = "Задать модель ствола или диаметр выходного отверстия в свойствах узла";
    } else if (fails.includes("no-water")) {
      recommendation = "Проверить связность трубопровода до крана и положение запорных вентилей";
    } else if (fails.includes("no-pressure")) {
      const parts = [`Поднять напор на ${pressureDeficit.toFixed(2)} МПа`];
      if (maxVel > norms.maxVelocity) parts.push("увеличить диаметр труб (скорость воды выше допустимой)");
      else parts.push("установить повысительный насос или увеличить диаметр труб");
      recommendation = parts.join(": ");
    } else if (fails.includes("over-pressure")) {
      recommendation = `Установить редукционный клапан: превышение ${(pressure - norms.maxPressure).toFixed(2)} МПа`;
    } else if (fails.includes("low-flow")) {
      recommendation = `Увеличить пропускную способность: не хватает ${flowDeficit.toFixed(1)} м³/ч`;
    } else if (fails.includes("short-duration")) {
      const need = +((totalFlow * norms.minDuration) / 60).toFixed(0);
      recommendation = `Увеличить запас воды до ${need} м³ (сейчас ${capacity} м³)`;
    }

    rows.push({
      index: i + 1,
      nodeId: c.id,
      nodeNumber: c.number || c.id.slice(-4),
      nodeName: c.name || "",
      description: c.fireDescription || "",
      consumerName: consumerNameById
        ? consumerNameById(c.fireConsumerModelId)
        : (c.fireConsumerModelId || ""),
      outletDiameter: outlet,
      elevation: +(c.z ?? 0).toFixed(1),
      pressure,
      flow,
      requiredFlow: +requiredFlow.toFixed(2),
      duration,
      maxVelocity: +maxVel.toFixed(2),
      pressureLoss,
      pressureDeficit,
      flowDeficit,
      ok,
      fails,
      verdict: ok ? "Обеспечено" : fails.map(f => FAIL_LABEL[f]).join(", "),
      recommendation,
    });
  });

  // Сортировка: сначала проблемные, внутри — по возрастанию напора
  // (первой идёт самая тяжёлая точка сети — с неё и начинают проектировать).
  rows.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    return a.pressure - b.pressure;
  });
  rows.forEach((r, i) => { r.index = i + 1; });

  const withWater = rows.filter(r => !r.fails.includes("no-data"));
  const worst = withWater.length > 0
    ? withWater.reduce((m, r) => (r.pressure < m.pressure ? r : m), withWater[0])
    : null;

  return {
    rows,
    norms,
    total: rows.length,
    failed: rows.filter(r => !r.ok).length,
    worst,
    error: null,
  };
}