// Рендер схемы в canvas для предпросмотра печати.
// Схема всегда auto-fit в размер canvas. SVG слоя печати — поверх.
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";
import {
  type TopoNode, type TopoBranch, type Horizon, type ProjOptions,
  project3D, OVERVIEW_HORIZON_ID,
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
  azimuth?: number;
  elevation?: number;
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
}

// Вычисляет bbox рамки из projNodes — точно как TopoCanvas.renderPrintLayers
function computeFrameRect(
  pl: NonNullable<Horizon["printLayer"]>,
  projNodes: ProjNode[],
  visibleBranches: TopoBranch[],
): { rx: number; ry: number; rw: number; rh: number } | null {
  if (projNodes.length === 0) return null;
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
  azimuth = 0, elevation = 90,
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
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  // Активные слои печати (только OVERVIEW)
  const activePrintLayers = useMemo(
    () => horizons.filter(h => h.printLayer?.visible && h.id === OVERVIEW_HORIZON_ID),
    [horizons],
  );
  const hasPrintLayer = activePrintLayers.length > 0;

  // Bounding box всех узлов при scale=1 offset=0
  const bbox = useMemo(() => {
    if (nodes.length === 0) return null;
    const tmpProj: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const p = project3D({ x: n.x, y: n.y, z: n.z * zScale }, tmpProj);
      if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
    }
    return { minX, maxX, minY, maxY };
  }, [nodes, azimuth, elevation, zScale]);

  // Если слой печати включён — вычисляем view так чтобы РАМКА вписалась в canvas.
  // Если нет — auto-fit схемы в canvas.
  const fitView = useMemo(() => {
    if (!bbox || width <= 0 || height <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };

    if (hasPrintLayer && activePrintLayers[0]?.printLayer) {
      // Шаг 1: auto-fit схемы чтобы получить проецированные узлы
      const sw = bbox.maxX - bbox.minX || 1;
      const sh = bbox.maxY - bbox.minY || 1;
      const pad = 20;
      const s0 = Math.min((width - pad * 2) / sw, (height - pad * 2) / sh);
      const ox0 = (width - sw * s0) / 2 - bbox.minX * s0;
      const oy0 = (height - sh * s0) / 2 - bbox.minY * s0;
      const proj0: ProjOptions = { scale: s0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      const pNodes0 = nodes.map(n => ({ node: n, ...project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj0), depth: 0 as const }));

      // Шаг 2: вычисляем bbox рамки при этом view
      const pl = activePrintLayers[0].printLayer;
      const rect = computeFrameRect(pl, pNodes0, visibleBranches);
      if (!rect) return { scale: s0, offsetX: ox0, offsetY: oy0 };

      // Шаг 3: подгоняем scale/offset так чтобы РАМКА = весь canvas
      const fitS = Math.min(width / (rect.rw || 1), height / (rect.rh || 1));
      const newS = s0 * fitS;
      const newOx = (ox0 - rect.rx) * fitS;
      const newOy = (oy0 - rect.ry) * fitS;
      return { scale: newS, offsetX: newOx, offsetY: newOy };
    }

    // Обычный auto-fit
    const sw = bbox.maxX - bbox.minX || 1;
    const sh = bbox.maxY - bbox.minY || 1;
    const pad = 20;
    const s = Math.min((width - pad * 2) / sw, (height - pad * 2) / sh);
    return {
      scale: s,
      offsetX: (width - sw * s) / 2 - bbox.minX * s,
      offsetY: (height - sh * s) / 2 - bbox.minY * s,
    };
  }, [bbox, width, height, azimuth, elevation, zScale, nodes, visibleBranches, hasPrintLayer, activePrintLayers]);

  const activeView = useMemo(() => ({
    ...fitView, azimuth, elevation, zScale,
  }), [fitView, azimuth, elevation, zScale]);

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
    getFitView: () => fitView,
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
  }), [fitView]);

  // Вычисляем bbox рамок слоя печати из projNodes текущего view
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
            if (pos.visible === false) return null;
            if (pos.x == null) return null;
            const p = project3D({ x: pos.x, y: pos.y, z: (pos.z ?? 0) * zScale }, proj);
            const posSF = Math.min(1.0, Math.max(0.25, activeView.scale / 0.5));
            const r = (pos.diameter ?? 13) * 3.78 * posSF / 2;
            const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
            return (
              <g key={pos.id} transform={`translate(${p.sx},${p.sy})`}>
                <circle r={r} fill={pos.color} stroke={pos.borderColor ?? "#000000"} strokeWidth={2} />
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
              {renderPrintLayerSvgContent({ pl, rx, ry, rw, rh })}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
});

export default PrintPreviewCanvas;
