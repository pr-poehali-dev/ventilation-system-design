// ─────────────────────────────────────────────────────────────────────────────
// ventPipeLineOps — операции над ВСЕМ вентиляционным ставом целиком.
//
// Став в схеме — это не одна ветвь, а связная цепочка ветвей isVentPipeBranch
// на собственных узлах-дубликатах (см. buildVentPipeLine). Раньше, чтобы
// пересчитать став под другой диаметр или напор, приходилось выделять и удалять
// его ветви по одной, а затем строить став заново. Здесь собраны операции,
// которые работают со ставом как с единым объектом: найти его целиком, изменить
// параметры всех сегментов сразу, удалить вместе с осиротевшими узлами.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoNode, TopoBranch } from "@/lib/topology";

/**
 * Собирает ВЕСЬ став, которому принадлежит ветвь: обход в ширину по связным
 * ветвям вентстава через общие узлы. Ветви обычных выработок обходом не идут —
 * поэтому став не «перетечёт» на горные выработки, к которым он привязан
 * концами (вход и выход воздуха).
 *
 * Если ветвь не принадлежит ставу — возвращает пустой массив.
 */
export function collectVentPipeLine(
  startBranchId: string,
  branches: TopoBranch[],
): string[] {
  const start = branches.find(b => b.id === startBranchId);
  if (!start || !start.isVentPipeBranch) return [];

  // Узел → ветви става, которые к нему подходят.
  const byNode = new Map<string, TopoBranch[]>();
  for (const b of branches) {
    if (!b.isVentPipeBranch) continue;
    for (const nid of [b.fromId, b.toId]) {
      const arr = byNode.get(nid);
      if (arr) arr.push(b); else byNode.set(nid, [b]);
    }
  }

  const seen = new Set<string>([start.id]);
  const queue: TopoBranch[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nid of [cur.fromId, cur.toId]) {
      for (const nb of byNode.get(nid) ?? []) {
        if (seen.has(nb.id)) continue;
        seen.add(nb.id);
        queue.push(nb);
      }
    }
  }
  return [...seen];
}

/** Все ставы схемы: каждый — отдельный связный набор ветвей вентстава. */
export function collectAllVentPipeLines(branches: TopoBranch[]): string[][] {
  const lines: string[][] = [];
  const used = new Set<string>();
  for (const b of branches) {
    if (!b.isVentPipeBranch || used.has(b.id)) continue;
    const line = collectVentPipeLine(b.id, branches);
    line.forEach(id => used.add(id));
    if (line.length) lines.push(line);
  }
  return lines;
}

/**
 * Удаляет став целиком. Вместе с ветвями убираются узлы-дубликаты, ради
 * которых став и строился: после удаления они не держат ни одной ветви и иначе
 * остались бы висеть в схеме мусором. Узлы маршрута (к ним подходят обычные
 * выработки) сохраняются.
 */
export function removeVentPipeLine(
  branchIds: string[],
  nodes: TopoNode[],
  branches: TopoBranch[],
): { nodes: TopoNode[]; branches: TopoBranch[] } {
  const kill = new Set(branchIds);
  const keptBranches = branches.filter(b => !kill.has(b.id));

  const usedNodes = new Set<string>();
  for (const b of keptBranches) { usedNodes.add(b.fromId); usedNodes.add(b.toId); }

  // Кандидаты на удаление — только узлы, которых касался удаляемый став.
  const touched = new Set<string>();
  for (const b of branches) {
    if (!kill.has(b.id)) continue;
    touched.add(b.fromId); touched.add(b.toId);
  }

  const keptNodes = nodes.filter(n => !touched.has(n.id) || usedNodes.has(n.id));
  return { nodes: keptNodes, branches: keptBranches };
}

/** Сводка по ставу — для подписей в меню и в диалоге. */
export function ventPipeLineSummary(
  branchIds: string[],
  branches: TopoBranch[],
): { count: number; length: number; diameter: number } {
  const set = new Set(branchIds);
  const list = branches.filter(b => set.has(b.id));
  return {
    count: list.length,
    length: list.reduce((s, b) => s + (b.length ?? 0), 0),
    diameter: list[0]?.vpDiameter ?? 0,
  };
}
