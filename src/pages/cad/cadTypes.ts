// ─── Типы и интерфейсы CAD-страницы ─────────────────────────────────────────

export type RibbonTab = "file" | "home" | "view" | "schema" | "vent" | "thermo" | "accidents" | "involve" | "pipes" | "costs" | "refs" | "general";

export interface SchemaSymbol {
  id: string;
  typeId: string;
  x: number;
  y: number;
  branchId: string | null;
  t?: number;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  label?: string;
  description?: string;
  airDirection?: "forward" | "reverse";
  showFanArrow?: boolean;
  appearYear?: number;
  appearMonth?: string;
  appearDay?: number;
  indDescription?: boolean;
  indResistance?: boolean;
  indDeltaP?: boolean;
  indLeakage?: boolean;
  indOffsetX?: number;
  indOffsetY?: number;
  indFontSize?: number;
  bkResMode?: "project" | "survey" | "manual";
  bkWindowArea?: number;
  bkManualR?: number;
  bkAirPerm?: number;
  bkManualAirPerm?: boolean;
  bkCustomAirPerm?: number;
  bkSurveyQ?: number;
  bkSurveyDP?: number;
  bkBulkheadId?: string;
  bkBulkheadName?: string;
  bkBulkheadR?: number;
  bkFailurePressure?: number;
  msNumber?: string;
  msLocation?: string;
  msArea?: number;
  msFlow?: number;
  msVelocity?: number;
  msIndNumber?: boolean;
  msIndLocation?: boolean;
  msIndFlow?: boolean;
  msIndArea?: boolean;
  msIndVelocity?: boolean;
  msIndOffsetX?: number;
  msIndOffsetY?: number;
  msIndFontSize?: number;
  // ── Насос (typeId: "pump") ──────────────────────────────────────────
  /** ID выбранной модели насоса из библиотеки PUMP_CATALOG или пользовательской */
  pumpModelId?: string;
  /** Название насоса (марка) — для подписи */
  pumpName?: string;
  /** Номинальный напор, м вод. ст. */
  pumpHead?: number;
  /** Номинальная подача (расход), м³/ч */
  pumpFlow?: number;
  /** Частота вращения, об/мин */
  pumpRpm?: number;
  /** КПД, доли (0..1) */
  pumpEfficiency?: number;
  /** Мощность на валу, кВт */
  pumpPower?: number;
  /** Число параллельно работающих насосов */
  pumpParallel?: number;
}

export type SideTab = "params" | "measure" | "pipes" | "indicators" | "general" | "vent" | "thermo" | "areas" | "coords" | "horizons" | "topology" | "fan" | "fan-indicators" | "waterpipes" | "conveyor" | "fireload" | "search" | "positions" | "accidents" | "blast" | "rescue" | "workerPath" | "check" | "flowQ" | "compare" | "bulkhead";

export type CompareStatus = "added" | "removed" | "changed" | "unchanged";

export interface CompareBranchDiff {
  id: string;
  status: CompareStatus;
  name?: string;
  fromId: string;
  toId: string;
  changes?: { field: string; label: string; oldVal: string; newVal: string }[];
}

export interface CompareNodeDiff {
  id: string;
  status: CompareStatus;
  name?: string;
  changes?: { field: string; label: string; oldVal: string; newVal: string }[];
}

export interface CompareResult {
  branches: CompareBranchDiff[];
  nodes: CompareNodeDiff[];
  fileName: string;
}

export interface TextBlock {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  background: string;
  borderColor: string;
}

export function makeTextBlock(partial?: Partial<TextBlock>): TextBlock {
  return {
    id: Math.random().toString(36).slice(2, 10),
    text: "Текст",
    x: 0, y: 0,
    fontSize: 10,
    color: "#1a1a1a",
    bold: false,
    italic: false,
    background: "none",
    borderColor: "none",
    ...partial,
  };
}

export interface Excavation {
  id: string;
  type: string;
  section: "round" | "rect" | "trap";
  area: number;
  perimeter: number;
  length: number;
  alphaCoef: number;
  vMax: number;
  resistance: number;
  flow: number;
  velocity: number;
  dP: number;
  power: number;
  surface: string;
  name: string;
  number: string;
  width: number;
  border: number;
  layer: string;
  appearYear: string;
  appearMonth: string;
  appearDay: string;
  appearTime: string;
  disappearYear: string;
  disappearMonth: string;
  disappearDay: string;
  disappearTime: string;
  isVertical: boolean;
  dashedBorder: boolean;
  ignoreLayerColor: boolean;
  cable04: boolean;
  cable6: boolean;
}

export const DEFAULT_EXC: Excavation = {
  id: "EXC-001",
  type: "Ствол ЮВС",
  section: "round",
  area: 38.5,
  perimeter: 22,
  length: 276,
  alphaCoef: 0.009,
  vMax: 15,
  resistance: 0.000098,
  flow: 211,
  velocity: 5.5,
  dP: 43,
  power: 9002,
  surface: "Воздухоподающая выработка, без неровностей",
  name: 'Ствол "Южный - Вентиляционный"',
  number: "713",
  width: 3,
  border: 0.2,
  layer: "Стволы",
  appearYear: "2025",
  appearMonth: "Ноябрь",
  appearDay: "1",
  appearTime: "__:__",
  disappearYear: "",
  disappearMonth: "",
  disappearDay: "",
  disappearTime: "",
  isVertical: false,
  dashedBorder: false,
  ignoreLayerColor: false,
  cable04: false,
  cable6: false,
};

export const LAYERS = ["Стволы", "Квершлаги", "Штреки", "Уклоны", "Камеры", "Сбойки", "Скважины"];

export type ViewPresetName = "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE";