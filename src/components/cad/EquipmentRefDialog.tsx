// Справочник оборудования — аналог справочников в АэроСети
// Вкладки: Вентиляторы, Типы выработок, Перемычки, Датчики, Типовые меры, Насосы, Трубы, Транспорт
import { useState } from "react";
import Icon from "@/components/ui/icon";

type TabId = "fans" | "types" | "bulkheads" | "sensors" | "typical" | "pumps" | "pipes" | "transport";

interface Props {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  onClose: () => void;
}

const TABS: { id: TabId; label: string; icon: string; group: string }[] = [
  { id: "fans",      label: "Вентиляторы",          icon: "Wind",       group: "Вентиляция" },
  { id: "types",     label: "Типы выработок",        icon: "Layers",     group: "Вентиляция" },
  { id: "bulkheads", label: "Перемычки",             icon: "Square",     group: "Вентиляция" },
  { id: "sensors",   label: "Датчики",               icon: "Radio",      group: "Аварии" },
  { id: "typical",   label: "Типовые мероприятия",   icon: "FileText",   group: "Аварии" },
  { id: "pumps",     label: "Насосы",                icon: "Gauge",      group: "Трубопровод" },
  { id: "pipes",     label: "Трубы",                 icon: "GitBranch",  group: "Трубопровод" },
  { id: "transport", label: "Транспорт",             icon: "Truck",      group: "Общее" },
];

// Демо-данные для каждой вкладки
const DEMO_FANS = [
  { id: "1", name: "ВОД-21", type: "Осевой", q: "40–120 м³/с", h: "200–1800 Па", power: "55–110 кВт", rpm: 750, d: 2.1, note: "" },
  { id: "2", name: "ВЦД-47У", type: "Центробежный", q: "30–280 м³/с", h: "500–4000 Па", power: "200–800 кВт", rpm: 500, d: 4.7, note: "" },
  { id: "3", name: "ВМЭ-6", type: "Осевой (местное)", q: "2–6 м³/с", h: "100–600 Па", power: "3–7.5 кВт", rpm: 1500, d: 0.6, note: "Шахтный проветр." },
  { id: "4", name: "ВМЦ-8", type: "Осевой (местное)", q: "3–10 м³/с", h: "150–800 Па", power: "5.5–15 кВт", rpm: 1000, d: 0.8, note: "" },
  { id: "5", name: "ВУКП-16", type: "Центробежный", q: "50–200 м³/с", h: "800–5000 Па", power: "300–1000 кВт", rpm: 600, d: 1.6, note: "Ударопрочный" },
];

const DEMO_TYPES = [
  { id: "1", name: "Ствол вертикальный", shape: "Круглый", d: "3–7 м", alpha: "0.004–0.012", vMax: 12 },
  { id: "2", name: "Штрек горизонтальный", shape: "Прямоугольный", d: "3.5×3 м", alpha: "0.008–0.015", vMax: 6 },
  { id: "3", name: "Квершлаг", shape: "Арочный", d: "4×3 м", alpha: "0.006–0.012", vMax: 8 },
  { id: "4", name: "Уклон/бремсберг", shape: "Прямоугольный", d: "3×2.5 м", alpha: "0.010–0.020", vMax: 8 },
  { id: "5", name: "Горная камера", shape: "Прямоугольный", d: "6×5 м", alpha: "0.005–0.010", vMax: 4 },
  { id: "6", name: "Скважина дегаз.", shape: "Круглый", d: "0.15–0.2 м", alpha: "0.002–0.005", vMax: 20 },
];

const DEMO_BULKHEADS = [
  { id: "1", name: "Бетонная перемычка", type: "Глухая", r: ">10000", note: "ГОСТ 12.3.022" },
  { id: "2", name: "Шлакобетонная", type: "Глухая", r: ">5000", note: "" },
  { id: "3", name: "Кирпичная", type: "Глухая", r: ">3000", note: "" },
  { id: "4", name: "Деревянная с обшивкой", type: "Временная", r: "100–500", note: "Деревянная" },
  { id: "5", name: "Металлическая дверь", type: "С шибером", r: "50–200", note: "Регулируемое R" },
  { id: "6", name: "Парусная перемычка", type: "Вентиляц.", r: "10–50", note: "Временная" },
];

const DEMO_SENSORS = [
  { id: "1", name: "МС-1М", measure: "CH₄", range: "0–4%", class: "1A", note: "Стационарный" },
  { id: "2", name: "МТ-5", measure: "CO", range: "0–100 ppm", class: "1A", note: "" },
  { id: "3", name: "АТ-6", measure: "Температура", range: "-40..+80°C", class: "1B", note: "" },
  { id: "4", name: "ВКМ-1", measure: "Скорость возд.", range: "0–25 м/с", class: "2A", note: "Анемометр" },
  { id: "5", name: "МС-6У", measure: "CH₄/CO₂/O₂", range: "мультигаз", class: "1A", note: "" },
];

const DEMO_TYPICAL = [
  { id: "1", name: "Задымление (пожар)", steps: 7, resp: "Начальник смены", duration: "15 мин" },
  { id: "2", name: "Превышение CH₄ > 1%", steps: 5, resp: "Мастер ВТБ", duration: "10 мин" },
  { id: "3", name: "Отказ ГВУ", steps: 4, resp: "Главный механик", duration: "20 мин" },
  { id: "4", name: "Обрушение", steps: 6, resp: "Начальник шахты", duration: "30 мин" },
];

const DEMO_PUMPS = [
  { id: "1", name: "ЦНС-60-264", type: "Центробежный", q: "60 м³/ч", h: "264 м", power: "75 кВт", note: "" },
  { id: "2", name: "ЦНС-300-120", type: "Центробежный", q: "300 м³/ч", h: "120 м", power: "132 кВт", note: "" },
  { id: "3", name: "ЦНС-105-294", type: "Центробежный", q: "105 м³/ч", h: "294 м", power: "160 кВт", note: "" },
];

const DEMO_PIPES = [
  { id: "1", name: "Стальная Ст20", dn: "DN50", wall: "4 мм", p: "16 бар", note: "ГОСТ 8732" },
  { id: "2", name: "Стальная Ст20", dn: "DN100", wall: "5 мм", p: "16 бар", note: "ГОСТ 8732" },
  { id: "3", name: "ПВД", dn: "DN50", wall: "4.6 мм", p: "10 бар", note: "Полиэтилен" },
  { id: "4", name: "ПВД", dn: "DN100", wall: "9.1 мм", p: "10 бар", note: "Полиэтилен" },
  { id: "5", name: "Чугун ВЧШГ", dn: "DN150", wall: "6 мм", p: "25 бар", note: "ГОСТ 21053" },
];

const DEMO_TRANSPORT = [
  { id: "1", name: "Вагонетка ВГ-3.3", type: "Рельсовый", cap: "3.3 м³", load: "4.5 т", v: "3.5 м/с", note: "" },
  { id: "2", name: "Конвейер ленточный 1Л100У", type: "Ленточный", cap: "100-250 т/ч", load: "—", v: "2.5 м/с", note: "" },
  { id: "3", name: "Монорельсовая дорога", type: "Монорельс", cap: "5 т", load: "—", v: "2 м/с", note: "Подвесной" },
];

function ColHeader({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1 text-left text-[11px] font-semibold text-gray-700 border-b border-gray-300 select-none"
      style={{ background: "#e8eef8", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}
function Cell({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-2 py-1 text-[11px] text-gray-800 border-b border-gray-100">{children}</td>
  );
}

function TableFans() {
  const [search, setSearch] = useState("");
  const rows = DEMO_FANS.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.type.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <>
      <SearchBar value={search} onChange={setSearch} />
      <table className="w-full border-collapse">
        <thead><tr>
          <ColHeader>Марка</ColHeader>
          <ColHeader>Тип</ColHeader>
          <ColHeader>Q, м³/с</ColHeader>
          <ColHeader>H, Па</ColHeader>
          <ColHeader>Мощность</ColHeader>
          <ColHeader>D, м</ColHeader>
          <ColHeader>Обороты</ColHeader>
          <ColHeader>Примечание</ColHeader>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
              className="hover:bg-blue-50 cursor-pointer">
              <Cell><span className="font-semibold text-blue-700">{r.name}</span></Cell>
              <Cell>{r.type}</Cell>
              <Cell>{r.q}</Cell>
              <Cell>{r.h}</Cell>
              <Cell>{r.power}</Cell>
              <Cell>{r.d}</Cell>
              <Cell>{r.rpm} об/мин</Cell>
              <Cell>{r.note}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TableTypes() {
  const [search, setSearch] = useState("");
  const rows = DEMO_TYPES.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <SearchBar value={search} onChange={setSearch} />
      <table className="w-full border-collapse">
        <thead><tr>
          <ColHeader>Тип выработки</ColHeader>
          <ColHeader>Форма</ColHeader>
          <ColHeader>Размер</ColHeader>
          <ColHeader>α ×10⁻⁴</ColHeader>
          <ColHeader>V max, м/с</ColHeader>
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
              className="hover:bg-blue-50 cursor-pointer">
              <Cell><span className="font-semibold">{r.name}</span></Cell>
              <Cell>{r.shape}</Cell>
              <Cell>{r.d}</Cell>
              <Cell>{r.alpha}</Cell>
              <Cell>{r.vMax}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function TableBulkheads() {
  const rows = DEMO_BULKHEADS;
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <ColHeader>Название</ColHeader>
        <ColHeader>Тип</ColHeader>
        <ColHeader>R, кМюрг</ColHeader>
        <ColHeader>Примечание</ColHeader>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
            className="hover:bg-blue-50 cursor-pointer">
            <Cell><span className="font-semibold">{r.name}</span></Cell>
            <Cell>{r.type}</Cell>
            <Cell>{r.r}</Cell>
            <Cell>{r.note}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableSensors() {
  const rows = DEMO_SENSORS;
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <ColHeader>Марка</ColHeader>
        <ColHeader>Измеряемое</ColHeader>
        <ColHeader>Диапазон</ColHeader>
        <ColHeader>Класс</ColHeader>
        <ColHeader>Примечание</ColHeader>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
            className="hover:bg-blue-50 cursor-pointer">
            <Cell><span className="font-semibold text-blue-700">{r.name}</span></Cell>
            <Cell>{r.measure}</Cell>
            <Cell>{r.range}</Cell>
            <Cell>{r.class}</Cell>
            <Cell>{r.note}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableTypical() {
  const rows = DEMO_TYPICAL;
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <ColHeader>Мероприятие</ColHeader>
        <ColHeader>Шагов</ColHeader>
        <ColHeader>Ответственный</ColHeader>
        <ColHeader>Время реакции</ColHeader>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
            className="hover:bg-blue-50 cursor-pointer">
            <Cell><span className="font-semibold">{r.name}</span></Cell>
            <Cell>{r.steps}</Cell>
            <Cell>{r.resp}</Cell>
            <Cell>{r.duration}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablePumps() {
  const rows = DEMO_PUMPS;
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <ColHeader>Марка</ColHeader>
        <ColHeader>Тип</ColHeader>
        <ColHeader>Расход</ColHeader>
        <ColHeader>Напор</ColHeader>
        <ColHeader>Мощность</ColHeader>
        <ColHeader>Примечание</ColHeader>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
            className="hover:bg-blue-50 cursor-pointer">
            <Cell><span className="font-semibold text-blue-700">{r.name}</span></Cell>
            <Cell>{r.type}</Cell>
            <Cell>{r.q}</Cell>
            <Cell>{r.h}</Cell>
            <Cell>{r.power}</Cell>
            <Cell>{r.note}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TablePipes() {
  const rows = DEMO_PIPES;
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <ColHeader>Материал</ColHeader>
        <ColHeader>DN</ColHeader>
        <ColHeader>Стенка</ColHeader>
        <ColHeader>Давление</ColHeader>
        <ColHeader>Примечание</ColHeader>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
            className="hover:bg-blue-50 cursor-pointer">
            <Cell><span className="font-semibold">{r.name}</span></Cell>
            <Cell>{r.dn}</Cell>
            <Cell>{r.wall}</Cell>
            <Cell>{r.p}</Cell>
            <Cell>{r.note}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TableTransport() {
  const rows = DEMO_TRANSPORT;
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <ColHeader>Наименование</ColHeader>
        <ColHeader>Тип</ColHeader>
        <ColHeader>Ёмкость</ColHeader>
        <ColHeader>Нагрузка</ColHeader>
        <ColHeader>Скорость</ColHeader>
        <ColHeader>Примечание</ColHeader>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} style={{ background: i % 2 === 0 ? "#fafafa" : "#fff" }}
            className="hover:bg-blue-50 cursor-pointer">
            <Cell><span className="font-semibold">{r.name}</span></Cell>
            <Cell>{r.type}</Cell>
            <Cell>{r.cap}</Cell>
            <Cell>{r.load}</Cell>
            <Cell>{r.v}</Cell>
            <Cell>{r.note}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200" style={{ background: "#f5f7fa" }}>
      <Icon name="Search" size={12} className="text-gray-400 flex-shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск..."
        className="flex-1 text-[11px] outline-none bg-transparent"
        style={{ fontFamily: "inherit" }}
      />
      {value && (
        <button onClick={() => onChange("")} className="text-gray-400 hover:text-gray-600">
          <Icon name="X" size={10} />
        </button>
      )}
    </div>
  );
}

export default function EquipmentRefDialog({ activeTab, onTabChange, onClose }: Props) {
  const currentTab = TABS.find(t => t.id === activeTab) ?? TABS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose}>
      <div className="flex flex-col shadow-2xl border border-gray-400"
        style={{ width: 860, height: 560, background: "#ffffff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}
        onClick={(e) => e.stopPropagation()}>

        {/* ── Заголовок ── */}
        <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
          <div className="flex items-center gap-2">
            <Icon name="BookOpen" size={13} className="text-blue-700" />
            <span className="text-[12px] font-semibold text-gray-800">
              Справочники — {currentTab.label}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="h-6 px-2 text-[11px] border border-gray-400 rounded hover:bg-blue-50 flex items-center gap-1"
              title="Добавить запись">
              <Icon name="Plus" size={11} /> Добавить
            </button>
            <button
              className="h-6 px-2 text-[11px] border border-gray-400 rounded hover:bg-blue-50 flex items-center gap-1"
              title="Редактировать">
              <Icon name="Edit2" size={11} /> Изменить
            </button>
            <button
              className="h-6 px-2 text-[11px] border border-red-300 rounded hover:bg-red-50 text-red-600 flex items-center gap-1"
              title="Удалить запись">
              <Icon name="Trash2" size={11} /> Удалить
            </button>
            <div className="w-px h-5 bg-gray-300 mx-1" />
            <button onClick={onClose}
              className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600 transition-colors">
              <Icon name="X" size={12} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── Левая навигация по вкладкам ── */}
          <div className="w-44 flex-shrink-0 border-r border-gray-300 overflow-y-auto"
            style={{ background: "#f0f0f0" }}>
            {["Вентиляция", "Аварии", "Трубопровод", "Общее"].map(group => (
              <div key={group}>
                <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200"
                  style={{ background: "#e4e4e4" }}>
                  {group}
                </div>
                {TABS.filter(t => t.group === group).map(tab => (
                  <button key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-blue-100 transition-colors"
                    style={{
                      background: activeTab === tab.id ? "#2563eb" : "transparent",
                      color: activeTab === tab.id ? "white" : "#333",
                      fontWeight: activeTab === tab.id ? 600 : 400,
                    }}>
                    <Icon name={tab.icon} size={13}
                      className={activeTab === tab.id ? "text-white" : "text-gray-500"}
                      fallback="Square" />
                    {tab.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* ── Основная область с таблицей ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Панель инструментов */}
            <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 flex-shrink-0"
              style={{ background: "#f8f8f8" }}>
              <span className="text-[11px] font-semibold text-gray-700">{currentTab.label}</span>
              <span className="text-[10px] text-gray-400 ml-1">
                {activeTab === "fans" && `(${DEMO_FANS.length} записей)`}
                {activeTab === "types" && `(${DEMO_TYPES.length} записей)`}
                {activeTab === "bulkheads" && `(${DEMO_BULKHEADS.length} записей)`}
                {activeTab === "sensors" && `(${DEMO_SENSORS.length} записей)`}
                {activeTab === "typical" && `(${DEMO_TYPICAL.length} записей)`}
                {activeTab === "pumps" && `(${DEMO_PUMPS.length} записей)`}
                {activeTab === "pipes" && `(${DEMO_PIPES.length} записей)`}
                {activeTab === "transport" && `(${DEMO_TRANSPORT.length} записей)`}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button className="h-5 px-1.5 text-[10px] border border-gray-300 rounded hover:bg-gray-100 flex items-center gap-1">
                  <Icon name="Download" size={10} /> Экспорт
                </button>
                <button className="h-5 px-1.5 text-[10px] border border-gray-300 rounded hover:bg-gray-100 flex items-center gap-1">
                  <Icon name="Upload" size={10} /> Импорт
                </button>
              </div>
            </div>

            {/* Таблица */}
            <div className="flex-1 overflow-auto">
              {activeTab === "fans"      && <TableFans />}
              {activeTab === "types"     && <TableTypes />}
              {activeTab === "bulkheads" && <TableBulkheads />}
              {activeTab === "sensors"   && <TableSensors />}
              {activeTab === "typical"   && <TableTypical />}
              {activeTab === "pumps"     && <TablePumps />}
              {activeTab === "pipes"     && <TablePipes />}
              {activeTab === "transport" && <TableTransport />}
            </div>

            {/* Строка статуса */}
            <div className="flex items-center px-2 py-0.5 border-t border-gray-200 flex-shrink-0 text-[10px] text-gray-500"
              style={{ background: "#f0f0f0" }}>
              Данные справочника хранятся в проекте. Дважды кликните по строке для редактирования.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
