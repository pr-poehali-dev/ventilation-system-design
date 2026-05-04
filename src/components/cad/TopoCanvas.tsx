import { useEffect, useRef, useState, useCallback } from "react";
import {
  type TopoNode, type TopoBranch, type ProjOptions,
  project3D, unproject2D, calcBranchLength,
} from "@/lib/topology";

// ─────────────────────────────────────────────────────────────────────────────
// Интерактивный CAD-холст для построения топологии
// (план-вид с координатами X/Y, цветовая индикация Z)
// ─────────────────────────────────────────────────────────────────────────────

export type CadTool = "select" | "node" | "branch" | "pan";

interface Props {
  nodes: TopoNode[];
  branches: TopoBranch[];
  selectedNodeId: string | null;
  selectedBranchId: string | null;
  tool: CadTool;
  onNodeAdd: (x: number, y: number, z: number) => void;
  onNodeMove: (id: string, x: number, y: number) => void;
  onBranchAdd: (fromId: string, toId: string) => void;
  onSelectNode: (id: string | null) => void;
  onSelectBranch: (id: string | null) => void;
  zLevel: number;       // текущий уровень Z (для создания узлов на этой отметке)
}

export default function TopoCanvas(props: Props) {
  const {
    nodes, branches, selectedNodeId, selectedBranchId, tool,
    onNodeAdd, onNodeMove, onBranchAdd, onSelectNode, onSelectBranch, zLevel,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Видовые параметры (panning + zoom)
  const [view, setView] = useState({ scale: 0.4, offsetX: 400, offsetY: 300 });
  const [panStart, setPanStart] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Адаптивный размер контейнера
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const proj: ProjOptions = { scale: view.scale, offsetX: view.offsetX, offsetY: view.offsetY, isoAngle: 0, zScale: 0 };

  // Проектируем все узлы
  const projNodes = nodes.map((n) => ({ node: n, ...project3D(n, proj) }));

  // ─── Обработчики мыши ──────────────────────────────────────────────────
  const screenToWorld = useCallback((sx: number, sy: number) => {
    return unproject2D(sx, sy, proj, 0);
  }, [proj]);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button === 1 || (tool === "pan" && e.button === 0)) {
      // Панорамирование колесом мыши или инструментом pan
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
      e.preventDefault();
      return;
    }
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (tool === "node") {
      const w = screenToWorld(sx, sy);
      onNodeAdd(Math.round(w.x), Math.round(w.y), zLevel);
      return;
    }

    // Иначе: проверяем, попали ли в узел
    const hit = hitNode(sx, sy, projNodes);
    if (hit) {
      if (tool === "branch") {
        if (!branchFrom) {
          setBranchFrom(hit);
          onSelectNode(hit);
        } else if (branchFrom !== hit) {
          onBranchAdd(branchFrom, hit);
          setBranchFrom(null);
        }
        return;
      }
      onSelectNode(hit);
      onSelectBranch(null);
      setDraggingNode(hit);
      return;
    }

    // Попадание в ветвь?
    const branchHit = hitBranch(sx, sy, projNodes, branches);
    if (branchHit) {
      onSelectBranch(branchHit);
      onSelectNode(null);
      return;
    }

    // Клик в пустоту — снять выбор и начать панорамирование
    onSelectNode(null);
    onSelectBranch(null);
    setBranchFrom(null);
    setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = screenToWorld(sx, sy);
    setHoverPos({ x: Math.round(w.x), y: Math.round(w.y) });

    if (panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setView({ ...view, offsetX: panStart.ox + dx, offsetY: panStart.oy + dy });
      return;
    }
    if (draggingNode) {
      onNodeMove(draggingNode, Math.round(w.x), Math.round(w.y));
    }
  };

  const onMouseUp = () => {
    setPanStart(null);
    setDraggingNode(null);
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.05, Math.min(10, view.scale * factor));
    // Зум вокруг точки курсора
    const wx = (sx - view.offsetX) / view.scale;
    const wy = (sy - view.offsetY) / view.scale;
    setView({
      scale: newScale,
      offsetX: sx - wx * newScale,
      offsetY: sy - wy * newScale,
    });
  };

  // Расчёт цвета по Z (синий — глубоко, жёлтый — на поверхности)
  const zColor = (z: number) => {
    const minZ = -300, maxZ = 0;
    const t = Math.max(0, Math.min(1, (z - minZ) / (maxZ - minZ)));
    const hue = 220 - t * 180; // 220 (синий) → 40 (оранжевый)
    return `hsl(${hue}, 70%, 50%)`;
  };

  // Превью линейки координат
  const tickStep = view.scale > 1 ? 50 : view.scale > 0.3 ? 100 : 500;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden"
      style={{ background: "#ffffff", cursor: tool === "node" ? "crosshair" : tool === "pan" || panStart ? "grabbing" : "default" }}>

      <svg width={size.w} height={size.h}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}>

        {/* ─── СЕТКА ─────────────────────────────────────────────────────── */}
        <defs>
          <pattern id="topo-grid-minor" width={20 * view.scale} height={20 * view.scale} patternUnits="userSpaceOnUse"
            x={view.offsetX % (20 * view.scale)} y={view.offsetY % (20 * view.scale)}>
            <path d={`M ${20 * view.scale} 0 L 0 0 0 ${20 * view.scale}`} fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
          </pattern>
          <pattern id="topo-grid-major" width={100 * view.scale} height={100 * view.scale} patternUnits="userSpaceOnUse"
            x={view.offsetX % (100 * view.scale)} y={view.offsetY % (100 * view.scale)}>
            <rect width={100 * view.scale} height={100 * view.scale} fill="url(#topo-grid-minor)" />
            <path d={`M ${100 * view.scale} 0 L 0 0 0 ${100 * view.scale}`} fill="none" stroke="#dcdcdc" strokeWidth="0.8" />
          </pattern>
          <marker id="topo-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="7" markerHeight="7" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
          </marker>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#topo-grid-major)" />

        {/* ─── ОСИ КООРДИНАТ (через начало 0,0) ──────────────────────────── */}
        <line x1={view.offsetX} y1={0} x2={view.offsetX} y2={size.h}
          stroke="#22c55e" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
        <line x1={0} y1={view.offsetY} x2={size.w} y2={view.offsetY}
          stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
        <text x={view.offsetX + 4} y={12} fontSize="10" fill="#22c55e" fontFamily="Segoe UI">+Y</text>
        <text x={size.w - 16} y={view.offsetY - 4} fontSize="10" fill="#ef4444" fontFamily="Segoe UI">+X</text>

        {/* ─── ВЕТВИ (рисуем СНАЧАЛА, чтобы узлы были поверх) ───────────── */}
        {branches.map((b) => {
          const from = projNodes.find((p) => p.node.id === b.fromId);
          const to = projNodes.find((p) => p.node.id === b.toId);
          if (!from || !to) return null;
          const isSel = selectedBranchId === b.id;
          const midX = (from.sx + to.sx) / 2;
          const midY = (from.sy + to.sy) / 2;
          const len = b.length || Math.round(calcBranchLength(from.node, to.node));

          return (
            <g key={b.id}>
              <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                stroke={isSel ? "#2563eb" : "#1f2937"}
                strokeWidth={isSel ? 3 : 2}
                markerEnd="url(#topo-arrow)" />
              {/* Ярлык длины */}
              {view.scale > 0.15 && (
                <g transform={`translate(${midX},${midY})`}>
                  <rect x={-22} y={-9} width={44} height={14} rx="2"
                    fill="white" stroke={isSel ? "#2563eb" : "#9ca3af"} strokeWidth="0.8" />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontFamily="Segoe UI" fill="#1f2937">
                    {len} м
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ─── ПРЕДВЬЮ СОЗДАНИЯ ВЕТВИ ─────────────────────────────────── */}
        {tool === "branch" && branchFrom && hoverPos && (() => {
          const from = projNodes.find((p) => p.node.id === branchFrom);
          if (!from) return null;
          const to = project3D({ x: hoverPos.x, y: hoverPos.y, z: zLevel }, proj);
          return (
            <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
              stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.7" />
          );
        })()}

        {/* ─── УЗЛЫ ───────────────────────────────────────────────────── */}
        {projNodes.map(({ node, sx, sy }) => {
          const isSel = selectedNodeId === node.id;
          const isBranchFrom = branchFrom === node.id;
          const r = isSel ? 7 : 5;
          const color = node.atmosphereLink ? "#fbbf24" : zColor(node.z);
          return (
            <g key={node.id} transform={`translate(${sx},${sy})`}>
              {(isSel || isBranchFrom) && (
                <circle r={r + 5} fill="none" stroke="#2563eb" strokeWidth="1.2" strokeDasharray="3 2" />
              )}
              <circle r={r} fill={color} stroke="#1f2937" strokeWidth={isSel ? 2 : 1} />
              {node.atmosphereLink && (
                <text textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="bold" fill="#1f2937">A</text>
              )}
              {/* Подпись: номер + название */}
              <g transform="translate(8, -8)">
                <text fontSize="10" fontFamily="Segoe UI" fontWeight="600" fill="#1f2937">
                  {node.number}
                </text>
                {view.scale > 0.25 && node.name && (
                  <text y="11" fontSize="9" fontFamily="Segoe UI" fill="#6b7280">
                    {node.name}
                  </text>
                )}
              </g>
              {/* Z-отметка */}
              {view.scale > 0.2 && (
                <text x="0" y={r + 12} textAnchor="middle" fontSize="8" fontFamily="Segoe UI" fill="#9ca3af">
                  Z={node.z}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* ─── ИНДИКАТОРЫ КООРДИНАТ И МАСШТАБА ─────────────────────────── */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
        {hoverPos && <>X: {hoverPos.x} м · Y: {hoverPos.y} м · Z: {zLevel} м</>}
      </div>
      <div className="absolute bottom-1 right-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
        Шаг сетки: {tickStep} м · Масштаб: 1:{Math.round(1 / view.scale)}
      </div>

      {/* Подсказка по инструменту */}
      {tool === "node" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white", boxShadow: "0 2px 4px rgba(0,0,0,.15)" }}>
          ✚ Клик на холсте — создать узел на отметке Z = {zLevel} м
        </div>
      )}
      {tool === "branch" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white", boxShadow: "0 2px 4px rgba(0,0,0,.15)" }}>
          {branchFrom ? "Выберите второй узел для создания ветви" : "Выберите начальный узел ветви"}
        </div>
      )}
    </div>
  );
}

// ─── Утилиты попадания мышью ────────────────────────────────────────────────

function hitNode(sx: number, sy: number, projNodes: { node: TopoNode; sx: number; sy: number }[]): string | null {
  for (let i = projNodes.length - 1; i >= 0; i--) {
    const p = projNodes[i];
    const dx = sx - p.sx;
    const dy = sy - p.sy;
    if (dx * dx + dy * dy < 64) return p.node.id;
  }
  return null;
}

function hitBranch(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number }[],
  branches: TopoBranch[]): string | null {
  for (const b of branches) {
    const from = projNodes.find((p) => p.node.id === b.fromId);
    const to = projNodes.find((p) => p.node.id === b.toId);
    if (!from || !to) continue;
    // Расстояние от точки до отрезка
    const A = sx - from.sx, B = sy - from.sy;
    const C = to.sx - from.sx, D = to.sy - from.sy;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, dot / lenSq));
    const px = from.sx + t * C, py = from.sy + t * D;
    const dist = Math.hypot(sx - px, sy - py);
    if (dist < 5) return b.id;
  }
  return null;
}
