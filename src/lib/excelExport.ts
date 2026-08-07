// ─────────────────────────────────────────────────────────────────────────────
// excelExport.ts — Экспорт параметров выработок и узлов в Excel (.xlsx)
// Поддерживает типы: "Выработки", "Конечные вершины"
// Наборы параметров: предустановленные + пользовательский
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { TopoBranch, TopoNode, Horizon } from "./topology";

// ─── Типы ────────────────────────────────────────────────────────────────────

export type ExportAreaId = "all" | string; // "all" | horizonId

export type ExportType = "branches" | "nodes";

export type ExportPreset =
  | "all"
  | "depressions"
  | "flows"
  | "main_vent"
  | "speed_check"
  | "stability"
  | "objects"
  | "waterpipes"
  | "custom";

export interface ExportColumn {
  key: string;
  label: string;
  group: string;
}

// ─── Колонки для ВЫРАБОТОК ───────────────────────────────────────────────────

export const BRANCH_COLUMNS: ExportColumn[] = [
  // Общее
  { key: "name",          label: "Название",                                group: "Общее" },
  { key: "number",        label: "Номер",                                   group: "Общее" },
  { key: "layer",         label: "Слой",                                    group: "Общее" },
  { key: "horizonName",   label: "Номера вершин",                           group: "Общее" },
  { key: "fromNumber",    label: "Начальная вершина",                       group: "Общее" },
  { key: "toNumber",      label: "Конечная вершина",                        group: "Общее" },
  { key: "length",        label: "Длина м",                                 group: "Геометрия" },
  { key: "angle",         label: "Уклон °",                                 group: "Геометрия" },
  { key: "perimeter",     label: "Периметр выработки м",                   group: "Геометрия" },
  { key: "area",          label: "Площадь поперечного сечения м²",         group: "Геометрия" },
  { key: "ventArea",      label: "Площадь вентокна м²",                    group: "Геометрия" },
  { key: "alphaCoef",     label: "Коэффициент шероховатости стенок",       group: "Аэродинамика" },
  { key: "vMax",          label: "Модальный расход воздуха м³/с",          group: "Аэродинамика" },
  { key: "vMin",          label: "Минимальная допустимая скорость воздуха м/с", group: "Аэродинамика" },
  { key: "velocity",      label: "Модельная скорость воздуха м/с",         group: "Расчётные" },
  { key: "vMaxCalc",      label: "Максимальная допустимая скорость воздуха м/с", group: "Аэродинамика" },
  { key: "resistance",    label: "Аэродинамическое сопротивление мюрг",    group: "Аэродинамика" },
  { key: "resistanceFan", label: "Аэродинамическое сопротивление вентсооружений мюрг", group: "Аэродинамика" },
  { key: "rTotal",        label: "Полное аэродинамическое сопротивление мюрг", group: "Аэродинамика" },
  { key: "dP",            label: "Модельное падение давления в выработке Па", group: "Расчётные" },
  { key: "dPFan",         label: "Модельное падение давления в вентсооружениях Па", group: "Расчётные" },
  { key: "flowDeviation", label: "Отклонение модельного расхода %",        group: "Расчётные" },
  { key: "guaranteedFlow",label: "Гарантированный расход м³/с",            group: "Расчётные" },
  { key: "factDeltaP",    label: "Фактическое падение давления Па",        group: "Расчётные" },
  { key: "flow",          label: "Фактический расход воздуха м³/с",        group: "Расчётные" },
  { key: "airTemp",       label: "Температура воздуха °C",                 group: "Расчётные" },
  { key: "igConditions",  label: "Интегральный показатель условий охлаждения (обморожения) ИГ", group: "Расчётные" },
  { key: "frostRisk",     label: "Риски обморожения",                      group: "Расчётные" },
  { key: "ch4",           label: "Концентрация CH4 %",                     group: "Газы" },
  { key: "co",            label: "Концентрация CO мг/м³",                  group: "Газы" },
  { key: "h2",            label: "Концентрация H2 %",                      group: "Газы" },
  { key: "nox",           label: "Концентрация NOx мг/м³",                 group: "Газы" },
  { key: "thermalCrit",   label: "Тепловая критическая депрессия Па",      group: "Пожар" },
  { key: "thermalFire",   label: "Тепловая депрессия пожара Па",           group: "Пожар" },
  { key: "reverseRisk",   label: "Опасная по опрокидыванию",               group: "Пожар" },
  { key: "fireLoad",      label: "Пожарная нагрузка",                      group: "Пожар" },
  // Замерные станции
  { key: "measStation",   label: "Номер замерной станции",                 group: "Замеры" },
  { key: "measFlow",      label: "Расход на замерной станции м³/с",        group: "Замеры" },
  { key: "measVelocity",  label: "Скорость на замерной станции м/с",       group: "Замеры" },
  { key: "measArea",      label: "Площадь сечения на замерной станции м²", group: "Замеры" },
  { key: "measHumidity",  label: "Влажность воздуха на замерной станции %", group: "Замеры" },
  { key: "measCH4",       label: "Концентрация CH4 на замерной станции %", group: "Замеры" },
  { key: "measCO",        label: "Концентрация CO на замерной станции мг/м³", group: "Замеры" },
  { key: "measCO2",       label: "Концентрация CO2 на замерной станции %", group: "Замеры" },
  { key: "measH2S",       label: "Концентрация H2S на замерной станции мг/м³", group: "Замеры" },
  { key: "measNO",        label: "Концентрация NO на замерной станции мг/м³", group: "Замеры" },
  { key: "measNO2",       label: "Концентрация NO2 на замерной станции мг/м³", group: "Замеры" },
  { key: "measNOx",       label: "Концентрация NOx на замерной станции мг/м³", group: "Замеры" },
  { key: "measO2",        label: "Концентрация O2 на замерной станции %",  group: "Замеры" },
  { key: "measSO2",       label: "Концентрация SO2 на замерной станции мг/м³", group: "Замеры" },
];

// ─── Колонки для УЗЛОВ (ВЕРШИН) ─────────────────────────────────────────────

export const NODE_COLUMNS: ExportColumn[] = [
  { key: "name",          label: "Название",                               group: "Общее" },
  { key: "number",        label: "Номер",                                  group: "Общее" },
  { key: "x",             label: "Координата X",                          group: "Координаты" },
  { key: "y",             label: "Координата Y",                          group: "Координаты" },
  { key: "z",             label: "Высотная отметка Z",                    group: "Координаты" },
  { key: "waterStaticP",  label: "Статическое давление воды МПа",         group: "Вода" },
  { key: "waterDynamicP", label: "Динамическое давление воды МПа",        group: "Вода" },
  { key: "computedAirTemp",  label: "Фактическая температура воздуха °C", group: "Температура" },
  { key: "modelAirTemp",     label: "Модельная температура воздуха °C",   group: "Температура" },
  { key: "computedPressure", label: "Модельное давление воздуха Па",      group: "Давление" },
  { key: "wallTemp",         label: "Фактическая температура стенок °C",  group: "Температура" },
  { key: "computedWallTemp", label: "Модельная температура стенок °C",    group: "Температура" },
  { key: "computedGasConc",  label: "Модельная концентрация газа %",      group: "Газы" },
  { key: "computedExplosivePressure", label: "Модельное давление взрыва кПа", group: "Взрыв" },
];

// ─── Предустановки параметров ────────────────────────────────────────────────

export const BRANCH_PRESETS: Record<ExportPreset, string[]> = {
  all: BRANCH_COLUMNS.map(c => c.key),
  depressions: ["name","number","horizonName","length","resistance","dP","dPFan","factDeltaP","flow","velocity"],
  flows: ["name","number","horizonName","fromNumber","toNumber","length","flow","velocity","vMin","vMaxCalc"],
  main_vent: ["name","number","horizonName","fromNumber","toNumber","length","angle","area","perimeter","alphaCoef","resistance","rTotal","flow","velocity","dP","airTemp"],
  speed_check: ["name","number","horizonName","length","area","velocity","vMin","vMaxCalc","flow"],
  stability: ["name","number","horizonName","length","flow","dP","thermalCrit","thermalFire","reverseRisk"],
  objects: ["name","number","horizonName","length","area","resistance","flow","velocity"],
  waterpipes: ["name","number","horizonName","length"],
  custom: [],
};

export const PRESET_LABELS: Record<ExportPreset, string> = {
  all: "Все параметры",
  depressions: "Распределение депрессий по выработкам рудника",
  flows: "Распределение расхода воздуха",
  main_vent: "Основные параметры модели вентиляционной сети рудника",
  speed_check: "Проверка по допустимым скоростям движения воздуха",
  stability: "Расчёт устойчивости проветривания рудника",
  objects: "Параметры объектов на выработках",
  waterpipes: "Трубопроводы",
  custom: "Пользовательский набор параметров",
};

// ─── Получение значения ячейки ветви ─────────────────────────────────────────

function getBranchValue(
  b: TopoBranch,
  key: string,
  nodes: TopoNode[],
  horizons: Horizon[]
): string | number {
  const fromNode = nodes.find(n => n.id === b.fromId);
  const toNode   = nodes.find(n => n.id === b.toId);
  const horizon  = horizons.find(h => h.id === b.horizonId);

  switch (key) {
    case "name":           return b.type || "";
    case "number":         return b.id.slice(-4);
    case "layer":          return b.layer || "";
    case "horizonName":    return horizon?.name || "";
    case "fromNumber":     return fromNode?.number || fromNode?.name || "";
    case "toNumber":       return toNode?.number || toNode?.name || "";
    case "length":         return +b.length.toFixed(2);
    case "angle":          return +(b.angle ?? 0).toFixed(1);
    case "perimeter":      return +b.perimeter.toFixed(3);
    case "area":           return +b.area.toFixed(3);
    case "ventArea":       return +b.area.toFixed(3);
    case "alphaCoef":      return +b.alphaCoef.toFixed(6);
    case "vMax":           return +b.vMax.toFixed(2);
    case "vMin":           return 0;
    case "velocity":       return +b.velocity.toFixed(3);
    case "vMaxCalc":       return +b.vMax.toFixed(3);
    case "resistance":     return +(b.resistance / 9.81e-3).toFixed(6);
    case "resistanceFan":  return 0;
    case "rTotal":         return +(b.resistance / 9.81e-3).toFixed(6);
    case "dP":             return +b.dP.toFixed(2);
    case "dPFan":          return b.hasFan ? +b.fanPressure.toFixed(2) : 0;
    case "flowDeviation":  return 0;
    case "guaranteedFlow": return 0;
    case "factDeltaP":     return +b.dP.toFixed(2);
    case "flow":           return +b.flow.toFixed(3);
    case "airTemp":        return 0;
    case "igConditions":   return 0;
    case "frostRisk":      return 0;
    case "ch4":            return 0;
    case "co":             return 0;
    case "h2":             return 0;
    case "nox":            return 0;
    case "thermalCrit":    return 0;
    case "thermalFire":    return 0;
    case "reverseRisk":    return b.fanReverse ? "Да" : "Нет";
    case "fireLoad": {
      const parts: string[] = [];
      if (b.fireLoadTech)         parts.push(b.fireVehicleName ? b.fireVehicleName : "Техника");
      if (b.fireLoadConveyor)     parts.push(b.fireBeltName    ? b.fireBeltName    : "Конвейерная лента");
      if (b.fireLoadCable)        parts.push(b.fireCableName   ? b.fireCableName   : "Электрокабель");
      if (b.fireLoadWoodSupport)  parts.push(b.fireWoodName    ? b.fireWoodName    : "Деревянная крепь");
      return parts.join("; ");
    }
    case "measStation":    return "";
    case "measFlow":       return 0;
    case "measVelocity":   return 0;
    case "measArea":       return 0;
    case "measHumidity":   return 0;
    case "measCH4":        return 0;
    case "measCO":         return 0;
    case "measCO2":        return 0;
    case "measH2S":        return 0;
    case "measNO":         return 0;
    case "measNO2":        return 0;
    case "measNOx":        return 0;
    case "measO2":         return 0;
    case "measSO2":        return 0;
    default:               return "";
  }
}

// ─── Получение значения ячейки узла ──────────────────────────────────────────

function getNodeValue(n: TopoNode, key: string): string | number {
  switch (key) {
    case "name":           return n.name || "";
    case "number":         return n.number || "";
    case "x":             return +n.x.toFixed(2);
    case "y":             return +n.y.toFixed(2);
    case "z":             return +n.z.toFixed(2);
    case "waterStaticP":  return +n.fireComputedStaticP.toFixed(4);
    case "waterDynamicP": return +n.fireComputedDynamicP.toFixed(4);
    case "computedAirTemp":  return +n.computedAirTemp.toFixed(1);
    case "modelAirTemp":     return +n.computedAirTemp.toFixed(1);
    case "computedPressure": return +n.computedPressure.toFixed(1);
    case "wallTemp":         return +n.wallTemp.toFixed(1);
    case "computedWallTemp": return +n.computedWallTemp.toFixed(1);
    case "computedGasConc":  return +n.computedGasConc.toFixed(3);
    case "computedExplosivePressure": return +n.computedExplosivePressure.toFixed(3);
    default:               return "";
  }
}

// ─── Стили заголовков ─────────────────────────────────────────────────────────

function makeHeaderStyle(): XLSX.CellStyle {
  return {
    font: { bold: true, sz: 9 },
    fill: { fgColor: { rgb: "D9E1F2" }, patternType: "solid" },
    alignment: { wrapText: true, vertical: "center", horizontal: "center" },
    border: {
      top:    { style: "thin", color: { rgb: "8EA9C1" } },
      bottom: { style: "thin", color: { rgb: "8EA9C1" } },
      left:   { style: "thin", color: { rgb: "8EA9C1" } },
      right:  { style: "thin", color: { rgb: "8EA9C1" } },
    },
  };
}

function makeDataStyle(rowIdx: number): XLSX.CellStyle {
  return {
    font: { sz: 9 },
    fill: { fgColor: { rgb: rowIdx % 2 === 0 ? "FFFFFF" : "F2F5FB" }, patternType: "solid" },
    alignment: { vertical: "center" },
    border: {
      left:  { style: "thin", color: { rgb: "D0D8E8" } },
      right: { style: "thin", color: { rgb: "D0D8E8" } },
    },
  };
}

// ─── Основная функция экспорта ───────────────────────────────────────────────

export interface ExportParams {
  areaId: ExportAreaId;
  type: ExportType;
  selectedKeys: string[];
  branches: TopoBranch[];
  nodes: TopoNode[];
  horizons: Horizon[];
  projectName: string;
}

export function exportToExcel(params: ExportParams): void {
  const { areaId, type, selectedKeys, branches, nodes, horizons, projectName } = params;

  const wb = XLSX.utils.book_new();

  if (type === "branches") {
    // Фильтр по горизонту
    const filtered = areaId === "all"
      ? branches
      : branches.filter(b => b.horizonId === areaId);

    const columns = BRANCH_COLUMNS.filter(c => selectedKeys.includes(c.key));
    const headers = columns.map(c => c.label);
    const rows = filtered.map(b =>
      columns.map(c => getBranchValue(b, c.key, nodes, horizons))
    );

    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Ширины колонок
    ws["!cols"] = columns.map(c => ({
      wch: Math.max(c.label.length, 14),
    }));

    // Высота строки заголовка
    ws["!rows"] = [{ hpx: 40 }];

    // Стили заголовков
    columns.forEach((_, ci) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (ws[cellRef]) ws[cellRef].s = makeHeaderStyle();
    });

    // Стили данных
    rows.forEach((_, ri) => {
      columns.forEach((_, ci) => {
        const cellRef = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
        if (ws[cellRef]) ws[cellRef].s = makeDataStyle(ri);
      });
    });

    // Закрепить строку заголовка
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    // Автофильтр
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }),
    };

    XLSX.utils.book_append_sheet(wb, ws, "Выработки");
  } else {
    // Узлы
    const filtered = areaId === "all"
      ? nodes.filter(n => !n.atmosphereLink)
      : nodes.filter(n => !n.atmosphereLink);

    const columns = NODE_COLUMNS.filter(c => selectedKeys.includes(c.key));
    const headers = columns.map(c => c.label);
    const rows = filtered.map(n =>
      columns.map(c => getNodeValue(n, c.key))
    );

    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = columns.map(c => ({ wch: Math.max(c.label.length, 14) }));
    ws["!rows"] = [{ hpx: 40 }];

    columns.forEach((_, ci) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (ws[cellRef]) ws[cellRef].s = makeHeaderStyle();
    });
    rows.forEach((_, ri) => {
      columns.forEach((_, ci) => {
        const cellRef = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
        if (ws[cellRef]) ws[cellRef].s = makeDataStyle(ri);
      });
    });

    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(wb, ws, "Вершины");
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${projectName || "ПВ-Система"}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}