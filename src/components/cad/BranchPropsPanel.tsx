import { useState } from "react";
import { type TopoBranch, type TopoNode, type Horizon } from "@/lib/topology";
import { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import { WINDOW_BULKHEAD_IDS } from "@/lib/schemaSymbols";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { type VentSection, type VentNorms, DEFAULT_VENT_NORMS } from "@/lib/ventSections";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
import { PRESSURE_REDUCING_VALVES, getValveById, MPA_TO_ATM } from "@/lib/pressureReducingValves";
import { solidBulkheadRkMurg, windowBulkheadRkMurg, G_ACCEL } from "@/lib/bulkheads";
import {
  SB, SectionHeader, EditInput, ComputedInput, SelectField, CheckField, InlineLabel,
  PLAST_OPTIONS, PLA_OPTIONS, POLE_OPTIONS,
} from "@/components/cad/BranchPropsPrimitives";
// Вкладки панели вынесены в отдельные файлы (перенос 1:1, без правок логики)
import BranchTopologyTab from "@/components/cad/branchProps/BranchTopologyTab";
import BranchFanTab from "@/components/cad/branchProps/BranchFanTab";
import BranchFireLoadTab from "@/components/cad/branchProps/BranchFireLoadTab";
import BranchAirDemandTab from "@/components/cad/branchProps/BranchAirDemandTab";
import BranchVentPipeTab from "@/components/cad/branchProps/BranchVentPipeTab";

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
  /** Размер подписи вентилятора (показатели у значка) */
  fanIndFontSize?: number;
  onFanIndFontSize?: (size: number) => void;
  /** Вернуть подпись вентилятора на место */
  onFanIndResetOffset?: () => void;
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
  /** Участки рудника (группы выработок для расчёта количества воздуха) */
  ventSections?: VentSection[];
  /** Открыть справочник участков рудника */
  onOpenSectionsLibrary?: () => void;
  /** Нормы расхода воздуха (ФНиП № 505) */
  ventNorms?: VentNorms;
  /** Открыть справочник оборудования на вкладке типов выработок */
  onOpenTypesLibrary?: () => void;
  /** typeId символа перемычки на схеме (для определения типа: с окном/проёмом или глухая) */
  bulkheadSymTypeId?: string;
  /** Символ перемычки на схеме (для чтения bkManualR, bkResMode и т.д.) */
  bulkheadSymbol?: SchemaSymbol;
  /** Синхронизировать изменения режима/R перемычки из вкладки ветви в символ на схеме */
  onUpdateBulkheadSym?: (patch: Record<string, unknown>) => void;
  /** Конфигурация единиц измерения */
  unitsConfig?: UnitsConfig;
  /** Суммарное сопротивление перемычек/окон на ветви, кМюрг (для «Общего сопротивления») */
  bulkheadRKmu?: number;
  /** Все узлы — для отображения коротких имён начального/конечного */
  nodes?: TopoNode[];
  /** Результат гидравлического расчёта водопровода для этой ветви */
  waterBranchResult?: WaterBranchResult;
  /** Удалить УО редукционного клапана и сбросить флаг на ветви */
  onRemoveReducer?: () => void;
  /** Текущий масштаб символа УО редукционного клапана на схеме */
  reducerSymbolScale?: number;
  /** Изменить масштаб символа УО редукционного клапана */
  onReducerSymbolScale?: (scale: number) => void;
  onRemoveGate?: () => void;
}


const INNER_TABS = [
  "Топология", "Вентилятор", "Трубы: вода", "Конвейер", "Пож.нагрузка", "Перемычка",
  "Расход воздуха", "Вентстав",
] as const;
type InnerTab = typeof INNER_TABS[number];

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

export default function BranchPropsPanel({ branch, horizons, onUpdate, defaultInnerTab, activeTab, onRemoveFan, fanSymbolScale, onFanSymbolScale, fanIndFontSize, onFanIndFontSize, onFanIndResetOffset, onFanSymbolDelete, onReverse, normalFlows, mineFans, mineBulkheads, onOpenFanLibrary, mineTypes, onOpenTypesLibrary, ventSections = [], onOpenSectionsLibrary, ventNorms = DEFAULT_VENT_NORMS, bulkheadSymTypeId, bulkheadSymbol, onUpdateBulkheadSym, unitsConfig = DEFAULT_UNITS_CONFIG, bulkheadRKmu = 0, nodes = [], waterBranchResult, onRemoveReducer, reducerSymbolScale, onReducerSymbolScale, onRemoveGate }: BranchPropsPanelProps) {
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
    fireload: "Пож.нагрузка",
    bulkhead: "Перемычка",
    airdemand: "Расход воздуха",
    ventpipe: "Вентстав",
  };
  const innerTab: InnerTab = (activeTab && tabMap[activeTab]) ? tabMap[activeTab] : (defaultInnerTab ?? "Топология");

  const [name, setName] = useState(branch.id);
  const [plast, setPlast] = useState(PLAST_OPTIONS[0]);
  const [pla, setPla] = useState(PLA_OPTIONS[0]);
  const [pole, setPole] = useState(POLE_OPTIONS[0]);

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set([
      "v_name", "v_length", "v_angle", "v_area", "v_resistance", "v_total_r", "v_geom_r", "v_unit_r", "v_unit_r_100",
      "v_velocity", "v_adddep", "v_flow", "v_dep", "v_dep_total",
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
  // branch.resistance хранится в кМюрг (= Па·с²/м⁶). BaseUnit = Мюрг = кМюрг/1000.
  // Перевод: кМюрг → Мюрг (* 1000) → fromBase → выбранная единица
  const rToDisplay = (rKmurg: number) => uRes.fromBase(rKmurg * 1000);


  return (
    <div className="flex flex-col h-full" style={{ fontSize: 11 }}>

      <div className="flex-1 overflow-y-auto">

        {innerTab === "Топология" && (
          <BranchTopologyTab
            branch={branch}
            onUpdate={onUpdate}
            shortNode={shortNode}
            visible={visible}
            toggle={toggle}
            angle={angle}
            unitR={unitR}
            uRes={uRes}
            rToDisplay={rToDisplay}
            numFmt={numFmt}
            fmtR={fmtR}
            bulkheadRKmu={bulkheadRKmu}
            ventSections={ventSections}
            onOpenSectionsLibrary={onOpenSectionsLibrary}
          />
        )}

        {innerTab === "Вентилятор" && (
          <BranchFanTab
            branch={branch}
            onUpdate={onUpdate}
            numFmt={numFmt}
            onRemoveFan={onRemoveFan}
            fanSymbolScale={fanSymbolScale}
            onFanSymbolScale={onFanSymbolScale}
            fanIndFontSize={fanIndFontSize}
            onFanIndFontSize={onFanIndFontSize}
            onFanIndResetOffset={onFanIndResetOffset}
            onFanSymbolDelete={onFanSymbolDelete}
            onReverse={onReverse}
            normalFlows={normalFlows}
            mineFans={mineFans}
            onOpenFanLibrary={onOpenFanLibrary}
          />
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

        {innerTab === "Пож.нагрузка" && (
          <BranchFireLoadTab branch={branch} onUpdate={onUpdate} />
        )}

        {/* ═══ КАРТОЧКА ЗАБОЯ: расчёт количества воздуха ═══════════════════
            ФНиП № 505 п.155 — позабойный расчёт. Потребность считается по
            каждому фактору отдельно, в зачёт идёт максимум. */}
        {innerTab === "Расход воздуха" && (
          <BranchAirDemandTab
            branch={branch}
            onUpdate={onUpdate}
            ventSections={ventSections}
            ventNorms={ventNorms}
          />
        )}

        {innerTab === "Вентстав" && (
          <BranchVentPipeTab
            branch={branch}
            onUpdate={onUpdate}
            ventSections={ventSections}
            ventNorms={ventNorms}
          />
        )}
      </div>
    </div>
  );
}