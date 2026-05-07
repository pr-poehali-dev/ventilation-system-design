import { useState, useMemo, useEffect, useRef } from "react";
import Icon from "@/components/ui/icon";
import TopoCanvas, { type CadTool } from "@/components/cad/TopoCanvas";
import {
  type TopoNode, type TopoBranch, type Horizon,
  DEMO_NODES, DEMO_BRANCHES, DEFAULT_HORIZONS, recalcAll, makeNode, makeBranch,
} from "@/lib/topology";
import { SURFACE_TYPES } from "@/lib/aerodynamics";
import { solveNetwork, type SolveResult } from "@/lib/networkSolver";
import { FAN_CATALOG, getFanById } from "@/lib/fanCurves";
import FanCurveChart from "@/components/cad/FanCurveChart";

// ─────────────────────────────────────────────────────────────────────────────
// CAD-интерфейс шахтной/вентиляционной сети в стиле инженерного ПО
// (АэроСеть / Вентиляция-CAD): ribbon-меню + вертикальные вкладки + свойства
// ─────────────────────────────────────────────────────────────────────────────

type RibbonTab = "file" | "home" | "view" | "schema" | "vent" | "thermo" | "accidents" | "involve" | "pipes" | "costs" | "refs" | "general";
type SideTab = "params" | "measure" | "pipes" | "indicators" | "general" | "vent" | "thermo" | "accidents" | "areas" | "coords" | "horizons";

interface Excavation {
  id: string;
  type: string;
  section: "round" | "rect" | "trap";
  area: number;
  perimeter: number;
  length: number;
  alphaCoef: number;
  vMax: number;
  resistance: number;
  flow: number;
  velocity: number;
  dP: number;
  power: number;
  surface: string;
  // ─── Общие свойства ───
  name: string;
  number: string;
  width: number;       // мм (толщина линии)
  border: number;      // мм (рамка)
  layer: string;
  appearYear: string;
  appearMonth: string;
  appearDay: string;
  appearTime: string;
  disappearYear: string;
  disappearMonth: string;
  disappearDay: string;
  disappearTime: string;
  isVertical: boolean;
  dashedBorder: boolean;
  ignoreLayerColor: boolean;
  cable04: boolean;
  cable6: boolean;
}

const DEFAULT_EXC: Excavation = {
  id: "EXC-001",
  type: "Ствол ЮВС",
  section: "round",
  area: 38.5,
  perimeter: 22,
  length: 276,
  alphaCoef: 0.009,
  vMax: 15,
  resistance: 0.000098,
  flow: 211,
  velocity: 5.5,
  dP: 43,
  power: 9002,
  surface: "Воздухоподающая выработка, без неровностей",
  name: 'Ствол "Южный - Вентиляционный"',
  number: "713",
  width: 3,
  border: 0.2,
  layer: "Стволы",
  appearYear: "2025",
  appearMonth: "Ноябрь",
  appearDay: "1",
  appearTime: "__:__",
  disappearYear: "",
  disappearMonth: "",
  disappearDay: "",
  disappearTime: "",
  isVertical: false,
  dashedBorder: false,
  ignoreLayerColor: false,
  cable04: false,
  cable6: false,
};

const LAYERS = ["Стволы", "Квершлаги", "Штреки", "Уклоны", "Камеры", "Сбойки", "Скважины"];

export default function CadPage() {
  const [activeRibbon, setActiveRibbon] = useState<RibbonTab>("home");
  const [activeSide, setActiveSide] = useState<SideTab>("params");
  const [excavation, setExcavation] = useState<Excavation>(DEFAULT_EXC);

  // ─── Топология ─────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<TopoNode[]>(DEMO_NODES);
  const [branchesRaw, setBranches] = useState<TopoBranch[]>(DEMO_BRANCHES);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("N2");
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [tool, setTool] = useState<CadTool>("select");
  const [zLevel, setZLevel] = useState(0);

  // Авто-пересчёт длин и аэродинамики по координатам/параметрам
  const branches = useMemo(() => recalcAll(nodes, branchesRaw), [nodes, branchesRaw]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  const updateNode = (id: string, patch: Partial<TopoNode>) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  };

  const updateBranch = (id: string, patch: Partial<TopoBranch>) => {
    setBranches((prev) => prev.map((b) => b.id === id ? { ...b, ...patch } : b));
  };

  const handleNodeAdd = (x: number, y: number, z: number) => {
    const newId = `N${nodes.length + 1}`;
    const num = String(nodes.length + 100).padStart(3, "0");
    const node = makeNode(newId, { x, y, z, name: `Узел ${num}`, number: num });
    setNodes((p) => [...p, node]);
    setSelectedNodeId(newId);
    setTool("select");
  };

  const handleBranchAdd = (fromId: string, toId: string) => {
    const id = `B${branches.length + 1}`;
    const b = makeBranch(id, fromId, toId);
    setBranches((p) => [...p, b]);
    setSelectedBranchId(id);
    setTool("select");
  };

  const handleNodeMove = (id: string, x: number, y: number, z?: number) => {
    updateNode(id, z !== undefined ? { x, y, z } : { x, y });
  };

  // ─── Результат расчёта сети ─────────────────────────────────────────
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);

  // ─── Ракурс / 3D ────────────────────────────────────────────────────
  const [viewPreset, setViewPreset] = useState<{ name: "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE"; nonce: number } | null>(null);
  const [viewInfo, setViewInfo] = useState<{ is3D: boolean; azimuth: number; elevation: number }>({ is3D: false, azimuth: 0, elevation: 90 });
  const setPreset = (name: "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE") =>
    setViewPreset({ name, nonce: Date.now() });

  // Режим отображения направления воздушного потока (по умолчанию ВЫКЛ).
  const [flowDisplay, setFlowDisplay] = useState<"off" | "flow" | "chevrons" | "both">("off");

  // Активная рабочая плоскость для построения в 3D
  // null = автоматически по ракурсу; иначе фиксированная пользователем
  const [workPlane, setWorkPlane] = useState<{ axis: "x" | "y" | "z"; value: number } | null>(null);

  // ─── ГОРИЗОНТЫ (как в АэроСеть) ─────────────────────────────────────
  // Каждый горизонт = слой ветвей с цветом и Z-отметкой; можно скрывать.
  const [horizons, setHorizons] = useState<Horizon[]>(DEFAULT_HORIZONS);
  const updateHorizon = (id: string, patch: Partial<Horizon>) =>
    setHorizons((p) => p.map((h) => h.id === id ? { ...h, ...patch } : h));
  const addHorizon = () => {
    const id = `H_${Date.now()}`;
    setHorizons((p) => [...p, { id, name: `Горизонт ${p.length + 1}`, z: 0, color: "#64748b", visible: true }]);
  };
  const removeHorizon = (id: string) => {
    setHorizons((p) => p.filter((h) => h.id !== id));
    // Снимаем привязку у ветвей, у которых был этот горизонт
    setBranches((p) => p.map((b) => b.horizonId === id ? { ...b, horizonId: "" } : b));
  };

  // ─── ОБЩИЕ НАСТРОЙКИ ОТОБРАЖЕНИЯ ВЕТВЕЙ ─────────────────────────────
  const [branchWidth, setBranchWidth] = useState<number>(2.5);   // px
  const [branchBorder, setBranchBorder] = useState<number>(0);   // px (контур)
  const [thinLines, setThinLines] = useState<boolean>(false);    // F6: всё в 1px
  const [colorByHorizon, setColorByHorizon] = useState<boolean>(false);
  const [showFlowArrows, setShowFlowArrows] = useState<boolean>(false); // включается F9

  // ─── ПРАВАЯ ВЫДВИЖНАЯ ПАНЕЛЬ ────────────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);
  const [rightTab, setRightTab] = useState<"node" | "branch">("branch");
  // Автопереключение таба при выборе объекта на схеме
  useEffect(() => {
    if (selectedNodeId) setRightTab("node");
    else if (selectedBranchId) setRightTab("branch");
  }, [selectedNodeId, selectedBranchId]);

  // ─── РЕСАЙЗ ЛЕВОЙ ПАНЕЛИ ────────────────────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(330);
  const leftDragRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!leftDragRef.current) return;
      const dx = e.clientX - leftDragRef.current.startX;
      const next = Math.min(640, Math.max(220, leftDragRef.current.startW + dx));
      setLeftPanelWidth(next);
    };
    const onUp = () => { leftDragRef.current = null; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);
  const startLeftDrag = (e: React.MouseEvent) => {
    leftDragRef.current = { startX: e.clientX, startW: leftPanelWidth };
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  };

  const handleSolve = () => {
    const res = solveNetwork(nodes, branchesRaw, { maxIter: 200, tolerance: 0.001, initialFlow: 50 });
    setBranches(res.branches);
    setNodes(res.nodes);
    setSolveResult(res);
    // После успешного расчёта показываем стрелки направления свежей струи (как в АэроСеть).
    if (res.ok) setShowFlowArrows(true);
  };

  // ─── ГОРЯЧИЕ КЛАВИШИ ────────────────────────────────────────────────
  // F6 — переключить «тонкие линии» (как в АэроСеть/Венти-CAD: подача в одну тонкую линию).
  // F9 — запустить расчёт воздухораспределения. Esc — снять выделение.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Не перехватываем хоткеи во время ввода в input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "F6") {
        e.preventDefault();
        setThinLines((v) => !v);
      } else if (e.key === "F9") {
        e.preventDefault();
        handleSolve();
      } else if (e.key === "Escape") {
        setSelectedNodeId(null);
        setSelectedBranchId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, branchesRaw]);

  const handleDeleteSelected = () => {
    if (selectedBranchId) {
      setBranches((p) => p.filter((b) => b.id !== selectedBranchId));
      setSelectedBranchId(null);
    } else if (selectedNodeId) {
      setBranches((p) => p.filter((b) => b.fromId !== selectedNodeId && b.toId !== selectedNodeId));
      setNodes((p) => p.filter((n) => n.id !== selectedNodeId));
      setSelectedNodeId(null);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col"
      style={{ background: "#f0f0f0", fontFamily: "Segoe UI, Tahoma, sans-serif", fontSize: "12px", color: "#1f1f1f" }}>

      {/* ═══ TITLE BAR ════════════════════════════════════════════════════ */}
      <div className="h-7 flex items-center justify-between px-2 select-none"
        style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)", borderBottom: "1px solid #b8b8b8" }}>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-sm flex items-center justify-center"
            style={{ background: "#2563eb", color: "white", fontSize: "10px", fontWeight: "bold" }}>В</div>
          <span className="text-xs font-medium">Вентиляция-CAD — Проект1.vproj</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">—</button>
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">▢</button>
          <button className="w-7 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs">✕</button>
        </div>
      </div>

      {/* ═══ RIBBON TABS ══════════════════════════════════════════════════ */}
      <div className="flex items-end h-7 px-1 gap-0.5"
        style={{ background: "#f0f0f0", borderBottom: "1px solid #b8b8b8" }}>
        <RibbonTabBtn label="Файл" active={activeRibbon === "file"} onClick={() => setActiveRibbon("file")} fileStyle />
        <RibbonTabBtn label="Главная" active={activeRibbon === "home"} onClick={() => setActiveRibbon("home")} />
        <RibbonTabBtn label="Просмотр" active={activeRibbon === "view"} onClick={() => setActiveRibbon("view")} />
        <RibbonTabBtn label="Вид" active={activeRibbon === "schema"} onClick={() => setActiveRibbon("schema")} />
        <RibbonTabBtn label="Схема" active={activeRibbon === "vent"} onClick={() => setActiveRibbon("vent")} />
        <RibbonTabBtn label="Вентиляция" active={activeRibbon === "thermo"} onClick={() => setActiveRibbon("thermo")} />
        <RibbonTabBtn label="Теплофизика" active={activeRibbon === "accidents"} onClick={() => setActiveRibbon("accidents")} />
        <RibbonTabBtn label="Аварии" active={activeRibbon === "involve"} onClick={() => setActiveRibbon("involve")} />
        <RibbonTabBtn label="Задействование" active={activeRibbon === "pipes"} onClick={() => setActiveRibbon("pipes")} />
        <RibbonTabBtn label="Трубы" active={activeRibbon === "costs"} onClick={() => setActiveRibbon("costs")} />
        <RibbonTabBtn label="Затраты" active={activeRibbon === "refs"} onClick={() => setActiveRibbon("refs")} />
        <RibbonTabBtn label="Справочники" active={activeRibbon === "general"} onClick={() => setActiveRibbon("general")} />
        <RibbonTabBtn label="Общее" active={false} onClick={() => {}} highlight />
        <div className="ml-auto pr-2 pb-0.5">
          <button className="w-5 h-5 hover:bg-black/10 flex items-center justify-center"
            title="Свернуть ленту">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3 L5 7 L9 3" stroke="#444" fill="none" strokeWidth="1.2" /></svg>
          </button>
        </div>
      </div>

      {/* ═══ RIBBON CONTENT ═══════════════════════════════════════════════ */}
      <div className="h-[92px] flex items-stretch px-1 py-1 gap-0.5"
        style={{ background: "linear-gradient(180deg,#fafafa,#ececec)", borderBottom: "1px solid #b8b8b8" }}>

        {/* ── Группа: Объекты ── */}
        <RibbonGroup label="Объекты">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Plus" label="Добавить" sublabel="выработку" />
            <RibbonBigBtn icon="Scissors" label="Разделить" sublabel="выработку" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">
              <RibbonSmallBtn>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                  style={{ background: "#5fb3d9", color: "white" }}>59</div>
              </RibbonSmallBtn>
              <RibbonSmallBtn><span className="font-serif text-base">T</span></RibbonSmallBtn>
              <RibbonSmallBtn><PentagonIcon /></RibbonSmallBtn>
              <RibbonSmallBtn><RectIcon /></RibbonSmallBtn>
            </div>
            <div className="flex gap-0.5">
              {[1, 2, 3, 4].map((i) => <RibbonSmallBtn key={i}><MiniSquareIcon variant={i} /></RibbonSmallBtn>)}
            </div>
          </div>
        </RibbonGroup>

        {/* ── Группа: Объекты на выработках ── */}
        <RibbonGroup label="Объекты на выработках">
          <div className="grid grid-rows-2 grid-flow-col gap-0.5">
            {[
              "Pause", "Wind", "DoorOpen", "Square", "Circle", "Octagon", "Hexagon",
              "ArrowRight", "ArrowLeftRight", "ArrowUpRight", "Cog", "Fan", "Filter",
              "Triangle", "Diamond", "Pentagon", "MoveRight", "MoveDown", "Pipette", "Wrench",
            ].map((ic, i) => (
              <button key={i}
                className="w-6 h-6 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded flex items-center justify-center"
                title={`Объект ${i + 1}`}>
                <Icon name={ic} size={12} className="text-gray-700" fallback="Square" />
              </button>
            ))}
          </div>
        </RibbonGroup>

        {/* ── Группа: Действия с объектами ── */}
        <RibbonGroup label="Действия с объектами">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="MousePointer2" label="Выделить" sublabel="объект" />
            <RibbonBigBtn icon="Filter" label="Наложить" sublabel="фильтр" />
            <RibbonBigBtn icon="Undo2" label="Отменить" sublabel="действие" />
            <RibbonBigBtn icon="Trash2" label="Удалить" sublabel="" />
            <RibbonBigBtn icon="ChevronUp" label="Переместить" sublabel="вверх" />
            <RibbonBigBtn icon="ChevronDown" label="Переместить" sublabel="вниз" />
            <RibbonBigBtn icon="FileEdit" label="Редактировать" sublabel="" />
            <RibbonBigBtn icon="Maximize2" label="Увеличить" sublabel="" />
            <RibbonBigBtn icon="Minimize2" label="Уменьшить" sublabel="" />
          </div>
        </RibbonGroup>

        {/* ── Группа: Буфер обмена ── */}
        <RibbonGroup label="Буфер обмена">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="ClipboardPaste" label="Вставить" sublabel="" disabled />
            <RibbonBigBtn icon="Scissors" label="Вырезать" sublabel="" />
            <RibbonBigBtn icon="Copy" label="Копировать" sublabel="" />
          </div>
        </RibbonGroup>

        {/* ── Группа: Виды (2D/3D) ── */}
        <RibbonGroup label="Вид сети">
          <div className="flex items-stretch gap-1">
            <button onClick={() => setPreset("plan")}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded min-w-[58px]"
              title="План — вид сверху (XY)">
              <Icon name="Square" size={20} className="text-blue-600" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">План</div>
            </button>
            <button onClick={() => setPreset("front")}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded min-w-[58px]"
              title="Фронт — вид спереди (XZ)">
              <Icon name="RectangleHorizontal" size={20} className="text-blue-600" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">Фронт</div>
            </button>
            <button onClick={() => setPreset("left")}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded min-w-[58px]"
              title="Профиль — вид сбоку (YZ)">
              <Icon name="RectangleVertical" size={20} className="text-blue-600" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">Профиль</div>
            </button>
            <button onClick={() => setPreset("isoSE")}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-purple-100 hover:border-purple-400 border border-transparent rounded min-w-[58px]"
              title="Изометрия Юго-Восток (3D)">
              <Icon name="Box" size={20} className="text-purple-600" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">3D Изо</div>
            </button>
            <button onClick={() => setTool(tool === "rotate" ? "select" : "rotate")}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-purple-100 hover:border-purple-400 border border-transparent rounded min-w-[58px]"
              title="Вращение камеры (правая кнопка мыши также вращает)"
              style={{ background: tool === "rotate" ? "#ede9fe" : undefined }}>
              <Icon name="RotateCw" size={20} className="text-purple-600" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">Вращать</div>
            </button>
          </div>
        </RibbonGroup>

        {/* ── Группа: Расчёт сети ── */}
        <RibbonGroup label="Расчёт сети">
          <div className="flex items-stretch gap-1">
            <button onClick={handleSolve}
              className="flex flex-col items-center justify-center px-3 py-1 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded min-w-[64px]"
              title="Запустить расчёт сети методом контурных расходов (Кросса)">
              <Icon name="Play" size={22} className="text-green-600" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">
                <div>Расчёт</div><div>сети</div>
              </div>
            </button>
            <button onClick={() => { setBranches(DEMO_BRANCHES); setNodes(DEMO_NODES); setSolveResult(null); }}
              className="flex flex-col items-center justify-center px-3 py-1 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded min-w-[64px]"
              title="Сбросить демо-сеть">
              <Icon name="RotateCcw" size={22} className="text-gray-700" />
              <div className="text-[10px] leading-tight mt-0.5 text-center">
                <div>Сбросить</div><div>демо</div>
              </div>
            </button>
            {solveResult && (
              <div className="flex flex-col justify-center px-2 text-[10px] border-l border-gray-300 ml-1">
                <div className={solveResult.ok ? "text-green-700" : "text-red-700"}>
                  {solveResult.ok ? "✔ Сошлось" : "✘ Не сошлось"}
                </div>
                <div className="text-gray-600">Итераций: {solveResult.iterations}</div>
                <div className="text-gray-600">Контуров: {solveResult.cyclesCount}</div>
                <div className="text-gray-500">max ΔQ: {solveResult.maxDeltaQ.toExponential(2)}</div>
              </div>
            )}
          </div>
        </RibbonGroup>
      </div>

      {/* ═══ MAIN AREA ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── ВЕРТИКАЛЬНЫЕ ВКЛАДКИ СЛЕВА ────────────────────────────── */}
        <div className="w-6 flex flex-col"
          style={{ background: "#e8e8e8", borderRight: "1px solid #b8b8b8" }}>
          {([
            { id: "params", label: "Параметры" },
            { id: "horizons", label: "Горизонты" },
            { id: "measure", label: "Замеры" },
            { id: "pipes", label: "Трубы" },
            { id: "indicators", label: "Индикаторы" },
            { id: "general", label: "Общие" },
            { id: "vent", label: "Вентиляция" },
            { id: "thermo", label: "Теплофизика" },
            { id: "accidents", label: "Аварии" },
            { id: "areas", label: "Участки" },
            { id: "coords", label: "Координаты" },
          ] as { id: SideTab; label: string }[]).map((t) => (
            <button key={t.id}
              onClick={() => setActiveSide(t.id)}
              className="h-20 flex items-center justify-center transition-colors flex-shrink-0"
              style={{
                background: activeSide === t.id ? "#ffffff" : "transparent",
                borderRight: activeSide === t.id ? "1px solid #ffffff" : "1px solid transparent",
                marginRight: activeSide === t.id ? "-1px" : "0",
                borderTop: activeSide === t.id ? "1px solid #b8b8b8" : "none",
                borderBottom: activeSide === t.id ? "1px solid #b8b8b8" : "none",
              }}>
              <span className="text-[11px] tracking-wide"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(180deg)",
                  color: activeSide === t.id ? "#2563eb" : "#444",
                  fontWeight: activeSide === t.id ? 600 : 400,
                }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* ── ПАНЕЛЬ СВОЙСТВ ─────────────────────────────────────────── */}
        <div className="flex flex-col flex-shrink-0"
          style={{ width: leftPanelWidth, background: "#ffffff", borderRight: "1px solid #b8b8b8" }}>

          {/* Селектор объекта */}
          <div className="px-1 py-1" style={{ borderBottom: "1px solid #d0d0d0" }}>
            <div className="flex items-center gap-1">
              <button className="w-4 h-4 hover:bg-black/10 flex items-center justify-center">
                <svg width="8" height="8" viewBox="0 0 8 8"><path d="M5 1 L1 4 L5 7" stroke="#444" fill="none" strokeWidth="1.2" /></svg>
              </button>
              <select className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white">
                <option>Свойства</option>
                <option>Стиль отображения</option>
                <option>Слои</option>
              </select>
            </div>
          </div>

          {/* Заголовок секции */}
          <div className="px-2 py-1.5 border-b border-gray-300 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-800">
              {activeSide === "params" && (selectedNode ? `Узел: ${selectedNode.number || selectedNode.id}` : selectedBranch ? `Ветвь: ${selectedBranch.id}` : "Параметры")}
              {activeSide === "general" && "Свойства объекта"}
              {activeSide === "horizons" && "Горизонты"}
              {activeSide === "vent" && "Аэродинамическое сопротивление"}
              {activeSide === "thermo" && "Теплофизические параметры"}
              {activeSide === "accidents" && "Аварийные режимы"}
              {activeSide === "areas" && "Учёт по участкам"}
              {activeSide === "indicators" && "Индикаторы"}
              {activeSide === "coords" && "Координаты"}
              {activeSide === "measure" && "Замеры"}
              {activeSide === "pipes" && "Трубопроводы"}
            </span>
            {activeSide === "params" && selectedNode && (
              <span className="text-[10px] text-gray-500 font-mono">{selectedNode.id}</span>
            )}
          </div>

          {/* Свойства */}
          <div className="flex-1 overflow-y-auto">

            {/* ═══ ВКЛАДКА: ПАРАМЕТРЫ (узел) ════════════════════════════ */}
            {activeSide === "params" && selectedNode && (
              <div className="p-2 space-y-2">
                <FrameGroup title="Общие свойства">
                  <LabeledRow label="Название:">
                    <input type="text" value={selectedNode.name}
                      onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                      className="cad-input flex-1" />
                  </LabeledRow>
                  <LabeledRow label="Номер:">
                    <input type="text" value={selectedNode.number}
                      onChange={(e) => updateNode(selectedNode.id, { number: e.target.value })}
                      className="cad-input flex-1" />
                  </LabeledRow>
                </FrameGroup>

                <FrameGroup title="Физические координаты">
                  <LabeledRow label="Высотная отметка Z:">
                    <NumWithUnit value={selectedNode.z} unit="м"
                      onChange={(v) => updateNode(selectedNode.id, { z: v })} />
                  </LabeledRow>
                  <LabeledRow label="Координата X:">
                    <NumWithUnit value={selectedNode.x} unit="м"
                      onChange={(v) => updateNode(selectedNode.id, { x: v })} />
                  </LabeledRow>
                  <LabeledRow label="Координата Y:">
                    <NumWithUnit value={selectedNode.y} unit="м"
                      onChange={(v) => updateNode(selectedNode.id, { y: v })} />
                  </LabeledRow>
                </FrameGroup>

                <FrameGroup title="Вентиляция">
                  <LabeledRow label="Температура воздуха:">
                    <NumWithUnit value={selectedNode.airTemp} unit="°C"
                      onChange={(v) => updateNode(selectedNode.id, { airTemp: v })} />
                  </LabeledRow>
                  <LabeledRow label="Связь с атмосферой:">
                    <input type="checkbox" checked={selectedNode.atmosphereLink}
                      onChange={(e) => updateNode(selectedNode.id, { atmosphereLink: e.target.checked })}
                      className="w-[13px] h-[13px] cursor-pointer" />
                  </LabeledRow>
                </FrameGroup>

                <FrameGroup title="Теплофизика">
                  <LabeledRow label="Температура стенок:">
                    <NumWithUnit value={selectedNode.wallTemp} unit="°C"
                      onChange={(v) => updateNode(selectedNode.id, { wallTemp: v })} />
                  </LabeledRow>
                  <div className="pt-1 mt-1 border-t border-gray-200">
                    <div className="text-xs font-semibold text-gray-800 mb-1">Вычисленные параметры</div>
                    <ComputedRow label="Концентрация газа:" value={`${selectedNode.computedGasConc} %`} />
                    <ComputedRow label="Температура воздуха:" value={`${selectedNode.computedAirTemp} °C`} />
                    <ComputedRow label="Температура стенок:" value={`${selectedNode.computedWallTemp} °C`} />
                  </div>
                </FrameGroup>

                <FrameGroup title="Воздушная съемка">
                  <LabeledRow label="Приведенное давление:">
                    <NumWithUnit value={selectedNode.reducedPressure} unit="Па"
                      onChange={(v) => updateNode(selectedNode.id, { reducedPressure: v })} />
                  </LabeledRow>
                  <div className="pt-1 mt-1 border-t border-gray-200">
                    <div className="text-xs font-semibold text-gray-800 mb-1">Вычисленные параметры</div>
                    <ComputedRow label="Давление:" value={`${selectedNode.computedPressure} Па`} />
                  </div>
                </FrameGroup>

                <FrameGroup title="Аварии">
                  <div className="text-xs font-semibold text-gray-800 mb-1">Вычисленные параметры</div>
                  <ComputedRow label="Давление взрыва:" value={`${selectedNode.computedExplosivePressure} КПа`} />
                </FrameGroup>
              </div>
            )}

            {/* ═══ ВКЛАДКА: ПАРАМЕТРЫ (ветвь) ═══════════════════════════ */}
            {activeSide === "params" && !selectedNode && selectedBranch && (
              <div className="p-2 space-y-2">
                <FrameGroup title="Ветвь">
                  <LabeledRow label="ID:">
                    <input type="text" value={selectedBranch.id} readOnly className="cad-input flex-1" />
                  </LabeledRow>
                  <LabeledRow label="Тип выработки:">
                    <select value={selectedBranch.type}
                      onChange={(e) => updateBranch(selectedBranch.id, { type: e.target.value })}
                      className="cad-input flex-1">
                      {["Ствол ЮВС", "Ствол СВС", "Квершлаг", "Штрек откат.", "Штрек вент.", "Уклон", "Очистной", "Сбойка", "Камера"].map((t) =>
                        <option key={t}>{t}</option>)}
                    </select>
                  </LabeledRow>
                  <LabeledRow label="От узла → К узлу:">
                    <div className="flex-1 flex items-center gap-1">
                      <input type="text" value={selectedBranch.fromId} readOnly className="cad-input w-16 text-center" />
                      <span>→</span>
                      <input type="text" value={selectedBranch.toId} readOnly className="cad-input w-16 text-center" />
                    </div>
                  </LabeledRow>
                  <LabeledRow label="Горизонт:">
                    <div className="flex-1 flex items-center gap-1">
                      <select value={selectedBranch.horizonId}
                        onChange={(e) => updateBranch(selectedBranch.id, { horizonId: e.target.value })}
                        className="cad-input flex-1">
                        <option value="">— без привязки —</option>
                        {horizons.map((h) => (
                          <option key={h.id} value={h.id}>{h.name} ({h.z} м)</option>
                        ))}
                      </select>
                      {selectedBranch.horizonId && (
                        <span className="w-3 h-3 rounded-sm border border-gray-400 flex-shrink-0"
                          style={{ background: horizons.find((h) => h.id === selectedBranch.horizonId)?.color || "#ccc" }}
                          title="Цвет горизонта" />
                      )}
                    </div>
                  </LabeledRow>
                </FrameGroup>

                {/* ── Поперечное сечение ─────────────────────────────── */}
                <FrameGroup title="Поперечное сечение">
                  <LabeledRow label="Форма сечения:">
                    <select value={selectedBranch.shape}
                      onChange={(e) => updateBranch(selectedBranch.id, { shape: e.target.value as TopoBranch["shape"], manualSection: e.target.value === "custom" })}
                      className="cad-input flex-1">
                      <option value="round">Круглое</option>
                      <option value="rect">Прямоугольное</option>
                      <option value="trap">Трапециевидное</option>
                      <option value="arch">Арочное (со сводом)</option>
                      <option value="custom">Задано вручную</option>
                    </select>
                  </LabeledRow>

                  {selectedBranch.shape === "round" && (
                    <LabeledRow label="Диаметр D:">
                      <NumWithUnit value={selectedBranch.diameter} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { diameter: v })} />
                    </LabeledRow>
                  )}
                  {selectedBranch.shape === "rect" && (<>
                    <LabeledRow label="Ширина a:">
                      <NumWithUnit value={selectedBranch.rectWidth} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { rectWidth: v })} />
                    </LabeledRow>
                    <LabeledRow label="Высота b:">
                      <NumWithUnit value={selectedBranch.rectHeight} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { rectHeight: v })} />
                    </LabeledRow>
                  </>)}
                  {selectedBranch.shape === "trap" && (<>
                    <LabeledRow label="Низ a:">
                      <NumWithUnit value={selectedBranch.rectWidth} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { rectWidth: v })} />
                    </LabeledRow>
                    <LabeledRow label="Верх c:">
                      <NumWithUnit value={selectedBranch.trapTopWidth} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { trapTopWidth: v })} />
                    </LabeledRow>
                    <LabeledRow label="Высота h:">
                      <NumWithUnit value={selectedBranch.rectHeight} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { rectHeight: v })} />
                    </LabeledRow>
                  </>)}
                  {selectedBranch.shape === "arch" && (<>
                    <LabeledRow label="Ширина a:">
                      <NumWithUnit value={selectedBranch.rectWidth} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { rectWidth: v })} />
                    </LabeledRow>
                    <LabeledRow label="Высота стен b:">
                      <NumWithUnit value={selectedBranch.rectHeight} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { rectHeight: v })} />
                    </LabeledRow>
                    <LabeledRow label="Свод (полукруг):">
                      <span className="text-xs text-gray-500 flex-1">радиус a/2 = {(selectedBranch.rectWidth / 2).toFixed(2)} м</span>
                    </LabeledRow>
                  </>)}
                  {selectedBranch.shape === "custom" && (<>
                    <LabeledRow label="Площадь S:">
                      <NumWithUnit value={selectedBranch.area} unit="м²"
                        onChange={(v) => updateBranch(selectedBranch.id, { area: v })} />
                    </LabeledRow>
                    <LabeledRow label="Периметр P:">
                      <NumWithUnit value={selectedBranch.perimeter} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { perimeter: v })} />
                    </LabeledRow>
                  </>)}

                  <div className="pt-1 mt-1 border-t border-gray-200">
                    <ComputedRow label="Площадь S:" value={`${selectedBranch.area.toFixed(2)} м²`} />
                    <ComputedRow label="Периметр P:" value={`${selectedBranch.perimeter.toFixed(2)} м`} />
                    <ComputedRow label="Гидр. диаметр Dh:" value={`${selectedBranch.dh.toFixed(2)} м`} />
                  </div>
                </FrameGroup>

                {/* ── Длина выработки ───────────────────────────────── */}
                <FrameGroup title="Длина выработки">
                  <LabeledRow label="Способ:">
                    <select value={selectedBranch.manualLength ? "manual" : "auto"}
                      onChange={(e) => updateBranch(selectedBranch.id, { manualLength: e.target.value === "manual" })}
                      className="cad-input flex-1">
                      <option value="auto">Автоматически (по координатам)</option>
                      <option value="manual">Задаётся вручную</option>
                    </select>
                  </LabeledRow>
                  <LabeledRow label="Длина L:">
                    {selectedBranch.manualLength ? (
                      <NumWithUnit value={selectedBranch.length} unit="м"
                        onChange={(v) => updateBranch(selectedBranch.id, { length: v })} />
                    ) : (
                      <ComputedRow label="" value={`${selectedBranch.length} м`} />
                    )}
                  </LabeledRow>
                </FrameGroup>

                {/* ── Аэродинамическое сопротивление ────────────────── */}
                <FrameGroup title="Аэродинамическое сопротивление">
                  <LabeledRow label="Способ задания:">
                    <select value={selectedBranch.resistanceMode}
                      onChange={(e) => updateBranch(selectedBranch.id, { resistanceMode: e.target.value as TopoBranch["resistanceMode"] })}
                      className="cad-input flex-1">
                      <option value="surface">По типу поверхности (ВНИИГД)</option>
                      <option value="alpha">По коэффициенту α</option>
                      <option value="roughness">По шероховатости Δ</option>
                      <option value="manual">Вручную (R)</option>
                    </select>
                  </LabeledRow>

                  {selectedBranch.resistanceMode === "surface" && (
                    <LabeledRow label="Поверхность:">
                      <select value={selectedBranch.surfaceId}
                        onChange={(e) => {
                          const s = SURFACE_TYPES.find((x) => x.id === e.target.value);
                          if (s) updateBranch(selectedBranch.id, {
                            surfaceId: s.id, surface: s.name, alphaCoef: s.alpha, roughness: s.roughness,
                          });
                        }}
                        className="cad-input flex-1">
                        {SURFACE_TYPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </LabeledRow>
                  )}

                  {(selectedBranch.resistanceMode === "alpha" || selectedBranch.resistanceMode === "surface") && (
                    <LabeledRow label="Коэф-т α:">
                      {selectedBranch.resistanceMode === "alpha" ? (
                        <NumWithUnit value={selectedBranch.alphaCoef} unit="·10⁻⁴"
                          onChange={(v) => updateBranch(selectedBranch.id, { alphaCoef: v })} />
                      ) : (
                        <ComputedRow label="" value={`${selectedBranch.alphaCoef} ·10⁻⁴ Н·с²/м⁴`} />
                      )}
                    </LabeledRow>
                  )}

                  {selectedBranch.resistanceMode === "roughness" && (
                    <LabeledRow label="Шероховатость Δ:">
                      <NumWithUnit value={selectedBranch.roughness} unit="мм"
                        onChange={(v) => updateBranch(selectedBranch.id, { roughness: v })} />
                    </LabeledRow>
                  )}

                  {selectedBranch.resistanceMode === "manual" && (
                    <LabeledRow label="Сопротивление R:">
                      <NumWithUnit value={selectedBranch.manualR} unit="кμ"
                        onChange={(v) => updateBranch(selectedBranch.id, { manualR: v })} />
                    </LabeledRow>
                  )}

                  <LabeledRow label="Местные ξ (сумма):">
                    <NumWithUnit value={selectedBranch.localXi} unit="—"
                      onChange={(v) => updateBranch(selectedBranch.id, { localXi: v })} />
                  </LabeledRow>
                </FrameGroup>

                {/* ── Воздушный поток (вход) ───────────────────────── */}
                <FrameGroup title="Воздушный поток">
                  <LabeledRow label="Расход Q:">
                    <NumWithUnit value={selectedBranch.flow} unit="м³/с"
                      onChange={(v) => updateBranch(selectedBranch.id, { flow: v })} />
                  </LabeledRow>
                  <LabeledRow label="V max доп.:">
                    <NumWithUnit value={selectedBranch.vMax} unit="м/с"
                      onChange={(v) => updateBranch(selectedBranch.id, { vMax: v })} />
                  </LabeledRow>
                </FrameGroup>

                {/* ── Вентилятор ────────────────────────────────────── */}
                <FrameGroup title="Вентилятор (источник напора)">
                  <LabeledRow label="Установлен:">
                    <input type="checkbox" checked={selectedBranch.hasFan}
                      onChange={(e) => updateBranch(selectedBranch.id, { hasFan: e.target.checked })}
                      className="w-[13px] h-[13px] cursor-pointer" />
                  </LabeledRow>
                  {selectedBranch.hasFan && (<>
                    <LabeledRow label="Режим задания:">
                      <select value={selectedBranch.fanMode}
                        onChange={(e) => updateBranch(selectedBranch.id, { fanMode: e.target.value as "constant" | "curve" })}
                        className="cad-input flex-1">
                        <option value="constant">Постоянная депрессия</option>
                        <option value="curve">Q-H характеристика</option>
                      </select>
                    </LabeledRow>

                    {selectedBranch.fanMode === "constant" && (<>
                      <LabeledRow label="Название:">
                        <input type="text" value={selectedBranch.fanName}
                          onChange={(e) => updateBranch(selectedBranch.id, { fanName: e.target.value })}
                          className="cad-input flex-1" placeholder="напр. ВЦ-32" />
                      </LabeledRow>
                      <LabeledRow label="Депрессия H:">
                        <NumWithUnit value={selectedBranch.fanPressure} unit="Па"
                          onChange={(v) => updateBranch(selectedBranch.id, { fanPressure: v })} />
                      </LabeledRow>
                    </>)}

                    {selectedBranch.fanMode === "curve" && (<>
                      <LabeledRow label="Модель:">
                        <select value={selectedBranch.fanCurveId}
                          onChange={(e) => {
                            const f = getFanById(e.target.value);
                            updateBranch(selectedBranch.id, {
                              fanCurveId: e.target.value,
                              fanName: f?.name ?? "",
                            });
                          }}
                          className="cad-input flex-1">
                          <option value="">— выберите вентилятор —</option>
                          {FAN_CATALOG.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </LabeledRow>

                      {selectedBranch.fanCurveId && (() => {
                        const curve = getFanById(selectedBranch.fanCurveId);
                        if (!curve) return null;
                        // Эквивалентное сопротивление сети «увиденное» вентилятором:
                        // R_экв ≈ ΔP_сети / Q² (без депрессии вентилятора)
                        const Q = Math.abs(selectedBranch.flow);
                        const Rnet = Q > 0.1 ? Math.max(0, (selectedBranch.fanPressure) / (Q * Q)) : selectedBranch.resistance;
                        return (<>
                          <div className="px-1 py-1 bg-gray-50 rounded">
                            <FanCurveChart curve={curve}
                              netResistance={Rnet}
                              workingQ={Q}
                              workingH={selectedBranch.fanPressure}
                              width={300} height={180} />
                          </div>
                          <div className="pt-1 mt-1 border-t border-gray-200">
                            <ComputedRow label="Q раб.:" value={`${Q.toFixed(1)} м³/с`} />
                            <ComputedRow label="H раб.:" value={`${selectedBranch.fanPressure.toFixed(0)} Па`} />
                            <ComputedRow label="КПД η:" value={`${(selectedBranch.fanEfficiency * 100).toFixed(1)} %`} />
                            <ComputedRow label="N на валу:" value={`${(selectedBranch.fanShaftPower / 1000).toFixed(2)} кВт`} />
                            <ComputedRow label="Q ном.:" value={`${curve.qNominal} м³/с`} />
                            <ComputedRow label="Диапазон Q:" value={`${curve.qMin}…${curve.qMax} м³/с`} />
                          </div>
                        </>);
                      })()}
                    </>)}

                    <div className="text-[10px] text-gray-500 pl-1 pt-1">
                      Положительное направление: {selectedBranch.fromId} → {selectedBranch.toId}
                    </div>
                  </>)}
                </FrameGroup>

                {/* ── Вычисленные параметры ────────────────────────── */}
                <FrameGroup title="Вычисленные параметры">
                  <ComputedRow label="R (трение):" value={`${(selectedBranch.rFriction * 1000).toFixed(4)} ·10⁻³ кμ`} />
                  <ComputedRow label="R (местные):" value={`${(selectedBranch.rLocal * 1000).toFixed(4)} ·10⁻³ кμ`} />
                  <ComputedRow label="R общее:" value={`${(selectedBranch.resistance * 1000).toFixed(4)} ·10⁻³ кμ`} />
                  {selectedBranch.resistanceMode === "roughness" && (
                    <ComputedRow label="λ (Дарси):" value={selectedBranch.lambda.toFixed(4)} />
                  )}
                  <ComputedRow label="Скорость V:" value={`${selectedBranch.velocity.toFixed(2)} м/с${selectedBranch.velocity > selectedBranch.vMax ? " ⚠" : ""}`} />
                  <ComputedRow label="Депрессия ΔP:" value={`${selectedBranch.dP.toFixed(1)} Па`} />
                  <ComputedRow label="Энергозатраты N:" value={`${selectedBranch.power} Вт`} />
                  <ComputedRow label="Re (Рейнольдс):" value={`${(selectedBranch.reynolds / 1000).toFixed(0)} тыс.`} />
                </FrameGroup>
              </div>
            )}

            {/* Пусто — нет выбора */}
            {activeSide === "params" && !selectedNode && !selectedBranch && (
              <div className="p-4 text-center text-gray-400 text-xs">
                Выделите узел или ветвь на схеме, чтобы редактировать параметры
              </div>
            )}

            {/* ═══ ВКЛАДКА: ОБЩИЕ ════════════════════════════════════════ */}
            {activeSide === "general" && (
              <div className="p-2 space-y-2">
                <FrameGroup title="Общие свойства">
                  <LabeledRow label="Название:" labelWidth={88}>
                    <input type="text" value={excavation.name}
                      onChange={(e) => setExcavation({ ...excavation, name: e.target.value })}
                      className="cad-input flex-1" />
                  </LabeledRow>
                  <LabeledRow label="Номер:" labelWidth={88}>
                    <input type="text" value={excavation.number}
                      onChange={(e) => setExcavation({ ...excavation, number: e.target.value })}
                      className="cad-input flex-1" />
                  </LabeledRow>
                  <LabeledRow label="Ширина:" labelWidth={88}>
                    <div className="flex-1 flex items-center">
                      <input type="text" value={`${excavation.width} мм`}
                        onChange={(e) => {
                          const num = parseFloat(e.target.value);
                          if (!isNaN(num)) setExcavation({ ...excavation, width: num });
                        }}
                        className="cad-input flex-1 text-right" />
                    </div>
                  </LabeledRow>
                  <LabeledRow label="Граница:" labelWidth={88}>
                    <input type="text" value={`${excavation.border} мм`}
                      onChange={(e) => {
                        const num = parseFloat(e.target.value);
                        if (!isNaN(num)) setExcavation({ ...excavation, border: num });
                      }}
                      className="cad-input flex-1 text-right" />
                  </LabeledRow>

                  <LabeledRow label="Слой:" labelWidth={88}>
                    <select value={excavation.layer}
                      onChange={(e) => setExcavation({ ...excavation, layer: e.target.value })}
                      className="cad-input flex-1">
                      {LAYERS.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  </LabeledRow>

                  {/* Появление */}
                  <LabeledRow label="Появление:" labelWidth={88}>
                    <div className="flex-1 flex items-center gap-1">
                      <input type="text" value={excavation.appearYear}
                        onChange={(e) => setExcavation({ ...excavation, appearYear: e.target.value })}
                        placeholder="Год"
                        className="cad-input w-12 text-center" />
                      <input type="text" value={excavation.appearMonth}
                        onChange={(e) => setExcavation({ ...excavation, appearMonth: e.target.value })}
                        placeholder="Месяц"
                        className="cad-input flex-1 text-center" />
                      <input type="text" value={excavation.appearDay}
                        onChange={(e) => setExcavation({ ...excavation, appearDay: e.target.value })}
                        placeholder="День"
                        className="cad-input w-10 text-center" />
                      <input type="text" value={excavation.appearTime}
                        onChange={(e) => setExcavation({ ...excavation, appearTime: e.target.value })}
                        className="cad-input w-12 text-center" />
                      <button onClick={() => setExcavation({ ...excavation, appearYear: "", appearMonth: "", appearDay: "", appearTime: "" })}
                        className="w-5 h-5 flex items-center justify-center hover:bg-red-100 rounded"
                        title="Очистить">
                        <Icon name="Trash2" size={11} className="text-gray-600" />
                      </button>
                    </div>
                  </LabeledRow>

                  {/* Исчезновение */}
                  <LabeledRow label="Исчезновение:" labelWidth={88}>
                    <div className="flex-1 flex items-center gap-1">
                      <input type="text" value={excavation.disappearYear}
                        onChange={(e) => setExcavation({ ...excavation, disappearYear: e.target.value })}
                        placeholder="Год"
                        className="cad-input w-12 text-center text-gray-400" />
                      <input type="text" value={excavation.disappearMonth}
                        onChange={(e) => setExcavation({ ...excavation, disappearMonth: e.target.value })}
                        placeholder="Месяц"
                        className="cad-input flex-1 text-center text-gray-400" />
                      <input type="text" value={excavation.disappearDay}
                        onChange={(e) => setExcavation({ ...excavation, disappearDay: e.target.value })}
                        placeholder="День"
                        className="cad-input w-10 text-center text-gray-400" />
                      <input type="text" value={excavation.disappearTime}
                        onChange={(e) => setExcavation({ ...excavation, disappearTime: e.target.value })}
                        className="cad-input w-12 text-center text-gray-400" />
                      <button onClick={() => setExcavation({ ...excavation, disappearYear: "", disappearMonth: "", disappearDay: "", disappearTime: "" })}
                        className="w-5 h-5 flex items-center justify-center hover:bg-red-100 rounded"
                        title="Очистить">
                        <Icon name="Trash2" size={11} className="text-gray-600" />
                      </button>
                    </div>
                  </LabeledRow>

                  <div className="pt-1 space-y-0.5">
                    <CadCheckbox
                      checked={excavation.isVertical}
                      onChange={(v) => setExcavation({ ...excavation, isVertical: v })}
                      label="Вертикальная выработка (ходок)" />
                    <CadCheckbox
                      checked={excavation.dashedBorder}
                      onChange={(v) => setExcavation({ ...excavation, dashedBorder: v })}
                      label="Пунктирная граница" />
                    <CadCheckbox
                      checked={excavation.ignoreLayerColor}
                      onChange={(v) => setExcavation({ ...excavation, ignoreLayerColor: v })}
                      label="Игнорировать цвет слоя" />
                  </div>
                </FrameGroup>

                <FrameGroup title="Электроснабжение">
                  <CadCheckbox
                    checked={excavation.cable04}
                    onChange={(v) => setExcavation({ ...excavation, cable04: v })}
                    label="Силовой кабель 0,4/0,66 кВ" />
                  <CadCheckbox
                    checked={excavation.cable6}
                    onChange={(v) => setExcavation({ ...excavation, cable6: v })}
                    label="Силовой кабель 6 кВ" />
                </FrameGroup>

                {/* ── Стиль линий ветвей (общая настройка для всех ветвей) ── */}
                <FrameGroup title="Ширина и граница ветвей">
                  <LabeledRow label="Ширина линии:" labelWidth={108}>
                    <NumWithUnit value={branchWidth} unit="px"
                      onChange={(v) => setBranchWidth(Math.max(0.5, Math.min(8, v)))} />
                  </LabeledRow>
                  <LabeledRow label="Контурная обводка:" labelWidth={108}>
                    <NumWithUnit value={branchBorder} unit="px"
                      onChange={(v) => setBranchBorder(Math.max(0, Math.min(4, v)))} />
                  </LabeledRow>
                  <div className="text-[10px] text-gray-500 px-1">
                    Контур = тёмная окантовка вокруг линии (0 — без обводки).
                  </div>
                  <div className="pt-1">
                    <CadCheckbox checked={thinLines} onChange={setThinLines}
                      label="Тонкие линии 1px (вкл/откл — F6)" />
                    <CadCheckbox checked={colorByHorizon} onChange={setColorByHorizon}
                      label="Окрашивать ветви по цвету горизонта" />
                  </div>
                </FrameGroup>
              </div>
            )}

            {/* ═══ ВКЛАДКА: ГОРИЗОНТЫ ═══════════════════════════════════ */}
            {activeSide === "horizons" && (
              <div className="p-2 space-y-2">
                <FrameGroup title="Горизонты сети">
                  <div className="text-[10px] text-gray-600 leading-tight pb-1">
                    Группировка ветвей по высотным отметкам, как в АэроСеть.
                    Скрытие горизонта прячет все его ветви на схеме.
                  </div>
                  <div className="space-y-1">
                    {horizons.map((h) => {
                      const usedCount = branches.filter((b) => b.horizonId === h.id).length;
                      return (
                        <div key={h.id} className="flex items-center gap-1 border border-gray-300 rounded px-1 py-1 bg-white">
                          <input type="checkbox" checked={h.visible}
                            onChange={(e) => updateHorizon(h.id, { visible: e.target.checked })}
                            title="Видимость" className="w-[13px] h-[13px] cursor-pointer flex-shrink-0" />
                          <input type="color" value={h.color}
                            onChange={(e) => updateHorizon(h.id, { color: e.target.value })}
                            className="w-6 h-6 p-0 border border-gray-300 cursor-pointer flex-shrink-0"
                            title="Цвет горизонта" />
                          <input type="text" value={h.name}
                            onChange={(e) => updateHorizon(h.id, { name: e.target.value })}
                            className="cad-input flex-1 min-w-0"
                            placeholder="Название" />
                          <input type="number" value={h.z}
                            onChange={(e) => updateHorizon(h.id, { z: Number(e.target.value) })}
                            className="cad-input w-16 text-right"
                            title="Высотная отметка, м" />
                          <span className="text-[10px] text-gray-500 flex-shrink-0">м</span>
                          <span className="text-[10px] text-gray-400 w-7 text-center" title="Ветвей на горизонте">
                            {usedCount}
                          </span>
                          <button onClick={() => removeHorizon(h.id)}
                            className="w-5 h-5 flex items-center justify-center hover:bg-red-100 rounded flex-shrink-0"
                            title="Удалить горизонт">
                            <Icon name="Trash2" size={11} className="text-gray-600" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={addHorizon}
                    className="mt-2 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-blue-50 hover:border-blue-400 flex items-center gap-1">
                    <Icon name="Plus" size={11} /> Добавить горизонт
                  </button>
                </FrameGroup>

                <FrameGroup title="Быстрые действия">
                  <div className="flex gap-1">
                    <button onClick={() => setHorizons((p) => p.map((h) => ({ ...h, visible: true })))}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-blue-50">
                      Показать все
                    </button>
                    <button onClick={() => setHorizons((p) => p.map((h) => ({ ...h, visible: false })))}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-blue-50">
                      Скрыть все
                    </button>
                  </div>
                  <CadCheckbox checked={colorByHorizon} onChange={setColorByHorizon}
                    label="Окрашивать ветви по цвету горизонта" />
                </FrameGroup>
              </div>
            )}

            {/* ═══ ВКЛАДКА: ВЕНТИЛЯЦИЯ ═════════════════════════════════ */}
            {activeSide === "vent" && (
              <>
                <PropGroup title="Тип выработки">
                  <SelectRow value={excavation.type} options={["Ствол ЮВС", "Ствол СВС", "Квершлаг", "Штрек", "Уклон", "Камера"]}
                    onChange={(v) => setExcavation({ ...excavation, type: v })} />
                </PropGroup>

                <PropGroup title="Поперечное сечение">
                  <SelectRow value="Круглое" options={["Круглое", "Прямоугольное", "Трапециевидное", "Арочное"]}
                    onChange={() => {}} />
                  <FieldRow label="Площадь:" value={`${excavation.area} м²`} />
                  <CheckRow label="Тип:" caption="Задается вручную" />
                  <FieldRow label="Периметр:" value={`${excavation.perimeter} м`} />
                </PropGroup>

                <PropGroup title="Длина выработки">
                  <CheckRow label="Тип:" caption="Задается вручную" />
                  <FieldRow label="Длина:" value={`${excavation.length} м`} />
                </PropGroup>

                <PropGroup title="Аэродинамическое сопротивление">
                  <SelectRowLabeled label="Задается:" value="Проектными данными"
                    options={["Проектными данными", "По коэффициенту α", "По таблице ВНИИ", "Измеренное"]}
                    onChange={() => {}} />
                  <SelectRowLabeled label="Поверхность:" value={excavation.surface}
                    options={["Воздухоподающая выработка, без неровностей", "Бетонная крепь", "Деревянная крепь", "Анкерная крепь", "Незакреплённая"]}
                    onChange={(v) => setExcavation({ ...excavation, surface: v })} />
                  <FieldRow label="Коэф-т α:" value={`${excavation.alphaCoef.toFixed(3)} кг/м³`} />
                </PropGroup>

                <PropGroup title="Скорость воздуха">
                  <CheckRow label="Тип:" caption="Задается вручную" />
                  <FieldRow label="V max:" value={`${excavation.vMax} м/с`} />
                </PropGroup>

                <PropGroup title="Вычисленные параметры">
                  <FieldRow label="Сопротив-ие:" value={`${excavation.resistance.toFixed(6)} кМюрг`} computed />
                  <FieldRow label="Расход:" value={`${excavation.flow} м³/с`} computed />
                  <FieldRow label="V воздуха:" value={`${excavation.velocity} м/с`} computed />
                  <FieldRow label="ΔP:" value={`${excavation.dP} Па`} computed />
                  <FieldRow label="Энергозат-ы:" value={`${excavation.power} Вт`} computed />
                </PropGroup>
              </>
            )}

            {/* ═══ ОСТАЛЬНЫЕ ВКЛАДКИ ═════════════════════════════════════ */}
            {(activeSide === "thermo" || activeSide === "accidents" || activeSide === "areas"
              || activeSide === "indicators" || activeSide === "coords"
              || activeSide === "measure" || activeSide === "pipes") && (
              <div className="p-4 text-center text-gray-400 text-xs">
                Вкладка «{activeSide}» в разработке
              </div>
            )}
          </div>
        </div>

        {/* ── РАЗДЕЛИТЕЛЬ ШИРИНЫ ЛЕВОЙ ПАНЕЛИ (drag) ───────────────── */}
        <div onMouseDown={startLeftDrag}
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors"
          style={{ background: "#d0d0d0" }}
          title="Перетащите, чтобы изменить ширину панели" />

        {/* ── РАБОЧАЯ ОБЛАСТЬ (CANVAS + ИНСТРУМЕНТЫ) ────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#ffffff" }}>

          {/* Локальная панель инструментов рисования */}
          <div className="h-8 flex items-center gap-1 px-2"
            style={{ background: "#f5f5f5", borderBottom: "1px solid #d0d0d0" }}>
            <ToolBtn icon="MousePointer2" label="Выбрать" active={tool === "select"} onClick={() => setTool("select")} />
            <ToolBtn icon="Plus" label="Узел" active={tool === "node"} onClick={() => setTool("node")} />
            <ToolBtn icon="GitBranch" label="Ветвь" active={tool === "branch"} onClick={() => setTool("branch")} />
            <ToolBtn icon="Move" label="Панорама" active={tool === "pan"} onClick={() => setTool("pan")} />
            <ToolBtn icon="RotateCw" label="Вращать 3D" active={tool === "rotate"} onClick={() => setTool("rotate")} />
            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />
            <ToolBtn icon="Trash2" label="Удалить" disabled={!selectedNodeId && !selectedBranchId}
              onClick={handleDeleteSelected} />
            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Ракурсы ── */}
            <span className="text-[11px] text-gray-700">Вид:</span>
            <ViewBtn label="План" preset="plan" current={viewInfo} onClick={setPreset} hint="XY сверху" />
            <ViewBtn label="Фронт" preset="front" current={viewInfo} onClick={setPreset} hint="XZ спереди" />
            <ViewBtn label="Профиль" preset="left" current={viewInfo} onClick={setPreset} hint="YZ сбоку" />
            <ViewBtn label="ИЗО⤴" preset="isoSE" current={viewInfo} onClick={setPreset} hint="Изометрия Ю-В" />
            <ViewBtn label="ИЗО⤵" preset="isoSW" current={viewInfo} onClick={setPreset} hint="Изометрия Ю-З" />

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Направление потока ── */}
            <span className="text-[11px] text-gray-700" title="Способ показа направления воздушного потока">Поток:</span>
            <div className="flex border border-gray-300 rounded overflow-hidden">
              <FlowBtn label="Анимация" active={flowDisplay === "flow"}
                onClick={() => setFlowDisplay("flow")} hint="Бегущий пунктир в направлении потока" />
              <FlowBtn label="Стрелки" active={flowDisplay === "chevrons"}
                onClick={() => setFlowDisplay("chevrons")} hint="Шевроны вдоль ветви" />
              <FlowBtn label="Оба" active={flowDisplay === "both"}
                onClick={() => setFlowDisplay("both")} hint="Анимация + шевроны" />
              <FlowBtn label="Откл" active={flowDisplay === "off"}
                onClick={() => setFlowDisplay("off")} hint="Без индикации направления (по умолчанию)" />
            </div>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Расчёт воздухораспределения (F9) ── */}
            <button onClick={handleSolve}
              className="h-6 px-2 flex items-center gap-1 rounded text-[11px]"
              style={{ background: "#16a34a", color: "white", border: "1px solid #15803d" }}
              title="Запустить расчёт воздухораспределения (F9)">
              <Icon name="Play" size={11} /> Расчёт <span className="opacity-80 text-[10px]">F9</span>
            </button>
            <button onClick={() => setShowFlowArrows((v) => !v)}
              className="h-6 px-2 flex items-center gap-1 rounded text-[11px]"
              style={{
                background: showFlowArrows ? "#dc2626" : "white",
                color: showFlowArrows ? "white" : "#1f1f1f",
                border: "1px solid " + (showFlowArrows ? "#b91c1c" : "#d0d0d0"),
              }}
              title="Показать стрелки направления свежей струи">
              <Icon name="ArrowRight" size={11} /> Стрелки
            </button>
            <button onClick={() => setThinLines((v) => !v)}
              className="h-6 px-2 flex items-center gap-1 rounded text-[11px]"
              style={{
                background: thinLines ? "#2563eb" : "white",
                color: thinLines ? "white" : "#1f1f1f",
                border: "1px solid " + (thinLines ? "#1d4ed8" : "#d0d0d0"),
              }}
              title="Тонкие линии 1px вкл/откл (F6)">
              <Icon name="Minus" size={11} /> Тонкие <span className="opacity-80 text-[10px]">F6</span>
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Рабочая плоскость для построения ── */}
            <span className="text-[11px] text-gray-700"
              title="Плоскость, в которой создаются и перемещаются узлы">Плоск:</span>
            <div className="flex border border-gray-300 rounded overflow-hidden">
              <FlowBtn label="Авто" active={workPlane === null}
                onClick={() => setWorkPlane(null)} hint="Подбирается по ракурсу автоматически" />
              <FlowBtn label="XY" active={workPlane?.axis === "z"}
                onClick={() => setWorkPlane({ axis: "z", value: zLevel })} hint={`Горизонтальная (Z = ${zLevel} м)`} />
              <FlowBtn label="XZ" active={workPlane?.axis === "y"}
                onClick={() => setWorkPlane({ axis: "y", value: 0 })} hint="Вертикальная (Y = 0 м)" />
              <FlowBtn label="YZ" active={workPlane?.axis === "x"}
                onClick={() => setWorkPlane({ axis: "x", value: 0 })} hint="Вертикальная (X = 0 м)" />
            </div>
            {workPlane && (
              <input type="number" value={workPlane.value} step={50}
                onChange={(e) => setWorkPlane({ ...workPlane, value: Number(e.target.value) })}
                className="cad-input text-[11px] py-0 w-16"
                title={`Значение по оси ${workPlane.axis.toUpperCase()} (м)`} />
            )}

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />
            <span className="text-[11px] text-gray-700">Z план:</span>
            <select value={zLevel} onChange={(e) => {
                const z = Number(e.target.value);
                setZLevel(z);
                // Если активна XY-плоскость в авто-режиме — синхронизируем её значение
                if (workPlane?.axis === "z") setWorkPlane({ axis: "z", value: z });
              }}
              className="cad-input text-[11px] py-0">
              <option value="0">0 м</option>
              <option value="-75">−75 м</option>
              <option value="-150">−150 м</option>
              <option value="-240">−240 м</option>
              <option value="-360">−360 м</option>
              <option value="-480">−480 м</option>
            </select>
            <div className="ml-auto flex items-center gap-2 text-[11px] text-gray-600">
              <span className={viewInfo.is3D ? "text-purple-700 font-semibold" : ""}>
                {viewInfo.is3D ? "3D" : "2D"}
              </span>
              <span>·</span>
              <span>Узлов: <b>{nodes.length}</b></span>
              <span>·</span>
              <span>Ветвей: <b>{branches.length}</b></span>
            </div>
          </div>

          {/* Холст топологии */}
          <div className="flex-1 relative">
            <TopoCanvas
              nodes={nodes}
              branches={branches}
              selectedNodeId={selectedNodeId}
              selectedBranchId={selectedBranchId}
              tool={tool}
              zLevel={zLevel}
              viewPreset={viewPreset}
              onViewChange={setViewInfo}
              flowDisplay={flowDisplay}
              workPlane={workPlane}
              horizons={horizons}
              branchWidth={branchWidth}
              branchBorder={branchBorder}
              thinLines={thinLines}
              colorByHorizon={colorByHorizon}
              showFlowArrows={showFlowArrows}
              onNodeAdd={handleNodeAdd}
              onNodeMove={handleNodeMove}
              onBranchAdd={handleBranchAdd}
              onSelectNode={(id) => { setSelectedNodeId(id); if (id) setSelectedBranchId(null); }}
              onSelectBranch={(id) => { setSelectedBranchId(id); if (id) setSelectedNodeId(null); }}
            />

            {/* ── Кнопка-ручка для открытия/закрытия правой панели ── */}
            <button onClick={() => setRightPanelOpen((v) => !v)}
              className="absolute top-2 right-2 z-10 h-7 px-2 flex items-center gap-1 rounded text-[11px] shadow-sm"
              style={{ background: rightPanelOpen ? "#2563eb" : "#ffffff", color: rightPanelOpen ? "white" : "#1f1f1f", border: "1px solid #b8b8b8" }}
              title={rightPanelOpen ? "Скрыть панель свойств" : "Показать панель свойств"}>
              <Icon name={rightPanelOpen ? "PanelRightClose" : "PanelRightOpen"} size={13} />
              <span>{rightPanelOpen ? "Свернуть" : "Свойства"}</span>
            </button>
          </div>
        </div>

        {/* ── ПРАВАЯ ВЫДВИЖНАЯ ПАНЕЛЬ (узлы / ветви) ────────────────── */}
        {rightPanelOpen && (
          <div className="w-[340px] flex-shrink-0 flex flex-col"
            style={{ background: "#ffffff", borderLeft: "1px solid #b8b8b8" }}>
            {/* Табы */}
            <div className="flex border-b border-gray-300" style={{ background: "#f5f5f5" }}>
              <button onClick={() => setRightTab("node")}
                className="flex-1 h-8 text-xs flex items-center justify-center gap-1"
                style={{
                  background: rightTab === "node" ? "#ffffff" : "transparent",
                  borderBottom: rightTab === "node" ? "2px solid #2563eb" : "2px solid transparent",
                  fontWeight: rightTab === "node" ? 600 : 400,
                  color: rightTab === "node" ? "#2563eb" : "#444",
                }}>
                <Icon name="Circle" size={11} /> Узлы {selectedNode && `(${selectedNode.number || selectedNode.id})`}
              </button>
              <button onClick={() => setRightTab("branch")}
                className="flex-1 h-8 text-xs flex items-center justify-center gap-1"
                style={{
                  background: rightTab === "branch" ? "#ffffff" : "transparent",
                  borderBottom: rightTab === "branch" ? "2px solid #2563eb" : "2px solid transparent",
                  fontWeight: rightTab === "branch" ? 600 : 400,
                  color: rightTab === "branch" ? "#2563eb" : "#444",
                }}>
                <Icon name="GitBranch" size={11} /> Ветви {selectedBranch && `(${selectedBranch.id})`}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {/* ─── ВКЛАДКА: УЗЛЫ ───────────────────────────────── */}
              {rightTab === "node" && (
                selectedNode ? (
                  <>
                    <FrameGroup title="Узел">
                      <LabeledRow label="Название:">
                        <input type="text" value={selectedNode.name}
                          onChange={(e) => updateNode(selectedNode.id, { name: e.target.value })}
                          className="cad-input flex-1" />
                      </LabeledRow>
                      <LabeledRow label="Номер:">
                        <input type="text" value={selectedNode.number}
                          onChange={(e) => updateNode(selectedNode.id, { number: e.target.value })}
                          className="cad-input flex-1" />
                      </LabeledRow>
                    </FrameGroup>

                    <FrameGroup title="Координаты, м">
                      <LabeledRow label="X:">
                        <NumWithUnit value={selectedNode.x} unit="м"
                          onChange={(v) => updateNode(selectedNode.id, { x: v })} />
                      </LabeledRow>
                      <LabeledRow label="Y:">
                        <NumWithUnit value={selectedNode.y} unit="м"
                          onChange={(v) => updateNode(selectedNode.id, { y: v })} />
                      </LabeledRow>
                      <LabeledRow label="Z (высотная отметка):">
                        <NumWithUnit value={selectedNode.z} unit="м"
                          onChange={(v) => updateNode(selectedNode.id, { z: v })} />
                      </LabeledRow>
                    </FrameGroup>

                    {/* ── СВЯЗЬ С АТМОСФЕРОЙ — ключевой переключатель для расчёта ── */}
                    <FrameGroup title="Связь с атмосферой">
                      <div className="flex items-start gap-2 p-1">
                        <input type="checkbox" checked={selectedNode.atmosphereLink}
                          onChange={(e) => updateNode(selectedNode.id, { atmosphereLink: e.target.checked })}
                          className="w-4 h-4 mt-0.5 cursor-pointer flex-shrink-0" />
                        <div className="flex-1 text-xs leading-tight">
                          <div className="font-semibold text-gray-800">
                            Узел соединён с атмосферой
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            Включается для устьев стволов и порталов штолен —
                            точки входа/выхода воздуха в рудник.
                            Требуется для расчёта воздухораспределения (F9).
                          </div>
                        </div>
                      </div>
                      <div className="px-1 py-1 text-[11px]"
                        style={{
                          background: selectedNode.atmosphereLink ? "#dcfce7" : "#fef3c7",
                          color: selectedNode.atmosphereLink ? "#166534" : "#92400e",
                          border: "1px solid",
                          borderColor: selectedNode.atmosphereLink ? "#86efac" : "#fcd34d",
                          borderRadius: 3,
                        }}>
                        {selectedNode.atmosphereLink
                          ? "● Источник/сток воздуха для сети."
                          : "○ Внутренний узел сети (без обмена с атмосферой)."}
                      </div>
                      <div className="px-1 pt-1 text-[10px] text-gray-600">
                        Всего таких узлов в сети:{" "}
                        <b>{nodes.filter((n) => n.atmosphereLink).length}</b>
                        {" "}— минимум 2 (вход + выход) для корректного расчёта.
                      </div>
                    </FrameGroup>

                    <FrameGroup title="Климат и расчёт">
                      <LabeledRow label="Температура воздуха:">
                        <NumWithUnit value={selectedNode.airTemp} unit="°C"
                          onChange={(v) => updateNode(selectedNode.id, { airTemp: v })} />
                      </LabeledRow>
                      <LabeledRow label="Темп. стенок:">
                        <NumWithUnit value={selectedNode.wallTemp} unit="°C"
                          onChange={(v) => updateNode(selectedNode.id, { wallTemp: v })} />
                      </LabeledRow>
                      <LabeledRow label="Привед. давление:">
                        <NumWithUnit value={selectedNode.reducedPressure} unit="Па"
                          onChange={(v) => updateNode(selectedNode.id, { reducedPressure: v })} />
                      </LabeledRow>
                      <div className="pt-1 mt-1 border-t border-gray-200">
                        <ComputedRow label="Давление расч.:" value={`${selectedNode.computedPressure} Па`} />
                        <ComputedRow label="Темп. возд. расч.:" value={`${selectedNode.computedAirTemp} °C`} />
                      </div>
                    </FrameGroup>

                    <button onClick={handleDeleteSelected}
                      className="w-full px-2 py-1.5 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50 flex items-center justify-center gap-1">
                      <Icon name="Trash2" size={12} /> Удалить узел
                    </button>
                  </>
                ) : (
                  <div className="p-4 text-center text-gray-400 text-xs">
                    Выберите узел на схеме, чтобы редактировать его свойства.
                    <br />
                    Всего в сети: <b>{nodes.length}</b> узлов
                    {nodes.filter((n) => n.atmosphereLink).length > 0 && (
                      <>, из них с атмосферой: <b>{nodes.filter((n) => n.atmosphereLink).length}</b></>
                    )}
                  </div>
                )
              )}

              {/* ─── ВКЛАДКА: ВЕТВИ ──────────────────────────────── */}
              {rightTab === "branch" && (
                selectedBranch ? (
                  <>
                    <FrameGroup title="Ветвь">
                      <LabeledRow label="ID:">
                        <input type="text" value={selectedBranch.id} readOnly className="cad-input flex-1" />
                      </LabeledRow>
                      <LabeledRow label="Тип:">
                        <input type="text" value={selectedBranch.type}
                          onChange={(e) => updateBranch(selectedBranch.id, { type: e.target.value })}
                          className="cad-input flex-1" />
                      </LabeledRow>
                      <LabeledRow label="Направление:">
                        <span className="flex-1 px-2 py-1 text-xs bg-gray-100 border border-gray-300 rounded">
                          {selectedBranch.fromId} → {selectedBranch.toId}
                        </span>
                      </LabeledRow>
                      <LabeledRow label="Горизонт:">
                        <div className="flex-1 flex items-center gap-1">
                          <select value={selectedBranch.horizonId}
                            onChange={(e) => updateBranch(selectedBranch.id, { horizonId: e.target.value })}
                            className="cad-input flex-1">
                            <option value="">— без привязки —</option>
                            {horizons.map((h) => (
                              <option key={h.id} value={h.id}>{h.name} ({h.z} м)</option>
                            ))}
                          </select>
                          {selectedBranch.horizonId && (
                            <span className="w-3 h-3 rounded-sm border border-gray-400 flex-shrink-0"
                              style={{ background: horizons.find((h) => h.id === selectedBranch.horizonId)?.color || "#ccc" }}
                              title="Цвет горизонта" />
                          )}
                        </div>
                      </LabeledRow>
                    </FrameGroup>

                    <FrameGroup title="Геометрия">
                      <ComputedRow label="Длина L:" value={`${selectedBranch.length} м`} />
                      <ComputedRow label="Площадь S:" value={`${selectedBranch.area.toFixed(2)} м²`} />
                      <ComputedRow label="Периметр P:" value={`${selectedBranch.perimeter.toFixed(2)} м`} />
                      <ComputedRow label="Гидр. диаметр Dh:" value={`${selectedBranch.dh.toFixed(2)} м`} />
                    </FrameGroup>

                    <FrameGroup title="Аэродинамика">
                      <ComputedRow label="R общее:" value={`${(selectedBranch.resistance * 1000).toFixed(4)} ·10⁻³ кμ`} />
                      <ComputedRow label="Расход Q:" value={`${selectedBranch.flow.toFixed(1)} м³/с`} />
                      <ComputedRow label="Скорость V:" value={`${selectedBranch.velocity.toFixed(2)} м/с${selectedBranch.velocity > selectedBranch.vMax ? " ⚠" : ""}`} />
                      <ComputedRow label="Депрессия ΔP:" value={`${selectedBranch.dP.toFixed(1)} Па`} />
                      <ComputedRow label="Энергозатр. N:" value={`${selectedBranch.power} Вт`} />
                    </FrameGroup>

                    {selectedBranch.hasFan && (
                      <FrameGroup title="Вентилятор">
                        <LabeledRow label="Название:">
                          <input type="text" value={selectedBranch.fanName}
                            onChange={(e) => updateBranch(selectedBranch.id, { fanName: e.target.value })}
                            className="cad-input flex-1" />
                        </LabeledRow>
                        <ComputedRow label="H рабочее:" value={`${selectedBranch.fanPressure.toFixed(0)} Па`} />
                        <ComputedRow label="КПД η:" value={`${(selectedBranch.fanEfficiency * 100).toFixed(1)} %`} />
                      </FrameGroup>
                    )}

                    <button onClick={handleDeleteSelected}
                      className="w-full px-2 py-1.5 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50 flex items-center justify-center gap-1">
                      <Icon name="Trash2" size={12} /> Удалить ветвь
                    </button>
                  </>
                ) : (
                  <div className="p-4 text-center text-gray-400 text-xs">
                    Выберите ветвь на схеме, чтобы редактировать её свойства.
                    <br />
                    Всего в сети: <b>{branches.length}</b> ветвей
                  </div>
                )
              )}
            </div>

            {/* ── Подвал панели: быстрые действия ── */}
            <div className="border-t border-gray-300 p-2 flex gap-1" style={{ background: "#f5f5f5" }}>
              <button onClick={handleSolve}
                className="flex-1 h-7 text-xs rounded flex items-center justify-center gap-1"
                style={{ background: "#16a34a", color: "white" }}
                title="Расчёт воздухораспределения (F9)">
                <Icon name="Play" size={11} /> Расчёт (F9)
              </button>
              <button onClick={() => setThinLines((v) => !v)}
                className="h-7 px-2 text-xs rounded border border-gray-300 hover:bg-blue-50"
                style={{ background: thinLines ? "#dbeafe" : "white" }}
                title="Тонкие линии (F6)">
                <Icon name="Minus" size={11} /> F6
              </button>
              <button onClick={() => setShowFlowArrows((v) => !v)}
                className="h-7 px-2 text-xs rounded border border-gray-300 hover:bg-blue-50"
                style={{ background: showFlowArrows ? "#fee2e2" : "white" }}
                title="Стрелки направления свежей струи">
                <Icon name="ArrowRight" size={11} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ STATUS BAR ═══════════════════════════════════════════════════ */}
      <div className="h-5 flex items-center justify-between px-2 text-[11px]"
        style={{ background: "#f0f0f0", borderTop: "1px solid #b8b8b8", color: "#444" }}>
        <div className="flex items-center gap-3">
          <span>Готово</span>
          <span className="text-gray-400">|</span>
          {selectedNode && <span>Узел: <b>{selectedNode.number || selectedNode.id}</b> · X={selectedNode.x} Y={selectedNode.y} Z={selectedNode.z}</span>}
          {selectedBranch && <span>Ветвь: <b>{selectedBranch.id}</b> ({selectedBranch.fromId} → {selectedBranch.toId}) · L={selectedBranch.length} м</span>}
          {!selectedNode && !selectedBranch && <span>Выделите узел или ветвь</span>}
        </div>
        <div className="flex items-center gap-3">
          <span>Инструмент: <b>{toolLabel(tool)}</b></span>
          <span className="text-gray-400">|</span>
          <span style={{ color: viewInfo.is3D ? "#7c3aed" : "#0369a1", fontWeight: 600 }}>
            {viewInfo.is3D ? `3D · Az ${viewInfo.azimuth.toFixed(0)}° / El ${viewInfo.elevation.toFixed(0)}°` : "2D План"}
          </span>
          <span className="text-gray-400">|</span>
          <span>Z-уровень: {zLevel} м</span>
          <span className="text-gray-400">|</span>
          {solveResult ? (
            <span style={{ color: solveResult.ok ? "#16a34a" : "#dc2626" }}>
              ● Расчёт: {solveResult.ok ? "сошёлся" : "не сошёлся"} за {solveResult.iterations} итер.
            </span>
          ) : (
            <span style={{ color: "#9ca3af" }}>● Расчёт не выполнялся</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Ribbon-компоненты ──────────────────────────────────────────────────────

function RibbonTabBtn({ label, active, onClick, fileStyle, highlight }: {
  label: string; active: boolean; onClick: () => void; fileStyle?: boolean; highlight?: boolean;
}) {
  if (fileStyle) {
    return (
      <button onClick={onClick}
        className="px-3 h-6 text-xs text-white rounded-t-sm hover:brightness-110"
        style={{ background: "#2563eb", fontWeight: 500 }}>
        {label}
      </button>
    );
  }
  return (
    <button onClick={onClick}
      className="px-3 h-6 text-xs rounded-t-sm transition-colors"
      style={{
        background: active ? "#fafafa" : "transparent",
        borderTop: active ? "1px solid #b8b8b8" : "1px solid transparent",
        borderLeft: active ? "1px solid #b8b8b8" : "1px solid transparent",
        borderRight: active ? "1px solid #b8b8b8" : "1px solid transparent",
        marginBottom: active ? "-1px" : "0",
        color: highlight ? "#2563eb" : "#1f1f1f",
        fontWeight: active || highlight ? 600 : 400,
      }}>
      {label}
    </button>
  );
}

function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex items-stretch gap-1 px-1.5 pb-0.5">
        {children}
      </div>
      <div className="text-[10px] text-center text-gray-600 border-t border-gray-300 pt-0.5">{label}</div>
      <div style={{ width: "1px", background: "#d0d0d0", position: "absolute" }} />
    </div>
  );
}

function RibbonBigBtn({ icon, label, sublabel, disabled }: {
  icon: string; label: string; sublabel: string; disabled?: boolean;
}) {
  return (
    <button disabled={disabled}
      className="px-1.5 py-0.5 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded flex flex-col items-center justify-start gap-0.5 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-transparent min-w-[50px]"
      style={{ height: "100%" }}>
      <Icon name={icon} size={22} className="text-gray-700 mt-0.5" fallback="Square" />
      <div className="text-[10px] leading-tight text-center text-gray-800">
        <div>{label}</div>
        {sublabel && <div>{sublabel}</div>}
      </div>
    </button>
  );
}

function RibbonSmallBtn({ children }: { children: React.ReactNode }) {
  return (
    <button className="w-7 h-7 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded flex items-center justify-center">
      {children}
    </button>
  );
}

function PentagonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <path d="M8 1 L15 6 L12 14 L4 14 L1 6 Z" fill="none" stroke="#444" strokeWidth="1.2" />
    </svg>
  );
}
function RectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="10" fill="none" stroke="#444" strokeWidth="1.2" />
    </svg>
  );
}
function MiniSquareIcon({ variant }: { variant: number }) {
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];
  return (
    <svg width="14" height="14" viewBox="0 0 14 14">
      <rect x="2" y="2" width="10" height="10" fill={colors[variant - 1]} opacity="0.6" stroke={colors[variant - 1]} />
    </svg>
  );
}

// ─── Свойства ───────────────────────────────────────────────────────────────

function PropGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 py-1 text-xs font-semibold text-gray-800"
        style={{ background: "#f5f5f5", borderTop: "1px solid #e0e0e0", borderBottom: "1px solid #e0e0e0" }}>
        {title}
      </div>
      <div className="px-2 py-1 space-y-0.5">{children}</div>
    </div>
  );
}

function SelectRow({ value, options, onChange }: {
  value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

function SelectRowLabeled({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none min-w-0">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FieldRow({ label, value, computed }: { label: string; value: string; computed?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <input type="text" value={value} readOnly
        className="flex-1 text-xs px-1 py-0.5 border bg-white text-right font-mono"
        style={{
          borderColor: computed ? "#d0d0d0" : "#a0a0a0",
          background: computed ? "#fafafa" : "white",
          color: computed ? "#1f1f1f" : "#1f1f1f",
          fontWeight: computed ? 600 : 400,
        }} />
    </div>
  );
}

function CheckRow({ label, caption }: { label: string; caption: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-gray-600 w-[90px] flex-shrink-0">{label}</span>
      <label className="flex items-center gap-1 cursor-pointer">
        <input type="checkbox" className="w-3 h-3" />
        <span className="text-xs text-gray-700">{caption}</span>
      </label>
    </div>
  );
}

// ─── Группа в стиле Windows GroupBox (рамка с заголовком) ───────────────────
function FrameGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="relative pt-2 pb-2 px-2"
      style={{ border: "1px solid #b8b8b8", borderRadius: "0" }}>
      <legend className="px-1 text-xs text-gray-700"
        style={{ marginLeft: "4px", fontWeight: 400 }}>
        {title}
      </legend>
      <div className="space-y-1">
        {children}
      </div>
    </fieldset>
  );
}

// Строка с подписью слева (фиксированная ширина) и контентом справа.
// Подпись переносится по словам, чтобы при сужении левой панели текст не обрезался.
function LabeledRow({ label, children, labelWidth = 140 }: {
  label: string; children: React.ReactNode; labelWidth?: number;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="text-xs text-gray-700 flex-shrink-0 text-right whitespace-normal break-words leading-tight pt-1"
        style={{ width: labelWidth }}>{label}</span>
      {children}
    </div>
  );
}

function CadCheckbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 px-1 py-0.5 rounded">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="w-[13px] h-[13px] cursor-pointer" />
      <span className="text-xs text-gray-800">{label}</span>
    </label>
  );
}

// ─── Числовой инпут с единицей измерения справа ────────────────────────────
function NumWithUnit({ value, unit, onChange }: {
  value: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex-1 relative flex items-center">
      <input type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cad-input flex-1 text-right pr-7" />
      <span className="absolute right-2 text-xs text-gray-500 pointer-events-none">{unit}</span>
    </div>
  );
}

// ─── Строка вычисленного параметра (только чтение, серый фон) ──────────────
function ComputedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-1.5 py-0.5">
      <span className="text-xs text-gray-700 w-[140px] flex-shrink-0 text-right whitespace-normal break-words leading-tight pt-1">{label}</span>
      <div className="flex-1 min-w-0 px-2 py-1 text-right text-xs font-bold break-words"
        style={{ background: "#cfcfcf", color: "#1f1f1f", border: "1px solid #b8b8b8" }}>
        {value}
      </div>
    </div>
  );
}

// ─── Кнопка инструмента в локальной панели холста ──────────────────────────
function ToolBtn({ icon, label, active, onClick, disabled }: {
  icon: string; label: string; active?: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className="h-6 px-2 flex items-center gap-1 rounded text-[11px] disabled:opacity-40"
      style={{
        background: active ? "#2563eb" : "transparent",
        color: active ? "white" : "#1f1f1f",
        border: active ? "1px solid #1d4ed8" : "1px solid transparent",
      }}>
      <Icon name={icon} size={13} fallback="Square" />
      <span>{label}</span>
    </button>
  );
}

function toolLabel(t: CadTool): string {
  switch (t) {
    case "select": return "Выбор";
    case "node": return "Добавить узел";
    case "branch": return "Соединить ветвью";
    case "pan": return "Панорама";
    case "rotate": return "Вращение 3D";
    default: return "—";
  }
}

// ─── Кнопка ракурса в toolbar холста ───────────────────────────────────────
type ViewPresetName = "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE";
function ViewBtn({ label, preset, current, onClick, hint }: {
  label: string;
  preset: ViewPresetName;
  current: { is3D: boolean; azimuth: number; elevation: number };
  onClick: (p: ViewPresetName) => void;
  hint?: string;
}) {
  const PRESETS: Record<ViewPresetName, { az: number; el: number }> = {
    plan:  { az: 0,    el: 90 },
    front: { az: 0,    el: 0 },
    back:  { az: 180,  el: 0 },
    left:  { az: -90,  el: 0 },
    right: { az: 90,   el: 0 },
    isoSW: { az: -45,  el: 30 },
    isoSE: { az: 45,   el: 30 },
    isoNW: { az: -135, el: 30 },
    isoNE: { az: 135,  el: 30 },
  };
  const target = PRESETS[preset];
  const active = Math.abs(current.azimuth - target.az) < 1 && Math.abs(current.elevation - target.el) < 1;
  return (
    <button onClick={() => onClick(preset)} title={hint ?? label}
      className="h-6 px-2 flex items-center rounded text-[11px]"
      style={{
        background: active ? "#7c3aed" : "transparent",
        color: active ? "white" : "#1f1f1f",
        border: active ? "1px solid #5b21b6" : "1px solid #d0d0d0",
      }}>
      {label}
    </button>
  );
}

// ─── Кнопка переключения отображения потока (segmented control) ────────────
function FlowBtn({ label, active, onClick, hint }: {
  label: string; active: boolean; onClick: () => void; hint?: string;
}) {
  return (
    <button onClick={onClick} title={hint ?? label}
      className="h-6 px-2 text-[11px] border-r last:border-r-0 border-gray-300"
      style={{
        background: active ? "#0369a1" : "white",
        color: active ? "white" : "#1f1f1f",
      }}>
      {label}
    </button>
  );
}