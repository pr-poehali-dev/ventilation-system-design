// Рисует условные обозначения (УО) прямо на canvas через 2D API.
// Используется при экспорте/печати — дублирует логику SchemaSymbolsOverlay,
// но через ctx вместо SVG.
import { type TopoBranch } from "@/lib/topology";
import { type ProjNode } from "@/lib/canvasRenderer";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";

// Кэш SVG-иконок, преобразованных в Image (по svgContent)
const svgImageCache = new Map<string, HTMLImageElement>();

function svgToImage(svgContent: string, size: number): Promise<HTMLImageElement> {
  const key = `${svgContent}__${size}`;
  if (svgImageCache.has(key)) return Promise.resolve(svgImageCache.get(key)!);
  return new Promise(resolve => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 40">${svgContent}</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url  = URL.createObjectURL(blob);
    const img  = new Image(size, size);
    img.onload  = () => { svgImageCache.set(key, img); URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => resolve(img);
    img.src = url;
  });
}

function symScale(viewScale: number): number {
  if (viewScale < 0.4) return viewScale / 0.4;
  const k = (viewScale - 0.4) / 0.4;
  return 1 + 2 * (k / (k + 2));
}

export async function drawSymbolsToCanvas(
  ctx: CanvasRenderingContext2D,
  symbols: SchemaSymbol[],
  branches: TopoBranch[],
  projNodesMap: Map<string, ProjNode>,
  viewScale: number,
  unitsConfig: UnitsConfig = DEFAULT_UNITS_CONFIG,
  defaultBranchWidth: number = 7,
): Promise<void> {
  for (const sym of symbols) {
    const isBulkheadSym = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
    const lt = LEGEND_TYPES.find(l => l.id === sym.typeId);
    if (!lt && !isBulkheadSym) continue;

    let basePx = 0, basePy = 0;
    let fsx = 0, fsy = 0, tsx2 = 0, tsy2 = 0, hasBranchPts = false;

    if (sym.branchId) {
      const br = branches.find(b => b.id === sym.branchId);
      const fN = br ? projNodesMap.get(br.fromId) : null;
      const tN = br ? projNodesMap.get(br.toId)   : null;
      if (!fN || !tN) continue; // ветвь/узлы не найдены — пропускаем символ
      fsx = fN.sx; fsy = fN.sy; tsx2 = tN.sx; tsy2 = tN.sy;
      hasBranchPts = true;
      const t = sym.t ?? 0.5;
      basePx = fsx + (tsx2 - fsx) * t;
      basePy = fsy + (tsy2 - fsy) * t;
    } else {
      // Свободный символ без привязки к ветви — пропускаем (не поддерживается в canvas)
      if (!hasBranchPts) continue;
    }

    const px = basePx + (sym.offsetX ?? 0);
    const py = basePy + (sym.offsetY ?? 0);
    const sc = sym.scale ?? 1;
    const ss = symScale(viewScale);
    const brForSym2 = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
    const isMeasureStationSym2 = sym.typeId === "measure_station";
    let SZ: number;
    if ((isBulkheadSym || isMeasureStationSym2) && hasBranchPts) {
      const bkBw = (brForSym2?.lineWidth && brForSym2.lineWidth > 0) ? brForSym2.lineWidth : defaultBranchWidth;
      SZ = Math.max(6, (bkBw * viewScale * 2.0 / 0.85) * sc);
    } else {
      SZ = Math.max(4, 32 * sc * ss);
    }
    const HX = px - SZ / 2;
    const HY = py - SZ / 2 - 4;

    const brForSym = brForSym2;
    const isFanStopped = sym.typeId === "fan" && (brForSym?.fanStopped ?? false);
    const isMeasureStation = sym.typeId === "measure_station";
    const isBulkhead = BULKHEAD_SYMBOL_IDS.has(sym.typeId) && !isMeasureStation;
    const isFireSource = sym.typeId === "fire_source";

    // Угол поворота по направлению ветви (для символов на трубах)
    const brAngleForSym = hasBranchPts
      ? Math.atan2(tsy2 - fsy, tsx2 - fsx)
      : 0;
    // Символы, которые нужно поворачивать вдоль ветви
    const ROTATE_WITH_BRANCH = new Set(["valve_reduce", "valve_water", "valve_gate", "check_valve"]);
    const needsRotate = hasBranchPts && ROTATE_WITH_BRANCH.has(sym.typeId);

    // ── Рисуем символ ─────────────────────────────────────────────────
    if (isMeasureStation && hasBranchPts) {
      const msBr = branches.find(b => b.id === sym.branchId);
      const msBw = (msBr?.lineWidth && msBr.lineWidth > 0) ? msBr.lineWidth : defaultBranchWidth;
      // ветвь рисуется как baseW * (scale / 0.4) → используем тот же коэффициент
      const msW  = Math.max(4, msBw * (viewScale / 0.4) * sc);
      const ml   = msW * 0.75;
      const mt   = Math.max(1.5, msW * 0.34);
      const moff = Math.max(0.5, msW * 0.06);
      const sw   = Math.max(0.4, mt * 0.08);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(brAngleForSym);
      ctx.fillStyle = "#dc2626";
      ctx.strokeStyle = "#8b0000";
      ctx.lineWidth = sw;
      ctx.fillRect(-ml / 2, -moff - mt, ml, mt);
      ctx.strokeRect(-ml / 2, -moff - mt, ml, mt);
      ctx.fillRect(-ml / 2, moff, ml, mt);
      ctx.strokeRect(-ml / 2, moff, ml, mt);
      ctx.restore();
    } else if (isBulkhead && hasBranchPts) {
      drawBulkheadOnCanvas(ctx, sym, px, py, SZ, fsx, fsy, tsx2, tsy2);
    } else if (isFireSource && hasBranchPts) {
      // Очаг пожара: рисуется поперёк ветви (как перемычка) + SVG-иконка сверху
      const fireSZ = Math.max(6, SZ * 1.6);  // крупнее обычного символа
      const ph = Math.max(5, fireSZ * 0.85);
      const pw = Math.max(2, ph * 0.22);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(brAngleForSym);
      // Красная поперечная полоса
      ctx.fillStyle = "rgba(220,38,38,0.18)";
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = Math.max(1.5, pw * 0.6);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, -ph / 2); ctx.lineTo(0, ph / 2); ctx.stroke();
      ctx.restore();
      // SVG-иконка поверх (увеличенная, без поворота)
      const imgSize = Math.ceil(fireSZ);
      const img = await svgToImage(lt.svgContent, imgSize);
      ctx.drawImage(img, px - fireSZ / 2, py - fireSZ / 2 - 4, fireSZ, fireSZ);
    } else {
      // SVG-иконка через Image (с поворотом для трубопроводных символов)
      const imgSize = Math.ceil(SZ);
      const img = await svgToImage(lt.svgContent, imgSize);
      ctx.save();
      if (isFanStopped) {
        ctx.globalAlpha = 0.35;
        ctx.filter = "grayscale(1)";
      }
      if (needsRotate) {
        ctx.translate(px, py);
        ctx.rotate(brAngleForSym);
        ctx.drawImage(img, -SZ / 2, -SZ / 2 - 4, SZ, SZ);
      } else {
        ctx.drawImage(img, HX, HY, SZ, SZ);
      }
      ctx.restore();

      // Крестик на остановленном вентиляторе
      if (isFanStopped) {
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = "#6b7280";
        ctx.lineWidth   = Math.max(2, SZ / 14);
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(HX + SZ * 0.2, HY + SZ * 0.2); ctx.lineTo(HX + SZ * 0.8, HY + SZ * 0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(HX + SZ * 0.8, HY + SZ * 0.2); ctx.lineTo(HX + SZ * 0.2, HY + SZ * 0.8); ctx.stroke();
        ctx.restore();
      }
    }

    // ── Стрелка направления вентилятора ───────────────────────────────
    if (!isFanStopped && sym.typeId === "fan" && hasBranchPts && (sym.showFanArrow ?? true)) {
      const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
      const brAngle = Math.atan2(brDy, brDx);
      const arrowAngle = sym.airDirection === "reverse" ? brAngle + Math.PI : brAngle;
      const iconCx = HX + SZ / 2;
      const iconCy = HY + SZ * (20 / 48);
      const rIcon  = SZ * (16 / 48);
      const aLen   = SZ * 0.32;
      const sw     = Math.max(0.8, SZ * 0.045);
      const head   = Math.max(3, SZ * 0.13);
      const x0 = rIcon, x1 = rIcon + aLen;
      ctx.save();
      ctx.translate(iconCx, iconCy);
      ctx.rotate(arrowAngle);
      ctx.strokeStyle = "#111"; ctx.lineWidth = sw; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1 - head * 0.5, 0); ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.moveTo(x1 - head, -head * 0.55);
      ctx.lineTo(x1, 0);
      ctx.lineTo(x1 - head, head * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // ── Подпись label (не перемычки) ──────────────────────────────────
    if (!isBulkhead && sym.label) {
      ctx.save();
      ctx.font = `${Math.round(9 * sc)}px "Segoe UI", sans-serif`;
      ctx.fillStyle = "#374151";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(sym.label, px, py + SZ / 2 + 12);
      ctx.restore();
    }

    // ── Индикаторы замерной станции ───────────────────────────────────
    if (isMeasureStation && hasBranchPts) {
      const brMs = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
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
      if (msLines.length > 0) {
        const fsMs = Math.max(6, Math.round((sym.msIndFontSize ?? 9) * sc * ss));
        const lhMs = fsMs + 3;
        const boxHMs = msLines.length * lhMs + 6;
        const brDxMs = tsx2 - fsx, brDyMs = tsy2 - fsy;
        const brLenMs = Math.hypot(brDxMs, brDyMs);
        const perpXms = brLenMs > 0 ? -brDyMs / brLenMs : 0;
        const perpYms = brLenMs > 0 ?  brDxMs / brLenMs : 0;
        const maxLen = Math.max(...msLines.map(l => l.length));
        const boxWMs = maxLen * fsMs * 0.52 + 10;
        const bxMs = px + perpXms * (16 + boxWMs / 2) + (sym.msIndOffsetX ?? 0);
        const byMs = py + perpYms * (16 + boxHMs / 2) + (sym.msIndOffsetY ?? 0);

        ctx.save();
        ctx.strokeStyle = "#555555"; ctx.lineWidth = 0.4;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bxMs, byMs - boxHMs / 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        msLines.forEach((line, i) => {
          const tyMs = byMs - boxHMs / 2 + i * lhMs + 3;
          const fw = i === 0 && sym.msIndNumber ? "700" : "400";
          ctx.font = `${fw} ${fsMs}px "Segoe UI", sans-serif`;
          ctx.strokeStyle = "white"; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
          ctx.strokeText(line, bxMs, tyMs);
          ctx.fillStyle = "#1a2a4a";
          ctx.fillText(line, bxMs, tyMs);
        });
        ctx.restore();
      }
    }

    // ── Индикаторы перемычки ──────────────────────────────────────────
    if (isBulkhead && sym.branchId && hasBranchPts) {
      drawBulkheadIndicators(ctx, sym, px, py, SZ, fsx, fsy, tsx2, tsy2, sc, ss, unitsConfig, branches);
    }
  }
}

// ── Рисуем перемычку на canvas ─────────────────────────────────────────────
function drawBulkheadOnCanvas(
  ctx: CanvasRenderingContext2D,
  sym: SchemaSymbol,
  px: number, py: number, SZ: number,
  fsx: number, fsy: number, tsx2: number, tsy2: number,
) {
  const tid = sym.typeId;
  const brDx = tsx2 - fsx, brDy = tsy2 - fsy;
  const brAngle = Math.atan2(brDy, brDx);

  const fill   = tid.includes("concrete") ? "#4caf50"
    : tid.includes("wood")     ? "#ffd600"
    : tid.includes("brick")    ? "#ff9800"
    : tid.includes("metal")    ? "#9c27b0"
    : (tid === "fire_door" || tid === "fire_door_pp") ? "#c00"
    : (tid === "barrier")      ? "#555"
    : "white";
  const stroke = tid.includes("concrete") ? "#1b5e20"
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
  const isBlind   = !isDoor && !isAuto && !isOpen && !isWindow && !isLattice
                    && !isWater && !isSail && !isBarrier && !isFirePP && !isProem
                    && !tid.includes("concrete") && !tid.includes("wood") && !tid.includes("brick")
                    && !tid.includes("metal") && tid !== "fire_door";

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(brAngle);

  if (isSail) {
    ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1.8, pw * 0.4); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, -ph/2); ctx.lineTo(0, ph/2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -ph*0.38);
    ctx.quadraticCurveTo(ph*0.6, 0, 0, ph*0.38);
    ctx.stroke();
  } else if (isBarrier) {
    ctx.fillStyle = "#555"; ctx.strokeStyle = "#222"; ctx.lineWidth = 1.3;
    ctx.fillRect(-pw, -ph/2, pw, ph); ctx.strokeRect(-pw, -ph/2, pw, ph);
    ctx.fillStyle = "#c00"; ctx.strokeStyle = "#800";
    ctx.fillRect(0, -ph/2, pw, ph); ctx.strokeRect(0, -ph/2, pw, ph);
  } else if (isFirePP) {
    ctx.fillStyle = "#dc2626"; ctx.strokeStyle = "#8b0000"; ctx.lineWidth = 1.3;
    ctx.fillRect(-pw - gap/2, -ph/2, pw, ph); ctx.strokeRect(-pw - gap/2, -ph/2, pw, ph);
    ctx.fillRect(gap/2, -ph/2, pw, ph); ctx.strokeRect(gap/2, -ph/2, pw, ph);
  } else if (isOpen) {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = sw2;
    ctx.fillRect(-pw/2, -ph/2, pw, ph*0.38); ctx.strokeRect(-pw/2, -ph/2, pw, ph*0.38);
    ctx.fillRect(-pw/2, ph*0.12, pw, ph*0.38); ctx.strokeRect(-pw/2, ph*0.12, pw, ph*0.38);
    ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1.8, pw * 0.3); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-pw/2, ph*0.12); ctx.lineTo(-pw/2 - ph*0.45, ph/2); ctx.stroke();
  } else if (isDoor || isAuto) {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = sw2;
    ctx.fillRect(-pw/2, -ph/2, pw, ph); ctx.strokeRect(-pw/2, -ph/2, pw, ph);
    ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(2, pw * 0.35); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-pw/2, -ph/2); ctx.lineTo(-pw/2, ph/2); ctx.stroke();
    if (isAuto) {
      const cx2 = pw/2 + ph*0.28;
      ctx.fillStyle = "white"; ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(cx2, 0, ph*0.2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = stroke;
      ctx.font = `bold ${ph * 0.2}px Arial`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("А", cx2, 0);
    }
  } else {
    ctx.fillStyle = fill;
    ctx.strokeStyle = isBlind ? "#000000" : stroke;
    ctx.lineWidth   = isBlind ? Math.max(0.8, pw * 0.28) : sw2;
    ctx.fillRect(-pw/2, -ph/2, pw, ph); ctx.strokeRect(-pw/2, -ph/2, pw, ph);
    if (isWindow || isProem) {
      ctx.fillStyle = "white";
      ctx.fillRect(-pw*0.25, -ph*0.2, pw*0.5, ph*0.4);
      ctx.strokeRect(-pw*0.25, -ph*0.2, pw*0.5, ph*0.4);
    }
    if (isLattice) {
      ctx.strokeStyle = stroke; ctx.lineWidth = 0.8;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(pw*0.2*i, -ph*0.45); ctx.lineTo(pw*0.2*i, ph*0.45); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-pw*0.4, 0); ctx.lineTo(pw*0.4, 0); ctx.stroke();
    }
    if (isWater) {
      ctx.fillStyle = fill === "white" ? "#1565c0" : "white";
      ctx.font = `bold ${ph * 0.3}px Arial`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("D", 0, 0);
    }
    if (tid === "fire_door") {
      ctx.fillStyle = "white";
      ctx.font = `bold ${ph * 0.22}px Arial`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("ПП", 0, 0);
    }
  }

  ctx.restore();
}

// ── Индикаторы перемычки ───────────────────────────────────────────────────
function drawBulkheadIndicators(
  ctx: CanvasRenderingContext2D,
  sym: SchemaSymbol,
  px: number, py: number, SZ: number,
  fsx: number, fsy: number, tsx2: number, tsy2: number,
  sc: number, ss: number,
  unitsConfig: UnitsConfig,
  branches: TopoBranch[],
) {
  const br = branches.find(b => b.id === sym.branchId);
  if (!br) return;
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
  if (!lines.length) return;

  const fSize = Math.max(6, Math.round(9 * sc * ss));
  const lineH = fSize + 3;
  const boxH  = lines.length * lineH + 6;
  const brDx  = tsx2 - fsx, brDy = tsy2 - fsy;
  const brLen = Math.hypot(brDx, brDy);
  const perpX = brLen > 0 ? -brDy / brLen : 0;
  const perpY = brLen > 0 ?  brDx / brLen : 0;
  const maxLen = Math.max(...lines.map(l => l.length));
  const boxW  = maxLen * fSize * 0.52 + 10;
  const bx = px + perpX * (16 + boxW / 2) + (sym.indOffsetX ?? 0);
  const by = py + perpY * (16 + boxH / 2) + (sym.indOffsetY ?? 0);

  // Выноска
  ctx.save();
  ctx.strokeStyle = "#555555"; ctx.lineWidth = 0.4;
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by - boxH/2); ctx.stroke();
  ctx.setLineDash([]);

  // Текст с белым обводом
  ctx.font = `${fSize}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    const ty = by - boxH/2 + i * lineH + 3;
    ctx.strokeStyle = "white"; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
    ctx.strokeText(line, bx, ty);
    ctx.fillStyle = "#1a2a4a";
    ctx.font = i === 0 && sym.indDescription
      ? `600 ${fSize}px "Segoe UI", sans-serif`
      : `${fSize}px "Segoe UI", sans-serif`;
    ctx.fillText(line, bx, ty);
  });
  ctx.restore();
}