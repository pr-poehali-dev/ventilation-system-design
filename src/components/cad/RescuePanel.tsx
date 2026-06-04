import React, { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import {
  calcRescue,
  RescueParams,
  RescueOperationType,
  RescueResult,
  RescueSegment,
} from "@/lib/rescueCalculator";

interface NodeLite { id: string; name: string; number: string; x: number; y: number; z: number; }
interface BranchLite {
  id: string; fromId: string; toId: string;
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
}

const OP_LABELS: Record<RescueOperationType, string> = {
  scout_and_transport: "Разведка туда, транспортировка обратно",
  scout: "Разведка",
  transport: "Транспортировка пострадавшего",
  liquidation: "Ликвидация аварии",
};

function ZoneBadge({ zone }: { zone: "clean" | "smoky_low" | "smoky_high" }) {
  if (zone === "clean") return <span className="text-green-700 font-medium">Чистая</span>;
  if (zone === "smoky_low") return <span className="text-orange-600 font-medium">Задымл. 5-10</span>;
  return <span className="text-red-700 font-medium">Задымл. &lt;5</span>;
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
  segments, segmentsBack, type, careTime
}: {
  segments: RescueSegment[];
  segmentsBack: RescueSegment[];
  type: "time" | "oxygen";
  careTime: number;
}) {
  const W = 320; const H = 120; const PAD = 30;
  const fw = W - PAD * 2; const fh = H - PAD * 1.5;

  const fwdPoints = segments.map(s => ({
    x: s.cumulTime,
    y: type === "time" ? s.cumulTime : s.cumulO2,
  }));
  const lastFwd = fwdPoints[fwdPoints.length - 1];
  const bwdPoints = segmentsBack.map((s, i) => ({
    x: (lastFwd?.x ?? 0) + careTime + s.cumulTime,
    y: type === "time"
      ? (lastFwd?.y ?? 0) + careTime + s.cumulTime
      : (lastFwd?.y ?? 0) + careTime * 1.4 + s.cumulO2,
  }));

  const allPts = [{ x: 0, y: 0 }, ...fwdPoints, ...bwdPoints];
  const maxX = Math.max(...allPts.map(p => p.x), 1);
  const maxY = Math.max(...allPts.map(p => p.y), 1);

  const toSvg = (p: { x: number; y: number }) => ({
    sx: PAD + (p.x / maxX) * fw,
    sy: PAD + fh - (p.y / maxY) * fh,
  });

  const pts = allPts.map(toSvg);
  const fwdPts = [{ sx: PAD, sy: PAD + fh }, ...fwdPoints.map(toSvg)];
  const bwdPts = [(fwdPoints.length > 0 ? toSvg(fwdPoints[fwdPoints.length - 1]) : { sx: PAD, sy: PAD + fh }), ...bwdPoints.map(toSvg)];

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
      {/* Линия обратно — серая */}
      <polyline points={poly(bwdPts)} fill="none" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 2" />

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
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium">Сег.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium">Длина, м</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium">Угол, °</th>
              {/* Фактическая зона */}
              <th className="border border-gray-200 px-1 py-0.5 text-center font-medium" style={{ background: "#f0fdf4" }}>Зона</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>V, м/мин</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>t, мин</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>O₂, л</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>Σt, мин</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>ΣO₂, л</th>
              {/* Слабое задымление */}
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fff7ed", color: "#c2410c" }}>t слаб.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fff7ed", color: "#c2410c" }}>O₂ слаб.</th>
              {/* Густое задымление */}
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fef2f2", color: "#b91c1c" }}>t густ.</th>
              <th className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#fef2f2", color: "#b91c1c" }}>O₂ густ.</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f9fafb" }}>
                <td className="border border-gray-200 px-1 py-0.5 max-w-[160px] truncate" title={s.branchName}>
                  {s.branchLabel || s.branchName}
                </td>
                <td className="border border-gray-200 px-1 py-0.5 text-center">{s.segmentNumber}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right">{Math.round(s.length)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right">{s.angle.toFixed(0)}°</td>
                <td className="border border-gray-200 px-1 py-0.5 text-center" style={{ background: "#f0fdf4" }}>
                  <ZoneBadge zone={s.zone} />
                </td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.speed_mpm}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.time_min.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#f0fdf4" }}>{s.o2_liters.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>{s.cumulTime.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right font-medium" style={{ background: "#f0fdf4" }}>{s.cumulO2.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fff7ed" }}>{s.time_smoky_low.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fff7ed" }}>{s.o2_smoky_low.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fef2f2" }}>{s.time_smoky_high.toFixed(1)}</td>
                <td className="border border-gray-200 px-1 py-0.5 text-right" style={{ background: "#fef2f2" }}>{s.o2_smoky_high.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#eff6ff" }}>
              <td colSpan={6} className="border border-gray-200 px-1 py-0.5 font-semibold text-right">Итого:</td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold">
                {segments.reduce((s, seg) => s + seg.time_min, 0).toFixed(1)}
              </td>
              <td className="border border-gray-200 px-1 py-0.5 text-right font-semibold">
                {segments.reduce((s, seg) => s + seg.o2_liters, 0).toFixed(1)}
              </td>
              <td colSpan={2} />
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 700, maxHeight: "90vh", overflow: "hidden" }}
      >
        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2 border-b"
          style={{ background: "#1e40af", color: "white" }}>
          <div className="flex items-center gap-2">
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
              <MetricRow label="Помощь" value={`${result.careTime.toFixed(1)} мин`} />
              <MetricRow label="Обратно" value={`${result.totalTimeBack.toFixed(1)} мин`} />
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
                <tr style={{ background: "#fff7ed" }}>
                  <td className="px-2 py-1 text-orange-700">Слабое задымление (видимость 5–10 м)</td>
                  <td className="px-2 py-1 text-right">{result.totalTime_smoky_low.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{result.totalO2_smoky_low.toFixed(1)}</td>
                </tr>
                <tr style={{ background: "#fef2f2" }}>
                  <td className="px-2 py-1 text-red-700">Густое задымление (видимость &lt;5 м)</td>
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
              />
            </div>
            <div className="flex gap-4 justify-center mt-1">
              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#dc2626" strokeWidth={2} /></svg>
                Туда
              </div>
              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                <svg width={20} height={4}><line x1={0} y1={2} x2={20} y2={2} stroke="#6b7280" strokeWidth={2} strokeDasharray="4 2" /></svg>
                Обратно
              </div>
            </div>
          </div>

          {/* Таблица сегментов */}
          <div>
            <div className="flex gap-1 mb-2">
              {(["forward", "back"] as const).map(t => (
                <button key={t}
                  onClick={() => setTableTab(t)}
                  className={`text-[11px] px-2 py-0.5 rounded border ${tableTab === t ? "bg-blue-600 text-white border-blue-700" : "bg-white text-gray-700 border-gray-300"}`}>
                  {t === "forward" ? `Туда (${result.segments.length} уч.)` : `Обратно (${result.segmentsBack.length} уч.)`}
                </button>
              ))}
            </div>
            {tableTab === "forward"
              ? <SegmentsTable segments={result.segments} title="Маршрут туда" />
              : <SegmentsTable segments={result.segmentsBack} title="Маршрут обратно" />
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
  if (zone === "clean") return "Чистая";
  if (zone === "smoky_low") return "Задымл. 5-10 м";
  return "Задымл. <5 м";
}

function exportToCSV(result: RescueResult) {
  const rows: string[][] = [];
  const op = OP_LABELS[result.operationType];

  rows.push([`График времени движения горноспасателей — ${op}`]);
  rows.push([]);

  // Итоги по зонам задымления
  rows.push(["Итого:", "", "Зона задымления", "Время хода, мин", "Кислород, л"]);
  rows.push(["", "", "Фактическая (расчёт пожара)", result.totalTime.toFixed(1), result.totalO2.toFixed(1)]);
  rows.push(["", "", "Слабое задымление (видим. 5-10 м)", result.totalTime_smoky_low.toFixed(1), result.totalO2_smoky_low.toFixed(1)]);
  rows.push(["", "", "Густое задымление (видим. <5 м)", result.totalTime_smoky_high.toFixed(1), result.totalO2_smoky_high.toFixed(1)]);
  rows.push([]);
  rows.push(["Туда, мин", result.totalTimeForward.toFixed(1), "Помощь, мин", result.careTime.toFixed(1), "Обратно, мин", result.totalTimeBack.toFixed(1)]);
  rows.push([]);

  const header = [
    "Выработка", "Сегм.", "Длина, м", "Угол, °",
    // Фактическая зона
    "Зона (факт.)", "V факт., м/мин", "t факт., мин", "O2 факт., л", "Σt факт., мин", "ΣO2 факт., л",
    // Слабое задымление
    "V слаб., м/мин", "t слаб., мин", "O2 слаб., л",
    // Густое задымление
    "V густ., м/мин", "t густ., мин", "O2 густ., л",
  ];

  const segRow = (s: RescueSegment) => [
    s.branchName, String(s.segmentNumber), String(Math.round(s.length)), s.angle.toFixed(0),
    zoneLabel(s.zone), String(s.speed_mpm), s.time_min.toFixed(2), s.o2_liters.toFixed(2),
    s.cumulTime.toFixed(2), s.cumulO2.toFixed(2),
    String(s.speed_smoky_low), s.time_smoky_low.toFixed(2), s.o2_smoky_low.toFixed(2),
    String(s.speed_smoky_high), s.time_smoky_high.toFixed(2), s.o2_smoky_high.toFixed(2),
  ];

  rows.push(["=== МАРШРУТ ТУДА ==="]);
  rows.push(header);
  for (const s of result.segments) rows.push(segRow(s));
  // Итоговая строка туда
  rows.push([
    "ИТОГО ТУДА", "", String(Math.round(result.segments.reduce((a, s) => a + s.length, 0))), "",
    "", "", result.totalTimeForward.toFixed(2), result.totalO2Forward.toFixed(2), "", "",
    "", result.segments.reduce((a, s) => a + s.time_smoky_low, 0).toFixed(2),
    result.segments.reduce((a, s) => a + s.o2_smoky_low, 0).toFixed(2),
    "", result.segments.reduce((a, s) => a + s.time_smoky_high, 0).toFixed(2),
    result.segments.reduce((a, s) => a + s.o2_smoky_high, 0).toFixed(2),
  ]);

  rows.push([]);
  rows.push(["=== МАРШРУТ ОБРАТНО ==="]);
  rows.push(header);
  for (const s of result.segmentsBack) rows.push(segRow(s));
  rows.push([
    "ИТОГО ОБРАТНО", "", String(Math.round(result.segmentsBack.reduce((a, s) => a + s.length, 0))), "",
    "", "", result.totalTimeBack.toFixed(2), result.totalO2Back.toFixed(2), "", "",
    "", result.segmentsBack.reduce((a, s) => a + s.time_smoky_low, 0).toFixed(2),
    result.segmentsBack.reduce((a, s) => a + s.o2_smoky_low, 0).toFixed(2),
    "", result.segmentsBack.reduce((a, s) => a + s.time_smoky_high, 0).toFixed(2),
    result.segmentsBack.reduce((a, s) => a + s.o2_smoky_high, 0).toFixed(2),
  ]);

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
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
  onRouteChange,
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

  const nodeOptions = useMemo(() => {
    return nodes.map(n => ({
      id: n.id,
      label: n.name ? `${n.name}` : n.number ? `Узел ${n.number}` : n.id.slice(0, 8),
    }));
  }, [nodes]);

  const nodeName = (id: string) => {
    const n = nodes.find(n2 => n2.id === id);
    if (!n) return id.slice(0, 8);
    return n.name || (n.number ? `Узел ${n.number}` : id.slice(0, 8));
  };

  function handleCalc() {
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
    const res = calcRescue(nodes, branches, startNodeId, targetNodeId, params);
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

  // Кнопка выбора узла кликом на схеме
  const PickBtn = ({ mode, label }: { mode: "start" | "target"; label: string }) => (
    <button
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
        <PickBtn mode="start" label="начального узла" />
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
        <PickBtn mode="target" label="целевого узла" />
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