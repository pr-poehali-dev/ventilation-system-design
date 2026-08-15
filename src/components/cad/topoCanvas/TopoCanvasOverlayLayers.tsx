import React from "react";
import { type TopoBranch } from "@/lib/topology";
import { type Props, type ViewState, type ProjNodeEntry } from "@/components/cad/topoCanvas/topoCanvasTypes";
import { type SymbolItem } from "@/components/cad/topoCanvas/TopoCanvasSymbolNode";

// ─────────────────────────────────────────────────────────────────────────────
// Сборка canvas-оверлея по слоям горизонтов.
//
// Вынесено из TopoCanvasSymbolsOverlay.tsx БЕЗ изменений логики и разметки.
//
// Что здесь происходит (порядок важен — это z-order всего оверлея):
//   1) по каждому горизонту сверху вниз — стрелки воздуха, затем символы УО;
//   2) «перекрыватели» (occluder) — ветви горизонтов ВЫШЕ дорисовываются
//      поверх символов нижнего слоя, вместе со своей анимацией и стрелками;
//   3) узлы поверх символов — чтобы залитый фон перемычек их не перекрывал;
//   4) задымление — последним проходом, поверх всего.
// ─────────────────────────────────────────────────────────────────────────────

/** Всё, что нужно для сборки слоёв оверлея. */
export interface OverlayLayersDeps {
  view: ViewState;
  fixedObjectScale: boolean;
  branchBorder: number;
  scaleLimits?: Props["scaleLimits"];
  branchesSorted: { branch: TopoBranch; depth: number; hOrder: number }[];
  nodesSorted: ProjNodeEntry[];
  projNodesMap: Map<string, ProjNodeEntry>;
  projectWithZ: (p: { x: number; y: number; z: number }) => { sx: number; sy: number; depth: number };
  branchById: Map<string, TopoBranch>;
  horizonOrderMap: Map<string, number>;
  nodeAdjBranches: Map<string, TopoBranch[]>;
  hiddenNodeIds: Set<string>;
  pollutedBranchIds: Set<string>;
  branchBodyColor: (b: TopoBranch) => string | null;
  schemaSymbolsSorted: NonNullable<Props["schemaSymbols"]>;
  _xySF: number;
  _branchObjSF: number;
  branchWidth: number;
  thinLines: boolean;
  flowDisplay: NonNullable<Props["flowDisplay"]>;
  animSpeed: number;
  showFlowArrows: boolean;
  selectedNodeId: string | null;
  selectedNodeIds?: Set<string>;
  infoConfig: Props["infoConfig"];
  branchFireColors?: Props["branchFireColors"];
  xyScale: number;
  /** Отрисовка одного символа УО (см. TopoCanvasSymbolNode). */
  renderOneOv: (sym: SymbolItem) => React.ReactNode;
  /** Отрисовка стрелки воздуха (см. TopoCanvasFlowArrows). */
  renderArrowOv: (sym: SymbolItem) => React.ReactNode;
}

/** Собирает список узлов оверлея в правильном порядке наложения. */
export function buildOverlayLayers(d: OverlayLayersDeps): React.ReactNode[] {
  const {
    view, fixedObjectScale, branchBorder, scaleLimits,
    branchesSorted, nodesSorted, projNodesMap, projectWithZ,
    branchById, horizonOrderMap, nodeAdjBranches,
    hiddenNodeIds, pollutedBranchIds, branchBodyColor,
    schemaSymbolsSorted,
    _xySF, _branchObjSF,
    branchWidth, thinLines, flowDisplay, animSpeed, showFlowArrows,
    selectedNodeId, selectedNodeIds, infoConfig, branchFireColors, xyScale,
    renderOneOv, renderArrowOv,
  } = d;

  // Встраиваем УО в слои горизонтов (как в SVG-режиме). В canvas-режиме
  // ветви нарисованы на <canvas> ПОД этим оверлеем, поэтому чтобы символ
  // нижнего горизонта не перекрывал ветви верхнего, поверх символов слоя
  // дорисовываем ветви горизонтов, которые выше в списке.
  const out: React.ReactNode[] = [];
  const horizonOfOv = (sym: SymbolItem): number => {
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
  const symScreenPos = (sym: SymbolItem): { x: number; y: number } | null => {
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
  const symsByOrder = new Map<number, SymbolItem[]>();
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
                  {/* Непрозрачная всегда: выше рисуется тёмная обводка, и при
                      прозрачности она просвечивала — выработка серела при
                      включённой анимации потока. */}
                  <line x1={f.sx} y1={f.sy} x2={tN.sx} y2={tN.sy}
                    stroke={occColor(ob)} strokeWidth={ow} strokeLinecap="round" />
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
  return out;
}