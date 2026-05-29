// Прямой рендер схемы в canvas для предпросмотра печати.
// Вписывает схему в canvas автоматически, либо использует переданный view.
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D } from "@/lib/topology";
import { renderCanvas, type ProjNode } from "@/lib/canvasRenderer";
import { DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";

export interface PrintPreviewCanvasHandle {
  getFitView(): { scale: number; offsetX: number; offsetY: number } | null;
  toDataURL(): string;
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  azimuth?: number;
  elevation?: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  width: number;
  height: number;
  branchWidth?: number;
  branchBorder?: number;
}

const PrintPreviewCanvas = forwardRef<PrintPreviewCanvasHandle, Props>(function PrintPreviewCanvas({
  nodes, branches, horizons,
  azimuth = 0, elevation = 90,
  scale: scaleProp, offsetX: oxProp, offsetY: oyProp,
  width, height,
  branchWidth = 2, branchBorder = 0.4,
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

  // Bounding box всех узлов (scale=1, offset=0)
  const bbox = useMemo(() => {
    if (nodes.length === 0) return null;
    const tmpProj: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale: 1 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const p = project3D({ x: n.x, y: n.y, z: n.z }, tmpProj);
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
    }
    return { minX, maxX, minY, maxY };
  }, [nodes, azimuth, elevation]);

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
    azimuth, elevation, zScale: 1,
  }), [scaleProp, oxProp, oyProp, fitView, azimuth, elevation]);

  const proj = useMemo<ProjOptions>(() => activeView, [activeView]);

  const projNodes = useMemo<ProjNode[]>(
    () => nodes.map(n => ({ node: n, ...project3D({ x: n.x, y: n.y, z: n.z }, proj), depth: 0 })),
    [nodes, proj]
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
    renderCanvas({
      ctx, width, height,
      nodes, branches, horizons, horizonMap,
      visibleBranches, hiddenBranchIds: new Set(),
      projNodes, projNodesMap, proj,
      view: activeView,
      is3D: false, zScale: 1, zLevel: 0,
      selectedBranchId: null, selectedBranchIds: new Set(),
      selectedNodeId: null, selectedNodeIds: new Set(),
      hoverBranchId: null,
      branchWidth, branchBorder,
      thinLines: false, colorByHorizon: false,
      showFlowArrows: false, flowDisplay: "off",
      animOffset: 0, infoConfig: null,
      unitsConfig: DEFAULT_UNITS_CONFIG,
    });
  }, [nodes, branches, horizons, horizonMap, visibleBranches,
      projNodes, projNodesMap, proj, activeView,
      width, height, branchWidth, branchBorder]);

  useImperativeHandle(ref, () => ({
    getFitView: () => fitView,
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
  }), [fitView]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
});

export default PrintPreviewCanvas;
