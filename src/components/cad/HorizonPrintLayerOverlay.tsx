// Слой печати горизонта: рамка, заголовок, блок УТВЕРЖДАЮ
// УО и штамп убраны — рендерятся прямо на схеме через TopoCanvas (renderPrintLayers)
import { useState, useRef, useEffect } from "react";
import { type HorizonPrintLayer } from "@/lib/topology";

interface Props {
  layer: HorizonPrintLayer;
  width: number;
  height: number;
  onChange?: (patch: Partial<HorizonPrintLayer>) => void;
}

// Инлайн-редактирование: двойной клик → input/textarea
function InlineEdit({
  value, onChange, multiline = false, style, textStyle,
}: {
  value: string; onChange: (v: string) => void;
  multiline?: boolean; style?: React.CSSProperties; textStyle?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);

  const commit = () => { setEditing(false); if (draft !== value) onChange(draft); };

  const inputStyle: React.CSSProperties = {
    ...textStyle,
    background: "rgba(255,253,230,0.97)",
    border: "1.5px solid #f59e0b",
    borderRadius: 2,
    outline: "none",
    resize: "none",
    padding: "1px 3px",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => e.key === "Escape" && setEditing(false)}
          style={{ ...inputStyle, minHeight: 28, display: "block" }}
          rows={Math.max(2, draft.split("\n").length)}
        />
      );
    }
    return (
      <input
        ref={ref as React.Ref<HTMLInputElement>}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{ ...inputStyle, display: "block" }}
      />
    );
  }

  return (
    <span
      title="Двойной клик для редактирования"
      onDoubleClick={() => setEditing(true)}
      style={{ ...style, cursor: "text", display: "block", minWidth: 20, whiteSpace: "pre-wrap", ...textStyle }}
    >
      {value || <span style={{ color: "#bbb", fontStyle: "italic" }}>—</span>}
    </span>
  );
}

export default function HorizonPrintLayerOverlay({ layer, width, height, onChange }: Props) {
  const sc = width / 794;
  const fs = (mm: number) => mm * sc * 3.78;

  const pad = fs(8);
  const apprW = fs(75);
  const apprY = pad + fs(2);
  const titleY = pad + fs(6);
  const lw = Math.max(0.5, sc * 0.6);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: layer.showApprover && onChange ? "auto" : "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/* Внешняя рамка */}
        <rect x={pad * 0.5} y={pad * 0.5} width={width - pad} height={height - pad}
          fill="none" stroke="#333" strokeWidth={Math.max(1, sc * 2)} />
        {/* Внутренняя рамка (отступ 5мм) */}
        <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2}
          fill="none" stroke="#333" strokeWidth={Math.max(0.5, sc)} />

        {/* Заголовок */}
        {layer.title && (
          <text
            x={width / 2} y={titleY + fs(12)}
            textAnchor="middle"
            fontSize={fs(8)} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
            {layer.title}
          </text>
        )}
      </svg>

      {/* ── Блок УТВЕРЖДАЮ — HTML для редактирования ── */}
      {layer.showApprover && (
        <div style={{
          position: "absolute",
          right: pad,
          top: apprY,
          width: apprW,
          fontFamily: "Arial, sans-serif",
          fontSize: fs(3.2),
          color: "#111",
          textAlign: "center",
          lineHeight: 1.5,
          pointerEvents: onChange ? "auto" : "none",
        }}>
          <div style={{ fontWeight: "bold", fontSize: fs(3.8), marginBottom: fs(1) }}>
            УТВЕРЖДАЮ
          </div>
          <InlineEdit
            value={layer.approverTitle || "Должность"}
            onChange={v => onChange?.({ approverTitle: v })}
            multiline
            textStyle={{ fontSize: fs(3.2), textAlign: "center", color: "#111" }}
          />
          <InlineEdit
            value={layer.orgName || "Организация"}
            onChange={v => onChange?.({ orgName: v })}
            multiline
            textStyle={{ fontSize: fs(3.2), textAlign: "center", color: "#111" }}
          />
          <div style={{ borderTop: `${lw}px solid #111`, margin: `${fs(2)}px ${fs(4)}px ${fs(0.5)}px` }} />
          <InlineEdit
            value={layer.approverName || "И.О. Фамилия"}
            onChange={v => onChange?.({ approverName: v })}
            textStyle={{ fontSize: fs(3.2), textAlign: "right", color: "#111", paddingRight: fs(1) }}
          />
          <div style={{ borderTop: `${lw}px solid #111`, margin: `${fs(1.5)}px 0 ${fs(0.5)}px` }} />
          <div style={{ display: "flex", alignItems: "center", gap: fs(1), fontSize: fs(3.2) }}>
            <span>«</span>
            <InlineEdit
              value={layer.year || "_____"}
              onChange={v => onChange?.({ year: v })}
              textStyle={{ fontSize: fs(3.2), width: fs(10), textAlign: "center", color: "#111" }}
            />
            <span>»</span>
            <span style={{ flexGrow: 1, borderBottom: `${lw}px solid #111`, minWidth: fs(20) }} />
            <span>г.</span>
          </div>
        </div>
      )}
    </div>
  );
}
