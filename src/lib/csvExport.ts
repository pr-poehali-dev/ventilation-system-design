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

import { type TopoNode, type TopoBranch } from "@/lib/topology";
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
function branchResistance(b: TopoBranch, units: CsvExportUnits): number {
  // resistance хранится в Н·с²/м⁸; перемычка (bulkheadR, кМюрг) добавляется отдельно.
  const rNsm8 = b.resistance ?? 0;
  const kmu = rNsm8 / 9.81e-3;
  return units.resistanceUnit === "kmu" ? kmu : rNsm8;
}

// ── Основной построитель CSV ─────────────────────────────────────────────────
export function buildCsv(
  nodes: TopoNode[],
  branches: TopoBranch[],
  positions: Position[],
  opts: CsvExportOptions,
): string {
  const { sep, decimal, fields: f, units: u } = opts;
  const rows: string[] = [];
  const row = (...cells: (string | number)[]) => rows.push(cells.map(c =>
    typeof c === "number" ? fmtNum(c, decimal) : esc(c, sep, decimal)).join(sep));
  const raw = (s: string) => rows.push(s);

  const isVent2 = opts.schema === "vent2";

  // ── Секция ВЕРШИНЫ ──────────────────────────────────────────────────────────
  raw(isVent2 ? "# Вершины" : "# Nodes");
  {
    const head: string[] = [];
    if (f.nodeId)  head.push("ID вершины");
    if (f.nodeX)   head.push("X");
    if (f.nodeY)   head.push("Y");
    if (f.nodeZ)   head.push("Z");
    if (f.nodeAtm) head.push("Атмосфера");
    raw(head.join(sep));
    for (const n of nodes) {
      const cells: (string | number)[] = [];
      if (f.nodeId)  cells.push(esc(n.id, sep, decimal));
      if (f.nodeX)   cells.push(fmtNum((n.x ?? 0) * u.coord, decimal));
      if (f.nodeY)   cells.push(fmtNum((n.y ?? 0) * u.coord, decimal));
      if (f.nodeZ)   cells.push(fmtNum((n.z ?? 0) * u.coord, decimal));
      if (f.nodeAtm) cells.push(n.atmosphereLink ? "Да" : "Нет");
      raw(cells.join(sep));
    }
  }
  raw("");

  // ── Секция ВЫРАБОТКИ ────────────────────────────────────────────────────────
  raw(isVent2 ? "# Выработки" : "# Excavations");
  {
    const head: string[] = [];
    if (f.brId)         head.push("ID выработки");
    if (f.brFrom)       head.push("Начальная вершина");
    if (f.brTo)         head.push("Конечная вершина");
    if (f.brName)       head.push("Название");
    if (f.brLength)     head.push("Длина");
    if (f.brType)       head.push("Тип");
    if (f.brArea)       head.push("Сечение");
    if (f.brPerimeter)  head.push("Периметр");
    if (f.brFlow)       head.push("Расход");
    if (f.brResistance) head.push("Сопротивление");
    if (f.brLayer)      head.push("Слой");
    if (f.brPositionId) head.push("Ид позиции");
    raw(head.join(sep));

    // Карта: branchId → id позиции (первой привязанной)
    const branchToPos = new Map<string, string>();
    for (const p of positions) {
      for (const bid of (p.branchIds ?? [])) {
        if (!branchToPos.has(bid)) branchToPos.set(bid, p.id);
      }
    }

    for (const b of branches) {
      const cells: (string | number)[] = [];
      if (f.brId)         cells.push(esc(b.id, sep, decimal));
      if (f.brFrom)       cells.push(esc(b.fromId, sep, decimal));
      if (f.brTo)         cells.push(esc(b.toId, sep, decimal));
      if (f.brName)       cells.push(esc(b.type || "", sep, decimal));
      if (f.brLength)     cells.push(fmtNum((b.length ?? 0) * u.length, decimal, 2));
      if (f.brType)       cells.push(esc(b.shape || "", sep, decimal));
      if (f.brArea)       cells.push(fmtNum((b.area ?? 0) * u.area, decimal));
      if (f.brPerimeter)  cells.push(fmtNum((b.perimeter ?? 0) * u.perimeter, decimal));
      if (f.brFlow)       cells.push(fmtNum((b.flow ?? 0) * u.flow, decimal));
      if (f.brResistance) cells.push(fmtNum(branchResistance(b, u), decimal, 6));
      if (f.brLayer)      cells.push(esc(b.layer || "", sep, decimal));
      if (f.brPositionId) cells.push(esc(branchToPos.get(b.id) ?? "", sep, decimal));
      raw(cells.join(sep));
    }
  }
  raw("");

  // ── Секция ПОЗИЦИИ ──────────────────────────────────────────────────────────
  if (f.exportPositions && positions.length > 0) {
    raw(isVent2 ? "# Позиции" : "# Positions");
    raw(["ID позиции", "X", "Y", "Z", "Номер позиции", "Название позиции", "Тип позиции", "Цвет границы"].join(sep));
    for (const p of positions) {
      raw([
        esc(p.id, sep, decimal),
        fmtNum((p.x ?? 0) * u.coord, decimal),
        fmtNum((p.y ?? 0) * u.coord, decimal),
        fmtNum((p.z ?? 0) * u.coord, decimal),
        String(p.number ?? ""),
        esc(p.name || "", sep, decimal),
        p.positionType === "reverse" ? "Реверсивная" : "Безреверсивная",
        esc(p.borderColor || "", sep, decimal),
      ].join(sep));
    }
    raw("");
  }

  // ── Секция ПЕРЕМЫЧКИ ────────────────────────────────────────────────────────
  if (f.exportBulkheads) {
    const withBk = branches.filter(b => b.hasBulkhead);
    if (withBk.length > 0) {
      raw(isVent2 ? "# Перемычки" : "# Bulkheads");
      raw(["Ид выработки", "Смещение, %", "Тип перемычки", "Сопротивление"].join(sep));
      for (const b of withBk) {
        // bulkheadR хранится в кМюрг → при "si" переводим в Н·с²/м⁸.
        const rKmu = b.bulkheadR ?? 0;
        const rOut = u.resistanceUnit === "kmu" ? rKmu : rKmu * 9.81e-3;
        raw([
          esc(b.id, sep, decimal),
          "50",
          esc(b.bulkheadName || "Перемычка", sep, decimal),
          fmtNum(rOut, decimal, 6),
        ].join(sep));
      }
      raw("");
    }
  }

  // ── Секция ИСТОЧНИКИ ТЯГИ (вентиляторы) ──────────────────────────────────────
  if (f.exportFans) {
    const withFan = branches.filter(b => b.hasFan);
    if (withFan.length > 0) {
      raw(isVent2 ? "# Источники тяги" : "# Fans");
      raw(["Ид выработки", "Смещение, %", "Напор"].join(sep));
      for (const b of withFan) {
        raw([
          esc(b.id, sep, decimal),
          "50",
          fmtNum((b.fanPressure ?? 0) * u.pressure, decimal, 2),
        ].join(sep));
      }
      raw("");
    }
  }

  // BOM для корректного открытия кириллицы в Excel.
  return rows.join("\r\n");
}

// Скачивание файла в браузере.
export function downloadCsv(content: string, filename: string): void {
  const bom = "\uFEFF"; // UTF-8 BOM — кириллица в Excel/АэроСеть
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
