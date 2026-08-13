// ─────────────────────────────────────────────────────────────────────────────
// useCadHeaters — калориферы: подогрев воздуха и разнос температур по сети.
//
// Вынесено из Cad.tsx БЕЗ изменений логики: тот же алгоритм обхода вниз по
// потоку, те же зависимости useCallback/useMemo/useEffect и тот же автосброс
// подогрева при отключении калориферов.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useRef, useEffect } from "react";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { HeatingSeason } from "./cadTypes";
import type { SchemaSymbol } from "./cadTypes";
import { HEATER_SYMBOL_IDS } from "@/lib/schemaSymbols";
import {
  calcHeater, isHeaterActive, DEFAULT_HEATER_EFFICIENCY, MIN_SHAFT_TEMP_C,
} from "@/lib/heaterCalculator";

export interface HeaterInfoItem {
  symId: string;
  branchId: string;
  power: number;
  dt: number;
  outTemp: number;
  meetsNorm: boolean;
}

export interface CadHeatersDeps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  schemaSymbols: SchemaSymbol[];
  heatingSeason: HeatingSeason;
  baseNodeTemps: Record<string, number>;
  surfaceTemp: number;
  setNodes: (fn: (prev: TopoNode[]) => TopoNode[]) => void;
  addLog: (kind: string, msg: string) => void;
}

export function useCadHeaters(d: CadHeatersDeps) {
  const {
    nodes, branches, schemaSymbols, heatingSeason,
    baseNodeTemps, surfaceTemp, setNodes, addLog,
  } = d;

  // Возвращает температуры узлов с учётом работающих калориферов. Подогрев
  // идёт ВНИЗ ПО ПОТОКУ от ветви с калорифером: греется сам узел за ним и все
  // узлы, куда этот воздух приходит дальше (с разбавлением на слияниях).
  // Если калориферов нет или все выключены — возвращает базовые температуры,
  // то есть подогрев автоматически СБРАСЫВАЕТСЯ (в т.ч. при переходе на лето).
  const calcHeaterTemps = useCallback((): {
    temps: Map<string, number>;
    info: HeaterInfoItem[];
  } => {
    const temps = new Map<string, number>();
    for (const n of nodes) temps.set(n.id, baseNodeTemps[n.id] ?? surfaceTemp);
    const info: HeaterInfoItem[] = [];

    const heaters = schemaSymbols.filter(
      s => HEATER_SYMBOL_IDS.has(s.typeId) && s.branchId && isHeaterActive(s.htMode, heatingSeason),
    );
    if (heaters.length === 0) return { temps, info };

    const brMap = new Map(branches.map(b => [b.id, b]));
    // Суммарный приток в узел — для разбавления подогретого воздуха на слияниях
    const inflowQ = new Map<string, number>();
    for (const b of branches) {
      const q = Math.abs(b.flow ?? 0);
      if (q <= 0) continue;
      const outId = (b.flow ?? 0) >= 0 ? b.toId : b.fromId;
      inflowQ.set(outId, (inflowQ.get(outId) ?? 0) + q);
    }

    for (const sym of heaters) {
      const b = brMap.get(sym.branchId!);
      if (!b) continue;
      const flow = b.flow ?? 0;
      const inNodeId  = flow >= 0 ? b.fromId : b.toId;
      const outNodeId = flow >= 0 ? b.toId   : b.fromId;
      const inTemp = temps.get(inNodeId) ?? surfaceTemp;

      const res = calcHeater({
        method: sym.htMethod ?? "power",
        power_kW: sym.htPower ?? 0,
        outTemp_C: sym.htOutTemp ?? MIN_SHAFT_TEMP_C,
        efficiency: sym.htEfficiency ?? DEFAULT_HEATER_EFFICIENCY,
        inTemp_C: inTemp,
        airFlow_m3s: flow,
      });
      info.push({
        symId: sym.id, branchId: b.id,
        power: res.power_kW, dt: res.deltaT_C,
        outTemp: res.outTemp_C, meetsNorm: res.meetsNorm,
      });
      if (res.deltaT_C <= 0) continue;

      // Разносим подогрев вниз по потоку обходом в ширину. Ограничение по числу
      // шагов защищает от зацикливания на кольцевых схемах.
      const queue: { nodeId: string; dt: number }[] = [{ nodeId: outNodeId, dt: res.deltaT_C }];
      const visited = new Set<string>();
      let guard = 0;
      while (queue.length > 0 && guard++ < 20000) {
        const cur = queue.shift()!;
        if (cur.dt < 0.05) continue;               // подогрев рассеялся
        if (visited.has(cur.nodeId)) continue;
        visited.add(cur.nodeId);
        temps.set(cur.nodeId, (temps.get(cur.nodeId) ?? surfaceTemp) + cur.dt);

        for (const nb of branches) {
          const nf = nb.flow ?? 0;
          if (Math.abs(nf) <= 0) continue;
          const nIn  = nf >= 0 ? nb.fromId : nb.toId;
          if (nIn !== cur.nodeId) continue;
          const nOut = nf >= 0 ? nb.toId : nb.fromId;
          // Разбавление: подогретый поток смешивается со всем притоком узла
          const total = Math.max(Math.abs(nf), inflowQ.get(nOut) ?? Math.abs(nf));
          const dil = total > 0 ? Math.abs(nf) / total : 1;
          queue.push({ nodeId: nOut, dt: cur.dt * dil });
        }
      }
    }
    return { temps, info };
  }, [nodes, branches, schemaSymbols, heatingSeason, baseNodeTemps, surfaceTemp]);

  // Итог по калориферам — для панели свойств и лога расчёта
  const heaterInfo = useMemo(() => calcHeaterTemps(), [calcHeaterTemps]);

  // АВТОСБРОС подогрева. Как только все калориферы перестали работать
  // (выключены вручную или наступило лето), расчётные температуры узлов
  // возвращаются к фоновым — иначе в свойствах узлов остались бы «зимние»
  // подогретые значения и продолжали бы создавать фантомную естественную тягу.
  const heatersWorking = heaterInfo.info.some(h => h.dt > 0);
  const prevHeatersWorking = useRef(heatersWorking);
  useEffect(() => {
    if (prevHeatersWorking.current && !heatersWorking) {
      setNodes(prev => prev.map(n => {
        const baseT = baseNodeTemps[n.id] ?? surfaceTemp;
        return { ...n, computedAirTemp: baseT, computedWallTemp: baseT };
      }));
      addLog("info", "Калориферы отключены — подогрев снят, температуры узлов сброшены к фоновым");
    }
    prevHeatersWorking.current = heatersWorking;
    // baseNodeTemps намеренно не в зависимостях: сброс нужен строго в момент
    // отключения калориферов, а не при каждом пересчёте фоновых температур.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatersWorking]);

  return { calcHeaterTemps, heaterInfo, heatersWorking };
}
