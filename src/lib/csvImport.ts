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

export interface RawFan {
  branchId: string;    // ID выработки из АэроСети
  name: string;        // название вентилятора
  pressure: number;    // давление (напор), Па
  flow: number;        // расход, м³/с
}

export interface RawBulkhead {
  branchId: string;        // ID выработки из АэроСети
  typeName: string;        // название типа перемычки
  rKmu: number;            // сопротивление, кМюрг
  airPerm: number;         // воздухопроницаемость, м²/(с·√Па)
}

export interface RawPosition {
  id: string;              // исходный ID из АэроСети
  number: number;          // номер позиции
  name: string;            // название
  positionType: string;    // тип: безреверсивная / реверсивная
  accidentType: string;    // вид аварии
  x: number;               // мировые координаты X
  y: number;               // Y
  z: number;               // Z
  branchIds: string[];     // ID привязанных выработок (из АэроСети)
}

export interface CsvImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  fans: RawFan[];
  bulkheads: RawBulkhead[];
  positions: RawPosition[];
  /** Маппинг: оригинальный ID выработки из АэроСети → сгенерированный ID ветви */
  branchOriginalIdMap: Record<string, string>;
  warnings: string[];
  stats: { nodes: number; branches: number; nodesWithZ: number; fans: number; bulkheads: number; positions: number };
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
  // Сначала по содержимому (надёжнее имени файла в АэроСети)
  const allHeaders = firstLines.split("\n")
    .filter(l => l.includes(";") || l.includes(","))
    .slice(0, 3).join(" ").toLowerCase();

  // nodes: содержит "вершина" + "атмосфера" или "высотная отметка"
  if (/атмосфера|atmosphere/i.test(allHeaders) || /высотн.*отметк/i.test(allHeaders)) return "nodes";
  if (/идентификатор вершин/i.test(allHeaders) && !/начальн|выработ/i.test(allHeaders)) return "nodes";
  if (/начальн|конечн|выработ|excavat|начал.*верш|ид.*выраб/i.test(allHeaders)) return "excavations";
  if (/тип позиции|position type/i.test(allHeaders)) return "positions";
  if (/перемычк|bulkhead|тип перемычк/i.test(allHeaders)) return "bulkheads";
  if (/напор|fan.*id|вентилят|источник тяг/i.test(allHeaders)) return "fans";

  // Fallback по имени файла
  const fn = filename.toLowerCase();
  if (/node|вершин|узл/.test(fn)) return "nodes";
  if (/excavat|выработ|tunnel/.test(fn)) return "excavations";
  if (/position|позиц/.test(fn)) return "positions";
  if (/bulkhead|перемычк|jumper/.test(fn)) return "bulkheads";
  if (/fan|вентилят|source|тяг/.test(fn)) return "fans";

  return "unknown";
}

// ── Парсинг отдельных файлов ──────────────────────────────────────────────────

interface RawNode { id: string; x: number; y: number; z: number; isAtm: boolean }
interface RawBranch {
  id: string; fromId: string; toId: string; name: string;
  length: number; typeName: string; area: number; perimeter: number;
  flow: number; resistance: number; layer: string;
}

// UUID или число — валидный ID строки данных
function isDataId(s: string): boolean {
  const t = s.trim().replace(/"/g, "");
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(t) || /^\d+$/.test(t);
}

function cleanId(s: string): string {
  return s.trim().replace(/"/g, "");
}

function parseNodesFile(lines: string[], sep: string): RawNode[] {
  const result: RawNode[] = [];
  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, ""));
    if (cols.length < 3) continue;
    const id = cols[0].trim();
    if (!isDataId(id)) continue;  // пропускаем заголовки
    result.push({
      id: cleanId(id),
      x: parseNum(cols[1]),
      y: parseNum(cols[2]),
      z: parseNum(cols[3]),
      isAtm: /да|yes|true|1/i.test(cols[4] ?? ""),
    });
  }
  return result;
}

// Парсит число включая научную нотацию с запятой: "5,77E-05" → 0.0000577
function parseNumSci(s: string | undefined): number {
  if (!s) return 0;
  // Заменяем запятую на точку в мантиссе, но не в экспоненте
  const normalized = s.trim().replace(/"/g, "").replace(/,(?=\d|E|e)/g, ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

function parseExcavationsFile(lines: string[], sep: string): RawBranch[] {
  const result: RawBranch[] = [];
  let headerFound = false;
  const colIdx = { id:0, from:1, to:2, name:3, len:4, type:5, area:6, perim:7, flow:8, res:9, layer:10 };

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 3) continue;

    const firstCell = cols[0];
    if (!isDataId(firstCell)) {
      // Это заголовок — определяем индексы колонок
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const idC    = ci(/идентификатор выработ|^ид выраб|^id/);
        const fromC  = ci(/начального|начальн|нач.*узл|from|start/);
        const toC    = ci(/конечного|конечн|кон.*узл|to\b|end/);
        const nameC  = ci(/название|назван|name/);
        const lenC   = ci(/длина|длин|length/);
        const typeC  = ci(/тип выраб|^тип|type/);
        const areaC  = ci(/площадь|сечени|area/);
        const perimC = ci(/периметр|perim/);
        const flowC  = ci(/расход|flow/);
        const resC   = ci(/сопротивл|resist/);
        const layerC = ci(/слой|layer/);
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
      }
      continue;
    }

    result.push({
      id:         cleanId(firstCell),
      fromId:     cleanId(cols[colIdx.from] ?? ""),
      toId:       cleanId(cols[colIdx.to] ?? ""),
      name:       cols[colIdx.name] ?? "",
      length:     parseNumSci(cols[colIdx.len]),
      typeName:   cols[colIdx.type] ?? "",
      area:       parseNumSci(cols[colIdx.area]),
      perimeter:  parseNumSci(cols[colIdx.perim]),
      flow:       parseNumSci(cols[colIdx.flow]),
      resistance: parseNumSci(cols[colIdx.res]),
      layer:      cols[colIdx.layer] || "Выработки",
    });
  }
  return result;
}

// ── Парсинг файла вентиляторов ────────────────────────────────────────────────

function parseFansFile(lines: string[], sep: string): RawFan[] {
  const result: RawFan[] = [];
  const colIdx = { branchId: 0, name: 1, pressure: 2, flow: 3 };
  let headerFound = false;

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    if (!isDataId(cols[0])) {
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const brC  = ci(/выработ|branch|ид.*выраб|id.*excav/);
        const nmC  = ci(/назван|имя|name|вентилят/);
        const prC  = ci(/напор|давлен|pressure|депрессия/);
        const flC  = ci(/расход|flow|подача/);
        if (brC >= 0) colIdx.branchId = brC;
        if (nmC >= 0) colIdx.name = nmC;
        if (prC >= 0) colIdx.pressure = prC;
        if (flC >= 0) colIdx.flow = flC;
        headerFound = true;
      }
      continue;
    }

    const branchId = cleanId(cols[colIdx.branchId] ?? "");
    if (!branchId) continue;
    result.push({
      branchId,
      name: cols[colIdx.name] ?? "",
      pressure: parseNumSci(cols[colIdx.pressure]),
      flow: parseNumSci(cols[colIdx.flow]),
    });
  }
  return result;
}

function parseBulkheadsFile(lines: string[], sep: string): RawBulkhead[] {
  const result: RawBulkhead[] = [];
  let headerFound = false;
  const colIdx = { branchId: 0, typeName: 1, rKmu: 2, airPerm: 3 };

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    if (!isDataId(cols[0])) {
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const brC  = ci(/выработ|branch|ид.*выраб|id.*excav/);
        const tyC  = ci(/тип.*перем|назван|name|тип/);
        const rC   = ci(/сопротивл|resist|кмюрг|кмю/);
        const apC  = ci(/воздухо|air.*perm|утечк/);
        if (brC >= 0) colIdx.branchId = brC;
        if (tyC >= 0) colIdx.typeName = tyC;
        if (rC  >= 0) colIdx.rKmu = rC;
        if (apC >= 0) colIdx.airPerm = apC;
        headerFound = true;
      }
      continue;
    }

    const branchId = cleanId(cols[colIdx.branchId] ?? "");
    if (!branchId) continue;
    result.push({
      branchId,
      typeName: cols[colIdx.typeName] ?? "",
      rKmu: parseNumSci(cols[colIdx.rKmu]),
      airPerm: parseNumSci(cols[colIdx.airPerm]),
    });
  }
  return result;
}

function parsePositionsFile(lines: string[], sep: string): RawPosition[] {
  const result: RawPosition[] = [];
  let headerFound = false;
  const colIdx = { id: 0, number: 1, name: 2, posType: 3, accType: 4, x: 5, y: 6, z: 7, branches: 8 };

  for (const line of lines) {
    const cols = splitRow(line, sep).map(c => c.replace(/"/g, "").trim());
    if (cols.length < 2) continue;

    if (!isDataId(cols[0])) {
      if (!headerFound) {
        const ci = (pat: RegExp) => cols.findIndex(c => pat.test(c.toLowerCase()));
        const idC  = ci(/^ид|^id/);
        const nmC  = ci(/номер|number|num|№/);
        const naC  = ci(/назван|name/);
        const ptC  = ci(/тип позиц|position type|тип/);
        const atC  = ci(/авари|accident/);
        const xC   = ci(/^x$|коорд.*x|x.*коорд/);
        const yC   = ci(/^y$|коорд.*y|y.*коорд/);
        const zC   = ci(/^z$|высот|отметк|z.*коорд/);
        const brC  = ci(/выработ|branch|список/);
        if (idC  >= 0) colIdx.id = idC;
        if (nmC  >= 0) colIdx.number = nmC;
        if (naC  >= 0) colIdx.name = naC;
        if (ptC  >= 0) colIdx.posType = ptC;
        if (atC  >= 0) colIdx.accType = atC;
        if (xC   >= 0) colIdx.x = xC;
        if (yC   >= 0) colIdx.y = yC;
        if (zC   >= 0) colIdx.z = zC;
        if (brC  >= 0) colIdx.branches = brC;
        headerFound = true;
      }
      continue;
    }

    const id = cleanId(cols[colIdx.id] ?? "");
    if (!id) continue;
    // Список выработок может быть через запятую или пробел в одной ячейке
    const branchRaw = cols[colIdx.branches] ?? "";
    const branchIds = branchRaw
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    result.push({
      id,
      number: Math.round(parseNum(cols[colIdx.number])) || 0,
      name: cols[colIdx.name] ?? "",
      positionType: cols[colIdx.posType] ?? "",
      accidentType: cols[colIdx.accType] ?? "",
      x: parseNum(cols[colIdx.x]),
      y: parseNum(cols[colIdx.y]),
      z: parseNum(cols[colIdx.z]),
      branchIds,
    });
  }
  return result;
}

// ── Сборка результата ─────────────────────────────────────────────────────────

function buildResult(
  rawNodes: RawNode[],
  rawBranches: RawBranch[],
  rawFans: RawFan[],
  rawBulkheads: RawBulkhead[],
  rawPositions: RawPosition[],
  warnings: string[],
  debug: string[],
  resistanceUnit: "kmu" | "si" = "kmu"
): CsvImportResult {
  const branchOriginalIdMap: Record<string, string> = {};
  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  let nodesWithZ = 0;

  for (const rn of rawNodes) {
    if (rn.z !== 0) nodesWithZ++;
    // Сохраняем исходный числовой номер узла из АэроСети без изменений
    // Если ID — число, используем его напрямую; если UUID — берём последние цифры
    const origNum = rn.id.includes("-")
      ? rn.id.replace(/[^0-9]/g, "").slice(-4) || rn.id.slice(-4)
      : rn.id.replace(/^0+/, "") || "0"; // убираем ведущие нули
    nodeMap.set(rn.id, makeNode(`N${ts}_${rn.id}`, {
      x: Math.round(rn.x * 10) / 10,
      y: Math.round(rn.y * 10) / 10,
      z: Math.round(rn.z * 10) / 10,
      number: origNum,
      name: "",
      atmosphereLink: rn.isAtm,
    }));
  }

  // Определяем «нулевые» узлы — те у кого x=0 и y=0, но есть хотя бы один узел с ненулевыми координатами
  // Такие узлы — скорее всего не загружены из positions-файла и дают длинные линии к нулю
  const hasRealCoords = [...nodeMap.values()].some(n => n.x !== 0 || n.y !== 0);
  const isZeroNode = (n: TopoNode) => hasRealCoords && n.x === 0 && n.y === 0;

  // Вычисляем медианную длину ветви (для фильтрации «призрачных» ветвей)
  // Ветви у которых длина в 20+ раз больше медианы — скорее всего идут в нулевую точку
  const allRawLengths: number[] = rawBranches
    .map(rb => {
      const fn = nodeMap.get(rb.fromId);
      const tn = nodeMap.get(rb.toId);
      if (!fn || !tn) return 0;
      return Math.sqrt((tn.x-fn.x)**2 + (tn.y-fn.y)**2);
    })
    .filter(l => l > 0)
    .sort((a, b) => a - b);
  const medianLen = allRawLengths.length > 0
    ? allRawLengths[Math.floor(allRawLengths.length / 2)]
    : Infinity;
  const maxAllowedScreenLen = Math.max(medianLen * 30, 5000); // порог: 30× медиана

  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (const rb of rawBranches) {
    if (!rb.fromId || !rb.toId) continue;
    const fromNode = nodeMap.get(rb.fromId);
    const toNode   = nodeMap.get(rb.toId);
    if (!fromNode || !toNode) continue;
    // Пропускаем ветви у которых один из узлов не имеет реальных координат
    if (isZeroNode(fromNode) || isZeroNode(toNode)) continue;
    // Пропускаем «призрачные» ветви — экстремально длинные относительно медианы
    const screenDist = Math.sqrt((toNode.x-fromNode.x)**2 + (toNode.y-fromNode.y)**2);
    if (screenDist > maxAllowedScreenLen) continue;

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

    const newBranchId = `B${ts}_${bi++}`;
    branchOriginalIdMap[rb.id] = newBranchId;
    // Перевод R из единиц CSV в кМюрг (для manualR):
    // "kmu" (кмю, АэроСеть): уже в кМюрг → берём как есть
    // "si": в Н·с²/м⁸ → делим на 9.81 чтобы перевести в кМюрг
    const importedR = rb.resistance > 0
      ? rb.resistance * (resistanceUnit === "kmu" ? 1 : 1 / 9.81)
      : 0;

    // Определяем тип выработки из CSV
    const branchType = rb.name || rb.typeName || "Выработка";
    // Если R не задан — используем alpha с типовым коэффициентом по форме сечения (вместо нуля)
    // Прямоугольник/свод ≈ 9–20 ×10⁻⁴ Нс²/м⁴, круглый ≈ 6–15
    const defaultAlpha = shape === "round" ? 9 : shape === "arch" ? 15 : 12;

    branches.push(makeBranch(newBranchId, fromNode.id, toNode.id, {
      type: branchType,
      name: rb.name || rb.id,
      layer: rb.layer,
      length: realLen, manualLength: rb.length > 0,
      angle: realAngle, manualAngle: false,
      area: rb.area > 0 ? rb.area : 0,
      perimeter: rb.perimeter > 0 ? rb.perimeter : 0,
      dh: dh > 0 ? dh : 0,
      flow: rb.flow,
      // Режим сопротивления:
      //   R задан → manual (берём из CSV)
      //   R = 0, S задана → alpha с дефолтным коэффициентом (пересчитается из геометрии)
      //   R = 0, S не задана → alpha (R будет 0 пока не задана геометрия)
      resistanceMode: importedR > 0 ? "manual" : "alpha",
      manualR: importedR,
      resistance: importedR,
      alphaCoef: importedR > 0 ? 9 : defaultAlpha,
      manualSection: rb.area > 0, shape,
    }));
  }

  // Убираем из результата узлы без реальных координат (они дают точки в нуле)
  const resultNodes = [...nodeMap.values()].filter(n => !isZeroNode(n));

  debug.push(`Итого: узлов=${resultNodes.length} (отфильтровано нулевых: ${nodeMap.size - resultNodes.length}), ветвей=${branches.length}, с Z≠0=${nodesWithZ}`);

  if (rawNodes.length > 0 && resultNodes.length === 0) warnings.push("⚠ Узлы не распознаны.");
  if (rawBranches.length > 0 && branches.length === 0)
    warnings.push("⚠ Ветви не созданы — возможно ID узлов не совпадают.");

  // Транслируем исходные ID выработок в перемычках в сгенерированные ID ветвей
  const bulkheads: RawBulkhead[] = rawBulkheads.map(bk => ({
    ...bk,
    branchId: branchOriginalIdMap[bk.branchId] ?? bk.branchId,
  }));
  // Транслируем ID выработок в позициях
  const positions: RawPosition[] = rawPositions.map(p => ({
    ...p,
    branchIds: p.branchIds.map(bid => branchOriginalIdMap[bid] ?? bid),
  }));

  if (bulkheads.length > 0) debug.push(`Перемычек после маппинга: ${bulkheads.length}`);
  if (positions.length > 0) debug.push(`Позиций после маппинга: ${positions.length}`);

  return {
    nodes: resultNodes, branches, fans: rawFans, bulkheads, positions, branchOriginalIdMap, warnings,
    stats: { nodes: resultNodes.length, branches: branches.length, nodesWithZ, fans: rawFans.length, bulkheads: bulkheads.length, positions: positions.length },
    debug: debug.join("\n"),
  };
}

// ── Главная функция: один или несколько файлов ────────────────────────────────

export interface CsvFileInput { name: string; content: string }

export interface CsvImportOptions {
  /**
   * Единицы R в CSV:
   * "kmu"  = кмю (×10⁻³ Нс²/м⁸, формат АэроСети)
   * "si"   = Нс²/м⁸ (SI)
   * "auto" = автодетект по медианному значению (по умолчанию)
   */
  resistanceUnit?: "kmu" | "si" | "auto";
}

/**
 * Автоопределение единиц R по ненулевым значениям:
 * — Медиана < 0.5  → скорее всего кмю (типичные выработки: 0.001–0.5 кмю)
 * — Медиана ≥ 0.5  → уже Нс²/м⁸ (или аномально крупные кмю, но маловероятно)
 *
 * Логика: в АэроСети R типичной выработки 0.01–100 кмю.
 * В SI: 0.00001–0.1 Нс²/м⁸. Граница медианы 0.5 разделяет эти диапазоны надёжно.
 */
export function detectResistanceUnit(resistances: number[]): "kmu" | "si" {
  const nonZero = resistances.filter(r => r > 0);
  if (nonZero.length === 0) return "kmu"; // нет данных — предполагаем кмю
  const sorted = [...nonZero].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const unit = median < 0.05 ? "si" : "kmu";
  return unit;
}

export function parseCsvMulti(files: CsvFileInput[], opts: CsvImportOptions = {}): CsvImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];
  const allRawNodes: RawNode[] = [];
  const allRawBranches: RawBranch[] = [];
  const allRawFans: RawFan[] = [];
  const allRawBulkheads: RawBulkhead[] = [];
  const allRawPositions: RawPosition[] = [];

  for (const file of files) {
    const lines = normalizeLines(file.content);
    if (lines.length === 0) continue;
    const sep = detectSep(lines.find(l => l.includes(";") || l.includes(",")) ?? "");
    const header5 = lines.slice(0, 2).join(" | ").slice(0, 120);
    const fileType = detectFileType(file.name, lines.slice(0, 5).join("\n"));
    debug.push(`Файл: ${file.name} → тип: ${fileType}, строк: ${lines.length}, sep: "${sep}"`);
    debug.push(`  заголовок: ${header5}`);

    if (fileType === "nodes") {
      const nodes = parseNodesFile(lines, sep);
      debug.push(`  Узлов: ${nodes.length}`);
      allRawNodes.push(...nodes);
    } else if (fileType === "excavations") {
      const branches = parseExcavationsFile(lines, sep);
      debug.push(`  Выработок: ${branches.length}`);
      allRawBranches.push(...branches);
    } else if (fileType === "unknown") {
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
    } else if (fileType === "fans") {
      const fans = parseFansFile(lines, sep);
      debug.push(`  Вентиляторов: ${fans.length}`);
      allRawFans.push(...fans);
    } else if (fileType === "bulkheads") {
      const bulkheads = parseBulkheadsFile(lines, sep);
      debug.push(`  Перемычек: ${bulkheads.length}`);
      allRawBulkheads.push(...bulkheads);
    } else if (fileType === "positions") {
      const positions = parsePositionsFile(lines, sep);
      debug.push(`  Позиций: ${positions.length}`);
      allRawPositions.push(...positions);
    }
  }

  if (allRawNodes.length === 0 && allRawBranches.length === 0) {
    return {
      nodes: [], branches: [], fans: allRawFans,
      bulkheads: allRawBulkheads, positions: allRawPositions,
      branchOriginalIdMap: {},
      warnings: ["Файлы не содержат данных. Убедитесь что выбраны *-nodes.csv и *-excavations.csv из АэроСети."],
      stats: { nodes: 0, branches: 0, nodesWithZ: 0, fans: allRawFans.length, bulkheads: allRawBulkheads.length, positions: allRawPositions.length },
      debug: debug.join("\n"),
    };
  }

  // Определяем единицы R
  let rUnit: "kmu" | "si";
  const requestedUnit = opts.resistanceUnit ?? "auto";
  if (requestedUnit === "auto") {
    const allR = allRawBranches.map(b => b.resistance).filter(r => r > 0);
    rUnit = detectResistanceUnit(allR);
    debug.push(`Автодетект единиц R: медиана=${allR.length > 0 ? [...allR].sort((a,b)=>a-b)[Math.floor(allR.length/2)].toFixed(4) : "н/д"} → ${rUnit === "kmu" ? "кмю (÷1000)" : "СИ (без перевода)"}`);
  } else {
    rUnit = requestedUnit;
  }

  return buildResult(allRawNodes, allRawBranches, allRawFans, allRawBulkheads, allRawPositions, warnings, debug, rUnit);
}

// ── Обратная совместимость: один файл ────────────────────────────────────────

export function parseCsv(content: string, filename = "file.csv"): CsvImportResult {
  return parseCsvMulti([{ name: filename, content }]);
}