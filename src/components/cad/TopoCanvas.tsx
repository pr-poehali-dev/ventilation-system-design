import { useEffect, useRef, useState, useCallback } from "react";
import {
  type TopoNode, type TopoBranch, type ProjOptions, type ViewPreset,
  project3D, unproject2D, calcBranchLength, VIEW_PRESETS,
} from "@/lib/topology";

// ─────────────────────────────────────────────────────────────────────────────
// Интерактивный CAD-холст для построения топологии
// 2D (план) + 3D с произвольным ракурсом
// ─────────────────────────────────────────────────────────────────────────────

export type CadTool = "select" | "node" | "branch" | "pan" | "rotate";

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
  zLevel: number;
  /** Сигнал применения пресета ракурса (смена nonce = триггер) */
  viewPreset?: { name: ViewPreset; nonce: number } | null;
  /** Сообщить наверх о смене режима 2D/3D */
  onViewChange?: (info: { is3D: boolean; azimuth: number; elevation: number }) => void;
}

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
  azimuth: number;     // °
  elevation: number;   // °
}

export default function TopoCanvas(props: Props) {
  const {
    nodes, branches, selectedNodeId, selectedBranchId, tool,
    onNodeAdd, onNodeMove, onBranchAdd, onSelectNode, onSelectBranch, zLevel,
    viewPreset, onViewChange,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Видовые параметры (panning + zoom + rotate)
  const [view, setView] = useState<ViewState>({
    scale: 0.4, offsetX: 400, offsetY: 300,
    azimuth: 0, elevation: 90,    // план по умолчанию
  });

  const is3D = view.elevation < 89.5 || view.azimuth !== 0;

  const [panStart, setPanStart] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [rotStart, setRotStart] = useState<{ x: number; y: number; az: number; el: number } | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Применение пресета ракурса извне
  useEffect(() => {
    if (!viewPreset) return;
    const p = VIEW_PRESETS[viewPreset.name];
    setView((v) => ({ ...v, azimuth: p.azimuth, elevation: p.elevation }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewPreset?.nonce]);

  // Сообщить наверх об изменении вида
  useEffect(() => {
    onViewChange?.({
      is3D: view.elevation < 89.5 || view.azimuth !== 0,
      azimuth: view.azimuth,
      elevation: view.elevation,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.azimuth, view.elevation]);

  const proj: ProjOptions = {
    scale: view.scale,
    offsetX: view.offsetX,
    offsetY: view.offsetY,
    azimuth: view.azimuth,
    elevation: view.elevation,
  };

  const projNodes = nodes.map((n) => ({ node: n, ...project3D(n, proj) }));

  // Применить пресет ракурса
  const applyPreset = useCallback((preset: ViewPreset) => {
    const p = VIEW_PRESETS[preset];
    setView((v) => ({ ...v, azimuth: p.azimuth, elevation: p.elevation }));
  }, []);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    return unproject2D(sx, sy, proj, zLevel);
  }, [proj, zLevel]);

  // ─── Обработчики мыши ───────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Правая кнопка или tool=rotate → вращение в 3D
    if (e.button === 2 || tool === "rotate") {
      setRotStart({ x: e.clientX, y: e.clientY, az: view.azimuth, el: view.elevation });
      e.preventDefault();
      return;
    }
    // Средняя кнопка / Shift / tool=pan → панорама
    if (e.button === 1 || e.shiftKey || tool === "pan") {
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
      e.preventDefault();
      return;
    }

    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (tool === "node") {
      // Добавление узла возможно только на плане (иначе неоднозначно)
      if (is3D) return;
      const w = screenToWorld(sx, sy);
      onNodeAdd(Math.round(w.x), Math.round(w.y), zLevel);
      return;
    }

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
      // Перетаскивание узла — только в 2D
      if (!is3D) setDraggingNode(hit);
      return;
    }

    const branchHit = hitBranch(sx, sy, projNodes, branches);
    if (branchHit) {
      onSelectBranch(branchHit);
      onSelectNode(null);
      return;
    }

    onSelectNode(null);
    onSelectBranch(null);
    setBranchFrom(null);
    // Свободный клик в 3D = вращение, в 2D = панорама
    if (is3D) {
      setRotStart({ x: e.clientX, y: e.clientY, az: view.azimuth, el: view.elevation });
    } else {
      setPanStart({ x: e.clientX, y: e.clientY, ox: view.offsetX, oy: view.offsetY });
    }
  };

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (!is3D) {
      const w = screenToWorld(sx, sy);
      setHoverPos({ x: Math.round(w.x), y: Math.round(w.y) });
    } else {
      setHoverPos(null);
    }

    if (rotStart) {
      const dx = e.clientX - rotStart.x;
      const dy = e.clientY - rotStart.y;
      const newAz = rotStart.az + dx * 0.5;     // 0.5°/px
      const newEl = Math.max(0, Math.min(90, rotStart.el - dy * 0.5));
      setView((v) => ({ ...v, azimuth: newAz, elevation: newEl }));
      return;
    }
    if (panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setView((v) => ({ ...v, offsetX: panStart.ox + dx, offsetY: panStart.oy + dy }));
      return;
    }
    if (draggingNode && !is3D) {
      const w = screenToWorld(sx, sy);
      onNodeMove(draggingNode, Math.round(w.x), Math.round(w.y));
    }
  };

  const onMouseUp = () => {
    setPanStart(null);
    setRotStart(null);
    setDraggingNode(null);
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.max(0.05, Math.min(10, view.scale * factor));
    const wx = (sx - view.offsetX) / view.scale;
    const wy = (sy - view.offsetY) / view.scale;
    setView({
      ...view,
      scale: newScale,
      offsetX: sx - wx * newScale,
      offsetY: sy - wy * newScale,
    });
  };

  // ─── Вспомогательные ────────────────────────────────────────────────────
  const zColor = (z: number) => {
    const minZ = -300, maxZ = 0;
    const t = Math.max(0, Math.min(1, (z - minZ) / (maxZ - minZ)));
    const hue = 220 - t * 180;
    return `hsl(${hue}, 70%, 50%)`;
  };

  // Сортировка ветвей по средней глубине (painter's алгоритм)
  const branchesSorted = [...branches].map((b) => {
    const from = projNodes.find((p) => p.node.id === b.fromId);
    const to = projNodes.find((p) => p.node.id === b.toId);
    const depth = from && to ? (from.depth + to.depth) / 2 : 0;
    return { branch: b, depth };
  }).sort((a, b) => a.depth - b.depth);

  const nodesSorted = [...projNodes].sort((a, b) => a.depth - b.depth);

  // Сетка плоскости (план z=0)
  const renderGroundGrid = () => {
    if (!is3D) return null;
    const step = 500;          // м
    const range = 3000;        // от -range до +range
    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (let x = -range; x <= range; x += step) {
      const a = project3D({ x, y: -range, z: 0 }, proj);
      const b = project3D({ x, y: range, z: 0 }, proj);
      lines.push({ x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy, key: `gx${x}` });
    }
    for (let y = -range; y <= range; y += step) {
      const a = project3D({ x: -range, y, z: 0 }, proj);
      const b = project3D({ x: range, y, z: 0 }, proj);
      lines.push({ x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy, key: `gy${y}` });
    }
    // Тройка осей в начале
    const O = project3D({ x: 0, y: 0, z: 0 }, proj);
    const Xa = project3D({ x: 500, y: 0, z: 0 }, proj);
    const Ya = project3D({ x: 0, y: 500, z: 0 }, proj);
    const Za = project3D({ x: 0, y: 0, z: 500 }, proj);
    return (
      <g>
        {lines.map((l) => (
          <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke="#d4d4d4" strokeWidth="0.6" opacity="0.7" />
        ))}
        <line x1={O.sx} y1={O.sy} x2={Xa.sx} y2={Xa.sy} stroke="#ef4444" strokeWidth="2" />
        <line x1={O.sx} y1={O.sy} x2={Ya.sx} y2={Ya.sy} stroke="#22c55e" strokeWidth="2" />
        <line x1={O.sx} y1={O.sy} x2={Za.sx} y2={Za.sy} stroke="#3b82f6" strokeWidth="2" />
        <text x={Xa.sx + 4} y={Xa.sy} fontSize="10" fill="#ef4444">X</text>
        <text x={Ya.sx + 4} y={Ya.sy} fontSize="10" fill="#22c55e">Y</text>
        <text x={Za.sx + 4} y={Za.sy} fontSize="10" fill="#3b82f6">Z</text>
      </g>
    );
  };

  // Вертикальные «направляющие» от узлов до пола (z=0) — для понимания глубины
  const renderDepthLines = () => {
    if (!is3D) return null;
    return (
      <g>
        {projNodes.map(({ node, sx, sy }) => {
          if (node.z === 0 || node.atmosphereLink) return null;
          const ground = project3D({ x: node.x, y: node.y, z: 0 }, proj);
          return (
            <line key={`dl${node.id}`} x1={sx} y1={sy} x2={ground.sx} y2={ground.sy}
              stroke="#9ca3af" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
          );
        })}
      </g>
    );
  };

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden"
      style={{
        background: is3D ? "linear-gradient(to bottom, #f0f4f8 0%, #ffffff 60%, #f5f5f5 100%)" : "#ffffff",
        cursor: rotStart ? "grabbing" : panStart ? "grabbing"
          : tool === "node" ? "crosshair"
          : tool === "rotate" ? "grab"
          : tool === "pan" ? "grab" : "default",
      }}>

      <svg width={size.w} height={size.h}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}>

        <defs>
          {/* 2D-сетка */}
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

        {!is3D && <rect width={size.w} height={size.h} fill="url(#topo-grid-major)" />}
        {is3D && renderGroundGrid()}

        {/* Оси для 2D */}
        {!is3D && (<>
          <line x1={view.offsetX} y1={0} x2={view.offsetX} y2={size.h}
            stroke="#22c55e" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
          <line x1={0} y1={view.offsetY} x2={size.w} y2={view.offsetY}
            stroke="#ef4444" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
          <text x={view.offsetX + 4} y={12} fontSize="10" fill="#22c55e">+Y</text>
          <text x={size.w - 16} y={view.offsetY - 4} fontSize="10" fill="#ef4444">+X</text>
        </>)}

        {is3D && renderDepthLines()}

        {/* ─── ВЕТВИ (отсортированы по глубине) ────────────────────────── */}
        {branchesSorted.map(({ branch: b }) => {
          const from = projNodes.find((p) => p.node.id === b.fromId);
          const to = projNodes.find((p) => p.node.id === b.toId);
          if (!from || !to) return null;
          const isSel = selectedBranchId === b.id;
          const reversed = b.flow < 0;
          const sx1 = reversed ? to.sx : from.sx;
          const sy1 = reversed ? to.sy : from.sy;
          const sx2 = reversed ? from.sx : to.sx;
          const sy2 = reversed ? from.sy : to.sy;
          const midX = (from.sx + to.sx) / 2;
          const midY = (from.sy + to.sy) / 2;
          const len = b.length || Math.round(calcBranchLength(from.node, to.node));
          const Q = Math.abs(b.flow);
          const overV = b.velocity > b.vMax;
          const color = isSel ? "#2563eb" : b.hasFan ? "#7c3aed" : overV ? "#dc2626" : Q > 0 ? "#0369a1" : "#1f2937";
          const w = isSel ? 3 : Q > 100 ? 3 : Q > 30 ? 2.5 : 2;

          return (
            <g key={b.id}>
              <line x1={sx1} y1={sy1} x2={sx2} y2={sy2}
                stroke={color} strokeWidth={w}
                markerEnd="url(#topo-arrow)" />
              {b.hasFan && (
                <g transform={`translate(${midX},${midY - 18})`}>
                  <circle r="8" fill="#ede9fe" stroke="#7c3aed" strokeWidth="1.2" />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="11" fontWeight="bold" fill="#7c3aed">⚙</text>
                </g>
              )}
              {view.scale > 0.15 && !is3D && (
                <g transform={`translate(${midX},${midY})`}>
                  <rect x={-32} y={-12} width={64} height={Q > 0 ? 24 : 14} rx="2"
                    fill="white" stroke={isSel ? "#2563eb" : "#9ca3af"} strokeWidth="0.8" />
                  <text textAnchor="middle" dominantBaseline="middle" y={Q > 0 ? -3 : 0}
                    fontSize="9" fill="#1f2937">{b.id} · {len}м</text>
                  {Q > 0 && (
                    <text textAnchor="middle" dominantBaseline="middle" y="7"
                      fontSize="9" fontWeight="600"
                      fill={overV ? "#dc2626" : "#0369a1"}>
                      Q={Q.toFixed(1)} м³/с
                    </text>
                  )}
                </g>
              )}
              {/* В 3D — компактная подпись только при выборе */}
              {is3D && isSel && (
                <g transform={`translate(${midX},${midY})`}>
                  <rect x={-26} y={-9} width={52} height={14} rx="2"
                    fill="white" stroke="#2563eb" strokeWidth="0.8" />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontWeight="600" fill="#2563eb">{b.id}</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Превью создания ветви */}
        {tool === "branch" && branchFrom && hoverPos && !is3D && (() => {
          const from = projNodes.find((p) => p.node.id === branchFrom);
          if (!from) return null;
          const to = project3D({ x: hoverPos.x, y: hoverPos.y, z: zLevel }, proj);
          return (
            <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
              stroke="#2563eb" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.7" />
          );
        })()}

        {/* ─── УЗЛЫ (отсортированы по глубине, ближние сверху) ─────────── */}
        {nodesSorted.map(({ node, sx, sy }) => {
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
              <g transform="translate(8, -8)">
                <text fontSize="10" fontWeight="600" fill="#1f2937">{node.number}</text>
                {view.scale > 0.25 && node.name && !is3D && (
                  <text y="11" fontSize="9" fill="#6b7280">{node.name}</text>
                )}
              </g>
              {view.scale > 0.2 && !is3D && (
                <text x="0" y={r + 12} textAnchor="middle" fontSize="8" fill="#9ca3af">Z={node.z}</text>
              )}
              {view.scale > 0.25 && node.computedPressure > 0 && !node.atmosphereLink && !is3D && (
                <g transform={`translate(8, ${node.name ? 22 : 12})`}>
                  <text fontSize="9" fontWeight="600" fill="#0369a1">
                    P={(node.computedPressure / 1000).toFixed(1)} кПа
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── ViewCube в углу (3D-индикатор ориентации) ─────────────── */}
        <ViewCube
          x={size.w - 70} y={20}
          azimuth={view.azimuth} elevation={view.elevation}
          onPick={applyPreset}
        />
      </svg>

      {/* Индикаторы */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
        {is3D ? (
          <>3D · Az: {view.azimuth.toFixed(0)}° · El: {view.elevation.toFixed(0)}°</>
        ) : (
          hoverPos && <>X: {hoverPos.x} м · Y: {hoverPos.y} м · Z: {zLevel} м</>
        )}
      </div>
      <div className="absolute bottom-1 right-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
        Масштаб: 1:{Math.round(1 / view.scale)}
      </div>

      {/* Подсказка */}
      {tool === "node" && !is3D && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white" }}>
          ✚ Клик на холсте — создать узел на отметке Z = {zLevel} м
        </div>
      )}
      {tool === "node" && is3D && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#dc2626", color: "white" }}>
          ⚠ Создание узлов доступно только в 2D-плане. Перейдите в вид «План».
        </div>
      )}
      {tool === "branch" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white" }}>
          {branchFrom ? "Выберите второй узел" : "Выберите начальный узел ветви"}
        </div>
      )}
      {tool === "rotate" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#7c3aed", color: "white" }}>
          🔄 Драг — вращение камеры (Az/El)
        </div>
      )}
    </div>
  );
}

// ─── ViewCube: индикатор/переключатель ракурсов ────────────────────────────
function ViewCube({ x, y, azimuth, elevation, onPick }: {
  x: number; y: number; azimuth: number; elevation: number; onPick: (p: ViewPreset) => void;
}) {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const proj = (px: number, py: number, pz: number) => {
    const x1 = Math.cos(az) * px + Math.sin(az) * py;
    const y1 = -Math.sin(az) * px + Math.cos(az) * py;
    const y2 = Math.sin(el) * y1 - Math.cos(el) * pz;
    return { sx: x1, sy: -y2 };
  };
  const s = 18;  // полу-сторона куба
  // 8 вершин куба
  const verts = [
    proj(-s, -s, -s), proj(s, -s, -s), proj(s, s, -s), proj(-s, s, -s),
    proj(-s, -s,  s), proj(s, -s,  s), proj(s, s,  s), proj(-s, s,  s),
  ];
  // 6 граней (топ/бот/фронт/бэк/лев/прав), порядок вершин CCW
  const faces: { idx: [number, number, number, number]; preset: ViewPreset; color: string; label: string }[] = [
    { idx: [4, 5, 6, 7], preset: "plan",   color: "#fde68a", label: "ПЛАН" },
    { idx: [0, 3, 2, 1], preset: "plan",   color: "#fef3c7", label: "" },     // низ
    { idx: [0, 1, 5, 4], preset: "front",  color: "#bfdbfe", label: "ФРНТ" },
    { idx: [2, 3, 7, 6], preset: "back",   color: "#dbeafe", label: "ТЫЛ" },
    { idx: [0, 4, 7, 3], preset: "left",   color: "#bbf7d0", label: "ЛЕВ" },
    { idx: [1, 2, 6, 5], preset: "right",  color: "#d1fae5", label: "ПРАВ" },
  ];
  // Сортировка граней по средней Z (примитивный hidden-faces)
  const facesWithDepth = faces.map((f) => {
    const cx = (verts[f.idx[0]].sx + verts[f.idx[2]].sx) / 2;
    const cy = (verts[f.idx[0]].sy + verts[f.idx[2]].sy) / 2;
    return { ...f, cx, cy };
  });

  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-26} y={-26} width={52} height={52} fill="white" fillOpacity="0.7" stroke="#9ca3af" rx="4" />
      {facesWithDepth.map((f, i) => {
        const pts = f.idx.map((vi) => `${verts[vi].sx},${verts[vi].sy}`).join(" ");
        const cx = f.idx.reduce((a, vi) => a + verts[vi].sx, 0) / 4;
        const cy = f.idx.reduce((a, vi) => a + verts[vi].sy, 0) / 4;
        return (
          <g key={i} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick(f.preset); }}>
            <polygon points={pts} fill={f.color} stroke="#374151" strokeWidth="0.8" />
            {f.label && (
              <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7" fontWeight="600" fill="#1f2937"
                style={{ pointerEvents: "none" }}>
                {f.label}
              </text>
            )}
          </g>
        );
      })}
      {/* Изо-уголки */}
      <circle cx={20} cy={-20} r="4" fill="#a78bfa" stroke="#374151" strokeWidth="0.6"
        style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick("isoSE"); }} />
      <circle cx={-20} cy={-20} r="4" fill="#a78bfa" stroke="#374151" strokeWidth="0.6"
        style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick("isoSW"); }} />
    </g>
  );
}

// ─── Утилиты попадания ─────────────────────────────────────────────────────
function hitNode(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[]): string | null {
  for (let i = projNodes.length - 1; i >= 0; i--) {
    const p = projNodes[i];
    const dx = sx - p.sx;
    const dy = sy - p.sy;
    if (dx * dx + dy * dy < 64) return p.node.id;
  }
  return null;
}

function hitBranch(sx: number, sy: number,
  projNodes: { node: TopoNode; sx: number; sy: number; depth: number }[],
  branches: TopoBranch[]): string | null {
  for (const b of branches) {
    const from = projNodes.find((p) => p.node.id === b.fromId);
    const to = projNodes.find((p) => p.node.id === b.toId);
    if (!from || !to) continue;
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