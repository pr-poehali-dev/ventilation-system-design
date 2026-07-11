// Панель информации — управление отображением параметров на схеме
// (аналог «Панели информации» в ПО Вентиляция / Аэросеть)
import { useState } from "react";
import Icon from "@/components/ui/icon";
import { type InfoDisplayConfig, DEFAULT_INFO_CONFIG } from "@/lib/infoConfig";
import { type TopoNode } from "@/lib/topology";
import { type Position } from "@/lib/positions";

interface CheckRowProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function CheckRow({ label, checked, onChange }: CheckRowProps) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 select-none"
      style={{ paddingLeft: 20, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3 h-3 flex-shrink-0"
        style={{ accentColor: "#2563eb" }}
      />
      <span className="text-[11px] text-gray-800 leading-tight">{label}</span>
    </label>
  );
}

interface SectionHeaderProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}

function SectionHeader({ label, expanded, onToggle }: SectionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-1 py-0.5 text-left select-none hover:bg-gray-100"
      style={{ background: "#e8eef8", borderBottom: "1px solid #c8d4e8", borderTop: "1px solid #c8d4e8" }}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={10} />
      <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>{label}</span>
    </button>
  );
}

const PRESETS: { label: string; config: Partial<InfoDisplayConfig> }[] = [
  { label: "<пользовательские настройки>", config: {} },
  { label: "Минимум (ID + Q)", config: { branchNumber: true, branchFlow: true } },
  {
    label: "Стандарт (Q + V + ΔP)",
    config: { branchName: true, branchFlow: true, branchVelocity: true, branchDepression: true },
  },
  {
    label: "Полный отчёт",
    config: {
      branchNumber: true, branchName: true, branchLength: true, branchSection: true,
      branchResistance: true, branchFlow: true, branchVelocity: true, branchDepression: true,
      nodeNumber: true, nodeZ: true, nodePressure: true,
    },
  },
];

interface InfoPanelProps {
  config: InfoDisplayConfig;
  onChange: (patch: Partial<InfoDisplayConfig>) => void;
  nodes?: TopoNode[];
  selectedNodeId?: string | null;
  onNodeVisibilityChange?: (id: string, visible: boolean) => void;
  onAllNodesVisibility?: (visible: boolean) => void;
  onSelectNode?: (id: string) => void;
  positions?: Position[];
  onPositionVisibilityChange?: (id: string, visible: boolean) => void;
  onPositionBranchesVisibilityChange?: (id: string, branchesVisible: boolean) => void;
  onAllPositionsVisibility?: (visible: boolean, branchesVisible: boolean) => void;
}

export default function InfoPanel({
  config, onChange,
  nodes = [], selectedNodeId,
  onNodeVisibilityChange, onAllNodesVisibility, onSelectNode,
  positions = [],
  onPositionVisibilityChange,
  onPositionBranchesVisibilityChange,
  onAllPositionsVisibility,
}: InfoPanelProps) {
  const [nodesOpen, setNodesOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [waterOpen, setWaterOpen] = useState(false);
  const [nodeVisOpen, setNodeVisOpen] = useState(false);
  const [posVisOpen, setPosVisOpen] = useState(false);
  const [preset, setPreset] = useState(0);

  const applyPreset = (idx: number) => {
    if (idx === 0) return;
    const base = Object.fromEntries(
      Object.keys(DEFAULT_INFO_CONFIG).map((k) => [k, false])
    ) as Partial<InfoDisplayConfig>;
    Object.assign(base, PRESETS[idx].config);
    onChange(base);
    setPreset(idx);
  };

  const set = (k: keyof InfoDisplayConfig) => (v: boolean) => {
    onChange({ [k]: v });
    setPreset(0);
  };

  return (
    <div className="flex flex-col h-full text-xs" style={{ background: "#f5f5f5" }}>
      {/* Пресет */}
      <div className="flex items-center gap-1 px-1 py-1 border-b border-gray-300">
        <select
          value={preset}
          onChange={(e) => applyPreset(Number(e.target.value))}
          className="flex-1 text-[11px] border border-gray-300 rounded px-1 py-0.5"
          style={{ background: "white", fontSize: 11 }}>
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>{p.label}</option>
          ))}
        </select>
        <button
          className="text-[11px] px-2 py-0.5 rounded border border-gray-400 hover:bg-gray-200"
          onClick={() => applyPreset(preset)}
          style={{ whiteSpace: "nowrap" }}>
          Применить
        </button>
      </div>

      {/* Список параметров */}
      <div className="flex-1 overflow-y-auto">

        {/* ─── Узлы (параметры отображения) ─── */}
        <SectionHeader label="Узлы" expanded={nodesOpen} onToggle={() => setNodesOpen((v) => !v)} />
        {nodesOpen && (
          <div>
            <CheckRow label="Номер сопряжения" checked={config.nodeNumber} onChange={set("nodeNumber")} />
            <CheckRow label="Координата X (X), м" checked={config.nodeX} onChange={set("nodeX")} />
            <CheckRow label="Координата Y (Y), м" checked={config.nodeY} onChange={set("nodeY")} />
            <CheckRow label="Координата Z (Z), м" checked={config.nodeZ} onChange={set("nodeZ")} />
            <CheckRow label="Давление вент. (P вент.), даПа" checked={config.nodePressure} onChange={set("nodePressure")} />
            <CheckRow label="Температура (T), °С" checked={config.nodeTemp} onChange={set("nodeTemp")} />
            <CheckRow label="Концентрация метана (CH4), %" checked={config.nodeMethane} onChange={set("nodeMethane")} />
            <CheckRow label="Влажность (W), %" checked={config.nodeHumidity} onChange={set("nodeHumidity")} />
            <CheckRow label="CO в узле (CO), ppm" checked={config.nodeCO} onChange={set("nodeCO")} />
          </div>
        )}

        {/* ─── Ветви ─── */}
        <SectionHeader label="Ветви" expanded={branchesOpen} onToggle={() => setBranchesOpen((v) => !v)} />
        {branchesOpen && (
          <div>
            <CheckRow label="Номер ветви" checked={config.branchNumber} onChange={set("branchNumber")} />
            <CheckRow label="Название ветви (Название)" checked={config.branchName} onChange={set("branchName")} />
            <CheckRow label="Длина ветви (L), м" checked={config.branchLength} onChange={set("branchLength")} />
            <CheckRow label="Угол наклона (A), °" checked={config.branchAngle} onChange={set("branchAngle")} />
            <CheckRow label="Поперечное сечение (S), м²" checked={config.branchSection} onChange={set("branchSection")} />
            <CheckRow label="Аэродинам. сопротивление (R), km" checked={config.branchResistance} onChange={set("branchResistance")} />
            <CheckRow label="Суммарное сопротивление (Rсум), km" checked={config.branchResistanceSum} onChange={set("branchResistanceSum")} />
            <CheckRow label="Скорость воздуха (V), м/с" checked={config.branchVelocity} onChange={set("branchVelocity")} />
            <CheckRow label="Дополнительная депрессия (ДопН), даПа" checked={config.branchExtraFan} onChange={set("branchExtraFan")} />
            <CheckRow label="Расход расчётный (Qрасч), м³/с" checked={config.branchFlowCalc} onChange={set("branchFlowCalc")} />
            <CheckRow label="Расход (Q), м³/с" checked={config.branchFlow} onChange={set("branchFlow")} />
            <CheckRow label="Высота ветви (Высота), м" checked={config.branchHeight} onChange={set("branchHeight")} />
            <CheckRow label="Количество людей (Людей)" checked={config.branchPeople} onChange={set("branchPeople")} />
            <CheckRow label="Депрессия (Н), даПа" checked={config.branchDepression} onChange={set("branchDepression")} />
          </div>
        )}

        {/* ─── Водопровод ─── */}
        <SectionHeader label="Водопровод" expanded={waterOpen} onToggle={() => setWaterOpen((v) => !v)} />
        {waterOpen && (
          <div>
            <CheckRow label="Резервуар с водой" checked={config.waterReservoir} onChange={set("waterReservoir")} />
            <CheckRow label="Потребитель воды" checked={config.waterConsumer} onChange={set("waterConsumer")} />
            <CheckRow label="Насосная станция" checked={config.waterPumpStation} onChange={set("waterPumpStation")} />
            <CheckRow label="Соединение труб" checked={config.waterPipeJoint} onChange={set("waterPipeJoint")} />
            <CheckRow label="Редукционный клапан" checked={config.waterReducer} onChange={set("waterReducer")} />
            <CheckRow label="Входное/выходное давление на редукторе" checked={config.waterReducerPressure} onChange={set("waterReducerPressure")} />
            <CheckRow label="Трубы" checked={config.waterPipes} onChange={set("waterPipes")} />
            <CheckRow label="Направление течения воды" checked={config.waterFlowDirection} onChange={set("waterFlowDirection")} />
            <CheckRow label="Скорость воды (V), м/с" checked={config.waterVelocity} onChange={set("waterVelocity")} />
            <CheckRow label="Расход воды (Q), м³/ч" checked={config.waterFlow} onChange={set("waterFlow")} />
            <CheckRow label="Дефицит воды, м³/ч" checked={config.waterDeficit} onChange={set("waterDeficit")} />
            <CheckRow label="Динамическое давление, МПа" checked={config.waterDynamicPressure} onChange={set("waterDynamicPressure")} />
          </div>
        )}

        {/* ─── Позиции ПЛА ─── */}
        {onPositionVisibilityChange && (
          <>
            <div className="w-full flex items-center gap-1 px-1 py-0.5 select-none"
              style={{ background: "#e8eef8", borderBottom: "1px solid #c8d4e8", borderTop: "1px solid #c8d4e8" }}>
              <button onClick={() => setPosVisOpen((v) => !v)}
                className="flex items-center gap-1 flex-1 text-left">
                <Icon name={posVisOpen ? "ChevronDown" : "ChevronRight"} size={10} />
                <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>
                  Позиции ПЛА
                </span>
              </button>
              {onAllPositionsVisibility && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => onAllPositionsVisibility(true, true)}
                    className="text-[10px] px-1 rounded hover:bg-green-100 text-green-700 border border-green-300">
                    вкл
                  </button>
                  <button onClick={() => onAllPositionsVisibility(false, false)}
                    className="text-[10px] px-1 rounded hover:bg-red-50 text-red-600 border border-red-200">
                    выкл
                  </button>
                </div>
              )}
            </div>
            {posVisOpen && (
              <div>
                {positions.map((pos) => {
                  const posVis = pos.visible !== false;
                  const brVis = pos.branchesVisible !== false;
                  const hasBranches = pos.branchIds.length > 0;
                  return (
                    <div key={pos.id}
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        background: posVis ? "transparent" : "#fafafa",
                        paddingTop: 2, paddingBottom: 2,
                      }}>
                      {/* Строка позиции */}
                      <div className="flex items-center gap-1.5 hover:bg-blue-50 select-none"
                        style={{ paddingLeft: 8, paddingRight: 4 }}>
                        <input
                          type="checkbox"
                          checked={posVis}
                          onChange={(e) => onPositionVisibilityChange!(pos.id, e.target.checked)}
                          className="w-3 h-3 flex-shrink-0"
                          style={{ accentColor: pos.color }}
                        />
                        {/* Цветовой кружок */}
                        <div className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
                          style={{
                            width: 16, height: 16,
                            background: posVis ? pos.color : "#ccc",
                            border: `1.5px solid ${posVis ? pos.borderColor : "#bbb"}`,
                            color: "#fff", fontSize: 8,
                            opacity: posVis ? 1 : 0.5,
                          }}>
                          {pos.number}
                        </div>
                        <span className="text-[11px] flex-1 truncate"
                          style={{ color: posVis ? "#1a3a6b" : "#aaa", fontWeight: 500 }}
                          title={pos.name || `Позиция ${pos.number}`}>
                          {pos.name || `Позиция ${pos.number}`}
                        </span>
                        {pos.accidentType && pos.accidentType !== "Нет" && (
                          <span className="text-[9px] flex-shrink-0 px-1 rounded"
                            style={{ background: "#f3f4f6", color: "#6b7280" }}>
                            {pos.accidentType}
                          </span>
                        )}
                      </div>
                      {/* Строка ветвей (если есть привязанные) */}
                      {hasBranches && onPositionBranchesVisibilityChange && (
                        <div className="flex items-center gap-1.5 hover:bg-purple-50 select-none"
                          style={{ paddingLeft: 24, paddingRight: 4, paddingTop: 1 }}>
                          <input
                            type="checkbox"
                            checked={brVis}
                            onChange={(e) => onPositionBranchesVisibilityChange!(pos.id, e.target.checked)}
                            className="w-3 h-3 flex-shrink-0"
                            style={{ accentColor: "#7c3aed" }}
                          />
                          <Icon name="GitBranch" size={10} />
                          <span className="text-[10px]" style={{ color: brVis ? "#374151" : "#aaa" }}>
                            Ветви ({pos.branchIds.length})
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ─── Видимость узлов (как в Аэросети) ─── */}
        {onNodeVisibilityChange && (
          <>
            <div className="w-full flex items-center gap-1 px-1 py-0.5 select-none"
              style={{ background: "#e8eef8", borderBottom: "1px solid #c8d4e8", borderTop: "1px solid #c8d4e8" }}>
              <button onClick={() => setNodeVisOpen((v) => !v)}
                className="flex items-center gap-1 flex-1 text-left">
                <Icon name={nodeVisOpen ? "ChevronDown" : "ChevronRight"} size={10} />
                <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>
                  Видимость узлов
                </span>
              </button>
              {onAllNodesVisibility && (
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => onAllNodesVisibility(true)}
                    className="text-[10px] px-1 rounded hover:bg-green-100 text-green-700 border border-green-300">
                    вкл
                  </button>
                  <button onClick={() => onAllNodesVisibility(false)}
                    className="text-[10px] px-1 rounded hover:bg-red-50 text-red-600 border border-red-200">
                    выкл
                  </button>
                </div>
              )}
            </div>
            {nodeVisOpen && (
              <div>
                {nodes.map((node) => (
                  <div key={node.id}
                    className="flex items-center hover:bg-blue-50 select-none"
                    style={{
                      paddingLeft: 20, paddingRight: 4, paddingTop: 1, paddingBottom: 1,
                      borderBottom: "1px solid #f0f0f0",
                      background: selectedNodeId === node.id ? "#dbeafe" : "transparent",
                    }}>
                    <label className="flex items-center gap-1.5 flex-1 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={node.visible !== false}
                        onChange={(e) => onNodeVisibilityChange(node.id, e.target.checked)}
                        className="w-3 h-3 flex-shrink-0"
                        style={{ accentColor: "#2563eb" }}
                      />
                      <span className="text-[11px] font-mono font-bold flex-shrink-0"
                        style={{ color: "#1a3a6b", minWidth: 24 }}>
                        {node.number}
                      </span>
                      <span className="text-[10px] text-gray-400 truncate font-mono">
                        {node.x}, {node.y}
                      </span>
                    </label>
                    {onSelectNode && (
                      <button
                        onClick={() => onSelectNode(node.id)}
                        className="w-4 h-4 flex items-center justify-center hover:bg-blue-200 rounded flex-shrink-0"
                        title="Выделить на схеме">
                        <Icon name="Crosshair" size={9} className="text-blue-500" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}