// ─────────────────────────────────────────────────────────────────────────────
// Проверка схемы вентиляционной сети (узлы + ветви).
// Оптимизировано для больших схем (тысячи узлов/ветвей):
//   • пространственная сетка (spatial hash) → поиск близких узлов за O(n)
//     вместо O(n²);
//   • единый проход по ветвям;
//   • чистая функция — результат легко мемоизировать через useMemo.
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoNode, TopoBranch } from "./topology";
import { branchBulkheadRkMurg } from "./bulkheads";

export interface NearPair { a: TopoNode; b: TopoNode; dist: number }
export interface DupePair { a: TopoNode; b: TopoNode }
export interface DupBranchGroup { branches: TopoBranch[]; key: string }
export interface BulkCheck { branch: TopoBranch; rKmu: number }

export interface SchemaCheckResult {
  nearPairs: NearPair[];
  isolated: TopoNode[];
  dupes: DupePair[];
  dupBranches: DupBranchGroup[];
  zeroRBranches: TopoBranch[];
  /** Ветви с длиной = 0 — не имеют сопротивления, расчёт воздухораспределения невозможен. */
  zeroLenBranches: TopoBranch[];
  highRBranches: TopoBranch[];
  bulkBranches: BulkCheck[];
  /** Ветви с длиной, заданной вручную (manualLength=true) — длина не пересчитывается из координат. */
  manualLenBranches: TopoBranch[];
  /** Изолированные ветви: подсети без связи с поверхностью (нет пути к атмосферному узлу).
   *  Именно они не дают провести расчёт воздухораспределения. */
  isolatedBranches: TopoBranch[];
  /** true — в схеме вообще нет атмосферных узлов (выхода на поверхность). */
  noAtmosphere: boolean;
  tabCounts: {
    near: number; isolated: number; dupes: number;
    dupbranch: number; zeroR: number; zeroLen: number; highR: number; bulkR: number; manualLen: number;
    isolatedBranch: number;
  };
  totalIssues: number;
  /** true — списки обрезаны до maxItems (схема очень большая) */
  truncated: boolean;
}

export interface SchemaCheckOptions {
  nearThreshold?: number;   // м, порог «близких» узлов
  highRThreshold?: number;  // Н·с²/м⁸ (кМюрг), порог большого R ветви
  bulkRThreshold?: number;  // кМюрг, порог R перемычки
  /** ограничение на длину каждого списка (защита от зависания UI) */
  maxItems?: number;
}

// Хэш-ячейка сетки по координатам с шагом cell.
function cellKey(x: number, y: number, z: number, cell: number): string {
  return `${Math.floor(x / cell)}|${Math.floor(y / cell)}|${Math.floor(z / cell)}`;
}

export function checkSchema(
  nodes: TopoNode[],
  branches: TopoBranch[],
  opts: SchemaCheckOptions = {},
): SchemaCheckResult {
  const nearThreshold = opts.nearThreshold ?? 0.01;
  const highRThreshold = opts.highRThreshold ?? 100;
  const bulkRThreshold = opts.bulkRThreshold ?? 686;
  const maxItems = opts.maxItems ?? 500;

  let truncated = false;
  const capReached = (len: number) => len >= maxItems;

  // ── Индексы по ветвям (один проход) ────────────────────────────────────────
  const branchPairs = new Set<string>();          // соединённые пары узлов (оба направления)
  const nodeBranchCount = new Map<string, number>();
  const branchByPair = new Map<string, TopoBranch[]>(); // группировка для дублей ветвей
  const adj = new Map<string, string[]>();        // список смежности узлов (для обхода связности)

  const addAdj = (a: string, b: string) => {
    let arr = adj.get(a);
    if (!arr) { arr = []; adj.set(a, arr); }
    arr.push(b);
  };

  for (const br of branches) {
    branchPairs.add(`${br.fromId}|${br.toId}`);
    branchPairs.add(`${br.toId}|${br.fromId}`);
    nodeBranchCount.set(br.fromId, (nodeBranchCount.get(br.fromId) ?? 0) + 1);
    nodeBranchCount.set(br.toId,   (nodeBranchCount.get(br.toId)   ?? 0) + 1);
    addAdj(br.fromId, br.toId);
    addAdj(br.toId, br.fromId);
    // Ключ без учёта направления
    const key = br.fromId < br.toId ? `${br.fromId}|${br.toId}` : `${br.toId}|${br.fromId}`;
    let arr = branchByPair.get(key);
    if (!arr) { arr = []; branchByPair.set(key, arr); }
    arr.push(br);
  }

  // ── Пространственная сетка узлов ────────────────────────────────────────────
  // Шаг ячейки = порог: сравниваем узел только с соседними ячейками (3×3×3).
  const cell = Math.max(nearThreshold, 1e-6);
  const grid = new Map<string, TopoNode[]>();
  for (const n of nodes) {
    const k = cellKey(n.x, n.y, n.z, cell);
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(n);
  }

  const nearPairs: NearPair[] = [];
  const dupes: DupePair[] = [];
  const seenPair = new Set<string>();               // защита от дублей пар (a|b)
  const thr2 = nearThreshold * nearThreshold;
  const DUP_EPS = 0.01;

  // Для каждого узла проверяем только соседние ячейки
  for (const n of nodes) {
    const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell), cz = Math.floor(n.z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(`${cx + dx}|${cy + dy}|${cz + dz}`);
          if (!arr) continue;
          for (const m of arr) {
            if (m.id === n.id) continue;
            // Каждую пару обрабатываем один раз
            const pk = n.id < m.id ? `${n.id}|${m.id}` : `${m.id}|${n.id}`;
            if (seenPair.has(pk)) continue;
            seenPair.add(pk);

            const ddx = n.x - m.x, ddy = n.y - m.y, ddz = n.z - m.z;

            // Дубли координат (совпадают X,Y,Z с точностью DUP_EPS)
            if (Math.abs(ddx) < DUP_EPS && Math.abs(ddy) < DUP_EPS && Math.abs(ddz) < DUP_EPS) {
              if (!capReached(dupes.length)) dupes.push({ a: n, b: m });
              else truncated = true;
            }

            // Близкие несоединённые узлы
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 <= thr2 && !branchPairs.has(`${n.id}|${m.id}`)) {
              if (!capReached(nearPairs.length)) {
                nearPairs.push({ a: n, b: m, dist: Math.sqrt(d2) });
              } else truncated = true;
            }
          }
        }
      }
    }
  }
  nearPairs.sort((x, y) => x.dist - y.dist);

  // ── Изолированные узлы (нет ни одной ветви) ─────────────────────────────────
  const isolated: TopoNode[] = [];
  for (const n of nodes) {
    if ((nodeBranchCount.get(n.id) ?? 0) === 0) {
      if (!capReached(isolated.length)) isolated.push(n);
      else { truncated = true; break; }
    }
  }

  // ── Дублирующие ветви (одна пара узлов) ─────────────────────────────────────
  const dupBranches: DupBranchGroup[] = [];
  branchByPair.forEach((arr, key) => {
    if (arr.length > 1 && !capReached(dupBranches.length)) dupBranches.push({ branches: arr, key });
    else if (arr.length > 1) truncated = true;
  });

  // ── Ветви по сопротивлению + перемычки (один проход) ────────────────────────
  const zeroRBranches: TopoBranch[] = [];
  const zeroLenBranches: TopoBranch[] = [];
  const highRBranches: TopoBranch[] = [];
  const bulkBranches: BulkCheck[] = [];
  const manualLenBranches: TopoBranch[] = [];
  for (const b of branches) {
    const r = b.resistance ?? 0;
    if (r <= 0) {
      if (!capReached(zeroRBranches.length)) zeroRBranches.push(b); else truncated = true;
    } else if (r > highRThreshold) {
      if (!capReached(highRBranches.length)) highRBranches.push(b); else truncated = true;
    }
    // Ветвь с нулевой длиной не имеет аэродинамического сопротивления —
    // расчёт воздухораспределения по ней невозможен.
    if ((b.length ?? 0) <= 0) {
      if (!capReached(zeroLenBranches.length)) zeroLenBranches.push(b); else truncated = true;
    }
    if (b.hasBulkhead) {
      const rKmu = branchBulkheadRkMurg(b);
      if (rKmu > bulkRThreshold) {
        if (!capReached(bulkBranches.length)) bulkBranches.push({ branch: b, rKmu }); else truncated = true;
      }
    }
    // Ветвь с ручной длиной — потенциальное расхождение с реальной длиной по координатам,
    // что искажает сопротивление. Помечаем для контроля.
    if (b.manualLength) {
      if (!capReached(manualLenBranches.length)) manualLenBranches.push(b); else truncated = true;
    }
  }
  highRBranches.sort((a, b) => (b.resistance ?? 0) - (a.resistance ?? 0));
  bulkBranches.sort((a, b) => b.rKmu - a.rKmu);

  // ── Изолированные ветви (нет пути на поверхность / к атмосфере) ─────────────
  // Расчёт воздухораспределения возможен только для сети, связанной с атмосферой
  // (хотя бы один выход на поверхность). Ветви подсети, из которой НЕЛЬЗЯ дойти
  // до атмосферного узла, «висят в воздухе» и ломают расчёт.
  //
  // Обход в ширину (BFS) стартует со ВСЕХ атмосферных узлов одновременно.
  // Все непосещённые узлы — недостижимы с поверхности; ветвь считается
  // изолированной, если ОБА её узла недостижимы.
  const atmIds: string[] = [];
  for (const n of nodes) if (n.atmosphereLink) atmIds.push(n.id);
  const noAtmosphere = atmIds.length === 0;

  const reachable = new Set<string>();
  if (!noAtmosphere) {
    const queue: string[] = [];
    for (const id of atmIds) {
      if (!reachable.has(id)) { reachable.add(id); queue.push(id); }
    }
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      const neigh = adj.get(cur);
      if (!neigh) continue;
      for (const nx of neigh) {
        if (!reachable.has(nx)) { reachable.add(nx); queue.push(nx); }
      }
    }
  }

  const isolatedBranches: TopoBranch[] = [];
  // Если атмосферных узлов нет — вся построенная сеть фактически изолирована.
  for (const b of branches) {
    const connected = !noAtmosphere && (reachable.has(b.fromId) || reachable.has(b.toId));
    if (!connected) {
      if (!capReached(isolatedBranches.length)) isolatedBranches.push(b);
      else { truncated = true; break; }
    }
  }

  const tabCounts = {
    near: nearPairs.length, isolated: isolated.length, dupes: dupes.length,
    dupbranch: dupBranches.length, zeroR: zeroRBranches.length,
    zeroLen: zeroLenBranches.length,
    highR: highRBranches.length, bulkR: bulkBranches.length,
    manualLen: manualLenBranches.length,
    isolatedBranch: isolatedBranches.length,
  };
  // Ветви с ручной длиной — информационная пометка, не критичная ошибка,
  // поэтому в totalIssues не включаем (чтобы «схема без ошибок» оставалась зелёной).
  const totalIssues = nearPairs.length + isolated.length + dupes.length
    + dupBranches.length + zeroRBranches.length + zeroLenBranches.length
    + highRBranches.length + bulkBranches.length
    + isolatedBranches.length;

  return {
    nearPairs, isolated, dupes, dupBranches, zeroRBranches, zeroLenBranches, highRBranches, bulkBranches,
    manualLenBranches, isolatedBranches, noAtmosphere,
    tabCounts, totalIssues, truncated,
  };
}