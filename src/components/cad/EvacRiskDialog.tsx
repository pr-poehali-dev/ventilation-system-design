import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import {
  calcEvacuationRisk, DEFAULT_EVAC_OPTIONS,
  type EvacRiskRow, type EvacRiskLevel,
} from "@/lib/evacuationRisk";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  projectName?: string;
  onHighlightNode?: (nodeId: string) => void;
  onClose: () => void;
}

// Цвета по категории риска
const LEVEL_COLOR: Record<EvacRiskLevel, string> = {
  "safe":         "#15803d",
  "tight":        "#a16207",
  "needs-switch": "#c2410c",
  "critical":     "#b91c1c",
  "no-route":     "#7c2d12",
};

const LEVEL_BG: Record<EvacRiskLevel, string | undefined> = {
  "safe":         undefined,
  "tight":        "#fffbeb",
  "needs-switch": "#fff7ed",
  "critical":     "#fff1f1",
  "no-route":     "#fef2f2",
};

export default function EvacRiskDialog({
  branches, nodes, onHighlightNode, onClose,
}: Props) {
  const [rescuerTime, setRescuerTime] = useState(String(DEFAULT_EVAC_OPTIONS.defaultRescuerTime));
  const [safetyFactor, setSafetyFactor] = useState(String(DEFAULT_EVAC_OPTIONS.safetyFactor));
  const [method, setMethod] = useState<"rd" | "fnip">(DEFAULT_EVAC_OPTIONS.method);
  const [useSwitchPoints, setUseSwitchPoints] = useState(DEFAULT_EVAC_OPTIONS.useSwitchPoints);

  const num = (s: string, d: number) => {
    const v = parseFloat(s.replace(",", "."));
    return Number.isFinite(v) ? v : d;
  };

  const result = useMemo(() => calcEvacuationRisk(nodes, branches, {
    defaultRescuerTime: num(rescuerTime, DEFAULT_EVAC_OPTIONS.defaultRescuerTime),
    safetyFactor: Math.min(1, Math.max(0.1, num(safetyFactor, DEFAULT_EVAC_OPTIONS.safetyFactor))),
    method,
    useSwitchPoints,
  }), [nodes, branches, rescuerTime, safetyFactor, method, useSwitchPoints]);

  const numInput = (value: string, set: (v: string) => void) => (
    <input value={value} onChange={e => set(e.target.value)}
      className="text-[12px] border border-gray-300 rounded px-2 py-1 w-20 text-right" />
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-12"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 1080, maxHeight: "88vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">
            Зона поражения: вывод людей при пожаре
          </span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {result.error && (
          <div className="px-4 py-2.5 text-[11px] flex items-start gap-2"
            style={{ background: "#fff4e5", borderBottom: "1px solid #f0d9b5", color: "#8a5a00" }}>
            <Icon name="TriangleAlert" size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              {result.error}
              <div className="text-[10px] pt-1" style={{ color: "#a06a00" }}>
                Выберите узел на схеме, откройте вкладку «Аварии» и укажите назначение:
                рабочее место с численностью людей, камера-убежище, ПВП или выход на поверхность.
              </div>
            </div>
          </div>
        )}

        {/* Параметры расчёта */}
        <div className="px-4 pt-3 pb-2.5" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Параметры расчёта
          </div>
          <div className="grid grid-cols-3 gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Самоспасатель, мин</span>
              {numInput(rescuerTime, setRescuerTime)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Коэффициент запаса</span>
              {numInput(safetyFactor, setSafetyFactor)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Скорости по</span>
              <select value={method} onChange={e => setMethod(e.target.value as "rd" | "fnip")}
                className="text-[12px] border border-gray-300 rounded px-2 py-1">
                <option value="rd">РД 15-11-2007</option>
                <option value="fnip">ФНиП</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none pt-2">
            <input type="checkbox" checked={useSwitchPoints}
              onChange={e => setUseSwitchPoints(e.target.checked)} />
            Учитывать пункты переключения и камеры-убежища
          </label>
          <div className="text-[10px] text-gray-400 leading-snug pt-1.5">
            Коэффициент запаса учитывает, что паспортное время самоспасателя достигается
            в идеальных условиях — при подъёме и нагрузке ресурс расходуется быстрее.
            Для каждого места ищется ближайший по ВРЕМЕНИ выход, а не по расстоянию.
          </div>
        </div>

        {/* Сводка */}
        {!result.error && (
          <div className="px-4 py-2 flex items-center gap-5 text-[11px] flex-wrap"
            style={{ background: "#f6f8fc", borderBottom: "1px solid #e0e4ee" }}>
            <span className="text-gray-600">
              Людей в смену: <b>{result.totalPeople}</b> на {result.totalWorkplaces} местах
            </span>
            {result.peopleInSmoke > 0 && (
              <span style={{ color: "#c2410c" }}>В зоне задымления: <b>{result.peopleInSmoke}</b></span>
            )}
            {result.peopleNeedSwitch > 0 && (
              <span style={{ color: "#c2410c" }}>Нужно переключение: <b>{result.peopleNeedSwitch}</b></span>
            )}
            {result.peopleAtRisk > 0
              ? <span className="text-red-600 font-semibold">Не успевают выйти: {result.peopleAtRisk}</span>
              : <span className="text-green-700">Все успевают выйти</span>}
          </div>
        )}

        {/* Таблица */}
        <div className="flex-1 overflow-auto">
          {result.rows.length > 0 ? (
            <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
              <thead className="sticky top-0" style={{ background: "#eef2f9", zIndex: 1 }}>
                <tr className="text-gray-600">
                  {["№", "Рабочее место", "Людей", "Выход", "Путь, м", "Выход, мин",
                    "Защита, мин", "Запас, мин", "Дым", "ПВП", "Результат"].map(h => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap"
                      style={{ borderBottom: "1px solid #ccd6e6" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r: EvacRiskRow) => (
                  <tr key={r.nodeId}
                    onClick={() => onHighlightNode?.(r.nodeId)}
                    className={onHighlightNode ? "cursor-pointer hover:bg-blue-50" : ""}
                    style={{ background: LEVEL_BG[r.level] }}
                    title={r.recommendation || undefined}>
                    <td className="px-2 py-1 text-gray-400" style={{ borderBottom: "1px solid #eef1f6" }}>{r.index}</td>
                    <td className="px-2 py-1" style={{ borderBottom: "1px solid #eef1f6", maxWidth: 200 }}>
                      <div className="truncate font-medium">
                        {r.description || r.nodeName || `№ ${r.nodeNumber}`}
                      </div>
                      {r.shift && <div className="text-[10px] text-gray-400 truncate">{r.shift}</div>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold"
                      style={{ borderBottom: "1px solid #eef1f6" }}>
                      {r.peopleCount}
                    </td>
                    <td className="px-2 py-1 text-gray-600" style={{ borderBottom: "1px solid #eef1f6", maxWidth: 130 }}>
                      <div className="truncate">{r.exitName}</div>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500" style={{ borderBottom: "1px solid #eef1f6" }}>
                      {r.routeLength > 0 ? r.routeLength : "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums" style={{ borderBottom: "1px solid #eef1f6" }}>
                      {r.evacTime > 0 ? r.evacTime.toFixed(0) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500"
                      style={{ borderBottom: "1px solid #eef1f6" }}
                      title={r.rescuerModel}>
                      {r.rescuerTime.toFixed(0)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold"
                      style={{ borderBottom: "1px solid #eef1f6",
                        color: r.timeMargin < 0 ? "#dc2626" : r.timeMargin < r.rescuerTime * 0.2 ? "#a16207" : "#15803d" }}>
                      {r.evacTime > 0 ? (r.timeMargin > 0 ? `+${r.timeMargin.toFixed(0)}` : r.timeMargin.toFixed(0)) : "—"}
                    </td>
                    <td className="px-2 py-1 text-center" style={{ borderBottom: "1px solid #eef1f6" }}>
                      {(r.inSmokeZone || r.routeThroughSmoke)
                        ? <span style={{ color: "#dc2626", fontWeight: 700 }}
                            title={r.inSmokeZone ? "Рабочее место в дыму" : "Путь выхода через дым"}>
                            {r.inSmokeZone ? "место" : "путь"}
                          </span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-2 py-1 text-gray-600" style={{ borderBottom: "1px solid #eef1f6", maxWidth: 120 }}>
                      <div className="truncate">{r.switchPointName}</div>
                      {r.switchPointTime > 0 && (
                        <div className="text-[10px] text-gray-400">{r.switchPointTime.toFixed(0)} мин</div>
                      )}
                    </td>
                    <td className="px-2 py-1" style={{ borderBottom: "1px solid #eef1f6", maxWidth: 250 }}>
                      <span style={{ color: LEVEL_COLOR[r.level], fontWeight: r.level === "safe" ? 400 : 600 }}>
                        {r.verdict}
                      </span>
                      {r.recommendation && (
                        <div className="text-[10px] text-gray-500 truncate">{r.recommendation}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[12px] text-gray-500 text-center py-8">
              {result.error
                ? "Расчёт невозможен — устраните замечание выше."
                : "Рабочих мест с людьми не найдено."}
            </div>
          )}
        </div>

        {/* Подвал */}
        <div className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: "#f2f5fb", borderTop: "1px solid #d8e0ee" }}>
          <span className="text-[10px] text-gray-400">
            Время выхода — по маршруту через выработки с учётом уклонов и задымления
          </span>
          <button onClick={onClose}
            className="text-[12px] px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
