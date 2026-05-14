// Типы условных обозначений для размещения на схеме
// SVG-пути описаны в координатном пространстве viewBox="0 0 48 40"

export interface LegendType {
  id: string;
  name: string;
  group: string;
  // Строка SVG-элементов для рендера (без обёртки <svg>)
  svgContent: string;
}

export const LEGEND_TYPES: LegendType[] = [
  {
    id: "medical", name: "Медицинский пункт", group: "Общие",
    svgContent: `<circle cx="24" cy="20" r="16" fill="none" stroke="#c00" stroke-width="1.5"/><line x1="24" y1="8" x2="24" y2="32" stroke="#c00" stroke-width="2.5"/><line x1="12" y1="20" x2="36" y2="20" stroke="#c00" stroke-width="2.5"/>`,
  },
  {
    id: "fan", name: "Вентилятор", group: "Вентиляция",
    // Символ вентилятора по ГОСТ: внешний круг + 3 лопасти (дуги) + центральная точка
    svgContent: `<circle cx="24" cy="20" r="16" fill="white" stroke="#222" stroke-width="2"/><path d="M24,20 C24,12 32,8 36,14 C32,16 28,18 24,20Z" fill="#222"/><path d="M24,20 C16,20 12,12 18,8 C20,12 22,16 24,20Z" fill="#222"/><path d="M24,20 C24,28 16,32 12,26 C16,24 20,22 24,20Z" fill="#222"/><circle cx="24" cy="20" r="3" fill="white" stroke="#222" stroke-width="1.5"/>`,
  },
  {
    id: "bulkhead", name: "Перемычка глухая", group: "Вентиляция",
    svgContent: `<line x1="4" y1="10" x2="4" y2="30" stroke="#222" stroke-width="3"/><line x1="4" y1="20" x2="44" y2="20" stroke="#222" stroke-width="1.5"/><line x1="44" y1="10" x2="44" y2="30" stroke="#222" stroke-width="3"/>`,
  },
  {
    id: "door", name: "Вентиляционная дверь", group: "Вентиляция",
    svgContent: `<line x1="4" y1="10" x2="4" y2="30" stroke="#222" stroke-width="2"/><line x1="4" y1="20" x2="44" y2="20" stroke="#222" stroke-width="1.5"/><line x1="44" y1="10" x2="44" y2="30" stroke="#222" stroke-width="2"/><path d="M 4 15 Q 24 12 44 15" fill="none" stroke="#222" stroke-width="1.5"/>`,
  },
  {
    id: "regulator", name: "Регулятор (шибер)", group: "Вентиляция",
    svgContent: `<line x1="4" y1="20" x2="44" y2="20" stroke="#222" stroke-width="1.5"/><rect x="18" y="10" width="12" height="20" fill="#ffd600" stroke="#222" stroke-width="1.5"/>`,
  },
  {
    id: "sensor_gas", name: "Датчик метана", group: "Приборы",
    svgContent: `<rect x="8" y="10" width="32" height="22" rx="3" fill="none" stroke="#222" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">CH₄</text>`,
  },
  {
    id: "sound_alarm", name: "Звуковая сигнализация", group: "Приборы",
    svgContent: `<polygon points="8,14 22,14 30,8 30,32 22,26 8,26" fill="none" stroke="#222" stroke-width="1.5"/><path d="M 32 14 Q 40 20 32 26" fill="none" stroke="#222" stroke-width="1.5"/><path d="M 34 10 Q 46 20 34 30" fill="none" stroke="#222" stroke-width="1.5"/>`,
  },
  {
    id: "emergency_exit", name: "Запасной выход", group: "Общие",
    svgContent: `<rect x="4" y="6" width="18" height="28" fill="#ffd600" stroke="#222" stroke-width="1"/><rect x="26" y="6" width="18" height="28" fill="#111" stroke="#222" stroke-width="1"/><rect x="4" y="16" width="18" height="8" fill="#111"/><rect x="26" y="16" width="18" height="8" fill="#ffd600"/>`,
  },
  {
    id: "copra_tower", name: "Копёр башенный", group: "Общие",
    svgContent: `<rect x="16" y="2" width="16" height="36" fill="none" stroke="#222" stroke-width="1.5"/><line x1="16" y1="12" x2="32" y2="12" stroke="#222" stroke-width="1"/><line x1="16" y1="20" x2="32" y2="20" stroke="#222" stroke-width="1"/><line x1="16" y1="28" x2="32" y2="28" stroke="#222" stroke-width="1"/>`,
  },
  {
    id: "conveyor", name: "Привод конвейера", group: "Приборы",
    svgContent: `<polygon points="4,28 44,16 44,22 4,34" fill="#555"/><circle cx="44" cy="19" r="5" fill="none" stroke="#222" stroke-width="1.5"/>`,
  },
  {
    id: "ground_base", name: "Наземная база", group: "Горноспасатели",
    svgContent: `<rect x="4" y="10" width="40" height="22" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="26" text-anchor="middle" font-size="13" font-weight="bold" fill="#222">Н.Б</text>`,
  },
  {
    id: "squad_moving", name: "Отделение в движении", group: "Горноспасатели",
    svgContent: `<rect x="2" y="10" width="36" height="22" rx="2" fill="none" stroke="#222" stroke-width="2"/><text x="16" y="26" text-anchor="middle" font-size="11" font-weight="bold" fill="#222">5 чел.</text><polygon points="38,14 48,21 38,28" fill="#222"/>`,
  },
  {
    id: "squad_working", name: "Отделение на месте работ", group: "Горноспасатели",
    svgContent: `<rect x="4" y="10" width="40" height="22" rx="2" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="26" text-anchor="middle" font-size="11" font-weight="bold" fill="#222">5 чел.</text>`,
  },
  {
    id: "positioning_reader", name: "Считыватель позиционирования", group: "Горноспасатели",
    svgContent: `<circle cx="24" cy="20" r="17" fill="none" stroke="#222" stroke-width="2"/><path d="M 15 25 Q 24 10 33 25" fill="none" stroke="#1a1aff" stroke-width="3"/><path d="M 18 25 Q 24 14 30 25" fill="none" stroke="#1a1aff" stroke-width="2.5"/><path d="M 21 25 Q 24 18 27 25" fill="none" stroke="#1a1aff" stroke-width="2"/><circle cx="24" cy="26" r="2.5" fill="#111"/>`,
  },
  {
    id: "sound_alarm_rgs", name: "Звуковая аварийная сигнализация", group: "Горноспасатели",
    svgContent: `<rect x="6" y="12" width="16" height="16" fill="none" stroke="#222" stroke-width="1.5"/><line x1="6" y1="20" x2="22" y2="20" stroke="#222" stroke-width="1"/><line x1="14" y1="12" x2="14" y2="28" stroke="#222" stroke-width="1"/><path d="M 22 13 L 42 6 L 42 34 L 22 27 Z" fill="none" stroke="#222" stroke-width="1.5"/>`,
  },
];