// ─────────────────────────────────────────────────────────────────────────────
// Решение вентиляционной сети методом контурных расходов (Hardy Cross)
//
// Реализация строго по классическому методу, как в АэроСеть / Вентиляция 2.0:
//
//  1. Все атмосферные узлы объединяются в GND (@gnd) — это корень дерева.
//  2. BFS строит остовное дерево — нет зависания от порядка ветвей.
//  3. Для каждой хорды строится независимый контур (хорда + путь в дереве).
//  4. Начальное Q = Q_fan_estimate равномерно по всем контурным ветвям.
//  5. Итерация Кросса:
//       ΔQ = − Σ(R·Q·|Q| − H_fan) / Σ(2·R·|Q| + |dH/dQ|)
//     Применяется ко всем ветвям контура со своим знаком.
//  6. Сходимость: max|ΔQ| < ε.
//
// Вентилятор в контуре: H_fan учитывается со знаком ce.dir (по обходу контура).
// Вентилятор всегда нагнетает в направлении a→b своей ветви.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoNode, TopoBranch } from "./topology";
import { recalcBranchAero, calcBranchLength } from "./topology";
import { getFanById, fanEfficiency, fanShaftPower, type FanCurve } from "./fanCurves";

const GND = "@gnd";

interface SolverEdge {
  id: string;
  a: string;
  b: string;
  R: number;
  hasFan: boolean;
  fanMode: "constant" | "curve";
  HfanConst: number;
  fanCurve?: FanCurve;
  fanRpm?: number;
  fanBladeAngle?: number;
  fanRhoFactor?: number;
  Q: number;
}

export interface SolveOptions {
  maxIter?: number;
  tolerance?: number;
  initialFlow?: number;
}

export interface SolveResult {
  ok: boolean;
  iterations: number;
  maxDeltaQ: number;
  branches: TopoBranch[];
  nodes: TopoNode[];
  log: string[];
  cyclesCount: number;
  diagnostics?: SolveDiagnostic[];
}

export interface SolveDiagnostic {
  level: "error" | "warning" | "info";
  category: "topology" | "node_balance" | "branch_flow" | "fan" | "convergence";
  message: string;
  objectId?: string;
  value?: number;
}

// ─── Вспомогательные функции ────────────────────────────────────────────────

function rpmFactor(fanRpm: number | undefined, rpmNominal: number): number {
  if (!fanRpm || fanRpm <= 0 || rpmNominal <= 0) return 1;
  return fanRpm / rpmNominal;
}

function getAngleFactor(curve: FanCurve, angle?: number): number {
  if (!curve.bladeAngles || curve.bladeAngles.length < 2) return 1;
  const aMin = curve.bladeAngles[0];
  const aMax = curve.bladeAngles[curve.bladeAngles.length - 1];
  const aMid = (aMin + aMax) / 2;
  const a = Math.min(aMax, Math.max(aMin, angle ?? aMid));
  const t = (a - aMin) / Math.max(1, aMax - aMin);
  return 0.65 + t * 0.70;
}

// Напор вентилятора в ветви и |dH/dQ| — для итерации Кросса.
// H > 0: вентилятор нагнетает воздух в направлении a→b.
function evalFanH(e: SolverEdge, Q: number): { H: number; dH: number } {
  if (!e.hasFan) return { H: 0, dH: 0 };

  if (e.fanMode === "constant") {
    return { H: e.HfanConst, dH: 0 };
  }

  if (e.fanMode === "curve" && e.fanCurve) {
    const curve = e.fanCurve;
    const k = rpmFactor(e.fanRpm, curve.rpmNominal);
    const af = getAngleFactor(curve, e.fanBladeAngle);
    const rhoF = e.fanRhoFactor ?? 1.0;
    const Qabs = Math.abs(Q);
    const Qnorm = Qabs / Math.max(0.001, k);
    if (Qnorm > curve.qMax) return { H: 0, dH: 0 };
    const H = Math.max(0, curve.h0 * af + curve.h1 * Qnorm + curve.h2 * Qnorm * Qnorm) * k * k * rhoF;
    const dH = Math.abs((curve.h1 + 2 * curve.h2 * Qnorm) * k * rhoF);
    return { H, dH };
  }

  return { H: 0, dH: 0 };
}

// ─── Оценка рабочей точки вентилятора (для начального Q) ───────────────────
function estimateFanQ(edges: SolverEdge[], Rtotal: number): number {
  const fanEdge = edges.find(e => e.hasFan);
  if (!fanEdge) return 10;

  if (fanEdge.fanMode === "constant" && fanEdge.HfanConst > 0 && Rtotal > 0) {
    return Math.sqrt(fanEdge.HfanConst / Rtotal);
  }

  if (fanEdge.fanMode === "curve" && fanEdge.fanCurve) {
    const curve = fanEdge.fanCurve;
    const k = rpmFactor(fanEdge.fanRpm, curve.rpmNominal);
    const af = getAngleFactor(curve, fanEdge.fanBladeAngle);
    const rhoF = fanEdge.fanRhoFactor ?? 1;
    const qHi = curve.qMax * k;
    const qLo = 0.1;

    if (Rtotal <= 0) return (curve.qMin + curve.qMax) / 2 * k;

    let lo = qLo, hi = qHi, q = (lo + hi) / 2;
    for (let i = 0; i < 60; i++) {
      const Qn = q / Math.max(0.001, k);
      const Hf = Math.max(0, curve.h0 * af + curve.h1 * Qn + curve.h2 * Qn * Qn) * k * k * rhoF;
      const Hn = Rtotal * q * q;
      const diff = Hf - Hn;
      if (Math.abs(diff) < 0.5) break;
      if (diff > 0) lo = q; else hi = q;
      q = (lo + hi) / 2;
    }
    return Math.max(1, q);
  }

  return 10;
}

// ─── Главная функция ─────────────────────────────────────────────────────────
export function solveNetwork(
  nodesIn: TopoNode[],
  branchesIn: TopoBranch[],
  options: SolveOptions = {},
): SolveResult {
  const maxIter = options.maxIter ?? 500;
  const tol = options.tolerance ?? 0.01;
  const log: string[] = [];

  // ── 1. Объединяем атмосферные узлы в GND ──────────────────────────────
  const remap = (id: string): string => {
    const n = nodesIn.find(x => x.id === id);
    return n?.atmosphereLink ? GND : id;
  };

  // ── 2. Пересчитываем длины из координат (если не заданы вручную) ──────
  const branchesWithLen = branchesIn.map(b => {
    if (b.manualLength || b.length > 0) return b;
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    if (!fn || !tn) return b;
    const len = Math.round(calcBranchLength(fn, tn));
    return len > 0 ? { ...b, length: len } : b;
  });

  // ── 3. Пересчёт аэродинамики каждой ветви ─────────────────────────────
  const airDensity = (T: number) => 1.2 * 293 / (273 + Math.max(-50, Math.min(200, T)));

  const branchesCalc = branchesWithLen.map(b => {
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    const T = fn && tn ? (fn.airTemp + tn.airTemp) / 2 : 20;
    return recalcBranchAero({ ...b }, airDensity(T));
  });

  // ── 4. Строим рёбра графа ──────────────────────────────────────────────
  const edges: SolverEdge[] = branchesCalc.map(b => {
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    const T = fn && tn ? (fn.airTemp + tn.airTemp) / 2 : 20;
    const rhoFactor = airDensity(T) / 1.2;
    return {
      id: b.id,
      a: remap(b.fromId),
      b: remap(b.toId),
      // Минимальное R защищает от деления на 0 в числителе ΔQ
      R: Math.max(1e-6, b.resistance),
      hasFan: b.hasFan,
      fanMode: b.fanMode,
      HfanConst: b.fanPressure * rhoFactor,
      fanCurve: b.fanMode === "curve" ? getFanById(b.fanCurveId) ?? undefined : undefined,
      fanRpm: b.fanRpm,
      fanBladeAngle: b.fanBladeAngle,
      fanRhoFactor: rhoFactor,
      Q: 0,
    };
  });

  if (edges.length === 0) {
    return { ok: false, iterations: 0, maxDeltaQ: 0, branches: branchesCalc, nodes: nodesIn, log: ["Нет ветвей"], cyclesCount: 0 };
  }

  // ── 5. Список смежности ────────────────────────────────────────────────
  const allNodeIds = new Set<string>();
  edges.forEach(e => { allNodeIds.add(e.a); allNodeIds.add(e.b); });
  const nodeList = Array.from(allNodeIds);

  const adj = new Map<string, { edgeIdx: number; other: string }[]>();
  nodeList.forEach(n => adj.set(n, []));
  edges.forEach((e, i) => {
    adj.get(e.a)!.push({ edgeIdx: i, other: e.b });
    adj.get(e.b)!.push({ edgeIdx: i, other: e.a });
  });

  // ── 6. BFS: остовное дерево ────────────────────────────────────────────
  const root = nodeList.includes(GND) ? GND : nodeList[0];
  const parent = new Map<string, { node: string; edgeIdx: number } | null>();
  const visited = new Set<string>([root]);
  const treeEdgeIdx = new Set<number>();
  parent.set(root, null);
  const bfsQ = [root];
  while (bfsQ.length) {
    const u = bfsQ.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (!visited.has(other)) {
        visited.add(other);
        parent.set(other, { node: u, edgeIdx });
        treeEdgeIdx.add(edgeIdx);
        bfsQ.push(other);
      }
    }
  }

  const chordIdx = edges.map((_, i) => i).filter(i => !treeEdgeIdx.has(i));
  const cyclesCount = chordIdx.length;
  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, хорд (контуров): ${cyclesCount}`);

  // ── 7. Путь в дереве между двумя узлами ───────────────────────────────
  type CycleEdge = { edgeIdx: number; dir: 1 | -1 };

  const pathInTree = (from: string, to: string): CycleEdge[] => {
    // Подъём от from и to до LCA, формируем путь
    const ancFrom: string[] = [];
    let cur: string | null = from;
    while (cur !== null) {
      ancFrom.push(cur);
      const p = parent.get(cur);
      cur = p ? p.node : null;
    }
    const fromSet = new Set(ancFrom);

    const ancTo: string[] = [];
    cur = to;
    while (cur !== null && !fromSet.has(cur)) {
      ancTo.push(cur);
      const p = parent.get(cur);
      cur = p ? p.node : null;
    }
    const lca = cur ?? root;

    const path: CycleEdge[] = [];
    // От from вверх до LCA
    const idxLca = ancFrom.indexOf(lca);
    for (let i = 0; i < idxLca; i++) {
      const node = ancFrom[i];
      const p = parent.get(node)!;
      const e = edges[p.edgeIdx];
      path.push({ edgeIdx: p.edgeIdx, dir: e.a === node ? 1 : -1 });
    }
    // От LCA вниз до to (в обратном порядке ancTo)
    for (let i = ancTo.length - 1; i >= 0; i--) {
      const child = ancTo[i];
      const p = parent.get(child)!;
      const e = edges[p.edgeIdx];
      path.push({ edgeIdx: p.edgeIdx, dir: e.a === p.node ? 1 : -1 });
    }
    return path;
  };

  // ── 8. Формируем контуры ───────────────────────────────────────────────
  const cycles: CycleEdge[][] = chordIdx.map(cIdx => {
    const e = edges[cIdx];
    const path = pathInTree(e.b, e.a);
    return [{ edgeIdx: cIdx, dir: 1 as const }, ...path];
  });

  // ── 9. Начальное приближение Q ─────────────────────────────────────────
  // Оцениваем рабочую точку вентилятора по суммарному R дерева
  const Rtree = edges
    .filter((_, i) => treeEdgeIdx.has(i))
    .reduce((s, e) => s + e.R, 0);
  const Q0 = estimateFanQ(edges, Rtree);
  log.push(`Начальное Q0 = ${Q0.toFixed(2)} м³/с (R_tree = ${Rtree.toFixed(4)})`);

  // Начальное распределение Q:
  // 1. Все ветви дерева получают Q0 (стартовая оценка рабочей точки).
  //    Направление: от GND к листьям — Q>0 для ребра a→b если b дальше от корня.
  edges.forEach((e, i) => {
    if (treeEdgeIdx.has(i)) {
      // Определяем направление «от корня к листьям» по BFS-позиции
      // (BFS ещё не запускался для bottom-up — используем parent-map)
      const parentA = parent.get(e.a);
      const parentB = parent.get(e.b);
      if (parentB && parentB.node === e.a) {
        e.Q = Q0;   // a → b (b ближе к листу)
      } else if (parentA && parentA.node === e.b) {
        e.Q = -Q0;  // b → a (a ближе к листу, Q отрицателен в направлении a→b)
      } else {
        e.Q = Q0;
      }
    }
  });

  // 2. Раздаём ΔQ по контурам (хорды задают дополнительное перераспределение)
  cycles.forEach(cyc =>
    cyc.forEach(ce => { edges[ce.edgeIdx].Q += Q0 * ce.dir; })
  );

  // ── 10. Итерации Кросса ────────────────────────────────────────────────
  //
  // Для каждого контура k:
  //   num = Σ_i  R_i · Q_i · |Q_i|  −  H_fan_i · sign(Q_i) · dir_i
  //   den = Σ_i  2 · R_i · |Q_i|    +  |dH/dQ|_i
  //   ΔQ_k = −num / den
  //   Q_i ← Q_i + ΔQ_k · dir_i   для всех i в контуре k
  //
  // Знак H_fan: вентилятор нагнетает вдоль ветви a→b (Q_e > 0 → H>0 снижает депрессию).
  // В контуре это: Hsigned = H · (знак совпадения направления тока и обхода контура).
  // При Q>0 в ветви и dir=+1 → вентилятор «помогает» обходу → Hsigned = +H.
  // При Q<0 или dir=-1 → соответствующий знак.
  //
  let maxDelta = Infinity;
  let iterCount = 0;

  for (; iterCount < maxIter; iterCount++) {
    maxDelta = 0;

    for (const cyc of cycles) {
      let num = 0;
      let den = 0;

      for (const ce of cyc) {
        const e = edges[ce.edgeIdx];
        const Qdir = e.Q * ce.dir;            // Q с точки зрения обхода контура
        const { H, dH } = evalFanH(e, e.Q);  // H > 0: нагнетание в направлении a→b

        // Вентилятор совпадает с обходом контура если ce.dir > 0 И Q > 0.
        // В общем случае: вклад H в депрессию контура = −H · sign(Q_e) · ce.dir
        // (знак минус: вентилятор уменьшает суммарную депрессию контура)
        const Hcontr = H * Math.sign(e.Q || 1) * ce.dir;

        num += e.R * Qdir * Math.abs(Qdir) - Hcontr;
        den += 2 * e.R * Math.abs(Qdir) + dH;
      }

      if (den < 1e-9) continue;

      const dQ = -num / den;
      // Ограничиваем шаг: не более 60% от максимального |Q| в контуре
      const Qmax = cyc.reduce((m, ce) => Math.max(m, Math.abs(edges[ce.edgeIdx].Q)), 1);
      // Демпфирование: ограничиваем шаг и применяем коэффициент релаксации 0.7
      const dQclamped = Math.sign(dQ) * Math.min(Math.abs(dQ) * 0.7, Qmax * 0.5);

      if (Math.abs(dQclamped) > maxDelta) maxDelta = Math.abs(dQclamped);

      for (const ce of cyc) {
        edges[ce.edgeIdx].Q += dQclamped * ce.dir;
      }
    }

    // Защита от NaN
    edges.forEach(e => { if (!isFinite(e.Q)) e.Q = 0; });

    // Ограничиваем Q вентилятора в диапазоне кривой
    edges.forEach(e => {
      if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
        const k = rpmFactor(e.fanRpm, e.fanCurve.rpmNominal);
        const qMax = e.fanCurve.qMax * k;
        if (Math.abs(e.Q) > qMax) e.Q = Math.sign(e.Q || 1) * qMax;
      }
    });

    if (maxDelta < tol) { iterCount++; break; }
  }

  log.push(`Итерации: ${iterCount}, max|ΔQ| = ${maxDelta.toFixed(4)} м³/с`);

  // ── 10b. Пересчёт Q ветвей дерева методом «накопления снизу вверх» ────
  //
  // После итераций Кросса Q хорд установлен. Q ветвей дерева вычисляется
  // из первого закона Кирхгофа (Σ Q_входящих = Σ Q_исходящих в каждом узле).
  //
  // Алгоритм (классика, АэроСеть/Вентсим):
  //   1. Строим дерево с корнем = GND, направляя все рёбра «от корня к листьям».
  //   2. Обходим в обратном (bottom-up) порядке — от листьев к корню.
  //   3. Для каждого узла v (кроме корня):
  //      Q_ребра(parent→v) = Σ Q_хорд_входящих_в_v − Σ Q_хорд_исходящих_из_v
  //                         + Σ Q_рёбер_дерева_исходящих_из_v_уже_известных
  //      (т.е. «всё что нужно приплыть в поддерево v из родителя»)
  {


    // Вычисляем DFS-порядок от корня (BFS даст нам порядок, обратный = bottom-up)
    const bfsOrder: string[] = [];
    const bfsVisit = new Set<string>([root]);
    const bfsQ2 = [root];
    while (bfsQ2.length) {
      const u = bfsQ2.shift()!;
      bfsOrder.push(u);
      for (const { edgeIdx, other } of adj.get(u)!) {
        if (treeEdgeIdx.has(edgeIdx) && !bfsVisit.has(other)) {
          bfsVisit.add(other);
          bfsQ2.push(other);
        }
      }
    }


    // Индекс позиции узла в BFS-порядке для O(1) сравнения родителя
    const bfsPos = new Map<string, number>();
    bfsOrder.forEach((n, i) => bfsPos.set(n, i));

    // nodeQ[v] = суммарный поток через v (с учётом знака).
    // Знак: Q > 0 в ребре a→b означает отток из a и приток в b.
    // nodeQ[v] = Σ Q_входящих − Σ Q_исходящих  (без учёта ребра к родителю)
    const nodeQ = new Map<string, number>();
    nodeList.forEach(n => nodeQ.set(n, 0));

    // Инициализируем хордами (их Q уже известен)
    edges.forEach((e, i) => {
      if (treeEdgeIdx.has(i)) return;
      nodeQ.set(e.a, (nodeQ.get(e.a) ?? 0) - e.Q); // отток из a
      nodeQ.set(e.b, (nodeQ.get(e.b) ?? 0) + e.Q); // приток в b
    });

    // Обход снизу вверх: для каждого узла v (кроме root) находим ребро к родителю,
    // Q этого ребра = −nodeQ[v] (чтобы компенсировать дисбаланс в v).
    // После установки Q ребра обновляем nodeQ родителя.
    for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
      const v = bfsOrder[idx];

      // Ребро дерева к родителю (родитель = сосед с меньшим bfsPos)
      let treeE: SolverEdge | null = null;
      for (const { edgeIdx, other } of adj.get(v)!) {
        if (treeEdgeIdx.has(edgeIdx) && (bfsPos.get(other) ?? Infinity) < (bfsPos.get(v) ?? Infinity)) {
          treeE = edges[edgeIdx];
          break;
        }
      }
      if (!treeE) continue;

      const parentNode = treeE.a === v ? treeE.b : treeE.a;
      const balance = nodeQ.get(v) ?? 0;

      // Q ребра к родителю = −balance (ребро должно компенсировать дисбаланс в v)
      // Знак зависит от ориентации ребра:
      //   treeE.b === v: Q>0 означает приток в v. Нужно compensate −balance → Q = −balance.
      //   treeE.a === v: Q>0 означает отток из v. Нужно compensate −balance → Q = +balance.
      if (treeE.b === v) {
        treeE.Q = -balance;
      } else {
        treeE.Q = balance;
      }

      // Обновляем nodeQ родителя (родитель «принял» от v отток/приток через ребро)
      // Через ребро: отток из parentNode = treeE.Q (если treeE.a === parentNode)
      //              приток в parentNode = treeE.Q (если treeE.b === parentNode)
      if (treeE.a === parentNode) {
        nodeQ.set(parentNode, (nodeQ.get(parentNode) ?? 0) - treeE.Q);
      } else {
        nodeQ.set(parentNode, (nodeQ.get(parentNode) ?? 0) + treeE.Q);
      }
    }
  }

  // ── 11. Формируем выходные ветви ───────────────────────────────────────
  const branchesOut = branchesCalc.map(b => {
    const e = edges.find(x => x.id === b.id)!;
    // Знак Q: если a-узел ветви совпадает с a-узлом ребра → знак сохраняется
    const aOrig = remap(b.fromId);
    let Q = e.a === aOrig ? e.Q : -e.Q;
    if (!isFinite(Q)) Q = 0;

    let fanPressure = b.fanPressure;
    let fanEff = 0;
    let fanShaft = 0;
    if (b.hasFan) {
      const { H } = evalFanH(e, e.Q);
      fanPressure = H;
      if (b.fanMode === "curve" && e.fanCurve) {
        fanEff = fanEfficiency(e.fanCurve, Math.abs(Q));
        fanShaft = fanShaftPower(H, Math.abs(Q), fanEff);
      }
      log.push(`Вентилятор ${b.id}: Q=${Math.abs(Q).toFixed(2)} м³/с, H=${fanPressure.toFixed(0)} Па, η=${(fanEff * 100).toFixed(0)}%`);
    }

    return recalcBranchAero({ ...b, flow: Q, fanPressure, fanEfficiency: fanEff, fanShaftPower: fanShaft });
  });

  // ── 12. Давления в узлах ───────────────────────────────────────────────
  const nodePressure = new Map<string, number>();
  nodePressure.set(root, 101325);
  const pVisited = new Set([root]);
  const pQ = [root];
  while (pQ.length) {
    const u = pQ.shift()!;
    for (const { edgeIdx, other } of (adj.get(u) ?? [])) {
      if (!pVisited.has(other) && treeEdgeIdx.has(edgeIdx)) {
        const e = edges[edgeIdx];
        const { H } = evalFanH(e, e.Q);
        // dP от a к b: R·Q·|Q| − H (вентилятор повышает давление)
        const dP = e.R * e.Q * Math.abs(e.Q) - H;
        const Pu = nodePressure.get(u)!;
        nodePressure.set(other, e.a === u ? Pu - dP : Pu + dP);
        pVisited.add(other);
        pQ.push(other);
      }
    }
  }

  const nodesOut = nodesIn.map(n => {
    const id = n.atmosphereLink ? GND : n.id;
    const P = nodePressure.get(id);
    if (P === undefined) return n;
    return { ...n, computedPressure: Math.round(P + 12 * (-n.z)) };
  });

  // ── 13. Диагностика ───────────────────────────────────────────────────
  const diagnostics: SolveDiagnostic[] = [];

  // Дисбаланс узлов
  const bal = new Map<string, number>();
  edges.forEach(e => {
    if (e.a !== GND) bal.set(e.a, (bal.get(e.a) ?? 0) - e.Q);
    if (e.b !== GND) bal.set(e.b, (bal.get(e.b) ?? 0) + e.Q);
  });
  bal.forEach((v, id) => {
    if (Math.abs(v) > 2) {
      diagnostics.push({
        level: Math.abs(v) > 10 ? "error" : "warning",
        category: "node_balance",
        message: `Дисбаланс в узле ${id.substring(0, 40)}: ΔQ = ${v.toFixed(2)} м³/с`,
        objectId: id, value: v,
      });
    }
  });

  // Аномальные расходы (порог — физически невозможные скорости >50 м/с)
  branchesOut.forEach(b => {
    const Q = Math.abs(b.flow);
    const V = b.velocity;
    // Аномалия — скорость более 50 м/с (для любой горной выработки это нереально)
    if (V > 50 && b.area > 0) diagnostics.push({ level: "error", category: "branch_flow",
      message: `Нереальная скорость ${b.id}: V=${V.toFixed(0)} м/с (S=${b.area.toFixed(1)} м²)`,
      objectId: b.id, value: V });
    else if (Q > 500) diagnostics.push({ level: "error", category: "branch_flow",
      message: `Аномально высокий расход ${b.id}: Q=${Q.toFixed(1)} м³/с`, objectId: b.id, value: Q });
    // Превышение V_max — только предупреждение, не ошибка
    if (b.vMax > 0 && b.vMax < 50 && b.velocity > b.vMax * 1.2) diagnostics.push({ level: "warning", category: "branch_flow",
      message: `Скорость ${b.velocity.toFixed(1)} м/с в ${b.id} > V_max=${b.vMax}`, objectId: b.id, value: b.velocity });
  });

  // Вентиляторы на пределе кривой
  edges.forEach(e => {
    if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
      const k = rpmFactor(e.fanRpm, e.fanCurve.rpmNominal);
      const Q = Math.abs(e.Q);
      const qMin = e.fanCurve.qMin * k, qMax = e.fanCurve.qMax * k;
      if (Q < qMin * 0.9) diagnostics.push({ level: "warning", category: "fan",
        message: `${e.id}: помпаж Q=${Q.toFixed(1)} < Q_min=${qMin.toFixed(1)}`, objectId: e.id });
      else if (Q > qMax * 0.97) diagnostics.push({ level: "warning", category: "fan",
        message: `${e.id}: предел Q=${Q.toFixed(1)} ≈ Q_max=${qMax.toFixed(1)}`, objectId: e.id });
    }
  });

  // Сходимость
  if (maxDelta > tol) diagnostics.push({
    level: maxDelta > 1 ? "error" : "warning",
    category: "convergence",
    message: `max|ΔQ| = ${maxDelta.toFixed(3)} м³/с (норма < ${tol})`,
    value: maxDelta,
  });

  // Изолированные узлы
  const reachable = new Set<string>([root]);
  const stk = [root];
  while (stk.length) { const u = stk.pop()!; for (const { other } of adj.get(u)!) if (!reachable.has(other)) { reachable.add(other); stk.push(other); } }
  const isolated = nodeList.filter(n => !reachable.has(n));
  if (isolated.length > 0) diagnostics.push({ level: "error", category: "topology",
    message: `Изолировано ${isolated.length} узлов без атмосферной связи`, });

  // Нет вентилятора
  if (!edges.some(e => e.hasFan)) diagnostics.push({ level: "warning", category: "topology",
    message: "Нет ни одного вентилятора — расход будет нулевым" });

  return {
    ok: maxDelta < tol,
    iterations: iterCount,
    maxDeltaQ: maxDelta,
    branches: branchesOut,
    nodes: nodesOut,
    log,
    cyclesCount,
    diagnostics,
  };
}