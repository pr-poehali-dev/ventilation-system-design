// ─────────────────────────────────────────────────────────────────────────────
// ventPipeReport.ts — печатный отчёт по вентиляционным ставам (ВМП).
//
// Собирает по всем тупиковым забоям с вентставом единую таблицу: сколько
// воздуха даёт вентилятор, сколько теряется в ставе, сколько доходит до забоя,
// хватает ли этого по нормам и на какую длину става хватит.
//
// Отчёт печатается через тот же скрытый iframe, что и схема, поэтому здесь
// формируется готовый HTML-документ с встроенными стилями печати.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type VentSection, type VentNorms } from "@/lib/ventSections";
import { calcFaceDemand } from "@/lib/airDemand";
import { VENT_DUCT_BRANDS } from "@/lib/ventDucts";
import { getFanById, fanHAngle } from "@/lib/fanCurves";
import {
  calcVentPipe, calcVentPipeMaxLength, type VpLeakMethod,
} from "@/lib/ventPipeCalc";

/** Строка отчёта по одному ставу */
export interface VentPipeReportRow {
  branchId: string;
  /** Марка рукава (или «—», если не выбрана) */
  brand: string;
  diameter: number;
  length: number;
  /** Методика расчёта утечек */
  method: VpLeakMethod;
  flowFan: number;
  delivery: number;
  leakage: number;
  flowFace: number;
  required: number;
  /** Воздуха хватает */
  ok: boolean;
  deltaP: number;
  fanPressure: number;
  workPressure: number;
  maxLength: number;
  reserve: number;
  limitedBy: "flow" | "pressure" | "none";
}

const METHOD_LABEL: Record<VpLeakMethod, string> = {
  passport: "по паспорту рукава",
  normative: "по нормативной формуле",
};

const LIMIT_LABEL: Record<"flow" | "pressure" | "none", string> = {
  flow: "нехватка воздуха",
  pressure: "давление",
  none: "не ограничено",
};

/**
 * Собирает данные отчёта по всем ветвям с вентставом.
 * Ветви без става и без длины пропускаются.
 */
export function buildVentPipeReport(
  branches: TopoBranch[],
  ventSections: VentSection[],
  ventNorms: VentNorms,
): VentPipeReportRow[] {
  const rows: VentPipeReportRow[] = [];

  for (const b of branches) {
    if (!b.hasVentPipe || !(b.vpLength ?? 0)) continue;

    const brand = VENT_DUCT_BRANDS.find(x => x.id === b.vpBrandId);
    const size = brand?.sizes.find(s => s.diameter === b.vpDiameter);
    const method = (b.vpLeakMethod ?? "passport") as VpLeakMethod;
    const length = b.vpLength ?? 0;
    const fanFlow = Math.abs(b.flow ?? 0);
    const fanPressure = Math.abs(b.fanPressure ?? 0);

    // Характеристика вентилятора — без неё подача считалась бы постоянной
    // при любой длине става, и предельная длина вышла бы завышенной.
    const curveObj = b.hasFan ? getFanById(b.fanCurveId) : undefined;
    const fanCurve = curveObj
      ? (Q: number) => fanHAngle(
          curveObj, Q, b.fanBladeAngle,
          b.fanRpm > 0 ? b.fanRpm : curveObj.rpmNominal,
        )
      : undefined;

    const jointsPerMeter = length > 0 && (b.vpJointCount ?? 0) > 0
      ? (b.vpJointCount ?? 0) / length
      : (b.vpLinkLength ?? 20) > 0 ? 1 / (b.vpLinkLength ?? 20) : 0;

    const input = {
      method,
      diameter: b.vpDiameter ?? 0,
      alpha: brand?.alpha ?? b.vpPipeAlpha ?? 0,
      lossPer100m: size?.lossPer100m ?? b.vpLeakageCoeff ?? 0,
      linkLength: b.vpLinkLength ?? 20,
      jointCount: b.vpJointCount ?? 0,
      localXi: b.vpLocalXi ?? 0,
      jointLeakK: b.vpJointLeakK ?? 0,
      jointsPerMeter,
      fanCurve,
      fanFlow,
    };

    const res = calcVentPipe({ ...input, length });

    const section = ventSections.find(s => s.id === (b.ventSectionId ?? "")) ?? null;
    const required = (b.vpRequiredFlow ?? 0) > 0
      ? b.vpRequiredFlow!
      : (calcFaceDemand(b, ventNorms, section).total ?? 0);

    const workPressure = size?.workPressure ?? b.vpWorkPressure ?? 0;
    const pressureLimit = (() => {
      const limits = [fanPressure, workPressure].filter(v => v > 0);
      return limits.length ? Math.min(...limits) : 0;
    })();

    const limit = required > 0
      ? calcVentPipeMaxLength(input, required, pressureLimit, length)
      : null;

    rows.push({
      branchId: b.id,
      brand: brand?.name ?? "—",
      diameter: b.vpDiameter ?? 0,
      length,
      method,
      flowFan: res.flowFan,
      delivery: res.delivery,
      leakage: res.leakage,
      flowFace: res.flowFace,
      required,
      ok: required <= 0 || res.flowFace >= required,
      deltaP: res.deltaP,
      fanPressure,
      workPressure,
      maxLength: limit?.maxLength ?? 0,
      reserve: limit?.reserve ?? 0,
      limitedBy: limit?.limitedBy ?? "none",
    });
  }

  return rows;
}

const n = (v: number, d = 2): string =>
  isFinite(v) ? v.toFixed(d) : "—";

/**
 * Формирует готовый HTML печатного отчёта по вентставам.
 * Документ рассчитан на альбомную A4 и печатается через скрытый iframe.
 */
export function buildVentPipeReportHtml(
  rows: VentPipeReportRow[],
  projectName: string,
): string {
  const date = new Date().toLocaleDateString("ru-RU");

  const failed = rows.filter(r => !r.ok).length;
  const overLen = rows.filter(r => r.maxLength > 0 && r.reserve < 0).length;

  const body = rows.length === 0
    ? `<p class="empty">В проекте нет выработок с вентиляционным ставом.</p>`
    : `
    <table>
      <thead>
        <tr>
          <th rowspan="2">Выработка</th>
          <th rowspan="2">Марка рукава</th>
          <th rowspan="2">Ø,<br>мм</th>
          <th rowspan="2">Длина<br>става, м</th>
          <th colspan="4">Доставка воздуха, м³/с</th>
          <th colspan="2">Давление, Па</th>
          <th colspan="2">Предельная длина</th>
        </tr>
        <tr>
          <th>вент.</th>
          <th>K<sub>у.т</sub></th>
          <th>утечки</th>
          <th>в забой</th>
          <th>став</th>
          <th>предел</th>
          <th>хватит,<br>м</th>
          <th>запас,<br>м</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.ok ? "" : "bad"}">
            <td class="left">${r.branchId}</td>
            <td class="left">${r.brand}</td>
            <td>${n(r.diameter, 0)}</td>
            <td>${n(r.length, 0)}</td>
            <td>${n(r.flowFan)}</td>
            <td>${n(r.delivery, 3)}</td>
            <td>${n(r.leakage)}</td>
            <td class="strong">${n(r.flowFace)}</td>
            <td>${n(r.deltaP, 0)}</td>
            <td>${r.workPressure > 0 ? n(r.workPressure, 0) : "—"}</td>
            <td>${r.maxLength > 0 ? n(r.maxLength, 0) : "—"}</td>
            <td class="${r.reserve < 0 ? "neg" : ""}">${r.maxLength > 0 ? n(r.reserve, 0) : "—"}</td>
          </tr>`).join("")}
      </tbody>
    </table>

    <h2>Пояснения по забоям</h2>
    <table class="notes">
      <thead>
        <tr>
          <th>Выработка</th>
          <th>Требуется<br>в забой, м³/с</th>
          <th>Приходит,<br>м³/с</th>
          <th>Методика утечек</th>
          <th>Ограничение<br>длины</th>
          <th>Заключение</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.ok ? "" : "bad"}">
            <td class="left">${r.branchId}</td>
            <td>${r.required > 0 ? n(r.required) : "—"}</td>
            <td class="strong">${n(r.flowFace)}</td>
            <td class="left">${METHOD_LABEL[r.method]}</td>
            <td class="left">${LIMIT_LABEL[r.limitedBy]}</td>
            <td class="left">${
              r.required <= 0
                ? "Требуемый расход не задан — проверка не выполнялась."
                : !r.ok
                ? `Воздуха не хватает: не достаёт ${n(r.required - r.flowFace)} м³/с. Требуется сократить став, увеличить диаметр рукава или заменить вентилятор.`
                : r.reserve < 0
                ? `Воздуха достаточно, но став длиннее расчётного предела на ${n(-r.reserve, 0)} м — проверьте исходные данные.`
                : `Воздуха достаточно, запас длины става ${n(r.reserve, 0)} м.`
            }</td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Отчёт по вентиляционным ставам — ${projectName}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: "Times New Roman", serif; font-size: 10pt; color: #000; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 2mm; }
  h2 { font-size: 11pt; margin: 6mm 0 2mm; }
  .meta { font-size: 9pt; color: #444; margin-bottom: 4mm; }
  .summary { font-size: 9.5pt; margin: 0 0 4mm; padding: 2mm 3mm;
             border: 1px solid #999; background: #f5f5f5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  th, td { border: 1px solid #666; padding: 1mm 1.5mm; text-align: center;
           font-size: 8.5pt; vertical-align: middle; }
  th { background: #ececec; font-weight: bold; }
  td.left { text-align: left; }
  td.strong { font-weight: bold; }
  td.neg { color: #a00; font-weight: bold; }
  tr.bad td { background: #fff2f2; }
  table.notes td.left { font-size: 8pt; }
  .empty { font-size: 11pt; color: #555; }
  .foot { margin-top: 6mm; font-size: 8.5pt; color: #444; }
</style></head>
<body>
  <h1>Расчёт вентиляционных ставов (ВМП, нагнетательная схема)</h1>
  <div class="meta">Проект: ${projectName} &nbsp;·&nbsp; Дата: ${date}
    &nbsp;·&nbsp; Ставов в расчёте: ${rows.length}</div>

  ${rows.length > 0 ? `<div class="summary">
    <b>Итог.</b> Проверено ставов: ${rows.length}.
    Забоев с нехваткой воздуха: <b>${failed}</b>.
    Ставов длиннее расчётного предела: <b>${overLen}</b>.
  </div>` : ""}

  ${body}

  <div class="foot">
    K<sub>у.т</sub> — коэффициент доставки воздуха: доля подачи вентилятора,
    дошедшая до забоя. Подача вентилятора и предельная длина рассчитаны по
    паспортной характеристике: с удлинением става его сопротивление растёт,
    поэтому вентилятор прогоняет меньше воздуха.
  </div>
</body></html>`;
}