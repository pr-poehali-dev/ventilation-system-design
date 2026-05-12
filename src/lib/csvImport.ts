// ─────────────────────────────────────────────────────────────────────────────
// Импорт CSV из АэроСети (схема Aeroset, разделитель ;)
//
// АэроСеть экспортирует 5 файлов:
//   *-nodes.csv        — узлы: ID; X; Y; Z; Атмосфера
//   *-excavations.csv  — выработки: ID; НачВерш; КонВерш; Название; Длина; Тип; S; P; Q; R; Слой; ИдПоз
//   *-positions.csv    — позиции (X,Y,Z для отображения)
//   *-bulkheads.csv    — перемычки
//   *-fans.csv         — вентиляторы
//
// Также поддерживается один файл со всеми секциями.
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface CsvImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { nodes: number; branches: number; nodesWithZ: number };
  debug: string;
}

// ── Утилиты ──────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number {
  if (s === undefined || s === null) return 0;
  const n = parseFloat(s.replace(",", ".").trim());
  return isNaN(n) ? 0 : n;
}

function detectSep(line: string): ";" | "\t" | "," {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

function splitRow(line: string, sep: string): string[] {
  return line.split(sep).map(s => s.trim());
}

function normalizeLines(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

// ── Определение типа файла по имени ──────────────────────────────────────────

export type CsvFileType = "nodes" | "excavations" | "positions" | "bulkheads" | "fans" | "unknown";

export function detectFileType(filename: string, firstLines: string): CsvFileType {
  const fn = filename.toLowerCase();
  if (/node|вершин|узл/.test(fn)) return "nodes";
  if (/excavat|выработ|tunnel/.test(fn)) return "excavations";
  if (/position|позиц/.test(fn)) return "positions";
  if (/bulkhead|перемычк|jumper/.test(fn)) return "bulkheads";
  if (/fan|вентилят|source|тяг/.test(fn)) return "fans";

  // Автоопределение по содержимому (заголовок первой строки)
  const header = firstLines.split("\n").find(l => l.includes(";") || l.includes(",")) ?? "";
  const h = header.toLowerCase();
  if (/атмосфера|atmosphere/.test(h)) return "nodes";
  if (/выработ|excavat|ствол|начальн/.test(h)) return "excavations";
  if (/тип позиции|position type/.test(h)) return "positions";
  if (/перемычк|bulkhead/.test(h)) return "bulkheads";
  if (/напор|fan|вентилят/.test(h)) return "fans";

  return "unknown";
}

// ── Парсинг отдельных файлов ──────────────────────────────────────────────────

interface RawNode { id: string; x: number; y: number; z: number; isAtm: boolean }
interface RawBranch {
  id: string; fromId: string; toId: string; name: string;
  length: number; typeName: string; area: number; perimeter: number;
  flow: number; resistance: number; layer: string;
}

function parseNodesFile(lines: string[], sep: string): RawNode[] {
  const result: RawNode[] = [];
  for (const line of lines) {
    const cols = splitRow(line, sep);
    if (cols.length < 3) continue;
    const id = cols[0].trim();
    if (!/^\d/.test(id)) continue;  // пропускаем заголовки
    result.push({
      id,
      x: parseNum(cols[1]),
      y: parseNum(cols[2]),
      z: parseNum(cols[3]),
      isAtm: /да|yes|true|1/i.test(cols[4] ?? ""),
    });
  }
  return result;
}

function parseExcavationsFile(lines: string[], sep: string): RawBranch[] {
  const result: RawBranch[] = [];
  // Ищем строку заголовков для определения порядка колонок
  // Стандартный порядок АэроСети: ID; НачВерш; КонВерш; Название; Длина; Тип; Сечение; Периметр; Расход; Сопр; Слой; ИдПозиции
  let headerFound = false;
  const colIdx = { id:0, from:1, to:2, name:3, len:4, type:5, area:6, perim:7, flow:8, res:9, layer:10 };

  for (const line of lines) {
    const cols = splitRow(line, sep);
    if (cols.length < 3) continue;

    // Проверяем на заголовок
    const h = cols[0].toLowerCase();
    if (!headerFound && (!/^\d/.test(cols[0].trim()) && cols[0].trim() !== "")) {
      // Это заголовок — определяем порядок колонок
      const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
      const idC   = ci(/^ид|^id$/);
      const fromC = ci(/нач|from|start/);
      const toC   = ci(/кон|to$|end/);
      const nameC = ci(/назван|name/);
      const lenC  = ci(/длин|length/);
      const typeC = ci(/^тип|^type/);
      const areaC = ci(/сечени|area|s\s*м/);
      const perimC= ci(/периметр|perim/);
      const flowC = ci(/расход|flow|q\s*[,;]/);
      const resC  = ci(/сопрот|resist/);
      const layerC= ci(/слой|layer/);
      if (idC >= 0) colIdx.id = idC;
      if (fromC >= 0) colIdx.from = fromC;
      if (toC >= 0) colIdx.to = toC;
      if (nameC >= 0) colIdx.name = nameC;
      if (lenC >= 0) colIdx.len = lenC;
      if (typeC >= 0) colIdx.type = typeC;
      if (areaC >= 0) colIdx.area = areaC;
      if (perimC >= 0) colIdx.perim = perimC;
      if (flowC >= 0) colIdx.flow = flowC;
      if (resC >= 0) colIdx.res = resC;
      if (layerC >= 0) colIdx.layer = layerC;
      headerFound = true;
      continue;
    }

    const id = cols[colIdx.id]?.trim();
    if (!id || !/^\d/.test(id)) continue;

    result.push({
      id,
      fromId:     cols[colIdx.from]?.trim() ?? "",
      toId:       cols[colIdx.to]?.trim() ?? "",
      name:       cols[colIdx.name]?.trim() ?? "",
      length:     parseNum(cols[colIdx.len]),
      typeName:   cols[colIdx.type]?.trim() ?? "",
      area:       parseNum(cols[colIdx.area]),
      perimeter:  parseNum(cols[colIdx.perim]),
      flow:       parseNum(cols[colIdx.flow]),
      resistance: parseNum(cols[colIdx.res]),
      layer:      cols[colIdx.layer]?.trim() || "Выработки",
    });
  }
  return result;
}

// ── Сборка результата ─────────────────────────────────────────────────────────

function buildResult(
  rawNodes: RawNode[],
  rawBranches: RawBranch[],
  warnings: string[],
  debug: string[]
): CsvImportResult {
  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  let nodesWithZ = 0;

  for (const rn of rawNodes) {
    if (rn.z !== 0) nodesWithZ++;
    nodeMap.set(rn.id, makeNode(`N${ts}_${rn.id}`, {
      x: Math.round(rn.x * 10) / 10,
      y: Math.round(rn.y * 10) / 10,
      z: Math.round(rn.z * 10) / 10,
      number: rn.id.padStart(3, "0"),
      name: rn.id,
      atmosphereLink: rn.isAtm,
    }));
  }

  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (const rb of rawBranches) {
    if (!rb.fromId || !rb.toId) continue;
    const fromNode = nodeMap.get(rb.fromId);
    const toNode   = nodeMap.get(rb.toId);
    if (!fromNode || !toNode) continue;

    const key = `${[rb.fromId, rb.toId].sort().join("_")}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let shape: "round" | "rect" | "arch" = "rect";
    if (/круг|round|цилиндр/i.test(rb.typeName)) shape = "round";
    else if (/арк|arch/i.test(rb.typeName)) shape = "arch";

    const dh = rb.perimeter > 0 ? Math.round(4 * rb.area / rb.perimeter * 1000) / 1000 : 0;
    const dz = Math.abs(toNode.z - fromNode.z);
    const dist3d = Math.sqrt((toNode.x-fromNode.x)**2+(toNode.y-fromNode.y)**2+(toNode.z-fromNode.z)**2);
    const realLen = rb.length > 0 ? rb.length : Math.round(dist3d * 10) / 10;
    const realAngle = realLen > 0 ? Math.round(Math.asin(Math.min(1, dz/realLen)) * 180/Math.PI * 10)/10 : 0;

    branches.push(makeBranch(`B${ts}_${bi++}`, fromNode.id, toNode.id, {
      layer: rb.layer,
      length: realLen, manualLength: rb.length > 0,
      angle: realAngle, manualAngle: false,
      area: rb.area > 0 ? rb.area : 0,
      perimeter: rb.perimeter > 0 ? rb.perimeter : 0,
      dh: dh > 0 ? dh : 0,
      flow: rb.flow, resistance: rb.resistance,
      manualSection: rb.area > 0, shape,
    }));
  }

  debug.push(`Итого: узлов=${nodeMap.size}, ветвей=${branches.length}, с Z≠0=${nodesWithZ}`);

  if (rawNodes.length > 0 && nodeMap.size === 0) warnings.push("⚠ Узлы не распознаны.");
  if (rawBranches.length > 0 && branches.length === 0)
    warnings.push("⚠ Ветви не созданы — возможно ID узлов не совпадают.");

  return {
    nodes: [...nodeMap.values()], branches, warnings,
    stats: { nodes: nodeMap.size, branches: branches.length, nodesWithZ },
    debug: debug.join("\n"),
  };
}

// ── Главная функция: один или несколько файлов ────────────────────────────────

export interface CsvFileInput { name: string; content: string }

export function parseCsvMulti(files: CsvFileInput[]): CsvImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];
  const allRawNodes: RawNode[] = [];
  const allRawBranches: RawBranch[] = [];

  for (const file of files) {
    const lines = normalizeLines(file.content);
    if (lines.length === 0) continue;
    const sep = detectSep(lines.find(l => l.includes(";") || l.includes(",")) ?? "");
    const fileType = detectFileType(file.name, lines.slice(0, 5).join("\n"));
    debug.push(`Файл: ${file.name} → тип: ${fileType}, строк: ${lines.length}, sep: "${sep}"`);

    if (fileType === "nodes") {
      const nodes = parseNodesFile(lines, sep);
      debug.push(`  Узлов: ${nodes.length}`);
      allRawNodes.push(...nodes);
    } else if (fileType === "excavations") {
      const branches = parseExcavationsFile(lines, sep);
      debug.push(`  Выработок: ${branches.length}`);
      allRawBranches.push(...branches);
    } else if (fileType === "unknown") {
      // Пробуем оба парсера
      const nodes = parseNodesFile(lines, sep);
      const branches = parseExcavationsFile(lines, sep);
      if (nodes.length > branches.length) {
        debug.push(`  Авто→узлы: ${nodes.length}`);
        allRawNodes.push(...nodes);
      } else if (branches.length > 0) {
        debug.push(`  Авто→ветви: ${branches.length}`);
        allRawBranches.push(...branches);
      } else {
        warnings.push(`Файл "${file.name}" не распознан.`);
      }
    }
    // bulkheads, fans, positions — пока пропускаем
  }

  if (allRawNodes.length === 0 && allRawBranches.length === 0) {
    return {
      nodes: [], branches: [],
      warnings: ["Файлы не содержат данных. Убедитесь что выбраны *-nodes.csv и *-excavations.csv из АэроСети."],
      stats: { nodes: 0, branches: 0, nodesWithZ: 0 },
      debug: debug.join("\n"),
    };
  }

  return buildResult(allRawNodes, allRawBranches, warnings, debug);
}

// ── Обратная совместимость: один файл ────────────────────────────────────────

export function parseCsv(content: string, filename = "file.csv"): CsvImportResult {
  return parseCsvMulti([{ name: filename, content }]);
}
