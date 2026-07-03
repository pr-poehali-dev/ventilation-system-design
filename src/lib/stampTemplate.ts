// Единое описание стандартного штампа (основная надпись ГОСТ 21.101, форма 3)
// Размер 185×55 мм. Все координаты в миллиметрах от левого-верхнего угла штампа.
// Используется и для отрисовки на схеме (TopoCanvas), и при печати/экспорте.
import type { HorizonPrintLayer } from "@/lib/topology";

/** Полный размер штампа в мм */
export const STAMP_W_MM = 185;
export const STAMP_H_MM = 55;

/** Ключи редактируемых полей штампа (совпадают с полями HorizonPrintLayer) */
export type StampFieldKey =
  | "docCode"        // шифр документа (правый верхний блок)
  | "projectName"    // наименование объекта
  | "modeName"       // наименование чертежа / режим
  | "stage"          // стадия
  | "sheetNum"       // лист
  | "sheetTotal"     // листов
  | "orgName"        // организация
  | "scale"          // масштаб
  | "developer"      // разработал (роль-строка) — оставлено для совместимости
  | "checker"        // проверил (роль-строка) — оставлено для совместимости
  | "designerName" | "checkerName" | "normContrName" | "approverName2"
  | "designerSign"  | "checkerSign"  | "normContrSign"  | "approverSign"
  | "designerDate"  | "checkerDate"  | "normContrDate"  | "approverDate";

export interface StampCell {
  /** Прямоугольник ячейки в мм */
  x: number; y: number; w: number; h: number;
  /** Текст-подпись (нередактируемая надпись графы) */
  label?: string;
  /** Ключ редактируемого поля (если ячейка редактируется) */
  field?: StampFieldKey;
  /** Значение по умолчанию (плейсхолдер) */
  placeholder?: string;
  /** Выравнивание текста */
  align?: "left" | "center";
  /** Множитель размера шрифта относительно базового */
  fontScale?: number;
  /** Жирный текст */
  bold?: boolean;
}

// Геометрия формы 3 (упрощённая, читаемая):
// Левый блок ролей: 5 столбцов по X: 0,7,17,40,55,65; строки по 5мм (6 строк = 30мм) в нижней части.
// Верхняя часть (0..25мм по Y) — наименование объекта/чертежа.
// Правый блок (65..185) — стадия/лист/листов + организация.

const ROLE_LABEL_X = 0,  ROLE_LABEL_W = 17;    // "Разраб." и т.п.
const ROLE_NAME_X  = 17, ROLE_NAME_W  = 23;    // ФИО
const ROLE_SIGN_X  = 40, ROLE_SIGN_W  = 15;    // Подп.
const ROLE_DATE_X  = 55, ROLE_DATE_W  = 10;    // Дата
const ROW_H = 5;
const ROLES_TOP = 25;                          // верх блока ролей

/** Собрать список ячеек штампа с текущими значениями */
export function buildStampCells(pl: HorizonPrintLayer): StampCell[] {
  const cells: StampCell[] = [];

  // ── Верхняя левая часть: наименование объекта / чертежа (0..65 × 0..25) ──
  cells.push({ x: 0, y: 0, w: 65, h: 15, field: "projectName", placeholder: "Наименование объекта", align: "center", fontScale: 1.0, bold: true });
  cells.push({ x: 0, y: 15, w: 65, h: 10, field: "modeName", placeholder: "Режим проветривания", align: "center", fontScale: 0.85 });

  // ── Левый нижний блок ролей (0..65 × 25..55), 4 строки: Разраб/Пров/Н.контр/Утв ──
  const roles: { label: string; nameF: StampFieldKey; signF: StampFieldKey; dateF: StampFieldKey }[] = [
    { label: "Разраб.",  nameF: "designerName",  signF: "designerSign",  dateF: "designerDate" },
    { label: "Пров.",    nameF: "checkerName",   signF: "checkerSign",   dateF: "checkerDate" },
    { label: "Н.контр.", nameF: "normContrName", signF: "normContrSign", dateF: "normContrDate" },
    { label: "Утв.",     nameF: "approverName2", signF: "approverSign",  dateF: "approverDate" },
  ];
  roles.forEach((r, i) => {
    const y = ROLES_TOP + i * ROW_H;
    cells.push({ x: ROLE_LABEL_X, y, w: ROLE_LABEL_W, h: ROW_H, label: r.label, align: "left", fontScale: 0.7 });
    cells.push({ x: ROLE_NAME_X,  y, w: ROLE_NAME_W,  h: ROW_H, field: r.nameF, placeholder: "", align: "left", fontScale: 0.7 });
    cells.push({ x: ROLE_SIGN_X,  y, w: ROLE_SIGN_W,  h: ROW_H, field: r.signF, placeholder: "", align: "center", fontScale: 0.7 });
    cells.push({ x: ROLE_DATE_X,  y, w: ROLE_DATE_W,  h: ROW_H, field: r.dateF, placeholder: "", align: "center", fontScale: 0.7 });
  });
  // Заголовки над блоком ролей (последняя строка верхней части не нужна — роли идут сразу)

  // ── Правый блок (65..185 × 0..55) ──
  // Верхняя графа: шифр документа
  cells.push({ x: 65, y: 0, w: 120, h: 15, field: "docCode", placeholder: "Шифр документа", align: "center", fontScale: 1.0, bold: true });

  // Стадия / Лист / Листов (65..185 × 15..25)
  cells.push({ x: 65,  y: 15, w: 20, h: 5, label: "Стадия", align: "center", fontScale: 0.6 });
  cells.push({ x: 85,  y: 15, w: 20, h: 5, label: "Лист",   align: "center", fontScale: 0.6 });
  cells.push({ x: 105, y: 15, w: 80, h: 5, label: "Листов", align: "center", fontScale: 0.6 });
  cells.push({ x: 65,  y: 20, w: 20, h: 5, field: "stage",      placeholder: "Р", align: "center", fontScale: 0.85, bold: true });
  cells.push({ x: 85,  y: 20, w: 20, h: 5, field: "sheetNum",   placeholder: "1", align: "center", fontScale: 0.85 });
  cells.push({ x: 105, y: 20, w: 80, h: 5, field: "sheetTotal", placeholder: "1", align: "center", fontScale: 0.85 });

  // Организация (65..185 × 25..45)
  cells.push({ x: 65, y: 25, w: 120, h: 20, field: "orgName", placeholder: "Организация", align: "center", fontScale: 1.0, bold: true });

  // Масштаб (65..185 × 45..55)
  cells.push({ x: 65, y: 45, w: 40,  h: 10, label: "Масштаб", align: "center", fontScale: 0.6 });
  cells.push({ x: 105, y: 45, w: 80, h: 10, field: "scale", placeholder: "1:2000", align: "center", fontScale: 1.0, bold: true });

  return cells;
}

/** Линии внешней/внутренней сетки штампа в мм (для отрисовки рамок) */
export function buildStampGridLines(): { x1: number; y1: number; x2: number; y2: number; thick?: boolean }[] {
  const L: { x1: number; y1: number; x2: number; y2: number; thick?: boolean }[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number, thick = false) => L.push({ x1, y1, x2, y2, thick });

  // Внешняя рамка
  push(0, 0, STAMP_W_MM, 0, true);
  push(0, STAMP_H_MM, STAMP_W_MM, STAMP_H_MM, true);
  push(0, 0, 0, STAMP_H_MM, true);
  push(STAMP_W_MM, 0, STAMP_W_MM, STAMP_H_MM, true);

  // Вертикальный раздел левого/правого блоков
  push(65, 0, 65, STAMP_H_MM, true);

  // Левый блок: горизонтали
  push(0, 15, 65, 15);
  push(0, 25, 65, 25, true);
  for (let i = 1; i < 6; i++) push(0, 25 + i * 5, 65, 25 + i * 5);
  // Левый блок: вертикали ролей
  [17, 40, 55].forEach(x => push(x, 25, x, 55));

  // Правый блок: горизонтали
  push(65, 15, STAMP_W_MM, 15, true);
  push(65, 20, STAMP_W_MM, 20);
  push(65, 25, STAMP_W_MM, 25, true);
  push(65, 45, STAMP_W_MM, 45);
  // Правый блок: вертикали строки стадия/лист/листов
  [85, 105].forEach(x => push(x, 15, x, 25));
  // Масштаб-разделитель
  push(105, 45, 105, 55);

  return L;
}

/** Прочитать значение поля из слоя печати */
export function getStampFieldValue(pl: HorizonPrintLayer, field: StampFieldKey): string {
  const v = (pl as unknown as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

/**
 * Вычислить геометрию штампа (правый нижний угол рамки, фикс. размер по формату).
 * paperWmm — ширина листа в мм с учётом ориентации; rw/rh/inset — рамка чертежа в px.
 */
export function computeStampBox(
  rx: number, ry: number, rw: number, rh: number, inset: number,
  paperWmm: number, stampOffsetX = 0, stampOffsetY = 0,
): { pxPerMm: number; stW: number; stH: number; sx: number; sy: number } {
  const pxPerMm = rw / paperWmm;
  const stW = STAMP_W_MM * pxPerMm;
  const stH = STAMP_H_MM * pxPerMm;
  const sx = rx + rw - inset - stW + stampOffsetX;
  const sy = ry + rh - inset - stH + stampOffsetY;
  return { pxPerMm, stW, stH, sx, sy };
}

/** Сгенерировать SVG-строку штампа (для печати/экспорта, без интерактива) */
export function buildStampSvgString(
  pl: HorizonPrintLayer,
  box: { pxPerMm: number; stW: number; stH: number; sx: number; sy: number },
): string {
  const esc = (s: string) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const nf = (v: number) => v.toFixed(2);
  const { pxPerMm, stW, stH, sx, sy } = box;
  const mx = (m: number) => sx + m * pxPerMm;
  const my = (m: number) => sy + m * pxPerMm;
  const sw = Math.max(0.4, pxPerMm * 0.35);
  const swThin = Math.max(0.25, pxPerMm * 0.18);
  const baseFs = Math.max(5, pxPerMm * 2.3);

  let out = `<rect x="${nf(sx)}" y="${nf(sy)}" width="${nf(stW)}" height="${nf(stH)}" fill="white"/>`;
  for (const ln of buildStampGridLines()) {
    out += `<line x1="${nf(mx(ln.x1))}" y1="${nf(my(ln.y1))}" x2="${nf(mx(ln.x2))}" y2="${nf(my(ln.y2))}" stroke="#1a1a1a" stroke-width="${nf(ln.thick ? sw : swThin)}"/>`;
  }
  for (const c of buildStampCells(pl)) {
    const cw = c.w * pxPerMm, ch = c.h * pxPerMm;
    const fs = baseFs * (c.fontScale ?? 1);
    const tx = c.align === "left" ? mx(c.x) + pxPerMm * 1.2 : mx(c.x) + cw / 2;
    const ty = my(c.y) + ch / 2;
    const anchor = c.align === "left" ? "start" : "middle";
    const weight = c.bold ? "bold" : "normal";
    if (c.label && !c.field) {
      out += `<text x="${nf(tx)}" y="${nf(ty)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${nf(fs)}" font-family="Arial, sans-serif" font-weight="${weight}" fill="#333">${esc(c.label)}</text>`;
    } else if (c.field) {
      const val = getStampFieldValue(pl, c.field);
      if (val) out += `<text x="${nf(tx)}" y="${nf(ty)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${nf(fs)}" font-family="Arial, sans-serif" font-weight="${weight}" fill="#111">${esc(val)}</text>`;
    }
  }
  return out;
}