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

    // Путь НАИБОЛЬШЕГО расхода от shaftNodeId (всас ГВУ) вглубь шахты до
    // поверхностного узла — входа свежей струи. Идём против движения воздуха
    // по ветвям с максимальным расходом, НЕ пересекая вентиляционные перемычки.
    const result = findMaxFlowRoute(adj, shaftNodeId, surfaceNodeIds, surfNodeId);
    if (result.branches.length === 0) continue;

    // result: [shaftNodeId, ..., вход_свежей_струи (поверхность или глубокий узел)]
    // Итоговый маршрут читается от ГВУ (выброс, высокое давление) до входа струи.
    // Собираем: [surfNodeId(выход ГВУ), shaftNodeId, ...путь..., вход]
    //           ветви: [ВГП, ...путь...]
    const fullNodes = [surfNodeId, ...result.nodes];
    const fullBranches = [fan.id, ...result.branches];

    // Критерий выбора между несколькими ВГП — расход воздуха через ГВУ.
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

// Поиск маршрута НАИБОЛЬШЕГО расхода воздуха от всаса ГВУ (startNodeId) вглубь
// сети. Модифицированный Дейкстра с "bottleneck"-метрикой: для каждого узла
// храним максимальный расход струи, которая может дойти сюда от старта
// (min расхода по ветвям пути = пропускная способность струи).
//
// КРИТЕРИЙ (норматив): маршрут идёт по наибольшему расходу воздуха БЕЗ
// преграждения вентиляционными перемычками (hasBulkhead) и без пересечения
// других вентиляторов (hasFan). Такие ветви полностью исключаются из обхода.
//
// Финиш — поверхностный узел (вход свежей струи). Если ни один поверхностный
// узел не достижим без перемычек, берём самый глубокий узел с максимальным
// расходом (фолбэк), чтобы депрессиограмма построилась в любом случае.
function findMaxFlowRoute(
  adj: Map<string, { branchId: string; neighborId: string; flow: number; dP: number; hasBulkhead: boolean; hasFan: boolean }[]>,
  startNodeId: string,
  surfaceNodeIds: Set<string>,
  fanSurfNodeId: string,
): { nodes: string[]; branches: string[] } {
  const capAt = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevBranch = new Map<string, string>();
  const settled = new Set<string>();

  capAt.set(startNodeId, Infinity);

  // Куча-заменитель: активные узлы отбираем по максимальному cap.
  // Для больших сетей (>1000 узлов) держим множество "активных" и ищем max в нём.
  const active = new Set<string>([startNodeId]);

  let bestSurface: string | null = null;
  let bestSurfaceCap = -1;
  // Фолбэк — самый глубокий достижимый узел (не поверхность) с макс. расходом.
  let deepestNode: string | null = null;
  let deepestCap = -1;

  const MAX_STEPS = 500000;
  let steps = 0;

  while (active.size > 0 && steps < MAX_STEPS) {
    steps++;
    // Выбираем активный узел с максимальной достигнутой пропускной способностью.
    let cur: string | null = null;
    let curCap = -1;
    for (const node of active) {
      const cap = capAt.get(node) ?? -1;
      if (cap > curCap) { curCap = cap; cur = node; }
    }
    if (cur === null) break;
    active.delete(cur);
    if (settled.has(cur)) continue;
    settled.add(cur);

    // Поверхностный узел (кроме выхода самого ГВУ) — конец струи (вход свежего воздуха).
    if (cur !== startNodeId && cur !== fanSurfNodeId && surfaceNodeIds.has(cur)) {
      if (curCap > bestSurfaceCap) { bestSurfaceCap = curCap; bestSurface = cur; }
      continue; // дальше поверхности не идём
    }

    // Обновляем самый глубокий узел (фолбэк, если поверхность недостижима).
    if (cur !== startNodeId && curCap > deepestCap && !surfaceNodeIds.has(cur)) {
      deepestCap = curCap; deepestNode = cur;
    }

    const neighbors = adj.get(cur) ?? [];
    for (const n of neighbors) {
      if (settled.has(n.neighborId)) continue;
      if (n.hasBulkhead || n.hasFan) continue; // перемычка/вентилятор — преграда
      if (n.flow <= 0) continue; // струя не идёт по ветвям без расхода
      const cap = Math.min(curCap, n.flow);
      const prev = capAt.get(n.neighborId);
      if (prev === undefined || cap > prev) {
        capAt.set(n.neighborId, cap);
        prevNode.set(n.neighborId, cur);
        prevBranch.set(n.neighborId, n.branchId);
        active.add(n.neighborId);
      }
    }
  }

  const target = bestSurface ?? deepestNode;
  if (!target) return { nodes: [], branches: [] };

  // Восстанавливаем путь от target назад к старту.
  const nodes: string[] = [];
  const branches: string[] = [];
  let node: string | undefined = target;
  while (node && node !== startNodeId) {
    nodes.push(node);
    const b = prevBranch.get(node);
    if (b) branches.push(b);
    node = prevNode.get(node);
  }
  nodes.push(startNodeId);
  // Путь: [target, ..., старт] → разворачиваем в [старт, ..., target].
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