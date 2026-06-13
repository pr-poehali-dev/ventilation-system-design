import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  type TopoNode, type TopoBranch, type ProjOptions, type ViewPreset, type WorkPlane,
  type Horizon, type PaperFormat,
  PAPER_SIZES_MM, OVERVIEW_HORIZON_ID,
  project3D, unproject2D, unprojectToPlane, calcBranchLength, VIEW_PRESETS, autoWorkPlane,
} from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import CanvasLayer, { CANVAS_THRESHOLD } from "@/components/cad/CanvasLayer";

// ─────────────────────────────────────────────────────────────────────────────
// Интерактивный CAD-холст для построения топологии
// 2D (план) + 3D с произвольным ракурсом
// ─────────────────────────────────────────────────────────────────────────────

// Форматирует сопротивление с авто-выбором значащих цифр (не показывает 0.0000)
function fmtR(rMkyurg: number, unit: { fromBase: (v: number) => number; symbol: string; decimals: number }): string {
  const v = unit.fromBase(rMkyurg);
  if (v === 0) return `0 ${unit.symbol}`;
  // Определяем количество знаков чтобы показать хотя бы 2 значащих цифры
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const decimals = Math.max(unit.decimals, -mag + 1);
  return `${v.toFixed(decimals)}${unit.symbol}`;
}

export type CadTool = "select" | "node" | "branch" | "pan" | "rotate" | "symbol";

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  selectedNodeId: string | null;
  selectedBranchId: string | null;
  /** Множество ID выделенных ветвей (Ctrl+клик). */
  selectedBranchIds?: Set<string>;
  /** Ctrl+клик по ветви — добавить/убрать из множества. */
  onBranchMultiSelect?: (id: string) => void;
  /** Множество ID выделенных узлов (Ctrl+клик). */
  selectedNodeIds?: Set<string>;
  /** Ctrl+клик по узлу — добавить/убрать из множества. */
  onNodeMultiSelect?: (id: string) => void;
  tool: CadTool;
  /** Создать новый узел в указанной мировой точке. Возвращает ID нового узла. */
  onNodeAdd: (x: number, y: number, z: number) => string | void;
  /** Перемещение узла (теперь в 3D возможно по любой координате) */
  onNodeMove: (id: string, x: number, y: number, z?: number) => void;
  /** Создать ветвь между двумя существующими узлами. Возвращает ID новой ветви. */
  onBranchAdd: (fromId: string, toId: string) => string | void;
  /** Разделить ветвь, вставив новый узел в указанной точке. Возвращает ID нового узла. */
  onSplitBranchAt?: (branchId: string, x: number, y: number, z: number) => string | void;
  onSelectNode: (id: string | null) => void;
  onSelectBranch: (id: string | null) => void;
  zLevel: number;
  /** Сигнал применения пресета ракурса (смена nonce = триггер) */
  viewPreset?: { name: ViewPreset; nonce: number } | null;
  /** Сообщить наверх о смене режима 2D/3D */
  onViewChange?: (info: { is3D: boolean; azimuth: number; elevation: number }) => void;
  /** Способ отображения направления потока воздуха */
  flowDisplay?: FlowDisplayMode;
  /** Активная рабочая плоскость для построения в 3D (если null — auto по ракурсу) */
  workPlane?: WorkPlane | null;
  /** Список горизонтов для фильтрации/окрашивания ветвей. */
  horizons?: Horizon[];
  /** Базовая толщина линии ветви (px), общая настройка. По умолчанию 2.5. */
  branchWidth?: number;
  /** Толщина обводки ветви (px), 0 = без обводки. */
  branchBorder?: number;
  /** Тонкие линии (F6): всё в 1px без обводки и без анимации, для печатной/схемной подачи. */
  thinLines?: boolean;
  /** Фиксированный размер объектов: ветви/узлы/текст не масштабируются при зуме. */
  fixedObjectScale?: boolean;
  /** Окрашивать ветви по цвету горизонта (вместо цвета по скорости/потоку). */
  colorByHorizon?: boolean;
  /** Показывать стрелки направления свежей струи после расчёта (F9). */
  showFlowArrows?: boolean;
  /** Внешний управляемый масштаб (px/м). Если задан — синхронизируется в обе стороны. */
  scaleOverride?: number;
  /** Колбэк при изменении масштаба внутри (например, колесом мыши). */
  onScaleChange?: (scale: number) => void;
  /** Сигнал «вписать всю сеть в экран» — меняется значение → TopoCanvas пересчитывает. */
  fitToScreenNonce?: number;
  /** Сигнал «центрировать камеру на указанном узле/ветви». */
  focusNonce?: number;
  focusNodeId?: string | null;
  focusBranchId?: string | null;
  /** Восстановить конкретный вид (при открытии файла с сохранённым view) */
  restoreView?: { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number } | null;
  /** Колбэк: view успешно восстановлен из файла — родитель должен обнулить restoreView */
  onRestoreViewDone?: () => void;
  /** Колбэк: сообщать наружу текущий полный вид (для сохранения в файл) */
  onViewStateChange?: (v: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number }) => void;
  /** ID горизонта, у которого можно редактировать подложку (тащить углы). */
  editingHorizonImageId?: string | null;
  /** Колбэк изменения углов подложки горизонта (после drag). */
  onHorizonImageBoundsChange?: (horizonId: string, bounds: { x1: number; y1: number; x2: number; y2: number }) => void;
  /** ID горизонта, у которого редактируются bounds слоя печати (тащить рамку/углы). */
  editingPrintLayerId?: string | null;
  /** Колбэк изменения bounds слоя печати горизонта. */
  onPrintLayerBoundsChange?: (horizonId: string, bounds: { x1: number; y1: number; x2: number; y2: number }) => void;
  /** Колбэк изменения полей слоя печати (заголовок, утверждающий и др.) */
  onPrintLayerChange?: (horizonId: string, patch: Partial<import("@/lib/topology").HorizonPrintLayer>) => void;
  /** Контекстное меню по правой кнопке на узле (id узла, экранные координаты). */
  onNodeContextMenu?: (id: string, screenX: number, screenY: number) => void;
  /** Контекстное меню по правой кнопке на ветви (id ветви, экранные координаты). */
  onBranchContextMenu?: (id: string, screenX: number, screenY: number) => void;
  /** Контекстное меню по правой кнопке на пустом месте (экранные координаты). */
  onCanvasContextMenu?: (screenX: number, screenY: number) => void;
  /** Конфигурация панели информации — какие метки рисовать на схеме. */
  infoConfig?: import("@/lib/infoConfig").InfoDisplayConfig;
  /** Масштаб по оси Z относительно XY (1 = без изменений, 2 = вдвое растянуть). */
  zScale?: number;
  /** Масштаб по осям X и Y (горизонтальное растяжение схемы). */
  xyScale?: number;
  /** Условные обозначения на схеме */
  schemaSymbols?: { id: string; typeId: string; x: number; y: number; branchId: string | null; t?: number; offsetX?: number; offsetY?: number; scale?: number; label?: string; description?: string; airDirection?: "forward" | "reverse"; appearYear?: number; appearMonth?: string; appearDay?: number;
    indDescription?: boolean; indResistance?: boolean; indDeltaP?: boolean; indLeakage?: boolean; indOffsetX?: number; indOffsetY?: number; indFontSize?: number;
    bkResMode?: "project" | "survey" | "manual"; bkManualR?: number; bkWindowArea?: number; bkAirPerm?: number; bkManualAirPerm?: boolean; bkCustomAirPerm?: number; bkSurveyQ?: number; bkSurveyDP?: number; bkBulkheadR?: number;
  }[];
  /** Клик по символу — выбрать */
  onSelectSymbol?: (id: string | null) => void;
  /** Выбранный символ */
  selectedSymbolId?: string | null;
  /** Перемещение свободного символа */
  onSymbolMove?: (id: string, x: number, y: number) => void;
  /** Перемещение символа вдоль ветви (t: 0..1) */
  onSymbolMoveAlongBranch?: (id: string, t: number) => void;
  /** Смещение символа от ветви (px offset) */
  onSymbolOffset?: (id: string, ox: number, oy: number) => void;
  /** Смещение бейджа индикаторов (px offset) */
  onSymbolIndOffset?: (id: string, ox: number, oy: number) => void;
  /** Начало перемещения символа (для сохранения истории undo) */
  onSymbolDragStart?: (id: string) => void;
  /** Клик на символ (для открытия свойств — одиночный) */
  onSymbolClick?: (id: string) => void;
  /** Двойной клик на символ (для открытия настроек вентилятора/перемычки) */
  onSymbolDblClick?: (id: string) => void;
  /** Множественный выбор символов (Ctrl+click) */
  selectedSymbolIds?: Set<string>;
  /** Добавить/убрать символ из множественного выбора */
  onSymbolMultiSelect?: (id: string) => void;
  /** Масштаб символа (delta: +0.2 или -0.2) */
  onSymbolScale?: (id: string, delta: number) => void;
  /** Удаление символа */
  onSymbolDelete?: (id: string) => void;
  /** Активный тип символа для инструмента "symbol" */
  activeSymbolTypeId?: string | null;
  /** Размещение символа на ветви/точке (tool=symbol, клик на ветвь). t — позиция 0..1 вдоль ветви */
  onSymbolPlace?: (typeId: string, x: number, y: number, branchId: string | null, t?: number) => void;
  /** Тип символа в режиме "ожидания привязки" (после копирования/дублирования) */
  pendingSymbolTypeId?: string | null;
  /** Разместить ожидающий символ: t — позиция 0..1 вдоль ветви, null = свободно */
  onPendingSymbolPlace?: (branchId: string, t: number, x: number, y: number) => void;
  /** Конфигурация единиц измерения для отображения меток на схеме */
  unitsConfig?: UnitsConfig;
  /** Смещение блока индикаторов ветви (перетаскивание пользователем) */
  onBranchLabelOffset?: (id: string, ox: number, oy: number) => void;
  /** Колбэк: зарегистрировать функцию получения SVG для печати */
  onRegisterGetSvg?: (fn: () => string) => void;
  /** Колбэк: зарегистрировать прямой доступ к canvas DOM элементу */
  onRegisterCanvasEl?: (el: HTMLCanvasElement | null) => void;
  /** Колбэк: зарегистрировать прямой доступ к SVG DOM элементу */
  onRegisterSvgEl?: (el: SVGSVGElement | null) => void;
  /** Режим размещения маркера позиции на схеме (клик = разместить) */
  positionPlaceMode?: boolean;
  /** Колбэк: пользователь кликнул на схему в режиме размещения позиции */
  onPositionPlace?: (wx: number, wy: number) => void;
  /** Режим привязки ветвей к позиции (F3) — все ветви подсвечиваются */
  branchBindMode?: boolean;
  /** Карта branchId → цвет позиции (для подсветки привязанных ветвей в F3) */
  branchPositionColors?: Map<string, { color: string; bound: boolean }>;
  /** Карта branchId → color для окраски ветвей цветом позиции ВНУТРИ (ПЛА) */
  posInnerColors?: Map<string, string>;
  /** Карта branchId → color для окраски ветвей цветом позиции СНАРУЖИ (ПЛА) */
  posOuterColors?: Map<string, string>;
  /** Результаты гидравлического расчёта узлов (для маркеров предупреждений на схеме) */
  waterNodeResults?: Map<string, import("@/lib/waterHydraulics").WaterNodeResult>;
  /** Карта branchId → сегмент задымления {color, fromT, toT} */
  branchFireColors?: Map<string, { color: string; fromT: number; toT: number }>;
  /** Карта branchId → зона поражения взрывом {color, hazardLevel} */
  branchExplosionColors?: Map<string, { color: string; hazardLevel: string }>;
  /** ID ветвей маршрута горноспасателей — подсвечиваются зелёным */
  rescuePathBranchIds?: Set<string>;
  /** Направление движения по ветви маршрута: true = fromId→toId, false = toId→fromId */
  rescuePathBranchDirs?: Map<string, boolean>;
  /** ID узлов маршрута горноспасателей (старт/финиш) — подсвечиваются */
  rescuePathNodeIds?: Set<string>;
  /** Callback при клике по узлу в режиме pick (rescuePickMode) */
  onRescueNodePick?: (nodeId: string) => void;
  /** Режим выбора узла для горноспасателей */
  rescuePickMode?: string | null;
  /** Режим цветовой заливки ветвей: none = выкл, flowQ = по расходу воздуха */
  colorMode?: "none" | "flowQ";
  /** Минимальное значение шкалы расхода, м³/с */
  flowColorMin?: number;
  /** Максимальное значение шкалы расхода, м³/с */
  flowColorMax?: number;
  /** Цветовая гамма шкалы расхода */
  flowColorHue?: "red" | "blue" | "green";
}

export type FlowDisplayMode =
  | "off"        // только статичные линии без направления
  | "flow"       // бегущая пунктирная анимация (по умолчанию)
  | "chevrons"   // шевроны ▶ ▶ ▶ вдоль ветви
  | "both";      // и бегущий пунктир, и шевроны

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
  azimuth: number;     // °
  elevation: number;   // °
}

export default function TopoCanvas(props: Props) {
  const {
    nodes, branches, selectedNodeId, selectedBranchId, tool,
    onNodeAdd, onNodeMove, onBranchAdd, onSplitBranchAt, onSelectNode, onSelectBranch, zLevel,
    viewPreset, onViewChange, flowDisplay = "off", workPlane,
    horizons, branchWidth = 2.5, branchBorder = 0, thinLines = false, fixedObjectScale = false,
    colorByHorizon = false, showFlowArrows = false,
    scaleOverride, onScaleChange, fitToScreenNonce,
    focusNonce, focusNodeId, focusBranchId,
    editingHorizonImageId, onHorizonImageBoundsChange,
    editingPrintLayerId, onPrintLayerBoundsChange, onPrintLayerChange,
    onNodeContextMenu, onBranchContextMenu, onCanvasContextMenu,
    selectedBranchIds, onBranchMultiSelect,
    selectedNodeIds, onNodeMultiSelect,
    infoConfig, zScale = 1, xyScale = 1,
    schemaSymbols = [], onSelectSymbol, selectedSymbolId, onSymbolMove,
    onSymbolMoveAlongBranch, onSymbolOffset, onSymbolIndOffset, onSymbolDragStart, onSymbolClick, onSymbolDblClick,
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
    branchFireColors,
    branchExplosionColors,
    rescuePathBranchIds,
    rescuePathBranchDirs,
    rescuePathNodeIds,
    onRescueNodePick,
    rescuePickMode,
    colorMode = "none",
    flowColorMin = 0,
    flowColorMax = 75,
    flowColorHue = "red",
  } = props;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasExportRef = useRef<(() => string) | null>(null);

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

  // Узел скрыт, если ВСЕ его ветви принадлежат скрытым горизонтам.
  const hiddenNodeIds = useMemo(() => new Set(
    nodes
      .filter((n) => {
        const nodesBranches = branches.filter(
          (b) => b.fromId === n.id || b.toId === n.id
        );
        if (nodesBranches.length === 0) return false;
        return nodesBranches.every((b) => hiddenBranchIds.has(b.id));
      })
      .map((n) => n.id)
  ), [nodes, branches, hiddenBranchIds]);

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
  const symTouchRef = useRef<{ x: number; y: number } | null>(null);
  // Для определения двойного клика по УО
  const symLastClickRef = useRef<{ id: string; time: number } | null>(null);
  const [draggingSymbolId, setDraggingSymbolId] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<{ id: string; plane: WorkPlane } | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverBranchId, setHoverBranchId] = useState<string | null>(null);
  const [hoverScreenPos, setHoverScreenPos] = useState<{ sx: number; sy: number } | null>(null);

  // Перетаскивание угла подложки горизонта: какой именно угол тащим.
  const [draggingCorner, setDraggingCorner] = useState<
    { horizonId: string; corner: "tl" | "tr" | "bl" | "br" } | null
  >(null);
  // Перетаскивание рамки слоя печати: corner = угол, "move" = всё тело рамки.
  const [draggingPrintCorner, setDraggingPrintCorner] = useState<
    { horizonId: string; corner: "tl" | "tr" | "bl" | "br" | "move"; startWx: number; startWy: number; startBounds: { x1: number; y1: number; x2: number; y2: number } } | null
  >(null);
  // Перетаскивание заголовка слоя печати
  const [draggingPrintTitle, setDraggingPrintTitle] = useState<
    { horizonId: string; startSx: number; startSy: number; startOffX: number; startOffY: number } | null
  >(null);
  // Редактирование заголовка слоя печати
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState("");

  // При смене инструмента сбрасываем «начало ветви» — иначе возникнут призрачные сегменты.
  useEffect(() => { setBranchFrom(null); }, [tool]);

  // ─── ВОССТАНОВЛЕНИЕ СОХРАНЁННОГО ВИДА ───────────────────────────────
  // restoredViewNonce: когда view восстановлен из файла — блокируем fitToScreen
  const restoredViewNonce = useRef<number>(0);
  useEffect(() => {
    if (!restoreView) return;
    restoredViewNonce.current = Date.now();
    setView((v) => ({
      scale: restoreView.scale ?? v.scale,
      offsetX: restoreView.offsetX ?? v.offsetX,
      offsetY: restoreView.offsetY ?? v.offsetY,
      azimuth: restoreView.azimuth ?? v.azimuth,
      elevation: restoreView.elevation ?? v.elevation,
    }));
    onRestoreViewDone?.();
  }, [restoreView]); // eslint-disable-line react-hooks/exhaustive-deps

  // Синхронизируем viewRef — всегда актуальное значение для нативных listeners
  useEffect(() => { viewRef.current = view; });

  // ─── РЕПОРТИНГ ТЕКУЩЕГО ВИДА НАРУЖУ (для сохранения) ────────────────
  useEffect(() => {
    onViewStateChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale, view.offsetX, view.offsetY, view.azimuth, view.elevation]);

  // ─── СИНХРОНИЗАЦИЯ ВНЕШНЕГО МАСШТАБА ────────────────────────────────
  // scaleOverride используется ТОЛЬКО для внешних команд (ввод в поле, fitToScreen).
  // Компенсация сдвига view при изменении xyScale/zScale без сброса позиции камеры
  const prevXyScale = useRef<number>(xyScale);
  const prevZScale = useRef<number>(zScale);
  useEffect(() => {
    const prev = prevXyScale.current;
    prevXyScale.current = xyScale;
    if (prev === xyScale || prev === 0) return;
    const ratio = xyScale / prev;
    // Центр экрана остаётся на том же мировом XY — сдвигаем offset
    setView((v) => ({
      ...v,
      offsetX: size.w / 2 - (size.w / 2 - v.offsetX) * ratio,
      offsetY: size.h / 2 - (size.h / 2 - v.offsetY) * ratio,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xyScale]);

  useEffect(() => {
    const prev = prevZScale.current;
    prevZScale.current = zScale;
    if (prev === zScale || prev === 0) return;
    const ratio = zScale / prev;
    // При смене zScale в 3D-режиме корректируем вертикальный offset
    if (!is3D) return;
    setView((v) => ({
      ...v,
      offsetY: size.h / 2 - (size.h / 2 - v.offsetY) * ratio,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zScale]);

  // Wheel-зум работает полностью внутри и не синхронизируется с родителем.
  const prevScaleOverride = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (scaleOverride === undefined) return;
    // Реагируем только если значение реально изменилось снаружи
    if (prevScaleOverride.current === scaleOverride) return;
    prevScaleOverride.current = scaleOverride;
    setView((v) => {
      if (Math.abs(scaleOverride - v.scale) < 1e-6) return v;
      return { ...v, scale: scaleOverride };
    });
  }, [scaleOverride]);

  // ─── ВПИСАТЬ ВСЮ СЕТЬ В ЭКРАН ───────────────────────────────────────
  // Реагируем на смену nonce из родителя — вписываем все узлы в экран.
  // Используем project3D с текущим ракурсом, чтобы корректно работать для план/фронт/профиль/3D.
  useEffect(() => {
    if (!fitToScreenNonce) return;
    if (nodes.length === 0) return;
    if (size.w < 50 || size.h < 50) return;
    // Если view был восстановлен из файла менее 2 секунд назад — не перезаписываем
    if (restoredViewNonce.current && (Date.now() - restoredViewNonce.current) < 2000) return;
    // Проецируем узлы при масштабе 1 и offset(0,0) — получаем "мировые экранные" координаты
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
    const scaleX = (size.w * (1 - pad * 2)) / dw;
    const scaleY = (size.h * (1 - pad * 2)) / dh;
    const newScale = Math.max(0.0005, Math.min(5000, Math.min(scaleX, scaleY)));
    const csx = (minSx + maxSx) / 2;
    const csy = (minSy + maxSy) / 2;
    setView((v) => ({
      ...v,
      scale: newScale,
      offsetX: size.w / 2 - csx * newScale,
      offsetY: size.h / 2 - csy * newScale,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToScreenNonce]);

  // ─── Центрирование камеры на конкретном узле/ветви ───────────────
  useEffect(() => {
    if (!focusNonce) return;
    if (size.w < 50 || size.h < 50) return;

    const tmpProj: ProjOptions = {
      scale: 1, offsetX: 0, offsetY: 0,
      azimuth: view.azimuth, elevation: view.elevation, zScale,
    };

    let targetX = 0, targetY = 0, found = false;
    if (focusNodeId) {
      const n = nodes.find(nn => nn.id === focusNodeId);
      if (n) {
        const p = project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, tmpProj);
        targetX = p.sx; targetY = p.sy; found = true;
      }
    } else if (focusBranchId) {
      const b = branches.find(bb => bb.id === focusBranchId);
      if (b) {
        const fromN = nodes.find(n => n.id === b.fromId);
        const toN = nodes.find(n => n.id === b.toId);
        if (fromN && toN) {
          const pf = project3D({ x: fromN.x * (xyScale ?? 1), y: fromN.y * (xyScale ?? 1), z: fromN.z * (zScale ?? 1) }, tmpProj);
          const pt = project3D({ x: toN.x * (xyScale ?? 1),   y: toN.y * (xyScale ?? 1),   z: toN.z   * (zScale ?? 1) }, tmpProj);
          targetX = (pf.sx + pt.sx) / 2;
          targetY = (pf.sy + pt.sy) / 2;
          found = true;
        }
      }
    }
    if (!found) return;

    // Если масштаб слишком мелкий — приблизим, чтобы объект было видно.
    const minScaleForFocus = 0.6;
    const newScale = Math.max(view.scale, minScaleForFocus);

    setView((v) => ({
      ...v,
      scale: newScale,
      offsetX: size.w / 2 - targetX * newScale,
      offsetY: size.h / 2 - targetY * newScale,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Нативный wheel-listener:
  //   Ctrl+колесо       → зум к курсору
  //   Shift+колесо      → панорама по горизонтали
  //   Обычное колесо    → панорама по вертикали
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      // Нормализуем дельту: deltaMode 0=px, 1=lines, 2=pages
      const rawY = e.deltaY;
      const rawX = e.deltaX;
      const normY = e.deltaMode === 1 ? rawY * 18 : e.deltaMode === 2 ? rawY * 400 : rawY;
      const normX = e.deltaMode === 1 ? rawX * 18 : e.deltaMode === 2 ? rawX * 400 : rawX;

      const v = viewRef.current;

      if (e.ctrlKey || e.metaKey) {
        // ── ЗУМ К КУРСОРУ ────────────────────────────────────────────
        const capped = Math.max(-80, Math.min(80, normY));
        const factor = Math.pow(0.999, capped);
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
      } else if (e.shiftKey) {
        // ── ПАНОРАМА ПО ГОРИЗОНТАЛИ (Shift+колесо) ───────────────────
        const pan = Math.max(-120, Math.min(120, normY + normX));
        const newView: ViewState = { ...v, offsetX: v.offsetX - pan };
        viewRef.current = newView;
        setView(newView);
      } else {
        // ── ПАНОРАМА ПО ВЕРТИКАЛИ (обычное колесо) ───────────────────
        const panY = Math.max(-120, Math.min(120, normY));
        const panX = Math.max(-120, Math.min(120, normX));
        const newView: ViewState = { ...v, offsetX: v.offsetX - panX, offsetY: v.offsetY - panY };
        viewRef.current = newView;
        setView(newView);
      }
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Refs для touch hit-test — заполняются ниже после объявления projNodes/projNodesMap
  const touchHitRef = useRef<{
    projNodes: Parameters<typeof hitNodeR>[2];
    projNodesMap: Parameters<typeof hitBranchR>[1];
    branches: typeof branches;
    onSelectNode: typeof onSelectNode;
    onSelectBranch: typeof onSelectBranch;
    onScaleChange?: typeof onScaleChange;
  } | null>(null);

  // Флаг: после применения пресета вписать схему в экран
  const fitAfterPresetRef = useRef(false);

  // Применение пресета ракурса извне
  useEffect(() => {
    if (!viewPreset) return;
    const p = VIEW_PRESETS[viewPreset.name];
    // Авто-fit только если вид не был восстановлен из файла недавно
    const timeSinceRestore = Date.now() - restoredViewNonce.current;
    if (timeSinceRestore > 3000) {
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

  // Проекции всех узлов — пересчитываются только при изменении nodes или proj
  const projNodes = useMemo(
    () => nodes.map((n) => ({ node: n, ...projectWithZ(n) })),
    [nodes, projectWithZ]
  );

  // Map для O(1) lookup по ID узла (вместо O(n) find внутри рендера)
  const projNodesMap = useMemo(() => {
    const m = new Map<string, { node: typeof projNodes[0]["node"]; sx: number; sy: number; depth: number }>();
    for (const p of projNodes) m.set(p.node.id, p);
    return m;
  }, [projNodes]);

  // Обновляем ref для touch hit-test (всегда актуальные данные без пересоздания listeners)
  touchHitRef.current = { projNodes, projNodesMap, branches, onSelectNode, onSelectBranch, onScaleChange };

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
          const { projNodes: pn, projNodesMap: pnm, branches: br, onSelectNode: selN, onSelectBranch: selB } = touchHitRef.current;
          const hitN = hitNodeR(sx, sy, pn, 16);
          const hitB = !hitN ? hitBranchR(sx, sy, pnm, br, 12) : null;
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
  const applyPreset = useCallback((preset: ViewPreset) => {
    const p = VIEW_PRESETS[preset];
    setView((v) => ({ ...v, azimuth: p.azimuth, elevation: p.elevation }));
  }, []);

  // Эффективная рабочая плоскость: явно заданная пользователем либо подобранная по ракурсу
  const effPlane: WorkPlane = workPlane ?? autoWorkPlane(view.azimuth, view.elevation, {
    z: zLevel, y: 0, x: 0,
  });

  // Универсальная обратная проекция: screen → world через рабочую плоскость
  const screenToWorld = useCallback((sx: number, sy: number, fixedZ?: number): { x: number; y: number; z: number } | null => {
    // В 2D-плане используем простую формулу с zLevel (или явно переданным fixedZ)
    if (!is3D) return unproject2D(sx, sy, proj, fixedZ ?? zLevel);
    // В 3D — пересечение луча с рабочей плоскостью
    const plane: WorkPlane = fixedZ !== undefined ? { axis: "z", value: fixedZ } : effPlane;
    return unprojectToPlane(sx, sy, proj, plane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, zLevel, is3D, effPlane.axis, effPlane.value]);

  // ─── Контекстное меню по правой кнопке ─────────────────────────────────
  const onContextMenuSVG = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = (e.currentTarget as Element).getBoundingClientRect();
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
      onSelectBranch(hitB);
      onSelectNode(null);
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
        pivotScreen: project3D({ x: 0, y: 0, z: 0 }, proj),
      };
    }
    let sx = 0, sy = 0, sz = 0;
    for (const n of nodes) {
      sx += n.x; sy += n.y; sz += n.z * (zScale ?? 1);
    }
    const cx = sx / nodes.length;
    const cy = sy / nodes.length;
    const cz = sz / nodes.length;
    return {
      pivot: { x: cx, y: cy, z: cz },
      pivotScreen: project3D({ x: cx, y: cy, z: cz }, proj),
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

    const rect = (e.currentTarget as Element).getBoundingClientRect();

    // ─── РЕЖИМ РАЗМЕЩЕНИЯ МАРКЕРА ПОЗИЦИИ ──────────────────────────────
    if (positionPlaceMode && onPositionPlace && e.button === 0) {
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const w = unprojectToPlane(sx, sy, view, { axis: "z", value: 0 }) ?? unproject2D(sx, sy, view);
      onPositionPlace(w.x, w.y);
      e.stopPropagation();
      return;
    }
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Если клик произошёл внутри g[data-sym] — это символ УО, не трогаем ветвь/узел
    if ((e.target as Element).closest?.("[data-sym]")) return;

    const hitN = hitNode(sx, sy, projNodes);
    const hitB = !hitN ? hitBranch(sx, sy, projNodesMap, branches) : null;

    // ─── РЕЖИМ ВЫБОРА УЗЛА ДЛЯ ГОРНОСПАСАТЕЛЕЙ (pick-mode) ────────────
    if (rescuePickMode && onRescueNodePick && hitN && e.button === 0) {
      onRescueNodePick(hitN);
      e.stopPropagation();
      return;
    }

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
      if (e.ctrlKey && onNodeMultiSelect) {
        onNodeMultiSelect(hitN);
      } else {
        onSelectNode(hitN);
        onSelectBranch(null);
        // Перетаскивание узла: и в 2D, и в 3D.
        const node = nodes.find((n) => n.id === hitN);
        if (node) {
          const zv = node.z * (zScale ?? 1);
          const plane: WorkPlane = !is3D
            ? { axis: "z", value: zv }
            : effPlane.axis === "z" ? { axis: "z", value: zv }
            : effPlane.axis === "y" ? { axis: "y", value: node.y }
            : { axis: "x", value: node.x };
          setDraggingNode({ id: hitN, plane });
        }
      }
      return;
    }

    if (hitB) {
      if (e.ctrlKey && onBranchMultiSelect) {
        onBranchMultiSelect(hitB);
      } else {
        onSelectBranch(hitB);
        onSelectNode(null);
      }
      return;
    }

    if (!e.ctrlKey) {
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
    const rect = (e.currentTarget as Element).getBoundingClientRect();
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
      const dx = sx - draggingPrintTitle.startSx;
      const dy = sy - draggingPrintTitle.startSy;
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

    setHoverScreenPos({ sx, sy });

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
      const newPivotScreen = project3D(rotStart.pivot, tmpProj);
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
      // Тащим в плоскости, зафиксированной при начале drag
      const wp = is3D
        ? unprojectToPlane(sx, sy, proj, draggingNode.plane)
        : unproject2D(sx, sy, proj, draggingNode.plane.axis === "z" ? draggingNode.plane.value : 0);
      if (!wp) return;
      // Делим Z обратно на zScale (proj работает с z*zScale, нам нужны мировые метры)
      const zWorld = (zScale && zScale !== 1) ? wp.z / zScale : wp.z;
      onNodeMove(draggingNode.id, wp.x, wp.y, zWorld);
      return;
    }
    if (draggingCorner && onHorizonImageBoundsChange) {
      // Перетаскивание угла подложки горизонта в плоскости z=z горизонта.
      const hz = horizons?.find((hh) => hh.id === draggingCorner.horizonId);
      if (!hz || !hz.image) return;
      const plane: WorkPlane = { axis: "z", value: hz.z };
      const wp = is3D ? unprojectToPlane(sx, sy, proj, plane) : unproject2D(sx, sy, proj, hz.z);
      if (!wp) return;
      const b = { ...hz.image.bounds };
      switch (draggingCorner.corner) {
        case "tl": b.x1 = wp.x; b.y2 = wp.y; break;   // мировой Y растёт вверх; подложка верх=y2
        case "tr": b.x2 = wp.x; b.y2 = wp.y; break;
        case "bl": b.x1 = wp.x; b.y1 = wp.y; break;
        case "br": b.x2 = wp.x; b.y1 = wp.y; break;
      }
      onHorizonImageBoundsChange(draggingCorner.horizonId, b);
    }

  };

  const onMouseUp = () => {
    setPanStart(null);
    setRotStart(null);
    setDraggingNode(null);
    setDraggingCorner(null);
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

  // Сортировка ветвей: сначала по глубине (3D), затем по иерархии горизонтов (как в Фотошопе)
  // Горизонт с меньшим индексом в списке рисуется ПОВЕРХ остальных
  const branchesSorted = useMemo(() => [...visibleBranches].map((b) => {
    const from = projNodesMap.get(b.fromId);
    const to = projNodesMap.get(b.toId);
    const depth = from && to ? (from.depth + to.depth) / 2 : 0;
    // Порядок горизонта: чем меньше индекс — тем поверх (инвертируем для sort)
    const hOrder = b.horizonId ? (horizonOrderMap.get(b.horizonId) ?? 9999) : 9999;
    return { branch: b, depth, hOrder };
  }).sort((a, b) => {
    // Сначала по глубине 3D, затем по иерархии горизонтов (больший hOrder = ниже)
    if (a.depth !== b.depth) return a.depth - b.depth;
    return b.hOrder - a.hOrder; // меньший индекс горизонта рисуется поверх
  }), [visibleBranches, projNodesMap, horizonOrderMap]);

  const nodesSorted = useMemo(
    () => [...projNodes].sort((a, b) => a.depth - b.depth),
    [projNodes]
  );

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
    let rx: number, ry: number, rw: number, rh: number;
    const wb: { x1: number; y1: number; x2: number; y2: number } = { x1: 0, y1: 0, x2: 0, y2: 0 };
    const pTL = { sx: 0, sy: 0 }, pTR = { sx: 0, sy: 0 }, pBL = { sx: 0, sy: 0 }, pBR = { sx: 0, sy: 0 };

    if (h.id === OVERVIEW_HORIZON_ID && !pl.bounds) {
      // Для "Общего вида" без ручного bounds — авто-bbox из проекций ВСЕХ узлов.
      const allNodes = nodes.length > 0 ? nodes : null;
      if (!allNodes) return null;
      let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
      allNodes.forEach(n => {
        const p = project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, proj);
        if (p.sx < minSx) minSx = p.sx;
        if (p.sx > maxSx) maxSx = p.sx;
        if (p.sy < minSy) minSy = p.sy;
        if (p.sy > maxSy) maxSy = p.sy;
      });
      const spreadX = maxSx - minSx, spreadY = maxSy - minSy;
      // Минимальный размер — чтобы рамка не схлопывалась при фронтальной/профильной проекции
      const minSpread = Math.max(spreadX, spreadY, size.w * 0.1, 80);
      const padPx = Math.max(20, minSpread * 0.08);
      const cxS = (minSx + maxSx) / 2, cyS = (minSy + maxSy) / 2;
      const fitW = Math.max(spreadX, minSpread * 0.3) + padPx * 2;
      const fitH = Math.max(spreadY, minSpread * 0.3) + padPx * 2;
      let rw2 = fitW, rh2 = fitW / aspect;
      if (rh2 < fitH) { rh2 = fitH; rw2 = fitH * aspect; }
      rw2 = Math.max(rw2, 60); rh2 = Math.max(rh2, 60);
      rx = cxS - rw2 / 2; ry = cyS - rh2 / 2; rw = rw2; rh = rh2;
      Object.assign(pTL, { sx: rx, sy: ry });
      Object.assign(pTR, { sx: rx + rw, sy: ry });
      Object.assign(pBL, { sx: rx, sy: ry + rh });
      Object.assign(pBR, { sx: rx + rw, sy: ry + rh });
    } else {
      // Для обычных горизонтов — мировые bounds → 4 угла → экранный bbox
      if (pl.bounds) {
        Object.assign(wb, pl.bounds);
      } else {
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
        const fitW = ww + pad * 2;
        const fitH = wh + pad * 2;
        let rw2 = fitW, rh2 = fitW / aspect;
        if (rh2 < fitH) { rh2 = fitH; rw2 = fitH * aspect; }
        Object.assign(wb, { x1: cx - rw2 / 2, y1: cy - rh2 / 2, x2: cx + rw2 / 2, y2: cy + rh2 / 2 });
      }
      const xy = xyScale ?? 1;
      const zs = zScale ?? 1;
      const _pTL = project3D({ x: wb.x1 * xy, y: wb.y2 * xy, z: h.z * zs }, proj);
      const _pTR = project3D({ x: wb.x2 * xy, y: wb.y2 * xy, z: h.z * zs }, proj);
      const _pBL = project3D({ x: wb.x1 * xy, y: wb.y1 * xy, z: h.z * zs }, proj);
      const _pBR = project3D({ x: wb.x2 * xy, y: wb.y1 * xy, z: h.z * zs }, proj);
      Object.assign(pTL, _pTL); Object.assign(pTR, _pTR);
      Object.assign(pBL, _pBL); Object.assign(pBR, _pBR);
      rx = Math.min(pTL.sx, pBL.sx);
      ry = Math.min(pTL.sy, pTR.sy);
      rw = Math.max(pTR.sx, pBR.sx) - rx;
      rh = Math.max(pBL.sy, pBR.sy) - ry;
    }
    const inset = Math.max(4, Math.min(rw, rh) * 0.015);
    const titleFontSize = Math.max(9, Math.min(18, rh * 0.03));

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
            const plane: WorkPlane = { axis: "z", value: h.z };
            const wp = is3D ? unprojectToPlane(csx, csy, proj, plane) : unproject2D(csx, csy, proj, h.z);
            if (!wp) return;
            const _xys = xyScale ?? 1;
            const activeBounds = (wb.x1 === 0 && wb.x2 === 0)
              ? (() => {
                  const wBL = unproject2D(rx,      ry + rh, proj, h.z);
                  const wTR = unproject2D(rx + rw, ry,      proj, h.z);
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
              const wp2 = is3D ? unprojectToPlane(sx2, sy2, proj, plane) : unproject2D(sx2, sy2, proj, h.z);
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
          const titleX = rx + rw / 2 + (pl.titleOffsetX ?? 0);
          const titleY = ry + inset + titleFontSize + 4 + (pl.titleOffsetY ?? 0);
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
                setDraggingPrintTitle({ horizonId: h.id, startSx, startSy, startOffX, startOffY });
                const onMove = (me: MouseEvent) => {
                  onPrintLayerChange?.(h.id, {
                    titleOffsetX: startOffX + (me.clientX - startSx),
                    titleOffsetY: startOffY + (me.clientY - startSy),
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
          const apW = Math.min(rw * 0.28, 220);
          const apX = rx + rw - inset - apW;
          const apY = ry + inset + 2;
          const apFs = Math.max(7, Math.min(13, rh * 0.018));
          const lw2 = Math.max(0.4, apFs * 0.06);
          const canEdit = !!onPrintLayerChange;
          const apCx = apX + apW / 2;
          let ay = apY + apFs * 1.4;
          const lineY = (dy: number) => { ay += dy; return ay; };
          return (
            <g key="approver-block">
              <rect x={apX} y={apY} width={apW} height={apFs * 10} fill="white" style={{ pointerEvents: "none" }} />
              {/* УТВЕРЖДАЮ */}
              <text x={apCx} y={lineY(0)} textAnchor="middle" fontSize={apFs * 1.1} fontWeight="bold" fontFamily="Arial, sans-serif" fill="#111" style={{ pointerEvents: "none" }}>УТВЕРЖДАЮ</text>
              {/* Должность */}
              <text x={apCx} y={lineY(apFs * 1.6)} textAnchor="middle" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111"
                style={{ cursor: canEdit ? "text" : "default" }}
                onDoubleClick={canEdit ? () => { const v = prompt("Должность:", pl.approverTitle ?? ""); if (v !== null) onPrintLayerChange?.(h.id, { approverTitle: v }); } : undefined}>
                {pl.approverTitle || (canEdit ? "Должность" : "")}
              </text>
              {/* Организация */}
              <text x={apCx} y={lineY(apFs * 1.4)} textAnchor="middle" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111"
                style={{ cursor: canEdit ? "text" : "default" }}
                onDoubleClick={canEdit ? () => { const v = prompt("Организация:", pl.orgName ?? ""); if (v !== null) onPrintLayerChange?.(h.id, { orgName: v }); } : undefined}>
                {pl.orgName || (canEdit ? "Организация" : "")}
              </text>
              {/* Линия */}
              <line x1={apX + apFs} y1={lineY(apFs * 1.6)} x2={apX + apW - apFs} y2={ay} stroke="#111" strokeWidth={lw2} />
              {/* ФИО */}
              <text x={apX + apW - apFs * 0.5} y={lineY(apFs * 1.2)} textAnchor="end" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#1a44b8"
                style={{ cursor: canEdit ? "text" : "default" }}
                onDoubleClick={canEdit ? () => { const v = prompt("ФИО:", pl.approverName ?? ""); if (v !== null) onPrintLayerChange?.(h.id, { approverName: v }); } : undefined}>
                {pl.approverName || (canEdit ? "И.О. Фамилия" : "")}
              </text>
              {/* Линия даты */}
              <line x1={apX} y1={lineY(apFs * 1.4)} x2={apX + apW} y2={ay} stroke="#111" strokeWidth={lw2} />
              {/* Год */}
              <text x={apCx} y={lineY(apFs * 1.2)} textAnchor="middle" fontSize={apFs} fontFamily="Arial, sans-serif" fill="#111"
                style={{ cursor: canEdit ? "text" : "default" }}
                onDoubleClick={canEdit ? () => { const v = prompt("Год:", pl.year ?? ""); if (v !== null) onPrintLayerChange?.(h.id, { year: v }); } : undefined}>
                «{pl.year || String(new Date().getFullYear())}» ___________ г.
              </text>
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
              const plane: WorkPlane = { axis: "z", value: h.z };
              const wp = is3D ? unprojectToPlane(csx, csy, proj, plane) : unproject2D(csx, csy, proj, h.z);
              if (!wp) return;
              const _xys2 = xyScale ?? 1;
              const activeBounds = (wb.x1 === 0 && wb.x2 === 0)
                ? (() => {
                    const wBL = unproject2D(rx,      ry + rh, proj, h.z);
                    const wTR = unproject2D(rx + rw, ry,      proj, h.z);
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
                const wp2 = is3D ? unprojectToPlane(sx2, sy2, proj, plane) : unproject2D(sx2, sy2, proj, h.z);
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

        {/* ── Блок УО на схеме ────────────────────────────────────────────── */}
        {pl.showLegend && (() => {
          const legW = Math.max(100, rw * 0.22);
          const legFontSize = Math.max(7, Math.min(13, rh * 0.018));
          const legLineH = legFontSize * 1.6;
          const legIconW = legFontSize * 2.2;
          const legPad = legFontSize * 0.6;
          const legendItems = [
            { name: "Позиция ПЛА", color: "#333", shape: "circle" },
            { name: "Реверсивная позиция", color: "#dc2626", shape: "circle2" },
            { name: "Станция замера воздуха", color: "#dc2626", shape: "lines2" },
            { name: "Струя входящая", color: "#dc2626", shape: "arrow-r" },
            { name: "Струя исходящая", color: "#2196f3", shape: "arrow-l" },
            { name: "Устье выработки", color: "#333", shape: "rect-x" },
            { name: "Блоковый запасной выход", color: "#333", shape: "blocks3" },
            { name: "Аварийная сигнализация", color: "#333", shape: "speaker" },
            { name: "Запасной выход", color: "#111", shape: "blocks3b" },
            { name: "Телефон", color: "#333", shape: "circle-t" },
            { name: "Огнетушитель", color: "#dc2626", shape: "circle-o" },
          ];
          const legH = legPad * 2 + legendItems.length * legLineH + legFontSize * 1.5;
          const legOffX = pl.legendOffsetX ?? 0;
          const legOffY = pl.legendOffsetY ?? 0;
          const lx = rx + legOffX;
          const ly = ry + rh - legH + legOffY;
          const canDrag = !!onPrintLayerChange;

          const renderIcon = (shape: string, color: string, x: number, y: number, iw: number, ih: number) => {
            const cx = x + iw / 2, cy = y + ih / 2;
            const sw = Math.max(0.5, legFontSize * 0.12);
            switch (shape) {
              case "circle": return <circle cx={cx} cy={cy} r={ih * 0.38} fill="none" stroke={color} strokeWidth={sw * 1.5} />;
              case "circle2": return <><circle cx={cx} cy={cy} r={ih * 0.38} fill="none" stroke={color} strokeWidth={sw * 2}/><circle cx={cx} cy={cy} r={ih * 0.19} fill="none" stroke={color} strokeWidth={sw}/></>;
              case "lines2": return <><line x1={x+1} y1={cy-ih*0.1} x2={x+iw-1} y2={cy-ih*0.1} stroke={color} strokeWidth={sw*2.5}/><line x1={x+1} y1={cy+ih*0.1} x2={x+iw-1} y2={cy+ih*0.1} stroke={color} strokeWidth={sw*2.5}/></>;
              case "arrow-r": return <><line x1={x+1} y1={cy} x2={x+iw-ih*0.25} y2={cy} stroke={color} strokeWidth={sw*2}/><polygon points={`${x+iw-ih*0.3},${cy-ih*0.28} ${x+iw},${cy} ${x+iw-ih*0.3},${cy+ih*0.28}`} fill={color}/></>;
              case "arrow-l": return <><line x1={x+ih*0.25} y1={cy} x2={x+iw-1} y2={cy} stroke={color} strokeWidth={sw*2}/><polygon points={`${x+ih*0.3},${cy-ih*0.28} ${x},${cy} ${x+ih*0.3},${cy+ih*0.28}`} fill={color}/></>;
              case "rect-x": return <><rect x={cx-ih*0.3} y={cy-ih*0.38} width={ih*0.6} height={ih*0.76} fill="none" stroke={color} strokeWidth={sw}/><line x1={cx-ih*0.3} y1={cy-ih*0.38} x2={cx+ih*0.3} y2={cy+ih*0.38} stroke={color} strokeWidth={sw*0.7}/><line x1={cx+ih*0.3} y1={cy-ih*0.38} x2={cx-ih*0.3} y2={cy+ih*0.38} stroke={color} strokeWidth={sw*0.7}/></>;
              case "blocks3": return <><rect x={x+1} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#222"/><rect x={x+iw*0.36} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#ffd600"/><rect x={x+iw*0.72} y={cy-ih*0.3} width={iw*0.26} height={ih*0.6} fill="#222"/></>;
              case "blocks3b": return <><rect x={x+1} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#111"/><rect x={x+iw*0.36} y={cy-ih*0.3} width={iw*0.28} height={ih*0.6} fill="#111"/><rect x={x+iw*0.72} y={cy-ih*0.3} width={iw*0.26} height={ih*0.6} fill="#111"/></>;
              case "speaker": return <><polygon points={`${x+3},${cy-ih*0.22} ${cx-ih*0.08},${cy-ih*0.22} ${cx+ih*0.18},${cy-ih*0.42} ${cx+ih*0.18},${cy+ih*0.42} ${cx-ih*0.08},${cy+ih*0.22} ${x+3},${cy+ih*0.22}`} fill="none" stroke={color} strokeWidth={sw}/><path d={`M${cx+ih*0.18} ${cy-ih*0.12} Q${cx+ih*0.38} ${cy} ${cx+ih*0.18} ${cy+ih*0.12}`} fill="none" stroke={color} strokeWidth={sw}/></>;
              case "circle-t": return <><circle cx={cx} cy={cy} r={ih*0.38} fill="none" stroke={color} strokeWidth={sw}/><text x={cx} y={cy+legFontSize*0.35} textAnchor="middle" fontSize={legFontSize*0.85} fontWeight="bold" fill={color}>T</text></>;
              case "circle-o": return <><circle cx={cx} cy={cy} r={ih*0.38} fill="none" stroke={color} strokeWidth={sw}/><circle cx={cx} cy={cy} r={ih*0.19} fill="none" stroke={color} strokeWidth={sw}/></>;
              default: return null;
            }
          };

          return (
            <g key="legend-block">
              <rect x={lx} y={ly} width={legW} height={legH} fill="white" stroke="#333" strokeWidth={Math.max(0.5, rw * 0.002)} />
              <text x={lx + legPad} y={ly + legPad + legFontSize} fontSize={legFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
                Условные обозначения
              </text>
              {legendItems.map((item, idx) => {
                const iy = ly + legPad + legFontSize * 1.5 + idx * legLineH;
                const ih = legLineH * 0.8;
                return (
                  <g key={idx}>
                    {renderIcon(item.shape, item.color, lx + legPad, iy + (legLineH - ih) / 2, legIconW, ih)}
                    <text x={lx + legPad + legIconW + legPad * 0.5} y={iy + legLineH * 0.65}
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
                    const onMove = (me: MouseEvent) => onPrintLayerChange?.(h.id, { legendOffsetX: startOX + me.clientX - startX, legendOffsetY: startOY + me.clientY - startY });
                    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
                  }}
                />
              )}
            </g>
          );
        })()}

        {/* ── Штамп на схеме (правый нижний угол) ────────────────────────── */}
        {pl.showStamp && (() => {
          const stFontSize = Math.max(6, Math.min(12, rh * 0.016));
          const stW = Math.min(rw * 0.65, 420);
          const stH = stFontSize * 14;
          const stOffX = pl.stampOffsetX ?? 0;
          const stOffY = pl.stampOffsetY ?? 0;
          const sx2 = rx + rw - stW + stOffX;
          const sy2 = ry + rh - stH + stOffY;
          const sw2 = Math.max(0.3, rw * 0.0015);
          const canDrag = !!onPrintLayerChange;
          const rowH = stH / 7;
          const col = [0, 0.25, 0.5, 0.67, 0.83].map(t => stW * t);

          return (
            <g key="stamp-block">
              {/* Фон */}
              <rect x={sx2} y={sy2} width={stW} height={stH} fill="white" stroke="#333" strokeWidth={Math.max(0.5, sw2 * 1.5)} />
              {/* Горизонтальные линии */}
              {[1,2,3,4,5,6].map(i => <line key={i} x1={sx2} y1={sy2+rowH*i} x2={sx2+stW} y2={sy2+rowH*i} stroke="#333" strokeWidth={sw2} />)}
              {/* Вертикальные линии верхней части (5 строк) */}
              {col.slice(1).map((x, i) => <line key={i} x1={sx2+x} y1={sy2} x2={sx2+x} y2={sy2+rowH*5} stroke="#333" strokeWidth={sw2} />)}
              {/* Вертикальные линии нижней части */}
              <line x1={sx2+stW*0.4} y1={sy2+rowH*5} x2={sx2+stW*0.4} y2={sy2+stH} stroke="#333" strokeWidth={sw2} />
              <line x1={sx2+stW*0.7} y1={sy2+rowH*5} x2={sx2+stW*0.7} y2={sy2+stH} stroke="#333" strokeWidth={sw2} />

              {/* Лейблы колонок */}
              {["Изм.", "Кол.", "Лист", "№ dok.", "Подп.", "Дата"].map((t, i) => {
                const xs = [0, 0.25, 0.5, 0.67, 0.83, 1.0];
                const midX = i < 5 ? (xs[i] + xs[i+1]) / 2 : xs[5] - 0.085;
                return <text key={i} x={sx2+stW*midX} y={sy2+rowH*5.7} textAnchor="middle" fontSize={stFontSize*0.75} fontFamily="Arial, sans-serif" fill="#333">{t}</text>;
              })}

              {/* Разработал */}
              {pl.developer && <text x={sx2+3} y={sy2+rowH*3.6} fontSize={stFontSize*0.85} fontFamily="Arial, sans-serif" fill="#333">Разработал: {pl.developer}</text>}
              {/* НАЧ. УПВ / подпись */}
              {pl.checker && <text x={sx2+3} y={sy2+rowH*4.6} fontSize={stFontSize*0.85} fontFamily="Arial, sans-serif" fill="#333">Нач. УПВ: {pl.checker}</text>}

              {/* Название проекта */}
              <text x={sx2+stW*0.55} y={sy2+rowH*5.8} textAnchor="middle"
                fontSize={stFontSize} fontFamily="Arial, sans-serif" fill="#111"
                style={{ cursor: canDrag ? "text" : "default" }}
                onDoubleClick={canDrag ? () => {
                  const v = prompt("Название проекта:", pl.projectName ?? "");
                  if (v !== null) onPrintLayerChange?.(h.id, { projectName: v });
                } : undefined}>
                {pl.projectName || (canDrag ? "Название проекта" : "")}
              </text>

              {/* Режим проветривания */}
              <text x={sx2+stW*0.55} y={sy2+rowH*6.5} textAnchor="middle"
                fontSize={stFontSize*0.85} fontFamily="Arial, sans-serif" fill="#555"
                style={{ cursor: canDrag ? "text" : "default" }}
                onDoubleClick={canDrag ? () => {
                  const v = prompt("Режим проветривания:", pl.modeName ?? "");
                  if (v !== null) onPrintLayerChange?.(h.id, { modeName: v });
                } : undefined}>
                {pl.modeName || (canDrag ? "Режим проветривания" : "")}
              </text>

              {/* Организация */}
              <text x={sx2+stW*0.855} y={sy2+rowH*6.5} textAnchor="middle" fontSize={stFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
                {pl.orgName || "Организация"}
              </text>

              {/* Масштаб */}
              <text x={sx2+stW*0.855} y={sy2+rowH*5.5} textAnchor="middle" fontSize={stFontSize*0.8} fontFamily="Arial, sans-serif" fill="#555">масштаб</text>
              <text x={sx2+stW*0.855} y={sy2+rowH*6.2} textAnchor="middle" fontSize={stFontSize} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">{pl.scale || "1:2000"}</text>

              {/* Ручка перемещения */}
              {canDrag && (
                <rect x={sx2} y={sy2} width={stW} height={stH*0.4} fill="transparent" style={{ cursor: "move" }}
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

  // ─── Автопереключение SVG ↔ Canvas ────────────────────────────────────────
  const useCanvas = visibleBranches.length > CANVAS_THRESHOLD;
  if (!useCanvas) canvasExportRef.current = null;

  const cursorStyle = rotStart ? "grabbing" : panStart ? "grabbing"
    : draggingPrintTitle ? "grabbing"
    : draggingNode ? "grabbing"
    : rescuePickMode ? "cell"
    : branchBindMode ? "pointer"
    : pendingSymbolTypeId ? "copy"
    : tool === "node" ? "crosshair"
    : tool === "symbol" ? "copy"
    : tool === "rotate" ? "grab"
    : tool === "pan" ? "grab" : "default";

  // Canvas-обёртки: перенаправляем события HTMLCanvasElement → обработчикам SVG
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asS = <T,>(e: T) => e as unknown as any;
  const onMouseDownCanvas   = (e: React.MouseEvent<HTMLCanvasElement>)  => onMouseDown(asS(e));
  const onMouseMoveCanvas   = (e: React.MouseEvent<HTMLCanvasElement>)  => onMouseMove(asS(e));
  const onMouseUpCanvas     = (e: React.MouseEvent<HTMLCanvasElement>)  => onMouseUp(asS(e));
  const onWheelCanvas       = (e: React.WheelEvent<HTMLCanvasElement>)  => onWheel(asS(e));
  const onContextMenuCanvas = (e: React.MouseEvent<HTMLCanvasElement>)  => onContextMenuSVG(asS(e));
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
      style={{
        background: is3D ? "linear-gradient(to bottom, #f0f4f8 0%, #ffffff 60%, #f5f5f5 100%)" : "#ffffff",
        cursor: cursorStyle,
      }}>

      {/* ── Canvas-рендерер (большие схемы > CANVAS_THRESHOLD ветвей) ── */}
      {useCanvas && (
        <CanvasLayer
          width={size.w}
          height={size.h}
          nodes={nodes}
          branches={branches}
          horizons={horizons ?? []}
          horizonMap={horizonMap}
          visibleBranches={visibleBranches}
          hiddenBranchIds={hiddenBranchIds}
          projNodes={projNodes}
          projNodesMap={projNodesMap}
          proj={proj}
          view={view}
          is3D={is3D}
          zScale={zScale}
          zLevel={zLevel}
          selectedBranchId={selectedBranchId}
          selectedBranchIds={selectedBranchIds ?? new Set()}
          selectedNodeId={selectedNodeId}
          selectedNodeIds={selectedNodeIds ?? new Set()}
          hoverBranchId={hoverBranchId}
          branchWidth={branchWidth}
          branchBorder={branchBorder}
          thinLines={thinLines}
          fixedObjectScale={fixedObjectScale}
          colorByHorizon={colorByHorizon}
          showFlowArrows={showFlowArrows}
          flowDisplay={flowDisplay}
          infoConfig={infoConfig}
          unitsConfig={unitsConfig}
          waterNodeResults={waterNodeResults}
          branchFireColors={branchFireColors}
          branchExplosionColors={branchExplosionColors}
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
        />
      )}

      {/* ── SVG-рендерер (малые и средние схемы ≤ CANVAS_THRESHOLD ветвей) ── */}
      <svg ref={svgCallbackRef} width={size.w} height={size.h}
        style={{ touchAction: "none", userSelect: "none", visibility: (useCanvas && !editingPrintLayerId) ? "hidden" : undefined, pointerEvents: (useCanvas && !editingPrintLayerId) ? "none" : undefined, position: useCanvas ? "absolute" : undefined, zIndex: useCanvas ? (editingPrintLayerId ? 1 : -1) : undefined, cursor: positionPlaceMode ? "crosshair" : branchBindMode ? "cell" : undefined }}
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

        {/* ── ШАБЛОНЫ ПЕЧАТИ ГОРИЗОНТОВ ──────────────────────────────────── */}
        {renderPrintLayers()}

        {/* ── ПОДЛОЖКИ ГОРИЗОНТОВ (PNG/JPG) ─────────────────────────────── */}
        {/* Рисуются ПОД ветвями. Видимость подложки = h.image.visible && h.visible */}
        {!useCanvas && (horizons ?? []).map((h) => {
          if (!h.visible || !h.image || !h.image.visible) return null;
          const b = h.image.bounds;
          // Для проекции углы лежат на плоскости z = h.z
          const p1 = project3D({ x: b.x1, y: b.y1, z: h.z }, proj); // нижний-левый (мировой)
          const p2 = project3D({ x: b.x2, y: b.y1, z: h.z }, proj);
          const p3 = project3D({ x: b.x2, y: b.y2, z: h.z }, proj);
          const p4 = project3D({ x: b.x1, y: b.y2, z: h.z }, proj);
          // В 2D-плане можем использовать прямой <image> с поворотом 0; в 3D — clip-path/transform.
          // Универсально рисуем через <image> + transform на четыре точки невозможно в SVG напрямую
          // (нет 4-точечной перспективы). Поэтому: в 2D — <image> по габаритам;
          // в 3D — упрощение: <image> по AABB углов p1..p4 (визуально приемлемо для плоских видов).
          const minSx = Math.min(p1.sx, p2.sx, p3.sx, p4.sx);
          const maxSx = Math.max(p1.sx, p2.sx, p3.sx, p4.sx);
          const minSy = Math.min(p1.sy, p2.sy, p3.sy, p4.sy);
          const maxSy = Math.max(p1.sy, p2.sy, p3.sy, p4.sy);
          // В чистом плане (azimuth=0, elevation=90) AABB совпадает с реальным прямоугольником.
          return (
            <g key={`hi-${h.id}`} style={{ pointerEvents: "none" }}>
              <image
                href={h.image.dataUrl}
                x={minSx} y={minSy}
                width={Math.max(0, maxSx - minSx)}
                height={Math.max(0, maxSy - minSy)}
                opacity={h.image.opacity}
                preserveAspectRatio="none" />
              {/* Тонкая обводка горизонтового цвета — чтобы видно было границы подложки */}
              <rect x={minSx} y={minSy}
                width={Math.max(0, maxSx - minSx)}
                height={Math.max(0, maxSy - minSy)}
                fill="none" stroke={h.color} strokeOpacity="0.5"
                strokeWidth="1" strokeDasharray="6 4" />
            </g>
          );
        })}

        {/* ── РУЧКИ ДЛЯ РАСТЯГИВАНИЯ ПОДЛОЖКИ (только для активного горизонта) ── */}
        {!useCanvas && editingHorizonImageId && (() => {
          const h = (horizons ?? []).find((hh) => hh.id === editingHorizonImageId);
          if (!h || !h.image || !h.image.visible || !h.visible) return null;
          const b = h.image.bounds;
          const corners: Array<{ key: "tl" | "tr" | "bl" | "br"; x: number; y: number; cur: string }> = [
            { key: "tl", x: b.x1, y: b.y2, cur: "nwse-resize" },
            { key: "tr", x: b.x2, y: b.y2, cur: "nesw-resize" },
            { key: "bl", x: b.x1, y: b.y1, cur: "nesw-resize" },
            { key: "br", x: b.x2, y: b.y1, cur: "nwse-resize" },
          ];
          return (
            <g>
              {corners.map((c) => {
                const p = project3D({ x: c.x, y: c.y, z: h.z }, proj);
                return (
                  <g key={c.key} style={{ cursor: c.cur }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingCorner({ horizonId: h.id, corner: c.key });
                    }}>
                    <circle cx={p.sx} cy={p.sy} r="9" fill="white" stroke={h.color} strokeWidth="2" />
                    <circle cx={p.sx} cy={p.sy} r="3" fill={h.color} />
                  </g>
                );
              })}
            </g>
          );
        })()}

        {/* ─── ВЕТВИ (отсортированы по глубине) ────────────────────────── */}
        {/* Пороги LOD: при отдалении отключаем дорогостоящие элементы */}
        {!useCanvas && (() => {
          const lodChevrons  = view.scale >= 0.25;
          const lodArrows    = view.scale >= 0.15;
          const lodLabels    = view.scale >= 0.04;
          const lodBorder    = view.scale >= 0.10;
          // Коэффициент масштабирования объектов: 1 = фиксированный, view.scale/0.4 = пропорциональный
          const objSF = fixedObjectScale ? 1 : view.scale / 0.4;
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
            const w = (thinLines ? 1 : baseW) * objSF;
            const borderW = (thinLines || !lodBorder) ? 0 : Math.max(0, bb) * objSF;
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
          const flowQColor = (q: number): string => {
            const t = Math.min(1, Math.max(0, (q - flowColorMin) / Math.max(0.001, flowColorMax - flowColorMin)));
            // Целевые RGB для максимума шкалы
            const targets: Record<string, [number, number, number]> = {
              red:   [220, 38, 38],   // #dc2626
              blue:  [37, 99, 235],   // #2563eb
              green: [22, 163, 74],   // #16a34a
            };
            const [tr, tg, tb] = targets[flowColorHue] ?? targets.red;
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
            : isLeakage ? "#f97316"
            : overV ? "#dc2626"
            : (colorByHorizon && horizonColor) ? horizonColor
            : colorMode === "flowQ" ? flowQColor(Math.abs(Q))
            : posInnerColors ? (posInnerColEarly ?? "#ffffff")
            : colorMode === "none" ? "#ffffff"
            : Q > 0 ? velocityColor(V)
            : "#ffffff";

          // ─── ТОЛЩИНА ЛИНИИ ───────────────────────────────────────
          const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
          const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
          const baseW = isSel ? bw + 1 : bw;
          const w = (thinLines ? 1 : baseW) * objSF;
          // Обводка (контур вокруг линии): ширина = w + 2*border
          const borderW = (thinLines || !lodBorder) ? 0 : Math.max(0, bb) * objSF;
          const flowVisible = !thinLines && lodChevrons && Q > 0.1 && flowDisplay !== "off";
          const showDashes = flowVisible && (flowDisplay === "flow" || flowDisplay === "both");
          const showChevrons = flowVisible && (flowDisplay === "chevrons" || flowDisplay === "both");

          // Длительность анимации (с): ~ обратно пропорц. скорости.
          // V=15 м/с → 0.6 с, V=1 м/с → 4 с, нижняя граница 0.4 с
          const animDur = Math.max(0.4, Math.min(5, 4 / Math.max(0.5, V)));

          // Длина отрезка в px и единичный вектор направления
          const dx = sxB - sxA;
          const dy = syB - syA;
          const segLen = Math.hypot(dx, dy);
          const ux = segLen > 0 ? dx / segLen : 0;
          const uy = segLen > 0 ? dy / segLen : 0;

          // ── Подсветка в F3-режиме привязки ────────────────────────────────
          const posBindInfo = branchPositionColors?.get(b.id);
          // ── Подсветка задымления от пожара ────────────────────────────────
          const fireSeg = branchFireColors?.get(b.id);
          // ── Подсветка зон взрыва ───────────────────────────────────────────
          const expSeg = branchExplosionColors?.get(b.id);

          return (
            <g key={b.id}>
              {/* Подсветка задымления (пожар) — сегмент от fromT до toT по направлению потока */}
              {fireSeg && (() => {
                const { color: fireCol, fromT, toT } = fireSeg;
                // sxA/syA — начало по направлению потока (с учётом reversed)
                const fsx = sxA + (sxB - sxA) * fromT;
                const fsy = syA + (syB - syA) * fromT;
                const tsx = sxA + (sxB - sxA) * toT;
                const tsy = syA + (syB - syA) * toT;
                return (
                  <line x1={fsx} y1={fsy} x2={tsx} y2={tsy}
                    stroke={fireCol} strokeWidth={Math.max(w + 14, 8)} strokeLinecap="round" opacity="0.7" />
                );
              })()}
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

              {/* Бегущий пунктир в направлении потока (как в Вентиляция 2.0) */}
              {showDashes && (
                <line x1={sxA} y1={syA} x2={sxB} y2={syB}
                  stroke={color} strokeWidth={w} strokeLinecap="butt"
                  strokeDasharray="10 8" opacity="0.95">
                  {/* dashoffset уменьшается → штрихи бегут от A к B */}
                  <animate attributeName="stroke-dashoffset"
                    from="18" to="0" dur={`${animDur}s`} repeatCount="indefinite" />
                </line>
              )}

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

              {/* ── Трубопровод ППЗ — яркая синяя линия со смещением к краю ветви ── */}
              {b.hasWaterPipe && (() => {
                // Перпендикуляр к ветви — смещаем линию к краю на (w/2 - 1.5)px
                const nx = -uy; // нормаль
                const ny = ux;
                const offset = w * 0.38; // смещение от центра к краю
                const x1o = from.sx + nx * offset;
                const y1o = from.sy + ny * offset;
                const x2o = to.sx + nx * offset;
                const y2o = to.sy + ny * offset;
                return (
                  <line x1={x1o} y1={y1o} x2={x2o} y2={y2o}
                    stroke="#1d4ed8" strokeWidth="1.5"
                    strokeLinecap="round" opacity="1" />
                );
              })()}

              {/* ── Стрелки направления свежей струи (F9, после расчёта) ── */}
              {/* Полноценные стрелки с хвостиком (─►), как в АэроСеть */}
              {showFlowArrows && !thinLines && lodArrows && Q > 0.1 && segLen > 80 && (() => {
                const step = 130;
                const count = Math.max(1, Math.floor(segLen / step));
                const angle = Math.atan2(uy, ux) * 180 / Math.PI;
                const arrowLen = Math.min(28, Math.max(16, w * 4));
                return (
                  <g>
                    {Array.from({ length: count }, (_, i) => {
                      const t0 = (i + 1) / (count + 1);
                      const cx = sxA + dx * t0;
                      const cy = syA + dy * t0;
                      const hw = arrowLen / 2;
                      return (
                        <g key={`fa${i}`} transform={`translate(${cx},${cy}) rotate(${angle})`}>
                          {/* Хвостик — тонкая линия */}
                          <line x1={-hw} y1={0} x2={hw - 5} y2={0}
                            stroke="#dc2626" strokeWidth="1"
                            strokeLinecap="round" />
                          {/* Наконечник — компактный треугольник */}
                          <polygon points={`${hw - 7},-4 ${hw},0 ${hw - 7},4`}
                            fill="#dc2626" stroke="white" strokeWidth="0.6"
                            strokeLinejoin="round" />
                        </g>
                      );
                    })}
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
                  if (ic.branchResistance) dataLines.push(`R=${fmtR(b.resistance * 1000 / 9.81, uRes)}`);
                  if (ic.branchVelocity && hasCalc) dataLines.push(`V=${uVel.fromBase(b.velocity).toFixed(uVel.decimals)}${uVel.symbol}${overV ? "⚠" : ""}`);
                  if ((ic.branchFlow || ic.branchFlowCalc) && hasCalc) dataLines.push(`Q=${Qsign}${uFlow.fromBase(Q).toFixed(uFlow.decimals)}${uFlow.symbol}`);
                  if (ic.branchDepression && hasCalc) dataLines.push(`Н=${uPres.fromBase(b.dP).toFixed(uPres.decimals)}${uPres.symbol}`);
                } else if (hasCalc) {
                  dataLines.push(`Q=${Qsign}${Q.toFixed(1)}`);
                  if (b.velocity > 0) dataLines.push(`V=${b.velocity.toFixed(1)}`);
                }

                // Все строки: номер (если нужен) + данные
                const allLines = showNum ? [branchNum, ...dataLines] : dataLines;
                if (allLines.length === 0) return null;

                // Масштаб текста пропорционален ширине ветви, с лимитом [0.3..2.5]
                const branchPxLabel = (thinLines ? 1 : (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth)) * objSF;
                const textSc = Math.min(2.5, Math.max(0.3, branchPxLabel * 0.28)) * (b.labelSize ?? 1);
                const lh = 11 * textSc;
                const bh = allLines.length * lh + 4 * textSc;
                const lox = b.labelOffsetX ?? 0;
                const loy = b.labelOffsetY ?? -16;
                const labelAng = b.labelAngle ?? 0;
                const anchorX = midX + lox;
                const anchorY = midY + loy;
                const hasMoved = Math.abs(lox) > 5 || Math.abs(loy + 16) > 5;

                return (
                  <g opacity={labelOpacity}>
                    {/* Выноска если метка сдвинута */}
                    {hasMoved && (
                      <line x1={midX} y1={midY} x2={anchorX} y2={anchorY}
                        stroke="#94a3b8" strokeWidth={0.8 * objSF} strokeDasharray="3 2"
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
                          onBranchLabelOffset(b.id, origOx + me.clientX - startX, origOy + me.clientY - startY);
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




            </g>
          );
        });
          return <>{posOuterPass}{borderPass}{fillPass}</>;
        })()}

        {/* Превью создания ветви */}
        {tool === "branch" && branchFrom && hoverPos && (() => {
          const from = projNodesMap.get(branchFrom);
          if (!from) return null;
          // Z для превью берём из активной плоскости (если фикс по Z) или у узла-начала
          const fromNode = from.node;
          const previewZ = effPlane.axis === "z" ? effPlane.value : fromNode.z;
          const previewX = effPlane.axis === "x" ? effPlane.value : hoverPos.x;
          const previewY = effPlane.axis === "y" ? effPlane.value : hoverPos.y;
          const to = project3D({ x: previewX, y: previewY, z: previewZ }, proj);
          return (
            <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
              stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.7" />
          );
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

        {/* ─── УСЛОВНЫЕ ОБОЗНАЧЕНИЯ НА СХЕМЕ ──────────────────────────── */}
        {!useCanvas && schemaSymbols.map(sym => {
          const isBulkheadEarly = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
          const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
          // Перемычки рисуются геометрически — не требуют lt из LEGEND_TYPES
          if (!lt && !isBulkheadEarly) return null;
          // Если УО привязано к ветви скрытого горизонта — скрываем его вместе с ветвью
          if (sym.branchId && hiddenBranchIds.has(sym.branchId)) return null;

          let basePx: number, basePy: number;
          let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;

          if (sym.branchId) {
            const br = branches.find(b => b.id === sym.branchId);
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
          const symSF = fixedObjectScale ? 1 : view.scale / 0.4;
          const SZ = Math.max(4, 32 * sc * symSF);
          // Минимальный размер hitbox: 28px, чтобы в мелком масштабе всегда можно было кликнуть
          const HIT_MIN = 28;
          const HX = px - SZ / 2;
          const HY = py - SZ / 2 - 4;

          // Вентилятор остановлен — серый фильтр на символ
          const brForSym = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
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
                const isBulkhead = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
                if (isBulkhead && sym.branchId && hasBranchPts) {
                  // ── Перемычка на ветви: рисуем напрямую примитивами ──
                  // Координатная система после rotate: X вдоль ветви, Y поперёк
                  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                  const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
                  const tid = sym.typeId;
                  const brForDestroy = branches.find(b => b.id === sym.branchId);
                  const isDestroyedBk = brForDestroy?.bulkheadDestroyedByExplosion ?? false;

                  // Цвет заливки и обводки по материалу (красный если разрушена)
                  const fill  = isDestroyedBk ? "#ff4444"
                    : tid.includes("concrete") ? "#4caf50"
                    : tid.includes("wood")     ? "#ffd600"
                    : tid.includes("brick")    ? "#ff9800"
                    : tid.includes("metal")    ? "#9c27b0"
                    : (tid === "fire_door" || tid === "fire_door_pp") ? "#c00"
                    : (tid === "barrier")      ? "#555"
                    : "white";
                  const stroke = isDestroyedBk ? "#8b0000"
                    : tid.includes("concrete") ? "#1b5e20"
                    : tid.includes("wood")     ? "#e65100"
                    : tid.includes("brick")    ? "#bf360c"
                    : tid.includes("metal")    ? "#4a148c"
                    : (tid === "fire_door" || tid === "fire_door_pp") ? "#800"
                    : "#1a1a1a";  // всегда чёрный контур

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
                  const sw2       = Math.max(0.4, pw * 0.18);  // толщина обводки

                  return (
                    <g transform={`translate(${px},${py}) rotate(${brAngle})`}>
                      {isSail ? (
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
                        // ── Глухая / с окном / решётка / водоподпорная ──
                        <>
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
                  const brObj = branches.find(b => b.id === sym.branchId);
                  const bw = (brObj?.lineWidth && brObj.lineWidth > 0) ? brObj.lineWidth : branchWidth;
                  // смещение трубы от оси — ровно как в canvasRenderer: bw * 0.38
                  const pipeOff = bw * 0.38;
                  // центр клапана лежит на линии трубы
                  const cpx = px + nx * pipeOff;
                  const cpy = py + ny * pipeOff;
                  // размер клапана: пропорционален ширине ветви × масштаб вида
                  const valveSZ = Math.max(4, bw * view.scale * 4);
                  const HS = valveSZ * 0.55;
                  const HT = valveSZ * 0.45;
                  const lw = Math.max(0.5, bw * view.scale * 0.35);
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
                // Остальные символы — через SVG viewBox без поворота
                if (!lt) return null;
                return (
                  <svg x={HX} y={HY} width={SZ} height={SZ} viewBox="0 0 48 40"
                    overflow="visible"
                    opacity={isFanStopped ? 0.35 : 1}
                    style={isFanStopped ? { filter: "grayscale(1)" } : undefined}
                    pointerEvents="none"
                    dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
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
              {/* ⚡ Маркер разрушенной перемычки (взрыв) */}
              {BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts && (() => {
                const br = branches.find(b => b.id === sym.branchId);
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
              {/* Маленькая чёрная стрелка направления воздуха — выходит из
                  границы окружности вентилятора. Можно отключить в свойствах. */}
              {!isFanStopped && sym.typeId === "fan" && sym.branchId && hasBranchPts
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
                // Хвост — на границе круга, остриё — снаружи.
                const x0 = rIcon;
                const x1 = rIcon + aLen;
                return (
                  <g transform={`translate(${iconCx},${iconCy}) rotate(${arrowAngle})`}>
                    <line x1={x0} y1={0} x2={x1 - head * 0.5} y2={0}
                      stroke="#111" strokeWidth={stroke} strokeLinecap="round" />
                    <polygon
                      points={`${x1 - head},${-head * 0.55} ${x1},0 ${x1 - head},${head * 0.55}`}
                      fill="#111" />
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
                const hW = Math.max(SZ + 20, HIT_MIN);
                const hH = Math.max(SZ + 20, HIT_MIN);
                return <rect x={px - hW / 2} y={py - hH / 2} width={hW} height={hH}
                  fill="transparent" stroke="none" />;
              })()}

              {/* ── Индикаторы перемычки на схеме ────────────────────── */}
              {view.scale > 0.05 && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId && (() => {
                const br = branches.find(b => b.id === sym.branchId);
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
                    // ΔP/Q² = Па/(м³/с)² = Мюрг (базовая единица)
                    rBase = sq > 0 ? dp / (sq * sq) : 0;
                  } else {
                    // project: используем bkAirPerm или bkBulkheadR
                    const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0) : (sym.bkAirPerm ?? 0);
                    if (kAir > 0) {
                      // 1/A² = Мюрг (базовая единица resistance)
                      rBase = 1 / (kAir * kAir);
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

                // indFontSize задан в мировых единицах (метрах), независимо от масштаба УО
                const baseFontPx = sym.indFontSize ? sym.indFontSize * sc : 9 * sc;
                const fSize = Math.max(6, Math.round(baseFontPx));
                const lineH = fSize + 3;
                const boxW = Math.max(...lines.map(l => l.length)) * fSize * 0.52 + 10;
                const boxH = lines.length * lineH + 6;

                // Базовая позиция — поперёк ветви, плюс пользовательское смещение
                const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                const brLen = Math.hypot(brDx, brDy);
                const perpX = brLen > 0 ? -brDy / brLen : 0;
                const perpY = brLen > 0 ?  brDx / brLen : 0;
                const baseOffX = perpX * (16 + boxW / 2);
                const baseOffY = perpY * (16 + boxH / 2);
                const bx = px + baseOffX + (sym.indOffsetX ?? 0);
                const by = py + baseOffY + (sym.indOffsetY ?? 0);
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
                        const onMove = (me: MouseEvent) => {
                          onSymbolIndOffset?.(sym.id, origOx + me.clientX - startX, origOy + me.clientY - startY);
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
        })}

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
          const nodeSF = fixedObjectScale ? 1 : view.scale / 0.4;
          // Средняя ширина прилегающих ветвей для синхронного масштабирования узла
          const adjBr = branches.filter(b => b.fromId === node.id || b.toId === node.id);
          const adjAvgW = adjBr.length > 0
            ? adjBr.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBr.length
            : branchWidth;
          const branchPx = (thinLines ? 1 : adjAvgW) * nodeSF;
          const baseNodeR = Math.min(10, Math.max(1.5, branchPx * 0.55));
          const r = isSel ? baseNodeR * 1.5 : baseNodeR;
          const color = node.atmosphereLink ? "#7dd3fc" : "#c8a882";
          const ringColor = isMultiSel ? "#f59e0b" : "#2563eb";
          const fireType = node.fireNodeType ?? "none";
          const hasFire = fireType !== "none";
          const IS = Math.min(24, Math.max(3, baseNodeR * 2.5));
          return (
            <g key={node.id} transform={`translate(${sx},${sy})`}>
              {/* Кольцо маршрута горноспасателей */}
              {isRescuePath && (
                <circle r={r + baseNodeR * 0.8} fill="#16a34a" stroke="#15803d" strokeWidth={1.5 * nodeSF} opacity="0.85" />
              )}
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

              {/* ── Иконка ПОЖАРНОГО КРАНА ──
                   Закрыт → красный контур, открыт → синяя заливка */}
              {fireType === "consumer" && view.scale > 0.025 && (() => {
                const hydrantOpen = node.fireHydrantOpen ?? false;
                const hydrantColor = hydrantOpen ? "#1d4ed8" : "#dc2626";
                const fillColor = hydrantOpen ? "#bfdbfe" : "white";
                const cr = IS * 0.55;
                const lw = Math.max(1.2, IS * 0.10);
                const earR = cr * 0.55;
                return (
                  <g>
                    {/* Левое ухо */}
                    <circle cx={-cr * 1.1} cy={0} r={earR}
                      fill={fillColor} stroke={hydrantColor} strokeWidth={lw} />
                    {/* Правое ухо */}
                    <circle cx={cr * 1.1} cy={0} r={earR}
                      fill={fillColor} stroke={hydrantColor} strokeWidth={lw} />
                    {/* Основной кружок поверх ушек */}
                    <circle cx={0} cy={0} r={cr}
                      fill={fillColor} stroke={hydrantColor} strokeWidth={lw} />
                    {/* Кольцо выделения */}
                    {isSel && <circle r={cr + earR + 3} fill="none"
                      stroke={ringColor} strokeWidth="1.5" strokeDasharray="3 2" />}
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
                const jr = Math.min(7, Math.max(4, 5 + (view.scale - 0.4) * 4));
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
        {!useCanvas && (() => {
          // Подбираем «красивое» значение шага линейки
          const targetPx = 120;  // целевая длина линейки в пикселях
          const rawM = targetPx / view.scale;  // метры при текущем масштабе
          const exp = Math.pow(10, Math.floor(Math.log10(rawM)));
          const nice = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
          const stepM = nice.find(n => n * view.scale >= 60) ?? nice[nice.length - 1];
          const barPx = stepM * view.scale;
          const bx = 16, by = size.h - 36;
          const segments = 5;
          const segPx = barPx / segments;
          void exp;
          return (
            <g style={{ pointerEvents: "none" }}>
              {/* Белая подложка */}
              <rect x={bx - 4} y={by - 18} width={barPx + 8} height={36}
                fill="white" fillOpacity="0.88" rx="3"
                stroke="#c0c0c0" strokeWidth="0.5" />
              {/* Полосы чёрно-белые как в Аэросети */}
              {Array.from({ length: segments }).map((_, i) => (
                <rect key={i}
                  x={bx + i * segPx} y={by - 8}
                  width={segPx} height={10}
                  fill={i % 2 === 0 ? "#1a1a1a" : "#ffffff"}
                  stroke="#1a1a1a" strokeWidth="0.8" />
              ))}
              {/* Левая граница */}
              <line x1={bx} y1={by - 8} x2={bx} y2={by - 14} stroke="#1a1a1a" strokeWidth="1.5" />
              {/* Правая граница */}
              <line x1={bx + barPx} y1={by - 8} x2={bx + barPx} y2={by - 14} stroke="#1a1a1a" strokeWidth="1.5" />
              {/* Деления по середине */}
              {Array.from({ length: segments - 1 }).map((_, i) => (
                <line key={i}
                  x1={bx + (i + 1) * segPx} y1={by - 8}
                  x2={bx + (i + 1) * segPx} y2={by - 12}
                  stroke="#1a1a1a" strokeWidth="1" />
              ))}
              {/* Метки */}
              <text x={bx} y={by + 12} fontSize="10" fontFamily="Arial, sans-serif"
                fill="#111" textAnchor="middle" fontWeight="600">0</text>
              <text x={bx + barPx / 2} y={by + 12} fontSize="10" fontFamily="Arial, sans-serif"
                fill="#111" textAnchor="middle">
                {stepM / 2 >= 1000 ? `${stepM / 2000}тыс` : `${stepM / 2}`}
              </text>
              <text x={bx + barPx} y={by + 12} fontSize="10" fontFamily="Arial, sans-serif"
                fill="#111" textAnchor="middle" fontWeight="600">
                {stepM >= 1000 ? `${stepM / 1000} км` : `${stepM} м`}
              </text>
            </g>
          );
        })()}

        {/* ─── МАРКЕР PIVOT-ТОЧКИ (виден только во время вращения) ─── */}
        {!useCanvas && rotStart && (() => {
          // Перепроецируем pivot в текущей проекции (углы уже обновлены).
          const ps = project3D(rotStart.pivot, proj);
          return (
            <g style={{ pointerEvents: "none" }}>
              {/* Внешний полупрозрачный круг */}
              <circle cx={ps.sx} cy={ps.sy} r="14"
                fill="none" stroke="#f59e0b" strokeWidth="1.2"
                strokeDasharray="3 2" opacity="0.6" />
              {/* Крестик */}
              <line x1={ps.sx - 8} y1={ps.sy} x2={ps.sx + 8} y2={ps.sy}
                stroke="#f59e0b" strokeWidth="1.5" />
              <line x1={ps.sx} y1={ps.sy - 8} x2={ps.sx} y2={ps.sy + 8}
                stroke="#f59e0b" strokeWidth="1.5" />
              {/* Центральная точка */}
              <circle cx={ps.sx} cy={ps.sy} r="2.5"
                fill="#f59e0b" stroke="#7c2d12" strokeWidth="0.8" />
              {/* Подпись */}
              <text x={ps.sx + 18} y={ps.sy + 4} fontSize="10"
                fontFamily="Arial, sans-serif" fill="#7c2d12" fontWeight="600">
                центр вращения
              </text>
            </g>
          );
        })()}
      </svg>

      {/* ── Оверлей УО поверх canvas (видим всегда, интерактивен) ───────── */}
      {useCanvas && (
        <svg
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "auto", touchAction: "none", userSelect: "none", cursor: cursorStyle }}
          width={size.w} height={size.h}
          onMouseDown={(e) => { if ((e.target as SVGElement).closest("g[data-sym]")) return; onMouseDownCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>); }}
          onMouseMove={(e) => onMouseMoveCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
          onMouseUp={(e) => onMouseUpCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
          onContextMenu={(e) => onContextMenuCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
          onWheel={(e) => onWheelCanvas(e as unknown as React.WheelEvent<HTMLCanvasElement>)}>
          {schemaSymbols.map(sym => {
            const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
            if (!lt) return null;
            if (sym.branchId && hiddenBranchIds.has(sym.branchId)) return null;

            let basePx: number, basePy: number;
            let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;
            if (sym.branchId) {
              const br = branches.find(b => b.id === sym.branchId);
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

            const px = basePx + (sym.offsetX ?? 0);
            const py = basePy + (sym.offsetY ?? 0);
            const isSel = selectedSymbolId === sym.id || (selectedSymbolIds?.has(sym.id) ?? false);
            const sc = sym.scale ?? 1;
            let symScaleV: number;
            if (view.scale < 0.4) { symScaleV = view.scale / 0.4; }
            else { const k = (view.scale - 0.4) / 0.4; symScaleV = 1 + 2 * (k / (k + 2)); }
            const SZ = Math.max(4, 32 * sc * symScaleV);
            const HX = px - SZ / 2;
            const HY = py - SZ / 2 - 4;

            // Для valve_reduce — вычисляем реальный центр на линии трубы
            let vcpx = px, vcpy = py, vSZ = SZ;
            if (sym.typeId === "valve_reduce" && hasBranchPts) {
              const vDx = tsx2 - fsx, vDy = tsy2 - fsy;
              const vLen = Math.hypot(vDx, vDy);
              const vnx = vLen > 0 ? -vDy / vLen : 0, vny = vLen > 0 ? vDx / vLen : 0;
              const vbObj = branches.find(b => b.id === sym.branchId);
              const vbw = (vbObj?.lineWidth && vbObj.lineWidth > 0) ? vbObj.lineWidth : branchWidth;
              vcpx = px + vnx * vbw * 0.38;
              vcpy = py + vny * vbw * 0.38;
              vSZ = Math.max(4, vbw * view.scale * 4) * 1.2;
            }

            return (
              <g key={sym.id} data-sym={sym.id}
                style={{ cursor: tool === "select" ? "move" : undefined }}
                onClick={(e) => { if (tool !== "select") return; e.stopPropagation(); onSelectSymbol?.(isSel ? null : sym.id); onSymbolClick?.(sym.id); }}
                onMouseDown={(e) => {
                  if (e.button !== 0 || tool !== "select") return;
                  e.stopPropagation(); e.preventDefault();
                  onSelectSymbol?.(sym.id);
                  const startX = e.clientX, startY = e.clientY;
                  if (sym.branchId && hasBranchPts) {
                    const snapFsx = fsx, snapFsy = fsy, snapTsx = tsx2, snapTsy = tsy2;
                    const brLen2 = (snapTsx - snapFsx) ** 2 + (snapTsy - snapFsy) ** 2;
                    const origOx = sym.offsetX ?? 0, origOy = sym.offsetY ?? 0;
                    const svgEl = (e.currentTarget as SVGElement).closest("svg")!;
                    const onMove = (me: MouseEvent) => {
                      me.preventDefault();
                      const dx = me.clientX - startX, dy = me.clientY - startY;
                      if (me.ctrlKey || me.altKey) {
                        onSymbolOffset?.(sym.id, origOx + dx, origOy + dy);
                      } else {
                        if (brLen2 < 1) return;
                        const r = svgEl.getBoundingClientRect();
                        const mx = me.clientX - r.left, my = me.clientY - r.top;
                        const raw = ((mx - snapFsx) * (snapTsx - snapFsx) + (my - snapFsy) * (snapTsy - snapFsy)) / brLen2;
                        onSymbolMoveAlongBranch?.(sym.id, Math.max(0.02, Math.min(0.98, raw)));
                      }
                    };
                    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  } else if (!sym.branchId) {
                    const origX = sym.x, origY = sym.y;
                    const onMove = (me: MouseEvent) => { me.preventDefault(); onSymbolMove?.(sym.id, origX + (me.clientX - startX) / view.scale, origY - (me.clientY - startY) / view.scale); };
                    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  }
                }}>
                {/* hitbox — для valve_reduce сдвинут к линии трубы */}
                <rect x={vcpx - vSZ / 2 - 4} y={vcpy - vSZ / 2 - 4} width={vSZ + 8} height={vSZ + 8} fill="transparent" stroke="none" />
                {isSel && <circle cx={vcpx} cy={vcpy} r={vSZ / 2 + 4} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" />}
                {/* valve_reduce: рисуем примитивами — квадрат вдоль ветви, треугольник поперёк */}
                {sym.typeId === "valve_reduce" && hasBranchPts ? (() => {
                  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                  const brLen = Math.hypot(brDx, brDy);
                  const ax = brLen > 0 ? brDx / brLen : 1, ay = brLen > 0 ? brDy / brLen : 0;
                  const nx = -ay, ny = ax; // нормаль как в canvasRenderer
                  const brObj = branches.find(b => b.id === sym.branchId);
                  const bw = (brObj?.lineWidth && brObj.lineWidth > 0) ? brObj.lineWidth : branchWidth;
                  const pipeOff = bw * 0.38;
                  const cpx = px + nx * pipeOff;
                  const cpy = py + ny * pipeOff;
                  const valveSZ = Math.max(4, bw * view.scale * 4);
                  const HS = valveSZ * 0.55, HT = valveSZ * 0.45;
                  const lw = Math.max(0.5, bw * view.scale * 0.35);
                  const q = (da: number, dn: number) => `${cpx + ax*da + nx*dn},${cpy + ay*da + ny*dn}`;
                  return (
                    <g pointerEvents="none">
                      <polygon points={`${q(-HS,-HT)} ${q(HS,-HT)} ${q(HS,HT)} ${q(-HS,HT)}`} fill="white" stroke="none" />
                      <polygon points={`${q(-HS,-HT)} ${q(HS,-HT)} ${q(HS,HT)} ${q(-HS,HT)}`} fill="white" stroke="#1d4ed8" strokeWidth={lw} />
                      <polygon points={`${q(-HS*0.65,-HT*0.55)} ${q(HS*0.65,-HT*0.55)} ${q(0,HT*0.6)}`} fill="#1d4ed8" />
                    </g>
                  );
                })() : (
                  <svg x={HX} y={HY} width={SZ} height={SZ} viewBox="0 0 48 40"
                    overflow="visible" pointerEvents="none"
                    dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
                )}
              </g>
            );
          })}
          {/* Шаблоны слоя печати — поверх УО */}
          {renderPrintLayers()}
        </svg>
      )}

      {/* Индикаторы */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444", marginLeft: "0px", paddingBottom: "0px" }}>
        {useCanvas && (
          <span className="mr-2 px-1 rounded" style={{ background: "#d1fae5", color: "#065f46" }}>
            Canvas · {visibleBranches.length} вет.
          </span>
        )}
        {is3D && <span className="mr-2">3D · Az: {view.azimuth.toFixed(0)}° · El: {view.elevation.toFixed(0)}°</span>}
        {hoverPos && (() => {
          // Вывод координат с учётом активной плоскости
          const fixZ = effPlane.axis === "z" ? effPlane.value : null;
          const fixY = effPlane.axis === "y" ? effPlane.value : null;
          const fixX = effPlane.axis === "x" ? effPlane.value : null;
          return (
            <span>
              X: {fixX ?? hoverPos.x} м · Y: {fixY ?? hoverPos.y} м · Z: {fixZ ?? (is3D ? "?" : zLevel)} м
            </span>
          );
        })()}
        <span className="ml-3 px-1.5 py-0.5 rounded"
          style={{ background: "#fef3c7", color: "#92400e" }}>
          Плоск: {effPlane.axis.toUpperCase()}={effPlane.value} м
        </span>
      </div>
      <div className="absolute bottom-1 right-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
        М 1:{(1 / Math.max(0.00001, view.scale * 0.001)).toFixed(0)}
      </div>

      {/* Подсказка — режим ожидания привязки */}
      {pendingSymbolTypeId && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#059669", color: "white" }}>
          Кликните на ветвь чтобы разместить УО · Esc — отмена
        </div>
      )}

      {/* Подсказка */}
      {tool === "node" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white" }}>
          ✚ Клик на холсте — создать узел на плоскости{" "}
          {effPlane.axis === "z" ? `Z = ${effPlane.value} м (XY)` :
           effPlane.axis === "y" ? `Y = ${effPlane.value} м (XZ)` :
           `X = ${effPlane.value} м (YZ)`}
        </div>
      )}
      {tool === "branch" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white" }}>
          {branchFrom ? "Выберите второй узел" : "Выберите начальный узел ветви"}
        </div>
      )}
      {tool === "rotate" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#7c3aed", color: "white" }}>
          🔄 Драг — вращение камеры (Az/El)
        </div>
      )}
    </div>
  );
}

// ─── ViewCube: индикатор/переключатель ракурсов ────────────────────────────
function ViewCube({ x, y, azimuth, elevation, onPick }: {
  x: number; y: number; azimuth: number; elevation: number; onPick: (p: ViewPreset) => void;
}) {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const proj = (px: number, py: number, pz: number) => {
    const x1 = Math.cos(az) * px + Math.sin(az) * py;
    const y1 = -Math.sin(az) * px + Math.cos(az) * py;
    const y2 = Math.sin(el) * y1 - Math.cos(el) * pz;
    return { sx: x1, sy: -y2 };
  };
  const s = 18;  // полу-сторона куба
  // 8 вершин куба
  const verts = [
    proj(-s, -s, -s), proj(s, -s, -s), proj(s, s, -s), proj(-s, s, -s),
    proj(-s, -s,  s), proj(s, -s,  s), proj(s, s,  s), proj(-s, s,  s),
  ];
  // 6 граней (топ/бот/фронт/бэк/лев/прав), порядок вершин CCW
  const faces: { idx: [number, number, number, number]; preset: ViewPreset; color: string; label: string }[] = [
    { idx: [4, 5, 6, 7], preset: "plan",   color: "#fde68a", label: "ПЛАН" },
    { idx: [0, 3, 2, 1], preset: "plan",   color: "#fef3c7", label: "" },     // низ
    { idx: [0, 1, 5, 4], preset: "front",  color: "#bfdbfe", label: "ФРНТ" },
    { idx: [2, 3, 7, 6], preset: "back",   color: "#dbeafe", label: "ТЫЛ" },
    { idx: [0, 4, 7, 3], preset: "left",   color: "#bbf7d0", label: "ЛЕВ" },
    { idx: [1, 2, 6, 5], preset: "right",  color: "#d1fae5", label: "ПРАВ" },
  ];
  // Сортировка граней по средней Z (примитивный hidden-faces)
  const facesWithDepth = faces.map((f) => {
    const cx = (verts[f.idx[0]].sx + verts[f.idx[2]].sx) / 2;
    const cy = (verts[f.idx[0]].sy + verts[f.idx[2]].sy) / 2;
    return { ...f, cx, cy };
  });

  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-26} y={-26} width={52} height={52} fill="white" fillOpacity="0.7" stroke="#9ca3af" rx="4" />
      {facesWithDepth.map((f, i) => {
        const pts = f.idx.map((vi) => `${verts[vi].sx},${verts[vi].sy}`).join(" ");
        const cx = f.idx.reduce((a, vi) => a + verts[vi].sx, 0) / 4;
        const cy = f.idx.reduce((a, vi) => a + verts[vi].sy, 0) / 4;
        return (
          <g key={i} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick(f.preset); }}>
            <polygon points={pts} fill={f.color} stroke="#374151" strokeWidth="0.8" />
            {f.label && (
              <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7" fontWeight="600" fill="#1f2937"
                style={{ pointerEvents: "none" }}>
                {f.label}
              </text>
            )}
          </g>
        );
      })}
      {/* Изо-уголки */}
      <circle cx={20} cy={-20} r="4" fill="#a78bfa" stroke="#374151" strokeWidth="0.6"
        style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick("isoSE"); }} />
      <circle cx={-20} cy={-20} r="4" fill="#a78bfa" stroke="#374151" strokeWidth="0.6"
        style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick("isoSW"); }} />
    </g>
  );
}

// ─── Утилиты попадания ─────────────────────────────────────────────────────
function hitNodeR(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[],
  r = 8): string | null {
  const r2 = r * r;
  for (let i = projNodes.length - 1; i >= 0; i--) {
    const p = projNodes[i];
    const dx = sx - p.sx;
    const dy = sy - p.sy;
    if (dx * dx + dy * dy < r2) return p.node.id;
  }
  return null;
}

function hitNode(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[]): string | null {
  return hitNodeR(sx, sy, projNodes, 8);
}

type ProjNodeEntry = { node: TopoNode; sx: number; sy: number; depth: number };

function hitBranchR(sx: number, sy: number,
  projNodesMap: Map<string, ProjNodeEntry>,
  branches: TopoBranch[], tol = 5): string | null {
  const tol2 = tol * tol;
  for (const b of branches) {
    const from = projNodesMap.get(b.fromId);
    const to = projNodesMap.get(b.toId);
    if (!from || !to) continue;
    const C = to.sx - from.sx, D = to.sy - from.sy;
    const lenSq = C * C + D * D;
    if (lenSq === 0) continue;
    const A = sx - from.sx, B = sy - from.sy;
    const t = Math.max(0, Math.min(1, (A * C + B * D) / lenSq));
    const dx = sx - (from.sx + t * C), dy = sy - (from.sy + t * D);
    if (dx * dx + dy * dy < tol2) return b.id;
  }
  return null;
}

function hitBranch(sx: number, sy: number,
  projNodesMap: Map<string, ProjNodeEntry>,
  branches: TopoBranch[]): string | null {
  return hitBranchR(sx, sy, projNodesMap, branches, 8);
}