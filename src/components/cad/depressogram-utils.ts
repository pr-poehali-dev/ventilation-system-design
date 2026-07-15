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

// Перемычка ПРЕГРАЖДАЕТ маршрут (глухая), только если у неё НЕТ прохода воздуха.
// Перемычки с проходом (открытая дверь, окно/проём, решётчатая) или через которые
// реально идёт значимый расход воздуха — НЕ преграждают струю, их включаем в маршрут.
function isBlockingBulkhead(b: TopoBranch): boolean {
  if (!b.hasBulkhead) return false;                  // перемычки нет
  if (b.bulkheadDestroyedByExplosion) return false;  // разрушена — не преграда
  if ((b.bulkheadWindowArea ?? 0) > 0) return false; // есть окно/проём (решётчатая)
  if (Math.abs(b.flow ?? 0) > 0.05) return false;    // через неё реально идёт воздух → проход открыт
  return true;                                       // глухая перемычка без прохода — преграждает струю
}

// ─── Алгоритм: маршрут наибольшего расхода воздуха от ГВУ до поверхности ──────
// НОРМАТИВ: маршрут, определяющий аэродинамическое сопротивление шахтной сети —
// это путь, по которому проходит НАИБОЛЬШЕЕ КОЛИЧЕСТВО ВОЗДУХА (расход Q) от ГВУ
// до поверхности, БЕЗ преграждения вентиляционными перемычками.
//
// Реализация: жадный обход от "шахтного" конца ГВУ вглубь сети — на каждом шаге
// выбираем соседнюю ветвь с МАКСИМАЛЬНЫМ расходом, НЕ проходя через ГЛУХИЕ
// перемычки (см. isBlockingBulkhead) и ГЛАВНЫЕ вентиляторы (ГВУ/ВВУ).
// Допускаются: перемычки с проходом (открытая дверь/окно/решётка/идёт воздух)
// и ВМП (вентиляторы местного проветривания) — они не преграждают основную струю.
// Путь разворачивается и дополняется ветвью ГВУ и поверхностным узлом.
//
// ВГП выбирается автоматически (приоритет типу "ГВУ"), либо явно задаётся
// параметром preferredFanBranchId (пользователь указывает ветвь ВГП).
// При нескольких ВГП берётся маршрут с наибольшим расходом воздуха через ГВУ.
export function findMainRoute(
  nodes: TopoNode[],
  branches: TopoBranch[],
  preferredFanBranchId?: string
): { path: string[]; branchPath: string[]; fanId?: string } | null {
  const surfaceNodeIds = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));
  if (surfaceNodeIds.size === 0) return null;

  // Строим граф смежности.
  // blocking = перемычка ПРЕГРАЖДАЕТ струю (глухая). Перемычки с проходом
  // (открытая дверь/окно/решётка) НЕ преграждают — их включаем в маршрут.
  // blockingFan = ГЛАВНЫЙ/вспомогательный вентилятор (ГВУ/ВВУ) — граница струи.
  // ВМП (вентилятор местного проветривания) НЕ преграждает основную струю —
  // он в тупиковой выработке добавляет напор; такие ветви проходимы.
  const adj = new Map<string, { branchId: string; neighborId: string; flow: number; dP: number; blocking: boolean; blockingFan: boolean }[]>();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    const blockingFan = b.hasFan && !b.fanStopped && b.fanType !== "ВМП";
    const entry = { branchId: b.id, flow: Math.abs(b.flow ?? 0), dP: Math.abs(b.dP ?? 0), blocking: isBlockingBulkhead(b), blockingFan };
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

  // Для каждого ВГП строим маршрут; выбираем тот, где расход воздуха наибольший.
  let bestPath: string[] = [];
  let bestBranchPath: string[] = [];
  let bestFlow = -1;
  let bestFanId: string | undefined;

  for (const fan of fanBranches) {
    // Определяем "шахтный" конец ветви ВГП (не поверхность) — от него идём вглубь.
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

    // Жадный обход: от shaftNodeId вглубь шахты по МАКС. расходу, без перемычек.
    const visited = new Set<string>([shaftNodeId]);
    const nodePath: string[] = [shaftNodeId];
    const branchPath: string[] = [];
    let current = shaftNodeId;
    visited.add(surfNodeId); // поверхностный конец ВГП исключаем из обхода

    const MAX_STEPS = 2000;
    let steps = 0;

    while (steps < MAX_STEPS) {
      steps++;
      const neighbors = adj.get(current) ?? [];

      // Кандидаты: не посещённые, без глухих перемычек и без главных вентиляторов
      // (ГВУ/ВВУ — граница струи). ВМП и проходные перемычки допускаются.
      // Выбираем ветвь с максимальным расходом воздуха.
      const candidates = neighbors
        .filter(n => !visited.has(n.neighborId) && !n.blocking && !n.blockingFan)
        .sort((a, b) => b.flow - a.flow);

      const chosen = candidates[0];
      if (!chosen) break;

      visited.add(chosen.neighborId);
      nodePath.push(chosen.neighborId);
      branchPath.push(chosen.branchId);
      current = chosen.neighborId;
    }

    // Разворачиваем путь (от глубины к ВГП) и добавляем ветвь ВГП + поверхность.
    const reversedNodes = [...nodePath].reverse();
    const reversedBranches = [...branchPath].reverse();
    const fullNodes = [...reversedNodes, surfNodeId];
    const fullBranches = [...reversedBranches, fan.id];

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