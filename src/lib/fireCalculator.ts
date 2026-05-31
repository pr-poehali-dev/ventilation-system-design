// ─────────────────────────────────────────────────────────────────────────────
// fireCalculator.ts — Расчёт аварийного вентиляционного режима при пожаре
//
// Физическая модель:
//   • Тепловыделение Q (МВт) → температура продуктов горения T (°C)
//   • Тепловая депрессия пожара h_t (Па) → влияние на вентиляционный режим
//   • Оценка устойчивости: опрокинется ли нисходящая струя
//   • Распределение продуктов горения: CO, CO₂, дым по ветвям сети
//
// Ориентир: методика ПО Аэросеть / ВНИМИ / ИГД им. Скочинского
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoBranch, type TopoNode } from "./topology";

// ─── Константы горения ────────────────────────────────────────────────────────

// Теплоёмкость воздуха (кДж/(кг·К))
const CP_AIR = 1.005;
// Плотность воздуха при н.у. (кг/м³)
const RHO_AIR_0 = 1.2;
// g = 9.81 м/с²
const G = 9.81;

// Характеристики горючих материалов
export interface CombustibleProps {
  id: string;
  name: string;
  // выход CO при горении (кг CO / кг горючего)
  coYield: number;
  // выход CO₂ (кг/кг)
  co2Yield: number;
  // выход дыма (кг/кг) — для оптической плотности
  smokeYield: number;
  // удельная теплота горения (МДж/кг)
  heatValue: number;
  // скорость линейного распространения (м/мин) — для оценки площади
  spreadRate: number;
}

export const COMBUSTIBLES: CombustibleProps[] = [
  { id: "coal",    name: "Уголь",               coYield: 0.04,  co2Yield: 2.2,  smokeYield: 0.03, heatValue: 25,  spreadRate: 0.5 },
  { id: "timber",  name: "Древесина (крепь)",   coYield: 0.05,  co2Yield: 1.5,  smokeYield: 0.015,heatValue: 16,  spreadRate: 1.0 },
  { id: "cable",   name: "Кабель",               coYield: 0.10,  co2Yield: 1.8,  smokeYield: 0.12, heatValue: 18,  spreadRate: 0.3 },
  { id: "oil",     name: "Масло/горючее",        coYield: 0.06,  co2Yield: 3.1,  smokeYield: 0.08, heatValue: 42,  spreadRate: 2.0 },
  { id: "conveyor",name: "Конвейерная лента",    coYield: 0.08,  co2Yield: 2.0,  smokeYield: 0.10, heatValue: 20,  spreadRate: 0.8 },
  { id: "custom",  name: "Произвольный",         coYield: 0.05,  co2Yield: 2.0,  smokeYield: 0.05, heatValue: 25,  spreadRate: 1.0 },
];

export function getCombustible(id: string): CombustibleProps {
  return COMBUSTIBLES.find(c => c.id === id) ?? COMBUSTIBLES[COMBUSTIBLES.length - 1];
}

// ─── Тип результата расчёта пожара ───────────────────────────────────────────

export interface FireBranchResult {
  branchId: string;
  // Температура воздуха на выходе ветви (°C)
  airTempOut: number;
  // Тепловая депрессия (Па) — добавляется/вычитается из аэродинамического баланса
  thermalDepression: number;
  // Устойчивость: true = струя опрокинется (нисходящее проветривание)
  willReverse: boolean;
  // Концентрация CO (% об.)
  coConc: number;
  // Концентрация CO₂ (% об.)
  co2Conc: number;
  // Оптическая плотность дыма (м⁻¹)
  smokeDensity: number;
  // Видимость в дыму (м)
  visibility: number;
  // Опасность для людей
  hazardLevel: "safe" | "warning" | "danger" | "lethal";
}

export interface FireCalculationResult {
  // Температура продуктов горения в очаге (°C)
  fireTemp: number;
  // Тепловая депрессия самого очага (Па)
  fireThermalDep: number;
  // Результаты по ветвям (только затронутые задымлением)
  branches: Map<string, FireBranchResult>;
  // Ветви с опрокинутой струёй
  reversedBranches: Set<string>;
  // Общий журнал расчёта
  log: string[];
}

// ─── Расчёт температуры по мощности пожара ───────────────────────────────────
// Формула: T = T₀ + Q / (ṁ · Cp)
// где ṁ = ρ · Q_air (кг/с), Q_air = расход воздуха (м³/с) в ветви

export function calcFireTemp(
  heatRelease_MW: number,   // МВт
  airFlow_m3s: number,      // м³/с — фактический расход в ветви
  ambientTemp_C: number = 20,
): number {
  if (airFlow_m3s <= 0) return ambientTemp_C + 500; // нет продувки — перегрев
  const Q_W = heatRelease_MW * 1e6;                 // Вт
  const rho = RHO_AIR_0 * 293 / (273 + ambientTemp_C);
  const massFlow = rho * airFlow_m3s;               // кг/с
  const deltaT = Q_W / (massFlow * CP_AIR * 1000);  // К
  return Math.min(1200, ambientTemp_C + deltaT);    // ограничиваем 1200°C
}

// ─── Тепловая депрессия пожара ────────────────────────────────────────────────
// h_t = g · L · sin(α) · (T_fire - T_amb) / (T_amb + 273) · ρ₀
// Знак: + если пожар в нисходящей ветви (помогает потоку),
//        - если в восходящей (противодействует потоку → опасность опрокидывания)

export function calcThermalDepression(
  fireTemp_C: number,
  ambientTemp_C: number,
  branchLength_m: number,
  branchAngle_deg: number,  // положительный = восходящая
): number {
  const Tf = fireTemp_C + 273;
  const T0 = ambientTemp_C + 273;
  const sinA = Math.sin((branchAngle_deg * Math.PI) / 180);
  const rho = RHO_AIR_0 * 293 / T0;
  // Тепловая депрессия (Па)
  return G * branchLength_m * Math.abs(sinA) * ((Tf - T0) / T0) * rho * Math.sign(sinA);
}

// ─── Концентрации продуктов горения ──────────────────────────────────────────
// Упрощённая модель: продукты разбавляются свежим воздухом в потоке

export function calcGasConcentrations(
  heatRelease_MW: number,
  airFlow_m3s: number,
  combustible: CombustibleProps,
): { coConc: number; co2Conc: number; smokeDensity: number; visibility: number } {
  if (airFlow_m3s <= 0) {
    return { coConc: 2.0, co2Conc: 15.0, smokeDensity: 10, visibility: 0 };
  }

  // Масса сгоревшего материала (кг/с) из мощности и теплоты горения
  const burnRate_kgs = (heatRelease_MW * 1e3) / combustible.heatValue; // кг/с

  // Объём воздуха (м³/с при н.у.)
  const airFlow_Nm3s = airFlow_m3s * (RHO_AIR_0 / 1.293);

  // CO: кг/с → объём (м³/с) → концентрация %
  const coMassRate = burnRate_kgs * combustible.coYield;
  const coVolRate = coMassRate / 1.25;   // плотность CO ≈ 1.25 кг/м³
  const coConc = Math.min(2.0, (coVolRate / (airFlow_Nm3s + coVolRate)) * 100);

  // CO₂
  const co2MassRate = burnRate_kgs * combustible.co2Yield;
  const co2VolRate = co2MassRate / 1.977; // плотность CO₂ ≈ 1.977 кг/м³
  const co2Conc = Math.min(20.0, (co2VolRate / (airFlow_Nm3s + co2VolRate)) * 100 + 0.04);

  // Дым: оптическая плотность (м⁻¹)
  const smokeMassRate = burnRate_kgs * combustible.smokeYield;
  const smokeSpec = 7700; // специфическая экстинкция для угольного дыма (м²/кг)
  const smokeDensity = Math.min(10, (smokeMassRate * smokeSpec) / airFlow_Nm3s);

  // Видимость по формуле Эйнхорна: V = C / D_s, C = 2..8 м (отражающие знаки)
  const visibility = smokeDensity > 0 ? Math.min(100, 3 / smokeDensity) : 100;

  return { coConc, co2Conc, smokeDensity, visibility };
}

// ─── Уровень опасности ────────────────────────────────────────────────────────

export function calcHazardLevel(
  coConc: number,
  co2Conc: number,
  smokeDensity: number,
  airTempOut: number,
): "safe" | "warning" | "danger" | "lethal" {
  // Летальные концентрации / условия
  if (coConc > 0.4 || co2Conc > 10 || airTempOut > 60) return "lethal";
  // Опасные
  if (coConc > 0.1 || co2Conc > 5 || airTempOut > 40 || smokeDensity > 2) return "danger";
  // Предупреждение
  if (coConc > 0.02 || co2Conc > 1 || smokeDensity > 0.5) return "warning";
  return "safe";
}

// ─── Главная функция расчёта ──────────────────────────────────────────────────
// Принимает текущее состояние сети (после обычного сетевого расчёта)
// и ветви с установленными очагами пожара.
// Возвращает: температуры, концентрации, тепловые депрессии, признаки опрокидывания

export function calcFireMode(
  branches: TopoBranch[],
  nodes: TopoNode[],
  ambientTemp_C: number = 20,
): FireCalculationResult {
  const log: string[] = [];
  const resultMap = new Map<string, FireBranchResult>();
  const reversedBranches = new Set<string>();

  // 1. Находим ветви с очагами пожара
  const fireBranches = branches.filter(b => b.hasFire);
  if (fireBranches.length === 0) {
    return { fireTemp: ambientTemp_C, fireThermalDep: 0, branches: resultMap, reversedBranches, log: ["Очагов пожара не обнаружено"] };
  }

  log.push(`Обнаружено очагов пожара: ${fireBranches.length}`);

  // 2. Для каждого очага — расчёт локальных параметров
  for (const fb of fireBranches) {
    const Q_MW = fb.fireMode === "heat" ? fb.fireHeatRelease : 0;
    const airQ = Math.abs(fb.flow ?? 0); // м³/с из результатов сетевого расчёта

    // Температура в очаге
    const fireTemp = fb.fireMode === "temp"
      ? fb.fireTemperature
      : calcFireTemp(Q_MW, airQ, ambientTemp_C);

    // Тепловая депрессия
    const thermalDep = calcThermalDepression(
      fireTemp, ambientTemp_C, fb.length, fb.angle ?? 0,
    );

    // Концентрации
    const comb = getCombustible(fb.fireCombustible ?? "coal");
    const { coConc, co2Conc, smokeDensity, visibility } = calcGasConcentrations(
      Q_MW, airQ, comb,
    );

    // Опрокидывание: нисходящая ветвь (angle < 0) + тепловая депрессия > аэродинамической
    const isDescending = (fb.angle ?? 0) < -1;
    const willReverse = isDescending && Math.abs(thermalDep) > Math.abs(fb.dP ?? 0) * 0.5;

    const hazard = calcHazardLevel(coConc, co2Conc, smokeDensity, fireTemp);

    const result: FireBranchResult = {
      branchId: fb.id,
      airTempOut: Math.round(fireTemp * 10) / 10,
      thermalDepression: Math.round(thermalDep * 10) / 10,
      willReverse,
      coConc: Math.round(coConc * 1000) / 1000,
      co2Conc: Math.round(co2Conc * 100) / 100,
      smokeDensity: Math.round(smokeDensity * 100) / 100,
      visibility: Math.round(visibility * 10) / 10,
      hazardLevel: hazard,
    };

    resultMap.set(fb.id, result);
    if (willReverse) reversedBranches.add(fb.id);

    log.push(`Ветвь ${fb.id}: Q=${Q_MW} МВт, T=${result.airTempOut}°C, h_t=${result.thermalDepression} Па, CO=${result.coConc}%, видимость=${result.visibility} м${willReverse ? " ⚠️ ОПРОКИДЫВАНИЕ" : ""}`);
  }

  // 3. Распространение задымления по сети — простой обход вниз по потоку
  // Строим граф смежности по направлению потока
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  void nodeMap;

  // BFS от очагов по направлению потока
  const smoked = new Map<string, { coConc: number; co2Conc: number; smokeDensity: number; temp: number }>();

  for (const fb of fireBranches) {
    const res = resultMap.get(fb.id)!;
    smoked.set(fb.id, { coConc: res.coConc, co2Conc: res.co2Conc, smokeDensity: res.smokeDensity, temp: res.airTempOut });
  }

  // Обходим ветви: если входящий узел уже «задымлён» — задымляем ветвь с разбавлением
  const MAX_HOPS = 20;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let changed = false;
    for (const b of branches) {
      if (b.hasFire || resultMap.has(b.id)) continue; // уже обработана
      const flow = b.flow ?? 0;
      if (Math.abs(flow) < 0.01) continue; // нет потока

      // Узел-источник: fromId если flow > 0, toId если flow < 0
      const srcId = flow > 0 ? b.fromId : b.toId;
      const inSmoke = smoked.get(srcId) ?? (() => {
        // ищем ветви, входящие в этот узел с задымлением
        const inBranches = branches.filter(ib => {
          const ibFlow = ib.flow ?? 0;
          return Math.abs(ibFlow) > 0.01 &&
            (ibFlow > 0 ? ib.toId === srcId : ib.fromId === srcId) &&
            smoked.has(ib.id);
        });
        if (inBranches.length === 0) return null;
        // Смешиваем потоки
        let totalQ = 0, wCO = 0, wCO2 = 0, wSmoke = 0, wTemp = 0;
        for (const ib of inBranches) {
          const s = smoked.get(ib.id)!;
          const q = Math.abs(ib.flow ?? 0);
          totalQ += q; wCO += s.coConc * q; wCO2 += s.co2Conc * q;
          wSmoke += s.smokeDensity * q; wTemp += s.temp * q;
        }
        if (totalQ < 0.01) return null;
        return { coConc: wCO / totalQ, co2Conc: wCO2 / totalQ, smokeDensity: wSmoke / totalQ, temp: wTemp / totalQ };
      })();

      if (!inSmoke) continue;

      // Разбавление в ветви: дым рассеивается пропорционально длине (упрощённо 10%/100м)
      const dilutionFactor = Math.max(0.1, 1 - b.length * 0.001);
      const coOut = inSmoke.coConc * dilutionFactor;
      const co2Out = Math.max(0.04, inSmoke.co2Conc * dilutionFactor);
      const smokeOut = inSmoke.smokeDensity * dilutionFactor;
      const visOut = smokeOut > 0 ? Math.min(100, 3 / smokeOut) : 100;
      // Температура: снижается по закону теплоотдачи в стенки (≈0.1°C/м)
      const tempOut = ambientTemp_C + (inSmoke.temp - ambientTemp_C) * Math.exp(-b.length * 0.003);

      if (coOut < 0.001 && smokeOut < 0.05) continue; // несущественное задымление

      const hazard = calcHazardLevel(coOut, co2Out, smokeOut, tempOut);
      resultMap.set(b.id, {
        branchId: b.id,
        airTempOut: Math.round(tempOut * 10) / 10,
        thermalDepression: 0,
        willReverse: false,
        coConc: Math.round(coOut * 1000) / 1000,
        co2Conc: Math.round(co2Out * 100) / 100,
        smokeDensity: Math.round(smokeOut * 100) / 100,
        visibility: Math.round(visOut * 10) / 10,
        hazardLevel: hazard,
      });

      const dstId = flow > 0 ? b.toId : b.fromId;
      smoked.set(b.id, { coConc: coOut, co2Conc: co2Out, smokeDensity: smokeOut, temp: tempOut });
      smoked.set(dstId, { coConc: coOut, co2Conc: co2Out, smokeDensity: smokeOut, temp: tempOut });
      changed = true;
    }
    if (!changed) break;
  }

  log.push(`Задымлено ветвей: ${resultMap.size}`);
  if (reversedBranches.size > 0) {
    log.push(`⚠️ Опрокидывание струи: ${[...reversedBranches].join(", ")}`);
  }

  const firstFire = fireBranches[0];
  const firstResult = resultMap.get(firstFire.id)!;

  return {
    fireTemp: firstResult.airTempOut,
    fireThermalDep: firstResult.thermalDepression,
    branches: resultMap,
    reversedBranches,
    log,
  };
}

// ─── Цвет ветви по уровню опасности ──────────────────────────────────────────
export function hazardColor(level: "safe" | "warning" | "danger" | "lethal"): string {
  switch (level) {
    case "lethal":  return "#7f1d1d"; // тёмно-красный
    case "danger":  return "#dc2626"; // красный
    case "warning": return "#f59e0b"; // жёлто-оранжевый
    default:        return "";        // нет подсветки
  }
}
