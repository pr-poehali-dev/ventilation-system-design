// Генерация SVG-строки слоя печати (без React) для рендера в canvas через Image.
// Использует те же формулы что renderPrintLayerSvgContent в printLayerSvg.tsx.
import type { HorizonPrintLayer, PaperFormat } from "@/lib/topology";
import { PAPER_SIZES_MM } from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { computeStampBox, buildStampSvgString } from "@/lib/stampTemplate";
import type { SchemaSymbol } from "@/pages/Cad";

function e(s: string | number): string {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function n(v: number, d = 2): string { return v.toFixed(d); }

export interface BuildSvgOpts {
  pl: HorizonPrintLayer;
  rx: number; ry: number; rw: number; rh: number;
  totalW: number; totalH: number;
  /** УО размещённые на схеме — для блока условных обозначений */
  schemaSymbols?: SchemaSymbol[];
}

export function buildPrintLayerSvgString({ pl, rx, ry, rw, rh, totalW, totalH, schemaSymbols = [] }: BuildSvgOpts): string {
  const inset = Math.max(4, Math.min(rw, rh) * 0.015);
  const titleFontSize = Math.max(9, Math.min(18, rh * 0.03));
  let body = "";

  // Рамки (без белой подложки — схема видна из canvas под SVG)
  body += `<rect x="${n(rx)}" y="${n(ry)}" width="${n(rw)}" height="${n(rh)}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`;
  body += `<rect x="${n(rx+inset)}" y="${n(ry+inset)}" width="${n(rw-inset*2)}" height="${n(rh-inset*2)}" fill="none" stroke="#1a1a1a" stroke-width="0.8"/>`;

  // Заголовок
  if (pl.title) {
    const tx = rx + rw / 2 + (pl.titleOffsetX ?? 0);
    const ty = ry + inset + titleFontSize + 4 + (pl.titleOffsetY ?? 0);
    body += `<text x="${n(tx)}" y="${n(ty)}" text-anchor="middle" dominant-baseline="hanging" font-size="${n(titleFontSize)}" font-family="Arial, sans-serif" font-weight="bold" fill="#111">${e(pl.title)}</text>`;
  }

  // Блок УТВЕРЖДАЮ
  if (pl.showApprover) {
    const apW = Math.min(rw * 0.28, 220);
    const apX = rx + rw - inset - apW;
    const apFs = Math.max(7, Math.min(13, rh * 0.018));
    const lw2 = Math.max(0.4, apFs * 0.06);
    const apCx = apX + apW / 2;
    let ay = ry + inset + 2 + apFs * 1.4;
    body += `<rect x="${n(apX)}" y="${n(ry+inset+2)}" width="${n(apW)}" height="${n(apFs*10)}" fill="white"/>`;
    body += `<text x="${n(apCx)}" y="${n(ay)}" text-anchor="middle" font-size="${n(apFs*1.1)}" font-family="Arial, sans-serif" fill="#111">УТВЕРЖДАЮ</text>`;
    ay += apFs * 1.6;
    body += `<text x="${n(apCx)}" y="${n(ay)}" text-anchor="middle" font-size="${n(apFs)}" font-family="Arial, sans-serif" fill="#111">${e(pl.approverTitle || "Должность")}</text>`;
    ay += apFs * 1.4;
    body += `<text x="${n(apCx)}" y="${n(ay)}" text-anchor="middle" font-size="${n(apFs)}" font-family="Arial, sans-serif" fill="#111">${e(pl.orgName || "Организация")}</text>`;
    ay += apFs * 1.6;
    body += `<line x1="${n(apX+apFs)}" y1="${n(ay)}" x2="${n(apX+apW-apFs)}" y2="${n(ay)}" stroke="#111" stroke-width="${n(lw2)}"/>`;
    ay += apFs * 1.2;
    body += `<text x="${n(apX+apW-apFs*0.5)}" y="${n(ay)}" text-anchor="end" font-size="${n(apFs)}" font-family="Arial, sans-serif" fill="#1a44b8">${e(pl.approverName || "И.О. Фамилия")}</text>`;
    ay += apFs * 1.4;
    body += `<line x1="${n(apX)}" y1="${n(ay)}" x2="${n(apX+apW)}" y2="${n(ay)}" stroke="#111" stroke-width="${n(lw2)}"/>`;
    ay += apFs * 1.2;
    body += `<text x="${n(apX+apFs*0.3)}" y="${n(ay)}" text-anchor="start" font-size="${n(apFs)}" font-family="Arial, sans-serif" fill="#111">«${e(pl.day||"__")}»</text>`;
    body += `<text x="${n(apX+apFs*3.2)}" y="${n(ay)}" text-anchor="start" font-size="${n(apFs)}" font-family="Arial, sans-serif" fill="#111">${e(pl.month||"__________")}</text>`;
    body += `<text x="${n(apX+apW-apFs*0.3)}" y="${n(ay)}" text-anchor="end" font-size="${n(apFs)}" font-family="Arial, sans-serif" fill="#111">${e(pl.year||String(new Date().getFullYear()))} г.</text>`;
  }

  // Блок УО — из реально установленных символов на схеме
  if (pl.showLegend && schemaSymbols.length > 0) {
    // Собираем уникальные типы УО
    const usedTypeIds = [...new Set(schemaSymbols.map(s => s.typeId))];
    const items: { name: string; svgContent: string; isBulkhead: boolean; tid: string }[] = [];
    for (const tid of usedTypeIds) {
      const lt = LEGEND_TYPES.find(l => l.id === tid);
      const isBk = BULKHEAD_SYMBOL_IDS.has(tid);
      if (lt) items.push({ name: lt.name, svgContent: lt.svgContent, isBulkhead: false, tid });
      else if (isBk) {
        const bkName = tid.replace(/_/g, " ");
        items.push({ name: bkName, svgContent: "", isBulkhead: true, tid });
      }
    }
    if (items.length > 0) {
      const legFs = Math.max(7, Math.min(13, rh * 0.018));
      const legIconSZ = legFs * 2.2;
      const legLineH = legIconSZ + legFs * 0.4;
      const legPad = legFs * 0.6;
      const legW = Math.max(120, rw * 0.22);
      const legH = legPad * 2 + items.length * legLineH + legFs * 1.5;
      const lx = rx + (pl.legendOffsetX ?? 0);
      const ly = ry + rh - legH + (pl.legendOffsetY ?? 0);

      body += `<rect x="${n(lx)}" y="${n(ly)}" width="${n(legW)}" height="${n(legH)}" fill="white" stroke="#333" stroke-width="${n(Math.max(0.5, rw*0.002))}"/>`;
      body += `<text x="${n(lx+legPad)}" y="${n(ly+legPad+legFs)}" font-size="${n(legFs)}" font-family="Arial, sans-serif" font-weight="bold" fill="#111">Условные обозначения</text>`;

      items.forEach((item, idx) => {
        const iy = ly + legPad + legFs * 1.5 + idx * legLineH;
        const icX = lx + legPad;
        const icY = iy + (legLineH - legIconSZ) / 2;

        if (!item.isBulkhead && item.svgContent) {
          // Inline SVG-иконка из LEGEND_TYPES
          body += `<svg x="${n(icX)}" y="${n(icY)}" width="${n(legIconSZ)}" height="${n(legIconSZ)}" viewBox="0 0 48 40">${item.svgContent}</svg>`;
        } else {
          // Перемычка — упрощённый символ
          const fill2 = item.tid.includes("concrete") ? "#4caf50"
            : item.tid.includes("wood")   ? "#ffd600"
            : item.tid.includes("brick")  ? "#ff9800"
            : item.tid.includes("metal")  ? "#9c27b0"
            : "white";
          const ph = legIconSZ * 0.8, pw2 = ph * 0.35;
          const pcx = icX + legIconSZ / 2, pcy = icY + legIconSZ / 2;
          body += `<line x1="${n(icX)}" y1="${n(pcy)}" x2="${n(icX+legIconSZ)}" y2="${n(pcy)}" stroke="#555" stroke-width="1.2"/>`;
          body += `<rect x="${n(pcx-pw2/2)}" y="${n(pcy-ph/2)}" width="${n(pw2)}" height="${n(ph)}" fill="${fill2}" stroke="#1a1a1a" stroke-width="1"/>`;
        }
        body += `<text x="${n(lx+legPad+legIconSZ+legPad*0.5)}" y="${n(iy+legLineH*0.6)}" font-size="${n(legFs*0.88)}" font-family="Arial, sans-serif" fill="#333">${e(item.name)}</text>`;
      });
    }
  }

  // Штамп ГОСТ 185×55мм — фиксированный размер по формату листа
  if (pl.showStamp) {
    const fmt = (pl.paperFormat ?? "A3") as PaperFormat;
    const ori = pl.orientation ?? "landscape";
    const mm = PAPER_SIZES_MM[fmt];
    const paperWmm = ori === "landscape" ? Math.max(mm.w, mm.h) : Math.min(mm.w, mm.h);
    const box = computeStampBox(rx, ry, rw, rh, inset, paperWmm, pl.stampOffsetX ?? 0, pl.stampOffsetY ?? 0);
    body += buildStampSvgString(pl, box);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(totalW)}" height="${n(totalH)}">${body}</svg>`;
}