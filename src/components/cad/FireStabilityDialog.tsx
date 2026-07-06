import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { Position } from "@/lib/positions";
import { calcFireStability, type StabilityCategory } from "@/lib/fireStability";
import { exportStabilityAct } from "@/lib/stabilityActExport";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  positions?: Position[];
  projectName?: string;
  solved: boolean;   // выполнен ли расчёт сети
  onClose: () => void;
}

const CATEGORY_LABELS: Record<StabilityCategory, string> = {
  "descending-incline":  "Наклонные · нисходящее проветривание",
  "descending-vertical": "Вертикальные · нисходящее проветривание",
  "ascending-incline":   "Наклонные · восходящее проветривание",
  "ascending-vertical":  "Вертикальные · восходящее проветривание",
};

const CATEGORY_ORDER: StabilityCategory[] = [
  "descending-incline", "descending-vertical", "ascending-incline", "ascending-vertical",
];

export default function FireStabilityDialog({
  branches, nodes, positions = [], projectName = "Подземный рудник", solved, onClose,
}: Props) {
  const [angleFilter, setAngleFilter]   = useState("5");
  const [lengthFilter, setLengthFilter] = useState("30");
  const [ambientTemp, setAmbientTemp]   = useState("20");

  const result = useMemo(() => {
    const angle  = parseFloat(angleFilter.replace(",", ".")) || 0;
    const length = parseFloat(lengthFilter.replace(",", ".")) || 0;
    const amb    = parseFloat(ambientTemp.replace(",", ".")) || 20;
    return calcFireStability(branches, nodes, {
      angleFilter: angle,
      lengthFilter: length,
      ambientTemp: amb,
      positions: positions.map(p => ({ branchIds: p.branchIds, number: p.number, name: p.name })),
    });
  }, [branches, nodes, positions, angleFilter, lengthFilter, ambientTemp]);

  const total = result.rows.length;

  function handleExport() {
    exportStabilityAct(result, { projectName });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 560, maxHeight: "82vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">
            Устойчивость вентиляционных режимов при пожаре
          </span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {!solved && (
          <div className="px-4 py-2 text-[11px] flex items-center gap-2"
            style={{ background: "#fff4e5", borderBottom: "1px solid #f0d9b5", color: "#8a5a00" }}>
            <Icon name="TriangleAlert" size={14} />
            Сначала выполните «Расчёт сети» — иначе расходы и депрессии будут нулевыми.
          </div>
        )}

        {/* Параметры отбора */}
        <div className="px-4 pt-3 pb-2 space-y-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Условия отбора ветвей</div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Угол наклона не менее, град</span>
            <input value={angleFilter} onChange={e => setAngleFilter(e.target.value)}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Длина выработки не менее, м</span>
            <input value={lengthFilter} onChange={e => setLengthFilter(e.target.value)}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 flex-1">Температура воздуха, °C</span>
            <input value={ambientTemp} onChange={e => setAmbientTemp(e.target.value)}
              className="text-[12px] border border-gray-300 rounded px-2 py-1 w-24 text-right" />
          </div>
          <div className="text-[10px] text-gray-400 leading-snug pt-0.5">
            Отбираются ветви с заданной пожарной нагрузкой. Направление (нисходящее/восходящее)
            определяется по фактическому потоку воздуха после расчёта сети.
          </div>
        </div>

        {/* Сводка по категориям */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {CATEGORY_ORDER.map(cat => {
            const rows = result.byCategory[cat];
            const unstable = rows.filter(r => !r.stable).length;
            return (
              <div key={cat} className="border border-gray-200 rounded overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5"
                  style={{ background: "#f6f8fc" }}>
                  <span className="text-[12px] font-medium text-gray-700">{CATEGORY_LABELS[cat]}</span>
                  <span className="text-[11px] text-gray-500">{rows.length} ветв.</span>
                </div>
                {rows.length > 0 && (
                  <div className="px-3 py-1.5 text-[11px] flex items-center gap-4">
                    <span className="text-green-700">Устойчиво: {rows.length - unstable}</span>
                    {unstable > 0
                      ? <span className="text-red-600 font-semibold">Неустойчиво: {unstable}</span>
                      : <span className="text-gray-400">Неустойчиво: 0</span>}
                  </div>
                )}
              </div>
            );
          })}

          {total === 0 && (
            <div className="text-[12px] text-gray-500 text-center py-4">
              Нет ветвей, удовлетворяющих условиям отбора.
              Проверьте, что задана пожарная нагрузка и выполнен расчёт сети.
            </div>
          )}
        </div>

        {/* Итог + действия */}
        <div className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: "#f2f5fb", borderTop: "1px solid #d8e0ee" }}>
          <div className="text-[11px] text-gray-600">
            Всего в акте: <b>{total}</b> ветв.
            {result.totalUnstable > 0 && (
              <span className="text-red-600 font-semibold ml-2">
                Неустойчивых: {result.totalUnstable}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button onClick={handleExport} disabled={total === 0}
              className="text-[12px] px-3 py-1.5 rounded text-white flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "#2563eb" }}>
              <Icon name="FileSpreadsheet" size={14} />
              Сформировать акт (Excel)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
