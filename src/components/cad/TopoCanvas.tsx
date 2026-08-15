import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  type TopoNode, type TopoBranch, type ProjOptions, type ViewPreset, type WorkPlane,
  type Horizon, type PaperFormat,
  PAPER_SIZES_MM, OVERVIEW_HORIZON_ID,
  project3D, unproject2D, unprojectToPlane, calcBranchLength, VIEW_PRESETS, autoWorkPlane,
  sectionKind, SECTION_KIND_COLORS,
} from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, HEATER_SYMBOL_IDS, VENT_JET_SYMBOL_IDS, FAN_SYMBOL_IDS, fanSvgContent, FAN_SVG_STATION, FAN_SVG_PROPELLER } from "@/lib/schemaSymbols";
import {
  STAMP_W_MM, STAMP_H_MM, buildStampCells, buildStampGridLines, getStampFieldValue,
  type StampFieldKey,
} from "@/lib/stampTemplate";
import {
  buildApproverElements, buildApproverLines, getApproverFieldValue, computeApproverBox,
  type ApproverFieldKey,
} from "@/lib/approverTemplate";
import { DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { solidBulkheadRkMurg } from "@/lib/bulkheads";
import CanvasLayer from "@/components/cad/CanvasLayer";
import { CanvasErrorBoundary } from "@/components/cad/CanvasErrorBoundary";
import { CANVAS_THRESHOLD, hitNodeCanvas, hitBranchCanvas, hitBranchLabelCanvas, velocityColor as velocityColorFn, flowQColor as flowQColorFn } from "@/components/cad/CanvasLayerExports";

// ─────────────────────────────────────────────────────────────────────────────
// Интерактивный CAD-холст для построения топологии
// 2D (план) + 3D с произвольным ракурсом
//
// Файл разделён на модули (логика и разметка перенесены 1:1):
//   topoCanvas/topoCanvasTypes  — Props, ViewState, CadTool, FlowDisplayMode
//   topoCanvas/topoCanvasUtils  — утилиты попадания (hitNode/hitBranch), fmtR
//   topoCanvas/TopoCanvasHud    — ViewCube, масштабная линейка, маркер вращения
//   topoCanvas/TopoCanvasStatus — индикаторы внизу и подсказки инструментов
// ─────────────────────────────────────────────────────────────────────────────
import { type Props, type ViewState } from "@/components/cad/topoCanvas/topoCanvasTypes";
// Утилиты попадания hitNode*/hitBranch* живут в topoCanvasUtils, но внутри
// компонента используются его собственные обёртки (учитывают толщину линии и
// масштаб), поэтому здесь импортируются только общие константы и fmtR.
import { EMPTY_SET, EMPTY_ARRAY, fmtR } from "@/components/cad/topoCanvas/topoCanvasUtils";
import { ViewCube, ScaleBar, PivotMarker } from "@/components/cad/topoCanvas/TopoCanvasHud";
import { TopoCanvasIndicators, TopoCanvasHints } from "@/components/cad/topoCanvas/TopoCanvasStatus";
import { usePrintLayers } from "@/components/cad/topoCanvas/TopoCanvasPrintLayers";
import TopoCanvasSymbolsOverlay from "@/components/cad/topoCanvas/TopoCanvasSymbolsOverlay";
import { useViewEffects } from "@/components/cad/topoCanvas/TopoCanvasViewEffects";

export type { CadTool, FlowDisplayMode } from "@/components/cad/topoCanvas/topoCanvasTypes";

export default function TopoCanvas(props: Props) {
  const {
    nodes, branches, selectedNodeId, selectedBranchId, tool,
    onNodeAdd, onNodeMove, onNodeDragStart, onBranchAdd, onSplitBranchAt, onSelectNode, onSelectBranch, zLevel,
    viewPreset, onViewChange, flowDisplay = "off", animSpeed = 1, workPlane,
    horizons, highlightHorizonId = null, branchWidth = 2.5, branchBorder = 0, thinLines = false, fixedObjectScale = false, canvasThreshold = CANVAS_THRESHOLD, scaleLimits,
    bulkheadScale = 150,
    fanScale = 450,
    colorByHorizon = false, showFlowArrows = false,
    scaleOverride, onScaleChange, fitToScreenNonce,
    focusNonce, focusNodeId, focusBranchId, focusPos,
    editingHorizonImageId, onHorizonImageBoundsChange,
    editingPrintLayerId, onPrintLayerBoundsChange, onPrintLayerChange,
    onNodeContextMenu, onBranchContextMenu, onCanvasContextMenu,
    selectedBranchIds, onBranchMultiSelect,
    selectedNodeIds, onNodeMultiSelect,
    infoConfig, zScale = 1, xyScale = 1, nodeLodThresholds,
    schemaSymbols = [], onSelectSymbol, selectedSymbolId, onSymbolMove,
    onSymbolMoveAlongBranch, onSymbolOffset, onSymbolIndOffset, onSymbolMsIndOffset, onSymbolFanIndOffset, onSymbolDragStart, onSymbolClick, onSymbolDblClick,
    selectedSymbolIds, onSymbolMultiSelect,
    onSymbolScale, onSymbolDelete,
    activeSymbolTypeId, onSymbolPlace,
    pendingSymbolTypeId, onPendingSymbolPlace,
    restoreView, onRestoreViewDone, onViewStateChange,
    unitsConfig = DEFAULT_UNITS_CONFIG,
    onBranchLabelOffset,
    onRegisterGetSvg,
    onRegisterCanvasEl,
    onRegisterSvgEl,
    positionPlaceMode = false,
    onPositionPlace,
    branchBindMode = false,
    branchPositionColors,
    posInnerColors,
    posOuterColors,
    waterNodeResults,
    waterBranchResults,
    branchFireColors,
    branchExplosionColors,
    reversedBranchIds,
    rescuePathBranchIds,
    rescuePathBranchDirs,
    rescuePathNodeIds,
    rescueNodeLetters,
    onRescueNodePick,
    onRescueBranchPick,
    rescuePickMode,
    colorMode = "none",
    sectionColors,
    flowColorMin = 0,
    flowColorMax = 75,
    flowColorHue = "red",
    velColorMin = 0,
    velColorMax = 15,
    velColorHue = "blue",
    compareBranchColors,
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasExportRef = useRef<(() => string) | null>(null);

  // WebView2-fix: e.ctrlKey на mouse events ненадёжен при русской раскладке —
  // отслеживаем состояние Ctrl/Meta через отдельный ref на keydown/keyup
  const ctrlPressedRef = useRef(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") ctrlPressedRef.current = true; };
    const onUp   = (e: KeyboardEvent) => { if (e.key === "Control" || e.key === "Meta") ctrlPressedRef.current = false; };
    const onBlur = () => { ctrlPressedRef.current = false; };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup",   onUp);
    window.addEventListener("blur",    onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup",   onUp);
      window.removeEventListener("blur",    onBlur);
    };
  }, []);

  // Регистрируем функцию получения содержимого для печати (SVG или Canvas PNG)
  useEffect(() => {
    if (!onRegisterGetSvg) return;
    onRegisterGetSvg(() => {
      if (canvasExportRef.current) return canvasExportRef.current();
      return svgRef.current?.outerHTML ?? "";
    });
  }, [onRegisterGetSvg]);

  // Регистрируем прямой доступ к SVG DOM элементу через callback ref
  // (useEffect с svgRef.current — антипаттерн, ref меняется до useEffect)
  const svgCallbackRef = useCallback((el: SVGSVGElement | null) => {
    (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = el;
    onRegisterSvgEl?.(el);
   
  }, [onRegisterSvgEl]);

  // Карта горизонтов по id (для быстрых lookups)
  const horizonMap = useMemo(() => {
    const m = new Map<string, Horizon>();
    (horizons ?? []).forEach((h) => m.set(h.id, h));
    return m;
  }, [horizons]);

  // Цвет ЗАЛИВКИ ветви (без учёта выделения/утечки) — по той же логике, что в
  // canvasRenderer/SVG-рендере. Возвращает null, если ветвь белая (окраски нет),
  // чтобы не подкладывать бесполезную белую полосу под символы УО.
  const branchBodyColor = useCallback((b: TopoBranch): string | null => {
    const posInnerCol = posInnerColors?.get(b.id);
    if (posInnerCol) return posInnerCol;
    const horizonColor = b.horizonId ? horizonMap.get(b.horizonId)?.color : undefined;
    if (colorByHorizon && horizonColor) return horizonColor;
    const Q = Math.abs(b.flow);
    if (colorMode === "flowQ") return flowQColorFn(Q, flowColorMin, flowColorMax, flowColorHue);
    if (colorMode === "velocityV") return flowQColorFn(b.velocity, velColorMin, velColorMax, velColorHue);
    if (colorMode === "section") return SECTION_KIND_COLORS[sectionKind(b)];
    // Участки рудника: выработки вне участков остаются без заливки.
    if (colorMode === "ventsection") return sectionColors?.get(b.id) ?? null;
    if (colorMode === "none") return null;
    if (Q > 0) return velocityColorFn(b.velocity);
    return null;
  }, [posInnerColors, horizonMap, colorByHorizon, colorMode, sectionColors, flowColorMin, flowColorMax, flowColorHue, velColorMin, velColorMax, velColorHue]);

  // Видимые ветви: если горизонт привязан и скрыт — фильтруем
  const visibleBranches = useMemo(() => branches.filter((b) => {
    if (!b.horizonId) return true;
    const h = horizonMap.get(b.horizonId);
    return !h || h.visible;
  }), [branches, horizonMap]);

  // Множество ID скрытых ветвей (по горизонту) — для фильтрации узлов и УО
  const hiddenBranchIds = useMemo(() => new Set(
    branches
      .filter((b) => {
        if (!b.horizonId) return false;
        const h = horizonMap.get(b.horizonId);
        return h && !h.visible;
      })
      .map((b) => b.id)
  ), [branches, horizonMap]);

  // Карта узел→ветви: строим один раз при изменении branches (O(M)), а не при каждой фильтрации (O(N×M))
  const nodeBranchesMap = useMemo(() => {
    const m = new Map<string, TopoBranch[]>();
    for (const b of branches) {
      if (!m.has(b.fromId)) m.set(b.fromId, []);
      if (!m.has(b.toId))   m.set(b.toId,   []);
      m.get(b.fromId)!.push(b);
      m.get(b.toId)!.push(b);
    }
    return m;
  }, [branches]);

  // Узел скрыт, если ВСЕ его ветви принадлежат скрытым горизонтам — O(N) вместо O(N×M)
  const hiddenNodeIds = useMemo(() => new Set(
    nodes
      .filter((n) => {
        const nb = nodeBranchesMap.get(n.id);
        if (!nb || nb.length === 0) return false;
        return nb.every((b) => hiddenBranchIds.has(b.id));
      })
      .map((n) => n.id)
  ), [nodes, nodeBranchesMap, hiddenBranchIds]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Видовые параметры (panning + zoom + rotate)
  const [view, setView] = useState<ViewState>({
    scale: 0.4, offsetX: 400, offsetY: 300,
    azimuth: 0, elevation: 90,    // план по умолчанию
  });
  // Ref для синхронного чтения view внутри нативных event listeners (обходим stale closure)
  const viewRef = useRef<ViewState>({ scale: 0.4, offsetX: 400, offsetY: 300, azimuth: 0, elevation: 90 });

  const is3D = view.elevation < 89.5 || view.azimuth !== 0;

  const [panStart, setPanStart] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [rotStart, setRotStart] = useState<{
    x: number; y: number; az: number; el: number;
    ox: number; oy: number;
    pivot: { x: number; y: number; z: number };
    pivotScreen: { sx: number; sy: number };
  } | null>(null);
  const touchRef = useRef<{ x: number; y: number; ox: number; oy: number; dist?: number; scale?: number } | null>(null);
  // Зум: ref для синхронного применения без батчинга
  const wheelAccRef = useRef<{ acc: number; px: number; py: number; rafId: number | null }>({ acc: 0, px: 0, py: 0, rafId: null });
  // Флаг «идёт зум колёсиком»: на время зума замораживаем тяжёлый слой УО.
  const [isZooming, setIsZooming] = useState(false);
  const zoomStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symTouchRef = useRef<{ x: number; y: number } | null>(null);
  // Для определения двойного клика по УО
  const symLastClickRef = useRef<{ id: string; time: number } | null>(null);
  const [draggingSymbolId, setDraggingSymbolId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<{ id: string; plane: WorkPlane; dsx: number; dsy: number } | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverBranchId, setHoverBranchId] = useState<string | null>(null);
  // Курсор наведён на подпись ветви в canvas-режиме (для cursor: grab).
  const [hoverBranchLabel, setHoverBranchLabel] = useState(false);
  const [hoverScreenPos, setHoverScreenPos] = useState<{ sx: number; sy: number } | null>(null);

  // Перетаскивание угла подложки горизонта: какой именно угол тащим.
  const [draggingCorner, setDraggingCorner] = useState<
    { horizonId: string; corner: "tl" | "tr" | "bl" | "br"; shiftLocked: boolean; origBounds: { x1: number; y1: number; x2: number; y2: number } } | null
  >(null);
  // Перетаскивание тела подложки горизонта (перемещение целиком)
  const [draggingImageBody, setDraggingImageBody] = useState<
    { horizonId: string; startWx: number; startWy: number; startBounds: { x1: number; y1: number; x2: number; y2: number } } | null
  >(null);
  // Перетаскивание рамки слоя печати: corner = угол, "move" = всё тело рамки.
  const [draggingPrintCorner, setDraggingPrintCorner] = useState<
    { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: { x1: number; y1: number; x2: number; y2: number } } | null
  >(null);
  // Перетаскивание заголовка слоя печати
  const [draggingPrintTitle, setDraggingPrintTitle] = useState<
    { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number; pxPerMm: number } | null
  >(null);
  // Редактирование заголовка слоя печати
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");
  // Инлайн-редактирование ячейки штампа: { horizonId, field, draft }
  const [editingStampCell, setEditingStampCell] = useState<
    { horizonId: string; field: string; draft: string } | null
  >(null);
  // Инлайн-редактирование ячейки блока УТВЕРЖДАЮ
  const [editingApproverCell, setEditingApproverCell] = useState<
    { horizonId: string; field: string; draft: string } | null
  >(null);

  // При смене инструмента сбрасываем «начало ветви» — иначе возникнут призрачные сегменты.
  useEffect(() => { setBranchFrom(null); }, [tool]);

  // ─── ВОССТАНОВЛЕНИЕ СОХРАНЁННОГО ВИДА ───────────────────────────────
  // restoredViewNonce: когда view восстановлен из файла — блокируем fitToScreen на 5 сек
  const restoredViewNonce = useRef<number>(0);
  useEffect(() => {
    if (!restoreView) return;
    const restoredScale = restoreView.scale ?? 0.4;
    // Если сохранённый масштаб слишком мал — возможно файл открывается с другим xyScale
    // или координаты схемы изменились. В этом случае НЕ блокируем fitToScreen.
    // Порог: если scale < 0.001 — схема будет субпиксельной, лучше сделать fit.
    const scaleIsUsable = restoredScale >= 0.001;
    if (scaleIsUsable) {
      // Устанавливаем nonce НЕМЕДЛЕННО чтобы заблокировать любые fitToScreen
      restoredViewNonce.current = Date.now();
    }
    setView((v) => ({
      scale: restoredScale,
      offsetX: restoreView.offsetX ?? v.offsetX,
      offsetY: restoreView.offsetY ?? v.offsetY,
      azimuth: restoreView.azimuth ?? v.azimuth,
      elevation: restoreView.elevation ?? v.elevation,
    }));
    onRestoreViewDone?.();
    // Дополнительно сбрасываем fitAfterPreset — при восстановлении вида fit не нужен
    fitAfterPresetRef.current = false;
  }, [restoreView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Синхронизируем viewRef — всегда актуальное значение для нативных listeners
  useEffect(() => { viewRef.current = view; });

  // ─── РЕПОРТИНГ ТЕКУЩЕГО ВИДА НАРУЖУ (для сохранения) ────────────────
  useEffect(() => {
    onViewStateChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale, view.offsetX, view.offsetY, view.azimuth, view.elevation]);

  // ─── Эффекты вида ────────────────────────────────────────────────────────
  // Вынесены в topoCanvas/TopoCanvasViewEffects (перенос 1:1): компенсация
  // сдвига камеры при смене масштабов XY/Z, применение внешнего масштаба,
  // «вписать в экран» и переход к выбранному объекту.
  const { nodesRef, prevScaleOverride } = useViewEffects({
    nodes, branches, xyScale, zScale, size, view, setView,
    scaleOverride, fitToScreenNonce, focusNonce, focusNodeId, focusBranchId, focusPos,
    restoredViewNonce,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Нативный wheel-listener (как в Вентиляция 2.0 / АэроСеть):
  //   Обычное колесо    → зум к курсору
  //   Shift+колесо      → панорама по горизонтали
  //   Ctrl+колесо       → панорама по вертикали
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Помечаем «идёт зум» и планируем снятие флага через паузу после последнего
      // события колеса — на это время слой УО не перерисовывается (плавный зум).
      setIsZooming(true);
      if (zoomStopTimerRef.current) clearTimeout(zoomStopTimerRef.current);
      zoomStopTimerRef.current = setTimeout(() => setIsZooming(false), 200);

      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Нормализуем дельту: deltaMode 0=px, 1=lines, 2=pages
      const rawY = e.deltaY;
      const rawX = e.deltaX;
      const normY = e.deltaMode === 1 ? rawY * 18 : e.deltaMode === 2 ? rawY * 400 : rawY;
      const normX = e.deltaMode === 1 ? rawX * 18 : e.deltaMode === 2 ? rawX * 400 : rawX;

      const v = viewRef.current;

      if (e.shiftKey) {
        // ── ПАНОРАМА ПО ГОРИЗОНТАЛИ (Shift+колесо) ───────────────────
        const pan = Math.max(-200, Math.min(200, normY + normX));
        const newView: ViewState = { ...v, offsetX: v.offsetX - pan };
        viewRef.current = newView;
        setView(newView);
      } else if (e.ctrlKey || e.metaKey) {
        // ── ПАНОРАМА ПО ВЕРТИКАЛИ (Ctrl+колесо) ──────────────────────
        const panY = Math.max(-200, Math.min(200, normY));
        const panX = Math.max(-200, Math.min(200, normX));
        const newView: ViewState = { ...v, offsetX: v.offsetX - panX, offsetY: v.offsetY - panY };
        viewRef.current = newView;
        setView(newView);
      } else {
        // ── ЗУМ К КУРСОРУ (обычное колесо — как в Вентиляция 2.0 / АэроСеть) ──
        const capped = Math.max(-150, Math.min(150, normY));
        const factor = Math.pow(0.998, capped);
        const newScale = Math.max(0.0005, Math.min(5000, v.scale * factor));
        if (newScale === v.scale) return;
        const wx = (px - v.offsetX) / v.scale;
        const wy = (py - v.offsetY) / v.scale;
        const newView: ViewState = {
          ...v,
          scale: newScale,
          offsetX: px - wx * newScale,
          offsetY: py - wy * newScale,
        };
        viewRef.current = newView;
        setView(newView);
      }
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (zoomStopTimerRef.current) clearTimeout(zoomStopTimerRef.current);
    };
  }, []);

  // Refs для touch hit-test — заполняются ниже после объявления projNodes/projNodesMap
  const touchHitRef = useRef<{
    projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[];
    projNodesMap: Map<string, { node: TopoNode; sx: number; sy: number; depth: number }>;
    branches: TopoBranch[];
    onSelectNode: typeof onSelectNode;
    onSelectBranch: typeof onSelectBranch;
    onScaleChange?: typeof onScaleChange;
    view: { scale: number };
    xyScale: number;
    branchWidth: number;
  } | null>(null);

  // Флаг: после применения пресета вписать схему в экран
  const fitAfterPresetRef = useRef(false);

  // Применение пресета ракурса извне
  useEffect(() => {
    if (!viewPreset) return;
    const p = VIEW_PRESETS[viewPreset.name];
    // Авто-fit только если вид не был восстановлен из файла недавно (5 сек)
    const timeSinceRestore = Date.now() - restoredViewNonce.current;
    if (timeSinceRestore > 5000) {
      fitAfterPresetRef.current = true;
    }
    setView((v) => ({ ...v, azimuth: p.azimuth, elevation: p.elevation }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPreset?.nonce]);

  // Когда угол изменился после пресета — вписываем в экран
  useEffect(() => {
    if (!fitAfterPresetRef.current) return;
    fitAfterPresetRef.current = false;
    if (nodes.length === 0 || size.w < 50 || size.h < 50) return;
    const tmpProj: ProjOptions = {
      scale: 1, offsetX: 0, offsetY: 0,
      azimuth: view.azimuth, elevation: view.elevation, zScale,
    };
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    nodes.forEach((n) => {
      const p = project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, tmpProj);
      if (p.sx < minSx) minSx = p.sx;
      if (p.sx > maxSx) maxSx = p.sx;
      if (p.sy < minSy) minSy = p.sy;
      if (p.sy > maxSy) maxSy = p.sy;
    });
    const dw = Math.max(1, maxSx - minSx);
    const dh = Math.max(1, maxSy - minSy);
    const pad = 0.1;
    const newScale = Math.max(0.002, Math.min(500, Math.min(
      (size.w * (1 - pad * 2)) / dw,
      (size.h * (1 - pad * 2)) / dh,
    )));
    const csx = (minSx + maxSx) / 2;
    const csy = (minSy + maxSy) / 2;
    setView((v) => ({
      ...v,
      scale: newScale,
      offsetX: size.w / 2 - csx * newScale,
      offsetY: size.h / 2 - csy * newScale,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.azimuth, view.elevation]);

  // Сообщить наверх об изменении вида
  useEffect(() => {
    onViewChange?.({
      is3D: view.elevation < 89.5 || view.azimuth !== 0,
      azimuth: view.azimuth,
      elevation: view.elevation,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.azimuth, view.elevation]);

  const proj: ProjOptions = useMemo(() => ({
    scale: view.scale,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    azimuth: view.azimuth,
    elevation: view.elevation,
    zScale,
  }), [view.scale, view.offsetX, view.offsetY, view.azimuth, view.elevation, zScale]);

  // xyScale и zScale применяем к координатам перед проекцией
  const projectWithZ = useCallback((p: { x: number; y: number; z: number }) =>
    project3D({ x: p.x * (xyScale ?? 1), y: p.y * (xyScale ?? 1), z: p.z * (zScale ?? 1) }, proj),
  [proj, zScale, xyScale]);

  // ── БЫСТРАЯ ПАНОРАМА ──────────────────────────────────────────────────────
  // Экранная координата узла: sx = offsetX + bx, sy = offsetY + by, где
  // bx = x1·scale, by = -y2·scale, depth — НЕ зависят от смещения (offset).
  // Тяжёлую тригонометрию (project3D) считаем ТОЛЬКО при смене масштаба/ракурса/
  // координат — но НЕ при перетаскивании. При pan меняется лишь offset, поэтому
  // достаточно прибавить его к закешированным bx/by (2 сложения на узел).
  const projBase = useMemo(() => {
    const arr = new Array<{ node: TopoNode; bx: number; by: number; depth: number }>(nodes.length);
    // Проекция без смещения: считаем в системе offset=0.
    const opts: ProjOptions = { scale: view.scale, offsetX: 0, offsetY: 0, azimuth: view.azimuth, elevation: view.elevation, zScale };
    const kx = xyScale ?? 1, kz = zScale ?? 1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const p = project3D({ x: n.x * kx, y: n.y * kx, z: n.z * kz }, opts);
      arr[i] = { node: n, bx: p.sx, by: p.sy, depth: p.depth };
    }
    return arr;
    // Намеренно НЕ зависим от offsetX/offsetY — иначе кэш сбрасывался бы на каждый pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, view.scale, view.azimuth, view.elevation, zScale, xyScale]);

  // Проекции всех узлов с учётом смещения. При pan пересчитывается только этот
  // лёгкий цикл (без тригонометрии) — projBase остаётся закешированным.
  const projNodes = useMemo(
    () => projBase.map((p) => ({ node: p.node, sx: view.offsetX + p.bx, sy: view.offsetY + p.by, depth: p.depth })),
    [projBase, view.offsetX, view.offsetY]
  );

  // Map для O(1) lookup по ID узла (вместо O(n) find внутри рендера)
  const projNodesMap = useMemo(() => {
    const m = new Map<string, { node: typeof projNodes[0]["node"]; sx: number; sy: number; depth: number }>();
    for (const p of projNodes) m.set(p.node.id, p);
    return m;
  }, [projNodes]);

  // Эпоха порядка глубины: увеличивается только когда меняется projBase
  // (масштаб/ракурс/координаты), но НЕ при перетаскивании (offset). Передаётся в
  // renderCanvas, чтобы при pan пропускать повторную сортировку 13000+ ветвей/узлов.
  const sortEpochRef = useRef(0);
  const sortEpoch = useMemo(() => ++sortEpochRef.current, [projBase]);

  // ── Загрязнённые ветви (ниже по потоку от ветвей с pollutesAir=true) ───
  // BFS/DFS по графу в направлении движения воздуха (flow > 0: from→to, flow < 0: to→from).
  // Включает сами «источники загрязнения» (pollutesAir=true) и все ветви ниже по потоку.
  const pollutedBranchIds = useMemo((): Set<string> => {
    // Если нет ни одной ветви-источника — пустой Set (ранний выход)
    const sources = branches.filter(b => b.pollutesAir);
    if (sources.length === 0) return new Set();

    // adjacency: для каждого узла — список ветвей, исходящих ИЗ него по потоку
    // (если flow > 0: from→to; если flow < 0: to→from)
    const outEdges = new Map<string, string[]>(); // nodeId → [branchId, ...]
    for (const b of branches) {
      const fromNode = b.flow >= 0 ? b.fromId : b.toId;
      const toNode   = b.flow >= 0 ? b.toId   : b.fromId;
      if (!outEdges.has(fromNode)) outEdges.set(fromNode, []);
      outEdges.get(fromNode)!.push(b.id);
      // Убедимся что toNode есть в карте (даже без исходящих рёбер)
      if (!outEdges.has(toNode)) outEdges.set(toNode, []);
    }
    // Карта: branchId → toNode (выходной узел по направлению потока)
    const branchToNode = new Map<string, string>();
    for (const b of branches) {
      branchToNode.set(b.id, b.flow >= 0 ? b.toId : b.fromId);
    }

    const visited = new Set<string>();
    const queue: string[] = []; // nodeId

    for (const src of sources) {
      visited.add(src.id);
      // Начинаем обход с выходного узла ветви-источника
      const exitNode = src.flow >= 0 ? src.toId : src.fromId;
      queue.push(exitNode);
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const edges = outEdges.get(nodeId) ?? [];
      for (const bId of edges) {
        if (!visited.has(bId)) {
          visited.add(bId);
          const nextNode = branchToNode.get(bId);
          if (nextNode) queue.push(nextNode);
        }
      }
    }

    return visited;
  }, [branches]);

  // Обновляем ref для touch hit-test (всегда актуальные данные без пересоздания listeners)
  touchHitRef.current = { projNodes, projNodesMap, branches, onSelectNode, onSelectBranch, onScaleChange, view, xyScale: xyScale ?? 1, branchWidth: branchWidth ?? 2.5 };

  // Нативные touch-listeners на SVG с {passive:false}
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ts = (e: TouchEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchRef.current = { x: t.clientX - rect.left, y: t.clientY - rect.top, ox: viewRef.current.offsetX, oy: viewRef.current.offsetY };
      } else if (e.touches.length === 2) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const cx = (t1.clientX + t2.clientX) / 2 - rect.left;
        const cy = (t1.clientY + t2.clientY) / 2 - rect.top;
        touchRef.current = { x: cx, y: cy, ox: viewRef.current.offsetX, oy: viewRef.current.offsetY, dist, scale: viewRef.current.scale };
      }
    };
    const tm = (e: TouchEvent) => {
      e.preventDefault();
      if (!touchRef.current) return;
      const rect = svg.getBoundingClientRect();
      if (e.touches.length === 1 && touchRef.current.dist === undefined) {
        const t = e.touches[0];
        const dx = (t.clientX - rect.left) - touchRef.current.x;
        const dy = (t.clientY - rect.top)  - touchRef.current.y;
        const newView = { ...viewRef.current, offsetX: touchRef.current.ox + dx, offsetY: touchRef.current.oy + dy };
        viewRef.current = newView;
        setView(newView);
      } else if (e.touches.length === 2 && touchRef.current.dist !== undefined) {
        const t1 = e.touches[0], t2 = e.touches[1];
        const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const rawFactor = newDist / touchRef.current.dist;
        const factor = Math.max(0.85, Math.min(1.18, rawFactor));
        const cx = touchRef.current.x, cy = touchRef.current.y;
        const baseScale = touchRef.current.scale!;
        const baseOx = touchRef.current.ox, baseOy = touchRef.current.oy;
        const newScale = Math.max(0.0005, Math.min(5000, baseScale * factor));
        const wx = (cx - baseOx) / baseScale, wy = (cy - baseOy) / baseScale;
        const newView = { ...viewRef.current, scale: newScale, offsetX: cx - wx * newScale, offsetY: cy - wy * newScale };
        viewRef.current = newView;
        prevScaleOverride.current = newScale;
        setView(newView);
        if (touchHitRef.current?.onScaleChange) touchHitRef.current.onScaleChange(newScale);
      }
    };
    const te = (e: TouchEvent) => {
      e.preventDefault();
      if (e.changedTouches.length === 1 && touchRef.current && touchRef.current.dist === undefined) {
        const t = e.changedTouches[0];
        const rect = svg.getBoundingClientRect();
        const sx = t.clientX - rect.left, sy = t.clientY - rect.top;
        const moved = Math.hypot(sx - touchRef.current.x, sy - touchRef.current.y);
        if (moved < 10 && touchHitRef.current) {
          const { projNodes: pn, projNodesMap: pnm, branches: br, onSelectNode: selN, onSelectBranch: selB, view: v, xyScale: xys, branchWidth: bw } = touchHitRef.current;
          const xySF = Math.max(1, xys ?? 1);
          const sf = Math.min(8, Math.max(0.25, v.scale / (xySF * 0.4)));
          const nodeR = Math.max(16, bw * sf * 0.55);
          const lineW = Math.max(1, bw * sf);
          const branchTol = Math.max(14, lineW / 2 + 6);
          const hitN = hitNodeCanvas(sx, sy, pn, nodeR);
          const hitB = !hitN ? hitBranchCanvas(sx, sy, pnm, br, branchTol) : null;
          if (hitN) { selN(hitN); selB(null); }
          else if (hitB) { selB(hitB); selN(null); }
          else { selN(null); selB(null); }
        }
      }
      if (e.touches.length === 0) touchRef.current = null;
    };
    svg.addEventListener("touchstart",  ts, { passive: false });
    svg.addEventListener("touchmove",   tm, { passive: false });
    svg.addEventListener("touchend",    te, { passive: false });
    svg.addEventListener("touchcancel", te, { passive: false });
    return () => {
      svg.removeEventListener("touchstart",  ts);
      svg.removeEventListener("touchmove",   tm);
      svg.removeEventListener("touchend",    te);
      svg.removeEventListener("touchcancel", te);
    };
   
  }, []);

  // Аналогичные нативные touch для Canvas (когда включён canvas-режим)
  // регистрируются в CanvasLayer через тот же подход

  // Применить пресет ракурса
  // При смене проекции пересчитываем offsetX/offsetY так, чтобы центроид схемы
  // остался в центре экрана — это гарантирует правильное положение OVERVIEW рамки.
  const applyPreset = useCallback((preset: ViewPreset) => {
    const p = VIEW_PRESETS[preset];
    setView((v) => {
      if (nodes.length === 0) return { ...v, azimuth: p.azimuth, elevation: p.elevation };
      // Вычисляем центроид схемы в мировых координатах
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const n of nodes) { sumX += n.x; sumY += n.y; sumZ += n.z; }
      const cx = sumX / nodes.length;
      const cy = sumY / nodes.length;
      const cz = sumZ / nodes.length;
      // Проецируем центроид в НОВОЙ проекции (без смещения — offsetX/Y=0)
      const newProjNoOffset = { scale: v.scale, offsetX: 0, offsetY: 0,
        azimuth: p.azimuth, elevation: p.elevation, zScale };
      const projected = project3D(
        { x: cx * (xyScale ?? 1), y: cy * (xyScale ?? 1), z: cz * (zScale ?? 1) },
        newProjNoOffset,
      );
      // Центрируем центроид в центре экрана
      const newOx = size.w / 2 - projected.sx;
      const newOy = size.h / 2 - projected.sy;
      return { ...v, azimuth: p.azimuth, elevation: p.elevation, offsetX: newOx, offsetY: newOy };
    });
  }, [nodes, size, xyScale, zScale]);

  // Эффективная рабочая плоскость: явно заданная пользователем либо подобранная по ракурсу
  const effPlane: WorkPlane = workPlane ?? autoWorkPlane(view.azimuth, view.elevation, {
    z: zLevel, y: 0, x: 0,
  });

  // Универсальная обратная проекция: screen → world (реальные координаты, без масштаба xyScale/zScale).
  // proj содержит offsetX/offsetY в масштабированном пространстве (×xyScale),
  // поэтому после unproject делим обратно на xyScale/zScale чтобы получить мировые координаты.
  const screenToWorld = useCallback((sx: number, sy: number, fixedZ?: number): { x: number; y: number; z: number } | null => {
    const xy = xyScale ?? 1;
    const zs = zScale ?? 1;
    if (!is3D) {
      const w = unproject2D(sx, sy, proj, (fixedZ ?? zLevel) * zs);
      return { x: w.x / xy, y: w.y / xy, z: w.z / zs };
    }
    // В 3D — пересечение луча с рабочей плоскостью (плоскость задана в масштабированных координатах)
    const plane: WorkPlane = fixedZ !== undefined
      ? { axis: "z", value: fixedZ * zs }
      : { ...effPlane, value: effPlane.value * (effPlane.axis === "z" ? zs : xy) };
    const w = unprojectToPlane(sx, sy, proj, plane);
    if (!w) return null;
    return { x: w.x / xy, y: w.y / xy, z: w.z / zs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, zLevel, is3D, effPlane.axis, effPlane.value, xyScale, zScale]);

  // ─── Hit-тесты ─────────────────────────────────────────────────────────
  // objSF считается так же, как в canvasRenderer: scale / (xyScale * 0.4),
  // зажат между 0.25 и 8. Это даёт реальный пиксельный размер объектов.
  const _xySF = Math.max(1, xyScale ?? 1);
  const _objSF = Math.min(8, Math.max(0.25, view.scale / (_xySF * 0.4)));

  // Итоговый масштаб толщины ВЕТВИ — В ТОЧНОСТИ как при отрисовке ветвей.
  // Перемычки используют этот коэффициент, чтобы масштабироваться синхронно с
  // шириной ветви (в т.ч. НЕ уменьшаться при приближении в фиксированном режиме).
  // ВАЖНО: SVG- и Canvas-рендеры считают ширину ветви в фикс.режиме по-разному:
  //  • SVG (≤ порога): rawObjSF = 1 (полностью фиксировано);
  //  • Canvas (> порога, canvasRenderer): rawObjSF = scale/(xyScale*0.4) с зажимом.
  // Поэтому выбираем формулу под активный режим отрисовки.
  const _useCanvasRender = visibleBranches.length > canvasThreshold;
  const _rawBranchSF = (fixedObjectScale && !_useCanvasRender)
    ? 1
    : (view.scale / (_xySF * 0.4));
  const _branchObjSF = fixedObjectScale && scaleLimits
    ? Math.min(scaleLimits.branchMax / 100, Math.max(scaleLimits.branchMin / 100, _rawBranchSF))
    : Math.max(0.25, _rawBranchSF);

  // Коэффициент масштаба ИНДИКАТОРОВ перемычек/замерных станций при зуме.
  // В фиксированном режиме толщина ветви (_branchObjSF) не уменьшается ниже
  // scaleLimits.branchMin, из-за чего индикаторы «упирались» в минимум и
  // переставали уменьшаться при отдалении, наезжая на схему.
  // Индикаторы должны сжиматься как ВЕТВИ — т.е. следовать за view.scale.
  // Поэтому ниже опорного масштаба (_xySF * 0.4, при котором objSF=1)
  // дополнительно домножаем на view.scale/опорный, чтобы уменьшались вместе
  // с геометрией схемы. Выше опорного — коэффициент 1 (не раздуваем).
  const _indZoomRef = _xySF * 0.4;
  const _indZoomSF = view.scale < _indZoomRef ? view.scale / _indZoomRef : 1;

  // Радиус попадания в узел — пропорционален реальному размеру, минимум 8px
  const hitNodeR = (sx: number, sy: number, pn: typeof projNodes, extraR = 0) => {
    const baseW = branchWidth ?? 2.5;
    const nodeR = Math.max(8, baseW * _objSF * 0.55) + extraR;
    return hitNodeCanvas(sx, sy, pn, nodeR);
  };

  // Толерантность попадания в ветвь:
  // - берём реальную толщину линии в пикселях (baseW * _objSF)
  // - добавляем фиксированный бонус 8px чтобы ловить даже субпиксельные ветви
  // - итоговый минимум 18px — независимо от масштаба (легче попадать без зума)
  const hitBranchR = (sx: number, sy: number, pnm: typeof projNodesMap, br: typeof branches, extraTol = 0) => {
    const baseW = branchWidth ?? 2.5;
    const lineW = Math.max(1, baseW * _objSF);   // реальная толщина линии в px
    const tol = Math.max(18, lineW / 2 + 8) + extraTol;
    return hitBranchCanvas(sx, sy, pnm, br, tol);
  };

  const hitNode   = (sx: number, sy: number, pn: typeof projNodes)                            => hitNodeR(sx, sy, pn);
  const hitBranch = (sx: number, sy: number, pnm: typeof projNodesMap, br: typeof branches)   => hitBranchR(sx, sy, pnm, br);

  // ─── Контекстное меню по правой кнопке ─────────────────────────────────
  const onContextMenuSVG = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = (containerRef.current ?? e.currentTarget as Element).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hitN = hitNode(sx, sy, projNodes);
    if (hitN) {
      // При правом клике НЕ сбрасываем мультивыбор — передаём только контекстное меню.
      // onSelectNode сбросил бы selectedNodeIds, поэтому вызываем его только если узел ещё не выбран.
      if (!selectedNodeIds?.has(hitN)) {
        onSelectNode(hitN);
        onSelectBranch(null);
      }
      onNodeContextMenu?.(hitN, e.clientX, e.clientY);
      return;
    }
    const hitB = hitBranch(sx, sy, projNodesMap, branches);
    if (hitB) {
      // При правом клике НЕ сбрасываем мультивыбор ветвей — если ветвь уже
      // выделена, оставляем весь Set (иначе, например, вентрубопровод строился
      // бы по одной ветви вместо выбранного маршрута). onSelectBranch сбросил бы
      // selectedBranchIds, поэтому вызываем его только если ветвь ещё не выбрана.
      if (!selectedBranchIds?.has(hitB)) {
        onSelectBranch(hitB);
        onSelectNode(null);
      }
      onBranchContextMenu?.(hitB, e.clientX, e.clientY);
      return;
    }
    onCanvasContextMenu?.(e.clientX, e.clientY);
  };

  // Вычисление центра схемы (pivot) и его экранной проекции — для orbit-вращения.
  // Если узлов нет, fallback на (0,0,0). Это решает проблему: схема построена
  // далеко от 0,0,0 (например x=8890, y=16720), а вращение шло вокруг 0 —
  // теперь вращается вокруг геометрического центра.
  const computeRotPivot = () => {
    if (nodes.length === 0) {
      return {
        pivot: { x: 0, y: 0, z: 0 },
        pivotScreen: { sx: proj.offsetX, sy: proj.offsetY, depth: 0 },
      };
    }
    // Центроид схемы в «чистых» мировых координатах (без масштабов)
    let sx = 0, sy = 0, sz = 0;
    for (const n of nodes) {
      sx += n.x; sy += n.y; sz += n.z;
    }
    const cx = sx / nodes.length;
    const cy = sy / nodes.length;
    const cz = sz / nodes.length;
    // Проецируем через projectWithZ, которая корректно применяет xyScale и zScale
    const pivotScreen = project3D(
      { x: cx * (xyScale ?? 1), y: cy * (xyScale ?? 1), z: cz * (zScale ?? 1) },
      proj,
    );
    return {
      pivot: { x: cx, y: cy, z: cz },
      pivotScreen,
    };
  };

  // ─── Обработчики мыши ───────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Если клик внутри активной рамки слоя печати — не обрабатываем (дочерний <rect> уже обработал)
    if (editingPrintLayerId && (e.target as SVGElement).closest(`[data-printlayer]`)) return;
    // Правая кнопка или tool=rotate → вращение в 3D
    if (e.button === 2 || tool === "rotate") {
      const { pivot, pivotScreen } = computeRotPivot();
      setRotStart({
        x: e.clientX, y: e.clientY,
        az: view.azimuth, el: view.elevation,
        ox: view.offsetX, oy: view.offsetY,
        pivot, pivotScreen,
      });
      e.preventDefault();
      return;
    }
    // Средняя кнопка / Shift / tool=pan → панорама
    if (e.button === 1 || e.shiftKey || tool === "pan") {
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
      e.preventDefault();
      return;
    }

    // containerRef всегда отражает реальный размер/позицию холста —
    // используем его вместо e.currentTarget, чтобы корректно работать
    // и в SVG-режиме, и в Canvas-режиме (asS-cast меняет тип currentTarget)
    const rect = (containerRef.current ?? e.currentTarget as Element).getBoundingClientRect();

    // ─── РЕЖИМ РАЗМЕЩЕНИЯ МАРКЕРА ПОЗИЦИИ ──────────────────────────────
    if (positionPlaceMode && onPositionPlace && e.button === 0) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const w = screenToWorld(sx, sy);
      if (w) {
        // screenToWorld уже возвращает реальные мировые координаты (делённые на xyScale/zScale)
        onPositionPlace(w.x, w.y, w.z);
      }
      e.stopPropagation();
      return;
    }
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // ─── ПЕРЕТАСКИВАНИЕ ПОДПИСИ ВЕТВИ (canvas-режим) ──────────────────
    // В SVG подпись двигается своим onMouseDown. В canvas подписи рисуются
    // на холсте, поэтому ловим попадание курсора в bbox подписи (собранный
    // при отрисовке) и двигаем labelOffset так же, как в SVG. Проверяем ДО
    // hit-теста ветви/узла, чтобы подпись перетаскивалась поверх линий.
    if (useCanvas && onBranchLabelOffset && e.button === 0 && !branchBindMode
        && !pendingSymbolTypeId && !positionPlaceMode && !rescuePickMode) {
      const lblId = hitBranchLabelCanvas(sx, sy);
      if (lblId) {
        const lblBr = branchById.get(lblId);
        if (lblBr) {
          const divSF = Math.max(0.05, _branchObjSF);
          const startCX = e.clientX, startCY = e.clientY;
          const origOx = lblBr.labelOffsetX ?? 0;
          const origOy = lblBr.labelOffsetY ?? -16;
          if (!selectedBranchIds?.has(lblId)) { onSelectBranch(lblId); onSelectNode(null); }
          const onMove = (me: MouseEvent) => {
            onBranchLabelOffset(lblId, origOx + (me.clientX - startCX) / divSF, origOy + (me.clientY - startCY) / divSF);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          e.stopPropagation();
          return;
        }
      }
    }

    // ─── РЕЖИМ ВЫБОРА УЗЛА/ВЕТВИ ДЛЯ ГОРНОСПАСАТЕЛЕЙ (pick-mode) ──────
    // ВАЖНО: проверяем ДО early-return по [data-sym]. В canvas-режиме поверх
    // схемы лежит SVG-оверлей с символами УО (позиции ПЛА, отделения) — многие
    // узлы схемы визуально закрыты этими символами. Если сначала отсекать клики
    // по [data-sym], то в canvas-режиме по такому узлу невозможно попасть.
    // Поэтому в режиме pick сразу делаем hit-тест по узлам/ветвям схемы.
    if (rescuePickMode && e.button === 0) {
      const hitNp = hitNode(sx, sy, projNodes);
      if (hitNp && onRescueNodePick) {
        onRescueNodePick(hitNp);
        e.stopPropagation();
        return;
      }
      const hitBp = !hitNp ? hitBranch(sx, sy, projNodesMap, branches) : null;
      if (hitBp && onRescueBranchPick) {
        onRescueBranchPick(hitBp);
        e.stopPropagation();
        return;
      }
      // В режиме pick клик по пустому месту не должен вращать/сбрасывать —
      // просто игнорируем, оставаясь в режиме выбора.
      e.stopPropagation();
      return;
    }

    // Если клик произошёл внутри g[data-sym] — это символ УО, не трогаем ветвь/узел
    if ((e.target as Element).closest?.("[data-sym]")) return;

    const hitN = hitNode(sx, sy, projNodes);
    const hitB = !hitN ? hitBranch(sx, sy, projNodesMap, branches) : null;

    // ─── РЕЖИМ ПРИВЯЗКИ ВЕТВЕЙ К ПОЗИЦИИ (F3) ──────────────────────────
    if (branchBindMode && hitB) {
      onSelectBranch(hitB);
      e.stopPropagation();
      return;
    }

    // ─── РЕЖИМ «ОЖИДАНИЯ ПРИВЯЗКИ» (после Ctrl+V/Ctrl+D) — клик на ветвь ─
    if (pendingSymbolTypeId && onPendingSymbolPlace) {
      if (hitB) {
        // Вычисляем точную позицию t вдоль ветви
        const brHit = branches.find(b => b.id === hitB);
        const from = brHit ? projNodesMap.get(brHit.fromId) : null;
        const to   = brHit ? projNodesMap.get(brHit.toId)   : null;
        const fromN = from?.node;
        const toN   = to?.node;
        if (from && to && fromN && toN) {
          const C = to.sx - from.sx, D = to.sy - from.sy;
          const A = sx - from.sx,   B = sy - from.sy;
          const lenSq = C * C + D * D;
          const t = lenSq > 0 ? Math.max(0.05, Math.min(0.95, (A * C + B * D) / lenSq)) : 0.5;
          const wx = fromN.x + (toN.x - fromN.x) * t;
          const wy = fromN.y + (toN.y - fromN.y) * t;
          onPendingSymbolPlace(hitB, t, wx, wy);
        }
      }
      return;
    }

    // ─── ИНСТРУМЕНТ «СИМВОЛ» — клик на ветвь = размещает символ посередине ─
    if (tool === "symbol" && activeSymbolTypeId && onSymbolPlace) {
      if (hitB) {
        // Вычисляем точную позицию t вдоль ветви
        const brHit2 = branches.find(b => b.id === hitB);
        const from = brHit2 ? projNodesMap.get(brHit2.fromId) : null;
        const to   = brHit2 ? projNodesMap.get(brHit2.toId)   : null;
        const fromN = from?.node;
        const toN   = to?.node;
        if (from && to && fromN && toN) {
          const C = to.sx - from.sx, D = to.sy - from.sy;
          const A = sx - from.sx,   B = sy - from.sy;
          const lenSq = C * C + D * D;
          const t = lenSq > 0 ? Math.max(0.02, Math.min(0.98, (A * C + B * D) / lenSq)) : 0.5;
          const wx = fromN.x + (toN.x - fromN.x) * t;
          const wy = fromN.y + (toN.y - fromN.y) * t;
          onSymbolPlace(activeSymbolTypeId, wx, wy, hitB, t);
        }
      } else {
        // Клик на пустом месте — в мировых координатах
        const w = screenToWorld(sx, sy);
        if (w) onSymbolPlace(activeSymbolTypeId, Math.round(w.x), Math.round(w.y), null);
      }
      return;
    }

    // ─── ИНСТРУМЕНТ «УЗЕЛ» — непрерывный режим, snap к ветви = split ───
    if (tool === "node") {
      if (hitN) {
        // Кликнули по существующему узлу — выделяем, не создаём.
        onSelectNode(hitN);
        onSelectBranch(null);
        return;
      }
      if (hitB && onSplitBranchAt) {
        // Кликнули по ветви — разделяем её новым узлом в точке клика.
        const w = screenToWorld(sx, sy);
        if (!w) return;
        onSplitBranchAt(hitB, Math.round(w.x), Math.round(w.y), Math.round(w.z));
        return;
      }
      // Свободная точка — создаём новый узел.
      const w = screenToWorld(sx, sy);
      if (!w) return;
      onNodeAdd(Math.round(w.x), Math.round(w.y), Math.round(w.z));
      return;
    }

    // ─── ИНСТРУМЕНТ «ВЕТВЬ» — цепочка с промежуточными узлами ─────────
    if (tool === "branch") {
      if (hitN) {
        if (!branchFrom) {
          // Старт цепочки от существующего узла.
          setBranchFrom(hitN);
          onSelectNode(hitN);
          return;
        }
        if (branchFrom !== hitN) {
          // Закрываем сегмент на существующий узел и продолжаем цепочку от него.
          onBranchAdd(branchFrom, hitN);
          setBranchFrom(hitN);
          onSelectNode(hitN);
        }
        return;
      }
      if (hitB && onSplitBranchAt && branchFrom) {
        // Кликнули по чужой ветви, имея активную цепочку → сплит и продолжение.
        const w = screenToWorld(sx, sy);
        if (!w) return;
        const newNodeId = onSplitBranchAt(hitB, Math.round(w.x), Math.round(w.y), Math.round(w.z));
        if (typeof newNodeId === "string" && newNodeId && newNodeId !== branchFrom) {
          onBranchAdd(branchFrom, newNodeId);
          setBranchFrom(newNodeId);
          onSelectNode(newNodeId);
        }
        return;
      }
      // Свободная точка: если уже есть начало — создаём промежуточный узел и сегмент.
      const w = screenToWorld(sx, sy);
      if (!w) return;
      const newNodeId = onNodeAdd(Math.round(w.x), Math.round(w.y), Math.round(w.z));
      if (typeof newNodeId === "string" && newNodeId) {
        if (branchFrom) {
          onBranchAdd(branchFrom, newNodeId);
        }
        // Продолжаем цепочку от только что созданного узла.
        setBranchFrom(newNodeId);
        onSelectNode(newNodeId);
      }
      return;
    }

    // ─── ИНСТРУМЕНТ «ВЫБОР» (по умолчанию) ────────────────────────────
    if (hitN) {
      if ((e.ctrlKey || ctrlPressedRef.current) && onNodeMultiSelect) {
        onNodeMultiSelect(hitN);
      } else {
        onSelectNode(hitN);
        onSelectBranch(null);
        // Перетаскивание узла: и в 2D, и в 3D.
        const node = nodes.find((n) => n.id === hitN);
        if (node) {
          const xy = xyScale ?? 1;
          const zv = node.z * (zScale ?? 1);
          // plane.value должен быть в МАСШТАБИРОВАННЫХ координатах (как в proj)
          const plane: WorkPlane = !is3D
            ? { axis: "z", value: zv }
            : effPlane.axis === "z" ? { axis: "z", value: zv }
            : effPlane.axis === "y" ? { axis: "y", value: node.y * xy }
            : { axis: "x", value: node.x * xy };
          // Сохраняем смещение курсора от экранного центра узла,
          // чтобы при drag узел не прыгал к курсору
          const pn = projNodes.find((p) => p.node.id === hitN);
          const dsx = pn ? sx - pn.sx : 0;
          const dsy = pn ? sy - pn.sy : 0;
          // Снимок истории — ОДИН раз в начале перетаскивания. Раньше он писался
          // на каждое движение мыши внутри onNodeMove: это и тормозило схему, и
          // забивало стек undo (50 шагов уходили на один сдвиг узла).
          onNodeDragStart?.(hitN);
          setDraggingNode({ id: hitN, plane, dsx, dsy });
        }
      }
      return;
    }

    if (hitB) {
      if ((e.ctrlKey || ctrlPressedRef.current) && onBranchMultiSelect) {
        onBranchMultiSelect(hitB);
      } else {
        onSelectBranch(hitB);
        onSelectNode(null);
      }
      return;
    }

    if (!e.ctrlKey && !ctrlPressedRef.current) {
      onSelectNode(null);
      onSelectBranch(null);
    }
    setBranchFrom(null);
    // В режиме редактирования рамки — не начинаем pan/rotate (клик мог быть по рамке)
    if (editingPrintLayerId) return;
    // Свободный клик в 3D = вращение, в 2D = панорама
    if (is3D) {
      const { pivot, pivotScreen } = computeRotPivot();
      setRotStart({
        x: e.clientX, y: e.clientY,
        az: view.azimuth, el: view.elevation,
        ox: view.offsetX, oy: view.offsetY,
        pivot, pivotScreen,
      });
    } else {
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
    }
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (containerRef.current ?? e.currentTarget as Element).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // ── Drag рамки/угла слоя печати — обрабатываем ПЕРВЫМ, до pan/rotate ──
    if (draggingPrintCorner && onPrintLayerBoundsChange) {
      const hz = horizons?.find((hh) => hh.id === draggingPrintCorner.horizonId);
      if (hz && hz.printLayer) {
        const plane: WorkPlane = { axis: "z", value: hz.z };
        const wp2 = is3D ? unprojectToPlane(sx, sy, proj, plane) : unproject2D(sx, sy, proj, hz.z);
        if (wp2) {
          const sb = draggingPrintCorner.startBounds;
          const fmt2 = hz.printLayer.paperFormat ?? "A3";
          const ori2 = hz.printLayer.orientation ?? "landscape";
          const mm2 = PAPER_SIZES_MM[fmt2 as PaperFormat];
          const aspect2 = ori2 === "landscape" ? mm2.w / mm2.h : mm2.h / mm2.w;
          if (draggingPrintCorner.corner === "move") {
            const dx = wp2.x - draggingPrintCorner.startWx;
            const dy = wp2.y - draggingPrintCorner.startWy;
            onPrintLayerBoundsChange(hz.id, { x1: sb.x1 + dx, y1: sb.y1 + dy, x2: sb.x2 + dx, y2: sb.y2 + dy });
          } else {
            const b2 = { ...sb };
            switch (draggingPrintCorner.corner) {
              case "br": { const w2 = wp2.x - sb.x1; const nw2 = Math.max(Math.abs(sb.x2 - sb.x1) * 0.05, w2); b2.x2 = sb.x1 + nw2; b2.y1 = sb.y2 - nw2 / aspect2; break; }
              case "bl": { const w2 = sb.x2 - wp2.x; const nw2 = Math.max(Math.abs(sb.x2 - sb.x1) * 0.05, w2); b2.x1 = sb.x2 - nw2; b2.y1 = sb.y2 - nw2 / aspect2; break; }
              case "tr": { const w2 = wp2.x - sb.x1; const nw2 = Math.max(Math.abs(sb.x2 - sb.x1) * 0.05, w2); b2.x2 = sb.x1 + nw2; b2.y2 = sb.y1 + nw2 / aspect2; break; }
              case "tl": { const w2 = sb.x2 - wp2.x; const nw2 = Math.max(Math.abs(sb.x2 - sb.x1) * 0.05, w2); b2.x1 = sb.x2 - nw2; b2.y2 = sb.y1 + nw2 / aspect2; break; }
            }
            onPrintLayerBoundsChange(hz.id, b2);
          }
        }
      }
      return;
    }
    // ── Drag заголовка слоя печати — тоже до pan ──
    if (draggingPrintTitle && onPrintLayerChange) {
      // Смещение заголовка хранится в ММ листа → делим пиксельную дельту
      // на pxPerMm, чтобы блок масштабировался вместе с листом и не убегал.
      const pxmm = draggingPrintTitle.pxPerMm || 1;
      const dx = (sx - draggingPrintTitle.startSx) / pxmm;
      const dy = (sy - draggingPrintTitle.startSy) / pxmm;
      onPrintLayerChange(draggingPrintTitle.horizonId, {
        titleOffsetX: draggingPrintTitle.startOffX + dx,
        titleOffsetY: draggingPrintTitle.startOffY + dy,
      });
      return;
    }

    // hover-позиция: показываем мировые координаты в текущей рабочей плоскости
    const w = screenToWorld(sx, sy);
    if (w) setHoverPos({ x: Math.round(w.x), y: Math.round(w.y) });
    else setHoverPos(null);

    // Экранная позиция курсора нужна ТОЛЬКО когда тянется линия построения
    // выработки или ставится оборудование. В остальное время обновлять её на
    // каждое движение мыши незачем: это лишний перерендер всей схемы.
    if ((tool === "branch" && branchFrom) || pendingSymbolTypeId) {
      setHoverScreenPos({ sx, sy });
    } else if (hoverScreenPos) {
      setHoverScreenPos(null);
    }

    // Наведение на подпись ветви (canvas-режим) — для курсора «grab».
    if (useCanvas && onBranchLabelOffset && tool === "select"
        && !panStart && !rotStart && !pendingSymbolTypeId && !branchBindMode && !rescuePickMode) {
      const overLbl = hitBranchLabelCanvas(sx, sy) != null;
      if (overLbl !== hoverBranchLabel) setHoverBranchLabel(overLbl);
    } else if (hoverBranchLabel) {
      setHoverBranchLabel(false);
    }

    // Подсветка ветви при tool=symbol или pendingSymbol
    if (tool === "symbol" || pendingSymbolTypeId) {
      const hb = hitBranchR(sx, sy, projNodesMap, branches, 10);
      setHoverBranchId(hb ?? null);
    } else if (hoverBranchId) {
      setHoverBranchId(null);
    }

    if (rotStart) {
      const dx = e.clientX - rotStart.x;
      const dy = e.clientY - rotStart.y;
      const newAz = rotStart.az + dx * 0.5;     // 0.5°/px
      const newEl = Math.max(0, Math.min(90, rotStart.el - dy * 0.5));
      // Orbit camera: после изменения углов перепроецируем pivot и сдвигаем
      // offset так, чтобы центр схемы остался в той же экранной точке.
      // Это даёт вращение «вокруг схемы», а не вокруг (0,0,0) мира.
      const tmpProj = {
        scale: view.scale,
        offsetX: rotStart.ox,
        offsetY: rotStart.oy,
        azimuth: newAz,
        elevation: newEl,
        zScale,
      };
      // Применяем xyScale/zScale к pivot перед проецированием (pivot хранится в чистых мировых)
      const scaledPivot = {
        x: rotStart.pivot.x * (xyScale ?? 1),
        y: rotStart.pivot.y * (xyScale ?? 1),
        z: rotStart.pivot.z * (zScale ?? 1),
      };
      const newPivotScreen = project3D(scaledPivot, tmpProj);
      const newOx = rotStart.ox + (rotStart.pivotScreen.sx - newPivotScreen.sx);
      const newOy = rotStart.oy + (rotStart.pivotScreen.sy - newPivotScreen.sy);
      setView((v) => ({ ...v, azimuth: newAz, elevation: newEl, offsetX: newOx, offsetY: newOy }));
      return;
    }
    if (panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setView((v) => ({ ...v, offsetX: panStart.ox + dx, offsetY: panStart.oy + dy }));
      return;
    }
    if (draggingNode) {
      // Тащим в плоскости, зафиксированной при начале drag.
      // Вычитаем смещение клика от центра узла, чтобы узел не прыгал к курсору.
      const asx = sx - draggingNode.dsx;
      const asy = sy - draggingNode.dsy;
      const wp = is3D
        ? unprojectToPlane(asx, asy, proj, draggingNode.plane)
        : unproject2D(asx, asy, proj, draggingNode.plane.axis === "z" ? draggingNode.plane.value : 0);
      if (!wp) return;
      // Делим обратно на xyScale и zScale — proj/unproject работает в масштабированном пространстве
      const xy = xyScale ?? 1;
      const xWorld = xy !== 1 ? wp.x / xy : wp.x;
      const yWorld = xy !== 1 ? wp.y / xy : wp.y;
      const zWorld = (zScale && zScale !== 1) ? wp.z / zScale : wp.z;
      onNodeMove(draggingNode.id, xWorld, yWorld, zWorld);
      return;
    }
    if (draggingImageBody && onHorizonImageBoundsChange) {
      // Перемещение всей подложки горизонта целиком
      const hz = horizons?.find((hh) => hh.id === draggingImageBody.horizonId);
      if (!hz || !hz.image) return;
      const plane: WorkPlane = { axis: "z", value: hz.z };
      const wp = is3D ? unprojectToPlane(sx, sy, proj, plane) : unproject2D(sx, sy, proj, hz.z);
      if (!wp) return;
      const xy = xyScale ?? 1;
      const curWx = xy !== 1 ? wp.x / xy : wp.x;
      const curWy = xy !== 1 ? wp.y / xy : wp.y;
      const dx = curWx - draggingImageBody.startWx;
      const dy = curWy - draggingImageBody.startWy;
      const ob = draggingImageBody.startBounds;
      onHorizonImageBoundsChange(draggingImageBody.horizonId, {
        x1: ob.x1 + dx, y1: ob.y1 + dy, x2: ob.x2 + dx, y2: ob.y2 + dy,
      });
      return;
    }
    if (draggingCorner && onHorizonImageBoundsChange) {
      // Перетаскивание угла подложки горизонта в плоскости z=z горизонта.
      const hz = horizons?.find((hh) => hh.id === draggingCorner.horizonId);
      if (!hz || !hz.image) return;
      const plane: WorkPlane = { axis: "z", value: hz.z };
      const wp = is3D ? unprojectToPlane(sx, sy, proj, plane) : unproject2D(sx, sy, proj, hz.z);
      if (!wp) return;
      const xy = xyScale ?? 1;
      const rawX = xy !== 1 ? wp.x / xy : wp.x;
      const rawY = xy !== 1 ? wp.y / xy : wp.y;
      const ob = draggingCorner.origBounds;
      const b = { ...hz.image.bounds };
      // Без Shift — свободное перетаскивание угла
      if (!e.shiftKey) {
        switch (draggingCorner.corner) {
          case "tl": b.x1 = rawX; b.y2 = rawY; break;
          case "tr": b.x2 = rawX; b.y2 = rawY; break;
          case "bl": b.x1 = rawX; b.y1 = rawY; break;
          case "br": b.x2 = rawX; b.y1 = rawY; break;
        }
      } else {
        // С Shift — сохраняем пропорции, фиксируем противоположный угол
        const origW = Math.abs(ob.x2 - ob.x1);
        const origH = Math.abs(ob.y2 - ob.y1);
        const aspect = origH > 0 ? origW / origH : 1;
        switch (draggingCorner.corner) {
          case "tl": {
            const newW = ob.x2 - rawX;
            const newH = newW / aspect;
            b.x1 = ob.x2 - newW; b.y2 = ob.y1 + newH; break;
          }
          case "tr": {
            const newW = rawX - ob.x1;
            const newH = newW / aspect;
            b.x2 = ob.x1 + newW; b.y2 = ob.y1 + newH; break;
          }
          case "bl": {
            const newW = ob.x2 - rawX;
            const newH = newW / aspect;
            b.x1 = ob.x2 - newW; b.y1 = ob.y2 - newH; break;
          }
          case "br": {
            const newW = rawX - ob.x1;
            const newH = newW / aspect;
            b.x2 = ob.x1 + newW; b.y1 = ob.y2 - newH; break;
          }
        }
      }
      onHorizonImageBoundsChange(draggingCorner.horizonId, b);
    }

  };

  const onMouseUp = () => {
    setPanStart(null);
    setRotStart(null);
    setDraggingNode(null);
    setDraggingCorner(null);
    setDraggingImageBody(null);
    setDraggingPrintCorner(null);
    setDraggingPrintTitle(null);
  };

  // Зум через колёсико полностью обрабатывается нативным listener выше.
  // React-обработчик нужен только для типизации JSX.
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => { e.preventDefault(); };

  // ─── Вспомогательные ────────────────────────────────────────────────────
  const zColor = (z: number) => {
    const minZ = -300, maxZ = 0;
    const t = Math.max(0, Math.min(1, (z - minZ) / (maxZ - minZ)));
    const hue = 220 - t * 180;
    return `hsl(${hue}, 70%, 50%)`;
  };

  // Карта порядка горизонтов: чем меньше индекс в списке — тем выше z-order (рисуется поверх)
  const horizonOrderMap = useMemo(() => {
    const m = new Map<string, number>();
    (horizons ?? []).forEach((h, i) => m.set(h.id, i));
    return m;
  }, [horizons]);

  // Быстрый доступ к ветви по id (для определения горизонта символа).
  const branchById = useMemo(() => {
    const m = new Map<string, TopoBranch>();
    for (const b of branches) m.set(b.id, b);
    return m;
  }, [branches]);

  // Быстрый доступ к типу УО по id (O(1) вместо LEGEND_TYPES.find на каждый символ).
  const legendTypeById = useMemo(() => {
    const m = new Map<string, (typeof LEGEND_TYPES)[number]>();
    for (const lt of LEGEND_TYPES) m.set(lt.id, lt);
    return m;
  }, []);

  // Смежные ветви по узлу (O(1) вместо branches.filter на КАЖДЫЙ узел при рендере).
  const nodeAdjBranches = useMemo(() => {
    const m = new Map<string, TopoBranch[]>();
    for (const b of branches) {
      let a = m.get(b.fromId); if (!a) { a = []; m.set(b.fromId, a); } a.push(b);
      let c = m.get(b.toId);   if (!c) { c = []; m.set(b.toId, c); }   c.push(b);
    }
    return m;
  }, [branches]);

  // Слои ветвей по горизонтам (публикуются при отрисовке ветвей и переиспользуются
  // блоком УО, чтобы символы имели корректный z-order между горизонтами).
  const branchLayerGroupsRef = useRef<{ order: number; node: React.ReactNode }[]>([]);
  // Задымление (дым) — публикуем из блока ВЕТВИ, рисуем САМЫМ ПОСЛЕДНИМ (после
  // блока УО, который перерисовывает ветви верхних горизонтов и иначе перекрыл
  // бы дым). Так дым всегда виден поверх всех слоёв-горизонтов и символов.
  const smokePassRef = useRef<React.ReactNode>(null);

  // Сортировка ветвей: сначала по иерархии горизонтов (как слои в Фотошопе / Аэросети),
  // затем по глубине 3D внутри одного горизонта.
  // Горизонт выше в списке слева (меньший индекс) рисуется ПОВЕРХ остальных.
  const branchesSorted = useMemo(() => [...visibleBranches].map((b) => {
    const from = projNodesMap.get(b.fromId);
    const to = projNodesMap.get(b.toId);
    const depth = from && to ? (from.depth + to.depth) / 2 : 0;
    // Порядок горизонта: чем меньше индекс — тем поверх (инвертируем для sort)
    const hOrder = b.horizonId ? (horizonOrderMap.get(b.horizonId) ?? 9999) : 9999;
    return { branch: b, depth, hOrder };
  }).sort((a, b) => {
    // Главный критерий — порядок горизонта в списке слоёв (больший hOrder рисуется первым = ниже)
    if (a.hOrder !== b.hOrder) return b.hOrder - a.hOrder;
    // Внутри одного горизонта — по глубине 3D (дальние рисуются первыми = ниже)
    return a.depth - b.depth;
  }), [visibleBranches, projNodesMap, horizonOrderMap]);

  // Условные обозначения (УО) сортируем по порядку горизонта привязанной ветви,
  // чтобы они переупорядочивались вместе с ветвями при перемещении горизонта:
  // УО верхнего горизонта рисуется поверх УО нижних (стабильная сортировка
  // сохраняет исходный порядок внутри одного горизонта).
  const schemaSymbolsSorted = useMemo(() => {
    const branchHorizonOrder = (branchId: string | null): number => {
      if (!branchId) return 9999;
      const br = branchById.get(branchId);
      if (!br || !br.horizonId) return 9999;
      return horizonOrderMap.get(br.horizonId) ?? 9999;
    };
    return schemaSymbols
      .map((sym, i) => ({ sym, i, ord: branchHorizonOrder(sym.branchId) }))
      .sort((a, b) => (a.ord !== b.ord ? b.ord - a.ord : a.i - b.i))
      .map(x => x.sym);
  }, [schemaSymbols, branchById, horizonOrderMap]);

  const nodesSorted = useMemo(
    () => [...projNodes].sort((a, b) => a.depth - b.depth),
    [projNodes]
  );

  // ─── Слой печати и геометрия холста ──────────────────────────────────────
  // Логика вынесена в topoCanvas/TopoCanvasPrintLayers (перенос 1:1):
  // сетка плоскости, рабочая плоскость, распроекция рамки и слои печати
  // (рамка листа, заголовок, штамп, блок «УТВЕРЖДАЮ», легенда).
  const { renderGroundGrid, renderWorkPlane, unprojFrame, renderPrintLayers } = usePrintLayers({
    nodes, branches, horizons, visibleBranches, projNodes, proj, is3D, effPlane,
    xyScale, zScale, schemaSymbols, editingPrintLayerId,
    onPrintLayerBoundsChange, onPrintLayerChange,
    editingTitleId, setEditingTitleId, editingTitleDraft, setEditingTitleDraft,
    editingStampCell, setEditingStampCell,
    editingApproverCell, setEditingApproverCell,
    setDraggingPrintCorner, draggingPrintTitle, setDraggingPrintTitle,
  });

  // ─── Автопереключение SVG ↔ Canvas ────────────────────────────────────────
  const useCanvas = visibleBranches.length > canvasThreshold;
  if (!useCanvas) canvasExportRef.current = null;

  // Активен ли слой печати — тогда canvas делаем прозрачным, чтобы рамка/штамп
  // (SVG под canvas) были видны сквозь схему и лежали ПОД ней.
  const hasActivePrintLayer = (horizons ?? EMPTY_ARRAY).some(h => h.printLayer?.visible);

  const cursorStyle = rotStart ? "grabbing" : panStart ? "grabbing"
    : draggingPrintTitle ? "grabbing"
    : draggingNode ? "grabbing"
    : rescuePickMode ? "cell"
    : branchBindMode ? "pointer"
    : pendingSymbolTypeId ? "copy"
    : tool === "node" ? "crosshair"
    : tool === "symbol" ? "copy"
    : tool === "rotate" ? "grab"
    : tool === "pan" ? "grab"
    : hoverBranchLabel ? "grab" : "default";

  // Canvas-обёртки: перенаправляем события HTMLCanvasElement → обработчикам SVG
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asS = <T,>(e: T) => e as unknown as any;
  const onMouseDownCanvas   = (e: React.MouseEvent<HTMLCanvasElement>)  => onMouseDown(asS(e));
  const onMouseMoveCanvas   = (e: React.MouseEvent<HTMLCanvasElement>)  => onMouseMove(asS(e));
  const onMouseUpCanvas     = (e: React.MouseEvent<HTMLCanvasElement>)  => onMouseUp(asS(e));
  const onWheelCanvas       = (e: React.WheelEvent<HTMLCanvasElement>)  => onWheel(asS(e));
  const onContextMenuCanvas = (e: React.MouseEvent<HTMLCanvasElement>)  => onContextMenuSVG(asS(e));
  // Двойной клик по подписи ветви в canvas-режиме — сброс смещения в дефолт
  // (как onDoubleClick подписи в SVG). Ловим попадание в bbox подписи.
  const onDoubleClickCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onBranchLabelOffset) return;
    const rect = (containerRef.current ?? e.currentTarget as Element).getBoundingClientRect();
    const lblId = hitBranchLabelCanvas(e.clientX - rect.left, e.clientY - rect.top);
    if (lblId) { e.stopPropagation(); onBranchLabelOffset(lblId, 0, -16); }
  };
  // Touch для canvas теперь регистрируются нативно в CanvasLayer (passive:false)

  // Обработчик клика по УО: одиночный клик = выбор + открыть свойства,
  // двойной клик (≤350мс) = открыть настройки (fan/перемычка).
  // Ctrl+click = добавить/убрать из множественного выбора.
  const handleSymbolClick = (id: string, isCtrl: boolean) => {
    const now = Date.now();
    const last = symLastClickRef.current;
    const isDbl = last?.id === id && now - last.time < 350;
    symLastClickRef.current = { id, time: now };

    if (isDbl) {
      // Двойной клик: открыть настройки
      symLastClickRef.current = null; // сбросить чтобы следующий клик не стал тройным
      onSymbolDblClick?.(id);
    } else if (isCtrl) {
      // Ctrl+click: мультивыбор УО
      if (onSymbolMultiSelect) {
        onSymbolMultiSelect(id);
      } else {
        onSelectSymbol?.(selectedSymbolId === id ? null : id);
      }
    } else {
      // Одиночный клик: выбор + показать свойства
      onSymbolClick?.(id);
    }
  };

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden"
      tabIndex={0}
      style={{
        background: is3D ? "linear-gradient(to bottom, #f0f4f8 0%, #ffffff 60%, #f5f5f5 100%)" : "#ffffff",
        cursor: cursorStyle,
        outline: "none",
      }}
      onMouseDown={() => { containerRef.current?.focus({ preventScroll: true }); }}>

      {/* ── Слой печати ПОД canvas (только в canvas-режиме) ───────────── */}
      {/* Рамка/штамп лежат ПОД canvas-схемой: SVG zIndex:0, а canvas — zIndex:1.
          Чтобы схема не закрывала рамку своей заливкой, canvas делаем прозрачным
          (transparentBg) когда активен слой печати. При редактировании поднимаем
          SVG (2), чтобы ручки перетаскивания были доступны над схемой. */}
      {useCanvas && (
        <svg
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: editingPrintLayerId ? "auto" : "none", zIndex: editingPrintLayerId ? 2 : 0 }}
          width={size.w} height={size.h}>
          {renderPrintLayers()}
        </svg>
      )}

      {/* ── Canvas-рендерер (большие схемы > CANVAS_THRESHOLD ветвей) ──
          Обёрнут в CanvasErrorBoundary: если рендер упадёт из-за непредвиденной
          ошибки (например, некорректные данные маршрута горноспасателей),
          пользователь увидит понятное сообщение вместо чёрного экрана всего приложения. */}
      {useCanvas && (
        <CanvasErrorBoundary>
        <CanvasLayer
          width={size.w}
          height={size.h}
          nodes={nodes}
          branches={branches}
          horizons={horizons ?? EMPTY_ARRAY}
          horizonMap={horizonMap}
          visibleBranches={visibleBranches}
          hiddenBranchIds={hiddenBranchIds}
          projNodes={projNodes}
          projNodesMap={projNodesMap}
          proj={proj}
          view={view}
          sortEpoch={sortEpoch}
          is3D={is3D}
          zScale={zScale}
          zLevel={zLevel}
          selectedBranchId={selectedBranchId}
          selectedBranchIds={selectedBranchIds ?? EMPTY_SET}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds ?? EMPTY_SET}
          hoverBranchId={hoverBranchId}
          highlightHorizonId={highlightHorizonId}
          branchWidth={branchWidth}
          branchBorder={branchBorder}
          thinLines={thinLines}
          fixedObjectScale={fixedObjectScale}
          scaleLimits={scaleLimits}
          colorByHorizon={colorByHorizon}
          showFlowArrows={showFlowArrows}
          flowDisplay={flowDisplay}
          animSpeed={animSpeed}
          infoConfig={infoConfig}
          unitsConfig={unitsConfig}
          waterNodeResults={waterNodeResults}
          waterBranchResults={waterBranchResults}
          branchFireColors={branchFireColors}
          branchExplosionColors={branchExplosionColors}
          reversedBranchIds={reversedBranchIds}
          pollutedBranchIds={pollutedBranchIds}
          xyScale={xyScale}
          nodeLodThresholds={nodeLodThresholds}
          transparentBg={hasActivePrintLayer}
          compareBranchColors={compareBranchColors}
          colorMode={colorMode}
          sectionColors={sectionColors}
          flowColorMin={flowColorMin}
          flowColorMax={flowColorMax}
          flowColorHue={flowColorHue}
          velColorMin={velColorMin}
          velColorMax={velColorMax}
          velColorHue={velColorHue}
          posInnerColors={posInnerColors}
          posOuterColors={posOuterColors}
          rescuePathNodeIds={rescuePathNodeIds}
          rescueNodeLetters={rescueNodeLetters}
          rescuePathBranchIds={rescuePathBranchIds}
          rescuePathBranchDirs={rescuePathBranchDirs}
          onMouseDown={onMouseDownCanvas}
          onMouseMove={onMouseMoveCanvas}
          onMouseUp={onMouseUpCanvas}
          onWheel={onWheelCanvas}
          onContextMenu={onContextMenuCanvas}
          onTouchStart={(e) => { e.preventDefault(); }}
          onTouchMove={(e) => { e.preventDefault(); }}
          onTouchEnd={(e) => { e.preventDefault(); }}
          onRegisterGetCanvas={(fn) => { canvasExportRef.current = fn; }}
          onRegisterCanvasEl={onRegisterCanvasEl}
          buildFromNodeId={tool === "branch" ? branchFrom : null}
          buildToPos={tool === "branch" && branchFrom ? hoverScreenPos : null}
        />
        </CanvasErrorBoundary>
      )}

      {/* Линия построения выработки в canvas-режиме теперь рисуется на слое
          выделения внутри CanvasLayer (buildFromNodeId / buildToPos). Раньше
          здесь был отдельный SVG-слой, который React пересоздавал на каждое
          движение мыши. */}

      {/* ── SVG-рендерер (малые и средние схемы ≤ CANVAS_THRESHOLD ветвей) ── */}
      <svg ref={svgCallbackRef} width={size.w} height={size.h}
        style={{ touchAction: "none", userSelect: "none", visibility: (useCanvas && !editingPrintLayerId && !editingHorizonImageId) ? "hidden" : undefined, pointerEvents: (useCanvas && !editingPrintLayerId && !editingHorizonImageId) ? "none" : undefined, position: useCanvas ? "absolute" : undefined,
          // ВАЖНО: без top/left абсолютный SVG встаёт на своё «место в потоке» —
          // то есть НИЖЕ холста (canvas занимает всю высоту). Слой уезжал за
          // пределы окна, и ручки подложки были недоступны в canvas-режиме.
          top: useCanvas ? 0 : undefined, left: useCanvas ? 0 : undefined,
          zIndex: useCanvas ? ((editingPrintLayerId || editingHorizonImageId) ? 3 : -1) : undefined, cursor: positionPlaceMode ? "crosshair" : branchBindMode ? "cell" : undefined }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onContextMenu={onContextMenuSVG}>

        <defs>
          {/* 2D-сетка — рисуем только если ячейка достаточно крупная */}
          {view.scale >= 0.5 && (<>
          <pattern id="topo-grid-minor" width={20 * view.scale} height={20 * view.scale} patternUnits="userSpaceOnUse"
            x={view.offsetX % (20 * view.scale)} y={view.offsetY % (20 * view.scale)}>
            <path d={`M ${20 * view.scale} 0 L 0 0 0 ${20 * view.scale}`} fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
          </pattern>
          <pattern id="topo-grid-major" width={100 * view.scale} height={100 * view.scale} patternUnits="userSpaceOnUse"
            x={view.offsetX % (100 * view.scale)} y={view.offsetY % (100 * view.scale)}>
            <rect width={100 * view.scale} height={100 * view.scale} fill="url(#topo-grid-minor)" />
            <path d={`M ${100 * view.scale} 0 L 0 0 0 ${100 * view.scale}`} fill="none" stroke="#dcdcdc" strokeWidth="0.8" />
          </pattern>
          </>)}
        </defs>

        {!useCanvas && !is3D && view.scale >= 0.5 && <rect width={size.w} height={size.h} fill="url(#topo-grid-major)" />}
        {!useCanvas && !is3D && view.scale < 0.5 && <rect width={size.w} height={size.h} fill="#f8f9fa" />}
        {!useCanvas && is3D && renderGroundGrid()}



        {!useCanvas && is3D && (tool === "node" || tool === "branch") && renderWorkPlane()}

        {/* ── ШАБЛОНЫ ПЕЧАТИ ГОРИЗОНТОВ (только в SVG-режиме) ─────────────── */}
        {!useCanvas && renderPrintLayers()}

        {/* ── ПОДЛОЖКИ ГОРИЗОНТОВ (PNG/JPG) ─────────────────────────────── */}
        {/* Рисуются ПОД ветвями. Видимость подложки = h.image.visible && h.visible */}
        {/* В canvas-режиме сама картинка рисуется на холсте, но на время
            редактирования этот же слой нужен для рамки и перетаскивания —
            поэтому группу рендерим и там (без дублирующего <image>). */}
        {(!useCanvas || editingHorizonImageId) && (horizons ?? []).map((h) => {
          if (!h.visible || !h.image || !h.image.visible) return null;
          if (useCanvas && h.id !== editingHorizonImageId) return null;
          const b = h.image.bounds;
          const xy = xyScale ?? 1;
          // Для проекции углы лежат на плоскости z = h.z, с учётом xyScale
          const p1 = project3D({ x: b.x1 * xy, y: b.y1 * xy, z: h.z }, proj);
          const p2 = project3D({ x: b.x2 * xy, y: b.y1 * xy, z: h.z }, proj);
          const p3 = project3D({ x: b.x2 * xy, y: b.y2 * xy, z: h.z }, proj);
          const p4 = project3D({ x: b.x1 * xy, y: b.y2 * xy, z: h.z }, proj);
          const minSx = Math.min(p1.sx, p2.sx, p3.sx, p4.sx);
          const maxSx = Math.max(p1.sx, p2.sx, p3.sx, p4.sx);
          const minSy = Math.min(p1.sy, p2.sy, p3.sy, p4.sy);
          const maxSy = Math.max(p1.sy, p2.sy, p3.sy, p4.sy);
          const isEditing = h.id === editingHorizonImageId;
          // Поворот подложки вокруг её центра (в экранных координатах).
          const rot = Number(h.image.rotation) || 0;
          const rotCx = (minSx + maxSx) / 2;
          const rotCy = (minSy + maxSy) / 2;
          return (
            <g key={`hi-${h.id}`}
               transform={rot ? `rotate(${rot} ${rotCx} ${rotCy})` : undefined}>
              {/* В canvas-режиме картинку уже нарисовал холст — второй раз
                  не рисуем, иначе подложка удвоится по плотности. */}
              {!useCanvas && (
                <image
                  href={h.image.dataUrl}
                  x={minSx} y={minSy}
                  width={Math.max(0, maxSx - minSx)}
                  height={Math.max(0, maxSy - minSy)}
                  opacity={h.image.opacity}
                  preserveAspectRatio="none"
                  style={{ pointerEvents: "none" }} />
              )}
              {/* Обводка — всегда, тело — кликабельно только в режиме редактирования */}
              <rect x={minSx} y={minSy}
                width={Math.max(0, maxSx - minSx)}
                height={Math.max(0, maxSy - minSy)}
                fill="none" stroke={h.color} strokeOpacity={isEditing ? 0.8 : 0.4}
                strokeWidth={isEditing ? 1.5 : 1} strokeDasharray="6 4"
                style={{ pointerEvents: "none" }} />
              {/* Прозрачный прямоугольник для drag перемещения (только в режиме редактирования) */}
              {isEditing && onHorizonImageBoundsChange && (
                <rect x={minSx} y={minSy}
                  width={Math.max(0, maxSx - minSx)}
                  height={Math.max(0, maxSy - minSy)}
                  fill="transparent"
                  style={{ cursor: "move", pointerEvents: "all" }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    const plane: WorkPlane = { axis: "z", value: h.z };
                    const esx = e.clientX - (e.currentTarget.closest("svg")?.getBoundingClientRect().left ?? 0);
                    const esy = e.clientY - (e.currentTarget.closest("svg")?.getBoundingClientRect().top ?? 0);
                    const wp = is3D ? unprojectToPlane(esx, esy, proj, plane) : unproject2D(esx, esy, proj, h.z);
                    if (!wp) return;
                    const xyS = xyScale ?? 1;
                    setDraggingImageBody({
                      horizonId: h.id,
                      startWx: xyS !== 1 ? wp.x / xyS : wp.x,
                      startWy: xyS !== 1 ? wp.y / xyS : wp.y,
                      startBounds: { ...b },
                    });
                  }}
                />
              )}
            </g>
          );
        })}

        {/* ── РУЧКИ ДЛЯ РАСТЯГИВАНИЯ ПОДЛОЖКИ (только для активного горизонта) ── */}
        {/* Ручки «Растянуть» нужны и в canvas-режиме: сама подложка там рисуется
            на холсте, а маркеры остаются SVG-овыми (SVG-слой на время
            редактирования становится видимым и кликабельным). */}
        {editingHorizonImageId && (() => {
          const h = (horizons ?? []).find((hh) => hh.id === editingHorizonImageId);
          if (!h || !h.image || !h.image.visible || !h.visible) return null;
          const b = h.image.bounds;
          const xy = xyScale ?? 1;
          const corners: Array<{ key: "tl" | "tr" | "bl" | "br"; x: number; y: number; cur: string }> = [
            { key: "tl", x: b.x1, y: b.y2, cur: "nwse-resize" },
            { key: "tr", x: b.x2, y: b.y2, cur: "nesw-resize" },
            { key: "bl", x: b.x1, y: b.y1, cur: "nesw-resize" },
            { key: "br", x: b.x2, y: b.y1, cur: "nwse-resize" },
          ];
          // Ручки должны поворачиваться вместе с подложкой, иначе при повороте
          // они «разъезжаются» с картинкой и тянуть за угол невозможно.
          const rotH = Number(h.image.rotation) || 0;
          const cPts = corners.map((c) => project3D({ x: c.x * xy, y: c.y * xy, z: h.z }, proj));
          const hCx = cPts.reduce((s, p) => s + p.sx, 0) / cPts.length;
          const hCy = cPts.reduce((s, p) => s + p.sy, 0) / cPts.length;
          return (
            <g transform={rotH ? `rotate(${rotH} ${hCx} ${hCy})` : undefined}>
              {corners.map((c) => {
                const p = project3D({ x: c.x * xy, y: c.y * xy, z: h.z }, proj);
                return (
                  <g key={c.key} style={{ cursor: c.cur, pointerEvents: "all" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingCorner({ horizonId: h.id, corner: c.key, shiftLocked: false, origBounds: { ...b } });
                    }}>
                    <circle cx={p.sx} cy={p.sy} r="10" fill="transparent" />
                    <circle cx={p.sx} cy={p.sy} r="7" fill="white" stroke={h.color} strokeWidth="2" />
                    <circle cx={p.sx} cy={p.sy} r="3" fill={h.color} />
                  </g>
                );
              })}
              {/* Подсказка: Shift для сохранения пропорций */}
              {(() => {
                const cx = (b.x1 + b.x2) / 2 * xy;
                const cy = (b.y1 + b.y2) / 2 * xy;
                const pc = project3D({ x: cx, y: cy, z: h.z }, proj);
                return (
                  <text x={pc.sx} y={pc.sy} textAnchor="middle" dominantBaseline="middle"
                    fontSize="11" fill={h.color} fillOpacity="0.7" style={{ pointerEvents: "none", userSelect: "none" }}>
                    Shift — пропорции
                  </text>
                );
              })()}
            </g>
          );
        })()}

        {/* ─── ВЕТВИ (отсортированы по глубине) ────────────────────────── */}
        {/* Пороги LOD: при отдалении отключаем дорогостоящие элементы */}
        {!useCanvas && (() => {
          const _xySF = xyScale ?? 1;
          const lodChevrons  = view.scale >= _xySF * 0.25;
          const lodArrows    = view.scale >= _xySF * 0.15;
          const lodLabels    = view.scale >= _xySF * 0.04;
          // Border всегда включён (как в canvas) — без обводки ветви сливаются при отдалении
          const lodBorder    = true;
          // Коэффициент масштабирования объектов: 1 = фиксированный, view.scale/0.4 = пропорциональный.
          // При наличии xyScale нормируем: схема масштабирована в xyScale раз,
          // поэтому «нормальный» view.scale при котором objSF=1 тоже в xyScale раз меньше.
          // При fixedObjectScale — зажимаем по scaleLimits; иначе растём неограниченно (только минимум 0.25).
          const rawObjSF = fixedObjectScale ? 1 : (view.scale / (_xySF * 0.4));
          // Пределы масштабов применяем только при fixedObjectScale, иначе растём неограниченно
          const objSF = fixedObjectScale && scaleLimits
            ? Math.min(scaleLimits.branchMax / 100, Math.max(scaleLimits.branchMin / 100, rawObjSF))
            : Math.max(0.25, rawObjSF);
          // ── ПРОХОД −1: Сравнение схем — аура под всеми слоями ───────────
          const comparePass = compareBranchColors && compareBranchColors.size > 0
            ? branchesSorted.map(({ branch: b }) => {
                const from = projNodesMap.get(b.fromId);
                const to   = projNodesMap.get(b.toId);
                if (!from || !to) return null;
                const col = compareBranchColors.get(b.id);
                if (!col) return null;
                const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
                const w = (thinLines ? 1 : bw) * objSF;
                return (
                  <g key={`cmp-${b.id}`}>
                    <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                      stroke={col} strokeWidth={w + 10 * objSF}
                      strokeLinecap="round" opacity="0.3" />
                    <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                      stroke={col} strokeWidth={w + 4 * objSF}
                      strokeLinecap="round" opacity="0.85" />
                  </g>
                );
              })
            : null;

          // ── ПРОХОД 0: ПЛА — цвет позиции снаружи (под border и fill) ────
          // Рисуем ВСЕ ветви позиции одним слоем → смотрятся как единый контур
          const posOuterPass = posOuterColors ? branchesSorted.map(({ branch: b }) => {
            const from = projNodesMap.get(b.fromId);
            const to   = projNodesMap.get(b.toId);
            if (!from || !to) return null;
            const col = posOuterColors.get(b.id);
            if (!col) return null;
            const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
            const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
            const w = (thinLines ? 1 : bw) * objSF;
            const borderW = (thinLines || !lodBorder) ? 0 : Math.max(0, bb) * objSF;
            return (
              <line key={`posOuter-${b.id}`}
                x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke={col} strokeWidth={w + borderW * 2 + 6 * objSF}
                strokeLinecap="round" opacity="0.7" />
            );
          }) : null;

          // ── ПОДСВЕТКА ГОРИЗОНТА (наведение в списке слоёв слева) ──────────
          const highlightPass = highlightHorizonId ? branchesSorted.map(({ branch: b }) => {
            if (b.horizonId !== highlightHorizonId) return null;
            const from = projNodesMap.get(b.fromId);
            const to   = projNodesMap.get(b.toId);
            if (!from || !to) return null;
            const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
            const w = (thinLines ? 1 : bw) * objSF;
            return (
              <line key={`hl-${b.id}`}
                x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke="#f59e0b" strokeWidth={w + 10 * objSF}
                strokeLinecap="round" opacity="0.55" />
            );
          }) : null;

          // ── ПРОХОД 1: только border всех ветвей ──────────────────────────
          // Рисуем все обводки сначала, чтобы fill соседних ветвей перекрывал
          // торцы border — схема выглядит цельной без разрывов в узлах
          const borderPass = branchesSorted.map(({ branch: b }) => {
            const from = projNodesMap.get(b.fromId);
            const to   = projNodesMap.get(b.toId);
            if (!from || !to) return null;
            const isSel = selectedBranchId === b.id || (selectedBranchIds?.has(b.id) ?? false);
            const isLeakage = b.isLeakage ?? false;
            const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
            const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
            const baseW = isSel ? bw + 1 : bw;
            const w = thinLines ? 1 : Math.max(baseW * objSF, 1.0);
            const borderW = (thinLines || !lodBorder) ? 0 : Math.max(Math.max(0, bb) * objSF, 0.5);
            if (borderW === 0) return null;
            return (
              <line key={`border-${b.id}`}
                x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke="#1f2937" strokeWidth={w + borderW * 2}
                strokeLinecap="round" opacity="0.85"
                strokeDasharray={isLeakage ? "6 4" : undefined} />
            );
          });
          // ── ПРОХОД 2: fill + декор всех ветвей ───────────────────────────
          const fillPass = branchesSorted.map(({ branch: b }) => {
          const from = projNodesMap.get(b.fromId);
          const to = projNodesMap.get(b.toId);
          if (!from || !to) return null;
          const isSel = selectedBranchId === b.id || (selectedBranchIds?.has(b.id) ?? false);
          const isMultiSel = selectedBranchIds?.has(b.id) ?? false;
          // При реверсе вентилятора поток идёт против направления ветви.
          // Если расчёт ещё не был выполнен (flow > 0), принудительно переворачиваем
          // стрелки для ветви самого вентилятора; после пересчёта flow < 0 само по себе.
          const fanReverseOverride = b.hasFan && (b.fanReverse ?? false) && b.flow >= 0;
          const reversed = b.flow < 0 || fanReverseOverride;
          // Координаты «начала потока» → «конца потока»
          const sxA = reversed ? to.sx : from.sx;
          const syA = reversed ? to.sy : from.sy;
          const sxB = reversed ? from.sx : to.sx;
          const syB = reversed ? from.sy : to.sy;
          const midX = (from.sx + to.sx) / 2;
          const midY = (from.sy + to.sy) / 2;
          const len = b.length || Math.round(calcBranchLength(from.node, to.node));
          const Q = Math.abs(b.flow);
          const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
          const V = b.velocity;
          const overV = V > b.vMax;
          // ─── ЦВЕТ ВЕТВИ ──────────────────────────────────────────
          // Градиент по расходу воздуха: белый (мин) → насыщенный цвет (макс)
          const gradColor = (val: number, min: number, max: number, hue: string): string => {
            const t = Math.min(1, Math.max(0, (val - min) / Math.max(0.001, max - min)));
            // Целевые RGB для максимума шкалы
            const targets: Record<string, [number, number, number]> = {
              red:   [220, 38, 38],   // #dc2626
              blue:  [37, 99, 235],   // #2563eb
              green: [22, 163, 74],   // #16a34a
            };
            const [tr, tg, tb] = targets[hue] ?? targets.red;
            const r = Math.round(255 + (tr - 255) * t);
            const g = Math.round(255 + (tg - 255) * t);
            const b = Math.round(255 + (tb - 255) * t);
            return `rgb(${r},${g},${b})`;
          };
          // Градиент по скорости: 0 м/с=серый → 3=синий → 8=зелёный → 15=жёлтый → 25+=красный
          const velocityColor = (v: number): string => {
            if (v <= 0) return "#9ca3af";
            const stops = [
              { v: 0,  r: 156, g: 163, b: 175 }, // серый
              { v: 3,  r: 59,  g: 130, b: 246 }, // синий
              { v: 8,  r: 16,  g: 185, b: 129 }, // зелёный
              { v: 15, r: 234, g: 179, b: 8   }, // жёлтый
              { v: 25, r: 239, g: 68,  b: 68  }, // красный
            ];
            let lo = stops[0], hi = stops[stops.length - 1];
            for (let i = 0; i < stops.length - 1; i++) {
              if (v >= stops[i].v && v <= stops[i + 1].v) { lo = stops[i]; hi = stops[i + 1]; break; }
            }
            const t = lo.v === hi.v ? 1 : Math.min(1, (v - lo.v) / (hi.v - lo.v));
            const r = Math.round(lo.r + (hi.r - lo.r) * t);
            const g = Math.round(lo.g + (hi.g - lo.g) * t);
            const bl = Math.round(lo.b + (hi.b - lo.b) * t);
            return `rgb(${r},${g},${bl})`;
          };
          const isDead = b.isDead ?? false;
          const isLeakage = b.isLeakage ?? false;
          const horizonColor = b.horizonId ? horizonMap.get(b.horizonId)?.color : undefined;
          const posInnerColEarly = posInnerColors?.get(b.id);
          const color = isSel ? (isMultiSel ? "#f59e0b" : "#2563eb")
            : b.isVentPipeBranch ? "#9ca3af"
            : isLeakage ? "#f97316"
            : overV ? "#dc2626"
            // Ветвь входит в позицию ПЛА — цвет позиции. Ветви БЕЗ позиции сохраняют
            // обычный цвет (горизонт/скорость/контур), а не заливаются белым.
            : posInnerColEarly ? posInnerColEarly
            : (colorByHorizon && horizonColor) ? horizonColor
            : colorMode === "flowQ" ? gradColor(Math.abs(Q), flowColorMin, flowColorMax, flowColorHue)
            : colorMode === "velocityV" ? gradColor(V, velColorMin, velColorMax, velColorHue)
            : colorMode === "section" ? SECTION_KIND_COLORS[sectionKind(b)]
            : colorMode === "ventsection" ? (sectionColors?.get(b.id) ?? "#ffffff")
            : colorMode === "none" ? "#ffffff"
            : Q > 0 ? velocityColor(V)
            : "#ffffff";

          // ─── ТОЛЩИНА ЛИНИИ ───────────────────────────────────────
          const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
          const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
          const baseW = isSel ? bw + 1 : bw;
          // Минимум 1px чтобы ветви оставались читаемыми при любом масштабе
          const w = thinLines ? 1 : Math.max(baseW * objSF, 1.0);
          // Border: минимум 0.5px чтобы обводка не пропадала при отдалении
          const borderW = (thinLines || !lodBorder) ? 0 : Math.max(Math.max(0, bb) * objSF, 0.5);
          const flowVisible = !thinLines && lodChevrons && Q > 0.1 && flowDisplay !== "off";
          const showDashes = flowVisible && (flowDisplay === "flow" || flowDisplay === "both");
          const showChevrons = flowVisible && (flowDisplay === "chevrons" || flowDisplay === "both");

          // Длительность анимации (с): ~ обратно пропорц. скорости.
          // V=15 м/с → 0.6 с, V=1 м/с → 4 с, нижняя граница 0.4 с
          // animSpeed — множитель из настроек (меньше = медленнее анимация)
          const animDur = Math.max(0.4, Math.min(5, 4 / Math.max(0.5, V))) / Math.max(0.1, animSpeed);

          // Длина отрезка в px и единичный вектор направления
          const dx = sxB - sxA;
          const dy = syB - syA;
          const segLen = Math.hypot(dx, dy);
          const ux = segLen > 0 ? dx / segLen : 0;
          const uy = segLen > 0 ? dy / segLen : 0;

          // ── Подсветка в F3-режиме привязки ────────────────────────────────
          const posBindInfo = branchPositionColors?.get(b.id);
          // Задымление (fireSeg) рисуется отдельным проходом smokePass ниже.
          // ── Подсветка зон взрыва ───────────────────────────────────────────
          const expSeg = branchExplosionColors?.get(b.id);

          return (
            <g key={b.id}>
              {/* Опрокидывание — синяя пунктирная аура по всей ветви */}
              {reversedBranchIds?.has(b.id) && (<>
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke="#2563eb" strokeWidth={Math.max(w + 18, 10)} strokeLinecap="round"
                  opacity="0.55" strokeDasharray="8 4" />
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke="#2563eb" strokeWidth={Math.max(w + 10, 6)} strokeLinecap="round"
                  opacity="0.3" />
              </>)}
              {/* Подсветка взрыва — штриховая аура по всей ветви */}
              {expSeg && (<>
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke={expSeg.color} strokeWidth={Math.max(w + 20, 12)} strokeLinecap="round"
                  opacity="0.55" strokeDasharray="10 6" />
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke={expSeg.color} strokeWidth={Math.max(w + 8, 6)} strokeLinecap="round"
                  opacity="0.3" />
              </>)}
              {/* Подсветка маршрута горноспасателей + стрелки направления */}
              {rescuePathBranchIds?.has(b.id) && (() => {
                // Направление движения горноспасателей по этой ветви
                const forward = rescuePathBranchDirs?.get(b.id) ?? true;
                const rAxA = forward ? from.sx : to.sx;
                const rAyA = forward ? from.sy : to.sy;
                const rAxB = forward ? to.sx   : from.sx;
                const rAyB = forward ? to.sy   : from.sy;
                const rdx = rAxB - rAxA;
                const rdy = rAyB - rAyA;
                const rLen = Math.hypot(rdx, rdy);
                const angle = Math.atan2(rdy, rdx) * 180 / Math.PI;
                // Стрелки: шаг 90px, минимум 1
                const arrowStep = 90;
                const arrowCount = rLen > arrowStep ? Math.floor(rLen / arrowStep) : 1;
                return (
                  <>
                    {/* Зелёная аура */}
                    <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                      stroke="#16a34a" strokeWidth={Math.max(w + 10, 7)} strokeLinecap="round"
                      opacity="0.4" />
                    {/* Зелёная штриховая линия */}
                    <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                      stroke="#4ade80" strokeWidth={Math.max(w + 3, 3)} strokeLinecap="round"
                      opacity="0.9" strokeDasharray="14 6" />
                    {/* Стрелки горноспасателей */}
                    {rLen > 20 && Array.from({ length: arrowCount }, (_, i) => {
                      const t0 = (i + 1) / (arrowCount + 1);
                      const cx = rAxA + rdx * t0;
                      const cy = rAyA + rdy * t0;
                      const al = Math.min(22, Math.max(14, w * 3.5));
                      const hw = al / 2;
                      return (
                        <g key={`rescue-arrow-${i}`} transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
                          {/* Хвостик */}
                          <line x1={-hw} y1={0} x2={hw - 5} y2={0}
                            stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.95" />
                          <line x1={-hw} y1={0} x2={hw - 5} y2={0}
                            stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" opacity="0.9" />
                          {/* Наконечник */}
                          <polygon points={`${hw - 7},-5 ${hw},0 ${hw - 7},5`}
                            fill="white" stroke="#15803d" strokeWidth="1"
                            strokeLinejoin="round" opacity="0.95" />
                        </g>
                      );
                    })}
                  </>
                );
              })()}
              {/* Подсветка ветви при tool=symbol hover */}
              {hoverBranchId === b.id && (
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke="#f59e0b" strokeWidth={w + 8} strokeLinecap="round" opacity="0.35" />
              )}

              {/* Подсветка F3-режима: привязанные ярко, непривязанные тускло */}
              {branchBindMode && posBindInfo && posBindInfo.bound && (
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke={posBindInfo.color} strokeWidth={w + 7} strokeLinecap="round" opacity="0.55" />
              )}
              {branchBindMode && posBindInfo && !posBindInfo.bound && (
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke="#888" strokeWidth={w + 3} strokeLinecap="round" opacity="0.15"
                  strokeDasharray="6,4" />
              )}
              {/* Подложка — статичная линия (всегда от fromId к toId, цвет = тип) */}
              <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke={color} strokeWidth={w} strokeLinecap="round" opacity={flowVisible ? 0.55 : 1}
                strokeDasharray={isLeakage ? "6 4" : undefined} />

              {/* Задымление (дым) рисуется ОТДЕЛЬНЫМ проходом smokePass ПОВЕРХ
                  всех слоёв-горизонтов — см. ниже. Здесь НЕ рисуем, иначе ветви
                  вышележащих горизонтов перекрывали бы дым нижних. */}

              {/* ── Вентрубопровод — пунктирная линия параллельно ветви ── */}
              {/* Для реальных ветвей-нити трубопровода (isVentPipeBranch) пунктир
                  НЕ рисуем — сама ветвь уже является трубопроводом. */}
              {b.hasVentPipe && !b.isVentPipeBranch && (() => {
                const nx = -uy;
                const ny = ux;
                const vpOff = w / 2 + 3;
                const vpX1 = from.sx + nx * vpOff;
                const vpY1 = from.sy + ny * vpOff;
                const vpX2 = to.sx + nx * vpOff;
                const vpY2 = to.sy + ny * vpOff;
                const vpW = Math.max(1.5, w * 0.35);
                const mX = (vpX1 + vpX2) / 2;
                const mY = (vpY1 + vpY2) / 2;
                const fs = Math.max(8, Math.min(12, w * 1.2));
                return (
                  <g pointerEvents="none">
                    <line x1={vpX1} y1={vpY1} x2={vpX2} y2={vpY2}
                      stroke="white" strokeWidth={vpW + 2} strokeLinecap="round" opacity="0.6" />
                    <line x1={vpX1} y1={vpY1} x2={vpX2} y2={vpY2}
                      stroke="#0ea5e9" strokeWidth={vpW} strokeLinecap="round"
                      strokeDasharray="8 4" opacity="0.9" />
                    {segLen > 60 && view.scale > 0.3 && (
                      <text x={mX} y={mY} textAnchor="middle" dominantBaseline="middle"
                        fontSize={fs} fontFamily="Arial" fontWeight="bold"
                        fill="#0ea5e9" opacity="0.95">ВТ</text>
                    )}
                  </g>
                );
              })()}

              {/* Движение воздуха — цепочка стрелок, бегущих вдоль ветви.
                  Раньше здесь был бегущий пунктир: он показывал скорость, но не
                  показывал НАПРАВЛЕНИЕ — приходилось догадываться по цвету и
                  меткам. Стрелки сразу видно, куда идёт воздух.
                  Шаг цепочки постоянный, вся цепочка сдвигается на один шаг за
                  цикл — получается непрерывный «бег» без разрывов. */}
              {showDashes && segLen > 24 && (() => {
                const angle = Math.atan2(uy, ux) * 180 / Math.PI;
                // Стрелка ТОЧНО ТАКАЯ ЖЕ, как при расчёте воздухораспределения.
                // Цвет по типу струи: КРАСНЫЙ свежая, СИНИЙ исходящая.
                const arrowColor = pollutedBranchIds.has(b.id) ? "#2563eb" : "#dc2626";
                const tipH    = w * 2.2;
                const tipW    = w * 0.5;
                const tailLen = w * 3.0;
                const tailW   = Math.max(0.5, w * 0.15);
                // Расстояние между стрелками — заметно больше прежнего, чтобы
                // цепочка читалась как отдельные стрелки, а не сплошная лента.
                const step = Math.max(70, Math.min(160, (tailLen + tipH) * 3.2));
                // Держим стрелки внутри ветви: цепочка уезжает вперёд на шаг,
                // поэтому крайние позиции считаем с запасом на этот сдвиг.
                const from0 = tailLen, to0 = segLen - tipH - step;
                if (to0 <= from0) return null;
                const count = Math.max(1, Math.floor((to0 - from0) / step) + 1);
                const pts = `0,-${tipW} ${tipH},0 0,${tipW}`;
                return (
                  <g>
                    <animateTransform attributeName="transform" type="translate"
                      from="0 0" to={`${ux * step} ${uy * step}`}
                      dur={`${animDur}s`} repeatCount="indefinite" />
                    {Array.from({ length: count }, (_, i) => {
                      const d0 = from0 + i * step;
                      const cx = sxA + ux * d0;
                      const cy = syA + uy * d0;
                      return (
                        <g key={i} transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
                          {/* Белая обводка хвостика */}
                          <line x1={-tailLen} y1={0} x2={0} y2={0}
                            stroke="white" strokeWidth={tailW + 1.5} strokeLinecap="round" />
                          {/* Белая обводка наконечника */}
                          <polygon points={pts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                          {/* Хвостик */}
                          <line x1={-tailLen} y1={0} x2={0} y2={0}
                            stroke={arrowColor} strokeWidth={tailW} strokeLinecap="round" />
                          {/* Наконечник */}
                          <polygon points={pts} fill={arrowColor} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {/* Шевроны ▶▶▶ вдоль ветви, повёрнутые по направлению потока */}
              {showChevrons && segLen > 24 && (() => {
                const step = 30;                  // px между шевронами
                const count = Math.max(1, Math.floor(segLen / step));
                const angle = Math.atan2(uy, ux) * 180 / Math.PI;
                return (
                  <g>
                    {Array.from({ length: count }, (_, i) => {
                      // фаза смещения для анимации «бегущих» шевронов
                      const t0 = (i + 1) / (count + 1);
                      const cx = sxA + dx * t0;
                      const cy = syA + dy * t0;
                      return (
                        <g key={i} transform={`translate(${cx},${cy}) rotate(${angle})`}>
                          <polygon points="-4,-4 4,0 -4,4"
                            fill={color} opacity="0.9"
                            stroke="white" strokeWidth="0.6" />
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {/* Маркер «исток» — кружок в начале потока (визуально «входит») */}
              {flowVisible && (
                <circle cx={sxA} cy={syA} r="2.5" fill={color} opacity="0.9" />
              )}

              {/* ── Трубопроводы у края ветви ──────────────────────────────────
                   Синяя линия = водопровод ППЗ (у одного края),
                   красная линия = воздухопровод / сжатый воздух (у противоположного края) ── */}
              {(b.hasWaterPipe || b.hasAirPipe) && (() => {
                // Перпендикуляр к ветви — смещаем линию к краю
                const nx = -uy; // нормаль
                const ny = ux;
                const offset = w * 0.38; // смещение от центра к краю (масштабируется с ветвью)
                // Толщина трубы = толщине «хвостика» стрелки направления воздуха (w*0.15),
                // масштабируется вместе с шириной ветви.
                const pipeSW = thinLines ? 1.0 : Math.max(0.5, w * 0.15);
                const pipeLine = (sign: number, color: string, key: string) => (
                  <line key={key}
                    x1={from.sx + nx * offset * sign} y1={from.sy + ny * offset * sign}
                    x2={to.sx + nx * offset * sign}   y2={to.sy + ny * offset * sign}
                    stroke={color} strokeWidth={pipeSW}
                    strokeLinecap="round" opacity="1" />
                );
                const showWaterPipes = !infoConfig || infoConfig.waterPipes;
                const showWaterDir = !infoConfig || infoConfig.waterFlowDirection;
                // Расход берём из результата гидравлического расчёта сети,
                // а не из wpComputedFlow (последнее не заполняется backend'ом).
                const wbrDir = waterBranchResults?.get(b.id);
                const wf = wbrDir ? (wbrDir.flow ?? 0) : (b.wpComputedFlow ?? 0);
                let waterArrow: JSX.Element | null = null;
                if (b.hasWaterPipe && showWaterPipes && showWaterDir && Math.abs(wf) > 0.001) {
                  // ВАЖНО: направление воды НЕ связано с воздухом. Считаем единичный
                  // вектор геометрически по узлам from→to (не по ux,uy — те развёрнуты
                  // по потоку воздуха), затем разворачиваем по расчёту воды flowFromTo.
                  const gdx = to.sx - from.sx, gdy = to.sy - from.sy;
                  const glen = Math.hypot(gdx, gdy) || 1;
                  const wux = gdx / glen, wuy = gdy / glen;
                  const waterFromTo = wbrDir ? (wbrDir.flowFromTo !== false) : true;
                  const dir = waterFromTo ? 1 : -1;
                  const ox = nx * offset, oy = ny * offset;
                  const mx = (from.sx + to.sx) / 2 + ox;
                  const my = (from.sy + to.sy) / 2 + oy;
                  const ah = Math.max(3, pipeSW * 2.2);
                  const dux = wux * dir, duy = wuy * dir;
                  const p1x = mx + dux * ah, p1y = my + duy * ah;
                  const p2x = mx - dux * ah * 0.5 + nx * ah * 0.6, p2y = my - duy * ah * 0.5 + ny * ah * 0.6;
                  const p3x = mx - dux * ah * 0.5 - nx * ah * 0.6, p3y = my - duy * ah * 0.5 - ny * ah * 0.6;
                  // Хвостик (стержень) — от основания треугольника назад по потоку
                  const txBase = mx - dux * ah * 0.5, tyBase = my - duy * ah * 0.5;
                  const txEnd = mx - dux * ah * 2.2, tyEnd = my - duy * ah * 2.2;
                  waterArrow = (
                    <g key="wpdir">
                      <line x1={txEnd} y1={tyEnd} x2={txBase} y2={tyBase} stroke="#dc2626" strokeWidth={pipeSW} strokeLinecap="round" />
                      <polygon points={`${p1x},${p1y} ${p2x},${p2y} ${p3x},${p3y}`} fill="#dc2626" />
                    </g>
                  );
                }
                return (
                  <>
                    {b.hasWaterPipe && showWaterPipes && pipeLine(+1, "#1d4ed8", "wp")}
                    {waterArrow}
                    {b.hasAirPipe   && pipeLine(-1, "#dc2626", "ap")}
                  </>
                );
              })()}

              {/* ── Стрелка направления воздуха (F9) — одна по центру, размер = f(w) ── */}
              {showFlowArrows && !thinLines && lodArrows && Q > 0.1 && (() => {
                const angle = Math.atan2(uy, ux) * 180 / Math.PI;
                const isPolluted = pollutedBranchIds.has(b.id);
                const arrowColor = isPolluted ? "#2563eb" : "#dc2626";
                const tipH    = w * 2.2;
                const tipW    = w * 0.5;
                const tailLen = w * 3.0;
                const tailW   = Math.max(0.5, w * 0.15);
                // Не показываем если стрелка не влезает в ветвь (как в ПО Вентиляция 2.0)
                if (segLen < (tailLen + tipH) * 2) return null;
                const cx = sxA + dx * 0.5;
                const cy = syA + dy * 0.5;
                const pts = `0,-${tipW} ${tipH},0 0,${tipW}`;
                return (
                  <g transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
                    {/* Белая обводка хвостика */}
                    <line x1={-tailLen} y1={0} x2={0} y2={0}
                      stroke="white" strokeWidth={tailW + 1.5} strokeLinecap="round" />
                    {/* Белая обводка наконечника */}
                    <polygon points={pts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                    {/* Хвостик */}
                    <line x1={-tailLen} y1={0} x2={0} y2={0}
                      stroke={arrowColor} strokeWidth={tailW} strokeLinecap="round" />
                    {/* Наконечник */}
                    <polygon points={pts} fill={arrowColor} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
                  </g>
                );
              })()}


              {lodLabels && (() => {
                // Индивидуальные индикаторы ветви переопределяют глобальный infoConfig
                const ic = (b.indicators && Object.keys(b.indicators).length > 0)
                  ? { ...(infoConfig ?? {}), ...b.indicators } as typeof infoConfig
                  : infoConfig;
                const labelOpacity = Math.min(1, (view.scale - 0.04) / 0.08);
                const branchNum = b.id.replace(/^B/, "");
                const hasCalc = (Q > 0 || b.velocity > 0) && !isDead;
                const showNum = !ic || ic.branchNumber;

                const dataLines: string[] = [];
                if (isDead) {
                  // тупиковая ветвь — ничего не показываем
                } else if (ic) {
                  const uFlow = getUnit(unitsConfig, "flow");
                  const uVel  = getUnit(unitsConfig, "velocity");
                  const uPres = getUnit(unitsConfig, "pressure");
                  const uLen  = getUnit(unitsConfig, "length");
                  const uArea = getUnit(unitsConfig, "area");
                  const uRes  = getUnit(unitsConfig, "resistance");
                  if (ic.branchName && b.type) dataLines.push(b.type);
                  if (ic.branchLength) dataLines.push(`L=${uLen.fromBase(len).toFixed(uLen.decimals)}${uLen.symbol}`);
                  if (ic.branchAngle) dataLines.push(`A=${(b.angle ?? 0).toFixed(1)}°`);
                  if (ic.branchSection) dataLines.push(`S=${uArea.fromBase(b.area).toFixed(uArea.decimals)}${uArea.symbol}`);
                  if (ic.branchResistance) dataLines.push(`R=${fmtR(b.resistance * 1000, uRes)}`);
                  if (ic.branchAlpha) dataLines.push(`α=${(b.alphaCoef ?? 0).toFixed(0)}·10⁻⁴`);
                  if (ic.branchVMax) dataLines.push(`Vmax=${uVel.fromBase(b.vMax ?? 0).toFixed(uVel.decimals)}${uVel.symbol}`);
                  if (ic.branchVelocity && hasCalc) dataLines.push(`V=${uVel.fromBase(b.velocity).toFixed(uVel.decimals)}${uVel.symbol}${overV ? "⚠" : ""}`);
                  if ((ic.branchFlow || ic.branchFlowCalc) && hasCalc) dataLines.push(`Q=${Qsign}${uFlow.fromBase(Q).toFixed(uFlow.decimals)}${uFlow.symbol}`);
                  if (ic.branchDepression && hasCalc) dataLines.push(`Н=${uPres.fromBase(b.dP).toFixed(uPres.decimals)}${uPres.symbol}`);
                  // Показатели вентилятора в подписи ветви БОЛЬШЕ НЕ выводим —
                  // они рисуются отдельной подписью у значка вентилятора (см.
                  // блок «Индикаторы вентилятора на схеме» ниже).
                  // ─── Водопроводные показатели трубы (вкладка «Водопровод») ───
                  if (b.hasWaterPipe) {
                    if (ic.waterVelocity && (b.wpComputedVelocity ?? 0) > 0)
                      dataLines.push(`Vв=${(b.wpComputedVelocity ?? 0).toFixed(2)} м/с`);
                    if (ic.waterFlow && (b.wpComputedFlow ?? 0) > 0)
                      dataLines.push(`Qв=${(b.wpComputedFlow ?? 0).toFixed(1)} м³/ч`);
                    if (ic.waterReducerPressure && b.wpHasReducer) {
                      const wbr = waterBranchResults?.get(b.id);
                      const pIn  = wbr && wbr.reducerInP > 0 ? wbr.reducerInP : null;
                      const pOut = wbr && wbr.reducerOutP > 0 ? wbr.reducerOutP : (b.wpReducerOutPressure ?? 0);
                      dataLines.push(pIn != null
                        ? `Ред: ${pIn.toFixed(2)}→${pOut.toFixed(2)} МПа`
                        : `Ред: →${pOut.toFixed(2)} МПа`);
                    }
                  }
                } else if (hasCalc) {
                  dataLines.push(`Q=${Qsign}${Q.toFixed(1)}`);
                  if (b.velocity > 0) dataLines.push(`V=${b.velocity.toFixed(1)}`);
                }

                // Все строки: номер (если нужен) + данные
                const allLines = showNum ? [branchNum, ...dataLines] : dataLines;
                if (allLines.length === 0) return null;

                // Масштаб текста пропорционален ширине ветви, с лимитом [0.3..2.5]
                const branchPxLabel = (thinLines ? 1 : (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth)) * objSF;
                const textSc = Math.max(0.3, branchPxLabel * 0.28) * (b.labelSize ?? 1);
                const lh = 11 * textSc;
                const bh = allLines.length * lh + 4 * textSc;
                const lox = (b.labelOffsetX ?? 0) * objSF;
                const loy = (b.labelOffsetY ?? -16) * objSF;
                const labelAng = b.labelAngle ?? 0;
                const anchorX = midX + lox;
                const anchorY = midY + loy;
                const hasMoved = Math.abs(lox) > 5 * objSF || Math.abs(loy + 16 * objSF) > 5 * objSF;

                return (
                  <g opacity={labelOpacity}>
                    {/* Выноска если метка сдвинута */}
                    {hasMoved && (
                      <line x1={midX} y1={midY} x2={anchorX} y2={anchorY}
                        stroke="#94a3b8" strokeWidth={0.7} strokeDasharray="3 2"
                        pointerEvents="none" />
                    )}
                    {/* Весь блок: номер + данные — единый текст без обводки кружком */}
                    <g
                      transform={`translate(${anchorX},${anchorY}) rotate(${labelAng})`}
                      style={{ cursor: onBranchLabelOffset ? "grab" : "default" }}
                      onMouseDown={onBranchLabelOffset ? (e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const origOx = b.labelOffsetX ?? 0;
                        const origOy = b.labelOffsetY ?? -16;
                        const onMove = (me: MouseEvent) => {
                          onBranchLabelOffset(b.id, origOx + (me.clientX - startX) / objSF, origOy + (me.clientY - startY) / objSF);
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      } : undefined}
                      onDoubleClick={onBranchLabelOffset ? (e) => {
                        e.stopPropagation();
                        onBranchLabelOffset(b.id, 0, -16);
                      } : undefined}
                    >
                      {allLines.map((ln, li) => (
                        <text key={li} textAnchor="middle" dominantBaseline="middle"
                          y={-bh / 2 + lh * (li + 0.6)}
                          fontSize={li === 0 && showNum ? (branchNum.length > 2 ? 7.5 : 9) * textSc : 8.5 * textSc}
                          fontWeight="600"
                          fill={li === 0 && showNum ? (isSel ? "#2563eb" : "#374151") : (overV ? "#dc2626" : "#1e3a5f")}
                          style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 * textSc, strokeLinejoin: "round" }}>
                          {ln}
                        </text>
                      ))}
                    </g>
                  </g>
                );
              })()}
              {/* ── Невидимый хитбокс — широкая прозрачная линия для захвата кликов ── */}
              {/* Минимум 12px, чтобы короткие и тонкие ветви легко кликались */}
              <line
                x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke="transparent"
                strokeWidth={Math.max(12, w + 8)}
                strokeLinecap="round"
                style={{ cursor: "pointer" }}
              />

            </g>
          );
        });
          // ── СБОРКА ПО СЛОЯМ-ГОРИЗОНТАМ (как слои Photoshop) ─────────────
          // border и fill выровнены по индексу с branchesSorted (которая уже
          // отсортирована так, что верхние горизонты идут последними).
          // Группируем по горизонту: внутри слоя сначала ВСЕ border, затем ВСЕ
          // fill (чтобы стыки в узлах были цельными), а сами слои идут по порядку
          // горизонтов — поэтому окантовка верхнего горизонта не перекрывается
          // заливкой нижнего.
          const layered: React.ReactNode[] = [];
          const layerGroups: { order: number; node: React.ReactNode }[] = [];
          let gi = 0;
          while (gi < branchesSorted.length) {
            const curOrder = branchesSorted[gi].hOrder;
            const start = gi;
            while (gi < branchesSorted.length && branchesSorted[gi].hOrder === curOrder) gi++;
            const borderGroup = borderPass.slice(start, gi);
            const fillGroup = fillPass.slice(start, gi);
            const node = (
              <g key={`hlayer-${curOrder}-${start}`}>
                {borderGroup}
                {fillGroup}
              </g>
            );
            layered.push(node);
            layerGroups.push({ order: curOrder, node });
          }
          // Публикуем слои ветвей — их переиспользует блок УО для корректного
          // z-order символов между горизонтами (см. блок УСЛОВНЫЕ ОБОЗНАЧЕНИЯ).
          branchLayerGroupsRef.current = layerGroups;
          // ── ПРОХОД ЗАДЫМЛЕНИЯ: дым ПОВЕРХ всех слоёв-горизонтов ───────────
          // Рисуем единым проходом ПОСЛЕ {layered}, чтобы ветви вышележащих
          // горизонтов не перекрывали дым нижних (в SVG порядок = z-order).
          const smokePass = (branchFireColors && branchFireColors.size > 0)
            ? branchesSorted.map(({ branch: b }) => {
                const fireSeg = branchFireColors.get(b.id);
                if (!fireSeg) return null;
                const from = projNodesMap.get(b.fromId);
                const to   = projNodesMap.get(b.toId);
                if (!from || !to) return null;
                const fanReverseOverride = b.hasFan && (b.fanReverse ?? false) && b.flow >= 0;
                const reversed = b.flow < 0 || fanReverseOverride;
                const sxA = reversed ? to.sx : from.sx;
                const syA = reversed ? to.sy : from.sy;
                const sxB = reversed ? from.sx : to.sx;
                const syB = reversed ? from.sy : to.sy;
                const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
                const w = thinLines ? 1 : Math.max(bw * objSF, 1.0);
                const { color: fireCol, fromT, toT } = fireSeg;
                const fsx = sxA + (sxB - sxA) * fromT;
                const fsy = syA + (syB - syA) * fromT;
                const tsx = sxA + (sxB - sxA) * toT;
                const tsy = syA + (syB - syA) * toT;
                return (
                  <line key={`smoke-${b.id}`} x1={fsx} y1={fsy} x2={tsx} y2={tsy}
                    stroke={fireCol} strokeWidth={Math.max(w * 0.7, 2)}
                    strokeLinecap="round" opacity="0.95" pointerEvents="none" />
                );
              })
            : null;
          // Публикуем дым — рисуем его ПОСЛЕ блока УО (см. smokePassRef ниже),
          // иначе перерисовка ветвей верхних горизонтов перекрывает дым.
          smokePassRef.current = smokePass;
          return <>{comparePass}{posOuterPass}{highlightPass}{layered}</>;
        })()}

        {/* Превью создания ветви */}
        {tool === "branch" && branchFrom && hoverScreenPos && (() => {
          const from = projNodesMap.get(branchFrom);
          if (!from) return null;
          // В SVG-режиме используем экранные координаты курсора напрямую —
          // они уже в пространстве SVG и не требуют пересчёта через project3D.
          // hoverPos хранит мировые координаты (после деления на xyScale),
          // а project3D ожидает масштабированные (×xyScale) — поэтому используем hoverScreenPos.
          return (<>
            <line x1={from.sx} y1={from.sy} x2={hoverScreenPos.sx} y2={hoverScreenPos.sy}
              stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.7" />
            <circle cx={hoverScreenPos.sx} cy={hoverScreenPos.sy} r={4}
              fill="white" stroke="#2563eb" strokeWidth="1.5" opacity="0.8" />
          </>);
        })()}

        {/* Ghost-символ в режиме ожидания привязки (Ctrl+V / Ctrl+D) */}
        {pendingSymbolTypeId && hoverScreenPos && (() => {
          const lt = LEGEND_TYPES.find(l => l.id === pendingSymbolTypeId);
          if (!lt) return null;
          const ghostSF = fixedObjectScale ? 1 : view.scale / 0.4;
          const SZ = Math.max(4, 32 * ghostSF);
          let gsx = hoverScreenPos.sx, gsy = hoverScreenPos.sy;
          // Если над ветвью — снэп к ветви
          if (hoverBranchId) {
            const br = branches.find(b => b.id === hoverBranchId);
            const fN = br ? projNodesMap.get(br.fromId) : null;
            const tN = br ? projNodesMap.get(br.toId) : null;
            if (fN && tN) {
              const C = tN.sx - fN.sx, D = tN.sy - fN.sy;
              const A = hoverScreenPos.sx - fN.sx, B = hoverScreenPos.sy - fN.sy;
              const lenSq = C * C + D * D;
              const t = lenSq > 0 ? Math.max(0.05, Math.min(0.95, (A * C + B * D) / lenSq)) : 0.5;
              gsx = fN.sx + C * t;
              gsy = fN.sy + D * t;
            }
          }
          return (
            <g opacity={0.6} style={{ pointerEvents: "none" }}>
              {hoverBranchId && (
                <circle cx={gsx} cy={gsy} r={SZ * 0.7}
                  fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="4 3" />
              )}
              <svg x={gsx - SZ / 2} y={gsy - SZ / 2 - 4} width={SZ} height={SZ}
                viewBox="0 0 48 40" overflow="visible"
                dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
            </g>
          );
        })()}

        {/* ─── УСЛОВНЫЕ ОБОЗНАЧЕНИЯ (canvas-оверлей — см. ниже) ─────────── */}
        {!useCanvas && (() => {
          const renderOne = (sym: typeof schemaSymbolsSorted[number]): React.ReactNode => {
          const isBulkheadEarly = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
          const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
          // Перемычки рисуются геометрически — не требуют lt из LEGEND_TYPES
          if (!lt && !isBulkheadEarly) return null;
          // Если УО привязано к ветви скрытого горизонта — скрываем его вместе с ветвью
          if (sym.branchId && hiddenBranchIds.has(sym.branchId)) return null;
          // Видимость запорного вентиля по всей схеме — переключатель в панели информации
          if (sym.typeId === "valve_water" && infoConfig && !infoConfig.waterGateValve) return null;
          // Видимость насоса (УО «Насос» = «Насосная станция» в панели информации)
          if (sym.typeId === "pump" && infoConfig && !infoConfig.waterPumpStation) return null;
          // Видимость редукционного клапана
          if (sym.typeId === "valve_reduce" && infoConfig && !infoConfig.waterReducer) return null;

          // Ветвь символа (один раз, O(1)) — переиспользуем ниже.
          const symBrSvg = sym.branchId ? branchById.get(sym.branchId) : null;

          let basePx: number, basePy: number;
          let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;

          if (sym.branchId) {
            const br = symBrSvg;
            const fN = br ? projNodesMap.get(br.fromId) : null;
            const tN = br ? projNodesMap.get(br.toId) : null;
            if (fN && tN) {
              fsx = fN.sx; fsy = fN.sy; tsx2 = tN.sx; tsy2 = tN.sy;
              hasBranchPts = true;
              const t = sym.t ?? 0.5;
              basePx = fsx + (tsx2 - fsx) * t;
              basePy = fsy + (tsy2 - fsy) * t;
            } else {
              const pt = projectWithZ({ x: sym.x, y: sym.y, z: 0 });
              basePx = pt.sx; basePy = pt.sy;
            }
          } else {
            const pt = projectWithZ({ x: sym.x, y: sym.y, z: 0 });
            basePx = pt.sx; basePy = pt.sy;
          }

          // Применяем offset (смещение в экранных координатах)
          const px = basePx + (sym.offsetX ?? 0);
          const py = basePy + (sym.offsetY ?? 0);

          const isSel = selectedSymbolId === sym.id || (selectedSymbolIds?.has(sym.id) ?? false);
          const sc = sym.scale ?? 1;
          // Символы: базовый размер 32px при zoom=0.4, масштабируются пропорционально zoom
          // Та же логика что в canvas-оверлее (symScaleV)
          let symSF: number;
          if (fixedObjectScale) {
            if (view.scale < 0.4) { symSF = view.scale / 0.4; }
            else { const k = (view.scale - 0.4) / 0.4; symSF = 1 + 2 * (k / (k + 2)); }
          } else {
            symSF = view.scale / 0.4;
          }

          // Авто-масштаб УО «Очаг пожара» и перемычек от ширины ветви
          let SZ: number;
          if (sym.typeId === "fire_source" && sym.branchId && hasBranchPts) {
            const fireBwSvg = (symBrSvg?.lineWidth && symBrSvg.lineWidth > 0) ? symBrSvg.lineWidth : branchWidth;
            const autoSZsvg = Math.max(8, fireBwSvg * view.scale * 4);
            SZ = Math.max(8, autoSZsvg * sc);
          } else if ((BULKHEAD_SYMBOL_IDS.has(sym.typeId) || HEATER_SYMBOL_IDS.has(sym.typeId) || sym.typeId === "measure_station" || sym.typeId === "emergency_exit") && sym.branchId && hasBranchPts) {
            const bkBw = (symBrSvg?.lineWidth && symBrSvg.lineWidth > 0) ? symBrSvg.lineWidth : branchWidth;
            // Размер перемычки = реальная ширина ветви на экране × bulkheadScale%.
            // _objSF — тот же коэффициент толщины ветви, что и при отрисовке ветвей,
            // поэтому перемычка масштабируется синхронно с шириной ветви (в т.ч. масштаб XY).
            const realBw = Math.max(bkBw * _branchObjSF, 1.0);
            SZ = Math.max(6, (realBw * (bulkheadScale / 100) / 0.85) * sc);
          } else if ((sym.typeId === "fan" || sym.typeId === "pump" || sym.typeId === "valve_water" || sym.typeId === "valve_reduce") && sym.branchId && hasBranchPts) {
            // Вентилятор, насос, запорный вентиль и редукционный клапан
            // масштабируются от ширины ветви (как перемычка), поэтому синхронны
            // с масштабом схемы и не «плавают» при зуме.
            const fanBw = (symBrSvg?.lineWidth && symBrSvg.lineWidth > 0) ? symBrSvg.lineWidth : branchWidth;
            const realBwFan = Math.max(fanBw * _branchObjSF, 1.0);
            SZ = Math.max(8, realBwFan * (fanScale / 100) * sc);
          } else {
            SZ = Math.max(4, 32 * sc * symSF);
          }

          // Минимальный размер hitbox: 28px, чтобы в мелком масштабе всегда можно было кликнуть
          const HIT_MIN = 28;
          const HX = px - SZ / 2;
          const HY = py - SZ / 2 - 4;

          // Вентилятор остановлен — серый фильтр на символ
          const brForSym = symBrSvg;
          const isFanStopped = sym.typeId === "fan" && (brForSym?.fanStopped ?? false);

          return (
            <g key={sym.id}
              data-sym={sym.id}
              style={{ cursor: "default" }}
              onContextMenu={(e) => {
                if (tool !== "select") return;
                e.preventDefault();
                e.stopPropagation();
                onSelectSymbol?.(sym.id);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                const t = e.touches[0];
                symTouchRef.current = { x: t.clientX, y: t.clientY };
              }}
              onTouchEnd={(e) => {
                e.stopPropagation();
                if (tool !== "select" || !symTouchRef.current) return;
                const t = e.changedTouches[0];
                const moved = Math.hypot(t.clientX - symTouchRef.current.x, t.clientY - symTouchRef.current.y);
                symTouchRef.current = null;
                if (moved < 10) {
                  handleSymbolClick(sym.id, false);
                }
              }}
              onMouseDown={(e) => {
                // В режиме выбора узла для горноспасателей символ не перехватывает
                // клик — отдаём его общему обработчику схемы (выбор узла под символом).
                if (rescuePickMode && e.button === 0) { onMouseDown(e as unknown as React.MouseEvent<SVGSVGElement>); return; }
                if (e.button !== 0 || tool !== "select") return;
                e.stopPropagation();

                const startX = e.clientX, startY = e.clientY;
                let didDrag = false;
                setDraggingSymbolId(sym.id);

                if (sym.branchId && hasBranchPts) {
                  const snapFsx = fsx, snapFsy = fsy, snapTsx = tsx2, snapTsy = tsy2;
                  const brLen2 = (snapTsx - snapFsx) ** 2 + (snapTsy - snapFsy) ** 2;
                  const origOx = sym.offsetX ?? 0;
                  const origOy = sym.offsetY ?? 0;
                  const svgEl = (e.currentTarget as SVGElement).closest("svg")!;

                  const onMove = (me: MouseEvent) => {
                    if (!didDrag && Math.hypot(me.clientX - startX, me.clientY - startY) < 4) return;
                    if (!didDrag) onSymbolDragStart?.(sym.id);
                    didDrag = true;
                    me.preventDefault();
                    const dx = me.clientX - startX;
                    const dy = me.clientY - startY;
                    if (me.ctrlKey || me.altKey) {
                      onSymbolOffset?.(sym.id, origOx + dx, origOy + dy);
                    } else {
                      if (brLen2 < 1) return;
                      const svgRect = svgEl.getBoundingClientRect();
                      const mx = me.clientX - svgRect.left;
                      const my = me.clientY - svgRect.top;
                      const raw = ((mx - snapFsx) * (snapTsx - snapFsx) + (my - snapFsy) * (snapTsy - snapFsy)) / brLen2;
                      const t = Math.max(0.02, Math.min(0.98, raw));
                      onSymbolMoveAlongBranch?.(sym.id, t);
                    }
                  };
                  const onUp = (ue: MouseEvent) => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    setDraggingSymbolId(null);
                    if (!didDrag) {
                      handleSymbolClick(sym.id, ue.ctrlKey || ue.metaKey);
                    }
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                } else if (!sym.branchId) {
                  const origX = sym.x, origY = sym.y;
                  const onMove = (me: MouseEvent) => {
                    if (!didDrag && Math.hypot(me.clientX - startX, me.clientY - startY) < 4) return;
                    if (!didDrag) onSymbolDragStart?.(sym.id);
                    didDrag = true;
                    me.preventDefault();
                    const dx = (me.clientX - startX) / view.scale;
                    const dy = -(me.clientY - startY) / view.scale;
                    onSymbolMove?.(sym.id, origX + dx, origY + dy);
                  };
                  const onUp = (ue: MouseEvent) => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    setDraggingSymbolId(null);
                    if (!didDrag) {
                      handleSymbolClick(sym.id, ue.ctrlKey || ue.metaKey);
                    }
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                } else {
                  const onUp = (ue: MouseEvent) => {
                    window.removeEventListener("mouseup", onUp);
                    setDraggingSymbolId(null);
                    handleSymbolClick(sym.id, ue.ctrlKey || ue.metaKey);
                  };
                  window.addEventListener("mouseup", onUp);
                }
              }}>
              {/* Прозрачный hitbox — ПЕРВЫМ в DOM, но накрываем сверху повторным rect в конце */}
              {/* Рамка выделения */}
              {isSel && (
                <circle cx={px} cy={py} r={SZ / 2 + 4}
                  fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2"
                  style={{ pointerEvents: "none" }} />
              )}
              {/* SVG-символ (pointerEvents=none — события только через hitbox) */}
              <g style={{ pointerEvents: "none" }}>
              {(() => {
                // ── Запасной выход: по направлению и ширине ветви ──
                if (sym.typeId === "emergency_exit" && sym.branchId && hasBranchPts) {
                  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                  const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
                  // Ширина символа = точно ширина ветви на экране
                  const eeBwS = (symBrSvg?.lineWidth && symBrSvg.lineWidth > 0) ? symBrSvg.lineWidth : branchWidth;
                  const halfH = Math.max(1.2, (Math.max(eeBwS * _branchObjSF, 1.0) / 2) * sc);
                  const totalLen = halfH * 5.2;   // длиннее вдоль ветви
                  const yW = totalLen / 4.4;   // жёлтая
                  const bW = totalLen / 3.7;   // чёрная (чуть больше)
                  const seq: { w: number; fill: string }[] = [
                    { w: yW, fill: "#ffd600" },
                    { w: bW, fill: "#111" },
                    { w: yW, fill: "#ffd600" },
                    { w: bW, fill: "#111" },
                  ];
                  const sumW = seq.reduce((s, p) => s + p.w, 0);
                  let cursor = -sumW / 2;
                  return (
                    <g transform={`translate(${px},${py}) rotate(${brAngle})`}>
                      {seq.map((p, i) => {
                        const x = cursor;
                        cursor += p.w;
                        return (
                          <rect key={i} x={x} y={-halfH} width={p.w} height={halfH * 2}
                            fill={p.fill} stroke="none" />
                        );
                      })}
                    </g>
                  );
                }
                // ── Калорифер на ветви ───────────────────────────────
                // Рисуется примитивами и поворачивается вдоль ветви — так же,
                // как перемычка, поэтому масштабируется синхронно с шириной
                // выработки и не «плавает» при зуме.
                if (HEATER_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts) {
                  const brAngle = Math.atan2(tsy2 - fsy, tsx2 - fsx) * 180 / Math.PI;
                  const ph = Math.max(3, SZ * 0.85);        // поперёк ветви
                  const pw = Math.max(2, ph * 0.55);        // вдоль ветви
                  const sw2 = Math.max(0.4, pw * 0.14);
                  const coils = 4;
                  const lines = [];
                  for (let i = 0; i < coils; i++) {
                    const y = -ph / 2 + (ph / (coils + 1)) * (i + 1);
                    lines.push(
                      <line key={`hc${i}`} x1={-pw * 0.32} y1={y} x2={pw * 0.32} y2={y}
                        stroke="#e65100" strokeWidth={Math.max(0.8, ph * 0.07)} strokeLinecap="round" />
                    );
                  }
                  return (
                    <g transform={`translate(${px},${py}) rotate(${brAngle})`}>
                      <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph}
                        fill="#fff3e0" stroke="#1a1a1a" strokeWidth={sw2} />
                      {lines}
                    </g>
                  );
                }
                const isBulkhead = BULKHEAD_SYMBOL_IDS.has(sym.typeId) || sym.typeId === "measure_station";
                if (isBulkhead && sym.branchId && hasBranchPts) {
                  // ── Перемычка на ветви: рисуем напрямую примитивами ──
                  // Координатная система после rotate: X вдоль ветви, Y поперёк
                  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                  const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
                  const tid = sym.typeId;
                  const brForDestroy = symBrSvg;
                  const isDestroyedBk = brForDestroy?.bulkheadDestroyedByExplosion ?? false;

                  // Цвет заливки и обводки по материалу (красный если разрушена)
                  const fill  = isDestroyedBk ? "#ff4444"
                    : tid.includes("conc") ? "#4caf50"
                    : tid.includes("wood")     ? "#ffd600"
                    : tid.includes("brick")    ? "#ff9800"
                    : tid.includes("metal")    ? "#9c27b0"
                    : tid.includes("regulator") ? "#ffd600"
                    : (tid === "fire_door" || tid === "fire_door_pp") ? "#c00"
                    : (tid === "barrier")      ? "#555"
                    : "white";
                  // Контур перемычки — всегда чёрный (кроме разрушенной и
                  // противопожарной), чтобы не сливался с заливкой по материалу
                  // (напр. деревянная — жёлтая: жёлтая заливка + жёлтый контур).
                  const stroke = isDestroyedBk ? "#8b0000"
                    : (tid === "fire_door" || tid === "fire_door_pp") ? "#800"
                    : "#1a1a1a";

                  // ── Размеры символа ──────────────────────────────────
                  // После rotate(brAngle): X — вдоль ветви, Y — поперёк
                  // ph — высота прямоугольника ПОПЕРЁК ветви (по Y)
                  // pw — ширина прямоугольника ВДОЛЬ ветви (по X)
                  // Размеры пропорциональны SZ — символ масштабируется полностью,
                  // а не только контур. Минимумы маленькие, чтобы при сильном
                  // уменьшении не пропадал совсем.
                  const ph = Math.max(3, SZ * 0.85);                  // поперёк (Y)
                  const pw = Math.max(1.5, ph * 0.38);                // вдоль (X)
                  const gap = Math.max(1, pw * 0.5);                  // зазор двери

                  // Флаги типа
                  const isMeasureStation = tid === "measure_station";
                  const isDoor    = tid.includes("door_closed") || tid.includes("door_conc") ||
                                    tid.includes("door_wood")   || tid.includes("door_brick") ||
                                    tid.includes("door_metal")  || tid === "door_base";
                  const isAuto    = tid.includes("door_auto") || tid.includes("auto_");
                  const isOpen    = tid.includes("regulator_open") || tid.includes("open_");
                  const isWindow  = tid === "regulator_window" || tid.includes("win_") || tid === "bulkhead_window";
                  const isLattice = tid === "regulator_lattice" || tid.includes("lat_");
                  const isWater   = tid.includes("water_dam");
                  const isSail    = tid === "sail";
                  const isBarrier = tid === "barrier" || tid === "bulkhead_barrier";
                  const isFirePP  = tid === "fire_door_pp";
                  const isProem   = tid.includes("proem_");
                  const isRegulator = tid === "regulator";
                  const sw2       = Math.max(0.4, pw * 0.18);  // толщина обводки

                  return (
                    <g transform={`translate(${px},${py}) rotate(${brAngle})`}>
                      {isMeasureStation ? (() => {
                        // Замерная станция: две красные полосы ВДОЛЬ ветви
                        // После rotate(brAngle): X — вдоль ветви, Y — поперёк
                        // Полоса: длинная по X (ml), тонкая по Y (mt); разнесены по Y
                        const ml = ph * 1.1;               // длина полосы вдоль ветви
                        const mt = Math.max(1.5, ph * 0.22); // толщина полосы поперёк
                        const moff = Math.max(1, ph * 0.17); // смещение от центра по Y
                        const sw = Math.max(0.4, mt * 0.12);
                        return (
                          <>
                            <rect x={-ml / 2} y={-moff - mt} width={ml} height={mt}
                              fill="#dc2626" stroke="#8b0000" strokeWidth={sw} />
                            <rect x={-ml / 2} y={moff} width={ml} height={mt}
                              fill="#dc2626" stroke="#8b0000" strokeWidth={sw} />
                          </>
                        );
                      })() : isSail ? (
                        // Парус: вертикальная линия поперёк (по Y) + полукруг
                        <>
                          <line x1={0} y1={-ph/2} x2={0} y2={ph/2}
                            stroke={stroke} strokeWidth={Math.max(1.8, pw * 0.4)} strokeLinecap="round" />
                          <path d={`M0,${-ph*0.38} Q${ph*0.6},0 0,${ph*0.38}`}
                            fill="none" stroke={stroke} strokeWidth={Math.max(1.8, pw * 0.4)} strokeLinecap="round" />
                        </>
                      ) : isBarrier ? (
                        // Барьерная: два столба вдоль (по X) рядом, поперёк ветви
                        <>
                          <rect x={-pw} y={-ph/2} width={pw} height={ph}
                            fill="#555" stroke="#222" strokeWidth={1.3} />
                          <rect x={0}   y={-ph/2} width={pw} height={ph}
                            fill="#c00" stroke="#800" strokeWidth={1.3} />
                        </>
                      ) : isFirePP ? (
                        // Противопожарная: две красные вертикальные полосы с зазором
                        <>
                          <rect x={-pw - gap/2} y={-ph/2} width={pw} height={ph}
                            fill="#dc2626" stroke="#8b0000" strokeWidth={1.3} />
                          <rect x={gap/2}       y={-ph/2} width={pw} height={ph}
                            fill="#dc2626" stroke="#8b0000" strokeWidth={1.3} />
                        </>
                      ) : isOpen ? (
                        // ── Дверь открытая: два блока + диагональная створка ──
                        // В системе координат rotate(brAngle): X вдоль ветви, Y поперёк
                        // Верхний блок — верхняя половина по Y
                        // Нижний блок — нижняя половина по Y
                        // Створка — диагональ от нижнего-левого угла нижнего блока
                        <>
                          {/* Верхний блок */}
                          <rect x={-pw/2} y={-ph/2} width={pw} height={ph*0.38}
                            fill={fill} stroke={stroke} strokeWidth={sw2} />
                          {/* Нижний блок */}
                          <rect x={-pw/2} y={ph*0.12} width={pw} height={ph*0.38}
                            fill={fill} stroke={stroke} strokeWidth={sw2} />
                          {/* Диагональная створка из угла нижнего блока */}
                          <line x1={-pw/2} y1={ph*0.12}
                                x2={-pw/2 - ph*0.45} y2={ph/2}
                            stroke={stroke} strokeWidth={Math.max(1.8, pw * 0.3)} strokeLinecap="round" />
                        </>
                      ) : (isDoor || isAuto) ? (
                        // ── Дверь закрытая / автоматическая: блок + жирная линия ──
                        <>
                          <rect x={-pw/2} y={-ph/2} width={pw} height={ph}
                            fill={fill} stroke={stroke} strokeWidth={sw2} />
                          {/* Жирная линия вдоль левого края — знак закрытой двери */}
                          <line x1={-pw/2} y1={-ph/2} x2={-pw/2} y2={ph/2}
                            stroke={stroke} strokeWidth={Math.max(2, pw * 0.35)} strokeLinecap="round" />
                          {/* Кружок «А» для автоматической */}
                          {isAuto && (
                            <g transform={`translate(${pw/2 + ph*0.28}, 0)`}>
                              <circle r={ph*0.2} fill="white" stroke={stroke} strokeWidth={1.2} />
                              <text textAnchor="middle" dominantBaseline="central"
                                fontSize={ph * 0.2} fontWeight="bold" fill={stroke}>А</text>
                            </g>
                          )}
                        </>
                      ) : (
                        // ── Глухая / с окном / решётка / водоподпорная / регулятор ──
                        <>
                          {/* Регулятор-шибер: линия-хвостики вдоль ветви сквозь заслонку */}
                          {isRegulator && (
                            <line x1={-ph} y1={0} x2={ph} y2={0}
                              stroke={stroke} strokeWidth={Math.max(1.2, pw * 0.28)} strokeLinecap="round" />
                          )}
                          <rect x={-pw/2} y={-ph/2} width={pw} height={ph}
                            fill={fill} stroke={stroke} strokeWidth={sw2} />
                          {/* Окно в центре */}
                          {(isWindow || isProem) && (
                            <rect x={-pw*0.25} y={-ph*0.2} width={pw*0.5} height={ph*0.4}
                              fill="white" stroke={stroke} strokeWidth={1} />
                          )}
                          {/* Решётка внутри блока */}
                          {isLattice && (() => {
                            const rs = [];
                            for (let i = -1; i <= 1; i++) {
                              rs.push(<line key={`v${i}`} x1={pw*0.2*i} y1={-ph*0.45} x2={pw*0.2*i} y2={ph*0.45} stroke={stroke} strokeWidth={0.8} />);
                            }
                            rs.push(<line key="h0" x1={-pw*0.4} y1={0} x2={pw*0.4} y2={0} stroke={stroke} strokeWidth={0.8} />);
                            return rs;
                          })()}
                          {/* D — водоподпорная */}
                          {isWater && (
                            <text textAnchor="middle" dominantBaseline="central"
                              fontSize={ph * 0.3} fontWeight="bold"
                              fill={fill === "white" ? "#1565c0" : "white"}>D</text>
                          )}
                          {/* ПП — противопожарная */}
                          {tid === "fire_door" && (
                            <text textAnchor="middle" dominantBaseline="central"
                              fontSize={ph * 0.22} fontWeight="bold" fill="white">ПП</text>
                          )}
                        </>
                      )}
                    </g>
                  );
                }
                // valve_reduce рисуем примитивами — квадрат вдоль ветви, треугольник поперёк
                if (sym.typeId === "valve_reduce" && hasBranchPts) {
                  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                  const brLen = Math.hypot(brDx, brDy);
                  const ax = brLen > 0 ? brDx / brLen : 1, ay = brLen > 0 ? brDy / brLen : 0;
                  // нормаль — совпадает с canvasRenderer (nx=-ddy/segL, ny=ddx/segL)
                  const nx = -ay, ny = ax;
                  // ширина ветви — из самой ветви или дефолт
                  const brObj = symBrSvg;
                  const bw = (brObj?.lineWidth && brObj.lineWidth > 0) ? brObj.lineWidth : branchWidth;
                  // смещение трубы от оси — ровно как в canvasRenderer: bw * 0.38
                  const pipeOff = bw * 0.38;
                  // центр клапана лежит на линии трубы
                  const cpx = px + nx * pipeOff;
                  const cpy = py + ny * pipeOff;
                  // Размер клапана берём из общего SZ — он считается по ширине ветви
                  // и «Масштабу УО» (как вентилятор/насос). Прежняя формула
                  // bw*view.scale*4 игнорировала ползунок «Масштаб УО».
                  const valveSZ = SZ * 1.2;
                  const HS = valveSZ * 0.55;
                  const HT = valveSZ * 0.45;
                  const lw = Math.max(0.5, valveSZ * 0.09);
                  const q = (da: number, dn: number) => `${cpx + ax*da + nx*dn},${cpy + ay*da + ny*dn}`;
                  return (
                    <g pointerEvents="none">
                      <polygon points={`${q(-HS,-HT)} ${q(HS,-HT)} ${q(HS,HT)} ${q(-HS,HT)}`}
                        fill="white" stroke="none" />
                      <polygon points={`${q(-HS,-HT)} ${q(HS,-HT)} ${q(HS,HT)} ${q(-HS,HT)}`}
                        fill="white" stroke="#1d4ed8" strokeWidth={lw} />
                      <polygon points={`${q(-HS*0.65,-HT*0.55)} ${q(HS*0.65,-HT*0.55)} ${q(0,HT*0.6)}`}
                        fill="#1d4ed8" />
                    </g>
                  );
                }
                // ── Вентиляционные струи: стрелка ВДОЛЬ ветви (как расчётная) ──
                // Красная — свежая (входящая), синяя — исходящая. Пунктир — утечка.
                // Разворот пользователем через sym.airDirection.
                if (VENT_JET_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts) {
                  const jDx = tsx2 - fsx, jDy = tsy2 - fsy;
                  const jLen = Math.hypot(jDx, jDy);
                  const ux = jLen > 0 ? jDx / jLen : 1, uy = jLen > 0 ? jDy / jLen : 0;
                  const isFreshJet = sym.typeId === "fresh_inlet" || sym.typeId === "leak_inlet";
                  const isLeakJet  = sym.typeId === "leak_inlet"  || sym.typeId === "leak_outlet";
                  const jetColor = isFreshJet ? "#dc2626" : "#2563eb";
                  // Базовое направление: свежая — по ветви, исходящая — против.
                  // Плюс пользовательский разворот airDirection.
                  let dir = isFreshJet ? 1 : -1;
                  if (sym.airDirection === "reverse") dir = -dir;
                  const ax = ux * dir, ay = uy * dir;
                  const jAngle = Math.atan2(ay, ax) * 180 / Math.PI;
                  // Размеры — 1:1 как у расчётной стрелки потока: привязка к
                  // ширине ветви w (наконечник ≤ полширины → не выходит за ветвь).
                  const jbw = (symBrSvg?.lineWidth && symBrSvg.lineWidth > 0) ? symBrSvg.lineWidth : branchWidth;
                  const w = (thinLines ? 1 : jbw) * _objSF;
                  const tipH    = w * 2.2;
                  const tipW    = w * 0.5;
                  const tailLen = w * 3.0;
                  const tailW   = Math.max(0.5, w * 0.15);
                  const scale = sym.scale ?? 1;
                  const tipHs = tipH * scale, tipWs = tipW * scale, tailLenS = tailLen * scale, tailWs = tailW * scale;
                  const pts = `0,-${tipWs} ${tipHs},0 0,${tipWs}`;
                  // Стрелку центрируем по (px,py): весь чертёж занимает [-tailLenS..tipHs]
                  // по X, середину этого отрезка совмещаем с центром символа.
                  const shift = (tailLenS - tipHs) / 2;
                  return (
                    <g transform={`translate(${px},${py}) rotate(${jAngle}) translate(${shift},0)`} pointerEvents="none">
                      {/* Белая обводка хвостика */}
                      <line x1={-tailLenS} y1={0} x2={0} y2={0}
                        stroke="white" strokeWidth={tailWs + 1.5} strokeLinecap="round" />
                      {/* Белая обводка наконечника */}
                      <polygon points={pts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                      {/* Хвостик (пунктир — для утечек) */}
                      <line x1={-tailLenS} y1={0} x2={0} y2={0}
                        stroke={jetColor} strokeWidth={tailWs} strokeLinecap="round"
                        strokeDasharray={isLeakJet ? `${tailWs * 3} ${tailWs * 2}` : undefined} />
                      {/* Наконечник */}
                      <polygon points={pts} fill={jetColor} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
                    </g>
                  );
                }
                // Остальные символы — через SVG viewBox без поворота
                if (!lt) return null;
                const svgHtml = sym.typeId === "fan" ? fanSvgContent(brForSym?.fanType) : lt.svgContent;
                return (
                  <svg x={HX} y={HY} width={SZ} height={SZ} viewBox="0 0 48 40"
                    overflow="visible"
                    opacity={isFanStopped ? 0.35 : 1}
                    style={isFanStopped ? { filter: "grayscale(1)" } : undefined}
                    pointerEvents="none"
                    dangerouslySetInnerHTML={{ __html: svgHtml }} />
                );
              })()}
              {/* Крестик на остановленном вентиляторе */}
              {isFanStopped && (
                <g opacity={0.7}>
                  <line x1={HX + SZ * 0.2} y1={HY + SZ * 0.2} x2={HX + SZ * 0.8} y2={HY + SZ * 0.8}
                    stroke="#6b7280" strokeWidth={Math.max(2, SZ / 14)} strokeLinecap="round" />
                  <line x1={HX + SZ * 0.8} y1={HY + SZ * 0.2} x2={HX + SZ * 0.2} y2={HY + SZ * 0.8}
                    stroke="#6b7280" strokeWidth={Math.max(2, SZ / 14)} strokeLinecap="round" />
                </g>
              )}
              {/* 🔴 Закрытый запорный вентиль — красная подсветка (перекрыто) */}
              {sym.typeId === "valve_water" && (brForSym?.wpGateClosed ?? false) && (() => {
                const r = Math.max(7, SZ * 0.62);
                return (
                  <g pointerEvents="none">
                    <circle cx={px} cy={py} r={r + 4} fill="#ef4444" opacity={0.16} />
                    <circle cx={px} cy={py} r={r} fill="none" stroke="#dc2626"
                      strokeWidth={Math.max(1.5, SZ / 12)} />
                  </g>
                );
              })()}
              {/* ⚡ Маркер разрушенной перемычки (взрыв) */}
              {BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts && (() => {
                const br = symBrSvg;
                if (!br?.bulkheadDestroyedByExplosion) return null;
                const cx = px, cy = py;
                const r = Math.max(8, SZ * 0.7);
                const lw = Math.max(2.5, SZ * 0.22);
                const brDxD = tsx2 - fsx, brDyD = tsy2 - fsy;
                const brAngleD = Math.atan2(brDyD, brDxD) * 180 / Math.PI;
                const fp = br.bulkheadFailurePressure;
                const fpText = fp && fp > 0 ? `${fp} МПа` : null;
                return (
                  <g>
                    {/* Красное свечение */}
                    <circle cx={cx} cy={cy} r={r + 8} fill="#ef4444" opacity={0.18} />
                    <circle cx={cx} cy={cy} r={r + 4} fill="#ef4444" opacity={0.28} />
                    {/* Основной круг */}
                    <circle cx={cx} cy={cy} r={r}
                      fill="#fef08a" stroke="#dc2626" strokeWidth={Math.max(2, lw * 0.6)} opacity={0.95} />
                    {/* Зубчатый разрыв вдоль оси ветви */}
                    <g transform={`translate(${cx},${cy}) rotate(${brAngleD})`}>
                      <polyline
                        points={`${-r * 0.9},0 ${-r * 0.45},${-r * 0.35} ${0},${r * 0.35} ${r * 0.45},${-r * 0.35} ${r * 0.9},0`}
                        fill="none" stroke="#dc2626" strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                    {/* Подпись «РАЗР.» */}
                    <text x={cx} y={cy - r - 5}
                      textAnchor="middle" fontSize={Math.max(8, SZ * 0.38)}
                      fontWeight="bold" fontFamily="sans-serif"
                      fill="#dc2626" stroke="white" strokeWidth={2} paintOrder="stroke">
                      РАЗР.
                    </text>
                    {/* Давление разрушения */}
                    {fpText && (
                      <text x={cx} y={cy + r + Math.max(10, SZ * 0.45)}
                        textAnchor="middle" fontSize={Math.max(7, SZ * 0.3)}
                        fontFamily="sans-serif" fill="#7f1d1d"
                        stroke="white" strokeWidth={1.5} paintOrder="stroke">
                        {fpText}
                      </text>
                    )}
                  </g>
                );
              })()}
              {/* Маленькая стрелка направления — выходит из границы окружности
                  вентилятора/насоса. Можно отключить в свойствах. */}
              {!isFanStopped && (sym.typeId === "fan" || sym.typeId === "pump") && sym.branchId && hasBranchPts
                && (sym.showFanArrow ?? true) && (() => {
                const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
                const arrowAngle = sym.airDirection === "reverse"
                  ? brAngle + 180 : brAngle;
                // Центр иконки в экранных координатах.
                const iconCx = HX + SZ / 2;
                const iconCy = HY + SZ * (20 / 48);
                // Радиус круга в SVG: 16 из 48 → доля 16/48.
                const rIcon = SZ * (16 / 48);
                const aLen = SZ * 0.32;                       // короткая стрелка
                const stroke = Math.max(0.8, SZ * 0.045);
                const head = Math.max(3, SZ * 0.13);
                // Цвет стрелки под цвет символа: насос — красный, вентилятор — чёрный.
                const arrCol = sym.typeId === "pump" ? "#dc2626" : "#111";
                // Хвост — на границе круга, остриё — снаружи.
                const x0 = rIcon;
                const x1 = rIcon + aLen;
                return (
                  <g transform={`translate(${iconCx},${iconCy}) rotate(${arrowAngle})`}>
                    <line x1={x0} y1={0} x2={x1 - head * 0.5} y2={0}
                      stroke={arrCol} strokeWidth={stroke} strokeLinecap="round" />
                    <polygon
                      points={`${x1 - head},${-head * 0.55} ${x1},0 ${x1 - head},${head * 0.55}`}
                      fill={arrCol} />
                  </g>
                );
              })()}
              {/* Подпись: только label (если задан), для перемычек — только если нет активных индикаторов */}
              {view.scale > 0.06 && (() => {
                const isBk = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
                // Для перемычек на ветви — подпись не показываем (индикаторы отвечают за текст)
                if (isBk && sym.branchId) return null;
                // Для остальных — только явно заданный label
                const text = sym.label ?? "";
                if (!text) return null;
                return (
                  <text x={px} y={py + SZ / 2 + 12} textAnchor="middle"
                    fontSize={Math.round(9 * sc)} fill="#374151" fontFamily="Segoe UI, sans-serif"
                    opacity={Math.min(1, (view.scale - 0.06) / 0.06)}>
                    {text}
                  </text>
                );
              })()}
              </g>{/* конец pointerEvents="none" */}
              {/* Hitbox поверх всего символа — гарантированно ловит события мыши.
                  Минимум HIT_MIN px, отступ 10px со всех сторон. */}
              {(() => {
                // Для вентиляционных струй hitbox вытянут ВДОЛЬ ветви и повёрнут,
                // чтобы клик по хвосту/острию стрелки открывал свойства.
                if (VENT_JET_SYMBOL_IDS.has(sym.typeId) && hasBranchPts) {
                  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                  const jAng = Math.atan2(brDy, brDx) * 180 / Math.PI;
                  const jbw = (symBrSvg?.lineWidth && symBrSvg.lineWidth > 0) ? symBrSvg.lineWidth : branchWidth;
                  const wj = (thinLines ? 1 : jbw) * _objSF;
                  const sc2 = sym.scale ?? 1;
                  const hLen = Math.max(HIT_MIN, (wj * 3.2 + wj * 2.2) * sc2);
                  const hThick = Math.max(HIT_MIN * 0.6, wj * 1.2 * sc2);
                  return (
                    <g transform={`translate(${px},${py}) rotate(${jAng})`}>
                      <rect x={-hLen / 2} y={-hThick / 2} width={hLen} height={hThick}
                        fill="transparent" stroke="none" />
                    </g>
                  );
                }
                const hW = Math.max(SZ + 20, HIT_MIN);
                const hH = Math.max(SZ + 20, HIT_MIN);
                return <rect x={px - hW / 2} y={py - hH / 2} width={hW} height={hH}
                  fill="transparent" stroke="none" />;
              })()}

              {/* ── Индикаторы замерной станции на схеме ─────────────── */}
              {view.scale > 0.05 && sym.typeId === "measure_station" && hasBranchPts && (() => {
                const brMs = symBrSvg;
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
                if (!msLines.length) return null;

                // Масштабируем индикатор замерной станции ТАК ЖЕ, как подписи
                // ВЕТВЕЙ (по толщине ветви branchPxLabel), а не по размеру УО —
                // чтобы подписи станции и ветви совпадали по размеру.
                const msBwLbl = (thinLines ? 1 : (brMs?.lineWidth && brMs.lineWidth > 0 ? brMs.lineWidth : branchWidth)) * _branchObjSF;
                // Индикатор уменьшается вместе со схемой (как ветви): домножаем
                // масштаб текста на _indZoomSF при отдалении.
                const msTextSc = Math.max(0.3, msBwLbl * 0.28) * _indZoomSF;
                const baseFontPx = 8.5 * msTextSc * ((sym.msIndFontSize ?? 9) / 9);
                const fSize = Math.max(3, baseFontPx);
                const lineH = fSize + 3 * _indZoomSF;
                const boxW  = Math.max(...msLines.map(l => l.length)) * fSize * 0.52 + 10 * _indZoomSF;
                const boxH  = msLines.length * lineH + 6 * _indZoomSF;
                const brDx  = tsx2 - fsx, brDy = tsy2 - fsy;
                const brLen = Math.hypot(brDx, brDy);
                const perpX = brLen > 0 ? -brDy / brLen : 0;
                const perpY = brLen > 0 ?  brDx / brLen : 0;
                // Отступ и смещение уменьшаются вместе со схемой — подпись
                // держится у значка и не наезжает при отдалении.
                const msGap = 16 * _branchObjSF * _indZoomSF;
                const bx = px + perpX * (msGap + boxW / 2) + (sym.msIndOffsetX ?? 0) * _branchObjSF * _indZoomSF;
                const by = py + perpY * (msGap + boxH / 2) + (sym.msIndOffsetY ?? 0) * _branchObjSF * _indZoomSF;
                const opacity = Math.min(1, (view.scale - 0.05) / 0.06);

                return (
                  <g opacity={opacity}>
                    <line x1={px} y1={py} x2={bx} y2={by - boxH / 2}
                      stroke="#8899bb" strokeWidth={0.7} strokeDasharray="3 2" />
                    <g style={{ cursor: "move" }}
                      onMouseDown={(e) => {
                        if (tool !== "select") return;
                        e.stopPropagation();
                        const startX = e.clientX, startY = e.clientY;
                        const origOx = sym.msIndOffsetX ?? 0;
                        const origOy = sym.msIndOffsetY ?? 0;
                        const sfDrag = (_branchObjSF * _indZoomSF) || 1;
                        const onMove = (me: MouseEvent) => {
                          onSymbolMsIndOffset?.(sym.id, origOx + (me.clientX - startX) / sfDrag, origOy + (me.clientY - startY) / sfDrag);
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}>
                      {msLines.map((line, i) => (
                        <text key={i}
                          x={bx} y={by - boxH / 2 + (i + 1) * lineH}
                          textAnchor="middle" fontSize={fSize}
                          fill="#1a2a4a" fontFamily="Segoe UI, sans-serif"
                          fontWeight={i === 0 && sym.msIndNumber ? "700" : "normal"}
                          style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 2.5, strokeLinejoin: "round" }}>
                          {line}
                        </text>
                      ))}
                    </g>
                  </g>
                );
              })()}

              {/* ── Индикаторы вентилятора на схеме ──────────────────────
                  Раньше показатели вентилятора попадали в ОБЩУЮ подпись ветви
                  (вместе с длиной и сечением) и оказывались далеко от самого
                  вентилятора. Теперь — отдельная подпись у его значка. */}
              {view.scale > 0.05 && FAN_SYMBOL_IDS.has(sym.typeId) && hasBranchPts && (() => {
                const brFan = symBrSvg;
                if (!brFan?.hasFan) return null;
                const icFan = (brFan.indicators ?? {}) as Record<string, boolean>;
                const uPresF = getUnit(unitsConfig, "pressure");
                const uFlowF = getUnit(unitsConfig, "flow");
                const fanLines: string[] = [];
                // Название вентилятора — из его параметров (поле «Название»),
                // первой строкой. Раньше индикатор «Описание» брал название
                // ВЕТВИ и показывал тип выработки, а не марку вентилятора.
                if (icFan.fanNameInd && brFan.fanName) fanLines.push(brFan.fanName);
                // Расход в рабочей точке вентилятора — то же значение, что в
                // свойствах вентилятора («Q выраб.»), со знаком при реверсе.
                if (icFan.fanFlow) {
                  const qFan = (brFan.fanReverse && brFan.fanType !== "ВМП")
                    ? -Math.abs(brFan.flow ?? 0)
                    : Math.abs(brFan.flow ?? 0);
                  fanLines.push(`Qв=${uFlowF.fromBase(qFan).toFixed(uFlowF.decimals)}${uFlowF.symbol}`);
                }
                if (icFan.fanPressure)
                  fanLines.push(`Нв=${uPresF.fromBase(Math.abs(brFan.fanPressure ?? 0)).toFixed(uPresF.decimals)}${uPresF.symbol}`);
                if (icFan.fanShaftPower && (brFan.fanShaftPower ?? 0) > 0)
                  fanLines.push(`Nв=${((brFan.fanShaftPower ?? 0) / 1000).toFixed(1)} кВт`);
                if (icFan.fanEfficiency && (brFan.fanEfficiency ?? 0) > 0)
                  fanLines.push(`ηв=${((brFan.fanEfficiency ?? 0) * 100).toFixed(0)}%`);
                if (!fanLines.length) return null;

                // Размер подписи — как у подписей ветвей (по толщине ветви),
                // чтобы всё на схеме читалось одинаково.
                const fBwLbl = (thinLines ? 1 : (brFan.lineWidth && brFan.lineWidth > 0 ? brFan.lineWidth : branchWidth)) * _branchObjSF;
                const fTextSc = Math.max(0.3, fBwLbl * 0.28) * _indZoomSF;
                // Размер шрифта можно задать в параметрах вентилятора
                // (поле «Размер»), по умолчанию 9 — как у замерных станций.
                const fSizeF = Math.max(3, 8.5 * fTextSc * ((sym.fanIndFontSize ?? 9) / 9));
                const lineHF = fSizeF + 3 * _indZoomSF;
                const boxWF = Math.max(...fanLines.map(l => l.length)) * fSizeF * 0.52 + 10 * _indZoomSF;
                const boxHF = fanLines.length * lineHF + 6 * _indZoomSF;
                const brDxF = tsx2 - fsx, brDyF = tsy2 - fsy;
                const brLenF = Math.hypot(brDxF, brDyF);
                const perpXF = brLenF > 0 ? -brDyF / brLenF : 0;
                const perpYF = brLenF > 0 ?  brDxF / brLenF : 0;
                const gapF = 16 * _branchObjSF * _indZoomSF;
                // Подпись можно оттащить мышью — смещение хранится в символе
                // и не сбивается при изменении масштаба схемы.
                const fanDragSF = (_branchObjSF * _indZoomSF) || 1;
                const bxF = px + perpXF * (gapF + boxWF / 2) + (sym.fanIndOffsetX ?? 0) * fanDragSF;
                const byF = py + perpYF * (gapF + boxHF / 2) + (sym.fanIndOffsetY ?? 0) * fanDragSF;
                const opacityF = Math.min(1, (view.scale - 0.05) / 0.06);

                return (
                  <g opacity={opacityF}>
                    <line x1={px} y1={py} x2={bxF} y2={byF - boxHF / 2}
                      stroke="#8899bb" strokeWidth={0.7} strokeDasharray="3 2" />
                    <g style={{ cursor: "move" }}
                      onMouseDown={(e) => {
                        if (tool !== "select") return;
                        e.stopPropagation();
                        const startX = e.clientX, startY = e.clientY;
                        const origOx = sym.fanIndOffsetX ?? 0;
                        const origOy = sym.fanIndOffsetY ?? 0;
                        const onMove = (me: MouseEvent) => {
                          onSymbolFanIndOffset?.(sym.id, origOx + (me.clientX - startX) / fanDragSF, origOy + (me.clientY - startY) / fanDragSF);
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}>
                      {fanLines.map((line, i) => (
                        <text key={i}
                          x={bxF} y={byF - boxHF / 2 + (i + 1) * lineHF}
                          textAnchor="middle" fontSize={fSizeF}
                          fill="#1a2a4a" fontFamily="Segoe UI, sans-serif"
                          style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 2.5, strokeLinejoin: "round" }}>
                          {line}
                        </text>
                      ))}
                    </g>
                  </g>
                );
              })()}

              {/* ── Индикаторы перемычки на схеме ────────────────────── */}
              {view.scale > 0.05 && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.typeId !== "measure_station" && sym.branchId && (() => {
                const br = symBrSvg;
                if (!br) return null;
                const lines: string[] = [];
                const uResInd  = getUnit(unitsConfig, "resistance");
                const uPresInd = getUnit(unitsConfig, "pressure");
                const uFlowInd = getUnit(unitsConfig, "flow");
                if (sym.indDescription && sym.description) lines.push(sym.description);
                if (sym.indResistance) {
                  // Вычисляем R в базовых единицах (Мюрг) из параметров символа.
                  // Соглашение: 1 кМюрг = 9.81 Н·с²/м⁸, 1 Мюрг = 9.81e-3 Н·с²/м⁸
                  // bkManualR хранится в кМюрг → *1000 = Мюрг
                  // rNsm8 (Н·с²/м⁸) → / 9.81e-3 = Мюрг
                  // bkBulkheadR / br.bulkheadR хранятся в Мюрг
                  const mode = sym.bkResMode ?? "project";
                  let rBase = 0; // в Мюрг (базовых единицах)
                  if (mode === "manual") {
                    rBase = (sym.bkManualR ?? 0) * 1000; // кМюрг → Мюрг
                  } else if (mode === "survey") {
                    const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                    // R = ΔP/(Q²·9.81) кМюрг → ×1000 → Мюрг (как в АэроСети)
                    rBase = sq > 0 ? (dp / (sq * sq * 9.81)) * 1000 : 0;
                  } else {
                    // project: используем bkAirPerm или bkBulkheadR
                    const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0) : (sym.bkAirPerm ?? 0);
                    if (kAir > 0) {
                      // Глухая/парус: R = 1/(A·S)²/SCALE кМюрг → ×1000 → Мюрг (учёт сечения).
                      rBase = solidBulkheadRkMurg(kAir, br.area ?? 0) * 1000;
                    } else {
                      rBase = sym.bkBulkheadR ?? br.bulkheadR ?? 0; // уже в Мюрг
                    }
                  }
                  // Fallback: если sym.bk* не заполнены
                  if (rBase === 0 && br.bulkheadR > 0) rBase = br.bulkheadR;
                  if (rBase === 0) rBase = br.resistance / 9.81e-3; // Н·с²/м⁸ → Мюрг
                  lines.push(`R=${uResInd.fromBase(rBase).toFixed(uResInd.decimals)} ${uResInd.symbol}`);
                }
                if (sym.indDeltaP && br.dP !== 0) lines.push(`ΔP=${uPresInd.fromBase(Math.abs(br.dP)).toFixed(uPresInd.decimals)} ${uPresInd.symbol}`);
                if (sym.indLeakage && br.flow !== 0) lines.push(`Q=${uFlowInd.fromBase(Math.abs(br.flow)).toFixed(uFlowInd.decimals)} ${uFlowInd.symbol}`);
                if (!lines.length) return null;

                // Масштабируем индикатор перемычки ТАК ЖЕ, как подписи ВЕТВЕЙ
                // (по толщине ветви branchPxLabel), а не по размеру УО — чтобы
                // подписи перемычки и ветви совпадали по размеру.
                const bkBwLbl = (thinLines ? 1 : (br.lineWidth && br.lineWidth > 0 ? br.lineWidth : branchWidth)) * _branchObjSF;
                // Индикатор уменьшается вместе со схемой (как ветви): домножаем
                // масштаб текста на _indZoomSF при отдалении.
                const bkTextSc = Math.max(0.3, bkBwLbl * 0.28) * _indZoomSF;
                const baseFontPx = 8.5 * bkTextSc * ((sym.indFontSize ?? 9) / 9);
                const fSize = Math.max(3, baseFontPx);
                const lineH = fSize + 3 * _indZoomSF;
                const boxW = Math.max(...lines.map(l => l.length)) * fSize * 0.52 + 10 * _indZoomSF;
                const boxH = lines.length * lineH + 6 * _indZoomSF;

                // Базовая позиция — поперёк ветви, плюс пользовательское смещение
                const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                const brLen = Math.hypot(brDx, brDy);
                const perpX = brLen > 0 ? -brDy / brLen : 0;
                const perpY = brLen > 0 ?  brDx / brLen : 0;
                // Отступ и смещение уменьшаются вместе со схемой — подпись
                // держится у значка и не наезжает при отдалении.
                const indGap = 16 * _branchObjSF * _indZoomSF;
                const baseOffX = perpX * (indGap + boxW / 2);
                const baseOffY = perpY * (indGap + boxH / 2);
                const bx = px + baseOffX + (sym.indOffsetX ?? 0) * _branchObjSF * _indZoomSF;
                const by = py + baseOffY + (sym.indOffsetY ?? 0) * _branchObjSF * _indZoomSF;
                const opacity = Math.min(1, (view.scale - 0.05) / 0.06);

                // Ближайшая точка рамки бейджа для выноски
                const leaderX = bx - (bx > px ? boxW / 2 : -boxW / 2) * 0.8;
                const leaderY = by - (by > py ? boxH / 2 : -boxH / 2) * 0.8;

                return (
                  <g opacity={opacity}>
                    {/* Выноска к символу */}
                    <line x1={px} y1={py} x2={bx} y2={by - boxH / 2}
                      stroke="#8899bb" strokeWidth={0.7} strokeDasharray="3 2" />
                    {/* Текст индикаторов — без рамки, перетаскиваемый */}
                    <g style={{ cursor: "move" }}
                      onMouseDown={(e) => {
                        if (tool !== "select") return;
                        e.stopPropagation();
                        const startX = e.clientX, startY = e.clientY;
                        const origOx = sym.indOffsetX ?? 0;
                        const origOy = sym.indOffsetY ?? 0;
                        const sfDrag = (_branchObjSF * _indZoomSF) || 1;
                        const onMove = (me: MouseEvent) => {
                          onSymbolIndOffset?.(sym.id, origOx + (me.clientX - startX) / sfDrag, origOy + (me.clientY - startY) / sfDrag);
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}>
                      {lines.map((line, i) => (
                        <text key={i}
                          x={bx} y={by - boxH / 2 + (i + 1) * lineH}
                          textAnchor="middle" fontSize={fSize}
                          fill="#1a2a4a" fontFamily="Segoe UI, sans-serif"
                          fontWeight={i === 0 && sym.indDescription ? "600" : "normal"}
                          style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 2.5, strokeLinejoin: "round" }}>
                          {line}
                        </text>
                      ))}
                    </g>
                  </g>
                );
              })()}
            </g>
          );
          };
          // Группируем УО по порядку горизонта их ветви и встраиваем в слои:
          // символ рисуется поверх ветвей своего горизонта, но под ветвями
          // горизонтов, которые выше в списке слоёв (как в Фотошопе).
          const symOut: React.ReactNode[] = [];
          const layerGroups = branchLayerGroupsRef.current;
          // Порядок горизонтов от нижнего (больший order) к верхнему (меньший).
          const orders = Array.from(new Set(branchesSorted.map(x => x.hOrder))).sort((a, b) => b - a);
          const seen = new Set<number>();
          const horizonOf = (sym: typeof schemaSymbolsSorted[number]): number => {
            const hz = sym.branchId ? (branchById.get(sym.branchId)?.horizonId ?? "") : "";
            return hz ? (horizonOrderMap.get(hz) ?? 9999) : 9999;
          };
          for (const ord of orders) {
            seen.add(ord);
            // УО этого горизонта — поверх его ветвей.
            for (const sym of schemaSymbolsSorted) {
              if (horizonOf(sym) !== ord) continue;
              const node = renderOne(sym);
              if (node) symOut.push(<g key={`sym-${sym.id}`}>{node}</g>);
            }
            // Ветви горизонтов ВЫШЕ текущего перекрывают эти УО — перерисовываем их поверх.
            const higher = layerGroups.filter(g => g.order < ord);
            if (higher.length) {
              symOut.push(
                <g key={`occ-${ord}`} style={{ pointerEvents: "none" }}>
                  {higher.map(g => (
                    <g key={`occ-${ord}-${g.order}`}>{g.node}</g>
                  ))}
                </g>
              );
            }
          }
          // УО без привязки к видимым горизонтам — поверх всего.
          for (const sym of schemaSymbolsSorted) {
            if (seen.has(horizonOf(sym))) continue;
            const node = renderOne(sym);
            if (node) symOut.push(<g key={`sym-top-${sym.id}`}>{node}</g>);
          }
          return <>{symOut}</>;
        })()}

        {/* ─── ЗАДЫМЛЕНИЕ (дым) — поверх ветвей И символов всех горизонтов ── */}
        {/* Рисуем ПОСЛЕ блока УО: тот перерисовывает ветви верхних горизонтов */}
        {/* для z-order символов и иначе перекрыл бы дым нижних горизонтов. */}
        {!useCanvas && smokePassRef.current}

        {/* ─── УЗЛЫ (отсортированы по глубине, ближние сверху) ─────────── */}
        {!useCanvas && nodesSorted.map(({ node, sx, sy }) => {
          // Если узел скрыт через «Видимость узлов» — не рендерим ничего
          if (node.visible === false) return null;
          // Если все ветви узла принадлежат скрытым горизонтам — скрываем узел
          if (hiddenNodeIds.has(node.id)) return null;
          const isSel = selectedNodeId === node.id || (selectedNodeIds?.has(node.id) ?? false);
          const isMultiSel = selectedNodeIds?.has(node.id) ?? false;
          const isBranchFrom = branchFrom === node.id;
          const isRescuePath = rescuePathNodeIds?.has(node.id) ?? false;
          // nodeSF: те же правила что у objSF ветвей — узел масштабируется синхронно с ветвью
          const _xyScaleNode = xyScale ?? 1;
          const _rawNodeSF = fixedObjectScale ? 1 : (view.scale / (_xyScaleNode * 0.4));
          const nodeSF = fixedObjectScale && scaleLimits
            ? Math.min(scaleLimits.branchMax / 100, Math.max(scaleLimits.branchMin / 100, _rawNodeSF))
            : Math.max(0.25, _rawNodeSF);
          // Средняя ширина прилегающих ветвей для синхронного масштабирования узла
          const adjBr = nodeAdjBranches.get(node.id) ?? [];
          const adjAvgW = adjBr.length > 0
            ? adjBr.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBr.length
            : branchWidth;
          const branchPx = (thinLines ? 1 : adjAvgW) * nodeSF;
          // Узел = половина ширины ветви, минимум 1.5px
          const baseNodeR = Math.max(1.5, branchPx * 0.55);
          const r = isSel ? baseNodeR * 1.5 : baseNodeR;
          const color = node.atmosphereLink ? "#7dd3fc" : "#c8a882";
          const ringColor = isMultiSel ? "#f59e0b" : "#2563eb";
          const rawFireType = node.fireNodeType ?? "none";
          // Видимость водопроводных типов узлов управляется вкладкой «Водопровод».
          const waterTypeVisible =
            rawFireType === "reservoir" ? (!infoConfig || infoConfig.waterReservoir)
          : rawFireType === "consumer"  ? (!infoConfig || infoConfig.waterConsumer)
          : rawFireType === "junction"  ? (!infoConfig || infoConfig.waterPipeJoint)
          : true;
          const fireType = waterTypeVisible ? rawFireType : "none";
          const hasFire = fireType !== "none";
          const IS = Math.max(3, baseNodeR * 2.5);
          return (
            <g key={node.id} transform={`translate(${sx},${sy})`}>
              {/* Кольцо маршрута горноспасателей */}
              {isRescuePath && (
                <circle r={r + baseNodeR * 0.8} fill="#16a34a" stroke="#15803d" strokeWidth={1.5 * nodeSF} opacity="0.85" />
              )}
              {/* Буквенная метка узла горноспасателей: А — начальный, Б — целевой, В — промежуточный */}
              {rescueNodeLetters?.get(node.id) && (() => {
                const letter = rescueNodeLetters.get(node.id)!;
                const badgeR = Math.max(6, baseNodeR * 2.2);
                const fs = badgeR * 1.4;
                const col = letter === "А" ? "#15803d" : letter === "Б" ? "#b91c1c" : "#b45309";
                return (
                  <g>
                    <circle cx={0} cy={-badgeR - r} r={badgeR} fill="white" stroke={col} strokeWidth={Math.max(1, badgeR * 0.18)} />
                    <text x={0} y={-badgeR - r} textAnchor="middle" dominantBaseline="central"
                      fontSize={fs} fontWeight={700} fill={col} style={{ userSelect: "none" }}>
                      {letter}
                    </text>
                  </g>
                );
              })()}
              {/* Кольцо выделения — только для обычных узлов */}
              {(isSel || isBranchFrom) && !hasFire && (
                <circle r={r + baseNodeR * 0.5} fill="none" stroke={ringColor} strokeWidth={Math.min(2, Math.max(0.5, baseNodeR * 0.2))}
                  strokeDasharray={isSel ? "3 2" : undefined} />
              )}
              {/* Основной кружок — только для обычных узлов */}
              {!hasFire && (
                <>
                  <circle r={r} fill={color} stroke={isSel ? ringColor : "#1f2937"} strokeWidth={Math.min(2, Math.max(0.5, baseNodeR * 0.25))} />
                  {node.atmosphereLink && (
                    <circle r={r * 0.5} fill="none" stroke="#1f2937" strokeWidth={Math.min(1.5, Math.max(0.5, baseNodeR * 0.2))} strokeDasharray="2 1" />
                  )}
                </>
              )}

              {/* ── Иконка РЕЗЕРВУАРА С ВОДОЙ ──
                   Прямоугольник: верхняя часть белая/пустая, нижняя — синяя (вода). */}
              {fireType === "reservoir" && view.scale > 0.025 && (() => {
                const hw = IS * 0.8, hh = IS * 0.6;
                const lw = Math.max(1, IS * 0.09);
                const mid = 0; // горизонтальная ось
                return (
                  <g>
                    {/* Верхняя (пустая) половина */}
                    <rect x={-hw} y={-hh} width={hw * 2} height={hh} fill="white" />
                    {/* Нижняя (вода) половина */}
                    <rect x={-hw} y={mid} width={hw * 2} height={hh} fill="#1d4ed8" />
                    {/* Общая рамка */}
                    <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2}
                      fill="none" stroke="#1d4ed8" strokeWidth={lw} />
                    {/* Горизонтальная черта — уровень воды */}
                    <line x1={-hw} y1={mid} x2={hw} y2={mid}
                      stroke="#1d4ed8" strokeWidth={lw} />
                    {/* Кольцо выделения */}
                    {isSel && <rect x={-hw - 3} y={-hh - 3} width={(hw + 3) * 2} height={(hh + 3) * 2}
                      fill="none" stroke={ringColor} strokeWidth="1.5" strokeDasharray="3 2" />}
                  </g>
                );
              })()}

              {/* ── Иконка ПОЖАРНОГО КРАНА (SVG) ── */}
              {fireType === "consumer" && view.scale > 0.025 && (() => {
                const hydrantOpen = node.fireHydrantOpen ?? false;
                const sz = IS * 2.2;
                // viewBox SVG = 21000×29700 (A4 portrait), соотношение сторон ~0.707
                const svgAspect = 21000 / 29700;
                const drawH = sz;
                const drawW = sz * svgAspect;
                // Иконки из файлов программы — работают без интернета (рудник, ВГСЧ)
                const svgUrl = hydrantOpen
                  ? "icons/fire-crane-blue.svg"
                  : "icons/fire-crane-red.svg";
                return (
                  <g>
                    <image
                      href={svgUrl}
                      x={-drawW / 2} y={-drawH / 2} width={drawW} height={drawH} />
                    {/* Кольцо выделения — круг по краям выступов крана.
                        Центр символа смещён по Y: (16500/29700 - 0.5)*drawH.
                        Радиус выступов: (9125/21000)*drawW */}
                    {isSel && <circle
                      cx={0} cy={(15800 / 29700 - 0.5) * drawH}
                      r={(10900 / 21000) * drawW + 3}
                      fill="none" stroke={ringColor} strokeWidth="1.5" strokeDasharray="3 2" />}
                  </g>
                );
              })()}

              {/* ── Маркер предупреждения ⚠ на проблемных кранах ── */}
              {fireType === "consumer" && (node.fireHydrantOpen ?? false) && view.scale > 0.025 && (() => {
                const res = waterNodeResults?.get(node.id);
                if (!res) return null;
                const MIN_P = 0.1;
                const req   = node.fireRequiredFlow ?? 0;
                const isErr = res.dynamicP > 0 && res.dynamicP < MIN_P;
                const isWrn = !isErr && req > 0 && res.flow < req * 0.9;
                if (!isErr && !isWrn) return null;
                const cr   = IS * 0.55;
                const earR = cr * 0.55;
                const ox   = cr + earR + 2;   // правее правого уха
                const oy   = -(cr + earR + 2); // выше
                const rs   = Math.max(5, IS * 0.45);
                const col  = isErr ? "#dc2626" : "#d97706";
                return (
                  <g transform={`translate(${ox},${oy})`}>
                    <circle r={rs} fill={col} />
                    <text textAnchor="middle" dominantBaseline="central"
                      fontSize={rs * 1.1} fontWeight="bold" fill="white">!</text>
                  </g>
                );
              })()}

              {/* ── Иконка СОЕДИНЕНИЯ ТРУБ (маленький кружок с точкой) ── */}
              {fireType === "junction" && view.scale > 0.025 && (() => {
                const jr = baseNodeR;
                return (
                  <g>
                    <circle r={jr} fill="white" stroke="#7c3aed" strokeWidth={Math.max(1, jr * 0.25)} />
                    <circle r={jr * 0.35} fill="#7c3aed" />
                    {isSel && <circle r={jr + 4} fill="none" stroke={ringColor} strokeWidth="1.5" strokeDasharray="3 2" />}
                  </g>
                );
              })()}
              <g transform="translate(8, -8)">
                {view.scale > 0.08 && (() => {
                  const ic = infoConfig;
                  const nodeOpacity = Math.min(1, (view.scale - 0.08) / 0.12);
                  const nlines: string[] = [];
                  if (!ic) {
                    if (node.name) nlines.push(node.name);
                  } else {
                    const uLenN  = getUnit(unitsConfig, "length");
                    const uPresN = getUnit(unitsConfig, "pressure");
                    const uTemp  = getUnit(unitsConfig, "temperature");
                    const uGas   = getUnit(unitsConfig, "gasConc");
                    if (ic.nodeNumber) nlines.push(`${node.number}`);
                    if (ic.nodeX) nlines.push(`X=${uLenN.fromBase(node.x).toFixed(uLenN.decimals)}${uLenN.symbol}`);
                    if (ic.nodeY) nlines.push(`Y=${uLenN.fromBase(node.y).toFixed(uLenN.decimals)}${uLenN.symbol}`);
                    if (ic.nodeZ) nlines.push(`Z=${uLenN.fromBase(node.z).toFixed(uLenN.decimals)}${uLenN.symbol}`);
                    if (ic.nodePressure && node.computedPressure > 0)
                      nlines.push(`P=${uPresN.fromBase(node.computedPressure).toFixed(uPresN.decimals)}${uPresN.symbol}`);
                    if (ic.nodeTemp && node.airTemp !== 0) nlines.push(`T=${uTemp.fromBase(node.airTemp).toFixed(uTemp.decimals)}${uTemp.symbol}`);
                    if (ic.nodeMethane && node.computedGasConc > 0) nlines.push(`CH4=${uGas.fromBase(node.computedGasConc).toFixed(uGas.decimals)}${uGas.symbol}`);
                    // ─── Водопроводные показатели узла (вкладка «Водопровод») ───
                    if (rawFireType === "consumer") {
                      const wr = waterNodeResults?.get(node.id);
                      if (ic.waterDynamicPressure && wr && wr.dynamicP > 0)
                        nlines.push(`Pд=${wr.dynamicP.toFixed(2)} МПа`);
                      if (ic.waterFlow && wr && wr.flow > 0)
                        nlines.push(`Q=${wr.flow.toFixed(1)} м³/ч`);
                      if (ic.waterDeficit && wr) {
                        const req = node.fireRequiredFlow ?? 0;
                        const def = req - wr.flow;
                        if (def > 0.05) nlines.push(`Δ=${def.toFixed(1)} м³/ч`);
                      }
                    }
                  }
                  if (nlines.length === 0) return null;
                  const nodeFontSize = Math.max(4, baseNodeR * 1.6);
                  const nodeLineH = nodeFontSize * 1.2;
                  return nlines.map((ln, li) => (
                    <text key={li} y={(li + 1) * nodeLineH} fontSize={nodeFontSize} fill="#6b7280" opacity={nodeOpacity}>{ln}</text>
                  ));
                })()}
              </g>

            </g>
          );
        })}

        {/* ── ViewCube в углу (3D-индикатор ориентации) ─────────────── */}
        {!useCanvas && <ViewCube
          x={size.w - 70} y={20}
          azimuth={view.azimuth} elevation={view.elevation}
          onPick={applyPreset}
        />}

        {/* ── МАСШТАБНАЯ ЛИНЕЙКА (как в АэроСети) ─────────────────── */}
        {!useCanvas && <ScaleBar scale={view.scale} height={size.h} />}

        {/* ─── МАРКЕР PIVOT-ТОЧКИ (виден только во время вращения) ─── */}
        {/* Перепроецируем pivot в текущей проекции (углы уже обновлены). */}
        {!useCanvas && rotStart && (() => {
          const ps = project3D(rotStart.pivot, proj);
          return <PivotMarker sx={ps.sx} sy={ps.sy} />;
        })()}
      </svg>

      {/* ── Оверлей УО поверх canvas (видим всегда, интерактивен) ─────────
          Разметка вынесена в topoCanvas/TopoCanvasSymbolsOverlay (перенос 1:1):
          в canvas-режиме схема рисуется на холсте, а символы УО остаются
          интерактивным SVG поверх него — иначе по ним нельзя было бы кликать. */}
      <TopoCanvasSymbolsOverlay
        useCanvas={useCanvas} size={size} view={view} cursorStyle={cursorStyle}
        panStart={panStart} rotStart={rotStart} isZooming={isZooming}
        fixedObjectScale={fixedObjectScale} branchBorder={branchBorder} scaleLimits={scaleLimits}
        editingPrintLayerId={editingPrintLayerId} tool={tool}
        branches={branches} branchesSorted={branchesSorted} nodesSorted={nodesSorted}
        projNodesMap={projNodesMap} projectWithZ={projectWithZ}
        branchById={branchById} legendTypeById={legendTypeById}
        horizonOrderMap={horizonOrderMap} nodeAdjBranches={nodeAdjBranches}
        hiddenBranchIds={hiddenBranchIds} hiddenNodeIds={hiddenNodeIds}
        pollutedBranchIds={pollutedBranchIds} branchBodyColor={branchBodyColor}
        schemaSymbolsSorted={schemaSymbolsSorted} handleSymbolClick={handleSymbolClick}
        _xySF={_xySF} _objSF={_objSF} _branchObjSF={_branchObjSF} _indZoomSF={_indZoomSF}
        branchWidth={branchWidth} thinLines={thinLines}
        bulkheadScale={bulkheadScale} fanScale={fanScale}
        flowDisplay={flowDisplay} animSpeed={animSpeed} showFlowArrows={showFlowArrows}
        rescuePickMode={rescuePickMode}
        selectedSymbolId={selectedSymbolId} selectedSymbolIds={selectedSymbolIds}
        selectedNodeId={selectedNodeId} selectedNodeIds={selectedNodeIds}
        infoConfig={infoConfig} unitsConfig={unitsConfig}
        branchFireColors={branchFireColors} xyScale={xyScale}
        onSelectSymbol={onSelectSymbol} onSymbolMove={onSymbolMove}
        onSymbolMoveAlongBranch={onSymbolMoveAlongBranch} onSymbolOffset={onSymbolOffset}
        onSymbolIndOffset={onSymbolIndOffset} onSymbolMsIndOffset={onSymbolMsIndOffset}
        onSymbolFanIndOffset={onSymbolFanIndOffset}
        onSymbolDragStart={onSymbolDragStart}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onWheel={onWheel}
        onMouseDownCanvas={onMouseDownCanvas} onMouseMoveCanvas={onMouseMoveCanvas}
        onMouseUpCanvas={onMouseUpCanvas} onWheelCanvas={onWheelCanvas}
        onContextMenuCanvas={onContextMenuCanvas} onDoubleClickCanvas={onDoubleClickCanvas}
      />

      {/* ── Оверлей HUD (линейка + ViewCube) поверх canvas ──────────────────
          В canvas-режиме основной SVG скрыт (visibility:hidden), поэтому линейку
          и 3D-куб рендерим в отдельном всегда-видимом SVG поверх холста.
          pointerEvents:none на контейнере — клики проходят к схеме; у куба свои
          onClick-обработчики на гранях (SVG всё равно ловит их через дочерние). */}
      {useCanvas && (
        <svg
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", zIndex: 3 }}
          width={size.w} height={size.h}>
          {/* ViewCube — интерактивные грани */}
          <g style={{ pointerEvents: "auto" }}>
            <ViewCube
              x={size.w - 70} y={20}
              azimuth={view.azimuth} elevation={view.elevation}
              onPick={applyPreset}
            />
          </g>
          {/* Масштабная линейка */}
          <ScaleBar scale={view.scale} height={size.h} />
        </svg>
      )}

      {/* Индикаторы внизу холста (координаты, плоскость, масштаб) */}
      <TopoCanvasIndicators
        useCanvas={useCanvas}
        visibleBranchCount={visibleBranches.length}
        is3D={is3D}
        azimuth={view.azimuth}
        elevation={view.elevation}
        hoverPos={hoverPos}
        effPlane={effPlane}
        zLevel={zLevel}
        scale={view.scale}
      />

      {/* Подсказки активного инструмента */}
      <TopoCanvasHints
        pendingSymbolTypeId={pendingSymbolTypeId}
        tool={tool}
        effPlane={effPlane}
        branchFrom={branchFrom}
      />
    </div>
  );
}