import React from "react";
import { type TopoBranch } from "@/lib/topology";
import { type Props, type ViewState, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";
import { renderSymbolNode, type SymbolItem } from "@/components/cad/topoCanvas/TopoCanvasSymbolNode";
import { createFlowArrowRenderer } from "@/components/cad/topoCanvas/TopoCanvasFlowArrows";
import { buildOverlayLayers } from "@/components/cad/topoCanvas/TopoCanvasOverlayLayers";

// ─────────────────────────────────────────────────────────────────────────────
// Оверлей УСЛОВНЫХ ОБОЗНАЧЕНИЙ поверх canvas (вынесено из TopoCanvas.tsx).
// Разметка и логика перенесены 1:1, поведение не менялось.
//
// Зачем нужен: в canvas-режиме (большие схемы) сама схема рисуется на холсте,
// а символы УО остаются интерактивным SVG поверх него — иначе по ним нельзя
// было бы кликать и таскать их мышью.
//
// СОСТАВ (файл разбит на части, логика при этом не менялась):
//   • TopoCanvasSymbolNode    — отрисовка одного символа УО и его подписей;
//   • TopoCanvasFlowArrows    — стрелки направления движения воздуха;
//   • TopoCanvasOverlayLayers — сборка слоёв по горизонтам: символы,
//     перекрыватели ветвей, узлы поверх символов, задымление;
//   • этот файл               — сам <svg>-контейнер, обработчики мыши и
//     передача данных в перечисленные части.
// ─────────────────────────────────────────────────────────────────────────────

/** Всё, что оверлею нужно от TopoCanvas: данные, состояние вида и обработчики. */
export interface SymbolsOverlayDeps {
  useCanvas: boolean;
  size: { w: number; h: number };
  view: ViewState;
  cursorStyle: string;
  panStart: unknown;
  rotStart: unknown;
  isZooming: boolean;
  fixedObjectScale: boolean;
  branchBorder: number;
  scaleLimits?: Props["scaleLimits"];
  editingPrintLayerId?: string | null;
  tool: Props["tool"];
  branches: TopoBranch[];
  branchesSorted: { branch: TopoBranch; depth: number; hOrder: number }[];
  nodesSorted: ProjNodeEntry[];
  projNodesMap: Map<string, ProjNodeEntry>;
  projectWithZ: (p: { x: number; y: number; z: number }) => { sx: number; sy: number; depth: number };
  branchById: Map<string, TopoBranch>;
  legendTypeById: Map<string, (typeof import("@/lib/schemaSymbols"))["LEGEND_TYPES"][number]>;
  horizonOrderMap: Map<string, number>;
  nodeAdjBranches: Map<string, TopoBranch[]>;
  hiddenBranchIds: Set<string>;
  hiddenNodeIds: Set<string>;
  pollutedBranchIds: Set<string>;
  branchBodyColor: (b: TopoBranch) => string | null;
  schemaSymbolsSorted: NonNullable<Props["schemaSymbols"]>;
  handleSymbolClick: (id: string, isCtrl: boolean) => void;
  _xySF: number;
  _objSF: number;
  _branchObjSF: number;
  _indZoomSF: number;
  branchWidth: number;
  thinLines: boolean;
  bulkheadScale: number;
  fanScale: number;
  flowDisplay: NonNullable<Props["flowDisplay"]>;
  animSpeed: number;
  showFlowArrows: boolean;
  rescuePickMode?: Props["rescuePickMode"];
  selectedSymbolId?: string | null;
  selectedSymbolIds?: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds?: Set<string>;
  infoConfig: Props["infoConfig"];
  unitsConfig: NonNullable<Props["unitsConfig"]>;
  branchFireColors?: Props["branchFireColors"];
  xyScale: number;
  onSelectSymbol?: Props["onSelectSymbol"];
  onSymbolMove?: Props["onSymbolMove"];
  onSymbolMoveAlongBranch?: Props["onSymbolMoveAlongBranch"];
  onSymbolOffset?: Props["onSymbolOffset"];
  onSymbolIndOffset?: Props["onSymbolIndOffset"];
  onSymbolMsIndOffset?: Props["onSymbolMsIndOffset"];
  onSymbolFanIndOffset?: Props["onSymbolFanIndOffset"];
  onSymbolDragStart?: Props["onSymbolDragStart"];
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseUp: () => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onMouseDownCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMoveCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUpCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onWheelCanvas: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  onContextMenuCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onDoubleClickCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

export default function TopoCanvasSymbolsOverlay(deps: SymbolsOverlayDeps) {
  const {
    useCanvas, size, view, cursorStyle, panStart, rotStart, isZooming, fixedObjectScale,
    branchBorder, scaleLimits,
    editingPrintLayerId, tool,
    branchesSorted, nodesSorted, projNodesMap, projectWithZ,
    branchById, legendTypeById, horizonOrderMap, nodeAdjBranches,
    hiddenBranchIds, hiddenNodeIds, pollutedBranchIds, branchBodyColor,
    schemaSymbolsSorted, handleSymbolClick,
    _xySF, _branchObjSF, _indZoomSF,
    branchWidth, thinLines, bulkheadScale, fanScale,
    flowDisplay, animSpeed, showFlowArrows, rescuePickMode,
    selectedSymbolId, selectedSymbolIds, selectedNodeId, selectedNodeIds,
    infoConfig, unitsConfig, branchFireColors, xyScale,
    onSelectSymbol, onSymbolMove, onSymbolMoveAlongBranch, onSymbolOffset,
    onSymbolIndOffset, onSymbolMsIndOffset, onSymbolFanIndOffset, onSymbolDragStart,
    onMouseDownCanvas, onMouseMoveCanvas, onMouseUpCanvas, onWheelCanvas,
    onContextMenuCanvas, onDoubleClickCanvas,
  } = deps;

  return (
    <>
  {/* ── Оверлей УО поверх canvas (видим всегда, интерактивен) ───────── */}
  {/* zIndex должен быть ВЫШЕ canvas-слоя. При активном слое печати canvas
      поднимается на zIndex:1 (см. CanvasLayer, transparentBg) — если оверлей
      УО останется на auto(0), canvas перекроет символы и клики по ним не
      дойдут. Поэтому держим оверлей на zIndex:2. В режиме редактирования
      печати опускаем его (0), чтобы ручки рамки/штампа были доступны. */}
  {useCanvas && (
    <svg
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "auto", touchAction: "none", userSelect: "none", cursor: cursorStyle, zIndex: editingPrintLayerId ? 0 : 2 }}
      width={size.w} height={size.h}
      onMouseDown={(e) => {
        // В режиме выбора узла/ветви для горноспасателей клик должен доходить
        // до схемы, даже если сверху лежит символ УО — иначе в canvas-режиме
        // по закрытому символом узлу невозможно попасть.
        if (!rescuePickMode && (e.target as SVGElement).closest("g[data-sym]")) return;
        onMouseDownCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      }}
      onMouseMove={(e) => onMouseMoveCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onMouseUp={(e) => onMouseUpCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onDoubleClick={(e) => onDoubleClickCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onContextMenu={(e) => onContextMenuCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onWheel={(e) => onWheelCanvas(e as unknown as React.WheelEvent<HTMLCanvasElement>)}>
      {(() => {
      // Во время перетаскивания/вращения/зума схемы не перерисовываем тяжёлый
      // оверлей УО (на больших схемах это тормозит и даёт «шлейф»). Ветви
      // на canvas двигаются дёшево, а символы вернутся сразу после остановки.
      if (panStart || rotStart || isZooming) return null;
      // Границы видимой области для отсечения (culling) символов вне экрана.
      // На больших схемах (>10000 УО) это убирает тысячи невидимых DOM-нод,
      // из-за которых тормозила вся программа.
      const OV_CULL = 120;
      const ovMinX = -OV_CULL, ovMaxX = size.w + OV_CULL;
      const ovMinY = -OV_CULL, ovMaxY = size.h + OV_CULL;

      // Отрисовка одного символа УО — вынесена в TopoCanvasSymbolNode.
      const renderOneOv = (sym: SymbolItem): React.ReactNode => renderSymbolNode(sym, {
        view, tool, fixedObjectScale, projNodesMap, projectWithZ,
        branchById, legendTypeById, hiddenBranchIds, branchBodyColor,
        handleSymbolClick,
        _branchObjSF, _indZoomSF,
        branchWidth, thinLines, bulkheadScale, fanScale,
        rescuePickMode, selectedSymbolId, selectedSymbolIds,
        infoConfig, unitsConfig,
        ovMinX, ovMaxX, ovMinY, ovMaxY,
        onSelectSymbol, onSymbolMove, onSymbolMoveAlongBranch, onSymbolOffset,
        onSymbolIndOffset, onSymbolMsIndOffset, onSymbolFanIndOffset, onSymbolDragStart,
        onMouseDownCanvas,
      });

      // Стрелки направления воздуха — вынесены в TopoCanvasFlowArrows.
      // Отрисовщик создаётся заново на каждый проход: он помнит, для каких
      // ветвей стрелка уже нарисована (одна стрелка на ветвь).
      const renderArrowOv = createFlowArrowRenderer({
        view, projNodesMap, branchById, hiddenBranchIds, pollutedBranchIds,
        _branchObjSF, branchWidth, thinLines, showFlowArrows,
      });

      // Сборка слоёв по горизонтам — вынесена в TopoCanvasOverlayLayers.
      const out = buildOverlayLayers({
        view, fixedObjectScale, branchBorder, scaleLimits,
        branchesSorted, nodesSorted, projNodesMap, projectWithZ,
        branchById, horizonOrderMap, nodeAdjBranches,
        hiddenNodeIds, pollutedBranchIds, branchBodyColor,
        schemaSymbolsSorted,
        _xySF, _branchObjSF,
        branchWidth, thinLines, flowDisplay, animSpeed, showFlowArrows,
        selectedNodeId, selectedNodeIds, infoConfig, branchFireColors, xyScale,
        renderOneOv, renderArrowOv,
      });

      return <>{out}</>;
      })()}
    </svg>
  )}
    </>
  );
}