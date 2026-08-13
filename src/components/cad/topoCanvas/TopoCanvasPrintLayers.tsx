import {
  type TopoNode, type TopoBranch, type ProjOptions, type WorkPlane,
  type PaperFormat,
  PAPER_SIZES_MM, OVERVIEW_HORIZON_ID,
  project3D, unproject2D, unprojectToPlane,
} from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, FAN_SVG_STATION, FAN_SVG_PROPELLER } from "@/lib/schemaSymbols";
import {
  STAMP_W_MM, STAMP_H_MM, buildStampCells, buildStampGridLines, getStampFieldValue,
  type StampFieldKey,
} from "@/lib/stampTemplate";
import {
  buildApproverElements, buildApproverLines, getApproverFieldValue, computeApproverBox,
  type ApproverFieldKey,
} from "@/lib/approverTemplate";
import { type Props, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Слой ПЕЧАТИ и вспомогательная геометрия холста (вынесено из TopoCanvas.tsx).
// Логика и разметка перенесены 1:1, без изменений поведения:
//   renderGroundGrid  — сетка плоскости z=0 и тройка осей (только в 3D)
//   renderWorkPlane   — полупрозрачный квадрат активной рабочей плоскости
//   unprojFrame       — единая распроекция экран→мир для рамки слоя печати
//   renderPrintLayers — рамка листа, заголовок, штамп, блок «УТВЕРЖДАЮ», легенда
// ─────────────────────────────────────────────────────────────────────────────

export interface PrintLayersDeps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons?: Props["horizons"];
  visibleBranches: TopoBranch[];
  projNodes: ProjNodeEntry[];
  proj: ProjOptions;
  is3D: boolean;
  effPlane: WorkPlane;
  xyScale: number;
  zScale: number;
  schemaSymbols?: Props["schemaSymbols"];
  editingPrintLayerId?: string | null;
  onPrintLayerBoundsChange?: Props["onPrintLayerBoundsChange"];
  onPrintLayerChange?: Props["onPrintLayerChange"];
  editingTitleId: string | null;
  setEditingTitleId: (v: string | null) => void;
  editingTitleDraft: string;
  setEditingTitleDraft: (v: string) => void;
  editingStampCell: { horizonId: string; field: string; draft: string } | null;
  setEditingStampCell: React.Dispatch<React.SetStateAction<{ horizonId: string; field: string; draft: string } | null>>;
  editingApproverCell: { horizonId: string; field: string; draft: string } | null;
  setEditingApproverCell: React.Dispatch<React.SetStateAction<{ horizonId: string; field: string; draft: string } | null>>;
  setDraggingPrintCorner: (v: { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: { x1: number; y1: number; x2: number; y2: number } } | null) => void;
  draggingPrintTitle: { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null;
  setDraggingPrintTitle: (v: { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null) => void;
}

/**
 * Возвращает функции отрисовки сетки, рабочей плоскости и слоёв печати.
 * Вызывается из TopoCanvas — там же, где раньше жили эти функции.
 */
export function usePrintLayers(deps: PrintLayersDeps) {
  const {
    nodes, branches, horizons, visibleBranches, projNodes, proj, is3D, effPlane,
    xyScale, zScale, schemaSymbols, editingPrintLayerId,
    onPrintLayerBoundsChange, onPrintLayerChange,
    editingTitleId, setEditingTitleId, editingTitleDraft, setEditingTitleDraft,
    editingStampCell, setEditingStampCell,
    editingApproverCell, setEditingApproverCell,
    setDraggingPrintCorner, draggingPrintTitle, setDraggingPrintTitle,
  } = deps;

  // Сетка плоскости (план z=0)
  const renderGroundGrid = () => {
    if (!is3D) return null;
    const step = 500;          // м
    const range = 3000;        // от -range до +range
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (let x = -range; x <= range; x += step) {
      const a = project3D({ x, y: -range, z: 0 }, proj);
      const b = project3D({ x, y: range, z: 0 }, proj);
      lines.push({ x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy, key: `gx${x}` });
    }
    for (let y = -range; y <= range; y += step) {
      const a = project3D({ x: -range, y, z: 0 }, proj);
      const b = project3D({ x: range, y, z: 0 }, proj);
      lines.push({ x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy, key: `gy${y}` });
    }
    // Тройка осей в начале
    const O = project3D({ x: 0, y: 0, z: 0 }, proj);
    const Xa = project3D({ x: 500, y: 0, z: 0 }, proj);
    const Ya = project3D({ x: 0, y: 500, z: 0 }, proj);
    const Za = project3D({ x: 0, y: 0, z: 500 }, proj);
    return (
      <g>
        {lines.map((l) => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="#d4d4d4" strokeWidth="0.6" opacity="0.7" />
        ))}
        <line x1={O.sx} y1={O.sy} x2={Xa.sx} y2={Xa.sy} stroke="#ef4444" strokeWidth="2" />
        <line x1={O.sx} y1={O.sy} x2={Ya.sx} y2={Ya.sy} stroke="#22c55e" strokeWidth="2" />
        <line x1={O.sx} y1={O.sy} x2={Za.sx} y2={Za.sy} stroke="#3b82f6" strokeWidth="2" />
        <text x={Xa.sx + 4} y={Xa.sy} fontSize="10" fill="#ef4444">X</text>
        <text x={Ya.sx + 4} y={Ya.sy} fontSize="10" fill="#22c55e">Y</text>
        <text x={Za.sx + 4} y={Za.sy} fontSize="10" fill="#3b82f6">Z</text>
      </g>
    );
  };

  // Визуализация активной рабочей плоскости (полупрозрачный квадрат)
  const renderWorkPlane = () => {
    if (!is3D) return null;
    const r = 1500;     // полу-сторона плоскости (м)
    let corners: Array<{ x: number; y: number; z: number }>;
    let color: string;
    if (effPlane.axis === "z") {
      const z = effPlane.value;
      corners = [{ x: -r, y: -r, z }, { x: r, y: -r, z }, { x: r, y: r, z }, { x: -r, y: r, z }];
      color = "#fbbf24";
    } else if (effPlane.axis === "y") {
      const y = effPlane.value;
      corners = [{ x: -r, y, z: -r }, { x: r, y, z: -r }, { x: r, y, z: r }, { x: -r, y, z: r }];
      color = "#a78bfa";
    } else {
      const x = effPlane.value;
      corners = [{ x, y: -r, z: -r }, { x, y: r, z: -r }, { x, y: r, z: r }, { x, y: -r, z: r }];
      color = "#60a5fa";
    }
    const pts = corners.map((c) => project3D(c, proj));
    const polyPts = pts.map((p) => `${p.sx},${p.sy}`).join(" ");
    return (
      <g>
        <polygon points={polyPts} fill={color} fillOpacity="0.08" stroke={color} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="6 4" />
      </g>
    );
  };

  // Вертикальные направляющие — убраны (создавали сотни пунктирных линий при 3D-виде CSV-схем)

  // ─── Единая распроекция экран→мир для рамки слоя печати ───────────────────
  // Рамка живёт в плоскости z=zLevel. КРИТИЧНО: точка клика и углы рамки должны
  // распроецироваться ОДНИМ И ТЕМ ЖЕ способом, иначе в наклонных видах (ИЗО и др.)
  // возникает рассинхрон и рамка резко увеличивается/прыгает.
  // Для видов, где z-плоскость вырождена (Фронт/Профиль, elevation≈0),
  // unprojectToPlane вернёт null → откатываемся на плоскую unproject2D для ОБЕИХ
  // сторон, сохраняя консистентность.
  const unprojFrame = (sx: number, sy: number, zLevel: number): { x: number; y: number } | null => {
    if (is3D) {
      const wp = unprojectToPlane(sx, sy, proj, { axis: "z", value: zLevel });
      if (wp) return { x: wp.x, y: wp.y };
      // z-плоскость вырождена (elevation≈0) — плоский фолбэк
      const flat = unproject2D(sx, sy, proj, zLevel);
      return { x: flat.x, y: flat.y };
    }
    const flat = unproject2D(sx, sy, proj, zLevel);
    return { x: flat.x, y: flat.y };
  };

  // ─── Рендер шаблонов слоя печати горизонтов ──────────────────────────────
  const renderPrintLayers = () => (horizons ?? []).map((h) => {
    if (!h.printLayer?.visible) return null;
    const pl = h.printLayer;
    const fmt = (pl.paperFormat ?? "A3") as PaperFormat;
    const ori = pl.orientation ?? "landscape";
    const mm = PAPER_SIZES_MM[fmt];
    const aspect = ori === "landscape" ? mm.w / mm.h : mm.h / mm.w;
    const isEditing = editingPrintLayerId === h.id;

    // ── Вычисляем экранный bbox рамки ──────────────────────────────────────
    let rx = 0, ry = 0, rw = 0, rh = 0;
    const wb: { x1: number; y1: number; x2: number; y2: number } = { x1: 0, y1: 0, x2: 0, y2: 0 };
    const pTL = { sx: 0, sy: 0 }, pTR = { sx: 0, sy: 0 }, pBL = { sx: 0, sy: 0 }, pBR = { sx: 0, sy: 0 };
    let skipWorldProject = false; // флаг: экранные coords уже вычислены, пропустить общий блок

    if (h.id === OVERVIEW_HORIZON_ID && !pl.bounds) {
      // Авто-bbox OVERVIEW: проецируем ВИДИМЫЕ ветви с реальными X/Y/Z в экранные координаты.
      // Используем проецированные узлы (projNodes) — они уже готовы с текущей проекцией.
      // Это корректно работает при ЛЮБОЙ проекции (план, ИЗО, фронт, профиль).
      if (projNodes.length === 0) return null;
      // Берём только узлы реально используемых (видимых) ветвей
      const visibleNodeIds = new Set<string>();
      visibleBranches.forEach(b => { visibleNodeIds.add(b.fromId); visibleNodeIds.add(b.toId); });
      const relevantProj = projNodes.filter(pn => visibleNodeIds.has(pn.node.id));
      if (relevantProj.length === 0) return null;
      let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
      relevantProj.forEach(pn => {
        if (pn.sx < minSx) minSx = pn.sx; if (pn.sx > maxSx) maxSx = pn.sx;
        if (pn.sy < minSy) minSy = pn.sy; if (pn.sy > maxSy) maxSy = pn.sy;
      });
      const sw = maxSx - minSx, sh = maxSy - minSy;
      // Отступ: 8% от размера схемы + фиксированный минимум
      const pad = Math.max(sw, sh) * 0.08 + 15;
      const scx = (minSx + maxSx) / 2;
      const scy_schema = (minSy + maxSy) / 2;
      // Размер рамки охватывает схему с отступами, соблюдая пропорции бумаги
      const fitSw = sw + pad * 2, fitSh = sh + pad * 2;
      let rsw = fitSw, rsh = fitSw / aspect;
      if (rsh < fitSh) { rsh = fitSh; rsw = fitSh * aspect; }
      // Рамка всегда охватывает схему со всех сторон (и в плане, и в 3D)
      const scy = scy_schema;
      rsw = Math.max(rsw, sw + pad * 2);
      rsh = rsw / aspect;
      if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
      // Заполняем экранные координаты углов напрямую (без проекции через wb)
      Object.assign(pTL, { sx: scx - rsw / 2, sy: scy - rsh / 2 });
      Object.assign(pTR, { sx: scx + rsw / 2, sy: scy - rsh / 2 });
      Object.assign(pBL, { sx: scx - rsw / 2, sy: scy + rsh / 2 });
      Object.assign(pBR, { sx: scx + rsw / 2, sy: scy + rsh / 2 });
      rx = scx - rsw / 2;
      ry = scy - rsh / 2;
      rw = Math.max(rsw, 40);
      rh = Math.max(rsh, 40);
      skipWorldProject = true;
    } else if (pl.bounds) {
      // Ручные bounds (в т.ч. OVERVIEW) хранятся в мировых X/Y и проецируются
      // тем же общим путём, что и запись при drag/resize (через project3D/unproject2D).
      // Это устраняет рассинхрон «сохранили абсолют — прочитали как смещение»,
      // из-за которого рамка убегала из координат схемы.
      Object.assign(wb, pl.bounds);
    } else {
      // Авто-bbox обычного горизонта — по узлам этого горизонта
      const hNodeIds = new Set<string>();
      branches.forEach(b => { if (b.horizonId === h.id) { hNodeIds.add(b.fromId); hNodeIds.add(b.toId); } });
      const hNodes = nodes.filter(n => hNodeIds.has(n.id));
      if (hNodes.length === 0) return null;
      const wxs = hNodes.map(n => n.x);
      const wys = hNodes.map(n => n.y);
      const wmx = Math.min(...wxs), wMx = Math.max(...wxs);
      const wmy = Math.min(...wys), wMy = Math.max(...wys);
      const ww = wMx - wmx, wh = wMy - wmy;
      const pad = Math.max(ww, wh) * 0.12 + 10;
      const cx = (wmx + wMx) / 2, cy = (wmy + wMy) / 2;
      const fitW = ww + pad * 2, fitH = wh + pad * 2;
      let rw2 = fitW, rh2 = fitW / aspect;
      if (rh2 < fitH) { rh2 = fitH; rw2 = fitH * aspect; }
      Object.assign(wb, { x1: cx - rw2 / 2, y1: cy - rh2 / 2, x2: cx + rw2 / 2, y2: cy + rh2 / 2 });
    }
    // ── Общий путь: проецируем wb (мировые) → экранные координаты ──────────
    // Пропускается для OVERVIEW без ручных bounds (skipWorldProject = true)
    if (!skipWorldProject) {
      const xy = xyScale ?? 1;
      const z4proj = h.z * (zScale ?? 1);
      const _pTL = project3D({ x: wb.x1 * xy, y: wb.y2 * xy, z: z4proj }, proj);
      const _pTR = project3D({ x: wb.x2 * xy, y: wb.y2 * xy, z: z4proj }, proj);
      const _pBL = project3D({ x: wb.x1 * xy, y: wb.y1 * xy, z: z4proj }, proj);
      const _pBR = project3D({ x: wb.x2 * xy, y: wb.y1 * xy, z: z4proj }, proj);
      Object.assign(pTL, _pTL); Object.assign(pTR, _pTR);
      Object.assign(pBL, _pBL); Object.assign(pBR, _pBR);
      rx = Math.min(pTL.sx, pBL.sx);
      ry = Math.min(pTL.sy, pTR.sy);
      rw = Math.max(pTR.sx, pBR.sx) - rx;
      rh = Math.max(pBL.sy, pBR.sy) - ry;
      rw = Math.max(rw, 40); rh = Math.max(rh, 40);
    }
    // Единый масштаб «пикселей на 1 мм листа» — фиксирует размеры текста
    // пропорционально формату листа (A3/A4…), а не экранной высоте рамки rh.
    // rw соответствует ширине листа в мм → шрифт N*pxPerMm мм стабилен как на печати.
    const mmW = ori === "landscape" ? Math.max(mm.w, mm.h) : Math.min(mm.w, mm.h);
    const pxPerMm = rw / mmW;
    const inset = Math.max(4, Math.min(rw, rh) * 0.015);
    // Заголовок: фиксированные ~5.5 мм листа (пропорционально формату)
    const titleFontSize = Math.max(6, pxPerMm * 5.5);

    return (
      <g key={`printlayer-${h.id}`} data-printlayer={h.id}>
        {/* Белая подложка */}
        <rect x={rx} y={ry} width={rw} height={rh} fill="white"
          style={{ cursor: isEditing ? "move" : "default" }}
          onMouseDown={isEditing ? (e) => {
            e.stopPropagation();
            e.preventDefault();
            const svgEl = (e.currentTarget as SVGElement).ownerSVGElement;
            if (!svgEl) return;
            const svgRect = svgEl.getBoundingClientRect();
            const csx = e.clientX - svgRect.left;
            const csy = e.clientY - svgRect.top;
            const wp = unprojFrame(csx, csy, h.z);
            if (!wp) return;
            const _xys = xyScale ?? 1;
            // activeBounds — углы рамки распроецируем ТЕМ ЖЕ unprojFrame, что и точку,
            // иначе рассинхрон в наклонных видах даёт скачок размера рамки.
            const activeBounds = (wb.x1 === 0 && wb.x2 === 0)
              ? (() => {
                  const wBL = unprojFrame(rx,      ry + rh, h.z);
                  const wTR = unprojFrame(rx + rw, ry,      h.z);
                  if (!wBL || !wTR) return wb;
                  return { x1: wBL.x / _xys, y1: wBL.y / _xys, x2: wTR.x / _xys, y2: wTR.y / _xys };
                })()
              : wb;
            // startWx/startWy тоже делим на xyScale чтобы быть в "чистых" мировых
            const startWx = wp.x / _xys;
            const startWy = wp.y / _xys;
            const startState = { horizonId: h.id, corner: "move" as const, startWx, startWy, startBounds: activeBounds };
            setDraggingPrintCorner(startState);
            const onMove = (me: MouseEvent) => {
              const sx2 = me.clientX - svgRect.left;
              const sy2 = me.clientY - svgRect.top;
              const wp2 = unprojFrame(sx2, sy2, h.z);
              if (!wp2) return;
              const dx = wp2.x / _xys - startState.startWx;
              const dy = wp2.y / _xys - startState.startWy;
              const sb = startState.startBounds;
              onPrintLayerBoundsChange?.(h.id, { x1: sb.x1 + dx, y1: sb.y1 + dy, x2: sb.x2 + dx, y2: sb.y2 + dy });
            };
            const onUp = () => {
              setDraggingPrintCorner(null);
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          } : undefined}
        />
        {/* Внешняя рамка */}
        <rect x={rx} y={ry} width={rw} height={rh}
          fill="none" stroke="#1a1a1a" strokeWidth={2}
          style={{ pointerEvents: "none" }} />
        {/* Внутренняя рамка */}
        <rect x={rx + inset} y={ry + inset}
          width={rw - inset * 2} height={rh - inset * 2}
          fill="none" stroke="#1a1a1a" strokeWidth={0.8}
          style={{ pointerEvents: "none" }} />
        {/* Заголовок — редактируемый и перетаскиваемый */}
        {(() => {
          const titleX = rx + rw / 2 + (pl.titleOffsetX ?? 0) * pxPerMm;
          const titleY = ry + inset + titleFontSize + 4 + (pl.titleOffsetY ?? 0) * pxPerMm;
          const canEdit = !!onPrintLayerChange;
          const isEditingTitle = editingTitleId === h.id;
          if (isEditingTitle) {
            return (
              <foreignObject x={titleX - rw * 0.4} y={titleY - titleFontSize - 2} width={rw * 0.8} height={titleFontSize * 3}>
                <input
                  // @ts-expect-error xmlns
                  xmlns="http://www.w3.org/1999/xhtml"
                  autoFocus
                  value={editingTitleDraft}
                  onChange={e => setEditingTitleDraft(e.target.value)}
                  onBlur={() => {
                    onPrintLayerChange?.(h.id, { title: editingTitleDraft });
                    setEditingTitleId(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") { onPrintLayerChange?.(h.id, { title: editingTitleDraft }); setEditingTitleId(null); }
                    if (e.key === "Escape") setEditingTitleId(null);
                    e.stopPropagation();
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  style={{
                    width: "100%", textAlign: "center",
                    fontSize: titleFontSize, fontFamily: "Arial, sans-serif", fontWeight: "bold",
                    border: "1.5px solid #7c3aed", borderRadius: 2, outline: "none",
                    background: "rgba(255,253,230,0.97)", padding: "1px 4px", boxSizing: "border-box" as const,
                  }}
                />
              </foreignObject>
            );
          }
          return pl.title ? (
            <text
              x={titleX} y={titleY}
              textAnchor="middle" dominantBaseline="hanging"
              fontSize={titleFontSize}
              fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111"
              style={{ cursor: canEdit ? (draggingPrintTitle?.horizonId === h.id ? "grabbing" : "grab") : "default", userSelect: "none" }}
              onDoubleClick={canEdit ? (e) => {
                e.stopPropagation();
                setEditingTitleDraft(pl.title);
                setEditingTitleId(h.id);
              } : undefined}
              onMouseDown={canEdit ? (e) => {
                if (e.detail >= 2) return;
                e.stopPropagation();
                e.preventDefault();
                const startOffX = pl.titleOffsetX ?? 0;
                const startOffY = pl.titleOffsetY ?? 0;
                const startSx = e.clientX;
                const startSy = e.clientY;
                setDraggingPrintTitle({ horizonId: h.id, startSx, startSy, startOffX, startOffY, pxPerMm });
                const pxmm = pxPerMm || 1;
                const onMove = (me: MouseEvent) => {
                  onPrintLayerChange?.(h.id, {
                    titleOffsetX: startOffX + (me.clientX - startSx) / pxmm,
                    titleOffsetY: startOffY + (me.clientY - startSy) / pxmm,
                  });
                };
                const onUp = () => {
                  setDraggingPrintTitle(null);
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              } : undefined}
            >
              {pl.title}
            </text>
          ) : null;
        })()}
        {/* Блок УТВЕРЖДАЮ — правый верхний угол рамки */}
        {pl.showApprover && (() => {
          // Фиксированный размер блока по формату листа (как штамп)
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
          const canEdit = !!onPrintLayerChange;
          const yearNow = String(new Date().getFullYear());
          const els = buildApproverElements();
          const lines = buildApproverLines();

          const startEdit = (field: ApproverFieldKey) => {
            setEditingApproverCell({ horizonId: h.id, field, draft: getApproverFieldValue(pl, field) });
          };
          const commitEdit = () => {
            if (editingApproverCell && editingApproverCell.horizonId === h.id) {
              onPrintLayerChange?.(h.id, { [editingApproverCell.field]: editingApproverCell.draft } as Partial<import("@/lib/topology").HorizonPrintLayer>);
            }
            setEditingApproverCell(null);
          };

          return (
            <g key="approver-block">
              <rect x={ax} y={ay} width={apW} height={apH} fill="white" style={{ pointerEvents: "none" }} />
              {lines.map((ln, i) => (
                <line key={`al-${i}`} x1={mx(ln.x1)} y1={my(ln.y1)} x2={mx(ln.x2)} y2={my(ln.y2)} stroke="#111" strokeWidth={lw2} style={{ pointerEvents: "none" }} />
              ))}
              {els.map((el, i) => {
                const fs = baseFs * (el.fontScale ?? 1);
                const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
                const color = el.color ?? "#111";
                // Статичная надпись
                if (el.label && !el.field) {
                  return (
                    <text key={`lbl-${i}`} x={mx(el.x)} y={my(el.y)} textAnchor={anchor} dominantBaseline="central"
                      fontSize={fs} fontFamily="Arial, sans-serif" fill={color} style={{ pointerEvents: "none", userSelect: "none" }}>
                      {el.label}
                    </text>
                  );
                }
                // Редактируемое поле
                if (el.field) {
                  const isEd = editingApproverCell?.horizonId === h.id && editingApproverCell?.field === el.field;
                  const val = getApproverFieldValue(pl, el.field);
                  if (isEd && canEdit) {
                    const cellX = mx(el.cellX ?? 0);
                    const cellW = (el.cellW ?? (14)) * pxPerMm;
                    return (
                      <foreignObject key={`ed-${i}`} x={cellX} y={my(el.y) - fs} width={Math.max(12, cellW)} height={fs * 2}>
                        <input
                          // @ts-expect-error xmlns
                          xmlns="http://www.w3.org/1999/xhtml"
                          autoFocus
                          value={editingApproverCell.draft}
                          onChange={e => setEditingApproverCell(s => s ? { ...s, draft: e.target.value } : s)}
                          onBlur={commitEdit}
                          onKeyDown={e => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingApproverCell(null);
                            e.stopPropagation();
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          style={{
                            width: "100%", height: "100%",
                            textAlign: el.align === "left" ? "left" : el.align === "right" ? "right" : "center",
                            fontSize: fs, fontFamily: "Arial, sans-serif",
                            border: "1.5px solid #7c3aed", borderRadius: 2, outline: "none",
                            background: "rgba(255,253,230,0.97)", padding: "0 2px",
                            boxSizing: "border-box" as const, color,
                          }}
                        />
                      </foreignObject>
                    );
                  }
                  // Отображение значения (с плейсхолдером и суффиксом «г.» для года)
                  let shown = val || (canEdit ? (el.placeholder || "") : "");
                  if (el.field === "year") shown = (val || yearNow) + " г.";
                  return (
                    <text key={`val-${i}`} x={mx(el.x)} y={my(el.y)} textAnchor={anchor} dominantBaseline="central"
                      fontSize={fs} fontFamily="Arial, sans-serif" fill={val ? color : "#bbb"}
                      style={{ cursor: canEdit ? "text" : "default", userSelect: "none" }}
                      onDoubleClick={canEdit ? (e) => { e.stopPropagation(); startEdit(el.field!); } : undefined}>
                      {shown}
                    </text>
                  );
                }
                return null;
              })}
            </g>
          );
        })()}

        {/* Цветная рамка-подсветка в режиме редактирования */}
        {isEditing && (
          <rect x={rx - 1} y={ry - 1} width={rw + 2} height={rh + 2}
            fill="none" stroke="#7c3aed" strokeWidth={2} strokeDasharray="8 4"
            style={{ pointerEvents: "none" }} />
        )}
        {/* Ручки угловые */}
        {isEditing && ([
          { key: "tl" as const, sx: pTL.sx, sy: pTL.sy, cur: "nw-resize" },
          { key: "tr" as const, sx: pTR.sx, sy: pTR.sy, cur: "ne-resize" },
          { key: "bl" as const, sx: pBL.sx, sy: pBL.sy, cur: "sw-resize" },
          { key: "br" as const, sx: pBR.sx, sy: pBR.sy, cur: "se-resize" },
        ].map(c => (
          <g key={c.key} style={{ cursor: c.cur }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const svgEl = (e.currentTarget as SVGElement).ownerSVGElement;
              if (!svgEl) return;
              const svgRect = svgEl.getBoundingClientRect();
              const csx = e.clientX - svgRect.left;
              const csy = e.clientY - svgRect.top;
              const wp = unprojFrame(csx, csy, h.z);
              if (!wp) return;
              const _xys2 = xyScale ?? 1;
              // Углы рамки распроецируем ТЕМ ЖЕ unprojFrame, что и точку (без рассинхрона).
              const activeBounds = (wb.x1 === 0 && wb.x2 === 0)
                ? (() => {
                    const wBL = unprojFrame(rx,      ry + rh, h.z);
                    const wTR = unprojFrame(rx + rw, ry,      h.z);
                    if (!wBL || !wTR) return wb;
                    return { x1: wBL.x / _xys2, y1: wBL.y / _xys2, x2: wTR.x / _xys2, y2: wTR.y / _xys2 };
                  })()
                : wb;
              const startState = { horizonId: h.id, corner: c.key, startWx: wp.x / _xys2, startWy: wp.y / _xys2, startBounds: activeBounds };
              setDraggingPrintCorner(startState);
              const fmt2 = h.printLayer!.paperFormat ?? "A3";
              const ori2 = h.printLayer!.orientation ?? "landscape";
              const mm2 = PAPER_SIZES_MM[fmt2 as PaperFormat];
              const aspect2 = ori2 === "landscape" ? mm2.w / mm2.h : mm2.h / mm2.w;
              const onMove = (me: MouseEvent) => {
                const sx2 = me.clientX - svgRect.left;
                const sy2 = me.clientY - svgRect.top;
                const wp2 = unprojFrame(sx2, sy2, h.z);
                if (!wp2) return;
                const sb = startState.startBounds;
                const b2 = { ...sb };
                const wx2 = wp2.x / _xys2;
                switch (startState.corner) {
                  case "br": { const w2 = wx2 - sb.x1; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x2 = sb.x1+nw2; b2.y1 = sb.y2-nw2/aspect2; break; }
                  case "bl": { const w2 = sb.x2 - wx2; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x1 = sb.x2-nw2; b2.y1 = sb.y2-nw2/aspect2; break; }
                  case "tr": { const w2 = wx2 - sb.x1; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x2 = sb.x1+nw2; b2.y2 = sb.y1+nw2/aspect2; break; }
                  case "tl": { const w2 = sb.x2 - wx2; const nw2 = Math.max(Math.abs(sb.x2-sb.x1)*0.05, w2); b2.x1 = sb.x2-nw2; b2.y2 = sb.y1+nw2/aspect2; break; }
                }
                onPrintLayerBoundsChange?.(h.id, b2);
              };
              const onUp = () => {
                setDraggingPrintCorner(null);
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }}>
            <circle cx={c.sx} cy={c.sy} r={8} fill="white" stroke="#7c3aed" strokeWidth={2} />
            <circle cx={c.sx} cy={c.sy} r={3} fill="#7c3aed" />
          </g>
        )))}

        {/* ── Блок УО на схеме — из реально установленных символов ──────────── */}
        {pl.showLegend && schemaSymbols && schemaSymbols.length > 0 && (() => {
          // Собираем уникальные типы УО
          const usedTypeIds = [...new Set(schemaSymbols.map(s => s.typeId))];
          const legendItems: { name: string; svgContent: string; isBulkhead: boolean; tid: string }[] = [];
          for (const tid of usedTypeIds) {
            const lt = LEGEND_TYPES.find(l => l.id === tid);
            const isBk = BULKHEAD_SYMBOL_IDS.has(tid);
            if (tid === "fan") {
              // Вентилятор: разные УО по назначению ветви (ГВУ/ВВУ — двойное кольцо, ВМП — пропеллер)
              const fanTypes = new Set(
                schemaSymbols.filter(s => s.typeId === "fan")
                  .map(s => branches.find(b => b.id === s.branchId)?.fanType ?? "ВМП")
              );
              if (fanTypes.has("ГВУ") || fanTypes.has("ВВУ"))
                legendItems.push({ name: "Вентиляторная установка (ГВУ/ВВУ)", svgContent: FAN_SVG_STATION, isBulkhead: false, tid });
              if (fanTypes.has("ВМП") || fanTypes.size === 0)
                legendItems.push({ name: "Вентилятор местного проветривания (ВМП)", svgContent: FAN_SVG_PROPELLER, isBulkhead: false, tid });
            }
            else if (lt) legendItems.push({ name: lt.name, svgContent: lt.svgContent, isBulkhead: false, tid });
            else if (isBk) legendItems.push({ name: tid.replace(/_/g, " "), svgContent: "", isBulkhead: true, tid });
          }
          if (legendItems.length === 0) return null;

          // Фиксированный масштаб по формату листа (как у штампа)
          const _mmL = PAPER_SIZES_MM[(pl.paperFormat ?? "A3") as PaperFormat];
          const _paperWmmL = (pl.orientation ?? "landscape") === "landscape" ? Math.max(_mmL.w, _mmL.h) : Math.min(_mmL.w, _mmL.h);
          const pxPerMmL = rw / _paperWmmL;
          const legFontSize = pxPerMmL * 2.6;
          const legIconSZ = pxPerMmL * 5.5;
          const legLineH = legIconSZ + legFontSize * 0.4;
          const legPad = legFontSize * 0.6;
          const legW = pxPerMmL * 60;
          const legH = legPad * 2 + legendItems.length * legLineH + legFontSize * 1.5;
          // Смещение УО хранится в ММ листа (как внутренние координаты штампа),
          // поэтому умножаем на pxPerMmL — блок масштабируется вместе с листом
          // и не "убегает" при зуме.
          const legOffX = (pl.legendOffsetX ?? 0) * pxPerMmL;
          const legOffY = (pl.legendOffsetY ?? 0) * pxPerMmL;
          const lx = rx + inset + legOffX;
          const ly = ry + rh - inset - legH + legOffY;
          const canDrag = !!onPrintLayerChange;

          return (
            <g key="legend-block">
              <text x={lx} y={ly + legPad + legFontSize} fontSize={legFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
                Условные обозначения
              </text>
              {legendItems.map((item, idx) => {
                const iy = ly + legPad + legFontSize * 1.5 + idx * legLineH;
                const icX = lx;
                const icY = iy + (legLineH - legIconSZ) / 2;
                return (
                  <g key={idx}>
                    {!item.isBulkhead && item.svgContent ? (
                      <image
                        x={icX} y={icY} width={legIconSZ} height={legIconSZ}
                        href={`data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40">${encodeURIComponent(item.svgContent)}</svg>`}
                      />
                    ) : (
                      <g>
                        <line x1={icX} y1={iy + legLineH / 2} x2={icX + legIconSZ} y2={iy + legLineH / 2} stroke="#555" strokeWidth={1.2} />
                        <rect
                          x={icX + legIconSZ / 2 - legIconSZ * 0.175} y={icY + legIconSZ * 0.1}
                          width={legIconSZ * 0.35} height={legIconSZ * 0.8}
                          fill={item.tid.includes("conc") ? "#4caf50" : item.tid.includes("wood") ? "#ffd600" : item.tid.includes("brick") ? "#ff9800" : item.tid.includes("metal") ? "#9c27b0" : item.tid.includes("regulator") ? "#ffd600" : "white"}
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
              {/* Ручка перемещения */}
              {canDrag && (
                <rect x={lx} y={ly} width={legW} height={legH} fill="transparent"
                  style={{ cursor: "move" }}
                  onMouseDown={(e) => {
                    e.stopPropagation(); e.preventDefault();
                    const startX = e.clientX, startY = e.clientY;
                    const startOX = pl.legendOffsetX ?? 0, startOY = pl.legendOffsetY ?? 0;
                    const pxmm = pxPerMmL || 1;
                    const onMove = (me: MouseEvent) => onPrintLayerChange?.(h.id, { legendOffsetX: startOX + (me.clientX - startX) / pxmm, legendOffsetY: startOY + (me.clientY - startY) / pxmm });
                    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
                  }}
                />
              )}
            </g>
          );
        })()}

        {/* ── Штамп ГОСТ 185×55мм на схеме (правый нижний угол) ───────────── */}
        {pl.showStamp && (() => {
          // Фиксированный размер штампа по формату листа:
          // rw (px рамки) соответствует ширине листа в мм → px/мм = rw / paperWmm.
          const fmtS = (pl.paperFormat ?? "A3") as PaperFormat;
          const oriS = pl.orientation ?? "landscape";
          const mmS = PAPER_SIZES_MM[fmtS];
          const paperWmm = oriS === "landscape" ? Math.max(mmS.w, mmS.h) : Math.min(mmS.w, mmS.h);
          const pxPerMm = rw / paperWmm;              // масштаб мир→экран для штампа
          const stW = STAMP_W_MM * pxPerMm;
          const stH = STAMP_H_MM * pxPerMm;
          const stOffX = pl.stampOffsetX ?? 0;
          const stOffY = pl.stampOffsetY ?? 0;
          // Внутренний отступ рамки чертежа (по ГОСТ штамп прижат к рамке)
          const sx2 = rx + rw - inset - stW + stOffX;
          const sy2 = ry + rh - inset - stH + stOffY;
          const sw2 = Math.max(0.4, pxPerMm * 0.35);  // толщина основных линий
          const swThin = Math.max(0.25, pxPerMm * 0.18);
          const baseFs = Math.max(5, pxPerMm * 2.3);  // базовый размер шрифта
          const canDrag = !!onPrintLayerChange;
          const cells = buildStampCells(pl);
          const gridLines = buildStampGridLines();
          // мм → экранные координаты штампа
          const mx = (m: number) => sx2 + m * pxPerMm;
          const my = (m: number) => sy2 + m * pxPerMm;

          const startEdit = (field: StampFieldKey) => {
            setEditingStampCell({ horizonId: h.id, field, draft: getStampFieldValue(pl, field) });
          };
          const commitEdit = () => {
            if (editingStampCell && editingStampCell.horizonId === h.id) {
              onPrintLayerChange?.(h.id, { [editingStampCell.field]: editingStampCell.draft } as Partial<import("@/lib/topology").HorizonPrintLayer>);
            }
            setEditingStampCell(null);
          };

          return (
            <g key="stamp-block">
              {/* Белый фон */}
              <rect x={sx2} y={sy2} width={stW} height={stH} fill="white" />

              {/* Сетка штампа */}
              {gridLines.map((ln, i) => (
                <line key={`gl-${i}`}
                  x1={mx(ln.x1)} y1={my(ln.y1)} x2={mx(ln.x2)} y2={my(ln.y2)}
                  stroke="#1a1a1a" strokeWidth={ln.thick ? sw2 : swThin} />
              ))}

              {/* Ячейки: подписи граф + редактируемые значения */}
              {cells.map((c, i) => {
                const cx = mx(c.x);
                const cy = my(c.y);
                const cw = c.w * pxPerMm;
                const ch = c.h * pxPerMm;
                const fs = baseFs * (c.fontScale ?? 1);
                const textX = c.align === "left" ? cx + pxPerMm * 1.2 : cx + cw / 2;
                const textY = cy + ch / 2;
                const anchor = c.align === "left" ? "start" : "middle";

                // Нередактируемая подпись графы
                if (c.label && !c.field) {
                  return (
                    <text key={`lbl-${i}`} x={textX} y={textY}
                      textAnchor={anchor} dominantBaseline="central"
                      fontSize={fs} fontFamily="Arial, sans-serif"
                      fontWeight={c.bold ? "bold" : "normal"} fill="#333"
                      style={{ pointerEvents: "none", userSelect: "none" }}>
                      {c.label}
                    </text>
                  );
                }

                // Редактируемая ячейка
                if (c.field) {
                  const isEd = editingStampCell?.horizonId === h.id && editingStampCell?.field === c.field;
                  const val = getStampFieldValue(pl, c.field);
                  if (isEd && canDrag) {
                    return (
                      <foreignObject key={`ed-${i}`} x={cx + 1} y={cy + 1} width={Math.max(10, cw - 2)} height={Math.max(10, ch - 2)}>
                        <input
                          // @ts-expect-error xmlns
                          xmlns="http://www.w3.org/1999/xhtml"
                          autoFocus
                          value={editingStampCell.draft}
                          onChange={e => setEditingStampCell(s => s ? { ...s, draft: e.target.value } : s)}
                          onBlur={commitEdit}
                          onKeyDown={e => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditingStampCell(null);
                            e.stopPropagation();
                          }}
                          onMouseDown={e => e.stopPropagation()}
                          style={{
                            width: "100%", height: "100%",
                            textAlign: c.align === "left" ? "left" : "center",
                            fontSize: fs, fontFamily: "Arial, sans-serif",
                            fontWeight: c.bold ? "bold" : "normal",
                            border: "1.5px solid #7c3aed", borderRadius: 2, outline: "none",
                            background: "rgba(255,253,230,0.97)", padding: "0 2px",
                            boxSizing: "border-box" as const, color: "#111",
                          }}
                        />
                      </foreignObject>
                    );
                  }
                  return (
                    <text key={`val-${i}`} x={textX} y={textY}
                      textAnchor={anchor} dominantBaseline="central"
                      fontSize={fs} fontFamily="Arial, sans-serif"
                      fontWeight={c.bold ? "bold" : "normal"}
                      fill={val ? "#111" : "#bbb"}
                      style={{ cursor: canDrag ? "text" : "default", userSelect: "none" }}
                      onDoubleClick={canDrag ? (e) => { e.stopPropagation(); startEdit(c.field!); } : undefined}>
                      {val || (canDrag ? (c.placeholder || "—") : "")}
                    </text>
                  );
                }
                return null;
              })}

              {/* Ручка перемещения — узкая полоса по левому краю штампа */}
              {canDrag && (
                <rect x={sx2} y={sy2} width={Math.max(6, pxPerMm * 2)} height={stH} fill="transparent" style={{ cursor: "move" }}
                  onMouseDown={(e) => {
                    e.stopPropagation(); e.preventDefault();
                    const startX = e.clientX, startY = e.clientY;
                    const startOX = pl.stampOffsetX ?? 0, startOY = pl.stampOffsetY ?? 0;
                    const onMove = (me: MouseEvent) => onPrintLayerChange?.(h.id, { stampOffsetX: startOX + me.clientX - startX, stampOffsetY: startOY + me.clientY - startY });
                    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
                  }}
                />
              )}
            </g>
          );
        })()}

      </g>
    );
  });

  return { renderGroundGrid, renderWorkPlane, unprojFrame, renderPrintLayers };
}
