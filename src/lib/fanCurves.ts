// ─────────────────────────────────────────────────────────────────────────────
// Q-H характеристики шахтных вентиляторов главного проветривания
// (центробежные ВЦ, осевые ВОД, ВЦД)
//
// Модель: H(Q) = h0 + h1·Q + h2·Q²  (Па, при Q в м³/с)
// КПД:    η(Q) = e0 + e1·Q + e2·Q²  (доли единицы, ограничена 0.05–0.85)
//
// Коэффициенты подобраны под типовые паспортные характеристики.
// ─────────────────────────────────────────────────────────────────────────────

export interface FanCurve {
  id: string;
  name: string;
  type: "centrifugal" | "axial" | "vmp";
  diameter: number;        // м — диаметр рабочего колеса
  // H(Q) = h0 + h1·Q + h2·Q²  — прямой режим
  h0: number;
  h1: number;
  h2: number;
  // η(Q) = e0 + e1·Q + e2·Q²
  e0: number;
  e1: number;
  e2: number;
  // Допустимый диапазон Q (м³/с) для аппроксимации
  qMin: number;
  qMax: number;
  // Номинальная рабочая точка (для отображения)
  qNominal: number;
  hNominal: number;
  // Обороты
  rpmMin: number;
  rpmMax: number;
  rpmNominal: number;
  // Углы лопаток (доступные значения °)
  bladeAngles: number[];
  // Реверсная P–Q характеристика (опционально).
  // У осевых вентиляторов (ВОД) в реверсе напор ~55–65% от прямого.
  // У центробежных (ВЦ) реверс через клапаны — кривая совпадает с прямой.
  // Если не задана — используется прямая характеристика (консервативная оценка).
  reverseH0?: number;
  reverseH1?: number;
  reverseH2?: number;
  reverseQMin?: number;
  reverseQMax?: number;
  // КПД в реверсном режиме (обычно 0.80–0.85 от прямого)
  reverseEfficiencyFactor?: number;
}

// Справочник типовых вентиляторов
export const FAN_CATALOG: FanCurve[] = [
  {
    id: "VC-15",
    name: "ВЦ-15", type: "centrifugal", diameter: 1.5,
    h0: 3200, h1: 4, h2: -0.08,
    e0: 0.20, e1: 0.012, e2: -0.00012,
    qMin: 20, qMax: 120, qNominal: 70, hNominal: 3000,
    rpmMin: 500, rpmMax: 1500, rpmNominal: 1000,
    bladeAngles: [],
  },
  {
    id: "VC-25",
    name: "ВЦ-25", type: "centrifugal", diameter: 2.5,
    h0: 4500, h1: 5, h2: -0.04,
    e0: 0.25, e1: 0.0065, e2: -0.000035,
    qMin: 50, qMax: 250, qNominal: 150, hNominal: 4200,
    rpmMin: 400, rpmMax: 1200, rpmNominal: 740,
    bladeAngles: [],
  },
  {
    id: "VC-32",
    name: "ВЦД-32", type: "centrifugal", diameter: 3.2,
    h0: 5500, h1: 4, h2: -0.018,
    e0: 0.30, e1: 0.0040, e2: -0.0000125,
    qMin: 100, qMax: 400, qNominal: 250, hNominal: 4800,
    rpmMin: 300, rpmMax: 900, rpmNominal: 600,
    bladeAngles: [],
  },
  {
    id: "VC-47",
    name: "ВЦД-47У", type: "centrifugal", diameter: 4.7,
    h0: 6800, h1: 3.5, h2: -0.0085,
    e0: 0.32, e1: 0.0028, e2: -0.0000058,
    qMin: 150, qMax: 600, qNominal: 380, hNominal: 5500,
    rpmMin: 200, rpmMax: 740, rpmNominal: 500,
    bladeAngles: [],
  },
  {
    id: "VOD-16",
    name: "ВОД-16АВ", type: "axial", diameter: 1.6,
    h0: 1200, h1: 10, h2: -0.22,
    e0: 0.28, e1: 0.020, e2: -0.00030,
    qMin: 10, qMax: 60, qNominal: 35, hNominal: 1300,
    rpmMin: 600, rpmMax: 1500, rpmNominal: 1000,
    bladeAngles: [20, 25, 30, 35, 40, 45],
    // Реверс: ~60% напора, диапазон Q сужается на 15%
    reverseH0: 720, reverseH1: 6, reverseH2: -0.18,
    reverseQMin: 8, reverseQMax: 50,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-18",
    name: "ВО-18/12АВР", type: "axial", diameter: 1.8,
    h0: 1800, h1: 8, h2: -0.18,
    e0: 0.30, e1: 0.018, e2: -0.00025,
    qMin: 15, qMax: 90, qNominal: 50, hNominal: 1900,
    rpmMin: 600, rpmMax: 1500, rpmNominal: 1300,
    bladeAngles: [20, 25, 30, 35, 40, 45, 50],
    reverseH0: 1080, reverseH1: 4.8, reverseH2: -0.15,
    reverseQMin: 12, reverseQMax: 76,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-21",
    name: "ВОД-21", type: "axial", diameter: 2.1,
    h0: 2000, h1: 7, h2: -0.14,
    e0: 0.32, e1: 0.016, e2: -0.00020,
    qMin: 20, qMax: 110, qNominal: 65, hNominal: 2100,
    rpmMin: 500, rpmMax: 1500, rpmNominal: 980,
    bladeAngles: [20, 25, 30, 35, 40, 45, 50],
    reverseH0: 1200, reverseH1: 4.2, reverseH2: -0.11,
    reverseQMin: 16, reverseQMax: 93,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-30",
    name: "ВОД-30", type: "axial", diameter: 3.0,
    h0: 2400, h1: 6, h2: -0.045,
    e0: 0.35, e1: 0.0080, e2: -0.000062,
    qMin: 40, qMax: 200, qNominal: 120, hNominal: 2700,
    rpmMin: 300, rpmMax: 980, rpmNominal: 740,
    bladeAngles: [25, 30, 35, 40, 45, 50, 55],
    reverseH0: 1440, reverseH1: 3.6, reverseH2: -0.037,
    reverseQMin: 34, reverseQMax: 170,
    reverseEfficiencyFactor: 0.82,
  },
  {
    id: "VOD-40",
    name: "ВОД-40", type: "axial", diameter: 4.0,
    h0: 3000, h1: 5, h2: -0.020,
    e0: 0.38, e1: 0.0050, e2: -0.000022,
    qMin: 80, qMax: 320, qNominal: 200, hNominal: 3200,
    rpmMin: 200, rpmMax: 740, rpmNominal: 500,
    bladeAngles: [25, 30, 35, 40, 45, 50, 55, 60],
    reverseH0: 1800, reverseH1: 3.0, reverseH2: -0.016,
    reverseQMin: 68, reverseQMax: 272,
    reverseEfficiencyFactor: 0.82,
  },

  // ─── ВМП (вентиляторы местного проветривания) ───────────────────────────────
  {
    id: "VME-2-10A",
    name: "ВМЭ 2-10А", type: "vmp", diameter: 1.0,
    h0: 5200, h1: -8, h2: -6.5,
    e0: 0.28, e1: 0.020, e2: -0.00080,
    qMin: 3.5, qMax: 18, qNominal: 10, hNominal: 3800,
    rpmMin: 0, rpmMax: 1480, rpmNominal: 1480,
    bladeAngles: [-40, -20, 0, 20, 60],
    reverseH0: 2200, reverseH1: -4, reverseH2: -4.0,
    reverseQMin: 2.5, reverseQMax: 14,
    reverseEfficiencyFactor: 0.78,
  },
  {
    id: "VM-6M",
    name: "ВМ-6М", type: "vmp", diameter: 0.6,
    h0: 2700, h1: -30, h2: -18,
    e0: 0.22, e1: 0.035, e2: -0.0045,
    qMin: 1.5, qMax: 7.5, qNominal: 4.0, hNominal: 1900,
    rpmMin: 0, rpmMax: 2980, rpmNominal: 2980,
    bladeAngles: [-45, -20, 0, 20, 45],
    reverseH0: 1100, reverseH1: -15, reverseH2: -12,
    reverseQMin: 1.2, reverseQMax: 6.0,
    reverseEfficiencyFactor: 0.76,
  },
  {
    id: "VM-8M",
    name: "ВМ-8М", type: "vmp", diameter: 0.8,
    h0: 3600, h1: -20, h2: -10,
    e0: 0.25, e1: 0.028, e2: -0.0025,
    qMin: 3.5, qMax: 12, qNominal: 7.0, hNominal: 2800,
    rpmMin: 0, rpmMax: 2980, rpmNominal: 2980,
    bladeAngles: [-50, -20, 0, 20, 45],
    reverseH0: 1700, reverseH1: -12, reverseH2: -7,
    reverseQMin: 2.8, reverseQMax: 9.5,
    reverseEfficiencyFactor: 0.78,
  },
  {
    id: "VME-12A",
    name: "ВМЭ-12А", type: "vmp", diameter: 1.2,
    h0: 2650, h1: -2, h2: -2.8,
    e0: 0.30, e1: 0.018, e2: -0.00055,
    qMin: 8, qMax: 32, qNominal: 18, hNominal: 2200,
    rpmMin: 0, rpmMax: 1480, rpmNominal: 1480,
    bladeAngles: [15, 25, 35],
    reverseH0: 1300, reverseH1: -1.5, reverseH2: -2.0,
    reverseQMin: 6, reverseQMax: 26,
    reverseEfficiencyFactor: 0.80,
  },
];

// ─── Вычисление H(Q) и η(Q) ────────────────────────────────────────────────
// Масштабирование по оборотам: закон подобия H ~ n², Q ~ n
export function fanHScaled(curve: FanCurve, Q: number, rpm: number): number {
  const n0 = curve.rpmNominal || 1;
  const k = rpm > 0 ? rpm / n0 : 1;
  const Qn = Math.abs(Q) / k;
  const H = curve.h0 + curve.h1 * Qn + curve.h2 * Qn * Qn;
  return Math.max(0, H) * k * k;
}

export function fanH(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  const H = curve.h0 + curve.h1 * q + curve.h2 * q * q;
  return Math.max(0, H);
}

// |dH/dQ| — модуль производной (нужен solver-у для устойчивости знаменателя в Кроссе)
// h2 обычно отрицательная (кривая H убывает с Q), поэтому без |...| знак может быть любым.
export function fanDH(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  return Math.abs(curve.h1 + 2 * curve.h2 * q);
}

export function fanEfficiency(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  const e = curve.e0 + curve.e1 * q + curve.e2 * q * q;
  return Math.min(0.85, Math.max(0.05, e));
}

// Мощность на валу (Вт): N = ΔP·Q / η
export function fanShaftPower(H: number, Q: number, eta: number): number {
  if (eta <= 0) return 0;
  return Math.abs(H * Q) / eta;
}

// ─── Поиск рабочей точки на Q-H кривой и квадратичной хар-ке сети ──────────
export function findOperatingPoint(curve: FanCurve, R: number): { Q: number; H: number } {
  const f = (Q: number) => fanH(curve, Q) - R * Q * Q;
  let lo = curve.qMin;
  let hi = curve.qMax;
  if (f(lo) * f(hi) > 0) {
    const Q = f(hi) > 0 ? hi : lo;
    return { Q, H: fanH(curve, Q) };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) < 0) hi = mid; else lo = mid;
    if (Math.abs(hi - lo) < 1e-4) break;
  }
  const Q = (lo + hi) / 2;
  return { Q, H: fanH(curve, Q) };
}

// Найти curve по id
export function getFanById(id: string): FanCurve | undefined {
  return FAN_CATALOG.find((f) => f.id === id);
}