// ─────────────────────────────────────────────────────────────────────────────
// Q-H характеристики шахтных вентиляторов главного проветривания
// (центробежные ВЦ, осевые ВОД, ВЦД)
//
// Модель: H(Q) = h0 + h1·Q + h2·Q²  (Па, при Q в м³/с)
// КПД:    η(Q) = e0 + e1·Q + e2·Q²  (доли единицы, ограничена 0.05–0.85)
//
// Коэффициенты подобраны под типовые паспортные характеристики
// (используются в АэроСети/Вентиляции 2.0 как справочные).
// ─────────────────────────────────────────────────────────────────────────────

export interface FanCurve {
  id: string;
  name: string;
  type: "centrifugal" | "axial";
  // H(Q) = h0 + h1·Q + h2·Q²
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
}

// Справочник типовых вентиляторов
export const FAN_CATALOG: FanCurve[] = [
  {
    id: "VC-15",
    name: "ВЦ-15 (центробежный)", type: "centrifugal",
    h0: 3200, h1: 4, h2: -0.08,
    e0: 0.20, e1: 0.012, e2: -0.00012,
    qMin: 20, qMax: 120, qNominal: 70, hNominal: 3000,
  },
  {
    id: "VC-25",
    name: "ВЦ-25 (центробежный)", type: "centrifugal",
    h0: 4500, h1: 5, h2: -0.04,
    e0: 0.25, e1: 0.0065, e2: -0.000035,
    qMin: 50, qMax: 250, qNominal: 150, hNominal: 4200,
  },
  {
    id: "VC-32",
    name: "ВЦ-32 (центробежный главный)", type: "centrifugal",
    h0: 5500, h1: 4, h2: -0.018,
    e0: 0.30, e1: 0.0040, e2: -0.0000125,
    qMin: 100, qMax: 400, qNominal: 250, hNominal: 4800,
  },
  {
    id: "VC-47",
    name: "ВЦД-47 (центробежный двустор.)", type: "centrifugal",
    h0: 6800, h1: 3.5, h2: -0.0085,
    e0: 0.32, e1: 0.0028, e2: -0.0000058,
    qMin: 150, qMax: 600, qNominal: 380, hNominal: 5500,
  },
  {
    id: "VOD-21",
    name: "ВОД-21 (осевой)", type: "axial",
    h0: 1800, h1: 8, h2: -0.18,
    e0: 0.30, e1: 0.018, e2: -0.00025,
    qMin: 15, qMax: 90, qNominal: 50, hNominal: 1900,
  },
  {
    id: "VOD-30",
    name: "ВОД-30 (осевой)", type: "axial",
    h0: 2400, h1: 6, h2: -0.045,
    e0: 0.35, e1: 0.0080, e2: -0.000062,
    qMin: 40, qMax: 200, qNominal: 120, hNominal: 2700,
  },
  {
    id: "VOD-40",
    name: "ВОД-40 (осевой главный)", type: "axial",
    h0: 3000, h1: 5, h2: -0.020,
    e0: 0.38, e1: 0.0050, e2: -0.000022,
    qMin: 80, qMax: 320, qNominal: 200, hNominal: 3200,
  },
];

// ─── Вычисление H(Q) и η(Q) ────────────────────────────────────────────────
export function fanH(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  const H = curve.h0 + curve.h1 * q + curve.h2 * q * q;
  return Math.max(0, H);
}

// dH/dQ — производная (нужна solver-у для метода Ньютона)
export function fanDH(curve: FanCurve, Q: number): number {
  const q = Math.abs(Q);
  return curve.h1 + 2 * curve.h2 * q;
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
// Сеть: H_net(Q) = R · Q²  (R — эквивалентное сопротивление от вход-выхода вент.)
// Точка работы: H_fan(Q*) = H_net(Q*)
// Метод бисекции по Q ∈ [qMin, qMax]
export function findOperatingPoint(curve: FanCurve, R: number): { Q: number; H: number } {
  const f = (Q: number) => fanH(curve, Q) - R * Q * Q;
  let lo = curve.qMin;
  let hi = curve.qMax;
  // Если на границах знаки одинаковые — берём ближайшую к нулю
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
