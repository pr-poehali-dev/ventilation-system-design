/**
 * Расчёт времени хода горноспасателей по горным выработкам.
 * Алгоритм: Дейкстра по графу сети с учётом скорости движения,
 * типа атмосферы (пригодная/непригодная по задымлению),
 * затрат кислорода ИДА и оказания помощи пострадавшим.
 * Поддерживает промежуточные узлы (вайпоинты) для маршрута в обход.
 *
 * Источник методики: РД 15-11-2007, ГОСТ Р 22.0.007, практика Аэросети.
 */

export type RescueOperationType =
  | "scout_and_transport"   // Разведка туда, транспортировка обратно
  | "scout"                 // Только разведка
  | "transport"             // Транспортировка пострадавшего
  | "liquidation";          // Ликвидация аварии

export interface RescueParams {
  operationType: RescueOperationType;
  useAirTemp: boolean;
  useIdaTime: boolean;
  idaWorkTime: number;          // мин — время действия ИДА
  provideCare: boolean;
  careTime: number;             // мин — оказание помощи пострадавшим
  useInterpolation: boolean;
  oxygenConsumption: number;    // л/мин расход O₂
  oxygenVolume: number;         // л объём баллона ИДА
  /** Промежуточные узлы маршрута (вайпоинты), порядок — от старта к цели */
  waypointNodeIds?: string[];
}

export interface RescueSegment {
  branchId: string;
  /** Номер ветви из схемы (b.id или b.number) */
  branchNumber: string;
  /** Название выработки (из поля name ветви, иначе «Узел X → Узел Y») */
  branchName: string;
  /** Отображаемое имя выработки (только поле name, без узлов) */
  branchLabel: string;
  segmentNumber: number;
  length: number;           // м
  angle: number;            // °
  fromNodeId: string;
  toNodeId: string;

  // Зоны задымления для каждого участка (из расчёта пожара)
  smokeDensity: number;     // м⁻¹ (0 = чистый воздух)
  coConc: number;           // % концентрация CO
  visibility: number;       // м видимость

  // Фактическая зона (по реальному задымлению)
  zone: "clean" | "smoky_low" | "smoky_high";
  speed_mpm: number;        // м/мин скорость движения
  time_min: number;         // мин время прохождения участка (туда)
  time_back_min: number;    // мин время прохождения обратно
  o2_liters: number;        // л затраты кислорода (туда)
  o2_back_liters: number;   // л затраты кислорода (обратно)
  o2_per_100m: number;      // л расход O₂ на 100 м (= o2c * 100 / speed_mpm)
  cumulTime: number;        // мин накопленное время от базы
  cumulO2: number;          // л накопленный O₂

  // Расчёты для трёх нормативных зон задымления (по Инструкции N 520):
  // Слабая (k3=1,00): Рв > 10 м — чистый воздух
  speed_clean: number;
  time_clean: number;
  o2_clean: number;
  // Средняя (k3=1,43): Рв 5–10 м
  speed_smoky_low: number;
  time_smoky_low: number;
  o2_smoky_low: number;
  // Сильная (k3=2,00): Рв < 5 м
  speed_smoky_high: number;
  time_smoky_high: number;
  o2_smoky_high: number;
}

export interface RescueResult {
  targetNodeId: string;
  startNodeId: string;
  waypointNodeIds: string[];
  operationType: RescueOperationType;
  segments: RescueSegment[];       // маршрут туда
  segmentsBack: RescueSegment[];   // маршрут обратно

  totalTime: number;               // мин общее время операции
  totalTimeForward: number;        // мин только ход туда
  totalTimeBack: number;           // мин ход обратно
  careTime: number;                // мин оказание помощи
  totalO2: number;                 // л суммарный расход O₂
  totalO2Forward: number;
  totalO2Back: number;
  o2IdaPercent: number;            // % использование ИДА по O₂
  timeIdaPercent: number;          // % использование ИДА по времени

  idaTimeInSmoke: number;          // мин время в задымлённой зоне
  idaO2InSmoke: number;            // л O₂ в задымлённой зоне

  // Суммарное время/O₂ для трёх нормативных зон задымления
  totalTime_clean: number;       // k3=1.00, Рв > 10 м (слабая)
  totalO2_clean: number;
  totalTime_smoky_low: number;   // k3=1.43, Рв 5–10 м (средняя)
  totalTime_smoky_high: number;  // k3=2.00, Рв < 5 м (сильная)
  totalO2_smoky_low: number;
  totalO2_smoky_high: number;

  ok: boolean;                     // можно ли выполнить операцию с данным ИДА
  warnings: string[];
  /** Направление движения по каждой ветви маршрута: true = fromId→toId */
  branchDirs: Map<string, boolean>;
}

// ─── Нормативные скорости движения ────────────────────────────────────────────
// Источник: РД 15-11-2007 / Инструкция по локализации и ликвидации последствий
// аварий (пр. Ростехнадзора от 11.12.2020 N 520), Приложение 4.
// Знак угла: + подъём, - спуск; горизонт = 0
//
// Базовые скорости в чистом воздухе (м/мин) при подъёме — линейная интерполяция:
//   0°: 45,  5°: 37,5,  10°: 30,  15°: 24,  20°: 20,  30°: 14,  45°: 10
// При спуске скорость выше (множитель ≈1.2):
//   0°: 45,  5°: 42,    10°: 39,  15°: 34,  20°: 28,  30°: 22,  45°: 15
//
// Зоны задымления (коэффициент k3 по Инструкции N 520):
//   k3 = 1,00 — чистый воздух (Рв > 10 м)
//   k3 = 1,43 — слабое задымление (Рв 5–10 м)   → V_sl = V_clean / 1.43
//   k3 = 2,00 — густое задымление (Рв < 5 м)    → V_sh = V_clean / 2.00

function getBaseSpeed(angleDeg: number): number {
  const a = Math.abs(angleDeg);
  const isDown = angleDeg < 0;

  // Опорные точки [угол, скорость_подъём, скорость_спуск]
  const table: [number, number, number][] = [
    [0,  45.0, 45.0],
    [5,  37.5, 42.0],
    [10, 30.0, 39.0],
    [15, 24.0, 34.0],
    [20, 20.0, 28.0],
    [30, 14.0, 22.0],
    [45, 10.0, 15.0],
    [90,  6.0, 10.0],
  ];

  // Линейная интерполяция между соседними точками
  for (let i = 0; i < table.length - 1; i++) {
    const [a0, u0, d0] = table[i];
    const [a1, u1, d1] = table[i + 1];
    if (a >= a0 && a <= a1) {
      const t = (a - a0) / (a1 - a0);
      if (isDown) return d0 + t * (d1 - d0);
      return u0 + t * (u1 - u0);
    }
  }
  return isDown ? 10.0 : 6.0;
}

function getSpeed(zone: "clean" | "smoky_low" | "smoky_high", angleDeg: number): number {
  const vClean = getBaseSpeed(angleDeg);
  if (zone === "clean")      return vClean;
  if (zone === "smoky_low")  return vClean / 1.43;
  return vClean / 2.0;
}

// Зона задымления по плотности дыма (коэффициент k3):
//   smoke_density (м⁻¹): 0 → Рв = ∞; Рв = 2 / smoke_density
//   k3 = 1    : Рв > 10 м (чистый воздух)
//   k3 = 1.43 : Рв 5–10 м (слабое задымление)
//   k3 = 2.0  : Рв < 5 м  (густое задымление)
function getZone(smokeDensity: number): "clean" | "smoky_low" | "smoky_high" {
  if (smokeDensity <= 0.001) return "clean";
  const vis = 2.0 / smokeDensity;
  if (vis >= 10) return "clean";
  if (vis >= 5)  return "smoky_low";
  return "smoky_high";
}

// ─── Интерфейсы данных ──────────────────────────────────────────────────────

export interface TopoNodeLite {
  id: string;
  name: string;
  number: string;
  x: number; y: number; z: number;
}
export interface TopoBranchLite {
  id: string;
  number?: string;   // номер ветви для отображения (= id ветви из схемы)
  fromId: string;
  toId: string;
  length: number;
  angle: number;
  area: number;
  type?: string;     // тип/название выработки из схемы (TopoBranch.type)
  name?: string;
  fireComputedSmokeDens?: number;
  fireComputedCO?: number;
  flow?: number;
  hasBulkhead?: boolean;
  bulkheadId?: string;
  bulkheadName?: string;
  bulkheadR?: number;
  bulkheadAirPerm?: number;
  isLeakage?: boolean;
  resistance?: number;
}

/**
 * Определяет проходимость перемычки для горноспасателей.
 * Глухие (solid) и водоподпорные (water) — непроходимы.
 * Двери (door), паруса (sail), регуляторы (regulator) — проходимы.
 */
export function isBulkheadPassable(bulkheadId?: string): boolean {
  if (!bulkheadId) return false;
  const id = bulkheadId.toLowerCase();
  if (id.startsWith("solid_") || id.startsWith("bk_")) return false;
  if (id === "bulkhead" || id === "bulkhead_concrete" || id === "bulkhead_wood"
    || id === "bulkhead_brick" || id === "bulkhead_metal") return false;
  if (id.startsWith("water_dam") || id.startsWith("water_")) return false;
  if (id === "bulkhead_barrier" || id === "barrier") return false;
  if (id === "sail") return true;
  if (id.startsWith("door_") || id.startsWith("auto_") || id.startsWith("open_")
    || id.startsWith("win_") || id.startsWith("lat_") || id.startsWith("proem_")) return true;
  if (id.startsWith("regulator_") || id === "regulator") return true;
  if (id === "fire_door" || id === "fire_door_pp") return true;
  return false;
}

// ─── Дейкстра: одиночный запуск от одного источника ──────────────────────────

type Edge = { toId: string; branchId: string; forward: boolean };

function buildDijkstra(
  nodes: TopoNodeLite[],
  branches: TopoBranchLite[],
  adj: Map<string, Edge[]>,
  startNodeId: string,
): { dist: Map<string, number>; prev: Map<string, { nodeId: string; branchId: string; forward: boolean } | null> } {
  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; branchId: string; forward: boolean } | null>();
  for (const n of nodes) dist.set(n.id, Infinity);
  dist.set(startNodeId, 0);
  prev.set(startNodeId, null);

  type PQItem = { nodeId: string; d: number };
  const pq: PQItem[] = [{ nodeId: startNodeId, d: 0 }];
  const visited = new Set<string>();

  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d);
    const { nodeId: cur, d: curD } = pq.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const edge of (adj.get(cur) ?? [])) {
      const b = branches.find(b2 => b2.id === edge.branchId);
      if (!b) continue;
      const smokeDens = b.fireComputedSmokeDens ?? 0;
      const signedAngle = edge.forward ? (b.angle ?? 0) : -(b.angle ?? 0);
      const zone = getZone(smokeDens);
      const speed = getSpeed(zone, signedAngle);
      const t = b.length > 0 ? b.length / speed : 0;
      const nd = curD + t;
      if (nd < (dist.get(edge.toId) ?? Infinity)) {
        dist.set(edge.toId, nd);
        prev.set(edge.toId, { nodeId: cur, branchId: b.id, forward: edge.forward });
        pq.push({ nodeId: edge.toId, d: nd });
      }
    }
  }
  return { dist, prev };
}

function buildPath(
  prev: Map<string, { nodeId: string; branchId: string; forward: boolean } | null>,
  toId: string,
): Array<{ nodeId: string; branchId: string; forward: boolean }> {
  const path: Array<{ nodeId: string; branchId: string; forward: boolean }> = [];
  let cur: string | null = toId;
  while (cur && prev.has(cur) && prev.get(cur) !== null) {
    const p = prev.get(cur)!;
    if (!p) break;
    path.unshift({ nodeId: p.nodeId, branchId: p.branchId, forward: p.forward });
    cur = p.nodeId;
  }
  return path;
}

// ─── Основная функция расчёта ──────────────────────────────────────────────────

export function calcRescue(
  nodes: TopoNodeLite[],
  branches: TopoBranchLite[],
  startNodeId: string,
  targetNodeId: string,
  params: RescueParams,
): RescueResult {
  const warnings: string[] = [];
  const waypointNodeIds = params.waypointNodeIds ?? [];

  // ── Строим граф (аналогично предыдущему) ──────────────────────────────────
  const adj = new Map<string, Edge[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const b of branches) {
    if (b.isLeakage) continue;
    if ((b.length ?? 0) <= 0) continue;
    if (b.hasBulkhead && !isBulkheadPassable(b.bulkheadId)) continue;
    adj.get(b.fromId)?.push({ toId: b.toId, branchId: b.id, forward: true });
    adj.get(b.toId)?.push({ toId: b.fromId, branchId: b.id, forward: false });
  }

  // ── Маршрут: старт → [вайпоинты] → цель ──────────────────────────────────
  const checkpoints = [startNodeId, ...waypointNodeIds, targetNodeId];
  const allPathEdges: Array<{ nodeId: string; branchId: string; forward: boolean }> = [];
  let routeOk = true;

  for (let i = 0; i < checkpoints.length - 1; i++) {
    const from = checkpoints[i];
    const to   = checkpoints[i + 1];
    const { dist, prev } = buildDijkstra(nodes, branches, adj, from);
    if ((dist.get(to) ?? Infinity) === Infinity) {
      warnings.push(`Маршрут от узла ${from} до узла ${to} не найден — проверьте связность сети`);
      routeOk = false;
      continue;
    }
    const segEdges = buildPath(prev, to);
    allPathEdges.push(...segEdges);
  }

  // ── Карта ветвей и узлов ──────────────────────────────────────────────────
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchMap = new Map(branches.map(b => [b.id, b]));

  // ── Строим сегменты маршрута ──────────────────────────────────────────────
  function buildSegments(
    edges: Array<{ nodeId: string; branchId: string; forward: boolean }>,
  ): RescueSegment[] {
    const result: RescueSegment[] = [];
    let cumTime = 0;
    let cumO2 = 0;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const b = branchMap.get(edge.branchId);
      if (!b) continue;

      const isForward = edge.forward;
      const smokeDens = b.fireComputedSmokeDens ?? 0;
      const zone = getZone(smokeDens);
      const signedAngle = isForward ? (b.angle ?? 0) : -(b.angle ?? 0);

      const speed     = getSpeed(zone, signedAngle);
      const speed_cl  = getSpeed("clean",      signedAngle);
      const speed_sl  = getSpeed("smoky_low",  signedAngle);
      const speed_sh  = getSpeed("smoky_high", signedAngle);

      const time_min      = b.length > 0 ? b.length / speed    : 0;
      const time_clean      = b.length > 0 ? b.length / speed_cl  : 0;
      const time_smoky_low  = b.length > 0 ? b.length / speed_sl : 0;
      const time_smoky_high = b.length > 0 ? b.length / speed_sh : 0;

      const o2c   = params.oxygenConsumption ?? 1.4;
      const o2_liters      = time_min * o2c;
      const o2_clean       = time_clean       * o2c;
      const o2_smoky_low   = time_smoky_low  * o2c;
      const o2_smoky_high  = time_smoky_high * o2c;
      // Расход O₂ на 100 м при чистом воздухе (k3=1): o2c * 100 / speed_clean
      // Так считает ПО Вентиляция — нормативный расход без учёта задымления
      const o2_per_100m = speed_cl > 0 ? o2c * 100 / speed_cl : 0;

      const vis = smokeDens > 0 ? 2 / smokeDens : 999;

      const fromNodeId = isForward ? b.fromId : b.toId;
      const toNodeId   = isForward ? b.toId   : b.fromId;
      const fromNode   = nodeMap.get(fromNodeId);
      const toNode     = nodeMap.get(toNodeId);

      cumTime += time_min;
      cumO2   += o2_liters;

      const speedBack = getSpeed(zone, -signedAngle);
      const time_back = b.length > 0 ? b.length / speedBack : 0;
      const o2_back   = time_back * o2c;

      // Название выработки: type (тип выработки из схемы) → name → fallback узлы
      const branchLabel = b.type?.trim() || b.name?.trim() || "";
      const nodeFrom = fromNode?.name || (fromNode?.number ? `Узел ${fromNode.number}` : fromNodeId);
      const nodeTo   = toNode?.name   || (toNode?.number   ? `Узел ${toNode.number}`   : toNodeId);
      const branchName = branchLabel
        ? `${branchLabel} (${nodeFrom} → ${nodeTo})`
        : `${nodeFrom} → ${nodeTo}`;

      result.push({
        branchId: b.id,
        branchNumber: b.number || b.id,
        branchName,
        branchLabel,
        segmentNumber: i + 1,
        length: b.length,
        angle: signedAngle,
        fromNodeId,
        toNodeId,
        smokeDensity: smokeDens,
        coConc: b.fireComputedCO ?? 0,
        visibility: vis,
        zone,
        speed_mpm: speed,
        time_min,
        time_back_min: time_back,
        o2_liters,
        o2_back_liters: o2_back,
        o2_per_100m,
        cumulTime: cumTime,
        cumulO2: cumO2,
        speed_clean: speed_cl,
        time_clean,
        o2_clean,
        speed_smoky_low:  speed_sl,
        time_smoky_low,
        o2_smoky_low,
        speed_smoky_high: speed_sh,
        time_smoky_high,
        o2_smoky_high,
      });
    }
    return result;
  }

  const segments = buildSegments(allPathEdges);
  const backEdges = [...allPathEdges].reverse().map(e => ({ ...e, forward: !e.forward }));
  const segmentsBack = buildSegments(backEdges);

  // Карта направлений для подсветки
  const branchDirs = new Map<string, boolean>();
  for (const edge of allPathEdges) branchDirs.set(edge.branchId, edge.forward);

  // ── Суммируем ──────────────────────────────────────────────────────────────
  const totalTimeForward = segments.reduce((s, seg) => s + seg.time_min, 0);
  const totalTimeBack    = segmentsBack.reduce((s, seg) => s + seg.time_min, 0);
  const totalO2Forward   = segments.reduce((s, seg) => s + seg.o2_liters, 0);
  const totalO2Back      = segmentsBack.reduce((s, seg) => s + seg.o2_liters, 0);
  const care = params.provideCare ? (params.careTime ?? 10) : 0;
  const o2c  = params.oxygenConsumption ?? 1.4;

  const idaTimeInSmoke = [...segments, ...segmentsBack]
    .filter(s => s.zone !== "clean")
    .reduce((s, seg) => s + seg.time_min, 0);
  const idaO2InSmoke = [...segments, ...segmentsBack]
    .filter(s => s.zone !== "clean")
    .reduce((s, seg) => s + seg.o2_liters, 0);

  // ── Логика включения обратного пути по типу операции ──────────────────────
  // "scout"       — только разведка туда, без обратного пути и помощи
  // "liquidation" — туда + работы (care), без обратного пути
  // остальные     — туда + помощь + обратно
  const opType = params.operationType ?? "scout_and_transport";
  const includeBack = opType !== "scout" && opType !== "liquidation";
  const includeCare = opType !== "scout";

  const effectiveCare = includeCare ? care : 0;
  const effectiveTimeBack = includeBack ? totalTimeBack : 0;
  const effectiveO2Back   = includeBack ? totalO2Back   : 0;

  const totalTime = totalTimeForward + effectiveCare + effectiveTimeBack;
  const totalO2   = totalO2Forward + effectiveCare * o2c + effectiveO2Back;

  // Нормативные зоны задымления (весь маршрут туда + обратно)
  const fwdCL  = segments.reduce((s, seg) => s + seg.time_clean, 0);
  const fwdSL  = segments.reduce((s, seg) => s + seg.time_smoky_low, 0);
  const fwdSH  = segments.reduce((s, seg) => s + seg.time_smoky_high, 0);
  const bckCL  = segmentsBack.reduce((s, seg) => s + seg.time_clean, 0);
  const bckSL  = segmentsBack.reduce((s, seg) => s + seg.time_smoky_low, 0);
  const bckSH  = segmentsBack.reduce((s, seg) => s + seg.time_smoky_high, 0);
  const totalTime_clean      = fwdCL + effectiveCare + (includeBack ? bckCL : 0);
  const totalTime_smoky_low  = fwdSL + effectiveCare + (includeBack ? bckSL : 0);
  const totalTime_smoky_high = fwdSH + effectiveCare + (includeBack ? bckSH : 0);
  const totalO2_clean = segments.reduce((s, seg) => s + seg.o2_clean, 0)
    + effectiveCare * o2c
    + (includeBack ? segmentsBack.reduce((s, seg) => s + seg.o2_clean, 0) : 0);
  const totalO2_smoky_low  = segments.reduce((s, seg) => s + seg.o2_smoky_low, 0)
    + effectiveCare * o2c
    + (includeBack ? segmentsBack.reduce((s, seg) => s + seg.o2_smoky_low, 0) : 0);
  const totalO2_smoky_high = segments.reduce((s, seg) => s + seg.o2_smoky_high, 0)
    + effectiveCare * o2c
    + (includeBack ? segmentsBack.reduce((s, seg) => s + seg.o2_smoky_high, 0) : 0);

  const idaTimePct = params.useIdaTime ? totalTime / (params.idaWorkTime ?? 400) * 100 : 0;
  const idaO2Pct   = (params.oxygenVolume ?? 400) > 0
    ? totalO2 / (params.oxygenVolume ?? 400) * 100 : 0;

  const ok = (!params.useIdaTime || totalTime <= (params.idaWorkTime ?? 400))
          && totalO2 <= (params.oxygenVolume ?? 400);

  if (!ok) {
    if (params.useIdaTime && totalTime > (params.idaWorkTime ?? 400))
      warnings.push(`Время операции ${totalTime.toFixed(1)} мин превышает ресурс ИДА ${params.idaWorkTime} мин`);
    if (totalO2 > (params.oxygenVolume ?? 400))
      warnings.push(`Расход O₂ ${totalO2.toFixed(1)} л превышает объём ИДА ${params.oxygenVolume} л`);
  }
  if (!routeOk && segments.length === 0) {
    warnings.push("Маршрут не построен — проверьте начальный, промежуточные и целевой узлы");
  }

  return {
    targetNodeId,
    startNodeId,
    waypointNodeIds,
    operationType: params.operationType,
    segments,
    segmentsBack,
    totalTime,
    totalTimeForward,
    totalTimeBack,
    careTime: care,
    totalO2,
    totalO2Forward,
    totalO2Back,
    o2IdaPercent: idaO2Pct,
    timeIdaPercent: idaTimePct,
    idaTimeInSmoke,
    idaO2InSmoke,
    totalTime_clean,
    totalO2_clean,
    totalTime_smoky_low,
    totalTime_smoky_high,
    totalO2_smoky_low,
    totalO2_smoky_high,
    ok,
    warnings,
    branchDirs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// РАСЧЁТ ВРЕМЕНИ ХОДА ГОРНОРАБОЧЕГО
// Источник: РД 15-11-2007 Прил.4 (нормы движения без ИДА),
//           ФНиП №467 (угольные шахты)
// ─────────────────────────────────────────────────────────────────────────────

// Скорости горнорабочего (м/мин) — без ИДА, аварийная обстановка
// Источник: РД 15-11-2007, Приложение 4, таблица нормативных скоростей движения
// (согласованы с Аэросетью / ВНИМИ: горизонт = 60 м/мин, подъём 8° = 80 м/мин)
function getWorkerSpeed(method: "rd" | "fnip", angleDeg: number): number {
  const a = Math.abs(angleDeg);
  const isDown = angleDeg < 0;
  if (method === "rd") {
    // РД 15-11-2007 Прил.4: скорость горнорабочего без ИДА
    // подъём/горизонт:  0°=60, 5°=50, 10°=40, 15°=33, 20°=27, 30°=20, 45°=14, >45°=10
    // спуск (быстрее):  0°=60, 5°=65, 10°=73, 15°=70, 20°=60, 30°=45, 45°=30, >45°=22
    if (isDown) {
      if (a <= 5)  return 65;
      if (a <= 10) return 73;
      if (a <= 15) return 70;
      if (a <= 20) return 60;
      if (a <= 30) return 45;
      if (a <= 45) return 30;
      return 22;
    } else {
      if (a <= 5)  return 60;
      if (a <= 10) return 50;
      if (a <= 15) return 40;
      if (a <= 20) return 33;
      if (a <= 30) return 27;
      if (a <= 45) return 20;
      return 14;
    }
  } else {
    // ФНиП №467, скорость горнорабочего (угольные шахты, пропорционально выше на ~10%)
    if (isDown) {
      if (a <= 5)  return 70;
      if (a <= 10) return 80;
      if (a <= 15) return 77;
      if (a <= 20) return 66;
      if (a <= 30) return 50;
      if (a <= 45) return 33;
      return 24;
    } else {
      if (a <= 5)  return 66;
      if (a <= 10) return 55;
      if (a <= 15) return 44;
      if (a <= 20) return 36;
      if (a <= 30) return 30;
      if (a <= 45) return 22;
      return 15;
    }
  }
}

export interface WorkerSegment {
  branchId: string;
  branchName: string;
  branchLabel: string;
  segmentNumber: number;
  length: number;          // м
  angle: number;           // °
  fromNodeId: string;
  toNodeId: string;
  zone: "clean" | "smoky_low" | "smoky_high";
  smokeDensity: number;    // м⁻¹
  speed_mpm: number;       // м/мин (туда)
  speed_back_mpm: number;  // м/мин (обратно)
  time_min: number;        // мин (туда)
  time_back_min: number;   // мин (обратно)
  cumulTime: number;       // накопленное время туда
  cumulTimeBack: number;   // накопленное обратно (считается отдельно)
}

export interface WorkerPathResult {
  startNodeId: string;
  targetNodeId: string;
  waypointNodeIds: string[];
  method: "rd" | "fnip";
  segments: WorkerSegment[];
  totalTimeForward: number;  // мин
  totalTimeBack: number;     // мин
  totalTime: number;         // мин (туда + обратно)
  ok: boolean;
  warnings: string[];
  branchDirs: Map<string, boolean>;
}

export function calcWorkerPath(
  nodes: TopoNodeLite[],
  branches: TopoBranchLite[],
  startNodeId: string,
  targetNodeId: string,
  method: "rd" | "fnip",
  waypointNodeIds: string[] = [],
): WorkerPathResult {
  const warnings: string[] = [];

  // Строим граф (все ветви проходимы для горнорабочего, включая перемычки с дверями)
  const adj = new Map<string, Edge[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const b of branches) {
    if (b.isLeakage) continue;
    if ((b.length ?? 0) <= 0) continue;
    // Горнорабочий проходит через двери, паруса, регуляторы; глухие перемычки — нет
    if (b.hasBulkhead && !isBulkheadPassable(b.bulkheadId)) continue;
    adj.get(b.fromId)?.push({ toId: b.toId, branchId: b.id, forward: true });
    adj.get(b.toId)?.push({ toId: b.fromId, branchId: b.id, forward: false });
  }

  // Дейкстра с весами по скорости горнорабочего
  function dijkstraWorker(startId: string) {
    const dist = new Map<string, number>();
    const prev = new Map<string, { nodeId: string; branchId: string; forward: boolean } | null>();
    for (const n of nodes) dist.set(n.id, Infinity);
    dist.set(startId, 0);
    prev.set(startId, null);
    type PQItem = { nodeId: string; d: number };
    const pq: PQItem[] = [{ nodeId: startId, d: 0 }];
    const visited = new Set<string>();
    while (pq.length > 0) {
      pq.sort((a, b) => a.d - b.d);
      const { nodeId: cur, d: curD } = pq.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const edge of (adj.get(cur) ?? [])) {
        const b = branches.find(b2 => b2.id === edge.branchId);
        if (!b) continue;
        const signedAngle = edge.forward ? (b.angle ?? 0) : -(b.angle ?? 0);
        const sdens = b.fireComputedSmokeDens ?? 0;
        const sz = getZone(sdens);
        const smokeK = sz === "clean" ? 1.0 : sz === "smoky_low" ? 0.75 : 0.55;
        const speed = Math.round(getWorkerSpeed(method, signedAngle) * smokeK);
        const t = b.length > 0 ? b.length / Math.max(1, speed) : 0;
        const nd = curD + t;
        if (nd < (dist.get(edge.toId) ?? Infinity)) {
          dist.set(edge.toId, nd);
          prev.set(edge.toId, { nodeId: cur, branchId: b.id, forward: edge.forward });
          pq.push({ nodeId: edge.toId, d: nd });
        }
      }
    }
    return { dist, prev };
  }

  const checkpoints = [startNodeId, ...waypointNodeIds, targetNodeId];
  const allPathEdges: Array<{ nodeId: string; branchId: string; forward: boolean }> = [];
  let routeOk = true;

  for (let i = 0; i < checkpoints.length - 1; i++) {
    const from = checkpoints[i];
    const to = checkpoints[i + 1];
    const { dist, prev } = dijkstraWorker(from);
    if ((dist.get(to) ?? Infinity) === Infinity) {
      warnings.push(`Маршрут от узла ${from} до узла ${to} не найден — проверьте связность сети`);
      routeOk = false;
      continue;
    }
    const segEdges = buildPath(prev, to);
    allPathEdges.push(...segEdges);
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchMap = new Map(branches.map(b => [b.id, b]));

  // Строим сегменты вперёд
  const segments: WorkerSegment[] = [];
  let cumTime = 0;
  for (let i = 0; i < allPathEdges.length; i++) {
    const edge = allPathEdges[i];
    const b = branchMap.get(edge.branchId);
    if (!b) continue;
    const isForward = edge.forward;
    const signedAngle = isForward ? (b.angle ?? 0) : -(b.angle ?? 0);
    // Учёт задымления: в задымлённых зонах горнорабочий движется медленнее
    const smokeDensity = b.fireComputedSmokeDens ?? 0;
    const zone = getZone(smokeDensity);
    // Скорость горнорабочего корректируется аналогично горноспасателю (без кислорода)
    // В чистой зоне — нормативная скорость по методике; в задымлении — снижается
    const workerBaseSpeed = getWorkerSpeed(method, signedAngle);
    const smokeKoeff = zone === "clean" ? 1.0 : zone === "smoky_low" ? 0.75 : 0.55;
    const speed = Math.round(workerBaseSpeed * smokeKoeff);
    const speedBackBase = getWorkerSpeed(method, -signedAngle);
    const speedBack = Math.round(speedBackBase * smokeKoeff);
    const time_min = b.length > 0 ? b.length / speed : 0;
    const time_back_min = b.length > 0 ? b.length / speedBack : 0;
    cumTime += time_min;

    const fromNodeId = isForward ? b.fromId : b.toId;
    const toNodeId   = isForward ? b.toId   : b.fromId;
    const fromNode   = nodeMap.get(fromNodeId);
    const toNode     = nodeMap.get(toNodeId);
    const branchLabel = b.name?.trim() || "";
    const nodeFrom = fromNode?.name || (fromNode?.number ? `Узел ${fromNode.number}` : fromNodeId);
    const nodeTo   = toNode?.name   || (toNode?.number   ? `Узел ${toNode.number}`   : toNodeId);
    const branchName = branchLabel ? `${branchLabel} (${nodeFrom} → ${nodeTo})` : `${nodeFrom} → ${nodeTo}`;

    segments.push({
      branchId: b.id, branchName, branchLabel,
      segmentNumber: i + 1,
      length: b.length, angle: signedAngle,
      fromNodeId, toNodeId,
      zone, smokeDensity,
      speed_mpm: speed, speed_back_mpm: speedBack, time_min, time_back_min,
      cumulTime: cumTime, cumulTimeBack: 0,
    });
  }

  // Считаем обратное накопленное время
  const backEdges = [...allPathEdges].reverse().map(e => ({ ...e, forward: !e.forward }));
  let cumBack = 0;
  const backTimes: number[] = [];
  for (const edge of backEdges) {
    const b = branchMap.get(edge.branchId);
    if (!b) continue;
    const signedAngle = edge.forward ? (b.angle ?? 0) : -(b.angle ?? 0);
    const speed = getWorkerSpeed(method, signedAngle);
    const t = b.length > 0 ? b.length / speed : 0;
    cumBack += t;
    backTimes.push(cumBack);
  }
  for (let i = 0; i < segments.length; i++) {
    segments[segments.length - 1 - i].cumulTimeBack = backTimes[i] ?? 0;
  }

  const totalTimeForward = segments.reduce((s, seg) => s + seg.time_min, 0);
  const totalTimeBack    = segments.reduce((s, seg) => s + seg.time_back_min, 0);
  const totalTime = totalTimeForward + totalTimeBack;

  const branchDirs = new Map<string, boolean>();
  for (const edge of allPathEdges) branchDirs.set(edge.branchId, edge.forward);

  if (!routeOk && segments.length === 0) {
    warnings.push("Маршрут не построен — проверьте начальный, промежуточные и целевой узлы");
  }

  return {
    startNodeId, targetNodeId, waypointNodeIds,
    method, segments,
    totalTimeForward, totalTimeBack, totalTime,
    ok: routeOk && segments.length > 0,
    warnings, branchDirs,
  };
}