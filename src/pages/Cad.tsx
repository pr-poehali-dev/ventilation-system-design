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
import NodePropsPanel from "@/components/cad/NodePropsPanel";
import BranchPropsPanel from "@/components/cad/BranchPropsPanel";
import CadContextMenu, { type ContextMenuItem } from "@/components/cad/CadContextMenu";
import InfoPanel from "@/components/cad/InfoPanel";
import { type InfoDisplayConfig, DEFAULT_INFO_CONFIG } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import DxfImportDialog from "@/components/cad/DxfImportDialog";
import { type DxfImportResult } from "@/lib/dxfImport";
import ExcelImportDialog from "@/components/cad/ExcelImportDialog";
import { type ExcelImportResult } from "@/lib/excelImport";
import CombinedImportDialog from "@/components/cad/CombinedImportDialog";
import { type CombinedImportResult } from "@/lib/combinedImport";
import CsvImportDialog from "@/components/cad/CsvImportDialog";
import { type CsvImportResult } from "@/lib/csvImport";
import EquipmentRefDialog, { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import LegendDialog from "@/components/cad/LegendDialog";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, WINDOW_BULKHEAD_IDS, OPEN_DOOR_IDS } from "@/lib/schemaSymbols";
import SelectSimilarDialog from "@/components/cad/SelectSimilarDialog";
import LogPanel, { type LogEntry } from "@/components/cad/LogPanel";
import FUNC2URL from "../../backend/func2url.json";

const AIRFLOW_URL = (FUNC2URL as Record<string, string>)["airflow"];

// ─────────────────────────────────────────────────────────────────────────────
// CAD-интерфейс шахтной/вентиляционной сети в стиле инженерного ПО
// (АэроСеть / Вентиляция-CAD): ribbon-меню + вертикальные вкладки + свойства
// ─────────────────────────────────────────────────────────────────────────────

type RibbonTab = "file" | "home" | "view" | "schema" | "vent" | "thermo" | "accidents" | "involve" | "pipes" | "costs" | "refs" | "general";

// Условное обозначение размещённое на схеме
export interface SchemaSymbol {
  id: string;
  typeId: string;   // id из LEGEND_ITEMS (medical, fan, bulkhead, ...)
  x: number;        // мировые координаты (если branchId=null)
  y: number;
  branchId: string | null; // к какой ветви привязано (null = свободное)
  t?: number;       // позиция вдоль ветви 0..1 (0=from, 1=to), если branchId != null
  offsetX?: number; // смещение от ветви (экранные px)
  offsetY?: number; // смещение от ветви (экранные px)
  scale?: number;   // масштаб (1 = по умолчанию)
  label?: string;   // подпись (например "5 чел.")
  description?: string; // описание (свободный текст)
  airDirection?: "forward" | "reverse"; // направление воздуха относительно ветви
  appearYear?: number;  // дата появления — год
  appearMonth?: string; // дата появления — месяц
  appearDay?: number;   // дата появления — день
  // ─── Индикаторы для перемычек ────────────────────────
  indDescription?: boolean;  // показывать описание объекта на схеме
  indResistance?: boolean;   // показывать аэродинамическое сопротивление
  indDeltaP?: boolean;       // показывать модельное падение давления
  indLeakage?: boolean;      // показывать утечки на перемычке
  indOffsetX?: number;       // смещение бейджа индикаторов (px экрана) по X
  indOffsetY?: number;       // смещение бейджа индикаторов (px экрана) по Y
  // ─── Индивидуальные параметры перемычки (хранятся в символе, не в ветви) ──
  bkResMode?: "project" | "survey" | "manual";
  bkWindowArea?: number;     // S окна/проёма, м²
  bkManualR?: number;        // вручную, кМюрг
  bkAirPerm?: number;        // воздухопроницаемость из справочника
  bkManualAirPerm?: boolean;
  bkCustomAirPerm?: number;
  bkSurveyQ?: number;
  bkSurveyDP?: number;
  bkBulkheadId?: string;     // ID из справочника перемычек
  bkBulkheadName?: string;
  bkBulkheadR?: number;      // R из справочника (Мюрг)
  bkFailurePressure?: number;
}
type SideTab = "params" | "measure" | "pipes" | "indicators" | "general" | "vent" | "thermo" | "areas" | "coords" | "horizons" | "topology" | "fan" | "waterpipes" | "conveyor";

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
  const [mineFans, setMineFans] = useState<MineFanExport[]>([
    { catalogId: "VOD-18", name: "ВО-18/12АВР", diameter: 1.8, rpmMin: 600, rpmMax: 1500 },
  ]);
  const [mineBulkheads, setMineBulkheads] = useState<MineBulkheadExport[]>([]);
  const [mineTypes, setMineTypes] = useState<BranchType[]>([]);

  // ─── Топология ─────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<TopoNode[]>(DEMO_NODES);
  const [branchesRaw, setBranches] = useState<TopoBranch[]>(DEMO_BRANCHES);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [tool, setTool] = useState<CadTool>("select");
  const [zLevel, setZLevel] = useState(0);

  // Авто-пересчёт длин и аэродинамики по координатам/параметрам
  const branches = useMemo(() => recalcAll(nodes, branchesRaw), [nodes, branchesRaw]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  // Переключаем вкладку при смене выбранного узла
  useEffect(() => {
    if (selectedNodeId) {
      setActiveSide("params");
    } else {
      setActiveSide("general");
    }
  }, [selectedNodeId]);

  // Если активна вкладка "fan", но у ветви нет вентилятора — сбросить на "topology"
  useEffect(() => {
    if (activeSide === "fan" && selectedBranch && !selectedBranch.hasFan) {
      setActiveSide("topology");
    }
  }, [selectedBranchId, selectedBranch?.hasFan]);

  const updateNode = (id: string, patch: Partial<TopoNode>) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  };

  // Ref для вызова расчёта из updateBranch (handleSolveLocal объявлен позже)
  const handleSolveRef = useRef<(() => void) | null>(null);

  const updateBranch = (id: string, patch: Partial<TopoBranch>) => {
    setBranches((prev) => prev.map((b) => b.id === id ? { ...b, ...patch } : b));

    // Синхронизируем УО перемычки при изменении hasBulkhead
    if ("hasBulkhead" in patch) {
      if (!patch.hasBulkhead) {
        // При снятии флага — удаляем ВСЕ символы перемычки с этой ветви
        setSchemaSymbols(prev => prev.filter(s => !(BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === id)));
      }
      // При установке hasBulkhead=true символ уже добавляется через onSymbolPlace — не дублируем
    }

    // Синхронизируем airDirection на символе вентилятора при изменении fanReverse
    if ("fanReverse" in patch) {
      setSchemaSymbols((prev) => prev.map((s) =>
        s.typeId === "fan" && s.branchId === id
          ? { ...s, airDirection: patch.fanReverse ? "reverse" : "forward" }
          : s
      ));
      // При переключении на реверс: если нет прямого расчёта — запускаем автоматически
      // (аналог reverse_fan() из эталона — сначала получаем q_norm, потом q_rev)
      if (patch.fanReverse === true && Object.keys(normalFlows).length === 0) {
        setTimeout(() => handleSolveRef.current?.(), 100);
      }
    }

    // Аналог disable_fan(): при остановке/запуске вентилятора — автопересчёт сети.
    // Это позволяет сразу увидеть критическую ситуацию (сеть не проветривается).
    if ("fanStopped" in patch) {
      setTimeout(() => handleSolveRef.current?.(), 100);
    }
  };

  // ─── ГОРИЗОНТЫ + АКТИВНЫЙ ГОРИЗОНТ (для построения новых узлов) ────
  // Каждый горизонт = слой ветвей с цветом и Z-отметкой; можно скрывать.
  // При выборе горизонта новые узлы создаются с его Z и привязкой horizonId.
  // Существующие объекты НЕ трогаются.
  // Стартовое состояние горизонтов: пытаемся восстановить из localStorage
  // (там лежат подложки PNG/JPG как dataURL — не теряются при обновлении страницы).
  const [horizons, setHorizons] = useState<Horizon[]>(() => {
    if (typeof window === "undefined") return DEFAULT_HORIZONS;
    try {
      const raw = window.localStorage.getItem("vent-cad/horizons-v3");
      if (!raw) return DEFAULT_HORIZONS;
      const parsed = JSON.parse(raw) as Horizon[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* игнорируем повреждённые данные */ }
    return DEFAULT_HORIZONS;
  });
  // Сохраняем горизонты при каждом изменении.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("vent-cad/horizons-v3", JSON.stringify(horizons)); }
    catch { /* квота переполнена — пропускаем */ }
  }, [horizons]);
  const [activeHorizonId, setActiveHorizonId] = useState<string>("");
  // ID горизонта, у которого пользователь редактирует подложку (тащит углы).
  const [editingHorizonImageId, setEditingHorizonImageId] = useState<string | null>(null);
  const activeHorizon = horizons.find((h) => h.id === activeHorizonId) ?? null;
  const updateHorizon = (id: string, patch: Partial<Horizon>) =>
    setHorizons((p) => p.map((h) => h.id === id ? { ...h, ...patch } : h));
  const addHorizon = () => {
    const id = `H_${Date.now()}`;
    setHorizons((p) => [...p, { id, name: `Горизонт ${p.length + 1}`, z: 0, color: "#64748b", visible: true }]);
  };
  const removeHorizon = (id: string) => {
    setHorizons((p) => p.filter((h) => h.id !== id));
    setBranches((p) => p.map((b) => b.horizonId === id ? { ...b, horizonId: "" } : b));
    if (activeHorizonId === id) setActiveHorizonId("");
    if (editingHorizonImageId === id) setEditingHorizonImageId(null);
  };
  const setHorizonImageBounds = (
    id: string, bounds: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    setHorizons((p) => p.map((h) => {
      if (h.id !== id || !h.image) return h;
      return { ...h, image: { ...h.image, bounds } };
    }));
  };

  // Загрузка картинки в подложку: читаем файл, сжимаем до 2000 px по большей стороне,
  // сохраняем как dataURL в state. По умолчанию ставим bounds = ±1000 м вокруг 0.
  const uploadHorizonImage = async (horizonId: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Поддерживаются только изображения PNG/JPG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        // Сжимаем до 2000 px по большей стороне, чтобы dataURL не раздувал state.
        const MAX = 2000;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > MAX) {
          const k = MAX / Math.max(w, h);
          w = Math.round(w * k); h = Math.round(h * k);
        }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = cv.toDataURL("image/jpeg", 0.85);
        // Подгоняем bounds под пропорции картинки и центр в (0,0)
        const aspect = w / h;
        const halfH = 1000;
        const halfW = halfH * aspect;
        setHorizons((p) => p.map((hz) => hz.id === horizonId ? {
          ...hz,
          image: {
            dataUrl: compressed,
            bounds: { x1: -halfW, y1: -halfH, x2: halfW, y2: halfH },
            opacity: 0.6,
            visible: true,
          },
        } : hz));
        setEditingHorizonImageId(horizonId);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const removeHorizonImage = (id: string) => {
    setHorizons((p) => p.map((h) => h.id === id ? { ...h, image: undefined } : h));
    if (editingHorizonImageId === id) setEditingHorizonImageId(null);
  };

  // Возвращает следующий уникальный числовой ID для узла (учитывает удаления).
  const nextNodeId = (existing: TopoNode[] = nodes): string => {
    const used = new Set(existing.map((n) => n.id));
    let i = 1;
    while (used.has(String(i))) i++;
    return String(i);
  };
  const nextBranchId = (existing: TopoBranch[] = branchesRaw): string => {
    const used = new Set(existing.map((b) => b.id));
    let i = 1;
    while (used.has(String(i))) i++;
    return String(i);
  };

  // Создаёт узел в указанной мировой точке. Если активен горизонт —
  // навязывает его Z и horizonId. Возвращает ID созданного узла.
  const handleNodeAdd = (x: number, y: number, z: number): string => {
    const newId = nextNodeId();
    const finalZ = activeHorizon ? activeHorizon.z : z;
    const node = makeNode(newId, {
      x, y, z: finalZ,
      name: `Узел ${newId}`,
      number: newId,
    });
    setNodes((p) => [...p, node]);
    setSelectedNodeId(newId);
    setSelectedBranchId(null);
    // ИНСТРУМЕНТ НЕ СБРАСЫВАЕТСЯ — каждый клик добавляет следующий узел.
    return newId;
  };

  const handleBranchAdd = (fromId: string, toId: string): string => {
    const id = nextBranchId();
    // Если активен горизонт — навешиваем привязку на ветвь
    const horizonId = activeHorizon ? activeHorizon.id : "";
    const b = makeBranch(id, fromId, toId, { horizonId });
    setBranches((p) => [...p, b]);
    setSelectedBranchId(id);
    setSelectedNodeId(null);
    // ИНСТРУМЕНТ НЕ СБРАСЫВАЕТСЯ — продолжаем строить цепочку ветвей.
    return id;
  };

  // ─── РАЗДЕЛЕНИЕ ВЕТВИ НОВЫМ УЗЛОМ ───────────────────────────────────
  // Используется когда инструмент «Узел» кликает прямо на существующую ветвь
  // (snap к ветви) или из меню «Разделить выработку».
  // Логика: A→B превращается в A→N (id ветви сохраняется) и N→B (новая ветвь).
  // Параметры старой ветви (тип, сечение, поверхность, горизонт, флаг вентилятора)
  // переносятся на оба сегмента.
  const handleSplitBranchAt = (branchId: string, x: number, y: number, z: number): string => {
    const old = branchesRaw.find((b) => b.id === branchId);
    if (!old) return "";
    const fromN = nodes.find((n) => n.id === old.fromId);
    const toN = nodes.find((n) => n.id === old.toId);
    if (!fromN || !toN) return "";

    // Создаём новый узел в точке разреза
    const newNodeId = nextNodeId();
    // Номер узла — только цифра, без буквенных префиксов
    const usedNumsSplit = new Set(nodes.map((n) => parseInt(n.number, 10)).filter((n) => !isNaN(n)));
    let nextNumSplit = 1;
    while (usedNumsSplit.has(nextNumSplit)) nextNumSplit++;
    const num = String(nextNumSplit);
    // Если активен горизонт — Z и привязка из горизонта; иначе — из точки.
    // Сохраняем horizonId родительской ветви, если узел создаётся «на лету».
    const finalZ = activeHorizon ? activeHorizon.z : z;
    const horizonId = activeHorizon ? activeHorizon.id : old.horizonId;
    const newNode = makeNode(newNodeId, {
      x, y, z: finalZ,
      name: `Узел ${num}`,
      number: num,
    });

    // Создаём вторую половину A→N + N→B; сохраняем все параметры.
    // Расход распределяем 50/50 (солвер пересчитает).
    const newBranchId = nextBranchId([...branchesRaw, { ...old, id: "@tmp" }]);
    const halfFlow = old.flow / 2;

    setNodes((p) => [...p, newNode]);
    setBranches((p) => p.flatMap((b) => {
      if (b.id !== branchId) return [b];
      const segA: TopoBranch = { ...b, toId: newNodeId, manualLength: false, flow: halfFlow };
      const segB: TopoBranch = makeBranch(newBranchId, newNodeId, old.toId, {
        ...b,
        id: newBranchId,
        fromId: newNodeId,
        toId: old.toId,
        manualLength: false,
        flow: halfFlow,
        // Вентилятор оставляем только на первой половине, чтобы не задвоить напор.
        hasFan: false, fanMode: "constant", fanPressure: 0, fanName: "",
        fanCurveId: "", fanEfficiency: 0, fanShaftPower: 0,
      });
      // Подавим неиспользуемые переменные
      void fromN; void toN;
      return [segA, segB];
    }));
    setSelectedNodeId(newNodeId);
    setSelectedBranchId(null);
    return newNodeId;
  };

  const handleNodeMove = (id: string, x: number, y: number, z?: number) => {
    updateNode(id, z !== undefined ? { x, y, z } : { x, y });
  };

  // ─── Результат расчёта сети ─────────────────────────────────────────
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null);
  // Расходы прямого режима для проверки норматива реверса (k_rev >= 0.6)
  const [normalFlows, setNormalFlows] = useState<Record<string, number>>({});
  const [vcSolving, setVcSolving] = useState(false);
  const [vcError, setVcError] = useState<string | null>(null);
  // Метод расчёта: cross = Кросс, mkr = МКР
  const [calcMode, setCalcMode] = useState<"cross" | "mkr">("cross");
  // Параметры расчёта
  const [solverTolerance, setSolverTolerance] = useState(0.01);
  const [solverMaxIter, setSolverMaxIter] = useState(2000);
  const [solverAlpha, setSolverAlpha] = useState(0.8);
  // Температура воздуха на поверхности (для расчёта естественной тяги)
  const [surfaceTemp, setSurfaceTemp] = useState(20);
  const [showSolverParams, setShowSolverParams] = useState(false);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const addLog = (level: LogEntry["level"], text: string) => {
    const ts = new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogEntries(prev => [...prev, { id: ++logIdRef.current, ts, level, text }]);
  };
  // ─── Ракурс / 3D ────────────────────────────────────────────────────
  const [viewPreset, setViewPreset] = useState<{ name: "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE"; nonce: number } | null>(null);
  const [viewInfo, setViewInfo] = useState<{ is3D: boolean; azimuth: number; elevation: number }>({ is3D: true, azimuth: 0, elevation: 0 });
  const setPreset = (name: "plan" | "front" | "back" | "left" | "right" | "isoSW" | "isoSE" | "isoNW" | "isoNE") => {
    // Вписывание в экран теперь происходит внутри TopoCanvas через fitAfterPresetRef
    setViewPreset({ name, nonce: Date.now() });
  };

  // Режим отображения направления воздушного потока (по умолчанию ВЫКЛ).
  const [flowDisplay, setFlowDisplay] = useState<"off" | "flow" | "chevrons" | "both">("off");

  // Активная рабочая плоскость для построения в 3D
  // null = автоматически по ракурсу; иначе фиксированная пользователем
  const [workPlane, setWorkPlane] = useState<{ axis: "x" | "y" | "z"; value: number } | null>(null);

  // ─── МАСШТАБ И ВПИСЫВАНИЕ ───────────────────────────────────────────
  const [viewScale, setViewScale] = useState<number>(0.4);
  const [fitToScreenNonce, setFitToScreenNonce] = useState<number>(0);
  // При первом рендере переключаем на вид Фронт и вписываем сеть
  useEffect(() => {
    setViewPreset({ name: "front", nonce: Date.now() });
    const t = window.setTimeout(() => setFitToScreenNonce(Date.now()), 200);
    return () => window.clearTimeout(t);
  }, []);

  // Восстановление сохранённого вида (azimuth + scale + offset) при открытии файла
  type SavedView = { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number };
  const [savedViewToRestore, setSavedViewToRestore] = useState<SavedView | null>(null);

  // Nonce для импорта DXF — когда меняется, переключаем вид + fitToScreen
  const [importNonce, setImportNonce] = useState(0);
  useEffect(() => {
    if (importNonce === 0) return;
    setViewPreset({ name: "plan", nonce: Date.now() });
    const t = window.setTimeout(() => setFitToScreenNonce(Date.now()), 150);
    return () => window.clearTimeout(t);
  }, [importNonce]);

  // ─── Синхронизация данных перемычек при изменении справочника ────────
  useEffect(() => {
    if (!mineBulkheads.length) return;
    setBranches(prev => prev.map(br => {
      if (!br.hasBulkhead || !br.bulkheadId) return br;
      const ref = mineBulkheads.find(b => b.id === br.bulkheadId);
      if (!ref) return br;
      return {
        ...br,
        bulkheadName: ref.name,
        bulkheadR: ref.rMkyurg,
        bulkheadAirPerm: ref.airPermeability,
        bulkheadFailurePressure: ref.failurePressure,
      };
    }));
    // Синхронизируем bkAirPerm в символах перемычек из данных ветви
    setSchemaSymbols(prev => prev.map(s => {
      if (!BULKHEAD_SYMBOL_IDS.has(s.typeId) || !s.branchId || s.bkManualAirPerm) return s;
      const ref = mineBulkheads.find(b => {
        const br = branches.find(br => br.id === s.branchId);
        return br?.bulkheadId && b.id === br.bulkheadId;
      });
      if (!ref) return s;
      return { ...s, bkAirPerm: ref.airPermeability ?? 0, bkBulkheadR: ref.rMkyurg ?? 0 };
    }));
  }, [mineBulkheads]);

  // Синхронизация bkAirPerm в символах при изменении данных ветвей (выбор перемычки из справочника)
  useEffect(() => {
    setSchemaSymbols(prev => prev.map(s => {
      if (!BULKHEAD_SYMBOL_IDS.has(s.typeId) || !s.branchId || s.bkManualAirPerm) return s;
      const br = branches.find(b => b.id === s.branchId);
      if (!br || !(br.bulkheadAirPerm ?? 0)) return s;
      if (s.bkAirPerm === br.bulkheadAirPerm && s.bkBulkheadR === br.bulkheadR) return s;
      return { ...s, bkAirPerm: br.bulkheadAirPerm ?? 0, bkBulkheadR: br.bulkheadR ?? 0 };
    }));
   
  }, [branches]);

  // ─── ОБЩИЕ НАСТРОЙКИ ОТОБРАЖЕНИЯ ВЕТВЕЙ ─────────────────────────────
  const [branchWidth, setBranchWidth] = useState<number>(3);    // px
  const [branchBorder, setBranchBorder] = useState<number>(0.6); // px
  const [thinLines, setThinLines] = useState<boolean>(false);    // F6: всё в 1px
  const [colorByHorizon, setColorByHorizon] = useState<boolean>(false);
  const [showFlowArrows, setShowFlowArrows] = useState<boolean>(false); // включается F9

  // ─── ПАНЕЛЬ ИНФОРМАЦИИ + Z-МАСШТАБ ─────────────────────────────────
  const [infoConfig, setInfoConfig] = useState<InfoDisplayConfig>(DEFAULT_INFO_CONFIG);
  const updateInfoConfig = (patch: Partial<InfoDisplayConfig>) =>
    setInfoConfig((prev) => ({ ...prev, ...patch }));
  const [zScale, setZScale] = useState<number>(1);

  // ─── ЕДИНИЦЫ ИЗМЕРЕНИЯ ───────────────────────────────────────────
  const [unitsConfig, setUnitsConfig] = useState<UnitsConfig>(DEFAULT_UNITS_CONFIG);

  // ─── УСЛОВНЫЕ ОБОЗНАЧЕНИЯ НА СХЕМЕ ─────────────────────────────────
  // Каждый символ: тип (из справочника), мировые координаты, привязка к ветви
  const [schemaSymbols, setSchemaSymbols] = useState<SchemaSymbol[]>([
    { id: "SYM_FAN_4",   typeId: "fan",        x: 0, y: 0, branchId: "4", t: 0.5, airDirection: "forward" },
    { id: "SYM_COPRA_1", typeId: "copra_tower", x: 0, y: 0, branchId: "1", t: 0.2, label: "Надшахтное здание ЮВС" },
  ]);
  const [symbolClipboard, setSymbolClipboard] = useState<SchemaSymbol | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  // Режим «ожидания привязки»: символ из буфера ждёт клика на ветвь
  const [pendingSymbol, setPendingSymbol] = useState<SchemaSymbol | null>(null);

  const [activeSymbolTypeId, setActiveSymbolTypeId] = useState<string | null>(null);
  const [showUOPanel, setShowUOPanel] = useState(false);
  const [uoPanelPos, setUOPanelPos] = useState({ left: 0, top: 0 });
  const uoBtnRef = useRef<HTMLButtonElement>(null);
  const [uoTooltip, setUoTooltip] = useState<{ name: string; x: number; y: number } | null>(null);
  // ID ветви, для которой открыли панель через клик на fan-символ
  const [fanSymbolBranchId, setFanSymbolBranchId] = useState<string | null>(null);
  // Диалог ввода числа людей при размещении отделения
  const [squadDialog, setSquadDialog] = useState<{ typeId: string; x: number; y: number; branchId: string | null } | null>(null);
  const [squadCount, setSquadCount] = useState<string>("5");

  const SQUAD_TYPES = ["squad_moving", "squad_working"];

  const addSymbol = (typeId: string, x: number, y: number, branchId?: string | null, label?: string, scale?: number, t?: number) => {
    const id = `SYM_${Date.now()}`;
    setSchemaSymbols(prev => [...prev, { id, typeId, x, y, branchId: branchId ?? null, label, scale, t: branchId ? (t ?? 0.5) : undefined }]);
  };
  const removeSymbol = (id: string) => setSchemaSymbols(prev => prev.filter(s => s.id !== id));

  // Создать fan-символы для всех ветвей с hasFan у которых ещё нет УО
  const ensureFanSymbols = (branches: typeof branchesRaw, existingSymbols: SchemaSymbol[]) => {
    const newSymbols: SchemaSymbol[] = [];
    branches.forEach(b => {
      if (!b.hasFan) return;
      if (existingSymbols.some(s => s.typeId === "fan" && s.branchId === b.id)) return;
      if (newSymbols.some(s => s.branchId === b.id)) return;
      newSymbols.push({ id: `SYM_FAN_${b.id}`, typeId: "fan", x: 0, y: 0, branchId: b.id, t: 0.5 });
    });
    return newSymbols;
  };

  // Активировать инструмент размещения символа
  const handlePickSymbol = (typeId: string) => {
    setActiveSymbolTypeId(typeId);
    setTool("symbol");
  };

  // ─── ПРАВАЯ ВЫДВИЖНАЯ ПАНЕЛЬ ────────────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(true);
  const [rightTab, setRightTab] = useState<"node" | "branch" | "info">("info");

  // ─── ДИАЛОГ «ВЫДЕЛЕНИЕ ПОДОБНОГО» (S+S) ─────────────────────────────
  const [showSelectSimilar, setShowSelectSimilar] = useState(false);
  const lastSPressRef = useRef<number>(0);

  // ─── ПАНЕЛЬ ДИАГНОСТИКИ РАСЧЁТА ─────────────────────────────────────
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // ─── ДИАЛОГ ОБЪЕДИНЕНИЯ ВЕТВЕЙ ПРИ УДАЛЕНИИ УЗЛА ────────────────────
  const [mergeNodeDialog, setMergeNodeDialog] = useState<{
    nodeId: string;
    branchA: string; // id первой ветви
    branchB: string; // id второй ветви
  } | null>(null);

  // ─── МУЛЬТИВЫБОР ВЕТВЕЙ (Ctrl+клик) ────────────────────────────────
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(new Set());
  const handleBranchMultiSelect = (id: string) => {
    setSelectedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectedBranchId(id);
    setSelectedNodeId(null);
  };

  // ─── МУЛЬТИВЫБОР УЗЛОВ (Ctrl+клик) ─────────────────────────────────
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const handleNodeMultiSelect = (id: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      // Если Set пуст и есть одиночный выбранный узел — включаем его тоже
      if (next.size === 0 && selectedNodeId && selectedNodeId !== id) {
        next.add(selectedNodeId);
      }
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectedNodeId(id);
    setSelectedBranchId(null);
  };

  // ─── БУФЕР КОПИРОВАНИЯ ПАРАМЕТРОВ ВЕТВИ ─────────────────────────────
  const [branchParamBuffer, setBranchParamBuffer] = useState<Partial<TopoBranch> | null>(null);

  // ─── МЕНЮ ФАЙЛ ──────────────────────────────────────────────────────
  const [fileSectionState, setFileSectionState] = useState("add");

  // ─── DXF ИМПОРТ ─────────────────────────────────────────────────────
  const [showDxfImport, setShowDxfImport] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showCombinedImport, setShowCombinedImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);

  const handleCsvImport = (result: CsvImportResult, mode: "replace" | "append") => {
    // Применяем параметры вентиляторов сразу к ветвям
    const applyFans = (branches: typeof result.branches) => {
      if (!result.fans || result.fans.length === 0) return branches;
      return branches.map(b => {
        const fan = result.fans.find(f => result.branchOriginalIdMap?.[f.branchId] === b.id);
        if (!fan) return b;
        return { ...b, hasFan: true, fanMode: "constant" as const, fanName: fan.name, fanPressure: fan.pressure };
      });
    };
    if (mode === "replace") {
      const finalBranches = applyFans(result.branches);
      setNodes(result.nodes);
      setBranches(finalBranches);
      setSchemaSymbols(ensureFanSymbols(finalBranches, []));
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => {
        const merged = [...prev, ...applyFans(result.branches)];
        return merged;
      });
      setSchemaSymbols(prev => {
        const newFans = applyFans(result.branches);
        return [...prev, ...ensureFanSymbols(newFans, prev)];
      });
    }
    setImportNonce(n => n + 1);
    setShowCsvImport(false);
    setActiveRibbon("home");
  };

  const handleCombinedImport = (result: CombinedImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([]);
      setSelectedNodeId(null);
      setSelectedBranchId(null);
    } else {
      setNodes((prev) => [...prev, ...result.nodes]);
      setBranches((prev) => [...prev, ...result.branches]);
    }
    setImportNonce((n) => n + 1);
    setShowCombinedImport(false);
    setActiveRibbon("home");
  };

  const handleExcelImport = (result: ExcelImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([]);
      setSelectedNodeId(null);
      setSelectedBranchId(null);
    } else {
      setNodes((prev) => [...prev, ...result.nodes]);
      setBranches((prev) => [...prev, ...result.branches]);
    }
    setImportNonce((n) => n + 1);
    setShowExcelImport(false);
    setActiveRibbon("home");
  };
  const handleDxfImport = (result: DxfImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols([]);
      setSelectedNodeId(null);
      setSelectedBranchId(null);
    } else {
      setNodes((prev) => [...prev, ...result.nodes]);
      setBranches((prev) => [...prev, ...result.branches]);
    }
    // Переключаем вид на план (сверху) и вписываем схему в экран через useEffect
    setImportNonce((n) => n + 1);
    setShowDxfImport(false);
    setActiveRibbon("home");
  };

  // ─── СПРАВОЧНИК ОБОРУДОВАНИЯ ─────────────────────────────────────────
  const [showEquipRef, setShowEquipRef] = useState(false);
  const [equipRefTab, setEquipRefTab] = useState<"fans" | "types" | "bulkheads" | "sensors" | "typical" | "pumps" | "pipes" | "transport">("fans");
  const [showLegend, setShowLegend] = useState(false);

  // ─── СОХРАНЕНИЕ / ЗАГРУЗКА ПРОЕКТА ───────────────────────────────────
  const [projectFileName, setProjectFileName] = useState<string>("Проект1.vproj");
  // Флаг несохранённых изменений
  const [isDirty, setIsDirty] = useState<boolean>(false);
  // Диалог подтверждения закрытия
  const [showCloseConfirm, setShowCloseConfirm] = useState<boolean>(false);

  // Ссылка на FileSystemFileHandle для перезаписи (File System Access API)
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  // Текущие параметры вида для сохранения в файл
  const [savedViewState, setSavedViewState] = useState<{ scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number } | null>(null);

  const buildProjectData = () => ({
    version: 2,
    name: projectFileName,
    savedAt: new Date().toISOString(),
    nodes,
    branches: branchesRaw,
    horizons,
    schemaSymbols,
    mineFans,
    mineBulkheads,
    mineTypes,
    calcMode,
    solverTolerance,
    solverMaxIter,
    solverAlpha,
    surfaceTemp,
    infoConfig,
    unitsConfig,
    branchWidth,
    branchBorder,
    colorByHorizon,
    showFlowArrows,
    flowDisplay,
    zScale,
    view: savedViewState ?? undefined,
  });

  // Отслеживаем изменения проекта — помечаем как «несохранённый»
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setIsDirty(true);
  }, [nodes, branchesRaw, schemaSymbols, mineFans, mineBulkheads, mineTypes,
      calcMode, solverTolerance, solverMaxIter, solverAlpha, surfaceTemp,
      infoConfig, unitsConfig, branchWidth, branchBorder, colorByHorizon,
      showFlowArrows, flowDisplay, zScale]);

  // Предупреждение при закрытии/обновлении вкладки
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Записать содержимое в уже открытый FileHandle (перезапись)
  const writeToHandle = async (handle: FileSystemFileHandle, data: object) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  };

  const handleSave = async () => {
    const data = buildProjectData();
    // Если есть открытый handle — перезаписываем без диалога
    if (fileHandleRef.current) {
      try {
        await writeToHandle(fileHandleRef.current, data);
        setIsDirty(false);
        return;
      } catch {
        // handle стал недоступен — fallback на скачивание
        fileHandleRef.current = null;
      }
    }
    // Fallback: скачивание (если File System Access API недоступен)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = projectFileName;
    a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  };

  const handleSaveAs = async () => {
    const data = buildProjectData();
    // File System Access API — показываем диалог выбора файла
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await (window as Window & { showSaveFilePicker: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: projectFileName,
          types: [{ description: "Проект вентиляции", accept: { "application/json": [".vproj", ".json"] } }],
        });
        fileHandleRef.current = handle;
        const fname = handle.name;
        setProjectFileName(fname);
        await writeToHandle(handle, { ...data, name: fname });
        setIsDirty(false);
        return;
      } catch {
        // Пользователь отменил — ничего не делаем
        return;
      }
    }
    // Fallback: prompt + скачивание
    const name = window.prompt("Имя файла:", projectFileName);
    if (!name) return;
    const fname = name.endsWith(".vproj") ? name : `${name}.vproj`;
    setProjectFileName(fname);
    const blob = new Blob([JSON.stringify({ ...data, name: fname }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    setIsDirty(false);
  };

  const handleOpen = async () => {
    // File System Access API — открываем с handle для последующей перезаписи
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await (window as Window & { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
          types: [{ description: "Проект вентиляции", accept: { "application/json": [".vproj", ".json"] } }],
        });
        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.nodes && Array.isArray(data.nodes)) {
          if (nodes.length > 0 || branchesRaw.length > 0) {
            if (!window.confirm("Открыть проект? Текущие данные будут заменены.")) return;
          }
          fileHandleRef.current = handle;
          applyProjectData(data, file.name);
        } else {
          alert("Файл не является проектом Вентиляция-CAD.");
        }
        return;
      } catch {
        // Пользователь отменил или API недоступен — fallback
      }
    }
    // Fallback: <input type=file>
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".vproj,.json";
    inp.onchange = () => {
      const file = inp.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.nodes && Array.isArray(data.nodes)) {
            if (nodes.length > 0 || branchesRaw.length > 0) {
              if (!window.confirm("Открыть проект? Текущие данные будут заменены.")) return;
            }
            fileHandleRef.current = null;
            applyProjectData(data, file.name);
          } else {
            alert("Файл не является проектом Вентиляция-CAD.");
          }
        } catch {
          alert("Ошибка чтения файла.");
        }
      };
      reader.readAsText(file);
    };
    inp.click();
  };

  // Применить данные из JSON — с слиянием дефолтов для ветвей
  const applyProjectData = (data: Record<string, unknown>, fileName: string) => {
    setNodes((data.nodes as TopoNode[]) ?? []);
    // Каждую ветвь прогоняем через makeBranch чтобы гарантировать все поля (fanRpm и т.д.)
    const rawBranches = (data.branches as TopoBranch[]) ?? [];
    const mergedBranches = rawBranches.map((b) =>
      makeBranch(b.id, b.fromId, b.toId, b)
    );
    setBranches(mergedBranches);
    if (data.horizons) setHorizons(data.horizons as typeof horizons);
    const loadedSymbols = (data.schemaSymbols as SchemaSymbol[]) ?? [];
    // Добавляем fan-символы для ветвей у которых нет УО (старые проекты)
    const autoFanSymbols = ensureFanSymbols(mergedBranches, loadedSymbols);
    setSchemaSymbols([...loadedSymbols, ...autoFanSymbols]);
    if (data.mineFans) setMineFans(data.mineFans as MineFanExport[]);
    if (data.mineBulkheads) setMineBulkheads(data.mineBulkheads as MineBulkheadExport[]);
    if (data.mineTypes) setMineTypes(data.mineTypes as BranchType[]);
    if (data.calcMode) setCalcMode(data.calcMode as "cross" | "mkr");
    if (data.solverTolerance !== undefined) setSolverTolerance(data.solverTolerance as number);
    if (data.solverMaxIter !== undefined) setSolverMaxIter(data.solverMaxIter as number);
    if (data.solverAlpha !== undefined) setSolverAlpha(data.solverAlpha as number);
    if (data.surfaceTemp !== undefined) setSurfaceTemp(data.surfaceTemp as number);
    if (data.infoConfig) setInfoConfig(data.infoConfig as InfoDisplayConfig);
    if (data.unitsConfig) setUnitsConfig(data.unitsConfig as UnitsConfig);
    if (data.branchWidth !== undefined) setBranchWidth(data.branchWidth as number);
    if (data.branchBorder !== undefined) setBranchBorder(data.branchBorder as number);
    if (data.colorByHorizon !== undefined) setColorByHorizon(data.colorByHorizon as boolean);
    if (data.showFlowArrows !== undefined) setShowFlowArrows(data.showFlowArrows as boolean);
    if (data.flowDisplay) setFlowDisplay(data.flowDisplay as "off" | "flow" | "chevrons" | "both");
    if (data.zScale !== undefined) setZScale(data.zScale as number);
    setProjectFileName((data.name as string) ?? fileName);
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    // Восстанавливаем сохранённый вид если есть
    if (data.view) {
      const v = data.view as { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number };
      setSavedViewToRestore(v);
    } else {
      setImportNonce((n) => n + 1);
    }
    setActiveRibbon("home");
  };

  const handlePrint = () => {
    window.print();
  };

  // ─── СОЗДАТЬ НОВЫЙ ПРОЕКТ ────────────────────────────────────────────
  const handleNewProject = () => {
    if (nodes.length > 0 || branches.length > 0) {
      if (!window.confirm("Создать новый проект? Все несохранённые данные будут потеряны.")) return;
    }
    setNodes([]);
    setBranches([]);
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setHorizons(DEFAULT_HORIZONS);
    setActiveHorizonId("");
    setActiveRibbon("home");
  };

  // ─── КОНТЕКСТНОЕ МЕНЮ ───────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    kind: "node" | "branch" | "canvas";
    id?: string;
    x: number;
    y: number;
  } | null>(null);
  // (автопереключение правого таба при выборе объекта убрано — пользователь выбирает вкладку вручную)

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

  // Расчёт воздухораспределения (Кросс или МКР)
  const handleSolveLocal = async () => {
    setVcSolving(true);
    setVcError(null);
    addLog("info", `Запуск расчёта: метод ${calcMode === "cross" ? "Кросс" : "МКР"}, узлов ${nodes.length}, ветвей ${branches.length}`);
    const zeroR = branches.filter(b => b.resistance <= 0);
    if (zeroR.length > 0) addLog("warn", `R=0 у ${zeroR.length} ветвей: ${zeroR.slice(0, 5).map(b => `${b.id}(L=${b.length.toFixed(0)},S=${b.area.toFixed(1)},P=${b.perimeter.toFixed(1)})`).join(", ")}${zeroR.length > 5 ? "..." : ""}`);
    const atmNodes = nodes.filter(n => n.atmosphereLink);
    addLog("info", `Атм. узлов=${atmNodes.length}: ${atmNodes.map(n => n.id).join(", ")}`);
    try {
      const curve_map = new Map(branches.map(b => {
        const curve = (b.hasFan && b.fanMode === "curve") ? getFanById(b.fanCurveId) : undefined;
        const k = (curve && curve.rpmNominal > 0 && b.fanRpm > 0) ? b.fanRpm / curve.rpmNominal : 1;
        let af = 1.0;
        if (curve?.bladeAngles && curve.bladeAngles.length >= 2) {
          const lo = curve.bladeAngles[0], hi = curve.bladeAngles[curve.bladeAngles.length - 1];
          const a = Math.min(hi, Math.max(lo, b.fanBladeAngle ?? (lo + hi) / 2));
          af = 0.65 + ((a - lo) / Math.max(1, hi - lo)) * 0.70;
        }
        return [b.id, { curve, k, af }];
      }));

      const requestBody = {
          method: calcMode,
          nodes: nodes.map(n => ({
            id: n.id,
            isAtm: n.atmosphereLink,
            z: n.z ?? 0,
            airTemp: n.atmosphereLink ? surfaceTemp : (n.airTemp ?? surfaceTemp),
          })),
          surfaceTemp,
          branches: branches.map(b => {
            const { curve, k, af } = curve_map.get(b.id) ?? { curve: undefined, k: 1, af: 1 };
            // Суммируем R всех символов перемычек на этой ветви (каждый хранит свои параметры)
            // Плотность воздуха по средней температуре узлов ветви (как в бэкенде: ρ = 353/(273+T))
            const fromNode = nodes.find(n => n.id === b.fromId);
            const toNode = nodes.find(n => n.id === b.toId);
            const tFrom = fromNode ? (fromNode.atmosphereLink ? surfaceTemp : (fromNode.airTemp ?? surfaceTemp)) : surfaceTemp;
            const tTo   = toNode   ? (toNode.atmosphereLink   ? surfaceTemp : (toNode.airTemp   ?? surfaceTemp)) : surfaceTemp;
            const tAvg  = (tFrom + tTo) / 2;
            const rho   = 353.0 / (273.0 + Math.max(-30, Math.min(100, tAvg)));
            const bkSyms = schemaSymbols.filter(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
            const rBulkheads = bkSyms.reduce((sum, s) => {
              const mode = s.bkResMode ?? "project";
              let r = 0;
              if (mode === "manual") {
                r = (s.bkManualR ?? 0) * 1e3;
              } else if (mode === "survey") {
                const q = s.bkSurveyQ ?? 0; const dp = s.bkSurveyDP ?? 0;
                r = q > 0 ? dp / (q * q) : 0;
              } else {
                const sw = s.bkWindowArea ?? 0;
                // Если окно >= сечения ветви (или открытая дверь без сечения) → R = 0
                const branchArea = b.area ?? 0;
                const isFullyOpen = (OPEN_DOOR_IDS.has(s.typeId) && sw <= 0.001)
                  || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                if (isFullyOpen) {
                  r = 0;
                } else if (sw > 0.001) {
                  // Частичное открытие — по формуле местного сопротивления
                  const mu = 0.65;
                  r = rho / (2 * mu * mu * sw * sw);
                } else {
                  // Глухая перемычка — по воздухопроницаемости или справочному R
                  const kAir = s.bkManualAirPerm ? (s.bkCustomAirPerm ?? 0) : (s.bkAirPerm ?? b.bulkheadAirPerm ?? 0);
                  r = kAir > 0 ? 1 / (kAir * kAir) : ((s.bkBulkheadR ?? b.bulkheadR ?? 0) * 1e3);
                }
              }
              return sum + r;
            }, 0);
            return {
              id: b.id,
              fromId: b.fromId,
              toId: b.toId,
              R: b.resistance + rBulkheads,
              area: b.area,
              angle: b.angle ?? 0,
              hasFan: b.hasFan,
              fanMode: b.fanMode,
              fanPressure: b.fanPressure,
              fanReverse:  b.fanReverse ?? false,
              fanStopped:  b.fanStopped ?? false,
              fanParallel: Math.max(1, b.fanParallel ?? 1),
              ...(curve ? {
                h0: curve.h0 * af * k * k,
                h1: curve.h1 * k,
                h2: curve.h2,
                qMax: curve.qMax * k,
                qMin: curve.qMin * k,
                // Реверсная P–Q характеристика (масштабируется так же по оборотам)
                ...(curve.reverseH0 !== undefined ? {
                  reverseH0:  curve.reverseH0 * k * k,
                  reverseH1:  curve.reverseH1! * k,
                  reverseH2:  curve.reverseH2!,
                  reverseQMax: (curve.reverseQMax ?? curve.qMax) * k,
                  reverseEfficiencyFactor: curve.reverseEfficiencyFactor,
                } : {}),
              } : {}),
            };
          }),
          options: {
            tolerance: solverTolerance,
            maxIter: solverMaxIter,
            alpha: solverAlpha,
          },
          // Расходы прямого режима для проверки норматива реверса (k_rev >= 0.6)
          // Передаём только если есть реверс и есть сохранённые прямые расходы
          ...(branches.some(b => b.fanReverse) && Object.keys(normalFlows).length > 0
            ? { normalFlows }
            : {}),
      };
      console.log("[SOLVE] REQUEST:", JSON.stringify(requestBody, null, 2));
      const resp = await fetch(AIRFLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await resp.json();
      console.log("[SOLVE] RESPONSE:", JSON.stringify(data, null, 2));

      if (!resp.ok || data.error) {
        const msg = data.error || "Ошибка расчёта";
        setVcError(msg);
        addLog("error", msg);
        return;
      }

      // Пишем лог из бэкенда
      if (data.log?.length) {
        (data.log as string[]).forEach(line => addLog("info", line));
      }

      // Применяем результат
      const resultBranches = data.branches as { id: string; Q: number; velocity: number; H: number; isDead?: boolean }[];
      setBranches(prev => prev.map(b => {
        const rb = resultBranches.find(r => r.id === b.id);
        if (!rb) return b;
        return { ...b, flow: rb.Q, velocity: rb.velocity, dP: rb.H, isDead: rb.isDead ?? false };
      }));

      // Сохраняем расходы прямого режима (без реверса) для последующей проверки k_rev >= 0.6
      if (!branches.some(b => b.fanReverse) && data.converged) {
        const flows: Record<string, number> = {};
        resultBranches.forEach(rb => { flows[rb.id] = Math.abs(rb.Q); });
        setNormalFlows(flows);
      }

      setSolveResult({
        ok: data.converged,
        iterations: data.iterations,
        maxDeltaQ: data.maxResidual,
        maxDeltaH: data.maxResidual,
        branches: [],
        nodes: [],
        log: data.log ?? [],
        cyclesCount: data.cyclesCount ?? 0,
        diagnostics: data.diagnostics ?? [],
      });

      // Итоговая строка результата
      if (data.converged) {
        addLog("ok", `Сошлось за ${data.iterations} итераций, невязка ${(data.maxResidual as number)?.toFixed(4) ?? "—"}`);
      } else {
        addLog("warn", `Не сошлось за ${data.iterations} итераций, невязка ${(data.maxResidual as number)?.toFixed(4) ?? "—"}`);
      }

      // Диагностика в лог
      if (data.diagnostics?.length) {
        (data.diagnostics as { level: string; message: string }[]).forEach(d => {
          addLog(d.level === "error" ? "error" : d.level === "warning" ? "warn" : "info", d.message);
        });
      }

      if (data.branches?.some((b: { Q: number }) => Math.abs(b.Q) > 0.1)) {
        setShowFlowArrows(true);
      }
      if (data.diagnostics?.some((d: { level: string }) => d.level === "error")) {
        setShowDiagnostics(true);
      }
    } catch (e) {
      const msg = `Ошибка соединения: ${e instanceof Error ? e.message : String(e)}`;
      setVcError(msg);
      addLog("error", msg);
    } finally {
      setVcSolving(false);
    }
  };

  const handleSolve = () => { void handleSolveLocal(); };
  // Подключаем ref чтобы updateBranch мог вызвать расчёт (нужен прямой режим перед реверсом)
  handleSolveRef.current = handleSolve;

  // ─── ГОРЯЧИЕ КЛАВИШИ ────────────────────────────────────────────────
  // F6 — переключить «тонкие линии» (как в АэроСеть/Венти-CAD: подача в одну тонкую линию).
  // F9 — запустить расчёт воздухораспределения. Esc — снять выделение.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // isEditing: true только если активный элемент — поле ввода
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";
      const isEditing = (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        && active !== document.body;

      if (e.ctrlKey && (e.key === "s" || e.key === "ы" || e.key === "Ы")) {
        e.preventDefault();
        handleSave();
        return;
      }
      // Ctrl+V / Ctrl+М — вставить условное обозначение из буфера (режим ожидания привязки)
      if (e.ctrlKey && (e.key === "v" || e.key === "V" || e.key === "м" || e.key === "М") && !isEditing) {
        if (symbolClipboard) {
          e.preventDefault();
          setPendingSymbol({ ...symbolClipboard, id: `SYM_${Date.now()}` });
        }
        return;
      }
      // Ctrl+C / Ctrl+С — скопировать выбранное обозначение
      if (e.ctrlKey && (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") && !isEditing && selectedSymbolId) {
        const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
        if (sym) { e.preventDefault(); setSymbolClipboard(sym); }
        return;
      }
      // Ctrl+D / Ctrl+В — дублировать выбранное обозначение (режим ожидания привязки)
      if (e.ctrlKey && (e.key === "d" || e.key === "D" || e.key === "в" || e.key === "В") && !isEditing && selectedSymbolId) {
        const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
        if (sym) {
          e.preventDefault();
          setPendingSymbol({ ...sym, id: `SYM_${Date.now()}` });
        }
        return;
      }
      // F6, F9 — всегда работают
      if (e.key === "F6") { e.preventDefault(); setThinLines((v) => !v); return; }
      if (e.key === "F9") { e.preventDefault(); handleSolve(); return; }

      // Ctrl+R — развернуть выбранную ветвь
      if (e.ctrlKey && (e.key === "r" || e.key === "R") && !isEditing) {
        e.preventDefault();
        if (selectedBranchId) handleReverseBranch(selectedBranchId);
        return;
      }

      // S+S (англ.) / Ы+Ы (рус.) — диалог выделения подобных объектов
      const isSKey = e.key === "s" || e.key === "S" || e.key === "ы" || e.key === "Ы";
      if (isSKey && !isEditing) {
        const now = Date.now();
        if (now - lastSPressRef.current < 600) {
          e.preventDefault();
          setShowSelectSimilar(true);
          lastSPressRef.current = 0;
        } else {
          lastSPressRef.current = now;
        }
        return;
      }

      // Del/Backspace — блокируем только если input активен И имеет текстовое содержимое
      // (т.е. пользователь действительно редактирует текст, а не просто кликнул по полю)
      if (e.key === "Delete") {
        if (isEditing) return; // редактируем текст в поле — не удаляем объект
        e.preventDefault();
        handleDeleteSelected();
        return;
      }
      if (e.key === "Backspace") {
        if (isEditing) return;
        e.preventDefault();
        handleDeleteSelected();
        return;
      }

      if (isEditing) return;

      if (e.key === "Escape" || e.key === "Enter") {
        if (pendingSymbol) {
          setPendingSymbol(null);
          return;
        }
        setSelectedNodeId(null);
        setSelectedBranchId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, branchesRaw, selectedNodeId, selectedBranchId, selectedSymbolId, schemaSymbols, symbolClipboard, pendingSymbol]);

  // Проверяет, является ли узел промежуточным (ровно 2 смежных ветви)
  const getNodeAdjacentBranches = (nodeId: string) => {
    return branchesRaw.filter(b => b.fromId === nodeId || b.toId === nodeId);
  };

  // Объединяет две ветви, смежные с промежуточным узлом, в одну
  const mergeAdjacentBranches = (nodeId: string, branchAId: string, branchBId: string) => {
    const brA = branchesRaw.find(b => b.id === branchAId);
    const brB = branchesRaw.find(b => b.id === branchBId);
    if (!brA || !brB) return;

    // Определяем конечные узлы объединённой ветви (исключая промежуточный)
    const fromId = brA.fromId === nodeId ? brA.toId : brA.fromId;
    const toId   = brB.fromId === nodeId ? brB.toId : brB.fromId;

    // Новая ветвь: длина = сумма длин, остальные параметры от первой ветви
    const mergedBranch: typeof brA = {
      ...brA,
      id: brA.id,
      fromId,
      toId,
      length: (brA.length ?? 0) + (brB.length ?? 0),
      name: brA.name || brB.name,
    };

    // Перепривязываем символы со второй ветви на объединённую
    setSchemaSymbols(prev => prev.map(s =>
      s.branchId === branchBId ? { ...s, branchId: brA.id } : s
    ));

    setBranches(prev => [
      ...prev.filter(b => b.id !== branchAId && b.id !== branchBId),
      mergedBranch,
    ]);
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    if (selectedBranchId === branchBId) setSelectedBranchId(brA.id);
  };

  // Удаляет узел без объединения
  const doDeleteNode = (nodeId: string) => {
    setBranches(p => p.filter(b => b.fromId !== nodeId && b.toId !== nodeId));
    setNodes(p => p.filter(n => n.id !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  // Запрашивает удаление узла: если промежуточный — предлагает объединить ветви
  const requestDeleteNode = (nodeId: string) => {
    const adj = getNodeAdjacentBranches(nodeId);
    if (adj.length === 2) {
      setMergeNodeDialog({ nodeId, branchA: adj[0].id, branchB: adj[1].id });
    } else {
      doDeleteNode(nodeId);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedSymbolId) {
      const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
      if (sym?.typeId === "fan" && sym.branchId) {
        updateBranch(sym.branchId, { hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0 });
      }
      removeSymbol(selectedSymbolId);
      setSelectedSymbolId(null);
    } else if (selectedBranchId) {
      setBranches((p) => p.filter((b) => b.id !== selectedBranchId));
      setSelectedBranchId(null);
    } else if (selectedNodeId) {
      requestDeleteNode(selectedNodeId);
    }
  };

  const handleDeleteNode = (id: string) => {
    requestDeleteNode(id);
  };

  const handleDeleteBranch = (id: string) => {
    setBranches((p) => p.filter((b) => b.id !== id));
    if (selectedBranchId === id) setSelectedBranchId(null);
  };

  // Разорвать связь в узле — как в АэроСети:
  // каждая ветвь получает свой клон-узел на том же месте, исходный узел удаляется.
  // Ветви при этом НЕ удаляются — они перепривязываются к новым узлам.
  const handleSplitNodeConnections = (id: string) => {
    const srcNode = nodes.find((n) => n.id === id);
    if (!srcNode) return;
    const connected = branchesRaw.filter((b) => b.fromId === id || b.toId === id);
    if (connected.length === 0) return;

    // Для каждой ветви создаём отдельный узел-клон в той же позиции
    const newNodes: typeof nodes = [];
    const idMap = new Map<string, string>(); // branchId → новый nodeId

    connected.forEach((b) => {
      const newId = `N${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      newNodes.push(makeNode(newId, {
        x: srcNode.x, y: srcNode.y, z: srcNode.z,
        number: srcNode.number,
        name: srcNode.name,
        atmosphereLink: srcNode.atmosphereLink,
      }));
      idMap.set(b.id, newId);
    });

    // Перепривязываем ветви к новым узлам
    setBranches((prev) => prev.map((b) => {
      const newNodeId = idMap.get(b.id);
      if (!newNodeId) return b;
      return {
        ...b,
        fromId: b.fromId === id ? newNodeId : b.fromId,
        toId:   b.toId   === id ? newNodeId : b.toId,
      };
    }));

    // Удаляем исходный узел, добавляем клоны
    setNodes((prev) => [
      ...prev.filter((n) => n.id !== id),
      ...newNodes,
    ]);
    setSelectedNodeId(null);
  };

  // Соединить выбранные узлы в один — обратная операция к «Разорвать связь».
  // Все ветви выбранных узлов перепривязываются к первому (главному) узлу,
  // остальные узлы удаляются.
  const handleMergeNodes = (nodeIds: string[]) => {
    if (nodeIds.length < 2) return;
    const [mainId, ...rest] = nodeIds;
    const restSet = new Set(rest);
    setBranches((prev) => prev.map((b) => ({
      ...b,
      fromId: restSet.has(b.fromId) ? mainId : b.fromId,
      toId:   restSet.has(b.toId)   ? mainId : b.toId,
    })));
    setNodes((prev) => prev.filter((n) => !restSet.has(n.id)));
    setSelectedNodeIds(new Set());
    setSelectedNodeId(mainId);
  };

  // Выровнить выбранные узлы по оси
  const handleAlignNodes = (axis: "x" | "y", mode: "min" | "max" | "avg") => {
    const ids = selectedNodeIds.size >= 2 ? [...selectedNodeIds] : [];
    if (ids.length < 2) return;
    const selNodes = nodes.filter((n) => ids.includes(n.id));
    const vals = selNodes.map((n) => axis === "x" ? n.x : n.y);
    const target = mode === "min" ? Math.min(...vals) : mode === "max" ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
    setNodes((prev) => prev.map((n) => ids.includes(n.id) ? { ...n, [axis]: target } : n));
  };

  const handleToggleAtmosphere = (id: string) => {
    setNodes((p) => p.map((n) => n.id === id ? { ...n, atmosphereLink: !n.atmosphereLink } : n));
  };

  const handleToggleCapital = (id: string) => {
    setBranches((p) => p.map((b) => b.id === id ? { ...b, capital: !b.capital } : b));
  };

  const handleToggleDesigned = (id: string) => {
    setBranches((p) => p.map((b) => b.id === id ? { ...b, designed: !b.designed } : b));
  };

  const handleReverseBranch = (id: string) => {
    setBranches((p) => p.map((b) => b.id === id ? { ...b, fromId: b.toId, toId: b.fromId } : b));
  };

  const handleCtxAction = (action: string) => {
    const nodeId = ctxMenu?.kind === "node" ? ctxMenu.id : undefined;
    const branchId = ctxMenu?.kind === "branch" ? ctxMenu.id : undefined;
    switch (action) {
      case "delete_node": if (nodeId) handleDeleteNode(nodeId); break;
      case "delete_branch": if (branchId) handleDeleteBranch(branchId); break;
      case "split_connections": if (nodeId) handleSplitNodeConnections(nodeId); break;
      case "merge_nodes": {
        const ids = selectedNodeIds.size >= 2
          ? [...selectedNodeIds]
          : nodeId ? [nodeId] : [];
        if (ids.length >= 2) handleMergeNodes(ids);
        break;
      }
      case "align_left":   handleAlignNodes("x", "min"); break;
      case "align_right":  handleAlignNodes("x", "max"); break;
      case "align_top":    handleAlignNodes("y", "min"); break;
      case "align_bottom": handleAlignNodes("y", "max"); break;
      case "align_center_x": handleAlignNodes("x", "avg"); break;
      case "align_center_y": handleAlignNodes("y", "avg"); break;
      case "toggle_atmosphere": if (nodeId) handleToggleAtmosphere(nodeId); break;
      case "toggle_capital": if (branchId) handleToggleCapital(branchId); break;
      case "toggle_designed": if (branchId) handleToggleDesigned(branchId); break;
      case "reverse_branch": if (branchId) handleReverseBranch(branchId); break;
      case "copy_branch_params": {
        const src = branchId ? branches.find((b) => b.id === branchId) : null;
        if (src) {
          const { id: _id, fromId: _f, toId: _t, flow: _fl, velocity: _v, dP: _d, power: _p,
            reynolds: _r, resistance: _res, rFriction: _rf, rLocal: _rl, lambda: _l,
            ...params } = src;
          setBranchParamBuffer(params);
        }
        break;
      }
      case "paste_branch_params": {
        if (!branchParamBuffer) break;
        const targets = selectedBranchIds.size > 0
          ? [...selectedBranchIds]
          : branchId ? [branchId] : [];
        targets.forEach((tid) => updateBranch(tid, branchParamBuffer));
        break;
      }
      case "add_node":
        setTool("node");
        break;
      case "open_props":
        setRightPanelOpen(true);
        if (nodeId) { setRightTab("node"); setSelectedNodeId(nodeId); }
        if (branchId) { setRightTab("branch"); setSelectedBranchId(branchId); }
        break;
    }
    setCtxMenu(null);
  };

  return (
    <>
    <div className="w-full flex flex-col"
      style={{ background: "#f0f0f0", fontFamily: "Segoe UI, Tahoma, sans-serif", fontSize: "12px", color: "#1f1f1f", height: "100dvh" }}>

      {/* ═══ TITLE BAR ════════════════════════════════════════════════════ */}
      <div className="h-7 flex items-center justify-between px-2 select-none"
        style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)", borderBottom: "1px solid #b8b8b8" }}>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-sm flex items-center justify-center"
            style={{ background: "#2563eb", color: "white", fontSize: "10px", fontWeight: "bold" }}>В</div>
          <span className="text-xs font-medium">Вентиляция-CAD — {projectFileName}{isDirty ? " *" : ""}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">—</button>
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">▢</button>
          <button className="w-7 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs"
            onClick={() => { if (isDirty) { setShowCloseConfirm(true); } else { window.close(); } }}>✕</button>
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

      {/* ═══ МЕНЮ ФАЙЛ (выпадающее, как в Аэросеть) ═══════════════════════ */}
      {activeRibbon === "file" && (() => {
        const sections: { id: string; label: string }[] = [
          { id: "new",    label: "Создать" },
          { id: "open",   label: "Открыть" },
          { id: "recent", label: "Последние" },
          { id: "add",    label: "Добавить" },
          { id: "saveas", label: "Сохранить как" },
          { id: "save",   label: "Сохранить" },
          { id: "print",  label: "Печать" },
          { id: "export", label: "Экспорт" },
        ];
        return (
          <div className="fixed inset-0 z-50" onClick={() => setActiveRibbon("home")}>
            <div className="absolute top-14 left-0 flex shadow-xl border border-gray-300"
              onClick={(e) => e.stopPropagation()}
              style={{ background: "#f9f9f9", minHeight: 420, width: 580 }}>
              {/* Левая боковая панель */}
              <div className="w-36 flex flex-col text-xs border-r border-gray-300" style={{ background: "#e8e8e8" }}>
                {sections.map((item) => (
                  <button key={item.id}
                    onClick={() => setFileSectionState(item.id)}
                    className="px-4 py-2.5 text-left hover:bg-blue-100 text-[12px]"
                    style={{
                      background: fileSectionState === item.id ? "#2563eb" : "transparent",
                      color: fileSectionState === item.id ? "white" : "#1f1f1f",
                      fontWeight: fileSectionState === item.id ? 600 : 400,
                    }}>
                    {item.label}
                  </button>
                ))}
                <div className="mt-auto flex flex-col border-t border-gray-400">
                  <button className="px-4 py-2 text-left text-[12px] hover:bg-gray-200 flex items-center gap-2">
                    <Icon name="Settings" size={13} /> Настройки
                  </button>
                  <button className="px-4 py-2 text-left text-[12px] hover:bg-red-100 text-red-600 flex items-center gap-2"
                    onClick={() => setActiveRibbon("home")}>
                    <Icon name="X" size={13} /> Закрыть
                  </button>
                </div>
              </div>

              {/* Правая область */}
              <div className="flex-1 p-4 overflow-y-auto">

                {/* ── Создать ── */}
                {fileSectionState === "new" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Создать новый проект</div>
                    <button
                      onClick={handleNewProject}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-gray-200 group">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-blue-400" style={{ background: "#fff" }}>
                        <Icon name="FilePlus" size={22} />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Новый пустой проект</div>
                        <div className="text-[11px] text-gray-400">Очистить схему и начать с нуля</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Добавить ── */}
                {fileSectionState === "add" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Добавить схему из файла</div>
                    {[
                      { icon: "FileText" as const,    label: "CSV из АэроСети",                 ext: "рекомендуется",  action: "csv-aero" },
                      { icon: "FileJson" as const,    label: "Добавить схему из файла",        ext: ".vproj / .json", action: "json" },
                      { icon: "Code" as const,        label: "Добавить схему из XML",           ext: ".xml",           action: "xml"  },
                      { icon: "Pencil" as const,      label: "Добавить схему из DXF",           ext: ".dxf",           action: "dxf"  },
                      { icon: "Table" as const,       label: "Добавить таблицу из Excel",       ext: ".xlsx",          action: "xlsx" },
                      { icon: "Layers" as const,      label: "DXF + Excel (Вентиляция 2.0)",   ext: "два файла",      action: "combined" },
                      { icon: "FileText" as const,    label: "Добавить схему из TXT",           ext: ".txt",           action: "txt"  },
                    ].map((item) => (
                      <button key={item.label}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 group"
                        onClick={() => {
                          if (item.action === "csv-aero") {
                            setShowCsvImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "dxf") {
                            setShowDxfImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "xlsx") {
                            setShowExcelImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "combined") {
                            setShowCombinedImport(true);
                            setActiveRibbon("home");
                          } else {
                            const inp = document.createElement("input");
                            inp.type = "file"; inp.accept = item.ext;
                            inp.click();
                            setActiveRibbon("home");
                          }
                        }}>
                        <div className="w-8 h-8 flex items-center justify-center rounded border group-hover:border-green-400"
                          style={{
                            background: item.action === "csv-aero" ? "#dcfce7" : item.action === "combined" ? "#ede9fe" : item.action === "dxf" ? "#dbeafe" : "#fff",
                            borderColor: item.action === "csv-aero" ? "#86efac" : item.action === "combined" ? "#a78bfa" : item.action === "dxf" ? "#93c5fd" : "#d1d5db",
                          }}>
                          <Icon name={item.icon} size={18} />
                        </div>
                        <div>
                          <div className="text-[12px] font-medium" style={{ color: item.action === "csv-aero" ? "#15803d" : item.action === "combined" ? "#5b21b6" : "#1f2937" }}>
                            {item.label}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {item.action === "csv-aero" ? "✓ X,Y,Z координаты + все параметры в одном файле"
                            : item.action === "combined" ? "✓ DXF координаты + Excel параметры и глубины"
                            : item.action === "dxf" ? "✓ НаноКАД, АэроСеть, AutoCAD"
                            : item.ext}
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {/* ── Открыть ── */}
                {fileSectionState === "open" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Открыть проект</div>
                    <button onClick={handleOpen}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-gray-200 group">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-blue-400" style={{ background: "#fff" }}>
                        <Icon name="FolderOpen" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Открыть файл проекта</div>
                        <div className="text-[11px] text-gray-400">Формат .vproj или .json</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Сохранить ── */}
                {fileSectionState === "save" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Сохранить проект</div>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-[11px] text-gray-600">Файл:</span>
                      <input type="text" value={projectFileName}
                        onChange={(e) => setProjectFileName(e.target.value)}
                        className="flex-1 text-[12px] px-2 py-1 border border-gray-300 rounded"
                        style={{ fontFamily: "inherit" }} />
                    </div>
                    <button onClick={() => { handleSave(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "#dbeafe" }}>
                        <Icon name="Save" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-blue-700">Сохранить</div>
                        <div className="text-[11px] text-gray-400">Ctrl+S — скачать файл {projectFileName}</div>
                      </div>
                    </button>
                    <div className="text-[11px] text-gray-500 mt-2 px-1">
                      Узлов: <b>{nodes.length}</b> · Ветвей: <b>{branchesRaw.length}</b> · Горизонтов: <b>{horizons.length}</b>
                    </div>
                  </>
                )}

                {/* ── Сохранить как ── */}
                {fileSectionState === "saveas" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Сохранить как</div>
                    <button onClick={() => { handleSaveAs(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-green-50 border border-gray-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-green-400" style={{ background: "#f0fdf4" }}>
                        <Icon name="SaveAll" size={22} className="text-green-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Сохранить как новый файл</div>
                        <div className="text-[11px] text-gray-400">Выбрать имя и скачать</div>
                      </div>
                    </button>
                    <button onClick={() => { handleSave(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 border border-gray-200 group">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "#fff" }}>
                        <Icon name="FileJson" size={16} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Сохранить как JSON (.vproj)</div>
                        <div className="text-[10px] text-gray-400">Вся схема, горизонты, параметры</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Печать ── */}
                {fileSectionState === "print" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Печать схемы</div>
                    <button onClick={() => { handlePrint(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-gray-50 border border-gray-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-gray-300 group-hover:border-gray-400" style={{ background: "#f9fafb" }}>
                        <Icon name="Printer" size={22} className="text-gray-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Печать / PDF</div>
                        <div className="text-[11px] text-gray-400">Открыть диалог печати браузера (Ctrl+P)</div>
                      </div>
                    </button>
                    <div className="text-[11px] text-gray-500 px-1 mt-1">
                      Совет: в диалоге печати выберите «Сохранить как PDF» для экспорта в PDF.
                    </div>
                  </>
                )}

                {/* ── Экспорт ── */}
                {fileSectionState === "export" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Экспорт</div>
                    <button onClick={() => { handleSave(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300">
                        <Icon name="FileJson" size={16} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в JSON (.vproj)</div>
                        <div className="text-[10px] text-gray-400">Полный формат проекта</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Остальные секции — заглушки ── */}
                {!["new", "add", "open", "save", "saveas", "print", "export"].includes(fileSectionState) && (
                  <div className="text-[12px] text-gray-400 pt-4">
                    Функция «{sections.find((s) => s.id === fileSectionState)?.label}» будет реализована.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ RIBBON CONTENT: СПРАВОЧНИКИ ══════════════════════════════════ */}
      {activeRibbon === "general" && (
      <div className="h-[92px] flex items-stretch px-1 py-1 gap-0.5"
        style={{ background: "linear-gradient(180deg,#fafafa,#ececec)", borderBottom: "1px solid #b8b8b8" }}>
        <RibbonGroup label="Вентиляция">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Wind" label="Вентиляторы" sublabel="" onClick={() => { setEquipRefTab("fans"); setShowEquipRef(true); }} />
            <RibbonBigBtn icon="Layers" label="Типы выработок" sublabel="" onClick={() => { setEquipRefTab("types"); setShowEquipRef(true); }} />
            <RibbonBigBtn icon="Square" label="Перемычки" sublabel="" onClick={() => { setEquipRefTab("bulkheads"); setShowEquipRef(true); }} />
          </div>
        </RibbonGroup>
        <RibbonGroup label="Аварии">
          <div className="flex items-stretch gap-1">

            <RibbonBigBtn icon="Radio" label="Датчики" sublabel="" onClick={() => { setEquipRefTab("sensors"); setShowEquipRef(true); }} />
            <RibbonBigBtn icon="FileText" label="Типовые мероприятия" sublabel="" onClick={() => { setEquipRefTab("typical"); setShowEquipRef(true); }} />
          </div>
        </RibbonGroup>
        <RibbonGroup label="Трубопровод">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Gauge" label="Насосы" sublabel="" onClick={() => { setEquipRefTab("pumps"); setShowEquipRef(true); }} />
            <RibbonBigBtn icon="GitBranch" label="Трубы" sublabel="" onClick={() => { setEquipRefTab("pipes"); setShowEquipRef(true); }} />
          </div>
        </RibbonGroup>
        <RibbonGroup label="Общее">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Truck" label="Транспорт" sublabel="" onClick={() => { setEquipRefTab("transport"); setShowEquipRef(true); }} />
            <RibbonBigBtn icon="Ruler" label="Единицы" sublabel="измерения" onClick={() => { setEquipRefTab("units"); setShowEquipRef(true); }} />
            <RibbonBigBtn icon="BookMarked" label="Условные" sublabel="обозначения" onClick={() => setShowLegend(true)} />
          </div>
        </RibbonGroup>
      </div>
      )}

      {/* ═══ RIBBON CONTENT ═══════════════════════════════════════════════ */}
      {activeRibbon !== "general" && (
      <div className="h-[92px] flex items-stretch px-1 py-1 gap-0.5 overflow-x-auto"
        style={{ background: "linear-gradient(180deg,#fafafa,#ececec)", borderBottom: "1px solid #b8b8b8" }}>

        {/* ── Группа: Объекты ── */}
        <RibbonGroup label="Объекты">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Plus" label="Добавить" sublabel="выработку"
              onClick={() => setTool("branch")} />
            <RibbonBigBtn icon="Scissors" label="Разделить" sublabel="выработку"
              disabled={!selectedBranchId}
              onClick={() => {
                if (!selectedBranchId) return;
                const b = branches.find(br => br.id === selectedBranchId);
                if (!b) return;
                const fromN = nodes.find(n => n.id === b.fromId);
                const toN = nodes.find(n => n.id === b.toId);
                if (!fromN || !toN) return;
                const mx = (fromN.x + toN.x) / 2;
                const my = (fromN.y + toN.y) / 2;
                const mz = (fromN.z + toN.z) / 2;
                handleSplitBranchAt(selectedBranchId, mx, my, mz);
              }} />
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

        {/* ── УО: компактная кнопка + выпадающая панель ── */}
        {(() => {
          // Группируем символы по subgroup/group
          const symGroups: { label: string; items: typeof LEGEND_TYPES }[] = [];
          const seen = new Map<string, typeof LEGEND_TYPES[0][]>();
          LEGEND_TYPES.forEach(lt => {
            const key = lt.subgroup ?? lt.group;
            if (!seen.has(key)) seen.set(key, []);
            seen.get(key)!.push(lt);
          });
          seen.forEach((items, label) => symGroups.push({ label, items }));

          const activeLt = LEGEND_TYPES.find(l => l.id === activeSymbolTypeId);
          const hasActive = tool === "symbol" && !!activeLt;

          return (
            <div className="relative flex-shrink-0 h-full" style={{ borderRight: "1px solid #d0d0d0" }}>
              {/* ── Кнопка-триггер ── */}
              <div className="flex flex-col h-full">
                <div className="flex-1 flex items-center gap-1 px-1.5 pt-1">
                  <button
                    ref={uoBtnRef}
                    onClick={() => {
                      const rect = uoBtnRef.current?.getBoundingClientRect();
                      if (rect) {
                        const panelW = 560;
                        const left = Math.min(rect.left, window.innerWidth - panelW - 8);
                        setUOPanelPos({ left: Math.max(4, left), top: rect.bottom + 2 });
                      }
                      setShowUOPanel(v => !v);
                    }}
                    title="Условные обозначения — выбрать символ для размещения на схеме"
                    style={{
                      width: 50, height: 50,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                      borderRadius: 4,
                      border: showUOPanel ? "1.5px solid #2563eb" : hasActive ? "1.5px solid #3b82f6" : "1px solid #c8c8c8",
                      background: showUOPanel ? "#dbeafe" : hasActive ? "#eff6ff" : "white",
                      cursor: "pointer", padding: 0, flexShrink: 0,
                    }}>
                    {hasActive ? (
                      <svg width={32} height={26} viewBox="0 0 48 40">
                        <g dangerouslySetInnerHTML={{ __html: activeLt!.svgContent }} />
                      </svg>
                    ) : (
                      <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" strokeLinecap="round">
                        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                      </svg>
                    )}
                    <svg width={8} height={5} viewBox="0 0 8 5">
                      <path d={showUOPanel ? "M0,4 L4,0 L8,4" : "M0,0 L4,4 L8,0"} fill="none" stroke="#888" strokeWidth="1.3"/>
                    </svg>
                  </button>

                  {/* Подсказка активного символа */}
                  {hasActive && (
                    <div className="flex flex-col justify-center" style={{ maxWidth: 90 }}>
                      <div className="text-[8px] text-blue-700 font-semibold leading-tight" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {activeLt!.name}
                      </div>
                      <div className="text-[7px] text-blue-400 mt-0.5">↓ кликни на ветвь</div>
                      <button className="text-[8px] text-gray-400 hover:text-red-500 text-left mt-0.5 leading-none"
                        onClick={(e) => { e.stopPropagation(); setTool("select"); setActiveSymbolTypeId(null); setShowUOPanel(false); }}>
                        ✕ отмена
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-[8px] text-center text-gray-500 px-1 pb-0.5 pt-0.5 leading-tight"
                  style={{ borderTop: "1px solid #d4d4d4" }}>
                  Усл. обозначения
                </div>
              </div>

              {/* ── Выпадающая панель ── */}
              {showUOPanel && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUOPanel(false)} />
                  <div style={{
                      position: "fixed",
                      left: uoPanelPos.left,
                      top: uoPanelPos.top,
                      zIndex: 9999,
                      background: "white",
                      border: "1px solid #b8c8d8",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.20)",
                      borderRadius: 6,
                      width: 560,
                      maxHeight: "72vh",
                      overflowY: "auto",
                    }}
                    onMouseLeave={() => setUoTooltip(null)}>

                    {/* Tooltip */}
                    {uoTooltip && (
                      <div style={{
                        position: "fixed",
                        left: Math.min(uoTooltip.x + 8, window.innerWidth - 220),
                        top: uoTooltip.y - 36,
                        zIndex: 10000,
                        background: "#1e293b",
                        color: "white",
                        fontSize: 10,
                        padding: "4px 8px",
                        borderRadius: 4,
                        pointerEvents: "none",
                        maxWidth: 210,
                        lineHeight: 1.3,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                        whiteSpace: "pre-wrap",
                      }}>
                        {uoTooltip.name}
                      </div>
                    )}

                    {/* Шапка */}
                    <div className="flex items-center justify-between px-3 py-1.5 sticky top-0 z-10"
                      style={{ background: "linear-gradient(180deg,#e8eef8,#dde7f4)", borderBottom: "1px solid #c8d4e8" }}>
                      <span className="text-[11px] font-semibold text-gray-700">Условные обозначения</span>
                      <button onClick={() => { setShowUOPanel(false); setUoTooltip(null); }}
                        className="text-gray-400 hover:text-gray-700 w-5 h-5 flex items-center justify-center text-[14px] leading-none rounded hover:bg-gray-200">×</button>
                    </div>

                    {/* Контент — группы */}
                    <div className="p-2 flex flex-col gap-2">
                      {symGroups.map(({ label, items }) => (
                        <div key={label}>
                          <div className="text-[8.5px] font-semibold uppercase tracking-wide px-1 py-0.5 mb-1"
                            style={{ borderBottom: "1px solid #eaeaea", color: "#9ca3af" }}>
                            {label}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, paddingLeft: 2 }}>
                            {items.map(lt => {
                              const isActive = activeSymbolTypeId === lt.id && tool === "symbol";
                              return (
                                <button key={lt.id}
                                  onClick={() => { handlePickSymbol(lt.id); setShowUOPanel(false); setUoTooltip(null); }}
                                  onMouseEnter={e => {
                                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setUoTooltip({ name: lt.name, x: r.left, y: r.top });
                                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "#e8f0fe";
                                  }}
                                  onMouseLeave={e => {
                                    setUoTooltip(null);
                                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "#f8faff";
                                  }}
                                  style={{
                                    width: 32, height: 32,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    borderRadius: 4,
                                    border: isActive ? "2px solid #2563eb" : "1px solid #d8e0ec",
                                    background: isActive ? "#dbeafe" : "#f8faff",
                                    cursor: "pointer", padding: 0, flexShrink: 0,
                                    transition: "border-color .12s, background .12s",
                                    outline: "none",
                                  }}>
                                  <svg width={24} height={20} viewBox="0 0 48 40">
                                    <g dangerouslySetInnerHTML={{ __html: lt.svgContent }} />
                                  </svg>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })()}

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
            <button onClick={() => { setPreset("plan"); setTimeout(() => setFitToScreenNonce(Date.now()), 80); }}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-blue-100 hover:border-blue-400 border border-transparent rounded min-w-[58px]"
              style={{ background: !viewInfo.is3D ? "#dbeafe" : undefined, borderColor: !viewInfo.is3D ? "#93c5fd" : undefined }}
              title="План — вид сверху (XY) + вписать в экран">
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

        {/* ── Группа: Команды вентилятора (main_loop: calc/reverse/off/report) ── */}
        {selectedBranch?.hasFan && (
          <RibbonGroup label="Вентилятор">
            <div className="flex items-stretch gap-1">
              {/* calc — пересчитать сеть */}
              <button onClick={handleSolve} disabled={vcSolving}
                className="flex flex-col items-center justify-center px-2 py-1 hover:bg-green-50 border border-transparent hover:border-green-400 rounded min-w-[52px] disabled:opacity-50"
                title="Пересчитать (F9)">
                <Icon name="RefreshCw" size={18} className="text-green-600" />
                <div className="text-[10px] mt-0.5">Расчёт</div>
              </button>
              {/* reverse — переключить реверс */}
              <button
                disabled={selectedBranch.fanStopped}
                onClick={() => updateBranch(selectedBranch.id, { fanReverse: !selectedBranch.fanReverse })}
                className="flex flex-col items-center justify-center px-2 py-1 border rounded min-w-[52px]"
                style={{
                  background: selectedBranch.fanReverse ? "#fee2e2" : "#f0fdf4",
                  borderColor: selectedBranch.fanReverse ? "#fca5a5" : "#86efac",
                  opacity: selectedBranch.fanStopped ? 0.4 : 1,
                  cursor: selectedBranch.fanStopped ? "not-allowed" : "pointer",
                }}
                title="Ctrl+R — переключить реверс">
                <Icon name={selectedBranch.fanReverse ? "ArrowLeft" : "ArrowRight"} size={18}
                  className={selectedBranch.fanReverse ? "text-red-600" : "text-green-600"} />
                <div className="text-[10px] mt-0.5" style={{ color: selectedBranch.fanReverse ? "#b91c1c" : "#15803d" }}>
                  {selectedBranch.fanReverse ? "Реверс" : "Прямой"}
                </div>
              </button>
              {/* off — остановить/запустить */}
              <button
                onClick={() => updateBranch(selectedBranch.id, { fanStopped: !selectedBranch.fanStopped })}
                className="flex flex-col items-center justify-center px-2 py-1 border rounded min-w-[52px]"
                style={{
                  background: selectedBranch.fanStopped ? "#fef3c7" : "#f9fafb",
                  borderColor: selectedBranch.fanStopped ? "#fcd34d" : "#d1d5db",
                  cursor: "pointer",
                }}
                title={selectedBranch.fanStopped ? "Запустить вентилятор" : "Остановить вентилятор"}>
                <Icon name={selectedBranch.fanStopped ? "Play" : "Square"} size={18}
                  className={selectedBranch.fanStopped ? "text-amber-600" : "text-gray-500"} />
                <div className="text-[10px] mt-0.5" style={{ color: selectedBranch.fanStopped ? "#92400e" : "#6b7280" }}>
                  {selectedBranch.fanStopped ? "Запуск" : "Стоп"}
                </div>
              </button>
              {/* report — диагностика */}
              <button
                onClick={() => setShowDiagnostics(true)}
                disabled={!solveResult}
                className="flex flex-col items-center justify-center px-2 py-1 border border-transparent hover:border-blue-300 hover:bg-blue-50 rounded min-w-[52px] disabled:opacity-40"
                title="Отчёт и диагностика">
                <Icon name="FileText" size={18} className="text-blue-600" />
                <div className="text-[10px] mt-0.5 text-blue-700">Отчёт</div>
              </button>
            </div>
          </RibbonGroup>
        )}

        {/* ── Группа: Расчёт сети ── */}
        <RibbonGroup label="Расчёт сети">
          <div className="flex items-stretch gap-1">
            {/* Кнопка запуска */}
            <button onClick={handleSolve} disabled={vcSolving}
              className="flex flex-col items-center justify-center px-3 py-1 hover:bg-green-50 hover:border-green-400 border border-transparent rounded min-w-[64px] disabled:opacity-50"
              title="Запустить расчёт воздухораспределения (F9)">
              <Icon name={vcSolving ? "Loader" : "Play"} size={22} className={vcSolving ? "text-gray-400 animate-spin" : "text-green-600"} />
              <div className="text-[10px] leading-tight mt-0.5 text-center">
                <div>Расчёт</div><div>сети</div>
              </div>
            </button>

            {/* Переключатель метода */}
            <div className="flex flex-col justify-center gap-0.5 border-l border-gray-200 pl-1">
              <div className="text-[9px] text-gray-400 leading-tight mb-0.5">Метод:</div>
              {(["cross", "mkr"] as const).map(m => (
                <button key={m}
                  onClick={() => setCalcMode(m)}
                  className="text-[10px] px-1.5 py-0.5 rounded leading-tight text-left font-medium"
                  style={{
                    background: calcMode === m ? "#1d4ed8" : "transparent",
                    color: calcMode === m ? "white" : "#374151",
                    border: calcMode === m ? "1px solid #1e40af" : "1px solid #d1d5db",
                  }}>
                  {m === "cross" ? "Кросс" : "МКР"}
                </button>
              ))}
            </div>

            {/* Кнопка параметров */}
            <div className="relative flex flex-col justify-center border-l border-gray-200 pl-1">
              <button onClick={() => setShowSolverParams(v => !v)}
                className="flex flex-col items-center justify-center px-2 py-1 hover:bg-gray-100 border border-transparent hover:border-gray-300 rounded min-w-[44px]"
                title="Параметры расчёта">
                <Icon name="Settings" size={18} className="text-gray-500" />
                <div className="text-[9px] mt-0.5 text-gray-500">Параметры</div>
              </button>
              {showSolverParams && (
                <div className="fixed top-[160px] right-4 z-50 bg-white border border-gray-300 rounded shadow-lg p-3 min-w-[240px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-semibold text-gray-700">Параметры расчёта</span>
                    <button onClick={() => setShowSolverParams(false)} className="text-gray-400 hover:text-gray-600">
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                  {/* Выбор метода в диалоге */}
                  <div className="mb-2">
                    <label className="text-[10px] text-gray-500 block mb-1">Метод расчёта</label>
                    <select value={calcMode} onChange={e => setCalcMode(e.target.value as "cross" | "mkr")}
                      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1">
                      <option value="cross">Метод Кросса (Андрияшева–Кросса)</option>
                      <option value="mkr">МКР — Метод контурных расходов</option>
                    </select>
                  </div>
                  <div className="mb-2">
                    <label className="text-[10px] text-gray-500 block mb-1">Макс. погрешность (Па)</label>
                    <input type="number" value={solverTolerance} step="0.00001"
                      onChange={e => setSolverTolerance(Number(e.target.value))}
                      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 text-right" />
                  </div>
                  <div className="mb-2">
                    <label className="text-[10px] text-gray-500 block mb-1">Макс. число итераций</label>
                    <input type="number" value={solverMaxIter} step="1000"
                      onChange={e => setSolverMaxIter(Number(e.target.value))}
                      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 text-right" />
                  </div>
                  {calcMode === "cross" && (
                    <div className="mb-2">
                      <label className="text-[10px] text-gray-500 block mb-1">Фактор сходимости α (Кросс)</label>
                      <input type="number" value={solverAlpha} step="0.05" min="0.1" max="1.0"
                        onChange={e => setSolverAlpha(Number(e.target.value))}
                        className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 text-right" />
                    </div>
                  )}
                  <div className="border-t border-gray-200 pt-2 mt-1 mb-2">
                    <div className="text-[10px] font-semibold text-gray-600 mb-1.5">Естественная тяга</div>
                    <label className="text-[10px] text-gray-500 block mb-1">Температура на поверхности (°C)</label>
                    <input type="number" value={surfaceTemp} step="1" min="-40" max="50"
                      onChange={e => setSurfaceTemp(Number(e.target.value))}
                      className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 text-right" />
                    <div className="text-[9px] text-gray-400 mt-1">
                      Влияет на ρ·g·Δz для каждой ветви.<br/>
                      Температура узлов задаётся в свойствах узла.
                    </div>
                  </div>
                  <button onClick={() => setShowSolverParams(false)}
                    className="w-full mt-1 py-1 bg-blue-600 text-white text-[11px] rounded hover:bg-blue-700">
                    Сохранить
                  </button>
                </div>
              )}
            </div>

            {/* Сброс демо */}
            <button onClick={() => {
              setBranches(DEMO_BRANCHES);
              setNodes(DEMO_NODES);
              setSolveResult(null);
              setSchemaSymbols([{ id: "SYM_FAN_7", typeId: "fan", x: 0, y: 0, branchId: "7", t: 0.5, airDirection: "forward" }]);
              setSelectedBranchId(null);
              setSelectedNodeId(null);
            }}
              className="flex flex-col items-center justify-center px-2 py-1 hover:bg-gray-100 hover:border-gray-300 border border-transparent rounded min-w-[48px]"
              title="Сбросить демо-сеть">
              <Icon name="RotateCcw" size={18} className="text-gray-500" />
              <div className="text-[9px] leading-tight mt-0.5 text-center text-gray-500">Демо</div>
            </button>

            {/* Результат */}
            {solveResult && (
              <div className="flex flex-col justify-center px-2 text-[10px] border-l border-gray-300 ml-1 min-w-[90px]">
                <div className={`font-semibold ${solveResult.ok ? "text-green-700" : "text-red-600"}`}>
                  {solveResult.ok ? "✔ Сошлось" : "✘ Не сошлось"}
                </div>
                <div className="text-gray-500">Итераций: {solveResult.iterations}</div>
                <div className="text-gray-500">|ΔH|: {solveResult.maxDeltaH?.toExponential(2)}</div>
              </div>
            )}
          </div>
        </RibbonGroup>


      </div>
      )}

      {/* ═══ MAIN AREA ════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── ВЕРТИКАЛЬНЫЕ ВКЛАДКИ СЛЕВА ────────────────────────────── */}
        <div className="flex flex-col flex-shrink-0"
          style={{ width: (selectedNodeId || selectedBranchId || fanSymbolBranchId) ? 24 : 0, background: "#e8e8e8", borderRight: (selectedNodeId || selectedBranchId || fanSymbolBranchId) ? "1px solid #b8b8b8" : "none", overflow: "hidden", transition: "width 0.15s" }}>
          {(selectedNodeId
            ? ([
                { id: "params", label: "Параметры" },
                { id: "measure", label: "Замеры" },
                { id: "pipes", label: "Трубы" },
                { id: "indicators", label: "Индикаторы" },
              ] as { id: SideTab; label: string }[])
            : fanSymbolBranchId
            ? ([
                { id: "fan", label: "Вентилятор" },
              ] as { id: SideTab; label: string }[])
            : ([
                { id: "general", label: "Общие" },
                { id: "vent", label: "Вентиляция" },
                { id: "topology", label: "Топология" },
                { id: "areas", label: "Участки" },
                { id: "waterpipes", label: "Трубы:" },
                { id: "conveyor", label: "Конвейер" },
                { id: "coords", label: "Координаты" },
              ] as { id: SideTab; label: string }[])
          ).map((t) => (
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
              <select
                className="flex-1 text-xs px-1 py-0.5 border border-gray-400 bg-white"
                value={activeSide === "horizons" ? "horizons" : "props"}
                onChange={(e) => {
                  if (e.target.value === "horizons") setActiveSide("horizons");
                  else setActiveSide("general");
                }}>
                <option value="props">Свойства</option>
                <option value="horizons">Горизонты</option>
                <option value="check">Проверка</option>
              </select>
            </div>
          </div>

          {/* Заголовок секции */}
          <div className="px-2 py-1.5 border-b border-gray-300 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-800">
              {activeSide === "params" && (selectedNode ? `Узел: ${selectedNode.number || selectedNode.id}` : selectedBranch ? `Ветвь: ${selectedBranch.id}` : "Параметры")}
              {activeSide === "general" && "Свойства объекта"}
              {activeSide === "horizons" && "Горизонты"}
              {activeSide === "vent" && "Аэродинамика"}
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
              <NodePropsPanel
                node={selectedNode}
                onUpdate={(patch) => updateNode(selectedNode.id, patch)}
              />
            )}

            {/* ═══ ВКЛАДКИ ВЕТВИ (Топология / Вентилятор / Трубы: вода / Конвейер) ══ */}
            {(["topology","fan","waterpipes","conveyor","params"].includes(activeSide)) && !selectedNode && selectedBranch && (
              <BranchPropsPanel
                branch={selectedBranch}
                horizons={horizons}
                onUpdate={(patch) => updateBranch(selectedBranch.id, patch)}
                activeTab={activeSide}
                defaultInnerTab={fanSymbolBranchId === selectedBranch.id ? "Вентилятор" : undefined}
                onRemoveFan={selectedBranch.hasFan ? () => {
                  const sym = schemaSymbols.find(s => s.typeId === "fan" && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                  updateBranch(selectedBranch.id, { hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0 });
                  setFanSymbolBranchId(null);
                } : undefined}
                fanSymbolScale={(() => {
                  const sym = schemaSymbols.find(s => s.typeId === "fan" && s.branchId === selectedBranch.id);
                  return sym?.scale ?? 1;
                })()}
                onFanSymbolScale={selectedBranch.hasFan ? (scale) => {
                  setSchemaSymbols(prev => prev.map(s =>
                    s.typeId === "fan" && s.branchId === selectedBranch.id ? { ...s, scale } : s
                  ));
                } : undefined}
                onFanSymbolDelete={schemaSymbols.some(s => s.typeId === "fan" && s.branchId === selectedBranch.id) ? () => {
                  const sym = schemaSymbols.find(s => s.typeId === "fan" && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                } : undefined}
                normalFlows={normalFlows}
                mineFans={mineFans}
                mineBulkheads={mineBulkheads}
                onOpenFanLibrary={() => { setShowEquipRef(true); setEquipRefTab("fans"); }}
                mineTypes={mineTypes}
                onOpenTypesLibrary={() => { setShowEquipRef(true); setEquipRefTab("types"); }}
                bulkheadSymTypeId={(() => {
                  const bkSym = schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  return bkSym?.typeId;
                })()}
                unitsConfig={unitsConfig}
              />
            )}



            {/* ═══ Панель выделенного условного обозначения ══════════════ */}
            {activeSide === "params" && !selectedNode && !selectedBranch && selectedSymbolId && (() => {
              const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
              if (!sym) return null;
              const isBulkheadSym = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
              const isWindowBulkhead = WINDOW_BULKHEAD_IDS.has(sym.typeId);
              const brForSym = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
              const updSym = (patch: Partial<SchemaSymbol>) =>
                setSchemaSymbols(prev => prev.map(s => s.id === sym.id ? { ...s, ...patch } : s));
              const updBr = (patch: Partial<typeof branches[0]>) =>
                sym.branchId && updateBranch(sym.branchId, patch);

              return (
                <div className="p-2 text-[11px]">
                  {/* ── Общие свойства ── */}
                  <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                    Общие свойства
                  </div>

                  {/* Масштаб */}
                  <div className="flex items-center gap-1 mb-1.5">
                    <span className="text-gray-500 w-20 flex-shrink-0">Масштаб</span>
                    <input type="range" min={5} max={400} step={5}
                      value={Math.round((sym.scale ?? 1) * 100)}
                      onChange={(e) => updSym({ scale: Number(e.target.value) / 100 })}
                      className="flex-1" style={{ accentColor: "#2563eb" }} />
                    <input type="number" min={5} max={400} step={5}
                      value={Math.round((sym.scale ?? 1) * 100)}
                      onChange={(e) => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); updSym({ scale: v / 100 }); }}
                      className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                      style={{ fontSize: 11 }} />
                    <span className="text-gray-500 flex-shrink-0">%</span>
                  </div>

                  {/* Описание */}
                  <div className="flex items-start gap-1 mb-1.5">
                    <span className="text-gray-500 w-20 flex-shrink-0 pt-0.5">Описание</span>
                    <textarea
                      value={sym.description ?? ""}
                      onChange={(e) => updSym({ description: e.target.value })}
                      rows={2}
                      className="flex-1 px-1 py-0.5 text-[11px] resize-none"
                      placeholder="Введите описание объекта..."
                      style={{ border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 }} />
                  </div>

                  {/* ── Аэродинамическое сопротивление (только для перемычек с привязкой к ветви) ── */}
                  {isBulkheadSym && brForSym && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Аэродинамическое сопротивление
                      </div>

                      {/* R = ... кМюрг — вычисленное сопротивление этой перемычки */}
                      <div className="flex items-center justify-center py-1 mb-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[13px] font-semibold" style={{ color: "#1a3a6b" }}>
                          R = {(() => {
                            const mode = sym.bkResMode ?? "project";
                            const fnFrom = nodes.find(n => n.id === brForSym.fromId);
                            const fnTo   = nodes.find(n => n.id === brForSym.toId);
                            const tF = fnFrom ? (fnFrom.atmosphereLink ? surfaceTemp : (fnFrom.airTemp ?? surfaceTemp)) : surfaceTemp;
                            const tT = fnTo   ? (fnTo.atmosphereLink   ? surfaceTemp : (fnTo.airTemp   ?? surfaceTemp)) : surfaceTemp;
                            const rho = 353.0 / (273.0 + Math.max(-30, Math.min(100, (tF + tT) / 2)));
                            let rKmu = 0;
                            if (mode === "manual") {
                              rKmu = sym.bkManualR ?? 0;
                            } else if (mode === "survey") {
                              const q = sym.bkSurveyQ ?? 0;
                              const dp = sym.bkSurveyDP ?? 0;
                              const rNsm8 = q > 0 ? dp / (q * q) : 0;
                              rKmu = rNsm8 / 10;
                            } else {
                              const sw = sym.bkWindowArea ?? 0;
                              const branchArea = brForSym?.area ?? 0;
                              const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                                || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                              let rNsm8 = 0;
                              if (isFullyOpen) {
                                rNsm8 = 0;
                              } else if (sw > 0.001) {
                                const mu = 0.65;
                                rNsm8 = rho / (2 * mu * mu * sw * sw);
                              } else {
                                const kAir = sym.bkManualAirPerm
                                  ? (sym.bkCustomAirPerm ?? 0)
                                  : (sym.bkAirPerm ?? brForSym?.bulkheadAirPerm ?? 0);
                                rNsm8 = kAir > 0 ? 1 / (kAir * kAir) : (sym.bkBulkheadR ?? brForSym?.bulkheadR ?? 0) * 1e-6;
                              }
                              rKmu = rNsm8 / 10;
                            }
                            if (rKmu === 0) return "0 кМюрг";
                            const mag = Math.floor(Math.log10(Math.abs(rKmu)));
                            const d = Math.max(4, -mag + 2);
                            return `${rKmu.toFixed(d)} кМюрг`;
                          })()}
                        </span>
                      </div>

                      {/* Задается */}
                      <div className="flex items-center gap-1 mb-1.5" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                        <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Задается:</span>
                        <select
                          value={sym.bkResMode ?? "project"}
                          onChange={e => updSym({ bkResMode: e.target.value as "project" | "survey" | "manual" })}
                          className="flex-1 text-[11px] px-1"
                          style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                          <option value="project">Проектными данными</option>
                          <option value="survey">Воздушной съемкой</option>
                          <option value="manual">Вручную</option>
                        </select>
                      </div>

                      {/* Режим: Проектными данными */}
                      {(sym.bkResMode ?? "project") === "project" && (
                        <>
                          {isWindowBulkhead ? (
                            <div className="flex items-center gap-1 mb-1.5" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                              <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>S вентокна:</span>
                              <input type="number" step="0.1" min="0"
                                value={sym.bkWindowArea ?? 0}
                                onChange={e => updSym({ bkWindowArea: parseFloat(e.target.value) || 0 })}
                                className="flex-1 text-[11px] px-1 text-right"
                                style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                              <span className="text-[11px] text-gray-400 flex-shrink-0">м²</span>
                            </div>
                          ) : (
                            <>
                              <div className="font-semibold text-[10px] text-gray-500 mb-1 mt-0.5" style={{ letterSpacing: "0.03em" }}>
                                Воздухопроницаемость
                              </div>
                              <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                                <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Тип:</span>
                                <input type="checkbox"
                                  checked={sym.bkManualAirPerm ?? false}
                                  onChange={e => updSym({ bkManualAirPerm: e.target.checked })}
                                  style={{ width: 11, height: 11, cursor: "pointer", accentColor: "#2563eb" }} />
                                <span className="text-[11px] text-gray-600">Задается вручную</span>
                              </div>
                              <div className="flex items-center gap-1 mb-1.5" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                                <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Значение:</span>
                                {sym.bkManualAirPerm ? (
                                  <input type="number" step="0.0001"
                                    value={sym.bkCustomAirPerm ?? 0}
                                    onChange={e => updSym({ bkCustomAirPerm: parseFloat(e.target.value) || 0 })}
                                    className="flex-1 text-[11px] px-1 text-right"
                                    style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                                ) : (
                                  <span className="flex-1 text-right text-gray-700 text-[11px]">
                                    {(sym.bkAirPerm ?? brForSym?.bulkheadAirPerm)
                                      ? `${(sym.bkAirPerm ?? brForSym?.bulkheadAirPerm ?? 0).toFixed(4)} м²/(с·√Па)`
                                      : "—"}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "#1a3a6b" }}>
                              {brForSym?.dP != null ? `${Math.round(brForSym.dP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}

                      {/* Режим: Воздушной съемкой */}
                      {(sym.bkResMode ?? "project") === "survey" && (
                        <>
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Расход:</span>
                            <input type="number" step="0.1"
                              value={sym.bkSurveyQ ?? 0}
                              onChange={e => updSym({ bkSurveyQ: parseFloat(e.target.value) || 0 })}
                              className="flex-1 text-[11px] px-1 text-right"
                              style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                          </div>
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Падение Р:</span>
                            <input type="number" step="1"
                              value={sym.bkSurveyDP ?? 0}
                              onChange={e => updSym({ bkSurveyDP: parseFloat(e.target.value) || 0 })}
                              className="flex-1 text-[11px] px-1 text-right"
                              style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "#1a3a6b" }}>
                              {brForSym?.dP != null ? `${Math.round(brForSym.dP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}

                      {/* Режим: Вручную */}
                      {(sym.bkResMode ?? "project") === "manual" && (
                        <>
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>R (кМюрг):</span>
                            <input type="number" step="0.0001"
                              value={sym.bkManualR ?? 0}
                              onChange={e => updSym({ bkManualR: parseFloat(e.target.value) || 0 })}
                              className="flex-1 text-[11px] px-1 text-right"
                              style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "#1a3a6b" }}>
                              {brForSym?.dP != null ? `${Math.round(brForSym.dP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* Направление (вентилятор) */}
                  {sym.typeId === "fan" && (
                    <div className="flex items-center gap-1 mb-1.5">
                      <span className="text-gray-500 w-20 flex-shrink-0">Направление</span>
                      <select value={sym.airDirection ?? "forward"}
                        onChange={(e) => updSym({ airDirection: e.target.value as "forward" | "reverse" })}
                        className="flex-1 text-[11px] px-1"
                        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                        <option value="forward">По ветви (→)</option>
                        <option value="reverse">Против ветви (←)</option>
                      </select>
                    </div>
                  )}



                  {/* ── Индикаторы (только для перемычек) ── */}
                  {isBulkheadSym && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                        Отображаемые индикаторы
                      </div>
                      {[
                        { key: "indDescription" as const, label: "Описание объекта" },
                        { key: "indResistance"  as const, label: "Аэродинамическое сопротивление" },
                        { key: "indDeltaP"      as const, label: "Модельное падение давления" },
                        { key: "indLeakage"     as const, label: "Утечки на перемычке" },
                      ].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                          <input type="checkbox"
                            checked={!!sym[key]}
                            onChange={(e) => updSym({ [key]: e.target.checked })}
                            style={{ width: 13, height: 13, accentColor: "#2563eb" }} />
                          <span className="text-gray-700">{label}</span>
                        </label>
                      ))}

                      {/* Значения для справки */}
                      {brForSym && (sym.indResistance || sym.indDeltaP || sym.indLeakage) && (
                        <div className="mt-2 p-1.5 rounded text-[10px] space-y-0.5"
                          style={{ background: "#f0f4ff", border: "1px solid #c8d8f0" }}>
                          {sym.indResistance && (
                            <div className="text-gray-600">
                              <span className="text-gray-400">R перемычки: </span>
                              {brForSym.bulkheadR > 0
                                ? `${brForSym.bulkheadR.toFixed(2)} Мюрг`
                                : `${(brForSym.resistance / 1e6).toFixed(3)} Мюрг`}
                            </div>
                          )}
                          {sym.indDeltaP && (
                            <div className="text-gray-600">
                              <span className="text-gray-400">ΔP: </span>
                              {brForSym.dP > 0 ? `${Math.abs(brForSym.dP).toFixed(1)} Па` : "—"}
                            </div>
                          )}
                          {sym.indLeakage && (
                            <div className="text-gray-600">
                              <span className="text-gray-400">Q через перемычку: </span>
                              {brForSym.flow !== 0 ? `${Math.abs(brForSym.flow).toFixed(2)} м³/с` : "—"}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* Пусто — нет выбора */}
            {activeSide === "params" && !selectedNode && !selectedBranch && !selectedSymbolId && (
              <div className="p-4 text-center text-gray-400 text-xs">
                Выделите узел или ветвь на схеме, чтобы редактировать параметры
              </div>
            )}

            {/* ═══ ВКЛАДКА: ОБЩИЕ ════════════════════════════════════════ */}
            {activeSide === "general" && (selectedBranchId || selectedNodeId) && (
              <div className="p-2 space-y-2">
                <FrameGroup title="Общие свойства">
                  <LabeledRow label="Название:" labelWidth={88}>
                    <input type="text"
                      value={selectedBranch ? selectedBranch.type : selectedNode ? selectedNode.name : excavation.name}
                      onChange={(e) => {
                        if (selectedBranch) updateBranch(selectedBranch.id, { type: e.target.value });
                        else if (selectedNode) updateNode(selectedNode.id, { name: e.target.value });
                        else setExcavation({ ...excavation, name: e.target.value });
                      }}
                      className="cad-input flex-1" />
                  </LabeledRow>
                  <LabeledRow label="Номер:" labelWidth={88}>
                    <input type="text" value={excavation.number}
                      onChange={(e) => setExcavation({ ...excavation, number: e.target.value })}
                      className="cad-input flex-1" />
                  </LabeledRow>
                  <LabeledRow label="Горизонт:" labelWidth={88}>
                    {selectedBranch ? (
                      <select
                        value={selectedBranch.horizonId}
                        onChange={(e) => updateBranch(selectedBranch.id, { horizonId: e.target.value })}
                        className="cad-input flex-1">
                        <option value="">— без привязки —</option>
                        {horizons.map((h) => (
                          <option key={h.id} value={h.id}>{h.name} ({h.z} м)</option>
                        ))}
                      </select>
                    ) : selectedNode ? (
                      <select className="cad-input flex-1" disabled>
                        <option>— узел —</option>
                      </select>
                    ) : (
                      <select value={excavation.layer}
                        onChange={(e) => setExcavation({ ...excavation, layer: e.target.value })}
                        className="cad-input flex-1">
                        {LAYERS.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    )}
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

                {/* ── Стиль линий ветвей ── */}
                <FrameGroup title="Ширина и граница ветвей">
                  {selectedBranch || selectedBranchIds.size > 0 ? (
                    <>
                      {selectedBranchIds.size > 0 && (
                        <div className="text-[10px] text-blue-600 px-1 pb-1">
                          Выбрано ветвей: {selectedBranchIds.size}
                        </div>
                      )}
                      <LabeledRow label="Ширина:" labelWidth={108}>
                        <NumWithUnit
                          value={selectedBranch?.lineWidth ?? branchWidth}
                          unit="px"
                          onChange={(v) => {
                            const val = Math.max(0.5, Math.min(20, v));
                            const targets = selectedBranchIds.size > 0
                              ? [...selectedBranchIds]
                              : selectedBranch ? [selectedBranch.id] : [];
                            targets.forEach((id) => updateBranch(id, { lineWidth: val }));
                          }} />
                      </LabeledRow>
                      <LabeledRow label="Граница:" labelWidth={108}>
                        <NumWithUnit
                          value={selectedBranch?.lineBorder ?? branchBorder}
                          unit="px"
                          onChange={(v) => {
                            const val = Math.max(0, Math.min(8, v));
                            const targets = selectedBranchIds.size > 0
                              ? [...selectedBranchIds]
                              : selectedBranch ? [selectedBranch.id] : [];
                            targets.forEach((id) => updateBranch(id, { lineBorder: val }));
                          }} />
                      </LabeledRow>
                    </>
                  ) : (
                    <div className="text-[10px] text-gray-400 px-1 py-1">
                      Выберите ветвь на схеме для изменения ширины и границы
                    </div>
                  )}
                  <div className="text-[10px] text-gray-500 px-1 pt-1">
                    Контур = тёмная окантовка вокруг линии (0 — без обводки).
                  </div>
                  <div className="pt-1">
                    <CadCheckbox checked={thinLines} onChange={setThinLines}
                      label="Тонкие линии 1px (вкл/откл — F6)" />
                    <CadCheckbox checked={colorByHorizon} onChange={setColorByHorizon}
                      label="Окрашивать ветви по цвету горизонта" />
                  </div>
                </FrameGroup>

                {selectedBranch && (
                  <FrameGroup title="Примечание">
                    <textarea
                      value={selectedBranch.comment ?? ""}
                      onChange={(e) => updateBranch(selectedBranch.id, { comment: e.target.value })}
                      rows={4}
                      placeholder="Произвольный текст..."
                      className="w-full text-[11px] px-1"
                      style={{ border: "1px solid #c8c8c8", outline: "none", resize: "vertical", background: "white", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }}
                    />
                  </FrameGroup>
                )}
              </div>
            )}

            {/* ═══ ВКЛАДКА: ГОРИЗОНТЫ ═══════════════════════════════════ */}
            {activeSide === "horizons" && (
              <div className="p-2 space-y-2">
                {/* ── Активный горизонт: задаёт Z для всех новых узлов ── */}
                <FrameGroup title="Активный горизонт (для построения)">
                  <div className="text-[10px] text-gray-600 leading-tight pb-1">
                    Если выбран — все НОВЫЕ узлы создаются с Z = отметке горизонта
                    и автоматически получают его привязку.
                    Существующие объекты не меняются.
                  </div>
                  <div className="flex items-center gap-1">
                    <select value={activeHorizonId}
                      onChange={(e) => setActiveHorizonId(e.target.value)}
                      className="cad-input flex-1">
                      <option value="">— не выбран (Z = текущая плоскость) —</option>
                      {horizons.map((h) => (
                        <option key={h.id} value={h.id}>{h.name} (Z = {h.z} м)</option>
                      ))}
                    </select>
                    {activeHorizon && (
                      <span className="w-4 h-4 rounded-sm border border-gray-400 flex-shrink-0"
                        style={{ background: activeHorizon.color }}
                        title="Цвет активного горизонта" />
                    )}
                  </div>
                  {activeHorizon && (
                    <div className="px-1 py-1 mt-1 text-[11px]"
                      style={{ background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 3 }}>
                      ● Новые узлы будут создаваться на отметке <b>{activeHorizon.z} м</b>
                    </div>
                  )}
                </FrameGroup>

                <FrameGroup title="Список горизонтов">
                  <div className="text-[10px] text-gray-600 leading-tight pb-1">
                    Группировка ветвей по высотным отметкам.
                    Скрытие горизонта прячет все его ветви на схеме.
                    Радио — выбор активного горизонта.
                  </div>
                  <div className="space-y-1">
                    {horizons.map((h) => {
                      const usedCount = branches.filter((b) => b.horizonId === h.id).length;
                      const isActive = activeHorizonId === h.id;
                      return (
                        <div key={h.id} className="border rounded"
                          style={{
                            background: isActive ? "#eff6ff" : "white",
                            borderColor: isActive ? "#3b82f6" : "#d1d5db",
                          }}>
                          {/* ── Строка горизонта ── */}
                          <div className="flex items-center gap-1 px-1 py-1">
                            <input type="radio" name="active-horizon"
                              checked={isActive}
                              onChange={() => setActiveHorizonId(h.id)}
                              title="Сделать активным для построения"
                              className="w-[13px] h-[13px] cursor-pointer flex-shrink-0" />
                            <input type="checkbox" checked={h.visible}
                              onChange={(e) => updateHorizon(h.id, { visible: e.target.checked })}
                              title="Видимость на схеме" className="w-[13px] h-[13px] cursor-pointer flex-shrink-0" />
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
                          {/* ── Подложка плана (внутри строки горизонта) ── */}
                          <div className="px-1 pb-1 pt-0" style={{ borderTop: "1px solid #e5e7eb" }}>
                            {h.image ? (
                              <div className="space-y-1 pt-1">
                                <div className="flex items-center gap-1">
                                  <img src={h.image.dataUrl} alt=""
                                    className="w-10 h-10 object-cover border border-gray-300 rounded flex-shrink-0" />
                                  <div className="flex-1 text-[10px] text-gray-600 leading-tight">
                                    <div className="font-medium text-gray-700 mb-0.5">План горизонта</div>
                                    <code className="text-[9px]">
                                      {Math.round(h.image.bounds.x1)}…{Math.round(h.image.bounds.x2)}
                                      {" × "}
                                      {Math.round(h.image.bounds.y1)}…{Math.round(h.image.bounds.y2)} м
                                    </code>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <CadCheckbox checked={h.image.visible}
                                    onChange={(v) => updateHorizon(h.id, { image: h.image ? { ...h.image, visible: v } : undefined })}
                                    label="Показать" />
                                </div>
                                <LabeledRow label="Прозрачность:" labelWidth={88}>
                                  <input type="range" min={0} max={100} value={Math.round(h.image.opacity * 100)}
                                    onChange={(e) => updateHorizon(h.id, { image: h.image ? { ...h.image, opacity: Number(e.target.value) / 100 } : undefined })}
                                    className="flex-1" />
                                  <span className="text-[10px] w-8 text-right">{Math.round(h.image.opacity * 100)}%</span>
                                </LabeledRow>
                                <div className="flex gap-1">
                                  <button onClick={() => setEditingHorizonImageId(editingHorizonImageId === h.id ? null : h.id)}
                                    className="flex-1 px-2 py-1 text-[11px] border rounded"
                                    style={{
                                      background: editingHorizonImageId === h.id ? "#2563eb" : "white",
                                      color: editingHorizonImageId === h.id ? "white" : "#1f1f1f",
                                      borderColor: editingHorizonImageId === h.id ? "#1d4ed8" : "#d1d5db",
                                    }}>
                                    {editingHorizonImageId === h.id ? "✓ Готово" : "✎ Растянуть"}
                                  </button>
                                  <button onClick={() => removeHorizonImage(h.id)}
                                    className="px-2 py-1 text-[11px] border border-red-300 text-red-700 rounded hover:bg-red-50">
                                    Удалить
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <label className="mt-1 flex items-center justify-center gap-1 px-2 py-1 text-[11px] text-gray-500 border border-dashed border-gray-300 rounded cursor-pointer hover:bg-blue-50 hover:border-blue-400 hover:text-blue-600">
                                <input type="file" accept="image/png,image/jpeg" className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) uploadHorizonImage(h.id, f);
                                    e.target.value = "";
                                  }} />
                                <Icon name="Upload" size={10} className="inline flex-shrink-0" />
                                Загрузить план
                              </label>
                            )}
                          </div>
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
                {selectedBranch ? (
                  <>
                    <PropGroup title="Тип выработки">
                      {mineTypes.length > 0 ? (
                        <select
                          value={mineTypes.some(t => t.name === selectedBranch.type) ? selectedBranch.type : ""}
                          onChange={(e) => updateBranch(selectedBranch.id, { type: e.target.value })}
                          className="w-full text-xs px-1 py-0.5 border border-gray-400 bg-white focus:border-blue-500 focus:outline-none">
                          {!mineTypes.some(t => t.name === selectedBranch.type) && (
                            <option value="" disabled>— выберите тип —</option>
                          )}
                          {mineTypes.map(t => (
                            <option key={t.id} value={t.name}>{t.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-[10px] text-amber-700 px-1 py-1 rounded"
                          style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
                          Добавьте типы выработок в{" "}
                          <button onClick={() => { setShowEquipRef(true); setEquipRefTab("types"); }}
                            className="underline text-blue-600"
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "inherit" }}>
                            Справочники → Типы выработок
                          </button>
                        </div>
                      )}
                    </PropGroup>

                    <PropGroup title="Поперечное сечение">
                      <FieldRow label="Площадь:" value={`${selectedBranch.area.toFixed(2)} м²`} />
                      <FieldRow label="Периметр:" value={`${selectedBranch.perimeter.toFixed(2)} м`} />
                    </PropGroup>

                    <PropGroup title="Длина выработки">
                      <FieldRow label="Длина:" value={`${selectedBranch.length.toFixed(1)} м`} />
                    </PropGroup>

                    <PropGroup title="Аэродинамика">
                      <FieldRow label="Коэф-т α:" value={`${selectedBranch.alphaCoef.toFixed(3)} ×10⁻⁴`} />
                      <FieldRow label="V max:" value={`${selectedBranch.vMax} м/с`} />
                    </PropGroup>

                    <PropGroup title="Вычисленные параметры">
                      <FieldRow label="Сопротив-ие:" value={`${selectedBranch.resistance.toFixed(6)} кМюрг`} computed />
                      <FieldRow label="Расход:" value={`${selectedBranch.flow.toFixed(1)} м³/с`} computed />
                      <FieldRow label="V воздуха:" value={`${selectedBranch.velocity.toFixed(2)} м/с`} computed />
                      <FieldRow label="ΔP:" value={`${selectedBranch.dP.toFixed(0)} Па`} computed />
                      <FieldRow label="Энергозат-ы:" value={`${selectedBranch.power?.toFixed(0) ?? "—"} Вт`} computed />
                    </PropGroup>
                  </>
                ) : (
                  <div className="p-4 text-xs text-gray-400 text-center">
                    Выберите ветвь на схеме
                  </div>
                )}
              </>
            )}

            {/* ═══ ОСТАЛЬНЫЕ ВКЛАДКИ ═════════════════════════════════════ */}
            {(activeSide === "thermo" || activeSide === "areas"
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
            <div className="flex items-center border border-gray-300 rounded overflow-hidden">
              <button onClick={handleSolve} disabled={vcSolving}
                className="h-6 px-2 flex items-center gap-1 text-[11px]"
                style={{ background: vcSolving ? "#6b7280" : "#16a34a", color: "white" }}
                title={`Расчёт (F9) — метод: ${calcMode === "cross" ? "Кросс" : "МКР"}`}>
                {vcSolving
                  ? <><Icon name="Loader" size={11} className="animate-spin" /> Считаю...</>
                  : <><Icon name="Play" size={11} /> Расчёт <span className="opacity-80 text-[10px]">F9</span></>}
              </button>
              <button
                onClick={() => setCalcMode(calcMode === "cross" ? "mkr" : "cross")}
                className="h-6 px-2 text-[11px] border-l border-gray-400 font-medium"
                style={{
                  background: calcMode === "mkr" ? "#1d4ed8" : "#f3f4f6",
                  color: calcMode === "mkr" ? "white" : "#374151",
                }}
                title={calcMode === "cross" ? "Метод Кросса — нажмите для переключения на МКР" : "МКР — нажмите для переключения на Кросс"}>
                {calcMode === "cross" ? "Кросс" : "МКР"}
              </button>
            </div>
            {vcError && (
              <span className="text-[10px] text-red-600 max-w-[160px] truncate" title={vcError}>
                ⚠ {vcError}
              </span>
            )}
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

            {/* ── Реверс вентилятора (только если выбрана ветвь с вентилятором) ── */}
            {selectedBranch?.hasFan && (
              <>
                <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />
                <button
                  onClick={() => updateBranch(selectedBranch.id, { fanReverse: !selectedBranch.fanReverse })}
                  className="h-6 px-2 flex items-center gap-1 rounded text-[11px] font-semibold"
                  style={{
                    background: selectedBranch.fanReverse ? "#dc2626" : "#f0fdf4",
                    color: selectedBranch.fanReverse ? "white" : "#15803d",
                    border: `1px solid ${selectedBranch.fanReverse ? "#b91c1c" : "#86efac"}`,
                  }}
                  title={selectedBranch.fanReverse
                    ? `Вент. «${selectedBranch.fanName || selectedBranch.id}» — РЕВЕРС. Нажмите для прямого направления`
                    : `Вент. «${selectedBranch.fanName || selectedBranch.id}» — прямой. Нажмите для реверса`}>
                  {selectedBranch.fanReverse
                    ? <><Icon name="ArrowLeft" size={11} /> Реверс</>
                    : <><Icon name="ArrowRight" size={11} /> Прямой</>}
                </button>
              </>
            )}

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

            {/* ── Активный горизонт (Z для новых узлов) ── */}
            <span className="text-[11px] text-gray-700"
              title="Все новые узлы будут создаваться на отметке выбранного горизонта">Горизонт:</span>
            <select value={activeHorizonId}
              onChange={(e) => {
                const id = e.target.value;
                setActiveHorizonId(id);
                const h = horizons.find((hh) => hh.id === id);
                if (h) {
                  setZLevel(h.z);
                  if (workPlane?.axis === "z") setWorkPlane({ axis: "z", value: h.z });
                }
              }}
              className="cad-input text-[11px] py-0"
              style={{
                background: activeHorizon ? activeHorizon.color + "22" : "white",
                borderColor: activeHorizon ? activeHorizon.color : "#d0d0d0",
              }}>
              <option value="">— не выбран —</option>
              {horizons.map((h) => (
                <option key={h.id} value={h.id}>{h.name} ({h.z} м)</option>
              ))}
            </select>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Масштаб 1:N ── */}
            <span className="text-[11px] text-gray-700" title="Масштаб как в АэроСеть: 1:N">М 1:</span>
            <input type="number" value={Math.round(1 / Math.max(0.0001, viewScale * 0.001))}
              onChange={(e) => {
                const n = Math.max(50, Math.min(500000, Number(e.target.value)));
                // viewScale (px/м) = 1 / (N · 0.001), считаем что 1 px ≈ 1 мм на экране
                setViewScale(1 / (n * 0.001));
              }}
              className="cad-input text-[11px] py-0 w-20 text-right"
              title="Знаменатель масштаба (например 5000 = 1:5000)" />
            <button onClick={() => setFitToScreenNonce(Date.now())}
              className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-blue-50"
              title="Подогнать под экран — показать всю сеть">
              По экрану
            </button>
            <button onClick={() => setViewScale(1)}
              className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-blue-50"
              title="Масштаб 1:1000 (1 px = 1 м)">
              1:1000
            </button>

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
              scaleOverride={viewScale}
              onScaleChange={setViewScale}
              fitToScreenNonce={fitToScreenNonce}
              restoreView={savedViewToRestore}
              onViewStateChange={setSavedViewState}
              editingHorizonImageId={editingHorizonImageId}
              onHorizonImageBoundsChange={setHorizonImageBounds}
              onNodeAdd={handleNodeAdd}
              onNodeMove={handleNodeMove}
              onBranchAdd={handleBranchAdd}
              onSplitBranchAt={handleSplitBranchAt}
              onSelectNode={(id) => { setSelectedNodeId(id); setSelectedNodeIds(new Set()); if (id) { setSelectedBranchId(null); setActiveSide("params"); } }}
              onSelectBranch={(id) => { setSelectedBranchId(id); setSelectedBranchIds(new Set()); if (id) { setSelectedNodeId(null); setFanSymbolBranchId(null); setActiveSide("general"); } }}
              onNodeContextMenu={(id, x, y) => { setSelectedNodeId(id); setSelectedBranchId(null); setCtxMenu({ kind: "node", id, x, y }); }}
              onBranchContextMenu={(id, x, y) => { setSelectedBranchId(id); setSelectedNodeId(null); setCtxMenu({ kind: "branch", id, x, y }); }}
              onCanvasContextMenu={(x, y) => setCtxMenu({ kind: "canvas", x, y })}
              selectedBranchIds={selectedBranchIds}
              onBranchMultiSelect={handleBranchMultiSelect}
              selectedNodeIds={selectedNodeIds}
              onNodeMultiSelect={handleNodeMultiSelect}
              infoConfig={infoConfig}
              unitsConfig={unitsConfig}
              zScale={zScale}
              schemaSymbols={schemaSymbols}
              selectedSymbolId={selectedSymbolId}
              onSelectSymbol={setSelectedSymbolId}
              onSymbolMove={(id, x, y) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, x, y } : s))}
              onSymbolMoveAlongBranch={(id, t) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, t } : s))}
              onSymbolOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, offsetX: ox, offsetY: oy } : s))}
              onSymbolIndOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, indOffsetX: ox, indOffsetY: oy } : s))}
              onSymbolScale={(id, delta) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, scale: Math.max(0.4, Math.min(4, (s.scale ?? 1) + delta)) } : s))}
              onSymbolDelete={(id) => {
                const sym = schemaSymbols.find(s => s.id === id);
                if (sym?.typeId === "fan" && sym.branchId) {
                  updateBranch(sym.branchId, { hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0 });
                }
                removeSymbol(id);
                setSelectedSymbolId(null);
              }}
              onSymbolClick={(symId) => {
                const sym = schemaSymbols.find(s => s.id === symId);
                if (sym?.typeId === "fan" && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(sym.branchId);
                  setActiveSide("fan");
                } else {
                  // Для не-вентиляторных символов — снять выбор ветви/узла, показать панель символа
                  setSelectedBranchId(null);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setSelectedSymbolId(symId);
                  setActiveSide("params");
                }
              }}
              onBranchLabelOffset={(id, ox, oy) => setBranches(prev => prev.map(b => b.id === id ? { ...b, labelOffsetX: ox, labelOffsetY: oy } : b))}
              activeSymbolTypeId={activeSymbolTypeId}
              pendingSymbolTypeId={pendingSymbol?.typeId ?? null}
              onPendingSymbolPlace={(branchId, t, x, y) => {
                if (!pendingSymbol) return;
                const newSym: SchemaSymbol = {
                  ...pendingSymbol,
                  branchId,
                  t,
                  x,
                  y,
                  offsetX: 0,
                  offsetY: 0,
                };
                setSchemaSymbols(prev => [...prev, newSym]);
                setSelectedSymbolId(newSym.id);
                setSelectedBranchId(null);
                setSelectedNodeId(null);
                setActiveSide("params");
                setPendingSymbol(null);
              }}
              onSymbolPlace={(typeId, x, y, branchId) => {
                if (SQUAD_TYPES.includes(typeId)) {
                  setSquadDialog({ typeId, x, y, branchId });
                  setSquadCount("5");
                } else {
                  if (typeId === "fan" && branchId) {
                    const alreadyHasFan = schemaSymbols.some(s => s.typeId === "fan" && s.branchId === branchId);
                    if (!alreadyHasFan) {
                      addSymbol(typeId, x, y, branchId);
                      updateBranch(branchId, { hasFan: true, fanMode: "curve" });
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setActiveSide("fan");
                      setFanSymbolBranchId(branchId);
                    }
                  } else if (BULKHEAD_SYMBOL_IDS.has(typeId) && branchId) {
                    // Каждый символ перемычки хранит свои параметры независимо (bk* поля)
                    const br = branches.find(b => b.id === branchId);
                    const isWindow = WINDOW_BULKHEAD_IDS.has(typeId);
                    const newSym: SchemaSymbol = {
                      id: `SYM_BK_${Date.now()}`,
                      typeId, x, y, branchId, t: 0.5,
                      bkResMode: "project",
                      bkWindowArea: isWindow ? (br?.area ?? 0) : 0,
                      bkManualR: 0,
                      bkManualAirPerm: false,
                      bkCustomAirPerm: 0,
                      bkAirPerm: br?.bulkheadAirPerm ?? 0,
                      bkBulkheadR: br?.bulkheadR ?? 0,
                      bkSurveyQ: 0,
                      bkSurveyDP: 0,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    // Ветвь помечаем hasBulkhead=true (для расчёта), но не перезаписываем параметры
                    if (br && !br.hasBulkhead) {
                      updateBranch(branchId, { hasBulkhead: true });
                    }
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(null);
                    setSelectedNodeId(null);
                    setActiveSide("params");
                  } else {
                    addSymbol(typeId, x, y, branchId);
                  }
                  setTool("select");
                  setActiveSymbolTypeId(null);
                }
              }}
            />

          </div>
        </div>

        {/* ── ПРАВАЯ ПАНЕЛЬ — «Панель информации» ─────────────── */}
        {!rightPanelOpen && (
          <button onClick={() => setRightPanelOpen(true)}
            className="flex-shrink-0 flex items-center justify-center w-6 h-full border-l"
            style={{ background: "#f5f5f5", borderColor: "#b8b8b8", color: "#374151", cursor: "pointer" }}
            title="Показать панель свойств">
            <Icon name="PanelRightOpen" size={14} />
          </button>
        )}
        {rightPanelOpen && (
          <div className="w-[280px] flex-shrink-0 flex flex-col"
            style={{ background: "#ffffff", borderLeft: "1px solid #b8b8b8" }}>
            {/* Заголовок */}
            <div className="flex items-center gap-1 px-2 h-8 border-b border-gray-300"
              style={{ background: "#f5f5f5", fontSize: 11, fontWeight: 600 }}>
              <Icon name="LayoutList" size={12} />
              <span className="flex-1">Панель информации</span>
              <button onClick={() => setRightPanelOpen(false)}
                className="h-6 px-1.5 flex items-center gap-1 rounded text-[10px]"
                style={{ background: "none", border: "1px solid #c8c8c8", color: "#374151", cursor: "pointer" }}
                title="Скрыть панель свойств">
                <Icon name="PanelRightClose" size={12} />
                Свернуть
              </button>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <InfoPanel
                  config={infoConfig}
                  onChange={updateInfoConfig}
                  nodes={nodes}
                  selectedNodeId={selectedNodeId}
                  onNodeVisibilityChange={(id, visible) => updateNode(id, { visible })}
                  onAllNodesVisibility={(visible) => setNodes((p) => p.map((n) => ({ ...n, visible })))}
                  onSelectNode={(id) => { setSelectedNodeId(id); setSelectedBranchId(null); }}
                />
              </div>

              {/* Масштаб Z */}
              <div className="border-t border-gray-300 px-2 py-2 flex-shrink-0" style={{ background: "#f5f5f5" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>Масштаб Z: ×{zScale.toFixed(1)}</span>
                  <button onClick={() => setZScale(1)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-400 hover:bg-gray-200 ml-auto">
                    Сброс
                  </button>
                </div>
                <input type="range" min="0.1" max="10" step="0.1"
                  value={zScale}
                  onChange={(e) => setZScale(parseFloat(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#2563eb" }} />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>0.1×</span><span>5×</span><span>10×</span>
                </div>
              </div>
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
            <>
              <span style={{ color: solveResult.ok ? "#16a34a" : "#dc2626" }}>
                ● Расчёт: {solveResult.ok ? "сошёлся" : "не сошёлся"} за {solveResult.iterations} итер.
              </span>
              {/* Статус реверса по нормативу ПБ */}
              {branches.some(b => b.fanReverse) && (() => {
                const revDiag = solveResult.diagnostics?.find(d => d.category === "fan" && (d.level === "error" || d.level === "warning" || d.level === "info"));
                if (!revDiag) return null;
                const colors = { error: "#dc2626", warning: "#d97706", info: "#16a34a" };
                const icons  = { error: "✕", warning: "⚠", info: "✓" };
                return (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[10px]"
                    style={{ background: revDiag.level === "error" ? "#fee2e2" : revDiag.level === "warning" ? "#fef3c7" : "#f0fdf4",
                      color: colors[revDiag.level], border: `1px solid ${revDiag.level === "error" ? "#fca5a5" : revDiag.level === "warning" ? "#fcd34d" : "#86efac"}`,
                      cursor: "pointer" }}
                    title={revDiag.message}
                    onClick={() => setShowDiagnostics(true)}>
                    {icons[revDiag.level]} Реверс
                  </span>
                );
              })()}
            </>
          ) : (
            <span style={{ color: "#9ca3af" }}>● Расчёт не выполнялся</span>
          )}
          {solveResult?.diagnostics && solveResult.diagnostics.length > 0 && (() => {
            const errs = solveResult.diagnostics.filter(d => d.level === "error").length;
            const warns = solveResult.diagnostics.filter(d => d.level === "warning").length;
            return (
              <button
                onClick={() => setShowDiagnostics(v => !v)}
                className="ml-1 px-2 py-0.5 rounded text-[11px]"
                style={{ background: errs > 0 ? "#fee2e2" : "#fef3c7",
                  color: errs > 0 ? "#b91c1c" : "#92400e",
                  border: `1px solid ${errs > 0 ? "#fca5a5" : "#fcd34d"}`,
                  cursor: "pointer" }}>
                ⚠ Диагностика: {errs} ошибок, {warns} предупр.
              </button>
            );
          })()}
          <span className="text-gray-400">|</span>
          <button
            onClick={() => setShowLogPanel(v => !v)}
            className="px-2 py-0.5 rounded text-[11px]"
            style={{
              background: showLogPanel ? "#1e293b" : "#e2e8f0",
              color: showLogPanel ? "#e2e8f0" : "#475569",
              border: "1px solid #cbd5e1",
              cursor: "pointer",
            }}
          >
            Лог{logEntries.length > 0 ? ` (${logEntries.length})` : ""}
          </button>
          <span className="text-gray-400">|</span>
          <span style={{ color: "#6b7280" }}>S+S — выделить подобное</span>
        </div>
      </div>
    </div>

    {/* ═══ ПАНЕЛЬ ЛОГА РАСЧЁТА ════════════════════════════════════════ */}
    {showLogPanel && (
      <LogPanel
        entries={logEntries}
        onClose={() => setShowLogPanel(false)}
        onClear={() => setLogEntries([])}
      />
    )}

    {/* ─── КОНТЕКСТНОЕ МЕНЮ ──────────────────────────────────────────── */}
    {ctxMenu && (
      <CadContextMenu
        x={ctxMenu.x}
        y={ctxMenu.y}
        onClose={() => setCtxMenu(null)}
        onSelect={handleCtxAction}
        items={
          ctxMenu.kind === "node" ? nodeContextItems(
            nodes.find((n) => n.id === ctxMenu.id) ?? null,
            selectedNodeIds.size
          ) :
          ctxMenu.kind === "branch" ? branchContextItems(
            branches.find((b) => b.id === ctxMenu.id) ?? null,
            !!branchParamBuffer,
            selectedBranchIds.size
          ) :
          canvasContextItems()
        }
      />
    )}

    {/* ═══ DXF ИМПОРТ ДИАЛОГ ═══════════════════════════════════════════ */}
    {showDxfImport && (
      <DxfImportDialog
        onImport={handleDxfImport}
        onClose={() => setShowDxfImport(false)}
      />
    )}

    {/* ═══ EXCEL ИМПОРТ ДИАЛОГ (Вентиляция 2.0) ══════════════════════════ */}
    {showExcelImport && (
      <ExcelImportDialog
        onImport={handleExcelImport}
        onClose={() => setShowExcelImport(false)}
      />
    )}

    {/* ═══ КОМБИНИРОВАННЫЙ ИМПОРТ DXF + EXCEL ════════════════════════════ */}
    {showCombinedImport && (
      <CombinedImportDialog
        onImport={handleCombinedImport}
        onClose={() => setShowCombinedImport(false)}
      />
    )}

    {/* ═══ CSV ИМПОРТ (АэроСеть) ══════════════════════════════════════════ */}
    {showCsvImport && (
      <CsvImportDialog
        onImport={handleCsvImport}
        onClose={() => setShowCsvImport(false)}
      />
    )}

    {/* ═══ СПРАВОЧНИК ОБОРУДОВАНИЯ ════════════════════════════════════════ */}
    {showEquipRef && (
      <EquipmentRefDialog
        activeTab={equipRefTab}
        onTabChange={setEquipRefTab}
        onClose={() => setShowEquipRef(false)}
        onMineFansChange={setMineFans}
        onMineBulkheadsChange={setMineBulkheads}
        onBranchTypesChange={setMineTypes}
        initialBranchTypes={mineTypes}
        initialMineBulkheads={mineBulkheads}
        unitsConfig={unitsConfig}
        onUnitsConfigChange={setUnitsConfig}
      />
    )}

    {/* ═══ УСЛОВНЫЕ ОБОЗНАЧЕНИЯ ═══════════════════════════════════════════ */}
    {showLegend && (
      <LegendDialog onClose={() => setShowLegend(false)} />
    )}

    {/* ═══ ПАНЕЛЬ ДИАГНОСТИКИ РАСЧЁТА ════════════════════════════════════ */}
    {showDiagnostics && solveResult?.diagnostics && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}>
        <div className="bg-white rounded shadow-lg flex flex-col"
          style={{ width: 560, maxHeight: "80vh", border: "1px solid #9ca3af" }}>
          <div className="flex items-center justify-between px-3 py-2"
            style={{ background: "#e8eef8", borderBottom: "1px solid #c8d4e8" }}>
            <span className="text-[12px] font-semibold text-gray-800">Диагностика расчёта</span>
            <button onClick={() => setShowDiagnostics(false)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#6b7280" }}>✕</button>
          </div>
          <div className="overflow-auto flex-1 px-2 py-1">
            {solveResult.diagnostics.length === 0 ? (
              <div className="text-center text-[11px] text-gray-500 py-4">Проблем не обнаружено ✓</div>
            ) : (
              solveResult.diagnostics.map((d, i) => (
                <div key={i}
                  onClick={() => {
                    if (d.objectId) {
                      const n = nodes.find(nd => nd.id === d.objectId);
                      const b = branches.find(br => br.id === d.objectId);
                      if (n) { setSelectedNodeId(n.id); setSelectedBranchId(null); }
                      else if (b) { setSelectedBranchId(b.id); setSelectedNodeId(null); }
                    }
                  }}
                  className="flex items-start gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-50"
                  style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <span style={{
                    color: d.level === "error" ? "#dc2626" : d.level === "warning" ? "#d97706" : "#2563eb",
                    fontSize: 14, lineHeight: "16px", flexShrink: 0,
                  }}>
                    {d.level === "error" ? "✕" : d.level === "warning" ? "⚠" : "ℹ"}
                  </span>
                  <div className="flex-1 text-[11px]">
                    <div style={{ color: "#1f2937" }}>{d.message}</div>
                    <div className="text-[10px] text-gray-400">
                      {d.category === "node_balance" ? "баланс узла" :
                       d.category === "branch_flow" ? "поток ветви" :
                       d.category === "fan" ? "вентилятор" :
                       d.category === "topology" ? "топология" :
                       d.category === "convergence" ? "сходимость" : d.category}
                      {d.objectId && ` · ${d.objectId.substring(0, 24)}`}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-between items-center px-3 py-2" style={{ borderTop: "1px solid #e5e7eb", background: "#f8faff" }}>
            <span className="text-[10px] text-gray-500">Клик на проблему — выделить объект на схеме</span>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  // generate_report(): текстовый отчёт по ветвям и вентиляторам
                  const lines: string[] = [];
                  lines.push("=== ОТЧЁТ ПО РАСЧЁТУ ВЕНТИЛЯЦИОННОЙ СЕТИ ===");
                  lines.push(`Дата: ${new Date().toLocaleString("ru")}`);
                  lines.push(`Итераций: ${solveResult?.iterations ?? 0}, сошлось: ${solveResult?.ok ? "да" : "нет"}`);
                  lines.push("");
                  lines.push("--- ВЕТВИ ---");
                  branches.forEach(b => {
                    if (b.isDead) return;
                    lines.push(`${b.id.padEnd(20)} Q=${Math.abs(b.flow).toFixed(2).padStart(7)} м³/с  V=${b.velocity.toFixed(1).padStart(5)} м/с  ΔP=${b.dP.toFixed(0).padStart(6)} Па${b.isLeakage ? "  [УТЕЧКА]" : ""}`);
                  });
                  lines.push("");
                  lines.push("--- ВЕНТИЛЯТОРЫ ---");
                  branches.filter(b => b.hasFan).forEach(b => {
                    const mode = b.fanStopped ? "СТОП" : b.fanReverse ? "РЕВЕРС" : "ПРЯМОЙ";
                    const eta  = (b.fanEfficiency * 100).toFixed(0);
                    const warn = b.fanReverse && b.fanEfficiency <= 0.05 ? "  ⚠ КПД<5% риск помпажа" : "";
                    lines.push(`${b.fanName || b.id}  Режим=${mode}  Q=${Math.abs(b.flow).toFixed(2)} м³/с  H=${Math.abs(b.fanPressure).toFixed(0)} Па  КПД=${eta}%  N=${(b.fanShaftPower/1000).toFixed(1)} кВт${warn}`);
                  });
                  lines.push("");
                  lines.push("--- ДИАГНОСТИКА ---");
                  (solveResult?.diagnostics ?? []).forEach(d => {
                    const icon = d.level === "error" ? "✕" : d.level === "warning" ? "⚠" : "ℹ";
                    lines.push(`${icon} ${d.message}`);
                  });
                  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
                  const url  = URL.createObjectURL(blob);
                  const a    = document.createElement("a");
                  a.href = url; a.download = "ventilation_report.txt"; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="text-[11px] px-3 py-1 rounded"
                style={{ background: "#e8eef8", border: "1px solid #c8d4e8", cursor: "pointer", color: "#1e40af" }}>
                ↓ Экспорт отчёта
              </button>
              <button onClick={() => setShowDiagnostics(false)}
                className="text-[11px] px-3 py-1 rounded"
                style={{ background: "#e5e7eb", border: "1px solid #c8c8c8", cursor: "pointer" }}>Закрыть</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ═══ ВЫДЕЛЕНИЕ ПОДОБНОГО (S+S) ══════════════════════════════════════ */}
    {showSelectSimilar && (
      <SelectSimilarDialog
        selectedBranch={selectedBranch}
        selectedSymbol={schemaSymbols.find(s => s.id === selectedSymbolId) ?? null}
        branches={branches}
        symbols={schemaSymbols}
        onConfirm={(branchIds, symbolIds) => {
          console.log("[SelectSimilar] branchIds:", branchIds.size, [...branchIds], "symbolIds:", symbolIds.size);
          if (branchIds.size > 0) {
            const first = Array.from(branchIds)[0];
            setSelectedBranchId(first);
            setSelectedBranchIds(new Set(branchIds));
            setSelectedNodeId(null);
          }
          if (symbolIds.size > 0) {
            setSelectedSymbolId(Array.from(symbolIds)[0]);
          }
          setShowSelectSimilar(false);
        }}
        onClose={() => setShowSelectSimilar(false)}
      />
    )}

    {/* ═══ ДИАЛОГ: ОБЪЕДИНИТЬ ВЕТВИ ПРИ УДАЛЕНИИ ПРОМЕЖУТОЧНОГО УЗЛА ══════ */}
    {mergeNodeDialog && (() => {
      const brA = branchesRaw.find(b => b.id === mergeNodeDialog.branchA);
      const brB = branchesRaw.find(b => b.id === mergeNodeDialog.branchB);
      const nameA = brA?.name || mergeNodeDialog.branchA.substring(0, 12);
      const nameB = brB?.name || mergeNodeDialog.branchB.substring(0, 12);
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="flex flex-col shadow-2xl border border-gray-400"
            style={{ width: 360, background: "#fff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}>
            {/* Заголовок */}
            <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
              style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
              <span className="text-[12px] font-semibold text-gray-800">Удаление узла</span>
              <button onClick={() => setMergeNodeDialog(null)}
                className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                <Icon name="X" size={12} />
              </button>
            </div>
            {/* Тело */}
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[12px] text-gray-700">
                Узел соединяет две выработки. Объединить их в одну?
              </p>
              <div className="rounded text-[11px] text-gray-600 px-3 py-2" style={{ background: "#f0f4ff", border: "1px solid #c8d4e8" }}>
                <div className="font-semibold text-gray-700 mb-1">Будут объединены:</div>
                <div>· {nameA || "Выработка 1"}</div>
                <div>· {nameB || "Выработка 2"}</div>
                <div className="mt-1 text-[10px] text-gray-500">Длина = сумма длин. Параметры берутся от первой выработки.</div>
              </div>
            </div>
            {/* Кнопки */}
            <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-200"
              style={{ background: "#f8f8f8" }}>
              <button
                onClick={() => { doDeleteNode(mergeNodeDialog.nodeId); setMergeNodeDialog(null); }}
                className="text-[11px] px-3 py-1 rounded"
                style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b", cursor: "pointer" }}>
                Удалить без объединения
              </button>
              <button
                onClick={() => {
                  mergeAdjacentBranches(mergeNodeDialog.nodeId, mergeNodeDialog.branchA, mergeNodeDialog.branchB);
                  setMergeNodeDialog(null);
                }}
                className="text-[11px] px-3 py-1 rounded font-semibold"
                style={{ background: "#1d4ed8", border: "1px solid #1d4ed8", color: "white", cursor: "pointer" }}>
                Объединить выработки
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* ═══ ДИАЛОГ: ЧИСЛО ЛЮДЕЙ В ОТДЕЛЕНИИ ════════════════════════════════ */}
    {squadDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={() => setSquadDialog(null)}>
        <div className="flex flex-col shadow-2xl border border-gray-400"
          style={{ width: 320, background: "#fff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
            style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
            <span className="text-[12px] font-semibold text-gray-800">Число людей в отделении</span>
            <button onClick={() => setSquadDialog(null)} className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
              <Icon name="X" size={12} />
            </button>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <label className="text-[11px] text-gray-600">Количество человек:</label>
            <input
              autoFocus
              type="number" min={1} max={99}
              value={squadCount}
              onChange={e => setSquadCount(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const n = parseInt(squadCount) || 5;
                  addSymbol(squadDialog.typeId, squadDialog.x, squadDialog.y, squadDialog.branchId, `${n} чел.`);
                  setTool("select"); setActiveSymbolTypeId(null); setSquadDialog(null);
                }
                if (e.key === "Escape") setSquadDialog(null);
              }}
              className="border border-gray-300 rounded px-2 py-1 text-[13px] text-center w-full outline-none focus:border-blue-500" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSquadDialog(null)}
                className="h-7 px-3 text-[11px] border border-gray-300 rounded hover:bg-gray-100">Отмена</button>
              <button onClick={() => {
                const n = parseInt(squadCount) || 5;
                addSymbol(squadDialog.typeId, squadDialog.x, squadDialog.y, squadDialog.branchId, `${n} чел.`);
                setTool("select"); setActiveSymbolTypeId(null); setSquadDialog(null);
              }}
                className="h-7 px-3 text-[11px] rounded text-white" style={{ background: "#2563eb" }}>
                Разместить
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {/* ── Диалог подтверждения закрытия ───────────────────────────────── */}
    {showCloseConfirm && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.45)" }}>
        <div className="bg-white rounded shadow-xl border border-gray-300 w-[340px]"
          style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200"
            style={{ background: "#f5f5f5", borderRadius: "8px 8px 0 0" }}>
            <Icon name="FileQuestion" size={16} className="text-yellow-600" />
            <span className="text-[13px] font-semibold text-gray-800">Несохранённые изменения</span>
          </div>
          <div className="px-4 py-4">
            <p className="text-[13px] text-gray-700 mb-1">
              Проект <strong>«{projectFileName}»</strong> содержит несохранённые изменения.
            </p>
            <p className="text-[12px] text-gray-500">Сохранить перед закрытием?</p>
          </div>
          <div className="flex gap-2 justify-end px-4 pb-4">
            <button
              onClick={() => setShowCloseConfirm(false)}
              className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
              Отмена
            </button>
            <button
              onClick={() => { setShowCloseConfirm(false); window.close(); }}
              className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-red-50 text-red-600">
              Не сохранять
            </button>
            <button
              onClick={async () => { await handleSave(); setShowCloseConfirm(false); window.close(); }}
              className="h-7 px-3 text-[12px] rounded text-white"
              style={{ background: "#2563eb" }}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    )}

    </>
  );
}

// ─── Пункты контекстного меню ───────────────────────────────────────────────

function nodeContextItems(node: TopoNode | null, multiNodeCount: number): ContextMenuItem[] {
  const canAlign = multiNodeCount >= 2;
  return [
    { id: "open_props", label: "Свойства узла...", icon: "Settings", shortcut: "Ctrl+J" },
    { id: "div1", label: "", divider: true },
    { id: "toggle_atmosphere", label: node?.atmosphereLink ? "Снять связь с атмосферой" : "Поверхностный узел (атмосфера)", icon: "Wind" },
    { id: "split_connections", label: "Разорвать связь в узле", icon: "Scissors" },
    { id: "merge_nodes", label: multiNodeCount >= 2 ? `Соединить узлы (${multiNodeCount})` : "Соединить узлы", icon: "GitMerge", disabled: multiNodeCount < 2 },
    { id: "div2", label: "", divider: true },
    { id: "align_left",     label: "Выровнить по левому краю",    icon: "AlignStartHorizontal", disabled: !canAlign },
    { id: "align_right",    label: "Выровнить по правому краю",   icon: "AlignEndHorizontal",   disabled: !canAlign },
    { id: "align_center_x", label: "Выровнить по центру (гориз.)",icon: "AlignCenterHorizontal", disabled: !canAlign },
    { id: "align_top",      label: "Выровнить по верхнему краю",  icon: "AlignStartVertical",   disabled: !canAlign },
    { id: "align_bottom",   label: "Выровнить по нижнему краю",   icon: "AlignEndVertical",     disabled: !canAlign },
    { id: "align_center_y", label: "Выровнить по центру (верт.)", icon: "AlignCenterVertical",  disabled: !canAlign },
    { id: "div3", label: "", divider: true },
    { id: "delete_node", label: "Удалить", icon: "Trash2", shortcut: "Del", danger: true },
  ];
}

function branchContextItems(branch: TopoBranch | null, hasBuffer: boolean, multiCount: number): ContextMenuItem[] {
  return [
    { id: "open_props", label: "Свойства ветви...", icon: "Settings", shortcut: "Ctrl+J" },
    { id: "div1", label: "", divider: true },
    { id: "copy_branch_params", label: "Копировать параметры ветви", icon: "Copy", shortcut: "Alt+C" },
    { id: "paste_branch_params", label: multiCount > 0
        ? `Применить к выделенным (${multiCount} ветв.)`
        : "Применить параметры...", icon: "ClipboardPaste", disabled: !hasBuffer },
    { id: "div2", label: "", divider: true },
    { id: "toggle_capital", label: branch?.capital ? "Снять Капитальная" : "Капитальная ветвь", icon: "Star" },
    { id: "toggle_designed", label: branch?.designed ? "Снять Проектируемая" : "Проектируемая ветвь", icon: "Pencil" },
    { id: "reverse_branch", label: "Развернуть ветвь", icon: "ArrowLeftRight", shortcut: "Ctrl+R" },
    { id: "div3", label: "", divider: true },
    { id: "align_distribute", label: "Выровнять и распределить ▶", icon: "AlignCenter", disabled: true },
    { id: "div4", label: "", divider: true },
    { id: "delete_branch", label: "Удалить", icon: "Trash2", shortcut: "Del", danger: true },
  ];
}

function canvasContextItems(): ContextMenuItem[] {
  return [
    { id: "add_node", label: "Добавить узел", icon: "PlusCircle" },
  ];
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

function RibbonBigBtn({ icon, label, sublabel, disabled, onClick }: {
  icon: string; label: string; sublabel: string; disabled?: boolean; onClick?: () => void;
}) {
  return (
    <button disabled={disabled} onClick={onClick}
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
    <div className="flex-1 flex items-center gap-1">
      <input type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cad-input flex-1 text-right" />
      <span className="text-[11px] text-gray-500 flex-shrink-0 w-5">{unit}</span>
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