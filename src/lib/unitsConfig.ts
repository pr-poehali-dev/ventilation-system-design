// Конфигурация единиц измерения — выбор отображаемых единиц для физических величин
// Данные хранятся в базовых единицах, при отображении пересчитываются

export interface UnitOption {
  id: string;
  label: string;          // отображаемое название
  symbol: string;         // символ единицы (для подписей на схеме)
  fromBase: (v: number) => number;  // перевод из базовой единицы
  toBase: (v: number) => number;    // перевод в базовую единицу
  decimals: number;       // знаков после запятой
}

export interface PhysicalQuantity {
  id: string;
  label: string;          // название физической величины
  baseUnit: string;       // базовая единица хранения
  units: UnitOption[];
  defaultUnitId: string;
}

// Все физические величины с вариантами единиц
export const PHYSICAL_QUANTITIES: PhysicalQuantity[] = [
  // ─── Расход воздуха ────────────────────────────────────────────
  {
    id: "flow",
    label: "Расход воздуха",
    baseUnit: "м³/с",
    defaultUnitId: "m3s",
    units: [
      { id: "m3s",  label: "Метр кубический в секунду",  symbol: "м³/с",  fromBase: v => v,        toBase: v => v,        decimals: 2 },
      { id: "m3min",label: "Метр кубический в минуту",   symbol: "м³/мин",fromBase: v => v * 60,   toBase: v => v / 60,   decimals: 1 },
      { id: "m3h",  label: "Метр кубический в час",      symbol: "м³/ч",  fromBase: v => v * 3600, toBase: v => v / 3600, decimals: 0 },
      { id: "ls",   label: "Литр в секунду",             symbol: "л/с",   fromBase: v => v * 1000, toBase: v => v / 1000, decimals: 1 },
    ],
  },
  // ─── Давление / депрессия ───────────────────────────────────────
  {
    id: "pressure",
    label: "Давление воздуха (депрессия)",
    baseUnit: "Па",
    defaultUnitId: "pa",
    units: [
      { id: "pa",    label: "Паскаль",           symbol: "Па",    fromBase: v => v,          toBase: v => v,          decimals: 1 },
      { id: "dapa",  label: "Декапаскаль",        symbol: "даПа",  fromBase: v => v / 10,     toBase: v => v * 10,     decimals: 2 },
      { id: "kpa",   label: "Килопаскаль",        symbol: "кПа",   fromBase: v => v / 1000,   toBase: v => v * 1000,   decimals: 3 },
      { id: "mmwc",  label: "Мм вод. ст.",        symbol: "мм.вд.ст.", fromBase: v => v / 9.81,   toBase: v => v * 9.81,   decimals: 2 },
      { id: "mpa",   label: "Мегапаскаль",        symbol: "МПа",   fromBase: v => v / 1e6,    toBase: v => v * 1e6,    decimals: 6 },
      { id: "atm",   label: "Атмосфера",          symbol: "атм",   fromBase: v => v / 101325,  toBase: v => v * 101325, decimals: 5 },
    ],
  },
  // ─── Скорость воздуха ────────────────────────────────────────────
  {
    id: "velocity",
    label: "Скорость воздуха",
    baseUnit: "м/с",
    defaultUnitId: "ms",
    units: [
      { id: "ms",   label: "Метр в секунду",  symbol: "м/с",   fromBase: v => v,      toBase: v => v,      decimals: 1 },
      { id: "mmin", label: "Метр в минуту",   symbol: "м/мин", fromBase: v => v * 60, toBase: v => v / 60, decimals: 1 },
      { id: "kmh",  label: "Километр в час",  symbol: "км/ч",  fromBase: v => v * 3.6,toBase: v => v / 3.6,decimals: 2 },
    ],
  },
  // ─── Аэродинамическое сопротивление ────────────────────────────
  {
    id: "resistance",
    label: "Аэродинамическое сопротивление",
    baseUnit: "Мюрг",
    defaultUnitId: "mkyurg",
    units: [
      { id: "mkyurg",  label: "Мюрг (Н·с²/м⁸·10⁻⁶)", symbol: "Мюрг",  fromBase: v => v,        toBase: v => v,        decimals: 3 },
      { id: "kmkyurg", label: "кМюрг (×10³ Мюрг)",    symbol: "кМюрг", fromBase: v => v / 1e3,  toBase: v => v * 1e3,  decimals: 4 },
      { id: "mmkyurg", label: "ММюрг (×10⁶ Мюрг)",    symbol: "ММюрг", fromBase: v => v / 1e6,  toBase: v => v * 1e6,  decimals: 6 },
    ],
  },
  // ─── Воздухопроницаемость перемычки ────────────────────────────
  {
    id: "airPermeability",
    label: "Воздухопроницаемость перемычки",
    baseUnit: "м²/(с·√Па)",
    defaultUnitId: "m2ssqpa",
    units: [
      { id: "m2ssqpa", label: "м²/(с·√Па)", symbol: "м²/(с·√Па)", fromBase: v => v,      toBase: v => v,      decimals: 6 },
      { id: "m2minsqpa", label: "м²/(мин·√Па)", symbol: "м²/(мин·√Па)", fromBase: v => v * 60, toBase: v => v / 60, decimals: 4 },
    ],
  },
  // ─── Давление разрушения ────────────────────────────────────────
  {
    id: "failurePressure",
    label: "Давление разрушения перемычки",
    baseUnit: "МПа",
    defaultUnitId: "mpa",
    units: [
      { id: "mpa",  label: "Мегапаскаль",   symbol: "МПа",  fromBase: v => v,         toBase: v => v,         decimals: 3 },
      { id: "kpa",  label: "Килопаскаль",   symbol: "кПа",  fromBase: v => v * 1000,  toBase: v => v / 1000,  decimals: 1 },
      { id: "pa",   label: "Паскаль",       symbol: "Па",   fromBase: v => v * 1e6,   toBase: v => v / 1e6,   decimals: 0 },
      { id: "atm",  label: "Атмосфера",     symbol: "атм",  fromBase: v => v * 9.869, toBase: v => v / 9.869, decimals: 3 },
    ],
  },
  // ─── Длина / координаты ─────────────────────────────────────────
  {
    id: "length",
    label: "Длина выработки / координаты",
    baseUnit: "м",
    defaultUnitId: "m",
    units: [
      { id: "m",  label: "Метр",        symbol: "м",  fromBase: v => v,       toBase: v => v,       decimals: 1 },
      { id: "km", label: "Километр",    symbol: "км", fromBase: v => v / 1000,toBase: v => v * 1000,decimals: 4 },
      { id: "mm", label: "Миллиметр",   symbol: "мм", fromBase: v => v * 1000,toBase: v => v / 1000,decimals: 0 },
      { id: "ft", label: "Фут",         symbol: "фут",fromBase: v => v * 3.281,toBase: v => v / 3.281,decimals: 2 },
    ],
  },
  // ─── Площадь сечения ────────────────────────────────────────────
  {
    id: "area",
    label: "Площадь сечения выработки",
    baseUnit: "м²",
    defaultUnitId: "m2",
    units: [
      { id: "m2",   label: "Метр квадратный",       symbol: "м²",   fromBase: v => v,          toBase: v => v,          decimals: 2 },
      { id: "cm2",  label: "Сантиметр квадратный",  symbol: "см²",  fromBase: v => v * 10000,  toBase: v => v / 10000,  decimals: 0 },
      { id: "mm2",  label: "Миллиметр квадратный",  symbol: "мм²",  fromBase: v => v * 1e6,    toBase: v => v / 1e6,    decimals: 0 },
    ],
  },
  // ─── Температура ────────────────────────────────────────────────
  {
    id: "temperature",
    label: "Температура воздуха",
    baseUnit: "°C",
    defaultUnitId: "celsius",
    units: [
      { id: "celsius",    label: "Цельсий",    symbol: "°C", fromBase: v => v,               toBase: v => v,               decimals: 1 },
      { id: "kelvin",     label: "Кельвин",    symbol: "К",  fromBase: v => v + 273.15,      toBase: v => v - 273.15,      decimals: 2 },
      { id: "fahrenheit", label: "Фаренгейт",  symbol: "°F", fromBase: v => v * 9/5 + 32,   toBase: v => (v - 32) * 5/9, decimals: 1 },
    ],
  },
  // ─── Мощность вентилятора ────────────────────────────────────────
  {
    id: "power",
    label: "Мощность вентилятора",
    baseUnit: "Вт",
    defaultUnitId: "kw",
    units: [
      { id: "w",   label: "Ватт",       symbol: "Вт",  fromBase: v => v,        toBase: v => v,        decimals: 0 },
      { id: "kw",  label: "Киловатт",   symbol: "кВт", fromBase: v => v / 1000, toBase: v => v * 1000, decimals: 2 },
      { id: "mw",  label: "Мегаватт",   symbol: "МВт", fromBase: v => v / 1e6,  toBase: v => v * 1e6,  decimals: 4 },
      { id: "hp",  label: "Лошадиная сила", symbol: "л.с.", fromBase: v => v / 735.5, toBase: v => v * 735.5, decimals: 3 },
    ],
  },
  // ─── Коэффициент аэродинамического трения (альфа) ───────────────
  {
    id: "alpha",
    label: "Коэффициент аэродинамического трения α",
    baseUnit: "кг/м³",
    defaultUnitId: "kgm3",
    units: [
      { id: "kgm3",   label: "Килограмм на метр кубический", symbol: "кг/м³",   fromBase: v => v,       toBase: v => v,       decimals: 4 },
      { id: "kgm3x4", label: "×10⁻⁴ кг/м³",                 symbol: "·10⁻⁴кг/м³",fromBase: v => v * 1e4,toBase: v => v / 1e4, decimals: 2 },
    ],
  },
  // ─── Газоносность ───────────────────────────────────────────────
  {
    id: "gasContent",
    label: "Газоносность пласта",
    baseUnit: "м³/т",
    defaultUnitId: "m3t",
    units: [
      { id: "m3t",   label: "Метр кубический на тонну",    symbol: "м³/т",  fromBase: v => v,      toBase: v => v,      decimals: 2 },
      { id: "m3m3",  label: "Метр кубический на метр куб.", symbol: "м³/м³", fromBase: v => v / 1.3,toBase: v => v * 1.3,decimals: 3 },
    ],
  },
  // ─── Концентрация газа ──────────────────────────────────────────
  {
    id: "gasConc",
    label: "Концентрация газа (CH₄, CO и др.)",
    baseUnit: "%",
    defaultUnitId: "percent",
    units: [
      { id: "percent", label: "Процент",         symbol: "%",   fromBase: v => v,         toBase: v => v,         decimals: 3 },
      { id: "ppm",     label: "Частей на млн.",  symbol: "ppm", fromBase: v => v * 10000, toBase: v => v / 10000, decimals: 0 },
      { id: "mgm3",    label: "Мг/м³",           symbol: "мг/м³", fromBase: v => v * 7.17 * 1000 / 100, toBase: v => v / (7.17 * 1000 / 100), decimals: 1 },
    ],
  },
  // ─── Плотность воздуха ──────────────────────────────────────────
  {
    id: "density",
    label: "Плотность воздуха",
    baseUnit: "кг/м³",
    defaultUnitId: "kgm3",
    units: [
      { id: "kgm3", label: "Килограмм на метр кубический", symbol: "кг/м³", fromBase: v => v,       toBase: v => v,       decimals: 3 },
      { id: "gm3",  label: "Грамм на метр кубический",     symbol: "г/м³",  fromBase: v => v * 1000,toBase: v => v / 1000,decimals: 1 },
    ],
  },
  // ─── Время ──────────────────────────────────────────────────────
  {
    id: "time",
    label: "Время",
    baseUnit: "с",
    defaultUnitId: "min",
    units: [
      { id: "s",   label: "Секунда", symbol: "с",    fromBase: v => v,        toBase: v => v,        decimals: 0 },
      { id: "min", label: "Минута",  symbol: "мин",  fromBase: v => v / 60,   toBase: v => v * 60,   decimals: 2 },
      { id: "h",   label: "Час",     symbol: "ч",    fromBase: v => v / 3600, toBase: v => v * 3600, decimals: 3 },
    ],
  },
  // ─── Масса ──────────────────────────────────────────────────────
  {
    id: "mass",
    label: "Масса",
    baseUnit: "кг",
    defaultUnitId: "kg",
    units: [
      { id: "kg", label: "Килограмм", symbol: "кг", fromBase: v => v,       toBase: v => v,       decimals: 2 },
      { id: "t",  label: "Тонна",     symbol: "т",  fromBase: v => v / 1000,toBase: v => v * 1000,decimals: 4 },
      { id: "g",  label: "Грамм",     symbol: "г",  fromBase: v => v * 1000,toBase: v => v / 1000,decimals: 0 },
    ],
  },
];

// Тип для хранения выбранных единиц: { [quantityId]: unitId }
export type UnitsConfig = Record<string, string>;

export const DEFAULT_UNITS_CONFIG: UnitsConfig = Object.fromEntries(
  PHYSICAL_QUANTITIES.map(q => [q.id, q.defaultUnitId])
);

// Получить опцию единицы по конфигу
export function getUnit(unitsConfig: UnitsConfig, quantityId: string): UnitOption {
  const q = PHYSICAL_QUANTITIES.find(q => q.id === quantityId);
  if (!q) return { id: "?", label: "?", symbol: "?", fromBase: v => v, toBase: v => v, decimals: 2 };
  const unitId = unitsConfig[quantityId] ?? q.defaultUnitId;
  return q.units.find(u => u.id === unitId) ?? q.units[0];
}

// Форматировать значение с переводом единиц
export function fmtUnit(
  value: number,
  quantityId: string,
  unitsConfig: UnitsConfig,
  opts?: { noSymbol?: boolean; forceDecimals?: number }
): string {
  const unit = getUnit(unitsConfig, quantityId);
  const converted = unit.fromBase(value);
  const d = opts?.forceDecimals ?? unit.decimals;
  const str = converted.toFixed(d);
  return opts?.noSymbol ? str : `${str} ${unit.symbol}`;
}
