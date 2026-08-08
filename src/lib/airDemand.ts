// ─────────────────────────────────────────────────────────────────────────────
// airDemand.ts — Расчёт количества воздуха по забоям и участкам.
//
// Нормативная база: ФНиП «Правила безопасности при ведении горных работ и
// переработке твёрдых полезных ископаемых» (приказ Ростехнадзора № 505
// от 08.12.2020), п. 155 — расчёт ведётся ПОЗАБОЙНО с суммированием по
// участкам и введением обоснованных коэффициентов запаса.
//
// Порядок расчёта по каждому забою:
//   1) считаем потребность отдельно по каждому фактору:
//        • по людям         Q = q_чел · n
//        • по газам ВР      формула Воронина (разбавление газов взрыва)
//        • по дизелю        Q = q_кВт · N · k_одновр
//        • по мин. скорости Q = v_min · S
//   2) в зачёт идёт МАКСИМУМ из факторов (определяющий фактор);
//   3) применяем коэффициенты запаса и утечек;
//   4) проверяем результат по допустимым скоростям (мин. и МАКС.).
// ─────────────────────────────────────────────────────────────────────────────

import type { TopoBranch } from "./topology";
import {
  simultaneityFactor,
  type VentNorms, type VentSection, type FaceType,
} from "./ventSections";

/** Фактор, определяющий потребность в воздухе */
export type DemandFactor = "people" | "blast" | "diesel" | "vmin" | "none";

export const FACTOR_LABEL: Record<DemandFactor, string> = {
  people: "По людям",
  blast:  "По газам ВР",
  diesel: "По дизелю",
  vmin:   "По мин. скорости",
  none:   "Не определён",
};

/** Результат расчёта по одному забою */
export interface FaceDemand {
  branchId: string;
  /** Наименование забоя (или тип выработки) */
  name: string;
  faceType: FaceType;
  sectionId: string;
  sectionName: string;
  area: number;            // м² — сечение
  length: number;          // м

  // Потребность по факторам, м³/с
  byPeople: number;
  byBlast: number;
  byDiesel: number;
  byVMin: number;

  /** Определяющий фактор (максимум) */
  factor: DemandFactor;
  /** Потребность до коэффициентов, м³/с */
  base: number;
  /** Применённый коэффициент запаса */
  reserveFactor: number;
  /** Применённый коэффициент утечек */
  leakFactor: number;
  /** Доля для резервного забоя (1 = не резервный) */
  reserveShare: number;
  /** Итоговая потребность с коэффициентами, м³/с */
  total: number;

  /** Фактический расход по расчёту сети, м³/с */
  actualFlow: number;
  /** Фактическая скорость, м/с */
  actualVelocity: number;
  /** Требуемая скорость при расчётной потребности, м/с */
  requiredVelocity: number;
  /** Допустимый диапазон скоростей */
  vMin: number;
  vMax: number;
  /** Скорость в допустимых пределах */
  velocityOk: boolean;
  /** Фактического расхода достаточно */
  flowOk: boolean;

  /** Вердикт и рекомендация */
  verdict: string;
  recommendation: string;
  /** Пояснение расчёта определяющего фактора */
  formula: string;
}

/** Итог по участку */
export interface SectionDemand {
  sectionId: string;
  number: string;
  name: string;
  color: string;
  isReserve: boolean;
  faces: FaceDemand[];
  /** Сумма потребностей забоев участка, м³/с */
  total: number;
  /** Сумма фактических расходов, м³/с */
  actual: number;
  /** Число забоев с недостатком воздуха */
  failed: number;
  ok: boolean;
}

export interface AirDemandResult {
  faces: FaceDemand[];
  sections: SectionDemand[];
  /** Забои вне участков */
  unassigned: FaceDemand[];
  /** Итог по руднику, м³/с */
  totalDemand: number;
  /** Фактическая подача по забоям, м³/с */
  totalActual: number;
  /** Число забоев с недостатком */
  failedCount: number;
  norms: VentNorms;
  error: string | null;
}

// ─── Расчёт по одному забою ──────────────────────────────────────────────────

/** Число (с запасным значением, если задано 0 или не задано) */
const val = (v: number | undefined, fallback: number): number =>
  (v !== undefined && v > 0 ? v : fallback);

export function calcFaceDemand(
  b: TopoBranch,
  norms: VentNorms,
  section: VentSection | null,
): FaceDemand {
  const faceType = (b.ventFaceType ?? "none") as FaceType;
  const area = b.area > 0 ? b.area : 0;
  const length = b.length > 0 ? b.length : 0;

  // ── 1. По людям: Q = q_чел · n ────────────────────────────────────────
  // Норма 6 м³/мин на человека → переводим в м³/с делением на 60.
  const people = b.ventPeopleCount ?? 0;
  const byPeople = people > 0 ? (norms.airPerPerson * people) / 60 : 0;

  // ── 2. По газам взрывных работ ────────────────────────────────────────
  // Объём вредных газов: V_ВВ = g_уголь·B_уголь + g_порода·B_порода (литры).
  // Формула Воронина для тупиковой/подготовительной выработки:
  //   Q = (1 / (k·T)) · √( V_вв · V_выр / C_пдк )
  // где T — время проветривания (мин), V_выр — объём выработки (м³),
  // C_пдк — ПДК условного оксида углерода (доли), k — коэф. обводнённости.
  const massCoal = b.ventBlastMassCoal ?? 0;
  const massRock = b.ventBlastMassRock ?? 0;
  const gasVolume = norms.gasPerKgCoal * massCoal + norms.gasPerKgRock * massRock;

  let byBlast = 0;
  let blastNote = "";
  if (gasVolume > 0) {
    const T = val(b.ventBlastTime, norms.blastVentTime);
    const kWater = val(b.ventBlastWatering, norms.wateringFactor);
    // Объём выработки: задан вручную либо вычисляем из сечения и длины
    const volume = val(b.ventBlastVolume, area * length);
    const cLimit = norms.coLimit > 0 ? norms.coLimit / 100 : 0.00008; // % → доли
    if (T > 0 && volume > 0 && cLimit > 0) {
      // Q в м³/мин, затем переводим в м³/с
      const qMin = (1 / (kWater * T)) * Math.sqrt((gasVolume / 1000) * volume / cLimit);
      byBlast = qMin / 60;
      blastNote = `V_газ=${gasVolume.toFixed(0)} л, V_выр=${volume.toFixed(0)} м³, T=${T} мин`;
    }
  }

  // ── 3. По дизельному оборудованию: Q = q_кВт · N · k_одновр ───────────
  const dieselCount = b.ventDieselCount ?? 0;
  const dieselPower = b.ventDieselPower ?? 0;
  const dieselNorm = val(b.ventDieselNorm, norms.airPerKwDiesel);
  const simult = val(b.ventDieselSimult, simultaneityFactor(dieselCount, norms));
  const byDiesel = dieselPower > 0
    ? (dieselNorm * dieselPower * simult) / 60
    : 0;

  // ── 4. По минимальной скорости: Q = v_min · S ────────────────────────
  // Для очистных и подготовительных забоев норма выше, чем для прочих.
  const isFace = faceType === "stoping" || faceType === "development" || faceType === "deadend";
  const vMin = isFace ? norms.vMinFace : norms.vMinOther;
  const byVMin = area > 0 ? vMin * area : 0;

  // ── Определяющий фактор = максимум ───────────────────────────────────
  const candidates: { f: DemandFactor; q: number }[] = [
    { f: "people", q: byPeople },
    { f: "blast",  q: byBlast },
    { f: "diesel", q: byDiesel },
    { f: "vmin",   q: byVMin },
  ];
  const best = candidates.reduce((m, c) => (c.q > m.q ? c : m), { f: "none" as DemandFactor, q: 0 });
  const base = best.q;
  const factor = base > 0 ? best.f : "none";

  // ── Коэффициенты: приоритет забой → участок → общие нормы ────────────
  const reserveFactor = val(b.ventReserveFactor, val(section?.reserveFactor, norms.reserveFactor));
  const leakFactor    = val(b.ventLeakFactor,    val(section?.leakFactor,    norms.leakFactor));
  const isReserve = (b.ventReserve ?? false) || (section?.isReserve ?? false);
  const reserveShare = isReserve ? norms.reserveShare : 1;

  const total = base * reserveFactor * leakFactor * reserveShare;

  // ── Проверка по фактическому расходу и скоростям ─────────────────────
  const actualFlow = Math.abs(b.flow ?? 0);
  const actualVelocity = area > 0 ? actualFlow / area : 0;
  const requiredVelocity = area > 0 ? total / area : 0;
  const vMax = norms.vMaxDrift;
  const velocityOk = actualVelocity >= vMin * 0.999 && actualVelocity <= vMax * 1.001;
  const flowOk = total <= 0 || actualFlow >= total * 0.999;

  // ── Вердикт и рекомендация ───────────────────────────────────────────
  let verdict: string;
  let recommendation = "";
  if (total <= 0) {
    verdict = "Данные не заданы";
    recommendation = "Укажите тип забоя и исходные данные (люди, ВВ, дизель)";
  } else if (!flowOk) {
    const deficit = total - actualFlow;
    verdict = "Недостаточно воздуха";
    recommendation = `Не хватает ${deficit.toFixed(1)} м³/с — увеличить подачу или снизить нагрузку`;
  } else if (actualVelocity > vMax) {
    verdict = "Скорость выше допустимой";
    recommendation = `Скорость ${actualVelocity.toFixed(2)} м/с при пределе ${vMax} м/с — увеличить сечение или снизить расход`;
  } else if (actualVelocity < vMin) {
    verdict = "Скорость ниже минимальной";
    recommendation = `Скорость ${actualVelocity.toFixed(2)} м/с при норме ${vMin} м/с — увеличить подачу`;
  } else {
    verdict = "Обеспечено";
  }

  // Пояснение расчёта — чтобы проектировщик видел, откуда цифра
  let formula = "";
  if (factor === "people") formula = `${norms.airPerPerson} м³/мин × ${people} чел ÷ 60`;
  else if (factor === "blast") formula = blastNote;
  else if (factor === "diesel") formula = `${dieselNorm} × ${dieselPower} кВт × ${simult} ÷ 60`;
  else if (factor === "vmin") formula = `${vMin} м/с × ${area.toFixed(1)} м²`;

  return {
    branchId: b.id,
    name: b.ventDescription || b.type || b.id,
    faceType,
    sectionId: b.ventSectionId ?? "",
    sectionName: section ? (section.name || section.number) : "",
    area: +area.toFixed(2),
    length: +length.toFixed(0),
    byPeople: +byPeople.toFixed(2),
    byBlast: +byBlast.toFixed(2),
    byDiesel: +byDiesel.toFixed(2),
    byVMin: +byVMin.toFixed(2),
    factor,
    base: +base.toFixed(2),
    reserveFactor,
    leakFactor,
    reserveShare,
    total: +total.toFixed(2),
    actualFlow: +actualFlow.toFixed(2),
    actualVelocity: +actualVelocity.toFixed(2),
    requiredVelocity: +requiredVelocity.toFixed(2),
    vMin,
    vMax,
    velocityOk,
    flowOk,
    verdict,
    recommendation,
    formula,
  };
}

// ─── Расчёт по всей схеме ────────────────────────────────────────────────────

export function calcAirDemand(
  branches: TopoBranch[],
  sections: VentSection[],
  norms: VentNorms,
): AirDemandResult {
  const sectionById = new Map(sections.map(s => [s.id, s]));

  // В расчёт идут только выработки с заданным типом забоя
  const faceBranches = branches.filter(b => {
    const t = b.ventFaceType ?? "none";
    return t !== "none" && t !== "";
  });

  if (faceBranches.length === 0) {
    return {
      faces: [], sections: [], unassigned: [],
      totalDemand: 0, totalActual: 0, failedCount: 0, norms,
      error: "Не задан ни один забой. Откройте свойства выработки, вкладку «Расход воздуха», и укажите тип забоя.",
    };
  }

  const faces = faceBranches.map(b =>
    calcFaceDemand(b, norms, sectionById.get(b.ventSectionId ?? "") ?? null));

  // Группировка по участкам
  const sectionResults: SectionDemand[] = sections.map(s => {
    const list = faces.filter(f => f.sectionId === s.id);
    const total = list.reduce((sum, f) => sum + f.total, 0);
    const actual = list.reduce((sum, f) => sum + f.actualFlow, 0);
    const failed = list.filter(f => !f.flowOk && f.total > 0).length;
    return {
      sectionId: s.id,
      number: s.number,
      name: s.name || "Без названия",
      color: s.color,
      isReserve: s.isReserve,
      faces: list,
      total: +total.toFixed(2),
      actual: +actual.toFixed(2),
      failed,
      ok: failed === 0,
    };
  }).filter(s => s.faces.length > 0);

  const unassigned = faces.filter(f => !f.sectionId || !sectionById.has(f.sectionId));

  const totalDemand = faces.reduce((s, f) => s + f.total, 0);
  const totalActual = faces.reduce((s, f) => s + f.actualFlow, 0);
  const failedCount = faces.filter(f => !f.flowOk && f.total > 0).length;

  return {
    faces,
    sections: sectionResults,
    unassigned,
    totalDemand: +totalDemand.toFixed(2),
    totalActual: +totalActual.toFixed(2),
    failedCount,
    norms,
    error: null,
  };
}
