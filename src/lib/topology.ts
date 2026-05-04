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
  // Геометрия выработки
  area: number;         // м²
  perimeter: number;    // м
  length: number;       // м (рассчитывается из координат, но может задаваться)
  manualLength: boolean;
  // Аэродинамика
  alphaCoef: number;    // кг/м³
  surface: string;
  vMax: number;
  // Расчётные
  resistance: number;
  flow: number;
  velocity: number;
  dP: number;
  power: number;
  // Общие
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
    area: 38.5,
    perimeter: 22,
    length: 0,
    manualLength: false,
    alphaCoef: 0.009,
    surface: "Воздухоподающая выработка, без неровностей",
    vMax: 15,
    resistance: 0,
    flow: 0,
    velocity: 0,
    dP: 0,
    power: 0,
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
  makeBranch("B1", "U1", "N1", { type: "Ствол ЮВС",  layer: "Стволы",    area: 38.5, perimeter: 22 }),
  makeBranch("B2", "N1", "N2", { type: "Квершлаг",   layer: "Квершлаги", area: 14,   perimeter: 15 }),
  makeBranch("B3", "N2", "N3", { type: "Уклон",      layer: "Уклоны",    area: 12,   perimeter: 14 }),
  makeBranch("B4", "N3", "N4", { type: "Штрек откат.",layer: "Штреки",   area: 10,   perimeter: 13 }),
  makeBranch("B5", "N4", "N5", { type: "Очистной",   layer: "Лавы",      area: 4.5,  perimeter: 9 }),
  makeBranch("B6", "N5", "N6", { type: "Штрек вент.",layer: "Штреки",    area: 10,   perimeter: 13 }),
  makeBranch("B7", "N6", "U2", { type: "Ствол СВС",  layer: "Стволы",    area: 38.5, perimeter: 22 }),
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
