// Рендер схемы в canvas для предпросмотра печати.
// Получает viewState из рабочей области и масштабирует его под размер превью.
// SVG слоя печати рисуется поверх — координаты вычисляются из projNodes текущего view.
import { useEffect, useRef, useMemo, useImperativeHandle, forwardRef } from "react";
import {
  type TopoNode, type TopoBranch, type Horizon, type ProjOptions,
  project3D,
} from "@/lib/topology";
import { renderCanvas, type ProjNode, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import { type Position } from "@/lib/positions";
import { type TextBlock } from "@/pages/cad/cadTypes";
import SchemaSymbolsOverlay from "./SchemaSymbolsOverlay";
import { renderPrintLayerSvgContent } from "@/lib/printLayerSvg";

export interface PrintPreviewCanvasHandle {
  getFitView(): { scale: number; offsetX: number; offsetY: number } | null;
  toDataURL(): string;
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  schemaSymbols?: SchemaSymbol[];
  // viewState из рабочей области — что сейчас видно на экране
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  // Размер рабочего canvas в px (для пересчёта масштаба)
  canvasSize: { w: number; h: number };
  zScale?: number;
  is3D?: boolean;
  width: number;
  height: number;
  branchWidth?: number;
  branchBorder?: number;
  thinLines?: boolean;
  colorByHorizon?: boolean;
  showFlowArrows?: boolean;
  flowDisplay?: FlowDisplayMode;
  textBlocks?: TextBlock[];
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  colorMode?: "none" | "flowQ";
  posInnerColors?: Map<string, string>;
  posOuterColors?: Map<string, string>;
  positions?: Position[];
  showPositions?: boolean;
  fixedObjectScale?: boolean;
  /** Диапазон масштаба позиций ПЛА в % при фиксированном масштабе */
  scalePositionMin?: number;
  scalePositionMax?: number;
  /** Глобальный ГОСТ-диаметр маркера позиции, мм (эталон 13) */
  positionGostMm?: number;
  xyScale?: number;
  /** Множитель супер-сэмплинга canvas (обычно = зум предпросмотра),
   *  чтобы схема оставалась чёткой при CSS transform: scale(). */
  superSample?: number;
  /** Готовая проекция конкретного тайла (листа) в координатах предпросмотра.
   *  Если передана — компонент использует её напрямую вместо своего fit-to-screen.
   *  Нужна для многолистовой печати БЕЗ слоя печати: каждый лист показывает
   *  свою часть единой схемы (offset смещён на col*pageW / row*pageH). */
  tileView?: { scale: number; offsetX: number; offsetY: number };
}

// Вычисляет bbox рамки из projNodes — точно как TopoCanvas.renderPrintLayers
function computeFrameRect(
  pl: NonNullable<Horizon["printLayer"]>,
  projNodes: ProjNode[],
  visibleBranches: TopoBranch[],
  proj?: ProjOptions,
  xyScale = 1,
  zLevel = 0,
): { rx: number; ry: number; rw: number; rh: number } | null {
  // Если рамка настроена вручную (pl.bounds) — проецируем её углы ТЕМ ЖЕ project3D,
  // что и рабочая область (TopoCanvas). Так предпросмотр/PDF совпадают с тем, что
  // пользователь настроил на схеме, в т.ч. в наклонных видах (ИЗО/Фронт/Профиль).
  if (pl.bounds && proj) {
    const z4 = zLevel * (proj.zScale ?? 1);
    const b = pl.bounds;
    const c = [
      project3D({ x: b.x1 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
      project3D({ x: b.x2 * xyScale, y: b.y2 * xyScale, z: z4 }, proj),
      project3D({ x: b.x1 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
      project3D({ x: b.x2 * xyScale, y: b.y1 * xyScale, z: z4 }, proj),
    ];
    const bxs = c.map(p => p.sx), bys = c.map(p => p.sy);
    const rx = Math.min(...bxs), ry = Math.min(...bys);
    const rw = Math.max(...bxs) - rx, rh = Math.max(...bys) - ry;
    return { rx, ry, rw: Math.max(rw, 40), rh: Math.max(rh, 40) };
  }

  const visibleNodeIds = new Set<string>();
  visibleBranches.forEach(b => { visibleNodeIds.add(b.fromId); visibleNodeIds.add(b.toId); });
  const relevant = projNodes.filter(pn => visibleNodeIds.has(pn.node.id));
  if (relevant.length === 0) return null;

  let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
  relevant.forEach(pn => {
    if (pn.sx < minSx) minSx = pn.sx; if (pn.sx > maxSx) maxSx = pn.sx;
    if (pn.sy < minSy) minSy = pn.sy; if (pn.sy > maxSy) maxSy = pn.sy;
  });

  const sw = maxSx - minSx || 1, sh = maxSy - minSy || 1;
  const pad = Math.max(sw, sh) * 0.08 + 15;
  const scx = (minSx + maxSx) / 2, scy = (minSy + maxSy) / 2;

  const paperSizes: Record<string, { w: number; h: number }> = {
    A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 },
    A2: { w: 420, h: 594 }, A1: { w: 594, h: 841 }, A0: { w: 841, h: 1189 },
  };
  const fmt = (pl.paperFormat ?? "A3") as string;
  const ori = pl.orientation ?? "landscape";
  const mm = paperSizes[fmt] ?? paperSizes["A3"];
  const mmW = ori === "landscape" ? mm.h : mm.w;
  const mmH = ori === "landscape" ? mm.w : mm.h;
  const aspect = mmW / mmH;

  let rsw = sw + pad * 2, rsh = rsw / aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }
  rsw = Math.max(rsw, sw + pad * 2);
  rsh = rsw / aspect;
  if (rsh < sh + pad * 2) { rsh = sh + pad * 2; rsw = rsh * aspect; }

  return { rx: scx - rsw / 2, ry: scy - rsh / 2, rw: Math.max(rsw, 40), rh: Math.max(rsh, 40) };
}

const PrintPreviewCanvas = forwardRef<PrintPreviewCanvasHandle, Props>(function PrintPreviewCanvas({
  nodes, branches, horizons,
  schemaSymbols = [],
  viewState,
  canvasSize,
  zScale = 1, is3D = false,
  width, height,
  branchWidth = 2, branchBorder = 0.4,
  thinLines = false, colorByHorizon = false,
  showFlowArrows = false,
  flowDisplay = "off",
  textBlocks = [],
  infoConfig = null,
  unitsConfig = DEFAULT_UNITS_CONFIG,
  colorMode = "none",
  posInnerColors,
  posOuterColors,
  positions = [],
  showPositions = true,
  fixedObjectScale = false,
  scalePositionMin = 80,
  scalePositionMax = 150,
  positionGostMm = 13,
  xyScale,
  superSample = 1,
  tileView,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { azimuth, elevation } = viewState;

  const horizonMap = useMemo(() => {
    const m = new Map<string, Horizon>();
    horizons.forEach(h => m.set(h.id, h));
    return m;
  }, [horizons]);

  const visibleBranches = useMemo(
    () => branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible;
    }),
    [branches, horizonMap],
  );

  // Активные слои печати (все горизонты с включённым слоем)
  const activePrintLayers = useMemo(
    () => horizons.filter(h => h.printLayer?.visible),
    [horizons],
  );
  const hasPrintLayer = activePrintLayers.length > 0;

  // Пересчитываем viewState рабочей области под размер превью.
  // Всегда делаем fit-to-screen по узлам — так схема всегда отображается по центру превью
  // в том же ракурсе (azimuth/elevation) что и рабочая область.
  const activeView = useMemo((): ProjOptions & { scale: number; offsetX: number; offsetY: number } => {
    if (width <= 0 || height <= 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    }

    // Готовая проекция тайла (многолистовая печать без слоя печати): используем
    // напрямую, чтобы каждый лист показывал СВОЮ часть единой схемы, а не всю схему.
    if (tileView) {
      return {
        scale: tileView.scale,
        offsetX: tileView.offsetX,
        offsetY: tileView.offsetY,
        azimuth, elevation, zScale,
      };
    }

    const _xySF0 = xyScale ?? 1;

    // ── Если есть слой печати: вписываем рамку ────────────────────────────
    if (hasPrintLayer) {
      // Шаг 1: масштабируем viewState под размер превью
      const cw = canvasSize.w > 0 ? canvasSize.w : width;
      const ch = canvasSize.h > 0 ? canvasSize.h : height;
      const k = Math.min(width / cw, height / ch);
      const sc0 = viewState.scale * k;
      const ox0 = viewState.offsetX * k + (width - cw * k) / 2;
      const oy0 = viewState.offsetY * k + (height - ch * k) / 2;

      const proj0: ProjOptions = { scale: sc0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      const pNodes0: ProjNode[] = nodes.map(n => ({
        node: n,
        ...project3D({ x: n.x * _xySF0, y: n.y * _xySF0, z: n.z * zScale }, proj0),
        depth: 0,
      }));
      const plHorizon = activePrintLayers[0];
      const pl = plHorizon.printLayer!;
      const rect = computeFrameRect(pl, pNodes0, visibleBranches, proj0, _xySF0, plHorizon.z ?? 0);

      if (!rect || rect.rw <= 0 || rect.rh <= 0) {
        return { scale: sc0, offsetX: ox0, offsetY: oy0, azimuth, elevation, zScale };
      }
      const fitS = Math.min(width / rect.rw, height / rect.rh);
      return {
        scale: sc0 * fitS,
        offsetX: (ox0 - rect.rx) * fitS,
        offsetY: (oy0 - rect.ry) * fitS,
        azimuth, elevation, zScale,
      };
    }

    // ── Без слоя печати: fit-to-screen по bbox узлов ──────────────────────
    // Проецируем с scale=1, offset=0 чтобы получить bbox в нормальных координатах
    if (nodes.length === 0) {
      return { scale: 1, offsetX: width / 2, offsetY: height / 2, azimuth, elevation, zScale };
    }
    const proj1: ProjOptions = { scale: 1, offsetX: 0, offsetY: 0, azimuth, elevation, zScale };
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    for (const n of nodes) {
      const p = project3D({ x: n.x * _xySF0, y: n.y * _xySF0, z: n.z * zScale }, proj1);
      if (p.sx < minSx) minSx = p.sx; if (p.sx > maxSx) maxSx = p.sx;
      if (p.sy < minSy) minSy = p.sy; if (p.sy > maxSy) maxSy = p.sy;
    }
    const bw = Math.max(1, maxSx - minSx);
    const bh = Math.max(1, maxSy - minSy);
    const pad = 0.08;
    const fitSc = Math.min((width * (1 - pad * 2)) / bw, (height * (1 - pad * 2)) / bh);
    const cx = (minSx + maxSx) / 2;
    const cy = (minSy + maxSy) / 2;
    return {
      scale: fitSc,
      offsetX: width / 2 - cx * fitSc,
      offsetY: height / 2 - cy * fitSc,
      azimuth, elevation, zScale,
    };
  }, [viewState, canvasSize, width, height, azimuth, elevation, zScale,
      hasPrintLayer, activePrintLayers, nodes, visibleBranches, xyScale, tileView]);

  const proj = useMemo<ProjOptions>(() => activeView, [activeView]);

  const projNodes = useMemo<ProjNode[]>(() => {
    const _xySFN = xyScale ?? 1;
    return nodes.map(n => ({ node: n, ...project3D({ x: n.x * _xySFN, y: n.y * _xySFN, z: n.z * zScale }, proj), depth: 0 }));
  }, [nodes, proj, zScale, xyScale]);

  const projNodesMap = useMemo(() => {
    const m = new Map<string, ProjNode>();
    projNodes.forEach(p => m.set(p.node.id, p));
    return m;
  }, [projNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Супер-сэмплинг: рисуем canvas во внутреннем разрешении, увеличенном на зум
    // предпросмотра. Родитель растягивает предпросмотр через CSS transform:scale(),
    // и без этого растровая схема размывалась бы (в отличие от векторных SVG-слоёв).
    // Квантуем зум до ступеней (1,2,3,4), чтобы не пересоздавать canvas на каждый
    // мелкий шаг колеса, и ограничиваем произведение dpr*ss.
    const ss = Math.max(1, Math.min(4, Math.ceil(superSample)));
    const totalScale = Math.min(dpr * ss, 4);
    canvas.width  = Math.round(width  * totalScale);
    canvas.height = Math.round(height * totalScale);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(totalScale, totalScale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    try {
      renderCanvas({
        ctx, width, height,
        nodes, branches, horizons, horizonMap,
        visibleBranches, hiddenBranchIds: new Set(),
        projNodes, projNodesMap, proj,
        view: activeView,
        is3D, zScale, zLevel: 0,
        selectedBranchId: null, selectedBranchIds: new Set(),
        selectedNodeId: null, selectedNodeIds: new Set(),
        hoverBranchId: null,
        branchWidth, branchBorder,
        thinLines, colorByHorizon,
        showFlowArrows, flowDisplay,
        animOffset: 0, infoConfig, unitsConfig,
        colorMode, posInnerColors, posOuterColors,
        printMode: true,
        fixedObjectScale,
        xyScale,
      });
    } catch (err) {
      console.error("PrintPreviewCanvas renderCanvas error:", err);
    }
  }, [nodes, branches, horizons, horizonMap, visibleBranches,
      projNodes, projNodesMap, proj, activeView,
      is3D, zScale, width, height, superSample,
      branchWidth, branchBorder, thinLines, colorByHorizon,
      showFlowArrows, flowDisplay, infoConfig, unitsConfig,
      colorMode, posInnerColors, posOuterColors]);

  useImperativeHandle(ref, () => ({
    getFitView: () => ({ scale: activeView.scale, offsetX: activeView.offsetX, offsetY: activeView.offsetY }),
    toDataURL: () => canvasRef.current?.toDataURL("image/png") ?? "",
  }), [activeView]);

  // Рамки слоя печати: bbox из projNodes текущего view
  const printLayerRects = useMemo(() =>
    activePrintLayers
      .map(h => {
        const pl = h.printLayer!;
        const rect = computeFrameRect(pl, projNodes, visibleBranches);
        return rect ? { h, pl, ...rect } : null;
      })
      .filter(Boolean) as Array<{ h: Horizon; pl: NonNullable<Horizon["printLayer"]>; rx: number; ry: number; rw: number; rh: number }>,
    [activePrintLayers, projNodes, visibleBranches],
  );

  return (
    <div style={{ position: "relative", width, height, flexShrink: 0 }}>
      <canvas ref={canvasRef} style={{ display: "block", width, height }} />

      {schemaSymbols.length > 0 && (
        <SchemaSymbolsOverlay
          symbols={schemaSymbols}
          branches={branches}
          projNodesMap={projNodesMap}
          viewScale={activeView.scale}
          unitsConfig={unitsConfig}
          width={width}
          height={height}
        />
      )}

      {/* Позиции ПЛА */}
      {showPositions && positions.length > 0 && (() => {
        const _xySF = xyScale ?? 1;
        // posSF: при фиксированном масштабе (fixedObjectScale) размер НЕ зависит от
        // зума — базовый коэффициент = 1, затем зажимается в диапазон posMin%..posMax%
        // (точно как в рабочей области Cad.tsx). Иначе — пропорционально зуму.
        const _rawPosSF = fixedObjectScale ? 1 : Math.min(8, Math.max(0.25, viewState.scale / (_xySF * 0.5)));
        const posSF = fixedObjectScale
          ? Math.min(scalePositionMax / 100, Math.max(scalePositionMin / 100, _rawPosSF))
          : _rawPosSF;
        const previewK = viewState.scale > 0 ? activeView.scale / viewState.scale : 1;
        const _posGostMm = positionGostMm > 0 ? positionGostMm : 13;
        const _gostFactor = _posGostMm / 13;
        const PX_PER_MM = 3.78 * posSF * previewK;

        const posProj = (pos: Position) =>
          project3D({ x: pos.x * _xySF, y: pos.y * _xySF, z: (pos.z ?? 0) * zScale }, proj);

        // Экранный конец выноски: привязка к ветви (branchId + t) или свободная точка
        const posLeaderEnd = (pos: Position): { sx: number; sy: number } | null => {
          if (pos.leaderBranchId && pos.leaderT != null) {
            const br = branches.find(b => b.id === pos.leaderBranchId);
            const fromN = br ? projNodesMap.get(br.fromId) : null;
            const toN   = br ? projNodesMap.get(br.toId)   : null;
            if (!fromN || !toN) return null;
            return { sx: fromN.sx + (toN.sx - fromN.sx) * pos.leaderT, sy: fromN.sy + (toN.sy - fromN.sy) * pos.leaderT };
          }
          if (pos.leaderEndX != null && pos.leaderEndY != null) {
            return project3D({ x: pos.leaderEndX * _xySF, y: pos.leaderEndY * _xySF, z: (pos.z ?? 0) * zScale }, proj);
          }
          return null;
        };

        // Позиция маркера с притягиванием к концу выноски при фиксированном масштабе
        const markerScreenPos = (pos: Position): { sx: number; sy: number } => {
          const base = posProj(pos);
          if (!fixedObjectScale || _rawPosSF <= 0) return base;
          const end = posLeaderEnd(pos);
          if (!end) return base;
          const clampRatio = posSF / _rawPosSF;
          if (clampRatio === 1) return base;
          return { sx: end.sx + (base.sx - end.sx) * clampRatio, sy: end.sy + (base.sy - end.sy) * clampRatio };
        };

        return (
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
            {/* Выноски (основная + дополнительные) */}
            {positions.map(pos => {
              if (pos.visible === false || pos.x == null) return null;
              const pm = markerScreenPos(pos);
              const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
              const lw = Math.max(0.3, (pos.leaderThickness ?? 0.02) * PX_PER_MM);
              // Собираем список концов: основная выноска + дополнительные
              const ends: { sx: number; sy: number; attached: boolean; key: string }[] = [];
              const mainEnd = posLeaderEnd(pos);
              if (mainEnd) ends.push({ ...mainEnd, attached: !!(pos.leaderBranchId && pos.leaderT != null), key: "main" });
              (pos.extraLeaders ?? []).forEach(el => {
                let e: { sx: number; sy: number } | null = null;
                let att = false;
                if (el.branchId && el.t != null) {
                  const br = branches.find(b => b.id === el.branchId);
                  const fromN = br ? projNodesMap.get(br.fromId) : null;
                  const toN   = br ? projNodesMap.get(br.toId)   : null;
                  if (fromN && toN) { e = { sx: fromN.sx + (toN.sx - fromN.sx) * el.t, sy: fromN.sy + (toN.sy - fromN.sy) * el.t }; att = true; }
                } else if (el.endX != null && el.endY != null) {
                  e = project3D({ x: el.endX * _xySF, y: el.endY * _xySF, z: (pos.z ?? 0) * zScale }, proj);
                }
                if (e) ends.push({ ...e, attached: att, key: el.id });
              });
              if (ends.length === 0) return null;
              return (
                <g key={`leader-${pos.id}`}>
                  {ends.map(end => {
                    const dx = end.sx - pm.sx, dy = end.sy - pm.sy;
                    const dist = Math.hypot(dx, dy);
                    if (dist < 2) return null;
                    const ux = dx / dist, uy = dy / dist;
                    const x1 = pm.sx + ux * (r + 2), y1 = pm.sy + uy * (r + 2);
                    return (
                      <g key={end.key}>
                        <line x1={x1} y1={y1} x2={end.sx} y2={end.sy}
                          stroke="#e11d48" strokeWidth={lw} strokeDasharray="6,3" strokeLinecap="round" opacity={0.95} />
                        {/* Якорь выноски прозрачный — как в рабочей области (виден только при наведении) */}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {/* Маркеры */}
            {positions.map(pos => {
              if (pos.visible === false || pos.x == null) return null;
              const { sx, sy } = markerScreenPos(pos);
              const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
              const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
              const isReverse = pos.positionType === "reverse";
              return (
                <g key={pos.id} transform={`translate(${sx},${sy})`}>
                  {isReverse && (
                    <>
                      <circle r={r + r * 0.14} fill="none" stroke="#e53e3e" strokeWidth={Math.max(1, r * 0.06)} />
                      <circle r={r + r * 0.08} fill="none" stroke="#fff" strokeWidth={Math.max(1, r * 0.07)} />
                    </>
                  )}
                  <circle r={r} fill={pos.color} stroke={pos.borderColor ?? "#000000"} strokeWidth={Math.max(0.5, r * 0.12)} />
                  <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={700}
                    fill="#000000" style={{ userSelect: "none" }}>{pos.number}</text>
                </g>
              );
            })}
          </svg>
        );
      })()}

      {/* Текстовые блоки — как в рабочей области */}
      {textBlocks.length > 0 && (() => {
        const _xySF = xyScale ?? 1;
        const previewK = viewState.scale > 0 ? activeView.scale / viewState.scale : 1;
        const pxPerMm = 3.78 * Math.min(8, Math.max(0.25, viewState.scale / (_xySF * 0.5))) * previewK;
        return (
          <svg
            style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
            width={width} height={height}
          >
            {textBlocks.map((tb) => {
              const { sx, sy } = project3D({ x: tb.x * _xySF, y: tb.y * _xySF, z: 0 }, proj);
              const fsPx = tb.fontSize * pxPerMm;
              const lines = tb.text.split("\n");
              const lineH = fsPx * 1.35;
              const maxLen = Math.max(...lines.map(l => l.length), 4);
              const estW = Math.max(60 * previewK, maxLen * fsPx * 0.58 + 16 * previewK);
              const estH = lines.length * lineH + 12 * previewK;
              return (
                <g key={tb.id} transform={`translate(${sx},${sy})`}>
                  {tb.background !== "none" && (
                    <rect x={-estW/2} y={-estH/2} width={estW} height={estH} fill={tb.background} rx={3} />
                  )}
                  {tb.borderColor !== "none" && (
                    <rect x={-estW/2} y={-estH/2} width={estW} height={estH}
                      fill="none" stroke={tb.borderColor} strokeWidth={1} rx={3} />
                  )}
                  {lines.map((line, li) => (
                    <text key={li}
                      x={0} y={(-estH/2 + 8 * previewK) + li * lineH + fsPx * 0.8}
                      textAnchor="middle" fill={tb.color} fontSize={fsPx}
                      fontWeight={tb.bold ? "bold" : "normal"}
                      fontStyle={tb.italic ? "italic" : "normal"}
                      fontFamily="sans-serif"
                      style={{ userSelect: "none" }}
                    >{line}</text>
                  ))}
                </g>
              );
            })}
          </svg>
        );
      })()}

      {/* SVG слоя печати поверх canvas */}
      {printLayerRects.length > 0 && (
        <svg
          style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
          width={width} height={height}
        >
          {printLayerRects.map(({ h, pl, rx, ry, rw, rh }) => (
            <g key={h.id}>
              {renderPrintLayerSvgContent({ pl, rx, ry, rw, rh, schemaSymbols, branches })}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
});

export default PrintPreviewCanvas;