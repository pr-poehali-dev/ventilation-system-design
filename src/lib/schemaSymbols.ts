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
// viewBox="0 0 48 40", центр по оси ветви — y=20, x=24
// Перемычка — один вертикальный блок по центру (x=20..28, y=4..36)
// Ветвь проходит горизонтально через y=20

// Глухая перемычка: один вертикальный прямоугольный блок по центру
function solidBulkhead(fill: string, stroke: string): string {
  return `<rect x="20" y="4" width="8" height="32" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}
// Дверь закрытая: прямоугольник + жирная линия вдоль левого края (знак закрытой двери)
function closedDoor(fill: string, stroke: string): string {
  return `<rect x="20" y="4" width="8" height="32" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>` +
    `<line x1="20" y1="4" x2="20" y2="36" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`;
}
// Дверь автоматическая: дверь + кружок с "А" справа
function autoDoor(fill: string, stroke: string): string {
  return closedDoor(fill, stroke) +
    `<circle cx="37" cy="20" r="7" fill="white" stroke="${stroke}" stroke-width="1.2"/>` +
    `<text x="37" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="${stroke}">А</text>`;
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

  // ─── ВЕНТИЛЯЦИОННЫЕ СТРУИ ────────────────────────────────────────────
  { id: "measure_station", name: "Станция замера количества воздуха", group: "Вентиляционные струи",
    svgContent: `<line x1="2" y1="15" x2="46" y2="15" stroke="#dc2626" stroke-width="3"/><line x1="2" y1="23" x2="46" y2="23" stroke="#dc2626" stroke-width="3"/>` },
  { id: "fresh_inlet", name: "Струя входящая (нисходящее проветривание)", group: "Вентиляционные струи",
    svgContent: `<line x1="2" y1="20" x2="38" y2="20" stroke="#dc2626" stroke-width="2.5"/><polygon points="36,14 46,20 36,26" fill="#dc2626"/>` },
  { id: "exhaust_outlet", name: "Струя исходящая (восходящее проветривание)", group: "Вентиляционные струи",
    svgContent: `<line x1="2" y1="20" x2="38" y2="20" stroke="#2196f3" stroke-width="2.5"/><polygon points="12,14 2,20 12,26" fill="#2196f3"/>` },
  { id: "leak_inlet", name: "Утечка воздуха входящая", group: "Вентиляционные струи",
    svgContent: `<line x1="2" y1="20" x2="38" y2="20" stroke="#dc2626" stroke-width="2" stroke-dasharray="6 4"/><polygon points="36,14 46,20 36,26" fill="#dc2626"/>` },
  { id: "leak_outlet", name: "Утечка воздуха исходящая", group: "Вентиляционные струи",
    svgContent: `<line x1="2" y1="20" x2="38" y2="20" stroke="#2196f3" stroke-width="2" stroke-dasharray="6 4"/><polygon points="12,14 2,20 12,26" fill="#2196f3"/>` },

  // ─── ВЕНТИЛЯТОРЫ (дополнительные типы) ───────────────────────────────
  { id: "fan_local", name: "Вентилятор местного проветривания, временный", group: "Вентиляторы",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#333" stroke-width="1.5"/><line x1="9" y1="20" x2="39" y2="20" stroke="#333" stroke-width="1.5"/><line x1="24" y1="5" x2="24" y2="35" stroke="#333" stroke-width="1.5"/>` },
  { id: "fan_axial", name: "Вентилятор стационарный осевой", group: "Вентиляторы",
    svgContent: `<circle cx="24" cy="20" r="15" fill="#222" stroke="#333" stroke-width="1.5"/><circle cx="24" cy="20" r="6" fill="white"/>` },
  { id: "fan_recirculate", name: "Рециркулирующая установка", group: "Вентиляторы",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#333" stroke-width="1.5"/><line x1="9" y1="9" x2="39" y2="31" stroke="#333" stroke-width="1.5"/><line x1="39" y1="9" x2="9" y2="31" stroke="#333" stroke-width="1.5"/>` },
  { id: "fan_stationary", name: "Вентилятор стационарный", group: "Вентиляторы",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="24" cy="20" r="6" fill="none" stroke="#333" stroke-width="1.5"/>` },

  // ─── ГЛУХИЕ ПЕРЕМЫЧКИ (новые ID, соответствующие справочнику) ────────
  { id: "bk_base",    name: "Глухая перемычка",                group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: solidBulkhead("white", "#222") },
  { id: "bk_concrete",name: "Глухая перемычка бетонная",       group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: solidBulkhead("#4caf50", "#2e7d32") },
  { id: "bk_wood",    name: "Глухая перемычка деревянная",     group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: solidBulkhead("#ffd600", "#f57f17") },
  { id: "bk_brick",   name: "Глухая перемычка кирпичная",      group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: solidBulkhead("#ff9800", "#e65100") },
  { id: "bk_metal",   name: "Глухая перемычка металлическая",  group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: solidBulkhead("#9c27b0", "#6a1b9a") },
  { id: "door_base",  name: "Дверь вентиляционная закрытая",                group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: closedDoor("white",   "#222") },
  { id: "door_conc",  name: "Дверь вентиляционная закрытая бетонная",       group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: closedDoor("#4caf50", "#2e7d32") },
  { id: "door_wood",  name: "Дверь вентиляционная закрытая деревянная",     group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: closedDoor("#ffd600", "#f57f17") },
  { id: "door_brick", name: "Дверь вентиляционная закрытая кирпичная",      group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: closedDoor("#ff9800", "#e65100") },
  { id: "door_metal", name: "Дверь вентиляционная закрытая металлическая",  group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: closedDoor("#9c27b0", "#6a1b9a") },
  { id: "auto_base",  name: "Дверь вентиляционная автоматическая",                group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: autoDoor("white",   "#222") },
  { id: "auto_conc",  name: "Дверь вентиляционная автоматическая бетонная",       group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: autoDoor("#4caf50", "#2e7d32") },
  { id: "auto_wood",  name: "Дверь вентиляционная автоматическая деревянная",     group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: autoDoor("#ffd600", "#f57f17") },
  { id: "auto_brick", name: "Дверь вентиляционная автоматическая кирпичная",      group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: autoDoor("#ff9800", "#e65100") },
  { id: "auto_metal", name: "Дверь вентиляционная автоматическая металлическая",  group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: autoDoor("#9c27b0", "#6a1b9a") },
  { id: "sail",       name: "Парус вентиляционный",                               group: "Вентиляция", subgroup: "Глухие перемычки", svgContent: `<line x1="22" y1="4" x2="22" y2="36" stroke="#ff6f00" stroke-width="2" stroke-linecap="round"/><path d="M22,10 Q38,14 38,20 Q38,26 22,30" fill="none" stroke="#ff6f00" stroke-width="2" stroke-linecap="round"/>` },

  // ─── ПЕРЕМЫЧКИ С ВЕНТ. ОКНОМ (все материалы) ─────────────────────────
  { id: "open_base",  name: "Дверь вентиляционная открытая",               group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: `<rect x="20" y="4" width="8" height="12" fill="white" stroke="#222" stroke-width="1.5"/><rect x="20" y="24" width="8" height="12" fill="white" stroke="#222" stroke-width="1.5"/><line x1="20" y1="24" x2="8" y2="36" stroke="#222" stroke-width="2" stroke-linecap="round"/>` },
  { id: "open_conc",  name: "Дверь вентиляционная открытая бетонная",      group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: `<rect x="20" y="4" width="8" height="12" fill="#4caf50" stroke="#2e7d32" stroke-width="1.5"/><rect x="20" y="24" width="8" height="12" fill="#4caf50" stroke="#2e7d32" stroke-width="1.5"/><line x1="20" y1="24" x2="8" y2="36" stroke="#2e7d32" stroke-width="2" stroke-linecap="round"/>` },
  { id: "open_wood",  name: "Дверь вентиляционная открытая деревянная",    group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: `<rect x="20" y="4" width="8" height="12" fill="#ffd600" stroke="#f57f17" stroke-width="1.5"/><rect x="20" y="24" width="8" height="12" fill="#ffd600" stroke="#f57f17" stroke-width="1.5"/><line x1="20" y1="24" x2="8" y2="36" stroke="#f57f17" stroke-width="2" stroke-linecap="round"/>` },
  { id: "open_brick", name: "Дверь вентиляционная открытая кирпичная",     group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: `<rect x="20" y="4" width="8" height="12" fill="#ff9800" stroke="#e65100" stroke-width="1.5"/><rect x="20" y="24" width="8" height="12" fill="#ff9800" stroke="#e65100" stroke-width="1.5"/><line x1="20" y1="24" x2="8" y2="36" stroke="#e65100" stroke-width="2" stroke-linecap="round"/>` },
  { id: "open_metal", name: "Дверь вентиляционная открытая металлическая", group: "Вентиляция", subgroup: "С вент. окном",
    svgContent: `<rect x="20" y="4" width="8" height="12" fill="#9c27b0" stroke="#6a1b9a" stroke-width="1.5"/><rect x="20" y="24" width="8" height="12" fill="#9c27b0" stroke="#6a1b9a" stroke-width="1.5"/><line x1="20" y1="24" x2="8" y2="36" stroke="#6a1b9a" stroke-width="2" stroke-linecap="round"/>` },
  { id: "win_base",   name: "Дверь с регулируемым окном",                group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("white",   "#222")    + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#222" stroke-width="1"/>` },
  { id: "win_conc",   name: "Дверь с регулируемым окном бетонная",       group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#4caf50", "#2e7d32") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#2e7d32" stroke-width="1"/>` },
  { id: "win_wood",   name: "Дверь с регулируемым окном деревянная",     group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#ffd600", "#f57f17") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#f57f17" stroke-width="1"/>` },
  { id: "win_brick",  name: "Дверь с регулируемым окном кирпичная",      group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#ff9800", "#e65100") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#e65100" stroke-width="1"/>` },
  { id: "win_metal",  name: "Дверь с регулируемым окном металлическая",  group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#9c27b0", "#6a1b9a") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#6a1b9a" stroke-width="1"/>` },
  { id: "lat_base",   name: "Дверь вентиляционная решётчатая",                group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("white",   "#333")    + `<line x1="22" y1="6" x2="22" y2="34" stroke="#333" stroke-width="0.9"/><line x1="25" y1="6" x2="25" y2="34" stroke="#333" stroke-width="0.9"/><line x1="28" y1="6" x2="28" y2="34" stroke="#333" stroke-width="0.9"/><line x1="20" y1="13" x2="28" y2="13" stroke="#333" stroke-width="0.9"/><line x1="20" y1="20" x2="28" y2="20" stroke="#333" stroke-width="0.9"/><line x1="20" y1="27" x2="28" y2="27" stroke="#333" stroke-width="0.9"/>` },
  { id: "lat_conc",   name: "Дверь вентиляционная решётчатая бетонная",       group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#4caf50", "#2e7d32") + `<line x1="22" y1="6" x2="22" y2="34" stroke="#2e7d32" stroke-width="0.9"/><line x1="25" y1="6" x2="25" y2="34" stroke="#2e7d32" stroke-width="0.9"/><line x1="28" y1="6" x2="28" y2="34" stroke="#2e7d32" stroke-width="0.9"/><line x1="20" y1="13" x2="28" y2="13" stroke="#2e7d32" stroke-width="0.9"/><line x1="20" y1="20" x2="28" y2="20" stroke="#2e7d32" stroke-width="0.9"/><line x1="20" y1="27" x2="28" y2="27" stroke="#2e7d32" stroke-width="0.9"/>` },
  { id: "lat_wood",   name: "Дверь вентиляционная решётчатая деревянная",     group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#ffd600", "#f57f17") + `<line x1="22" y1="6" x2="22" y2="34" stroke="#f57f17" stroke-width="0.9"/><line x1="25" y1="6" x2="25" y2="34" stroke="#f57f17" stroke-width="0.9"/><line x1="28" y1="6" x2="28" y2="34" stroke="#f57f17" stroke-width="0.9"/><line x1="20" y1="13" x2="28" y2="13" stroke="#f57f17" stroke-width="0.9"/><line x1="20" y1="20" x2="28" y2="20" stroke="#f57f17" stroke-width="0.9"/><line x1="20" y1="27" x2="28" y2="27" stroke="#f57f17" stroke-width="0.9"/>` },
  { id: "lat_brick",  name: "Дверь вентиляционная решётчатая кирпичная",      group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#ff9800", "#e65100") + `<line x1="22" y1="6" x2="22" y2="34" stroke="#e65100" stroke-width="0.9"/><line x1="25" y1="6" x2="25" y2="34" stroke="#e65100" stroke-width="0.9"/><line x1="28" y1="6" x2="28" y2="34" stroke="#e65100" stroke-width="0.9"/><line x1="20" y1="13" x2="28" y2="13" stroke="#e65100" stroke-width="0.9"/><line x1="20" y1="20" x2="28" y2="20" stroke="#e65100" stroke-width="0.9"/><line x1="20" y1="27" x2="28" y2="27" stroke="#e65100" stroke-width="0.9"/>` },
  { id: "lat_metal",  name: "Дверь вентиляционная решётчатая металлическая",  group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#9c27b0", "#6a1b9a") + `<line x1="22" y1="6" x2="22" y2="34" stroke="#6a1b9a" stroke-width="0.9"/><line x1="25" y1="6" x2="25" y2="34" stroke="#6a1b9a" stroke-width="0.9"/><line x1="28" y1="6" x2="28" y2="34" stroke="#6a1b9a" stroke-width="0.9"/><line x1="20" y1="13" x2="28" y2="13" stroke="#6a1b9a" stroke-width="0.9"/><line x1="20" y1="20" x2="28" y2="20" stroke="#6a1b9a" stroke-width="0.9"/><line x1="20" y1="27" x2="28" y2="27" stroke="#6a1b9a" stroke-width="0.9"/>` },
  { id: "proem_base",  name: "Перемычка с проёмом",                group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("white",   "#222")    + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#222" stroke-width="1"/>` },
  { id: "proem_conc",  name: "Перемычка с проёмом бетонная",       group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#4caf50", "#2e7d32") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#2e7d32" stroke-width="1"/>` },
  { id: "proem_wood",  name: "Перемычка с проёмом деревянная",     group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#ffd600", "#f57f17") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#f57f17" stroke-width="1"/>` },
  { id: "proem_brick", name: "Перемычка с проёмом кирпичная",      group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#ff9800", "#e65100") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#e65100" stroke-width="1"/>` },
  { id: "proem_metal", name: "Перемычка с проёмом металлическая",  group: "Вентиляция", subgroup: "С вент. окном", svgContent: solidBulkhead("#9c27b0", "#6a1b9a") + `<rect x="21" y="14" width="6" height="12" fill="white" stroke="#6a1b9a" stroke-width="1"/>` },
  { id: "barrier",     name: "Перемычка барьерная",      group: "Вентиляция", subgroup: "Прочие",
    svgContent: `<rect x="19" y="4" width="5" height="32" fill="#555" stroke="#333" stroke-width="1.2"/><rect x="24" y="4" width="5" height="32" fill="#c00" stroke="#800" stroke-width="1.2"/>` },
  { id: "fire_door_pp",name: "Противопожарная дверь",    group: "Вентиляция", subgroup: "Прочие",
    svgContent: `<line x1="20" y1="4" x2="20" y2="36" stroke="#dc2626" stroke-width="3.5"/><line x1="27" y1="4" x2="27" y2="36" stroke="#dc2626" stroke-width="3.5"/>` },

  // ─── ВЕРТИКАЛЬНЫЕ ВЫРАБОТКИ ───────────────────────────────────────────
  { id: "vert_sq_section",   name: "Сечение вертикальной выработки квадратное", group: "Вертикальные выработки",
    svgContent: `<rect x="6" y="4" width="36" height="32" fill="none" stroke="#333" stroke-width="2"/><line x1="6" y1="4" x2="42" y2="36" stroke="#333" stroke-width="2"/><line x1="42" y1="4" x2="6" y2="36" stroke="#333" stroke-width="2"/>` },
  { id: "vert_circ_section", name: "Сечение вертикальной выработки круглое",   group: "Вертикальные выработки",
    svgContent: `<circle cx="24" cy="20" r="16" fill="none" stroke="#333" stroke-width="2"/><line x1="12" y1="8" x2="36" y2="32" stroke="#333" stroke-width="2"/><line x1="36" y1="8" x2="12" y2="32" stroke="#333" stroke-width="2"/>` },
  { id: "vert_sq_mouth",     name: "Устье вертикальной выработки квадратное",  group: "Вертикальные выработки",
    svgContent: `<rect x="6" y="4" width="36" height="32" fill="none" stroke="#333" stroke-width="2"/><line x1="6" y1="4" x2="42" y2="36" stroke="#333" stroke-width="2"/><polygon points="6,4 42,4 42,36" fill="#222"/>` },
  { id: "vert_circ_mouth",   name: "Устье вертикальной выработки круглое",     group: "Вертикальные выработки",
    svgContent: `<circle cx="24" cy="20" r="16" fill="none" stroke="#333" stroke-width="2"/><path d="M24,4 A16,16 0 0,1 40,20 A16,16 0 0,1 24,36Z" fill="#222"/>` },
  { id: "vert_sq_full",      name: "Устье и сечение вертикального ствола прямоугольное", group: "Вертикальные выработки",
    svgContent: `<rect x="6" y="4" width="36" height="32" fill="#222" stroke="#333" stroke-width="2"/><polygon points="6,4 42,4 42,36" fill="white"/>` },
  { id: "vert_circ_full",    name: "Устье и сечение вертикального ствола круглое", group: "Вертикальные выработки",
    svgContent: `<circle cx="24" cy="20" r="16" fill="#222" stroke="#333" stroke-width="2"/><path d="M24,4 A16,16 0 0,1 40,20 A16,16 0 0,1 24,36Z" fill="white"/>` },
  { id: "slope_circ_full",   name: "Устье и сечение наклонного ствола круглое",      group: "Вертикальные выработки",
    svgContent: `<ellipse cx="24" cy="30" rx="14" ry="8" fill="#222" stroke="#333" stroke-width="1.5"/><path d="M10,30 L10,10 Q24,2 38,10 L38,30" fill="white" stroke="#333" stroke-width="1.5"/><ellipse cx="24" cy="10" rx="14" ry="8" fill="none" stroke="#333" stroke-width="1.5"/>` },
  { id: "slope_rect_full",   name: "Устье и сечение наклонного ствола прямоугольное",group: "Вертикальные выработки",
    svgContent: `<polygon points="6,36 6,14 24,4 42,14 42,36" fill="#222" stroke="#333" stroke-width="1.5"/><polygon points="6,14 24,4 42,14 42,36 24,28 6,36" fill="white"/><line x1="6" y1="14" x2="42" y2="14" stroke="#333" stroke-width="1.5"/><line x1="24" y1="4" x2="24" y2="28" stroke="#333" stroke-width="1.5"/>` },

  // ─── ПРОТИВОПОЖАРНАЯ ЗАЩИТА ──────────────────────────────────────────
  { id: "fire_valve",         name: "Вентиль запорный на воздухопроводе",    group: "Противопожарная защита",
    svgContent: `<line x1="4" y1="20" x2="44" y2="20" stroke="#dc2626" stroke-width="1.5"/><polygon points="4,10 24,20 4,30" fill="none" stroke="#dc2626" stroke-width="1.5"/><polygon points="44,10 24,20 44,30" fill="none" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "selfrescuer",        name: "Место хранения самоспасателей",          group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="18" font-weight="bold" fill="#222">С</text>` },
  { id: "fire_hose_roll",     name: "Рукав пожарный напорный, в скатку",     group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#dc2626" stroke-width="1.5"/><circle cx="24" cy="20" r="10" fill="none" stroke="#dc2626" stroke-width="1.5"/><circle cx="24" cy="20" r="5" fill="none" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "fire_nozzle_hand",   name: "Ствол пожарный ручной",                 group: "Противопожарная защита",
    svgContent: `<line x1="2" y1="20" x2="36" y2="20" stroke="#dc2626" stroke-width="2"/><polygon points="36,13 46,20 36,27" fill="#dc2626"/>` },
  { id: "fire_water_local",   name: "Установка пожаротушения водяная (ручной привод, локальная)", group: "Противопожарная защита",
    svgContent: `<polygon points="24,6 42,34 6,34" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="#dc2626"/>` },
  { id: "ppt_box",            name: "Пункт подключения пожаротушащей техники",group: "Противопожарная защита",
    svgContent: `<rect x="4" y="10" width="40" height="20" fill="none" stroke="#dc2626" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#dc2626">ППТ</text>` },
  { id: "fire_sprinkler_auto",name: "Установка оросительная, дренчерная (автоматическая)", group: "Противопожарная защита",
    svgContent: `<circle cx="18" cy="20" r="8" fill="none" stroke="#dc2626" stroke-width="1.5"/><line x1="26" y1="20" x2="38" y2="20" stroke="#dc2626" stroke-width="1.5"/><line x1="38" y1="14" x2="38" y2="26" stroke="#dc2626" stroke-width="1.5"/><line x1="38" y1="17" x2="44" y2="14" stroke="#dc2626" stroke-width="1.2"/><line x1="38" y1="20" x2="44" y2="20" stroke="#dc2626" stroke-width="1.2"/><line x1="38" y1="23" x2="44" y2="26" stroke="#dc2626" stroke-width="1.2"/>` },
  { id: "fire_inlet",         name: "Место подключения воздухопровода на подачу воды", group: "Противопожарная защита",
    svgContent: `<polygon points="2,8 46,20 2,32" fill="#dc2626"/>` },
  { id: "fire_sprayer",       name: "Водяной распылитель",                   group: "Противопожарная защита",
    svgContent: `<line x1="4" y1="20" x2="28" y2="20" stroke="#dc2626" stroke-width="1.5"/><circle cx="34" cy="20" r="6" fill="#dc2626"/>` },
  { id: "fire_ext_mobile",    name: "Огнетушитель передвижной",              group: "Противопожарная защита",
    svgContent: `<polygon points="24,4 44,36 4,36" fill="none" stroke="#dc2626" stroke-width="2"/>` },
  { id: "fire_hose_laid",     name: "Рукав пожарный напорный",               group: "Противопожарная защита",
    svgContent: `<path d="M4,20 Q12,10 20,20 Q28,30 36,20 Q44,10 48,20" fill="none" stroke="#dc2626" stroke-width="2"/>` },
  { id: "fire_nozzle_static", name: "Ствол пожарный стационарный",           group: "Противопожарная защита",
    svgContent: `<line x1="2" y1="20" x2="30" y2="20" stroke="#dc2626" stroke-width="2"/><line x1="30" y1="12" x2="30" y2="28" stroke="#dc2626" stroke-width="2"/><polygon points="30,13 46,20 30,27" fill="#dc2626"/>` },
  { id: "fire_radio",         name: "Пункт радиосвязи",                      group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="24" r="12" fill="none" stroke="#222" stroke-width="1.5"/><path d="M16,18 Q24,6 32,18" fill="none" stroke="#222" stroke-width="2"/><line x1="20" y1="16" x2="28" y2="24" stroke="#222" stroke-width="2"/>` },
  { id: "fire_tv",            name: "Пункт телевидения",                     group: "Противопожарная защита",
    svgContent: `<rect x="6" y="8" width="36" height="24" fill="none" stroke="#222" stroke-width="1.5"/><text x="24" y="26" text-anchor="middle" font-size="16" font-weight="bold" fill="#222">Т</text>` },
  { id: "fire_crane",         name: "Пожарный кран",                         group: "Противопожарная защита",
    svgContent: `<line x1="24" y1="4" x2="24" y2="24" stroke="#dc2626" stroke-width="2"/><circle cx="24" cy="30" r="7" fill="none" stroke="#dc2626" stroke-width="2"/>` },
  { id: "fire_crane_conn",    name: "Кран пожарный соединительная головка",  group: "Противопожарная защита",
    svgContent: `<line x1="24" y1="4" x2="24" y2="18" stroke="#dc2626" stroke-width="2"/><circle cx="24" cy="28" r="10" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="16" cy="36" r="4" fill="none" stroke="#dc2626" stroke-width="1.5"/><circle cx="32" cy="36" r="4" fill="none" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "fire_store_P",       name: "Камера хранения противопожарных материалов", group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="26" text-anchor="middle" font-size="20" font-weight="bold" fill="#222">П</text>` },
  { id: "fire_ext_portable",  name: "Огнетушитель переносной",               group: "Противопожарная защита",
    svgContent: `<polygon points="24,4 44,36 4,36" fill="#dc2626" stroke="#dc2626" stroke-width="1"/>` },
  { id: "fire_foam_nozzle",   name: "Ствол пожарный пенный лафетный",        group: "Противопожарная защита",
    svgContent: `<line x1="2" y1="20" x2="28" y2="20" stroke="#dc2626" stroke-width="2"/><circle cx="34" cy="20" r="5" fill="none" stroke="#dc2626" stroke-width="1.5"/><line x1="34" y1="15" x2="34" y2="7" stroke="#dc2626" stroke-width="1.5"/><polygon points="30,14 34,7 38,14" fill="#dc2626"/>` },
  { id: "fire_store_O",       name: "Место установки огнетушителей",         group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="26" text-anchor="middle" font-size="18" font-weight="bold" fill="#222">О</text>` },
  { id: "fire_pike",          name: "Пожарная пика",                         group: "Противопожарная защита",
    svgContent: `<line x1="24" y1="4" x2="24" y2="36" stroke="#dc2626" stroke-width="2"/><line x1="14" y1="14" x2="24" y2="4" stroke="#dc2626" stroke-width="1.5"/><line x1="34" y1="14" x2="24" y2="4" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "fire_store_R",       name: "Место хранения респираторов",           group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="26" text-anchor="middle" font-size="18" font-weight="bold" fill="#222">Р</text>` },
  { id: "fire_water_curtain", name: "Противопожарная водяная завеса",        group: "Противопожарная защита",
    svgContent: `<circle cx="14" cy="20" r="6" fill="none" stroke="#dc2626" stroke-width="1.5"/><circle cx="34" cy="20" r="6" fill="none" stroke="#dc2626" stroke-width="1.5"/><line x1="20" y1="20" x2="28" y2="20" stroke="#dc2626" stroke-width="1.5"/><line x1="8" y1="20" x2="2" y2="20" stroke="#dc2626" stroke-width="1.5"/><line x1="40" y1="20" x2="46" y2="20" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "fire_nozzle_portable",name: "Ствол пожарный переносной",            group: "Противопожарная защита",
    svgContent: `<line x1="2" y1="20" x2="34" y2="20" stroke="#dc2626" stroke-width="2"/><polygon points="34,13 46,20 34,27" fill="#dc2626"/>` },
  { id: "fire_water_auto",    name: "Установка пожаротушения водяная (авт. привод, объёмная)", group: "Противопожарная защита",
    svgContent: `<polygon points="24,6 42,34 6,34" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="24" cy="24" r="5" fill="#dc2626"/><circle cx="24" cy="24" r="2" fill="white"/>` },
  { id: "fire_train_spot",    name: "Место стоянки противопожарного поезда", group: "Противопожарная защита",
    svgContent: `<rect x="4" y="6" width="40" height="28" fill="none" stroke="#222" stroke-width="1.5"/><line x1="4" y1="20" x2="44" y2="20" stroke="#dc2626" stroke-width="1.5"/><line x1="24" y1="6" x2="24" y2="34" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "pm_spot",            name: "Место стоянки противопожарной автомашины", group: "Противопожарная защита",
    svgContent: `<rect x="4" y="10" width="40" height="20" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="12" font-weight="bold" fill="#dc2626">ПМ</text>` },
  { id: "upkhvm",             name: "Участковый пункт хранения взрывчатых материалов", group: "Противопожарная защита",
    svgContent: `<rect x="2" y="12" width="44" height="16" fill="none" stroke="#dc2626" stroke-width="1.5"/><text x="24" y="24" text-anchor="middle" font-size="7" font-weight="bold" fill="#dc2626">УПХВМ</text>` },
  { id: "vgk_mobile",         name: "Мобильный пункт ВГК",                   group: "Противопожарная защита",
    svgContent: `<rect x="4" y="10" width="40" height="20" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="11" font-weight="bold" fill="#222">ВГК</text>` },
  { id: "vgk_static",         name: "Стационарный пункт ВГК",                group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#222">ВГК</text>` },
  { id: "fire_phone",         name: "Место установки телефона",              group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="1.5"/><text x="24" y="26" text-anchor="middle" font-size="14" font-weight="bold" fill="#222">Т</text>` },
  { id: "fire_sprinkler_hand",name: "Установка оросительная, дренчерная (ручная)", group: "Противопожарная защита",
    svgContent: `<circle cx="18" cy="20" r="8" fill="none" stroke="#dc2626" stroke-width="1.5"/><line x1="26" y1="20" x2="38" y2="20" stroke="#dc2626" stroke-width="1.5"/><line x1="38" y1="14" x2="38" y2="26" stroke="#dc2626" stroke-width="1.5"/><line x1="38" y1="17" x2="44" y2="14" stroke="#dc2626" stroke-width="1.2"/><line x1="38" y1="23" x2="44" y2="26" stroke="#dc2626" stroke-width="1.2"/>` },
  { id: "foam_gen_spot",      name: "Место стоянки пеногенераторной установки", group: "Противопожарная защита",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="1.5"/><line x1="10" y1="10" x2="38" y2="30" stroke="#222" stroke-width="2"/><line x1="38" y1="10" x2="10" y2="30" stroke="#222" stroke-width="2"/>` },
  { id: "fire_nozzle_spray",  name: "Ствол пожарный распылитель",            group: "Противопожарная защита",
    svgContent: `<line x1="2" y1="20" x2="28" y2="20" stroke="#dc2626" stroke-width="2"/><circle cx="34" cy="20" r="4" fill="none" stroke="#dc2626" stroke-width="1.5"/><circle cx="34" cy="20" r="1.5" fill="#dc2626"/><line x1="38" y1="20" x2="46" y2="20" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="2 2"/>` },
  { id: "fire_water_volume_hand", name: "Установка пожаротушения (ручной привод, объёмная)", group: "Противопожарная защита",
    svgContent: `<polygon points="24,6 42,34 6,34" fill="none" stroke="#dc2626" stroke-width="2"/><circle cx="24" cy="26" r="5" fill="none" stroke="#dc2626" stroke-width="1.5"/>` },

  // ─── ВОДОПРОВОД ───────────────────────────────────────────────────────
  { id: "pump",        name: "Насос",                             group: "Водопровод",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#333" stroke-width="1.5"/><path d="M14,26 Q24,8 34,26" fill="none" stroke="#333" stroke-width="1.5"/>` },
  { id: "pump_station",name: "Насос и насосная станция стационарные", group: "Водопровод",
    svgContent: `<circle cx="24" cy="20" r="14" fill="#222" stroke="#333" stroke-width="1.5"/><path d="M14,26 Q24,8 34,26" fill="none" stroke="white" stroke-width="1.5"/>` },
  { id: "valve_reduce",name: "Клапан редукционный",               group: "Водопровод",
    svgContent: `<line x1="2" y1="20" x2="14" y2="20" stroke="#1e3a8a" stroke-width="1.5"/><line x1="34" y1="20" x2="46" y2="20" stroke="#1e3a8a" stroke-width="1.5"/><rect x="14" y="10" width="20" height="20" fill="white" stroke="#1e3a8a" stroke-width="1.5"/><polygon points="18,13 30,13 24,27" fill="#1e3a8a"/>` },
  { id: "valve_water", name: "Вентиль запорный на водопроводе",   group: "Водопровод",
    svgContent: `<line x1="2" y1="20" x2="46" y2="20" stroke="#2196f3" stroke-width="1.5"/><polygon points="2,10 22,20 2,30" fill="none" stroke="#2196f3" stroke-width="1.5"/><polygon points="46,10 26,20 46,30" fill="none" stroke="#2196f3" stroke-width="1.5"/><line x1="24" y1="10" x2="24" y2="30" stroke="#2196f3" stroke-width="1.5"/>` },

  // ─── АВАРИИ ──────────────────────────────────────────────────────────
  { id: "acc_fire_place",   name: "Место пожара",                  group: "Аварии",
    svgContent: `<circle cx="24" cy="26" r="10" fill="none" stroke="#888" stroke-width="1.5"/><path d="M18,30 Q20,20 24,18 Q28,20 30,30" fill="none" stroke="#888" stroke-width="1.5"/>` },
  { id: "acc_fire_source",  name: "Очаг пожара",                   group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#dc2626" stroke-width="2"/>` },
  { id: "acc_fire_spread",  name: "Распространение пожара",        group: "Аварии",
    svgContent: `<line x1="24" y1="20" x2="24" y2="5" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="39" y2="10" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="39" y2="20" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="39" y2="30" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="24" y2="35" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="9" y2="30" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="9" y2="20" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="20" x2="9" y2="10" stroke="#dc2626" stroke-width="2"/><circle cx="24" cy="20" r="4" fill="none" stroke="#dc2626" stroke-width="1.5"/>` },
  { id: "acc_gas_explosion",name: "Место взрыва газа и пыли",      group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="14" fill="#222" stroke="#333" stroke-width="1"/><polygon points="24,6 30,18 24,14 18,18" fill="#dc2626"/><polygon points="38,20 26,18 30,24" fill="#dc2626"/>` },
  { id: "acc_gas_release",  name: "Место внезапного выброса газа и породы", group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="12" fill="none" stroke="#dc2626" stroke-width="2"/><line x1="24" y1="8" x2="24" y2="32" stroke="#dc2626" stroke-width="2"/><line x1="12" y1="20" x2="36" y2="20" stroke="#dc2626" stroke-width="2"/>` },
  { id: "acc_gas_suflar",   name: "Место суфлярного выделения газа",group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="12" fill="none" stroke="#dc2626" stroke-width="2"/><line x1="12" y1="20" x2="36" y2="20" stroke="#dc2626" stroke-width="2"/>` },
  { id: "acc_explosion",    name: "Взрыв",                         group: "Аварии",
    svgContent: `<circle cx="24" cy="22" r="14" fill="none" stroke="#888" stroke-width="1.5"/><polygon points="24,4 28,12 36,8 30,16 38,18 30,20 34,28 24,22 14,28 18,20 10,18 18,16 12,8 20,12" fill="#888"/>` },
  { id: "acc_explosion_wave",name: "Распространение взрывной волны",group: "Аварии",
    svgContent: `<path d="M4,12 L20,20 L4,28" fill="none" stroke="#222" stroke-width="2"/><polygon points="20,14 44,20 20,26" fill="#222"/>` },
  { id: "acc_explosion_place",name: "Место взрыва",                group: "Аварии",
    svgContent: `<circle cx="16" cy="20" r="12" fill="#dc2626" stroke="#333" stroke-width="1"/>` },
  { id: "acc_commander",    name: "Командир взвода",               group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#333" stroke-width="1.5"/>` },
  { id: "acc_squad_leader", name: "Командир отделения",            group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#333" stroke-width="1.5"/><line x1="10" y1="20" x2="38" y2="20" stroke="#333" stroke-width="1.5"/>` },
  { id: "acc_pb_base",      name: "Подземная база",                group: "Аварии",
    svgContent: `<rect x="4" y="10" width="40" height="20" fill="none" stroke="#333" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="11" font-weight="bold" fill="#333">П.Б</text>` },
  { id: "acc_nb_base",      name: "Наземная база",                 group: "Аварии",
    svgContent: `<rect x="4" y="10" width="40" height="20" fill="none" stroke="#333" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="11" font-weight="bold" fill="#333">Н.Б</text>` },
  { id: "acc_squad_moving", name: "Отделение в движении",          group: "Аварии",
    svgContent: `<rect x="2" y="12" width="34" height="16" fill="none" stroke="#333" stroke-width="2"/><text x="16" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#333">5 чел</text><polygon points="36,14 46,20 36,26" fill="#333"/>` },
  { id: "acc_squad_work",   name: "Отделение на месте работ",      group: "Аварии",
    svgContent: `<rect x="2" y="12" width="44" height="16" fill="none" stroke="#333" stroke-width="2"/><text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#333">5 чел</text>` },
  { id: "acc_injury_fatal", name: "Местонахождение пострадавшего-смертельно травмированного", group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#dc2626" stroke-width="2"/><line x1="12" y1="8" x2="36" y2="32" stroke="#dc2626" stroke-width="2"/><line x1="36" y1="8" x2="12" y2="32" stroke="#dc2626" stroke-width="2"/>` },
  { id: "acc_injury",       name: "Местонахождение пострадавшего-травмированного", group: "Аварии",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#2196f3" stroke-width="2"/><line x1="12" y1="8" x2="36" y2="32" stroke="#2196f3" stroke-width="2"/><line x1="36" y1="8" x2="12" y2="32" stroke="#2196f3" stroke-width="2"/>` },
  { id: "acc_rock_burst",   name: "Место проявления горного удара",group: "Аварии",
    svgContent: `<polygon points="24,4 44,36 4,36" fill="#dc2626" stroke="#8b0000" stroke-width="1"/>` },
  { id: "acc_gas_release2", name: "Газовыделение",                 group: "Аварии",
    svgContent: `<circle cx="24" cy="24" r="12" fill="none" stroke="#888" stroke-width="1.5"/><circle cx="24" cy="10" r="5" fill="#c8a882" stroke="#888" stroke-width="1"/>` },
  { id: "acc_respirator_moving", name: "Респираторщик в движении", group: "Аварии",
    svgContent: `<circle cx="20" cy="20" r="12" fill="none" stroke="#333" stroke-width="1.5"/><polygon points="32,14 44,20 32,26" fill="#333"/>` },
  { id: "acc_water_intrusion",name: "Место проникновения воды в выработку", group: "Аварии",
    svgContent: `<circle cx="20" cy="14" r="8" fill="#2196f3" stroke="#1565c0" stroke-width="1"/><circle cx="28" cy="26" r="8" fill="#2196f3" stroke="#1565c0" stroke-width="1"/><polygon points="20,22 28,26 20,30" fill="#1565c0"/>` },

  // ─── ДАТЧИКИ ──────────────────────────────────────────────────────────
  { id: "sensor_o2",  name: "Датчик кислорода",       group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="11" font-weight="bold" fill="#222">O₂</text>` },
  { id: "sensor_ch4", name: "Датчик метана",           group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">CH₄</text>` },
  { id: "sensor_co",  name: "Датчик окиси углерода",   group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="12" font-weight="bold" fill="#222">CO</text>` },
  { id: "sensor_nox", name: "Датчик окислов азота",    group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">NOx</text>` },
  { id: "sensor_h2s", name: "Датчик сероводорода",     group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">H₂S</text>` },
  { id: "sensor_co2", name: "Датчик углекислого газа", group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#222">CO₂</text>` },
  { id: "sensor_v",   name: "Датчик скорости воздуха", group: "Датчики",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#222" stroke-width="2"/><text x="24" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="#222">V</text>` },

  // ─── РАСЧЁТ КОЛИЧЕСТВА ВОЗДУХА ────────────────────────────────────────
  { id: "calc_blast",      name: "Взрывные работы",                  group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="16" r="11" fill="none" stroke="#888" stroke-width="1.5"/><path d="M18,20 Q20,14 24,12 Q28,14 30,20" fill="none" stroke="#888" stroke-width="1.5"/><line x1="16" y1="30" x2="20" y2="32" stroke="#888" stroke-width="2"/><line x1="22" y1="28" x2="26" y2="32" stroke="#888" stroke-width="2"/>` },
  { id: "calc_blast_mass", name: "Массовые взрывные работы",         group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="16" r="11" fill="none" stroke="#dc2626" stroke-width="1.5"/><path d="M18,20 Q20,14 24,12 Q28,14 30,20" fill="none" stroke="#dc2626" stroke-width="1.5"/><line x1="16" y1="30" x2="20" y2="32" stroke="#dc2626" stroke-width="2"/><line x1="22" y1="28" x2="26" y2="32" stroke="#dc2626" stroke-width="2"/>` },
  { id: "calc_combine",    name: "Горный комбайн",                   group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#888" stroke-width="1.5"/><line x1="24" y1="6" x2="24" y2="10" stroke="#888" stroke-width="2"/><line x1="32" y1="9" x2="30" y2="12" stroke="#888" stroke-width="2"/><line x1="38" y1="14" x2="35" y2="16" stroke="#888" stroke-width="2"/><line x1="38" y1="20" x2="34" y2="20" stroke="#888" stroke-width="2"/><line x1="24" y1="34" x2="24" y2="30" stroke="#888" stroke-width="2"/><line x1="16" y1="31" x2="18" y2="28" stroke="#888" stroke-width="2"/><line x1="10" y1="26" x2="13" y2="24" stroke="#888" stroke-width="2"/><line x1="10" y1="20" x2="14" y2="20" stroke="#888" stroke-width="2"/>` },
  { id: "calc_engine",     name: "Двигатель внутреннего сгорания",   group: "Расчёт количества воздуха",
    svgContent: `<circle cx="30" cy="20" r="12" fill="none" stroke="#888" stroke-width="1.5"/><circle cx="30" cy="20" r="5" fill="#888"/><rect x="4" y="15" width="16" height="10" fill="none" stroke="#888" stroke-width="1.5"/>` },
  { id: "calc_tech_room",  name: "Технологическая камера",           group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#888" stroke-width="1.5"/><line x1="14" y1="26" x2="28" y2="26" stroke="#888" stroke-width="2"/><line x1="20" y1="14" x2="20" y2="26" stroke="#888" stroke-width="2"/><circle cx="20" cy="13" r="3" fill="none" stroke="#888" stroke-width="1.5"/>` },
  { id: "calc_people",     name: "Люди",                             group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#888" stroke-width="1.5"/><circle cx="24" cy="13" r="4" fill="#888"/><line x1="24" y1="17" x2="24" y2="28" stroke="#888" stroke-width="2"/><line x1="17" y1="21" x2="31" y2="21" stroke="#888" stroke-width="1.5"/><line x1="24" y1="28" x2="19" y2="35" stroke="#888" stroke-width="1.5"/><line x1="24" y1="28" x2="29" y2="35" stroke="#888" stroke-width="1.5"/>` },
  { id: "calc_vmin",       name: "Минимальная скорость воздуха",     group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="24" text-anchor="middle" font-size="9" font-weight="bold" fill="#888">Vmin</text>` },
  { id: "calc_ch4_emit",   name: "Выделение метана",                 group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#888">CH₄</text>` },
  { id: "calc_co_emit",    name: "Выделение окиси углерода",         group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="12" font-weight="bold" fill="#888">CO</text>` },
  { id: "calc_nox_emit",   name: "Выделение окислов азота",          group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#888">NOₓ</text>` },
  { id: "calc_so2_emit",   name: "Выделение сернистого газа",        group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#888">SO₂</text>` },
  { id: "calc_h2s_emit",   name: "Выделение сероводорода",           group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#888">H₂S</text>` },
  { id: "calc_co2_emit",   name: "Выделение углекислого газа",       group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="15" fill="none" stroke="#888" stroke-width="1.5"/><text x="24" y="25" text-anchor="middle" font-size="10" font-weight="bold" fill="#888">CO₂</text>` },
  { id: "calc_diffusion",  name: "Диффузионное проветривание после взрыва", group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#888" stroke-width="1.5"/><line x1="12" y1="16" x2="36" y2="16" stroke="#888" stroke-width="1"/><line x1="12" y1="20" x2="36" y2="20" stroke="#888" stroke-width="1"/><line x1="12" y1="24" x2="36" y2="24" stroke="#888" stroke-width="1"/><polygon points="34,13 40,16 34,19" fill="#888"/><polygon points="34,17 40,20 34,23" fill="#888"/><polygon points="34,21 40,24 34,27" fill="#888"/>` },
  { id: "calc_dust",       name: "Вынос пыли",                       group: "Расчёт количества воздуха",
    svgContent: `<circle cx="24" cy="20" r="14" fill="none" stroke="#888" stroke-width="1.5"/><polygon points="6,20 14,16 14,24" fill="#dc2626"/><circle cx="20" cy="16" r="2" fill="#888"/><circle cx="24" cy="14" r="2" fill="#888"/><circle cx="28" cy="16" r="2" fill="#888"/><circle cx="20" cy="24" r="2" fill="#888"/><circle cx="24" cy="26" r="2" fill="#888"/><circle cx="28" cy="24" r="2" fill="#888"/>` },

  // ─── ТЕПЛО И ГАЗОВЫДЕЛЕНИЕ ────────────────────────────────────────────
  { id: "heat_fire",          name: "Пожар",                         group: "Тепло и газовыделение",
    svgContent: `<circle cx="24" cy="28" r="10" fill="none" stroke="#dc2626" stroke-width="1.5"/><path d="M18,36 Q20,24 24,20 Q28,24 30,36" fill="#ff5722" stroke="#dc2626" stroke-width="1"/><path d="M20,36 Q22,28 24,24 Q26,28 28,36" fill="#ffd600"/>` },
  { id: "heat_conveyor_belt", name: "Конвейерная лента",             group: "Тепло и газовыделение",
    svgContent: `<rect x="4" y="15" width="40" height="5" fill="none" stroke="#333" stroke-width="1.5"/><rect x="4" y="22" width="40" height="5" fill="none" stroke="#333" stroke-width="1.5"/>` },
  { id: "heat_conveyor_drive",name: "Привод конвейера",              group: "Тепло и газовыделение",
    svgContent: `<polygon points="4,14 44,20 4,26" fill="#333"/>` },
  { id: "heat_selfprop",      name: "Самоходное двигательное оборудование", group: "Тепло и газовыделение",
    svgContent: `<circle cx="16" cy="24" r="8" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="16" cy="24" r="3" fill="#333"/><circle cx="34" cy="24" r="8" fill="none" stroke="#333" stroke-width="1.5"/><circle cx="34" cy="24" r="3" fill="#333"/><rect x="10" y="12" width="28" height="12" fill="none" stroke="#333" stroke-width="1.5"/>` },

  // ─── ЭЛЕКТРОСНАБЖЕНИЕ ─────────────────────────────────────────────────
  { id: "elec_cable_lv",  name: "Кабельная муфта-силовой кабель 0,4-0,66 кВ", group: "Электроснабжение",
    svgContent: `<polygon points="4,15 44,20 4,25" fill="#2196f3"/>` },
  { id: "elec_cable_hv",  name: "Кабельная муфта-силовой кабель 6 кВ",        group: "Электроснабжение",
    svgContent: `<polygon points="4,15 44,20 4,25" fill="#dc2626"/>` },
  { id: "elec_winch",     name: "Лебёдка",                                     group: "Электроснабжение",
    svgContent: `<rect x="6" y="8" width="16" height="24" fill="none" stroke="#333" stroke-width="1.5"/><rect x="26" y="8" width="16" height="24" fill="none" stroke="#333" stroke-width="1.5"/><line x1="6" y1="20" x2="22" y2="20" stroke="#333" stroke-width="1"/><line x1="26" y1="20" x2="42" y2="20" stroke="#333" stroke-width="1"/>` },
  { id: "elec_dist",      name: "Распределительный пункт",                     group: "Электроснабжение",
    svgContent: `<rect x="6" y="6" width="36" height="28" fill="#222" stroke="#333" stroke-width="1.5"/><line x1="6" y1="6" x2="42" y2="34" stroke="white" stroke-width="2"/><line x1="42" y1="6" x2="6" y2="34" stroke="white" stroke-width="2"/>` },
  { id: "elec_substation",name: "Участковая подстанция",                       group: "Электроснабжение",
    svgContent: `<rect x="6" y="6" width="36" height="28" fill="none" stroke="#333" stroke-width="1.5"/>` },

  // ─── ПОЖАР (расчётный очаг) ──────────────────────────────────────────
  // Символ по ГОСТ: сплошной красный круг с 8 расходящимися лучами (солнце).
  { id: "fire_source", name: "Очаг пожара",           group: "Аварийный режим",
    svgContent: `<circle cx="24" cy="24" r="10" fill="#FF0100"/><g fill="#FF0100"><polygon points="24,1 21,10 27,10"/><polygon points="24,47 21,38 27,38"/><polygon points="1,24 10,21 10,27"/><polygon points="47,24 38,21 38,27"/><polygon points="7.8,7.8 14.5,11.3 11.3,14.5"/><polygon points="40.2,40.2 33.5,36.7 36.7,33.5"/><polygon points="40.2,7.8 33.5,11.3 36.7,14.5"/><polygon points="7.8,40.2 14.5,36.7 11.3,33.5"/></g>` },

  // ─── ВЗРЫВ (расчётный источник) ──────────────────────────────────────
  { id: "explosion_source", name: "Источник взрыва",  group: "Аварийный режим",
    svgContent: `<circle cx="24" cy="20" r="9" fill="#fbbf24" stroke="#92400e" stroke-width="1.2" opacity="0.95"/>
<path d="M24,4 L26,14 L36,8 L28,16 L38,18 L28,20 L36,30 L26,24 L24,36 L22,24 L12,30 L20,20 L10,18 L20,16 L12,8 L22,14 Z" fill="#ef4444" stroke="#7f1d1d" stroke-width="0.8" stroke-linejoin="round"/>
<circle cx="24" cy="20" r="5" fill="#fef3c7" stroke="#f59e0b" stroke-width="1"/>
<circle cx="24" cy="20" r="2.5" fill="white" opacity="0.9"/>` },

  // ─── УЗЛЫ ─────────────────────────────────────────────────────────────
  { id: "node_normal", name: "Узел (сопряжение)",    group: "Узлы",
    svgContent: `<circle cx="20" cy="20" r="8" fill="#c8a882" stroke="#1f2937" stroke-width="1.5"/><text x="31" y="24" font-size="10" fill="#1f2937" font-weight="600">001</text>` },
  { id: "node_atm",    name: "Узел-атмосфера (выход)", group: "Узлы",
    svgContent: `<circle cx="24" cy="20" r="13" fill="#e0f7fa" stroke="#00838f" stroke-width="1.5" stroke-dasharray="4 2"/><circle cx="24" cy="20" r="5" fill="#00bcd4" stroke="#00838f" stroke-width="1"/>` },
];

// ID перемычек с полностью открытой дверью на всё сечение (R = 0 всегда)
export const OPEN_DOOR_IDS = new Set([
  "open_base", "open_conc", "open_wood", "open_brick", "open_metal",
  "regulator_open",
]);

// ID перемычек с окном/проёмом/открытой дверью (требуется поле S вентокна)
export const WINDOW_BULKHEAD_IDS = new Set([
  "regulator_open", "regulator_window", "regulator_lattice", "bulkhead_window",
  "open_base", "open_conc", "open_wood", "open_brick", "open_metal",
  "win_base", "win_conc", "win_wood", "win_brick", "win_metal",
  "lat_base", "lat_conc", "lat_wood", "lat_brick", "lat_metal",
  "proem_base", "proem_conc", "proem_wood", "proem_brick", "proem_metal",
]);

// ID редукционных клапанов водопровода ППЗ
export const REDUCER_SYMBOL_IDS = new Set([
  "valve_reduce",
]);

// ID символов очага пожара (аварийный режим)
export const FIRE_SYMBOL_IDS = new Set([
  "fire_source",
]);

// ID символов источника взрыва (аварийный режим)
export const EXPLOSION_SYMBOL_IDS = new Set([
  "explosion_source",
]);

// ID всех перемычек для группировки в выпадающем списке
export const BULKHEAD_SYMBOL_IDS = new Set([
  "bulkhead", "bulkhead_concrete", "bulkhead_wood", "bulkhead_brick", "bulkhead_metal",
  "bk_base", "bk_concrete", "bk_wood", "bk_brick", "bk_metal",
  "door_closed", "door_closed_concrete", "door_closed_wood", "door_closed_brick", "door_closed_metal",
  "door_base", "door_conc", "door_wood", "door_brick", "door_metal",
  "door_auto", "door_auto_concrete", "door_auto_wood", "door_auto_brick", "door_auto_metal",
  "auto_base", "auto_conc", "auto_wood", "auto_brick", "auto_metal",
  "sail",
  "water_dam", "water_dam_concrete", "water_dam_wood", "water_dam_brick", "water_dam_metal",
  "regulator", "regulator_open", "regulator_window", "regulator_lattice", "bulkhead_window",
  "open_base", "open_conc", "open_wood", "open_brick", "open_metal",
  "win_base", "win_conc", "win_wood", "win_brick", "win_metal",
  "lat_base", "lat_conc", "lat_wood", "lat_brick", "lat_metal",
  "proem_base", "proem_conc", "proem_wood", "proem_brick", "proem_metal",
  "bulkhead_barrier", "fire_door", "barrier", "fire_door_pp",
]);