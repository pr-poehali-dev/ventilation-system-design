/**
 * svgExporter.ts — Векторный SVG генератор схемы вентиляции.
 * Работает с теми же данными что и canvasRenderer, но генерирует чистый SVG.
 * Масштабируется бесконечно — идеально для плоттера.
 */
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D } from "./topology";
import { type InfoDisplayConfig } from "./infoConfig";
import { type UnitsConfig } from "./unitsConfig";
import { velocityColor } from "./canvasRenderer";

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

// ── Генерация SVG строки ──────────────────────────────────────────────────────
export function generateSvg(opts: SvgExportOptions): string {
  const {
    nodes, branches, horizonMap, proj,
    zScale, branchWidth = 2, branchBorder = 0.1,
    thinLines = false, colorByHorizon = false,
    infoConfig, canvasW, canvasH, title = "Схема",
    colorMode = "none",
  } = opts;

  // Проецируем все узлы
  const projMap = new Map<string, { sx: number; sy: number }>();
  for (const n of nodes) {
    const p = project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj);
    projMap.set(n.id, { sx: p.sx, sy: p.sy });
  }

  // Определяем границы схемы для viewBox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of projMap.values()) {
    if (p.sx < minX) minX = p.sx;
    if (p.sx > maxX) maxX = p.sx;
    if (p.sy < minY) minY = p.sy;
    if (p.sy > maxY) maxY = p.sy;
  }

  const pad = Math.max(maxX - minX, maxY - minY) * 0.05 + 20;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;

  const parts: string[] = [];

  // ── SVG заголовок ─────────────────────────────────────────────────────────
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`);
  parts.push(`  viewBox="${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}"`);
  parts.push(`  width="${canvasW}" height="${canvasH}">`);
  parts.push(`<title>${esc(title)}</title>`);
  parts.push(`<desc>Схема вентиляции ПВ-Система. Векторный экспорт.</desc>`);

  // ── Фон ───────────────────────────────────────────────────────────────────
  parts.push(`<rect x="${vbX.toFixed(2)}" y="${vbY.toFixed(2)}" width="${vbW.toFixed(2)}" height="${vbH.toFixed(2)}" fill="white"/>`);

  // ── Группа ветвей ─────────────────────────────────────────────────────────
  parts.push(`<g id="branches">`);

  const visibleBranches = branches.filter(b => {
    if (!b.horizonId) return true;
    const h = horizonMap.get(b.horizonId);
    return !h || h.visible !== false;
  });

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
      parts.push(`<line x1="${from.sx.toFixed(2)}" y1="${from.sy.toFixed(2)}" x2="${to.sx.toFixed(2)}" y2="${to.sy.toFixed(2)}" stroke-width="${w.toFixed(2)}" ${dash}/>`);
    }
    parts.push(`</g>`);
  }

  // Проход 2: заливка ветвей
  parts.push(`<g id="branch-fills" stroke-linecap="round" fill="none">`);
  for (const b of visibleBranches) {
    const from = projMap.get(b.fromId);
    const to   = projMap.get(b.toId);
    if (!from || !to) continue;

    const isSel = false;
    const color = isSel ? "#2563eb" : getBranchColor(b, opts);
    const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
    const w = thinLines ? 1 : bw;
    const dash = b.isLeakage ? `stroke-dasharray="6 4"` : "";
    const opacity = b.isDead ? 0.5 : 1;

    parts.push(`<line x1="${from.sx.toFixed(2)}" y1="${from.sy.toFixed(2)}" x2="${to.sx.toFixed(2)}" y2="${to.sy.toFixed(2)}" stroke="${esc(color)}" stroke-width="${w.toFixed(2)}" opacity="${opacity}" ${dash}/>`);
  }
  parts.push(`</g>`);

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
    // Стрелка в центре ветви
    const mx = (from.sx + to.sx) / 2, my = (from.sy + to.sy) / 2;
    const aw = 5, ah = 8;
    // Треугольник стрелки
    const p1x = mx + ux * ah / 2,  p1y = my + uy * ah / 2;
    const p2x = mx - ux * ah / 2 - uy * aw / 2;
    const p2y = my - uy * ah / 2 + ux * aw / 2;
    const p3x = mx - ux * ah / 2 + uy * aw / 2;
    const p3y = my - uy * ah / 2 - ux * aw / 2;
    parts.push(`<polygon points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)}" opacity="0.7"/>`);
  }
  parts.push(`</g>`);

  parts.push(`</g>`); // /branches

  // ── Группа узлов ──────────────────────────────────────────────────────────
  parts.push(`<g id="nodes">`);

  for (const n of nodes) {
    if (n.visible === false) continue;
    const p = projMap.get(n.id);
    if (!p) continue;

    const isAtm = n.atmosphereLink;
    const fireType = n.fireNodeType ?? "none";
    const hasFire = fireType !== "none";

    // Радиус узла
    const adjBranches = branches.filter(b => b.fromId === n.id || b.toId === n.id);
    const adjAvgW = adjBranches.length > 0
      ? adjBranches.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBranches.length
      : branchWidth;
    const branchPx = thinLines ? 1 : adjAvgW;
    const r = Math.min(10, Math.max(1.5, branchPx * 0.55));

    const baseColor = isAtm ? "#7dd3fc" : "#c8a882";
    const consumerColor = (n.fireHydrantOpen ?? false) ? "#1d4ed8" : "#dc2626";
    const nodeColor = fireType === "reservoir" ? "#1d4ed8"
                    : fireType === "consumer"  ? consumerColor
                    : fireType === "junction"  ? "#7c3aed"
                    : baseColor;

    const strokeColor = hasFire ? nodeColor : "#1f2937";
    const strokeW = Math.min(2, Math.max(0.5, r * 0.25));
    const nr = hasFire ? Math.min(r, r * 0.5) : r;

    parts.push(`<circle cx="${p.sx.toFixed(2)}" cy="${p.sy.toFixed(2)}" r="${nr.toFixed(2)}" fill="${esc(nodeColor)}" stroke="${esc(strokeColor)}" stroke-width="${strokeW.toFixed(2)}"/>`);

    // Внутреннее кольцо для atmosphereLink
    if (isAtm) {
      const ir = Math.max(1.5, r * 0.55);
      parts.push(`<circle cx="${p.sx.toFixed(2)}" cy="${p.sy.toFixed(2)}" r="${ir.toFixed(2)}" fill="none" stroke="#1f2937" stroke-width="1.2" stroke-dasharray="2 1"/>`);
    }

    // Иконка РЕЗЕРВУАРА
    if (fireType === "reservoir") {
      const IS = Math.min(24, Math.max(4, r * 2.5));
      const hw = IS * 0.8, hh = IS * 0.6;
      const ix = p.sx, iy = p.sy;
      parts.push(`<rect x="${(ix-hw).toFixed(2)}" y="${(iy-hh).toFixed(2)}" width="${(hw*2).toFixed(2)}" height="${hh.toFixed(2)}" fill="white" stroke="#1d4ed8" stroke-width="1.5"/>`);
      parts.push(`<rect x="${(ix-hw).toFixed(2)}" y="${iy.toFixed(2)}" width="${(hw*2).toFixed(2)}" height="${hh.toFixed(2)}" fill="#1d4ed8" stroke="#1d4ed8" stroke-width="1.5"/>`);
      parts.push(`<line x1="${(ix-hw).toFixed(2)}" y1="${iy.toFixed(2)}" x2="${(ix+hw).toFixed(2)}" y2="${iy.toFixed(2)}" stroke="#1d4ed8" stroke-width="1.5"/>`);
    }

    // Иконка ПОЖАРНОГО КРАНА
    if (fireType === "consumer") {
      const IS = Math.min(24, Math.max(4, r * 2.5));
      const ix = p.sx, iy = p.sy;
      const hydrantColor = (n.fireHydrantOpen ?? false) ? "#1d4ed8" : "#dc2626";
      const fillColor = (n.fireHydrantOpen ?? false) ? "#bfdbfe" : "white";
      const cr = IS * 0.55, earR = cr * 0.55;
      parts.push(`<circle cx="${(ix-cr*1.1).toFixed(2)}" cy="${iy.toFixed(2)}" r="${earR.toFixed(2)}" fill="${fillColor}" stroke="${hydrantColor}" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${(ix+cr*1.1).toFixed(2)}" cy="${iy.toFixed(2)}" r="${earR.toFixed(2)}" fill="${fillColor}" stroke="${hydrantColor}" stroke-width="1.5"/>`);
      parts.push(`<circle cx="${ix.toFixed(2)}" cy="${iy.toFixed(2)}" r="${cr.toFixed(2)}" fill="${fillColor}" stroke="${hydrantColor}" stroke-width="1.5"/>`);
    }

    // Метка узла
    const showLabel = !infoConfig || (infoConfig.nodeNumber && n.number);
    const label = infoConfig ? (infoConfig.nodeNumber ? n.number : "") : n.name;
    if (label) {
      parts.push(`<text x="${(p.sx + r + 3).toFixed(2)}" y="${(p.sy - r).toFixed(2)}" font-family="Segoe UI,Arial,sans-serif" font-size="9" fill="#6b7280" font-weight="500">${esc(label)}</text>`);
    }
  }

  parts.push(`</g>`); // /nodes

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
