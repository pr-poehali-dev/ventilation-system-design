// ─────────────────────────────────────────────────────────────────────────────
// waterCheckExport.ts — «Акт проверки пожарно-оросительного трубопровода»
// в Excel (.xlsx). Структура по образцу Акта устойчивости (stabilityActExport):
//   • Титул — шапка акта
//   • «Проверка точек» — таблица по всем пожарным кранам
//   • «Мероприятия» — что сделать по несоответствующим точкам
//   • «Выводы» — итог проверки
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { WaterCheckResult, WaterCheckRow } from "./waterFireCheck";

export interface WaterActMeta {
  projectName: string;
  orgName: string;
  approverTitle: string;
  approverName: string;
  period: string;
  date: string;
}

const DEFAULT_META: WaterActMeta = {
  projectName: "Подземный рудник",
  orgName: "",
  approverTitle: "Главный инженер",
  approverName: "",
  period: "II полугодие 2026 г.",
  date: new Date().toLocaleDateString("ru-RU"),
};

const TABLE_HEADERS = [
  "№ п/п",
  "№ узла",
  "Наименование точки",
  "Тип ствола",
  "Диаметр насадка, мм",
  "Отметка, м",
  "Напор у крана, МПа",
  "Потери напора, МПа",
  "Расход, м³/ч",
  "Требуемый расход, м³/ч",
  "Дефицит напора, МПа",
  "Дефицит расхода, м³/ч",
  "Время работы, мин",
  "Макс. скорость воды, м/с",
  "Результат проверки",
  "Рекомендация",
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

function cellStyle(rowIdx: number, bad = false): XLSX.CellStyle {
  return {
    font: { sz: 9, color: { rgb: bad ? "9C0006" : "000000" }, bold: bad },
    fill: { fgColor: { rgb: bad ? "FFC7CE" : (rowIdx % 2 === 0 ? "FFFFFF" : "F2F5FB") }, patternType: "solid" },
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
function buildTitleSheet(meta: WaterActMeta, result: WaterCheckResult): XLSX.WorkSheet {
  const n = result.norms;
  const rows: string[][] = [
    ["", "", "", "", "", "", "", "", "", "", "", "УТВЕРЖДАЮ:"],
    ["", "", "", "", "", "", "", "", "", "", "", meta.approverTitle],
    ["", "", "", "", "", "", "", "", "", "", "", meta.orgName],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", `_______________ ${meta.approverName}`],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", `«____»___________ ${new Date().getFullYear()} г.`],
    [""],
    ["АКТ"],
    ["проверки пожарно-оросительного трубопровода на обеспеченность пожаротушения"],
    [`«${meta.projectName}» ${meta.orgName}`],
    ["с определением напора и расхода воды в точках водоразбора"],
    [`(к ПМЛЛПА на ${meta.period})`],
    [""],
    ["Проверка выполнена гидравлическим расчётом сети противопожарного водоснабжения"],
    [`рудника «${meta.projectName}» с использованием программного обеспечения «ПВ-Система».`],
    [""],
    ["Нормативные требования, принятые в расчёте:"],
    [`   • минимальный свободный напор у пожарного крана — ${n.minPressure} МПа;`],
    [`   • максимальный допустимый напор у пожарного крана — ${n.maxPressure} МПа;`],
    [`   • минимальный расход воды через ствол — ${n.minFlow} м³/ч;`],
    [`   • минимальное время работы от запаса воды — ${n.minDuration} мин;`],
    [`   • количество одновременно работающих стволов — ${n.simultaneous};`],
    [`   • максимальная скорость воды в трубопроводе — ${n.maxVelocity} м/с.`],
    [""],
    [`Дата: ${meta.date}`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = Array.from({ length: TABLE_HEADERS.length }, () => ({ wch: 11 }));
  ws["!merges"] = [8, 9, 10, 11, 12, 14, 15].map(r => ({
    s: { r, c: 0 }, e: { r, c: TABLE_HEADERS.length - 1 },
  }));
  [8, 9, 10, 11, 12].forEach(r => {
    const ref = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[ref]) ws[ref].s = titleStyle();
  });
  return ws;
}

// ─── Лист с таблицей проверки ────────────────────────────────────────────────
function buildTableSheet(result: WaterCheckResult): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [];
  aoa.push(["Результаты проверки точек водоразбора пожарно-оросительного трубопровода"]);
  aoa.push([]);
  aoa.push([...TABLE_HEADERS]);

  result.rows.forEach(r => {
    aoa.push([
      r.index,
      r.nodeNumber,
      r.nodeName || r.description || "—",
      r.consumerName || "—",
      r.outletDiameter > 0 ? r.outletDiameter : "—",
      r.elevation,
      r.pressure,
      r.pressureLoss,
      r.flow,
      r.requiredFlow,
      r.pressureDeficit > 0 ? r.pressureDeficit : "—",
      r.flowDeficit > 0 ? r.flowDeficit : "—",
      r.duration > 0 ? r.duration : "—",
      r.maxVelocity,
      r.verdict,
      r.recommendation || "—",
    ]);
  });

  if (result.rows.length === 0) {
    aoa.push(TABLE_HEADERS.map((_, i) => (i === 2 ? "Точек водоразбора в схеме не найдено" : "")));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 6 }, { wch: 9 }, { wch: 26 }, { wch: 26 }, { wch: 11 }, { wch: 9 },
    { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 13 },
    { wch: 12 }, { wch: 13 }, { wch: 22 }, { wch: 46 },
  ];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: TABLE_HEADERS.length - 1 } }];
  ws["!rows"] = [{ hpx: 28 }, { hpx: 8 }, { hpx: 46 }];

  const titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleRef]) ws[titleRef].s = { font: { bold: true, sz: 10 }, alignment: { wrapText: true, vertical: "center" } };

  TABLE_HEADERS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 2, c: ci });
    if (ws[ref]) ws[ref].s = headerStyle();
  });

  result.rows.forEach((r, ri) => {
    for (let ci = 0; ci < TABLE_HEADERS.length; ci++) {
      const ref = XLSX.utils.encode_cell({ r: ri + 3, c: ci });
      if (ws[ref]) ws[ref].s = cellStyle(ri, !r.ok);
    }
  });

  ws["!freeze"] = { xSplit: 0, ySplit: 3 };
  return ws;
}

// ─── Лист «Мероприятия» ──────────────────────────────────────────────────────
function buildMeasuresSheet(result: WaterCheckResult): XLSX.WorkSheet {
  const bad: WaterCheckRow[] = result.rows.filter(r => !r.ok);
  const aoa: (string | number)[][] = [];
  aoa.push(["Мероприятия по обеспечению нормативных параметров пожаротушения"]);
  aoa.push([]);

  if (bad.length === 0) {
    aoa.push(["По результатам проверки все точки водоразбора обеспечены нормативным напором,"]);
    aoa.push(["расходом воды и запасом на нормативное время тушения."]);
    aoa.push(["Дополнительные мероприятия не требуются."]);
  } else {
    aoa.push(["Для точек водоразбора, не отвечающих нормативным требованиям, предусмотреть:"]);
    aoa.push([]);
    aoa.push(["№", "№ узла", "Наименование точки", "Выявленное несоответствие", "Мероприятие"]);
    bad.forEach((r, i) => {
      aoa.push([i + 1, r.nodeNumber, r.nodeName || r.description || "—", r.verdict, r.recommendation || "—"]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 28 }, { wch: 30 }, { wch: 62 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 11 } };
  if (bad.length > 0) {
    ["A5", "B5", "C5", "D5", "E5"].forEach(ref => { if (ws[ref]) ws[ref].s = headerStyle(); });
    bad.forEach((_, i) => {
      for (let c = 0; c < 5; c++) {
        const ref = XLSX.utils.encode_cell({ r: i + 5, c });
        if (ws[ref]) ws[ref].s = cellStyle(i);
      }
    });
  }
  return ws;
}

// ─── Лист «Выводы» ────────────────────────────────────────────────────────────
function buildConclusionsSheet(result: WaterCheckResult): XLSX.WorkSheet {
  const total = result.total;
  const failed = result.failed;
  const ok = total - failed;
  const n = result.norms;

  const aoa: string[][] = [];
  aoa.push(["ВЫВОДЫ"]);
  aoa.push([]);
  aoa.push([`1. Проверке подлежало ${total} точек водоразбора пожарно-оросительного трубопровода.`]);
  aoa.push([`   Расчётный сценарий: одновременная работа ${n.simultaneous} ствол(ов).`]);
  aoa.push([]);
  aoa.push([`2. Нормативные параметры пожаротушения обеспечены в ${ok} из ${total} точек.`]);

  if (result.worst) {
    const w = result.worst;
    aoa.push([]);
    aoa.push([`3. Наиболее тяжёлая точка сети — узел № ${w.nodeNumber}${w.nodeName ? ` (${w.nodeName})` : ""}:`]);
    aoa.push([`   напор ${w.pressure} МПа при норме не менее ${n.minPressure} МПа,`]);
    aoa.push([`   расход ${w.flow} м³/ч при требуемом ${w.requiredFlow} м³/ч.`]);
    aoa.push([`   Именно эта точка определяет требуемые параметры насосного оборудования.`]);
  }

  aoa.push([]);
  if (failed > 0) {
    aoa.push([`4. Выявлено ${failed} точек, не отвечающих нормативным требованиям.`]);
    aoa.push([`   Для них разработаны мероприятия (см. лист «Мероприятия»).`]);
  } else {
    aoa.push([`4. Точек, не отвечающих нормативным требованиям, не выявлено.`]);
    aoa.push([`   Пожарно-оросительный трубопровод обеспечивает тушение пожара во всех точках сети.`]);
  }

  aoa.push([]);
  aoa.push([`Расчёт выполнен в программном обеспечении «ПВ-Система».`]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 100 }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 12 } };
  return ws;
}

// ─── Главная функция экспорта ────────────────────────────────────────────────
export function exportWaterCheckAct(result: WaterCheckResult, meta?: Partial<WaterActMeta>): void {
  const m = { ...DEFAULT_META, ...meta };
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildTitleSheet(m, result), "Титул");
  XLSX.utils.book_append_sheet(wb, buildTableSheet(result), "Проверка точек");
  XLSX.utils.book_append_sheet(wb, buildMeasuresSheet(result), "Мероприятия");
  XLSX.utils.book_append_sheet(wb, buildConclusionsSheet(result), "Выводы");

  const date = new Date().toISOString().slice(0, 10);
  const filename = `Акт_проверки_ППЗ_${m.projectName || "рудник"}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}
