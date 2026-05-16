// Панель информации — управление отображением параметров на схеме
// (аналог «Панели информации» в ПО Вентиляция / Аэросеть)
import { useState } from "react";
import Icon from "@/components/ui/icon";
import { type InfoDisplayConfig, DEFAULT_INFO_CONFIG } from "@/lib/infoConfig";
import { type TopoNode } from "@/lib/topology";

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
}

export default function InfoPanel({
  config, onChange,
  nodes = [], selectedNodeId,
  onNodeVisibilityChange, onAllNodesVisibility, onSelectNode,
}: InfoPanelProps) {
  const [nodesOpen, setNodesOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [nodeVisOpen, setNodeVisOpen] = useState(false);
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
            <CheckRow label="Естественная тяга (С) (Нс), даПа" checked={config.branchNatDragC} onChange={set("branchNatDragC")} />
            <CheckRow label="Естественная тяга (T) (НТ), даПа" checked={config.branchNatDragT} onChange={set("branchNatDragT")} />
            <CheckRow label="Естественная тяга (W) (НW), даПа" checked={config.branchNatDragW} onChange={set("branchNatDragW")} />
            <CheckRow label="Газовыделение (J), м³/с" checked={config.branchGasEmission} onChange={set("branchGasEmission")} />
            <CheckRow label="Время распростр. газов (t), мин:сек" checked={config.branchGasSpreadTime} onChange={set("branchGasSpreadTime")} />
            <CheckRow label="Расход метана (CH4), м³/с" checked={config.branchMethane} onChange={set("branchMethane")} />
            <CheckRow label="Коэф. альфа (α), Нс²/м⁴×1000" checked={config.branchAlpha} onChange={set("branchAlpha")} />
            <CheckRow label="Коэф. местных сопротивлений (Kr)" checked={config.branchLocalXi} onChange={set("branchLocalXi")} />
            <CheckRow label="Выделение CO (CO), м³/с" checked={config.branchCOEmission} onChange={set("branchCOEmission")} />
            <CheckRow label="CO в начале (CO нач.), ppm" checked={config.branchCOStart} onChange={set("branchCOStart")} />
            <CheckRow label="CO в конце (CO кон.), ppm" checked={config.branchCOEnd} onChange={set("branchCOEnd")} />
            <CheckRow label="Q CO в начале (Q CO нач.), м³/с" checked={config.branchQCOStart} onChange={set("branchQCOStart")} />
            <CheckRow label="Q CO в конце (Q CO кон.), м³/с" checked={config.branchQCOEnd} onChange={set("branchQCOEnd")} />
          </div>
        )}

        {/* ─── Видимость узлов (как в Аэросети) ─── */}
        {nodes.length > 0 && onNodeVisibilityChange && (
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
                        {node.id}
                      </span>
                      <span className="text-[10px] text-gray-500 truncate">
                        {node.name || `(${node.x}, ${node.y})`}
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