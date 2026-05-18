// Типы условных обозначений для размещения на схеме
// SVG-пути описаны в координатном пространстве viewBox="0 0 48 40"
//
// Перемычки: цветовая кодировка материала (по ГОСТ / АэроСеть):
//   без цвета (белый)  = базовая конструкция
//   зелёный (#4caf50)  = бетонная
//   жёлтый  (#ffd600)  = деревянная
//   оранжевый (#ff9800)= кирпичная
//   фиолетовый (#9c27b0)=металлическая

export interface LegendType {
  id: string;
  name: string;
  group: string;
  // Строка SVG-элементов для рендера (без обёртки <svg>)
  svgContent: string;
  // Подгруппа для группировки в выпадающем списке
  subgroup?: string;
}

// ─── Helpers для SVG перемычек ────────────────────────────────────────────
// Глухая перемычка: две вертикальные стойки + горизонтальная ось + заливка тела
function solidBulkhead(fill: string, stroke: string): string {
  return `<rect x="1" y="8" width="6" height="24" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>` +
    `<line x1="7" y1="20" x2="41" y2="20" stroke="#333" stroke-width="1.2"/>` +
    `<rect x="41" y="8" width="6" height="24" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
}
// Дверь закрытая: глухая + прорезь двери
function closedDoor(fill: string, stroke: string): string {
  return solidBulkhead(fill, stroke) +
    `<line x1="7" y1="14" x2="7" y2="26" stroke="#fff" stroke-width="2"/>` +
    `<line x1="7" y1="20" x2="14" y2="20" stroke="#fff" stroke-width="1.5"/>`;
}
// Дверь автоматическая: дверь + кружок с "А"
function autoDoor(fill: string, stroke: string): string {
  return closedDoor(fill, stroke) +
    `<circle cx="27" cy="20" r="8" fill="white" stroke="#333" stroke-width="1.2"/>` +
    `<text x="27" y="24" text-anchor="middle" font-size="8" font-weight="bold" fill="#333">А</text>`;
}

export const LEGEND_TYPES: LegendType[] = [
  // ─── ВЕНТИЛЯЦИЯ: ВЕНТИЛЯТОР ───────────────────────────────────────────
  {
    id: "fan", name: "Вентилятор", group: "Вентиляция",
    svgContent: `<circle cx="24" cy="20" r="16" fill="white" stroke="#222" stroke-width="2"/><path d="M24,20 C24,12 32,8 36,14 C32,16 28,18 24,20Z" fill="#222"/><path d="M24,20 C16,20 12,12 18,8 C20,12 22,16 24,20Z" fill="#222"/><path d="M24,20 C24,28 16,32 12,26 C16,24 20,22 24,20Z" fill="#222"/><circle cx="24" cy="20" r="3" fill="white" stroke="#222" stroke-width="1.5"/>`,
  },
  {
    id: "regulator", name: "Регулятор (шибер)", group: "Вентиляция",
    svgContent: `<line x1="4" y1="20" x2="44" y2="20" stroke="#222" stroke-width="1.5"/><rect x="18" y="10" width="12" height="20" fill="#ffd600" stroke="#222" stroke-width="1.5"/>`,
  },

  // ─── ПЕРЕМЫЧКИ ГЛУХИЕ ────────────────────────────────────────────────
  {
    id: "bulkhead", name: "Перемычка глухая", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: solidBulkhead("white", "#333"),
  },
  {
    id: "bulkhead_concrete", name: "Перемычка глухая (бетонная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: solidBulkhead("#4caf50", "#2e7d32"),
  },
  {
    id: "bulkhead_wood", name: "Перемычка глухая (деревянная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: solidBulkhead("#ffd600", "#f57f17"),
  },
  {
    id: "bulkhead_brick", name: "Перемычка глухая (кирпичная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: solidBulkhead("#ff9800", "#e65100"),
  },
  {
    id: "bulkhead_metal", name: "Перемычка глухая (металлическая)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: solidBulkhead("#9c27b0", "#6a1b9a"),
  },

  // ─── ДВЕРИ ВЕНТИЛЯЦИОННЫЕ ЗАКРЫТЫЕ ───────────────────────────────────
  {
    id: "door_closed", name: "Дверь вентиляционная закрытая", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: closedDoor("white", "#333"),
  },
  {
    id: "door_closed_concrete", name: "Дверь вентиляционная закрытая (бетонная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: closedDoor("#4caf50", "#2e7d32"),
  },
  {
    id: "door_closed_wood", name: "Дверь вентиляционная закрытая (деревянная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: closedDoor("#ffd600", "#f57f17"),
  },
  {
    id: "door_closed_brick", name: "Дверь вентиляционная закрытая (кирпичная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: closedDoor("#ff9800", "#e65100"),
  },
  {
    id: "door_closed_metal", name: "Дверь вентиляционная закрытая (металлическая)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: closedDoor("#9c27b0", "#6a1b9a"),
  },

  // ─── ДВЕРИ ВЕНТИЛЯЦИОННЫЕ АВТОМАТИЧЕСКИЕ ─────────────────────────────
  {
    id: "door_auto", name: "Дверь вентиляционная автоматическая", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: autoDoor("white", "#333"),
  },
  {
    id: "door_auto_concrete", name: "Дверь вентиляционная автоматическая (бетонная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: autoDoor("#4caf50", "#2e7d32"),
  },
  {
    id: "door_auto_wood", name: "Дверь вентиляционная автоматическая (деревянная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: autoDoor("#ffd600", "#f57f17"),
  },
  {
    id: "door_auto_brick", name: "Дверь вентиляционная автоматическая (кирпичная)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: autoDoor("#ff9800", "#e65100"),
  },
  {
    id: "door_auto_metal", name: "Дверь вентиляционная автоматическая (металлическая)", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: autoDoor("#9c27b0", "#6a1b9a"),
  },

  // ─── ПАРУС ВЕНТИЛЯЦИОННЫЙ ────────────────────────────────────────────
  {
    id: "sail", name: "Парус вентиляционный", group: "Вентиляция", subgroup: "Глухие перемычки",
    svgContent: `<line x1="4" y1="20" x2="44" y2="20" stroke="#333" stroke-width="1.2"/>` +
      `<path d="M4,8 Q4,20 4,32 Q18,28 18,20 Q18,12 4,8Z" fill="white" stroke="#333" stroke-width="1.2"/>`,
  },

  // ─── ПЕРЕМЫЧКИ ВОДОПОДПОРНЫЕ ─────────────────────────────────────────
  {
    id: "water_dam", name: "Перемычка водоподпорная", group: "Вентиляция", subgroup: "Водоподпорные",
    svgContent: solidBulkhead("white", "#333") +
      `<text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#1565c0">D</text>`,
  },
  {
    id: "water_dam_concrete", name: "Перемычка водоподпорная (бетонная)", group: "Вентиляция", subgroup: "Водоподпорные",
    svgContent: solidBulkhead("#4caf50", "#2e7d32") +
      `<text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff">D</text>`,
  },
  {
    id: "water_dam_wood", name: "Перемычка водоподпорная (деревянная)", group: "Вентиляция", subgroup: "Водоподпорные",
    svgContent: solidBulkhead("#ffd600", "#f57f17") +
      `<text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#333">D</text>`,
  },
  {
    id: "water_dam_brick", name: "Перемычка водоподпорная (кирпичная)", group: "Вентиляция", subgroup: "Водоподпорные",
    svgContent: solidBulkhead("#ff9800", "#e65100") +
      `<text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff">D</text>`,
  },
  {
    id: "water_dam_metal", name: "Перемычка водоподпорная (металлическая)", group: "Вентиляция", subgroup: "Водоподпорные",
    svgContent: solidBulkhead("#9c27b0", "#6a1b9a") +
      `<text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#fff">D</text>`,
  },

  // ─── РЕГУЛЯТОРЫ / ШИБЕРЫ ─────────────────────────────────────────────
  {
    id: "regulator_open", name: "Дверь вентиляционная открытая", group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: `<line x1="4" y1="20" x2="44" y2="20" stroke="#333" stroke-width="1.2"/>` +
      `<rect x="1" y="8" width="6" height="24" fill="white" stroke="#333" stroke-width="1.2"/>` +
      `<rect x="41" y="8" width="6" height="24" fill="white" stroke="#333" stroke-width="1.2"/>` +
      `<path d="M7,10 L18,18 L7,26Z" fill="none" stroke="#333" stroke-width="1.2"/>`,
  },
  {
    id: "regulator_window", name: "Дверь с регулируемым окном", group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: solidBulkhead("white", "#333") +
      `<rect x="10" y="14" width="8" height="12" fill="none" stroke="#333" stroke-width="1.2"/>` +
      `<line x1="7" y1="20" x2="41" y2="20" stroke="#333" stroke-width="1"/>`,
  },
  {
    id: "regulator_lattice", name: "Дверь вентиляционная решётчатая", group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: solidBulkhead("white", "#333") +
      `<line x1="12" y1="12" x2="12" y2="28" stroke="#333" stroke-width="0.8"/>` +
      `<line x1="17" y1="12" x2="17" y2="28" stroke="#333" stroke-width="0.8"/>` +
      `<line x1="22" y1="12" x2="22" y2="28" stroke="#333" stroke-width="0.8"/>` +
      `<line x1="8" y1="17" x2="26" y2="17" stroke="#333" stroke-width="0.8"/>` +
      `<line x1="8" y1="23" x2="26" y2="23" stroke="#333" stroke-width="0.8"/>`,
  },
  {
    id: "bulkhead_window", name: "Перемычка с проёмом", group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: solidBulkhead("white", "#333") +
      `<rect x="10" y="15" width="10" height="10" fill="none" stroke="#333" stroke-width="1.2"/>`,
  },

  // ─── ПРОЧИЕ ВЕНТ. ОБЪЕКТЫ ────────────────────────────────────────────
  {
    id: "bulkhead_barrier", name: "Перемычка барьерная", group: "Вентиляция", subgroup: "Прочие",
    svgContent: `<line x1="4" y1="20" x2="44" y2="20" stroke="#333" stroke-width="1.2"/>` +
      `<line x1="20" y1="8" x2="20" y2="32" stroke="#333" stroke-width="3"/>` +
      `<line x1="22" y1="8" x2="22" y2="32" stroke="#c00" stroke-width="3"/>`,
  },
  {
    id: "fire_door", name: "Противопожарная дверь", group: "Вентиляция", subgroup: "Прочие",
    svgContent: solidBulkhead("#c00", "#800") +
      `<text x="24" y="24" text-anchor="middle" font-size="7" font-weight="bold" fill="#fff">ПП</text>`,
  },

  // ─── ОБЩИЕ ОБЪЕКТЫ ────────────────────────────────────────────────────
  {
    id: "medical", name: "Медицинский пункт", group: "Общие",
    svgContent: `<circle cx="24" cy="20" r="16" fill="none" stroke="#c00" stroke-width="1.5"/><line x1="24" y1="8" x2="24" y2="32" stroke="#c00" stroke-width="2.5"/><line x1="12" y1="20" x2="36" y2="20" stroke="#c00" stroke-width="2.5"/>`,
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

  // ─── ПРИБОРЫ ─────────────────────────────────────────────────────────
  {
    id: "sensor_gas", name: "Датчик метана", group: "Приборы",
    svgContent: `<rect x="8" y="10" width="32" height="22" rx="3" fill="none" stroke="#222" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">CH₄</text>`,
  },
  {
    id: "sound_alarm", name: "Звуковая сигнализация", group: "Приборы",
    svgContent: `<polygon points="8,14 22,14 30,8 30,32 22,26 8,26" fill="none" stroke="#222" stroke-width="1.5"/><path d="M 32 14 Q 40 20 32 26" fill="none" stroke="#222" stroke-width="1.5"/><path d="M 34 10 Q 46 20 34 30" fill="none" stroke="#222" stroke-width="1.5"/>`,
  },

  // ─── ГОРНОСПАСАТЕЛИ ────────────────────────────────────────────────────
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

// ID всех перемычек для группировки в выпадающем списке
export const BULKHEAD_SYMBOL_IDS = new Set([
  "bulkhead", "bulkhead_concrete", "bulkhead_wood", "bulkhead_brick", "bulkhead_metal",
  "door_closed", "door_closed_concrete", "door_closed_wood", "door_closed_brick", "door_closed_metal",
  "door_auto", "door_auto_concrete", "door_auto_wood", "door_auto_brick", "door_auto_metal",
  "sail",
  "water_dam", "water_dam_concrete", "water_dam_wood", "water_dam_brick", "water_dam_metal",
  "regulator", "regulator_open", "regulator_window", "regulator_lattice", "bulkhead_window",
  "bulkhead_barrier", "fire_door",
]);
