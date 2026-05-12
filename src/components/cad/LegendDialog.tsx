// Условные обозначения — аналог из АэроСети / Вентиляция
import { useState } from "react";
import Icon from "@/components/ui/icon";

interface Props {
  onClose: () => void;
}

interface LegendItem {
  id: string;
  name: string;
  svg: React.ReactNode;
  group: string;
}

// ─── SVG-символы условных обозначений ────────────────────────────────────
const ITEMS: LegendItem[] = [
  // ── ОБЩИЕ ──
  {
    id: "building", group: "Общие", name: "Надшахтное здание",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={10} width={36} height={26} fill="none" stroke="#222" strokeWidth="1.5" />
      <line x1={6} y1={10} x2={24} y2={2} stroke="#222" strokeWidth="1.5" />
      <line x1={42} y1={10} x2={24} y2={2} stroke="#222" strokeWidth="1.5" />
      <line x1={6} y1={10} x2={42} y2={36} stroke="#222" strokeWidth="1" />
      <line x1={42} y1={10} x2={6} y2={36} stroke="#222" strokeWidth="1" />
    </svg>,
  },
  {
    id: "medical", group: "Общие", name: "Медицинский пункт",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="none" stroke="#c00" strokeWidth="1.5" />
      <line x1={24} y1={8} x2={24} y2={32} stroke="#c00" strokeWidth="2.5" />
      <line x1={12} y1={20} x2={36} y2={20} stroke="#c00" strokeWidth="2.5" />
    </svg>,
  },
  {
    id: "copra_tower", group: "Общие", name: "Копёр башенный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={16} y={2} width={16} height={36} fill="none" stroke="#222" strokeWidth="1.5" />
      <line x1={16} y1={12} x2={32} y2={12} stroke="#222" strokeWidth="1" />
      <line x1={16} y1={20} x2={32} y2={20} stroke="#222" strokeWidth="1" />
      <line x1={16} y1={28} x2={32} y2={28} stroke="#222" strokeWidth="1" />
      <rect x={20} y={30} width={8} height={8} fill="none" stroke="#222" strokeWidth="1" />
    </svg>,
  },
  {
    id: "copra_metal", group: "Общие", name: "Копёр металлический",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={24} y1={2} x2={8} y2={38} stroke="#222" strokeWidth="1.5" />
      <line x1={24} y1={2} x2={40} y2={38} stroke="#222" strokeWidth="1.5" />
      <rect x={14} y={8} width={20} height={20} fill="none" stroke="#222" strokeWidth="1" />
      <line x1={14} y1={14} x2={34} y2={14} stroke="#222" strokeWidth="0.8" />
      <line x1={14} y1={20} x2={34} y2={20} stroke="#222" strokeWidth="0.8" />
    </svg>,
  },
  {
    id: "turn_chamber", group: "Общие", name: "Камера разворота",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke="#222" strokeWidth="1.5" />
      <path d="M 24 8 A 12 12 0 1 0 36 20" fill="none" stroke="#222" strokeWidth="2" markerEnd="url(#arr)" />
      <path d="M 34 16 L 38 20 L 34 24" fill="none" stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "picket", group: "Общие", name: "Пикет",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke="#222" strokeWidth="1.5" />
      <text x={24} y={25} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#222">ПК</text>
    </svg>,
  },
  {
    id: "calorifer", group: "Общие", name: "Установка калориферная",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke="#222" strokeWidth="1.5" />
      <line x1={11} y1={10} x2={11} y2={30} stroke="#222" strokeWidth="1" />
      <line x1={18} y1={10} x2={18} y2={30} stroke="#222" strokeWidth="1" />
      <line x1={25} y1={10} x2={25} y2={30} stroke="#222" strokeWidth="1" />
      <line x1={32} y1={10} x2={32} y2={30} stroke="#222" strokeWidth="1" />
      <line x1={39} y1={10} x2={39} y2={30} stroke="#222" strokeWidth="1" />
    </svg>,
  },
  {
    id: "crossing_pipe", group: "Общие", name: "Кроссинг трубчатый",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth="2" />
      <line x1={24} y1={4} x2={24} y2={36} stroke="#222" strokeWidth="2" />
      <circle cx={24} cy={20} r={6} fill="white" stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "emergency_exit", group: "Общие", name: "Общешахтный запасной выход",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={6} width={18} height={28} fill="#ffd600" stroke="#222" strokeWidth="1" />
      <rect x={26} y={6} width={18} height={28} fill="#111" stroke="#222" strokeWidth="1" />
      <rect x={4} y={16} width={18} height={8} fill="#111" />
      <rect x={26} y={16} width={18} height={8} fill="#ffd600" />
    </svg>,
  },
  {
    id: "direction", group: "Общие", name: "Направление движения горноспасателей",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#111" strokeWidth="3" />
      <polygon points="36,13 48,20 36,27" fill="#111" />
    </svg>,
  },
  // ── ВЕНТИЛЯЦИЯ ──
  {
    id: "fresh_air", group: "Вентиляция", name: "Свежая струя воздуха",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#2196f3" strokeWidth="2.5" />
      <polygon points="36,14 46,20 36,26" fill="#2196f3" />
    </svg>,
  },
  {
    id: "exhaust_air", group: "Вентиляция", name: "Исходящая струя воздуха",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth="2.5" strokeDasharray="6 3" />
      <polygon points="36,14 46,20 36,26" fill="#dc2626" />
    </svg>,
  },
  {
    id: "fan", group: "Вентиляция", name: "Вентилятор",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={13} fill="none" stroke="#2563eb" strokeWidth="1.5" />
      <path d="M24,20 Q30,10 36,14 Q32,20 24,20Z" fill="#2563eb" opacity="0.7" />
      <path d="M24,20 Q14,16 12,8 Q20,10 24,20Z" fill="#2563eb" opacity="0.7" />
      <path d="M24,20 Q18,30 24,36 Q28,28 24,20Z" fill="#2563eb" opacity="0.7" />
      <circle cx={24} cy={20} r={3} fill="#2563eb" />
    </svg>,
  },
  {
    id: "bulkhead", group: "Вентиляция", name: "Перемычка глухая",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={10} x2={4} y2={30} stroke="#222" strokeWidth="3" />
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth="1.5" />
      <line x1={44} y1={10} x2={44} y2={30} stroke="#222" strokeWidth="3" />
    </svg>,
  },
  {
    id: "door", group: "Вентиляция", name: "Вентиляционная дверь",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={10} x2={4} y2={30} stroke="#222" strokeWidth="2" />
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth="1.5" />
      <line x1={44} y1={10} x2={44} y2={30} stroke="#222" strokeWidth="2" />
      <path d="M 4 15 Q 24 12 44 15" fill="none" stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "regulator", group: "Вентиляция", name: "Регулятор (шибер)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth="1.5" />
      <rect x={18} y={10} width={12} height={20} fill="#ffd600" stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "extinct_branch", group: "Вентиляция", name: "Выработка погашенная",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={14} x2={44} y2={14} stroke="#888" strokeWidth="1.5" />
      <line x1={4} y1={26} x2={44} y2={26} stroke="#888" strokeWidth="1.5" />
      <line x1={4} y1={14} x2={44} y2={26} stroke="#888" strokeWidth="1.5" />
      <line x1={44} y1={14} x2={4} y2={26} stroke="#888" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "break_branch", group: "Вентиляция", name: "Обрыв выработки",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={14} x2={44} y2={14} stroke="#222" strokeWidth="1.5" />
      <line x1={4} y1={26} x2={44} y2={26} stroke="#222" strokeWidth="1.5" />
      <line x1={44} y1={14} x2={30} y2={26} stroke="#222" strokeWidth="1.5" />
      <line x1={30} y1={14} x2={44} y2={26} stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  // ── УЗЛЫ ──
  {
    id: "node_normal", group: "Узлы", name: "Узел (сопряжение)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={8} fill="#c8a882" stroke="#1f2937" strokeWidth="1.5" />
      <text x={35} y={24} fontSize="10" fill="#1f2937" fontWeight="600">001</text>
    </svg>,
  },
  {
    id: "node_atm", group: "Узлы", name: "Узел-атмосфера (выход)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={8} fill="#7dd3fc" stroke="#1f2937" strokeWidth="1.5" />
      <circle cx={24} cy={20} r={5} fill="none" stroke="#1f2937" strokeWidth="1.2" strokeDasharray="2 1" />
    </svg>,
  },
  // ── ПРИБОРЫ ──
  {
    id: "sensor_gas", group: "Приборы", name: "Датчик метана",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={8} y={10} width={32} height={22} rx="3" fill="none" stroke="#222" strokeWidth="1.5" />
      <text x={24} y={25} textAnchor="middle" fontSize="10" fontWeight="bold" fill="#222">CH₄</text>
    </svg>,
  },
  {
    id: "sensor_wind", group: "Приборы", name: "Анемометр",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={13} fill="none" stroke="#222" strokeWidth="1.5" />
      <line x1={24} y1={7} x2={24} y2={20} stroke="#222" strokeWidth="1.2" />
      <line x1={24} y1={20} x2={35} y2={26} stroke="#222" strokeWidth="1.2" />
      <line x1={24} y1={20} x2={13} y2={26} stroke="#222" strokeWidth="1.2" />
      <circle cx={24} cy={20} r={2.5} fill="#222" />
    </svg>,
  },
  {
    id: "sound_alarm", group: "Приборы", name: "Звуковая аварийная сигнализация",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="8,14 22,14 30,8 30,32 22,26 8,26" fill="none" stroke="#222" strokeWidth="1.5" />
      <path d="M 32 14 Q 40 20 32 26" fill="none" stroke="#222" strokeWidth="1.5" />
      <path d="M 34 10 Q 46 20 34 30" fill="none" stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "conveyor", group: "Приборы", name: "Привод конвейера",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="4,28 44,16 44,22 4,34" fill="#555" />
      <circle cx={44} cy={19} r={5} fill="none" stroke="#222" strokeWidth="1.5" />
    </svg>,
  },
  {
    id: "positioner", group: "Приборы", name: "Считыватель позиционирования",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <path d="M 24 8 Q 38 14 38 20 Q 38 26 24 32 Q 10 26 10 20 Q 10 14 24 8" fill="none" stroke="#2196f3" strokeWidth="1.5" />
      <path d="M 24 12 Q 34 16 34 20 Q 34 24 24 28 Q 14 24 14 20 Q 14 16 24 12" fill="none" stroke="#2196f3" strokeWidth="1" />
      <circle cx={24} cy={20} r={3} fill="#2196f3" />
    </svg>,
  },
];

const GROUPS = [...new Set(ITEMS.map(i => i.group))];

export default function LegendDialog({ onClose }: Props) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("Все");

  const filtered = ITEMS.filter(item => {
    const matchGroup = activeGroup === "Все" || item.group === activeGroup;
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
    return matchGroup && matchSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="flex flex-col shadow-2xl border border-gray-400"
        style={{ width: 860, height: 560, background: "#fff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}
        onClick={e => e.stopPropagation()}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
          <div className="flex items-center gap-2">
            <Icon name="BookMarked" size={13} className="text-blue-700" />
            <span className="text-[12px] font-semibold text-gray-800">Условные обозначения</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-6 px-2 text-[11px] border border-gray-400 rounded hover:bg-gray-200 flex items-center gap-1">
              <Icon name="Printer" size={11} /> Печать
            </button>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
              <Icon name="X" size={12} />
            </button>
          </div>
        </div>

        {/* Фильтр */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 flex-shrink-0" style={{ background: "#f5f5f5" }}>
          <div className="flex items-center gap-1 flex-1 border border-gray-300 rounded px-2 py-0.5 bg-white">
            <Icon name="Search" size={12} className="text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск обозначения..."
              className="flex-1 text-[11px] outline-none bg-transparent" />
          </div>
          {["Все", ...GROUPS].map(g => (
            <button key={g} onClick={() => setActiveGroup(g)}
              className="h-6 px-2 text-[11px] rounded border"
              style={{
                background: activeGroup === g ? "#2563eb" : "white",
                color: activeGroup === g ? "white" : "#555",
                borderColor: activeGroup === g ? "#2563eb" : "#d1d5db",
              }}>
              {g}
            </button>
          ))}
        </div>

        {/* Сетка обозначений */}
        <div className="flex-1 overflow-y-auto p-3">
          {GROUPS.filter(g => activeGroup === "Все" || activeGroup === g).map(group => {
            const items = filtered.filter(i => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-4">
                <div className="text-[11px] font-semibold text-center py-1 mb-2 rounded"
                  style={{ background: "#dbeafe", color: "#1e40af", letterSpacing: "0.08em" }}>
                  {group.toUpperCase()}
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                  {items.map(item => (
                    <div key={item.id}
                      className="flex flex-col items-center gap-1 p-2 border border-gray-200 rounded hover:border-blue-400 hover:bg-blue-50 cursor-pointer transition-colors"
                      style={{ background: "#fafafa" }}>
                      <div className="flex items-center justify-center" style={{ height: 44 }}>
                        {item.svg}
                      </div>
                      <div className="text-[10px] text-gray-700 text-center leading-tight">
                        {item.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center text-[12px] text-gray-400 py-8">Ничего не найдено</div>
          )}
        </div>

        {/* Статус */}
        <div className="px-3 py-0.5 border-t border-gray-200 text-[10px] text-gray-400 flex-shrink-0" style={{ background: "#f0f0f0" }}>
          Показано {filtered.length} из {ITEMS.length} обозначений
        </div>
      </div>
    </div>
  );
}
