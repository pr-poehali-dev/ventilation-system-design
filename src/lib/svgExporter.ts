/**
 * svgExporter.ts — Векторный SVG генератор схемы вентиляции.
 * Работает с теми же данными что и canvasRenderer, но генерирует чистый SVG.
 * Масштабируется бесконечно — идеально для плоттера.
 */
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D } from "./topology";
import { type InfoDisplayConfig } from "./infoConfig";
import { type UnitsConfig, getUnit, DEFAULT_UNITS_CONFIG } from "./unitsConfig";
import { velocityColor } from "./canvasRenderer";
import { type Position } from "./positions";
import { buildPrintLayerSvgString } from "./printLayerSvgString";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS } from "./schemaSymbols";
import { type SchemaSymbol } from "@/pages/Cad";

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

  // Условные обозначения на схеме
  schemaSymbols?: SchemaSymbol[];

  // Цвета позиций ПЛА: branchId → color
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;

  // Позиции ПЛА для маркеров (кружки с номерами)
  positions?: Position[];

  // Размер холста (логические px) — для вычисления viewBox
  canvasW: number;
  canvasH: number;

  /** Физическая ширина бумаги в мм (например 297 для A3).
   *  Используется для точного перевода мм→px при рендере позиций ПЛА. */
  paperWidthMm?: number;

  // Рамка печати (опционально)
  printLayerSvg?: string;

  // Заголовок схемы (для метаданных)
  title?: string;

  /** Фиксированный масштаб объектов (режим 1): true — ширины не зависят от zoom.
   *  false (режим 2) — ширины/узлы/стрелки масштабируются вместе со схемой. */
  fixedObjectScale?: boolean;

  /** Ветви с загрязнённым воздухом (синие стрелки) */
  pollutedBranchIds?: Set<string>;
  /** Масштаб по осям XY — для нормализации objSF при реальных координатах */
  xyScale?: number;
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


// ── Генерация SVG строки ──────────────────────────────────────────────────────
export function generateSvg(opts: SvgExportOptions): string {
  const {
    nodes, branches, horizons, horizonMap, proj,
    zScale, branchWidth = 2, branchBorder = 0.1,
    thinLines = false, colorByHorizon = false,
    infoConfig, unitsConfig = DEFAULT_UNITS_CONFIG, canvasW, canvasH, title = "Схема",
    colorMode = "none",
    posInnerColors, posOuterColors, positions = [],
    fixedObjectScale = true,
    schemaSymbols = [],
    paperWidthMm,
    xyScale,
  } = opts;

  // Коэффициент px/мм для физического размера позиций ПЛА.
  // Если paperWidthMm передан — вычисляем точно из соотношения холст/бумага.
  // Иначе используем стандарт 96dpi (3.78 px/мм).
  const pxPerMm = paperWidthMm && paperWidthMm > 0 ? canvasW / paperWidthMm : 3.78;

  // В режиме 2 (fixedObjectScale=false) объекты масштабируются вместе со схемой.
  // Нормируем на xyScale: при реальных координатах «нормальный» proj.scale в xyScale раз меньше.
  // Ограничиваем сверху (8) — при крупном зуме объекты не должны вырастать в исполинов.
  const _xySFExport = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
  const objSF = fixedObjectScale ? 1 : Math.min(8, Math.max(0.25, proj.scale / (_xySFExport * 0.4)));

  // Проецируем все узлы (координаты умножаем на xyScale для реальных схем)
  const projMap = new Map<string, { sx: number; sy: number }>();
  for (const nd of nodes) {
    const p = project3D({ x: nd.x * _xySFExport, y: nd.y * _xySFExport, z: nd.z * zScale }, proj);
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

  // ── viewBox = весь лист (canvasW × canvasH) при наличии слоя печати,
  //    иначе — по bbox схемы с отступом.
  // При наличии слоя печати proj уже рассчитан так что схема вписана в рамку
  // внутри листа canvasW×canvasH. frameRect описывает рамку в px (0..canvasW, 0..canvasH).
  let vbX: number, vbY: number, vbW: number, vbH: number;
  let frameRect: { rx: number; ry: number; rw: number; rh: number } | null = null;

  if (pl) {
    // viewBox = весь лист
    vbX = 0; vbY = 0; vbW = canvasW; vbH = canvasH;

    // Рамка в пространстве canvasW×canvasH.
    // Используем те же поля что PrintDialog (5% от меньшей стороны).
    const padPx = Math.min(canvasW, canvasH) * 0.05;
    const rx = padPx;
    const ry = padPx;
    const rw = canvasW - padPx * 2;
    const rh = canvasH - padPx * 2;
    frameRect = { rx, ry, rw, rh };
  } else {
    // bbox только по узлам видимых ветвей (горизонт уже отфильтрован в visibleBranches)
    const visibleNodeIdsForBbox = new Set<string>();
    visibleBranches.forEach(b => { visibleNodeIdsForBbox.add(b.fromId); visibleNodeIdsForBbox.add(b.toId); });
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [id, p] of projMap.entries()) {
      // если видимых ветвей нет — берём все узлы (fallback)
      if (visibleNodeIdsForBbox.size > 0 && !visibleNodeIdsForBbox.has(id)) continue;
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
      const w = (bw + bb * 2) * objSF;
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
    const w = thinLines ? 1 : bw * objSF;
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
      const outerW = thinLines ? 3 : (bw + 4) * objSF;
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
      const innerW = thinLines ? 1 : bw * objSF;
      parts.push(`<line x1="${n(from.sx)}" y1="${n(from.sy)}" x2="${n(to.sx)}" y2="${n(to.sy)}" stroke="${esc(innerColor)}" stroke-width="${n(innerW)}"/>`);
    }
    parts.push(`</g>`);
  }

  // ── Стрелки направления потока ─────────────────────────────────────────────
  // Координаты sx/sy из project3D — пиксели SVG-холста (proj.scale уже применён).
  //
  // Ключевой принцип: размер стрелок и шаг между ними задаём относительно
  // ШИРИНЫ ВЕТВИ (w в пикселях SVG). Это работает корректно при любом масштабе
  // схемы (fixedObjectScale=true/false) и при любом proj.scale.
  //
  // Соотношения как в canvasRenderer:
  //   arrowLen ≈ w * 4   (стрелка по высоте ≈ 4 ширины ветви)
  //   stepA    ≈ w * 16  (шаг между стрелками ≈ 16 ширин ветви)
  //   minLen   ≈ w * 10  (минимальная длина ветви для отрисовки стрелки)

  // Вычисляем pollutedBranchIds внутри generateSvg — BFS по потоку от ветвей с pollutesAir=true.
  // Это гарантирует корректность независимо от того, передан ли opts.pollutedBranchIds снаружи.
  const computedPolluted = ((): Set<string> => {
    if (opts.pollutedBranchIds && opts.pollutedBranchIds.size > 0) return opts.pollutedBranchIds;
    const sources = branches.filter(b => b.pollutesAir);
    if (sources.length === 0) return new Set<string>();
    const outEdges = new Map<string, string[]>();
    for (const b of branches) {
      const fn = (b.flow ?? 0) >= 0 ? b.fromId : b.toId;
      const tn = (b.flow ?? 0) >= 0 ? b.toId   : b.fromId;
      if (!outEdges.has(fn)) outEdges.set(fn, []);
      outEdges.get(fn)!.push(b.id);
      if (!outEdges.has(tn)) outEdges.set(tn, []);
    }
    const branchToNode = new Map<string, string>();
    for (const b of branches) branchToNode.set(b.id, (b.flow ?? 0) >= 0 ? b.toId : b.fromId);
    const visited = new Set<string>();
    const queue: string[] = [];
    for (const src of sources) {
      visited.add(src.id);
      queue.push((src.flow ?? 0) >= 0 ? src.toId : src.fromId);
    }
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      for (const bId of outEdges.get(nodeId) ?? []) {
        if (!visited.has(bId)) { visited.add(bId); const nxt = branchToNode.get(bId); if (nxt) queue.push(nxt); }
      }
    }
    return visited;
  })();

  parts.push(`<g id="flow-arrows">`);
  for (const b of visibleBranches) {
    const Q = Math.abs(b.flow ?? 0);
    if (Q < 0.1 || b.isDead) continue;
    const fromPt = projMap.get(b.fromId);
    const toPt   = projMap.get(b.toId);
    if (!fromPt || !toPt) continue;

    // Реверс потока (строго как в canvasRenderer)
    const fanReverseOverride = b.hasFan && (b.fanReverse ?? false) && (b.flow ?? 0) >= 0;
    const reversed = (b.flow ?? 0) < 0 || fanReverseOverride;
    const sxA = reversed ? toPt.sx : fromPt.sx;
    const syA = reversed ? toPt.sy : fromPt.sy;
    const sxB = reversed ? fromPt.sx : toPt.sx;
    const syB = reversed ? fromPt.sy : toPt.sy;

    const dx = sxB - sxA, dy = syB - syA;
    const segLen = Math.hypot(dx, dy);

    // Ширина ветви в пикселях SVG
    const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
    const w = (thinLines ? 1 : bw) * objSF;

    // Размеры и шаг относительно ширины ветви.
    // tipW ограничен w/2 — наконечник не должен выходить за края ветви в PDF.
    const arrowLen = Math.max(w * 3, 6);
    const hw       = arrowLen / 2;
    const tip      = arrowLen * 0.35;
    const tipW     = Math.min(w / 2, Math.max(w * 0.45, 1.5));
    const stepA    = arrowLen * 4;

    // Минимальная длина ветви — хотя бы одна стрелка умещается
    if (segLen < arrowLen * 1.2) continue;

    // Цвет: синий — загрязнённый, красный — свежий
    const isPolluted = computedPolluted.has(b.id);
    const arrowColor = isPolluted ? "#2563eb" : "#dc2626";

    const count = Math.max(1, Math.floor(segLen / stepA));

    // Единичный вектор и перпендикуляр
    const ux = dx / segLen, uy = dy / segLen;
    const nx = -uy, ny = ux;

    const strokeW    = Math.max(w * 0.10, 0.3);
    const strokeWTip = Math.max(w * 0.06, 0.2);

    for (let i = 0; i < count; i++) {
      const t0 = (i + 1) / (count + 1);
      const cx = sxA + dx * t0;
      const cy = syA + dy * t0;

      // Хвостик
      const tailX1 = cx - ux * hw,          tailY1 = cy - uy * hw;
      const tailX2 = cx + ux * (hw - tip),  tailY2 = cy + uy * (hw - tip);
      parts.push(`<line x1="${n(tailX1,1)}" y1="${n(tailY1,1)}" x2="${n(tailX2,1)}" y2="${n(tailY2,1)}" stroke="${arrowColor}" stroke-width="${n(strokeW, 2)}" stroke-linecap="round"/>`);

      // Наконечник
      const tipPx  = cx + ux * hw,                        tipPy  = cy + uy * hw;
      const base1x = cx + ux * (hw - tip) + nx * tipW,   base1y = cy + uy * (hw - tip) + ny * tipW;
      const base2x = cx + ux * (hw - tip) - nx * tipW,   base2y = cy + uy * (hw - tip) - ny * tipW;
      parts.push(`<polygon points="${n(tipPx,1)},${n(tipPy,1)} ${n(base1x,1)},${n(base1y,1)} ${n(base2x,1)},${n(base2y,1)}" fill="${arrowColor}" stroke="#1a1a1a" stroke-width="${n(strokeWTip, 2)}" stroke-linejoin="round"/>`);
    }
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
    const branchPx = thinLines ? 1 : adjAvgW * objSF;
    const r = Math.min(10 * objSF, Math.max(1.5, branchPx * 0.55));

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

      // Радиус позиции ПЛА — физический размер в мм → пиксели SVG.
      // pxPerMm вычислен из реального формата бумаги (canvasW / paperWidthMm),
      // поэтому 13мм всегда = 13мм на распечатанном листе, независимо от proj.scale.
      const R = (pos.diameter ?? 13) * pxPerMm / 2;
      const fontSize = pos.number >= 100 ? R * 0.55 : pos.number >= 10 ? R * 0.7 : R * 0.85;

      const fillColor = pos.color || "#f97316";
      const borderColor = pos.borderColor || "#1f2937";
      const textColor = "#000000";
      const leaderThickness = Math.max(0.3, (pos.leaderThickness ?? 0.2) * pxPerMm);

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
            parts.push(`<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(lx)}" y2="${n(ly)}" stroke="${esc(borderColor)}" stroke-width="${n(leaderThickness, 2)}" stroke-dasharray="${n(R*0.4)} ${n(R*0.25)}" opacity="0.85"/>`);
          }
        }
      } else if (pos.leaderEndX != null && pos.leaderEndY != null) {
        const lp = project3D({ x: pos.leaderEndX, y: pos.leaderEndY, z: pos.z * zScale }, proj);
        parts.push(`<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(lp.sx)}" y2="${n(lp.sy)}" stroke="${esc(borderColor)}" stroke-width="${n(leaderThickness, 2)}" stroke-dasharray="${n(R*0.4)} ${n(R*0.25)}" opacity="0.85"/>`);
      }

      // Кружок маркера
      parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" fill="${esc(fillColor)}" stroke="${esc(borderColor)}" stroke-width="${n(Math.max(0.5, R * 0.12))}"/>`);
      // Номер позиции
      parts.push(`<text x="${n(cx)}" y="${n(cy)}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${n(fontSize, 1)}" font-weight="700" fill="${textColor}">${pos.number}</text>`);
    }
    parts.push(`</g>`); // /positions
  }

  // ── Индикаторы ветвей (Q, V, сечение, название, номер) ───────────────────
  if (!thinLines && infoConfig) {
    const uFlow = getUnit(unitsConfig, "flow");
    const uVel  = getUnit(unitsConfig, "velocity");
    const uPres = getUnit(unitsConfig, "pressure");
    const uLen  = getUnit(unitsConfig, "length");
    const uArea = getUnit(unitsConfig, "area");
    const uRes  = getUnit(unitsConfig, "resistance");
    parts.push(`<g id="branch-labels" font-family="Segoe UI,Arial,sans-serif">`);

    for (const b of visibleBranches) {
      const fromPt = projMap.get(b.fromId);
      const toPt   = projMap.get(b.toId);
      if (!fromPt || !toPt) continue;

      const midX = (fromPt.sx + toPt.sx) / 2;
      const midY = (fromPt.sy + toPt.sy) / 2;
      const Q = Math.abs(b.flow ?? 0);
      const V = b.velocity ?? 0;
      const isDead = b.isDead ?? false;
      const hasCalc = (Q > 0 || V > 0) && !isDead;
      const overV = V > (b.vMax ?? 9999);

      // Индивидуальные настройки ветви переопределяют глобальные
      const ic = (b.indicators && Object.keys(b.indicators).length > 0)
        ? { ...infoConfig, ...b.indicators } as typeof infoConfig
        : infoConfig;

      const dataLines: string[] = [];
      if (!isDead && ic) {
        const len = b.length ?? 0;
        const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
        if (ic.branchName && b.type) dataLines.push(b.type);
        if (ic.branchLength && len > 0) dataLines.push(`L=${uLen.fromBase(len).toFixed(uLen.decimals)}${uLen.symbol}`);
        if (ic.branchAngle) dataLines.push(`A=${(b.angle ?? 0).toFixed(1)}°`);
        if (ic.branchSection && b.area > 0) dataLines.push(`S=${uArea.fromBase(b.area).toFixed(uArea.decimals)}${uArea.symbol}`);
        if (ic.branchResistance && b.resistance > 0) dataLines.push(`R=${uRes.fromBase(b.resistance * 1000 / 9.81).toFixed(uRes.decimals)}${uRes.symbol}`);
        if (ic.branchVelocity && hasCalc) dataLines.push(`V=${uVel.fromBase(V).toFixed(uVel.decimals)}${uVel.symbol}${overV ? " ⚠" : ""}`);
        if ((ic.branchFlow || ic.branchFlowCalc) && hasCalc) dataLines.push(`Q=${Qsign}${uFlow.fromBase(Q).toFixed(uFlow.decimals)}${uFlow.symbol}`);
        if (ic.branchDepression && hasCalc) dataLines.push(`Н=${uPres.fromBase(b.dP ?? 0).toFixed(uPres.decimals)}${uPres.symbol}`);
      }

      const showNum = !ic || ic.branchNumber;
      const branchNum = b.id.replace(/^B/, "");
      const allLines = showNum ? [branchNum, ...dataLines] : dataLines;
      if (allLines.length === 0) continue;

      const lox = (b.labelOffsetX ?? 0) * objSF;
      const loy = (b.labelOffsetY ?? -16) * objSF;
      const labelAng = ((b.labelAngle ?? 0) * Math.PI / 180);
      const anchorX = midX + lox;
      const anchorY = midY + loy;

      const bw = (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth) * objSF;
      const textSc = Math.max(0.6, bw * 0.28) * (b.labelSize ?? 1);
      const lh = 11 * textSc;
      const bh = allLines.length * lh + 4 * textSc;

      // Выноска если сдвинута
      if (Math.abs(lox) > 5 * objSF || Math.abs(loy + 16 * objSF) > 5 * objSF) {
        parts.push(`<line x1="${n(midX)}" y1="${n(midY)}" x2="${n(anchorX)}" y2="${n(anchorY)}" stroke="#555555" stroke-width="0.4" stroke-dasharray="2 3" opacity="0.7"/>`);
      }

      const transform = labelAng !== 0
        ? `transform="translate(${n(anchorX)},${n(anchorY)}) rotate(${n(labelAng * 180 / Math.PI)})"`
        : `transform="translate(${n(anchorX)},${n(anchorY)})"`;

      parts.push(`<g ${transform}>`);
      // Единый полупрозрачный прямоугольник под весь блок меток
      const bgPad = 2.5 * textSc;
      parts.push(`<rect x="${n(-bh * 1.6)}" y="${n(-bh / 2 - bgPad)}" width="${n(bh * 3.2)}" height="${n(bh + bgPad * 2)}" rx="${n(1.5 * textSc)}" fill="white" fill-opacity="0.72" stroke="none"/>`);
      allLines.forEach((ln, li) => {
        const ty = -bh / 2 + lh * (li + 0.6);
        const isNumLine = li === 0 && showNum;
        const fs = (isNumLine ? (branchNum.length > 2 ? 7.5 : 9) : 8.5) * textSc;
        const fillColor = isNumLine ? "#374151" : (overV && !isNumLine ? "#dc2626" : "#1e3a5f");
        const fw = isNumLine ? "600" : "500";
        // Тонкая тёмная обводка — читаемость без белого ореола
        parts.push(`<text x="0" y="${n(ty)}" text-anchor="middle" dominant-baseline="middle" font-size="${n(fs, 1)}" font-weight="${fw}" stroke="rgba(255,255,255,0.4)" stroke-width="${n(0.6 * textSc, 1)}" stroke-linejoin="round" paint-order="stroke" fill="${fillColor}">${esc(ln)}</text>`);
      });
      parts.push(`</g>`);
    }
    parts.push(`</g>`); // /branch-labels
  }

  // ── Символы УО (schemaSymbols) ────────────────────────────────────────────
  if (schemaSymbols.length > 0) {
    parts.push(`<g id="schema-symbols">`);

    for (const sym of schemaSymbols) {
      const isMeasureStation = sym.typeId === "measure_station";
      const isBulkhead = BULKHEAD_SYMBOL_IDS.has(sym.typeId) && !isMeasureStation;
      const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
      if (!lt && !isBulkhead && !isMeasureStation) continue;

      // Вычисляем позицию символа
      let px = 0, py = 0;
      let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;

      if (sym.branchId) {
        const br = branches.find(b => b.id === sym.branchId);
        const fPt = br ? projMap.get(br.fromId) : null;
        const tPt = br ? projMap.get(br.toId)   : null;
        if (!fPt || !tPt) continue; // ветвь/узлы не найдены — пропускаем символ
        fsx = fPt.sx; fsy = fPt.sy; tsx2 = tPt.sx; tsy2 = tPt.sy;
        hasBranchPts = true;
        const t = sym.t ?? 0.5;
        px = fsx + (tsx2 - fsx) * t;
        py = fsy + (tsy2 - fsy) * t;
      } else {
        // Свободный символ: применяем xyScale к мировым координатам
        const p3 = project3D({ x: sym.x * _xySFExport, y: sym.y * _xySFExport, z: 0 }, proj);
        px = p3.sx; py = p3.sy;
        hasBranchPts = false;
      }

      px += sym.offsetX ?? 0;
      py += sym.offsetY ?? 0;

      const sc = sym.scale ?? 1;
      // symScale: при scale<0.4 уменьшать, иначе ~1
      const ss = proj.scale < 0.4 ? proj.scale / 0.4 : 1;
      const SZ = Math.max(4, 32 * sc * ss);
      const brAngle = hasBranchPts ? Math.atan2(tsy2 - fsy, tsx2 - fsx) : 0;
      const angDeg = brAngle * 180 / Math.PI;

      if (isMeasureStation && hasBranchPts) {
        // Замерная станция — две красные линии поперёк ветви
        const ph = Math.max(3, SZ * 0.85);
        const lw = Math.max(1.5, ph * 0.12);
        const gap = Math.max(1.5, ph * 0.15);
        parts.push(`<g transform="translate(${n(px)},${n(py)}) rotate(${n(angDeg)})">`);
        parts.push(`<line x1="${n(-ph/2)}" y1="${n(-gap)}" x2="${n(ph/2)}" y2="${n(-gap)}" stroke="#dc2626" stroke-width="${n(lw)}" stroke-linecap="round"/>`);
        parts.push(`<line x1="${n(-ph/2)}" y1="${n(gap)}"  x2="${n(ph/2)}" y2="${n(gap)}"  stroke="#dc2626" stroke-width="${n(lw)}" stroke-linecap="round"/>`);
        parts.push(`</g>`);

        // Индикаторы замерной станции
        const brMs = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
        const msLines: string[] = [];
        if (sym.msIndNumber && sym.msNumber)     msLines.push(`№${sym.msNumber}`);
        if (sym.msIndLocation && sym.msLocation) msLines.push(sym.msLocation);
        if (sym.msIndFlow) {
          const q = sym.msFlow ?? (brMs ? Math.abs(brMs.flow ?? 0) : 0);
          msLines.push(`Q=${q.toFixed(2)} м³/с`);
        }
        if (sym.msIndArea) {
          const a = sym.msArea ?? (brMs?.area ?? 0);
          msLines.push(`S=${a.toFixed(2)} м²`);
        }
        if (sym.msIndVelocity) {
          const v = sym.msVelocity ?? (brMs ? Math.abs(brMs.velocity ?? 0) : 0);
          msLines.push(`v=${v.toFixed(2)} м/с`);
        }
        if (msLines.length > 0) {
          const brDxMs = tsx2 - fsx, brDyMs = tsy2 - fsy;
          const brLenMs = Math.hypot(brDxMs, brDyMs);
          const perpXms = brLenMs > 0 ? -brDyMs / brLenMs : 0;
          const perpYms = brLenMs > 0 ?  brDxMs / brLenMs : 0;
          const fsMs = Math.max(6, (sym.msIndFontSize ?? 9) * sc * ss);
          const lhMs = fsMs + 3;
          const boxWMs = Math.max(...msLines.map(l => l.length)) * fsMs * 0.52 + 10;
          const boxHMs = msLines.length * lhMs + 6;
          const bxMs = px + perpXms * (16 + boxWMs / 2) + (sym.msIndOffsetX ?? 0);
          const byMs = py + perpYms * (16 + boxHMs / 2) + (sym.msIndOffsetY ?? 0);
          parts.push(`<line x1="${n(px)}" y1="${n(py)}" x2="${n(bxMs)}" y2="${n(byMs - boxHMs/2)}" stroke="#555555" stroke-width="0.4" stroke-dasharray="2 3"/>`);
          msLines.forEach((line, i) => {
            const tyMs = byMs - boxHMs/2 + i * lhMs + 3;
            const fwMs = i === 0 && sym.msIndNumber ? "700" : "400";
            parts.push(`<text x="${n(bxMs)}" y="${n(tyMs)}" text-anchor="middle" dominant-baseline="auto" font-size="${n(fsMs, 1)}" font-weight="${fwMs}" stroke="white" stroke-width="2" paint-order="stroke" fill="#1a2a4a">${esc(line)}</text>`);
          });
        }
      } else if (isBulkhead && hasBranchPts) {
        // Перемычка — рисуем SVG-примитивами поперёк ветви
        const tid = sym.typeId;
        const fill = tid.includes("concrete") ? "#4caf50"
          : tid.includes("wood")   ? "#ffd600"
          : tid.includes("brick")  ? "#ff9800"
          : tid.includes("metal")  ? "#9c27b0"
          : (tid === "fire_door" || tid === "fire_door_pp") ? "#c00"
          : (tid === "barrier")    ? "#555"
          : "white";
        const stroke2 = tid.includes("concrete") ? "#1b5e20"
          : tid.includes("wood")   ? "#e65100"
          : tid.includes("brick")  ? "#bf360c"
          : tid.includes("metal")  ? "#4a148c"
          : (tid === "fire_door" || tid === "fire_door_pp") ? "#800"
          : "#1a1a1a";

        const ph = Math.max(3, SZ * 0.85);
        const pw2 = Math.max(1.5, ph * 0.38);
        const sw2 = Math.max(0.4, pw2 * 0.18);
        const isSail = tid === "sail";
        const isBarrier = tid === "barrier" || tid === "bulkhead_barrier";
        const isDoor = tid.includes("door_closed") || tid.includes("door_conc") || tid.includes("door_wood") || tid.includes("door_brick") || tid.includes("door_metal") || tid === "door_base";
        const isAuto = tid.includes("door_auto") || tid.includes("auto_");
        const isWindow = tid === "regulator_window" || tid.includes("win_") || tid === "bulkhead_window";
        const isLattice = tid === "regulator_lattice" || tid.includes("lat_");
        const isWater = tid.includes("water_dam");
        const isOpen = tid.includes("regulator_open") || tid.includes("open_");

        parts.push(`<g transform="translate(${n(px)},${n(py)}) rotate(${n(angDeg)})">`);

        if (isSail) {
          parts.push(`<line x1="0" y1="${n(-ph/2)}" x2="0" y2="${n(ph/2)}" stroke="${stroke2}" stroke-width="${n(Math.max(1.8,pw2*0.4))}" stroke-linecap="round"/>`);
          parts.push(`<path d="M0,${n(-ph*0.38)} Q${n(ph*0.6)},0 0,${n(ph*0.38)}" fill="none" stroke="${stroke2}" stroke-width="${n(Math.max(1.8,pw2*0.4))}"/>`);
        } else if (isBarrier) {
          parts.push(`<rect x="${n(-pw2)}" y="${n(-ph/2)}" width="${n(pw2)}" height="${n(ph)}" fill="#555" stroke="#222" stroke-width="1.3"/>`);
          parts.push(`<rect x="0" y="${n(-ph/2)}" width="${n(pw2)}" height="${n(ph)}" fill="#c00" stroke="#800" stroke-width="1.3"/>`);
        } else if (isOpen) {
          parts.push(`<rect x="${n(-pw2/2)}" y="${n(-ph/2)}" width="${n(pw2)}" height="${n(ph*0.38)}" fill="${fill}" stroke="${stroke2}" stroke-width="${n(sw2)}"/>`);
          parts.push(`<rect x="${n(-pw2/2)}" y="${n(ph*0.12)}" width="${n(pw2)}" height="${n(ph*0.38)}" fill="${fill}" stroke="${stroke2}" stroke-width="${n(sw2)}"/>`);
          parts.push(`<line x1="${n(-pw2/2)}" y1="${n(ph*0.12)}" x2="${n(-pw2/2-ph*0.45)}" y2="${n(ph/2)}" stroke="${stroke2}" stroke-width="${n(Math.max(1.8,pw2*0.3))}" stroke-linecap="round"/>`);
        } else if (isDoor || isAuto) {
          parts.push(`<rect x="${n(-pw2/2)}" y="${n(-ph/2)}" width="${n(pw2)}" height="${n(ph)}" fill="${fill}" stroke="${stroke2}" stroke-width="${n(sw2)}"/>`);
          parts.push(`<line x1="${n(-pw2/2)}" y1="${n(-ph/2)}" x2="${n(-pw2/2)}" y2="${n(ph/2)}" stroke="${stroke2}" stroke-width="${n(Math.max(2,pw2*0.35))}" stroke-linecap="round"/>`);
          if (isAuto) {
            const cx2 = pw2/2 + ph*0.28;
            parts.push(`<circle cx="${n(cx2)}" cy="0" r="${n(ph*0.2)}" fill="white" stroke="${stroke2}" stroke-width="1.2"/>`);
            parts.push(`<text x="${n(cx2)}" y="0" text-anchor="middle" dominant-baseline="middle" font-size="${n(ph*0.2)}" font-weight="bold" fill="${stroke2}">А</text>`);
          }
        } else {
          parts.push(`<rect x="${n(-pw2/2)}" y="${n(-ph/2)}" width="${n(pw2)}" height="${n(ph)}" fill="${fill}" stroke="${stroke2}" stroke-width="${n(sw2)}"/>`);
          if (isWindow) {
            parts.push(`<rect x="${n(-pw2*0.25)}" y="${n(-ph*0.2)}" width="${n(pw2*0.5)}" height="${n(ph*0.4)}" fill="white" stroke="${stroke2}" stroke-width="${n(sw2)}"/>`);
          }
          if (isLattice) {
            for (let li = -1; li <= 1; li++) {
              parts.push(`<line x1="${n(pw2*0.2*li)}" y1="${n(-ph*0.45)}" x2="${n(pw2*0.2*li)}" y2="${n(ph*0.45)}" stroke="${stroke2}" stroke-width="0.8"/>`);
            }
            parts.push(`<line x1="${n(-pw2*0.4)}" y1="0" x2="${n(pw2*0.4)}" y2="0" stroke="${stroke2}" stroke-width="0.8"/>`);
          }
          if (isWater) {
            parts.push(`<text x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-size="${n(ph*0.3)}" font-weight="bold" fill="${fill === "white" ? "#1565c0" : "white"}">D</text>`);
          }
          if (tid === "fire_door") {
            parts.push(`<text x="0" y="0" text-anchor="middle" dominant-baseline="middle" font-size="${n(ph*0.22)}" font-weight="bold" fill="white">ПП</text>`);
          }
        }
        parts.push(`</g>`);

        // Индикаторы перемычки
        if (sym.branchId) {
          const br = branches.find(b => b.id === sym.branchId);
          if (br) {
            const uRes2 = getUnit(unitsConfig, "resistance");
            const uPres2 = getUnit(unitsConfig, "pressure");
            const uFlow2 = getUnit(unitsConfig, "flow");
            const indLines: string[] = [];
            if (sym.indDescription && sym.description) indLines.push(sym.description);
            if (sym.indResistance) {
              const rVal = br.bulkheadR > 0 ? br.bulkheadR : br.resistance / 1e6;
              indLines.push(`R=${uRes2.fromBase(rVal).toFixed(uRes2.decimals)} ${uRes2.symbol}`);
            }
            if (sym.indDeltaP && br.dP !== 0)
              indLines.push(`ΔP=${uPres2.fromBase(Math.abs(br.dP)).toFixed(uPres2.decimals)} ${uPres2.symbol}`);
            if (sym.indLeakage && br.flow !== 0)
              indLines.push(`Q=${uFlow2.fromBase(Math.abs(br.flow)).toFixed(uFlow2.decimals)} ${uFlow2.symbol}`);

            if (indLines.length > 0) {
              const brDx2 = tsx2 - fsx, brDy2 = tsy2 - fsy;
              const brLen2 = Math.hypot(brDx2, brDy2);
              const perpX = brLen2 > 0 ? -brDy2 / brLen2 : 0;
              const perpY = brLen2 > 0 ?  brDx2 / brLen2 : 0;
              const fs2 = Math.max(6, 9 * sc * ss);
              const lh2 = fs2 + 3;
              const boxW2 = Math.max(...indLines.map(l => l.length)) * fs2 * 0.52 + 10;
              const boxH2 = indLines.length * lh2 + 6;
              const bx = px + perpX * (16 + boxW2 / 2) + (sym.indOffsetX ?? 0);
              const by = py + perpY * (16 + boxH2 / 2) + (sym.indOffsetY ?? 0);
              parts.push(`<line x1="${n(px)}" y1="${n(py)}" x2="${n(bx)}" y2="${n(by - boxH2/2)}" stroke="#555555" stroke-width="0.4" stroke-dasharray="2 3"/>`);
              indLines.forEach((line, i) => {
                const ty2 = by - boxH2/2 + i * lh2 + 3;
                const fw2 = i === 0 && sym.indDescription ? "600" : "400";
                parts.push(`<text x="${n(bx)}" y="${n(ty2)}" text-anchor="middle" dominant-baseline="auto" font-size="${n(fs2, 1)}" font-weight="${fw2}" stroke="white" stroke-width="2" paint-order="stroke" fill="#1a2a4a">${esc(line)}</text>`);
              });
            }
          }
        }
      } else if (lt) {
        // Обычный символ УО — вставляем svgContent через <use> с трансформом
        const symId = `uo-${sym.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const HX = px - SZ / 2;
        const HY = py - SZ / 2 - 4;
        const ROTATE_WITH_BRANCH = new Set(["valve_reduce", "valve_water", "valve_gate", "check_valve"]);
        const needsRotate = hasBranchPts && ROTATE_WITH_BRANCH.has(sym.typeId);

        const isFanStopped = sym.typeId === "fan" && sym.branchId
          ? (branches.find(b => b.id === sym.branchId)?.fanStopped ?? false)
          : false;

        const opacityAttr = isFanStopped ? ` opacity="0.35"` : "";

        if (needsRotate) {
          parts.push(`<g transform="translate(${n(px)},${n(py)}) rotate(${n(angDeg)})" ${opacityAttr}>`);
          parts.push(`<svg x="${n(-SZ/2)}" y="${n(-SZ/2-4)}" width="${n(SZ)}" height="${n(SZ)}" viewBox="0 0 48 40">${lt.svgContent}</svg>`);
          parts.push(`</g>`);
        } else {
          parts.push(`<g${opacityAttr}>`);
          parts.push(`<svg x="${n(HX)}" y="${n(HY)}" width="${n(SZ)}" height="${n(SZ)}" viewBox="0 0 48 40">${lt.svgContent}</svg>`);
          parts.push(`</g>`);
        }

        // Стрелка направления вентилятора
        if (!isFanStopped && sym.typeId === "fan" && hasBranchPts && (sym.showFanArrow ?? true)) {
          const iconCx = HX + SZ / 2;
          const iconCy = HY + SZ * (20 / 48);
          const rIcon  = SZ * (16 / 48);
          const aLen   = SZ * 0.32;
          const arrowAngle = sym.airDirection === "reverse" ? brAngle + Math.PI : brAngle;
          const aAngDeg = arrowAngle * 180 / Math.PI;
          const head = Math.max(3, SZ * 0.13);
          const x0 = rIcon, x1 = rIcon + aLen;
          const sw3 = Math.max(0.8, SZ * 0.045);
          parts.push(`<g transform="translate(${n(iconCx)},${n(iconCy)}) rotate(${n(aAngDeg)})">`);
          parts.push(`<line x1="${n(x0)}" y1="0" x2="${n(x1-head*0.5)}" y2="0" stroke="#111" stroke-width="${n(sw3)}" stroke-linecap="round"/>`);
          parts.push(`<polygon points="${n(x1-head)},${n(-head*0.55)} ${n(x1)},0 ${n(x1-head)},${n(head*0.55)}" fill="#111"/>`);
          parts.push(`</g>`);
        }

        // Подпись
        if (sym.label) {
          parts.push(`<text x="${n(px)}" y="${n(py + SZ/2 + 12)}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${n(Math.round(9 * sc * ss), 1)}" fill="#374151">${esc(sym.label)}</text>`);
        }
      }
    }
    parts.push(`</g>`); // /schema-symbols
  }

  // ── Рамка печати ─────────────────────────────────────────────────────────
  // При активном слое печати: vbX=0,vbY=0,vbW=canvasW,vbH=canvasH.
  // frameRect уже в пространстве viewBox (0..canvasW, 0..canvasH).
  if (pl && frameRect) {
    const { rx, ry, rw, rh } = frameRect;
    const frameSvgContent = buildPrintLayerSvgString({
      pl,
      rx, ry, rw, rh,
      totalW: vbW,
      totalH: vbH,
      schemaSymbols,
    });
    const bodyMatch = frameSvgContent.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    if (bodyMatch) {
      parts.push(`<g id="print-layer">`);
      parts.push(bodyMatch[1]);
      parts.push(`</g>`);
    }
  } else if (opts.printLayerSvg) {
    const bodyMatch = opts.printLayerSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    if (bodyMatch) {
      parts.push(`<g id="print-layer">`);
      parts.push(bodyMatch[1]);
      parts.push(`</g>`);
    }
  }

  // ── Маркеры позиций ПЛА (кружки с номерами) ──────────────────────────────
  const visiblePositions = positions.filter(pos => pos.visible !== false && pos.x != null);
  if (visiblePositions.length > 0) {
    // posSF: в режиме 1 (fixedObjectScale) — pxPerMm фиксированный,
    // в режиме 2 — масштабируется как objSF (тот же коэффициент).
    const posSVGSF = fixedObjectScale ? 1 : objSF;
    const PX_PER_MM = pxPerMm * posSVGSF;
    parts.push(`<g id="positions">`);
    for (const pos of visiblePositions) {
      const p = project3D({ x: pos.x * _xySFExport, y: pos.y * _xySFExport, z: (pos.z ?? 0) * zScale }, proj);
      const r = (pos.diameter ?? 13) * PX_PER_MM / 2;
      const isReverse = pos.positionType === "reverse";
      const fill = esc(pos.color ?? "#ffffff");
      const border = esc(pos.borderColor ?? "#000000");
      const sw = Math.max(0.5, r * 0.12);
      const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
      const cx = n(p.sx), cy = n(p.sy);
      parts.push(`<g transform="translate(${cx},${cy})">`);
      if (isReverse) {
        parts.push(`<circle r="${n(r + 7)}" fill="none" stroke="#e53e3e" stroke-width="2.5"/>`);
        parts.push(`<circle r="${n(r + 4)}" fill="none" stroke="#ffffff" stroke-width="3"/>`);
      }
      parts.push(`<circle r="${n(r)}" fill="${fill}" stroke="${border}" stroke-width="${n(sw)}"/>`);
      parts.push(`<text text-anchor="middle" dominant-baseline="central" font-size="${n(fontSize)}" font-weight="bold" font-family="Arial,sans-serif" fill="#000000">${pos.number}</text>`);
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
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