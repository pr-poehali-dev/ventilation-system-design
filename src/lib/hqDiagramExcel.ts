// ─────────────────────────────────────────────────────────────────────────────
// hqDiagramExcel.ts — экспорт h–Q диаграммы пожара (Прил. 2) в Excel.
//
// Формирует .xlsx с НАСТОЯЩЕЙ диаграммой Excel (точечный график, chart1.xml),
// а не картинкой: в Excel её можно двигать, менять оси, подписи и цвета,
// а данные кривых лежат на листе и пересчитываются при правке.
//
// Готовые библиотеки (xlsx, exceljs) диаграммы не создают, поэтому пакет
// собирается вручную из XML-частей и упаковывается в zip.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";

export interface HQDiagramData {
  Ry: number;            // сопротивление уклонного поля, Н·с²/м⁸
  Qa: number;            // расход до пожара, м³/с
  Qb: number;            // расход при пожаре, м³/с
  hT: number;            // тепловая депрессия пожара, Па
  hKr?: number;          // критическая депрессия, Па
  pU?: number;           // показатель устойчивости
  reversed?: boolean;    // струя опрокинута
  ascending?: boolean;   // восходящее проветривание
}

// Экранирование текста для XML
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// Номер столбца → буква (1 → A)
const col = (n: number): string => {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
};

/** Точки кривых диаграммы для таблицы и графика */
function buildSeries(d: HQDiagramData) {
  const R = Math.max(1e-9, d.Ry);
  const absQa = Math.abs(d.Qa), absQb = Math.abs(d.Qb);
  const qMax = Math.max(absQa, absQb, 1) * 1.15;
  const qMin = d.ascending ? 0 : (d.reversed ? -Math.max(absQb, qMax * 0.4) * 1.1 : -qMax * 0.15);

  const N = 40;
  const rows: { q: number; net: number; activ: number; hT: number; hKr: number | null }[] = [];
  for (let i = 0; i <= N; i++) {
    const q = qMin + (i / N) * (qMax - qMin);
    rows.push({
      q: Math.round(q * 1000) / 1000,
      net: Math.round(R * q * q * 100) / 100,
      activ: Math.round((d.hT + R * q * q) * 100) / 100,
      hT: Math.round(d.hT * 100) / 100,
      hKr: d.hKr !== undefined && d.hKr > 0 ? Math.round(d.hKr * 100) / 100 : null,
    });
  }
  return rows;
}

/** Рабочие точки режимов (A, B/E, C, D) */
function buildPoints(d: HQDiagramData) {
  const R = Math.max(1e-9, d.Ry);
  const absQa = Math.abs(d.Qa), absQb = Math.abs(d.Qb);
  const pts: { name: string; q: number; h: number; note: string }[] = [];
  pts.push({ name: "A", q: absQa, h: R * absQa * absQa, note: "режим до пожара" });
  if (d.ascending) {
    pts.push({ name: "E", q: absQb, h: d.hT + R * absQb * absQb, note: "при пожаре (расход растёт)" });
    const Q0 = Math.sqrt(d.hT / R);
    pts.push({ name: "F", q: Q0, h: d.hT, note: "критическая: депрессия ВГП = 0" });
  } else {
    pts.push({ name: "B", q: d.reversed ? -absQb : absQb, h: d.hT + R * absQb * absQb, note: "при пожаре (расход падает)" });
    pts.push({ name: "C", q: 0, h: d.hKr ?? d.hT, note: "критический режим (Q = 0)" });
    if (d.reversed) pts.push({ name: "D", q: -absQb, h: d.hT + R * absQb * absQb, note: "опрокидывание струи" });
  }
  return pts.map(p => ({ ...p, q: Math.round(p.q * 1000) / 1000, h: Math.round(p.h * 100) / 100 }));
}

// ── XML-части пакета ─────────────────────────────────────────────────────────

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Диаграмма h-Q" sheetId="1" r:id="rId1"/>
<sheet name="Данные кривых" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><color rgb="FF991B1B"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
</cellXfs>
</styleSheet>`;

const SHEET1_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;

const DRAWING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:twoCellAnchor>
<xdr:from><xdr:col>0</xdr:col><xdr:colOff>76200</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>36</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Диаграмма h-Q"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>
</a:graphicData></a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>
</xdr:wsDr>`;

const DRAWING_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`;

/** Точечный ряд (линия) диаграммы */
function scatterSeries(
  idx: number, name: string, colorHex: string, dash: boolean,
  n: number, xCol: string, yCol: string,
): string {
  return `<c:ser>
<c:idx val="${idx}"/><c:order val="${idx}"/>
<c:tx><c:v>${esc(name)}</c:v></c:tx>
<c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill>${dash ? '<a:prstDash val="dash"/>' : ""}</a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:xVal><c:numRef><c:f>'Данные кривых'!$${xCol}$2:$${xCol}$${n + 1}</c:f></c:numRef></c:xVal>
<c:yVal><c:numRef><c:f>'Данные кривых'!$${yCol}$2:$${yCol}$${n + 1}</c:f></c:numRef></c:yVal>
<c:smooth val="0"/>
</c:ser>`;
}

/** Ряд рабочих точек (только маркеры) */
function pointSeries(idx: number, name: string, colorHex: string, row: number): string {
  return `<c:ser>
<c:idx val="${idx}"/><c:order val="${idx}"/>
<c:tx><c:v>${esc(name)}</c:v></c:tx>
<c:spPr><a:ln w="0"><a:noFill/></a:ln></c:spPr>
<c:marker><c:symbol val="circle"/><c:size val="9"/><c:spPr><a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>
<c:dLbls><c:dLblPos val="r"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="1"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>
<c:xVal><c:numRef><c:f>'Данные кривых'!$H$${row}</c:f></c:numRef></c:xVal>
<c:yVal><c:numRef><c:f>'Данные кривых'!$I$${row}</c:f></c:numRef></c:yVal>
<c:smooth val="0"/>
</c:ser>`;
}

function buildChartXml(d: HQDiagramData, nRows: number, points: ReturnType<typeof buildPoints>): string {
  const title = `Режим проветривания уклонного поля (h–Q, ${d.ascending ? "восходящее, рис. 2.2" : "нисходящее, рис. 2.1,б"})`;
  const series: string[] = [
    scatterSeries(0, "1: характеристика уклонного поля R·Q²", "0369A1", false, nRows, "A", "B"),
    scatterSeries(1, "3: активизированная характеристика h_т+R·Q²", "DC2626", true, nRows, "A", "C"),
    scatterSeries(2, `2: тепловая депрессия h_т = ${d.hT.toFixed(0)} Па`, "C2410C", true, nRows, "A", "D"),
  ];
  if (d.hKr !== undefined && d.hKr > 0) {
    series.push(scatterSeries(3, `критическая депрессия h_кр = ${d.hKr.toFixed(0)} Па`, "7C3AED", true, nRows, "A", "E"));
  }
  // Рабочие точки: строки 2.. в столбцах H/I листа данных
  const ptColors: Record<string, string> = { A: "0369A1", B: "DC2626", E: "DC2626", C: "7C3AED", F: "7C3AED", D: "450A0A" };
  points.forEach((p, i) => {
    series.push(pointSeries(series.length, `${p.name} — ${p.note}`, ptColors[p.name] ?? "444444", i + 2));
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="991B1B"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="ru-RU" sz="1200" b="1"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea>
<c:layout/>
<c:scatterChart>
<c:scatterStyle val="lineMarker"/>
<c:varyColors val="0"/>
${series.join("\n")}
<c:axId val="111111111"/><c:axId val="222222222"/>
</c:scatterChart>
<c:valAx>
<c:axId val="111111111"/>
<c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="b"/>
<c:majorGridlines/>
<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU" sz="1000"/><a:t>Расход воздуха Q, м³/с</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:numFmt formatCode="General" sourceLinked="0"/>
<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>
<c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/>
</c:valAx>
<c:valAx>
<c:axId val="222222222"/>
<c:scaling><c:orientation val="minMax"/></c:scaling>
<c:delete val="0"/><c:axPos val="l"/>
<c:majorGridlines/>
<c:title><c:tx><c:rich><a:bodyPr rot="-5400000" vert="horz"/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU" sz="1000"/><a:t>Депрессия h, Па</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:numFmt formatCode="General" sourceLinked="0"/>
<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>
<c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/>
</c:valAx>
<c:spPr><a:solidFill><a:srgbClr val="FAFAFA"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:ln></c:spPr>
</c:plotArea>
<c:legend><c:legendPos val="b"/><c:overlay val="0"/><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="ru-RU"/></a:p></c:txPr></c:legend>
<c:plotVisOnly val="1"/>
<c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

// ── Построение листов ────────────────────────────────────────────────────────

interface Cell { v: string | number; s?: number; str?: boolean }

function sheetXml(rows: Cell[][], extra = ""): string {
  const body = rows.map((cells, ri) => {
    const r = ri + 1;
    const cs = cells.map((c, ci) => {
      if (c.v === "" || c.v === null || c.v === undefined) return "";
      const ref = `${col(ci + 1)}${r}`;
      const st = c.s ? ` s="${c.s}"` : "";
      return typeof c.v === "number"
        ? `<c r="${ref}"${st}><v>${c.v}</v></c>`
        : `<c r="${ref}"${st} t="inlineStr"><is><t>${esc(String(c.v))}</t></is></c>`;
    }).join("");
    return `<row r="${r}">${cs}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${body}</sheetData>${extra}</worksheet>`;
}

/** Экспорт диаграммы в Excel (.xlsx) */
export async function exportHQDiagramToExcel(d: HQDiagramData, branchName?: string): Promise<void> {
  const rows = buildSeries(d);
  const points = buildPoints(d);

  // ── Лист 1: заголовок, сводка параметров и сама диаграмма ────────────────
  const s1: Cell[][] = [
    [{ v: "Диаграмма проветривания уклонного поля при пожаре (h–Q)", s: 2 }],
    [{ v: branchName ? `Выработка: ${branchName}` : "" }],
    [
      { v: "Параметр", s: 1 }, { v: "Значение", s: 1 }, { v: "Ед.", s: 1 },
      { v: "", s: 0 },
      { v: "Параметр", s: 1 }, { v: "Значение", s: 1 }, { v: "Ед.", s: 1 },
    ],
    [
      { v: "Сопротивление R", s: 3 }, { v: Math.round(d.Ry * 1e7) / 1e7, s: 3 }, { v: "кМюрг", s: 3 },
      { v: "" },
      { v: "Тепловая депрессия h_т", s: 3 }, { v: Math.round(d.hT * 10) / 10, s: 3 }, { v: "Па", s: 3 },
    ],
    [
      { v: "Расход до пожара Q_A", s: 3 }, { v: Math.round(Math.abs(d.Qa) * 100) / 100, s: 3 }, { v: "м³/с", s: 3 },
      { v: "" },
      { v: "Критическая депрессия h_кр", s: 3 }, { v: d.hKr !== undefined ? Math.round(d.hKr * 10) / 10 : "—", s: 3 }, { v: "Па", s: 3 },
    ],
    [
      { v: "Расход при пожаре Q_B", s: 3 }, { v: Math.round(Math.abs(d.Qb) * 100) / 100, s: 3 }, { v: "м³/с", s: 3 },
      { v: "" },
      { v: "Показатель устойчивости p_у", s: 3 }, { v: d.pU !== undefined ? Math.round(d.pU * 1000) / 1000 : "—", s: 3 }, { v: "—", s: 3 },
    ],
    [
      { v: "Проветривание", s: 3 }, { v: d.ascending ? "восходящее" : "нисходящее", s: 3 }, { v: "", s: 3 },
      { v: "" },
      { v: "Состояние струи", s: 3 },
      { v: d.reversed ? "ОПРОКИНУТА" : (d.pU !== undefined && d.pU < 0.3 ? "весьма неустойчивая" : "устойчивая"), s: 3 },
      { v: "", s: 3 },
    ],
  ];

  // ── Лист 2: данные кривых (A..E) и рабочие точки (G..J) ──────────────────
  const s2: Cell[][] = [[
    { v: "Q, м³/с", s: 1 }, { v: "1: R·Q², Па", s: 1 }, { v: "3: h_т+R·Q², Па", s: 1 },
    { v: "2: h_т, Па", s: 1 }, { v: "h_кр, Па", s: 1 },
    { v: "", s: 0 },
    { v: "Точка", s: 1 }, { v: "Q, м³/с", s: 1 }, { v: "h, Па", s: 1 }, { v: "Режим", s: 1 },
  ]];
  const maxLen = Math.max(rows.length, points.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rows[i];
    const p = points[i];
    s2.push([
      r ? { v: r.q } : { v: "" },
      r ? { v: r.net } : { v: "" },
      r ? { v: r.activ } : { v: "" },
      r ? { v: r.hT } : { v: "" },
      r && r.hKr !== null ? { v: r.hKr } : { v: "" },
      { v: "" },
      p ? { v: p.name, s: 3 } : { v: "" },
      p ? { v: p.q, s: 3 } : { v: "" },
      p ? { v: p.h, s: 3 } : { v: "" },
      p ? { v: p.note, s: 3 } : { v: "" },
    ]);
  }

  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels")!.file(".rels", ROOT_RELS);
  const xl = zip.folder("xl")!;
  xl.file("workbook.xml", WORKBOOK);
  xl.folder("_rels")!.file("workbook.xml.rels", WORKBOOK_RELS);
  xl.file("styles.xml", STYLES);
  xl.file("sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>`);
  const ws = xl.folder("worksheets")!;
  ws.file("sheet1.xml", sheetXml(s1, `<drawing r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`));
  ws.folder("_rels")!.file("sheet1.xml.rels", SHEET1_RELS);
  ws.file("sheet2.xml", sheetXml(s2));
  xl.folder("drawings")!.file("drawing1.xml", DRAWING);
  xl.folder("drawings")!.folder("_rels")!.file("drawing1.xml.rels", DRAWING_RELS);
  xl.folder("charts")!.file("chart1.xml", buildChartXml(d, rows.length, points));

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Диаграмма h-Q${branchName ? ` ${branchName}` : ""}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
