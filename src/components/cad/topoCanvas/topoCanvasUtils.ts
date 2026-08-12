// ─────────────────────────────────────────────────────────────────────────────
// topoCanvasUtils.ts — чистые утилиты холста: попадание курсора по узлам/ветвям
// и форматирование сопротивления.
//
// Вынесено из TopoCanvas.tsx БЕЗ изменений логики: те же имена, сигнатуры,
// формулы и допуски. Функции не зависят от React и состояния компонента.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type ProjNodeEntry } from "./topoCanvasTypes";

// Стабильные пустые константы — НЕ создавать inline (new Set()/[] создают новую ссылку при каждом рендере,
// что сбрасывает мемоизацию и вызывает лишние перерисовки canvas)
export const EMPTY_SET = new Set<string>();
export const EMPTY_ARRAY: never[] = [];

// Форматирует сопротивление с авто-выбором значащих цифр (не показывает 0.0000)
export function fmtR(rMkyurg: number, unit: { fromBase: (v: number) => number; symbol: string; decimals: number }): string {
  const v = unit.fromBase(rMkyurg);
  if (v === 0) return `0 ${unit.symbol}`;
  // Определяем количество знаков чтобы показать хотя бы 2 значащих цифры
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const decimals = Math.max(unit.decimals, -mag + 1);
  return `${v.toFixed(decimals)}${unit.symbol}`;
}

// ─── Утилиты попадания ─────────────────────────────────────────────────────
export function hitNodeR(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[],
  r = 8): string | null {
  const r2 = r * r;
  for (let i = projNodes.length - 1; i >= 0; i--) {
    const p = projNodes[i];
    const dx = sx - p.sx;
    const dy = sy - p.sy;
    if (dx * dx + dy * dy < r2) return p.node.id;
  }
  return null;
}

export function hitNode(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[]): string | null {
  return hitNodeR(sx, sy, projNodes, 8);
}

export function hitBranchR(sx: number, sy: number,
  projNodesMap: Map<string, ProjNodeEntry>,
  branches: TopoBranch[], tol = 5): string | null {
  const tol2 = tol * tol;

  // Функция: расстояние² от точки (sx,sy) до отрезка (x1,y1)→(x2,y2)
  const distSqToSeg = (x1: number, y1: number, x2: number, y2: number): number => {
    const C = x2 - x1, D = y2 - y1;
    const lenSq = C * C + D * D;
    if (lenSq === 0) { const dx = sx - x1, dy = sy - y1; return dx * dx + dy * dy; }
    const t = Math.max(0, Math.min(1, ((sx - x1) * C + (sy - y1) * D) / lenSq));
    const dx = sx - (x1 + t * C), dy = sy - (y1 + t * D);
    return dx * dx + dy * dy;
  };

  for (const b of branches) {
    const from = projNodesMap.get(b.fromId);
    const to = projNodesMap.get(b.toId);
    if (!from || !to) continue;
    const C = to.sx - from.sx, D = to.sy - from.sy;
    const lenSq = C * C + D * D;
    if (lenSq === 0) continue;

    // 1. Проверка попадания по основной линии ветви
    if (distSqToSeg(from.sx, from.sy, to.sx, to.sy) < tol2) return b.id;

    // 2. Если есть вентруба — проверяем попадание по параллельной линии трубы
    //    (смещение: нормаль к ветви × vpOffset пикселей, как в рендере)
    if (b.hasVentPipe) {
      const segLen = Math.sqrt(lenSq);
      const ux = C / segLen, uy = D / segLen;
      // нормаль (перпендикуляр влево)
      const nx = -uy, ny = ux;
      // Используем толщину ветви ≈ 4px + 3px offset (как в SVG рендере: w/2 + 3)
      const vpOff = 4 / 2 + 3;
      const vx1 = from.sx + nx * vpOff, vy1 = from.sy + ny * vpOff;
      const vx2 = to.sx   + nx * vpOff, vy2 = to.sy   + ny * vpOff;
      // tolerance для трубы чуть больше (7px) — тонкая линия
      if (distSqToSeg(vx1, vy1, vx2, vy2) < 7 * 7) return b.id;
    }
  }
  return null;
}

export function hitBranch(sx: number, sy: number,
  projNodesMap: Map<string, ProjNodeEntry>,
  branches: TopoBranch[]): string | null {
  return hitBranchR(sx, sy, projNodesMap, branches, 8);
}
