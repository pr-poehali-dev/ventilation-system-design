// Единое описание блока «УТВЕРЖДАЮ» (правый верхний угол чертежа).
// Фиксированный размер 75×40 мм. Координаты в мм от левого-верхнего угла блока.
// Используется и для отрисовки на схеме (TopoCanvas), и при печати/экспорте.
import type { HorizonPrintLayer } from "@/lib/topology";

/** Размер блока УТВЕРЖДАЮ в мм */
export const APPROVER_W_MM = 75;
export const APPROVER_H_MM = 40;

/** Ключи редактируемых полей блока (совпадают с полями HorizonPrintLayer) */
export type ApproverFieldKey =
  | "approverTitle"  // должность
  | "orgName"        // организация
  | "approverName"   // ФИО
  | "day" | "month" | "year";

export interface ApproverElement {
  /** Позиция текста в мм */
  x: number; y: number;
  /** Статичная надпись (нередактируемая) */
  label?: string;
  /** Ключ редактируемого поля */
  field?: ApproverFieldKey;
  /** Плейсхолдер */
  placeholder?: string;
  /** Выравнивание */
  align?: "left" | "center" | "right";
  /** Множитель шрифта относительно базового */
  fontScale?: number;
  /** Цвет текста */
  color?: string;
  /** Ширина области ячейки для редактирования (мм). По умолчанию до края блока. */
  cellW?: number;
  /** X-начало ячейки для редактирования (мм). По умолчанию 0. */
  cellX?: number;
}

export interface ApproverLine {
  x1: number; y1: number; x2: number; y2: number;
}

const CX = APPROVER_W_MM / 2;

/** Собрать элементы блока УТВЕРЖДАЮ */
export function buildApproverElements(): ApproverElement[] {
  return [
    { x: CX, y: 5,  label: "УТВЕРЖДАЮ", align: "center", fontScale: 1.1 },
    { x: CX, y: 12, field: "approverTitle", placeholder: "Должность", align: "center", fontScale: 0.95, cellX: 4, cellW: APPROVER_W_MM - 8 },
    { x: CX, y: 18, field: "orgName",       placeholder: "Организация", align: "center", fontScale: 0.95, cellX: 4, cellW: APPROVER_W_MM - 8 },
    // ФИО над линией подписи
    { x: APPROVER_W_MM - 4, y: 27, field: "approverName", placeholder: "И.О. Фамилия", align: "right", fontScale: 0.95, color: "#1a44b8", cellX: 22, cellW: APPROVER_W_MM - 26 },
    // Дата: «день» месяц год г.
    { x: 3,  y: 36, label: "«", align: "left", fontScale: 0.95 },
    { x: 6,  y: 36, field: "day",   placeholder: "__", align: "left", fontScale: 0.95, cellX: 5,  cellW: 8 },
    { x: 13, y: 36, label: "»",     align: "left", fontScale: 0.95 },
    { x: 16, y: 36, field: "month", placeholder: "__________", align: "left", fontScale: 0.95, cellX: 16, cellW: 30 },
    { x: APPROVER_W_MM - 3, y: 36, field: "year", placeholder: "", align: "right", fontScale: 0.95, cellX: APPROVER_W_MM - 22, cellW: 18 },
  ];
}

/** Линии-подчёркивания блока (в мм) */
export function buildApproverLines(): ApproverLine[] {
  return [
    { x1: 8, y1: 22, x2: APPROVER_W_MM - 8, y2: 22 }, // под должностью/организацией
    { x1: 0, y1: 30, x2: APPROVER_W_MM, y2: 30 },     // под ФИО (линия подписи)
  ];
}

/** Значение поля */
export function getApproverFieldValue(pl: HorizonPrintLayer, field: ApproverFieldKey): string {
  const v = (pl as unknown as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

/** Геометрия блока (правый верхний угол рамки, фикс. размер по формату) */
export function computeApproverBox(
  rx: number, ry: number, rw: number, inset: number, paperWmm: number,
): { pxPerMm: number; w: number; h: number; ax: number; ay: number } {
  const pxPerMm = rw / paperWmm;
  const w = APPROVER_W_MM * pxPerMm;
  const h = APPROVER_H_MM * pxPerMm;
  const ax = rx + rw - inset - w;
  const ay = ry + inset;
  return { pxPerMm, w, h, ax, ay };
}

/** SVG-строка блока УТВЕРЖДАЮ (для печати/экспорта) */
export function buildApproverSvgString(
  pl: HorizonPrintLayer,
  box: { pxPerMm: number; w: number; h: number; ax: number; ay: number },
): string {
  const esc = (s: string) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const nf = (v: number) => v.toFixed(2);
  const { pxPerMm, w, h, ax, ay } = box;
  const mx = (m: number) => ax + m * pxPerMm;
  const my = (m: number) => ay + m * pxPerMm;
  const baseFs = Math.max(6, pxPerMm * 2.6);
  const lw = Math.max(0.4, pxPerMm * 0.15);
  const yearNow = String(new Date().getFullYear());

  let out = `<rect x="${nf(ax)}" y="${nf(ay)}" width="${nf(w)}" height="${nf(h)}" fill="white"/>`;
  for (const ln of buildApproverLines()) {
    out += `<line x1="${nf(mx(ln.x1))}" y1="${nf(my(ln.y1))}" x2="${nf(mx(ln.x2))}" y2="${nf(my(ln.y2))}" stroke="#111" stroke-width="${nf(lw)}"/>`;
  }
  for (const el of buildApproverElements()) {
    const fs = baseFs * (el.fontScale ?? 1);
    const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
    const color = el.color ?? "#111";
    let txt = el.label ?? "";
    if (el.field) {
      const v = getApproverFieldValue(pl, el.field);
      txt = v || (el.field === "year" ? yearNow : "");
      if (el.field === "year" && txt) txt += " г.";
    }
    if (!txt) continue;
    out += `<text x="${nf(mx(el.x))}" y="${nf(my(el.y))}" text-anchor="${anchor}" dominant-baseline="central" font-size="${nf(fs)}" font-family="Arial, sans-serif" fill="${color}">${esc(txt)}</text>`;
  }
  return out;
}
