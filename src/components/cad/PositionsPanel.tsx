import { useState } from "react";
import {
  type Position, makePosition, POSITION_COLORS,
  VENT_MODES, ACCIDENT_TYPES, FONT_OPTIONS,
} from "@/lib/positions";
import { type TopoBranch } from "@/lib/topology";
import Icon from "@/components/ui/icon";

interface Props {
  positions: Position[];
  branches: TopoBranch[];
  selectedPositionId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (pos: Position) => void;
  onUpdate: (id: string, patch: Partial<Position>) => void;
  onDelete: (id: string) => void;
  onPlaceMode: () => void;
  placeModeActive: boolean;
}

export default function PositionsPanel({
  positions,
  branches,
  selectedPositionId,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
  onPlaceMode,
  placeModeActive,
}: Props) {
  const [editingNumberId, setEditingNumberId] = useState<string | null>(null);
  const [editingNumberVal, setEditingNumberVal] = useState("");

  const selected = positions.find((p) => p.id === selectedPositionId) ?? null;

  function addPosition() {
    const maxNum = positions.reduce((m, p) => Math.max(m, p.number), 0);
    const pos = makePosition({ number: maxNum + 1 });
    onAdd(pos);
    onSelect(pos.id);
  }

  function startEditNumber(pos: Position) {
    setEditingNumberId(pos.id);
    setEditingNumberVal(String(pos.number));
  }

  function commitNumber(id: string) {
    const n = parseInt(editingNumberVal);
    if (!isNaN(n) && n > 0) onUpdate(id, { number: n });
    setEditingNumberId(null);
  }

  const upd = (patch: Partial<Position>) => {
    if (selected) onUpdate(selected.id, patch);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ fontSize: 11 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: "1px solid #d0d0d0" }}>
        <button onClick={addPosition} className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={btnStyle}>
          <Icon name="Plus" size={12} />
          Добавить
        </button>
        <button
          onClick={onPlaceMode}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{ ...btnStyle, background: placeModeActive ? "#dbeafe" : "#f5f5f5", color: placeModeActive ? "#1d4ed8" : "#374151" }}>
          <Icon name="MapPin" size={12} />
          На схему
        </button>
        {selected && (
          <button
            onClick={() => { onDelete(selected.id); onSelect(null); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded ml-auto"
            style={{ ...btnStyle, border: "1px solid #fca5a5", background: "#fff5f5", color: "#dc2626" }}>
            <Icon name="Trash2" size={12} />
          </button>
        )}
      </div>

      {/* Список позиций */}
      <div className="overflow-y-auto" style={{ flex: "0 0 auto", maxHeight: 160, borderBottom: "1px solid #d0d0d0" }}>
        {positions.length === 0 && (
          <div className="text-center py-4" style={{ color: "#999", fontSize: 11 }}>
            Нет позиций. Нажмите «Добавить».
          </div>
        )}
        {positions.map((pos) => (
          <div
            key={pos.id}
            onClick={() => onSelect(pos.id === selectedPositionId ? null : pos.id)}
            className="flex items-center gap-2 px-2 py-1 cursor-pointer"
            style={{ background: pos.id === selectedPositionId ? "#e8f0fe" : "transparent", borderBottom: "1px solid #f0f0f0" }}>
            <div
              className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
              style={{ width: 22, height: 22, background: pos.color, border: `2px solid ${pos.borderColor}`, color: "#fff", fontSize: 10 }}>
              {editingNumberId === pos.id ? (
                <input
                  autoFocus
                  value={editingNumberVal}
                  onChange={(e) => setEditingNumberVal(e.target.value)}
                  onBlur={() => commitNumber(pos.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitNumber(pos.id); if (e.key === "Escape") setEditingNumberId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 18, background: "transparent", border: "none", color: "#fff", fontSize: 10, textAlign: "center", outline: "none", padding: 0 }}
                />
              ) : (
                <span onDoubleClick={(e) => { e.stopPropagation(); startEditNumber(pos); }} title="Двойной клик — изменить номер">
                  {pos.number}
                </span>
              )}
            </div>
            <span className="flex-1 truncate" style={{ color: "#222" }}>
              {pos.name || <span style={{ color: "#aaa" }}>Позиция {pos.number}</span>}
            </span>
            {pos.branchIds.length > 0 && (
              <span style={{ color: "#666", fontSize: 10 }}>{pos.branchIds.length} вет.</span>
            )}
          </div>
        ))}
      </div>

      {/* Редактирование выбранной */}
      {selected ? (
        <div className="flex-1 overflow-y-auto">
          <GroupHeader>Свойства позиции</GroupHeader>

          <Row label="Номер:">
            <input type="number" min={1} value={selected.number}
              onChange={(e) => upd({ number: parseInt(e.target.value) || 1 })}
              style={{ ...inputStyle, width: 60 }} />
          </Row>

          <Row label="Название позиции:">
            <div className="flex items-center gap-1">
              <span style={{ fontSize: 11, color: selected.name ? "#333" : "#999", flex: 1 }}>
                {selected.name || "Не задано"}
              </span>
              <button
                style={{ fontSize: 10, color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}
                onClick={() => {
                  const v = window.prompt("Название позиции:", selected.name);
                  if (v !== null) upd({ name: v });
                }}>
                Редактировать
              </button>
            </div>
          </Row>

          <Row label="Сценарий:">
            <input type="text" value={selected.scenario}
              onChange={(e) => upd({ scenario: e.target.value })}
              style={{ ...inputStyle, width: "100%" }} />
          </Row>

          <Row label="Режим проветривания:">
            <select value={selected.ventMode}
              onChange={(e) => upd({ ventMode: e.target.value })}
              style={{ ...inputStyle, width: "100%" }}>
              {VENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              {!VENT_MODES.includes(selected.ventMode) && (
                <option value={selected.ventMode}>{selected.ventMode}</option>
              )}
            </select>
          </Row>

          <Row label="Тип позиции:">
            <div className="flex flex-col gap-0.5">
              <label className="flex items-center gap-1" style={{ cursor: "pointer" }}>
                <input type="radio" checked={selected.positionType === "normal"}
                  onChange={() => upd({ positionType: "normal" })} style={{ margin: 0 }} />
                <span style={{ fontSize: 11 }}>Безреверсивная</span>
              </label>
              <label className="flex items-center gap-1" style={{ cursor: "pointer" }}>
                <input type="radio" checked={selected.positionType === "reverse"}
                  onChange={() => upd({ positionType: "reverse" })} style={{ margin: 0 }} />
                <span style={{ fontSize: 11 }}>Реверсивная</span>
              </label>
            </div>
          </Row>

          <Row label="Вид аварии:">
            <select value={selected.accidentType}
              onChange={(e) => upd({ accidentType: e.target.value as typeof selected.accidentType })}
              style={{ ...inputStyle, width: "100%" }}>
              {ACCIDENT_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Row>

          <Row label="Общешахтная позиция:">
            <input type="checkbox" checked={selected.isMineWide}
              onChange={(e) => upd({ isMineWide: e.target.checked })}
              style={{ margin: 0 }} />
          </Row>

          {/* Фон (цвет маркера) */}
          <Row label="Фон:">
            <div className="flex items-center gap-1 flex-1">
              <div style={{ flex: 1, height: 16, background: selected.color, border: "1px solid #ccc", borderRadius: 2 }} />
              <input type="color" value={selected.color}
                onChange={(e) => upd({ color: e.target.value })}
                style={{ width: 18, height: 18, padding: 0, border: "1px solid #ccc", borderRadius: 3, cursor: "pointer" }} />
            </div>
          </Row>

          <div className="flex items-center gap-1 px-2 py-0.5 ml-1" style={{ marginLeft: 134 }}>
            <input type="checkbox" id="pos-unified" checked={selected.colorUnified}
              onChange={(e) => upd({ colorUnified: e.target.checked })} style={{ margin: 0 }} />
            <label htmlFor="pos-unified" style={{ fontSize: 11, color: "#555", cursor: "pointer" }}>
              Единый для копий
            </label>
          </div>

          {/* Цвет границы */}
          <Row label="Цвет границы:">
            <div className="flex items-center gap-1 flex-1">
              <div style={{ flex: 1, height: 16, background: selected.borderColor, border: "1px solid #ccc", borderRadius: 2 }} />
              <input type="color" value={selected.borderColor}
                onChange={(e) => upd({ borderColor: e.target.value })}
                style={{ width: 18, height: 18, padding: 0, border: "1px solid #ccc", borderRadius: 3, cursor: "pointer" }} />
            </div>
          </Row>

          <Row label="Диаметр:">
            <div className="flex items-center gap-1">
              <input type="number" min={5} max={50} step={0.5} value={selected.diameter}
                onChange={(e) => upd({ diameter: parseFloat(e.target.value) || 13 })}
                style={{ ...inputStyle, width: 50 }} />
              <span style={{ fontSize: 11, color: "#666" }}>мм</span>
            </div>
          </Row>

          <Row label="Шрифт:">
            <select value={selected.font}
              onChange={(e) => upd({ font: e.target.value })}
              style={{ ...inputStyle, width: "100%" }}>
              {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Row>

          <GroupHeader>Прикреплённый файл</GroupHeader>
          <div className="px-2 py-1 flex items-center gap-2">
            {selected.attachedFile ? (
              <>
                <span style={{ fontSize: 11, color: "#333", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selected.attachedFile}
                </span>
                <button onClick={() => upd({ attachedFile: "" })}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#999", padding: 0 }}>
                  <Icon name="X" size={12} />
                </button>
              </>
            ) : (
              <label style={{ fontSize: 11, color: "#2563eb", cursor: "pointer" }}>
                Прикрепить новый файл
                <input type="file" style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upd({ attachedFile: f.name });
                  }} />
              </label>
            )}
          </div>

          <GroupHeader>Общие свойства</GroupHeader>

          <Row label="Толщина выносок:">
            <div className="flex items-center gap-1">
              <input type="number" min={0.1} max={5} step={0.1} value={selected.leaderThickness}
                onChange={(e) => upd({ leaderThickness: parseFloat(e.target.value) || 0.2 })}
                style={{ ...inputStyle, width: 50 }} />
              <span style={{ fontSize: 11, color: "#666" }}>мм</span>
            </div>
          </Row>

          <GroupHeader>Привязанные ветви</GroupHeader>
          <div className="px-2 py-1 flex flex-col gap-0.5">
            {selected.branchIds.length === 0 && (
              <div style={{ color: "#aaa", fontSize: 11 }}>Нет привязанных ветвей</div>
            )}
            {selected.branchIds.map((bid) => {
              const b = branches.find((br) => br.id === bid);
              return (
                <div key={bid} className="flex items-center gap-1">
                  <span className="flex-1 truncate" style={{ fontSize: 11, color: "#333" }}>
                    {b ? `${b.id}. ${b.type || "Ветвь"}` : `Ветвь ${bid}`}
                  </span>
                  <button onClick={() => upd({ branchIds: selected.branchIds.filter((x) => x !== bid) })}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#999", padding: 0 }}>
                    <Icon name="X" size={12} />
                  </button>
                </div>
              );
            })}
            <select style={{ ...inputStyle, width: "100%", marginTop: 4 }} defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const id = e.target.value;
                if (!selected.branchIds.includes(id)) upd({ branchIds: [...selected.branchIds, id] });
                e.target.value = "";
              }}>
              <option value="">— Привязать ветвь —</option>
              {branches.filter((b) => !selected.branchIds.includes(b.id)).map((b) => (
                <option key={b.id} value={b.id}>{b.id}. {b.type || "Ветвь"}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        positions.length > 0 && (
          <div className="flex-1 flex items-center justify-center" style={{ color: "#aaa", fontSize: 11 }}>
            Выберите позицию из списка
          </div>
        )
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  border: "1px solid #b8b8b8", background: "#f5f5f5",
  cursor: "pointer", fontSize: 11, color: "#374151",
};

const inputStyle: React.CSSProperties = {
  fontSize: 11, border: "1px solid #c8c8c8",
  borderRadius: 2, padding: "1px 4px",
  background: "#fff", outline: "none", height: 18,
};

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "3px 8px 2px", background: "#f0f0f0", borderTop: "1px solid #d8d8d8", borderBottom: "1px solid #d8d8d8", fontSize: 11, fontWeight: 600, color: "#333" }}>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5">
      <span style={{ color: "#555", fontSize: 11, width: 130, flexShrink: 0 }}>{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
