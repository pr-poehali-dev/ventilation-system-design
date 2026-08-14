// Позиции — маркеры на схеме горной выработки

export type PositionType = "normal" | "reverse";
export type AccidentType = "Пожар" | "Взрыв" | "Внезапный выброс" | "Загазирование" | "Нет";

// Дополнительная (дублирующая) выноска позиции: привязка к ветви ИЛИ свободная точка.
export interface PositionLeader {
  id: string;
  branchId?: string | null;   // привязка к ветви
  t?: number | null;          // положение вдоль ветви (0..1)
  endX?: number | null;       // свободная точка X (мир)
  endY?: number | null;       // свободная точка Y (мир)
}

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
  placed: boolean;         // true = позиция явно размещена на схеме (кликом или авто)
  branchIds: string[];     // привязанные ветви
  comment: string;
  // Конец выноски (мировые координаты). Если null — выноска не задана.
  leaderEndX: number | null;
  leaderEndY: number | null;
  // Привязка конца выноски к ветви (как УО): branchId + t (0..1 вдоль ветви)
  leaderBranchId: string | null;
  leaderT: number | null;
  // Дополнительные (дублирующие) выноски. НЕ влияют на положение маркера —
  // маркер всегда привязан к ОСНОВНОЙ выноске (leaderBranchId/leaderEndX выше).
  extraLeaders?: PositionLeader[];
  // ─── Видимость (управляется из панели информации) ────────
  visible?: boolean;         // видимость маркера на схеме (true по умолчанию)
  branchesVisible?: boolean; // видимость привязанных ветвей (true по умолчанию)
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
    leaderThickness: 0.02,
    attachedFile: "",
    attachedFileData: "",
    attachedFileMime: "",
    x: 0,
    y: 0,
    z: 0,
    placed: false,
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

/**
 * Подбирает пару «фон + граница» маркера позиции по цвету из импортируемого файла.
 *
 * В CSV хранится только ОДИН цвет (граница), а у маркера их два — поэтому
 * ищем в палитре POSITION_COLORS запись с самым близким цветом и берём её
 * пару целиком. Так импортированные позиции выглядят как «родные».
 *
 * Близость считаем по ОТТЕНКУ (модель HSL), а не по сырым RGB: обычное
 * расстояние в RGB плохо отражает восприятие — например тёмно-синий #123456
 * оказывался «ближе» к тёмно-зелёному, чем к синему, и позиция меняла цвет.
 *
 * Если цвет не задан, не распознан или ни одна запись палитры не подошла —
 * возвращаем СЛУЧАЙНУЮ запись палитры: позиции получат разные различимые
 * цвета вместо одинаковых красных.
 */
export function matchPositionColor(rawColor: string): { color: string; border: string } {
  const rgb = (h: string): [number, number, number] | null => {
    const m = (h || "").trim().toLowerCase().replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/.test(m)) return null;
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  };
  const toHsl = ([r0, g0, b0]: [number, number, number]): [number, number, number] => {
    const r = r0 / 255, g = g0 / 255, b = b0 / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
      h *= 60;
    }
    return [h, s, l];
  };
  // Чем меньше, тем ближе. Ненасыщенные цвета (серый) сравниваем отдельно —
  // у них оттенок не несёт смысла.
  const score = (a: [number, number, number], b: [number, number, number]): number => {
    const [h1, s1, l1] = toHsl(a), [h2, s2, l2] = toHsl(b);
    if (s1 < 0.15 || s2 < 0.15) {
      if (Math.abs(s1 - s2) > 0.25) return Infinity;
      return Math.abs(s1 - s2) * 200 + Math.abs(l1 - l2) * 100;
    }
    let dh = Math.abs(h1 - h2);
    if (dh > 180) dh = 360 - dh;
    return dh + Math.abs(s1 - s2) * 60 + Math.abs(l1 - l2) * 60;
  };

  const want = rgb(rawColor);
  if (want) {
    let best: { color: string; border: string } | null = null;
    let bestScore = Infinity;
    for (const p of POSITION_COLORS) {
      // Сверяем и с границей, и с фоном: в файл мог попасть любой из двух.
      for (const cand of [p.border, p.color]) {
        const c = rgb(cand);
        if (!c) continue;
        const d = score(want, c);
        if (d < bestScore) { bestScore = d; best = { color: p.color, border: p.border }; }
      }
    }
    // Порог 70: столько «стоит» уже заметно другой оттенок.
    if (best && bestScore <= 70) return best;
  }
  const rnd = POSITION_COLORS[Math.floor(Math.random() * POSITION_COLORS.length)];
  return { color: rnd.color, border: rnd.border };
}

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