// Справочник оборудования — аналог справочников в АэроСети
import { useState, useCallback, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { FAN_CATALOG, type FanCurve } from "@/lib/fanCurves";
import {
  BULKHEAD_CATALOG, BULKHEAD_TYPE_LABELS, BULKHEAD_TYPE_COLORS,
  type BulkheadCatalogItem, type BulkheadType, airPermToR,
} from "@/lib/bulkheads";
import UnitsConfigPanel from "@/components/cad/UnitsConfigPanel";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";

type TabId = "fans" | "types" | "bulkheads" | "sensors" | "typical" | "pumps" | "pipes" | "transport" | "units";

export interface MineFanExport {
  catalogId: string;
  name: string;
  diameter: number;
  rpmMin: number;
  rpmMax: number;
}

export interface MineBulkheadExport {
  id: string;
  name: string;
  type: BulkheadType;
  airPermeability: number;
  rMkyurg: number;     // сопротивление в Мюрг
  failurePressure: number;
  note: string;
  color: string;
  isCustom?: boolean;
}

interface Props {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  onClose: () => void;
  onMineFansChange?: (fans: MineFanExport[]) => void;
  onMineBulkheadsChange?: (bulkheads: MineBulkheadExport[]) => void;
  onBranchTypesChange?: (types: BranchType[]) => void;
  initialMineFans?: MineFanExport[];
  initialBranchTypes?: BranchType[];
  initialMineBulkheads?: MineBulkheadExport[];
  unitsConfig?: UnitsConfig;
  onUnitsConfigChange?: (cfg: UnitsConfig) => void;
}

const TABS: { id: TabId; label: string; icon: string; group: string }[] = [
  { id: "fans",      label: "Вентиляторы",        icon: "Wind",      group: "Вентиляция" },
  { id: "types",     label: "Типы выработок",      icon: "Layers",    group: "Вентиляция" },
  { id: "bulkheads", label: "Перемычки",           icon: "Square",    group: "Вентиляция" },
  { id: "sensors",   label: "Датчики",             icon: "Radio",     group: "Аварии" },
  { id: "typical",   label: "Типовые меры",        icon: "FileText",  group: "Аварии" },
  { id: "pumps",     label: "Насосы",              icon: "Gauge",     group: "Трубопровод" },
  { id: "pipes",     label: "Трубы",               icon: "GitBranch", group: "Трубопровод" },
  { id: "transport", label: "Транспорт",           icon: "Truck",     group: "Общее" },
  { id: "units",     label: "Единицы измерения",   icon: "Ruler",     group: "Общее" },
];

// ─── Типы для справочника вентиляторов рудника ────────────────────────────
const CURVE_COLORS = ["#e91e63", "#ff5722", "#ff9800", "#4caf50", "#2196f3", "#9c27b0", "#00bcd4"];

interface MineAngle {
  id: string;
  angle: number;
  reverse: boolean;
  rpm: number;
  color: string;
  operatingQ?: number;
  operatingH?: number;
}
interface MineFan {
  id: string;
  catalogId: string;
  name: string;
  type: string;
  diameter: number;
  rpmMin: number;
  rpmMax: number;
  bladeAngles: MineAngle[];
  note?: string;
}

function fanCurvePoints(c: FanCurve, angleFactor = 1.0, n = 40): { q: number; h: number; p: number }[] {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const q = (c.qMin + (c.qMax - c.qMin) * (i / n));
    const h = Math.max(0, (c.h0 + c.h1 * q + c.h2 * q * q) * angleFactor);
    const eta = Math.min(0.85, Math.max(0.05, c.e0 + c.e1 * q + c.e2 * q * q));
    const p = eta > 0 ? (h * q) / eta / 1000 : 0;
    pts.push({ q: +q.toFixed(2), h: +h.toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

function reverseCurvePoints(c: FanCurve, n = 40): { q: number; h: number; p: number }[] {
  if (c.reverseH0 === undefined) return [];
  const pts = [];
  const qMin = c.reverseQMin ?? c.qMin;
  const qMax = c.reverseQMax ?? c.qMax;
  for (let i = 0; i <= n; i++) {
    const q = qMin + (qMax - qMin) * (i / n);
    const h = Math.max(0, c.reverseH0! + (c.reverseH1 ?? 0) * q + (c.reverseH2 ?? 0) * q * q);
    const eta = Math.min(0.85, Math.max(0.05, c.e0 + c.e1 * q + c.e2 * q * q)) * (c.reverseEfficiencyFactor ?? 0.82);
    const p = eta > 0 ? (h * q) / eta / 1000 : 0;
    pts.push({ q: +q.toFixed(2), h: +h.toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

function angleFactor(c: FanCurve, angle: number): number {
  if (!c.bladeAngles || c.bladeAngles.length < 2) return 1;
  const min = Math.min(...c.bladeAngles);
  const max = Math.max(...c.bladeAngles);
  if (max === min) return 1;
  const t = (angle - min) / (max - min);
  return 0.6 + 0.4 * t;
}

// ─── График Q-H / Q-P ─────────────────────────────────────────────────────
function FanChart({ curves, type, operatingPoints }: {
  curves: { pts: { q: number; h: number; p: number }[]; color: string; dash?: boolean }[];
  type: "qh" | "qp";
  operatingPoints?: { q: number; h: number; color: string }[];
}) {
  const W = 340, H = 190, PL = 46, PR = 12, PT = 10, PB = 30;
  const cw = W - PL - PR, ch = H - PT - PB;

  const allPts = curves.flatMap(c => c.pts);
  if (allPts.length === 0) return <svg width={W} height={H}><text x={W/2} y={H/2} textAnchor="middle" fontSize="11" fill="#999">Нет данных</text></svg>;

  const maxQ = Math.max(...allPts.map(p => p.q)) * 1.05 || 100;
  const maxV = type === "qh"
    ? Math.max(...allPts.map(p => p.h)) * 1.15 || 1000
    : Math.max(...allPts.map(p => p.p)) * 1.15 || 100;

  const toX = (q: number) => PL + (q / maxQ) * cw;
  const toY = (v: number) => PT + ch - (v / maxV) * ch;

  const yTicks = 4, xTicks = 5;
  return (
    <svg width={W} height={H} style={{ fontFamily: "Arial, sans-serif", display: "block" }}>
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const y = PT + (i / yTicks) * ch;
        const val = maxV * (1 - i / yTicks);
        return <g key={i}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e5e7eb" strokeWidth="0.7" />
          <text x={PL - 4} y={y + 3} fontSize="8" textAnchor="end" fill="#888">
            {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
          </text>
        </g>;
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const x = PL + (i / xTicks) * cw;
        const val = maxQ * (i / xTicks);
        return <g key={i}>
          <line x1={x} y1={PT} x2={x} y2={PT + ch} stroke="#e5e7eb" strokeWidth="0.7" />
          <text x={x} y={H - 8} fontSize="8" textAnchor="middle" fill="#888">{val.toFixed(0)}</text>
        </g>;
      })}
      <rect x={PL} y={PT} width={cw} height={ch} fill="none" stroke="#ccc" strokeWidth="0.8" />
      {curves.map((c, ci) => {
        if (c.pts.length === 0) return null;
        const d = c.pts.map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.q).toFixed(1)},${toY(type === "qh" ? p.h : p.p).toFixed(1)}`).join(" ");
        return <path key={ci} d={d} fill="none" stroke={c.color} strokeWidth={c.dash ? 1.2 : 2}
          strokeDasharray={c.dash ? "4,3" : undefined} strokeLinejoin="round" />;
      })}
      {operatingPoints?.map((op, i) => (
        <g key={i}>
          <circle cx={toX(op.q)} cy={toY(op.h)} r={4} fill={op.color} stroke="white" strokeWidth={1.5} />
        </g>
      ))}
      <text x={PL + cw / 2} y={H - 1} fontSize="8" textAnchor="middle" fill="#666">Расход, м³/с</text>
      <text transform={`translate(9,${PT + ch / 2}) rotate(-90)`} fontSize="8" textAnchor="middle" fill="#666">
        {type === "qh" ? "Напор, Па" : "Мощность, кВт"}
      </text>
    </svg>
  );
}

// ─── Диалог выбора из библиотеки ──────────────────────────────────────────
function LibraryDialog({ onSelect, onClose }: { onSelect: (c: FanCurve) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "axial" | "centrifugal" | "vmp">("all");
  const [previewId, setPreviewId] = useState<string | null>(null);

  const list = FAN_CATALOG.filter(c =>
    (filter === "all" || c.type === filter) &&
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const preview = previewId ? FAN_CATALOG.find(c => c.id === previewId) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
      <div className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden" style={{ width: 760, height: 520 }}>
        {/* Шапка */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 flex-shrink-0" style={{ background: "#f0f4f8" }}>
          <Icon name="BookOpen" size={14} className="text-blue-600" />
          <span className="text-[13px] font-semibold text-gray-800">Библиотека вентиляторов</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700"><Icon name="X" size={16} /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Левая панель — список */}
          <div className="flex flex-col border-r border-gray-200" style={{ width: 280 }}>
            {/* Поиск + фильтр */}
            <div className="p-2 border-b border-gray-100 space-y-1.5 flex-shrink-0">
              <div className="flex items-center gap-1 border border-gray-300 rounded px-2 bg-white">
                <Icon name="Search" size={12} className="text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск..." className="flex-1 text-[12px] py-1 outline-none bg-transparent text-gray-900" />
              </div>
              <div className="flex gap-1">
                {([["all", "Все"], ["axial", "Осевые"], ["centrifugal", "Центробежные"], ["vmp", "ВМП"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setFilter(v)}
                    className="flex-1 py-0.5 text-[10px] rounded border"
                    style={{ background: filter === v ? "#2563eb" : "white", color: filter === v ? "white" : "#555", borderColor: filter === v ? "#2563eb" : "#d1d5db" }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {/* Список */}
            <div className="flex-1 overflow-y-auto">
              {list.map(c => (
                <div key={c.id}
                  onClick={() => setPreviewId(c.id)}
                  className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-gray-50 select-none hover:bg-blue-50"
                  style={{ background: previewId === c.id ? "#dbeafe" : undefined }}>
                  <div>
                    <div className="text-[12px] font-semibold text-blue-800">{c.name}</div>
                    <div className="text-[10px] text-gray-500">{c.type === "axial" ? "Осевой" : c.type === "vmp" ? "ВМП" : "Центробежный"}</div>
                  </div>
                  <span className="text-[10px] text-gray-400">Ø{c.diameter} м</span>
                </div>
              ))}
              {list.length === 0 && (
                <div className="flex items-center justify-center h-24 text-[12px] text-gray-400">Не найдено</div>
              )}
            </div>
          </div>

          {/* Правая панель — предпросмотр */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {preview ? (
              <>
                <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
                  <div className="text-[14px] font-bold text-gray-900">{preview.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {preview.type === "axial" ? "Осевой" : preview.type === "vmp" ? "ВМП" : "Центробежный"} · Ø{preview.diameter} м · {preview.rpmMin}–{preview.rpmMax} об/мин
                  </div>
                  <div className="flex gap-3 mt-1.5 text-[11px] text-gray-600">
                    <span>Q: {preview.qMin}–{preview.qMax} м³/с</span>
                    <span>H: {Math.round(preview.h0)} Па (max)</span>
                    {preview.bladeAngles.length > 0 && <span>Углы: {preview.bladeAngles.join(", ")}°</span>}
                    {preview.reverseH0 !== undefined && <span className="text-green-700 font-medium">✓ Реверс</span>}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {/* Q-H кривые для всех углов */}
                  {(() => {
                    const angles = preview.bladeAngles.length > 0 ? preview.bladeAngles : [0];
                    const curves = angles.map((a, i) => ({
                      pts: fanCurvePoints(preview, angleFactor(preview, a)),
                      color: CURVE_COLORS[i % CURVE_COLORS.length],
                    }));
                    const reverseCurves = preview.reverseH0 !== undefined ? [{
                      pts: reverseCurvePoints(preview),
                      color: "#9c27b0",
                      dash: true,
                    }] : [];
                    return (
                      <div className="space-y-2">
                        <div>
                          <div className="text-[10px] text-gray-500 font-medium mb-1">Напор — Расход</div>
                          <div style={{ border: "1px solid #e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                            <FanChart curves={[...curves, ...reverseCurves]} type="qh" />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {angles.map((a, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <div className="w-5 h-1.5 rounded" style={{ background: CURVE_COLORS[i % CURVE_COLORS.length] }} />
                              <span className="text-[10px] text-gray-600">{a > 0 ? "+" : ""}{a}°</span>
                            </div>
                          ))}
                          {preview.reverseH0 !== undefined && (
                            <div className="flex items-center gap-1">
                              <div className="w-5 h-0.5 rounded" style={{ borderTop: "2px dashed #9c27b0" }} />
                              <span className="text-[10px] text-purple-700">Реверс</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-gray-400 flex-col gap-2">
                <Icon name="MousePointer2" size={24} className="text-gray-300" />
                Выберите вентилятор из списка
              </div>
            )}
          </div>
        </div>
        {/* Кнопки */}
        <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
          <span className="text-[11px] text-gray-500 flex-1">
            {preview ? `Выбран: ${preview.name}` : "Выберите вентилятор из списка для импорта"}
          </span>
          <button onClick={onClose} className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
            Отмена
          </button>
          <button onClick={() => preview && onSelect(preview)} disabled={!preview}
            className="h-7 px-4 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40">
            Импортировать
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Диалог добавления характеристики ─────────────────────────────────────
function AddAngleDialog({ fan, onAdd, onClose }: {
  fan: MineFan;
  onAdd: (a: MineAngle) => void;
  onClose: () => void;
}) {
  const catalog = FAN_CATALOG.find(c => c.id === fan.catalogId);
  const availAngles = catalog?.bladeAngles ?? [];
  const [angle, setAngle] = useState(availAngles[0] ?? 0);
  const [reverse, setReverse] = useState(false);
  const [rpm, setRpm] = useState(fan.rpmMax);
  const [opQ, setOpQ] = useState(catalog?.qNominal ?? 0);
  const [opH, setOpH] = useState(catalog?.hNominal ?? 0);

  const preview = catalog ? fanCurvePoints(catalog, angleFactor(catalog, angle)) : [];
  const revPts = (reverse && catalog?.reverseH0 !== undefined) ? reverseCurvePoints(catalog) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
      <div className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden" style={{ width: 520, maxHeight: 520 }}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 flex-shrink-0" style={{ background: "#f0f4f8" }}>
          <Icon name="Plus" size={14} className="text-blue-600" />
          <span className="text-[13px] font-semibold">Новая рабочая характеристика — {fan.name}</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700"><Icon name="X" size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Угол лопаток, °</label>
              {availAngles.length > 0 ? (
                <select value={angle} onChange={e => setAngle(+e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white">
                  {availAngles.map(a => <option key={a} value={a}>{a > 0 ? "+" : ""}{a}°</option>)}
                </select>
              ) : (
                <input type="number" value={angle} onChange={e => setAngle(+e.target.value)}
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900" />
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Скорость, об/мин</label>
              <input type="number" min={fan.rpmMin} max={fan.rpmMax} value={rpm}
                onChange={e => setRpm(+e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="rev-check" checked={reverse}
              onChange={e => setReverse(e.target.checked)}
              className="w-4 h-4" style={{ accentColor: "#9333ea" }} />
            <label htmlFor="rev-check" className="text-[12px] text-gray-700">
              Реверсивная характеристика
              {!catalog?.reverseH0 && " (данные по реверсу отсутствуют в каталоге)"}
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Рабочая точка Q, м³/с</label>
              <input type="number" min={0} step={1} value={opQ} onChange={e => setOpQ(+e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Рабочая точка H, Па</label>
              <input type="number" min={0} step={10} value={opH} onChange={e => setOpH(+e.target.value)}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900" />
            </div>
          </div>
          {/* Предпросмотр */}
          {catalog && (
            <div>
              <div className="text-[10px] text-gray-500 font-medium mb-1">Предпросмотр Q–H</div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                <FanChart
                  curves={[
                    { pts: preview, color: "#2196f3" },
                    ...(revPts.length ? [{ pts: revPts, color: "#9c27b0", dash: true }] : []),
                  ]}
                  type="qh"
                  operatingPoints={opQ > 0 ? [{ q: opQ, h: opH, color: "#e91e63" }] : []}
                />
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 px-4 py-2 border-t border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
          <button onClick={onClose} className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">Отмена</button>
          <button onClick={() => {
            onAdd({
              id: `a${Date.now()}`,
              angle, reverse, rpm,
              color: CURVE_COLORS[0],
              operatingQ: opQ || undefined,
              operatingH: opH || undefined,
            });
            onClose();
          }} className="ml-auto h-7 px-4 text-[12px] bg-blue-600 text-white rounded hover:bg-blue-700">
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Секция вентиляторов ──────────────────────────────────────────────────
function catalogToMineFan(c: FanCurve): MineFan {
  const defaultAngles = c.bladeAngles.length > 0 ? c.bladeAngles : [0];
  return {
    id: `mf_${c.id}_${Date.now()}`,
    catalogId: c.id,
    name: c.name,
    type: c.type === "axial" ? "Осевой" : "Центробежный",
    diameter: c.diameter,
    rpmMin: c.rpmMin,
    rpmMax: c.rpmMax,
    bladeAngles: defaultAngles.map((a, i) => ({
      id: `a${i}`,
      angle: a,
      reverse: false,
      rpm: c.rpmNominal,
      color: CURVE_COLORS[i % CURVE_COLORS.length],
    })),
    note: "",
  };
}





function exportToMineFan(exp: MineFanExport): MineFan {
  const catalog = FAN_CATALOG.find(c => c.id === exp.catalogId);
  const defaultAngles = catalog && catalog.bladeAngles.length > 0 ? catalog.bladeAngles : [0];
  return {
    id: `mf_${exp.catalogId}_restored`,
    catalogId: exp.catalogId,
    name: exp.name,
    type: catalog ? (catalog.type === "axial" ? "Осевой" : "Центробежный") : "Осевой",
    diameter: exp.diameter,
    rpmMin: exp.rpmMin,
    rpmMax: exp.rpmMax,
    bladeAngles: defaultAngles.map((a, i) => ({
      id: `a${i}`,
      angle: a,
      reverse: false,
      rpm: catalog?.rpmNominal ?? exp.rpmMax,
      color: CURVE_COLORS[i % CURVE_COLORS.length],
    })),
    note: "",
  };
}

// ─── Секция вентиляторов ──────────────────────────────────────────────────
function FansSection({ onMineFansChange, initialMineFans }: { onMineFansChange?: (fans: MineFanExport[]) => void; initialMineFans?: MineFanExport[] }) {
  const [fans, setFans] = useState<MineFan[]>(() =>
    initialMineFans && initialMineFans.length > 0
      ? initialMineFans.map(exportToMineFan)
      : []
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [addAngleFor, setAddAngleFor] = useState<MineFan | null>(null);
  const [editNote, setEditNote] = useState(false);

  const selected = fans.find(f => f.id === selectedId) ?? null;
  const catalog = selected ? FAN_CATALOG.find(c => c.id === selected.catalogId) : null;

  const updateFans = (next: MineFan[]) => {
    setFans(next);
    onMineFansChange?.(next.map(f => ({ catalogId: f.catalogId, name: f.name, diameter: f.diameter, rpmMin: f.rpmMin, rpmMax: f.rpmMax })));
  };

  const importFromLibrary = (c: FanCurve) => {
    const mf = catalogToMineFan(c);
    updateFans([...fans, mf]);
    setSelectedId(mf.id);
    setShowLibrary(false);
  };

  const removeFan = (id: string) => {
    const next = fans.filter(f => f.id !== id);
    updateFans(next);
    if (selectedId === id) setSelectedId(null);
  };

  const updateAngle = (fanId: string, angleId: string, patch: Partial<MineAngle>) => {
    updateFans(fans.map(f => f.id === fanId
      ? { ...f, bladeAngles: f.bladeAngles.map(a => a.id === angleId ? { ...a, ...patch } : a) }
      : f
    ));
  };

  const removeAngle = (fanId: string, angleId: string) => {
    updateFans(fans.map(f => f.id === fanId
      ? { ...f, bladeAngles: f.bladeAngles.filter(a => a.id !== angleId) }
      : f
    ));
  };

  const addAngle = (fanId: string, angle: MineAngle) => {
    updateFans(fans.map(f => f.id === fanId
      ? { ...f, bladeAngles: [...f.bladeAngles, { ...angle, color: CURVE_COLORS[f.bladeAngles.length % CURVE_COLORS.length] }] }
      : f
    ));
  };

  // Кривые для текущего вентилятора
  const buildCurves = (fan: MineFan) => {
    const c = FAN_CATALOG.find(x => x.id === fan.catalogId);
    if (!c) return [];
    return fan.bladeAngles.map(a => ({
      pts: a.reverse && c.reverseH0 !== undefined
        ? reverseCurvePoints(c)
        : fanCurvePoints(c, angleFactor(c, a.angle)),
      color: a.color,
      dash: a.reverse,
    }));
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Левая панель — список вентиляторов рудника */}
      <div className="flex flex-col border-r border-gray-200" style={{ width: 220, flexShrink: 0 }}>
        {/* Шапка */}
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 flex-shrink-0" style={{ background: "#e8eef8" }}>
          <span className="text-[11px] font-semibold text-gray-700">Вентиляторы рудника</span>
          <button onClick={() => setShowLibrary(true)}
            className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800">
            <Icon name="Library" size={11} /> Из библиотеки
          </button>
        </div>

        {/* Список */}
        <div className="flex-1 overflow-y-auto">
          {fans.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-3 gap-2 py-8">
              <Icon name="Wind" size={28} className="text-gray-300" />
              <span className="text-[12px] text-gray-500 text-center">Справочник пуст</span>
              <span className="text-[10px] text-gray-400 text-center">Импортируйте вентиляторы из библиотеки</span>
              <button onClick={() => setShowLibrary(true)}
                className="mt-1 px-3 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
                <Icon name="Library" size={11} /> Открыть библиотеку
              </button>
            </div>
          ) : fans.map(f => (
            <div key={f.id}
              onClick={() => setSelectedId(f.id)}
              className="group flex items-start justify-between px-2 py-2 cursor-pointer border-b border-gray-50 select-none hover:bg-blue-50"
              style={{ background: selectedId === f.id ? "#dbeafe" : undefined }}>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-blue-800 truncate">{f.name}</div>
                <div className="text-[10px] text-gray-500">{f.type} · Ø{f.diameter} м</div>
                <div className="text-[10px] text-gray-400">{f.bladeAngles.length} хар-ик</div>
              </div>
              <button onClick={e => { e.stopPropagation(); removeFan(f.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 ml-1 mt-0.5">
                <Icon name="Trash2" size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Кнопка добавить */}
        {fans.length > 0 && (
          <button onClick={() => setShowLibrary(true)}
            className="flex-shrink-0 flex items-center justify-center gap-1 py-2 text-[11px] text-blue-600 hover:bg-blue-50 border-t border-gray-200">
            <Icon name="Plus" size={11} /> Добавить из библиотеки
          </button>
        )}
      </div>

      {/* Правая панель */}
      {selected && catalog ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Шапка */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
            <span className="text-[13px] font-bold text-gray-900">{selected.name}</span>
            <span className="text-[11px] text-gray-500">Ø{selected.diameter} м</span>
            <span className="text-[10px] text-gray-400">·</span>
            <span className="text-[11px] text-gray-500">{selected.type}</span>
            <span className="text-[10px] text-gray-400 ml-1">{selected.rpmMin}–{selected.rpmMax} об/мин</span>
            {catalog.reverseH0 !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[10px] rounded font-medium">✓ Реверс</span>
            )}
            <button onClick={() => selected && setAddAngleFor(selected)}
              className="ml-auto flex items-center gap-1 h-6 px-2 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700">
              <Icon name="Plus" size={11} /> Характеристика
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Таблица характеристик */}
            <div className="flex flex-col border-r border-gray-200 flex-shrink-0" style={{ width: 240 }}>
              <div className="grid text-[10px] font-semibold text-gray-600 border-b border-gray-200 px-1 py-1.5 select-none"
                style={{ background: "#f0f4f8", gridTemplateColumns: "14px 42px 36px 64px 22px" }}>
                <div />
                <div>Угол</div>
                <div className="text-center">Реверс</div>
                <div>Об/мин</div>
                <div />
              </div>
              <div className="flex-1 overflow-y-auto">
                {selected.bladeAngles.length === 0 ? (
                  <div className="flex items-center justify-center h-20 text-[11px] text-gray-400">
                    Нет характеристик
                  </div>
                ) : selected.bladeAngles.map(a => (
                  <div key={a.id}
                    className="grid items-center gap-0.5 px-1 py-1.5 border-b border-gray-100 hover:bg-gray-50"
                    style={{ gridTemplateColumns: "14px 42px 36px 64px 22px" }}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
                    {/* Угол */}
                    {catalog.bladeAngles.length > 0 ? (
                      <select value={a.angle}
                        onChange={e => updateAngle(selected.id, a.id, { angle: +e.target.value })}
                        className="text-[10px] border border-gray-300 rounded px-0.5 py-0.5 w-full text-gray-900 bg-white">
                        {catalog.bladeAngles.map(ba => <option key={ba} value={ba}>{ba > 0 ? "+" : ""}{ba}°</option>)}
                      </select>
                    ) : (
                      <input type="number" value={a.angle}
                        onChange={e => updateAngle(selected.id, a.id, { angle: +e.target.value })}
                        className="text-[10px] border border-gray-300 rounded px-1 py-0.5 w-full text-gray-900 text-right" />
                    )}
                    {/* Реверс */}
                    <div className="flex justify-center">
                      <input type="checkbox" checked={a.reverse}
                        onChange={e => updateAngle(selected.id, a.id, { reverse: e.target.checked })}
                        className="w-3.5 h-3.5" style={{ accentColor: "#9333ea" }} />
                    </div>
                    {/* Об/мин */}
                    <input type="number" value={a.rpm} min={selected.rpmMin} max={selected.rpmMax} step={10}
                      onChange={e => updateAngle(selected.id, a.id, { rpm: +e.target.value })}
                      className="text-[10px] border border-gray-300 rounded px-1 py-0.5 w-full text-gray-900 text-right" />
                    {/* Удалить */}
                    <button onClick={() => removeAngle(selected.id, a.id)}
                      className="text-gray-300 hover:text-red-500 flex justify-center">
                      <Icon name="X" size={11} />
                    </button>
                  </div>
                ))}
              </div>
              {/* Рабочие точки */}
              {selected.bladeAngles.some(a => a.operatingQ) && (
                <div className="border-t border-gray-200 px-2 py-1.5 flex-shrink-0" style={{ background: "#fefce8" }}>
                  <div className="text-[10px] font-semibold text-yellow-800 mb-1">Рабочие точки</div>
                  {selected.bladeAngles.filter(a => a.operatingQ).map(a => (
                    <div key={a.id} className="flex items-center gap-1.5 mb-0.5">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: a.color }} />
                      <span className="text-[10px] text-gray-700">
                        {a.angle > 0 ? "+" : ""}{a.angle}°: Q={a.operatingQ} м³/с, H={a.operatingH} Па
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {/* Заметка */}
              <div className="border-t border-gray-200 px-2 py-1.5 flex-shrink-0">
                {editNote ? (
                  <textarea
                    autoFocus
                    value={selected.note ?? ""}
                    onChange={e => updateFans(fans.map(f => f.id === selected.id ? { ...f, note: e.target.value } : f))}
                    onBlur={() => setEditNote(false)}
                    className="w-full text-[10px] border border-blue-300 rounded px-1 py-0.5 text-gray-800 resize-none"
                    rows={2} placeholder="Заметка..." />
                ) : (
                  <div onClick={() => setEditNote(true)}
                    className="text-[10px] text-gray-400 cursor-text hover:text-gray-600 min-h-[24px]">
                    {selected.note || "Добавить заметку..."}
                  </div>
                )}
              </div>
            </div>

            {/* Графики */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {(() => {
                const curves = buildCurves(selected);
                const opPoints = selected.bladeAngles.filter(a => a.operatingQ).map(a => ({
                  q: a.operatingQ!, h: a.operatingH ?? 0, color: a.color,
                }));
                return (
                  <>
                    <div>
                      <div className="text-[11px] font-semibold text-gray-700 mb-1">Напор — Расход</div>
                      <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
                        <FanChart curves={curves} type="qh" operatingPoints={opPoints} />
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-gray-700 mb-1">Мощность — Расход</div>
                      <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
                        <FanChart curves={curves} type="qp" />
                      </div>
                    </div>
                    {/* Легенда */}
                    <div className="flex flex-wrap gap-2">
                      {selected.bladeAngles.map(a => (
                        <div key={a.id} className="flex items-center gap-1">
                          <div className="w-5 rounded" style={{
                            height: 2,
                            background: a.reverse ? undefined : a.color,
                            borderTop: a.reverse ? `2px dashed ${a.color}` : undefined,
                          }} />
                          <span className="text-[10px] text-gray-600">
                            {a.angle > 0 ? "+" : ""}{a.angle}°{a.reverse ? " (рев.)" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Инфо из каталога */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100 text-[11px]">
                      <div className="text-gray-500">Q раб.: <span className="text-gray-800">{catalog.qMin}–{catalog.qMax} м³/с</span></div>
                      <div className="text-gray-500">H max: <span className="text-gray-800">{Math.round(catalog.h0)} Па</span></div>
                      <div className="text-gray-500">Об/мин: <span className="text-gray-800">{catalog.rpmMin}–{catalog.rpmMax}</span></div>
                      {catalog.reverseH0 !== undefined && (
                        <div className="text-purple-700">Реверс: ~{Math.round((catalog.reverseEfficiencyFactor ?? 0.82) * 100)}% напора</div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400">
          <Icon name="Wind" size={32} className="text-gray-300" />
          <span className="text-[13px]">Выберите вентилятор из списка</span>
          <span className="text-[11px]">или импортируйте из библиотеки</span>
        </div>
      )}

      {/* Диалог библиотеки */}
      {showLibrary && (
        <LibraryDialog
          onSelect={importFromLibrary}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Диалог добавления характеристики */}
      {addAngleFor && (
        <AddAngleDialog
          fan={addAngleFor}
          onAdd={angle => addAngle(addAngleFor.id, angle)}
          onClose={() => setAddAngleFor(null)}
        />
      )}
    </div>
  );
}

// ─── Типы выработок: редактируемый справочник ─────────────────────────────

export interface BranchType {
  id: string;
  name: string;
  color: string;
  shape: "round" | "rect" | "arch" | "trap";
  surface: string;
  area: number;   // м² (типовое значение)
  vMax: number;   // м/с
  alphaCoef: number; // ×10⁻⁴
}

const SHAPE_LABELS: Record<string, string> = {
  round: "Круглое", rect: "Прямоугольное", arch: "Арочное", trap: "Трапециевидное",
};

const SURFACE_OPTIONS = [
  "ГИ, Жесткий металлический",
  "БШПУ, Буровзрывная проходка",
  "ГИ, Буровзрывная проходка",
  "Бетонная крепь гладкая",
  "Деревянная крепь, рамная",
  "Металлическая арочная крепь",
  "Анкерная крепь",
  "Незакреплённая, ровная порода",
  "Ствол с тюбинговой крепью",
  "Ствол со скиповым подъёмом",
];

// Справочник пустой — пользователь заполняет сам для своего рудника
const DEFAULT_BRANCH_TYPES: BranchType[] = [];

const EMPTY_TYPE: Omit<BranchType, "id"> = {
  name: "", color: "#3b82f6", shape: "arch", surface: SURFACE_OPTIONS[0], area: 10, vMax: 8, alphaCoef: 30,
};

function TypesSection({ initialTypes = [], onBranchTypesChange }: {
  initialTypes?: BranchType[];
  onBranchTypesChange?: (types: BranchType[]) => void;
}) {
  const [types, setTypes] = useState<BranchType[]>(initialTypes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Omit<BranchType, "id">>(EMPTY_TYPE);
  const [newName, setNewName] = useState("");
  const nextId = useCallback(() => `t${Date.now()}`, []);

  const updateTypes = (next: BranchType[]) => {
    setTypes(next);
    onBranchTypesChange?.(next);
  };

  const selected = types.find(t => t.id === selectedId) ?? null;

  const startEdit = (t: BranchType) => {
    setEditForm({ name: t.name, color: t.color, shape: t.shape, surface: t.surface, area: t.area, vMax: t.vMax, alphaCoef: t.alphaCoef });
    setIsEditing(true);
  };
  const saveEdit = () => {
    if (!selectedId) return;
    updateTypes(types.map(t => t.id === selectedId ? { ...t, ...editForm } : t));
    setIsEditing(false);
  };
  const cancelEdit = () => setIsEditing(false);

  const selectRow = (t: BranchType) => {
    if (isEditing) cancelEdit();
    setSelectedId(t.id);
  };

  const addType = () => {
    const name = newName.trim();
    if (!name) return;
    const t: BranchType = { id: nextId(), ...EMPTY_TYPE, name };
    updateTypes([...types, t]);
    setNewName("");
    setSelectedId(t.id);
    setEditForm({ ...EMPTY_TYPE, name });
    setIsEditing(true);
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    updateTypes(types.filter(t => t.id !== selectedId));
    setSelectedId(null);
    setIsEditing(false);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Список типов */}
      <div className="flex flex-col border-r border-gray-200" style={{ width: 380 }}>
        {/* Шапка */}
        <div className="grid text-[11px] font-semibold text-gray-700 border-b border-gray-300 flex-shrink-0 select-none"
          style={{ background: "#e8eef8", gridTemplateColumns: "28px 1fr 52px 80px 44px 44px 48px" }}>
          <div className="px-1 py-1.5" />
          <div className="px-2 py-1.5">Название</div>
          <div className="px-1 py-1.5 text-center">Цвет</div>
          <div className="px-1 py-1.5">Сечение</div>
          <div className="px-1 py-1.5 text-right">S, м²</div>
          <div className="px-1 py-1.5 text-right">V, м/с</div>
          <div className="px-1 py-1.5 text-right">α×10⁻⁴</div>
        </div>

        {/* Строки */}
        <div className="flex-1 overflow-y-auto">
          {types.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 py-12">
              <Icon name="Layers" size={32} className="text-gray-300" />
              <span className="text-[13px] font-medium text-gray-500">Справочник пуст</span>
              <span className="text-[11px] text-gray-400 text-center px-6">
                Добавьте типы выработок вашего рудника — введите название ниже и нажмите «Добавить»
              </span>
            </div>
          )}
          {types.map((t, i) => {
            const isSel = t.id === selectedId;
            return (
              <div key={t.id}
                className="grid items-center border-b border-gray-100 cursor-pointer select-none"
                style={{
                  gridTemplateColumns: "28px 1fr 52px 80px 44px 44px 48px",
                  minHeight: 28,
                  background: isSel ? "#dbeafe" : i % 2 === 0 ? "#fafafa" : "#fff",
                  outline: isSel ? "1px solid #3b82f6" : "none",
                }}
                onClick={() => selectRow(t)}>
                <button className="flex items-center justify-center w-full h-full hover:text-red-500 text-gray-300"
                  onClick={e => { e.stopPropagation(); const next = types.filter(x => x.id !== t.id); updateTypes(next); if (selectedId === t.id) { setSelectedId(null); setIsEditing(false); } }}>
                  <Icon name="Trash2" size={11} />
                </button>
                <span className="px-2 text-[12px] text-gray-900 font-medium truncate">{t.name}</span>
                <div className="flex items-center justify-center px-1">
                  <div className="w-7 h-4 rounded border border-gray-300" style={{ background: t.color }} />
                </div>
                <span className="px-1 text-[11px] text-gray-800">{SHAPE_LABELS[t.shape]}</span>
                <span className="px-1 text-[11px] text-gray-800 text-right">{t.area}</span>
                <span className="px-1 text-[11px] text-gray-800 text-right">{t.vMax}</span>
                <span className="px-1 text-[11px] text-gray-800 text-right">{t.alphaCoef}</span>
              </div>
            );
          })}
        </div>

        {/* Добавление */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-gray-300 flex-shrink-0" style={{ background: "#f0f0f0" }}>
          <input className="flex-1 text-[12px] border border-gray-300 rounded px-2 py-1 bg-white text-gray-900"
            placeholder="Укажите название нового типа"
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addType()} />
          <button onClick={addType}
            className="h-7 px-3 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
            <Icon name="Plus" size={11} /> Добавить
          </button>
        </div>
      </div>

      {/* Правая панель: просмотр / редактирование */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <>
            {/* Заголовок панели */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
              <div className="w-6 h-6 rounded border border-gray-300 flex-shrink-0" style={{ background: isEditing ? editForm.color : selected.color }} />
              <span className="text-[13px] font-semibold text-gray-900 truncate">
                {isEditing ? (editForm.name || "Новый тип") : selected.name}
              </span>
              {!isEditing ? (
                <>
                  <button onClick={() => startEdit(selected)}
                    className="ml-auto h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-blue-50 text-gray-700 flex items-center gap-1">
                    <Icon name="Edit2" size={11} /> Изменить
                  </button>
                  <button onClick={deleteSelected}
                    className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50 flex items-center gap-1">
                    <Icon name="Trash2" size={11} /> Удалить
                  </button>
                </>
              ) : (
                <>
                  <button onClick={saveEdit}
                    className="ml-auto h-6 px-3 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700">
                    Сохранить
                  </button>
                  <button onClick={cancelEdit}
                    className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
                    Отмена
                  </button>
                </>
              )}
            </div>

            {/* Поля */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {isEditing ? (
                <>
                  <EditField label="Название">
                    <input autoFocus className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white"
                      value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && saveEdit()} />
                  </EditField>
                  <EditField label="Цвет линии на схеме">
                    <div className="flex items-center gap-2">
                      <input type="color" value={editForm.color}
                        onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                        className="w-10 h-8 border border-gray-300 rounded cursor-pointer" />
                      <span className="text-[12px] text-gray-600">{editForm.color}</span>
                    </div>
                  </EditField>
                  <EditField label="Форма сечения">
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white"
                      value={editForm.shape} onChange={e => setEditForm(f => ({ ...f, shape: e.target.value as BranchType["shape"] }))}>
                      {Object.entries(SHAPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </EditField>
                  <EditField label="Поверхность / крепь">
                    <select className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white"
                      value={editForm.surface} onChange={e => setEditForm(f => ({ ...f, surface: e.target.value }))}>
                      {SURFACE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </EditField>
                  <div className="grid grid-cols-3 gap-3">
                    <EditField label="S, м²">
                      <input type="number" min={0} step={0.1}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white"
                        value={editForm.area} onChange={e => setEditForm(f => ({ ...f, area: parseFloat(e.target.value) || 0 }))} />
                    </EditField>
                    <EditField label="Vmax, м/с">
                      <input type="number" min={0} step={1}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white"
                        value={editForm.vMax} onChange={e => setEditForm(f => ({ ...f, vMax: parseFloat(e.target.value) || 0 }))} />
                    </EditField>
                    <EditField label="α ×10⁻⁴">
                      <input type="number" min={0} step={1}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white"
                        value={editForm.alphaCoef} onChange={e => setEditForm(f => ({ ...f, alphaCoef: parseFloat(e.target.value) || 0 }))} />
                    </EditField>
                  </div>
                </>
              ) : (
                <>
                  <ViewRow label="Форма сечения">{SHAPE_LABELS[selected.shape]}</ViewRow>
                  <ViewRow label="Поверхность / крепь">{selected.surface}</ViewRow>
                  <ViewRow label="Типовая площадь">{selected.area} м²</ViewRow>
                  <ViewRow label="Vmax">{selected.vMax} м/с</ViewRow>
                  <ViewRow label="Коэф. α">{selected.alphaCoef} ×10⁻⁴</ViewRow>
                  <ViewRow label="Цвет">
                    <span className="inline-flex items-center gap-2">
                      <span className="w-6 h-4 rounded border border-gray-300 inline-block" style={{ background: selected.color }} />
                      <span className="text-gray-600 text-[12px]">{selected.color}</span>
                    </span>
                  </ViewRow>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400">
            <Icon name="MousePointer2" size={28} className="text-gray-300" />
            <span className="text-[13px]">Выберите тип выработки</span>
            <span className="text-[11px]">Нажмите строку, затем «Изменить» для редактирования</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function ViewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-gray-100">
      <span className="text-[12px] text-gray-500 w-40 flex-shrink-0">{label}</span>
      <span className="text-[13px] text-gray-900 font-medium">{children}</span>
    </div>
  );
}


// ─── Справочник перемычек ─────────────────────────────────────────────────────
function rFmt(r: number): string {
  if (r >= 1_000_000) return `${(r / 1_000_000).toFixed(1)} ММюрг`;
  if (r >= 1_000) return `${Math.round(r / 1_000)} кМюрг`;
  return `${Math.round(r)} Мюрг`;
}

function BulkheadsSection({ onMineBulkheadsChange, initialMineBulkheads }: { onMineBulkheadsChange?: (b: MineBulkheadExport[]) => void; initialMineBulkheads?: MineBulkheadExport[] }) {
  const [mineBulkheads, setMineBulkheads] = useState<MineBulkheadExport[]>(() => {
    if (initialMineBulkheads && initialMineBulkheads.length > 0) return initialMineBulkheads;
    // Автоматически загружаем весь каталог при первом открытии
    return BULKHEAD_CATALOG.map(item => ({
      id: `mb_${item.id}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability),
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    }));
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<BulkheadType | "all">("all");
  const [editForm, setEditForm] = useState<Partial<MineBulkheadExport>>({});

  const selected = mineBulkheads.find(b => b.id === selectedId) ?? null;

  // Уведомляем родителя об начальном состоянии при монтировании
  useEffect(() => {
    if (!initialMineBulkheads || initialMineBulkheads.length === 0) {
      onMineBulkheadsChange?.(mineBulkheads);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const notify = (list: MineBulkheadExport[]) => {
    setMineBulkheads(list);
    onMineBulkheadsChange?.(list);
  };

  const importFromCatalog = (item: BulkheadCatalogItem) => {
    const ex: MineBulkheadExport = {
      id: `mb_${item.id}_${Date.now()}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability),
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    };
    const next = [...mineBulkheads, ex];
    notify(next);
    setSelectedId(ex.id);
    setShowCatalog(false);
  };

  const startEdit = (b: MineBulkheadExport) => {
    setEditForm({ ...b });
    setIsEditing(true);
  };

  const saveEdit = () => {
    const next = mineBulkheads.map(b => b.id === selectedId ? { ...b, ...editForm } as MineBulkheadExport : b);
    notify(next);
    setIsEditing(false);
  };

  const deleteBulkhead = (id: string) => {
    const next = mineBulkheads.filter(b => b.id !== id);
    notify(next);
    if (selectedId === id) { setSelectedId(null); setIsEditing(false); }
  };

  const addCustom = () => {
    const ex: MineBulkheadExport = {
      id: `mb_custom_${Date.now()}`,
      name: "Новая перемычка",
      type: "custom",
      airPermeability: 0.001,
      rMkyurg: 1_000_000,
      failurePressure: 0,
      note: "",
      color: "#546e7a",
      isCustom: true,
    };
    const next = [...mineBulkheads, ex];
    notify(next);
    setSelectedId(ex.id);
    setEditForm({ ...ex });
    setIsEditing(true);
  };

  // Каталог с фильтрацией
  const catalogList = BULKHEAD_CATALOG.filter(c =>
    (catalogFilter === "all" || c.type === catalogFilter) &&
    c.name.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Левая панель — список рудника */}
      <div className="flex flex-col border-r border-gray-200" style={{ width: 260, flexShrink: 0 }}>
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 flex-shrink-0" style={{ background: "#e8eef8" }}>
          <span className="text-[11px] font-semibold text-gray-700">Перемычки рудника</span>
          <div className="flex gap-1">
            <button onClick={() => setShowCatalog(true)}
              className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800">
              <Icon name="Library" size={11} /> Каталог
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {mineBulkheads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-3 gap-2 py-8">
              <Icon name="Square" size={28} className="text-gray-300" />
              <span className="text-[12px] text-gray-500 text-center">Справочник пуст</span>
              <span className="text-[10px] text-gray-400 text-center">Добавьте перемычки из каталога</span>
              <button onClick={() => setShowCatalog(true)}
                className="mt-1 px-3 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
                <Icon name="Library" size={11} /> Открыть каталог
              </button>
            </div>
          ) : mineBulkheads.map(b => (
            <div key={b.id}
              onClick={() => { setSelectedId(b.id); setIsEditing(false); }}
              className="group flex items-start justify-between px-2 py-2 cursor-pointer border-b border-gray-50 select-none hover:bg-blue-50"
              style={{ background: selectedId === b.id ? "#dbeafe" : undefined }}>
              <div className="flex items-start gap-1.5 flex-1 min-w-0">
                <div className="w-3 h-3 rounded-sm flex-shrink-0 mt-0.5" style={{ background: b.color }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-gray-900 truncate">{b.name}</div>
                  <div className="text-[10px] text-gray-500">{BULKHEAD_TYPE_LABELS[b.type]}</div>
                  <div className="text-[10px] text-gray-400">R = {rFmt(b.rMkyurg)}</div>
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); deleteBulkhead(b.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 ml-1 mt-0.5 flex-shrink-0">
                <Icon name="Trash2" size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-1 px-2 py-1.5 border-t border-gray-200 flex-shrink-0" style={{ background: "#f0f0f0" }}>
          <button onClick={() => setShowCatalog(true)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] text-blue-600 hover:bg-blue-50 rounded border border-blue-300">
            <Icon name="Plus" size={11} /> Из каталога
          </button>
          <button onClick={addCustom}
            className="flex items-center justify-center gap-1 py-1 px-2 text-[11px] text-gray-600 hover:bg-gray-100 rounded border border-gray-300">
            <Icon name="Edit3" size={11} /> Своя
          </button>
        </div>
      </div>

      {/* Правая панель */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Шапка */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
            <div className="w-5 h-5 rounded-sm border border-gray-300 flex-shrink-0" style={{ background: selected.color }} />
            <span className="text-[13px] font-bold text-gray-900 truncate flex-1">
              {isEditing ? (editForm.name || "Перемычка") : selected.name}
            </span>
            {!isEditing ? (
              <>
                <button onClick={() => startEdit(selected)}
                  className="ml-auto h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-blue-50 text-gray-700 flex items-center gap-1">
                  <Icon name="Edit2" size={11} /> Изменить
                </button>
                <button onClick={() => deleteBulkhead(selected.id)}
                  className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50 flex items-center gap-1">
                  <Icon name="Trash2" size={11} /> Удалить
                </button>
              </>
            ) : (
              <>
                <button onClick={saveEdit}
                  className="ml-auto h-6 px-3 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700">
                  Сохранить
                </button>
                <button onClick={() => setIsEditing(false)}
                  className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
                  Отмена
                </button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {isEditing ? (
              <>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Название</label>
                  <input value={editForm.name ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white" />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Тип</label>
                  <select value={editForm.type ?? "solid"}
                    onChange={e => setEditForm(f => ({ ...f, type: e.target.value as BulkheadType }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white">
                    {(Object.entries(BULKHEAD_TYPE_LABELS) as [BulkheadType, string][]).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Воздухопроницаемость A, м²/(с·√Па)</label>
                    <input type="number" min={0} step={0.0001} value={editForm.airPermeability ?? 0}
                      onChange={e => {
                        const A = parseFloat(e.target.value) || 0;
                        setEditForm(f => ({ ...f, airPermeability: A, rMkyurg: airPermToR(A) }));
                      }}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">R, Мюрг (авто)</label>
                    <div className="px-2 py-1.5 bg-gray-50 rounded border border-gray-200 text-[13px] text-gray-700 font-medium">
                      {rFmt(editForm.rMkyurg ?? 0)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Давление разрушения, МПа</label>
                    <input type="number" min={0} step={0.01} value={editForm.failurePressure ?? 0}
                      onChange={e => setEditForm(f => ({ ...f, failurePressure: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Цвет</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={editForm.color ?? "#546e7a"}
                        onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))}
                        className="w-10 h-8 border border-gray-300 rounded cursor-pointer" />
                      <span className="text-[12px] text-gray-500">{editForm.color}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">Примечание</label>
                  <input value={editForm.note ?? ""}
                    onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-[13px] text-gray-900 bg-white" />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium text-white"
                    style={{ background: BULKHEAD_TYPE_COLORS[selected.type] }}>
                    {BULKHEAD_TYPE_LABELS[selected.type]}
                  </span>
                  {selected.isCustom && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600">Пользовательская</span>
                  )}
                </div>
                {[
                  ["Воздухопроницаемость", `${selected.airPermeability.toFixed(6)} м²/(с·√Па)`],
                  ["Сопротивление R", rFmt(selected.rMkyurg)],
                  ["Давление разрушения", selected.failurePressure > 0 ? `${selected.failurePressure} МПа` : "Не нормируется"],
                  ["Примечание", selected.note || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start gap-3 py-1.5 border-b border-gray-100">
                    <span className="text-[12px] text-gray-500 w-44 flex-shrink-0">{label}</span>
                    <span className="text-[13px] text-gray-900 font-medium">{value}</span>
                  </div>
                ))}
                <div className="mt-3 p-3 rounded-lg text-[11px] text-blue-800" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                  Чтобы применить перемычку к выработке — выберите ветвь на схеме и укажите перемычку в панели свойств ветви.
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400">
          <Icon name="Square" size={32} className="text-gray-300" />
          <span className="text-[13px]">Выберите перемычку из списка</span>
          <span className="text-[11px]">или добавьте из каталога</span>
        </div>
      )}

      {/* Диалог каталога */}
      {showCatalog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
          <div className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden" style={{ width: 720, height: 540 }}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 flex-shrink-0" style={{ background: "#f0f4f8" }}>
              <Icon name="Library" size={14} className="text-blue-600" />
              <span className="text-[13px] font-semibold text-gray-800">Каталог перемычек</span>
              <button onClick={() => setShowCatalog(false)} className="ml-auto text-gray-400 hover:text-gray-700">
                <Icon name="X" size={16} />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Фильтры */}
              <div className="flex flex-col border-r border-gray-200 flex-shrink-0 p-2 gap-1.5" style={{ width: 170 }}>
                <span className="text-[10px] font-semibold text-gray-500 uppercase">Тип</span>
                {([["all", "Все"], ...Object.entries(BULKHEAD_TYPE_LABELS)] as [string, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setCatalogFilter(v as BulkheadType | "all")}
                    className="text-left px-2 py-1 text-[11px] rounded"
                    style={{
                      background: catalogFilter === v ? "#2563eb" : "white",
                      color: catalogFilter === v ? "white" : "#374151",
                      border: `1px solid ${catalogFilter === v ? "#2563eb" : "#e5e7eb"}`,
                    }}>
                    {l}
                  </button>
                ))}
              </div>
              {/* Список */}
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 flex-shrink-0">
                  <Icon name="Search" size={12} className="text-gray-400" />
                  <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)}
                    placeholder="Поиск..." className="flex-1 text-[12px] py-0.5 outline-none text-gray-900 bg-transparent" />
                </div>
                <div className="flex-1 overflow-y-auto">
                  {/* Шапка */}
                  <div className="grid text-[10px] font-semibold text-gray-600 px-2 py-1 border-b border-gray-200 sticky top-0"
                    style={{ background: "#e8eef8", gridTemplateColumns: "14px 1fr 110px 90px 80px" }}>
                    <div />
                    <div>Название</div>
                    <div className="text-right">A, м²/(с·√Па)</div>
                    <div className="text-right">R</div>
                    <div className="text-right">P разр.</div>
                  </div>
                  {catalogList.map(item => {
                    const already = mineBulkheads.some(b => b.id.includes(item.id));
                    return (
                      <div key={item.id}
                        className="grid items-center gap-1 px-2 py-1.5 border-b border-gray-50 hover:bg-blue-50 cursor-pointer select-none"
                        style={{ gridTemplateColumns: "14px 1fr 110px 90px 80px" }}
                        onClick={() => !already && importFromCatalog(item)}>
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: item.color }} />
                        <div>
                          <div className="text-[11px] text-gray-900">{item.name}</div>
                          <div className="text-[9px] text-gray-400">{BULKHEAD_TYPE_LABELS[item.type]}</div>
                        </div>
                        <div className="text-[10px] text-gray-600 text-right">{item.airPermeability.toFixed(6)}</div>
                        <div className="text-[10px] text-gray-700 text-right font-medium">{rFmt(airPermToR(item.airPermeability))}</div>
                        <div className="text-right">
                          {already ? (
                            <span className="text-[9px] text-green-600 font-medium">✓ добавлена</span>
                          ) : item.failurePressure > 0 ? (
                            <span className="text-[10px] text-gray-500">{item.failurePressure} МПа</span>
                          ) : (
                            <span className="text-[10px] text-gray-300">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {catalogList.length === 0 && (
                    <div className="flex items-center justify-center h-24 text-[12px] text-gray-400">Не найдено</div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center px-4 py-2 border-t border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
              <span className="text-[11px] text-gray-500 flex-1">Нажмите на строку для добавления в справочник рудника</span>
              <button onClick={() => setShowCatalog(false)}
                className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const DEMO_SENSORS = [
  { name: "МС-1М", measure: "CH₄", range: "0–4%", cls: "1A", note: "" },
  { name: "МТ-5", measure: "CO", range: "0–100 ppm", cls: "1A", note: "" },
  { name: "АТ-6", measure: "Температура", range: "-40..+80°C", cls: "1B", note: "" },
  { name: "ВКМ-1", measure: "Скорость", range: "0–25 м/с", cls: "2A", note: "Анемометр" },
];
const DEMO_TYPICAL = [
  { name: "Задымление (пожар)", steps: 7, resp: "Нач. смены", dur: "15 мин" },
  { name: "Превышение CH₄ > 1%", steps: 5, resp: "Мастер ВТБ", dur: "10 мин" },
  { name: "Отказ ГВУ", steps: 4, resp: "Гл. механик", dur: "20 мин" },
];
const DEMO_PUMPS = [
  { name: "ЦНС-60-264", type: "Центробежный", q: "60 м³/ч", h: "264 м", power: "75 кВт" },
  { name: "ЦНС-300-120", type: "Центробежный", q: "300 м³/ч", h: "120 м", power: "132 кВт" },
];
const DEMO_PIPES = [
  { name: "Сталь Ст20", dn: "DN50", wall: "4 мм", p: "16 бар" },
  { name: "Сталь Ст20", dn: "DN100", wall: "5 мм", p: "16 бар" },
  { name: "ПВД (полиэтилен)", dn: "DN50", wall: "4.6 мм", p: "10 бар" },
];
interface MineVehicle {
  name: string;
  type: string;
  tonnage?: string;
  rubber: number;
  diesel: number;
  oil: number;
}

const MINE_VEHICLES: MineVehicle[] = [
  { name: "Sandvik TH315",        type: "Самосвал",          tonnage: "15 т",  rubber: 780,  diesel: 260, oil: 160 },
  { name: "Sandvik TH430",        type: "Самосвал",          tonnage: "30 т",  rubber: 1200, diesel: 400, oil: 220 },
  { name: "Sandvik TH540",        type: "Самосвал",          tonnage: "40 т",  rubber: 1500, diesel: 520, oil: 280 },
  { name: "Sandvik LH203",        type: "ПДМ",               tonnage: "2 т",   rubber: 260,  diesel: 100, oil: 70  },
  { name: "Sandvik LH307",        type: "ПДМ",               tonnage: "7 т",   rubber: 520,  diesel: 180, oil: 110 },
  { name: "Sandvik LH514",        type: "ПДМ",               tonnage: "14 т",  rubber: 900,  diesel: 280, oil: 180 },
  { name: "Epiroc ST7 Scooptram", type: "ПДМ",               tonnage: "6.8 т", rubber: 480,  diesel: 170, oil: 120 },
  { name: "Epiroc ST14 Scooptram",type: "ПДМ",               tonnage: "14 т",  rubber: 900,  diesel: 280, oil: 200 },
  { name: "Epiroc MT42",          type: "Самосвал",          tonnage: "42 т",  rubber: 1600, diesel: 550, oil: 300 },
  { name: "Caterpillar R1300G",   type: "ПДМ",               tonnage: "13 т",  rubber: 850,  diesel: 260, oil: 180 },
  { name: "Caterpillar R1600H",   type: "ПДМ",               tonnage: "16 т",  rubber: 950,  diesel: 290, oil: 210 },
  { name: "Caterpillar AD22",     type: "Самосвал",          tonnage: "22 т",  rubber: 1000, diesel: 340, oil: 200 },
  { name: "Caterpillar AD45B",    type: "Самосвал",          tonnage: "41 т",  rubber: 1500, diesel: 530, oil: 290 },
  { name: "Komatsu WJ-5",         type: "ПДМ",               tonnage: "5 т",   rubber: 400,  diesel: 150, oil: 95  },
  { name: "Normet Spraymec",      type: "Набрызг-машина",    tonnage: undefined, rubber: 360, diesel: 140, oil: 90  },
  { name: "Epiroc Boomer T1D",    type: "Буровая установка", tonnage: undefined, rubber: 800, diesel: 290, oil: 240 },
  { name: "Epiroc Boltec LC",     type: "Анкеровщик",       tonnage: undefined, rubber: 480, diesel: 180, oil: 140 },
  { name: "TH-545",               type: "Самосвал",          tonnage: "45 т",  rubber: 1200, diesel: 400, oil: 200 },
  { name: "БелАЗ-7555",           type: "Самосвал карьерный",tonnage: "55 т",  rubber: 2000, diesel: 700, oil: 400 },
];

function VehicleCatalogSection() {
  const [search, setSearch] = useState("");
  const filtered = MINE_VEHICLES.filter(v =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.type.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div style={{ background: "#fff", minHeight: "100%", padding: "12px" }}>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", fontSize: 14 }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию или типу..."
          style={{
            width: "100%", boxSizing: "border-box",
            background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8,
            color: "#111827", fontSize: 12, padding: "8px 10px 8px 32px", outline: "none",
          }}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {filtered.map((v, i) => (
          <div key={i} style={{
            background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px",
            cursor: "default",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ color: "#111827", fontWeight: 600, fontSize: 13 }}>{v.name}</div>
                <div style={{ color: "#6b7280", fontSize: 11, marginTop: 1 }}>
                  {v.type}{v.tonnage ? ` · ${v.tonnage}` : ""}
                </div>
              </div>
              <span style={{ color: "#d1d5db", fontSize: 14 }}>›</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 8 }}>
              {[
                { label: "РЕЗИНА", val: v.rubber, color: "#374151" },
                { label: "ДИЗЕЛЬ", val: v.diesel, color: "#2563eb" },
                { label: "МАСЛО",  val: v.oil,    color: "#ea580c" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: "#eef2f7", borderRadius: 6, padding: "5px 6px" }}>
                  <div style={{ color: "#9ca3af", fontSize: 9, fontWeight: 600, letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ color, fontSize: 16, fontWeight: 700, lineHeight: 1.1 }}>{val}</div>
                  <div style={{ color: "#9ca3af", fontSize: 9 }}>КГ</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ color: "#9ca3af", fontSize: 10, marginTop: 12, textAlign: "center", fontStyle: "italic" }}>
        Данные приблизительные. После выбора можно скорректировать значения вручную.
      </div>
    </div>
  );
}

const DEMO_TRANSPORT = [
  { name: "Вагонетка ВГ-3.3", type: "Рельсовый", cap: "3.3 м³", v: "3.5 м/с" },
  { name: "Конвейер 1Л100У", type: "Ленточный", cap: "250 т/ч", v: "2.5 м/с" },
];

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-1 text-left text-[11px] font-semibold text-gray-700 border-b border-gray-300 select-none whitespace-nowrap" style={{ background: "#e8eef8" }}>{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1 text-[11px] text-gray-800 border-b border-gray-100">{children}</td>;
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr>{headers.map(h => <Th key={h}>{h}</Th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }} className="hover:bg-blue-50 cursor-pointer">
            {r.map((c, j) => <Td key={j}>{c}</Td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TabContent({ tab, onMineFansChange, onMineBulkheadsChange, onBranchTypesChange, initialMineFans, initialBranchTypes, initialMineBulkheads, unitsConfig, onUnitsConfigChange }: {
  tab: TabId;
  onMineFansChange?: (fans: MineFanExport[]) => void;
  onMineBulkheadsChange?: (b: MineBulkheadExport[]) => void;
  onBranchTypesChange?: (types: BranchType[]) => void;
  initialMineFans?: MineFanExport[];
  initialBranchTypes?: BranchType[];
  initialMineBulkheads?: MineBulkheadExport[];
  unitsConfig?: UnitsConfig;
  onUnitsConfigChange?: (cfg: UnitsConfig) => void;
}) {
  if (tab === "fans") return <FansSection onMineFansChange={onMineFansChange} initialMineFans={initialMineFans} />;
  if (tab === "types") return <TypesSection initialTypes={initialBranchTypes} onBranchTypesChange={onBranchTypesChange} />;
  if (tab === "bulkheads") return <BulkheadsSection onMineBulkheadsChange={onMineBulkheadsChange} initialMineBulkheads={initialMineBulkheads} />;
  if (tab === "units") return <UnitsConfigPanel unitsConfig={unitsConfig ?? DEFAULT_UNITS_CONFIG} onChange={onUnitsConfigChange ?? (() => {})} />;
  if (tab === "sensors") return <SimpleTable
    headers={["Марка", "Измеряет", "Диапазон", "Класс", "Примечание"]}
    rows={DEMO_SENSORS.map(r => [r.name, r.measure, r.range, r.cls, r.note])} />;
  if (tab === "typical") return <SimpleTable
    headers={["Мероприятие", "Шагов", "Ответственный", "Время"]}
    rows={DEMO_TYPICAL.map(r => [r.name, r.steps, r.resp, r.dur])} />;
  if (tab === "pumps") return <SimpleTable
    headers={["Марка", "Тип", "Расход", "Напор", "Мощность"]}
    rows={DEMO_PUMPS.map(r => [r.name, r.type, r.q, r.h, r.power])} />;
  if (tab === "pipes") return <SimpleTable
    headers={["Материал", "DN", "Стенка", "Давление"]}
    rows={DEMO_PIPES.map(r => [r.name, r.dn, r.wall, r.p])} />;
  if (tab === "transport") return <VehicleCatalogSection />;
  return null;
}

export default function EquipmentRefDialog({ activeTab, onTabChange, onClose, onMineFansChange, onMineBulkheadsChange, onBranchTypesChange, initialMineFans, initialBranchTypes, initialMineBulkheads, unitsConfig, onUnitsConfigChange }: Props) {
  const currentTab = TABS.find(t => t.id === activeTab) ?? TABS[0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="flex flex-col shadow-2xl border border-gray-400"
        style={{ width: 900, height: 580, background: "#fff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}
        onClick={e => e.stopPropagation()}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
          <div className="flex items-center gap-2">
            <Icon name="BookOpen" size={13} className="text-blue-700" />
            <span className="text-[12px] font-semibold text-gray-800">Справочники — {currentTab.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-px h-5 bg-gray-300 mx-1" />
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
              <Icon name="X" size={12} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Левая навигация */}
          <div className="w-40 flex-shrink-0 border-r border-gray-300 overflow-y-auto" style={{ background: "#f0f0f0" }}>
            {["Вентиляция", "Аварии", "Трубопровод", "Общее"].map(group => (
              <div key={group}>
                <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200" style={{ background: "#e4e4e4" }}>{group}</div>
                {TABS.filter(t => t.group === group).map(tab => (
                  <button key={tab.id} onClick={() => onTabChange(tab.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-blue-100"
                    style={{ background: activeTab === tab.id ? "#2563eb" : "transparent", color: activeTab === tab.id ? "white" : "#333", fontWeight: activeTab === tab.id ? 600 : 400 }}>
                    <Icon name={tab.icon} size={13} className={activeTab === tab.id ? "text-white" : "text-gray-500"} fallback="Square" />
                    {tab.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Основная область */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-200 flex-shrink-0" style={{ background: "#f8f8f8" }}>
              <span className="text-[11px] font-semibold text-gray-700">{currentTab.label}</span>
              <div className="ml-auto flex gap-1">
                <button className="h-5 px-1.5 text-[10px] border border-gray-300 rounded hover:bg-gray-100 flex items-center gap-1">
                  <Icon name="Download" size={10} /> Экспорт
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <TabContent tab={activeTab} onMineFansChange={onMineFansChange} onMineBulkheadsChange={onMineBulkheadsChange} onBranchTypesChange={onBranchTypesChange} initialMineFans={initialMineFans} initialBranchTypes={initialBranchTypes} initialMineBulkheads={initialMineBulkheads} unitsConfig={unitsConfig} onUnitsConfigChange={onUnitsConfigChange} />
            </div>
            <div className="px-2 py-0.5 border-t border-gray-200 text-[10px] text-gray-400 flex-shrink-0" style={{ background: "#f0f0f0" }}>
              Дважды кликните по строке для редактирования характеристик
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}