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

  /** Номер узла для подписи. У импортированных схем id — длинный UUID,
   *  поэтому показываем именно номер, а голый id не показываем никогда. */
  const nodeLabel = (id: string): string => {
    const n = nodeMap.get(id);
    return n?.number || n?.name || "?";
  };

  /**
   * Подпись выработки для списка. Название выработки хранится в поле type
   * («Уклон КТВР гор. +390/+130 м»), поле name используется редко. Раньше при
   * пустом названии в окно попадал внутренний идентификатор вида
   * 944f65d8-e6f1-…, который пользователю ничего не говорит. Теперь вместо
   * него показываем узлы, между которыми идёт выработка, и её длину.
   */
  const branchName = (b: TopoBranch): string => {
    const nm = (b as TopoBranch & { name?: string }).name;
    const title = (b.type || nm || "").trim();
    const route = `${nodeLabel(b.fromId)} → ${nodeLabel(b.toId)}`;
    const len = b.length > 0 ? `, L=${Math.round(b.length)} м` : "";
    return title
      ? `${title} (узлы ${route}${len})`
      : `Без названия · узлы ${route}${len}`;
  };

  return {
    branchIds: [...kill],
    branchLabels: doomed.map(branchName),
    symbols: symList,
    orphanNodeIds: orphanIds,
    orphanNodeLabels: orphanIds.map(id => {
      const n = nodeMap.get(id);
      if (!n) return `Узел ${nodeLabel(id)}`;
      // Номер узла плюс название, если оно задано: «Узел 6 — Сопряжение СВС».
      const num = n.number || n.name || "?";
      return n.number && n.name ? `Узел ${n.number} — ${n.name}` : `Узел ${num}`;
    }),
  };
}