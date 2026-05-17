import { useState, useEffect } from "react";
import { type TopoBranch, type Horizon } from "@/lib/topology";
import { SURFACE_TYPES } from "@/lib/aerodynamics";
import { FAN_CATALOG, getFanById } from "@/lib/fanCurves";

interface BranchPropsPanelProps {
  branch: TopoBranch;
  horizons: Horizon[];
  onUpdate: (patch: Partial<TopoBranch>) => void;
  defaultInnerTab?: InnerTab;
  onRemoveFan?: () => void;
  /** Текущий масштаб символа УО вентилятора на схеме */
  fanSymbolScale?: number;
  /** Изменить масштаб символа УО */
  onFanSymbolScale?: (scale: number) => void;
  /** Удалить только символ УО (без удаления вентилятора из ветви) */
  onFanSymbolDelete?: () => void;
}

const SH = "#e8eef8";
const SB = "1px solid #c8d4e8";
const CB = "#d4d4d4";
const CBB = "1px solid #b0b0b0";

const BRANCH_TYPES = [
  "Ствол ЮВС", "Ствол СВС", "Квершлаг", "Штрек откат.", "Штрек вент.",
  "Уклон", "Очистной", "Сбойка", "Камера", "Конвейер", "Вент. канал",
];

const PLAST_OPTIONS = ["— не задан —", "Пласт 1", "Пласт 2", "Пласт 3", "Пласт 4"];
const PLA_OPTIONS = ["— нет —", "ПЛА-1", "ПЛА-2", "ПЛА-3"];
const POLE_OPTIONS = ["— нет —", "Северное", "Южное", "Западное"];

const INNER_TABS = [
  "Топология", "Вентилятор", "Люди",
  "Усл.обозначения", "Датчики",
  "Трубы: вода", "Конвейер",
] as const;
type InnerTab = typeof INNER_TABS[number];

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center px-1 py-0.5 text-[11px] font-semibold select-none"
      style={{ background: SH, borderBottom: SB, borderTop: SB, color: "#1a3a6b" }}>
      {title}
    </div>
  );
}

function ParamRow({
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

function EditInput({
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

function ComputedInput({ value }: { value: string }) {
  return (
    <div
      className="w-full text-[11px] text-right px-1 font-bold"
      style={{
        background: CB,
        border: CBB,
        height: 18,
        lineHeight: "18px",
        color: "#1a1a1a",
        userSelect: "text",
      }}>
      {value}
    </div>
  );
}

function SelectField({
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

function CheckField({
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

function InlineLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
      <span className="text-[11px] text-gray-700 flex-shrink-0" style={{ width: 130 }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function numFmt(v: number, d = 2): string {
  if (isNaN(v) || v === undefined) return "—";
  return v.toFixed(d);
}

export default function BranchPropsPanel({ branch, horizons, onUpdate, defaultInnerTab, onRemoveFan, fanSymbolScale, onFanSymbolScale, onFanSymbolDelete }: BranchPropsPanelProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>(defaultInnerTab ?? "Топология");

  useEffect(() => {
    if (defaultInnerTab) setInnerTab(defaultInnerTab);
  }, [branch.id, defaultInnerTab]);
  const [name, setName] = useState(branch.id);
  const [isCapital, setIsCapital] = useState(false);
  const [isProjected, setIsProjected] = useState(false);
  const [plast, setPlast] = useState(PLAST_OPTIONS[0]);
  const [pla, setPla] = useState(PLA_OPTIONS[0]);
  const [pole, setPole] = useState(POLE_OPTIONS[0]);

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set([
      "v_name", "v_length", "v_angle", "v_area", "v_resistance", "v_unit_r",
      "v_velocity", "v_adddep", "v_qcalc", "v_flow", "v_height",
      "v_people", "v_dep", "v_natural", "v_time", "v_ch4",
      "v_r_friction", "v_r_local", "v_reynolds", "v_power",
    ])
  );

  const toggle = (id: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const horizonColor = horizons.find((h) => h.id === branch.horizonId)?.color;

  const angle = branch.angle ?? 0;

  const unitR = branch.length > 0 && branch.area > 0
    ? branch.resistance / branch.length
    : 0;

  return (
    <div className="flex flex-col h-full" style={{ fontSize: 11 }}>

      <div className="flex flex-wrap gap-0 px-0 pt-0"
        style={{ borderBottom: "1px solid #c0c0c0", background: "#f0f0f0" }}>
        {INNER_TABS.filter(t => t !== "Вентилятор" || branch.hasFan).map((t) => (
          <button
            key={t}
            onClick={() => setInnerTab(t)}
            className="text-[10px] px-2 py-0.5 flex-shrink-0"
            style={{
              background: innerTab === t ? "#ffffff" : "transparent",
              borderTop: innerTab === t ? "1px solid #b8b8b8" : "1px solid transparent",
              borderLeft: innerTab === t ? "1px solid #b8b8b8" : "1px solid transparent",
              borderRight: innerTab === t ? "1px solid #b8b8b8" : "1px solid transparent",
              borderBottom: innerTab === t ? "1px solid #ffffff" : "1px solid transparent",
              marginBottom: innerTab === t ? "-1px" : "0",
              fontWeight: innerTab === t ? 600 : 400,
              color: innerTab === t ? "#1a3a6b" : "#555",
              cursor: "pointer",
            }}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">

        {innerTab === "Топология" && (
          <div>
            <SectionHeader title="Геометрия" />

            <InlineLabel label="Ветвь №">
              <EditInput value={branch.id} readOnly />
            </InlineLabel>

            <InlineLabel label="Нач. узел">
              <EditInput value={branch.fromId} readOnly />
            </InlineLabel>

            <InlineLabel label="Кон. узел">
              <EditInput value={branch.toId} readOnly />
            </InlineLabel>

            <InlineLabel label="Длина, м">
              <div className="flex items-center gap-0.5 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  {branch.manualLength ? (
                    <EditInput
                      type="number"
                      step="0.5"
                      value={branch.length}
                      onChange={(v) => onUpdate({ length: parseFloat(v) || 0 })}
                    />
                  ) : (
                    <ComputedInput value={numFmt(branch.length, 1)} />
                  )}
                </div>
                <button
                  onClick={() => onUpdate({ manualLength: !branch.manualLength })}
                  title={branch.manualLength ? "Вычислять автоматически из координат" : "Задать вручную"}
                  style={{ fontSize: 10, padding: "1px 4px", border: "1px solid #c8c8c8", borderRadius: 2, background: branch.manualLength ? "#dbeafe" : "#f5f5f5", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
                  {branch.manualLength ? "рук" : "авт"}
                </button>
              </div>
            </InlineLabel>

            <InlineLabel label="Угол наклона, °">
              <div className="flex items-center gap-0.5 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  {branch.manualAngle ? (
                    <EditInput
                      type="number"
                      step="1"
                      value={angle}
                      onChange={(v) => onUpdate({ angle: Math.max(0, Math.min(90, Math.abs(parseFloat(v) || 0))) })}
                    />
                  ) : (
                    <ComputedInput value={numFmt(angle, 1)} />
                  )}
                </div>
                <button
                  onClick={() => onUpdate({ manualAngle: !branch.manualAngle })}
                  title={branch.manualAngle ? "Вычислять автоматически из координат" : "Задать вручную"}
                  style={{ fontSize: 10, padding: "1px 4px", border: "1px solid #c8c8c8", borderRadius: 2, background: branch.manualAngle ? "#dbeafe" : "#f5f5f5", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
                  {branch.manualAngle ? "рук" : "авт"}
                </button>
              </div>
            </InlineLabel>

            <InlineLabel label="Форма сечения">
              <select
                value={branch.shape}
                onChange={(e) => onUpdate({ shape: e.target.value as TopoBranch["shape"] })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                <option value="round">Круглое</option>
                <option value="rect">Прямоугольное</option>
                <option value="trap">Трапециевидное</option>
                <option value="arch">Арочное</option>
                <option value="custom">Задано вручную</option>
              </select>
            </InlineLabel>

            {branch.shape === "round" && (
              <InlineLabel label="Диаметр D, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.diameter}
                  onChange={(v) => onUpdate({ diameter: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}
            {(branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
              <InlineLabel label="Ширина a, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.rectWidth}
                  onChange={(v) => onUpdate({ rectWidth: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}
            {(branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
              <InlineLabel label="Высота b, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.rectHeight}
                  onChange={(v) => onUpdate({ rectHeight: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}
            {branch.shape === "trap" && (
              <InlineLabel label="Верх c, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.trapTopWidth}
                  onChange={(v) => onUpdate({ trapTopWidth: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}
            {branch.shape === "custom" && (
              <>
                <InlineLabel label="Площадь S, м²">
                  <EditInput
                    type="number" step="0.1"
                    value={branch.area}
                    onChange={(v) => onUpdate({ area: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
                <InlineLabel label="Периметр P, м">
                  <EditInput
                    type="number" step="0.1"
                    value={branch.perimeter}
                    onChange={(v) => onUpdate({ perimeter: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
              </>
            )}

            <InlineLabel label="Периметр P, м">
              <ComputedInput value={numFmt(branch.perimeter, 2)} />
            </InlineLabel>

            <InlineLabel label="Площадь S, м²">
              <ComputedInput value={numFmt(branch.area, 2)} />
            </InlineLabel>

            <InlineLabel label="Гидр. диаметр Dh, м">
              <ComputedInput value={numFmt(branch.dh, 3)} />
            </InlineLabel>

            <div style={{ borderBottom: "1px solid #e0e0e0", margin: "2px 0" }} />

            <InlineLabel label="Капитальная">
              <CheckField checked={isCapital} onChange={setIsCapital} />
            </InlineLabel>

            <InlineLabel label="Проектируемая">
              <CheckField checked={isProjected} onChange={setIsProjected} />
            </InlineLabel>

            <SectionHeader title="Аэродинамика" />

            <InlineLabel label="Способ задания R">
              <select
                value={branch.resistanceMode}
                onChange={(e) => onUpdate({ resistanceMode: e.target.value as TopoBranch["resistanceMode"] })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                <option value="surface">По типу поверхности</option>
                <option value="alpha">По коэф. α</option>
                <option value="roughness">По шероховатости Δ</option>
                <option value="manual">Вручную (R)</option>
              </select>
            </InlineLabel>

            {branch.resistanceMode === "surface" && (
              <InlineLabel label="Тип поверхности">
                <select
                  value={branch.surfaceId}
                  onChange={(e) => {
                    const s = SURFACE_TYPES.find((x) => x.id === e.target.value);
                    if (s) onUpdate({ surfaceId: s.id, surface: s.name, alphaCoef: s.alpha, roughness: s.roughness });
                  }}
                  className="w-full text-[11px] px-1"
                  style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                  {SURFACE_TYPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </InlineLabel>
            )}

            {(branch.resistanceMode === "alpha" || branch.resistanceMode === "surface") && (
              <InlineLabel label="Коэф. α, ×10⁻⁴">
                {branch.resistanceMode === "alpha" ? (
                  <EditInput
                    type="number" step="1"
                    value={branch.alphaCoef}
                    onChange={(v) => onUpdate({ alphaCoef: parseFloat(v) || 0 })}
                  />
                ) : (
                  <ComputedInput value={numFmt(branch.alphaCoef, 0)} />
                )}
              </InlineLabel>
            )}

            {branch.resistanceMode === "roughness" && (
              <InlineLabel label="Шероховатость Δ, мм">
                <EditInput
                  type="number" step="1"
                  value={branch.roughness}
                  onChange={(v) => onUpdate({ roughness: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}

            {branch.resistanceMode === "manual" && (
              <InlineLabel label="Сопротивление R, кμ">
                <EditInput
                  type="number" step="0.001"
                  value={branch.manualR}
                  onChange={(v) => onUpdate({ manualR: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}

            <InlineLabel label="Местные ξ (сумма)">
              <EditInput
                type="number" step="0.1"
                value={branch.localXi}
                onChange={(v) => onUpdate({ localXi: parseFloat(v) || 0 })}
              />
            </InlineLabel>

            <InlineLabel label="V max допустимая, м/с">
              <EditInput
                type="number" step="0.5"
                value={branch.vMax}
                onChange={(v) => onUpdate({ vMax: parseFloat(v) || 0 })}
              />
            </InlineLabel>

            <SectionHeader title="Название и группы" />

            <InlineLabel label="Тип выработки">
              <SelectField
                value={branch.type}
                options={BRANCH_TYPES}
                onChange={(v) => onUpdate({ type: v })}
              />
            </InlineLabel>

            <InlineLabel label="Горизонт">
              <div className="flex items-center gap-1">
                <select
                  value={branch.horizonId}
                  onChange={(e) => onUpdate({ horizonId: e.target.value })}
                  className="flex-1 text-[11px] px-1"
                  style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                  <option value="">— без привязки —</option>
                  {horizons.map((h) => (
                    <option key={h.id} value={h.id}>{h.name} ({h.z} м)</option>
                  ))}
                </select>
                {branch.horizonId && horizonColor && (
                  <span style={{ width: 12, height: 12, background: horizonColor, border: "1px solid #888", flexShrink: 0, display: "inline-block" }} />
                )}
              </div>
            </InlineLabel>

            <InlineLabel label="Позиция">
              <SelectField value={pla} options={PLA_OPTIONS} onChange={setPla} />
            </InlineLabel>

            <SectionHeader title="Вычисленные параметры" />

            <ParamRow id="v_name" label="Название ветви" visible={visible.has("v_name")} onToggle={toggle}>
              <ComputedInput value={branch.id} />
            </ParamRow>

            <ParamRow id="v_length" label="Длина ветви, м" visible={visible.has("v_length")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.length, 1)} />
            </ParamRow>

            <ParamRow id="v_angle" label="Угол наклона, °" visible={visible.has("v_angle")} onToggle={toggle}>
              <ComputedInput value={numFmt(angle, 1)} />
            </ParamRow>

            <ParamRow id="v_area" label="Попер. сечение S, м²" visible={visible.has("v_area")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.area, 2)} />
            </ParamRow>

            <ParamRow id="v_resistance" label="Аэродин. сопр. R, кμ" visible={visible.has("v_resistance")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.resistance * 1000, 4)} />
            </ParamRow>

            <ParamRow id="v_unit_r" label="Ед. сопр. R(ед), кμ/м" visible={visible.has("v_unit_r")} onToggle={toggle}>
              <ComputedInput value={numFmt(unitR * 1000, 5)} />
            </ParamRow>

            <ParamRow id="v_velocity" label="Скорость V, м/с" visible={visible.has("v_velocity")} onToggle={toggle}>
              <ComputedInput value={`${numFmt(branch.velocity, 2)}${branch.velocity > branch.vMax ? " ⚠" : ""}`} />
            </ParamRow>

            <ParamRow id="v_adddep" label="Доп. депрессия, Па" visible={visible.has("v_adddep")} onToggle={toggle}>
              <ComputedInput value={branch.hasFan ? numFmt(branch.fanPressure, 1) : "0"} />
            </ParamRow>

            <ParamRow id="v_qcalc" label="Расход расч. Q(расч), м³/с" visible={visible.has("v_qcalc")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.flow, 2)} />
            </ParamRow>

            <ParamRow id="v_flow" label="Расход Q, м³/с" visible={visible.has("v_flow")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.flow, 2)} />
            </ParamRow>

            <ParamRow id="v_height" label="Высота ветви, м" visible={visible.has("v_height")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.rectHeight, 2)} />
            </ParamRow>

            <ParamRow id="v_people" label="Кол-во людей" visible={visible.has("v_people")} onToggle={toggle}>
              <ComputedInput value="0" />
            </ParamRow>

            <ParamRow id="v_dep" label="Депрессия H, Па" visible={visible.has("v_dep")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.dP, 1)} />
            </ParamRow>

            <ParamRow id="v_natural" label="Естеств. тяга H(ест), Па" visible={visible.has("v_natural")} onToggle={toggle}>
              <ComputedInput value="—" />
            </ParamRow>

            <ParamRow id="v_time" label="Время распр. газов T, мин" visible={visible.has("v_time")} onToggle={toggle}>
              <ComputedInput value="—" />
            </ParamRow>

            <ParamRow id="v_ch4" label="Расход метана CH4, м³/мин" visible={visible.has("v_ch4")} onToggle={toggle}>
              <ComputedInput value="—" />
            </ParamRow>

            <ParamRow id="v_r_friction" label="R трение, ×10⁻³ кμ" visible={visible.has("v_r_friction")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.rFriction * 1000, 4)} />
            </ParamRow>

            <ParamRow id="v_r_local" label="R местные, ×10⁻³ кμ" visible={visible.has("v_r_local")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.rLocal * 1000, 4)} />
            </ParamRow>

            <ParamRow id="v_reynolds" label="Re (Рейнольдс), тыс." visible={visible.has("v_reynolds")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.reynolds / 1000, 1)} />
            </ParamRow>

            <ParamRow id="v_power" label="Энергозатраты N, Вт" visible={visible.has("v_power")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.power, 0)} />
            </ParamRow>
          </div>
        )}

        {innerTab === "Вентилятор" && (
          <div>
            {onRemoveFan && (
              <div className="px-1 py-1 flex justify-end" style={{ borderBottom: "1px solid #f0d0d0", background: "#fff5f5" }}>
                <button
                  onClick={onRemoveFan}
                  className="text-[11px] px-3 py-0.5 rounded flex items-center gap-1"
                  style={{ background: "#dc2626", color: "white", border: "none", cursor: "pointer" }}>
                  ✕ Удалить вентилятор
                </button>
              </div>
            )}
            <SectionHeader title="Вентилятор" />

            <InlineLabel label="Название">
              <input
                type="text"
                value={branch.fanName ?? ""}
                onChange={(e) => onUpdate({ fanName: e.target.value })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}
                placeholder="Название вентилятора"
              />
            </InlineLabel>

            {onFanSymbolScale && (
              <InlineLabel label="Масштаб УО">
                <div className="flex items-center gap-1 w-full">
                  <button
                    onClick={() => onFanSymbolScale(Math.max(0.4, (fanSymbolScale ?? 1) - 0.2))}
                    className="text-[10px] px-1.5 rounded"
                    style={{ background: "#e5e7eb", border: "1px solid #c8c8c8", cursor: "pointer", lineHeight: "16px" }}>−</button>
                  <span className="flex-1 text-center text-[11px]">{((fanSymbolScale ?? 1) * 100).toFixed(0)}%</span>
                  <button
                    onClick={() => onFanSymbolScale(Math.min(4, (fanSymbolScale ?? 1) + 0.2))}
                    className="text-[10px] px-1.5 rounded"
                    style={{ background: "#e5e7eb", border: "1px solid #c8c8c8", cursor: "pointer", lineHeight: "16px" }}>+</button>
                </div>
              </InlineLabel>
            )}

            {onFanSymbolDelete && (
              <div className="px-1 py-1">
                <button
                  onClick={onFanSymbolDelete}
                  className="text-[11px] px-2 py-0.5 rounded"
                  style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", cursor: "pointer" }}>
                  Удалить УО с схемы
                </button>
              </div>
            )}

            <SectionHeader title="Режим проветривания" />

            <InlineLabel label="Тип">
              <select
                value={branch.fanMode}
                onChange={(e) => onUpdate({ fanMode: e.target.value as "constant" | "curve" })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                <option value="constant">Постоянный напор</option>
                <option value="curve">Напорная характеристика</option>
              </select>
            </InlineLabel>

            <InlineLabel label="Направление">
              <button
                onClick={() => onUpdate({ fanReverse: !(branch.fanReverse ?? false) })}
                className="w-full text-[11px] px-2 rounded"
                style={{
                  height: 18,
                  background: branch.fanReverse ? "#fee2e2" : "#f0fdf4",
                  color: branch.fanReverse ? "#b91c1c" : "#15803d",
                  border: `1px solid ${branch.fanReverse ? "#fca5a5" : "#86efac"}`,
                  cursor: "pointer",
                  fontWeight: 600,
                }}>
                {branch.fanReverse ? "⟵ Реверс (обратный)" : "⟶ Прямой (нормальный)"}
              </button>
            </InlineLabel>

            {branch.fanMode === "constant" && (
              <>
                {branch.fanPressure <= 0 && (
                  <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded"
                    style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c" }}>
                    ⚠ Напор = 0 Па. Расчёт даст Q=0. Задайте напор вентилятора.
                  </div>
                )}
                <InlineLabel label="Напор, Па">
                  <EditInput type="number" step="10" value={branch.fanPressure}
                    onChange={(v) => onUpdate({ fanPressure: parseFloat(v) || 0 })} />
                </InlineLabel>
                <InlineLabel label="КПД, %">
                  <EditInput type="number" step="1" value={Math.round(branch.fanEfficiency * 100) || 65}
                    onChange={(v) => onUpdate({ fanEfficiency: (parseFloat(v) || 65) / 100 })} />
                </InlineLabel>
              </>
            )}

            {branch.fanMode === "curve" && (() => {
              const curve = getFanById(branch.fanCurveId);
              const rpm = branch.fanRpm || (curve?.rpmNominal ?? 0);
              const bladeAngle = branch.fanBladeAngle ?? (curve?.bladeAngles?.length ? curve.bladeAngles[Math.floor(curve.bladeAngles.length / 2)] : 45);

              // Строим Q-H график (SVG 240×110)
              const W = 240, H_svg = 110, padL = 36, padR = 8, padT = 8, padB = 24;
              const gW = W - padL - padR;
              const gH = H_svg - padT - padB;

              const renderChart = () => {
                if (!curve) return null;
                // Закон подобия: Q ~ n/n0, H ~ (n/n0)²
                const k = rpm > 0 && curve.rpmNominal > 0 ? rpm / curve.rpmNominal : 1;
                // Масштабированные пределы оси X
                const qMin = curve.qMin * k;
                const qMax = curve.qMax * k;

                const anglesToDraw = curve.bladeAngles.length > 0
                  ? curve.bladeAngles
                  : [bladeAngle];

                // Угловой коэф. лопаток (линейная интерполяция по диапазону углов)
                const angleFactor = (a: number) => {
                  if (curve.bladeAngles.length < 2) return 1;
                  const aMin = curve.bladeAngles[0];
                  const aMax = curve.bladeAngles[curve.bladeAngles.length - 1];
                  return 0.55 + 0.9 * (a - aMin) / Math.max(1, aMax - aMin);
                };

                // Шкала H: максимум по всем углам при номинальных оборотах * k²
                let hMax = 0;
                anglesToDraw.forEach(a => {
                  const af = angleFactor(a);
                  for (let i = 0; i <= 20; i++) {
                    const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 20;
                    const h = Math.max(0, curve.h0 * af + curve.h1 * qn + curve.h2 * qn * qn) * k * k;
                    if (h > hMax) hMax = h;
                  }
                });
                hMax = Math.ceil(hMax / 500) * 500 || 2000;

                // Маппинг координат: Q в диапазоне [qMin..qMax] (уже масштабированных)
                const tx = (q: number) => padL + (q - qMin) / (qMax - qMin) * gW;
                const ty = (h: number) => padT + gH - Math.max(0, Math.min(1, h / hMax)) * gH;

                const paths = anglesToDraw.map((a, ai) => {
                  const af = angleFactor(a);
                  const pts: string[] = [];
                  for (let i = 0; i <= 30; i++) {
                    // qn — номинальный расход, q — масштабированный (= qn * k)
                    const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 30;
                    const q = qn * k;
                    const h = Math.max(0, curve.h0 * af + curve.h1 * qn + curve.h2 * qn * qn) * k * k;
                    pts.push(`${tx(q).toFixed(1)},${ty(h).toFixed(1)}`);
                  }
                  const isSelected = a === bladeAngle;
                  return (
                    <polyline key={a}
                      points={pts.join(" ")}
                      fill="none"
                      stroke={isSelected ? "#2563eb" : "#93c5fd"}
                      strokeWidth={isSelected ? 1.8 : 1}
                      strokeDasharray={isSelected ? undefined : "3,2"}
                      opacity={isSelected ? 1 : 0.7}
                      style={{ cursor: "pointer" }}
                      onClick={() => onUpdate({ fanBladeAngle: a })}
                    >
                      <title>Угол {a}°</title>
                    </polyline>
                  );
                  void ai;
                });

                // Рабочая точка
                const qWork = Math.abs(branch.flow);
                const R = qWork > 0.01 ? branch.fanPressure / (qWork * qWork) : 0;
                const workDot = qWork > 0.01 ? (
                  <>
                    <polyline
                      points={Array.from({ length: 20 }, (_, i) => {
                        const q = qMin + (qMax - qMin) * i / 19;
                        return `${tx(q).toFixed(1)},${ty(R * q * q).toFixed(1)}`;
                      }).join(" ")}
                      fill="none" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4,2" />
                    <circle cx={tx(qWork)} cy={ty(branch.fanPressure)} r={4} fill="#ef4444" stroke="white" strokeWidth={1} />
                  </>
                ) : null;

                // Оси
                const nTicks = 4;
                const hTicks = Array.from({ length: nTicks + 1 }, (_, i) => Math.round(hMax * i / nTicks));
                const qTicks = Array.from({ length: 5 }, (_, i) => Math.round(qMin + (qMax - qMin) * i / 4));

                return (
                  <svg width={W} height={H_svg} style={{ display: "block" }}>
                    <rect x={padL} y={padT} width={gW} height={gH} fill="#f8faff" stroke="#d1d5db" strokeWidth={0.5} />
                    {hTicks.map(h => (
                      <g key={h}>
                        <line x1={padL} y1={ty(h)} x2={padL + gW} y2={ty(h)} stroke="#e5e7eb" strokeWidth={0.5} />
                        <text x={padL - 3} y={ty(h) + 3} textAnchor="end" fontSize={8} fill="#6b7280">{h}</text>
                      </g>
                    ))}
                    {qTicks.map(q => (
                      <g key={q}>
                        <line x1={tx(q)} y1={padT} x2={tx(q)} y2={padT + gH} stroke="#e5e7eb" strokeWidth={0.5} />
                        <text x={tx(q)} y={padT + gH + 10} textAnchor="middle" fontSize={8} fill="#6b7280">{q}</text>
                      </g>
                    ))}
                    {paths}
                    {workDot}
                    <text x={padL + gW / 2} y={H_svg - 2} textAnchor="middle" fontSize={8} fill="#6b7280">Q, м³/с</text>
                    <text x={6} y={padT + gH / 2} textAnchor="middle" fontSize={8} fill="#6b7280"
                      transform={`rotate(-90,6,${padT + gH / 2})`}>H, Па</text>
                    {curve.bladeAngles.length > 0 && (
                      <text x={padL + gW - 2} y={padT + 10} textAnchor="end" fontSize={7.5} fill="#2563eb">
                        — Угол {bladeAngle}°
                      </text>
                    )}
                    {qWork > 0.01 && (
                      <text x={tx(qWork) + 6} y={ty(branch.fanPressure) - 4} fontSize={7.5} fill="#ef4444">
                        Q={qWork.toFixed(1)}
                      </text>
                    )}
                  </svg>
                );
              };

              return (
                <>
                  <InlineLabel label="Шаблон">
                    <select
                      value={branch.fanCurveId}
                      onChange={(e) => {
                        const f = getFanById(e.target.value);
                        onUpdate({
                          fanCurveId: e.target.value,
                          fanName: f?.name ?? "",
                          fanRpm: f ? (f.rpmNominal ?? 0) : 0,
                          fanBladeAngle: f?.bladeAngles?.length ? f.bladeAngles[Math.floor(f.bladeAngles.length / 2)] : 45,
                        });
                      }}
                      className="w-full text-[11px] px-1"
                      style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                      <option value="">— выберите модель —</option>
                      {FAN_CATALOG.map((f) => (
                        <option key={f.id} value={f.id}>{f.name} (Ø{f.diameter} м)</option>
                      ))}
                    </select>
                  </InlineLabel>

                  {curve && curve.bladeAngles.length > 0 && (
                    <InlineLabel label="Лопатки">
                      <select
                        value={bladeAngle}
                        onChange={(e) => onUpdate({ fanBladeAngle: Number(e.target.value) })}
                        className="w-full text-[11px] px-1"
                        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                        {curve.bladeAngles.map(a => (
                          <option key={a} value={a}>Угол {a}°</option>
                        ))}
                      </select>
                    </InlineLabel>
                  )}

                  {curve && (
                    <>
                      <InlineLabel label="Скорость">
                        <div className="flex items-center gap-1 w-full">
                          <input
                            type="range"
                            min={curve.rpmMin} max={curve.rpmMax} step={10}
                            value={rpm}
                            onChange={(e) => onUpdate({ fanRpm: Number(e.target.value) })}
                            className="flex-1"
                            style={{ accentColor: "#2563eb" }} />
                          <span className="text-[10px] text-gray-700 w-16 text-right flex-shrink-0">
                            {rpm} об/мин
                          </span>
                        </div>
                      </InlineLabel>
                      <div style={{ marginLeft: 88 }} className="pb-0.5">
                        <span className="text-[9px] text-gray-400">от {curve.rpmMin} до {curve.rpmMax} об/мин</span>
                      </div>

                      <SectionHeader title="Характеристики" />
                      <div className="flex justify-center py-1 overflow-x-auto" style={{ background: "#f8faff" }}>
                        {renderChart()}
                      </div>
                      <div className="px-2 pb-1 flex gap-3 text-[9px] text-gray-400 justify-center flex-wrap">
                        <span style={{ color: "#2563eb" }}>— выбранный угол</span>
                        <span style={{ color: "#93c5fd" }}>-- другие углы</span>
                        {Math.abs(branch.flow) > 0.01 && <span style={{ color: "#ef4444" }}>● рабочая точка</span>}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            <InlineLabel label="В параллели">
              <EditInput type="number" step="1" value={branch.fanParallel ?? 1}
                onChange={(v) => onUpdate({ fanParallel: Math.max(1, parseInt(v) || 1) })} />
            </InlineLabel>

            <InlineLabel label="Установка">
              <select
                value={branch.fanInstall ?? "Внутри перемычки"}
                onChange={(e) => onUpdate({ fanInstall: e.target.value })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                <option>Внутри перемычки</option>
                <option>Снаружи перемычки</option>
                <option>На сопряжении</option>
              </select>
            </InlineLabel>

            <SectionHeader title="Вычисленные параметры" />

            {branch.fanReverse && (
              <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded flex items-center gap-1"
                style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c" }}>
                ⟵ Реверс: Q отрицательный, КПД −10%
              </div>
            )}

            <InlineLabel label="Q выраб., м³/с">
              <ComputedInput value={branch.fanReverse
                ? numFmt(-Math.abs(branch.flow), 2)
                : numFmt(Math.abs(branch.flow), 2)} />
            </InlineLabel>
            <InlineLabel label="Напор, Па">
              <ComputedInput value={numFmt(Math.abs(branch.fanPressure), 0)} />
            </InlineLabel>
            <InlineLabel label="Мощность, кВт">
              <ComputedInput value={numFmt(branch.fanShaftPower / 1000, 1)} />
            </InlineLabel>
            <InlineLabel label="КПД, %">
              <ComputedInput value={`${numFmt(branch.fanEfficiency * 100, 1)}${branch.fanReverse ? " (−10%)" : ""}`} />
            </InlineLabel>
            {(() => {
              const curve = getFanById(branch.fanCurveId);
              return curve ? (
                <InlineLabel label="Диаметр, м">
                  <ComputedInput value={numFmt(curve.diameter, 1)} />
                </InlineLabel>
              ) : null;
            })()}
            <div className="px-1 py-0.5 text-[10px] text-gray-400">
              + : {branch.fromId} → {branch.toId}
            </div>
          </div>
        )}

        {innerTab === "Переменные" && (
          <div className="px-2 py-2 text-[11px] text-gray-400 text-center">
            Нет переменных параметров
          </div>
        )}

        {innerTab === "Люди" && (
          <div>
            <SectionHeader title="Количество людей" />
            <InlineLabel label="Кол-во людей">
              <EditInput type="number" step="1" value={0} onChange={() => {}} />
            </InlineLabel>
            <InlineLabel label="Норматив воздуха, м³/мин на чел.">
              <EditInput type="number" step="0.5" value={6} onChange={() => {}} />
            </InlineLabel>
            <InlineLabel label="Треб. расход, м³/мин">
              <ComputedInput value="—" />
            </InlineLabel>
          </div>
        )}

        {innerTab === "Усл.обозначения" && (
          <div className="px-2 py-2 text-[11px] text-gray-400 text-center">
            Условные обозначения не заданы
          </div>
        )}

        {innerTab === "Датчики" && (
          <div className="px-2 py-2 text-[11px] text-gray-400 text-center">
            Датчики не привязаны
          </div>
        )}

        {innerTab === "Дегазация" && (
          <div>
            <SectionHeader title="Параметры дегазации" />
            <InlineLabel label="Дегазация активна">
              <CheckField checked={false} onChange={() => {}} />
            </InlineLabel>
            <InlineLabel label="Расход CH4, м³/мин">
              <ComputedInput value="—" />
            </InlineLabel>
          </div>
        )}

        {innerTab === "Трубы: вода" && (
          <div className="px-2 py-2 text-[11px] text-gray-400 text-center">
            Водяные трубопроводы не заданы
          </div>
        )}

        {innerTab === "Трубы: газ" && (
          <div className="px-2 py-2 text-[11px] text-gray-400 text-center">
            Газовые трубопроводы не заданы
          </div>
        )}

        {innerTab === "Конвейер" && (
          <div>
            <SectionHeader title="Параметры конвейера" />
            <InlineLabel label="Конвейер установлен">
              <CheckField checked={false} onChange={() => {}} />
            </InlineLabel>
            <InlineLabel label="Тип конвейера">
              <SelectField
                value="Ленточный"
                options={["Ленточный", "Скребковый", "Пластинчатый"]}
                onChange={() => {}}
              />
            </InlineLabel>
            <InlineLabel label="Производительность, т/ч">
              <EditInput type="number" step="10" value={0} onChange={() => {}} />
            </InlineLabel>
          </div>
        )}
      </div>
    </div>
  );
}