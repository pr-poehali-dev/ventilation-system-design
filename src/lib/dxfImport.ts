// ─────────────────────────────────────────────────────────────────────────────
// Импорт DXF-схемы вентиляционной сети (АэроСеть, НаноКАД, AutoCAD)
//
// АэроСеть экспортирует косоугольную (кабинетную) проекцию:
//   X_dxf = X_мир
//   Y_dxf = Y_мир + k * Z_мир   (k — коэффициент проекции, ~9-10 для шахт)
//   Z_dxf = Z_мир               (реальная глубина в метрах)
//
// Обратное преобразование:
//   X_мир = X_dxf
//   Z_мир = Z_dxf
//   Y_мир = Y_dxf − k * Z_dxf
//
// Коэффициент k вычисляется автоматически из данных файла:
//   Если есть сегмент где X и Z одинаковые у обоих концов (вертикальная ветвь),
//   то ΔY_dxf = k * ΔZ_dxf → k = ΔY_dxf / ΔZ_dxf.
//
// Слои:
//   *_c / *_axis / axis — оси ветвей (основные LINE для топологии)
//   Sloj-* / layer*    — контур сечения (POLYLINE, игнорируется для топологии)
//   indicators_layer   — подписи (TEXT/MTEXT)
//   CIRCLE             — узлы сети (центр + Z = координаты узла)
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface DxfImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { lines: number; polylines: number; nodes: number; branches: number; circles: number };
  debug?: string;
  epsilonUsed?: number;
  scaleUsed?: number;
  /** Обнаруженный коэффициент косоугольной проекции (0 = нет проекции / плоский файл) */
  obliqueFactor?: number;
  zRange?: { min: number; max: number; hasZ: boolean };
}

interface Pt3 { x: number; y: number; z: number }
interface Seg { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; layer: string }
interface CircleEnt { cx: number; cy: number; cz: number; r: number; layer: string }
interface TextEnt { x: number; y: number; z: number; text: string; layer: string }

function dist3(a: Pt3, b: Pt3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function clusterPoints(pts: Pt3[], epsilon: number): { clusters: Pt3[]; map: number[] } {
  const clusters: Pt3[] = [];
  const map: number[] = new Array(pts.length).fill(-1);
  for (let i = 0; i < pts.length; i++) {
    if (map[i] >= 0) continue;
    const ci = clusters.length;
    clusters.push({ ...pts[i] });
    map[i] = ci;
    for (let j = i + 1; j < pts.length; j++) {
      if (map[j] >= 0) continue;
      if (dist3(pts[i], pts[j]) <= epsilon) {
        map[j] = ci;
        clusters[ci] = {
          x: (clusters[ci].x + pts[j].x) / 2,
          y: (clusters[ci].y + pts[j].y) / 2,
          z: (clusters[ci].z + pts[j].z) / 2,
        };
      }
    }
  }
  return { clusters, map };
}

/** Площадь полигона (формула Гаусса) по точкам XY, в м² */
function polygonArea(pts: Pt3[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/** Периметр полигона по точкам XZ (сечение перпендикулярно оси), в м */
function polygonPerimeter(pts: Pt3[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    p += Math.sqrt((pts[j].x - pts[i].x) ** 2 + (pts[j].z - pts[i].z) ** 2);
  }
  return p;
}

// ── Главный парсер ─────────────────────────────────────────────────────────────
export function parseDxf(content: string, epsilonOverride?: number): DxfImportResult {
  const warnings: string[] = [];
  const debugLines: string[] = [];

  const rawLines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const pairs: [string, string][] = [];
  {
    let i = 0;
    while (i < rawLines.length) {
      const codeLine = rawLines[i].trim();
      i++;
      if (codeLine === "") continue;
      const valueLine = (rawLines[i] ?? "").trim();
      i++;
      pairs.push([codeLine, valueLine]);
    }
  }

  debugLines.push(`Пар код/значение: ${pairs.length}`);

  // ── Парсим все сущности из ВСЕХ секций ENTITIES ─────────────────────────────
  const segments: Seg[] = [];
  const circles: CircleEnt[] = [];
  const texts: TextEnt[] = [];
  /** Полигоны контуров сечений (слои без суффикса _c) */
  interface SectionPoly { pts: Pt3[]; layer: string; cx: number; cy: number; cz: number }
  const sectionPolys: SectionPoly[] = [];
  let lineCount = 0;
  let polylineCount = 0;

  let inEntitiesSection = false;
  let entityType = "";
  let entityLayer = "0";

  // LINE state
  let lx1 = 0, ly1 = 0, lz1 = 0, lx2 = 0, ly2 = 0, lz2 = 0;

  // LWPOLYLINE state
  let lwPts: Pt3[] = [];
  let lwClosed = false;
  let lwX: number | null = null, lwY: number | null = null, lwZ = 0;

  // POLYLINE/VERTEX state
  let inPolyline = false;
  let polyPts: Pt3[] = [];
  let polyClosed = false;
  let vx = 0, vy = 0, vz = 0;
  let inVertex = false;

  // CIRCLE state
  let cx = 0, cy = 0, cz = 0, cr = 0;

  // TEXT/MTEXT state
  let tx = 0, ty = 0, tz = 0, tText = "";

  const flushLine = () => {
    if (lx1 === lx2 && ly1 === ly2 && lz1 === lz2) return;
    segments.push({ x1: lx1, y1: ly1, z1: lz1, x2: lx2, y2: ly2, z2: lz2, layer: entityLayer });
    lineCount++;
    lx1 = ly1 = lz1 = lx2 = ly2 = lz2 = 0;
  };

  const flushCircle = () => {
    circles.push({ cx, cy, cz, r: cr, layer: entityLayer });
    cx = cy = cz = cr = 0;
  };

  const flushText = () => {
    const t = tText.replace(/\\P/g, "\n").replace(/[{}\\][a-zA-Z0-9;.]*;?/g, "").trim();
    if (t) texts.push({ x: tx, y: ty, z: tz, text: t, layer: entityLayer });
    tx = ty = tz = 0; tText = "";
  };

  const flushVertex = () => {
    if (inVertex) { polyPts.push({ x: vx, y: vy, z: vz }); vx = vy = vz = 0; inVertex = false; }
  };

  const flushLwPolyline = () => {
    if (lwX !== null) { lwPts.push({ x: lwX, y: lwY ?? 0, z: lwZ }); lwX = null; lwY = null; lwZ = 0; }
    if (lwPts.length >= 2) {
      for (let k = 0; k < lwPts.length - 1; k++) {
        const a = lwPts[k], b = lwPts[k + 1];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z)
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
      }
      if (lwClosed && lwPts.length > 2) {
        const a = lwPts[lwPts.length - 1], b = lwPts[0];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z)
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
      }
      polylineCount++;
    }
    lwPts = []; lwClosed = false; lwX = null; lwY = null; lwZ = 0;
  };

  const flushPolyline = () => {
    flushVertex();
    if (polyPts.length >= 2) {
      // Сохраняем как полигон сечения (для извлечения S и P)
      if (polyPts.length >= 3) {
        const avgX = polyPts.reduce((s, p) => s + p.x, 0) / polyPts.length;
        const avgY = polyPts.reduce((s, p) => s + p.y, 0) / polyPts.length;
        const avgZ = polyPts.reduce((s, p) => s + p.z, 0) / polyPts.length;
        sectionPolys.push({ pts: [...polyPts], layer: entityLayer, cx: avgX, cy: avgY, cz: avgZ });
      }
      for (let k = 0; k < polyPts.length - 1; k++) {
        const a = polyPts[k], b = polyPts[k + 1];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z)
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
      }
      if (polyClosed && polyPts.length > 2) {
        const a = polyPts[polyPts.length - 1], b = polyPts[0];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z)
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
      }
      polylineCount++;
    }
    polyPts = []; polyClosed = false; inPolyline = false;
  };

  for (const [codeStr, value] of pairs) {
    const code = parseInt(codeStr, 10);
    if (isNaN(code)) continue;
    const num = parseFloat(value);

    if (code === 0) {
      const val = value.toUpperCase().trim();

      // Сбрасываем предыдущую сущность
      if (inEntitiesSection) {
        if (entityType === "LINE") flushLine();
        else if (entityType === "LWPOLYLINE") flushLwPolyline();
        else if (entityType === "CIRCLE") flushCircle();
        else if (entityType === "TEXT" || entityType === "MTEXT") flushText();
        else if (inVertex) flushVertex();
      }

      if (val === "SECTION") {
        entityType = "_SECTION_START";
      } else if (val === "ENDSEC") {
        if (inPolyline) flushPolyline();
        inEntitiesSection = false;
        entityType = "";
      } else if (val === "EOF") {
        break;
      } else if (inEntitiesSection) {
        entityType = val;
        entityLayer = "0";
        if (val === "LINE") { lx1 = ly1 = lz1 = lx2 = ly2 = lz2 = 0; }
        else if (val === "CIRCLE") { cx = cy = cz = cr = 0; }
        else if (val === "TEXT" || val === "MTEXT") { tx = ty = tz = 0; tText = ""; }
        else if (val === "LWPOLYLINE") { flushLwPolyline(); lwPts = []; lwClosed = false; lwX = null; lwY = null; lwZ = 0; }
        else if (val === "POLYLINE" || val === "3DPOLYLINE") { inPolyline = true; polyPts = []; polyClosed = false; }
        else if ((val === "VERTEX" || val === "3DPOLYLINE") && inPolyline) { flushVertex(); vx = vy = vz = 0; inVertex = true; }
        else if (val === "SEQEND") { flushPolyline(); entityType = ""; }
      } else {
        entityType = val;
      }
      continue;
    }

    // Имя секции
    if (code === 2 && entityType === "_SECTION_START") {
      if (value.toUpperCase() === "ENTITIES") inEntitiesSection = true;
      entityType = "";
      continue;
    }

    if (!inEntitiesSection) continue;

    // Слой (код 8)
    if (code === 8) { entityLayer = value; continue; }

    const isNanNum = isNaN(num);

    // LINE
    if (entityType === "LINE") {
      if (!isNanNum) {
        if (code === 10) lx1 = num;
        else if (code === 20) ly1 = num;
        else if (code === 30) lz1 = num;
        else if (code === 11) lx2 = num;
        else if (code === 21) ly2 = num;
        else if (code === 31) lz2 = num;
      }
    }

    // CIRCLE
    else if (entityType === "CIRCLE") {
      if (!isNanNum) {
        if (code === 10) cx = num;
        else if (code === 20) cy = num;
        else if (code === 30) cz = num;
        else if (code === 40) cr = num;
      }
    }

    // TEXT / MTEXT
    else if (entityType === "TEXT" || entityType === "MTEXT") {
      if (!isNanNum && code === 10) tx = num;
      else if (!isNanNum && code === 20) ty = num;
      else if (!isNanNum && code === 30) tz = num;
      else if (code === 1) tText += value;
      else if (code === 3) tText += value;
    }

    // LWPOLYLINE
    else if (entityType === "LWPOLYLINE") {
      if (!isNanNum) {
        if (code === 70) { lwClosed = (parseInt(value) & 1) === 1; }
        else if (code === 38) { lwZ = num; }
        else if (code === 10) {
          if (lwX !== null) lwPts.push({ x: lwX, y: lwY ?? 0, z: lwZ });
          lwX = num; lwY = null;
        }
        else if (code === 20) { lwY = num; }
      }
    }

    // VERTEX / 3DPOLYLINE
    else if ((entityType === "VERTEX" || entityType === "3DPOLYLINE") && inPolyline && inVertex) {
      if (!isNanNum) {
        if (code === 10) vx = num;
        else if (code === 20) vy = num;
        else if (code === 30) vz = num;
      }
    }

    // POLYLINE flags
    else if (entityType === "POLYLINE" || entityType === "3DPOLYLINE") {
      if (!isNanNum && code === 70) polyClosed = (parseInt(value) & 1) === 1;
    }
  }

  // Завершаем хвостовые сущности
  if (inEntitiesSection) {
    if (entityType === "LINE") flushLine();
    else if (entityType === "LWPOLYLINE") flushLwPolyline();
    else if (entityType === "CIRCLE") flushCircle();
    else if (entityType === "TEXT" || entityType === "MTEXT") flushText();
  }
  if (inPolyline) flushPolyline();

  debugLines.push(`LINE: ${lineCount}, POLY: ${polylineCount}, CIRCLE: ${circles.length}, TEXT: ${texts.length}`);

  // ── Определяем слои осей ─────────────────────────────────────────────────
  // АэроСеть: оси ветвей — слои *_c, *_axis, axis
  // Остальные слои (без суффикса _c) — контуры сечений, игнорируем для топологии
  const allLayers = [...new Set(segments.map(s => s.layer))];
  debugLines.push(`Слои сегментов: ${allLayers.join(", ")}`);

  // Определяем "осевые" слои: содержат _c, axis, или если нет таких — берём все
  const axisLayers = allLayers.filter(l =>
    /_c$/i.test(l) || /axis/i.test(l) || /ось/i.test(l)
  );
  const topoSegments = axisLayers.length > 0
    ? segments.filter(s => axisLayers.includes(s.layer))
    : segments;

  debugLines.push(`Осевые слои: ${axisLayers.join(", ") || "(все)"}, осевых сегментов: ${topoSegments.length}`);

  if (topoSegments.length === 0 && segments.length === 0 && circles.length === 0) {
    return {
      nodes: [], branches: [], warnings: ["Файл не содержит геометрических объектов (LINE, CIRCLE)."],
      stats: { lines: 0, polylines: 0, nodes: 0, branches: 0, circles: 0 },
      debug: debugLines.join("\n"),
    };
  }

  // ── Определяем масштаб единиц ────────────────────────────────────────────
  const allAbsCoords: number[] = [];
  for (const s of topoSegments.length > 0 ? topoSegments : segments) {
    allAbsCoords.push(Math.abs(s.x1), Math.abs(s.y1), Math.abs(s.z1), Math.abs(s.x2), Math.abs(s.y2), Math.abs(s.z2));
  }
  for (const c of circles) {
    allAbsCoords.push(Math.abs(c.cx), Math.abs(c.cy), Math.abs(c.cz));
  }
  const maxCoord = allAbsCoords.length > 0 ? Math.max(...allAbsCoords) : 0;
  let scale = 1;
  if (maxCoord > 100000) { scale = 0.001; warnings.push("Единицы: мм → конвертированы в м."); }
  else if (maxCoord > 10000) { scale = 0.01; warnings.push("Единицы: см → конвертированы в м."); }
  const toM = (v: number) => v * scale;

  // ── Определяем коэффициент косоугольной проекции ─────────────────────────
  // Для сегментов из осевых слоёв: ищем те, у которых ΔX≈0 и |ΔZ|>0
  // (вертикальные ветви). Для них k = ΔY / ΔZ.
  let obliqueFactor = 0;
  {
    const kSamples: number[] = [];
    for (const s of topoSegments.length > 0 ? topoSegments : segments) {
      const dx = Math.abs(toM(s.x2 - s.x1));
      const dz = toM(s.z2 - s.z1);
      const dy = toM(s.y2 - s.y1);
      if (dx < 0.1 && Math.abs(dz) > 0.5) {
        kSamples.push(dy / dz);
      }
    }
    if (kSamples.length > 0) {
      // Медиана для устойчивости
      kSamples.sort((a, b) => a - b);
      obliqueFactor = kSamples[Math.floor(kSamples.length / 2)];
      debugLines.push(`Косоугольная проекция: k=${obliqueFactor.toFixed(3)} (из ${kSamples.length} вертикальных сегментов)`);
    } else {
      debugLines.push(`Косоугольная проекция: не обнаружена (нет вертикальных сегментов), k=0`);
    }
  }

  // ── Функция обратного преобразования координат ───────────────────────────
  // DXF (косоугольная) → Мировые координаты
  const toWorld = (x: number, y: number, z: number): Pt3 => ({
    x: toM(x),
    y: toM(y) - obliqueFactor * toM(z),
    z: toM(z),
  });

  // ── Диапазон Z ───────────────────────────────────────────────────────────
  const zsRaw = (topoSegments.length > 0 ? topoSegments : segments).flatMap(s => [s.z1, s.z2]);
  for (const c of circles) zsRaw.push(c.cz);
  const zMin = zsRaw.length > 0 ? Math.min(...zsRaw) : 0;
  const zMax = zsRaw.length > 0 ? Math.max(...zsRaw) : 0;
  const hasZ = (zMax - zMin) * scale > 0.1;

  // ── Строим узловые точки ─────────────────────────────────────────────────
  // Приоритет: CIRCLE (узлы Аэросети) > концы LINE
  const allPts: Pt3[] = [];
  const circleWorldPts: Pt3[] = [];

  for (const c of circles) {
    const w = toWorld(c.cx, c.cy, c.cz);
    circleWorldPts.push(w);
    allPts.push(w);
  }

  // Если CIRCLE нет — берём концы осевых сегментов
  if (circles.length === 0) {
    for (const s of topoSegments.length > 0 ? topoSegments : segments) {
      allPts.push(toWorld(s.x1, s.y1, s.z1));
      allPts.push(toWorld(s.x2, s.y2, s.z2));
    }
  }

  if (allPts.length === 0) {
    return {
      nodes: [], branches: [], warnings: ["Нет точек для построения узлов."],
      stats: { lines: lineCount, polylines: polylineCount, nodes: 0, branches: 0, circles: circles.length },
      debug: debugLines.join("\n"),
    };
  }

  // ── Кластеризация узлов ──────────────────────────────────────────────────
  const extent = (() => {
    const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  })();
  const epsilonAuto = Math.min(2, Math.max(0.1, extent * 0.005));
  const epsilon = epsilonOverride ?? epsilonAuto;

  const { clusters, map } = clusterPoints(allPts, epsilon);
  debugLines.push(`Точек: ${allPts.length}, кластеров: ${clusters.length}, eps: ${epsilon.toFixed(3)} м`);

  // ── Создаём узлы ─────────────────────────────────────────────────────────
  const ts = Date.now();
  const nodes: TopoNode[] = clusters.map((pt, i) => {
    const num = String(i + 1).padStart(3, "0");
    return makeNode(`N${ts}_${i}`, {
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      z: Math.round(pt.z * 10) / 10,
      number: num, name: `Узел ${num}`,
    });
  });

  // ── Строим ветви из осевых сегментов ────────────────────────────────────
  // Для каждого осевого сегмента находим ближайший кластер к каждому концу
  const workSegs = topoSegments.length > 0 ? topoSegments : segments;

  const findCluster = (pt: Pt3): number => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      const d = dist3(pt, clusters[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (let si = 0; si < workSegs.length; si++) {
    const seg = workSegs[si];
    const w1 = toWorld(seg.x1, seg.y1, seg.z1);
    const w2 = toWorld(seg.x2, seg.y2, seg.z2);
    const c1 = circles.length > 0 ? findCluster(w1) : map[si * 2];
    const c2 = circles.length > 0 ? findCluster(w2) : map[si * 2 + 1];

    if (c1 === c2) continue;
    const key = `${Math.min(c1, c2)}_${Math.max(c1, c2)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Длину считаем между мировыми координатами узловых кластеров (точнее чем концы LINE)
    const n1 = clusters[c1], n2 = clusters[c2];
    const realLen = Math.round(dist3(n1, n2) * 10) / 10;
    // Угол наклона: arcsin(|ΔZ| / L) — всегда положительный (0..90°)
    const dz = Math.abs(n2.z - n1.z);
    const realAngle = realLen > 0 ? Math.round(Math.asin(Math.min(1, dz / realLen)) * 180 / Math.PI * 10) / 10 : 0;

    branches.push(makeBranch(`B${ts}_${bi++}`, nodes[c1].id, nodes[c2].id, {
      layer: seg.layer.replace(/_c$/i, "") || "Стволы",
      length: realLen,
      manualLength: true,
      angle: realAngle,
      manualAngle: true,
    }));
  }

  // ── Привязка подписей к ветвям ───────────────────────────────────────────
  // TEXT из indicators_layer: ищем числа и извлекаем расход/депрессию
  const reFlow = /(?:Q\s*=\s*|расход\s*)([0-9]+(?:[.,][0-9]+)?)/i;
  let labelsApplied = 0;
  for (const t of texts) {
    const mFlow = t.text.match(reFlow);
    if (!mFlow) continue;
    const q = parseFloat(mFlow[1].replace(",", "."));
    if (!isFinite(q) || q <= 0) continue;
    // Находим ближайшую ветвь по середине
    const tw = toWorld(t.x, t.y, t.z);
    let bestB = -1, bestD = Infinity;
    for (let i = 0; i < branches.length; i++) {
      const n1 = nodes.find(n => n.id === branches[i].fromId)!;
      const n2 = nodes.find(n => n.id === branches[i].toId)!;
      const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2;
      const d = Math.sqrt((tw.x - mx) ** 2 + (tw.y - my) ** 2);
      if (d < bestD) { bestD = d; bestB = i; }
    }
    if (bestB >= 0 && bestD < 50) {
      branches[bestB] = { ...branches[bestB], flow: q };
      labelsApplied++;
    }
  }
  if (labelsApplied > 0) warnings.push(`Из подписей извлечён расход для ${labelsApplied} ветвей.`);

  // ── Извлечение параметров сечения из пар POLYLINE (метод АэроСети) ───────
  // АэроСеть рисует 2 параллельных POLYLINE на ветвь (слой Sloj-1, без суффикса _c).
  // Каждый POLYLINE — ребро сечения вдоль оси ветви.
  // Расстояние между двумя POLYLINE = один из размеров сечения (ширина или высота).
  // Второй размер = расстояние между ПАРАМИ полигонов (2 пары на ветвь = 4 полигона).
  //
  // Алгоритм для одной ветви:
  //   1. Найти все POLYLINE чей центр ближайший к оси ветви (до 4 штук)
  //   2. Разбить на 2 пары по расстоянию между параллельными
  //   3. gap1 = расстояние между центрами пары 1 (перпендикулярно оси)
  //   4. gap2 = расстояние между центрами пары 2 (перпендикулярно оси)
  //   5. Если 2 пары: w = gap1, h = gap2. Если 1 пара: используем только gap1.
  //   6. S = w * h, P = 2*(w+h), dh = 4S/P

  const sectionLayers = [...new Set(sectionPolys.map(p => p.layer))]
    .filter(l => !/_c$/i.test(l) && !/axis/i.test(l) && !/indicator/i.test(l));

  debugLines.push(`Слои полигонов: all=[${[...new Set(sectionPolys.map(p=>p.layer))].join(",")}] section=[${sectionLayers.join(",")}]`);
  // Логируем первые 6 полигонов для диагностики
  sectionPolys.slice(0, 6).forEach((p, i) => {
    const pw = toWorld(p.cx, p.cy, p.cz);
    debugLines.push(`  poly[${i}] layer=${p.layer} pts=${p.pts.length} dxf=(${p.cx.toFixed(1)},${p.cy.toFixed(1)},${p.cz.toFixed(1)}) world=(${pw.x.toFixed(1)},${pw.y.toFixed(1)},${pw.z.toFixed(1)})`);
  });

  if (sectionPolys.length >= 2 && sectionLayers.length > 0) {
    const sectionPolysFiltered = sectionPolys.filter(p => sectionLayers.includes(p.layer));
    let sectionApplied = 0;

    // Строим индекс узлов для быстрого доступа
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (let bi2 = 0; bi2 < branches.length; bi2++) {
      const b = branches[bi2];
      const n1 = nodeMap.get(b.fromId)!;
      const n2 = nodeMap.get(b.toId)!;
      if (!n1 || !n2) continue;

      const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2, mz = (n1.z + n2.z) / 2;
      // Направление ветви (единичный вектор)
      const blen = Math.sqrt((n2.x-n1.x)**2 + (n2.y-n1.y)**2 + (n2.z-n1.z)**2) || 1;
      const bvx = (n2.x-n1.x)/blen, bvy = (n2.y-n1.y)/blen, bvz = (n2.z-n1.z)/blen;

      // Ищем все POLYLINE ближе чем halfLen + 5м к середине ветви
      const halfLen = blen / 2 + 5;
      const near = sectionPolysFiltered.map(poly => {
        const pw = toWorld(poly.cx, poly.cy, poly.cz);
        // Расстояние от центра полигона до оси ветви (перпендикуляр)
        const dx = pw.x - mx, dy = pw.y - my, dz2 = pw.z - mz;
        const proj = dx*bvx + dy*bvy + dz2*bvz;  // проекция на ось
        const perpD = Math.sqrt(Math.max(0, dx*dx+dy*dy+dz2*dz2 - proj*proj));
        const axisD = Math.abs(proj);
        return { poly, pw, perpD, axisD };
      }).filter(p => p.axisD < halfLen && p.perpD < 15)
        .sort((a, b2) => a.perpD - b2.perpD)
        .slice(0, 6);

      if (bi2 < 4) debugLines.push(`  branch[${bi2}] mid=(${mx.toFixed(1)},${my.toFixed(1)},${mz.toFixed(1)}) near=${near.length} gaps будут: ${near.map(p=>p.perpD.toFixed(2)).join(",")}`);
      if (near.length < 2) continue;

      // Группируем POLYLINE попарно: ищем пары с минимальным расстоянием между центрами
      // Для каждой пары: расстояние = размер сечения
      const gaps: number[] = [];
      const used = new Set<number>();

      for (let i = 0; i < near.length; i++) {
        if (used.has(i)) continue;
        let bestJ = -1, bestD = Infinity;
        for (let j = i + 1; j < near.length; j++) {
          if (used.has(j)) continue;
          const d = dist3(near[i].pw, near[j].pw);
          // Только перпендикулярное расстояние (не вдоль оси)
          const dp = near[i].pw.x-near[j].pw.x, dq = near[i].pw.y-near[j].pw.y, dr = near[i].pw.z-near[j].pw.z;
          const projPair = dp*bvx + dq*bvy + dr*bvz;
          const perpPair = Math.sqrt(Math.max(0, d*d - projPair*projPair));
          if (perpPair > 0.1 && perpPair < bestD) { bestD = perpPair; bestJ = j; }
        }
        if (bestJ >= 0) {
          used.add(i); used.add(bestJ);
          gaps.push(bestD);
        }
      }

      if (gaps.length === 0) continue;
      gaps.sort((a, b2) => b2 - a);  // сначала больший

      // АэроСеть: два POLYLINE симметричны относительно оси ветви.
      // Расстояние между ними = ПОЛНЫЙ размер сечения (центр-до-центра).
      // Но т.к. сами POLYLINE проходят по краям сечения (а не по центру),
      // это и есть реальная ширина/высота.
      const w = Math.round(gaps[0] * 10) / 10;
      const h = gaps.length >= 2 ? Math.round(gaps[1] * 10) / 10 : w;

      if (w < 0.5 || w > 30 || h < 0.5 || h > 30) continue;

      const area = Math.round(w * h * 100) / 100;
      const perim = Math.round(2 * (w + h) * 10) / 10;
      const dh2 = Math.round(4 * area / perim * 1000) / 1000;

      branches[bi2] = {
        ...branches[bi2],
        area,
        perimeter: perim,
        dh: dh2,
        rectWidth: w,
        rectHeight: h,
        manualSection: true,
        shape: "rect",
      };
      sectionApplied++;
    }

    if (sectionApplied > 0)
      warnings.push(`Сечения (S, P) извлечены для ${sectionApplied} из ${branches.length} ветвей.`);
    debugLines.push(`Полигонов сечений: ${sectionPolysFiltered.length}, применено: ${sectionApplied}`);
  }

  if (obliqueFactor !== 0) {
    warnings.push(`Косоугольная проекция АэроСети обнаружена (k=${obliqueFactor.toFixed(2)}). Координаты и длины пересчитаны в мировые.`);
  }

  if (!hasZ && obliqueFactor === 0) {
    warnings.push("⚠ Плоский 2D-файл: все Z=0. Длины и углы вертикальных выработок будут равны 0°.");
  }

  debugLines.push(`Ветвей: ${branches.length}, узлов: ${nodes.length}`);

  return {
    nodes, branches, warnings,
    stats: { lines: lineCount, polylines: polylineCount, nodes: nodes.length, branches: branches.length, circles: circles.length },
    debug: debugLines.join("\n"),
    epsilonUsed: epsilon,
    scaleUsed: scale,
    obliqueFactor,
    zRange: { min: zMin * scale, max: zMax * scale, hasZ },
  };
}