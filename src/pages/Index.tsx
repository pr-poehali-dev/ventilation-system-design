import { useState, useRef, useCallback, useMemo } from "react";
import Icon from "@/components/ui/icon";
import {
  BIBLIOTECA_KMS, crossMethod, recommendDiameter,
  STANDARD_DIAMETERS,
  type DuctShape, type DuctParams, type LocalResistance,
  type NetworkNode, type NetworkBranch, type CrossResult, type BranchCalc,
} from "@/lib/aero";
import {
  FITTINGS, getFittingsByGroup, evalZeta, autoAssignKMS,
} from "@/lib/fittings";
import {
  DEFAULT_FLOORS, project,
  type Floor,
} from "@/lib/iso";
import { FAN_CATALOG, type FanModel } from "@/lib/fans";
import FanSelector from "@/components/FanSelector";

// ─── Типы UI ────────────────────────────────────────────────────────────────

type NodeType = "junction" | "supply" | "exhaust" | "fan";
type ViewMode = "plan" | "iso";

interface VentNode {
  id: string;
  x: number;
  y: number;
  type: NodeType;
  label: string;
  fixedFlow?: number;
  floorId: string;       // привязка к этажу
  fanModelId?: string;   // подобранная модель вентилятора
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
  const [floors, setFloors] = useState<Floor[]>(DEFAULT_FLOORS);
  const [activeFloor, setActiveFloor] = useState<string>("F1");
  const [viewMode, setViewMode] = useState<ViewMode>("plan");

  const [nodes, setNodes] = useState<VentNode[]>([
    { id: "N1", x: 200, y: 260, type: "fan", label: "Вент1", fixedFlow: 2000, floorId: "F1" },
    { id: "N2", x: 440, y: 260, type: "junction", label: "У1", floorId: "F1" },
    { id: "N3", x: 660, y: 200, type: "exhaust", label: "В1", fixedFlow: 500, floorId: "F1" },
    { id: "N4", x: 660, y: 340, type: "exhaust", label: "В2", fixedFlow: 500, floorId: "F1" },
    { id: "N5", x: 440, y: 260, type: "junction", label: "У2", floorId: "F2" },
    { id: "N6", x: 660, y: 200, type: "exhaust", label: "В3", fixedFlow: 500, floorId: "F2" },
    { id: "N7", x: 660, y: 340, type: "exhaust", label: "В4", fixedFlow: 500, floorId: "F2" },
  ]);
  const [branches, setBranches] = useState<VentBranch[]>([
    { id: "B1", from: "N1", to: "N2", params: { shape: "round", diameter: 200, length: 8, localResistances: [{ type: "elbow_90_r1", zeta: 0.21, count: 1 }] } },
    { id: "B2", from: "N2", to: "N3", params: { shape: "round", diameter: 160, length: 5, localResistances: [{ type: "tee_branch_90", zeta: 1.5, count: 1 }, { type: "grille_supply", zeta: 2, count: 1 }] } },
    { id: "B3", from: "N2", to: "N4", params: { shape: "round", diameter: 160, length: 6, localResistances: [{ type: "tee_branch_90", zeta: 1.5, count: 1 }, { type: "grille_supply", zeta: 2, count: 1 }] } },
    { id: "B4", from: "N2", to: "N5", params: { shape: "round", diameter: 200, length: 3, localResistances: [{ type: "elbow_90_r1", zeta: 0.21, count: 2 }] } },
    { id: "B5", from: "N5", to: "N6", params: { shape: "round", diameter: 160, length: 5, localResistances: [{ type: "tee_branch_90", zeta: 1.5, count: 1 }, { type: "grille_supply", zeta: 2, count: 1 }] } },
    { id: "B6", from: "N5", to: "N7", params: { shape: "round", diameter: 160, length: 6, localResistances: [{ type: "tee_branch_90", zeta: 1.5, count: 1 }, { type: "grille_supply", zeta: 2, count: 1 }] } },
  ]);

  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [branchStart, setBranchStart] = useState<string | null>(null);
  const [calcResult, setCalcResult] = useState<CrossResult | null>(null);
  const [activeTab, setActiveTab] = useState<"properties" | "results" | "kms" | "floors">("properties");
  const [showKmsPicker, setShowKmsPicker] = useState(false);
  const [showFanSelector, setShowFanSelector] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const counterRef = useRef({ node: 8, branch: 7, floor: 4 });
  const typeCounters = useRef<Record<NodeType, number>>({ supply: 2, exhaust: 5, junction: 3, fan: 1 });

  const getSVGPoint = useCallback((e: React.MouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const snap = (v: number) => Math.round(v / 20) * 20;

  const handleSVGClick = useCallback((e: React.MouseEvent) => {
    if (dragging) return;
    if (viewMode === "iso") return; // в аксонометрии добавление выключено
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
    setNodes((prev) => [...prev, { id, x: snap(x), y: snap(y), type, label, fixedFlow, floorId: activeFloor }]);
    setSelected(id);
  }, [tool, dragging, getSVGPoint, activeFloor, viewMode]);

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
        // Автодлина для стояка между этажами
        const fromN = nodes.find((n) => n.id === branchStart);
        const toN = nodes.find((n) => n.id === id);
        const fromFloor = fromN ? floors.find((f) => f.id === fromN.floorId) : null;
        const toFloor = toN ? floors.find((f) => f.id === toN.floorId) : null;
        const isRiser = fromFloor && toFloor && fromFloor.id !== toFloor.id;
        const length = isRiser ? Math.abs((toFloor!.level - fromFloor!.level)) : 5;
        setBranches((p) => [...p, {
          id: bid, from: branchStart, to: id,
          params: { shape: "round", diameter: 160, length, localResistances: [] }
        }]);
        setBranchStart(null);
        setSelected(bid);
      }
      return;
    }
    if (tool === "select") {
      setSelected(id);
      const node = nodes.find((n) => n.id === id);
      if (node && viewMode === "plan") {
        const { x, y } = getSVGPoint(e);
        setDragging({ id, ox: x - node.x, oy: y - node.y });
      }
    }
  }, [tool, branchStart, nodes, getSVGPoint, viewMode, floors]);

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
    // Сначала ищем в новой базе фасонок
    const fitting = FITTINGS[key];
    const oldItem = BIBLIOTECA_KMS[key];
    if (!fitting && !oldItem) return;

    const zeta = fitting
      ? evalZeta(key, fitting.params, selectedBranch.params)
      : oldItem!.zeta;

    const existing = selectedBranch.params.localResistances ?? [];
    const found = existing.find((lr) => lr.type === key);
    const newList: LocalResistance[] = found
      ? existing.map((lr) => lr.type === key ? { ...lr, count: lr.count + 1 } : lr)
      : [...existing, { type: key, zeta, count: 1, params: fitting?.params }];
    updateBranchParams({ localResistances: newList });
  };

  const removeKms = (key: string) => {
    if (!selectedBranch) return;
    const list = (selectedBranch.params.localResistances ?? []).filter((lr) => lr.type !== key);
    updateBranchParams({ localResistances: list });
  };

  const updateKmsParam = (key: string, paramName: string, value: number) => {
    if (!selectedBranch) return;
    const list = (selectedBranch.params.localResistances ?? []).map((lr) => {
      if (lr.type !== key) return lr;
      const newParams = { ...(lr.params ?? {}), [paramName]: value };
      const newZeta = FITTINGS[key] ? evalZeta(key, newParams, selectedBranch.params) : lr.zeta;
      return { ...lr, params: newParams, zeta: newZeta };
    });
    updateBranchParams({ localResistances: list });
  };

  const updateKmsCount = (key: string, count: number) => {
    if (!selectedBranch) return;
    const list = (selectedBranch.params.localResistances ?? []).map((lr) =>
      lr.type === key ? { ...lr, count: Math.max(1, count) } : lr
    );
    updateBranchParams({ localResistances: list });
  };

  const autoSelectDiameter = () => {
    if (!selectedBranch || !selectedFlow) return;
    const d = recommendDiameter(selectedFlow, 6);
    updateBranchParams({ shape: "round", diameter: d });
  };

  // ─── Авторасстановка КМС по топологии ───────────────────────────────────
  const [autoKmsLog, setAutoKmsLog] = useState<string[]>([]);

  const runAutoKMS = () => {
    const result = autoAssignKMS(
      nodes.map((n) => ({ id: n.id, type: n.type })),
      branches.map((b) => ({ id: b.id, from: b.from, to: b.to, params: b.params })),
    );
    // Сливаем с существующими (не перезаписываем ручные)
    setBranches((prev) => prev.map((b) => {
      const auto = result.branchUpdates[b.id] ?? [];
      const manual = (b.params.localResistances ?? []).filter((lr) => !lr.auto);
      const merged = [...manual];
      auto.forEach((a) => {
        if (!merged.some((m) => m.type === a.type)) {
          merged.push({ ...a, params: FITTINGS[a.type]?.params });
        }
      });
      return { ...b, params: { ...b.params, localResistances: merged } };
    }));
    setAutoKmsLog(result.log);
  };

  const clearAutoKMS = () => {
    setBranches((prev) => prev.map((b) => ({
      ...b,
      params: {
        ...b.params,
        localResistances: (b.params.localResistances ?? []).filter((lr) => !lr.auto),
      },
    })));
    setAutoKmsLog([]);
  };

  // ─── Управление этажами ──────────────────────────────────────────────────
  const addFloor = () => {
    const lastFloor = floors[floors.length - 1];
    const id = `F${counterRef.current.floor++}`;
    const palette = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#06b6d4"];
    setFloors((p) => [...p, {
      id, name: `${p.length + 1} этаж`,
      level: lastFloor ? lastFloor.level + lastFloor.height : 0,
      height: 3.0, color: palette[p.length % palette.length], visible: true,
    }]);
  };

  const removeFloor = (id: string) => {
    if (floors.length <= 1) return;
    setFloors((p) => p.filter((f) => f.id !== id));
    setNodes((p) => p.filter((n) => n.floorId !== id));
    if (activeFloor === id) setActiveFloor(floors[0].id);
  };

  const updateFloor = (id: string, patch: Partial<Floor>) => {
    setFloors((p) => p.map((f) => f.id === id ? { ...f, ...patch } : f));
  };

  const getFloor = (id: string) => floors.find((f) => f.id === id);

  // Видимые узлы — для плана только активного этажа, для изометрии все видимые
  const visibleNodes = useMemo(() => {
    if (viewMode === "plan") {
      return nodes.filter((n) => n.floorId === activeFloor);
    }
    return nodes.filter((n) => floors.find((f) => f.id === n.floorId)?.visible);
  }, [nodes, viewMode, activeFloor, floors]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const visibleBranches = useMemo(() => {
    return branches.filter((b) => visibleNodeIds.has(b.from) && visibleNodeIds.has(b.to));
  }, [branches, visibleNodeIds]);

  // Изометрические координаты узлов
  const isoOrigin = { x: 600, y: 300 };
  const getIsoPos = (n: VentNode) => {
    const floor = getFloor(n.floorId);
    if (!floor) return { x: n.x, y: n.y };
    return project({ x: n.x, y: n.y, z: floor.level }, isoOrigin);
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
              style={{ background: "hsl(220,15%,16%)", color: "hsl(215,15%,50%)" }}>v4.0 · Подбор</span>
          </div>
          <div className="w-px h-4 bg-border" />
          {/* Переключатель видов */}
          <div className="flex items-center rounded-md p-0.5"
            style={{ background: "hsl(220,15%,14%)", border: "1px solid hsl(220,15%,22%)" }}>
            {([
              { id: "plan" as const, icon: "Square", label: "План" },
              { id: "iso" as const, icon: "Box", label: "Аксонометрия" },
            ]).map((v) => (
              <button key={v.id}
                onClick={() => setViewMode(v.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all"
                style={viewMode === v.id
                  ? { background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }
                  : { color: "hsl(215,15%,55%)" }}>
                <Icon name={v.icon} size={11} />
                {v.label}
              </button>
            ))}
          </div>
          {/* Селектор активного этажа в режиме плана */}
          {viewMode === "plan" && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md"
              style={{ background: "hsl(220,15%,14%)", border: "1px solid hsl(220,15%,22%)" }}>
              <Icon name="Layers" size={11} className="text-muted-foreground" />
              <select value={activeFloor}
                onChange={(e) => setActiveFloor(e.target.value)}
                className="bg-transparent text-xs font-medium outline-none cursor-pointer"
                style={{ color: getFloor(activeFloor)?.color ?? "hsl(210,20%,90%)" }}>
                {floors.map((f) => (
                  <option key={f.id} value={f.id} style={{ background: "hsl(220,18%,11%)" }}>
                    {f.name} ({f.level}м)
                  </option>
                ))}
              </select>
            </div>
          )}
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
          <button onClick={runAutoKMS}
            title="Автоматически расставить КМС по топологии"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:brightness-110 active:scale-95"
            style={{ background: "hsl(45,90%,55%,0.15)", border: "1px solid hsl(45,90%,55%,0.4)", color: "hsl(45,90%,65%)" }}>
            <Icon name="Wand2" size={12} />
            Авто-КМС
          </button>
          <button onClick={() => setShowFanSelector(true)}
            disabled={!calcResult}
            title="Подобрать вентилятор по сопротивлению сети"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "hsl(280,80%,60%,0.15)", border: "1px solid hsl(280,80%,60%,0.4)", color: "hsl(280,80%,75%)" }}>
            <Icon name="Gauge" size={12} />
            Подбор вентил.
          </button>
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
            className={viewMode === "plan" ? "vent-canvas w-full h-full" : "w-full h-full"}
            onClick={handleSVGClick}
            onMouseMove={handleMouseMove}
            onMouseUp={() => setDragging(null)}
            onMouseLeave={() => setDragging(null)}
            style={{
              background: viewMode === "iso" ? "hsl(220,22%,7%)" : undefined,
              cursor: tool === "branch" ? "crosshair" : tool === "delete" ? "not-allowed" : dragging ? "grabbing" : viewMode === "iso" ? "default" : "default",
            }}>

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
              <pattern id="iso-grid" width="60" height="35" patternUnits="userSpaceOnUse" patternTransform="skewX(-30) skewY(0)">
                <path d="M 60 0 L 0 0 0 35" fill="none" stroke="hsl(215,15%,18%)" strokeWidth="0.5" />
              </pattern>
            </defs>

            {/* ── Изометрические плоскости этажей ─────────────────── */}
            {viewMode === "iso" && [...floors].sort((a, b) => a.level - b.level).filter((f) => f.visible).map((floor) => {
              const sizeX = 700, sizeY = 500;
              const corners = [
                project({ x: 0, y: 0, z: floor.level }, isoOrigin),
                project({ x: sizeX, y: 0, z: floor.level }, isoOrigin),
                project({ x: sizeX, y: sizeY, z: floor.level }, isoOrigin),
                project({ x: 0, y: sizeY, z: floor.level }, isoOrigin),
              ];
              const path = corners.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") + " Z";
              const labelPos = project({ x: 0, y: sizeY, z: floor.level }, isoOrigin);
              return (
                <g key={floor.id} opacity={activeFloor === floor.id ? 1 : 0.5}>
                  <path d={path} fill={`${floor.color}08`} stroke={`${floor.color}55`} strokeWidth="1" strokeDasharray="3 4" />
                  {/* Сетка пола */}
                  {Array.from({ length: 8 }, (_, i) => i * 100).map((x) => {
                    const a = project({ x, y: 0, z: floor.level }, isoOrigin);
                    const b = project({ x, y: sizeY, z: floor.level }, isoOrigin);
                    return <line key={`vx${x}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={`${floor.color}15`} strokeWidth="0.5" />;
                  })}
                  {Array.from({ length: 6 }, (_, i) => i * 100).map((y) => {
                    const a = project({ x: 0, y, z: floor.level }, isoOrigin);
                    const b = project({ x: sizeX, y, z: floor.level }, isoOrigin);
                    return <line key={`hy${y}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={`${floor.color}15`} strokeWidth="0.5" />;
                  })}
                  {/* Метка этажа */}
                  <g transform={`translate(${labelPos.x - 60},${labelPos.y + 10})`}>
                    <rect x="0" y="-8" width="100" height="18" rx="3" fill="hsl(220,20%,10%)" stroke={floor.color} strokeWidth="1" />
                    <text x="50" y="2" textAnchor="middle" dominantBaseline="middle" fontSize="9" fontFamily="IBM Plex Mono" fill={floor.color}>
                      {floor.name} +{floor.level}м
                    </text>
                  </g>
                </g>
              );
            })}

            {/* ── Ветви ───────────────────────────────────────────── */}
            {visibleBranches.map((br) => {
              const fromNode = nodes.find((n) => n.id === br.from);
              const toNode = nodes.find((n) => n.id === br.to);
              if (!fromNode || !toNode) return null;
              const fromP = viewMode === "iso" ? getIsoPos(fromNode) : { x: fromNode.x, y: fromNode.y };
              const toP = viewMode === "iso" ? getIsoPos(toNode) : { x: toNode.x, y: toNode.y };
              const m = { x: (fromP.x + toP.x) / 2, y: (fromP.y + toP.y) / 2 };

              const isSel = selected === br.id;
              const flow = calcResult?.branchFlows[br.id];
              const calc = calcResult?.branchCalcs[br.id];
              const v = calc?.velocity;
              const vColor = v && v > 8 ? "#f59e0b" : v && v > 12 ? "#ef4444" : "hsl(210,100%,65%)";
              // Стояк (вертикальная ветвь между этажами) — выделим цветом
              const isRiser = fromNode.floorId !== toNode.floorId;
              const branchColor = isRiser ? "#a855f7" : (isSel ? "hsl(210,100%,56%)" : "hsl(215,15%,32%)");

              return (
                <g key={br.id}>
                  <line x1={fromP.x} y1={fromP.y} x2={toP.x} y2={toP.y}
                    stroke="transparent" strokeWidth={20}
                    onClick={(e) => handleBranchClick(e, br.id)} style={{ cursor: "pointer" }} />
                  <line x1={fromP.x} y1={fromP.y} x2={toP.x} y2={toP.y}
                    stroke={branchColor}
                    strokeWidth={isSel ? 3 : isRiser ? 2.5 : 2}
                    strokeDasharray={isRiser && !isSel ? "5 3" : undefined}
                    markerEnd={isSel ? "url(#arr-sel)" : "url(#arr)"}
                    filter={isSel ? "url(#glow)" : undefined}
                    onClick={(e) => handleBranchClick(e, br.id)}
                    style={{ cursor: "pointer", transition: "stroke 0.15s" }} />
                  <rect x={m.x - 28} y={m.y - 11} width="56" height={flow ? 24 : 18} rx="3"
                    fill="hsl(220,18%,10%)"
                    stroke={isSel ? "hsl(210,100%,56%)" : isRiser ? "#a855f7" : "hsl(220,15%,22%)"}
                    strokeWidth="1" />
                  <text x={m.x} y={m.y - 2} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontFamily="IBM Plex Mono"
                    fill={isSel ? "hsl(210,100%,70%)" : isRiser ? "#c084fc" : "hsl(215,15%,55%)"}>
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

            {/* ── Узлы ────────────────────────────────────────────── */}
            {visibleNodes.map((node) => {
              const isSel = selected === node.id;
              const isBrFrom = branchStart === node.id;
              const color = COLORS[node.type];
              const icon = node.type === "supply" ? "▲" : node.type === "exhaust" ? "▼" : node.type === "fan" ? "⊕" : "●";
              const pos = viewMode === "iso" ? getIsoPos(node) : { x: node.x, y: node.y };
              const floor = getFloor(node.floorId);
              const isOtherFloor = viewMode === "plan" && node.floorId !== activeFloor;

              return (
                <g key={node.id}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  style={{ cursor: tool === "select" ? (viewMode === "plan" ? "grab" : "pointer") : "pointer", opacity: isOtherFloor ? 0.3 : 1 }}>
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
                  {/* Бейдж модели вентилятора */}
                  {node.type === "fan" && node.fanModelId && (
                    <g transform={`translate(${NODE_RADIUS - 4},${-NODE_RADIUS - 2})`}>
                      <circle r="6" fill="hsl(280,80%,60%)" stroke="hsl(220,20%,8%)" strokeWidth="1.5" />
                      <text textAnchor="middle" dominantBaseline="middle" fontSize="8" fontWeight="bold" fill="hsl(220,20%,8%)">✓</text>
                    </g>
                  )}
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize="13" fill={isSel ? "hsl(220,20%,8%)" : color} fontWeight="600">
                    {icon}
                  </text>
                  <text x="0" y={NODE_RADIUS + 13} textAnchor="middle" dominantBaseline="middle"
                    fontSize="10" fontFamily="IBM Plex Mono"
                    fill={isSel ? color : "hsl(215,15%,60%)"} fontWeight={isSel ? "600" : "400"}>
                    {node.label}
                    {viewMode === "iso" && floor && (
                      <tspan dx="3" fill={floor.color} fontSize="8">·{floor.name.charAt(0)}{floor.level}м</tspan>
                    )}
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
              { id: "floors", label: "Этажи" },
              { id: "kms", label: "Фасонки" },
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
                    {/* Привязка к этажу */}
                    <div>
                      <label className="text-xs uppercase tracking-wider block mb-1.5" style={{ color: "hsl(215,15%,45%)" }}>Этаж</label>
                      <select value={selectedNode.floorId}
                        onChange={(e) => updateNode("floorId", e.target.value)}
                        className="w-full px-3 py-2 rounded-md text-sm font-mono"
                        style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,22%)", color: getFloor(selectedNode.floorId)?.color ?? "hsl(210,20%,90%)" }}>
                        {floors.map((f) => (
                          <option key={f.id} value={f.id} style={{ background: "hsl(220,18%,11%)" }}>
                            {f.name} (+{f.level}м)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <PropField label="X" value={String(selectedNode.x)} onChange={(v) => updateNode("x", Number(v))} type="number" />
                      <PropField label="Y" value={String(selectedNode.y)} onChange={(v) => updateNode("y", Number(v))} type="number" />
                    </div>

                    {/* Подобранная модель вентилятора */}
                    {selectedNode.type === "fan" && (
                      <div className="pt-3 border-t border-border space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>
                            Модель вентилятора
                          </span>
                          <button onClick={() => setShowFanSelector(true)}
                            className="text-xs px-2 py-0.5 rounded hover:brightness-110"
                            style={{ background: "hsl(280,80%,60%,0.15)", color: "hsl(280,80%,75%)" }}>
                            Подобрать
                          </button>
                        </div>
                        {selectedNode.fanModelId ? (() => {
                          const fan = FAN_CATALOG.find((f) => f.id === selectedNode.fanModelId);
                          if (!fan) return null;
                          return (
                            <div className="rounded-md p-2.5 space-y-1"
                              style={{ background: "hsl(280,80%,60%,0.07)", border: "1px solid hsl(280,80%,60%,0.3)" }}>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono text-muted-foreground">{fan.brand}</span>
                                <button onClick={() => updateNode("fanModelId", undefined)}
                                  className="text-muted-foreground hover:text-red-400">
                                  <Icon name="X" size={11} />
                                </button>
                              </div>
                              <p className="text-sm font-medium" style={{ color: "hsl(280,80%,80%)" }}>{fan.model}</p>
                              <div className="grid grid-cols-3 gap-2 mt-1.5 text-xs font-mono">
                                <div>
                                  <span className="text-muted-foreground text-[10px] block">Q опт</span>
                                  <span style={{ color: "hsl(210,100%,65%)" }}>{fan.Qopt} м³/ч</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground text-[10px] block">P</span>
                                  <span style={{ color: "hsl(45,90%,65%)" }}>{fan.power} кВт</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground text-[10px] block">η max</span>
                                  <span style={{ color: "hsl(142,70%,55%)" }}>{(fan.etaMax * 100).toFixed(0)}%</span>
                                </div>
                              </div>
                              {fan.priceRub && (
                                <p className="text-xs pt-1.5 border-t border-border" style={{ color: "hsl(142,70%,55%)" }}>
                                  ≈ {fan.priceRub.toLocaleString("ru-RU")} ₽
                                </p>
                              )}
                            </div>
                          );
                        })() : (
                          <p className="text-xs italic text-muted-foreground py-1">
                            Модель не выбрана. Запустите расчёт и нажмите «Подбор вентил.»
                          </p>
                        )}
                      </div>
                    )}
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
                          Фасонные части ({(selectedBranch.params.localResistances ?? []).length})
                        </span>
                        <button onClick={() => setShowKmsPicker(true)}
                          className="text-xs px-2 py-0.5 rounded hover:brightness-110"
                          style={{ background: "hsl(210,100%,56%,0.15)", color: "hsl(210,100%,70%)" }}>
                          + Добавить
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {(selectedBranch.params.localResistances ?? []).map((lr) => {
                          const fitting = FITTINGS[lr.type];
                          const item = BIBLIOTECA_KMS[lr.type];
                          const name = fitting?.name ?? item?.name ?? lr.type;
                          const hasParams = fitting?.params && Object.keys(fitting.params).length > 0;
                          return (
                            <div key={lr.type} className="rounded text-xs overflow-hidden"
                              style={{
                                background: lr.auto ? "hsl(45,90%,55%,0.07)" : "hsl(220,15%,13%)",
                                border: lr.auto ? "1px solid hsl(45,90%,55%,0.3)" : "1px solid hsl(220,15%,20%)",
                              }}>
                              <div className="flex items-center gap-2 px-2 py-1.5">
                                {lr.auto && (
                                  <Icon name="Wand2" size={10} style={{ color: "hsl(45,90%,65%)" }} />
                                )}
                                <span className="flex-1 truncate" style={{ color: "hsl(210,20%,80%)" }}>{name}</span>
                                <input type="number" min={1}
                                  value={lr.count}
                                  onChange={(e) => updateKmsCount(lr.type, Number(e.target.value))}
                                  className="w-10 px-1 py-0.5 rounded text-xs font-mono text-center"
                                  style={{ background: "hsl(220,20%,8%)", border: "1px solid hsl(220,15%,22%)", color: "hsl(210,20%,80%)" }} />
                                <span className="font-mono w-14 text-right" style={{ color: "hsl(210,100%,65%)" }}>ζ={lr.zeta.toFixed(2)}</span>
                                <button onClick={() => removeKms(lr.type)}
                                  className="text-muted-foreground hover:text-red-400 transition-colors">
                                  <Icon name="X" size={12} />
                                </button>
                              </div>
                              {/* Параметры */}
                              {hasParams && (
                                <div className="px-2 pb-1.5 pt-0.5 grid grid-cols-2 gap-1">
                                  {fitting!.params!.angle !== undefined && (
                                    <ParamSlider label="α°" min={15} max={180} value={lr.params?.angle ?? fitting!.params!.angle!}
                                      onChange={(v) => updateKmsParam(lr.type, "angle", v)} />
                                  )}
                                  {fitting!.params!.radiusRatio !== undefined && (
                                    <ParamSlider label="R/D" min={0.5} max={3} step={0.25} value={lr.params?.radiusRatio ?? fitting!.params!.radiusRatio!}
                                      onChange={(v) => updateKmsParam(lr.type, "radiusRatio", v)} />
                                  )}
                                  {fitting!.params!.areaRatio !== undefined && (
                                    <ParamSlider label="F2/F1" min={0.1} max={3} step={0.1} value={lr.params?.areaRatio ?? fitting!.params!.areaRatio!}
                                      onChange={(v) => updateKmsParam(lr.type, "areaRatio", v)} />
                                  )}
                                  {fitting!.params!.angleClose !== undefined && (
                                    <ParamSlider label="закр°" min={0} max={70} step={5} value={lr.params?.angleClose ?? fitting!.params!.angleClose!}
                                      onChange={(v) => updateKmsParam(lr.type, "angleClose", v)} />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!(selectedBranch.params.localResistances ?? []).length && (
                          <p className="text-xs text-muted-foreground italic py-2">Используйте «Авто-КМС» или добавьте вручную</p>
                        )}
                      </div>
                      {(selectedBranch.params.localResistances ?? []).some((lr) => lr.auto) && (
                        <button onClick={clearAutoKMS}
                          className="mt-2 w-full text-xs py-1 rounded hover:brightness-110"
                          style={{ background: "hsl(0,72%,51%,0.1)", color: "hsl(0,72%,65%)", border: "1px solid hsl(0,72%,51%,0.2)" }}>
                          Удалить авто-КМС
                        </button>
                      )}
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

            {/* ── Этажи (менеджер уровней) ── */}
            {activeTab === "floors" && (
              <div className="animate-fade-in space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <p className="text-xs uppercase tracking-wider" style={{ color: "hsl(215,15%,45%)" }}>
                    Уровни здания ({floors.length})
                  </p>
                  <button onClick={addFloor}
                    className="text-xs px-2 py-1 rounded font-semibold hover:brightness-110 active:scale-95"
                    style={{ background: "hsl(210,100%,56%)", color: "hsl(220,20%,8%)" }}>
                    + Этаж
                  </button>
                </div>
                <div className="space-y-2">
                  {[...floors].sort((a, b) => b.level - a.level).map((floor) => {
                    const isActive = activeFloor === floor.id;
                    const nodeCount = nodes.filter((n) => n.floorId === floor.id).length;
                    return (
                      <div key={floor.id}
                        className="rounded-md overflow-hidden transition-all"
                        style={{
                          background: isActive ? `${floor.color}15` : "hsl(220,15%,13%)",
                          border: `1px solid ${isActive ? floor.color : "hsl(220,15%,20%)"}`,
                        }}>
                        <div className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                          onClick={() => setActiveFloor(floor.id)}>
                          <div className="w-3 h-3 rounded" style={{ background: floor.color }} />
                          <input type="text" value={floor.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateFloor(floor.id, { name: e.target.value })}
                            className="bg-transparent flex-1 text-sm font-medium outline-none"
                            style={{ color: floor.color }} />
                          <span className="text-xs font-mono text-muted-foreground">{nodeCount} узл</span>
                          <button onClick={(e) => { e.stopPropagation(); updateFloor(floor.id, { visible: !floor.visible }); }}
                            className="text-muted-foreground hover:text-foreground">
                            <Icon name={floor.visible ? "Eye" : "EyeOff"} size={13} />
                          </button>
                          {floors.length > 1 && (
                            <button onClick={(e) => { e.stopPropagation(); removeFloor(floor.id); }}
                              className="text-muted-foreground hover:text-red-400">
                              <Icon name="Trash2" size={12} />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 px-3 pb-2 text-xs">
                          <div>
                            <label className="text-muted-foreground text-[10px] uppercase">Отметка, м</label>
                            <input type="number" step="0.1" value={floor.level}
                              onChange={(e) => updateFloor(floor.id, { level: Number(e.target.value) })}
                              className="w-full px-2 py-1 rounded font-mono text-xs"
                              style={{ background: "hsl(220,20%,8%)", border: "1px solid hsl(220,15%,22%)", color: "hsl(210,20%,80%)" }} />
                          </div>
                          <div>
                            <label className="text-muted-foreground text-[10px] uppercase">Высота, м</label>
                            <input type="number" step="0.1" value={floor.height}
                              onChange={(e) => updateFloor(floor.id, { height: Number(e.target.value) })}
                              className="w-full px-2 py-1 rounded font-mono text-xs"
                              style={{ background: "hsl(220,20%,8%)", border: "1px solid hsl(220,15%,22%)", color: "hsl(210,20%,80%)" }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-md p-3 text-xs" style={{ background: "hsl(220,15%,11%)", border: "1px solid hsl(220,15%,18%)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Info" size={11} style={{ color: "hsl(210,100%,65%)" }} />
                    <span style={{ color: "hsl(210,100%,65%)" }}>Подсказка</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">
                    Узлы между разными этажами образуют <span style={{ color: "#c084fc" }}>стояки</span> — отображаются пунктирной фиолетовой линией. Длина стояка автоматически = разнице высот.
                  </p>
                </div>
              </div>
            )}

            {/* ── База фасонных частей ── */}
            {activeTab === "kms" && (
              <div className="animate-fade-in space-y-4">
                <div className="rounded-md p-3" style={{ background: "hsl(45,90%,55%,0.07)", border: "1px solid hsl(45,90%,55%,0.3)" }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon name="Wand2" size={12} style={{ color: "hsl(45,90%,65%)" }} />
                    <span className="text-xs font-semibold" style={{ color: "hsl(45,90%,70%)" }}>Авторасстановка КМС</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Анализ топологии: тройники в местах разветвления, отводы в проходных узлах, переходы при смене сечения.
                  </p>
                  <button onClick={runAutoKMS}
                    className="w-full py-1.5 rounded text-xs font-semibold hover:brightness-110 active:scale-95 transition-all"
                    style={{ background: "hsl(45,90%,55%)", color: "hsl(220,20%,8%)" }}>
                    Расставить по схеме
                  </button>
                  {autoKmsLog.length > 0 && (
                    <div className="mt-2 max-h-24 overflow-y-auto text-xs font-mono space-y-0.5"
                      style={{ color: "hsl(215,15%,55%)" }}>
                      {autoKmsLog.map((line, i) => <div key={i}>· {line}</div>)}
                    </div>
                  )}
                </div>

                <div className="text-xs text-muted-foreground">
                  База фасонных частей (Идельчик · параметрические ζ).
                  {selectedBranch ? " Кликните, чтобы добавить." : " Выберите ветвь для добавления."}
                </div>
                {Object.entries(getFittingsByGroup()).map(([group, items]) => (
                  <div key={group}>
                    <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "hsl(210,100%,65%)" }}>{group}</p>
                    <div className="space-y-1">
                      {items.map(([key, item]) => {
                        const z = evalZeta(key, item.params, selectedBranch?.params);
                        return (
                          <button key={key}
                            disabled={!selectedBranch}
                            onClick={() => addKms(key)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
                            style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
                            <span className="text-left flex-1" style={{ color: "hsl(210,20%,80%)" }}>{item.name}</span>
                            <span className="font-mono ml-2" style={{ color: "hsl(210,100%,65%)" }}>ζ≈{z.toFixed(2)}</span>
                          </button>
                        );
                      })}
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
                <h3 className="text-sm font-semibold">База фасонных частей</h3>
                <p className="text-xs text-muted-foreground">Идельчик · параметрические ζ · ветвь {selectedBranch.id}</p>
              </div>
              <button onClick={() => setShowKmsPicker(false)}
                className="w-8 h-8 rounded hover:bg-muted flex items-center justify-center text-muted-foreground">
                <Icon name="X" size={16} />
              </button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4">
              {Object.entries(getFittingsByGroup()).map(([group, items]) => (
                <div key={group}>
                  <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "hsl(210,100%,65%)" }}>{group}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {items.map(([key, item]) => {
                      const z = evalZeta(key, item.params, selectedBranch.params);
                      return (
                        <button key={key}
                          onClick={() => { addKms(key); }}
                          className="flex items-center justify-between px-3 py-2 rounded text-xs transition-all hover:brightness-125 text-left"
                          style={{ background: "hsl(220,15%,13%)", border: "1px solid hsl(220,15%,20%)" }}>
                          <span className="flex-1" style={{ color: "hsl(210,20%,80%)" }}>{item.name}</span>
                          <span className="font-mono ml-2" style={{ color: "hsl(210,100%,65%)" }}>ζ≈{z.toFixed(2)}</span>
                        </button>
                      );
                    })}
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

      {/* ── Модал подбора вентилятора ─────────────────────────────────── */}
      <FanSelector
        open={showFanSelector}
        onClose={() => setShowFanSelector(false)}
        requiredQ={(() => {
          // Если выбран узел-вентилятор — берём его расход; иначе суммарный по системе
          if (selectedNode?.type === "fan" && selectedNode.fixedFlow) return selectedNode.fixedFlow;
          const supply = nodes.filter((n) => n.type === "supply" || n.type === "fan");
          if (supply.length > 0) return supply.reduce((s, n) => s + (n.fixedFlow ?? 0), 0);
          return calcResult ? Object.values(calcResult.branchFlows).reduce((s, v) => s + v, 0) / Math.max(branches.length, 1) : 1000;
        })()}
        requiredH={(() => {
          // Берём максимальные потери по самой нагруженной ветви + 15% запас
          if (!calcResult) return 200;
          const maxDp = Math.max(...Object.values(calcResult.branchCalcs).map((c) => c.dpTotal));
          // Суммируем потери последовательной цепочки (приближение — макс ветвь × N средних)
          const totalDp = Object.values(calcResult.branchCalcs).reduce((s, c) => s + c.dpTotal, 0) / 2;
          return Math.round(Math.max(maxDp, totalDp) * 1.15);
        })()}
        onSelect={(fan: FanModel) => {
          if (selectedNode?.type === "fan") {
            updateNode("fanModelId", fan.id);
          } else {
            // Если узел-вентилятор не выбран — найдём первый или создадим нотификацию
            const firstFan = nodes.find((n) => n.type === "fan");
            if (firstFan) {
              setNodes((p) => p.map((n) => n.id === firstFan.id ? { ...n, fanModelId: fan.id } : n));
              setSelected(firstFan.id);
            }
          }
        }}
      />
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

function ParamSlider({ label, min, max, step = 1, value, onChange }: {
  label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-mono" style={{ color: "hsl(215,15%,50%)", minWidth: 30 }}>{label}</span>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 px-1 py-0.5 rounded text-[10px] font-mono"
        style={{ background: "hsl(220,20%,8%)", border: "1px solid hsl(220,15%,22%)", color: "hsl(210,20%,80%)" }} />
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