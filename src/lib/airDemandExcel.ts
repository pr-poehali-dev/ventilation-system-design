// ─────────────────────────────────────────────────────────────────────────────
// airDemandExcel.ts — выгрузка сводного расчёта количества воздуха в Excel.
// Лист 1 «Расчёт» — забои, сгруппированные по участкам, с итогами.
// Лист 2 «Нормы»  — применённые нормы (ФНиП № 505), чтобы отчёт был проверяемым.
// ─────────────────────────────────────────────────────────────────────────────

import { FACTOR_LABEL, type AirDemandResult, type FaceDemand } from "./airDemand";
import { FACE_TYPE_LABEL, type FaceType, type VentNorms } from "./ventSections";

const HEADERS = [
  "№", "Выработка", "Наименование забоя", "Тип забоя",
  "S, м²", "L, м",
  "По людям", "По газам ВР", "По дизелю", "По v_min",
  "Определяющий", "Расчётная", "K_зап", "K_ут", "Потребность",
  "Фактически", "v, м/с", "Заключение",
];

/** Ширины колонок под содержимое */
const WIDTHS = [5, 13, 24, 20, 8, 8, 10, 12, 10, 10, 15, 11, 7, 7, 13, 11, 8, 30];

const BORDER_THIN = {
  top:    { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  left:   { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin" as const, color: { argb: "FFD1D5DB" } },
  right:  { style: "thin" as const, color: { argb: "FFD1D5DB" } },
};

export async function exportAirDemandXlsx(
  result: AirDemandResult,
  norms: VentNorms,
  projectName: string,
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const wb = new ExcelJS.default.Workbook();
  wb.creator = "ПВ-Система";
  wb.created = new Date();

  const ws = wb.addWorksheet("Расчёт воздуха", { views: [{ showGridLines: false, state: "frozen", ySplit: 5 }] });
  ws.columns = WIDTHS.map(w => ({ width: w }));

  const lastCol = String.fromCharCode(64 + HEADERS.length); // R

  // ── Заголовок отчёта ──
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell("A1");
  t.value = "РАСЧЁТ КОЛИЧЕСТВА ВОЗДУХА ПО РУДНИКУ";
  t.font = { name: "Arial", size: 15, bold: true, color: { argb: "FF1E3A5F" } };
  t.alignment = { horizontal: "center", vertical: "middle" };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FB" } };
  ws.getRow(1).height = 32;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell("A2");
  s.value = `${projectName}  |  ${new Date().toLocaleDateString("ru-RU")}  |  забоев: ${result.faces.length}  ·  участков: ${result.sections.length}`;
  s.font = { name: "Arial", size: 10, color: { argb: "FF475569" } };
  s.alignment = { horizontal: "center" };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F6FF" } };

  ws.mergeCells(`A3:${lastCol}3`);
  const n = ws.getCell("A3");
  n.value = "Расчёт выполнен позабойно с суммированием по участкам — ФНиП № 505 (приказ Ростехнадзора от 08.12.2020), п. 155. "
    + "Потребность определена по каждому фактору отдельно, в зачёт принят максимум.";
  n.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF64748B" } };
  n.alignment = { horizontal: "center", wrapText: true };
  ws.getRow(3).height = 24;

  // ── Шапка таблицы ──
  const headRow = ws.getRow(5);
  HEADERS.forEach((h, i) => {
    const c = headRow.getCell(i + 1);
    c.value = h;
    c.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = BORDER_THIN;
  });
  headRow.height = 30;

  // Подпись единиц под шапкой
  const unitRow = ws.getRow(6);
  ["", "", "", "", "", "", "м³/с", "м³/с", "м³/с", "м³/с", "", "м³/с", "", "", "м³/с", "м³/с", "", ""]
    .forEach((u, i) => {
      const c = unitRow.getCell(i + 1);
      c.value = u;
      c.font = { name: "Arial", size: 8, italic: true, color: { argb: "FF64748B" } };
      c.alignment = { horizontal: "center" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      c.border = BORDER_THIN;
    });

  let row = 7;
  let idx = 1;

  // Строка забоя
  const writeFace = (f: FaceDemand) => {
    const r = ws.getRow(row);
    const vals: (string | number)[] = [
      idx++,
      f.branchId,
      f.name,
      FACE_TYPE_LABEL[f.faceType as FaceType] ?? f.faceType,
      f.area, f.length,
      f.byPeople || "", f.byBlast || "", f.byDiesel || "", f.byVMin || "",
      FACTOR_LABEL[f.factor],
      f.base,
      f.reserveFactor, f.leakFactor,
      f.total,
      f.actualFlow,
      f.actualVelocity,
      f.verdict + (f.recommendation ? ` — ${f.recommendation}` : ""),
    ];
    vals.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.font = { name: "Arial", size: 9 };
      c.border = BORDER_THIN;
      if (i >= 4 && i <= 9) { c.alignment = { horizontal: "right" }; c.numFmt = "0.00"; }
      else if (i >= 11 && i <= 16) { c.alignment = { horizontal: "right" }; c.numFmt = "0.00"; }
      else if (i === 0 || i === 1) c.alignment = { horizontal: "center" };
      else c.alignment = { horizontal: "left", wrapText: i === 17 };
    });

    // Подсветка колонки определяющего фактора
    const factorCol = { people: 7, blast: 8, diesel: 9, vmin: 10, none: 0 }[f.factor];
    if (factorCol) {
      const fc = r.getCell(factorCol);
      fc.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF1D4ED8" } };
      fc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
    }

    // Потребность — выделяем
    r.getCell(15).font = { name: "Arial", size: 9, bold: true };

    // Заключение: зелёный или красный
    const ok = f.flowOk && f.velocityOk;
    const vc = r.getCell(18);
    vc.font = { name: "Arial", size: 9, bold: !ok, color: { argb: ok ? "FF15803D" : "FFB91C1C" } };
    if (!ok) {
      r.getCell(16).font = { name: "Arial", size: 9, bold: true, color: { argb: "FFB91C1C" } };
      r.getCell(17).font = { name: "Arial", size: 9, bold: true, color: { argb: "FFB91C1C" } };
    }
    row++;
  };

  // Заголовок группы (участок)
  const writeGroupHeader = (title: string, color: string) => {
    ws.mergeCells(`A${row}:${lastCol}${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = title;
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF1E293B" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    c.alignment = { horizontal: "left", vertical: "middle" };
    c.border = BORDER_THIN;
    ws.getRow(row).height = 20;
    row++;
  };

  // Итог по группе
  const writeGroupTotal = (label: string, total: number, actual: number, failed: number) => {
    const r = ws.getRow(row);
    ws.mergeCells(`A${row}:N${row}`);
    const lc = ws.getCell(`A${row}`);
    lc.value = label;
    lc.font = { name: "Arial", size: 9, bold: true };
    lc.alignment = { horizontal: "right" };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    lc.border = BORDER_THIN;

    [15, 16].forEach((col, k) => {
      const c = r.getCell(col);
      c.value = k === 0 ? total : actual;
      c.numFmt = "0.00";
      c.font = { name: "Arial", size: 9, bold: true };
      c.alignment = { horizontal: "right" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      c.border = BORDER_THIN;
    });
    [17, 18].forEach(col => {
      const c = r.getCell(col);
      c.value = col === 18 ? (failed > 0 ? `не обеспечено забоев: ${failed}` : "обеспечено") : "";
      c.font = { name: "Arial", size: 9, bold: true, color: { argb: failed > 0 ? "FFB91C1C" : "FF15803D" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      c.border = BORDER_THIN;
    });
    row++;
  };

  // ── Забои по участкам ──
  for (const sec of result.sections) {
    writeGroupHeader(
      `Участок ${sec.number ? sec.number + ". " : ""}${sec.name}${sec.isReserve ? "  (резервный)" : ""}`,
      "FFDBEAFE",
    );
    sec.faces.forEach(writeFace);
    writeGroupTotal(`Итого по участку «${sec.name}»:`, sec.total, sec.actual, sec.failed);
    row++; // пустая строка
  }

  // ── Забои вне участков ──
  if (result.unassigned.length > 0) {
    writeGroupHeader("Забои вне участков", "FFFEF3C7");
    result.unassigned.forEach(writeFace);
    const ut = result.unassigned.reduce((a, f) => a + f.total, 0);
    const ua = result.unassigned.reduce((a, f) => a + f.actualFlow, 0);
    const uf = result.unassigned.filter(f => !f.flowOk && f.total > 0).length;
    writeGroupTotal("Итого вне участков:", +ut.toFixed(2), +ua.toFixed(2), uf);
    row++;
  }

  // ── Итог по руднику ──
  const tr = ws.getRow(row);
  ws.mergeCells(`A${row}:N${row}`);
  const tl = ws.getCell(`A${row}`);
  tl.value = "ВСЕГО ПО РУДНИКУ:";
  tl.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  tl.alignment = { horizontal: "right", vertical: "middle" };
  tl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };

  [15, 16].forEach((col, k) => {
    const c = tr.getCell(col);
    c.value = k === 0 ? result.totalDemand : result.totalActual;
    c.numFmt = "0.00";
    c.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { horizontal: "right" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  });
  [17, 18].forEach(col => {
    const c = tr.getCell(col);
    c.value = col === 18
      ? (result.failedCount > 0 ? `Не обеспечено забоев: ${result.failedCount}` : "Все забои обеспечены")
      : "";
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  });
  tr.height = 24;
  row += 2;

  // Пояснение в подвале
  ws.mergeCells(`A${row}:${lastCol}${row}`);
  const foot = ws.getCell(`A${row}`);
  foot.value = "Потребность = максимум по факторам × K_зап × K_ут (для резервных забоев — с понижающей долей). "
    + "«Фактически» — расход по результатам расчёта вентиляционной сети.";
  foot.font = { name: "Arial", size: 8, italic: true, color: { argb: "FF64748B" } };
  foot.alignment = { horizontal: "left", wrapText: true };

  // ── Лист «Нормы» — чтобы отчёт можно было проверить ──
  const wn = wb.addWorksheet("Нормы", { views: [{ showGridLines: false }] });
  wn.columns = [{ width: 52 }, { width: 14 }, { width: 18 }];

  wn.mergeCells("A1:C1");
  const nt = wn.getCell("A1");
  nt.value = "ПРИМЕНЁННЫЕ НОРМЫ РАСХОДА ВОЗДУХА";
  nt.font = { name: "Arial", size: 13, bold: true, color: { argb: "FF1E3A5F" } };
  nt.alignment = { horizontal: "center", vertical: "middle" };
  nt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FB" } };
  wn.getRow(1).height = 28;

  const normRows: [string, number | string, string][] = [
    ["Расход воздуха на одного человека", norms.airPerPerson, "м³/мин"],
    ["Газовыделение при взрывании по углю", norms.gasPerKgCoal, "л на 1 кг ВВ"],
    ["Газовыделение при взрывании по породе", norms.gasPerKgRock, "л на 1 кг ВВ"],
    ["Время проветривания после взрыва", norms.blastVentTime, "мин"],
    ["Коэффициент обводнённости", norms.wateringFactor, ""],
    ["ПДК условного оксида углерода", norms.coLimit, "%"],
    ["Норма подачи на единицу мощности ДВС", norms.airPerKwDiesel, "м³/мин на кВт"],
    ["Коэффициент одновременности: 1 машина", norms.simult1, ""],
    ["Коэффициент одновременности: 2 машины", norms.simult2, ""],
    ["Коэффициент одновременности: 3 и более", norms.simult3, ""],
    ["Минимальная скорость в очистных и подготовительных", norms.vMinFace, "м/с"],
    ["Минимальная скорость в прочих выработках", norms.vMinOther, "м/с"],
    ["Максимальная скорость в выработках", norms.vMaxDrift, "м/с"],
    ["Максимальная скорость в стволах с подъёмом людей", norms.vMaxShaft, "м/с"],
    ["Общий коэффициент запаса", norms.reserveFactor, ""],
    ["Общий коэффициент утечек", norms.leakFactor, ""],
    ["Доля потребности для резервных забоев", norms.reserveShare, ""],
  ];

  let nr = 3;
  normRows.forEach(([label, value, unit]) => {
    const r = wn.getRow(nr);
    r.getCell(1).value = label;
    r.getCell(2).value = value;
    r.getCell(3).value = unit;
    r.getCell(1).font = { name: "Arial", size: 9 };
    r.getCell(2).font = { name: "Arial", size: 9, bold: true };
    r.getCell(2).alignment = { horizontal: "right" };
    r.getCell(3).font = { name: "Arial", size: 9, color: { argb: "FF64748B" } };
    [1, 2, 3].forEach(c => { r.getCell(c).border = BORDER_THIN; });
    nr++;
  });

  wn.mergeCells(`A${nr + 1}:C${nr + 1}`);
  const nf = wn.getCell(`A${nr + 1}`);
  nf.value = "Нормативная база: ФНиП «Правила безопасности при ведении горных работ и переработке твёрдых полезных ископаемых», "
    + "приказ Ростехнадзора № 505 от 08.12.2020.";
  nf.font = { name: "Arial", size: 8, italic: true, color: { argb: "FF64748B" } };
  nf.alignment = { wrapText: true };

  // ── Скачивание ──
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "расчёт-количества-воздуха.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
