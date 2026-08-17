import React from "react";
import { type TopoBranch } from "@/lib/topology";
import { type ViewState, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";
import { type SymbolItem } from "@/components/cad/topoCanvas/TopoCanvasSymbolNode";

// ─────────────────────────────────────────────────────────────────────────────
// Стрелка направления движения воздуха на ветви (canvas-оверлей).
//
// Вынесено из TopoCanvasSymbolsOverlay.tsx БЕЗ изменений логики и разметки.
//
// ПОЧЕМУ ФАБРИКА, А НЕ ПРОСТАЯ ФУНКЦИЯ. Отрисовщик помнит, для каких ветвей
// стрелка уже нарисована (множество arrowSeenBrOv): на одной ветви может
// стоять несколько символов, а стрелка нужна одна. Это состояние живёт ровно
// один проход отрисовки, поэтому создаём отрисовщик заново на каждый рендер —
// ровно так же, как это работало внутри исходного файла.
// ─────────────────────────────────────────────────────────────────────────────

/** Всё, что нужно для отрисовки стрелок направления воздуха. */
export interface FlowArrowDeps {
  view: ViewState;
  projNodesMap: Map<string, ProjNodeEntry>;
  branchById: Map<string, TopoBranch>;
  /** ID ветвей, скрытых вместе со своим горизонтом */
  hiddenBranchIds: Set<string>;
  pollutedBranchIds: Set<string>;
  _branchObjSF: number;
  branchWidth: number;
  thinLines: boolean;
  showFlowArrows: boolean;
}

/** Создаёт отрисовщик стрелок для ОДНОГО прохода рендера. */
export function createFlowArrowRenderer(d: FlowArrowDeps) {
  const {
    view, projNodesMap, branchById, hiddenBranchIds, pollutedBranchIds,
    _branchObjSF, branchWidth, thinLines, showFlowArrows,
  } = d;

  // Стрелка направления воздуха для символа — рисуется ПОД символами УО
  // (в отдельном проходе), чтобы стрелка одной перемычки не перекрывала
  // соседнюю. Возвращает только стрелку (без подложки/символа).
  const arrowSeenBrOv = new Set<string>();
  return (sym: SymbolItem): React.ReactNode => {
    if (!sym.branchId || sym.typeId === "valve_reduce") return null;
    // Горизонт ветви скрыт — стрелки быть не должно. Без этой проверки в
    // canvas-режиме сама выработка и её символы пропадали, а красная стрелка
    // направления воздуха оставалась висеть на пустом месте: символы УО
    // фильтруются по hiddenBranchIds, а этот проход рисовался мимо фильтра.
    if (hiddenBranchIds.has(sym.branchId)) return null;
    // Одна стрелка на ветвь (не дублируем для каждого символа на ветви).
    if (arrowSeenBrOv.has(sym.branchId)) return null;
    const brBody = branchById.get(sym.branchId);
    if (!brBody) return null;
    const fN = projNodesMap.get(brBody.fromId);
    const tN = projNodesMap.get(brBody.toId);
    if (!fN || !tN) return null;
    const Qb = Math.abs(brBody.flow ?? 0);
    const arrLod = view.scale >= 0.15;
    if (!(showFlowArrows && !thinLines && arrLod && Qb > 0.1)) return null;
    const uBw = (brBody.lineWidth && brBody.lineWidth > 0) ? brBody.lineWidth : branchWidth;
    const uW = Math.max(1.5, uBw * _branchObjSF);
    const reversedArr = (brBody.flow ?? 0) < 0 || (!!brBody.hasFan && (brBody.fanReverse ?? false) && (brBody.flow ?? 0) >= 0);
    const aAx = reversedArr ? tN.sx : fN.sx, aAy = reversedArr ? tN.sy : fN.sy;
    const aBx = reversedArr ? fN.sx : tN.sx, aBy = reversedArr ? fN.sy : tN.sy;
    const aDx = aBx - aAx, aDy = aBy - aAy;
    const aLen = Math.hypot(aDx, aDy) || 1;
    const aAng = Math.atan2(aDy, aDx) * 180 / Math.PI;
    const tipH = uW * 2.2, tipW = uW * 0.5, tailLen = uW * 3.0, tailW = Math.max(0.5, uW * 0.15);
    if (!(aLen >= (tailLen + tipH) * 2)) return null;
    arrowSeenBrOv.add(sym.branchId);
    const arrColor = pollutedBranchIds.has(sym.branchId) ? "#2563eb" : "#dc2626";
    const arrPts = `0,-${tipW} ${tipH},0 0,${tipW}`;
    return (
      <g key={`ovarr-${sym.branchId}`} pointerEvents="none"
        transform={`translate(${(aAx + aDx * 0.5).toFixed(1)},${(aAy + aDy * 0.5).toFixed(1)}) rotate(${aAng.toFixed(1)})`}>
        <line x1={-tailLen} y1={0} x2={0} y2={0} stroke="white" strokeWidth={tailW + 1.5} strokeLinecap="round" />
        <polygon points={arrPts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
        <line x1={-tailLen} y1={0} x2={0} y2={0} stroke={arrColor} strokeWidth={tailW} strokeLinecap="round" />
        <polygon points={arrPts} fill={arrColor} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
      </g>
    );
  };
}