// ─────────────────────────────────────────────────────────────────────────────
// Аэродинамическое расчётное ядро
// СП 60.13330, метод Кросса для увязки колец
// ─────────────────────────────────────────────────────────────────────────────

export type DuctShape = "round" | "rect";

export interface DuctParams {
  shape: DuctShape;
  diameter?: number;     // мм (для round)
  width?: number;        // мм (для rect)
  height?: number;       // мм (для rect)
  length: number;        // м
  roughness?: number;    // мм (по умолчанию 0.1 — оцинковка)
  localResistances?: LocalResistance[]; // КМС на ветви
}

export interface LocalResistance {
  type: string;          // ключ из BIBLIOTECA_KMS
  zeta: number;          // ζ
  count: number;         // количество элементов
}

// ─── Библиотека КМС (коэффициенты местных сопротивлений) ────────────────────
// Источник: Идельчик И.Е. «Справочник по гидравлическим сопротивлениям»

export const BIBLIOTECA_KMS: Record<string, { name: string; zeta: number; group: string }> = {
  // Отводы
  "elbow_90_round": { name: "Отвод 90° круглый (R/D=1)", zeta: 0.21, group: "Отводы" },
  "elbow_90_rect":  { name: "Отвод 90° прямоугольный",   zeta: 1.20, group: "Отводы" },
  "elbow_45_round": { name: "Отвод 45° круглый",         zeta: 0.10, group: "Отводы" },
  "elbow_30":       { name: "Отвод 30°",                  zeta: 0.06, group: "Отводы" },

  // Тройники
  "tee_pass":       { name: "Тройник проход",             zeta: 0.30, group: "Тройники" },
  "tee_branch":     { name: "Тройник ответвление",        zeta: 1.50, group: "Тройники" },
  "tee_split":      { name: "Тройник разделение потока",  zeta: 1.00, group: "Тройники" },
  "tee_merge":      { name: "Тройник слияние потока",     zeta: 1.20, group: "Тройники" },

  // Переходы
  "reducer_grad":   { name: "Конфузор плавный",           zeta: 0.10, group: "Переходы" },
  "reducer_sharp":  { name: "Конфузор резкий",            zeta: 0.30, group: "Переходы" },
  "diffuser_grad":  { name: "Диффузор плавный",           zeta: 0.20, group: "Переходы" },
  "diffuser_sharp": { name: "Диффузор резкий",            zeta: 0.80, group: "Переходы" },

  // Решётки и узлы
  "grille_supply":  { name: "Решётка приточная",          zeta: 2.00, group: "Решётки" },
  "grille_exhaust": { name: "Решётка вытяжная",           zeta: 1.50, group: "Решётки" },
  "diffuser_4way":  { name: "Диффузор потолочный",        zeta: 3.50, group: "Решётки" },

  // Регулирующие
  "damper_open":    { name: "Дроссель-клапан открытый",   zeta: 0.20, group: "Арматура" },
  "damper_45":      { name: "Дроссель-клапан 45°",        zeta: 5.50, group: "Арматура" },
  "shiber_open":    { name: "Шибер открытый",             zeta: 0.10, group: "Арматура" },

  // Фильтры и нагреватели
  "filter_g4":      { name: "Фильтр G4",                  zeta: 25.0, group: "Оборудование" },
  "filter_f7":      { name: "Фильтр F7",                  zeta: 50.0, group: "Оборудование" },
  "heater_water":   { name: "Калорифер водяной",          zeta: 12.0, group: "Оборудование" },
  "cooler":         { name: "Охладитель",                  zeta: 18.0, group: "Оборудование" },

  // Прочее
  "entry_sharp":    { name: "Вход резкий",                zeta: 0.50, group: "Входы/выходы" },
  "entry_smooth":   { name: "Вход плавный",               zeta: 0.05, group: "Входы/выходы" },
  "outlet":         { name: "Выход в атмосферу",          zeta: 1.00, group: "Входы/выходы" },
};

// ─── Геометрия сечения ──────────────────────────────────────────────────────

export function getArea(p: DuctParams): number {
  if (p.shape === "round") {
    const d = (p.diameter ?? 200) / 1000;
    return Math.PI * d * d / 4;
  }
  const w = (p.width ?? 200) / 1000;
  const h = (p.height ?? 200) / 1000;
  return w * h;
}

// Эквивалентный диаметр по скорости (Идельчик)
export function getEquivDiameter(p: DuctParams): number {
  if (p.shape === "round") return (p.diameter ?? 200) / 1000;
  const w = (p.width ?? 200) / 1000;
  const h = (p.height ?? 200) / 1000;
  return 2 * w * h / (w + h); // гидравлический диаметр 4A/P
}

// ─── Коэффициент трения (формула Альтшуля) ──────────────────────────────────

export function frictionLambda(re: number, kEq: number, dEq: number): number {
  if (re < 2300) return 64 / Math.max(re, 1);
  // Формула Альтшуля: λ = 0.11 * (k/d + 68/Re)^0.25
  return 0.11 * Math.pow(kEq / (dEq * 1000) + 68 / re, 0.25);
}

// ─── Расчёт ветви ───────────────────────────────────────────────────────────

export interface BranchCalc {
  area: number;          // м²
  dEq: number;           // м
  velocity: number;      // м/с
  re: number;            // число Рейнольдса
  lambda: number;        // λ
  rTrenie: number;       // потери на трение Па/м
  dpTrenie: number;      // потери трения Па
  sumZeta: number;       // Σζ
  dpKms: number;         // потери в КМС Па
  dpTotal: number;       // суммарные потери Па
  resistance: number;    // приведённое сопротивление S, Па/(м³/с)²
}

export function calcBranch(p: DuctParams, flowM3h: number): BranchCalc {
  const rho = 1.2;          // кг/м³
  const nu = 15.06e-6;      // м²/с (воздух 20°C)
  const k = p.roughness ?? 0.1; // мм

  const area = getArea(p);
  const dEq = getEquivDiameter(p);
  const Q = flowM3h / 3600; // м³/с
  const velocity = Q / area;
  const re = velocity * dEq / nu;
  const lambda = frictionLambda(re, k, dEq);

  // Потери на трение R = λ/dEq · ρv²/2 (Па/м)
  const rTrenie = (lambda / dEq) * (rho * velocity * velocity / 2);
  const dpTrenie = rTrenie * p.length;

  // Местные сопротивления
  const sumZeta = (p.localResistances ?? []).reduce((s, lr) => s + lr.zeta * lr.count, 0);
  const dpKms = sumZeta * (rho * velocity * velocity / 2);

  const dpTotal = dpTrenie + dpKms;

  // S = ΔP / Q²  (по которой ведём метод Кросса)
  const resistance = Q > 0 ? dpTotal / (Q * Q) : 0;

  return {
    area: Math.round(area * 10000) / 10000,
    dEq: Math.round(dEq * 1000) / 1000,
    velocity: Math.round(velocity * 100) / 100,
    re: Math.round(re),
    lambda: Math.round(lambda * 10000) / 10000,
    rTrenie: Math.round(rTrenie * 100) / 100,
    dpTrenie: Math.round(dpTrenie * 10) / 10,
    sumZeta: Math.round(sumZeta * 100) / 100,
    dpKms: Math.round(dpKms * 10) / 10,
    dpTotal: Math.round(dpTotal * 10) / 10,
    resistance: Math.round(resistance * 1000) / 1000,
  };
}

// ─── Метод Кросса (увязка колец) ────────────────────────────────────────────

export interface NetworkBranch {
  id: string;
  from: string;
  to: string;
  params: DuctParams;
  flow?: number; // начальное приближение, м³/ч
}

export interface NetworkNode {
  id: string;
  type: "supply" | "exhaust" | "junction" | "fan";
  fixedFlow?: number; // м³/ч (для источников/потребителей)
}

export interface CrossResult {
  branchFlows: Record<string, number>; // м³/ч
  branchCalcs: Record<string, BranchCalc>;
  iterations: number;
  maxResidual: number; // Па
  converged: boolean;
}

// Поиск независимых колец (упрощённый — DFS)
function findLoops(nodes: NetworkNode[], branches: NetworkBranch[]): string[][] {
  const adj: Record<string, { to: string; bid: string; dir: 1 | -1 }[]> = {};
  nodes.forEach((n) => (adj[n.id] = []));
  branches.forEach((b) => {
    adj[b.from]?.push({ to: b.to, bid: b.id, dir: 1 });
    adj[b.to]?.push({ to: b.from, bid: b.id, dir: -1 });
  });

  const loops: string[][] = [];
  const seen = new Set<string>();

  // BFS-tree → хорды дают независимые контуры
  const visited = new Set<string>();
  const parent: Record<string, { node: string; bid: string } | null> = {};
  const treeEdges = new Set<string>();
  const root = nodes[0]?.id;
  if (!root) return [];

  const queue = [root];
  visited.add(root);
  parent[root] = null;
  while (queue.length) {
    const u = queue.shift()!;
    for (const e of adj[u] || []) {
      if (!visited.has(e.to)) {
        visited.add(e.to);
        parent[e.to] = { node: u, bid: e.bid };
        treeEdges.add(e.bid);
        queue.push(e.to);
      }
    }
  }

  // Каждая хорда замыкает контур
  for (const b of branches) {
    if (treeEdges.has(b.id)) continue;
    // путь в дереве from → to
    const pathA: string[] = [];
    let cur: string | null = b.from;
    const ancestors = new Set<string>();
    while (cur) {
      ancestors.add(cur);
      const p = parent[cur];
      if (!p) break;
      cur = p.node;
    }
    cur = b.to;
    const pathB: string[] = [];
    while (cur && !ancestors.has(cur)) {
      const p = parent[cur];
      if (!p) break;
      pathB.push(p.bid);
      cur = p.node;
    }
    const lca = cur;
    cur = b.from;
    while (cur && cur !== lca) {
      const p = parent[cur];
      if (!p) break;
      pathA.push(p.bid);
      cur = p.node;
    }
    const loop = [b.id, ...pathB.reverse(), ...pathA];
    const key = [...loop].sort().join(",");
    if (!seen.has(key) && loop.length >= 2) {
      seen.add(key);
      loops.push(loop);
    }
  }

  return loops;
}

export function crossMethod(
  nodes: NetworkNode[],
  branches: NetworkBranch[],
  opts?: { maxIter?: number; tolerance?: number }
): CrossResult {
  const maxIter = opts?.maxIter ?? 50;
  const tol = opts?.tolerance ?? 1.0; // Па

  // Начальное распределение расходов
  const supply = nodes.filter((n) => n.type === "supply" || n.type === "fan");
  const exhaust = nodes.filter((n) => n.type === "exhaust");
  const totalFlow = (supply.reduce((s, n) => s + (n.fixedFlow ?? 1000), 0)) ||
                    (exhaust.reduce((s, n) => s + (n.fixedFlow ?? 500), 0)) || 1000;

  const flows: Record<string, number> = {};
  branches.forEach((b) => {
    flows[b.id] = b.flow ?? totalFlow / branches.length;
  });

  const loops = findLoops(nodes, branches);

  let iter = 0;
  let maxResidual = Infinity;

  for (iter = 0; iter < maxIter; iter++) {
    maxResidual = 0;

    for (const loop of loops) {
      // ΔQ = -Σ(S·Q·|Q|) / (2·Σ(S·|Q|))
      let num = 0;
      let den = 0;
      for (let i = 0; i < loop.length; i++) {
        const bid = loop[i];
        const br = branches.find((b) => b.id === bid)!;
        const calc = calcBranch(br.params, Math.abs(flows[bid]));
        const S = calc.resistance / (3600 * 3600); // приведём к Па/(м³/ч)²
        const sign = i === 0 ? 1 : -1; // упрощение направления
        const Q = flows[bid] * sign;
        num += S * Q * Math.abs(Q);
        den += S * Math.abs(Q);
      }
      const dQ = den > 0 ? -num / (2 * den) : 0;
      maxResidual = Math.max(maxResidual, Math.abs(num));
      for (let i = 0; i < loop.length; i++) {
        const bid = loop[i];
        const sign = i === 0 ? 1 : -1;
        flows[bid] += dQ * sign;
      }
    }

    if (maxResidual < tol) break;
  }

  // Если колец нет — равномерное распределение по числу ветвей с учётом источников
  if (loops.length === 0) {
    branches.forEach((b) => { flows[b.id] = totalFlow / branches.length; });
  }

  const branchCalcs: Record<string, BranchCalc> = {};
  branches.forEach((b) => {
    branchCalcs[b.id] = calcBranch(b.params, Math.abs(flows[b.id]));
  });

  return {
    branchFlows: Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, Math.round(Math.abs(v))])),
    branchCalcs,
    iterations: iter + 1,
    maxResidual: Math.round(maxResidual * 10) / 10,
    converged: maxResidual < tol,
  };
}

// ─── Подбор стандартного диаметра ───────────────────────────────────────────

export const STANDARD_DIAMETERS = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250];
export const STANDARD_RECT = [
  [100, 100], [150, 100], [150, 150], [200, 100], [200, 150], [200, 200],
  [250, 150], [250, 200], [250, 250], [300, 150], [300, 200], [300, 250],
  [400, 200], [400, 250], [400, 300], [500, 250], [500, 300], [500, 400],
  [600, 300], [600, 400], [800, 400], [800, 500], [1000, 500], [1000, 800],
];

export function recommendDiameter(flowM3h: number, vMax = 6): number {
  const Q = flowM3h / 3600;
  const dMin = Math.sqrt(4 * Q / (Math.PI * vMax));
  const dMm = dMin * 1000;
  return STANDARD_DIAMETERS.find((d) => d >= dMm) ?? STANDARD_DIAMETERS[STANDARD_DIAMETERS.length - 1];
}
