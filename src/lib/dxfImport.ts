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

export function parseDxf(content: string): DxfImportResult {
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
  const segments: Seg[] = [];
  let lineCount = 0;
  let polylineCount = 0;

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
        } else if (val === "POLYLINE") {
          inPolyline = true; polyPts = []; polyClosed = false;
        } else if (val === "VERTEX" && inPolyline) {
          flushVertex();
          vx = vy = vz = 0; inVertex = true;
        } else if (val === "SEQEND") {
          flushPolyline();
          entityType = "";
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

    // Координаты POLYLINE VERTEX
    else if (entityType === "VERTEX" && inPolyline && inVertex) {
      if (code === 10) vx = num;
      else if (code === 20) vy = num;
      else if (code === 30) vz = num;
    }

    // Флаги POLYLINE
    else if (entityType === "POLYLINE") {
      if (code === 70) polyClosed = (parseInt(value) & 1) === 1;
    }
  }

  // Завершаем последнюю незакрытую сущность
  if (entityType === "LINE" && inEntitiesSection) flushLine();
  if (entityType === "LWPOLYLINE") flushLwPolyline();
  if (inPolyline) flushPolyline();

  debugLines.push(`Сущностей в ENTITIES: ${entityCount}, сегментов собрано: ${segments.length}`);
  debugLines.push(`LINE: ${lineCount}, POLYLINE/LWPOLY: ${polylineCount}`);

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
  const allCoords: number[] = [];
  for (const s of segments) {
    allCoords.push(Math.abs(s.x1), Math.abs(s.y1), Math.abs(s.x2), Math.abs(s.y2));
  }
  const maxCoord = Math.max(...allCoords);
  let scale = 1;
  if (maxCoord > 100000) { scale = 0.001; warnings.push("Единицы определены как мм → конвертированы в м."); }
  else if (maxCoord > 10000) { scale = 0.01; warnings.push("Единицы определены как см → конвертированы в м."); }
  const toM = (v: number) => v * scale;

  // ── Кластеризация ────────────────────────────────────────────────────────
  const allPts: Pt3[] = [];
  for (const s of segments) {
    allPts.push({ x: toM(s.x1), y: toM(s.y1), z: toM(s.z1) });
    allPts.push({ x: toM(s.x2), y: toM(s.y2), z: toM(s.z2) });
  }

  const xs = allPts.map((p) => p.x), ys = allPts.map((p) => p.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const epsilon = Math.max(0.1, extent * 0.002);

  const { clusters, map } = clusterPoints(allPts, epsilon);
  debugLines.push(`Точек: ${allPts.length}, кластеров (узлов): ${clusters.length}, epsilon: ${epsilon.toFixed(3)}`);

  // ── Строим узлы ──────────────────────────────────────────────────────────
  const ts = Date.now();
  const nodes: TopoNode[] = clusters.map((pt, i) => {
    const num = String(i + 1).padStart(3, "0");
    return makeNode(`N${ts}_${i}`, {
      x: Math.round(toM(pt.x / scale) * 10) / 10,  // уже toM применён в allPts
      y: Math.round(toM(pt.y / scale) * 10) / 10,
      z: Math.round(toM(pt.z / scale) * 10) / 10,
      number: num, name: `Узел ${num}`,
    });
  });

  // Исправляем координаты (кластеры уже в метрах через allPts)
  clusters.forEach((pt, i) => {
    nodes[i].x = Math.round(pt.x * 10) / 10;
    nodes[i].y = Math.round(pt.y * 10) / 10;
    nodes[i].z = Math.round(pt.z * 10) / 10;
  });

  // ── Строим ветви ─────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (let si = 0; si < segments.length; si++) {
    const fromCluster = map[si * 2];
    const toCluster = map[si * 2 + 1];
    if (fromCluster === toCluster) continue;
    const key = `${Math.min(fromCluster, toCluster)}_${Math.max(fromCluster, toCluster)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const seg = segments[si];
    branches.push(makeBranch(`B${ts}_${bi++}`, nodes[fromCluster].id, nodes[toCluster].id, {
      layer: seg.layer !== "0" ? seg.layer : "Стволы",
    }));
  }

  return {
    nodes, branches, warnings,
    stats: { lines: lineCount, polylines: polylineCount, nodes: nodes.length, branches: branches.length },
    debug: debugLines.join("\n"),
  };
}
