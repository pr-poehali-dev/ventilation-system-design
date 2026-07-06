// ─────────────────────────────────────────────────────────────────────────────
// stabilityActExport.ts — Формирование «Акта проверки устойчивости вентиляционных
// режимов при пожаре» в Excel (.xlsx) по образцу (ориентир: ПО «АэроСеть»).
//
// Структура книги повторяет шаблон:
//   • Титул — шапка акта
//   • «нисх накл.», «нисх верт.», «восх накл.», «восх верт.» — таблицы устойчивости
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { StabilityResult, StabilityRow, StabilityCategory } from "./fireStability";

export interface ActMeta {
  projectName: string;   // название проекта/рудника
  orgName: string;       // организация
  approverTitle: string; // должность утверждающего
  approverName: string;  // ФИО утверждающего
  period: string;        // период действия
  date: string;          // дата акта (строка)
}

const DEFAULT_META: ActMeta = {
  projectName: "Подземный рудник",
  orgName: "",
  approverTitle: "Главный инженер",
  approverName: "",
  period: "II полугодие 2026 г.",
  date: new Date().toLocaleDateString("ru-RU"),
};

// Заголовки колонок таблицы устойчивости (как в образце)
const TABLE_HEADERS = [
  "№ п/п",
  "№ ветви",
  "Позиция",
  "Наименование ветви",
  "Угол наклона, град",
  "Длина, м",
  "Сечение, м²",
  "Скорость движения воздуха, м/с",
  "Расход воздуха в выработке, м³/сек",
  "Скорость при пожаре, м/с",
  "Расход при пожаре, м³/сек",
  "Расчётная мощность пожара, МВт",
  "Расчётная температура пожара, °C",
  "Степень устойчивости",
  "Пожарная нагрузка",
];

// Подпись листа + вводная строка над таблицей для каждой категории
const CATEGORY_META: Record<StabilityCategory, { sheet: string; title: string }> = {
  "descending-incline":  { sheet: "нисх накл.", title: "а) для наклонных выработок (с углом наклона 5° и более и длиной 30м. и более) с нисходящим проветриванием" },
  "descending-vertical": { sheet: "нисх верт.", title: "б) для вертикальных выработок с нисходящим проветриванием" },
  "ascending-incline":   { sheet: "восх накл.", title: "в) для наклонных выработок (с углом наклона 5° и более и длиной 30м. и более) с восходящим проветриванием" },
  "ascending-vertical":  { sheet: "восх верт.", title: "г) для вертикальных выработок с восходящим проветриванием" },
};

const CATEGORY_ORDER: StabilityCategory[] = [
  "descending-incline", "descending-vertical", "ascending-incline", "ascending-vertical",
];

// ─── Стили ───────────────────────────────────────────────────────────────────
function headerStyle(): XLSX.CellStyle {
  return {
    font: { bold: true, sz: 9, color: { rgb: "1F3864" } },
    fill: { fgColor: { rgb: "DCE6F1" }, patternType: "solid" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top:    { style: "thin", color: { rgb: "8EA9C1" } },
      bottom: { style: "thin", color: { rgb: "8EA9C1" } },
      left:   { style: "thin", color: { rgb: "8EA9C1" } },
      right:  { style: "thin", color: { rgb: "8EA9C1" } },
    },
  };
}

function cellStyle(rowIdx: number, unstable = false): XLSX.CellStyle {
  return {
    font: { sz: 9, color: { rgb: unstable ? "9C0006" : "000000" }, bold: unstable },
    fill: { fgColor: { rgb: unstable ? "FFC7CE" : (rowIdx % 2 === 0 ? "FFFFFF" : "F2F5FB") }, patternType: "solid" },
    alignment: { vertical: "center", wrapText: true },
    border: {
      top:    { style: "thin", color: { rgb: "D0D8E8" } },
      bottom: { style: "thin", color: { rgb: "D0D8E8" } },
      left:   { style: "thin", color: { rgb: "D0D8E8" } },
      right:  { style: "thin", color: { rgb: "D0D8E8" } },
    },
  };
}

function titleStyle(): XLSX.CellStyle {
  return { font: { bold: true, sz: 11 }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
}

// ─── Титульный лист ──────────────────────────────────────────────────────────
function buildTitleSheet(meta: ActMeta): XLSX.WorkSheet {
  const rows: (string)[][] = [
    ["", "", "", "", "", "", "", "", "", "", "", "УТВЕРЖДАЮ:"],
    ["", "", "", "", "", "", "", "", "", "", "", meta.approverTitle],
    ["", "", "", "", "", "", "", "", "", "", "", meta.orgName],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", `_______________ ${meta.approverName}`],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", `«____»___________ ${new Date().getFullYear()} г.`],
    [""],
    ["АКТ"],
    ["проверки устойчивости вентиляционных режимов в горных выработках"],
    [`«${meta.projectName}» ${meta.orgName} при воздействии тепловой депрессии`],
    ["и оценка эффективности принятых мер по предотвращению самопроизвольного опрокидывания"],
    ["вентиляционной струи при пожаре"],
    [`(к ПМЛЛПА на ${meta.period})`],
    [""],
    ["Определение устойчивости проветривания горных выработок производилось на основе топологии горных"],
    [`выработок рудника «${meta.projectName}» с использованием программного обеспечения «ПВ-Система».`],
    [`Дата: ${meta.date}`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = Array.from({ length: 15 }, () => ({ wch: 10 }));
  // Объединения заголовков АКТ (строки 9-14 в 1-based → индексы 8-13)
  ws["!merges"] = [
    { s: { r: 8, c: 0 }, e: { r: 8, c: 14 } },
    { s: { r: 9, c: 0 }, e: { r: 9, c: 14 } },
    { s: { r: 10, c: 0 }, e: { r: 10, c: 14 } },
    { s: { r: 11, c: 0 }, e: { r: 11, c: 14 } },
    { s: { r: 12, c: 0 }, e: { r: 12, c: 14 } },
    { s: { r: 13, c: 0 }, e: { r: 13, c: 14 } },
    { s: { r: 15, c: 0 }, e: { r: 15, c: 14 } },
    { s: { r: 16, c: 0 }, e: { r: 16, c: 14 } },
  ];
  // Стили заголовка АКТ
  [8, 9, 10, 11, 12, 13].forEach(r => {
    const ref = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[ref]) ws[ref].s = titleStyle();
  });
  return ws;
}

// ─── Лист с таблицей устойчивости ────────────────────────────────────────────
function buildTableSheet(cat: StabilityCategory, rows: StabilityRow[]): XLSX.WorkSheet {
  const meta = CATEGORY_META[cat];
  const aoa: (string | number)[][] = [];
  aoa.push([meta.title]);                 // строка 1 — вводная
  aoa.push([]);                           // пустая
  aoa.push([...TABLE_HEADERS]);           // строка 3 — заголовки

  rows.forEach(r => {
    aoa.push([
      r.index,
      r.branchNumber,
      r.position,
      r.name,
      r.angleDeg,
      r.length,
      r.area,
      r.velocity,
      r.flow,
      r.velocity,       // скорость при пожаре (в образце = обычной)
      r.flow,           // расход при пожаре
      r.firePower_MW,
      r.fireTemp_C,
      r.stability,
      r.fireLoadDesc,
    ]);
  });

  if (rows.length === 0) {
    aoa.push(["", "", "", "Нет ветвей, удовлетворяющих условиям отбора", "", "", "", "", "", "", "", "", "", "", ""]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Ширины колонок
  ws["!cols"] = [
    { wch: 6 }, { wch: 9 }, { wch: 9 }, { wch: 26 }, { wch: 10 }, { wch: 9 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 13 }, { wch: 14 }, { wch: 40 },
  ];
  // Объединение вводной строки
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }];
  // Высоты
  ws["!rows"] = [{ hpx: 30 }, { hpx: 8 }, { hpx: 46 }];

  // Стиль вводной строки
  const titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleRef]) ws[titleRef].s = { font: { bold: true, sz: 10 }, alignment: { wrapText: true, vertical: "center" } };

  // Стили заголовков (строка index 2)
  TABLE_HEADERS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 2, c: ci });
    if (ws[ref]) ws[ref].s = headerStyle();
  });

  // Стили данных
  rows.forEach((r, ri) => {
    for (let ci = 0; ci < TABLE_HEADERS.length; ci++) {
      const ref = XLSX.utils.encode_cell({ r: ri + 3, c: ci });
      if (ws[ref]) ws[ref].s = cellStyle(ri, !r.stable);
    }
  });

  // Закрепить заголовок
  ws["!freeze"] = { xSplit: 0, ySplit: 3 };
  return ws;
}

// ─── Главная функция экспорта ────────────────────────────────────────────────
export function exportStabilityAct(result: StabilityResult, meta?: Partial<ActMeta>): void {
  const m = { ...DEFAULT_META, ...meta };
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildTitleSheet(m), "Титул");

  CATEGORY_ORDER.forEach(cat => {
    const rows = result.byCategory[cat];
    const ws = buildTableSheet(cat, rows);
    XLSX.utils.book_append_sheet(wb, ws, CATEGORY_META[cat].sheet);
  });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `Акт_устойчивости_${m.projectName || "рудник"}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}
