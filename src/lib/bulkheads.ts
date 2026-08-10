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
    rMin: 52, rMax: 52,
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
    airPermeability: 0.01065,
    rMin: 8_817, rMax: 8_817,
    failurePressure: 0.01,
    note: "A=0,01065 м²/(с·√Па)",
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

// Масштабный коэффициент формулы 1/(A·S)² → кМюрг = ускорение свободного
// падения g (9,80665), как в АэроСети. Проверено по эталонам АэроСети:
//   кирпичная A=0,003765, S=10,5 → R=65,248535 (точно совпадает);
//   дверь кирп. A=0,003863 → R≈62;  деревянная A=0,01065 → R≈8,15;
//   парус A=0,09, S=15,5 → R≈0,052.
const BULKHEAD_R_SCALE = 9.80665;

// Сопротивление ГЛУХОЙ перемычки/паруса (кМюрг) по УДЕЛЬНОЙ воздухопроницаемости
// A (м²/(с·√Па) на м² сечения) с учётом сечения выработки S (м²):
//   R = 1 / (A·S)² / SCALE
// Сечение входит в формулу (как в АэроСети): чем больше S — тем меньше R.
export function solidBulkheadRkMurg(A: number, area?: number): number {
  const S = area && area > 0 ? area : 1;
  if (A <= 0) return 1e9;
  return 1 / (A * S * A * S) / BULKHEAD_R_SCALE;
}

// Парус вентиляционный считается по той же формуле, что и глухая перемычка
// (сечение входит в формулу). Проверка: A=0,09, S=15,5 → R≈0,053 кМюрг.
// Отдельная функция оставлена для совместимости внешних вызовов.
export function sailBulkheadRkMurg(A: number, area?: number): number {
  return solidBulkheadRkMurg(A, area);
}

// Коэффициент расхода регулируемого окна/проёма (диафрагма с острой кромкой).
// Зависит от ТИПА двери (материала), как в АэроСети:
//   металлическая/прочие — μ=0,59 (эталон: окно 2 м² → 0,044 кМюрг);
//   бетонная            — μ=0,75 с учётом скорости подхода в выработке
//                         (эталон: окно 5,5 м², сечение 19,3 м² → 0,00326 кМюрг).
const WINDOW_MU = 0.59;          // по умолчанию (металл и пр.)
const WINDOW_MU_CONCRETE = 0.75; // бетонная дверь с окном
const WINDOW_MU_BRICK = 0.66;    // кирпичная дверь с окном
const WINDOW_MU_WOOD = 0.8148;   // деревянная дверь с окном
// Открытая металлическая дверь: эталон АэроСеть — окно 10 м², сечение 14,6 м²
// → R = 0,00038 кМюрг. Открытая створка почти не сужает поток, поэтому μ выше,
// чем у решётчатой и глухой двери.
const WINDOW_MU_OPEN_METAL = 0.9245;
// Ускорение свободного падения — переводной множитель между «нашими» единицами
// сопротивления (Н·с²/м⁸, ΔP = R·Q² в Па) и рудничными кМюрг АэроСети
// (кгс·с²/м⁸, ΔP = R·Q²·g). R_нашего = R_АэроСети · g.
export const G_ACCEL = 9.80665;

// Тип окна БЕТОННЫЙ? (id заканчивается на "_conc"): для него АэроСеть считает
// диафрагму с учётом скорости подхода в выработке.
function isConcreteWindow(typeId?: string): boolean {
  return !!typeId && /_conc$/.test(typeId);
}

// Тип окна КИРПИЧНЫЙ? (id заканчивается на "_brick"): диафрагма с учётом скорости
// подхода, как у бетонной, но μ=0,66.
function isBrickWindow(typeId?: string): boolean {
  return !!typeId && /_brick$/.test(typeId);
}

// Тип окна ДЕРЕВЯННЫЙ? (id заканчивается на "_wood"): диафрагма с учётом скорости
// подхода, как у бетонной, но μ=0,8148.
function isWoodWindow(typeId?: string): boolean {
  return !!typeId && /_wood$/.test(typeId);
}

// Дверь вентиляционная РЕШЁТЧАТАЯ МЕТАЛЛИЧЕСКАЯ ("lat_metal") — ОТДЕЛЬНЫЙ расчёт.
//
// У этой двери коэффициент расхода НЕ постоянный: он зависит от степени
// открытия m = Sок/Sвыр. Два эталона АэроСети это подтверждают —
// одним μ их описать нельзя:
//   окно 8 м², сечение 15,3 м² (m=0,523) → R=0,00100 кМюрг  (эквивалент μ≈0,833)
//   окно 5 м², сечение 20,0 м² (m=0,250) → R=0,00470 кМюрг  (эквивалент μ≈0,699)
//
// Поэтому считаем через безразмерный коэффициент сопротивления диафрагмы
// (форма Идельчика для внезапного сужения с острой кромкой):
//   ζ = (1 + k·(1−m)^n − m)²,  скорость отнесена к площади окна
//   R_кМюрг = ζ·ρ/(2·g·Sок²)
// Параметры k и n откалиброваны ровно по двум эталонам выше (совпадение 0,00%).
// Модель физична: при m→1 (окно во всё сечение) ζ→0, при m→0 растёт.
const LAT_METAL_K = 0.7008;
const LAT_METAL_N = 0.3381;

function isLatticeMetalWindow(typeId?: string): boolean {
  return typeId === "lat_metal";
}

// R решётчатой металлической двери в кМюрг по калиброванной модели диафрагмы.
function latticeMetalRkMurg(windowArea: number, sectionArea?: number): number {
  const Sok = windowArea;
  if (Sok <= 0.001) return 0;
  const S = sectionArea && sectionArea > 0 ? sectionArea : 0;
  // Без известного сечения степень открытия определить нельзя — берём
  // предельный случай m=0 (окно много меньше выработки).
  const m = S > 0 ? Math.min(1, Sok / S) : 0;
  const zeta = Math.pow(1 + LAT_METAL_K * Math.pow(1 - m, LAT_METAL_N) - m, 2);
  const r = zeta * 1.2 / (2 * G_ACCEL * Sok * Sok);
  return r > 0 ? r : 0;
}

// Дверь вентиляционная ОТКРЫТАЯ МЕТАЛЛИЧЕСКАЯ ("open_metal") с заданным окном.
// Считается как диафрагма С УЧЁТОМ скорости подхода (μ=0,9245).
// Эталон: окно 10 м², сечение 14,6 м² → R = 0,00038 кМюрг.
// Прежняя формула (μ=0,59, без подхода) давала 0,00176 — завышение в 4,6 раза.
function isOpenMetalWindow(typeId?: string): boolean {
  return typeId === "open_metal";
}

// Сопротивление перемычки с РЕГУЛИРУЕМЫМ ОКНОМ в кМюрг (кгс·с²/м⁸ — те же
// единицы, что и solidBulkheadRkMurg).
//
// Металлическая/прочие двери (μ=0,59): перепад определяется СКОРОСТЬЮ ВОЗДУХА
// В ОКНЕ (Q/Sок), сечение выработки не влияет:
//   ΔP_Па = ρ/2·(Q/(μ·Sок))²  ⇒  R_кМюрг = ρ/(2·g·μ²·Sок²)
//   Проверка: Sок=2 → R≈0,044 кМюрг (совпадает с АэроСетью).
//
// Бетонная дверь (μ=0,75): диафрагма С УЧЁТОМ скорости подхода в выработке —
// вычитается динамический напор набегающего потока (1/Sвыр²):
//   R_кМюрг = ρ/(2·g·μ²)·(1/Sок² − 1/Sвыр²)
//   Проверка: Sок=5,5, Sвыр=19,3 → R≈0,00326 кМюрг (совпадает с АэроСетью).
//
// Кирпичная дверь (μ=0,66): та же диафрагма с учётом подхода, что и бетонная:
//   R_кМюрг = ρ/(2·g·μ²)·(1/Sок² − 1/Sвыр²)
//   Проверка: Sок=2, Sвыр=15,5 → R≈0,035 кМюрг (совпадает с АэроСетью).
//
// Деревянная дверь (μ=0,8148): та же диафрагма с учётом подхода:
//   R_кМюрг = ρ/(2·g·μ²)·(1/Sок² − 1/Sвыр²)
//   Проверка: Sок=0,1, Sвыр=0,2 → R≈6,911 кМюрг (совпадает с АэроСетью).
//
// Решётчатая металлическая дверь "lat_metal" — считается ОТДЕЛЬНОЙ функцией
// latticeMetalRkMurg (переменный коэффициент, зависит от степени открытия).
//   Проверка: Sок=8, Sвыр=15,3 → 0,00100; Sок=5, Sвыр=20 → 0,00470 кМюрг.
//
// Открытая металлическая дверь "open_metal" (μ=0,9245): та же диафрагма с
// учётом подхода; открытая створка почти не сужает поток, поэтому μ выше:
//   Проверка: Sок=10, Sвыр=14,6 → R≈0,00038 кМюрг (совпадает с АэроСетью).
export function windowBulkheadRkMurg(windowArea: number, sectionArea?: number, typeId?: string): number {
  const Sok = windowArea;
  if (Sok <= 0.001) return 0;
  // Решётчатая металлическая — отдельная модель с переменным коэффициентом.
  if (isLatticeMetalWindow(typeId)) {
    return latticeMetalRkMurg(Sok, sectionArea);
  }
  if (isConcreteWindow(typeId) || isBrickWindow(typeId) || isWoodWindow(typeId)
      || isOpenMetalWindow(typeId)) {
    const mu = isBrickWindow(typeId)     ? WINDOW_MU_BRICK
             : isWoodWindow(typeId)      ? WINDOW_MU_WOOD
             : isOpenMetalWindow(typeId) ? WINDOW_MU_OPEN_METAL
             : WINDOW_MU_CONCRETE;
    const S = sectionArea && sectionArea > 0 ? sectionArea : 0;
    const approach = S > 0 ? 1 / (S * S) : 0;
    const r = 1.2 / (2 * G_ACCEL * mu * mu) * (1 / (Sok * Sok) - approach);
    return r > 0 ? r : 0;
  }
  return 1.2 / (2 * G_ACCEL * WINDOW_MU * WINDOW_MU * Sok * Sok);
}

// Коэффициент расхода окна ВЕНТИЛЯТОРНОЙ УСТАНОВКИ (ГВУ), установленной «внутри
// перемычки». Откалиброван по эталону «Аэросеть»: ГВУ ВЦД-47, ΔS=17,35 м²,
// сечение ствола S=38,5 м², 350 об/мин → рабочая точка Q=515 м³/с, H=1727 Па
// (R окна ≈0,00464 кМюрг). Формула — диафрагма с учётом скорости подхода.
export const FAN_WINDOW_MU = 0.5851;

// Сопротивление вентиляционного окна ГВУ в кМюрг (кгс·с²/м⁸ — те же единицы, что
// solidBulkheadRkMurg/windowBulkheadRkMurg). Формула диафрагмы с учётом скорости
// подхода (как у окон перемычек windowBulkheadRkMurg):
//   R_кМюрг = ρ/(2·μ²)·(1/ΔS² − 1/S²)
//   где ΔS — площадь окна, S — сечение выработки (ствола).
//   Проверка: ΔS=17,35, S=38,5 → R≈0,00464 кМюрг (Q=515 в сети Аэросеть ✓).
export function fanWindowRkMurg(windowArea: number, sectionArea?: number): number {
  const dS = windowArea;
  if (dS <= 0.001) return 0;
  const S = sectionArea && sectionArea > 0 ? sectionArea : 0;
  const approach = S > 0 ? 1 / (S * S) : 0;
  const r = 1.2 / (2 * FAN_WINDOW_MU * FAN_WINDOW_MU) * (1 / (dS * dS) - approach);
  return r > 0 ? r : 0;
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
  bulkheadId?: string;
  bulkheadName?: string;
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
  // project: перемычка с окном — R = ρ/(2·μ²·Sок²) кМюрг (μ=0.62, ρ=1.2).
  // Перепад по скорости в окне (диафрагма), как в АэроСети. См. windowBulkheadRkMurg.
  const winA = b.bulkheadWindowArea ?? 0;
  if (winA > 0.001) {
    return windowBulkheadRkMurg(winA, b.area ?? 0, b.bulkheadId);
  }
  // project: глухая перемычка/парус → R = 1/(A·S)²/SCALE кМюрг (учёт сечения S).
  const area = b.area ?? 0;
  if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0) {
    return solidBulkheadRkMurg(b.bulkheadCustomAirPerm!, area);
  }
  if ((b.bulkheadAirPerm ?? 0) > 0) {
    return solidBulkheadRkMurg(b.bulkheadAirPerm!, area);
  }
  return b.bulkheadR ?? 0;                                        // fallback: кМюрг
}