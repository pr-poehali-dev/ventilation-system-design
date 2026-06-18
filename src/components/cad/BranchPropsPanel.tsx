import { useState } from "react";
import { type TopoBranch, type TopoNode, type Horizon } from "@/lib/topology";
import { SURFACE_TYPES, PIPE_ALPHA_TYPES } from "@/lib/aerodynamics";
import { FAN_CATALOG, getFanById } from "@/lib/fanCurves";
import { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import { WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { PRESSURE_REDUCING_VALVES, getValveById, MPA_TO_ATM } from "@/lib/pressureReducingValves";

interface BranchPropsPanelProps {
  branch: TopoBranch;
  horizons: Horizon[];
  onUpdate: (patch: Partial<TopoBranch>) => void;
  defaultInnerTab?: InnerTab;
  /** Активная вкладка из вертикального меню (topology/fan/waterpipes/conveyor) */
  activeTab?: string;
  onRemoveFan?: () => void;
  /** Текущий масштаб символа УО вентилятора на схеме */
  fanSymbolScale?: number;
  /** Изменить масштаб символа УО */
  onFanSymbolScale?: (scale: number) => void;
  /** Удалить только символ УО (без удаления вентилятора из ветви) */
  onFanSymbolDelete?: () => void;
  /** Развернуть ветвь вентилятора (сменить направление нагнетания) */
  onReverse?: () => void;
  /** Расходы прямого режима (для проверки нормы ПБ при реверсе) */
  normalFlows?: Record<string, number>;
  /** Вентиляторы, добавленные в справочник рудника */
  mineFans?: MineFanExport[];
  /** Перемычки, добавленные в справочник рудника */
  mineBulkheads?: MineBulkheadExport[];
  /** Открыть справочник оборудования на вкладке вентиляторов */
  onOpenFanLibrary?: () => void;
  /** Типы выработок из справочника рудника */
  mineTypes?: BranchType[];
  /** Открыть справочник оборудования на вкладке типов выработок */
  onOpenTypesLibrary?: () => void;
  /** typeId символа перемычки на схеме (для определения типа: с окном/проёмом или глухая) */
  bulkheadSymTypeId?: string;
  /** Синхронизировать изменения режима/R перемычки из вкладки ветви в символ на схеме */
  onUpdateBulkheadSym?: (patch: Record<string, unknown>) => void;
  /** Конфигурация единиц измерения */
  unitsConfig?: UnitsConfig;
  /** Все узлы — для отображения коротких имён начального/конечного */
  nodes?: TopoNode[];
  /** Результат гидравлического расчёта водопровода для этой ветви */
  waterBranchResult?: WaterBranchResult;
  /** Удалить УО редукционного клапана и сбросить флаг на ветви */
  onRemoveReducer?: () => void;
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
  "Топология", "Вентилятор", "Трубы: вода", "Конвейер",
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
  options: string[] | { value: string; label: string }[];
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
      {options.map((o) => typeof o === "string"
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>
      )}
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

// Умный форматтер для сопротивления: показывает значащие цифры при очень малых значениях
function fmtR(rKmu: number, minDecimals = 7): string {
  if (isNaN(rKmu) || rKmu === 0) return (0).toFixed(minDecimals);
  const mag = Math.floor(Math.log10(Math.abs(rKmu)));
  const d = Math.max(minDecimals, -mag + 2);
  return rKmu.toFixed(d);
}

export default function BranchPropsPanel({ branch, horizons, onUpdate, defaultInnerTab, activeTab, onRemoveFan, fanSymbolScale, onFanSymbolScale, onFanSymbolDelete, onReverse, normalFlows, mineFans, mineBulkheads, onOpenFanLibrary, mineTypes, onOpenTypesLibrary, bulkheadSymTypeId, onUpdateBulkheadSym, unitsConfig = DEFAULT_UNITS_CONFIG, nodes = [], waterBranchResult, onRemoveReducer }: BranchPropsPanelProps) {
  const shortNode = (id: string): string => {
    const n = nodes.find(nn => nn.id === id);
    if (!n) return id;
    return n.number || n.name || id;
  };
  const tabMap: Record<string, InnerTab> = {
    topology: "Топология",
    fan: "Вентилятор",
    waterpipes: "Трубы: вода",
    conveyor: "Конвейер",
  };
  const innerTab: InnerTab = (activeTab && tabMap[activeTab]) ? tabMap[activeTab] : (defaultInnerTab ?? "Топология");

  const [name, setName] = useState(branch.id);
  const [plast, setPlast] = useState(PLAST_OPTIONS[0]);
  const [pla, setPla] = useState(PLA_OPTIONS[0]);
  const [pole, setPole] = useState(POLE_OPTIONS[0]);

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set([
      "v_name", "v_length", "v_angle", "v_area", "v_resistance", "v_geom_r", "v_unit_r", "v_unit_r_100",
      "v_velocity", "v_adddep", "v_flow", "v_dep",
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

  // Единица отображения аэродинамического сопротивления (по умолчанию кМюрг)
  const uRes = getUnit(unitsConfig, "resistance");
  // Перевод resistance [Н·с²/м⁸] → выбранная единица: сначала Н·с²/м⁸ → Мюрг (* 1/9.81e-3), затем fromBase
  const rToDisplay = (rNsm8: number) => uRes.fromBase(rNsm8 / 9.81e-3);

  return (
    <div className="flex flex-col h-full" style={{ fontSize: 11 }}>

      <div className="flex-1 overflow-y-auto">

        {innerTab === "Топология" && (
          <div>
            <SectionHeader title="Геометрия" />

            <InlineLabel label="Ветвь №">
              <EditInput value={branch.id} readOnly />
            </InlineLabel>

            <InlineLabel label="Нач. узел">
              <EditInput value={shortNode(branch.fromId)} readOnly />
            </InlineLabel>

            <InlineLabel label="Кон. узел">
              <EditInput value={shortNode(branch.toId)} readOnly />
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
                onChange={(e) => {
                  const s = e.target.value as TopoBranch["shape"];
                  const extra: Partial<TopoBranch> = { shape: s, manualSection: s === "custom" };
                  if (s === "arch" && (!branch.archHeight || branch.archHeight > branch.rectWidth / 2)) {
                    extra.archHeight = branch.rectWidth / 2;
                  }
                  onUpdate(extra);
                }}
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
                  onChange={(v) => onUpdate({ diameter: parseFloat(v) || 0, manualSection: false })}
                />
              </InlineLabel>
            )}
            {(branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
              <InlineLabel label="Ширина a, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.rectWidth}
                  onChange={(v) => onUpdate({ rectWidth: parseFloat(v) || 0, manualSection: false })}
                />
              </InlineLabel>
            )}
            {(branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
              <InlineLabel label="Высота b, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.rectHeight}
                  onChange={(v) => onUpdate({ rectHeight: parseFloat(v) || 0, manualSection: false })}
                />
              </InlineLabel>
            )}
            {branch.shape === "arch" && (
              <InlineLabel label="Стрела свода h, м">
                <EditInput
                  type="number" step="0.05"
                  value={branch.archHeight}
                  onChange={(v) => onUpdate({ archHeight: parseFloat(v) || 0, manualSection: false })}
                />
              </InlineLabel>
            )}
            {branch.shape === "trap" && (
              <InlineLabel label="Верх c, м">
                <EditInput
                  type="number" step="0.1"
                  value={branch.trapTopWidth}
                  onChange={(v) => onUpdate({ trapTopWidth: parseFloat(v) || 0, manualSection: false })}
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
              <CheckField checked={branch.capital ?? false} onChange={(v) => onUpdate({ capital: v })} />
            </InlineLabel>

            <InlineLabel label="Проектируемая">
              <CheckField checked={branch.designed ?? false} onChange={(v) => onUpdate({ designed: v })} />
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
                <option value="pipe">Трубопровод (R=6.48αL/D⁵)</option>
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
              <InlineLabel label="Сопротивление R, кМюрг">
                <EditInput
                  type="number" step="0.001"
                  value={branch.manualR}
                  onChange={(v) => onUpdate({ manualR: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            )}

            {branch.resistanceMode === "pipe" && (
              <>
                <InlineLabel label="Диаметр D, м">
                  <EditInput
                    type="number" step="0.05"
                    value={branch.pipeDiameter ?? 0.5}
                    onChange={(v) => onUpdate({ pipeDiameter: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
                <InlineLabel label="Тип трубопровода">
                  <select
                    value={PIPE_ALPHA_TYPES.find(p => p.alpha === (branch.pipeAlpha ?? 9))?.id ?? ""}
                    onChange={(e) => {
                      const p = PIPE_ALPHA_TYPES.find(x => x.id === e.target.value);
                      if (p) onUpdate({ pipeAlpha: p.alpha });
                    }}
                    className="w-full text-[11px] px-1"
                    style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                    <option value="">— выбрать из справочника —</option>
                    {PIPE_ALPHA_TYPES.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.alphaMin}–{p.alphaMax})
                      </option>
                    ))}
                  </select>
                </InlineLabel>
                <InlineLabel label="Коэф. α, ×10⁻⁴">
                  <EditInput
                    type="number" step="0.05"
                    value={branch.pipeAlpha ?? 9}
                    onChange={(v) => onUpdate({ pipeAlpha: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
              </>
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

            <SectionHeader title="Признаки ветви" />

            <InlineLabel label="Утечка">
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", height: 18 }}>
                <input
                  type="checkbox"
                  checked={branch.isLeakage ?? false}
                  onChange={(e) => onUpdate({ isLeakage: e.target.checked })}
                  style={{ accentColor: "#f97316", width: 13, height: 13 }}
                />
                <span style={{
                  fontSize: 11,
                  color: branch.isLeakage ? "#c2410c" : "#6b7280",
                  fontWeight: branch.isLeakage ? 600 : 400,
                }}>
                  {branch.isLeakage ? "Утечка (перемычка/целик)" : "Не утечка"}
                </span>
              </label>
            </InlineLabel>

            {branch.isLeakage && (
              <InlineLabel label="Коэф. утечки">
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    min={0} max={1} step={0.01}
                    value={branch.leakageCoeff ?? 0}
                    onChange={(e) => onUpdate({ leakageCoeff: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
                    style={{ width: 52, height: 18, fontSize: 11, border: "1px solid #fca5a5",
                      background: "white", outline: "none", textAlign: "right", paddingRight: 2 }}
                  />
                  <span style={{ fontSize: 10, color: "#9ca3af" }}>
                    {branch.leakageCoeff > 0
                      ? `${(branch.leakageCoeff * 100).toFixed(0)}% от Q`
                      : "не задан"}
                  </span>
                </div>
              </InlineLabel>
            )}

            <InlineLabel label="Тупик">
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", height: 18 }}>
                <input
                  type="checkbox"
                  checked={branch.isDead ?? false}
                  onChange={(e) => onUpdate({ isDead: e.target.checked })}
                  style={{ accentColor: "#6b7280", width: 13, height: 13 }}
                />
                <span style={{
                  fontSize: 11,
                  color: branch.isDead ? "#374151" : "#6b7280",
                  fontWeight: branch.isDead ? 600 : 400,
                }}>
                  {branch.isDead ? "Тупиковая (Q→0)" : "Сквозная"}
                </span>
              </label>
            </InlineLabel>
            {branch.isDead && (
              <div className="mx-1 mb-1 px-2 py-1 text-[10px] rounded"
                style={{ background: "#f9fafb", border: "1px solid #d1d5db", color: "#6b7280" }}>
                Расчёт задаст Q=0. Контролируется MIN_DEAD_END_FLOW = 0.5 м³/с
              </div>
            )}

            <SectionHeader title="Вычисленные параметры" />

            <ParamRow id="v_name" label="Название ветви" visible={visible.has("v_name")} onToggle={toggle}>
              <ComputedInput value={branch.type || branch.id} />
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

            <ParamRow id="v_resistance" label={`Аэродин. сопр. R, ${uRes.symbol}`} visible={visible.has("v_resistance")} onToggle={toggle}>
              {(() => {
                const rAero = rToDisplay(branch.resistance);
                const rGeom = rToDisplay(branch.rFriction);
                const isWrong = branch.rFriction > 0 && branch.resistance < branch.rFriction;
                return (
                  <div className="relative flex items-center flex-1">
                    <ComputedInput
                      value={fmtR(rAero, uRes.decimals)}
                      color={isWrong ? "#dc2626" : undefined}
                    />
                    {isWrong && (
                      <span
                        title={`Ошибка: аэродинамическое сопротивление (${fmtR(rAero, 4)}) меньше геометрического (${fmtR(rGeom, 4)}). Аэродинамическое R не может быть меньше геометрического — проверьте параметры ветви.`}
                        className="ml-1 cursor-help flex-shrink-0"
                        style={{ fontSize: 12, color: "#dc2626" }}
                      >⚠</span>
                    )}
                  </div>
                );
              })()}
            </ParamRow>

            <ParamRow id="v_geom_r" label={`Геометр. сопр. R, ${uRes.symbol}`} visible={visible.has("v_geom_r")} onToggle={toggle}>
              <ComputedInput value={fmtR(rToDisplay(branch.rFriction), uRes.decimals)} />
            </ParamRow>

            <ParamRow id="v_unit_r" label={`Ед. сопр. R(ед), ${uRes.symbol}/м`} visible={visible.has("v_unit_r")} onToggle={toggle}>
              <ComputedInput value={fmtR(rToDisplay(unitR), uRes.decimals + 1)} />
            </ParamRow>

            <ParamRow id="v_velocity" label="Скорость V, м/с" visible={visible.has("v_velocity")} onToggle={toggle}>
              <ComputedInput value={`${numFmt(branch.velocity, 2)}${branch.velocity > branch.vMax ? " ⚠" : ""}`} />
            </ParamRow>

            <ParamRow id="v_adddep" label="Доп. депрессия, Па" visible={visible.has("v_adddep")} onToggle={toggle}>
              <ComputedInput value={branch.hasFan ? numFmt(branch.fanPressure, 1) : "0"} />
            </ParamRow>

            <ParamRow id="v_flow" label="Расход Q, м³/с" visible={visible.has("v_flow")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.flow, 2)} />
            </ParamRow>

            <ParamRow id="v_dep" label="Депрессия H, Па" visible={visible.has("v_dep")} onToggle={toggle}>
              <ComputedInput value={numFmt(branch.dP, 1)} />
            </ParamRow>

            <ParamRow id="v_r_friction" label={`R трение, ${uRes.symbol}`} visible={visible.has("v_r_friction")} onToggle={toggle}>
              <ComputedInput value={fmtR(rToDisplay(branch.rFriction), uRes.decimals)} />
            </ParamRow>

            <ParamRow id="v_r_local" label={`R местные, ${uRes.symbol}`} visible={visible.has("v_r_local")} onToggle={toggle}>
              <ComputedInput value={fmtR(rToDisplay(branch.rLocal), uRes.decimals)} />
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
                  <input type="range" min={5} max={400} step={5}
                    value={Math.round((fanSymbolScale ?? 1) * 100)}
                    onChange={(e) => onFanSymbolScale(Number(e.target.value) / 100)}
                    className="flex-1" style={{ accentColor: "#2563eb" }} />
                  <input type="number" min={5} max={400} step={5}
                    value={Math.round((fanSymbolScale ?? 1) * 100)}
                    onChange={(e) => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); onFanSymbolScale(v / 100); }}
                    className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                    style={{ fontSize: 11 }} />
                  <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                </div>
              </InlineLabel>
            )}

            {(onFanSymbolDelete || onReverse) && (
              <div className="px-1 py-1 flex gap-1">
                {onFanSymbolDelete && (
                  <button
                    onClick={onFanSymbolDelete}
                    className="text-[11px] px-2 py-0.5 rounded"
                    style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", cursor: "pointer" }}>
                    Удалить УО
                  </button>
                )}
                {onReverse && (
                  <button
                    onClick={onReverse}
                    className="text-[11px] px-2 py-0.5 rounded flex items-center gap-1"
                    style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", cursor: "pointer" }}>
                    ⇄ Развернуть
                  </button>
                )}
              </div>
            )}

            <SectionHeader title="Режим проветривания" />

            <InlineLabel label="Назначение">
              <select
                value={branch.fanType ?? "ГВУ"}
                onChange={(e) => onUpdate({ fanType: e.target.value as "ГВУ" | "ВВУ" | "ВМП" })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                <option value="ГВУ">ГВУ — главная вентиляторная установка</option>
                <option value="ВВУ">ВВУ — вспомогательная вентиляторная установка</option>
                <option value="ВМП">ВМП — вентилятор местного проветривания</option>
              </select>
            </InlineLabel>

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

            {branch.fanType !== "ВМП" && (
              <>
                <InlineLabel label="Направление">
                  <button
                    onClick={() => onUpdate({ fanReverse: !(branch.fanReverse ?? false) })}
                    disabled={branch.fanStopped}
                    className="w-full text-[11px] px-2 rounded"
                    style={{
                      height: 18,
                      background: branch.fanStopped ? "#f3f4f6" : branch.fanReverse ? "#fee2e2" : "#f0fdf4",
                      color: branch.fanStopped ? "#9ca3af" : branch.fanReverse ? "#b91c1c" : "#15803d",
                      border: `1px solid ${branch.fanStopped ? "#d1d5db" : branch.fanReverse ? "#fca5a5" : "#86efac"}`,
                      cursor: branch.fanStopped ? "not-allowed" : "pointer",
                      fontWeight: 600,
                    }}>
                    {branch.fanReverse ? "⟵ Реверс (обратный)" : "⟶ Прямой (нормальный)"}
                  </button>
                </InlineLabel>
                {branch.fanReverse && normalFlows && Object.keys(normalFlows).length === 0 && (
                  <div className="mx-1 my-0.5 px-2 py-1 text-[10px] rounded"
                    style={{ background: "#fef9c3", border: "1px solid #fde047", color: "#854d0e" }}>
                    ⚠ Сначала выполните расчёт в прямом режиме — для проверки норматива ПБ (Q_рев ≥ 60%)
                  </div>
                )}
              </>
            )}
            {branch.fanType === "ВМП" && (
              <div className="mx-1 my-0.5 px-2 py-1 text-[10px] rounded"
                style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0369a1" }}>
                Для смены направления нагнетания — разверните ветвь (Ctrl+R)
              </div>
            )}

            <InlineLabel label="Состояние">
              <button
                onClick={() => onUpdate({ fanStopped: !(branch.fanStopped ?? false) })}
                className="w-full text-[11px] px-2 rounded"
                style={{
                  height: 18,
                  background: branch.fanStopped ? "#fef3c7" : "#f0fdf4",
                  color: branch.fanStopped ? "#92400e" : "#15803d",
                  border: `1px solid ${branch.fanStopped ? "#fcd34d" : "#86efac"}`,
                  cursor: "pointer",
                  fontWeight: 600,
                }}>
                {branch.fanStopped ? "⏹ Остановлен (H=0)" : "▶ Работает"}
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
                    {/* Прямые кривые (прозрачнее при реверсе) */}
                    <g opacity={branch.fanReverse ? 0.35 : 1}>{paths}</g>

                    {/* Реверсная P–Q кривая */}
                    {curve.reverseH0 !== undefined && curve.reverseH1 !== undefined && curve.reverseH2 !== undefined && (() => {
                      const revQMax = (curve.reverseQMax ?? curve.qMax) * k;
                      const revPts: string[] = [];
                      for (let i = 0; i <= 30; i++) {
                        const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 30;
                        const q  = qn * k;
                        const hr = Math.max(0, curve.reverseH0! + curve.reverseH1! * qn + curve.reverseH2! * qn * qn) * k * k;
                        if (q > revQMax) break;
                        revPts.push(`${tx(q).toFixed(1)},${ty(hr).toFixed(1)}`);
                      }
                      return (
                        <g opacity={branch.fanReverse ? 1 : 0.4}>
                          <polyline points={revPts.join(" ")} fill="none"
                            stroke="#dc2626" strokeWidth={branch.fanReverse ? 2 : 1.2}
                            strokeDasharray={branch.fanReverse ? undefined : "5,3"} />
                          <text x={padL + gW * 0.6} y={ty(curve.reverseH0! * k * k) - 3}
                            fontSize={7.5} fill="#dc2626">
                            {branch.fanReverse ? "⟵ Реверс" : "Реверс (инфо)"}
                          </text>
                        </g>
                      );
                    })()}

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
                      <text x={tx(qWork) + 6} y={ty(Math.abs(branch.fanPressure)) - 4} fontSize={7.5} fill="#ef4444">
                        Q={qWork.toFixed(1)}
                      </text>
                    )}
                  </svg>
                );
              };

              return (
                <>
                  {(!mineFans || mineFans.length === 0) ? (
                    <div className="px-2 py-2 mx-1 my-1 rounded text-[10px] text-amber-700 leading-tight"
                      style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
                      Вентиляторы не добавлены в библиотеку рудника.
                      {onOpenFanLibrary && (
                        <button onClick={onOpenFanLibrary}
                          className="block mt-1 underline text-blue-600 cursor-pointer"
                          style={{ background: "none", border: "none", padding: 0, fontSize: 10 }}>
                          Открыть справочник оборудования →
                        </button>
                      )}
                    </div>
                  ) : (
                    <InlineLabel label="Модель">
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
                        {FAN_CATALOG.filter(f => mineFans.some(mf => mf.catalogId === f.id)).map((f) => (
                          <option key={f.id} value={f.id}>{f.name} (Ø{f.diameter} м)</option>
                        ))}
                      </select>
                    </InlineLabel>
                  )}

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
                <option>Без перемычки</option>
              </select>
            </InlineLabel>

            {(branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки" && (
              <InlineLabel label="R перемычки, мюрг">
                <EditInput
                  type="number" step="0.001" min="0"
                  value={branch.fanCrossingR ?? 0}
                  onChange={(v) => onUpdate({ fanCrossingR: Math.max(0, parseFloat(v) || 0) })}
                />
              </InlineLabel>
            )}

            <InlineLabel label="Пл. окна ΔS, м²">
              <EditInput
                type="number" step="0.01" min="0"
                value={branch.fanWindowArea ?? 0}
                onChange={(v) => onUpdate({ fanWindowArea: Math.max(0, parseFloat(v) || 0) })}
              />
            </InlineLabel>

            <SectionHeader title="Вычисленные параметры" />

            {branch.fanStopped && (
              <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded flex items-center gap-1"
                style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e" }}>
                ⏹ Вентилятор остановлен — напор H=0, воздух движется по естественной тяге
              </div>
            )}
            {!branch.fanStopped && branch.fanReverse && branch.fanType !== "ВМП" && (
              <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded flex items-center gap-1"
                style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c" }}>
                {(() => {
                  const curve = getFanById(branch.fanCurveId);
                  const eff = curve?.reverseEfficiencyFactor ?? 0.82;
                  const pct = Math.round((1 - eff) * 100);
                  return `⟵ Реверс (обратный): напор ~${Math.round(eff * 100)}% от прямого, КПД −${pct}%`;
                })()}
              </div>
            )}

            {(() => {
              if (!branch.hasFan || branch.fanMode !== "curve" || Math.abs(branch.flow) < 0.01) return null;
              const curve = getFanById(branch.fanCurveId);
              if (!curve) return null;
              const Q = Math.abs(branch.flow);
              const k = (branch.fanRpm > 0 && curve.rpmNominal > 0) ? branch.fanRpm / curve.rpmNominal : 1;
              let af = 1.0;
              if (curve.bladeAngles.length >= 2) {
                const lo = curve.bladeAngles[0], hi = curve.bladeAngles[curve.bladeAngles.length - 1];
                const a = Math.min(hi, Math.max(lo, branch.fanBladeAngle ?? (lo + hi) / 2));
                af = 0.65 + ((a - lo) / Math.max(1, hi - lo)) * 0.70;
              }
              const qMaxScaled = curve.qMax * af * k;
              if (Q <= qMaxScaled * 1.02) return null;
              return (
                <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded"
                  style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e" }}>
                  ⚠ Q={Q.toFixed(2)} м³/с превышает max {qMaxScaled.toFixed(1)} м³/с для {curve.name} (угол {branch.fanBladeAngle ?? "-"}°). Вентилятор вне паспортной зоны.
                </div>
              );
            })()}

            <InlineLabel label="Q выраб., м³/с">
              <ComputedInput value={branch.fanReverse && branch.fanType !== "ВМП"
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
              <ComputedInput value={numFmt(branch.fanEfficiency * 100, 1)} />
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

        {innerTab === "Перемычка" && (
          <div>
            <SectionHeader title="Перемычка в выработке" />
            <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
              <span className="text-[11px] text-gray-700 flex-shrink-0" style={{ width: 130 }}>Установлена</span>
              <input type="checkbox" checked={branch.hasBulkhead ?? false}
                onChange={e => onUpdate({
                  hasBulkhead: e.target.checked,
                  ...(e.target.checked ? {} : {
                    bulkheadId: "", bulkheadName: "", bulkheadR: 0, bulkheadAirPerm: 0,
                    bulkheadResMode: "project", bulkheadManualAirPerm: false, bulkheadCustomAirPerm: 0,
                    bulkheadSurveyQ: 0, bulkheadSurveyDP: 0, bulkheadManualR: 0,
                    bulkheadWindowArea: 0, bulkheadFailurePressure: 0,
                  })
                })}
                style={{ width: 12, height: 12, cursor: "pointer", accentColor: "#2563eb" }} />
            </div>
            {branch.hasBulkhead && (
              <>
                {/* ── Тип перемычки из справочника ── */}
                <InlineLabel label="Тип перемычки">
                  <select
                    value={branch.bulkheadId ?? ""}
                    onChange={e => {
                      const sel = mineBulkheads?.find(b => b.id === e.target.value);
                      onUpdate({
                        bulkheadId: e.target.value,
                        bulkheadName: sel?.name ?? "",
                        bulkheadR: sel?.rMkyurg ?? 0,
                        bulkheadAirPerm: sel?.airPermeability ?? 0,
                        bulkheadFailurePressure: sel?.failurePressure ?? 0,
                      });
                    }}
                    className="w-full text-[11px] px-1"
                    style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                    <option value="">— выберите из справочника —</option>
                    {(mineBulkheads ?? []).map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </InlineLabel>
                {!mineBulkheads?.length && (
                  <div className="mx-1 my-1 px-2 py-1 text-[10px] rounded"
                    style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e" }}>
                    Справочник перемычек пуст. Откройте Справочники → Перемычки и добавьте перемычки.
                  </div>
                )}

                {/* ── Аэродинамическое сопротивление перемычки ── */}
                <SectionHeader title="Аэродинамическое сопротивление" />

                {/* R = ... (вычисленное/итоговое) */}
                <div className="flex items-center justify-center py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                  <span className="text-[13px] font-semibold" style={{ color: "#1a3a6b" }}>
                    R = {(() => {
                      const uRes = getUnit(unitsConfig, "resistance");
                      const mode = branch.bulkheadResMode ?? "project";
                      // rBase в Мюрг — базовая единица resistance (fromBase ожидает Мюрг)
                      // Соглашение: 1 кМюрг = 9.81 Н·с²/м⁸, 1 Мюрг = 9.81e-3 Н·с²/м⁸
                      let rBase = 0;
                      if (mode === "manual") {
                        rBase = (branch.bulkheadManualR ?? 0) * 1e3; // кМюрг → Мюрг
                      } else if (mode === "survey") {
                        const q = branch.bulkheadSurveyQ ?? 0;
                        const dp = branch.bulkheadSurveyDP ?? 0;
                        // ΔP/Q² = Па/(м³/с)² = Мюрг (базовая единица resistance)
                        rBase = q > 0 ? dp / (q * q) : 0;
                      } else {
                        const A = branch.bulkheadManualAirPerm
                          ? (branch.bulkheadCustomAirPerm ?? 0)
                          : (branch.bulkheadAirPerm ?? 0);
                        // 1/A² = Мюрг (базовая единица resistance)
                        rBase = A > 0
                          ? 1 / (A * A)
                          : (branch.bulkheadR ?? 0); // уже Мюрг
                      }
                      if (rBase === 0) return `— ${uRes.symbol}`;
                      return `${uRes.fromBase(rBase).toFixed(uRes.decimals)} ${uRes.symbol}`;
                    })()}
                  </span>
                </div>

                {/* Задается: */}
                <InlineLabel label="Задается:">
                  <select
                    value={branch.bulkheadResMode ?? "project"}
                    onChange={e => {
                      const mode = e.target.value as "project" | "survey" | "manual";
                      onUpdate({ bulkheadResMode: mode });
                      onUpdateBulkheadSym?.({ bkResMode: mode });
                    }}
                    className="w-full text-[11px] px-1"
                    style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                    <option value="project">Проектными данными</option>
                    <option value="survey">Воздушной съемкой</option>
                    <option value="manual">Вручную</option>
                  </select>
                </InlineLabel>

                {/* Режим: Проектными данными */}
                {(branch.bulkheadResMode ?? "project") === "project" && (
                  <>
                    {(bulkheadSymTypeId && WINDOW_BULKHEAD_IDS.has(bulkheadSymTypeId)) ? (
                      /* Перемычка с окном/проёмом — показываем S вентокна */
                      <InlineLabel label="S вентокна:">
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <EditInput
                            type="number" step="0.1"
                            value={branch.bulkheadWindowArea ?? 0}
                            onChange={v => onUpdate({ bulkheadWindowArea: parseFloat(v) || 0 })}
                          />
                          <span style={{ fontSize: 10, color: "#9ca3af", flexShrink: 0 }}>м²</span>
                        </div>
                      </InlineLabel>
                    ) : (
                      /* Глухая перемычка — воздухопроницаемость */
                      <>
                        <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                          <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>Воздухопроницаемость</span>
                        </div>
                        <div className="flex items-center px-1 py-0.5 gap-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                          <span className="text-[11px] text-gray-700 flex-shrink-0" style={{ width: 130 }}>Тип:</span>
                          <input type="checkbox"
                            checked={branch.bulkheadManualAirPerm ?? false}
                            onChange={e => onUpdate({ bulkheadManualAirPerm: e.target.checked })}
                            style={{ width: 11, height: 11, cursor: "pointer", accentColor: "#2563eb" }} />
                          <span className="text-[11px] text-gray-600">Задается вручную</span>
                        </div>
                        <InlineLabel label="Значение:">
                          {branch.bulkheadManualAirPerm ? (
                            <EditInput
                              type="number" step="0.0001"
                              value={branch.bulkheadCustomAirPerm ?? 0}
                              onChange={v => onUpdate({ bulkheadCustomAirPerm: parseFloat(v) || 0 })}
                            />
                          ) : (
                            <ComputedInput value={branch.bulkheadAirPerm ? `${branch.bulkheadAirPerm.toPrecision(4)} м²/(с·√Па)` : "—"} />
                          )}
                        </InlineLabel>
                      </>
                    )}
                    <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>Вычисленные параметры</span>
                    </div>
                    <InlineLabel label="ΔP:">
                      <ComputedInput value={(() => {
                        const u = getUnit(unitsConfig, "pressure");
                        // rBulk в Н·с²/м⁸ для расчёта ΔP = R × Q × |Q| [Па]
                        let rBulk = 0;
                        if (branch.bulkheadManualAirPerm && (branch.bulkheadCustomAirPerm ?? 0) > 0) {
                          rBulk = 1 / (branch.bulkheadCustomAirPerm! * branch.bulkheadCustomAirPerm!); // Н·с²/м⁸
                        } else if ((branch.bulkheadAirPerm ?? 0) > 0) {
                          rBulk = 1 / (branch.bulkheadAirPerm * branch.bulkheadAirPerm); // Н·с²/м⁸
                        } else {
                          rBulk = (branch.bulkheadR ?? 0) * 9.81e-3; // Мюрг → Н·с²/м⁸ (1 Мюрг = 9.81e-3 Н·с²/м⁸)
                        }
                        const Q = branch.flow ?? 0;
                        const dpCalc = rBulk * Q * Math.abs(Q);
                        if (rBulk === 0 || Q === 0) return branch.dP != null && branch.dP !== 0 ? `${u.fromBase(branch.dP).toFixed(u.decimals)} ${u.symbol}` : "—";
                        return `${u.fromBase(dpCalc).toFixed(u.decimals)} ${u.symbol}`;
                      })()} />
                    </InlineLabel>
                    {(branch.bulkheadFailurePressure ?? 0) > 0 && (
                      <InlineLabel label="P разр.:">
                        <ComputedInput value={(() => { const u = getUnit(unitsConfig, "failurePressure"); return `${u.fromBase(branch.bulkheadFailurePressure ?? 0).toFixed(u.decimals)} ${u.symbol}`; })()} />
                      </InlineLabel>
                    )}
                  </>
                )}

                {/* Режим: Воздушной съемкой */}
                {(branch.bulkheadResMode ?? "project") === "survey" && (
                  <>
                    <InlineLabel label="Расход:">
                      <EditInput
                        type="number" step="0.1"
                        value={branch.bulkheadSurveyQ ?? 0}
                        onChange={v => {
                          const val = parseFloat(v) || 0;
                          onUpdate({ bulkheadSurveyQ: val });
                          onUpdateBulkheadSym?.({ bkSurveyQ: val });
                        }}
                      />
                    </InlineLabel>
                    <InlineLabel label="Падение Р:">
                      <EditInput
                        type="number" step="1"
                        value={branch.bulkheadSurveyDP ?? 0}
                        onChange={v => {
                          const val = parseFloat(v) || 0;
                          onUpdate({ bulkheadSurveyDP: val });
                          onUpdateBulkheadSym?.({ bkSurveyDP: val });
                        }}
                      />
                    </InlineLabel>
                    <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>Вычисленные параметры</span>
                    </div>
                    <InlineLabel label="ΔP:">
                      <ComputedInput value={(() => {
                        const u = getUnit(unitsConfig, "pressure");
                        const q = branch.bulkheadSurveyQ ?? 0;
                        const dp = branch.bulkheadSurveyDP ?? 0;
                        const rBulk = q > 0 ? dp / (q * q) : 0;
                        const Q = branch.flow ?? 0;
                        const dpCalc = rBulk * Q * Math.abs(Q);
                        if (rBulk === 0 || Q === 0) return branch.dP != null && branch.dP !== 0 ? `${u.fromBase(branch.dP).toFixed(u.decimals)} ${u.symbol}` : "—";
                        return `${u.fromBase(dpCalc).toFixed(u.decimals)} ${u.symbol}`;
                      })()} />
                    </InlineLabel>
                  </>
                )}

                {/* Режим: Вручную */}
                {(branch.bulkheadResMode ?? "project") === "manual" && (
                  <>
                    <InlineLabel label="R (кМюрг):">
                      <EditInput
                        type="number" step="0.0001"
                        value={branch.bulkheadManualR ?? 0}
                        onChange={v => {
                          const val = parseFloat(v) || 0;
                          onUpdate({ bulkheadManualR: val });
                          onUpdateBulkheadSym?.({ bkManualR: val });
                        }}
                      />
                    </InlineLabel>
                    <div className="px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>Вычисленные параметры</span>
                    </div>
                    <InlineLabel label="ΔP:">
                      <ComputedInput value={(() => {
                        const u = getUnit(unitsConfig, "pressure");
                        const rBulk = (branch.bulkheadManualR ?? 0) * 1e3;
                        const Q = branch.flow ?? 0;
                        const dp = rBulk * Q * Math.abs(Q);
                        if (rBulk === 0 || Q === 0) return branch.dP != null && branch.dP !== 0 ? `${u.fromBase(branch.dP).toFixed(u.decimals)} ${u.symbol}` : "—";
                        return `${u.fromBase(dp).toFixed(u.decimals)} ${u.symbol}`;
                      })()} />
                    </InlineLabel>
                  </>
                )}
              </>
            )}
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
          <div>
            <SectionHeader title="Водопровод ППЗ" />
            <InlineLabel label="Трубопровод задан">
              <CheckField
                checked={branch.hasWaterPipe ?? false}
                onChange={(v) => onUpdate({ hasWaterPipe: v })}
              />
            </InlineLabel>

            {(branch.hasWaterPipe) && (<>
              <SectionHeader title="Геометрия трубы" />
              <InlineLabel label="Диаметр, мм">
                <EditInput
                  type="number" step="1"
                  value={branch.wpDiameter ?? 100}
                  onChange={(v) => onUpdate({ wpDiameter: parseFloat(v) || 0 })}
                />
              </InlineLabel>
              <InlineLabel label="Материал">
                <SelectField
                  value={branch.wpMaterial ?? "Сталь"}
                  options={["Сталь", "Чугун", "Полиэтилен", "ПВХ", "Асбестоцемент", "Прочее"]}
                  onChange={(v) => onUpdate({ wpMaterial: v })}
                />
              </InlineLabel>
              <InlineLabel label="Длина вручную">
                <CheckField
                  checked={branch.wpLengthManual ?? false}
                  onChange={(v) => onUpdate({ wpLengthManual: v })}
                />
              </InlineLabel>
              {branch.wpLengthManual && (
                <InlineLabel label="Длина, м">
                  <EditInput
                    type="number" step="0.1"
                    value={branch.wpLength ?? 0}
                    onChange={(v) => onUpdate({ wpLength: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
              )}

              <SectionHeader title="Гидравлическое сопротивление" />
              <InlineLabel label="Шероховатость">
                <SelectField
                  value={branch.wpRoughnessMode ?? "rough"}
                  options={[
                    { value: "smooth", label: "Гладкая" },
                    { value: "rough",  label: "Шероховатая" },
                    { value: "manual", label: "Вручную" },
                  ]}
                  onChange={(v) => onUpdate({ wpRoughnessMode: v as TopoBranch["wpRoughnessMode"] })}
                />
              </InlineLabel>
              {(branch.wpRoughnessMode ?? "rough") === "rough" && (
                <InlineLabel label="Шероховатость, мм">
                  <EditInput
                    type="number" step="0.01"
                    value={branch.wpRoughness ?? 0.5}
                    onChange={(v) => onUpdate({ wpRoughness: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
              )}
              {(branch.wpRoughnessMode ?? "rough") === "manual" && (
                <InlineLabel label="R, МН·с²/м⁸">
                  <EditInput
                    type="number" step="0.001"
                    value={branch.wpManualR ?? 0}
                    onChange={(v) => onUpdate({ wpManualR: parseFloat(v) || 0 })}
                  />
                </InlineLabel>
              )}
              <InlineLabel label="Σξ местных сопр.">
                <EditInput
                  type="number" step="0.1"
                  value={branch.wpLocalXi ?? 0}
                  onChange={(v) => onUpdate({ wpLocalXi: parseFloat(v) || 0 })}
                />
              </InlineLabel>

              {/* ─── РЕДУКЦИОННЫЙ КЛАПАН ─────────────────────────────── */}
              {(branch.wpHasReducer) && (() => {
                const model = getValveById(branch.wpReducerModel ?? "kppr_50");
                const reducerActive = waterBranchResult?.reducerActive ?? false;
                const inPMpa  = waterBranchResult?.reducerInP  ?? 0;
                const outPMpa = waterBranchResult?.reducerOutP ?? 0;
                const cutMpa  = waterBranchResult?.reducerDeltaP ?? 0;
                const inPatm  = (inPMpa  * MPA_TO_ATM).toFixed(1);
                const outPatm = (outPMpa * MPA_TO_ATM).toFixed(1);
                const cutAtm  = (cutMpa  * MPA_TO_ATM).toFixed(1);
                const outTarget = branch.wpReducerOutPressure ?? 0.5;
                return (
                  <>
                    <div className="flex items-center justify-between px-1 py-0.5 text-[11px] font-semibold select-none"
                      style={{ background: SH, borderBottom: SB, borderTop: SB, color: "#1a3a6b" }}>
                      <span>Редукционный клапан</span>
                      {onRemoveReducer && (
                        <button
                          onClick={onRemoveReducer}
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", cursor: "pointer", lineHeight: 1 }}
                          title="Удалить редукционный клапан">
                          Удалить клапан
                        </button>
                      )}
                    </div>

                    {/* Модель */}
                    <InlineLabel label="Модель:">
                      <SelectField
                        value={branch.wpReducerModel ?? "kppr_50"}
                        options={PRESSURE_REDUCING_VALVES.map(v => ({ value: v.id, label: v.name }))}
                        onChange={(v) => {
                          const valve = getValveById(v);
                          if (valve) {
                            onUpdate({
                              wpReducerModel: v,
                              wpReducerMaxFlow: valve.id === "manual" ? (branch.wpReducerMaxFlow ?? 25) : valve.flowMax,
                            });
                          }
                        }}
                      />
                    </InlineLabel>

                    {/* Справка по модели */}
                    {model && model.id !== "manual" && (
                      <div className="px-1 pb-1 text-[10px] text-gray-400 leading-tight">
                        {model.manufacturer} · DN{model.nominalDiameter} · вход до {(model.inletPressureMax * MPA_TO_ATM).toFixed(0)} атм · выход {(model.outletPressureMin * MPA_TO_ATM).toFixed(0)}–{(model.outletPressureMax * MPA_TO_ATM).toFixed(0)} атм
                      </div>
                    )}

                    {/* Настройка выходного давления */}
                    <InlineLabel label="Вых. давление, атм:">
                      <EditInput
                        type="number" step="0.5"
                        value={+(outTarget * MPA_TO_ATM).toFixed(1)}
                        onChange={(v) => {
                          const atm = parseFloat(v) || 5;
                          const mpa = atm / MPA_TO_ATM;
                          const min = model ? model.outletPressureMin : 0.1;
                          const max = model ? model.outletPressureMax : 9.9;
                          onUpdate({ wpReducerOutPressure: Math.min(max, Math.max(min, mpa)) });
                        }}
                      />
                    </InlineLabel>

                    {/* Макс. расход (для ручного режима) */}
                    {(branch.wpReducerModel ?? "kppr_50") === "manual" && (
                      <InlineLabel label="Макс. расход, м³/ч:">
                        <EditInput
                          type="number" step="1"
                          value={branch.wpReducerMaxFlow ?? 25}
                          onChange={(v) => onUpdate({ wpReducerMaxFlow: parseFloat(v) || 0 })}
                        />
                      </InlineLabel>
                    )}

                    {/* Статус и результаты */}
                    <div className="flex items-center px-1 py-0.5 gap-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: reducerActive ? "#fef08a" : "#e5e7eb",
                          color: reducerActive ? "#92400e" : "#6b7280",
                        }}>
                        {reducerActive ? "● Активен" : "○ Не активен"}
                      </span>
                    </div>
                    {reducerActive && (
                      <>
                        <InlineLabel label="Давл. на входе:">
                          <ComputedInput value={`${numFmt(inPMpa, 3)} МПа (${inPatm} атм)`} />
                        </InlineLabel>
                        <InlineLabel label="Давл. на выходе:">
                          <ComputedInput value={`${numFmt(outPMpa, 3)} МПа (${outPatm} атм)`} />
                        </InlineLabel>
                        <InlineLabel label="Срезано:">
                          <ComputedInput value={`${numFmt(cutMpa, 3)} МПа (${cutAtm} атм)`} />
                        </InlineLabel>
                      </>
                    )}
                  </>
                );
              })()}

              <SectionHeader title="Вычисленные параметры" />
              <InlineLabel label="Сопротивление, МН·с²/м⁸">
                <ComputedInput value={numFmt(waterBranchResult?.resistance ?? 0, 4)} />
              </InlineLabel>
              <InlineLabel label="Расход, м³/ч">
                <ComputedInput value={numFmt(waterBranchResult?.flow ?? 0, 2)} />
              </InlineLabel>
              <InlineLabel label="Скорость, м/с">
                <ComputedInput value={numFmt(waterBranchResult?.velocity ?? 0, 2)} />
              </InlineLabel>
              <InlineLabel label="Потери давл., МПа">
                <ComputedInput value={numFmt(waterBranchResult?.deltaP ?? 0, 4)} />
              </InlineLabel>
            </>)}
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