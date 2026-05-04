// ─────────────────────────────────────────────────────────────────────────────
// Модель топологии вентиляционной сети шахты
// (узлы и ветви с физическими координатами X/Y/Z)
// ─────────────────────────────────────────────────────────────────────────────

export interface TopoNode {
  id: string;
  // Общие свойства
  name: string;
  number: string;
  // Физические координаты (метры)
  x: number;
  y: number;
  z: number;        // высотная отметка
  // Вентиляция
  airTemp: number;       // °C
  atmosphereLink: boolean;
  // Теплофизика
  wallTemp: number;      // °C — температура стенок
  // Воздушная съёмка
  reducedPressure: number; // Па — приведённое давление
  // Вычисленные параметры (заполняются расчётом)
  computedGasConc: number;     // % — концентрация газа
  computedAirTemp: number;     // °C
  computedWallTemp: number;    // °C
  computedPressure: number;    // Па — абсолютное давление
  computedExplosivePressure: number; // кПа
}

export interface TopoBranch {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  // ─── Геометрия выработки ─────────────────────────────
  shape: "round" | "rect" | "trap" | "arch" | "custom";
  diameter: number;         // м (для круглого)
  rectWidth: number;        // м (a — ширина прямоугольника / основание)
  rectHeight: number;       // м (b — высота прямой части)
  trapTopWidth: number;     // м (верхнее основание трапеции)
  archHeight: number;       // м (высота свода)
  area: number;             // м² — итог сечения
  perimeter: number;        // м — итог периметра
  dh: number;               // м — гидравлический диаметр (4S/P)
  length: number;           // м — рассчитывается из координат, но может задаваться
  manualLength: boolean;
  manualSection: boolean;   // S и P заданы вручную (mode=custom)
  // ─── Аэродинамика ────────────────────────────────────
  resistanceMode: "alpha" | "surface" | "roughness" | "manual";
  alphaCoef: number;        // ×10⁻⁴ Н·с²/м⁴ — коэффициент сопротивления крепи
  surfaceId: string;        // ID типа поверхности из справочника
  surface: string;          // подпись (для отображения)
  roughness: number;        // мм — эквивалентная шероховатость
  manualR: number;          // Н·с²/м⁸ — ручной ввод сопротивления
  localXi: number;          // суммарный ξ местных сопротивлений
  vMax: number;             // м/с — макс. допустимая скорость
  // ─── Расчётные ───────────────────────────────────────
  resistance: number;       // итог R, Н·с²/м⁸
  rFriction: number;        // R от трения
  rLocal: number;           // R от местных
  lambda: number;           // коэф. Дарси (если режим roughness)
  flow: number;             // м³/с
  velocity: number;         // м/с
  dP: number;               // Па
  power: number;            // Вт
  reynolds: number;         // Re
  // ─── Общие ───────────────────────────────────────────
  layer: string;
}

export function makeNode(id: string, partial?: Partial<TopoNode>): TopoNode {
  return {
    id,
    name: "",
    number: "",
    x: 0,
    y: 0,
    z: 0,
    airTemp: 20,
    atmosphereLink: false,
    wallTemp: 20,
    reducedPressure: 0,
    computedGasConc: 0,
    computedAirTemp: 20,
    computedWallTemp: 0,
    computedPressure: 910,
    computedExplosivePressure: 0,
    ...partial,
  };
}

export function makeBranch(id: string, fromId: string, toId: string, partial?: Partial<TopoBranch>): TopoBranch {
  return {
    id,
    fromId,
    toId,
    type: "Ствол ЮВС",
    // Геометрия — по умолчанию прямоугольник 7×5.5 м (≈ 38.5 м²)
    shape: "rect",
    diameter: 7,
    rectWidth: 7,
    rectHeight: 5.5,
    trapTopWidth: 5,
    archHeight: 1.5,
    area: 38.5,
    perimeter: 25,
    dh: (4 * 38.5) / 25,
    length: 0,
    manualLength: false,
    manualSection: false,
    // Аэродинамика
    resistanceMode: "surface",
    alphaCoef: 9,                               // ×10⁻⁴ Н·с²/м⁴
    surfaceId: "smooth",
    surface: "Воздухоподающая выработка, без неровностей",
    roughness: 1,                               // мм
    manualR: 0,
    localXi: 0,
    vMax: 15,
    // Расчётные
    resistance: 0,
    rFriction: 0,
    rLocal: 0,
    lambda: 0,
    flow: 0,
    velocity: 0,
    dP: 0,
    power: 0,
    reynolds: 0,
    layer: "Стволы",
    ...partial,
  };
}

// Длина ветви в 3D пространстве по координатам узлов
export function calcBranchLength(from: TopoNode, to: TopoNode): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Барометрическое давление от высотной отметки (упрощённая формула)
// P(z) = P0 * (1 - 0.0065·z/288)^5.25
export function pressureAtZ(z: number, p0: number = 101325): number {
  const ratio = 1 - (0.0065 * z) / 288.15;
  if (ratio <= 0) return 0;
  return p0 * Math.pow(ratio, 5.25588);
}

// Изометрическая проекция X/Y/Z → 2D screen
export interface ProjOptions {
  scale: number;     // м → px
  offsetX: number;
  offsetY: number;
  isoAngle?: number; // 0 = план, 30 = изометрия
  zScale?: number;   // насколько Z влияет на Y экрана
}

export function project3D(p: { x: number; y: number; z: number }, opts: ProjOptions): { sx: number; sy: number } {
  const isoRad = ((opts.isoAngle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(isoRad);
  const sin = Math.sin(isoRad);
  const zScale = opts.zScale ?? 1;
  // План: X→sx, Y→sy (Y инвертируем)
  // Изометрия: X→sx*cos+sin*y, Y→-sin*x+cos*y; Z поднимает вверх
  const xx = p.x * cos + p.y * sin;
  const yy = -p.x * sin + p.y * cos;
  return {
    sx: opts.offsetX + xx * opts.scale,
    sy: opts.offsetY - yy * opts.scale - p.z * opts.scale * zScale,
  };
}

// Обратная проекция (только для плана, isoAngle=0): screen → world
export function unproject2D(sx: number, sy: number, opts: ProjOptions, zLevel: number = 0): { x: number; y: number; z: number } {
  const zScale = opts.zScale ?? 1;
  return {
    x: (sx - opts.offsetX) / opts.scale,
    y: -(sy - opts.offsetY + zLevel * opts.scale * zScale) / opts.scale,
    z: zLevel,
  };
}

// ─── Демо-сеть (как в АэроСеть/Вентиляция 2.0) ────────────────────────────

export const DEMO_NODES: TopoNode[] = [
  makeNode("U1", { name: "Устье ЮВС",          number: "001", x: 0,    y: 0,     z: 0,    atmosphereLink: true,  reducedPressure: 0 }),
  makeNode("N1", { name: "Сопряжение -75",     number: "002", x: 200,  y: -200,  z: -75,  computedPressure: 910 }),
  makeNode("N2", { name: "Сопряжение -150",    number: "003", x: 421,  y: -1518, z: -75 }),
  makeNode("N3", { name: "Сопряжение -240",    number: "004", x: 600,  y: -2400, z: -240 }),
  makeNode("N4", { name: "Околоствольный двор",number: "005", x: 1200, y: -2400, z: -240 }),
  makeNode("N5", { name: "Очистной забой",     number: "006", x: 2000, y: -1800, z: -240 }),
  makeNode("N6", { name: "Сопряжение СВС",     number: "007", x: 2400, y: -800,  z: -75 }),
  makeNode("U2", { name: "Устье СВС",          number: "008", x: 2400, y: 0,     z: 0,    atmosphereLink: true }),
];

export const DEMO_BRANCHES: TopoBranch[] = [
  makeBranch("B1", "U1", "N1", { type: "Ствол ЮВС",   layer: "Стволы",    shape: "round", diameter: 7,
                                  surfaceId: "shaft_smooth", surface: "Ствол с тюбинговой крепью", alphaCoef: 15, roughness: 5,
                                  flow: 211, vMax: 15 }),
  makeBranch("B2", "N1", "N2", { type: "Квершлаг",    layer: "Квершлаги", shape: "arch",  rectWidth: 4, rectHeight: 2.5, archHeight: 1.5,
                                  surfaceId: "concrete", surface: "Бетонная крепь гладкая", alphaCoef: 12, roughness: 3,
                                  flow: 211 }),
  makeBranch("B3", "N2", "N3", { type: "Уклон",       layer: "Уклоны",    shape: "rect",  rectWidth: 4, rectHeight: 3,
                                  surfaceId: "anchor", surface: "Анкерная крепь", alphaCoef: 35, roughness: 50,
                                  flow: 211 }),
  makeBranch("B4", "N3", "N4", { type: "Штрек откат.",layer: "Штреки",    shape: "arch",  rectWidth: 4, rectHeight: 2, archHeight: 1.5,
                                  surfaceId: "metal_arch", surface: "Металлическая арочная крепь", alphaCoef: 50, roughness: 60,
                                  flow: 211 }),
  makeBranch("B5", "N4", "N5", { type: "Очистной",    layer: "Лавы",      shape: "rect",  rectWidth: 3, rectHeight: 1.5,
                                  surfaceId: "lava", surface: "Очистной забой (лава)", alphaCoef: 150, roughness: 200,
                                  flow: 211, localXi: 8 }),
  makeBranch("B6", "N5", "N6", { type: "Штрек вент.", layer: "Штреки",    shape: "arch",  rectWidth: 4, rectHeight: 2, archHeight: 1.5,
                                  surfaceId: "metal_arch", surface: "Металлическая арочная крепь", alphaCoef: 50, roughness: 60,
                                  flow: 211 }),
  makeBranch("B7", "N6", "U2", { type: "Ствол СВС",   layer: "Стволы",    shape: "round", diameter: 7,
                                  surfaceId: "shaft_skip", surface: "Ствол со скиповым подъёмом", alphaCoef: 45, roughness: 50,
                                  flow: 211, vMax: 15 }),
];

// Авто-расчёт длин на основе координат
export function recalcLengths(nodes: TopoNode[], branches: TopoBranch[]): TopoBranch[] {
  return branches.map((b) => {
    if (b.manualLength) return b;
    const from = nodes.find((n) => n.id === b.fromId);
    const to = nodes.find((n) => n.id === b.toId);
    if (!from || !to) return b;
    return { ...b, length: Math.round(calcBranchLength(from, to)) };
  });
}

// ─── Полный пересчёт аэродинамики ветви ─────────────────────────────────────
// Пересчитывает: геометрию сечения (S, P, Dh), сопротивление R,
// скорость, депрессию, мощность, Re — на основании заданных входов.
import { calcSection, calcResistance, velocity as calcVel, depression, airPower, reynolds } from "./aerodynamics";

export function recalcBranchAero(b: TopoBranch): TopoBranch {
  // 1) Геометрия сечения (если не задана вручную)
  let area = b.area;
  let perimeter = b.perimeter;
  let dh = b.dh;
  if (!b.manualSection) {
    const s = calcSection({
      shape: b.shape,
      diameter: b.diameter,
      width: b.rectWidth,
      height: b.rectHeight,
      topWidth: b.trapTopWidth,
      archHeight: b.archHeight,
    });
    area = s.area;
    perimeter = s.perimeter;
    dh = s.dh;
  } else {
    dh = perimeter > 0 ? Math.round((4 * area) / perimeter * 1000) / 1000 : 0;
  }

  // 2) Сопротивление
  const r = calcResistance({
    mode: b.resistanceMode,
    alpha: b.alphaCoef,
    roughness: b.roughness,
    manualR: b.manualR,
    localXi: b.localXi,
    S: area,
    P: perimeter,
    L: b.length,
    Q: b.flow,
  });

  // 3) Поток
  const V = calcVel(b.flow, area);
  const dP = depression(r.R, b.flow);
  const N = airPower(dP, b.flow);
  const Re = area > 0 && dh > 0 ? reynolds(V, dh) : 0;

  return {
    ...b,
    area,
    perimeter,
    dh,
    resistance: r.R,
    rFriction: r.Rfriction,
    rLocal: r.Rlocal,
    lambda: r.lambda ?? 0,
    velocity: Math.round(V * 100) / 100,
    dP: Math.round(dP * 10) / 10,
    power: Math.round(N),
    reynolds: Math.round(Re),
  };
}

// Пересчёт всех ветвей: длины + аэродинамика
export function recalcAll(nodes: TopoNode[], branches: TopoBranch[]): TopoBranch[] {
  return recalcLengths(nodes, branches).map(recalcBranchAero);
}