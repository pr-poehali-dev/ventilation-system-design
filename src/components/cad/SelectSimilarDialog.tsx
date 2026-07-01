import { useState } from "react";
import type { TopoBranch } from "@/lib/topology";
import type { SchemaSymbol } from "@/pages/Cad";

export type SimilarCriterion =
  | "same_type"           // того же типа (type)
  | "same_layer"          // того же слоя
  | "same_horizon"        // того же горизонта
  | "same_surface"        // той же крепи (surfaceId)
  | "same_fan_curve"      // того же шаблона вентилятора
  | "all_with_fan"        // все с вентиляторами
  | "all_branches"        // все ветви
  | "same_symbol_type"    // все УО того же типа
  | "all_symbols"         // все УО на схеме
;

interface Props {
  /** Выбранная ветвь (если есть) */
  selectedBranch: TopoBranch | null;
  /** Выбранный символ УО (если есть) */
  selectedSymbol: SchemaSymbol | null;
  branches: TopoBranch[];
  symbols: SchemaSymbol[];
  onConfirm: (branchIds: Set<string>, symbolIds: Set<string>) => void;
  onClose: () => void;
}

const CRITERION_LABELS: Record<SimilarCriterion, string> = {
  same_type:        "Ветви того же типа",
  same_layer:       "Ветви того же слоя",
  same_horizon:     "Ветви того же горизонта",
  same_surface:     "Ветви с той же крепью",
  same_fan_curve:   "Ветви с тем же шаблоном вентилятора",
  all_with_fan:     "Все ветви с вентиляторами",
  all_branches:     "Все ветви на схеме",
  same_symbol_type: "Все УО того же типа",
  all_symbols:      "Все условные обозначения",
};

export default function SelectSimilarDialog({ selectedBranch, selectedSymbol, branches, symbols, onConfirm, onClose }: Props) {
  const [checked, setChecked] = useState<Set<SimilarCriterion>>(
    () => new Set(selectedBranch ? ["same_type"] : selectedSymbol ? ["same_symbol_type"] : [])
  );

  const toggle = (c: SimilarCriterion) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const branchCriteria: SimilarCriterion[] = [
    "same_type", "same_layer", "same_horizon", "same_surface",
    "same_fan_curve", "all_with_fan", "all_branches",
  ];
  const symbolCriteria: SimilarCriterion[] = ["same_symbol_type", "all_symbols"];

  const handleSelect = () => {
    const branchIds = new Set<string>();
    const symbolIds = new Set<string>();

    for (const c of checked) {
      if (c === "same_type" && selectedBranch) {
        branches.filter(b => b.type === selectedBranch.type).forEach(b => branchIds.add(b.id));
      } else if (c === "same_layer" && selectedBranch) {
        branches.filter(b => b.layer === selectedBranch.layer).forEach(b => branchIds.add(b.id));
      } else if (c === "same_horizon" && selectedBranch) {
        branches.filter(b => b.horizonId === selectedBranch.horizonId).forEach(b => branchIds.add(b.id));
      } else if (c === "same_surface" && selectedBranch) {
        branches.filter(b => b.surfaceId === selectedBranch.surfaceId).forEach(b => branchIds.add(b.id));
      } else if (c === "same_fan_curve" && selectedBranch) {
        branches.filter(b => b.hasFan && b.fanCurveId === selectedBranch.fanCurveId).forEach(b => branchIds.add(b.id));
      } else if (c === "all_with_fan") {
        branches.filter(b => b.hasFan).forEach(b => branchIds.add(b.id));
      } else if (c === "all_branches") {
        branches.forEach(b => branchIds.add(b.id));
      } else if (c === "same_symbol_type" && selectedSymbol) {
        symbols.filter(s => s.typeId === selectedSymbol.typeId).forEach(s => symbolIds.add(s.id));
      } else if (c === "all_symbols") {
        symbols.forEach(s => symbolIds.add(s.id));
      }
    }

    onConfirm(branchIds, symbolIds);
  };

  const visibleBranchCriteria = branchCriteria.filter(c => {
    if (c === "same_fan_curve") return selectedBranch?.hasFan && selectedBranch.fanCurveId;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
      <div className="bg-white rounded shadow-lg" style={{ width: 360, maxHeight: "90vh", overflow: "auto", border: "1px solid #9ca3af" }}>
        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2"
          style={{ background: "#e8eef8", borderBottom: "1px solid #c8d4e8" }}>
          <span className="text-[12px] font-semibold text-gray-800">Выделение подобного</span>
          <button onClick={onClose}
            className="text-[12px] text-gray-500 hover:text-gray-800"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>✕</button>
        </div>

        <div className="px-3 py-2">
          {!selectedBranch && !selectedSymbol && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
              Выберите ветвь или УО на схеме, затем нажмите S+S
            </div>
          )}
          {/* Группа ветвей */}
          {visibleBranchCriteria.map(c => {
            const enabled = !!selectedBranch || c === "all_with_fan" || c === "all_branches";
            let desc = "";
            if (selectedBranch) {
              if (c === "same_type") desc = selectedBranch.type || "—";
              else if (c === "same_layer") desc = selectedBranch.layer || "—";
              else if (c === "same_horizon") desc = selectedBranch.horizonId || "—";
              else if (c === "same_surface") desc = selectedBranch.surface || "—";
              else if (c === "same_fan_curve") desc = selectedBranch.fanName || "—";
            }
            return (
              <label key={c}
                className="flex items-start gap-2 py-1 cursor-pointer"
                style={{ opacity: enabled ? 1 : 0.4, borderBottom: "1px solid #f0f0f0" }}>
                <input
                  type="checkbox"
                  checked={checked.has(c)}
                  onChange={() => enabled && toggle(c)}
                  disabled={!enabled}
                  style={{ marginTop: 2, flexShrink: 0 }} />
                <span className="text-[11px] text-gray-700 leading-tight">
                  {CRITERION_LABELS[c]}
                  {desc && <span className="text-gray-400 ml-1">: {desc}</span>}
                </span>
              </label>
            );
          })}

          {/* Разделитель перед УО */}
          <div className="my-1.5" style={{ borderTop: "1px solid #e5e7eb" }} />

          {symbolCriteria.map(c => {
            const enabled = c === "all_symbols" || !!selectedSymbol;
            let desc = "";
            if (selectedSymbol && c === "same_symbol_type") desc = selectedSymbol.typeId;
            return (
              <label key={c}
                className="flex items-start gap-2 py-1 cursor-pointer"
                style={{ opacity: enabled ? 1 : 0.4, borderBottom: "1px solid #f0f0f0" }}>
                <input
                  type="checkbox"
                  checked={checked.has(c)}
                  onChange={() => enabled && toggle(c)}
                  disabled={!enabled}
                  style={{ marginTop: 2, flexShrink: 0 }} />
                <span className="text-[11px] text-gray-700 leading-tight">
                  {CRITERION_LABELS[c]}
                  {desc && <span className="text-gray-400 ml-1">: {desc}</span>}
                </span>
              </label>
            );
          })}
        </div>

        {/* Кнопки */}
        <div className="flex justify-end gap-2 px-3 py-2"
          style={{ borderTop: "1px solid #e5e7eb", background: "#f8faff" }}>
          <button onClick={onClose}
            className="text-[11px] px-4 py-1 rounded"
            style={{ background: "#e5e7eb", border: "1px solid #c8c8c8", cursor: "pointer" }}>
            Отмена
          </button>
          <button onClick={handleSelect}
            disabled={checked.size === 0}
            className="text-[11px] px-4 py-1 rounded"
            style={{ background: checked.size > 0 ? "#2563eb" : "#93c5fd", color: "white", border: "none", cursor: checked.size > 0 ? "pointer" : "default" }}>
            Выбрать
          </button>
        </div>
      </div>
    </div>
  );
}