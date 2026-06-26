// SVG-слой условных обозначений (УО) для предпросмотра печати.
// Содержит ту же логику что в TopoCanvas, но без интерактивности.
import { type ProjNode } from "@/lib/canvasRenderer";
import { type TopoBranch } from "@/lib/topology";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";

interface Props {
  symbols: SchemaSymbol[];
  branches: TopoBranch[];
  projNodesMap: Map<string, ProjNode>;
  viewScale: number;
  unitsConfig?: UnitsConfig;
  width: number;
  height: number;
  defaultBranchWidth?: number;
}

export default function SchemaSymbolsOverlay({
  symbols, branches, projNodesMap,
  viewScale, unitsConfig = DEFAULT_UNITS_CONFIG,
  width, height, defaultBranchWidth = 7,
}: Props) {
  return (
    <svg
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {symbols.map(sym => {
        const isBulkheadSym = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
        const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
        // Перемычки рисуются геометрически (не через SVG из LEGEND_TYPES) — не требуют lt
        if (!lt && !isBulkheadSym) return null;

        let basePx = 0, basePy = 0;
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
          }
        }

        if (!hasBranchPts && !sym.branchId) {
          // Свободный символ — координаты уже должны быть в экранных px
          // (для печати это нестандартный случай, просто пропустим если нет данных)
          return null;
        }

        const px = basePx + (sym.offsetX ?? 0);
        const py = basePy + (sym.offsetY ?? 0);

        const sc = sym.scale ?? 1;
        // Тот же контр-масштаб что в TopoCanvas
        let symScaleFactor: number;
        if (viewScale < 0.4) {
          symScaleFactor = viewScale / 0.4;
        } else {
          const k = (viewScale - 0.4) / 0.4;
          symScaleFactor = 1 + 2 * (k / (k + 2));
        }
        const brForSym = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
        const isMeasureStationSym2 = sym.typeId === "measure_station";
        let SZ: number;
        if ((isBulkheadSym || isMeasureStationSym2) && hasBranchPts) {
          const bkBw = (brForSym?.lineWidth && brForSym.lineWidth > 0) ? brForSym.lineWidth : defaultBranchWidth;
          SZ = Math.max(6, (bkBw * viewScale * 2.0 / 0.85) * sc);
        } else {
          SZ = Math.max(4, 32 * sc * symScaleFactor);
        }
        const HX = px - SZ / 2;
        const HY = py - SZ / 2 - 4;
        const isFanStopped = sym.typeId === "fan" && (brForSym?.fanStopped ?? false);
        const isDestroyed = isBulkheadSym && (brForSym?.bulkheadDestroyedByExplosion ?? false);

        const isMeasureStation = isMeasureStationSym2;
        const isBulkhead = isBulkheadSym;

        const renderMeasureStation = () => {
          if (!isMeasureStation || !hasBranchPts) return null;
          const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
          const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
          const halfW = SZ * 0.85 / 2;
          const halfL = halfW * 1.6;
          const stripeGap = halfW * 0.35;
          const stripeW = Math.max(1, halfW * 0.22);
          const rectSW = Math.max(1, halfW * 0.18);
          return (
            <g transform={`translate(${px},${py}) rotate(${brAngle})`}>
              <rect x={-halfL} y={-halfW} width={halfL * 2} height={halfW * 2}
                fill="rgba(220,38,38,0.15)" stroke="#dc2626" strokeWidth={rectSW} />
              <line x1={-halfL * 0.7} y1={-stripeGap} x2={halfL * 0.7} y2={-stripeGap}
                stroke="#dc2626" strokeWidth={stripeW} strokeLinecap="square" />
              <line x1={-halfL * 0.7} y1={stripeGap}  x2={halfL * 0.7} y2={stripeGap}
                stroke="#dc2626" strokeWidth={stripeW} strokeLinecap="square" />
            </g>
          );
        };

        const renderBulkhead = () => {
          if (!isBulkhead || !sym.branchId || !hasBranchPts) return null;
          const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
          const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
          const tid = sym.typeId;

          const fill  = isDestroyed ? "#ff4444"
            : tid.includes("concrete") ? "#4caf50"
            : tid.includes("wood")     ? "#ffd600"
            : tid.includes("brick")    ? "#ff9800"
            : tid.includes("metal")    ? "#9c27b0"
            : (tid === "fire_door" || tid === "fire_door_pp") ? "#c00"
            : (tid === "barrier")      ? "#555"
            : "white";
          const stroke = isDestroyed ? "#8b0000"
            : tid.includes("concrete") ? "#1b5e20"
            : tid.includes("wood")     ? "#e65100"
            : tid.includes("brick")    ? "#bf360c"
            : tid.includes("metal")    ? "#4a148c"
            : (tid === "fire_door" || tid === "fire_door_pp") ? "#800"
            : "#1a1a1a";

          const ph  = Math.max(3, SZ * 0.85);
          const pw  = Math.max(1.5, ph * 0.38);
          const gap = Math.max(1, pw * 0.5);
          const sw2 = Math.max(0.4, pw * 0.18);

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
          // Глухая перемычка — нет материала, двери, открытия, окна, решётки, воды, паруса, барьера
          const isBlind   = !isDestroyed && !isDoor && !isAuto && !isOpen && !isWindow && !isLattice
                            && !isWater && !isSail && !isBarrier && !isFirePP && !isProem
                            && !tid.includes("concrete") && !tid.includes("wood") && !tid.includes("brick")
                            && !tid.includes("metal") && tid !== "fire_door";

          return (
            <g transform={`translate(${px},${py}) rotate(${brAngle})`}>
              {isSail ? (
                <>
                  <line x1={0} y1={-ph/2} x2={0} y2={ph/2}
                    stroke={stroke} strokeWidth={Math.max(1.8, pw * 0.4)} strokeLinecap="round" />
                  <path d={`M0,${-ph*0.38} Q${ph*0.6},0 0,${ph*0.38}`}
                    fill="none" stroke={stroke} strokeWidth={Math.max(1.8, pw * 0.4)} strokeLinecap="round" />
                </>
              ) : isBarrier ? (
                <>
                  <rect x={-pw} y={-ph/2} width={pw} height={ph} fill="#555" stroke="#222" strokeWidth={1.3} />
                  <rect x={0}   y={-ph/2} width={pw} height={ph} fill="#c00" stroke="#800" strokeWidth={1.3} />
                </>
              ) : isFirePP ? (
                <>
                  <rect x={-pw - gap/2} y={-ph/2} width={pw} height={ph} fill="#dc2626" stroke="#8b0000" strokeWidth={1.3} />
                  <rect x={gap/2}       y={-ph/2} width={pw} height={ph} fill="#dc2626" stroke="#8b0000" strokeWidth={1.3} />
                </>
              ) : isOpen ? (
                <>
                  <rect x={-pw/2} y={-ph/2} width={pw} height={ph*0.38} fill={fill} stroke={stroke} strokeWidth={sw2} />
                  <rect x={-pw/2} y={ph*0.12} width={pw} height={ph*0.38} fill={fill} stroke={stroke} strokeWidth={sw2} />
                  <line x1={-pw/2} y1={ph*0.12} x2={-pw/2 - ph*0.45} y2={ph/2}
                    stroke={stroke} strokeWidth={Math.max(1.8, pw * 0.3)} strokeLinecap="round" />
                </>
              ) : (isDoor || isAuto) ? (
                <>
                  <rect x={-pw/2} y={-ph/2} width={pw} height={ph} fill={fill} stroke={stroke} strokeWidth={sw2} />
                  <line x1={-pw/2} y1={-ph/2} x2={-pw/2} y2={ph/2}
                    stroke={stroke} strokeWidth={Math.max(2, pw * 0.35)} strokeLinecap="round" />
                  {isAuto && (
                    <g transform={`translate(${pw/2 + ph*0.28}, 0)`}>
                      <circle r={ph*0.2} fill="white" stroke={stroke} strokeWidth={1.2} />
                      <text textAnchor="middle" dominantBaseline="central"
                        fontSize={ph * 0.2} fontWeight="bold" fill={stroke}>А</text>
                    </g>
                  )}
                </>
              ) : (
                <>
                  <rect x={-pw/2} y={-ph/2} width={pw} height={ph} fill={fill}
                    stroke={isBlind ? "#000000" : stroke}
                    strokeWidth={isBlind ? Math.max(0.8, pw * 0.28) : sw2} />
                  {(isWindow || isProem) && (
                    <rect x={-pw*0.25} y={-ph*0.2} width={pw*0.5} height={ph*0.4}
                      fill="white" stroke={stroke} strokeWidth={1} />
                  )}
                  {isLattice && (() => {
                    const rs = [];
                    for (let i = -1; i <= 1; i++) {
                      rs.push(<line key={`v${i}`} x1={pw*0.2*i} y1={-ph*0.45} x2={pw*0.2*i} y2={ph*0.45} stroke={stroke} strokeWidth={0.8} />);
                    }
                    rs.push(<line key="h0" x1={-pw*0.4} y1={0} x2={pw*0.4} y2={0} stroke={stroke} strokeWidth={0.8} />);
                    return rs;
                  })()}
                  {isWater && (
                    <text textAnchor="middle" dominantBaseline="central"
                      fontSize={ph * 0.3} fontWeight="bold"
                      fill={fill === "white" ? "#1565c0" : "white"}>D</text>
                  )}
                  {tid === "fire_door" && (
                    <text textAnchor="middle" dominantBaseline="central"
                      fontSize={ph * 0.22} fontWeight="bold" fill="white">ПП</text>
                  )}
                </>
              )}
            </g>
          );
        };

        // Индикаторы замерной станции
        const renderMeasureStationIndicators = () => {
          if (!isMeasureStation || !hasBranchPts) return null;
          const lines: string[] = [];
          if (sym.msIndNumber && sym.msNumber)     lines.push(`№${sym.msNumber}`);
          if (sym.msIndLocation && sym.msLocation) lines.push(sym.msLocation);
          if (sym.msIndFlow) {
            const q = sym.msFlow ?? (brForSym ? Math.abs(brForSym.flow ?? 0) : 0);
            lines.push(`Q=${q.toFixed(2)} м³/с`);
          }
          if (sym.msIndArea) {
            const a = sym.msArea ?? (brForSym?.area ?? 0);
            lines.push(`S=${a.toFixed(2)} м²`);
          }
          if (sym.msIndVelocity) {
            const v = sym.msVelocity ?? (brForSym ? Math.abs(brForSym.velocity ?? 0) : 0);
            lines.push(`v=${v.toFixed(2)} м/с`);
          }
          if (!lines.length) return null;

          const fSize = Math.max(6, Math.round((sym.msIndFontSize ?? 9) * sc * symScaleFactor));
          const lineH = fSize + 3;
          const boxW  = Math.max(...lines.map(l => l.length)) * fSize * 0.52 + 10;
          const boxH  = lines.length * lineH + 6;
          const brDx  = tsx2 - fsx, brDy = tsy2 - fsy;
          const brLen = Math.hypot(brDx, brDy);
          const perpX = brLen > 0 ? -brDy / brLen : 0;
          const perpY = brLen > 0 ?  brDx / brLen : 0;
          const bx = px + perpX * (16 + boxW / 2) + (sym.msIndOffsetX ?? 0);
          const by = py + perpY * (16 + boxH / 2) + (sym.msIndOffsetY ?? 0);

          return (
            <g>
              <line x1={px} y1={py} x2={bx} y2={by - boxH / 2}
                stroke="#8899bb" strokeWidth={0.7} strokeDasharray="3 2" />
              {lines.map((line, i) => (
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
          );
        };

        // Индикаторы перемычки
        const renderBulkheadIndicators = () => {
          if (!BULKHEAD_SYMBOL_IDS.has(sym.typeId) || !sym.branchId) return null;
          const br = branches.find(b => b.id === sym.branchId);
          if (!br) return null;
          const lines: string[] = [];
          const uRes  = getUnit(unitsConfig, "resistance");
          const uPres = getUnit(unitsConfig, "pressure");
          const uFlow = getUnit(unitsConfig, "flow");
          if (sym.indDescription && sym.description) lines.push(sym.description);
          if (sym.indResistance) {
            const rVal = br.bulkheadR > 0 ? br.bulkheadR : br.resistance / 1e6;
            lines.push(`R=${uRes.fromBase(rVal).toFixed(uRes.decimals)} ${uRes.symbol}`);
          }
          if (sym.indDeltaP && br.dP !== 0)
            lines.push(`ΔP=${uPres.fromBase(Math.abs(br.dP)).toFixed(uPres.decimals)} ${uPres.symbol}`);
          if (sym.indLeakage && br.flow !== 0)
            lines.push(`Q=${uFlow.fromBase(Math.abs(br.flow)).toFixed(uFlow.decimals)} ${uFlow.symbol}`);
          if (!lines.length) return null;

          const fSize = Math.max(6, Math.round(9 * sc * symScale));
          const lineH = fSize + 3;
          const boxW = Math.max(...lines.map(l => l.length)) * fSize * 0.52 + 10;
          const boxH = lines.length * lineH + 6;

          const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
          const brLen = Math.hypot(brDx, brDy);
          const perpX = brLen > 0 ? -brDy / brLen : 0;
          const perpY = brLen > 0 ?  brDx / brLen : 0;
          const bx = px + perpX * (16 + boxW / 2) + (sym.indOffsetX ?? 0);
          const by = py + perpY * (16 + boxH / 2) + (sym.indOffsetY ?? 0);

          return (
            <g>
              <line x1={px} y1={py} x2={bx} y2={by - boxH / 2}
                stroke="#8899bb" strokeWidth={0.7} strokeDasharray="3 2" />
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
          );
        };

        return (
          <g key={sym.id}>
            {/* Символ */}
            {isMeasureStation && hasBranchPts ? renderMeasureStation() :
             isBulkhead && hasBranchPts ? renderBulkhead() : (
              lt ? <svg x={HX} y={HY} width={SZ} height={SZ} viewBox="0 0 48 40"
                overflow="visible"
                opacity={isFanStopped ? 0.35 : 1}
                style={isFanStopped ? { filter: "grayscale(1)" } : undefined}
                dangerouslySetInnerHTML={{ __html: lt.svgContent }} /> : null
            )}

            {/* Крестик на остановленном вентиляторе */}
            {isFanStopped && (
              <g opacity={0.7}>
                <line x1={HX + SZ * 0.2} y1={HY + SZ * 0.2} x2={HX + SZ * 0.8} y2={HY + SZ * 0.8}
                  stroke="#6b7280" strokeWidth={Math.max(2, SZ / 14)} strokeLinecap="round" />
                <line x1={HX + SZ * 0.8} y1={HY + SZ * 0.2} x2={HX + SZ * 0.2} y2={HY + SZ * 0.8}
                  stroke="#6b7280" strokeWidth={Math.max(2, SZ / 14)} strokeLinecap="round" />
              </g>
            )}

            {/* ⚡ Маркер разрушенной перемычки */}
            {isDestroyed && hasBranchPts && (() => {
              const br = brForSym;
              const cx = px, cy = py;
              const r = Math.max(8, SZ * 0.7);
              const lw = Math.max(2.5, SZ * 0.22);
              // Угол ветви для ориентации «разрыва»
              const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
              const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
              const fp = br?.bulkheadFailurePressure;
              const fpText = fp && fp > 0 ? `${fp} МПа` : null;
              return (
                <g>
                  {/* Красное свечение вокруг — «взрыв» */}
                  <circle cx={cx} cy={cy} r={r + 8} fill="#ef4444" opacity={0.18} />
                  <circle cx={cx} cy={cy} r={r + 4} fill="#ef4444" opacity={0.28} />
                  {/* Основной круг: жёлто-красный */}
                  <circle cx={cx} cy={cy} r={r}
                    fill="#fef08a" stroke="#dc2626" strokeWidth={Math.max(2, lw * 0.6)} opacity={0.95} />
                  {/* Зубчатый разрыв вдоль оси ветви (zigzag) */}
                  <g transform={`translate(${cx},${cy}) rotate(${brAngle})`}>
                    <polyline
                      points={`${-r * 0.9},0 ${-r * 0.45},${-r * 0.35} ${0},${r * 0.35} ${r * 0.45},${-r * 0.35} ${r * 0.9},0`}
                      fill="none" stroke="#dc2626" strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                  {/* Подпись «РАЗР.» над маркером */}
                  <text x={cx} y={cy - r - 5}
                    textAnchor="middle" fontSize={Math.max(8, SZ * 0.38)}
                    fontWeight="bold" fontFamily="sans-serif"
                    fill="#dc2626" stroke="white" strokeWidth={2} paintOrder="stroke">
                    РАЗР.
                  </text>
                  {/* Давление разрушения под маркером */}
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

            {/* Стрелка направления вентилятора */}
            {!isFanStopped && sym.typeId === "fan" && sym.branchId && hasBranchPts
              && (sym.showFanArrow ?? true) && (() => {
              const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
              const brAngle = Math.atan2(brDy, brDx) * 180 / Math.PI;
              const arrowAngle = sym.airDirection === "reverse" ? brAngle + 180 : brAngle;
              const iconCx = HX + SZ / 2;
              const iconCy = HY + SZ * (20 / 48);
              const rIcon  = SZ * (16 / 48);
              const aLen   = SZ * 0.32;
              const stroke = Math.max(0.8, SZ * 0.045);
              const head   = Math.max(3, SZ * 0.13);
              return (
                <g transform={`translate(${iconCx},${iconCy}) rotate(${arrowAngle})`}>
                  <line x1={rIcon} y1={0} x2={rIcon + aLen - head * 0.5} y2={0}
                    stroke="#111" strokeWidth={stroke} strokeLinecap="round" />
                  <polygon
                    points={`${rIcon + aLen - head},${-head * 0.55} ${rIcon + aLen},0 ${rIcon + aLen - head},${head * 0.55}`}
                    fill="#111" />
                </g>
              );
            })()}

            {/* Подпись label (для не-перемычек) */}
            {!isBulkhead && sym.label && (
              <text x={px} y={py + SZ / 2 + 12} textAnchor="middle"
                fontSize={Math.round(9 * sc)} fill="#374151" fontFamily="Segoe UI, sans-serif">
                {sym.label}
              </text>
            )}

            {/* Индикаторы замерной станции */}
            {renderMeasureStationIndicators()}

            {/* Индикаторы перемычки */}
            {renderBulkheadIndicators()}
          </g>
        );
      })}
    </svg>
  );
}