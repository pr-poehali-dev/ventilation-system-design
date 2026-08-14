// Базовые UI-примитивы для панелей свойств ветви
import { useState, useEffect } from "react";

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

// ─── Цветовые акценты смысловых групп ────────────────────────────────────────
// В длинной панели свойств все заголовки выглядели одинаково серыми, и нужный
// блок приходилось искать чтением. Каждой группе даём свой цвет: слева цветная
// полоса, заголовок в тон. Цвет = смысл, а не украшение.
type SectionTone = { bar: string; bg: string; text: string };

const TONE_GEOMETRY: SectionTone = { bar: "#2563eb", bg: "#eff6ff", text: "#1e40af" }; // синий
const TONE_AERO:     SectionTone = { bar: "#0891b2", bg: "#ecfeff", text: "#155e75" }; // бирюзовый
const TONE_RESULT:   SectionTone = { bar: "#16a34a", bg: "#f0fdf4", text: "#166534" }; // зелёный
const TONE_DANGER:   SectionTone = { bar: "#dc2626", bg: "#fef2f2", text: "#991b1b" }; // красный
const TONE_WATER:    SectionTone = { bar: "#0284c7", bg: "#f0f9ff", text: "#075985" }; // голубой
const TONE_EQUIP:    SectionTone = { bar: "#ea580c", bg: "#fff7ed", text: "#9a3412" }; // оранжевый
const TONE_INFO:     SectionTone = { bar: "#6b7280", bg: "#f9fafb", text: "#374151" }; // серый

const SECTION_TONES: Record<string, SectionTone> = {
  "Геометрия":                    TONE_GEOMETRY,
  "Геометрия трубы":              TONE_GEOMETRY,
  "Аэродинамика":                 TONE_AERO,
  "Аэродинамическое сопротивление": TONE_AERO,
  "Режим проветривания":          TONE_AERO,
  "Физика":                       TONE_AERO,
  "Вычисленные параметры":        TONE_RESULT,
  "Характеристики":               TONE_RESULT,
  "Пожарная нагрузка":            TONE_DANGER,
  "Противопожарная защита":       TONE_DANGER,
  "Параметры дегазации":          TONE_DANGER,
  "Водопровод ППЗ":               TONE_WATER,
  "Гидравлическое сопротивление": TONE_WATER,
  "Воздухопровод (сжатый воздух)": TONE_WATER,
  "Вентилятор":                   TONE_EQUIP,
  "Параметры конвейера":          TONE_EQUIP,
  "Перемычка в выработке":        TONE_EQUIP,
  "Признаки ветви":               TONE_INFO,
  "Классификация":                TONE_INFO,
  "Количество людей":             TONE_INFO,
};

export function SectionHeader({ title }: { title: string }) {
  const tone = SECTION_TONES[title] ?? TONE_INFO;
  return (
    <div className="flex items-center px-1 py-1 text-[11px] font-semibold select-none"
      style={{
        background: tone.bg,
        borderBottom: SB,
        borderTop: SB,
        borderLeft: `3px solid ${tone.bar}`,
        color: tone.text,
      }}>
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
  placeholder,
}: {
  value: string | number;
  onChange?: (v: string) => void;
  type?: string;
  step?: string;
  readOnly?: boolean;
  /** Подсказка в пустом поле — например, значение «по умолчанию из норм» */
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      step={step}
      value={value}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className="w-full text-[11px] text-right px-1 cad-edit-input"
      style={{
        // Редактируемое поле — белое с чёткой рамкой, чтобы визуально отличалось
        // от расчётных значений, которые править нельзя.
        background: readOnly ? "#f1f5f9" : "#ffffff",
        border: readOnly ? "1px solid #d8dee6" : "1px solid #94a3b8",
        borderRadius: 2,
        height: 18,
        outline: "none",
        fontFamily: "inherit",
        color: readOnly ? "#475569" : "#0f172a",
      }}
    />
  );
}

/**
 * Поле для ввода ДРОБНЫХ чисел.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ КОМПОНЕНТ. Обычное поле сразу превращает набранный текст в
 * число и кладёт результат обратно в поле. Из-за этого дробное значение ввести
 * невозможно: как только пользователь печатает «0.», точка отбрасывается
 * (Number("0.") = 0), поле мгновенно переписывается на «0», и следующая цифра
 * уже не попадает в дробную часть. Так же теряется промежуточное состояние
 * «0.00» при наборе «0.003».
 *
 * Решение: пока поле в фокусе, показываем ровно то, что напечатал человек, а
 * наружу отдаём разобранное число. Как только фокус ушёл — показываем
 * нормализованное значение из модели.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  /** Текущее значение из модели */
  value: number;
  /** Вызывается с разобранным числом (NaN не отдаётся) */
  onChange: (v: number) => void;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  // Черновик хранит СЫРОЙ текст пользователя, включая незавершённые «0.» и «1,2»
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Пока поле в фокусе, черновик трогать нельзя — иначе набор разваливается на
  // полпути. Сбрасываем его только когда значение поменяли ИЗВНЕ (выбрали
  // другую выработку, прошёл пересчёт), то есть при снятом фокусе.
  useEffect(() => {
    if (!focused) setDraft(null);
  }, [value, focused]);

  const shown = draft !== null ? draft : (value === 0 ? "" : String(value));

  return (
    <input
      type="text"
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      onChange={(e) => {
        // Разрешаем только цифры, точку/запятую и минус — буквы игнорируем,
        // чтобы в числовое поле нельзя было занести мусор.
        const raw = e.target.value.replace(/[^\d.,-]/g, "");
        setDraft(raw);
        const parsed = parseFloat(raw.replace(",", "."));
        if (!isNaN(parsed)) {
          const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
          onChange(clamped);
        } else if (raw === "" ) {
          onChange(0);
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setDraft(null); }}
      className="w-full text-[11px] text-right px-1 cad-edit-input"
      style={{
        background: "#ffffff",
        border: "1px solid #94a3b8",
        borderRadius: 2,
        height: 18,
        outline: "none",
        fontFamily: "inherit",
        color: "#0f172a",
      }}
    />
  );
}

export function ComputedInput({ value, color, className }: { value: string; color?: string; className?: string }) {
  return (
    <div
      className={`w-full text-[11px] text-right px-1 font-semibold tabular-nums${className ? ` ${className}` : ""}`}
      title="Расчётное значение — изменить нельзя"
      style={{
        // Результат расчёта: без рамки поля ввода, приглушённый фон, моноширинные
        // цифры — сразу видно, что это вывод, а не поле для правки.
        background: "#eef2f7",
        border: "1px solid #dde3ec",
        borderRadius: 2,
        height: 18,
        lineHeight: "16px",
        color: color ?? "#0f172a",
        userSelect: "text",
        cursor: "default",
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
  // Опции задаются либо простым списком строк, либо парами {value,label} —
  // когда отображаемое название не совпадает с сохраняемым значением.
  options: (string | { value: string; label: string })[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[11px] px-1 cad-edit-input"
      style={{
        background: "#ffffff",
        border: "1px solid #94a3b8",
        borderRadius: 2,
        height: 18,
        outline: "none",
        fontFamily: "inherit",
        color: "#0f172a",
      }}>
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const lbl = typeof o === "string" ? o : o.label;
        return <option key={val} value={val}>{lbl}</option>;
      })}
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