// Условные обозначения — полный справочник по АэроСети
import { useState } from "react";
import Icon from "@/components/ui/icon";

interface Props { onClose: () => void; }
interface LegendItem { id: string; name: string; svg: React.ReactNode; group: string; }

// ─── Helper: перемычка в справочнике УО ───────────────────────────────────
// viewBox 0 0 48 40, ось ветви — горизонтальная y=20, перемычка поперёк по x≈24
// Прямоугольник: вертикальный (x=20..28, y=4..36)
function Bk({ fill = "white", stroke = "#222", door = false, auto = false, water = false, window_ = false, lattice = false, open_ = false }: {
  fill?: string; stroke?: string; door?: boolean; auto?: boolean; water?: boolean; window_?: boolean; lattice?: boolean; open_?: boolean;
}) {
  return (
    <svg width={48} height={40} viewBox="0 0 48 40">
      {open_ ? (
        // Открытая дверь: два блока (верх + низ) + диагональная створка
        <>
          <rect x={20} y={4}  width={8} height={12} fill={fill} stroke={stroke} strokeWidth={1.5} />
          <rect x={20} y={24} width={8} height={12} fill={fill} stroke={stroke} strokeWidth={1.5} />
          <line x1={20} y1={24} x2={8} y2={36} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
        </>
      ) : (
        // Глухая / закрытая / авто: один сплошной блок
        <rect x={20} y={4} width={8} height={32} fill={fill} stroke={stroke} strokeWidth={1.5} />
      )}

      {/* Закрытая дверь: жирная линия вдоль левого края */}
      {(door || auto) && !open_ && (
        <line x1={20} y1={4} x2={20} y2={36} stroke={stroke} strokeWidth={3} strokeLinecap="round" />
      )}

      {/* Кружок «А» — автоматическая */}
      {auto && (
        <>
          <circle cx={37} cy={20} r={7} fill="white" stroke={stroke} strokeWidth={1.2} />
          <text x={37} y={24} textAnchor="middle" fontSize={9} fontWeight="bold" fill={stroke}>А</text>
        </>
      )}

      {/* Буква D — водоподпорная */}
      {water && (
        <text x={24} y={24} textAnchor="middle" fontSize={10} fontWeight="bold"
          fill={fill === "white" ? "#1565c0" : "#fff"}>D</text>
      )}

      {/* Окно / проём */}
      {window_ && (
        <rect x={21} y={14} width={6} height={12} fill="white" stroke={stroke} strokeWidth={1} />
      )}

      {/* Решётка */}
      {lattice && <>
        <line x1={22} y1={6} x2={22} y2={34} stroke={stroke} strokeWidth={0.9} />
        <line x1={25} y1={6} x2={25} y2={34} stroke={stroke} strokeWidth={0.9} />
        <line x1={28} y1={6} x2={28} y2={34} stroke={stroke} strokeWidth={0.9} />
        <line x1={20} y1={13} x2={28} y2={13} stroke={stroke} strokeWidth={0.9} />
        <line x1={20} y1={20} x2={28} y2={20} stroke={stroke} strokeWidth={0.9} />
        <line x1={20} y1={27} x2={28} y2={27} stroke={stroke} strokeWidth={0.9} />
      </>}
    </svg>
  );
}

// ─── Helper: круг с текстом (датчик / место хранения) ─────────────────────
function CircleLabel({ text, stroke = "#222", fill = "none", textFill, bold = true, r = 15, fontSize = 10 }: {
  text: string; stroke?: string; fill?: string; textFill?: string; bold?: boolean; r?: number; fontSize?: number;
}) {
  return (
    <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
      <text x={24} y={24} textAnchor="middle" fontSize={fontSize} fontWeight={bold ? "bold" : "normal"} fill={textFill ?? stroke}>{text}</text>
    </svg>
  );
}

const S = "#333"; // default stroke

const ITEMS: LegendItem[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // ВЕНТИЛЯЦИОННЫЕ СТРУИ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "measure_station", group: "Вентиляционные струи", name: "Станция замера количества воздуха",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={15} x2={46} y2={15} stroke="#dc2626" strokeWidth={3} />
      <line x1={2} y1={23} x2={46} y2={23} stroke="#dc2626" strokeWidth={3} />
    </svg>,
  },
  {
    id: "fresh_inlet", group: "Вентиляционные струи", name: "Струя входящая-нисходящее проветривание",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={2.5} />
      <polygon points="36,14 46,20 36,26" fill="#dc2626" />
    </svg>,
  },
  {
    id: "exhaust_outlet", group: "Вентиляционные струи", name: "Струя исходящая-восходящее проветривание",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={38} y2={20} stroke="#2196f3" strokeWidth={2.5} />
      <polygon points="12,14 2,20 12,26" fill="#2196f3" />
    </svg>,
  },
  {
    id: "leak_inlet", group: "Вентиляционные струи", name: "Утечка воздуха входящая-нисходящая",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={2} strokeDasharray="6 4" />
      <polygon points="36,14 46,20 36,26" fill="#dc2626" />
    </svg>,
  },
  {
    id: "leak_outlet", group: "Вентиляционные струи", name: "Утечка воздуха исходящая-восходящая",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={38} y2={20} stroke="#2196f3" strokeWidth={2} strokeDasharray="6 4" />
      <polygon points="12,14 2,20 12,26" fill="#2196f3" />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ВЕНТИЛЯТОРЫ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "fan_local", group: "Вентиляторы", name: "Вентилятор местного проветривания, временный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke={S} strokeWidth={1.5} />
      <line x1={9} y1={20} x2={39} y2={20} stroke={S} strokeWidth={1.5} />
      <line x1={24} y1={5} x2={24} y2={35} stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fan_axial", group: "Вентиляторы", name: "Вентилятор стационарный осевой",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="#222" stroke={S} strokeWidth={1.5} />
      <circle cx={24} cy={20} r={6} fill="white" />
    </svg>,
  },
  {
    id: "fan_recirculate", group: "Вентиляторы", name: "Рециркулирующая установка",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke={S} strokeWidth={1.5} />
      <line x1={9} y1={9} x2={39} y2={31} stroke={S} strokeWidth={1.5} />
      <line x1={39} y1={9} x2={9} y2={31} stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fan_stationary", group: "Вентиляторы", name: "Вентилятор стационарный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke={S} strokeWidth={1.5} />
      <circle cx={24} cy={20} r={6} fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ГЛУХИЕ ПЕРЕМЫЧКИ
  // ══════════════════════════════════════════════════════════════════════════
  { id: "bk_base",     group: "Глухие перемычки", name: "Глухая перемычка",           svg: <Bk /> },
  { id: "bk_concrete", group: "Глухие перемычки", name: "Глухая перемычка бетонная",  svg: <Bk fill="#4caf50" stroke="#2e7d32" /> },
  { id: "bk_wood",     group: "Глухие перемычки", name: "Глухая перемычка деревянная",svg: <Bk fill="#ffd600" stroke="#f57f17" /> },
  { id: "bk_brick",    group: "Глухие перемычки", name: "Глухая перемычка кирпичная", svg: <Bk fill="#ff9800" stroke="#e65100" /> },
  { id: "bk_metal",    group: "Глухие перемычки", name: "Глухая перемычка металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" /> },
  { id: "door_base",   group: "Глухие перемычки", name: "Дверь вентиляционная закрытая",        svg: <Bk door /> },
  { id: "door_conc",   group: "Глухие перемычки", name: "Дверь вентиляционная закрытая бетонная", svg: <Bk fill="#4caf50" stroke="#2e7d32" door /> },
  { id: "door_wood",   group: "Глухие перемычки", name: "Дверь вентиляционная закрытая деревянная", svg: <Bk fill="#ffd600" stroke="#f57f17" door /> },
  { id: "door_brick",  group: "Глухие перемычки", name: "Дверь вентиляционная закрытая кирпичная",  svg: <Bk fill="#ff9800" stroke="#e65100" door /> },
  { id: "door_metal",  group: "Глухие перемычки", name: "Дверь вентиляционная закрытая металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" door /> },
  { id: "auto_base",   group: "Глухие перемычки", name: "Дверь вентиляционная автоматическая",          svg: <Bk door auto /> },
  { id: "auto_conc",   group: "Глухие перемычки", name: "Дверь вентиляционная автоматическая бетонная", svg: <Bk fill="#4caf50" stroke="#2e7d32" door auto /> },
  { id: "auto_wood",   group: "Глухие перемычки", name: "Дверь вентиляционная автоматическая деревянная", svg: <Bk fill="#ffd600" stroke="#f57f17" door auto /> },
  { id: "auto_brick",  group: "Глухие перемычки", name: "Дверь вентиляционная автоматическая кирпичная", svg: <Bk fill="#ff9800" stroke="#e65100" door auto /> },
  { id: "auto_metal",  group: "Глухие перемычки", name: "Дверь вентиляционная автоматическая металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" door auto /> },
  {
    id: "sail", group: "Глухие перемычки", name: "Парусная перемычка",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={22} y1={4} x2={22} y2={36} stroke={S} strokeWidth={2} strokeLinecap="round" />
      <path d="M22,10 Q38,14 38,20 Q38,26 22,30" fill="none" stroke={S} strokeWidth={2} strokeLinecap="round" />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ПЕРЕМЫЧКИ С ВЕНТИЛЯЦИОННЫМ ОКНОМ
  // ══════════════════════════════════════════════════════════════════════════
  { id: "open_base",   group: "Перемычки с вент. окном", name: "Дверь вентиляционная открытая",           svg: <Bk open_ /> },
  { id: "open_conc",   group: "Перемычки с вент. окном", name: "Дверь вентиляционная открытая бетонная",  svg: <Bk fill="#4caf50" stroke="#2e7d32" open_ /> },
  { id: "open_wood",   group: "Перемычки с вент. окном", name: "Дверь вентиляционная открытая деревянная",svg: <Bk fill="#ffd600" stroke="#f57f17" open_ /> },
  { id: "open_brick",  group: "Перемычки с вент. окном", name: "Дверь вентиляционная открытая кирпичная", svg: <Bk fill="#ff9800" stroke="#e65100" open_ /> },
  { id: "open_metal",  group: "Перемычки с вент. окном", name: "Дверь вентиляционная открытая металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" open_ /> },
  { id: "win_base",    group: "Перемычки с вент. окном", name: "Дверь с регулируемым окном",              svg: <Bk window_ /> },
  { id: "win_conc",    group: "Перемычки с вент. окном", name: "Дверь с регулируемым окном бетонная",     svg: <Bk fill="#4caf50" stroke="#2e7d32" window_ /> },
  { id: "win_wood",    group: "Перемычки с вент. окном", name: "Дверь с регулируемым окном деревянная",   svg: <Bk fill="#ffd600" stroke="#f57f17" window_ /> },
  { id: "win_brick",   group: "Перемычки с вент. окном", name: "Дверь с регулируемым окном кирпичная",   svg: <Bk fill="#ff9800" stroke="#e65100" window_ /> },
  { id: "win_metal",   group: "Перемычки с вент. окном", name: "Дверь с регулируемым окном металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" window_ /> },
  { id: "lat_base",    group: "Перемычки с вент. окном", name: "Дверь вентиляционная решётчатая",          svg: <Bk lattice /> },
  { id: "lat_conc",    group: "Перемычки с вент. окном", name: "Дверь вентиляционная решётчатая бетонная", svg: <Bk fill="#4caf50" stroke="#2e7d32" lattice /> },
  { id: "lat_wood",    group: "Перемычки с вент. окном", name: "Дверь вентиляционная решётчатая деревянная",svg: <Bk fill="#ffd600" stroke="#f57f17" lattice /> },
  { id: "lat_brick",   group: "Перемычки с вент. окном", name: "Дверь вентиляционная решётчатая кирпичная", svg: <Bk fill="#ff9800" stroke="#e65100" lattice /> },
  { id: "lat_metal",   group: "Перемычки с вент. окном", name: "Дверь вентиляционная решётчатая металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" lattice /> },
  { id: "proem_base",  group: "Перемычки с вент. окном", name: "Перемычка с проёмом",           svg: <Bk window_ /> },
  { id: "proem_conc",  group: "Перемычки с вент. окном", name: "Перемычка с проёмом бетонная",  svg: <Bk fill="#4caf50" stroke="#2e7d32" window_ /> },
  { id: "proem_wood",  group: "Перемычки с вент. окном", name: "Перемычка с проёмом деревянная",svg: <Bk fill="#ffd600" stroke="#f57f17" window_ /> },
  { id: "proem_brick", group: "Перемычки с вент. окном", name: "Перемычка с проёмом кирпичная", svg: <Bk fill="#ff9800" stroke="#e65100" window_ /> },
  { id: "proem_metal", group: "Перемычки с вент. окном", name: "Перемычка с проёмом металлическая", svg: <Bk fill="#9c27b0" stroke="#6a1b9a" window_ /> },
  {
    id: "barrier", group: "Перемычки с вент. окном", name: "Перемычка барьерная",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={19} y={4} width={5} height={32} fill="#555" stroke={S} strokeWidth={1.2} />
      <rect x={24} y={4} width={5} height={32} fill="#c00" stroke="#800" strokeWidth={1.2} />
    </svg>,
  },
  {
    id: "fire_door_pp", group: "Перемычки с вент. окном", name: "Противопожарная дверь",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={20} y1={4} x2={20} y2={36} stroke="#dc2626" strokeWidth={3.5} />
      <line x1={27} y1={4} x2={27} y2={36} stroke="#dc2626" strokeWidth={3.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ВЕРТИКАЛЬНЫЕ ВЫРАБОТКИ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "vert_sq_section", group: "Вертикальные выработки", name: "Сечение вертикальной выработки квадратное",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={4} width={36} height={32} fill="none" stroke={S} strokeWidth={2} />
      <line x1={6} y1={4} x2={42} y2={36} stroke={S} strokeWidth={2} />
      <line x1={42} y1={4} x2={6} y2={36} stroke={S} strokeWidth={2} />
    </svg>,
  },
  {
    id: "vert_circ_section", group: "Вертикальные выработки", name: "Сечение вертикальной выработки круглое",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="none" stroke={S} strokeWidth={2} />
      <line x1={12} y1={8} x2={36} y2={32} stroke={S} strokeWidth={2} />
      <line x1={36} y1={8} x2={12} y2={32} stroke={S} strokeWidth={2} />
    </svg>,
  },
  {
    id: "vert_sq_mouth", group: "Вертикальные выработки", name: "Устье вертикальной выработки квадратное",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={4} width={36} height={32} fill="none" stroke={S} strokeWidth={2} />
      <line x1={6} y1={4} x2={42} y2={36} stroke={S} strokeWidth={2} />
      <polygon points="6,4 42,4 42,36" fill="#222" />
    </svg>,
  },
  {
    id: "vert_circ_mouth", group: "Вертикальные выработки", name: "Устье вертикальной выработки круглое",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="none" stroke={S} strokeWidth={2} />
      <path d="M24,4 A16,16 0 0,1 40,20 A16,16 0 0,1 24,36Z" fill="#222" />
    </svg>,
  },
  {
    id: "vert_sq_full", group: "Вертикальные выработки", name: "Устье и сечение вертикального ствола прямоугольное",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={4} width={36} height={32} fill="#222" stroke={S} strokeWidth={2} />
      <polygon points="6,4 42,4 42,36" fill="white" />
    </svg>,
  },
  {
    id: "vert_circ_full", group: "Вертикальные выработки", name: "Устье и сечение вертикального ствола круглое",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="#222" stroke={S} strokeWidth={2} />
      <path d="M24,4 A16,16 0 0,1 40,20 A16,16 0 0,1 24,36Z" fill="white" />
    </svg>,
  },
  {
    id: "slope_circ_full", group: "Вертикальные выработки", name: "Устье и сечение наклонного ствола круглое",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <ellipse cx={24} cy={30} rx={14} ry={8} fill="#222" stroke={S} strokeWidth={1.5} />
      <path d="M10,30 L10,10 Q24,2 38,10 L38,30" fill="white" stroke={S} strokeWidth={1.5} />
      <ellipse cx={24} cy={10} rx={14} ry={8} fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "slope_rect_full", group: "Вертикальные выработки", name: "Устье и сечение наклонного ствола прямоугольное",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="6,36 6,14 24,4 42,14 42,36" fill="#222" stroke={S} strokeWidth={1.5} />
      <polygon points="6,14 24,4 42,14 42,36 24,28 6,36" fill="white" />
      <line x1={6} y1={14} x2={42} y2={14} stroke={S} strokeWidth={1.5} />
      <line x1={24} y1={4} x2={24} y2={28} stroke={S} strokeWidth={1.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ПРОТИВОПОЖАРНАЯ ЗАЩИТА
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "fire_valve", group: "Противопожарная защита", name: "Вентиль запорный на воздухопроводе",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <polygon points="4,10 24,20 4,30" fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <polygon points="44,10 24,20 44,30" fill="none" stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  { id: "selfrescuer", group: "Противопожарная защита", name: "Место хранения самоспасателей",
    svg: <CircleLabel text="С" stroke="#222" fontSize={18} r={15} /> },
  {
    id: "fire_hose_roll", group: "Противопожарная защита", name: "Рукав пожарный напорный, в скатку",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={24} cy={20} r={10} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={24} cy={20} r={5} fill="none" stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fire_nozzle_hand", group: "Противопожарная защита", name: "Ствол пожарный ручной",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={36} y2={20} stroke="#dc2626" strokeWidth={2} />
      <polygon points="36,13 46,20 36,27" fill="#dc2626" />
    </svg>,
  },
  {
    id: "fire_water_local", group: "Противопожарная защита", name: "Установка пожаротушения водяная (ручной привод, локальная)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,6 42,34 6,34" fill="none" stroke="#dc2626" strokeWidth={2} />
      <circle cx={24} cy={24} r={5} fill="#dc2626" />
    </svg>,
  },
  {
    id: "ppt_box", group: "Противопожарная защита", name: "Пункт подключения пожаротушащей техники",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke="#dc2626" strokeWidth={2} />
      <text x={24} y={25} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#dc2626">ППТ</text>
    </svg>,
  },
  {
    id: "fire_sprinkler_auto", group: "Противопожарная защита", name: "Установка оросительная, дренчерная (автоматическая)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={18} cy={20} r={8} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <line x1={26} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={38} y1={14} x2={38} y2={26} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={38} y1={17} x2={44} y2={14} stroke="#dc2626" strokeWidth={1.2} />
      <line x1={38} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={1.2} />
      <line x1={38} y1={23} x2={44} y2={26} stroke="#dc2626" strokeWidth={1.2} />
    </svg>,
  },
  {
    id: "fire_inlet", group: "Противопожарная защита", name: "Место подключения воздухопровода на подачу воды",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="2,8 46,20 2,32" fill="#dc2626" />
    </svg>,
  },
  {
    id: "fire_sprayer", group: "Противопожарная защита", name: "Водяной распылитель",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={28} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={34} cy={20} r={6} fill="#dc2626" />
    </svg>,
  },
  {
    id: "fire_ext_mobile", group: "Противопожарная защита", name: "Огнетушитель передвижной",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,4 44,36 4,36" fill="none" stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "fire_hose_laid", group: "Противопожарная защита", name: "Рукав пожарный напорный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <path d="M4,20 Q12,10 20,20 Q28,30 36,20 Q44,10 48,20" fill="none" stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "fire_nozzle_static", group: "Противопожарная защита", name: "Ствол пожарный стационарный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={30} y2={20} stroke="#dc2626" strokeWidth={2} />
      <line x1={30} y1={12} x2={30} y2={28} stroke="#dc2626" strokeWidth={2} />
      <polygon points="30,13 46,20 30,27" fill="#dc2626" />
    </svg>,
  },
  {
    id: "fire_radio", group: "Противопожарная защита", name: "Пункт радиосвязи",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={24} r={12} fill="none" stroke="#222" strokeWidth={1.5} />
      <path d="M16,18 Q24,6 32,18" fill="none" stroke="#222" strokeWidth={2} />
      <line x1={20} y1={16} x2={28} y2={24} stroke="#222" strokeWidth={2} />
    </svg>,
  },
  {
    id: "fire_tv", group: "Противопожарная защита", name: "Пункт телевидения",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={8} width={36} height={24} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={16} fontWeight="bold" fill="#222">Т</text>
    </svg>,
  },
  {
    id: "fire_crane", group: "Противопожарная защита", name: "Пожарный кран",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={24} y1={4} x2={24} y2={24} stroke="#dc2626" strokeWidth={2} />
      <circle cx={24} cy={30} r={7} fill="none" stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "fire_crane_conn", group: "Противопожарная защита", name: "Кран пожарный соединительная головка",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={24} y1={4} x2={24} y2={18} stroke="#dc2626" strokeWidth={2} />
      <circle cx={24} cy={28} r={10} fill="none" stroke="#dc2626" strokeWidth={2} />
      <circle cx={16} cy={36} r={4} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={32} cy={36} r={4} fill="none" stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  { id: "fire_store_P", group: "Противопожарная защита", name: "Камера хранения противопожарных материалов",
    svg: <CircleLabel text="П" stroke="#222" fontSize={20} r={15} /> },
  {
    id: "fire_ext_portable", group: "Противопожарная защита", name: "Огнетушитель переносной",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,4 44,36 4,36" fill="#dc2626" stroke="#dc2626" strokeWidth={1} />
    </svg>,
  },
  {
    id: "fire_foam_nozzle", group: "Противопожарная защита", name: "Ствол пожарный пенный лафетный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={28} y2={20} stroke="#dc2626" strokeWidth={2} />
      <circle cx={34} cy={20} r={5} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <line x1={34} y1={15} x2={34} y2={7} stroke="#dc2626" strokeWidth={1.5} />
      <polygon points="30,14 34,7 38,14" fill="#dc2626" />
    </svg>,
  },
  { id: "fire_store_O", group: "Противопожарная защита", name: "Место установки огнетушителей",
    svg: <CircleLabel text="О" stroke="#222" fontSize={18} r={15} /> },
  {
    id: "fire_pike", group: "Противопожарная защита", name: "Пожарная пика",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={24} y1={4} x2={24} y2={36} stroke="#dc2626" strokeWidth={2} />
      <line x1={14} y1={14} x2={24} y2={4} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={34} y1={14} x2={24} y2={4} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={14} y1={18} x2={24} y2={14} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={34} y1={18} x2={24} y2={14} stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  { id: "fire_store_R", group: "Противопожарная защита", name: "Место хранения респираторов",
    svg: <CircleLabel text="Р" stroke="#222" fontSize={18} r={15} /> },
  {
    id: "fire_water_curtain", group: "Противопожарная защита", name: "Противопожарная водяная завеса",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={14} cy={20} r={6} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={34} cy={20} r={6} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <line x1={20} y1={20} x2={28} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={8} y1={20} x2={2} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={40} y1={20} x2={46} y2={20} stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fire_nozzle_portable", group: "Противопожарная защита", name: "Ствол пожарный переносной",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={34} y2={20} stroke="#dc2626" strokeWidth={2} />
      <polygon points="34,13 46,20 34,27" fill="#dc2626" />
    </svg>,
  },
  {
    id: "fire_water_auto", group: "Противопожарная защита", name: "Установка пожаротушения водяная (авт. привод, объёмная)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,6 42,34 6,34" fill="none" stroke="#dc2626" strokeWidth={2} />
      <circle cx={24} cy={24} r={5} fill="#dc2626" />
      <circle cx={24} cy={24} r={2} fill="white" />
    </svg>,
  },
  {
    id: "fire_train_spot", group: "Противопожарная защита", name: "Место стоянки противопожарного поезда",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={6} width={40} height={28} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={4} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={24} y1={6} x2={24} y2={34} stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fire_store_mat", group: "Противопожарная защита", name: "Пункт хранения противопожарных материалов и оборудования",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={4} width={40} height={32} fill="none" stroke="#222" strokeWidth={1.5} />
      {[8,14,20,26,32,38].map(x => [8,14,20,26].map(y => <circle key={`${x}${y}`} cx={x} cy={y+4} r={2.5} fill="#dc2626" />))}
    </svg>,
  },
  { id: "pm_spot", group: "Противопожарная защита", name: "Место стоянки противопожарной автомашины",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke="#222" strokeWidth={2} />
      <text x={24} y={25} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#dc2626">ПМ</text>
    </svg>,
  },
  { id: "upkhvm", group: "Противопожарная защита", name: "Участковый пункт хранения взрывчатых материалов",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={2} y={12} width={44} height={16} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <text x={24} y={24} textAnchor="middle" fontSize={7} fontWeight="bold" fill="#dc2626">УПХВМ</text>
    </svg>,
  },
  { id: "vgk_mobile", group: "Противопожарная защита", name: "Мобильный пункт ВГК",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke="#222" strokeWidth={2} />
      <text x={24} y={25} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#222">ВГК</text>
    </svg>,
  },
  { id: "vgk_static", group: "Противопожарная защита", name: "Стационарный пункт ВГК",
    svg: <CircleLabel text="ВГК" stroke="#222" fontSize={9} r={15} /> },
  {
    id: "fire_phone", group: "Противопожарная защита", name: "Место установки телефона",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={25} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#222">Т</text>
    </svg>,
  },
  {
    id: "fire_sprinkler_hand", group: "Противопожарная защита", name: "Установка оросительная, дренчерная (ручная)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={18} cy={20} r={8} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <line x1={26} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={38} y1={14} x2={38} y2={26} stroke="#dc2626" strokeWidth={1.5} />
      <line x1={38} y1={17} x2={44} y2={14} stroke="#dc2626" strokeWidth={1.2} />
      <line x1={38} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={1.2} />
      <line x1={38} y1={23} x2={44} y2={26} stroke="#dc2626" strokeWidth={1.2} />
    </svg>,
  },
  {
    id: "foam_gen_spot", group: "Противопожарная защита", name: "Место стоянки пеногенераторной установки",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={15} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={10} y1={10} x2={38} y2={30} stroke="#222" strokeWidth={2} />
      <line x1={38} y1={10} x2={10} y2={30} stroke="#222" strokeWidth={2} />
    </svg>,
  },
  {
    id: "fire_nozzle_spray", group: "Противопожарная защита", name: "Ствол пожарный распылитель",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={28} y2={20} stroke="#dc2626" strokeWidth={2} />
      <circle cx={34} cy={20} r={4} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <circle cx={34} cy={20} r={1.5} fill="#dc2626" />
      <line x1={38} y1={20} x2={46} y2={20} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="2 2" />
    </svg>,
  },
  {
    id: "fire_water_volume_hand", group: "Противопожарная защита", name: "Установка пожаротушения (ручной привод, объёмная)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,6 42,34 6,34" fill="none" stroke="#dc2626" strokeWidth={2} />
      <circle cx={24} cy={26} r={5} fill="none" stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ВОДОПРОВОД
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "pump", group: "Водопровод", name: "Насос",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke={S} strokeWidth={1.5} />
      <path d="M14,26 Q24,8 34,26" fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "pump_station", group: "Водопровод", name: "Насос и насосная станция стационарные",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="#222" stroke={S} strokeWidth={1.5} />
      <path d="M14,26 Q24,8 34,26" fill="none" stroke="white" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "valve_reduce", group: "Водопровод", name: "Клапан редукционный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={46} y2={20} stroke={S} strokeWidth={1.5} />
      <polygon points="2,10 22,20 2,30" fill={S} />
      <polygon points="46,10 26,20 46,30" fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "valve_water", group: "Водопровод", name: "Вентиль запорный на водопроводе",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={2} y1={20} x2={46} y2={20} stroke="#2196f3" strokeWidth={1.5} />
      <polygon points="2,10 22,20 2,30" fill="none" stroke="#2196f3" strokeWidth={1.5} />
      <polygon points="46,10 26,20 46,30" fill="none" stroke="#2196f3" strokeWidth={1.5} />
      <line x1={24} y1={10} x2={24} y2={30} stroke="#2196f3" strokeWidth={1.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // АВАРИИ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "acc_fire_place", group: "Аварии", name: "Место пожара",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={26} r={10} fill="none" stroke="#888" strokeWidth={1.5} />
      <path d="M18,30 Q20,20 24,18 Q28,20 30,30" fill="none" stroke="#888" strokeWidth={1.5} />
      <line x1={14} y1={36} x2={34} y2={36} stroke="#888" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "acc_fire_source", group: "Аварии", name: "Очаг пожара",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={9} fill="#FF0100" />
      <g fill="#FF0100">
        <polygon points="24,1 21.5,9 26.5,9" />
        <polygon points="24,39 21.5,31 26.5,31" />
        <polygon points="4,20 11,17.5 11,22.5" />
        <polygon points="44,20 37,17.5 37,22.5" />
        <polygon points="9.9,5.9 15.8,9 12.7,12.1" />
        <polygon points="38.1,34.1 32.2,31 35.3,27.9" />
        <polygon points="38.1,5.9 32.2,9 35.3,12.1" />
        <polygon points="9.9,34.1 15.8,31 12.7,27.9" />
      </g>
    </svg>,
  },
  {
    id: "acc_fire_spread", group: "Аварии", name: "Распространение пожара",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      {[0,45,90,135,180,225,270,315].map((a, i) => {
        const rad = a * Math.PI / 180;
        return <line key={i} x1={24} y1={20} x2={24 + Math.cos(rad) * 15} y2={20 + Math.sin(rad) * 15} stroke="#dc2626" strokeWidth={2} />;
      })}
      <circle cx={24} cy={20} r={5} fill="none" stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "acc_gas_explosion", group: "Аварии", name: "Место взрыва газа и пыли",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="#222" stroke={S} strokeWidth={1} />
      <polygon points="24,6 30,18 24,14 18,18" fill="#dc2626" />
      <polygon points="38,20 26,18 30,24" fill="#dc2626" />
    </svg>,
  },
  {
    id: "acc_gas_release", group: "Аварии", name: "Место внезапного выброса газа и породы",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={12} fill="none" stroke="#dc2626" strokeWidth={2} />
      <line x1={24} y1={8} x2={24} y2={32} stroke="#dc2626" strokeWidth={2} />
      <line x1={12} y1={20} x2={36} y2={20} stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "acc_explosion", group: "Аварии", name: "Взрыв",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={22} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      <polygon points="24,4 28,12 36,8 30,16 38,18 30,20 34,28 24,22 14,28 18,20 10,18 18,16 12,8 20,12" fill="#888" />
    </svg>,
  },
  {
    id: "acc_explosion_wave", group: "Аварии", name: "Распространение взрывной волны",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <path d="M4,12 L20,20 L4,28" fill="none" stroke="#222" strokeWidth={2} />
      <polygon points="20,14 44,20 20,26" fill="#222" />
    </svg>,
  },
  {
    id: "acc_explosion_place", group: "Аварии", name: "Место взрыва",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={16} cy={20} r={12} fill="#dc2626" stroke={S} strokeWidth={1} />
      <polygon points="24,10 38,6 32,20 44,16 36,32 24,26 12,34 18,20 6,24 14,8" fill="white" opacity={0.3} />
    </svg>,
  },
  {
    id: "acc_gas_suflar", group: "Аварии", name: "Место суфлярного выделения газа",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={12} fill="none" stroke="#dc2626" strokeWidth={2} />
      <line x1={12} y1={20} x2={36} y2={20} stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "acc_commander", group: "Аварии", name: "Командир взвода",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "acc_squad_leader", group: "Аварии", name: "Командир отделения",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke={S} strokeWidth={1.5} />
      <line x1={10} y1={20} x2={38} y2={20} stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  { id: "acc_pb_base", group: "Аварии", name: "Подземная база",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke={S} strokeWidth={2} />
      <text x={24} y={25} textAnchor="middle" fontSize={11} fontWeight="bold" fill={S}>П.Б</text>
    </svg>,
  },
  { id: "acc_nb_base", group: "Аварии", name: "Наземная база",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke={S} strokeWidth={2} />
      <text x={24} y={25} textAnchor="middle" fontSize={11} fontWeight="bold" fill={S}>Н.Б</text>
    </svg>,
  },
  {
    id: "acc_squad_moving", group: "Аварии", name: "Отделение в движении",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={2} y={12} width={34} height={16} fill="none" stroke={S} strokeWidth={2} />
      <text x={16} y={24} textAnchor="middle" fontSize={9} fontWeight="bold" fill={S}>5 чел</text>
      <polygon points="36,14 46,20 36,26" fill={S} />
    </svg>,
  },
  {
    id: "acc_squad_work", group: "Аварии", name: "Отделение на месте работ",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={2} y={12} width={44} height={16} fill="none" stroke={S} strokeWidth={2} />
      <text x={24} y={24} textAnchor="middle" fontSize={9} fontWeight="bold" fill={S}>5 чел</text>
    </svg>,
  },
  {
    id: "acc_respirator_moving", group: "Аварии", name: "Респираторщик в движении",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={20} cy={20} r={12} fill="none" stroke={S} strokeWidth={1.5} />
      <polygon points="32,14 44,20 32,26" fill={S} />
    </svg>,
  },
  {
    id: "acc_water_intrusion", group: "Аварии", name: "Место проникновения воды в выработку",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={20} cy={14} r={8} fill="#2196f3" stroke="#1565c0" strokeWidth={1} />
      <circle cx={28} cy={26} r={8} fill="#2196f3" stroke="#1565c0" strokeWidth={1} />
      <polygon points="20,22 28,26 20,30" fill="#1565c0" />
    </svg>,
  },
  {
    id: "acc_injury_fatal", group: "Аварии", name: "Местонахождение пострадавшего-смертельно травмированного",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#dc2626" strokeWidth={2} />
      <line x1={12} y1={8} x2={36} y2={32} stroke="#dc2626" strokeWidth={2} />
      <line x1={36} y1={8} x2={12} y2={32} stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "acc_injury", group: "Аварии", name: "Местонахождение пострадавшего-травмированного",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#2196f3" strokeWidth={2} />
      <line x1={12} y1={8} x2={36} y2={32} stroke="#2196f3" strokeWidth={2} />
      <line x1={36} y1={8} x2={12} y2={32} stroke="#2196f3" strokeWidth={2} />
    </svg>,
  },
  {
    id: "acc_rock_burst", group: "Аварии", name: "Место проявления горного удара",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,4 44,36 4,36" fill="#dc2626" stroke="#8b0000" strokeWidth={1} />
    </svg>,
  },
  {
    id: "acc_gas_release2", group: "Аварии", name: "Газовыделение",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={24} r={12} fill="none" stroke="#888" strokeWidth={1.5} />
      <circle cx={24} cy={10} r={5} fill="#c8a882" stroke="#888" strokeWidth={1} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ДАТЧИКИ
  // ══════════════════════════════════════════════════════════════════════════
  { id: "sensor_o2",  group: "Датчики", name: "Датчик кислорода",     svg: <CircleLabel text="O₂"  fontSize={11} /> },
  { id: "sensor_ch4", group: "Датчики", name: "Датчик метана",         svg: <CircleLabel text="CH₄" fontSize={10} /> },
  { id: "sensor_co",  group: "Датчики", name: "Датчик окиси углерода", svg: <CircleLabel text="CO"  fontSize={12} /> },
  { id: "sensor_nox", group: "Датчики", name: "Датчик окислов азота",  svg: <CircleLabel text="NOx" fontSize={10} /> },
  { id: "sensor_h2s", group: "Датчики", name: "Датчик сероводорода",   svg: <CircleLabel text="H₂S" fontSize={10} /> },
  { id: "sensor_co2", group: "Датчики", name: "Датчик углекислого газа", svg: <CircleLabel text="CO₂" fontSize={10} /> },
  { id: "sensor_v",   group: "Датчики", name: "Датчик скорости воздуха", svg: <CircleLabel text="V" fontSize={14} /> },

  // ══════════════════════════════════════════════════════════════════════════
  // РАСЧЁТ КОЛИЧЕСТВА ВОЗДУХА
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "calc_blast", group: "Расчёт количества воздуха", name: "Взрывные работы",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={16} r={11} fill="none" stroke="#888" strokeWidth={1.5} />
      <path d="M18,20 Q20,14 24,12 Q28,14 30,20" fill="none" stroke="#888" strokeWidth={1.5} />
      <line x1={16} y1={30} x2={20} y2={32} stroke="#888" strokeWidth={2} />
      <line x1={22} y1={28} x2={26} y2={32} stroke="#888" strokeWidth={2} />
    </svg>,
  },
  {
    id: "calc_blast_mass", group: "Расчёт количества воздуха", name: "Массовые взрывные работы",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={16} r={11} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <path d="M18,20 Q20,14 24,12 Q28,14 30,20" fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <line x1={16} y1={30} x2={20} y2={32} stroke="#dc2626" strokeWidth={2} />
      <line x1={22} y1={28} x2={26} y2={32} stroke="#dc2626" strokeWidth={2} />
    </svg>,
  },
  {
    id: "calc_combine", group: "Расчёт количества воздуха", name: "Горный комбайн",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      {[0,36,72,108,144,180,216,252,288,324].map((a, i) => {
        const r1 = 8, r2 = 14, rad = a * Math.PI / 180;
        return <line key={i} x1={24 + Math.cos(rad)*r1} y1={20 + Math.sin(rad)*r1} x2={24 + Math.cos(rad)*r2} y2={20 + Math.sin(rad)*r2} stroke="#888" strokeWidth={2} />;
      })}
    </svg>,
  },
  {
    id: "calc_engine", group: "Расчёт количества воздуха", name: "Двигатель внутреннего сгорания",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={30} cy={20} r={12} fill="none" stroke="#888" strokeWidth={1.5} />
      <circle cx={30} cy={20} r={5} fill="#888" />
      <rect x={4} y={15} width={16} height={10} fill="none" stroke="#888" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "calc_tech_room", group: "Расчёт количества воздуха", name: "Технологическая камера",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      <line x1={14} y1={26} x2={28} y2={26} stroke="#888" strokeWidth={2} />
      <line x1={20} y1={14} x2={20} y2={26} stroke="#888" strokeWidth={2} />
      <circle cx={20} cy={13} r={3} fill="none" stroke="#888" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "calc_people", group: "Расчёт количества воздуха", name: "Люди",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      <circle cx={24} cy={13} r={4} fill="#888" />
      <line x1={24} y1={17} x2={24} y2={28} stroke="#888" strokeWidth={2} />
      <line x1={17} y1={21} x2={31} y2={21} stroke="#888" strokeWidth={1.5} />
      <line x1={24} y1={28} x2={19} y2={35} stroke="#888" strokeWidth={1.5} />
      <line x1={24} y1={28} x2={29} y2={35} stroke="#888" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "calc_dust", group: "Расчёт количества воздуха", name: "Вынос пыли",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      <polygon points="6,20 14,16 14,24" fill="#dc2626" />
      {[16,20,24,12,18,22,14,20].map((x, i) => <circle key={i} cx={x+14} cy={i%2===0?16:24} r={2} fill="#888" />)}
    </svg>,
  },
  { id: "calc_vmin", group: "Расчёт количества воздуха", name: "Минимальная скорость воздуха",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      <text x={24} y={23} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#888">Vmin</text>
    </svg>,
  },
  { id: "calc_ch4_emit", group: "Расчёт количества воздуха", name: "Выделение метана",       svg: <CircleLabel text="CH₄" stroke="#888" textFill="#888" fontSize={10} /> },
  { id: "calc_co_emit",  group: "Расчёт количества воздуха", name: "Выделение окиси углерода", svg: <CircleLabel text="CO"  stroke="#888" textFill="#888" fontSize={12} /> },
  { id: "calc_nox_emit", group: "Расчёт количества воздуха", name: "Выделение окислов азота", svg: <CircleLabel text="NOₓ" stroke="#888" textFill="#888" fontSize={10} /> },
  { id: "calc_so2_emit", group: "Расчёт количества воздуха", name: "Выделение сернистого газа", svg: <CircleLabel text="SO₂" stroke="#888" textFill="#888" fontSize={10} /> },
  { id: "calc_h2s_emit", group: "Расчёт количества воздуха", name: "Выделение сероводорода",  svg: <CircleLabel text="H₂S" stroke="#888" textFill="#888" fontSize={10} /> },
  { id: "calc_co2_emit", group: "Расчёт количества воздуха", name: "Выделение углекислого газа", svg: <CircleLabel text="CO₂" stroke="#888" textFill="#888" fontSize={10} /> },
  {
    id: "calc_diffusion", group: "Расчёт количества воздуха", name: "Диффузионное проветривание после взрыва",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#888" strokeWidth={1.5} />
      <line x1={12} y1={16} x2={36} y2={16} stroke="#888" strokeWidth={1} />
      <line x1={12} y1={20} x2={36} y2={20} stroke="#888" strokeWidth={1} />
      <line x1={12} y1={24} x2={36} y2={24} stroke="#888" strokeWidth={1} />
      <polygon points="34,13 40,16 34,19" fill="#888" />
      <polygon points="34,17 40,20 34,23" fill="#888" />
      <polygon points="34,21 40,24 34,27" fill="#888" />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ТЕПЛО И ГАЗОВЫДЕЛЕНИЕ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "heat_fire", group: "Тепло и газовыделение", name: "Пожар",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={28} r={10} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <path d="M18,36 Q20,24 24,20 Q28,24 30,36" fill="#ff5722" stroke="#dc2626" strokeWidth={1} />
      <path d="M20,36 Q22,28 24,24 Q26,28 28,36" fill="#ffd600" />
    </svg>,
  },
  {
    id: "heat_conveyor_belt", group: "Тепло и газовыделение", name: "Конвейерная лента",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={15} width={40} height={5} fill="none" stroke={S} strokeWidth={1.5} />
      <rect x={4} y={22} width={40} height={5} fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "heat_conveyor_drive", group: "Тепло и газовыделение", name: "Привод конвейера",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="4,14 44,20 4,26" fill={S} />
    </svg>,
  },
  {
    id: "heat_selfprop", group: "Тепло и газовыделение", name: "Самоходное двигательное оборудование",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={16} cy={24} r={8} fill="none" stroke={S} strokeWidth={1.5} />
      <circle cx={16} cy={24} r={3} fill={S} />
      <circle cx={34} cy={24} r={8} fill="none" stroke={S} strokeWidth={1.5} />
      <circle cx={34} cy={24} r={3} fill={S} />
      <rect x={10} y={12} width={28} height={12} fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ЭЛЕКТРОСНАБЖЕНИЕ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "elec_cable_lv", group: "Электроснабжение", name: "Кабельная муфта-силовой кабель 0,4-0,66 кВ",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="4,15 44,20 4,25" fill="#2196f3" />
    </svg>,
  },
  {
    id: "elec_cable_hv", group: "Электроснабжение", name: "Кабельная муфта-силовой кабель 6 кВ",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="4,15 44,20 4,25" fill="#dc2626" />
    </svg>,
  },
  {
    id: "elec_winch", group: "Электроснабжение", name: "Лебёдка",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={8} width={16} height={24} fill="none" stroke={S} strokeWidth={1.5} />
      <rect x={26} y={8} width={16} height={24} fill="none" stroke={S} strokeWidth={1.5} />
      <line x1={6} y1={20} x2={22} y2={20} stroke={S} strokeWidth={1} />
      <line x1={26} y1={20} x2={42} y2={20} stroke={S} strokeWidth={1} />
    </svg>,
  },
  {
    id: "elec_dist", group: "Электроснабжение", name: "Распределительный пункт",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={6} width={36} height={28} fill="#222" stroke={S} strokeWidth={1.5} />
      <line x1={6} y1={6} x2={42} y2={34} stroke="white" strokeWidth={2} />
      <line x1={42} y1={6} x2={6} y2={34} stroke="white" strokeWidth={2} />
    </svg>,
  },
  {
    id: "elec_substation", group: "Электроснабжение", name: "Участковая подстанция",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={6} width={36} height={28} fill="none" stroke={S} strokeWidth={1.5} />
    </svg>,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // УЗЛЫ
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "node_normal", group: "Узлы", name: "Узел (сопряжение)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={20} cy={20} r={8} fill="#c8a882" stroke="#1f2937" strokeWidth={1.5} />
      <text x={31} y={24} fontSize={10} fill="#1f2937" fontWeight="600">001</text>
    </svg>,
  },
  {
    id: "node_atm", group: "Узлы", name: "Узел-атмосфера (выход)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={13} fill="#e0f7fa" stroke="#00838f" strokeWidth={1.5} strokeDasharray="4 2" />
      <circle cx={24} cy={20} r={5} fill="#00bcd4" stroke="#00838f" strokeWidth={1} />
    </svg>,
  },
];

const GROUPS = Array.from(new Set(ITEMS.map(i => i.group)));

export default function LegendDialog({ onClose }: Props) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("Все");

  const filtered = ITEMS.filter(item => {
    const matchGroup = activeGroup === "Все" || item.group === activeGroup;
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    return matchGroup && matchSearch;
  });

  const groupsToShow = activeGroup === "Все" ? GROUPS : [activeGroup];

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#f5f7fb" }}>
      <div className="h-8 border-b flex items-center justify-between px-3 flex-shrink-0"
        style={{ background: "linear-gradient(180deg,#e8eef8,#d8e4f0)", borderColor: "#b8c8d8" }}>
        <span className="text-[12px] font-semibold text-gray-800">Условные обозначения</span>
        <div className="flex items-center gap-1">
          <button className="px-2 py-0.5 text-[10px] rounded hover:bg-blue-100"
            style={{ border: "1px solid #b8c8d8", color: "#1a3a6b" }}
            onClick={() => window.print()}>
            <Icon name="Printer" size={12} />
          </button>
          <button onClick={onClose}
            className="w-5 h-5 flex items-center justify-center hover:bg-red-100 rounded"
            style={{ color: "#666" }}>
            <Icon name="X" size={12} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1.5 flex-shrink-0 flex-wrap"
        style={{ background: "#edf2f8", borderBottom: "1px solid #ccd8e8" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="text-[10px] px-2 py-0.5 rounded border"
          style={{ border: "1px solid #b8c8d8", outline: "none", width: 130, background: "white" }} />
        {["Все", ...GROUPS].map(g => (
          <button key={g} onClick={() => setActiveGroup(g)}
            className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
            style={{
              background: activeGroup === g ? "#2563eb" : "#e0e8f4",
              color: activeGroup === g ? "white" : "#1a3a6b",
              border: "1px solid " + (activeGroup === g ? "#1d4ed8" : "#b8c8d8"),
            }}>{g}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {groupsToShow.map(group => {
          const items = filtered.filter(i => i.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="mb-4">
              <div className="text-[10px] font-semibold px-2 py-0.5 mb-1.5 rounded"
                style={{ background: "#d8e4f0", color: "#1a3a6b", borderBottom: "1px solid #b8c8d8" }}>
                {group.toUpperCase()}
              </div>
              <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
                {items.map(item => (
                  <div key={item.id}
                    className="flex flex-col items-center gap-0.5 p-1.5 rounded border border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-default"
                    style={{ background: "white" }}>
                    <div className="flex items-center justify-center" style={{ height: 42 }}>{item.svg}</div>
                    <div className="text-[9px] text-gray-700 text-center leading-tight">{item.name}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-8 text-[11px] text-gray-400">Ничего не найдено</div>
        )}
      </div>

      <div className="px-3 py-0.5 border-t flex-shrink-0 text-[9px] text-gray-400"
        style={{ borderColor: "#ccd8e8", background: "#edf2f8" }}>
        Показано {filtered.length} из {ITEMS.length} обозначений
      </div>
    </div>
  );
}