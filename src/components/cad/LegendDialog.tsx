// Условные обозначения — полный набор по аналогии с АэроСетью
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

// ─── Helpers ───────────────────────────────────────────────────────────────
function BulkheadSVG({ fill = "white", stroke = "#222", door = false, auto = false, water = false, window_ = false, lattice = false }: {
  fill?: string; stroke?: string; door?: boolean; auto?: boolean; water?: boolean; window_?: boolean; lattice?: boolean;
}) {
  return (
    <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={1} y={8} width={6} height={24} fill={fill} stroke={stroke} strokeWidth={1.2} />
      <line x1={7} y1={20} x2={41} y2={20} stroke="#333" strokeWidth={1.2} />
      <rect x={41} y={8} width={6} height={24} fill={fill} stroke={stroke} strokeWidth={1.2} />
      {door && <><line x1={7} y1={14} x2={7} y2={26} stroke="#fff" strokeWidth={2} /><line x1={7} y1={20} x2={14} y2={20} stroke="#fff" strokeWidth={1.5} /></>}
      {auto && <><circle cx={27} cy={20} r={8} fill="white" stroke="#333" strokeWidth={1.2} /><text x={27} y={24} textAnchor="middle" fontSize={8} fontWeight="bold" fill="#333">А</text></>}
      {water && <text x={24} y={24} textAnchor="middle" fontSize={9} fontWeight="bold" fill={fill === "white" ? "#1565c0" : "#fff"}>D</text>}
      {window_ && <rect x={10} y={14} width={8} height={12} fill="none" stroke="#333" strokeWidth={1.2} />}
      {lattice && <>
        <line x1={12} y1={12} x2={12} y2={28} stroke="#333" strokeWidth={0.8} />
        <line x1={17} y1={12} x2={17} y2={28} stroke="#333" strokeWidth={0.8} />
        <line x1={22} y1={12} x2={22} y2={28} stroke="#333" strokeWidth={0.8} />
        <line x1={27} y1={12} x2={27} y2={28} stroke="#333" strokeWidth={0.8} />
        <line x1={9} y1={15} x2={30} y2={15} stroke="#333" strokeWidth={0.8} />
        <line x1={9} y1={20} x2={30} y2={20} stroke="#333" strokeWidth={0.8} />
        <line x1={9} y1={25} x2={30} y2={25} stroke="#333" strokeWidth={0.8} />
      </>}
    </svg>
  );
}

// ─── Полный список УО ─────────────────────────────────────────────────────
const ITEMS: LegendItem[] = [
  // ══ ВЕНТИЛЯТОРЫ ══
  {
    id: "fan_main", group: "Вентиляторы", name: "Вентилятор главного проветривания",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="white" stroke="#222" strokeWidth={2} />
      <path d="M24,20 C24,12 32,8 36,14 C32,16 28,18 24,20Z" fill="#222" />
      <path d="M24,20 C16,20 12,12 18,8 C20,12 22,16 24,20Z" fill="#222" />
      <path d="M24,20 C24,28 16,32 12,26 C16,24 20,22 24,20Z" fill="#222" />
      <circle cx={24} cy={20} r={3} fill="white" stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fan_local", group: "Вентиляторы", name: "Вентилятор местного проветривания",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={12} fill="white" stroke="#222" strokeWidth={1.5} />
      <line x1={24} y1={8} x2={24} y2={32} stroke="#222" strokeWidth={1.5} />
      <line x1={12} y1={20} x2={36} y2={20} stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fan_reversible", group: "Вентиляторы", name: "Вентилятор реверсивный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="white" stroke="#dc2626" strokeWidth={2} />
      <path d="M24,20 C24,12 32,8 36,14 C32,16 28,18 24,20Z" fill="#dc2626" />
      <path d="M24,20 C16,20 12,12 18,8 C20,12 22,16 24,20Z" fill="#dc2626" />
      <path d="M24,20 C24,28 16,32 12,26 C16,24 20,22 24,20Z" fill="#dc2626" />
      <circle cx={24} cy={20} r={3} fill="white" stroke="#dc2626" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "fan_stopped", group: "Вентиляторы", name: "Вентилятор остановлен",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={16} fill="white" stroke="#888" strokeWidth={2} />
      <path d="M24,20 C24,12 32,8 36,14 C32,16 28,18 24,20Z" fill="#888" />
      <path d="M24,20 C16,20 12,12 18,8 C20,12 22,16 24,20Z" fill="#888" />
      <path d="M24,20 C24,28 16,32 12,26 C16,24 20,22 24,20Z" fill="#888" />
      <circle cx={24} cy={20} r={3} fill="white" stroke="#888" strokeWidth={1.5} />
      <line x1={12} y1={8} x2={36} y2={32} stroke="#dc2626" strokeWidth={2.5} />
      <line x1={36} y1={8} x2={12} y2={32} stroke="#dc2626" strokeWidth={2.5} />
    </svg>,
  },

  // ══ ВЕНТИЛЯЦИОННЫЕ СТРУИ ══
  {
    id: "fresh_air_solid", group: "Вентиляционные струи", name: "Свежая струя (сплошная)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={3} />
      <polygon points="36,14 46,20 36,26" fill="#dc2626" />
    </svg>,
  },
  {
    id: "fresh_air_dashed", group: "Вентиляционные струи", name: "Свежая струя (штриховая)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={2.5} strokeDasharray="8 4" />
      <polygon points="36,14 46,20 36,26" fill="#dc2626" />
    </svg>,
  },
  {
    id: "exhaust_air_solid", group: "Вентиляционные струи", name: "Исходящая струя (сплошная)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#2196f3" strokeWidth={3} />
      <polygon points="36,14 46,20 36,26" fill="#2196f3" />
    </svg>,
  },
  {
    id: "exhaust_air_dashed", group: "Вентиляционные струи", name: "Исходящая струя (штриховая)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#2196f3" strokeWidth={2.5} strokeDasharray="8 4" />
      <polygon points="36,14 46,20 36,26" fill="#2196f3" />
    </svg>,
  },

  // ══ ГЛУХИЕ ПЕРЕМЫЧКИ ══
  { id: "bk_base",     group: "Глухие перемычки", name: "Перемычка глухая",             svg: <BulkheadSVG /> },
  { id: "bk_concrete", group: "Глухие перемычки", name: "Перемычка бетонная",           svg: <BulkheadSVG fill="#4caf50" stroke="#2e7d32" /> },
  { id: "bk_wood",     group: "Глухие перемычки", name: "Перемычка деревянная",         svg: <BulkheadSVG fill="#ffd600" stroke="#f57f17" /> },
  { id: "bk_brick",    group: "Глухие перемычки", name: "Перемычка кирпичная",          svg: <BulkheadSVG fill="#ff9800" stroke="#e65100" /> },
  { id: "bk_metal",    group: "Глухие перемычки", name: "Перемычка металлическая",      svg: <BulkheadSVG fill="#9c27b0" stroke="#6a1b9a" /> },
  { id: "door_base",   group: "Глухие перемычки", name: "Дверь вентиляционная закрытая",svg: <BulkheadSVG door /> },
  { id: "door_conc",   group: "Глухие перемычки", name: "Дверь закрытая бетонная",     svg: <BulkheadSVG fill="#4caf50" stroke="#2e7d32" door /> },
  { id: "door_wood",   group: "Глухие перемычки", name: "Дверь закрытая деревянная",   svg: <BulkheadSVG fill="#ffd600" stroke="#f57f17" door /> },
  { id: "door_brick",  group: "Глухие перемычки", name: "Дверь закрытая кирпичная",    svg: <BulkheadSVG fill="#ff9800" stroke="#e65100" door /> },
  { id: "door_metal",  group: "Глухие перемычки", name: "Дверь закрытая металлическая",svg: <BulkheadSVG fill="#9c27b0" stroke="#6a1b9a" door /> },
  { id: "auto_base",   group: "Глухие перемычки", name: "Дверь автоматическая",        svg: <BulkheadSVG door auto /> },
  { id: "auto_conc",   group: "Глухие перемычки", name: "Дверь автоматическая бетонная", svg: <BulkheadSVG fill="#4caf50" stroke="#2e7d32" door auto /> },
  { id: "auto_wood",   group: "Глухие перемычки", name: "Дверь автоматическая деревянная", svg: <BulkheadSVG fill="#ffd600" stroke="#f57f17" door auto /> },
  { id: "auto_brick",  group: "Глухие перемычки", name: "Дверь автоматическая кирпичная", svg: <BulkheadSVG fill="#ff9800" stroke="#e65100" door auto /> },
  { id: "auto_metal",  group: "Глухие перемычки", name: "Дверь автоматическая металлическая", svg: <BulkheadSVG fill="#9c27b0" stroke="#6a1b9a" door auto /> },
  {
    id: "sail", group: "Глухие перемычки", name: "Парус вентиляционный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#333" strokeWidth={1.2} />
      <path d="M4,8 Q4,20 4,32 Q18,28 18,20 Q18,12 4,8Z" fill="white" stroke="#333" strokeWidth={1.2} />
    </svg>,
  },
  { id: "water_base",    group: "Глухие перемычки", name: "Перемычка водоподпорная",           svg: <BulkheadSVG water /> },
  { id: "water_concrete",group: "Глухие перемычки", name: "Перемычка водоподпорная бетонная",  svg: <BulkheadSVG fill="#4caf50" stroke="#2e7d32" water /> },
  { id: "water_wood",    group: "Глухие перемычки", name: "Перемычка водоподпорная деревянная", svg: <BulkheadSVG fill="#ffd600" stroke="#f57f17" water /> },
  { id: "water_brick",   group: "Глухие перемычки", name: "Перемычка водоподпорная кирпичная",  svg: <BulkheadSVG fill="#ff9800" stroke="#e65100" water /> },
  { id: "water_metal",   group: "Глухие перемычки", name: "Перемычка водоподпорная металлическая", svg: <BulkheadSVG fill="#9c27b0" stroke="#6a1b9a" water /> },

  // ══ ПЕРЕМЫЧКИ С ВЕНТ. ОКНОМ ══
  { id: "win_base",   group: "Перемычки с вент. окном", name: "Перемычка с окном",            svg: <BulkheadSVG window_ /> },
  { id: "win_conc",   group: "Перемычки с вент. окном", name: "С окном бетонная",            svg: <BulkheadSVG fill="#4caf50" stroke="#2e7d32" window_ /> },
  { id: "win_wood",   group: "Перемычки с вент. окном", name: "С окном деревянная",          svg: <BulkheadSVG fill="#ffd600" stroke="#f57f17" window_ /> },
  { id: "win_brick",  group: "Перемычки с вент. окном", name: "С окном кирпичная",           svg: <BulkheadSVG fill="#ff9800" stroke="#e65100" window_ /> },
  { id: "win_metal",  group: "Перемычки с вент. окном", name: "С окном металлическая",       svg: <BulkheadSVG fill="#9c27b0" stroke="#6a1b9a" window_ /> },
  { id: "lat_base",   group: "Перемычки с вент. окном", name: "Дверь решётчатая",            svg: <BulkheadSVG lattice /> },
  { id: "lat_conc",   group: "Перемычки с вент. окном", name: "Дверь решётчатая бетонная",  svg: <BulkheadSVG fill="#4caf50" stroke="#2e7d32" lattice /> },
  { id: "lat_wood",   group: "Перемычки с вент. окном", name: "Дверь решётчатая деревянная",svg: <BulkheadSVG fill="#ffd600" stroke="#f57f17" lattice /> },
  {
    id: "regulator_slider", group: "Перемычки с вент. окном", name: "Регулятор (шибер)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth={1.5} />
      <rect x={18} y={10} width={12} height={20} fill="#ffd600" stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "door_open", group: "Перемычки с вент. окном", name: "Дверь вентиляционная открытая",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#333" strokeWidth={1.2} />
      <rect x={1} y={8} width={6} height={24} fill="white" stroke="#333" strokeWidth={1.2} />
      <rect x={41} y={8} width={6} height={24} fill="white" stroke="#333" strokeWidth={1.2} />
      <path d="M7,10 L18,18 L7,26Z" fill="none" stroke="#333" strokeWidth={1.2} />
    </svg>,
  },

  // ══ ОБЩЕЕ ══
  {
    id: "building", group: "Общее", name: "Надшахтное здание",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={10} width={36} height={26} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={6} y1={10} x2={24} y2={2} stroke="#222" strokeWidth={1.5} />
      <line x1={42} y1={10} x2={24} y2={2} stroke="#222" strokeWidth={1.5} />
      <line x1={6} y1={10} x2={42} y2={36} stroke="#222" strokeWidth={1} />
      <line x1={42} y1={10} x2={6} y2={36} stroke="#222" strokeWidth={1} />
    </svg>,
  },
  {
    id: "copra_tower", group: "Общее", name: "Копёр башенный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={16} y={2} width={16} height={36} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={16} y1={12} x2={32} y2={12} stroke="#222" strokeWidth={1} />
      <line x1={16} y1={20} x2={32} y2={20} stroke="#222" strokeWidth={1} />
      <line x1={16} y1={28} x2={32} y2={28} stroke="#222" strokeWidth={1} />
      <rect x={20} y={30} width={8} height={8} fill="none" stroke="#222" strokeWidth={1} />
    </svg>,
  },
  {
    id: "copra_metal", group: "Общее", name: "Копёр металлический",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={24} y1={2} x2={8} y2={38} stroke="#222" strokeWidth={1.5} />
      <line x1={24} y1={2} x2={40} y2={38} stroke="#222" strokeWidth={1.5} />
      <rect x={14} y={8} width={20} height={20} fill="none" stroke="#222" strokeWidth={1} />
      <line x1={14} y1={14} x2={34} y2={14} stroke="#222" strokeWidth={0.8} />
      <line x1={14} y1={20} x2={34} y2={20} stroke="#222" strokeWidth={0.8} />
    </svg>,
  },
  {
    id: "calorifer", group: "Общее", name: "Установка калориферная",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={10} width={40} height={20} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={11} y1={10} x2={11} y2={30} stroke="#222" strokeWidth={1} />
      <line x1={18} y1={10} x2={18} y2={30} stroke="#222" strokeWidth={1} />
      <line x1={25} y1={10} x2={25} y2={30} stroke="#222" strokeWidth={1} />
      <line x1={32} y1={10} x2={32} y2={30} stroke="#222" strokeWidth={1} />
      <line x1={39} y1={10} x2={39} y2={30} stroke="#222" strokeWidth={1} />
    </svg>,
  },
  {
    id: "crossing_pipe", group: "Общее", name: "Кроссинг трубчатый",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth={2} />
      <line x1={24} y1={4} x2={24} y2={36} stroke="#222" strokeWidth={2} />
      <circle cx={24} cy={20} r={6} fill="white" stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "crossing_tunnel", group: "Общее", name: "Кроссинг тоннельный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth={2} />
      <line x1={24} y1={4} x2={24} y2={36} stroke="#222" strokeWidth={2} />
      <rect x={17} y={13} width={14} height={14} fill="white" stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "picket", group: "Общее", name: "Пикет",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={25} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#222">ПК</text>
    </svg>,
  },
  {
    id: "extinct_branch", group: "Общее", name: "Выработка погашенная",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={14} x2={44} y2={14} stroke="#888" strokeWidth={1.5} />
      <line x1={4} y1={26} x2={44} y2={26} stroke="#888" strokeWidth={1.5} />
      <line x1={4} y1={14} x2={44} y2={26} stroke="#888" strokeWidth={1.5} />
      <line x1={44} y1={14} x2={4} y2={26} stroke="#888" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "direction", group: "Общее", name: "Направление движения горноспасателей",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={38} y2={20} stroke="#111" strokeWidth={3} />
      <polygon points="36,13 48,20 36,27" fill="#111" />
    </svg>,
  },
  {
    id: "measure_station", group: "Общее", name: "Замерная станция",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={3} />
      <line x1={4} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={3} strokeDasharray="4 0" />
      <line x1={16} y1={11} x2={16} y2={29} stroke="#dc2626" strokeWidth={2.5} />
      <line x1={32} y1={11} x2={32} y2={29} stroke="#dc2626" strokeWidth={2.5} />
    </svg>,
  },
  {
    id: "emergency_exit", group: "Общее", name: "Запасной выход",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={4} y={6} width={18} height={28} fill="#ffd600" stroke="#222" strokeWidth={1} />
      <rect x={26} y={6} width={18} height={28} fill="#111" stroke="#222" strokeWidth={1} />
      <rect x={4} y={16} width={18} height={8} fill="#111" />
      <rect x={26} y={16} width={18} height={8} fill="#ffd600" />
    </svg>,
  },

  // ══ ВЕРТИКАЛЬНЫЕ ВЫРАБОТКИ ══
  {
    id: "shaft_down", group: "Вертикальные выработки", name: "Ствол вентиляционный (нисходящая)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="#1f2937" stroke="#222" strokeWidth={1.5} />
      <path d="M24,8 L36,32 L12,32Z" fill="white" />
    </svg>,
  },
  {
    id: "shaft_up", group: "Вертикальные выработки", name: "Ствол вентиляционный (восходящая)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={10} y={8} width={28} height={24} fill="#1f2937" stroke="#222" strokeWidth={1.5} />
      <polygon points="10,8 38,8 24,32" fill="white" />
    </svg>,
  },
  {
    id: "shaft_crossed", group: "Вертикальные выработки", name: "Ствол перекрытый",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={12} y1={8} x2={36} y2={32} stroke="#222" strokeWidth={1.5} />
      <line x1={36} y1={8} x2={12} y2={32} stroke="#222" strokeWidth={1.5} />
    </svg>,
  },

  // ══ ПРОТИВОПОЖАРНАЯ ЗАЩИТА ══
  {
    id: "fire_sensor", group: "Противопожарная защита", name: "Датчик пожарный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <text x={24} y={25} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#dc2626">С</text>
    </svg>,
  },
  {
    id: "fire_door", group: "Противопожарная защита", name: "Дверь противопожарная",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={1} y={8} width={6} height={24} fill="#dc2626" stroke="#b71c1c" strokeWidth={1.2} />
      <line x1={7} y1={20} x2={41} y2={20} stroke="#333" strokeWidth={1.2} />
      <rect x={41} y={8} width={6} height={24} fill="#dc2626" stroke="#b71c1c" strokeWidth={1.2} />
      <line x1={7} y1={14} x2={7} y2={26} stroke="#fff" strokeWidth={2} />
    </svg>,
  },
  {
    id: "fire_extinguisher", group: "Противопожарная защита", name: "Огнетушитель",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <text x={24} y={25} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#dc2626">ПМ</text>
    </svg>,
  },
  {
    id: "fire_water", group: "Противопожарная защита", name: "Водопровод пожарный",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#dc2626" strokeWidth={2} />
      <polygon points="38,14 46,20 38,26" fill="#dc2626" />
      <polygon points="30,14 38,20 30,26" fill="#dc2626" />
    </svg>,
  },

  // ══ ДАТЧИКИ ══
  {
    id: "sensor_ch4", group: "Датчики", name: "Датчик метана CH₄",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#222">CH₄</text>
    </svg>,
  },
  {
    id: "sensor_co", group: "Датчики", name: "Датчик CO",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#222">CO</text>
    </svg>,
  },
  {
    id: "sensor_o2", group: "Датчики", name: "Датчик O₂",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#222">O₂</text>
    </svg>,
  },
  {
    id: "sensor_no", group: "Датчики", name: "Датчик NO",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#222">NO</text>
    </svg>,
  },
  {
    id: "sensor_hs", group: "Датчики", name: "Датчик H₂S",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={10} fontWeight="bold" fill="#222">H₂S</text>
    </svg>,
  },
  {
    id: "sensor_wind", group: "Датчики", name: "Анемометр (скорость воздуха)",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#222" strokeWidth={1.5} />
      <text x={24} y={26} textAnchor="middle" fontSize={9} fontWeight="bold" fill="#222">Vmin</text>
    </svg>,
  },

  // ══ ВОДОПРОВОД ══
  {
    id: "pump", group: "Водопровод", name: "Насос",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={12} fill="none" stroke="#222" strokeWidth={1.5} />
      <path d="M16,20 Q24,10 32,20 Q24,30 16,20Z" fill="none" stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "valve", group: "Водопровод", name: "Задвижка",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#222" strokeWidth={2} />
      <polygon points="16,10 32,20 16,30" fill="none" stroke="#222" strokeWidth={1.5} />
      <polygon points="32,10 16,20 32,30" fill="none" stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "pipe_broken", group: "Водопровод", name: "Трубопровод оборван",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={17} x2={44} y2={17} stroke="#222" strokeWidth={1.5} />
      <line x1={4} y1={23} x2={44} y2={23} stroke="#222" strokeWidth={1.5} />
      <polygon points="40,14 48,20 40,26" fill="#222" />
    </svg>,
  },

  // ══ АВАРИИ ══
  {
    id: "accident_fire", group: "Аварии", name: "Очаг пожара",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={14} fill="none" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 2" />
      <text x={24} y={16} textAnchor="middle" fontSize={14} fill="#dc2626">🔥</text>
      <text x={24} y={32} textAnchor="middle" fontSize={8} fill="#dc2626">НБ</text>
    </svg>,
  },
  {
    id: "accident_people", group: "Аварии", name: "Люди в зоне аварии",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={16} cy={12} r={4} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={16} y1={16} x2={16} y2={28} stroke="#222" strokeWidth={1.5} />
      <line x1={8} y1={20} x2={24} y2={20} stroke="#222" strokeWidth={1.5} />
      <line x1={16} y1={28} x2={10} y2={36} stroke="#222" strokeWidth={1.5} />
      <line x1={16} y1={28} x2={22} y2={36} stroke="#222" strokeWidth={1.5} />
      <text x={32} y={24} fontSize={9} fill="#222" fontWeight="bold">5 чел.</text>
    </svg>,
  },

  // ══ УЗЛЫ ══
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

  // ══ ЭЛЕКТРОСНАБЖЕНИЕ ══
  {
    id: "elec_cable", group: "Электроснабжение", name: "Кабельная линия",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <line x1={4} y1={20} x2={44} y2={20} stroke="#2196f3" strokeWidth={3} />
      <circle cx={12} cy={20} r={3} fill="#2196f3" />
      <circle cx={24} cy={20} r={3} fill="#2196f3" />
      <circle cx={36} cy={20} r={3} fill="#2196f3" />
    </svg>,
  },
  {
    id: "elec_transformer", group: "Электроснабжение", name: "Трансформатор",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={8} width={16} height={24} fill="none" stroke="#222" strokeWidth={1.5} />
      <rect x={26} y={8} width={16} height={24} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={14} y1={8} x2={14} y2={32} stroke="#222" strokeWidth={1} />
      <line x1={34} y1={8} x2={34} y2={32} stroke="#222" strokeWidth={1} />
    </svg>,
  },

  // ══ РАСЧЁТ КОЛИЧЕСТВА ВОЗДУХА ══
  {
    id: "calc_person", group: "Расчёт количества воздуха", name: "По людям",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={10} r={6} fill="none" stroke="#222" strokeWidth={1.5} />
      <line x1={24} y1={16} x2={24} y2={30} stroke="#222" strokeWidth={1.5} />
      <line x1={14} y1={21} x2={34} y2={21} stroke="#222" strokeWidth={1.5} />
      <line x1={24} y1={30} x2={17} y2={38} stroke="#222" strokeWidth={1.5} />
      <line x1={24} y1={30} x2={31} y2={38} stroke="#222" strokeWidth={1.5} />
    </svg>,
  },
  {
    id: "calc_explosive", group: "Расчёт количества воздуха", name: "По взрывчатым веществам",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <polygon points="24,2 44,38 4,38" fill="none" stroke="#dc2626" strokeWidth={1.5} />
      <line x1={24} y1={14} x2={24} y2={28} stroke="#dc2626" strokeWidth={2} />
      <circle cx={24} cy={33} r={2} fill="#dc2626" />
    </svg>,
  },

  // ══ ТЕПЛО- И ГАЗОВЫДЕЛЕНИЕ ══
  {
    id: "heat_source", group: "Тепло- и газовыделение", name: "Источник тепловыделения",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={24} r={12} fill="none" stroke="#ff5722" strokeWidth={1.5} />
      <path d="M18,30 Q20,20 24,18 Q28,20 30,30" fill="none" stroke="#ff5722" strokeWidth={2} />
    </svg>,
  },
  {
    id: "gas_source", group: "Тепло- и газовыделение", name: "Источник газовыделения",
    svg: <svg width={48} height={40} viewBox="0 0 48 40">
      <rect x={6} y={10} width={36} height={24} fill="none" stroke="#4caf50" strokeWidth={1.5} />
      <line x1={14} y1={10} x2={14} y2={34} stroke="#4caf50" strokeWidth={1} />
      <line x1={22} y1={10} x2={22} y2={34} stroke="#4caf50" strokeWidth={1} />
      <line x1={30} y1={10} x2={30} y2={34} stroke="#4caf50" strokeWidth={1} />
      <line x1={6} y1={18} x2={42} y2={18} stroke="#4caf50" strokeWidth={1} />
      <line x1={6} y1={26} x2={42} y2={26} stroke="#4caf50" strokeWidth={1} />
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
      {/* Шапка */}
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

      {/* Поиск + фильтр по группам */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 flex-shrink-0 flex-wrap"
        style={{ background: "#edf2f8", borderBottom: "1px solid #ccd8e8" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск..."
          className="text-[10px] px-2 py-0.5 rounded border"
          style={{ border: "1px solid #b8c8d8", outline: "none", width: 130, background: "white" }}
        />
        {["Все", ...GROUPS].map(g => (
          <button key={g}
            onClick={() => setActiveGroup(g)}
            className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
            style={{
              background: activeGroup === g ? "#2563eb" : "#e0e8f4",
              color: activeGroup === g ? "white" : "#1a3a6b",
              border: "1px solid " + (activeGroup === g ? "#1d4ed8" : "#b8c8d8"),
            }}>
            {g}
          </button>
        ))}
      </div>

      {/* Контент */}
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
                    <div className="flex items-center justify-center" style={{ height: 42 }}>
                      {item.svg}
                    </div>
                    <div className="text-[9px] text-gray-700 text-center leading-tight">
                      {item.name}
                    </div>
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

      {/* Подвал */}
      <div className="px-3 py-0.5 border-t flex-shrink-0 text-[9px] text-gray-400"
        style={{ borderColor: "#ccd8e8", background: "#edf2f8" }}>
        Показано {filtered.length} из {ITEMS.length} обозначений
      </div>
    </div>
  );
}
