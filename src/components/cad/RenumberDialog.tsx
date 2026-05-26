import { useState } from "react";
import Icon from "@/components/ui/icon";

export interface RenumberOptions {
  area: "all" | "horizon";
  horizonId: string;
  mode: "continue" | "restart";
  objects: "branches" | "nodes" | "both";
  startFrom: number;
  direction: "asc" | "desc";
}

interface Props {
  nodeCount: number;
  branchCount: number;
  horizons: { id: string; name: string }[];
  onConfirm: (opts: RenumberOptions) => void;
  onClose: () => void;
}

export default function RenumberDialog({ nodeCount, branchCount, horizons, onConfirm, onClose }: Props) {
  const [area, setArea] = useState<"all" | "horizon">("all");
  const [horizonId, setHorizonId] = useState(horizons[0]?.id ?? "");
  const [mode, setMode] = useState<"continue" | "restart">("restart");
  const [objects, setObjects] = useState<"branches" | "nodes" | "both">("both");
  const [startFrom, setStartFrom] = useState(1);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const handleOk = () => {
    onConfirm({ area, horizonId, mode, objects, startFrom, direction });
  };

  const S = {
    overlay: { position: "fixed" as const, inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)" },
    dialog: { width: 390, background: "#ffffff", border: "1px solid #aaa", borderRadius: 4, boxShadow: "0 8px 32px rgba(0,0,0,0.35)", fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 12, color: "#1a1a1a" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "linear-gradient(180deg,#dde4ef,#c5cfe0)", borderBottom: "1px solid #9aa8bf" },
    headerTitle: { display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13, color: "#1a1a1a" },
    closeBtn: { width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "none", background: "transparent", fontSize: 12, color: "#333", borderRadius: 2 },
    body: { padding: "12px 16px", display: "flex", flexDirection: "column" as const, gap: 8, background: "#ffffff" },
    row: { display: "flex", alignItems: "center", gap: 8 },
    label: { width: 120, flexShrink: 0, color: "#333", fontSize: 12 },
    select: { flex: 1, height: 22, padding: "0 4px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, background: "#fff", color: "#1a1a1a", outline: "none" },
    input: { width: 72, height: 22, padding: "0 4px", border: "1px solid #aaa", borderRadius: 2, fontSize: 12, background: "#fff", color: "#1a1a1a", textAlign: "right" as const, outline: "none" },
    stat: { fontSize: 11, color: "#555", paddingTop: 6, borderTop: "1px solid #ddd", marginTop: 2 },
    statVal: { fontWeight: 600, color: "#1a1a1a" },
    footer: { display: "flex", justifyContent: "flex-end", gap: 6, padding: "8px 16px 10px", background: "#f0f0f0", borderTop: "1px solid #ccc" },
    btnOk: { height: 26, padding: "0 20px", fontSize: 12, background: "#2563eb", color: "#fff", border: "1px solid #1d4ed8", borderRadius: 2, cursor: "pointer", fontWeight: 600 },
    btnCancel: { height: 26, padding: "0 14px", fontSize: 12, background: "#f5f5f5", color: "#1a1a1a", border: "1px solid #aaa", borderRadius: 2, cursor: "pointer" },
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>

        {/* Шапка */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <Icon name="Hash" size={14} style={{ color: "#2563eb" }} />
            Автонумерация объектов
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Закрыть">✕</button>
        </div>

        {/* Содержимое */}
        <div style={S.body}>

          {/* Область */}
          <div style={S.row}>
            <span style={S.label}>Область:</span>
            <select value={area} onChange={(e) => setArea(e.target.value as "all" | "horizon")} style={S.select}>
              <option value="all">Вся схема</option>
              {horizons.length > 0 && <option value="horizon">Горизонт</option>}
            </select>
          </div>

          {/* Выбор горизонта */}
          {area === "horizon" && horizons.length > 0 && (
            <div style={S.row}>
              <span style={S.label}>Горизонт:</span>
              <select value={horizonId} onChange={(e) => setHorizonId(e.target.value)} style={S.select}>
                {horizons.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Нумерация */}
          <div style={S.row}>
            <span style={S.label}>Нумерация:</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as "continue" | "restart")} style={S.select}>
              <option value="restart">Начать заново</option>
              <option value="continue">Продолжить существующую</option>
            </select>
          </div>

          {/* Объекты */}
          <div style={S.row}>
            <span style={S.label}>Объекты:</span>
            <select value={objects} onChange={(e) => setObjects(e.target.value as "branches" | "nodes" | "both")} style={S.select}>
              <option value="both">Выработки и узлы</option>
              <option value="branches">Выработки</option>
              <option value="nodes">Узлы</option>
            </select>
          </div>

          {/* Порядок */}
          <div style={S.row}>
            <span style={S.label}>Порядок:</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as "asc" | "desc")} style={S.select}>
              <option value="asc">С первого (1 → N)</option>
              <option value="desc">С последнего (N → 1)</option>
            </select>
          </div>

          {/* Начать с номера */}
          <div style={S.row}>
            <span style={S.label}>Начать с номера:</span>
            <input type="number" value={startFrom} min={1}
              onChange={(e) => setStartFrom(Math.max(1, parseInt(e.target.value) || 1))}
              style={S.input} />
          </div>

          {/* Статистика */}
          <div style={S.stat}>
            В проекте сейчас:{" "}
            <span style={S.statVal}>{nodeCount} узлов · {branchCount} выработок</span>
          </div>
        </div>

        {/* Кнопки */}
        <div style={S.footer}>
          <button style={S.btnOk} onClick={handleOk}>ОК</button>
          <button style={S.btnCancel} onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}