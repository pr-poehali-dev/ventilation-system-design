// =============================================================================
// МЕТОД КОНТУРНЫХ РАСХОДОВ (МКР) — реализация по методике (7 шагов)
//
// Законы Кирхгофа:
//   1-й закон (узел):   Σ Q_вх = Σ Q_вых  →  баланс расходов
//   2-й закон (контур): Σ R_i·Q_i·|Q_i| = Σ H_f  →  баланс напоров
//
// Алгоритм (7 шагов):
//   Шаг 1. Подготовка данных: граф узлов и ветвей, объединяем атмосферу в GND.
//   Шаг 2. Инициализация: начальные расходы Q^(0) = Q0 (от рабочей точки вентилятора).
//   Шаг 3. Расчёт сопротивлений R = α·L / S³ (или по шероховатости / вручную).
//   Шаг 4. Формирование независимых контуров (BFS-дерево + хорды).
//   Шаг 5. Итерационный процесс:
//            ΔH_k = Σ_{i∈k} R_i·Q_i^(n)·|Q_i^(n)|  −  Σ_{f∈k} H_f(Q_i^(n))
//            δQ_k = −ΔH_k / (2·Σ_{i∈k} R_i·|Q_i^(n)|)
//            Q_i^(n+1) = Q_i^(n) + δQ_k · dir_i
//   Шаг 6. Критерий остановки: max|ΔH_k| < ε1 (0.1 Па) ИЛИ max|δQ_k| < ε2 (0.01 м³/с).
//   Шаг 7. Проверка устойчивости: баланс узлов, соответствие H(Q) вентиляторов.
// =============================================================================

import type { TopoNode, TopoBranch } from "./topology";
import { recalcBranchAero, calcBranchLength } from "./topology";
import { getFanById, fanEfficiency, fanShaftPower, type FanCurve } from "./fanCurves";

// ── Константы ──────────────────────────────────────────────────────────────
const GND_ID   = "@gnd";    // виртуальный атмосферный узел
const EPS1     = 0.1;       // ε1: max|ΔH| < 0.1 Па
const EPS2     = 0.01;      // ε2: max|δQ| < 0.01 м³/с
const MAX_ITER = 1000;      // предельное число итераций
const MIN_R    = 1e-9;      // минимальное R (защита от деления на 0)

// ── Типы ───────────────────────────────────────────────────────────────────

interface Edge {
  id:            string;
  a:             string;
  b:             string;
  R:             number;
  Q:             number;
  hasFan:        boolean;
  fanMode:       "constant" | "curve";
  fanH0:         number;
  fanCurve?:     FanCurve;
  fanRpm?:       number;
  fanBladeAngle?: number;
  fanRhoFactor:  number;
}

interface ContourEdge {
  edgeIdx: number;
  dir:     1 | -1;
}

export interface SolveOptions {
  maxIter?:     number;
  tolerance?:   number;
  tolPressure?: number;
}

export interface SolveResult {
  ok:          boolean;
  iterations:  number;
  maxDeltaQ:   number;
  maxDeltaH:   number;
  branches:    TopoBranch[];
  nodes:       TopoNode[];
  log:         string[];
  cyclesCount: number;
  diagnostics: SolveDiagnostic[];
}

export interface SolveDiagnostic {
  level:     "error" | "warning" | "info";
  category:  "topology" | "node_balance" | "branch_flow" | "fan" | "convergence";
  message:   string;
  objectId?: string;
  value?:    number;
}

// =============================================================================
// Вспомогательные функции для вентилятора
// =============================================================================

function angleFactor(c: FanCurve, angle?: number): number {
  if (!c.bladeAngles || c.bladeAngles.length < 2) return 1;
  const lo = c.bladeAngles[0];
  const hi = c.bladeAngles[c.bladeAngles.length - 1];
  const a  = Math.min(hi, Math.max(lo, angle ?? (lo + hi) / 2));
  const t  = (a - lo) / Math.max(1, hi - lo);
  return 0.65 + t * 0.70;
}

/** Напор вентилятора H(Q) — по направлению a→b ветви. */
function fanH(e: Edge, Q: number): number {
  if (!e.hasFan) return 0;
  if (e.fanMode === "constant") return Math.max(0, e.fanH0);
  if (e.fanMode === "curve" && e.fanCurve) {
    const c  = e.fanCurve;
    const k  = (e.fanRpm && c.rpmNominal > 0) ? e.fanRpm / c.rpmNominal : 1;
    const af = angleFactor(c, e.fanBladeAngle);
    const Qn = Math.abs(Q) / Math.max(0.001, k);
    if (Qn > c.qMax) return 0;
    return Math.max(0, c.h0 * af + c.h1 * Qn + c.h2 * Qn * Qn) * k * k * e.fanRhoFactor;
  }
  return 0;
}

/** |dH/dQ| — для уточнения знаменателя δQ при нелинейной кривой. */
function fanDH(e: Edge, Q: number): number {
  if (!e.hasFan || e.fanMode !== "curve" || !e.fanCurve) return 0;
  const c  = e.fanCurve;
  const k  = (e.fanRpm && c.rpmNominal > 0) ? e.fanRpm / c.rpmNominal : 1;
  const Qn = Math.abs(Q) / Math.max(0.001, k);
  return Math.abs((c.h1 + 2 * c.h2 * Qn) * k * e.fanRhoFactor);
}

/** Оценка рабочей точки вентилятора (для начального Q0). */
function estimateQ0(edges: Edge[], Rtotal: number): number {
  const fan = edges.find(e => e.hasFan);
  if (!fan) return 5;
  if (fan.fanMode === "constant" && fan.fanH0 > 0 && Rtotal > 0)
    return Math.sqrt(fan.fanH0 / Rtotal);
  if (fan.fanMode === "curve" && fan.fanCurve) {
    const c  = fan.fanCurve;
    const k  = (fan.fanRpm && c.rpmNominal > 0) ? fan.fanRpm / c.rpmNominal : 1;
    if (Rtotal <= 0) return (c.qMin + c.qMax) / 2 * k;
    let lo = 0.01, hi = c.qMax * k;
    for (let i = 0; i < 80; i++) {
      const q  = (lo + hi) / 2;
      const Hf = fanH(fan, q);
      const Hn = Rtotal * q * q;
      if (Math.abs(Hf - Hn) < 0.05) return Math.max(0.5, q);
      if (Hf > Hn) lo = q; else hi = q;
    }
    return Math.max(0.5, (lo + hi) / 2);
  }
  return 5;
}

// =============================================================================
// Путь между двумя узлами по остовному дереву (через LCA)
// =============================================================================

function treePath(
  from:   string,
  to:     string,
  edges:  Edge[],
  parent: Map<string, { node: string; edgeIdx: number } | null>,
): ContourEdge[] {
  const ancs = (start: string) => {
    const list: string[] = [];
    let cur: string | null = start;
    while (cur !== null) {
      list.push(cur);
      const p = parent.get(cur);
      cur = p ? p.node : null;
    }
    return list;
  };

  const ancsFrom = ancs(from);
  const ancsTo   = ancs(to);
  const setFrom  = new Map(ancsFrom.map((n, i) => [n, i]));

  let lca    = ancsTo[0];
  let idxTo  = 0;
  for (let i = 0; i < ancsTo.length; i++) {
    if (setFrom.has(ancsTo[i])) { lca = ancsTo[i]; idxTo = i; break; }
  }
  const idxFrom = setFrom.get(lca)!;

  const result: ContourEdge[] = [];

  // from → LCA (идём вверх: из node в parent)
  for (let i = 0; i < idxFrom; i++) {
    const node = ancsFrom[i];
    const p    = parent.get(node)!;
    const e    = edges[p.edgeIdx];
    // Движение: node → p.node. Если e.a === node → идём a→b = +1, иначе b→a = -1
    result.push({ edgeIdx: p.edgeIdx, dir: e.a === node ? 1 : -1 });
  }

  // LCA → to (идём вниз: из p.node в child)
  for (let i = idxTo - 1; i >= 0; i--) {
    const child = ancsTo[i];
    const p     = parent.get(child)!;
    const e     = edges[p.edgeIdx];
    // Движение: p.node → child. Если e.a === p.node → dir = +1, иначе -1
    result.push({ edgeIdx: p.edgeIdx, dir: e.a === p.node ? 1 : -1 });
  }

  return result;
}

// =============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// =============================================================================

export function solveNetwork(
  nodesIn:    TopoNode[],
  branchesIn: TopoBranch[],
  options:    SolveOptions = {},
): SolveResult {

  const eps1    = options.tolPressure ?? EPS1;
  const eps2    = options.tolerance   ?? EPS2;
  const maxIter = options.maxIter     ?? MAX_ITER;
  const log: string[] = [];

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 1. ПОДГОТОВКА ДАННЫХ
  // ──────────────────────────────────────────────────────────────────────────

  const toGnd = (id: string): string =>
    nodesIn.find(x => x.id === id)?.atmosphereLink ? GND_ID : id;

  // Длины из координат
  const brWithLen = branchesIn.map(b => {
    if (b.manualLength && b.length > 0) return b;
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    if (!fn || !tn) return b;
    const len = Math.round(calcBranchLength(fn, tn));
    return len > 0 ? { ...b, length: len } : b;
  });

  // ШАГ 3. Пересчёт сопротивлений R = α·L / S³
  const airRho = (T: number) => 1.2 * 293 / (273 + Math.max(-50, Math.min(200, T)));

  const brCalc = brWithLen.map(b => {
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    const T  = (fn && tn) ? (fn.airTemp + tn.airTemp) / 2 : 20;
    return recalcBranchAero({ ...b }, airRho(T));
  });

  // Граф рёбер
  const edges: Edge[] = brCalc.map(b => {
    const fn  = nodesIn.find(n => n.id === b.fromId);
    const tn  = nodesIn.find(n => n.id === b.toId);
    const T   = (fn && tn) ? (fn.airTemp + tn.airTemp) / 2 : 20;
    const rho = airRho(T) / 1.2;
    return {
      id:            b.id,
      a:             toGnd(b.fromId),
      b:             toGnd(b.toId),
      R:             Math.max(MIN_R, b.resistance),
      Q:             0,
      hasFan:        b.hasFan,
      fanMode:       b.fanMode,
      fanH0:         b.fanPressure * rho,
      fanCurve:      b.fanMode === "curve" ? (getFanById(b.fanCurveId) ?? undefined) : undefined,
      fanRpm:        b.fanRpm,
      fanBladeAngle: b.fanBladeAngle,
      fanRhoFactor:  rho,
    };
  });

  if (edges.length === 0) {
    return {
      ok: false, iterations: 0, maxDeltaQ: 0, maxDeltaH: 0,
      branches: brCalc, nodes: nodesIn, log: ["Нет ветвей"],
      cyclesCount: 0, diagnostics: [],
    };
  }

  // Список смежности
  const nodeSet = new Set<string>();
  edges.forEach(e => { nodeSet.add(e.a); nodeSet.add(e.b); });
  const nodeList = Array.from(nodeSet);

  const adj = new Map<string, { edgeIdx: number; other: string }[]>();
  nodeList.forEach(n => adj.set(n, []));
  edges.forEach((e, i) => {
    adj.get(e.a)!.push({ edgeIdx: i, other: e.b });
    adj.get(e.b)!.push({ edgeIdx: i, other: e.a });
  });

  const root = nodeList.includes(GND_ID) ? GND_ID : nodeList[0];

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 4. ФОРМИРОВАНИЕ КОНТУРОВ — BFS-дерево + хорды
  // ──────────────────────────────────────────────────────────────────────────

  const parent  = new Map<string, { node: string; edgeIdx: number } | null>();
  const visited = new Set<string>([root]);
  const treeSet = new Set<number>();
  const bfsOrder: string[] = [];
  parent.set(root, null);
  const bfsQ = [root];

  while (bfsQ.length) {
    const u = bfsQ.shift()!;
    bfsOrder.push(u);
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (!visited.has(other)) {
        visited.add(other);
        parent.set(other, { node: u, edgeIdx });
        treeSet.add(edgeIdx);
        bfsQ.push(other);
      }
    }
  }

  const chords   = edges.map((_, i) => i).filter(i => !treeSet.has(i));
  const bfsPos   = new Map(bfsOrder.map((n, i) => [n, i]));

  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, контуров: ${chords.length}`);

  // Контуры: хорда (dir=+1) + путь в дереве от b к a
  const contours: ContourEdge[][] = chords.map(cIdx => {
    const e = edges[cIdx];
    return [{ edgeIdx: cIdx, dir: 1 as const }, ...treePath(e.b, e.a, edges, parent)];
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 2. ИНИЦИАЛИЗАЦИЯ Q^(0)
  // ──────────────────────────────────────────────────────────────────────────

  const Rtree = edges.filter((_, i) => treeSet.has(i)).reduce((s, e) => s + e.R, 0);
  const Q0    = estimateQ0(edges, Rtree);
  log.push(`Q₀ = ${Q0.toFixed(2)} м³/с`);

  edges.forEach((e, i) => {
    if (!treeSet.has(i)) {
      e.Q = Q0;
    } else {
      const posA = bfsPos.get(e.a) ?? 1e9;
      const posB = bfsPos.get(e.b) ?? 1e9;
      e.Q = posB > posA ? Q0 : -Q0;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 5. ИТЕРАЦИОННЫЙ ПРОЦЕСС МКР
  // ──────────────────────────────────────────────────────────────────────────

  let maxDeltaQ = Infinity;
  let maxDeltaH = Infinity;
  let iter      = 0;

  for (; iter < maxIter; iter++) {
    maxDeltaQ = 0;
    maxDeltaH = 0;

    for (const contour of contours) {
      let num = 0;   // числитель: ΔH_k
      let den = 0;   // знаменатель: 2·Σ R·|Q^d|

      for (const { edgeIdx, dir } of contour) {
        const e  = edges[edgeIdx];
        const Qd = e.Q * dir;   // расход в направлении обхода контура

        // ΔH_k = Σ R·Q^d·|Q^d| − Σ H_f·dir
        num += e.R * Qd * Math.abs(Qd);
        num -= fanH(e, e.Q) * dir;

        // Знаменатель: 2·R·|Q^d| + |dH/dQ|
        den += 2 * e.R * Math.abs(Qd) + fanDH(e, e.Q);
      }

      if (den < 1e-12) continue;

      const dQ = -num / den;   // δQ_k

      if (Math.abs(num) > maxDeltaH) maxDeltaH = Math.abs(num);
      if (Math.abs(dQ)  > maxDeltaQ) maxDeltaQ = Math.abs(dQ);

      // Q_i^(n+1) = Q_i^(n) + δQ_k · dir_i
      for (const { edgeIdx, dir } of contour) {
        edges[edgeIdx].Q += dQ * dir;
      }
    }

    for (const e of edges) if (!isFinite(e.Q)) e.Q = 0;

    for (const e of edges) {
      if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
        const k    = (e.fanRpm && e.fanCurve.rpmNominal > 0) ? e.fanRpm / e.fanCurve.rpmNominal : 1;
        const qMax = e.fanCurve.qMax * k;
        if (Math.abs(e.Q) > qMax) e.Q = Math.sign(e.Q || 1) * qMax;
      }
    }

    // ── ШАГ 6. Критерий остановки ──
    if (maxDeltaH < eps1 || maxDeltaQ < eps2) { iter++; break; }
  }

  log.push(`Итерации: ${iter}, max|ΔH|=${maxDeltaH.toFixed(3)} Па, max|δQ|=${maxDeltaQ.toFixed(4)} м³/с`);

  // ──────────────────────────────────────────────────────────────────────────
  // ПЕРЕСЧЁТ Q ВЕТВЕЙ ДЕРЕВА (1-й закон Кирхгофа, снизу вверх)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const balance = new Map<string, number>();
    nodeList.forEach(n => balance.set(n, 0));

    // Инициализируем балансами хорд (их Q известны)
    for (let i = 0; i < edges.length; i++) {
      if (treeSet.has(i)) continue;
      const e = edges[i];
      balance.set(e.a, (balance.get(e.a) ?? 0) - e.Q);
      balance.set(e.b, (balance.get(e.b) ?? 0) + e.Q);
    }

    // Снизу вверх: для каждого нелистового узла ставим Q ребра к родителю
    for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
      const v = bfsOrder[idx];
      const p = parent.get(v);
      if (!p) continue;

      const e     = edges[p.edgeIdx];
      const pNode = p.node;
      const bal   = balance.get(v) ?? 0;

      // e.b === v → Q>0 приток в v → e.Q = −bal
      // e.a === v → Q>0 отток из v → e.Q = +bal
      e.Q = e.b === v ? -bal : bal;

      if (e.a === pNode) {
        balance.set(pNode, (balance.get(pNode) ?? 0) - e.Q);
      } else {
        balance.set(pNode, (balance.get(pNode) ?? 0) + e.Q);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ВЫХОДНЫЕ ВЕТВИ
  // ──────────────────────────────────────────────────────────────────────────
  const brOut = brCalc.map(b => {
    const e    = edges.find(x => x.id === b.id)!;
    const aMap = toGnd(b.fromId);
    let Q = e.a === aMap ? e.Q : -e.Q;
    if (!isFinite(Q)) Q = 0;

    let fanPressure = b.fanPressure;
    let fanEff      = 0;
    let fanShaft    = 0;

    if (b.hasFan) {
      const H = fanH(e, e.Q);
      fanPressure = H;
      if (b.fanMode === "curve" && e.fanCurve) {
        fanEff   = fanEfficiency(e.fanCurve, Math.abs(Q));
        fanShaft = fanShaftPower(H, Math.abs(Q), fanEff);
      }
      log.push(`Вент. ${b.id}: Q=${Math.abs(Q).toFixed(2)} м³/с, H=${H.toFixed(0)} Па, η=${(fanEff * 100).toFixed(0)}%`);
    }

    return recalcBranchAero({ ...b, flow: Q, fanPressure, fanEfficiency: fanEff, fanShaftPower: fanShaft });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ДАВЛЕНИЯ В УЗЛАХ (BFS по дереву от GND)
  // ──────────────────────────────────────────────────────────────────────────
  const pressure = new Map<string, number>([[root, 101325]]);
  const pVis     = new Set([root]);
  const pQ2      = [root];

  while (pQ2.length) {
    const u = pQ2.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (pVis.has(other) || !treeSet.has(edgeIdx)) continue;
      const e  = edges[edgeIdx];
      const H  = fanH(e, e.Q);
      const dP = e.R * e.Q * Math.abs(e.Q) - H;
      const Pu = pressure.get(u)!;
      pressure.set(other, e.a === u ? Pu - dP : Pu + dP);
      pVis.add(other);
      pQ2.push(other);
    }
  }

  const nodesOut = nodesIn.map(n => {
    const id = n.atmosphereLink ? GND_ID : n.id;
    const P  = pressure.get(id);
    if (P === undefined) return n;
    return { ...n, computedPressure: Math.round(P + 12 * (-n.z)) };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 7. ПРОВЕРКА УСТОЙЧИВОСТИ
  // ──────────────────────────────────────────────────────────────────────────
  const diag: SolveDiagnostic[] = [];

  // 7а. Баланс расходов в узлах
  const nodeBalance = new Map<string, number>();
  for (const e of edges) {
    nodeBalance.set(e.a, (nodeBalance.get(e.a) ?? 0) - e.Q);
    nodeBalance.set(e.b, (nodeBalance.get(e.b) ?? 0) + e.Q);
  }
  nodeBalance.forEach((v, id) => {
    if (id === GND_ID || Math.abs(v) <= 2) return;
    diag.push({
      level: Math.abs(v) > 10 ? "error" : "warning",
      category: "node_balance",
      message:  `Дисбаланс в узле ${id.slice(0, 40)}: ΔQ=${v.toFixed(2)} м³/с`,
      objectId: id, value: v,
    });
  });

  // 7б. Соответствие H(Q) вентиляторов
  for (const e of edges) {
    if (!e.hasFan || e.fanMode !== "curve" || !e.fanCurve) continue;
    const k    = (e.fanRpm && e.fanCurve.rpmNominal > 0) ? e.fanRpm / e.fanCurve.rpmNominal : 1;
    const Q    = Math.abs(e.Q);
    const qMin = e.fanCurve.qMin * k;
    const qMax = e.fanCurve.qMax * k;
    if (Q < qMin * 0.9)
      diag.push({ level: "warning", category: "fan", message: `${e.id}: помпаж Q=${Q.toFixed(1)} < Qmin=${qMin.toFixed(1)}`, objectId: e.id });
    else if (Q > qMax * 0.97)
      diag.push({ level: "warning", category: "fan", message: `${e.id}: предел Q=${Q.toFixed(1)} ≈ Qmax=${qMax.toFixed(1)}`, objectId: e.id });
  }

  // 7в. Аномальные параметры
  for (const b of brOut) {
    if (Math.abs(b.flow) > 500)
      diag.push({ level: "error", category: "branch_flow", message: `${b.id}: Q=${Math.abs(b.flow).toFixed(1)} м³/с — аномально`, objectId: b.id, value: b.flow });
    if (b.velocity > 50 && b.area > 0)
      diag.push({ level: "error", category: "branch_flow", message: `${b.id}: V=${b.velocity.toFixed(0)} м/с — нереально`, objectId: b.id, value: b.velocity });
    if (b.vMax > 0 && b.vMax < 50 && b.velocity > b.vMax * 1.2)
      diag.push({ level: "warning", category: "branch_flow", message: `${b.id}: V=${b.velocity.toFixed(1)} > Vmax=${b.vMax} м/с`, objectId: b.id, value: b.velocity });
  }

  // 7г. Сходимость
  const converged = maxDeltaH < eps1 || maxDeltaQ < eps2;
  if (!converged)
    diag.push({ level: maxDeltaQ > 1 ? "error" : "warning", category: "convergence",
      message: `Не сошлось: max|ΔH|=${maxDeltaH.toFixed(2)} Па, max|δQ|=${maxDeltaQ.toFixed(3)} м³/с`, value: maxDeltaQ });

  // 7д. Изолированные узлы
  const reach = new Set<string>([root]);
  const stk   = [root];
  while (stk.length) {
    const u = stk.pop()!;
    for (const { other } of adj.get(u)!) if (!reach.has(other)) { reach.add(other); stk.push(other); }
  }
  const isolated = nodeList.filter(n => !reach.has(n));
  if (isolated.length)
    diag.push({ level: "error", category: "topology", message: `Изолировано ${isolated.length} узлов` });

  if (!edges.some(e => e.hasFan))
    diag.push({ level: "warning", category: "topology", message: "Нет вентилятора — расход нулевой" });

  return {
    ok:          converged,
    iterations:  iter,
    maxDeltaQ,
    maxDeltaH,
    branches:    brOut,
    nodes:       nodesOut,
    log,
    cyclesCount: chords.length,
    diagnostics: diag,
  };
}
