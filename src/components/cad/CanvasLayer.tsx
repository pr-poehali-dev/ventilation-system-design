import { useEffect, useRef, useCallback } from "react";
import {
  type TopoNode, type TopoBranch, type Horizon, type ProjOptions,
  project3D,
} from "@/lib/topology";
import {
  renderCanvas, hitNodeCanvas, hitBranchCanvas,
  type FlowDisplayMode, type ProjNode,
  CANVAS_THRESHOLD,
} from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";

export { CANVAS_THRESHOLD };

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
  azimuth: number;
  elevation: number;
}

interface CanvasLayerProps {
  width: number;
  height: number;

  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  horizonMap: Map<string, Horizon>;
  visibleBranches: TopoBranch[];
  hiddenBranchIds: Set<string>;
  projNodes: ProjNode[];
  projNodesMap: Map<string, ProjNode>;

  proj: ProjOptions;
  view: ViewState;
  is3D: boolean;
  zScale: number;
  zLevel: number;

  selectedBranchId: string | null;
  selectedBranchIds: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  hoverBranchId: string | null;

  branchWidth: number;
  branchBorder: number;
  thinLines: boolean;
  colorByHorizon: boolean;
  showFlowArrows: boolean;
  flowDisplay: FlowDisplayMode;

  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;

  // события — пробрасываются от TopoCanvas
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp:   (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onWheel:     (e: React.WheelEvent<HTMLCanvasElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchMove:  (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchEnd:   (e: React.TouchEvent<HTMLCanvasElement>) => void;

  // экспорт canvas как изображения (для печати)
  onRegisterGetCanvas?: (fn: () => string) => void;
}

export default function CanvasLayer(props: CanvasLayerProps) {
  const {
    width, height,
    nodes, branches, horizons, horizonMap, visibleBranches, hiddenBranchIds,
    projNodes, projNodesMap,
    proj, view, is3D, zScale, zLevel,
    selectedBranchId, selectedBranchIds, selectedNodeId, selectedNodeIds,
    hoverBranchId,
    branchWidth, branchBorder, thinLines, colorByHorizon, showFlowArrows, flowDisplay,
    infoConfig, unitsConfig = DEFAULT_UNITS_CONFIG,
    onMouseDown, onMouseMove, onMouseUp, onWheel, onContextMenu,
    onTouchStart, onTouchMove, onTouchEnd,
    onRegisterGetCanvas,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number | null>(null);
  const animOffsetRef = useRef(0);

  // Инициализация размера при монтировании
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = width;
    canvas.height = height;
    draw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Анимация потока — один RAF на весь холст (вместо 1872 SVG <animate>)
  const needsAnim = flowDisplay === "flow" || flowDisplay === "both";

  // Все параметры рендера в ref чтобы RAF всегда брал актуальные данные
  const renderParamsRef = useRef(props);
  renderParamsRef.current = props;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const p = renderParamsRef.current;

    renderCanvas({
      ctx,
      width: p.width,
      height: p.height,
      nodes: p.nodes,
      branches: p.branches,
      horizons: p.horizons,
      horizonMap: p.horizonMap,
      visibleBranches: p.visibleBranches,
      hiddenBranchIds: p.hiddenBranchIds,
      projNodes: p.projNodes,
      projNodesMap: p.projNodesMap,
      proj: p.proj,
      view: p.view,
      is3D: p.is3D,
      zScale: p.zScale,
      zLevel: p.zLevel,
      selectedBranchId: p.selectedBranchId,
      selectedBranchIds: p.selectedBranchIds,
      selectedNodeId: p.selectedNodeId,
      selectedNodeIds: p.selectedNodeIds,
      hoverBranchId: p.hoverBranchId,
      branchWidth: p.branchWidth,
      branchBorder: p.branchBorder,
      thinLines: p.thinLines,
      colorByHorizon: p.colorByHorizon,
      showFlowArrows: p.showFlowArrows,
      flowDisplay: p.flowDisplay,
      animOffset: animOffsetRef.current,
      infoConfig: p.infoConfig,
      unitsConfig: p.unitsConfig ?? DEFAULT_UNITS_CONFIG,
    });
  }, []);

  // RAF-цикл для анимации потока
  useEffect(() => {
    if (!needsAnim) {
      draw();
      return;
    }
    let last = 0;
    const loop = (ts: number) => {
      if (ts - last > 16) {
        animOffsetRef.current = (ts / 80) % 18;
        draw();
        last = ts;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [needsAnim, draw]);

  // Перерисовка при изменении данных (без анимации)
  useEffect(() => {
    if (!needsAnim) draw();
  });

  // Регистрируем функцию экспорта для печати
  useEffect(() => {
    if (!onRegisterGetCanvas) return;
    onRegisterGetCanvas(() => canvasRef.current?.toDataURL("image/png") ?? "");
  }, [onRegisterGetCanvas]);

  // Изменяем размер canvas императивно — без сброса содержимого при каждом рендере React
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width  = width;
      canvas.height = height;
      draw(); // перерисовываем сразу после изменения размера
    }
  }, [width, height, draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block", touchAction: "none" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    />
  );
}

// Реэкспорт hit-функций для использования в TopoCanvas
export { hitNodeCanvas, hitBranchCanvas };

// Утилита: создать projNodesMap из projNodes
export function buildProjNodesMap(projNodes: ProjNode[]): Map<string, ProjNode> {
  const m = new Map<string, ProjNode>();
  for (const p of projNodes) m.set(p.node.id, p);
  return m;
}

// Утилита: вычислить projNodes
export function computeProjNodes(
  nodes: TopoNode[],
  proj: ProjOptions,
  zScale: number,
): ProjNode[] {
  return nodes.map((n) => {
    const p = project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj);
    return { node: n, sx: p.sx, sy: p.sy, depth: p.depth };
  });
}