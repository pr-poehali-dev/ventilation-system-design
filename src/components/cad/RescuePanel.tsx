import React, { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import {
  calcRescue,
  RescueParams,
  RescueOperationType,
  RescueResult,
  RescueSegment,
} from "@/lib/rescueCalculator";
import { API_URLS } from "@/lib/api-urls";

const RESCUE_URL = API_URLS.rescueCalculator;

interface NodeLite { id: string; name: string; number: string; x: number; y: number; z: number; }
interface BranchLite {
  id: string; fromId: string; toId: string;
  number?: string;  // номер ветви из схемы
  type?: string;    // тип/название выработки из схемы
  length: number; angle: number; area: number;
  name?: string;
  fireComputedSmokeDens?: number;
  fireComputedCO?: number;
  flow?: number;
  hasBulkhead?: boolean;
  bulkheadId?: string;
  bulkheadName?: string;
  bulkheadR?: number;
  isLeakage?: boolean;
  resistance?: number;
}

/** null = выкл, "start" = выбор старта, "target" = выбор цели, "wp:N" = выбор вайпоинта #N */
export type RescuePickMode = "start" | "target" | `wp:${number}` | null;

interface Props {
  nodes: NodeLite[];
  branches: BranchLite[];
  fireCalcDone: boolean;
  // Pick-mode: выбор узла кликом на схеме
  pickMode: RescuePickMode;
  onPickModeChange: (mode: RescuePickMode) => void;
  /** Регистрирует обработчик pick-клика: Cad.tsx запоминает fn и вызывает её при клике */
  onRegisterPickHandler: (fn: (nodeId: string) => void) => void;
  pickedStartId: string;
  pickedTargetId: string;
  onPickedStartChange: (id: string) => void;
  onPickedTargetChange: (id: string) => void;
  // Маршрут для подсветки на схеме
  onRouteChange: (branchIds: Set<string>, nodeIds: Set<string>, branchDirs: Map<string, boolean>) => void;
  /** Актуальный список выбранных промежуточных узлов (для подписи «В» на схеме) */
  onWaypointsChange?: (waypointIds: string[]) => void;
}

const OP_LABELS: Record<RescueOperationType, string> = {
  scout_and_transport: "Разведка туда, транспортировка обратно",
  scout: "Разведка",
  transport: "Транспортировка пострадавшего",
  liquidation: "Ликвидация аварии",
};

function ZoneBadge({ zone }: { zone: "clean" | "smoky_low" | "smoky_high" }) {
  if (zone === "clean")      return <span className="text-green-700 font-medium">Чистая</span>;
  if (zone === "smoky_low")  return <span className="text-orange-600 font-medium">Средн. 5-10 м</span>;
  return <span className="text-red-700 font-medium">Сильн. &lt;5 м</span>;
}

function MetricRow({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="flex justify-between items-baseline py-0.5 border-b border-gray-100 last:border-0">
      <span className="text-[11px] text-gray-600">{label}</span>
      <span className={`text-[12px] font-semibold ${warn ? "text-red-600" : "text-gray-900"}`}>
        {value} {sub && <span className="text-[10px] font-normal text-gray-500">{sub}</span>}
      </span>
    </div>
  );
}

// Мини-график времени/кислорода
function ChartTab({
  segments, segmentsBack, type, careTime, showBack
}: {
  segments: RescueSegment[];
  segmentsBack: RescueSegment[];
  type: "time" | "oxygen";
  careTime: number;
  showBack: boolean;
}) {
  const W = 320; const H = 120; const PAD = 30;
  const fw = W - PAD * 2; const fh = H - PAD * 1.5;

  const fwdPoints = segments.map(s => ({
    x: s.cumulTime,
    y: type === "time" ? s.cumulTime : s.cumulO2,
  }));
  const lastFwd = fwdPoints[fwdPoints.length - 1];
  const bwdPoints = showBack ? segmentsBack.map(s => ({
    x: (lastFwd?.x ?? 0) + careTime + s.cumulTime,
    y: type === "time"
      ? (lastFwd?.y ?? 0) + careTime + s.cumulTime
      : (lastFwd?.y ?? 0) + careTime * 1.4 + s.cumulO2,
  })) : [];

  const allPts = [{ x: 0, y: 0 }, ...fwdPoints, ...bwdPoints];
  const maxX = Math.max(...allPts.map(p => p.x), 1);
  const maxY = Math.max(...allPts.map(p => p.y), 1);

  const toSvg = (p: { x: number; y: number }) => ({
    sx: PAD + (p.x / maxX) * fw,
    sy: PAD + fh - (p.y / maxY) * fh,
  });

  const fwdPts = [{ sx: PAD, sy: PAD + fh }, ...fwdPoints.map(toSvg)];
  const bwdPts = showBack
    ? [(fwdPoints.length > 0 ? toSvg(fwdPoints[fwdPoints.length - 1]) : { sx: PAD, sy: PAD + fh }), ...bwdPoints.map(toSvg)]
    : [];

  const poly = (arr: Array<{ sx: number; sy: number }>) =>
    arr.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" ");

  const ticksX = 5;
  const ticksY = 4;

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {/* Grid */}
      {Array.from({ length: ticksY + 1 }).map((_, i) => {
        const y = PAD + fh - (i / ticksY) * fh;
        const val = ((i / ticksY) * maxY).toFixed(0);
        return (
          <g key={i}>
            <line x1={PAD} y1={y} x2={PAD + fw} y2={y} stroke="#e5e7eb" strokeWidth={0.5} />
            <text x={PAD - 3} y={y + 3} fontSize={8} textAnchor="end" fill="#9ca3af">{val}</text>
          </g>
        );
      })}
      {Array.from({ length: ticksX + 1 }).map((_, i) => {
        const x = PAD + (i / ticksX) * fw;
        const val = ((i / ticksX) * maxX).toFixed(0);
        return (
          <g key={i}>
            <line x1={x} y1={PAD} x2={x} y2={PAD + fh} stroke="#e5e7eb" strokeWidth={0.5} />
            <text x={x} y={PAD + fh + 10} fontSize={8} textAnchor="middle" fill="#9ca3af">{val}</text>
          </g>
        );
      })}
      {/* Axes */}
      <line x1={PAD} y1={PAD} x2={PAD} y2={PAD + fh} stroke="#6b7280" strokeWidth={1} />
      <line x1={PAD} y1={PAD + fh} x2={PAD + fw} y2={PAD + fh} stroke="#6b7280" strokeWidth={1} />

      {/* Линия туда — красная */}
      <polyline points={poly(fwdPts)} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      {/* Линия обратно — серая (только если есть обратный путь) */}
      {showBack && bwdPts.length > 1 && (
        <polyline points={poly(bwdPts)} fill="none" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 2" />
      )}

      {/* Оси подписи */}
      <text x={PAD - 25} y={PAD + fh / 2} fontSize={8} fill="#6b7280"
        textAnchor="middle" transform={`rotate(-90 ${PAD - 25} ${PAD + fh / 2})`}>
        {type === "time" ? "Время, мин" : "Кислород, л"}
      </text>
      <text x={PAD + fw / 2} y={H - 2} fontSize={8} fill="#6b7280" textAnchor="middle">
        Длина, м (условная)
      </text>
    </svg>
  );
}

// Таблица сегментов
function SegmentsTable({ segments, title }: { segments: RescueSegment[]; title: string }) {
  if (segments.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold text-gray-700 mb-1">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th className="border border-gray-200 px-1 py-0.5 text-left font-medium">Выработка</th>
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium">Ветвь №</th>
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium">Сег.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium">От узла</th>
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium">До узла</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium">Длина, м</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium">Угол, °</th>
              {/* Фактическая зона */}
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium" style={{ background: "#f0fdf4" }}>Зона</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>V, м/мин</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>t, мин</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>O₂, л</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>Σt, мин</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>ΣO₂, л</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>O₂/100м</th>
              {/* Слабая задымлённость k3=1 */}
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#dcfce7", color: "#166534" }}>t слаб.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#dcfce7", color: "#166534" }}>O₂ слаб.</th>
              {/* Средняя задымлённость k3=1,43 */}
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fff7ed", color: "#c2410c" }}>t сред.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fff7ed", color: "#c2410c" }}>O₂ сред.</th>
              {/* Сильная задымлённость k3=2 */}
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fef2f2", color: "#b91c1c" }}>t сильн.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fef2f2", color: "#b91c1c" }}>O₂ сильн.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-left font-medium" style={{ background: "#f8fafc", color: "#475569" }}>Комментарий</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                <td className="border border-gray-200 px-1 py-0.5 max-w-[110px] truncate" title={s.branchName}>
                  {s.branchLabel || s.branchName}
                </td>
                <td className="border border-gray-200 px-1 py-0.5 text-center text-gray-400 font-mono text-[9px]">{s.branchNumber}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-center">{s.segmentNumber}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-center text-gray-500">{s.fromNodeId}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-center text-gray-500">{s.toNodeId}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right">{Math.round(s.length)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right">{s.angle.toFixed(0)}°</td>
                <td className="border border-gray-200 px-1 py-0.5 text-center" style={{ background: "#f0fdf4" }}>
                  <ZoneBadge zone={s.zone} />
                </td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.speed_mpm.toFixed(2)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.time_min.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.o2_liters.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>{s.cumulTime.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>{s.cumulO2.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.o2_per_100m.toFixed(2)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#dcfce7" }}>{s.time_clean.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#dcfce7" }}>{s.o2_clean.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fff7ed" }}>{s.time_smoky_low.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fff7ed" }}>{s.o2_smoky_low.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fef2f2" }}>{s.time_smoky_high.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fef2f2" }}>{s.o2_smoky_high.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-left text-gray-500" style={{ background: "#f8fafc" }}>
                  {s.angle > 0 ? "вверх" : s.angle < 0 ? "вниз" : "горизонт."}
                  {s.zone !== "clean" ? ` в дыму` : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#eff6ff" }}>
              <td colSpan={9} className="border border-gray-200 px-1 py-0.5 font-semibold text-right">Итого:</td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold">
                {segments.reduce((s, seg) => s + seg.time_min, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold">
                {segments.reduce((s, seg) => s + seg.o2_liters, 0).toFixed(1)}
              </td>
              <td colSpan={3} />
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold" style={{ background: "#dcfce7" }}>
                {segments.reduce((s, seg) => s + seg.time_clean, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold" style={{ background: "#dcfce7" }}>
                {segments.reduce((s, seg) => s + seg.o2_clean, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold" style={{ background: "#fff7ed" }}>
                {segments.reduce((s, seg) => s + seg.time_smoky_low, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold" style={{ background: "#fff7ed" }}>
                {segments.reduce((s, seg) => s + seg.o2_smoky_low, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold" style={{ background: "#fef2f2" }}>
                {segments.reduce((s, seg) => s + seg.time_smoky_high, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold" style={{ background: "#fef2f2" }}>
                {segments.reduce((s, seg) => s + seg.o2_smoky_high, 0).toFixed(1)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// Диалог результатов
function RescueResultDialog({
  result,
  onClose,
}: {
  result: RescueResult;
  onClose: () => void;
}) {
  const [chartTab, setChartTab] = useState<"time" | "oxygen">("time");
  const [tableTab, setTableTab] = useState<"forward" | "back">("forward");
  const hasBack = result.operationType !== "scout" && result.operationType !== "liquidation";

  // ── Перемещаемое окно (drag за заголовок) ──
  const DIALOG_W = 700;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(8, (window.innerWidth - DIALOG_W) / 2),
    y: 80,
  }));
  const dragRef = React.useRef<{ dx: number; dy: number } | null>(null);
  const onDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const x = Math.min(window.innerWidth - 60, Math.max(0, ev.clientX - dragRef.current.dx));
      const y = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - dragRef.current.dy));
      setPos({ x, y });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="fixed z-50" style={{ left: pos.x, top: pos.y }}>
      <div
        className="bg-white rounded shadow-2xl flex flex-col border border-gray-300"
        style={{ width: DIALOG_W, maxHeight: "85vh", overflow: "hidden" }}
      >
        {/* Заголовок — область перетаскивания */}
        <div onMouseDown={onDragStart}
          className="flex items-center justify-between px-4 py-2 border-b select-none"
          style={{ background: "#1e40af", color: "white", cursor: "move" }}>
          <div className="flex items-center gap-2">
            <Icon name="Move" size={13} style={{ color: "#93c5fd" }} />
            <Icon name="ShieldCheck" size={16} />
            <span className="text-[13px] font-semibold">
              График времени движения горноспасателей — {OP_LABELS[result.operationType]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-lg leading-none px-1">✕</button>
          </div>
        </div>

        {/* Тело */}
        <div className="flex flex-col overflow-y-auto flex-1 p-4 gap-4">
          {/* Итоговые метрики */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border rounded p-2">
              <div className="text-[10px] text-gray-500 mb-1 font-medium">ВРЕМЯ ХОДА</div>
              <div className={`text-[22px] font-bold ${result.ok ? "text-gray-900" : "text-red-600"}`}>
                {result.totalTime.toFixed(1)} мин
              </div>
              {result.timeIdaPercent > 0 && (
                <div className="text-[10px] text-gray-500">
                  {result.timeIdaPercent.toFixed(1)} мин из {Math.round(result.totalTime / result.timeIdaPercent * 100)} мин ({result.timeIdaPercent.toFixed(2)}%)
                  <br />В зоне задымления
                </div>
              )}
            </div>
            <div className="border rounded p-2">
              <div className="text-[10px] text-gray-500 mb-1 font-medium">ЗАТРАТЫ КИСЛОРОДА</div>
              <div className={`text-[22px] font-bold ${result.o2IdaPercent > 100 ? "text-red-600" : "text-gray-900"}`}>
                {result.totalO2.toFixed(1)} л
              </div>
              <div className="text-[10px] text-gray-500">
                {result.totalO2.toFixed(1)} л из {Math.round(result.totalO2 / (result.o2IdaPercent / 100))} л ({result.o2IdaPercent.toFixed(2)}%)
                <br />В зоне задымления
              </div>
            </div>
            <div className={`border rounded p-2 ${result.ok ? "bg-green-50" : "bg-red-50"}`}>
              <div className="text-[10px] text-gray-500 mb-1 font-medium">СТАТУС</div>
              <div className={`text-[14px] font-bold ${result.ok ? "text-green-700" : "text-red-700"}`}>
                {result.ok ? "✓ Выполнимо" : "✗ Превышение ресурса"}
              </div>
              <MetricRow label="Туда" value={`${result.totalTimeForward.toFixed(1)} мин`} />
              {hasBack && <MetricRow label="Помощь" value={`${result.careTime.toFixed(1)} мин`} />}
              {hasBack && <MetricRow label="Обратно" value={`${result.totalTimeBack.toFixed(1)} мин`} />}
            </div>
          </div>

          {/* Расчёты по зонам задымления */}
          <div className="border rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ background: "#f3f4f6" }}>
                  <th className="px-2 py-1 text-left font-medium text-gray-600">Зона задымления</th>
                  <th className="px-2 py-1 text-right font-medium text-gray-600">Время, мин</th>
                  <th className="px-2 py-1 text-right font-medium text-gray-600">O₂, л</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "#f0fdf4" }}>
                  <td className="px-2 py-1 text-green-800 font-medium">Фактическое (расчёт пожара)</td>
                  <td className="px-2 py-1 text-right font-semibold">{result.totalTime.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right font-semibold">{result.totalO2.toFixed(1)}</td>
                </tr>
                <tr style={{ background: "#f0fdf4" }}>
                  <td className="px-2 py-1 text-green-700">Слабая задымлённость k3=1 (Рв &gt; 10 м)</td>
                  <td className="px-2 py-1 text-right">{result.totalTime_clean.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{result.totalO2_clean.toFixed(1)}</td>
                </tr>
                <tr style={{ background: "#fff7ed" }}>
                  <td className="px-2 py-1 text-orange-700">Средняя задымлённость k3=1,43 (Рв 5–10 м)</td>
                  <td className="px-2 py-1 text-right">{result.totalTime_smoky_low.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{result.totalO2_smoky_low.toFixed(1)}</td>
                </tr>
                <tr style={{ background: "#fef2f2" }}>
                  <td className="px-2 py-1 text-red-700">Сильная задымлённость k3=2 (Рв &lt; 5 м)</td>
                  <td className="px-2 py-1 text-right">{result.totalTime_smoky_high.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{result.totalO2_smoky_high.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Предупреждения */}
          {result.warnings.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded p-2">
              {result.warnings.map((w, i) => (
                <div key={i} className="text-[11px] text-red-700">⚠ {w}</div>
              ))}
            </div>
          )}

          {/* График */}
          <div className="border rounded p-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-medium text-gray-700">График:</span>
              {(["time", "oxygen"] as const).map(t => (
                <button key={t}
                  onClick={() => setChartTab(t)}
                  className={`text-[11px] px-2 py-0.5 rounded border ${chartTab === t ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300"}`}>
                  {t === "time" ? "Время" : "Кислород"}
                </button>
              ))}
            </div>
            <div className="flex justify-center">
              <ChartTab
                segments={result.segments}
                segmentsBack={result.segmentsBack}
                type={chartTab}
                careTime={result.careTime}
                showBack={hasBack}
              />
            </div>
            <div className="flex gap-4 justify-center mt-1">
              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#dc2626" strokeWidth={2} /></svg>
                Туда
              </div>
              {hasBack && (
                <div className="flex items-center gap-1 text-[10px] text-gray-600">
                  <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#6b7280" strokeWidth={2} strokeDasharray="4 2" /></svg>
                  Обратно
                </div>
              )}
            </div>
          </div>

          {/* Таблица сегментов */}
          <div>
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => setTableTab("forward")}
                className={`text-[11px] px-2 py-0.5 rounded border ${tableTab === "forward" ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300"}`}>
                {`Туда (${result.segments.length} уч.)`}
              </button>
              {hasBack && (
                <button
                  onClick={() => setTableTab("back")}
                  className={`text-[11px] px-2 py-0.5 rounded border ${tableTab === "back" ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300"}`}>
                  {`Обратно (${result.segmentsBack.length} уч.)`}
                </button>
              )}
            </div>
            {tableTab === "forward"
              ? <SegmentsTable segments={result.segments} title="Маршрут туда" />
              : hasBack
                ? <SegmentsTable segments={result.segmentsBack} title="Маршрут обратно" />
                : null
            }
          </div>
        </div>

        {/* Футер */}
        <div className="flex justify-between items-center px-4 py-2 border-t bg-gray-50">
          <button
            onClick={() => exportToCSV(result)}
            className="text-[11px] px-3 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50">
            Экспорт в Excel (CSV)
          </button>
          <button
            onClick={onClose}
            className="text-[11px] px-4 py-1 rounded bg-gray-700 text-white hover:bg-gray-800">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function zoneLabel(zone: "clean" | "smoky_low" | "smoky_high") {
  if (zone === "clean")      return "Чистая (>10 м)";
  if (zone === "smoky_low")  return "Средняя (5-10 м)";
  return "Сильная (<5 м)";
}

function exportToCSV(result: RescueResult) {
  const hasBack = result.operationType !== "scout" && result.operationType !== "liquidation";
  const op = OP_LABELS[result.operationType];

  // Числа выводим без кавычек — Excel распознает как числа
  // Строки с текстом — в кавычках
  type Cell = string | number;
  const rows: Cell[][] = [];

  const n = (v: number, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d); // число без кавычек

  // ── Заголовок ──────────────────────────────────────────────────────────────
  rows.push([`График времени движения горноспасателей — ${op}`]);
  rows.push([]);

  // ── Сводный раздел по зонам задымления (как в ПО Вентиляция) ──────────────
  rows.push(["ОТЧЁТ О ПУТИ ДВИЖЕНИЯ"]);
  rows.push(["Задача:", op]);
  rows.push(["Маршрут найден автоматически."]);
  rows.push([]);
  rows.push(["СВОДНЫЕ ДАННЫЕ"]);
  rows.push(["Начальный узел:", result.startNodeId]);
  rows.push(["Конечный узел:", result.targetNodeId]);
  rows.push(["Обязательные промежуточные узлы:", result.waypointNodeIds.length ? result.waypointNodeIds.join(", ") : "отсутствуют."]);
  const totalLen = result.segments.reduce((a, s) => a + s.length, 0);
  rows.push(["Длина пути:", n(totalLen, 2), "м"]);
  rows.push([]);

  // Средние скорости по зонам
  const avgSpeedClean = totalLen > 0 ? totalLen / result.totalTime_clean * 1 : 0;
  const avgSpeedSL    = totalLen > 0 ? totalLen / result.totalTime_smoky_low * 1 : 0;
  const avgSpeedSH    = totalLen > 0 ? totalLen / result.totalTime_smoky_high * 1 : 0;

  rows.push(["При k3=1 (Рв > 10 м)"]);
  rows.push(["Время пути, всего:", n(result.totalTime_clean), "мин"]);
  rows.push(["Расход кислорода:", n(result.totalO2_clean), "л"]);
  rows.push(["Средняя скорость:", n(avgSpeedClean, 1), "м/мин"]);
  rows.push([]);
  rows.push(["При k3=1,43 (Рв 5-10 м)"]);
  rows.push(["Время пути, всего:", n(result.totalTime_smoky_low), "мин"]);
  rows.push(["Расход кислорода:", n(result.totalO2_smoky_low), "л"]);
  rows.push(["Средняя скорость:", n(avgSpeedSL, 1), "м/мин"]);
  rows.push([]);
  rows.push(["При k3=2 (Рв < 5 м)"]);
  rows.push(["Время пути, всего:", n(result.totalTime_smoky_high), "мин"]);
  rows.push(["Расход кислорода:", n(result.totalO2_smoky_high), "л"]);
  rows.push(["Средняя скорость:", n(avgSpeedSH, 1), "м/мин"]);
  rows.push([]);
  rows.push(["Фактическое (расчёт пожара):"]);
  rows.push(["Туда, мин", n(result.totalTimeForward), ...(hasBack ? ["Помощь, мин", n(result.careTime), "Обратно, мин", n(result.totalTimeBack)] : [])]);
  rows.push(["Затраты O2 (факт.):", n(result.totalO2), "л"]);
  rows.push([]);

  // ── Таблица данных по участкам ─────────────────────────────────────────────
  rows.push(["ДАННЫЕ ПО УЧАСТКАМ ДВИЖЕНИЯ"]);
  rows.push([]);

  const header: Cell[] = [
    "Ветвь", "Ветвь №", "От узла", "До узла", "Длина, м", "Угол, °",
    "Зона (факт.)", "V факт., м/мин", "t факт., мин", "O2 факт., л", "Σt факт., мин", "ΣO2 факт., л",
    "Расх.O2 на 100м, л",
    "V слаб. к3=1, м/мин", "t слаб., мин", "O2 слаб., л",
    "V сред. к3=1.43, м/мин", "t сред., мин", "O2 сред., л",
    "V сильн. к3=2, м/мин", "t сильн., мин", "O2 сильн., л",
    "Комментарий",
  ];

  const segComment = (s: RescueSegment) => {
    const dir = s.angle > 0 ? "вверх" : s.angle < 0 ? "вниз" : "горизонт.";
    const smoke = s.zone !== "clean" ? " в дыму" : "";
    return `${dir}${smoke}`;
  };

  const segRow = (s: RescueSegment): Cell[] => [
    s.branchLabel || s.branchName,
    s.branchNumber,
    s.fromNodeId, s.toNodeId,
    n(s.length, 2), n(s.angle, 1),
    zoneLabel(s.zone),
    n(s.speed_mpm), n(s.time_min), n(s.o2_liters),
    n(s.cumulTime), n(s.cumulO2),
    n(s.o2_per_100m),
    n(s.speed_clean), n(s.time_clean), n(s.o2_clean),
    n(s.speed_smoky_low), n(s.time_smoky_low), n(s.o2_smoky_low),
    n(s.speed_smoky_high), n(s.time_smoky_high), n(s.o2_smoky_high),
    segComment(s),
  ];

  const totalRow = (segs: RescueSegment[], label: string, tTotal: number, o2Total: number): Cell[] => [
    label, "", "", "", n(segs.reduce((a, s) => a + s.length, 0), 2), "",
    "", "", n(tTotal), n(o2Total), "", "", "",
    "", n(segs.reduce((a, s) => a + s.time_clean, 0)),     n(segs.reduce((a, s) => a + s.o2_clean, 0)),
    "", n(segs.reduce((a, s) => a + s.time_smoky_low, 0)), n(segs.reduce((a, s) => a + s.o2_smoky_low, 0)),
    "", n(segs.reduce((a, s) => a + s.time_smoky_high, 0)),n(segs.reduce((a, s) => a + s.o2_smoky_high, 0)),
    "",
  ];

  rows.push(["=== МАРШРУТ ТУДА ==="]);
  rows.push(header);
  for (const s of result.segments) rows.push(segRow(s));
  rows.push(totalRow(result.segments, "ИТОГО ТУДА", result.totalTimeForward, result.totalO2Forward));

  if (hasBack) {
    rows.push([]);
    rows.push(["=== МАРШРУТ ОБРАТНО ==="]);
    rows.push(header);
    for (const s of result.segmentsBack) rows.push(segRow(s));
    rows.push(totalRow(result.segmentsBack, "ИТОГО ОБРАТНО", result.totalTimeBack, result.totalO2Back));
  }

  // ── Сериализация: числа без кавычек, строки в кавычках ────────────────────
  const csvRow = (r: Cell[]) =>
    r.map(c => typeof c === "number" ? String(c).replace(".", ",") : `"${String(c).replace(/"/g, '""')}"`).join(";");

  const csv = rows.map(csvRow).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "rescue_calc.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ─── Основной экспорт: панель параметров ────────────────────────────────────

export default function RescuePanel({
  nodes, branches, fireCalcDone,
  pickMode, onPickModeChange, onRegisterPickHandler,
  pickedStartId, pickedTargetId,
  onPickedStartChange, onPickedTargetChange,
  onRouteChange, onWaypointsChange,
}: Props) {
  const [operationType, setOperationType] = useState<RescueOperationType>("scout_and_transport");
  const [useAirTemp, setUseAirTemp] = useState(false);
  const [useIdaTime, setUseIdaTime] = useState(true);
  const [idaWorkTime, setIdaWorkTime] = useState(400);
  const [provideCare, setProvideCare] = useState(true);
  const [careTime, setCareTime] = useState(10);
  const [useInterpolation, setUseInterpolation] = useState(true);
  const [oxygenConsumption, setOxygenConsumption] = useState(1.4);
  const [oxygenVolume, setOxygenVolume] = useState(400);

  const [result, setResult] = useState<RescueResult | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showResultLink, setShowResultLink] = useState(false);

  // Промежуточные узлы (вайпоинты)
  const [useWaypoints, setUseWaypoints] = useState(false);
  const [waypointIds, setWaypointIds] = useState<string[]>([]);

  // Сообщаем родителю актуальные промежуточные узлы — для подписи «В» на схеме
  React.useEffect(() => {
    onWaypointsChange?.(useWaypoints ? waypointIds.filter(Boolean) : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWaypoints, waypointIds]);

  // Регистрируем обработчик pick-клика — Cad.tsx запомнит fn и будет её вызывать
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

  const startNodeId = pickedStartId;
  const targetNodeId = pickedTargetId;

  const nodeLabel = (n: { id: string; name: string; number: string }) => {
    const num = n.number ? `№${n.number}` : "";
    const nm  = n.name  ? n.name        : "";
    if (num && nm)  return `${num} — ${nm}`;
    if (num)        return num;
    if (nm)         return nm;
    return n.id.slice(0, 8);
  };

  const nodeOptions = useMemo(() => {
    return nodes.map(n => ({ id: n.id, label: nodeLabel(n) }));
  }, [nodes]);

  const nodeName = (id: string) => {
    const n = nodes.find(n2 => n2.id === id);
    if (!n) return id.slice(0, 8);
    return nodeLabel(n);
  };

  async function handleCalc() {
    if (!startNodeId || !targetNodeId) {
      alert("Укажите начальный узел (база ВГСЧ) и целевой узел (место аварии)");
      return;
    }
    if (startNodeId === targetNodeId) {
      alert("Начальный и конечный узлы совпадают");
      return;
    }
    const activeWaypoints = useWaypoints ? waypointIds.filter(Boolean) : [];
    const params: RescueParams = {
      operationType, useAirTemp, useIdaTime, idaWorkTime,
      provideCare, careTime, useInterpolation,
      oxygenConsumption, oxygenVolume,
      waypointNodeIds: activeWaypoints,
    };

    let res: RescueResult;
    try {
      const resp = await fetch(RESCUE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, branches, startNodeId, targetNodeId, params }),
      });
      const data = await resp.json();
      // branchDirs приходит как объект — конвертируем в Map
      res = {
        ...data,
        branchDirs: new Map<string, boolean>(Object.entries(data.branchDirs ?? {})),
      };
    } catch {
      // fallback на локальный расчёт при недоступности backend
      res = calcRescue(nodes, branches, startNodeId, targetNodeId, params);
    }

    setResult(res);
    setShowDialog(true);
    setShowResultLink(true);
    const branchIds = new Set([
      ...res.segments.map(s => s.branchId),
      ...res.segmentsBack.map(s => s.branchId),
    ]);
    const nodeIds = new Set([startNodeId, targetNodeId, ...activeWaypoints]);
    onRouteChange(branchIds, nodeIds, res.branchDirs);
  }

  const Label = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] text-gray-600 mt-2 mb-0.5">{children}</div>
  );
  const CB = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-1 cursor-pointer text-[11px] text-gray-700 mt-1">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-blue-600" />
      {label}
    </label>
  );

  // Кнопка выбора узла кликом на схеме.
  // ВАЖНО: это обычная функция-рендерер (возвращает JSX напрямую), а НЕ React-компонент,
  // объявленный внутри тела RescuePanel. Если бы это был вложенный компонент (const PickBtn = () => <button/>),
  // React считал бы его НОВЫМ типом компонента при каждом ре-рендере панели и пересоздавал
  // DOM-узел кнопки (unmount+mount) — из-за этого в canvas-режиме (где родитель Cad.tsx
  // перерендеривается чаще) клик по кнопке нередко «терялся» между mousedown и click.
  const renderPickBtn = (mode: "start" | "target", label: string) => (
    <button
      type="button"
      onClick={() => onPickModeChange(pickMode === mode ? null : mode)}
      title={`Кликните на узел схемы для выбора: ${label}`}
      className={`h-6 px-1.5 rounded border text-[10px] flex items-center gap-0.5 flex-shrink-0 ${
        pickMode === mode
          ? "bg-green-600 text-white border-green-700"
          : "bg-white text-gray-600 border-gray-300 hover:border-green-500"
      }`}>
      <Icon name="MousePointer2" size={10} />
      {pickMode === mode ? "Кликни узел" : "Выбрать"}
    </button>
  );

  return (
    <div className="flex flex-col gap-0 text-[11px] overflow-y-auto h-full px-2 py-2">
      <div className="font-semibold text-[12px] text-blue-900 mb-2 flex items-center gap-1">
        <Icon name="ShieldCheck" size={14} /> Расчёт горноспасателей
      </div>

      {pickMode && (
        <div className="text-[10px] bg-green-50 border border-green-300 rounded p-1.5 mb-2 text-green-800 font-medium">
          ↖ Кликните на узел схемы для выбора{" "}
          {pickMode === "start" ? "начального узла (база ВГСЧ)"
            : pickMode === "target" ? "целевого узла (место аварии)"
            : `промежуточного узла #${Number(String(pickMode).split(":")[1]) + 1}`}
        </div>
      )}

      {!fireCalcDone && (
        <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5 mb-2">
          ⚠ Расчёт пожара не выполнен. Зоны задымления не учитываются.
        </div>
      )}

      {/* Тип операции */}
      <Label>Тип операции:</Label>
      <div className="flex flex-col gap-0.5">
        {(Object.entries(OP_LABELS) as Array<[RescueOperationType, string]>).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1 cursor-pointer text-[11px] text-gray-700">
            <input type="radio" name="opType" value={key}
              checked={operationType === key}
              onChange={() => setOperationType(key)}
              className="accent-blue-600" />
            {label}
          </label>
        ))}
      </div>

      {/* Маршрут — выбор узлов (select + кнопка pick) */}
      <Label>Начальный узел (база ВГСЧ):</Label>
      <div className="flex gap-1">
        <select value={startNodeId} onChange={e => onPickedStartChange(e.target.value)}
          className="flex-1 min-w-0 rounded border border-gray-300 text-[11px] px-1 py-0.5 bg-white">
          <option value="">— выберите —</option>
          {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {renderPickBtn("start", "начального узла")}
      </div>
      {startNodeId && (
        <div className="text-[10px] text-green-700 ml-1 mt-0.5">✓ {nodeName(startNodeId)}</div>
      )}

      {/* Промежуточные узлы */}
      <div className="mt-2 border-t border-gray-100 pt-1">
        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-gray-700 font-medium">
          <input type="checkbox" checked={useWaypoints} onChange={e => setUseWaypoints(e.target.checked)}
            className="accent-orange-500" />
          Маршрут через промежуточные узлы
        </label>
        {useWaypoints && (
          <div className="mt-1 flex flex-col gap-1">
            {waypointIds.map((wpId, idx) => {
              const wpPickMode = `wp:${idx}` as `wp:${number}`;
              const isPickingThis = pickMode === wpPickMode;
              return (
                <div key={idx} className="flex gap-1 items-center">
                  <span className="text-[10px] text-orange-600 font-medium w-4 flex-shrink-0">{idx + 1}</span>
                  <select value={wpId}
                    onChange={e => setWaypointIds(prev => prev.map((v, i) => i === idx ? e.target.value : v))}
                    className="flex-1 min-w-0 rounded border border-orange-300 text-[11px] px-1 py-0.5 bg-orange-50">
                    <option value="">— выберите узел —</option>
                    {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </select>
                  <button
                    onClick={() => onPickModeChange(isPickingThis ? null : wpPickMode)}
                    title="Кликните на узел схемы"
                    className={`h-6 px-1.5 rounded border text-[10px] flex items-center gap-0.5 flex-shrink-0 ${
                      isPickingThis ? "bg-orange-500 text-white border-orange-600" : "bg-white text-gray-600 border-gray-300 hover:border-orange-400"
                    }`}>
                    <Icon name="MousePointer2" size={10} />
                  </button>
                  <button onClick={() => setWaypointIds(prev => prev.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600 px-0.5 text-[13px] leading-none flex-shrink-0"
                    title="Удалить">×</button>
                </div>
              );
            })}
            <button
              onClick={() => setWaypointIds(prev => [...prev, ""])}
              className="mt-0.5 text-[10px] text-orange-700 border border-orange-300 rounded px-2 py-0.5 hover:bg-orange-50 flex items-center gap-1">
              <Icon name="Plus" size={10} /> Добавить промежуточный узел
            </button>
            {waypointIds.length > 0 && (
              <div className="text-[9px] text-gray-400 mt-0.5">
                Маршрут: Старт → {waypointIds.filter(Boolean).map(id => nodeName(id)).join(" → ")} → Цель
              </div>
            )}
          </div>
        )}
      </div>

      <Label>Целевой узел (место аварии):</Label>
      <div className="flex gap-1">
        <select value={targetNodeId} onChange={e => onPickedTargetChange(e.target.value)}
          className="flex-1 min-w-0 rounded border border-gray-300 text-[11px] px-1 py-0.5 bg-white">
          <option value="">— выберите —</option>
          {nodeOptions.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {renderPickBtn("target", "целевого узла")}
      </div>
      {targetNodeId && (
        <div className="text-[10px] text-green-700 ml-1 mt-0.5">✓ {nodeName(targetNodeId)}</div>
      )}

      {/* Параметры расчёта */}
      <div className="border-t border-gray-200 mt-2 pt-1">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Расчёт:</div>
        <CB checked={useAirTemp} onChange={setUseAirTemp} label="Учитывать температуру воздуха" />
        <CB checked={useIdaTime} onChange={setUseIdaTime} label="Учитывать время действия ИДА" />
        {useIdaTime && (
          <div className="flex items-center justify-between mt-0.5 ml-4">
            <span className="text-[10px] text-gray-600">Время:</span>
            <div className="flex items-center gap-1">
              <input type="number" value={idaWorkTime} onChange={e => setIdaWorkTime(Number(e.target.value))}
                className="w-16 border border-gray-300 rounded text-[11px] px-1 py-0 text-right" min={10} max={1200} step={10} />
              <span className="text-[10px] text-gray-500">мин.</span>
            </div>
          </div>
        )}
        <CB checked={provideCare} onChange={setProvideCare} label="Оказание помощи пострадавшим" />
        {provideCare && (
          <div className="flex items-center justify-between mt-0.5 ml-4">
            <span className="text-[10px] text-gray-600">Время:</span>
            <div className="flex items-center gap-1">
              <input type="number" value={careTime} onChange={e => setCareTime(Number(e.target.value))}
                className="w-16 border border-gray-300 rounded text-[11px] px-1 py-0 text-right" min={0} max={120} step={1} />
              <span className="text-[10px] text-gray-500">мин.</span>
            </div>
          </div>
        )}
        <CB checked={useInterpolation} onChange={setUseInterpolation} label="Использовать интерполяцию в расчёте" />
      </div>

      {/* Кислород */}
      <div className="border-t border-gray-200 mt-2 pt-1">
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Кислород:</div>
        <CB checked={true} onChange={() => {}} label="Учитывать затраты кислорода" />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-600">Расход:</span>
          <div className="flex items-center gap-1">
            <input type="number" value={oxygenConsumption} onChange={e => setOxygenConsumption(Number(e.target.value))}
              className="w-16 border border-gray-300 rounded text-[11px] px-1 py-0 text-right" min={0.1} max={5} step={0.1} />
            <span className="text-[10px] text-gray-500">л/мин</span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-gray-600">Объём:</span>
          <div className="flex items-center gap-1">
            <input type="number" value={oxygenVolume} onChange={e => setOxygenVolume(Number(e.target.value))}
              className="w-16 border border-gray-300 rounded text-[11px] px-1 py-0 text-right" min={50} max={1000} step={50} />
            <span className="text-[10px] text-gray-500">л.</span>
          </div>
        </div>
      </div>

      {/* Кнопки */}
      <div className="border-t border-gray-200 mt-2 pt-2 flex flex-col gap-1">
        <button onClick={handleCalc}
          disabled={!startNodeId || !targetNodeId}
          className="w-full py-1.5 rounded text-[12px] font-semibold disabled:opacity-40"
          style={{ background: "#1d4ed8", color: "white" }}>
          Рассчитать
        </button>
        {showResultLink && result && (
          <button onClick={() => setShowDialog(true)}
            className="w-full py-1 rounded text-[11px] text-blue-700 border border-blue-300 hover:bg-blue-50">
            Показать график
          </button>
        )}
        {result && (
          <button
            onClick={() => {
              setResult(null);
              setShowResultLink(false);
              onPickedStartChange("");
              onPickedTargetChange("");
              onPickModeChange(null);
              onRouteChange(new Set(), new Set(), new Map());
            }}
            className="w-full py-1 rounded text-[11px] text-gray-600 border border-gray-300 hover:bg-gray-50">
            Очистить маршрут
          </button>
        )}
      </div>

      {/* Краткий итог */}
      {result && (
        <div className={`mt-2 border rounded p-2 ${result.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
          <div className="text-[11px] font-semibold mb-1">
            {result.ok ? "✓ Операция выполнима" : "✗ Превышение ресурса ИДА"}
          </div>
          <MetricRow label="Время хода (факт.)" value={`${result.totalTime.toFixed(1)} мин`} />
          <MetricRow label="Слабое задымление" value={`${result.totalTime_smoky_low.toFixed(1)} мин`} />
          <MetricRow label="Густое задымление" value={`${result.totalTime_smoky_high.toFixed(1)} мин`} warn={result.totalTime_smoky_high > (result.timeIdaPercent > 0 ? result.totalTime / result.timeIdaPercent * 100 : Infinity)} />
          <div className="border-t border-gray-200 mt-1 pt-1">
            <MetricRow label="Затраты O₂ (факт.)" value={`${result.totalO2.toFixed(1)} л`} warn={result.o2IdaPercent > 100} />
          </div>
        </div>
      )}

      {showDialog && result && (
        <RescueResultDialog result={result} onClose={() => setShowDialog(false)} />
      )}
    </div>
  );
}