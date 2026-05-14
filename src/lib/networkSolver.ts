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
  /** Диагностика проблем в сети (для UI «инспектор расчёта») */
  diagnostics?: SolveDiagnostic[];
}

export interface SolveDiagnostic {
  level: "error" | "warning" | "info";
  category: "topology" | "node_balance" | "branch_flow" | "fan" | "convergence";
  message: string;
  /** ID связанного объекта (узла или ветви) */
  objectId?: string;
  /** Значение для отображения */
  value?: number;
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
      // Минимальное R = 1e-4 Нс²/м⁸: защита от деления на 0 при нулевом сопротивлении
      R: Math.max(1e-4, b.resistance),
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

  // Вычисляет ΔP и Q ветви по текущим P.
  // Знак Q: положительный — поток от a к b (по ветви).
  // Вентилятор всегда нагнетает в направлении a→b (если airDirection не reverse).
  // Поэтому H_fan суммируется с (P_a − P_b) — увеличивает движущую силу в +направлении.
  const computeQ = (e: SolverEdge): number => {
    const Pa = e.a === GND ? 0 : P[nodeIdx.get(e.a)!];
    const Pb = e.b === GND ? 0 : P[nodeIdx.get(e.b)!];
    // H_fan: используем абс. значение, так как evalFanH(|Q|) > 0
    const { H } = evalFanH(e, e.Q);
    // Движущая сила = разность давлений + напор вентилятора (в направлении a→b)
    const dP = (Pa - Pb) + H;
    const R = Math.max(1e-6, e.R);
    return Math.sign(dP) * Math.sqrt(Math.abs(dP) / R);
  };

  // |dQ/dP_a| = 1/(2·sqrt(R·|ΔP|)) — модуль производной для якобиана.
  // ∂Q/∂P_a = +dqdp,  ∂Q/∂P_b = −dqdp.
  // Вклад H_fan (зависит от Q) даёт неявную связь — учитывается итерациями.
  const computeDQDP = (e: SolverEdge): number => {
    const Pa = e.a === GND ? 0 : P[nodeIdx.get(e.a)!];
    const Pb = e.b === GND ? 0 : P[nodeIdx.get(e.b)!];
    const { H } = evalFanH(e, e.Q);
    const dP = (Pa - Pb) + H;
    const R = Math.max(1e-6, e.R);
    // защита: при ΔP→0 производная → ∞, ограничиваем разумным значением
    const absdP = Math.max(0.5, Math.abs(dP));
    return 1 / (2 * Math.sqrt(R * absdP));
  };

  // Вычисление нормы невязки баланса узлов
  const computeResidual = (): { F: Float64Array; maxF: number } => {
    const F = new Float64Array(N);
    for (const e of edges) {
      const Q = computeQ(e);
      if (!isFinite(Q)) continue;
      if (e.a !== GND) F[nodeIdx.get(e.a)!] -= Q;
      if (e.b !== GND) F[nodeIdx.get(e.b)!] += Q;
    }
    let maxF = 0;
    for (let i = 0; i < N; i++) if (Math.abs(F[i]) > maxF) maxF = Math.abs(F[i]);
    return { F, maxF };
  };

  // ─── Итерации Ньютона с line-search ──────────────────────────────────
  let iter = 0;
  let maxDelta = Infinity;
  let prevMaxF = Infinity;

  for (; iter < maxIter; iter++) {
    // 1) Обновить Q всех ветвей по текущим P
    for (const e of edges) {
      const Qnew = computeQ(e);
      if (isFinite(Qnew)) e.Q = Qnew;
    }

    // 2) Невязка баланса узлов
    const { F, maxF } = computeResidual();

    if (maxF < tol) { iter++; maxDelta = maxF; break; }

    // 3) Якобиан J[i][j] = ∂F_i/∂P_j (плотный, для N до ~500)
    const J: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
    for (const e of edges) {
      const dqdp = computeDQDP(e);
      const ai = e.a === GND ? -1 : nodeIdx.get(e.a)!;
      const bi = e.b === GND ? -1 : nodeIdx.get(e.b)!;
      // F_a -= Q  → ∂F_a/∂P_a = −dqdp,  ∂F_a/∂P_b = +dqdp
      // F_b += Q  → ∂F_b/∂P_a = +dqdp,  ∂F_b/∂P_b = −dqdp
      if (ai >= 0) {
        J[ai][ai] -= dqdp;
        if (bi >= 0) J[ai][bi] += dqdp;
      }
      if (bi >= 0) {
        J[bi][bi] -= dqdp;
        if (ai >= 0) J[bi][ai] += dqdp;
      }
    }

    // Регуляризация диагонали: добавляем (-eps) к диагонали (J ist симм.отриц.определённая)
    for (let i = 0; i < N; i++) {
      if (Math.abs(J[i][i]) < 1e-9) J[i][i] = -1e-6;
    }

    // 4) Решаем J · ΔP = −F
    const dP = solveLinearSystem(J, F.map(v => -v));
    if (!dP) {
      log.push(`Итерация ${iter}: вырожденная система — остановка`);
      maxDelta = maxF;
      break;
    }

    // 5) Глобальное демпфирование шага по максимальному ΔP
    const dampMax = 8000; // Па за итерацию
    let alpha = 1.0;
    let maxDpRaw = 0;
    for (let i = 0; i < N; i++) if (Math.abs(dP[i]) > maxDpRaw) maxDpRaw = Math.abs(dP[i]);
    if (maxDpRaw > dampMax) alpha = dampMax / maxDpRaw;

    // 6) Line-search: пробуем шаг, если невязка увеличилась — уменьшаем α
    const Pbackup = new Float64Array(P);
    let accepted = false;
    for (let trial = 0; trial < 6; trial++) {
      // Восстанавливаем и применяем α·ΔP
      for (let i = 0; i < N; i++) P[i] = Pbackup[i] + alpha * dP[i];
      // Защита: P не должно быть бесконечным
      let okP = true;
      for (let i = 0; i < N; i++) if (!isFinite(P[i])) { okP = false; break; }
      if (!okP) { alpha *= 0.5; continue; }

      // Пересчитываем Q и невязку
      for (const e of edges) {
        const Qnew = computeQ(e);
        if (isFinite(Qnew)) e.Q = Qnew;
      }
      const { maxF: newMaxF } = computeResidual();
      // Принимаем шаг если невязка не выросла больше чем в 2 раза
      if (newMaxF < prevMaxF * 2 || newMaxF < tol * 10) {
        prevMaxF = newMaxF;
        accepted = true;
        break;
      }
      alpha *= 0.5; // уменьшаем шаг
    }
    if (!accepted) {
      // Не приняли шаг — откатываемся и берём микроскопический
      for (let i = 0; i < N; i++) P[i] = Pbackup[i] + 0.01 * dP[i];
      prevMaxF = maxF;
    }

    maxDelta = maxF;
    if (alpha * maxDpRaw < 0.1 && maxF < Math.max(tol * 10, 1.0)) { iter++; break; }
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

  void Q0;

  const branchesOut = buildOutput(branchesCalc, edges, remap, log);
  const nodesOut = buildNodePressures(nodesIn, edges, adj, treeEdgeIdx, root, remap);

  // ─── ДИАГНОСТИКА: ищем проблемные узлы и ветви ──────────────────────
  const diagnostics: SolveDiagnostic[] = [];

  // 1) Дисбаланс в узлах (нарушение 1-го закона Кирхгофа)
  const nodeBalance = new Map<string, number>();
  for (const e of edges) {
    if (e.a !== GND) nodeBalance.set(e.a, (nodeBalance.get(e.a) ?? 0) - e.Q);
    if (e.b !== GND) nodeBalance.set(e.b, (nodeBalance.get(e.b) ?? 0) + e.Q);
  }
  nodeBalance.forEach((bal, nodeId) => {
    if (Math.abs(bal) > 1.0) {
      diagnostics.push({
        level: Math.abs(bal) > 10 ? "error" : "warning",
        category: "node_balance",
        message: `Дисбаланс в узле ${nodeId}: ΔQ = ${bal.toFixed(2)} м³/с`,
        objectId: nodeId,
        value: bal,
      });
    }
  });

  // 2) Ветви с подозрительно высоким Q (>250 м³/с типично для аварии)
  for (const b of branchesOut) {
    const Q = Math.abs(b.flow);
    if (Q > 300) {
      diagnostics.push({
        level: "error",
        category: "branch_flow",
        message: `Аномально высокий расход в ветви ${b.id}: Q = ${Q.toFixed(1)} м³/с`,
        objectId: b.id,
        value: Q,
      });
    } else if (Q > 200 && b.area < 8) {
      diagnostics.push({
        level: "warning",
        category: "branch_flow",
        message: `Превышение V в ${b.id}: V = ${b.velocity.toFixed(1)} м/с (сечение ${b.area.toFixed(1)} м²)`,
        objectId: b.id,
        value: b.velocity,
      });
    }
    // Превышение допустимой скорости
    if (b.vMax > 0 && b.velocity > b.vMax) {
      diagnostics.push({
        level: "warning",
        category: "branch_flow",
        message: `Скорость ${b.velocity.toFixed(1)} м/с в ветви ${b.id} превышает V_max=${b.vMax}`,
        objectId: b.id,
        value: b.velocity,
      });
    }
  }

  // 3) Вентилятор работает за пределами кривой
  for (const e of edges) {
    if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
      const k = rpmFactor(e.fanRpm, e.fanCurve.rpmNominal);
      const Q = Math.abs(e.Q);
      const qMin = e.fanCurve.qMin * k;
      const qMax = e.fanCurve.qMax * k;
      if (Q < qMin * 0.95) {
        diagnostics.push({
          level: "warning",
          category: "fan",
          message: `Вентилятор ${e.id} в зоне помпажа: Q=${Q.toFixed(1)} < Q_min=${qMin.toFixed(1)} м³/с`,
          objectId: e.id, value: Q,
        });
      } else if (Q > qMax * 0.98) {
        diagnostics.push({
          level: "warning",
          category: "fan",
          message: `Вентилятор ${e.id} на пределе: Q=${Q.toFixed(1)} ≈ Q_max=${qMax.toFixed(1)} м³/с`,
          objectId: e.id, value: Q,
        });
      }
    }
  }

  // 4) Сходимость
  if (maxDelta > Math.max(tol, 1.0)) {
    diagnostics.push({
      level: "error",
      category: "convergence",
      message: `Расчёт не сошёлся: max|ΔQ| = ${maxDelta.toFixed(2)} м³/с (норма < ${tol})`,
      value: maxDelta,
    });
  }

  // 5) Изолированные подсети (не достижимые от GND)
  const reachable = new Set<string>([root]);
  const stack = [root];
  while (stack.length) {
    const u = stack.pop()!;
    for (const { other } of adj.get(u) ?? []) {
      if (!reachable.has(other)) { reachable.add(other); stack.push(other); }
    }
  }
  if (reachable.size < nodeList.length) {
    const isolated = nodeList.filter(n => !reachable.has(n)).slice(0, 5);
    diagnostics.push({
      level: "error",
      category: "topology",
      message: `Изолированные узлы (нет связи с атмосферой): ${isolated.join(", ")}${isolated.length === 5 ? "..." : ""}`,
    });
  }

  // 6) Нет ни одного вентилятора
  if (!edges.some(e => e.hasFan)) {
    diagnostics.push({
      level: "warning",
      category: "topology",
      message: "В сети нет ни одного вентилятора — поток будет нулевым",
    });
  }

  return {
    ok: maxDelta < Math.max(tol, 1.0),
    iterations: iter,
    maxDeltaQ: maxDelta,
    branches: branchesOut,
    nodes: nodesOut,
    log,
    cyclesCount: cyclesCount,
    diagnostics,
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