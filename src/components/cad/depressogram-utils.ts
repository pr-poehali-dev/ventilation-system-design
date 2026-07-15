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

// ─── Алгоритм: маршрут максимальной депрессии от ВГП до поверхности ──────────
// Депрессиограмма строится по маршруту, определяющему аэродинамическое
// сопротивление сети: путь с НАИБОЛЬШИМ количеством воздуха от ВГП до поверхности
// без преград (перемычек). Маршрут идёт от "шахтного" конца ВГП вглубь сети,
// накапливая максимальную суммарную депрессию (сумму |dP| по ветвям).
//
// Старый жадный одношаговый обход (выбирай соседа с макс. расходом) давал баг
// "полки на нуле": он мог свернуть в короткую ветку с высоким расходом, где dP≈0,
// и упереться в тупик, так и не пройдя маршрут до забоя. Здесь применяется
// корректный поиск пути МАКСИМАЛЬНОЙ депрессии (обход в глубину с накоплением веса).
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

  // Граф смежности. Каждой ветви — вес = |dP| (депрессия) и |flow| (расход).
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
  let bestDep = -1;
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

    // Поиск пути МАКСИМАЛЬНОЙ депрессии от shaftNodeId вглубь сети.
    // Обход в глубину (DFS) с накоплением суммы |dP|; на выходе берём ветку,
    // где суммарная депрессия максимальна. Ветви с перемычками и другими ВГП
    // не проходим (это преграды для основной струи).
    const result = findMaxDepressionPath(adj, shaftNodeId, surfNodeId);
    const nodePath = result.nodes;      // [shaftNodeId, ..., глубокий_забой]
    const branchPath = result.branches; // ветви от shaftNodeId до забоя

    // Разворачиваем: маршрут идёт от глубины к ВГП, добавляем ветвь ВГП и поверхность.
    const reversedNodes = [...nodePath].reverse();
    const reversedBranches = [...branchPath].reverse();
    const fullNodes = [...reversedNodes, surfNodeId];
    const fullBranches = [...reversedBranches, fan.id];

    let totalDep = 0;
    for (const bId of fullBranches) {
      const b = branches.find(br => br.id === bId);
      if (b) totalDep += Math.abs(b.dP ?? 0);
    }

    if (totalDep > bestDep && fullBranches.length > 1) {
      bestDep = totalDep;
      bestPath = fullNodes;
      bestBranchPath = fullBranches;
      bestFanId = fan.id;
    }
  }

  if (bestBranchPath.length === 0) return null;
  return { path: bestPath, branchPath: bestBranchPath, fanId: bestFanId };
}

// Поиск пути максимальной суммарной депрессии (|dP|) от стартового узла.
// Итеративный DFS без рекурсии (сети большие — до тысяч ветвей).
// Возвращает путь до узла, где накопленная депрессия максимальна.
function findMaxDepressionPath(
  adj: Map<string, { branchId: string; neighborId: string; flow: number; dP: number; hasBulkhead: boolean; hasFan: boolean }[]>,
  startNodeId: string,
  excludeNodeId: string,
): { nodes: string[]; branches: string[] } {
  // best[nodeId] = максимальная депрессия, с которой мы дошли до узла + путь
  const bestDepAt = new Map<string, number>();
  let bestNodes: string[] = [startNodeId];
  let bestBranches: string[] = [];
  let bestTotal = 0;

  const MAX_VISITS = 200000; // защита от комбинаторного взрыва на больших сетях
  let visits = 0;

  // Стек кадров DFS: текущий узел, накопленная депрессия, путь узлов/ветвей, посещённые
  type Frame = { node: string; dep: number; nodes: string[]; branches: string[]; visited: Set<string> };
  const initVisited = new Set<string>([startNodeId, excludeNodeId]);
  const stack: Frame[] = [{ node: startNodeId, dep: 0, nodes: [startNodeId], branches: [], visited: initVisited }];

  while (stack.length > 0 && visits < MAX_VISITS) {
    visits++;
    const frame = stack.pop()!;
    const { node, dep, nodes: pathNodes, branches: pathBranches, visited } = frame;

    // Обновляем лучший маршрут, если сюда пришли с большей депрессией
    if (dep > bestTotal) {
      bestTotal = dep;
      bestNodes = pathNodes;
      bestBranches = pathBranches;
    }

    // Отсекаем ветки, куда до этого узла уже дошли с не меньшей депрессией
    const prevBest = bestDepAt.get(node);
    if (prevBest !== undefined && prevBest >= dep) continue;
    bestDepAt.set(node, dep);

    // Соседи: сперва без перемычек и без ВГП, отсортированы по расходу (основная струя)
    const neighbors = (adj.get(node) ?? [])
      .filter(n => !visited.has(n.neighborId) && !n.hasBulkhead && !n.hasFan)
      .sort((a, b) => a.flow - b.flow); // меньший расход кладём раньше — больший обработается позже (pop)

    for (const n of neighbors) {
      const nextVisited = new Set(visited);
      nextVisited.add(n.neighborId);
      stack.push({
        node: n.neighborId,
        dep: dep + n.dP,
        nodes: [...pathNodes, n.neighborId],
        branches: [...pathBranches, n.branchId],
        visited: nextVisited,
      });
    }
  }

  return { nodes: bestNodes, branches: bestBranches };
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