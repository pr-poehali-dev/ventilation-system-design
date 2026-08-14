import { type TopoBranch } from "@/lib/topology";
import { type MineBulkheadExport } from "@/components/cad/EquipmentRefDialog";
import { WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { type UnitsConfig, getUnit } from "@/lib/unitsConfig";
import { solidBulkheadRkMurg, windowBulkheadRkMurg, G_ACCEL } from "@/lib/bulkheads";
import {
  SectionHeader, EditInput, ComputedInput, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface Props {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  mineBulkheads?: MineBulkheadExport[];
  bulkheadSymTypeId?: string;
  bulkheadSymbol?: SchemaSymbol;
  onUpdateBulkheadSym?: (patch: Record<string, unknown>) => void;
  unitsConfig: UnitsConfig;
}

/**
 * Вкладка «Перемычка» панели свойств ветви.
 * Перенос 1:1 из BranchPropsPanel — разметка и логика не менялись.
 */
export default function BranchBulkheadTab({
  branch, onUpdate, mineBulkheads, bulkheadSymTypeId, bulkheadSymbol,
  onUpdateBulkheadSym, unitsConfig,
}: Props) {
  return (
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
                // Читаем параметры из символа перемычки (приоритет) или из полей ветви
                const sym = bulkheadSymbol;
                const mode = sym?.bkResMode ?? branch.bulkheadResMode ?? "project";
                let rBase = 0; // в Мюрг (baseUnit resistance)
                if (mode === "manual") {
                  const r = sym?.bkManualR ?? branch.bulkheadManualR ?? 0;
                  rBase = r * 1e3; // кМюрг → Мюрг
                } else if (mode === "survey") {
                  const q = sym?.bkSurveyQ ?? branch.bulkheadSurveyQ ?? 0;
                  const dp = sym?.bkSurveyDP ?? branch.bulkheadSurveyDP ?? 0;
                  // R = ΔP/(Q²·9.81) кМюрг (ΔP в Па → кгс/м²), как в АэроСети.
                  rBase = q > 0 ? (dp / (q * q * 9.81)) * 1e3 : 0;
                } else {
                  // Перемычка с окном: R = ρ/(2·μ²·S²·g) кМюрг → ×1000 → Мюрг.
                  const isWindow = (bulkheadSymTypeId && WINDOW_BULKHEAD_IDS.has(bulkheadSymTypeId));
                  const winA = sym?.bkWindowArea ?? branch.bulkheadWindowArea ?? 0;
                  if (isWindow && winA > 0.001) {
                    rBase = windowBulkheadRkMurg(winA, branch.area ?? 0, bulkheadSymTypeId ?? branch.bulkheadId) * 1e3;
                  } else {
                    const A = (sym?.bkManualAirPerm ?? branch.bulkheadManualAirPerm)
                      ? (sym?.bkCustomAirPerm ?? branch.bulkheadCustomAirPerm ?? 0)
                      : (sym?.bkAirPerm ?? branch.bulkheadAirPerm ?? 0);
                    const rFallback = sym?.bkBulkheadR ?? branch.bulkheadR ?? 0;
                    // Глухая/парус: R = 1/(A·S)²/SCALE кМюрг → ×1000 → Мюрг (учёт сечения).
                    rBase = A > 0 ? solidBulkheadRkMurg(A, branch.area ?? 0) * 1e3 : rFallback * 1e3;
                  }
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
                      onChange={e => onUpdate(
                        e.target.checked
                          ? {
                              bulkheadManualAirPerm: true,
                              // при включении ручного режима подставляем ТОЧНОЕ
                              // каталожное значение (не округлённое отображаемое),
                              // чтобы сопротивление не менялось
                              bulkheadCustomAirPerm: (branch.bulkheadCustomAirPerm ?? 0) > 0
                                ? branch.bulkheadCustomAirPerm
                                : (branch.bulkheadAirPerm ?? 0),
                            }
                          : { bulkheadManualAirPerm: false }
                      )}
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
                  const sym = bulkheadSymbol;
                  const isManualAirPerm = sym?.bkManualAirPerm ?? branch.bulkheadManualAirPerm;
                  const customAirPerm = sym?.bkCustomAirPerm ?? branch.bulkheadCustomAirPerm ?? 0;
                  const airPerm = sym?.bkAirPerm ?? branch.bulkheadAirPerm ?? 0;
                  const rFallback = sym?.bkBulkheadR ?? branch.bulkheadR ?? 0;
                  const isWindow = (bulkheadSymTypeId && WINDOW_BULKHEAD_IDS.has(bulkheadSymTypeId));
                  const winA = sym?.bkWindowArea ?? branch.bulkheadWindowArea ?? 0;
                  // Глухая/парус: R = 1/(A·S)²/SCALE кМюрг (учёт сечения).
                  const rSolid = (A: number) => solidBulkheadRkMurg(A, branch.area ?? 0);
                  let rBulk = 0;
                  if (isWindow && winA > 0.001) {
                    rBulk = windowBulkheadRkMurg(winA, branch.area ?? 0, bulkheadSymTypeId ?? branch.bulkheadId); // кМюрг
                  } else if (isManualAirPerm && customAirPerm > 0) {
                    rBulk = rSolid(customAirPerm);
                  } else if (airPerm > 0) {
                    rBulk = rSolid(airPerm);
                  } else {
                    rBulk = rFallback; // кМюрг = Па·с²/м⁶
                  }
                  const Q = branch.flow ?? 0;
                  // R в кМюрг (кгс·с²/м⁸) → ΔP в Па: ×g (как в АэроСети).
                  const dpCalc = rBulk * Q * Math.abs(Q) * G_ACCEL;
                  if (rBulk === 0 || Q === 0) return "—";
                  return `${u.fromBase(dpCalc).toFixed(u.decimals)} ${u.symbol}`;
                })()} />
              </InlineLabel>
              <InlineLabel label="P разр., МПа:">
                <EditInput
                  type="number" step="0.01"
                  value={branch.bulkheadFailurePressure ?? 0}
                  onChange={v => onUpdate({ bulkheadFailurePressure: parseFloat(v) || 0 })}
                />
              </InlineLabel>
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
                  const sym = bulkheadSymbol;
                  const q = sym?.bkSurveyQ ?? branch.bulkheadSurveyQ ?? 0;
                  const dp = sym?.bkSurveyDP ?? branch.bulkheadSurveyDP ?? 0;
                  // R = ΔP/(Q²·9.81) кМюрг (как в АэроСети). ΔP = R·Q²
                  // (та же свёртка кМюрг→ΔP, что в расчёте сети).
                  const rBulk = q > 0 ? dp / (q * q * 9.81) : 0;
                  const Q = branch.flow ?? 0;
                  // R в кМюрг (кгс·с²/м⁸) → ΔP в Па: ×g (как в АэроСети).
                  const dpCalc = rBulk * Q * Math.abs(Q) * G_ACCEL;
                  if (rBulk === 0 || Q === 0) return "—";
                  return `${u.fromBase(dpCalc).toFixed(u.decimals)} ${u.symbol}`;
                })()} />
              </InlineLabel>
              <InlineLabel label="P разр., МПа:">
                <EditInput
                  type="number" step="0.01"
                  value={branch.bulkheadFailurePressure ?? 0}
                  onChange={v => onUpdate({ bulkheadFailurePressure: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            </>
          )}

          {/* Режим: Вручную */}
          {(branch.bulkheadResMode ?? "project") === "manual" && (
            <>
              <InlineLabel label="R (Н·с²/м⁸):">
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
                  // R берём из символа перемычки (bkManualR) если он есть, иначе из поля ветви
                  const rBulk = (bulkheadSymbol?.bkManualR ?? branch.bulkheadManualR ?? 0);
                  const Q = branch.flow ?? 0;
                  // R в кМюрг (кгс·с²/м⁸) → ΔP в Па: ×g (как в АэроСети).
                  const dp = rBulk * Q * Math.abs(Q) * G_ACCEL;
                  if (rBulk === 0 || Q === 0) return "—";
                  return `${u.fromBase(dp).toFixed(u.decimals)} ${u.symbol}`;
                })()} />
              </InlineLabel>
              <InlineLabel label="P разр., МПа:">
                <EditInput
                  type="number" step="0.01"
                  value={branch.bulkheadFailurePressure ?? 0}
                  onChange={v => onUpdate({ bulkheadFailurePressure: parseFloat(v) || 0 })}
                />
              </InlineLabel>
            </>
          )}
        </>
      )}
    </div>
  );
}
