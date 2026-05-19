import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";

export interface LogEntry {
  id: number;
  ts: string;
  level: "info" | "ok" | "warn" | "error";
  text: string;
}

interface LogPanelProps {
  entries: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}

export default function LogPanel({ entries, onClose, onClear }: LogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<"all" | "warn" | "error">("all");
  const [pos, setPos] = useState({ x: 80, y: 120 });
  const [size, setSize] = useState({ w: 560, h: 300 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; ow: number; oh: number } | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  const visible = entries.filter(e =>
    filter === "all" ? true :
    filter === "warn" ? (e.level === "warn" || e.level === "error") :
    e.level === "error"
  );

  const levelColor = (l: LogEntry["level"]) =>
    l === "error" ? "#dc2626" : l === "warn" ? "#d97706" : l === "ok" ? "#16a34a" : "#6b7280";

  const levelIcon = (l: LogEntry["level"]) =>
    l === "error" ? "✕" : l === "warn" ? "⚠" : l === "ok" ? "✓" : "·";

  const onMouseDownDrag = (e: React.MouseEvent) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.ox + ev.clientX - dragRef.current.sx, y: dragRef.current.oy + ev.clientY - dragRef.current.sy });
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

  const onMouseDownResize = (e: React.MouseEvent) => {
    resizeRef.current = { sx: e.clientX, sy: e.clientY, ow: size.w, oh: size.h };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      setSize({
        w: Math.max(320, resizeRef.current.ow + ev.clientX - resizeRef.current.sx),
        h: Math.max(180, resizeRef.current.oh + ev.clientY - resizeRef.current.sy),
      });
    };
    const onUp = () => { resizeRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  };

  const errCount  = entries.filter(e => e.level === "error").length;
  const warnCount = entries.filter(e => e.level === "warn").length;

  return (
    <div
      className="fixed z-40 flex flex-col bg-white shadow-xl"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, border: "1px solid #9ca3af", borderRadius: 6, minWidth: 320, minHeight: 180 }}
    >
      {/* Заголовок — за него тащим */}
      <div
        onMouseDown={onMouseDownDrag}
        className="flex items-center justify-between px-2 py-1 select-none cursor-move"
        style={{ background: "#1e293b", borderRadius: "5px 5px 0 0", flexShrink: 0 }}
      >
        <div className="flex items-center gap-2">
          <Icon name="ScrollText" size={12} style={{ color: "#94a3b8" }} />
          <span className="text-[11px] font-semibold" style={{ color: "#e2e8f0" }}>Лог расчёта</span>
          <span className="text-[10px]" style={{ color: "#64748b" }}>{entries.length} записей</span>
          {errCount > 0 && <span className="text-[10px] px-1 rounded" style={{ background: "#7f1d1d", color: "#fca5a5" }}>{errCount} ошиб.</span>}
          {warnCount > 0 && <span className="text-[10px] px-1 rounded" style={{ background: "#78350f", color: "#fcd34d" }}>{warnCount} предупр.</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onClear} title="Очистить лог" className="text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-700" style={{ color: "#94a3b8" }}>Очистить</button>
          <button onClick={onClose} className="text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-700" style={{ color: "#94a3b8" }}>✕</button>
        </div>
      </div>

      {/* Фильтр */}
      <div className="flex items-center gap-1 px-2 py-1" style={{ background: "#f8fafc", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
        {(["all", "warn", "error"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ background: filter === f ? "#1e293b" : "#e2e8f0", color: filter === f ? "white" : "#475569", fontWeight: filter === f ? 600 : 400 }}
          >
            {f === "all" ? "Все" : f === "warn" ? "Предупреждения" : "Ошибки"}
          </button>
        ))}
        <span className="ml-auto text-[10px]" style={{ color: "#94a3b8" }}>{visible.length} строк</span>
      </div>

      {/* Список строк */}
      <div className="overflow-y-auto flex-1 font-mono" style={{ fontSize: 11, background: "#0f172a" }}>
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px]" style={{ color: "#475569" }}>Нет записей</div>
        ) : (
          visible.map(e => (
            <div
              key={e.id}
              className="flex items-start gap-2 px-2 py-0.5 hover:bg-slate-800"
              style={{ borderBottom: "1px solid #1e293b" }}
            >
              <span className="shrink-0 text-[10px] mt-0.5" style={{ color: "#334155", width: 50 }}>{e.ts}</span>
              <span className="shrink-0" style={{ color: levelColor(e.level), width: 10 }}>{levelIcon(e.level)}</span>
              <span style={{ color: e.level === "error" ? "#fca5a5" : e.level === "warn" ? "#fcd34d" : e.level === "ok" ? "#86efac" : "#94a3b8", wordBreak: "break-word" }}>
                {e.text}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Ресайз-хэндл */}
      <div
        onMouseDown={onMouseDownResize}
        className="absolute cursor-se-resize"
        style={{ right: 0, bottom: 0, width: 14, height: 14, background: "#334155", borderRadius: "5px 0 5px 0", opacity: 0.7 }}
        title="Изменить размер"
      />
    </div>
  );
}
