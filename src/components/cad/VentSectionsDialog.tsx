// ─────────────────────────────────────────────────────────────────────────────
// VentSectionsDialog — справочник участков рудника.
// Участок = именованная группа выработок, по которой ведётся позабойное
// суммирование расхода воздуха (ФНиП № 505, п. 155).
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
  /** Выделенные на схеме ветви — чтобы добавить их в участок одной кнопкой */
  selectedBranchIds?: string[];
  onClose: () => void;
}

export default function VentSectionsDialog({
  sections, onChange, branches, selectedBranchIds = [], onClose,
}: Props) {
  const [selId, setSelId] = useState<string>(sections[0]?.id ?? "");
  const sel = sections.find(s => s.id === selId) ?? null;

  const update = (patch: Partial<VentSection>) => {
    if (!sel) return;
    onChange(sections.map(s => (s.id === sel.id ? { ...s, ...patch } : s)));
  };

  const addSection = () => {
    const n = sections.length + 1;
    const s = makeVentSection({
      number: String(n),
      name: `Участок ${n}`,
      color: SECTION_COLORS[(n - 1) % SECTION_COLORS.length].color,
    });
    onChange([...sections, s]);
    setSelId(s.id);
  };

  const removeSection = () => {
    if (!sel) return;
    onChange(sections.filter(s => s.id !== sel.id));
    setSelId("");
  };

  // Добавить выделенные на схеме ветви. Ветвь может принадлежать только
  // одному участку — при добавлении убираем её из остальных.
  const addSelected = () => {
    if (!sel || selectedBranchIds.length === 0) return;
    const add = new Set(selectedBranchIds);
    onChange(sections.map(s => {
      if (s.id === sel.id) {
        const merged = Array.from(new Set([...s.branchIds, ...selectedBranchIds]));
        return { ...s, branchIds: merged };
      }
      return { ...s, branchIds: s.branchIds.filter(id => !add.has(id)) };
    }));
  };

  const removeBranch = (bid: string) => {
    if (!sel) return;
    update({ branchIds: sel.branchIds.filter(id => id !== bid) });
  };

  const branchLabel = (bid: string): string => {
    const b = branches.find(x => x.id === bid);
    if (!b) return `${bid} (нет в схеме)`;
    return `${b.id}${b.type ? ` — ${b.type}` : ""}`;
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 130 }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );

  const inputStyle = {
    background: "white", border: "1px solid #c8c8c8", height: 20,
    outline: "none", fontFamily: "inherit",
  } as const;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 860, maxHeight: "84vh", border: "1px solid #b0b8cc" }}>

        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">Участки рудника</span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Список участков */}
          <div className="flex flex-col" style={{ width: 260, borderRight: "1px solid #e0e4ee" }}>
            <div className="flex items-center gap-1 px-2 py-1.5" style={{ borderBottom: "1px solid #e0e4ee" }}>
              <button onClick={addSection}
                className="text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 flex items-center gap-1">
                <Icon name="Plus" size={11} /> Добавить
              </button>
              <button onClick={removeSection} disabled={!sel}
                className="text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">
                Удалить
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {sections.length === 0 ? (
                <div className="text-[11px] text-gray-400 text-center py-6 px-3 leading-snug">
                  Участков нет. Добавьте участок и привяжите к нему выработки —
                  расход воздуха будет считаться по каждому участку отдельно.
                </div>
              ) : sections.map(s => (
                <div key={s.id}
                  onClick={() => setSelId(s.id)}
                  className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                  style={{
                    borderBottom: "1px solid #f0f2f7",
                    background: s.id === selId ? "#eaf1fc" : "transparent",
                  }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 2,
                    background: s.color, flexShrink: 0,
                  }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] truncate">
                      {s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      выработок: {s.branchIds.length}
                      {s.isReserve && " · резервный"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Свойства участка */}
          <div className="flex-1 min-w-0 overflow-auto px-4 py-3">
            {!sel ? (
              <div className="text-[12px] text-gray-500 text-center py-10">
                Выберите участок в списке слева
              </div>
            ) : (
              <>
                <Field label="Номер">
                  <input value={sel.number} onChange={e => update({ number: e.target.value })}
                    className="w-full text-[11px] px-1" style={inputStyle} />
                </Field>
                <Field label="Наименование">
                  <input value={sel.name} onChange={e => update({ name: e.target.value })}
                    className="w-full text-[11px] px-1" style={inputStyle} />
                </Field>
                <Field label="Тип участка">
                  <select value={sel.type}
                    onChange={e => update({ type: e.target.value as VentSection["type"] })}
                    className="w-full text-[11px] px-1" style={inputStyle}>
                    {SECTION_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Цвет">
                  <select value={sel.color} onChange={e => update({ color: e.target.value })}
                    className="w-full text-[11px] px-1" style={inputStyle}>
                    {SECTION_COLORS.map(c => (
                      <option key={c.color} value={c.color}>{c.label}</option>
                    ))}
                  </select>
                </Field>

                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">
                  Коэффициенты участка
                </div>
                <Field label="Коэф. запаса">
                  <input type="number" step="0.01" value={sel.reserveFactor || ""}
                    placeholder="из норм"
                    onChange={e => update({ reserveFactor: parseFloat(e.target.value) || 0 })}
                    className="w-full text-[11px] px-1 text-right" style={inputStyle} />
                </Field>
                <Field label="Коэф. утечек">
                  <input type="number" step="0.01" value={sel.leakFactor || ""}
                    placeholder="из норм"
                    onChange={e => update({ leakFactor: parseFloat(e.target.value) || 0 })}
                    className="w-full text-[11px] px-1 text-right" style={inputStyle} />
                </Field>
                <div className="text-[10px] text-gray-400 leading-snug pb-1" style={{ paddingLeft: 138 }}>
                  Пусто — берётся общее значение из справочника норм.
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none py-1">
                  <input type="checkbox" checked={sel.isReserve}
                    onChange={e => update({ isReserve: e.target.checked })} />
                  Резервный участок (в норматив идёт доля потребности)
                </label>

                <Field label="Примечание">
                  <input value={sel.comment} onChange={e => update({ comment: e.target.value })}
                    className="w-full text-[11px] px-1" style={inputStyle} />
                </Field>

                {/* Привязанные выработки */}
                <div className="flex items-center justify-between mt-3 mb-1">
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    Выработки участка ({sel.branchIds.length})
                  </span>
                  <button onClick={addSelected} disabled={selectedBranchIds.length === 0}
                    title="Добавить выделенные на схеме выработки в этот участок"
                    className="text-[11px] px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-40">
                    Добавить выделенные ({selectedBranchIds.length})
                  </button>
                </div>
                <div style={{ border: "1px solid #e0e4ee", borderRadius: 3, maxHeight: 180, overflow: "auto" }}>
                  {sel.branchIds.length === 0 ? (
                    <div className="text-[10px] text-gray-400 text-center py-4 px-3 leading-snug">
                      Выработок нет. Выделите их на схеме и нажмите «Добавить выделенные»,
                      либо выберите участок в свойствах выработки.
                    </div>
                  ) : sel.branchIds.map(bid => (
                    <div key={bid} className="flex items-center gap-2 px-2 py-1 text-[11px]"
                      style={{ borderBottom: "1px solid #f2f4f8" }}>
                      <span className="flex-1 min-w-0 truncate">{branchLabel(bid)}</span>
                      <button onClick={() => removeBranch(bid)}
                        className="text-gray-400 hover:text-red-600 flex-shrink-0" title="Убрать из участка">
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: "#f2f5fb", borderTop: "1px solid #d8e0ee" }}>
          <span className="text-[10px] text-gray-400">
            Расход воздуха считается позабойно и суммируется по участкам (ФНиП № 505, п. 155)
          </span>
          <button onClick={onClose}
            className="text-[12px] px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
