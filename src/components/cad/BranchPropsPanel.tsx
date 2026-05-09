import { useState } from "react";
import { type TopoBranch, type Horizon } from "@/lib/topology";
import { SURFACE_TYPES } from "@/lib/aerodynamics";
import { FAN_CATALOG, getFanById } from "@/lib/fanCurves";

interface BranchPropsPanelProps {
  branch: TopoBranch;
  horizons: Horizon[];
  onUpdate: (patch: Partial<TopoBranch>) => void;
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
  "Топология", "Вентилятор", "Переменные", "Люди",
  "Усл.обозначения", "Датчики", "Дегазация",
  "Трубы: вода", "Трубы: газ", "Конвейер",
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

export default function BranchPropsPanel({ branch, horizons, onUpdate }: BranchPropsPanelProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>("Топология");
  const [name, setName] = useState(branch.id);
  const [comment, setComment] = useState("");
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

  const angle = (() => {
    return 0;
  })();

  const unitR = branch.length > 0 && branch.area > 0
    ? branch.resistance / branch.length
    : 0;

  return (
    <div className="flex flex-col h-full" style={{ fontSize: 11 }}>

      <div className="flex flex-wrap gap-0 px-0 pt-0"
        style={{ borderBottom: "1px solid #c0c0c0", background: "#f0f0f0" }}>
        {INNER_TABS.map((t) => (
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
            </InlineLabel>

            <InlineLabel label="Угол наклона, °">
              <ComputedInput value={numFmt(angle, 1)} />
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

            <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
              <div className="text-[11px] text-gray-600 mb-0.5">Название ветви</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full text-[11px] px-1"
                style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }}
              />
            </div>

            <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
              <div className="text-[11px] text-gray-600 mb-0.5">Комментарии</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full text-[11px] px-1"
                style={{ border: "1px solid #c8c8c8", outline: "none", resize: "vertical", background: "white", fontFamily: "inherit" }}
              />
            </div>

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

            <InlineLabel label="Пласт">
              <SelectField value={plast} options={PLAST_OPTIONS} onChange={setPlast} />
            </InlineLabel>

            <InlineLabel label="ПЛА">
              <SelectField value={pla} options={PLA_OPTIONS} onChange={setPla} />
            </InlineLabel>

            <InlineLabel label="Поле">
              <SelectField value={pole} options={POLE_OPTIONS} onChange={setPole} />
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
            <SectionHeader title="Вентилятор (источник напора)" />

            <InlineLabel label="Установлен">
              <CheckField
                checked={branch.hasFan}
                onChange={(v) => onUpdate({ hasFan: v })}
              />
            </InlineLabel>

            {branch.hasFan && (
              <>
                <InlineLabel label="Режим задания">
                  <select
                    value={branch.fanMode}
                    onChange={(e) => onUpdate({ fanMode: e.target.value as "constant" | "curve" })}
                    className="w-full text-[11px] px-1"
                    style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                    <option value="constant">Постоянная депрессия</option>
                    <option value="curve">Q-H характеристика</option>
                  </select>
                </InlineLabel>

                <InlineLabel label="Название">
                  <EditInput
                    value={branch.fanName}
                    onChange={(v) => onUpdate({ fanName: v })}
                  />
                </InlineLabel>

                {branch.fanMode === "constant" && (
                  <InlineLabel label="Депрессия H, Па">
                    <EditInput
                      type="number" step="10"
                      value={branch.fanPressure}
                      onChange={(v) => onUpdate({ fanPressure: parseFloat(v) || 0 })}
                    />
                  </InlineLabel>
                )}

                {branch.fanMode === "curve" && (
                  <>
                    <InlineLabel label="Модель вентилятора">
                      <select
                        value={branch.fanCurveId}
                        onChange={(e) => {
                          const f = getFanById(e.target.value);
                          onUpdate({ fanCurveId: e.target.value, fanName: f?.name ?? "" });
                        }}
                        className="w-full text-[11px] px-1"
                        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                        <option value="">— выберите вентилятор —</option>
                        {FAN_CATALOG.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </InlineLabel>

                    {branch.fanCurveId && (() => {
                      const curve = getFanById(branch.fanCurveId);
                      if (!curve) return null;
                      return (
                        <>
                          <InlineLabel label="Q ном., м³/с">
                            <ComputedInput value={numFmt(curve.qNominal, 1)} />
                          </InlineLabel>
                          <InlineLabel label="H ном., Па">
                            <ComputedInput value={numFmt(curve.hNominal, 0)} />
                          </InlineLabel>
                          <InlineLabel label="Диапазон Q, м³/с">
                            <ComputedInput value={`${curve.qMin}…${curve.qMax}`} />
                          </InlineLabel>
                        </>
                      );
                    })()}
                  </>
                )}

                <SectionHeader title="Рабочая точка (расчёт)" />

                <InlineLabel label="Q рабочий, м³/с">
                  <ComputedInput value={numFmt(Math.abs(branch.flow), 2)} />
                </InlineLabel>
                <InlineLabel label="H рабочая, Па">
                  <ComputedInput value={numFmt(branch.fanPressure, 0)} />
                </InlineLabel>
                <InlineLabel label="КПД η, %">
                  <ComputedInput value={numFmt(branch.fanEfficiency * 100, 1)} />
                </InlineLabel>
                <InlineLabel label="N на валу, кВт">
                  <ComputedInput value={numFmt(branch.fanShaftPower / 1000, 2)} />
                </InlineLabel>

                <div className="px-1 py-0.5 text-[10px] text-gray-500">
                  Положительное: {branch.fromId} → {branch.toId}
                </div>
              </>
            )}

            {!branch.hasFan && (
              <div className="px-2 py-3 text-[11px] text-gray-400 text-center">
                Вентилятор не установлен
              </div>
            )}
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
