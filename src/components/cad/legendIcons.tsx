// Условные обозначения — вспомогательные SVG-иконки и типы справочника
export interface Props { onClose: () => void; }
export interface LegendItem { id: string; name: string; svg: React.ReactNode; group: string; }

// ─── Helper: перемычка в справочнике УО ───────────────────────────────────
// viewBox 0 0 48 40, ось ветви — горизонтальная y=20, перемычка поперёк по x≈24
// Прямоугольник: вертикальный (x=20..28, y=4..36)
export function Bk({ fill = "white", stroke = "#222", door = false, auto = false, water = false, window_ = false, lattice = false, open_ = false }: {
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
export function CircleLabel({ text, stroke = "#222", fill = "none", textFill, bold = true, r = 15, fontSize = 10 }: {
  text: string; stroke?: string; fill?: string; textFill?: string; bold?: boolean; r?: number; fontSize?: number;
}) {
  return (
    <svg width={48} height={40} viewBox="0 0 48 40">
      <circle cx={24} cy={20} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
      <text x={24} y={24} textAnchor="middle" fontSize={fontSize} fontWeight={bold ? "bold" : "normal"} fill={textFill ?? stroke}>{text}</text>
    </svg>
  );
}

export const S = "#333"; // default stroke
