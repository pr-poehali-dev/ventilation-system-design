// ─────────────────────────────────────────────────────────────────────────────
// ventDucts.ts — справочник марок гибких вентиляционных рукавов (вентстава).
//
// Марка задаёт паспортные характеристики рукава: диаметр, удельные потери
// (утечки) на 100 м става, предельное рабочее давление, стойкость мембраны,
// диапазон температур, электростатическое сопротивление и кислородный индекс.
//
// Зачем это в расчёте:
//   • «Потери на 100 м вентстава» — прямой аналог коэффициента утечек, идёт в
//     расчёт вентрубопровода;
//   • «Рабочее давление» — предел, выше которого рукав раздувает/рвёт; расчётное
//     давление ВМП сверяется с ним и выдаётся предупреждение;
//   • электростатическое сопротивление и кислородный индекс — требования по
//     искробезопасности и горючести для шахт, опасных по газу и пыли (AS —
//     antistatic).
// ─────────────────────────────────────────────────────────────────────────────

export interface VentDuctSize {
  /** Внутренний диаметр рукава, мм */
  diameter: number;
  /** Потери (утечки) на 100 м вентстава, не более, % */
  lossPer100m: number;
  /** Рабочее давление на нагнетание, не более, Па */
  workPressure: number;
}

export interface VentDuctBrand {
  id: string;
  /** Марка рукава */
  name: string;
  /** Производитель / серия */
  maker?: string;
  /** Типоразмеры */
  sizes: VentDuctSize[];
  /** Плотность мембраны, г/м² */
  density: number;
  /** Допуск на плотность, % */
  densityTol: number;
  /** Адгезия сварного шва, не менее, Н */
  seamAdhesion: number;
  /** Сопротивление мембраны на разрыв по утку, не менее, Н */
  tensileWeft: number;
  /** Сопротивление мембраны на разрыв по основе, не менее, Н */
  tensileWarp: number;
  /** Сопротивление на раздирание по утку, не менее, Н */
  tearWeft: number;
  /** Сопротивление на раздирание по основе, не менее, Н */
  tearWarp: number;
  /** Воздухопроницаемость, не более, мм²/м² */
  airPermeability: number;
  /** Минимальная температура эксплуатации, °C */
  tempMin: number;
  /** Максимальная температура эксплуатации, °C */
  tempMax: number;
  /** Электростатическое сопротивление, не более, Ом */
  staticResistance: number;
  /** Кислородный индекс, не менее, % */
  oxygenIndex: number;
  /** Коэффициент α для расчёта R = 6.48·α·L/D⁵, ×10⁻⁴ Н·с²/м⁴ */
  alpha: number;
  /** Антистатическое исполнение (искробезопасность) */
  antistatic: boolean;
}

export const VENT_DUCT_BRANDS: VentDuctBrand[] = [
  {
    id: "kolavent_flex_as",
    name: "KolaVent Flex AS",
    maker: "Вентиляционный рукав",
    sizes: [
      { diameter: 1000, lossPer100m: 1.2, workPressure: 18000 },
      { diameter: 1200, lossPer100m: 1.2, workPressure: 16000 },
    ],
    density: 730,
    densityTol: 5,
    seamAdhesion: 60,
    tensileWeft: 2400,
    tensileWarp: 2200,
    tearWeft: 500,
    tearWarp: 380,
    airPermeability: 8.5,
    tempMin: -40,
    tempMax: 70,
    staticResistance: 3e8,
    oxygenIndex: 25,
    // Коэффициент аэродинамического сопротивления по данным изготовителя
    // («О системе расчётов», п. 2): α = 0,00024 кг·с²/м⁴ для всех типоразмеров.
    // Здесь α хранится в единицах ×10⁻⁴, поэтому 0,00024 → 2,4.
    //
    // ВНИМАНИЕ: раньше здесь стояло 0,25, то есть 0,000025 — в десять раз
    // меньше паспортного. Сопротивление става и его депрессия занижались на
    // порядок, из-за чего расчёт показывал заведомо проходной став там, где
    // вентилятора на самом деле не хватает.
    // Проверка по таблице 2 изготовителя (R = 6,48·α·L/D⁵): при α = 2,4
    // расчёт сходится с табличными значениями с отклонением 4–6 % в запас.
    alpha: 2.4,
    antistatic: true,
  },
];

export function getDuctBrand(id: string | undefined): VentDuctBrand | undefined {
  if (!id) return undefined;
  return VENT_DUCT_BRANDS.find(b => b.id === id);
}

export function getDuctSize(brand: VentDuctBrand | undefined, diameter: number): VentDuctSize | undefined {
  if (!brand) return undefined;
  return brand.sizes.find(s => s.diameter === diameter);
}

/** Форматирует электростатическое сопротивление: 3e8 → «3·10⁸» */
export function formatStaticResistance(v: number): string {
  const exp = Math.floor(Math.log10(v));
  const mant = v / Math.pow(10, exp);
  const sup = String(exp).replace(/\d/g, d => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(d)]);
  const m = Number.isInteger(mant) ? String(mant) : mant.toFixed(1);
  return `${m}·10${sup}`;
}