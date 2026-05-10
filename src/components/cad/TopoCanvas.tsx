import { useEffect, useRef, useState, useCallback } from "react";
import {
  type TopoNode, type TopoBranch, type ProjOptions, type ViewPreset, type WorkPlane,
  type Horizon,
  project3D, unproject2D, unprojectToPlane, calcBranchLength, VIEW_PRESETS, autoWorkPlane,
} from "@/lib/topology";

// ─────────────────────────────────────────────────────────────────────────────
// Интерактивный CAD-холст для построения топологии
// 2D (план) + 3D с произвольным ракурсом
// ─────────────────────────────────────────────────────────────────────────────

export type CadTool = "select" | "node" | "branch" | "pan" | "rotate";

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  selectedNodeId: string | null;
  selectedBranchId: string | null;
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

  // Перетаскивание угла подложки горизонта: какой именно угол тащим.
  const [draggingCorner, setDraggingCorner] = useState<
    { horizonId: string; corner: "tl" | "tr" | "bl" | "br" } | null
  >(null);

  // При смене инструмента сбрасываем «начало ветви» — иначе возникнут призрачные сегменты.
  useEffect(() => { setBranchFrom(null); }, [tool]);

  // ─── СИНХРОНИЗАЦИЯ ВНЕШНЕГО МАСШТАБА ────────────────────────────────
  // Если родитель управляет масштабом (поле «1:N»), применяем его сюда.
  useEffect(() => {
    if (scaleOverride === undefined) return;
    if (Math.abs(scaleOverride - view.scale) < 1e-6) return;
    setView((v) => ({ ...v, scale: scaleOverride }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleOverride]);

  // Сообщаем наверх изменение масштаба (например, после wheel-зума).
  useEffect(() => {
    if (onScaleChange) onScaleChange(view.scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale]);

  // ─── ВПИСАТЬ ВСЮ СЕТЬ В ЭКРАН ───────────────────────────────────────
  // Реагируем на смену nonce из родителя — пересчитываем scale и offset так,
  // чтобы все узлы попали в видимую область с отступом 10%.
  useEffect(() => {
    if (!fitToScreenNonce) return;
    if (nodes.length === 0) return;
    if (size.w < 50 || size.h < 50) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      // Используем «плоскостные» координаты: для плана — x/y, иначе — общая огибающая.
      const x = n.x;
      const y = -n.y;       // экран Y — инвертированный мировой Y
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    const dx = Math.max(1, maxX - minX);
    const dy = Math.max(1, maxY - minY);
    const padding = 0.1;
    const sx = (size.w * (1 - padding * 2)) / dx;
    const sy = (size.h * (1 - padding * 2)) / dy;
    const newScale = Math.max(0.005, Math.min(20, Math.min(sx, sy)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView((v) => ({
      ...v,
      scale: newScale,
      offsetX: size.w / 2 - cx * newScale,
      offsetY: size.h / 2 - cy * newScale,
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

  // Применение пресета ракурса извне
  useEffect(() => {
    if (!viewPreset) return;
    const p = VIEW_PRESETS[viewPreset.name];
    setView((v) => ({ ...v, azimuth: p.azimuth, elevation: p.elevation }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPreset?.nonce]);

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
  };

  const projNodes = nodes.map((n) => ({ node: n, ...project3D(n, proj) }));

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
        const plane: WorkPlane = !is3D
          ? { axis: "z", value: node.z }
          : effPlane.axis === "z" ? { axis: "z", value: node.z }
          : effPlane.axis === "y" ? { axis: "y", value: node.y }
          : { axis: "x", value: node.x };
        setDraggingNode({ id: hitN, plane });
      }
      return;
    }

    if (hitB) {
      onSelectBranch(hitB);
      onSelectNode(null);
      return;
    }

    onSelectNode(null);
    onSelectBranch(null);
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
      onNodeMove(draggingNode.id, Math.round(wp.x), Math.round(wp.y), Math.round(wp.z));
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
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.05, Math.min(10, view.scale * factor));
    const wx = (sx - view.offsetX) / view.scale;
    const wy = (sy - view.offsetY) / view.scale;
    setView({
      ...view,
      scale: newScale,
      offsetX: sx - wx * newScale,
      offsetY: sy - wy * newScale,
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

  // Вертикальные «направляющие» от узлов до пола (z=0) — для понимания глубины
  const renderDepthLines = () => {
    if (!is3D) return null;
    return (
      <g>
        {projNodes.map(({ node, sx, sy }) => {
          if (node.z === 0 || node.atmosphereLink) return null;
          const ground = project3D({ x: node.x, y: node.y, z: 0 }, proj);
          return (
            <line key={`dl${node.id}`} x1={sx} y1={sy} x2={ground.sx} y2={ground.sy}
              stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
          );
        })}
      </g>
    );
  };

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden"
      style={{
        background: is3D ? "linear-gradient(to bottom, #f0f4f8 0%, #ffffff 60%, #f5f5f5 100%)" : "#ffffff",
        cursor: rotStart ? "grabbing" : panStart ? "grabbing"
          : tool === "node" ? "crosshair"
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
          {/* 2D-сетка */}
          <pattern id="topo-grid-minor" width={20 * view.scale} height={20 * view.scale} patternUnits="userSpaceOnUse"
            x={view.offsetX % (20 * view.scale)} y={view.offsetY % (20 * view.scale)}>
            <path d={`M ${20 * view.scale} 0 L 0 0 0 ${20 * view.scale}`} fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
          </pattern>
          <pattern id="topo-grid-major" width={100 * view.scale} height={100 * view.scale} patternUnits="userSpaceOnUse"
            x={view.offsetX % (100 * view.scale)} y={view.offsetY % (100 * view.scale)}>
            <rect width={100 * view.scale} height={100 * view.scale} fill="url(#topo-grid-minor)" />
            <path d={`M ${100 * view.scale} 0 L 0 0 0 ${100 * view.scale}`} fill="none" stroke="#dcdcdc" strokeWidth="0.8" />
          </pattern>
        </defs>

        {!is3D && <rect width={size.w} height={size.h} fill="url(#topo-grid-major)" />}
        {is3D && renderGroundGrid()}

        {/* Оси для 2D */}
        {!is3D && (<>
          <line x1={view.offsetX} y1={0} x2={view.offsetX} y2={size.h}
            stroke="#22c55e" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
          <line x1={0} y1={view.offsetY} x2={size.w} y2={view.offsetY}
            stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
          <text x={view.offsetX + 4} y={12} fontSize="10" fill="#22c55e">+Y</text>
          <text x={size.w - 16} y={view.offsetY - 4} fontSize="10" fill="#ef4444">+X</text>
        </>)}

        {is3D && renderDepthLines()}
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
          const isSel = selectedBranchId === b.id;
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
          // Приоритет: выделена → авария → вентилятор → горизонт (если включён) → поток.
          const horizonColor = b.horizonId ? horizonMap.get(b.horizonId)?.color : undefined;
          const color = isSel ? "#2563eb"
            : overV ? "#dc2626"
            : b.hasFan ? "#7c3aed"
            : (colorByHorizon && horizonColor) ? horizonColor
            : Q > 0 ? "#0369a1"
            : "#9ca3af";

          // ─── ТОЛЩИНА ЛИНИИ ───────────────────────────────────────
          // F6 «Тонкие линии» → всё в 1px. Иначе — общая настройка branchWidth
          // с лёгким масштабированием по расходу + явный «акцент» при выделении.
          const baseW = isSel ? branchWidth + 1
            : Q > 100 ? branchWidth + 0.5
            : Q > 30 ? branchWidth
            : Math.max(1, branchWidth - 0.5);
          const w = thinLines ? 1 : baseW;
          // Обводка (контур вокруг линии): ширина = w + 2*border
          const borderW = thinLines ? 0 : Math.max(0, branchBorder);

          const flowVisible = !thinLines && Q > 0.1 && flowDisplay !== "off";
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
              {/* Красные, статичные, редкие (1 шт на ~120 px), как в АэроСеть. */}
              {showFlowArrows && !thinLines && Q > 0.1 && segLen > 60 && (() => {
                const step = 120;
                const count = Math.max(1, Math.floor(segLen / step));
                const angle = Math.atan2(uy, ux) * 180 / Math.PI;
                return (
                  <g>
                    {Array.from({ length: count }, (_, i) => {
                      const t0 = (i + 1) / (count + 1);
                      const cx = sxA + dx * t0;
                      const cy = syA + dy * t0;
                      return (
                        <g key={`fa${i}`} transform={`translate(${cx},${cy}) rotate(${angle})`}>
                          {/* Жирная красная стрелка с белым контуром для читаемости */}
                          <polygon points="-7,-5 7,0 -7,5 -3,0"
                            fill="#dc2626" stroke="white" strokeWidth="1.2"
                            strokeLinejoin="round" />
                        </g>
                      );
                    })}
                  </g>
                );
              })()}

              {b.hasFan && (
                <g transform={`translate(${midX},${midY - 18})`}>
                  <circle r="8" fill="#ede9fe" stroke="#7c3aed" strokeWidth="1.2" />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="11" fontWeight="bold" fill="#7c3aed">⚙</text>
                </g>
              )}
              {view.scale > 0.15 && !is3D && (
                <g transform={`translate(${midX},${midY})`}>
                  <rect x={-32} y={-12} width={64} height={Q > 0 ? 24 : 14} rx="2"
                    fill="white" stroke={isSel ? "#2563eb" : "#9ca3af"} strokeWidth="0.8" />
                  <text textAnchor="middle" dominantBaseline="middle" y={Q > 0 ? -3 : 0}
                    fontSize="9" fill="#1f2937">{b.id} · {len}м</text>
                  {Q > 0 && (
                    <text textAnchor="middle" dominantBaseline="middle" y="7"
                      fontSize="9" fontWeight="600"
                      fill={overV ? "#dc2626" : "#0369a1"}>
                      Q={Q.toFixed(1)} м³/с
                    </text>
                  )}
                </g>
              )}
              {/* В 3D — компактная подпись только при выборе */}
              {is3D && isSel && (
                <g transform={`translate(${midX},${midY})`}>
                  <rect x={-26} y={-9} width={52} height={14} rx="2"
                    fill="white" stroke="#2563eb" strokeWidth="0.8" />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontWeight="600" fill="#2563eb">{b.id}</text>
                </g>
              )}
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

        {/* ─── УЗЛЫ (отсортированы по глубине, ближние сверху) ─────────── */}
        {nodesSorted.map(({ node, sx, sy }) => {
          const isSel = selectedNodeId === node.id;
          const isBranchFrom = branchFrom === node.id;
          const r = isSel ? 7 : 5;
          const color = node.atmosphereLink ? "#fbbf24" : zColor(node.z);
          return (
            <g key={node.id} transform={`translate(${sx},${sy})`}>
              {(isSel || isBranchFrom) && (
                <circle r={r + 5} fill="none" stroke="#2563eb" strokeWidth="1.2" strokeDasharray="3 2" />
              )}
              <circle r={r} fill={color} stroke="#1f2937" strokeWidth={isSel ? 2 : 1} />
              {node.atmosphereLink && (
                <text textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="bold" fill="#1f2937">A</text>
              )}
              <g transform="translate(8, -8)">
                <text fontSize="10" fontWeight="600" fill="#1f2937">{node.number}</text>
                {view.scale > 0.25 && node.name && !is3D && (
                  <text y="11" fontSize="9" fill="#6b7280">{node.name}</text>
                )}
              </g>
              {view.scale > 0.2 && !is3D && (
                <text x="0" y={r + 12} textAnchor="middle" fontSize="8" fill="#9ca3af">Z={node.z}</text>
              )}
              {view.scale > 0.25 && node.computedPressure > 0 && !node.atmosphereLink && !is3D && (
                <g transform={`translate(8, ${node.name ? 22 : 12})`}>
                  <text fontSize="9" fontWeight="600" fill="#0369a1">
                    P={(node.computedPressure / 1000).toFixed(1)} кПа
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── ViewCube в углу (3D-индикатор ориентации) ─────────────── */}
        <ViewCube
          x={size.w - 70} y={20}
          azimuth={view.azimuth} elevation={view.elevation}
          onPick={applyPreset}
        />
      </svg>

      {/* Индикаторы */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
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
        Масштаб: 1:{Math.round(1 / view.scale)}
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