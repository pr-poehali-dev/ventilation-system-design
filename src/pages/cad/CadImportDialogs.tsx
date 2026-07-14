// ─────────────────────────────────────────────────────────────────────────────
// CadImportDialogs — presentational-обёртка над кластером диалогов импорта/
// экспорта, справочника оборудования, панели лога и контекстного меню.
// Логика и состояние остаются в CadPage; сюда прокидывается только то, что
// реально используется (единый объект props). Поведение 1:1 с исходником.
// ─────────────────────────────────────────────────────────────────────────────
import type React from "react";
import DxfImportDialog from "@/components/cad/DxfImportDialog";
import { type DxfImportResult } from "@/lib/dxfImport";
import ExcelImportDialog from "@/components/cad/ExcelImportDialog";
import { type ExcelImportResult } from "@/lib/excelImport";
import ExcelExportDialog from "@/components/cad/ExcelExportDialog";
import CombinedImportDialog from "@/components/cad/CombinedImportDialog";
import { type CombinedImportResult } from "@/lib/combinedImport";
import CsvImportDialog from "@/components/cad/CsvImportDialog";
import Vent2CsvImportDialog from "@/components/cad/Vent2CsvImportDialog";
import { type CsvImportResult } from "@/lib/csvImport";
import VentsimImportDialog from "@/components/cad/VentsimImportDialog";
import { type VentsimImportResult } from "@/lib/ventsimImport";
import EquipmentRefDialog, { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import LogPanel, { type LogEntry } from "@/components/cad/LogPanel";
import CadContextMenu from "@/components/cad/CadContextMenu";
import { nodeContextItems, branchContextItems, canvasContextItems } from "./cadComponents";
import { type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";
import { type UnitsConfig } from "@/lib/unitsConfig";

// Тип-псевдонимы берём из React-компонентов, чтобы сигнатуры совпадали 1:1
type EquipTab = React.ComponentProps<typeof EquipmentRefDialog>["activeTab"];
type CtxMenuState = { kind: "node" | "branch" | "canvas"; id?: string; x: number; y: number };
type ImportMode = "replace" | "append";

export interface CadImportDialogsProps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  projectFileName: string;
  unitsConfig: UnitsConfig;

  showDxfImport: boolean;
  setShowDxfImport: (v: boolean) => void;
  handleDxfImport: (r: DxfImportResult, mode: ImportMode) => void;

  showExcelImport: boolean;
  setShowExcelImport: (v: boolean) => void;
  handleExcelImport: (r: ExcelImportResult, mode: ImportMode) => void;

  showExcelExport: boolean;
  setShowExcelExport: (v: boolean) => void;

  showCombinedImport: boolean;
  setShowCombinedImport: (v: boolean) => void;
  handleCombinedImport: (r: CombinedImportResult, mode: ImportMode) => void;

  showCsvImport: boolean;
  setShowCsvImport: (v: boolean) => void;
  handleCsvImport: (r: CsvImportResult, mode: ImportMode) => void;

  showVent2CsvImport: boolean;
  setShowVent2CsvImport: (v: boolean) => void;
  handleVent2CsvImport: (r: CsvImportResult, mode: ImportMode) => void;

  showVentsimImport: boolean;
  setShowVentsimImport: (v: boolean) => void;
  handleVentsimImport: (r: VentsimImportResult, mode: ImportMode) => void;

  showEquipRef: boolean;
  setShowEquipRef: (v: boolean) => void;
  equipRefTab: EquipTab;
  setEquipRefTab: React.Dispatch<React.SetStateAction<EquipTab>>;
  mineFans: MineFanExport[];
  setMineFans: React.Dispatch<React.SetStateAction<MineFanExport[]>>;
  mineBulkheads: MineBulkheadExport[];
  setMineBulkheads: React.Dispatch<React.SetStateAction<MineBulkheadExport[]>>;
  mineTypes: BranchType[];
  setMineTypes: React.Dispatch<React.SetStateAction<BranchType[]>>;
  setUnitsConfig: (v: UnitsConfig) => void;

  showLogPanel: boolean;
  setShowLogPanel: (v: boolean) => void;
  logEntries: LogEntry[];
  setLogEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>;

  ctxMenu: CtxMenuState | null;
  setCtxMenu: (v: CtxMenuState | null) => void;
  handleCtxAction: (action: string) => void;
  branchParamBuffer: unknown;
  selectedNodeIds: Set<string>;
  selectedBranchIds: Set<string>;
}

export default function CadImportDialogs(p: CadImportDialogsProps) {
  return (
    <>
      {/* ═══ DXF ИМПОРТ ДИАЛОГ ═══════════════════════════════════════════ */}
      {p.showDxfImport && (
        <DxfImportDialog
          onImport={p.handleDxfImport}
          onClose={() => p.setShowDxfImport(false)}
        />
      )}

      {/* ═══ EXCEL ИМПОРТ ДИАЛОГ (Вентиляция 2.0) ══════════════════════════ */}
      {p.showExcelImport && (
        <ExcelImportDialog
          onImport={p.handleExcelImport}
          onClose={() => p.setShowExcelImport(false)}
        />
      )}

      {/* ═══ EXCEL ЭКСПОРТ ДИАЛОГ ═══════════════════════════════════════════ */}
      {p.showExcelExport && (
        <ExcelExportDialog
          branches={p.branches}
          nodes={p.nodes}
          horizons={p.horizons}
          projectName={p.projectFileName.replace(/\.vproj$/, "")}
          onClose={() => p.setShowExcelExport(false)}
        />
      )}

      {/* ═══ КОМБИНИРОВАННЫЙ ИМПОРТ DXF + EXCEL ════════════════════════════ */}
      {p.showCombinedImport && (
        <CombinedImportDialog
          onImport={p.handleCombinedImport}
          onClose={() => p.setShowCombinedImport(false)}
        />
      )}

      {/* ═══ CSV ИМПОРТ (АэроСеть) ══════════════════════════════════════════ */}
      {p.showCsvImport && (
        <CsvImportDialog
          onImport={p.handleCsvImport}
          onClose={() => p.setShowCsvImport(false)}
        />
      )}

      {/* ═══ CSV ИМПОРТ (Вентиляция 2.0) ════════════════════════════════════ */}
      {p.showVent2CsvImport && (
        <Vent2CsvImportDialog
          onImport={p.handleVent2CsvImport}
          onClose={() => p.setShowVent2CsvImport(false)}
        />
      )}

      {/* ═══ CSV ИМПОРТ (Ventsim) ════════════════════════════════════════════ */}
      {p.showVentsimImport && (
        <VentsimImportDialog
          onImport={p.handleVentsimImport}
          onClose={() => p.setShowVentsimImport(false)}
        />
      )}

      {/* ═══ СПРАВОЧНИК ОБОРУДОВАНИЯ ════════════════════════════════════════ */}
      {p.showEquipRef && (
        <EquipmentRefDialog
          activeTab={p.equipRefTab}
          onTabChange={p.setEquipRefTab}
          onClose={() => p.setShowEquipRef(false)}
          onMineFansChange={p.setMineFans}
          onMineBulkheadsChange={p.setMineBulkheads}
          onBranchTypesChange={p.setMineTypes}
          initialMineFans={p.mineFans}
          initialBranchTypes={p.mineTypes}
          initialMineBulkheads={p.mineBulkheads}
          unitsConfig={p.unitsConfig}
          onUnitsConfigChange={p.setUnitsConfig}
        />
      )}

      {/* ═══ ПАНЕЛЬ ЛОГА РАСЧЁТА ════════════════════════════════════════ */}
      {p.showLogPanel && (
        <LogPanel
          entries={p.logEntries}
          onClose={() => p.setShowLogPanel(false)}
          onClear={() => p.setLogEntries([])}
        />
      )}

      {/* ─── КОНТЕКСТНОЕ МЕНЮ ──────────────────────────────────────────── */}
      {p.ctxMenu && (
        <CadContextMenu
          x={p.ctxMenu.x}
          y={p.ctxMenu.y}
          onClose={() => p.setCtxMenu(null)}
          onSelect={p.handleCtxAction}
          items={
            p.ctxMenu.kind === "node" ? nodeContextItems(
              p.nodes.find((n) => n.id === p.ctxMenu!.id) ?? null,
              p.selectedNodeIds.size
            ) :
            p.ctxMenu.kind === "branch" ? branchContextItems(
              p.branches.find((b) => b.id === p.ctxMenu!.id) ?? null,
              !!p.branchParamBuffer,
              p.selectedBranchIds.size
            ) :
            canvasContextItems()
          }
        />
      )}
    </>
  );
}
