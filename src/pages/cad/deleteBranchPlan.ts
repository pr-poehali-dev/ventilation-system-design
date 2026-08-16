// ─────────────────────────────────────────────────────────────────────────────
// deleteBranchPlan — что именно исчезнет из схемы вместе с удаляемыми ветвями.
//
// Раньше ветвь удалялась молча: вместе с ней со схемы пропадали вентиляторы и
// перемычки, а узлы на её концах оставались висеть ни к чему не привязанными.
// Изолированные узлы ломают расчёт воздухораспределения — сеть перестаёт быть
// связной, и решатель либо не сходится, либо выдаёт мусор.
//
// Здесь считается ПЛАН удаления: список условных обозначений и осиротевших
// узлов. Его показывают пользователю до удаления, чтобы он видел последствия.
// ─────────────────────────────────────────────────────────────────────────────
import type { TopoNode, TopoBranch } from "@/lib/topology";

export interface DeleteSymbolInfo {
  id: string;
  typeId: string;
  /** Человеческое название для списка в диалоге */
  label: string;
}

export interface DeleteBranchPlan {
  /** Ветви, которые будут удалены */
  branchIds: string[];
  /** Названия ветвей — для списка в диалоге */
  branchLabels: string[];
  /** УО на этих ветвях: вентиляторы, перемычки, вентили и прочее */
  symbols: DeleteSymbolInfo[];
  /** Узлы, которые после удаления не удержит ни одна ветвь */
  orphanNodeIds: string[];
  /** Номера осиротевших узлов — для списка в диалоге */
  orphanNodeLabels: string[];
}

interface SymbolLite { id: string; typeId: string; branchId?: string }

/**
 * Считает последствия удаления ветвей: какие УО с них исчезнут и какие узлы
 * останутся изолированными.
 */
export function planBranchDeletion(
  branchIds: string[],
  nodes: TopoNode[],
  branches: TopoBranch[],
  symbols: SymbolLite[],
  symbolLabel: (typeId: string) => string,
): DeleteBranchPlan {
  const kill = new Set(branchIds);
  const doomed = branches.filter(b => kill.has(b.id));
  const kept = branches.filter(b => !kill.has(b.id));

  // УО, привязанные к удаляемым ветвям — они исчезнут вместе с ними.
  const symList = symbols
    .filter(s => s.branchId && kill.has(s.branchId))
    .map(s => ({ id: s.id, typeId: s.typeId, label: symbolLabel(s.typeId) }));

  // Узлы, за которые ещё держится хоть одна оставшаяся ветвь.
  const alive = new Set<string>();
  for (const b of kept) { alive.add(b.fromId); alive.add(b.toId); }

  // Осиротевшие — узлы удаляемых ветвей, которых больше ничто не держит.
  const orphanIds: string[] = [];
  const seen = new Set<string>();
  for (const b of doomed) {
    for (const nid of [b.fromId, b.toId]) {
      if (seen.has(nid) || alive.has(nid)) continue;
      seen.add(nid);
      orphanIds.push(nid);
    }
  }

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchName = (b: TopoBranch): string => {
    const nm = (b as TopoBranch & { name?: string }).name;
    if (nm) return nm;
    if (b.type) return b.type;
    return `Ветвь ${b.id.slice(-4)}`;
  };

  return {
    branchIds: [...kill],
    branchLabels: doomed.map(branchName),
    symbols: symList,
    orphanNodeIds: orphanIds,
    orphanNodeLabels: orphanIds.map(id => {
      const n = nodeMap.get(id);
      return n ? `Узел ${n.number || n.name || id.slice(-4)}` : `Узел ${id.slice(-4)}`;
    }),
  };
}
