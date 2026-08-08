// ─────────────────────────────────────────────────────────────────────────────
// VentSectionsPanel — панель участков рудника в левой панели.
// Участок = именованная группа выработок, по которой ведётся позабойное
// суммирование расхода воздуха (ФНиП № 505, п. 155).
// Открывается через выпадающий список левой панели: «Участки».
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import {
  makeVentSection, SECTION_TYPE_OPTIONS, SECTION_COLORS,
  type VentSection,
} from "@/lib/ventSections";

interface Props {
  sections: VentSection[];
  onChange: (sections: VentSection[]) => void;
  branches: TopoBranch[];
  /** Выделенные на схеме ветви — для кнопки «Добавить выделенные» */
  selectedBranchIds: string[];
  /** Выделить выработки участка на схеме */
  onSelectBranches?: (ids: string[]) => void;
  /** Открыть справочник норм расхода воздуха */
  onOpenNorms?: () => void;
  /** Открыть сводный расчёт количества воздуха */
  onOpenSummary?: () => void;
  /** Включена ли заливка схемы по участкам */
  colorFill?: boolean;
  /** Переключить заливку схемы по участкам */
  onToggleColorFill?: () => void;
}

export default function VentSectionsPanel({
  sections, onChange, branches, selectedBranchIds,
  onSelectBranches, onOpenNorms, onOpenSummary, colorFill, onToggleColorFill,
}: Props) {
  const [expandedId, setExpandedId] = useState<string>("");

  const update = (id: string, patch: Partial<VentSection>) =>
    onChange(sections.map(s => (s.id === id ? { ...s, ...patch } : s)));

  const addSection = () => {
    const n = sections.length + 1;
    const s = makeVentSection({
      number: String(n),
      name: `Участок ${n}`,
      color: SECTION_COLORS[(n - 1) % SECTION_COLORS.length].color,
    });
    onChange([...sections, s]);
    setExpandedId(s.id);
  };

  const removeSection = (id: string) => {
    onChange(sections.filter(s => s.id !== id));
    if (expandedId === id) setExpandedId("");
  };

  // Ветвь принадлежит только одному участку: добавляя в новый,
  // убираем её из остальных, иначе расход задвоится.
  const addSelected = (id: string) => {
    if (selectedBranchIds.length === 0) return;
    const add = new Set(selectedBranchIds);
    onChange(sections.map(s => {
      if (s.id === id) {
        return { ...s, branchIds: Array.from(new Set([...s.branchIds, ...selectedBranchIds])) };
      }
      return { ...s, branchIds: s.branchIds.filter(b => !add.has(b)) };
    }));
  };

  const removeBranch = (sid: string, bid: string) => {
    const s = sections.find(x => x.id === sid);
    if (!s) return;
    update(sid, { branchIds: s.branchIds.filter(b => b !== bid) });
  };

  const branchLabel = (bid: string): string => {
    const b = branches.find(x => x.id === bid);
    if (!b) return `${bid} — нет в схеме`;
    return `${b.id}${b.type ? ` · ${b.type}` : ""}`;
  };

  // Ветви, не отнесённые ни к одному участку
  const assigned = new Set(sections.flatMap(s => s.branchIds));
  const unassigned = branches.filter(b => !b.isVentPipeBranch && !assigned.has(b.id)).length;

  const inputStyle = {
    background: "white", border: "1px solid #c8c8c8", height: 18,
    outline: "none", fontFamily: "inherit",
  } as const;

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-1 py-0.5">
      <span className="text-[10px] text-gray-600 flex-shrink-0" style={{ width: 92 }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col h-full" style={{ fontSize: 11 }}>
      {/* Панель действий */}
      <div className="flex items-center gap-1 px-2 py-1.5 flex-shrink-0"
        style={{ borderBottom: "1px solid #e0e4ee", background: "#f8fafc" }}>
        <button onClick={addSection}
          className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 flex items-center gap-1">
          <Icon name="Plus" size={11} /> Участок
        </button>
        {onOpenNorms && (
          <button onClick={onOpenNorms} title="Справочник норм расхода воздуха"
            className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100">
            Нормы
          </button>
        )}
        {onOpenSummary && (
          <button onClick={onOpenSummary} title="Сводный расчёт количества воздуха по руднику"
            className="text-[11px] px-2 py-1 rounded border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 ml-auto">
            Расчёт
          </button>
        )}
      </div>

      {/* Заливка схемы по участкам */}
      {onToggleColorFill && (
        <div className="flex items-center gap-2 px-2 py-1.5 flex-shrink-0"
          style={{ borderBottom: "1px solid #eef1f6" }}>
          <button onClick={onToggleColorFill}
            className="h-6 px-3 rounded text-[11px] font-semibold"
            style={{
              background: colorFill ? "#dc2626" : "#f3f4f6",
              color: colorFill ? "white" : "#374151",
              border: "1px solid " + (colorFill ? "#b91c1c" : "#d1d5db"),
            }}>
            {colorFill ? "Заливка ВКЛ" : "Заливка ВЫКЛ"}
          </button>
          <span className="text-[10px] text-gray-400">Окрасить схему по участкам</span>
        </div>
      )}

      {/* Сводка */}
      <div className="px-2 py-1 text-[10px] text-gray-500 flex-shrink-0"
        style={{ borderBottom: "1px solid #eef1f6" }}>
        Участков: {sections.length}
        {unassigned > 0 && <span style={{ color: "#c2410c" }}> · без участка: {unassigned} выраб.</span>}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div className="text-[11px] text-gray-400 text-center py-6 px-3 leading-snug">
            Участков нет.
            <div className="pt-1.5">
              Добавьте участок, выделите выработки на схеме и нажмите
              «Добавить выделенные». Расход воздуха считается по каждому
              забою и суммируется по участкам.
            </div>
          </div>
        ) : sections.map(s => {
          const open = expandedId === s.id;
          return (
            <div key={s.id} style={{ borderBottom: "1px solid #eef1f6" }}>
              {/* Строка участка */}
              <div className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedId(open ? "" : s.id)}>
                <Icon name={open ? "ChevronDown" : "ChevronRight"} size={11} className="text-gray-400 flex-shrink-0" />
                <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] truncate">
                    {s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {s.branchIds.length} выраб.{s.isReserve && " · резервный"}
                  </div>
                </div>
                {s.branchIds.length > 0 && onSelectBranches && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelectBranches(s.branchIds); }}
                    title="Выделить выработки участка на схеме"
                    className="text-gray-400 hover:text-blue-600 flex-shrink-0">
                    <Icon name="MousePointerClick" size={12} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeSection(s.id); }}
                  title="Удалить участок"
                  className="text-gray-400 hover:text-red-600 flex-shrink-0">
                  <Icon name="Trash2" size={12} />
                </button>
              </div>

              {/* Свойства участка */}
              {open && (
                <div className="px-2 pb-2" style={{ background: "#fbfcfe" }}>
                  <Field label="Номер">
                    <input value={s.number} onChange={e => update(s.id, { number: e.target.value })}
                      className="w-full text-[11px] px-1" style={inputStyle} />
                  </Field>
                  <Field label="Наименование">
                    <input value={s.name} onChange={e => update(s.id, { name: e.target.value })}
                      className="w-full text-[11px] px-1" style={inputStyle} />
                  </Field>
                  <Field label="Тип">
                    <select value={s.type}
                      onChange={e => update(s.id, { type: e.target.value as VentSection["type"] })}
                      className="w-full text-[11px] px-1" style={inputStyle}>
                      {SECTION_TYPE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Цвет">
                    <select value={s.color} onChange={e => update(s.id, { color: e.target.value })}
                      className="w-full text-[11px] px-1" style={inputStyle}>
                      {SECTION_COLORS.map(c => (
                        <option key={c.color} value={c.color}>{c.label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Коэф. запаса">
                    <input type="number" step="0.01" value={s.reserveFactor || ""} placeholder="из норм"
                      onChange={e => update(s.id, { reserveFactor: parseFloat(e.target.value) || 0 })}
                      className="w-full text-[11px] px-1 text-right" style={inputStyle} />
                  </Field>
                  <Field label="Коэф. утечек">
                    <input type="number" step="0.01" value={s.leakFactor || ""} placeholder="из норм"
                      onChange={e => update(s.id, { leakFactor: parseFloat(e.target.value) || 0 })}
                      className="w-full text-[11px] px-1 text-right" style={inputStyle} />
                  </Field>
                  <label className="flex items-center gap-1.5 text-[10px] text-gray-700 cursor-pointer select-none py-1">
                    <input type="checkbox" checked={s.isReserve}
                      onChange={e => update(s.id, { isReserve: e.target.checked })} />
                    Резервный участок
                  </label>

                  {/* Выработки участка */}
                  <div className="flex items-center justify-between pt-1 pb-0.5">
                    <span className="text-[10px] text-gray-500">
                      Выработки ({s.branchIds.length})
                    </span>
                    <button onClick={() => addSelected(s.id)} disabled={selectedBranchIds.length === 0}
                      title="Добавить выделенные на схеме выработки"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40">
                      + выделенные ({selectedBranchIds.length})
                    </button>
                  </div>
                  <div style={{ border: "1px solid #e6eaf2", borderRadius: 2, background: "white", maxHeight: 130, overflow: "auto" }}>
                    {s.branchIds.length === 0 ? (
                      <div className="text-[10px] text-gray-400 text-center py-2 px-2 leading-snug">
                        Выделите выработки на схеме и нажмите «+ выделенные»
                      </div>
                    ) : s.branchIds.map(bid => (
                      <div key={bid} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px]"
                        style={{ borderBottom: "1px solid #f4f6fa" }}>
                        <span className="flex-1 min-w-0 truncate">{branchLabel(bid)}</span>
                        <button onClick={() => removeBranch(s.id, bid)}
                          className="text-gray-400 hover:text-red-600 flex-shrink-0" title="Убрать из участка">
                          <Icon name="X" size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-2 py-1 text-[9px] text-gray-400 leading-snug flex-shrink-0"
        style={{ borderTop: "1px solid #eef1f6" }}>
        Расход воздуха считается позабойно и суммируется по участкам (ФНиП № 505, п. 155)
      </div>
    </div>
  );
}