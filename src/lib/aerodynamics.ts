// ─────────────────────────────────────────────────────────────────────────────
// Аэродинамические расчёты горных выработок (АэроСеть / Вентиляция 2.0)
// ─────────────────────────────────────────────────────────────────────────────

export type SectionShape = "round" | "rect" | "trap" | "arch" | "custom";

export interface SectionParams {
  shape: SectionShape;
  // Параметры формы (используются в зависимости от shape)
  diameter?: number;     // м — для круглого
  width?: number;        // м — a (ширина) для прямоугольного, ширина основания для трапеции/арки
  height?: number;       // м — b (высота) для прямоугольного, высота сечения
  topWidth?: number;     // м — верхнее основание для трапеции
  archHeight?: number;   // м — стрела свода для арочного
  // Если custom — вводятся напрямую
  area?: number;         // м²
  perimeter?: number;    // м
}

// ─── Геометрия сечения: возвращает { S, P, Dh } ────────────────────────────
export function calcSection(p: SectionParams): { area: number; perimeter: number; dh: number } {
  let area = 0;
  let perimeter = 0;

  switch (p.shape) {
    case "round": {
      const d = p.diameter ?? 0;
      area = (Math.PI * d * d) / 4;
      perimeter = Math.PI * d;
      break;
    }
    case "rect": {
      const a = p.width ?? 0;
      const b = p.height ?? 0;
      area = a * b;
      perimeter = 2 * (a + b);
      break;
    }
    case "trap": {
      const a = p.width ?? 0;       // нижнее
      const c = p.topWidth ?? a;    // верхнее
      const h = p.height ?? 0;
      area = ((a + c) / 2) * h;
      // боковые стороны (равнобокая трапеция)
      const side = Math.sqrt(h * h + Math.pow((a - c) / 2, 2));
      perimeter = a + c + 2 * side;
      break;
    }
    case "arch": {
      // Прямоугольная часть высотой b + круговой сегмент (стрела h, хорда a)
      // Стандарт горных выработок: h = a/2 (полукруг) → P/√S ≈ 3.77-3.79
      const a = p.width ?? 0;
      const b = p.height ?? 0;                     // высота прямых стен
      const h = (p.archHeight !== undefined && p.archHeight > 0)
        ? Math.min(p.archHeight, a / 2)            // стрела ≤ a/2 (не более полукруга)
        : a / 2;                                   // по умолчанию — полукруг

      // Радиус дуги по стреле h и хорде a: r = (a²/4 + h²) / (2h)
      const r = h > 0 ? (a * a / 4 + h * h) / (2 * h) : (a > 0 ? a / 2 : 0);
      // Угол дуги: θ = 2·arcsin(a / (2r))
      const sinHalf = a > 0 && r > 0 ? Math.min(1, a / (2 * r)) : 0;
      const theta = 2 * Math.asin(sinHalf);
      // Площадь сегмента: S_сег = r²·(θ − sin θ) / 2
      const arcArea = r * r * (theta - Math.sin(theta)) / 2;
      // Длина дуги: l = r·θ
      const arcLen = r * theta;

      area = a * b + arcArea;
      perimeter = a + 2 * b + arcLen;
      break;
    }
    case "custom":
    default: {
      area = p.area ?? 0;
      perimeter = p.perimeter ?? 0;
    }
  }

  const dh = perimeter > 0 ? (4 * area) / perimeter : 0;
  return {
    area: round(area, 3),
    perimeter: round(perimeter, 2),
    dh: round(dh, 3),
  };
}

function round(v: number, p: number): number {
  const k = Math.pow(10, p);
  return Math.round(v * k) / k;
}

// ─── Справочник типов поверхностей и α (кН·с²/м⁴ ≡ кг/м³) ──────────────────
// Значения по справочнику ВНИИГД / Воронина — типовые для горных выработок
export interface SurfaceType {
  id: string;
  name: string;
  alpha: number;         // ×10⁻⁴ Н·с²/м⁴
  roughness: number;     // мм — эквивалентная шероховатость
}

// Значения α по справочнику ВНИИГД (Воронин, 1989), таблица 2.1
// α в единицах ×10⁻⁴ Н·с²/м⁴ при плотности воздуха ρ₀ = 1.2 кг/м³
export const SURFACE_TYPES: SurfaceType[] = [
  { id: "smooth",        name: "Воздухоподающая выработка, без неровностей", alpha: 9,    roughness: 1   },
  { id: "concrete",      name: "Бетонная крепь гладкая",                      alpha: 18,   roughness: 5   },
  { id: "concrete_rough",name: "Бетонная крепь, неровности до 50 мм",         alpha: 36,   roughness: 30  },
  { id: "anchor",        name: "Анкерная крепь",                              alpha: 55,   roughness: 50  },
  { id: "wood",          name: "Деревянная крепь, рамная",                    alpha: 110,  roughness: 100 },
  { id: "metal_arch",    name: "Металлическая арочная крепь",                 alpha: 65,   roughness: 70  },
  { id: "uncoupled",     name: "Незакреплённая, ровная порода",               alpha: 30,   roughness: 25  },
  { id: "uncoupled_r",   name: "Незакреплённая, рваный контур",               alpha: 100,  roughness: 150 },
  { id: "shaft_smooth",  name: "Ствол с тюбинговой крепью",                   alpha: 15,   roughness: 5   },
  { id: "shaft_skip",    name: "Ствол со скиповым подъёмом",                  alpha: 50,   roughness: 60  },
  { id: "lava",          name: "Очистной забой (лава)",                       alpha: 200,  roughness: 250 },
];

// Справочные значения α для вентиляционных трубопроводов
// α в единицах ×10⁻⁴ Н·с²/м⁴ (типовые значения для рудничной вентиляции)
export interface PipeAlphaType {
  id: string;
  name: string;
  alpha: number;   // среднее значение ×10⁻⁴ Н·с²/м⁴
  alphaMin: number;
  alphaMax: number;
}

export const PIPE_ALPHA_TYPES: PipeAlphaType[] = [
  { id: "steel_new",       name: "Стальная труба новая, без коррозии",            alpha: 0.15,  alphaMin: 0.1,  alphaMax: 0.2  },
  { id: "steel_light",     name: "Стальная труба, лёгкая коррозия",               alpha: 0.75,  alphaMin: 0.5,  alphaMax: 1.0  },
  { id: "steel_moderate",  name: "Стальная труба, умеренная коррозия",            alpha: 1.5,   alphaMin: 1.0,  alphaMax: 2.0  },
  { id: "steel_heavy",     name: "Стальная труба, сильная коррозия",              alpha: 3.5,   alphaMin: 2.0,  alphaMax: 5.0  },
  { id: "flex_smooth",     name: "Гибкий рукав гладкий (новый)",                  alpha: 0.2,   alphaMin: 0.2,  alphaMax: 0.35 },
  { id: "flex_standard",   name: "Гибкий рукав стандартный",                      alpha: 0.45,  alphaMin: 0.35, alphaMax: 0.55 },
  { id: "flex_worn",       name: "Гибкий рукав б/у (повреждения, складки)",       alpha: 0.65,  alphaMin: 0.55, alphaMax: 0.7  },
];

// ─── Способ задания сопротивления ──────────────────────────────────────────
export type ResistanceMode =
  | "alpha"        // По коэффициенту α
  | "surface"      // По типу поверхности (таблица ВНИИ)
  | "roughness"    // По эквивалентной шероховатости Δ (Альтшуль/Никурадзе)
  | "manual"       // Вручную (проектные данные / замеры)
  | "pipe";        // Вентиляционный трубопровод (формула 10.2: R = 6.48·α·L / D⁵)

// ─── Расчёт сопротивления R (Н·с²/м⁸ = кмюрг) ──────────────────────────────
//
// Базовая формула Аткинсона: R = α · P · L / S³
//   α — кг/м³ (1 Н·с²/м⁴ = 1 кг/м³)
//   P — периметр, м
//   L — длина, м
//   S — площадь, м²
//
// Расчёт сопротивления вентиляционного трубопровода (круглое сечение).
// Формула 10.2: R = 6.48 · α · L / D⁵
//   α — коэффициент аэродинамического сопротивления, ×10⁻⁴ Н·с²/м⁴
//   L — длина трубопровода, м
//   D — диаметр трубопровода, м
// Формула даёт результат в кМюрг (рудничные единицы).
// Перевод в Н·с²/м⁸ (внутренние единицы кода): × 9.81
export function resistanceFromPipe(alphaPipe: number, L: number, D: number): number {
  if (D <= 0 || L <= 0) return 0;
  const a = alphaPipe * 1e-4;
  const rKmurg = (6.48 * a * L) / Math.pow(D, 5);
  return isFinite(rKmurg) ? Math.min(rKmurg, 1e6) : 0;
}

export function resistanceFromAlpha(alpha: number, P: number, L: number, S: number): number {
  if (S <= 0.05 || L <= 0 || P <= 0) return 0;
  const a = alpha * 1e-4;
  const r = (a * P * L) / Math.pow(S, 3);
  // Ограничение разумным пределом (типичные R шахтных выработок < 10000 кмюрг = 98100 Нс²/м⁸)
  return isFinite(r) ? Math.min(r, 1000) : 0;
}

// Расчёт через шероховатость: R = λ·L·P / (8·S³)
// λ — коэффициент Дарси, по Альтшулю: λ = 0.11·(Δ/Dh + 68/Re)^0.25
// Для развитой турбулентности в выработках Re→∞: λ = 0.11·(Δ/Dh)^0.25
export function resistanceFromRoughness(deltaMm: number, S: number, P: number, L: number, Re?: number): number {
  if (S <= 0.05 || P <= 0 || L <= 0) return 0;
  const Dh = (4 * S) / P;
  if (Dh <= 0) return 0;
  const relRoughness = Math.max(0, (deltaMm / 1000) / Dh);
  let lambda: number;
  if (Re && Re > 0) {
    lambda = 0.11 * Math.pow(relRoughness + 68 / Re, 0.25);
  } else {
    lambda = 0.11 * Math.pow(Math.max(1e-9, relRoughness), 0.25);
  }
  const r = (lambda * L * P) / (8 * Math.pow(S, 3));
  return isFinite(r) ? Math.min(r, 1000) : 0;
}

// ─── Производные параметры потока ──────────────────────────────────────────
export function velocity(Q: number, S: number): number {
  if (S <= 0) return 0;
  return Q / S;
}

// Депрессия ΔP = R·Q² (Па). Знак сохраняется (R·|Q|·Q).
export function depression(R: number, Q: number): number {
  const dp = R * Math.abs(Q) * Q;
  return isFinite(dp) ? dp : 0;
}

// Энергозатраты ΔP·Q (Вт)
export function airPower(dP: number, Q: number): number {
  const p = Math.abs(dP * Q);
  return isFinite(p) ? p : 0;
}

// Число Рейнольдса (ν воздуха ≈ 1.5×10⁻⁵ м²/с при 20°C)
export function reynolds(V: number, Dh: number, nu: number = 1.5e-5): number {
  return (V * Dh) / nu;
}

// ─── Главная функция: считает R с учётом местных сопротивлений ξ ────────────
export interface ResistanceInput {
  mode: ResistanceMode;
  alpha: number;          // ×10⁻⁴ Н·с²/м⁴
  roughness: number;      // мм
  manualR: number;        // Н·с²/м⁸
  localXi: number;        // суммарный ξ местных сопротивлений
  S: number;              // м²
  P: number;              // м
  L: number;              // м
  Q?: number;             // м³/с (опц., для уточнения по Re)
  rho?: number;           // кг/м³, плотность воздуха (по умолч. 1.2)
  pipeAlpha?: number;     // ×10⁻⁴ Н·с²/м⁴ — α для трубопровода (режим "pipe")
  pipeDiameter?: number;  // м — диаметр трубопровода (режим "pipe")
}

export function calcResistance(i: ResistanceInput): {
  R: number;          // итог Н·с²/м⁸
  Rfriction: number;  // от трения
  Rlocal: number;     // от местных
  lambda?: number;
  Re?: number;
  Dh: number;
} {
  const Dh = i.P > 0 ? (4 * i.S) / i.P : 0;
  let Rfriction = 0;
  let lambda: number | undefined;
  let Re: number | undefined;

  if (i.Q && Dh > 0 && i.S > 0) {
    Re = reynolds(velocity(i.Q, i.S), Dh);
  }

  switch (i.mode) {
    case "alpha":
      Rfriction = resistanceFromAlpha(i.alpha, i.P, i.L, i.S);
      break;
    case "surface":
      Rfriction = resistanceFromAlpha(i.alpha, i.P, i.L, i.S);
      break;
    case "roughness": {
      Rfriction = resistanceFromRoughness(i.roughness, i.S, i.P, i.L, Re);
      const relR = (i.roughness / 1000) / (Dh || 1);
      lambda = 0.11 * Math.pow(relR + (Re ? 68 / Re : 0), 0.25);
      break;
    }
    case "manual":
      Rfriction = i.manualR;
      break;
    case "pipe":
      Rfriction = resistanceFromPipe(i.pipeAlpha ?? 9, i.L, i.pipeDiameter ?? 0.5);
      break;
  }

  // Местные ξ → R_local = ξ · ρ / (2·S²)   (т.к. ΔP_loc = ξ·ρ·V²/2 = ξ·ρ·Q²/(2S²))
  const rho = i.rho ?? 1.2;
  const rhoFactor = rho / 1.2; // поправка относительно стандартной плотности
  // alpha уже содержит ρ (единицы α: Н·с²/м⁴ = кг/м³) — масштабируем
  if (i.mode === "alpha" || i.mode === "surface") {
    Rfriction = Rfriction * rhoFactor;
  }
  const Rlocal = i.S > 0 ? (i.localXi * rho) / (2 * i.S * i.S) : 0;

  return {
    R: Rfriction + Rlocal,
    Rfriction,
    Rlocal,
    lambda,
    Re,
    Dh,
  };
}