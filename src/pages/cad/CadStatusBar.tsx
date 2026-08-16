// ─────────────────────────────────────────────────────────────────────────────
// CadStatusBar.tsx — нижняя строка состояния: выделенный объект, инструмент,
// режим вида, Z-уровень, итог расчёта сети и кнопка журнала.
//
// Вынесено из Cad.tsx БЕЗ изменений разметки, стилей и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type SolveResult } from "@/lib/networkSolver";
import { type LogEntry } from "@/components/cad/LogPanel";
import { type CadTool } from "@/components/cad/TopoCanvas";
import { toolLabel } from "./cadComponents";

interface CadStatusBarProps {
  selectedNode: TopoNode | null | undefined;
  selectedBranch: TopoBranch | null | undefined;
  tool: CadTool;
  viewInfo: { is3D: boolean; azimuth: number; elevation: number };
  zLevel: number;
  solveResult: SolveResult | null;
  branches: TopoBranch[];
  showLogPanel: boolean;
  setShowLogPanel: (fn: (v: boolean) => boolean) => void;
  logEntries: LogEntry[];
  /** Включён ли режим правки маркшейдерских координат (F2) */
  surveyEditMode?: boolean;
  /** Сколько узлов сдвинуто с маркшейдерских мест */
  movedNodeCount?: number;
}

export default function CadStatusBar({
  selectedNode, selectedBranch, tool, viewInfo, zLevel,
  solveResult, branches, showLogPanel, setShowLogPanel, logEntries,
  surveyEditMode, movedNodeCount = 0,
}: CadStatusBarProps) {
  return (
  <div className="h-5 flex items-center justify-between px-2 text-[11px]"
    style={{ background: "#f0f0f0", borderTop: "1px solid #b8b8b8", color: "#444" }}>
    <div className="flex items-center gap-3">
      {/* Режим правки координат должно быть невозможно не заметить: в нём
          перетаскивание меняет длины выработок и результат расчёта. */}
      {surveyEditMode ? (
        <span className="px-1.5 rounded font-bold"
          style={{ background: "#dc2626", color: "#fff" }}>
          ПРАВКА КООРДИНАТ (F2)
        </span>
      ) : (
        <span>Готово</span>
      )}
      <span className="text-gray-400">|</span>
      {movedNodeCount > 0 && (
        <>
          <span title="Узлы сдвинуты для читаемости схемы. Расчёт идёт по маркшейдерским координатам."
            style={{ color: "#b45309" }}>
            Сдвинуто узлов: <b>{movedNodeCount}</b>
          </span>
          <span className="text-gray-400">|</span>
        </>
      )}
      {selectedNode && <span>Узел: <b>{selectedNode.number || selectedNode.id}</b> · X={selectedNode.x} Y={selectedNode.y} Z={selectedNode.z}</span>}
      {selectedBranch && <span>Ветвь: <b>{selectedBranch.id}</b> ({selectedBranch.fromId} → {selectedBranch.toId}) · L={selectedBranch.length} м</span>}
      {!selectedNode && !selectedBranch && <span>Выделите узел или ветвь</span>}
    </div>
    <div className="flex items-center gap-3">
      <span>Инструмент: <b>{toolLabel(tool)}</b></span>
      <span className="text-gray-400">|</span>
      <span style={{ color: viewInfo.is3D ? "#7c3aed" : "#0369a1", fontWeight: 600 }}>
        {viewInfo.is3D ? `3D · Az ${viewInfo.azimuth.toFixed(0)}° / El ${viewInfo.elevation.toFixed(0)}°` : "2D План"}
      </span>
      <span className="text-gray-400">|</span>
      <span>Z-уровень: {zLevel} м</span>
      <span className="text-gray-400">|</span>
      {solveResult ? (
        <>
          <span className="px-1.5 py-0.5 rounded font-semibold" style={{
            background: solveResult.ok ? "#dcfce7" : "#fee2e2",
            color: solveResult.ok ? "#15803d" : "#b91c1c",
            border: `1px solid ${solveResult.ok ? "#86efac" : "#fca5a5"}`,
          }}>
            {solveResult.ok ? "✔" : "✘"} Расчёт: {solveResult.ok ? "сошёлся" : "не сошёлся"} за {solveResult.iterations} итер.
          </span>
          {/* Статус реверса по нормативу ПБ */}
          {branches.some(b => b.fanReverse) && (() => {
            const revDiag = solveResult.diagnostics?.find(d => d.category === "fan" && (d.level === "error" || d.level === "warning" || d.level === "info"));
            if (!revDiag) return null;
            const colors = { error: "#dc2626", warning: "#d97706", info: "#16a34a" };
            const icons  = { error: "✕", warning: "⚠", info: "✓" };
            return (
              <span className="ml-1 px-1.5 py-0.5 rounded text-[10px]"
                style={{ background: revDiag.level === "error" ? "#fee2e2" : revDiag.level === "warning" ? "#fef3c7" : "#f0fdf4",
                  color: colors[revDiag.level], border: `1px solid ${revDiag.level === "error" ? "#fca5a5" : revDiag.level === "warning" ? "#fcd34d" : "#86efac"}`,
                  cursor: "pointer" }}
                title={revDiag.message}
                onClick={() => {}}>
                {icons[revDiag.level]} Реверс
              </span>
            );
          })()}
        </>
      ) : (
        <span className="px-1.5 py-0.5 rounded" style={{
          background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d",
        }} title="Нажмите F9, чтобы выполнить расчёт сети">
          ● Расчёт не выполнялся — F9
        </span>
      )}

      <span className="text-gray-400">|</span>
      <button
        onClick={() => setShowLogPanel(v => !v)}
        className="px-2 py-0.5 rounded text-[11px]"
        style={{
          background: showLogPanel ? "#1e293b" : "#e2e8f0",
          color: showLogPanel ? "#e2e8f0" : "#475569",
          border: "1px solid #cbd5e1",
          cursor: "pointer",
        }}
      >
        Лог{logEntries.length > 0 ? ` (${logEntries.length})` : ""}
      </button>
      <span className="text-gray-400">|</span>
      <span style={{ color: "#6b7280" }}>S+S — выделить подобное</span>
    </div>
  </div>
  );
}