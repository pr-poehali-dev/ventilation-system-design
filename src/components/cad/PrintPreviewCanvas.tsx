// Прямой рендер схемы в canvas для предпросмотра печати.
// Вписывает схему в canvas автоматически, либо использует переданный view.
// Поверх canvas — SVG-слой с условными обозначениями (УО).
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D } from "@/lib/topology";
import { renderCanvas, type ProjNode, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import { type Position } from "@/lib/positions";
import SchemaSymbolsOverlay from "./SchemaSymbolsOverlay";
import HorizonPrintLayerOverlay from "./HorizonPrintLayerOverlay";

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
  // Явный вид (null = auto-fit)
  scale?: number;
  offsetX?: number;
  offsetY?: number;
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

const PrintPreviewCanvas = forwardRef<PrintPreviewCanvasHandle, Props>(function PrintPreviewCanvas({
  nodes, branches, horizons,
  schemaSymbols = [],
  azimuth = 0, elevation = 90,
  zScale = 1, is3D = false,
  scale: scaleProp, offsetX: oxProp, offsetY: oyProp,
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
    [branches, horizonMap]
  );

  // Bounding box всех узлов с учётом zScale и проекции (scale=1, offset=0)
  const bbox = useMemo(() => {
    if (nodes.length === 0) return null;
    const tmpProj: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const p = project3D({ x: n.x, y: n.y, z: n.z * zScale }, tmpProj);
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
    }
    return { minX, maxX, minY, maxY };
  }, [nodes, azimuth, elevation, zScale]);

  // Auto-fit view под текущий размер canvas
  const fitView = useMemo(() => {
    if (!bbox || width <= 0 || height <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
    const pad = 20;
    const sw = bbox.maxX - bbox.minX || 1;
    const sh = bbox.maxY - bbox.minY || 1;
    const s = Math.min((width - pad * 2) / sw, (height - pad * 2) / sh);
    return {
      scale: s,
      offsetX: (width  - sw * s) / 2 - bbox.minX * s,
      offsetY: (height - sh * s) / 2 - bbox.minY * s,
    };
  }, [bbox, width, height]);

  // Итоговый view: явный или auto-fit
  const activeView = useMemo(() => ({
    scale:   scaleProp ?? fitView.scale,
    offsetX: oxProp    ?? fitView.offsetX,
    offsetY: oyProp    ?? fitView.offsetY,
    azimuth, elevation, zScale,
  }), [scaleProp, oxProp, oyProp, fitView, azimuth, elevation, zScale]);

  const proj = useMemo<ProjOptions>(() => activeView, [activeView]);

  const projNodes = useMemo<ProjNode[]>(
    () => nodes.map(n => ({ node: n, ...project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj), depth: 0 })),
    [nodes, proj, zScale]
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
    // Белый фон до рендера — чтобы canvas не оставался чёрным при ошибке
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
        showFlowArrows: false,
        flowDisplay,
        animOffset: 0,
        infoConfig,
        unitsConfig,
        colorMode,
        posInnerColors,
        posOuterColors,
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

  // SVG-проекция позиций для печати
  const projOpts = useMemo<ProjOptions>(() => activeView, [activeView]);

  return (
    <div style={{ position: "relative", width, height, flexShrink: 0 }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: "block" }}
      />
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
      {/* Маркеры позиций (ПЛА) */}
      {showPositions && positions.length > 0 && (
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
          {positions.map(pos => {
            if (pos.visible === false) return null;
            const projected = pos.x != null ? (() => {
              const p = project3D({ x: pos.x, y: pos.y, z: (pos.z ?? 0) * zScale }, projOpts);
              return { sx: p.sx, sy: p.sy };
            })() : null;
            if (!projected) return null;
            // По ГОСТ диаметр позиции ПЛА = 13 мм.
            // Ограничиваем масштаб чтобы кружки не перекрывали схему.
            const posSF = Math.min(1.0, Math.max(0.25, activeView.scale / 0.5));
            const r = (pos.diameter ?? 13) * 3.78 * posSF / 2;
            const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
            return (
              <g key={pos.id} transform={`translate(${projected.sx},${projected.sy})`}>
                <circle r={r} fill={pos.color} stroke={pos.borderColor ?? "#000000"} strokeWidth={2} />
                <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={700}
                  fill="#000000" style={{ userSelect: "none" }}>
                  {pos.number}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {/* Слои печати горизонтов (рамка + УО + штамп) */}
      {horizons.map(h => h.printLayer?.visible ? (
        <HorizonPrintLayerOverlay
          key={h.id}
          layer={h.printLayer}
          width={width}
          height={height}
        />
      ) : null)}
    </div>
  );
});

export default PrintPreviewCanvas;