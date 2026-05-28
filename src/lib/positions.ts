// Позиции — маркеры на схеме горной выработки

export type PositionType = "normal" | "reverse";
export type AccidentType = "Пожар" | "Взрыв" | "Внезапный выброс" | "Загазирование" | "Нет";

export interface Position {
  id: string;
  number: number;          // номер позиции (отображается на маркере)
  name: string;            // название позиции
  scenario: string;        // сценарий
  ventMode: string;        // режим проветривания
  positionType: PositionType; // тип: безреверсивная / реверсивная
  accidentType: AccidentType; // вид аварии
  isMineWide: boolean;     // общешахтная позиция
  color: string;           // цвет фона маркера (hex)
  colorUnified: boolean;   // "единый для копий"
  borderColor: string;     // цвет границы маркера
  diameter: number;        // диаметр маркера, мм
  font: string;            // шрифт (GOST type A, Arial, ...)
  leaderThickness: number; // толщина выносок, мм
  attachedFile: string;    // имя прикреплённого файла
  attachedFileData: string; // содержимое файла в base64 (data URL)
  attachedFileMime: string; // MIME-тип файла
  x: number;               // мировые координаты X (м)
  y: number;               // мировые координаты Y (м)
  z: number;               // высотная отметка Z (м)
  branchIds: string[];     // привязанные ветви
  comment: string;
  // Конец выноски (мировые координаты). Если null — выноска не задана.
  leaderEndX: number | null;
  leaderEndY: number | null;
  // Привязка конца выноски к ветви (как УО): branchId + t (0..1 вдоль ветви)
  leaderBranchId: string | null;
  leaderT: number | null;
}

export function makePosition(partial?: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2, 10),
    number: 1,
    name: "",
    scenario: "",
    ventMode: "Режим проветривания 1",
    positionType: "normal",
    accidentType: "Пожар",
    isMineWide: false,
    color: "#e53e3e",
    colorUnified: true,
    borderColor: "#c53030",
    diameter: 13,
    font: "GOST type A",
    leaderThickness: 0.2,
    attachedFile: "",
    attachedFileData: "",
    attachedFileMime: "",
    x: 0,
    y: 0,
    z: 0,
    branchIds: [],
    comment: "",
    leaderEndX: null,
    leaderEndY: null,
    leaderBranchId: null,
    leaderT: null,
    ...partial,
  };
}

export const POSITION_COLORS: { label: string; color: string; border: string }[] = [
  { label: "Красный",    color: "#e53e3e", border: "#c53030" },
  { label: "Оранжевый",  color: "#dd6b20", border: "#c05621" },
  { label: "Жёлтый",    color: "#d69e2e", border: "#b7791f" },
  { label: "Зелёный",   color: "#38a169", border: "#276749" },
  { label: "Синий",     color: "#3182ce", border: "#2b6cb0" },
  { label: "Фиолетовый",color: "#805ad5", border: "#6b46c1" },
  { label: "Серый",     color: "#718096", border: "#4a5568" },
];

export const VENT_MODES = [
  "Режим проветривания 1",
  "Режим проветривания 2",
  "Режим проветривания 3",
  "Аварийный режим",
];

export const ACCIDENT_TYPES: AccidentType[] = [
  "Пожар", "Взрыв", "Внезапный выброс", "Загазирование", "Нет",
];

export const FONT_OPTIONS = [
  "GOST type A",
  "GOST type B",
  "Arial",
  "Times New Roman",
  "Courier New",
];