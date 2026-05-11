// ─────────────────────────────────────────────────────────────────────────────
// Импорт DXF-схемы вентиляционной сети (из НаноКАД, АэроСеть, AutoCAD)
//
// Что парсим:
//   LINE    — отрезок (ветвь сети), координаты начала и конца
//   LWPOLYLINE / POLYLINE — ломаная (цепочка ветвей)
//   POINT   — узел с явной координатой
//   INSERT  — блок (игнорируем, только извлекаем координату вставки как узел)
//
// Алгоритм:
//   1. Собираем все точки концов LINE-сегментов
//   2. Кластеризуем близкие точки → узлы (epsilon = 0.5 м или 500 мм)
//   3. Каждый LINE-сегмент → ветвь fromId → toId
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface DxfImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { lines: number; polylines: number; nodes: number; branches: number };
}

interface Pt3 { x: number; y: number; z: number }

// ── Вспомогательные ──────────────────────────────────────────────────────────

function dist3(a: Pt3, b: Pt3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// Кластеризация точек: все точки в пределах epsilon → один узел (центроид кластера)
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
        clusters[ci].x = (clusters[ci].x + pts[j].x) / 2;
        clusters[ci].y = (clusters[ci].y + pts[j].y) / 2;
        clusters[ci].z = (clusters[ci].z + pts[j].z) / 2;
      }
    }
  }
  return { clusters, map };
}

// ── Парсер DXF ───────────────────────────────────────────────────────────────

interface DxfEntity {
  type: string;
  layer: string;
  x1: number; y1: number; z1: number;  // начало / или первая точка
  x2: number; y2: number; z2: number;  // конец
  polyPoints?: Pt3[];  // для LWPOLYLINE
  closed?: boolean;
}

export function parseDxf(content: string): DxfImportResult {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);
  const entities: DxfEntity[] = [];

  let inEntities = false;
  let inPolyline = false;
  let currentEntity: Partial<DxfEntity> | null = null;
  let lastCode = "";
  let polyPoints: Pt3[] = [];
  let vertexBuf: Partial<Pt3> = {};

  // Счётчики для статистики
  let lineCount = 0;
  let polylineCount = 0;

  const finaliseEntity = () => {
    if (!currentEntity || !currentEntity.type) return;
    const e = currentEntity;

    if (e.type === "LINE") {
      entities.push({
        type: "LINE",
        layer: e.layer ?? "0",
        x1: e.x1 ?? 0, y1: e.y1 ?? 0, z1: e.z1 ?? 0,
        x2: e.x2 ?? 0, y2: e.y2 ?? 0, z2: e.z2 ?? 0,
      });
      lineCount++;
    } else if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      if (polyPoints.length >= 2) {
        entities.push({
          type: "POLYLINE",
          layer: e.layer ?? "0",
          x1: polyPoints[0].x, y1: polyPoints[0].y, z1: polyPoints[0].z,
          x2: polyPoints[polyPoints.length - 1].x,
          y2: polyPoints[polyPoints.length - 1].y,
          z2: polyPoints[polyPoints.length - 1].z,
          polyPoints: [...polyPoints],
          closed: e.closed,
        });
        polylineCount++;
      }
      polyPoints = [];
    }
    currentEntity = null;
    vertexBuf = {};
  };

  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1]?.trim() ?? "";

    if (code === "0") {
      // Завершить текущую сущность
      if (currentEntity?.type === "VERTEX" && inPolyline) {
        const vx = parseFloat(String(vertexBuf.x ?? 0));
        const vy = parseFloat(String(vertexBuf.y ?? 0));
        const vz = parseFloat(String(vertexBuf.z ?? 0));
        if (!isNaN(vx)) polyPoints.push({ x: vx, y: vy, z: vz });
        vertexBuf = {};
        currentEntity = null;
      } else {
        finaliseEntity();
      }

      const upperVal = value.toUpperCase();

      if (upperVal === "ENDSEC") {
        inEntities = false;
        inPolyline = false;
      }
      if (!inEntities && upperVal !== "ENTITIES") continue;
      if (upperVal === "ENTITIES") { inEntities = true; continue; }

      if (upperVal === "LINE") {
        currentEntity = { type: "LINE", layer: "0", x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0 };
      } else if (upperVal === "LWPOLYLINE") {
        inPolyline = true;
        polyPoints = [];
        currentEntity = { type: "LWPOLYLINE", layer: "0" };
      } else if (upperVal === "POLYLINE") {
        inPolyline = true;
        polyPoints = [];
        currentEntity = { type: "POLYLINE", layer: "0" };
      } else if (upperVal === "VERTEX" && inPolyline) {
        currentEntity = { type: "VERTEX", layer: "0" };
      } else if (upperVal === "SEQEND") {
        if (inPolyline) {
          finaliseEntity();
          inPolyline = false;
          polyPoints = [];
        }
        currentEntity = null;
      } else {
        currentEntity = null;
      }
    } else if (currentEntity) {
      const num = parseFloat(value);
      switch (code) {
        case "8":  currentEntity.layer = value; break;
        // LINE координаты начала
        case "10": if (currentEntity.type === "LINE") (currentEntity as DxfEntity).x1 = num;
                   else if (currentEntity.type === "VERTEX") vertexBuf.x = num;
                   else if (currentEntity.type === "LWPOLYLINE") {
                     if (vertexBuf.x !== undefined) {
                       polyPoints.push({ x: vertexBuf.x, y: vertexBuf.y ?? 0, z: vertexBuf.z ?? 0 });
                       vertexBuf = {};
                     }
                     vertexBuf.x = num;
                   }
                   break;
        case "20": if (currentEntity.type === "LINE") (currentEntity as DxfEntity).y1 = num;
                   else if (currentEntity.type === "VERTEX") vertexBuf.y = num;
                   else if (currentEntity.type === "LWPOLYLINE") vertexBuf.y = num;
                   break;
        case "30": if (currentEntity.type === "LINE") (currentEntity as DxfEntity).z1 = num;
                   else if (currentEntity.type === "VERTEX") vertexBuf.z = num;
                   else if (currentEntity.type === "LWPOLYLINE") vertexBuf.z = num;
                   break;
        // LINE координаты конца
        case "11": if (currentEntity.type === "LINE") (currentEntity as DxfEntity).x2 = num; break;
        case "21": if (currentEntity.type === "LINE") (currentEntity as DxfEntity).y2 = num; break;
        case "31": if (currentEntity.type === "LINE") (currentEntity as DxfEntity).z2 = num; break;
        // Замкнутость полилинии (флаг бит 0 = 1)
        case "70": if (currentEntity.type === "POLYLINE" || currentEntity.type === "LWPOLYLINE")
                     currentEntity.closed = (parseInt(value) & 1) === 1;
                   break;
      }
    }
    lastCode = code;
  }
  finaliseEntity();

  if (entities.length === 0) {
    warnings.push("В файле не найдено ни одного отрезка LINE или полилинии. Проверьте, что файл является DXF-схемой вентиляционной сети.");
    return { nodes: [], branches: [], warnings, stats: { lines: 0, polylines: 0, nodes: 0, branches: 0 } };
  }

  // ── Собираем все точки ────────────────────────────────────────────────────
  // Определяем единицы автоматически: если все координаты > 1000 — скорее всего мм, конвертируем в м
  const allX: number[] = [];
  const allY: number[] = [];
  for (const e of entities) {
    allX.push(e.x1, e.x2);
    allY.push(e.y1, e.y2);
    (e.polyPoints ?? []).forEach((p) => { allX.push(p.x); allY.push(p.y); });
  }
  const maxCoord = Math.max(...allX.map(Math.abs), ...allY.map(Math.abs));
  const scale = maxCoord > 5000 ? 0.001 : maxCoord > 500 ? 0.01 : 1;  // мм→м или см→м
  if (scale < 1) warnings.push(`Обнаружены координаты в ${scale === 0.001 ? "мм" : "см"}, автоматически конвертированы в метры.`);

  const toM = (v: number) => Math.round(v * scale * 100) / 100;

  // ── Собираем сегменты ─────────────────────────────────────────────────────
  interface Seg { a: Pt3; b: Pt3; layer: string }
  const segs: Seg[] = [];
  for (const e of entities) {
    if (e.type === "LINE") {
      segs.push({
        a: { x: toM(e.x1), y: toM(e.y1), z: toM(e.z1) },
        b: { x: toM(e.x2), y: toM(e.y2), z: toM(e.z2) },
        layer: e.layer,
      });
    } else if (e.type === "POLYLINE" && e.polyPoints) {
      const pts = e.polyPoints.map((p) => ({ x: toM(p.x), y: toM(p.y), z: toM(p.z) }));
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ a: pts[i], b: pts[i + 1], layer: e.layer });
      }
      if (e.closed && pts.length > 2) {
        segs.push({ a: pts[pts.length - 1], b: pts[0], layer: e.layer });
      }
    }
  }

  if (segs.length === 0) {
    warnings.push("Не найдено ни одного сегмента для построения ветвей.");
    return { nodes: [], branches: [], warnings, stats: { lines: lineCount, polylines: polylineCount, nodes: 0, branches: 0 } };
  }

  // Фильтруем вырожденные сегменты (нулевая длина)
  const validSegs = segs.filter((s) => dist3(s.a, s.b) > 0.01);
  if (validSegs.length < segs.length) {
    warnings.push(`Отброшено ${segs.length - validSegs.length} вырожденных сегментов (нулевая длина).`);
  }

  // ── Кластеризация точек → узлы ─────────────────────────────────────────
  const allPts: Pt3[] = [];
  for (const s of validSegs) { allPts.push(s.a, s.b); }

  // epsilon: 1% от максимального габарита сети
  const xs = allPts.map((p) => p.x);
  const ys = allPts.map((p) => p.y);
  const extent = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1
  );
  const epsilon = Math.max(0.5, extent * 0.005);  // минимум 0.5 м

  const { clusters, map } = clusterPoints(allPts, epsilon);

  // ── Строим TopoNode[] ─────────────────────────────────────────────────────
  const nodeIdBase = Date.now();
  const nodes: TopoNode[] = clusters.map((pt, i) => {
    const num = String(i + 1).padStart(3, "0");
    return makeNode(`N${nodeIdBase}_${i}`, {
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      z: Math.round(pt.z * 10) / 10,
      number: num,
      name: `Узел ${num}`,
    });
  });

  // ── Строим TopoBranch[] ────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  const branchIdBase = nodeIdBase;
  let bi = 0;

  // Дедупликация: не добавляем одинаковые ветви (те же fromId/toId)
  const branchSet = new Set<string>();

  for (let si = 0; si < validSegs.length; si++) {
    const fromCluster = map[si * 2];
    const toCluster = map[si * 2 + 1];
    if (fromCluster === toCluster) continue;  // вырожденный сегмент
    const key = `${Math.min(fromCluster, toCluster)}_${Math.max(fromCluster, toCluster)}`;
    if (branchSet.has(key)) continue;
    branchSet.add(key);

    const fromId = nodes[fromCluster].id;
    const toId = nodes[toCluster].id;
    const layer = validSegs[si].layer;

    branches.push(makeBranch(`B${branchIdBase}_${bi++}`, fromId, toId, {
      layer: layer !== "0" ? layer : "Стволы",
    }));
  }

  if (branches.length === 0) {
    warnings.push("Не удалось построить ни одной ветви. Возможно, все сегменты совпадают с узлами.");
  }

  return {
    nodes,
    branches,
    warnings,
    stats: {
      lines: lineCount,
      polylines: polylineCount,
      nodes: nodes.length,
      branches: branches.length,
    },
  };
}
