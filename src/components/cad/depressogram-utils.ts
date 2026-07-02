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

// ─── Алгоритм: BFS от поверхностного узла до ВГП, макс. расход ──────────────
// Шахтный воздух движется: забои → выработки → ВГП → поверхность
// Маршрут на депрессиограмме: от ВГП (высокое давление) до поверхности (0)
// Правильный алгоритм: ищем путь от "шахтного" конца ВГП до поверхностного узла
//
// При нескольких ВГП: берём все ВГП, для каждого строим маршрут,
// выбираем тот где суммарная депрессия (сумма |dP| по ветвям) максимальная.
export function findMainRoute(
  nodes: TopoNode[],
  branches: TopoBranch[]
): { path: string[]; branchPath: string[]; fanId?: string } | null {
  const surfaceNodeIds = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));
  if (surfaceNodeIds.size === 0) return null;

  // Строим граф смежности (без перемычек в приоритете)
  const adj = new Map<string, { branchId: string; neighborId: string; flow: number; dP: number; hasBulkhead: boolean; hasFan: boolean }[]>();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    const entry = { branchId: b.id, flow: Math.abs(b.flow ?? 0), dP: Math.abs(b.dP ?? 0), hasBulkhead: b.hasBulkhead, hasFan: b.hasFan };
    adj.get(b.fromId)!.push({ ...entry, neighborId: b.toId });
    adj.get(b.toId)!.push({ ...entry, neighborId: b.fromId });
  }

  // Все ветви с вентиляторами (ВГП и другие)
  const fanBranches = branches.filter(b => b.hasFan && !b.fanStopped);
  if (fanBranches.length === 0) return null;

  // Для каждого ВГП ищем маршрут жадным алгоритмом от его "шахтного" конца до поверхности
  let bestPath: string[] = [];
  let bestBranchPath: string[] = [];
  let bestDep = -1;
  let bestFanId: string | undefined;

  for (const fan of fanBranches) {
    // Определяем с какой стороны ветви ВГП — шахтный конец (не поверхность)
    // Воздух проходит: шахта → fromId → ВГП → toId → поверхность (или наоборот)
    // Ориентация: если flow > 0, воздух идёт от fromId к toId
    // Шахтный конец = тот откуда воздух ВХОДИТ в вентилятор
    const flow = fan.flow ?? 0;
    let shaftNodeId: string;
    let surfNodeId: string;

    if (Math.abs(flow) < 0.001) {
      // Нет расхода — пробуем оба направления, берём не-поверхностный
      if (surfaceNodeIds.has(fan.toId)) {
        shaftNodeId = fan.fromId; surfNodeId = fan.toId;
      } else {
        shaftNodeId = fan.toId; surfNodeId = fan.fromId;
      }
    } else if (flow > 0) {
      // Воздух идёт fromId → toId: fromId = шахта, toId = поверхность
      shaftNodeId = fan.fromId; surfNodeId = fan.toId;
    } else {
      // Воздух идёт toId → fromId: toId = шахта, fromId = поверхность
      shaftNodeId = fan.toId; surfNodeId = fan.fromId;
    }

    // Если surfNodeId не является поверхностным узлом, но shaftNodeId является — меняем
    if (surfaceNodeIds.has(shaftNodeId) && !surfaceNodeIds.has(surfNodeId)) {
      [shaftNodeId, surfNodeId] = [surfNodeId, shaftNodeId];
    }

    // Жадный обход: от shaftNodeId вглубь шахты по макс. расходу
    // Цель: найти длинный путь с большой депрессией внутри шахты
    // Стратегия: от шахтного конца ВГП идём к максимальному расходу
    // (в глубину шахты, противоположное направление тока воздуха)
    const visited = new Set<string>([shaftNodeId]);
    // Сначала включаем саму ветвь вентилятора
    const nodePath: string[] = [shaftNodeId];
    const branchPath: string[] = [];
    let current = shaftNodeId;

    // Исключаем поверхностный конец ВГП из обхода
    visited.add(surfNodeId);

    const MAX_STEPS = 800;
    let steps = 0;

    while (steps < MAX_STEPS) {
      steps++;
      const neighbors = adj.get(current) ?? [];

      // Кандидаты: не посещённые, не перемычки (в приоритете), без других ВГП
      const candidatesNoBulk = neighbors
        .filter(n => !visited.has(n.neighborId) && !n.hasBulkhead && !n.hasFan)
        .sort((a, b) => b.flow - a.flow);

      const candidatesAll = neighbors
        .filter(n => !visited.has(n.neighborId) && !n.hasFan)
        .sort((a, b) => b.flow - a.flow);

      const chosen = candidatesNoBulk[0] ?? candidatesAll[0];
      // Останавливаемся только если вообще нет доступных соседей
      // (не по порогу расхода — на длинных маршрутах расход дробится на разветвлениях)
      if (!chosen) break;

      visited.add(chosen.neighborId);
      nodePath.push(chosen.neighborId);
      branchPath.push(chosen.branchId);
      current = chosen.neighborId;
    }

    // Разворачиваем путь: он идёт от ВГП вглубь шахты, нам нужно от глубины до поверхности
    // Итоговый путь: [конец_шахты, ..., shaftNodeId] + ветвь_ВГП + [surfNodeId]
    const reversedNodes = [...nodePath].reverse();
    const reversedBranches = [...branchPath].reverse();

    // Добавляем ветвь ВГП и поверхностный узел в конец
    const fullNodes = [...reversedNodes, surfNodeId];
    const fullBranches = [...reversedBranches, fan.id];

    // Считаем суммарную депрессию маршрута
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
    points.push({ nodeId: c.toId, nodeName: toNode?.name ?? "", nodeNumber: toNode?.number ?? "", branchId: c.b.id, branchName: c.b.name ?? c.b.id, branchNumber: c.b.id, cumulativeLength: Math.round(cumLen * 100) / 100, pressure: Math.round(pressure * 100) / 100, dP: Math.round(dp * 100) / 100 });
  }
  return points;
}
