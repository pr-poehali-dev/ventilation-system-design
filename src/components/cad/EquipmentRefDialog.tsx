// Справочник оборудования — аналог справочников в АэроСети
import { useState, useRef } from "react";
import Icon from "@/components/ui/icon";

type TabId = "fans" | "types" | "bulkheads" | "sensors" | "typical" | "pumps" | "pipes" | "transport";

interface Props {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  onClose: () => void;
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
];

// ─── Типы для Q-H характеристик ───────────────────────────────────────────
interface FanCurvePoint { q: number; h: number; p: number }
interface FanAngle {
  angle: number;       // угол лопаток, °
  reverse: boolean;
  rpm: number;
  color: string;
  points: FanCurvePoint[];  // Q[м³/с], H[Па], P[кВт]
}
interface FanModel {
  id: string;
  name: string;
  type: string;
  d: number;           // диаметр, м
  angles: FanAngle[];
}

const CURVE_COLORS = ["#e91e63", "#ff5722", "#ff9800", "#4caf50", "#2196f3"];

// Генератор точек кривой по параболической модели (Hmax, Qmax, Pmax)
function genCurve(Hmax: number, Qmax: number, Pmax: number, n = 10): FanCurvePoint[] {
  const pts: FanCurvePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = t * Qmax;
    const h = Hmax * (1 - (q / Qmax) ** 1.8);
    const p = Pmax * (0.3 + 1.4 * t - 0.7 * t * t);
    pts.push({ q: +q.toFixed(2), h: +Math.max(0, h).toFixed(0), p: +Math.max(0, p).toFixed(1) });
  }
  return pts;
}

// ─── Данные вентиляторов ──────────────────────────────────────────────────
const FAN_MODELS: FanModel[] = [
  {
    id: "vm6m", name: "ВМ-6М", type: "Осевой местного проветривания", d: 0.6,
    angles: [
      { angle: -45, reverse: false, rpm: 2980, color: CURVE_COLORS[0], points: genCurve(3000, 3.0, 12) },
      { angle: -20, reverse: false, rpm: 2980, color: CURVE_COLORS[1], points: genCurve(2600, 4.5, 14) },
      { angle:   0, reverse: false, rpm: 2980, color: CURVE_COLORS[2], points: genCurve(2200, 6.0, 16) },
      { angle:  20, reverse: false, rpm: 2980, color: CURVE_COLORS[3], points: genCurve(1800, 7.5, 18) },
      { angle:  45, reverse: false, rpm: 2980, color: CURVE_COLORS[4], points: genCurve(1400, 8.5, 20) },
    ],
  },
  {
    id: "vm8m", name: "ВМ-8М", type: "Осевой местного проветривания", d: 0.8,
    angles: [
      { angle: -50, reverse: false, rpm: 2980, color: CURVE_COLORS[0], points: genCurve(4500, 6,  35) },
      { angle: -20, reverse: false, rpm: 2980, color: CURVE_COLORS[1], points: genCurve(4000, 9,  45) },
      { angle:   0, reverse: false, rpm: 2980, color: CURVE_COLORS[2], points: genCurve(3500, 11, 55) },
      { angle:  20, reverse: false, rpm: 2980, color: CURVE_COLORS[3], points: genCurve(3000, 13, 65) },
      { angle:  45, reverse: false, rpm: 2980, color: CURVE_COLORS[4], points: genCurve(2500, 15, 75) },
    ],
  },
  {
    id: "vod21", name: "ВОД-21", type: "Осевой главного проветривания", d: 2.1,
    angles: [
      { angle: -30, reverse: false, rpm: 500, color: CURVE_COLORS[0], points: genCurve(2500, 70, 900) },
      { angle: -15, reverse: false, rpm: 500, color: CURVE_COLORS[1], points: genCurve(2200, 90, 1100) },
      { angle:   0, reverse: false, rpm: 500, color: CURVE_COLORS[2], points: genCurve(1900, 110, 1300) },
      { angle:  15, reverse: false, rpm: 500, color: CURVE_COLORS[3], points: genCurve(1600, 130, 1500) },
      { angle:  30, reverse: false, rpm: 500, color: CURVE_COLORS[4], points: genCurve(1400, 150, 1800) },
    ],
  },
  {
    id: "vcd47", name: "ВЦД-47У", type: "Центробежный главного проветривания", d: 4.7,
    angles: [
      { angle: -20, reverse: false, rpm: 375, color: CURVE_COLORS[0], points: genCurve(5000, 80,  2500) },
      { angle:  -5, reverse: false, rpm: 375, color: CURVE_COLORS[1], points: genCurve(4500, 120, 3000) },
      { angle:  10, reverse: false, rpm: 375, color: CURVE_COLORS[2], points: genCurve(4000, 160, 3500) },
      { angle:  20, reverse: false, rpm: 375, color: CURVE_COLORS[3], points: genCurve(3500, 200, 4000) },
      { angle:  30, reverse: false, rpm: 375, color: CURVE_COLORS[4], points: genCurve(3000, 240, 4500) },
    ],
  },
];

// ─── Q-H График ───────────────────────────────────────────────────────────
function QHChart({ model, type }: { model: FanModel; type: "qh" | "qp" }) {
  const W = 320, H = 180, PL = 42, PR = 10, PT = 10, PB = 28;
  const cw = W - PL - PR;
  const ch = H - PT - PB;

  const allPts = model.angles.flatMap(a => a.points);
  const maxQ = Math.max(...allPts.map(p => p.q)) * 1.05;
  const maxV = type === "qh"
    ? Math.max(...allPts.map(p => p.h)) * 1.1
    : Math.max(...allPts.map(p => p.p)) * 1.1;

  const toX = (q: number) => PL + (q / maxQ) * cw;
  const toY = (v: number) => PT + ch - (v / maxV) * ch;

  const yLabel = type === "qh" ? "Напор, Па" : "Мощность, кВт";
  const yTicks = 5;
  const xTicks = 5;

  return (
    <svg width={W} height={H} style={{ fontFamily: "Arial, sans-serif" }}>
      {/* Сетка */}
      {Array.from({ length: yTicks + 1 }).map((_, i) => {
        const y = PT + (i / yTicks) * ch;
        const val = maxV * (1 - i / yTicks);
        return (
          <g key={i}>
            <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e0e0e0" strokeWidth="0.5" />
            <text x={PL - 3} y={y + 3} fontSize="8" textAnchor="end" fill="#666">
              {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
            </text>
          </g>
        );
      })}
      {Array.from({ length: xTicks + 1 }).map((_, i) => {
        const x = PL + (i / xTicks) * cw;
        const val = maxQ * (i / xTicks);
        return (
          <g key={i}>
            <line x1={x} y1={PT} x2={x} y2={PT + ch} stroke="#e0e0e0" strokeWidth="0.5" />
            <text x={x} y={H - 6} fontSize="8" textAnchor="middle" fill="#666">{val.toFixed(0)}</text>
          </g>
        );
      })}
      {/* Рамка */}
      <rect x={PL} y={PT} width={cw} height={ch} fill="none" stroke="#bbb" strokeWidth="0.8" />
      {/* Кривые */}
      {model.angles.map(angle => {
        const pts = angle.points.map(p => ({
          x: toX(p.q), y: toY(type === "qh" ? p.h : p.p),
        }));
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        return (
          <path key={angle.angle} d={d} fill="none"
            stroke={angle.color} strokeWidth="1.8" strokeLinejoin="round" />
        );
      })}
      {/* Подписи осей */}
      <text x={PL + cw / 2} y={H - 1} fontSize="8" textAnchor="middle" fill="#555">
        Расход воздуха, м³/с
      </text>
      <text transform={`translate(10,${PT + ch / 2}) rotate(-90)`}
        fontSize="8" textAnchor="middle" fill="#555">{yLabel}</text>
    </svg>
  );
}

// ─── Секция вентиляторов ──────────────────────────────────────────────────
function FansSection() {
  const [selectedId, setSelectedId] = useState(FAN_MODELS[0].id);
  const [editAngles, setEditAngles] = useState<FanAngle[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("Осевой");
  const [newD, setNewD] = useState("0.6");

  const model = FAN_MODELS.find(m => m.id === selectedId) ?? FAN_MODELS[0];
  const angles = editAngles ?? model.angles;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Список моделей */}
      <div className="flex-shrink-0 border-b border-gray-200 overflow-y-auto" style={{ maxHeight: 120 }}>
        {FAN_MODELS.map(m => (
          <div key={m.id}
            onClick={() => { setSelectedId(m.id); setEditAngles(null); }}
            className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-blue-50 select-none"
            style={{ background: selectedId === m.id ? "#dbeafe" : "transparent", borderBottom: "1px solid #f0f0f0" }}>
            <div>
              <span className="text-[12px] font-semibold text-blue-800">{m.name}</span>
              <span className="text-[10px] text-gray-500 ml-2">{m.type}</span>
            </div>
            <span className="text-[10px] text-gray-400">Ø{m.d} м</span>
          </div>
        ))}
        <button onClick={() => setShowAdd(true)}
          className="w-full py-1 text-[11px] text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1">
          <Icon name="Plus" size={11} /> Добавить вентилятор
        </button>
      </div>

      {/* Диалог добавления */}
      {showAdd && (
        <div className="flex-shrink-0 border-b border-gray-200 p-2 bg-blue-50">
          <div className="text-[11px] font-semibold mb-1">Новая модель</div>
          <div className="flex gap-2 mb-1">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Название (напр. ВМ-10)" className="flex-1 text-[11px] px-1.5 py-0.5 border border-gray-300 rounded" />
            <input value={newD} onChange={e => setNewD(e.target.value)}
              placeholder="Ø м" className="w-16 text-[11px] px-1.5 py-0.5 border border-gray-300 rounded" />
          </div>
          <select value={newType} onChange={e => setNewType(e.target.value)}
            className="w-full text-[11px] px-1 py-0.5 border border-gray-300 rounded mb-1">
            <option>Осевой</option>
            <option>Центробежный</option>
            <option>Осевой местного проветривания</option>
            <option>Центробежный главного проветривания</option>
          </select>
          <div className="flex gap-1">
            <button onClick={() => setShowAdd(false)}
              className="flex-1 py-0.5 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700">
              Добавить (демо)
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-2 py-0.5 text-[11px] border border-gray-300 rounded hover:bg-gray-100">
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Таблица углов + графики */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex gap-0 min-h-0">
          {/* Таблица углов лопаток */}
          <div className="flex-shrink-0" style={{ width: 220, borderRight: "1px solid #e5e7eb" }}>
            <div className="flex items-center px-2 py-1 border-b border-gray-200" style={{ background: "#f0f4f8" }}>
              <span className="text-[10px] font-semibold text-gray-600 flex-1">Угол лопаток</span>
              <span className="text-[10px] text-gray-500 w-10 text-center">Реверс</span>
              <span className="text-[10px] text-gray-500 flex-1 text-right">Скорость</span>
            </div>
            {angles.map((a, i) => (
              <div key={i} className="flex items-center px-2 py-1 border-b border-gray-100 hover:bg-gray-50">
                {/* Цветной маркер */}
                <div className="w-3 h-3 rounded-sm flex-shrink-0 mr-1.5"
                  style={{ background: a.color, border: `1.5px solid ${a.color}` }} />
                <input
                  type="number"
                  value={a.angle}
                  onChange={e => {
                    const next = angles.map((x, j) => j === i ? { ...x, angle: +e.target.value } : x);
                    setEditAngles(next);
                  }}
                  className="w-14 text-[11px] px-1 border border-gray-300 rounded text-right"
                  style={{ fontFamily: "inherit" }}
                />
                <span className="text-[10px] text-gray-500 ml-0.5">°</span>
                <div className="flex-1 flex justify-center">
                  <input type="checkbox" checked={a.reverse}
                    onChange={e => {
                      const next = angles.map((x, j) => j === i ? { ...x, reverse: e.target.checked } : x);
                      setEditAngles(next);
                    }}
                    style={{ accentColor: "#2563eb" }} />
                </div>
                <span className="text-[11px] text-gray-700 text-right">{a.rpm} об/мин</span>
              </div>
            ))}
            <button
              onClick={() => {
                const next = [...angles, {
                  angle: 0, reverse: false, rpm: 2980,
                  color: CURVE_COLORS[angles.length % CURVE_COLORS.length],
                  points: genCurve(2000, 6, 15),
                }];
                setEditAngles(next);
              }}
              className="w-full py-1 text-[11px] text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1 border-t border-gray-100">
              <Icon name="Plus" size={10} /> Новая характеристика
            </button>
          </div>

          {/* Графики */}
          <div className="flex-1 flex flex-col p-2 gap-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-semibold text-gray-700">{model.name}</span>
              <span className="text-[10px] text-gray-400">Ø{model.d} м</span>
              <span className="text-[10px] text-gray-400">·</span>
              <span className="text-[10px] text-gray-500">{model.type}</span>
            </div>
            <div className="flex gap-3 flex-wrap">
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Напор — Расход</div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                  <QHChart model={{ ...model, angles }} type="qh" />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-gray-500 mb-0.5 font-medium">Мощность — Расход</div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 4, overflow: "hidden" }}>
                  <QHChart model={{ ...model, angles }} type="qp" />
                </div>
              </div>
            </div>
            {/* Легенда */}
            <div className="flex flex-wrap gap-2 mt-1">
              {angles.map((a, i) => (
                <div key={i} className="flex items-center gap-1">
                  <div className="w-4 h-1.5 rounded-sm" style={{ background: a.color }} />
                  <span className="text-[10px] text-gray-600">{a.angle > 0 ? "+" : ""}{a.angle}°</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Прочие таблицы (остальные вкладки) ──────────────────────────────────
const DEMO_TYPES = [
  { name: "Ствол вертикальный", shape: "Круглый", d: "3–7 м", alpha: "0.004–0.012", vMax: 12 },
  { name: "Штрек горизонтальный", shape: "Прямоугольный", d: "3.5×3 м", alpha: "0.008–0.015", vMax: 6 },
  { name: "Квершлаг", shape: "Арочный", d: "4×3 м", alpha: "0.006–0.012", vMax: 8 },
  { name: "Уклон/бремсберг", shape: "Прямоугольный", d: "3×2.5 м", alpha: "0.010–0.020", vMax: 8 },
  { name: "Горная камера", shape: "Прямоугольный", d: "6×5 м", alpha: "0.005–0.010", vMax: 4 },
];
const DEMO_BULKHEADS = [
  { name: "Бетонная перемычка", type: "Глухая", r: ">10000", note: "ГОСТ 12.3.022" },
  { name: "Шлакобетонная", type: "Глухая", r: ">5000", note: "" },
  { name: "Кирпичная", type: "Глухая", r: ">3000", note: "" },
  { name: "Деревянная с обшивкой", type: "Временная", r: "100–500", note: "" },
  { name: "Металлическая дверь", type: "С шибером", r: "50–200", note: "Регулируемое R" },
];
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

function TabContent({ tab }: { tab: TabId }) {
  if (tab === "fans") return <FansSection />;
  if (tab === "types") return <SimpleTable
    headers={["Тип выработки", "Форма", "Размер", "α×10⁻⁴", "Vmax м/с"]}
    rows={DEMO_TYPES.map(r => [r.name, r.shape, r.d, r.alpha, r.vMax])} />;
  if (tab === "bulkheads") return <SimpleTable
    headers={["Название", "Тип", "R, кМюрг", "Примечание"]}
    rows={DEMO_BULKHEADS.map(r => [r.name, r.type, r.r, r.note])} />;
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
  if (tab === "transport") return <SimpleTable
    headers={["Наименование", "Тип", "Ёмкость", "Скорость"]}
    rows={DEMO_TRANSPORT.map(r => [r.name, r.type, r.cap, r.v])} />;
  return null;
}

export default function EquipmentRefDialog({ activeTab, onTabChange, onClose }: Props) {
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
            <button className="h-6 px-2 text-[11px] border border-gray-400 rounded hover:bg-blue-50 flex items-center gap-1">
              <Icon name="Plus" size={11} /> Добавить
            </button>
            <button className="h-6 px-2 text-[11px] border border-gray-400 rounded hover:bg-blue-50 flex items-center gap-1">
              <Icon name="Edit2" size={11} /> Изменить
            </button>
            <button className="h-6 px-2 text-[11px] border border-red-300 rounded hover:bg-red-50 text-red-600 flex items-center gap-1">
              <Icon name="Trash2" size={11} /> Удалить
            </button>
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
              <TabContent tab={activeTab} />
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
