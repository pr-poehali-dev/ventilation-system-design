// Утилита: рендер SVG-содержимого слоя печати (рамка, заголовок, УТВЕРЖДАЮ, УО, штамп).
// Используется и в TopoCanvas (рабочая область), и в PrintPreviewCanvas (предпросмотр).
// Принимает готовые экранные координаты рамки rx,ry,rw,rh.
import React from "react";
import type { HorizonPrintLayer } from "@/lib/topology";

export interface PrintLayerSvgOptions {
  pl: HorizonPrintLayer;
  rx: number;
  ry: number;
  rw: number;
  rh: number;
}

const LEGEND_ITEMS = [
  { name: "Позиция ПЛА",           color: "#333",    shape: "circle"   },
  { name: "Реверсивная позиция",    color: "#dc2626", shape: "circle2"  },
  { name: "Станция замера воздуха", color: "#dc2626", shape: "lines2"   },
  { name: "Струя входящая",         color: "#dc2626", shape: "arrow-r"  },
  { name: "Струя исходящая",        color: "#2196f3", shape: "arrow-l"  },
  { name: "Устье выработки",        color: "#333",    shape: "rect-x"   },
  { name: "Блоковый запасной выход",color: "#333",    shape: "blocks3"  },
  { name: "Аварийная сигнализация", color: "#333",    shape: "speaker"  },
  { name: "Запасной выход",         color: "#111",    shape: "blocks3b" },
  { name: "Телефон",                color: "#333",    shape: "circle-t" },
  { name: "Огнетушитель",           color: "#dc2626", shape: "circle-o" },
];

function renderIcon(shape: string, color: string, x: number, y: number, iw: number, ih: number, legFontSize: number) {
  const cx = x + iw / 2, cy = y + ih / 2;
  const sw = Math.max(0.5, legFontSize * 0.12);
  switch (shape) {
    case "circle":   return <circle cx={cx} cy={cy} r={ih * 0.38} fill="none" stroke={color} strokeWidth={sw * 1.5} />;
    case "circle2":  return <><circle cx={cx} cy={cy} r={ih * 0.38} fill="none" stroke={color} strokeWidth={sw * 2} /><circle cx={cx} cy={cy} r={ih * 0.19} fill="none" stroke={color} strokeWidth={sw} /></>;
    case "lines2":   return <><line x1={x+1} y1={cy-ih*0.1} x2={x+iw-1} y2={cy-ih*0.1} stroke={color} strokeWidth={sw*2.5}/><line x1={x+1} y1={cy+ih*0.1} x2={x+iw-1} y2={cy+ih*0.1} stroke={color} strokeWidth={sw*2.5}/></>;
    case "arrow-r":  return <><line x1={x+1} y1={cy} x2={x+iw-ih*0.25} y2={cy} stroke={color} strokeWidth={sw*2}/><polygon points={`${x+iw-ih*0.3},${cy-ih*0.28} ${x+iw},${cy} ${x+iw-ih*0.3},${cy+ih*0.28}`} fill={color}/></>;
    case "arrow-l":  return <><line x1={x+ih*0.25} y1={cy} x2={x+iw-1} y2={cy} stroke={color} strokeWidth={sw*2}/><polygon points={`${x+ih*0.3},${cy-ih*0.28} ${x},${cy} ${x+ih*0.3},${cy+ih*0.28}`} fill={color}/></>;
    case "rect-x":   return <><rect x={cx-ih*0.3} y={cy-ih*0.38} width={ih*0.6} height={ih*0.76} fill="none" stroke={color} strokeWidth={sw}/><line x1={cx-ih*0.3} y1={cy-ih*0.38} x2={cx+ih*0.3} y2={cy+ih*0.38} stroke={color} strokeWidth={sw*0.7}/><line x1={cx+ih*0.3} y1={cy-ih*0.38} x2={cx-ih*0.3} y2={cy+ih*0.38} stroke={color} strokeWidth={sw*0.7}/></>;
    case "blocks3":  return <><rect x={x+1} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#222"/><rect x={x+iw*0.36} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#ffd600"/><rect x={x+iw*0.72} y={cy-ih*0.3} width={iw*0.26} height={ih*0.6} fill="#222"/></>;
    case "blocks3b": return <><rect x={x+1} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#111"/><rect x={x+iw*0.36} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#111"/><rect x={x+iw*0.72} y={cy-ih*0.3} width={iw*0.26} height={ih*0.6} fill="#111"/></>;
    case "speaker":  return <><polygon points={`${x+3},${cy-ih*0.22} ${cx-ih*0.08},${cy-ih*0.22} ${cx+ih*0.18},${cy-ih*0.42} ${cx+ih*0.18},${cy+ih*0.42} ${cx-ih*0.08},${cy+ih*0.22} ${x+3},${cy+ih*0.22}`} fill="none" stroke={color} strokeWidth={sw}/><path d={`M${cx+ih*0.18} ${cy-ih*0.12} Q${cx+ih*0.38} ${cy} ${cx+ih*0.18} ${cy+ih*0.12}`} fill="none" stroke={color} strokeWidth={sw}/></>;
    case "circle-t": return <><circle cx={cx} cy={cy} r={ih*0.38} fill="none" stroke={color} strokeWidth={sw}/><text x={cx} y={cy+legFontSize*0.35} textAnchor="middle" fontSize={legFontSize*0.85} fontWeight="bold" fill={color}>T</text></>;
    case "circle-o": return <><circle cx={cx} cy={cy} r={ih*0.38} fill="none" stroke={color} strokeWidth={sw}/><circle cx={cx} cy={cy} r={ih*0.19} fill="none" stroke={color} strokeWidth={sw}/></>;
    default: return null;
  }
}

export function renderPrintLayerSvgContent({ pl, rx, ry, rw, rh }: PrintLayerSvgOptions): React.ReactNode {
  const inset = Math.max(4, Math.min(rw, rh) * 0.015);
  const titleFontSize = Math.max(9, Math.min(18, rh * 0.03));

  // ── Блок УТВЕРЖДАЮ ──────────────────────────────────────────────────────
  const approverBlock = pl.showApprover ? (() => {
    const apW = Math.min(rw * 0.28, 220);
    const apX = rx + rw - inset - apW;
    const apY = ry + inset + 2;
    const apFs = Math.max(7, Math.min(13, rh * 0.018));
    const lw2 = Math.max(0.4, apFs * 0.06);
    const apCx = apX + apW / 2;
    let ay = apY + apFs * 1.4;
    const lineY = (dy: number) => { ay += dy; return ay; };
    return (
      <g key="approver-block">
        <rect x={apX} y={apY} width={apW} height={apFs * 10} fill="white" style={{ pointerEvents: "none" }} />
        <text x={apCx} y={lineY(0)} textAnchor="middle" fontSize={apFs * 1.1} fontWeight="normal" fontFamily="Arial, sans-serif" fill="#111">УТВЕРЖДАЮ</text>
        <text x={apCx} y={lineY(apFs * 1.6)} textAnchor="middle" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111">{pl.approverTitle || "Должность"}</text>
        <text x={apCx} y={lineY(apFs * 1.4)} textAnchor="middle" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111">{pl.orgName || "Организация"}</text>
        <line x1={apX + apFs} y1={lineY(apFs * 1.6)} x2={apX + apW - apFs} y2={ay} stroke="#111" strokeWidth={lw2} />
        <text x={apX + apW - apFs * 0.5} y={lineY(apFs * 1.2)} textAnchor="end" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#1a44b8">{pl.approverName || "И.О. Фамилия"}</text>
        <line x1={apX} y1={lineY(apFs * 1.4)} x2={apX + apW} y2={ay} stroke="#111" strokeWidth={lw2} />
        <text x={apX + apFs * 0.3} y={lineY(apFs * 1.2)} textAnchor="start" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111">«{pl.day || "__"}»</text>
        <text x={apX + apFs * 3.2} y={ay} textAnchor="start" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111">{pl.month || "__________"}</text>
        <text x={apX + apW - apFs * 0.3} y={ay} textAnchor="end" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111">{pl.year || String(new Date().getFullYear())} г.</text>
      </g>
    );
  })() : null;

  // ── Блок УО ─────────────────────────────────────────────────────────────
  const legendBlock = pl.showLegend ? (() => {
    const legW = Math.max(100, rw * 0.22);
    const legFontSize = Math.max(7, Math.min(13, rh * 0.018));
    const legLineH = legFontSize * 1.6;
    const legIconW = legFontSize * 2.2;
    const legPad = legFontSize * 0.6;
    const legH = legPad * 2 + LEGEND_ITEMS.length * legLineH + legFontSize * 1.5;
    const lx = rx + (pl.legendOffsetX ?? 0);
    const ly = ry + rh - legH + (pl.legendOffsetY ?? 0);
    return (
      <g key="legend-block">
        <rect x={lx} y={ly} width={legW} height={legH} fill="white" stroke="#333" strokeWidth={Math.max(0.5, rw * 0.002)} />
        <text x={lx + legPad} y={ly + legPad + legFontSize} fontSize={legFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">Условные обозначения</text>
        {LEGEND_ITEMS.map((item, idx) => {
          const iy = ly + legPad + legFontSize * 1.5 + idx * legLineH;
          const ih = legLineH * 0.8;
          return (
            <g key={idx}>
              {renderIcon(item.shape, item.color, lx + legPad, iy + (legLineH - ih) / 2, legIconW, ih, legFontSize)}
              <text x={lx + legPad + legIconW + legPad * 0.5} y={iy + legLineH * 0.65}
                fontSize={legFontSize * 0.88} fontFamily="Arial, sans-serif" fill="#333">
                {item.name}
              </text>
            </g>
          );
        })}
      </g>
    );
  })() : null;

  // ── Штамп ───────────────────────────────────────────────────────────────
  const stampBlock = pl.showStamp ? (() => {
    const stFontSize = Math.max(6, Math.min(12, rh * 0.016));
    const stW = Math.min(rw * 0.65, 420);
    const stH = stFontSize * 14;
    const sx2 = rx + rw - stW + (pl.stampOffsetX ?? 0);
    const sy2 = ry + rh - stH + (pl.stampOffsetY ?? 0);
    const sw2 = Math.max(0.3, rw * 0.0015);
    const rowH = stH / 7;
    const col = [0, 0.25, 0.5, 0.67, 0.83].map(t => stW * t);
    return (
      <g key="stamp-block">
        <rect x={sx2} y={sy2} width={stW} height={stH} fill="white" stroke="#333" strokeWidth={Math.max(0.5, sw2 * 1.5)} />
        {[1,2,3,4,5,6].map(i => <line key={i} x1={sx2} y1={sy2+rowH*i} x2={sx2+stW} y2={sy2+rowH*i} stroke="#333" strokeWidth={sw2} />)}
        {col.slice(1).map((x, i) => <line key={i} x1={sx2+x} y1={sy2} x2={sx2+x} y2={sy2+rowH*5} stroke="#333" strokeWidth={sw2} />)}
        <line x1={sx2+stW*0.4} y1={sy2+rowH*5} x2={sx2+stW*0.4} y2={sy2+stH} stroke="#333" strokeWidth={sw2} />
        <line x1={sx2+stW*0.7} y1={sy2+rowH*5} x2={sx2+stW*0.7} y2={sy2+stH} stroke="#333" strokeWidth={sw2} />
        {["Изм.", "Кол.", "Лист", "№ dok.", "Подп.", "Дата"].map((t, i) => {
          const xs = [0, 0.25, 0.5, 0.67, 0.83, 1.0];
          const midX = i < 5 ? (xs[i] + xs[i+1]) / 2 : xs[5] - 0.085;
          return <text key={i} x={sx2+stW*midX} y={sy2+rowH*5.7} textAnchor="middle" fontSize={stFontSize*0.75} fontFamily="Arial, sans-serif" fill="#333">{t}</text>;
        })}
        {pl.developer && <text x={sx2+3} y={sy2+rowH*3.6} fontSize={stFontSize*0.85} fontFamily="Arial, sans-serif" fill="#333">Разработал: {pl.developer}</text>}
        {pl.checker && <text x={sx2+3} y={sy2+rowH*4.6} fontSize={stFontSize*0.85} fontFamily="Arial, sans-serif" fill="#333">Нач. УПВ: {pl.checker}</text>}
        <text x={sx2+stW*0.55} y={sy2+rowH*5.8} textAnchor="middle" fontSize={stFontSize} fontFamily="Arial, sans-serif" fill="#111">{pl.projectName || "Название проекта"}</text>
        <text x={sx2+stW*0.55} y={sy2+rowH*6.5} textAnchor="middle" fontSize={stFontSize*0.85} fontFamily="Arial, sans-serif" fill="#555">{pl.modeName || "Режим проветривания"}</text>
        <text x={sx2+stW*0.855} y={sy2+rowH*6.5} textAnchor="middle" fontSize={stFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">{pl.orgName || "Организация"}</text>
        <text x={sx2+stW*0.855} y={sy2+rowH*5.5} textAnchor="middle" fontSize={stFontSize*0.8} fontFamily="Arial, sans-serif" fill="#555">масштаб</text>
        <text x={sx2+stW*0.855} y={sy2+rowH*6.2} textAnchor="middle" fontSize={stFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">{pl.scale || "1:2000"}</text>
      </g>
    );
  })() : null;

  return (
    <>
      {/* Белая подложка */}
      <rect x={rx} y={ry} width={rw} height={rh} fill="white" />
      {/* Внешняя рамка */}
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