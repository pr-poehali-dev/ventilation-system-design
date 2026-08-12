// ─────────────────────────────────────────────────────────────────────────────
// heaterCalculator.ts — расчёт подогрева воздуха калориферами.
//
// Калорифер ставится на ветвь (УО "heater") и подогревает проходящий по ней
// воздух. Физика — уравнение теплового баланса потока:
//
//     Q_тепл = G · cp · Δt        →       Δt = Q_тепл · η / (G · cp)
//
//   Q_тепл — тепловая мощность калорифера, кВт
//   G      — массовый расход воздуха через выработку, кг/с  (G = ρ · L)
//   cp     — теплоёмкость воздуха, 1,005 кДж/(кг·К)
//   η      — КПД калориферной установки (доли)
//   Δt     — подогрев воздуха, °C
//
// Обратная задача (пользователь задал температуру ЗА калорифером):
//     Q_потр = G · cp · (t_треб − t_вх) / η
//
// Нормативная привязка: подогрев воздуха, подаваемого в шахту, обязателен при
// отрицательных температурах — воздух в стволе должен подаваться с
// температурой не ниже +2 °C (ФНиП, требования к проветриванию стволов).
// ─────────────────────────────────────────────────────────────────────────────

/** Теплоёмкость воздуха при постоянном давлении, кДж/(кг·К) */
export const CP_AIR_KJ = 1.005;

/** Минимальная температура воздуха в стволе по нормативу, °C */
export const MIN_SHAFT_TEMP_C = 2;

/** КПД калориферной установки по умолчанию (доли) */
export const DEFAULT_HEATER_EFFICIENCY = 0.85;

export type HeatingSeason = "winter" | "summer";
export type HeaterMode = "winter" | "always" | "off";

/** Плотность воздуха по температуре, кг/м³ (ρ = 353/(273+t)) */
export function airDensity(tempC: number): number {
  const t = Math.max(-60, Math.min(200, tempC));
  return 353.0 / (273.0 + t);
}

/**
 * Работает ли калорифер сейчас.
 * "winter" — только в холодный сезон, "always" — всегда, "off" — никогда.
 */
export function isHeaterActive(mode: HeaterMode | undefined, season: HeatingSeason): boolean {
  const m = mode ?? "winter";
  if (m === "off") return false;
  if (m === "always") return true;
  return season === "winter";
}

export interface HeaterCalcInput {
  /** Способ задания: по мощности или по требуемой температуре за калорифером */
  method: "power" | "temp";
  /** Тепловая мощность, кВт (для method="power") */
  power_kW: number;
  /** Требуемая температура за калорифером, °C (для method="temp") */
  outTemp_C: number;
  /** КПД установки, доли */
  efficiency: number;
  /** Температура воздуха ПЕРЕД калорифером, °C */
  inTemp_C: number;
  /** Объёмный расход воздуха через ветвь, м³/с */
  airFlow_m3s: number;
}

export interface HeaterCalcResult {
  /** Подогрев воздуха, °C */
  deltaT_C: number;
  /** Температура воздуха за калорифером, °C */
  outTemp_C: number;
  /** Фактическая (для method="power") или потребная (для "temp") мощность, кВт */
  power_kW: number;
  /** Массовый расход воздуха, кг/с */
  massFlow_kgs: number;
  /** Норматив выполнен: за калорифером не ниже +2 °C */
  meetsNorm: boolean;
}

/**
 * Расчёт подогрева воздуха одним калорифером.
 * При нулевом расходе нагрев не считается: без движения воздуха тепловой
 * баланс потока неприменим (иначе Δt уходит в бесконечность).
 */
export function calcHeater(inp: HeaterCalcInput): HeaterCalcResult {
  const eff = inp.efficiency > 0 ? Math.min(1, inp.efficiency) : DEFAULT_HEATER_EFFICIENCY;
  const rho = airDensity(inp.inTemp_C);
  const massFlow = Math.abs(inp.airFlow_m3s) * rho; // кг/с

  if (massFlow <= 0.001) {
    return {
      deltaT_C: 0,
      outTemp_C: inp.inTemp_C,
      power_kW: 0,
      massFlow_kgs: 0,
      meetsNorm: inp.inTemp_C >= MIN_SHAFT_TEMP_C,
    };
  }

  if (inp.method === "temp") {
    // Задана температура за калорифером — считаем ПОТРЕБНУЮ мощность.
    // Охлаждать калорифер не может: если воздух уже теплее требуемого, Δt=0.
    const dt = Math.max(0, inp.outTemp_C - inp.inTemp_C);
    const powerNeeded = (massFlow * CP_AIR_KJ * dt) / eff; // кВт
    const outT = inp.inTemp_C + dt;
    return {
      deltaT_C: dt,
      outTemp_C: outT,
      power_kW: powerNeeded,
      massFlow_kgs: massFlow,
      meetsNorm: outT >= MIN_SHAFT_TEMP_C,
    };
  }

  // Задана мощность — считаем фактический подогрев.
  const dt = (Math.max(0, inp.power_kW) * eff) / (massFlow * CP_AIR_KJ);
  const outT = inp.inTemp_C + dt;
  return {
    deltaT_C: dt,
    outTemp_C: outT,
    power_kW: Math.max(0, inp.power_kW),
    massFlow_kgs: massFlow,
    meetsNorm: outT >= MIN_SHAFT_TEMP_C,
  };
}
