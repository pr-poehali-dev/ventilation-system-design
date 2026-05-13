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
    svgContent: `<circle cx="24" cy="20" r="13" fill="none" stroke="#2563eb" stroke-width="1.5"/><path d="M24,20 Q30,10 36,14 Q32,20 24,20Z" fill="#2563eb" opacity="0.7"/><path d="M24,20 Q14,16 12,8 Q20,10 24,20Z" fill="#2563eb" opacity="0.7"/><path d="M24,20 Q18,30 24,36 Q28,28 24,20Z" fill="#2563eb" opacity="0.7"/><circle cx="24" cy="20" r="3" fill="#2563eb"/>`,
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
];
