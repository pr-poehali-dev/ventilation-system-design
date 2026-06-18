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
import { airPermToR } from "./bulkheads";

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
  fanType:        "ГВУ" | "ВВУ" | "ВМП";   // тип вентилятора
  fanMode:        "constant" | "curve";
  fanH0:          number;      // Па (не масштабированный на rho!)
  fanCurve?:      FanCurve;
  fanRpm?:        number;
  fanBladeAngle?: number;
  fanRhoFactor:       number;
  fanReverse:         boolean;
  fanStopped:         boolean;    // вентилятор остановлен: H=0, только сопротивление
  fanParallel:        number;     // кол-во вентиляторов в параллель (≥1)
  // Реверсная P–Q характеристика (если задана в каталоге)
  reverseH0?:         number;
  reverseH1?:         number;
  reverseH2?:         number;
  reverseQMax?:       number;
  reverseEffFactor?:  number;     // множитель КПД в реверсе
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
 * Модуль напора вентилятора H(|Q|) ≥ 0, в Па.
 * Всегда возвращает неотрицательное значение — как в методе Кросса.
 * Знак (направление нагнетания) учитывается ОТДЕЛЬНО в формуле невязки
 * через fan_dir = fanReverse ? -1 : +1.
 */
function fanH(e: Edge, Q: number): number {
  if (!e.hasFan || e.fanStopped) return 0;

  const N = Math.max(1, e.fanParallel ?? 1);

  if (e.fanMode === "constant") {
    return Math.max(0, e.fanH0 * e.fanRhoFactor);
  }

  if (e.fanMode === "curve" && e.fanCurve) {
    const c  = e.fanCurve;
    const k  = (e.fanRpm && c.rpmNominal > 0) ? e.fanRpm / c.rpmNominal : 1;
    const Qn = Math.abs(Q) / N / Math.max(0.001, k);

    // При реверсе — используем реверсную P–Q характеристику если она есть в каталоге
    if (e.fanReverse && e.reverseH0 !== undefined && e.reverseH1 !== undefined && e.reverseH2 !== undefined) {
      const qMax = (e.reverseQMax ?? c.qMax) * k;
      if (Qn > qMax) return 0;
      return Math.max(0, e.reverseH0 + e.reverseH1 * Qn + e.reverseH2 * Qn * Qn) * k * k * e.fanRhoFactor;
    }

    // Прямая характеристика (или реверс без отдельной кривой)
    const af = angleFactor(c, e.fanBladeAngle);
    if (Qn > c.qMax) return 0;
    return Math.max(0, c.h0 * af + c.h1 * Qn + c.h2 * Qn * Qn) * k * k * e.fanRhoFactor;
  }

  return 0;
}

/** |dH/dQ| для уточнения знаменателя δQ. */
function fanDH(e: Edge, Q: number): number {
  if (!e.hasFan || e.fanMode !== "curve" || !e.fanCurve) return 0;
  const N  = Math.max(1, e.fanParallel ?? 1);
  const c  = e.fanCurve;
  const k  = (e.fanRpm && c.rpmNominal > 0) ? e.fanRpm / c.rpmNominal : 1;
  const Qn = Math.abs(Q) / N / Math.max(0.001, k);
  // При реверсе с отдельной кривой — используем её коэффициенты
  if (e.fanReverse && e.reverseH0 !== undefined && e.reverseH1 !== undefined && e.reverseH2 !== undefined) {
    return Math.abs((e.reverseH1 + 2 * e.reverseH2 * Qn) * k * e.fanRhoFactor) / N;
  }
  // dH/dQ_total = dH/dQ_one * (1/N) — цепное правило
  return Math.abs((c.h1 + 2 * c.h2 * Qn) * k * e.fanRhoFactor) / N;
}

/**
 * Оценка рабочей точки вентилятора методом бисекции H_вент(Q) = R_сети·Q².
 * Работаем с |H| и |Q| — знак реверса учтём при инициализации отдельно.
 */
function estimateQ0(edges: Edge[], Rtotal: number): number {
  // Берём главный вентилятор (ГВУ/ВВУ) для оценки рабочей точки.
  // ВМП не должен влиять на глобальную оценку Q₀ сети.
  const fan = edges.find(e => e.hasFan && !e.fanStopped && (e.fanType === "ГВУ" || e.fanType === "ВВУ"))
           ?? edges.find(e => e.hasFan && !e.fanStopped);
  if (!fan) return 5;

  // |H0| при Q=0 — всегда положительный (независимо от fanReverse)
  const H0abs = Math.abs(fanH(fan, 0));

  if (fan.fanMode === "constant") {
    if (H0abs > 0 && Rtotal > 0) return Math.sqrt(H0abs / Rtotal);
    return 5;
  }

  if (fan.fanMode === "curve" && fan.fanCurve) {
    const c = fan.fanCurve;
    const k = (fan.fanRpm && c.rpmNominal > 0) ? fan.fanRpm / c.rpmNominal : 1;
    // При реверсе с отдельной кривой — используем её диапазон расходов
    const qMaxSrc = (fan.fanReverse && fan.reverseQMax !== undefined) ? fan.reverseQMax : c.qMax;
    const qHi = qMaxSrc * k;
    if (Rtotal <= 0) return (c.qMin + qMaxSrc) / 2 * k;

    // Бисекция: |H_вент(q)| = R·q² — всегда работаем с положительными величинами
    let lo = 0, hi = qHi;
    for (let i = 0; i < 80; i++) {
      const q   = (lo + hi) / 2;
      const Hf  = Math.abs(fanH(fan, q));   // |H| > 0 независимо от реверса
      const Hn  = Rtotal * q * q;
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
      R:             Math.max(MIN_R, b.resistance + (b.hasBulkhead ? (() => {
        const mode = b.bulkheadResMode ?? "project";
        // В этой кодовой базе: 1 кМюрг = 9.81 Н·с²/м⁸, 1 Мюрг = 9.81e-3 Н·с²/м⁸
        // b.resistance хранится в Н·с²/м⁸ (от calcResistance)
        if (mode === "manual") return (b.bulkheadManualR ?? 0) * 9.81; // кМюрг → Н·с²/м⁸
        if (mode === "survey") {
          const q = b.bulkheadSurveyQ ?? 0;
          const dp = b.bulkheadSurveyDP ?? 0;
          return q > 0 ? dp / (q * q) : 1e9; // Па·с²/м⁶ = Н·с²/м⁸ ✓
        }
        // project: если задана воздухопроницаемость вручную — пересчитываем R = 1/A²
        // airPermToR возвращает Мюрг → × 9.81e-3 = Н·с²/м⁸
        if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0) {
          return airPermToR(b.bulkheadCustomAirPerm!) * 9.81e-3; // Мюрг → Н·с²/м⁸
        }
        // project: воздухопроницаемость из справочника — пересчитываем R = 1/A²
        if ((b.bulkheadAirPerm ?? 0) > 0) {
          return airPermToR(b.bulkheadAirPerm!) * 9.81e-3; // Мюрг → Н·с²/м⁸
        }
        // fallback: bulkheadR хранится в Мюрг → Н·с²/м⁸
        return (b.bulkheadR ?? 0) * 9.81e-3; // Мюрг → Н·с²/м⁸
      })() : 0)
      + (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки" ? (b.fanCrossingR ?? 0) * 9.81e-3 : 0)
      // R вентиляционного окна: R = ρ/(2·ΔS²), ΔS — площадь окна вентсооружения
      // rho здесь = airRho(T)/1.2 (поправочный коэф.), фактическая ρ = rho*1.2
      + (b.hasFan && (b.fanWindowArea ?? 0) > 0 ? (rho * 1.2) / (2 * Math.pow(b.fanWindowArea!, 2)) : 0)),
      Q:             0,
      hasFan:        b.hasFan,
      fanType:       b.fanType ?? "ГВУ",
      fanMode:       b.fanMode,
      // FIX: fanH0 хранить в Па (не умножать на rho здесь — fanH() применяет rhoFactor)
      fanH0:         b.fanPressure,
      fanCurve:      b.fanMode === "curve" ? (getFanById(b.fanCurveId) ?? undefined) : undefined,
      fanRpm:        b.fanRpm,
      fanBladeAngle: b.fanBladeAngle,
      fanRhoFactor:  rho,
      fanReverse:    b.fanReverse ?? false,
      fanStopped:    b.fanStopped ?? false,
      fanParallel:   Math.max(1, b.fanParallel ?? 1),
      // Реверсная кривая из каталога (только для curve-вентиляторов)
      ...(() => {
        const c = b.fanMode === "curve" ? (getFanById(b.fanCurveId) ?? undefined) : undefined;
        if (!c) return {};
        return {
          reverseH0:        c.reverseH0,
          reverseH1:        c.reverseH1,
          reverseH2:        c.reverseH2,
          reverseQMax:      c.reverseQMax,
          reverseEffFactor: c.reverseEfficiencyFactor,
        };
      })(),
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

  // Проверка: есть ли хоть один активный (не остановленный) вентилятор
  const hasFanEdges   = edges.some(e => e.hasFan);
  const hasActiveFans = edges.some(e => e.hasFan && !e.fanStopped);
  if (hasFanEdges && !hasActiveFans) {
    const zeroBranches = brCalc.map(b => ({ ...b, flow: 0, velocity: 0, dP: 0, fanPressure: 0, fanEfficiency: 0, fanShaftPower: 0 }));
    return {
      ok: true, iterations: 0, maxDeltaQ: 0, maxDeltaH: 0,
      branches: zeroBranches, nodes: nodesIn,
      log: ["Все вентиляторы остановлены — расход Q=0"],
      cyclesCount: 0,
      diagnostics: [{ level: "warning", category: "fan", message: "Все вентиляторы остановлены (H=0) — расход в сети равен нулю" }],
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

  // Принудительно выгоняем активные вентиляторы из дерева в хорды.
  // Если вентилятор попал в дерево — он не войдёт ни в один контур МКР
  // и его напор не будет участвовать в итерациях. Решение: перестроить
  // spanning tree, запрещая брать активные вентиляторы в дерево.
  const hasTreeFan = edges.some((e, i) => treeSet.has(i) && e.hasFan && !e.fanStopped);
  if (hasTreeFan) {
    parent.clear();
    treeSet.clear();
    bfsOrder.length = 0;
    const visited2 = new Set<string>([root]);
    parent.set(root, null);
    const bfsQ2 = [root];
    // Первый проход: строим дерево, пропуская активные вентиляторы
    while (bfsQ2.length) {
      const u = bfsQ2.shift()!;
      bfsOrder.push(u);
      for (const { edgeIdx, other } of adj.get(u)!) {
        if (visited2.has(other)) continue;
        if (edges[edgeIdx].hasFan && !edges[edgeIdx].fanStopped) continue; // вентиляторы — только в хорды
        visited2.add(other);
        parent.set(other, { node: u, edgeIdx });
        treeSet.add(edgeIdx);
        bfsQ2.push(other);
      }
    }
    // Если какие-то узлы остались непосещёнными (все рёбра — вентиляторы),
    // достраиваем дерево включая вентиляторы (нет альтернативы)
    if (visited2.size < nodeList.length) {
      const bfsQ3 = Array.from(visited2);
      for (const u of bfsQ3) {
        for (const { edgeIdx, other } of adj.get(u)!) {
          if (visited2.has(other)) continue;
          visited2.add(other);
          parent.set(other, { node: u, edgeIdx });
          treeSet.add(edgeIdx);
          bfsOrder.push(other);
        }
      }
    }
    log.push(`[fan-to-chord] вентиляторы выгнаны из дерева, перестроен spanning tree`);
  }

  const chords = edges.map((_, i) => i).filter(i => !treeSet.has(i));
  const bfsPos = new Map(bfsOrder.map((n, i) => [n, i]));

  log.push(`Узлов: ${nodeList.length}, ветвей: ${edges.length}, контуров: ${chords.length}`);
  // === DEBUG: состав контуров ===
  chords.forEach((cIdx, ci) => {
    const e = edges[cIdx];
    log.push(`[contour-${ci}] хорда: ${e.id}(${e.a}→${e.b})${e.hasFan?" ВЕН":""}`);
  });
  edges.forEach((e, i) => log.push(`[edge-${i}] ${e.id} ${e.a}→${e.b} R=${e.R.toFixed(4)}${e.hasFan?" ВЕН":""}${treeSet.has(i)?" TREE":" CHORD"}`));

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

  // Суммарное R пути через главный вентилятор (ГВУ/ВВУ):
  // ВМП — местный, его контур не отражает глобальное сопротивление сети.
  // findIndex возвращает -1 а не undefined, поэтому fallback через явное условие.
  const _mainFanIdx = edges.findIndex(e => e.hasFan && !e.fanStopped && (e.fanType === "ГВУ" || e.fanType === "ВВУ"));
  const fanEdgeIdx = _mainFanIdx >= 0
    ? _mainFanIdx
    : edges.findIndex(e => e.hasFan && !e.fanStopped);
  let Rtree: number;
  if (fanEdgeIdx >= 0 && !treeSet.has(fanEdgeIdx)) {
    // Вентилятор — хорда: R пути = R самого вентилятора + R дерева в его контуре
    const fanEdge = edges[fanEdgeIdx];
    const contourPath = treePath(fanEdge.b, fanEdge.a, edges, parent);
    Rtree = contourPath.reduce((s, ce) => s + edges[ce.edgeIdx].R, 0);
  } else {
    // Вентилятор в дереве: суммируем все рёбра дерева
    Rtree = edges.filter((_, i) => treeSet.has(i)).reduce((s, e) => s + e.R, 0);
  }
  const Q0 = Math.max(0.1, estimateQ0(edges, Rtree));

  // Знак начального Q — идентично методу Кросса (строки 797-804 backend/airflow/index.py):
  // sign_init определяется ТОЛЬКО по главному вентилятору (ГВУ или ВВУ).
  // ВМП НЕ учитывается — его направление определяется физикой итераций.
  // Это критично: если ВМП попадёт первым в edges.find(), sign_init будет неверным
  // и весь начальный поток получит неправильное направление.
  const mainFan = edges.find(e => e.hasFan && !e.fanStopped && (e.fanType === "ГВУ" || e.fanType === "ВВУ"));
  const sign_init = (mainFan?.fanReverse ?? false) ? -1 : 1;
  const q_chord   = Q0 * sign_init;
  log.push(`Q₀=${Q0.toFixed(2)} м³/с, sign_init=${sign_init}`);

  // Инициализация: все хорды получают q_chord (со знаком), дерево — из Кирхгофа-1
  edges.forEach((e, i) => {
    if (!treeSet.has(i)) {
      e.Q = q_chord;  // все хорды с учётом sign_init
    } else {
      e.Q = 0;        // ветви дерева сначала в 0
    }
  });

  // Вентилятор в дереве тоже получает q_chord
  edges.forEach((e, i) => {
    if (e.hasFan && treeSet.has(i)) e.Q = q_chord;
  });

  // Bottom-up пересчёт ветвей дерева из хорд (Кирхгоф-1)
  {
    const initBal = new Map<string, number>();
    for (const n of nodeList) initBal.set(n, 0);

    // Вклад хорд (и вентилятора дерева) в балансы: e.Q > 0 = ток a→b
    for (let i = 0; i < edges.length; i++) {
      if (treeSet.has(i) && !edges[i].hasFan) continue;
      const e = edges[i];
      initBal.set(e.a, (initBal.get(e.a) ?? 0) - e.Q);
      initBal.set(e.b, (initBal.get(e.b) ?? 0) + e.Q);
    }

    for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
      const v  = bfsOrder[idx];
      const p  = parent.get(v);
      if (!p) continue;
      const e  = edges[p.edgeIdx];
      if (e.hasFan) continue;
      const bal = initBal.get(v) ?? 0;
      if (e.b === v) {
        e.Q = -bal;
        initBal.set(p.node, (initBal.get(p.node) ?? 0) + bal);
      } else {
        e.Q = bal;
        initBal.set(p.node, (initBal.get(p.node) ?? 0) + bal);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ШАГ 5. ИТЕРАЦИОННЫЙ ПРОЦЕСС МКР
  //
  // Формулы (строго из методики):
  //   Qd_i = Q_i · dir_i   (расход в направлении обхода контура)
  //
  //   ΔH_k = Σ_{i∈k} [R_i · Qd_i · |Qd_i|  −  H_eff_i · sign(Qd_i)]
  //
  //   Знак вентилятора (метод Кросса):
  //     H_eff = +H  — прямой режим (нагнетание a→b)
  //     H_eff = -H  — реверс (нагнетание b→a)
  //     sign(Qd) = знак расхода в направлении обхода контура
  //   При Qd > 0 (ток совпадает с обходом): num -= H_eff
  //   При Qd < 0 (ток против обхода):       num += H_eff
  //
  //   δQ_k = −ΔH_k / (2·Σ_{i∈k} R_i·|Qd_i|  +  Σ_{f∈k} |dH_f/dQ_f|)
  //
  //   Q_i ← Q_i + δQ_k · dir_i
  // ──────────────────────────────────────────────────────────────────────────

  let maxDeltaQ = Infinity;
  let maxDeltaH = Infinity;
  let iter      = 0;

  // При реверсе ГВУ/ВВУ стартуем с relaxation=1.0 — нужно быстро перевернуть поток.
  // При прямом режиме 0.7 обеспечивает устойчивость. ВМП не влияет на relaxation.
  const hasReverse = edges.some(e => e.hasFan && e.fanReverse && !e.fanStopped
    && (e.fanType === "ГВУ" || e.fanType === "ВВУ"));
  let relaxation = hasReverse ? 1.0 : 0.7;

  for (; iter < maxIter; iter++) {
    maxDeltaQ = 0;
    maxDeltaH = 0;

    for (const contour of contours) {
      let num = 0;
      let den = 0;

      for (const { edgeIdx, dir } of contour) {
        const e  = edges[edgeIdx];
        const Qd = e.Q * dir;           // расход в направлении обхода контура

        // Потеря напора вдоль ребра (в направлении обхода)
        num += e.R * Qd * Math.abs(Qd);

        // Вклад вентилятора (классический МКР / метод Кросса):
        // ΔH_k = Σ R·Qd·|Qd| − Σ H·fan_dir·dir
        // fan_dir = +1 прямой режим (нагнетание a→b)
        // fan_dir = -1 реверс (нагнетание b→a)
        // dir = направление обхода контура по ребру
        // Формула не зависит от знака текущего Q — вентилятор всегда
        // присутствует в невязке, в т.ч. при Q=0 (переход через ноль).
        if (e.hasFan) {
          const H       = fanH(e, e.Q);                // |H| >= 0
          const fan_dir = e.fanReverse ? -1 : 1;
          num -= H * fan_dir * dir;
          den += fanDH(e, e.Q);
        }

        den += 2 * e.R * Math.abs(Qd);
      }

      if (den < 1e-12) continue;

      // Поправка расхода: δQ = -ΔH / (2·Σ R·|Q|)
      // ВАЖНО: НЕ ограничиваем смену знака Q — при реверсе вентилятора итерации
      // обязаны перевернуть поток (Q меняет знак). Жёсткое ограничение dQmax
      // запирало Q около нуля и алгоритм считал что сошёлся при неправильном ответе.
      // Допустимое ограничение — не более 2*Qscale за шаг (защита от взрыва, но
      // достаточно для смены знака).
      const dQraw  = -num / den;
      const Qscale = contour.reduce((mx, { edgeIdx }) => Math.max(mx, Math.abs(edges[edgeIdx].Q)), 0.1);
      const dQmax  = Qscale * 2.0;   // разрешаем смену знака (ранее было 0.8 — блокировало реверс)
      const dQ     = relaxation * Math.max(-dQmax, Math.min(dQmax, dQraw));

      if (Math.abs(num) > maxDeltaH) maxDeltaH = Math.abs(num);
      if (Math.abs(dQ)  > maxDeltaQ) maxDeltaQ = Math.abs(dQ);

      // Обновляем Q всех рёбер контура
      for (const { edgeIdx, dir } of contour) {
        edges[edgeIdx].Q += dQ * dir;
      }
    }

    // Защита от NaN / нулей
    for (const e of edges) {
      if (!isFinite(e.Q)) e.Q = 0;
    }

    // Синхронизация Q ветвей дерева (Кирхгоф-1) после каждой итерации.
    // Это критично: хорды обновились, Q дерева должно отражать новые балансы.
    {
      const syncBal = new Map<string, number>();
      for (const n of nodeList) syncBal.set(n, 0);

      // Вклад всех хорд и вентиляторов дерева в балансы
      for (let i = 0; i < edges.length; i++) {
        if (treeSet.has(i) && !edges[i].hasFan) continue;
        const e = edges[i];
        syncBal.set(e.a, (syncBal.get(e.a) ?? 0) - e.Q);
        syncBal.set(e.b, (syncBal.get(e.b) ?? 0) + e.Q);
      }

      // bottom-up: пересчёт Q ветвей дерева (вентиляторы пропускаем — их Q фиксировано итерациями МКР)
      for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
        const v  = bfsOrder[idx];
        const p  = parent.get(v);
        if (!p) continue;
        const e  = edges[p.edgeIdx];
        const pN = p.node;
        const b  = syncBal.get(v) ?? 0;
        if (e.hasFan) {
          // Вентилятор: Q не перезаписываем, но баланс узла v ПЕРЕДАЁМ вверх —
          // иначе вышестоящие ветви дерева не узнают о потоке через вентилятор
          // и получат неверный Q (баг: трубопровод получал поток >  Q вентилятора).
          syncBal.set(pN, (syncBal.get(pN) ?? 0) + b);
          continue;
        }
        if (e.b === v) {
          e.Q = -b;
          syncBal.set(pN, (syncBal.get(pN) ?? 0) + b);
        } else {
          e.Q = b;
          syncBal.set(pN, (syncBal.get(pN) ?? 0) + b);
        }
      }
    }

    // Адаптивный relaxation: при реверсе держим 1.0 пока поток не стабилизируется,
    // при прямом — плавно повышаем с 0.7 до 1.0 по мере сходимости
    if (!hasReverse && iter > 30 && maxDeltaH < 100) {
      relaxation = Math.min(1.0, relaxation + 0.01);
    }

    // ШАГ 6. Критерий остановки:
    // При реверсе останавливаемся ТОЛЬКО по давлению (maxDeltaH) — критерий по δQ
    // ненадёжен, т.к. может выполниться когда Q застрял около нуля, не развернувшись.
    if (hasReverse) {
      if (maxDeltaH < eps1) { iter++; break; }
    } else {
      if (maxDeltaH < eps1 || maxDeltaQ < eps2) { iter++; break; }
    }
  }

  log.push(`Итерации: ${iter}, max|ΔH|=${maxDeltaH.toFixed(3)} Па, max|δQ|=${maxDeltaQ.toFixed(4)} м³/с`);
  // === DEBUG: Q после итераций Кросса (до пересчёта дерева) ===
  edges.forEach((e, i) => {
    const inTree = treeSet.has(i) ? "дерево" : "хорда";
    log.push(`[post-Cross] ${e.id} (${inTree}${e.hasFan?" ВЕН":""}): Q=${e.Q.toFixed(3)}`);
  });

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
      // Учитываем все ребра, кроме ветвей дерева БЕЗ вентилятора
      // Вентиляторы дерева — тоже "фиксированные источники", учитываем их Q
      if (treeSet.has(i) && !edges[i].hasFan) continue;
      const e = edges[i];
      // e.Q > 0: ток из a в b → отток из a, приток в b
      balance.set(e.a, (balance.get(e.a) ?? 0) - e.Q);
      balance.set(e.b, (balance.get(e.b) ?? 0) + e.Q);
    }

    // === DEBUG: балансы от хорд + вентиляторов дерева ===
    balance.forEach((v, k) => { if (Math.abs(v) > 1e-6) log.push(`[balance-chord] узел ${k}: ${v.toFixed(3)}`); });

    // Обход снизу вверх (от листьев к корню)
    for (let idx = bfsOrder.length - 1; idx >= 1; idx--) {
      const v   = bfsOrder[idx];
      const p   = parent.get(v);
      if (!p) continue;

      const e     = edges[p.edgeIdx];
      const pNode = p.node;
      const bal   = balance.get(v) ?? 0;

      // Вентилятор в дереве: его Q уже учтён в начальном балансе выше (строка 808).
      // НЕ перезаписываем его Q — он фиксированный источник (как в синхронизации строка 747).
      // Передаём остаточный дисбаланс узла v вверх по дереву.
      if (e.hasFan) {
        // Ребро вентилятора соединяет v с pNode. Его Q уже задано итерациями МКР.
        // Остаток дисбаланса в v (после учёта всех хорд и этого вентилятора) передаём в pNode.
        // Знак: баланс v = приток − отток = 0 должен выполняться, но мы не меняем Q вентилятора.
        // Просто суммируем невязку вверх — она обнулится на корне (GND впитает всё).
        balance.set(pNode, (balance.get(pNode) ?? 0) + bal);
        continue;
      }
      // Нам нужно balance[v] = 0, т.е. Q_ребра_к_v = −bal
      // Ребро e ориентировано a→b:
      //   Если e.b === v: приток в v = e.Q → e.Q = −bal
      //   Если e.a === v: отток из v = e.Q (ток v→pNode) → e.Q = bal
      if (e.b === v) {
        e.Q = -bal;
        balance.set(pNode, (balance.get(pNode) ?? 0) + bal);
      } else {
        e.Q = bal;
        balance.set(pNode, (balance.get(pNode) ?? 0) + bal);
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
      const Habs    = fanH(e, e.Q);               // |H| >= 0
      const fan_dir = b.fanReverse ? -1 : 1;
      fanPressure   = fan_dir * Habs;             // знаковый напор для отображения
      if (b.fanMode === "curve" && e.fanCurve) {
        const Qfan = Math.abs(e.Q);
        const etaBase = fanEfficiency(e.fanCurve, Qfan);
        if (b.fanReverse) {
          const effFactor = e.reverseEffFactor ?? 0.82;
          fanEff = Math.max(0.05, etaBase * effFactor);
        } else {
          fanEff = etaBase;
        }
        fanShaft = fanShaftPower(Habs, Qfan, fanEff);
      }
      const revStr = b.fanReverse ? " [РЕВЕРС]" : "";
      log.push(`Вент. ${b.id}${revStr}: Q=${e.Q.toFixed(2)} м³/с, H=${fanPressure.toFixed(0)} Па, η=${(fanEff * 100).toFixed(0)}%`);
    }

    const brRecalc = recalcBranchAero({
      ...b,
      flow:          Q,
      fanPressure,
      fanEfficiency: fanEff,
      fanShaftPower: fanShaft,
    });
    // Пересчитываем dP с полным R ребра (включает R перемычки, вентилятора и т.д.)
    const fullDp = e.R * Q * Math.abs(Q) - (b.hasFan ? fanH(e, Math.abs(Q)) * (b.fanReverse ? -1 : 1) : 0);
    return { ...brRecalc, dP: Math.round(fullDp * 10) / 10 };
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
      const Habs    = fanH(e, e.Q);                   // |H| >= 0
      const fan_dir = e.fanReverse ? -1 : 1;
      const H       = fan_dir * Habs;                 // знаковый: > 0 нагнетание a→b
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
  for (const b of brOut) {
    if (!b.hasFan || b.fanMode !== "curve") continue;
    const e = edges.find(x => x.id === b.id);
    if (!e?.fanCurve) continue;
    const k    = (e.fanRpm && e.fanCurve.rpmNominal > 0) ? e.fanRpm / e.fanCurve.rpmNominal : 1;
    const Q    = Math.abs(e.Q);
    const qMin = e.fanCurve.qMin * k;
    const qMax = (e.fanReverse && e.reverseQMax) ? e.reverseQMax * k : e.fanCurve.qMax * k;
    if (Q < qMin * 0.9)
      diag.push({ level: "warning", category: "fan", message: `${e.id}: помпаж Q=${Q.toFixed(1)} < Qmin=${qMin.toFixed(1)}`, objectId: e.id });
    else if (Q > qMax * 0.97)
      diag.push({ level: "warning", category: "fan", message: `${e.id}: предел Q=${Q.toFixed(1)} ≈ Qmax=${qMax.toFixed(1)}`, objectId: e.id });

    // Аналог generate_report(): проверка КПД в реверсе
    // fan.efficiency < 0 → риск неустойчивости (рабочая точка за пределами характеристики)
    if (b.fanReverse && b.fanEfficiency <= 0.05) {
      diag.push({
        level: "warning", category: "fan",
        message: `${b.id} [РЕВЕРС]: КПД=${(b.fanEfficiency * 100).toFixed(0)}% — вентилятор работает за пределами устойчивой зоны. Риск помпажа.`,
        objectId: b.id, value: b.fanEfficiency,
      });
    }
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