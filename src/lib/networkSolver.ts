// ─────────────────────────────────────────────────────────────────────────────
// Решение вентиляционной сети МЕТОДОМ УЗЛОВЫХ ДАВЛЕНИЙ (Node Pressure Method)
// Используется в Ventsim/АэроСеть/VentFlow — устойчивее чем метод Кросса,
// особенно для сетей с вентиляторами и большим числом контуров.
//
// Физика:
//   Для каждой ветви a→b:    Q_ab = sgn(P_a − P_b + H_fan) · sqrt(|P_a − P_b + H_fan| / R)
//   В каждом узле i:          Σ Q_in − Σ Q_out = 0  (баланс расходов, 1-й закон Кирхгофа)
//   Атмосферные узлы:         P = 0 (опорное)
//
// Алгоритм:
//   1. Объединяем атмосферные узлы в виртуальный @gnd с P=0
//   2. Решаем систему нелинейных уравнений F_i(P) = 0 методом Ньютона-Рафсона:
//      Jacobian J_ij = ∂F_i/∂P_j  → ΔP = −J⁻¹·F  → P ← P + α·ΔP (с демпфированием)
//   3. После сходимости P → вычисляем Q по каждой ветви
//
// Преимущества перед Кроссом:
//   • не нужно строить контуры (нет проблем с топологией)
//   • квадратичная сходимость (5-10 итераций vs 50-200 у Кросса)
//   • устойчивость при вентиляторах любой мощности
//   • корректная работа для разомкнутых и замкнутых сетей одним кодом
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

  // ─── Список смежности ───────────────────────────────────────────────
  const adj = new Map<string, { edgeIdx: number; other: string }[]>();
  nodeList.forEach((n) => adj.set(n, []));
  edges.forEach((e, i) => {
    adj.get(e.a)!.push({ edgeIdx: i, other: e.b });
    adj.get(e.b)!.push({ edgeIdx: i, other: e.a });
  });

  // ─── BFS для дерева (нужно для buildNodePressures и Q0) ─────────────
  const root = nodeList.includes(GND) ? GND : nodeList[0];
  const visited = new Set<string>([root]);
  const treeEdgeIdx = new Set<number>();
  const bfsQueue = [root];
  while (bfsQueue.length) {
    const u = bfsQueue.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (!visited.has(other)) {
        visited.add(other);
        treeEdgeIdx.add(edgeIdx);
        bfsQueue.push(other);
      }
    }
  }
  const cyclesCount = edges.length - treeEdgeIdx.size;
  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, контуров: ${cyclesCount}`);

  // ════════════════════════════════════════════════════════════════════════
  // МЕТОД УЗЛОВЫХ ДАВЛЕНИЙ (Node Pressure Method, Ventsim-style)
  // ════════════════════════════════════════════════════════════════════════
  //
  // Переменные: P[i] — давление в узле i (Па). Атмосфера GND фиксируется P=0.
  // Уравнение для ветви a→b:
  //   ΔP_ab = P_a − P_b + H_fan(Q_ab)
  //   Q_ab  = sign(ΔP_ab) · sqrt(|ΔP_ab| / R)        (закон Аткинсона)
  //
  // В каждом узле i ≠ GND баланс расходов:
  //   F_i(P) = Σ Q_in − Σ Q_out = 0
  //
  // Решаем систему методом Ньютона-Рафсона:
  //   J · ΔP = −F  →  P ← P + α·ΔP
  // ════════════════════════════════════════════════════════════════════════

  // Список «свободных» узлов (без атмосферы) — для них решаем уравнения
  const freeNodes = nodeList.filter(id => id !== GND);
  const nodeIdx = new Map<string, number>();
  freeNodes.forEach((id, i) => nodeIdx.set(id, i));
  const N = freeNodes.length;

  if (N === 0) {
    // Только атмосфера — расхода нет
    edges.forEach(e => { e.Q = 0; });
    return {
      ok: true, iterations: 0, maxDeltaQ: 0,
      branches: buildOutput(branchesCalc, edges, remap, log),
      nodes: nodesIn, log, cyclesCount: 0,
    };
  }

  // Начальное приближение P: распределяем напор пропорционально расстоянию от вентилятора
  // Простая эвристика: P = ±100 Па для узлов после/до вентилятора. Уточняется итерациями.
  const P = new Float64Array(N);
  // Если есть вентилятор постоянного напора — поставим начальное P порядка H/2
  const fanEdge0 = edges.find(e => e.hasFan);
  if (fanEdge0) {
    let H0 = 0;
    if (fanEdge0.fanMode === "constant") {
      H0 = fanEdge0.HfanConst;
    } else if (fanEdge0.fanCurve) {
      const k = rpmFactor(fanEdge0.fanRpm, fanEdge0.fanCurve.rpmNominal);
      const af = getAngleFactor(fanEdge0.fanCurve, fanEdge0.fanBladeAngle);
      H0 = Math.max(0, fanEdge0.fanCurve.h0 * af) * k * k * (fanEdge0.fanRhoFactor ?? 1);
    }
    // Инициализируем все P половиной максимального напора (любой знак — найдётся итерациями)
    for (let i = 0; i < N; i++) P[i] = H0 * 0.3;
  }

  // Функция расчёта Q ветви по текущим P
  const computeQ = (e: SolverEdge): number => {
    const Pa = e.a === GND ? 0 : P[nodeIdx.get(e.a)!];
    const Pb = e.b === GND ? 0 : P[nodeIdx.get(e.b)!];
    // Используем H_fan вычисленный по предыдущему Q (для устойчивости)
    const { H } = evalFanH(e, e.Q);
    const dP = Pa - Pb + H;
    const R = Math.max(1e-6, e.R);
    return Math.sign(dP) * Math.sqrt(Math.abs(dP) / R);
  };

  // |dQ/dP| = 1/(2·sqrt(R·|ΔP|)) — модуль производной для якобиана
  const computeDQDP = (e: SolverEdge): number => {
    const Pa = e.a === GND ? 0 : P[nodeIdx.get(e.a)!];
    const Pb = e.b === GND ? 0 : P[nodeIdx.get(e.b)!];
    const { H } = evalFanH(e, e.Q);
    const dP = Pa - Pb + H;
    const R = Math.max(1e-6, e.R);
    const absdP = Math.max(1e-3, Math.abs(dP));   // защита от деления на 0
    return 1 / (2 * Math.sqrt(R * absdP));
  };

  // ─── Итерации Ньютона ────────────────────────────────────────────────
  let iter = 0;
  let maxDelta = Infinity;
  let maxDeltaQ = 0;

  for (; iter < maxIter; iter++) {
    // 1) Обновить Q всех ветвей по текущим P
    for (const e of edges) {
      const Qnew = computeQ(e);
      if (isFinite(Qnew)) e.Q = Qnew;
    }

    // 2) Вычислить невязки F_i = Σ Q (с учётом знака: + если Q входит, − если выходит)
    const F = new Float64Array(N);
    for (const e of edges) {
      if (e.a !== GND) {
        const i = nodeIdx.get(e.a)!;
        F[i] -= e.Q;                          // Q уходит из e.a
      }
      if (e.b !== GND) {
        const i = nodeIdx.get(e.b)!;
        F[i] += e.Q;                          // Q приходит в e.b
      }
    }

    // 3) Якобиан: J[i][j] = ∂F_i/∂P_j
    //    Только ветви, соединяющие i с j (или i с GND) дают вклад.
    //    Для ветви a→b: ∂Q_ab/∂P_a = +dQdP, ∂Q_ab/∂P_b = −dQdP
    //    Используем разрежённое представление (для скорости — плотная матрица если N мало)
    const J: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (const e of edges) {
      const dqdp = computeDQDP(e);
      const ai = e.a === GND ? -1 : nodeIdx.get(e.a)!;
      const bi = e.b === GND ? -1 : nodeIdx.get(e.b)!;
      // F_a -= Q  → ∂F_a/∂P_a = −∂Q/∂P_a = −dqdp ;  ∂F_a/∂P_b = +dqdp
      // F_b += Q  → ∂F_b/∂P_a = +dqdp           ;  ∂F_b/∂P_b = −dqdp
      if (ai >= 0) {
        J[ai][ai] -= dqdp;
        if (bi >= 0) J[ai][bi] += dqdp;
      }
      if (bi >= 0) {
        J[bi][bi] -= dqdp;
        if (ai >= 0) J[bi][ai] += dqdp;
      }
    }

    // Регуляризация диагонали (численная устойчивость)
    for (let i = 0; i < N; i++) {
      if (Math.abs(J[i][i]) < 1e-9) J[i][i] = -1e-6;
    }

    // 4) Решаем J · ΔP = −F методом Гаусса (для N до ~500 это быстро)
    const dP = solveLinearSystem(J, F.map(v => -v));
    if (!dP) {
      log.push(`Итерация ${iter}: вырожденная система — остановка`);
      break;
    }

    // 5) Демпфирование: ограничиваем |ΔP| чтобы избежать выбросов
    const dampMax = 5000; // Па за итерацию
    let alpha = 1.0;
    let maxDp = 0;
    for (let i = 0; i < N; i++) if (Math.abs(dP[i]) > maxDp) maxDp = Math.abs(dP[i]);
    if (maxDp > dampMax) alpha = dampMax / maxDp;

    // 6) Обновление давлений
    let maxDpStep = 0;
    for (let i = 0; i < N; i++) {
      const step = alpha * dP[i];
      P[i] += step;
      if (Math.abs(step) > maxDpStep) maxDpStep = Math.abs(step);
    }

    // 7) Проверка сходимости по невязке расхода в узлах
    maxDelta = 0;
    for (let i = 0; i < N; i++) if (Math.abs(F[i]) > maxDelta) maxDelta = Math.abs(F[i]);
    maxDeltaQ = maxDelta;

    if (maxDelta < tol && maxDpStep < 1) { iter++; break; }
  }
  log.push(`Итерации (Ньютон): ${iter}, max|ΔQ_узел|=${maxDelta.toExponential(2)} м³/с`);

  // Финальный пересчёт Q
  for (const e of edges) {
    const Qnew = computeQ(e);
    if (isFinite(Qnew)) e.Q = Qnew;
  }

  // Ограничиваем Q вентиляторов в рамках кривой
  for (const e of edges) {
    if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
      const k = rpmFactor(e.fanRpm, e.fanCurve.rpmNominal);
      const qMaxScaled = e.fanCurve.qMax * k;
      if (Math.abs(e.Q) > qMaxScaled) e.Q = Math.sign(e.Q || 1) * qMaxScaled;
    }
  }

  // Используем _ для опций, чтобы не было «unused»
  void Q0;

  const branchesOut = buildOutput(branchesCalc, edges, remap, log);
  const nodesOut = buildNodePressures(nodesIn, edges, adj, treeEdgeIdx, root, remap);

  void maxDeltaQ;

  return {
    ok: maxDelta < Math.max(tol, 1.0),  // допуск 1 м³/с в узле для «сошёлся»
    iterations: iter,
    maxDeltaQ: maxDelta,
    branches: branchesOut,
    nodes: nodesOut,
    log,
    cyclesCount: cyclesCount,
  };
}

// ─── Решение системы линейных уравнений A·x = b методом Гаусса ──────────────
// Возвращает x или null если система вырождена.
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Создаём расширенную матрицу
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    // Поиск главного элемента (частичная пивотизация)
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > maxVal) {
        maxVal = Math.abs(M[k][i]);
        maxRow = k;
      }
    }
    if (maxVal < 1e-12) return null; // вырожденная
    if (maxRow !== i) [M[i], M[maxRow]] = [M[maxRow], M[i]];

    // Прямой ход
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }

  // Обратный ход
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
    if (!isFinite(x[i])) return null;
  }
  return x;
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
    let Q = e.a === aOrig ? e.Q : -e.Q;
    // Защита от NaN/Infinity после итераций
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
        // Депрессия от a к b: dP = R·Q·|Q| − H_fan (H_fan создаёт прирост давления вдоль a→b)
        const dP = e.R * e.Q * Math.abs(e.Q) - H;
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