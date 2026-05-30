// ─────────────────────────────────────────────────────────────────────────────
// Справочник редукционных клапанов для водопровода ППЗ (противопожарная защита)
// Источник: технические паспорта КППР, РД, КРД серий для горнодобывающих предприятий
// ─────────────────────────────────────────────────────────────────────────────

export interface PressureReducingValve {
  id: string;
  name: string;             // Наименование модели
  manufacturer: string;     // Производитель
  inletPressureMax: number; // МПа — макс. входное давление
  outletPressureMin: number;// МПа — мин. настраиваемое выходное давление
  outletPressureMax: number;// МПа — макс. настраиваемое выходное давление
  flowMax: number;          // м³/ч — максимальный расход
  nominalDiameter: number;  // мм — условный проход (DN)
  note?: string;            // Примечание
}

export const PRESSURE_REDUCING_VALVES: PressureReducingValve[] = [
  {
    id: "kppr_50",
    name: "КППР-50",
    manufacturer: "ВостНИИ",
    inletPressureMax: 1.6,
    outletPressureMin: 0.3,
    outletPressureMax: 1.0,
    flowMax: 25,
    nominalDiameter: 50,
    note: "Шахтный клапан, DN50",
  },
  {
    id: "kppr_65",
    name: "КППР-65",
    manufacturer: "ВостНИИ",
    inletPressureMax: 1.6,
    outletPressureMin: 0.3,
    outletPressureMax: 1.0,
    flowMax: 45,
    nominalDiameter: 65,
    note: "Шахтный клапан, DN65",
  },
  {
    id: "rd_40",
    name: "РД-40",
    manufacturer: "Гидроприбор",
    inletPressureMax: 1.6,
    outletPressureMin: 0.2,
    outletPressureMax: 0.8,
    flowMax: 18,
    nominalDiameter: 40,
    note: "Рудниковый DN40",
  },
  {
    id: "krd_50",
    name: "КРД-50",
    manufacturer: "Пожтехника",
    inletPressureMax: 2.0,
    outletPressureMin: 0.2,
    outletPressureMax: 1.0,
    flowMax: 30,
    nominalDiameter: 50,
    note: "Пожарный DN50, ГОСТ Р 53325",
  },
  {
    id: "krd_65",
    name: "КРД-65",
    manufacturer: "Пожтехника",
    inletPressureMax: 2.0,
    outletPressureMin: 0.2,
    outletPressureMax: 1.0,
    flowMax: 55,
    nominalDiameter: 65,
    note: "Пожарный DN65, ГОСТ Р 53325",
  },
  {
    id: "vrk_50",
    name: "ВРК-50",
    manufacturer: "МашУгля",
    inletPressureMax: 1.6,
    outletPressureMin: 0.3,
    outletPressureMax: 0.9,
    flowMax: 22,
    nominalDiameter: 50,
    note: "Для угольных шахт, DN50",
  },
  {
    id: "vrk_65",
    name: "ВРК-65",
    manufacturer: "МашУгля",
    inletPressureMax: 1.6,
    outletPressureMin: 0.3,
    outletPressureMax: 0.9,
    flowMax: 40,
    nominalDiameter: 65,
    note: "Для угольных шахт, DN65",
  },
  {
    id: "manual",
    name: "Задать вручную",
    manufacturer: "",
    inletPressureMax: 9.9,
    outletPressureMin: 0.1,
    outletPressureMax: 9.9,
    flowMax: 9999,
    nominalDiameter: 0,
    note: "Пользовательские параметры",
  },
];

export function getValveById(id: string): PressureReducingValve | undefined {
  return PRESSURE_REDUCING_VALVES.find(v => v.id === id);
}

// 1 атм ≈ 0.1 МПа (точнее 0.101325, но в пожарном деле используют 0.1)
export const ATM_TO_MPA = 0.1;
export const MPA_TO_ATM = 10;
