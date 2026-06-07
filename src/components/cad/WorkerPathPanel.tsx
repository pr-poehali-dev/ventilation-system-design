/**
 * Панель расчёта времени хода горнорабочего по горным выработкам.
 * Методика: РД 15-11-2007 или ФНиП №467.
 */

import React, { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import {
  calcWorkerPath,
  WorkerPathResult,
  WorkerSegment,
  isBulkheadPassable,
} from "@/lib/rescueCalculator";

void isBulkheadPassable;

interface NodeLite {
  id: string;
  name: string;
  number: string;
  x: number;
  y: number;
  z: number;
}

interface BranchLite {
  id: string;
  fromId: string;
  toId: string;
  length: number;
  angle: number;
  area: number;
  name?: string;
  hasBulkhead?: boolean;
  bulkheadId?: string;
  isLeakage?: boolean;
}

export type WorkerPickMode = "start" | "target" | `wp:${number}` | null;

interface Props {
  nodes: NodeLite[];
  branches: BranchLite[];
  pickMode: WorkerPickMode;
  onPickModeChange: (mode: WorkerPickMode) => void;
  onRegisterPickHandler: (fn: (nodeId: string) => void) => void;
  pickedStartId: string;
  pickedTargetId: string;
  onPickedStartChange: (id: string) => void;
  onPickedTargetChange: (id: string) => void;
  onRouteChange: (branchIds: Set<string>, nodeIds: Set<string>, branchDirs: Map<string, boolean>) => void;
}

function numFmt(v: number, decimals = 1) {
  return isFinite(v) ? v.toFixed(decimals) : "—";
}

function exportCsv(result: WorkerPathResult) {
  const rows: string[][] = [];
  const method = result.method === "rd" ? "РД 15-11-2007" : "ФНиП №467";
  rows.push([`Расчёт времени хода горнорабочего (${method})`]);
  rows.push([`Начало: ${result.startNodeId}`, `Цель: ${result.targetNodeId}`]);
  rows.push([`Время туда, мин`, result.totalTimeForward.toFixed(1)]);
  rows.push([`Время обратно, мин`, result.totalTimeBack.toFixed(1)]);
  rows.push([`Общее время, мин`, result.totalTime.toFixed(1)]);
  rows.push([]);
  rows.push(["Выработка", "Сегм.", "Длина, м", "Угол, °", "V, м/мин", "t туда, мин", "t обратно, мин", "Σt туда, мин"]);
  for (const s of result.segments) {
    rows.push([
      s.branchName, String(s.segmentNumber),
      String(Math.round(s.length)), s.angle.toFixed(0),
      String(s.speed_mpm), s.time_min.toFixed(2),
      s.time_back_min.toFixed(2), s.cumulTime.toFixed(2),
    ]);
  }
  rows.push(["ИТОГО", "",
    String(Math.round(result.segments.reduce((a, s) => a + s.length, 0))), "",
    "", result.totalTimeForward.toFixed(2), result.totalTimeBack.toFixed(2), "",
  ]);
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "worker_path.csv"; a.click();
  URL.revokeObjectURL(url);
}

function ResultDialog({ result, onClose }: { result: WorkerPathResult; onClose: () => void }) {
  const method = result.method === "rd" ? "РД 15-11-2007" : "ФНиП №467";
  const totalLen = Math.round(result.segments.reduce((a, s) => a + s.length, 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-lg shadow-2xl flex flex-col" style={{ width: 760, maxHeight: "90vh", minWidth: 420 }}>
        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ background: "#f0f9ff", borderRadius: "8px 8px 0 0" }}>
          <div className="flex items-center gap-2">
            <Icon name="PersonStanding" size={18} style={{ color: "#0369a1" }} />
            <span className="font-semibold text-[13px] text-blue-900">
              Время хода горнорабочего — {method}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="flex flex-col overflow-y-auto flex-1 p-4 gap-4">
          {/* Итоговые метрики */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border rounded p-3" style={{ background: "#f0f9ff" }}>
              <div className="text-[10px] text-gray-500 mb-1 font-medium">ТУДА</div>
              <div className="text-[24px] font-bold text-blue-900">
                {numFmt(result.totalTimeForward, 1)} мин
              </div>
              <div className="text-[10px] text-gray-500">{totalLen} м пути</div>
            </div>
            <div className="border rounded p-3" style={{ background: "#f0fdf4" }}>
              <div className="text-[10px] text-gray-500 mb-1 font-medium">ОБРАТНО</div>
              <div className="text-[24px] font-bold text-green-800">
                {numFmt(result.totalTimeBack, 1)} мин
              </div>
              <div className="text-[10px] text-gray-500">{totalLen} м пути</div>
            </div>
            <div className={`border rounded p-3 ${result.ok ? "bg-green-50" : "bg-red-50"}`}>
              <div className="text-[10px] text-gray-500 mb-1 font-medium">ИТОГО ТУДА + ОБРАТНО</div>
              <div className={`text-[20px] font-bold ${result.ok ? "text-green-800" : "text-red-700"}`}>
                {numFmt(result.totalTime, 1)} мин
              </div>
              <div className={`text-[11px] font-medium mt-0.5 ${result.ok ? "text-green-700" : "text-red-700"}`}>
                {result.ok ? "✓ Маршрут построен" : "✗ Маршрут не найден"}
              </div>
            </div>
          </div>

          {/* Предупреждения */}
          {result.warnings.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded p-2">
              {result.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-red-700">⚠ {w}</div>
              ))}
            </div>
          )}

          {/* Таблица сегментов */}
          <div className="border rounded overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 border-b" style={{ background: "#f8fafc" }}>
              Маршрут по выработкам
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th className="px-2 py-1 text-left font-medium text-gray-600 whitespace-nowrap">№</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-600 whitespace-nowrap">Выработка</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600 whitespace-nowrap">Длина, м</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600 whitespace-nowrap">Угол, °</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600 whitespace-nowrap">V, м/мин</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600 whitespace-nowrap">t туда, мин</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600 whitespace-nowrap">t обр., мин</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600 whitespace-nowrap">Σt, мин</th>
                  </tr>
                </thead>
                <tbody>
                  {result.segments.map((s: WorkerSegment, i: number) => (
                    <tr key={s.branchId + i} style={{ background: i % 2 === 0 ? "white" : "#f8fafc" }}>
                      <td className="px-2 py-0.5 text-gray-400">{s.segmentNumber}</td>
                      <td className="px-2 py-0.5 text-gray-800 max-w-[200px] truncate" title={s.branchName}>
                        {s.branchLabel || s.branchName}
                      </td>
                      <td className="px-2 py-0.5 text-right">{Math.round(s.length)}</td>
                      <td className="px-2 py-0.5 text-right">{s.angle.toFixed(0)}°</td>
                      <td className="px-2 py-0.5 text-right text-blue-700">{s.speed_mpm}</td>
                      <td className="px-2 py-0.5 text-right font-medium">{numFmt(s.time_min, 2)}</td>
                      <td className="px-2 py-0.5 text-right">{numFmt(s.time_back_min, 2)}</td>
                      <td className="px-2 py-0.5 text-right font-semibold text-blue-800">{numFmt(s.cumulTime, 2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#e0f2fe", borderTop: "2px solid #bae6fd" }}>
                    <td className="px-2 py-1 font-bold text-blue-900" colSpan={2}>ИТОГО</td>
                    <td className="px-2 py-1 text-right font-bold text-blue-900">{totalLen}</td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1"></td>
                    <td className="px-2 py-1 text-right font-bold text-blue-900">{numFmt(result.totalTimeForward, 2)}</td>
                    <td className="px-2 py-1 text-right font-bold text-blue-900">{numFmt(result.totalTimeBack, 2)}</td>
                    <td className="px-2 py-1"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Подвал */}
        <div className="px-4 py-2 border-t flex justify-between items-center" style={{ background: "#f8fafc" }}>
          <button
            onClick={() => exportCsv(result)}
            className="flex items-center gap-1.5 px-3 py-1 rounded border text-[11px] hover:bg-gray-100"
            style={{ borderColor: "#d1d5db", color: "#374151" }}
          >
            <Icon name="Download" size={13} />
            Экспорт в CSV
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1 rounded text-[12px] font-medium text-white"
            style={{ background: "#0284c7" }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorkerPathPanel({
  nodes, branches,
  pickMode, onPickModeChange, onRegisterPickHandler,
  pickedStartId, pickedTargetId,
  onPickedStartChange, onPickedTargetChange,
  onRouteChange,
}: Props) {
  const [method, setMethod] = useState<"rd" | "fnip">("rd");
  const [useWaypoints, setUseWaypoints] = useState(false);
  const [waypointIds, setWaypointIds] = useState<string[]>([]);
  const [result, setResult] = useState<WorkerPathResult | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  // Регистрируем обработчик pick-клика
  const pickHandlerRef = React.useRef<(nodeId: string) => void>(() => {});
  pickHandlerRef.current = (nodeId: string) => {
    if (pickMode === "start") {
      onPickedStartChange(nodeId);
      onPickModeChange("target");
    } else if (pickMode === "target") {
      onPickedTargetChange(nodeId);
      onPickModeChange(null);
    } else if (pickMode && String(pickMode).startsWith("wp:")) {
      const idx = Number(String(pickMode).split(":")[1]);
      setWaypointIds(prev => prev.map((v, i) => i === idx ? nodeId : v));
      onPickModeChange(null);
    }
  };
  React.useEffect(() => {
    onRegisterPickHandler((nodeId: string) => pickHandlerRef.current(nodeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodeOptions = useMemo(() => {
    return nodes.map(n => ({
      id: n.id,
      label: n.name ? n.name : n.number ? `Узел ${n.number}` : n.id.slice(0, 8),
    }));
  }, [nodes]);

  const nodeName = (id: string) => {
    const n = nodes.find(n2 => n2.id === id);
    if (!n) return id.slice(0, 8);
    return n.name || (n.number ? `Узел ${n.number}` : id.slice(0, 8));
  };

  const canCalc = pickedStartId && pickedTargetId && pickedStartId !== pickedTargetId;

  const handleCalc = () => {
    if (!canCalc) return;
    const wps = useWaypoints ? waypointIds.filter(Boolean) : [];
    const res = calcWorkerPath(nodes, branches, pickedStartId, pickedTargetId, method, wps);
    setResult(res);
    onRouteChange(
      new Set(res.segments.map(s => s.branchId)),
      new Set([res.startNodeId, res.targetNodeId, ...res.waypointNodeIds,
               ...res.segments.flatMap(s => [s.fromNodeId, s.toNodeId])]),
      res.branchDirs,
    );
    setShowDialog(true);
  };

  const inputStyle: React.CSSProperties = {
    height: 22, fontSize: 11, border: "1px solid #c8c8c8",
    background: "white", outline: "none", paddingLeft: 4, paddingRight: 4,
    width: "100%",
  };

  const btnPickStyle = (active: boolean): React.CSSProperties => ({
    height: 22, fontSize: 10, padding: "0 6px",
    border: `1px solid ${active ? "#2563eb" : "#c8c8c8"}`,
    background: active ? "#dbeafe" : "#f5f5f5",
    color: active ? "#1d4ed8" : "#374151",
    cursor: "pointer", borderRadius: 2, flexShrink: 0, whiteSpace: "nowrap",
  });

  return (
    <div className="flex flex-col h-full" style={{ fontSize: 11 }}>
      <div className="flex-1 overflow-y-auto">
        {/* Методика */}
        <div className="px-2 py-1 border-b" style={{ background: "#f0f9ff", fontSize: 10, color: "#0369a1", fontWeight: 600 }}>
          Расчёт времени хода горнорабочего
        </div>

        <div className="px-2 py-2 flex flex-col gap-2">
          {/* Методика расчёта */}
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">Методика расчёта</div>
            <label className="flex items-center gap-1.5 mb-0.5 cursor-pointer">
              <input type="radio" name="wp_method" checked={method === "rd"} onChange={() => setMethod("rd")}
                style={{ accentColor: "#0284c7" }} />
              <span className="text-[11px]">РД 15-11-2007 (Методические рекомендации)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="wp_method" checked={method === "fnip"} onChange={() => setMethod("fnip")}
                style={{ accentColor: "#0284c7" }} />
              <span className="text-[11px]">ФНиП №467 (Инструкция, угольные шахты)</span>
            </label>
          </div>

          {/* Начальный узел */}
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">Начальный узел</div>
            <div className="flex gap-1">
              <select
                value={pickedStartId}
                onChange={e => onPickedStartChange(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">— выберите узел —</option>
                {nodeOptions.map(n => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
              <button
                style={btnPickStyle(pickMode === "start")}
                onClick={() => onPickModeChange(pickMode === "start" ? null : "start")}
              >
                {pickMode === "start" ? "Отмена" : "На схеме"}
              </button>
            </div>
            {pickedStartId && (
              <div className="text-[10px] text-blue-700 mt-0.5">▶ {nodeName(pickedStartId)}</div>
            )}
          </div>

          {/* Промежуточные узлы */}
          <div>
            <label className="flex items-center gap-1.5 cursor-pointer mb-1">
              <input type="checkbox" checked={useWaypoints} onChange={e => setUseWaypoints(e.target.checked)}
                style={{ accentColor: "#0284c7" }} />
              <span className="text-[11px] font-medium">Промежуточные узлы</span>
            </label>
            {useWaypoints && (
              <div className="flex flex-col gap-1">
                {waypointIds.map((wpId, idx) => (
                  <div key={idx} className="flex gap-1 items-center">
                    <span className="text-[10px] text-gray-400 w-3">{idx + 1}</span>
                    <select
                      value={wpId}
                      onChange={e => setWaypointIds(prev => prev.map((v, i) => i === idx ? e.target.value : v))}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      <option value="">— узел —</option>
                      {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                    </select>
                    <button
                      style={btnPickStyle(pickMode === `wp:${idx}`)}
                      onClick={() => onPickModeChange(pickMode === `wp:${idx}` ? null : `wp:${idx}` as `wp:${number}`)}
                    >
                      На схеме
                    </button>
                    <button
                      onClick={() => setWaypointIds(prev => prev.filter((_, i) => i !== idx))}
                      style={{ ...btnPickStyle(false), color: "#dc2626", borderColor: "#fca5a5" }}
                    >×</button>
                  </div>
                ))}
                <button
                  onClick={() => setWaypointIds(prev => [...prev, ""])}
                  className="text-[11px] text-blue-600 hover:text-blue-800 text-left"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
                >+ Добавить узел</button>
              </div>
            )}
          </div>

          {/* Целевой узел */}
          <div>
            <div className="text-[10px] text-gray-500 font-medium mb-1">Целевой узел</div>
            <div className="flex gap-1">
              <select
                value={pickedTargetId}
                onChange={e => onPickedTargetChange(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="">— выберите узел —</option>
                {nodeOptions.map(n => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
              <button
                style={btnPickStyle(pickMode === "target")}
                onClick={() => onPickModeChange(pickMode === "target" ? null : "target")}
              >
                {pickMode === "target" ? "Отмена" : "На схеме"}
              </button>
            </div>
            {pickedTargetId && (
              <div className="text-[10px] text-blue-700 mt-0.5">▶ {nodeName(pickedTargetId)}</div>
            )}
          </div>

          {/* Кнопка расчёта */}
          <button
            onClick={handleCalc}
            disabled={!canCalc}
            className="w-full py-1.5 rounded text-[12px] font-semibold text-white mt-1 disabled:opacity-40"
            style={{ background: "#0284c7", border: "none", cursor: canCalc ? "pointer" : "default" }}
          >
            <Icon name="Timer" size={13} style={{ display: "inline", marginRight: 5, verticalAlign: "middle" }} />
            Вычислить время хода
          </button>

          {/* Результат (краткий) */}
          {result && result.segments.length > 0 && (
            <div className="border rounded p-2 mt-1" style={{ background: "#f0f9ff" }}>
              <div className="text-[10px] text-gray-500 font-medium mb-1">Результат расчёта</div>
              <div className="flex gap-3">
                <div>
                  <div className="text-[10px] text-gray-500">Туда</div>
                  <div className="text-[16px] font-bold text-blue-900">{numFmt(result.totalTimeForward)} мин</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500">Обратно</div>
                  <div className="text-[16px] font-bold text-green-800">{numFmt(result.totalTimeBack)} мин</div>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500">Итого</div>
                  <div className="text-[16px] font-bold text-gray-800">{numFmt(result.totalTime)} мин</div>
                </div>
              </div>
              <button
                onClick={() => setShowDialog(true)}
                className="mt-1.5 text-[11px] text-blue-700 underline"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                Показать детали →
              </button>
            </div>
          )}

          {/* Справочник скоростей */}
          <details className="border rounded mt-1">
            <summary className="px-2 py-1 text-[10px] text-gray-500 cursor-pointer select-none font-medium">
              Нормативные скорости движения горнорабочего
            </summary>
            <div className="px-2 pb-2">
              <table className="w-full text-[10px] mt-1">
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th className="px-1 py-0.5 text-left text-gray-600">Угол наклона</th>
                    <th className="px-1 py-0.5 text-right text-gray-600">РД 15-11-2007, м/мин</th>
                    <th className="px-1 py-0.5 text-right text-gray-600">ФНиП №467, м/мин</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["0–5°", 100, 110],
                    ["5–10°", 80, 88],
                    ["10–15°", 65, 70],
                    ["15–20°", 55, 58],
                    ["20–30°", 40, 43],
                    ["30–45°", 28, 30],
                    [">45°", 22, 24],
                  ].map(([label, rd, fnip], i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8fafc" }}>
                      <td className="px-1 py-0.5 text-gray-700">{label}</td>
                      <td className={`px-1 py-0.5 text-right font-medium ${method === "rd" ? "text-blue-700" : "text-gray-500"}`}>{rd}</td>
                      <td className={`px-1 py-0.5 text-right font-medium ${method === "fnip" ? "text-blue-700" : "text-gray-500"}`}>{fnip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </div>

      {showDialog && result && (
        <ResultDialog result={result} onClose={() => setShowDialog(false)} />
      )}
    </div>
  );
}
