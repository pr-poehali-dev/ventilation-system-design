import { useState, useRef, useCallback, useMemo } from "react";
import Icon from "@/components/ui/icon";
import {
  BIBLIOTECA_KMS, crossMethod, recommendDiameter,
  STANDARD_DIAMETERS,
  type DuctShape, type DuctParams, type LocalResistance,
  type NetworkNode, type NetworkBranch, type CrossResult, type BranchCalc,
} from "@/lib/aero";

// ─── Типы UI ────────────────────────────────────────────────────────────────

type NodeType = "junction" | "supply" | "exhaust" | "fan";

interface VentNode {
  id: string;
  x: number;
  y: number;
  type: NodeType;
  label: string;
  fixedFlow?: number;
}

interface VentBranch {
  id: string;
  from: string;
  to: string;
  params: DuctParams;
}

const NODE_RADIUS = 18;
const COLORS: Record<NodeType, string> = {
  junction: "#3b82f6",
  supply: "#10b981",
  exhaust: "#ef4444",
  fan: "#f59e0b",
};

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

// ─── Главный компонент ───────────────────────────────────────────────────────

export default function Index() {
  const [nodes, setNodes] = useState<VentNode[]>([
    { id: "N1", x: 200, y: 260, type: "supply", label: "П1", fixedFlow: 1000 },
    { id: "N2", x: 440, y: 260, type: "junction", label: "У1" },
    { id: "N3", x: 660, y: 200, type: "exhaust", label: "В1", fixedFlow: 500 },
    { id: "N4", x: 660, y: 340, type: "exhaust", label: "В2", fixedFlow: 500 },
  ]);
  const [branches, setBranches] = useState<VentBranch[]>([
    { id: "B1", from: "N1", to: "N2", params: { shape: "round", diameter: 200, length: 8, localResistances: [{ type: "elbow_90_round", zeta: 0.21, count: 1 }] } },
    { id: "B2", from: "N2", to: "N3", params: { shape: "round", diameter: 160, length: 5, localResistances: [{ type: "tee_branch", zeta: 1.5, count: 1 }, { type: "grille_supply", zeta: 2, count: 1 }] } },
    { id: "B3", from: "N2", to: "N4", params: { shape: "round", diameter: 160, length: 6, localResistances: [{ type: "tee_branch", zeta: 1.5, count: 1 }, { type: "grille_supply", zeta: 2, count: 1 }] } },
  ]);

  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [branchStart, setBranchStart] = useState<string | null>(null);
  const [calcResult, setCalcResult] = useState<CrossResult | null>(null);
  const [activeTab, setActiveTab] = useState<"properties" | "results" | "kms">("properties");
  const [showKmsPicker, setShowKmsPicker] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const counterRef = useRef({ node: 5, branch: 4 });
  const typeCounters = useRef<Record<NodeType, number>>({ supply: 2, exhaust: 3, junction: 2, fan: 1 });

  const getSVGPoint = useCallback((e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const snap = (v: number) => Math.round(v / 20) * 20;

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
    const fixedFlow = type === "supply" ? 1000 : type === "exhaust" ? 500 : type === "fan" ? 2000 : undefined;
    setNodes((prev) => [...prev, { id, x: snap(x), y: snap(y), type, label, fixedFlow }]);
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
        setBranches((p) => [...p, {
          id: bid, from: branchStart, to: id,
          params: { shape: "round", diameter: 160, length: 5, localResistances: [] }
        }]);
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

  // ─── Расчёт по методу Кросса ─────────────────────────────────────────────

  const runCalculation = () => {
    const nNodes: NetworkNode[] = nodes.map((n) => ({
      id: n.id, type: n.type, fixedFlow: n.fixedFlow,
    }));
    const nBranches: NetworkBranch[] = branches.map((b) => ({
      id: b.id, from: b.from, to: b.to, params: b.params,
    }));
    const result = crossMethod(nNodes, nBranches, { maxIter: 100, tolerance: 0.5 });
    setCalcResult(result);
    setActiveTab("results");
  };

  const selectedNode = nodes.find((n) => n.id === selected);
  const selectedBranch = branches.find((b) => b.id === selected);
  const selectedBranchCalc: BranchCalc | undefined = calcResult?.branchCalcs[selected ?? ""];
  const selectedFlow = calcResult?.branchFlows[selected ?? ""];

  const updateNode = (field: keyof VentNode, value: string | number | undefined) =>
    setNodes((p) => p.map((n) => n.id === selected ? { ...n, [field]: value } : n));

  const updateBranchParams = (patch: Partial<DuctParams>) =>
    setBranches((p) => p.map((b) => b.id === selected ? { ...b, params: { ...b.params, ...patch } } : b));

  const addKms = (key: string) => {
    if (!selectedBranch) return;
    const item = BIBLIOTECA_KMS[key];
    if (!item) return;
    const existing = selectedBranch.params.localResistances ?? [];
    const found = existing.find((lr) => lr.type === key);
    const newList: LocalResistance[] = found
      ? existing.map((lr) => lr.type === key ? { ...lr, count: lr.count + 1 } : lr)
      : [...existing, { type: key, zeta: item.zeta, count: 1 }];
    updateBranchParams({ localResistances: newList });
  };

  const removeKms = (key: string) => {
    if (!selectedBranch) return;
    const list = (selectedBranch.params.localResistances ?? []).filter((lr) => lr.type !== key);
    updateBranchParams({ localResistances: list });
  };

  const autoSelectDiameter = () => {
    if (!selectedBranch || !selectedFlow) return;
    const d = recommendDiameter(selectedFlow, 6);
    updateBranchParams({ shape: "round", diameter: d });
  };

  const getBranchMid = (br: VentBranch) => {
    const f = nodes.find((n) => n.id === br.from);
    const t = nodes.find((n) => n.id === br.to);
    if (!f || !t) return null;
    return { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2, from: f, to: t };
  };

  const branchLabel = (b: VentBranch) =>
    b.params.shape === "round" ? `Ø${b.params.diameter}` : `${b.params.width}×${b.params.height}`;

  // ─── Сводка результатов ─────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!calcResult) return null;
    const flows = Object.values(calcResult.branchFlows);
    const calcs = Object.values(calcResult.branchCalcs);
    return {
      totalFlow: flows.reduce((s, v) => s + v, 0),
      maxV: Math.max(...calcs.map((c) => c.velocity)),
      maxDp: Math.max(...calcs.map((c) => c.dpTotal)),
      sumDp: calcs.reduce((s, c) => s + c.dpTotal, 0),
    };
  }, [calcResult]);

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "hsl(220,20%,6%)" }}>
      {/* ── Шапка ──────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-border z-10 flex-shrink-0"
        style={{ background: "hsl(220,20%,9%)" }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded flex items-center justify-center text-sm font-bold font-mono"
              style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>А</div>
            <span className="font-semibold text-sm tracking-wide">АэроСхема</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ background: "hsl(220,15%,16%)", color: "hsl(215,15%,50%)" }}>v1.1 · Кросс</span>
          </div>
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-muted-foreground hidden md:block">СП 60.13330 · метод Кросса</span>
        </div>
        <div className="flex items-center gap-2">
          {calcResult && (
            <div className="flex items-center gap-2 text-xs font-mono mr-2">
              <span className={calcResult.converged ? "text-green-400" : "text-yellow-400"}>
                {calcResult.converged ? "✓ увязано" : "⚠ невязка"}
              </span>
              <span className="text-muted-foreground">
                {calcResult.iterations} итер · Δ{calcResult.maxResidual} Па
              </span>
            </div>
          )}
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
              const flow = calcResult?.branchFlows[br.id];
              const calc = calcResult?.branchCalcs[br.id];
              const v = calc?.velocity;
              const vColor = v && v > 8 ? "#f59e0b" : v && v > 12 ? "#ef4444" : "hsl(210,100%,65%)";

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
                  <rect x={m.x - 28} y={m.y - 11} width="56" height={flow ? 24 : 18} rx="3"
                    fill="hsl(220,18%,10%)"
                    stroke={isSel ? "hsl(210,100%,56%)" : "hsl(220,15%,22%)"}
                    strokeWidth="1" />
                  <text x={m.x} y={m.y - 2} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontFamily="IBM Plex Mono"
                    fill={isSel ? "hsl(210,100%,70%)" : "hsl(215,15%,55%)"}>
                    {branchLabel(br)} · {br.params.length}м
                  </text>
                  {flow !== undefined && (
                    <text x={m.x} y={m.y + 9} textAnchor="middle" dominantBaseline="middle"
                      fontSize="8" fontFamily="IBM Plex Mono" fill={vColor}>
                      {flow}м³/ч · {v}м/с
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
                  {node.fixedFlow && (
                    <text x="0" y={NODE_RADIUS + 25} textAnchor="middle" dominantBaseline="middle"
                      fontSize="8" fontFamily="IBM Plex Mono" fill="hsl(215,15%,45%)">
                      {node.fixedFlow}м³/ч
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

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
        <aside className="w-80 flex flex-col border-l border-border flex-shrink-0"
          style={{ background: "hsl(220,20%,9%)" }}>
          <div className="flex border-b border-border flex-shrink-0">
            {([
              { id: "properties", label: "Свойства" },
              { id: "kms", label: "КМС" },
              { id: "results", label: "Расчёт" },
            ] as const).map((tab) => (
              <button key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 py-3 text-xs font-medium transition-colors relative"
                style={activeTab === tab.id ? { color: "hsl(210,100%,65%)" } : { color: "hsl(215,15%,50%)" }}>
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5"
                    style={{ background: "hsl(210,100%,56%)" }} />
                )}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {/* ── Свойства ── */}
            {activeTab === "properties" && (
              <div className="animate-fade-in space-y-4">
                {!selected && (
                  <div className="text-center py-10">
                    <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                      style={{ background: "hsl(220,15%,14%)" }}>
                      <Icon name="MousePointer2" size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">Выберите элемент</p>
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
                          {selectedNode.type === "junction" ? "Узел разветвления" : selectedNode.type === "supply" ? "Приточный" : selectedNode.type === "exhaust" ? "Вытяжной" : "Вентилятор"}
                        </p>
                      </div>
                    </div>
                    <PropField label="Метка" value={selectedNode.label} onChange={(v) => updateNode("label", v)} />
                    {selectedNode.type !== "junction" && (
                      <PropField label="Расчётный расход, м³/ч"
                        value={String(selectedNode.fixedFlow ?? "")}
                        onChange={(v) => updateNode("fixedFlow", v ? Number(v) : undefined)} type="number" />
                    )}
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
                      <div className="flex-1">
                        <p className="text-sm font-mono font-semibold">{selectedBranch.id}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {selectedBranch.from} → {selectedBranch.to}
                        </p>
                      </div>
                      {selectedFlow && (
                        <button onClick={autoSelectDiameter}
                          title="Подобрать диаметр (v=6 м/с)"
                          className="px-2 py-1 rounded text-xs font-mono hover:brightness-110"
                          style={{ background: "hsl(210,100%,56%,0.15)", color: "hsl(210,100%,70%)", border: "1px solid hsl(210,100%,56%,0.3)" }}>
                          Авто Ø
                        </button>
                      )}
                    </div>

                    {/* Форма сечения */}
                    <div>
                      <label className="text-xs uppercase tracking-wider block mb-2" style={{ color: "hsl(215,15%,45%)" }}>Сечение</label>
                      <div className="flex gap-1 mb-3">
                        {(["round", "rect"] as DuctShape[]).map((s) => (
                          <button key={s}
                            onClick={() => updateBranchParams({ shape: s })}
                            className="flex-1 py-1.5 rounded text-xs font-medium transition-all"
                            style={selectedBranch.params.shape === s
                              ? { background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }
                              : { background: "hsl(220,15%,14%)", color: "hsl(215,15%,55%)", border: "1px solid hsl(220,15%,22%)" }}>
                            {s === "round" ? "⊙ Круглое" : "▭ Прямоуг."}
                          </button>
                        ))}
                      </div>
                    </div>

                    {selectedBranch.params.shape === "round" ? (
                      <div>
                        <label className="text-xs uppercase tracking-wider block mb-1.5" style={{ color: "hsl(215,15%,45%)" }}>Диаметр, мм</label>
                        <select
                          value={selectedBranch.params.diameter ?? 200}
                          onChange={(e) => updateBranchParams({ diameter: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-md text-sm font-mono"
                          style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,22%)", color: "hsl(210,20%,90%)" }}>
                          {STANDARD_DIAMETERS.map((d) => (
                            <option key={d} value={d}>Ø{d}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <PropField label="Ширина, мм" value={String(selectedBranch.params.width ?? 200)}
                          onChange={(v) => updateBranchParams({ width: Number(v) })} type="number" />
                        <PropField label="Высота, мм" value={String(selectedBranch.params.height ?? 200)}
                          onChange={(v) => updateBranchParams({ height: Number(v) })} type="number" />
                      </div>
                    )}

                    <PropField label="Длина, м" value={String(selectedBranch.params.length)}
                      onChange={(v) => updateBranchParams({ length: Number(v) })} type="number" />

                    <PropField label="Шероховатость k, мм" value={String(selectedBranch.params.roughness ?? 0.1)}
                      onChange={(v) => updateBranchParams({ roughness: Number(v) })} type="number" />

                    {/* Список КМС */}
                    <div className="pt-3 border-t border-border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>
                          КМС ({(selectedBranch.params.localResistances ?? []).length})
                        </span>
                        <button onClick={() => setShowKmsPicker(true)}
                          className="text-xs px-2 py-0.5 rounded hover:brightness-110"
                          style={{ background: "hsl(210,100%,56%,0.15)", color: "hsl(210,100%,70%)" }}>
                          + Добавить
                        </button>
                      </div>
                      <div className="space-y-1">
                        {(selectedBranch.params.localResistances ?? []).map((lr) => {
                          const item = BIBLIOTECA_KMS[lr.type];
                          return (
                            <div key={lr.type} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs"
                              style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
                              <span className="flex-1 truncate" style={{ color: "hsl(210,20%,80%)" }}>
                                {item?.name ?? lr.type}
                              </span>
                              <span className="font-mono text-muted-foreground">×{lr.count}</span>
                              <span className="font-mono" style={{ color: "hsl(210,100%,65%)" }}>ζ={lr.zeta}</span>
                              <button onClick={() => removeKms(lr.type)}
                                className="text-muted-foreground hover:text-red-400 transition-colors">
                                <Icon name="X" size={12} />
                              </button>
                            </div>
                          );
                        })}
                        {!(selectedBranch.params.localResistances ?? []).length && (
                          <p className="text-xs text-muted-foreground italic py-2">КМС не заданы</p>
                        )}
                      </div>
                    </div>

                    {/* Результат расчёта по ветви */}
                    {selectedBranchCalc && (
                      <div className="pt-3 border-t border-border space-y-2">
                        <p className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>Результат</p>
                        <ResRow label="Расход" value={`${selectedFlow} м³/ч`} color="#3b82f6" />
                        <ResRow label="Скорость" value={`${selectedBranchCalc.velocity} м/с`} color="#10b981" />
                        <ResRow label="d экв." value={`${(selectedBranchCalc.dEq * 1000).toFixed(0)} мм`} color="#64748b" />
                        <ResRow label="Re" value={`${selectedBranchCalc.re}`} color="#64748b" />
                        <ResRow label="λ" value={`${selectedBranchCalc.lambda}`} color="#64748b" />
                        <ResRow label="R уд." value={`${selectedBranchCalc.rTrenie} Па/м`} color="#64748b" />
                        <ResRow label="ΔP трен." value={`${selectedBranchCalc.dpTrenie} Па`} color="#f59e0b" />
                        <ResRow label="Σζ" value={`${selectedBranchCalc.sumZeta}`} color="#64748b" />
                        <ResRow label="ΔP КМС" value={`${selectedBranchCalc.dpKms} Па`} color="#f59e0b" />
                        <ResRow label="ΔP полн." value={`${selectedBranchCalc.dpTotal} Па`} color="#ef4444" bold />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Библиотека КМС ── */}
            {activeTab === "kms" && (
              <div className="animate-fade-in space-y-4">
                <div className="text-xs text-muted-foreground">
                  Библиотека коэффициентов местных сопротивлений (Идельчик И.Е.).
                  {selectedBranch ? " Кликните, чтобы добавить к выбранной ветви." : " Выберите ветвь для добавления."}
                </div>
                {Object.entries(
                  Object.entries(BIBLIOTECA_KMS).reduce((acc, [k, v]) => {
                    (acc[v.group] ??= []).push([k, v]);
                    return acc;
                  }, {} as Record<string, [string, typeof BIBLIOTECA_KMS[string]][]>)
                ).map(([group, items]) => (
                  <div key={group}>
                    <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "hsl(210,100%,65%)" }}>{group}</p>
                    <div className="space-y-1">
                      {items.map(([key, item]) => (
                        <button key={key}
                          disabled={!selectedBranch}
                          onClick={() => addKms(key)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
                          style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
                          <span style={{ color: "hsl(210,20%,80%)" }}>{item.name}</span>
                          <span className="font-mono" style={{ color: "hsl(210,100%,65%)" }}>ζ={item.zeta}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Расчёт ── */}
            {activeTab === "results" && (
              <div className="animate-fade-in">
                {!calcResult ? (
                  <div className="text-center py-10">
                    <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                      style={{ background: "hsl(220,15%,14%)" }}>
                      <Icon name="Calculator" size={20} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">Нет данных расчёта</p>
                    <button onClick={runCalculation}
                      className="mt-4 px-5 py-2 rounded-md text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
                      style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>
                      Запустить расчёт
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <SumCard label="Расход Σ" value={`${summary?.totalFlow}`} unit="м³/ч" color="#3b82f6" />
                      <SumCard label="V макс." value={`${summary?.maxV}`} unit="м/с" color="#10b981" />
                      <SumCard label="ΔP макс." value={`${summary?.maxDp}`} unit="Па" color="#f59e0b" />
                      <SumCard label="ΔP Σ" value={`${Math.round(summary?.sumDp ?? 0)}`} unit="Па" color="#ef4444" />
                    </div>

                    <div className="rounded-lg p-3" style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
                      <p className="text-xs uppercase tracking-wider mb-1.5" style={{ color: "hsl(215,15%,45%)" }}>Сходимость</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className={calcResult.converged ? "text-green-400" : "text-yellow-400"}>
                          {calcResult.converged ? "Сошлось" : "Не сошлось"}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {calcResult.iterations} итераций
                        </span>
                        <span className="font-mono" style={{ color: "hsl(210,100%,65%)" }}>
                          невязка {calcResult.maxResidual} Па
                        </span>
                      </div>
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
                        {branches.map((b) => {
                          const flow = calcResult.branchFlows[b.id];
                          const calc = calcResult.branchCalcs[b.id];
                          if (!calc) return null;
                          return (
                            <tr key={b.id}
                              onClick={() => { setSelected(b.id); setActiveTab("properties"); }}
                              className="border-b border-border cursor-pointer hover:bg-muted transition-colors"
                              style={selected === b.id ? { background: "hsl(220,15%,14%)" } : {}}>
                              <td className="py-2 pr-2 text-xs font-mono" style={{ color: "hsl(210,100%,65%)" }}>
                                {b.id}
                              </td>
                              <td className="py-2 px-1 text-right text-xs font-mono">{flow}</td>
                              <td className="py-2 px-1 text-right text-xs font-mono">
                                <span style={{ color: calc.velocity > 8 ? "#f59e0b" : calc.velocity > 12 ? "#ef4444" : "inherit" }}>
                                  {calc.velocity}
                                </span>
                              </td>
                              <td className="py-2 pl-1 text-right text-xs font-mono">
                                <span style={{ color: calc.dpTotal > 50 ? "#f59e0b" : "inherit" }}>
                                  {calc.dpTotal}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    <div className="text-xs pt-1" style={{ color: "hsl(215,15%,40%)" }}>
                      Метод Кросса · Альтшуль · ρ=1.2 · ν=15.06·10⁻⁶
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Модал библиотеки КМС ───────────────────────────────────────── */}
      {showKmsPicker && selectedBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() => setShowKmsPicker(false)}>
          <div className="w-[600px] max-h-[80vh] rounded-lg overflow-hidden flex flex-col"
            style={{ background: "hsl(220,20%,11%)", border: "1px solid hsl(220,15%,22%)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold">Библиотека КМС</h3>
                <p className="text-xs text-muted-foreground">Идельчик · ветвь {selectedBranch.id}</p>
              </div>
              <button onClick={() => setShowKmsPicker(false)}
                className="w-8 h-8 rounded hover:bg-muted flex items-center justify-center text-muted-foreground">
                <Icon name="X" size={16} />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4">
              {Object.entries(
                Object.entries(BIBLIOTECA_KMS).reduce((acc, [k, v]) => {
                  (acc[v.group] ??= []).push([k, v]);
                  return acc;
                }, {} as Record<string, [string, typeof BIBLIOTECA_KMS[string]][]>)
              ).map(([group, items]) => (
                <div key={group}>
                  <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "hsl(210,100%,65%)" }}>{group}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map(([key, item]) => (
                      <button key={key}
                        onClick={() => { addKms(key); }}
                        className="flex items-center justify-between px-3 py-2 rounded text-xs transition-all hover:brightness-125 text-left"
                        style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
                        <span style={{ color: "hsl(210,20%,80%)" }}>{item.name}</span>
                        <span className="font-mono ml-2" style={{ color: "hsl(210,100%,65%)" }}>ζ={item.zeta}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end">
              <button onClick={() => setShowKmsPicker(false)}
                className="px-4 py-1.5 rounded text-xs font-semibold"
                style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>
                Готово
              </button>
            </div>
          </div>
        </div>
      )}
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
        style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,22%)", color: "hsl(210,20%,90%)" }}
        onFocus={(e) => e.target.style.borderColor = "hsl(210,100%,56%)"}
        onBlur={(e) => e.target.style.borderColor = "hsl(220,15%,22%)"} />
    </div>
  );
}

function ResRow({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded"
      style={{ background: bold ? `${color}18` : "transparent", border: bold ? `1px solid ${color}30` : "none" }}>
      <span className="text-xs" style={{ color: "hsl(215,15%,55%)" }}>{label}</span>
      <span className={`text-xs font-mono ${bold ? "font-bold" : ""}`} style={{ color }}>{value}</span>
    </div>
  );
}

function SumCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
      <span className="text-xs block mb-1" style={{ color: "hsl(215,15%,50%)" }}>{label}</span>
      <span className="text-base font-mono font-semibold" style={{ color }}>{value}</span>
      <span className="text-xs ml-1" style={{ color: "hsl(215,15%,40%)" }}>{unit}</span>
    </div>
  );
}
