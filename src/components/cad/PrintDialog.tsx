import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { API_URLS } from "@/lib/api-urls";
import PrintPreviewCanvas, { type PrintPreviewCanvasHandle } from "./PrintPreviewCanvas";
import { type TopoNode, type TopoBranch, type Horizon, project3D } from "@/lib/topology";
import { renderCanvas, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import { type Position } from "@/lib/positions";
import { drawSymbolsToCanvas } from "@/lib/drawSymbolsToCanvas";
import { jsPDF } from "jspdf";
import { buildPrintLayerSvgString } from "@/lib/printLayerSvgString";
import { generateSvg, downloadSvg } from "@/lib/svgExporter";

// ── Печать через скрытый iframe (работает в Electron и браузере без всплывающих окон) ──
function printViaIframe(html: string) {
  const existing = document.getElementById("__pvs_print_frame__");
  if (existing) existing.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "__pvs_print_frame__";
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 500);
}

interface PrintDialogProps {
  onClose: () => void;
  projectName?: string;
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  /** Размер рабочего canvas (логические px) — для точной конвертации offset */
  canvasSize?: { w: number; h: number };
  // Параметры отображения — как настроено в рабочей области
  schemaSymbols?: SchemaSymbol[];
  branchWidth?: number;
  branchBorder?: number;
  thinLines?: boolean;
  colorByHorizon?: boolean;
  flowDisplay?: FlowDisplayMode;
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  zScale?: number;
  getSvgRaw?: () => string;
  colorMode?: "none" | "flowQ";
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;
  positions?: Position[];
  showPositions?: boolean;
  fixedObjectScale?: boolean;
  xyScale?: number;
  initialOpenExport?: boolean;
  onExportDialogOpened?: () => void;
}

type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0" | "custom";
type Orientation = "portrait" | "landscape";

const PAPER_SIZES: Record<Exclude<PaperFormat, "custom">, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #d0d0d0" }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left"
        style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", background: "#e4e4e4" }}>
        <span style={{ fontSize: 8, color: "#555" }}>{open ? "▼" : "►"}</span>
        {title}
      </button>
      {open && <div className="px-3 py-2 space-y-1.5">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 88, fontSize: 12, color: "#1a1a1a", flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const inp = "border border-gray-500 px-1.5 rounded text-[12px] text-gray-900 bg-white focus:outline-none focus:border-blue-500";
const sel = inp + " cursor-pointer w-full";
const ih = { height: 22 } as React.CSSProperties;

export default function PrintDialog({
  onClose, projectName = "Проект",
  nodes, branches, horizons, viewState, canvasSize,
  schemaSymbols = [],
  branchWidth = 2, branchBorder = 0.4,
  thinLines = false, colorByHorizon = false,
  flowDisplay = "off", infoConfig = null,
  unitsConfig = DEFAULT_UNITS_CONFIG,
  zScale = 1,
  getSvgRaw,
  colorMode = "none",
  posInnerColors,
  posOuterColors,
  positions = [],
  showPositions = true,
  fixedObjectScale = false,
  xyScale,
  initialOpenExport = false,
  onExportDialogOpened,
}: PrintDialogProps) {
  // Ref на живой canvas предпросмотра — для кнопки "Подобрать масштаб" и экспорта
  const previewRef = useRef<PrintPreviewCanvasHandle>(null);

  // Вычисляем загрязнённые ветви (BFS по потоку от pollutesAir=true) — для цвета стрелок
  const pollutedBranchIds = useMemo((): Set<string> => {
    const sources = branches.filter(b => b.pollutesAir);
    if (sources.length === 0) return new Set();
    const outEdges = new Map<string, string[]>();
    for (const b of branches) {
      const fromNode = (b.flow ?? 0) >= 0 ? b.fromId : b.toId;
      const toNode   = (b.flow ?? 0) >= 0 ? b.toId   : b.fromId;
      if (!outEdges.has(fromNode)) outEdges.set(fromNode, []);
      outEdges.get(fromNode)!.push(b.id);
      if (!outEdges.has(toNode)) outEdges.set(toNode, []);
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
  }, [branches]);

  // Берём формат/ориентацию из первого горизонта с активным слоем печати
  const firstActivePrintLayer = horizons.find(h => h.printLayer?.visible)?.printLayer ?? null;
  const [format, setFormat] = useState<PaperFormat>(
    (firstActivePrintLayer?.paperFormat as PaperFormat | undefined) ?? "A3"
  );
  const [orientation, setOrientation] = useState<Orientation>(
    (firstActivePrintLayer?.orientation as Orientation | undefined) ?? "landscape"
  );
  const [customW, setCustomW] = useState(420);
  const [customH, setCustomH] = useState(297);

  // Масштаб предпросмотра (только визуальный зум, не влияет на печать)
  const [viewZoom, setViewZoom] = useState(1);
  const viewZoomRef = useRef(1);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  // null = auto-fit (100%); number = множитель от fit (1.0 = 100%, 2.0 = 200%)
  const [userScale,   setUserScale]   = useState<number | null>(null);
  const [userOffsetX, setUserOffsetX] = useState<number | null>(null);
  const [userOffsetY, setUserOffsetY] = useState<number | null>(null);

  // Отображаемые значения (для полей ввода)
  const [scaleDisplay,   setScaleDisplay]   = useState<number>(100);
  const [offsetXDisplay, setOffsetXDisplay] = useState<number>(0);
  const [offsetYDisplay, setOffsetYDisplay] = useState<number>(0);
  const [marginTop, setMarginTop] = useState(5);
  const [marginBottom, setMarginBottom] = useState(5);
  const [marginLeft, setMarginLeft] = useState(5);
  const [marginRight, setMarginRight] = useState(5);
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [copies, setCopies] = useState(1);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [pageRange, setPageRange] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<Record<string, object>>(() => {
    try { return JSON.parse(localStorage.getItem("printTemplates") || "{}"); } catch { return {}; }
  });
  // Контекстное меню по ПКМ на листе
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tileIdx: number } | null>(null);

  // ─── Drag & Resize окна ─────────────────────────────────────────────
  const [winPos, setWinPos] = useState<{ x: number; y: number } | null>(null);
  const [winSize, setWinSize] = useState<{ w: number; h: number }>({ w: 1060, h: Math.min(window.innerHeight * 0.96, 860) });
  const winDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; dir: string } | null>(null);
  const winRef = useRef<HTMLDivElement>(null);

  const getWinPos = () => {
    if (winPos) return winPos;
    return {
      x: Math.max(0, (window.innerWidth  - winSize.w) / 2),
      y: Math.max(0, (window.innerHeight - winSize.h) / 2),
    };
  };

  const onTitleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const pos = getWinPos();
    winDragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!winDragRef.current) return;
      const nx = winDragRef.current.origX + ev.clientX - winDragRef.current.startX;
      const ny = winDragRef.current.origY + ev.clientY - winDragRef.current.startY;
      setWinPos({ x: Math.max(0, Math.min(window.innerWidth - 200, nx)), y: Math.max(0, Math.min(window.innerHeight - 60, ny)) });
    };
    const onUp = () => { winDragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onResizeMouseDown = (e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: winSize.w, origH: winSize.h, dir };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      const { origW, origH, dir: d } = resizeRef.current;
      let nw = origW, nh = origH;
      if (d.includes("e")) nw = Math.max(600, origW + dx);
      if (d.includes("s")) nh = Math.max(400, origH + dy);
      if (d.includes("w")) nw = Math.max(600, origW - dx);
      if (d.includes("n")) nh = Math.max(400, origH - dy);
      setWinSize({ w: nw, h: nh });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleTileContextMenu = useCallback((e: React.MouseEvent, tileIdx: number) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, tileIdx });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // ─── Drag-перетаскивание схемы в предпросмотре ────────────────────────
  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startOffsetX: number;  // px 150dpi
    startOffsetY: number;
    prevToPage: number;    // коэффициент превью-px / печатный-px
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleTileMouseDown = useCallback((e: React.MouseEvent, prevToPageRatio: number) => {
    if (e.button !== 0) return;  // только ЛКМ
    e.preventDefault();
    dragRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startOffsetX: 0,   // заполняется ниже через baseView
      startOffsetY: 0,
      prevToPage: prevToPageRatio,
    };
    setIsDragging(true);
  }, []);

  const dragBaseRef = useRef<{ offsetX: number; offsetY: number; defaultOffsetX: number; defaultOffsetY: number }>(
    { offsetX: 0, offsetY: 0, defaultOffsetX: 0, defaultOffsetY: 0 }
  );

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startMouseX;
    const dy = e.clientY - dragRef.current.startMouseY;
    // Экранные px → превью-px (убираем viewZoom) → печатные px (делим на prevToPage)
    const zoom = viewZoomRef.current;
    const printDx = dx / zoom / dragRef.current.prevToPage;
    const printDy = dy / zoom / dragRef.current.prevToPage;
    const newOffX = dragBaseRef.current.offsetX + printDx;
    const newOffY = dragBaseRef.current.offsetY + printDy;
    setUserOffsetX(newOffX);
    setUserOffsetY(newOffY);
    // Показываем дельту от дефолтного положения в мм
    const pxToMm = (v: number) => Math.round(v * 25.4 / 150 * 10) / 10;
    setOffsetXDisplay(pxToMm(newOffX - dragBaseRef.current.defaultOffsetX));
    setOffsetYDisplay(pxToMm(newOffY - dragBaseRef.current.defaultOffsetY));
  }, []);

  const handlePreviewMouseUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // Wheel-зум предпросмотра: масштабирует вид относительно позиции курсора
  const handlePreviewWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = previewContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Позиция курсора относительно контента (с учётом текущего скролла)
    const mouseX = e.clientX - rect.left + container.scrollLeft;
    const mouseY = e.clientY - rect.top  + container.scrollTop;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setViewZoom(prev => {
      const next = Math.max(0.1, Math.min(10, prev * factor));
      viewZoomRef.current = next;
      // Компенсируем скролл, чтобы точка под курсором не смещалась
      const ratio = next / prev;
      requestAnimationFrame(() => {
        container.scrollLeft = mouseX * ratio - (e.clientX - rect.left);
        container.scrollTop  = mouseY * ratio - (e.clientY - rect.top);
      });
      return next;
    });
  }, []);

  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png"|"png-hq"|"jpg"|"bmp"|"svg"|"pdf"|"pdf-vector">("png");
  const [exportDpi, setExportDpi] = useState(300);
  const [exportQuality, setExportQuality] = useState(95);
  const [pdfExporting, setPdfExporting] = useState(false);

  // Автооткрытие диалога экспорта PDF если вызван из меню Файл → Экспорт
  useEffect(() => {
    if (initialOpenExport) {
      setExportFormat("pdf");
      setShowExportDialog(true);
      onExportDialogOpened?.();
    }
  }, [initialOpenExport, onExportDialogOpened]);

  // Инициализация вида из текущего состояния рабочей области при первом открытии.
  // Задача: предпросмотр должен показывать ту же часть схемы что видна на экране.
  //
  // Системы координат:
  //   Экран:    scale_scr [px/unit], offset_scr [px] — в логических пикселях экрана
  //   150dpi:   scale_150 [px/unit], offset_150 [px] — в 150dpi пикселях
  //
  // Связь: 1 мм = scale_scr/unit_per_mm на экране; 1 мм = 150/25.4 px в 150dpi.
  // Коэффициент пересчёта масштаба: k = (150/25.4) / (scale_per_mm_screen)
  // Но scale_per_mm_screen неизвестен напрямую — зависит от размера canvas и bbox.
  //
  // Используем canvasSize (если передан) для точного перевода.
  // Принцип: схема должна отображаться пропорционально на 150dpi-странице,
  // воспроизводя то же соотношение "позиция в viewport / размер viewport".
  const viewInitDone = useRef(false);
  useEffect(() => {
    if (viewInitDone.current) return;
    if (nodes.length === 0) return;

    // Вычисляем bbox при scale=1 — только по видимым ветвям/узлам
    const tmpProj = { scale: 1, offsetX: 0, offsetY: 0,
      azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
    const initHorizonMap = new Map(horizons.map(h => [h.id, h]));
    const initVisibleNodeIds = new Set<string>();
    branches.forEach(b => {
      if (b.horizonId) { const h = initHorizonMap.get(b.horizonId); if (h && h.visible === false) return; }
      initVisibleNodeIds.add(b.fromId); initVisibleNodeIds.add(b.toId);
    });
    const initNodes = initVisibleNodeIds.size > 0 ? nodes.filter(n => initVisibleNodeIds.has(n.id)) : nodes;
    const _xySFInit = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of initNodes) {
      const p = project3D({ x: n.x * _xySFInit, y: n.y * _xySFInit, z: n.z * zScale }, tmpProj);
      if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
    }
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;

    // Параметры дефолтной страницы (A3 альбом, поля 5мм) — совпадают с useState
    const DPI = 150;
    const mmToPx150 = (mm: number) => mm * DPI / 25.4;
    const defPaperW = 420; const defPaperH = 297; const defMargin = 5;
    const workW = mmToPx150(defPaperW - defMargin * 2);
    const workH = mmToPx150(defPaperH - defMargin * 2);
    const pad = mmToPx150(defMargin);
    const fitSc = Math.min((workW - pad * 2) / bw, (workH - pad * 2) / bh);

    if (canvasSize && canvasSize.w > 0 && canvasSize.h > 0) {
      // Точный перевод через canvasSize:
      // На экране: схема занимает [offsetX + minX*scale .. offsetX + maxX*scale] в px
      // На 150dpi: хотим то же пропорциональное расположение
      //   printScale = screenScale * (150dpi_pageW / screenW) * (screenW / workAreaW)
      //   Упрощённо: printScale = screenScale * (workW / canvasSize.w)
      const scRatio = workW / canvasSize.w;
      const sc150 = viewState.scale * scRatio;
      const userSc = sc150 / fitSc;
      // Offset: сохраняем то же положение начала координат
      const off150X = viewState.offsetX * scRatio;
      const off150Y = viewState.offsetY * scRatio;
      setUserScale(userSc);
      setUserOffsetX(off150X);
      setUserOffsetY(off150Y);
    } else {
      // Fallback без canvasSize: просто fit-in-page (100%)
      // userScale = null → auto-fit, ничего не меняем
    }
    viewInitDone.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Размеры бумаги ───────────────────────────────────────────────────
  const paper = useMemo(() => {
    if (format === "custom") return { w: customW, h: customH };
    const s = PAPER_SIZES[format];
    return orientation === "landscape" ? { w: s.h, h: s.w } : s;
  }, [format, orientation, customW, customH]);

  const workArea = useMemo(() => ({
    w: paper.w - marginLeft - marginRight,
    h: paper.h - marginTop - marginBottom,
  }), [paper, marginLeft, marginRight, marginTop, marginBottom]);

  // ─── Размеры предпросмотра ────────────────────────────────────────────
  const PREV_MAX_W = 700;
  const PREV_MAX_H = 520;
  const aspect = paper.w / paper.h;
  const prevH = Math.min(PREV_MAX_H, PREV_MAX_W / aspect);
  const prevW = prevH * aspect;
  const px = (mm: number) => mm * (prevW / paper.w);

  // ─── Bbox схемы в проекции при scale=1 ───────────────────────────────
  // Если активен слой печати — берём bbox только по узлам видимого горизонта
  const schemaBbox = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1, w: 1, h: 1 };
    // Применяем xyScale к координатам — ровно так же как generateSvg и renderCanvas
    const _xySF = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
    const tmpProj = { scale: 1, offsetX: 0, offsetY: 0,
      azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
    // Собираем ID узлов только из видимых ветвей (ветви скрытых горизонтов исключены)
    const horizonMap = new Map(horizons.map(h => [h.id, h]));
    const activePL = horizons.find(h => h.printLayer?.visible) ?? null;
    const visibleBranchesForBbox = branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible !== false;
    });
    const visibleNodeIds = new Set<string>();
    visibleBranchesForBbox.forEach(b => { visibleNodeIds.add(b.fromId); visibleNodeIds.add(b.toId); });
    // При активном слое печати — только узлы этого горизонта; иначе — все видимые
    const nodesToUse = activePL
      ? nodes.filter(n => visibleNodeIds.has(n.id))
      : nodes;
    const bboxNodes = (nodesToUse.length > 0 ? nodesToUse : nodes);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of bboxNodes) {
      const p = project3D({ x: n.x * _xySF, y: n.y * _xySF, z: n.z * zScale }, tmpProj);
      if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
      if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
    }
    return { minX, maxX, minY, maxY, w: maxX - minX || 1, h: maxY - minY || 1 };
  }, [nodes, branches, horizons, viewState.azimuth, viewState.elevation, zScale, xyScale]);

  // ─── Активный слой печати (если есть) ────────────────────────────────
  const activePrintHorizon = useMemo(
    () => horizons.find(h => h.printLayer?.visible) ?? null,
    [horizons],
  );
  const hasPrintLayer = activePrintHorizon !== null;

  // ─── Bbox РУЧНОЙ рамки (pl.bounds) в нормальных координатах (scale=1) ──
  // Проецируем 4 угла рамки тем же способом, что и schemaBbox. Используется
  // чтобы вписать на лист ровно область рамки, а не bbox всех узлов.
  const frameBboxNorm = useMemo(() => {
    const pl = activePrintHorizon?.printLayer;
    if (!pl?.bounds) return null;
    const _xySF = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
    const tmpProj = { scale: 1, offsetX: 0, offsetY: 0,
      azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
    const z4 = (activePrintHorizon?.z ?? 0) * zScale;
    const b = pl.bounds;
    const corners = [
      project3D({ x: b.x1 * _xySF, y: b.y2 * _xySF, z: z4 }, tmpProj),
      project3D({ x: b.x2 * _xySF, y: b.y2 * _xySF, z: z4 }, tmpProj),
      project3D({ x: b.x1 * _xySF, y: b.y1 * _xySF, z: z4 }, tmpProj),
      project3D({ x: b.x2 * _xySF, y: b.y1 * _xySF, z: z4 }, tmpProj),
    ];
    const xs = corners.map(p => p.sx), ys = corners.map(p => p.sy);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, minY, w: (maxX - minX) || 1, h: (maxY - minY) || 1 };
  }, [activePrintHorizon, viewState.azimuth, viewState.elevation, zScale, xyScale]);

  // ─── Вычисление базового view для страницы (150dpi) ─────────────────
  // Если слой печати включён — 1 лист, схема вписывается в рамку.
  // userScale = null → fit в 1 страницу; userScale = N → абсолютный px-scale
  const baseView = useMemo(() => {
    const isScene3D = viewState.elevation < 89.5 || viewState.azimuth !== 0;
    const DPI = 150;
    const mmToPx = (mm: number) => mm * DPI / 25.4;
    const horizonMap = new Map(horizons.map(h => [h.id, h]));
    const { minX, minY, w: bw, h: bh } = schemaBbox;

    if (hasPrintLayer && activePrintHorizon?.printLayer) {
      // Режим слоя печати: вписать всю схему в один лист
      // Рамка занимает весь лист (с полями). Схема центрируется внутри рамки.
      const pl = activePrintHorizon.printLayer;
      const plFmt = (pl.paperFormat ?? "A3") as keyof typeof PAPER_SIZES;
      const plMm = PAPER_SIZES[plFmt] ?? PAPER_SIZES["A3"];
      const plOri = pl.orientation ?? "landscape";
      const plW = plOri === "landscape" ? plMm.h : plMm.w;
      const plH = plOri === "landscape" ? plMm.w : plMm.h;
      // Рабочая область рамки в px@150dpi (поля 5% от меньшей стороны)
      const padMmPl = Math.min(plW, plH) * 0.05;
      const padPx = padMmPl * DPI / 25.4;
      const frameW = mmToPx(plW) - padPx * 2;
      const frameH = mmToPx(plH) - padPx * 2;

      // Если рамка настроена ВРУЧНУЮ (pl.bounds) — вписываем на лист ровно
      // область рамки (её проекцию), а не bbox всех узлов. Так на печать
      // попадает именно то, что очерчено рамкой, в т.ч. в наклонных видах.
      const fitBox = frameBboxNorm ?? { minX, minY, w: bw, h: bh };
      // При ручной рамке отступа внутри нет (рамка = граница листа с полями),
      // при авто-вписывании оставляем небольшой внутренний отступ.
      const innerPad = frameBboxNorm ? 0 : Math.min(frameW, frameH) * 0.05;
      const fitSc = Math.min(
        (frameW - innerPad * 2) / (fitBox.w || 1),
        (frameH - innerPad * 2) / (fitBox.h || 1),
      );
      const sc = userScale !== null ? fitSc * userScale : fitSc;
      // Центрировать выбранную область (рамку или схему) в рабочей зоне листа
      const frameOffX = padPx + innerPad + (frameW - innerPad * 2 - fitBox.w * sc) / 2;
      const frameOffY = padPx + innerPad + (frameH - innerPad * 2 - fitBox.h * sc) / 2;
      const defaultOffsetX = frameOffX - fitBox.minX * sc;
      const defaultOffsetY = frameOffY - fitBox.minY * sc;
      const offsetX = userOffsetX ?? defaultOffsetX;
      const offsetY = userOffsetY ?? defaultOffsetY;
      const pageW = mmToPx(paper.w);
      const pageH = mmToPx(paper.h);
      return { sc, fitSc, offsetX, offsetY, defaultOffsetX, defaultOffsetY, isScene3D, pageW, pageH, horizonMap };
    }

    const pageW = mmToPx(workArea.w);
    const pageH = mmToPx(workArea.h);
    const padMm = 5;
    const pad = padMm * DPI / 25.4;
    const fitSc = Math.min((pageW - pad * 2) / (bw || 1), (pageH - pad * 2) / (bh || 1));
    const sc = userScale !== null ? fitSc * userScale : fitSc;
    const defaultOffsetX = pad - minX * sc;
    const defaultOffsetY = pad - minY * sc;
    const offsetX = userOffsetX ?? defaultOffsetX;
    const offsetY = userOffsetY ?? defaultOffsetY;
    return { sc, fitSc, offsetX, offsetY, defaultOffsetX, defaultOffsetY, isScene3D, pageW, pageH, horizonMap };
  }, [schemaBbox, frameBboxNorm, horizons, viewState, zScale, workArea, paper, userScale, userOffsetX, userOffsetY, hasPrintLayer, activePrintHorizon]);

  // Синхронизация scaleDisplay с реальным масштабом (только при userScale=null)
  useEffect(() => {
    if (userScale === null) setScaleDisplay(100);
    else setScaleDisplay(Math.round(userScale * 100));
  }, [userScale]);

  // Закрытие контекстного меню по клику/Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    return () => window.removeEventListener("mousedown", close);
  }, [ctxMenu]);

  // ─── Вычисление тайлов (сетка страниц) ───────────────────────────────
  const tiles = useMemo(() => {
    // Если слой печати включён — всегда 1 лист
    if (hasPrintLayer) {
      return { list: [{ col: 0, row: 0 }], cols: 1, rows: 1, colMin: 0, rowMin: 0 };
    }
    const { sc, offsetX, offsetY, pageW, pageH } = baseView;
    const { minX, minY, w: bw, h: bh } = schemaBbox;
    const schLeft   = minX * sc + offsetX;
    const schTop    = minY * sc + offsetY;
    const schRight  = schLeft + bw * sc;
    const schBottom = schTop  + bh * sc;
    const colMin = Math.floor(schLeft   / pageW);
    const colMax = Math.floor((schRight  - 0.5) / pageW);
    const rowMin = Math.floor(schTop    / pageH);
    const rowMax = Math.floor((schBottom - 0.5) / pageH);
    const cols = Math.max(1, colMax - colMin + 1);
    const rows = Math.max(1, rowMax - rowMin + 1);
    const list: { col: number; row: number }[] = [];
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        list.push({ col: c, row: r });
      }
    }
    return { list, cols, rows, colMin, rowMin };
  }, [baseView, schemaBbox, hasPrintLayer]);

  const totalPages = tiles.list.length;

  // ─── Рендер рамки слоя печати на canvas через SVG→Image ─────────────
  // Принимает готовые координаты рамки rx,ry,rw,rh (вычислены тем же алгоритмом что схема)
  const drawPrintLayerFrame = useCallback(async (
    ctx: CanvasRenderingContext2D,
    canvasW: number, canvasH: number,
    layer: NonNullable<Horizon["printLayer"]>,
    rect: { rx: number; ry: number; rw: number; rh: number },
  ): Promise<void> => {
    const svgStr = buildPrintLayerSvgString({ pl: layer, ...rect, totalW: canvasW, totalH: canvasH, schemaSymbols });
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); resolve(); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      img.src = url;
    });
  }, [schemaSymbols]);

  // Вычисляет bbox рамки из projNodes — тот же алгоритм что в PrintPreviewCanvas/TopoCanvas
  const computeFrameRect = useCallback((
    pl: NonNullable<Horizon["printLayer"]>,
    pNodes: { sx: number; sy: number; node: TopoNode }[],
    visBranches: TopoBranch[],
    proj?: ProjOptions,
    xyScale = 1,
    zLevel = 0,
  ): { rx: number; ry: number; rw: number; rh: number } | null => {
    // Ручная рамка (pl.bounds) — проецируем углы тем же project3D, что и рабочая
    // область: печать/PDF совпадают с настройкой пользователя, в т.ч. в наклонных видах.
    if (pl.bounds && proj) {
      const z4 = zLevel * (proj.zScale ?? 1);
      const b = pl.bounds;
      const cc = [
        project3D({ x: b.x1 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
        project3D({ x: b.x2 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
        project3D({ x: b.x1 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
        project3D({ x: b.x2 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
      ];
      const bxs = cc.map(p => p.sx), bys = cc.map(p => p.sy);
      const rx = Math.min(...bxs), ry = Math.min(...bys);
      const rw = Math.max(...bxs) - rx, rh = Math.max(...bys) - ry;
      return { rx, ry, rw: Math.max(rw, 40), rh: Math.max(rh, 40) };
    }
    const visIds = new Set<string>();
    visBranches.forEach(b => { visIds.add(b.fromId); visIds.add(b.toId); });
    const relevant = pNodes.filter(pn => visIds.has(pn.node.id));
    if (relevant.length === 0) return null;
    let mnSx = Infinity, mxSx = -Infinity, mnSy = Infinity, mxSy = -Infinity;
    relevant.forEach(p => {
      if (p.sx < mnSx) mnSx = p.sx; if (p.sx > mxSx) mxSx = p.sx;
      if (p.sy < mnSy) mnSy = p.sy; if (p.sy > mxSy) mxSy = p.sy;
    });
    const sw = mxSx - mnSx || 1, sh = mxSy - mnSy || 1;
    const pad = Math.max(sw, sh) * 0.08 + 15;
    const scx = (mnSx + mxSx) / 2, scy = (mnSy + mxSy) / 2;
    const plFmt = (pl.paperFormat ?? "A3") as keyof typeof PAPER_SIZES;
    const plMm = PAPER_SIZES[plFmt] ?? PAPER_SIZES["A3"];
    const plOri = pl.orientation ?? "landscape";
    const aspect = (plOri === "landscape" ? plMm.h : plMm.w) / (plOri === "landscape" ? plMm.w : plMm.h);
    let rsw = sw + pad * 2, rsh = rsw / aspect;
    if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
    rsw = Math.max(rsw, sw + pad * 2);
    rsh = rsw / aspect;
    if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
    return { rx: scx - rsw / 2, ry: scy - rsh / 2, rw: Math.max(rsw, 40), rh: Math.max(rsh, 40) };
  }, []);

  // ─── Рендер одного тайла ─────────────────────────────────────────────
  const renderTileToCanvas = useCallback(async (
    col: number,
    row: number,
    dpi: number,
  ): Promise<string> => {
    const mmToPx = (mm: number) => Math.round(mm * dpi / 25.4);

    const canvasW = mmToPx(paper.w);
    const canvasH = mmToPx(paper.h);

    // Мобильные браузеры ограничены ~16384px, десктоп держит до 32768px.
    // Для плоттерной печати A0 @ 600dpi нужно ~28346x40126px — укладывается в 32768.
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
    const MAX_PX = isMobile ? 8192 : 32768;
    const safeW = Math.min(canvasW, MAX_PX);
    const safeH = Math.min(canvasH, MAX_PX);
    const effectiveDpi = dpi * Math.min(safeW / canvasW, safeH / canvasH);
    const mmToPxE = (mm: number) => Math.round(mm * effectiveDpi / 25.4);

    const oc = document.createElement("canvas");
    oc.width = mmToPxE(paper.w);
    oc.height = mmToPxE(paper.h);
    const ctx = oc.getContext("2d");
    if (!ctx) return "";

    const { sc, offsetX, offsetY, isScene3D, horizonMap, pageW, pageH } = baseView;
    const BASE_DPI = 150;
    const dpiRatio = effectiveDpi / BASE_DPI;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, oc.width, oc.height);

    const visibleBranches = branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible;
    });

    if (hasPrintLayer && activePrintHorizon?.printLayer) {
      const pl = activePrintHorizon.printLayer;

      // Шаг 1: пересчитываем viewState рабочей области под canvas DPI.
      // Та же логика что PrintPreviewCanvas: viewState → масштаб под canvas.
      const cw = canvasSize?.w || oc.width;
      const ch = canvasSize?.h || oc.height;
      const k = Math.min(oc.width / cw, oc.height / ch);
      const sc0 = viewState.scale * k;
      const ox0 = viewState.offsetX * k + (oc.width - cw * k) / 2;
      const oy0 = viewState.offsetY * k + (oc.height - ch * k) / 2;

      // Шаг 2: bbox рамки при sc0/ox0/oy0 — только по узлам видимых ветвей горизонта
      const proj0 = { scale: sc0, offsetX: ox0, offsetY: oy0,
        azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
      // Собираем ID узлов только из видимых ветвей (горизонт отфильтрован выше)
      const visibleNodeIds0 = new Set<string>();
      visibleBranches.forEach(b => { visibleNodeIds0.add(b.fromId); visibleNodeIds0.add(b.toId); });
      const nodesForBbox = nodes.filter(n => visibleNodeIds0.has(n.id));
      const _xySFTile = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
      const pNodes0 = (nodesForBbox.length > 0 ? nodesForBbox : nodes)
        .map(n => project3D({ x: n.x * _xySFTile, y: n.y * _xySFTile, z: n.z * zScale }, proj0));
      let mnSx = Infinity, mxSx = -Infinity, mnSy = Infinity, mxSy = -Infinity;
      pNodes0.forEach(p => {
        if (p.sx < mnSx) mnSx = p.sx; if (p.sx > mxSx) mxSx = p.sx;
        if (p.sy < mnSy) mnSy = p.sy; if (p.sy > mxSy) mxSy = p.sy;
      });

      // Размер рамки по алгоритму TopoCanvas
      const plFmt2 = (pl.paperFormat ?? "A3") as keyof typeof PAPER_SIZES;
      const plMm2 = PAPER_SIZES[plFmt2] ?? PAPER_SIZES["A3"];
      const plOri2 = pl.orientation ?? "landscape";
      const fAsp = (plOri2 === "landscape" ? plMm2.h : plMm2.w) / (plOri2 === "landscape" ? plMm2.w : plMm2.h);
      let fRx: number, fRy: number, rsw3: number, rsh3: number;
      if (pl.bounds) {
        // Ручная рамка: прямоугольник = проекция её углов через proj0.
        const z4t = (activePrintHorizon.z ?? 0) * zScale;
        const bb = pl.bounds;
        const cc = [
          project3D({ x: bb.x1 * _xySFTile, y: bb.y2 * _xySFTile, z: z4t }, proj0),
          project3D({ x: bb.x2 * _xySFTile, y: bb.y2 * _xySFTile, z: z4t }, proj0),
          project3D({ x: bb.x1 * _xySFTile, y: bb.y1 * _xySFTile, z: z4t }, proj0),
          project3D({ x: bb.x2 * _xySFTile, y: bb.y1 * _xySFTile, z: z4t }, proj0),
        ];
        const cxs = cc.map(p => p.sx), cys = cc.map(p => p.sy);
        fRx = Math.min(...cxs); fRy = Math.min(...cys);
        rsw3 = (Math.max(...cxs) - fRx) || 1;
        rsh3 = (Math.max(...cys) - fRy) || 1;
      } else {
        const sw3 = mxSx - mnSx || 1, sh3 = mxSy - mnSy || 1;
        const pad3 = Math.max(sw3, sh3) * 0.08 + 15;
        const scx3 = (mnSx + mxSx) / 2, scy3 = (mnSy + mxSy) / 2;
        let w3 = sw3 + pad3 * 2, h3 = w3 / fAsp;
        if (h3 < sh3 + pad3 * 2) { h3 = sh3 + pad3 * 2; w3 = h3 * fAsp; }
        w3 = Math.max(w3, sw3 + pad3 * 2);
        h3 = w3 / fAsp;
        if (h3 < sh3 + pad3 * 2) { h3 = sh3 + pad3 * 2; w3 = h3 * fAsp; }
        rsw3 = w3; rsh3 = h3;
        fRx = scx3 - rsw3 / 2; fRy = scy3 - rsh3 / 2;
      }

      // Шаг 3: подгоняем view чтобы рамка = весь canvas
      const fitF = Math.min(oc.width / (rsw3 || 1), oc.height / (rsh3 || 1));
      const scaledSc   = sc0 * fitF;
      const scaledOffX = (ox0 - fRx) * fitF;
      const scaledOffY = (oy0 - fRy) * fitF;
      const sv = { scale: scaledSc, offsetX: scaledOffX, offsetY: scaledOffY,
        azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
      const _xySFPL = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
      const projNodes = nodes.map(n => ({
        node: n, ...project3D({ x: n.x * _xySFPL, y: n.y * _xySFPL, z: n.z * zScale }, sv), depth: 0,
      }));
      const projNodesMap = new Map(projNodes.map(p => [p.node.id, p]));

      // Шаг 4: рисуем схему
      renderCanvas({
        ctx, width: oc.width, height: oc.height,
        nodes, branches, horizons, horizonMap,
        visibleBranches, hiddenBranchIds: new Set(),
        projNodes, projNodesMap, proj: sv, view: sv,
        is3D: isScene3D, zScale, zLevel: 0,
        selectedBranchId: null, selectedBranchIds: new Set(),
        selectedNodeId: null, selectedNodeIds: new Set(),
        hoverBranchId: null, branchWidth, branchBorder,
        thinLines, colorByHorizon,
        showFlowArrows: false, flowDisplay,
        animOffset: 0, infoConfig, unitsConfig,
        printMode: true, fixedObjectScale, xyScale,
        colorMode, posInnerColors, posOuterColors,
      });

      if (schemaSymbols.length > 0) {
        await drawSymbolsToCanvas(ctx, schemaSymbols, branches, projNodesMap, scaledSc, unitsConfig);
      }

      // Шаг 5: рамка поверх — координаты из новых projNodes (тем же алгоритмом).
      // Передаём проекцию/масштаб/z, чтобы ручная рамка (pl.bounds) совпадала
      // с рабочей областью в т.ч. в наклонных видах.
      const frameRect = computeFrameRect(pl, projNodes, visibleBranches, sv, _xySFPL, activePrintHorizon.z ?? 0);
      if (frameRect) {
        await drawPrintLayerFrame(ctx, oc.width, oc.height, pl, frameRect);
      }
    } else {
      // Стандартный режим: тайлы с полями
      const marginLeftPx = mmToPxE(marginLeft);
      const marginTopPx  = mmToPxE(marginTop);
      const scaledSc   = sc * dpiRatio;
      const scaledOffX = marginLeftPx + (offsetX - col * pageW) * dpiRatio;
      const scaledOffY = marginTopPx  + (offsetY - row * pageH) * dpiRatio;
      const sv = {
        scale: scaledSc, offsetX: scaledOffX, offsetY: scaledOffY,
        azimuth: viewState.azimuth, elevation: viewState.elevation, zScale,
      };
      const _xySFStd = (typeof xyScale === "number" && xyScale > 0) ? xyScale : 1;
      const projNodes = nodes.map(n => ({
        node: n, ...project3D({ x: n.x * _xySFStd, y: n.y * _xySFStd, z: n.z * zScale }, sv), depth: 0,
      }));
      const projNodesMap = new Map(projNodes.map(p => [p.node.id, p]));

      const workW = mmToPxE(workArea.w);
      const workH = mmToPxE(workArea.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(marginLeftPx, marginTopPx, workW, workH);
      ctx.clip();
      renderCanvas({
        ctx, width: oc.width, height: oc.height,
        nodes, branches, horizons, horizonMap,
        visibleBranches, hiddenBranchIds: new Set(),
        projNodes, projNodesMap, proj: sv, view: sv,
        is3D: isScene3D, zScale, zLevel: 0,
        selectedBranchId: null, selectedBranchIds: new Set(),
        selectedNodeId: null, selectedNodeIds: new Set(),
        hoverBranchId: null, branchWidth, branchBorder,
        thinLines, colorByHorizon,
        showFlowArrows: false, flowDisplay,
        animOffset: 0, infoConfig, unitsConfig,
        printMode: true, fixedObjectScale, xyScale,
        colorMode, posInnerColors, posOuterColors,
      });
      ctx.restore();
      if (schemaSymbols.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(marginLeftPx, marginTopPx, workW, workH);
        ctx.clip();
        await drawSymbolsToCanvas(ctx, schemaSymbols, branches, projNodesMap, scaledSc, unitsConfig);
        ctx.restore();
      }
    }

    return oc.toDataURL("image/png");
  }, [baseView, paper, workArea, marginLeft, marginTop, canvasSize,
      nodes, branches, horizons, schemaSymbols, viewState, zScale,
      branchWidth, branchBorder, thinLines, colorByHorizon, flowDisplay, infoConfig, unitsConfig,
      colorMode, posInnerColors, posOuterColors, fixedObjectScale, xyScale,
      hasPrintLayer, activePrintHorizon, drawPrintLayerFrame, computeFrameRect]);


  // ─── Печать ──────────────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    const PRINT_DPI = 300;
    const total = totalPages * copies;

    const tilesList = reverseOrder ? [...tiles.list].reverse() : tiles.list;
    const pngPages: string[] = [];
    for (const t of tilesList) {
      pngPages.push(await renderTileToCanvas(t.col, t.row, PRINT_DPI));
    }

    // Штамп теперь рендерится через HorizonPrintLayerOverlay — не нужен отдельный HTML
    const makeStamp = (_idx: number, _total2: number) => "";

    // Canvas теперь = полный лист, img растягивается на весь лист без padding
    const pageHtmls: string[] = [];
    let pageNum = 0;
    for (let copy = 0; copy < copies; copy++) {
      for (const png of pngPages) {
        pageNum++;
        pageHtmls.push(`<div class="page">
  <img src="${png}" class="page-img" />
  ${makeStamp(pageNum, total)}
  ${showPageNumbers ? `<div class="page-num">${pageNum} / ${total}</div>` : ''}
</div>`);
      }
    }

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${projectName}</title>
<style>
@page{size:${paper.w}mm ${paper.h}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{background:white;font-family:Arial,sans-serif}
.page{width:${paper.w}mm;height:${paper.h}mm;position:relative;page-break-after:always;overflow:hidden;background:white}
.page:last-child{page-break-after:auto}
.page-img{position:absolute;top:0;left:0;width:${paper.w}mm;height:${paper.h}mm;display:block}
.page-num{position:absolute;bottom:${marginBottom+2}mm;right:${marginRight+2}mm;font-size:9pt;color:#555}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${pageHtmls.join("")}</body></html>`;

    printViaIframe(html);
  }, [paper, marginTop, marginBottom, marginRight,
      showPageNumbers, copies, reverseOrder, projectName,
      tiles, totalPages, renderTileToCanvas]);

  // Печать одного тайла (после tiles и renderTileToCanvas)
  const handlePrintSingleTile = useCallback(async (tileIdx: number) => {
    closeCtxMenu();
    const tile = tiles.list[tileIdx];
    if (!tile) return;
    const pageNum = tileIdx + 1;
    const png = await renderTileToCanvas(tile.col, tile.row, 300);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${projectName} — лист ${pageNum}</title>
<style>
@page{size:${paper.w}mm ${paper.h}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{background:white;font-family:Arial,sans-serif}
.page{width:${paper.w}mm;height:${paper.h}mm;position:relative;overflow:hidden;background:white}
.page-img{position:absolute;top:0;left:0;width:${paper.w}mm;height:${paper.h}mm;display:block}
.page-num{position:absolute;bottom:${marginBottom + 2}mm;right:${marginRight + 2}mm;font-size:9pt;color:#555}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="page">
  <img src="${png}" class="page-img" />
  ${showPageNumbers ? `<div class="page-num">${pageNum} / ${tiles.list.length}</div>` : ''}
</div>
</body></html>`;
    printViaIframe(html);
  }, [tiles, paper, marginBottom, marginRight, projectName,
      showPageNumbers, renderTileToCanvas, closeCtxMenu]);

  // ─── Вспомогательная функция: строим ProjOptions для SVG/PDF-vector ─────
  // SVG-холст = paper.w × paper.h мм при 96dpi (3.78px/мм).
  // baseView рассчитан при DPI=150 (5.906px/мм). Пересчитываем sc и offset под 96dpi.
  const buildProjForExport = useCallback(() => {
    const DPI_PRINT = 150;
    const DPI_SVG   = 96;
    const k = DPI_SVG / DPI_PRINT;          // ≈ 0.64
    const { sc, offsetX, offsetY } = baseView;
    return {
      scale:   sc      * k,
      offsetX: offsetX * k,
      offsetY: offsetY * k,
      azimuth: viewState.azimuth, elevation: viewState.elevation, zScale,
    };
  }, [baseView, viewState, zScale]);

  // ─── Экспорт ─────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    // ── PNG HQ — SVG→canvas с заданным DPI (максимальное качество для печати) ──
    if (exportFormat === "png-hq") {
      setPdfExporting(true);
      try {
        const proj = buildProjForExport();
        const mmToPx = (mm: number) => Math.round(mm * exportDpi / 25.4);
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        const MAX_PX = isMobile ? 8192 : 32768;
        const rawW = mmToPx(paper.w);
        const rawH = mmToPx(paper.h);
        const ratio = Math.min(MAX_PX / rawW, MAX_PX / rawH, 1);
        const canvasW = Math.round(rawW * ratio);
        const canvasH = Math.round(rawH * ratio);

        const svgStr = generateSvg({
          nodes, branches, horizons, horizonMap: baseView.horizonMap,
          proj, viewState, zScale,
          is3D: baseView.isScene3D,
          branchWidth, branchBorder, thinLines, colorByHorizon,
          infoConfig, unitsConfig, colorMode,
          posInnerColors, posOuterColors,
          positions: showPositions ? positions : [],
          canvasW, canvasH,
          paperWidthMm: paper.w,
          title: projectName,
          fixedObjectScale, xyScale,
          pollutedBranchIds,
          schemaSymbols: schemaSymbols ?? [],
        });

        // SVG → data URL → <img> → canvas → PNG
        const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const svgUrl = URL.createObjectURL(svgBlob);
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const oc = document.createElement("canvas");
            oc.width = canvasW;
            oc.height = canvasH;
            const ctx = oc.getContext("2d")!;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvasW, canvasH);
            ctx.drawImage(img, 0, 0, canvasW, canvasH);
            URL.revokeObjectURL(svgUrl);
            const a = document.createElement("a");
            a.href = oc.toDataURL("image/png");
            a.download = `${projectName}-${exportDpi}dpi.png`;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            resolve();
          };
          img.onerror = () => { URL.revokeObjectURL(svgUrl); reject(new Error("Ошибка загрузки SVG")); };
          img.src = svgUrl;
        });
        setShowExportDialog(false);
      } catch (e) {
        alert(`Ошибка PNG HQ: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPdfExporting(false);
      }
      return;
    }

    // ── SVG (векторный, масштабируется бесконечно) ───────────────────────
    if (exportFormat === "svg") {
      const proj = buildProjForExport();
      const svgStr = generateSvg({
        nodes, branches, horizons, horizonMap: baseView.horizonMap,
        proj, viewState, zScale,
        is3D: baseView.isScene3D,
        branchWidth, branchBorder, thinLines, colorByHorizon,
        infoConfig, unitsConfig, colorMode,
        posInnerColors, posOuterColors,
        positions: showPositions ? positions : [],
        canvasW: Math.round(paper.w * 3.78),
        canvasH: Math.round(paper.h * 3.78),
        paperWidthMm: paper.w,
        title: projectName,
        fixedObjectScale, xyScale,
        pollutedBranchIds,
        schemaSymbols: schemaSymbols ?? [],
      });
      downloadSvg(svgStr, projectName);
      setShowExportDialog(false);
      return;
    }

    // ── PDF векторный (SVG → PDF через бэкенд, идеально для плоттера) ────
    // Оба режима (SVG и Canvas) используют generateSvg — единый рендерер
    // с правильной поддержкой рамки слоя печати и вписыванием в лист.
    if (exportFormat === "pdf-vector") {
      setPdfExporting(true);
      try {
        const proj = buildProjForExport();
        const svgStr = generateSvg({
          nodes, branches, horizons, horizonMap: baseView.horizonMap,
          proj, viewState, zScale,
          is3D: baseView.isScene3D,
          branchWidth, branchBorder, thinLines, colorByHorizon,
          infoConfig, unitsConfig, colorMode,
          posInnerColors, posOuterColors,
          positions: showPositions ? positions : [],
          canvasW: Math.round(paper.w * 3.78),
          canvasH: Math.round(paper.h * 3.78),
          paperWidthMm: paper.w,
          title: projectName,
          fixedObjectScale, xyScale,
          pollutedBranchIds,
          schemaSymbols: schemaSymbols ?? [],
        });

        const isLandscape = paper.w > paper.h;
        const res = await fetch(API_URLS.svgToPdf, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            svg: svgStr,
            paper: "A3",
            orientation: isLandscape ? "landscape" : "portrait",
          }),
        });
        if (!res.ok) throw new Error("Ошибка сервера");
        const data = await res.json() as { pdf?: string; error?: string };
        if (!data.pdf) throw new Error(data.error ?? "Нет данных");
        const bytes = Uint8Array.from(atob(data.pdf), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${projectName}-vector.pdf`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        setShowExportDialog(false);
      } catch (e) {
        alert(`Ошибка векторного PDF: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPdfExporting(false);
      }
      return;
    }

    // PDF и растровые форматы
    setPdfExporting(true);
    try {
      const DPI = exportDpi;
      const tilesList = tiles.list;

      if (exportFormat === "pdf") {
        const isLandscape = paper.w > paper.h;
        const pdf = new jsPDF({
          orientation: isLandscape ? "landscape" : "portrait",
          unit: "mm",
          format: [paper.w, paper.h],
          compress: true,
        });

        for (let i = 0; i < tilesList.length; i++) {
          const t = tilesList[i];
          // canvas = полный лист при DPI — вставляем на весь лист (0,0)
          const pngSrc = await renderTileToCanvas(t.col, t.row, DPI);
          if (!pngSrc) continue;
          if (i > 0) pdf.addPage([paper.w, paper.h], isLandscape ? "landscape" : "portrait");
          pdf.addImage(pngSrc, "PNG", 0, 0, paper.w, paper.h, undefined, "MEDIUM");
          if (showPageNumbers) {
            pdf.setFontSize(8); pdf.setTextColor(80);
            pdf.text(`${i + 1} / ${tilesList.length}`, paper.w - marginRight - 2,
              paper.h - marginBottom - 2, { align: "right" });
          }
        }
        pdf.save(`${projectName}.pdf`);
        setShowExportDialog(false);
        return;
      }

      // Растровые форматы (PNG, JPG, BMP, TIFF) — первый тайл
      const { colMin, rowMin } = tiles;
      const pngSrc = await renderTileToCanvas(colMin, rowMin, DPI);
      if (!pngSrc) { alert("Ошибка рендера"); return; }

      if (exportFormat === "png") {
        const a = document.createElement("a");
        a.href = pngSrc;
        a.download = `${projectName}.png`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setShowExportDialog(false);
        return;
      }

      // JPG / BMP / TIFF — с белым фоном
      const img = new Image();
      await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = pngSrc; });
      const oc2 = document.createElement("canvas");
      oc2.width = img.width; oc2.height = img.height;
      const ctx2 = oc2.getContext("2d")!;
      ctx2.fillStyle = "#ffffff"; ctx2.fillRect(0, 0, oc2.width, oc2.height);
      ctx2.drawImage(img, 0, 0);
      const mime: Record<string, string> = { jpg: "image/jpeg", bmp: "image/bmp", tiff: "image/tiff" };
      const q = exportFormat === "jpg" ? exportQuality / 100 : undefined;
      const a = document.createElement("a");
      a.href = oc2.toDataURL(mime[exportFormat] ?? "image/png", q);
      a.download = `${projectName}.${exportFormat}`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setShowExportDialog(false);
    } finally {
      setPdfExporting(false);
    }
  }, [exportFormat, exportDpi, exportQuality, projectName,
      renderTileToCanvas, tiles, paper, showPageNumbers,
      marginLeft, marginRight, marginBottom,
      buildProjForExport, nodes, branches, horizons, baseView, viewState, zScale,
      branchWidth, branchBorder, thinLines, colorByHorizon, infoConfig, unitsConfig, colorMode,
      posInnerColors, posOuterColors, positions, showPositions,
      fixedObjectScale, xyScale, pollutedBranchIds, schemaSymbols]);

  // ─── Шаблоны ─────────────────────────────────────────────────────────
  const saveTemplate = () => {
    if (!templateName.trim()) { alert("Введите название"); return; }
    const tpl = { format, orientation, scale, marginTop, marginBottom, marginLeft, marginRight, showPageNumbers };
    const next = { ...templates, [templateName.trim()]: tpl };
    setTemplates(next); localStorage.setItem("printTemplates", JSON.stringify(next));
  };
  const loadTemplate = (name: string) => {
    const t = templates[name] as Record<string, unknown>;
    if (!t) return;
    if (t.format) setFormat(t.format as PaperFormat);
    if (t.orientation) setOrientation(t.orientation as Orientation);
    if (t.scale) setScale(t.scale as number);
    if (t.marginTop !== undefined) setMarginTop(t.marginTop as number);
    if (t.marginBottom !== undefined) setMarginBottom(t.marginBottom as number);
    if (t.marginLeft !== undefined) setMarginLeft(t.marginLeft as number);
    if (t.marginRight !== undefined) setMarginRight(t.marginRight as number);
    if (t.showPageNumbers !== undefined) setShowPageNumbers(t.showPageNumbers as boolean);
  };
  const deleteTemplate = (name: string) => {
    const next = { ...templates }; delete next[name];
    setTemplates(next); localStorage.setItem("printTemplates", JSON.stringify(next));
  };

  // ─── JSX ─────────────────────────────────────────────────────────────
  const pos = getWinPos();
  return (
    <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: "none" }}>
      <div ref={winRef} className="bg-white flex flex-col shadow-2xl border border-gray-400"
        style={{
          position: "absolute",
          left: pos.x, top: pos.y,
          width: winSize.w, height: winSize.h,
          fontFamily: "Tahoma, Segoe UI, Arial, sans-serif", fontSize: 12, borderRadius: 2,
          pointerEvents: "auto",
          userSelect: winDragRef.current || resizeRef.current ? "none" : undefined,
        }}>

        {/* Resize-ручки */}
        {(["e","s","se"] as const).map(dir => (
          <div key={dir} onMouseDown={e => onResizeMouseDown(e, dir)} style={{
            position: "absolute", zIndex: 10,
            ...(dir === "e"  ? { right: 0, top: 4, bottom: 4, width: 5, cursor: "ew-resize" } : {}),
            ...(dir === "s"  ? { bottom: 0, left: 4, right: 4, height: 5, cursor: "ns-resize" } : {}),
            ...(dir === "se" ? { right: 0, bottom: 0, width: 10, height: 10, cursor: "nwse-resize" } : {}),
          }} />
        ))}

        {/* Заголовок — drag-зона */}
        <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#4a7fc8,#3060a8)", cursor: "move", borderRadius: "2px 2px 0 0" }}
          onMouseDown={onTitleMouseDown}>
          <div className="flex items-center gap-2">
            <Icon name="Printer" size={14} className="text-white opacity-90" />
            <span className="font-bold text-white text-[13px]">{projectName} — Просмотр</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-0.5 bg-white rounded text-[12px] font-semibold text-gray-800 hover:bg-gray-100 border border-gray-300">
              <Icon name="Printer" size={13} />Печать
            </button>
            <button onClick={onClose}
              className="w-6 h-6 flex items-center justify-center text-white hover:bg-red-500 rounded text-[13px]">✕</button>
          </div>
        </div>

        {/* Тело */}
        <div className="flex flex-1 overflow-hidden">

          {/* Левая панель */}
          <div className="flex-shrink-0 overflow-y-auto border-r border-gray-300"
            style={{ width: 215, background: "#f4f4f4", color: "#1a1a1a" }}>

            {/* Кнопки */}
            <div className="flex gap-2 px-2 py-2 border-b border-gray-300">
              <button onClick={handlePrint}
                className="flex flex-col items-center gap-0.5 flex-1 py-1.5 hover:bg-gray-200 rounded border border-gray-300 bg-white">
                <Icon name="Printer" size={22} className="text-gray-700" />
                <span style={{ fontSize: 11, color: "#222" }}>Печать</span>
              </button>
              <button onClick={() => setShowExportDialog(true)}
                className="flex flex-col items-center gap-0.5 flex-1 py-1.5 hover:bg-gray-200 rounded border border-gray-300 bg-white">
                <Icon name="Download" size={22} className="text-gray-700" />
                <span style={{ fontSize: 11, color: "#222" }}>Экспорт</span>
              </button>
            </div>

            {/* Шаблон */}
            <Section title="Шаблон">
              <select className={sel} style={ih} value=""
                onChange={e => { if (e.target.value) loadTemplate(e.target.value); }}>
                <option value="">— выбрать шаблон —</option>
                {Object.keys(templates).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Название шаблона:</div>
              <input className={inp + " w-full"} style={ih} placeholder="Мой шаблон"
                value={templateName} onChange={e => setTemplateName(e.target.value)} />
              <div className="flex gap-1 pt-1">
                <button onClick={saveTemplate}
                  className="flex-1 py-0.5 text-[11px] border border-gray-400 rounded hover:bg-gray-200 bg-white font-medium text-gray-800">Сохранить</button>
                <button onClick={() => templateName && deleteTemplate(templateName)}
                  className="flex-1 py-0.5 text-[11px] border border-gray-400 rounded hover:bg-red-50 hover:border-red-400 bg-white text-gray-700">Удалить</button>
              </div>
            </Section>

            {/* Основные параметры */}
            <Section title="Основные параметры">
              <div style={{ fontSize: 12, color: "#333", marginBottom: 3 }}>Принтер:</div>
              <select className={sel} style={ih}><option>Системный принтер</option></select>
            </Section>

            {/* Диапазон */}
            <Section title="Печатный диапазон">
              <Row label="Страницы:">
                <input className={inp + " w-full"} style={ih} placeholder="Пример: 1-1"
                  value={pageRange} onChange={e => setPageRange(e.target.value)} />
              </Row>
              <Row label="Копии:">
                <input type="number" min={1} max={99} className={inp} style={{ ...ih, width: 60 }}
                  value={copies} onChange={e => setCopies(Math.max(1, +e.target.value || 1))} />
              </Row>
              <label className="flex items-center gap-1.5 cursor-pointer pt-0.5">
                <input type="checkbox" checked={reverseOrder} onChange={e => setReverseOrder(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span style={{ fontSize: 12, color: "#1a1a1a" }}>Печать в обратном порядке</span>
              </label>
            </Section>

            {/* Размер бумаги */}
            <Section title="Размер бумаги">
              <Row label="Ориентация:">
                <select className={sel} style={ih} value={orientation}
                  onChange={e => setOrientation(e.target.value as Orientation)}>
                  <option value="landscape">Альбомная</option>
                  <option value="portrait">Книжная</option>
                </select>
              </Row>
              <Row label="Формат:">
                <select className={sel} style={ih} value={format}
                  onChange={e => setFormat(e.target.value as PaperFormat)}>
                  {(["A4","A3","A2","A1","A0"] as PaperFormat[]).map(f =>
                    <option key={f} value={f}>{f} ({PAPER_SIZES[f].w}×{PAPER_SIZES[f].h} мм)</option>)}
                  <option value="custom">Произвольный</option>
                </select>
              </Row>
              {format === "custom" ? (
                <>
                  <Row label="Ширина:">
                    <div className="flex items-center gap-1">
                      <input type="number" className={inp} style={{ ...ih, width: 60 }}
                        value={customW} onChange={e => setCustomW(+e.target.value || 210)} />
                      <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                    </div>
                  </Row>
                  <Row label="Высота:">
                    <div className="flex items-center gap-1">
                      <input type="number" className={inp} style={{ ...ih, width: 60 }}
                        value={customH} onChange={e => setCustomH(+e.target.value || 297)} />
                      <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                    </div>
                  </Row>
                </>
              ) : (
                <>
                  <Row label="Ширина:"><span style={{ fontSize: 12, color: "#333" }}>{paper.w} мм</span></Row>
                  <Row label="Высота:"><span style={{ fontSize: 12, color: "#333" }}>{paper.h} мм</span></Row>
                </>
              )}
            </Section>

            {/* Преобразование схемы */}
            <Section title="Преобразование схемы">
              <Row label="Масштаб:">
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={10000} className={inp} style={{ ...ih, width: 60 }}
                    value={scaleDisplay}
                    onChange={e => {
                      const v = Math.max(1, +e.target.value || 1);
                      setScaleDisplay(v);
                      // userScale = множитель относительно fit (100% = fit = 1.0)
                      setUserScale(v / 100);
                    }} />
                  <span style={{ fontSize: 11, color: "#555" }}>%</span>
                </div>
              </Row>
              <button onClick={() => {
                // 100% = fit в 1 лист
                setUserScale(null);
                setUserOffsetX(null); setUserOffsetY(null);
                setOffsetXDisplay(0); setOffsetYDisplay(0);
                setScaleDisplay(100);
              }}
                className="w-full py-0.5 text-[11px] border border-gray-400 rounded hover:bg-blue-50 hover:border-blue-400 bg-white font-medium text-gray-800">
                Подобрать масштаб
              </button>
              <div style={{ fontSize: 12, color: "#333", fontWeight: 500, paddingTop: 4 }}>Смещение:</div>
              <Row label="вправо:">
                <div className="flex items-center gap-1">
                  <input type="number" className={inp} style={{ ...ih, width: 60 }}
                    value={offsetXDisplay}
                    onChange={e => {
                      const mm = +e.target.value || 0;
                      setOffsetXDisplay(mm);
                      // дельта от дефолтного положения
                      setUserOffsetX(baseView.defaultOffsetX + mm * 150 / 25.4);
                    }} />
                  <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                </div>
              </Row>
              <Row label="вниз:">
                <div className="flex items-center gap-1">
                  <input type="number" className={inp} style={{ ...ih, width: 60 }}
                    value={offsetYDisplay}
                    onChange={e => {
                      const mm = +e.target.value || 0;
                      setOffsetYDisplay(mm);
                      setUserOffsetY(baseView.defaultOffsetY + mm * 150 / 25.4);
                    }} />
                  <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                </div>
              </Row>
            </Section>

            {/* Поля */}
            <Section title="Поля" defaultOpen={false}>
              {([["Верхнее:", marginTop, setMarginTop],["Нижнее:", marginBottom, setMarginBottom],
                 ["Левое:", marginLeft, setMarginLeft],["Правое:", marginRight, setMarginRight]
              ] as [string, number, (v: number) => void][]).map(([lbl, val, set]) => (
                <Row key={lbl} label={lbl}>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={50} className={inp} style={{ ...ih, width: 55 }}
                      value={val} onChange={e => set(Math.max(0, +e.target.value || 0))} />
                    <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                  </div>
                </Row>
              ))}
            </Section>

            {/* Номера страниц */}
            <Section title="Номера страниц" defaultOpen={false}>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showPageNumbers} onChange={e => setShowPageNumbers(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span style={{ fontSize: 12, color: "#1a1a1a" }}>Номера страниц</span>
              </label>
              <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
                Рамка, штамп и УО управляются через «Слой печати» в панели горизонтов.
              </p>
            </Section>

            {/* Сброс */}
            <div className="px-3 py-2">
              <button onClick={() => {
                setUserScale(null); setUserOffsetX(null); setUserOffsetY(null);
                setScaleDisplay(100); setOffsetXDisplay(0); setOffsetYDisplay(0);
                setMarginTop(5); setMarginBottom(5); setMarginLeft(5); setMarginRight(5);
                setShowPageNumbers(true);
              }} className="w-full py-0.5 text-[11px] border border-gray-400 rounded hover:bg-gray-200 bg-white text-gray-700">
                Сбросить настройки
              </button>
            </div>
          </div>

          {/* Предпросмотр */}
          <div
            ref={previewContainerRef}
            className="flex-1 overflow-scroll"
            style={{ background: "#ffffff", cursor: isDragging ? "grabbing" : "default", position: "relative" }}
            onWheel={handlePreviewWheel}
            onClick={closeCtxMenu}
            onMouseMove={handlePreviewMouseMove}
            onMouseUp={handlePreviewMouseUp}
            onMouseLeave={handlePreviewMouseUp}
          >
            {/* Невидимый spacer задаёт правильный размер скролл-области */}
            <div style={{
              width:  (prevW  * tiles.cols  + 16 * (tiles.cols  - 1) + 40) * viewZoom,
              height: (prevH * tiles.rows + 16 * (tiles.rows - 1) + 40) * viewZoom,
              flexShrink: 0,
            }} />
            {/* Обёртка с transform: position absolute чтобы не влиять на поток */}
            <div style={{
              position: "absolute", top: 0, left: 0,
              padding: 20,
              transformOrigin: "top left",
              transform: `scale(${viewZoom})`,
            }}>

            {/* Сетка листов — по cols столбцов */}
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${tiles.cols}, ${prevW}px)`,
              gap: 16,
            }}>
              {tiles.list.map((tile, idx) => {
                const pageNum = idx + 1;

                return (
                  <div key={`${tile.col}-${tile.row}`}
                    onContextMenu={e => handleTileContextMenu(e, idx)}
                    onMouseDown={e => {
                      dragBaseRef.current = {
                        offsetX: baseView.offsetX, offsetY: baseView.offsetY,
                        defaultOffsetX: baseView.defaultOffsetX, defaultOffsetY: baseView.defaultOffsetY,
                      };
                      handleTileMouseDown(e, prevToPage);
                    }}
                    style={{
                      width: prevW, height: prevH, background: "white", flexShrink: 0,
                      boxShadow: "2px 2px 8px rgba(0,0,0,0.25)", position: "relative",
                      cursor: isDragging ? "grabbing" : "grab",
                      overflow: "hidden", userSelect: "none",
                    }}>

                    {/* Схема + слой печати */}
                    <div style={{ position: "absolute", top: 0, left: 0, width: prevW, height: prevH }}>
                      <PrintPreviewCanvas
                        ref={idx === 0 ? previewRef : undefined}
                        nodes={nodes}
                        branches={branches}
                        horizons={horizons}
                        schemaSymbols={schemaSymbols}
                        viewState={viewState}
                        canvasSize={canvasSize ?? { w: prevW, h: prevH }}
                        zScale={zScale}
                        is3D={viewState.elevation < 89.5 || viewState.azimuth !== 0}
                        width={prevW}
                        height={prevH}
                        branchWidth={branchWidth}
                        branchBorder={branchBorder}
                        thinLines={thinLines}
                        colorByHorizon={colorByHorizon}
                        flowDisplay={flowDisplay}
                        infoConfig={infoConfig}
                        unitsConfig={unitsConfig}
                        colorMode={colorMode}
                        posInnerColors={posInnerColors}
                        posOuterColors={posOuterColors}
                        positions={positions}
                        showPositions={showPositions}
                        fixedObjectScale={fixedObjectScale}
                        xyScale={xyScale}
                        superSample={viewZoom}
                      />
                    </div>



                    {/* Номер страницы */}
                    {showPageNumbers && (
                      <div style={{
                        position: "absolute", zIndex: 3,
                        bottom: px(marginBottom + 1),
                        right: px(marginRight + 1),
                        fontSize: Math.max(8, px(3)), color: "#888",
                      }}>{pageNum} / {totalPages}</div>
                    )}

                    {/* Серый номер страницы в центре (как в референсе) для пустых областей */}
                    {totalPages > 1 && (
                      <div style={{
                        position: "absolute", zIndex: 1, inset: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        pointerEvents: "none",
                        fontSize: Math.round(prevH * 0.35), fontWeight: 700,
                        color: "rgba(0,0,0,0.06)", userSelect: "none",
                      }}>{pageNum}</div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>{/* конец обёртки transform */}

            {/* Контекстное меню */}
            {ctxMenu && (
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{
                  position: "fixed", zIndex: 9999,
                  left: ctxMenu.x, top: ctxMenu.y,
                  background: "white", border: "1px solid #ccc",
                  borderRadius: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                  minWidth: 200, overflow: "hidden",
                  fontSize: 13, color: "#1a1a1a",
                }}
              >
                <div style={{ padding: "6px 8px", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0", fontSize: 11, color: "#666", fontWeight: 600 }}>
                  Лист {ctxMenu.tileIdx + 1} из {totalPages}
                </div>
                <button
                  onClick={() => handlePrintSingleTile(ctxMenu.tileIdx)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  🖨 Печатать этот лист
                </button>
                <button
                  onClick={() => { closeCtxMenu(); handlePrint(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", cursor: "pointer", borderTop: "1px solid #f0f0f0" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  🖨 Печатать всю схему ({totalPages} {totalPages === 1 ? "лист" : totalPages < 5 ? "листа" : "листов"})
                </button>
              </div>
            )}
          </div>{/* конец контейнера предпросмотра */}
        </div>

        {/* Статус-строка */}
        <div className="flex items-center justify-between px-4 py-1 flex-shrink-0"
          style={{ background: "#555", color: "white", fontSize: 11, borderTop: "1px solid #444" }}>
          <span>{paper.w}×{paper.h} мм · {orientation === "landscape" ? "Альбомная" : "Книжная"} · Масштаб печати {scaleDisplay}% · {totalPages} {totalPages === 1 ? "лист" : totalPages < 5 ? "листа" : "листов"}</span>
          <span style={{ cursor: "pointer" }} title="Сбросить зум предпросмотра" onClick={() => setViewZoom(1)}>
            {Math.round(viewZoom * 100)} %
          </span>
        </div>

        {/* Кнопки внизу */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 flex-shrink-0"
          style={{ background: "#efefef", borderTop: "1px solid #d0d0d0" }}>
          <button onClick={handlePrint}
            className="px-5 py-1.5 rounded text-[12px] font-semibold text-white hover:bg-blue-600"
            style={{ background: "#2563eb", border: "1px solid #1e4db7" }}>
            <Icon name="Printer" size={13} className="inline mr-1.5" />Печать
          </button>
          <button onClick={onClose}
            className="px-4 py-1.5 rounded text-[12px] border border-gray-400 bg-white hover:bg-gray-100 text-gray-700">
            Закрыть
          </button>
        </div>
      </div>

      {/* Диалог экспорта */}
      {showExportDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", pointerEvents: "auto" }}>
          <div className="bg-white rounded shadow-2xl border border-gray-400"
            style={{ width: 400, fontFamily: "Tahoma, Segoe UI, Arial, sans-serif" }}>

            <div className="flex items-center justify-between px-4 py-2"
              style={{ background: "linear-gradient(180deg,#4a7fc8,#3060a8)", borderRadius: "4px 4px 0 0" }}>
              <div className="flex items-center gap-2">
                <Icon name="Download" size={14} className="text-white" />
                <span className="text-white font-bold text-[13px]">Экспорт схемы</span>
              </div>
              <button onClick={() => setShowExportDialog(false)}
                className="text-white hover:bg-red-500 w-5 h-5 flex items-center justify-center rounded">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 8 }}>Формат файла:</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["png","png-hq","jpg","bmp","tiff","svg","pdf","pdf-vector"] as const).map(f => (
                    <button key={f} onClick={() => setExportFormat(f)}
                      className="py-1.5 rounded border text-[12px] font-semibold uppercase"
                      style={{
                        background: exportFormat === f ? "#2563eb" : "white",
                        color: exportFormat === f ? "white" : "#1a1a1a",
                        borderColor: exportFormat === f ? "#2563eb" : "#9ca3af",
                      }}>
                      {f === "pdf-vector" ? "PDF ✦" : f === "png-hq" ? "PNG ★" : f.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                  {exportFormat === "png"        && "PNG — растр, без потерь. Рекомендуется для экрана."}
                  {exportFormat === "png-hq"     && <span style={{ color: "#1a6e2e", fontWeight: 600 }}>PNG ★ — высококачественный растр через SVG-вектор. Рамка, штамп, УО — всё чётко при любом DPI. Идеально для широкоформатной печати.</span>}
                  {exportFormat === "jpg"        && "JPEG — растр, с потерями, меньше размер"}
                  {exportFormat === "bmp"        && "BMP — растр, без сжатия"}
                  {exportFormat === "tiff"       && "TIFF — растр, для полиграфии"}
                  {exportFormat === "svg"        && "SVG — вектор, идеально для плоттера, масштаб бесконечен"}
                  {exportFormat === "pdf"        && "PDF — растровый, все страницы, выбранный DPI"}
                  {exportFormat === "pdf-vector" && "PDF ✦ — векторный, идеально для плоттера. Конвертируется на сервере из SVG."}
                </div>
              </div>

              {!["svg", "pdf-vector"].includes(exportFormat) && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 8 }}>Разрешение (DPI):</div>
                  <div className="flex gap-2 mb-2">
                    {[72,96,150,300,600].map(d => (
                      <button key={d} onClick={() => setExportDpi(d)}
                        className="flex-1 py-1 rounded border text-[11px] font-medium"
                        style={{
                          background: exportDpi === d ? "#2563eb" : "white",
                          color: exportDpi === d ? "white" : "#1a1a1a",
                          borderColor: exportDpi === d ? "#2563eb" : "#9ca3af",
                        }}>{d}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12, color: "#333" }}>Своё:</span>
                    <input type="number" min={36} max={1200} value={exportDpi}
                      onChange={e => setExportDpi(Math.max(36, Math.min(1200, +e.target.value || 96)))}
                      className="border border-gray-400 rounded px-2 text-[12px] text-gray-900"
                      style={{ width: 70, height: 24 }} />
                    <span style={{ fontSize: 11, color: "#555" }}>dpi</span>
                  </div>
                  {(() => {
                    const pw = Math.round(paper.w * exportDpi / 25.4);
                    const ph = Math.round(paper.h * exportDpi / 25.4);
                    const isMobile = /Mobi|Android/i.test(navigator.userAgent);
                    const MAX_PX = isMobile ? 8192 : 32768;
                    const clipped = pw > MAX_PX || ph > MAX_PX;
                    const effW = Math.min(pw, MAX_PX);
                    const effH = Math.min(ph, MAX_PX);
                    return (
                      <div style={{ fontSize: 11, marginTop: 6, color: clipped ? "#b45309" : "#555" }}>
                        Размер: {effW} × {effH} пикс.
                        {clipped && <span> (ограничено браузером — исходный {pw}×{ph})</span>}
                        {exportFormat === "png-hq" && !clipped && <span style={{ color: "#1a6e2e" }}> — вектор без пикселизации</span>}
                      </div>
                    );
                  })()}
                </div>
              )}

              {exportFormat === "jpg" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>
                    Качество: {exportQuality}%
                  </div>
                  <input type="range" min={10} max={100} step={5}
                    value={exportQuality} onChange={e => setExportQuality(+e.target.value)}
                    className="w-full" style={{ accentColor: "#2563eb" }} />
                </div>
              )}
            </div>

            <div className="flex gap-2 px-5 pb-5 justify-end">
              <button onClick={handleExport} disabled={pdfExporting}
                className="px-5 py-1.5 rounded text-[12px] font-semibold text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-wait"
                style={{ background: "#2563eb", border: "1px solid #1e4db7" }}>
                {pdfExporting
                  ? <><Icon name="Loader" size={13} className="inline mr-1.5 animate-spin" />{exportFormat === "pdf-vector" ? "Конвертация SVG→PDF..." : exportFormat === "png-hq" ? "Рендер PNG HQ..." : "Генерация PDF..."}</>
                  : <><Icon name="Download" size={13} className="inline mr-1.5" />Скачать {exportFormat === "pdf-vector" ? "PDF ✦ вектор" : exportFormat === "png-hq" ? "PNG ★ HQ" : exportFormat.toUpperCase()}</>
                }
              </button>
              <button onClick={() => setShowExportDialog(false)} disabled={pdfExporting}
                className="px-4 py-1.5 rounded text-[12px] border border-gray-400 bg-white hover:bg-gray-100 text-gray-700 disabled:opacity-60">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}