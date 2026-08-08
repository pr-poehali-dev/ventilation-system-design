// ─────────────────────────────────────────────────────────────────────────────
// evacuationRisk.ts — Расчёт зоны поражения при пожаре по ЛЮДЯМ.
//
// Для каждого рабочего места (узел с peopleNodeType="workplace" и численностью):
//   • ищем ближайший ПО ВРЕМЕНИ выход на поверхность (узел "exit") —
//     маршрутом по выработкам через штатный calcWorkerPath (скорости по РД);
//   • сравниваем время выхода со временем защитного действия самоспасателя;
//   • если не успевают — ищем ПВП (пункт переключения) или камеру-убежище
//     на пути, чтобы понять, спасает ли переключение;
//   • определяем, попадает ли рабочее место и путь выхода в зону задымления
//     (по расчётным полям fireComputedSmokeDens / fireComputedCO ветвей).
//
// Итог — сколько человек в зоне задымления, кто успевает выйти, кому нужен
// пункт переключения. Это основа раздела ПЛА «вывод людей».
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoNode, TopoBranch } from "./topology";
import { calcWorkerPath, type TopoNodeLite, type TopoBranchLite } from "./rescueCalculator";
import { getSelfRescuerById } from "./selfRescuers";

/** Порог оптической плотности дыма, выше которого путь считается задымлённым */
const SMOKE_THRESHOLD = 0.01;
/** Порог концентрации CO (%), опасный для человека без защиты */
const CO_THRESHOLD = 0.0025;

export interface EvacRiskOptions {
  /** Время защитного действия самоспасателя по умолчанию, мин */
  defaultRescuerTime: number;
  /** Коэффициент запаса: фактическое время меньше паспортного при нагрузке */
  safetyFactor: number;
  /** Метод расчёта скорости движения людей */
  method: "rd" | "fnip";
  /** Учитывать пункты переключения (ПВП) как продление защиты */
  useSwitchPoints: boolean;
}

export const DEFAULT_EVAC_OPTIONS: EvacRiskOptions = {
  defaultRescuerTime: 60,
  safetyFactor: 0.8,
  method: "rd",
  useSwitchPoints: true,
};

/** Категория риска по рабочему месту */
export type EvacRiskLevel =
  | "safe"          // успевают выйти с запасом
  | "tight"         // успевают, но запас менее 20%
  | "needs-switch"  // не успевают напрямую, спасает ПВП / убежище
  | "critical"      // не успевают и переключаться негде
  | "no-route";     // маршрут до выхода не найден

export const RISK_LABEL: Record<EvacRiskLevel, string> = {
  "safe":         "Успевают выйти",
  "tight":        "Успевают без запаса",
  "needs-switch": "Нужен пункт переключения",
  "critical":     "Не успевают выйти",
  "no-route":     "Нет пути к выходу",
};

/** Строка результата — одно рабочее место */
export interface EvacRiskRow {
  index: number;
  nodeId: string;
  nodeNumber: string
  nodeName: string;
  /** Наименование рабочего места */
  description: string;
  /** Смена / участок */
  shift: string;
  /** Численность людей, чел */
  peopleCount: number;
  /** Выход, к которому выводятся люди */
  exitNodeId: string;
  exitName: string;
  /** Длина пути до выхода, м */
  routeLength: number;
  /** Время выхода на поверхность, мин */
  evacTime: number;
  /** Время защитного действия самоспасателя (с учётом запаса), мин */
  rescuerTime: number;
  /** Марка самоспасателя */
  rescuerModel: string;
  /** Запас времени = защита − выход, мин (отрицательный = не успевают) */
  timeMargin: number;
  /** Рабочее место в зоне задымления */
  inSmokeZone: boolean;
  /** Путь выхода проходит через задымлённые выработки */
  routeThroughSmoke: boolean;
  /** Максимальная концентрация CO на пути, % */
  maxCO: number;
  /** Ближайший ПВП / убежище на пути (если есть) */
  switchPointId: string;
  switchPointName: string;
  /** Время до ПВП / убежища, мин */
  switchPointTime: number;
  /** Категория риска */
  level: EvacRiskLevel;
  /** Вердикт текстом */
  verdict: string;
  /** Рекомендация */
  recommendation: string;
}

export interface EvacRiskResult {
  rows: EvacRiskRow[];
  opts: EvacRiskOptions;
  /** Всего рабочих мест в расчёте */
  totalWorkplaces: number;
  /** Всего людей в смену, чел */
  totalPeople: number;
  /** Людей в зоне задымления, чел */
  peopleInSmoke: number;
  /** Людей, которые НЕ успевают выйти по самоспасателю, чел */
  peopleAtRisk: number;
  /** Людей, которых спасает пункт переключения, чел */
  peopleNeedSwitch: number;
  /** Наиболее тяжёлое рабочее место (максимальный дефицит времени) */
  worst: EvacRiskRow | null;
  error: string | null;
}

// ─── Основной расчёт ─────────────────────────────────────────────────────────
export function calcEvacuationRisk(
  nodes: TopoNode[],
  branches: TopoBranch[],
  optsPartial: Partial<EvacRiskOptions> = {},
): EvacRiskResult {
  const opts = { ...DEFAULT_EVAC_OPTIONS, ...optsPartial };

  const empty = (error: string): EvacRiskResult => ({
    rows: [], opts, totalWorkplaces: 0, totalPeople: 0,
    peopleInSmoke: 0, peopleAtRisk: 0, peopleNeedSwitch: 0,
    worst: null, error,
  });

  const workplaces = nodes.filter(n =>
    (n.peopleNodeType ?? "none") === "workplace" && (n.peopleCount ?? 0) > 0);
  const exits = nodes.filter(n => (n.peopleNodeType ?? "none") === "exit");
  const switchPoints = nodes.filter(n => {
    const t = n.peopleNodeType ?? "none";
    return t === "switchpoint" || t === "refuge";
  });

  if (workplaces.length === 0) {
    return empty("Не заданы рабочие места с людьми. Укажите их в свойствах узлов на вкладке «Аварии».");
  }
  if (exits.length === 0) {
    return empty("Не задан ни один выход на поверхность. Отметьте выходы в свойствах узлов.");
  }

  // ── Подготовка данных для штатного расчёта маршрутов ──────────────────────
  const liteNodes: TopoNodeLite[] = nodes.map(n => ({
    id: n.id, name: n.name ?? "", number: n.number ?? "",
    x: n.x, y: n.y, z: n.z,
  }));
  const liteBranches: TopoBranchLite[] = branches.map(b => ({
    id: b.id, fromId: b.fromId, toId: b.toId,
    length: b.length ?? 0, angle: b.angle ?? 0, area: b.area ?? 0,
    type: b.type,
    fireComputedSmokeDens: b.fireComputedSmokeDens,
    fireComputedCO: b.fireComputedCO,
    flow: b.flow,
    hasBulkhead: b.hasBulkhead, bulkheadId: b.bulkheadId,
    isLeakage: b.isLeakage, resistance: b.resistance,
  }));

  const nodeLabel = (n: TopoNode): string =>
    n.peopleDescription || n.name || (n.number ? `№ ${n.number}` : n.id.slice(-4));

  // Задымлённые ветви — для проверки, стоит ли рабочее место в дыму
  const smokyBranchNodes = new Set<string>();
  for (const b of branches) {
    const sd = b.fireComputedSmokeDens ?? 0;
    const co = b.fireComputedCO ?? 0;
    if (sd > SMOKE_THRESHOLD || co > CO_THRESHOLD) {
      smokyBranchNodes.add(b.fromId);
      smokyBranchNodes.add(b.toId);
    }
  }

  const rows: EvacRiskRow[] = [];

  workplaces.forEach((wp, i) => {
    const count = wp.peopleCount ?? 0;

    // ── Ближайший ПО ВРЕМЕНИ выход (не по расстоянию!) ────────────────────
    // Люди идут к тому выходу, до которого быстрее, а время зависит от
    // уклонов и задымления, а не только от длины пути.
    let bestExit: { node: TopoNode; time: number; length: number;
                    smoke: boolean; maxCO: number } | null = null;

    for (const ex of exits) {
      if (ex.id === wp.id) continue;
      const wr = calcWorkerPath(liteNodes, liteBranches, wp.id, ex.id, opts.method);
      if (!wr.ok || wr.segments.length === 0) continue;
      const len = wr.segments.reduce((s, sg) => s + (sg.length ?? 0), 0);
      // Задымление на пути: берём из ветвей маршрута
      let smoke = false;
      let maxCO = 0;
      for (const sg of wr.segments) {
        const b = branches.find(x => x.id === sg.branchId);
        if (!b) continue;
        if ((b.fireComputedSmokeDens ?? 0) > SMOKE_THRESHOLD) smoke = true;
        maxCO = Math.max(maxCO, b.fireComputedCO ?? 0);
      }
      if (maxCO > CO_THRESHOLD) smoke = true;
      if (!bestExit || wr.totalTimeForward < bestExit.time) {
        bestExit = { node: ex, time: wr.totalTimeForward, length: len, smoke, maxCO };
      }
    }

    // ── Время защитного действия самоспасателя ────────────────────────────
    const model = getSelfRescuerById(wp.selfRescuerModel);
    const passportTime = (wp.selfRescuerTime ?? 0) > 0
      ? (wp.selfRescuerTime as number)
      : (model?.protectionTime ?? opts.defaultRescuerTime);
    // Паспортное время достигается в идеальных условиях; при подъёме и
    // физической нагрузке ресурс расходуется быстрее — вводим коэффициент.
    const rescuerTime = +(passportTime * opts.safetyFactor).toFixed(1);

    // ── Ближайший ПВП / камера-убежище ────────────────────────────────────
    let bestSwitch: { node: TopoNode; time: number } | null = null;
    if (opts.useSwitchPoints) {
      for (const sp of switchPoints) {
        if (sp.id === wp.id) continue;
        const sr = calcWorkerPath(liteNodes, liteBranches, wp.id, sp.id, opts.method);
        if (!sr.ok || sr.segments.length === 0) continue;
        if (!bestSwitch || sr.totalTimeForward < bestSwitch.time) {
          bestSwitch = { node: sp, time: sr.totalTimeForward };
        }
      }
    }

    const inSmokeZone = smokyBranchNodes.has(wp.id);

    // ── Категория риска ───────────────────────────────────────────────────
    let level: EvacRiskLevel;
    let recommendation = "";
    const evacTime = bestExit ? +bestExit.time.toFixed(1) : 0;
    const margin = bestExit ? +(rescuerTime - evacTime).toFixed(1) : 0;

    if (!bestExit) {
      level = "no-route";
      recommendation = "Проверить связность выработок и положение перемычек на пути к выходу";
    } else if (margin >= rescuerTime * 0.2) {
      level = "safe";
    } else if (margin >= 0) {
      level = "tight";
      recommendation = `Запас всего ${margin.toFixed(0)} мин — предусмотреть пункт переключения на маршруте`;
    } else if (bestSwitch && bestSwitch.time < rescuerTime) {
      level = "needs-switch";
      recommendation = `Обязательное переключение в «${nodeLabel(bestSwitch.node)}» через ${bestSwitch.time.toFixed(0)} мин`;
    } else {
      level = "critical";
      const need = Math.abs(margin);
      recommendation = bestSwitch
        ? `Ближайший ПВП недостижим (${bestSwitch.time.toFixed(0)} мин) — нужен ПВП ближе или самоспасатель на ${Math.ceil(evacTime / opts.safetyFactor)} мин`
        : `Нет пункта переключения. Требуется ПВП на маршруте или самоспасатель на ${Math.ceil(evacTime / opts.safetyFactor)} мин (не хватает ${need.toFixed(0)} мин)`;
    }

    if (level === "safe" && inSmokeZone) {
      recommendation = "Рабочее место в зоне задымления — включение в самоспасатель немедленно";
    }

    rows.push({
      index: i + 1,
      nodeId: wp.id,
      nodeNumber: wp.number || wp.id.slice(-4),
      nodeName: wp.name || "",
      description: wp.peopleDescription || "",
      shift: wp.peopleShift || "",
      peopleCount: count,
      exitNodeId: bestExit?.node.id ?? "",
      exitName: bestExit ? nodeLabel(bestExit.node) : "—",
      routeLength: bestExit ? +bestExit.length.toFixed(0) : 0,
      evacTime,
      rescuerTime,
      rescuerModel: model?.name ?? (wp.selfRescuerModel || "по умолчанию"),
      timeMargin: margin,
      inSmokeZone,
      routeThroughSmoke: bestExit?.smoke ?? false,
      maxCO: bestExit ? +(bestExit.maxCO).toFixed(4) : 0,
      switchPointId: bestSwitch?.node.id ?? "",
      switchPointName: bestSwitch ? nodeLabel(bestSwitch.node) : "—",
      switchPointTime: bestSwitch ? +bestSwitch.time.toFixed(1) : 0,
      level,
      verdict: RISK_LABEL[level],
      recommendation,
    });
  });

  // Сортировка: сначала самые опасные (по дефициту времени)
  const ORDER: Record<EvacRiskLevel, number> = {
    "no-route": 0, "critical": 1, "needs-switch": 2, "tight": 3, "safe": 4,
  };
  rows.sort((a, b) => {
    if (ORDER[a.level] !== ORDER[b.level]) return ORDER[a.level] - ORDER[b.level];
    return a.timeMargin - b.timeMargin;
  });
  rows.forEach((r, i) => { r.index = i + 1; });

  const totalPeople    = rows.reduce((s, r) => s + r.peopleCount, 0);
  const peopleInSmoke  = rows.filter(r => r.inSmokeZone || r.routeThroughSmoke)
                             .reduce((s, r) => s + r.peopleCount, 0);
  const peopleAtRisk   = rows.filter(r => r.level === "critical" || r.level === "no-route")
                             .reduce((s, r) => s + r.peopleCount, 0);
  const peopleNeedSwitch = rows.filter(r => r.level === "needs-switch")
                               .reduce((s, r) => s + r.peopleCount, 0);

  const worst = rows.length > 0 ? rows[0] : null;

  return {
    rows, opts,
    totalWorkplaces: rows.length,
    totalPeople,
    peopleInSmoke,
    peopleAtRisk,
    peopleNeedSwitch,
    worst,
    error: null,
  };
}
