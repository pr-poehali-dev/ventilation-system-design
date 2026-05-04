// ─────────────────────────────────────────────────────────────────────────────
// Аксонометрическая (изометрическая) проекция
// Стандарт: фронтальная диметрия / изометрия 30°
// ─────────────────────────────────────────────────────────────────────────────

export interface Floor {
  id: string;
  name: string;        // "1 этаж", "Подвал", "Кровля"
  level: number;       // высотная отметка в метрах (0, 3.0, 6.0...)
  height: number;      // высота этажа, м
  color: string;       // цвет обводки на схеме
  visible: boolean;
}

export interface Point3D { x: number; y: number; z: number; }
export interface Point2D { x: number; y: number; }

// ─── Изометрическая проекция (углы 30°) ─────────────────────────────────────
// Преобразование 3D → 2D
// X' = (x - y) * cos(30°)
// Y' = (x + y) * sin(30°) - z

const COS30 = Math.cos(Math.PI / 6); // 0.866
const SIN30 = Math.sin(Math.PI / 6); // 0.5

export const ISO_SCALE = {
  z: 60, // пикселей на метр высоты
};

export function project(p: Point3D, origin: Point2D = { x: 0, y: 0 }): Point2D {
  return {
    x: origin.x + (p.x - p.y) * COS30,
    y: origin.y + (p.x + p.y) * SIN30 - p.z * ISO_SCALE.z,
  };
}

// Преобразование плановых координат узла + высоты в 3D
export function nodeTo3D(planX: number, planY: number, level: number): Point3D {
  // План в пикселях → метры с учётом масштаба сетки
  return { x: planX, y: planY, z: level };
}

// ─── Стандартный набор этажей ────────────────────────────────────────────────

export const DEFAULT_FLOORS: Floor[] = [
  { id: "F1", name: "1 этаж", level: 0,   height: 3.0, color: "#3b82f6", visible: true },
  { id: "F2", name: "2 этаж", level: 3.0, height: 3.0, color: "#10b981", visible: true },
  { id: "F3", name: "3 этаж", level: 6.0, height: 3.0, color: "#f59e0b", visible: true },
];

// ─── Утилиты для отрисовки изометрических элементов ─────────────────────────

// Сетка пола для этажа в изометрии
export function generateFloorGrid(floor: Floor, sizeX: number, sizeY: number, step = 100, origin?: Point2D): { lines: { x1: number; y1: number; x2: number; y2: number }[] } {
  const o = origin ?? { x: 0, y: 0 };
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let x = 0; x <= sizeX; x += step) {
    const a = project({ x, y: 0, z: floor.level }, o);
    const b = project({ x, y: sizeY, z: floor.level }, o);
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  for (let y = 0; y <= sizeY; y += step) {
    const a = project({ x: 0, y, z: floor.level }, o);
    const b = project({ x: sizeX, y, z: floor.level }, o);
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return { lines };
}

// Контур уровня этажа (прямоугольник в плане)
export function floorOutline(floor: Floor, sizeX: number, sizeY: number, origin?: Point2D): Point2D[] {
  const o = origin ?? { x: 0, y: 0 };
  return [
    project({ x: 0, y: 0, z: floor.level }, o),
    project({ x: sizeX, y: 0, z: floor.level }, o),
    project({ x: sizeX, y: sizeY, z: floor.level }, o),
    project({ x: 0, y: sizeY, z: floor.level }, o),
  ];
}

export function pointsToPath(pts: Point2D[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
}
