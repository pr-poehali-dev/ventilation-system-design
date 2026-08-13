import React from "react";
import { type TopoBranch, project3D } from "@/lib/topology";
import { BULKHEAD_SYMBOL_IDS, HEATER_SYMBOL_IDS, VENT_JET_SYMBOL_IDS, fanSvgContent } from "@/lib/schemaSymbols";
import { getUnit } from "@/lib/unitsConfig";
import { solidBulkheadRkMurg } from "@/lib/bulkheads";
import { type Props, type ViewState, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Оверлей УСЛОВНЫХ ОБОЗНАЧЕНИЙ поверх canvas (вынесено из TopoCanvas.tsx).
// Разметка и логика перенесены 1:1, поведение не менялось.
//
// Зачем нужен: в canvas-режиме (большие схемы) сама схема рисуется на холсте,
// а символы УО остаются интерактивным SVG поверх него — иначе по ним нельзя
// было бы кликать и таскать их мышью.
// ─────────────────────────────────────────────────────────────────────────────

/** Всё, что оверлею нужно от TopoCanvas: данные, состояние вида и обработчики. */
export interface SymbolsOverlayDeps {
  useCanvas: boolean;
  size: { w: number; h: number };
  view: ViewState;
  cursorStyle: string;
  panStart: unknown;
  rotStart: unknown;
  isZooming: boolean;
  fixedObjectScale: boolean;
  branchBorder: number;
  scaleLimits?: Props["scaleLimits"];
  editingPrintLayerId?: string | null;
  tool: Props["tool"];
  branches: TopoBranch[];
  branchesSorted: { branch: TopoBranch; depth: number; hOrder: number }[];
  nodesSorted: ProjNodeEntry[];
  projNodesMap: Map<string, ProjNodeEntry>;
  projectWithZ: (p: { x: number; y: number; z: number }) => { sx: number; sy: number; depth: number };
  branchById: Map<string, TopoBranch>;
  legendTypeById: Map<string, (typeof import("@/lib/schemaSymbols"))["LEGEND_TYPES"][number]>;
  horizonOrderMap: Map<string, number>;
  nodeAdjBranches: Map<string, TopoBranch[]>;
  hiddenBranchIds: Set<string>;
  hiddenNodeIds: Set<string>;
  pollutedBranchIds: Set<string>;
  branchBodyColor: (b: TopoBranch) => string | null;
  schemaSymbolsSorted: NonNullable<Props["schemaSymbols"]>;
  handleSymbolClick: (id: string, isCtrl: boolean) => void;
  _xySF: number;
  _objSF: number;
  _branchObjSF: number;
  _indZoomSF: number;
  branchWidth: number;
  thinLines: boolean;
  bulkheadScale: number;
  fanScale: number;
  flowDisplay: NonNullable<Props["flowDisplay"]>;
  animSpeed: number;
  showFlowArrows: boolean;
  rescuePickMode?: Props["rescuePickMode"];
  selectedSymbolId?: string | null;
  selectedSymbolIds?: Set<string>;
  selectedNodeId: string | null;
  selectedNodeIds?: Set<string>;
  infoConfig: Props["infoConfig"];
  unitsConfig: NonNullable<Props["unitsConfig"]>;
  branchFireColors?: Props["branchFireColors"];
  xyScale: number;
  onSelectSymbol?: Props["onSelectSymbol"];
  onSymbolMove?: Props["onSymbolMove"];
  onSymbolMoveAlongBranch?: Props["onSymbolMoveAlongBranch"];
  onSymbolOffset?: Props["onSymbolOffset"];
  onSymbolIndOffset?: Props["onSymbolIndOffset"];
  onSymbolMsIndOffset?: Props["onSymbolMsIndOffset"];
  onSymbolDragStart?: Props["onSymbolDragStart"];
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseUp: () => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onMouseDownCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMoveCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUpCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onWheelCanvas: (e: React.WheelEvent<HTMLCanvasElement>) => void;
  onContextMenuCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onDoubleClickCanvas: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

export default function TopoCanvasSymbolsOverlay(deps: SymbolsOverlayDeps) {
  const {
    useCanvas, size, view, cursorStyle, panStart, rotStart, isZooming, fixedObjectScale,
    branchBorder, scaleLimits,
    editingPrintLayerId, tool,
    branches, branchesSorted, nodesSorted, projNodesMap, projectWithZ,
    branchById, legendTypeById, horizonOrderMap, nodeAdjBranches,
    hiddenBranchIds, hiddenNodeIds, pollutedBranchIds, branchBodyColor,
    schemaSymbolsSorted, handleSymbolClick,
    _xySF, _objSF, _branchObjSF, _indZoomSF,
    branchWidth, thinLines, bulkheadScale, fanScale,
    flowDisplay, animSpeed, showFlowArrows, rescuePickMode,
    selectedSymbolId, selectedSymbolIds, selectedNodeId, selectedNodeIds,
    infoConfig, unitsConfig, branchFireColors, xyScale,
    onSelectSymbol, onSymbolMove, onSymbolMoveAlongBranch, onSymbolOffset,
    onSymbolIndOffset, onSymbolMsIndOffset, onSymbolDragStart,
    onMouseDown, onMouseMove, onMouseUp, onWheel,
    onMouseDownCanvas, onMouseMoveCanvas, onMouseUpCanvas, onWheelCanvas,
    onContextMenuCanvas, onDoubleClickCanvas,
  } = deps;

  return (
    <>
  {/* ── Оверлей УО поверх canvas (видим всегда, интерактивен) ───────── */}
  {/* zIndex должен быть ВЫШЕ canvas-слоя. При активном слое печати canvas
      поднимается на zIndex:1 (см. CanvasLayer, transparentBg) — если оверлей
      УО останется на auto(0), canvas перекроет символы и клики по ним не
      дойдут. Поэтому держим оверлей на zIndex:2. В режиме редактирования
      печати опускаем его (0), чтобы ручки рамки/штампа были доступны. */}
  {useCanvas && (
    <svg
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "auto", touchAction: "none", userSelect: "none", cursor: cursorStyle, zIndex: editingPrintLayerId ? 0 : 2 }}
      width={size.w} height={size.h}
      onMouseDown={(e) => {
        // В режиме выбора узла/ветви для горноспасателей клик должен доходить
        // до схемы, даже если сверху лежит символ УО — иначе в canvas-режиме
        // по закрытому символом узлу невозможно попасть.
        if (!rescuePickMode && (e.target as SVGElement).closest("g[data-sym]")) return;
        onMouseDownCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      }}
      onMouseMove={(e) => onMouseMoveCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onMouseUp={(e) => onMouseUpCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onDoubleClick={(e) => onDoubleClickCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onContextMenu={(e) => onContextMenuCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>)}
      onWheel={(e) => onWheelCanvas(e as unknown as React.WheelEvent<HTMLCanvasElement>)}>
      {(() => {
      // Во время перетаскивания/вращения/зума схемы не перерисовываем тяжёлый
      // оверлей УО (на больших схемах это тормозит и даёт «шлейф»). Ветви
      // на canvas двигаются дёшево, а символы вернутся сразу после остановки.
      if (panStart || rotStart || isZooming) return null;
      // Границы видимой области для отсечения (culling) символов вне экрана.
      // На больших схемах (>10000 УО) это убирает тысячи невидимых DOM-нод,
      // из-за которых тормозила вся программа.
      const OV_CULL = 120;
      const ovMinX = -OV_CULL, ovMaxX = size.w + OV_CULL;
      const ovMinY = -OV_CULL, ovMaxY = size.h + OV_CULL;
      const renderOneOv = (sym: typeof schemaSymbolsSorted[number]): React.ReactNode => {
        const isBulkheadOv = BULKHEAD_SYMBOL_IDS.has(sym.typeId) || sym.typeId === "measure_station";
        const lt = legendTypeById.get(sym.typeId);
        if (!lt && !isBulkheadOv) return null;
        if (sym.branchId && hiddenBranchIds.has(sym.branchId)) return null;
        // Видимость запорного вентиля по всей схеме — переключатель в панели информации
        if (sym.typeId === "valve_water" && infoConfig && !infoConfig.waterGateValve) return null;
        // Видимость насоса (УО «Насос» = «Насосная станция» в панели информации)
        if (sym.typeId === "pump" && infoConfig && !infoConfig.waterPumpStation) return null;
        // Видимость редукционного клапана
        if (sym.typeId === "valve_reduce" && infoConfig && !infoConfig.waterReducer) return null;
        // Ветвь символа (один раз) — переиспользуем ниже вместо branches.find.
        const symBr = sym.branchId ? branchById.get(sym.branchId) : null;

        let basePx: number, basePy: number;
        let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;
        if (sym.branchId) {
          const br = symBr;
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
        // Viewport culling: символ вне видимой области — не создаём DOM-ноду.
        // Выделенные символы не отсекаем (могут понадобиться ручки/подсветка).
        const isSelCull = selectedSymbolId === sym.id || (selectedSymbolIds?.has(sym.id) ?? false);
        if (!isSelCull && (px < ovMinX || px > ovMaxX || py < ovMinY || py > ovMaxY)) return null;
        const isSel = isSelCull;
        const sc = sym.scale ?? 1;
        // Режим 1 (fixedObjectScale=true): фиксированный размер символов при зуме.
        // Режим 2 (fixedObjectScale=false): символы масштабируются вместе с объектами (objSF).
        let symScaleV: number;
        if (fixedObjectScale) {
          if (view.scale < 0.4) { symScaleV = view.scale / 0.4; }
          else { const k = (view.scale - 0.4) / 0.4; symScaleV = 1 + 2 * (k / (k + 2)); }
        } else {
          symScaleV = view.scale / 0.4;
        }

        // Авто-масштаб УО «Очаг пожара» от ширины ветви (как valve_reduce).
        // Если у пользователя явно задан scale ≠ 1, используем его поверх авто-базы.
        let SZ: number;
        if (sym.typeId === "fire_source" && sym.branchId && hasBranchPts) {
          const fireBw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
          const autoSZ = Math.max(8, fireBw * view.scale * 4);
          SZ = Math.max(8, autoSZ * sc);
        } else if ((BULKHEAD_SYMBOL_IDS.has(sym.typeId) || HEATER_SYMBOL_IDS.has(sym.typeId) || sym.typeId === "measure_station" || sym.typeId === "emergency_exit") && sym.branchId && hasBranchPts) {
          const msBw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
          // Реальная толщина ветви в пикселях на экране (тот же objSF, что и
          // при отрисовке ветвей в canvasRenderer). Благодаря этому перемычка
          // масштабируется СИНХРОННО с шириной ветви при любом масштабе XY.
          const realBranchW = Math.max(msBw * _branchObjSF, 1.0);
          // Высота перемычки поперёк ветви = ширина ветви × (bulkheadScale%).
          // ph = SZ * 0.85 → SZ = ph / 0.85.
          const ph = realBranchW * (bulkheadScale / 100);
          SZ = Math.max(6, (ph / 0.85) * sc);
        } else if ((sym.typeId === "fan" || sym.typeId === "pump" || sym.typeId === "valve_water" || sym.typeId === "valve_reduce") && sym.branchId && hasBranchPts) {
          // Вентилятор, насос, запорный вентиль и редукционный клапан
          // масштабируются от ширины ветви (как перемычка) — синхронно
          // с масштабом схемы, не «плавают» при зуме.
          const fanBw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
          const realBwFan = Math.max(fanBw * _branchObjSF, 1.0);
          SZ = Math.max(8, realBwFan * (fanScale / 100) * sc);
        } else {
          SZ = Math.max(4, 32 * sc * symScaleV);
        }

        const HX = px - SZ / 2;
        const HY = py - SZ / 2 - 4;

        // Для valve_reduce — вычисляем реальный центр на линии трубы
        let vcpx = px, vcpy = py, vSZ = SZ;
        if (sym.typeId === "valve_reduce" && hasBranchPts) {
          const vDx = tsx2 - fsx, vDy = tsy2 - fsy;
          const vLen = Math.hypot(vDx, vDy);
          const vnx = vLen > 0 ? -vDy / vLen : 0, vny = vLen > 0 ? vDx / vLen : 0;
          const vbw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
          vcpx = px + vnx * vbw * 0.38;
          vcpy = py + vny * vbw * 0.38;
          // Размер берём из SZ, посчитанного выше по ширине ветви и «Масштабу УО»
          // (как у вентилятора/насоса). Раньше здесь стояла собственная формула
          // vbw*view.scale*4, которая игнорировала ползунок «Масштаб УО» —
          // клапан не менял размер и «плавал» относительно остальных символов.
          vSZ = SZ;
        }

        // Вентилятор: остановлен ли (берём из branch.fanStopped)
        const brForSymOv = symBr;
        const isFanStoppedOv = sym.typeId === "fan" && (brForSymOv?.fanStopped ?? false);

        return (
          <g key={sym.id} data-sym={sym.id}
            style={{ cursor: rescuePickMode ? "cell" : (tool === "select" ? "move" : undefined) }}
            onMouseDown={(e) => {
              // В режиме выбора узла/ветви для горноспасателей символ УО не
              // перехватывает клик — передаём его в общий обработчик схемы,
              // чтобы можно было выбрать узел, закрытый этим символом.
              if (rescuePickMode && e.button === 0) {
                onMouseDownCanvas(e as unknown as React.MouseEvent<HTMLCanvasElement>);
                return;
              }
              if (e.button !== 0 || tool !== "select") return;
              e.stopPropagation(); e.preventDefault();
              onSelectSymbol?.(sym.id);
              const startX = e.clientX, startY = e.clientY;
              let didDrag = false;
              if (sym.branchId && hasBranchPts) {
                const snapFsx = fsx, snapFsy = fsy, snapTsx = tsx2, snapTsy = tsy2;
                const brLen2 = (snapTsx - snapFsx) ** 2 + (snapTsy - snapFsy) ** 2;
                const origOx = sym.offsetX ?? 0, origOy = sym.offsetY ?? 0;
                const svgEl = (e.currentTarget as SVGElement).closest("svg")!;
                const onMove = (me: MouseEvent) => {
                  if (!didDrag && Math.hypot(me.clientX - startX, me.clientY - startY) < 4) return;
                  if (!didDrag) onSymbolDragStart?.(sym.id);
                  didDrag = true;
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
                const onUp = (ue: MouseEvent) => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                  if (!didDrag) handleSymbolClick(sym.id, ue.ctrlKey || ue.metaKey);
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
                  onSymbolMove?.(sym.id, origX + (me.clientX - startX) / view.scale, origY - (me.clientY - startY) / view.scale);
                };
                const onUp = (ue: MouseEvent) => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                  if (!didDrag) handleSymbolClick(sym.id, ue.ctrlKey || ue.metaKey);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
              } else {
                const onUp = (ue: MouseEvent) => {
                  window.removeEventListener("mouseup", onUp);
                  handleSymbolClick(sym.id, ue.ctrlKey || ue.metaKey);
                };
                window.addEventListener("mouseup", onUp);
              }
            }}>
            {/* hitbox — для valve_reduce сдвинут к линии трубы;
                для струй — вытянут ВДОЛЬ ветви (клик по хвосту/острию) */}
            {VENT_JET_SYMBOL_IDS.has(sym.typeId) && hasBranchPts ? (() => {
              const jAng = Math.atan2(tsy2 - fsy, tsx2 - fsx) * 180 / Math.PI;
              const jbw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
              const wj = Math.max(1.0, jbw * _branchObjSF);
              const sc2 = sym.scale ?? 1;
              const hLen = Math.max(28, (wj * 3.2 + wj * 2.2) * sc2);
              const hThick = Math.max(16, wj * 1.2 * sc2);
              return (
                <g transform={`translate(${px},${py}) rotate(${jAng})`}>
                  <rect x={-hLen / 2} y={-hThick / 2} width={hLen} height={hThick} fill="transparent" stroke="none" />
                </g>
              );
            })() : (
              <rect x={vcpx - vSZ / 2 - 4} y={vcpy - vSZ / 2 - 4} width={vSZ + 8} height={vSZ + 8} fill="transparent" stroke="none" />
            )}
            {/* Подложка цвета ветви ПОД символом УО: в canvas-режиме символы
                рисуются в оверлее поверх холста и белым перекрывают окраску
                ветви. Кладём сегмент цвета ветви вдоль неё, чтобы окраска не
                прерывалась (для ЛЮБОГО символа на ветви, кроме valve_reduce —
                тот сидит на трубе, а не на теле ветви). */}
            {sym.branchId && hasBranchPts && sym.typeId !== "valve_reduce"
              // Для иконок-изображений (вентилятор/насос/запорный вентиль)
              // подложка НЕ нужна: сама иконка непрозрачна (белый фон-круг) и
              // перекрывает разрыв окраски ветви. Прямоугольная подложка у них
              // «вылезала» вдоль ветви за пределы иконки (как было у перемычек).
              && sym.typeId !== "fan" && sym.typeId !== "pump" && sym.typeId !== "valve_water"
              && (() => {
              const brBody = symBr;
              const bodyCol = branchBodyColor(brBody ?? ({ id: sym.branchId } as TopoBranch));
              if (!bodyCol) return null;
              const bDx = tsx2 - fsx, bDy = tsy2 - fsy;
              const bLen = Math.hypot(bDx, bDy) || 1;
              const bAng = Math.atan2(bDy, bDx) * 180 / Math.PI;
              const uBw = (brBody?.lineWidth && brBody.lineWidth > 0) ? brBody.lineWidth : branchWidth;
              const uW = Math.max(1.5, uBw * _branchObjSF);
              // Длина подложки вдоль ветви.
              // Для перемычек/замерных станций символ узкий вдоль ветви
              // (реальный габарит ≈ pw = ph·0.38·… ≈ SZ·0.85·0.38), поэтому
              // подложка должна совпадать с этим габаритом, иначе она «вылезает»
              // на соседние перемычки и, просвечивая в зазорах открытых дверей,
              // выглядит как белый прямоугольник поверх соседей. Берём ровно
              // ширину символа вдоль ветви (без множителя-запаса).
              // Для остальных символов (иконки, вентиляторы) — прежний размер SZ+uW.
              const uLen = isBulkheadOv
                ? Math.max(uW, SZ * 0.85 * 0.38 + uW * 0.5)
                : Math.max(uW, SZ + uW);
              // Проекция символа на линию ветви (t вдоль from→to) — подложку
              // ставим на САМУ ветвь (не на смещённый offset'ом символ), чтобы
              // окраска не прерывалась именно в точке пересечения с ветвью.
              const tRaw = ((px - fsx) * bDx + (py - fsy) * bDy) / (bLen * bLen);
              const tClamp = Math.max(0, Math.min(1, tRaw));
              const anchorX = fsx + bDx * tClamp;
              const anchorY = fsy + bDy * tClamp;
              // ВАЖНО: стрелка направления воздуха здесь НЕ рисуется — иначе она
              // ложится поверх соседних символов УО (стрелка одного символа
              // перекрывала перемычку другого). Стрелки выведены в отдельный
              // проход ПОД символами (renderArrowOv), как в SVG-режиме.
              return (
                <g pointerEvents="none">
                  <g transform={`translate(${anchorX},${anchorY}) rotate(${bAng})`}>
                    <rect x={-uLen / 2} y={-uW / 2} width={uLen} height={uW} fill={bodyCol} stroke="none" />
                  </g>
                </g>
              );
            })()}
            {isSel && <circle cx={vcpx} cy={vcpy} r={vSZ / 2 + 4} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" />}
            {/* Запасной выход: по направлению и ширине ветви */}
            {sym.typeId === "emergency_exit" && hasBranchPts ? (() => {
              const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
              const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
              const eeBw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
              const realBwEe = Math.max(eeBw * _branchObjSF, 1.0);
              // Ширина символа = точно ширина ветви на экране
              const halfH = Math.max(1.2, (realBwEe / 2) * (sym.scale ?? 1));
              const totalLen = halfH * 5.2;   // длиннее вдоль ветви
              const yW = totalLen / 4.4;
              const bW = totalLen / 3.7;
              const seq: { w: number; fill: string }[] = [
                { w: yW, fill: "#ffd600" },
                { w: bW, fill: "#111" },
                { w: yW, fill: "#ffd600" },
                { w: bW, fill: "#111" },
              ];
              const sumW = seq.reduce((s, p) => s + p.w, 0);
              let cursor = -sumW / 2;
              return (
                <g transform={`translate(${px},${py}) rotate(${brAngle})`} pointerEvents="none">
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
            })() : null}
            {/* Калорифер: та же геометрия и масштаб, что в SVG-режиме */}
            {HEATER_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts ? (() => {
              const brAngle = Math.atan2(tsy2 - fsy, tsx2 - fsx) * 180 / Math.PI;
              const bkBwH = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
              const realBwH = Math.max(bkBwH * _branchObjSF, 1.0);
              const SZh = Math.max(6, (realBwH * (bulkheadScale / 100) / 0.85) * (sym.scale ?? 1));
              const ph = Math.max(3, SZh * 0.85);
              const pw = Math.max(2, ph * 0.55);
              const sw2 = Math.max(0.4, pw * 0.14);
              const coils = 4;
              const lines = [];
              for (let i = 0; i < coils; i++) {
                const y = -ph / 2 + (ph / (coils + 1)) * (i + 1);
                lines.push(
                  <line key={`hco${i}`} x1={-pw * 0.32} y1={y} x2={pw * 0.32} y2={y}
                    stroke="#e65100" strokeWidth={Math.max(0.8, ph * 0.07)} strokeLinecap="round" />
                );
              }
              return (
                <g transform={`translate(${px},${py}) rotate(${brAngle})`} pointerEvents="none">
                  <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph}
                    fill="#fff3e0" stroke="#1a1a1a" strokeWidth={sw2} />
                  {lines}
                </g>
              );
            })() : null}
            {/* Перемычки: рисуем геометрически с поворотом по углу ветви */}
            {isBulkheadOv && hasBranchPts ? (() => {
              const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
              const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
              const tid = sym.typeId;
              const bkBrOv = symBr;
              const isDestroyedOv = bkBrOv?.bulkheadDestroyedByExplosion ?? false;
              const fillOv  = isDestroyedOv ? "#ff4444"
                : tid.includes("conc") ? "#4caf50" : tid.includes("wood") ? "#ffd600"
                : tid.includes("brick") ? "#ff9800" : tid.includes("metal") ? "#9c27b0"
                : tid.includes("regulator") ? "#ffd600"
                : (tid === "fire_door" || tid === "fire_door_pp") ? "#c00"
                : tid === "barrier" ? "#555" : "white";
              // Контур перемычки — всегда чёрный (кроме разрушенной и
              // противопожарной), чтобы не сливался с заливкой по материалу.
              const strokeOv = isDestroyedOv ? "#8b0000"
                : (tid === "fire_door" || tid === "fire_door_pp") ? "#800" : "#1a1a1a";
              const bkBwOv = (bkBrOv?.lineWidth && bkBrOv.lineWidth > 0) ? bkBrOv.lineWidth : branchWidth;
              // Размер перемычки синхронизирован с реальной шириной ветви на
              // экране (_objSF) × bulkheadScale% — не зависит от масштаба XY.
              const realBwOv = Math.max(bkBwOv * _branchObjSF, 1.0);
              const SZov = Math.max(6, (realBwOv * (bulkheadScale / 100) / 0.85) * (sym.scale ?? 1));
              const ph = Math.max(3, SZov * 0.85);
              const pw = Math.max(1.5, ph * 0.38);
              const gap = Math.max(1, pw * 0.5);
              const sw2 = Math.max(0.4, pw * 0.18);
              const isMeasureStationOv = tid === "measure_station";
              const isDoor    = tid.includes("door_closed") || tid.includes("door_conc") || tid.includes("door_wood") || tid.includes("door_brick") || tid.includes("door_metal") || tid === "door_base";
              const isAuto    = tid.includes("door_auto") || tid.includes("auto_");
              const isOpen    = tid.includes("regulator_open") || tid.includes("open_");
              const isWindow  = tid === "regulator_window" || tid.includes("win_") || tid === "bulkhead_window";
              const isLattice = tid === "regulator_lattice" || tid.includes("lat_");
              const isWater   = tid.includes("water_dam");
              const isSailOv  = tid === "sail";
              const isBarrier = tid === "barrier" || tid === "bulkhead_barrier";
              const isFirePP  = tid === "fire_door_pp";
              const isProem   = tid.includes("proem_");
              const isRegulatorOv = tid === "regulator";
              return (
                <g transform={`translate(${px},${py}) rotate(${brAngle})`} pointerEvents="none">
                  {isMeasureStationOv ? (() => {
                    const ml = ph * 1.1;
                    const mt = Math.max(1.5, ph * 0.22);
                    const moff = Math.max(1, ph * 0.17);
                    const sw = Math.max(0.4, mt * 0.12);
                    return (<>
                      <rect x={-ml/2} y={-moff-mt} width={ml} height={mt} fill="#dc2626" stroke="#8b0000" strokeWidth={sw} />
                      <rect x={-ml/2} y={moff} width={ml} height={mt} fill="#dc2626" stroke="#8b0000" strokeWidth={sw} />
                    </>);
                  })() : isSailOv ? (<>
                    <line x1={0} y1={-ph/2} x2={0} y2={ph/2} stroke={strokeOv} strokeWidth={Math.max(1.8, pw*0.4)} strokeLinecap="round" />
                    <path d={`M0,${-ph*0.38} Q${ph*0.6},0 0,${ph*0.38}`} fill="none" stroke={strokeOv} strokeWidth={Math.max(1.8, pw*0.4)} strokeLinecap="round" />
                  </>) : isBarrier ? (<>
                    <rect x={-pw} y={-ph/2} width={pw} height={ph} fill="#555" stroke="#222" strokeWidth={1.3} />
                    <rect x={0} y={-ph/2} width={pw} height={ph} fill="#c00" stroke="#800" strokeWidth={1.3} />
                  </>) : isFirePP ? (<>
                    <rect x={-pw-gap/2} y={-ph/2} width={pw} height={ph} fill="#dc2626" stroke="#8b0000" strokeWidth={1.3} />
                    <rect x={gap/2} y={-ph/2} width={pw} height={ph} fill="#dc2626" stroke="#8b0000" strokeWidth={1.3} />
                  </>) : isOpen ? (<>
                    <rect x={-pw/2} y={-ph/2} width={pw} height={ph*0.38} fill={fillOv} stroke={strokeOv} strokeWidth={sw2} />
                    <rect x={-pw/2} y={ph*0.12} width={pw} height={ph*0.38} fill={fillOv} stroke={strokeOv} strokeWidth={sw2} />
                    <line x1={-pw/2} y1={ph*0.12} x2={-pw/2-ph*0.45} y2={ph/2} stroke={strokeOv} strokeWidth={Math.max(1.8,pw*0.3)} strokeLinecap="round" />
                  </>) : (isDoor || isAuto) ? (<>
                    <rect x={-pw/2} y={-ph/2} width={pw} height={ph} fill={fillOv} stroke={strokeOv} strokeWidth={sw2} />
                    <line x1={-pw/2} y1={-ph/2} x2={-pw/2} y2={ph/2} stroke={strokeOv} strokeWidth={Math.max(2,pw*0.35)} strokeLinecap="round" />
                    {isAuto && <g transform={`translate(${pw/2+ph*0.28},0)`}><circle r={ph*0.2} fill="white" stroke={strokeOv} strokeWidth={1.2} /><text textAnchor="middle" dominantBaseline="central" fontSize={ph*0.2} fontWeight="bold" fill={strokeOv}>А</text></g>}
                  </>) : (<>
                    {isRegulatorOv && <line x1={-ph} y1={0} x2={ph} y2={0} stroke={strokeOv} strokeWidth={Math.max(1.2, pw*0.28)} strokeLinecap="round" />}
                    <rect x={-pw/2} y={-ph/2} width={pw} height={ph} fill={fillOv} stroke={strokeOv} strokeWidth={sw2} />
                    {(isWindow || isProem) && <rect x={-pw*0.25} y={-ph*0.2} width={pw*0.5} height={ph*0.4} fill="white" stroke={strokeOv} strokeWidth={1} />}
                    {isLattice && [[-1,0,1].map(i => <line key={`v${i}`} x1={pw*0.2*i} y1={-ph*0.45} x2={pw*0.2*i} y2={ph*0.45} stroke={strokeOv} strokeWidth={0.8} />), <line key="h0" x1={-pw*0.4} y1={0} x2={pw*0.4} y2={0} stroke={strokeOv} strokeWidth={0.8} />]}
                    {isWater && <text textAnchor="middle" dominantBaseline="central" fontSize={ph*0.3} fontWeight="bold" fill={fillOv==="white"?"#1565c0":"white"}>D</text>}
                    {tid==="fire_door" && <text textAnchor="middle" dominantBaseline="central" fontSize={ph*0.22} fontWeight="bold" fill="white">ПП</text>}
                  </>)}
                </g>
              );
            })() : sym.typeId === "valve_reduce" && hasBranchPts ? (() => {
              const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
              const brLen = Math.hypot(brDx, brDy);
              const ax = brLen > 0 ? brDx / brLen : 1, ay = brLen > 0 ? brDy / brLen : 0;
              const nx = -ay, ny = ax; // нормаль как в canvasRenderer
              const brObj = symBr;
              const bw = (brObj?.lineWidth && brObj.lineWidth > 0) ? brObj.lineWidth : branchWidth;
              const pipeOff = bw * 0.38;
              const cpx = px + nx * pipeOff;
              const cpy = py + ny * pipeOff;
              // Размер — из общего SZ (ширина ветви × «Масштаб УО»), как
              // у вентилятора и насоса. Совпадает с vSZ, посчитанным выше.
              const valveSZ = vSZ * 1.2;
              const HS = valveSZ * 0.55, HT = valveSZ * 0.45;
              const lw = Math.max(0.5, valveSZ * 0.09);
              const q = (da: number, dn: number) => `${cpx + ax*da + nx*dn},${cpy + ay*da + ny*dn}`;
              return (
                <g pointerEvents="none">
                  <polygon points={`${q(-HS,-HT)} ${q(HS,-HT)} ${q(HS,HT)} ${q(-HS,HT)}`} fill="white" stroke="none" />
                  <polygon points={`${q(-HS,-HT)} ${q(HS,-HT)} ${q(HS,HT)} ${q(-HS,HT)}`} fill="white" stroke="#1d4ed8" strokeWidth={lw} />
                  <polygon points={`${q(-HS*0.65,-HT*0.55)} ${q(HS*0.65,-HT*0.55)} ${q(0,HT*0.6)}`} fill="#1d4ed8" />
                </g>
              );
            })() : VENT_JET_SYMBOL_IDS.has(sym.typeId) && hasBranchPts ? (() => {
              // Вентиляционная струя (canvas-режим) — стрелка ВДОЛЬ ветви,
              // размеры 1:1 с расчётной стрелкой потока (привязка к ширине ветви).
              const jDx = tsx2 - fsx, jDy = tsy2 - fsy;
              const jLen = Math.hypot(jDx, jDy);
              const ux = jLen > 0 ? jDx / jLen : 1, uy = jLen > 0 ? jDy / jLen : 0;
              const isFreshJet = sym.typeId === "fresh_inlet" || sym.typeId === "leak_inlet";
              const isLeakJet  = sym.typeId === "leak_inlet"  || sym.typeId === "leak_outlet";
              const jetColor = isFreshJet ? "#dc2626" : "#2563eb";
              let dir = isFreshJet ? 1 : -1;
              if (sym.airDirection === "reverse") dir = -dir;
              const jAngle = Math.atan2(uy * dir, ux * dir) * 180 / Math.PI;
              const jbw = (symBr?.lineWidth && symBr.lineWidth > 0) ? symBr.lineWidth : branchWidth;
              const w = Math.max(1.0, jbw * _branchObjSF);
              const scaleJ = sym.scale ?? 1;
              const tipHs = w * 2.2 * scaleJ, tipWs = w * 0.5 * scaleJ;
              const tailLenS = w * 3.0 * scaleJ, tailWs = Math.max(0.5, w * 0.15) * scaleJ;
              const pts = `0,-${tipWs} ${tipHs},0 0,${tipWs}`;
              const shift = (tailLenS - tipHs) / 2;
              return (
                <g transform={`translate(${px},${py}) rotate(${jAngle}) translate(${shift},0)`} pointerEvents="none">
                  <line x1={-tailLenS} y1={0} x2={0} y2={0}
                    stroke="white" strokeWidth={tailWs + 1.5} strokeLinecap="round" />
                  <polygon points={pts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                  <line x1={-tailLenS} y1={0} x2={0} y2={0}
                    stroke={jetColor} strokeWidth={tailWs} strokeLinecap="round"
                    strokeDasharray={isLeakJet ? `${tailWs * 3} ${tailWs * 2}` : undefined} />
                  <polygon points={pts} fill={jetColor} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
                </g>
              );
            })() : (lt && !(sym.typeId === "emergency_exit" && hasBranchPts)
                    && !(HEATER_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts)) ? (
              <svg x={HX} y={HY} width={SZ} height={SZ} viewBox="0 0 48 40"
                overflow="visible" pointerEvents="none"
                opacity={isFanStoppedOv ? 0.35 : 1}
                style={isFanStoppedOv ? { filter: "grayscale(1)" } : undefined}
                dangerouslySetInnerHTML={{ __html: sym.typeId === "fan" ? fanSvgContent(brForSymOv?.fanType) : lt.svgContent }} />
            ) : null}
            {/* Крестик на остановленном вентиляторе */}
            {isFanStoppedOv && (
              <g opacity={0.7} pointerEvents="none">
                <line x1={HX + SZ * 0.2} y1={HY + SZ * 0.2} x2={HX + SZ * 0.8} y2={HY + SZ * 0.8}
                  stroke="#6b7280" strokeWidth={Math.max(2, SZ / 14)} strokeLinecap="round" />
                <line x1={HX + SZ * 0.8} y1={HY + SZ * 0.2} x2={HX + SZ * 0.2} y2={HY + SZ * 0.8}
                  stroke="#6b7280" strokeWidth={Math.max(2, SZ / 14)} strokeLinecap="round" />
              </g>
            )}
            {/* 🔴 Закрытый запорный вентиль — красная подсветка (перекрыто) */}
            {sym.typeId === "valve_water" && (brForSymOv?.wpGateClosed ?? false) && (() => {
              const r = Math.max(7, SZ * 0.62);
              return (
                <g pointerEvents="none">
                  <circle cx={px} cy={py} r={r + 4} fill="#ef4444" opacity={0.16} />
                  <circle cx={px} cy={py} r={r} fill="none" stroke="#dc2626"
                    strokeWidth={Math.max(1.5, SZ / 12)} />
                </g>
              );
            })()}
            {/* Стрелка направления тяги вентилятора / направления насоса */}
            {!isFanStoppedOv && (sym.typeId === "fan" || sym.typeId === "pump") && sym.branchId && hasBranchPts
              && (sym.showFanArrow ?? true) && (() => {
              const brDxOv = tsx2 - fsx, brDyOv = tsy2 - fsy;
              const brAngleOv = Math.atan2(brDyOv, brDxOv) * 180 / Math.PI;
              const arrowAngleOv = sym.airDirection === "reverse"
                ? brAngleOv + 180 : brAngleOv;
              const iconCxOv = HX + SZ / 2;
              const iconCyOv = HY + SZ * (20 / 48);
              const rIconOv = SZ * (16 / 48);
              const aLenOv = SZ * 0.32;
              const strokeOv2 = Math.max(0.8, SZ * 0.045);
              const headOv = Math.max(3, SZ * 0.13);
              const arrColOv = sym.typeId === "pump" ? "#dc2626" : "#111";
              const x0Ov = rIconOv;
              const x1Ov = rIconOv + aLenOv;
              return (
                <g transform={`translate(${iconCxOv},${iconCyOv}) rotate(${arrowAngleOv})`} pointerEvents="none">
                  <line x1={x0Ov} y1={0} x2={x1Ov - headOv * 0.5} y2={0}
                    stroke={arrColOv} strokeWidth={strokeOv2} strokeLinecap="round" />
                  <polygon
                    points={`${x1Ov - headOv},${-headOv * 0.55} ${x1Ov},0 ${x1Ov - headOv},${headOv * 0.55}`}
                    fill={arrColOv} />
                </g>
              );
            })()}
            {/* ⚡ Маркер разрушенной перемычки (взрыв) — canvas-режим.
                Дублирует блок из SVG-рендера, чтобы состояние «разрушена
                взрывом» одинаково отображалось в обоих режимах. */}
            {BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId && hasBranchPts && (() => {
              const br = symBr;
              if (!br?.bulkheadDestroyedByExplosion) return null;
              const cx = px, cy = py;
              const r = Math.max(8, SZ * 0.7);
              const lw = Math.max(2.5, SZ * 0.22);
              const brDxD = tsx2 - fsx, brDyD = tsy2 - fsy;
              const brAngleD = Math.atan2(brDyD, brDxD) * 180 / Math.PI;
              const fp = br.bulkheadFailurePressure;
              const fpText = fp && fp > 0 ? `${fp} МПа` : null;
              return (
                <g pointerEvents="none">
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
            {/* ── Индикаторы перемычки на схеме (canvas-режим) ──────────
                Дублирует блок из SVG-рендера, т.к. в canvas-режиме основной
                SVG скрыт, а символы рисуются этим отдельным оверлеем. */}
            {view.scale > 0.05 && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.typeId !== "measure_station" && sym.branchId && hasBranchPts && (() => {
              const br = symBr;
              if (!br) return null;
              const lines: string[] = [];
              const uResInd  = getUnit(unitsConfig, "resistance");
              const uPresInd = getUnit(unitsConfig, "pressure");
              const uFlowInd = getUnit(unitsConfig, "flow");
              if (sym.indDescription && sym.description) lines.push(sym.description);
              if (sym.indResistance) {
                const mode = sym.bkResMode ?? "project";
                let rBase = 0; // в Мюрг (базовых единицах)
                if (mode === "manual") {
                  rBase = (sym.bkManualR ?? 0) * 1000; // кМюрг → Мюрг
                } else if (mode === "survey") {
                  const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                  // R = ΔP/(Q²·9.81) кМюрг → ×1000 → Мюрг (как в АэроСети)
                  rBase = sq > 0 ? (dp / (sq * sq * 9.81)) * 1000 : 0;
                } else {
                  const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0) : (sym.bkAirPerm ?? 0);
                  if (kAir > 0) {
                    // Глухая/парус: R = 1/(A·S)²/SCALE кМюрг → ×1000 → Мюрг (учёт сечения).
                    rBase = solidBulkheadRkMurg(kAir, br.area ?? 0) * 1000;
                  } else {
                    rBase = sym.bkBulkheadR ?? br.bulkheadR ?? 0; // уже в Мюрг
                  }
                }
                if (rBase === 0 && br.bulkheadR > 0) rBase = br.bulkheadR;
                if (rBase === 0) rBase = br.resistance / 9.81e-3; // Н·с²/м⁸ → Мюрг
                lines.push(`R=${uResInd.fromBase(rBase).toFixed(uResInd.decimals)} ${uResInd.symbol}`);
              }
              if (sym.indDeltaP && br.dP !== 0) lines.push(`ΔP=${uPresInd.fromBase(Math.abs(br.dP)).toFixed(uPresInd.decimals)} ${uPresInd.symbol}`);
              if (sym.indLeakage && br.flow !== 0) lines.push(`Q=${uFlowInd.fromBase(Math.abs(br.flow)).toFixed(uFlowInd.decimals)} ${uFlowInd.symbol}`);
              if (!lines.length) return null;

              // Масштабируем индикатор перемычки ТАК ЖЕ, как подписи ВЕТВЕЙ
              // (canvasRenderer): размер шрифта привязан к толщине ветви на
              // экране (branchPxLabel), а не к размеру самого УО. Благодаря
              // этому подписи перемычки и ветви на одной выработке совпадают
              // по размеру и одинаково масштабируются при зуме/масштабе XY.
              const bkBwLbl = (thinLines ? 1 : (br.lineWidth && br.lineWidth > 0 ? br.lineWidth : branchWidth)) * _branchObjSF;
              // Индикатор уменьшается вместе со схемой (как ветви): домножаем
              // масштаб текста на _indZoomSF при отдалении.
              const bkTextSc = Math.max(0.3, bkBwLbl * 0.28) * _indZoomSF;
              const baseFontPx = 8.5 * bkTextSc * ((sym.indFontSize ?? 9) / 9);
              const fSize = Math.max(3, baseFontPx);
              const lineH = fSize + 3 * _indZoomSF;
              const boxW = Math.max(...lines.map(l => l.length)) * fSize * 0.52 + 10 * _indZoomSF;
              const boxH = lines.length * lineH + 6 * _indZoomSF;

              const brDxI = tsx2 - fsx, brDyI = tsy2 - fsy;
              const brLenI = Math.hypot(brDxI, brDyI);
              const perpXI = brLenI > 0 ? -brDyI / brLenI : 0;
              const perpYI = brLenI > 0 ?  brDxI / brLenI : 0;
              // И базовый отступ, и пользовательское смещение уменьшаются
              // вместе со схемой (_branchObjSF * _indZoomSF), поэтому подпись
              // «приклеена» к значку и при отдалении уменьшается и приближается
              // к нему, а не уплывает.
              const indGap = 16 * _branchObjSF * _indZoomSF;
              const bx = px + perpXI * (indGap + boxW / 2) + (sym.indOffsetX ?? 0) * _branchObjSF * _indZoomSF;
              const by = py + perpYI * (indGap + boxH / 2) + (sym.indOffsetY ?? 0) * _branchObjSF * _indZoomSF;
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

            {/* ── Индикаторы замерной станции (canvas-режим) ────────────
                Дублирует блок из SVG-рендера, т.к. в canvas-режиме основной
                SVG скрыт, а символы рисуются этим отдельным оверлеем. */}
            {view.scale > 0.05 && sym.typeId === "measure_station" && hasBranchPts && (() => {
              const brMs = symBr;
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
              // ВЕТВЕЙ (canvasRenderer): размер шрифта привязан к толщине
              // ветви на экране (branchPxLabel), а не к размеру самого УО.
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
          </g>
        );
      };
      // Стрелка направления воздуха для символа — рисуется ПОД символами УО
      // (в отдельном проходе), чтобы стрелка одной перемычки не перекрывала
      // соседнюю. Возвращает только стрелку (без подложки/символа).
      const arrowSeenBrOv = new Set<string>();
      const renderArrowOv = (sym: typeof schemaSymbolsSorted[number]): React.ReactNode => {
        if (!sym.branchId || sym.typeId === "valve_reduce") return null;
        // Одна стрелка на ветвь (не дублируем для каждого символа на ветви).
        if (arrowSeenBrOv.has(sym.branchId)) return null;
        const brBody = branchById.get(sym.branchId);
        if (!brBody) return null;
        const fN = projNodesMap.get(brBody.fromId);
        const tN = projNodesMap.get(brBody.toId);
        if (!fN || !tN) return null;
        const Qb = Math.abs(brBody.flow ?? 0);
        const arrLod = view.scale >= 0.15;
        if (!(showFlowArrows && !thinLines && arrLod && Qb > 0.1)) return null;
        const uBw = (brBody.lineWidth && brBody.lineWidth > 0) ? brBody.lineWidth : branchWidth;
        const uW = Math.max(1.5, uBw * _branchObjSF);
        const reversedArr = (brBody.flow ?? 0) < 0 || (!!brBody.hasFan && (brBody.fanReverse ?? false) && (brBody.flow ?? 0) >= 0);
        const aAx = reversedArr ? tN.sx : fN.sx, aAy = reversedArr ? tN.sy : fN.sy;
        const aBx = reversedArr ? fN.sx : tN.sx, aBy = reversedArr ? fN.sy : tN.sy;
        const aDx = aBx - aAx, aDy = aBy - aAy;
        const aLen = Math.hypot(aDx, aDy) || 1;
        const aAng = Math.atan2(aDy, aDx) * 180 / Math.PI;
        const tipH = uW * 2.2, tipW = uW * 0.5, tailLen = uW * 3.0, tailW = Math.max(0.5, uW * 0.15);
        if (!(aLen >= (tailLen + tipH) * 2)) return null;
        arrowSeenBrOv.add(sym.branchId);
        const arrColor = pollutedBranchIds.has(sym.branchId) ? "#2563eb" : "#dc2626";
        const arrPts = `0,-${tipW} ${tipH},0 0,${tipW}`;
        return (
          <g key={`ovarr-${sym.branchId}`} pointerEvents="none"
            transform={`translate(${(aAx + aDx * 0.5).toFixed(1)},${(aAy + aDy * 0.5).toFixed(1)}) rotate(${aAng.toFixed(1)})`}>
            <line x1={-tailLen} y1={0} x2={0} y2={0} stroke="white" strokeWidth={tailW + 1.5} strokeLinecap="round" />
            <polygon points={arrPts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
            <line x1={-tailLen} y1={0} x2={0} y2={0} stroke={arrColor} strokeWidth={tailW} strokeLinecap="round" />
            <polygon points={arrPts} fill={arrColor} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
          </g>
        );
      };
      // Встраиваем УО в слои горизонтов (как в SVG-режиме). В canvas-режиме
      // ветви нарисованы на <canvas> ПОД этим оверлеем, поэтому чтобы символ
      // нижнего горизонта не перекрывал ветви верхнего, поверх символов слоя
      // дорисовываем ветви горизонтов, которые выше в списке.
      const out: React.ReactNode[] = [];
      const horizonOfOv = (sym: typeof schemaSymbolsSorted[number]): number => {
        const hz = sym.branchId ? (branchById.get(sym.branchId)?.horizonId ?? "") : "";
        return hz ? (horizonOrderMap.get(hz) ?? 9999) : 9999;
      };
      const ordersOv = Array.from(new Set(branchesSorted.map(x => x.hOrder))).sort((a, b) => b - a);
      const seenOv = new Set<number>();
      const occColor = (ob: TopoBranch): string => {
        // Перерисовка ветви-окклюдера ДОЛЖНА повторять её реальную окраску
        // (позиции ПЛА / расход / скорость / горизонт), иначе окрашенные ветви
        // верхних горизонтов возле символов перекрывались белым.
        return branchBodyColor(ob) ?? "#ffffff";
      };
      // Экранная позиция символа (для клипа occluder-а — чтобы не перекрашивать
      // ветви целиком, а лишь скрывать символ там, где его перекрывает верхний слой).
      const symScreenPos = (sym: typeof schemaSymbolsSorted[number]): { x: number; y: number } | null => {
        if (sym.branchId) {
          const br = branchById.get(sym.branchId);
          const fN = br ? projNodesMap.get(br.fromId) : null;
          const tN = br ? projNodesMap.get(br.toId) : null;
          if (fN && tN) {
            const t = sym.t ?? 0.5;
            return { x: fN.sx + (tN.sx - fN.sx) * t + (sym.offsetX ?? 0), y: fN.sy + (tN.sy - fN.sy) * t + (sym.offsetY ?? 0) };
          }
        }
        const pt = projectWithZ({ x: sym.x, y: sym.y, z: 0 });
        return { x: pt.sx + (sym.offsetX ?? 0), y: pt.sy + (sym.offsetY ?? 0) };
      };
      const clipR = Math.max(18, 40 * (fixedObjectScale ? 1 : view.scale / 0.4));
      // Группируем символы по порядку горизонта ОДИН раз (вместо скана всех
      // символов на каждый горизонт) — важно при большом числе перемычек.
      const symsByOrder = new Map<number, typeof schemaSymbolsSorted[number][]>();
      for (const sym of schemaSymbolsSorted) {
        const ho = horizonOfOv(sym);
        let arr = symsByOrder.get(ho);
        if (!arr) { arr = []; symsByOrder.set(ho, arr); }
        arr.push(sym);
      }
      for (const ord of ordersOv) {
        seenOv.add(ord);
        const ordSyms: { x: number; y: number }[] = [];
        // Сначала — стрелки направления воздуха этого слоя (ПОД символами УО).
        for (const sym of (symsByOrder.get(ord) ?? [])) {
          const arr = renderArrowOv(sym);
          if (arr) out.push(arr);
        }
        for (const sym of (symsByOrder.get(ord) ?? [])) {
          const node = renderOneOv(sym);
          if (node) out.push(<g key={`ovsym-${sym.id}`}>{node}</g>);
          const p = symScreenPos(sym);
          if (p) ordSyms.push(p);
        }
        // Occluder нужен только для перекрытия символов этого слоя ветвями
        // ВЫШЕ. Отбираем лишь те ветви, что реально проходят рядом с символом
        // (bbox-проверка) — иначе на больших схемах это тысячи лишних линий.
        if (ordSyms.length) {
          let minSx = Infinity, minSy = Infinity, maxSx = -Infinity, maxSy = -Infinity;
          for (const p of ordSyms) {
            if (p.x < minSx) minSx = p.x; if (p.x > maxSx) maxSx = p.x;
            if (p.y < minSy) minSy = p.y; if (p.y > maxSy) maxSy = p.y;
          }
          minSx -= clipR; minSy -= clipR; maxSx += clipR; maxSy += clipR;
          const nearHigher: typeof branchesSorted = [];
          for (const x of branchesSorted) {
            if (x.hOrder >= ord) continue;
            const f = projNodesMap.get(x.branch.fromId);
            const tN = projNodesMap.get(x.branch.toId);
            if (!f || !tN) continue;
            // bbox сегмента пересекает bbox символов слоя?
            if (Math.max(f.sx, tN.sx) < minSx || Math.min(f.sx, tN.sx) > maxSx) continue;
            if (Math.max(f.sy, tN.sy) < minSy || Math.min(f.sy, tN.sy) > maxSy) continue;
            nearHigher.push(x);
            if (nearHigher.length > 400) break; // страховка от вырожденных случаев
          }
          if (nearHigher.length) {
            const clipId = `occclip-${ord}`;
            out.push(
              <g key={`ovocc-${ord}`} style={{ pointerEvents: "none" }}>
                <defs>
                  <clipPath id={clipId}>
                    {ordSyms.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={clipR} />
                    ))}
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`}>
                {nearHigher.map(({ branch: ob }) => {
                  const f = projNodesMap.get(ob.fromId);
                  const tN = projNodesMap.get(ob.toId);
                  if (!f || !tN) return null;
                  const obw = (ob.lineWidth && ob.lineWidth > 0) ? ob.lineWidth : branchWidth;
                  const ow = Math.max((thinLines ? 1 : obw) * _branchObjSF, 1);
                  const bb = (ob.lineBorder !== undefined && ob.lineBorder >= 0) ? ob.lineBorder : branchBorder;
                  const bw = (thinLines || !(bb > 0)) ? 0 : Math.max(bb * _branchObjSF, 0.5);
                  // Стрелка потока ветви-окклюдера — перерисовываем ВМЕСТЕ с телом,
                  // иначе occluder закрашивал стрелку направления воздуха (в SVG
                  // ветвь со стрелкой рисуется целиком выше символов нижнего слоя).
                  const oQ = Math.abs(ob.flow ?? 0);
                  const oArrLod = view.scale >= 0.15;
                  const oShowArr = showFlowArrows && !thinLines && oArrLod && oQ > 0.1;
                  const oRev = (ob.flow ?? 0) < 0 || (!!ob.hasFan && (ob.fanReverse ?? false) && (ob.flow ?? 0) >= 0);
                  const oAx = oRev ? tN.sx : f.sx, oAy = oRev ? tN.sy : f.sy;
                  const oBx = oRev ? f.sx : tN.sx, oBy = oRev ? f.sy : tN.sy;
                  const oDx = oBx - oAx, oDy = oBy - oAy;
                  const oLen = Math.hypot(oDx, oDy) || 1;
                  const oAng = Math.atan2(oDy, oDx) * 180 / Math.PI;
                  const oTipH = ow * 2.2, oTipW = ow * 0.5, oTailLen = ow * 3.0, oTailW = Math.max(0.5, ow * 0.15);
                  const oArrCol = pollutedBranchIds.has(ob.id) ? "#2563eb" : "#dc2626";
                  const oArrPts = `0,-${oTipW} ${oTipH},0 0,${oTipW}`;
                  const oShowThis = oShowArr && oLen >= (oTailLen + oTipH) * 2;
                  // ── АНИМАЦИЯ ВОЗДУХОРАСПРЕДЕЛЕНИЯ на ветви-окклюдере ──
                  // Occluder перерисовывает ветвь верхнего горизонта поверх
                  // холста СПЛОШНОЙ линией, затирая бегущий пунктир, который
                  // canvasRenderer нарисовал под оверлеем. Из-за этого при
                  // включённых слоях анимация пропадала. Повторяем пунктир
                  // здесь — с теми же параметрами, что в SVG-режиме.
                  const oV = Math.abs(ob.velocity ?? 0);
                  const oFlowVis = !thinLines && view.scale >= _xySF * 0.25
                    && oQ > 0.1 && flowDisplay !== "off";
                  const oDashes = oFlowVis && (flowDisplay === "flow" || flowDisplay === "both");
                  const oDur = Math.max(0.4, Math.min(5, 4 / Math.max(0.5, oV))) / Math.max(0.1, animSpeed);
                  return (
                    <g key={`ovoccl-${ob.id}`}>
                      {bw > 0 && (
                        <line x1={f.sx} y1={f.sy} x2={tN.sx} y2={tN.sy}
                          stroke="#1f2937" strokeWidth={ow + bw * 2} strokeLinecap="round" opacity={0.85} />
                      )}
                      <line x1={f.sx} y1={f.sy} x2={tN.sx} y2={tN.sy}
                        stroke={occColor(ob)} strokeWidth={ow} strokeLinecap="round"
                        opacity={oFlowVis ? 0.55 : 1} />
                      {/* Стрелки движения воздуха — ТОЧНО ТАКИЕ ЖЕ, как на
                          обычных ветвях. Раньше здесь оставался бегущий
                          пунктир: на ветвях верхнего горизонта, которые
                          перерисовываются поверх схемы, анимация выглядела
                          иначе, чем на остальных, и шла с другой скоростью. */}
                      {oDashes && oLen > 24 && (() => {
                        // Тот же вид, что при расчёте воздухораспределения:
                        // КРАСНЫЙ — свежая струя, СИНИЙ — исходящая.
                        const oAnimTipH    = ow * 2.2;
                        const oAnimTipW    = ow * 0.5;
                        const oAnimTailLen = ow * 3.0;
                        const oAnimTailW   = Math.max(0.5, ow * 0.15);
                        const step = Math.max(70, Math.min(160, (oAnimTailLen + oAnimTipH) * 3.2));
                        const from0 = oAnimTailLen, to0 = oLen - oAnimTipH - step;
                        if (to0 <= from0) return null;
                        const cnt = Math.max(1, Math.floor((to0 - from0) / step) + 1);
                        const oux = oDx / oLen, ouy = oDy / oLen;
                        const oAnimPts = `0,-${oAnimTipW} ${oAnimTipH},0 0,${oAnimTipW}`;
                        return (
                          <g>
                            <animateTransform attributeName="transform" type="translate"
                              from="0 0" to={`${oux * step} ${ouy * step}`}
                              dur={`${oDur}s`} repeatCount="indefinite" />
                            {Array.from({ length: cnt }, (_, ai) => {
                              const d0 = from0 + ai * step;
                              return (
                                <g key={`ovarr-${ob.id}-${ai}`}
                                  transform={`translate(${(oAx + oux * d0).toFixed(1)},${(oAy + ouy * d0).toFixed(1)}) rotate(${oAng.toFixed(1)})`}>
                                  {/* Белая обводка хвостика */}
                                  <line x1={-oAnimTailLen} y1={0} x2={0} y2={0}
                                    stroke="white" strokeWidth={oAnimTailW + 1.5} strokeLinecap="round" />
                                  {/* Белая обводка наконечника */}
                                  <polygon points={oAnimPts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                                  {/* Хвостик */}
                                  <line x1={-oAnimTailLen} y1={0} x2={0} y2={0}
                                    stroke={oArrCol} strokeWidth={oAnimTailW} strokeLinecap="round" />
                                  {/* Наконечник */}
                                  <polygon points={oAnimPts} fill={oArrCol} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
                                </g>
                              );
                            })}
                          </g>
                        );
                      })()}
                      {/* Шевроны ▶▶▶ — режим «Шевроны»/«Оба» тоже затирался occluder-ом */}
                      {oFlowVis && (flowDisplay === "chevrons" || flowDisplay === "both") && oLen > 24 && (() => {
                        const cnt = Math.max(1, Math.floor(oLen / 30));
                        const cAng = Math.atan2(oDy, oDx) * 180 / Math.PI;
                        return Array.from({ length: cnt }, (_, ci) => {
                          const ct = (ci + 1) / (cnt + 1);
                          return (
                            <g key={`ovchv-${ob.id}-${ci}`}
                              transform={`translate(${(oAx + oDx * ct).toFixed(1)},${(oAy + oDy * ct).toFixed(1)}) rotate(${cAng.toFixed(1)})`}>
                              <polygon points="-4,-4 4,0 -4,4" fill={occColor(ob)}
                                stroke="white" strokeWidth="0.6" opacity="0.9" />
                            </g>
                          );
                        });
                      })()}
                      {oShowThis && (
                        <g transform={`translate(${(oAx + oDx * 0.5).toFixed(1)},${(oAy + oDy * 0.5).toFixed(1)}) rotate(${oAng.toFixed(1)})`}>
                          <line x1={-oTailLen} y1={0} x2={0} y2={0} stroke="white" strokeWidth={oTailW + 1.5} strokeLinecap="round" />
                          <polygon points={oArrPts} fill="none" stroke="white" strokeWidth="1.2" strokeLinejoin="round" />
                          <line x1={-oTailLen} y1={0} x2={0} y2={0} stroke={oArrCol} strokeWidth={oTailW} strokeLinecap="round" />
                          <polygon points={oArrPts} fill={oArrCol} stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
                        </g>
                      )}
                    </g>
                  );
                })}
                </g>
              </g>
            );
          }
        }
      }
      for (const sym of schemaSymbolsSorted) {
        if (seenOv.has(horizonOfOv(sym))) continue;
        const arr = renderArrowOv(sym);
        if (arr) out.push(arr);
      }
      for (const sym of schemaSymbolsSorted) {
        if (seenOv.has(horizonOfOv(sym))) continue;
        const node = renderOneOv(sym);
        if (node) out.push(<g key={`ovsym-top-${sym.id}`}>{node}</g>);
      }
      // ── Узлы поверх символов (как в SVG-режиме) ──
      // В canvas-режиме узлы нарисованы на <canvas> ПОД оверлеем, а символы УО
      // (перемычки/вентиляторы/замерные станции) — в оверлее ПОВЕРХ, из-за чего
      // их залитый фон частично перекрывал узлы. В SVG узлы рисуются последними
      // (сверху). Повторяем это: дорисовываем обычные кружки узлов, попадающих
      // под символы, поверх оверлея символов. Водопроводные узлы (иконки) не
      // трогаем — они рисуются на canvas и своей формой не конфликтуют.
      {
        // bbox всех символов (с запасом) — рисуем только близкие узлы
        let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
        let symCount = 0;
        for (const sym of schemaSymbolsSorted) {
          const p = symScreenPos(sym);
          if (!p) continue;
          symCount++;
          if (p.x < sMinX) sMinX = p.x; if (p.x > sMaxX) sMaxX = p.x;
          if (p.y < sMinY) sMinY = p.y; if (p.y > sMaxY) sMaxY = p.y;
        }
        if (symCount > 0) {
          const pad = clipR;
          sMinX -= pad; sMinY -= pad; sMaxX += pad; sMaxY += pad;
          const _xyScaleN = xyScale ?? 1;
          const _rawNodeSF = fixedObjectScale ? 1 : (view.scale / (_xyScaleN * 0.4));
          const nodeSF = fixedObjectScale && scaleLimits
            ? Math.min(scaleLimits.branchMax / 100, Math.max(scaleLimits.branchMin / 100, _rawNodeSF))
            : Math.max(0.25, _rawNodeSF);
          for (const { node, sx, sy } of nodesSorted) {
            if (node.visible === false) continue;
            if (hiddenNodeIds.has(node.id)) continue;
            if (sx < sMinX || sx > sMaxX || sy < sMinY || sy > sMaxY) continue;
            // только обычные узлы — водопроводные рисует canvas своими иконками
            const rawFT = node.fireNodeType ?? "none";
            const wtVis =
              rawFT === "reservoir" ? (!infoConfig || infoConfig.waterReservoir)
            : rawFT === "consumer"  ? (!infoConfig || infoConfig.waterConsumer)
            : rawFT === "junction"  ? (!infoConfig || infoConfig.waterPipeJoint)
            : true;
            if (wtVis && rawFT !== "none") continue;
            const isSelN = selectedNodeId === node.id || (selectedNodeIds?.has(node.id) ?? false);
            const adjBrN = nodeAdjBranches.get(node.id) ?? [];
            const adjAvgWN = adjBrN.length > 0
              ? adjBrN.reduce((s, b) => s + (b.lineWidth && b.lineWidth > 0 ? b.lineWidth : branchWidth), 0) / adjBrN.length
              : branchWidth;
            const baseNodeRN = Math.max(1.5, (thinLines ? 1 : adjAvgWN) * nodeSF * 0.55);
            const rN = isSelN ? baseNodeRN * 1.5 : baseNodeRN;
            const colorN = node.atmosphereLink ? "#7dd3fc" : "#c8a882";
            const ringColorN = (selectedNodeIds?.has(node.id) ?? false) ? "#f59e0b" : "#2563eb";
            out.push(
              <g key={`ovnode-${node.id}`} transform={`translate(${sx},${sy})`} pointerEvents="none">
                <circle r={rN} fill={colorN} stroke={isSelN ? ringColorN : "#1f2937"}
                  strokeWidth={Math.min(2, Math.max(0.5, baseNodeRN * 0.25))} />
                {node.atmosphereLink && (
                  <circle r={rN * 0.5} fill="none" stroke="#1f2937"
                    strokeWidth={Math.min(1.5, Math.max(0.5, baseNodeRN * 0.2))} strokeDasharray="2 1" />
                )}
              </g>
            );
          }
        }
      }
      // ── ЗАДЫМЛЕНИЕ поверх оверлея (ИСПРАВЛЕНИЕ z-order) ───────────────
      // canvasRenderer рисует дым последним проходом ПОВЕРХ всех слоёв, но
      // этот SVG-оверлей лежит ВЫШЕ холста и перерисовывает ветви верхних
      // горизонтов (occluder-ы `ovocc-*` для z-order символов). Из-за этого
      // дым нижнего горизонта снова оказывался ПОД слоем горизонта.
      // Повторяем проход дыма здесь, в самом конце оверлея.
      if (branchFireColors && branchFireColors.size > 0) {
        for (const { branch: b } of branchesSorted) {
          const fireSeg = branchFireColors.get(b.id);
          if (!fireSeg) continue;
          const f = projNodesMap.get(b.fromId);
          const tN = projNodesMap.get(b.toId);
          if (!f || !tN) continue;
          const revS = (b.flow ?? 0) < 0 || (!!b.hasFan && (b.fanReverse ?? false) && (b.flow ?? 0) >= 0);
          const sxA = revS ? tN.sx : f.sx, syA = revS ? tN.sy : f.sy;
          const sxB = revS ? f.sx : tN.sx, syB = revS ? f.sy : tN.sy;
          const sbw = (b.lineWidth && b.lineWidth > 0) ? b.lineWidth : branchWidth;
          const sw = thinLines ? 1 : Math.max(sbw * _branchObjSF, 1.0);
          const { color: fireCol, fromT, toT } = fireSeg;
          out.push(
            <line key={`ovsmoke-${b.id}`}
              x1={sxA + (sxB - sxA) * fromT} y1={syA + (syB - syA) * fromT}
              x2={sxA + (sxB - sxA) * toT}   y2={syA + (syB - syA) * toT}
              stroke={fireCol} strokeWidth={Math.max(sw * 0.7, 2)}
              strokeLinecap="round" opacity="0.95" pointerEvents="none" />
          );
        }
      }
      return <>{out}</>;
      })()}
    </svg>
  )}
    </>
  );
}
