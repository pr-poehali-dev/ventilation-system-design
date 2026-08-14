import { type TopoBranch } from "@/lib/topology";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { PRESSURE_REDUCING_VALVES, getValveById, MPA_TO_ATM } from "@/lib/pressureReducingValves";
import {
  SB, SectionHeader, EditInput, ComputedInput, SelectField, CheckField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface Props {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  numFmt: (v: number, d?: number) => string;
  waterBranchResult?: WaterBranchResult;
  onRemoveGate?: () => void;
  onRemoveReducer?: () => void;
  reducerSymbolScale?: number;
  onReducerSymbolScale?: (scale: number) => void;
}

/**
 * Вкладка «Трубы: вода» панели свойств ветви (водопровод ППЗ + воздухопровод).
 * Перенос 1:1 из BranchPropsPanel — разметка и логика не менялись.
 */
export default function BranchWaterPipeTab({
  branch, onUpdate, numFmt, waterBranchResult, onRemoveGate,
  onRemoveReducer, reducerSymbolScale, onReducerSymbolScale,
}: Props) {
  return (
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

        {/* ─── ЗАПОРНЫЙ ВЕНТИЛЬ ────────────────────────────────── */}
        {(branch.wpHasGate) && (() => {
          const closed = branch.wpGateClosed ?? false;
          return (
            <>
              <div className="flex items-center justify-between px-1 py-0.5 text-[11px] font-semibold select-none"
                style={{ background: "#f0f9ff", borderBottom: SB, borderTop: SB, borderLeft: "3px solid #0284c7", color: "#075985" }}>
                <span>Запорный вентиль</span>
                {onRemoveGate && (
                  <button
                    onClick={onRemoveGate}
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", cursor: "pointer", lineHeight: 1 }}
                    title="Удалить запорный вентиль">
                    Удалить вентиль
                  </button>
                )}
              </div>
              <div className="px-1 py-1.5 flex items-center gap-2">
                <button
                  onClick={() => onUpdate({ wpGateClosed: false })}
                  className="flex-1 text-[11px] py-1 rounded font-medium"
                  style={{
                    background: !closed ? "#dcfce7" : "#f3f4f6",
                    color: !closed ? "#166534" : "#6b7280",
                    border: !closed ? "1px solid #86efac" : "1px solid #e5e7eb",
                    cursor: "pointer",
                  }}>
                  Открыт
                </button>
                <button
                  onClick={() => onUpdate({ wpGateClosed: true })}
                  className="flex-1 text-[11px] py-1 rounded font-medium"
                  style={{
                    background: closed ? "#fee2e2" : "#f3f4f6",
                    color: closed ? "#991b1b" : "#6b7280",
                    border: closed ? "1px solid #fca5a5" : "1px solid #e5e7eb",
                    cursor: "pointer",
                  }}>
                  Закрыт
                </button>
              </div>
              <div className="px-1 pb-1.5 text-[10px]" style={{ color: closed ? "#991b1b" : "#166534" }}>
                {closed
                  ? "Течение воды в этой ветви перекрыто"
                  : "Вода свободно проходит через ветвь"}
              </div>
            </>
          );
        })()}

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
                style={{ background: "#f0f9ff", borderBottom: SB, borderTop: SB, borderLeft: "3px solid #0284c7", color: "#075985" }}>
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

              {/* Масштаб УО — как у вентилятора и насоса */}
              {onReducerSymbolScale && (
                <InlineLabel label="Масштаб УО">
                  <div className="flex items-center gap-1 w-full">
                    <input type="range" min={5} max={400} step={5}
                      value={Math.round((reducerSymbolScale ?? 1) * 100)}
                      onChange={(e) => onReducerSymbolScale(Number(e.target.value) / 100)}
                      className="flex-1" style={{ accentColor: "#2563eb" }} />
                    <input type="number" min={5} max={400} step={5}
                      value={Math.round((reducerSymbolScale ?? 1) * 100)}
                      onChange={(e) => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); onReducerSymbolScale(v / 100); }}
                      className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                      style={{ fontSize: 11 }} />
                    <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                  </div>
                </InlineLabel>
              )}

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

      {/* ─── ВОЗДУХОПРОВОД (сжатый воздух) ──────────────────── */}
      <SectionHeader title="Воздухопровод (сжатый воздух)" />
      <InlineLabel label="Воздухопровод задан">
        <CheckField
          checked={branch.hasAirPipe ?? false}
          onChange={(v) => onUpdate({ hasAirPipe: v })}
        />
      </InlineLabel>

      {(branch.hasAirPipe) && (<>
        <SectionHeader title="Геометрия трубы" />
        <InlineLabel label="Диаметр, мм">
          <EditInput
            type="number" step="1"
            value={branch.apDiameter ?? 100}
            onChange={(v) => onUpdate({ apDiameter: parseFloat(v) || 0 })}
          />
        </InlineLabel>
        <InlineLabel label="Материал">
          <SelectField
            value={branch.apMaterial ?? "Сталь"}
            options={["Сталь", "Чугун", "Полиэтилен", "ПВХ", "Асбестоцемент", "Прочее"]}
            onChange={(v) => onUpdate({ apMaterial: v })}
          />
        </InlineLabel>
        <InlineLabel label="Рабочее давление, атм">
          <EditInput
            type="number" step="0.1"
            value={branch.apPressure ?? 6}
            onChange={(v) => onUpdate({ apPressure: parseFloat(v) || 0 })}
          />
        </InlineLabel>
        <InlineLabel label="Длина вручную">
          <CheckField
            checked={branch.apLengthManual ?? false}
            onChange={(v) => onUpdate({ apLengthManual: v })}
          />
        </InlineLabel>
        {branch.apLengthManual && (
          <InlineLabel label="Длина, м">
            <EditInput
              type="number" step="0.1"
              value={branch.apLength ?? 0}
              onChange={(v) => onUpdate({ apLength: parseFloat(v) || 0 })}
            />
          </InlineLabel>
        )}
      </>)}
    </div>
  );
}
