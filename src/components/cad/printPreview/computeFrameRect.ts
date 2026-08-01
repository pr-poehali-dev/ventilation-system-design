// Вычисляет bbox рамки печати из projNodes — точно как TopoCanvas.renderPrintLayers.
// Вынесено из PrintPreviewCanvas.tsx без изменений логики.
import {
  type TopoBranch, type Horizon, type ProjOptions,
  project3D,
} from "@/lib/topology";
import { type ProjNode } from "@/lib/canvasRenderer";

// Вычисляет bbox рамки из projNodes — точно как TopoCanvas.renderPrintLayers
export function computeFrameRect(
  pl: NonNullable<Horizon["printLayer"]>,
  projNodes: ProjNode[],
  visibleBranches: TopoBranch[],
  proj?: ProjOptions,
  xyScale = 1,
  zLevel = 0,
): { rx: number; ry: number; rw: number; rh: number } | null {
  // Если рамка настроена вручную (pl.bounds) — проецируем её углы ТЕМ ЖЕ project3D,
  // что и рабочая область (TopoCanvas). Так предпросмотр/PDF совпадают с тем, что
  // пользователь настроил на схеме, в т.ч. в наклонных видах (ИЗО/Фронт/Профиль).
  if (pl.bounds && proj) {
    const z4 = zLevel * (proj.zScale ?? 1);
    const b = pl.bounds;
    const c = [
      project3D({ x: b.x1 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
      project3D({ x: b.x2 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
      project3D({ x: b.x1 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
      project3D({ x: b.x2 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
    ];
    const bxs = c.map(p => p.sx), bys = c.map(p => p.sy);
    const rx = Math.min(...bxs), ry = Math.min(...bys);
    const rw = Math.max(...bxs) - rx, rh = Math.max(...bys) - ry;
    return { rx, ry, rw: Math.max(rw, 40), rh: Math.max(rh, 40) };
  }

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
