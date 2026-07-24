// ─────────────────────────────────────────────────────────────────────────────
// Каталог перемычек шахтной вентиляции
// Данные по воздухопроницаемости и сопротивлению из АэроСети / ГОСТ
//
// Модель Q-H для перемычки: H = R_effective · Q²
// Воздухопроницаемость A [м²/(с·√Па)] → R = 1/A² [Па·с²/м⁴] = Мюрг
// Перемычка в сети добавляет R_bulkhead к R_branch (параллельно проходному
// сечению, если она установлена поперёк ветви — то последовательно).
// ─────────────────────────────────────────────────────────────────────────────

export type BulkheadType =
  | "solid"       // Глухая (непроницаемая)
  | "door"        // Вентиляционная дверь
  | "sail"        // Парус вентиляционный
  | "water"       // Водоподпорная
  | "regulator"   // Регулятор (с шибером)
  | "custom";     // Пользовательская

export interface BulkheadCatalogItem {
  id: string;
  name: string;
  type: BulkheadType;
  // Воздухопроницаемость A, м²/(с·√Па). 0 = абсолютно глухая.
  airPermeability: number;
  // Аэродинамическое сопротивление R, кМюрг (для расчёта: 1 кМюрг = 1 Па·с²/м⁴ × 10³)
  // Вычисляется как R = 1/(A²) при A>0, или "бесконечность" при A=0.
  // В расчёте используется rMkyurgs (числовое значение в Мюрг).
  rMin: number;   // мин. R, Мюрг (нижняя граница диапазона)
  rMax: number;   // макс. R, Мюрг (верхняя граница; = rMin если точное значение)
  // Давление разрушения, МПа (0 = не нормируется)
  failurePressure: number;
  // Примечание (ГОСТ, нормативный документ)
  note: string;
  // Цвет для отображения в таблице
  color: string;
}

// ─── Полный каталог перемычек (данные из АэроСети) ───────────────────────────
export const BULKHEAD_CATALOG: BulkheadCatalogItem[] = [
  // === ДВЕРИ ВЕНТИЛЯЦИОННЫЕ АВТОМАТИЧЕСКИЕ ===
  {
    id: "door_auto",
    name: "Дверь вентиляционная автоматическая",
    type: "door",
    airPermeability: 0.001,
    rMin: 1_000_000, rMax: 1_000_000,
    failurePressure: 0.16,
    note: "A=0,001 м²/(с·√Па)",
    color: "#1565c0",
  },
  {
    id: "door_auto_concrete",
    name: "Дверь вентиляционная автоматическая (бетонная)",
    type: "door",
    airPermeability: 0.003182,
    rMin: 98_712, rMax: 98_712,
    failurePressure: 0.08,
    note: "A=0,003182 м²/(с·√Па)",
    color: "#1565c0",
  },
  {
    id: "door_auto_wood",
    name: "Дверь вентиляционная автоматическая (деревянная)",
    type: "door",
    airPermeability: 0.016052,
    rMin: 3_880, rMax: 3_880,
    failurePressure: 0.01,
    note: "A=0,016052 м²/(с·√Па)",
    color: "#1565c0",
  },
  {
    id: "door_auto_brick",
    name: "Дверь вентиляционная автоматическая (кирпичная)",
    type: "door",
    airPermeability: 0.003863,
    rMin: 66_980, rMax: 66_980,
    failurePressure: 0.04,
    note: "A=0,003863 м²/(с·√Па)",
    color: "#1565c0",
  },
  {
    id: "door_auto_metal",
    name: "Дверь вентиляционная автоматическая (металлическая)",
    type: "door",
    airPermeability: 0.016052,
    rMin: 3_880, rMax: 3_880,
    failurePressure: 0.02,
    note: "A=0,016052 м²/(с·√Па)",
    color: "#1565c0",
  },

  // === ДВЕРИ ВЕНТИЛЯЦИОННЫЕ ЗАКРЫТЫЕ ===
  {
    id: "door_closed",
    name: "Дверь вентиляционная закрытая",
    type: "door",
    airPermeability: 0.001,
    rMin: 1_000_000, rMax: 1_000_000,
    failurePressure: 0.16,
    note: "A=0,001 м²/(с·√Па)",
    color: "#0288d1",
  },
  {
    id: "door_closed_concrete",
    name: "Дверь вентиляционная закрытая (бетонная)",
    type: "door",
    airPermeability: 0.003182,
    rMin: 98_712, rMax: 98_712,
    failurePressure: 0.08,
    note: "A=0,003182 м²/(с·√Па)",
    color: "#0288d1",
  },
  {
    id: "door_closed_wood",
    name: "Дверь вентиляционная закрытая (деревянная)",
    type: "door",
    airPermeability: 0.016052,
    rMin: 3_880, rMax: 3_880,
    failurePressure: 0.01,
    note: "A=0,016052 м²/(с·√Па)",
    color: "#0288d1",
  },
  {
    id: "door_closed_brick",
    name: "Дверь вентиляционная закрытая (кирпичная)",
    type: "door",
    airPermeability: 0.003863,
    rMin: 66_980, rMax: 66_980,
    failurePressure: 0.04,
    note: "A=0,003863 м²/(с·√Па)",
    color: "#0288d1",
  },
  {
    id: "door_closed_metal",
    name: "Дверь вентиляционная закрытая (металлическая)",
    type: "door",
    airPermeability: 0.016052,
    rMin: 3_880, rMax: 3_880,
    failurePressure: 0.02,
    note: "A=0,016052 м²/(с·√Па)",
    color: "#0288d1",
  },

  // === ПАРУС ВЕНТИЛЯЦИОННЫЙ ===
  {
    id: "sail",
    name: "Парус вентиляционный",
    type: "sail",
    airPermeability: 0.09,
    rMin: 123, rMax: 123,
    failurePressure: 0.005,
    note: "A=0,09 м²/(с·√Па), временная",
    color: "#ff6f00",
  },

  // === ПЕРЕМЫЧКИ ВОДОПОДПОРНЫЕ ===
  {
    id: "water_dam",
    name: "Перемычка водоподпорная",
    type: "water",
    airPermeability: 0.001,
    rMin: 1_000_000, rMax: 1_000_000,
    failurePressure: 0.16,
    note: "A=0,001 м²/(с·√Па)",
    color: "#6a1b9a",
  },
  {
    id: "water_dam_concrete",
    name: "Перемычка водоподпорная (бетонная)",
    type: "water",
    airPermeability: 0.003074,
    rMin: 105_800, rMax: 105_800,
    failurePressure: 0.08,
    note: "A=0,003074 м²/(с·√Па)",
    color: "#6a1b9a",
  },
  {
    id: "water_dam_wood",
    name: "Перемычка водоподпорная (деревянная)",
    type: "water",
    airPermeability: 0.01065,
    rMin: 8_818, rMax: 8_818,
    failurePressure: 0.01,
    note: "A=0,01065 м²/(с·√Па)",
    color: "#6a1b9a",
  },
  {
    id: "water_dam_brick",
    name: "Перемычка водоподпорная (кирпичная)",
    type: "water",
    airPermeability: 0.003765,
    rMin: 70_617, rMax: 70_617,
    failurePressure: 0.04,
    note: "A=0,003765 м²/(с·√Па)",
    color: "#6a1b9a",
  },
  {
    id: "water_dam_metal",
    name: "Перемычка водоподпорная (металлическая)",
    type: "water",
    airPermeability: 0.01065,
    rMin: 8_818, rMax: 8_818,
    failurePressure: 0.02,
    note: "A=0,01065 м²/(с·√Па)",
    color: "#6a1b9a",
  },

  // === ПЕРЕМЫЧКИ ГЛУХИЕ ===
  {
    id: "solid_dam",
    name: "Перемычка глухая",
    type: "solid",
    airPermeability: 0.001,
    rMin: 1_000_000, rMax: 1_000_000,
    failurePressure: 0.16,
    note: "A=0,001 м²/(с·√Па), ГОСТ 12.3.022",
    color: "#2e7d32",
  },
  {
    id: "solid_concrete",
    name: "Перемычка глухая (бетонная)",
    type: "solid",
    airPermeability: 0.003074,
    rMin: 105_800, rMax: 105_800,
    failurePressure: 0.08,
    note: "A=0,003074 м²/(с·√Па)",
    color: "#2e7d32",
  },
  {
    id: "solid_wood",
    name: "Перемычка глухая (деревянная)",
    type: "solid",
    airPermeability: 0.00308,
    rMin: 105_414, rMax: 105_414,
    failurePressure: 0.01,
    note: "A=0,00308 м²/(с·√Па)",
    color: "#558b2f",
  },
  {
    id: "solid_brick",
    name: "Перемычка глухая (кирпичная)",
    type: "solid",
    airPermeability: 0.003765,
    rMin: 70_617, rMax: 70_617,
    failurePressure: 0.04,
    note: "A=0,003765 м²/(с·√Па)",
    color: "#558b2f",
  },
  {
    id: "solid_metal",
    name: "Перемычка глухая (металлическая)",
    type: "solid",
    airPermeability: 0.01065,
    rMin: 8_818, rMax: 8_818,
    failurePressure: 0.02,
    note: "A=0,01065 м²/(с·√Па)",
    color: "#558b2f",
  },

  // === РЕГУЛЯТОР (ШИБЕР) ===
  {
    id: "regulator_10",
    name: "Регулятор (шибер), открытие 10%",
    type: "regulator",
    airPermeability: 0.005,
    rMin: 40_000, rMax: 40_000,
    failurePressure: 0,
    note: "Регулируемое R, открытие 10%",
    color: "#e65100",
  },
  {
    id: "regulator_30",
    name: "Регулятор (шибер), открытие 30%",
    type: "regulator",
    airPermeability: 0.015,
    rMin: 4_444, rMax: 4_444,
    failurePressure: 0,
    note: "Регулируемое R, открытие 30%",
    color: "#e65100",
  },
  {
    id: "regulator_50",
    name: "Регулятор (шибер), открытие 50%",
    type: "regulator",
    airPermeability: 0.04,
    rMin: 625, rMax: 625,
    failurePressure: 0,
    note: "Регулируемое R, открытие 50%",
    color: "#e65100",
  },
];

export const BULKHEAD_TYPE_LABELS: Record<BulkheadType, string> = {
  solid: "Глухая",
  door: "Дверь вентиляционная",
  sail: "Парус",
  water: "Водоподпорная",
  regulator: "Регулятор/шибер",
  custom: "Пользовательская",
};

export const BULKHEAD_TYPE_COLORS: Record<BulkheadType, string> = {
  solid: "#2e7d32",
  door: "#1565c0",
  sail: "#ff6f00",
  water: "#6a1b9a",
  regulator: "#e65100",
  custom: "#546e7a",
};

export function getBulkheadById(id: string): BulkheadCatalogItem | undefined {
  return BULKHEAD_CATALOG.find(b => b.id === id);
}

// Перевод воздухопроницаемости A → R в Мюрг
// H = Q² / A² → R = 1/A²  (при A в м²/(с·√Па), R в Па·с²/м⁴ = Мюрг)
export function airPermToR(A: number): number {
  if (A <= 0) return 1e9;
  return 1 / (A * A);
}

// Масштабный коэффициент для перевода 1/(A·S)² → кМюрг (калибровка по Аэросети).
// Проверено на эталоне: A=0,003074, S=16 м² → R≈42; S=33,2 м² → R≈10.
const BULKHEAD_R_SCALE = 9.7;

// Сопротивление ГЛУХОЙ перемычки (кМюрг) по УДЕЛЬНОЙ воздухопроницаемости A
// (м²/(с·√Па) на м² сечения) с учётом сечения выработки S (м²):
//   R = 1 / (A·S)² / SCALE
// Чем БОЛЬШЕ сечение выработки — тем МЕНЬШЕ сопротивление перемычки (как в
// Аэросети: S=16 м²→R≈42, S=33,2 м²→R≈10). Раньше сечение не учитывалось и R
// был константой 105,8 кМюрг во всех ветвях.
export function solidBulkheadRkMurg(A: number, area: number): number {
  const S = area > 0 ? area : 1;
  if (A <= 0) return 1e9;
  return 1 / (A * S * A * S) / BULKHEAD_R_SCALE;
}

// R перемычки в Мюрг → суммируется с R выработки последовательно
// При hasBulkhead=true: R_итог = R_выработка + R_перемычка
export function bulkheadR(item: BulkheadCatalogItem): number {
  return airPermToR(item.airPermeability);
}

// Эффективное сопротивление перемычки ветви в кМюрг.
// Повторяет логику networkSolver.ts (строки 357-377), чтобы значение
// совпадало с тем, что реально учитывается в расчёте сети.
// Возвращает R в кМюрг (1 кМюрг = 1 Н·с²/м⁸ в системе расчёта).
export function branchBulkheadRkMurg(b: {
  hasBulkhead?: boolean;
  bulkheadResMode?: "project" | "survey" | "manual";
  bulkheadManualR?: number;
  bulkheadSurveyQ?: number;
  bulkheadSurveyDP?: number;
  bulkheadManualAirPerm?: boolean;
  bulkheadCustomAirPerm?: number;
  bulkheadAirPerm?: number;
  bulkheadWindowArea?: number;
  bulkheadR?: number;
  area?: number;
}): number {
  if (!b.hasBulkhead) return 0;
  const mode = b.bulkheadResMode ?? "project";
  if (mode === "manual") return b.bulkheadManualR ?? 0;            // кМюрг
  if (mode === "survey") {
    const q = b.bulkheadSurveyQ ?? 0;
    const dp = b.bulkheadSurveyDP ?? 0;
    // R = ΔP/(Q²·9.81) кМюрг: ΔP в Па → кгс/м² (÷9.81), как в АэроСети.
    return q > 0 ? dp / (q * q * 9.81) : 1e9;                     // кМюрг
  }
  // project: перемычка с окном — R = ρ/(2·μ²·S²·g) кМюрг (μ=0.75, ρ=1.2, g=9.81).
  // Проверка: S=5.5 м² → 0.0036 кМюрг (совпадает с Аэросетью).
  const winA = b.bulkheadWindowArea ?? 0;
  if (winA > 0.001) {
    return 1.2 / (2 * 0.75 * 0.75 * winA * winA * 9.81);
  }
  // project: глухая перемычка → R = 1/(A·S)²/SCALE кМюрг (учёт сечения S).
  const area = b.area ?? 0;
  if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0) {
    return solidBulkheadRkMurg(b.bulkheadCustomAirPerm!, area);
  }
  if ((b.bulkheadAirPerm ?? 0) > 0) {
    return solidBulkheadRkMurg(b.bulkheadAirPerm!, area);
  }
  return b.bulkheadR ?? 0;                                        // fallback: кМюрг
}