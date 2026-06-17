/**
 * svgExporter.ts — Векторный SVG генератор схемы вентиляции.
 * Работает с теми же данными что и canvasRenderer, но генерирует чистый SVG.
 * Масштабируется бесконечно — идеально для плоттера.
 */
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D, PAPER_SIZES_MM } from "./topology";
import { type InfoDisplayConfig } from "./infoConfig";
import { type UnitsConfig } from "./unitsConfig";
import { velocityColor } from "./canvasRenderer";
import { type Position } from "./positions";
import { buildPrintLayerSvgString } from "./printLayerSvgString";

export interface SvgExportOptions {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  horizonMap: Map<string, Horizon>;
  proj: ProjOptions;
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  zScale: number;
  is3D: boolean;

  // Параметры отображения
  branchWidth?: number;
  branchBorder?: number;
  thinLines?: boolean;
  colorByHorizon?: boolean;
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  colorMode?: "none" | "flowQ";

  // Цвета позиций ПЛА: branchId → color
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;

  // Позиции ПЛА для маркеров (кружки с номерами)
  positions?: Position[];

  // Размер холста (логические px) — для вычисления viewBox
  canvasW: number;
  canvasH: number;

  // Рамка печати (опционально)
  printLayerSvg?: string;

  // Заголовок схемы (для метаданных)
  title?: string;
}

// ── Цвет ветви ────────────────────────────────────────────────────────────────
function getBranchColor(b: TopoBranch, opts: SvgExportOptions): string {
  const { colorByHorizon, horizonMap, colorMode } = opts;

  if (b.isDead) return "#9ca3af";

  if (colorByHorizon && b.horizonId) {
    const h = horizonMap.get(b.horizonId);
    if (h?.color) return h.color;
  }

  if (colorMode === "flowQ") {
    const Q = Math.abs(b.flow ?? 0);
    if (Q <= 0) return "#9ca3af";
    const MAX_Q = 50;
    const t = Math.min(1, Q / MAX_Q);
    const r = Math.round(59 + (239 - 59) * t);
    const g = Math.round(130 + (68 - 130) * t);
    const bv = Math.round(246 + (68 - 246) * t);
    return `rgb(${r},${g},${bv})`;
  }

  return velocityColor(b.velocity ?? 0);
}

// ── XML escape ────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function n(v: number, d = 2): string { return v.toFixed(d); }

// ── Вычисление bounding box узлов схемы ──────────────────────────────────────
function computeFrameRect(
  pl: NonNullable<Horizon["printLayer"]>,
  projMap: Map<string, { sx: number; sy: number }>,
  visBranches: TopoBranch[],
): { rx: number; ry: number; rw: number; rh: number } | null {
  const visIds = new Set<string>();
  visBranches.forEach(b => { visIds.add(b.fromId); visIds.add(b.toId); });
  const pts: { sx: number; sy: number }[] = [];
  for (const [id, p] of projMap) {
    if (visIds.has(id)) pts.push(p);
  }
  if (pts.length === 0) return null;

  let mnSx = Infinity, mxSx = -Infinity, mnSy = Infinity, mxSy = -Infinity;
  pts.forEach(p => {
    if (p.sx < mnSx) mnSx = p.sx; if (p.sx > mxSx) mxSx = p.sx;
    if (p.sy < mnSy) mnSy = p.sy; if (p.sy > mxSy) mxSy = p.sy;
  });
  const sw = mxSx - mnSx || 1, sh = mxSy - mnSy || 1;
  const pad = Math.max(sw, sh) * 0.08 + 15;
  const scx = (mnSx + mxSx) / 2, scy = (mnSy + mxSy) / 2;

  const plFmt = (pl.paperFormat ?? "A3") as keyof typeof PAPER_SIZES_MM;
  const plMm = PAPER_SIZES_MM[plFmt] ?? PAPER_SIZES_MM["A3"];
  const plOri = pl.orientation ?? "landscape";
  const aspect = (plOri === "landscape" ? plMm.h : plMm.w) / (plOri === "landscape" ? plMm.w : plMm.h);

  let rsw = sw + pad * 2, rsh = rsw / aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
  rsw = Math.max(rsw, sw + pad * 2);
  rsh = rsw / aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }

  return { rx: scx - rsw / 2, ry: scy - rsh / 2, rw: Math.max(rsw, 40), rh: Math.max(rsh, 40) };
}

// ── Генерация SVG строки ──────────────────────────────────────────────────────
export function generateSvg(opts: SvgExportOptions): string {
  const {
    nodes, branches, horizons, horizonMap, proj,
    zScale, branchWidth = 2, branchBorder = 0.1,
    thinLines = false, colorByHorizon = false,
    infoConfig, canvasW, canvasH, title = "Схема",
    colorMode = "none",
    posInnerColors, posOuterColors, positions = [],
  } = opts;

  // Проецируем все узлы
  const projMap = new Map<string, { sx: number; sy: number }>();
  for (const nd of nodes) {
    const p = project3D({ x: nd.x, y: nd.y, z: nd.z * zScale }, proj);
    projMap.set(nd.id, { sx: p.sx, sy: p.sy });
  }

  // Видимые ветви
  const visibleBranches = branches.filter(b => {
    if (!b.horizonId) return true;
    const h = horizonMap.get(b.horizonId);
    return !h || h.visible !== false;
  });

  // Активный слой печати
  const activePrintHorizon = horizons.find(h => h.printLayer?.visible) ?? null;
  const pl = activePrintHorizon?.printLayer ?? null;

  // Рамка для viewBox
  let frameRect: { rx: number; ry: number; rw: number; rh: number } | null = null;
  if (pl) {
    frameRect = computeFrameRect(pl, projMap, visibleBranches);
  }

  // Определяем границы для viewBox
  let vbX: number, vbY: number, vbW: number, vbH: number;

  if (frameRect) {
    vbX = frameRect.rx;
    vbY = frameRect.ry;
    vbW = frameRect.rw;
    vbH = frameRect.rh;
  } else {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of projMap.values()) {
      if (p.sx < minX) minX = p.sx;
      if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy;
      if (p.sy > maxY) maxY = p.sy;
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.05 + 20;
    vbX = minX - pad;
    vbY = minY - pad;
    vbW = (maxX - minX) + pad * 2;
    vbH = (maxY - minY) + pad * 2;
  }

  const parts: string[] = [];

  // ── SVG заголовок ─────────────────────────────────────────────────────────
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`);
  parts.push(`  viewBox="${n(vbX)} ${n(vbY)} ${n(vbW)} ${n(vbH)}"`);
  parts.push(`  width="${canvasW}" height="${canvasH}">`);
  parts.push(`<title>${esc(title)}</title>`);
  parts.push(`<desc>Схема вентиляции ПВ-Система. Векторный экспорт.</desc>`);

  // ── Фон ───────────────────────────────────────────────────────────────────
  parts.push(`<rect x="${n(vbX)}" y="${n(vbY)}" width="${n(vbW)}" height="${n(vbH)}" fill="white"/>`);

  // ── Группа ветвей ─────────────────────────────────────────────────────────
  parts.push(`<g id="branches">`);

  // Проход 1: обводки (border)
  if (!thinLines) {
    parts.push(`<g id="branch-borders" stroke="#1f2937" stroke-linecap="round" fill="none">`);
    for (const b of visibleBranches) {
      const from = projMap.get(b.fromId);
      const to   = projMap.get(b.toId);
      if (!from || !to) continue;
      const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
      const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
      const w = bw + bb * 2;
      const dash = b.isLeakage ? `stroke-dasharray="6 4"` : "";
      parts.push(`<line x1="${n(from.sx)}" y1="${n(from.sy)}" x2="${n(to.sx)}" y2="${n(to.sy)}" stroke-width="${n(w)}" ${dash}/>`);
    }
    parts.push(`</g>`);
  }

  // Проход 2: заливка ветвей (базовый цвет)
  parts.push(`<g id="branch-fills" stroke-linecap="round" fill="none">`);
  for (const b of visibleBranches) {
    const from = projMap.get(b.fromId);
    const to   = projMap.get(b.toId);
    if (!from || !to) continue;

    const color = getBranchColor(b, opts);
    const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
    const w = thinLines ? 1 : bw;
    const dash = b.isLeakage ? `stroke-dasharray="6 4"` : "";
    const opacity = b.isDead ? 0.5 : 1;

    parts.push(`<line x1="${n(from.sx)}" y1="${n(from.sy)}" x2="${n(to.sx)}" y2="${n(to.sy)}" stroke="${esc(color)}" stroke-width="${n(w)}" opacity="${opacity}" ${dash}/>`);
  }
  parts.push(`</g>`);

  // Проход 3: posOuterColors (внешняя обводка позиций ПЛА)
  if (posOuterColors && posOuterColors.size > 0) {
    parts.push(`<g id="branch-pos-outer" stroke-linecap="round" fill="none" opacity="0.55">`);
    for (const b of visibleBranches) {
      const outerColor = posOuterColors.get(b.id);
      if (!outerColor) continue;
      const from = projMap.get(b.fromId);
      const to   = projMap.get(b.toId);
      if (!from || !to) continue;
      const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
      const outerW = thinLines ? 3 : bw + 4;
      parts.push(`<line x1="${n(from.sx)}" y1="${n(from.sy)}" x2="${n(to.sx)}" y2="${n(to.sy)}" stroke="${esc(outerColor)}" stroke-width="${n(outerW)}"/>`);
    }
    parts.push(`</g>`);
  }

  // Проход 4: posInnerColors (внутренняя обводка / цвет позиций ПЛА поверх)
  if (posInnerColors && posInnerColors.size > 0) {
    parts.push(`<g id="branch-pos-inner" stroke-linecap="round" fill="none">`);
    for (const b of visibleBranches) {
      const innerColor = posInnerColors.get(b.id);
      if (!innerColor) continue;
      const from = projMap.get(b.fromId);
      const to   = projMap.get(b.toId);
      if (!from || !to) continue;
      const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
      const innerW = thinLines ? 1 : bw;
      parts.push(`<line x1="${n(from.sx)}" y1="${n(from.sy)}" x2="${n(to.sx)}" y2="${n(to.sy)}" stroke="${esc(innerColor)}" stroke-width="${n(innerW)}"/>`);
    }
    parts.push(`</g>`);
  }

  // ── Стрелки направления потока ─────────────────────────────────────────────
  parts.push(`<g id="flow-arrows" fill="#1f2937" stroke="none">`);
  for (const b of visibleBranches) {
    const Q = Math.abs(b.flow ?? 0);
    if (Q < 0.1 || b.isDead) continue;
    const from = projMap.get(b.fromId);
    const to   = projMap.get(b.toId);
    if (!from || !to) continue;
    const dx = to.sx - from.sx, dy = to.sy - from.sy;
    const len = Math.hypot(dx, dy);
    if (len < 10) continue;
    const ux = dx / len, uy = dy / len;
    const mx = (from.sx + to.sx) / 2, my = (from.sy + to.sy) / 2;
    const aw = 5, ah = 8;
    const p1x = mx + ux * ah / 2,  p1y = my + uy * ah / 2;
    const p2x = mx - ux * ah / 2 - uy * aw / 2;
    const p2y = my - uy * ah / 2 + ux * aw / 2;
    const p3x = mx - ux * ah / 2 + uy * aw / 2;
    const p3y = my - uy * ah / 2 - ux * aw / 2;
    parts.push(`<polygon points="${n(p1x,1)},${n(p1y,1)} ${n(p2x,1)},${n(p2y,1)} ${n(p3x,1)},${n(p3y,1)}" opacity="0.7"/>`);
  }
  parts.push(`</g>`);

  parts.push(`</g>`); // /branches

  // ── Группа узлов ──────────────────────────────────────────────────────────
  parts.push(`<g id="nodes">`);

  for (const nd of nodes) {
    if (nd.visible === false) continue;
    const p = projMap.get(nd.id);
    if (!p) continue;

    const isAtm = nd.atmosphereLink;
    const fireType = nd.fireNodeType ?? "none";
    const hasFire = fireType !== "none";

    const adjBranches = branches.filter(b => b.fromId === nd.id || b.toId === nd.id);
    const adjAvgW = adjBranches.length > 0
      ? adjBranches.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBranches.length
      : branchWidth;
    const branchPx = thinLines ? 1 : adjAvgW;
    const r = Math.min(10, Math.max(1.5, branchPx * 0.55));

    const baseColor = isAtm ? "#7dd3fc" : "#c8a882";
    const consumerColor = (nd.fireHydrantOpen ?? false) ? "#1d4ed8" : "#dc2626";
    const nodeColor = fireType === "reservoir" ? "#1d4ed8"
                    : fireType === "consumer"  ? consumerColor
                    : fireType === "junction"  ? "#7c3aed"
                    : baseColor;

    const strokeColor = hasFire ? nodeColor : "#1f2937";
    const strokeW = Math.min(2, Math.max(0.5, r * 0.25));
    const nr = hasFire ? Math.min(r, r * 0.5) : r;

    parts.push(`<circle cx="${n(p.sx)}" cy="${n(p.sy)}" r="${n(nr)}" fill="${esc(nodeColor)}" stroke="${esc(strokeColor)}" stroke-width="${n(strokeW)}"/>`);

    if (isAtm) {
      const ir = Math.max(1.5, r * 0.55);
      parts.push(`<circle cx="${n(p.sx)}" cy="${n(p.sy)}" r="${n(ir)}" fill="none" stroke="#1f2937" stroke-width="1.2" stroke-dasharray="2 1"/>`);
    }

    if (fireType === "reservoir") {
      const IS = Math.min(24, Math.max(4, r * 2.5));
      const hw = IS * 0.8, hh = IS * 0.6;
      parts.push(`<rect x="${n(p.sx-hw)}" y="${n(p.sy-hh)}" width="${n(hw*2)}" height="${n(hh)}" fill="white" stroke="#1d4ed8" stroke-width="1.5"/>`);
      parts.push(`<rect x="${n(p.sx-hw)}" y="${n(p.sy)}" width="${n(hw*2)}" height="${n(hh)}" fill="#1d4ed8" stroke="#1d4ed8" stroke-width="1.5"/>`);
      parts.push(`<line x1="${n(p.sx-hw)}" y1="${n(p.sy)}" x2="${n(p.sx+hw)}" y2="${n(p.sy)}" stroke="#1d4ed8" stroke-width="1.5"/>`);
    }

    if (fireType === "consumer") {
      const IS = Math.min(24, Math.max(4, r * 2.5));
      const hydrantColor = (nd.fireHydrantOpen ?? false) ? "#1d4ed8" : "#dc2626";
      const fillColor = (nd.fireHydrantOpen ?? false) ? "#bfdbfe" : "white";
      const cr = IS * 0.55, earR = cr * 0.55;
      parts.push(`<circle cx="${n(p.sx-cr*1.1)}" cy="${n(p.sy)}" r="${n(earR)}" fill="${fillColor}" stroke="${hydrantColor}" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${n(p.sx+cr*1.1)}" cy="${n(p.sy)}" r="${n(earR)}" fill="${fillColor}" stroke="${hydrantColor}" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${n(p.sx)}" cy="${n(p.sy)}" r="${n(cr)}" fill="${fillColor}" stroke="${hydrantColor}" stroke-width="1.5"/>`);
    }

    const label = infoConfig ? (infoConfig.nodeNumber ? nd.number : "") : nd.name;
    if (label) {
      parts.push(`<text x="${n(p.sx + r + 3)}" y="${n(p.sy - r)}" font-family="Segoe UI,Arial,sans-serif" font-size="9" fill="#6b7280" font-weight="500">${esc(label)}</text>`);
    }
  }

  parts.push(`</g>`); // /nodes

  // ── Маркеры позиций ПЛА ───────────────────────────────────────────────────
  if (positions && positions.length > 0) {
    parts.push(`<g id="positions">`);
    for (const pos of positions) {
      if (pos.visible === false) continue;
      if (!pos.placed) continue;

      const pp = project3D({ x: pos.x, y: pos.y, z: pos.z * zScale }, proj);
      const cx = pp.sx, cy = pp.sy;
      const R = 11;
      const fillColor = pos.color || "#f97316";
      const borderColor = pos.borderColor || "#1f2937";
      const textColor = "#ffffff";

      // Выноска: если задана leaderBranchId или leaderEndX
      if (pos.leaderBranchId && pos.leaderT != null) {
        // Конец выноски на ветви
        const lb = branches.find(b => b.id === pos.leaderBranchId);
        if (lb) {
          const lbFrom = projMap.get(lb.fromId);
          const lbTo   = projMap.get(lb.toId);
          if (lbFrom && lbTo) {
            const lx = lbFrom.sx + (lbTo.sx - lbFrom.sx) * pos.leaderT;
            const ly = lbFrom.sy + (lbTo.sy - lbFrom.sy) * pos.leaderT;
            parts.push(`<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(lx)}" y2="${n(ly)}" stroke="${esc(borderColor)}" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.7"/>`);
          }
        }
      } else if (pos.leaderEndX != null && pos.leaderEndY != null) {
        const lp = project3D({ x: pos.leaderEndX, y: pos.leaderEndY, z: pos.z * zScale }, proj);
        parts.push(`<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(lp.sx)}" y2="${n(lp.sy)}" stroke="${esc(borderColor)}" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.7"/>`);
      }

      // Кружок маркера
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="${esc(fillColor)}" stroke="${esc(borderColor)}" stroke-width="1.5"/>`);
      // Номер позиции
      parts.push(`<text x="${n(cx)}" y="${n(cy + 4)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" font-weight="bold" fill="${textColor}">${pos.number}</text>`);
    }
    parts.push(`</g>`); // /positions
  }

  // ── Рамка печати (buildPrintLayerSvgString inline) ────────────────────────
  if (pl && frameRect) {
    const { rx, ry, rw, rh } = frameRect;
    // buildPrintLayerSvgString ожидает координаты rx/ry относительно (0,0) своего totalW×totalH холста.
    // Наши rx/ry в пространстве viewBox (начало vbX/vbY) — сдвигаем обратно к (0,0).
    const frameSvgContent = buildPrintLayerSvgString({
      pl,
      rx: rx - vbX,
      ry: ry - vbY,
      rw, rh,
      totalW: vbW,
      totalH: vbH,
    });
    const bodyMatch = frameSvgContent.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    if (bodyMatch) {
      // translate обратно в пространство viewBox
      parts.push(`<g id="print-layer" transform="translate(${n(vbX)},${n(vbY)})">`);
      parts.push(bodyMatch[1]);
      parts.push(`</g>`);
    }
  } else if (opts.printLayerSvg) {
    const bodyMatch = opts.printLayerSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    if (bodyMatch) {
      parts.push(`<g id="print-layer" transform="translate(${n(vbX)},${n(vbY)})">`);
      parts.push(bodyMatch[1]);
      parts.push(`</g>`);
    }
  }

  // ── Закрываем SVG ─────────────────────────────────────────────────────────
  parts.push(`</svg>`);

  return parts.join("\n");
}

// ── Скачать SVG как файл ──────────────────────────────────────────────────────
export function downloadSvg(svgString: string, filename: string) {
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".svg") ? filename : `${filename}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}