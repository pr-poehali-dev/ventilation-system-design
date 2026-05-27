// Позиции — маркеры на схеме горной выработки

export interface Position {
  id: string;
  number: number;        // номер позиции (отображается на маркере)
  name: string;          // название позиции
  color: string;         // цвет маркера (hex, например "#e53e3e")
  borderColor: string;   // цвет границы маркера
  x: number;             // мировые координаты X (м)
  y: number;             // мировые координаты Y (м)
  branchIds: string[];   // привязанные ветви
  comment: string;
}

export function makePosition(partial?: Partial<Position>): Position {
  return {
    id: Math.random().toString(36).slice(2, 10),
    number: 1,
    name: "",
    color: "#e53e3e",
    borderColor: "#c53030",
    x: 0,
    y: 0,
    branchIds: [],
    comment: "",
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
