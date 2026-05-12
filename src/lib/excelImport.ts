// ─────────────────────────────────────────────────────────────────────────────
// Импорт из Excel-отчёта Вентиляции 2.0
//
// Формат файла — два листа:
//   "Список ветвей":  Ветвь | Нач.узел | Кон.узел | Название | Длина м | Угол град |
//                     Форма сечения | Сечение м² | Периметр м | Zн м | Zк м | ...
//   "Список узлов":   Номер | Глубина м | Давление | Температура | ...
//
// Глубина узла = Z-координата (отрицательная — под землёй).
// X/Y координаты в Excel отсутствуют — узлы раскладываются автоматически.
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface ExcelImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: { nodes: number; branches: number; nodesWithZ: number };
  debug: string;
}

interface RawBranch {
  id: number;
  fromId: number;
  toId: number;
  name: string;
  length: number;
  angle: number;
  shape: string;
  area: number;
  perimeter: number;
  zFrom: number;
  zTo: number;
}

interface RawNode {
  id: number;
  depth: number;  // Глубина м (Z = -depth для подземных)
  pressure?: number;
  isSurface?: boolean;
}

// Нормализует заголовок колонки: убирает переносы, лишние пробелы
function norm(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Парсит число из ячейки (поддерживает запятую как разделитель)
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const cleaned = String(v ?? "").replace(",", ".");
  const m = cleaned.match(/^-?[0-9]*\.?[0-9]*/);
  const s = m ? m[0] : "";
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toInt(v: unknown): number {
  return Math.round(toNum(v));
}

export function parseExcel(buffer: ArrayBuffer): ExcelImportResult {
  const warnings: string[] = [];
  const debug: string[] = [];

  const wb = XLSX.read(buffer, { type: "array" });
  debug.push(`Листы: ${wb.SheetNames.join(", ")}`);

  // ── Находим нужные листы ──────────────────────────────────────────────────
  const findSheet = (patterns: string[]): XLSX.WorkSheet | null => {
    for (const name of wb.SheetNames) {
      const nl = name.toLowerCase();
      if (patterns.some(p => nl.includes(p))) return wb.Sheets[name];
    }
    return null;
  };

  const branchSheet = findSheet(["ветв", "branch", "rib"]);
  const nodeSheet   = findSheet(["узл", "node", "junction"]);

  if (!branchSheet) {
    return {
      nodes: [], branches: [], warnings: ["Не найден лист с ветвями (ожидается 'Список ветвей')."],
      stats: { nodes: 0, branches: 0, nodesWithZ: 0 }, debug: debug.join("\n"),
    };
  }

  // ── Парсим ветви ──────────────────────────────────────────────────────────
  const branchRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(branchSheet, {
    defval: "",
    raw: true,
  });
  debug.push(`Ветвей строк: ${branchRows.length}`);

  // Определяем индексы колонок по заголовкам первой строки с данными
  // sheet_to_json использует первую строку как ключи — но может быть несколько шапок
  // Ищем строку где есть "Ветвь" или "ветвь"
  let headerRow = 0;
  const allRows = XLSX.utils.sheet_to_json<unknown[]>(branchSheet, { header: 1, defval: "" }) as unknown[][];

  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i] as unknown[];
    const hasId   = row.some(c => /^ветв/i.test(String(c).trim()));
    const hasFrom = row.some(c => /нач/i.test(String(c).trim()));
    if (hasId && hasFrom) { headerRow = i; break; }
  }

  const headers = (allRows[headerRow] as unknown[]).map(c => norm(c));
  debug.push(`Заголовки ветвей (строка ${headerRow}): ${headers.slice(0, 15).join(" | ")}`);

  // Маппинг заголовков → индексы
  const col = (patterns: string[]): number => {
    for (const p of patterns) {
      const i = headers.findIndex(h => h.includes(p));
      if (i >= 0) return i;
    }
    return -1;
  };

  const ci = {
    id:        col(["ветвь", "branch", "№"]),
    from:      col(["нач", "from", "начал"]),
    to:        col(["кон", "to", "конеч"]),
    name:      col(["назван", "name"]),
    length:    col(["длина", "length", "длин"]),
    angle:     col(["угол", "angle", "grad"]),
    shape:     col(["форма", "shape", "сечени"]),
    area:      col(["сечение м", "площ", "area", "s м"]),
    perimeter: col(["периметр", "perim"]),
    zFrom:     col(["zн", "z н", "zн м", "z нач"]),
    zTo:       col(["zк", "z к", "zк м", "z кон"]),
  };

  debug.push(`Колонки: id=${ci.id} from=${ci.from} to=${ci.to} len=${ci.length} ang=${ci.angle} S=${ci.area} P=${ci.perimeter} Zн=${ci.zFrom} Zк=${ci.zTo}`);

  const rawBranches: RawBranch[] = [];
  for (let ri = headerRow + 1; ri < allRows.length; ri++) {
    const row = allRows[ri] as unknown[];
    if (!row || row.length === 0) continue;
    const idVal = ci.id >= 0 ? row[ci.id] : ri - headerRow;
    if (!idVal && idVal !== 0) continue;
    const id = toInt(idVal);
    if (id <= 0 && String(idVal).trim() === "") continue;

    rawBranches.push({
      id,
      fromId:    ci.from >= 0 ? toInt(row[ci.from]) : 0,
      toId:      ci.to   >= 0 ? toInt(row[ci.to])   : 0,
      name:      ci.name >= 0 ? String(row[ci.name] ?? "").trim() : "",
      length:    ci.length    >= 0 ? toNum(row[ci.length])    : 0,
      angle:     ci.angle     >= 0 ? Math.abs(toNum(row[ci.angle])) : 0,
      shape:     ci.shape     >= 0 ? String(row[ci.shape] ?? "").toLowerCase() : "rect",
      area:      ci.area      >= 0 ? toNum(row[ci.area])      : 0,
      perimeter: ci.perimeter >= 0 ? toNum(row[ci.perimeter]) : 0,
      zFrom:     ci.zFrom     >= 0 ? toNum(row[ci.zFrom])     : 0,
      zTo:       ci.zTo       >= 0 ? toNum(row[ci.zTo])       : 0,
    });
  }
  debug.push(`Распознано ветвей: ${rawBranches.length}`);

  // ── Парсим узлы ──────────────────────────────────────────────────────────
  const rawNodes: RawNode[] = [];
  if (nodeSheet) {
    const nodeAllRows = XLSX.utils.sheet_to_json<unknown[]>(nodeSheet, { header: 1, defval: "" }) as unknown[][];
    let nodeHeaderRow = 0;
    for (let i = 0; i < Math.min(10, nodeAllRows.length); i++) {
      const row = nodeAllRows[i] as unknown[];
      if (row.some(c => /номер/i.test(String(c).trim()))) { nodeHeaderRow = i; break; }
    }
    const nh = (nodeAllRows[nodeHeaderRow] as unknown[]).map(c => norm(c));
    debug.push(`Заголовки узлов: ${nh.slice(0, 8).join(" | ")}`);

    const nc = {
      id:      nh.findIndex(h => /номер|^id/.test(h)),
      depth:   nh.findIndex(h => /глуб|depth|z/.test(h)),
      surface: nh.findIndex(h => /поверхн/.test(h)),
    };

    for (let ri = nodeHeaderRow + 1; ri < nodeAllRows.length; ri++) {
      const row = nodeAllRows[ri] as unknown[];
      if (!row || row.length === 0) continue;
      const idVal = nc.id >= 0 ? row[nc.id] : null;
      if (!idVal && idVal !== 0) continue;
      const id = toInt(idVal);
      if (id <= 0) continue;
      rawNodes.push({
        id,
        depth: nc.depth >= 0 ? toNum(row[nc.depth]) : 0,
        isSurface: nc.surface >= 0 ? /да|yes|true/i.test(String(row[nc.surface])) : false,
      });
    }
    debug.push(`Распознано узлов: ${rawNodes.length}`);
  } else {
    warnings.push("Лист 'Список узлов' не найден — Z-координаты будут из ветвей.");
  }

  // ── Строим топологию ─────────────────────────────────────────────────────
  if (rawBranches.length === 0) {
    return {
      nodes: [], branches: [], warnings: ["Не удалось прочитать ветви из Excel. Проверьте формат файла."],
      stats: { nodes: 0, branches: 0, nodesWithZ: 0 }, debug: debug.join("\n"),
    };
  }

  // Собираем все уникальные ID узлов
  const nodeIds = new Set<number>();
  for (const b of rawBranches) {
    if (b.fromId > 0) nodeIds.add(b.fromId);
    if (b.toId > 0) nodeIds.add(b.toId);
  }

  // Строим карту глубин из листа узлов
  const depthMap = new Map<number, number>();
  for (const n of rawNodes) depthMap.set(n.id, n.depth);

  // Для узлов без глубины — берём из Zн/Zк ветвей
  for (const b of rawBranches) {
    if (b.fromId > 0 && !depthMap.has(b.fromId) && b.zFrom !== 0) depthMap.set(b.fromId, b.zFrom);
    if (b.toId > 0   && !depthMap.has(b.toId)   && b.zTo   !== 0) depthMap.set(b.toId,   b.zTo);
  }

  // Авторасположение узлов по кругу / сетке (X/Y нет в данных)
  // Используем force-directed простой алгоритм: узлы по кругу, соединённые ближе
  const ts = Date.now();
  const nodeArr = [...nodeIds].sort((a, b2) => a - b2);
  const n = nodeArr.length;
  const R = Math.max(50, n * 8);  // радиус круга в метрах

  const nodeMap = new Map<number, TopoNode>();
  nodeArr.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / n;
    const depth = depthMap.get(id) ?? 0;
    // Z = -depth (глубина → отрицательная координата Z)
    const z = depth > 0 ? -depth : depth;
    const num = String(id).padStart(3, "0");
    const node = makeNode(`N${ts}_${id}`, {
      x: Math.round(R * Math.cos(angle) * 10) / 10,
      y: Math.round(R * Math.sin(angle) * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: num,
      name: `${id}`,
    });
    nodeMap.set(id, node);
  });

  const nodesWithZ = [...nodeMap.values()].filter(n2 => n2.z !== 0).length;

  // ── Строим ветви ──────────────────────────────────────────────────────────
  const branches: TopoBranch[] = [];
  const seen = new Set<string>();
  let bi = 0;

  for (const rb of rawBranches) {
    if (rb.fromId <= 0 || rb.toId <= 0) continue;
    if (!nodeMap.has(rb.fromId) || !nodeMap.has(rb.toId)) continue;

    const key = `${Math.min(rb.fromId, rb.toId)}_${Math.max(rb.fromId, rb.toId)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fromNode = nodeMap.get(rb.fromId)!;
    const toNode   = nodeMap.get(rb.toId)!;

    // Форма сечения
    let shape: "round" | "rect" | "arch" = "rect";
    if (/круг|round|цилиндр/i.test(rb.shape)) shape = "round";
    else if (/арк|arch/i.test(rb.shape)) shape = "arch";

    // Гидравлический диаметр
    const dh = rb.perimeter > 0 ? Math.round(4 * rb.area / rb.perimeter * 1000) / 1000 : 0;

    // Ширина/высота для прямоугольного сечения (примерно квадрат если нет данных)
    const w = shape === "round" && dh > 0 ? dh : (rb.perimeter > 0 ? rb.perimeter / 4 : 0);

    branches.push(makeBranch(`B${ts}_${bi++}`, fromNode.id, toNode.id, {
      layer: "Ветви",
      name: rb.name || `Ветвь ${rb.id}`,
      length: rb.length > 0 ? rb.length : Math.round(Math.sqrt(
        (toNode.x - fromNode.x) ** 2 + (toNode.y - fromNode.y) ** 2 + (toNode.z - fromNode.z) ** 2
      ) * 10) / 10,
      manualLength: rb.length > 0,
      angle: rb.angle,
      manualAngle: rb.angle > 0,
      area: rb.area > 0 ? rb.area : undefined as unknown as number,
      perimeter: rb.perimeter > 0 ? rb.perimeter : undefined as unknown as number,
      dh: dh > 0 ? dh : undefined as unknown as number,
      manualSection: rb.area > 0,
      shape,
      ...(shape === "round" ? { diameter: dh } : { rectWidth: w, rectHeight: w }),
    }));
  }

  debug.push(`Итого: узлов=${nodeMap.size}, ветвей=${branches.length}, с Z=${nodesWithZ}`);

  if (nodesWithZ === 0) {
    warnings.push("⚠ Глубина узлов не найдена — все Z=0. Проверьте лист 'Список узлов', колонка 'Глубина м'.");
  }

  return {
    nodes: [...nodeMap.values()],
    branches,
    warnings,
    stats: { nodes: nodeMap.size, branches: branches.length, nodesWithZ },
    debug: debug.join("\n"),
  };
}