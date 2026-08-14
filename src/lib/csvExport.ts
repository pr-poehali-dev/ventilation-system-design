// ─────────────────────────────────────────────────────────────────────────────
// Экспорт CSV для ПО «АэроСеть» и «Вентиляция 2.0».
//
// Формат (совпадает у обеих программ — различаются только заголовки секций):
//   Вершины:      ID; X; Y; Z; Атмосфера(Да/Нет)
//   Выработки:    ID; НачВерш; КонВерш; Название; Длина; Тип; Сечение; Периметр;
//                 Расход; Сопротивление; Слой; ИдПозиции
//   Позиции:      ID; X; Y; Z; Номер; Название; ТипПозиции; ЦветГраницы
//   Перемычки:    ИдВерш(выработки); Смещение%; ТипПеремычки; Сопротивление
//   Источники тяги(вент.): ИдВерш(выработки); Смещение%; Напор
//
// Сопротивление выгружается в кМюрг (внутреннее R хранится в Н·с²/м⁸):
//   кМюрг = R / 9.81e-3   (обратно к импорту: Н·с²/м⁸ = кМюрг × 9.81e-3)
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode, type TopoBranch, type Horizon } from "@/lib/topology";
import { type Position } from "@/lib/positions";

export type CsvExportSchema = "aeroset" | "vent2";
export type CsvSep = ";" | "," | "\t";
export type CsvDecimal = "." | ",";

// Единицы измерения экспорта (влияют на числовые значения выработок/узлов).
export interface CsvExportUnits {
  // Коэффициенты перевода из ВНУТРЕННИХ единиц (СИ) в единицы выгрузки.
  // По умолчанию всё в СИ (м, м², м³/с, кМюрг, Па).
  coord: number;       // множитель для X,Y,Z (м)
  length: number;      // множитель для длины (м)
  area: number;        // множитель для сечения (м²)
  perimeter: number;   // множитель для периметра (м)
  flow: number;        // множитель для расхода (м³/с)
  // Сопротивление: "kmu" — кМюрг (делим R/9.81e-3), "si" — Н·с²/м⁸ (как есть)
  resistanceUnit: "kmu" | "si";
  pressure: number;    // множитель для напора (Па)
}

export const DEFAULT_CSV_UNITS: CsvExportUnits = {
  coord: 1, length: 1, area: 1, perimeter: 1, flow: 1,
  resistanceUnit: "kmu", pressure: 1,
};

// Какие поля выгружать (порядок фиксирован форматом).
export interface CsvExportFields {
  // Вершины
  nodeId: boolean; nodeX: boolean; nodeY: boolean; nodeZ: boolean; nodeAtm: boolean;
  // Выработки
  brId: boolean; brFrom: boolean; brTo: boolean; brName: boolean; brLength: boolean;
  brType: boolean; brArea: boolean; brPerimeter: boolean; brFlow: boolean;
  brResistance: boolean; brLayer: boolean; brPositionId: boolean;
  // Секции целиком
  exportPositions: boolean;
  exportBulkheads: boolean;
  exportFans: boolean;
}

export const DEFAULT_CSV_FIELDS: CsvExportFields = {
  nodeId: true, nodeX: true, nodeY: true, nodeZ: true, nodeAtm: true,
  brId: true, brFrom: true, brTo: true, brName: true, brLength: true,
  brType: true, brArea: true, brPerimeter: true, brFlow: true,
  brResistance: true, brLayer: true, brPositionId: true,
  exportPositions: true, exportBulkheads: true, exportFans: true,
};

export interface CsvExportOptions {
  schema: CsvExportSchema;
  sep: CsvSep;
  decimal: CsvDecimal;
  fields: CsvExportFields;
  units: CsvExportUnits;
}

// ── Форматирование числа с нужным десятичным разделителем ─────────────────────
function fmtNum(v: number, decimal: CsvDecimal, digits = 3): string {
  if (!Number.isFinite(v)) v = 0;
  // Убираем лишние нули: 30.890 → 30.89, но целые оставляем как есть
  let s = v.toFixed(digits);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return decimal === "," ? s.replace(".", ",") : s;
}

// Экранирование текстового поля: если содержит разделитель/кавычки — в кавычки.
function esc(s: string, sep: CsvSep, decimal: CsvDecimal): string {
  const val = String(s ?? "");
  // Если десятичный разделитель — запятая, а сепаратор ";", текст с запятой ок.
  const needQuote = val.includes(sep) || val.includes('"') || val.includes("\n")
    || (decimal === "," && sep === "," && val.includes(","));
  if (needQuote) return `"${val.replace(/"/g, '""')}"`;
  return val;
}

// Эффективное сопротивление ветви в кМюрг (или Н·с²/м⁸).
function branchResistance(b: TopoBranch): number {
  // resistance хранится в кМюрг (в системе расчёта 1 кМюрг = 1 Н·с²/м⁸),
  // именно это значение показывается в панели свойств ветви. Поэтому
  // выгружаем его как есть — без деления на 9.81e-3 (иначе R завышался ~в 102 раза).
  return b.resistance ?? 0;
}

// ── Столбец «Слой выработки» ─────────────────────────────────────────────────
// В программе слой = ГОРИЗОНТ, к которому привязана выработка (список слева
// на схеме: «Проект», «КТВР +390/+130» и т. д.). Раньше сюда выгружалось поле
// branch.layer — это другая сущность (группа выработок «Стволы»/«Квершлаги»),
// из-за чего во всех строках стояло одно и то же значение, а созданные
// пользователем горизонты в файл не попадали вовсе.
// Если горизонт не найден (ветвь без привязки) — падаём обратно на layer.
function layerName(b: TopoBranch, horizonById?: Map<string, Horizon>): string {
  const hz = b.horizonId ? horizonById?.get(b.horizonId) : undefined;
  return hz?.name || b.layer || "";
}

// ── Столбец «Тип выработки» ──────────────────────────────────────────────────
// Ожидается тип из справочника «Типы выработок» (например «Квершлаг»), а не
// код формы сечения (rect/arch/round) — его АэроСеть/Вентиляция не понимают.
// mineTypeName — выбор в справочнике; при его отсутствии берём название.
function excavationType(b: TopoBranch): string {
  return b.mineTypeName || b.type || "";
}

// ═════════════════════════════════════════════════════════════════════════════
// Экспорт «Вентиляция 2.0» — 5 ОТДЕЛЬНЫХ файлов в ZIP-архиве:
//   nodes.csv, links.csv, jumpers.csv, fans.csv, positions.csv
//
// Формат (как в примере программы «Вентиляция 2.0»):
//   • разделитель — запятая, десятичный разделитель — точка;
//   • каждое поле, кроме первого (ID), заключено в кавычки;
//   • каждая строка (включая заголовок) заканчивается запятой;
//   • без строк-комментариев с «#».
// ═════════════════════════════════════════════════════════════════════════════

// Число для формата Вентиляции 2.0: точка-разделитель, фикс. кол-во знаков.
function v2num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) v = 0;
  return v.toFixed(digits);
}

// Строка Вентиляции 2.0: первое поле без кавычек (ID), остальные — в кавычках,
// строка завершается запятой.
function v2row(idCell: string | number, rest: (string | number)[]): string {
  const head = String(idCell);
  const tail = rest.map(c => `"${String(c).replace(/"/g, '""')}"`);
  return [head, ...tail].join(",") + ",";
}

// Тип перемычки для Вентиляции 2.0: "vent" (вентиляционная) / "seal" (глухая).
function bulkheadKind(b: TopoBranch): "vent" | "seal" {
  const name = (b.bulkheadName || "").toLowerCase();
  const hasWindow = (b.bulkheadWindowArea ?? 0) > 0;
  if (hasWindow || name.includes("вент") || name.includes("окн") || name.includes("двер")) return "vent";
  return "seal";
}

// Тип источника тяги: "main" (главная/вспомогательная — ГВУ/ВВУ) / "simple" (ВМП).
function fanKind(b: TopoBranch): "main" | "simple" {
  return b.fanType === "ВМП" ? "simple" : "main";
}

export interface Vent2Files {
  "nodes.csv": string;
  "links.csv": string;
  "jumpers.csv": string;
  "fans.csv": string;
  "positions.csv": string;
}

// Построение 5 CSV для «Вентиляция 2.0». Возвращает { имяФайла: содержимое }.
export function buildVent2Files(
  nodes: TopoNode[],
  branches: TopoBranch[],
  positions: Position[],
  units: CsvExportUnits = DEFAULT_CSV_UNITS,
  bulkheadRByBranch?: Map<string, number>,
  horizons: Horizon[] = [],
): Vent2Files {
  const u = units;
  // Горизонты (слои схемы) — для столбца «Слой выработки».
  const horizonById = new Map(horizons.map(h => [h.id, h]));
  // R перемычки берём из карты (реальное R символа на схеме), иначе — из ветви.
  const bkR = (b: TopoBranch) => bulkheadRByBranch?.get(b.id) ?? b.bulkheadR ?? 0;
  const hasBk = (b: TopoBranch) => (bulkheadRByBranch?.has(b.id) ?? false) || b.hasBulkhead;

  // ── nodes.csv ───────────────────────────────────────────────────────────────
  const nodeLines: string[] = [
    v2row("Идентификатор вершины", ["X", "Y", "Z", "Связь с атмосферой"]),
  ];
  for (const n of nodes) {
    nodeLines.push(v2row(n.id, [
      v2num((n.x ?? 0) * u.coord),
      v2num((n.y ?? 0) * u.coord),
      v2num((n.z ?? 0) * u.coord),
      n.atmosphereLink ? "Да" : "Нет",
    ]));
  }

  // Карта: branchId → id первой привязанной позиции
  const branchToPos = new Map<string, string>();
  for (const p of positions) {
    for (const bid of (p.branchIds ?? [])) {
      if (!branchToPos.has(bid)) branchToPos.set(bid, p.id);
    }
  }

  // ── links.csv ───────────────────────────────────────────────────────────────
  const linkLines: string[] = [
    v2row("Идентификатор выработки", [
      "Идентификатор начального узла", "Идентификатор конечного узла",
      "Название выработки", "Длина выработки, м", "Тип выработки",
      "Площадь поперечного сечения выработки, м2", "Периметр выработки, м",
      "Расход выработки, м3/с", "Сопротивление выработки, кМюрг",
      "Слой выработки", "Идентификатор позиции",
    ]),
  ];
  for (const b of branches) {
    linkLines.push(v2row(b.id, [
      b.fromId,
      b.toId,
      b.type || "",
      v2num((b.length ?? 0) * u.length),
      excavationType(b),
      v2num((b.area ?? 0) * u.area),
      v2num((b.perimeter ?? 0) * u.perimeter),
      v2num((b.flow ?? 0) * u.flow),
      v2num(branchResistance(b), 7),
      layerName(b, horizonById),
      branchToPos.get(b.id) ?? "",
    ]));
  }

  // ── jumpers.csv (перемычки) ─────────────────────────────────────────────────
  const jumperLines: string[] = [
    v2row("Идентификатор выработки", [
      "Смещение перемычки, %", "Тип перемычки", "Сопротивление перемычки, кМюрг",
    ]),
  ];
  for (const b of branches.filter(hasBk)) {
    // R перемычки в кМюрг (в системе 1 кМюрг = 1 Н·с²/м⁸) — выгружаем как есть.
    jumperLines.push(v2row(b.id, [
      v2num(0.5, 4),          // смещение вдоль выработки (0..1), центр по умолчанию
      bulkheadKind(b),
      v2num(bkR(b), 7),
    ]));
  }

  // ── fans.csv (источники тяги) ───────────────────────────────────────────────
  const fanLines: string[] = [
    v2row("Идентификатор выработки", [
      "Смещение источника тяги, %", "Тип источника тяги", "Напор источника тяги, Па",
    ]),
  ];
  for (const b of branches.filter(x => x.hasFan)) {
    fanLines.push(v2row(b.id, [
      v2num(0.2, 4),          // смещение источника тяги (0..1)
      fanKind(b),
      v2num((b.fanPressure ?? 0) * u.pressure),
    ]));
  }

  // ── positions.csv (позиции ПЛА) ─────────────────────────────────────────────
  const posLines: string[] = [
    v2row("Идентификатор позиции", [
      "Координата X, м", "Координата Y, м", "Координата Z, м",
      "Номер позиции", "Название позиции", "Тип позиции", "Вид аварии",
      "Цвет границы", "Список выработок",
    ]),
  ];
  for (const p of positions) {
    posLines.push(v2row(p.id, [
      v2num((p.x ?? 0) * u.coord),
      v2num((p.y ?? 0) * u.coord),
      v2num((p.z ?? 0) * u.coord),
      String(p.number ?? ""),
      p.name || "",
      p.positionType === "reverse" ? "Реверсивная" : "Безреверсивная",
      p.accidentType || "",
      p.borderColor || "",
      // Привязка позиции к выработкам: при импорте читается обратно
      // (см. parsePositionsFile → branchIds), раньше не выгружалась и
      // связь «позиция ↔ выработка» терялась.
      (p.branchIds ?? []).join(" "),
    ]));
  }

  const join = (l: string[]) => l.join("\r\n") + "\r\n";
  return {
    "nodes.csv": join(nodeLines),
    "links.csv": join(linkLines),
    "jumpers.csv": join(jumperLines),
    "fans.csv": join(fanLines),
    "positions.csv": join(posLines),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Экспорт «АэроСеть» — 5 ОТДЕЛЬНЫХ файлов в ZIP-архиве:
//   nodes.csv, excavations.csv, bulkheads.csv, fans.csv, positions.csv
//
// Формат (как в примере программы «АэроСеть»):
//   • разделитель — «;», десятичный разделитель — «,»;
//   • текстовые поля с разделителем/кавычками экранируются кавычками;
//   • полные названия столбцов в заголовках.
//   • fans.csv БЕЗ столбца «тип» (только Ид; Смещение; Напор).
// ═════════════════════════════════════════════════════════════════════════════

export interface AeroSetFiles {
  "nodes.csv": string;
  "excavations.csv": string;
  "bulkheads.csv": string;
  "fans.csv": string;
  "positions.csv": string;
}

export function buildAeroSetFiles(
  nodes: TopoNode[],
  branches: TopoBranch[],
  positions: Position[],
  units: CsvExportUnits = DEFAULT_CSV_UNITS,
  bulkheadRByBranch?: Map<string, number>,
  horizons: Horizon[] = [],
): AeroSetFiles {
  const u = units;
  // Горизонты (слои схемы) — для столбца «Слой выработки».
  const horizonById = new Map(horizons.map(h => [h.id, h]));
  const bkR = (b: TopoBranch) => bulkheadRByBranch?.get(b.id) ?? b.bulkheadR ?? 0;
  const hasBk = (b: TopoBranch) => (bulkheadRByBranch?.has(b.id) ?? false) || b.hasBulkhead;
  const sep: CsvSep = ";";
  const dec: CsvDecimal = ",";
  const num = (v: number, d = 6) => fmtNum(v, dec, d);
  const txt = (s: string) => esc(s, sep, dec);
  const line = (cells: (string | number)[]) =>
    cells.map(c => (typeof c === "number" ? num(c) : c)).join(sep);

  // ── nodes.csv ───────────────────────────────────────────────────────────────
  const nodeLines: string[] = [
    line(["Идентификатор вершины", "X координата", "Y координата", "Высотная отметка", "Связь с атмосферой"]),
  ];
  for (const n of nodes) {
    nodeLines.push([
      txt(n.id),
      num((n.x ?? 0) * u.coord, 3),
      num((n.y ?? 0) * u.coord, 3),
      num((n.z ?? 0) * u.coord, 2),
      n.atmosphereLink ? "Да" : "Нет",
    ].join(sep));
  }

  // Карта: branchId → id первой привязанной позиции
  const branchToPos = new Map<string, string>();
  for (const p of positions) {
    for (const bid of (p.branchIds ?? [])) {
      if (!branchToPos.has(bid)) branchToPos.set(bid, p.id);
    }
  }

  // ── excavations.csv ─────────────────────────────────────────────────────────
  const excLines: string[] = [
    line([
      "Идентификатор выработки", "Идентификатор начального узла", "Идентификатор конечного узла",
      "Название выработки", "Длина выработки, м", "Тип выработки",
      "Площадь поперечного сечения выработки, м2", "Периметр выработки, м",
      "Расход выработки, м3/с", "Сопротивление выработки, кМюрг",
      "Слой выработки", "Идентификатор позиции",
    ]),
  ];
  for (const b of branches) {
    excLines.push([
      txt(b.id),
      txt(b.fromId),
      txt(b.toId),
      txt(b.type || ""),
      num((b.length ?? 0) * u.length, 2),
      txt(excavationType(b)),
      num((b.area ?? 0) * u.area, 4),
      num((b.perimeter ?? 0) * u.perimeter, 4),
      num((b.flow ?? 0) * u.flow, 4),
      num(branchResistance(b), 6),
      txt(layerName(b, horizonById)),
      txt(branchToPos.get(b.id) ?? ""),
    ].join(sep));
  }

  // ── bulkheads.csv (перемычки) ───────────────────────────────────────────────
  const bkLines: string[] = [
    line(["Идентификатор выработки", "Смещение перемычки, %", "Тип перемычки", "Сопротивление перемычки, кМюрг"]),
  ];
  for (const b of branches.filter(hasBk)) {
    // R перемычки в кМюрг (в системе 1 кМюрг = 1 Н·с²/м⁸) — выгружаем как есть.
    bkLines.push([
      txt(b.id),
      num(0.5, 4),                 // смещение вдоль выработки (0..1)
      bulkheadKind(b),             // "seal" / "vent"
      num(bkR(b), 6),
    ].join(sep));
  }

  // ── fans.csv (источники тяги) — БЕЗ столбца «тип» ────────────────────────────
  const fanLines: string[] = [
    line(["Идентификатор выработки", "Смещение источника тяги, %", "Напор источника тяги, Па"]),
  ];
  for (const b of branches.filter(x => x.hasFan)) {
    fanLines.push([
      txt(b.id),
      num(0.2, 4),                 // смещение источника тяги (0..1)
      num((b.fanPressure ?? 0) * u.pressure, 4),
    ].join(sep));
  }

  // ── positions.csv (позиции ПЛА) ─────────────────────────────────────────────
  const posLines: string[] = [
    line([
      "Ид позиции", "Координата X, м", "Координата Y, м", "Координата Z, м",
      "Номер позиции", "Название позиции", "Тип позиции", "Вид аварии",
      "Цвет границы", "Список выработок",
    ]),
  ];
  for (const p of positions) {
    posLines.push([
      txt(p.id),
      num((p.x ?? 0) * u.coord, 3),
      num((p.y ?? 0) * u.coord, 3),
      num((p.z ?? 0) * u.coord, 2),
      String(p.number ?? ""),
      txt(p.name || ""),
      p.positionType === "reverse" ? "Реверсивная" : "Безреверсивная",
      txt(p.accidentType || ""),
      txt(p.borderColor || ""),
      // Привязка позиции к выработкам: при импорте читается обратно
      // (см. parsePositionsFile → branchIds), раньше не выгружалась и
      // связь «позиция ↔ выработка» терялась.
      txt((p.branchIds ?? []).join(" ")),
    ].join(sep));
  }

  const join = (l: string[]) => l.join("\r\n") + "\r\n";
  return {
    "nodes.csv": join(nodeLines),
    "excavations.csv": join(excLines),
    "bulkheads.csv": join(bkLines),
    "fans.csv": join(fanLines),
    "positions.csv": join(posLines),
  };
}

// Упаковка набора файлов в ZIP и скачивание (для «Вентиляция 2.0» и «АэроСеть»).
export async function downloadCsvZip(
  files: Record<string, string> | Vent2Files | AeroSetFiles,
  zipName: string,
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const bom = "\uFEFF"; // UTF-8 BOM — кириллица корректно читается
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, bom + content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName.endsWith(".zip") ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Обратная совместимость: экспорт «Вентиляция 2.0» через общий упаковщик.
export async function downloadVent2Zip(files: Vent2Files, zipName: string): Promise<void> {
  return downloadCsvZip(files as unknown as Record<string, string>, zipName);
}
