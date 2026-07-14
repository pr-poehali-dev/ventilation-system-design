// Утилита: рендер SVG-содержимого слоя печати (рамка, заголовок, УТВЕРЖДАЮ, УО, штамп).
// Используется и в TopoCanvas (рабочая область), и в PrintPreviewCanvas (предпросмотр).
// Принимает готовые экранные координаты рамки rx,ry,rw,rh.
import React from "react";
import type { HorizonPrintLayer, PaperFormat, TopoBranch } from "@/lib/topology";
import { PAPER_SIZES_MM } from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, FAN_SVG_STATION, FAN_SVG_PROPELLER } from "@/lib/schemaSymbols";
import {
  computeStampBox, buildStampCells, buildStampGridLines, getStampFieldValue,
} from "@/lib/stampTemplate";
import {
  computeApproverBox, buildApproverElements, buildApproverLines, getApproverFieldValue,
} from "@/lib/approverTemplate";
import type { SchemaSymbol } from "@/pages/Cad";

export interface PrintLayerSvgOptions {
  pl: HorizonPrintLayer;
  rx: number;
  ry: number;
  rw: number;
  rh: number;
  /** УО размещённые на схеме — для блока условных обозначений */
  schemaSymbols?: SchemaSymbol[];
  /** Ветви — для определения назначения вентиляторов (ГВУ/ВВУ/ВМП) в легенде */
  branches?: TopoBranch[];
}

export function renderPrintLayerSvgContent({ pl, rx, ry, rw, rh, schemaSymbols = [], branches = [] }: PrintLayerSvgOptions): React.ReactNode {
  const inset = Math.max(4, Math.min(rw, rh) * 0.015);
  // Размер заголовка пропорционален формату листа (как штамп/Утв), а не rh.
  const _mmT = PAPER_SIZES_MM[(pl.paperFormat ?? "A3") as PaperFormat];
  const _paperWmmT = (pl.orientation ?? "landscape") === "landscape" ? Math.max(_mmT.w, _mmT.h) : Math.min(_mmT.w, _mmT.h);
  const _pxPerMmT = rw / _paperWmmT;
  const titleFontSize = Math.max(6, _pxPerMmT * 5.5);

  // ── Блок УТВЕРЖДАЮ — фиксированный размер по формату листа ───────────────
  const approverBlock = pl.showApprover ? (() => {
    const fmtA = (pl.paperFormat ?? "A3") as PaperFormat;
    const oriA = pl.orientation ?? "landscape";
    const mmA = PAPER_SIZES_MM[fmtA];
    const paperWmmA = oriA === "landscape" ? Math.max(mmA.w, mmA.h) : Math.min(mmA.w, mmA.h);
    const box = computeApproverBox(rx, ry, rw, inset, paperWmmA);
    const { pxPerMm, w: apW, h: apH, ax, ay } = box;
    const mx = (m: number) => ax + m * pxPerMm;
    const my = (m: number) => ay + m * pxPerMm;
    const baseFs = Math.max(6, pxPerMm * 2.6);
    const lw2 = Math.max(0.4, pxPerMm * 0.15);
    const yearNow = String(new Date().getFullYear());
    return (
      <g key="approver-block">
        <rect x={ax} y={ay} width={apW} height={apH} fill="white" style={{ pointerEvents: "none" }} />
        {buildApproverLines().map((ln, i) => (
          <line key={`al-${i}`} x1={mx(ln.x1)} y1={my(ln.y1)} x2={mx(ln.x2)} y2={my(ln.y2)} stroke="#111" strokeWidth={lw2} />
        ))}
        {buildApproverElements().map((el, i) => {
          const fs = baseFs * (el.fontScale ?? 1);
          const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
          const color = el.color ?? "#111";
          let txt = el.label ?? "";
          if (el.field) {
            const v = getApproverFieldValue(pl, el.field);
            txt = v || (el.field === "year" ? yearNow : "");
            if (el.field === "year" && txt) txt += " г.";
          }
          if (!txt) return null;
          return <text key={`ap-${i}`} x={mx(el.x)} y={my(el.y)} textAnchor={anchor} dominantBaseline="central"
            fontSize={fs} fontFamily="Arial, sans-serif" fill={color}>{txt}</text>;
        })}
      </g>
    );
  })() : null;

  // ── Блок УО — из реально установленных символов на схеме ────────────────
  const legendBlock = (pl.showLegend && schemaSymbols.length > 0) ? (() => {
    // Собираем уникальные типы УО
    const usedTypeIds = [...new Set(schemaSymbols.map(s => s.typeId))];
    const items: { name: string; svgContent: string; isBulkhead: boolean; tid: string }[] = [];
    for (const tid of usedTypeIds) {
      const lt = LEGEND_TYPES.find(l => l.id === tid);
      const isBk = BULKHEAD_SYMBOL_IDS.has(tid);
      if (tid === "fan") {
        const fanTypes = new Set(
          schemaSymbols.filter(s => s.typeId === "fan")
            .map(s => branches.find(b => b.id === s.branchId)?.fanType ?? "ВМП")
        );
        if (fanTypes.has("ГВУ") || fanTypes.has("ВВУ"))
          items.push({ name: "Вентиляторная установка (ГВУ/ВВУ)", svgContent: FAN_SVG_STATION, isBulkhead: false, tid });
        if (fanTypes.has("ВМП") || fanTypes.size === 0)
          items.push({ name: "Вентилятор местного проветривания (ВМП)", svgContent: FAN_SVG_PROPELLER, isBulkhead: false, tid });
      }
      else if (lt) items.push({ name: lt.name, svgContent: lt.svgContent, isBulkhead: false, tid });
      else if (isBk) items.push({ name: tid.replace(/_/g, " "), svgContent: "", isBulkhead: true, tid });
    }
    if (items.length === 0) return null;

    // Фиксированный масштаб по формату листа (как у штампа)
    const _mmL = PAPER_SIZES_MM[(pl.paperFormat ?? "A3") as PaperFormat];
    const _paperWmmL = (pl.orientation ?? "landscape") === "landscape" ? Math.max(_mmL.w, _mmL.h) : Math.min(_mmL.w, _mmL.h);
    const pxPerMmL = rw / _paperWmmL;
    const legFontSize = pxPerMmL * 2.6;
    const legIconSZ = pxPerMmL * 5.5;
    const legLineH = legIconSZ + legFontSize * 0.4;
    const legPad = legFontSize * 0.6;
    const legW = pxPerMmL * 60;
    const legH = legPad * 2 + items.length * legLineH + legFontSize * 1.5;
    const lx = rx + inset + (pl.legendOffsetX ?? 0);
    const ly = ry + rh - inset - legH + (pl.legendOffsetY ?? 0);

    return (
      <g key="legend-block">
        <text x={lx} y={ly + legPad + legFontSize} fontSize={legFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
          Условные обозначения
        </text>
        {items.map((item, idx) => {
          const iy = ly + legPad + legFontSize * 1.5 + idx * legLineH;
          const icX = lx;
          const icY = iy + (legLineH - legIconSZ) / 2;
          return (
            <g key={idx}>
              {!item.isBulkhead && item.svgContent ? (
                // Inline SVG-иконка из LEGEND_TYPES (через foreignObject workaround → используем image/svg)
                <image
                  x={icX} y={icY} width={legIconSZ} height={legIconSZ}
                  href={`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40">${encodeURIComponent(item.svgContent)}</svg>`}
                />
              ) : (
                // Перемычка — упрощённый символ
                <g>
                  <line x1={icX} y1={iy + legLineH / 2} x2={icX + legIconSZ} y2={iy + legLineH / 2} stroke="#555" strokeWidth={1.2} />
                  <rect
                    x={icX + legIconSZ / 2 - legIconSZ * 0.175}
                    y={icY + legIconSZ * 0.1}
                    width={legIconSZ * 0.35} height={legIconSZ * 0.8}
                    fill={item.tid.includes("concrete") ? "#4caf50" : item.tid.includes("wood") ? "#ffd600" : item.tid.includes("brick") ? "#ff9800" : item.tid.includes("metal") ? "#9c27b0" : item.tid.includes("regulator") ? "#ffd600" : "white"}
                    stroke="#1a1a1a" strokeWidth={1}
                  />
                </g>
              )}
              <text x={lx + legIconSZ + legPad * 0.8} y={iy + legLineH * 0.6}
                fontSize={legFontSize * 0.88} fontFamily="Arial, sans-serif" fill="#333">
                {item.name}
              </text>
            </g>
          );
        })}
      </g>
    );
  })() : null;

  // ── Штамп ГОСТ 185×55мм — фиксированный размер по формату листа ──────────
  const stampBlock = pl.showStamp ? (() => {
    const fmt = (pl.paperFormat ?? "A3") as PaperFormat;
    const ori = pl.orientation ?? "landscape";
    const mm = PAPER_SIZES_MM[fmt];
    const paperWmm = ori === "landscape" ? Math.max(mm.w, mm.h) : Math.min(mm.w, mm.h);
    const box = computeStampBox(rx, ry, rw, rh, inset, paperWmm, pl.stampOffsetX ?? 0, pl.stampOffsetY ?? 0);
    const { pxPerMm, stW, stH, sx, sy } = box;
    const mx = (m: number) => sx + m * pxPerMm;
    const my = (m: number) => sy + m * pxPerMm;
    const sw = Math.max(0.4, pxPerMm * 0.35);
    const swThin = Math.max(0.25, pxPerMm * 0.18);
    const baseFs = Math.max(5, pxPerMm * 2.3);
    return (
      <g key="stamp-block">
        <rect x={sx} y={sy} width={stW} height={stH} fill="white" />
        {buildStampGridLines().map((ln, i) => (
          <line key={`gl-${i}`} x1={mx(ln.x1)} y1={my(ln.y1)} x2={mx(ln.x2)} y2={my(ln.y2)}
            stroke="#1a1a1a" strokeWidth={ln.thick ? sw : swThin} />
        ))}
        {buildStampCells(pl).map((c, i) => {
          const cw = c.w * pxPerMm, ch = c.h * pxPerMm;
          const fs = baseFs * (c.fontScale ?? 1);
          const tx = c.align === "left" ? mx(c.x) + pxPerMm * 1.2 : mx(c.x) + cw / 2;
          const ty = my(c.y) + ch / 2;
          const anchor = c.align === "left" ? "start" : "middle";
          const weight = c.bold ? "bold" : "normal";
          if (c.label && !c.field) {
            return <text key={`lbl-${i}`} x={tx} y={ty} textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif" fontWeight={weight} fill="#333">{c.label}</text>;
          }
          if (c.field) {
            const val = getStampFieldValue(pl, c.field);
            if (!val) return null;
            return <text key={`val-${i}`} x={tx} y={ty} textAnchor={anchor} dominantBaseline="central"
              fontSize={fs} fontFamily="Arial, sans-serif" fontWeight={weight} fill="#111">{val}</text>;
          }
          return null;
        })}
      </g>
    );
  })() : null;

  return (
    <>
      {/* Внешняя рамка (без белой подложки — схема видна сквозь неё) */}
      <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke="#1a1a1a" strokeWidth={2} />
      {/* Внутренняя рамка */}
      <rect x={rx + inset} y={ry + inset} width={rw - inset * 2} height={rh - inset * 2} fill="none" stroke="#1a1a1a" strokeWidth={0.8} />
      {/* Заголовок */}
      {pl.title && (
        <text
          x={rx + rw / 2 + (pl.titleOffsetX ?? 0)}
          y={ry + inset + titleFontSize + 4 + (pl.titleOffsetY ?? 0)}
          textAnchor="middle" dominantBaseline="hanging"
          fontSize={titleFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
          {pl.title}
        </text>
      )}
      {approverBlock}
      {legendBlock}
      {stampBlock}
    </>
  );
}

// Вычисляет bbox рамки слоя печати в экранных координатах предпросмотра.
// Принимает schemaBbox в единицах proj (scale=prevSc, offset=prevOff).
export function computePrintLayerRect(
  pl: HorizonPrintLayer,
  schemaBbox: { minSx: number; maxSx: number; minSy: number; maxSy: number },
  canvasW: number, canvasH: number,
): { rx: number; ry: number; rw: number; rh: number } {
  const { minSx, maxSx, minSy, maxSy } = schemaBbox;
  const sw = maxSx - minSx || 1;
  const sh = maxSy - minSy || 1;

  // Пропорции бумаги из настроек слоя печати (портретные размеры w < h)
  const fmt = pl.paperFormat ?? "A3";
  const ori = pl.orientation ?? "landscape";
  const paperSizes: Record<string, { w: number; h: number }> = {
    A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 },
    A2: { w: 420, h: 594 }, A1: { w: 594, h: 841 }, A0: { w: 841, h: 1189 },
  };
  const mm = paperSizes[fmt] ?? paperSizes["A3"];
  // Аспект рамки: ширина / высота
  const mmW = ori === "landscape" ? mm.h : mm.w;
  const mmH = ori === "landscape" ? mm.w : mm.h;
  const aspect = mmW / mmH;

  const pad = Math.max(sw, sh) * 0.08 + 15;
  const scx = (minSx + maxSx) / 2;
  const scy = (minSy + maxSy) / 2;
  const fitSw = sw + pad * 2;
  const fitSh = sh + pad * 2;
  let rsw = fitSw, rsh = fitSw * aspect;
  if (rsh < fitSh) { rsh = fitSh; rsw = fitSh / aspect; }
  rsw = Math.max(rsw, sw + pad * 2);
  rsh = rsw * aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh / aspect; }

  // Ограничиваем размером canvas с отступом
  const maxW = canvasW * 0.98;
  const maxH = canvasH * 0.98;
  if (rsw > maxW) { rsw = maxW; rsh = rsw * aspect; }
  if (rsh > maxH) { rsh = maxH; rsw = rsh / aspect; }

  const rx = scx - rsw / 2;
  const ry = scy - rsh / 2;
  return { rx, ry, rw: Math.max(rsw, 40), rh: Math.max(rsh, 40) };
}