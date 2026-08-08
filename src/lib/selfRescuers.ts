// ─────────────────────────────────────────────────────────────────────────────
// Справочник изолирующих самоспасателей, применяемых на подземных горных
// работах. Время защитного действия — паспортное, по режиму «выход по
// горизонтальной выработке в движении». При тяжёлой работе и подъёме
// фактическое время меньше, поэтому в расчёте зоны поражения предусмотрен
// коэффициент запаса.
// ─────────────────────────────────────────────────────────────────────────────

export interface SelfRescuerModel {
  id: string;
  name: string;
  /** Тип: химически связанный кислород (ХСК) или сжатый кислород */
  kind: "chemical" | "compressed";
  /** Время защитного действия при движении, мин */
  protectionTime: number;
  /** Время защитного действия в покое (ожидание помощи), мин */
  restTime: number;
  /** Масса, кг */
  mass: number;
}

export const SELF_RESCUER_CATALOG: SelfRescuerModel[] = [
  { id: "spp2",    name: "СПП-2 (ХСК)",              kind: "chemical",   protectionTime: 60,  restTime: 250, mass: 3.0 },
  { id: "spp4",    name: "СПП-4 (ХСК)",              kind: "chemical",   protectionTime: 50,  restTime: 200, mass: 2.4 },
  { id: "spp5",    name: "СПП-5 (ХСК)",              kind: "chemical",   protectionTime: 50,  restTime: 250, mass: 2.2 },
  { id: "shss1",   name: "ШСС-1 (ХСК)",              kind: "chemical",   protectionTime: 60,  restTime: 300, mass: 3.1 },
  { id: "shssm",   name: "ШСС-1М (ХСК)",             kind: "chemical",   protectionTime: 60,  restTime: 300, mass: 2.9 },
  { id: "shsst",   name: "ШСС-Т (ХСК)",              kind: "chemical",   protectionTime: 60,  restTime: 300, mass: 3.0 },
  { id: "ssp70",   name: "ССП-70 (ХСК)",             kind: "chemical",   protectionTime: 70,  restTime: 320, mass: 3.4 },
  { id: "sipm",    name: "СИП-М (сжатый кислород)",  kind: "compressed", protectionTime: 40,  restTime: 180, mass: 3.5 },
  { id: "pss90",   name: "ПСС-90 (сжатый кислород)", kind: "compressed", protectionTime: 90,  restTime: 360, mass: 4.5 },
];

/** Модель по id */
export function getSelfRescuerById(id: string | undefined): SelfRescuerModel | undefined {
  if (!id) return undefined;
  return SELF_RESCUER_CATALOG.find(m => m.id === id);
}
