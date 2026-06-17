// ─────────────────────────────────────────────────────────────────────────────
// canvasRenderer.ts — Canvas 2D рендерер для больших схем (>CANVAS_THRESHOLD ветвей)
// Математика проекции полностью переиспользуется из topology.ts
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch, type Horizon, type ProjOptions, project3D, calcBranchLength } from "./topology";
import { type InfoDisplayConfig } from "./infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "./unitsConfig";
import { type WaterNodeResult } from "./waterHydraulics";

export const CANVAS_THRESHOLD = 800;

export type FlowDisplayMode = "off" | "flow" | "chevrons" | "both";



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
  is3D: boolean;
  zScale: number;
  zLevel: number;

  selectedBranchId: string | null;
  selectedBranchIds: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  hoverBranchId: string | null;

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
  /** Карта branchId → сегмент задымления {color, fromT, toT} (0..1 вдоль ветви) */
  branchFireColors?: Map<string, { color: string; fromT: number; toT: number }>;
  /** Карта branchId → зона поражения взрывом {hazardLevel} */
  branchExplosionColors?: Map<string, { color: string; hazardLevel: string }>;
  /** Режим цвета: none = по скорости, flowQ = по расходу */
  colorMode?: "none" | "flowQ";
  /** Карта branchId → цвет позиции внутри (ПЛА) */
  posInnerColors?: Map<string, string>;
  /** Карта branchId → цвет позиции снаружи (ПЛА) */
  posOuterColors?: Map<string, string>;
  /** Режим печати: белый фон без сетки */
  printMode?: boolean;
  /** Фиксированный размер объектов: ветви/узлы/текст не масштабируются при зуме */
  fixedObjectScale?: boolean;
  /** ID ветвей, загрязнённых воздухом (pollutesAir + все ниже по потоку) — стрелки синие */
  pollutedBranchIds?: Set<string>;
  /** ID ветвей, опрокинутых тепловой депрессией пожара — окрашиваются синим */
  reversedBranchIds?: Set<string>;
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
type SortedBranch = { b: TopoBranch; from: { sx: number; sy: number; depth: number; node: TopoNode } | undefined; to: { sx: number; sy: number; depth: number; node: TopoNode } | undefined; depth: number };
let _sortedBranchesCache: SortedBranch[] = [];
let _sortedBranchesKey: { visibleBranches: TopoBranch[]; projNodesMap: Map<string, unknown> } = { visibleBranches: [], projNodesMap: new Map() };

function getSortedBranches(
  visibleBranches: TopoBranch[],
  projNodesMap: Map<string, { sx: number; sy: number; depth: number; node: TopoNode }>,
): SortedBranch[] {
  if (_sortedBranchesKey.visibleBranches === visibleBranches && _sortedBranchesKey.projNodesMap === projNodesMap) {
    return _sortedBranchesCache;
  }
  _sortedBranchesKey = { visibleBranches, projNodesMap };
  _sortedBranchesCache = visibleBranches.map((b) => {
    const from = projNodesMap.get(b.fromId);
    const to   = projNodesMap.get(b.toId);
    const depth = from && to ? (from.depth + to.depth) / 2 : 0;
    return { b, from, to, depth };
  }).sort((a, b) => a.depth - b.depth);
  return _sortedBranchesCache;
}

type SortedNode = { node: TopoNode; sx: number; sy: number; depth: number };
let _sortedNodesCache: SortedNode[] = [];
let _sortedNodesKey: ProjNode[] | null = null;

function getSortedNodes(projNodes: ProjNode[]): SortedNode[] {
  if (_sortedNodesKey === projNodes) return _sortedNodesCache;
  _sortedNodesKey = projNodes;
  _sortedNodesCache = [...projNodes].sort((a, b) => a.depth - b.depth);
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
    horizonMap, infoConfig, unitsConfig, waterNodeResults, branchFireColors, branchExplosionColors,
    colorMode = "none", posInnerColors, posOuterColors, printMode = false,
    fixedObjectScale = false, pollutedBranchIds, reversedBranchIds,
    // Поля ниже сейчас не используются в рендере, но деструктурированы явно
    // чтобы при случайном обращении к ним не было ReferenceError.
    nodes: _nodes, horizons: _horizons, hiddenBranchIds: _hiddenBranchIds,
    zScale: _zScale, zLevel: _zLevel,
  } = opts;

  ctx.clearRect(0, 0, width, height);

  // ─── LOD пороги ───────────────────────────────────────────────────────────
  const sc = view.scale;
  // Коэффициент масштабирования объектов.
  // В режиме печати / fixedObjectScale — фиксированный размер (1).
  // В обычном режиме — пропорционально масштабу, но не меньше минимума
  // чтобы ветви и узлы были видимы при любом удалении (координаты могут быть в метрах → sc очень мал).
  const rawObjSF = (fixedObjectScale || printMode) ? 1 : sc / 0.4;
  // Минимальный objSF: ветвь всегда не менее 0.5px, при branchWidth=2 → objSF >= 0.25
  const objSF = Math.max(rawObjSF, 0.25);
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
  if (printMode) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  } else if (is3D) {
    ctx.fillStyle = "#f5f5f4";
    ctx.fillRect(0, 0, width, height);
    drawGrid3D(ctx, proj);
  } else {
    drawGrid2D(ctx, width, height, sc, view.offsetX, view.offsetY);
  }

  // ─── Сортировка ветвей по глубине (painter's algorithm) ───────────────────
  // Используем кэш: при анимации потока projNodesMap не меняется → O(1) вместо O(N log N)
  const sorted = getSortedBranches(visibleBranches, projNodesMap as Map<string, { sx: number; sy: number; depth: number; node: TopoNode }>);

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
  const defaultBranchColor = printMode ? "#333333" : "#ffffff";
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
      : (colorByHorizon && horizonColor) ? horizonColor
      : colorMode === "flowQ" ? (Q > 0 ? velocityColor(V) : defaultBranchColor)
      : posInnerColors ? (posInnerCol ?? defaultBranchColor)
      : colorMode === "none" ? defaultBranchColor
      : Q > 0    ? velocityColor(V)
      : defaultBranchColor;
    const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
    const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
    const baseW = isSel ? bw + 1 : bw;
    const w = (thinLines ? 1 : baseW) * objSF;
    const bwBorder = (thinLines || !lodBorder) ? 0 : Math.max(0, bb) * objSF;
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

  // ── ПРОХОД 1: только border (обводка) всех ветвей ─────────────────────────
  // Рисуем border отдельным проходом ДО всех fill, чтобы fill соседних ветвей
  // перекрывал торцы border — схема выглядит цельной без разрывов в узлах
  for (const { b } of sorted) {
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
    // Пожар — аура под border
    const fireSeg = branchFireColors?.get(b.id);
    if (fireSeg) {
      const { color: fireCol, fromT, toT } = fireSeg;
      const fsx = p.sxA + (p.sxB - p.sxA) * fromT, fsy = p.syA + (p.syB - p.syA) * fromT;
      const tsx = p.sxA + (p.sxB - p.sxA) * toT,   tsy = p.syA + (p.syB - p.syA) * toT;
      ctx.strokeStyle = fireCol;
      ctx.lineWidth = Math.max(p.w + 14, 8);
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(fsx, fsy); ctx.lineTo(tsx, tsy); ctx.stroke();
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
  // Сброс после прохода 1
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // ── ПРОХОД 2: fill + декор всех ветвей ────────────────────────────────────
  for (const { b } of sorted) {
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
      const fireSeg = branchFireColors?.get(b.id);
      if (fireSeg) {
        const { color: fireCol, fromT, toT } = fireSeg;
        const fsx = sxA + (sxB - sxA) * fromT, fsy = syA + (syB - syA) * fromT;
        const tsx = sxA + (sxB - sxA) * toT,   tsy = syA + (syB - syA) * toT;
        ctx.strokeStyle = fireCol;
        ctx.lineWidth = Math.max(w + 14, 8);
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(fsx, fsy); ctx.lineTo(tsx, tsy); ctx.stroke();
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

    // Основная линия
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.globalAlpha = flowVisible ? 0.55 : 1;
    ctx.setLineDash(isLeakage ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(p.fromSx, p.fromSy); ctx.lineTo(p.toSx, p.toSy); ctx.stroke();

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

    // Стрелки потока (F9)
    if (showFlowArrows && !thinLines && lodArrows && Q > 0.1 && segLen > 80 * objSF) {
      const stepA = 130 * objSF;
      const count = Math.max(1, Math.floor(segLen / stepA));
      const arrowLen = Math.min(28 * objSF, Math.max(16 * objSF, w * 4));
      const hw = arrowLen / 2;
      const tip = Math.max(3, 5 * objSF);
      const tipW = Math.max(2, 4 * objSF);
      const arrowColor = (pollutedBranchIds?.has(b.id) ?? false) ? "#2563eb" : "#dc2626";
      const arrowTailW = Math.max(0.5, objSF);
      const arrowTipW  = Math.max(0.3, 0.6 * objSF);
      ctx.save();
      ctx.setLineDash([]);
      for (let i = 0; i < count; i++) {
        const t0 = (i + 1) / (count + 1);
        ctx.save();
        ctx.translate(sxA + dx * t0, syA + dy * t0);
        ctx.rotate(angle);
        ctx.strokeStyle = arrowColor; ctx.lineWidth = arrowTailW; ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw - tip, 0); ctx.stroke();
        ctx.fillStyle = arrowColor; ctx.strokeStyle = "white"; ctx.lineWidth = arrowTipW;
        ctx.beginPath();
        ctx.moveTo(hw - tip, -tipW); ctx.lineTo(hw, 0); ctx.lineTo(hw - tip, tipW);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // Метки ветвей
    if (lodLabels) {
      const ic = (b.indicators && Object.keys(b.indicators).length > 0)
        ? { ...(infoConfig ?? {}), ...b.indicators } as typeof infoConfig
        : infoConfig;
      const labelOpacity = Math.min(1, (sc - 0.04) / 0.08);
      const branchNum = b.id.replace(/^B/, "");
      const hasCalc = (Q > 0 || b.velocity > 0) && !isDead;
      const showNum = !ic || ic.branchNumber;
      const lox = b.labelOffsetX ?? 0;
      const loy = b.labelOffsetY ?? -16;
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
      } else if (!isDead && !ic && hasCalc) {
        const Qsign = (b.fanReverse && b.hasFan) ? "−" : "";
        dataLines.push(`Q=${Qsign}${Q.toFixed(1)}`);
        if (b.velocity > 0) dataLines.push(`V=${b.velocity.toFixed(1)}`);
      }

      const allLines = showNum ? [branchNum, ...dataLines] : dataLines;
      if (allLines.length === 0) continue;

      ctx.save();
      ctx.globalAlpha = labelOpacity;

      if (Math.abs(lox) > 5 || Math.abs(loy + 16) > 5) {
        ctx.strokeStyle = "#555555"; ctx.lineWidth = 0.4 * objSF;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(midX, midY); ctx.lineTo(anchorX, anchorY); ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.translate(anchorX, anchorY);
      if (labelAng !== 0) ctx.rotate(labelAng);

      const branchPxLabel = (thinLines ? 1 : (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth)) * objSF;
      const textSc = Math.min(2.5, Math.max(0.3, branchPxLabel * 0.28)) * (b.labelSize ?? 1);
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

  // ─── ТРУБОПРОВОДЫ ППЗ (яркая синяя линия у края ветви) ─────────────────
  if (lodNodes) {
    ctx.save();
    for (const { b, from, to } of sorted) {
      if (!b.hasWaterPipe || !from || !to) continue;
      const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
      const w2 = thinLines ? 1 : bw;
      const ddx = to.sx - from.sx, ddy = to.sy - from.sy;
      const segL = Math.hypot(ddx, ddy);
      const nx = segL > 0 ? -ddy / segL : 0;
      const ny = segL > 0 ?  ddx / segL : 0;
      const offset = w2 * 0.38;
      const lx1 = from.sx + nx * offset, ly1 = from.sy + ny * offset;
      const lx2 = to.sx   + nx * offset, ly2 = to.sy   + ny * offset;
      ctx.strokeStyle = "#1d4ed8";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(lx1, ly1);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();

      // Маркер wpHasReducer убран — отображается через УО-символ valve_reduce (оверлей)
    }
    ctx.restore();
  }

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
    const nodesSorted = getSortedNodes(projNodes);
    for (const pn of nodesSorted) {
      const n = pn.node;
      if (n.visible === false) continue;

      const isSel = selectedNodeId === n.id || selectedNodeIds.has(n.id);
      const isMultiSel = selectedNodeIds.has(n.id);
      const isAtm = n.atmosphereLink;
      // O(1) вместо O(M) filter — берём из предварительно построенного Map
      const adjBranches = nodeAdjBranchesMap.get(n.id) ?? [];
      const adjAvgW = adjBranches.length > 0
        ? adjBranches.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBranches.length
        : branchWidth;
      const branchPx = (thinLines ? 1 : adjAvgW) * objSF;
      const baseNodeR = Math.min(10, Math.max(1.5, branchPx * 0.55));
      const r = isSel ? baseNodeR * 1.5 : baseNodeR;
      const color = isAtm ? "#7dd3fc" : "#c8a882";
      const ringColor = isMultiSel ? "#f59e0b" : "#2563eb";

      ctx.save();

      // Основной круг
      const fireType = n.fireNodeType ?? "none";
      const hasFire = fireType !== "none";

      // Кольцо выделения — только для обычных узлов (fire-узлы рисуют своё внутри иконок)
      if (isSel && !hasFire) {
        ctx.beginPath(); ctx.arc(pn.sx, pn.sy, r + baseNodeR * 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor; ctx.lineWidth = Math.min(2, Math.max(0.5, baseNodeR * 0.2));
        ctx.setLineDash([3, 2]); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Для fire-узлов иконка заменяет кружок — рисуем маленький кружок только как маркер центра
      const consumerColor = (n.fireHydrantOpen ?? false) ? "#1d4ed8" : "#dc2626";
      const nodeColor = fireType === "reservoir" ? "#1d4ed8"
                      : fireType === "consumer"  ? consumerColor
                      : fireType === "junction"  ? "#7c3aed"
                      : color;
      ctx.beginPath(); ctx.arc(pn.sx, pn.sy, hasFire ? Math.min(r, baseNodeR * 0.5) : r, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.strokeStyle = isSel ? ringColor : (hasFire ? nodeColor : "#1f2937");
      // Обводка = ~20% от радиуса, но не больше 2px и не меньше 0.5px
      ctx.lineWidth = Math.min(2, Math.max(0.5, baseNodeR * 0.25));
      ctx.fill(); ctx.stroke();

      // ─── Иконка РЕЗЕРВУАРА С ВОДОЙ ────────────────────────────
      if (fireType === "reservoir" && sc > 0.025) {
        const IS = Math.min(24, Math.max(4, baseNodeR * 2.5));
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
      // Закрыт → красный, открыт → синий с заливкой
      if (fireType === "consumer" && sc > 0.025) {
        const IS = Math.min(24, Math.max(4, baseNodeR * 2.5));
        const ix = pn.sx, iy = pn.sy;
        ctx.save();
        const hydrantOpen = n.fireHydrantOpen ?? false;
        const hydrantColor = hydrantOpen ? "#1d4ed8" : "#dc2626";
        const fillColor = hydrantOpen ? "#bfdbfe" : "white";
        const cr = IS * 0.55;
        const earR = cr * 0.55;
        const lw = Math.max(1.2, IS * 0.10);
        // Левое ухо
        ctx.beginPath(); ctx.arc(ix - cr * 1.1, iy, earR, 0, Math.PI * 2);
        ctx.fillStyle = fillColor; ctx.strokeStyle = hydrantColor; ctx.lineWidth = lw;
        ctx.fill(); ctx.stroke();
        // Правое ухо
        ctx.beginPath(); ctx.arc(ix + cr * 1.1, iy, earR, 0, Math.PI * 2);
        ctx.fillStyle = fillColor; ctx.strokeStyle = hydrantColor; ctx.lineWidth = lw;
        ctx.fill(); ctx.stroke();
        // Основной кружок
        ctx.beginPath(); ctx.arc(ix, iy, cr, 0, Math.PI * 2);
        ctx.fillStyle = fillColor; ctx.strokeStyle = hydrantColor; ctx.lineWidth = lw;
        ctx.fill(); ctx.stroke();
        if (isSel) {
          ctx.strokeStyle = ringColor; ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 2]);
          ctx.beginPath(); ctx.arc(ix, iy, cr + earR + 3, 0, Math.PI * 2); ctx.stroke();
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
        const IS = Math.min(12, Math.max(2, baseNodeR * 1.8));
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

      // Внутреннее кольцо для atmosphereLink (как SVG)
      if (isAtm) {
        ctx.beginPath(); ctx.arc(pn.sx, pn.sy, Math.max(1.5, r * 0.55), 0, Math.PI * 2);
        ctx.strokeStyle = "#1f2937"; ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 1]); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Метки узла (как SVG: смещение +8,-8, fontSize=9)
      if (sc > 0.08) {
        const ic = infoConfig;
        const nodeOpacity = Math.min(1, (sc - 0.08) / 0.12);
        const nlines: string[] = [];
        if (!ic) {
          if (n.name) nlines.push(n.name);
        } else {
          if (ic.nodeNumber && n.number) nlines.push(`${n.number}`);
        }
        if (nlines.length > 0) {
          ctx.font = `500 9px "Segoe UI",sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.globalAlpha = nodeOpacity;
          ctx.fillStyle = "#6b7280";
          nlines.forEach((ln, li) => {
            ctx.fillText(ln, pn.sx + 8, pn.sy - 8 + (li + 1) * 11);
          });
          ctx.globalAlpha = 1;
        }
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