// Прямой рендер схемы в canvas для предпросмотра печати.
// Вписывает схему в canvas автоматически, либо использует переданный view.
// Поверх canvas — SVG-слой с условными обозначениями (УО).
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D } from "@/lib/topology";
import { renderCanvas, type ProjNode, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import SchemaSymbolsOverlay from "./SchemaSymbolsOverlay";

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
    ctx.fillStyle = is3D ? "#f0f4f8" : "#ffffff";
    ctx.fillRect(0, 0, width, height);
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
    });
  }, [nodes, branches, horizons, horizonMap, visibleBranches,
      projNodes, projNodesMap, proj, activeView,
      is3D, zScale, width, height,
      branchWidth, branchBorder, thinLines, colorByHorizon,
      flowDisplay, infoConfig, unitsConfig]);

  useImperativeHandle(ref, () => ({
    getFitView: () => fitView,
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
  }), [fitView]);

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
    </div>
  );
});

export default PrintPreviewCanvas;
