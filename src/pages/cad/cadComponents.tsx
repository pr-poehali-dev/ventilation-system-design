import React from "react";
import Icon from "@/components/ui/icon";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { ContextMenuItem } from "@/components/cad/CadContextMenu";
import type { CadTool } from "@/components/cad/TopoCanvas";
import type { ViewPresetName } from "./cadTypes";

// ─── Пункты контекстного меню ───────────────────────────────────────────────

export function nodeContextItems(node: TopoNode | null, multiNodeCount: number): ContextMenuItem[] {
  const canAlign = multiNodeCount >= 2;
  return [
    { id: "open_props", label: "Свойства узла...", icon: "Settings", shortcut: "Ctrl+J" },
    { id: "div1", label: "", divider: true },
    { id: "toggle_atmosphere", label: node?.atmosphereLink ? "Снять связь с атмосферой" : "Поверхностный узел (атмосфера)", icon: "Wind" },
    { id: "split_connections", label: "Разорвать связь в узле", icon: "Scissors" },
    { id: "merge_nodes", label: multiNodeCount >= 2 ? `Соединить узлы (${multiNodeCount})` : "Соединить узлы", icon: "GitMerge", disabled: multiNodeCount < 2 },
    { id: "div2", label: "", divider: true },
    { id: "align_left",     label: "Выровнить по левому краю",    icon: "AlignStartHorizontal", disabled: !canAlign },
    { id: "align_right",    label: "Выровнить по правому краю",   icon: "AlignEndHorizontal",   disabled: !canAlign },
    { id: "align_center_x", label: "Выровнить по центру (гориз.)",icon: "AlignCenterHorizontal", disabled: !canAlign },
    { id: "align_top",      label: "Выровнить по верхнему краю",  icon: "AlignStartVertical",   disabled: !canAlign },
    { id: "align_bottom",   label: "Выровнить по нижнему краю",   icon: "AlignEndVertical",     disabled: !canAlign },
    { id: "align_center_y", label: "Выровнить по центру (верт.)", icon: "AlignCenterVertical",  disabled: !canAlign },
    { id: "div3", label: "", divider: true },
    { id: "delete_node", label: "Удалить", icon: "Trash2", shortcut: "Del", danger: true },
  ];
}

export function branchContextItems(branch: TopoBranch | null, hasBuffer: boolean, multiCount: number): ContextMenuItem[] {
  const multi = multiCount > 1;
  return [
    {
      id: "open_props",
      label: multi ? `Свойства выделенных (${multiCount} ветв.)...` : "Свойства ветви...",
      icon: "Settings", shortcut: "Ctrl+J",
    },
    { id: "div1", label: "", divider: true },
    { id: "copy_branch_params", label: "Копировать параметры ветви", icon: "Copy", shortcut: "Alt+C", disabled: multi },
    { id: "paste_branch_params", label: multi
        ? `Применить к выделенным (${multiCount} ветв.)`
        : "Применить параметры...", icon: "ClipboardPaste", disabled: !hasBuffer },
    { id: "div2", label: "", divider: true },
    {
      id: "toggle_capital",
      label: multi
        ? "Капитальная ветвь (всем выбранным)"
        : (branch?.capital ? "Снять Капитальная" : "Капитальная ветвь"),
      icon: "Star",
    },
    {
      id: "toggle_designed",
      label: multi
        ? "Проектируемая ветвь (всем выбранным)"
        : (branch?.designed ? "Снять Проектируемая" : "Проектируемая ветвь"),
      icon: "Pencil",
    },
    { id: "reverse_branch", label: "Развернуть ветвь", icon: "ArrowLeftRight", shortcut: "Ctrl+R", disabled: multi },
    { id: "div3", label: "", divider: true },
    {
      id: "add_vent_pipe",
      label: multi
        ? `+ Вентрубопровод (${multiCount} ветв.)`
        : (branch?.hasVentPipe ? "✎ Вентрубопровод (изменить)" : "+ Вентрубопровод"),
      icon: "Wind",
    },
    { id: "align_distribute", label: "Выровнять и распределить ▶", icon: "AlignCenter", disabled: true },
    { id: "div4", label: "", divider: true },
    {
      id: "delete_branch",
      label: multi ? `Удалить (${multiCount} ветв.)` : "Удалить",
      icon: "Trash2", shortcut: "Del", danger: true,
    },
  ];
}

export function canvasContextItems(): ContextMenuItem[] {
  return [
    { id: "add_node", label: "Добавить узел", icon: "PlusCircle" },
  ];
}

// ─── Ribbon-компоненты ──────────────────────────────────────────────────────

export function RibbonTabBtn({ label, active, onClick, fileStyle, highlight }: {
  label: string; active: boolean; onClick: () => void; fileStyle?: boolean; highlight?: boolean;
}) {
  if (fileStyle) {
    return (
      <button onClick={onClick}
        className="px-3 h-6 text-xs text-white rounded-t-sm hover:brightness-110"
        style={{ background: "#2563eb", fontWeight: 500 }}>
        {label}
      </button>
    );
  }
  return (
    <button onClick={onClick}
      className="px-3 h-6 text-xs rounded-t-sm transition-colors"
      style={{
        background: active ? "#fafafa" : "transparent",
        borderTop: active ? "1px solid #b8b8b8" : "1px solid transparent",
        borderLeft: active ? "1px solid #b8b8b8" : "1px solid transparent",
        borderRight: active ? "1px solid #b8b8b8" : "1px solid transparent",
        marginBottom: active ? "-1px" : "0",
        color: highlight ? "#2563eb" : "#1f1f1f",
        fontWeight: active || highlight ? 600 : 400,
      }}>
      {label}
    </button>
  );
}

export function RibbonGroup({ children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 h-full pr-2 mr-1"
      style={{ borderRight: "1px solid #c4c4c4" }}>
      {children}
    </div>
  );
}

export function RibbonBigBtn({ icon, iconImg, label, sublabel, disabled, onClick, active, title, style }: {
  icon: string; iconImg?: string; label: string; sublabel: string; disabled?: boolean; onClick?: () => void; active?: boolean; title?: string; style?: React.CSSProperties;
}) {
  return (
    <button disabled={disabled} onClick={onClick} title={title ?? `${label}${sublabel ? " " + sublabel : ""}`}
      className="flex flex-col items-center justify-center gap-0.5 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      style={{
        width: 52, height: 60,
        border: active ? "1.5px solid #3b82f6" : "1px solid transparent",
        background: active ? "#dbeafe" : "transparent",
        color: active ? "#1d4ed8" : "#374151",
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={e => { if (!disabled && !active) (e.currentTarget as HTMLButtonElement).style.background = "#e8f0fe"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#93c5fd"; }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; } }}>
      {iconImg
        ? <img src={iconImg} alt={label} style={{ width: 22, height: 22, objectFit: "contain" }} />
        : <Icon name={icon} size={20} fallback="Square" style={{ color: active ? "#2563eb" : "#4b5563" }} />}
      <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500 }}>
        <div>{label}</div>
        {sublabel && <div style={{ color: active ? "#1d4ed8" : "#6b7280" }}>{sublabel}</div>}
      </div>
    </button>
  );
}

export function RibbonSmallBtn({ children, active, title, onClick }: {
  children: React.ReactNode; active?: boolean; title?: string; onClick?: () => void;
}) {
  return (
    <button title={title} onClick={onClick}
      className="flex items-center justify-center rounded transition-colors"
      style={{
        width: 40, height: 40,
        border: active ? "1.5px solid #3b82f6" : "1px solid transparent",
        background: active ? "#dbeafe" : "transparent",
        flexShrink: 0,
      }}
      onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = "#e8f0fe"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#93c5fd"; } }}
      onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; } }}>
      {children}
    </button>
  );
}

export function PentagonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 1 L15 6 L12 14 L4 14 L1 6 Z" fill="none" stroke="#444" strokeWidth="1.2" />
    </svg>
  );
}

export function RectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="10" fill="none" stroke="#444" strokeWidth="1.2" />
    </svg>
  );
}

export function MiniSquareIcon({ variant }: { variant: number }) {
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect x="2" y="2" width="10" height="10" fill={colors[variant - 1]} opacity="0.6" stroke={colors[variant - 1]} />
    </svg>
  );
}

// ─── Свойства ───────────────────────────────────────────────────────────────

export function PropGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 py-1 text-xs font-semibold text-gray-800"
        style={{ background: "#f5f5f5", borderTop: "1px solid #e0e0e0", borderBottom: "1px solid #e0e0e0" }}>
        {title}
      </div>
      <div className="px-2 py-1 space-y-0.5">{children}</div>
    </div>
  );
}

export function SelectRow({ value, options, onChange }: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

export function SelectRowLabeled({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none min-w-0">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function FieldRow({ label, value, computed }: { label: string; value: string; computed?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <input type="text" value={value} readOnly
        className="flex-1 text-xs px-1 py-0.5 border bg-white text-right font-mono"
        style={{
          borderColor: computed ? "#d0d0d0" : "#a0a0a0",
          background: computed ? "#fafafa" : "white",
          color: computed ? "#1f1f1f" : "#1f1f1f",
          fontWeight: computed ? 600 : 400,
        }} />
    </div>
  );
}

export function CheckRow({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="checkbox" className="w-3 h-3" />
        <span className="text-xs text-gray-700">{caption}</span>
      </label>
    </div>
  );
}

export function FrameGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="relative pt-2 pb-2 px-2"
      style={{ border: "1px solid #b8b8b8", borderRadius: "0" }}>
      <legend className="px-1 text-xs text-gray-700"
        style={{ marginLeft: "4px", fontWeight: 400 }}>
        {title}
      </legend>
      <div className="space-y-1">
        {children}
      </div>
    </fieldset>
  );
}

export function LabeledRow({ label, children, labelWidth = 140 }: {
  label: string; children: React.ReactNode; labelWidth?: number;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-xs text-gray-700 flex-shrink-0 text-right whitespace-normal break-words leading-tight pt-1"
        style={{ width: labelWidth }}>{label}</span>
      {children}
    </div>
  );
}

export function CadCheckbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-[13px] h-[13px] cursor-pointer" />
      <span className="text-xs text-gray-800">{label}</span>
    </label>
  );
}

export function NumWithUnit({ value, unit, onChange }: {
  value: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex-1 flex items-center gap-1">
      <input type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cad-input flex-1 text-right" />
      <span className="text-[11px] text-gray-500 flex-shrink-0 w-5">{unit}</span>
    </div>
  );
}

export function ComputedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5 py-0.5">
      <span className="text-xs text-gray-700 w-[140px] flex-shrink-0 text-right whitespace-normal break-words leading-tight pt-1">{label}</span>
      <div className="flex-1 min-w-0 px-2 py-1 text-right text-xs font-bold break-words"
        style={{ background: "#cfcfcf", color: "#1f1f1f", border: "1px solid #b8b8b8" }}>
        {value}
      </div>
    </div>
  );
}

export function ToolBtn({ icon, label, active, onClick, disabled }: {
  icon: string; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className="h-6 px-2 flex items-center gap-1 rounded text-[11px] disabled:opacity-40"
      style={{
        background: active ? "#2563eb" : "transparent",
        color: active ? "white" : "#1f1f1f",
        border: active ? "1px solid #1d4ed8" : "1px solid transparent",
      }}>
      <Icon name={icon} size={13} fallback="Square" />
      <span>{label}</span>
    </button>
  );
}

export function toolLabel(t: CadTool): string {
  switch (t) {
    case "select": return "Выбор";
    case "node": return "Добавить узел";
    case "branch": return "Соединить ветвью";
    case "pan": return "Панорама";
    case "rotate": return "Вращение 3D";
    case "textblock": return "Текстовый блок";
    default: return "—";
  }
}

export function ViewBtn({ label, preset, current, onClick, hint }: {
  label: string;
  preset: ViewPresetName;
  current: { is3D: boolean; azimuth: number; elevation: number };
  onClick: (p: ViewPresetName) => void;
  hint?: string;
}) {
  const PRESETS: Record<ViewPresetName, { az: number; el: number }> = {
    plan:  { az: 0,    el: 90 },
    front: { az: 0,    el: 0 },
    back:  { az: 180,  el: 0 },
    left:  { az: -90,  el: 0 },
    right: { az: 90,   el: 0 },
    isoSW: { az: -45,  el: 30 },
    isoSE: { az: 45,   el: 30 },
    isoNW: { az: -135, el: 30 },
    isoNE: { az: 135,  el: 30 },
  };
  const target = PRESETS[preset];
  const active = Math.abs(current.azimuth - target.az) < 1 && Math.abs(current.elevation - target.el) < 1;
  return (
    <button onClick={() => onClick(preset)} title={hint ?? label}
      className="h-6 px-2 flex items-center rounded text-[11px]"
      style={{
        background: active ? "#7c3aed" : "transparent",
        color: active ? "white" : "#1f1f1f",
        border: active ? "1px solid #5b21b6" : "1px solid #d0d0d0",
      }}>
      {label}
    </button>
  );
}

export function FlowBtn({ label, active, onClick, hint }: {
  label: string; active: boolean; onClick: () => void; hint?: string;
}) {
  return (
    <button onClick={onClick} title={hint ?? label}
      className="h-6 px-2 text-[11px] border-r last:border-r-0 border-gray-300"
      style={{
        background: active ? "#0369a1" : "white",
        color: active ? "white" : "#1f1f1f",
      }}>
      {label}
    </button>
  );
}
