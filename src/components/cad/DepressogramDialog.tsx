import React, { useState, useMemo, useEffect } from "react";
import Icon from "@/components/ui/icon";
import type { TopoNode, TopoBranch } from "@/lib/topology";

// ─────────────────────────────────────────────────────────────────────────────
// Депрессиограмма — график изменения напора вдоль маршрута
// Режим авто: главный маршрут (макс. расход от ВГП до поверхности)
// Режим ручной: пользователь кликает по ветвям на схеме
// ─────────────────────────────────────────────────────────────────────────────

export interface DepressogramPoint {
  nodeId: string;
  nodeName: string;
  nodeNumber: string;
  branchId: string | null;
  branchName: string;
  branchNumber: string | null;
  cumulativeLength: number;
  pressure: number;
  dP: number;
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  onClose: () => void;
  onHighlightPath?: (branchIds: string[]) => void;
  // Ручной режим
  pickMode: boolean;
  onPickModeChange: (active: boolean) => void;
  manualBranchIds: Set<string>;
  onClearManual: () => void;
}

// ─── Алгоритм поиска главного маршрута ───────────────────────────────────────
function findMainRoute(
  nodes: TopoNode[],
  branches: TopoBranch[]
): { path: string[]; branchPath: string[] } | null {
  const fanBranches = branches.filter(b => b.hasFan && b.fanType === "ГВУ" && !b.fanStopped);
  if (fanBranches.length === 0) {
    const anyFan = branches.find(b => b.hasFan && !b.fanStopped);
    if (!anyFan) return null;
    fanBranches.push(anyFan);
  }

  const surfaceNodeIds = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));

  const mainFan = fanBranches.reduce((a, b) =>
    Math.abs(b.flow ?? 0) > Math.abs(a.flow ?? 0) ? b : a
  );

  let startNodeId: string;
  if (surfaceNodeIds.has(mainFan.toId)) {
    startNodeId = mainFan.fromId;
  } else if (surfaceNodeIds.has(mainFan.fromId)) {
    startNodeId = mainFan.toId;
  } else {
    startNodeId = mainFan.fromId;
  }

  const adj: Map<string, { branchId: string; neighborId: string; flow: number; hasBulkhead: boolean }[]> = new Map();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push({ branchId: b.id, neighborId: b.toId, flow: Math.abs(b.flow ?? 0), hasBulkhead: b.hasBulkhead });
    adj.get(b.toId)!.push({ branchId: b.id, neighborId: b.fromId, flow: Math.abs(b.flow ?? 0), hasBulkhead: b.hasBulkhead });
  }

  const visited = new Set<string>([startNodeId]);
  const nodePath: string[] = [startNodeId];
  const branchPath: string[] = [];
  let current = startNodeId;
  const MAX_STEPS = 500;
  let steps = 0;

  while (!surfaceNodeIds.has(current) && steps < MAX_STEPS) {
    steps++;
    const neighbors = adj.get(current) ?? [];
    const candidates = neighbors
      .filter(n => !visited.has(n.neighborId) && !n.hasBulkhead)
      .sort((a, b) => b.flow - a.flow);

    const chosen = candidates.length > 0 ? candidates[0] : neighbors
      .filter(n => !visited.has(n.neighborId))
      .sort((a, b) => b.flow - a.flow)[0];

    if (!chosen) break;
    visited.add(chosen.neighborId);
    nodePath.push(chosen.neighborId);
    branchPath.push(chosen.branchId);
    current = chosen.neighborId;
  }

  if (nodePath.length < 2) return null;
  return { path: nodePath, branchPath };
}

// ─── Построение точек из упорядоченного списка branchIds ─────────────────────
function buildPointsFromBranchIds(
  branchIds: string[],
  nodes: TopoNode[],
  branches: TopoBranch[]
): DepressogramPoint[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchMap = new Map(branches.map(b => [b.id, b]));
  if (branchIds.length === 0) return [];

  // Выстраиваем связанную цепочку: каждая следующая ветвь стыкуется с концом предыдущей
  type ChainItem = { b: TopoBranch; fromId: string; toId: string };
  const chain: ChainItem[] = [];
  const first = branchMap.get(branchIds[0]);
  if (!first) return [];
  chain.push({ b: first, fromId: first.fromId, toId: first.toId });

  for (let i = 1; i < branchIds.length; i++) {
    const b = branchMap.get(branchIds[i]);
    if (!b) continue;
    const prev = chain[chain.length - 1];
    if (b.fromId === prev.toId) {
      chain.push({ b, fromId: b.fromId, toId: b.toId });
    } else if (b.toId === prev.toId) {
      chain.push({ b, fromId: b.toId, toId: b.fromId });
    } else {
      chain.push({ b, fromId: b.fromId, toId: b.toId });
    }
  }

  let totalDP = 0;
  for (const c of chain) totalDP += Math.abs(c.b.dP ?? 0);

  const points: DepressogramPoint[] = [];
  let cumLen = 0;
  let pressure = totalDP;

  const firstNode = nodeMap.get(chain[0].fromId);
  points.push({
    nodeId: chain[0].fromId,
    nodeName: firstNode?.name ?? "",
    nodeNumber: firstNode?.number ?? "",
    branchId: null,
    branchName: "",
    branchNumber: null,
    cumulativeLength: 0,
    pressure,
    dP: 0,
  });

  for (const c of chain) {
    cumLen += c.b.length ?? 0;
    const dp = Math.abs(c.b.dP ?? 0);
    pressure -= dp;
    const toNode = nodeMap.get(c.toId);
    points.push({
      nodeId: c.toId,
      nodeName: toNode?.name ?? "",
      nodeNumber: toNode?.number ?? "",
      branchId: c.b.id,
      branchName: c.b.name ?? c.b.id,
      branchNumber: c.b.id,
      cumulativeLength: Math.round(cumLen * 100) / 100,
      pressure: Math.round(pressure * 100) / 100,
      dP: Math.round(dp * 100) / 100,
    });
  }

  return points;
}

// ─── SVG-График ──────────────────────────────────────────────────────────────
function DepressogramChart({ points, width, height }: {
  points: DepressogramPoint[];
  width: number;
  height: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const padL = 58, padR = 22, padT = 18, padB = 40;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const maxLen = Math.max(...points.map(p => p.cumulativeLength), 1);
  const allP = points.map(p => p.pressure);
  const maxP = Math.max(...allP, 0);
  const minP = Math.min(...allP, 0);
  const pRange = (maxP - minP) || 1;

  const toX = (l: number) => padL + (l / maxLen) * W;
  const toY = (p: number) => padT + ((maxP - p) / pRange) * H;

  const yTicks = 6;
  const xTicks = 8;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.cumulativeLength).toFixed(1)} ${toY(p.pressure).toFixed(1)}`)
    .join(" ");

  const lastPt = points[points.length - 1];
  const areaD = points.length > 1
    ? `${pathD} L ${toX(lastPt.cumulativeLength).toFixed(1)} ${toY(minP).toFixed(1)} L ${toX(0).toFixed(1)} ${toY(minP).toFixed(1)} Z`
    : "";

  return (
    <svg width={width} height={height} style={{ fontFamily: "system-ui, sans-serif", display: "block" }}>
      <defs>
        <linearGradient id="dg-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
        </linearGradient>
      </defs>

      {/* Фон области графика */}
      <rect x={padL} y={padT} width={W} height={H} fill="#f8faff" rx={2} />

      {/* Сетка */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = minP + (pRange * i) / yTicks;
        const y = toY(val);
        return (
          <g key={`y${i}`}>
            <line x1={padL} y1={y} x2={padL + W} y2={y} stroke="#dde4f0" strokeWidth={1} />
            <text x={padL - 6} y={y + 3.5} textAnchor="end" fontSize={9.5} fill="#64748b">{val.toFixed(1)}</text>
          </g>
        );
      })}
      {Array.from({ length: xTicks + 1 }, (_, i) => {
        const val = (maxLen * i) / xTicks;
        const x = toX(val);
        return (
          <g key={`x${i}`}>
            <line x1={x} y1={padT} x2={x} y2={padT + H} stroke="#dde4f0" strokeWidth={1} />
            <text x={x} y={padT + H + 17} textAnchor="middle" fontSize={9.5} fill="#64748b">{Math.round(val)}</text>
          </g>
        );
      })}

      {/* Ось 0 */}
      {minP < 0 && maxP > 0 && (
        <line x1={padL} y1={toY(0)} x2={padL + W} y2={toY(0)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,3" />
      )}

      {/* Оси */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + H + 1} stroke="#94a3b8" strokeWidth={1.5} />
      <line x1={padL - 1} y1={padT + H} x2={padL + W} y2={padT + H} stroke="#94a3b8" strokeWidth={1.5} />

      {/* Подписи осей */}
      <text x={15} y={padT + H / 2} textAnchor="middle" fontSize={10.5} fill="#475569" fontWeight={500}
        transform={`rotate(-90, 15, ${padT + H / 2})`}>Напор, Па</text>
      <text x={padL + W / 2} y={height - 5} textAnchor="middle" fontSize={10.5} fill="#475569" fontWeight={500}>Длина, м</text>

      {/* Заливка под линией */}
      {areaD && <path d={areaD} fill="url(#dg-fill)" />}

      {/* Линия */}
      <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {/* Точки + номера узлов */}
      {points.map((p, i) => {
        const x = toX(p.cumulativeLength);
        const y = toY(p.pressure);
        const isHov = hovered === i;
        return (
          <g key={i}>
            {p.nodeNumber && (
              <text x={x} y={y - 9} textAnchor="middle" fontSize={8.5} fill="#1e40af" fontWeight={600}>{p.nodeNumber}</text>
            )}
            <circle cx={x} cy={y} r={isHov ? 6 : 4}
              fill={isHov ? "#1d4ed8" : "#3b82f6"} stroke="white" strokeWidth={2}
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          </g>
        );
      })}

      {/* Tooltip */}
      {hovered !== null && (() => {
        const p = points[hovered];
        const x = toX(p.cumulativeLength);
        const y = toY(p.pressure);
        const tw = 176, th = hovered > 0 ? 65 : 50;
        const tx = Math.min(x + 12, padL + W - tw - 4);
        const ty = Math.max(y - th - 8, padT + 2);
        return (
          <g>
            <rect x={tx} y={ty} width={tw} height={th} rx={5} fill="#0f172a" opacity={0.93} />
            <text x={tx + 9} y={ty + 15} fontSize={10} fill="white" fontWeight={700}>
              {p.nodeNumber ? `Узел ${p.nodeNumber}` : "Начало маршрута"}
            </text>
            <text x={tx + 9} y={ty + 28} fontSize={9} fill="#94a3b8">{p.nodeName.slice(0, 26)}</text>
            <text x={tx + 9} y={ty + 42} fontSize={9} fill="#7dd3fc">
              L = {p.cumulativeLength.toFixed(1)} м · h = {p.pressure.toFixed(2)} Па
            </text>
            {hovered > 0 && (
              <text x={tx + 9} y={ty + 56} fontSize={9} fill="#fca5a5">
                ΔP = −{p.dP.toFixed(2)} Па ({p.branchName.slice(0, 20)})
              </text>
            )}
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Основной диалог ─────────────────────────────────────────────────────────
export default function DepressogramDialog({
  nodes, branches, onClose, onHighlightPath,
  pickMode, onPickModeChange, manualBranchIds, onClearManual,
}: Props) {
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");
  const [mode, setMode] = useState<"auto" | "manual">("auto");

  const autoRoute = useMemo(() => findMainRoute(nodes, branches), [nodes, branches]);

  const autoPoints = useMemo(() =>
    autoRoute ? buildPointsFromBranchIds(autoRoute.branchPath, nodes, branches) : [],
    [autoRoute, nodes, branches]
  );

  const manualPoints = useMemo(() =>
    manualBranchIds.size > 0
      ? buildPointsFromBranchIds(Array.from(manualBranchIds), nodes, branches)
      : [],
    [manualBranchIds, nodes, branches]
  );

  const points = mode === "auto" ? autoPoints : manualPoints;
  const branchIds = mode === "auto" ? (autoRoute?.branchPath ?? []) : Array.from(manualBranchIds);

  const totalLength = points.length > 0 ? points[points.length - 1].cumulativeLength : 0;
  const totalDep = points.length > 0 ? points[0].pressure : 0;

  // Подсвечиваем маршрут на схеме при каждом обновлении
  useEffect(() => {
    if (onHighlightPath) onHighlightPath(branchIds);
    return () => { if (onHighlightPath) onHighlightPath([]); };
  }, [branchIds.join(",")]);

  const handleModeChange = (m: "auto" | "manual") => {
    setMode(m);
    onPickModeChange(m === "manual");
    if (m === "auto") onClearManual();
  };

  const handleExport = () => {
    const header = ["Нач. узел", "Кон. узел", "Название выработки", "Номер", "Длина, м", "ΔP, Па", "Напор, Па"].join("\t");
    const rows = points.map((p, i) => {
      const prev = i > 0 ? points[i - 1] : null;
      return [prev ? prev.nodeNumber || prev.nodeId : "—", p.nodeNumber || p.nodeId, p.branchName || "(старт)", p.branchNumber ?? "", p.cumulativeLength.toFixed(2), p.dP.toFixed(2), p.pressure.toFixed(2)].join("\t");
    });
    const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "депрессиограмма.xls"; a.click();
    URL.revokeObjectURL(url);
  };

  const W = Math.min(window.innerWidth - 40, 1120);
  const chartH = Math.max(window.innerHeight - 270, 300);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "white", borderRadius: 7, boxShadow: "0 8px 40px rgba(0,0,0,0.28)", width: W, maxHeight: window.innerHeight - 40, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── Заголовок ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid #e5e7eb", background: "linear-gradient(180deg,#f0f6ff,#e8f0fb)", flexShrink: 0 }}>
          <Icon name="TrendingDown" size={16} style={{ color: "#2563eb" }} />
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>Депрессиограмма</span>
          {points.length > 1 && (
            <span style={{ fontSize: 11, background: "#dbeafe", color: "#1d4ed8", borderRadius: 12, padding: "2px 10px", fontWeight: 600 }}>
              h = {totalDep.toFixed(1)} Па · L = {totalLength.toFixed(0)} м · {points.length - 1} вет.
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 24, height: 24, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "#6b7280", lineHeight: 1 }}>×</button>
        </div>

        {/* ── Панель управления ── */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
          {/* Переключатель режима */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRight: "1px solid #e5e7eb" }}>
            <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Маршрут:</span>
            <button onClick={() => handleModeChange("auto")}
              style={{ padding: "3px 12px", fontSize: 11, fontWeight: 600, borderRadius: 4, border: "1px solid", cursor: "pointer",
                background: mode === "auto" ? "#2563eb" : "#f1f5f9",
                color: mode === "auto" ? "white" : "#374151",
                borderColor: mode === "auto" ? "#1d4ed8" : "#d1d5db" }}>
              Авто
            </button>
            <button onClick={() => handleModeChange("manual")}
              style={{ padding: "3px 12px", fontSize: 11, fontWeight: 600, borderRadius: 4, border: "1px solid", cursor: "pointer",
                background: mode === "manual" ? "#7c3aed" : "#f1f5f9",
                color: mode === "manual" ? "white" : "#374151",
                borderColor: mode === "manual" ? "#6d28d9" : "#d1d5db" }}>
              Ручной
            </button>
            {mode === "manual" && (
              <span style={{ fontSize: 10.5, color: pickMode ? "#7c3aed" : "#6b7280", fontWeight: 600 }}>
                {pickMode
                  ? `✦ Кликайте по ветвям на схеме (${manualBranchIds.size} вет.)`
                  : `${manualBranchIds.size} ветвей выбрано`}
              </span>
            )}
            {mode === "manual" && manualBranchIds.size > 0 && (
              <button onClick={onClearManual}
                style={{ padding: "2px 8px", fontSize: 10, color: "#ef4444", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 3, cursor: "pointer" }}>
                Сбросить
              </button>
            )}
          </div>

          {/* Вкладки */}
          {(["chart", "table"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ padding: "7px 16px", fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "#2563eb" : "#374151",
                borderBottom: activeTab === tab ? "2px solid #2563eb" : "2px solid transparent",
                background: "transparent", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5 }}>
              <Icon name={tab === "chart" ? "BarChart2" : "Table"} size={13} />
              {tab === "chart" ? "График" : "Таблица"}
            </button>
          ))}
        </div>

        {/* ── Тело ── */}
        <div style={{ flex: 1, overflow: "auto", padding: activeTab === "chart" ? "10px 10px 0" : 0, minHeight: 0 }}>
          {mode === "manual" && manualBranchIds.size === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 10 }}>
              <Icon name="MousePointer" size={38} style={{ color: "#7c3aed" }} />
              <div style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>Выберите ветви маршрута на схеме</div>
              <div style={{ fontSize: 12, maxWidth: 380, textAlign: "center", lineHeight: 1.6, color: "#6b7280" }}>
                Кликайте по выработкам прямо на схеме, чтобы добавить их в маршрут депрессиограммы.<br />
                Повторный клик убирает ветвь из маршрута.
              </div>
              <div style={{ padding: "5px 16px", background: "#f3e8ff", borderRadius: 20, fontSize: 11, color: "#7c3aed", fontWeight: 600 }}>
                Диалог можно сдвинуть — схема остаётся активной
              </div>
            </div>
          ) : points.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 8 }}>
              <Icon name="AlertCircle" size={32} style={{ color: "#f59e0b" }} />
              <div style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>Маршрут не найден</div>
              <div style={{ fontSize: 12, maxWidth: 380, textAlign: "center", lineHeight: 1.5, color: "#6b7280" }}>
                Убедитесь, что выполнен расчёт сети (F9), есть ветвь ВГП и поверхностный узел.
              </div>
            </div>
          ) : activeTab === "chart" ? (
            <DepressogramChart points={points} width={W - 22} height={chartH} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  {["Нач. узел", "Кон. узел", "Название выработки", "Номер", "Длина, м", "ΔP, Па", "Напор, Па"].map(h => (
                    <th key={h} style={{ padding: "5px 8px", textAlign: h === "Название выработки" ? "left" : "right", fontWeight: 600, color: "#374151", borderBottom: "2px solid #cbd5e1", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.03em", position: "sticky", top: 0, background: "#f1f5f9" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => {
                  const prev = i > 0 ? points[i - 1] : null;
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8faff", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: "#475569" }}>{prev ? (prev.nodeNumber || prev.nodeId) : "—"}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600, color: "#475569" }}>{p.nodeNumber || p.nodeId}</td>
                      <td style={{ padding: "4px 8px", color: "#1e293b" }}>{p.branchName || (i === 0 ? "(начало маршрута)" : "—")}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#94a3b8" }}>{p.branchNumber ?? ""}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#374151" }}>{p.cumulativeLength.toFixed(2)}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#ef4444", fontWeight: 500 }}>{p.dP > 0 ? `−${p.dP.toFixed(2)}` : "—"}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#2563eb", fontWeight: 700 }}>{p.pressure.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Футер ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "#6b7280" }}>
            {mode === "auto"
              ? "Авто: наибольший расход от ВГП до поверхности без перемычек"
              : `Ручной: ${manualBranchIds.size} ветв. · кликайте по схеме для добавления/удаления`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {points.length > 1 && (
              <button onClick={handleExport}
                style={{ padding: "5px 14px", fontSize: 12, fontWeight: 500, background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer" }}>
                Экспорт в Excel
              </button>
            )}
            <button onClick={onClose}
              style={{ padding: "5px 18px", fontSize: 12, fontWeight: 600, background: "#2563eb", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
