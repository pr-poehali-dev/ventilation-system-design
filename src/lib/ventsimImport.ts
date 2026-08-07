// ─────────────────────────────────────────────────────────────────────────────
// Импорт CSV из Ventsim Design 5/6
//
// Ventsim экспортирует данные в двух вариантах:
//
// Вариант A — с текстовым заголовком (Branch Report):
//   Branch,From,To,Name,Length,Area,Perimeter,Resistance,Airflow,...
//   1,2,3,Tunnel A,150.5,14.2,15.3,0.05,45.2,...
//
// Вариант B — числовой формат (прямой экспорт .csv):
//   Первая строка — настройки модели (одинаковые числа, много нулей)
//   Следующие строки — данные ветвей:
//   From,To,Xfrom,Yfrom,Zfrom,Xto,Yto,Zto,Length,FrictionFactor,Area,Perimeter,...
//   Признак строки данных: первые два числа разные (From≠To) и нет большого кол-ва нулей подряд
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
  // Поддержка как "0,05" (европейский) так и "0.05" (английский)
  // Но только если запятая разделяет дробную часть (одна запятая в числе)
  const t = s.replace(/\s/g, "").replace(/"/g, "").trim();
  const n = parseFloat(t.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function cleanStr(s: string | undefined): string {
  return (s ?? "").replace(/"/g, "").trim();
}

function detectSep(lines: string[]): "," | ";" | "\t" {
  // Берём несколько строк для анализа
  const sample = lines.slice(0, 5).join("\n");
  let commas = 0, semis = 0, tabs = 0;
  for (const ch of sample) {
    if (ch === ",") commas++;
    else if (ch === ";") semis++;
    else if (ch === "\t") tabs++;
  }
  if (semis > commas * 0.5 && semis > tabs) return ";";
  if (tabs > commas * 0.5) return "\t";
  return ",";
}

/** Авто-раскладка узлов в сетку (если нет координат) */
function autoLayout(nodeIds: string[]): Map<string, { x: number; y: number }> {
  const layout = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(nodeIds.length));
  nodeIds.forEach((id, i) => {
    layout.set(id, {
      x: Math.round((i % cols) * 150),
      y: Math.round(Math.floor(i / cols) * 150),
    });
  });
  return layout;
}

// ── Определение формата ───────────────────────────────────────────────────────

interface ColMap {
  id: number; from: number; to: number; name: number;
  length: number; area: number; perimeter: number; resistance: number;
  flow: number; fanPressure: number; fanName: number;
  xFrom: number; yFrom: number; zFrom: number;
  xTo: number; yTo: number; zTo: number;
  headerRow: number;
  format: "text-header" | "numeric";
}

/**
 * Ventsim числовой формат ветви:
 * [0]From  [1]To  [2]Xfrom  [3]Yfrom  [4]Zfrom  [5]Xto  [6]Yto  [7]Zto
 * [8]Length  [9]FrictionFactor(μ)  [10]Area  [11]Perimeter
 * [12]HydDiam  [13]Roughness  [14]Resistance(kmu)  [15]Airflow(m3/s)
 * [16]Velocity  [17]Pressure(Pa)  [18]FanPressure(Pa)  [19]FanName  ...
 */
const VENTSIM_NUMERIC: Omit<ColMap, "headerRow" | "format"> = {
  id: -1, from: 0, to: 1,
  xFrom: 2, yFrom: 3, zFrom: 4,
  xTo: 5, yTo: 6, zTo: 7,
  length: 8,
  area: 10, perimeter: 11,
  resistance: 14,
  flow: 15,
  fanPressure: 18, fanName: 19,
  name: -1,
};

function detectFormat(rows: string[][]): ColMap {
  // Ищем строку-заголовок (до 15 строк)
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i].map(c => c.toLowerCase().trim());
    const ci = (pat: RegExp) => row.findIndex(c => pat.test(c));

    const fromC = ci(/^from$|^from\s*node|^node\s*from|^from_node|^начал|^нач\s*верш/);
    const toC   = ci(/^to$|^to\s*node|^node\s*to|^to_node|^конеч|^кон\s*верш/);
    if (fromC >= 0 && toC >= 0) {
      return {
        headerRow: i,
        format: "text-header",
        id:         ci(/^branch$|^branch\s*id|^id$|^#$|^no\.$|^номер|^branch\s*no/),
        from: fromC, to: toC,
        name:       ci(/^name$|^branch\s*name|^description|^назван/),
        length:     ci(/^length|длина|^len\b/),
        area:       ci(/^area|^cross.?sect|сечен|площадь/),
        perimeter:  ci(/^perim|периметр/),
        resistance: ci(/^resist|сопрот|^r\b/),
        flow:       ci(/^airflow|^flow|расход|^q\b/),
        fanPressure:ci(/fan.*press|fan.*dep|^fan\s*p\b|^pressure\b.*fan|^fan\s*pressure/),
        fanName:    ci(/fan.*name|fan\s*id|^fan$/),
        xFrom:      ci(/x.*from|from.*x|^x1$|xstart/),
        yFrom:      ci(/y.*from|from.*y|^y1$|ystart/),
        zFrom:      ci(/z.*from|from.*z|^z1$|zstart|elev.*from|from.*elev/),
        xTo:        ci(/x.*to\b|to.*x|^x2$|xend/),
        yTo:        ci(/y.*to\b|to.*y|^y2$|yend/),
        zTo:        ci(/z.*to\b|to.*z|^z2$|zend|elev.*to|to.*elev/),
      };
    }
  }

  // Текстового заголовка нет — ищем первую строку с данными ветви (числовой формат)
  // Признак строки данных Ventsim: cols[0] ≠ cols[1] (From ≠ To) и оба — небольшие целые числа
  let dataStart = 0;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const cols = rows[i];
    if (cols.length < 10) continue;
    const from = parseFloat(cols[0]);
    const to   = parseFloat(cols[1]);
    if (!isNaN(from) && !isNaN(to) && from !== to && Number.isInteger(from) && Number.isInteger(to) && from > 0 && to > 0) {
      dataStart = i;
      break;
    }
  }

  return { ...VENTSIM_NUMERIC, headerRow: dataStart - 1, format: "numeric" };
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

  const sep = detectSep(rawLines);
  debug.push(`Строк: ${rawLines.length}, разделитель: "${sep}"`);

  const rows = rawLines.map(l => l.split(sep).map(c => cleanStr(c)));

  const colMap = detectFormat(rows);
  debug.push(`Формат: ${colMap.format}, данные с строки: ${colMap.headerRow + 1}`);
  debug.push(`Колонки: from=${colMap.from} to=${colMap.to} len=${colMap.length} area=${colMap.area} R=${colMap.resistance} Q=${colMap.flow}`);

  if (colMap.format === "text-header") {
    debug.push(`Текстовый заголовок: ${rows[colMap.headerRow].join(" | ").slice(0, 120)}`);
  }

  // ── Собираем ветви ────────────────────────────────────────────────────────
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

  for (let i = colMap.headerRow + 1; i < rows.length; i++) {
    const cols = rows[i];
    if (cols.length < 2) continue;

    const fromRaw = cols[colMap.from] ?? "";
    const toRaw   = cols[colMap.to]   ?? "";

    const fromId = cleanStr(fromRaw);
    const toId   = cleanStr(toRaw);

    if (!fromId || !toId) continue;

    // В числовом формате From и To — числа, пропускаем строки где они одинаковые
    // (конфигурационные строки)
    if (fromId === toId) continue;

    // Пропускаем строки-заголовки (содержат слова вместо чисел)
    if (/^[a-zA-Zа-яА-Я_\s]{3,}$/.test(fromId) && isNaN(Number(fromId))) continue;

    const xFrom = colMap.xFrom >= 0 ? parseNum(cols[colMap.xFrom]) : 0;
    const yFrom = colMap.yFrom >= 0 ? parseNum(cols[colMap.yFrom]) : 0;
    const zFrom = colMap.zFrom >= 0 ? parseNum(cols[colMap.zFrom]) : 0;
    const xTo   = colMap.xTo   >= 0 ? parseNum(cols[colMap.xTo])   : 0;
    const yTo   = colMap.yTo   >= 0 ? parseNum(cols[colMap.yTo])   : 0;
    const zTo   = colMap.zTo   >= 0 ? parseNum(cols[colMap.zTo])   : 0;

    if (!nodeCoords.has(fromId)) nodeCoords.set(fromId, { x: xFrom, y: yFrom, z: zFrom });
    if (!nodeCoords.has(toId))   nodeCoords.set(toId,   { x: xTo,   y: yTo,   z: zTo   });

    const brId = colMap.id >= 0 ? cleanStr(cols[colMap.id]) : String(rawBranches.length + 1);

    // Сопротивление: Ventsim числовой формат хранит в кМюрг (×10⁻³ Нс²/м⁸)
    // Текстовый формат может быть в разных единицах — определяем по величине
    const rRaw = colMap.resistance >= 0 ? parseNum(cols[colMap.resistance]) : 0;
    // Если значение очень маленькое (< 0.0001) — скорее всего в Нс²/м⁸ (SI), делим на 9.81
    // Если в диапазоне 0.001–1000 — уже кМюрг
    const rKmu = rRaw;

    rawBranches.push({
      id: brId,
      from: fromId,
      to: toId,
      name: colMap.name >= 0 ? cleanStr(cols[colMap.name]) : "",
      length:     colMap.length     >= 0 ? parseNum(cols[colMap.length])     : 0,
      area:       colMap.area       >= 0 ? parseNum(cols[colMap.area])       : 0,
      perimeter:  colMap.perimeter  >= 0 ? parseNum(cols[colMap.perimeter])  : 0,
      resistance: rKmu,
      flow:       colMap.flow       >= 0 ? parseNum(cols[colMap.flow])       : 0,
      fanPressure:colMap.fanPressure >= 0 ? parseNum(cols[colMap.fanPressure]): 0,
      fanName:    colMap.fanName    >= 0 ? cleanStr(cols[colMap.fanName])    : "",
      xFrom, yFrom, zFrom, xTo, yTo, zTo,
    });
  }

  debug.push(`Строк данных ветвей: ${rawBranches.length}`);

  if (rawBranches.length === 0) {
    // Дополнительная диагностика
    debug.push(`Первые 3 строки:`);
    rows.slice(0, 3).forEach((r, i) => debug.push(`  [${i}]: ${r.slice(0, 8).join(" | ")}`));
    return {
      nodes: [], branches: [],
      warnings: [...warnings, "Не найдено ветвей. Возможно файл не является экспортом Ventsim или имеет нестандартный формат. Включите лог парсера для диагностики."],
      stats: { nodes: 0, branches: 0, fans: 0 },
      debug: debug.join("\n"),
    };
  }

  // ── Строим узлы ────────────────────────────────────────────────────────────
  const allNodeIds = [...new Set(rawBranches.flatMap(b => [b.from, b.to]))];
  debug.push(`Уникальных узлов: ${allNodeIds.length}`);

  // Масштабирование координат: Ventsim может хранить в мм
  const allCoords = [...nodeCoords.values()];
  const maxCoord = Math.max(...allCoords.flatMap(c => [Math.abs(c.x), Math.abs(c.y)]));
  let coordScale = 1;
  if (maxCoord > 100000) { coordScale = 0.001; warnings.push("Координаты в мм → переведены в м."); }
  else if (maxCoord > 10000) { coordScale = 0.01; warnings.push("Координаты в см → переведены в м."); }
  debug.push(`maxCoord=${maxCoord.toFixed(0)}, coordScale=${coordScale}`);

  const hasRealCoords = allCoords.some(c => c.x !== 0 || c.y !== 0);
  const coordLayout: Map<string, { x: number; y: number }> = hasRealCoords
    ? new Map(allNodeIds.map(id => {
        const c = nodeCoords.get(id) ?? { x: 0, y: 0, z: 0 };
        return [id, { x: c.x * coordScale, y: c.y * coordScale }];
      }))
    : autoLayout(allNodeIds);

  if (!hasRealCoords) {
    warnings.push("Координаты X/Y узлов не найдены — узлы расставлены автоматически.");
  }

  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  for (const nid of allNodeIds) {
    const coord = coordLayout.get(nid) ?? { x: 0, y: 0 };
    const z = (nodeCoords.get(nid)?.z ?? 0) * coordScale;
    nodeMap.set(nid, makeNode(`NV${ts}_${nid}`, {
      x: Math.round(coord.x * 10) / 10,
      y: Math.round(coord.y * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: nid,
      name: nid,
    }));
  }

  // ── Строим ветви ───────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  let fanCount = 0;
  let bi = 0;

  for (const rb of rawBranches) {
    const fromNode = nodeMap.get(rb.from);
    const toNode   = nodeMap.get(rb.to);
    if (!fromNode || !toNode) continue;

    const area   = rb.area;
    const perim  = rb.perimeter;
    const dh     = area > 0 && perim > 0 ? Math.round(4 * area / perim * 1000) / 1000 : 0;

    // Длина: из данных или из координат
    let length = rb.length;
    if (length <= 0 && hasRealCoords) {
      const dx = (rb.xTo - rb.xFrom) * coordScale;
      const dy = (rb.yTo - rb.yFrom) * coordScale;
      const dz = (rb.zTo - rb.zFrom) * coordScale;
      length = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz) * 10) / 10;
    }

    // Угол наклона из координат
    let angle = 0;
    if (length > 0 && hasRealCoords) {
      const dz = Math.abs((rb.zTo - rb.zFrom) * coordScale);
      angle = Math.round(Math.asin(Math.min(1, dz / Math.max(length, 0.01))) * 180 / Math.PI * 10) / 10;
    }

    // Сопротивление в кМюрг → Н·с²/м⁸ (manualR хранится в кМюрг, resistance в Н·с²/м⁸)
    // Но в makeBranch manualR принимает Н·с²/м⁸, а потом resistance = manualR
    // Ventsim: R в кМюрг (×10⁻³ Нс²/м⁸) → ×1000 = Нс²/м⁸... нет, это не так.
    // Вентсим хранит R в нс²/м⁸ (SI). 1 кМюрг = 9.81 × 10⁻³ кН·с²/м⁸ = 9.81 Нс²/м⁸
    // Но при экспорте Ventsim пишет сопротивление в своих единицах (обычно Н/м³·с²)
    // Из строки: колонка 14 = 1E-11 и т.д. — очень маленькие числа, значит в СИ (Нс²/м⁸)
    const rSi = rb.resistance; // Нс²/м⁸
    const importedR = rSi > 0 ? rSi : 0;

    const hasFan = rb.fanPressure > 0 || rb.fanName.length > 0;
    if (hasFan) fanCount++;

    branches.push(makeBranch(`BV${ts}_${bi++}`, fromNode.id, toNode.id, {
      name: rb.name || rb.id,
      type: "Выработка",
      length: length > 0 ? length : 0,
      manualLength: rb.length > 0,
      angle,
      manualAngle: false,
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
  if (/ventsim|ventsym|vent_sim|vs\d/.test(fn)) return true;

  const lines = firstLines.split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 2) return false;

  const content = firstLines.toLowerCase();
  // Текстовый формат: заголовок с from/to
  const hasFrom = /\bfrom\b|\bfrom node/.test(content);
  const hasTo   = /\bto\b|\bto node/.test(content);
  if (hasFrom && hasTo) return true;

  // Числовой формат: несколько строк с >15 числовых колонок
  const numericLines = lines.filter(l => {
    const parts = l.split(/[,;\t]/);
    return parts.length >= 15 && parts.filter(p => !isNaN(parseFloat(p.trim()))).length >= 12;
  });
  return numericLines.length >= 2;
}
