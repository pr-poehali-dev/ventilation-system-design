// ─────────────────────────────────────────────────────────────────────────────
// Решение вентиляционной сети — Метод Контурных Расходов (МКР)
//
// Строго по методике:
//
//  Шаг 1. Строим граф, объединяем атмосферные узлы в GND.
//  Шаг 2. BFS → остовное дерево + хорды (независимые контуры).
//  Шаг 3. Для каждой хорды строим контур: хорда + путь в дереве через LCA.
//  Шаг 4. Начальное Q: оцениваем рабочую точку вентилятора, 
//          все ветви дерева получают Q0 (от корня к листьям),
//          хорды получают Q0 (их контуры уже учтут это через итерации).
//  Шаг 5. Итерация МКР (Кросс):
//          ΔH_k = Σ_{i∈k} R_i·Q_i·|Q_i| − Σ_{f∈k} H_f(Q_i)
//                  (Q_i берётся в проекции на направление обхода контура: Q_i·dir_i)
//          δQ_k = −ΔH_k / (2·Σ_{i∈k} R_i·|Q_i·dir_i|)
//          Q_i^{n+1} = Q_i^n + δQ_k · dir_i   для всех i в контуре k
//  Шаг 6. Остановка: max|ΔH_k| < ε1  ИЛИ  max|δQ_k| < ε2.
//  Шаг 7. Давления в узлах: BFS от GND по остовному дереву.
//
// ВАЖНО: знак в контуре
//   Для ветви i в контуре k: Q_i_dir = Q_i · dir_i
//   Потеря напора: h_i = R_i · Q_i_dir · |Q_i_dir|  (знак сохраняется!)
//   Напор вентилятора: вентилятор нагнетает в направлении a→b своей ветви.
//     Если dir_i = +1 (ветвь проходится в направлении a→b) → вентилятор «помогает» обходу
//     Если dir_i = −1 → вентилятор «противодействует» обходу
//     H_вклад = H_fan · dir_i   (но только если вентилятор реально нагнетает, т.е. Q_e > 0)
//
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
  tolerance?: number;     // ε2: max|δQ| < ε2 (м³/с)
  tolPressure?: number;   // ε1: max|ΔH| < ε1 (Па)
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

// Напор вентилятора H при расходе Q через ветвь (в физическом направлении a→b).
// Возвращает: H — напор (Па, >0 всегда, вентилятор нагнетает в a→b),
//             dH — |dH/dQ| для знаменателя МКР.
function evalFanH(e: SolverEdge, Q: number): { H: number; dH: number } {
  if (!e.hasFan) return { H: 0, dH: 0 };

  if (e.fanMode === "constant") {
    return { H: Math.max(0, e.HfanConst), dH: 0 };
  }

  if (e.fanMode === "curve" && e.fanCurve) {
    const curve = e.fanCurve;
    const k = rpmFactor(e.fanRpm, curve.rpmNominal);
    const af = getAngleFactor(curve, e.fanBladeAngle);
    const rhoF = e.fanRhoFactor ?? 1.0;
    const Qabs = Math.abs(Q) / Math.max(0.001, k);
    if (Qabs > curve.qMax) return { H: 0, dH: 0 };
    const H = Math.max(0, curve.h0 * af + curve.h1 * Qabs + curve.h2 * Qabs * Qabs) * k * k * rhoF;
    const dH = Math.abs((curve.h1 + 2 * curve.h2 * Qabs) * k * rhoF);
    return { H, dH };
  }

  return { H: 0, dH: 0 };
}

// Оценка рабочей точки вентилятора для начального Q0
function estimateFanQ(edges: SolverEdge[], Rtotal: number): number {
  const fanEdge = edges.find(e => e.hasFan);
  if (!fanEdge) return 5;

  if (fanEdge.fanMode === "constant" && fanEdge.HfanConst > 0 && Rtotal > 0) {
    return Math.sqrt(Math.max(0, fanEdge.HfanConst / Rtotal));
  }

  if (fanEdge.fanMode === "curve" && fanEdge.fanCurve) {
    const curve = fanEdge.fanCurve;
    const k = rpmFactor(fanEdge.fanRpm, curve.rpmNominal);
    const af = getAngleFactor(fanEdge.fanCurve, fanEdge.fanBladeAngle);
    const rhoF = fanEdge.fanRhoFactor ?? 1;
    const qHi = curve.qMax * k;

    if (Rtotal <= 0) return (curve.qMin + curve.qMax) / 2 * k;

    let lo = 0.01, hi = qHi, q = (lo + hi) / 2;
    for (let i = 0; i < 80; i++) {
      const Qn = q / Math.max(0.001, k);
      const Hf = Math.max(0, curve.h0 * af + curve.h1 * Qn + curve.h2 * Qn * Qn) * k * k * rhoF;
      const Hn = Rtotal * q * q;
      if (Math.abs(Hf - Hn) < 0.1) break;
      if (Hf > Hn) lo = q; else hi = q;
      q = (lo + hi) / 2;
    }
    return Math.max(0.5, q);
  }

  return 5;
}

// ─── Главная функция ─────────────────────────────────────────────────────────
export function solveNetwork(
  nodesIn: TopoNode[],
  branchesIn: TopoBranch[],
  options: SolveOptions = {},
): SolveResult {
  const maxIter   = options.maxIter    ?? 1000;
  const eps2      = options.tolerance  ?? 0.01;   // max|δQ| < 0.01 м³/с
  const eps1      = options.tolPressure ?? 0.1;   // max|ΔH| < 0.1 Па
  const log: string[] = [];

  // ── 1. Объединяем атмосферные узлы в GND ──────────────────────────────
  const remap = (id: string): string => {
    const n = nodesIn.find(x => x.id === id);
    return n?.atmosphereLink ? GND : id;
  };

  // ── 2. Пересчитываем длины из координат (если не заданы вручную) ──────
  const branchesWithLen = branchesIn.map(b => {
    if (b.manualLength && b.length > 0) return b;
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
      id:           b.id,
      a:            remap(b.fromId),
      b:            remap(b.toId),
      R:            Math.max(1e-9, b.resistance),
      hasFan:       b.hasFan,
      fanMode:      b.fanMode,
      HfanConst:    b.fanPressure * rhoFactor,
      fanCurve:     b.fanMode === "curve" ? getFanById(b.fanCurveId) ?? undefined : undefined,
      fanRpm:       b.fanRpm,
      fanBladeAngle: b.fanBladeAngle,
      fanRhoFactor: rhoFactor,
      Q:            0,
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
  const bfsQueue = [root];
  while (bfsQueue.length) {
    const u = bfsQueue.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (!visited.has(other)) {
        visited.add(other);
        parent.set(other, { node: u, edgeIdx });
        treeEdgeIdx.add(edgeIdx);
        bfsQueue.push(other);
      }
    }
  }

  const chordIdx = edges.map((_, i) => i).filter(i => !treeEdgeIdx.has(i));
  const cyclesCount = chordIdx.length;
  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, контуров: ${cyclesCount}`);

  // ── 7. Путь в остовном дереве между двумя узлами (через LCA) ──────────
  type CycleEdge = { edgeIdx: number; dir: 1 | -1 };

  const pathInTree = (from: string, to: string): CycleEdge[] => {
    // Подъём от from до корня — запоминаем путь
    const fromPath: string[] = [];
    let cur: string | null = from;
    while (cur !== null) {
      fromPath.push(cur);
      const p = parent.get(cur);
      cur = p ? p.node : null;
    }
    const fromSet = new Map(fromPath.map((n, i) => [n, i]));

    // Подъём от to до первого общего предка (LCA)
    const toPath: string[] = [];
    cur = to;
    while (cur !== null && !fromSet.has(cur)) {
      toPath.push(cur);
      const p = parent.get(cur);
      cur = p ? p.node : null;
    }
    const lca = cur ?? root;

    const path: CycleEdge[] = [];

    // Участок: from → LCA (вверх по дереву)
    const fromIdxLca = fromSet.get(lca)!;
    for (let i = 0; i < fromIdxLca; i++) {
      const node = fromPath[i];
      const p = parent.get(node)!;
      const e = edges[p.edgeIdx];
      // Идём от node к parent: если e.b === node → идём против a→b → dir = -1 (b→a)
      //                          если e.a === node → идём по a→b → dir = +1
      path.push({ edgeIdx: p.edgeIdx, dir: e.a === node ? 1 : -1 });
    }

    // Участок: LCA → to (вниз, в обратном порядке toPath)
    for (let i = toPath.length - 1; i >= 0; i--) {
      const child = toPath[i];
      const p = parent.get(child)!;
      const e = edges[p.edgeIdx];
      // Идём от p.node к child: если e.a === p.node → dir = +1, иначе dir = -1
      path.push({ edgeIdx: p.edgeIdx, dir: e.a === p.node ? 1 : -1 });
    }

    return path;
  };

  // ── 8. Формируем контуры (хорда + путь в дереве) ──────────────────────
  // Для каждой хорды: обход начинается с ребра хорды в направлении a→b (dir=+1),
  // затем путь в дереве от b обратно к a.
  const cycles: CycleEdge[][] = chordIdx.map(cIdx => {
    const e = edges[cIdx];
    const treePath = pathInTree(e.b, e.a);
    return [{ edgeIdx: cIdx, dir: 1 as const }, ...treePath];
  });

  // ── 9. Начальное приближение Q ─────────────────────────────────────────
  // Оцениваем суммарное сопротивление дерева для грубой оценки рабочей точки
  const Rtree = edges
    .filter((_, i) => treeEdgeIdx.has(i))
    .reduce((s, e) => s + e.R, 0);
  const Q0 = estimateFanQ(edges, Rtree);
  log.push(`Q0 = ${Q0.toFixed(2)} м³/с (R_tree = ${Rtree.toFixed(4)})`);

  // Все ветви дерева получают Q0 в направлении «от корня к листьям»
  // (BFS-порядок: если parent[b] = a → ребро a→b, Q = +Q0 если e.a === a, иначе Q = -Q0)
  const bfsPos = new Map<string, number>();
  {
    const bfsQ2 = [root];
    let pos = 0;
    const vis2 = new Set([root]);
    while (bfsQ2.length) {
      const u = bfsQ2.shift()!;
      bfsPos.set(u, pos++);
      for (const { edgeIdx, other } of adj.get(u)!) {
        if (treeEdgeIdx.has(edgeIdx) && !vis2.has(other)) {
          vis2.add(other);
          bfsQ2.push(other);
        }
      }
    }
  }

  edges.forEach((e, i) => {
    if (!treeEdgeIdx.has(i)) return;
    const posA = bfsPos.get(e.a) ?? 999999;
    const posB = bfsPos.get(e.b) ?? 999999;
    // Направление от корня к листьям: у «листового» конца posX больше
    e.Q = posB > posA ? Q0 : -Q0;
  });

  // Хорды получают Q0 (они участвуют в своих контурах, итерации выровняют)
  chordIdx.forEach(i => {
    edges[i].Q = Q0;
  });

  // ── 10. Итерации МКР ───────────────────────────────────────────────────
  //
  // Для каждого контура k:
  //   ΔH_k = Σ_{i∈k} R_i · (Q_i·dir_i) · |Q_i·dir_i|  −  Σ_{f∈k} H_f · dir_f
  //   δQ_k = −ΔH_k / ( 2 · Σ_{i∈k} R_i · |Q_i·dir_i| )
  //   Q_i ← Q_i + δQ_k · dir_i   для всех i ∈ k
  //
  // Знак вентилятора: H_вклад = H_fan · dir_i
  //   (если вентилятор нагнетает a→b и dir=+1 → он уменьшает ΔH → H_fan вычитается из суммы ΔH)
  //
  let maxDeltaQ = Infinity;
  let maxDeltaH = Infinity;
  let iterCount = 0;

  for (; iterCount < maxIter; iterCount++) {
    maxDeltaQ = 0;
    maxDeltaH = 0;

    for (const cyc of cycles) {
      let numH  = 0;   // числитель ΔH: Σ R·Qd·|Qd| − Σ H_f·dir
      let denH  = 0;   // знаменатель: 2·Σ R·|Qd|

      for (const ce of cyc) {
        const e   = edges[ce.edgeIdx];
        const Qd  = e.Q * ce.dir;           // расход в направлении обхода контура
        const { H, dH } = evalFanH(e, e.Q); // H > 0: нагнетание по направлению a→b

        numH += e.R * Qd * Math.abs(Qd);    // потери напора (с знаком)
        numH -= H * ce.dir;                  // напор вентилятора (знак по направлению обхода)

        denH += 2 * e.R * Math.abs(Qd) + dH;
      }

      if (denH < 1e-12) continue;

      const dQ = -numH / denH;              // корректирующий расход δQ_k

      if (Math.abs(numH) > maxDeltaH) maxDeltaH = Math.abs(numH);
      if (Math.abs(dQ)   > maxDeltaQ) maxDeltaQ = Math.abs(dQ);

      // Обновляем расходы во всех ветвях контура
      for (const ce of cyc) {
        edges[ce.edgeIdx].Q += dQ * ce.dir;
      }
    }

    // Защита от NaN/Inf
    edges.forEach(e => { if (!isFinite(e.Q)) e.Q = 0; });

    // Ограничение Q вентилятора диапазоном кривой
    edges.forEach(e => {
      if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
        const k = rpmFactor(e.fanRpm, e.fanCurve.rpmNominal);
        const qMax = e.fanCurve.qMax * k;
        if (Math.abs(e.Q) > qMax) e.Q = Math.sign(e.Q || 1) * qMax;
      }
    });

    // Критерий остановки по методике: |ΔH| < ε1 ИЛИ |δQ| < ε2
    if (maxDeltaH < eps1 || maxDeltaQ < eps2) { iterCount++; break; }
  }

  log.push(`Итерации: ${iterCount}, max|ΔH| = ${maxDeltaH.toFixed(3)} Па, max|δQ| = ${maxDeltaQ.toFixed(4)} м³/с`);

  // ── 11. Пересчёт Q ветвей дерева по первому закону Кирхгофа ───────────
  //
  // После итераций Кросса Q хорд зафиксированы.
  // Q ветвей дерева вычисляем bottom-up: для каждого листа
  // Q_ребра_к_родителю = −баланс_в_узле (суммируем всё что входит/выходит без этого ребра).
  //
  {
    // BFS-порядок от корня (bottom-up = обратный порядок)
    const bfsOrder: string[] = [];
    const bfsVis = new Set<string>([root]);
    const bfsQ3 = [root];
    while (bfsQ3.length) {
      const u = bfsQ3.shift()!;
      bfsOrder.push(u);
      for (const { edgeIdx, other } of adj.get(u)!) {
        if (treeEdgeIdx.has(edgeIdx) && !bfsVis.has(other)) {
          bfsVis.add(other);
          bfsQ3.push(other);
        }
      }
    }

    // nodeQ[v] = Σ Q_входящих − Σ Q_исходящих (только нетрековые ребра, т.е. хорды)
    const nodeQ = new Map<string, number>();
    nodeList.forEach(n => nodeQ.set(n, 0));

    // Инициализируем хордами
    edges.forEach((e, i) => {
      if (treeEdgeIdx.has(i)) return;
      nodeQ.set(e.a, (nodeQ.get(e.a) ?? 0) - e.Q);   // e.Q > 0 → отток из a
      nodeQ.set(e.b, (nodeQ.get(e.b) ?? 0) + e.Q);   // e.Q > 0 → приток в b
    });

    // Обход снизу вверх
    for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
      const v = bfsOrder[idx];

      // Находим ребро дерева к родителю
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

      // Q_ребра_к_родителю = −balance (компенсирует дисбаланс в v)
      // Знак зависит от ориентации ребра:
      //   treeE.b === v: Q>0 означает приток в v. Нужно Q = −balance.
      //   treeE.a === v: Q>0 означает отток из v. Нужно Q = +balance.
      if (treeE.b === v) {
        treeE.Q = -balance;
      } else {
        treeE.Q = balance;
      }

      // Обновляем баланс родителя
      if (treeE.a === parentNode) {
        nodeQ.set(parentNode, (nodeQ.get(parentNode) ?? 0) - treeE.Q);
      } else {
        nodeQ.set(parentNode, (nodeQ.get(parentNode) ?? 0) + treeE.Q);
      }
    }
  }

  // ── 12. Формируем выходные ветви ───────────────────────────────────────
  const branchesOut = branchesCalc.map(b => {
    const e = edges.find(x => x.id === b.id)!;
    const aOrig = remap(b.fromId);
    // Знак Q: если a-узел ветви совпадает с a-узлом ребра → Q тот же знак
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

  // ── 13. Давления в узлах (BFS по дереву от GND) ────────────────────────
  const nodePressure = new Map<string, number>();
  nodePressure.set(root, 101325);
  const pVisited = new Set([root]);
  const pQ = [root];
  while (pQ.length) {
    const u = pQ.shift()!;
    for (const { edgeIdx, other } of (adj.get(u) ?? [])) {
      if (pVisited.has(other)) continue;
      // Давление распространяем только по дереву
      if (!treeEdgeIdx.has(edgeIdx)) continue;
      const e = edges[edgeIdx];
      const { H } = evalFanH(e, e.Q);
      // ΔP = R·Q·|Q| − H  (от a к b: P_b = P_a − ΔP)
      const dP = e.R * e.Q * Math.abs(e.Q) - H;
      const Pu = nodePressure.get(u)!;
      // Если u === e.a → b = other, P_b = P_a − dP
      // Если u === e.b → a = other, P_a = P_b + dP
      nodePressure.set(other, e.a === u ? Pu - dP : Pu + dP);
      pVisited.add(other);
      pQ.push(other);
    }
  }

  const nodesOut = nodesIn.map(n => {
    const id = n.atmosphereLink ? GND : n.id;
    const P = nodePressure.get(id);
    if (P === undefined) return n;
    // Учёт барометрического давления с высотой: ~12 Па/м
    return { ...n, computedPressure: Math.round(P + 12 * (-n.z)) };
  });

  // ── 14. Диагностика ────────────────────────────────────────────────────
  const diagnostics: SolveDiagnostic[] = [];

  // Дисбаланс узлов (по итогу)
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

  // Аномальные скорости и расходы
  branchesOut.forEach(b => {
    const Q = Math.abs(b.flow);
    const V = b.velocity;
    if (V > 50 && b.area > 0) diagnostics.push({ level: "error", category: "branch_flow",
      message: `Нереальная скорость ${b.id}: V=${V.toFixed(0)} м/с`, objectId: b.id, value: V });
    else if (Q > 500) diagnostics.push({ level: "error", category: "branch_flow",
      message: `Аномально высокий расход ${b.id}: Q=${Q.toFixed(1)} м³/с`, objectId: b.id, value: Q });
    if (b.vMax > 0 && b.vMax < 50 && b.velocity > b.vMax * 1.2) diagnostics.push({
      level: "warning", category: "branch_flow",
      message: `Скорость ${b.velocity.toFixed(1)} м/с в ${b.id} > V_max=${b.vMax}`,
      objectId: b.id, value: b.velocity });
  });

  // Вентиляторы на пределе
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
  const converged = maxDeltaH < eps1 || maxDeltaQ < eps2;
  if (!converged) diagnostics.push({
    level: maxDeltaQ > 1 ? "error" : "warning",
    category: "convergence",
    message: `Не сошлось: max|ΔH| = ${maxDeltaH.toFixed(2)} Па, max|δQ| = ${maxDeltaQ.toFixed(3)} м³/с`,
    value: maxDeltaQ,
  });

  // Изолированные узлы
  const reachable = new Set<string>([root]);
  const stk = [root];
  while (stk.length) {
    const u = stk.pop()!;
    for (const { other } of adj.get(u)!) {
      if (!reachable.has(other)) { reachable.add(other); stk.push(other); }
    }
  }
  const isolated = nodeList.filter(n => !reachable.has(n));
  if (isolated.length > 0) diagnostics.push({ level: "error", category: "topology",
    message: `Изолировано ${isolated.length} узлов без атмосферной связи` });

  // Нет вентилятора
  if (!edges.some(e => e.hasFan)) diagnostics.push({ level: "warning", category: "topology",
    message: "Нет ни одного вентилятора — расход будет нулевым" });

  return {
    ok: converged,
    iterations: iterCount,
    maxDeltaQ,
    branches: branchesOut,
    nodes: nodesOut,
    log,
    cyclesCount,
    diagnostics,
  };
}
