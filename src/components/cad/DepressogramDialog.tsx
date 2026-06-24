import React, { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { TopoNode, TopoBranch } from "@/lib/topology";

// ─────────────────────────────────────────────────────────────────────────────
// Депрессиограмма — график изменения напора вдоль главного маршрута
// (от ВГП до поверхности). Маршрут выбирается автоматически по наибольшему
// расходу воздуха без перемычек.
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
}

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  onClose: () => void;
  onExportExcel?: (points: DepressogramPoint[]) => void;
  onHighlightPath?: (branchIds: string[]) => void;
}

// ─── Алгоритм поиска главного маршрута ───────────────────────────────────────
// Главный маршрут: от узла-ВГП (ветвь с hasFan && fanType === "ГВУ")
// до поверхностного узла (atmosphereLink === true), без перемычек,
// по пути с максимальным расходом воздуха.
function findMainRoute(
  nodes: TopoNode[],
  branches: TopoBranch[]
): { path: string[]; branchPath: string[] } | null {
  // 1. Находим все ветви с ВГП
  const fanBranches = branches.filter(b => b.hasFan && b.fanType === "ГВУ" && !b.fanStopped);
  if (fanBranches.length === 0) {
    // Если нет ВГП — берём любой вентилятор
    const anyFan = branches.find(b => b.hasFan && !b.fanStopped);
    if (!anyFan) return null;
    fanBranches.push(anyFan);
  }

  // 2. Стартовый узел — тот конец ветви-вентилятора, откуда воздух уходит в шахту
  // (fromId ветви ВГП — сторона шахты, toId — поверхность или наоборот)
  // Определяем по знаку flow: если flow > 0, воздух идёт от from к to
  const surfaceNodeIds = new Set(nodes.filter(n => n.atmosphereLink).map(n => n.id));

  // Берём ветвь с наибольшим расходом
  const mainFan = fanBranches.reduce((a, b) =>
    Math.abs(b.flow ?? 0) > Math.abs(a.flow ?? 0) ? b : a
  );

  // Определяем стартовый узел шахты (сторона без поверхности)
  let startNodeId: string;
  if (surfaceNodeIds.has(mainFan.toId)) {
    startNodeId = mainFan.fromId;
  } else if (surfaceNodeIds.has(mainFan.fromId)) {
    startNodeId = mainFan.toId;
  } else {
    // Стартуем от узла с большим расходом входящего воздуха
    startNodeId = mainFan.fromId;
  }

  // 3. BFS/Greedy: идём по ветвям с наибольшим расходом, исключая перемычки
  // пока не дойдём до поверхностного узла
  const visited = new Set<string>();
  const nodePath: string[] = [startNodeId];
  const branchPath: string[] = [];

  // Строим индекс смежности
  const adj: Map<string, { branchId: string; neighborId: string; flow: number; hasBulkhead: boolean }[]> = new Map();
  for (const b of branches) {
    if (!adj.has(b.fromId)) adj.set(b.fromId, []);
    if (!adj.has(b.toId)) adj.set(b.toId, []);
    adj.get(b.fromId)!.push({ branchId: b.id, neighborId: b.toId, flow: Math.abs(b.flow ?? 0), hasBulkhead: b.hasBulkhead });
    adj.get(b.toId)!.push({ branchId: b.id, neighborId: b.fromId, flow: Math.abs(b.flow ?? 0), hasBulkhead: b.hasBulkhead });
  }

  let current = startNodeId;
  visited.add(current);

  const MAX_STEPS = 500;
  let steps = 0;

  while (!surfaceNodeIds.has(current) && steps < MAX_STEPS) {
    steps++;
    const neighbors = adj.get(current) ?? [];
    // Выбираем соседа с наибольшим расходом, не посещённого, без перемычки
    const candidates = neighbors
      .filter(n => !visited.has(n.neighborId) && !n.hasBulkhead)
      .sort((a, b) => b.flow - a.flow);

    if (candidates.length === 0) {
      // Если нет кандидатов без перемычек — пробуем с перемычками
      const fallback = neighbors
        .filter(n => !visited.has(n.neighborId))
        .sort((a, b) => b.flow - a.flow);
      if (fallback.length === 0) break;
      const next = fallback[0];
      visited.add(next.neighborId);
      nodePath.push(next.neighborId);
      branchPath.push(next.branchId);
      current = next.neighborId;
    } else {
      const next = candidates[0];
      visited.add(next.neighborId);
      nodePath.push(next.neighborId);
      branchPath.push(next.branchId);
      current = next.neighborId;
    }
  }

  if (nodePath.length < 2) return null;
  return { path: nodePath, branchPath };
}

// ─── Построение точек депрессиограммы ────────────────────────────────────────
function buildDepressogramPoints(
  nodePath: string[],
  branchPath: string[],
  nodes: TopoNode[],
  branches: TopoBranch[]
): DepressogramPoint[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const branchMap = new Map(branches.map(b => [b.id, b]));

  const points: DepressogramPoint[] = [];
  let cumLen = 0;
  // Начальное давление — давление на первом узле (берём от computedPressure или 0)
  // Давление строим как суммарное падение напора от старта
  // pressure[i] = pressure[i-1] - dP_ветви[i]  (напор падает по пути от ВГП к поверхности)

  // Первая точка — начальный узел (ВГП, давление = сумма dP всего маршрута)
  // Считаем суммарный напор сначала
  let totalPressure = 0;
  for (const bId of branchPath) {
    const b = branchMap.get(bId);
    if (b) totalPressure += Math.abs(b.dP ?? 0);
  }

  let pressure = totalPressure;
  const firstNode = nodeMap.get(nodePath[0]);
  points.push({
    nodeId: nodePath[0],
    nodeName: firstNode?.name ?? nodePath[0],
    nodeNumber: firstNode?.number ?? "",
    branchId: null,
    branchName: "",
    branchNumber: null,
    cumulativeLength: 0,
    pressure,
  });

  for (let i = 0; i < branchPath.length; i++) {
    const bId = branchPath[i];
    const b = branchMap.get(bId);
    const nextNodeId = nodePath[i + 1];
    const nextNode = nodeMap.get(nextNodeId);

    cumLen += b?.length ?? 0;
    pressure -= Math.abs(b?.dP ?? 0);

    points.push({
      nodeId: nextNodeId,
      nodeName: nextNode?.name ?? nextNodeId,
      nodeNumber: nextNode?.number ?? "",
      branchId: bId,
      branchName: b?.name ?? bId,
      branchNumber: b ? String(b.id) : null,
      cumulativeLength: Math.round(cumLen * 100) / 100,
      pressure: Math.round(pressure * 100) / 100,
    });
  }

  return points;
}

// ─── SVG-График ──────────────────────────────────────────────────────────────
function DepressogramChart({
  points,
  width,
  height,
}: {
  points: DepressogramPoint[];
  width: number;
  height: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const padL = 52, padR = 20, padT = 16, padB = 36;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const maxLen = Math.max(...points.map(p => p.cumulativeLength), 1);
  const maxP = Math.max(...points.map(p => p.pressure), 1);
  const minP = Math.min(...points.map(p => p.pressure), 0);
  const pRange = maxP - minP || 1;

  const toX = (l: number) => padL + (l / maxLen) * W;
  const toY = (p: number) => padT + ((maxP - p) / pRange) * H;

  // Сетка
  const xTicks = 8;
  const yTicks = 6;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.cumulativeLength).toFixed(1)} ${toY(p.pressure).toFixed(1)}`)
    .join(" ");

  return (
    <svg width={width} height={height} style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Сетка Y */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = minP + (pRange * i) / yTicks;
        const y = toY(val);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={padL + W} y2={y} stroke="#e5e7eb" strokeWidth={1} />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#6b7280">
              {val.toFixed(1)}
            </text>
          </g>
        );
      })}

      {/* Сетка X */}
      {Array.from({ length: xTicks + 1 }, (_, i) => {
        const val = (maxLen * i) / xTicks;
        const x = toX(val);
        return (
          <g key={i}>
            <line x1={x} y1={padT} x2={x} y2={padT + H} stroke="#e5e7eb" strokeWidth={1} />
            <text x={x} y={padT + H + 14} textAnchor="middle" fontSize={9} fill="#6b7280">
              {Math.round(val)}
            </text>
          </g>
        );
      })}

      {/* Оси */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + H} stroke="#9ca3af" strokeWidth={1} />
      <line x1={padL} y1={padT + H} x2={padL + W} y2={padT + H} stroke="#9ca3af" strokeWidth={1} />

      {/* Подписи осей */}
      <text x={padL - 38} y={padT + H / 2} textAnchor="middle" fontSize={10} fill="#374151"
        transform={`rotate(-90, ${padL - 38}, ${padT + H / 2})`}>Напор, Па</text>
      <text x={padL + W / 2} y={height - 2} textAnchor="middle" fontSize={10} fill="#374151">Длина, м</text>

      {/* Нулевая линия */}
      {minP < 0 && (
        <line x1={padL} y1={toY(0)} x2={padL + W} y2={toY(0)} stroke="#d1d5db" strokeWidth={1} strokeDasharray="3,3" />
      )}

      {/* Линия графика */}
      <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={2} strokeLinejoin="round" />

      {/* Точки и подписи номеров узлов */}
      {points.map((p, i) => {
        const x = toX(p.cumulativeLength);
        const y = toY(p.pressure);
        const isHov = hovered === i;
        return (
          <g key={i}>
            <circle
              cx={x} cy={y} r={isHov ? 5 : 3.5}
              fill={isHov ? "#1d4ed8" : "#2563eb"}
              stroke="white" strokeWidth={1.5}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
            {p.nodeNumber && (
              <text x={x} y={y - 6} textAnchor="middle" fontSize={8} fill="#374151" fontWeight={500}>
                {p.nodeNumber}
              </text>
            )}
          </g>
        );
      })}

      {/* Tooltip при наведении */}
      {hovered !== null && (() => {
        const p = points[hovered];
        const x = toX(p.cumulativeLength);
        const y = toY(p.pressure);
        const tipW = 160, tipH = 50;
        const tx = Math.min(x + 8, padL + W - tipW - 4);
        const ty = Math.max(y - tipH - 4, padT);
        return (
          <g>
            <rect x={tx} y={ty} width={tipW} height={tipH} rx={4}
              fill="#1e293b" opacity={0.92} />
            <text x={tx + 8} y={ty + 14} fontSize={9.5} fill="white" fontWeight={600}>
              Узел {p.nodeNumber}: {p.nodeName.slice(0, 20)}
            </text>
            <text x={tx + 8} y={ty + 27} fontSize={9} fill="#cbd5e1">
              Длина: {p.cumulativeLength.toFixed(1)} м
            </text>
            <text x={tx + 8} y={ty + 41} fontSize={9} fill="#93c5fd">
              Напор: {p.pressure.toFixed(2)} Па
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ─── Основной диалог ─────────────────────────────────────────────────────────
export default function DepressogramDialog({
  nodes,
  branches,
  onClose,
  onHighlightPath,
}: Props) {
  const [activeTab, setActiveTab] = useState<"chart" | "table">("chart");
  const [showNodeNumbers, setShowNodeNumbers] = useState(true);

  const route = useMemo(() => findMainRoute(nodes, branches), [nodes, branches]);

  const points = useMemo(() => {
    if (!route) return [];
    return buildDepressogramPoints(route.path, route.branchPath, nodes, branches);
  }, [route, nodes, branches]);

  const totalLength = points.length > 0 ? points[points.length - 1].cumulativeLength : 0;
  const totalDep = points.length > 0 ? points[0].pressure : 0;

  // Подсвечиваем маршрут на схеме
  React.useEffect(() => {
    if (route && onHighlightPath) {
      onHighlightPath(route.branchPath);
    }
    return () => {
      if (onHighlightPath) onHighlightPath([]);
    };
  }, [route]);

  const handleExportExcel = () => {
    // Формируем CSV и скачиваем
    const header = ["Начальный узел", "Конечный узел", "Название выработки", "Номер", "Длина, м", "Напор, Па"].join("\t");
    const rows = points.map((p, i) => {
      const prevNode = i > 0 ? (points[i - 1].nodeNumber || points[i - 1].nodeId) : "";
      const curNode = p.nodeNumber || p.nodeId;
      return [prevNode, curNode, p.branchName, p.branchNumber ?? "", p.cumulativeLength.toFixed(2), p.pressure.toFixed(2)].join("\t");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "депрессиограмма.xls";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 6,
          boxShadow: "0 8px 40px rgba(0,0,0,0.28)",
          width: Math.min(window.innerWidth - 40, 1100),
          maxHeight: window.innerHeight - 60,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Заголовок */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", borderBottom: "1px solid #e5e7eb",
          background: "linear-gradient(180deg,#f8faff,#eef2fb)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="TrendingDown" size={16} style={{ color: "#2563eb" }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>Депрессиограмма</span>
            {totalDep > 0 && (
              <span style={{
                marginLeft: 8, fontSize: 11, background: "#dbeafe", color: "#1d4ed8",
                borderRadius: 12, padding: "2px 8px", fontWeight: 600,
              }}>
                h = {totalDep.toFixed(1)} Па · L = {totalLength.toFixed(0)} м · {points.length - 1} вет.
              </span>
            )}
          </div>
          <button onClick={onClose}
            style={{ width: 24, height: 24, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "#6b7280", borderRadius: 4 }}
            className="hover:bg-gray-100">×</button>
        </div>

        {/* Вкладки */}
        <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
          {([["chart", "График", "BarChart2"], ["table", "Таблица", "Table"]] as const).map(([id, label, icon]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{
                padding: "6px 16px", fontSize: 12, fontWeight: activeTab === id ? 600 : 400,
                color: activeTab === id ? "#2563eb" : "#374151",
                borderBottom: activeTab === id ? "2px solid #2563eb" : "2px solid transparent",
                background: "transparent", border: "none", borderBottom: activeTab === id ? "2px solid #2563eb" : "2px solid transparent",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}>
              <Icon name={icon} size={13} />
              {label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {/* Опции */}
          {activeTab === "chart" && (
            <label style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 12px", fontSize: 11, color: "#6b7280", cursor: "pointer" }}>
              <input type="checkbox" checked={showNodeNumbers} onChange={e => setShowNodeNumbers(e.target.checked)} />
              Номера узлов
            </label>
          )}
        </div>

        {/* Тело */}
        <div style={{ flex: 1, overflow: "auto", padding: 12, minHeight: 0 }}>
          {points.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 8, color: "#6b7280" }}>
              <Icon name="AlertCircle" size={32} style={{ color: "#f59e0b" }} />
              <div style={{ fontWeight: 600, fontSize: 14 }}>Главный маршрут не найден</div>
              <div style={{ fontSize: 12, maxWidth: 380, textAlign: "center", lineHeight: 1.5 }}>
                Убедитесь, что расчёт вентиляционной сети выполнен (F9) и в схеме есть ветвь с вентилятором главного проветривания (ВГП) и поверхностный узел.
              </div>
            </div>
          ) : activeTab === "chart" ? (
            <DepressogramChart
              points={points}
              width={Math.min(window.innerWidth - 80, 1060)}
              height={Math.max(window.innerHeight - 220, 320)}
            />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", position: "sticky", top: 0 }}>
                  {["Нач. узел", "Кон. узел", "Название выработки", "Номер", "Длина, м", "Напор, Па"].map(h => (
                    <th key={h} style={{ padding: "5px 8px", textAlign: h === "Название выработки" ? "left" : "right", fontWeight: 600, color: "#374151", borderBottom: "1px solid #cbd5e1", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => {
                  const prev = i > 0 ? points[i - 1] : null;
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "white" : "#f8faff", borderBottom: "1px solid #f1f5f9" }}
                      className="hover:bg-blue-50">
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#374151", fontWeight: 500 }}>
                        {prev ? prev.nodeNumber : "—"}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#374151", fontWeight: 500 }}>
                        {p.nodeNumber}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "left", color: "#1e293b" }}>
                        {p.branchName || (i === 0 ? "(начало маршрута)" : "—")}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#6b7280" }}>
                        {p.branchNumber ?? ""}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#374151" }}>
                        {p.cumulativeLength.toFixed(2)}
                      </td>
                      <td style={{ padding: "4px 8px", textAlign: "right", color: "#2563eb", fontWeight: 600 }}>
                        {p.pressure.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Футер */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", borderTop: "1px solid #e5e7eb", background: "#f9fafb",
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: "#6b7280" }}>
            Маршрут: автоматически (наибольший расход от ВГП до поверхности)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleExportExcel}
              style={{ padding: "5px 14px", fontSize: 12, fontWeight: 500, background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: 4, cursor: "pointer" }}>
              Экспорт в Excel
            </button>
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
