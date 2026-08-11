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
  "Тепловая депрессия h_т, Па",
  "Критическая депрессия h_кр, Па",
  // Запас до опрокидывания заполняется только для НИСХОДЯЩИХ выработок:
  // восходящая струя опрокинуться не может (тепловая депрессия по потоку).
  "Запас до опрокидывания, Па",
  "Показатель устойчивости p_у",
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
  ws["!cols"] = Array.from({ length: TABLE_HEADERS.length }, () => ({ wch: 10 }));
  // Объединения заголовков АКТ (строки 9-14 в 1-based → индексы 8-13)
  ws["!merges"] = [
    { s: { r: 8, c: 0 }, e: { r: 8, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 9, c: 0 }, e: { r: 9, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 10, c: 0 }, e: { r: 10, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 11, c: 0 }, e: { r: 11, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 12, c: 0 }, e: { r: 12, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 13, c: 0 }, e: { r: 13, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 15, c: 0 }, e: { r: 15, c: TABLE_HEADERS.length - 1 } },
    { s: { r: 16, c: 0 }, e: { r: 16, c: TABLE_HEADERS.length - 1 } },
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
      r.velocityNormal, // скорость движения (до пожара)
      r.flowNormal,     // расход воздуха (до пожара)
      r.velocity,       // скорость при пожаре
      r.flow,           // расход при пожаре
      r.firePower_MW,
      r.fireTemp_C,
      r.thermalDep_Pa,
      r.hKr_Pa != null ? r.hKr_Pa : "—",
      // Запас до опрокидывания: h_кр − h_т. Отрицательное значение печатаем со
      // знаком «−» — видно, на сколько паскалей порог уже перекрыт.
      r.marginDep_Pa != null ? r.marginDep_Pa : "—",
      r.p_u != null ? r.p_u : "—",
      r.stability,
      r.fireLoadDesc,
    ]);
  });

  if (rows.length === 0) {
    aoa.push(TABLE_HEADERS.map((_, i) => (i === 3 ? "Нет ветвей, удовлетворяющих условиям отбора" : "")));
  }

  // ── Приложение 7: расшифровка критического расхода Q₀ (восходящие) ────────
  // Норматив даёт два ориентировочных способа: (7.3) Q₀ = Q₁ + 0,03·h₁ и
  // (7.4) Q₀ = Q·a (a — таблица 7.1). Печатаем оба и принятое значение, чтобы
  // проверяющий видел ход расчёта, а не только итог.
  const isAscending = cat === "ascending-incline" || cat === "ascending-vertical";
  const withQ0 = rows.filter(r => r.Q0_m3s != null);
  if (isAscending && withQ0.length > 0) {
    aoa.push([]);
    aoa.push(["Приложение 7. Критический расход воздуха Q₀ и условие устойчивости (7.1): h_т < R·Q₀²"]);
    aoa.push([
      "№ ветви", "Наименование выработки",
      "Q₁ (до пожара), м³/с", "h₁, Па", "R, Н·с²/м⁸",
      "a (табл. 7.1)",
      "Q₀ по (7.3), м³/с", "Q₀ по (7.4), м³/с",
      "Q₀ принят, м³/с", "Формула",
      "Удерж. депрессия R·Q₀², Па", "h_т, Па",
      "R_р по (7.5)", "R_доп по (7.6)",
    ]);
    withQ0.forEach(r => {
      aoa.push([
        r.branchNumber, r.name,
        r.flowNormal, r.branchDep_Pa, r.R_fact != null ? r.R_fact : "—",
        r.Q0_a != null ? r.Q0_a : "—",
        r.Q0_73 != null ? r.Q0_73 : "—",
        r.Q0_74 != null ? r.Q0_74 : "—",
        r.Q0_m3s != null ? r.Q0_m3s : "—",
        r.Q0_source ?? "—",
        r.hKr_Pa != null ? r.hKr_Pa : "—",
        r.thermalDep_Pa,
        r.R_calc != null ? r.R_calc : "—",
        r.R_dop != null ? r.R_dop : "не требуется",
      ]);
    });
    aoa.push([]);
    aoa.push(["Примечание: Q₀ определён двумя ориентировочными способами норматива; принято меньшее значение"]);
    aoa.push(["как более строгая оценка (Q₀ входит в условие 7.1 в квадрате). Основная формула (7.2) требует"]);
    aoa.push(["данных натурных замеров депрессии и расхода до и после изменения сопротивления выработки."]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Ширины колонок
  ws["!cols"] = [
    { wch: 6 }, { wch: 9 }, { wch: 9 }, { wch: 26 }, { wch: 10 }, { wch: 9 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 18 }, { wch: 40 },
  ];
  // Объединение вводной строки
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: TABLE_HEADERS.length - 1 } }];
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

// ─── Лист «Мероприятия» ──────────────────────────────────────────────────────
function buildMeasuresSheet(result: StabilityResult): XLSX.WorkSheet {
  const unstable = result.rows.filter(r => !r.stable);
  const aoa: (string | number)[][] = [];
  aoa.push(["Мероприятия по обеспечению устойчивости проветривания при пожаре"]);
  aoa.push([]);

  if (unstable.length === 0) {
    aoa.push(["По результатам проверки все горные выработки с наклоном 5° и более сохраняют"]);
    aoa.push(["устойчивое проветривание при пожаре. Дополнительные мероприятия не требуются."]);
  } else {
    aoa.push(["Для выработок с риском опрокидывания вентиляционной струи предусмотреть:"]);
    aoa.push([]);
    aoa.push(["№", "№ ветви", "Наименование выработки", "Мероприятие"]);
    unstable.forEach((r, i) => {
      // Для восходящих выработок норматив (Прил. 7, ф. 7.6) даёт конкретное
      // мероприятие: перемычка ниже очага с сопротивлением не менее R_доп.
      const measure = r.R_dop != null
        ? `Установить в 10–15 м ниже очага пожара перемычку с аэродинамическим сопротивлением не менее ${r.R_dop} Н·с²/м⁸ (расчётное R_р = ${r.R_calc}, фактическое R = ${r.R_fact} Н·с²/м⁸)`
        : "Установка автоматических пожарных дверей / реверсирование ВГП / секционирование вентиляции для предотвращения опрокидывания струи";
      aoa.push([i + 1, r.branchNumber, r.name, measure]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 30 }, { wch: 70 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 11 } };
  if (unstable.length > 0) {
    ["A5", "B5", "C5", "D5"].forEach(ref => { if (ws[ref]) ws[ref].s = headerStyle(); });
    unstable.forEach((_, i) => {
      for (let c = 0; c < 4; c++) {
        const ref = XLSX.utils.encode_cell({ r: i + 5, c });
        if (ws[ref]) ws[ref].s = cellStyle(i);
      }
    });
  }
  return ws;
}

// ─── Лист «Выводы» ────────────────────────────────────────────────────────────
function buildConclusionsSheet(result: StabilityResult): XLSX.WorkSheet {
  const total = result.rows.length;
  const unstable = result.totalUnstable;
  const stable = total - unstable;
  const descIncl = result.byCategory["descending-incline"].length;
  const descVert = result.byCategory["descending-vertical"].length;
  const ascIncl  = result.byCategory["ascending-incline"].length;
  const ascVert  = result.byCategory["ascending-vertical"].length;

  const aoa: string[][] = [];
  aoa.push(["ВЫВОДЫ"]);
  aoa.push([]);
  aoa.push([`1. Проверке подлежало ${total} горных выработок с углом наклона ${result.angleFilter}° и более`]);
  aoa.push([`   и длиной ${result.lengthFilter} м и более, имеющих пожарную нагрузку, в том числе:`]);
  aoa.push([`   • наклонные с нисходящим проветриванием — ${descIncl};`]);
  aoa.push([`   • вертикальные с нисходящим проветриванием — ${descVert};`]);
  aoa.push([`   • наклонные с восходящим проветриванием — ${ascIncl};`]);
  aoa.push([`   • вертикальные с восходящим проветриванием — ${ascVert}.`]);
  aoa.push([]);
  aoa.push([`2. Устойчивое проветривание при пожаре сохраняют ${stable} из ${total} выработок.`]);
  if (unstable > 0) {
    aoa.push([`3. Выявлено ${unstable} выработок с риском самопроизвольного опрокидывания`]);
    aoa.push([`   вентиляционной струи. Для них разработаны мероприятия (см. лист «Мероприятия»).`]);
    if (result.totalVeryUnstable > 0) {
      aoa.push([`   Из них ${result.totalVeryUnstable} отнесены к весьма неустойчивым по направлению`]);
      aoa.push([`   вентиляционных струй (показатель устойчивости p_у < 0,3).`]);
    }
  } else {
    aoa.push([`3. Выработок с риском опрокидывания вентиляционной струи не выявлено.`]);
    aoa.push([`   Принятые проектные решения обеспечивают устойчивость проветривания при пожаре.`]);
  }
  aoa.push([]);
  aoa.push([`Температура наружного воздуха, принятая в расчёте: ${result.ambientTemp} °C.`]);
  aoa.push([`Расчёт выполнен в программном обеспечении «ПВ-Система».`]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 100 }];
  const t = XLSX.utils.encode_cell({ r: 0, c: 0 });
  if (ws[t]) ws[t].s = { font: { bold: true, sz: 12 } };
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

  XLSX.utils.book_append_sheet(wb, buildMeasuresSheet(result), "Мероприятия");
  XLSX.utils.book_append_sheet(wb, buildConclusionsSheet(result), "Выводы");

  const date = new Date().toISOString().slice(0, 10);
  const filename = `Акт_устойчивости_${m.projectName || "рудник"}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}