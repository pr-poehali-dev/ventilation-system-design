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

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}>
      <div
        className="bg-white rounded shadow-2xl border border-gray-300"
        style={{ width: 380, fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 12 }}
        onClick={(e) => e.stopPropagation()}>

        {/* Шапка */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)" }}>
          <div className="flex items-center gap-1.5">
            <Icon name="Hash" size={14} className="text-blue-600" />
            <span className="font-semibold text-[13px]">Автонумерация объектов</span>
          </div>
          <button onClick={onClose}
            className="w-6 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded">✕</button>
        </div>

        {/* Содержимое */}
        <div className="px-4 py-3 space-y-2.5">

          {/* Область */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-28 flex-shrink-0">Область:</span>
            <select value={area} onChange={(e) => setArea(e.target.value as "all" | "horizon")}
              className="flex-1 px-1 border border-gray-300 rounded text-[12px]"
              style={{ height: 22, outline: "none" }}>
              <option value="all">Вся схема</option>
              {horizons.length > 0 && <option value="horizon">Горизонт</option>}
            </select>
          </div>

          {/* Выбор горизонта */}
          {area === "horizon" && horizons.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600 w-28 flex-shrink-0">Горизонт:</span>
              <select value={horizonId} onChange={(e) => setHorizonId(e.target.value)}
                className="flex-1 px-1 border border-gray-300 rounded text-[12px]"
                style={{ height: 22, outline: "none" }}>
                {horizons.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Нумерация */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-28 flex-shrink-0">Нумерация:</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as "continue" | "restart")}
              className="flex-1 px-1 border border-gray-300 rounded text-[12px]"
              style={{ height: 22, outline: "none" }}>
              <option value="restart">Начать заново</option>
              <option value="continue">Продолжить существующую</option>
            </select>
          </div>

          {/* Объекты */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-28 flex-shrink-0">Объекты:</span>
            <select value={objects} onChange={(e) => setObjects(e.target.value as "branches" | "nodes" | "both")}
              className="flex-1 px-1 border border-gray-300 rounded text-[12px]"
              style={{ height: 22, outline: "none" }}>
              <option value="both">Выработки и вершины</option>
              <option value="branches">Выработки</option>
              <option value="nodes">Вершины</option>
            </select>
          </div>

          {/* Порядок */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-28 flex-shrink-0">Порядок:</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as "asc" | "desc")}
              className="flex-1 px-1 border border-gray-300 rounded text-[12px]"
              style={{ height: 22, outline: "none" }}>
              <option value="asc">С первого (1 → N)</option>
              <option value="desc">С последнего (N → 1)</option>
            </select>
          </div>

          {/* Начать с номера */}
          <div className="flex items-center gap-2">
            <span className="text-gray-600 w-28 flex-shrink-0">Начать с номера:</span>
            <input type="number" value={startFrom} min={1}
              onChange={(e) => setStartFrom(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-20 px-1 border border-gray-300 rounded text-[12px] text-right"
              style={{ height: 22, outline: "none" }} />
          </div>

          {/* Статистика */}
          <div className="text-[10px] text-gray-500 pt-1 border-t border-gray-200">
            В проекте сейчас:{" "}
            <span className="font-mono text-gray-700">{nodeCount} вершин · {branchCount} выработок</span>
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex justify-end gap-2 px-4 pb-3">
          <button onClick={handleOk}
            className="h-7 px-5 text-[12px] rounded text-white font-medium"
            style={{ background: "#2563eb", minWidth: 60 }}>
            ОК
          </button>
          <button onClick={onClose}
            className="h-7 px-4 text-[12px] border border-gray-300 rounded hover:bg-gray-100"
            style={{ minWidth: 60 }}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
