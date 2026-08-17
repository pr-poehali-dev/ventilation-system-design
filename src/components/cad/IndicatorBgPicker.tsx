import { MS_IND_BG_PRESETS, MS_IND_BG_NONE } from "@/lib/msIndicatorStyle";

// ─────────────────────────────────────────────────────────────────────────────
// Выбор цвета подложки под подписью условного обозначения.
//
// Используется и для замерных станций, и для вентиляторов — у них отличается
// только цвет по умолчанию, поэтому он приходит параметром `defaultColor`.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** Текущее значение (undefined — цвет по умолчанию, "none" — без фона) */
  value: string | undefined;
  /** Цвет по умолчанию для этого вида подписи */
  defaultColor: string;
  onChange: (color: string) => void;
  label?: string;
}

export default function IndicatorBgPicker({ value, defaultColor, onChange, label = "Фон" }: Props) {
  const cur = value ?? defaultColor;

  return (
    <div className="flex items-start gap-1 mb-1.5">
      <span className="text-gray-500 w-20 flex-shrink-0 pt-0.5">{label}</span>
      <div className="flex-1">
        <div className="flex flex-wrap gap-1">
          {MS_IND_BG_PRESETS.map(({ color, title }) => (
            <button key={color} title={title}
              onClick={() => onChange(color)}
              style={{
                width: 18, height: 18, borderRadius: 3, background: color,
                border: cur === color ? "2px solid #1a3a6b" : "1px solid #c8c8c8",
                cursor: "pointer", flexShrink: 0,
              }} />
          ))}
          <button title="Без фона"
            onClick={() => onChange(MS_IND_BG_NONE)}
            style={{
              width: 18, height: 18, borderRadius: 3, background: "white",
              border: cur === MS_IND_BG_NONE ? "2px solid #1a3a6b" : "1px solid #c8c8c8",
              cursor: "pointer", flexShrink: 0,
              color: "#dc2626", fontSize: 12, lineHeight: 1, fontWeight: 700,
            }}>×</button>
        </div>
        <input type="color"
          value={cur === MS_IND_BG_NONE ? defaultColor : cur}
          onChange={(e) => onChange(e.target.value)}
          title="Свой цвет"
          className="mt-1 w-full h-5 cursor-pointer"
          style={{ border: "1px solid #c8c8c8", borderRadius: 2, padding: 0, background: "white" }} />
      </div>
    </div>
  );
}
