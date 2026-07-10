// ─────────────────────────────────────────────────────────────────────────────
// Каталог насосов с реальными Q–H характеристиками (напорными кривыми)
// Аппроксимация напорной характеристики: H(Q) = H0 + a·Q + b·Q²
//   Q — подача, м³/ч;  H — напор, м вод. ст.
// Источники: паспорта ЦНС (секционные), Д (Гном/двустороннего входа), К (консольные)
// ─────────────────────────────────────────────────────────────────────────────

export type PumpType = "sectional" | "centrifugal" | "console" | "submersible" | "drainage";

export interface PumpModel {
  id: string;
  brand: string;
  model: string;
  type: PumpType;
  // Параметры характеристики H(Q) = H0 + a·Q + b·Q² (Q в м³/ч, H в м вод.ст.)
  H0: number;          // напор при нулевой подаче, м
  a: number;           // коэф. при Q
  b: number;           // коэф. при Q²
  // Рабочий диапазон
  Qmin: number;        // м³/ч
  Qmax: number;        // м³/ч
  Qopt: number;        // оптимальная подача, м³/ч
  // Эффективность в оптимальной точке
  etaMax: number;      // 0..1
  // Электрические/механические параметры
  power: number;       // кВт (мощность двигателя)
  rpm: number;         // об/мин
  // Габариты и масса
  weight: number;      // кг
  priceRub?: number;
  notes?: string;
}

// ─── Каталог моделей ────────────────────────────────────────────────────────

export const PUMP_CATALOG: PumpModel[] = [
  // ═══ ЦНС — секционные центробежные (шахтный водоотлив) ════════════════════
  {
    id: "cns_38_44",
    brand: "ЦНС", model: "ЦНС 38-44",
    type: "sectional",
    H0: 52, a: 0.05, b: -0.0065,
    Qmin: 19, Qmax: 57, Qopt: 38,
    etaMax: 0.63,
    power: 11, rpm: 1450, weight: 260,
    notes: "Секционный, 1 колесо",
  },
  {
    id: "cns_38_176",
    brand: "ЦНС", model: "ЦНС 38-176",
    type: "sectional",
    H0: 205, a: 0.1, b: -0.026,
    Qmin: 19, Qmax: 57, Qopt: 38,
    etaMax: 0.64,
    power: 37, rpm: 1450, weight: 480,
    notes: "Секционный, 4 колеса",
  },
  {
    id: "cns_60_165",
    brand: "ЦНС", model: "ЦНС 60-165",
    type: "sectional",
    H0: 195, a: 0.05, b: -0.011,
    Qmin: 30, Qmax: 90, Qopt: 60,
    etaMax: 0.66,
    power: 55, rpm: 1450, weight: 620,
    notes: "Секционный, 3 колеса",
  },
  {
    id: "cns_105_294",
    brand: "ЦНС", model: "ЦНС 105-294",
    type: "sectional",
    H0: 345, a: 0.06, b: -0.0075,
    Qmin: 52, Qmax: 160, Qopt: 105,
    etaMax: 0.7,
    power: 160, rpm: 1480, weight: 1250,
    notes: "Секционный, 6 колёс, шахтный водоотлив",
  },
  {
    id: "cns_180_425",
    brand: "ЦНС", model: "ЦНС 180-425",
    type: "sectional",
    H0: 500, a: 0.05, b: -0.0038,
    Qmin: 90, Qmax: 270, Qopt: 180,
    etaMax: 0.73,
    power: 400, rpm: 1480, weight: 2400,
    notes: "Секционный, 5 колёс, главный водоотлив",
  },
  {
    id: "cns_300_360",
    brand: "ЦНС", model: "ЦНС 300-360",
    type: "sectional",
    H0: 425, a: 0.03, b: -0.0016,
    Qmin: 150, Qmax: 450, Qopt: 300,
    etaMax: 0.75,
    power: 500, rpm: 1480, weight: 3100,
    notes: "Секционный, главный водоотлив",
  },

  // ═══ Д — центробежные двустороннего входа ════════════════════════════════
  {
    id: "d_320_50",
    brand: "Д", model: "Д 320-50",
    type: "centrifugal",
    H0: 58, a: 0.008, b: -0.00012,
    Qmin: 160, Qmax: 500, Qopt: 320,
    etaMax: 0.83,
    power: 75, rpm: 1450, weight: 560,
    notes: "Двустороннего входа",
  },
  {
    id: "d_630_90",
    brand: "Д", model: "Д 630-90",
    type: "centrifugal",
    H0: 104, a: 0.006, b: -0.00006,
    Qmin: 315, Qmax: 950, Qopt: 630,
    etaMax: 0.85,
    power: 250, rpm: 1450, weight: 1150,
    notes: "Двустороннего входа",
  },
  {
    id: "d_1250_125",
    brand: "Д", model: "Д 1250-125",
    type: "centrifugal",
    H0: 145, a: 0.004, b: -0.00002,
    Qmin: 625, Qmax: 1800, Qopt: 1250,
    etaMax: 0.87,
    power: 630, rpm: 985, weight: 2200,
    notes: "Двустороннего входа, крупный",
  },

  // ═══ К — консольные ═══════════════════════════════════════════════════════
  {
    id: "k_45_30",
    brand: "К", model: "К 45/30",
    type: "console",
    H0: 34, a: 0.02, b: -0.0028,
    Qmin: 22, Qmax: 68, Qopt: 45,
    etaMax: 0.7,
    power: 7.5, rpm: 2900, weight: 82,
    notes: "Консольный",
  },
  {
    id: "k_90_55",
    brand: "К", model: "К 90/55",
    type: "console",
    H0: 62, a: 0.015, b: -0.0014,
    Qmin: 45, Qmax: 135, Qopt: 90,
    etaMax: 0.72,
    power: 30, rpm: 2900, weight: 155,
    notes: "Консольный",
  },

  // ═══ Дренажные / погружные ════════════════════════════════════════════════
  {
    id: "gnom_100_25",
    brand: "Гном", model: "ГНОМ 100-25",
    type: "drainage",
    H0: 30, a: 0.005, b: -0.0018,
    Qmin: 40, Qmax: 130, Qopt: 100,
    etaMax: 0.55,
    power: 11, rpm: 2900, weight: 62,
    notes: "Дренажный погружной, загрязнённая вода",
  },
  {
    id: "gnom_53_10",
    brand: "Гном", model: "ГНОМ 53-10",
    type: "drainage",
    H0: 13, a: 0.004, b: -0.0011,
    Qmin: 25, Qmax: 75, Qopt: 53,
    etaMax: 0.5,
    power: 3, rpm: 2900, weight: 34,
    notes: "Дренажный погружной",
  },
];

// ─── Расчёт характеристик ───────────────────────────────────────────────────

// Напор насоса при заданной подаче: H(Q), м вод. ст.
export function pumpHead(pump: PumpModel, Q: number): number {
  return Math.max(0, pump.H0 + pump.a * Q + pump.b * Q * Q);
}

// КПД при подаче (упрощённо — парабола вокруг Qopt)
export function pumpEfficiency(pump: PumpModel, Q: number): number {
  if (Q <= 0 || Q > pump.Qmax * 1.1) return 0;
  const ratio = (Q - pump.Qopt) / pump.Qopt;
  const eta = pump.etaMax * Math.max(0.1, 1 - 0.6 * ratio * ratio);
  return Math.min(pump.etaMax, eta);
}

// Мощность на валу при подаче Q, кВт
// P = ρ·g·Q·H / (η·3600·1000), ρ=1000 кг/м³, g=9.81
export function pumpPower(pump: PumpModel, Q: number): number {
  const H = pumpHead(pump, Q);
  const eta = pumpEfficiency(pump, Q);
  if (eta < 0.05) return pump.power;
  return (1000 * 9.81 * Q * H) / (eta * 3600 * 1000);
}

// ─── Поиск рабочей точки: пересечение кривых насоса и сети ──────────────────
// Сеть: H_сети(Q) = Hst + S·Q²  (Hst — геометрическая высота подъёма)

export interface PumpOperatingPoint {
  Q: number;        // м³/ч
  H: number;        // м
  eta: number;      // КПД
  power: number;    // кВт (на валу)
  found: boolean;
  inOptimalZone: boolean;
  marginQ: number;  // запас по подаче %
  marginH: number;  // запас по напору %
}

export function findPumpOperatingPoint(pump: PumpModel, networkS: number, staticHead: number, requiredQ: number, requiredH: number): PumpOperatingPoint {
  let lo = 0, hi = pump.Qmax * 1.2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const Hpump = pumpHead(pump, mid);
    const Hnet = staticHead + networkS * mid * mid;
    if (Hpump > Hnet) lo = mid; else hi = mid;
  }
  const Q = (lo + hi) / 2;
  const H = pumpHead(pump, Q);
  const eta = pumpEfficiency(pump, Q);
  const power = pumpPower(pump, Q);
  const found = Q >= pump.Qmin * 0.7 && Q <= pump.Qmax * 1.05 && H > 0;
  const inOptimalZone = Math.abs(Q - pump.Qopt) / pump.Qopt < 0.25;
  const marginQ = requiredQ > 0 ? ((Q - requiredQ) / requiredQ) * 100 : 0;
  const marginH = requiredH > 0 ? ((H - requiredH) / requiredH) * 100 : 0;

  return {
    Q: Math.round(Q),
    H: Math.round(H * 10) / 10,
    eta: Math.round(eta * 100) / 100,
    power: Math.round(power * 100) / 100,
    found, inOptimalZone,
    marginQ: Math.round(marginQ),
    marginH: Math.round(marginH),
  };
}

// ─── Подбор подходящих насосов под систему ─────────────────────────────────

export interface PumpSelection {
  pump: PumpModel;
  point: PumpOperatingPoint;
  score: number;     // 0..100
  warnings: string[];
}

export function selectPumps(requiredQ: number, requiredH: number, staticHead: number, pumpType?: PumpType): PumpSelection[] {
  // S системы: H = Hst + S·Q²  →  S = (H - Hst) / Q²
  const S = requiredQ > 0 ? Math.max(0, (requiredH - staticHead)) / (requiredQ * requiredQ) : 0;

  const candidates = PUMP_CATALOG.filter((p) => !pumpType || p.type === pumpType);

  return candidates.map((pump) => {
    const point = findPumpOperatingPoint(pump, S, staticHead, requiredQ, requiredH);
    const warnings: string[] = [];

    let score = 0;
    if (!point.found) {
      score = 0;
      warnings.push("Рабочая точка вне диапазона");
    } else {
      score = 60;
      if (point.inOptimalZone) score += 20;
      if (point.marginQ >= 5 && point.marginQ <= 30) score += 10;
      else if (point.marginQ < 0) { score -= 30; warnings.push(`Подача ниже требуемой на ${Math.abs(point.marginQ)}%`); }
      else if (point.marginQ > 50) { score -= 20; warnings.push(`Большой избыток подачи (+${point.marginQ}%)`); }
      score += point.eta * 25;
      if (point.eta < pump.etaMax * 0.8) warnings.push(`КПД ниже оптимума (${Math.round(point.eta * 100)}% vs ${Math.round(pump.etaMax * 100)}%)`);
    }

    return { pump, point, score: Math.max(0, Math.min(100, Math.round(score))), warnings };
  }).sort((a, b) => b.score - a.score);
}

export const PUMP_TYPE_NAMES: Record<PumpType, string> = {
  sectional: "Секционные (ЦНС)",
  centrifugal: "Двустороннего входа (Д)",
  console: "Консольные (К)",
  submersible: "Погружные",
  drainage: "Дренажные (Гном)",
};

export function getPumpById(id: string | undefined): PumpModel | undefined {
  if (!id) return undefined;
  return PUMP_CATALOG.find((p) => p.id === id);
}
