// ─────────────────────────────────────────────────────────────────────────────
// Параметрическая база фасонных частей
// ζ зависит от геометрии (углы, отношение площадей, диаметров)
// Источник: Идельчик И.Е. «Справочник по гидравлическим сопротивлениям»
// ─────────────────────────────────────────────────────────────────────────────

import type { DuctParams } from "./aero";
import { getArea } from "./aero";

export type FittingKind =
  | "elbow"           // отвод (параметр: угол, R/D)
  | "tee_pass"        // тройник проход
  | "tee_branch"      // тройник ответвление
  | "reducer"         // конфузор/диффузор (параметр: F2/F1)
  | "entry"           // вход
  | "outlet"          // выход
  | "grille"          // решётка
  | "damper"          // дроссель (параметр: угол прикрытия)
  | "filter"          // фильтр
  | "device";         // оборудование (фиксированное ζ)

export interface FittingDef {
  kind: FittingKind;
  name: string;
  group: string;
  // Параметры формы — могут зависеть от ветви
  params?: {
    angle?: number;       // ° (отводы, дроссели)
    radiusRatio?: number; // R/D (отводы)
    areaRatio?: number;   // F2/F1 (переходы, тройники)
    angleClose?: number;  // ° закрытия дросселя
  };
  // Расчёт ζ по геометрии
  calcZeta: (p?: FittingDef["params"], duct?: DuctParams, branchDuct?: DuctParams) => number;
  icon?: string;        // SVG-путь для отрисовки на схеме
}

// ─── Расчёт ζ для отводов (Идельчик, табл. 6.1) ─────────────────────────────
// Зависит от угла α и отношения R/D

function elbowZeta(angle: number, rd: number, isRect = false): number {
  // Базовый ζ для 90° по R/D
  const A = isRect ? 1.4 : 1.0;
  let zeta90: number;
  if (rd <= 0.5) zeta90 = 1.10 * A;
  else if (rd <= 1.0) zeta90 = 0.21 * A;
  else if (rd <= 1.5) zeta90 = 0.17 * A;
  else if (rd <= 2.0) zeta90 = 0.15 * A;
  else zeta90 = 0.11 * A;

  // Коррекция по углу (k = sin²(α/2) для α≤90°, для α>90° другая формула)
  const k = angle <= 90 ? Math.pow(Math.sin(angle * Math.PI / 360), 2) * 2 : 1 + (angle - 90) / 180;
  return Math.round(zeta90 * k * 100) / 100;
}

// ─── Расчёт ζ для тройника на проход ────────────────────────────────────────
// Зависит от отношения расходов Qбок/Qобщ (упрощённо берём через areaRatio)

function teePassZeta(areaRatio = 1): number {
  // F_проход / F_общий
  if (areaRatio >= 0.9) return 0.10;
  if (areaRatio >= 0.7) return 0.30;
  if (areaRatio >= 0.5) return 0.55;
  return 0.80;
}

function teeBranchZeta(areaRatio = 0.5): number {
  // F_ответв / F_общий, угол 90°
  if (areaRatio >= 0.9) return 1.00;
  if (areaRatio >= 0.7) return 1.30;
  if (areaRatio >= 0.5) return 1.50;
  if (areaRatio >= 0.3) return 1.85;
  return 2.40;
}

// ─── Конфузор / диффузор ────────────────────────────────────────────────────
// areaRatio = F2/F1

function reducerZeta(areaRatio: number): number {
  if (areaRatio === 1) return 0;
  if (areaRatio < 1) {
    // Конфузор (сужение)
    const n = 1 / areaRatio;
    if (n <= 1.5) return 0.07;
    if (n <= 2) return 0.13;
    if (n <= 3) return 0.22;
    return 0.30;
  } else {
    // Диффузор (расширение)
    return Math.pow(1 - 1 / areaRatio, 2);
  }
}

// ─── Дроссель-клапан (Идельчик, ζ от угла прикрытия) ────────────────────────

function damperZeta(angleClose: number): number {
  const table: [number, number][] = [
    [0, 0.20], [10, 0.45], [20, 1.50], [30, 3.90],
    [40, 10.8], [50, 32.6], [60, 118], [70, 750],
  ];
  for (let i = 0; i < table.length - 1; i++) {
    if (angleClose >= table[i][0] && angleClose <= table[i + 1][0]) {
      const [x1, y1] = table[i], [x2, y2] = table[i + 1];
      const t = (angleClose - x1) / (x2 - x1);
      return Math.round((y1 + t * (y2 - y1)) * 100) / 100;
    }
  }
  return angleClose < 0 ? 0.2 : 750;
}

// ─── Каталог фасонных частей ────────────────────────────────────────────────

export const FITTINGS: Record<string, FittingDef> = {
  // ─── Отводы ─────────────────────────────────────────────────────────────
  elbow_90_r1: {
    kind: "elbow", name: "Отвод 90° (R/D=1)", group: "Отводы",
    params: { angle: 90, radiusRatio: 1.0 },
    calcZeta: (p, d) => elbowZeta(p?.angle ?? 90, p?.radiusRatio ?? 1.0, d?.shape === "rect"),
  },
  elbow_90_r05: {
    kind: "elbow", name: "Отвод 90° (R/D=0.5)", group: "Отводы",
    params: { angle: 90, radiusRatio: 0.5 },
    calcZeta: (p, d) => elbowZeta(p?.angle ?? 90, p?.radiusRatio ?? 0.5, d?.shape === "rect"),
  },
  elbow_45: {
    kind: "elbow", name: "Отвод 45°", group: "Отводы",
    params: { angle: 45, radiusRatio: 1.0 },
    calcZeta: (p, d) => elbowZeta(p?.angle ?? 45, p?.radiusRatio ?? 1.0, d?.shape === "rect"),
  },
  elbow_30: {
    kind: "elbow", name: "Отвод 30°", group: "Отводы",
    params: { angle: 30, radiusRatio: 1.0 },
    calcZeta: (p) => elbowZeta(p?.angle ?? 30, p?.radiusRatio ?? 1.0),
  },
  elbow_segment: {
    kind: "elbow", name: "Сегментный отвод 90°", group: "Отводы",
    params: { angle: 90, radiusRatio: 1.5 },
    calcZeta: (p) => elbowZeta(p?.angle ?? 90, p?.radiusRatio ?? 1.5) * 1.15,
  },

  // ─── Тройники ───────────────────────────────────────────────────────────
  tee_pass_eq: {
    kind: "tee_pass", name: "Тройник проход (равные)", group: "Тройники",
    params: { areaRatio: 1.0 },
    calcZeta: (p) => teePassZeta(p?.areaRatio ?? 1.0),
  },
  tee_pass_red: {
    kind: "tee_pass", name: "Тройник проход (с сужением)", group: "Тройники",
    params: { areaRatio: 0.7 },
    calcZeta: (p) => teePassZeta(p?.areaRatio ?? 0.7),
  },
  tee_branch_90: {
    kind: "tee_branch", name: "Тройник ответвление 90°", group: "Тройники",
    params: { areaRatio: 0.5, angle: 90 },
    calcZeta: (p) => teeBranchZeta(p?.areaRatio ?? 0.5),
  },
  tee_branch_45: {
    kind: "tee_branch", name: "Тройник ответвление 45°", group: "Тройники",
    params: { areaRatio: 0.5, angle: 45 },
    calcZeta: (p) => teeBranchZeta(p?.areaRatio ?? 0.5) * 0.7,
  },
  tee_split: {
    kind: "tee_branch", name: "Крестовина", group: "Тройники",
    params: { areaRatio: 0.5 },
    calcZeta: (p) => teeBranchZeta(p?.areaRatio ?? 0.5) * 1.2,
  },

  // ─── Переходы ───────────────────────────────────────────────────────────
  reducer_smooth: {
    kind: "reducer", name: "Конфузор плавный", group: "Переходы",
    params: { areaRatio: 0.5 },
    calcZeta: (p) => reducerZeta(p?.areaRatio ?? 0.5),
  },
  diffuser_smooth: {
    kind: "reducer", name: "Диффузор плавный", group: "Переходы",
    params: { areaRatio: 2.0 },
    calcZeta: (p) => reducerZeta(p?.areaRatio ?? 2.0),
  },
  reducer_round_to_rect: {
    kind: "reducer", name: "Переход круг→прямоуг.", group: "Переходы",
    calcZeta: () => 0.15,
  },

  // ─── Входы / выходы ─────────────────────────────────────────────────────
  entry_sharp:    { kind: "entry", name: "Вход с острой кромкой", group: "Входы/выходы", calcZeta: () => 0.50 },
  entry_smooth:   { kind: "entry", name: "Вход плавный", group: "Входы/выходы", calcZeta: () => 0.05 },
  entry_grid:     { kind: "entry", name: "Вход с защитной решёткой", group: "Входы/выходы", calcZeta: () => 1.20 },
  outlet_atm:     { kind: "outlet", name: "Выход в атмосферу", group: "Входы/выходы", calcZeta: () => 1.00 },
  outlet_room:    { kind: "outlet", name: "Выход в помещение", group: "Входы/выходы", calcZeta: () => 1.00 },

  // ─── Решётки и диффузоры ────────────────────────────────────────────────
  grille_supply:    { kind: "grille", name: "Решётка приточная АМН", group: "Решётки", calcZeta: () => 2.00 },
  grille_exhaust:   { kind: "grille", name: "Решётка вытяжная АМН", group: "Решётки", calcZeta: () => 1.50 },
  diffuser_4way:    { kind: "grille", name: "Диффузор потолочный 4-стор.", group: "Решётки", calcZeta: () => 3.50 },
  diffuser_swirl:   { kind: "grille", name: "Вихревой диффузор", group: "Решётки", calcZeta: () => 4.20 },
  jet_nozzle:       { kind: "grille", name: "Сопло струйное", group: "Решётки", calcZeta: () => 0.70 },

  // ─── Регулирующие ───────────────────────────────────────────────────────
  damper_open:    {
    kind: "damper", name: "Дроссель-клапан (открыт)", group: "Арматура",
    params: { angleClose: 0 },
    calcZeta: (p) => damperZeta(p?.angleClose ?? 0),
  },
  damper_45:      {
    kind: "damper", name: "Дроссель-клапан 45°", group: "Арматура",
    params: { angleClose: 45 },
    calcZeta: (p) => damperZeta(p?.angleClose ?? 45),
  },
  shiber_open:    { kind: "damper", name: "Шибер открытый", group: "Арматура", calcZeta: () => 0.10 },
  iris_damper:    { kind: "damper", name: "Ирисовый клапан", group: "Арматура", calcZeta: () => 1.50 },
  fire_damper:    { kind: "damper", name: "Противопожарный клапан", group: "Арматура", calcZeta: () => 0.40 },

  // ─── Фильтры и оборудование ─────────────────────────────────────────────
  filter_g3:      { kind: "filter", name: "Фильтр G3 (карманный)", group: "Оборудование", calcZeta: () => 18.0 },
  filter_g4:      { kind: "filter", name: "Фильтр G4 (карманный)", group: "Оборудование", calcZeta: () => 25.0 },
  filter_f7:      { kind: "filter", name: "Фильтр F7 (тонкий)", group: "Оборудование", calcZeta: () => 50.0 },
  filter_h13:     { kind: "filter", name: "Фильтр HEPA H13", group: "Оборудование", calcZeta: () => 120.0 },
  heater_water:   { kind: "device", name: "Калорифер водяной (2-рядный)", group: "Оборудование", calcZeta: () => 12.0 },
  heater_water_4: { kind: "device", name: "Калорифер водяной (4-рядный)", group: "Оборудование", calcZeta: () => 24.0 },
  cooler_freon:   { kind: "device", name: "Охладитель фреоновый", group: "Оборудование", calcZeta: () => 18.0 },
  recuperator:    { kind: "device", name: "Рекуператор пластинчатый", group: "Оборудование", calcZeta: () => 45.0 },
  silencer:       { kind: "device", name: "Шумоглушитель", group: "Оборудование", calcZeta: () => 6.0 },
  uv_lamp:        { kind: "device", name: "УФ-лампа", group: "Оборудование", calcZeta: () => 1.5 },
};

// ─── Группировка для UI ─────────────────────────────────────────────────────

export function getFittingsByGroup(): Record<string, [string, FittingDef][]> {
  return Object.entries(FITTINGS).reduce((acc, [k, v]) => {
    (acc[v.group] ??= []).push([k, v]);
    return acc;
  }, {} as Record<string, [string, FittingDef][]>);
}

// ─── Расчёт актуального ζ с учётом параметров ───────────────────────────────

export function evalZeta(fittingKey: string, params?: FittingDef["params"], duct?: DuctParams, branchDuct?: DuctParams): number {
  const def = FITTINGS[fittingKey];
  if (!def) return 0;
  return def.calcZeta(params ?? def.params, duct, branchDuct);
}

// ─── Авторасстановка КМС в узлах схемы ──────────────────────────────────────
// Анализирует топологию: для каждого узла определяет тип (тройник, отвод, переход)
// и автоматически добавляет соответствующие КМС в ветви.

interface NodeTopology {
  nodeId: string;
  incoming: string[];  // ID ветвей, входящих в узел (to == nodeId)
  outgoing: string[];  // ID ветвей, исходящих из узла (from == nodeId)
}

interface AutoBranch {
  id: string;
  from: string;
  to: string;
  params: DuctParams;
}

interface AutoNode {
  id: string;
  type: "supply" | "exhaust" | "junction" | "fan";
}

export interface AutoKmsResult {
  branchUpdates: Record<string, { type: string; zeta: number; count: number; auto?: boolean }[]>;
  log: string[];
}

export function autoAssignKMS(nodes: AutoNode[], branches: AutoBranch[]): AutoKmsResult {
  const result: Record<string, { type: string; zeta: number; count: number; auto?: boolean }[]> = {};
  const log: string[] = [];

  // Строим топологию по узлам
  const topo: Record<string, NodeTopology> = {};
  nodes.forEach((n) => {
    topo[n.id] = { nodeId: n.id, incoming: [], outgoing: [] };
  });
  branches.forEach((b) => {
    topo[b.to]?.incoming.push(b.id);
    topo[b.from]?.outgoing.push(b.id);
  });

  // Для каждой ветви аккумулируем авто-КМС
  branches.forEach((b) => { result[b.id] = []; });

  const branchById: Record<string, AutoBranch> = {};
  branches.forEach((b) => { branchById[b.id] = b; });

  const nodeById: Record<string, AutoNode> = {};
  nodes.forEach((n) => { nodeById[n.id] = n; });

  // Анализ узлов
  for (const node of nodes) {
    const t = topo[node.id];
    const totalConnections = t.incoming.length + t.outgoing.length;

    // ─── Источник / приёмник ─────────────────────────────────────────────
    if (node.type === "supply" || node.type === "fan") {
      // Вход в систему — на исходящих ставим entry
      t.outgoing.forEach((bid) => {
        if (!result[bid].some((kms) => kms.type === "entry_smooth")) {
          result[bid].push({ type: "entry_smooth", zeta: 0.05, count: 1, auto: true });
        }
      });
      log.push(`${node.id}: вход в систему`);
      continue;
    }
    if (node.type === "exhaust") {
      // Выход — на входящих ставим решётку и выход
      t.incoming.forEach((bid) => {
        if (!result[bid].some((kms) => kms.type === "grille_exhaust")) {
          result[bid].push({ type: "grille_exhaust", zeta: 1.5, count: 1, auto: true });
        }
      });
      t.outgoing.forEach((bid) => {
        if (!result[bid].some((kms) => kms.type === "grille_exhaust")) {
          result[bid].push({ type: "grille_exhaust", zeta: 1.5, count: 1, auto: true });
        }
      });
      log.push(`${node.id}: вытяжка → решётка`);
      continue;
    }

    // ─── Узел разветвления (junction) ───────────────────────────────────
    if (node.type === "junction") {
      // Пересчитываем тип узла по топологии
      if (totalConnections === 2) {
        // Простой проходной узел — возможно, отвод
        const allBranches = [...t.incoming, ...t.outgoing];
        if (allBranches.length === 2) {
          // Добавляем отвод на одну из ветвей (на исходящую, если есть)
          const targetId = t.outgoing[0] ?? t.incoming[0];
          if (!result[targetId].some((kms) => kms.type === "elbow_90_r1")) {
            result[targetId].push({ type: "elbow_90_r1", zeta: 0.21, count: 1, auto: true });
          }
          log.push(`${node.id}: отвод 90°`);
        }
      } else if (totalConnections === 3) {
        // Тройник: 1 вход → 2 выхода (разделение) или 2 входа → 1 выход (слияние)
        const isSplit = t.incoming.length === 1 && t.outgoing.length === 2;
        const isMerge = t.incoming.length === 2 && t.outgoing.length === 1;

        if (isSplit) {
          const [inB] = t.incoming;
          const inBranch = branchById[inB];
          const inArea = inBranch ? getArea(inBranch.params) : 1;

          t.outgoing.forEach((bid, idx) => {
            const outBranch = branchById[bid];
            const outArea = outBranch ? getArea(outBranch.params) : 1;
            const ratio = outArea / inArea;

            if (idx === 0) {
              // Первая ветвь — проход
              const z = teePassZeta(ratio);
              if (!result[bid].some((kms) => kms.type === "tee_pass_eq" || kms.type === "tee_pass_red")) {
                result[bid].push({ type: ratio >= 0.9 ? "tee_pass_eq" : "tee_pass_red", zeta: z, count: 1, auto: true });
              }
            } else {
              // Вторая ветвь — ответвление
              const z = teeBranchZeta(ratio);
              if (!result[bid].some((kms) => kms.type === "tee_branch_90")) {
                result[bid].push({ type: "tee_branch_90", zeta: z, count: 1, auto: true });
              }
            }
          });
          log.push(`${node.id}: тройник разделение`);
        } else if (isMerge) {
          const [outB] = t.outgoing;
          const outBranch = branchById[outB];
          const outArea = outBranch ? getArea(outBranch.params) : 1;
          t.incoming.forEach((bid, idx) => {
            const inBranch = branchById[bid];
            const inArea = inBranch ? getArea(inBranch.params) : 1;
            const ratio = inArea / outArea;
            if (idx === 0) {
              if (!result[bid].some((kms) => kms.type === "tee_pass_eq" || kms.type === "tee_pass_red")) {
                result[bid].push({ type: ratio >= 0.9 ? "tee_pass_eq" : "tee_pass_red", zeta: teePassZeta(ratio), count: 1, auto: true });
              }
            } else {
              if (!result[bid].some((kms) => kms.type === "tee_branch_90")) {
                result[bid].push({ type: "tee_branch_90", zeta: teeBranchZeta(ratio), count: 1, auto: true });
              }
            }
          });
          log.push(`${node.id}: тройник слияние`);
        }
      } else if (totalConnections >= 4) {
        // Крестовина / коллектор
        const allBranches = [...t.incoming, ...t.outgoing];
        allBranches.forEach((bid) => {
          if (!result[bid].some((kms) => kms.type === "tee_split")) {
            result[bid].push({ type: "tee_split", zeta: 1.8, count: 1, auto: true });
          }
        });
        log.push(`${node.id}: коллектор (${totalConnections} ветв.)`);
      }
    }
  }

  // ─── Проверка переходов сечения между смежными ветвями ──────────────────
  for (const node of nodes) {
    if (node.type !== "junction") continue;
    const t = topo[node.id];
    if (t.incoming.length === 1 && t.outgoing.length === 1) {
      const inBranch = branchById[t.incoming[0]];
      const outBranch = branchById[t.outgoing[0]];
      if (!inBranch || !outBranch) continue;
      const inArea = getArea(inBranch.params);
      const outArea = getArea(outBranch.params);
      const ratio = outArea / inArea;
      if (Math.abs(ratio - 1) > 0.1) {
        // Переход
        const isReducer = ratio < 1;
        const z = reducerZeta(ratio);
        const key = isReducer ? "reducer_smooth" : "diffuser_smooth";
        if (!result[outBranch.id].some((kms) => kms.type === key)) {
          result[outBranch.id].push({ type: key, zeta: z, count: 1, auto: true });
        }
        log.push(`${node.id}: ${isReducer ? "конфузор" : "диффузор"} F2/F1=${ratio.toFixed(2)}`);
      }
    }
  }

  return { branchUpdates: result, log };
}
