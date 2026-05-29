// Прямой рендер схемы в canvas для предпросмотра печати.
// Не использует захват DOM — рисует данные через renderCanvas напрямую.
import { useEffect, useRef, useMemo } from "react";
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D } from "@/lib/topology";
import { renderCanvas, type ProjNode } from "@/lib/canvasRenderer";
import { DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  view: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  width: number;
  height: number;
  branchWidth?: number;
  branchBorder?: number;
}

export default function PrintPreviewCanvas({
  nodes, branches, horizons, view, width, height,
  branchWidth = 2, branchBorder = 0.4,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const proj = useMemo<ProjOptions>(() => ({
    scale: view.scale,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    azimuth: view.azimuth,
    elevation: view.elevation,
    zScale: 1,
  }), [view]);

  const horizonMap = useMemo(() => {
    const m = new Map<string, Horizon>();
    horizons.forEach(h => m.set(h.id, h));
    return m;
  }, [horizons]);

  const projNodes = useMemo<ProjNode[]>(
    () => nodes.map(n => ({ node: n, ...project3D({ x: n.x, y: n.y, z: n.z }, proj), depth: 0 })),
    [nodes, proj]
  );

  const projNodesMap = useMemo(() => {
    const m = new Map<string, ProjNode>();
    projNodes.forEach(p => m.set(p.node.id, p));
    return m;
  }, [projNodes]);

  const visibleBranches = useMemo(
    () => branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible;
    }),
    [branches, horizonMap]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    renderCanvas({
      ctx, width, height,
      nodes, branches,
      horizons, horizonMap,
      visibleBranches,
      hiddenBranchIds: new Set(),
      projNodes, projNodesMap,
      proj, view,
      is3D: false, zScale: 1, zLevel: 0,
      selectedBranchId: null,
      selectedBranchIds: new Set(),
      selectedNodeId: null,
      selectedNodeIds: new Set(),
      hoverBranchId: null,
      branchWidth, branchBorder,
      thinLines: false,
      colorByHorizon: false,
      showFlowArrows: false,
      flowDisplay: "off",
      animOffset: 0,
      infoConfig: null,
      unitsConfig: DEFAULT_UNITS_CONFIG,
    });
  }, [nodes, branches, horizons, horizonMap, visibleBranches, projNodes, projNodesMap, proj, view, width, height, branchWidth, branchBorder]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
