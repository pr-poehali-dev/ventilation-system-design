import React, { useState, useMemo, useEffect, useRef } from "react";
import Icon from "@/components/ui/icon";
import { useLicenseContext } from "@/context/LicenseContext";
import LicenseDialog from "@/components/LicenseDialog";
import TopoCanvas, { type CadTool } from "@/components/cad/TopoCanvas";
import {
  type TopoNode, type TopoBranch, type Horizon,
  DEMO_NODES, DEMO_BRANCHES, OVERVIEW_HORIZON_ID, recalcAll, makeNode, makeBranch,
  project3D, unprojectToPlane,
} from "@/lib/topology";
import { SURFACE_TYPES } from "@/lib/aerodynamics";
import { solveNetwork, type SolveResult } from "@/lib/networkSolver";
import { FAN_CATALOG, getFanById, fanEfficiency, fanShaftPower } from "@/lib/fanCurves";
import FanCurveChart from "@/components/cad/FanCurveChart";
import NodePropsPanel from "@/components/cad/NodePropsPanel";
import NodeFirePanel from "@/components/cad/NodeFirePanel";
import BranchPropsPanel from "@/components/cad/BranchPropsPanel";
import type { WaterNodeResult, WaterBranchResult } from "@/lib/waterHydraulics";
import CadContextMenu, { type ContextMenuItem } from "@/components/cad/CadContextMenu";
import InfoPanel from "@/components/cad/InfoPanel";
import { type InfoDisplayConfig, DEFAULT_INFO_CONFIG } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import DxfImportDialog from "@/components/cad/DxfImportDialog";
import { type DxfImportResult } from "@/lib/dxfImport";
import PositionsPanel from "@/components/cad/PositionsPanel";
import { type Position, makePosition } from "@/lib/positions";
import ExcelImportDialog from "@/components/cad/ExcelImportDialog";
import { type ExcelImportResult } from "@/lib/excelImport";
import CombinedImportDialog from "@/components/cad/CombinedImportDialog";
import { type CombinedImportResult } from "@/lib/combinedImport";
import CsvImportDialog from "@/components/cad/CsvImportDialog";
import { type CsvImportResult } from "@/lib/csvImport";
import VentsimImportDialog from "@/components/cad/VentsimImportDialog";
import { type VentsimImportResult } from "@/lib/ventsimImport";
import EquipmentRefDialog, { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import { BULKHEAD_CATALOG, airPermToR } from "@/lib/bulkheads";
import LegendDialog from "@/components/cad/LegendDialog";
import RenumberDialog, { type RenumberOptions } from "@/components/cad/RenumberDialog";
import PrintDialog from "@/components/cad/PrintDialog";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, WINDOW_BULKHEAD_IDS, OPEN_DOOR_IDS, REDUCER_SYMBOL_IDS, FIRE_SYMBOL_IDS, EXPLOSION_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { getValveById, PRESSURE_REDUCING_VALVES } from "@/lib/pressureReducingValves";
import { calcFireMode, calcFireTemp, calcThermalDepression, COMBUSTIBLES, VEHICLE_MATERIALS, calcVehicleFire, type FireCalculationResult, type VehicleFireResult } from "@/lib/fireCalculator";
import { calcExplosion, GAS_TYPES, EXPLOSIVE_TYPES, type ExplosionResult, type ExplosionMethod, type ExplosionSourceType } from "@/lib/explosionCalculator";
import SelectSimilarDialog from "@/components/cad/SelectSimilarDialog";
import LogPanel, { type LogEntry } from "@/components/cad/LogPanel";
import RescuePanel from "@/components/cad/RescuePanel";
import WorkerPathPanel, { type WorkerPickMode } from "@/components/cad/WorkerPathPanel";
import FUNC2URL from "../../backend/func2url.json";

const AIRFLOW_URL      = (FUNC2URL as Record<string, string>)["airflow"];
const EXPLOSION_URL    = (FUNC2URL as Record<string, string>)["explosion-calculator"];
const WATER_URL        = (FUNC2URL as Record<string, string>)["water-hydraulics"];

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
  showFanArrow?: boolean; // показывать стрелку направления у вентилятора (по умолчанию true)
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
  indFontSize?: number;      // размер шрифта индикаторов (мм мировых единиц)
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
type SideTab = "params" | "measure" | "pipes" | "indicators" | "general" | "vent" | "thermo" | "areas" | "coords" | "horizons" | "topology" | "fan" | "waterpipes" | "conveyor" | "search" | "positions" | "accidents" | "blast" | "rescue" | "workerPath";

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
  const license = useLicenseContext();
  const isDemo = license.status === "demo";
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);

  // При первом запуске без лицензии показываем диалог активации
  useEffect(() => {
    if (license.status === "demo") setShowLicenseDialog(true);
  }, [license.status]);

  const [activeRibbon, setActiveRibbon] = useState<RibbonTab>("home");
  const [activeSide, setActiveSide] = useState<SideTab>("params");
  const [excavation, setExcavation] = useState<Excavation>(DEFAULT_EXC);
  const [mineFans, setMineFans] = useState<MineFanExport[]>([
    { catalogId: "VOD-18", name: "ВО-18/12АВР", diameter: 1.8, rpmMin: 600, rpmMax: 1500 },
  ]);
  const [mineBulkheads, setMineBulkheads] = useState<MineBulkheadExport[]>(() =>
    BULKHEAD_CATALOG.map(item => ({
      id: `mb_${item.id}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability),
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    }))
  );
  const [mineTypes, setMineTypes] = useState<BranchType[]>([]);

  // ─── Топология ─────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [branchesRaw, setBranches] = useState<TopoBranch[]>([]);

  // ─── История изменений (undo) ───────────────────────────────────────────
  const historyRef = useRef<Array<{ nodes: TopoNode[]; branches: TopoBranch[]; symbols: SchemaSymbol[] }>>([]);
  const nodesRef   = useRef(nodes);
  const branchesRef = useRef(branchesRaw);
  const symbolsRef  = useRef<SchemaSymbol[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { branchesRef.current = branchesRaw; }, [branchesRaw]);

  const pushHistory = () => {
    historyRef.current = [...historyRef.current.slice(-49),
      { nodes: nodesRef.current, branches: branchesRef.current, symbols: symbolsRef.current }];
  };
  const handleUndo = () => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    setNodes(snap.nodes);
    setBranches(snap.branches);
    setSchemaSymbols(snap.symbols);
  };
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [tool, setTool] = useState<CadTool>("select");
  const [zLevel, setZLevel] = useState(0);

  // Авто-пересчёт длин и аэродинамики по координатам/параметрам
  const branches = useMemo(() => recalcAll(nodes, branchesRaw), [nodes, branchesRaw]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  // Гидравлический расчёт водопроводной сети ППЗ (backend)
  const [waterNetwork, setWaterNetwork] = useState<{ nodeResults: Map<string, WaterNodeResult>; branchResults: Map<string, WaterBranchResult> }>({ nodeResults: new Map(), branchResults: new Map() });
  useEffect(() => {
    const hasWater = branches.some(b => b.hasWaterPipe);
    if (!hasWater) { setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() }); return; }
    fetch(WATER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes, branches }),
    }).then(r => r.json()).then(data => {
      const nr = new Map<string, WaterNodeResult>();
      const br = new Map<string, WaterBranchResult>();
      (data.nodeResults ?? []).forEach((n: WaterNodeResult) => nr.set(n.nodeId, n));
      (data.branchResults ?? []).forEach((b: WaterBranchResult) => br.set(b.branchId, b));
      setWaterNetwork({ nodeResults: nr, branchResults: br });
    }).catch(() => {});
  }, [nodes, branches]);

  // Запоминаем последнюю вкладку отдельно для узлов и ветвей
  const lastNodeTab = useRef<SideTab>("params");
  const lastBranchTab = useRef<SideTab>("general");

  // Переключаем вкладку при смене выбранного узла/ветви — восстанавливаем последнюю
  useEffect(() => {
    if (selectedNodeId) {
      setActiveSide(lastNodeTab.current);
    } else if (selectedBranchId) {
      setActiveSide(lastBranchTab.current);
    } else {
      setActiveSide("general");
    }
  }, [selectedNodeId, selectedBranchId]);

  // Запоминаем вкладку при каждом изменении activeSide
  useEffect(() => {
    if (selectedNodeId) {
      lastNodeTab.current = activeSide;
    } else if (selectedBranchId) {
      lastBranchTab.current = activeSide;
    }
  }, [activeSide]);

  // Если активна вкладка "fan", но у ветви нет вентилятора — сбросить на "topology"
  useEffect(() => {
    if (activeSide === "fan" && selectedBranch && !selectedBranch.hasFan) {
      setActiveSide("topology");
    }
  }, [selectedBranchId, selectedBranch?.hasFan]);

  // Синхронизация расчётной мощности техники → fireHeatRelease и температуры → fireTemperature
  useEffect(() => {
    const b = selectedBranch;
    if (!b?.hasFire || (b.fireCombustible ?? "vehicle") !== "vehicle") return;
    const masses: [number, number, number] = [b.fireVehicleMassRubber ?? 1200, b.fireVehicleMassDiesel ?? 400, b.fireVehicleMassOil ?? 200];
    const airQ = Math.abs(b.flow ?? 0);
    const vfr = calcVehicleFire(masses, airQ);
    if (vfr.power_MW <= 0) return;
    const roundedPower = Math.round(vfr.power_MW * 100) / 100;
    if (Math.abs((b.fireHeatRelease ?? 5) - roundedPower) > 0.01) {
      updateBranch(b.id, { fireHeatRelease: roundedPower });
    }
    if ((b.fireMode ?? "heat") === "temp" && airQ > 0) {
      const calcTemp = Math.round(vfr.deltaT_C + 20);
      if (Math.abs((b.fireTemperature ?? 300) - calcTemp) > 1) {
        updateBranch(b.id, { fireTemperature: calcTemp });
      }
    }
  }, [
    selectedBranchId,
    selectedBranch?.fireCombustible,
    selectedBranch?.fireVehicleMassRubber,
    selectedBranch?.fireVehicleMassDiesel,
    selectedBranch?.fireVehicleMassOil,
    selectedBranch?.fireMode,
    selectedBranch?.flow,
  ]);

  const updateNode = (id: string, patch: Partial<TopoNode>, saveHistory = true) => {
    if (saveHistory) pushHistory();
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  };

  // Ref для вызова расчёта из updateBranch (handleSolveLocal объявлен позже)
  const handleSolveRef = useRef<(() => void) | null>(null);

  const updateBranch = (id: string, patch: Partial<TopoBranch>, saveHistory = true) => {
    if (saveHistory) pushHistory();
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
      // При переключении реверса — всегда перезапускаем расчёт сети,
      // чтобы стрелки на схеме корректно отобразили новое направление потока.
      setTimeout(() => handleSolveRef.current?.(), 100);
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
    const DEFAULT_OVERVIEW: Horizon = {
      id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "#6b7280", visible: true,
      printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
        orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
        period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
        showLegend: false, showStamp: false, showApprover: false,
        paperFormat: "A1", orientation: "landscape" },
    } as Horizon;

    if (typeof window === "undefined") return [DEFAULT_OVERVIEW];

    // Версия схемы данных — при смене сбрасываем горизонты к дефолту
    const DATA_VERSION = "v5";
    const storedVersion = localStorage.getItem("vent-cad/data-version");
    if (storedVersion !== DATA_VERSION) {
      // Новая версия — очищаем старые горизонты, устанавливаем только Общий вид
      localStorage.setItem("vent-cad/data-version", DATA_VERSION);
      localStorage.removeItem("vent-cad/horizons-v4");
      return [DEFAULT_OVERVIEW];
    }

    try {
      const raw = localStorage.getItem("vent-cad/horizons-v4");
      if (!raw) return [DEFAULT_OVERVIEW];
      const parsed = JSON.parse(raw) as Horizon[];
      if (!Array.isArray(parsed) || !parsed.length) return [DEFAULT_OVERVIEW];
      // Нормализуем: сбрасываем галочки, фиксируем title Общего вида
      return parsed.map(h => {
        if (!h.printLayer) return h;
        const pl = {
          ...h.printLayer,
          showLegend: false,
          showStamp: false,
          showApprover: false,
          ...(h.id === OVERVIEW_HORIZON_ID ? { title: "Общий вид вентиляционной схемы" } : {}),
        };
        return { ...h, printLayer: pl };
      });
    } catch { /* игнорируем повреждённые данные */ }
    return [DEFAULT_OVERVIEW];
  });
  // Сохраняем горизонты при каждом изменении.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("vent-cad/horizons-v4", JSON.stringify(horizons)); }
    catch { /* квота переполнена — пропускаем */ }
  }, [horizons]);
  const [activeHorizonId, setActiveHorizonId] = useState<string>("");
  // ID горизонта, у которого пользователь редактирует подложку (тащит углы).
  const [editingHorizonImageId, setEditingHorizonImageId] = useState<string | null>(null);
  // ID горизонта, у которого пользователь редактирует bounds слоя печати (тащит рамку).
  const [editingPrintLayerId, setEditingPrintLayerId] = useState<string | null>(null);
  const activeHorizon = horizons.find((h) => h.id === activeHorizonId) ?? null;
  const updateHorizon = (id: string, patch: Partial<Horizon>) =>
    setHorizons((p) => p.map((h) => h.id === id ? { ...h, ...patch } : h));
  const addHorizon = () => {
    const id = `H_${Date.now()}`;
    setHorizons((p) => [...p, { id, name: `Горизонт ${p.length + 1}`, z: 0, color: "#64748b", visible: true }]);
  };
  const removeHorizon = (id: string) => {
    if (id === OVERVIEW_HORIZON_ID) return; // "Общий вид" нельзя удалить
    setHorizons((p) => p.filter((h) => h.id !== id));
    setBranches((p) => p.map((b) => b.horizonId === id ? { ...b, horizonId: "" } : b));
    if (activeHorizonId === id) setActiveHorizonId("");
    if (editingHorizonImageId === id) setEditingHorizonImageId(null);
  };

  // Drag-and-drop для изменения порядка горизонтов
  const [horizonDragIdx, setHorizonDragIdx] = useState<number | null>(null);
  const [horizonDragOverIdx, setHorizonDragOverIdx] = useState<number | null>(null);
  const handleHorizonDragStart = (idx: number) => setHorizonDragIdx(idx);
  const handleHorizonDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setHorizonDragOverIdx(idx); };
  const handleHorizonDrop = (idx: number) => {
    if (horizonDragIdx === null || horizonDragIdx === idx) { setHorizonDragIdx(null); setHorizonDragOverIdx(null); return; }
    setHorizons(prev => {
      const next = [...prev];
      const [moved] = next.splice(horizonDragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setHorizonDragIdx(null); setHorizonDragOverIdx(null);
  };

  // Bounds "Общего вида" теперь вычисляются динамически в TopoCanvas
  // из проекций всех узлов — это корректно при любой проекции (план/фронт/профиль/ИЗО).

  const setHorizonImageBounds = (
    id: string, bounds: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    setHorizons((p) => p.map((h) => {
      if (h.id !== id || !h.image) return h;
      return { ...h, image: { ...h.image, bounds } };
    }));
  };

  const setPrintLayerBounds = (
    id: string, bounds: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    setHorizons((p) => p.map((h) => {
      if (h.id !== id || !h.printLayer) return h;
      return { ...h, printLayer: { ...h.printLayer, bounds } };
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

  // Перенумеровать узлы и/или ветви с расширенными настройками.
  const renumberAll = (opts: RenumberOptions | "asc" | "desc" = "asc") => {
    // Обратная совместимость со старым вызовом (строка)
    const options: RenumberOptions = (typeof opts === "string") ? {
      area: "all", horizonId: "", mode: "restart", objects: "both",
      startFrom: 1, direction: opts,
    } : opts;

    const { area, horizonId, mode, objects, startFrom, direction } = options;

    // Фильтрация по горизонту
    const targetNodes = area === "horizon"
      ? nodes.filter((n) => {
          const nb = branchesRaw.filter((b) => b.fromId === n.id || b.toId === n.id);
          return nb.some((b) => b.horizonId === horizonId);
        })
      : nodes;

    const targetBranches = area === "horizon"
      ? branchesRaw.filter((b) => b.horizonId === horizonId)
      : branchesRaw;

    // Определяем стартовый номер
    const getStart = (existingIds: string[]) => {
      if (mode === "continue") {
        const max = existingIds.reduce((m, id) => {
          const n = parseInt(id);
          return isNaN(n) ? m : Math.max(m, n);
        }, 0);
        return max + 1;
      }
      return startFrom;
    };

    const nodeStart = getStart(nodes.map((n) => n.id));
    const branchStart = getStart(branchesRaw.map((b) => b.id));

    const nodeMap = new Map<string, string>();
    if (objects === "nodes" || objects === "both") {
      const order = direction === "asc" ? targetNodes : [...targetNodes].reverse();
      order.forEach((n, i) => nodeMap.set(n.id, String(nodeStart + i)));
    }

    const branchMap = new Map<string, string>();
    if (objects === "branches" || objects === "both") {
      const order = direction === "asc" ? targetBranches : [...targetBranches].reverse();
      order.forEach((b, i) => branchMap.set(b.id, String(branchStart + i)));
    }

    if (nodeMap.size > 0) {
      setNodes((prev) => prev.map((n) => {
        const newId = nodeMap.get(n.id) ?? n.id;
        const oldId = n.id;
        // Сбрасываем name если: нет имени, начинается с "Узел ", или совпадает со старым id (технический id из импорта)
        const isAutoName = !n.name || n.name.startsWith("Узел ") || n.name === oldId;
        return { ...n, id: newId, number: newId, name: isAutoName ? `Узел ${newId}` : n.name };
      }));
    }

    if (branchMap.size > 0) {
      setBranches((prev) => prev.map((b) => ({
        ...b,
        id: branchMap.get(b.id) ?? b.id,
        fromId: nodeMap.get(b.fromId) ?? b.fromId,
        toId: nodeMap.get(b.toId) ?? b.toId,
      })));
      setSchemaSymbols((prev) => prev.map((s) => ({
        ...s,
        branchId: s.branchId ? (branchMap.get(s.branchId) ?? s.branchId) : s.branchId,
      })));
    } else if (nodeMap.size > 0) {
      // Обновляем fromId/toId ветвей если переименовали только узлы
      setBranches((prev) => prev.map((b) => ({
        ...b,
        fromId: nodeMap.get(b.fromId) ?? b.fromId,
        toId: nodeMap.get(b.toId) ?? b.toId,
      })));
    }

    // Сбросим выделение, чтобы не ссылаться на старые id.
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setIsDirty(true);
  };

  // Создаёт узел в указанной мировой точке. Если активен горизонт —
  // навязывает его Z и horizonId. Возвращает ID созданного узла.
  const handleNodeAdd = (x: number, y: number, z: number): string => {
    if (isDemo && nodes.length >= 20) {
      setShowLicenseDialog(true);
      return "";
    }
    pushHistory();
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
    pushHistory();
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
    pushHistory();
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

  // ─── Результат расчёта пожара ───────────────────────────────────────
  const [fireResult, setFireResult] = useState<FireCalculationResult | null>(null);
  const [fireCalcDone, setFireCalcDone] = useState(false);
  // ─── Горноспасатели ────────────────────────────────────────────────
  const [rescuePickMode, setRescuePickMode] = useState<import("@/components/cad/RescuePanel").RescuePickMode>(null);
  const [rescueStartNodeId, setRescueStartNodeId] = useState("");
  const [rescueTargetNodeId, setRescueTargetNodeId] = useState("");
  const rescuePickHandlerRef = React.useRef<((nodeId: string) => void) | null>(null);
  const [rescuePathBranchIds, setRescuePathBranchIds] = useState<Set<string>>(new Set());
  const [rescuePathBranchDirs, setRescuePathBranchDirs] = useState<Map<string, boolean>>(new Map());
  const [rescuePathNodeIds, setRescuePathNodeIds] = useState<Set<string>>(new Set());
  // ─── Горнорабочий ──────────────────────────────────────────────────
  const [workerPickMode, setWorkerPickMode] = useState<WorkerPickMode>(null);
  const [workerStartNodeId, setWorkerStartNodeId] = useState("");
  const [workerTargetNodeId, setWorkerTargetNodeId] = useState("");
  const workerPickHandlerRef = React.useRef<((nodeId: string) => void) | null>(null);
  const [workerPathBranchIds, setWorkerPathBranchIds] = useState<Set<string>>(new Set());
  const [workerPathBranchDirs, setWorkerPathBranchDirs] = useState<Map<string, boolean>>(new Map());
  const [workerPathNodeIds, setWorkerPathNodeIds] = useState<Set<string>>(new Set());
  // ─── Результат расчёта взрыва ──────────────────────────────────────
  const [explosionResult, setExplosionResult] = useState<ExplosionResult | null>(null);
  const [explosionCalcDone, setExplosionCalcDone] = useState(false);
  const [showExplosionZones, setShowExplosionZones] = useState(false);
  // Текущее расстояние фронта волны на шкале (метры)
  const [blastWaveRadius, setBlastWaveRadius] = useState(0);
  // Максимум шкалы (м) — радиус безопасной зоны
  const [blastMaxRadius, setBlastMaxRadius] = useState(500);
  const [blastRadiusStep, setBlastRadiusStep] = useState(10);
  // Анимация распространения волны
  const [blastAnimating, setBlastAnimating] = useState(false);
  const blastAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showSmoke, setShowSmoke] = useState(false);
  // Текущий момент времени на шкале задымления (минуты)
  const [smokeTimeMinutes, setSmokeTimeMinutes] = useState(0);
  // Максимум шкалы (мин) и шаг — задаётся пользователем
  const [smokeMaxTime, setSmokeMaxTime] = useState(60);
  const [smokeTimeStep, setSmokeTimeStep] = useState(1);
  // Анимация воспроизведения шкалы
  const [smokeAnimating, setSmokeAnimating] = useState(false);
  const smokeAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  // Режим цветовой заливки ветвей: none = выкл, flowQ = по расходу воздуха, horizon = по цвету горизонта
  const [colorMode, setColorMode] = useState<"none" | "flowQ" | "horizon">("none");
  // Настройки шкалы расхода (мин/макс, цвет)
  const [flowColorMin, setFlowColorMin] = useState(0);
  const [flowColorMax, setFlowColorMax] = useState(75);
  const [flowColorHue, setFlowColorHue] = useState<"red" | "blue" | "green">("red");

  // Активная рабочая плоскость для построения в 3D
  // null = автоматически по ракурсу; иначе фиксированная пользователем
  const [workPlane, setWorkPlane] = useState<{ axis: "x" | "y" | "z"; value: number } | null>(null);

  // ─── МАСШТАБ И ВПИСЫВАНИЕ ───────────────────────────────────────────
  const [viewScale, setViewScale] = useState<number>(0.4);
  const [fitToScreenNonce, setFitToScreenNonce] = useState<number>(0);
  // Пределы масштабов (как в АэроСеть)
  const [scaleSettingsOpen, setScaleSettingsOpen] = useState(false);
  const [scaleLimitsEnabled, setScaleLimitsEnabled] = useState(false);
  const [scaleTextMin, setScaleTextMin] = useState(80);
  const [scaleTextMax, setScaleTextMax] = useState(150);
  const [scaleBranchMin, setScaleBranchMin] = useState(80);
  const [scaleBranchMax, setScaleBranchMax] = useState(150);
  const [scaleSymbolMin, setScaleSymbolMin] = useState(80);
  const [scaleSymbolMax, setScaleSymbolMax] = useState(220);
  const [scaleBranchMode, setScaleBranchMode] = useState<"relative" | "fixed">("relative");
  const [scaleSingleLineAt, setScaleSingleLineAt] = useState(10);
  // Сигнал «центрировать камеру на узле/ветви»
  const [focusNonce, setFocusNonce] = useState<number>(0);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusBranchId, setFocusBranchId] = useState<string | null>(null);
  // Флаг: файл был загружен — не сбрасываем вид начальным пресетом
  const initialFileLoadedRef = useRef(false);
  // При первом рендере — дефолтный вид только если файл не открывался
  useEffect(() => {
    // 600ms — достаточно для любой асинхронной загрузки файла при старте
    const t = window.setTimeout(() => {
      if (!initialFileLoadedRef.current) {
        setViewPreset({ name: "isoSW", nonce: Date.now() });
        setTimeout(() => setFitToScreenNonce(Date.now()), 200);
      }
    }, 600);
    return () => window.clearTimeout(t);
   
  }, []);

  // Восстановление сохранённого вида (azimuth + scale + offset) при открытии файла
  type SavedView = { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number };
  const [savedViewToRestore, setSavedViewToRestore] = useState<SavedView | null>(null);
  // ─── Позиции ────────────────────────────────────────────────────────────
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [positionPlaceMode, setPositionPlaceMode] = useState(false);
  // Drag маркера позиции
  const posDragRef = useRef<{ id: string; startSx: number; startSy: number; startWx: number; startWy: number } | null>(null);
  const [draggingPosId, setDraggingPosId] = useState<string | null>(null);
  // Drag конца выноски позиции
  const leaderDragRef = useRef<{ posId: string } | null>(null);
  const [draggingLeaderPosId, setDraggingLeaderPosId] = useState<string | null>(null);
  // Режим рисования выноски: клик на схему = установить конец выноски
  const [leaderDrawMode, setLeaderDrawMode] = useState<string | null>(null); // posId или null
  // Snap к ветви в режиме рисования выноски
  const [leaderSnapBranch, setLeaderSnapBranch] = useState<{ branchId: string; t: number; sx: number; sy: number } | null>(null);
  // Курсор мыши в экранных координатах для предпросмотра выноски
  const [leaderCursorScreen, setLeaderCursorScreen] = useState<{ sx: number; sy: number } | null>(null);
  // Режим привязки ветвей к позиции (F3)
  const [posBranchBindMode, setPosBranchBindMode] = useState(false);
  // Показывать выноски позиций (И/B)
  const [showPosLeaders, setShowPosLeaders] = useState(false);
  // ПЛА: видимость позиций на схеме
  const [showPositions, setShowPositions] = useState(true);
  // ПЛА: окраска ветвей цветом позиции (внутри/снаружи)
  const [posColorInner, setPosColorInner] = useState(false);
  const [posColorOuter, setPosColorOuter] = useState(false);
  // Dropdown ПЛА открыт/закрыт
  const [showPlaPanel, setShowPlaPanel] = useState(false);

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
    // Обновляем ветви из справочника и сразу синхронизируем символы
    setBranches(prev => {
      const updated = prev.map(br => {
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
      });
      // Синхронизируем символы сразу по актуальным (updated) ветвям
      setSchemaSymbols(prev2 => prev2.map(s => {
        if (!BULKHEAD_SYMBOL_IDS.has(s.typeId) || s.bkManualAirPerm) return s;
        // Приоритет 1: собственный bkBulkheadId символа
        if (s.bkBulkheadId) {
          const ref = mineBulkheads.find(b => b.id === s.bkBulkheadId);
          if (ref) return { ...s, bkAirPerm: ref.airPermeability ?? 0, bkBulkheadR: ref.rMkyurg ?? 0, bkFailurePressure: ref.failurePressure ?? 0 };
        }
        // Приоритет 2: bulkheadId ветви
        if (!s.branchId) return s;
        const br = updated.find(b => b.id === s.branchId);
        if (!br || !br.bulkheadId) return s;
        const ref = mineBulkheads.find(b => b.id === br.bulkheadId);
        if (!ref) return s;
        return { ...s, bkAirPerm: ref.airPermeability ?? 0, bkBulkheadR: ref.rMkyurg ?? 0, bkFailurePressure: ref.failurePressure ?? 0 };
      }));
      return updated;
    });
  }, [mineBulkheads]);

  // Синхронизация bkAirPerm/bkFailurePressure в символах при изменении данных ветвей
  useEffect(() => {
    setSchemaSymbols(prev => prev.map(s => {
      if (!BULKHEAD_SYMBOL_IDS.has(s.typeId) || !s.branchId || s.bkManualAirPerm) return s;
      const br = branches.find(b => b.id === s.branchId);
      if (!br || !br.bulkheadId) return s;
      if (s.bkAirPerm === br.bulkheadAirPerm && s.bkBulkheadR === br.bulkheadR && s.bkFailurePressure === br.bulkheadFailurePressure) return s;
      return { ...s, bkAirPerm: br.bulkheadAirPerm ?? 0, bkBulkheadR: br.bulkheadR ?? 0, bkFailurePressure: br.bulkheadFailurePressure ?? 0 };
    }));
  }, [branches]);

  // ─── ОБЩИЕ НАСТРОЙКИ ОТОБРАЖЕНИЯ ВЕТВЕЙ ─────────────────────────────
  const [branchWidth, setBranchWidth] = useState<number>(7);    // px
  const [branchBorder, setBranchBorder] = useState<number>(0.6); // px
  const [thinLines, setThinLines] = useState<boolean>(false);    // F6: всё в 1px
  const [colorByHorizon, setColorByHorizon] = useState<boolean>(false);
  const [showFlowArrows, setShowFlowArrows] = useState<boolean>(false); // включается F9

  // ─── ПАНЕЛЬ ИНФОРМАЦИИ + Z-МАСШТАБ ─────────────────────────────────
  const [infoConfig, setInfoConfig] = useState<InfoDisplayConfig>(DEFAULT_INFO_CONFIG);
  const updateInfoConfig = (patch: Partial<InfoDisplayConfig>) =>
    setInfoConfig((prev) => ({ ...prev, ...patch }));
  const [zScale, setZScale] = useState<number>(1);
  const [xyScale, setXyScale] = useState<number>(1);

  // ─── ЕДИНИЦЫ ИЗМЕРЕНИЯ ───────────────────────────────────────────
  const [unitsConfig, setUnitsConfig] = useState<UnitsConfig>(DEFAULT_UNITS_CONFIG);

  // ─── УСЛОВНЫЕ ОБОЗНАЧЕНИЯ НА СХЕМЕ ─────────────────────────────────
  // Каждый символ: тип (из справочника), мировые координаты, привязка к ветви
  const [schemaSymbols, setSchemaSymbols] = useState<SchemaSymbol[]>([]);
  useEffect(() => { symbolsRef.current = schemaSymbols; }, [schemaSymbols]);
  const [symbolClipboard, setSymbolClipboard] = useState<SchemaSymbol | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [selectedSymbolIds, setSelectedSymbolIds] = useState<Set<string>>(new Set());
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
  // ─── ЛЕВАЯ ВЫДВИЖНАЯ ПАНЕЛЬ (свойства/параметры) ────────────────────
  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(true);
  // ─── ДИАЛОГ ПЕЧАТИ ──────────────────────────────────────────────────
  const [showPrintDialog, setShowPrintDialog] = useState<boolean>(false);
  const [printPreviewUrl, setPrintPreviewUrl] = useState<string>("");
  const [printDialogOpenExport, setPrintDialogOpenExport] = useState<boolean>(false);
  const getSvgRef = useRef<(() => string) | null>(null);
  const liveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });
  const liveSvgRef = useRef<SVGSVGElement | null>(null);

  // Захватывает схему и открывает диалог печати
  const openPrintDialog = () => {
    if (isDemo) { setShowLicenseDialog(true); return; }
    // 1) Canvas-режим: читаем живой DOM-canvas напрямую
    const canvas = liveCanvasRef.current;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try {
        const url = canvas.toDataURL("image/png");
        if (url && url.length > 500) {
          setPrintPreviewUrl(url);
          setShowPrintDialog(true);
          return;
        }
      } catch { /* tainted */ }
    }

    // 2) SVG-режим: XMLSerializer + viewBox из savedViewState
    const svgEl = liveSvgRef.current;
    if (svgEl) {
      const w = svgEl.clientWidth || 1600;
      const h = svgEl.clientHeight || 900;
      const vs = savedViewState;
      let vx = 0, vy = 0, vw = w, vh = h;
      if (vs && vs.scale > 0) {
        vx = -vs.offsetX / vs.scale;
        vy = -vs.offsetY / vs.scale;
        vw = w / vs.scale;
        vh = h / vs.scale;
      }

      const serializer = new XMLSerializer();
      let s = serializer.serializeToString(svgEl);

      // Скрываем <image> — они ссылаются на blob URL которые недоступны вне живого DOM
      s = s.replace(/<image\b([^>]*)>/gi, (_m: string, attrs: string) => {
        const cleaned = attrs
          .replace(/\s+xlink:href="[^"]*"/g, "")
          .replace(/\s+href="[^"]*"/g, "");
        return `<image${cleaned}>`;
      });

      // Фиксируем <svg>: правильный viewBox
      s = s.replace(/(<svg\b[^>]*?)(\s+width="[^"]*")?(\s+height="[^"]*")?(\s+style="[^"]*")?(\s+viewBox="[^"]*")?([^>]*>)/i,
        (_m: string, pre: string, _w: string, _h: string, _st: string, _vb: string, post: string) => {
          let a = pre;
          if (!a.includes("xmlns=")) a += ' xmlns="http://www.w3.org/2000/svg"';
          return `${a} width="${w}" height="${h}" viewBox="${vx} ${vy} ${vw} ${vh}" style="background:white"${post}`;
        });

      const dataUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
      setPrintPreviewUrl(dataUri);
      setShowPrintDialog(true);
      return;
    }

    // 3) Fallback: getSvgRef → строка outerHTML
    const raw = getSvgRef.current?.() ?? "";
    if (raw.startsWith("data:")) { setPrintPreviewUrl(raw); setShowPrintDialog(true); return; }

    if (raw.includes("<svg")) {
      const wm = raw.match(/\bwidth="(\d+(?:\.\d+)?)"/);
      const hm = raw.match(/\bheight="(\d+(?:\.\d+)?)"/);
      const sw = wm ? parseFloat(wm[1]) : 1600;
      const sh = hm ? parseFloat(hm[1]) : 900;
      const vs = savedViewState;
      let vx2 = 0, vy2 = 0, vw2 = sw, vh2 = sh;
      if (vs && vs.scale > 0) {
        vx2 = -vs.offsetX / vs.scale; vy2 = -vs.offsetY / vs.scale;
        vw2 = sw / vs.scale; vh2 = sh / vs.scale;
      }
      const clean = raw
        .replace(/<image\b[^>]*\/?>/gi, "")
        .replace(/\s+xlink:href="blob:[^"]*"/g, "")
        .replace(/\s+href="blob:[^"]*"/g, "")
        .replace(/<svg([^>]*)>/i, (_m: string, a: string) => {
          let attrs = a.replace(/\s+width="[^"]*"/g, "").replace(/\s+height="[^"]*"/g, "")
            .replace(/\s+style="[^"]*"/g, "").replace(/\s+viewBox="[^"]*"/g, "");
          if (!attrs.includes("xmlns=")) attrs += ' xmlns="http://www.w3.org/2000/svg"';
          return `<svg${attrs} width="${sw}" height="${sh}" viewBox="${vx2} ${vy2} ${vw2} ${vh2}" style="background:white">`;
        });
      setPrintPreviewUrl("data:image/svg+xml;charset=utf-8," + encodeURIComponent(clean));
      setShowPrintDialog(true);
      return;
    }

    setPrintPreviewUrl("");
    setShowPrintDialog(true);
  };
  // ─── ПОИСК ПО СХЕМЕ ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<"all" | "nodes" | "branches">("all");
  // ─── ДИАЛОГ «АВТОНУМЕРАЦИЯ» ─────────────────────────────────────────
  const [showRenumberMenu, setShowRenumberMenu] = useState<boolean>(false);
  const [showRenumberDialog, setShowRenumberDialog] = useState<boolean>(false);
  const renumberMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showRenumberMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (renumberMenuRef.current && !renumberMenuRef.current.contains(e.target as Node)) {
        setShowRenumberMenu(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showRenumberMenu]);

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
  const [showVentsimImport, setShowVentsimImport] = useState(false);

  const handleVentsimImport = (result: VentsimImportResult, mode: "replace" | "append") => {
    if (mode === "replace") {
      setNodes(result.nodes);
      setBranches(result.branches);
      setSchemaSymbols(ensureFanSymbols(result.branches, []));
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => [...prev, ...result.branches]);
      setSchemaSymbols(prev => [...prev, ...ensureFanSymbols(result.branches, prev)]);
    }
    setImportNonce(n => n + 1);
    setShowVentsimImport(false);
    setActiveRibbon("home");
  };

  const handleCsvImport = (result: CsvImportResult, mode: "replace" | "append") => {
    // ── Применяем вентиляторы к ветвям ──
    const applyFans = (branches: typeof result.branches) => {
      if (!result.fans || result.fans.length === 0) return branches;
      return branches.map(b => {
        const fan = result.fans.find(f => f.branchId === b.id);
        if (!fan) return b;
        return { ...b, hasFan: true, fanMode: "constant" as const, fanName: fan.name, fanPressure: fan.pressure };
      });
    };

    // ── Применяем перемычки к ветвям (hasBulkhead + bulkheadR) ──
    const applyBulkheads = (branches: typeof result.branches) => {
      if (!result.bulkheads || result.bulkheads.length === 0) return branches;
      return branches.map(b => {
        const bk = result.bulkheads.find(bk => bk.branchId === b.id);
        if (!bk) return b;
        return {
          ...b,
          hasBulkhead: true,
          bulkheadName: bk.typeName,
          bulkheadR: bk.rKmu * 1000,       // кМюрг → Мюрг (базовая единица)
          bulkheadManualR: bk.rKmu,
          bulkheadResMode: "manual" as const,
          bulkheadAirPerm: bk.airPerm,
        };
      });
    };

    // ── Определяем typeId перемычки по названию из CSV ──
    const guessBulkheadTypeId = (typeName: string): string => {
      const t = typeName.toLowerCase().trim();
      // Определяем конструкцию
      const isDoor     = /двер|door/.test(t);
      const isAuto     = /авто|auto/.test(t);
      const isOpen     = /откр|open/.test(t);
      const isWindow   = /окн|window|win/.test(t);
      const isLattice  = /решёт|решет|lattic|lat/.test(t);
      const isProem    = /проём|проем|proem/.test(t);
      const isBarrier  = /барьер|barrier/.test(t);
      const isFireDoor = /противопож|пожар|fire/.test(t);
      // Определяем материал
      const isConcrete = /бетон|concrete|conc/.test(t);
      const isWood     = /дерев|деревян|wood/.test(t);
      const isBrick    = /кирпич|brick/.test(t);
      const isMetal    = /металл|metal/.test(t);
      const mat = isConcrete ? "conc" : isWood ? "wood" : isBrick ? "brick" : isMetal ? "metal" : "base";
      if (isFireDoor) return "fire_door_pp";
      if (isBarrier)  return "barrier";
      if (isAuto)     return `auto_${mat}`;
      if (isOpen)     return `open_${mat}`;
      if (isWindow)   return `win_${mat}`;
      if (isLattice)  return `lat_${mat}`;
      if (isProem)    return `proem_${mat}`;
      if (isDoor)     return `door_${mat}`;
      return `bk_${mat}`;
    };

    // ── Создаём SchemaSymbol для перемычек ──
    const makeBulkheadSymbols = (branches: typeof result.branches, existing: typeof schemaSymbols) => {
      const syms: typeof schemaSymbols = [];
      let notFound = 0;
      for (const bk of result.bulkheads ?? []) {
        const br = branches.find(b => b.id === bk.branchId);
        if (!br) { notFound++; continue; }
        if (existing.some(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === bk.branchId)) continue;
        const typeId = guessBulkheadTypeId(bk.typeName);
        syms.push({
          id: `SYM_BK_${Date.now()}_${bk.branchId}`,
          typeId,
          x: 0, y: 0,
          branchId: bk.branchId,
          t: 0.5,
          bkResMode: "manual" as const,
          bkManualR: bk.rKmu,
          bkAirPerm: bk.airPerm,
          bkBulkheadR: bk.rKmu * 1000,
          bkBulkheadName: bk.typeName,
        });
      }
      if (notFound > 0) console.warn(`[BulkheadImport] ${notFound} перемычек не нашли ветвь. Пример bk.branchId="${result.bulkheads?.[0]?.branchId}", ветвь[0].id="${branches[0]?.id}"`);
      return syms;
    };

    // ── Создаём объекты Position из импорта ──
    const makeImportedPositions = (existingPositions: Position[]) => {
      const newPositions: Position[] = [];
      let nextNum = (existingPositions.length > 0
        ? Math.max(...existingPositions.map(p => p.number)) + 1
        : 1);
      for (const rp of result.positions ?? []) {
        newPositions.push(makePosition({
          id: `POS_CSV_${rp.id}_${Date.now()}`,
          number: rp.number || nextNum++,
          name: rp.name,
          x: rp.x,
          y: rp.y,
          z: rp.z,
          placed: rp.x !== 0 || rp.y !== 0,
          branchIds: rp.branchIds,
          positionType: (rp.positionType?.toLowerCase().includes("реверс") ? "reverse" : "normal") as "normal" | "reverse",
        }));
      }
      return newPositions;
    };

    if (mode === "replace") {
      const withBulkheads = applyBulkheads(result.branches);
      const finalBranches = applyFans(withBulkheads);
      setNodes(result.nodes);
      setBranches(finalBranches);
      const fanSyms = ensureFanSymbols(finalBranches, []);
      const bkSyms  = makeBulkheadSymbols(finalBranches, fanSyms);
      setSchemaSymbols([...fanSyms, ...bkSyms]);
      setPositions(makeImportedPositions([]));
      setSelectedNodeId(null); setSelectedBranchId(null);
    } else {
      setNodes(prev => [...prev, ...result.nodes]);
      setBranches(prev => {
        const withBulkheads = applyBulkheads(result.branches);
        return [...prev, ...applyFans(withBulkheads)];
      });
      setSchemaSymbols(prev => {
        const withBulkheads = applyBulkheads(result.branches);
        const withFans = applyFans(withBulkheads);
        const fanSyms = ensureFanSymbols(withFans, prev);
        const bkSyms  = makeBulkheadSymbols(withFans, [...prev, ...fanSyms]);
        return [...prev, ...fanSyms, ...bkSyms];
      });
      setPositions(prev => [...prev, ...makeImportedPositions(prev)]);
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
  // Окно "О программе"
  const [showAbout, setShowAbout] = useState<boolean>(false);

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
    colorMode,
    posColorInner,
    posColorOuter,
    showPositions,
    showFlowArrows,
    flowDisplay,
    zScale,
    xyScale,
    view: savedViewState ?? undefined,
    positions,
    scaleLimitsEnabled,
  });

  // Отслеживаем изменения проекта — помечаем как «несохранённый»
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setIsDirty(true);
  }, [nodes, branchesRaw, schemaSymbols, mineFans, mineBulkheads, mineTypes,
      calcMode, solverTolerance, solverMaxIter, solverAlpha, surfaceTemp,
      infoConfig, unitsConfig, branchWidth, branchBorder, colorByHorizon,
      showFlowArrows, flowDisplay, zScale, xyScale]);

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
    if (isDemo) { setShowLicenseDialog(true); return; }
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
    if (isDemo) { setShowLicenseDialog(true); return; }
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
    if (isDemo) { setShowLicenseDialog(true); return; }
    // File System Access API — открываем с handle для последующей перезаписи
    if ("showOpenFilePicker" in window) {
      try {
        const [handle] = await (window as Window & { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
          types: [{ description: "Проект вентиляции", accept: {
            "application/json": [".vproj", ".json"],
            "text/plain": [".vproj", ".json"],
            "*/*": [".vproj", ".json"],
          }}],
          excludeAcceptAllOption: false,
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
    // На Android accept=".vproj" делает файлы неактивными — используем широкий список типов
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".vproj,.json,application/json,text/plain,*/*";
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
    // Блокируем начальный пресет вида — файл загружен
    initialFileLoadedRef.current = true;
    setNodes((data.nodes as TopoNode[]) ?? []);
    // Каждую ветвь прогоняем через makeBranch чтобы гарантировать все поля (fanRpm и т.д.)
    const rawBranches = (data.branches as TopoBranch[]) ?? [];
    const mergedBranches = rawBranches.map((b) =>
      makeBranch(b.id, b.fromId, b.toId, b)
    );
    setBranches(mergedBranches);
    if (data.horizons) {
      const loaded = data.horizons as Horizon[];
      // Гарантируем наличие "Общего вида" при открытии любого проекта
      const withOverview = loaded.some(h => h.id === OVERVIEW_HORIZON_ID)
        ? loaded
        : [{ id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "#6b7280", visible: true,
            printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
              orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
              period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
              showLegend: false, showStamp: false, showApprover: false, paperFormat: "A1", orientation: "landscape" } } as Horizon,
          ...loaded];
      // Миграция: сбрасываем showLegend/showStamp/showApprover в false для всех горизонтов
      // (старые файлы могли сохранить эти значения как true)
      const migratedHorizons = withOverview.map(h => {
        if (!h.printLayer) return h;
        return {
          ...h,
          printLayer: {
            ...h.printLayer,
            showLegend: false,
            showStamp: false,
            showApprover: false,
          },
        };
      });
      setHorizons(migratedHorizons);
    }
    const loadedSymbols = (data.schemaSymbols as SchemaSymbol[]) ?? [];
    // Добавляем fan-символы для ветвей у которых нет УО (старые проекты)
    const autoFanSymbols = ensureFanSymbols(mergedBranches, loadedSymbols);
    setSchemaSymbols([...loadedSymbols, ...autoFanSymbols]);
    if (data.mineFans) setMineFans(data.mineFans as MineFanExport[]);
    {
      const loaded = data.mineBulkheads as MineBulkheadExport[] | undefined;
      if (loaded && loaded.length > 0) {
        setMineBulkheads(loaded);
      } else {
        setMineBulkheads(BULKHEAD_CATALOG.map(item => ({
          id: `mb_${item.id}`,
          name: item.name,
          type: item.type,
          airPermeability: item.airPermeability,
          rMkyurg: airPermToR(item.airPermeability),
          failurePressure: item.failurePressure,
          note: item.note,
          color: item.color,
        })));
      }
    }
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
    if (data.colorByHorizon !== undefined) { setColorByHorizon(data.colorByHorizon as boolean); }
    // colorMode сохраняется явно — восстанавливаем точное значение
    if (data.colorMode) setColorMode(data.colorMode as "none" | "flowQ" | "horizon");
    else if (data.colorByHorizon) setColorMode("horizon");
    else setColorMode("none");
    if (data.posColorInner !== undefined) setPosColorInner(data.posColorInner as boolean);
    else setPosColorInner(false);
    if (data.posColorOuter !== undefined) setPosColorOuter(data.posColorOuter as boolean);
    else setPosColorOuter(false);
    if (data.showPositions !== undefined) setShowPositions(data.showPositions as boolean);
    if (data.showFlowArrows !== undefined) setShowFlowArrows(data.showFlowArrows as boolean);
    if (data.flowDisplay) setFlowDisplay(data.flowDisplay as "off" | "flow" | "chevrons" | "both");
    if (data.zScale !== undefined) setZScale(data.zScale as number);
    if (data.xyScale !== undefined) setXyScale(data.xyScale as number);
    if (data.scaleLimitsEnabled !== undefined) setScaleLimitsEnabled(data.scaleLimitsEnabled as boolean);
    if (data.positions) setPositions(data.positions as Position[]);
    else setPositions([]);
    setProjectFileName((data.name as string) ?? fileName);
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    // Восстанавливаем вид ПОСЛЕ zScale/xyScale — иначе их useEffect перекроет offset
    if (data.view) {
      const v = data.view as { scale?: number; offsetX?: number; offsetY?: number; azimuth?: number; elevation?: number };
      setSavedViewToRestore(v);
    }
    // Если вида нет в файле — авто-fit по импортируемым данным
    if (!data.view) {
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
    setHorizons([{ id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "#6b7280", visible: true,
      printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
        orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
        period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
        showLegend: false, showStamp: false, showApprover: false, paperFormat: "A1", orientation: "landscape" } } as Horizon]);
    setActiveHorizonId("");
    setActiveRibbon("home");
  };

  // ─── РАСКРЫТЫЕ НАСТРОЙКИ ГОРИЗОНТОВ (план + слой печати) ───────────
  const [expandedHorizons, setExpandedHorizons] = useState<Set<string>>(new Set());
  const toggleHorizonExpand = (id: string) =>
    setExpandedHorizons(prev => {
      const n = new Set(prev);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });

  // ─── КОНТЕКСТНОЕ МЕНЮ ───────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{
    kind: "node" | "branch" | "canvas";
    id?: string;
    x: number;
    y: number;
  } | null>(null);
  // (автопереключение правого таба при выборе объекта убрано — пользователь выбирает вкладку вручную)

  // ─── РЕСАЙЗ ЛЕВОЙ ПАНЕЛИ ────────────────────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(390);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Формирует payload ветвей для запроса к backend/airflow.
  // Единая точка подготовки данных — используется в расчёте вентиляции и пожара.
  // ─────────────────────────────────────────────────────────────────────────
  const buildBranchPayload = (
    branchesList: typeof branches,
    surfaceTempVal: number,
  ) => {
    const curve_map = new Map(branchesList.map(b => {
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

    return branchesList.map(b => {
      const { curve, k, af } = curve_map.get(b.id) ?? { curve: undefined, k: 1, af: 1 };
      const fromNode = nodes.find(n => n.id === b.fromId);
      const toNode   = nodes.find(n => n.id === b.toId);
      const tFrom = fromNode ? (fromNode.atmosphereLink ? surfaceTempVal : (fromNode.airTemp ?? surfaceTempVal)) : surfaceTempVal;
      const tTo   = toNode   ? (toNode.atmosphereLink   ? surfaceTempVal : (toNode.airTemp   ?? surfaceTempVal)) : surfaceTempVal;
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
          const branchArea = b.area ?? 0;
          const isFullyOpen = (OPEN_DOOR_IDS.has(s.typeId) && sw <= 0.001)
            || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
          if (isFullyOpen) {
            r = 0;
          } else if (sw > 0.001) {
            const mu = 0.65;
            r = rho / (2 * mu * mu * sw * sw);
          } else {
            const kAir = s.bkManualAirPerm ? (s.bkCustomAirPerm ?? 0)
              : (s.bkAirPerm
                ?? (s.bkBulkheadId ? mineBulkheads.find(mb => mb.id === s.bkBulkheadId)?.airPermeability : undefined)
                ?? b.bulkheadAirPerm ?? 0);
            const rRef = s.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === s.bkBulkheadId)?.rMkyurg ?? 0) : 0;
            r = kAir > 0 ? 1 / (kAir * kAir) : (s.bkBulkheadR ?? rRef ?? b.bulkheadR ?? 0);
          }
        }
        return sum + r;
      }, 0);
      // Перемычка задана через вкладку ветви (без символа на схеме)
      const rBranchBulkhead = (b.hasBulkhead && bkSyms.length === 0) ? (() => {
        const mode = b.bulkheadResMode ?? "project";
        if (mode === "manual") return (b.bulkheadManualR ?? 0) * 1e3;
        if (mode === "survey") {
          const q = b.bulkheadSurveyQ ?? 0; const dp = b.bulkheadSurveyDP ?? 0;
          return q > 0 ? dp / (q * q) : 0;
        }
        if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0)
          return 1 / (b.bulkheadCustomAirPerm! * b.bulkheadCustomAirPerm!);
        if ((b.bulkheadAirPerm ?? 0) > 0)
          return 1 / (b.bulkheadAirPerm * b.bulkheadAirPerm);
        return b.bulkheadR ?? 0;
      })() : 0;
      const fanCrossingR = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
        ? (b.fanCrossingR ?? 0) : 0;
      return {
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        R: b.resistance + rBulkheads + rBranchBulkhead + fanCrossingR,
        area: b.area,
        angle: b.angle ?? 0,
        hasFan: b.hasFan,
        fanType: b.fanType ?? "ГВУ",
        fanMode: b.fanMode,
        fanPressure: b.fanPressure,
        fanInstall:  b.fanInstall ?? "Внутри перемычки",
        fanCrossingR: b.fanCrossingR ?? 0,
        fanReverse:  b.fanReverse ?? false,
        fanStopped:  b.fanStopped ?? false,
        fanParallel: Math.max(1, b.fanParallel ?? 1),
        fireThermalDepression: b.fireThermalDepression ?? 0,
        ...(curve ? {
          h0: curve.h0 * af * k * k,
          h1: curve.h1 * k,
          h2: curve.h2,
          qMax: curve.qMax * af * k,
          qMin: curve.qMin * af * k,
          ...(curve.reverseH0 !== undefined ? {
            reverseH0:  curve.reverseH0 * k * k,
            reverseH1:  curve.reverseH1! * k,
            reverseH2:  curve.reverseH2!,
            reverseQMax: (curve.reverseQMax ?? curve.qMax) * k,
            reverseEfficiencyFactor: curve.reverseEfficiencyFactor,
          } : {}),
        } : {}),
      };
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Вспомогательный расчёт сети для итеративного учёта тепловой депрессии
  // пожара. Принимает branches с заполненным полем fireThermalDepression (Па)
  // и возвращает Map<branchId, Q> — расходы после пересчёта.
  // Используется исключительно внутри обработчика кнопки «Расчёт пожара».
  // ─────────────────────────────────────────────────────────────────────────
  const solveFireIteration = async (
    branchesWithFire: typeof branches,
    surfaceTempVal: number,
  ): Promise<Map<string, number>> => {
    const reqBody = {
      method: calcMode,
      nodes: nodes.map(n => ({
        id: n.id,
        isAtm: n.atmosphereLink,
        z: n.z ?? 0,
        airTemp: n.atmosphereLink ? surfaceTempVal : (n.airTemp ?? surfaceTempVal),
      })),
      surfaceTemp: surfaceTempVal,
      branches: buildBranchPayload(branchesWithFire, surfaceTempVal),
      options: { tolerance: solverTolerance, maxIter: solverMaxIter, alpha: solverAlpha },
    };

    const resp = await fetch(AIRFLOW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    if (!resp.ok) return new Map();
    const data = await resp.json();
    if (data.error) return new Map();
    const flowMap = new Map<string, number>();
    (data.branches as { id: string; Q: number }[]).forEach(rb => flowMap.set(rb.id, rb.Q));
    return flowMap;
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
      const requestBody = {
          method: calcMode,
          nodes: nodes.map(n => ({
            id: n.id,
            isAtm: n.atmosphereLink,
            z: n.z ?? 0,
            airTemp: n.atmosphereLink ? surfaceTemp : (n.airTemp ?? surfaceTemp),
          })),
          surfaceTemp,
          branches: buildBranchPayload(branches, surfaceTemp),
          options: {
            tolerance: solverTolerance,
            maxIter: solverMaxIter,
            alpha: solverAlpha,
          },
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
      const resultBranches = data.branches as { id: string; Q: number; velocity: number; H: number; Hfan?: number; isDead?: boolean }[];
      setBranches(prev => prev.map(b => {
        const rb = resultBranches.find(r => r.id === b.id);
        if (!rb) return b;

        let newFanPressure = b.fanPressure;
        let newFanEfficiency = b.fanEfficiency;
        let newFanShaftPower = b.fanShaftPower;
        let newPower = b.power;

        if (b.hasFan && rb.Hfan !== undefined) {
          newFanPressure = rb.Hfan;

          if (b.fanMode === "curve") {
            const curve = getFanById(b.fanCurveId);
            if (curve) {
              const N = Math.max(1, b.fanParallel ?? 1);
              // k — масштаб оборотов (Q-ось кривой η линейна по n)
              const k = (b.fanRpm > 0 && curve.rpmNominal > 0) ? b.fanRpm / curve.rpmNominal : 1;
              // Q через один вентилятор, в координатах номинальных оборотов
              const Q_one_nominal = Math.abs(rb.Q) / N / k;
              const etaBase = fanEfficiency(curve, Q_one_nominal);
              const effFactor = b.fanReverse ? (curve.reverseEfficiencyFactor ?? 0.82) : 1;
              newFanEfficiency = Math.max(0.05, etaBase * effFactor);
              // Мощность: H * Q_total / η  (H уже суммарный с параллелью)
              newFanShaftPower = fanShaftPower(Math.abs(rb.Hfan), Math.abs(rb.Q), newFanEfficiency);
              newPower = newFanShaftPower;
            }
          } else {
            // constant mode: КПД задаётся вручную, мощность = H * Q_total / η
            const eta = b.fanEfficiency > 0 ? b.fanEfficiency : 0.65;
            newFanShaftPower = fanShaftPower(Math.abs(rb.Hfan), Math.abs(rb.Q), eta);
            newPower = newFanShaftPower;
          }
        }

        return {
          ...b,
          flow: rb.Q,
          velocity: rb.velocity,
          dP: rb.H,
          isDead: rb.isDead ?? false,
          fanPressure: newFanPressure,
          fanEfficiency: newFanEfficiency,
          fanShaftPower: newFanShaftPower,
          power: newPower,
        };
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
      // isEditing: true если активный элемент — поле ввода или contentEditable
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";
      const isEditing = ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        && active !== document.body)
        || (active?.isContentEditable ?? false);

      if (e.ctrlKey && (e.key === "z" || e.key === "я" || e.key === "Я")) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.ctrlKey && (e.key === "s" || e.key === "ы" || e.key === "Ы")) {
        e.preventDefault();
        handleSave();
        return;
      }
      // Ctrl+F / Ctrl+А — открыть поиск по схеме
      if (e.ctrlKey && (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А")) {
        e.preventDefault();
        setLeftPanelOpen(true);
        setActiveSide("search");
        return;
      }
      // Ctrl+P / Ctrl+З — открыть диалог печати
      if (e.ctrlKey && (e.key === "p" || e.key === "P" || e.key === "з" || e.key === "З")) {
        e.preventDefault();
        setShowPrintDialog(true);
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
      // F3 — режим привязки ветвей к позиции
      if (e.key === "F3") {
        e.preventDefault();
        if (selectedPositionId) setPosBranchBindMode((v) => !v);
        return;
      }
      // F6, F9 — всегда работают
      if (e.key === "F6") { e.preventDefault(); setThinLines((v) => !v); return; }
      if (e.key === "F9") { e.preventDefault(); handleSolve(); return; }
      // И/B — добавить выноску (режим рисования) или убрать
      if ((e.key === "и" || e.key === "И" || e.key === "b" || e.key === "B") && !isEditing) {
        e.preventDefault();
        if (selectedPositionId) {
          const pos = positions.find(p => p.id === selectedPositionId);
          if (pos) {
            const hasLeader = pos.leaderEndX != null || pos.leaderBranchId != null;
            if (hasLeader) {
              // Уже есть выноска — убираем
              setPositions(prev => prev.map(p =>
                p.id === selectedPositionId
                  ? { ...p, leaderEndX: null, leaderEndY: null, leaderBranchId: null, leaderT: null }
                  : p
              ));
            } else {
              // Нет выноски — запускаем режим рисования
              setLeaderDrawMode(selectedPositionId);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }
          }
        }
        return;
      }

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
        // Выход из режима рисования выноски
        if (leaderDrawMode) {
          setLeaderDrawMode(null);
          setLeaderCursorScreen(null);
          setLeaderSnapBranch(null);
          return;
        }
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
  }, [nodes, branchesRaw, selectedNodeId, selectedBranchId, selectedSymbolId, schemaSymbols, symbolClipboard, pendingSymbol, selectedPositionId, leaderDrawMode]);

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
    pushHistory();
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
      pushHistory();
      const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
      if (sym?.typeId === "fan" && sym.branchId) {
        updateBranch(sym.branchId, {
          hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0,
          fanStopped: false, fanReverse: false, fanRpm: 0,
          fanBladeAngle: 0, fanParallel: 1, fanEfficiency: 0,
          fanShaftPower: 0, fanInstall: "Без перемычки", fanCrossingR: 0,
        }, false);
      }
      // При удалении перемычки — сбрасываем флаг hasBulkhead и параметры ветви,
      // чтобы расчёт учёл отсутствие сопротивления (воздух пойдёт свободно)
      if (sym && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
        // Проверяем: нет ли других символов перемычки на той же ветви
        const otherBulkheadsOnBranch = schemaSymbols.filter(
          s => s.id !== sym.id && BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === sym.branchId
        );
        if (otherBulkheadsOnBranch.length === 0) {
          updateBranch(sym.branchId, {
            hasBulkhead: false,
            bulkheadR: 0,
            bulkheadAirPerm: 0,
            bulkheadManualR: 0,
            bulkheadSurveyQ: 0,
            bulkheadSurveyDP: 0,
          }, false);
        }
      }
      removeSymbol(selectedSymbolId);
      setSelectedSymbolId(null);
      setSelectedSymbolIds(new Set());
    } else if (selectedBranchId) {
      pushHistory();
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
    pushHistory();
    setBranches((p) => p.filter((b) => b.id !== id));
    if (selectedBranchId === id) setSelectedBranchId(null);
  };

  // Разорвать связь в узле — как в АэроСети:
  // каждая ветвь получает свой клон-узел на том же месте, исходный узел удаляется.
  // Ветви при этом НЕ удаляются — они перепривязываются к новым узлам.
  const handleSplitNodeConnections = (id: string) => {
    pushHistory();
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
    pushHistory();
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
    pushHistory();
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
    pushHistory();
    setBranches((p) => p.map((b) => {
      if (b.id !== id) return b;
      const isVmp = b.fanType === "ВМП";
      return {
        ...b,
        fromId: b.toId,
        toId: b.fromId,
        // Для ГВУ/ВВУ разворот ветви инвертирует fanReverse (направление нагнетания сохраняется физически).
        // Для ВМП fanReverse не используется — ВМП нагнетает всегда по fromId→toId,
        // поэтому разворот ветви = разворот направления нагнетания, fanReverse не трогаем.
        ...(!isVmp && b.hasFan ? { fanReverse: !(b.fanReverse ?? false) } : {}),
      };
    }));
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
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            title="О программе"
            className="flex items-center justify-center hover:bg-black/10 rounded-sm p-0.5 transition-colors"
            style={{ lineHeight: 0 }}>
            <img src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/64422e03-0383-46c6-987b-afce90ce7720.png" alt="ПВ-Система" className="w-4 h-4 object-contain" draggable={false} />
          </button>
          <span className="text-xs font-medium">ПВ-Система — {projectFileName}{isDirty ? " *" : ""}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">—</button>
          <button className="w-7 h-5 hover:bg-black/10 flex items-center justify-center text-xs">▢</button>
          <button className="w-7 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs"
            onClick={() => { if (isDirty) { setShowCloseConfirm(true); } else { window.close(); } }}>✕</button>
        </div>
      </div>

      {/* ── Демо-баннер ────────────────────────────────────────────────── */}
      {isDemo && (
        <div className="flex items-center justify-between px-3 py-1 text-[11px] font-medium select-none"
          style={{ background: "#fef3c7", borderBottom: "1px solid #fcd34d", color: "#92400e" }}>
          <span>⚠ Демо-режим: ограничено 20 узлов, нет сохранения, печати и расчётов аварий</span>
          <button onClick={() => setShowLicenseDialog(true)}
            className="ml-3 px-2 py-0.5 rounded text-[10px] font-semibold text-white flex-shrink-0"
            style={{ background: "#d97706" }}>
            Активировать лицензию
          </button>
        </div>
      )}

      {/* ═══ RIBBON TABS ══════════════════════════════════════════════════ */}
      <div className="flex items-end h-7 px-1 gap-0.5"
        style={{ background: "#f0f0f0", borderBottom: "1px solid #b8b8b8" }}>
        <RibbonTabBtn label="Файл" active={activeRibbon === "file"} onClick={() => setActiveRibbon("file")} fileStyle />
        <RibbonTabBtn label="Главная" active={activeRibbon === "home"} onClick={() => setActiveRibbon("home")} />
        <RibbonTabBtn label="Схема" active={activeRibbon === "vent"} onClick={() => setActiveRibbon("vent")} />
        <RibbonTabBtn label="Вентиляция" active={activeRibbon === "thermo"} onClick={() => setActiveRibbon("thermo")} />
        <RibbonTabBtn label="Аварии" active={activeRibbon === "involve"}
          onClick={() => { if (isDemo) { setShowLicenseDialog(true); return; } setActiveRibbon("involve"); }}
          title={isDemo ? "Аварийные расчёты — только в полной версии" : undefined} />
        <RibbonTabBtn label="Трубы" active={activeRibbon === "costs"} onClick={() => setActiveRibbon("costs")} />
        <RibbonTabBtn label="Справочники" active={activeRibbon === "general"} onClick={() => setActiveRibbon("general")} />
        <RibbonTabBtn label="Общее" active={false} onClick={() => {}} highlight />
        <RibbonTabBtn label="Печать" active={false} onClick={() => setShowPrintDialog(true)} />
        <div className="ml-auto pr-2 pb-0.5">
          <button className="w-5 h-5 hover:bg-black/10 flex items-center justify-center"
            title="Свернуть ленту">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 3 L5 7 L9 3" stroke="#444" fill="none" strokeWidth="1.2" /></svg>
          </button>
        </div>
      </div>

      {/* ═══ МЕНЮ ФАЙЛ (выпадающее, как в Аэросеть) ═══════════════════════ */}
      {activeRibbon === "file" && (() => {
        const sections: { id: string; label: string; separator?: boolean }[] = [
          { id: "new",       label: "Создать" },
          { id: "open",      label: "Открыть" },
          { id: "recent",    label: "Последние" },
          { id: "add",       label: "Добавить" },
          { id: "saveas",    label: "Сохранить как" },
          { id: "save",      label: "Сохранить" },
          { id: "print",     label: "Печать" },
          { id: "export",    label: "Экспорт" },
          { id: "install",   label: "Установить" },
          { id: "license",   label: isDemo ? "🔑 Лицензия" : "✓ Лицензия", separator: true },
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
                      { icon: "FileText" as const,    label: "CSV из Ventsim",                  ext: "Ventsim 5/6",    action: "csv-ventsim" },
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
                          } else if (item.action === "csv-ventsim") {
                            setShowVentsimImport(true);
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
                            background: item.action === "csv-aero" ? "#dcfce7" : item.action === "csv-ventsim" ? "#fef9c3" : item.action === "combined" ? "#ede9fe" : item.action === "dxf" ? "#dbeafe" : "#fff",
                            borderColor: item.action === "csv-aero" ? "#86efac" : item.action === "csv-ventsim" ? "#fde047" : item.action === "combined" ? "#a78bfa" : item.action === "dxf" ? "#93c5fd" : "#d1d5db",
                          }}>
                          <Icon name={item.icon} size={18} />
                        </div>
                        <div>
                          <div className="text-[12px] font-medium" style={{ color: item.action === "csv-aero" ? "#15803d" : item.action === "csv-ventsim" ? "#854d0e" : item.action === "combined" ? "#5b21b6" : "#1f2937" }}>
                            {item.label}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {item.action === "csv-aero" ? "✓ X,Y,Z координаты + все параметры в одном файле"
                            : item.action === "csv-ventsim" ? "✓ Branch Report → Export to CSV"
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
                    <button onClick={() => { openPrintDialog(); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group mb-2">
                      <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "#eff6ff" }}>
                        <Icon name="Printer" size={22} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium text-gray-800">Просмотр и печать</div>
                        <div className="text-[11px] text-gray-400">Настройка формата, масштаба, экспорт</div>
                      </div>
                    </button>
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
                    <button onClick={() => { setActiveRibbon("home"); openPrintDialog(); setPrintDialogOpenExport(true); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-red-50 border border-gray-200 group mb-1">
                      <div className="w-8 h-8 flex items-center justify-center rounded border border-gray-300" style={{ background: "#fff0f0" }}>
                        <Icon name="FileText" size={16} className="text-red-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-gray-700">Экспорт в PDF</div>
                        <div className="text-[10px] text-gray-400">Графический план — слой печати, высокое качество</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Установить приложение ── */}
                {fileSectionState === "install" && (() => {
                  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
                    || (navigator as unknown as { standalone?: boolean }).standalone === true;
                  return (
                    <>
                      <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Установить приложение</div>
                      {isStandalone ? (
                        <div className="flex items-center gap-3 px-3 py-3 rounded bg-green-50 border border-green-200 mb-3">
                          <Icon name="CheckCircle" size={22} className="text-green-600 flex-shrink-0" />
                          <div>
                            <div className="text-[13px] font-medium text-green-800">Приложение установлено</div>
                            <div className="text-[11px] text-green-600">ПВ-Система работает как настольное приложение</div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-[12px] text-gray-600 mb-3 leading-relaxed">
                            Установите ПВ-Система на ПК — приложение откроется без браузера, как обычная программа Windows.
                          </div>
                          <div id="pwa-install-area" className="mb-3">
                            <button
                              id="pwa-install-btn"
                              className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group"
                              onClick={() => {
                                const ev = (window as unknown as { __pwaPrompt?: { prompt: () => void } }).__pwaPrompt;
                                if (ev) { ev.prompt(); }
                                else { alert("Для установки откройте сайт в браузере Chrome или Edge и нажмите значок установки (⊕) в адресной строке."); }
                              }}>
                              <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "#eff6ff" }}>
                                <img src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/a81f2c98-d805-485d-b5f9-3e15893dd1a4.png"
                                  alt="" className="w-7 h-7 rounded-lg" />
                              </div>
                              <div>
                                <div className="text-[13px] font-medium text-blue-700">Установить ПВ-Система на ПК</div>
                                <div className="text-[11px] text-gray-400">Chrome / Edge — Windows, macOS, Linux</div>
                              </div>
                            </button>
                          </div>
                          <div className="text-[11px] text-gray-400 leading-relaxed px-1">
                            Если кнопка не работает — найдите значок <b>⊕</b> или <b>⬇</b> в правой части адресной строки браузера.
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}

                {/* ── Лицензия ── */}
                {fileSectionState === "license" && (
                  <>
                    <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Лицензия</div>
                    {isDemo ? (
                      <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 mb-3">
                        <div className="text-[12px] font-semibold text-amber-800 mb-1">Демо-режим</div>
                        <div className="text-[11px] text-amber-700 space-y-0.5">
                          <div>• Максимум 20 узлов</div>
                          <div>• Нет сохранения файлов</div>
                          <div>• Нет расчётов аварий</div>
                          <div>• Нет печати</div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg border border-green-200 bg-green-50 mb-3">
                        <div className="text-[12px] font-semibold text-green-800 mb-1">✓ Лицензия активна</div>
                        <div className="text-[11px] text-green-700">{license.info?.owner}</div>
                        <div className="text-[11px] font-mono text-green-600">{license.info?.key}</div>
                        {license.info?.seats && (
                          <div className="text-[11px] text-green-600 mt-0.5">
                            Мест: {license.info.seats.used} / {license.info.seats.max}
                          </div>
                        )}
                      </div>
                    )}
                    <button onClick={() => { setShowLicenseDialog(true); setActiveRibbon("home"); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded hover:bg-blue-50 border border-blue-200 group">
                      <div className="w-9 h-9 flex items-center justify-center rounded border border-blue-300" style={{ background: "#dbeafe" }}>
                        <Icon name="KeyRound" size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <div className="text-[12px] font-medium text-blue-700">{isDemo ? "Активировать лицензию" : "Управление лицензией"}</div>
                        <div className="text-[10px] text-gray-400">Ввести лицензионный ключ</div>
                      </div>
                    </button>
                  </>
                )}

                {/* ── Остальные секции — заглушки ── */}
                {!["new", "add", "open", "save", "saveas", "print", "export", "install", "license"].includes(fileSectionState) && (
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

      {/* ═══ RIBBON CONTENT: АВАРИИ ════════════════════════════════════════ */}
      {activeRibbon === "involve" && (
      <div className="h-[92px] flex items-stretch px-1 py-1 gap-0.5 overflow-x-auto"
        style={{ background: "linear-gradient(180deg,#fff5f5,#fce8e8)", borderBottom: "1px solid #fca5a5" }}>

        {/* ── Группа: Очаг пожара ── */}
        <RibbonGroup label="Очаг пожара">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="Flame"
              label="Установить"
              sublabel="очаг пожара"
              onClick={() => { handlePickSymbol("fire_source"); setActiveRibbon("involve"); }}
              style={{ background: schemaSymbols.some(s => s.typeId === "fire_source") ? "#fee2e2" : undefined,
                       borderColor: schemaSymbols.some(s => s.typeId === "fire_source") ? "#fca5a5" : undefined }}
            />
            <RibbonBigBtn
              icon="Trash2"
              label="Убрать"
              sublabel="очаги пожара"
              disabled={!schemaSymbols.some(s => FIRE_SYMBOL_IDS.has(s.typeId))}
              onClick={() => {
                schemaSymbols.filter(s => FIRE_SYMBOL_IDS.has(s.typeId)).forEach(s => {
                  if (s.branchId) updateBranch(s.branchId, { hasFire: false, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0 });
                  removeSymbol(s.id);
                });
                setFireResult(null);
                setFireCalcDone(false);
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Взрыв ── */}
        <RibbonGroup label="Взрыв">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="Zap"
              label="Установить"
              sublabel="место взрыва"
              onClick={() => { handlePickSymbol("explosion_source"); setActiveRibbon("involve"); }}
              style={{ background: schemaSymbols.some(s => s.typeId === "explosion_source") ? "#fef3c7" : undefined,
                       borderColor: schemaSymbols.some(s => s.typeId === "explosion_source") ? "#fcd34d" : undefined }}
            />
            <RibbonBigBtn
              icon="Trash2"
              label="Убрать"
              sublabel="взрывы"
              disabled={!schemaSymbols.some(s => EXPLOSION_SYMBOL_IDS.has(s.typeId))}
              onClick={() => {
                schemaSymbols.filter(s => EXPLOSION_SYMBOL_IDS.has(s.typeId)).forEach(s => {
                  if (s.branchId) updateBranch(s.branchId, { hasExplosion: false, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0 });
                  removeSymbol(s.id);
                });
                setExplosionResult(null);
                setExplosionCalcDone(false);
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Расчёт ── */}
        <RibbonGroup label="Расчёт">
          <div className="flex items-stretch gap-1">
            <button
              onClick={async () => {
                if (!solveResult) {
                  alert("Сначала выполните расчёт вентиляционной сети (F9)");
                  return;
                }

                // ── Итеративный учёт тепловой депрессии пожара ────────────────
                // Алгоритм (Аэросеть / Вентиляция-2):
                //   Итерация 1: берём расходы из штатного расчёта сети
                //   → считаем T_пр и h_t для каждого очага
                //   → пересчитываем сеть с h_t как naturalDraft в ветви-очаге
                //   Итерация 2–3: уточняем T_пр по новым расходам, повторяем
                //   Критерий: max|ΔQ| < 0.1 м³/с или 3 итерации
                // ──────────────────────────────────────────────────────────────
                const FIRE_ITERS   = 3;    // макс. итераций
                const FIRE_Q_TOL   = 0.1;  // м³/с — допуск сходимости
                const AMBIENT_TEMP = surfaceTemp;

                // Исходные расходы ДО пожара — сохраняем для обнаружения опрокидывания
                const originalFlows = new Map<string, number>(
                  branches.map(b => [b.id, b.flow ?? 0])
                );

                // Текущие расходы (начинаем с результатов штатного расчёта)
                let currentFlows = new Map<string, number>(originalFlows);

                addLog("info", "🔥 Итеративный расчёт аварийного режима (учёт тепловой депрессии)...");

                for (let iter = 0; iter < FIRE_ITERS; iter++) {
                  // Шаг A: подставить актуальные расходы в ветви
                  let branchesIter = branches.map(b => ({
                    ...b,
                    flow: currentFlows.get(b.id) ?? b.flow,
                  }));

                  // Шаг B: Техника — пересчитать мощность по актуальному расходу
                  branchesIter = branchesIter.map(b => {
                    if (!b.hasFire || (b.fireCombustible ?? "coal") !== "vehicle") return b;
                    const masses: [number, number, number] = [
                      b.fireVehicleMassRubber ?? 1200,
                      b.fireVehicleMassDiesel ?? 400,
                      b.fireVehicleMassOil    ?? 200,
                    ];
                    const vfr = calcVehicleFire(masses, Math.abs(b.flow ?? 0));
                    return vfr.power_MW > 0 ? { ...b, fireHeatRelease: vfr.power_MW, fireMode: "heat" as const } : b;
                  });

                  // Шаг C: вычислить T_пр и h_t для каждого очага
                  const branchesWithHt = branchesIter.map(b => {
                    if (!b.hasFire) return b;
                    const Q_MW  = b.fireMode === "heat" ? b.fireHeatRelease : 0;
                    const airQ  = Math.abs(b.flow ?? 0);
                    const T_pr  = b.fireMode === "temp"
                      ? b.fireTemperature
                      : calcFireTemp(Q_MW, airQ, AMBIENT_TEMP);
                    // Знак угла: определяем из высот узлов (to выше from → +, to ниже → −)
                    // b.angle всегда ≥ 0, поэтому берём знак из dz узлов
                    const fromNode = nodes.find(n => n.id === b.fromId);
                    const toNode   = nodes.find(n => n.id === b.toId);
                    const dz = (toNode?.z ?? 0) - (fromNode?.z ?? 0);
                    const signedAngle = Math.abs(b.angle ?? 0) * Math.sign(dz || 1);
                    const h_t = calcThermalDepression(T_pr, AMBIENT_TEMP, b.length, signedAngle);
                    return { ...b, fireThermalDepression: h_t };
                  });

                  // Шаг D: пересчитать сеть с h_t
                  const newFlows = await solveFireIteration(branchesWithHt, AMBIENT_TEMP);
                  if (newFlows.size === 0) break; // ошибка сети — прерываем

                  // Шаг E: проверка сходимости
                  let maxDQ = 0;
                  newFlows.forEach((q, id) => {
                    maxDQ = Math.max(maxDQ, Math.abs(q - (currentFlows.get(id) ?? 0)));
                  });
                  addLog("info", `  Итерация ${iter + 1}: max|ΔQ|=${maxDQ.toFixed(3)} м³/с`);

                  currentFlows = newFlows;
                  if (maxDQ < FIRE_Q_TOL) break;
                }

                // ── Финальный расчёт характеристик пожара по сошедшимся расходам ──
                // Подставляем итоговые Q и пересчитываем мощность (Техника) ещё раз.
                // originalFlow = исходный расход ДО итераций (для обнаружения опрокидывания).
                const branchesForFire = branches.map(b => {
                  const finalQ = currentFlows.get(b.id) ?? b.flow;
                  // originalFlow — расход ДО пожара (до итераций), для детектирования опрокидывания
                  const bUpdated = { ...b, flow: finalQ, originalFlow: originalFlows.get(b.id) ?? b.flow };
                  if (!b.hasFire || (b.fireCombustible ?? "coal") !== "vehicle") return bUpdated;
                  const masses: [number, number, number] = [
                    b.fireVehicleMassRubber ?? 1200,
                    b.fireVehicleMassDiesel ?? 400,
                    b.fireVehicleMassOil    ?? 200,
                  ];
                  const vfr = calcVehicleFire(masses, Math.abs(finalQ ?? 0));
                  return vfr.power_MW > 0 ? { ...bUpdated, fireHeatRelease: vfr.power_MW, fireMode: "heat" as const } : bUpdated;
                });

                // Обновляем flow в state из итеративного расчёта
                setBranches(prev => prev.map(b => {
                  const q = currentFlows.get(b.id);
                  return q !== undefined ? { ...b, flow: q } : b;
                }));

                const result = calcFireMode(branchesForFire, nodes, AMBIENT_TEMP);
                // Записываем вычисленные параметры обратно в ветви
                setBranches(prev => prev.map(b => {
                  const fr = result.branches.get(b.id);
                  if (!fr) return b;
                  return { ...b,
                    fireComputedTemp: fr.airTempOut,
                    fireComputedNatDep: fr.thermalDepression,
                    fireComputedSmokeDens: fr.smokeDensity,
                    fireComputedCO: fr.coConc,
                    fireComputedCO2: fr.co2Conc,
                  };
                }));
                setFireResult(result);
                setFireCalcDone(true);
                setShowSmoke(true);
                // Устанавливаем максимум шкалы: не менее 60 и не более 600 мин
                const initMax = Math.min(600, Math.max(60, Math.ceil(result.maxSmokeTime)));
                setSmokeMaxTime(initMax);
                // Ставим ползунок на максимум — сразу видно всё задымление
                setSmokeTimeMinutes(initMax);
                addLog("info", `🔥 Расчёт пожара завершён. Задымлено ветвей: ${result.branches.size}`);
                result.log.forEach(l => addLog(l.includes("⚠️") ? "warn" : "info", l));
              }}
              disabled={!schemaSymbols.some(s => FIRE_SYMBOL_IDS.has(s.typeId))}
              className="flex flex-col items-center justify-center px-3 py-1 rounded border min-w-[64px] disabled:opacity-40"
              style={{ background: "#dc2626", color: "white", border: "1px solid #b91c1c", cursor: "pointer" }}
              title="Расчёт распространения задымления и тепловой депрессии">
              <Icon name="Flame" size={22} />
              <div className="text-[10px] leading-tight mt-0.5 text-center"><div>Расчёт</div><div>пожара</div></div>
            </button>
            <RibbonBigBtn
              icon={showSmoke ? "EyeOff" : "Eye"}
              label={showSmoke ? "Скрыть" : "Показать"}
              sublabel="задымление"
              disabled={!fireCalcDone}
              active={showSmoke}
              onClick={() => setShowSmoke(v => !v)}
            />
            <RibbonBigBtn
              icon="X"
              label="Сбросить"
              sublabel="результаты"
              disabled={!fireCalcDone}
              onClick={() => { setFireResult(null); setFireCalcDone(false); setBranches(prev => prev.map(b => ({ ...b, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0 }))); }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Расчёт взрыва ── */}
        <RibbonGroup label="Расчёт взрыва">
          <div className="flex items-stretch gap-1">
            <button
              onClick={async () => {
                const expBranches = branches.filter(b => b.hasExplosion);
                if (expBranches.length === 0) {
                  alert("Сначала установите место взрыва на ветви (кнопка «Установить место взрыва»)");
                  return;
                }
                const results: ExplosionResult[] = [];
                const updatedBranchesPromises = branches.map(async b => {
                  if (!b.hasExplosion) return b;
                  const area = b.area ?? 12;
                  const length = b.length ?? 100;
                  let res: ExplosionResult;
                  try {
                    const resp = await fetch(EXPLOSION_URL, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        method: b.explosionMethod ?? "fnip_494",
                        sourceType: b.explosionSourceType ?? "mass",
                        gasId: b.explosionGasId ?? "methane",
                        gasVolume_m3: b.explosionGasVolume ?? 100,
                        gasConcentration: b.explosionGasConcentration ?? 9.5,
                        explosiveId: b.explosionExplosiveId ?? "ammonit",
                        explosiveMass_kg: b.explosionExplosiveMass ?? 100,
                        excavationArea_m2: area,
                        excavationLength_m: length,
                        ambientPressure_kPa: 101.3,
                        considerWalls: b.explosionConsiderWalls ?? true,
                      }),
                    });
                    const data = await resp.json();
                    // Восстанавливаем pressureAtDistance / impulseAtDistance по формуле Садовского
                    // напрямую из q_tnt_kg и wall_factor (не зависит от таблицы точек)
                    const _qTnt = data.q_tnt_kg ?? 0.001;
                    const _considerWalls = b.explosionConsiderWalls ?? true;
                    const _wfRaw = area <= 0 ? 1.5 : area < 10 ? 2.0 : area < 20 ? 1.8 : area < 40 ? 1.5 : 1.3;
                    const _wf   = _considerWalls ? _wfRaw : 1.0;
                    const _meth = b.explosionMethod ?? "gas_dynamics";
                    const sadovsky = (r: number): number => {
                      if (_qTnt <= 0 || r <= 0) return 0;
                      const rBar = r / Math.pow(_qTnt, 1 / 3);
                      if (rBar < 0.1) return 10000;
                      return Math.round(101.3 * (0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar)) * 10) / 10;
                    };
                    const fnip494 = (r: number): number => {
                      if (_qTnt <= 0 || r <= 0) return 0;
                      return Math.round(1.07 * Math.pow(_qTnt / (r * r * r), 1 / 3) * 101.3 * 10) / 10;
                    };
                    res = {
                      ...data,
                      pressureAtDistance: (r: number) => {
                        const dp = _meth === "gas_dynamics" ? sadovsky(r) : fnip494(r);
                        return Math.round(dp * _wf * 10) / 10;
                      },
                      impulseAtDistance: (r: number) => {
                        if (_qTnt <= 0 || r <= 0) return 0;
                        return Math.round(200 * Math.pow(_qTnt, 1 / 3) / r * _wf * 10) / 10;
                      },
                    };
                  } catch {
                    res = calcExplosion({
                      method: (b.explosionMethod ?? "fnip_494") as ExplosionMethod,
                      sourceType: (b.explosionSourceType ?? "mass") as ExplosionSourceType,
                      gasId: b.explosionGasId ?? "methane",
                      gasVolume_m3: b.explosionGasVolume ?? 100,
                      gasConcentration: b.explosionGasConcentration ?? 9.5,
                      explosiveId: b.explosionExplosiveId ?? "ammonit",
                      explosiveMass_kg: b.explosionExplosiveMass ?? 100,
                      excavationArea_m2: area,
                      excavationLength_m: length,
                      ambientPressure_kPa: 101.3,
                      considerWalls: b.explosionConsiderWalls ?? true,
                    });
                  }
                  results.push(res);
                  return {
                    ...b,
                    explosionComputedQtnt: res.q_tnt_kg,
                    explosionComputedMaxP: res.maxDeltaP_kPa,
                    explosionComputedWaveSpeed: res.waveFrontSpeed_ms,
                    explosionComputedR_lethal: res.zones[0]?.radius_m ?? 0,
                    explosionComputedR_heavy: res.zones[1]?.radius_m ?? 0,
                    explosionComputedR_medium: res.zones[2]?.radius_m ?? 0,
                    explosionComputedR_light: res.zones[3]?.radius_m ?? 0,
                  };
                });
                const updatedBranches = await Promise.all(updatedBranchesPromises);
                // ── Определяем разрушенные перемычки по зонам поражения ──────────
                // Дейкстра по сети для расчёта расстояния по выработкам от источника
                type Pt3 = { x: number; y: number; z: number };
                const expSources: Pt3[] = [];
                updatedBranches.forEach(src => {
                  if (!src.hasExplosion || src.explosionComputedMaxP <= 0) return;
                  const fN = nodes.find(n => n.id === src.fromId);
                  const tN = nodes.find(n => n.id === src.toId);
                  if (!fN || !tN) return;
                  const t = src.explosionT ?? 0.5;
                  expSources.push({ x: fN.x+(tN.x-fN.x)*t, y: fN.y+(tN.y-fN.y)*t, z: fN.z+(tN.z-fN.z)*t });
                });

                // Расстояние по сети (Дейкстра)
                const bLen = (b: typeof branches[0]) => {
                  const fN = nodes.find(n => n.id === b.fromId);
                  const tN = nodes.find(n => n.id === b.toId);
                  if (!fN || !tN) return b.length > 0 ? b.length : 1;
                  return Math.sqrt((tN.x-fN.x)**2+(tN.y-fN.y)**2+(tN.z-fN.z)**2) || (b.length > 0 ? b.length : 1);
                };
                const netDist = new Map<string, number>();
                const pq2: Array<{id: string; d: number}> = [];
                updatedBranches.forEach(src => {
                  if (!src.hasExplosion || src.explosionComputedMaxP <= 0) return;
                  const len = bLen(src); const t = src.explosionT ?? 0.5;
                  [[src.fromId, len*t],[src.toId, len*(1-t)]].forEach(([nid, d]) => {
                    const cur = netDist.get(nid as string) ?? Infinity;
                    if ((d as number) < cur) { netDist.set(nid as string, d as number); pq2.push({id: nid as string, d: d as number}); }
                  });
                });
                const adjMap = new Map<string, Array<{to: string; len: number}>>();
                updatedBranches.forEach(b => {
                  const len = bLen(b);
                  if (!adjMap.has(b.fromId)) adjMap.set(b.fromId, []);
                  if (!adjMap.has(b.toId))   adjMap.set(b.toId, []);
                  adjMap.get(b.fromId)!.push({to: b.toId, len});
                  adjMap.get(b.toId)!.push({to: b.fromId, len});
                });
                const vis2 = new Set<string>();
                while (pq2.length > 0) {
                  pq2.sort((a,b) => a.d - b.d);
                  const {id: cur, d: curD} = pq2.shift()!;
                  if (vis2.has(cur)) continue; vis2.add(cur);
                  for (const e of (adjMap.get(cur) ?? [])) {
                    const nd = curD + e.len;
                    if (nd < (netDist.get(e.to) ?? Infinity)) { netDist.set(e.to, nd); pq2.push({id: e.to, d: nd}); }
                  }
                }

                // Помечаем перемычки разрушенными если ΔP > failurePressure
                // fp берём из символа (bkFailurePressure) или из ветви как fallback
                const finalBranches = updatedBranches.map(b => {
                  if (!b.hasBulkhead) return {...b, bulkheadDestroyedByExplosion: false};
                  const bkSym = symbolsRef.current.find(s =>
                    BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id
                  );
                  // давление разрушения: из символа (если задано > 0) или из ветви (из справочника)
                  const fp = (bkSym?.bkFailurePressure && bkSym.bkFailurePressure > 0
                    ? bkSym.bkFailurePressure
                    : b.bulkheadFailurePressure) || 0; // МПа
                  if (!fp || fp <= 0) return {...b, bulkheadDestroyedByExplosion: false};
                  const dFrom = netDist.get(b.fromId) ?? Infinity;
                  const dTo   = netDist.get(b.toId) ?? Infinity;
                  const minD  = Math.min(dFrom, dTo);
                  if (minD === Infinity || results.length === 0) return {...b, bulkheadDestroyedByExplosion: false};
                  const dp_kPa = results[0].pressureAtDistance(minD);
                  const dp_MPa = dp_kPa / 1000;
                  const destroyed = dp_MPa >= fp;
                  return {...b, bulkheadDestroyedByExplosion: destroyed};
                });

                setBranches(finalBranches);
                if (results.length > 0) {
                  const lastRes = results[results.length - 1];
                  setExplosionResult(lastRes);
                  setExplosionCalcDone(true);
                  setShowExplosionZones(true);
                  const safeRadius = lastRes.zones[lastRes.zones.length - 1]?.radius_m ?? 500;
                  const maxR = Math.max(100, Math.ceil(safeRadius / 50) * 50);
                  setBlastMaxRadius(maxR);
                  setBlastRadiusStep(maxR <= 200 ? 5 : maxR <= 500 ? 10 : 25);
                  setBlastWaveRadius(maxR);
                  const destroyed = finalBranches.filter(b => b.bulkheadDestroyedByExplosion);
                  addLog("info", `💥 Расчёт взрыва завершён. Q_тнт = ${lastRes.q_tnt_kg} кг ТНТ, ΔP_max = ${lastRes.maxDeltaP_kPa} кПа`);
                  if (destroyed.length > 0) {
                    addLog("warn", `⚠ Разрушено перемычек: ${destroyed.length} (${destroyed.map(b => b.id).join(", ")})`);
                  }
                  results.forEach(r => r.log.forEach(l => addLog("info", l)));
                  results.forEach(r => r.warnings.forEach(w => addLog("warn", w)));
                }
              }}
              disabled={!schemaSymbols.some(s => EXPLOSION_SYMBOL_IDS.has(s.typeId))}
              className="flex flex-col items-center justify-center px-3 py-1 rounded border min-w-[64px] disabled:opacity-40"
              style={{ background: "#f59e0b", color: "white", border: "1px solid #d97706", cursor: "pointer" }}
              title="Расчёт параметров воздушной ударной волны">
              <Icon name="Zap" size={22} />
              <div className="text-[10px] leading-tight mt-0.5 text-center"><div>Расчёт</div><div>взрыва</div></div>
            </button>
            <RibbonBigBtn
              icon={showExplosionZones ? "EyeOff" : "Eye"}
              label={showExplosionZones ? "Скрыть" : "Показать"}
              sublabel="зоны взрыва"
              disabled={!explosionCalcDone}
              active={showExplosionZones}
              onClick={() => setShowExplosionZones(v => !v)}
            />
            <RibbonBigBtn
              icon="RefreshCw"
              label="Снять"
              sublabel="разрушения"
              disabled={!branches.some(b => b.bulkheadDestroyedByExplosion)}
              onClick={() => setBranches(prev => prev.map(b => ({ ...b, bulkheadDestroyedByExplosion: false })))}
            />
            <RibbonBigBtn
              icon="X"
              label="Сбросить"
              sublabel="результаты"
              disabled={!explosionCalcDone}
              onClick={() => {
                setExplosionResult(null);
                setExplosionCalcDone(false);
                setShowExplosionZones(false);
                setBranches(prev => prev.map(b => ({ ...b, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0, bulkheadDestroyedByExplosion: false })));
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Статус взрыва ── */}
        {explosionCalcDone && explosionResult && (
          <RibbonGroup label="Результат взрыва">
            <div className="flex flex-col justify-center px-2 text-[10px] min-w-[160px] gap-0.5">
              <div className="font-semibold text-amber-700">💥 Q_тнт: {explosionResult.q_tnt_kg} кг</div>
              <div className="text-orange-700">ΔP_max = {explosionResult.maxDeltaP_kPa} кПа</div>
              <div className="text-gray-700">D = {explosionResult.waveFrontSpeed_ms} м/с</div>
              <div className="text-red-700">R_лет. = {explosionResult.zones[0]?.radius_m ?? 0} м</div>
            </div>
          </RibbonGroup>
        )}

        {/* ── Группа: Пути движения ── */}
        <RibbonGroup label="Пути движения">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="PersonStanding"
              label="Вычислить время"
              sublabel="хода горнорабочего"
              active={activeSide === "workerPath"}
              onClick={() => {
                if (activeSide === "workerPath") {
                  setActiveSide("general");
                  setWorkerPickMode(null);
                } else {
                  setActiveSide("workerPath");
                }
              }}
            />
            <RibbonBigBtn
              icon="ShieldCheck"
              label="Расчёт"
              sublabel="горноспасателей"
              active={activeSide === "rescue"}
              onClick={() => {
                if (activeSide === "rescue") {
                  setActiveSide("general");
                  setRescuePickMode(null);
                } else {
                  setActiveSide("rescue");
                }
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Статус ── */}
        {fireCalcDone && fireResult && (
          <RibbonGroup label="Результат расчёта">
            <div className="flex flex-col justify-center px-2 text-[10px] min-w-[160px] gap-0.5">
              <div className="font-semibold text-red-700">🔥 T очага: {fireResult.fireTemp.toFixed(1)} °C</div>
              <div className="text-orange-700">h_t = {fireResult.fireThermalDep.toFixed(1)} Па</div>
              <div className="text-gray-700">Задымлено ветвей: {fireResult.branches.size}</div>
              {fireResult.reversedBranches.size > 0 ? (
                <div className="font-semibold px-1 rounded" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>
                  ⚠️ Опрокидывание: {fireResult.reversedBranches.size} вет.
                </div>
              ) : (
                <div className="text-green-700">✓ Струя устойчива</div>
              )}
            </div>
          </RibbonGroup>
        )}
      </div>
      )}

      {/* ═══ RIBBON CONTENT ═══════════════════════════════════════════════ */}
      {activeRibbon !== "general" && activeRibbon !== "involve" && (
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
        <RibbonGroup label="Действия">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn icon="Undo2" label="Отменить" sublabel="действие"
              onClick={handleUndo}
              disabled={historyRef.current.length === 0} />
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

        {/* ── Группа: ПЛА ── */}
        <RibbonGroup label="ПЛА">
          <div className="relative flex flex-col h-full justify-center">
            <button
              onClick={() => setShowPlaPanel(v => !v)}
              title="План ликвидации аварии — настройки отображения позиций"
              style={{
                width: 58, height: 62,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                borderRadius: 4,
                border: showPlaPanel ? "1.5px solid #2563eb" : (showPositions || posColorInner || posColorOuter) ? "1.5px solid #7c3aed" : "1px solid #c8c8c8",
                background: showPlaPanel ? "#dbeafe" : (showPositions || posColorInner || posColorOuter) ? "#f5f3ff" : "white",
                cursor: "pointer", padding: 0, flexShrink: 0,
              }}>
              <Icon name="MapPin" size={22} style={{ color: (showPositions || posColorInner || posColorOuter) ? "#7c3aed" : "#374151" }} />
              <div style={{ fontSize: 9, lineHeight: "1.1", textAlign: "center", color: (showPositions || posColorInner || posColorOuter) ? "#7c3aed" : "#374151", fontWeight: 500 }}>
                <div>План</div><div>ликв.</div><div>аварии</div>
              </div>
              <Icon name="ChevronDown" size={10} style={{ color: "#6b7280", marginTop: -2 }} />
            </button>

            {showPlaPanel && (
              <div
                style={{
                  position: "fixed", zIndex: 9999,
                  top: 160, left: "auto",
                  background: "white", border: "1px solid #d1d5db",
                  borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                  minWidth: 220, padding: "8px 0",
                  fontSize: 12, color: "#1a1a1a",
                }}
                onMouseDown={e => e.stopPropagation()}
              >
                <div style={{ padding: "3px 12px 5px", fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Отображение
                </div>

                {/* Позиции */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer" }}
                  className="hover:bg-blue-50">
                  <input type="checkbox" checked={showPositions} onChange={e => setShowPositions(e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#7c3aed", cursor: "pointer" }} />
                  <span>Позиции</span>
                </label>

                <div style={{ margin: "4px 12px", borderTop: "1px solid #f0f0f0" }} />
                <div style={{ padding: "3px 12px 5px", fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Окраска ветвей
                </div>

                {/* Цвет позиции внутри */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer" }}
                  className="hover:bg-blue-50">
                  <input type="checkbox" checked={posColorInner} onChange={e => setPosColorInner(e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#7c3aed", cursor: "pointer" }} />
                  <span>Цвет позиции внутри</span>
                </label>

                {/* Цвет позиции снаружи */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", cursor: "pointer" }}
                  className="hover:bg-blue-50">
                  <input type="checkbox" checked={posColorOuter} onChange={e => setPosColorOuter(e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#7c3aed", cursor: "pointer" }} />
                  <span>Цвет позиции снаружи</span>
                </label>

                <div style={{ margin: "4px 12px", borderTop: "1px solid #f0f0f0" }} />
                <button onClick={() => setShowPlaPanel(false)}
                  style={{ display: "block", width: "calc(100% - 24px)", margin: "2px 12px 4px", padding: "3px 0",
                    fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textAlign: "center" }}>
                  Закрыть
                </button>
              </div>
            )}
          </div>
        </RibbonGroup>

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

        {/* ── КНОПКА-ПОЛОСКА «РАЗВЕРНУТЬ ЛЕВУЮ ПАНЕЛЬ» ─────────────── */}
        {!leftPanelOpen && (
          <button onClick={() => setLeftPanelOpen(true)}
            className="flex-shrink-0 flex items-center justify-center w-6 h-full border-r"
            style={{ background: "#f5f5f5", borderColor: "#b8b8b8", color: "#374151", cursor: "pointer" }}
            title="Показать панель свойств">
            <Icon name="PanelLeftOpen" size={14} />
          </button>
        )}

        {/* ── ВЕРТИКАЛЬНЫЕ ВКЛАДКИ СЛЕВА ────────────────────────────── */}
        {leftPanelOpen && (<>
        <div className="flex flex-col flex-shrink-0"
          style={{ width: (selectedNodeId || selectedBranchId || fanSymbolBranchId) ? 24 : 0, background: "#e8e8e8", borderRight: (selectedNodeId || selectedBranchId || fanSymbolBranchId) ? "1px solid #b8b8b8" : "none", overflow: "hidden", transition: "width 0.15s" }}>
          {(selectedNodeId
            ? ([
                { id: "params", label: "Параметры" },
                { id: "measure", label: "Замеры" },
                { id: "waterpipes", label: "Трубы" },
                { id: "indicators", label: "Индикаторы" },
              ] as { id: SideTab; label: string }[])
            : fanSymbolBranchId
            ? ([
                { id: "fan", label: "Вентилятор" },
              ] as { id: SideTab; label: string }[])
            : ([
                { id: "general", label: "Общие" },
                { id: "vent", label: "Вентиляция" },
                { id: "indicators", label: "Индикаторы" },
                { id: "topology", label: "Топология" },
                { id: "areas", label: "Участки" },
                { id: "waterpipes", label: "Трубы:" },
                { id: "conveyor", label: "Конвейер" },
                { id: "coords", label: "Координаты" },
                ...(selectedBranch?.hasFire ? [{ id: "accidents" as SideTab, label: "🔥 Пожар" }] : []),
                ...(selectedBranch?.hasExplosion ? [{ id: "blast" as SideTab, label: "💥 Взрыв" }] : []),
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
                value={activeSide === "horizons" ? "horizons" : activeSide === "search" ? "search" : activeSide === "positions" ? "positions" : activeSide === "flowQ" ? "flowQ" : "props"}
                onChange={(e) => {
                  if (e.target.value === "horizons") setActiveSide("horizons");
                  else if (e.target.value === "search") setActiveSide("search");
                  else if (e.target.value === "positions") setActiveSide("positions");
                  else if (e.target.value === "flowQ") { setActiveSide("flowQ"); setColorMode("flowQ"); }
                  else { setActiveSide("general"); }
                }}>
                <option value="props">Свойства</option>
                <option value="flowQ">Расход воздуха</option>
                <option value="positions">Позиции</option>
                <option value="search">Поиск</option>
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
              {activeSide === "search" && "Поиск"}
              {activeSide === "horizons" && "Горизонты"}
              {activeSide === "vent" && "Аэродинамика"}
              {activeSide === "thermo" && "Теплофизические параметры"}
              {activeSide === "accidents" && "Аварийные режимы"}
              {activeSide === "blast" && "Место взрыва"}
              {activeSide === "areas" && "Учёт по участкам"}
              {activeSide === "indicators" && "Индикаторы"}
              {activeSide === "coords" && "Координаты"}
              {activeSide === "measure" && "Замеры"}
              {activeSide === "pipes" && "Трубопроводы"}
              {activeSide === "positions" && "Позиции"}
              {activeSide === "flowQ" && "Расход воздуха"}
              {activeSide === "rescue" && "Расчёт горноспасателей"}
            </span>
            <div className="flex items-center gap-1">
              {activeSide === "params" && selectedNode && (
                <span className="text-[10px] text-gray-500 font-mono">{selectedNode.id}</span>
              )}
              {(activeSide === "topology" || activeSide === "general") && (
                <button onClick={() => setShowRenumberDialog(true)}
                  className="h-6 px-1.5 flex items-center gap-1 rounded text-[10px]"
                  style={{ background: "none", border: "1px solid #c8c8c8", color: "#374151", cursor: "pointer" }}
                  title="Автонумерация объектов">
                  <Icon name="Hash" size={12} />
                  Перенумеровать
                </button>
              )}
              <button onClick={() => setLeftPanelOpen(false)}
                className="h-6 px-1.5 flex items-center gap-1 rounded text-[10px]"
                style={{ background: "none", border: "1px solid #c8c8c8", color: "#374151", cursor: "pointer" }}
                title="Скрыть панель свойств">
                <Icon name="PanelLeftClose" size={12} />
                Свернуть
              </button>
            </div>
          </div>

          {/* Свойства */}
          <div className="flex-1 overflow-y-auto">

            {/* ═══ ВКЛАДКА: ПОИСК ═════════════════════════════════════ */}
            {activeSide === "search" && (() => {
              const q = searchQuery.trim().toLowerCase();
              type Hit = { kind: "node" | "branch"; id: string; title: string; subtitle: string };
              const hits: Hit[] = [];
              if (q.length > 0) {
                if (searchScope === "all" || searchScope === "nodes") {
                  for (const n of nodes) {
                    const fields = [n.id, n.name, n.number].filter(Boolean).map(String);
                    if (fields.some(f => f.toLowerCase().includes(q))) {
                      hits.push({
                        kind: "node",
                        id: n.id,
                        title: n.name || `Узел ${n.number || n.id}`,
                        subtitle: `№ ${n.number || "—"} · X=${n.x.toFixed(1)} Y=${n.y.toFixed(1)} Z=${n.z.toFixed(1)}`,
                      });
                    }
                  }
                }
                if (searchScope === "all" || searchScope === "branches") {
                  for (const b of branches) {
                    const fromN = nodes.find(n => n.id === b.fromId);
                    const toN = nodes.find(n => n.id === b.toId);
                    const fields = [b.id, b.type, b.fanName, fromN?.name, toN?.name, fromN?.number, toN?.number]
                      .filter(Boolean).map(String);
                    if (fields.some(f => f.toLowerCase().includes(q))) {
                      hits.push({
                        kind: "branch",
                        id: b.id,
                        title: `Ветвь ${b.id}${b.type ? ` (${b.type})` : ""}`,
                        subtitle: `${fromN?.name || b.fromId} → ${toN?.name || b.toId}${b.hasFan ? " · вентилятор" : ""}`,
                      });
                    }
                  }
                }
              }
              const maxShow = 200;
              const shown = hits.slice(0, maxShow);
              return (
                <div className="p-2 text-[11px]">
                  {/* Поле ввода */}
                  <div className="relative mb-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                      placeholder="Введите номер, наименование, ID…"
                      className="w-full pl-6 pr-6 py-1 border border-gray-400 rounded text-[12px] outline-none focus:border-blue-500"
                      style={{ height: 26 }}
                    />
                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <Icon name="Search" size={12} />
                    </span>
                    {searchQuery && (
                      <button onClick={() => setSearchQuery("")}
                        className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                        title="Очистить">
                        <Icon name="X" size={12} />
                      </button>
                    )}
                  </div>

                  {/* Фильтр по типу */}
                  <div className="flex gap-1 mb-2">
                    {([
                      { v: "all" as const, l: "Всё" },
                      { v: "nodes" as const, l: "Узлы" },
                      { v: "branches" as const, l: "Ветви" },
                    ]).map(opt => (
                      <button key={opt.v}
                        onClick={() => setSearchScope(opt.v)}
                        className="flex-1 px-1 py-0.5 rounded text-[11px] border"
                        style={{
                          background: searchScope === opt.v ? "#2563eb" : "white",
                          color: searchScope === opt.v ? "white" : "#374151",
                          borderColor: searchScope === opt.v ? "#2563eb" : "#c8c8c8",
                        }}>
                        {opt.l}
                      </button>
                    ))}
                  </div>

                  {/* Статус */}
                  <div className="text-[10px] text-gray-500 mb-1.5 flex items-center justify-between">
                    <span>
                      {q.length === 0
                        ? "Начните вводить запрос"
                        : `Найдено: ${hits.length}${hits.length > maxShow ? ` (показано ${maxShow})` : ""}`}
                    </span>
                  </div>

                  {/* Результаты */}
                  <div className="flex flex-col gap-0.5">
                    {shown.map((h) => {
                      const isActive = (h.kind === "node" && selectedNodeId === h.id)
                        || (h.kind === "branch" && selectedBranchId === h.id);
                      return (
                        <button key={`${h.kind}-${h.id}`}
                          onClick={() => {
                            if (h.kind === "node") {
                              setSelectedNodeId(h.id);
                              setSelectedBranchId(null);
                              setFocusNodeId(h.id);
                              setFocusBranchId(null);
                            } else {
                              setSelectedBranchId(h.id);
                              setSelectedNodeId(null);
                              setFocusBranchId(h.id);
                              setFocusNodeId(null);
                            }
                            setFocusNonce(Date.now());
                          }}
                          className="flex items-start gap-2 px-2 py-1.5 rounded text-left transition-colors"
                          style={{
                            background: isActive ? "#dbeafe" : "transparent",
                            border: isActive ? "1px solid #2563eb" : "1px solid transparent",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#f3f4f6"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                          <Icon
                            name={h.kind === "node" ? "CircleDot" : "GitBranch"}
                            size={14}
                            className={h.kind === "node" ? "text-amber-700 mt-0.5" : "text-blue-700 mt-0.5"}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-800 truncate">{h.title}</div>
                            <div className="text-[10px] text-gray-500 truncate">{h.subtitle}</div>
                          </div>
                        </button>
                      );
                    })}
                    {q.length > 0 && hits.length === 0 && (
                      <div className="text-center text-gray-400 text-[11px] py-3">
                        Ничего не найдено
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}


            {/* ═══ ВКЛАДКА: ПАРАМЕТРЫ (узел) ════════════════════════════ */}
            {activeSide === "params" && selectedNode && (
              <NodePropsPanel
                node={selectedNode}
                onUpdate={(patch) => updateNode(selectedNode.id, patch)}
              />
            )}

            {/* ═══ ВКЛАДКА: ТРУБЫ — узел (ППЗ) ══════════════════════════ */}
            {activeSide === "waterpipes" && selectedNode && (
              <NodeFirePanel
                node={selectedNode}
                onUpdate={(patch) => updateNode(selectedNode.id, patch)}
                waterResult={waterNetwork.nodeResults.get(selectedNode.id)}
                allNodes={nodes}
                allNodeResults={waterNetwork.nodeResults}
              />
            )}

            {/* ═══ ВКЛАДКА: ПОЖАР (аварийный режим) ══════════════════════ */}
            {activeSide === "accidents" && !selectedNode && selectedBranch && (() => {
              const b = selectedBranch;
              const fr = fireResult?.branches.get(b.id);
              const fireSymId = schemaSymbols.find(s => FIRE_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
              const SH = "#fef2f2"; const SB = "1px solid #fecaca";
              const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
                <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                  <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>{label}</span>
                  <span className={`text-[11px] text-right flex-1 ${bold ? "font-bold text-red-700" : "text-gray-800"}`}>{value}</span>
                </div>
              );
              return (
                <div className="flex flex-col h-full overflow-y-auto" style={{ fontSize: 11 }}>
                  {/* Заголовок */}
                  <div className="flex items-center justify-between px-2 py-1" style={{ background: "#dc2626", color: "white" }}>
                    <span className="font-semibold text-[12px]">🔥 Очаг пожара — ветвь {b.id}</span>
                    {fireSymId && (
                      <button onClick={() => {
                        removeSymbol(fireSymId.id);
                        updateBranch(b.id, { hasFire: false, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0 });
                        setFireResult(null); setFireCalcDone(false);
                      }} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)" }}>
                        Убрать
                      </button>
                    )}
                  </div>

                  {/* Параметры очага */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "#991b1b" }}>Параметры очага пожара</div>

                  <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Задаётся:</span>
                    <select value={b.fireMode ?? "heat"} onChange={e => updateBranch(b.id, { fireMode: e.target.value as "heat" | "temp" })}
                      className="flex-1 text-[11px] px-1" style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }}>
                      <option value="heat">Мощностью (МВт)</option>
                      <option value="temp">Температурой (°C)</option>
                    </select>
                  </div>

                  {(b.fireMode ?? "heat") === "heat" && (
                    <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Мощность пожара, МВт:</span>
                      <input type="number" step="0.5" min="0.1" max="100"
                        value={b.fireHeatRelease ?? 5}
                        onChange={e => updateBranch(b.id, { fireHeatRelease: parseFloat(e.target.value) || 5 })}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                    </div>
                  )}
                  {(b.fireMode ?? "heat") === "temp" && (
                    <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Температура очага, °C:</span>
                      <input type="number" step="10" min="50" max="1200"
                        value={b.fireTemperature ?? 300}
                        onChange={e => updateBranch(b.id, { fireTemperature: parseFloat(e.target.value) || 300 })}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                    </div>
                  )}

                  <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Горючий материал:</span>
                    <select value={b.fireCombustible ?? "coal"} onChange={e => updateBranch(b.id, { fireCombustible: e.target.value })}
                      className="flex-1 text-[11px] px-1" style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }}>
                      {COMBUSTIBLES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* ── Техника: ввод масс материалов ── */}
                  {(b.fireCombustible ?? "coal") === "vehicle" && (() => {
                    const masses: [number, number, number] = [
                      b.fireVehicleMassRubber ?? 1200,
                      b.fireVehicleMassDiesel ?? 400,
                      b.fireVehicleMassOil    ?? 200,
                    ];
                    const airQ = Math.abs(b.flow ?? 0);
                    const vfr: VehicleFireResult = calcVehicleFire(masses, airQ);
                    return (
                      <>
                        {/* Заголовок блока ввода */}
                        <div className="px-1 py-0.5 text-[10px] font-semibold mt-0.5" style={{ background: "#fff7ed", borderBottom: "1px solid #fed7aa", color: "#c2410c" }}>
                          Исходные данные — состав техники
                        </div>

                        {/* Таблица ввода масс */}
                        <div className="px-1 pt-1 pb-0.5">
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                            <thead>
                              <tr style={{ background: "#f5f5f5" }}>
                                <th style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "left", fontWeight: 600 }}>Материал</th>
                                <th style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", fontWeight: 600 }}>Масса, кг</th>
                              </tr>
                            </thead>
                            <tbody>
                              {VEHICLE_MATERIALS.map((mat, i) => {
                                const fieldKey = (["fireVehicleMassRubber", "fireVehicleMassDiesel", "fireVehicleMassOil"] as const)[i];
                                const val = masses[i];
                                return (
                                  <tr key={mat.name} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                                    <td style={{ border: "1px solid #d1d5db", padding: "2px 4px" }}>{mat.name}</td>
                                    <td style={{ border: "1px solid #d1d5db", padding: "1px 2px" }}>
                                      <input
                                        type="number" min="0" step="50"
                                        value={val}
                                        onChange={e => updateBranch(b.id, { [fieldKey]: parseFloat(e.target.value) || 0 })}
                                        style={{ width: "100%", border: "none", outline: "none", textAlign: "right", fontSize: 10, background: val > 0 ? "#d1fae5" : "#fff", padding: "1px 3px" }}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Результаты расчёта мощности */}
                        {vfr.power_MW > 0 && (
                          <>
                            {/* Итоговые результаты */}
                            <div className="px-1 pb-0.5">
                              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                                <thead>
                                  <tr style={{ background: "#fef3c7" }}>
                                    <th style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>Мощность, МВт</th>
                                    <th style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>Расход, м³/с</th>
                                    <th style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>t прод., °C</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", fontWeight: 700, color: "#b91c1c" }}>{vfr.power_MW.toFixed(2)}</td>
                                    <td style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", color: "#15803d" }}>{airQ > 0 ? airQ.toFixed(1) : "—"}</td>
                                    <td style={{ border: "1px solid #d1d5db", padding: "2px 4px", textAlign: "center", fontWeight: 700 }}>{airQ > 0 ? (vfr.deltaT_C + 20).toFixed(1) : "—"}</td>
                                  </tr>
                                </tbody>
                              </table>
                              <div className="flex items-center gap-3 mt-0.5 px-0.5">
                                <span style={{ fontSize: 10, color: "#6b7280" }}>Время горения:</span>
                                <span style={{ fontSize: 10, fontWeight: 700 }}>{vfr.burnTime_h.toFixed(2)} ч</span>
                                <span style={{ fontSize: 10, color: "#6b7280" }}>или</span>
                                <span style={{ fontSize: 10, fontWeight: 700 }}>{vfr.burnTime_min.toFixed(1)} мин</span>
                              </div>
                            </div>
                            {/* Мощность автоматически подставляется в расчёт пожара при нажатии кнопки «Расчёт» */}
                          </>
                        )}
                      </>
                    );
                  })()}

                  {/* Контекст из сетевого расчёта */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "#991b1b" }}>Вентиляционный режим (из расчёта сети)</div>
                  <Row label="Расход воздуха Q, м³/с:" value={Math.abs(b.flow) > 0.001 ? `${Math.abs(b.flow).toFixed(2)}` : "— (не рассчитан)"} />
                  <Row label="Скорость воздуха, м/с:" value={b.velocity > 0 ? `${b.velocity.toFixed(2)}` : "—"} />
                  <Row label="Депрессия ветви ΔP, Па:" value={b.dP ? `${Math.abs(b.dP).toFixed(1)}` : "—"} />
                  <Row label="Угол наклона, °:" value={`${(b.angle ?? 0).toFixed(1)}`} />
                  <Row label="Длина ветви, м:" value={`${b.length.toFixed(1)}`} />
                  {Math.abs(b.flow) < 0.001 && (
                    <div className="px-2 py-1 mx-1 my-1 text-[10px] rounded" style={{ background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e" }}>
                      Сначала выполните расчёт вентиляционной сети (F9), затем запустите расчёт пожара
                    </div>
                  )}

                  {/* Результаты расчёта пожара */}
                  {fr && (
                    <>
                      <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "#991b1b" }}>Результаты расчёта пожара</div>
                      <Row label="Температура продуктов, °C:" value={`${fr.airTempOut.toFixed(1)}`} bold />
                      <Row label="Тепловая депрессия h_t, Па:" value={`${fr.thermalDepression.toFixed(1)}`} bold={Math.abs(fr.thermalDepression) > 10} />
                      {(fr.flowDelta ?? 0) !== 0 && (
                        <Row label="Изм. расхода ΔQ, м³/с:" value={`${fr.flowDelta! > 0 ? "+" : ""}${fr.flowDelta!.toFixed(2)}`} bold={Math.abs(fr.flowDelta!) > 1} />
                      )}
                      <Row label="Концентрация CO, %:" value={`${fr.coConc.toFixed(3)}`} bold={fr.coConc > 0.02} />
                      <Row label="Концентрация CO₂, %:" value={`${fr.co2Conc.toFixed(2)}`} bold={fr.co2Conc > 1} />
                      <Row label="Опт. плотность дыма, м⁻¹:" value={`${fr.smokeDensity.toFixed(2)}`} />
                      <Row label="Видимость в дыму, м:" value={`${fr.visibility.toFixed(1)}`} bold={fr.visibility < 5} />
                      {/* Время задымления */}
                      {(() => {
                        if (b.hasFire) {
                          return <Row label="Время задымления:" value="Очаг пожара (0 мин)" bold />;
                        }
                        const speed = fr.airSpeed ?? 0;
                        const arrT = fr.smokeArrivalTime;
                        const transitMin = speed > 0 && b.length > 0 ? b.length / speed / 60 : 0;
                        const fillT = Math.min(600, arrT + transitMin);
                        return (
                          <>
                            <Row
                              label="Дым входит через:"
                              value={arrT === 0 ? "сразу" : `${arrT.toFixed(1)} мин`}
                              bold={arrT < 5}
                            />
                            <Row
                              label="Ветвь заполнится через:"
                              value={speed > 0 ? `${fillT.toFixed(1)} мин` : "—"}
                              bold={fillT < 10}
                            />
                            <Row
                              label="Скорость воздуха, м/с:"
                              value={speed > 0 ? speed.toFixed(2) : "—"}
                            />
                          </>
                        );
                      })()}
                      <div className="flex items-center px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Устойчивость струи:</span>
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{
                          background: fr.actuallyReversed ? "#450a0a" : fr.willReverse ? "#fef2f2" : "#f0fdf4",
                          color: fr.actuallyReversed ? "#fef2f2" : fr.willReverse ? "#dc2626" : "#16a34a",
                          border: `1px solid ${fr.actuallyReversed ? "#7f1d1d" : fr.willReverse ? "#fca5a5" : "#86efac"}`,
                        }}>
                          {fr.actuallyReversed ? "🔄 Опрокинута" : fr.willReverse ? "⚠️ Риск опрокидывания" : "✓ Устойчива"}
                        </span>
                      </div>
                      <div className="flex items-center px-1 py-1" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Опасность для людей:</span>
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{
                          background: fr.hazardLevel === "lethal" ? "#7f1d1d" : fr.hazardLevel === "danger" ? "#dc2626" : fr.hazardLevel === "warning" ? "#f59e0b" : "#16a34a",
                          color: "white",
                        }}>
                          {fr.hazardLevel === "lethal" ? "💀 Смертельная" : fr.hazardLevel === "danger" ? "🔴 Опасная" : fr.hazardLevel === "warning" ? "⚠️ Предупреждение" : "✅ Безопасно"}
                        </span>
                      </div>
                      {fr.actuallyReversed && (
                        <div className="px-2 py-2 mx-1 my-1 text-[11px] rounded" style={{ background: "#450a0a", border: "1px solid #7f1d1d", color: "#fecaca" }}>
                          <div className="font-bold mb-1" style={{ color: "#fca5a5", fontSize: 12 }}>🔄 Опрокидывание подтверждено расчётом</div>
                          <div style={{ lineHeight: 1.6 }}>
                            Поток изменил направление: Q = <strong>{(b.flow ?? 0).toFixed(2)} м³/с</strong><br/>
                            Тепловая депрессия пожара: <strong>{Math.abs(fr.thermalDepression).toFixed(0)} Па</strong><br/>
                            Нисходящее проветривание опрокинуто — продукты горения распространяются в обратном направлении.
                          </div>
                        </div>
                      )}
                      {!fr.actuallyReversed && fr.willReverse && (
                        <div className="px-2 py-2 mx-1 my-1 text-[10px] rounded" style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626" }}>
                          <strong>Риск опрокидывания!</strong> Тепловая депрессия пожара ({Math.abs(fr.thermalDepression).toFixed(0)} Па) близка к аэродинамической депрессии ветви. При увеличении мощности пожара возможна смена направления потока.
                        </div>
                      )}
                    </>
                  )}
                  {!fr && fireCalcDone && (() => {
                    // Показываем потенциальное время задымления для незатронутых ветвей
                    const airQ = Math.abs(b.flow ?? 0);
                    const speed = airQ > 0 && b.area > 0 ? airQ / b.area : 0;
                    return (
                      <div style={{ margin: 4 }}>
                        <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 3, color: "#15803d" }}>
                          ✅ Ветвь не затронута задымлением
                        </div>
                        {speed > 0 && b.length > 0 && (
                          <div className="mt-1 px-2 py-1.5 text-[10px]" style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 3, color: "#475569" }}>
                            <div className="font-semibold mb-0.5 text-[11px]">Справочно (если дым войдёт):</div>
                            <div className="flex justify-between">
                              <span>Скорость воздуха:</span>
                              <span className="font-medium">{speed.toFixed(2)} м/с</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Время заполнения:</span>
                              <span className="font-medium">{(b.length / speed / 60).toFixed(1)} мин</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {!fireCalcDone && (
                    <div className="px-2 py-2 text-[11px] text-orange-700" style={{ background: "#fffbeb", border: "1px solid #fcd34d", margin: 4, borderRadius: 4 }}>
                      Нажмите «Расчёт пожара» на вкладке Аварии для получения результатов
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ═══ ВКЛАДКА: ВЗРЫВ (аварийный режим) ════════════════════════ */}
            {activeSide === "blast" && !selectedNode && selectedBranch && (() => {
              const b = selectedBranch;
              const expSymId = schemaSymbols.find(s => EXPLOSION_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
              const SH = "#fffbeb"; const SB = "1px solid #fde68a";
              const Row = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => (
                <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <span className="text-[11px] text-gray-500 flex-shrink-0" style={{ width: 148 }}>{label}</span>
                  <span className={`text-[11px] text-right flex-1 ${bold ? "font-bold" : ""}`} style={{ color: color ?? (bold ? "#b45309" : "#1f2937") }}>{value}</span>
                </div>
              );
              return (
                <div className="flex flex-col h-full overflow-y-auto" style={{ fontSize: 11 }}>

                  {/* Заголовок */}
                  <div className="flex items-center justify-between px-2 py-1.5" style={{ background: "#f59e0b", color: "white" }}>
                    <span className="font-semibold text-[12px]">💥 Источник взрыва — ветвь {b.id}</span>
                    {expSymId && (
                      <button onClick={() => {
                        removeSymbol(expSymId.id);
                        updateBranch(b.id, { hasExplosion: false, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0 });
                        setExplosionResult(null); setExplosionCalcDone(false);
                      }} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)" }}>
                        Убрать
                      </button>
                    )}
                  </div>

                  {/* Методика */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "#92400e" }}>Алгоритм расчёта</div>
                  <div className="flex flex-col gap-0.5 px-2 py-1.5" style={{ borderBottom: SB }}>
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input type="radio" name={`expl_method_${b.id}`} value="gas_dynamics"
                        checked={(b.explosionMethod ?? "gas_dynamics") === "gas_dynamics"}
                        onChange={() => updateBranch(b.id, { explosionMethod: "gas_dynamics" })}
                        className="mt-0.5 flex-shrink-0" />
                      <span className="text-[10px] text-gray-700 leading-tight">Методика газодинамического расчёта параметров воздушных ударных волн при взрывах газа и пыли</span>
                    </label>
                    <label className="flex items-start gap-1.5 cursor-pointer">
                      <input type="radio" name={`expl_method_${b.id}`} value="fnip_494"
                        checked={(b.explosionMethod ?? "gas_dynamics") === "fnip_494"}
                        onChange={() => updateBranch(b.id, { explosionMethod: "fnip_494" })}
                        className="mt-0.5 flex-shrink-0" />
                      <span className="text-[10px] text-gray-700 leading-tight">ФНиП №494 (Правила безопасности при производстве, хранении и применении ВМ)</span>
                    </label>
                  </div>

                  {/* Настройки */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "#92400e" }}>Настройки</div>
                  <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <input type="checkbox" id={`exp_walls_${b.id}`}
                      checked={b.explosionConsiderWalls ?? true}
                      onChange={e => updateBranch(b.id, { explosionConsiderWalls: e.target.checked })} />
                    <label htmlFor={`exp_walls_${b.id}`} className="text-[11px] text-gray-700 cursor-pointer">Учитывать отражение от стенок выработки</label>
                  </div>

                  {/* Способ задания */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "#92400e" }}>Задание энергии взрыва</div>
                  <div className="flex items-center px-2 py-1" style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Способ:</span>
                    <select value={b.explosionSourceType ?? "gas"}
                      onChange={e => updateBranch(b.id, { explosionSourceType: e.target.value as ExplosionSourceType })}
                      className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid #d1d5db", height: 20, background: "white" }}>
                      <option value="gas">По газу</option>
                      <option value="mass">По массе вещества</option>
                    </select>
                  </div>

                  {/* По газу */}
                  {(b.explosionSourceType ?? "gas") === "gas" && (<>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Горючий газ:</span>
                      <select value={b.explosionGasId ?? "methane"}
                        onChange={e => updateBranch(b.id, { explosionGasId: e.target.value })}
                        className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid #d1d5db", height: 20, background: "white" }}>
                        {GAS_TYPES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Объём смеси, м³:</span>
                      <input type="number" step="10" min="1"
                        value={b.explosionGasVolume ?? 100}
                        onChange={e => updateBranch(b.id, { explosionGasVolume: parseFloat(e.target.value) || 100 })}
                        className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid #d1d5db", height: 20, background: "white" }} />
                    </div>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Концентрация, %:</span>
                      <input type="number" step="0.5" min="0" max="100"
                        value={b.explosionGasConcentration ?? 9.5}
                        onChange={e => updateBranch(b.id, { explosionGasConcentration: parseFloat(e.target.value) || 9.5 })}
                        className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid #d1d5db", height: 20, background: "white" }} />
                    </div>
                    {(() => {
                      const gas = GAS_TYPES.find(g => g.id === (b.explosionGasId ?? "methane"));
                      if (!gas) return null;
                      const conc = b.explosionGasConcentration ?? 9.5;
                      const inRange = conc >= gas.lowerLimit && conc <= gas.upperLimit;
                      return (
                        <div className="mx-2 my-1 px-2 py-1 rounded text-[10px]" style={{ background: inRange ? "#f0fdf4" : "#fef9c3", border: `1px solid ${inRange ? "#bbf7d0" : "#fde047"}`, color: inRange ? "#166534" : "#713f12" }}>
                          НПВ: {gas.lowerLimit}% · ВПВ: {gas.upperLimit}% · Стехиом.: {gas.stoichConc}%
                          {!inRange && " ⚠ Концентрация вне диапазона взрываемости"}
                        </div>
                      );
                    })()}
                  </>)}

                  {/* По массе */}
                  {(b.explosionSourceType ?? "gas") === "mass" && (<>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Взрывчатое вещество:</span>
                      <select value={b.explosionExplosiveId ?? "ammonit"}
                        onChange={e => updateBranch(b.id, { explosionExplosiveId: e.target.value })}
                        className="flex-1 text-[11px] px-1 rounded" style={{ border: "1px solid #d1d5db", height: 20, background: "white" }}>
                        {EXPLOSIVE_TYPES.map(ex => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>Масса ВВ, кг:</span>
                      <input type="number" step="1" min="0.1"
                        value={b.explosionExplosiveMass ?? 10}
                        onChange={e => updateBranch(b.id, { explosionExplosiveMass: parseFloat(e.target.value) || 10 })}
                        className="flex-1 text-[11px] text-right px-1 rounded" style={{ border: "1px solid #d1d5db", height: 20, background: "white" }} />
                    </div>
                    {(() => {
                      const expl = EXPLOSIVE_TYPES.find(ex => ex.id === (b.explosionExplosiveId ?? "ammonit"));
                      if (!expl) return null;
                      return (
                        <div className="mx-2 my-1 px-2 py-1 rounded text-[10px]" style={{ background: "#fef9c3", border: "1px solid #fde047", color: "#713f12" }}>
                          k_тнт = {expl.tntEq} · Q_уд = {expl.qSpec} кДж/кг
                        </div>
                      );
                    })()}
                  </>)}

                  {/* Результаты */}
                  {explosionCalcDone && b.explosionComputedQtnt > 0 && (<>
                    <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: SH, borderBottom: SB, color: "#92400e" }}>Результаты расчёта</div>
                    <Row label="Тротиловый эквивалент:" value={`${b.explosionComputedQtnt} кг ТНТ`} bold />
                    <Row label="Давление в эпицентре:" value={`${b.explosionComputedMaxP} кПа`} bold color="#dc2626" />
                    <Row label="Скорость фронта волны:" value={`${b.explosionComputedWaveSpeed} м/с`} />
                    <div className="px-1 py-0.5 text-[10px] font-semibold" style={{ background: SH, borderBottom: SB, color: "#92400e", marginTop: 4 }}>Зоны поражения</div>
                    {[
                      { label: "💀 Летальная (>100 кПа):", r: b.explosionComputedR_lethal, color: "#7c1010" },
                      { label: "🔴 Тяжёлые (>50 кПа):",   r: b.explosionComputedR_heavy,  color: "#dc2626" },
                      { label: "🟠 Средние (>30 кПа):",    r: b.explosionComputedR_medium, color: "#f97316" },
                      { label: "🟡 Лёгкие (>10 кПа):",     r: b.explosionComputedR_light,  color: "#ca8a04" },
                    ].map(({ label, r, color }) => (
                      <div key={label} className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #f3f4f6" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 148 }}>{label}</span>
                        <span className="text-[11px] font-bold text-right flex-1" style={{ color }}>{r > 0 ? `${r} м` : "—"}</span>
                      </div>
                    ))}
                    {explosionResult?.warnings && explosionResult.warnings.length > 0 && (
                      <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px]" style={{ background: "#fef9c3", border: "1px solid #fde047", color: "#713f12" }}>
                        {explosionResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                      </div>
                    )}
                  </>)}

                  {/* Разрушенные перемычки */}
                  {explosionCalcDone && (() => {
                    const destroyedBranches = branches.filter(br =>
                      br.bulkheadDestroyedByExplosion && br.hasBulkhead
                    );
                    if (destroyedBranches.length === 0) return null;
                    return (<>
                      <div className="px-1 py-0.5 text-[10px] font-semibold mt-1" style={{ background: "#fee2e2", borderBottom: "1px solid #fca5a5", color: "#991b1b" }}>
                        ⚡ Разрушенные перемычки ({destroyedBranches.length})
                      </div>
                      {destroyedBranches.map(br => {
                        const bkSym = schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === br.id);
                        const fp = bkSym?.bkFailurePressure ?? br.bulkheadFailurePressure;
                        const name = (bkSym?.bkBulkheadName ?? br.bulkheadName) || br.id;
                        return (
                          <div key={br.id} className="flex items-center px-2 py-0.5" style={{ borderBottom: "1px solid #f3f4f6", background: "#fff5f5" }}>
                            <span className="text-[10px] mr-1">🔴</span>
                            <span className="text-[11px] text-gray-700 flex-1 truncate">{name}</span>
                            {fp > 0 && (
                              <span className="text-[10px] text-red-600 ml-1 flex-shrink-0">{fp} МПа</span>
                            )}
                          </div>
                        );
                      })}
                      <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px]" style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b" }}>
                        Разрушенные перемычки окрашены красным и отмечены «РАЗР.» на схеме. Пересчитайте сеть (F9).
                      </div>
                    </>);
                  })()}

                  {/* Легенда обозначений перемычек */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold mt-2" style={{ background: "#f5f5f5", borderBottom: "1px solid #e0e0e0", color: "#374151" }}>
                    Обозначения на схеме
                  </div>
                  <div className="px-2 py-1.5 text-[10px] space-y-1" style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <div className="flex items-center gap-2">
                      <svg width="22" height="18" viewBox="-11 -9 22 18">
                        <rect x="-3" y="-7" width="6" height="14" fill="white" stroke="#1a1a1a" strokeWidth="1" />
                      </svg>
                      <span style={{ color: "#374151" }}>Перемычка — цела</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="22" height="18" viewBox="-11 -9 22 18">
                        <rect x="-3" y="-7" width="6" height="14" fill="#ff4444" stroke="#8b0000" strokeWidth="1" />
                      </svg>
                      <span style={{ color: "#dc2626", fontWeight: 600 }}>Перемычка — разрушена</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <svg width="22" height="18" viewBox="-11 -9 22 18">
                        <circle cx="0" cy="0" r="7" fill="#fef08a" stroke="#dc2626" strokeWidth="1.5" />
                        <polyline points="-6,0 -3,-2.5 0,2.5 3,-2.5 6,0" fill="none" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span style={{ color: "#7f1d1d" }}>Маркер разрушения + давление разрушения (МПа)</span>
                    </div>
                  </div>

                  {!explosionCalcDone && (
                    <div className="mx-2 my-2 px-2 py-2 text-[11px] rounded" style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
                      Нажмите «Расчёт взрыва» на вкладке Аварии для получения результатов
                    </div>
                  )}
                </div>
              );
            })()}

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
                onReverse={selectedBranch.hasFan ? () => handleReverseBranch(selectedBranch.id) : undefined}
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
                onUpdateBulkheadSym={(patch) => {
                  setSchemaSymbols(prev => prev.map(s =>
                    BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id
                      ? { ...s, ...patch }
                      : s
                  ));
                }}
                unitsConfig={unitsConfig}
                nodes={nodes}
                waterBranchResult={waterNetwork.branchResults.get(selectedBranch.id)}
                onRemoveReducer={selectedBranch.wpHasReducer ? () => {
                  const sym = schemaSymbols.find(s => REDUCER_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                  updateBranch(selectedBranch.id, {
                    wpHasReducer: false,
                    wpReducerModel: "kppr_50",
                    wpReducerOutPressure: 0.5,
                    wpReducerMaxFlow: 25,
                  });
                } : undefined}
              />
            )}



            {/* ═══ Панель выделенного условного обозначения ══════════════ */}
            {activeSide === "params" && !selectedNode && !selectedBranch && selectedSymbolId && (() => {
              const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
              if (!sym) return null;
              const isBulkheadSym = BULKHEAD_SYMBOL_IDS.has(sym.typeId);
              const isWindowBulkhead = WINDOW_BULKHEAD_IDS.has(sym.typeId);
              const brForSym = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
              // ΔP перемычки = R_sym × Q × |Q| (не dP всей ветви, а только вклад этого символа)
              const symDeltaP = (() => {
                if (!brForSym) return null;
                const q = brForSym.flow ?? 0;
                const mode = sym.bkResMode ?? "project";
                if (mode === "manual") {
                  const rNsm8 = (sym.bkManualR ?? 0) * 1e3; // кМюрг → Н·с²/м⁸ (аналогично networkSolver)
                  return rNsm8 * q * Math.abs(q);
                }
                if (mode === "survey") {
                  const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                  const rNsm8 = sq > 0 ? dp / (sq * sq) : 0;
                  return rNsm8 * q * Math.abs(q);
                }
                // project
                const sw = sym.bkWindowArea ?? 0;
                const branchArea = brForSym.area ?? 0;
                const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                  || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                if (isFullyOpen) return 0;
                let rNsm8 = 0;
                if (sw > 0.001) {
                  const fnFrom2 = nodes.find(n => n.id === brForSym.fromId);
                  const fnTo2   = nodes.find(n => n.id === brForSym.toId);
                  const tF2 = fnFrom2 ? (fnFrom2.atmosphereLink ? surfaceTemp : (fnFrom2.airTemp ?? surfaceTemp)) : surfaceTemp;
                  const tT2 = fnTo2   ? (fnTo2.atmosphereLink   ? surfaceTemp : (fnTo2.airTemp   ?? surfaceTemp)) : surfaceTemp;
                  const rho2 = 353.0 / (273.0 + Math.max(-30, Math.min(100, (tF2 + tT2) / 2)));
                  const mu = 0.65;
                  rNsm8 = rho2 / (2 * mu * mu * sw * sw);
                } else {
                  const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0)
                    : (sym.bkAirPerm
                      ?? (sym.bkBulkheadId ? mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.airPermeability : undefined)
                      ?? brForSym.bulkheadAirPerm ?? 0);
                  const rRefSym = sym.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.rMkyurg ?? 0) : 0;
                  if (kAir > 0) {
                    rNsm8 = 1 / (kAir * kAir); // уже Н·с²/м⁸
                  } else if ((sym.bkBulkheadR ?? rRefSym) > 0) {
                    rNsm8 = (sym.bkBulkheadR ?? rRefSym) * 9.81; // кМюрг → Н·с²/м⁸
                  } else {
                    rNsm8 = (brForSym.bulkheadR ?? 0) * 9.81e-3; // Мюрг → Н·с²/м⁸
                  }
                }
                return rNsm8 * q * Math.abs(q);
              })();
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
                              // ΔP/Q² → Па/(м³/с)² = Па·с²/м⁶ = Мюрг → /1000 = кМюрг
                              const q = sym.bkSurveyQ ?? 0;
                              const dp = sym.bkSurveyDP ?? 0;
                              const rMkyurg = q > 0 ? dp / (q * q) : 0;
                              rKmu = rMkyurg / 1000; // Мюрг → кМюрг
                            } else {
                              const sw = sym.bkWindowArea ?? 0;
                              const branchArea = brForSym?.area ?? 0;
                              const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                                || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                              if (isFullyOpen) {
                                rKmu = 0;
                              } else if (sw > 0.001) {
                                // ρ/(2μ²S²) → кг·с²/м⁷ = Н·с²/м⁸; /9.81e-3 → кМюрг
                                const mu = 0.65;
                                const rNsm8w = rho / (2 * mu * mu * sw * sw);
                                rKmu = rNsm8w / 9.81e-3; // Н·с²/м⁸ → кМюрг
                              } else {
                                const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0)
                                  : (sym.bkAirPerm
                                    ?? (sym.bkBulkheadId ? mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.airPermeability : undefined)
                                    ?? brForSym?.bulkheadAirPerm ?? 0);
                                if (kAir > 0) {
                                  // 1/A² → Мюрг → /1000 → кМюрг
                                  rKmu = (1 / (kAir * kAir)) / 1000;
                                } else {
                                  // rMin/rMax в каталоге хранятся в Мюрг → /1000 = кМюрг
                                  const rRefMkyurg = sym.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.rMin ?? 0) : 0;
                                  rKmu = sym.bkBulkheadR ?? (rRefMkyurg > 0 ? rRefMkyurg / 1000 : (brForSym?.bulkheadR ?? 0) / 1000);
                                }
                              }
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
                              {/* Тип перемычки из справочника */}
                              {mineBulkheads.length > 0 && (
                                <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                                  <span className="text-gray-500 flex-shrink-0" style={{ width: 72 }}>Тип:</span>
                                  <select
                                    value={sym.bkBulkheadId ?? brForSym?.bulkheadId ?? ""}
                                    onChange={e => {
                                      const sel = mineBulkheads.find(b => b.id === e.target.value);
                                      updSym({
                                        bkBulkheadId: e.target.value || undefined,
                                        bkBulkheadName: sel?.name ?? undefined,
                                        bkAirPerm: sel?.airPermeability ?? 0,
                                        bkBulkheadR: sel?.rMkyurg ?? 0,
                                        bkFailurePressure: sel?.failurePressure ?? 0,
                                      });
                                      // Синхронизируем failurePressure и name в ветвь
                                      if (sym.branchId) {
                                        updateBranch(sym.branchId, {
                                          bulkheadFailurePressure: sel?.failurePressure ?? 0,
                                          bulkheadName: sel?.name ?? "",
                                        });
                                      }
                                    }}
                                    className="flex-1 text-[11px] px-1"
                                    style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }}>
                                    <option value="">— не выбрано —</option>
                                    {mineBulkheads.map(b => (
                                      <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
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
                                    {(() => {
                                      const ap = sym.bkAirPerm
                                        ?? (sym.bkBulkheadId ? mineBulkheads.find(b => b.id === sym.bkBulkheadId)?.airPermeability : undefined)
                                        ?? brForSym?.bulkheadAirPerm;
                                      return ap ? `${ap.toFixed(4)} м²/(с·√Па)` : "—";
                                    })()}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                          <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                            <span className="text-gray-500 flex-shrink-0 font-semibold" style={{ width: 72 }}>ΔP:</span>
                            <span className="flex-1 text-right font-semibold" style={{ color: "#1a3a6b" }}>
                              {symDeltaP != null ? `${Math.round(symDeltaP)} Па` : "— Па"}
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
                              {symDeltaP != null ? `${Math.round(symDeltaP)} Па` : "— Па"}
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
                              {symDeltaP != null ? `${Math.round(symDeltaP)} Па` : "— Па"}
                            </span>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {/* Направление (вентилятор) */}
                  {sym.typeId === "fan" && (
                    <>
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
                      <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                        <input type="checkbox"
                          checked={sym.showFanArrow ?? true}
                          onChange={(e) => updSym({ showFanArrow: e.target.checked })}
                          style={{ width: 13, height: 13, accentColor: "#2563eb" }} />
                        <span className="text-gray-700">Показывать стрелку направления</span>
                      </label>
                    </>
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

                      {/* Настройки текста индикаторов */}
                      {(sym.indDescription || sym.indResistance || sym.indDeltaP || sym.indLeakage) && (
                        <div className="mt-2">
                          <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                            Настройки
                          </div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <span className="text-gray-500 w-20 flex-shrink-0">Размер</span>
                            <input type="number" min={1} max={50} step={0.5}
                              value={sym.indFontSize ?? 9}
                              onChange={(e) => updSym({ indFontSize: Math.max(1, Math.min(50, Number(e.target.value) || 9)) })}
                              className="w-16 border border-gray-300 rounded px-1 text-right"
                              style={{ fontSize: 11 }} />
                            <span className="text-gray-400">м</span>
                          </div>
                        </div>
                      )}

                      {/* Значения для справки */}
                      {brForSym && (sym.indResistance || sym.indDeltaP || sym.indLeakage) && (() => {
                        // Вычисляем R в кМюрг из sym.bk* (те же данные что в панели настройки)
                        // Соглашение: 1 кМюрг = 9.81 Н·с²/м⁸, 1 Мюрг = 9.81e-3 Н·с²/м⁸
                        const mode = sym.bkResMode ?? "project";
                        let rMkyurg = 0;
                        if (mode === "manual") {
                          rMkyurg = sym.bkManualR ?? 0; // уже в кМюрг
                        } else if (mode === "survey") {
                          const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                          // ΔP/Q² = Мюрг → /1000 = кМюрг
                          rMkyurg = (sq > 0 ? dp / (sq * sq) : 0) / 1000;
                        } else {
                          const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0) : (sym.bkAirPerm ?? 0);
                          if (kAir > 0) {
                            // 1/A² = Мюрг → /1000 = кМюрг
                            rMkyurg = (1 / (kAir * kAir)) / 1000;
                          } else {
                            rMkyurg = (sym.bkBulkheadR ?? brForSym.bulkheadR ?? 0) / 1000; // Мюрг → кМюрг
                          }
                        }
                        if (rMkyurg === 0 && brForSym.bulkheadR > 0) rMkyurg = brForSym.bulkheadR / 1000;
                        return (
                          <div className="mt-2 p-1.5 rounded text-[10px] space-y-0.5"
                            style={{ background: "#f0f4ff", border: "1px solid #c8d8f0" }}>
                            {sym.indResistance && (
                              <div className="text-gray-600">
                                <span className="text-gray-400">R перемычки: </span>
                                {rMkyurg > 0 ? `${rMkyurg.toFixed(4)} кМюрг` : "—"}
                              </div>
                            )}
                            {sym.indDeltaP && (
                              <div className="text-gray-600">
                                <span className="text-gray-400">ΔP: </span>
                                {brForSym.dP !== 0 ? `${Math.abs(brForSym.dP).toFixed(1)} Па` : "—"}
                              </div>
                            )}
                            {sym.indLeakage && (
                              <div className="text-gray-600">
                                <span className="text-gray-400">Q через перемычку: </span>
                                {brForSym.flow !== 0 ? `${Math.abs(brForSym.flow).toFixed(2)} м³/с` : "—"}
                              </div>
                            )}
                          </div>
                        );
                      })()}
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
                    <input type="text"
                      value={selectedBranch ? selectedBranch.id : (selectedNode ? (selectedNode.number || selectedNode.id) : excavation.number)}
                      onChange={(e) => {
                        if (selectedBranch) {
                          // Переименование ветви: пересвязываем все ссылки
                          const newId = e.target.value;
                          if (!newId || newId === selectedBranch.id) return;
                          setBranches((prev) => prev.map((b) =>
                            b.id === selectedBranch.id ? { ...b, id: newId } : b
                          ));
                          setSchemaSymbols((prev) => prev.map((s) =>
                            s.branchId === selectedBranch.id ? { ...s, branchId: newId } : s
                          ));
                          setSelectedBranchId(newId);
                          setIsDirty(true);
                        } else if (selectedNode) {
                          updateNode(selectedNode.id, { number: e.target.value });
                        } else {
                          setExcavation({ ...excavation, number: e.target.value });
                        }
                      }}
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
                  <FrameGroup title="Поворот индикаторов">
                    <div className="text-[10px] text-gray-500 px-1 pb-1">
                      Угол поворота блока меток на схеме (°)
                    </div>
                    <div className="flex items-center gap-2 px-1">
                      <input
                        type="range" min={-180} max={180} step={5}
                        value={selectedBranch.labelAngle ?? 0}
                        onChange={(e) => updateBranch(selectedBranch.id, { labelAngle: Number(e.target.value) })}
                        className="flex-1"
                        style={{ accentColor: "#2563eb" }}
                      />
                      <input
                        type="number" min={-180} max={180} step={1}
                        value={selectedBranch.labelAngle ?? 0}
                        onChange={(e) => updateBranch(selectedBranch.id, { labelAngle: Number(e.target.value) || 0 })}
                        className="text-[11px] text-right px-1"
                        style={{ width: 46, border: "1px solid #c8c8c8", height: 20, outline: "none", background: "white" }}
                      />
                      <span className="text-[11px] text-gray-500">°</span>
                      <button
                        onClick={() => updateBranch(selectedBranch.id, { labelAngle: 0 })}
                        className="text-[10px] px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-gray-500"
                        title="Сбросить поворот">↺</button>
                    </div>
                    <div className="flex gap-1 px-1 pt-1">
                      {[-90, -45, 0, 45, 90].map(a => (
                        <button key={a}
                          onClick={() => updateBranch(selectedBranch.id, { labelAngle: a })}
                          className="flex-1 text-[10px] py-0.5 border rounded hover:bg-blue-50 hover:border-blue-400"
                          style={{
                            borderColor: (selectedBranch.labelAngle ?? 0) === a ? "#2563eb" : "#d1d5db",
                            color: (selectedBranch.labelAngle ?? 0) === a ? "#2563eb" : "#374151",
                            background: (selectedBranch.labelAngle ?? 0) === a ? "#eff6ff" : "white",
                          }}>
                          {a}°
                        </button>
                      ))}
                    </div>
                  </FrameGroup>
                )}

                {selectedBranch && (
                  <FrameGroup title="Размер индикаторов">
                    <div className="text-[10px] text-gray-500 px-1 pb-1">
                      Множитель размера текста на схеме (1.0 = авто)
                    </div>
                    <div className="flex items-center gap-2 px-1">
                      <input
                        type="range" min={0.3} max={4} step={0.1}
                        value={selectedBranch.labelSize ?? 1}
                        onChange={(e) => updateBranch(selectedBranch.id, { labelSize: Number(e.target.value) })}
                        className="flex-1"
                        style={{ accentColor: "#2563eb" }}
                      />
                      <input
                        type="number" min={0.3} max={4} step={0.1}
                        value={selectedBranch.labelSize ?? 1}
                        onChange={(e) => updateBranch(selectedBranch.id, { labelSize: Math.max(0.3, Math.min(4, Number(e.target.value) || 1)) })}
                        className="text-[11px] text-right px-1"
                        style={{ width: 46, border: "1px solid #c8c8c8", height: 20, outline: "none", background: "white" }}
                      />
                      <button
                        onClick={() => updateBranch(selectedBranch.id, { labelSize: undefined })}
                        className="text-[10px] px-1.5 py-0.5 border border-gray-300 rounded hover:bg-gray-100 text-gray-500"
                        title="Сбросить к авто">↺</button>
                    </div>
                    <div className="flex gap-1 px-1 pt-1">
                      {[0.5, 0.75, 1, 1.5, 2].map(s => (
                        <button key={s}
                          onClick={() => updateBranch(selectedBranch.id, { labelSize: s === 1 ? undefined : s })}
                          className="flex-1 text-[10px] py-0.5 border rounded hover:bg-blue-50 hover:border-blue-400"
                          style={{
                            borderColor: (selectedBranch.labelSize ?? 1) === s ? "#2563eb" : "#d1d5db",
                            color: (selectedBranch.labelSize ?? 1) === s ? "#2563eb" : "#374151",
                            background: (selectedBranch.labelSize ?? 1) === s ? "#eff6ff" : "white",
                          }}>
                          ×{s}
                        </button>
                      ))}
                    </div>
                  </FrameGroup>
                )}

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
                  <div className="flex gap-1 mb-2">
                    <button onClick={addHorizon}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-blue-50 hover:border-blue-400 flex items-center justify-center gap-1">
                      <Icon name="Plus" size={11} /> Добавить
                    </button>
                    <button onClick={() => setHorizons((p) => p.map((h) => ({ ...h, visible: true })))}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-blue-50">
                      Показать все
                    </button>
                    <button onClick={() => setHorizons((p) => p.map((h) => ({ ...h, visible: false })))}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-blue-50">
                      Скрыть все
                    </button>
                  </div>
                  <div className="space-y-1">
                    {horizons.map((h, hIdx) => {
                      const usedCount = branches.filter((b) => b.horizonId === h.id).length;
                      const isActive = activeHorizonId === h.id;
                      const isOverview = h.id === OVERVIEW_HORIZON_ID;
                      const isDragOver = horizonDragOverIdx === hIdx;
                      return (
                        <div key={h.id}
                          draggable
                          onDragStart={() => handleHorizonDragStart(hIdx)}
                          onDragOver={(e) => handleHorizonDragOver(e, hIdx)}
                          onDrop={() => handleHorizonDrop(hIdx)}
                          onDragEnd={() => { setHorizonDragIdx(null); setHorizonDragOverIdx(null); }}
                          className="border rounded"
                          style={{
                            background: isActive ? "#eff6ff" : "white",
                            borderColor: isDragOver ? "#2563eb" : isActive ? "#3b82f6" : "#d1d5db",
                            opacity: horizonDragIdx === hIdx ? 0.5 : 1,
                            outline: isDragOver ? "2px solid #93c5fd" : undefined,
                          }}>
                          {/* ── Строка горизонта ── */}
                          <div className="flex items-center gap-1 px-1 py-1">
                            {/* Drag-handle */}
                            <span title="Перетащить для изменения порядка"
                              className="cursor-grab text-gray-300 hover:text-gray-500 flex-shrink-0 select-none"
                              style={{ fontSize: 12, lineHeight: 1 }}>⠿</span>
                            {!isOverview && <input type="radio" name="active-horizon"
                              checked={isActive}
                              onChange={() => setActiveHorizonId(h.id)}
                              title="Сделать активным для построения"
                              className="w-[13px] h-[13px] cursor-pointer flex-shrink-0" />}
                            {isOverview && <span className="w-[13px] flex-shrink-0" />}
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
                            {!isOverview && <input type="number" value={h.z}
                              onChange={(e) => updateHorizon(h.id, { z: Number(e.target.value) })}
                              className="cad-input w-16 text-right"
                              title="Высотная отметка, м" />}
                            {!isOverview && <span className="text-[10px] text-gray-500 flex-shrink-0">м</span>}
                            {isOverview && <span className="text-[10px] text-purple-500 flex-shrink-0 px-1" title="Общий вид — авто-bounds по всей схеме">авто</span>}
                            <span className="text-[10px] text-gray-400 w-7 text-center" title="Ветвей на горизонте">
                              {usedCount}
                            </span>
                            {!isOverview && (
                              <button onClick={() => removeHorizon(h.id)}
                                className="w-5 h-5 flex items-center justify-center hover:bg-red-100 rounded flex-shrink-0"
                                title="Удалить горизонт">
                                <Icon name="Trash2" size={11} className="text-gray-600" />
                              </button>
                            )}
                            {isOverview && <span className="w-5 flex-shrink-0" />}
                          </div>
                          {/* ── Кнопка раскрытия настроек ── */}
                          <button
                            onClick={() => toggleHorizonExpand(h.id)}
                            className="w-full flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                            style={{ borderTop: "1px solid #e5e7eb" }}>
                            <Icon name={expandedHorizons.has(h.id) ? "ChevronUp" : "ChevronDown"} size={10} className="flex-shrink-0" />
                            <span>{expandedHorizons.has(h.id) ? "Скрыть настройки" : "Настройки (план, печать)"}</span>
                            {h.image && !expandedHorizons.has(h.id) && (
                              <span className="ml-auto text-blue-400" title="Загружен план">●</span>
                            )}
                            {h.printLayer?.visible && !expandedHorizons.has(h.id) && (
                              <span className="ml-1 text-purple-400" title="Слой печати активен">●</span>
                            )}
                          </button>
                          {/* ── Настройки горизонта (подложка + слой печати) ── */}
                          {expandedHorizons.has(h.id) && (
                          <div className="px-1 pb-1 pt-0">
                            {/* Подложка плана — только для обычных горизонтов */}
                            {h.id !== OVERVIEW_HORIZON_ID && (h.image ? (
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
                            ))}
                            {/* ── Слой печати горизонта ── */}
                            {(() => {
                              const pl = h.printLayer;
                              const hasPl = !!pl;
                              const updatePl = (patch: Partial<import("@/lib/topology").HorizonPrintLayer>) =>
                                updateHorizon(h.id, { printLayer: pl ? { ...pl, ...patch } : {
                                  visible: true, title: `Вентиляционный план горизонта ${h.z}м.`,
                                  scale: "1:2000", orgName: "", approverTitle: "Главный инженер ЮПР",
                                  approverName: "", day: "", month: "", year: String(new Date().getFullYear()),
                                  period: "", developer: "", checker: "",
                                  sheetNum: "1", sheetTotal: "1", showLegend: false, showStamp: false, showApprover: false,
                                  paperFormat: "A3", orientation: "landscape",
                                  ...patch,
                                }});
                              return (
                                <div className="mt-1 border border-dashed rounded" style={{ borderColor: hasPl && pl.visible ? "#7c3aed" : "#d1d5db" }}>
                                  {/* Заголовок-переключатель */}
                                  <button
                                    className="w-full flex items-center justify-between gap-1 px-2 py-1 text-[11px] rounded"
                                    style={{ background: hasPl && pl.visible ? "#f5f3ff" : "transparent", color: hasPl && pl.visible ? "#7c3aed" : "#6b7280" }}
                                    onClick={() => {
                                      if (!hasPl) {
                                        updatePl({ visible: true });
                                      } else {
                                        updatePl({ visible: !pl.visible });
                                      }
                                    }}>
                                    <span className="flex items-center gap-1">
                                      <Icon name="Printer" size={10} className="flex-shrink-0" />
                                      Слой печати
                                    </span>
                                    <span style={{ fontSize: 9, opacity: 0.7 }}>
                                      {hasPl && pl.visible ? "ВКЛ" : "ВЫКЛ"}
                                    </span>
                                  </button>
                                  {/* Настройки слоя (если включён) */}
                                  {hasPl && pl.visible && (
                                    <div className="px-2 pb-2 pt-1 space-y-1.5" style={{ borderTop: "1px solid #ede9fe" }}>
                                      {/* Формат · Ориентация · УО · Штамп · Утв — всё в одну строку */}
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <select className="cad-input text-[11px]" style={{ width: 40 }}
                                          value={pl.paperFormat ?? "A3"}
                                          onChange={(e) => updatePl({ paperFormat: e.target.value as import("@/lib/topology").PaperFormat, bounds: undefined })}>
                                          {(["A4","A3","A2","A1","A0"] as const).map(f => (
                                            <option key={f} value={f}>{f}</option>
                                          ))}
                                        </select>
                                        {/* Кнопки ориентации (иконки) */}
                                        <button
                                          title="Альбомная"
                                          onClick={() => updatePl({ orientation: "landscape", bounds: undefined })}
                                          className="flex items-center justify-center border rounded"
                                          style={{
                                            width: 26, height: 20, padding: 0,
                                            background: (pl.orientation ?? "landscape") === "landscape" ? "#2563eb" : "white",
                                            borderColor: (pl.orientation ?? "landscape") === "landscape" ? "#1d4ed8" : "#d1d5db",
                                          }}>
                                          <svg width="16" height="12" viewBox="0 0 16 12">
                                            <rect x="1" y="1" width="14" height="10" rx="1" fill="none"
                                              stroke={(pl.orientation ?? "landscape") === "landscape" ? "white" : "#555"} strokeWidth="1.5"/>
                                          </svg>
                                        </button>
                                        <button
                                          title="Книжная"
                                          onClick={() => updatePl({ orientation: "portrait", bounds: undefined })}
                                          className="flex items-center justify-center border rounded"
                                          style={{
                                            width: 20, height: 26, padding: 0,
                                            background: (pl.orientation ?? "landscape") === "portrait" ? "#2563eb" : "white",
                                            borderColor: (pl.orientation ?? "landscape") === "portrait" ? "#1d4ed8" : "#d1d5db",
                                          }}>
                                          <svg width="12" height="16" viewBox="0 0 12 16">
                                            <rect x="1" y="1" width="10" height="14" rx="1" fill="none"
                                              stroke={(pl.orientation ?? "landscape") === "portrait" ? "white" : "#555"} strokeWidth="1.5"/>
                                          </svg>
                                        </button>
                                        <div className="w-px self-stretch bg-gray-300 mx-0.5" />
                                        <CadCheckbox checked={pl.showLegend} onChange={(v) => updatePl({ showLegend: v })} label="УО" />
                                        <CadCheckbox checked={pl.showStamp} onChange={(v) => updatePl({ showStamp: v })} label="Штамп" />
                                        <CadCheckbox checked={pl.showApprover ?? false} onChange={(v) => updatePl({ showApprover: v })} label="Утв" />
                                      </div>
                                      {/* Кнопка редактирования рамки */}
                                      <button
                                        className="w-full px-2 py-1 text-[11px] border rounded"
                                        style={{
                                          background: editingPrintLayerId === h.id ? "#7c3aed" : "white",
                                          color: editingPrintLayerId === h.id ? "white" : "#374151",
                                          borderColor: editingPrintLayerId === h.id ? "#6d28d9" : "#d1d5db",
                                        }}
                                        onClick={() => setEditingPrintLayerId(editingPrintLayerId === h.id ? null : h.id)}>
                                        {editingPrintLayerId === h.id ? "✓ Готово" : "✎ Изменить рамку"}
                                      </button>
                                      {/* Сброс рамки — автоподстройка под горизонт */}
                                      {pl.bounds && (
                                        <button className="w-full px-2 py-1 text-[11px] border border-gray-200 text-gray-600 rounded hover:bg-gray-50"
                                          onClick={() => updatePl({ bounds: undefined })}>
                                          ↺ Авто по горизонту
                                        </button>
                                      )}
                                      <button
                                        className="w-full px-2 py-1 text-[11px] border border-red-200 text-red-600 rounded hover:bg-red-50"
                                        onClick={() => { updateHorizon(h.id, { printLayer: undefined }); setEditingPrintLayerId(null); }}>
                                        Удалить слой
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
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
                      {(() => {
                        const uR = getUnit(unitsConfig, "resistance");
                        const rDisp = uR.fromBase(selectedBranch.resistance / 9.81e-3);
                        return <FieldRow label={`Сопротив-ие, ${uR.symbol}:`} value={rDisp.toFixed(uR.decimals)} computed />;
                      })()}
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

            {/* ═══ ВКЛАДКА: ИНДИКАТОРЫ ══════════════════════════════════ */}
            {activeSide === "indicators" && (() => {
              if (!selectedBranch) return (
                <div className="p-4 text-center text-gray-400 text-xs">Выберите ветвь на схеме</div>
              );
              const ind = selectedBranch.indicators ?? {};
              const setInd = (key: string, val: boolean) =>
                updateBranch(selectedBranch.id, { indicators: { ...ind, [key]: val } });
              const IndRow = ({ k, label }: { k: string; label: string }) => (
                <label className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-blue-50 px-1 rounded">
                  <input type="checkbox" checked={ind[k] ?? false}
                    onChange={e => setInd(k, e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#2563eb", cursor: "pointer" }} />
                  <span className="text-[11px] text-gray-700">{label}</span>
                </label>
              );
              const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
                <div className="mb-2">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-1 py-1 mt-1"
                    style={{ borderBottom: "1px solid #e5e7eb" }}>{title}</div>
                  <div className="pt-0.5">{children}</div>
                </div>
              );
              return (
                <div className="p-2 overflow-y-auto flex-1">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px] font-semibold text-gray-700">Отображаемые индикаторы</span>
                    <button onClick={() => updateBranch(selectedBranch.id, { indicators: {} })}
                      className="text-[10px] text-gray-400 hover:text-red-500 px-1"
                      title="Сбросить все индикаторы">
                      Сбросить
                    </button>
                  </div>

                  <Section title="Общее">
                    <IndRow k="branchName"   label="Название" />
                    <IndRow k="branchNumber" label="Номер" />
                  </Section>

                  <Section title="Вентиляция — исходные данные">
                    <IndRow k="branchVelocity"    label="Макс. допустимая скорость воздуха" />
                    <IndRow k="branchAlpha"        label="Коэффициент шероховатости (α)" />
                    <IndRow k="branchLocalXi"      label="Мин. допустимая скорость воздуха" />
                    <IndRow k="branchResistance"   label="Аэродинамическое сопротивление" />
                    <IndRow k="branchAngle"        label="Уклон" />
                    <IndRow k="branchFlow"         label="Фактический расход воздуха" />
                    <IndRow k="branchDepression"   label="Фактический перепад давления" />
                    <IndRow k="branchLength"       label="Длина" />
                    <IndRow k="branchHeight"       label="Объём" />
                    <IndRow k="branchSection"      label="Поперечное сечение" />
                  </Section>

                  <Section title="Вентиляция — модельные данные">
                    <IndRow k="branchFlowCalc"    label="Расход воздуха" />
                    <IndRow k="branchVelocity"    label="Скорость воздуха" />
                    <IndRow k="branchDepression"  label="Перепад давления" />
                    <IndRow k="branchExtraFan"    label="Энергозатраты на единицу длины" />
                    <IndRow k="branchResistanceSum" label="Финзатраты на единицу длины" />
                    <IndRow k="branchNatDragC"    label="Гарантированный расход воздуха" />
                  </Section>

                  <Section title="Аварии — модельные данные">
                    <IndRow k="branchMethane"       label="Концентрация метана" />
                    <IndRow k="branchCOEmission"    label="Концентрация угарного газа" />
                    <IndRow k="branchGasEmission"   label="Концентрация водорода" />
                    <IndRow k="branchGasSpreadTime" label="Концентрация оксидов азота" />
                    <IndRow k="branchNatDragT"      label="Тепловая критическая депрессия" />
                    <IndRow k="branchNatDragW"      label="Тепловая депрессия пожара" />
                  </Section>
                </div>
              );
            })()}

            {/* ═══ ОСТАЛЬНЫЕ ВКЛАДКИ ═════════════════════════════════════ */}
            {(activeSide === "thermo" || activeSide === "areas"
              || activeSide === "coords"
              || activeSide === "measure" || activeSide === "pipes") && (
              <div className="p-4 text-center text-gray-400 text-xs">
                Вкладка «{activeSide}» в разработке
              </div>
            )}

            {/* ═══ ПОЗИЦИИ ══════════════════════════════════════════════ */}
            {activeSide === "positions" && (
              <PositionsPanel
                positions={positions}
                branches={branches}
                nodes={nodes}
                selectedPositionId={selectedPositionId}
                onSelect={(id) => { setSelectedPositionId(id); if (!id) { setPosBranchBindMode(false); setLeaderDrawMode(null); } }}
                onAdd={(pos) => setPositions((prev) => [...prev, pos])}
                onUpdate={(id, patch) => setPositions((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p))}
                onDelete={(id) => { setPositions((prev) => prev.filter((p) => p.id !== id)); setPosBranchBindMode(false); setLeaderDrawMode(null); }}
                onPlaceMode={() => setPositionPlaceMode((v) => !v)}
                placeModeActive={positionPlaceMode}
                branchBindMode={posBranchBindMode}
                onToggleBranchBind={() => { if (selectedPositionId) setPosBranchBindMode((v) => !v); }}
                leaderDrawMode={leaderDrawMode}
                onStartLeaderDraw={(posId) => { setLeaderDrawMode(posId); setLeaderCursorScreen(null); setLeaderSnapBranch(null); }}
                onRemoveLeader={(posId) => setPositions(prev => prev.map(p => p.id === posId ? { ...p, leaderEndX: null, leaderEndY: null, leaderBranchId: null, leaderT: null } : p))}
              />
            )}

            {/* ═══ РАСЧЁТ ГОРНОСПАСАТЕЛЕЙ ══════════════════════════════ */}
            {activeSide === "rescue" && (
              <RescuePanel
                nodes={nodes}
                branches={branches.map(b => {
                  // Если bulkheadId не задан на ветви — берём typeId символа перемычки на этой ветви
                  if (!b.hasBulkhead || b.bulkheadId) return b;
                  const sym = schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
                  return sym ? { ...b, bulkheadId: sym.typeId, bulkheadName: sym.typeId } : b;
                })}
                fireCalcDone={fireCalcDone}
                pickMode={rescuePickMode}
                onPickModeChange={setRescuePickMode}
                onRegisterPickHandler={(fn) => { rescuePickHandlerRef.current = fn; }}
                pickedStartId={rescueStartNodeId}
                pickedTargetId={rescueTargetNodeId}
                onPickedStartChange={setRescueStartNodeId}
                onPickedTargetChange={setRescueTargetNodeId}
                onRouteChange={(bIds, nIds, bDirs) => {
                  setRescuePathBranchIds(bIds);
                  setRescuePathNodeIds(nIds);
                  setRescuePathBranchDirs(bDirs);
                }}
              />
            )}

            {/* ═══ ВРЕМЯ ХОДА ГОРНОРАБОЧЕГО ════════════════════════════ */}
            {activeSide === "workerPath" && (
              <WorkerPathPanel
                nodes={nodes}
                branches={branches.map(b => ({
                  ...b,
                  fireComputedSmokeDens: b.fireComputedSmokeDens,
                  fireComputedCO: b.fireComputedCO,
                }))}
                fireCalcDone={fireCalcDone}
                pickMode={workerPickMode}
                onPickModeChange={setWorkerPickMode}
                onRegisterPickHandler={(fn) => { workerPickHandlerRef.current = fn; }}
                pickedStartId={workerStartNodeId}
                pickedTargetId={workerTargetNodeId}
                onPickedStartChange={setWorkerStartNodeId}
                onPickedTargetChange={setWorkerTargetNodeId}
                onRouteChange={(bIds, nIds, bDirs) => {
                  setWorkerPathBranchIds(bIds);
                  setWorkerPathNodeIds(nIds);
                  setWorkerPathBranchDirs(bDirs);
                }}
              />
            )}

            {/* ═══ ВКЛАДКА: РАСХОД ВОЗДУХА ════════════════════════════ */}
            {activeSide === "flowQ" && (() => {
              const BAR_H = 320;
              const hueStops: Record<string, [string, string]> = {
                red:   ["#ffffff", "#dc2626"],
                blue:  ["#ffffff", "#2563eb"],
                green: ["#ffffff", "#16a34a"],
              };
              const [stopLo, stopHi] = hueStops[flowColorHue];
              const tickCount = 6;
              const ticks = Array.from({ length: tickCount }, (_, i) => {
                const frac = i / (tickCount - 1);
                const val = flowColorMin + frac * (flowColorMax - flowColorMin);
                return { val, frac };
              });
              return (
                <div className="flex flex-col h-full">
                  {/* Переключатель вкл/выкл */}
                  <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <button
                      onClick={() => setColorMode(colorMode === "flowQ" ? "none" : "flowQ")}
                      className="h-6 px-3 rounded text-[11px] font-semibold"
                      style={{
                        background: colorMode === "flowQ" ? "#dc2626" : "#f3f4f6",
                        color: colorMode === "flowQ" ? "white" : "#374151",
                        border: "1px solid " + (colorMode === "flowQ" ? "#b91c1c" : "#d1d5db"),
                      }}>
                      {colorMode === "flowQ" ? "Заливка ВКЛ" : "Заливка ВЫКЛ"}
                    </button>
                    <span className="text-[10px] text-gray-400">После расчёта F9</span>
                  </div>

                  {/* Шкала — по центру панели */}
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex gap-3">
                      {/* Вертикальная полоса */}
                      <div style={{
                        width: 22, height: BAR_H,
                        background: `linear-gradient(to bottom, ${stopHi}, ${stopLo})`,
                        border: "1px solid #d1d5db", borderRadius: 4, flexShrink: 0,
                      }} />
                      {/* Подписи делений */}
                      <div style={{ position: "relative", height: BAR_H, width: 72, flexShrink: 0 }}>
                        {ticks.slice().reverse().map(({ val, frac }) => (
                          <div key={val} style={{
                            position: "absolute",
                            top: (1 - frac) * BAR_H - 7,
                            left: 0, display: "flex", alignItems: "center", gap: 4,
                          }}>
                            <div style={{ width: 5, height: 1, background: "#9ca3af" }} />
                            <span style={{ fontSize: 10, color: "#374151", whiteSpace: "nowrap" }}>
                              {val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)} м³/с
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Настройки шкалы */}
                  <div className="px-3 py-3" style={{ borderTop: "1px solid #e5e7eb" }}>
                    <div className="text-[10px] font-semibold text-gray-500 mb-2 uppercase tracking-wide">Настройки шкалы</div>

                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[11px] text-gray-600" style={{ width: 60 }}>Мин, м³/с</span>
                      <input type="number" min="0" step="5" value={flowColorMin}
                        onChange={e => setFlowColorMin(Number(e.target.value))}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid #d1d5db", borderRadius: 3, height: 22, outline: "none" }} />
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[11px] text-gray-600" style={{ width: 60 }}>Макс, м³/с</span>
                      <input type="number" min="1" step="5" value={flowColorMax}
                        onChange={e => setFlowColorMax(Number(e.target.value))}
                        className="flex-1 text-[11px] text-right px-1"
                        style={{ border: "1px solid #d1d5db", borderRadius: 3, height: 22, outline: "none" }} />
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600" style={{ width: 60 }}>Цвет</span>
                      <div className="flex gap-1">
                        {(["red", "blue", "green"] as const).map(h => (
                          <button key={h} onClick={() => setFlowColorHue(h)}
                            title={h === "red" ? "Красный" : h === "blue" ? "Синий" : "Зелёный"}
                            style={{
                              width: 22, height: 22, borderRadius: 4,
                              border: flowColorHue === h ? "2px solid #111" : "1px solid #d1d5db",
                              background: h === "red" ? "#dc2626" : h === "blue" ? "#2563eb" : "#16a34a",
                              cursor: "pointer",
                            }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── РАЗДЕЛИТЕЛЬ ШИРИНЫ ЛЕВОЙ ПАНЕЛИ (drag) ───────────────── */}
        <div onMouseDown={startLeftDrag}
          className="w-1 flex-shrink-0 cursor-col-resize hover:bg-blue-400 active:bg-blue-500 transition-colors"
          style={{ background: "#d0d0d0" }}
          title="Перетащите, чтобы изменить ширину панели" />
        </>)}

        {/* ── РАБОЧАЯ ОБЛАСТЬ (CANVAS + ИНСТРУМЕНТЫ) ────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ background: "#ffffff" }}>

          {/* Локальная панель инструментов рисования */}
          <div className="h-8 flex items-center gap-1 px-2"
            style={{ background: "#f5f5f5", borderBottom: "1px solid #d0d0d0" }}>
            <ToolBtn icon="MousePointer2" label="Выбрать" active={tool === "select"} onClick={() => setTool("select")} />
            <ToolBtn icon="Plus" label="Узел" active={tool === "node"} onClick={() => setTool("node")} />
            <ToolBtn icon="GitBranch" label="Ветвь" active={tool === "branch"} onClick={() => setTool("branch")} />
            <ToolBtn icon="Move" label="Панорама" active={tool === "pan"} onClick={() => setTool("pan")} />
            <ToolBtn icon="RotateCw" label="Вращать" active={tool === "rotate"} onClick={() => setTool("rotate")} />
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

            {/* ── Режим цветовой заливки ── */}
            <select
              value={colorMode}
              onChange={e => setColorMode(e.target.value as "none" | "flowQ" | "horizon")}
              className="h-6 text-[11px] px-1 rounded"
              style={{ border: "1px solid #d0d0d0", background: colorMode !== "none" ? "#eff6ff" : "white", color: colorMode !== "none" ? "#1d4ed8" : "#1f1f1f", fontWeight: colorMode !== "none" ? 600 : 400, outline: "none" }}
              title="Режим цветовой заливки ветвей">
              <option value="none">— Заливка выкл</option>
              <option value="flowQ">Расход воздуха</option>
              <option value="horizon">Цвет горизонта</option>
            </select>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Анимация потока (toggle) ── */}
            <button
              onClick={() => setFlowDisplay(d => d === "off" ? "flow" : "off")}
              className="h-6 px-2 flex items-center gap-1 rounded text-[11px]"
              style={{
                background: flowDisplay !== "off" ? "#2563eb" : "white",
                color: flowDisplay !== "off" ? "white" : "#1f1f1f",
                border: "1px solid " + (flowDisplay !== "off" ? "#1d4ed8" : "#d0d0d0"),
              }}
              title="Анимация движения воздуха — вкл/откл">
              <Icon name="Wind" size={11} /> Анимация
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {/* ── Пределы масштабов (фиксированный размер объектов) ── */}
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none h-6 px-2 rounded text-[11px]"
              style={{
                background: scaleLimitsEnabled ? "#eff6ff" : "white",
                color: scaleLimitsEnabled ? "#1d4ed8" : "#374151",
                border: "1px solid " + (scaleLimitsEnabled ? "#93c5fd" : "#d0d0d0"),
                fontWeight: scaleLimitsEnabled ? 600 : 400,
              }}
              title={scaleLimitsEnabled
                ? "Фиксированный размер объектов ВКЛ — ветви и символы не увеличиваются при зуме. Нажмите для отключения"
                : "Фиксированный размер объектов ВЫКЛ — при зуме всё масштабируется. Нажмите для включения"}>
              <input
                type="checkbox"
                checked={scaleLimitsEnabled}
                onChange={e => setScaleLimitsEnabled(e.target.checked)}
                style={{ width: 12, height: 12, accentColor: "#2563eb", cursor: "pointer" }}
              />
              <Icon name="ZoomIn" size={11} /> Масштаб
            </label>
            <button
              onClick={() => setScaleSettingsOpen(true)}
              className="h-6 px-2 flex items-center rounded text-[11px]"
              style={{
                background: "white",
                color: "#374151",
                border: "1px solid #d0d0d0",
              }}
              title="Настройки пределов масштабирования">
              <Icon name="Settings2" size={11} />
            </button>

            <div className="w-px h-5 mx-1" style={{ background: "#d0d0d0" }} />

            {vcError && (
              <span className="text-[10px] text-red-600 max-w-[160px] truncate" title={vcError}>
                ⚠ {vcError}
              </span>
            )}

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
            <input type="number" value={Math.round(1 / Math.max(0.0001, (savedViewState?.scale ?? viewScale) * 0.001))}
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

          {/* Стартовый экран — только когда схема пустая */}
          {nodes.length === 0 && branches.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10"
              style={{ background: "rgba(255,255,255,0.0)" }}>
              <div className="flex flex-col items-center gap-4 opacity-40">
                <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                  <rect x="8" y="8" width="48" height="48" rx="8" stroke="#94a3b8" strokeWidth="2" strokeDasharray="6 3"/>
                  <line x1="32" y1="20" x2="32" y2="44" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
                  <line x1="20" y1="32" x2="44" y2="32" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
                <div className="text-center">
                  <p className="text-[15px] font-semibold text-slate-500">Рабочая область пуста</p>
                  <p className="text-[12px] text-slate-400 mt-1">Нажмите <b>+ Узел</b> на панели инструментов,</p>
                  <p className="text-[12px] text-slate-400">или откройте файл проекта через <b>Файл → Открыть</b></p>
                </div>
              </div>
            </div>
          )}

          {/* Холст топологии */}
          <div className="flex-1 relative"
            style={{ cursor: leaderDrawMode ? "crosshair" : undefined }}
            onMouseMove={(e) => {
              const vs = savedViewState ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const rect = e.currentTarget.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              // Режим рисования выноски — snap к ближайшей ветви
              if (leaderDrawMode) {
                setLeaderCursorScreen({ sx, sy });
                // Ищем ближайшую ветвь в радиусе 14px (как hitBranchR в TopoCanvas)
                const SNAP_R = 14;
                let bestBranchId: string | null = null;
                let bestT = 0.5;
                let bestDist = SNAP_R;
                let bestSx = sx, bestSy = sy;
                for (const b of branches) {
                  const fromN = nodes.find(n => n.id === b.fromId);
                  const toN   = nodes.find(n => n.id === b.toId);
                  if (!fromN || !toN) continue;
                  const f = project3D({ x: fromN.x, y: fromN.y, z: fromN.z * (zScale ?? 1) },
                    { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation });
                  const t2 = project3D({ x: toN.x, y: toN.y, z: toN.z * (zScale ?? 1) },
                    { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation });
                  const C = t2.sx - f.sx, D = t2.sy - f.sy;
                  const A = sx - f.sx,   B = sy - f.sy;
                  const lenSq = C * C + D * D;
                  if (lenSq < 1) continue;
                  const tt = Math.max(0.02, Math.min(0.98, (A * C + B * D) / lenSq));
                  const px = f.sx + C * tt, py = f.sy + D * tt;
                  const dist = Math.hypot(sx - px, sy - py);
                  if (dist < bestDist) {
                    bestDist = dist; bestBranchId = b.id; bestT = tt;
                    bestSx = px; bestSy = py;
                  }
                }
                setLeaderSnapBranch(bestBranchId ? { branchId: bestBranchId, t: bestT, sx: bestSx, sy: bestSy } : null);
                return;
              }
              // Drag конца выноски — проецируем на плоскость z=pos.z
              if (leaderDragRef.current) {
                const dragPos = positions.find(p => p.id === leaderDragRef.current!.posId);
                const pz = dragPos?.z ?? 0;
                const w = unprojectToPlane(sx, sy, vs, { axis: "z", value: pz });
                if (!w) return;
                setPositions(prev => prev.map(p =>
                  p.id === leaderDragRef.current!.posId
                    ? { ...p, leaderEndX: w.x, leaderEndY: w.y }
                    : p
                ));
                return;
              }
              // Drag маркера позиции — только если мышь реально сдвинулась (порог 4px)
              if (!posDragRef.current) return;
              const { id, startSx, startSy, startWx, startWy } = posDragRef.current;
              if (Math.hypot(sx - startSx, sy - startSy) < 4) return;
              const dragPos = positions.find(p => p.id === id);
              const pz = dragPos?.z ?? 0;
              const wStart = unprojectToPlane(startSx, startSy, vs, { axis: "z", value: pz });
              const wCur   = unprojectToPlane(sx, sy, vs, { axis: "z", value: pz });
              if (!wStart || !wCur) return;
              const dx = wCur.x - wStart.x;
              const dy = wCur.y - wStart.y;
              setPositions(prev => prev.map(p => p.id === id ? { ...p, x: startWx + dx, y: startWy + dy, placed: true } : p));
            }}
            onClick={(e) => {
              // Клик на пустое место — снять выбор позиции
              if (!leaderDrawMode) {
                // В режиме привязки ветвей не сбрасываем позицию при кликах по схеме
                if (posBranchBindMode) return;
                // e.target — сам div-контейнер или TopoCanvas, не маркер позиции
                setSelectedPositionId(null);
                return;
              }
              if (leaderSnapBranch) {
                // Привязываем выноску к ветви
                const { branchId, t } = leaderSnapBranch;
                const drawPos = positions.find(p => p.id === leaderDrawMode);
                // Находим опорный узел ветви (верхний по z)
                const br = branches.find(b => b.id === branchId);
                const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                const refN = fromN && toN
                  ? (fromN.z >= toN.z ? fromN : toN)
                  : (fromN ?? toN);
                setPositions(prev => prev.map(p => {
                  if (p.id !== leaderDrawMode) return p;
                  const base = { ...p, leaderBranchId: branchId, leaderT: t, leaderEndX: null, leaderEndY: null };
                  // Авто-координаты: если не размещена ИЛИ z=0 (не соответствует сети)
                  if (refN && (!p.placed || p.z === 0)) {
                    const OFFSET = 50;
                    return { ...base, x: refN.x + OFFSET, y: refN.y + OFFSET, z: refN.z, placed: true };
                  }
                  return { ...base, placed: true };
                }));
              } else {
                // Свободная точка
                const vs2 = savedViewState ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                const rect = e.currentTarget.getBoundingClientRect();
                const sx2 = e.clientX - rect.left;
                const sy2 = e.clientY - rect.top;
                const drawPos = positions.find(p => p.id === leaderDrawMode);
                const pz = drawPos?.z ?? 0;
                const w = unprojectToPlane(sx2, sy2, vs2, { axis: "z", value: pz });
                if (w) {
                  setPositions(prev => prev.map(p =>
                    p.id === leaderDrawMode
                      ? { ...p, leaderEndX: w.x, leaderEndY: w.y, leaderBranchId: null, leaderT: null }
                      : p
                  ));
                }
              }
              setLeaderDrawMode(null);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }}
            onMouseUp={() => {
              posDragRef.current = null; setDraggingPosId(null);
              leaderDragRef.current = null; setDraggingLeaderPosId(null);
            }}
            onMouseLeave={() => {
              posDragRef.current = null; setDraggingPosId(null);
              leaderDragRef.current = null; setDraggingLeaderPosId(null);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }}>
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
              colorMode={colorMode}
              flowColorMin={flowColorMin}
              flowColorMax={flowColorMax}
              flowColorHue={flowColorHue}
              workPlane={workPlane}
              horizons={horizons}
              branchWidth={branchWidth}
              branchBorder={branchBorder}
              thinLines={thinLines}
              fixedObjectScale={scaleLimitsEnabled}
              colorByHorizon={colorMode === "horizon"}
              showFlowArrows={showFlowArrows}
              scaleOverride={viewScale}
              onScaleChange={setViewScale}
              fitToScreenNonce={fitToScreenNonce}
              focusNonce={focusNonce}
              focusNodeId={focusNodeId}
              focusBranchId={focusBranchId}
              onRegisterGetSvg={(fn) => { getSvgRef.current = fn; }}
              onRegisterCanvasEl={(el) => {
                liveCanvasRef.current = el;
                if (el) setCanvasSize({ w: el.clientWidth || el.width, h: el.clientHeight || el.height });
              }}
              onRegisterSvgEl={(el) => { liveSvgRef.current = el; }}
              restoreView={savedViewToRestore}
              onRestoreViewDone={() => setSavedViewToRestore(null)}
              onViewStateChange={setSavedViewState}
              editingHorizonImageId={editingHorizonImageId}
              onHorizonImageBoundsChange={setHorizonImageBounds}
              editingPrintLayerId={editingPrintLayerId}
              onPrintLayerBoundsChange={setPrintLayerBounds}
              onPrintLayerChange={(horizonId, patch) =>
                setHorizons(prev => prev.map(h => h.id !== horizonId || !h.printLayer ? h : {
                  ...h, printLayer: { ...h.printLayer, ...patch },
                }))
              }
              onNodeAdd={handleNodeAdd}
              onNodeMove={handleNodeMove}
              onBranchAdd={handleBranchAdd}
              onSplitBranchAt={handleSplitBranchAt}
              onSelectNode={(id) => {
                if (id && rescuePickMode) {
                  rescuePickHandlerRef.current?.(id);
                  setSelectedNodeId(id);
                  return;
                }
                if (id && workerPickMode) {
                  workerPickHandlerRef.current?.(id);
                  setSelectedNodeId(id);
                  return;
                }
                setSelectedNodeId(id); setSelectedNodeIds(new Set()); setSelectedSymbolId(null); setSelectedSymbolIds(new Set()); if (id) { setSelectedBranchId(null); setActiveSide("params"); }
              }}
              onSelectBranch={(id) => {
                if (posBranchBindMode && selectedPositionId && id) {
                  // Режим F3: привязываем/отвязываем ветвь к позиции
                  // Вычисляем авто-координаты ДО setPositions (избегаем stale closure)
                  const br = branches.find(b => b.id === id);
                  const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                  const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                  // Берём узел с наибольшей Z (меньше по глубине = ближе к поверхности)
                  const refN = fromN && toN
                    ? (fromN.z >= toN.z ? fromN : toN)
                    : (fromN ?? toN);

                  setPositions(prev => prev.map(p => {
                    if (p.id !== selectedPositionId) return p;
                    const has = p.branchIds.includes(id);
                    if (has) {
                      return { ...p, branchIds: p.branchIds.filter(x => x !== id) };
                    }
                    const newBranchIds = [...p.branchIds, id];
                    // Авто-размещение если не размещена ИЛИ z=0 (не на сети)
                    if (refN && (!p.placed || p.z === 0)) {
                      const OFFSET = 50;
                      return { ...p, branchIds: newBranchIds, x: refN.x + OFFSET, y: refN.y + OFFSET, z: refN.z, placed: true };
                    }
                    return { ...p, branchIds: newBranchIds };
                  }));
                  return;
                }
                setSelectedBranchId(id); setSelectedBranchIds(new Set()); setSelectedSymbolId(null); setSelectedSymbolIds(new Set()); if (id) { setSelectedNodeId(null); setFanSymbolBranchId(null); setActiveSide("general"); }
              }}
              onNodeContextMenu={(id, x, y) => { setSelectedNodeId(id); setSelectedBranchId(null); setCtxMenu({ kind: "node", id, x, y }); }}
              onBranchContextMenu={(id, x, y) => { setSelectedBranchId(id); setSelectedNodeId(null); setCtxMenu({ kind: "branch", id, x, y }); }}
              onCanvasContextMenu={(x, y) => setCtxMenu({ kind: "canvas", x, y })}
              selectedBranchIds={selectedBranchIds}
              onBranchMultiSelect={handleBranchMultiSelect}
              selectedNodeIds={selectedNodeIds}
              onNodeMultiSelect={handleNodeMultiSelect}
              infoConfig={infoConfig}
              unitsConfig={unitsConfig}
              waterNodeResults={waterNetwork.nodeResults}
              zScale={zScale}
              xyScale={xyScale}
              schemaSymbols={schemaSymbols}
              selectedSymbolId={selectedSymbolId}
              selectedSymbolIds={selectedSymbolIds}
              onSelectSymbol={(id) => { setSelectedSymbolId(id); setSelectedSymbolIds(new Set()); }}
              onSymbolMultiSelect={(id) => {
                setSelectedSymbolIds(prev => {
                  const next = new Set(prev);
                  if (next.has(id)) { next.delete(id); } else { next.add(id); }
                  return next;
                });
                setSelectedSymbolId(id);
              }}
              onSymbolDragStart={() => pushHistory()}
              onSymbolMove={(id, x, y) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, x, y } : s))}
              onSymbolMoveAlongBranch={(id, t) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, t } : s))}
              onSymbolOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, offsetX: ox, offsetY: oy } : s))}
              onSymbolIndOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, indOffsetX: ox, indOffsetY: oy } : s))}
              onSymbolScale={(id, delta) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, scale: Math.max(0.4, Math.min(4, (s.scale ?? 1) + delta)) } : s))}
              onSymbolDelete={(id) => {
                pushHistory();
                const sym = schemaSymbols.find(s => s.id === id);
                if (sym?.typeId === "fan" && sym.branchId) {
                  updateBranch(sym.branchId, {
                    hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0,
                    fanStopped: false, fanReverse: false, fanRpm: 0,
                    fanBladeAngle: 0, fanParallel: 1, fanEfficiency: 0,
                    fanShaftPower: 0, fanInstall: "Без перемычки", fanCrossingR: 0,
                  }, false);
                }
                // Сброс перемычки при удалении символа
                if (sym && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  const otherBulkheads = schemaSymbols.filter(
                    s => s.id !== id && BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === sym.branchId
                  );
                  if (otherBulkheads.length === 0) {
                    updateBranch(sym.branchId, {
                      hasBulkhead: false,
                      bulkheadR: 0, bulkheadAirPerm: 0,
                      bulkheadManualR: 0, bulkheadSurveyQ: 0, bulkheadSurveyDP: 0,
                    }, false);
                  }
                }
                // Сброс очага пожара при удалении символа
                if (sym && FIRE_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    hasFire: false,
                    fireComputedTemp: 0, fireComputedNatDep: 0,
                    fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0,
                  }, false);
                  setFireResult(null); setFireCalcDone(false);
                }
                // Сброс взрыва при удалении символа
                if (sym && EXPLOSION_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    hasExplosion: false,
                    explosionComputedQtnt: 0, explosionComputedMaxP: 0,
                    explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0,
                    explosionComputedR_heavy: 0, explosionComputedR_medium: 0,
                    explosionComputedR_light: 0, explosionComputedDeltaP: 0,
                  }, false);
                  setExplosionResult(null); setExplosionCalcDone(false);
                }
                // Сброс редуктора при удалении символа клапана
                if (sym && REDUCER_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  updateBranch(sym.branchId, {
                    wpHasReducer: false,
                    wpReducerModel: "kppr_50",
                    wpReducerOutPressure: 0.5,
                    wpReducerMaxFlow: 25,
                  }, false);
                }
                removeSymbol(id);
                setSelectedSymbolId(null);
                setSelectedSymbolIds(new Set());
              }}
              onSymbolClick={(symId) => {
                // Одиночный клик: выбрать УО и показать свойства (панель params)
                const sym = schemaSymbols.find(s => s.id === symId);
                setSelectedSymbolId(symId);
                // Для перемычек — НЕ выбираем ветвь, чтобы открылась панель символа (не ветви)
                if (sym?.branchId && !BULKHEAD_SYMBOL_IDS.has(sym.typeId)) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                } else {
                  setSelectedBranchId(null);
                  setSelectedNodeId(null);
                }
                setFanSymbolBranchId(null);
                setActiveSide("params");
              }}
              onSymbolDblClick={(symId) => {
                // Двойной клик: открыть настройки вентилятора / перемычки / аварии
                const sym = schemaSymbols.find(s => s.id === symId);
                setSelectedSymbolId(symId);
                if (sym?.typeId === "fan" && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(sym.branchId);
                  setActiveSide("fan");
                } else if (sym && FIRE_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("accidents");
                  setActiveRibbon("involve");
                } else if (sym && EXPLOSION_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("blast");
                  setActiveRibbon("involve");
                } else if (sym && REDUCER_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("waterpipes");
                } else if (sym && BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
                  // Двойной клик на перемычку — открываем ветвь и переходим на вкладку Топология
                  // (там находится блок настроек перемычки)
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setSelectedSymbolId(symId);
                  setFanSymbolBranchId(null);
                  setActiveSide("topology");
                } else {
                  setSelectedBranchId(null);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
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
              positionPlaceMode={positionPlaceMode}
              onPositionPlace={(wx, wy) => {
                const sel = selectedPositionId ? positions.find(p => p.id === selectedPositionId) : null;
                if (!sel) return;
                const wz = activeHorizon ? activeHorizon.z : (sel.z ?? 0);
                setPositions(prev => prev.map(p => p.id === sel.id ? { ...p, x: wx, y: wy, z: wz, placed: true } : p));
                setPositionPlaceMode(false);
              }}
              branchFireColors={(() => {
                if (!showSmoke || !fireCalcDone || !fireResult) return undefined;
                const map = new Map<string, { color: string; fromT: number; toT: number }>();

                // Вспомогательная функция: цвет по уровню опасности
                const hazardCol = (level: string) =>
                  level === "lethal"  ? "#7f1d1d"
                : level === "danger"  ? "#dc2626"
                : level === "warning" ? "#f59e0b"
                : "#a16207"; // safe — тёмно-жёлтый, задымление слабое но видимое

                fireResult.branches.forEach((fr, bid) => {
                  const branch = branches.find(b => b.id === bid);
                  if (!branch) return;
                  const col = hazardCol(fr.hazardLevel);

                  if (branch.hasFire) {
                    if (smokeTimeMinutes <= 0) return;
                    // Очаг: дым расходится от точки очага fireT
                    // По потоку — с нормальной скоростью воздуха
                    // Против потока — только диффузия (0.1 м/с)
                    const ft = branch.fireT ?? 0.5;
                    const flowSpeed = fr.airSpeed > 0 ? fr.airSpeed : 0.3;
                    const diffSpeed = 0.1; // скорость диффузии против потока
                    const len = branch.length > 0 ? branch.length : 1;
                    const elapsedSec = smokeTimeMinutes * 60;
                    const flowDir = (branch.flow ?? 0) >= 0; // true = from→to

                    // По направлению потока (от очага к выходному узлу)
                    const downLen = Math.min(flowDir ? (1 - ft) * len : ft * len, elapsedSec * flowSpeed);
                    // Против потока (от очага к входному узлу) — диффузия
                    const upLen   = Math.min(flowDir ? ft * len : (1 - ft) * len, elapsedSec * diffSpeed);

                    const downFrac = downLen / len;
                    const upFrac   = upLen / len;

                    // fromT/toT в координатах ветви (0=fromId, 1=toId)
                    const fromT = flowDir
                      ? Math.max(0, ft - upFrac)    // против потока → влево
                      : Math.max(0, ft - downFrac);  // по потоку → влево (поток обратный)
                    const toT = flowDir
                      ? Math.min(1, ft + downFrac)   // по потоку → вправо
                      : Math.min(1, ft + upFrac);    // против потока → вправо (поток обратный)

                    map.set(bid, { color: col, fromT, toT });
                    return;
                  }

                  // Обычная ветвь: дым входит начиная с smokeArrivalTime
                  if (smokeTimeMinutes <= 0 || fr.smokeArrivalTime > smokeTimeMinutes) return;

                  // Сколько минут дым уже идёт по этой ветви
                  const elapsedInBranch = smokeTimeMinutes - fr.smokeArrivalTime;

                  // Берём скорость из результата расчёта пожара (уже с min 0.3 м/с)
                  const speed = fr.airSpeed > 0 ? fr.airSpeed : 0.3;
                  // Длина ветви, пройденная дымом за elapsedInBranch минут
                  const smokedLen = elapsedInBranch * 60 * speed;
                  const smokedFrac = branch.length > 0
                    ? Math.min(1, smokedLen / branch.length)
                    : 1;

                  // Дым входит с той стороны ветви, откуда идёт поток
                  // flow >= 0: воздух from→to, дым входит с fromT=0
                  // flow < 0: воздух to→from, дым входит с toT=1 (fromT = 1 - frac)
                  const flowPos = branch.flow ?? 0;
                  if (flowPos >= 0) {
                    map.set(bid, { color: col, fromT: 0, toT: smokedFrac });
                  } else {
                    map.set(bid, { color: col, fromT: 1 - smokedFrac, toT: 1 });
                  }
                });


                return map.size > 0 ? map : undefined;
              })()}
              branchExplosionColors={(() => {
                if (!showExplosionZones || !explosionCalcDone || !explosionResult) return undefined;
                if (blastWaveRadius <= 0) return undefined;
                const map = new Map<string, { color: string; hazardLevel: string }>();

                const zoneColor = (deltaP: number) => {
                  if (deltaP >= 100) return { color: "#7c1010", hazardLevel: "lethal" };
                  if (deltaP >= 50)  return { color: "#dc2626", hazardLevel: "heavy" };
                  if (deltaP >= 30)  return { color: "#f97316", hazardLevel: "medium" };
                  if (deltaP >= 10)  return { color: "#fbbf24", hazardLevel: "light" };
                  // Безопасно — всё равно окрашиваем, чтобы не было «белых пятен»
                  return { color: "#22c55e", hazardLevel: "safe" };
                };

                // Источники: координата точки взрыва на ветви
                const sourceNodeIds = new Set<string>();
                branches.forEach(src => {
                  if (!src.hasExplosion || src.explosionComputedMaxP <= 0) return;
                  sourceNodeIds.add(src.fromId);
                  sourceNodeIds.add(src.toId);
                });
                if (sourceNodeIds.size === 0) return undefined;

                // Длина ветви по координатам узлов (3D)
                const branchLen = (b: typeof branches[0]): number => {
                  const fN = nodes.find(n => n.id === b.fromId);
                  const tN = nodes.find(n => n.id === b.toId);
                  if (!fN || !tN) return b.length > 0 ? b.length : 0;
                  return Math.sqrt((tN.x-fN.x)**2+(tN.y-fN.y)**2+(tN.z-fN.z)**2) || (b.length > 0 ? b.length : 1);
                };

                // Дейкстра по сети выработок: dist[nodeId] = расстояние по сети от источника
                // Волна распространяется ПО ВЫРАБОТКАМ, а не сквозь породу
                const distNode = new Map<string, number>();
                const pq: Array<{ id: string; d: number }> = [];

                // Начальные расстояния от узлов ветви-источника
                // Учитываем что символ взрыва стоит на позиции t вдоль ветви
                branches.forEach(src => {
                  if (!src.hasExplosion || src.explosionComputedMaxP <= 0) return;
                  const len = branchLen(src);
                  const t = src.explosionT ?? 0.5;
                  const dFrom = len * t;       // расстояние от точки взрыва до fromId
                  const dTo   = len * (1 - t); // расстояние от точки взрыва до toId
                  const upd = (nid: string, d: number) => {
                    if (!distNode.has(nid) || distNode.get(nid)! > d) {
                      distNode.set(nid, d);
                      pq.push({ id: nid, d });
                    }
                  };
                  upd(src.fromId, dFrom);
                  upd(src.toId,   dTo);
                });

                // Граф смежности: nodeId → [{nodeId, branchLen, branchId}]
                type Edge = { to: string; len: number; branchId: string };
                const adj = new Map<string, Edge[]>();
                branches.forEach(b => {
                  const len = branchLen(b);
                  if (!adj.has(b.fromId)) adj.set(b.fromId, []);
                  if (!adj.has(b.toId))   adj.set(b.toId,   []);
                  adj.get(b.fromId)!.push({ to: b.toId,   len, branchId: b.id });
                  adj.get(b.toId)!.push  ({ to: b.fromId, len, branchId: b.id });
                });

                // Простой Дейкстра (без приоритетной очереди — сеть небольшая)
                pq.sort((a, b) => a.d - b.d);
                const visited = new Set<string>();
                while (pq.length > 0) {
                  pq.sort((a, b) => a.d - b.d);
                  const { id: cur, d: curD } = pq.shift()!;
                  if (visited.has(cur)) continue;
                  visited.add(cur);
                  const edges = adj.get(cur) ?? [];
                  for (const e of edges) {
                    const nd = curD + e.len;
                    if (nd > blastWaveRadius) continue; // волна не дошла
                    if (!distNode.has(e.to) || distNode.get(e.to)! > nd) {
                      distNode.set(e.to, nd);
                      pq.push({ id: e.to, d: nd });
                    }
                  }
                }

                // Окрашиваем ветви по давлению в их середине (ближайшая точка к источнику)
                branches.forEach(b => {
                  // Ветвь-источник взрыва: давление максимальное (в точке взрыва)
                  if (b.hasExplosion && b.explosionComputedMaxP > 0) {
                    map.set(b.id, zoneColor(b.explosionComputedMaxP));
                    return;
                  }
                  const dFrom = distNode.get(b.fromId);
                  const dTo   = distNode.get(b.toId);
                  // Ни один узел не достигнут — волна не дошла
                  if (dFrom === undefined && dTo === undefined) return;
                  // Расстояние до ближайшей точки ветви с учётом середины:
                  // если оба узла достигнуты — берём минимум из узлов и середины ветви
                  const dF = dFrom ?? Infinity;
                  const dT = dTo   ?? Infinity;
                  const len = branchLen(b);
                  // Ближайшая точка на ветви: минимум расстояний по длине ветви
                  // Если волна достигла обоих узлов — минимум в середине ≈ min(dF,dT) + len/2 - len/2 = min(dF,dT)
                  // Если только один — ближайшая точка = ближайший узел
                  const minNodeD = Math.min(dF, dT);
                  // Для ветви между двумя достигнутыми узлами — давление по ближайшей точке
                  // Используем наименьшее из: расстояний до узлов
                  // (точная интерполяция: ближайшая точка на ветви = min(dF, dT) - len*t_closest)
                  // Но это усложняет код, берём просто min расстояний до узлов
                  const dp = explosionResult.pressureAtDistance(minNodeD);
                  map.set(b.id, zoneColor(dp));
                });

                return map.size > 0 ? map : undefined;
              })()}
              branchBindMode={posBranchBindMode}
              branchPositionColors={(() => {
                if (!posBranchBindMode || !selectedPositionId) return undefined;
                const pos = positions.find(p => p.id === selectedPositionId);
                if (!pos) return undefined;
                const map = new Map<string, { color: string; bound: boolean }>();
                branches.forEach(b => {
                  map.set(b.id, { color: pos.color, bound: pos.branchIds.includes(b.id) });
                });
                return map;
              })()}
              posInnerColors={(() => {
                if (!posColorInner || positions.length === 0) return undefined;
                const map = new Map<string, string>();
                positions.forEach(pos => {
                  if (pos.branchesVisible === false) return;
                  pos.branchIds.forEach(bid => { if (!map.has(bid)) map.set(bid, pos.color); });
                });
                return map.size > 0 ? map : undefined;
              })()}
              posOuterColors={(() => {
                if (!posColorOuter || positions.length === 0) return undefined;
                const map = new Map<string, string>();
                positions.forEach(pos => {
                  if (pos.branchesVisible === false) return;
                  pos.branchIds.forEach(bid => { if (!map.has(bid)) map.set(bid, pos.color); });
                });
                return map.size > 0 ? map : undefined;
              })()}
              rescuePathBranchIds={
                workerPathBranchIds.size > 0 ? workerPathBranchIds
                : rescuePathBranchIds.size > 0 ? rescuePathBranchIds
                : undefined
              }
              rescuePathBranchDirs={
                workerPathBranchDirs.size > 0 ? workerPathBranchDirs
                : rescuePathBranchDirs.size > 0 ? rescuePathBranchDirs
                : undefined
              }
              rescuePathNodeIds={
                workerPathNodeIds.size > 0 ? workerPathNodeIds
                : rescuePathNodeIds.size > 0 ? rescuePathNodeIds
                : undefined
              }
              rescuePickMode={rescuePickMode ?? workerPickMode}
              onRescueNodePick={(nodeId) => {
                if (rescuePickMode) rescuePickHandlerRef.current?.(nodeId);
                else if (workerPickMode) workerPickHandlerRef.current?.(nodeId);
              }}
              onSymbolPlace={(typeId, x, y, branchId, t) => {
                if (SQUAD_TYPES.includes(typeId)) {
                  setSquadDialog({ typeId, x, y, branchId });
                  setSquadCount("5");
                } else {
                  if (typeId === "fan" && branchId) {
                    const alreadyHasFan = schemaSymbols.some(s => s.typeId === "fan" && s.branchId === branchId);
                    if (!alreadyHasFan) {
                      addSymbol(typeId, x, y, branchId);
                      updateBranch(branchId, { hasFan: true, fanMode: "curve", fanType: "ВМП", fanInstall: "Без перемычки" });
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setActiveSide("fan");
                      setFanSymbolBranchId(branchId);
                    }
                  } else if (FIRE_SYMBOL_IDS.has(typeId) && branchId) {
                    // Очаг пожара — одна ветвь = один очаг
                    const alreadyHasFire = schemaSymbols.some(s => FIRE_SYMBOL_IDS.has(s.typeId) && s.branchId === branchId);
                    if (!alreadyHasFire) {
                      const fireT = t ?? 0.5;
                      const newSym: SchemaSymbol = {
                        id: `SYM_FIRE_${Date.now()}`,
                        typeId, x, y, branchId, t: fireT,
                      };
                      setSchemaSymbols(prev => [...prev, newSym]);
                      updateBranch(branchId, {
                        hasFire: true,
                        fireT: fireT,
                        fireHeatRelease: 5,
                        fireMode: "heat",
                        fireTemperature: 300,
                        fireCombustible: "vehicle",
                      });
                      setSelectedSymbolId(newSym.id);
                      lastBranchTab.current = "accidents"; // чтобы useEffect не перебил вкладку
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setFanSymbolBranchId(null);
                      setFireResult(null);
                      setFireCalcDone(false);
                      setActiveSide("accidents");
                      setActiveRibbon("involve");
                    }
                  } else if (EXPLOSION_SYMBOL_IDS.has(typeId) && branchId) {
                    // Источник взрыва — одна ветвь = один источник
                    const alreadyHasExplosion = schemaSymbols.some(s => EXPLOSION_SYMBOL_IDS.has(s.typeId) && s.branchId === branchId);
                    if (!alreadyHasExplosion) {
                      const expT = t ?? 0.5;
                      const newSym: SchemaSymbol = {
                        id: `SYM_EXPL_${Date.now()}`,
                        typeId, x, y, branchId, t: expT,
                      };
                      setSchemaSymbols(prev => [...prev, newSym]);
                      updateBranch(branchId, {
                        hasExplosion: true,
                        explosionT: expT,
                        explosionMethod: "gas_dynamics",
                        explosionSourceType: "gas",
                        explosionGasId: "methane",
                        explosionGasVolume: 100,
                        explosionGasConcentration: 9.5,
                        explosionExplosiveId: "ammonit",
                        explosionExplosiveMass: 10,
                        explosionConsiderWalls: true,
                      });
                      setSelectedSymbolId(newSym.id);
                      lastBranchTab.current = "blast";
                      setSelectedBranchId(branchId);
                      setSelectedNodeId(null);
                      setFanSymbolBranchId(null);
                      setExplosionResult(null);
                      setExplosionCalcDone(false);
                      setActiveSide("blast");
                      setActiveRibbon("involve");
                    }
                  } else if (REDUCER_SYMBOL_IDS.has(typeId) && branchId) {
                    // Редукционный клапан — привязываем к ветви водопровода
                    const br = branches.find(b => b.id === branchId);
                    const defaultValve = PRESSURE_REDUCING_VALVES[0];
                    const newSym: SchemaSymbol = {
                      id: `SYM_RD_${Date.now()}`,
                      typeId, x, y, branchId, t: 0.5,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    // Ветвь: ставим флаг редуктора и дефолтные параметры
                    if (br && !br.wpHasReducer) {
                      updateBranch(branchId, {
                        wpHasReducer: true,
                        wpReducerModel: defaultValve.id,
                        wpReducerOutPressure: 0.5,
                        wpReducerMaxFlow: defaultValve.flowMax,
                      });
                    }
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(branchId);
                    setSelectedNodeId(null);
                    setFanSymbolBranchId(null);
                    setActiveSide("waterpipes");
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

            {/* ── Легенда зон взрыва с радиусами ────────────────────── */}
            {showExplosionZones && explosionCalcDone && explosionResult && (
              <div style={{
                position: "absolute", bottom: 12, left: 12, zIndex: 20,
                background: "rgba(10,6,0,0.88)", borderRadius: 10,
                padding: "10px 14px", color: "white", fontSize: 11,
                minWidth: 220, pointerEvents: "none",
                border: "1px solid rgba(245,158,11,0.45)",
                backdropFilter: "blur(6px)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
              }}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: "#fbbf24", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  💥 Зоны поражения взрывом
                </div>
                {(() => {
                  const zoneDefs = [
                    { color: "#7c1010", label: "Летальная",        dp: "ΔP > 100 кПа", hazard: "lethal"  },
                    { color: "#dc2626", label: "Тяжёлые травмы",   dp: "ΔP 50–100 кПа", hazard: "heavy"  },
                    { color: "#f97316", label: "Средние травмы",   dp: "ΔP 30–50 кПа",  hazard: "medium" },
                    { color: "#fbbf24", label: "Лёгкие травмы",    dp: "ΔP 10–30 кПа",  hazard: "light"  },
                    { color: "#22c55e", label: "Безопасно",         dp: "ΔP < 10 кПа",   hazard: "safe"   },
                  ];
                  return zoneDefs.map(({ color, label, dp, hazard }) => {
                    const zone = explosionResult.zones.find(z => z.hazardLevel === hazard);
                    const r = zone?.radius_m ?? 0;
                    const isActive = blastWaveRadius > 0 && r > 0 && blastWaveRadius >= r;
                    return (
                      <div key={hazard} style={{
                        display: "flex", alignItems: "center", gap: 8, marginBottom: 5,
                        opacity: r === 0 ? 0.4 : 1,
                      }}>
                        {/* Цветная полоска */}
                        <div style={{
                          width: 6, height: 28, background: color, borderRadius: 3,
                          flexShrink: 0,
                          boxShadow: isActive ? `0 0 6px ${color}` : "none",
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: isActive ? "#fff" : "#d1d5db", fontSize: 11 }}>{label}</div>
                          <div style={{ color: "#9ca3af", fontSize: 10 }}>{dp}</div>
                        </div>
                        {/* Радиус */}
                        <div style={{
                          fontSize: 11, fontWeight: 700, textAlign: "right", flexShrink: 0,
                          color: r > 0 ? color : "#4b5563",
                          background: r > 0 ? `${color}20` : "transparent",
                          border: `1px solid ${r > 0 ? color + "60" : "transparent"}`,
                          borderRadius: 4, padding: "1px 6px", minWidth: 54,
                        }}>
                          {r > 0 ? `${r} м` : "—"}
                        </div>
                      </div>
                    );
                  });
                })()}
                <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.12)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "#fde68a", fontSize: 10 }}>Q_тнт = <b>{explosionResult.q_tnt_kg} кг</b></span>
                  <span style={{ color: "#fde68a", fontSize: 10 }}>D = <b>{explosionResult.waveFrontSpeed_ms} м/с</b></span>
                  <span style={{ color: "#fde68a", fontSize: 10 }}>ΔP_max = <b>{explosionResult.maxDeltaP_kPa} кПа</b></span>
                </div>
              </div>
            )}

            {/* ── Маркеры позиций (SVG-оверлей) ──────────────────────── */}
            {positions.length > 0 && showPositions && (() => {
              const vs = savedViewState ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const projOpts = { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation };
              // xyScale и zScale применяем к осям, как это делает TopoCanvas
              const proj = (wx: number, wy: number, wz = 0) => {
                const p = project3D({ x: wx * (xyScale ?? 1), y: wy * (xyScale ?? 1), z: wz * (zScale ?? 1) }, projOpts);
                return { sx: p.sx, sy: p.sy };
              };
              // Проекция узла с xyScale и zScale
              const projNode = (n: { x: number; y: number; z: number }) =>
                project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, projOpts);
              // По ГОСТ позиции ПЛА: диаметр 13 мм на чертеже.
              // base zoom 0.5 → при zoom ×0.5 posSF=1.0 (номинал). max=1.0 чтобы не перекрывать схему.
              const posSF = scaleLimitsEnabled ? 1 : Math.min(1.0, Math.max(0.25, vs.scale / 0.5));
              const PX_PER_MM = 3.78 * posSF;

              // Вспомогательная: экранные координаты конца выноски по привязке к ветви
              const leaderBranchEnd = (branchId: string, t: number): { sx: number; sy: number } | null => {
                const br = branches.find(b => b.id === branchId);
                const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                if (!fromN || !toN) return null;
                const fP = projNode(fromN);
                const tP = projNode(toN);
                return { sx: fP.sx + (tP.sx - fP.sx) * t, sy: fP.sy + (tP.sy - fP.sy) * t };
              };

              return (
                <svg
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none", cursor: leaderDrawMode ? "crosshair" : "inherit" }}
                >
                  {/* ── Подсветка ветви под snap (режим рисования) ── */}
                  {leaderDrawMode && leaderSnapBranch && (() => {
                    const br = branches.find(b => b.id === leaderSnapBranch.branchId);
                    const fromN = br ? nodes.find(n => n.id === br.fromId) : null;
                    const toN   = br ? nodes.find(n => n.id === br.toId)   : null;
                    if (!fromN || !toN) return null;
                    const fP = projNode(fromN), tP = projNode(toN);
                    const pos = positions.find(p => p.id === leaderDrawMode);
                    return (
                      <g style={{ pointerEvents: "none" }}>
                        <line x1={fP.sx} y1={fP.sy} x2={tP.sx} y2={tP.sy}
                          stroke={pos?.color ?? "#2563eb"} strokeWidth={4} opacity={0.35}
                          strokeLinecap="round" />
                        <circle cx={leaderSnapBranch.sx} cy={leaderSnapBranch.sy} r={7}
                          fill={pos?.color ?? "#2563eb"} opacity={0.85} />
                      </g>
                    );
                  })()}

                  {/* ── Выноски ── */}
                  {positions.map((pos) => {
                    if (pos.visible === false) return null;
                    const pz = pos.z ?? 0;
                    const pm = proj(pos.x, pos.y, pz);
                    const r = (pos.diameter ?? 13) * PX_PER_MM / 2;
                    const lw = Math.max(0.5, (pos.leaderThickness ?? 0.2) * PX_PER_MM);
                    const isDrawing = leaderDrawMode === pos.id;

                    // Вычисляем конец выноски
                    let endSx: number | null = null, endSy: number | null = null;
                    let isBranchAttached = false;

                    if (isDrawing) {
                      // В режиме рисования — snap к ветви или курсор
                      if (leaderSnapBranch) {
                        endSx = leaderSnapBranch.sx; endSy = leaderSnapBranch.sy;
                        isBranchAttached = true;
                      } else if (leaderCursorScreen) {
                        endSx = leaderCursorScreen.sx; endSy = leaderCursorScreen.sy;
                      }
                    } else if (pos.leaderBranchId && pos.leaderT != null) {
                      // Привязан к ветви — вычисляем через проекцию
                      const ep = leaderBranchEnd(pos.leaderBranchId, pos.leaderT);
                      if (ep) { endSx = ep.sx; endSy = ep.sy; isBranchAttached = true; }
                    } else if (pos.leaderEndX != null && pos.leaderEndY != null) {
                      // Свободная точка
                      const pe = proj(pos.leaderEndX, pos.leaderEndY, pz);
                      endSx = pe.sx; endSy = pe.sy;
                    }

                    if (endSx == null || endSy == null) return null;

                    const dx = endSx - pm.sx, dy = endSy - pm.sy;
                    const dist = Math.hypot(dx, dy);
                    if (dist < 2) return null;
                    const ux = dx / dist, uy = dy / dist;
                    const x1 = pm.sx + ux * (r + 2), y1 = pm.sy + uy * (r + 2);
                    const isDragging = draggingLeaderPosId === pos.id;

                    return (
                      <g key={`leader-${pos.id}`}>
                        {/* Пунктирная линия — по ГОСТ чёрного цвета */}
                        <line
                          x1={x1} y1={y1} x2={endSx} y2={endSy}
                          stroke="#000000" strokeWidth={lw}
                          strokeDasharray="6,3" strokeLinecap="round"
                          opacity={isDrawing ? 0.6 : 0.9}
                          style={{ pointerEvents: "none" }}
                        />
                        {/* Точка привязки к ветви */}
                        {isBranchAttached && !isDrawing && (
                          <circle cx={endSx} cy={endSy} r={4}
                            fill="#000000" stroke="#fff" strokeWidth={1.5}
                            style={{ pointerEvents: "none" }} />
                        )}
                        {/* Ручка для перемещения (только когда не привязана к ветви) */}
                        {!isBranchAttached && !isDrawing && (
                          <circle
                            cx={endSx} cy={endSy} r={isDragging ? 7 : 5}
                            fill={isDragging ? "#fff" : pos.color}
                            stroke={pos.color} strokeWidth={1.5}
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              leaderDragRef.current = { posId: pos.id };
                              setDraggingLeaderPosId(pos.id);
                            }}
                          />
                        )}
                        {/* Курсор при предпросмотре */}
                        {isDrawing && (
                          <circle cx={endSx} cy={endSy} r={isBranchAttached ? 8 : 5}
                            fill={isBranchAttached ? pos.color : "none"}
                            stroke={pos.color} strokeWidth={1.5}
                            opacity={isBranchAttached ? 0.9 : 0.7}
                            strokeDasharray={isBranchAttached ? undefined : "3,2"}
                            style={{ pointerEvents: "none" }} />
                        )}
                        {/* Кнопка переместить для привязанных к ветви */}
                        {isBranchAttached && !isDrawing && pos.id === selectedPositionId && (
                          <circle cx={endSx} cy={endSy} r={8}
                            fill="none" stroke={pos.color} strokeWidth={1.5}
                            strokeDasharray="4,2"
                            style={{ pointerEvents: "all", cursor: "crosshair" }}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              // Запускаем режим перерисовки выноски
                              setLeaderDrawMode(pos.id);
                              setLeaderCursorScreen(null);
                              setLeaderSnapBranch(null);
                            }}
                          />
                        )}
                      </g>
                    );
                  })}

                  {/* ── Маркеры позиций ── */}
                  {positions.map((pos) => {
                    if (pos.visible === false) return null;
                    const { sx, sy } = proj(pos.x, pos.y, pos.z ?? 0);
                    const r = (pos.diameter ?? 13) * PX_PER_MM / 2;
                    const isSelected = pos.id === selectedPositionId;
                    const isReverse = pos.positionType === "reverse";
                    const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
                    return (
                      <g
                        key={pos.id}
                        transform={`translate(${sx}, ${sy})`}
                        style={{ pointerEvents: "all", cursor: draggingPosId === pos.id ? "grabbing" : isSelected ? "grab" : "pointer" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          if (leaderDrawMode) { setLeaderDrawMode(null); setLeaderCursorScreen(null); setLeaderSnapBranch(null); }
                          const containerRect = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                          if (!containerRect) return;

                          const startSx = e.clientX - containerRect.left;
                          const startSy = e.clientY - containerRect.top;

                          // Детектируем двойной клик вручную (надёжнее браузерного dblclick)
                          const now = Date.now();
                          const lastClick = (e.currentTarget as SVGGElement & { _lastClick?: number })._lastClick ?? 0;
                          const isDouble = now - lastClick < 350;
                          (e.currentTarget as SVGGElement & { _lastClick?: number })._lastClick = now;

                          if (isDouble) {
                            // Двойной клик — открываем настройки позиции в левой панели
                            setSelectedPositionId(pos.id);
                            setActiveSide("positions");
                            setLeftPanelOpen(true);
                            setSelectedNodeId(null);
                            setSelectedBranchId(null);
                            return;
                          }

                          // Одиночный клик — выбор + готовность к перетаскиванию
                          setSelectedPositionId(pos.id);
                          setDraggingPosId(pos.id);
                          posDragRef.current = {
                            id: pos.id,
                            startSx,
                            startSy,
                            startWx: pos.x,
                            startWy: pos.y,
                          };
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isReverse && (
                          <>
                            <circle r={r + 7} fill="none" stroke="#e53e3e" strokeWidth={2.5} />
                            <circle r={r + 4} fill="none" stroke="#fff" strokeWidth={3} />
                          </>
                        )}
                        {isSelected && <circle r={r + 4} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="5,2.5" />}
                        <circle r={r} fill={pos.color} stroke={pos.borderColor} strokeWidth={2} />
                        <text
                          textAnchor="middle" dominantBaseline="central"
                          fill="#000" fontSize={fontSize}
                          fontWeight="bold" fontFamily="sans-serif"
                          style={{ userSelect: "none" }}
                        >
                          {pos.number}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}

            {/* Подсказка при drag/draw выноски */}
            {(draggingLeaderPosId || leaderDrawMode) && (
              <div style={{
                position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 12, fontWeight: 500,
                padding: "5px 14px", borderRadius: 6, pointerEvents: "none", zIndex: 100,
                letterSpacing: 0.2, boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}>
                {leaderDrawMode
                  ? "✛ Кликните на схеме для размещения конца выноски  [Esc — отмена]"
                  : "✛ Отпустите для фиксации выноски"}
              </div>
            )}

            {/* ─── Шкала распространения взрывной волны ────────────── */}
            {showExplosionZones && explosionCalcDone && explosionResult && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: "rgba(10,8,0,0.93)", borderTop: "2px solid #b45309",
                padding: "22px 12px 6px", display: "flex", alignItems: "center",
                gap: 8, zIndex: 60, backdropFilter: "blur(4px)", overflow: "visible",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fde68a", whiteSpace: "nowrap" }}>
                  💥 Волна взрыва
                </span>

                {/* Кнопка Воспроизведение / Пауза */}
                <button
                  onClick={() => {
                    if (blastAnimating) {
                      if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                      blastAnimRef.current = null;
                      setBlastAnimating(false);
                    } else {
                      setBlastWaveRadius(prev => prev >= blastMaxRadius ? 0 : prev);
                      setBlastAnimating(true);
                      blastAnimRef.current = setInterval(() => {
                        setBlastWaveRadius(prev => {
                          const next = prev + blastRadiusStep;
                          if (next >= blastMaxRadius) {
                            if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                            blastAnimRef.current = null;
                            setBlastAnimating(false);
                            return blastMaxRadius;
                          }
                          return next;
                        });
                      }, 120);
                    }
                  }}
                  title={blastAnimating ? "Пауза" : "Воспроизведение"}
                  style={{
                    background: blastAnimating ? "#92400e" : "#f59e0b",
                    border: "1px solid #b45309", borderRadius: 4, color: "#fff",
                    fontSize: 11, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
                    whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4,
                  }}>
                  {blastAnimating ? "⏸ Пауза" : "▶ Воспроизведение"}
                </button>

                {/* Сброс */}
                <button
                  onClick={() => {
                    if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                    blastAnimRef.current = null;
                    setBlastAnimating(false);
                    setBlastWaveRadius(0);
                  }}
                  style={{
                    background: "#1c1202", border: "1px solid #b45309", borderRadius: 4,
                    color: "#fde68a", fontSize: 11, padding: "2px 7px", cursor: "pointer",
                  }}>
                  ⏮
                </button>

                {/* Ползунок с маркерами зон */}
                <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
                  {/* Градиент фона */}
                  <div style={{
                    position: "absolute", top: "50%", left: 0, right: 0, height: 8,
                    transform: "translateY(-50%)", borderRadius: 4,
                    background: "linear-gradient(to right, #7c1010, #dc2626 15%, #f97316 30%, #fbbf24 50%, #22c55e)",
                    opacity: 0.45, pointerEvents: "none",
                  }} />

                  {/* Маркеры радиусов зон */}
                  {explosionResult && blastMaxRadius > 0 && [
                    { hazard: "lethal",  color: "#7c1010", label: "Л" },
                    { hazard: "heavy",   color: "#dc2626", label: "Т" },
                    { hazard: "medium",  color: "#f97316", label: "С" },
                    { hazard: "light",   color: "#fbbf24", label: "Л" },
                    { hazard: "safe",    color: "#22c55e", label: "Б" },
                  ].map(({ hazard, color, label }) => {
                    const zone = explosionResult.zones.find(z => z.hazardLevel === hazard);
                    const r = zone?.radius_m ?? 0;
                    if (r <= 0 || r > blastMaxRadius) return null;
                    const pct = Math.min(100, (r / blastMaxRadius) * 100);
                    return (
                      <div key={hazard} style={{
                        position: "absolute", top: -18, left: `${pct}%`,
                        transform: "translateX(-50%)",
                        pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center",
                      }}>
                        <span style={{ fontSize: 9, color, fontWeight: 700, whiteSpace: "nowrap", lineHeight: 1 }}>
                          {r}м
                        </span>
                        <div style={{ width: 1, height: 6, background: color, opacity: 0.8 }} />
                      </div>
                    );
                  })}

                  <input
                    type="range" min={0} max={blastMaxRadius} step={blastRadiusStep}
                    value={blastWaveRadius}
                    onChange={e => {
                      if (blastAnimRef.current) clearInterval(blastAnimRef.current);
                      blastAnimRef.current = null;
                      setBlastAnimating(false);
                      setBlastWaveRadius(Number(e.target.value));
                    }}
                    style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer", position: "relative", zIndex: 1, background: "transparent" }}
                  />
                </div>

                {/* Текущий радиус + давление */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: "#fff", background: "#92400e",
                    borderRadius: 4, padding: "1px 9px", whiteSpace: "nowrap", minWidth: 72, textAlign: "center",
                  }}>
                    R = {blastWaveRadius} м
                  </span>
                  {blastWaveRadius > 0 && (
                    <span style={{
                      fontSize: 10, color: "#fde68a", whiteSpace: "nowrap",
                    }}>
                      ΔP = {explosionResult.pressureAtDistance(blastWaveRadius).toFixed(1)} кПа
                    </span>
                  )}
                </div>

                <div style={{ width: 1, background: "#b45309", alignSelf: "stretch", margin: "0 2px" }} />

                {/* Настройки */}
                <span style={{ fontSize: 10, color: "#fde68a", whiteSpace: "nowrap" }}>Макс:</span>
                <input
                  type="number" min={10} max={5000} step={10}
                  value={blastMaxRadius}
                  onChange={e => {
                    const v = Math.max(10, Math.min(5000, Number(e.target.value)));
                    setBlastMaxRadius(v);
                    if (blastWaveRadius > v) setBlastWaveRadius(v);
                  }}
                  style={{
                    width: 52, fontSize: 11, background: "#1c1202", color: "#fde68a",
                    border: "1px solid #b45309", borderRadius: 3, padding: "1px 4px", textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "#fde68a" }}>м</span>

                <span style={{ fontSize: 10, color: "#fde68a", whiteSpace: "nowrap" }}>Шаг:</span>
                <select
                  value={blastRadiusStep}
                  onChange={e => setBlastRadiusStep(Number(e.target.value))}
                  style={{
                    fontSize: 11, background: "#1c1202", color: "#fde68a",
                    border: "1px solid #b45309", borderRadius: 3, padding: "1px 2px",
                  }}>
                  {[1, 2, 5, 10, 25, 50, 100].map(s => (
                    <option key={s} value={s}>{s} м</option>
                  ))}
                </select>
              </div>
            )}

            {/* ─── Временная шкала задымления ─────────────────────── */}
            {showSmoke && fireCalcDone && fireResult && (
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                background: "rgba(20,5,5,0.93)", borderTop: "2px solid #7f1d1d",
                padding: "5px 12px 6px", display: "flex", alignItems: "center",
                gap: 8, zIndex: 60, backdropFilter: "blur(4px)",
              }}>
                {/* Иконка + подпись */}
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fca5a5", whiteSpace: "nowrap" }}>
                  🔥 Задымление
                </span>

                {/* Кнопка Воспроизведение / Пауза */}
                <button
                  onClick={() => {
                    if (smokeAnimating) {
                      // Пауза
                      if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                      smokeAnimRef.current = null;
                      setSmokeAnimating(false);
                    } else {
                      // Если дошли до конца — сбрасываем на начало
                      setSmokeTimeMinutes(prev => prev >= smokeMaxTime ? 0 : prev);
                      setSmokeAnimating(true);
                      smokeAnimRef.current = setInterval(() => {
                        setSmokeTimeMinutes(prev => {
                          const next = prev + smokeTimeStep;
                          if (next >= smokeMaxTime) {
                            if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                            smokeAnimRef.current = null;
                            setSmokeAnimating(false);
                            return smokeMaxTime;
                          }
                          return next;
                        });
                      }, 800);
                    }
                  }}
                  title={smokeAnimating ? "Пауза" : "Воспроизведение"}
                  style={{
                    background: smokeAnimating ? "#7f1d1d" : "#dc2626",
                    border: "1px solid #991b1b", borderRadius: 4, color: "#fff",
                    fontSize: 11, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
                    whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4,
                  }}>
                  {smokeAnimating ? "⏸ Пауза" : "▶ Воспроизведение"}
                </button>

                {/* Кнопка сброс */}
                <button
                  onClick={() => {
                    if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                    smokeAnimRef.current = null;
                    setSmokeAnimating(false);
                    setSmokeTimeMinutes(0);
                  }}
                  title="Сначала"
                  style={{
                    background: "#3b0000", border: "1px solid #7f1d1d", borderRadius: 4,
                    color: "#fca5a5", fontSize: 11, padding: "2px 7px", cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  ⏮
                </button>

                {/* Метка начала */}
                <span style={{ fontSize: 11, color: "#f87171", whiteSpace: "nowrap" }}>0 мин</span>

                {/* Слайдер времени */}
                <input
                  type="range"
                  min={0}
                  max={smokeMaxTime}
                  step={smokeTimeStep}
                  value={smokeTimeMinutes}
                  onChange={e => {
                    if (smokeAnimRef.current) clearInterval(smokeAnimRef.current);
                    smokeAnimRef.current = null;
                    setSmokeAnimating(false);
                    setSmokeTimeMinutes(Number(e.target.value));
                  }}
                  style={{ flex: 1, accentColor: "#ef4444", cursor: "pointer", minWidth: 80 }}
                />

                {/* Метка конца */}
                <span style={{ fontSize: 11, color: "#f87171", whiteSpace: "nowrap" }}>{smokeMaxTime} мин</span>

                {/* Текущее время — крупно */}
                <span style={{
                  fontSize: 12, fontWeight: 700, color: "#fff", background: "#b91c1c",
                  borderRadius: 4, padding: "1px 9px", whiteSpace: "nowrap", minWidth: 72, textAlign: "center",
                }}>
                  T = {smokeTimeMinutes} мин
                </span>

                <div style={{ width: 1, background: "#7f1d1d", alignSelf: "stretch", margin: "0 2px" }} />

                {/* Настройка максимума */}
                <span style={{ fontSize: 10, color: "#fca5a5", whiteSpace: "nowrap" }}>Макс:</span>
                <input
                  type="number" min={1} max={600} step={1}
                  value={smokeMaxTime}
                  onChange={e => {
                    const v = Math.max(1, Math.min(600, Number(e.target.value)));
                    setSmokeMaxTime(v);
                    if (smokeTimeMinutes > v) setSmokeTimeMinutes(v);
                  }}
                  style={{
                    width: 48, fontSize: 11, background: "#3b0000", color: "#fca5a5",
                    border: "1px solid #7f1d1d", borderRadius: 3, padding: "1px 4px", textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "#fca5a5" }}>мин</span>

                {/* Настройка шага */}
                <span style={{ fontSize: 10, color: "#fca5a5", whiteSpace: "nowrap" }}>Шаг:</span>
                <select
                  value={smokeTimeStep}
                  onChange={e => setSmokeTimeStep(Number(e.target.value))}
                  style={{
                    fontSize: 11, background: "#3b0000", color: "#fca5a5",
                    border: "1px solid #7f1d1d", borderRadius: 3, padding: "1px 2px",
                  }}>
                  {[1, 2, 5, 10, 15, 30, 60].map(s => (
                    <option key={s} value={s}>{s} мин</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Водяной знак ДЕМО ─────────────────────────────── */}
            {isDemo && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center"
                style={{ zIndex: 10 }}>
                <div className="select-none"
                  style={{
                    fontSize: "clamp(48px, 8vw, 120px)",
                    fontWeight: 900,
                    color: "rgba(180,30,30,0.07)",
                    letterSpacing: "0.15em",
                    transform: "rotate(-35deg)",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}>
                  ДЕМО
                </div>
              </div>
            )}
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
                  positions={positions}
                  onPositionVisibilityChange={(id, visible) =>
                    setPositions((p) => p.map((pos) => pos.id === id ? { ...pos, visible } : pos))
                  }
                  onPositionBranchesVisibilityChange={(id, branchesVisible) =>
                    setPositions((p) => p.map((pos) => pos.id === id ? { ...pos, branchesVisible } : pos))
                  }
                  onAllPositionsVisibility={(visible, branchesVisible) =>
                    setPositions((p) => p.map((pos) => ({ ...pos, visible, branchesVisible })))
                  }
                />
              </div>

              {/* Масштаб XY и Z */}
              <div className="border-t border-gray-300 px-2 py-2 flex-shrink-0" style={{ background: "#f5f5f5" }}>
                {/* XY */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold" style={{ color: "#1a3a6b" }}>Масштаб XY: ×{xyScale.toFixed(1)}</span>
                  <button onClick={() => setXyScale(1)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-400 hover:bg-gray-200 ml-auto">
                    Сброс
                  </button>
                </div>
                <input type="range" min="0.1" max="10" step="0.1"
                  value={xyScale}
                  onChange={(e) => setXyScale(parseFloat(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#16a34a" }} />
                <div className="flex justify-between text-[10px] text-gray-400 mb-2">
                  <span>0.1×</span><span>5×</span><span>10×</span>
                </div>
                {/* Z */}
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
                    onClick={() => {}}>
                    {icons[revDiag.level]} Реверс
                  </span>
                );
              })()}
            </>
          ) : (
            <span style={{ color: "#9ca3af" }}>● Расчёт не выполнялся</span>
          )}

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

    {/* ═══ ДИАЛОГ НАСТРОЙКИ ПРЕДЕЛОВ МАСШТАБОВ ═══════════════════════ */}
    {scaleSettingsOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={() => setScaleSettingsOpen(false)}>
        <div className="bg-white shadow-2xl border border-gray-300 flex"
          style={{ minWidth: 600, fontFamily: "Segoe UI, Tahoma, sans-serif", borderRadius: 0 }}
          onClick={e => e.stopPropagation()}>
          {/* Левая панель (дерево) */}
          <div className="border-r border-gray-300" style={{ width: 180, background: "#f5f5f5" }}>
            <div className="px-3 py-2 border-b border-gray-300 text-[12px] font-semibold text-gray-700" style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
              Настройки технологической схемы
            </div>
            <div className="py-1">
              {["Схема", "Единицы измерения", "Координатная сетка", "Размеры объектов", "Пределы масштабов", "Цвета и шрифты"].map((item, i) => (
                <div key={i}
                  className="px-3 py-1 text-[12px] cursor-pointer"
                  style={{
                    background: item === "Пределы масштабов" ? "#0078d7" : "transparent",
                    color: item === "Пределы масштабов" ? "white" : "#222",
                    paddingLeft: i > 0 ? 24 : 12,
                  }}>
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Правая панель (содержимое) */}
          <div className="flex flex-col" style={{ flex: 1 }}>
            {/* Заголовок */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-300"
              style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
              <span className="text-[12px] font-semibold text-gray-800">Настройки технологической схемы</span>
              <button onClick={() => setScaleSettingsOpen(false)}
                className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">
                <Icon name="X" size={12} />
              </button>
            </div>

            <div className="px-6 py-4 flex-1">
              <div className="text-[14px] font-semibold text-gray-800 mb-4">Пределы масштабов</div>

              {/* Таблица */}
              <table className="text-[12px] w-full mb-4" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-4 font-normal text-gray-500" style={{ width: "50%" }}></th>
                    <th className="text-center py-1 px-3 font-semibold text-gray-700" style={{ width: "25%" }}>Минимум</th>
                    <th className="text-center py-1 px-3 font-semibold text-gray-700" style={{ width: "25%" }}>Максимум</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Строка 1: Текстовые объекты */}
                  <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "top" }}>
                      Размер текстовых объектов<br />
                      <span className="text-[11px] text-gray-500">(номер узла, номер ветви, номер устройства, название и т.п.)</span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" min={10} max={500} value={scaleTextMin}
                          onChange={e => setScaleTextMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" min={10} max={500} value={scaleTextMax}
                          onChange={e => setScaleTextMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                  </tr>

                  {/* Строка 2: Толщина ветви */}
                  <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td className="py-2 pr-4" style={{ verticalAlign: "middle" }}>
                      <div className="text-gray-700">Толщина ветви</div>
                      <div className="flex items-center gap-3 mt-1">
                        <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                          <input type="radio" name="scaleMode" checked={scaleBranchMode === "relative"}
                            onChange={() => setScaleBranchMode("relative")}
                            style={{ accentColor: "#0078d7", width: 12, height: 12 }} />
                          Относит. масштаба
                        </label>
                        <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                          <input type="radio" name="scaleMode" checked={scaleBranchMode === "fixed"}
                            onChange={() => setScaleBranchMode("fixed")}
                            style={{ accentColor: "#0078d7", width: 12, height: 12 }} />
                          Фиксированные знач.
                        </label>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" min={10} max={500} value={scaleBranchMin}
                          onChange={e => setScaleBranchMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" min={10} max={500} value={scaleBranchMax}
                          onChange={e => setScaleBranchMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                  </tr>

                  {/* Строка 3: Устройства */}
                  <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                      <div className="text-gray-700">Размер устройств</div>
                      <span className="text-[11px] text-gray-500">(вентиляторы, усл. обозн., люди и т.п. кроме перемычек)</span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" min={10} max={500} value={scaleSymbolMin}
                          onChange={e => setScaleSymbolMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <input type="number" min={10} max={500} value={scaleSymbolMax}
                          onChange={e => setScaleSymbolMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                  </tr>

                  {/* Строка 4: Ветви в одну линию */}
                  <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                    <td className="py-2 pr-4 text-gray-700" colSpan={1}>
                      Ветви в одну линию при масштабе &lt;=
                    </td>
                    <td className="py-2 px-3" colSpan={2}>
                      <div className="flex items-center gap-2">
                        <input type="number" min={1} max={100} value={scaleSingleLineAt}
                          onChange={e => setScaleSingleLineAt(Math.max(1, Math.min(100, Number(e.target.value))))}
                          className="text-right text-[12px] px-1"
                          style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Подвал диалога */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-gray-300" style={{ background: "#f5f5f5" }}>
              <button
                onClick={() => {
                  setScaleTextMin(80); setScaleTextMax(150);
                  setScaleBranchMin(80); setScaleBranchMax(150);
                  setScaleSymbolMin(80); setScaleSymbolMax(220);
                  setScaleBranchMode("relative"); setScaleSingleLineAt(10);
                }}
                className="px-4 py-1 text-[12px] border border-gray-400 bg-white hover:bg-gray-100"
                style={{ minWidth: 70 }}>
                Сброс
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setScaleLimitsEnabled(true);
                    setScaleSettingsOpen(false);
                  }}
                  className="px-4 py-1 text-[12px] border border-gray-500 bg-white hover:bg-gray-100"
                  style={{ minWidth: 70 }}>
                  ОК
                </button>
                <button
                  onClick={() => setScaleSettingsOpen(false)}
                  className="px-4 py-1 text-[12px] border border-gray-500 bg-white hover:bg-gray-100"
                  style={{ minWidth: 70 }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )}

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

    {/* ═══ CSV ИМПОРТ (Ventsim) ════════════════════════════════════════════ */}
    {showVentsimImport && (
      <VentsimImportDialog
        onImport={handleVentsimImport}
        onClose={() => setShowVentsimImport(false)}
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

    {/* ═══ ШИРОКОФОРМАТНАЯ ПЕЧАТЬ ════════════════════════════════════════ */}
    {showPrintDialog && (
      <PrintDialog
        onClose={() => setShowPrintDialog(false)}
        projectName={projectFileName.replace(/\.vproj$/, "")}
        nodes={nodes}
        branches={branches}
        horizons={horizons}
        schemaSymbols={schemaSymbols}
        viewState={savedViewState ?? { scale: 0.4, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 }}
        canvasSize={canvasSize}
        branchWidth={branchWidth}
        branchBorder={branchBorder}
        thinLines={thinLines}
        colorByHorizon={colorByHorizon}
        flowDisplay={flowDisplay}
        infoConfig={infoConfig}
        unitsConfig={unitsConfig}
        zScale={zScale}
        getSvgRaw={() => getSvgRef.current?.() ?? ""}
        colorMode={colorMode}
        posInnerColors={posColorInner && positions.length > 0 ? (() => {
          const m = new Map<string, string>();
          positions.forEach(pos => pos.branchIds.forEach(bid => { if (!m.has(bid)) m.set(bid, pos.color); }));
          return m.size > 0 ? m : undefined;
        })() : undefined}
        posOuterColors={posColorOuter && positions.length > 0 ? (() => {
          const m = new Map<string, string>();
          positions.forEach(pos => pos.branchIds.forEach(bid => { if (!m.has(bid)) m.set(bid, pos.color); }));
          return m.size > 0 ? m : undefined;
        })() : undefined}
        positions={positions}
        showPositions={showPositions}
        initialOpenExport={printDialogOpenExport}
        onExportDialogOpened={() => setPrintDialogOpenExport(false)}
      />
    )}

    {/* ═══ ПАНЕЛЬ ДИАГНОСТИКИ РАСЧЁТА — скрыта ══════════════════════════ */}

    {/* ═══ АВТОНУМЕРАЦИЯ ОБЪЕКТОВ ═══════════════════════════════════════ */}
    {showRenumberDialog && (
      <RenumberDialog
        nodeCount={nodes.length}
        branchCount={branchesRaw.length}
        horizons={horizons.map((h) => ({ id: h.id, name: h.name }))}
        onClose={() => setShowRenumberDialog(false)}
        onConfirm={(opts) => {
          renumberAll(opts);
          setShowRenumberDialog(false);
        }}
      />
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

    {/* ── Окно «О программе» ──────────────────────────────────────────── */}
    {showAbout && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={() => setShowAbout(false)}>
        <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-[460px] overflow-hidden"
          style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}
          onClick={(e) => e.stopPropagation()}>
          {/* Шапка диалога */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200"
            style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)" }}>
            <span className="text-[12px] font-semibold text-gray-800">О программе</span>
            <button
              onClick={() => setShowAbout(false)}
              className="w-6 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded-sm">✕</button>
          </div>

          {/* Контент */}
          <div className="px-6 py-6 flex flex-col items-center text-center"
            style={{ background: "linear-gradient(160deg, #ffffff 0%, #eaf4fc 100%)" }}>
            <img
              src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/ef0b03a9-fdf4-4a39-bd09-13ae79b760a9.png"
              alt="ПВ-Система"
              className="w-48 object-contain mb-2"
              style={{ filter: "drop-shadow(0 4px 12px rgba(14,99,176,0.15))" }}
              draggable={false}
            />

            <div className="w-full mt-5 border-t border-gray-200 pt-4 text-left text-[12px] text-gray-700 space-y-1.5">
              <div className="flex justify-between"><span className="text-gray-500">Версия:</span><span className="font-medium">1.0.0</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Сборка:</span><span className="font-medium">2026.05</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Назначение:</span><span className="font-medium">Проектирование систем вентиляции и водоснабжения</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Платформа:</span><span className="font-medium">Web / Desktop / PWA</span></div>
              {(() => {
                const isStandalone = window.matchMedia("(display-mode: standalone)").matches
                  || (navigator as unknown as { standalone?: boolean }).standalone === true;
                const isOnline = navigator.onLine;
                const mode = isStandalone ? "Установленное приложение" : "Браузер";
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Запуск:</span>
                      <span className="font-medium flex items-center gap-1.5">
                        <Icon name={isStandalone ? "MonitorSmartphone" : "Globe"} size={12} className="text-blue-600" />
                        {mode}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Сеть:</span>
                      <span className="font-medium flex items-center gap-1.5">
                        <span style={{
                          width: 8, height: 8, borderRadius: 999,
                          background: isOnline ? "#22c55e" : "#f59e0b",
                          display: "inline-block",
                        }} />
                        {isOnline ? "Онлайн" : "Офлайн-режим"}
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="w-full mt-4 pt-3 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed">
              © 2026 ПВ-Система. Все права защищены.<br/>
              Программа предназначена для проектирования систем<br/>
              вентиляции и водоснабжения рудников и шахт.
            </div>
          </div>

          {/* Футер */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
            <button
              onClick={() => setShowAbout(false)}
              className="h-7 px-4 text-[12px] rounded text-white font-medium"
              style={{ background: "#2563eb" }}>
              OK
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Диалог лицензии ─────────────────────────────────────────────── */}
    {showLicenseDialog && (
      <LicenseDialog
        license={license}
        onClose={() => setShowLicenseDialog(false)}
        required={isDemo && !license.info}
      />
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