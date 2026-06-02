// ─────────────────────────────────────────────────────────────────────────────
// Импорт CSV из Ventsim
//
// Ventsim экспортирует один CSV-файл с топологией и параметрами:
//   Branch; From; To; Name; Length(m); Area(m2); Perimeter(m); Resistance;
//   Airflow(m3/s); FanPressure(Pa); FanName; ...
//
// Узлы строятся автоматически из множества уникальных From/To.
// Координаты X/Y/Z обычно не экспортируются — узлы раскладываются
// в автоматическую сетку для отображения.
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface VentsimImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { nodes: number; branches: number; fans: number };
  debug: string;
}

// ── Утилиты ──────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(",", ".").replace(/\s/g, "").trim());
  return isNaN(n) ? 0 : n;
}

function cleanStr(s: string | undefined): string {
  return (s ?? "").replace(/"/g, "").trim();
}

function detectSep(line: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of line) if (ch in counts) counts[ch as keyof typeof counts]++;
  if (counts[";"] >= counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] >= counts[","]) return "\t";
  return ",";
}

/** Авто-раскладка узлов в сетку (если нет координат из CSV) */
function autoLayout(nodeIds: string[]): Map<string, { x: number; y: number }> {
  const layout = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(nodeIds.length));
  nodeIds.forEach((id, i) => {
    layout.set(id, {
      x: Math.round((i % cols) * 120),
      y: Math.round(Math.floor(i / cols) * 120),
    });
  });
  return layout;
}

// ── Главная функция ───────────────────────────────────────────────────────────

export function parseVentsimCsv(content: string): VentsimImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];

  const rawLines = content
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (rawLines.length === 0) {
    return { nodes: [], branches: [], warnings: ["Файл пустой."], stats: { nodes: 0, branches: 0, fans: 0 }, debug: "" };
  }

  // Определяем разделитель по первым строкам
  const sep = detectSep(rawLines.slice(0, 3).join("\n"));
  debug.push(`Строк: ${rawLines.length}, разделитель: "${sep}"`);

  // Разбиваем все строки в ячейки
  const rows = rawLines.map(l => l.split(sep).map(c => cleanStr(c)));

  // Ищем строку-заголовок — там должны быть узнаваемые колонки
  let headerRow = -1;
  const colIdx = {
    id: -1, from: -1, to: -1, name: -1,
    length: -1, area: -1, perimeter: -1, resistance: -1,
    flow: -1, fanPressure: -1, fanName: -1,
    x1: -1, y1: -1, z1: -1, x2: -1, y2: -1, z2: -1,
    xFrom: -1, yFrom: -1, zFrom: -1, xTo: -1, yTo: -1, zTo: -1,
  };

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i].map(c => c.toLowerCase());
    const ci = (pat: RegExp) => row.findIndex(c => pat.test(c));

    // Должна быть хотя бы одна из ключевых колонок
    const fromC = ci(/^from$|^from node|^node from|^начал|^от$|^вершина нач|from_id/);
    const toC   = ci(/^to$|^to node|^node to|^конеч|^до$|^вершина кон|to_id/);
    if (fromC < 0 || toC < 0) continue;

    headerRow = i;
    colIdx.id         = ci(/^branch$|^branch id|^id$|^номер|^№|branch_id|^ветвь|^branch num/);
    colIdx.from       = fromC;
    colIdx.to         = toC;
    colIdx.name       = ci(/^name$|^description|^назван|^наимен|branch name/);
    colIdx.length     = ci(/length|длина|len\b/);
    colIdx.area       = ci(/area|сечен|площадь|cross.?sect/);
    colIdx.perimeter  = ci(/perim|периметр/);
    colIdx.resistance = ci(/resist|сопрот|r\b$/);
    colIdx.flow       = ci(/airflow|flow|расход|q\b/);
    colIdx.fanPressure= ci(/fan.*press|fan.*dep|напор|депресс|fan p\b|pressure.*fan/);
    colIdx.fanName    = ci(/fan.*name|вентилят.*назв|fan id/);
    // Координаты концов ветви (если есть)
    colIdx.xFrom      = ci(/x.*from|from.*x|x1\b|xstart/);
    colIdx.yFrom      = ci(/y.*from|from.*y|y1\b|ystart/);
    colIdx.zFrom      = ci(/z.*from|from.*z|z1\b|zstart|elev.*from|from.*elev/);
    colIdx.xTo        = ci(/x.*to\b|to.*x|x2\b|xend/);
    colIdx.yTo        = ci(/y.*to\b|to.*y|y2\b|yend/);
    colIdx.zTo        = ci(/z.*to\b|to.*z|z2\b|zend|elev.*to|to.*elev/);

    debug.push(`Заголовок на строке ${i}: from=${colIdx.from} to=${colIdx.to} len=${colIdx.length} area=${colIdx.area} R=${colIdx.resistance} Q=${colIdx.flow}`);
    break;
  }

  if (headerRow < 0) {
    // Нет явного заголовка — пробуем угадать по первой строке данных
    warnings.push("Заголовок колонок не найден. Пробуем формат: ID;From;To;Name;Length;Area;Perimeter;R;Q");
    colIdx.id = 0; colIdx.from = 1; colIdx.to = 2; colIdx.name = 3;
    colIdx.length = 4; colIdx.area = 5; colIdx.perimeter = 6;
    colIdx.resistance = 7; colIdx.flow = 8;
    headerRow = -1;
  }

  // Собираем данные
  interface RawBr {
    id: string; from: string; to: string; name: string;
    length: number; area: number; perimeter: number;
    resistance: number; flow: number;
    fanPressure: number; fanName: string;
    xFrom: number; yFrom: number; zFrom: number;
    xTo: number; yTo: number; zTo: number;
  }
  const rawBranches: RawBr[] = [];
  const nodeCoords = new Map<string, { x: number; y: number; z: number }>();

  for (let i = headerRow + 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 3) continue;

    const fromId = cleanStr(cols[colIdx.from]);
    const toId   = cleanStr(cols[colIdx.to]);
    if (!fromId || !toId || fromId === toId) continue;
    // Пропускаем строки где from/to — не идентификаторы (заголовочные дубли)
    if (/from|to|node|вершин/i.test(fromId)) continue;

    const brId = colIdx.id >= 0 ? cleanStr(cols[colIdx.id]) : String(rawBranches.length + 1);

    const xFrom = colIdx.xFrom >= 0 ? parseNum(cols[colIdx.xFrom]) : 0;
    const yFrom = colIdx.yFrom >= 0 ? parseNum(cols[colIdx.yFrom]) : 0;
    const zFrom = colIdx.zFrom >= 0 ? parseNum(cols[colIdx.zFrom]) : 0;
    const xTo   = colIdx.xTo   >= 0 ? parseNum(cols[colIdx.xTo])   : 0;
    const yTo   = colIdx.yTo   >= 0 ? parseNum(cols[colIdx.yTo])   : 0;
    const zTo   = colIdx.zTo   >= 0 ? parseNum(cols[colIdx.zTo])   : 0;

    // Сохраняем координаты узлов (первое встреченное значение)
    if (!nodeCoords.has(fromId)) nodeCoords.set(fromId, { x: xFrom, y: yFrom, z: zFrom });
    if (!nodeCoords.has(toId))   nodeCoords.set(toId,   { x: xTo,   y: yTo,   z: zTo   });

    rawBranches.push({
      id: brId, from: fromId, to: toId,
      name: colIdx.name >= 0 ? cleanStr(cols[colIdx.name]) : "",
      length:     colIdx.length     >= 0 ? parseNum(cols[colIdx.length])     : 0,
      area:       colIdx.area       >= 0 ? parseNum(cols[colIdx.area])       : 0,
      perimeter:  colIdx.perimeter  >= 0 ? parseNum(cols[colIdx.perimeter])  : 0,
      resistance: colIdx.resistance >= 0 ? parseNum(cols[colIdx.resistance]) : 0,
      flow:       colIdx.flow       >= 0 ? parseNum(cols[colIdx.flow])       : 0,
      fanPressure:colIdx.fanPressure >= 0 ? parseNum(cols[colIdx.fanPressure]): 0,
      fanName:    colIdx.fanName    >= 0 ? cleanStr(cols[colIdx.fanName])    : "",
      xFrom, yFrom, zFrom, xTo, yTo, zTo,
    });
  }

  debug.push(`Строк данных: ${rawBranches.length}`);

  if (rawBranches.length === 0) {
    return {
      nodes: [], branches: [],
      warnings: [...warnings, "Не найдено ни одной ветви. Проверьте формат файла Ventsim."],
      stats: { nodes: 0, branches: 0, fans: 0 },
      debug: debug.join("\n"),
    };
  }

  // ── Строим узлы ────────────────────────────────────────────────────────────
  const allNodeIds = [...new Set(rawBranches.flatMap(b => [b.from, b.to]))];

  // Определяем: есть ли реальные координаты
  const hasRealCoords = [...nodeCoords.values()].some(c => c.x !== 0 || c.y !== 0);
  const coordLayout: Map<string, { x: number; y: number }> = hasRealCoords
    ? new Map(allNodeIds.map(id => {
        const c = nodeCoords.get(id) ?? { x: 0, y: 0, z: 0 };
        return [id, { x: c.x, y: c.y }];
      }))
    : autoLayout(allNodeIds);

  if (!hasRealCoords) {
    warnings.push("Координаты X/Y узлов не найдены — узлы расставлены автоматически. Уточните схему вручную.");
  }

  debug.push(`Уникальных узлов: ${allNodeIds.length}, hasRealCoords: ${hasRealCoords}`);

  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  for (const nid of allNodeIds) {
    const coord = coordLayout.get(nid) ?? { x: 0, y: 0 };
    const z = nodeCoords.get(nid)?.z ?? 0;
    const node = makeNode(`NV${ts}_${nid}`, {
      x: Math.round(coord.x * 10) / 10,
      y: Math.round(coord.y * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: nid,
      name: nid,
    });
    nodeMap.set(nid, node);
  }

  // ── Строим ветви ───────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  let fanCount = 0;
  let bi = 0;

  for (const rb of rawBranches) {
    const fromNode = nodeMap.get(rb.from);
    const toNode   = nodeMap.get(rb.to);
    if (!fromNode || !toNode) continue;

    const area = rb.area;
    const perim = rb.perimeter;
    const dh = area > 0 && perim > 0 ? Math.round(4 * area / perim * 1000) / 1000 : 0;

    // Длина из данных или из координат
    let length = rb.length;
    if (length <= 0 && hasRealCoords) {
      const dx = rb.xTo - rb.xFrom, dy = rb.yTo - rb.yFrom, dz = rb.zTo - rb.zFrom;
      length = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz) * 10) / 10;
    }

    // Угол наклона
    let angle = 0;
    if (length > 0 && hasRealCoords) {
      const dz = Math.abs(rb.zTo - rb.zFrom);
      angle = Math.round(Math.asin(Math.min(1, dz / length)) * 180 / Math.PI * 10) / 10;
    }

    // Сопротивление Ventsim экспортирует в Н·с²/м⁸ (SI)
    // Переводим в кМюрг (делим на 9.81×1000 = 9810)
    // Если значение очень маленькое (< 0.001) — уже в кМюрг или другие единицы
    const rSi = rb.resistance;
    const importedR = rSi > 0 ? rSi : 0;

    const hasFan = rb.fanPressure > 0 || rb.fanName.length > 0;
    if (hasFan) fanCount++;

    branches.push(makeBranch(`BV${ts}_${bi++}`, fromNode.id, toNode.id, {
      name: rb.name || rb.id,
      type: "Выработка",
      length: length > 0 ? length : 0,
      manualLength: rb.length > 0,
      angle,
      area: area > 0 ? area : 0,
      perimeter: perim > 0 ? perim : 0,
      dh: dh > 0 ? dh : 0,
      manualSection: area > 0,
      flow: rb.flow,
      resistanceMode: importedR > 0 ? "manual" : "alpha",
      manualR: importedR,
      resistance: importedR,
      alphaCoef: 12,
      hasFan,
      fanMode: "constant" as const,
      fanPressure: rb.fanPressure,
      fanName: rb.fanName,
    }));
  }

  debug.push(`Ветвей создано: ${branches.length}, с вентилятором: ${fanCount}`);

  return {
    nodes: [...nodeMap.values()],
    branches,
    warnings,
    stats: { nodes: nodeMap.size, branches: branches.length, fans: fanCount },
    debug: debug.join("\n"),
  };
}

/** Определяет, похож ли CSV-файл на экспорт Ventsim */
export function isVentsimCsv(filename: string, firstLines: string): boolean {
  const fn = filename.toLowerCase();
  if (/ventsim|ventsym|vent_sim/.test(fn)) return true;

  const content = firstLines.toLowerCase();
  // Ventsim обычно содержит эти колонки в заголовке
  const hasFrom = /\bfrom\b|\bfrom node/.test(content);
  const hasTo   = /\bto\b|\bto node/.test(content);
  const hasLen  = /length|длин/.test(content);
  const hasR    = /resist|сопрот/.test(content);
  return hasFrom && hasTo && (hasLen || hasR);
}
