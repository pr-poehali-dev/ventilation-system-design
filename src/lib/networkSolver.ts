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
//            ΔH_k = Σ_{i∈k} R_i·Q_i^(n)·|Q_i^(n)|  −  Σ_{f∈k} H_f(Q_i^(n)) · dir_i
//            δQ_k = −ΔH_k / (2·Σ_{i∈k} R_i·|Q_i^(n)|)
//            Q_i^(n+1) = Q_i^(n) + δQ_k · dir_i
//   Шаг 6. Критерий остановки: max|ΔH_k| < ε1 (0.1 Па) ИЛИ max|δQ_k| < ε2 (0.01 м³/с).
//   Шаг 7. Проверка устойчивости: баланс узлов, соответствие H(Q) вентиляторов.
//
// КЛЮЧЕВЫЕ СОГЛАШЕНИЯ:
//   - e.Q > 0: ток течёт в направлении a→b
//   - dir = +1: ребро обходится по a→b; dir = -1: по b→a
//   - Вентилятор всегда нагнетает в направлении a→b (H > 0 при Q > 0)
//   - balance[v] = Σ Q_входящих_в_v − Σ Q_выходящих_из_v
// =============================================================================

import type { TopoNode, TopoBranch } from "./topology";
import { recalcBranchAero, calcBranchLength } from "./topology";
import { getFanById, fanEfficiency, fanShaftPower, type FanCurve } from "./fanCurves";

const GND_ID   = "@gnd";
const EPS1     = 0.1;       // Па
const EPS2     = 0.01;      // м³/с
const MAX_ITER = 2000;
const MIN_R    = 1e-9;

interface Edge {
  id:             string;
  a:              string;
  b:              string;
  R:              number;
  Q:              number;
  hasFan:         boolean;
  fanMode:        "constant" | "curve";
  fanH0:          number;      // Па (не масштабированный на rho!)
  fanCurve?:      FanCurve;
  fanRpm?:        number;
  fanBladeAngle?: number;
  fanRhoFactor:   number;
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
// Вентилятор
// =============================================================================

function angleFactor(c: FanCurve, angle?: number): number {
  if (!c.bladeAngles || c.bladeAngles.length < 2) return 1;
  const lo = c.bladeAngles[0];
  const hi = c.bladeAngles[c.bladeAngles.length - 1];
  const a  = Math.min(hi, Math.max(lo, angle ?? (lo + hi) / 2));
  return 0.65 + ((a - lo) / Math.max(1, hi - lo)) * 0.70;
}

/**
 * Напор вентилятора H(|Q|) в Па.
 * Вентилятор нагнетает по направлению a→b ребра.
 * Q передаётся как e.Q (может быть отрицательным, берём |Q| для H(Q)).
 */
function fanH(e: Edge, Q: number): number {
  if (!e.hasFan) return 0;

  if (e.fanMode === "constant") {
    // fanH0 хранится в Па напрямую, rhoFactor уже применяем здесь
    return Math.max(0, e.fanH0 * e.fanRhoFactor);
  }

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

/** |dH/dQ| для уточнения знаменателя δQ. */
function fanDH(e: Edge, Q: number): number {
  if (!e.hasFan || e.fanMode !== "curve" || !e.fanCurve) return 0;
  const c  = e.fanCurve;
  const k  = (e.fanRpm && c.rpmNominal > 0) ? e.fanRpm / c.rpmNominal : 1;
  const Qn = Math.abs(Q) / Math.max(0.001, k);
  return Math.abs((c.h1 + 2 * c.h2 * Qn) * k * e.fanRhoFactor);
}

/** Оценка рабочей точки вентилятора методом бисекции H_вент(Q) = R_сети·Q². */
function estimateQ0(edges: Edge[], Rtotal: number): number {
  const fan = edges.find(e => e.hasFan);
  if (!fan) return 5;

  const H0 = fanH(fan, 0);  // максимальный напор (при Q=0)

  if (fan.fanMode === "constant") {
    if (H0 > 0 && Rtotal > 0) return Math.sqrt(H0 / Rtotal);
    return 5;
  }

  if (fan.fanMode === "curve" && fan.fanCurve) {
    const c   = fan.fanCurve;
    const k   = (fan.fanRpm && c.rpmNominal > 0) ? fan.fanRpm / c.rpmNominal : 1;
    const qHi = c.qMax * k;
    if (Rtotal <= 0) return (c.qMin + c.qMax) / 2 * k;

    let lo = 0, hi = qHi;
    for (let i = 0; i < 80; i++) {
      const q  = (lo + hi) / 2;
      const Hf = fanH(fan, q);
      const Hn = Rtotal * q * q;
      if (Math.abs(Hf - Hn) < 0.05) return Math.max(0.1, q);
      if (Hf > Hn) lo = q; else hi = q;
    }
    return Math.max(0.1, (lo + hi) / 2);
  }

  return 5;
}

// =============================================================================
// Путь между двумя узлами по остовному дереву (через LCA)
// Возвращает список рёбер с направлениями dir (1 = a→b, -1 = b→a)
// =============================================================================

function treePath(
  from:   string,
  to:     string,
  edges:  Edge[],
  parent: Map<string, { node: string; edgeIdx: number } | null>,
): ContourEdge[] {
  // Собираем цепочку предков от узла до корня
  const ancestors = (start: string): string[] => {
    const list: string[] = [];
    let cur: string | null = start;
    while (cur !== null) {
      list.push(cur);
      const p = parent.get(cur);
      cur = p ? p.node : null;
    }
    return list;
  };

  const ancsFrom = ancestors(from);
  const ancsTo   = ancestors(to);
  const setFrom  = new Map(ancsFrom.map((n, i) => [n, i]));

  // Найти LCA
  let lca   = ancsTo[0];
  let idxTo = 0;
  for (let i = 0; i < ancsTo.length; i++) {
    if (setFrom.has(ancsTo[i])) { lca = ancsTo[i]; idxTo = i; break; }
  }
  const idxFrom = setFrom.get(lca) ?? 0;

  const result: ContourEdge[] = [];

  // Участок from → LCA: идём вверх по дереву (node → parent(node))
  for (let i = 0; i < idxFrom; i++) {
    const node = ancsFrom[i];          // текущий узел (движемся из него вверх)
    const p    = parent.get(node)!;    // родитель
    const e    = edges[p.edgeIdx];
    // Движение: node → p.node
    // Ребро e ориентировано a→b. Если node === e.a, мы идём a→b → dir=+1
    // Если node === e.b, мы идём b→a → dir=-1
    result.push({ edgeIdx: p.edgeIdx, dir: (e.a === node ? -1 : 1) as 1 | -1 });
    // ВАЖНО: dir здесь — это направление ДВИЖЕНИЯ по пути от from к to.
    // Для включения в контур: from→LCA мы идём ВВЕРХ.
    // e.a === node означает, что ребро направлено node→p.node (совпадает с движением),
    // НО в контуре для формулы ΔH нам нужно направление ребра относительно обхода контура:
    // обход контура идёт: хорда(a→b) + путь(b→...→a).
    // Участок "from→LCA" соответствует пути из b хорды к LCA, т.е. мы идём ВВЕРХ.
    // Если ребро e.a=node, e.b=p.node → мы идём a→b → относительно обхода dir=+1... 
    // Нет, разберём чётко:
    // Контур обходится: хорда a→b (dir=+1), затем b→...→a через дерево.
    // from=e_хорды.b, to=e_хорды.a.
    // Первый участок: from(=b_хорды) → LCA. Движение: узел за узлом вверх.
    // dir_i в контуре = направление движения по ребру i при обходе контура.
    // e.a===node: ребро ориентировано node→pNode, обход идёт node→pNode → dir=+1.
    // Корректируем: убираем неверный комментарий выше, правильно dir:
  }

  // Исправляем: перезаписываем result с правильными знаками
  // Очищаем и делаем заново чисто:
  result.length = 0;

  // from → LCA (движемся вверх: node → parent)
  for (let i = 0; i < idxFrom; i++) {
    const node = ancsFrom[i];
    const p    = parent.get(node)!;
    const e    = edges[p.edgeIdx];
    // Движение при обходе контура: из node в p.node
    // Ребро e: a→b. Если e.a === node → движение совпадает с a→b → dir = +1
    //                Если e.b === node → движение b→a → dir = -1
    result.push({ edgeIdx: p.edgeIdx, dir: (e.a === node ? 1 : -1) as 1 | -1 });
  }

  // LCA → to (движемся вниз: p.node → child)
  for (let i = idxTo - 1; i >= 0; i--) {
    const child = ancsTo[i];
    const p     = parent.get(child)!;
    const e     = edges[p.edgeIdx];
    // Движение при обходе контура: из p.node в child
    // Если e.a === p.node → движение a→b → dir = +1
    // Если e.b === p.node → движение b→a → dir = -1
    result.push({ edgeIdx: p.edgeIdx, dir: (e.a === p.node ? 1 : -1) as 1 | -1 });
  }

  return result;
}

// =============================================================================
// Узловой баланс (1-й закон Кирхгофа): balance[v] = Σ Q_вх − Σ Q_вых
// Знаки: если e.Q > 0 (ток a→b): отток из a (−), приток в b (+).
// =============================================================================

function computeBalance(edges: Edge[], nodeList: string[]): Map<string, number> {
  const bal = new Map<string, number>();
  for (const n of nodeList) bal.set(n, 0);
  for (const e of edges) {
    bal.set(e.a, (bal.get(e.a) ?? 0) - e.Q);   // отток из a
    bal.set(e.b, (bal.get(e.b) ?? 0) + e.Q);   // приток в b
  }
  return bal;
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

  // Длины из координат (если не вручную)
  const brWithLen = branchesIn.map(b => {
    if (b.manualLength && b.length > 0) return b;
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    if (!fn || !tn) return b;
    const len = Math.round(calcBranchLength(fn, tn));
    return len > 0 ? { ...b, length: len } : b;
  });

  // ШАГ 3. Пересчёт сопротивлений R = α·P·L / S³
  const airRho = (T: number) => 1.2 * 293 / (273 + Math.max(-50, Math.min(200, T)));

  const brCalc = brWithLen.map(b => {
    const fn = nodesIn.find(n => n.id === b.fromId);
    const tn = nodesIn.find(n => n.id === b.toId);
    const T  = (fn && tn) ? (fn.airTemp + tn.airTemp) / 2 : 20;
    return recalcBranchAero({ ...b }, airRho(T));
  });

  // Строим рёбра графа
  const edges: Edge[] = brCalc.map(b => {
    const fn  = nodesIn.find(n => n.id === b.fromId);
    const tn  = nodesIn.find(n => n.id === b.toId);
    const T   = (fn && tn) ? (fn.airTemp + tn.airTemp) / 2 : 20;
    const rho = airRho(T) / 1.2;   // поправочный коэффициент плотности
    return {
      id:            b.id,
      a:             toGnd(b.fromId),
      b:             toGnd(b.toId),
      R:             Math.max(MIN_R, b.resistance),
      Q:             0,
      hasFan:        b.hasFan,
      fanMode:       b.fanMode,
      // FIX: fanH0 хранить в Па (не умножать на rho здесь — fanH() применяет rhoFactor)
      fanH0:         b.fanPressure,
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

  // Проверка: GND должен быть подключён минимум к 2 рёбрам (степень ≥ 2).
  // Если только 1 выход на поверхность — замкнутого контура нет, Q = 0.
  const atmCount = nodesIn.filter(n => n.atmosphereLink).length;
  const gndDegree = edges.filter(e => e.a === GND_ID || e.b === GND_ID).length;
  if (atmCount === 0 || (atmCount > 0 && gndDegree < 2)) {
    const zeroBranches = brCalc.map(b => ({ ...b, flow: 0, velocity: 0, dP: 0 }));
    const diag: SolveDiagnostic[] = [{
      level: "error",
      category: "topology",
      message: atmCount === 0
        ? "Нет узлов, связанных с атмосферой. Добавьте минимум 2 поверхностных узла (входной и выходной стволы)."
        : "Только один узел связан с атмосферой. Для циркуляции воздуха нужно минимум 2 выхода на поверхность (например, два ствола).",
    }];
    return {
      ok: false, iterations: 0, maxDeltaQ: 0, maxDeltaH: 0,
      branches: zeroBranches, nodes: nodesIn,
      log: ["Ошибка топологии: нет замкнутого контура через атмосферу — расход Q=0"],
      cyclesCount: 0, diagnostics: diag,
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

  const parent   = new Map<string, { node: string; edgeIdx: number } | null>();
  const visited  = new Set<string>([root]);
  const treeSet  = new Set<number>();
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

  const chords = edges.map((_, i) => i).filter(i => !treeSet.has(i));
  const bfsPos = new Map(bfsOrder.map((n, i) => [n, i]));

  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, контуров: ${chords.length}`);

  // Если нет ни одного замкнутого контура — сеть разомкнута, Q = 0 везде.
  if (chords.length === 0) {
    const zeroBranches = brCalc.map(b => ({ ...b, flow: 0, velocity: 0, dP: 0 }));
    return {
      ok: false, iterations: 0, maxDeltaQ: 0, maxDeltaH: 0,
      branches: zeroBranches, nodes: nodesIn,
      log: [...log, "Нет замкнутых контуров — циркуляция невозможна, Q=0"],
      cyclesCount: 0,
      diagnostics: [{
        level: "error",
        category: "topology",
        message: "Сеть не имеет замкнутых контуров — циркуляция воздуха невозможна. Проверьте топологию: нужно минимум 2 выхода на поверхность, образующих замкнутый путь.",
      }],
    };
  }

  // Контуры: хорда (dir=+1, обход a→b) + путь в дереве от e.b обратно к e.a
  const contours: ContourEdge[][] = chords.map(cIdx => {
    const e = edges[cIdx];
    const path = treePath(e.b, e.a, edges, parent);
    return [{ edgeIdx: cIdx, dir: 1 as const }, ...path];
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 2. ИНИЦИАЛИЗАЦИЯ Q^(0)
  // Все ветви получают Q0 (>0) в направлении «от корня к листьям» по BFS-дереву.
  // Хорды также получают Q0 (в направлении a→b, т.е. e.Q = Q0 > 0).
  // ──────────────────────────────────────────────────────────────────────────

  // Суммарное R только дерева (приблизительно путь вентилятор→атмосфера)
  const Rtree = edges.filter((_, i) => treeSet.has(i)).reduce((s, e) => s + e.R, 0);
  const Q0    = Math.max(0.1, estimateQ0(edges, Rtree));
  log.push(`Q₀ = ${Q0.toFixed(2)} м³/с`);

  edges.forEach((e, i) => {
    if (!treeSet.has(i)) {
      // Хорда — Q0 в направлении a→b
      e.Q = Q0;
    } else {
      // Ветвь дерева — Q0 в направлении от корня (меньший bfsPos) к листу (больший)
      const posA = bfsPos.get(e.a) ?? 1e9;
      const posB = bfsPos.get(e.b) ?? 1e9;
      // posB > posA → b дальше от корня → e.Q > 0 (ток от a к b)
      e.Q = posB > posA ? Q0 : -Q0;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 5. ИТЕРАЦИОННЫЙ ПРОЦЕСС МКР
  //
  // Формулы (строго из методики):
  //   Qd_i = Q_i · dir_i   (расход в направлении обхода контура)
  //
  //   ΔH_k = Σ_{i∈k} [R_i · Qd_i · |Qd_i|  −  H_f_i · dir_i · sign(Q_i)]
  //
  //   Примечание о знаке вентилятора:
  //   Вентилятор нагнетает в направлении a→b (e.Q > 0 → H > 0).
  //   В контуре вентилятор вычитается из ΔH, если он "помогает" обходу:
  //     - dir=+1 и Q>0: вентилятор совпадает с обходом → вычитаем H → num -= H·(+1)
  //     - dir=+1 и Q<0: вентилятор против тока, т.е. против обхода → num -= (-H)·(+1)? 
  //   Правильная форма (Кросс): num += R·Qd·|Qd| − H·sign(Q)·dir
  //   Что упрощается до: H_contrib = H·sign(Q)·dir  (вычитается из num)
  //
  //   δQ_k = −ΔH_k / (2·Σ_{i∈k} R_i·|Qd_i|  +  Σ_{f∈k} |dH_f/dQ_f|)
  //
  //   Q_i ← Q_i + δQ_k · dir_i
  // ──────────────────────────────────────────────────────────────────────────

  let maxDeltaQ = Infinity;
  let maxDeltaH = Infinity;
  let iter      = 0;

  for (; iter < maxIter; iter++) {
    maxDeltaQ = 0;
    maxDeltaH = 0;

    for (const contour of contours) {
      let num = 0;
      let den = 0;

      for (const { edgeIdx, dir } of contour) {
        const e  = edges[edgeIdx];
        const Qd = e.Q * dir;           // расход в направлении обхода
        const H  = fanH(e, e.Q);       // напор вентилятора (≥ 0, в направлении a→b)

        // Потеря напора вдоль ребра (в направлении обхода)
        num += e.R * Qd * Math.abs(Qd);

        // Вклад вентилятора: H нагнетает в a→b.
        // При dir=+1: ток обхода совпадает с a→b → вентилятор уменьшает ΔH → вычитаем H
        // При dir=-1: ток обхода против a→b → вентилятор добавляет ΔH → прибавляем H
        // Итого: num -= H * dir  (работает для обоих случаев)
        num -= H * dir;

        den += 2 * e.R * Math.abs(Qd) + fanDH(e, e.Q);
      }

      if (den < 1e-12) continue;

      const dQ = -num / den;

      if (Math.abs(num) > maxDeltaH) maxDeltaH = Math.abs(num);
      if (Math.abs(dQ)  > maxDeltaQ) maxDeltaQ = Math.abs(dQ);

      // Обновляем Q всех рёбер контура
      for (const { edgeIdx, dir } of contour) {
        edges[edgeIdx].Q += dQ * dir;
      }
    }

    // Защита от NaN
    for (const e of edges) {
      if (!isFinite(e.Q)) e.Q = 0;
    }

    // Ограничение Q вентилятора диапазоном кривой
    for (const e of edges) {
      if (e.hasFan && e.fanMode === "curve" && e.fanCurve) {
        const k    = (e.fanRpm && e.fanCurve.rpmNominal > 0) ? e.fanRpm / e.fanCurve.rpmNominal : 1;
        const qMax = e.fanCurve.qMax * k;
        if (Math.abs(e.Q) > qMax) e.Q = Math.sign(e.Q || 1) * qMax;
      }
    }

    // ШАГ 6. Критерий остановки
    if (maxDeltaH < eps1 || maxDeltaQ < eps2) { iter++; break; }
  }

  log.push(`Итерации: ${iter}, max|ΔH|=${maxDeltaH.toFixed(3)} Па, max|δQ|=${maxDeltaQ.toFixed(4)} м³/с`);

  // ──────────────────────────────────────────────────────────────────────────
  // ПЕРЕСЧЁТ Q ВЕТВЕЙ ДЕРЕВА по 1-му закону Кирхгофа (bottom-up)
  //
  // ВАЖНО: МКР итерирует только по контурам (хордам). Q хорд после итераций верны.
  // Q ветвей дерева нужно пересчитать из балансов узлов.
  //
  // Алгоритм:
  //   1. Считаем баланс каждого узла только от хорд.
  //   2. Идём от листьев к корню по BFS-дереву.
  //   3. Для каждого узла v: Q_ребра(parent→v) = −balance[v]
  //      (ребро к родителю должно компенсировать дисбаланс в v).
  //   4. После установки Q ребра к родителю — корректируем balance[parent].
  // ──────────────────────────────────────────────────────────────────────────
  {
    // Инициализируем балансы только от хорд
    const balance = new Map<string, number>();
    for (const n of nodeList) balance.set(n, 0);

    for (let i = 0; i < edges.length; i++) {
      if (treeSet.has(i)) continue;       // пропускаем ветви дерева (они будут пересчитаны)
      const e = edges[i];
      // e.Q > 0: ток из a в b → отток из a, приток в b
      balance.set(e.a, (balance.get(e.a) ?? 0) - e.Q);
      balance.set(e.b, (balance.get(e.b) ?? 0) + e.Q);
    }

    // Обход снизу вверх (от листьев к корню)
    for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
      const v   = bfsOrder[idx];
      const p   = parent.get(v);
      if (!p) continue;

      const e     = edges[p.edgeIdx];
      const pNode = p.node;
      const bal   = balance.get(v) ?? 0;

      // Нам нужно balance[v] = 0, т.е. Q_ребра_к_v = −bal
      // Ребро e ориентировано a→b:
      //   Если e.b === v: Q > 0 означает приток в v. Нужен приток = −bal → e.Q = −bal
      //   Если e.a === v: Q > 0 означает отток из v. Нужен отток = bal → e.Q = bal
      //   (чтобы баланс стал 0: balance[v] + Q_вход - Q_выход = 0)
      if (e.b === v) {
        e.Q = -bal;
        // Обновляем баланс родителя (pNode): ребро e.Q > 0 означает отток из e.a = pNode
        balance.set(pNode, (balance.get(pNode) ?? 0) - e.Q);
      } else {
        // e.a === v, pNode === e.b
        e.Q = bal;
        // ток e.Q > 0 означает отток из e.a = v, т.е. приток в e.b = pNode
        balance.set(pNode, (balance.get(pNode) ?? 0) + e.Q);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ВЫХОДНЫЕ ВЕТВИ с результатами расчёта
  // ──────────────────────────────────────────────────────────────────────────
  const brOut = brCalc.map(b => {
    const e    = edges.find(x => x.id === b.id)!;
    const aMap = toGnd(b.fromId);
    // Знак Q: если физический fromId совпадает с a ребра → знак сохраняется
    let Q = (e.a === aMap) ? e.Q : -e.Q;
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

    return recalcBranchAero({
      ...b,
      flow:          Q,
      fanPressure,
      fanEfficiency: fanEff,
      fanShaftPower: fanShaft,
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ДАВЛЕНИЯ В УЗЛАХ: BFS по дереву от GND (P_GND = 101325 Па)
  // ──────────────────────────────────────────────────────────────────────────
  const pressure = new Map<string, number>([[root, 101325]]);
  const pVis     = new Set([root]);
  const pQueue   = [root];

  while (pQueue.length) {
    const u = pQueue.shift()!;
    for (const { edgeIdx, other } of adj.get(u)!) {
      if (pVis.has(other) || !treeSet.has(edgeIdx)) continue;
      const e  = edges[edgeIdx];
      const H  = fanH(e, e.Q);
      // ΔP = R·Q·|Q| − H (потеря давления от a к b с учётом вентилятора)
      const dP = e.R * e.Q * Math.abs(e.Q) - H;
      const Pu = pressure.get(u)!;
      // u === e.a → P_b = P_a − dP
      // u === e.b → P_a = P_b + dP, т.е. P_a = Pu + dP → P_other = Pu + dP
      pressure.set(other, e.a === u ? Pu - dP : Pu + dP);
      pVis.add(other);
      pQueue.push(other);
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

  // 7а. Баланс расходов в каждом узле
  const nodeBalance = computeBalance(edges, nodeList);
  nodeBalance.forEach((v, id) => {
    if (id === GND_ID || Math.abs(v) <= 0.5) return;
    diag.push({
      level:    Math.abs(v) > 5 ? "error" : "warning",
      category: "node_balance",
      message:  `Дисбаланс: ${id.slice(0, 40)} ΔQ=${v.toFixed(2)} м³/с`,
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
      diag.push({ level: "error", category: "branch_flow", message: `${b.id}: Q=${Math.abs(b.flow).toFixed(1)} — аномально`, objectId: b.id, value: b.flow });
    if (b.velocity > 50 && b.area > 0)
      diag.push({ level: "error", category: "branch_flow", message: `${b.id}: V=${b.velocity.toFixed(0)} м/с — нереально`, objectId: b.id, value: b.velocity });
    if (b.vMax > 0 && b.vMax < 50 && b.velocity > b.vMax * 1.2)
      diag.push({ level: "warning", category: "branch_flow", message: `${b.id}: V=${b.velocity.toFixed(1)} > Vmax=${b.vMax}`, objectId: b.id, value: b.velocity });
  }

  // 7г. Сходимость
  const converged = maxDeltaH < eps1 || maxDeltaQ < eps2;
  if (!converged)
    diag.push({
      level: maxDeltaQ > 1 ? "error" : "warning",
      category: "convergence",
      message: `Не сошлось: max|ΔH|=${maxDeltaH.toFixed(2)} Па, max|δQ|=${maxDeltaQ.toFixed(3)} м³/с`,
      value: maxDeltaQ,
    });

  // 7д. Изолированные узлы
  const reach = new Set<string>([root]);
  const stk   = [root];
  while (stk.length) {
    const u = stk.pop()!;
    for (const { other } of adj.get(u)!) {
      if (!reach.has(other)) { reach.add(other); stk.push(other); }
    }
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