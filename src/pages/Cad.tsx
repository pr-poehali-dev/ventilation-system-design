import { useState, useRef } from "react";
import Icon from "@/components/ui/icon";

// ─────────────────────────────────────────────────────────────────────────────
// CAD-интерфейс шахтной/вентиляционной сети в стиле инженерного ПО
// (АэроСеть / Вентиляция-CAD): ribbon-меню + вертикальные вкладки + свойства
// ─────────────────────────────────────────────────────────────────────────────

type RibbonTab = "file" | "home" | "view" | "schema" | "vent" | "thermo" | "accidents" | "involve" | "pipes" | "costs" | "refs" | "general";
type SideTab = "general" | "vent" | "thermo" | "accidents" | "areas" | "indicators" | "coords";

interface Excavation {
  id: string;
  type: string;
  section: "round" | "rect" | "trap";
  area: number;        // м²
  perimeter: number;   // м
  length: number;      // м
  alphaCoef: number;   // кг/м³
  vMax: number;        // м/с
  resistance: number;  // кМюрг
  flow: number;        // м³/с
  velocity: number;    // м/с
  dP: number;          // Па
  power: number;       // Вт
  surface: string;
}

const DEFAULT_EXC: Excavation = {
  id: "EXC-001",
  type: "Ствол ЮВС",
  section: "round",
  area: 38.5,
  perimeter: 22,
  length: 276,
  alphaCoef: 0.009,
  vMax: 15,
  resistance: 0.000098,
  flow: 211,
  velocity: 5.5,
  dP: 43,
  power: 9002,
  surface: "Воздухоподающая выработка, без неровностей",
};

export default function CadPage() {
  const [activeRibbon, setActiveRibbon] = useState<RibbonTab>("home");
  const [activeSide, setActiveSide] = useState<SideTab>("vent");
  const [excavation, setExcavation] = useState<Excavation>(DEFAULT_EXC);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div className="w-screen h-screen flex flex-col"
      style={{ background: "#f0f0f0", fontFamily: "Segoe UI, Tahoma, sans-serif", fontSize: "12px", color: "#1f1f1f" }}>

      {/* ═══ TITLE BAR ════════════════════════════════════════════════════ */}
      <div className="h-7 flex items-center justify-between px-2 select-none"
        style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)", borderBottom: "1px solid #b8b8b8" }}>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-sm flex items-center justify-center"
            style={{ background: "#2563eb", color: "white", fontSize: "10px", fontWeight: "bold" }}>В</div>
          <span className="text-xs font-medium">Вентиляция-CAD — Проект1.vproj</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">—</button>
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">▢</button>
          <button className="w-7 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs">✕</button>
        </div>
      </div>

      {/* ═══ RIBBON TABS ══════════════════════════════════════════════════ */}
      <div className="flex items-end h-7 px-1 gap-0.5"
        style={{ background: "#f0f0f0", borderBottom: "1px solid #b8b8b8" }}>
        <RibbonTabBtn label="Файл" active={activeRibbon === "file"} onClick={() => setActiveRibbon("file")} fileStyle />
        <RibbonTabBtn label="Главная" active={activeRibbon === "home"} onClick={() => setActiveRibbon("home")} />
        <RibbonTabBtn label="Просмотр" active={activeRibbon === "view"} onClick={() => setActiveRibbon("view")} />
        <RibbonTabBtn label="Вид" active={activeRibbon === "schema"} onClick={() => setActiveRibbon("schema")} />
        <RibbonTabBtn label="Схема" active={activeRibbon === "vent"} onClick={() => setActiveRibbon("vent")} />
        <RibbonTabBtn label="Вентиляция" active={activeRibbon === "thermo"} onClick={() => setActiveRibbon("thermo")} />
        <RibbonTabBtn label="Теплофизика" active={activeRibbon === "accidents"} onClick={() => setActiveRibbon("accidents")} />
        <RibbonTabBtn label="Аварии" active={activeRibbon === "involve"} onClick={() => setActiveRibbon("involve")} />
        <RibbonTabBtn label="Задействование" active={activeRibbon === "pipes"} onClick={() => setActiveRibbon("pipes")} />
        <RibbonTabBtn label="Трубы" active={activeRibbon === "costs"} onClick={() => setActiveRibbon("costs")} />
        <RibbonTabBtn label="Затраты" active={activeRibbon === "refs"} onClick={() => setActiveRibbon("refs")} />
        <RibbonTabBtn label="Справочники" active={activeRibbon === "general"} onClick={() => setActiveRibbon("general")} />
        <RibbonTabBtn label="Общее" active={false} onClick={() => {}} highlight />
        <div className="ml-auto pr-2 pb-0.5">
          <button className="w-5 h-5 hover:bg-black/10 flex items-center justify-center"
            title="Свернуть ленту">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3 L5 7 L9 3" stroke="#444" fill="none" strokeWidth="1.2" /></svg>
          </button>
        </div>
      </div>

      {/* ═══ RIBBON CONTENT ═══════════════════════════════════════════════ */}
      <div className="h-[92px] flex items-stretch px-1 py-1 gap-0.5"
        style={{ background: "linear-gradient(180deg,#fafafa,#ececec)", borderBottom: "1px solid #b8b8b8" }}>

        {/* ── Группа: Объекты ── */}
        <RibbonGroup label="Объекты">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Plus" label="Добавить" sublabel="выработку" />
            <RibbonBigBtn icon="Scissors" label="Разделить" sublabel="выработку" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">
              <RibbonSmallBtn>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                  style={{ background: "#5fb3d9", color: "white" }}>59</div>
              </RibbonSmallBtn>
              <RibbonSmallBtn><span className="font-serif text-base">T</span></RibbonSmallBtn>
              <RibbonSmallBtn><PentagonIcon /></RibbonSmallBtn>
              <RibbonSmallBtn><RectIcon /></RibbonSmallBtn>
            </div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4].map((i) => <RibbonSmallBtn key={i}><MiniSquareIcon variant={i} /></RibbonSmallBtn>)}
            </div>
          </div>
        </RibbonGroup>

        {/* ── Группа: Объекты на выработках ── */}
        <RibbonGroup label="Объекты на выработках">
          <div className="grid grid-rows-2 grid-flow-col gap-0.5">
            {[
              "Pause", "Wind", "DoorOpen", "Square", "Circle", "Octagon", "Hexagon",
              "ArrowRight", "ArrowLeftRight", "ArrowUpRight", "Cog", "Fan", "Filter",
              "Triangle", "Diamond", "Pentagon", "MoveRight", "MoveDown", "Pipette", "Wrench",
            ].map((ic, i) => (
              <button key={i}
                className="w-6 h-6 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded flex items-center justify-center"
                title={`Объект ${i + 1}`}>
                <Icon name={ic} size={12} className="text-gray-700" fallback="Square" />
              </button>
            ))}
          </div>
        </RibbonGroup>

        {/* ── Группа: Действия с объектами ── */}
        <RibbonGroup label="Действия с объектами">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="MousePointer2" label="Выделить" sublabel="объект" />
            <RibbonBigBtn icon="Filter" label="Наложить" sublabel="фильтр" />
            <RibbonBigBtn icon="Undo2" label="Отменить" sublabel="действие" />
            <RibbonBigBtn icon="Trash2" label="Удалить" sublabel="" />
            <RibbonBigBtn icon="ChevronUp" label="Переместить" sublabel="вверх" />
            <RibbonBigBtn icon="ChevronDown" label="Переместить" sublabel="вниз" />
            <RibbonBigBtn icon="FileEdit" label="Редактировать" sublabel="" />
            <RibbonBigBtn icon="Maximize2" label="Увеличить" sublabel="" />
            <RibbonBigBtn icon="Minimize2" label="Уменьшить" sublabel="" />
          </div>
        </RibbonGroup>

        {/* ── Группа: Буфер обмена ── */}
        <RibbonGroup label="Буфер обмена">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="ClipboardPaste" label="Вставить" sublabel="" disabled />
            <RibbonBigBtn icon="Scissors" label="Вырезать" sublabel="" />
            <RibbonBigBtn icon="Copy" label="Копировать" sublabel="" />
          </div>
        </RibbonGroup>
      </div>

      {/* ═══ MAIN AREA ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── ВЕРТИКАЛЬНЫЕ ВКЛАДКИ СЛЕВА ────────────────────────────── */}
        <div className="w-6 flex flex-col"
          style={{ background: "#e8e8e8", borderRight: "1px solid #b8b8b8" }}>
          {([
            { id: "general", label: "Общие" },
            { id: "vent", label: "Вентиляция" },
            { id: "thermo", label: "Теплофизика" },
            { id: "accidents", label: "Аварии" },
            { id: "areas", label: "Участки" },
            { id: "indicators", label: "Индикаторы" },
            { id: "coords", label: "Координаты" },
          ] as { id: SideTab; label: string }[]).map((t) => (
            <button key={t.id}
              onClick={() => setActiveSide(t.id)}
              className="h-24 flex items-center justify-center transition-colors"
              style={{
                background: activeSide === t.id ? "#ffffff" : "transparent",
                borderRight: activeSide === t.id ? "1px solid #ffffff" : "1px solid transparent",
                marginRight: activeSide === t.id ? "-1px" : "0",
                borderTop: activeSide === t.id ? "1px solid #b8b8b8" : "none",
                borderBottom: activeSide === t.id ? "1px solid #b8b8b8" : "none",
              }}>
              <span className="text-[11px] tracking-wide"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  color: activeSide === t.id ? "#2563eb" : "#444",
                  fontWeight: activeSide === t.id ? 600 : 400,
                }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* ── ПАНЕЛЬ СВОЙСТВ ─────────────────────────────────────────── */}
        <div className="w-[330px] flex flex-col"
          style={{ background: "#ffffff", borderRight: "1px solid #b8b8b8" }}>

          {/* Селектор объекта */}
          <div className="px-1 py-1" style={{ borderBottom: "1px solid #d0d0d0" }}>
            <div className="flex items-center gap-1">
              <button className="w-4 h-4 hover:bg-black/10 flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M5 1 L1 4 L5 7" stroke="#444" fill="none" strokeWidth="1.2" /></svg>
              </button>
              <select className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white">
                <option>Свойства</option>
                <option>Стиль отображения</option>
                <option>Слои</option>
              </select>
            </div>
          </div>

          {/* Заголовок секции */}
          <div className="px-2 py-1.5 border-b border-gray-300">
            <span className="text-xs font-semibold text-gray-800">Аэродинамическое сопротивление</span>
          </div>

          {/* Свойства */}
          <div className="flex-1 overflow-y-auto">
            <PropGroup title="Тип выработки">
              <SelectRow value={excavation.type} options={["Ствол ЮВС", "Ствол СВС", "Квершлаг", "Штрек", "Уклон", "Камера"]}
                onChange={(v) => setExcavation({ ...excavation, type: v })} />
            </PropGroup>

            <PropGroup title="Поперечное сечение">
              <SelectRow value="Круглое" options={["Круглое", "Прямоугольное", "Трапециевидное", "Арочное"]}
                onChange={() => {}} />
              <FieldRow label="Площадь:" value={`${excavation.area} м²`} />
              <CheckRow label="Тип:" caption="Задается вручную" />
              <FieldRow label="Периметр:" value={`${excavation.perimeter} м`} />
            </PropGroup>

            <PropGroup title="Длина выработки">
              <CheckRow label="Тип:" caption="Задается вручную" />
              <FieldRow label="Длина:" value={`${excavation.length} м`} />
            </PropGroup>

            <PropGroup title="Аэродинамическое сопротивление">
              <SelectRowLabeled label="Задается:" value="Проектными данными"
                options={["Проектными данными", "По коэффициенту α", "По таблице ВНИИ", "Измеренное"]}
                onChange={() => {}} />
              <SelectRowLabeled label="Поверхность:" value={excavation.surface}
                options={["Воздухоподающая выработка, без неровностей", "Бетонная крепь", "Деревянная крепь", "Анкерная крепь", "Незакреплённая"]}
                onChange={(v) => setExcavation({ ...excavation, surface: v })} />
              <FieldRow label="Коэф-т α:" value={`${excavation.alphaCoef.toFixed(3)} кг/м³`} />
            </PropGroup>

            <PropGroup title="Скорость воздуха">
              <CheckRow label="Тип:" caption="Задается вручную" />
              <FieldRow label="V max:" value={`${excavation.vMax} м/с`} />
            </PropGroup>

            <PropGroup title="Вычисленные параметры">
              <FieldRow label="Сопротив-ие:" value={`${excavation.resistance.toFixed(6)} кМюрг`} computed />
              <FieldRow label="Расход:" value={`${excavation.flow} м³/с`} computed />
              <FieldRow label="V воздуха:" value={`${excavation.velocity} м/с`} computed />
              <FieldRow label="ΔP:" value={`${excavation.dP} Па`} computed />
              <FieldRow label="Энергозат-ы:" value={`${excavation.power} Вт`} computed />
            </PropGroup>
          </div>
        </div>

        {/* ── РАБОЧАЯ ОБЛАСТЬ (CANVAS) ──────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden"
          ref={canvasRef}
          style={{ background: "#ffffff" }}>

          {/* Сетка */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <defs>
              <pattern id="cad-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
              </pattern>
              <pattern id="cad-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
                <rect width="100" height="100" fill="url(#cad-grid)" />
                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#e0e0e0" strokeWidth="0.8" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#cad-grid-major)" />
          </svg>

          {/* Координатные оси (CAD-style) */}
          <div className="absolute bottom-3 left-3 flex items-end gap-0 pointer-events-none">
            <div className="flex flex-col items-center">
              <div className="text-[10px] font-mono text-blue-600 mb-0.5">Y</div>
              <div className="w-[2px] h-8" style={{ background: "#22c55e" }}></div>
            </div>
            <div className="flex items-center">
              <div className="w-2 h-2 rounded-full" style={{ background: "#1f1f1f" }}></div>
              <div className="h-[2px] w-8" style={{ background: "#ef4444" }}></div>
              <div className="text-[10px] font-mono text-red-600 ml-0.5">X</div>
            </div>
          </div>

          {/* Подсказка пустой области */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-gray-400">
              <Icon name="MousePointer2" size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Рабочая область</p>
              <p className="text-xs mt-1">Используйте «Добавить выработку» для создания объектов</p>
            </div>
          </div>

          {/* Zoom-контролы */}
          <div className="absolute top-2 right-2 flex flex-col gap-0.5">
            <button onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
              className="w-6 h-6 bg-white border border-gray-400 hover:bg-gray-100 flex items-center justify-center">
              <Icon name="Plus" size={12} />
            </button>
            <button onClick={() => setZoom(1)}
              className="w-6 h-6 bg-white border border-gray-400 hover:bg-gray-100 flex items-center justify-center text-[9px] font-mono">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
              className="w-6 h-6 bg-white border border-gray-400 hover:bg-gray-100 flex items-center justify-center">
              <Icon name="Minus" size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ STATUS BAR ═══════════════════════════════════════════════════ */}
      <div className="h-5 flex items-center justify-between px-2 text-[11px]"
        style={{ background: "#f0f0f0", borderTop: "1px solid #b8b8b8", color: "#444" }}>
        <div className="flex items-center gap-3">
          <span>Готово</span>
          <span className="text-gray-400">|</span>
          <span>Объект: <b>{excavation.id}</b></span>
          <span className="text-gray-400">|</span>
          <span>X: 0.00  Y: 0.00  Z: 0.00</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Сетка: 1 м</span>
          <span className="text-gray-400">|</span>
          <span>Масштаб: {Math.round(zoom * 100)}%</span>
          <span className="text-gray-400">|</span>
          <span style={{ color: "#16a34a" }}>● Расчёт актуален</span>
        </div>
      </div>
    </div>
  );
}

// ─── Ribbon-компоненты ──────────────────────────────────────────────────────

function RibbonTabBtn({ label, active, onClick, fileStyle, highlight }: {
  label: string; active: boolean; onClick: () => void; fileStyle?: boolean; highlight?: boolean;
}) {
  if (fileStyle) {
    return (
      <button onClick={onClick}
        className="px-3 h-6 text-xs text-white rounded-t-sm hover:brightness-110"
        style={{ background: "#2563eb", fontWeight: 500 }}>
        {label}
      </button>
    );
  }
  return (
    <button onClick={onClick}
      className="px-3 h-6 text-xs rounded-t-sm transition-colors"
      style={{
        background: active ? "#fafafa" : "transparent",
        borderTop: active ? "1px solid #b8b8b8" : "1px solid transparent",
        borderLeft: active ? "1px solid #b8b8b8" : "1px solid transparent",
        borderRight: active ? "1px solid #b8b8b8" : "1px solid transparent",
        marginBottom: active ? "-1px" : "0",
        color: highlight ? "#2563eb" : "#1f1f1f",
        fontWeight: active || highlight ? 600 : 400,
      }}>
      {label}
    </button>
  );
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-stretch gap-1 px-1.5 pb-0.5">
        {children}
      </div>
      <div className="text-[10px] text-center text-gray-600 border-t border-gray-300 pt-0.5">{label}</div>
      <div style={{ width: "1px", background: "#d0d0d0", position: "absolute" }} />
    </div>
  );
}

function RibbonBigBtn({ icon, label, sublabel, disabled }: {
  icon: string; label: string; sublabel: string; disabled?: boolean;
}) {
  return (
    <button disabled={disabled}
      className="px-1.5 py-0.5 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded flex flex-col items-center justify-start gap-0.5 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-transparent min-w-[50px]"
      style={{ height: "100%" }}>
      <Icon name={icon} size={22} className="text-gray-700 mt-0.5" fallback="Square" />
      <div className="text-[10px] leading-tight text-center text-gray-800">
        <div>{label}</div>
        {sublabel && <div>{sublabel}</div>}
      </div>
    </button>
  );
}

function RibbonSmallBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="w-7 h-7 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded flex items-center justify-center">
      {children}
    </button>
  );
}

function PentagonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 1 L15 6 L12 14 L4 14 L1 6 Z" fill="none" stroke="#444" strokeWidth="1.2" />
    </svg>
  );
}
function RectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="10" fill="none" stroke="#444" strokeWidth="1.2" />
    </svg>
  );
}
function MiniSquareIcon({ variant }: { variant: number }) {
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect x="2" y="2" width="10" height="10" fill={colors[variant - 1]} opacity="0.6" stroke={colors[variant - 1]} />
    </svg>
  );
}

// ─── Свойства ───────────────────────────────────────────────────────────────

function PropGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 py-1 text-xs font-semibold text-gray-800"
        style={{ background: "#f5f5f5", borderTop: "1px solid #e0e0e0", borderBottom: "1px solid #e0e0e0" }}>
        {title}
      </div>
      <div className="px-2 py-1 space-y-0.5">{children}</div>
    </div>
  );
}

function SelectRow({ value, options, onChange }: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

function SelectRowLabeled({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none min-w-0">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FieldRow({ label, value, computed }: { label: string; value: string; computed?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <input type="text" value={value} readOnly
        className="flex-1 text-xs px-1 py-0.5 border bg-white text-right font-mono"
        style={{
          borderColor: computed ? "#d0d0d0" : "#a0a0a0",
          background: computed ? "#fafafa" : "white",
          color: computed ? "#1f1f1f" : "#1f1f1f",
          fontWeight: computed ? 600 : 400,
        }} />
    </div>
  );
}

function CheckRow({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="checkbox" className="w-3 h-3" />
        <span className="text-xs text-gray-700">{caption}</span>
      </label>
    </div>
  );
}