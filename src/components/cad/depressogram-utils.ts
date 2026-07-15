import type { TopoNode, TopoBranch } from "@/lib/topology";

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface DepressogramPoint {
  nodeId: string;
  nodeName: string;
  nodeNumber: string;
  branchId: string | null;
  branchName: string;
  branchNumber: string | null;
  cumulativeLength: number;
  pressure: number;
  dP: number;
}

// ─── Алгоритм: маршрут наибольшего расхода воздуха от ГВУ до поверхности ──────
// НОРМАТИВНОЕ определение (ПБ): маршрут, определяющий аэродинамическое
// сопротивление шахтной вентиляционной сети — это такой маршрут, по которому
// проходит НАИБОЛЬШЕЕ КОЛИЧЕСТВО ВОЗДУХА (расход Q) от ГВУ до поверхности,
// без преграждения вентиляционными сооружениями (перемычками).
//
// Поэтому маршрут выбирается по РАСХОДУ Q (не по депрессии). Строим путь от
// "шахтного" конца ГВУ вглубь сети до поверхностного узла (atmosphereLink),
// максимизируя пропускаемый по маршруту расход воздуха (bottleneck по Q —
// наибольшая струя, которая доходит от ГВУ до поверхности). Ветви с перемычками
// и с другими вентиляторами не проходим — это преграды для основной струи.
// Депрессия (|dP|) откладывается по этому маршруту на графике, но НЕ является
// критерием его выбора.
//
// ВГП выбирается автоматически (приоритет типу "ГВУ"), либо явно задаётся
// параметром preferredFanBranchId (пользователь указывает ветвь ВГП).
export function findMainRoute(
  nodes: TopoNode[],
  branches: TopoBranch[],
  preferredFanBranchId?: string
): { path: string[]; branchPath: string[]; fanId?: string } | null {
  const surfaceNodeIds = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));
  if (surfaceNodeIds.size === 0) return null;

  // Граф смежности. Каждой ветви — расход |flow| (критерий маршрута) и |dP| (для графика).
  const adj = new Map<string, { branchId: string; neighborId: string; flow: number; dP: number; hasBulkhead: boolean; hasFan: boolean }[]>();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    const entry = { branchId: b.id, flow: Math.abs(b.flow ?? 0), dP: Math.abs(b.dP ?? 0), hasBulkhead: b.hasBulkhead, hasFan: b.hasFan };
    adj.get(b.fromId)!.push({ ...entry, neighborId: b.toId });
    adj.get(b.toId)!.push({ ...entry, neighborId: b.fromId });
  }

  // Список ВГП. Если задан preferredFanBranchId — только он.
  // Иначе: приоритет главным вентиляторам (fanType === "ГВУ"), затем остальные.
  let fanBranches = branches.filter(b => b.hasFan && !b.fanStopped);
  if (preferredFanBranchId) {
    const preferred = branches.find(b => b.id === preferredFanBranchId);
    fanBranches = preferred ? [preferred] : fanBranches;
  } else {
    const gvu = fanBranches.filter(b => b.fanType === "ГВУ");
    if (gvu.length > 0) fanBranches = gvu;
  }
  if (fanBranches.length === 0) return null;

  let bestPath: string[] = [];
  let bestBranchPath: string[] = [];
  let bestFlow = -1;    // критерий выбора между ВГП — расход маршрута
  let bestFanId: string | undefined;

  for (const fan of fanBranches) {
    // Определяем "шахтный" конец ВГП (не поверхность) — от него идём вглубь сети.
    const flow = fan.flow ?? 0;
    let shaftNodeId: string;
    let surfNodeId: string;

    if (Math.abs(flow) < 0.001) {
      if (surfaceNodeIds.has(fan.toId)) {
        shaftNodeId = fan.fromId; surfNodeId = fan.toId;
      } else {
        shaftNodeId = fan.toId; surfNodeId = fan.fromId;
      }
    } else if (flow > 0) {
      shaftNodeId = fan.fromId; surfNodeId = fan.toId;
    } else {
      shaftNodeId = fan.toId; surfNodeId = fan.fromId;
    }
    if (surfaceNodeIds.has(shaftNodeId) && !surfaceNodeIds.has(surfNodeId)) {
      [shaftNodeId, surfNodeId] = [surfNodeId, shaftNodeId];
    }

    // Путь НАИБОЛЬШЕГО расхода от shaftNodeId до поверхностного узла.
    const result = findMaxFlowRoute(adj, shaftNodeId, surfNodeId, surfaceNodeIds);
    if (result.branches.length === 0) continue;

    const nodePath = result.nodes;      // [shaftNodeId, ..., поверхностный_узел]
    const branchPath = result.branches; // ветви от shaftNodeId до поверхности

    // Итоговый маршрут: поверхность (ГВУ) → шахта. Добавляем ветвь ВГП в начало,
    // а surfNodeId ВГП — как самую первую точку (выход ГВУ на поверхность).
    // Маршрут читается от ГВУ (высокое давление) до выхода на поверхность (0).
    const fullNodes = [surfNodeId, ...nodePath];
    const fullBranches = [fan.id, ...branchPath];

    // Критерий выбора между несколькими ВГП — расход самого маршрута (по ветви ВГП).
    const routeFlow = Math.abs(fan.flow ?? 0);
    if (routeFlow > bestFlow && fullBranches.length > 1) {
      bestFlow = routeFlow;
      bestPath = fullNodes;
      bestBranchPath = fullBranches;
      bestFanId = fan.id;
    }
  }

  if (bestBranchPath.length === 0) return null;
  return { path: bestPath, branchPath: bestBranchPath, fanId: bestFanId };
}

// Поиск маршрута НАИБОЛЬШЕГО расхода воздуха от стартового узла до поверхности.
// Модифицированный Дейкстра с "bottleneck"-метрикой: для каждого узла храним
// максимально возможный расход струи, которая может дойти сюда от старта
// (минимальный расход по ветвям пути = пропускная способность струи).
// Из всех достижимых поверхностных узлов берём путь с максимальным bottleneck.
// Перемычки и ветви с вентиляторами не проходим (преграды для основной струи).
function findMaxFlowRoute(
  adj: Map<string, { branchId: string; neighborId: string; flow: number; dP: number; hasBulkhead: boolean; hasFan: boolean }[]>,
  startNodeId: string,
  excludeNodeId: string,
  surfaceNodeIds: Set<string>,
): { nodes: string[]; branches: string[] } {
  // capAt[node] = макс. расход струи, которая может дойти до node от старта
  const capAt = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevBranch = new Map<string, string>();

  capAt.set(startNodeId, Infinity);
  // Приоритетная обработка: узлы с наибольшей достигнутой пропускной способностью первыми.
  // Сети большие — используем простой список с выбором максимума (без внешней кучи).
  const visited = new Set<string>([excludeNodeId]);

  let reachedSurface: string | null = null;
  let reachedSurfaceCap = -1;

  const MAX_STEPS = 100000;
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;
    // Выбираем непосещённый узел с максимальной достигнутой пропускной способностью.
    let cur: string | null = null;
    let curCap = -1;
    for (const [node, cap] of capAt) {
      if (visited.has(node)) continue;
      if (cap > curCap) { curCap = cap; cur = node; }
    }
    if (cur === null) break;
    visited.add(cur);

    // Достигли поверхности — запоминаем лучший выход (первый максимальный по cap).
    if (cur !== startNodeId && surfaceNodeIds.has(cur)) {
      if (curCap > reachedSurfaceCap) {
        reachedSurfaceCap = curCap;
        reachedSurface = cur;
      }
      continue; // поверхностный узел — конечная точка струи, дальше не идём
    }

    const neighbors = adj.get(cur) ?? [];
    for (const n of neighbors) {
      if (visited.has(n.neighborId)) continue;
      if (n.hasBulkhead || n.hasFan) continue; // преграды
      // Пропускная способность струи до соседа = min(текущая, расход ветви).
      const cap = Math.min(curCap, n.flow);
      const prev = capAt.get(n.neighborId);
      if (prev === undefined || cap > prev) {
        capAt.set(n.neighborId, cap);
        prevNode.set(n.neighborId, cur);
        prevBranch.set(n.neighborId, n.branchId);
      }
    }
  }

  if (!reachedSurface) return { nodes: [], branches: [] };

  // Восстанавливаем путь от поверхности назад к старту.
  const nodes: string[] = [];
  const branches: string[] = [];
  let node: string | undefined = reachedSurface;
  while (node && node !== startNodeId) {
    nodes.push(node);
    const b = prevBranch.get(node);
    if (b) branches.push(b);
    node = prevNode.get(node);
  }
  nodes.push(startNodeId);
  // Сейчас путь: [поверхность, ..., старт]. Разворачиваем → [старт, ..., поверхность].
  nodes.reverse();
  branches.reverse();
  return { nodes, branches };
}

// ─── Построение точек депрессиограммы ────────────────────────────────────────
export function buildPointsFromBranchIds(
  branchIds: string[],
  nodes: TopoNode[],
  branches: TopoBranch[]
): DepressogramPoint[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchMap = new Map(branches.map(b => [b.id, b]));
  if (branchIds.length === 0) return [];

  type ChainItem = { b: TopoBranch; fromId: string; toId: string };
  const chain: ChainItem[] = [];
  const first = branchMap.get(branchIds[0]);
  if (!first) return [];
  chain.push({ b: first, fromId: first.fromId, toId: first.toId });

  for (let i = 1; i < branchIds.length; i++) {
    const b = branchMap.get(branchIds[i]);
    if (!b) continue;
    const prev = chain[chain.length - 1];
    if (b.fromId === prev.toId) chain.push({ b, fromId: b.fromId, toId: b.toId });
    else if (b.toId === prev.toId) chain.push({ b, fromId: b.toId, toId: b.fromId });
    else chain.push({ b, fromId: b.fromId, toId: b.toId });
  }

  let totalDP = 0;
  for (const c of chain) totalDP += Math.abs(c.b.dP ?? 0);

  const points: DepressogramPoint[] = [];
  let cumLen = 0;
  let pressure = totalDP;

  const firstNode = nodeMap.get(chain[0].fromId);
  points.push({ nodeId: chain[0].fromId, nodeName: firstNode?.name ?? "", nodeNumber: firstNode?.number ?? "", branchId: null, branchName: "", branchNumber: null, cumulativeLength: 0, pressure, dP: 0 });

  for (const c of chain) {
    cumLen += c.b.length ?? 0;
    const dp = Math.abs(c.b.dP ?? 0);
    pressure -= dp;
    const toNode = nodeMap.get(c.toId);
    points.push({ nodeId: c.toId, nodeName: toNode?.name ?? "", nodeNumber: toNode?.number ?? "", branchId: c.b.id, branchName: c.b.id, branchNumber: c.b.id, cumulativeLength: Math.round(cumLen * 100) / 100, pressure: Math.round(pressure * 100) / 100, dP: Math.round(dp * 100) / 100 });
  }
  return points;
}