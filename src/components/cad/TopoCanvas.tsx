import { useEffect, useRef, useState, useCallback } from "react";
import {
  type TopoNode, type TopoBranch, type ProjOptions, type ViewPreset, type WorkPlane,
  type Horizon,
  project3D, unproject2D, unprojectToPlane, calcBranchLength, VIEW_PRESETS, autoWorkPlane,
} from "@/lib/topology";
import { LEGEND_TYPES } from "@/lib/schemaSymbols";

// ─────────────────────────────────────────────────────────────────────────────
// Интерактивный CAD-холст для построения топологии
// 2D (план) + 3D с произвольным ракурсом
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Восстановить конкретный вид (при открытии файла с сохранённым view) */
  restoreView?: { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number } | null;
  /** Колбэк: сообщать наружу текущий полный вид (для сохранения в файл) */
  onViewStateChange?: (v: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number }) => void;
  /** ID горизонта, у которого можно редактировать подложку (тащить углы). */
  editingHorizonImageId?: string | null;
  /** Колбэк изменения углов подложки горизонта (после drag). */
  onHorizonImageBoundsChange?: (horizonId: string, bounds: { x1: number; y1: number; x2: number; y2: number }) => void;
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
  /** Условные обозначения на схеме */
  schemaSymbols?: { id: string; typeId: string; x: number; y: number; branchId: string | null; t?: number; offsetX?: number; offsetY?: number; scale?: number; label?: string; description?: string; airDirection?: "forward" | "reverse"; appearYear?: number; appearMonth?: string; appearDay?: number }[];
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
  /** Клик на символ (для открытия свойств) */
  onSymbolClick?: (id: string) => void;
  /** Масштаб символа (delta: +0.2 или -0.2) */
  onSymbolScale?: (id: string, delta: number) => void;
  /** Удаление символа */
  onSymbolDelete?: (id: string) => void;
  /** Активный тип символа для инструмента "symbol" */
  activeSymbolTypeId?: string | null;
  /** Размещение символа на ветви/точке (tool=symbol, клик на ветвь) */
  onSymbolPlace?: (typeId: string, x: number, y: number, branchId: string | null) => void;
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
    horizons, branchWidth = 2.5, branchBorder = 0, thinLines = false,
    colorByHorizon = false, showFlowArrows = false,
    scaleOverride, onScaleChange, fitToScreenNonce,
    editingHorizonImageId, onHorizonImageBoundsChange,
    onNodeContextMenu, onBranchContextMenu, onCanvasContextMenu,
    selectedBranchIds, onBranchMultiSelect,
    infoConfig, zScale = 1,
    schemaSymbols = [], onSelectSymbol, selectedSymbolId, onSymbolMove,
    onSymbolMoveAlongBranch, onSymbolOffset, onSymbolClick,
    onSymbolScale, onSymbolDelete,
    activeSymbolTypeId, onSymbolPlace,
    restoreView, onViewStateChange,
  } = props;

  // Карта горизонтов по id (для быстрых lookups)
  const horizonMap = (() => {
    const m = new Map<string, Horizon>();
    (horizons ?? []).forEach((h) => m.set(h.id, h));
    return m;
  })();
  // Видимые ветви: если горизонт привязан и скрыт — фильтруем
  const visibleBranches = branches.filter((b) => {
    if (!b.horizonId) return true;
    const h = horizonMap.get(b.horizonId);
    return !h || h.visible;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Видовые параметры (panning + zoom + rotate)
  const [view, setView] = useState<ViewState>({
    scale: 0.4, offsetX: 400, offsetY: 300,
    azimuth: 0, elevation: 90,    // план по умолчанию
  });

  const is3D = view.elevation < 89.5 || view.azimuth !== 0;

  const [panStart, setPanStart] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [rotStart, setRotStart] = useState<{ x: number; y: number; az: number; el: number } | null>(null);
  const [draggingNode, setDraggingNode] = useState<{ id: string; plane: WorkPlane } | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [hoverBranchId, setHoverBranchId] = useState<string | null>(null);

  // Перетаскивание угла подложки горизонта: какой именно угол тащим.
  const [draggingCorner, setDraggingCorner] = useState<
    { horizonId: string; corner: "tl" | "tr" | "bl" | "br" } | null
  >(null);

  // При смене инструмента сбрасываем «начало ветви» — иначе возникнут призрачные сегменты.
  useEffect(() => { setBranchFrom(null); }, [tool]);

  // ─── ВОССТАНОВЛЕНИЕ СОХРАНЁННОГО ВИДА ───────────────────────────────
  useEffect(() => {
    if (!restoreView) return;
    setView((v) => ({
      scale: restoreView.scale ?? v.scale,
      offsetX: restoreView.offsetX ?? v.offsetX,
      offsetY: restoreView.offsetY ?? v.offsetY,
      azimuth: restoreView.azimuth ?? v.azimuth,
      elevation: restoreView.elevation ?? v.elevation,
    }));
     
  }, [restoreView]);

  // ─── РЕПОРТИНГ ТЕКУЩЕГО ВИДА НАРУЖУ (для сохранения) ────────────────
  useEffect(() => {
    onViewStateChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale, view.offsetX, view.offsetY, view.azimuth, view.elevation]);

  // ─── СИНХРОНИЗАЦИЯ ВНЕШНЕГО МАСШТАБА ────────────────────────────────
  // scaleOverride используется ТОЛЬКО для внешних команд (ввод в поле, fitToScreen).
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
    // Проецируем узлы при масштабе 1 и offset(0,0) — получаем "мировые экранные" координаты
    const tmpProj: ProjOptions = {
      scale: 1, offsetX: 0, offsetY: 0,
      azimuth: view.azimuth, elevation: view.elevation, zScale,
    };
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    nodes.forEach((n) => {
      const p = project3D({ x: n.x, y: n.y, z: n.z * (zScale ?? 1) }, tmpProj);
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
    const newScale = Math.max(0.002, Math.min(500, Math.min(scaleX, scaleY)));
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Флаг: после применения пресета вписать схему в экран
  const fitAfterPresetRef = useRef(false);

  // Применение пресета ракурса извне
  useEffect(() => {
    if (!viewPreset) return;
    const p = VIEW_PRESETS[viewPreset.name];
    fitAfterPresetRef.current = true; // вписать после смены угла
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
      const p = project3D({ x: n.x, y: n.y, z: n.z * (zScale ?? 1) }, tmpProj);
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

  const proj: ProjOptions = {
    scale: view.scale,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    azimuth: view.azimuth,
    elevation: view.elevation,
    zScale,
  };

  // zScale применяем к Z-координате перед проекцией
  const projectWithZ = (p: { x: number; y: number; z: number }) =>
    project3D({ ...p, z: p.z * (zScale ?? 1) }, proj);

  const projNodes = nodes.map((n) => ({ node: n, ...projectWithZ(n) }));

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
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hitN = hitNode(sx, sy, projNodes);
    if (hitN) {
      onSelectNode(hitN);
      onSelectBranch(null);
      onNodeContextMenu?.(hitN, e.clientX, e.clientY);
      return;
    }
    const hitB = hitBranch(sx, sy, projNodes, branches);
    if (hitB) {
      onSelectBranch(hitB);
      onSelectNode(null);
      onBranchContextMenu?.(hitB, e.clientX, e.clientY);
      return;
    }
    onCanvasContextMenu?.(e.clientX, e.clientY);
  };

  // ─── Обработчики мыши ───────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Правая кнопка или tool=rotate → вращение в 3D
    if (e.button === 2 || tool === "rotate") {
      setRotStart({ x: e.clientX, y: e.clientY, az: view.azimuth, el: view.elevation });
      e.preventDefault();
      return;
    }
    // Средняя кнопка / Shift / tool=pan → панорама
    if (e.button === 1 || e.shiftKey || tool === "pan") {
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
      e.preventDefault();
      return;
    }

    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const hitN = hitNode(sx, sy, projNodes);
    const hitB = !hitN ? hitBranch(sx, sy, projNodes, branches) : null;

    // ─── ИНСТРУМЕНТ «СИМВОЛ» — клик на ветвь = размещает символ посередине ─
    if (tool === "symbol" && activeSymbolTypeId && onSymbolPlace) {
      if (hitB) {
        // Размещаем на середине ветви
        const fromN = projNodes.find(p => p.node.id === branches.find(b => b.id === hitB)?.fromId)?.node;
        const toN   = projNodes.find(p => p.node.id === branches.find(b => b.id === hitB)?.toId)?.node;
        if (fromN && toN) {
          onSymbolPlace(activeSymbolTypeId, (fromN.x + toN.x) / 2, (fromN.y + toN.y) / 2, hitB);
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
      onSelectNode(hitN);
      onSelectBranch(null);
      // Перетаскивание узла: и в 2D, и в 3D.
      const node = nodes.find((n) => n.id === hitN);
      if (node) {
        // zScale применяется к Z при проекции → plane.value тоже должен учитывать zScale
        const zv = node.z * (zScale ?? 1);
        const plane: WorkPlane = !is3D
          ? { axis: "z", value: zv }
          : effPlane.axis === "z" ? { axis: "z", value: zv }
          : effPlane.axis === "y" ? { axis: "y", value: node.y }
          : { axis: "x", value: node.x };
        setDraggingNode({ id: hitN, plane });
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
    // Свободный клик в 3D = вращение, в 2D = панорама
    if (is3D) {
      setRotStart({ x: e.clientX, y: e.clientY, az: view.azimuth, el: view.elevation });
    } else {
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
    }
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // hover-позиция: показываем мировые координаты в текущей рабочей плоскости
    const w = screenToWorld(sx, sy);
    if (w) setHoverPos({ x: Math.round(w.x), y: Math.round(w.y) });
    else setHoverPos(null);

    // Подсветка ветви при tool=symbol
    if (tool === "symbol") {
      const hb = hitBranch(sx, sy, projNodes, branches);
      setHoverBranchId(hb ?? null);
    } else if (hoverBranchId) {
      setHoverBranchId(null);
    }

    if (rotStart) {
      const dx = e.clientX - rotStart.x;
      const dy = e.clientY - rotStart.y;
      const newAz = rotStart.az + dx * 0.5;     // 0.5°/px
      const newEl = Math.max(0, Math.min(90, rotStart.el - dy * 0.5));
      setView((v) => ({ ...v, azimuth: newAz, elevation: newEl }));
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
      onNodeMove(draggingNode.id, Math.round(wp.x), Math.round(wp.y), Math.round(zWorld));
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
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const raw = e.deltaY;
    const delta = e.deltaMode === 1 ? raw * 30 : e.deltaMode === 2 ? raw * 300 : raw;
    // Плавный зум: фактор пропорционален величине delta, ограничен за один шаг
    const step = Math.min(Math.abs(delta) / 120, 3);
    const base = 1 + 0.12 * step;
    const factor = delta > 0 ? 1 / base : base;
    setView((v) => {
      const newScale = Math.max(0.002, Math.min(500, v.scale * factor));
      const wx = (px - v.offsetX) / v.scale;
      const wy = (py - v.offsetY) / v.scale;
      const newView = {
        ...v,
        scale: newScale,
        offsetX: px - wx * newScale,
        offsetY: py - wy * newScale,
      };
      prevScaleOverride.current = newScale;
      if (onScaleChange) onScaleChange(newScale);
      return newView;
    });
  };

  // ─── Вспомогательные ────────────────────────────────────────────────────
  const zColor = (z: number) => {
    const minZ = -300, maxZ = 0;
    const t = Math.max(0, Math.min(1, (z - minZ) / (maxZ - minZ)));
    const hue = 220 - t * 180;
    return `hsl(${hue}, 70%, 50%)`;
  };

  // Сортировка ветвей по средней глубине (painter's алгоритм)
  // Только видимые: ветви скрытых горизонтов выпадают из рендера.
  const branchesSorted = [...visibleBranches].map((b) => {
    const from = projNodes.find((p) => p.node.id === b.fromId);
    const to = projNodes.find((p) => p.node.id === b.toId);
    const depth = from && to ? (from.depth + to.depth) / 2 : 0;
    return { branch: b, depth };
  }).sort((a, b) => a.depth - b.depth);

  const nodesSorted = [...projNodes].sort((a, b) => a.depth - b.depth);

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

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden"
      style={{
        background: is3D ? "linear-gradient(to bottom, #f0f4f8 0%, #ffffff 60%, #f5f5f5 100%)" : "#ffffff",
        cursor: rotStart ? "grabbing" : panStart ? "grabbing"
          : tool === "node" ? "crosshair"
          : tool === "symbol" ? "copy"
          : tool === "rotate" ? "grab"
          : tool === "pan" ? "grab" : "default",
      }}>

      <svg width={size.w} height={size.h}
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

        {!is3D && view.scale >= 0.5 && <rect width={size.w} height={size.h} fill="url(#topo-grid-major)" />}
        {!is3D && view.scale < 0.5 && <rect width={size.w} height={size.h} fill="#f8f9fa" />}
        {is3D && renderGroundGrid()}



        {is3D && (tool === "node" || tool === "branch") && renderWorkPlane()}

        {/* ── ПОДЛОЖКИ ГОРИЗОНТОВ (PNG/JPG) ─────────────────────────────── */}
        {/* Рисуются ПОД ветвями. Видимость подложки = h.image.visible && h.visible */}
        {(horizons ?? []).map((h) => {
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
        {editingHorizonImageId && (() => {
          const h = (horizons ?? []).find((hh) => hh.id === editingHorizonImageId);
          if (!h || !h.image) return null;
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
        {branchesSorted.map(({ branch: b }) => {
          const from = projNodes.find((p) => p.node.id === b.fromId);
          const to = projNodes.find((p) => p.node.id === b.toId);
          if (!from || !to) return null;
          const isSel = selectedBranchId === b.id || (selectedBranchIds?.has(b.id) ?? false);
          const isMultiSel = selectedBranchIds?.has(b.id) ?? false;
          const reversed = b.flow < 0;
          // Координаты «начала потока» → «конца потока»
          const sxA = reversed ? to.sx : from.sx;
          const syA = reversed ? to.sy : from.sy;
          const sxB = reversed ? from.sx : to.sx;
          const syB = reversed ? from.sy : to.sy;
          const midX = (from.sx + to.sx) / 2;
          const midY = (from.sy + to.sy) / 2;
          const len = b.length || Math.round(calcBranchLength(from.node, to.node));
          const Q = Math.abs(b.flow);
          const V = b.velocity;
          const overV = V > b.vMax;
          // ─── ЦВЕТ ВЕТВИ ──────────────────────────────────────────
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
          const horizonColor = b.horizonId ? horizonMap.get(b.horizonId)?.color : undefined;
          const color = isSel ? (isMultiSel ? "#f59e0b" : "#2563eb")
            : isDead ? "#9ca3af"
            : overV ? "#dc2626"
            : (colorByHorizon && horizonColor) ? horizonColor
            : Q > 0 ? velocityColor(V)
            : "#9ca3af";

          // ─── ТОЛЩИНА ЛИНИИ ───────────────────────────────────────
          const bw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
          const bb = (b.lineBorder !== undefined && b.lineBorder >= 0) ? b.lineBorder : branchBorder;
          const baseW = isSel ? bw + 1 : bw;
          const w = thinLines ? 1 : baseW;
          // Обводка (контур вокруг линии): ширина = w + 2*border
          const borderW = thinLines ? 0 : Math.max(0, bb);
          const flowVisible = !thinLines && Q > 0.1 && flowDisplay !== "off" && !isDead;
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

          return (
            <g key={b.id}>
              {/* Подсветка ветви при tool=symbol hover */}
              {hoverBranchId === b.id && (
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke="#f59e0b" strokeWidth={w + 8} strokeLinecap="round" opacity="0.35" />
              )}
              {/* Контурная обводка (рисуется ПОД основной линией, шире на 2*borderW) */}
              {borderW > 0 && (
                <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                  stroke="#1f2937" strokeWidth={w + borderW * 2}
                  strokeLinecap="round" opacity="0.85" />
              )}
              {/* Подложка — статичная линия (всегда от fromId к toId, цвет = тип) */}
              <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke={color} strokeWidth={w} strokeLinecap="round" opacity={flowVisible ? 0.55 : 1} />

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

              {/* ── Стрелки направления свежей струи (F9, после расчёта) ── */}
              {/* Полноценные стрелки с хвостиком (─►), как в АэроСеть */}
              {showFlowArrows && !thinLines && Q > 0.1 && segLen > 80 && (() => {
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
                          {/* Хвостик — линия */}
                          <line x1={-hw} y1={0} x2={hw - 6} y2={0}
                            stroke="#dc2626" strokeWidth={Math.max(1.5, w * 0.7)}
                            strokeLinecap="round" />
                          {/* Наконечник — треугольник */}
                          <polygon points={`${hw - 9},-5 ${hw},0 ${hw - 9},5`}
                            fill="#dc2626" stroke="white" strokeWidth="0.8"
                            strokeLinejoin="round" />
                        </g>
                      );
                    })}
                  </g>
                );
              })()}


              {view.scale > 0.04 && (() => {
                const ic = infoConfig;
                const labelOpacity = Math.min(1, (view.scale - 0.04) / 0.08);
                // Порядковый номер ветви (1, 2, 3...) из ID вида "B1"
                const branchNum = b.id.replace(/^B/, "");
                const hasCalc = (Q > 0 || b.velocity > 0) && !isDead;

                // Кружок с номером ветви — всегда (если branchNumber включён или нет infoConfig)
                const showCircle = !ic || ic.branchNumber;
                const circleR = 10;

                // Метки параметров после расчёта (Q и V) — рядом с ветвью, не при клике
                const dataLines: string[] = [];
                if (isDead) {
                  // тупиковая ветвь — ничего не показываем
                } else if (ic) {
                  if (ic.branchName && b.type) dataLines.push(b.type);
                  if (ic.branchLength) dataLines.push(`L=${len}м`);
                  if (ic.branchAngle) dataLines.push(`A=${(b.angle ?? 0).toFixed(1)}°`);
                  if (ic.branchSection) dataLines.push(`S=${b.area.toFixed(1)}м²`);
                  if (ic.branchResistance) dataLines.push(`R=${(b.resistance * 1e3).toFixed(2)}·10⁻³`);
                  if (ic.branchVelocity && hasCalc) dataLines.push(`V=${b.velocity.toFixed(1)}м/с${overV ? "⚠" : ""}`);
                  if ((ic.branchFlow || ic.branchFlowCalc) && hasCalc) dataLines.push(`Q=${Q.toFixed(1)}м³/с`);
                  if (ic.branchDepression && hasCalc) dataLines.push(`Н=${(b.dP / 10).toFixed(1)}даПа`);
                } else if (hasCalc) {
                  // Без infoConfig: только результаты расчёта компактно
                  dataLines.push(`Q=${Q.toFixed(1)}`);
                  if (b.velocity > 0) dataLines.push(`V=${b.velocity.toFixed(1)}`);
                }

                const lh = 10;
                const bh = dataLines.length * lh + 4;
                const bwBox = Math.max(44, dataLines.reduce((mx, s) => Math.max(mx, s.length * 5.2), 0) + 8);
                // Смещение: кружок влево от середины, данные справа
                const offsetY = -16;

                return (
                  <g transform={`translate(${midX},${midY})`} opacity={labelOpacity}>
                    {showCircle && (
                      <g transform={`translate(0,${offsetY})`}>
                        <circle r={circleR} fill="white" stroke={isSel ? "#2563eb" : "#374151"} strokeWidth={isSel ? 1.5 : 1} />
                        <text textAnchor="middle" dominantBaseline="middle"
                          fontSize={branchNum.length > 2 ? "7" : "9"}
                          fontWeight="600"
                          fill={isSel ? "#2563eb" : "#111827"}>
                          {branchNum}
                        </text>
                      </g>
                    )}
                    {dataLines.length > 0 && (
                      <g transform={`translate(${circleR + 4 + bwBox / 2},${offsetY})`}>
                        <rect x={-bwBox / 2} y={-bh / 2} width={bwBox} height={bh} rx="2"
                          fill="white" stroke="#d1d5db" strokeWidth="0.7" opacity="0.93" />
                        {dataLines.map((ln, li) => (
                          <text key={li} textAnchor="middle" dominantBaseline="middle"
                            y={-bh / 2 + lh * (li + 0.6)}
                            fontSize="8.5"
                            fontWeight="500"
                            fill={overV ? "#dc2626" : "#1f2937"}>
                            {ln}
                          </text>
                        ))}
                      </g>
                    )}
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Превью создания ветви */}
        {tool === "branch" && branchFrom && hoverPos && (() => {
          const from = projNodes.find((p) => p.node.id === branchFrom);
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

        {/* ─── УСЛОВНЫЕ ОБОЗНАЧЕНИЯ НА СХЕМЕ ──────────────────────────── */}
        {schemaSymbols.map(sym => {
          const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
          if (!lt) return null;

          let basePx: number, basePy: number;
          let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;

          if (sym.branchId) {
            const br = branches.find(b => b.id === sym.branchId);
            const fN = br ? projNodes.find(p => p.node.id === br.fromId) : null;
            const tN = br ? projNodes.find(p => p.node.id === br.toId) : null;
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

          const isSel = selectedSymbolId === sym.id;
          const sc = sym.scale ?? 1;
          const SZ = Math.round(32 * sc);
          const HX = px - SZ / 2;
          const HY = py - SZ / 2 - 4;

          return (
            <g key={sym.id}
              style={{ cursor: tool === "select" ? "move" : undefined }}
              onClick={(e) => {
                if (tool !== "select") return;
                e.stopPropagation();
                onSelectSymbol?.(isSel ? null : sym.id);
                onSymbolClick?.(sym.id);
              }}
              onContextMenu={(e) => {
                if (tool !== "select") return;
                e.preventDefault();
                e.stopPropagation();
                onSelectSymbol?.(sym.id);
              }}
              onMouseDown={(e) => {
                if (e.button !== 0 || tool !== "select") return;
                e.stopPropagation();

                const startX = e.clientX, startY = e.clientY;

                if (sym.branchId && hasBranchPts) {
                  const brLen2 = (tsx2 - fsx) ** 2 + (tsy2 - fsy) ** 2;
                  const brLen = Math.sqrt(brLen2);
                  const origOx = sym.offsetX ?? 0;
                  const origOy = sym.offsetY ?? 0;
                  const svgRect = (e.currentTarget as SVGElement).closest("svg")!.getBoundingClientRect();

                  const onMove = (me: MouseEvent) => {
                    const dx = me.clientX - startX;
                    const dy = me.clientY - startY;
                    const mx = me.clientX - svgRect.left - (sym.offsetX ?? 0);
                    const my = me.clientY - svgRect.top - (sym.offsetY ?? 0);

                    if (me.ctrlKey || me.altKey) {
                      // Ctrl/Alt+drag = смещение в любом направлении
                      onSymbolOffset?.(sym.id, origOx + dx, origOy + dy);
                    } else {
                      // Обычный drag = перемещение вдоль ветви
                      if (brLen2 < 1) return;
                      const raw = ((mx - fsx) * (tsx2 - fsx) + (my - fsy) * (tsy2 - fsy)) / brLen2;
                      const t = Math.max(0.05, Math.min(0.95, raw));
                      onSymbolMoveAlongBranch?.(sym.id, t);
                      // Сохраняем текущий offset
                    }
                    void brLen;
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                } else if (!sym.branchId) {
                  // Свободный символ — обычный drag
                  const origX = sym.x, origY = sym.y;
                  const onMove = (me: MouseEvent) => {
                    const dx = (me.clientX - startX) / view.scale;
                    const dy = -(me.clientY - startY) / view.scale;
                    onSymbolMove?.(sym.id, origX + dx, origY + dy);
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }
              }}>
              {/* Рамка выделения (без кнопок — управление в панели свойств) */}
              {isSel && (
                <rect x={HX - 4} y={HY - 4} width={SZ + 8} height={SZ + 8}
                  fill="none" stroke="#2563eb" strokeWidth="1.5" rx="3" />
              )}
              {/* SVG-символ */}
              <svg x={HX} y={HY} width={SZ} height={SZ} viewBox="0 0 48 40"
                overflow="visible"
                dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
              {/* Стрелка направления воздуха на символе вентилятора */}
              {sym.typeId === "fan" && sym.branchId && hasBranchPts && (() => {
                const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
                const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
                const arrowAngle = sym.airDirection === "reverse"
                  ? brAngle + 180 : brAngle;
                const cx2 = px, cy2 = py + SZ * 0.55;
                const aLen = Math.max(SZ * 0.45, 12);
                return (
                  <g transform={`translate(${cx2},${cy2}) rotate(${arrowAngle})`}>
                    <line x1={-aLen / 2} y1={0} x2={aLen / 2 - 5} y2={0}
                      stroke="#dc2626" strokeWidth={Math.max(1.5, SZ / 20)} strokeLinecap="round" />
                    <polygon points={`${aLen / 2 - 8},-4 ${aLen / 2},0 ${aLen / 2 - 8},4`}
                      fill="#dc2626" stroke="white" strokeWidth="0.6" />
                  </g>
                );
              })()}
              {/* Подпись: описание или label или название */}
              {view.scale > 0.06 && (
                <text x={px} y={HY + SZ + 11} textAnchor="middle"
                  fontSize={Math.round(9 * sc)} fill="#374151" fontFamily="Segoe UI, sans-serif"
                  opacity={Math.min(1, (view.scale - 0.06) / 0.06)}>
                  {sym.description || sym.label || lt.name}
                </text>
              )}
            </g>
          );
        })}

        {/* ─── УЗЛЫ (отсортированы по глубине, ближние сверху) ─────────── */}
        {nodesSorted.map(({ node, sx, sy }) => {
          // Если узел скрыт через «Видимость узлов» — не рендерим ничего
          if (node.visible === false) return null;
          const isSel = selectedNodeId === node.id;
          const isBranchFrom = branchFrom === node.id;
          // Фиксированный размер в px — не зависит от масштаба схемы
          const r = isSel ? 6 : 4;
          const color = node.atmosphereLink ? "#7dd3fc" : "#c8a882";
          return (
            <g key={node.id} transform={`translate(${sx},${sy})`}>
              {(isSel || isBranchFrom) && (
                <circle r={r + 4} fill="none" stroke="#2563eb" strokeWidth="1.5" />
              )}
              <circle r={r} fill={color} stroke="#1f2937" strokeWidth={isSel ? 2 : 1} />
              {node.atmosphereLink && (
                <circle r={Math.max(1.5, r * 0.55)} fill="none" stroke="#1f2937" strokeWidth="1.2" strokeDasharray="2 1" />
              )}
              <g transform="translate(8, -8)">
                {view.scale > 0.08 && (() => {
                  const ic = infoConfig;
                  const nodeOpacity = Math.min(1, (view.scale - 0.08) / 0.12);
                  const nlines: string[] = [];
                  if (!ic) {
                    if (node.name) nlines.push(node.name);
                  } else {
                    if (ic.nodeNumber) nlines.push(`${node.number}`);
                    if (ic.nodeX) nlines.push(`X=${node.x}м`);
                    if (ic.nodeY) nlines.push(`Y=${node.y}м`);
                    if (ic.nodeZ) nlines.push(`Z=${node.z}м`);
                    if (ic.nodePressure && node.computedPressure > 0)
                      nlines.push(`P=${(node.computedPressure / 10).toFixed(1)}даПа`);
                    if (ic.nodeTemp && node.airTemp !== 0) nlines.push(`T=${node.airTemp}°C`);
                    if (ic.nodeMethane && node.computedGasConc > 0) nlines.push(`CH4=${node.computedGasConc.toFixed(2)}%`);
                  }
                  if (nlines.length === 0) return null;
                  return nlines.map((ln, li) => (
                    <text key={li} y={(li + 1) * 11} fontSize="9" fill="#6b7280" opacity={nodeOpacity}>{ln}</text>
                  ));
                })()}
              </g>

            </g>
          );
        })}

        {/* ── ViewCube в углу (3D-индикатор ориентации) ─────────────── */}
        <ViewCube
          x={size.w - 70} y={20}
          azimuth={view.azimuth} elevation={view.elevation}
          onPick={applyPreset}
        />

        {/* ── МАСШТАБНАЯ ЛИНЕЙКА (как в АэроСети) ─────────────────── */}
        {(() => {
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
      </svg>

      {/* Индикаторы */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444", marginLeft: "0px", paddingBottom: "0px" }}>
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
function hitNode(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[]): string | null {
  for (let i = projNodes.length - 1; i >= 0; i--) {
    const p = projNodes[i];
    const dx = sx - p.sx;
    const dy = sy - p.sy;
    if (dx * dx + dy * dy < 64) return p.node.id;
  }
  return null;
}

function hitBranch(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[],
  branches: TopoBranch[]): string | null {
  for (const b of branches) {
    const from = projNodes.find((p) => p.node.id === b.fromId);
    const to = projNodes.find((p) => p.node.id === b.toId);
    if (!from || !to) continue;
    const A = sx - from.sx, B = sy - from.sy;
    const C = to.sx - from.sx, D = to.sy - from.sy;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, dot / lenSq));
    const px = from.sx + t * C, py = from.sy + t * D;
    const dist = Math.hypot(sx - px, sy - py);
    if (dist < 5) return b.id;
  }
  return null;
}