// Базовые UI-примитивы для панелей свойств ветви

export const SH = "#e8eef8";
export const SB = "1px solid #c8d4e8";
export const CB = "#d4d4d4";
export const CBB = "1px solid #b0b0b0";

export const BRANCH_TYPES = [
  "Ствол ЮВС", "Ствол СВС", "Квершлаг", "Штрек откат.", "Штрек вент.",
  "Уклон", "Очистной", "Сбойка", "Камера", "Конвейер", "Вент. канал",
];

export const PLAST_OPTIONS = ["— не задан —", "Пласт 1", "Пласт 2", "Пласт 3", "Пласт 4"];
export const PLA_OPTIONS = ["— нет —", "ПЛА-1", "ПЛА-2", "ПЛА-3"];
export const POLE_OPTIONS = ["— нет —", "Северное", "Южное", "Западное"];

export function numFmt(v: number, d = 2): string {
  if (isNaN(v) || v === undefined) return "—";
  return v.toFixed(d);
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center px-1 py-0.5 text-[11px] font-semibold select-none"
      style={{ background: SH, borderBottom: SB, borderTop: SB, color: "#1a3a6b" }}>
      {title}
    </div>
  );
}

export function ParamRow({
  id,
  label,
  visible,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  visible: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center" style={{ minHeight: 20, borderBottom: "1px solid #ebebeb" }}>
      <div className="flex items-center justify-center flex-shrink-0" style={{ width: 18 }}>
        <input
          type="checkbox"
          checked={visible}
          onChange={() => onToggle(id)}
          style={{ width: 11, height: 11, cursor: "pointer" }}
        />
      </div>
      <div className="flex-shrink-0 text-[11px] text-gray-700 px-1 leading-tight"
        style={{ width: 148, whiteSpace: "normal", lineHeight: "1.2" }}>
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function EditInput({
  value,
  onChange,
  type = "text",
  step,
  readOnly,
}: {
  value: string | number;
  onChange?: (v: string) => void;
  type?: string;
  step?: string;
  readOnly?: boolean;
}) {
  return (
    <input
      type={type}
      step={step}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange?.(e.target.value)}
      className="w-full text-[11px] text-right px-1"
      style={{
        background: readOnly ? "#f5f5f5" : "white",
        border: "1px solid #c8c8c8",
        height: 18,
        outline: "none",
        fontFamily: "inherit",
        color: "#1a1a1a",
      }}
    />
  );
}

export function ComputedInput({ value, color, className }: { value: string; color?: string; className?: string }) {
  return (
    <div
      className={`w-full text-[11px] text-right px-1 font-bold${className ? ` ${className}` : ""}`}
      style={{
        background: CB,
        border: CBB,
        height: 18,
        lineHeight: "18px",
        color: color ?? "#1a1a1a",
        userSelect: "text",
      }}>
      {value}
    </div>
  );
}

export function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[11px] px-1"
      style={{
        background: "white",
        border: "1px solid #c8c8c8",
        height: 18,
        outline: "none",
        fontFamily: "inherit",
      }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function CheckField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center px-1" style={{ height: 18 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 12, height: 12, cursor: "pointer" }}
      />
    </div>
  );
}

export function InlineLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
      <span className="text-[11px] text-gray-700 flex-shrink-0" style={{ width: 130 }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}