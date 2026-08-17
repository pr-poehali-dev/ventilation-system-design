// ─────────────────────────────────────────────────────────────────────────────
// topoCanvasTypes.ts — типы и props интерактивного CAD-холста (TopoCanvas).
//
// Вынесено из TopoCanvas.tsx БЕЗ изменений: те же имена, поля и комментарии.
// Файл содержит только описания типов — поведение не затрагивает.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type TopoNode, type TopoBranch, type ViewPreset, type WorkPlane,
  type Horizon,
} from "@/lib/topology";
import { type UnitsConfig } from "@/lib/unitsConfig";

export type CadTool = "select" | "node" | "branch" | "pan" | "rotate" | "symbol" | "textblock";

export interface Props {
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
  /** Начало перетаскивания узла — момент для снимка истории (undo).
      Вызывается ОДИН раз при захвате, а не на каждое движение мыши. */
  onNodeDragStart?: (id: string) => void;
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
  /** Множитель скорости анимации: 1 — обычная, 0.5 — вдвое медленнее */
  animSpeed?: number;
  /** Активная рабочая плоскость для построения в 3D (если null — auto по ракурсу) */
  workPlane?: WorkPlane | null;
  /** Список горизонтов для фильтрации/окрашивания ветвей. */
  horizons?: Horizon[];
  /** ID горизонта для временной подсветки его ветвей (наведение в списке слоёв). */
  highlightHorizonId?: string | null;
  /** Базовая толщина линии ветви (px), общая настройка. По умолчанию 2.5. */
  branchWidth?: number;
  /** Толщина обводки ветви (px), 0 = без обводки. */
  branchBorder?: number;
  /** Тонкие линии (F6): всё в 1px без обводки и без анимации, для печатной/схемной подачи. */
  thinLines?: boolean;
  /** Фиксированный размер объектов: ветви/узлы/текст не масштабируются при зуме. */
  fixedObjectScale?: boolean;
  /** Порог автопереключения SVG↔Canvas по числу видимых ветвей. По умолчанию CANVAS_THRESHOLD (800). */
  canvasThreshold?: number;
  /** Пределы масштабов объектов (активны при fixedObjectScale=true). */
  scaleLimits?: {
    textMin: number; textMax: number;
    branchMin: number; branchMax: number;
  };
  /** Масштаб перемычек в % от ширины ветви (150 = 1.5× ширины ветви). */
  bulkheadScale?: number;
  /** Масштаб вентиляторов в % от ширины ветви (450 = 4.5× ширины ветви). */
  fanScale?: number;
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
  /** Центрировать камеру на произвольной мировой точке (позиция ПЛА и т.п.) */
  focusPos?: { x: number; y: number; z: number } | null;
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
  /** Пороги авто-скрытия узлов при отдалении (настройка «Видимость узлов») */
  nodeLodThresholds?: { circle: number; label: number };
  /** Условные обозначения на схеме */
  schemaSymbols?: { id: string; typeId: string; x: number; y: number; branchId: string | null; t?: number; offsetX?: number; offsetY?: number; scale?: number; label?: string; description?: string; airDirection?: "forward" | "reverse"; appearYear?: number; appearMonth?: string; appearDay?: number;
    indDescription?: boolean; indResistance?: boolean; indDeltaP?: boolean; indLeakage?: boolean; indOffsetX?: number; indOffsetY?: number; indFontSize?: number;
    bkResMode?: "project" | "survey" | "manual"; bkManualR?: number; bkWindowArea?: number; bkAirPerm?: number; bkManualAirPerm?: boolean; bkCustomAirPerm?: number; bkSurveyQ?: number; bkSurveyDP?: number; bkBulkheadR?: number;
    /** Подпись вентилятора: смещение перетаскиванием и размер шрифта */
    fanIndOffsetX?: number; fanIndOffsetY?: number; fanIndFontSize?: number;
    /** Цвет подложки подписи вентилятора ("none" — без фона) */
    fanIndBgColor?: string;
    /** Замерная станция: данные замера и настройки её индикаторов */
    msNumber?: string; msLocation?: string; msArea?: number; msFlow?: number; msVelocity?: number;
    msIndNumber?: boolean; msIndLocation?: boolean; msIndFlow?: boolean;
    msIndArea?: boolean; msIndVelocity?: boolean;
    msIndOffsetX?: number; msIndOffsetY?: number; msIndFontSize?: number;
    /** Цвет подложки индикаторов ЗС ("none" — без фона) */
    msIndBgColor?: string;
  }[];
  /** Перетаскивание подписи вентилятора мышью */
  onSymbolFanIndOffset?: (id: string, ox: number, oy: number) => void;
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
  /** Смещение бейджа индикаторов замерной станции (px offset) */
  onSymbolMsIndOffset?: (id: string, ox: number, oy: number) => void;
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
  onPositionPlace?: (wx: number, wy: number, wz: number) => void;
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
  waterBranchResults?: Map<string, import("@/lib/waterHydraulics").WaterBranchResult>;
  /** Карта branchId → сегмент задымления {color, fromT, toT} */
  branchFireColors?: Map<string, { color: string; fromT: number; toT: number }>;
  /** Карта branchId → зона поражения взрывом {color, hazardLevel} */
  branchExplosionColors?: Map<string, { color: string; hazardLevel: string }>;
  /** ID ветвей, опрокинутых тепловой депрессией пожара — окрашиваются синим */
  reversedBranchIds?: Set<string>;
  /** ID ветвей маршрута горноспасателей — подсвечиваются зелёным */
  rescuePathBranchIds?: Set<string>;
  /** Направление движения по ветви маршрута: true = fromId→toId, false = toId→fromId */
  rescuePathBranchDirs?: Map<string, boolean>;
  /** ID узлов маршрута горноспасателей (старт/финиш) — подсвечиваются */
  rescuePathNodeIds?: Set<string>;
  /** Буквенные метки узлов горноспасателей: nodeId → «А»/«Б»/«В» */
  rescueNodeLetters?: Map<string, string>;
  /** Callback при клике по узлу в режиме pick (rescuePickMode) */
  onRescueNodePick?: (nodeId: string) => void;
  /** Callback при клике по ветви в режиме pick (rescuePickMode) */
  onRescueBranchPick?: (branchId: string) => void;
  /** Режим выбора узла для горноспасателей */
  rescuePickMode?: string | null;
  /** Режим цветовой заливки ветвей: none = выкл, flowQ = по расходу воздуха */
  colorMode?: "none" | "flowQ" | "velocityV" | "section" | "ventsection";
  /** Цвета участков рудника: id ветви → цвет (для colorMode="ventsection") */
  sectionColors?: Map<string, string>;
  /** Минимальное значение шкалы расхода, м³/с */
  flowColorMin?: number;
  /** Максимальное значение шкалы расхода, м³/с */
  flowColorMax?: number;
  /** Цветовая гамма шкалы расхода */
  flowColorHue?: "red" | "blue" | "green";
  /** Минимальное значение шкалы скорости, м/с */
  velColorMin?: number;
  /** Максимальное значение шкалы скорости, м/с */
  velColorMax?: number;
  /** Цветовая гамма шкалы скорости */
  velColorHue?: "red" | "blue" | "green";
  /** Карта branchId → цвет для сравнения схем (added/removed/changed) */
  compareBranchColors?: Map<string, string>;
}

export type FlowDisplayMode =
  | "off"        // только статичные линии без направления
  | "flow"       // бегущая пунктирная анимация (по умолчанию)
  | "chevrons"   // шевроны ▶ ▶ ▶ вдоль ветви
  | "both";      // и бегущий пунктир, и шевроны

export interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
  azimuth: number;     // °
  elevation: number;   // °
}

export type ProjNodeEntry = { node: TopoNode; sx: number; sy: number; depth: number };