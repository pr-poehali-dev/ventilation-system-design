// ─────────────────────────────────────────────────────────────────────────────
// Импорт DXF-схемы вентиляционной сети (НаноКАД, АэроСеть, AutoCAD)
//
// Поддерживает:
//   LINE         — отрезок → ветвь сети
//   LWPOLYLINE   — лёгкая полилиния → цепочка ветвей
//   POLYLINE     — классическая полилиния (с VERTEX/SEQEND)
//   Кодировки    — UTF-8, CP1251 (через TextDecoder при необходимости)
//   Пробелы      — trimming кода и значения, пустые строки игнорируются
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface DxfImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { lines: number; polylines: number; nodes: number; branches: number };
  debug?: string;
  /** Рекомендуемое значение epsilon для этого файла (уже применённое) */
  epsilonUsed?: number;
  /** Масштаб конвертации единиц (0.001 = мм→м) */
  scaleUsed?: number;
  /** Диапазон Z в исходных единицах (до конвертации) — для диагностики */
  zRange?: { min: number; max: number; hasZ: boolean };
  /** Диапазон XY в метрах — для диагностики */
  xyRange?: { dx: number; dy: number };
  /** Сырые сегменты (без кластеризации) — для восстановления вертикалей */
  rawSegmentsCount?: number;
}

/** Параметры импорта DXF */
export interface DxfImportOptions {
  /** Порог слияния узлов в метрах. Undefined = автоматически. */
  epsilon?: number;
  /** Если включено — Z-координаты узлов берутся из их выявленного "горизонта" (уровня).
   *  Это правит ситуации когда DXF — 2D и Z=0 у всех точек, но узлы по факту на разных этажах
   *  (например, поверхность и горизонт −240м). НЕ работает без подсказки горизонтов.
   *  Подсказка: список Z-уровней в метрах. */
  horizonsZ?: number[];
  /** Если true — для совпадающих по XY точек (вертикальная проекция) считать их одним узлом. */
  collapseVerticalToZero?: boolean;
}

interface Pt3 { x: number; y: number; z: number }

function dist3(a: Pt3, b: Pt3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function clusterPoints(pts: Pt3[], epsilon: number): { clusters: Pt3[]; map: number[] } {
  const clusters: Pt3[] = [];
  const map: number[] = new Array(pts.length).fill(-1);
  for (let i = 0; i < pts.length; i++) {
    if (map[i] >= 0) continue;
    const ci = clusters.length;
    clusters.push({ x: pts[i].x, y: pts[i].y, z: pts[i].z });
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

// ── Главный парсер ────────────────────────────────────────────────────────────

export function parseDxf(content: string, epsilonOverride?: number): DxfImportResult {
  const warnings: string[] = [];
  const debugLines: string[] = [];

  // Нормализуем переводы строк и разбиваем на токены
  // DXF: чередующиеся строки — сначала код группы (число), затем значение
  const rawLines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  // Собираем пары [code, value], пропуская пустые строки
  const pairs: [string, string][] = [];
  {
    let i = 0;
    while (i < rawLines.length) {
      const codeLine = rawLines[i].trim();
      i++;
      if (codeLine === "") continue;  // пропускаем пустые
      const valueLine = (rawLines[i] ?? "").trim();
      i++;
      pairs.push([codeLine, valueLine]);
    }
  }

  debugLines.push(`Всего пар код/значение: ${pairs.length}`);

  // ── Ищем секции ───────────────────────────────────────────────────────────
  // DXF структура: 0 SECTION → 2 ENTITIES → ... → 0 ENDSEC
  // Нам нужна секция ENTITIES

  interface Seg { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; layer: string }
  interface TextEntity { x: number; y: number; z: number; text: string; layer: string }
  const segments: Seg[] = [];
  const texts: TextEntity[] = [];
  let lineCount = 0;
  let polylineCount = 0;

  // TEXT/MTEXT state
  const tx = 0, ty = 0, tz = 0;
  const tText = "";

  let inEntitiesSection = false;
  let sectionName = "";
  let entityType = "";
  let entityLayer = "0";

  // LINE state
  let lx1 = 0, ly1 = 0, lz1 = 0;
  let lx2 = 0, ly2 = 0, lz2 = 0;

  // LWPOLYLINE state
  let lwPts: Pt3[] = [];
  let lwClosed = false;
  let lwX: number | null = null;
  let lwY: number | null = null;
  let lwZ = 0;

  // POLYLINE/VERTEX state
  let inPolyline = false;
  let polyPts: Pt3[] = [];
  let polyClosed = false;
  let vx = 0, vy = 0, vz = 0;
  let inVertex = false;

  const flushLine = () => {
    if (lx1 === lx2 && ly1 === ly2 && lz1 === lz2) return;  // нулевой отрезок
    segments.push({ x1: lx1, y1: ly1, z1: lz1, x2: lx2, y2: ly2, z2: lz2, layer: entityLayer });
    lineCount++;
    lx1 = ly1 = lz1 = lx2 = ly2 = lz2 = 0;
  };

  const flushText = () => {
    if (tText && tText.trim()) {
      texts.push({ x: tx, y: ty, z: tz, text: tText.trim(), layer: entityLayer });
    }
    tx = ty = tz = 0; tText = "";
  };

  const flushVertex = () => {
    if (inVertex) {
      polyPts.push({ x: vx, y: vy, z: vz });
      vx = vy = vz = 0;
      inVertex = false;
    }
  };

  const flushLwPolyline = () => {
    // Добавляем последнюю точку если lwX определён
    if (lwX !== null) {
      lwPts.push({ x: lwX, y: lwY ?? 0, z: lwZ });
      lwX = null; lwY = null; lwZ = 0;
    }
    if (lwPts.length >= 2) {
      for (let k = 0; k < lwPts.length - 1; k++) {
        const a = lwPts[k], b = lwPts[k + 1];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z) {
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
        }
      }
      if (lwClosed && lwPts.length > 2) {
        const a = lwPts[lwPts.length - 1], b = lwPts[0];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z) {
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
        }
      }
      polylineCount++;
    }
    lwPts = []; lwClosed = false; lwX = null; lwY = null; lwZ = 0;
  };

  const flushPolyline = () => {
    flushVertex();
    if (polyPts.length >= 2) {
      for (let k = 0; k < polyPts.length - 1; k++) {
        const a = polyPts[k], b = polyPts[k + 1];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z) {
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
        }
      }
      if (polyClosed && polyPts.length > 2) {
        const a = polyPts[polyPts.length - 1], b = polyPts[0];
        if (a.x !== b.x || a.y !== b.y || a.z !== b.z) {
          segments.push({ x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, layer: entityLayer });
        }
      }
      polylineCount++;
    }
    polyPts = []; polyClosed = false; inPolyline = false;
  };

  // Счётчик объектов в секции для отладки
  let entityCount = 0;

  for (const [codeStr, value] of pairs) {
    const code = parseInt(codeStr, 10);
    if (isNaN(code)) continue;

    // Код 0 — переключение между сущностями/секциями
    if (code === 0) {
      const val = value.toUpperCase().trim();

      // Завершаем предыдущую сущность
      if (entityType === "LINE" && inEntitiesSection) flushLine();
      else if (entityType === "LWPOLYLINE" && inEntitiesSection) flushLwPolyline();
      else if ((entityType === "TEXT" || entityType === "MTEXT") && inEntitiesSection) flushText();
      else if (entityType === "SEQEND" && inPolyline) { /* handled below */ }
      else if (inVertex && inEntitiesSection) flushVertex();

      if (val === "SECTION") {
        // Ждём следующий код 2 с именем секции
        sectionName = "";
        entityType = "_SECTION_START";
      } else if (val === "ENDSEC") {
        inEntitiesSection = false;
        entityType = "";
        sectionName = "";
      } else if (val === "EOF") {
        break;
      } else if (inEntitiesSection) {
        entityCount++;
        entityType = val;
        entityLayer = "0";

        if (val === "LINE") {
          lx1 = ly1 = lz1 = lx2 = ly2 = lz2 = 0;
        } else if (val === "LWPOLYLINE") {
          flushLwPolyline();
          lwPts = []; lwClosed = false; lwX = null; lwY = null; lwZ = 0;
        } else if (val === "POLYLINE" || val === "3DPOLYLINE") {
          inPolyline = true; polyPts = []; polyClosed = false;
        } else if ((val === "VERTEX" || val === "3DPOLYLINE") && inPolyline) {
          flushVertex();
          vx = vy = vz = 0; inVertex = true;
        } else if (val === "SEQEND") {
          flushPolyline();
          entityType = "";
        } else if (val === "TEXT" || val === "MTEXT") {
          tx = ty = tz = 0; tText = "";
        }
      } else {
        entityType = val;
      }
      continue;
    }

    // Код 2 — имя секции
    if (code === 2 && entityType === "_SECTION_START") {
      sectionName = value.toUpperCase().trim();
      if (sectionName === "ENTITIES") {
        inEntitiesSection = true;
        entityCount = 0;
        debugLines.push("Секция ENTITIES найдена");
      }
      entityType = "";
      continue;
    }

    if (!inEntitiesSection) continue;

    const num = parseFloat(value);

    // Слой
    if (code === 8) { entityLayer = value; continue; }

    // Координаты LINE
    if (entityType === "LINE") {
      if (code === 10) lx1 = num;
      else if (code === 20) ly1 = num;
      else if (code === 30) lz1 = num;
      else if (code === 11) lx2 = num;
      else if (code === 21) ly2 = num;
      else if (code === 31) lz2 = num;
    }

    // Координаты LWPOLYLINE (коды 10/20/38 для каждой вершины)
    else if (entityType === "LWPOLYLINE") {
      if (code === 70) { lwClosed = (parseInt(value) & 1) === 1; }
      else if (code === 38) { lwZ = num; }  // общая Z для всех вершин LWPOLYLINE
      else if (code === 10) {
        // Новая X — значит начинается новая точка, сохраняем предыдущую
        if (lwX !== null) {
          lwPts.push({ x: lwX, y: lwY ?? 0, z: lwZ });
        }
        lwX = num; lwY = null;
      }
      else if (code === 20) { lwY = num; }
    }

    // Координаты POLYLINE / 3DPOLYLINE VERTEX
    else if ((entityType === "VERTEX" || entityType === "3DPOLYLINE") && inPolyline && inVertex) {
      if (code === 10) vx = num;
      else if (code === 20) vy = num;
      else if (code === 30) vz = num;
    }

    // Флаги POLYLINE / 3DPOLYLINE
    else if (entityType === "POLYLINE" || entityType === "3DPOLYLINE") {
      if (code === 70) polyClosed = (parseInt(value) & 1) === 1;
    }

    // TEXT/MTEXT — координаты точки вставки и содержимое
    else if (entityType === "TEXT" || entityType === "MTEXT") {
      if (code === 10) tx = num;
      else if (code === 20) ty = num;
      else if (code === 30) tz = num;
      else if (code === 1) tText += value;       // основной текст (может быть многострочным)
      else if (code === 3) tText += value;       // продолжение MTEXT
    }
  }

  // Завершаем последнюю незакрытую сущность
  if (entityType === "LINE" && inEntitiesSection) flushLine();
  if (entityType === "LWPOLYLINE") flushLwPolyline();
  if (inPolyline) flushPolyline();
  if ((entityType === "TEXT" || entityType === "MTEXT") && inEntitiesSection) flushText();

  debugLines.push(`Сущностей в ENTITIES: ${entityCount}, сегментов собрано: ${segments.length}, текстов: ${texts.length}`);
  debugLines.push(`LINE: ${lineCount}, POLYLINE/3DPOLY/LWPOLY: ${polylineCount}`);
  const zVals = segments.map(s => Math.abs(s.z1)).concat(segments.map(s => Math.abs(s.z2)));
  const maxZ = zVals.length > 0 ? Math.max(...zVals) : 0;
  debugLines.push(`Max |Z|=${maxZ.toFixed(2)}, Max |XY|=${Math.max(...segments.flatMap(s => [Math.abs(s.x1), Math.abs(s.y1), Math.abs(s.x2), Math.abs(s.y2)])).toFixed(2)}`);

  if (segments.length === 0) {
    // Дополнительная диагностика
    const hasEntities = pairs.some(([, v]) => v.trim().toUpperCase() === "ENTITIES");
    const hasLine = pairs.some(([, v]) => v.trim().toUpperCase() === "LINE");
    const hasLWPoly = pairs.some(([, v]) => v.trim().toUpperCase() === "LWPOLYLINE");
    debugLines.push(`Наличие "ENTITIES" в файле: ${hasEntities}`);
    debugLines.push(`Наличие "LINE" в файле: ${hasLine}`);
    debugLines.push(`Наличие "LWPOLYLINE" в файле: ${hasLWPoly}`);

    let msg = "В файле не найдено ни одного отрезка LINE или полилинии.";
    if (!hasEntities) msg += " Секция ENTITIES не обнаружена — возможно файл повреждён или имеет нестандартную структуру.";
    else if (!hasLine && !hasLWPoly) msg += " Секция ENTITIES пуста или содержит только другие объекты (TEXT, ARC, CIRCLE и т.д.).";
    else msg += " Попробуйте экспортировать DXF заново, выбрав опцию «Только линии» или отключив 3D-тела.";
    warnings.push(msg);

    return {
      nodes: [], branches: [], warnings,
      stats: { lines: 0, polylines: 0, nodes: 0, branches: 0 },
      debug: debugLines.join("\n"),
    };
  }

  // ── Определяем единицы ───────────────────────────────────────────────────
  // Включаем Z-координаты: вертикальные стволы могут иметь Z >> XY
  const allCoords: number[] = [];
  for (const s of segments) {
    allCoords.push(Math.abs(s.x1), Math.abs(s.y1), Math.abs(s.z1), Math.abs(s.x2), Math.abs(s.y2), Math.abs(s.z2));
  }
  const maxCoord = Math.max(...allCoords);
  let scale = 1;
  if (maxCoord > 100000) { scale = 0.001; warnings.push("Единицы определены как мм → конвертированы в м."); }
  else if (maxCoord > 10000) { scale = 0.01; warnings.push("Единицы определены как см → конвертированы в м."); }
  const toM = (v: number) => v * scale;

  // ── Анализ диапазона Z (диагностика) ─────────────────────────────────────
  const zsRaw = segments.flatMap(s => [s.z1, s.z2]);
  const zMin = Math.min(...zsRaw);
  const zMax = Math.max(...zsRaw);
  const hasZ = (zMax - zMin) > 0.001;  // есть ли разница в Z
  if (!hasZ) {
    warnings.push(
      "⚠ В DXF нет 3D-координат: все точки имеют одинаковый Z. " +
      "Вертикальные стволы будут импортированы как 2D-линии (угол наклона = 0°). " +
      "Чтобы импортировать настоящую 3D-сеть, экспортируйте DXF c сохранением 3D-координат " +
      "(в Аэросети: «Вид сети» → «Косоугольная» → экспорт DXF; в НаноКАД: 3DPOLY вместо POLY)."
    );
  }

  // ── Кластеризация ────────────────────────────────────────────────────────
  // Координаты уже в метрах (toM применён). Epsilon: точки считаются одним узлом
  // если расстояние < epsilon. Для DXF из НаноКАД/АэроСеть геометрия точная,
  // поэтому epsilon = 0.05 м (5 см) — достаточно чтобы слить совпадающие концы,
  // но не слить близкие но разные узлы выработок.
  const allPts: Pt3[] = [];
  for (const s of segments) {
    allPts.push({ x: toM(s.x1), y: toM(s.y1), z: toM(s.z1) });
    allPts.push({ x: toM(s.x2), y: toM(s.y2), z: toM(s.z2) });
  }

  const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);

  // Epsilon: если передан из диалога — используем его, иначе адаптивный
  const epsilonAuto = Math.min(5, Math.max(0.05, extent * 0.001));
  const epsilon = epsilonOverride ?? epsilonAuto;

  const { clusters, map } = clusterPoints(allPts, epsilon);
  debugLines.push(`Точек: ${allPts.length}, кластеров (узлов): ${clusters.length}, epsilon: ${epsilon.toFixed(4)} м, extent: ${extent.toFixed(1)} м`);

  // ── Строим узлы ──────────────────────────────────────────────────────────
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

  // ── Парсинг текстов (привязка к ближайшей ветви для извлечения длин/углов/имён) ──
  // Тексты приведём к координатам в метрах
  const textsM = texts.map(t => ({ ...t, x: toM(t.x), y: toM(t.y), z: toM(t.z) }));
  // Регулярки распознавания (поддерживаем разные форматы Аэросети/НаноКАД)
  const reLen = /(?:L\s*=|Дл(?:ина)?\s*[:=]?\s*|len\s*=\s*)\s*([0-9]+(?:[.,][0-9]+)?)/i;
  const reAng = /(?:A\s*=|Угол\s*[:=]?\s*|angle\s*=\s*)\s*(-?[0-9]+(?:[.,][0-9]+)?)\s*[°˚]?/i;
  const reFlow = /(?:Q\s*=|Расход\s*[:=]?\s*)\s*([0-9]+(?:[.,][0-9]+)?)/i;
  const reName = /Ствол\s+\S+|Квершлаг\s*\S*|Штрек\s*\S*|Уклон\s*\S*|Сбойка\s*\S*/i;

  // Найти текст ближайший к середине каждого сегмента
  const segLabels: { len?: number; angle?: number; flow?: number; name?: string }[] = segments.map((s) => {
    const mx = toM((s.x1 + s.x2) / 2);
    const my = toM((s.y1 + s.y2) / 2);
    const segLenM = Math.sqrt((toM(s.x2 - s.x1)) ** 2 + (toM(s.y2 - s.y1)) ** 2 + (toM(s.z2 - s.z1)) ** 2);
    // Радиус поиска — половина длины сегмента + 5 м
    const r = Math.max(2, segLenM * 0.5 + 5);
    let best: TextEntity | null = null;
    let bestDist = Infinity;
    for (const t of textsM) {
      const d = Math.sqrt((t.x - mx) ** 2 + (t.y - my) ** 2);
      if (d < r && d < bestDist) {
        bestDist = d; best = t;
      }
    }
    if (!best) return {};
    const result: { len?: number; angle?: number; flow?: number; name?: string } = {};
    const txt = best.text.replace(/\\P/g, "\n").replace(/[{}]/g, "");
    const mLen = txt.match(reLen);
    if (mLen) result.len = parseFloat(mLen[1].replace(",", "."));
    const mAng = txt.match(reAng);
    if (mAng) result.angle = parseFloat(mAng[1].replace(",", "."));
    const mFlow = txt.match(reFlow);
    if (mFlow) result.flow = parseFloat(mFlow[1].replace(",", "."));
    const mName = txt.match(reName);
    if (mName) result.name = mName[0];
    return result;
  });

  // ── Строим ветви ─────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;
  let labelsApplied = 0;

  for (let si = 0; si < segments.length; si++) {
    const fromCluster = map[si * 2];
    const toCluster = map[si * 2 + 1];
    if (fromCluster === toCluster) continue;
    const key = `${Math.min(fromCluster, toCluster)}_${Math.max(fromCluster, toCluster)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const seg = segments[si];
    const lbl = segLabels[si] || {};
    const patch: Partial<TopoBranch> = {
      layer: seg.layer !== "0" ? seg.layer : "Стволы",
    };
    if (lbl.len !== undefined && lbl.len > 0) {
      patch.length = Math.round(lbl.len * 10) / 10;
      patch.manualLength = true;  // фиксируем — длина из подписи в DXF
      labelsApplied++;
    }
    if (lbl.angle !== undefined) {
      patch.angle = Math.max(-90, Math.min(90, lbl.angle));
      patch.manualAngle = true;
    }
    if (lbl.flow !== undefined) patch.flow = lbl.flow;
    if (lbl.name) patch.type = lbl.name;
    branches.push(makeBranch(`B${ts}_${bi++}`, nodes[fromCluster].id, nodes[toCluster].id, patch));
  }
  if (labelsApplied > 0) {
    warnings.push(`📐 Из подписей в DXF извлечены длины/углы для ${labelsApplied} из ${branches.length} ветвей.`);
  }

  return {
    nodes, branches, warnings,
    stats: { lines: lineCount, polylines: polylineCount, nodes: nodes.length, branches: branches.length },
    debug: debugLines.join("\n"),
    epsilonUsed: epsilon,
    scaleUsed: scale,
    zRange: { min: zMin, max: zMax, hasZ },
    xyRange: { dx: Math.max(...xs) - Math.min(...xs), dy: Math.max(...ys) - Math.min(...ys) },
    rawSegmentsCount: segments.length,
  };
}