// ─────────────────────────────────────────────────────────────────────────────
// canvasRenderer.ts — Canvas 2D рендерер для больших схем (>CANVAS_THRESHOLD ветвей)
// Математика проекции полностью переиспользуется из topology.ts
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D, calcBranchLength } from "./topology";
import { type InfoDisplayConfig } from "./infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "./unitsConfig";
import { type WaterNodeResult, type WaterBranchResult } from "./waterHydraulics";

export const CANVAS_THRESHOLD = 800;

export type FlowDisplayMode = "off" | "flow" | "chevrons" | "both";

// Кэш SVG-иконок пожарного крана (красный = закрыт, синий = открыт)
const FIRE_CRANE_RED_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/28ea1d46-e9bf-4ca3-bdb2-ae11cf9b1e3b.svg";
const FIRE_CRANE_BLUE_URL = "https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/9b358780-445c-487f-90d2-0b86b4c3c6fb.svg";
let fireCraneRedImg: HTMLImageElement | null = null;
let fireCraneRedLoaded = false;
let fireCraneBlueImg: HTMLImageElement | null = null;
let fireCraneBlueLoaded = false;
function getFireCraneImg(open: boolean): { img: HTMLImageElement; loaded: boolean } {
  if (open) {
    if (!fireCraneBlueImg) {
      fireCraneBlueImg = new Image();
      fireCraneBlueImg.onload = () => { fireCraneBlueLoaded = true; };
      fireCraneBlueImg.src = FIRE_CRANE_BLUE_URL;
    }
    return { img: fireCraneBlueImg, loaded: fireCraneBlueLoaded };
  } else {
    if (!fireCraneRedImg) {
      fireCraneRedImg = new Image();
      fireCraneRedImg.onload = () => { fireCraneRedLoaded = true; };
      fireCraneRedImg.src = FIRE_CRANE_RED_URL;
    }
    return { img: fireCraneRedImg, loaded: fireCraneRedLoaded };
  }
}



export interface ProjNode {
  node: TopoNode;
  sx: number;
  sy: number;
  depth: number;
}

export interface CanvasRenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;

  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  horizonMap: Map<string, Horizon>;
  visibleBranches: TopoBranch[];
  hiddenBranchIds: Set<string>;
  projNodes: ProjNode[];
  projNodesMap: Map<string, ProjNode>;

  proj: ProjOptions;
  view: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  /** Эпоха порядка глубины: меняется при смене масштаба/ракурса/координат, но НЕ при pan.
   *  Позволяет пропускать повторную сортировку ветвей при простом перетаскивании. */
  sortEpoch?: number;
  is3D: boolean;
  zScale: number;
  zLevel: number;

  selectedBranchId: string | null;
  selectedBranchIds: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  hoverBranchId: string | null;
  /** ID горизонта для временной подсветки его ветвей (наведение в списке слоёв). */
  highlightHorizonId?: string | null;

  branchWidth: number;
  branchBorder: number;
  thinLines: boolean;
  colorByHorizon: boolean;
  showFlowArrows: boolean;
  flowDisplay: FlowDisplayMode;

  animOffset: number;

  infoConfig?: InfoDisplayConfig | null;
  unitsConfig: UnitsConfig;
  waterNodeResults?: Map<string, WaterNodeResult>;
  waterBranchResults?: Map<string, WaterBranchResult>;
  /** Карта branchId → сегмент задымления {color, fromT, toT} (0..1 вдоль ветви) */
  branchFireColors?: Map<string, { color: string; fromT: number; toT: number }>;
  /** Карта branchId → зона поражения взрывом {hazardLevel} */
  branchExplosionColors?: Map<string, { color: string; hazardLevel: string }>;
  /** Режим цвета: none = по скорости, flowQ = по расходу */
  colorMode?: "none" | "flowQ";
  /** Нижний предел шкалы заливки по расходу, м³/с (для colorMode="flowQ") */
  flowColorMin?: number;
  /** Верхний предел шкалы заливки по расходу, м³/с (для colorMode="flowQ") */
  flowColorMax?: number;
  /** Палитра заливки по расходу: белый → выбранный цвет */
  flowColorHue?: "red" | "blue" | "green";
  /** Карта branchId → цвет позиции внутри (ПЛА) */
  posInnerColors?: Map<string, string>;
  /** Карта branchId → цвет позиции снаружи (ПЛА) */
  posOuterColors?: Map<string, string>;
  /** Режим печати: белый фон без сетки */
  printMode?: boolean;
  /** Прозрачный фон: не заливать холст (нужно, когда под canvas виден слой печати) */
  transparentBg?: boolean;
  /** Фиксированный размер объектов: ветви/узлы/текст не масштабируются при зуме */
  fixedObjectScale?: boolean;
  /** Пределы масштабов (%, 80 = 80%) для объектов при fixedObjectScale=true */
  scaleLimits?: {
    textMin: number; textMax: number;
    branchMin: number; branchMax: number;
  };
  /** Масштаб по осям XY — нужен для нормализации objSF при реальных координатах */
  xyScale?: number;
  /** ID ветвей, загрязнённых воздухом (pollutesAir + все ниже по потоку) — стрелки синие */
  pollutedBranchIds?: Set<string>;
  /** ID ветвей, опрокинутых тепловой депрессией пожара — окрашиваются синим */
  reversedBranchIds?: Set<string>;
  /** Карта branchId → цвет сравнения схем (#f59e0b=изменена, #22c55e=добавлена, #ef4444=удалена) */
  compareBranchColors?: Map<string, string>;
  /** ID узлов маршрута горноспасателей — рисуются зелёным кольцом */
  rescuePathNodeIds?: Set<string>;
  /** Буквенные метки узлов горноспасателей: nodeId → «А»/«Б»/«В» */
  rescueNodeLetters?: Map<string, string>;
  /** ID ветвей маршрута горноспасателей — подсвечиваются зелёным */
  rescuePathBranchIds?: Set<string>;
  /** Направление движения по ветви маршрута: true = fromId→toId, false = toId→fromId */
  rescuePathBranchDirs?: Map<string, boolean>;
}

// ─── Цвет ветви по скорости ────────────────────────────────────────────────
const VELOCITY_STOPS = [
  { v: 0,  r: 156, g: 163, b: 175 },
  { v: 3,  r: 59,  g: 130, b: 246 },
  { v: 8,  r: 16,  g: 185, b: 129 },
  { v: 15, r: 234, g: 179, b: 8   },
  { v: 25, r: 239, g: 68,  b: 68  },
];

export function velocityColor(v: number): string {
  if (v <= 0) return "#9ca3af";
  let lo = VELOCITY_STOPS[0], hi = VELOCITY_STOPS[VELOCITY_STOPS.length - 1];
  for (let i = 0; i < VELOCITY_STOPS.length - 1; i++) {
    if (v >= VELOCITY_STOPS[i].v && v <= VELOCITY_STOPS[i + 1].v) {
      lo = VELOCITY_STOPS[i]; hi = VELOCITY_STOPS[i + 1]; break;
    }
  }
  const t = lo.v === hi.v ? 1 : Math.min(1, (v - lo.v) / (hi.v - lo.v));
  return `rgb(${Math.round(lo.r + (hi.r - lo.r) * t)},${Math.round(lo.g + (hi.g - lo.g) * t)},${Math.round(lo.b + (hi.b - lo.b) * t)})`;
}

// ─── Цвет ветви по расходу воздуха (заливка heatmap) ───────────────────────
// Аналог flowQColor из SVG-рендера: белый (мин) → насыщенный цвет (макс).
const FLOW_HUE_TARGETS: Record<string, [number, number, number]> = {
  red:   [220, 38, 38],
  blue:  [37, 99, 235],
  green: [22, 163, 74],
};
export function flowQColor(q: number, min: number, max: number, hue: "red" | "blue" | "green"): string {
  const t = Math.min(1, Math.max(0, (q - min) / Math.max(0.001, max - min)));
  const [tr, tg, tb] = FLOW_HUE_TARGETS[hue] ?? FLOW_HUE_TARGETS.red;
  const r = Math.round(255 + (tr - 255) * t);
  const g = Math.round(255 + (tg - 255) * t);
  const b = Math.round(255 + (tb - 255) * t);
  return `rgb(${r},${g},${b})`;
}

function fmtR(rMkyurg: number, unit: { fromBase: (v: number) => number; symbol: string; decimals: number }): string {
  const v = unit.fromBase(rMkyurg);
  if (v === 0) return `0 ${unit.symbol}`;
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const decimals = Math.max(unit.decimals, -mag + 1);
  return `${v.toFixed(decimals)}${unit.symbol}`;
}

// ─── Кэши сортировки по глубине (ветви и узлы) ─────────────────────────────
// Ключ — ссылочное равенство: если массив/map не изменился → возвращаем кэш O(1).
// При pan/zoom projNodesMap пересоздаётся → кэш сбрасывается автоматически.
// При анимации потока projNodesMap НЕ меняется → кэш переиспользуется.
type SortedBranch = { b: TopoBranch; from: { sx: number; sy: number; depth: number; node: TopoNode } | undefined; to: { sx: number; sy: number; depth: number; node: TopoNode } | undefined; depth: number; hOrder: number };
let _sortedBranchesCache: SortedBranch[] = [];
let _sortedBranchesKey: { visibleBranches: TopoBranch[]; projNodesMap: Map<string, unknown>; horizonOrderMap: Map<string, number> } = { visibleBranches: [], projNodesMap: new Map(), horizonOrderMap: new Map() };
// Эпоха порядка глубины: меняется только при смене масштаба/ракурса/координат,
// но НЕ при перетаскивании. Пока эпоха та же — порядок сортировки не меняется,
// и при pan мы лишь обновляем ссылки from/to без повторной O(N·logN) сортировки.
let _sortedBranchesEpoch: number | undefined;

// Кэш карты порядка горизонтов по ссылке массива horizons → стабильная ссылка,
// пока список горизонтов не изменился (важно для кэша сортировки ветвей).
let _horizonOrderKey: Horizon[] | null = null;
let _horizonOrderCache: Map<string, number> = new Map();
function getHorizonOrderMap(horizons: Horizon[]): Map<string, number> {
  if (_horizonOrderKey === horizons) return _horizonOrderCache;
  const m = new Map<string, number>();
  (horizons ?? []).forEach((h, i) => m.set(h.id, i));
  _horizonOrderKey = horizons;
  _horizonOrderCache = m;
  return m;
}

function getSortedBranches(
  visibleBranches: TopoBranch[],
  projNodesMap: Map<string, { sx: number; sy: number; depth: number; node: TopoNode }>,
  horizonOrderMap: Map<string, number>,
  sortEpoch?: number,
): SortedBranch[] {
  if (
    _sortedBranchesKey.visibleBranches === visibleBranches &&
    _sortedBranchesKey.projNodesMap === projNodesMap &&
    _sortedBranchesKey.horizonOrderMap === horizonOrderMap
  ) {
    return _sortedBranchesCache;
  }
  // БЫСТРАЯ ПАНОРАМА: та же эпоха глубины, тот же набор ветвей и порядок
  // горизонтов → порядок сохраняется, обновляем только from/to (сдвиг offset).
  if (
    sortEpoch !== undefined &&
    sortEpoch === _sortedBranchesEpoch &&
    _sortedBranchesKey.visibleBranches === visibleBranches &&
    _sortedBranchesKey.horizonOrderMap === horizonOrderMap &&
    _sortedBranchesCache.length === visibleBranches.length
  ) {
    _sortedBranchesKey = { visibleBranches, projNodesMap, horizonOrderMap };
    _sortedBranchesCache = _sortedBranchesCache.map((e) => ({
      b: e.b,
      from: projNodesMap.get(e.b.fromId),
      to: projNodesMap.get(e.b.toId),
      depth: e.depth,
      hOrder: e.hOrder,
    }));
    return _sortedBranchesCache;
  }
  _sortedBranchesKey = { visibleBranches, projNodesMap, horizonOrderMap };
  _sortedBranchesEpoch = sortEpoch;
  _sortedBranchesCache = visibleBranches.map((b) => {
    const from = projNodesMap.get(b.fromId);
    const to   = projNodesMap.get(b.toId);
    const depth = from && to ? (from.depth + to.depth) / 2 : 0;
    const hOrder = b.horizonId ? (horizonOrderMap.get(b.horizonId) ?? 9999) : 9999;
    return { b, from, to, depth, hOrder };
  }).sort((a, b) => {
    // Главный критерий — порядок горизонта (слои как в Фотошопе): больший hOrder ниже.
    if (a.hOrder !== b.hOrder) return b.hOrder - a.hOrder;
    // Внутри горизонта — по глубине 3D.
    return a.depth - b.depth;
  });
  return _sortedBranchesCache;
}

type SortedNode = { node: TopoNode; sx: number; sy: number; depth: number };
let _sortedNodesCache: SortedNode[] = [];
let _sortedNodesKey: ProjNode[] | null = null;
let _sortedNodesEpoch: number | undefined;
// Индексы порядка сортировки узлов (для быстрого переупорядочивания при pan).
let _sortedNodesOrder: number[] = [];

function getSortedNodes(projNodes: ProjNode[], sortEpoch?: number): SortedNode[] {
  if (_sortedNodesKey === projNodes) return _sortedNodesCache;
  // БЫСТРАЯ ПАНОРАМА: та же эпоха и тот же размер → порядок прежний,
  // переиспользуем сохранённые индексы без повторной сортировки.
  if (
    sortEpoch !== undefined &&
    sortEpoch === _sortedNodesEpoch &&
    _sortedNodesOrder.length === projNodes.length
  ) {
    _sortedNodesKey = projNodes;
    _sortedNodesCache = _sortedNodesOrder.map((idx) => projNodes[idx]);
    return _sortedNodesCache;
  }
  _sortedNodesKey = projNodes;
  _sortedNodesEpoch = sortEpoch;
  const order = projNodes.map((_, i) => i).sort((a, b) => projNodes[a].depth - projNodes[b].depth);
  _sortedNodesOrder = order;
  _sortedNodesCache = order.map((idx) => projNodes[idx]);
  return _sortedNodesCache;
}

// ─── Сетка 2D (план) ───────────────────────────────────────────────────────
// Все линии одного стиля рисуются одним beginPath/stroke — вместо N отдельных stroke() вызовов.
// При 1920×1080 и scale=1: ~150 линий → было 150 stroke(), стало 2 stroke().
function drawGrid2D(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, offsetX: number, offsetY: number) {
  if (scale < 0.5) {
    ctx.fillStyle = "#f8f9fa";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const minor = 20 * scale;
  const major = 100 * scale;
  const ox = offsetX % major;
  const oy = offsetY % major;

  ctx.save();

  // Minor grid — один path для всех линий
  ctx.strokeStyle = "#f0f0f0";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = ox % minor; x < w; x += minor) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = oy % minor; y < h; y += minor) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  // Major grid — один path для всех линий
  ctx.strokeStyle = "#dcdcdc";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let x = ox; x < w; x += major) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = oy; y < h; y += major) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  ctx.restore();
}

// ─── 3D-сетка (горизонтальная плоскость z=0) ──────────────────────────────
// Все линии сетки — один beginPath/stroke вместо N отдельных.
function drawGrid3D(ctx: CanvasRenderingContext2D, proj: ProjOptions) {
  const step = 500, range = 3000;
  ctx.save();
  ctx.strokeStyle = "#d4d4d4";
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 0.6;

  // Все линии сетки одним path
  ctx.beginPath();
  for (let x = -range; x <= range; x += step) {
    const a = project3D({ x, y: -range, z: 0 }, proj);
    const b = project3D({ x, y:  range, z: 0 }, proj);
    ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
  }
  for (let y = -range; y <= range; y += step) {
    const a = project3D({ x: -range, y, z: 0 }, proj);
    const b = project3D({ x:  range, y, z: 0 }, proj);
    ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy);
  }
  ctx.stroke();

  // Оси X/Y/Z — каждая своим цветом, но только 3 stroke() вместо forEach с closures
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  const O  = project3D({ x: 0,   y: 0,   z: 0   }, proj);
  const Xa = project3D({ x: 500, y: 0,   z: 0   }, proj);
  const Ya = project3D({ x: 0,   y: 500, z: 0   }, proj);
  const Za = project3D({ x: 0,   y: 0,   z: 500 }, proj);
  ctx.font = "10px sans-serif";

  ctx.strokeStyle = "#ef4444"; ctx.beginPath(); ctx.moveTo(O.sx, O.sy); ctx.lineTo(Xa.sx, Xa.sy); ctx.stroke();
  ctx.fillStyle   = "#ef4444"; ctx.fillText("X", Xa.sx + 4, Xa.sy);

  ctx.strokeStyle = "#22c55e"; ctx.beginPath(); ctx.moveTo(O.sx, O.sy); ctx.lineTo(Ya.sx, Ya.sy); ctx.stroke();
  ctx.fillStyle   = "#22c55e"; ctx.fillText("Y", Ya.sx + 4, Ya.sy);

  ctx.strokeStyle = "#3b82f6"; ctx.beginPath(); ctx.moveTo(O.sx, O.sy); ctx.lineTo(Za.sx, Za.sy); ctx.stroke();
  ctx.fillStyle   = "#3b82f6"; ctx.fillText("Z", Za.sx + 4, Za.sy);

  ctx.restore();
}

// ─── Основной рендер всей схемы ────────────────────────────────────────────
// ВАЖНО: все поля CanvasRenderOptions ДОЛЖНЫ быть перечислены в деструктуризации ниже.
// Если поле добавлено в интерфейс но пропущено здесь — TypeScript не ошибётся,
// но обращение к переменной в теле функции вызовет ReferenceError в рантайме.
// Неиспользуемые поля помечай префиксом _ чтобы было явно видно что они получены.
export function renderCanvas(opts: CanvasRenderOptions) {
  const {
    ctx, width, height, view, proj, is3D,
    branches, visibleBranches, projNodesMap, projNodes,
    selectedBranchId, selectedBranchIds, selectedNodeId, selectedNodeIds,
    hoverBranchId,
    branchWidth, branchBorder, thinLines, colorByHorizon, showFlowArrows,
    flowDisplay, animOffset,
    horizonMap, infoConfig, unitsConfig, waterNodeResults, waterBranchResults, branchFireColors, branchExplosionColors,
    colorMode = "none", flowColorMin = 0, flowColorMax = 75, flowColorHue = "red",
    posInnerColors, posOuterColors, printMode = false, transparentBg = false,
    fixedObjectScale = false, scaleLimits, pollutedBranchIds, reversedBranchIds,
    compareBranchColors,
    rescuePathNodeIds, rescueNodeLetters,
    rescuePathBranchIds, rescuePathBranchDirs,
    highlightHorizonId = null,
    xyScale,
    hiddenBranchIds,
    // Поля ниже сейчас не используются в рендере, но деструктурированы явно
    // чтобы при случайном обращении к ним не было ReferenceError.
    nodes: _nodes, horizons: _horizons,
    zScale: _zScale, zLevel: _zLevel,
  } = opts;

  // Множество ID скрытых по горизонту ветвей (для фильтрации узлов/УО).
  // Пустой Set, если не передано.
  const hiddenBrIds: Set<string> = hiddenBranchIds ?? new Set<string>();

  ctx.clearRect(0, 0, width, height);

  // ─── LOD пороги ───────────────────────────────────────────────────────────
  const sc = view.scale;
  // Коэффициент масштабирования объектов.
  // В режиме печати — фиксированный размер (1).
  // fixedObjectScale=true (пределы масштабов включены) → objSF зажимается по min/max из scaleLimits.
  // fixedObjectScale=false (нормальный режим) → objSF растёт неограниченно вместе со zoom,
  //   только снизу ограничен 0.25 чтобы ветви были видимы при любом удалении.
  // При наличии xyScale нормируем: «нормальный» scale при xyScale=N в N раз меньше.
  const _xyScaleCR = xyScale ?? 1;
  const rawObjSF = printMode ? 1 : sc / (_xyScaleCR * 0.4);
  // Применяем пределы масштабов если включён режим fixedObjectScale
  const _sl = scaleLimits;
  const objSF = printMode
    ? 1
    : fixedObjectScale && _sl
      // Пределы заданы в % от «нормального» размера (100% = objSF=1)
      ? Math.min(_sl.branchMax / 100, Math.max(_sl.branchMin / 100, rawObjSF))
      // Нет ограничений — только минимум чтобы объекты были видимы
      : Math.max(rawObjSF, 0.25);
  // LOD: в режиме печати все элементы видны; иначе — только при достаточном масштабе.
  // Используем objSF-скорректированный sc для LOD чтобы учесть минимальный размер объектов.
  const lodChevrons = printMode || sc >= 0.25;
  const lodArrows   = printMode || sc >= 0.15;
  const lodLabels   = printMode || sc >= 0.04;
  // Border всегда включён — без него белые ветви невидимы на светлом фоне
  const lodBorder   = true;
  // Узлы: всегда показываем (при малом scale они маленькие но видимы благодаря min objSF)
  const lodNodes    = true;

  // ─── Фон / сетка ──────────────────────────────────────────────────────────
  // transparentBg: не заливаем холст, чтобы сквозь него был виден слой печати
  // (белый лист + рамка), лежащий ПОД canvas в canvas-режиме.
  if (transparentBg) {
    // прозрачно: рисуем только линии сетки в 2D (они не мешают), в 3D — ничего
    if (!is3D && sc >= 0.5) drawGrid2D(ctx, width, height, sc, view.offsetX, view.offsetY);
  } else if (printMode) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else if (is3D) {
    ctx.fillStyle = "#f5f5f4";
    ctx.fillRect(0, 0, width, height);
    drawGrid3D(ctx, proj);
  } else {
    drawGrid2D(ctx, width, height, sc, view.offsetX, view.offsetY);
  }

  // ─── Порядок горизонтов (слои как в Фотошопе): индекс в списке = z-order ───
  // Стабильная ссылка (кэш по ссылке массива horizons) — нужна для кэша сортировки.
  const horizonOrderMap = getHorizonOrderMap(_horizons);

  // ─── Сортировка ветвей: сначала по слою-горизонту, затем по глубине ────────
  // Используем кэш: при анимации потока projNodesMap не меняется → O(1) вместо O(N log N)
  const allSorted = getSortedBranches(visibleBranches, projNodesMap as Map<string, { sx: number; sy: number; depth: number; node: TopoNode }>, horizonOrderMap, opts.sortEpoch);

  // ─── Viewport culling: отсекаем ветви вне экрана (с запасом 64px) ──────────
  const CULL_MARGIN = 64;
  const cullMinX = -CULL_MARGIN, cullMaxX = width + CULL_MARGIN;
  const cullMinY = -CULL_MARGIN, cullMaxY = height + CULL_MARGIN;
  const sorted = allSorted.filter(({ from, to }) => {
    if (!from || !to) return true;
    const minX = Math.min(from.sx, to.sx), maxX = Math.max(from.sx, to.sx);
    const minY = Math.min(from.sy, to.sy), maxY = Math.max(from.sy, to.sy);
    return maxX >= cullMinX && minX <= cullMaxX && maxY >= cullMinY && minY <= cullMaxY;
  });

  // ─── Группировка по слоям-горизонтам (как в Фотошопе) ─────────────────────
  // sorted уже упорядочен: сначала нижние горизонты, потом верхние. Внутри слоя
  // рисуем border, затем fill (цельные стыки), а слои идут по порядку — поэтому
  // окантовка/заливка/УО верхнего горизонта не перекрываются нижним.
  const layerGroups: SortedBranch[][] = [];
  {
    let gi = 0;
    while (gi < sorted.length) {
      const curOrder = sorted[gi].hOrder;
      const start = gi;
      while (gi < sorted.length && sorted[gi].hOrder === curOrder) gi++;
      layerGroups.push(sorted.slice(start, gi));
    }
  }

  // ─── ВЕТВИ ────────────────────────────────────────────────────────────────
  // Вычисляем параметры ОДИН РАЗ для каждой ветви и сохраняем в Map.
  // Ранее branchParams() вызывался дважды (проход 1 + проход 2) = 2×N вычислений.
  type BranchP = {
    isSel: boolean; isMulti: boolean; isDead: boolean; isLeakage: boolean;
    Q: number; V: number; overV: boolean; reversed: boolean;
    sxA: number; syA: number; sxB: number; syB: number;
    midX: number; midY: number; color: string; w: number; bwBorder: number; bw: number;
    flowVisible: boolean; showDashes: boolean; showChevrons: boolean;
    dx: number; dy: number; segLen: number; ux: number; uy: number; angle: number;
    fromSx: number; fromSy: number; toSx: number; toSy: number;
    fromNode: ProjNode["node"]; toNode: ProjNode["node"];
  };
  // Цвет заливки ветви по умолчанию (colorMode="none"): белый — точно как в
  // SVG-рендере рабочей области (TopoCanvas). Ветвь читается за счёт тёмной
  // обводки #1f2937. Раньше в printMode заливка была #333333, из-за чего в
  // предпросмотре печати схема выглядела чёрной, в отличие от рабочей области.
  const defaultBranchColor = "#ffffff";
  const bParamsMap = new Map<string, BranchP>();
  for (const { b, from, to } of sorted) {
    if (!from || !to) continue;
    const isSel     = selectedBranchId === b.id || selectedBranchIds.has(b.id);
    const isMulti   = selectedBranchIds.has(b.id);
    const isDead    = b.isDead ?? false;
    const isLeakage = b.isLeakage ?? false;
    const Q  = Math.abs(b.flow);
    const V  = b.velocity;
    const overV = V > b.vMax;
    const fanReverseOverride = b.hasFan && (b.fanReverse ?? false) && b.flow >= 0;
    const reversed = b.flow < 0 || fanReverseOverride;
    const sxA = reversed ? to.sx : from.sx, syA = reversed ? to.sy : from.sy;
    const sxB = reversed ? from.sx : to.sx, syB = reversed ? from.sy : to.sy;
    const midX = (from.sx + to.sx) / 2, midY = (from.sy + to.sy) / 2;
    const horizonColor = b.horizonId ? horizonMap.get(b.horizonId)?.color : undefined;
    const posInnerCol = posInnerColors?.get(b.id);
    const color = isSel ? (isMulti ? "#f59e0b" : "#2563eb")
      : isLeakage ? "#f97316"
      : overV    ? "#dc2626"
      // Ветвь входит в позицию ПЛА — красим цветом позиции. Ветви БЕЗ позиции
      // сохраняют обычный цвет (горизонт/скорость/контур), а не заливаются белым.
      : posInnerCol ? posInnerCol
      : (colorByHorizon && horizonColor) ? horizonColor
      : colorMode === "flowQ" ? flowQColor(Q, flowColorMin, flowColorMax, flowColorHue)
      : colorMode === "none" ? defaultBranchColor
      : Q > 0    ? velocityColor(V)
      : defaultBranchColor;
    const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
    const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
    const baseW = isSel ? bw + 1 : bw;
    // Минимальная абсолютная толщина ветви в px экрана — чтобы при малом масштабе
    // ветви оставались читаемыми (не субпиксельными)
    const w = thinLines ? 1 : Math.max(baseW * objSF, 1.0);
    // Border: минимум 0.5px в абсолютных координатах экрана, чтобы обводка не пропадала
    const bwBorder = (thinLines || !lodBorder) ? 0 : Math.max(Math.max(0, bb) * objSF, 0.5);
    const flowVisible = !thinLines && lodChevrons && Q > 0.1 && flowDisplay !== "off";
    const showDashes   = flowVisible && (flowDisplay === "flow"     || flowDisplay === "both");
    const showChevrons = flowVisible && (flowDisplay === "chevrons" || flowDisplay === "both");
    const dx = sxB - sxA, dy = syB - syA;
    const segLen = Math.hypot(dx, dy);
    const ux = segLen > 0 ? dx / segLen : 0;
    const uy = segLen > 0 ? dy / segLen : 0;
    const angle = Math.atan2(dy, dx);
    bParamsMap.set(b.id, { isSel, isMulti, isDead, isLeakage, Q, V, overV, reversed,
      sxA, syA, sxB, syB, midX, midY, color, w, bwBorder, bw,
      flowVisible, showDashes, showChevrons, dx, dy, segLen, ux, uy, angle,
      fromSx: from.sx, fromSy: from.sy, toSx: to.sx, toSy: to.sy,
      fromNode: from.node, toNode: to.node });
  }

  // Устанавливаем lineCap один раз перед циклами — большинство ветвей используют "round"
  ctx.lineCap = "round";

  // ── ПРОХОД −1: Сравнение схем — аура под всеми слоями ────────────────────
  if (compareBranchColors && compareBranchColors.size > 0) {
    ctx.setLineDash([]);
    for (const { b } of sorted) {
      const p = bParamsMap.get(b.id);
      if (!p) continue;
      const col = compareBranchColors.get(b.id);
      if (!col) continue;
      // Широкая полупрозрачная аура
      ctx.strokeStyle = col;
      ctx.lineWidth = p.w + 10;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
      // Узкая яркая обводка
      ctx.lineWidth = p.w + 4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── ПРОХОД 0: ПЛА цвет снаружи — под border и fill ───────────────────────
  if (posOuterColors) {
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([]);
    for (const { b } of sorted) {
      const p = bParamsMap.get(b.id);
      if (!p) continue;
      const col = posOuterColors.get(b.id);
      if (!col) continue;
      ctx.strokeStyle = col;
      ctx.lineWidth = p.w + p.bwBorder * 2 + 6;
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── ПОДСВЕТКА ГОРИЗОНТА (наведение в списке слоёв слева) ─────────────────
  if (highlightHorizonId) {
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([]);
    ctx.strokeStyle = "#f59e0b";
    for (const { b } of sorted) {
      if (b.horizonId !== highlightHorizonId) continue;
      const p = bParamsMap.get(b.id);
      if (!p) continue;
      ctx.lineWidth = p.w + 10;
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ── ВЕТВИ ПО СЛОЯМ-ГОРИЗОНТАМ ─────────────────────────────────────────────
  // Для каждого горизонта: сначала border всей группы, затем fill всей группы.
  // Это сохраняет цельные стыки в узлах ВНУТРИ горизонта и одновременно даёт
  // корректный z-order МЕЖДУ горизонтами (верхний слой поверх нижнего).
  for (const group of layerGroups) {
  // ── ПРОХОД 1: только border (обводка) ветвей слоя ─────────────────────────
  for (const { b } of group) {
    const p = bParamsMap.get(b.id);
    if (!p || p.bwBorder === 0) continue;
    // Опрокидывание — синяя аура под border
    if (reversedBranchIds?.has(b.id)) {
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = Math.max(p.w + 18, 10);
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(p.sxA, p.syA); ctx.lineTo(p.sxB, p.syB); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(p.w + 10, 6);
      ctx.beginPath(); ctx.moveTo(p.sxA, p.syA); ctx.lineTo(p.sxB, p.syB); ctx.stroke();
    }
    // Взрыв — аура под border (штриховая, более широкая)
    const expSeg = branchExplosionColors?.get(b.id);
    if (expSeg) {
      ctx.strokeStyle = expSeg.color;
      ctx.lineWidth = Math.max(p.w + 20, 12);
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.moveTo(p.sxA, p.syA); ctx.lineTo(p.sxB, p.syB); ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(p.w + 8, 6);
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.sxA, p.syA); ctx.lineTo(p.sxB, p.syB); ctx.stroke();
    }
    // Подсветка hover
    if (hoverBranchId === b.id) {
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = p.w + 8;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
    }
    // Border
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = p.w + p.bwBorder * 2;
    ctx.globalAlpha = 0.85;
    ctx.setLineDash(p.isLeakage ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
  }
  // Сброс после прохода 1 (border) внутри слоя
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // ── ПРОХОД 2: fill + декор ветвей слоя ────────────────────────────────────
  // БЕЛЫЕ ветви (defaultBranchColor — нет цвета позиции ПЛА / нулевой расход /
  // colorMode="none") рисуем ПЕРВЫМИ, окрашенные — ПОВЕРХ них. Иначе белые концы
  // (round-cap) соседних ветвей перекрывают окраску (позиции ПЛА, расход воздуха)
  // в общих узлах. Порядок стабильный (не меняем z-order внутри каждой категории).
  const isPlainWhite = (id: string): boolean => {
    const c = bParamsMap.get(id)?.color;
    return c === defaultBranchColor;
  };
  const hasColored = group.some(({ b }) => !isPlainWhite(b.id));
  const group2 = hasColored
    ? [...group].sort((a, bb) => {
        const wa = isPlainWhite(a.b.id) ? 0 : 1;
        const wb = isPlainWhite(bb.b.id) ? 0 : 1;
        return wa - wb;
      })
    : group;
  for (const { b } of group2) {
    const p = bParamsMap.get(b.id);
    if (!p) continue;
    const { isSel, isDead, isLeakage, Q, V, overV,
      sxA, syA, sxB, syB, midX, midY, color, w,
      flowVisible, showDashes, showChevrons, dx, dy, segLen, ux, uy, angle } = p;

    // Пожар и опрокидывание — ауры (только если нет border, иначе уже нарисованы в проходе 1)
    if (p.bwBorder === 0) {
      if (reversedBranchIds?.has(b.id)) {
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = Math.max(w + 18, 10);
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([8, 4]);
        ctx.beginPath(); ctx.moveTo(sxA, syA); ctx.lineTo(sxB, syB); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = Math.max(w + 10, 6);
        ctx.beginPath(); ctx.moveTo(sxA, syA); ctx.lineTo(sxB, syB); ctx.stroke();
      }
      const expSeg2 = branchExplosionColors?.get(b.id);
      if (expSeg2) {
        ctx.strokeStyle = expSeg2.color;
        ctx.lineWidth = Math.max(w + 20, 12);
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([10, 6]);
        ctx.beginPath(); ctx.moveTo(sxA, syA); ctx.lineTo(sxB, syB); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(w + 8, 6);
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(sxA, syA); ctx.lineTo(sxB, syB); ctx.stroke();
      }
      if (hoverBranchId === b.id) {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = w + 8;
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
      }
    }

    // ── Подсветка маршрута/пути: аура + штрих — рисуется ПОД основной линией
    //    (как в SVG). Основная линия ложится поверх, зелёная аура видна по краям.
    //    Стрелки направления рисуются ПОСЛЕ основной линии (ниже).
    if (rescuePathBranchIds?.has(b.id)) {
      ctx.save();
      ctx.setLineDash([]);
      // Зелёная аура
      ctx.strokeStyle = "#16a34a"; ctx.globalAlpha = 0.4;
      ctx.lineWidth = Math.max(w + 10, 7); ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
      // Зелёная штриховая линия
      ctx.strokeStyle = "#4ade80"; ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(w + 3, 3); ctx.setLineDash([14, 6]);
      ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();
      ctx.restore();
    }

    // Основная линия
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.globalAlpha = flowVisible ? 0.55 : 1;
    ctx.setLineDash(isLeakage ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();

    // Задымление (дым) — тёмно-серая полоса ВНУТРИ ветви, поверх основной линии
    const fireSeg = branchFireColors?.get(b.id);
    if (fireSeg) {
      const { color: fireCol, fromT, toT } = fireSeg;
      const fsx = sxA + (sxB - sxA) * fromT, fsy = syA + (syB - syA) * fromT;
      const tsx = sxA + (sxB - sxA) * toT,   tsy = syA + (syB - syA) * toT;
      ctx.strokeStyle = fireCol;
      ctx.lineWidth = Math.max(w * 0.7, 2);
      ctx.globalAlpha = 0.95;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(fsx, fsy); ctx.lineTo(tsx, tsy); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Бегущий пунктир
    if (showDashes) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = "butt";
      ctx.globalAlpha = 0.95; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -animOffset;
      ctx.beginPath(); ctx.moveTo(sxA, syA); ctx.lineTo(sxB, syB); ctx.stroke();
      ctx.lineCap = "round"; ctx.lineDashOffset = 0;
    }

    // Шевроны — один ctx.save/restore на всю ветвь вместо N штук
    if (showChevrons && segLen > 24) {
      const count = Math.max(1, Math.floor(segLen / 30));
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = "white"; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.9;
      ctx.setLineDash([]);
      for (let i = 0; i < count; i++) {
        const t0 = (i + 1) / (count + 1);
        ctx.save();
        ctx.translate(sxA + dx * t0, syA + dy * t0);
        ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(4, 0); ctx.lineTo(-4, 4);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // Маркер истока
    if (flowVisible) {
      ctx.fillStyle = color; ctx.globalAlpha = 0.9; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(sxA, syA, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // ── Стрелки направления маршрута/пути (как в SVG) — рисуются ПОВЕРХ
    //    основной линии, аура+штрих уже нарисованы ПОД ней выше.
    if (rescuePathBranchIds?.has(b.id)) {
      ctx.save();
      ctx.setLineDash([]);

      // Направление движения по ветви
      const forward = rescuePathBranchDirs?.get(b.id) ?? true;
      const rAxA = forward ? p.fromSx : p.toSx;
      const rAyA = forward ? p.fromSy : p.toSy;
      const rAxB = forward ? p.toSx   : p.fromSx;
      const rAyB = forward ? p.toSy   : p.fromSy;
      const rdx = rAxB - rAxA, rdy = rAyB - rAyA;
      const rLen = Math.hypot(rdx, rdy);
      const rAngle = Math.atan2(rdy, rdx);
      const arrowStep = 90;
      const arrowCount = rLen > arrowStep ? Math.floor(rLen / arrowStep) : 1;
      if (rLen > 20) {
        const al = Math.min(22, Math.max(14, w * 3.5));
        const hw = al / 2;
        ctx.globalAlpha = 0.95;
        for (let i = 0; i < arrowCount; i++) {
          const t0 = (i + 1) / (arrowCount + 1);
          const cx = rAxA + rdx * t0, cy = rAyA + rdy * t0;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(rAngle);
          // Хвостик
          ctx.strokeStyle = "white"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw - 5, 0); ctx.stroke();
          ctx.strokeStyle = "#15803d"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw - 5, 0); ctx.stroke();
          // Наконечник
          ctx.fillStyle = "white"; ctx.strokeStyle = "#15803d"; ctx.lineWidth = 1; ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(hw - 7, -5); ctx.lineTo(hw, 0); ctx.lineTo(hw - 7, 5); ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // Стрелка потока — одна по центру ветви с тонким хвостиком, стиль Вентиляция 2.0
    // Размеры ПОЛНОСТЬЮ пропорциональны w (толщине ветви) → масштабируются вместе со схемой
    if (showFlowArrows && !thinLines && lodArrows && Q > 0.1) {
      const arrowColor = (pollutedBranchIds?.has(b.id) ?? false) ? "#2563eb" : "#dc2626";
      const tipH    = w * 2.2;
      const tipW    = w * 0.5;
      const tailLen = w * 3.0;
      const tailW   = Math.max(0.5, w * 0.15);
      // Не показываем если стрелка не влезает в длину ветви (как в ПО Вентиляция 2.0)
      if (segLen >= (tailLen + tipH) * 2) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.translate(sxA + dx * 0.5, syA + dy * 0.5);
      ctx.rotate(angle);
      ctx.globalAlpha = 1;
      // Белая обводка всей стрелки (контур)
      ctx.strokeStyle = "white";
      ctx.lineWidth = tailW + 1.5;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-tailLen, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -tipW); ctx.lineTo(tipH, 0); ctx.lineTo(0, tipW); ctx.closePath();
      ctx.stroke();
      // Хвостик
      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = tailW;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-tailLen, 0); ctx.lineTo(0, 0); ctx.stroke();
      // Наконечник
      ctx.fillStyle = arrowColor;
      ctx.strokeStyle = "white";
      ctx.lineWidth = 0.8;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, -tipW); ctx.lineTo(tipH, 0); ctx.lineTo(0, tipW); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
      } // end segLen check
    } // end showFlowArrows

    // Метки ветвей
    if (lodLabels) {
      const ic = (b.indicators && Object.keys(b.indicators).length > 0)
        ? { ...(infoConfig ?? {}), ...b.indicators } as typeof infoConfig
        : infoConfig;
      const labelOpacity = Math.min(1, (sc - 0.04) / 0.08);
      const branchNum = b.id.replace(/^B/, "");
      const hasCalc = (Q > 0 || b.velocity > 0) && !isDead;
      const showNum = !ic || ic.branchNumber;
      const lox = (b.labelOffsetX ?? 0) * objSF;
      const loy = (b.labelOffsetY ?? -16) * objSF;
      const labelAng = (b.labelAngle ?? 0) * Math.PI / 180;
      const anchorX = midX + lox, anchorY = midY + loy;

      const dataLines: string[] = [];
      if (!isDead && ic) {
        const uFlow = getUnit(unitsConfig, "flow");
        const uVel  = getUnit(unitsConfig, "velocity");
        const uPres = getUnit(unitsConfig, "pressure");
        const uLen  = getUnit(unitsConfig, "length");
        const uArea = getUnit(unitsConfig, "area");
        const uRes  = getUnit(unitsConfig, "resistance");
        const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
        const lenReal = b.length || Math.round(calcBranchLength(p.fromNode, p.toNode));
        if (ic.branchName && b.type) dataLines.push(b.type);
        if (ic.branchLength) dataLines.push(`L=${uLen.fromBase(lenReal).toFixed(uLen.decimals)}${uLen.symbol}`);
        if (ic.branchAngle) dataLines.push(`A=${(b.angle ?? 0).toFixed(1)}°`);
        if (ic.branchSection) dataLines.push(`S=${uArea.fromBase(b.area).toFixed(uArea.decimals)}${uArea.symbol}`);
        if (ic.branchResistance) dataLines.push(`R=${fmtR(b.resistance * 1000 / 9.81, uRes)}`);
        if (ic.branchVelocity && hasCalc) dataLines.push(`V=${uVel.fromBase(V).toFixed(uVel.decimals)}${uVel.symbol}${overV ? "⚠" : ""}`);
        if ((ic.branchFlow || ic.branchFlowCalc) && hasCalc) dataLines.push(`Q=${Qsign}${uFlow.fromBase(Q).toFixed(uFlow.decimals)}${uFlow.symbol}`);
        if (ic.branchDepression && hasCalc) dataLines.push(`Н=${uPres.fromBase(b.dP).toFixed(uPres.decimals)}${uPres.symbol}`);
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
      } else if (!isDead && !ic && hasCalc) {
        const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
        dataLines.push(`Q=${Qsign}${Q.toFixed(1)}`);
        if (b.velocity > 0) dataLines.push(`V=${b.velocity.toFixed(1)}`);
      }

      const allLines = showNum ? [branchNum, ...dataLines] : dataLines;
      if (allLines.length === 0) continue;

      ctx.save();
      ctx.globalAlpha = labelOpacity;

      if (Math.abs(lox) > 5 * objSF || Math.abs(loy + 16 * objSF) > 5 * objSF) {
        ctx.strokeStyle = "#555555"; ctx.lineWidth = 0.4 * objSF;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(midX, midY); ctx.lineTo(anchorX, anchorY); ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.translate(anchorX, anchorY);
      if (labelAng !== 0) ctx.rotate(labelAng);

      const branchPxLabel = (thinLines ? 1 : (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth)) * objSF;
      const textSc = Math.max(0.3, branchPxLabel * 0.28) * (b.labelSize ?? 1);
      const lh = 11 * textSc;
      const bh = allLines.length * lh + 4 * textSc;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";

      // Вычисляем оба размера шрифта заранее — ctx.font меняется только при смене размера
      const numFontSize = (branchNum.length > 2 ? 7.5 : 9) * textSc;
      const dataFontSize = 8.5 * textSc;
      const numFont  = `600 ${numFontSize}px "Segoe UI",sans-serif`;
      const dataFont = `600 ${dataFontSize}px "Segoe UI",sans-serif`;
      let lastFont = "";

      for (let li = 0; li < allLines.length; li++) {
        const ln = allLines[li];
        const ty = -bh / 2 + lh * (li + 0.6);
        const isNumLine = li === 0 && showNum;
        const font = isNumLine ? numFont : dataFont;
        if (font !== lastFont) { ctx.font = font; lastFont = font; }
        ctx.strokeStyle = "white"; ctx.lineWidth = 3 * textSc;
        ctx.strokeText(ln, 0, ty);
        ctx.fillStyle = isNumLine ? (isSel ? "#2563eb" : "#374151") : (overV ? "#dc2626" : "#1e3a5f");
        ctx.fillText(ln, 0, ty);
      }

      ctx.restore();
    }

    void ux; void uy;
  }

  // ── ПРОХОД 2b: трубопроводы поверх основных линий группы ──────────────────
  // Рисуем ПОСЛЕ всех основных линий этого горизонта, чтобы белые линии
  // соседних ветвей не перекрывали трубы (воздухопровод/водопровод/вентрубопровод)
  // в общих узлах. Внутри группы → z-order между горизонтами сохраняется.
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  for (const { b } of group) {
    const p = bParamsMap.get(b.id);
    if (!p) continue;
    const { w, ux, uy, segLen } = p;

    // ── Вентрубопровод — пунктирная линия параллельно ветви ──────────────
    if (b.hasVentPipe) {
      const nx = -uy, ny = ux;
      const vpOffset = w / 2 + 3;
      const vpX1 = p.fromSx + nx * vpOffset, vpY1 = p.fromSy + ny * vpOffset;
      const vpX2 = p.toSx   + nx * vpOffset, vpY2 = p.toSy   + ny * vpOffset;
      const vpW = Math.max(1.5, w * 0.35);
      ctx.strokeStyle = "white"; ctx.lineWidth = vpW + 2; ctx.globalAlpha = 0.6; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(vpX1, vpY1); ctx.lineTo(vpX2, vpY2); ctx.stroke();
      ctx.strokeStyle = "#0ea5e9"; ctx.lineWidth = vpW; ctx.globalAlpha = 0.9; ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(vpX1, vpY1); ctx.lineTo(vpX2, vpY2); ctx.stroke();
      ctx.setLineDash([]);
      if (segLen > 60 && view.scale > 0.3) {
        const mX = (vpX1 + vpX2) / 2, mY = (vpY1 + vpY2) / 2;
        const fs = Math.max(8, Math.min(12, w * 1.2));
        ctx.fillStyle = "#0ea5e9"; ctx.font = `bold ${fs}px Arial`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = 0.95;
        ctx.fillText("ВТ", mX, mY);
      }
    }

    // ── Трубопроводы у края ветви (под стрелкой направления воздуха) ──────
    // Синяя линия = водопровод ППЗ (у одного края),
    // красная линия = воздухопровод (сжатый воздух, у противоположного края).
    // Рисуем ЗДЕСЬ (до стрелки потока), чтобы стрелка была поверх труб — как в SVG-режиме.
    if (lodNodes && (b.hasWaterPipe || b.hasAirPipe)) {
      const nx = -uy, ny = ux;
      const pipeOffset = w * 0.38;
      const pipeLW = thinLines ? 1.5 : Math.max(1.5 * objSF, 1.0);
      ctx.lineCap = "round";
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      const drawEdgePipe = (sign: number, col: string) => {
        const ox = nx * pipeOffset * sign, oy = ny * pipeOffset * sign;
        ctx.strokeStyle = col;
        ctx.lineWidth = pipeLW;
        ctx.beginPath();
        ctx.moveTo(p.fromSx + ox, p.fromSy + oy);
        ctx.lineTo(p.toSx + ox, p.toSy + oy);
        ctx.stroke();
      };
      const showWaterPipes = !infoConfig || infoConfig.waterPipes;
      if (b.hasWaterPipe && showWaterPipes) {
        drawEdgePipe(+1, "#1d4ed8");
        // Стрелка направления течения воды (по центру трубы).
        // Расход берём из результата расчёта сети (wpComputedFlow backend'ом не заполняется).
        const showWaterDir = !infoConfig || infoConfig.waterFlowDirection;
        const wbrDir = waterBranchResults?.get(b.id);
        const wf = wbrDir ? (wbrDir.flow ?? 0) : (b.wpComputedFlow ?? 0);
        if (showWaterDir && Math.abs(wf) > 0.001) {
          // ВАЖНО: направление воды НЕ связано с воздухом. Единичный вектор
          // считаем геометрически по узлам from→to (ux,uy развёрнуты по воздуху),
          // затем разворачиваем по расчёту воды flowFromTo.
          const gdx = p.toSx - p.fromSx, gdy = p.toSy - p.fromSy;
          const glen = Math.hypot(gdx, gdy) || 1;
          const wux = gdx / glen, wuy = gdy / glen;
          const waterFromTo = wbrDir ? (wbrDir.flowFromTo !== false) : true;
          const dir = waterFromTo ? 1 : -1;
          const ox = nx * pipeOffset, oy = ny * pipeOffset;
          const mx = (p.fromSx + p.toSx) / 2 + ox;
          const my = (p.fromSy + p.toSy) / 2 + oy;
          const ah = Math.max(3, pipeLW * 2.2);
          const dux = wux * dir, duy = wuy * dir;
          // Хвостик (стержень) — от основания треугольника назад по потоку
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = Math.max(1, pipeLW);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(mx - dux * ah * 2.2, my - duy * ah * 2.2);
          ctx.lineTo(mx - dux * ah * 0.5, my - duy * ah * 0.5);
          ctx.stroke();
          ctx.fillStyle = "#dc2626";
          ctx.beginPath();
          ctx.moveTo(mx + dux * ah, my + duy * ah);
          ctx.lineTo(mx - dux * ah * 0.5 + nx * ah * 0.6, my - duy * ah * 0.5 + ny * ah * 0.6);
          ctx.lineTo(mx - dux * ah * 0.5 - nx * ah * 0.6, my - duy * ah * 0.5 - ny * ah * 0.6);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (b.hasAirPipe)   drawEdgePipe(-1, "#dc2626");
    }
  }
  // Сброс после подпрохода труб внутри слоя
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  } // конец цикла по слоям-горизонтам
  // Сброс после всех слоёв
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // ─── УЗЛЫ (идентично SVG-рендеру) ────────────────────────────────────────
  if (lodNodes) {
    // Кэш: узел → смежные ветви, строится за O(M) один раз вместо O(N×M) filter в цикле
    const nodeAdjBranchesMap = new Map<string, TopoBranch[]>();
    for (const b of branches) {
      for (const nid of [b.fromId, b.toId]) {
        let arr = nodeAdjBranchesMap.get(nid);
        if (!arr) { arr = []; nodeAdjBranchesMap.set(nid, arr); }
        arr.push(b);
      }
    }
    // O(1) при анимации — projNodes не меняется между кадрами
    const nodesSorted = getSortedNodes(projNodes, opts.sortEpoch);
    for (const pn of nodesSorted) {
      const n = pn.node;
      if (n.visible === false) continue;

      // Узел скрыт, если ВСЕ его ветви принадлежат скрытым горизонтам
      // (как в SVG-рендере). Узлы без ветвей остаются видимыми.
      if (hiddenBrIds.size > 0) {
        const nAdj = nodeAdjBranchesMap.get(n.id);
        if (nAdj && nAdj.length > 0 && nAdj.every((b) => hiddenBrIds.has(b.id))) continue;
      }

      const isSel = selectedNodeId === n.id || selectedNodeIds.has(n.id);
      const isMultiSel = selectedNodeIds.has(n.id);
      const isAtm = n.atmosphereLink;
      // O(1) вместо O(M) filter — берём из предварительно построенного Map
      const adjBranches = nodeAdjBranchesMap.get(n.id) ?? [];
      const adjAvgW = adjBranches.length > 0
        ? adjBranches.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBranches.length
        : branchWidth;
      const branchPx = (thinLines ? 1 : adjAvgW) * objSF;
      // Узел = половина ширины ветви, минимум 1.5px
      const baseNodeR = Math.max(1.5, branchPx * 0.55);
      const r = isSel ? baseNodeR * 1.5 : baseNodeR;
      const color = isAtm ? "#7dd3fc" : "#c8a882";
      const ringColor = isMultiSel ? "#f59e0b" : "#2563eb";

      ctx.save();

      // Основной круг
      const rawFireType = n.fireNodeType ?? "none";
      // Видимость водопроводных типов узлов управляется панелью информации.
      // Если соответствующий флаг выключен — узел рисуется как обычный (скрыт).
      const waterTypeVisible =
        rawFireType === "reservoir" ? (!infoConfig || infoConfig.waterReservoir)
      : rawFireType === "consumer"  ? (!infoConfig || infoConfig.waterConsumer)
      : rawFireType === "junction"  ? (!infoConfig || infoConfig.waterPipeJoint)
      : true;
      const fireType = waterTypeVisible ? rawFireType : "none";
      const hasFire = fireType !== "none";

      // Кольцо выделения — только для обычных узлов (fire-узлы рисуют своё внутри иконок)
      if (isSel && !hasFire) {
        ctx.beginPath(); ctx.arc(pn.sx, pn.sy, r + baseNodeR * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor; ctx.lineWidth = Math.min(2, Math.max(0.5, baseNodeR * 0.2));
        ctx.setLineDash([3, 2]); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Кольцо маршрута горноспасателей (зелёное) — под основным кружком узла
      if (rescuePathNodeIds?.has(n.id)) {
        ctx.beginPath(); ctx.arc(pn.sx, pn.sy, r + baseNodeR * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = "#16a34a"; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = "#15803d"; ctx.lineWidth = Math.max(0.8, baseNodeR * 0.25); ctx.stroke();
      }
      // Основной кружок — ТОЛЬКО для обычных узлов (как в SVG-рендере).
      // Водопроводные (fire-)узлы полностью рисуются своими иконками ниже
      // (резервуар / кран / соединение), поэтому лишний цветной кружок-маркер
      // под иконкой не рисуем — иначе он частично перекрывает узлы труб.
      if (!hasFire) {
        ctx.beginPath(); ctx.arc(pn.sx, pn.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.strokeStyle = isSel ? ringColor : "#1f2937";
        // Обводка = ~20% от радиуса, но не больше 2px и не меньше 0.5px
        ctx.lineWidth = Math.min(2, Math.max(0.5, baseNodeR * 0.25));
        ctx.fill(); ctx.stroke();
      }

      // ─── Иконка РЕЗЕРВУАРА С ВОДОЙ ────────────────────────────
      if (fireType === "reservoir" && sc > 0.025) {
        const IS = Math.max(4, baseNodeR * 2.5);
        const ix = pn.sx, iy = pn.sy;
        ctx.save();
        const hw = IS * 0.8, hh = IS * 0.6;
        const lw = Math.max(1, IS * 0.09);
        // Верхняя (пустая) половина
        ctx.fillStyle = "white";
        ctx.fillRect(ix - hw, iy - hh, hw * 2, hh);
        // Нижняя (вода) половина
        ctx.fillStyle = "#1d4ed8";
        ctx.fillRect(ix - hw, iy, hw * 2, hh);
        // Рамка
        ctx.strokeStyle = "#1d4ed8";
        ctx.lineWidth = lw;
        ctx.strokeRect(ix - hw, iy - hh, hw * 2, hh * 2);
        // Горизонтальная черта — уровень воды
        ctx.beginPath();
        ctx.moveTo(ix - hw, iy); ctx.lineTo(ix + hw, iy);
        ctx.stroke();
        if (isSel) {
          ctx.strokeStyle = ringColor; ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(ix - hw - 3, iy - hh - 3, (hw + 3) * 2, (hh + 3) * 2);
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // ─── Иконка ПОЖАРНОГО КРАНА ───────────────────────────────
      if (fireType === "consumer" && sc > 0.025) {
        const IS = Math.max(4, baseNodeR * 2.5);
        const ix = pn.sx, iy = pn.sy;
        ctx.save();
        const hydrantOpen = n.fireHydrantOpen ?? false;
        const cr = IS * 0.55;
        const earR = cr * 0.55;
        // SVG-иконка пожарного крана (красный/синий)
        // viewBox SVG = 21000×29700 (A4 portrait), соотношение сторон ~1:1.4143
        const { img, loaded } = getFireCraneImg(hydrantOpen);
        const sz = IS * 2.2;
        const svgAspect = 21000 / 29700; // ширина / высота viewBox
        const drawH = sz;
        const drawW = sz * svgAspect;
        if (loaded) {
          ctx.drawImage(img, ix - drawW / 2, iy - drawH / 2, drawW, drawH);
        } else {
          // Фолбэк — простой кружок пока SVG не загрузился
          const hydrantColor = hydrantOpen ? "#1d4ed8" : "#dc2626";
          ctx.beginPath(); ctx.arc(ix, iy, cr, 0, Math.PI * 2);
          ctx.fillStyle = "white"; ctx.strokeStyle = hydrantColor;
          ctx.lineWidth = Math.max(1.2, IS * 0.10);
          ctx.fill(); ctx.stroke();
        }
        if (isSel) {
          ctx.strokeStyle = ringColor; ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);
          // Круглое кольцо по краям выступов крана.
          // Символ расположен в центре A4: центр ~(10500, 16500) в viewBox 21000×29700.
          // Радиус выступов ~9125 по X → нормировано: 9125/21000 ≈ 0.4345 от drawW.
          // Смещение центра символа по Y: (16500/29700 - 0.5)*drawH ≈ +0.0556*drawH.
          const symCY = iy + (15800 / 29700 - 0.5) * drawH;
          const symR = (10900 / 21000) * drawW + 3;
          ctx.beginPath();
          ctx.arc(ix, symCY, symR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // ─── Маркер предупреждения ! на кране ─────────────────────
        if (hydrantOpen && waterNodeResults) {
          const res = waterNodeResults.get(n.id);
          if (res) {
            const MIN_P = 0.1;
            const req   = n.fireRequiredFlow ?? 0;
            const isErr = res.dynamicP > 0 && res.dynamicP < MIN_P;
            const isWrn = !isErr && req > 0 && res.flow < req * 0.9;
            if (isErr || isWrn) {
              const ox  = ix + cr + earR + 2;
              const oy  = iy - cr - earR - 2;
              const rs  = Math.max(4, IS * 0.45);
              const col = isErr ? "#dc2626" : "#d97706";
              ctx.save();
              ctx.beginPath(); ctx.arc(ox, oy, rs, 0, Math.PI * 2);
              ctx.fillStyle = col; ctx.fill();
              ctx.fillStyle = "white";
              ctx.font = `bold ${Math.round(rs * 1.2)}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText("!", ox, oy);
              ctx.restore();
            }
          }
        }

        ctx.restore();
      }

      // ─── Иконка СОЕДИНЕНИЯ ТРУБ ───────────────────────────────
      if (fireType === "junction" && sc > 0.025) {
        const IS = baseNodeR;
        const ix = pn.sx, iy = pn.sy;
        ctx.save();
        ctx.beginPath(); ctx.arc(ix, iy, IS, 0, Math.PI * 2);
        ctx.fillStyle = "white"; ctx.strokeStyle = "#7c3aed";
        ctx.lineWidth = Math.max(1, IS * 0.25);
        ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(ix, iy, IS * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = "#7c3aed"; ctx.fill();
        if (isSel) {
          ctx.strokeStyle = ringColor; ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);
          ctx.beginPath(); ctx.arc(ix, iy, IS + 4, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // Внутреннее кольцо для atmosphereLink (как SVG) — только для обычных узлов
      if (isAtm && !hasFire) {
        ctx.beginPath(); ctx.arc(pn.sx, pn.sy, Math.max(1.5, r * 0.55), 0, Math.PI * 2);
        ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 1]); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Метки узла (как SVG: смещение +8,-8, fontSize=9)
      const _scThresh = _xyScaleCR * 0.04;
      if (sc > _scThresh) {
        const ic = infoConfig;
        const nodeOpacity = Math.min(1, (sc - _scThresh) / (_scThresh * 1.5));
        const nlines: string[] = [];
        if (!ic) {
          if (n.name) nlines.push(n.name);
        } else {
          if (ic.nodeNumber && n.number) nlines.push(`${n.number}`);
        }
        // ─── Водопроводные показатели узла (управляются вкладкой «Водопровод») ───
        if (ic && rawFireType === "consumer") {
          const wr = waterNodeResults?.get(n.id);
          if (ic.waterDynamicPressure && wr && wr.dynamicP > 0)
            nlines.push(`Pд=${wr.dynamicP.toFixed(2)} МПа`);
          if (ic.waterFlow && wr && wr.flow > 0)
            nlines.push(`Q=${wr.flow.toFixed(1)} м³/ч`);
          if (ic.waterDeficit && wr) {
            const req = n.fireRequiredFlow ?? 0;
            const def = req - wr.flow;
            if (def > 0.05) nlines.push(`Δ=${def.toFixed(1)} м³/ч`);
          }
        }
        if (nlines.length > 0) {
          // Размер текста масштабируется как objSF, но с отдельными пределами textMin/Max
          const rawTextSF = printMode ? 1 : sc / (_xyScaleCR * 0.4);
          const textSF = printMode
            ? 1
            : fixedObjectScale && _sl
              ? Math.min(_sl.textMax / 100, Math.max(_sl.textMin / 100, rawTextSF))
              : Math.max(rawTextSF, 0.25);
          const fontSize = Math.max(6, Math.round(9 * textSF));
          ctx.font = `500 ${fontSize}px "Segoe UI",sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.globalAlpha = nodeOpacity;
          ctx.fillStyle = "#6b7280";
          const lineH = fontSize * 1.25;
          nlines.forEach((ln, li) => {
            ctx.fillText(ln, pn.sx + fontSize * 0.9, pn.sy - fontSize * 0.9 + (li + 1) * lineH);
          });
          ctx.globalAlpha = 1;
        }
      }

      // Буквенная метка узла горноспасателей: А — начальный, Б — целевой, В — промежуточный
      const rescueLetter = rescueNodeLetters?.get(n.id);
      if (rescueLetter) {
        const badgeR = Math.max(6, baseNodeR * 2.2);
        const bx = pn.sx, by = pn.sy - badgeR - r;
        const col = rescueLetter === "А" ? "#15803d" : rescueLetter === "Б" ? "#b91c1c" : "#b45309";
        ctx.beginPath(); ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = "white"; ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, badgeR * 0.18); ctx.stroke();
        ctx.fillStyle = col;
        ctx.font = `700 ${Math.round(badgeR * 1.4)}px "Segoe UI",sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(rescueLetter, bx, by + badgeR * 0.05);
      }

      ctx.restore();
    }
  }
}

// ─── Hit-тесты (переиспользуются из TopoCanvas) ────────────────────────────
export function hitNodeCanvas(
  sx: number, sy: number,
  projNodes: ProjNode[],
  r = 8,
): string | null {
  const r2 = r * r;
  for (let i = projNodes.length - 1; i >= 0; i--) {
    const p = projNodes[i];
    const dx = sx - p.sx, dy = sy - p.sy;
    if (dx * dx + dy * dy < r2) return p.node.id;
  }
  return null;
}

export function hitBranchCanvas(
  sx: number, sy: number,
  projNodesMap: Map<string, ProjNode>,
  branches: TopoBranch[],
  tol = 5,
): string | null {
  const tol2 = tol * tol;

  const distSqToSeg = (x1: number, y1: number, x2: number, y2: number): number => {
    const C = x2 - x1, D = y2 - y1;
    const lenSq2 = C * C + D * D;
    if (lenSq2 === 0) { const dx = sx - x1, dy = sy - y1; return dx * dx + dy * dy; }
    const t = Math.max(0, Math.min(1, ((sx - x1) * C + (sy - y1) * D) / lenSq2));
    const dx = sx - (x1 + t * C), dy = sy - (y1 + t * D);
    return dx * dx + dy * dy;
  };

  for (const b of branches) {
    const from = projNodesMap.get(b.fromId);
    const to   = projNodesMap.get(b.toId);
    if (!from || !to) continue;
    const C = to.sx - from.sx, D = to.sy - from.sy;
    const lenSq = C * C + D * D;
    if (lenSq === 0) continue;

    // 1. Попадание по основной линии ветви
    if (distSqToSeg(from.sx, from.sy, to.sx, to.sy) < tol2) return b.id;

    // 2. Попадание по параллельной линии вентрубы
    if (b.hasVentPipe) {
      const segLen = Math.sqrt(lenSq);
      const ux = C / segLen, uy = D / segLen;
      const nx = -uy, ny = ux;
      const vpOff = 4 / 2 + 3;
      const vx1 = from.sx + nx * vpOff, vy1 = from.sy + ny * vpOff;
      const vx2 = to.sx   + nx * vpOff, vy2 = to.sy   + ny * vpOff;
      if (distSqToSeg(vx1, vy1, vx2, vy2) < 7 * 7) return b.id;
    }
  }
  return null;
}