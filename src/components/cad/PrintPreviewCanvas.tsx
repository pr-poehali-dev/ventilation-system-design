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
import SchemaSymbolsOverlay from "./SchemaSymbolsOverlay";
import { renderPrintLayerSvgContent } from "@/lib/printLayerSvg";

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
  flowDisplay?: FlowDisplayMode;
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  colorMode?: "none" | "flowQ";
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;
  positions?: Position[];
  showPositions?: boolean;
  fixedObjectScale?: boolean;
  xyScale?: number;
}

// Вычисляет bbox рамки из projNodes — точно как TopoCanvas.renderPrintLayers
function computeFrameRect(
  pl: NonNullable<Horizon["printLayer"]>,
  projNodes: ProjNode[],
  visibleBranches: TopoBranch[],
): { rx: number; ry: number; rw: number; rh: number } | null {
  const visibleNodeIds = new Set<string>();
  visibleBranches.forEach(b => { visibleNodeIds.add(b.fromId); visibleNodeIds.add(b.toId); });
  const relevant = projNodes.filter(pn => visibleNodeIds.has(pn.node.id));
  if (relevant.length === 0) return null;

  let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
  relevant.forEach(pn => {
    if (pn.sx < minSx) minSx = pn.sx; if (pn.sx > maxSx) maxSx = pn.sx;
    if (pn.sy < minSy) minSy = pn.sy; if (pn.sy > maxSy) maxSy = pn.sy;
  });

  const sw = maxSx - minSx || 1, sh = maxSy - minSy || 1;
  const pad = Math.max(sw, sh) * 0.08 + 15;
  const scx = (minSx + maxSx) / 2, scy = (minSy + maxSy) / 2;

  const paperSizes: Record<string, { w: number; h: number }> = {
    A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 },
    A2: { w: 420, h: 594 }, A1: { w: 594, h: 841 }, A0: { w: 841, h: 1189 },
  };
  const fmt = (pl.paperFormat ?? "A3") as string;
  const ori = pl.orientation ?? "landscape";
  const mm = paperSizes[fmt] ?? paperSizes["A3"];
  const mmW = ori === "landscape" ? mm.h : mm.w;
  const mmH = ori === "landscape" ? mm.w : mm.h;
  const aspect = mmW / mmH;

  let rsw = sw + pad * 2, rsh = rsw / aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
  rsw = Math.max(rsw, sw + pad * 2);
  rsh = rsw / aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }

  return { rx: scx - rsw / 2, ry: scy - rsh / 2, rw: Math.max(rsw, 40), rh: Math.max(rsh, 40) };
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
  flowDisplay = "off",
  infoConfig = null,
  unitsConfig = DEFAULT_UNITS_CONFIG,
  colorMode = "none",
  posInnerColors,
  posOuterColors,
  positions = [],
  showPositions = true,
  fixedObjectScale = false,
  xyScale,
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
  // Принцип: то же масштабирование что в рабочей области, но сжатое под prevW×prevH.
  // Если слой печати — вписываем рамку в весь canvas.
  const activeView = useMemo((): ProjOptions & { scale: number; offsetX: number; offsetY: number } => {
    if (width <= 0 || height <= 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    }

    // Шаг 1: масштабируем viewState рабочей области под размер превью
    // Коэффициент = min(prevW/canvasW, prevH/canvasH) — вписать рабочую область в превью
    const cw = canvasSize.w > 0 ? canvasSize.w : width;
    const ch = canvasSize.h > 0 ? canvasSize.h : height;
    const k = Math.min(width / cw, height / ch);
    const sc = viewState.scale * k;
    const ox = viewState.offsetX * k + (width - cw * k) / 2;
    const oy = viewState.offsetY * k + (height - ch * k) / 2;

    if (!hasPrintLayer) {
      return { scale: sc, offsetX: ox, offsetY: oy, azimuth, elevation, zScale };
    }

    // Шаг 2: если слой печати — вычисляем рамку при sc/ox/oy
    // и подгоняем view чтобы рамка = весь canvas
    const proj0: ProjOptions = { scale: sc, offsetX: ox, offsetY: oy, azimuth, elevation, zScale };
    const pNodes0: ProjNode[] = nodes.map(n => ({
      node: n,
      ...project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj0),
      depth: 0,
    }));
    const pl = activePrintLayers[0].printLayer!;
    const rect = computeFrameRect(pl, pNodes0, visibleBranches);

    if (!rect || rect.rw <= 0 || rect.rh <= 0) {
      return { scale: sc, offsetX: ox, offsetY: oy, azimuth, elevation, zScale };
    }

    // Подгоняем: рамка (rx,ry,rw,rh) → (0,0,width,height)
    const fitS = Math.min(width / rect.rw, height / rect.rh);
    return {
      scale: sc * fitS,
      offsetX: (ox - rect.rx) * fitS,
      offsetY: (oy - rect.ry) * fitS,
      azimuth, elevation, zScale,
    };
  }, [viewState, canvasSize, width, height, azimuth, elevation, zScale,
      hasPrintLayer, activePrintLayers, nodes, visibleBranches]);

  const proj = useMemo<ProjOptions>(() => activeView, [activeView]);

  const projNodes = useMemo<ProjNode[]>(
    () => nodes.map(n => ({ node: n, ...project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj), depth: 0 })),
    [nodes, proj, zScale],
  );

  const projNodesMap = useMemo(() => {
    const m = new Map<string, ProjNode>();
    projNodes.forEach(p => m.set(p.node.id, p));
    return m;
  }, [projNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
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
        showFlowArrows: false, flowDisplay,
        animOffset: 0, infoConfig, unitsConfig,
        colorMode, posInnerColors, posOuterColors,
        printMode: true,
        fixedObjectScale,
        xyScale,
      });
    } catch (err) {
      console.error("PrintPreviewCanvas renderCanvas error:", err);
    }
  }, [nodes, branches, horizons, horizonMap, visibleBranches,
      projNodes, projNodesMap, proj, activeView,
      is3D, zScale, width, height,
      branchWidth, branchBorder, thinLines, colorByHorizon,
      flowDisplay, infoConfig, unitsConfig,
      colorMode, posInnerColors, posOuterColors]);

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
      <canvas ref={canvasRef} width={width} height={height} style={{ display: "block" }} />

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
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
          {positions.map(pos => {
            if (pos.visible === false || pos.x == null) return null;
            const p = project3D({ x: pos.x, y: pos.y, z: (pos.z ?? 0) * zScale }, proj);
            // posSF: при фиксированном масштабе (fixedObjectScale=true) — posSF=1 (эталонный размер).
            // При нефиксированном — пропорционально зуму рабочей области.
            // Используем viewState.scale (зум рабочей области), а не activeView.scale
            // (который может быть сильно занижен при вписывании в окно превью).
            const posSF = fixedObjectScale ? 1 : Math.max(0.25, viewState.scale / 0.5);
            // Переводим posSF в единицы превью (activeView.scale / viewState.scale = коэффициент вписывания)
            const previewK = viewState.scale > 0 ? activeView.scale / viewState.scale : 1;
            const r = (pos.diameter ?? 13) * 3.78 * posSF * previewK / 2;
            const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
            return (
              <g key={pos.id} transform={`translate(${p.sx},${p.sy})`}>
                <circle r={r} fill={pos.color} stroke={pos.borderColor ?? "#000000"} strokeWidth={Math.max(0.5, r * 0.12)} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={700}
                  fill="#000000" style={{ userSelect: "none" }}>{pos.number}</text>
              </g>
            );
          })}
        </svg>
      )}

      {/* SVG слоя печати поверх canvas */}
      {printLayerRects.length > 0 && (
        <svg
          style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
          width={width} height={height}
        >
          {printLayerRects.map(({ h, pl, rx, ry, rw, rh }) => (
            <g key={h.id}>
              {renderPrintLayerSvgContent({ pl, rx, ry, rw, rh, schemaSymbols })}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
});

export default PrintPreviewCanvas;