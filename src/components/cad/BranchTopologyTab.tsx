import { type TopoBranch, type Horizon } from "@/lib/topology";
import { SURFACE_TYPES, resistanceFromAlpha } from "@/lib/aerodynamics";
import { type BranchType } from "@/components/cad/EquipmentRefDialog";
import { type UnitsConfig, getUnit } from "@/lib/unitsConfig";
import {
  SectionHeader, InlineLabel, EditInput, ComputedInput, CheckField,
  ParamRow, numFmt, BRANCH_TYPES, PLAST_OPTIONS, PLA_OPTIONS, POLE_OPTIONS,
} from "./BranchPropsPrimitives";

interface BranchTopologyTabProps {
  branch: TopoBranch;
  horizons: Horizon[];
  onUpdate: (patch: Partial<TopoBranch>) => void;
  isCapital: boolean;
  setIsCapital: (v: boolean) => void;
  isProjected: boolean;
  setIsProjected: (v: boolean) => void;
  plast: string;
  setPlast: (v: string) => void;
  pla: string;
  setPla: (v: string) => void;
  pole: string;
  setPole: (v: string) => void;
  visible: Set<string>;
  toggle: (id: string) => void;
  unitR: number;
  mineTypes?: BranchType[];
  onOpenTypesLibrary?: () => void;
  unitsConfig: UnitsConfig;
}

export default function BranchTopologyTab({
  branch, horizons, onUpdate,
  isCapital, setIsCapital, isProjected, setIsProjected,
  plast, setPlast, pla, setPla, pole, setPole,
  visible, toggle, unitR,
  mineTypes, onOpenTypesLibrary, unitsConfig,
}: BranchTopologyTabProps) {
  void horizons; void plast; void setPlast; void pla; void setPla; void pole; void setPole;
  void onOpenTypesLibrary; void unitsConfig; void mineTypes;

  const angle = branch.angle ?? 0;

  return (
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
        {(() => {
          // Геометрическое R = α·P·L/S³ (только для режимов с известным α)
          // В режиме manual α не задаётся пользователем — сравнение невозможно
          const hasAlpha = branch.resistanceMode !== "manual";
          const rGeomNsm8 = hasAlpha
            ? resistanceFromAlpha(branch.alphaCoef, branch.perimeter, branch.length, branch.area)
            : 0;
          const rGeomKmu = rGeomNsm8 / 9.81;
          const rAeroKmu = branch.resistance / 9.81;
          const isWrong = hasAlpha && rGeomNsm8 > 0 && branch.resistance < rGeomNsm8;
          return (
            <div className="flex items-center flex-1 min-w-0">
              <ComputedInput
                value={numFmt(rAeroKmu, 7)}
                color={isWrong ? "#dc2626" : undefined}
              />
              {isWrong && (
                <span
                  title={`Ошибка: аэродинамическое сопротивление (${numFmt(rAeroKmu, 4)} кМюрг) меньше геометрического (${numFmt(rGeomKmu, 4)} кМюрг). Аэродинамическое R не может быть меньше геометрического — проверьте параметры ветви.`}
                  className="ml-1 flex-shrink-0 cursor-help"
                  style={{ fontSize: 12, color: "#dc2626" }}
                >⚠</span>
              )}
            </div>
          );
        })()}
      </ParamRow>

      <ParamRow id="v_geom_r" label="Геометр. сопр. R, кμ" visible={visible.has("v_geom_r")} onToggle={toggle}>
        {(() => {
          if (branch.resistanceMode === "manual") {
            return <ComputedInput value="—" />;
          }
          const rGeomNsm8 = resistanceFromAlpha(branch.alphaCoef, branch.perimeter, branch.length, branch.area);
          return <ComputedInput value={numFmt(rGeomNsm8 / 9.81, 7)} />;
        })()}
      </ParamRow>

      <ParamRow id="v_unit_r" label="Ед. сопр. R(ед), кμ/м" visible={visible.has("v_unit_r")} onToggle={toggle}>
        <ComputedInput value={numFmt(unitR / 9.81, 7)} />
      </ParamRow>

      <ParamRow id="v_unit_r_100" label="Уд. сопр. R, кμ/100м" visible={visible.has("v_unit_r_100")} onToggle={toggle}>
        <ComputedInput value={branch.length > 0 ? numFmt((branch.resistance / 9.81) / branch.length * 100, 7) : "—"} />
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

      <ParamRow id="v_r_friction" label="R трение, кμ" visible={visible.has("v_r_friction")} onToggle={toggle}>
        <ComputedInput value={numFmt(branch.rFriction / 9.81, 6)} />
      </ParamRow>

      <ParamRow id="v_r_local" label="R местные, кμ" visible={visible.has("v_r_local")} onToggle={toggle}>
        <ComputedInput value={numFmt(branch.rLocal / 9.81, 6)} />
      </ParamRow>

      <ParamRow id="v_reynolds" label="Re (Рейнольдс), тыс." visible={visible.has("v_reynolds")} onToggle={toggle}>
        <ComputedInput value={numFmt(branch.reynolds / 1000, 1)} />
      </ParamRow>

      <ParamRow id="v_power" label="Энергозатраты N, Вт" visible={visible.has("v_power")} onToggle={toggle}>
        <ComputedInput value={numFmt(branch.power, 0)} />
      </ParamRow>

      {/* Тип выработки */}
      <SectionHeader title="Классификация" />

      <InlineLabel label="Тип выработки">
        <select
          value={branch.type ?? ""}
          onChange={(e) => onUpdate({ type: e.target.value })}
          className="w-full text-[11px] px-1"
          style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
          <option value="">— не задан —</option>
          {BRANCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </InlineLabel>

      <InlineLabel label="Горизонт">
        <select
          value={branch.horizonId ?? ""}
          onChange={(e) => onUpdate({ horizonId: e.target.value })}
          className="w-full text-[11px] px-1"
          style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
          <option value="">— без горизонта —</option>
          {PLAST_OPTIONS.slice(1).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </InlineLabel>

      <InlineLabel label="Примечание">
        <input
          type="text"
          value={branch.comment ?? ""}
          onChange={(e) => onUpdate({ comment: e.target.value })}
          className="w-full text-[11px] px-1"
          style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}
        />
      </InlineLabel>
    </div>
  );
}