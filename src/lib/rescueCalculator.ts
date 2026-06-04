/**
 * Расчёт времени хода горноспасателей по горным выработкам.
 * Алгоритм: Дейкстра по графу сети с учётом скорости движения,
 * типа атмосферы (пригодная/непригодная по задымлению),
 * затрат кислорода ИДА и оказания помощи пострадавшим.
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
}

export interface RescueSegment {
  branchId: string;
  branchName: string;
  segmentNumber: number;
  length: number;           // м
  angle: number;            // °
  fromNodeId: string;
  toNodeId: string;

  // Зоны задымления для каждого участка (из расчёта пожара)
  smokeDensity: number;     // м⁻¹ (0 = чистый воздух)
  coConc: number;           // % концентрация CO
  visibility: number;       // м видимость (м⁻¹ → м: 2/σ при σ>0, иначе Inf)

  // Результаты расчёта
  zone: "clean" | "smoky_low" | "smoky_high";  // <5м, 5-10м, >10м видимость
  speed_mpm: number;        // м/мин скорость движения
  time_min: number;         // мин время прохождения участка (туда)
  time_back_min: number;    // мин время прохождения обратно
  o2_liters: number;        // л затраты кислорода (туда)
  o2_back_liters: number;   // л затраты кислорода (обратно)
  cumulTime: number;        // мин накопленное время от базы
  cumulO2: number;          // л накопленный O₂
}

export interface RescueResult {
  targetNodeId: string;
  startNodeId: string;
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

  ok: boolean;                     // можно ли выполнить операцию с данным ИДА
  warnings: string[];
  /** Направление движения по каждой ветви маршрута: true = fromId→toId */
  branchDirs: Map<string, boolean>;
}

// ─── Нормативные скорости движения ────────────────────────────────────────────
// Источник: РД 15-11-2007, Приложение 4, таблица скоростей движения ВГСЧ
// Знак угла: + подъём, - спуск; горизонт = 0

function getSpeed(zone: "clean" | "smoky_low" | "smoky_high", angleDeg: number): number {
  const a = Math.abs(angleDeg);
  // Чистый воздух
  if (zone === "clean") {
    if (a <= 5)  return 54;    // горизонталь ≤5°
    if (a <= 10) return 46;
    if (a <= 15) return 40;
    if (a <= 20) return 34;
    if (a <= 30) return 26;
    if (a <= 45) return 18;
    return 16;
  }
  // Видимость 5-10 м (непригодная атмосфера, видимость ≥5м)
  if (zone === "smoky_low") {
    if (a <= 5)  return 45;
    if (a <= 10) return 39;
    if (a <= 20) return 28;
    if (a <= 30) return 23;
    return 18;
  }
  // Видимость <5 м (густое задымление)
  if (a <= 5)  return 31;
  if (a <= 10) return 28;
  if (a <= 20) return 22;
  return 18;
}

function getZone(smokeDensity: number): "clean" | "smoky_low" | "smoky_high" {
  if (smokeDensity <= 0.001) return "clean";
  const vis = smokeDensity > 0 ? 2 / smokeDensity : Infinity;
  if (vis >= 10) return "smoky_low";
  if (vis >= 5)  return "smoky_low";
  return "smoky_high";
}

// ─── Основная функция расчёта ──────────────────────────────────────────────────

export interface TopoNodeLite {
  id: string;
  name: string;
  number: string;
  x: number; y: number; z: number;
}
export interface TopoBranchLite {
  id: string;
  fromId: string;
  toId: string;
  length: number;
  angle: number;
  area: number;
  name?: string;
  fireComputedSmokeDens?: number;
  fireComputedCO?: number;
  flow?: number;
  // Перемычки
  hasBulkhead?: boolean;
  bulkheadId?: string;        // ID типа из справочника (door_auto, solid_concrete, sail…)
  bulkheadName?: string;      // название для предупреждений
  bulkheadR?: number;         // Мюрг — сопротивление перемычки
  bulkheadAirPerm?: number;   // м²/(с·√Па) — воздухопроницаемость
  isLeakage?: boolean;        // утечка (не проходима для людей)
  resistance?: number;        // Н·с²/м⁸ аэродинамическое сопротивление ветви
}

/**
 * Определяет проходимость перемычки для горноспасателей.
 * Глухие (solid) и водоподпорные (water) — непроходимы.
 * Двери (door), паруса (sail), регуляторы (regulator) — проходимы.
 * Пользовательские (custom) — считаются проходимыми (нет данных).
 *
 * Логика по bulkheadId: если ID начинается с "solid_", "bk_", "water_dam",
 * "bulkhead" (без "window") или "barrier" — непроходима.
 */
export function isBulkheadPassable(bulkheadId?: string): boolean {
  if (!bulkheadId) return false; // нет ID — перемычка неизвестного типа, исключаем
  const id = bulkheadId.toLowerCase();
  // Глухие перемычки — непроходимы
  if (id.startsWith("solid_") || id.startsWith("bk_")) return false;
  if (id === "bulkhead" || id === "bulkhead_concrete" || id === "bulkhead_wood"
    || id === "bulkhead_brick" || id === "bulkhead_metal") return false;
  // Водоподпорные — непроходимы
  if (id.startsWith("water_dam") || id.startsWith("water_")) return false;
  // Барьерные и огнестойкие заглушки — непроходимы
  if (id === "bulkhead_barrier" || id === "barrier") return false;
  // Парус — проходим
  if (id === "sail") return true;
  // Двери вентиляционные (закрытые, автоматические, открытые, с окном, решётчатые) — проходимы
  if (id.startsWith("door_") || id.startsWith("auto_") || id.startsWith("open_")
    || id.startsWith("win_") || id.startsWith("lat_") || id.startsWith("proem_")) return true;
  // Регуляторы/шиберы — проходимы
  if (id.startsWith("regulator_") || id === "regulator") return true;
  // Пожарная дверь — проходима
  if (id === "fire_door" || id === "fire_door_pp") return true;
  // Остальные — считаем непроходимыми (безопасный fallback)
  return false;
}

export function calcRescue(
  nodes: TopoNodeLite[],
  branches: TopoBranchLite[],
  startNodeId: string,
  targetNodeId: string,
  params: RescueParams,
): RescueResult {
  const warnings: string[] = [];

  // ── Дейкстра по обходу наименьшего времени ────────────────────────────────
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  // Строим граф: nodeId → список {toId, branchId, forward(true/false)}
  // Перемычки (hasBulkhead) и утечки (isLeakage) непроходимы для людей — исключаем
  type Edge = { toId: string; branchId: string; forward: boolean };
  const adj = new Map<string, Edge[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const b of branches) {
    // Утечки (перетечки) — непроходимы
    if (b.isLeakage) continue;
    // Ветви с нулевой длиной пропускаем
    if ((b.length ?? 0) <= 0) continue;

    // Ветвь с перемычкой — проверяем тип
    if (b.hasBulkhead) {
      const passable = isBulkheadPassable(b.bulkheadId);
      if (!passable) {
        // Глухая/водоподпорная — исключаем из маршрута (тихо, без предупреждений)
        continue;
      }
      // Проходимая перемычка (дверь, парус, регулятор) — включаем в маршрут
    }

    adj.get(b.fromId)?.push({ toId: b.toId, branchId: b.id, forward: true });
    adj.get(b.toId)?.push({ toId: b.fromId, branchId: b.id, forward: false });
  }

  // Время прохождения ветви в заданном направлении (мин)
  function edgeTime(b: TopoBranchLite, forward: boolean): number {
    const smokeDens = b.fireComputedSmokeDens ?? 0;
    const signedAngle = forward ? (b.angle ?? 0) : -(b.angle ?? 0);
    const zone = getZone(smokeDens);
    const speed = getSpeed(zone, signedAngle);
    return b.length > 0 ? b.length / speed : 0;
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; branchId: string; forward: boolean } | null>();
  for (const n of nodes) { dist.set(n.id, Infinity); }
  dist.set(startNodeId, 0);
  prev.set(startNodeId, null);

  // Simple priority queue (sorted array)
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
      const t = edgeTime(b, edge.forward);
      const nd = curD + t;
      if (nd < (dist.get(edge.toId) ?? Infinity)) {
        dist.set(edge.toId, nd);
        prev.set(edge.toId, { nodeId: cur, branchId: b.id, forward: edge.forward });
        pq.push({ nodeId: edge.toId, d: nd });
      }
    }
  }

  // ── Восстанавливаем путь ───────────────────────────────────────────────────
  function buildPath(toId: string): Array<{ nodeId: string; branchId: string; forward: boolean }> {
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

  const pathEdges = buildPath(targetNodeId);

  // ── Строим массив сегментов ────────────────────────────────────────────────
  function buildSegments(edges: Array<{ nodeId: string; branchId: string; forward: boolean }>, reverse = false): RescueSegment[] {
    const result: RescueSegment[] = [];
    let cumTime = 0;
    let cumO2 = 0;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const b = branches.find(b2 => b2.id === edge.branchId);
      if (!b) continue;

      const isForward = reverse ? !edge.forward : edge.forward;
      const smokeDens = b.fireComputedSmokeDens ?? 0;
      const zone = getZone(smokeDens);
      const signedAngle = isForward ? (b.angle ?? 0) : -(b.angle ?? 0);
      const speed = getSpeed(zone, signedAngle);
      const time_min = b.length > 0 ? b.length / speed : 0;
      const o2_liters = time_min * (params.oxygenConsumption ?? 1.4);
      const vis = smokeDens > 0 ? 2 / smokeDens : 999;

      const fromNodeId = isForward ? b.fromId : b.toId;
      const toNodeId   = isForward ? b.toId   : b.fromId;
      const fromNode   = nodeMap.get(fromNodeId);
      const toNode     = nodeMap.get(toNodeId);

      cumTime += time_min;
      cumO2   += o2_liters;

      // Время обратного хода по этому же участку
      const speedBack = getSpeed(zone, -signedAngle);
      const time_back = b.length > 0 ? b.length / speedBack : 0;
      const o2_back   = time_back * (params.oxygenConsumption ?? 1.4);

      result.push({
        branchId: b.id,
        branchName: fromNode
          ? `${fromNode.name || fromNode.number || fromNodeId} → ${toNode?.name || toNode?.number || toNodeId}`
          : b.id,
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
        cumulTime: cumTime,
        cumulO2: cumO2,
      });
    }
    return result;
  }

  const segments = buildSegments(pathEdges, false);
  const segmentsBack = buildSegments([...pathEdges].reverse().map(e => ({ ...e, forward: !e.forward })), false);

  // Карта направлений для подсветки на схеме: branchId → forward (true = fromId→toId)
  const branchDirs = new Map<string, boolean>();
  for (const edge of pathEdges) {
    branchDirs.set(edge.branchId, edge.forward);
  }

  // ── Суммируем ──────────────────────────────────────────────────────────────
  const totalTimeForward  = segments.reduce((s, seg) => s + seg.time_min, 0);
  const totalTimeBack     = segmentsBack.reduce((s, seg) => s + seg.time_min, 0);
  const totalO2Forward    = segments.reduce((s, seg) => s + seg.o2_liters, 0);
  const totalO2Back       = segmentsBack.reduce((s, seg) => s + seg.o2_liters, 0);
  const care = params.provideCare ? (params.careTime ?? 10) : 0;

  // Время в задымлённой атмосфере
  const idaTimeInSmoke = [...segments, ...segmentsBack]
    .filter(s => s.zone !== "clean")
    .reduce((s, seg) => s + seg.time_min, 0);
  const idaO2InSmoke = [...segments, ...segmentsBack]
    .filter(s => s.zone !== "clean")
    .reduce((s, seg) => s + seg.o2_liters, 0);

  const totalTime = totalTimeForward + care + totalTimeBack;
  const totalO2 = totalO2Forward + care * (params.oxygenConsumption ?? 1.4) + totalO2Back;

  const idaTimePct  = params.useIdaTime  ? totalTime / (params.idaWorkTime ?? 400) * 100 : 0;
  const idaO2Pct    = (params.oxygenVolume ?? 400) > 0
    ? totalO2 / (params.oxygenVolume ?? 400) * 100 : 0;

  const ok = (!params.useIdaTime || totalTime <= (params.idaWorkTime ?? 400))
          && totalO2 <= (params.oxygenVolume ?? 400);

  if (!ok) {
    if (params.useIdaTime && totalTime > (params.idaWorkTime ?? 400))
      warnings.push(`Время операции ${totalTime.toFixed(1)} мин превышает ресурс ИДА ${params.idaWorkTime} мин`);
    if (totalO2 > (params.oxygenVolume ?? 400))
      warnings.push(`Расход O₂ ${totalO2.toFixed(1)} л превышает объём ИДА ${params.oxygenVolume} л`);
  }
  if (dist.get(targetNodeId) === Infinity) {
    warnings.push("Маршрут до выбранного узла не найден — возможно, граф несвязный");
  }

  return {
    targetNodeId,
    startNodeId,
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
    ok,
    warnings,
    branchDirs,
  };
}