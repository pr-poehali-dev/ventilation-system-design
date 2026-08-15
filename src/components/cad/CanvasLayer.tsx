import { useEffect, useRef, useCallback } from "react";
import {
  type TopoNode, type TopoBranch, type Horizon, type ProjOptions,
} from "@/lib/topology";
import {
  renderCanvas,
  renderOverlay,
  computeObjSF,
  setHorizonImageLoadCallback,
  type FlowDisplayMode, type ProjNode,
  CANVAS_THRESHOLD,
} from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type WaterNodeResult, type WaterBranchResult } from "@/lib/waterHydraulics";



interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
  azimuth: number;
  elevation: number;
}

interface CanvasLayerProps {
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
  view: ViewState;
  sortEpoch?: number;
  is3D: boolean;
  zScale: number;
  zLevel: number;

  selectedBranchId: string | null;
  selectedBranchIds: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  hoverBranchId: string | null;
  highlightHorizonId?: string | null;

  branchWidth: number;
  branchBorder: number;
  thinLines: boolean;
  colorByHorizon: boolean;
  showFlowArrows: boolean;
  flowDisplay: FlowDisplayMode;
  /** Множитель скорости анимации: 1 — обычная, 0.5 — вдвое медленнее */
  animSpeed?: number;

  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  waterNodeResults?: Map<string, WaterNodeResult>;
  waterBranchResults?: Map<string, WaterBranchResult>;
  branchFireColors?: Map<string, { color: string; fromT: number; toT: number }>;
  branchExplosionColors?: Map<string, { color: string; hazardLevel: string }>;
  reversedBranchIds?: Set<string>;
  fixedObjectScale?: boolean;
  scaleLimits?: {
    textMin: number; textMax: number;
    branchMin: number; branchMax: number;
  };
  pollutedBranchIds?: Set<string>;
  xyScale?: number;
  /** Пороги авто-скрытия узлов при отдалении (настройка «Видимость узлов») */
  nodeLodThresholds?: { circle: number; label: number };
  transparentBg?: boolean;
  compareBranchColors?: Map<string, string>;
  colorMode?: "none" | "flowQ" | "velocityV" | "section" | "ventsection";
  /** Цвета участков рудника: id ветви → цвет (для colorMode="ventsection") */
  sectionColors?: Map<string, string>;
  flowColorMin?: number;
  flowColorMax?: number;
  flowColorHue?: "red" | "blue" | "green";
  velColorMin?: number;
  velColorMax?: number;
  velColorHue?: "red" | "blue" | "green";
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;
  rescuePathNodeIds?: Set<string>;
  rescueNodeLetters?: Map<string, string>;
  rescuePathBranchIds?: Set<string>;
  rescuePathBranchDirs?: Map<string, boolean>;

  /** Линия построения новой выработки: узел-начало и текущая точка курсора */
  buildFromNodeId?: string | null;
  buildToPos?: { sx: number; sy: number } | null;

  // события — пробрасываются от TopoCanvas
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp:   (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onWheel:     (e: React.WheelEvent<HTMLCanvasElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchMove:  (e: React.TouchEvent<HTMLCanvasElement>) => void;
  onTouchEnd:   (e: React.TouchEvent<HTMLCanvasElement>) => void;

  // экспорт canvas как изображения (для печати)
  onRegisterGetCanvas?: (fn: () => string) => void;
  // прямой доступ к DOM canvas элементу
  onRegisterCanvasEl?: (el: HTMLCanvasElement | null) => void;
}

export default function CanvasLayer(props: CanvasLayerProps) {
  const {
    width, height,
    nodes, branches, horizons, horizonMap, visibleBranches, hiddenBranchIds,
    projNodes, projNodesMap,
    proj, view, is3D, zScale, zLevel,
    selectedBranchId, selectedBranchIds, selectedNodeId, selectedNodeIds,
    hoverBranchId,
    branchWidth, branchBorder, thinLines, colorByHorizon, showFlowArrows, flowDisplay, animSpeed,
    infoConfig, unitsConfig = DEFAULT_UNITS_CONFIG, waterNodeResults,
    onMouseDown, onMouseMove, onMouseUp, onWheel, onContextMenu,
    onTouchStart, onTouchMove, onTouchEnd,
    onRegisterGetCanvas, onRegisterCanvasEl,
    compareBranchColors,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Верхний прозрачный холст: на нём рисуется только выделение и подсветка.
  // Схема лежит на нижнем и при выборе выработки не перерисовывается вовсе.
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef    = useRef<number | null>(null);
  const animOffsetRef = useRef(0);

  // Refs на touch-обработчики — нужны для нативной регистрации {passive:false}
  const onTouchStartRef = useRef(onTouchStart);
  const onTouchMoveRef  = useRef(onTouchMove);
  const onTouchEndRef   = useRef(onTouchEnd);
  onTouchStartRef.current = onTouchStart;
  onTouchMoveRef.current  = onTouchMove;
  onTouchEndRef.current   = onTouchEnd;

  // Инициализация размера при монтировании
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = width;
    canvas.height = height;
    draw();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Регистрируем touch-события нативно с {passive:false} — иначе
  // React 17+ делает их passive по умолчанию и e.preventDefault() не работает,
  // браузер перехватывает scroll → canvas становится чёрным на мобильном.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ts = (e: TouchEvent) => onTouchStartRef.current(e as unknown as React.TouchEvent<HTMLCanvasElement>);
    const tm = (e: TouchEvent) => { e.preventDefault(); onTouchMoveRef.current(e as unknown as React.TouchEvent<HTMLCanvasElement>); };
    const te = (e: TouchEvent) => onTouchEndRef.current(e as unknown as React.TouchEvent<HTMLCanvasElement>);
    canvas.addEventListener("touchstart",  ts, { passive: false });
    canvas.addEventListener("touchmove",   tm, { passive: false });
    canvas.addEventListener("touchend",    te, { passive: false });
    canvas.addEventListener("touchcancel", te, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart",  ts);
      canvas.removeEventListener("touchmove",   tm);
      canvas.removeEventListener("touchend",    te);
      canvas.removeEventListener("touchcancel", te);
    };
  }, []);

  // Анимация потока — один RAF на весь холст (вместо 1872 SVG <animate>)
  const needsAnim = flowDisplay === "flow" || flowDisplay === "both";

  // Все параметры рендера в ref чтобы RAF всегда брал актуальные данные
  const renderParamsRef = useRef(props);
  renderParamsRef.current = props;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const p = renderParamsRef.current;
    try {
      renderCanvas({
        ctx,
        width: p.width,
        height: p.height,
        nodes: p.nodes,
        branches: p.branches,
        horizons: p.horizons,
        horizonMap: p.horizonMap,
        visibleBranches: p.visibleBranches,
        hiddenBranchIds: p.hiddenBranchIds,
        projNodes: p.projNodes,
        projNodesMap: p.projNodesMap,
        proj: p.proj,
        view: p.view,
        sortEpoch: p.sortEpoch,
        is3D: p.is3D,
        zScale: p.zScale,
        zLevel: p.zLevel,
        selectedBranchId: p.selectedBranchId,
        selectedBranchIds: p.selectedBranchIds,
        selectedNodeId: p.selectedNodeId,
        selectedNodeIds: p.selectedNodeIds,
        hoverBranchId: p.hoverBranchId,
        highlightHorizonId: p.highlightHorizonId,
        branchWidth: p.branchWidth,
        branchBorder: p.branchBorder,
        thinLines: p.thinLines,
        colorByHorizon: p.colorByHorizon,
        showFlowArrows: p.showFlowArrows,
        flowDisplay: p.flowDisplay,
        animSpeed: p.animSpeed,
        animOffset: animOffsetRef.current,
        infoConfig: p.infoConfig,
        unitsConfig: p.unitsConfig ?? DEFAULT_UNITS_CONFIG,
        waterNodeResults: p.waterNodeResults,
        waterBranchResults: p.waterBranchResults,
        branchFireColors: p.branchFireColors,
        branchExplosionColors: p.branchExplosionColors,
        reversedBranchIds: p.reversedBranchIds,
        fixedObjectScale: p.fixedObjectScale,
        scaleLimits: p.scaleLimits,
        pollutedBranchIds: p.pollutedBranchIds,
        xyScale: p.xyScale,
        nodeLodThresholds: p.nodeLodThresholds,
        transparentBg: p.transparentBg,
        compareBranchColors: p.compareBranchColors,
        colorMode: p.colorMode,
        sectionColors: p.sectionColors,
        flowColorMin: p.flowColorMin,
        flowColorMax: p.flowColorMax,
        flowColorHue: p.flowColorHue,
        velColorMin: p.velColorMin,
        velColorMax: p.velColorMax,
        velColorHue: p.velColorHue,
        posInnerColors: p.posInnerColors,
        posOuterColors: p.posOuterColors,
        rescuePathNodeIds: p.rescuePathNodeIds,
        rescueNodeLetters: p.rescueNodeLetters,
        rescuePathBranchIds: p.rescuePathBranchIds,
        rescuePathBranchDirs: p.rescuePathBranchDirs,
      });
    } catch (err) {
      console.error("[CanvasLayer] renderCanvas error:", err);
    }
  }, []);

  // Отрисовка верхнего слоя — выделение, подсветка, наведение.
  // Работает мгновенно: рисует единицы объектов вместо всей схемы.
  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const p = renderParamsRef.current;
    try {
      renderOverlay({
        ctx,
        width: p.width,
        height: p.height,
        projNodesMap: p.projNodesMap,
        visibleBranches: p.visibleBranches,
        branches: p.branches,
        selectedBranchId: p.selectedBranchId,
        selectedBranchIds: p.selectedBranchIds,
        selectedNodeId: p.selectedNodeId,
        selectedNodeIds: p.selectedNodeIds,
        hoverBranchId: p.hoverBranchId,
        branchWidth: p.branchWidth,
        thinLines: p.thinLines,
        objSF: computeObjSF(p.view.scale, p.xyScale, false, p.fixedObjectScale, p.scaleLimits),
        buildFromNodeId: p.buildFromNodeId,
        buildToPos: p.buildToPos,
      });
    } catch (err) {
      console.error("[CanvasLayer] renderOverlay error:", err);
    }
  }, []);

  // RAF-цикл для анимации потока
  useEffect(() => {
    if (!needsAnim) {
      draw();
      return;
    }
    let last = 0;
    const loop = (ts: number) => {
      if (ts - last > 16) {
        // Передаём ВРЕМЯ в секундах, а не готовое смещение. Раньше здесь
        // считался один общий сдвиг на всю схему, поэтому стрелки на всех
        // ветвях двигались с одинаковой скоростью — независимо от скорости
        // воздуха. В SVG-режиме скорость всегда была своя у каждой ветви, и
        // две части схемы выглядели по-разному. Теперь скорость считает сама
        // ветвь, по своему значению V.
        animOffsetRef.current = ts / 1000;
        draw();
        last = ts;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [needsAnim, draw]);

  // Перерисовка при изменении данных (без анимации).
  // ВАЖНО: deps перечислены явно — иначе draw() вызывается при КАЖДОМ рендере React,
  // что при 8000+ ветвей даёт заметный фриз на каждый mousemove/hover.
  useEffect(() => {
    if (!needsAnim) draw();
  }, [needsAnim, draw,
    // Все данные схемы — при их изменении нужна перерисовка
    props.nodes, props.branches, props.horizons, props.horizonMap,
    props.visibleBranches, props.hiddenBranchIds,
    props.projNodes, props.projNodesMap, props.proj, props.view,
    props.is3D, props.zScale, props.xyScale, props.zLevel,
    props.nodeLodThresholds,
    // Выделение, множественный выбор и наведение здесь НАМЕРЕННО отсутствуют:
    // они рисуются на верхнем слое (drawOverlay) и больше не заставляют
    // перерисовывать всю схему. Раньше выбор одной выработки на схеме в 14
    // тысяч ветвей означал полную перерисовку и заметное подтормаживание.
    props.highlightHorizonId,
    props.branchWidth, props.branchBorder, props.thinLines,
    props.colorByHorizon, props.showFlowArrows, props.flowDisplay, props.animSpeed,
    props.infoConfig, props.unitsConfig,
    props.waterNodeResults, props.waterBranchResults, props.branchFireColors, props.branchExplosionColors,
    props.reversedBranchIds, props.fixedObjectScale, props.pollutedBranchIds,
    props.transparentBg,
    props.compareBranchColors,
    props.colorMode, props.sectionColors, props.flowColorMin, props.flowColorMax, props.flowColorHue,
    props.velColorMin, props.velColorMax, props.velColorHue,
    props.posInnerColors,
    props.rescuePathNodeIds, props.rescueNodeLetters,
    props.rescuePathBranchIds, props.rescuePathBranchDirs,
    props.width, props.height,
  ]);

  // Верхний слой перерисовывается при смене выделения/наведения — дёшево,
  // рисуются единицы объектов. А также при любом изменении вида (панорама,
  // зум, поворот) — иначе подсветка «отстала» бы от схемы.
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay,
    props.selectedBranchId, props.selectedBranchIds,
    props.selectedNodeId, props.selectedNodeIds,
    props.hoverBranchId,
    props.projNodesMap, props.view, props.width, props.height,
    props.branchWidth, props.thinLines, props.branches,
    props.fixedObjectScale, props.scaleLimits, props.xyScale,
    props.buildFromNodeId, props.buildToPos,
  ]);

  // Подложки-планы горизонтов декодируются браузером асинхронно: на первом
  // проходе картинка ещё не готова и не рисуется. Перерисовываем холст, когда
  // изображение догрузилось, иначе план появлялся бы только после случайного
  // перерендера (зум/клик).
  useEffect(() => {
    setHorizonImageLoadCallback(() => draw());
    return () => setHorizonImageLoadCallback(null);
  }, [draw]);

  // Регистрируем функцию экспорта для печати
  useEffect(() => {
    if (!onRegisterGetCanvas) return;
    onRegisterGetCanvas(() => canvasRef.current?.toDataURL("image/png") ?? "");
  }, [onRegisterGetCanvas]);

  // Регистрируем прямой доступ к DOM canvas
  useEffect(() => {
    if (!onRegisterCanvasEl) return;
    onRegisterCanvasEl(canvasRef.current);
    return () => onRegisterCanvasEl(null);
  }, [onRegisterCanvasEl]);

  // Изменяем размер canvas императивно — без сброса содержимого при каждом рендере React
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width  = width;
      canvas.height = height;
      draw(); // перерисовываем сразу после изменения размера
    }
    // Слой выделения держим того же размера, что и схема.
    const ov = overlayRef.current;
    if (ov && (ov.width !== width || ov.height !== height)) {
      ov.width  = width;
      ov.height = height;
      drawOverlay();
    }
  }, [width, height, draw, drawOverlay]);

  return (
    // Обёртка нужна, чтобы наложить слой выделения точно поверх схемы.
    // Размер задаём явно — обёртка не должна менять раскладку страницы.
    <div style={{ position: "relative", width, height,
      ...(props.transparentBg ? { zIndex: 1 } : {}) }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ display: "block", touchAction: "none", userSelect: "none",
          // Когда активен слой печати — поднимаем canvas над SVG рамки (zIndex:0),
          // чтобы схема была ПОВЕРХ рамки, но прозрачный фон показывал лист.
          ...(props.transparentBg ? { position: "relative" as const, zIndex: 1 } : {}) }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
      />
      {/* Слой выделения. pointerEvents:none — все щелчки и наведение проходят
          сквозь него на нижний холст, обработка событий не меняется. */}
      <canvas
        ref={overlayRef}
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0,
          width, height, pointerEvents: "none",
          zIndex: props.transparentBg ? 2 : 1 }}
      />
    </div>
  );
}

// Все реэкспорты перенесены в CanvasLayerExports.ts (Fast Refresh требует только default export в этом файле)