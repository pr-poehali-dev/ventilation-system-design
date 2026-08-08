// Рендер схемы в canvas для предпросмотра печати.
// Получает viewState из рабочей области и масштабирует его под размер превью.
// SVG слоя печати рисуется поверх — координаты вычисляются из projNodes текущего view.
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";
import {
  type TopoNode, type TopoBranch, type Horizon, type ProjOptions,
  project3D,
} from "@/lib/topology";
import { renderCanvas, type ProjNode, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import { type Position } from "@/lib/positions";
import { type TextBlock } from "@/pages/cad/cadTypes";
import SchemaSymbolsOverlay from "./SchemaSymbolsOverlay";
import { computeFrameRect } from "./printPreview/computeFrameRect";
import PrintPositionsOverlay from "./printPreview/PrintPositionsOverlay";
import PrintTextBlocksOverlay from "./printPreview/PrintTextBlocksOverlay";
import PrintLayerOverlay from "./printPreview/PrintLayerOverlay";

export interface PrintPreviewCanvasHandle {
  getFitView(): { scale: number; offsetX: number; offsetY: number } | null;
  toDataURL(): string;
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  schemaSymbols?: SchemaSymbol[];
  // viewState из рабочей области — что сейчас видно на экране
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  // Размер рабочего canvas в px (для пересчёта масштаба)
  canvasSize: { w: number; h: number };
  zScale?: number;
  is3D?: boolean;
  width: number;
  height: number;
  branchWidth?: number;
  branchBorder?: number;
  thinLines?: boolean;
  colorByHorizon?: boolean;
  showFlowArrows?: boolean;
  flowDisplay?: FlowDisplayMode;
  textBlocks?: TextBlock[];
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  colorMode?: "none" | "flowQ" | "velocityV" | "section" | "ventsection";
  sectionColors?: Map<string, string>;
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;
  positions?: Position[];
  showPositions?: boolean;
  fixedObjectScale?: boolean;
  /** Диапазон масштаба позиций ПЛА в % при фиксированном масштабе */
  scalePositionMin?: number;
  scalePositionMax?: number;
  /** Глобальный ГОСТ-диаметр маркера позиции, мм (эталон 13) */
  positionGostMm?: number;
  xyScale?: number;
  /** Множитель супер-сэмплинга canvas (обычно = зум предпросмотра),
   *  чтобы схема оставалась чёткой при CSS transform: scale(). */
  superSample?: number;
  /** Готовая проекция конкретного тайла (листа) в координатах предпросмотра.
   *  Если передана — компонент использует её напрямую вместо своего fit-to-screen.
   *  Нужна для многолистовой печати БЕЗ слоя печати: каждый лист показывает
   *  свою часть единой схемы (offset смещён на col*pageW / row*pageH). */
  tileView?: { scale: number; offsetX: number; offsetY: number };
}

const PrintPreviewCanvas = forwardRef<PrintPreviewCanvasHandle, Props>(function PrintPreviewCanvas({
  nodes, branches, horizons,
  schemaSymbols = [],
  viewState,
  canvasSize,
  zScale = 1, is3D = false,
  width, height,
  branchWidth = 2, branchBorder = 0.4,
  thinLines = false, colorByHorizon = false,
  showFlowArrows = false,
  flowDisplay = "off",
  textBlocks = [],
  infoConfig = null,
  unitsConfig = DEFAULT_UNITS_CONFIG,
  colorMode = "none",
  sectionColors,
  posInnerColors,
  posOuterColors,
  positions = [],
  showPositions = true,
  fixedObjectScale = false,
  scalePositionMin = 80,
  scalePositionMax = 150,
  positionGostMm = 13,
  xyScale,
  superSample = 1,
  tileView,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { azimuth, elevation } = viewState;

  const horizonMap = useMemo(() => {
    const m = new Map<string, Horizon>();
    horizons.forEach(h => m.set(h.id, h));
    return m;
  }, [horizons]);

  const visibleBranches = useMemo(
    () => branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible;
    }),
    [branches, horizonMap],
  );

  // Активные слои печати (все горизонты с включённым слоем)
  const activePrintLayers = useMemo(
    () => horizons.filter(h => h.printLayer?.visible),
    [horizons],
  );
  const hasPrintLayer = activePrintLayers.length > 0;

  // Пересчитываем viewState рабочей области под размер превью.
  // Всегда делаем fit-to-screen по узлам — так схема всегда отображается по центру превью
  // в том же ракурсе (azimuth/elevation) что и рабочая область.
  const activeView = useMemo((): ProjOptions & { scale: number; offsetX: number; offsetY: number } => {
    if (width <= 0 || height <= 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    }

    // Готовая проекция тайла (многолистовая печать без слоя печати): используем
    // напрямую, чтобы каждый лист показывал СВОЮ часть единой схемы, а не всю схему.
    if (tileView) {
      return {
        scale: tileView.scale,
        offsetX: tileView.offsetX,
        offsetY: tileView.offsetY,
        azimuth, elevation, zScale,
      };
    }

    const _xySF0 = xyScale ?? 1;

    // ── Если есть слой печати: вписываем рамку ────────────────────────────
    if (hasPrintLayer) {
      // Шаг 1: масштабируем viewState под размер превью
      const cw = canvasSize.w > 0 ? canvasSize.w : width;
      const ch = canvasSize.h > 0 ? canvasSize.h : height;
      const k = Math.min(width / cw, height / ch);
      const sc0 = viewState.scale * k;
      const ox0 = viewState.offsetX * k + (width - cw * k) / 2;
      const oy0 = viewState.offsetY * k + (height - ch * k) / 2;

      const proj0: ProjOptions = { scale: sc0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      const pNodes0: ProjNode[] = nodes.map(n => ({
        node: n,
        ...project3D({ x: n.x * _xySF0, y: n.y * _xySF0, z: n.z * zScale }, proj0),
        depth: 0,
      }));
      const plHorizon = activePrintLayers[0];
      const pl = plHorizon.printLayer!;
      const rect = computeFrameRect(pl, pNodes0, visibleBranches, proj0, _xySF0, plHorizon.z ?? 0);

      if (!rect || rect.rw <= 0 || rect.rh <= 0) {
        return { scale: sc0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      }
      const fitS = Math.min(width / rect.rw, height / rect.rh);
      return {
        scale: sc0 * fitS,
        offsetX: (ox0 - rect.rx) * fitS,
        offsetY: (oy0 - rect.ry) * fitS,
        azimuth, elevation, zScale,
      };
    }

    // ── Без слоя печати: fit-to-screen по bbox узлов ──────────────────────
    // Проецируем с scale=1, offset=0 чтобы получить bbox в нормальных координатах
    if (nodes.length === 0) {
      return { scale: 1, offsetX: width / 2, offsetY: height / 2, azimuth, elevation, zScale };
    }
    const proj1: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    for (const n of nodes) {
      const p = project3D({ x: n.x * _xySF0, y: n.y * _xySF0, z: n.z * zScale }, proj1);
      if (p.sx < minSx) minSx = p.sx; if (p.sx > maxSx) maxSx = p.sx;
      if (p.sy < minSy) minSy = p.sy; if (p.sy > maxSy) maxSy = p.sy;
    }
    const bw = Math.max(1, maxSx - minSx);
    const bh = Math.max(1, maxSy - minSy);
    const pad = 0.08;
    const fitSc = Math.min((width * (1 - pad * 2)) / bw, (height * (1 - pad * 2)) / bh);
    const cx = (minSx + maxSx) / 2;
    const cy = (minSy + maxSy) / 2;
    return {
      scale: fitSc,
      offsetX: width / 2 - cx * fitSc,
      offsetY: height / 2 - cy * fitSc,
      azimuth, elevation, zScale,
    };
  }, [viewState, canvasSize, width, height, azimuth, elevation, zScale,
      hasPrintLayer, activePrintLayers, nodes, visibleBranches, xyScale, tileView]);

  const proj = useMemo<ProjOptions>(() => activeView, [activeView]);

  const projNodes = useMemo<ProjNode[]>(() => {
    const _xySFN = xyScale ?? 1;
    return nodes.map(n => ({ node: n, ...project3D({ x: n.x * _xySFN, y: n.y * _xySFN, z: n.z * zScale }, proj), depth: 0 }));
  }, [nodes, proj, zScale, xyScale]);

  const projNodesMap = useMemo(() => {
    const m = new Map<string, ProjNode>();
    projNodes.forEach(p => m.set(p.node.id, p));
    return m;
  }, [projNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Супер-сэмплинг: рисуем canvas во внутреннем разрешении, увеличенном на зум
    // предпросмотра. Родитель растягивает предпросмотр через CSS transform:scale(),
    // и без этого растровая схема размывалась бы (в отличие от векторных SVG-слоёв).
    // Квантуем зум до ступеней (1,2,3,4), чтобы не пересоздавать canvas на каждый
    // мелкий шаг колеса, и ограничиваем произведение dpr*ss.
    const ss = Math.max(1, Math.min(4, Math.ceil(superSample)));
    const totalScale = Math.min(dpr * ss, 4);
    canvas.width  = Math.round(width  * totalScale);
    canvas.height = Math.round(height * totalScale);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(totalScale, totalScale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    try {
      renderCanvas({
        ctx, width, height,
        nodes, branches, horizons, horizonMap,
        visibleBranches, hiddenBranchIds: new Set(),
        projNodes, projNodesMap, proj,
        view: activeView,
        is3D, zScale, zLevel: 0,
        selectedBranchId: null, selectedBranchIds: new Set(),
        selectedNodeId: null, selectedNodeIds: new Set(),
        hoverBranchId: null,
        branchWidth, branchBorder,
        thinLines, colorByHorizon,
        showFlowArrows, flowDisplay,
        animOffset: 0, infoConfig, unitsConfig,
        colorMode, sectionColors, posInnerColors, posOuterColors,
        printMode: true,
        fixedObjectScale,
        xyScale,
      });
    } catch (err) {
      console.error("PrintPreviewCanvas renderCanvas error:", err);
    }
  }, [nodes, branches, horizons, horizonMap, visibleBranches,
      projNodes, projNodesMap, proj, activeView,
      is3D, zScale, width, height, superSample,
      branchWidth, branchBorder, thinLines, colorByHorizon,
      showFlowArrows, flowDisplay, infoConfig, unitsConfig,
      colorMode, sectionColors, posInnerColors, posOuterColors]);

  useImperativeHandle(ref, () => ({
    getFitView: () => ({ scale: activeView.scale, offsetX: activeView.offsetX, offsetY: activeView.offsetY }),
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
  }), [activeView]);

  // Рамки слоя печати: bbox из projNodes текущего view
  const printLayerRects = useMemo(() =>
    activePrintLayers
      .map(h => {
        const pl = h.printLayer!;
        const rect = computeFrameRect(pl, projNodes, visibleBranches);
        return rect ? { h, pl, ...rect } : null;
      })
      .filter(Boolean) as Array<{ h: Horizon; pl: NonNullable<Horizon["printLayer"]>; rx: number; ry: number; rw: number; rh: number }>,
    [activePrintLayers, projNodes, visibleBranches],
  );

  return (
    <div style={{ position: "relative", width, height, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ display: "block", width, height }} />

      {schemaSymbols.length > 0 && (
        <SchemaSymbolsOverlay
          symbols={schemaSymbols}
          branches={branches}
          projNodesMap={projNodesMap}
          viewScale={activeView.scale}
          unitsConfig={unitsConfig}
          width={width}
          height={height}
        />
      )}

      {/* Позиции ПЛА */}
      {showPositions && positions.length > 0 && (
        <PrintPositionsOverlay
          positions={positions}
          branches={branches}
          projNodesMap={projNodesMap}
          proj={proj}
          viewState={viewState}
          activeView={activeView}
          zScale={zScale}
          xyScale={xyScale}
          fixedObjectScale={fixedObjectScale}
          scalePositionMin={scalePositionMin}
          scalePositionMax={scalePositionMax}
          positionGostMm={positionGostMm}
        />
      )}

      {/* Текстовые блоки — как в рабочей области */}
      {textBlocks.length > 0 && (
        <PrintTextBlocksOverlay
          textBlocks={textBlocks}
          proj={proj}
          viewState={viewState}
          activeView={activeView}
          xyScale={xyScale}
          width={width}
          height={height}
        />
      )}

      {/* SVG слоя печати поверх canvas */}
      {printLayerRects.length > 0 && (
        <PrintLayerOverlay
          printLayerRects={printLayerRects}
          schemaSymbols={schemaSymbols}
          branches={branches}
          width={width}
          height={height}
        />
      )}
    </div>
  );
});

export default PrintPreviewCanvas;
