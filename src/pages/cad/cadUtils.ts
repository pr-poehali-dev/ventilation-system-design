import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { CompareBranchDiff, CompareNodeDiff } from "./cadTypes";

// ─── Утилиты сравнения схем ──────────────────────────────────────────────────

export function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Да" : "Нет";
  if (typeof v === "number") return isNaN(v) ? "—" : String(Math.round(v * 1000) / 1000);
  return String(v).slice(0, 40);
}

const BRANCH_COMPARE_FIELDS: { field: keyof TopoBranch; label: string }[] = [
  { field: "type",        label: "Тип выработки" },
  { field: "length",      label: "Длина, м" },
  { field: "area",        label: "Сечение, м²" },
  { field: "manualR",     label: "Сопр. R (вручную)" },
  { field: "alphaCoef",   label: "Коэф. α" },
  { field: "hasFan",      label: "Вентилятор" },
  { field: "fanPressure", label: "Давление вент., Па" },
  { field: "fanName",     label: "Наименование вент." },
  { field: "fanStopped",  label: "Вент. остановлен" },
  { field: "hasBulkhead", label: "Перемычка" },
  { field: "bulkheadR",   label: "R перемычки" },
  { field: "name",        label: "Название" },
  { field: "horizonId",   label: "Горизонт" },
];

export function compareBranches(
  oldBranches: TopoBranch[],
  newBranches: TopoBranch[],
): CompareBranchDiff[] {
  const result: CompareBranchDiff[] = [];
  const oldMap = new Map(oldBranches.map(b => [b.id, b]));
  const newMap = new Map(newBranches.map(b => [b.id, b]));
  for (const [id, ob] of oldMap) {
    if (!newMap.has(id)) {
      result.push({ id, status: "removed", name: ob.name || ob.id, fromId: ob.fromId, toId: ob.toId });
    }
  }
  for (const [id, nb] of newMap) {
    const ob = oldMap.get(id);
    if (!ob) {
      result.push({ id, status: "added", name: nb.name || nb.id, fromId: nb.fromId, toId: nb.toId });
    } else {
      const changes: CompareBranchDiff["changes"] = [];
      for (const { field, label } of BRANCH_COMPARE_FIELDS) {
        const ov = ob[field], nv = nb[field];
        if (JSON.stringify(ov) !== JSON.stringify(nv)) {
          changes.push({ field: field as string, label, oldVal: formatVal(ov), newVal: formatVal(nv) });
        }
      }
      if (changes.length > 0) {
        result.push({ id, status: "changed", name: nb.name || nb.id, fromId: nb.fromId, toId: nb.toId, changes });
      }
    }
  }
  return result;
}

export function compareNodes(
  oldNodes: TopoNode[],
  newNodes: TopoNode[],
): CompareNodeDiff[] {
  const result: CompareNodeDiff[] = [];
  const oldMap = new Map(oldNodes.map(n => [n.id, n]));
  const newMap = new Map(newNodes.map(n => [n.id, n]));
  for (const [id, on] of oldMap) {
    if (!newMap.has(id)) result.push({ id, status: "removed", name: on.name || id });
  }
  for (const [id, nn] of newMap) {
    const on = oldMap.get(id);
    if (!on) {
      result.push({ id, status: "added", name: nn.name || id });
    } else {
      const changes: CompareNodeDiff["changes"] = [];
      (["name", "atmosphereLink", "x", "y", "z"] as const).forEach(f => {
        const ov = on[f], nv = nn[f];
        if (JSON.stringify(ov) !== JSON.stringify(nv)) {
          changes.push({ field: f, label: f, oldVal: formatVal(ov), newVal: formatVal(nv) });
        }
      });
      if (changes.length > 0) result.push({ id, status: "changed", name: nn.name || id, changes });
    }
  }
  return result;
}
