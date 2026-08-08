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
