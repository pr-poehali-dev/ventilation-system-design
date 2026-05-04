import { useState, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";

// ─── Типы ───────────────────────────────────────────────────────────────────

type NodeType = "junction" | "supply" | "exhaust" | "fan";

interface VentNode {
  id: string;
  x: number;
  y: number;
  type: NodeType;
  label: string;
}

interface VentBranch {
  id: string;
  from: string;
  to: string;
  diameter: number;
  length: number;
  resistance?: number;
}

interface CalcResult {
  branchId: string;
  flowRate: number;
  velocity: number;
  pressureDrop: number;
}

// ─── Константы ──────────────────────────────────────────────────────────────

const NODE_RADIUS = 18;
const COLORS: Record<NodeType, string> = {
  junction: "#3b82f6",
  supply: "#10b981",
  exhaust: "#ef4444",
  fan: "#f59e0b",
};

// ─── Расчётный модуль ───────────────────────────────────────────────────────

function calcResistance(branch: VentBranch): number {
  const d = branch.diameter / 1000;
  const area = Math.PI * d * d / 4;
  const rho = 1.2;
  const lambda = 0.02;
  const R = lambda * branch.length / d * rho / (2 * area * area * 3600 * 3600);
  return R + (branch.resistance ?? 0);
}

function solveNetwork(nodes: VentNode[], branches: VentBranch[]): CalcResult[] {
  if (nodes.length < 2 || branches.length === 0) return [];
  const supplyNodes = nodes.filter((n) => n.type === "supply" || n.type === "fan");
  const totalSupply = supplyNodes.length > 0 ? 1000 * supplyNodes.length : 500;

  return branches.map((br) => {
    const r = calcResistance(br);
    const flow = totalSupply / branches.length;
    const d = br.diameter / 1000;
    const area = Math.PI * d * d / 4;
    const velocity = (flow / 3600) / area;
    const dP = r * flow * flow;
    return {
      branchId: br.id,
      flowRate: Math.round(flow),
      velocity: Math.round(velocity * 10) / 10,
      pressureDrop: Math.round(dP),
    };
  });
}

// ─── Инструменты ────────────────────────────────────────────────────────────

type Tool = "select" | "node-junction" | "node-supply" | "node-exhaust" | "node-fan" | "branch" | "delete";

const TOOLS: { id: Tool; icon: string; label: string; color?: string }[] = [
  { id: "select", icon: "MousePointer2", label: "Выбор" },
  { id: "node-supply", icon: "ArrowUp", label: "Приток", color: "#10b981" },
  { id: "node-exhaust", icon: "ArrowDown", label: "Вытяжка", color: "#ef4444" },
  { id: "node-junction", icon: "Circle", label: "Узел", color: "#3b82f6" },
  { id: "node-fan", icon: "Gauge", label: "Вентилятор", color: "#f59e0b" },
  { id: "branch", icon: "Minus", label: "Ветвь" },
  { id: "delete", icon: "Trash2", label: "Удалить" },
];

const NODE_LABELS: Record<NodeType, string[]> = {
  supply: ["П1","П2","П3","П4","П5"],
  exhaust: ["В1","В2","В3","В4","В5"],
  junction: ["У1","У2","У3","У4","У5"],
  fan: ["Вент1","Вент2","Вент3"],
};

// ─── Главный компонент ───────────────────────────────────────────────────────

export default function Index() {
  const [nodes, setNodes] = useState<VentNode[]>([
    { id: "N1", x: 200, y: 260, type: "supply", label: "П1" },
    { id: "N2", x: 440, y: 260, type: "junction", label: "У1" },
    { id: "N3", x: 660, y: 200, type: "exhaust", label: "В1" },
    { id: "N4", x: 660, y: 340, type: "exhaust", label: "В2" },
  ]);
  const [branches, setBranches] = useState<VentBranch[]>([
    { id: "B1", from: "N1", to: "N2", diameter: 200, length: 8 },
    { id: "B2", from: "N2", to: "N3", diameter: 160, length: 5 },
    { id: "B3", from: "N2", to: "N4", diameter: 160, length: 6 },
  ]);

  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [branchStart, setBranchStart] = useState<string | null>(null);
  const [calcResults, setCalcResults] = useState<CalcResult[]>([]);
  const [activeTab, setActiveTab] = useState<"properties" | "results">("properties");

  const svgRef = useRef<SVGSVGElement>(null);
  const counterRef = useRef({ node: 5, branch: 4 });
  const typeCounters = useRef<Record<NodeType, number>>({ supply: 2, exhaust: 3, junction: 2, fan: 1 });

  const getSVGPoint = useCallback((e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const snap = (v: number) => Math.round(v / 20) * 20;

  // Клик по холсту — добавление узла
  const handleSVGClick = useCallback((e: React.MouseEvent) => {
    if (dragging) return;
    const { x, y } = getSVGPoint(e);
    if (!tool.startsWith("node-")) {
      if (tool === "select") setSelected(null);
      return;
    }
    const typeMap: Record<string, NodeType> = {
      "node-junction": "junction", "node-supply": "supply",
      "node-exhaust": "exhaust", "node-fan": "fan",
    };
    const type = typeMap[tool];
    const id = `N${counterRef.current.node++}`;
    const cnt = typeCounters.current[type]++;
    const label = type === "supply" ? `П${cnt}` : type === "exhaust" ? `В${cnt}` : type === "junction" ? `У${cnt}` : `Вент${cnt}`;
    setNodes((prev) => [...prev, { id, x: snap(x), y: snap(y), type, label }]);
    setSelected(id);
  }, [tool, dragging, getSVGPoint]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (tool === "delete") {
      setNodes((p) => p.filter((n) => n.id !== id));
      setBranches((p) => p.filter((b) => b.from !== id && b.to !== id));
      setSelected(null);
      return;
    }
    if (tool === "branch") {
      if (!branchStart) { setBranchStart(id); return; }
      if (branchStart !== id) {
        const bid = `B${counterRef.current.branch++}`;
        setBranches((p) => [...p, { id: bid, from: branchStart, to: id, diameter: 160, length: 5 }]);
        setBranchStart(null);
        setSelected(bid);
      }
      return;
    }
    if (tool === "select") {
      setSelected(id);
      const node = nodes.find((n) => n.id === id);
      if (node) {
        const { x, y } = getSVGPoint(e);
        setDragging({ id, ox: x - node.x, oy: y - node.y });
      }
    }
  }, [tool, branchStart, nodes, getSVGPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const { x, y } = getSVGPoint(e);
    setNodes((p) => p.map((n) => n.id === dragging.id ? { ...n, x: snap(x - dragging.ox), y: snap(y - dragging.oy) } : n));
  }, [dragging, getSVGPoint]);

  const handleBranchClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (tool === "delete") { setBranches((p) => p.filter((b) => b.id !== id)); setSelected(null); }
    else if (tool === "select") setSelected(id);
  }, [tool]);

  const runCalculation = () => {
    const results = solveNetwork(nodes, branches);
    setCalcResults(results);
    setActiveTab("results");
  };

  const selectedNode = nodes.find((n) => n.id === selected);
  const selectedBranch = branches.find((b) => b.id === selected);
  const selectedResult = calcResults.find((r) => r.branchId === selected);

  const updateNode = (field: keyof VentNode, value: string | number) =>
    setNodes((p) => p.map((n) => n.id === selected ? { ...n, [field]: value } : n));

  const updateBranch = (field: keyof VentBranch, value: string | number) =>
    setBranches((p) => p.map((b) => b.id === selected ? { ...b, [field]: value } : b));

  const getBranchMid = (br: VentBranch) => {
    const f = nodes.find((n) => n.id === br.from);
    const t = nodes.find((n) => n.id === br.to);
    if (!f || !t) return null;
    return { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2, from: f, to: t };
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "hsl(220,20%,6%)" }}>
      {/* ── Шапка ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border panel z-10 flex-shrink-0"
        style={{ background: "hsl(220,20%,9%)" }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded flex items-center justify-center text-sm font-bold font-mono"
              style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>А</div>
            <span className="font-semibold text-sm tracking-wide">АэроСхема</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ background: "hsl(220,15%,16%)", color: "hsl(215,15%,50%)" }}>v1.0</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-muted-foreground hidden md:block">Расчёт вентиляционных сетей</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono text-muted-foreground mr-2">
            {nodes.length} узл · {branches.length} ветв
          </div>
          <button onClick={runCalculation}
            className="flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-all hover:brightness-110 active:scale-95"
            style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>
            <Icon name="Play" size={12} />
            Рассчитать
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Инструменты ─────────────────────────────────────────────── */}
        <aside className="w-14 flex flex-col items-center py-4 gap-1.5 border-r border-border flex-shrink-0"
          style={{ background: "hsl(220,20%,9%)" }}>
          {TOOLS.map((t) => {
            const isActive = tool === t.id;
            return (
              <button key={t.id} title={t.label}
                onClick={() => { setTool(t.id); setBranchStart(null); }}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                style={isActive
                  ? { background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }
                  : { background: "transparent", color: t.color ?? "hsl(215,15%,55%)" }}>
                <Icon name={t.icon} size={15} />
              </button>
            );
          })}
          <div className="flex-1" />
          <button title="По центру"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
            <Icon name="Maximize2" size={14} />
          </button>
        </aside>

        {/* ── Холст ───────────────────────────────────────────────────── */}
        <main className="flex-1 relative overflow-hidden">
          {branchStart && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full text-xs font-mono animate-fade-in"
              style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", color: "hsl(210,80%,75%)" }}>
              Кликните на конечный узел ветви
            </div>
          )}

          <svg ref={svgRef}
            className="vent-canvas w-full h-full"
            onClick={handleSVGClick}
            onMouseMove={handleMouseMove}
            onMouseUp={() => setDragging(null)}
            onMouseLeave={() => setDragging(null)}
            style={{ cursor: tool === "branch" ? "crosshair" : tool === "delete" ? "not-allowed" : dragging ? "grabbing" : "default" }}>

            <defs>
              <marker id="arr" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="hsl(215,15%,40%)" />
              </marker>
              <marker id="arr-sel" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L7,3 z" fill="hsl(210,100%,56%)" />
              </marker>
              <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Ветви */}
            {branches.map((br) => {
              const m = getBranchMid(br);
              if (!m) return null;
              const isSel = selected === br.id;
              const res = calcResults.find((r) => r.branchId === br.id);

              return (
                <g key={br.id}>
                  <line x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y}
                    stroke="transparent" strokeWidth={20}
                    onClick={(e) => handleBranchClick(e, br.id)} style={{ cursor: "pointer" }} />
                  <line x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y}
                    stroke={isSel ? "hsl(210,100%,56%)" : "hsl(215,15%,32%)"}
                    strokeWidth={isSel ? 2.5 : 2}
                    markerEnd={isSel ? "url(#arr-sel)" : "url(#arr)"}
                    filter={isSel ? "url(#glow)" : undefined}
                    onClick={(e) => handleBranchClick(e, br.id)}
                    style={{ cursor: "pointer", transition: "stroke 0.15s" }} />
                  <rect x={m.x - 22} y={m.y - 9} width="44" height={res ? 20 : 16} rx="3"
                    fill="hsl(220,18%,10%)"
                    stroke={isSel ? "hsl(210,100%,56%)" : "hsl(220,15%,22%)"}
                    strokeWidth="1" />
                  <text x={m.x} y={m.y - 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontFamily="IBM Plex Mono"
                    fill={isSel ? "hsl(210,100%,70%)" : "hsl(215,15%,55%)"}>
                    {br.diameter}мм/{br.length}м
                  </text>
                  {res && (
                    <text x={m.x} y={m.y + 8} textAnchor="middle" dominantBaseline="middle"
                      fontSize="8" fontFamily="IBM Plex Mono" fill="hsl(210,100%,65%)">
                      {res.flowRate}м³/ч
                    </text>
                  )}
                </g>
              );
            })}

            {/* Узлы */}
            {nodes.map((node) => {
              const isSel = selected === node.id;
              const isBrFrom = branchStart === node.id;
              const color = COLORS[node.type];
              const icon = node.type === "supply" ? "▲" : node.type === "exhaust" ? "▼" : node.type === "fan" ? "⊕" : "●";

              return (
                <g key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  style={{ cursor: tool === "select" ? "grab" : "pointer" }}>
                  {(isSel || isBrFrom) && (
                    <circle r={NODE_RADIUS + 7} fill="none" stroke={color}
                      strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6">
                      <animateTransform attributeName="transform" type="rotate"
                        from="0" to="360" dur="8s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle r={NODE_RADIUS + 5} fill={color} opacity={isSel ? 0.12 : 0.05} />
                  <circle r={NODE_RADIUS}
                    fill={isSel ? color : `${color}1a`}
                    stroke={color}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    filter={isSel ? "url(#glow)" : undefined}
                    style={{ transition: "all 0.15s" }} />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="13" fill={isSel ? "hsl(220,20%,8%)" : color} fontWeight="600">
                    {icon}
                  </text>
                  <text x="0" y={NODE_RADIUS + 13} textAnchor="middle" dominantBaseline="middle"
                    fontSize="10" fontFamily="IBM Plex Mono"
                    fill={isSel ? color : "hsl(215,15%,60%)"} fontWeight={isSel ? "600" : "400"}>
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Легенда */}
          <div className="absolute bottom-4 left-4 flex gap-4 animate-fade-in">
            {(Object.entries(COLORS) as [NodeType, string][]).map(([type, color]) => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                <span className="text-xs" style={{ color: "hsl(215,15%,55%)" }}>
                  {type === "junction" ? "Узел" : type === "supply" ? "Приток" : type === "exhaust" ? "Вытяжка" : "Вентилятор"}
                </span>
              </div>
            ))}
          </div>
        </main>

        {/* ── Правая панель ───────────────────────────────────────────── */}
        <aside className="w-72 flex flex-col border-l border-border flex-shrink-0"
          style={{ background: "hsl(220,20%,9%)" }}>
          {/* Вкладки */}
          <div className="flex border-b border-border flex-shrink-0">
            {(["properties", "results"] as const).map((tab) => (
              <button key={tab}
                onClick={() => setActiveTab(tab)}
                className="flex-1 py-3 text-xs font-medium transition-colors relative"
                style={activeTab === tab ? { color: "hsl(210,100%,65%)" } : { color: "hsl(215,15%,50%)" }}>
                {tab === "properties" ? "Свойства" : "Результаты"}
                {activeTab === tab && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ background: "hsl(210,100%,56%)" }} />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {/* Свойства */}
            {activeTab === "properties" && (
              <div className="animate-fade-in space-y-5">
                {!selected && (
                  <div className="text-center py-10">
                    <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                      style={{ background: "hsl(220,15%,14%)" }}>
                      <Icon name="MousePointer2" size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">Выберите элемент</p>
                    <p className="text-xs mt-1" style={{ color: "hsl(215,15%,40%)" }}>для просмотра свойств</p>
                  </div>
                )}

                {selectedNode && (
                  <>
                    <div className="flex items-center gap-2.5 pb-3 border-b border-border">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                        style={{ background: `${COLORS[selectedNode.type]}22`, color: COLORS[selectedNode.type] }}>
                        {selectedNode.type === "supply" ? "▲" : selectedNode.type === "exhaust" ? "▼" : selectedNode.type === "fan" ? "⊕" : "●"}
                      </div>
                      <div>
                        <p className="text-sm font-mono font-semibold">{selectedNode.id}</p>
                        <p className="text-xs" style={{ color: COLORS[selectedNode.type] }}>
                          {selectedNode.type === "junction" ? "Узел" : selectedNode.type === "supply" ? "Приточный" : selectedNode.type === "exhaust" ? "Вытяжной" : "Вентилятор"}
                        </p>
                      </div>
                    </div>
                    <PropField label="Метка" value={selectedNode.label} onChange={(v) => updateNode("label", v)} />
                    <div className="grid grid-cols-2 gap-3">
                      <PropField label="X" value={String(selectedNode.x)} onChange={(v) => updateNode("x", Number(v))} type="number" />
                      <PropField label="Y" value={String(selectedNode.y)} onChange={(v) => updateNode("y", Number(v))} type="number" />
                    </div>
                  </>
                )}

                {selectedBranch && (
                  <>
                    <div className="flex items-center gap-2.5 pb-3 border-b border-border">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: "hsl(220,15%,16%)", color: "hsl(215,15%,60%)" }}>
                        <Icon name="Minus" size={14} />
                      </div>
                      <div>
                        <p className="text-sm font-mono font-semibold">{selectedBranch.id}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {selectedBranch.from} → {selectedBranch.to}
                        </p>
                      </div>
                    </div>
                    <PropField label="Диаметр, мм" value={String(selectedBranch.diameter)}
                      onChange={(v) => updateBranch("diameter", Number(v))} type="number" />
                    <PropField label="Длина, м" value={String(selectedBranch.length)}
                      onChange={(v) => updateBranch("length", Number(v))} type="number" />
                    <PropField label="Доп. сопротивление" value={String(selectedBranch.resistance ?? 0)}
                      onChange={(v) => updateBranch("resistance", Number(v))} type="number" />

                    {selectedResult && (
                      <div className="pt-3 border-t border-border space-y-2">
                        <p className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>Результат</p>
                        <ResBadge label="Расход" value={`${selectedResult.flowRate} м³/ч`} color="#3b82f6" />
                        <ResBadge label="Скорость" value={`${selectedResult.velocity} м/с`} color="#10b981" />
                        <ResBadge label="Потери давл." value={`${selectedResult.pressureDrop} Па`} color="#f59e0b" />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Результаты */}
            {activeTab === "results" && (
              <div className="animate-fade-in">
                {calcResults.length === 0 ? (
                  <div className="text-center py-10">
                    <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                      style={{ background: "hsl(220,15%,14%)" }}>
                      <Icon name="Calculator" size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">Нет данных расчёта</p>
                    <button onClick={runCalculation}
                      className="mt-4 px-5 py-2 rounded-md text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
                      style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>
                      Рассчитать сеть
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <SumCard label="Узлов" value={String(nodes.length)} icon="Circle" color="#3b82f6" />
                      <SumCard label="Ветвей" value={String(branches.length)} icon="Minus" color="#64748b" />
                      <SumCard label="Расход ср."
                        value={`${Math.round(calcResults.reduce((s, r) => s + r.flowRate, 0) / calcResults.length)} м³/ч`}
                        icon="Wind" color="#10b981" />
                      <SumCard label="ΔP макс."
                        value={`${Math.max(...calcResults.map((r) => r.pressureDrop))} Па`}
                        icon="TrendingUp" color="#f59e0b" />
                    </div>

                    <table className="w-full results-table">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 pr-2">Ветвь</th>
                          <th className="text-right py-2 px-1">м³/ч</th>
                          <th className="text-right py-2 px-1">м/с</th>
                          <th className="text-right py-2 pl-1">Па</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calcResults.map((res) => (
                          <tr key={res.branchId}
                            onClick={() => { setSelected(res.branchId); setActiveTab("properties"); }}
                            className="border-b border-border cursor-pointer hover:bg-muted transition-colors"
                            style={selected === res.branchId ? { background: "hsl(220,15%,14%)" } : {}}>
                            <td className="py-2 pr-2 text-xs font-mono" style={{ color: "hsl(210,100%,65%)" }}>
                              {res.branchId}
                            </td>
                            <td className="py-2 px-1 text-right text-xs font-mono">{res.flowRate}</td>
                            <td className="py-2 px-1 text-right text-xs font-mono">
                              <span style={{ color: res.velocity > 8 ? "#f59e0b" : res.velocity > 5 ? "#10b981" : "inherit" }}>
                                {res.velocity}
                              </span>
                            </td>
                            <td className="py-2 pl-1 text-right text-xs font-mono">
                              <span style={{ color: res.pressureDrop > 15 ? "#f59e0b" : "inherit" }}>
                                {res.pressureDrop}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="text-xs pt-1" style={{ color: "hsl(215,15%,40%)" }}>
                      Кирхгоф · λ=0.02 · ρ=1.2 кг/м³
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Быстрое добавление */}
          <div className="border-t border-border p-3 flex-shrink-0">
            <p className="text-xs uppercase tracking-wider mb-2.5" style={{ color: "hsl(215,15%,45%)" }}>Добавить</p>
            <div className="flex gap-1.5 flex-wrap">
              {(["supply", "exhaust", "junction", "fan"] as NodeType[]).map((type) => (
                <button key={type}
                  onClick={() => { setTool(`node-${type}` as Tool); setBranchStart(null); }}
                  className="px-2.5 py-1 rounded text-xs font-medium transition-all hover:brightness-110 active:scale-95"
                  style={{
                    background: `${COLORS[type]}18`,
                    border: `1px solid ${COLORS[type]}40`,
                    color: COLORS[type],
                  }}>
                  {type === "supply" ? "Приток" : type === "exhaust" ? "Вытяжка" : type === "junction" ? "Узел" : "Вентил."}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Вспомогательные компоненты ──────────────────────────────────────────────

function PropField({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider block mb-1.5" style={{ color: "hsl(215,15%,45%)" }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md text-sm font-mono focus:outline-none transition-colors"
        style={{
          background: "hsl(220,15%,13%)",
          border: "1px solid hsl(220,15%,22%)",
          color: "hsl(210,20%,90%)",
        }}
        onFocus={(e) => e.target.style.borderColor = "hsl(210,100%,56%)"}
        onBlur={(e) => e.target.style.borderColor = "hsl(220,15%,22%)"} />
    </div>
  );
}

function ResBadge({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md"
      style={{ background: `${color}0f`, border: `1px solid ${color}25` }}>
      <span className="text-xs" style={{ color: "hsl(215,15%,55%)" }}>{label}</span>
      <span className="text-xs font-mono font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function SumCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon name={icon} size={10} style={{ color: "hsl(215,15%,50%)" }} />
        <span className="text-xs" style={{ color: "hsl(215,15%,50%)" }}>{label}</span>
      </div>
      <span className="text-sm font-mono font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}