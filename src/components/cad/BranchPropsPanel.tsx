import { useState } from "react";
import { type TopoBranch, type TopoNode, type Horizon } from "@/lib/topology";
import { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import { type SchemaSymbol } from "@/pages/cad/cadTypes";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { type VentSection, type VentNorms, DEFAULT_VENT_NORMS } from "@/lib/ventSections";
import { type WaterBranchResult } from "@/lib/waterHydraulics";
// Вкладки панели вынесены в отдельные файлы (перенос 1:1, без правок логики)
import BranchTopologyTab from "@/components/cad/branchProps/BranchTopologyTab";
import BranchFanTab from "@/components/cad/branchProps/BranchFanTab";
import BranchFireLoadTab from "@/components/cad/branchProps/BranchFireLoadTab";
import BranchAirDemandTab from "@/components/cad/branchProps/BranchAirDemandTab";
import BranchVentPipeTab from "@/components/cad/branchProps/BranchVentPipeTab";
import BranchBulkheadTab from "@/components/cad/branchProps/BranchBulkheadTab";
import BranchWaterPipeTab from "@/components/cad/branchProps/BranchWaterPipeTab";
import BranchConveyorTab from "@/components/cad/branchProps/BranchConveyorTab";

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

export default function BranchPropsPanel({ branch, onUpdate, defaultInnerTab, activeTab, onRemoveFan, fanSymbolScale, onFanSymbolScale, fanIndFontSize, onFanIndFontSize, onFanIndResetOffset, onFanSymbolDelete, onReverse, normalFlows, mineFans, mineBulkheads, onOpenFanLibrary, ventSections = [], onOpenSectionsLibrary, ventNorms = DEFAULT_VENT_NORMS, bulkheadSymTypeId, bulkheadSymbol, onUpdateBulkheadSym, unitsConfig = DEFAULT_UNITS_CONFIG, bulkheadRKmu = 0, nodes = [], waterBranchResult, onRemoveReducer, reducerSymbolScale, onReducerSymbolScale, onRemoveGate }: BranchPropsPanelProps) {
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

        {innerTab === "Перемычка" && (
          <BranchBulkheadTab
            branch={branch}
            onUpdate={onUpdate}
            mineBulkheads={mineBulkheads}
            bulkheadSymTypeId={bulkheadSymTypeId}
            bulkheadSymbol={bulkheadSymbol}
            onUpdateBulkheadSym={onUpdateBulkheadSym}
            unitsConfig={unitsConfig}
          />
        )}

        {innerTab === "Трубы: вода" && (
          <BranchWaterPipeTab
            branch={branch}
            onUpdate={onUpdate}
            numFmt={numFmt}
            waterBranchResult={waterBranchResult}
            onRemoveGate={onRemoveGate}
            onRemoveReducer={onRemoveReducer}
            reducerSymbolScale={reducerSymbolScale}
            onReducerSymbolScale={onReducerSymbolScale}
          />
        )}

        {innerTab === "Конвейер" && (
          <BranchConveyorTab />
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
