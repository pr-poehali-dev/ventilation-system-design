// ─────────────────────────────────────────────────────────────────────────────
// Решение вентиляционной сети методом контурных расходов (метод Кросса)
//
// Для воздушных сетей:
//   • 1-й закон Кирхгофа: Σ Q в узле = 0
//   • 2-й закон: Σ R·Q·|Q| − Σ H_fan = 0 в каждом контуре
//
// Алгоритм:
//   1. Объединяем все атмосферные узлы в виртуальный «узел земли» (id="@gnd")
//   2. Строим остовное дерево (BFS). Ветви: tree-branches + chord-branches.
//      Каждая chord замыкает один контур (cycle).
//   3. Начальное распределение Q: проходим по хордам и пускаем единичный поток.
//   4. Итерации Кросса: для каждого контура k:
//        ΔQ_k = -Σ(R·Q·|Q| - H) / Σ(2·R·|Q|)
//      Применяем со знаком обхода.
//   5. Сходимость: max|ΔQ| < ε.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoNode, TopoBranch } from "./topology";
import { recalcBranchAero } from "./topology";
import { getFanById, fanH, fanDH, fanEfficiency, fanShaftPower, type FanCurve } from "./fanCurves";

const GND = "@gnd";  // виртуальный атмосферный узел

interface SolverEdge {
  id: string;
  a: string;
  b: string;
  R: number;
  hasFan: boolean;
  fanMode: "constant" | "curve";
  HfanConst: number;
  fanCurve?: FanCurve;
  Q: number;
}

export interface SolveOptions {
  maxIter?: number;
  tolerance?: number;     // м³/с — допуск по ΔQ
  initialFlow?: number;   // начальный Q для хорд, м³/с
}

export interface SolveResult {
  ok: boolean;
  iterations: number;
  maxDeltaQ: number;
  branches: TopoBranch[];     // обновлённые ветви (Q, V, ΔP, N, R…)
  nodes: TopoNode[];          // обновлённые узлы (computedPressure)
  log: string[];
  cyclesCount: number;
}

export function solveNetwork(
  nodesIn: TopoNode[],
  branchesIn: TopoBranch[],
  options: SolveOptions = {},
): SolveResult {
  const maxIter = options.maxIter ?? 200;
  const tol = options.tolerance ?? 0.001;
  const Q0 = options.initialFlow ?? 50;
  const log: string[] = [];

  // ─── 1. Подготовка: атмосферные узлы → "@gnd" ────────────────────────
  const remap = (id: string): string => {
    const n = nodesIn.find((x) => x.id === id);
    return n && n.atmosphereLink ? GND : id;
  };

  // Сначала пересчитаем R на основе текущих параметров (без Q-зависимости)
  const branchesCalc = branchesIn.map((b) => recalcBranchAero({ ...b }));

  const edges: SolverEdge[] = branchesCalc.map((b) => ({
    id: b.id,
    a: remap(b.fromId),
    b: remap(b.toId),
    R: b.resistance,
    hasFan: b.hasFan,
    fanMode: b.fanMode,
    HfanConst: b.fanPressure,
    fanCurve: b.fanMode === "curve" ? getFanById(b.fanCurveId) : undefined,
    Q: 0,
  }));

  // Для каждой ветви — текущий H_fan и dH/dQ (зависит от Q при mode=curve)
  const evalHfan = (e: SolverEdge): { H: number; dH: number } => {
    if (!e.hasFan) return { H: 0, dH: 0 };
    if (e.fanMode === "curve" && e.fanCurve) {
      const Q = Math.abs(e.Q);
      return { H: fanH(e.fanCurve, Q), dH: fanDH(e.fanCurve, Q) };
    }
    return { H: e.HfanConst, dH: 0 };
  };

  // Все «логические» узлы (с учётом объединения атмосферных)
  const allNodeIds = new Set<string>();
  edges.forEach((e) => { allNodeIds.add(e.a); allNodeIds.add(e.b); });
  const nodeList = Array.from(allNodeIds);

  if (edges.length === 0) {
    return { ok: false, iterations: 0, maxDeltaQ: 0, branches: branchesCalc, nodes: nodesIn, log: ["Нет ветвей"], cyclesCount: 0 };
  }

  // ─── 2. Остовное дерево (BFS) ────────────────────────────────────────
  // adj: node -> [{edgeIdx, other}]
  const adj = new Map<string, { edgeIdx: number; other: string }[]>();
  nodeList.forEach((n) => adj.set(n, []));
  edges.forEach((e, i) => {
    adj.get(e.a)!.push({ edgeIdx: i, other: e.b });
    adj.get(e.b)!.push({ edgeIdx: i, other: e.a });
  });

  const root = nodeList.includes(GND) ? GND : nodeList[0];
  const parent = new Map<string, { node: string; edgeIdx: number } | null>();
  const visited = new Set<string>();
  const treeEdgeIdx = new Set<number>();

  // BFS
  parent.set(root, null);
  visited.add(root);
  const queue = [root];
  while (queue.length) {
    const u = queue.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (!visited.has(other)) {
        visited.add(other);
        parent.set(other, { node: u, edgeIdx });
        treeEdgeIdx.add(edgeIdx);
        queue.push(other);
      }
    }
  }

  // Хорды = ветви, не вошедшие в дерево
  const chordIdx = edges.map((_, i) => i).filter((i) => !treeEdgeIdx.has(i));
  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, дерево: ${treeEdgeIdx.size}, хорд (контуров): ${chordIdx.length}`);

  if (chordIdx.length === 0 && edges.length > 0) {
    // Нет контуров — поток только если есть вентилятор и путь с атмосферой
    log.push("Контуров нет — расчёт невозможен (изолированное дерево)");
  }

  // ─── 3. Контуры: каждый контур = хорда + путь по дереву ────────────────
  // cycles[k] = список { edgeIdx, dir(+1/-1) } в порядке обхода
  interface CycleEdge { edgeIdx: number; dir: 1 | -1; }
  const cycles: CycleEdge[][] = [];

  const pathInTree = (from: string, to: string): { node: string; edgeIdx: number; dir: 1 | -1 }[] => {
    // Поднимаем оба узла до общего предка
    const ancFrom: string[] = [];
    let cur: string | null = from;
    while (cur) { ancFrom.push(cur); const p = parent.get(cur); cur = p ? p.node : null; }
    const fromSet = new Set(ancFrom);

    const ancTo: string[] = [];
    cur = to;
    while (cur && !fromSet.has(cur)) { ancTo.push(cur); const p = parent.get(cur); cur = p ? p.node : null; }
    const lca = cur!;
    const idxLca = ancFrom.indexOf(lca);
    const upFrom = ancFrom.slice(0, idxLca + 1);

    const result: { node: string; edgeIdx: number; dir: 1 | -1 }[] = [];
    // from → ... → lca (восходящий)
    for (let i = 0; i < upFrom.length - 1; i++) {
      const node = upFrom[i];
      const p = parent.get(node)!;
      const e = edges[p.edgeIdx];
      // Реальное направление ребра: a→b. Мы идём node→p.node.
      const dir: 1 | -1 = e.a === node ? 1 : -1;
      result.push({ node, edgeIdx: p.edgeIdx, dir });
    }
    // lca → ... → to (нисходящий, реверс ancTo)
    for (let i = ancTo.length - 1; i >= 0; i--) {
      const child = ancTo[i];
      const p = parent.get(child)!;
      const e = edges[p.edgeIdx];
      // Идём p.node→child.
      const dir: 1 | -1 = e.a === p.node ? 1 : -1;
      result.push({ node: p.node, edgeIdx: p.edgeIdx, dir });
    }
    return result;
  };

  for (const cIdx of chordIdx) {
    const e = edges[cIdx];
    // Контур: хорда (a→b, dir=+1), затем путь по дереву из b обратно в a.
    const cycle: CycleEdge[] = [{ edgeIdx: cIdx, dir: 1 }];
    const path = pathInTree(e.b, e.a);
    path.forEach((p) => cycle.push({ edgeIdx: p.edgeIdx, dir: p.dir }));
    cycles.push(cycle);
  }

  // ─── 4. Начальное распределение Q ───────────────────────────────────────
  // Каждой хорде → Q0 в её направлении, и компенсация по дереву (-Q0 со знаком обхода)
  for (const cyc of cycles) {
    for (const ce of cyc) {
      edges[ce.edgeIdx].Q += Q0 * ce.dir;
    }
  }

  // ─── 5. Итерации Кросса ─────────────────────────────────────────────────
  let iter = 0;
  let maxDelta = Infinity;
  for (; iter < maxIter; iter++) {
    maxDelta = 0;
    for (const cyc of cycles) {
      let num = 0;
      let den = 0;
      for (const ce of cyc) {
        const e = edges[ce.edgeIdx];
        const Q = e.Q * ce.dir; // расход в направлении обхода контура
        const { H, dH } = evalHfan(e);
        // Знак Hfan: вентилятор поднимает давление от a→b (Hfan > 0).
        // В обходе контура направление Hfan ⊕ ce.dir.
        // Также знак Hfan зависит от знака Q (если Q<0, вент. работает реверсом — H тот же по модулю, но действует противоположно).
        const Hsigned = H * Math.sign(e.Q || 1) * ce.dir;
        num += e.R * Q * Math.abs(Q) - Hsigned;
        // d/dQ(R·Q·|Q| - H(|Q|)·sign(Q)) = 2·R·|Q| - dH/dQ
        den += 2 * e.R * Math.abs(Q) + dH;
      }
      const dQ = den > 1e-12 ? -num / den : 0;
      // Релаксация для устойчивости при Q-H кривой
      const relax = 0.85;
      const dQrel = dQ * relax;
      if (Math.abs(dQrel) > maxDelta) maxDelta = Math.abs(dQrel);
      for (const ce of cyc) {
        edges[ce.edgeIdx].Q += dQrel * ce.dir;
      }
    }
    if (maxDelta < tol) {
      iter++;
      break;
    }
  }
  log.push(`Сходимость за ${iter} итераций, max|ΔQ| = ${maxDelta.toExponential(3)} м³/с`);

  // ─── 6. Записываем Q обратно в ветви и пересчитываем все производные ─
  const branchesOut = branchesCalc.map((b) => {
    const e = edges.find((x) => x.id === b.id)!;
    const aOrig = remap(b.fromId);
    const Q = e.a === aOrig ? e.Q : -e.Q;

    // Рабочая точка вентилятора (если есть)
    let fanPressure = b.fanPressure;
    let fanEff = 0;
    let fanShaft = 0;
    if (b.hasFan) {
      const { H } = evalHfan(e);
      fanPressure = H;
      if (b.fanMode === "curve" && e.fanCurve) {
        fanEff = fanEfficiency(e.fanCurve, Q);
        fanShaft = fanShaftPower(H, Q, fanEff);
      }
    }

    return recalcBranchAero({
      ...b,
      flow: Q,
      fanPressure,
      fanEfficiency: fanEff,
      fanShaftPower: fanShaft,
    });
  });

  // ─── 7. Давления в узлах: обходим дерево от GND ───────────────────────
  const pAtm = 101325;        // Па (на поверхности)
  const nodePressure = new Map<string, number>();
  nodePressure.set(root, pAtm);
  // BFS от корня
  const q2 = [root];
  const seen = new Set([root]);
  while (q2.length) {
    const u = q2.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (!seen.has(other) && treeEdgeIdx.has(edgeIdx)) {
        const e = edges[edgeIdx];
        const { H } = evalHfan(e);
        const dP = e.R * e.Q * Math.abs(e.Q) - H * Math.sign(e.Q || 1);
        const Pu = nodePressure.get(u)!;
        // Если u==a, то P(b) = P(a) - dP (поток теряет давление от a к b)
        const Pother = e.a === u ? Pu - dP : Pu + dP;
        nodePressure.set(other, Pother);
        seen.add(other);
        q2.push(other);
      }
    }
  }

  const nodesOut = nodesIn.map((n) => {
    const remappedId = n.atmosphereLink ? GND : n.id;
    const P = nodePressure.get(remappedId);
    if (P === undefined) return n;
    // С учётом баротермической поправки от высоты Z (упрощённо)
    const Pz = P + 12 * (-n.z);  // ~12 Па/м снижения с глубиной
    return { ...n, computedPressure: Math.round(Pz) };
  });

  return {
    ok: maxDelta < tol,
    iterations: iter,
    maxDeltaQ: maxDelta,
    branches: branchesOut,
    nodes: nodesOut,
    log,
    cyclesCount: cycles.length,
  };
}