// ─────────────────────────────────────────────────────────────────────────────
// BranchFireLoadTab.tsx — вкладка «Пож.нагрузка» панели свойств выработки:
// очаг пожара (самоходная техника, конвейерная лента, линейный очаг),
// мощность тепловыделения и температура продуктов горения.
//
// Вынесено из BranchPropsPanel.tsx БЕЗ изменений разметки, формул и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { calcVehicleFire, calcBelt, calcLinearFire } from "@/lib/fireCalculator";
import {
  SectionHeader, EditInput, CheckField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchFireLoadTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
}

export default function BranchFireLoadTab({ branch, onUpdate }: BranchFireLoadTabProps) {
  // Расход для расчёта t продуктов — ШТАТНЫЙ (до пожара), как в Аэросети.
  // При активном пожаре flow ветви очага может быть локально снижен
  // тепловой депрессией; если считать t по нему, температура нефизично
  // завышается (729°C вместо ~226°C). originalFlow = расход до пожара.
  const bWithOrig = branch as typeof branch & { originalFlow?: number };
  const airFlow = Math.abs(bWithOrig.originalFlow ?? branch.flow ?? 0);
  // Длина ветви (по координатам узлов) — дефолт длины для источников пож.нагрузки
  const branchLenStr = branch.length > 0 ? String(Math.round(branch.length)) : "";
  const massRubber  = branch.fireVehicleMassRubber  ?? 1200;
  const massDiesel  = branch.fireVehicleMassDiesel  ?? 400;
  const massOil     = branch.fireVehicleMassOil     ?? 200;
  const vfr = (branch.fireLoadTech ?? false)
    ? calcVehicleFire([massRubber, massDiesel, massOil], airFlow)
    : null;
  const beltResult = (branch.fireLoadConveyor ?? false)
    ? calcBelt({
        burnRate:   branch.fireBeltBurnRate   ?? "0.013",
        density:    branch.fireBeltDensity    ?? "1200",
        width:      branch.fireBeltWidth      ?? "1.2",
        length:     branch.fireBeltLength     ?? (branchLenStr || "100"),
        thickness:  branch.fireBeltThickness  ?? "0.016",
        flameSpeed: branch.fireBeltFlameSpeed ?? "0.013",
      }, airFlow)
    : null;
  const cableResult = (branch.fireLoadCable ?? false)
    ? calcLinearFire({
        heatValue:    branch.fireCableHeatValue ?? "25",
        burnRate:     branch.fireCableBurnRate  ?? "0.007",
        density:      branch.fireCableDensity   ?? "900",
        length:       branch.fireCableLength    ?? (branchLenStr || "100"),
        sectionWidth: branch.fireCableWidth     ?? "0.05",
        sectionThick: branch.fireCableThick     ?? "0.05",
      }, airFlow)
    : null;
  const woodResult = (branch.fireLoadWoodSupport ?? false)
    ? calcLinearFire({
        heatValue:    branch.fireWoodHeatValue   ?? "13.8",
        burnRate:     branch.fireWoodBurnRate    ?? "0.027",
        density:      branch.fireWoodDensity     ?? "500",
        length:       branch.fireWoodLength      ?? (branchLenStr || "50"),
        sectionWidth: branch.fireWoodWidth       ?? "8.9",
        sectionThick: branch.fireWoodThick       ?? "0.08",
        flameSpeed:   branch.fireWoodFlameSpeed  ?? "0.024",
        calcTime:     branch.fireWoodCalcTime    ?? "10",
      }, airFlow)
    : null;

  return (
    <div>
      <SectionHeader title="Пожарная нагрузка" />
      <InlineLabel label="Техника">
        <CheckField
          checked={branch.fireLoadTech ?? false}
          onChange={(v) => onUpdate({ fireLoadTech: v })}
        />
      </InlineLabel>

      {(branch.fireLoadTech ?? false) && (
        <div className="mx-1 mt-1 mb-2">
          <input
            type="text"
            value={branch.fireVehicleName ?? ""}
            onChange={(e) => onUpdate({ fireVehicleName: e.target.value })}
            placeholder="Название техники..."
            className="w-full text-[11px] font-semibold text-orange-700 mb-1 px-1"
            style={{ border: "none", borderBottom: "1px dashed #f97316", outline: "none", background: "transparent" }}
          />
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th className="text-left px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db", width: "55%" }}>Материал</th>
                <th className="text-right px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db" }}>Масса, кг</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Резина",  key: "fireVehicleMassRubber" as const, val: massRubber },
                { label: "Дизель",  key: "fireVehicleMassDiesel" as const, val: massDiesel },
                { label: "Масло",   key: "fireVehicleMassOil"    as const, val: massOil    },
              ].map(({ label, key, val }) => (
                <tr key={key}>
                  <td className="px-1 py-0.5 text-gray-700" style={{ border: "1px solid #d1d5db" }}>{label}</td>
                  <td className="px-0.5 py-0.5" style={{ border: "1px solid #d1d5db", background: "#f0fdf4" }}>
                    <EditInput
                      type="number" step="10"
                      value={val}
                      onChange={(v) => onUpdate({ [key]: parseFloat(v) || 0 })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {vfr && (
            <div className="mt-1">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr style={{ background: "#fef9c3" }}>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Мощность, МВт</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Расход, м³/с</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>t прод., °C</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-center px-1 py-0.5 font-semibold" style={{ border: "1px solid #d1d5db", color: "#dc2626" }}>
                      {vfr.power_MW.toFixed(2)}
                    </td>
                    <td className="text-center px-1 py-0.5" style={{ border: "1px solid #d1d5db", color: "#2563eb" }}>
                      {airFlow > 0 ? airFlow.toFixed(1) : "—"}
                    </td>
                    <td className="text-center px-1 py-0.5 font-semibold text-gray-800" style={{ border: "1px solid #d1d5db" }}>
                      {vfr.deltaT_C > 0 ? (20 + vfr.deltaT_C).toFixed(1) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[10px] text-gray-500 mt-0.5 px-0.5">
                Время горения: {vfr.burnTime_h.toFixed(2)} ч или {vfr.burnTime_min.toFixed(1)} мин
              </div>
            </div>
          )}
        </div>
      )}

      <InlineLabel label="Конвейерная лента">
        <CheckField
          checked={branch.fireLoadConveyor ?? false}
          onChange={(v) => onUpdate(v
            ? { fireLoadConveyor: v, fireBeltLength: branchLenStr || branch.fireBeltLength || "100" }
            : { fireLoadConveyor: v })}
        />
      </InlineLabel>

      {(branch.fireLoadConveyor ?? false) && (
        <div className="mx-1 mt-1 mb-2">
          <input
            type="text"
            value={branch.fireBeltName ?? "Конвейерная лента"}
            onChange={(e) => onUpdate({ fireBeltName: e.target.value })}
            className="w-full text-[10px] font-semibold text-orange-700 mb-1 px-0"
            style={{ border: "none", borderBottom: "1px dashed #f97316", outline: "none", background: "transparent", paddingBottom: 2 }}
          />
          <table className="w-full text-[11px] border-collapse mb-1">
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th className="text-left px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db", width: "60%" }}>Параметр</th>
                <th className="text-right px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db" }}>Значение</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: "ψ, кг/(м²·с)",    key: "fireBeltBurnRate"   as const, def: "0.013" },
                { label: "ρ, кг/м³",         key: "fireBeltDensity"    as const, def: "1200"  },
                { label: "Ширина, м",        key: "fireBeltWidth"      as const, def: "1.2"   },
                { label: "Длина, м",         key: "fireBeltLength"     as const, def: branchLenStr || "100" },
                { label: "Толщина, м",       key: "fireBeltThickness"  as const, def: "0.016" },
                { label: "v пламени, м/с",   key: "fireBeltFlameSpeed" as const, def: "0.013" },
              ]).map(({ label, key, def }) => (
                <tr key={key}>
                  <td className="px-1 py-0.5 text-gray-700" style={{ border: "1px solid #d1d5db" }}>{label}</td>
                  <td className="px-0.5 py-0.5" style={{ border: "1px solid #d1d5db", background: "#f0fdf4" }}>
                    <EditInput
                      type="number" step="any"
                      value={branch[key] ?? def}
                      onChange={(v) => onUpdate({ [key]: v })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {beltResult && (
            <div className="mt-1">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr style={{ background: "#fef9c3" }}>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Мощность, МВт</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Расход, м³/с</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>ΔT, °C</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-center px-1 py-0.5 font-semibold" style={{ border: "1px solid #d1d5db", color: "#dc2626" }}>
                      {beltResult.powerMax.toFixed(2)}
                    </td>
                    <td className="text-center px-1 py-0.5" style={{ border: "1px solid #d1d5db", color: "#2563eb" }}>
                      {airFlow > 0 ? airFlow.toFixed(1) : "—"}
                    </td>
                    <td className="text-center px-1 py-0.5 font-semibold text-gray-800" style={{ border: "1px solid #d1d5db" }}>
                      {beltResult.deltaT_C > 0 ? beltResult.deltaT_C.toFixed(1) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[10px] text-gray-500 mt-0.5 px-0.5">
                Масса ленты: {beltResult.mass.toFixed(0)} кг · Теплозапас: {beltResult.heatTotal.toFixed(0)} МДж
              </div>
              <div className="text-[10px] text-gray-500 px-0.5">
                Q₃₀={beltResult.power30.toFixed(2)} МВт · Q₆₀={beltResult.power60.toFixed(2)} МВт
              </div>
              {!isNaN(beltResult.burnTime_h) && isFinite(beltResult.burnTime_h) && (
                <div className="text-[10px] text-gray-500 px-0.5">
                  Время горения: {beltResult.burnTime_h.toFixed(2)} ч или {beltResult.burnTime_min.toFixed(1)} мин
                </div>
              )}
            </div>
          )}
          {(branch.fireLoadConveyor && !beltResult) && (
            <div className="text-[10px] text-orange-500 px-0.5 mt-0.5">
              Заполните все параметры для расчёта
            </div>
          )}
        </div>
      )}
      <InlineLabel label="Кабель">
        <CheckField
          checked={branch.fireLoadCable ?? false}
          onChange={(v) => onUpdate(v
            ? { fireLoadCable: v, fireCableLength: branchLenStr || branch.fireCableLength || "100" }
            : { fireLoadCable: v })}
        />
      </InlineLabel>

      {(branch.fireLoadCable ?? false) && (
        <div className="mx-1 mt-1 mb-2">
          <input
            type="text"
            value={branch.fireCableName ?? "Электрокабель"}
            onChange={(e) => onUpdate({ fireCableName: e.target.value })}
            className="w-full text-[10px] font-semibold text-orange-700 mb-1 px-0"
            style={{ border: "none", borderBottom: "1px dashed #f97316", outline: "none", background: "transparent", paddingBottom: 2 }}
          />
          <table className="w-full text-[11px] border-collapse mb-1">
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th className="text-left px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db", width: "60%" }}>Параметр</th>
                <th className="text-right px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db" }}>Значение</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: "Q_н, МДж/кг",       key: "fireCableHeatValue" as const, def: "25"   },
                { label: "ψ, кг/(м²·с)",      key: "fireCableBurnRate"  as const, def: "0.007"},
                { label: "ρ, кг/м³",          key: "fireCableDensity"   as const, def: "900"  },
                { label: "Длина, м",           key: "fireCableLength"    as const, def: branchLenStr || "100" },
                { label: "Ширина сеч., м",     key: "fireCableWidth"     as const, def: "0.05" },
                { label: "Толщина сеч., м",    key: "fireCableThick"     as const, def: "0.05" },
              ]).map(({ label, key, def }) => (
                <tr key={key}>
                  <td className="px-1 py-0.5 text-gray-700" style={{ border: "1px solid #d1d5db" }}>{label}</td>
                  <td className="px-0.5 py-0.5" style={{ border: "1px solid #d1d5db", background: "#f0fdf4" }}>
                    <EditInput type="number" step="any" value={branch[key] ?? def} onChange={(v) => onUpdate({ [key]: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cableResult ? (
            <div className="mt-1">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr style={{ background: "#fef9c3" }}>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Мощность, МВт</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Расход, м³/с</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>ΔT, °C</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-center px-1 py-0.5 font-semibold" style={{ border: "1px solid #d1d5db", color: "#dc2626" }}>{cableResult.powerMW.toFixed(2)}</td>
                    <td className="text-center px-1 py-0.5" style={{ border: "1px solid #d1d5db", color: "#2563eb" }}>{airFlow > 0 ? airFlow.toFixed(1) : "—"}</td>
                    <td className="text-center px-1 py-0.5 font-semibold text-gray-800" style={{ border: "1px solid #d1d5db" }}>{cableResult.deltaT_C > 0 ? cableResult.deltaT_C.toFixed(1) : "—"}</td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[10px] text-gray-500 mt-0.5 px-0.5">
                Масса: {cableResult.mass.toFixed(0)} кг · Теплозапас: {cableResult.heatTotal.toFixed(0)} МДж
              </div>
              {!isNaN(cableResult.burnTime_h) && isFinite(cableResult.burnTime_h) && (
                <div className="text-[10px] text-gray-500 px-0.5">
                  Время горения: {cableResult.burnTime_h.toFixed(2)} ч или {cableResult.burnTime_min.toFixed(1)} мин
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-orange-500 px-0.5 mt-0.5">Заполните все параметры для расчёта</div>
          )}
        </div>
      )}

      <InlineLabel label="Деревянная крепь">
        <CheckField
          checked={branch.fireLoadWoodSupport ?? false}
          onChange={(v) => onUpdate(v
            ? { fireLoadWoodSupport: v, fireWoodLength: branchLenStr || branch.fireWoodLength || "50" }
            : { fireLoadWoodSupport: v })}
        />
      </InlineLabel>

      {(branch.fireLoadWoodSupport ?? false) && (
        <div className="mx-1 mt-1 mb-2">
          <input
            type="text"
            value={branch.fireWoodName ?? "Деревянная крепь"}
            onChange={(e) => onUpdate({ fireWoodName: e.target.value })}
            className="w-full text-[10px] font-semibold text-orange-700 mb-1 px-0"
            style={{ border: "none", borderBottom: "1px dashed #f97316", outline: "none", background: "transparent", paddingBottom: 2 }}
          />
          <table className="w-full text-[11px] border-collapse mb-1">
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th className="text-left px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db", width: "60%" }}>Параметр</th>
                <th className="text-right px-1 py-0.5 font-medium text-gray-600" style={{ border: "1px solid #d1d5db" }}>Значение</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: "Q_н, МДж/кг",         key: "fireWoodHeatValue"  as const, def: "13.8"  },
                { label: "ψ, кг/(м²·с)",        key: "fireWoodBurnRate"   as const, def: "0.027" },
                { label: "ρ, кг/м³",            key: "fireWoodDensity"    as const, def: "500"   },
                { label: "Длина, м",             key: "fireWoodLength"     as const, def: branchLenStr || "50" },
                { label: "Периметр сеч., м",     key: "fireWoodWidth"      as const, def: "8.9"   },
                { label: "Толщина сеч., м",      key: "fireWoodThick"      as const, def: "0.08"  },
                { label: "v пламени, м/с",       key: "fireWoodFlameSpeed" as const, def: "0.024" },
                { label: "Время расч., мин",     key: "fireWoodCalcTime"   as const, def: "10"    },
              ]).map(({ label, key, def }) => (
                <tr key={key}>
                  <td className="px-1 py-0.5 text-gray-700" style={{ border: "1px solid #d1d5db" }}>{label}</td>
                  <td className="px-0.5 py-0.5" style={{ border: "1px solid #d1d5db", background: "#f0fdf4" }}>
                    <EditInput type="number" step="any" value={branch[key] ?? def} onChange={(v) => onUpdate({ [key]: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {woodResult ? (
            <div className="mt-1">
              <table className="w-full text-[11px] border-collapse">
                <thead>
                  <tr style={{ background: "#fef9c3" }}>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Мощность, МВт</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Расход, м³/с</th>
                    <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>ΔT, °C</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-center px-1 py-0.5 font-semibold" style={{ border: "1px solid #d1d5db", color: "#dc2626" }}>{woodResult.powerMW.toFixed(2)}</td>
                    <td className="text-center px-1 py-0.5" style={{ border: "1px solid #d1d5db", color: "#2563eb" }}>{airFlow > 0 ? airFlow.toFixed(1) : "—"}</td>
                    <td className="text-center px-1 py-0.5 font-semibold text-gray-800" style={{ border: "1px solid #d1d5db" }}>{woodResult.deltaT_C > 0 ? woodResult.deltaT_C.toFixed(1) : "—"}</td>
                  </tr>
                </tbody>
              </table>
              <div className="text-[10px] text-gray-500 mt-0.5 px-0.5">
                Масса: {woodResult.mass.toFixed(0)} кг · Теплозапас: {woodResult.heatTotal.toFixed(0)} МДж
              </div>
              <div className="text-[10px] text-gray-500 px-0.5">
                Площадь горения при t={branch.fireWoodCalcTime ?? "10"} мин: {woodResult.surfaceArea.toFixed(1)} м²
              </div>
              {!isNaN(woodResult.burnTime_h) && isFinite(woodResult.burnTime_h) && (
                <div className="text-[10px] text-gray-500 px-0.5">
                  Время полного выгорания: {woodResult.burnTime_h.toFixed(2)} ч / {woodResult.burnTime_min.toFixed(1)} мин
                </div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-orange-500 px-0.5 mt-0.5">Заполните все параметры для расчёта</div>
          )}
        </div>
      )}

      {(() => {
        const sources = [
          vfr        ? { power: vfr.power_MW,        dT: vfr.deltaT_C,        heat: 0 } : null,
          beltResult ? { power: beltResult.powerMax, dT: beltResult.deltaT_C, heat: beltResult.heatTotal } : null,
          cableResult? { power: cableResult.powerMW, dT: cableResult.deltaT_C, heat: cableResult.heatTotal } : null,
          woodResult ? { power: woodResult.powerMW,  dT: woodResult.deltaT_C,  heat: woodResult.heatTotal } : null,
        ].filter((s): s is { power: number; dT: number; heat: number } => s !== null);

        if (sources.length === 0) return null;

        const totalPower = sources.reduce((a, s) => a + (isFinite(s.power) ? s.power : 0), 0);
        const totalDT    = sources.reduce((a, s) => a + (isFinite(s.dT)    ? s.dT    : 0), 0);
        const totalHeat  = sources.reduce((a, s) => a + (isFinite(s.heat)  ? s.heat  : 0), 0);

        return (
          <div className="mt-3">
            <div className="text-[11px] font-bold text-gray-800 mb-1 px-0.5">
              Общая пожарная нагрузка <span className="font-normal text-gray-500">(активных источников: {sources.length})</span>
            </div>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr style={{ background: "#fee2e2" }}>
                  <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Мощность, МВт</th>
                  <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>Расход, м³/с</th>
                  <th className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>ΔT, °C</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-center px-1 py-0.5 font-bold" style={{ border: "1px solid #d1d5db", color: "#b91c1c" }}>{totalPower.toFixed(2)}</td>
                  <td className="text-center px-1 py-0.5" style={{ border: "1px solid #d1d5db", color: "#2563eb" }}>{airFlow > 0 ? airFlow.toFixed(1) : "—"}</td>
                  <td className="text-center px-1 py-0.5 font-bold text-gray-800" style={{ border: "1px solid #d1d5db" }}>{totalDT > 0 ? totalDT.toFixed(1) : "—"}</td>
                </tr>
              </tbody>
            </table>
            {totalHeat > 0 && (
              <div className="text-[10px] text-gray-500 mt-0.5 px-0.5">
                Суммарный теплозапас: {totalHeat.toFixed(0)} МДж
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}