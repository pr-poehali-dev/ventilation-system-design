// Утилиты для работы с canvas — вынесены из CanvasLayer.tsx чтобы не ломать Fast Refresh
import { type TopoNode, type ProjOptions, project3D } from "@/lib/topology";
import { type ProjNode } from "@/lib/canvasRenderer";

export function buildProjNodesMap(projNodes: ProjNode[]): Map<string, ProjNode> {
  const m = new Map<string, ProjNode>();
  for (const p of projNodes) m.set(p.node.id, p);
  return m;
}

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
