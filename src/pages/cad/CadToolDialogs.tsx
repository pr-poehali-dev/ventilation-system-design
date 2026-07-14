// ─────────────────────────────────────────────────────────────────────────────
// CadToolDialogs — presentational-обёртка над «инструментальными» диалогами:
// условные обозначения, широкоформатная печать, автонумерация, выделение
// подобного, депрессограмма, устойчивость при пожаре, лицензия, групповое
// редактирование ветвей, вентрубопровод, руководство пользователя.
// Логика/состояние остаются в CadPage. Поведение 1:1 с исходником.
// ─────────────────────────────────────────────────────────────────────────────
import type React from "react";
import LegendDialog from "@/components/cad/LegendDialog";
import PrintDialog from "@/components/cad/PrintDialog";
import RenumberDialog, { type RenumberOptions } from "@/components/cad/RenumberDialog";
import SelectSimilarDialog from "@/components/cad/SelectSimilarDialog";
import DepressogramDialog from "@/components/cad/DepressogramDialog";
import FireStabilityDialog from "@/components/cad/FireStabilityDialog";
import LicenseDialog from "@/components/LicenseDialog";
import MultiBranchPropsDialog from "@/components/cad/MultiBranchPropsDialog";
import VentPipeDialog from "@/components/cad/VentPipeDialog";
import HelpDialog from "@/components/cad/HelpDialog";
import { type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";
import { type UnitsConfig } from "@/lib/unitsConfig";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type Position } from "@/lib/positions";
import { type SolveResult } from "@/lib/networkSolver";
type PrintProps = React.ComponentProps<typeof PrintDialog>;
type SchemaSymbol = NonNullable<PrintProps["schemaSymbols"]>[number];
type SavedView = { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };

export interface CadToolDialogsProps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  branchesRaw: TopoBranch[];
  horizons: Horizon[];
  projectFileName: string;
  unitsConfig: UnitsConfig;

  // Условные обозначения
  showLegend: boolean;
  setShowLegend: (v: boolean) => void;

  // Печать
  showPrintDialog: boolean;
  setShowPrintDialog: (v: boolean) => void;
  schemaSymbols: SchemaSymbol[];
  savedViewStateRef: React.MutableRefObject<SavedView | null>;
  savedViewState: SavedView | null;
  canvasSize: { w: number; h: number };
  branchWidth: number;
  branchBorder: number;
  thinLines: boolean;
  colorByHorizon: boolean;
  flowDisplay: PrintProps["flowDisplay"];
  infoConfig: InfoDisplayConfig;
  zScale: number;
  getSvgRef: React.MutableRefObject<(() => string) | null>;
  colorMode: PrintProps["colorMode"];
  posColorInner: boolean;
  posColorOuter: boolean;
  positions: Position[];
  showPositions: boolean;
  scaleLimitsEnabled: boolean;
  xyScale: number;
  printDialogOpenExport: boolean;
  setPrintDialogOpenExport: (v: boolean) => void;

  // Автонумерация
  showRenumberDialog: boolean;
  setShowRenumberDialog: (v: boolean) => void;
  renumberAll: (opts: RenumberOptions | "asc" | "desc") => void;

  // Выделение подобного
  showSelectSimilar: boolean;
  setShowSelectSimilar: (v: boolean) => void;
  selectedBranch: TopoBranch | null;
  selectedSymbolId: string | null;
  setSelectedBranchId: (v: string | null) => void;
  setSelectedBranchIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedNodeId: (v: string | null) => void;
  setSelectedSymbolId: (v: string | null) => void;
  setSelectedSymbolIds: React.Dispatch<React.SetStateAction<Set<string>>>;

  // Депрессограмма
  showDepressogram: boolean;
  setShowDepressogram: (v: boolean) => void;
  setDepressogramHighlight: (v: string[]) => void;
  depressogramPickMode: boolean;
  setDepressogramPickMode: (v: boolean) => void;
  depressogramManualBranches: Set<string>;
  setDepressogramManualBranches: (v: Set<string>) => void;

  // Устойчивость при пожаре
  showFireStability: boolean;
  setShowFireStability: (v: boolean) => void;
  solveResult: SolveResult | null;
  computeFireStabilityFacts: (ambientTemp: number) => Promise<Map<string, boolean>>;

  // Лицензия
  showLicenseDialog: boolean;
  setShowLicenseDialog: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  license: any;
  isDemo: boolean;

  // Групповое редактирование ветвей
  showMultiBranchProps: boolean;
  setShowMultiBranchProps: (v: boolean) => void;
  selectedBranchIds: Set<string>;
  pushHistory: () => void;
  updateBranch: (id: string, patch: Partial<TopoBranch>, saveHistory?: boolean) => void;

  // Вентрубопровод
  showVentPipeDialog: boolean;
  setShowVentPipeDialog: (v: boolean) => void;
  ventPipeBranchIds: string[];

  // Помощь
  showHelpDialog: boolean;
  setShowHelpDialog: (v: boolean) => void;
}

export default function CadToolDialogs(p: CadToolDialogsProps) {
  return (
    <>
      {/* ═══ УСЛОВНЫЕ ОБОЗНАЧЕНИЯ ═══════════════════════════════════════════ */}
      {p.showLegend && (
        <LegendDialog onClose={() => p.setShowLegend(false)} />
      )}

      {/* ═══ ШИРОКОФОРМАТНАЯ ПЕЧАТЬ ════════════════════════════════════════ */}
      {p.showPrintDialog && (
        <PrintDialog
          onClose={() => p.setShowPrintDialog(false)}
          projectName={p.projectFileName.replace(/\.vproj$/, "")}
          nodes={p.nodes}
          branches={p.branches}
          horizons={p.horizons}
          schemaSymbols={p.schemaSymbols}
          viewState={p.savedViewStateRef.current ?? p.savedViewState ?? { scale: 0.4, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 }}
          canvasSize={p.canvasSize}
          branchWidth={p.branchWidth}
          branchBorder={p.branchBorder}
          thinLines={p.thinLines}
          colorByHorizon={p.colorByHorizon}
          flowDisplay={p.flowDisplay}
          infoConfig={p.infoConfig}
          unitsConfig={p.unitsConfig}
          zScale={p.zScale}
          getSvgRaw={() => p.getSvgRef.current?.() ?? ""}
          colorMode={p.colorMode}
          posInnerColors={p.posColorInner && p.positions.length > 0 ? (() => {
            const m = new Map<string, string>();
            p.positions.forEach(pos => pos.branchIds.forEach(bid => { if (!m.has(bid)) m.set(bid, pos.color); }));
            return m.size > 0 ? m : undefined;
          })() : undefined}
          posOuterColors={p.posColorOuter && p.positions.length > 0 ? (() => {
            const m = new Map<string, string>();
            p.positions.forEach(pos => pos.branchIds.forEach(bid => { if (!m.has(bid)) m.set(bid, pos.color); }));
            return m.size > 0 ? m : undefined;
          })() : undefined}
          positions={p.positions}
          showPositions={p.showPositions}
          fixedObjectScale={p.scaleLimitsEnabled}
          xyScale={p.xyScale}
          initialOpenExport={p.printDialogOpenExport}
          onExportDialogOpened={() => p.setPrintDialogOpenExport(false)}
        />
      )}

      {/* ═══ АВТОНУМЕРАЦИЯ ОБЪЕКТОВ ═══════════════════════════════════════ */}
      {p.showRenumberDialog && (
        <RenumberDialog
          nodeCount={p.nodes.length}
          branchCount={p.branchesRaw.length}
          horizons={p.horizons.map((h) => ({ id: h.id, name: h.name }))}
          onClose={() => p.setShowRenumberDialog(false)}
          onConfirm={(opts) => {
            p.renumberAll(opts);
            p.setShowRenumberDialog(false);
          }}
        />
      )}

      {/* ═══ ВЫДЕЛЕНИЕ ПОДОБНОГО (S+S) ══════════════════════════════════════ */}
      {p.showSelectSimilar && (
        <SelectSimilarDialog
          selectedBranch={p.selectedBranch}
          selectedSymbol={p.schemaSymbols.find(s => s.id === p.selectedSymbolId) ?? null}
          branches={p.branches}
          symbols={p.schemaSymbols}
          onConfirm={(branchIds, symbolIds) => {
            if (branchIds.size > 0) {
              const first = Array.from(branchIds)[0];
              p.setSelectedBranchId(first);
              p.setSelectedBranchIds(new Set(branchIds));
              p.setSelectedNodeId(null);
              p.setSelectedSymbolId(null);
              p.setSelectedSymbolIds(new Set());
            }
            if (symbolIds.size > 0) {
              p.setSelectedSymbolId(Array.from(symbolIds)[0]);
              p.setSelectedSymbolIds(new Set(symbolIds));
              p.setSelectedBranchId(null);
              p.setSelectedBranchIds(new Set());
            }
            p.setShowSelectSimilar(false);
          }}
          onClose={() => p.setShowSelectSimilar(false)}
        />
      )}

      {/* ── Депрессограмма ──────────────────────────────────────────────── */}
      {p.showDepressogram && (
        <DepressogramDialog
          nodes={p.nodes}
          branches={p.branches}
          onClose={() => {
            p.setShowDepressogram(false);
            p.setDepressogramHighlight([]);
            p.setDepressogramPickMode(false);
            p.setDepressogramManualBranches(new Set());
          }}
          onHighlightPath={ids => p.setDepressogramHighlight(ids)}
          pickMode={p.depressogramPickMode}
          onPickModeChange={active => {
            p.setDepressogramPickMode(active);
            if (!active) p.setDepressogramManualBranches(new Set());
          }}
          manualBranchIds={p.depressogramManualBranches}
          onClearManual={() => p.setDepressogramManualBranches(new Set())}
        />
      )}

      {/* ── Устойчивость при пожаре (Акт устойчивости) ──────────────────── */}
      {p.showFireStability && (
        <FireStabilityDialog
          branches={p.branches}
          nodes={p.nodes}
          positions={p.positions}
          projectName={p.projectFileName.replace(/\.vproj$/, "")}
          solved={!!p.solveResult}
          computeReversalFacts={p.computeFireStabilityFacts}
          onClose={() => p.setShowFireStability(false)}
        />
      )}

      {/* ── Диалог лицензии ─────────────────────────────────────────────── */}
      {p.showLicenseDialog && (
        <LicenseDialog
          license={p.license}
          onClose={() => p.setShowLicenseDialog(false)}
          required={p.isDemo && !p.license.info}
        />
      )}

      {/* ── Групповое редактирование ветвей ────────────────────────────── */}
      {p.showMultiBranchProps && p.selectedBranchIds.size > 1 && (() => {
        const multiBranches = [...p.selectedBranchIds]
          .map(id => p.branches.find(b => b.id === id))
          .filter(Boolean) as typeof p.branches;
        if (multiBranches.length < 2) return null;
        return (
          <MultiBranchPropsDialog
            branches={multiBranches}
            onClose={() => p.setShowMultiBranchProps(false)}
            onApply={(patch) => {
              p.pushHistory();
              [...p.selectedBranchIds].forEach(id => p.updateBranch(id, patch, false));
            }}
          />
        );
      })()}

      {/* ── Диалог вентрубопровода ─────────────────────────────────────── */}
      {p.showVentPipeDialog && p.ventPipeBranchIds.length > 0 && (() => {
        const vpBranches = p.ventPipeBranchIds
          .map(id => p.branches.find(b => b.id === id))
          .filter(Boolean) as typeof p.branches;
        if (vpBranches.length === 0) return null;
        return (
          <VentPipeDialog
            branches={vpBranches}
            onClose={() => p.setShowVentPipeDialog(false)}
            onApply={(patch) => {
              p.ventPipeBranchIds.forEach(id => p.updateBranch(id, patch, false));
              p.pushHistory();
            }}
            onRemove={() => {
              p.ventPipeBranchIds.forEach(id => p.updateBranch(id, { hasVentPipe: false }, false));
              p.pushHistory();
              p.setShowVentPipeDialog(false);
            }}
          />
        );
      })()}

      {/* ── Руководство пользователя ────────────────────────────────────── */}
      {p.showHelpDialog && (
        <HelpDialog onClose={() => p.setShowHelpDialog(false)} />
      )}
    </>
  );
}