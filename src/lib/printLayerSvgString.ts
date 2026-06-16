// Генерация SVG-строки слоя печати (без React) для рендера в canvas через Image.
// Использует те же формулы что renderPrintLayerSvgContent в printLayerSvg.tsx.
import type { HorizonPrintLayer } from "@/lib/topology";

const LEGEND_ITEMS = [
  { name: "Позиция ПЛА",            color: "#333",    shape: "circle"   },
  { name: "Реверсивная позиция",     color: "#dc2626", shape: "circle2"  },
  { name: "Станция замера воздуха",  color: "#dc2626", shape: "lines2"   },
  { name: "Струя входящая",          color: "#dc2626", shape: "arrow-r"  },
  { name: "Струя исходящая",         color: "#2196f3", shape: "arrow-l"  },
  { name: "Устье выработки",         color: "#333",    shape: "rect-x"   },
  { name: "Блоковый запасной выход", color: "#333",    shape: "blocks3"  },
  { name: "Аварийная сигнализация",  color: "#333",    shape: "speaker"  },
  { name: "Запасной выход",          color: "#111",    shape: "blocks3b" },
  { name: "Телефон",                 color: "#333",    shape: "circle-t" },
  { name: "Огнетушитель",            color: "#dc2626", shape: "circle-o" },
];

function e(s: string | number): string {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function n(v: number, d = 2): string { return v.toFixed(d); }

function iconSvg(shape: string, color: string, x: number, y: number, iw: number, ih: number, fs: number): string {
  const cx = x + iw / 2, cy = y + ih / 2;
  const sw = Math.max(0.5, fs * 0.12);
  switch (shape) {
    case "circle":   return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ih*0.38)}" fill="none" stroke="${color}" stroke-width="${n(sw*1.5)}"/>`;
    case "circle2":  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ih*0.38)}" fill="none" stroke="${color}" stroke-width="${n(sw*2)}"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ih*0.19)}" fill="none" stroke="${color}" stroke-width="${n(sw)}"/>`;
    case "lines2":   return `<line x1="${n(x+1)}" y1="${n(cy-ih*0.1)}" x2="${n(x+iw-1)}" y2="${n(cy-ih*0.1)}" stroke="${color}" stroke-width="${n(sw*2.5)}"/><line x1="${n(x+1)}" y1="${n(cy+ih*0.1)}" x2="${n(x+iw-1)}" y2="${n(cy+ih*0.1)}" stroke="${color}" stroke-width="${n(sw*2.5)}"/>`;
    case "arrow-r":  return `<line x1="${n(x+1)}" y1="${n(cy)}" x2="${n(x+iw-ih*0.25)}" y2="${n(cy)}" stroke="${color}" stroke-width="${n(sw*2)}"/><polygon points="${n(x+iw-ih*0.3)},${n(cy-ih*0.28)} ${n(x+iw)},${n(cy)} ${n(x+iw-ih*0.3)},${n(cy+ih*0.28)}" fill="${color}"/>`;
    case "arrow-l":  return `<line x1="${n(x+ih*0.25)}" y1="${n(cy)}" x2="${n(x+iw-1)}" y2="${n(cy)}" stroke="${color}" stroke-width="${n(sw*2)}"/><polygon points="${n(x+ih*0.3)},${n(cy-ih*0.28)} ${n(x)},${n(cy)} ${n(x+ih*0.3)},${n(cy+ih*0.28)}" fill="${color}"/>`;
    case "rect-x":   return `<rect x="${n(cx-ih*0.3)}" y="${n(cy-ih*0.38)}" width="${n(ih*0.6)}" height="${n(ih*0.76)}" fill="none" stroke="${color}" stroke-width="${n(sw)}"/><line x1="${n(cx-ih*0.3)}" y1="${n(cy-ih*0.38)}" x2="${n(cx+ih*0.3)}" y2="${n(cy+ih*0.38)}" stroke="${color}" stroke-width="${n(sw*0.7)}"/><line x1="${n(cx+ih*0.3)}" y1="${n(cy-ih*0.38)}" x2="${n(cx-ih*0.3)}" y2="${n(cy+ih*0.38)}" stroke="${color}" stroke-width="${n(sw*0.7)}"/>`;
    case "blocks3":  return `<rect x="${n(x+1)}" y="${n(cy-ih*0.3)}" width="${n(iw*0.28)}" height="${n(ih*0.6)}" fill="#222"/><rect x="${n(x+iw*0.36)}" y="${n(cy-ih*0.3)}" width="${n(iw*0.28)}" height="${n(ih*0.6)}" fill="#ffd600"/><rect x="${n(x+iw*0.72)}" y="${n(cy-ih*0.3)}" width="${n(iw*0.26)}" height="${n(ih*0.6)}" fill="#222"/>`;
    case "blocks3b": return `<rect x="${n(x+1)}" y="${n(cy-ih*0.3)}" width="${n(iw*0.28)}" height="${n(ih*0.6)}" fill="#111"/><rect x="${n(x+iw*0.36)}" y="${n(cy-ih*0.3)}" width="${n(iw*0.28)}" height="${n(ih*0.6)}" fill="#111"/><rect x="${n(x+iw*0.72)}" y="${n(cy-ih*0.3)}" width="${n(iw*0.26)}" height="${n(ih*0.6)}" fill="#111"/>`;
    case "speaker":  return `<polygon points="${n(x+3)},${n(cy-ih*0.22)} ${n(cx-ih*0.08)},${n(cy-ih*0.22)} ${n(cx+ih*0.18)},${n(cy-ih*0.42)} ${n(cx+ih*0.18)},${n(cy+ih*0.42)} ${n(cx-ih*0.08)},${n(cy+ih*0.22)} ${n(x+3)},${n(cy+ih*0.22)}" fill="none" stroke="${color}" stroke-width="${n(sw)}"/>`;
    case "circle-t": return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ih*0.38)}" fill="none" stroke="${color}" stroke-width="${n(sw)}"/><text x="${n(cx)}" y="${n(cy+fs*0.35)}" text-anchor="middle" font-size="${n(fs*0.85)}" font-weight="bold" fill="${color}">T</text>`;
    case "circle-o": return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ih*0.38)}" fill="none" stroke="${color}" stroke-width="${n(sw)}"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(ih*0.19)}" fill="none" stroke="${color}" stroke-width="${n(sw)}"/>`;
    default: return "";
  }
}

export interface BuildSvgOpts {
  pl: HorizonPrintLayer;
  rx: number; ry: number; rw: number; rh: number;
  totalW: number; totalH: number;
}

export function buildPrintLayerSvgString({ pl, rx, ry, rw, rh, totalW, totalH }: BuildSvgOpts): string {
  const inset = Math.max(4, Math.min(rw, rh) * 0.015);
  const titleFontSize = Math.max(9, Math.min(18, rh * 0.03));
  let body = "";

  // Белая подложка + рамки
  body += `<rect x="${n(rx)}" y="${n(ry)}" width="${n(rw)}" height="${n(rh)}" fill="white"/>`;
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

  // Блок УО
  if (pl.showLegend) {
    const legFs = Math.max(7, Math.min(13, rh * 0.018));
    const legLineH = legFs * 1.6;
    const legIconW = legFs * 2.2;
    const legPad = legFs * 0.6;
    const legW = Math.max(100, rw * 0.22);
    const legH = legPad * 2 + LEGEND_ITEMS.length * legLineH + legFs * 1.5;
    const lx = rx + (pl.legendOffsetX ?? 0);
    const ly = ry + rh - legH + (pl.legendOffsetY ?? 0);
    body += `<rect x="${n(lx)}" y="${n(ly)}" width="${n(legW)}" height="${n(legH)}" fill="white" stroke="#333" stroke-width="${n(Math.max(0.5, rw*0.002))}"/>`;
    body += `<text x="${n(lx+legPad)}" y="${n(ly+legPad+legFs)}" font-size="${n(legFs)}" font-family="Arial, sans-serif" font-weight="bold" fill="#111">Условные обозначения</text>`;
    LEGEND_ITEMS.forEach((item, idx) => {
      const iy = ly + legPad + legFs * 1.5 + idx * legLineH;
      const ih = legLineH * 0.8;
      body += iconSvg(item.shape, item.color, lx + legPad, iy + (legLineH - ih) / 2, legIconW, ih, legFs);
      body += `<text x="${n(lx+legPad+legIconW+legPad*0.5)}" y="${n(iy+legLineH*0.65)}" font-size="${n(legFs*0.88)}" font-family="Arial, sans-serif" fill="#333">${e(item.name)}</text>`;
    });
  }

  // Штамп
  if (pl.showStamp) {
    const stFs = Math.max(6, Math.min(12, rh * 0.016));
    const stW = Math.min(rw * 0.65, 420);
    const stH = stFs * 14;
    const sx2 = rx + rw - stW + (pl.stampOffsetX ?? 0);
    const sy2 = ry + rh - stH + (pl.stampOffsetY ?? 0);
    const sw2 = Math.max(0.3, rw * 0.0015);
    const rowH = stH / 7;
    const cols = [0, 0.25, 0.5, 0.67, 0.83].map(t => stW * t);
    body += `<rect x="${n(sx2)}" y="${n(sy2)}" width="${n(stW)}" height="${n(stH)}" fill="white" stroke="#333" stroke-width="${n(Math.max(0.5, sw2*1.5))}"/>`;
    [1,2,3,4,5,6].forEach(i => {
      body += `<line x1="${n(sx2)}" y1="${n(sy2+rowH*i)}" x2="${n(sx2+stW)}" y2="${n(sy2+rowH*i)}" stroke="#333" stroke-width="${n(sw2)}"/>`;
    });
    cols.slice(1).forEach(x => {
      body += `<line x1="${n(sx2+x)}" y1="${n(sy2)}" x2="${n(sx2+x)}" y2="${n(sy2+rowH*5)}" stroke="#333" stroke-width="${n(sw2)}"/>`;
    });
    body += `<line x1="${n(sx2+stW*0.4)}" y1="${n(sy2+rowH*5)}" x2="${n(sx2+stW*0.4)}" y2="${n(sy2+stH)}" stroke="#333" stroke-width="${n(sw2)}"/>`;
    body += `<line x1="${n(sx2+stW*0.7)}" y1="${n(sy2+rowH*5)}" x2="${n(sx2+stW*0.7)}" y2="${n(sy2+stH)}" stroke="#333" stroke-width="${n(sw2)}"/>`;
    ["Изм.", "Кол.", "Лист", "№ dok.", "Подп.", "Дата"].forEach((t, i) => {
      const xs = [0, 0.25, 0.5, 0.67, 0.83, 1.0];
      const midX = i < 5 ? (xs[i] + xs[i+1]) / 2 : xs[5] - 0.085;
      body += `<text x="${n(sx2+stW*midX)}" y="${n(sy2+rowH*5.7)}" text-anchor="middle" font-size="${n(stFs*0.75)}" font-family="Arial, sans-serif" fill="#333">${e(t)}</text>`;
    });
    if (pl.developer) body += `<text x="${n(sx2+3)}" y="${n(sy2+rowH*3.6)}" font-size="${n(stFs*0.85)}" font-family="Arial, sans-serif" fill="#333">Разработал: ${e(pl.developer)}</text>`;
    if (pl.checker)   body += `<text x="${n(sx2+3)}" y="${n(sy2+rowH*4.6)}" font-size="${n(stFs*0.85)}" font-family="Arial, sans-serif" fill="#333">Нач. УПВ: ${e(pl.checker)}</text>`;
    body += `<text x="${n(sx2+stW*0.55)}" y="${n(sy2+rowH*5.8)}" text-anchor="middle" font-size="${n(stFs)}" font-family="Arial, sans-serif" fill="#111">${e(pl.projectName || "Название проекта")}</text>`;
    body += `<text x="${n(sx2+stW*0.55)}" y="${n(sy2+rowH*6.5)}" text-anchor="middle" font-size="${n(stFs*0.85)}" font-family="Arial, sans-serif" fill="#555">${e(pl.modeName || "Режим проветривания")}</text>`;
    body += `<text x="${n(sx2+stW*0.855)}" y="${n(sy2+rowH*6.5)}" text-anchor="middle" font-size="${n(stFs)}" font-family="Arial, sans-serif" font-weight="bold" fill="#111">${e(pl.orgName || "Организация")}</text>`;
    body += `<text x="${n(sx2+stW*0.855)}" y="${n(sy2+rowH*5.5)}" text-anchor="middle" font-size="${n(stFs*0.8)}" font-family="Arial, sans-serif" fill="#555">масштаб</text>`;
    body += `<text x="${n(sx2+stW*0.855)}" y="${n(sy2+rowH*6.2)}" text-anchor="middle" font-size="${n(stFs)}" font-family="Arial, sans-serif" font-weight="bold" fill="#111">${e(pl.scale || "1:2000")}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(totalW)}" height="${n(totalH)}">${body}</svg>`;
}
