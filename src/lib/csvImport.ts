// ─────────────────────────────────────────────────────────────────────────────
// Импорт CSV из АэроСети
//
// Формат (разделитель ; или ,):
//
// [Вершины]          ← секция узлов
// ID; X; Y; Z; Атмосфера(Да/Нет)
// 1; 100.5; -200.3; -130.0; Нет
//
// [Выработки]        ← секция ветвей
// ID; НачВерш; КонВерш; Название; Длина; Тип; Сечение; Периметр; Расход; Сопр; Слой; ИдПозиции
// 1; 1; 2; Ствол ЮВС; 20.0; Ствол ЮВС; 10.5; 11.2; 8.9; 0.0079; Стволы; 1
//
// Также поддерживаются секции [Positions] / [Позиции], [Jumpers] / [Перемычки]
// ─────────────────────────────────────────────────────────────────────────────

import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface CsvImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { nodes: number; branches: number; nodesWithZ: number };
  debug: string;
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(",", ".").trim());
  return isNaN(n) ? 0 : n;
}

function detectSep(line: string): string {
  // Пробуем ; потом ,
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

function splitRow(line: string, sep: string): string[] {
  return line.split(sep).map(s => s.trim());
}

export function parseCsv(content: string): CsvImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];

  // Нормализуем кодировку и строки
  const lines = content
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  debug.push(`Строк: ${lines.length}`);

  // Определяем разделитель по первой строке с данными
  const firstDataLine = lines.find(l => /[;,\t]/.test(l)) ?? lines[0] ?? "";
  const sep = detectSep(firstDataLine);
  debug.push(`Разделитель: "${sep}"`);

  // ── Разбиваем на секции ───────────────────────────────────────────────────
  type Section = "nodes" | "branches" | "positions" | "other";
  let currentSection: Section = "other";

  const nodeRows: string[][] = [];
  const branchRows: string[][] = [];

  const SECTION_PATTERNS: Array<[RegExp, Section]> = [
    [/верш|node|вершин|junction/i, "nodes"],
    [/выработ|branch|rib|ветв/i, "branches"],
    [/позиц|position/i, "positions"],
    [/перемычк|jumper/i, "other"],
    [/источник|source/i, "other"],
  ];

  for (const line of lines) {
    // Секция — строка в [скобках] или с ключевым словом
    const sectionMatch = line.match(/^\[([^\]]+)\]/) ?? line.match(/^([А-Яа-яA-Za-z][А-Яа-яA-Za-z\s]{2,})$/);
    if (sectionMatch) {
      const name = sectionMatch[1].toLowerCase();
      let found = false;
      for (const [pat, sec] of SECTION_PATTERNS) {
        if (pat.test(name)) { currentSection = sec; found = true; break; }
      }
      if (!found) currentSection = "other";
      debug.push(`Секция: "${sectionMatch[1]}" → ${currentSection}`);
      continue;
    }

    const cols = splitRow(line, sep);
    if (cols.length < 2) continue;

    // Пропускаем строки-заголовки (первая ячейка не число и не "id")
    const firstCell = cols[0].replace(/\s/g, "").toLowerCase();
    const isHeader = !/^\d/.test(firstCell) && firstCell !== "";
    if (isHeader && currentSection !== "other") continue;

    if (currentSection === "nodes") nodeRows.push(cols);
    else if (currentSection === "branches") branchRows.push(cols);
  }

  debug.push(`Строк узлов: ${nodeRows.length}, строк выработок: ${branchRows.length}`);

  // Если секции не обнаружены — пробуем автоопределение по числу колонок
  // Узлы: 5 колонок (id, x, y, z, atm)
  // Ветви: 8+ колонок (id, from, to, name, len, type, S, P...)
  if (nodeRows.length === 0 && branchRows.length === 0) {
    for (const line of lines) {
      const cols = splitRow(line, sep);
      if (cols.length < 3) continue;
      const firstCell = cols[0].toLowerCase();
      if (!/^\d/.test(firstCell) && firstCell !== "") continue;  // заголовок
      if (cols.length <= 6 && !isNaN(parseNum(cols[1])) && !isNaN(parseNum(cols[2]))) {
        nodeRows.push(cols);
      } else if (cols.length >= 5) {
        branchRows.push(cols);
      }
    }
    if (nodeRows.length > 0 || branchRows.length > 0) {
      warnings.push("Секции не найдены — данные определены автоматически.");
      debug.push(`Авто: узлов=${nodeRows.length}, ветвей=${branchRows.length}`);
    }
  }

  if (nodeRows.length === 0 && branchRows.length === 0) {
    return {
      nodes: [], branches: [],
      warnings: ["Файл не содержит данных. Убедитесь что экспортированы секции 'Вершины' и 'Выработки'."],
      stats: { nodes: 0, branches: 0, nodesWithZ: 0 },
      debug: debug.join("\n"),
    };
  }

  // ── Парсим узлы ──────────────────────────────────────────────────────────
  // Формат: ID; X; Y; Z; Атмосфера
  const ts = Date.now();
  const nodeMap = new Map<string, TopoNode>();
  let nodesWithZ = 0;

  for (const cols of nodeRows) {
    const id = cols[0]?.trim();
    if (!id || !/^\d/.test(id)) continue;

    const x = parseNum(cols[1] ?? "0");
    const y = parseNum(cols[2] ?? "0");
    const z = parseNum(cols[3] ?? "0");
    const isAtm = /да|yes|true|1/i.test(cols[4] ?? "");

    if (z !== 0) nodesWithZ++;

    const num = id.padStart(3, "0");
    nodeMap.set(id, makeNode(`N${ts}_${id}`, {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: num,
      name: id,
      atmosphereLink: isAtm,
    }));
  }

  debug.push(`Узлов создано: ${nodeMap.size}, с Z≠0: ${nodesWithZ}`);

  // ── Парсим ветви ──────────────────────────────────────────────────────────
  // Формат: ID; НачВерш; КонВерш; Название; Длина; Тип; Сечение; Периметр; Расход; Сопр; Слой; ИдПозиции
  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (const cols of branchRows) {
    const id = cols[0]?.trim();
    if (!id || !/^\d/.test(id)) continue;

    const fromId = cols[1]?.trim();
    const toId   = cols[2]?.trim();
    if (!fromId || !toId) continue;

    const fromNode = nodeMap.get(fromId);
    const toNode   = nodeMap.get(toId);
    if (!fromNode || !toNode) continue;

    const key = `${Math.min(+fromId, +toId)}_${Math.max(+fromId, +toId)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const name       = cols[3]?.trim() ?? "";
    const length     = parseNum(cols[4] ?? "0");
    const typeName   = cols[5]?.trim() ?? "";
    const area       = parseNum(cols[6] ?? "0");
    const perimeter  = parseNum(cols[7] ?? "0");
    const flow       = parseNum(cols[8] ?? "0");
    const resistance = parseNum(cols[9] ?? "0");
    const layer      = cols[10]?.trim() || "Выработки";

    // Определяем форму сечения из названия типа
    let shape: "round" | "rect" | "arch" = "rect";
    if (/круг|round|цилиндр/i.test(typeName)) shape = "round";
    else if (/арк|arch/i.test(typeName)) shape = "arch";

    const dh = perimeter > 0 ? Math.round(4 * area / perimeter * 1000) / 1000 : 0;

    // Угол наклона из Z-координат
    const dz = Math.abs(toNode.z - fromNode.z);
    const dist3d = Math.sqrt(
      (toNode.x - fromNode.x) ** 2 +
      (toNode.y - fromNode.y) ** 2 +
      (toNode.z - fromNode.z) ** 2
    );
    // Используем длину из файла если есть, иначе из 3D расстояния
    const realLen = length > 0 ? length : Math.round(dist3d * 10) / 10;
    const realAngle = realLen > 0 ? Math.round(Math.asin(Math.min(1, dz / realLen)) * 180 / Math.PI * 10) / 10 : 0;

    branches.push(makeBranch(`B${ts}_${bi++}`, fromNode.id, toNode.id, {
      layer,
      length: realLen,
      manualLength: length > 0,
      angle: realAngle,
      manualAngle: false,
      area:      area > 0 ? area : undefined as unknown as number,
      perimeter: perimeter > 0 ? perimeter : undefined as unknown as number,
      dh:        dh > 0 ? dh : undefined as unknown as number,
      flow:      flow > 0 ? flow : 0,
      resistance: resistance > 0 ? resistance : 0,
      manualSection: area > 0,
      shape,
      name: name || `Ветвь ${id}`,
    }));
  }

  debug.push(`Ветвей создано: ${branches.length}`);

  if (nodeMap.size === 0) {
    warnings.push("⚠ Узлы не найдены. Убедитесь что секция 'Вершины' экспортирована с координатами X, Y, Z.");
  }
  if (branches.length === 0 && branchRows.length > 0) {
    const missing = branchRows.filter(r => {
      const f = r[1]?.trim(), t = r[2]?.trim();
      return f && t && (!nodeMap.has(f) || !nodeMap.has(t));
    }).length;
    if (missing > 0) warnings.push(`⚠ ${missing} ветвей пропущено — не найдены узлы. Убедитесь что секции 'Вершины' и 'Выработки' в одном файле.`);
  }

  return {
    nodes: [...nodeMap.values()],
    branches,
    warnings,
    stats: { nodes: nodeMap.size, branches: branches.length, nodesWithZ },
    debug: debug.join("\n"),
  };
}
