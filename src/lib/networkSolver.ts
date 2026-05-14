// ─────────────────────────────────────────────────────────────────────────────
// Решение вентиляционной сети методом контурных расходов (метод Кросса)
//
// Для воздушных сетей:
//   • 1-й закон Кирхгофа: Σ Q в узле = 0
//   • 2-й закон: Σ R·Q·|Q| − Σ H_fan = 0 в каждом контуре
//
// Алгоритм:
//   1. Объединяем все атмосферные узлы в виртуальный «узел земли» (id="@gnd")
//   2. Строим остовное дерево (BFS).
//   3. Если сеть разомкнутая (дерево, нет хорд):
//      → Однопроходный метод: ищем рабочую точку Q по уравнению H_fan(Q) = R_total·Q²
//   4. Если есть контуры (хорды) → итерации Кросса.
//   5. Сходимость: max|ΔQ| < ε.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoNode, TopoBranch } from "./topology";
import { recalcBranchAero, calcBranchLength } from "./topology";
import { getFanById, fanH, fanDH, fanEfficiency, fanShaftPower, type FanCurve } from "./fanCurves";

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
  fanRhoFactor?: number;  // ρ/ρ₀ — поправка напора на плотность воздуха (температура)
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
}

// Коэффициент оборотов: k = n / n_nom. fanRpm=0 означает «не задано» → номинал
function rpmFactor(fanRpm: number | undefined, rpmNominal: number): number {
  if (!fanRpm || fanRpm <= 0 || rpmNominal <= 0) return 1;
  return fanRpm / rpmNominal;
}

// Коэффициент угла лопаток для осевых вентиляторов.
// По паспортным данным ВОД/ВО: при изменении угла от min до max
// напор меняется примерно в 1.5–1.7 раза.
// Средний угол (индекс 50%) соответствует номинальной кривой (af=1.0).
// Диапазон: 0.65 (min угол) .. 1.35 (max угол)
function getAngleFactor(curve: FanCurve, angle?: number): number {
  if (!curve.bladeAngles || curve.bladeAngles.length < 2) return 1;
  const aMin = curve.bladeAngles[0];
  const aMax = curve.bladeAngles[curve.bladeAngles.length - 1];
  const aMid = (aMin + aMax) / 2;
  const a = Math.min(aMax, Math.max(aMin, angle ?? aMid));
  const t = (a - aMin) / Math.max(1, aMax - aMin); // 0..1
  return 0.65 + t * 0.70; // 0.65 (min) .. 1.35 (max), 1.0 при среднем угле
}

// Получить H_fan с учётом оборотов (закон подобия: H ~ k², Q ~ k)
function evalFanH(e: SolverEdge, Q: number): { H: number; dH: number } {
  if (!e.hasFan) return { H: 0, dH: 0 };
  if (e.fanMode === "curve" && e.fanCurve) {
    const curve = e.fanCurve;
    const k = rpmFactor(e.fanRpm, curve.rpmNominal);
    // Масштабирование по закону подобия: Q_norm = Q/k, H = H_nom(Q_norm)*k²
    const Qabs = Math.abs(Q);
    const Qnorm = Qabs / Math.max(0.001, k);
    // За пределами рабочего диапазона кривой вентилятор не создаёт напора
    if (Qnorm > curve.qMax) return { H: 0, dH: 0 };
    const af = getAngleFactor(curve, e.fanBladeAngle);
    const rhoF = e.fanRhoFactor ?? 1.0;  // поправка на плотность
    const H = Math.max(0, curve.h0 * af + curve.h1 * Qnorm + curve.h2 * Qnorm * Qnorm) * k * k * rhoF;
    // dH/dQ = (h1 + 2*h2*Qnorm) / k * k² = (h1 + 2*h2*Qnorm) * k
    const dH = Math.abs((curve.h1 + 2 * curve.h2 * Qnorm) * k * rhoF);
    return { H, dH };
  }
  return { H: e.HfanConst, dH: 0 };
}

// ─── Однопроходный решатель для РАЗОМКНУТОЙ сети (дерево) ────────────────────
// Находит Q методом бисекции: H_fan(Q) = R_total * Q^2
// Rtotal можно передать явно (путевое сопротивление); если не передан — суммирует все ветви
function solveOpenNetwork(
  edges: SolverEdge[],
  log: string[],
  rtotalOverride?: number,
): number {
  const fanEdges = edges.filter(e => e.hasFan);
  if (fanEdges.length === 0) {
    log.push("Вентилятор не задан — поток = 0");
    return 0;
  }

  // Суммарное сопротивление: используем переданное значение или сумму всех
  const Rtotal = rtotalOverride !== undefined ? rtotalOverride : edges.reduce((s, e) => s + e.R, 0);

  // Суммарный напор вентиляторов (для нескольких параллельных/последовательных)
  // Упрощение: один вентилятор доминирует
  const fan = fanEdges[0];

  if (fan.fanMode === "constant") {
    // H = const → Q = sqrt(H / R_total)
    const H = fan.HfanConst;
    if (H <= 0 || Rtotal <= 0) return 0;
    const Q = Math.sqrt(H / Rtotal);
    log.push(`Разомкнутая сеть (постоянный напор): H=${H.toFixed(0)}Па, R=${Rtotal.toFixed(4)}, Q=${Q.toFixed(2)}м³/с`);
    return Q;
  }

  if (!fan.fanCurve) {
    log.push("Модель вентилятора не выбрана");
    return 0;
  }

  const curve = fan.fanCurve;
  const k = rpmFactor(fan.fanRpm, curve.rpmNominal);
  const af = getAngleFactor(curve, fan.fanBladeAngle);

  // Бисекция: найти Q где H_fan(Q) = R_total * Q^2
  // H_fan убывает с Q, R*Q^2 возрастает → пересечение единственно
  const qLo = curve.qMin * k;
  const qHi = curve.qMax * k;

  // Проверяем что вентилятор вообще может создать поток
  const H0 = Math.max(0, curve.h0 * af) * k * k; // напор при Q=0
  if (H0 <= 0 || Rtotal <= 0) {
    log.push("Вентилятор не создаёт напора при Q=0");
    return 0;
  }

  // Если сопротивление очень маленькое — берём Q_max
  if (Rtotal * qHi * qHi < 1) {
    log.push(`Очень малое сопротивление: Q≈${qHi.toFixed(1)}м³/с`);
    return qHi;
  }

  // Расширяем диапазон до 0 если рабочая точка ниже qMin
  // (при очень большом сопротивлении точка пересечения может быть левее qMin)
  const loStart = Rtotal * qLo * qLo > H0 ? 0.1 : qLo;
  let lo = loStart, hi = qHi;
  let Q = (lo + hi) / 2;
  for (let i = 0; i < 80; i++) {
    const Qnorm = Q / Math.max(0.01, k);
    const Hfan = Math.max(0, curve.h0 * af + curve.h1 * Qnorm + curve.h2 * Qnorm * Qnorm) * k * k;
    const Hnet = Rtotal * Q * Q;
    const diff = Hfan - Hnet;
    if (Math.abs(diff) < 0.1) break;
    if (diff > 0) lo = Q; else hi = Q;
    Q = (lo + hi) / 2;
  }
  const QfinalNorm = Q / Math.max(0.01, k);
  const Hwork = Math.max(0, curve.h0 * af + curve.h1 * QfinalNorm + curve.h2 * QfinalNorm * QfinalNorm) * k * k;
  log.push(`Разомкнутая сеть (Q-H кривая): R=${Rtotal.toFixed(4)}, Q=${Q.toFixed(2)}м³/с, H=${Hwork.toFixed(0)}Па`);
  return Q;
}

export function solveNetwork(
  nodesIn: TopoNode[],
  branchesIn: TopoBranch[],
  options: SolveOptions = {},
): SolveResult {
  const maxIter = options.maxIter ?? 300;
  const tol = options.tolerance ?? 0.01;
  const Q0 = options.initialFlow ?? 10;
  const log: string[] = [];

  const remap = (id: string): string => {
    const n = nodesIn.find((x) => x.id === id);
    return n && n.atmosphereLink ? GND : id;
  };

  // Если ветвь имеет length=0 и не помечена как ручная — пересчитываем из координат узлов
  const branchesWithLen = branchesIn.map((b) => {
    if (b.manualLength || b.length > 0) return b;
    const fromNode = nodesIn.find((n) => n.id === b.fromId);
    const toNode = nodesIn.find((n) => n.id === b.toId);
    if (!fromNode || !toNode) return b;
    const autoLen = Math.round(calcBranchLength(fromNode, toNode));
    return autoLen > 0 ? { ...b, length: autoLen } : b;
  });

  // Плотность воздуха с учётом температуры: ρ = 1.2 × 293 / (273 + T)
  const airDensity = (tempC: number): number => 1.2 * 293 / (273 + Math.max(-50, Math.min(200, tempC)));

  const branchesCalc = branchesWithLen.map((b) => {
    const fromNode = nodesIn.find((n) => n.id === b.fromId);
    const toNode = nodesIn.find((n) => n.id === b.toId);
    const T = fromNode && toNode ? (fromNode.airTemp + toNode.airTemp) / 2 : 20;
    const rho = airDensity(T);
    return recalcBranchAero({ ...b }, rho);
  });

  const edges: SolverEdge[] = branchesCalc.map((b) => {
    const fromNode = nodesIn.find((n) => n.id === b.fromId);
    const toNode = nodesIn.find((n) => n.id === b.toId);
    const T = fromNode && toNode ? (fromNode.airTemp + toNode.airTemp) / 2 : 20;
    const rho = airDensity(T);
    // Поправка на плотность для H_fan: при температуре выше нормы напор уменьшается пропорционально ρ/ρ₀
    const rhoFactor = rho / 1.2;
    return {
      id: b.id,
      a: remap(b.fromId),
      b: remap(b.toId),
      R: Math.max(0, b.resistance),
      hasFan: b.hasFan,
      fanMode: b.fanMode,
      HfanConst: b.fanPressure * rhoFactor,
      fanCurve: b.fanMode === "curve" ? getFanById(b.fanCurveId) : undefined,
      fanRpm: b.fanRpm,
      fanBladeAngle: b.fanBladeAngle,
      fanRhoFactor: rhoFactor,
      Q: 0,
    };
  });

  const allNodeIds = new Set<string>();
  edges.forEach((e) => { allNodeIds.add(e.a); allNodeIds.add(e.b); });
  const nodeList = Array.from(allNodeIds);

  if (edges.length === 0) {
    return { ok: false, iterations: 0, maxDeltaQ: 0, branches: branchesCalc, nodes: nodesIn, log: ["Нет ветвей"], cyclesCount: 0 };
  }

  // ─── Остовное дерево (BFS) ────────────────────────────────────────────
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

  const chordIdx = edges.map((_, i) => i).filter((i) => !treeEdgeIdx.has(i));
  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, хорд: ${chordIdx.length}`);

  // ─── РАЗОМКНУТАЯ СЕТЬ (нет контуров, чистое дерево) ─────────────────
  if (chordIdx.length === 0) {
    // Находим путь от вентилятора до GND (последовательное сопротивление)
    const fanIdx = edges.findIndex(e => e.hasFan);
    let Rtotal = 0;
    if (fanIdx >= 0) {
      // BFS от одного конца вентилятора до другого через граф (путь в дереве)
      const fanE = edges[fanIdx];
      // Для разомкнутой: ищем путь от атмосферы (GND) через вентилятор до другой атмосферы
      // Упрощение: суммируем R всех ветвей в пути от GND до GND через вентилятор
      // В последовательной сети это = сумма всех R
      // Но если есть разветвление — это некорректно. Для чистого дерева с одним атмосферным путём
      // используем sum всех R (все ветви последовательны по определению дерева с двумя @gnd).
      Rtotal = edges.reduce((s, e) => s + e.R, 0) - fanE.R; // R сети без вентилятора
    } else {
      Rtotal = edges.reduce((s, e) => s + e.R, 0);
    }
    const Qopen = solveOpenNetwork(edges, log, Rtotal);
    // Определяем направление потока: от источника (GND) в направлении вентилятора
    // Для дерева — все ветви несут одинаковый Q (последовательная цепь)
    edges.forEach(e => { e.Q = Qopen; });

    const branchesOut = buildOutput(branchesCalc, edges, remap, log);
    const nodesOut = buildNodePressures(nodesIn, edges, adj, treeEdgeIdx, root, remap);
    return {
      ok: Qopen > 0,
      iterations: 1,
      maxDeltaQ: 0,
      branches: branchesOut,
      nodes: nodesOut,
      log,
      cyclesCount: 0,
    };
  }

  // ─── ЗАМКНУТАЯ СЕТЬ: контуры → метод Кросса ──────────────────────────
  interface CycleEdge { edgeIdx: number; dir: 1 | -1; }
  const cycles: CycleEdge[][] = [];

  const pathInTree = (from: string, to: string): { node: string; edgeIdx: number; dir: 1 | -1 }[] => {
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
    for (let i = 0; i < upFrom.length - 1; i++) {
      const node = upFrom[i];
      const p = parent.get(node)!;
      const e = edges[p.edgeIdx];
      const dir: 1 | -1 = e.a === node ? 1 : -1;
      result.push({ node, edgeIdx: p.edgeIdx, dir });
    }
    for (let i = ancTo.length - 1; i >= 0; i--) {
      const child = ancTo[i];
      const p = parent.get(child)!;
      const e = edges[p.edgeIdx];
      const dir: 1 | -1 = e.a === p.node ? 1 : -1;
      result.push({ node: p.node, edgeIdx: p.edgeIdx, dir });
    }
    return result;
  };

  for (const cIdx of chordIdx) {
    const e = edges[cIdx];
    const cycle: CycleEdge[] = [{ edgeIdx: cIdx, dir: 1 }];
    const path = pathInTree(e.b, e.a);
    path.forEach((p) => cycle.push({ edgeIdx: p.edgeIdx, dir: p.dir }));
    cycles.push(cycle);
  }

  // ─── Умное начальное распределение Q ──────────────────────────────────
  // Используем рабочую точку вентилятора как начальное Q вместо фиксированного Q0=10.
  // Это существенно ускоряет сходимость и предотвращает расходимость при больших H.
  const fanEdgesAll = edges.filter(e => e.hasFan);
  let Q0smart = Q0;
  if (fanEdgesAll.length > 0) {
    const fan0 = fanEdgesAll[0];
    if (fan0.fanMode === "curve" && fan0.fanCurve) {
      const curve0 = fan0.fanCurve;
      const k0 = rpmFactor(fan0.fanRpm, curve0.rpmNominal);
      const af0 = getAngleFactor(curve0, fan0.fanBladeAngle);
      // Сумма R ветвей в дереве (приближённо — путь вентилятора)
      const Rtree = edges.filter((_, i) => treeEdgeIdx.has(i)).reduce((s, e) => s + e.R, 0);
      if (Rtree > 0) {
        const qHi0 = curve0.qMax * k0;
        const qLo0 = curve0.qMin * k0;
        let qEst = (qLo0 + qHi0) / 2;
        for (let bi = 0; bi < 40; bi++) {
          const Qn = qEst / Math.max(0.001, k0);
          const Hf = Math.max(0, curve0.h0 * af0 + curve0.h1 * Qn + curve0.h2 * Qn * Qn) * k0 * k0;
          const Hn = Rtree * qEst * qEst;
          const diff = Hf - Hn;
          if (Math.abs(diff) < 0.5) break;
          if (diff > 0) { qEst = (qEst + qHi0) / 2; }
          else { qEst = (qLo0 + qEst) / 2; }
        }
        Q0smart = Math.max(Q0, Math.min(qHi0, qEst));
      }
    } else if (fan0.fanMode === "constant" && fan0.HfanConst > 0) {
      const Rtree = edges.filter((_, i) => treeEdgeIdx.has(i)).reduce((s, e) => s + e.R, 0);
      if (Rtree > 0) Q0smart = Math.sqrt(fan0.HfanConst / Rtree);
    }
  }
  log.push(`Начальное Q0=${Q0smart.toFixed(2)} м³/с`);

  for (const cyc of cycles) {
    for (const ce of cyc) {
      edges[ce.edgeIdx].Q += Q0smart * ce.dir;
    }
  }
  // Убедимся что ни одна ветвь не имеет Q=0 (ломает den знаменатель)
  edges.forEach(e => { if (Math.abs(e.Q) < 0.5) e.Q = 0.5 * Math.sign(e.Q || 1); });

  // Итерации Кросса
  let iter = 0;
  let maxDelta = Infinity;
  for (; iter < maxIter; iter++) {
    maxDelta = 0;
    for (const cyc of cycles) {
      let num = 0;
      let den = 0;
      for (const ce of cyc) {
        const e = edges[ce.edgeIdx];
        const Qdir = e.Q * ce.dir;
        const { H, dH } = evalFanH(e, e.Q);
        const Hsigned = H * Math.sign(e.Q || 1) * ce.dir;
        num += e.R * Qdir * Math.abs(Qdir) - Hsigned;
        den += 2 * e.R * Math.abs(Qdir) + dH;
      }
      if (den < 1e-9) continue;
      const dQraw = -num / den;
      // Ограничиваем шаг: не более 50% от текущего характерного Q в контуре
      const Qchar = cyc.reduce((mx, ce) => Math.max(mx, Math.abs(edges[ce.edgeIdx].Q)), 0.5);
      const dQrel = Math.sign(dQraw) * Math.min(Math.abs(dQraw) * 0.85, Qchar * 0.5);
      if (Math.abs(dQrel) > maxDelta) maxDelta = Math.abs(dQrel);
      for (const ce of cyc) {
        edges[ce.edgeIdx].Q += dQrel * ce.dir;
      }
    }
    // После каждой итерации ограничиваем Q ветвей с вентилятором пределами кривой
    for (const e of edges) {
      if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
        const k = rpmFactor(e.fanRpm, e.fanCurve.rpmNominal);
        const qMaxScaled = e.fanCurve.qMax * k;
        const qMinScaled = e.fanCurve.qMin * k;
        if (Math.abs(e.Q) > qMaxScaled) e.Q = Math.sign(e.Q || 1) * qMaxScaled;
        if (Math.abs(e.Q) < qMinScaled && Math.abs(e.Q) > 0.1) e.Q = Math.sign(e.Q || 1) * qMinScaled;
      }
    }
    if (maxDelta < tol) { iter++; break; }
  }
  log.push(`Итерации: ${iter}, max|ΔQ|=${maxDelta.toExponential(2)}`);

  const branchesOut = buildOutput(branchesCalc, edges, remap, log);
  const nodesOut = buildNodePressures(nodesIn, edges, adj, treeEdgeIdx, root, remap);

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

function buildOutput(
  branchesCalc: TopoBranch[],
  edges: SolverEdge[],
  remap: (id: string) => string,
  log: string[],
): TopoBranch[] {
  return branchesCalc.map((b) => {
    const e = edges.find((x) => x.id === b.id)!;
    const aOrig = remap(b.fromId);
    const Q = e.a === aOrig ? e.Q : -e.Q;

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
    }

    const result = recalcBranchAero({
      ...b,
      flow: Q,
      fanPressure,
      fanEfficiency: fanEff,
      fanShaftPower: fanShaft,
    });

    if (b.hasFan) {
      log.push(`Вентилятор ${b.id}: Q=${Math.abs(Q).toFixed(2)}м³/с, H=${fanPressure.toFixed(0)}Па, η=${(fanEff * 100).toFixed(0)}%`);
    }

    return result;
  });
}

function buildNodePressures(
  nodesIn: TopoNode[],
  edges: SolverEdge[],
  adj: Map<string, { edgeIdx: number; other: string }[]>,
  treeEdgeIdx: Set<number>,
  root: string,
  remap: (id: string) => string,
): TopoNode[] {
  const pAtm = 101325;
  const nodePressure = new Map<string, number>();
  nodePressure.set(root, pAtm);
  const q2 = [root];
  const seen = new Set([root]);
  while (q2.length) {
    const u = q2.shift()!;
    for (const { edgeIdx, other } of (adj.get(u) ?? [])) {
      if (!seen.has(other) && treeEdgeIdx.has(edgeIdx)) {
        const e = edges[edgeIdx];
        const { H } = evalFanH(e, e.Q);
        const dP = e.R * e.Q * Math.abs(e.Q) - H * Math.sign(e.Q || 1);
        const Pu = nodePressure.get(u)!;
        const Pother = e.a === u ? Pu - dP : Pu + dP;
        nodePressure.set(other, Pother);
        seen.add(other);
        q2.push(other);
      }
    }
  }
  return nodesIn.map((n) => {
    const remappedId = n.atmosphereLink ? GND : n.id;
    const P = nodePressure.get(remappedId);
    if (P === undefined) return n;
    const Pz = P + 12 * (-n.z);
    return { ...n, computedPressure: Math.round(Pz) };
  });
}