// ─────────────────────────────────────────────────────────────────────────────
// Каталог потребителей воды противопожарного водопровода:
// пожарные стволы, водовоздушные распылители, установки пенного тушения.
// Данные используются для автоподстановки требуемого расхода и диаметра
// выходного отверстия в свойствах узла-потребителя.
// Источник: справочные таблицы характеристик пожарных стволов.
// ─────────────────────────────────────────────────────────────────────────────

export type ConsumerGroup = "barrel" | "sprayer" | "foam";

export interface WaterConsumerModel {
  id: string;
  name: string;              // Наименование
  group: ConsumerGroup;      // группа для отображения
  outletDiameter: number;    // диаметр выходного отверстия, мм (0 если не задан)
  flowLps: number;           // расход воды, л/с
  flowM3h: number;           // расход воды, м³/ч
  flowLmin: number;          // расход воды, л/мин
  extinguishArea: number;    // площадь тушения, м²
  jetRange: string;          // дальность вод. струи
  workPressureMPa: string;   // рабочее давление, МПа
  workPressureAtm: string;   // рабочее давление, кгс/см²
}

export const CONSUMER_GROUP_NAMES: Record<ConsumerGroup, string> = {
  barrel: "Пожарные стволы",
  sprayer: "Распылители / генераторы пены",
  foam: "Установки пенного тушения",
};

// ─── Каталог моделей ────────────────────────────────────────────────────────
export const CONSUMER_CATALOG: WaterConsumerModel[] = [
  // ═══ Пожарные стволы ═══════════════════════════════════════════════════════
  { id: "rs50_16", name: "Ствол пожарный РС-50 (выходное отверстие 16 мм)", group: "barrel",
    outletDiameter: 16, flowLps: 5.5, flowM3h: 19.8, flowLmin: 330, extinguishArea: 36.7,
    jetRange: "33 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "rs50_12", name: "Ствол пожарный РС-50 (выходное отверстие 12 мм)", group: "barrel",
    outletDiameter: 12, flowLps: 3.6, flowM3h: 13.0, flowLmin: 216, extinguishArea: 24.0,
    jetRange: "28 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "rs70_19", name: "Ствол пожарный РС-70 (выходное отверстие 19 мм)", group: "barrel",
    outletDiameter: 19, flowLps: 7.4, flowM3h: 26.6, flowLmin: 444, extinguishArea: 49.3,
    jetRange: "32 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "srk50_12", name: "Ствол пожарный СРК-50 (выходное отверстие 12 мм)", group: "barrel",
    outletDiameter: 12, flowLps: 2.7, flowM3h: 9.7, flowLmin: 162, extinguishArea: 18.0,
    jetRange: "30 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "rsp50_12", name: "Ствол пожарный РСП-50 (выходное отверстие 12 мм)", group: "barrel",
    outletDiameter: 12, flowLps: 2.7, flowM3h: 9.7, flowLmin: 162, extinguishArea: 18.0,
    jetRange: "30 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "rsk50_12", name: "Ствол пожарный РСК-50 (выходное отверстие 12 мм)", group: "barrel",
    outletDiameter: 12, flowLps: 2.7, flowM3h: 9.7, flowLmin: 162, extinguishArea: 18.0,
    jetRange: "30 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "rsp70_19", name: "Ствол пожарный РСП-70 (выходное отверстие 19 мм)", group: "barrel",
    outletDiameter: 19, flowLps: 7.4, flowM3h: 26.6, flowLmin: 444, extinguishArea: 49.3,
    jetRange: "32 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },
  { id: "rsk370_19", name: "Ствол пожарный РСКЗ-70 (выходное отверстие 19 мм)", group: "barrel",
    outletDiameter: 19, flowLps: 7.4, flowM3h: 26.6, flowLmin: 444, extinguishArea: 49.3,
    jetRange: "32 м", workPressureMPa: "0,4–0,6", workPressureAtm: "4–6" },

  // ═══ Распылители / генераторы пены ═════════════════════════════════════════
  { id: "vvr1_low", name: "ВВР-1 (насадки 60 и 45, диаметр распыления 7 м и 6 м)", group: "sprayer",
    outletDiameter: 0, flowLps: 6.0, flowM3h: 21.6, flowLmin: 360, extinguishArea: 40.0,
    jetRange: "5–6 м", workPressureMPa: "0,6–2,4", workPressureAtm: "6–24" },
  { id: "vvr1_high", name: "ВВР-1 (насадки 60 и 45, повышенный расход)", group: "sprayer",
    outletDiameter: 0, flowLps: 12.0, flowM3h: 43.2, flowLmin: 720, extinguishArea: 80.0,
    jetRange: "5–6 м", workPressureMPa: "0,6–2,4", workPressureAtm: "6–24" },
  { id: "purga7", name: "УКТП «ПУРГА-7» кратность пены 29400 л/мин", group: "sprayer",
    outletDiameter: 0, flowLps: 7.0, flowM3h: 25.2, flowLmin: 420, extinguishArea: 46.7,
    jetRange: "30 м", workPressureMPa: "0,8", workPressureAtm: "8" },
  { id: "purga5", name: "УКТП «ПУРГА-5» кратность пены 21000 л/мин", group: "sprayer",
    outletDiameter: 0, flowLps: 5.0, flowM3h: 18.0, flowLmin: 300, extinguishArea: 33.3,
    jetRange: "25 м", workPressureMPa: "0,8", workPressureAtm: "8" },

  // ═══ Установки пенного тушения ═════════════════════════════════════════════
  { id: "npgu1", name: "Напорная пеногенераторная установка НПГУ-1", group: "foam",
    outletDiameter: 0, flowLps: 7.5, flowM3h: 27.0, flowLmin: 450, extinguishArea: 50.0,
    jetRange: "30 м", workPressureMPa: "0,3–0,5", workPressureAtm: "3–5" },
];

export function getConsumerById(id: string | undefined): WaterConsumerModel | undefined {
  if (!id) return undefined;
  return CONSUMER_CATALOG.find((c) => c.id === id);
}
