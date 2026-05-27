import { useState } from "react";
import { type Position, makePosition, POSITION_COLORS } from "@/lib/positions";
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
  onPlaceMode: () => void;   // активировать режим расстановки на схеме
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

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ fontSize: 11 }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: "1px solid #d0d0d0" }}>
        <button
          onClick={addPosition}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{ border: "1px solid #b8b8b8", background: "#f5f5f5", cursor: "pointer", fontSize: 11 }}
          title="Добавить позицию">
          <Icon name="Plus" size={12} />
          Добавить
        </button>
        <button
          onClick={onPlaceMode}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{
            border: "1px solid #b8b8b8",
            background: placeModeActive ? "#dbeafe" : "#f5f5f5",
            color: placeModeActive ? "#1d4ed8" : "#374151",
            cursor: "pointer", fontSize: 11,
          }}
          title="Разместить позицию на схеме кликом">
          <Icon name="MapPin" size={12} />
          На схему
        </button>
        {selected && (
          <button
            onClick={() => { onDelete(selected.id); onSelect(null); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded ml-auto"
            style={{ border: "1px solid #fca5a5", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontSize: 11 }}
            title="Удалить позицию">
            <Icon name="Trash2" size={12} />
          </button>
        )}
      </div>

      {/* Список позиций */}
      <div className="overflow-y-auto" style={{ flex: "0 0 auto", maxHeight: 220, borderBottom: "1px solid #d0d0d0" }}>
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
            style={{
              background: pos.id === selectedPositionId ? "#e8f0fe" : "transparent",
              borderBottom: "1px solid #f0f0f0",
            }}>
            {/* Маркер-кружок */}
            <div
              className="flex-shrink-0 flex items-center justify-center rounded-full font-bold"
              style={{
                width: 22, height: 22,
                background: pos.color,
                border: `2px solid ${pos.borderColor}`,
                color: "#fff",
                fontSize: 10,
              }}>
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
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startEditNumber(pos); }}
                  title="Двойной клик — изменить номер">
                  {pos.number}
                </span>
              )}
            </div>
            {/* Название */}
            <span className="flex-1 truncate" style={{ color: "#222" }}>
              {pos.name || <span style={{ color: "#aaa" }}>Позиция {pos.number}</span>}
            </span>
            {/* Кол-во привязанных ветвей */}
            {pos.branchIds.length > 0 && (
              <span style={{ color: "#666", fontSize: 10 }}>{pos.branchIds.length} вет.</span>
            )}
          </div>
        ))}
      </div>

      {/* Редактирование выбранной */}
      {selected && (
        <div className="flex-1 overflow-y-auto px-2 py-1.5 flex flex-col gap-2">
          <div style={{ fontWeight: 600, fontSize: 11, color: "#333", marginBottom: 2 }}>
            Свойства позиции
          </div>

          {/* Номер */}
          <Row label="Номер:">
            <input
              type="number" min={1}
              value={selected.number}
              onChange={(e) => onUpdate(selected.id, { number: parseInt(e.target.value) || 1 })}
              style={inputStyle}
            />
          </Row>

          {/* Название */}
          <Row label="Название:">
            <input
              type="text"
              value={selected.name}
              placeholder="Не задано"
              onChange={(e) => onUpdate(selected.id, { name: e.target.value })}
              style={inputStyle}
            />
          </Row>

          {/* Цвет */}
          <Row label="Цвет:">
            <div className="flex items-center gap-1 flex-wrap">
              {POSITION_COLORS.map((c) => (
                <button
                  key={c.color}
                  onClick={() => onUpdate(selected.id, { color: c.color, borderColor: c.border })}
                  title={c.label}
                  style={{
                    width: 18, height: 18,
                    background: c.color,
                    border: selected.color === c.color ? `3px solid ${c.border}` : `2px solid ${c.border}`,
                    borderRadius: "50%",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
              ))}
              {/* Произвольный цвет */}
              <input
                type="color"
                value={selected.color}
                onChange={(e) => onUpdate(selected.id, { color: e.target.value, borderColor: e.target.value })}
                title="Свой цвет"
                style={{ width: 18, height: 18, padding: 0, border: "1px solid #ccc", borderRadius: 3, cursor: "pointer" }}
              />
            </div>
          </Row>

          {/* Комментарий */}
          <Row label="Комментарий:" vertical>
            <textarea
              value={selected.comment}
              onChange={(e) => onUpdate(selected.id, { comment: e.target.value })}
              rows={2}
              style={{ ...inputStyle, resize: "vertical", width: "100%" }}
            />
          </Row>

          {/* Привязанные ветви */}
          <div style={{ marginTop: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 11, color: "#333", marginBottom: 4 }}>
              Привязанные ветви
            </div>
            {selected.branchIds.length === 0 && (
              <div style={{ color: "#aaa", fontSize: 11 }}>Нет привязанных ветвей</div>
            )}
            {selected.branchIds.map((bid) => {
              const b = branches.find((br) => br.id === bid);
              return (
                <div key={bid} className="flex items-center gap-1 py-0.5">
                  <span className="flex-1 truncate" style={{ fontSize: 11, color: "#333" }}>
                    {b ? `${b.id}. ${b.type || "Ветвь"}` : `Ветвь ${bid}`}
                  </span>
                  <button
                    onClick={() => onUpdate(selected.id, { branchIds: selected.branchIds.filter((x) => x !== bid) })}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#999", padding: 0 }}
                    title="Отвязать">
                    <Icon name="X" size={12} />
                  </button>
                </div>
              );
            })}

            {/* Быстрая привязка из списка */}
            <div style={{ marginTop: 4 }}>
              <select
                style={{ ...inputStyle, width: "100%" }}
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const id = e.target.value;
                  if (!selected.branchIds.includes(id)) {
                    onUpdate(selected.id, { branchIds: [...selected.branchIds, id] });
                  }
                  e.target.value = "";
                }}>
                <option value="">— Привязать ветвь —</option>
                {branches
                  .filter((b) => !selected.branchIds.includes(b.id))
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.id}. {b.type || "Ветвь"}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {!selected && positions.length > 0 && (
        <div className="flex-1 flex items-center justify-center" style={{ color: "#aaa", fontSize: 11 }}>
          Выберите позицию из списка
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  border: "1px solid #c8c8c8",
  borderRadius: 2,
  padding: "1px 4px",
  background: "#fff",
  outline: "none",
  height: 18,
};

function Row({ label, children, vertical }: { label: string; children: React.ReactNode; vertical?: boolean }) {
  if (vertical) {
    return (
      <div className="flex flex-col gap-0.5">
        <span style={{ color: "#555", fontSize: 11 }}>{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <span style={{ color: "#555", fontSize: 11, width: 80, flexShrink: 0 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
