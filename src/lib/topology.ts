// ─────────────────────────────────────────────────────────────────────────────
// Модель топологии вентиляционной сети шахты
// (узлы и ветви с физическими координатами X/Y/Z)
// ─────────────────────────────────────────────────────────────────────────────

export interface TopoNode {
  id: string;
  // Общие свойства
  name: string;
  number: string;
  // Видимость на схеме (управляется из панели информации). undefined = видим
  visible?: boolean;
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
  angle: number;            // ° — угол наклона (-90..+90), авто из координат или вручную
  manualAngle: boolean;     // если true — угол задан вручную, не пересчитывается из координат
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
  // ─── Вентилятор (источник напора) ────────────────────
  hasFan: boolean;          // ветвь содержит вентилятор
  fanMode: "constant" | "curve"; // постоянная депрессия или Q-H хар-ка
  fanPressure: number;      // Па — депрессия (для mode=constant), или фактическая (mode=curve)
  fanName: string;
  fanCurveId: string;       // ID из справочника FAN_CATALOG (mode=curve)
  fanRpm: number;           // обороты, об/мин
  fanBladeAngle: number;    // угол лопаток, °
  fanParallel: number;      // количество вентиляторов в параллель
  fanInstall: string;       // установка: "Внутри перемычки" / "Снаружи"
  fanEfficiency: number;    // расчётный КПД на рабочей точке
  fanShaftPower: number;    // расчётная мощность на валу, Вт
  fanReverse: boolean;      // реверс: вентилятор работает в обратном направлении
  fanStopped: boolean;      // вентилятор остановлен (H=0, Q=0 через него)
  // ─── Расчётные ───────────────────────────────────────
  resistance: number;       // итог R, Н·с²/м⁸
  rFriction: number;        // R от трения
  rLocal: number;           // R от местных
  lambda: number;           // коэф. Дарси (если режим roughness)
  flow: number;             // м³/с
  velocity: number;         // м/с
  dP: number;               // Па
  isDead: boolean;          // тупиковая ветвь (Q=0, проветривание диффузией)
  isLeakage: boolean;       // утечка: ветвь моделирует перетечку через перемычку/целик
  leakageCoeff: number;     // коэффициент утечки 0..1 (доля от Q вентилятора), 0 = не задан
  power: number;            // Вт
  reynolds: number;         // Re
  // ─── Отображение ────────────────────────────────────
  lineWidth: number;        // px — толщина линии на схеме (по умолчанию 2)
  lineBorder: number;       // px — толщина обводки (по умолчанию 0.2)
  capital: boolean;         // Капитальная выработка
  designed: boolean;        // Проектируемая выработка
  // ─── Общие ───────────────────────────────────────────
  layer: string;
  horizonId: string;        // ID горизонта (см. Horizon[]), пустая строка = без привязки
  comment: string;          // Примечание (произвольный текст)
}

// ─── Горизонты (как в ПО Аэросеть): группировка ветвей по высотным отметкам ───
// Каждый горизонт — это «слой» сети с уникальным цветом и высотной отметкой.
// Можно скрывать/показывать целиком, перекрашивать ветви, переключать активный.
// Опционально к горизонту прикрепляется подложка-картинка плана (PNG/JPG).
export interface HorizonImage {
  /** PNG/JPG, закодированный в data:URL (хранится локально в браузере). */
  dataUrl: string;
  /** Углы прямоугольника подложки в мировых координатах (метры). */
  bounds: { x1: number; y1: number; x2: number; y2: number };
  /** Прозрачность 0..1 (по умолчанию 0.6). */
  opacity: number;
  /** Видимость подложки (отдельно от видимости ветвей горизонта). */
  visible: boolean;
}

export interface Horizon {
  id: string;
  name: string;
  z: number;        // высотная отметка, м
  color: string;    // HEX цвет (#RRGGBB)
  visible: boolean; // отображать ли ветви этого горизонта на схеме
  image?: HorizonImage; // подложка-картинка (опционально)
}

export function makeHorizon(id: string, partial?: Partial<Horizon>): Horizon {
  return {
    id,
    name: id,
    z: 0,
    color: "#3b82f6",
    visible: true,
    ...partial,
  };
}

// Дефолтный набор горизонтов для вентиляции зданий (этажи)
export const DEFAULT_HORIZONS: Horizon[] = [
  { id: "H_1",  name: "1-й этаж",  z:  0,  color: "#22c55e", visible: true },
  { id: "H_2",  name: "2-й этаж",  z:  3,  color: "#3b82f6", visible: true },
  { id: "H_3",  name: "3-й этаж",  z:  6,  color: "#a855f7", visible: true },
  { id: "H_AT", name: "Кровля",    z: 10,  color: "#f97316", visible: true },
];

export function makeNode(id: string, partial?: Partial<TopoNode>): TopoNode {
  return {
    id,
    name: "",
    number: "",
    visible: true,
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
    angle: 0,
    manualAngle: false,
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
    hasFan: false,
    fanMode: "constant",
    fanPressure: 0,
    fanName: "",
    fanCurveId: "",
    fanRpm: 0,
    fanBladeAngle: 45,
    fanParallel: 1,
    fanInstall: "Внутри перемычки",
    fanEfficiency: 0,
    fanShaftPower: 0,
    fanReverse: false,
    fanStopped: false,
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
    isDead: false,
    isLeakage: false,
    leakageCoeff: 0,
    lineWidth: 3,
    lineBorder: 0.6,
    capital: false,
    designed: false,
    layer: "Стволы",
    horizonId: "",
    comment: "",
    ...partial,
  };
}

// Угол наклона ветви в градусах (-90..+90) из координат узлов
// +90 — вертикально вверх, -90 — вертикально вниз, 0 — горизонтально
export function calcBranchAngle(from: TopoNode, to: TopoNode): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const horizLen = Math.sqrt(dx * dx + dy * dy);
  const len3d = Math.sqrt(horizLen * horizLen + dz * dz);
  if (len3d < 0.001) return 0;
  return Math.round(Math.asin(Math.abs(dz) / len3d) * (180 / Math.PI) * 10) / 10;
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

// ─────────────────────────────────────────────────────────────────────────────
// Камера / проекция X/Y/Z → 2D screen
//
// azimuth (φ): поворот вокруг оси Z (мира), 0° — взгляд вдоль -Y
// elevation (θ): угол подъёма камеры над горизонтом, 0° — фронт, 90° — план сверху
//
// Преобразование:
//   1) поворот вокруг Z на -azimuth: x' = cos·x + sin·y; y' = -sin·x + cos·y
//   2) наклон вокруг X' на elevation: y'' = sin(θ)·y' - cos(θ)·z; depth = cos(θ)·y' + sin(θ)·z
//   3) на экран: sx = offsetX + x'·scale; sy = offsetY - y''·scale
// ─────────────────────────────────────────────────────────────────────────────
export interface ProjOptions {
  scale: number;       // м → px
  offsetX: number;
  offsetY: number;
  azimuth?: number;    // ° — поворот вокруг Z
  elevation?: number;  // ° — наклон камеры (90 = план, 0 = фронт)
  // Совместимость со старым API (план):
  isoAngle?: number;   // не используется в 3D, оставлено для backward compat
  zScale?: number;     // ignore in 3D
}

export interface Projected { sx: number; sy: number; depth: number; }

export function project3D(p: { x: number; y: number; z: number }, opts: ProjOptions): Projected {
  const az = ((opts.azimuth ?? 0) * Math.PI) / 180;
  const el = ((opts.elevation ?? 90) * Math.PI) / 180;   // 90° по умолчанию = план

  // 1) Поворот вокруг Z (мира) на -azimuth
  const cosA = Math.cos(az);
  const sinA = Math.sin(az);
  const x1 =  cosA * p.x + sinA * p.y;
  const y1 = -sinA * p.x + cosA * p.y;

  // 2) Наклон: при elevation=90° (план) экран Y совпадает с миром Y; Z = глубина.
  //    Принято в горном деле: z=0 — поверхность, z<0 — глубина (стволы, лавы).
  //    Поэтому положительный z должен идти ВВЕРХ на экране (sy меньше),
  //    а отрицательный — ВНИЗ. Знак при cosE·z подобран соответствующе.
  const cosE = Math.cos(el);
  const sinE = Math.sin(el);
  const y2 = sinE * y1 + cosE * p.z;
  const depth = cosE * y1 - sinE * p.z;  // дальность до камеры (для z-sort)

  return {
    sx: opts.offsetX + x1 * opts.scale,
    sy: opts.offsetY - y2 * opts.scale,
    depth,
  };
}

// ─── Стандартные ракурсы ────────────────────────────────────────────────────
export const VIEW_PRESETS = {
  plan:    { azimuth: 0,    elevation: 90 },   // сверху (XY)
  front:   { azimuth: 0,    elevation: 0 },    // спереди (XZ), смотрим вдоль -Y
  back:    { azimuth: 180,  elevation: 0 },    // сзади
  left:    { azimuth: -90,  elevation: 0 },    // слева (YZ)
  right:   { azimuth: 90,   elevation: 0 },    // справа
  isoSW:   { azimuth: -45,  elevation: 30 },   // изометрия Юго-Запад
  isoSE:   { azimuth: 45,   elevation: 30 },   // изометрия Юго-Восток
  isoNW:   { azimuth: -135, elevation: 30 },
  isoNE:   { azimuth: 135,  elevation: 30 },
} as const;

export type ViewPreset = keyof typeof VIEW_PRESETS;

// Обратная проекция: screen → world (только для плана, elevation=90°, az=0°)
// Для 3D создание узлов осуществляется на плоскости z=zLevel.
export function unproject2D(sx: number, sy: number, opts: ProjOptions, zLevel: number = 0): { x: number; y: number; z: number } {
  return {
    x: (sx - opts.offsetX) / opts.scale,
    y: -(sy - opts.offsetY) / opts.scale,
    z: zLevel,
  };
}

// ─── Универсальная обратная проекция: screen + рабочая плоскость → world ───
// Принцип: курсор задаёт ЛУЧ в 3D, а рабочая плоскость (x=const, y=const или z=const)
// — вторую сущность для пересечения. Возвращаем точку пересечения луча с плоскостью.
//
// При вырождении (плоскость параллельна лучу взгляда) возвращаем null —
// в таком случае пользователь должен сменить рабочую плоскость.
//
// Прямые формулы (см. project3D):
//   x1 =  cosA·x + sinA·y                (поворот вокруг Z)
//   y1 = -sinA·x + cosA·y
//   y2 = sinE·y1 + cosE·z                (наклон вокруг X', +z идёт ВВЕРХ)
//   sx = ox + x1·s   →   u = (sx-ox)/s = x1
//   sy = oy - y2·s   →   v = -(sy-oy)/s = y2
// ──────────────────────────────────────────────────────────────────────────
export type WorkPlane =
  | { axis: "z"; value: number }   // фикс по Z (горизонтальная плоскость) — для плана/изо
  | { axis: "y"; value: number }   // фикс по Y (вертикальная) — для фронт/тыл
  | { axis: "x"; value: number };  // фикс по X (вертикальная) — для лев/прав

const EPS = 1e-6;

export function unprojectToPlane(
  sx: number, sy: number, opts: ProjOptions, plane: WorkPlane
): { x: number; y: number; z: number } | null {
  const az = ((opts.azimuth ?? 0) * Math.PI) / 180;
  const el = ((opts.elevation ?? 90) * Math.PI) / 180;
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const cosE = Math.cos(el), sinE = Math.sin(el);

  const u = (sx - opts.offsetX) / opts.scale;   // = x1
  const v = -(sy - opts.offsetY) / opts.scale;  // = y2

  // Извлекаем (x, y, z) при заданной фиксированной координате.
  if (plane.axis === "z") {
    const z0 = plane.value;
    if (Math.abs(sinE) < EPS) return null;     // вид «в горизонт» — Z-плоскость параллельна лучу
    // y2 = sinE·y1 + cosE·z0  →  y1 = (v − cosE·z0)/sinE
    const y1 = (v - cosE * z0) / sinE;
    // x1 = u; решаем поворот вокруг Z обратно
    const x1 = u;
    const x =  cosA * x1 - sinA * y1;
    const y =  sinA * x1 + cosA * y1;
    return { x, y, z: z0 };
  }

  if (plane.axis === "y") {
    const y0 = plane.value;
    // x1 = cosA·x + sinA·y0  →  x = (u - sinA·y0)/cosA
    if (Math.abs(cosA) < EPS) return null;
    const x = (u - sinA * y0) / cosA;
    const y1 = -sinA * x + cosA * y0;
    // y2 = sinE·y1 + cosE·z  →  z = (v − sinE·y1)/cosE
    if (Math.abs(cosE) < EPS) return null;     // план — Y-плоскость параллельна лучу (взгляд сверху)
    const z = (v - sinE * y1) / cosE;
    return { x, y: y0, z };
  }

  // axis === "x"
  const x0 = plane.value;
  // x1 = cosA·x0 + sinA·y  →  y = (u - cosA·x0)/sinA
  if (Math.abs(sinA) < EPS) return null;
  const y = (u - cosA * x0) / sinA;
  const y1 = -sinA * x0 + cosA * y;
  if (Math.abs(cosE) < EPS) return null;
  const z = (v - sinE * y1) / cosE;
  return { x: x0, y, z };
}

// Подобрать «логичную» рабочую плоскость по текущему ракурсу
// (для авто-режима в UI). Возвращает плоскость + признак пригодности.
export function autoWorkPlane(
  azimuth: number, elevation: number,
  defaults: { z: number; y: number; x: number }
): WorkPlane {
  const el = elevation;
  const az = ((azimuth % 360) + 360) % 360;
  // План / почти-план / изометрия — XY-плоскость (фикс Z)
  if (el >= 25) return { axis: "z", value: defaults.z };
  // Низкий горизонт: выбираем XZ или YZ по ближайшей оси взгляда
  // az≈0 или 180 → смотрим вдоль ±Y → рабочая XZ (фикс Y)
  // az≈90 или 270 → смотрим вдоль ±X → рабочая YZ (фикс X)
  const distY = Math.min(Math.abs(az - 0), Math.abs(az - 180), Math.abs(az - 360));
  const distX = Math.min(Math.abs(az - 90), Math.abs(az - 270));
  return distY <= distX
    ? { axis: "y", value: defaults.y }
    : { axis: "x", value: defaults.x };
}

// ─── Демо-сеть вентиляции здания (воздуховоды + вентилятор) ────────────────
//
// Топология (план, вид сверху):
//
//  N1 ──[В1: горизонт подключения]──► N2 (Вентилятор)──► N3
//                                                         │
//                                                        N4
//                                                         │
//  N9 ◄──[магистраль]── N8 ◄── N7 ◄── N6 ◄── N5 ◄── N4
//
// Расходы: Q ≈ 75.3 м³/с на всех ветвях (после вентилятора поток распределяется)

export const DEMO_NODES: TopoNode[] = [
  makeNode("N1",  { name: "Атмосфера (вход)",      number: "1",  x:    0, y:    0, z: 0,  atmosphereLink: true }),
  makeNode("N2",  { name: "Вентилятор",             number: "2",  x:  100, y:    0, z: 0  }),
  makeNode("N3",  { name: "Узел после вент.",        number: "3",  x:  200, y:    0, z: 0  }),
  makeNode("N4",  { name: "Узел разветвления",       number: "4",  x:  200, y: -200, z: 0  }),
  makeNode("N5",  { name: "Узел 5",                 number: "5",  x:  300, y: -400, z: 0  }),
  makeNode("N6",  { name: "Узел 6",                 number: "6",  x:  600, y: -400, z: 0  }),
  makeNode("N7",  { name: "Узел 7",                 number: "7",  x:  900, y: -400, z: 0  }),
  makeNode("N8",  { name: "Узел 8",                 number: "8",  x: 1400, y: -400, z: 0  }),
  makeNode("N9",  { name: "Атмосфера (выход)",      number: "9",  x: 2000, y: -400, z: 0,  atmosphereLink: true }),
];

export const DEMO_BRANCHES: TopoBranch[] = [
  makeBranch("1", "N1", "N2", {
    type: "Воздухозабор", layer: "Приток", horizonId: "H_AT",
    shape: "round", diameter: 1.4, area: 1.54, perimeter: 4.4, dh: 1.4,
    surfaceId: "smooth", surface: "Стальной воздуховод круглый", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 20,
  }),
  makeBranch("2", "N2", "N3", {
    type: "Нагнетание", layer: "Приток", horizonId: "H_AT",
    shape: "round", diameter: 1.4, area: 1.54, perimeter: 4.4, dh: 1.4,
    surfaceId: "smooth", surface: "Стальной воздуховод круглый", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 20,
    hasFan: true, fanMode: "curve", fanCurveId: "VO-25",
    fanPressure: 1200, fanName: "Вентилятор (главный)",
  }),
  makeBranch("3", "N3", "N4", {
    type: "Магистраль", layer: "Приток", horizonId: "H_1",
    shape: "rect", rectWidth: 0.8, rectHeight: 0.6, area: 0.48, perimeter: 2.8, dh: 0.686,
    surfaceId: "smooth", surface: "Прямоугольный воздуховод", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 15,
  }),
  makeBranch("4", "N4", "N5", {
    type: "Магистраль", layer: "Приток", horizonId: "H_1",
    shape: "rect", rectWidth: 0.8, rectHeight: 0.6, area: 0.48, perimeter: 2.8, dh: 0.686,
    surfaceId: "smooth", surface: "Прямоугольный воздуховод", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 15, localXi: 1.5,
  }),
  makeBranch("5", "N5", "N6", {
    type: "Магистраль", layer: "Вытяжка", horizonId: "H_1",
    shape: "rect", rectWidth: 0.8, rectHeight: 0.5, area: 0.4, perimeter: 2.6, dh: 0.615,
    surfaceId: "smooth", surface: "Прямоугольный воздуховод", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 15,
  }),
  makeBranch("6", "N6", "N7", {
    type: "Магистраль", layer: "Вытяжка", horizonId: "H_1",
    shape: "rect", rectWidth: 0.8, rectHeight: 0.5, area: 0.4, perimeter: 2.6, dh: 0.615,
    surfaceId: "smooth", surface: "Прямоугольный воздуховод", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 15,
  }),
  makeBranch("7", "N7", "N8", {
    type: "Магистраль", layer: "Вытяжка", horizonId: "H_1",
    shape: "rect", rectWidth: 0.6, rectHeight: 0.5, area: 0.3, perimeter: 2.2, dh: 0.545,
    surfaceId: "smooth", surface: "Прямоугольный воздуховод", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 12,
  }),
  makeBranch("8", "N8", "N9", {
    type: "Выброс", layer: "Вытяжка", horizonId: "H_AT",
    shape: "round", diameter: 1.2, area: 1.13, perimeter: 3.77, dh: 1.2,
    surfaceId: "smooth", surface: "Стальной воздуховод круглый", roughness: 0.1, alphaCoef: 2,
    flow: 75.3, vMax: 20,
  }),
];

// Авто-расчёт длин и угла наклона на основе координат узлов
export function recalcLengths(nodes: TopoNode[], branches: TopoBranch[]): TopoBranch[] {
  return branches.map((b) => {
    const from = nodes.find((n) => n.id === b.fromId);
    const to = nodes.find((n) => n.id === b.toId);
    if (!from || !to) return b;
    const len = Math.round(calcBranchLength(from, to));
    const ang = calcBranchAngle(from, to);
    return {
      ...b,
      length: b.manualLength ? b.length : len,
      angle: b.manualAngle ? b.angle : ang,
    };
  });
}

// ─── Полный пересчёт аэродинамики ветви ─────────────────────────────────────
// Пересчитывает: геометрию сечения (S, P, Dh), сопротивление R,
// скорость, депрессию, мощность, Re — на основании заданных входов.
import { calcSection, calcResistance, velocity as calcVel, depression, airPower, reynolds } from "./aerodynamics";

export function recalcBranchAero(b: TopoBranch, rho = 1.2): TopoBranch {
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

  // 2) Сопротивление с учётом плотности воздуха
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
    rho,
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