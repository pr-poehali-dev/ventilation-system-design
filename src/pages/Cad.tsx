import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Icon from "@/components/ui/icon";
import { useLicenseContext } from "@/context/LicenseContext";
import AppLogo from "@/components/AppLogo";
import TopoCanvas, { type CadTool } from "@/components/cad/TopoCanvas";
import {
  type TopoNode, type TopoBranch, type Horizon,
  DEMO_NODES, DEMO_BRANCHES, OVERVIEW_HORIZON_ID, recalcAll, makeNode, makeBranch,
  project3D, unprojectToPlane, calcBranchLength,
} from "@/lib/topology";
import { SURFACE_TYPES, calcSection } from "@/lib/aerodynamics";
import { solveNetwork, type SolveResult } from "@/lib/networkSolver";
import { FAN_CATALOG, getFanById, fanEfficiency, fanShaftPower } from "@/lib/fanCurves";
import FanCurveChart from "@/components/cad/FanCurveChart";
import NodePropsPanel from "@/components/cad/NodePropsPanel";
import NodeFirePanel from "@/components/cad/NodeFirePanel";
import BranchPropsPanel from "@/components/cad/BranchPropsPanel";
import type { WaterNodeResult, WaterBranchResult } from "@/lib/waterHydraulics";
import InfoPanel from "@/components/cad/InfoPanel";
import { type InfoDisplayConfig, DEFAULT_INFO_CONFIG } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG, getUnit } from "@/lib/unitsConfig";
import { type DxfImportResult } from "@/lib/dxfImport";
import PositionsPanel from "@/components/cad/PositionsPanel";
import { type Position, makePosition } from "@/lib/positions";
import { type ExcelImportResult } from "@/lib/excelImport";
import { type CombinedImportResult } from "@/lib/combinedImport";
import { type CsvImportResult } from "@/lib/csvImport";
import { type VentsimImportResult } from "@/lib/ventsimImport";
import { type MineFanExport, type MineBulkheadExport, type BranchType } from "@/components/cad/EquipmentRefDialog";
import { BULKHEAD_CATALOG, airPermToR, branchBulkheadRkMurg } from "@/lib/bulkheads";
import { checkSchema } from "@/lib/schemaCheck";
import { type RenumberOptions } from "@/components/cad/RenumberDialog";
import { LEGEND_TYPES, BULKHEAD_SYMBOL_IDS, WINDOW_BULKHEAD_IDS, OPEN_DOOR_IDS, REDUCER_SYMBOL_IDS, FIRE_SYMBOL_IDS, EXPLOSION_SYMBOL_IDS } from "@/lib/schemaSymbols";
import { getValveById, PRESSURE_REDUCING_VALVES } from "@/lib/pressureReducingValves";
import { type PumpModel } from "@/lib/pumps";
import PumpPanel from "@/components/cad/PumpPanel";
import { calcFireMode, calcFireTemp, calcThermalDepression, COMBUSTIBLES, VEHICLE_MATERIALS, calcVehicleFire, calcFirePowerFromMaterial, type FireCalculationResult, type VehicleFireResult } from "@/lib/fireCalculator";
import { calcExplosion, GAS_TYPES, EXPLOSIVE_TYPES, type ExplosionResult, type ExplosionMethod, type ExplosionSourceType } from "@/lib/explosionCalculator";
import { type LogEntry } from "@/components/cad/LogPanel";
import RescuePanel from "@/components/cad/RescuePanel";
import WorkerPathPanel, { type WorkerPickMode } from "@/components/cad/WorkerPathPanel";
import { useRecentFiles, saveRecentData, loadRecentData, saveHandleToIDB, loadHandleFromIDB } from "@/lib/useRecentFiles";
import { INSTALLER_URL, fetchRemoteVersion } from "@/lib/updater";
import { calcBranchFirePower, type FireStabilityFact } from "@/lib/fireStability";
import { API_URLS } from "@/lib/api-urls";
import {
  type RibbonTab, type SideTab, type CompareStatus, type CompareResult,
  type CompareBranchDiff, type CompareNodeDiff,
  type TextBlock, type Excavation, type ViewPresetName,
  makeTextBlock, DEFAULT_EXC, LAYERS,
} from "./cad/cadTypes";
export type { SchemaSymbol } from "./cad/cadTypes";
import CadImportDialogs from "./cad/CadImportDialogs";
import CadToolDialogs from "./cad/CadToolDialogs";
import CadModals from "./cad/CadModals";
import {
  RibbonTabBtn, RibbonGroup, RibbonBigBtn, RibbonSmallBtn,
  PentagonIcon, RectIcon, MiniSquareIcon,
  PropGroup, SelectRow, SelectRowLabeled, FieldRow, CheckRow,
  FrameGroup, LabeledRow, CadCheckbox, NumWithUnit, ComputedRow,
  ToolBtn, toolLabel, ViewBtn, FlowBtn,
} from "./cad/cadComponents";

const AIRFLOW_URL      = API_URLS.airflow;
const EXPLOSION_URL    = API_URLS.explosionCalculator;
const WATER_URL        = API_URLS.waterHydraulics;

// Отправка запроса на расчёт воздухораспределения. Большие схемы (тысячи
// ветвей) весят несколько МБ и упираются в лимит размера тела запроса —
// поэтому крупный JSON сжимаем gzip прямо в браузере (CompressionStream).
//
// ВАЖНО: сжатое тело передаём НЕ бинарно и НЕ через заголовок
// Content-Encoding: gzip. И то, и другое ненадёжно — прокси/шлюз (особенно
// десктопный WebView2/C#) может распаковать тело сам, потерять заголовок или
// «испортить» бинарные байты, и функция получала мусор → «Ошибка парсинга
// JSON» на схемах >2000 ветвей.
//
// Надёжный транспорт: gzip → base64 → кладём строкой в обычный JSON-конверт
// {"__gzip__": "<base64>"}. Content-Type остаётся application/json, тело —
// чистый текст, который ни один прокси не трогает. Бэкенд первым делом
// распознаёт конверт и распаковывает.
async function postAirflow(body: unknown): Promise<Response> {
  const json = JSON.stringify(body);
  const canGzip = typeof (globalThis as { CompressionStream?: unknown }).CompressionStream !== "undefined";
  // Порог 512 КБ: мелкие запросы быстрее отправить без сжатия
  if (canGzip && json.length > 512_000) {
    try {
      const stream = new Response(json).body!.pipeThrough(
        new CompressionStream("gzip"),
      );
      const gzBuf = await new Response(stream).arrayBuffer();
      // Uint8Array → base64 порциями (btoa не принимает большие строки целиком)
      const bytes = new Uint8Array(gzBuf);
      let bin = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const b64 = btoa(bin);
      return fetch(AIRFLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ __gzip__: b64 }),
      });
    } catch {
      // fallback ниже
    }
  }
  return fetch(AIRFLOW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CAD-интерфейс шахтной/вентиляционной сети в стиле инженерного ПО
// (АэроСеть / Вентиляция-CAD): ribbon-меню + вертикальные вкладки + свойства
// ─────────────────────────────────────────────────────────────────────────────

export default function CadPage() {
  const license = useLicenseContext();
  const isDemo = license.status === "demo";
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);

  // При первом запуске без лицензии показываем диалог активации
  useEffect(() => {
    if (license.status === "demo") setShowLicenseDialog(true);
  }, [license.status]);

  // Открытие .vproj файла из десктопа (двойной клик по файлу в проводнике).
  // ВАЖНО: window.electronAPI инжектируется C# (WebView2) и может появиться
  // ПОЗЖЕ, чем смонтируется React. Раньше эффект просто выходил, если API ещё
  // не было — из-за чего файл не открывался и показывался пустой новый проект.
  // Теперь ждём появления electronAPI (короткий поллинг) и только затем
  // регистрируем обработчик открытия файла.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type EAPI = { onOpenFile?: (h: (f: { path: string; content: string }) => void) => void; offOpenFile?: () => void };
    let cancelled = false;
    let registered: EAPI | null = null;

    const handler = ({ content }: { path: string; content: string }) => {
      try {
        const data = JSON.parse(content);
        if (data && data.nodes && Array.isArray(data.nodes)) {
          applyProjectData(data, data.name || "project.vproj");
        }
      } catch { /* повреждённый файл — тихо игнорируем */ }
    };

    const tryRegister = () => {
      if (cancelled) return true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eAPI = (window as any).electronAPI as EAPI | undefined;
      if (eAPI?.onOpenFile) {
        registered = eAPI;
        eAPI.onOpenFile(handler);
        return true;
      }
      return false;
    };

    if (!tryRegister()) {
      // Поллинг до 5 секунд (25 × 200мс) — на случай позднего инжекта моста C#
      let tries = 0;
      const iv = window.setInterval(() => {
        if (tryRegister() || ++tries >= 25) window.clearInterval(iv);
      }, 200);
      return () => { cancelled = true; window.clearInterval(iv); registered?.offOpenFile?.(); };
    }
    return () => { cancelled = true; registered?.offOpenFile?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      rMkyurg: airPermToR(item.airPermeability) / 1000, // Мюрг → кМюрг
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    }))
  );
  const [mineTypes, setMineTypes] = useState<BranchType[]>([]);

  // ─── Топология ─────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [branchesRaw, setBranches] = useState<TopoBranch[]>([]);

  // ─── Текстовые блоки ────────────────────────────────────────────────────
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [selectedTextBlockId, setSelectedTextBlockId] = useState<string | null>(null);
  const [editingTextBlockId, setEditingTextBlockId] = useState<string | null>(null);
  const textDragRef = useRef<{ id: string; startSx: number; startSy: number; startWx: number; startWy: number } | null>(null);
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);

  // ─── История изменений (undo) ───────────────────────────────────────────
  const historyRef = useRef<Array<{ nodes: TopoNode[]; branches: TopoBranch[]; symbols: SchemaSymbol[]; textBlocks: TextBlock[] }>>([]);
  const nodesRef      = useRef(nodes);
  const branchesRef   = useRef(branchesRaw);
  const symbolsRef    = useRef<SchemaSymbol[]>([]);
  const textBlocksRef = useRef<TextBlock[]>([]);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { branchesRef.current = branchesRaw; }, [branchesRaw]);
  useEffect(() => { textBlocksRef.current = textBlocks; }, [textBlocks]);

  const pushHistory = () => {
    historyRef.current = [...historyRef.current.slice(-49),
      { nodes: nodesRef.current, branches: branchesRef.current, symbols: symbolsRef.current, textBlocks: textBlocksRef.current }];
  };
  const handleUndo = () => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    setNodes(snap.nodes);
    setBranches(snap.branches);
    setSchemaSymbols(snap.symbols);
    setTextBlocks(snap.textBlocks ?? []);
  };

  // Keydown: Esc сбрасывает режим textblock/редактирование, Delete удаляет выбранный блок
  const selectedTextBlockIdRef = useRef<string | null>(null);
  const editingTextBlockIdRef  = useRef<string | null>(null);
  useEffect(() => { selectedTextBlockIdRef.current = selectedTextBlockId; }, [selectedTextBlockId]);
  useEffect(() => { editingTextBlockIdRef.current  = editingTextBlockId;  }, [editingTextBlockId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        if (editingTextBlockIdRef.current) { setEditingTextBlockId(null); return; }
        setTool(t => t === "textblock" ? "select" : t);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedTextBlockIdRef.current && !editingTextBlockIdRef.current) {
        e.preventDefault();
        const id = selectedTextBlockIdRef.current;
        pushHistory();
        setTextBlocks(prev => prev.filter(t => t.id !== id));
        setSelectedTextBlockId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
   
  }, []);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [tool, setTool] = useState<CadTool>("select");
  const [zLevel, setZLevel] = useState(0);

  // Авто-пересчёт длин и аэродинамики по координатам/параметрам
  const branches = useMemo(() => recalcAll(nodes, branchesRaw), [nodes, branchesRaw]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  // Гидравлический расчёт водопроводной сети ППЗ (backend).
  // Сам useEffect вынесен ниже — после объявления schemaSymbols, т.к. он его использует.
  const [waterNetwork, setWaterNetwork] = useState<{ nodeResults: Map<string, WaterNodeResult>; branchResults: Map<string, WaterBranchResult> }>({ nodeResults: new Map(), branchResults: new Map() });

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

  // Синхронизация расчётной мощности пожара из свойств горючего материала →
  // fireHeatRelease. Мощность считается из физических свойств материала (кабель,
  // дерево, конвейер, техника) — так же, как во вкладке «Пожарная нагрузка»,
  // чтобы температура продуктов совпадала. Для угля/масла/произвольного авто-
  // расчёта нет — там мощность вводится вручную.
  useEffect(() => {
    const b = selectedBranch;
    if (!b?.hasFire) return;
    const autoPower = calcFirePowerFromMaterial({
      fireCombustible: b.fireCombustible,
      flow: b.flow,
      length: b.length,
      fireVehicleMassRubber: b.fireVehicleMassRubber,
      fireVehicleMassDiesel: b.fireVehicleMassDiesel,
      fireVehicleMassOil: b.fireVehicleMassOil,
      fireCableHeatValue: b.fireCableHeatValue, fireCableBurnRate: b.fireCableBurnRate,
      fireCableDensity: b.fireCableDensity, fireCableLength: b.fireCableLength,
      fireCableWidth: b.fireCableWidth, fireCableThick: b.fireCableThick,
      fireWoodHeatValue: b.fireWoodHeatValue, fireWoodBurnRate: b.fireWoodBurnRate,
      fireWoodDensity: b.fireWoodDensity, fireWoodLength: b.fireWoodLength,
      fireWoodWidth: b.fireWoodWidth, fireWoodThick: b.fireWoodThick,
      fireWoodFlameSpeed: b.fireWoodFlameSpeed, fireWoodCalcTime: b.fireWoodCalcTime,
      fireBeltBurnRate: b.fireBeltBurnRate, fireBeltDensity: b.fireBeltDensity,
      fireBeltWidth: b.fireBeltWidth, fireBeltLength: b.fireBeltLength,
      fireBeltThickness: b.fireBeltThickness, fireBeltFlameSpeed: b.fireBeltFlameSpeed,
      fireSourceArea: b.fireSourceArea, fireSourceBurnRate: b.fireSourceBurnRate,
    });
    if (autoPower == null || autoPower <= 0) return;
    const airQ = Math.abs(b.flow ?? 0);
    const roundedPower = Math.round(autoPower * 100) / 100;
    if (Math.abs((b.fireHeatRelease ?? 5) - roundedPower) > 0.01) {
      updateBranch(b.id, { fireHeatRelease: roundedPower });
    }
    if ((b.fireMode ?? "heat") === "temp" && airQ > 0) {
      const calcTemp = Math.round(calcFireTemp(roundedPower, airQ, AMBIENT_TEMP));
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
    selectedBranch?.fireCableHeatValue, selectedBranch?.fireCableBurnRate,
    selectedBranch?.fireCableDensity, selectedBranch?.fireCableLength,
    selectedBranch?.fireCableWidth, selectedBranch?.fireCableThick,
    selectedBranch?.fireWoodHeatValue, selectedBranch?.fireWoodBurnRate,
    selectedBranch?.fireWoodDensity, selectedBranch?.fireWoodLength,
    selectedBranch?.fireWoodWidth, selectedBranch?.fireWoodThick,
    selectedBranch?.fireBeltBurnRate, selectedBranch?.fireBeltDensity,
    selectedBranch?.fireBeltWidth, selectedBranch?.fireBeltLength,
    selectedBranch?.fireBeltThickness,
    selectedBranch?.fireSourceArea, selectedBranch?.fireSourceBurnRate,
    selectedBranch?.fireMode,
    selectedBranch?.flow,
    selectedBranch?.length,
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

  // Наведение на горизонт в списке слева → подсветка его ветвей на схеме
  const [hoveredHorizonId, setHoveredHorizonId] = useState<string | null>(null);

  // Быстрое перемещение горизонта на передний/задний план списка слоёв
  const moveHorizonToFront = (id: string) => {
    setHorizons(prev => {
      const idx = prev.findIndex(h => h.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.unshift(moved);
      return next;
    });
  };
  const moveHorizonToBack = (id: string) => {
    setHorizons(prev => {
      const idx = prev.findIndex(h => h.id === id);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.push(moved);
      return next;
    });
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
        const aspect = w / h;
        // Вычисляем центр схемы из координат узлов (самый надёжный способ)
        const curNodes = nodesRef.current;
        let worldCx = 0, worldCy = 0, halfH = 1000, halfW = halfH * aspect;
        if (curNodes.length > 0) {
          const xs = curNodes.map(n => n.x);
          const ys = curNodes.map(n => n.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          worldCx = (minX + maxX) / 2;
          worldCy = (minY + maxY) / 2;
          // Размер подложки: покрываем всю схему с запасом
          const spanX = Math.max(maxX - minX, 1000);
          const spanY = Math.max(maxY - minY, 1000);
          // Подбираем halfW и halfH чтобы схема вписалась с соотношением сторон картинки
          halfW = Math.max(spanX, spanY * aspect) * 0.75;
          halfH = halfW / aspect;
        } else {
          // Нет узлов — берём центр видимой области через savedViewState
          const vs = savedViewStateRef.current;
          const sc = vs?.scale ?? 1;
          const ox = vs?.offsetX ?? 0;
          const oy = vs?.offsetY ?? 0;
          const xy = xyScale ?? 1;
          const screenCx = window.innerWidth / 2;
          const screenCy = window.innerHeight / 2;
          worldCx = ((screenCx - ox) / sc) / (xy || 1);
          worldCy = -((screenCy - oy) / sc) / (xy || 1);
          halfH = Math.abs((window.innerHeight * 0.35) / sc) / (xy || 1);
          halfW = halfH * aspect;
        }
        setHorizons((p) => p.map((hz) => hz.id === horizonId ? {
          ...hz,
          image: {
            dataUrl: compressed,
            bounds: {
              x1: worldCx - halfW, y1: worldCy - halfH,
              x2: worldCx + halfW, y2: worldCy + halfH,
            },
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
        // Автонумерация задаёт только НОМЕР узла. Название оставляем пустым,
        // если оно было автоматическим ("Узел N" / совпадает с id). Осмысленное
        // пользовательское название сохраняем.
        const isAutoName = !n.name || n.name.startsWith("Узел ") || n.name === oldId;
        return { ...n, id: newId, number: newId, name: isAutoName ? "" : n.name };
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
      name: "",
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

  // ─── ПОСТРОЕНИЕ ВЕНТ. ТРУБОПРОВОДА КАК ПАРАЛЛЕЛЬНОЙ НИТИ ─────────────
  // По выбранным ветвям строим ОТДЕЛЬНУЮ нить трубопровода: дубликаты узлов
  // маршрута со смещением вбок, соединённые узкими светло-серыми ветвями
  // (isVentPipeBranch, ширина ~20% от ветви). Концы нити привязаны к первому и
  // последнему узлу маршрута — через трубопровод пойдёт воздух (можно ставить ВМП).
  const buildVentPipeLine = (branchIds: string[], vpPatchRaw: Partial<TopoBranch>): void => {
    const brMap = new Map(branchesRaw.map((b) => [b.id, b]));
    const selected = branchIds.map((id) => brMap.get(id)).filter(Boolean) as TopoBranch[];
    if (selected.length === 0) return;

    // Параметры трубы (диаметр, материал, R, утечки и т.д.) переносим на ветви
    // нити — тогда они видны и редактируемы во вкладке свойств ветви. Флаг
    // hasVentPipe оставляем true (нужен для отображения параметров), а лишний
    // пунктирный legacy-оверлей для таких ветвей скрыт по isVentPipeBranch.
    // Вентилятор на ветви вентрубопровода НЕ ставим — явно снимаем hasFan,
    // иначе на нити появляется лишний символ ВМП.
    const noFan: Partial<TopoBranch> = { hasFan: false };
    const vpPatch: Partial<TopoBranch> = { ...vpPatchRaw, hasVentPipe: true, ...noFan };

    // ── РЕДАКТИРОВАНИЕ существующей нити ────────────────────────────────
    // Если ВСЕ выбранные ветви — уже ветви вентрубопровода (isVentPipeBranch),
    // значит пользователь повторно открыл диалог для готовой нити. В этом случае
    // НЕ создаём дубликат, а обновляем эти ветви на месте (синхронизируем
    // геометрию сечения и распределённое сопротивление трубы).
    if (selected.every((b) => b.isVentPipeBranch)) {
      pushHistory();
      const editDiaM = (vpPatchRaw.vpDiameter ?? 500) / 1000;
      const editSec = calcSection({ shape: "round", diameter: editDiaM });
      const editGeom: Partial<TopoBranch> = {
        shape: "round",
        diameter: editDiaM,
        area: Math.round(editSec.area * 1000) / 1000,
        perimeter: Math.round(editSec.perimeter * 1000) / 1000,
        dh: Math.round(editSec.dh * 1000) / 1000,
        manualSection: false,
      };
      // Ручной R (если задан) распределяем по длине сегментов; иначе каждый
      // сегмент считает R по формуле R=6.48·α·L/D⁵ (режим "pipe" из vpPatch).
      const editManualR = vpPatchRaw.vpManualR && vpPatchRaw.vpManualR > 0 ? vpPatchRaw.vpManualR : 0;
      const mainLen = selected.reduce((s, b) => s + (b.length ?? 0), 0) || 1;
      const idSet = new Set(branchIds);
      setBranches((prev) => prev.map((b) => {
        if (!idSet.has(b.id)) return b;
        const manualOverride: Partial<TopoBranch> = editManualR > 0
          ? { resistanceMode: "manual", manualR: editManualR * ((b.length ?? 0) / mainLen) }
          : {};
        return {
          ...b,
          ...vpPatch,
          ...editGeom,
          ...manualOverride,
        };
      }));
      return;
    }

    // 1) Упорядочиваем ветви в цепочку from→to и получаем последовательность узлов.
    type Item = { b: TopoBranch; fromId: string; toId: string };
    const chain: Item[] = [{ b: selected[0], fromId: selected[0].fromId, toId: selected[0].toId }];
    const rest = selected.slice(1);
    let changed = true;
    while (rest.length && changed) {
      changed = false;
      for (let i = 0; i < rest.length; i++) {
        const b = rest[i];
        const head = chain[0], tail = chain[chain.length - 1];
        if (b.fromId === tail.toId) { chain.push({ b, fromId: b.fromId, toId: b.toId }); rest.splice(i, 1); changed = true; break; }
        if (b.toId === tail.toId)   { chain.push({ b, fromId: b.toId, toId: b.fromId }); rest.splice(i, 1); changed = true; break; }
        if (b.toId === head.fromId) { chain.unshift({ b, fromId: b.fromId, toId: b.toId }); rest.splice(i, 1); changed = true; break; }
        if (b.fromId === head.fromId){ chain.unshift({ b, fromId: b.toId, toId: b.fromId }); rest.splice(i, 1); changed = true; break; }
      }
    }
    // Ветви, не примкнувшие к цепочке (разрыв) — добавляем как есть в конец.
    for (const b of rest) chain.push({ b, fromId: b.fromId, toId: b.toId });

    // 2) Последовательность узлов маршрута.
    const nodeSeq: string[] = [chain[0].fromId];
    for (const c of chain) nodeSeq.push(c.toId);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    // Смещение нити вбок — перпендикулярно среднему направлению маршрута.
    const firstN = nodeMap.get(nodeSeq[0]);
    const lastN = nodeMap.get(nodeSeq[nodeSeq.length - 1]);
    if (!firstN || !lastN) return;
    const dxAll = (lastN.x - firstN.x), dyAll = (lastN.y - firstN.y);
    const lenAll = Math.hypot(dxAll, dyAll) || 1;
    // Перпендикуляр (нормированный) × величина смещения (доля длины маршрута, но в разумных пределах)
    const off = Math.max(2, Math.min(15, lenAll * 0.04));
    const perpX = (-dyAll / lenAll) * off;
    const perpY = (dxAll / lenAll) * off;

    pushHistory();

    // 3) Создаём дубликаты узлов маршрута со смещением.
    const workNodes = [...nodes];
    const workBranches = [...branchesRaw];
    const dupNodeId = new Map<string, string>(); // исходный узел → узел нити

    for (const origId of nodeSeq) {
      if (dupNodeId.has(origId)) continue;
      const orig = nodeMap.get(origId);
      if (!orig) continue;
      const nid = nextNodeId(workNodes);
      const usedNums = new Set(workNodes.map((n) => parseInt(n.number, 10)).filter((v) => !isNaN(v)));
      let num = 1; while (usedNums.has(num)) num++;
      const nn = makeNode(nid, {
        x: orig.x + perpX, y: orig.y + perpY, z: orig.z,
        name: "", number: String(num),
        horizonId: orig.horizonId,
      } as Partial<TopoNode>);
      workNodes.push(nn);
      dupNodeId.set(origId, nid);
    }

    // Аэродинамическое сопротивление трубы.
    // Если R задан вручную (vpManualR) — распределяем его по длине сегментов.
    // Иначе каждый сегмент считает R сам по формуле R=6.48·α·L/D⁵ (режим "pipe"),
    // как во вкладке «Топология» — vpPatch уже содержит resistanceMode/pipeAlpha/pipeDiameter.
    const manualPipeR = vpPatchRaw.vpManualR && vpPatchRaw.vpManualR > 0 ? vpPatchRaw.vpManualR : 0;
    const chainTotalLen = chain.reduce((s, c) => s + (c.b.length ?? 0), 0) || 1;

    // Геометрия сечения ветвей нити = КРУГЛАЯ труба диаметром vpDiameter (мм → м).
    const pipeDiaM = (vpPatchRaw.vpDiameter ?? 500) / 1000;
    const pipeSec = calcSection({ shape: "round", diameter: pipeDiaM });
    const pipeGeom: Partial<TopoBranch> = {
      shape: "round",
      diameter: pipeDiaM,
      area: Math.round(pipeSec.area * 1000) / 1000,
      perimeter: Math.round(pipeSec.perimeter * 1000) / 1000,
      dh: Math.round(pipeSec.dh * 1000) / 1000,
      manualSection: false,
    };

    // 4) Соединяем дубликаты ветвями-трубопроводом (узкими, светло-серыми).
    const createdIds: string[] = [];
    for (const c of chain) {
      const fromDup = dupNodeId.get(c.fromId);
      const toDup = dupNodeId.get(c.toId);
      if (!fromDup || !toDup) continue;
      const bid = nextBranchId(workBranches);
      // В ручном режиме — доля общего R по длине; иначе оставляем режим "pipe" из vpPatch.
      const manualOverride: Partial<TopoBranch> = manualPipeR > 0
        ? { resistanceMode: "manual", manualR: manualPipeR * ((c.b.length ?? 0) / chainTotalLen) }
        : {};
      const nb = makeBranch(bid, fromDup, toDup, {
        horizonId: c.b.horizonId,
        type: "Вентрубопровод",
        length: c.b.length,
        manualLength: true,
        lineWidth: Math.max(0.6, (c.b.lineWidth && c.b.lineWidth > 0 ? c.b.lineWidth : branchWidth) * 0.2),
        lineBorder: 0.1,
        isVentPipeBranch: true,
        ...vpPatch,
        ...pipeGeom,
        ...manualOverride,
      });
      workBranches.push(nb);
      createdIds.push(bid);
    }

    // 5) Привязываем концы нити к исходным узлам маршрута (вход/выход воздуха).
    // Длину этих соединительных ветвей считаем ПО КООРДИНАТАМ (узел маршрута →
    // смещённый дубликат), а не оставляем 0 — иначе проверка ругается «L=0».
    const workNodeMap = new Map(workNodes.map((n) => [n.id, n]));
    const startDup = dupNodeId.get(nodeSeq[0]);
    const endDup = dupNodeId.get(nodeSeq[nodeSeq.length - 1]);
    if (startDup && startDup !== nodeSeq[0]) {
      const bid = nextBranchId(workBranches);
      const a = workNodeMap.get(nodeSeq[0]);
      const b = workNodeMap.get(startDup);
      const segLen = a && b ? Math.round(calcBranchLength(a, b)) : 0;
      workBranches.push(makeBranch(bid, nodeSeq[0], startDup, {
        horizonId: firstN.horizonId, type: "Вентрубопровод (вход)", length: segLen, manualLength: false,
        lineWidth: Math.max(0.6, branchWidth * 0.2), lineBorder: 0.1, isVentPipeBranch: true, ...vpPatch, ...pipeGeom,
      }));
    }
    if (endDup && endDup !== nodeSeq[nodeSeq.length - 1]) {
      const bid = nextBranchId(workBranches);
      const a = workNodeMap.get(endDup);
      const b = workNodeMap.get(nodeSeq[nodeSeq.length - 1]);
      const segLen = a && b ? Math.round(calcBranchLength(a, b)) : 0;
      workBranches.push(makeBranch(bid, endDup, nodeSeq[nodeSeq.length - 1], {
        horizonId: lastN.horizonId, type: "Вентрубопровод (выход)", length: segLen, manualLength: false,
        lineWidth: Math.max(0.6, branchWidth * 0.2), lineBorder: 0.1, isVentPipeBranch: true, ...vpPatch, ...pipeGeom,
      }));
    }

    setNodes(workNodes);
    setBranches(workBranches);
    setSelectedBranchIds(new Set(createdIds));
    setSelectedBranchId(createdIds[0] ?? null);
    setSelectedNodeId(null);
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
      name: "",
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
  const [rescueWaypointIds, setRescueWaypointIds] = useState<string[]>([]);
  // Буквенные метки узлов маршрута горноспасателей: А — начальный (база ВГСЧ),
  // Б — целевой (место аварии), В — промежуточные узлы. Рисуются на схеме поверх узлов.
  const rescueNodeLetters = React.useMemo(() => {
    const m = new Map<string, string>();
    if (activeSide !== "rescue") return m;
    rescueWaypointIds.forEach(id => { if (id) m.set(id, "В"); });
    if (rescueStartNodeId)  m.set(rescueStartNodeId, "А");
    if (rescueTargetNodeId) m.set(rescueTargetNodeId, "Б");
    return m;
  }, [activeSide, rescueStartNodeId, rescueTargetNodeId, rescueWaypointIds]);
  // ─── Горнорабочий ──────────────────────────────────────────────────
  const [workerPickMode, setWorkerPickMode] = useState<WorkerPickMode>(null);
  const [workerStartNodeId, setWorkerStartNodeId] = useState("");
  const [workerTargetNodeId, setWorkerTargetNodeId] = useState("");
  const workerPickHandlerRef = React.useRef<((nodeId: string) => void) | null>(null);
  const [workerPathBranchIds, setWorkerPathBranchIds] = useState<Set<string>>(new Set());
  const [workerPathBranchDirs, setWorkerPathBranchDirs] = useState<Map<string, boolean>>(new Map());
  const [workerPathNodeIds, setWorkerPathNodeIds] = useState<Set<string>>(new Set());
  const [workerWaypointIds, setWorkerWaypointIds] = useState<string[]>([]);
  // Буквенные метки узлов горнорабочего: А — начальный, Б — целевой, В — промежуточные
  const workerNodeLetters = React.useMemo(() => {
    const m = new Map<string, string>();
    if (activeSide !== "workerPath") return m;
    workerWaypointIds.forEach(id => { if (id) m.set(id, "В"); });
    if (workerStartNodeId)  m.set(workerStartNodeId, "А");
    if (workerTargetNodeId) m.set(workerTargetNodeId, "Б");
    return m;
  }, [activeSide, workerStartNodeId, workerTargetNodeId, workerWaypointIds]);
  // ─── Вентрубопровод ────────────────────────────────────────────────
  const [showVentPipeDialog, setShowVentPipeDialog] = useState(false);
  const [ventPipeBranchIds, setVentPipeBranchIds] = useState<string[]>([]);
  // ─── Групповое редактирование ветвей ───────────────────────────────
  const [showMultiBranchProps, setShowMultiBranchProps] = useState(false);
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
  // Порог видимости задымления (м): дым распространяется, пока видимость в дыму
  // ниже порога; дальше — чистый воздух. Настраивается под нормативы.
  const [smokeVisThreshold, setSmokeVisThreshold] = useState(50);
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
  // Учитывать естественную тягу (галочка как в Аэросети)
  const [useNaturalDraft, setUseNaturalDraft] = useState(true);
  // Геотермический градиент °C / 100 м глубины (стандарт 3°C/100м)
  const [geoGradient, setGeoGradient] = useState(3.0);
  const [showSolverParams, setShowSolverParams] = useState(false);
  // Диалог «Устойчивость при пожаре» (Акт устойчивости)
  const [showFireStability, setShowFireStability] = useState(false);
  // Диалог «ВДС» (воздушно-депрессионная съёмка)
  const [showVds, setShowVds] = useState(false);
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
  // Порог переключения SVG↔Canvas по числу видимых ветвей (настраивается вручную).
  const [canvasThreshold, setCanvasThreshold] = useState<number>(() => {
    const raw = localStorage.getItem("vent-cad/canvas-threshold");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 100 ? n : 800;
  });
  useEffect(() => {
    try { localStorage.setItem("vent-cad/canvas-threshold", String(canvasThreshold)); } catch { /* ignore */ }
  }, [canvasThreshold]);
  // Свёрнут ли блок «Порог SVG→Canvas» (по умолчанию — свёрнут)
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [scaleTextMin, setScaleTextMin] = useState(80);
  const [scaleTextMax, setScaleTextMax] = useState(150);
  const [scaleBranchMin, setScaleBranchMin] = useState(80);
  const [scaleBranchMax, setScaleBranchMax] = useState(150);
  // Пределы масштаба маркеров «Позиции ПЛА» (в % от нормального размера), как у ветвей/текста.
  const [scalePositionMin, setScalePositionMin] = useState(80);
  const [scalePositionMax, setScalePositionMax] = useState(150);
  // ГОСТ-диаметр маркера позиции ПЛА на чертеже, мм (по умолчанию 13 мм).
  const [positionGostMm, setPositionGostMm] = useState(13);
  // Масштаб перемычек в % от ширины ветви (150% = перемычка в 1.5 раза шире ветви).
  // Синхронизируется с реальной толщиной ветви на экране (учитывает масштаб XY).
  const [bulkheadScale, setBulkheadScale] = useState(150);
  // Масштаб вентиляторов в % от ширины ветви (450% по умолчанию). Как у перемычек.
  const [fanScale, setFanScale] = useState(450);

  // ─── Сравнение схем ─────────────────────────────────────────────────
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareFilter, setCompareFilter] = useState<"all" | "changed" | "added" | "removed">("all");
  const [compareSelectedId, setCompareSelectedId] = useState<string | null>(null);
  const [compareShowDialog, setCompareShowDialog] = useState(false);

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
  // Текущий вид TopoCanvas: ref для мгновенного доступа + state для перерисовки оверлея позиций
  const savedViewStateRef = useRef<SavedView | null>(null);
  const [viewStateTick, setViewStateTick] = useState(0);
  const handleViewStateChange = useCallback((v: SavedView) => {
    savedViewStateRef.current = v;
    // Обновляем оверлей позиций ПЛА В ТОТ ЖЕ кадр, что и схему (TopoCanvas).
    // rAF-троттлинг убран: он сдвигал перерисовку выносок/маркеров на кадр
    // назад, из-за чего в SVG-режиме позиции «отставали» от схемы при зуме.
    // onViewStateChange вызывается лишь при реальном изменении вида (не чаще),
    // поэтому прямой setState здесь безопасен по производительности.
    setViewStateTick(t => t + 1);
  }, []);
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
  // Пользовательские модели насосов (сохраняются в проекте)
  const [userPumps, setUserPumps] = useState<PumpModel[]>([]);

  // Гидравлический расчёт водопроводной сети ППЗ (backend).
  // Объявлен здесь (а не выше вместе с waterNetwork state), т.к. использует schemaSymbols.
  useEffect(() => {
    const hasWater = branches.some(b => b.hasWaterPipe);
    if (!hasWater) { setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() }); return; }
    // Дебаунс 400мс — при больших схемах (Canvas >800 ветвей) не спамим запросами
    const tid = setTimeout(() => {
      // Карта: branchId → символ насоса (для передачи напора в расчёт)
      const pumpByBranch = new Map<string, typeof schemaSymbols[number]>();
      for (const s of schemaSymbols) {
        if (s.typeId === "pump" && s.branchId) pumpByBranch.set(s.branchId, s);
      }
      // Отправляем только водопроводные ветви и связанные узлы — уменьшаем payload.
      // Если на ветви стоит насос — «впечатываем» его параметры в поля ветви
      // (аналогично редукционному клапану), чтобы backend учёл напор насоса.
      const waterBranches = branches.filter(b => b.hasWaterPipe).map(b => {
        const pump = pumpByBranch.get(b.id);
        if (!pump) return b;
        const head = (pump.pumpHead ?? 0) * (pump.pumpParallel ?? 1);
        return {
          ...b,
          wpHasPump: head > 0,
          wpPumpHead: head,                                  // м вод. ст. (суммарно по параллельным)
          wpPumpReverse: pump.airDirection === "reverse",    // насос качает против направления ветви
        };
      });
      const waterNodeIds = new Set<string>();
      waterBranches.forEach(b => { waterNodeIds.add(b.fromId); waterNodeIds.add(b.toId); });
      // Также добавляем узлы с fireNodeType (резервуары и потребители)
      nodes.forEach(n => { if ((n.fireNodeType ?? "none") !== "none") waterNodeIds.add(n.id); });
      const waterNodes = nodes.filter(n => waterNodeIds.has(n.id));
      fetch(WATER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: waterNodes, branches: waterBranches }),
      }).then(r => r.json()).then(data => {
        const nr = new Map<string, WaterNodeResult>();
        const br = new Map<string, WaterBranchResult>();
        (data.nodeResults ?? []).forEach((n: WaterNodeResult) => nr.set(n.nodeId, n));
        (data.branchResults ?? []).forEach((b: WaterBranchResult) => br.set(b.branchId, b));
        setWaterNetwork({ nodeResults: nr, branchResults: br });
      }).catch((err) => { console.error("[water-hydraulics] fetch error:", err); });
    }, 400);
    return () => clearTimeout(tid);
  }, [nodes, branches, schemaSymbols]);

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
    // Ограничение: на схеме может быть только ОДИН очаг пожара и ОДНО место взрыва.
    // Иначе повторная установка приведёт к некорректному расчёту.
    if (typeId === "fire_source") {
      const existing = schemaSymbols.filter(s => FIRE_SYMBOL_IDS.has(s.typeId));
      if (existing.length > 0) {
        const ok = window.confirm(
          "На схеме уже установлен очаг пожара.\n\nМожно установить только один очаг пожара — иначе расчёт будет некорректным.\n\nУбрать установленный очаг пожара и установить новый?"
        );
        if (!ok) return;
        existing.forEach(s => {
          if (s.branchId) updateBranch(s.branchId, { hasFire: false, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0 });
          removeSymbol(s.id);
        });
        setFireResult(null);
        setFireCalcDone(false);
      }
    } else if (typeId === "explosion_source") {
      const existing = schemaSymbols.filter(s => EXPLOSION_SYMBOL_IDS.has(s.typeId));
      if (existing.length > 0) {
        const ok = window.confirm(
          "На схеме уже установлено место взрыва.\n\nМожно установить только одно место взрыва — иначе расчёт будет некорректным.\n\nУбрать установленное место взрыва и установить новое?"
        );
        if (!ok) return;
        existing.forEach(s => {
          if (s.branchId) updateBranch(s.branchId, { hasExplosion: false, explosionComputedQtnt: 0, explosionComputedMaxP: 0, explosionComputedWaveSpeed: 0, explosionComputedR_lethal: 0, explosionComputedR_heavy: 0, explosionComputedR_medium: 0, explosionComputedR_light: 0, explosionComputedDeltaP: 0 });
          removeSymbol(s.id);
        });
        setExplosionResult(null);
        setExplosionCalcDone(false);
      }
    }
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
      const vs = savedViewStateRef.current;
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
  const [checkThreshold, setCheckThreshold] = useState<number>(0.01);
  const [checkTab, setCheckTab] = useState<
    "near" | "isolated" | "dupes" | "dupbranch" | "zeroR" | "zeroLen" | "highR" | "bulkR" | "manualLen" | "isolatedBranch"
  >("near");
  // Порог «большого» сопротивления ветви, Н·с²/м⁸ (кМюрг). По умолчанию 100.
  const [checkHighRThreshold, setCheckHighRThreshold] = useState<number>(100);
  // Порог сопротивления перемычки, кМюрг (норматив — 686 кМюрг)
  const [checkBulkRThreshold, setCheckBulkRThreshold] = useState<number>(686);
  // Результат проверки схемы — считается только когда открыта панель «Проверка».
  // Мемоизация исключает тяжёлый O(n) пересчёт на каждый ререндер (ховеры и т.п.).
  const schemaCheckResult = useMemo(() => {
    if (activeSide !== "check") return null;
    return checkSchema(nodes, branches, {
      nearThreshold: checkThreshold,
      highRThreshold: checkHighRThreshold,
      bulkRThreshold: checkBulkRThreshold,
    });
  }, [activeSide, nodes, branches, checkThreshold, checkHighRThreshold, checkBulkRThreshold]);
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
      // Если Set пуст и есть одиночно выбранная ветвь — включаем её тоже (как в узлах)
      if (next.size === 0 && selectedBranchId && selectedBranchId !== id) {
        next.add(selectedBranchId);
      }
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

  // Актуальная версия десктопа (для вкладки Файл → Установить)
  const [desktopLatestVer, setDesktopLatestVer] = useState<string>("");

  // При открытии вкладки «Установить» подтягиваем актуальную версию десктопа
  useEffect(() => {
    if (fileSectionState !== "install" || desktopLatestVer) return;
    fetchRemoteVersion()
      .then(v => { if (v.version) setDesktopLatestVer(v.version); })
      .catch(() => { /* нет сети — просто не показываем номер версии */ });
  }, [fileSectionState, desktopLatestVer]);

  // ─── DXF ИМПОРТ ─────────────────────────────────────────────────────
  const [showDxfImport, setShowDxfImport] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [showExcelExport, setShowExcelExport] = useState(false);
  const [showCombinedImport, setShowCombinedImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [showVentsimImport, setShowVentsimImport] = useState(false);
  const [showVent2CsvImport, setShowVent2CsvImport] = useState(false);

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
      let bkSeq = 0;
      for (const bk of result.bulkheads ?? []) {
        const br = branches.find(b => b.id === bk.branchId);
        if (!br) { notFound++; continue; }
        if (existing.some(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === bk.branchId)) continue;
        const typeId = guessBulkheadTypeId(bk.typeName);
        syms.push({
          // Гарантированно уникальный id: Date.now() одинаков для всех перемычек
          // одного импорта, а на одной ветви может быть несколько перемычек —
          // раньше это давало дубли id и React-коллизию ключей, из-за чего
          // удаление перемычки не обновляло схему до переоткрытия файла.
          id: `SYM_BK_${Date.now()}_${bkSeq++}_${bk.branchId}`,
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

  const handleVent2CsvImport = (result: CsvImportResult, mode: "replace" | "append") => {
    handleCsvImport(result, mode);
    setShowVent2CsvImport(false);
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
  const [equipRefTab, setEquipRefTab] = useState<"fans" | "types" | "bulkheads" | "sensors" | "typical" | "pumps" | "consumers" | "pipes" | "transport" | "units">("fans");
  const [showLegend, setShowLegend] = useState(false);

  // ─── СОХРАНЕНИЕ / ЗАГРУЗКА ПРОЕКТА ───────────────────────────────────
  const { recentFiles, addRecentFile, updateHasHandle, removeRecentFile, clearRecentFiles } = useRecentFiles();
  const [projectFileName, setProjectFileName] = useState<string>("Проект1.vproj");
  // Флаг несохранённых изменений
  const [isDirty, setIsDirty] = useState<boolean>(false);
  // Диалог подтверждения закрытия
  const [showCloseConfirm, setShowCloseConfirm] = useState<boolean>(false);
  // Окно "О программе"
  const [showAbout, setShowAbout] = useState<boolean>(false);
  // Диалог руководства пользователя
  const [showHelpDialog, setShowHelpDialog] = useState<boolean>(false);
  const [showDepressogram, setShowDepressogram] = useState<boolean>(false);
  const [depressogramHighlight, setDepressogramHighlight] = useState<string[]>([]);
  const [depressogramPickMode, setDepressogramPickMode] = useState<boolean>(false);
  const [depressogramManualBranches, setDepressogramManualBranches] = useState<Set<string>>(new Set());

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
    userPumps,
    mineBulkheads,
    mineTypes,
    calcMode,
    solverTolerance,
    solverMaxIter,
    solverAlpha,
    surfaceTemp,
    useNaturalDraft,
    geoGradient,
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
    view: savedViewStateRef.current ?? undefined,
    positions,
    textBlocks,
    scaleLimitsEnabled,
    bulkheadScale,
    fanScale,
    smokeVisThreshold,
  });

  // Отслеживаем изменения проекта — помечаем как «несохранённый»
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setIsDirty(true);
  }, [nodes, branchesRaw, schemaSymbols, mineFans, userPumps, mineBulkheads, mineTypes,
      calcMode, solverTolerance, solverMaxIter, solverAlpha, surfaceTemp,
      infoConfig, unitsConfig, branchWidth, branchBorder, colorByHorizon,
      showFlowArrows, flowDisplay, zScale, xyScale]);

  // Предупреждение при закрытии/обновлении вкладки
  // В десктопном режиме (WebView2) beforeunload отключён — закрытие обрабатывается через C#
  useEffect(() => {
    type W = Window & { __IS_DESKTOP__?: boolean };
    const isDesktop = !!(window as W).__IS_DESKTOP__;
    if (isDesktop) return; // в десктопе браузерный диалог не нужен

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // В десктопном режиме — регистрируем callbacks для C# перед закрытием окна
  useEffect(() => {
    type W = Window & {
      __IS_DESKTOP__?: boolean;
      __pvsCanClose?: () => boolean;
      __pvsShowCloseDialog?: () => void;
      chrome?: { webview?: { postMessage: (s: string) => void } };
    };
    const w = window as W;
    if (!w.__IS_DESKTOP__) return;

    // C# вызывает __pvsCanClose() — если true, закрываем без диалога
    w.__pvsCanClose = () => !isDirty;

    // C# вызывает __pvsShowCloseDialog() когда нажата системная кнопка X
    // Показываем наш React-диалог вместо браузерного "Покинуть сайт?"
    w.__pvsShowCloseDialog = () => {
      if (!isDirty) {
        // Несохранённых данных нет — сразу подтверждаем закрытие
        w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-close-confirmed" }));
        return;
      }
      // Показываем кастомный диалог
      setShowCloseConfirm(true);
    };
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
        // Сохраняем handle в IndexedDB — чтобы файл появился в «Последние» с возможностью открыть
        void saveHandleToIDB(fname, handle).then(() => updateHasHandle(fname, true));
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
          // Сохраняем handle в IndexedDB — чтобы открывать из «Последние» без диалога
          void saveHandleToIDB(file.name, handle).then(() => updateHasHandle(file.name, true));
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

    // ── ПОЛНЫЙ СБРОС СОСТОЯНИЯ ДО ДЕФОЛТОВ ПЕРЕД ЗАГРУЗКОЙ ─────────────
    // Чтобы данные предыдущего проекта не «просачивались» в новый
    // (особенно важно при открытии второго файла без перезагрузки страницы)

    // Выделение и инструмент
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setSelectedNodeIds(new Set());
    setSelectedBranchIds(new Set());
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setFanSymbolBranchId(null);
    setTool("select");

    // Результаты расчётов
    setSolveResult(null);
    setNormalFlows({});
    setFireResult(null);
    setFireCalcDone(false);
    setExplosionResult(null);
    setExplosionCalcDone(false);
    setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() });
    setVcSolving(false);
    setVcError(null);

    // Временные буферы и состояния
    setBranchParamBuffer(null);
    setSymbolClipboard(null);
    setPendingSymbol(null);
    setCtxMenu(null);

    // Состояния интерфейса (сбрасываем к дефолтам)
    setActiveSide("general");
    setActiveHorizonId("");
    setEditingHorizonImageId(null);
    setEditingPrintLayerId(null);
    setZLevel(0);
    setShowMultiBranchProps(false);
    setShowVentPipeDialog(false);
    setVentPipeBranchIds([]);

    // Настройки отображения — сбрасываем до дефолтов;
    // ниже переопределятся значениями из файла если они там есть
    setFlowColorMin(0);
    setFlowColorMax(75);
    setFlowColorHue("red");
    setThinLines(false);
    setShowFlowArrows(false);
    setFlowDisplay("off");
    setColorMode("none");
    setColorByHorizon(false);
    setBranchWidth(7);
    setBranchBorder(0.6);
    setZScale(1);
    setXyScale(1);
    setScaleLimitsEnabled(false);
    setBulkheadScale(150);
    setFanScale(450);
    setPosColorInner(false);
    setPosColorOuter(false);
    setShowPositions(true);
    setInfoConfig(DEFAULT_INFO_CONFIG);
    setUnitsConfig(DEFAULT_UNITS_CONFIG);
    setCalcMode("cross");
    setSolverTolerance(0.01);
    setSolverMaxIter(2000);
    setSolverAlpha(0.8);
    setSurfaceTemp(20);
    setUseNaturalDraft(true);
    setGeoGradient(3.0);
    // ── конец сброса ────────────────────────────────────────────────────

    // Каждый узел прогоняем через makeNode чтобы гарантировать все поля (как makeBranch для ветвей)
    const rawNodes = (data.nodes as TopoNode[]) ?? [];
    setNodes(rawNodes.map((n) => makeNode(n.id, n)));
    // Каждую ветвь прогоняем через makeBranch чтобы гарантировать все поля (fanRpm и т.д.)
    const rawBranches = (data.branches as TopoBranch[]) ?? [];
    const mergedBranches = rawBranches.map((b) =>
      makeBranch(b.id, b.fromId, b.toId, b)
    );
    // Пересчитываем R всех ветвей при загрузке — чтобы не использовать устаревшие кешированные значения
    const recalcedBranches = recalcAll(rawNodes.map((n) => makeNode(n.id, n)), mergedBranches);
    setBranches(recalcedBranches);
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
    const loadedSymbolsRaw = (data.schemaSymbols as SchemaSymbol[]) ?? [];
    // Самолечение старых файлов: раньше импорт мог создать несколько символов
    // с ОДИНАКОВЫМ id (Date.now() совпадал для перемычек на одной ветви).
    // Дубли id ломали React-ключи и удаление символов. Переприсваиваем
    // уникальные id всем повторам.
    const seenIds = new Set<string>();
    const loadedSymbols = loadedSymbolsRaw.map((s, i) => {
      if (!s.id || seenIds.has(s.id)) {
        const uniq = `${s.id || "SYM"}_${i}_${Math.random().toString(36).slice(2, 7)}`;
        seenIds.add(uniq);
        return { ...s, id: uniq };
      }
      seenIds.add(s.id);
      return s;
    });
    // Добавляем fan-символы для ветвей у которых нет УО (старые проекты)
    const autoFanSymbols = ensureFanSymbols(mergedBranches, loadedSymbols);
    setSchemaSymbols([...loadedSymbols, ...autoFanSymbols]);
    // Миграция: если на ветви hasBulkhead=true, но нет ни одного настоящего символа перемычки
    // (только measure_station — которая раньше ошибочно входила в BULKHEAD_SYMBOL_IDS), сбрасываем флаг
    setBranches(prev => prev.map(br => {
      if (!br.hasBulkhead) return br;
      const hasRealBulkhead = loadedSymbols.some(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === br.id);
      if (hasRealBulkhead) return br;
      const hasMeasureStation = loadedSymbols.some(s => s.typeId === "measure_station" && s.branchId === br.id);
      if (!hasMeasureStation) return br;
      return { ...br, hasBulkhead: false };
    }));
    if (data.mineFans) setMineFans(data.mineFans as MineFanExport[]);
    setUserPumps(Array.isArray(data.userPumps) ? (data.userPumps as PumpModel[]) : []);
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
          rMkyurg: airPermToR(item.airPermeability) / 1000, // Мюрг → кМюрг
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
    if (data.useNaturalDraft !== undefined) setUseNaturalDraft(data.useNaturalDraft as boolean);
    if (data.geoGradient !== undefined) setGeoGradient(data.geoGradient as number);
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
    if (data.bulkheadScale !== undefined) setBulkheadScale(data.bulkheadScale as number);
    if (data.fanScale !== undefined) setFanScale(data.fanScale as number);
    if (data.smokeVisThreshold !== undefined) setSmokeVisThreshold(data.smokeVisThreshold as number);
    if (data.positions) setPositions(data.positions as Position[]);
    else setPositions([]);
    if (data.textBlocks) setTextBlocks(data.textBlocks as TextBlock[]);
    else setTextBlocks([]);
    const resolvedName = (data.name as string) ?? fileName;
    setProjectFileName(resolvedName);
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
    // Сохраняем в список последних файлов + JSON данные для открытия по клику
    const loadedNodes = Array.isArray(data.nodes) ? (data.nodes as unknown[]).length : 0;
    const loadedBranches = Array.isArray(data.branches) ? (data.branches as unknown[]).length : 0;
    addRecentFile({ name: resolvedName, openedAt: Date.now(), nodeCount: loadedNodes, branchCount: loadedBranches });
    saveRecentData(resolvedName, data);
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

    // ── Топология ──
    setNodes([]);
    setBranches([]);
    setSchemaSymbols([]);
    setPositions([]);
    setTextBlocks([]);

    // ── Горизонты — сброс к одному «Общий вид» ──
    setHorizons([{ id: OVERVIEW_HORIZON_ID, name: "Общий вид", z: 0, color: "#6b7280", visible: true,
      printLayer: { visible: true, title: "Общий вид вентиляционной схемы", scale: "авто",
        orgName: "", approverTitle: "", approverName: "", year: new Date().getFullYear().toString(),
        period: "", developer: "", checker: "", sheetNum: "1", sheetTotal: "1",
        showLegend: false, showStamp: false, showApprover: false, paperFormat: "A1", orientation: "landscape" } } as Horizon]);
    setActiveHorizonId("");

    // ── Выделение и инструмент ──
    setSelectedNodeId(null);
    setSelectedBranchId(null);
    setSelectedNodeIds(new Set());
    setSelectedBranchIds(new Set());
    setSelectedSymbolId(null);
    setSelectedSymbolIds(new Set());
    setFanSymbolBranchId(null);
    setTool("select");

    // ── Результаты расчётов ──
    setSolveResult(null);
    setNormalFlows({});
    setFireResult(null);
    setFireCalcDone(false);
    setExplosionResult(null);
    setExplosionCalcDone(false);
    setWaterNetwork({ nodeResults: new Map(), branchResults: new Map() });
    setVcSolving(false);
    setVcError(null);

    // ── Временные буферы ──
    setBranchParamBuffer(null);
    setSymbolClipboard(null);
    setPendingSymbol(null);
    setCtxMenu(null);

    // ── Интерфейс ──
    setActiveSide("general");
    setEditingHorizonImageId(null);
    setEditingPrintLayerId(null);
    setZLevel(0);
    setShowMultiBranchProps(false);
    setShowVentPipeDialog(false);
    setVentPipeBranchIds([]);

    // ── Настройки отображения — сброс к дефолтам ──
    setFlowColorMin(0);
    setFlowColorMax(75);
    setFlowColorHue("red");
    setThinLines(false);
    setShowFlowArrows(false);
    setFlowDisplay("off");
    setColorMode("none");
    setColorByHorizon(false);
    setBranchWidth(7);
    setBranchBorder(0.6);
    setZScale(1);
    setXyScale(1);
    setScaleLimitsEnabled(false);
    setBulkheadScale(150);
    setFanScale(450);
    setPosColorInner(false);
    setPosColorOuter(false);
    setShowPositions(true);
    setInfoConfig(DEFAULT_INFO_CONFIG);
    setUnitsConfig(DEFAULT_UNITS_CONFIG);

    // ── Параметры расчёта — сброс к дефолтам ──
    setCalcMode("cross");
    setSolverTolerance(0.01);
    setSolverMaxIter(2000);
    setSolverAlpha(0.8);
    setSurfaceTemp(20);

    // ── Справочники — сброс к заводским значениям ──
    setMineFans([
      { catalogId: "VOD-18", name: "ВО-18/12АВР", diameter: 1.8, rpmMin: 600, rpmMax: 1500 },
    ]);
    setMineBulkheads(BULKHEAD_CATALOG.map(item => ({
      id: `mb_${item.id}`,
      name: item.name,
      type: item.type,
      airPermeability: item.airPermeability,
      rMkyurg: airPermToR(item.airPermeability) / 1000, // Мюрг → кМюрг
      failurePressure: item.failurePressure,
      note: item.note,
      color: item.color,
    })));
    setMineTypes([]);

    // ── Имя файла и вид ──
    setProjectFileName("Проект1.vproj");
    fileHandleRef.current = null;
    setImportNonce(n => n + 1);
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
    const nodesMap = new Map(nodes.map(n => [n.id, n]));
    const bulkheadsMap = new Map(mineBulkheads.map(mb => [mb.id, mb]));
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
      const fromNode = nodesMap.get(b.fromId);
      const toNode   = nodesMap.get(b.toId);
      const tFrom = fromNode ? (fromNode.atmosphereLink ? surfaceTempVal : (fromNode.airTemp ?? surfaceTempVal)) : surfaceTempVal;
      const tTo   = toNode   ? (toNode.atmosphereLink   ? surfaceTempVal : (toNode.airTemp   ?? surfaceTempVal)) : surfaceTempVal;
      const tAvg  = (tFrom + tTo) / 2;
      const rho   = 353.0 / (273.0 + Math.max(-30, Math.min(100, tAvg)));
      const bkSyms = schemaSymbols.filter(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
      const rBulkheads = bkSyms.reduce((sum, s) => {
        const mode = s.bkResMode ?? "project";
        let r = 0;
        if (mode === "manual") {
          r = (s.bkManualR ?? 0); // кМюрг = Па·с²/м⁶, коэффициент = 1
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
            const bkEntry = s.bkBulkheadId ? bulkheadsMap.get(s.bkBulkheadId) : undefined;
            const kAir = s.bkManualAirPerm ? (s.bkCustomAirPerm ?? 0)
              : (s.bkAirPerm ?? bkEntry?.airPermeability ?? b.bulkheadAirPerm ?? 0);
            const rRef = bkEntry?.rMkyurg ?? 0;
            // 1/A² → Мюрг → /1000 → кМюрг; rRef/bkBulkheadR/bulkheadR уже в кМюрг
            r = kAir > 0 ? (1 / (kAir * kAir)) / 1000 : (s.bkBulkheadR ?? rRef ?? b.bulkheadR ?? 0);
          }
        }
        return sum + r;
      }, 0);
      // Перемычка задана через вкладку ветви (без символа на схеме)
      const rBranchBulkhead = (b.hasBulkhead && bkSyms.length === 0) ? (() => {
        const mode = b.bulkheadResMode ?? "project";
        if (mode === "manual") return (b.bulkheadManualR ?? 0); // кМюрг = Па·с²/м⁶
        if (mode === "survey") {
          const q = b.bulkheadSurveyQ ?? 0; const dp = b.bulkheadSurveyDP ?? 0;
          return q > 0 ? dp / (q * q) : 0;
        }
        // 1/A² → Мюрг → /1000 → кМюрг; bulkheadR уже в кМюрг
        if (b.bulkheadManualAirPerm && (b.bulkheadCustomAirPerm ?? 0) > 0)
          return (1 / (b.bulkheadCustomAirPerm! * b.bulkheadCustomAirPerm!)) / 1000;
        if ((b.bulkheadAirPerm ?? 0) > 0)
          return (1 / (b.bulkheadAirPerm * b.bulkheadAirPerm)) / 1000;
        return b.bulkheadR ?? 0;
      })() : 0;
      const fanCrossingR = (b.hasFan && (b.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
        ? (b.fanCrossingR ?? 0) / 1000 : 0; // Мюрг → кМюрг

      return {
        id: b.id,
        fromId: b.fromId,
        toId: b.toId,
        R: b.resistance + rBulkheads + rBranchBulkhead, // fanCrossingR Python добавляет сам в get_R
        area: b.area,
        angle: b.angle ?? 0,
        hasFan: b.hasFan,
        fanType: b.fanType ?? "ГВУ",
        fanMode: b.fanMode,
        fanPressure: b.fanPressure,
        fanInstall:  b.fanInstall ?? "Внутри перемычки",
        fanCrossingR: (b.fanCrossingR ?? 0) / 1000, // Мюрг → кМюрг (для get_R в Python)
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
        userTemp: !n.atmosphereLink && (n.airTemp ?? 20) !== 20,
      })),
      surfaceTemp: surfaceTempVal,
      useNaturalDraft,
      geoGradient,
      branches: buildBranchPayload(branchesWithFire, surfaceTempVal),
      options: { tolerance: solverTolerance, maxIter: solverMaxIter, alpha: solverAlpha },
    };

    const resp = await postAirflow(reqBody);
    if (!resp.ok) return new Map();
    const data = await resp.json();
    if (data.error) return new Map();
    const flowMap = new Map<string, number>();
    (data.branches as { id: string; Q: number }[]).forEach(rb => flowMap.set(rb.id, rb.Q));
    return flowMap;
  };

  // ── Факт опрокидывания для Акта устойчивости ──────────────────────────────
  // Ставит очаг пожара на КАЖДУЮ ветвь с пожарной нагрузкой (мощность из
  // пожарной нагрузки), задаёт тепловую депрессию и пересчитывает сеть.
  // Сравнивает знак расхода до/после — это и есть фактическое опрокидывание,
  // тот же принцип, что в аварийном режиме (actuallyReversed).
  const computeFireStabilityFacts = async (
    ambientTemp: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<string, FireStabilityFact>> => {
    const facts = new Map<string, FireStabilityFact>();
    const loaded = branches.filter(b =>
      b.fireLoadTech || b.fireLoadConveyor || b.fireLoadCable || b.fireLoadWoodSupport);
    if (loaded.length === 0) return facts;
    onProgress?.(0, loaded.length);

    const originalFlows = new Map<string, number>(branches.map(b => [b.id, b.flow ?? 0]));

    // Для КАЖДОЙ нагруженной ветви моделируем ОТДЕЛЬНЫЙ сценарий пожара —
    // ровно так же, как при ручной установке очага (аварийный режим):
    //   • очаг ставится ТОЛЬКО на эту ветвь;
    //   • сеть пересчитывается ИТЕРАТИВНО (до сходимости расхода), при этом
    //     на каждой итерации T_пр и h_t уточняются по актуальному расходу
    //     (расход при пожаре падает → температура растёт).
    // Возвращаем факт разворота + расход/температуру/мощность ПРИ ПОЖАРЕ,
    // чтобы акт устойчивости показывал те же цифры, что и вкладка «Аварии».
    const FIRE_ITERS = 12;
    const FIRE_Q_TOL = 0.2;
    const FIRE_RELAX = 0.5; // демпфирование обратной связи T↑→Q↓ (иначе поток схлопывается)

    for (const target of loaded) {
      let currentFlows = new Map<string, number>(originalFlows);
      let firePower = 0, fireTemp = ambientTemp, thermalDep = 0;

      for (let iter = 0; iter < FIRE_ITERS; iter++) {
        const airQ0 = Math.abs(currentFlows.get(target.id) ?? target.flow ?? 0);
        firePower = calcBranchFirePower(target, airQ0);
        fireTemp  = calcFireTemp(firePower, airQ0, ambientTemp);
        const fromN = nodes.find(n => n.id === target.fromId);
        const toN   = nodes.find(n => n.id === target.toId);
        const dz = (toN?.z ?? 0) - (fromN?.z ?? 0);
        // Знак угла — геометрический (from→to). Направление потока учтёт
        // решатель (naturalDraft * sign(Q)) — как в основном аварийном расчёте.
        const signedAngle = Math.abs(target.angle ?? 0) * Math.sign(dz || 1);
        thermalDep = calcThermalDepression(fireTemp, ambientTemp, target.length, signedAngle);

        // Пожар ТОЛЬКО на целевой ветви, у остальных — актуальные расходы.
        const branchesIter = branches.map(b => {
          if (b.id !== target.id) return { ...b, flow: currentFlows.get(b.id) ?? b.flow };
          return { ...b, flow: currentFlows.get(b.id) ?? b.flow, fireThermalDepression: thermalDep };
        });

        const newFlows = await solveFireIteration(branchesIter, ambientTemp);
        if (newFlows.size === 0) break;

        // Релаксация: смешиваем новый расход со старым, чтобы обратная связь
        // «расход↓ → температура↑ → депрессия↑» сходилась, а не расходилась.
        let maxDQ = 0;
        const relaxedFlows = new Map<string, number>();
        newFlows.forEach((q, id) => {
          const prev = currentFlows.get(id) ?? 0;
          const relaxed = prev + FIRE_RELAX * (q - prev);
          relaxedFlows.set(id, relaxed);
          maxDQ = Math.max(maxDQ, Math.abs(relaxed - prev));
        });
        currentFlows = relaxedFlows;
        if (maxDQ < FIRE_Q_TOL) break;
      }

      const orig = originalFlows.get(target.id) ?? 0;
      const now  = currentFlows.get(target.id) ?? orig;
      const reversed = (Math.sign(orig || 1) !== Math.sign(now || 1)) && Math.abs(now) > 0.05;
      facts.set(target.id, {
        reversed,
        fireFlow: Math.abs(now),
        firePower,
        fireTemp,
        thermalDep: Math.abs(thermalDep),
      });
      onProgress?.(facts.size, loaded.length);
      // Пауза, чтобы React успел перерисовать индикатор прогресса.
      await new Promise(r => setTimeout(r, 0));
    }
    return facts;
  };

  // Расчёт воздухораспределения (Кросс или МКР)
  const handleSolveLocal = async () => {
    setVcSolving(true);
    setVcError(null);
    const methodName = calcMode === "cross" ? "Кросс" : "МКР";
    addLog("info", `Запуск расчёта: метод ${methodName}, узлов ${nodes.length}, ветвей ${branches.length}`);
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
            // userTemp=true — пользователь задал температуру вручную (не дефолт 20°C)
            airTemp: n.atmosphereLink ? surfaceTemp : (n.airTemp ?? surfaceTemp),
            userTemp: !n.atmosphereLink && (n.airTemp ?? 20) !== 20,
          })),
          surfaceTemp,
          useNaturalDraft,
          geoGradient,
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
      const resp = await postAirflow(requestBody);
      const data = await resp.json();

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

      // Применяем давления в узлах из результата расчёта
      if (data.nodes && Array.isArray(data.nodes) && data.nodes.length > 0) {
        const nodePressures = new Map<string, { computedPressure: number; computedFanPressure: number }>(
          (data.nodes as { id: string; computedPressure: number; computedFanPressure: number }[])
            .map(n => [n.id, { computedPressure: n.computedPressure, computedFanPressure: n.computedFanPressure }])
        );
        setNodes(prev => prev.map(n => {
          const p = nodePressures.get(n.id);
          return p !== undefined ? { ...n, computedPressure: p.computedPressure, computedFanPressure: p.computedFanPressure } : n;
        }));
      }

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

  const handleSolve = () => {
    // Перед расчётом проверяем сеть на изолированные ветви: подсети без выхода
    // на поверхность (нет пути к атмосферному узлу) не дают корректно рассчитать
    // воздухораспределение. Предупреждаем и открываем вкладку «Изолир.».
    const check = checkSchema(nodes, branches);
    if (check.noAtmosphere || check.isolatedBranches.length > 0) {
      setActiveSide("check");
      setCheckTab("isolatedBranch");
      const ids = check.isolatedBranches.map(b => b.id);
      if (ids.length > 0) {
        setSelectedBranchIds(new Set(ids));
        setSelectedNodeId(null);
        setSelectedBranchId(ids[0]);
        setFocusBranchId(ids[0]);
        setFocusNonce(Date.now());
      }
      const msg = check.noAtmosphere
        ? "В схеме нет ни одного выхода на поверхность (атмосферного узла).\n\nРасчёт воздухораспределения невозможен: воздуху некуда входить и выходить.\nОтметьте хотя бы один узел как связанный с атмосферой.\n\nЗапустить расчёт всё равно?"
        : `Найдено изолированных ветвей: ${check.isolatedBranches.length}.\n\nЭти ветви не связаны с поверхностью (нет пути к выходу на поверхность) и мешают расчёту воздухораспределения. Они отмечены на схеме и открыты во вкладке «Изолир.».\n\nЗапустить расчёт всё равно?`;
      addLog("warn", check.noAtmosphere
        ? "Расчёт остановлен: в схеме нет выхода на поверхность (атмосферного узла)."
        : `Расчёт остановлен: изолированных ветвей ${check.isolatedBranches.length} (нет связи с поверхностью).`);
      if (!window.confirm(msg)) return;
    }
    void handleSolveLocal();
  };
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
  }, [nodes, branchesRaw, selectedNodeId, selectedBranchId, selectedSymbolId, selectedSymbolIds, selectedBranchIds, schemaSymbols, symbolClipboard, pendingSymbol, selectedPositionId, leaderDrawMode]);

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
    if (selectedSymbolIds.size > 1) {
      // Мульти-удаление символов (перемычки, вентиляторы и др.)
      pushHistory();
      const toDelete = schemaSymbols.filter(s => selectedSymbolIds.has(s.id));
      for (const sym of toDelete) {
        if (sym.typeId === "fan" && sym.branchId) {
          updateBranch(sym.branchId, {
            hasFan: false, fanCurveId: "", fanName: "", fanPressure: 0,
            fanStopped: false, fanReverse: false, fanRpm: 0,
            fanBladeAngle: 0, fanParallel: 1, fanEfficiency: 0,
            fanShaftPower: 0, fanInstall: "Без перемычки", fanCrossingR: 0,
          }, false);
        }
        if (BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.branchId) {
          const otherBulkheadsOnBranch = schemaSymbols.filter(
            s => !selectedSymbolIds.has(s.id) && BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === sym.branchId
          );
          if (otherBulkheadsOnBranch.length === 0) {
            updateBranch(sym.branchId, {
              hasBulkhead: false, bulkheadR: 0, bulkheadAirPerm: 0,
              bulkheadManualR: 0, bulkheadSurveyQ: 0, bulkheadSurveyDP: 0,
            }, false);
          }
        }
        if (sym.typeId === "valve_water" && sym.branchId) {
          updateBranch(sym.branchId, { wpHasGate: false, wpGateClosed: false }, false);
        }
      }
      setSchemaSymbols(prev => prev.filter(s => !selectedSymbolIds.has(s.id)));
      setSelectedSymbolId(null);
      setSelectedSymbolIds(new Set());
    } else if (selectedSymbolId) {
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
      // При удалении запорного вентиля — сбрасываем флаг и открываем ветвь
      if (sym?.typeId === "valve_water" && sym.branchId) {
        updateBranch(sym.branchId, { wpHasGate: false, wpGateClosed: false }, false);
      }
      removeSymbol(selectedSymbolId);
      setSelectedSymbolId(null);
      setSelectedSymbolIds(new Set());
    } else if (selectedBranchIds.size > 1) {
      pushHistory();
      setBranches((p) => p.filter((b) => !selectedBranchIds.has(b.id)));
      setSelectedBranchId(null);
      setSelectedBranchIds(new Set());
    } else if (selectedBranchId) {
      pushHistory();
      setBranches((p) => p.filter((b) => b.id !== selectedBranchId));
      setSelectedBranchId(null);
      setSelectedBranchIds(new Set());
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
      case "delete_branch": {
        // Удаляем все выделенные ветви (или одну из контекстного меню)
        const targets = selectedBranchIds.size > 1
          ? new Set(selectedBranchIds)
          : branchId ? new Set([branchId]) : new Set<string>();
        if (targets.size > 0) {
          pushHistory();
          setBranches(p => p.filter(b => !targets.has(b.id)));
          if (branchId && targets.has(branchId)) setSelectedBranchId(null);
          setSelectedBranchIds(new Set());
        }
        break;
      }
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
      case "toggle_capital": {
        const targets = selectedBranchIds.size > 1 ? [...selectedBranchIds] : branchId ? [branchId] : [];
        if (targets.length > 0) {
          // Если хотя бы одна не капитальная — ставим всем; если все капитальные — снимаем
          const allCapital = targets.every(tid => branches.find(b => b.id === tid)?.capital);
          setBranches(p => p.map(b => targets.includes(b.id) ? { ...b, capital: !allCapital } : b));
        }
        break;
      }
      case "toggle_designed": {
        const targets = selectedBranchIds.size > 1 ? [...selectedBranchIds] : branchId ? [branchId] : [];
        if (targets.length > 0) {
          const allDesigned = targets.every(tid => branches.find(b => b.id === tid)?.designed);
          setBranches(p => p.map(b => targets.includes(b.id) ? { ...b, designed: !allDesigned } : b));
        }
        break;
      }
      case "reverse_branch": if (branchId) handleReverseBranch(branchId); break;
      case "add_vent_pipe": {
        // Собираем все выделенные ветви (или одну из контекстного меню)
        const ids = selectedBranchIds.size > 0
          ? [...selectedBranchIds]
          : branchId ? [branchId] : [];
        if (ids.length > 0) {
          setVentPipeBranchIds(ids);
          setShowVentPipeDialog(true);
        }
        break;
      }
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
        if (branchId) {
          setRightTab("branch");
          setSelectedBranchId(branchId);
          // При мультиселекте > 1 открываем диалог группового редактирования параметров
          if (selectedBranchIds.size > 1) {
            setVentPipeBranchIds([]); // сбрасываем вентруба если был открыт
            setShowMultiBranchProps(true);
          }
        }
        break;
    }
    setCtxMenu(null);
  };

  return (
    <>
    <div className="w-full flex flex-col"
      style={{ background: "#f0f0f0", fontFamily: "Segoe UI, Tahoma, sans-serif", fontSize: "12px", color: "#1f1f1f", height: "100dvh" }}>

      {/* ═══ TITLE BAR ════════════════════════════════════════════════════ */}
      {(() => {
        // Универсальные функции управления окном: работают и через WebView2 и через postMessage
        type W = Window & { __pvsWinMinimize?: () => void; __pvsWinMaximize?: () => void; __pvsWinClose?: () => void; __pvsWinDrag?: () => void; __pvsWindowMaximized?: boolean; chrome?: { webview?: { postMessage: (s: string) => void } } };
        const w = window as W;
        const winMinimize = () => {
          if (typeof w.__pvsWinMinimize === "function") w.__pvsWinMinimize();
          else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-minimize" }));
        };
        const winMaximize = () => {
          if (typeof w.__pvsWinMaximize === "function") w.__pvsWinMaximize();
          else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-maximize" }));
        };
        const winClose = () => {
          if (isDirty) { setShowCloseConfirm(true); return; }
          if (typeof w.__pvsWinClose === "function") w.__pvsWinClose();
          else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-close" }));
        };
        const winDrag = () => {
          if (typeof w.__pvsWinDrag === "function") w.__pvsWinDrag();
          else w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-drag" }));
        };
        const isMaximized = !!w.__pvsWindowMaximized;
        return (
      <div className="h-7 flex items-center select-none"
        style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)", borderBottom: "1px solid #b8b8b8" }}
        onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) return; winDrag(); }}
        onDoubleClick={winMaximize}>

        {/* Иконка + название — слева */}
        <div className="flex items-center gap-1.5 px-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            title="О программе"
            className="flex items-center justify-center hover:bg-black/10 rounded-sm p-0.5 transition-colors"
            style={{ lineHeight: 0 }}>
            <AppLogo className="w-4 h-4 object-contain" />
          </button>
          <span className="text-xs font-medium text-gray-700">ПВ-Система</span>
          {projectFileName && (
            <>
              <span className="text-xs text-gray-400">—</span>
              <span className="text-xs font-semibold" style={{ color: "#1a3a6b" }}>
                {projectFileName}{isDirty ? " *" : ""}
              </span>
            </>
          )}
        </div>

        {/* Растяжка — drag-зона по центру */}
        <div className="flex-1 h-full" />

        {/* Кнопки управления окном — справа */}
        <div className="flex items-center h-full shrink-0">
          <button
            className="w-10 h-full hover:bg-black/10 flex items-center justify-center text-[11px] text-gray-600 transition-colors"
            title="Свернуть" onClick={winMinimize}>
            ─
          </button>
          <button
            className="w-10 h-full hover:bg-black/10 flex items-center justify-center text-[11px] text-gray-600 transition-colors"
            title={isMaximized ? "Восстановить" : "Развернуть"} onClick={winMaximize}>
            {isMaximized ? "❐" : "▢"}
          </button>
          <button
            className="w-10 h-full hover:bg-red-500 hover:text-white flex items-center justify-center text-[11px] text-gray-600 transition-colors"
            title="Закрыть" onClick={winClose}>
            ✕
          </button>
        </div>
      </div>
        );
      })()}

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
        <RibbonTabBtn label="Справочники" active={activeRibbon === "general"} onClick={() => setActiveRibbon("general")} />
        <RibbonTabBtn label="Печать" active={false} onClick={() => setShowPrintDialog(true)} />
        <RibbonTabBtn label="Помощь" active={false} onClick={() => setShowHelpDialog(true)} />
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
                      { icon: "FileSpreadsheet" as const, label: "CSV из Вентиляция 2.0",      ext: "Вентиляция 2.0", action: "csv-vent2" },
                      { icon: "FileText" as const,    label: "CSV из Ventsim",                  ext: "Ventsim 5/6",    action: "csv-ventsim" },
                      { icon: "FileJson" as const,    label: "Добавить схему из файла",        ext: ".vproj / .json", action: "json" },
                      { icon: "Code" as const,        label: "Добавить схему из XML",           ext: ".xml",           action: "xml"  },
                      { icon: "Pencil" as const,      label: "Добавить схему из DXF",           ext: ".dxf",           action: "dxf"  },
                      { icon: "FileText" as const,    label: "Добавить схему из TXT",           ext: ".txt",           action: "txt"  },
                    ].map((item) => (
                      <button key={item.label}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left rounded hover:bg-blue-50 group"
                        onClick={() => {
                          if (item.action === "csv-aero") {
                            setShowCsvImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "csv-vent2") {
                            setShowVent2CsvImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "csv-ventsim") {
                            setShowVentsimImport(true);
                            setActiveRibbon("home");
                          } else if (item.action === "dxf") {
                            setShowDxfImport(true);
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
                            background: item.action === "csv-aero" ? "#dcfce7" : item.action === "csv-vent2" ? "#dbeafe" : item.action === "csv-ventsim" ? "#fef9c3" : item.action === "combined" ? "#ede9fe" : item.action === "dxf" ? "#dbeafe" : "#fff",
                            borderColor: item.action === "csv-aero" ? "#86efac" : item.action === "csv-vent2" ? "#93c5fd" : item.action === "csv-ventsim" ? "#fde047" : item.action === "combined" ? "#a78bfa" : item.action === "dxf" ? "#93c5fd" : "#d1d5db",
                          }}>
                          <Icon name={item.icon} size={18} />
                        </div>
                        <div>
                          <div className="text-[12px] font-medium" style={{ color: item.action === "csv-aero" ? "#15803d" : item.action === "csv-vent2" ? "#1e40af" : item.action === "csv-ventsim" ? "#854d0e" : item.action === "combined" ? "#5b21b6" : "#1f2937" }}>
                            {item.label}
                          </div>
                          <div className="text-[10px] text-gray-400">
                            {item.action === "csv-aero" ? "✓ X,Y,Z координаты + все параметры в одном файле"
                            : item.action === "csv-vent2" ? "✓ Файл → Экспорт в CSV, настраиваемые столбцы"
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

                {/* ── Установить приложение (десктоп) ── */}
                {fileSectionState === "install" && (() => {
                  return (
                    <>
                      <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300">Установить приложение для Windows</div>
                      <div className="text-[12px] text-gray-600 mb-3 leading-relaxed">
                        Скачайте настольную версию ПВ-Система — она работает без браузера и без интернета,
                        со встроенным расчётным ядром. Ссылка всегда ведёт на самую свежую версию.
                      </div>
                      <div className="mb-3">
                        <a
                          href={INSTALLER_URL}
                          rel="noopener"
                          className="w-full flex items-center gap-3 px-3 py-3 text-left rounded hover:bg-blue-50 border border-blue-200 group no-underline">
                          <div className="w-10 h-10 flex items-center justify-center rounded border border-blue-300 group-hover:border-blue-500" style={{ background: "#eff6ff" }}>
                            <Icon name="Download" size={22} className="text-blue-600" />
                          </div>
                          <div>
                            <div className="text-[13px] font-medium text-blue-700">
                              Скачать ПВ-Система для ПК{desktopLatestVer ? ` (v${desktopLatestVer})` : ""}
                            </div>
                            <div className="text-[11px] text-gray-400">Windows 10/11 · установщик PVS-Setup.exe</div>
                          </div>
                        </a>
                      </div>
                      <div className="text-[11px] text-gray-400 leading-relaxed px-1 mb-3">
                        После загрузки запустите установщик <b>PVS-Setup.exe</b> — программа установится в
                        <b> C:\Program Files\PVS</b> (потребуется подтверждение прав администратора) и свяжет файлы
                        схем <b>.vproj</b> с приложением.
                      </div>

                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon name="ShieldAlert" size={15} className="text-amber-600 flex-shrink-0" />
                          <span className="text-[12px] font-semibold text-amber-800">Браузер или Windows блокирует загрузку?</span>
                        </div>
                        <div className="text-[11px] text-amber-700 leading-relaxed">
                          Это защита <b>SmartScreen</b>: она предупреждает о новых файлах без цифровой подписи. Установщик безопасен. Чтобы продолжить:
                          <div className="mt-1.5 space-y-1">
                            <div>• <b>При скачивании</b> (значок «Загрузки»): нажмите <b>«···» → «Сохранить»</b>, затем «Подробнее» → <b>«Всё равно сохранить»</b>.</div>
                            <div>• <b>При запуске</b> установщика: в окне «Windows защитила ваш компьютер» нажмите <b>«Подробнее» → «Выполнить в любом случае»</b>.</div>
                            <div>• Если сработал антивирус — добавьте <b>PVS-Setup.exe</b> в исключения.</div>
                          </div>
                        </div>
                      </div>
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

                {/* ── Последние файлы ── */}
                {fileSectionState === "recent" && (() => {
                  const handleOpenRecent = async (rf: typeof recentFiles[0]) => {
                    const confirmReplace = () =>
                      (nodes.length > 0 || branchesRaw.length > 0)
                        ? window.confirm("Открыть проект? Текущие данные будут заменены.")
                        : true;

                    // 1. Пробуем FileSystemFileHandle из IndexedDB (файл с диска)
                    const handle = await loadHandleFromIDB(rf.name);
                    if (handle) {
                      try {
                        // Запрашиваем разрешение на чтение (браузер покажет системный диалог один раз)
                        const perm = await (handle as FileSystemFileHandle & {
                          queryPermission: (o: { mode: string }) => Promise<string>;
                          requestPermission: (o: { mode: string }) => Promise<string>;
                        }).queryPermission({ mode: "read" });
                        const granted = perm === "granted" ||
                          (await (handle as FileSystemFileHandle & {
                            requestPermission: (o: { mode: string }) => Promise<string>;
                          }).requestPermission({ mode: "read" })) === "granted";
                        if (granted) {
                          const file = await handle.getFile();
                          const data = JSON.parse(await file.text()) as Record<string, unknown>;
                          if (!confirmReplace()) return;
                          fileHandleRef.current = handle;
                          applyProjectData(data, file.name);
                          setActiveRibbon("home");
                          return;
                        }
                      } catch (_e) {
                        // handle устарел или доступ отклонён — fallback
                      }
                    }

                    // 2. Fallback — данные из localStorage
                    const data = loadRecentData(rf.name);
                    if (data) {
                      if (!confirmReplace()) return;
                      applyProjectData(data, rf.name);
                      setActiveRibbon("home");
                      return;
                    }

                    // 3. Ничего нет — предлагаем открыть вручную
                    alert(`Файл «${rf.name}» недоступен.\nОткройте его через «Файл → Открыть» — он снова появится в списке.`);
                  };

                  const canOpen = (rf: typeof recentFiles[0]) =>
                    rf.hasHandle || !!loadRecentData(rf.name);

                  return (
                    <>
                      <div className="text-[13px] font-semibold mb-3 pb-1 border-b border-gray-300 flex items-center justify-between">
                        <span>Последние файлы</span>
                        {recentFiles.length > 0 && (
                          <button onClick={clearRecentFiles}
                            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors">
                            Очистить список
                          </button>
                        )}
                      </div>
                      {recentFiles.length === 0 ? (
                        <div className="text-[12px] text-gray-400 pt-6 flex flex-col items-center gap-2">
                          <Icon name="Clock" size={32} className="text-gray-300" />
                          <span>Нет недавно открытых файлов</span>
                          <span className="text-[11px] text-center text-gray-300">Откройте проект через «Открыть»,<br/>и он появится здесь</span>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {recentFiles.map((rf) => {
                            const d = new Date(rf.openedAt);
                            const dateStr = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
                            const timeStr = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                            const available = canOpen(rf);
                            return (
                              <div key={rf.name + rf.openedAt}
                                className="group flex items-center gap-2 px-2 py-2 rounded border border-transparent hover:border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer"
                                onClick={() => void handleOpenRecent(rf)}>
                                <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded border"
                                  style={{ background: available ? "#dbeafe" : "#f3f4f6", borderColor: available ? "#93c5fd" : "#d1d5db" }}>
                                  <Icon name="FileText" size={16} className={available ? "text-blue-500" : "text-gray-400"} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[12px] font-medium truncate group-hover:text-blue-700"
                                    style={{ color: available ? "#1e293b" : "#9ca3af" }}>{rf.name}</div>
                                  <div className="text-[10px] text-gray-400">
                                    {dateStr} {timeStr}
                                    {rf.nodeCount !== undefined && (
                                      <span className="ml-2">· Узлов: {rf.nodeCount} · Ветвей: {rf.branchCount ?? 0}</span>
                                    )}
                                    {rf.hasHandle && <span className="ml-2 text-green-500">· с диска</span>}
                                    {!available && <span className="ml-2 text-amber-400">· недоступен</span>}
                                  </div>
                                </div>
                                {available && (
                                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                                    <span className="text-[10px] text-blue-400">Открыть</span>
                                    <Icon name="FolderOpen" size={13} className="text-blue-400" />
                                  </div>
                                )}
                                <button
                                  title="Убрать из списка"
                                  onClick={(e) => { e.stopPropagation(); removeRecentFile(rf.name); }}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 transition-all ml-1">
                                  <Icon name="X" size={12} className="text-gray-400 hover:text-red-500" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="mt-4 pt-3 border-t border-gray-200 text-[11px] text-gray-400 flex items-center gap-1.5">
                        <Icon name="Info" size={12} className="text-gray-300 flex-shrink-0" />
                        <span>Также можно перетащить .vproj файл прямо на холст схемы</span>
                      </div>
                    </>
                  );
                })()}

                {/* ── Остальные секции — заглушки ── */}
                {!["new", "add", "open", "save", "saveas", "print", "export", "install", "license", "recent"].includes(fileSectionState) && (
                  <div className="text-[12px] text-gray-400 pt-4">
                    Функция «{sections.find((s) => s.id === fileSectionState)?.label}» будет реализована.
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Вкладка Вентиляция использует общий ribbon-блок с условием activeRibbon === "thermo" */}

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
            <RibbonBigBtn icon="Flame" label="Потребители" sublabel="" onClick={() => { setEquipRefTab("consumers"); setShowEquipRef(true); }} />
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
      <div className="h-[80px] flex items-stretch px-2 py-1.5 gap-0 overflow-x-auto"
        style={{ background: "linear-gradient(180deg,#fff5f5,#fce8e8)", borderBottom: "1px solid #fca5a5" }}>

        {/* ── Группа: Пожар ── */}
        <RibbonGroup label="Пожар">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="Flame"
              iconImg="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/b103762c-b3b1-4749-8268-7b41f4e07a77.png"
              label="Установить"
              sublabel="очаг пожара"
              onClick={() => { handlePickSymbol("fire_source"); setActiveRibbon("involve"); }}
              active={schemaSymbols.some(s => s.typeId === "fire_source")}
              style={{ background: schemaSymbols.some(s => s.typeId === "fire_source") ? "#fee2e2" : undefined,
                       borderColor: schemaSymbols.some(s => s.typeId === "fire_source") ? "#fca5a5" : undefined }}
            />
            <RibbonBigBtn
              icon="Trash2"
              label="Убрать"
              sublabel="очаги"
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

        {/* ── Группа: Расчёт пожара ── */}
        <RibbonGroup label="Расчёт пожара">
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
                const FIRE_ITERS   = 12;   // макс. итераций
                const FIRE_Q_TOL   = 0.2;  // м³/с — допуск сходимости (уровень шума сети)
                const FIRE_RELAX   = 0.5;  // коэф. релаксации (демпфирование обратной связи T↑→Q↓)
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

                  // Шаг B: пересчитать мощность очага из свойств материала по
                  // актуальному расходу (кабель/дерево/конвейер/техника). Для
                  // угля/масла/произвольного авто-расчёта нет — мощность ручная.
                  branchesIter = branchesIter.map(b => {
                    if (!b.hasFire) return b;
                    const autoP = calcFirePowerFromMaterial(b);
                    return autoP != null && autoP > 0
                      ? { ...b, fireHeatRelease: autoP, fireMode: "heat" as const }
                      : b;
                  });

                  // Шаг C: вычислить T_пр и h_t для каждого очага
                  const branchesWithHt = branchesIter.map(b => {
                    if (!b.hasFire) return b;
                    const Q_MW  = b.fireMode === "heat" ? b.fireHeatRelease : 0;
                    const airQ  = Math.abs(b.flow ?? 0);
                    const T_pr  = b.fireMode === "temp"
                      ? b.fireTemperature
                      : calcFireTemp(Q_MW, airQ, AMBIENT_TEMP);
                    // Знак угла — ГЕОМЕТРИЧЕСКИЙ, в ориентации ветви from→to
                    // (to выше from → +). Направление потока учитывать ЗДЕСЬ НЕ
                    // нужно: решатель сам разворачивает тепловую тягу по знаку
                    // расхода (naturalDraft * sign(Q)), как и для естественной
                    // тяги. Домножение на flowSign здесь → двойной учёт и ложное
                    // опрокидывание.
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

                  // Шаг E: релаксация (демпфирование) + проверка сходимости.
                  // Без релаксации обратная связь «расход↓ → температура↑ →
                  // тепловая депрессия↑ → расход↓» расходится: поток схлопывается,
                  // а температура ложно упирается в потолок 1200°C и ветвь
                  // помечается неустойчивой. Смешиваем новый расход со старым.
                  let maxDQ = 0;
                  const relaxedFlows = new Map<string, number>();
                  newFlows.forEach((q, id) => {
                    const prev = currentFlows.get(id) ?? 0;
                    const relaxed = prev + FIRE_RELAX * (q - prev);
                    relaxedFlows.set(id, relaxed);
                    maxDQ = Math.max(maxDQ, Math.abs(relaxed - prev));
                  });
                  addLog("info", `  Итерация ${iter + 1}: max|ΔQ|=${maxDQ.toFixed(3)} м³/с`);

                  currentFlows = relaxedFlows;
                  if (maxDQ < FIRE_Q_TOL) break;
                }

                // ── Финальный расчёт характеристик пожара по сошедшимся расходам ──
                // Подставляем итоговые Q и пересчитываем мощность (Техника) ещё раз.
                // originalFlow = исходный расход ДО итераций (для обнаружения опрокидывания).
                const branchesForFire = branches.map(b => {
                  const finalQ = currentFlows.get(b.id) ?? b.flow;
                  // originalFlow — расход ДО пожара (до итераций), для детектирования опрокидывания
                  const bUpdated = { ...b, flow: finalQ, originalFlow: originalFlows.get(b.id) ?? b.flow };
                  if (!b.hasFire) return bUpdated;
                  // Мощность очага из свойств материала по итоговому расходу.
                  const autoP = calcFirePowerFromMaterial(bUpdated);
                  return autoP != null && autoP > 0
                    ? { ...bUpdated, fireHeatRelease: autoP, fireMode: "heat" as const }
                    : bUpdated;
                });

                // Обновляем flow в state из итеративного расчёта
                setBranches(prev => prev.map(b => {
                  const q = currentFlows.get(b.id);
                  return q !== undefined ? { ...b, flow: q } : b;
                }));

                const result = calcFireMode(branchesForFire, nodes, AMBIENT_TEMP, smokeVisThreshold);
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
                // Записываем расчётные концентрации CO/CO₂ и температуры в узлы
                // (распространение по сети). Для незадымлённых узлов — фоновые
                // значения: температура воздуха и стенок = температура на поверхности.
                setNodes(prev => prev.map(n => {
                  const g = result.nodeGas.get(n.id);
                  return { ...n,
                    computedCO:  g?.co ?? 0,
                    computedCO2: g?.co2 ?? 0,
                    computedAirTemp:  g?.airTemp  ?? AMBIENT_TEMP,
                    computedWallTemp: g?.wallTemp ?? AMBIENT_TEMP,
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
              className="flex flex-col items-center justify-center rounded border transition-colors min-w-[52px] disabled:opacity-40"
              style={{ width: 52, height: 60, background: "#dc2626", color: "white", borderColor: "#b91c1c", cursor: "pointer", flexShrink: 0 }}
              title="Расчёт распространения задымления и тепловой депрессии">
              <img src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/b103762c-b3b1-4749-8268-7b41f4e07a77.png" alt="Расчёт пожара" style={{ width: 22, height: 22, objectFit: "contain", filter: "brightness(0) invert(1)" }} />
              <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500, marginTop: 2 }}><div>Расчёт</div><div>пожара</div></div>
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
              icon="RotateCcw"
              label="Сбросить"
              sublabel="пожар"
              disabled={!fireCalcDone}
              onClick={() => { setFireResult(null); setFireCalcDone(false); setBranches(prev => prev.map(b => ({ ...b, fireComputedTemp: 0, fireComputedNatDep: 0, fireComputedSmokeDens: 0, fireComputedCO: 0, fireComputedCO2: 0 }))); }}
            />
          </div>
        </RibbonGroup>

        {/* ── Группа: Взрыв ── */}
        <RibbonGroup label="Взрыв">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="Zap"
              iconImg="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/f151acd7-084c-42cf-a1a8-86296bced0c9.png"
              label="Установить"
              sublabel="место взрыва"
              onClick={() => { handlePickSymbol("explosion_source"); setActiveRibbon("involve"); }}
              active={schemaSymbols.some(s => s.typeId === "explosion_source")}
              style={{ background: schemaSymbols.some(s => s.typeId === "explosion_source") ? "#fef3c7" : undefined,
                       borderColor: schemaSymbols.some(s => s.typeId === "explosion_source") ? "#fcd34d" : undefined }}
            />
            <RibbonBigBtn
              icon="Trash2"
              label="Убрать"
              sublabel="очаги"
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
                    // Формулы согласованы с explosionCalculator.ts
                    const sadovsky = (r: number): number => {
                      if (_qTnt <= 0 || r <= 0) return 0;
                      const rBar = r / Math.pow(_qTnt, 1 / 3);
                      if (rBar < 0.1) return 10000;
                      // P0 НЕ умножаем — коэффициенты уже в кПа (Садовский)
                      return Math.round((0.84 / rBar + 2.7 / (rBar * rBar) + 7.15 / (rBar * rBar * rBar)) * 10) / 10;
                    };
                    const fnip494 = (r: number): number => {
                      if (_qTnt <= 0 || r <= 0) return 0;
                      // Коэф. 1.5 согласован с Аэросетью (ВНИМИ) для горных выработок
                      return Math.round(1.5 * Math.pow(_qTnt / (r * r * r), 1 / 3) * 101.3 * 10) / 10;
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
                    // Волна останавливается на атмосферных узлах (выход на поверхность)
                    const toNode = nodes.find(n => n.id === e.to);
                    if (toNode?.atmosphereLink) continue;
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
              className="flex flex-col items-center justify-center rounded border transition-colors min-w-[52px] disabled:opacity-40"
              style={{ width: 52, height: 60, background: "#d97706", color: "white", borderColor: "#b45309", cursor: "pointer", flexShrink: 0 }}
              title="Расчёт параметров воздушной ударной волны">
              <img src="https://cdn.poehali.dev/projects/564c75d6-cb0f-4378-9852-c88803b7dcf2/bucket/f151acd7-084c-42cf-a1a8-86296bced0c9.png" alt="Расчёт взрыва" style={{ width: 22, height: 22, objectFit: "contain", filter: "brightness(0) invert(1)" }} />
              <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500, marginTop: 2 }}><div>Расчёт</div><div>взрыва</div></div>
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
              icon="RotateCcw"
              label="Сбросить"
              sublabel="взрыв"
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

        {/* ── Группа: Пути движения ── */}
        <RibbonGroup label="Пути движения">
          <div className="flex items-stretch gap-1">
            <RibbonBigBtn
              icon="PersonStanding"
              label="Время"
              sublabel="горнорабочего"
              style={{ width: 64 }}
              active={activeSide === "workerPath"}
              onClick={() => {
                if (activeSide === "workerPath") {
                  setActiveSide("general");
                  setWorkerPickMode(null);
                  setWorkerPathBranchIds(new Set());
                  setWorkerPathBranchDirs(new Map());
                  setWorkerPathNodeIds(new Set());
                  setWorkerStartNodeId("");
                  setWorkerTargetNodeId("");
                } else {
                  setActiveSide("workerPath");
                }
              }}
            />
            <RibbonBigBtn
              icon="ShieldCheck"
              label="Горноспа-"
              sublabel="сатели"
              active={activeSide === "rescue"}
              onClick={() => {
                if (activeSide === "rescue") {
                  setActiveSide("general");
                  setRescuePickMode(null);
                  setRescuePathBranchIds(new Set());
                  setRescuePathBranchDirs(new Map());
                  setRescuePathNodeIds(new Set());
                  setRescueStartNodeId("");
                  setRescueTargetNodeId("");
                } else {
                  setActiveSide("rescue");
                }
              }}
            />
          </div>
        </RibbonGroup>

        {/* ── Результат пожара ── */}
        {fireCalcDone && fireResult && (
          <RibbonGroup label="Результат: пожар">
            <div className="flex flex-col justify-center px-2 gap-0.5" style={{ fontSize: 10, minWidth: 148 }}>
              <div className="font-semibold" style={{ color: "#b91c1c" }}>T очага: {fireResult.fireTemp.toFixed(1)} °C</div>
              <div style={{ color: "#c2410c" }}>h_t = {fireResult.fireThermalDep.toFixed(1)} Па</div>
              <div style={{ color: "#374151" }}>Задымлено: {fireResult.branches.size} вет.</div>
              {fireResult.reversedBranches.size > 0
                ? <div className="font-semibold px-1 rounded" style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>⚠ Опрокид.: {fireResult.reversedBranches.size}</div>
                : <div style={{ color: "#15803d" }}>✓ Струя устойчива</div>
              }
            </div>
          </RibbonGroup>
        )}

        {/* ── Результат взрыва ── */}
        {explosionCalcDone && explosionResult && (
          <RibbonGroup label="Результат: взрыв">
            <div className="flex flex-col justify-center px-2 gap-0.5" style={{ fontSize: 10, minWidth: 148 }}>
              <div className="font-semibold" style={{ color: "#92400e" }}>Q_тнт: {explosionResult.q_tnt_kg} кг</div>
              <div style={{ color: "#c2410c" }}>ΔP_max = {explosionResult.maxDeltaP_kPa} кПа</div>
              <div style={{ color: "#374151" }}>D = {explosionResult.waveFrontSpeed_ms} м/с</div>
              <div style={{ color: "#b91c1c" }}>R_лет. = {explosionResult.zones[0]?.radius_m ?? 0} м</div>
            </div>
          </RibbonGroup>
        )}
      </div>
      )}

      {/* ═══ RIBBON CONTENT ═══════════════════════════════════════════════ */}
      {activeRibbon !== "general" && activeRibbon !== "involve" && (
      <div className="h-[80px] flex items-stretch px-2 py-1.5 gap-0 overflow-x-auto"
        style={{ background: "linear-gradient(180deg,#f5f5f5,#e8e8e8)", borderBottom: "1px solid #b0b0b0" }}>

        {/* ── Группа: Объекты ── */}
        <RibbonGroup label="Объекты">
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
          {/* УО Позиции ПЛА */}
          <RibbonBigBtn
            icon="MapPin"
            label="Позиция"
            sublabel="ПЛА"
            active={positionPlaceMode}
            title="Разместить маркер выбранной позиции ПЛА на схеме"
            onClick={() => {
              if (!selectedPositionId) { setActiveSide("positions"); }
              else { setPositionPlaceMode(v => !v); }
            }} />
          {/* Текстовый блок */}
          <RibbonBigBtn
            icon="Type"
            label="Текст"
            sublabel="блок"
            active={tool === "textblock"}
            title="Добавить текстовый блок (кликните на схеме)"
            onClick={() => setTool(tool === "textblock" ? "select" : "textblock")} />
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
          <RibbonBigBtn icon="Undo2" label="Отменить" sublabel="действие"
            onClick={handleUndo}
            disabled={historyRef.current.length === 0} />
        </RibbonGroup>

        {/* ── Группа: Команды вентилятора (main_loop: calc/reverse/off/report) ── */}
        {selectedBranch?.hasFan && (
          <RibbonGroup label="Вентилятор">
              {/* calc — пересчитать сеть */}
              <button onClick={handleSolve} disabled={vcSolving}
                className="flex flex-col items-center justify-center rounded disabled:opacity-50 transition-colors"
                style={{ width: 52, height: 60, border: "1px solid transparent", background: "transparent", flexShrink: 0, cursor: "pointer" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#f0fdf4"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#86efac"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
                title="Пересчитать (F9)">
                <Icon name="RefreshCw" size={20} className="text-green-600" />
                <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500, color: "#15803d", marginTop: 2 }}>Расчёт</div>
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
          </RibbonGroup>
        )}

        {/* ── Группа: ПЛА ── */}
        <RibbonGroup label="ПЛА">
          <div className="relative">
            <button
              onClick={() => setShowPlaPanel(v => !v)}
              title="План ликвидации аварии — настройки отображения позиций"
              style={{
                width: 52, height: 60,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                borderRadius: 4,
                border: showPlaPanel ? "1.5px solid #2563eb" : (showPositions || posColorInner || posColorOuter) ? "1.5px solid #7c3aed" : "1px solid transparent",
                background: showPlaPanel ? "#dbeafe" : (showPositions || posColorInner || posColorOuter) ? "#f5f3ff" : "transparent",
                cursor: "pointer", padding: 0, flexShrink: 0,
              }}>
              <Icon name="MapPin" size={20} style={{ color: (showPositions || posColorInner || posColorOuter) ? "#7c3aed" : "#4b5563" }} />
              <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", color: (showPositions || posColorInner || posColorOuter) ? "#7c3aed" : "#374151", fontWeight: 500 }}>
                <div>ПЛА</div>
              </div>
              <Icon name="ChevronDown" size={9} style={{ color: "#9ca3af", marginTop: -1 }} />
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
            {/* Кнопка запуска */}
            <button onClick={handleSolve} disabled={vcSolving}
              className="flex flex-col items-center justify-center rounded disabled:opacity-50 transition-colors"
              style={{ width: 52, height: 60, border: "1px solid transparent", background: "transparent", flexShrink: 0, cursor: "pointer" }}
              onMouseEnter={e => { if (!vcSolving) { (e.currentTarget as HTMLButtonElement).style.background = "#f0fdf4"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#86efac"; } }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
              title="Запустить расчёт воздухораспределения (F9)">
              <Icon name={vcSolving ? "Loader" : "Play"} size={20} className={vcSolving ? "text-gray-400 animate-spin" : "text-green-600"} />
              <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500, color: "#15803d", marginTop: 2 }}>
                <div>Расчёт</div><div>сети</div>
              </div>
            </button>

            {/* Кнопка параметров */}
            <div className="relative">
              <button onClick={() => setShowSolverParams(v => !v)}
                className="flex flex-col items-center justify-center rounded transition-colors"
                style={{ width: 52, height: 60, border: showSolverParams ? "1.5px solid #3b82f6" : "1px solid transparent", background: showSolverParams ? "#dbeafe" : "transparent", flexShrink: 0, cursor: "pointer" }}
                onMouseEnter={e => { if (!showSolverParams) { (e.currentTarget as HTMLButtonElement).style.background = "#e8f0fe"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#93c5fd"; } }}
                onMouseLeave={e => { if (!showSolverParams) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; } }}
                title="Параметры расчёта">
                <Icon name="Settings" size={20} className="text-gray-500" />
                <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500, color: "#6b7280", marginTop: 2 }}>Параметры</div>
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
                    <div className="flex items-center gap-1.5 mb-2">
                      <input
                        id="useNaturalDraft"
                        type="checkbox"
                        checked={useNaturalDraft}
                        onChange={e => setUseNaturalDraft(e.target.checked)}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer"
                      />
                      <label htmlFor="useNaturalDraft" className="text-[11px] font-semibold text-gray-700 cursor-pointer select-none">
                        Учитывать естественную тягу
                      </label>
                    </div>
                    {useNaturalDraft && (
                      <>
                        <label className="text-[10px] text-gray-500 block mb-1">Температура на поверхности (°C)</label>
                        <input type="number" value={surfaceTemp} step="1" min="-60" max="50"
                          onChange={e => setSurfaceTemp(Number(e.target.value))}
                          className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 text-right mb-2" />
                        <label className="text-[10px] text-gray-500 block mb-1">
                          Геотерм. градиент (°C / 100 м глубины)
                        </label>
                        <input type="number" value={geoGradient} step="0.5" min="0" max="10"
                          onChange={e => setGeoGradient(Number(e.target.value))}
                          className="w-full text-[11px] border border-gray-300 rounded px-1.5 py-1 text-right" />
                        <div className="text-[9px] text-gray-400 mt-1 leading-relaxed">
                          Температура каждого узла рассчитывается автоматически<br/>
                          по глубине: T = T_пов + градиент × глубина / 100
                        </div>
                      </>
                    )}
                    {!useNaturalDraft && (
                      <div className="text-[9px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        Все узлы получают T = T_пов, разность плотностей = 0, тяга = 0 Па
                      </div>
                    )}
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
              <div className="flex flex-col justify-center px-2 text-[9.5px] border-l border-gray-300 ml-1" style={{ minWidth: 80 }}>
                <div className={`font-semibold ${solveResult.ok ? "text-green-700" : "text-red-600"}`}>
                  {solveResult.ok ? "✔ Сошлось" : "✘ Не сошлось"}
                </div>
                <div className="text-gray-500">Ит: {solveResult.iterations}</div>
                <div className="text-gray-500">|ΔH|: {solveResult.maxDeltaH?.toExponential(2)}</div>
              </div>
            )}
        </RibbonGroup>

        {/* ── Группа: Депрессиограмма (только во вкладке Вентиляция) ── */}
        {activeRibbon === "thermo" && (
          <RibbonGroup label="Анализ">
            <RibbonBigBtn
              icon="TrendingDown"
              label="Депрессио-"
              sublabel="грамма"
              title="Построить депрессиограмму главного маршрута"
              disabled={!solveResult}
              onClick={() => setShowDepressogram(true)}
            />
            <RibbonBigBtn
              icon="ShieldCheck"
              label="Устойчивость"
              sublabel="при пожаре"
              title="Проверка устойчивости вентиляционных режимов при пожаре и формирование Акта устойчивости"
              onClick={() => setShowFireStability(true)}
            />
            <RibbonBigBtn
              icon="Gauge"
              label="ВДС"
              sublabel=""
              title="Воздушно-депрессионная съёмка: эквивалентное отверстие шахты и другие расчёты по схеме"
              onClick={() => setShowVds(true)}
            />
          </RibbonGroup>
        )}

        {/* ── Группа: Сравнение схем (только во вкладке Схема) ── */}
        {activeRibbon === "vent" && (<>
          <RibbonGroup label="Сравнение">
            <RibbonBigBtn
              icon="GitCompare"
              label="Сравнение"
              sublabel="схем"
              title="Сравнить текущую схему с другим файлом проекта"
              active={activeSide === "compare" && leftPanelOpen}
              onClick={() => setCompareShowDialog(true)}
            />
          </RibbonGroup>
          {compareResult && (
            <RibbonGroup label="Результат сравнения">
              <div className="flex flex-col justify-center px-2 text-[10px] gap-0.5 min-w-[140px]">
                <div className="font-semibold text-blue-700 truncate max-w-[130px]" title={compareResult.fileName}>↔ {compareResult.fileName}</div>
                <div className="flex gap-2">
                  <span style={{ color: "#f59e0b" }}>● {compareResult.branches.filter(b => b.status === "changed").length} изм.</span>
                  <span style={{ color: "#22c55e" }}>● {compareResult.branches.filter(b => b.status === "added").length} доб.</span>
                  <span style={{ color: "#ef4444" }}>● {compareResult.branches.filter(b => b.status === "removed").length} уд.</span>
                </div>
                <div className="flex gap-1 mt-0.5">
                  <button
                    onClick={() => { setActiveSide("compare"); setLeftPanelOpen(true); }}
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                    style={{ background: activeSide === "compare" ? "#2563eb" : "#e5e7eb", color: activeSide === "compare" ? "white" : "#374151" }}>
                    Показать панель
                  </button>
                  <button
                    onClick={() => { setCompareResult(null); setCompareSelectedId(null); }}
                    className="px-1.5 py-0.5 rounded text-[9px] font-medium"
                    style={{ background: "#fee2e2", color: "#dc2626" }}>
                    Сбросить
                  </button>
                </div>
              </div>
            </RibbonGroup>
          )}
        </>)}

        {/* ── Группа: Анализ ── */}
        <RibbonGroup label="Анализ">
            <button
              onClick={() => setShowExcelExport(true)}
              className="flex flex-col items-center justify-center rounded transition-colors"
              style={{ width: 52, height: 60, border: "1px solid transparent", background: "transparent", flexShrink: 0, cursor: "pointer" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#f0fdf4"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#86efac"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
              title="Экспорт параметров выработок в Excel">
              <Icon name="FileSpreadsheet" size={20} className="text-green-700" />
              <div style={{ fontSize: 9.5, lineHeight: "1.2", textAlign: "center", fontWeight: 500, color: "#15803d", marginTop: 2 }}>
                <div>Экспорт</div><div>в Excel</div>
              </div>
            </button>
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
          style={{ width: 24, background: "#e8e8e8", borderRight: "1px solid #b8b8b8", overflow: "hidden" }}>
          {(selectedNodeId || selectedBranchId || fanSymbolBranchId) && (selectedNodeId
            ? ([
                { id: "params", label: "Параметры" },
                { id: "measure", label: "Замеры" },
                { id: "waterpipes", label: "Трубы" },
                { id: "indicators", label: "Индикаторы" },
              ] as { id: SideTab; label: string }[])
            : fanSymbolBranchId
            ? ([
                { id: "fan", label: "Вентилятор" },
                { id: "fan-indicators", label: "Индикаторы" },
              ] as { id: SideTab; label: string }[])
            : ([
                { id: "general", label: "Общие" },
                { id: "vent", label: "Вентиляция" },
                { id: "indicators", label: "Индикаторы" },
                { id: "topology", label: "Топология" },
                { id: "areas", label: "Участки" },
                { id: "waterpipes", label: "Трубы:" },
                { id: "conveyor", label: "Конвейер" },
                { id: "fireload", label: "Пож.нагрузка" },
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
                value={activeSide === "horizons" ? "horizons" : activeSide === "search" ? "search" : activeSide === "positions" ? "positions" : activeSide === "flowQ" ? "flowQ" : activeSide === "check" ? "check" : "props"}
                onChange={(e) => {
                  if (e.target.value === "horizons") setActiveSide("horizons");
                  else if (e.target.value === "search") setActiveSide("search");
                  else if (e.target.value === "positions") setActiveSide("positions");
                  else if (e.target.value === "flowQ") { setActiveSide("flowQ"); setColorMode("flowQ"); }
                  else if (e.target.value === "check") setActiveSide("check");
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
              {activeSide === "check" && "Проверка схемы"}
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
                    // Поиск узла ТОЛЬКО по номеру узла
                    const num = String(n.number ?? "").toLowerCase();
                    if (num && num.includes(q)) {
                      hits.push({
                        kind: "node",
                        id: n.id,
                        title: `Узел ${n.number || n.id}`,
                        subtitle: `№ ${n.number || "—"} · X=${n.x.toFixed(1)} Y=${n.y.toFixed(1)} Z=${n.z.toFixed(1)}`,
                      });
                    }
                  }
                }
                if (searchScope === "all" || searchScope === "branches") {
                  for (const b of branches) {
                    const fromN = nodes.find(n => n.id === b.fromId);
                    const toN = nodes.find(n => n.id === b.toId);
                    // Поиск ветви по номерам узлов (и типу/имени вентилятора)
                    const fields = [b.id, b.type, b.fanName, fromN?.number, toN?.number]
                      .filter(Boolean).map(String);
                    if (fields.some(f => f.toLowerCase().includes(q))) {
                      hits.push({
                        kind: "branch",
                        id: b.id,
                        title: `Ветвь ${b.id}${b.type ? ` (${b.type})` : ""}`,
                        subtitle: `${fromN?.number || b.fromId} → ${toN?.number || b.toId}${b.hasFan ? " · вентилятор" : ""}`,
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


            {/* ═══ ВКЛАДКА: ПРОВЕРКА СХЕМЫ ═══════════════════════════════ */}
            {activeSide === "check" && schemaCheckResult && (() => {
              const {
                nearPairs, isolated, dupes, dupBranches,
                zeroRBranches, zeroLenBranches, highRBranches, bulkBranches, manualLenBranches,
                isolatedBranches, noAtmosphere,
                tabCounts, totalIssues, truncated,
              } = schemaCheckResult;

              // Карта узлов для быстрого поиска в подписях ветвей (без O(n) find)
              const nodeById = new Map(nodes.map(n => [n.id, n]));

              const navBtn = (id: typeof checkTab, label: string, count: number, icon: string) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCheckTab(id)}
                  className="flex-1 flex flex-col items-center py-1.5 gap-0.5 text-[10px] font-medium transition-colors relative"
                  style={{
                    background: checkTab === id ? "#fff" : "transparent",
                    color: checkTab === id ? "#1e40af" : "#6b7280",
                    borderBottom: checkTab === id ? "2px solid #2563eb" : "2px solid transparent",
                  }}
                >
                  <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={13} />
                  <span>{label}</span>
                  {count > 0 && (
                    <span className="absolute top-0.5 right-1 text-[9px] font-bold px-1 rounded-full"
                      style={{ background: "#fee2e2", color: "#dc2626" }}>
                      {count}
                    </span>
                  )}
                </button>
              );

              const focusNode = (id: string) => {
                setSelectedNodeId(id);
                setSelectedBranchId(null);
                setFocusNodeId(id);
                setFocusNonce(Date.now());
              };

              const nodeBtn = (n: TopoNode) => (
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700 hover:underline text-left"
                  onClick={e => { e.stopPropagation(); focusNode(n.id); }}
                >
                  {n.name || `Узел ${n.number || n.id}`}
                </button>
              );

              const focusBranch = (id: string) => {
                setSelectedBranchId(id);
                setSelectedBranchIds(new Set([id]));
                setSelectedNodeId(null);
                setFocusBranchId(id);
                setFocusNonce(Date.now());
              };

              const branchLabel = (b: TopoBranch) => {
                const fn = nodeById.get(b.fromId);
                const tn = nodeById.get(b.toId);
                const nm = b.type || `Ветвь ${b.id}`;
                return `${nm} (${fn?.number || fn?.id || "?"}→${tn?.number || tn?.id || "?"})`;
              };

              const branchBtn = (b: TopoBranch) => (
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-700 hover:underline text-left"
                  onClick={e => { e.stopPropagation(); focusBranch(b.id); }}
                >
                  {branchLabel(b)}
                </button>
              );

              const EmptyOk = ({ text }: { text: string }) => (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Icon name="CheckCircle" size={28} className="text-green-500" />
                  <span className="text-[11px] text-gray-500 text-center">{text}</span>
                </div>
              );

              return (
                <div className="flex flex-col h-full overflow-hidden" style={{ fontSize: 11 }}>

                  {/* Шапка */}
                  <div className="px-2 py-1.5 flex items-center gap-1.5" style={{ background: totalIssues > 0 ? "#fff7ed" : "#f0fdf4", borderBottom: "1px solid #e5e7eb" }}>
                    <Icon name={totalIssues > 0 ? "AlertTriangle" : "CheckCircle"} size={13}
                      className={totalIssues > 0 ? "text-amber-500" : "text-green-500"} />
                    <span className="text-[11px] font-semibold text-gray-700">
                      {totalIssues > 0 ? `Найдено нарушений: ${totalIssues}` : "Нарушений не найдено"}
                    </span>
                  </div>

                  {truncated && (
                    <div className="px-2 py-1 text-[10px] flex items-center gap-1"
                      style={{ background: "#fffbeb", color: "#b45309", borderBottom: "1px solid #fde68a" }}>
                      <Icon name="Info" size={11} className="flex-shrink-0" />
                      Показаны первые результаты — устраните их и запустите проверку повторно.
                    </div>
                  )}

                  {/* Навигация — Узлы */}
                  <div className="px-2 pt-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide"
                    style={{ background: "#f3f4f6" }}>Узлы</div>
                  <div className="flex" style={{ background: "#f3f4f6", borderBottom: "1px solid #e5e7eb" }}>
                    {navBtn("near",     "Несоед.", tabCounts.near,     "GitMerge")}
                    {navBtn("isolated", "Тупики",  tabCounts.isolated, "Unlink")}
                    {navBtn("dupes",    "Дубли",   tabCounts.dupes,    "Copy")}
                  </div>

                  {/* Навигация — Ветви */}
                  <div className="px-2 pt-1 text-[9px] font-semibold text-gray-400 uppercase tracking-wide"
                    style={{ background: "#f3f4f6" }}>Ветви</div>
                  <div className="flex" style={{ background: "#f3f4f6", borderBottom: "1px solid #e5e7eb" }}>
                    {navBtn("dupbranch",      "Дубли",   tabCounts.dupbranch,     "CopyPlus")}
                    {navBtn("zeroR",          "R = 0",   tabCounts.zeroR,         "CircleSlash")}
                    {navBtn("zeroLen",        "L = 0",   tabCounts.zeroLen,       "MoveHorizontal")}
                    {navBtn("highR",          "R↑",      tabCounts.highR,         "TrendingUp")}
                    {navBtn("bulkR",          "Перем.",  tabCounts.bulkR,         "DoorClosed")}
                    {navBtn("manualLen",      "L ручн.", tabCounts.manualLen,     "Ruler")}
                    {navBtn("isolatedBranch", "Изолир.", tabCounts.isolatedBranch, "Network")}
                  </div>

                  {/* ── Вкладка: Несоединённые близкие узлы ── */}
                  {checkTab === "near" && (
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <div className="px-2 py-1.5" style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                        <div className="text-[10px] text-gray-500 mb-1">Узлы близки в пространстве (X, Y, Z), но не соединены ветвью.</div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-600 flex-shrink-0">Порог:</span>
                          <input
                            type="number" min={0.01} max={1000} step={0.1}
                            value={checkThreshold}
                            onChange={e => setCheckThreshold(Math.max(0.01, parseFloat(e.target.value) || 1))}
                            className="w-16 text-right border border-gray-300 rounded px-1 bg-white"
                            style={{ fontSize: 11, height: 20 }}
                          />
                          <span className="text-[10px] text-gray-500">м</span>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {nearPairs.length === 0 ? <EmptyOk text="Близких несоединённых узлов не найдено" /> : (
                          <div className="flex flex-col">
                            <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                              Пар: <b className="text-amber-700">{nearPairs.length}</b>
                            </div>
                            {nearPairs.map(({ a, b, dist }) => {
                              const isSel = selectedNodeId === a.id || selectedNodeId === b.id;
                              return (
                                <div key={`${a.id}|${b.id}`}
                                  className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                  style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                  onClick={() => focusNode(a.id)}
                                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                >
                                  <Icon name="AlertTriangle" size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-1 flex-wrap">
                                      {nodeBtn(a)}
                                      <span className="text-gray-300">↔</span>
                                      {nodeBtn(b)}
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      {dist < 0.1 ? dist.toFixed(3) : dist < 1 ? dist.toFixed(2) : dist.toFixed(1)} м
                                      <span className="mx-1">·</span>№{a.number || "—"} и №{b.number || "—"}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Вкладка: Изолированные узлы (тупики) ── */}
                  {checkTab === "isolated" && (
                    <div className="flex-1 overflow-y-auto">
                      {isolated.length === 0 ? <EmptyOk text="Изолированных узлов нет" /> : (
                        <div className="flex flex-col">
                          <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                            Узлов без ветвей: <b className="text-red-600">{isolated.length}</b>
                          </div>
                          {isolated.map(n => {
                            const isSel = selectedNodeId === n.id;
                            return (
                              <div key={n.id}
                                className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer"
                                style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                onClick={() => focusNode(n.id)}
                                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                              >
                                <Icon name="Unlink" size={12} className="text-red-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-800 truncate">{n.name || `Узел ${n.number || n.id}`}</div>
                                  <div className="text-[10px] text-gray-400">№{n.number || "—"} · X={n.x.toFixed(0)} Y={n.y.toFixed(0)}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Вкладка: Дубликаты координат ── */}
                  {checkTab === "dupes" && (
                    <div className="flex-1 overflow-y-auto">
                      {dupes.length === 0 ? <EmptyOk text="Узлов с одинаковыми координатами нет" /> : (
                        <div className="flex flex-col">
                          <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                            Дублей: <b className="text-red-600">{dupes.length}</b>
                          </div>
                          {dupes.map(({ a, b }) => {
                            const isSel = selectedNodeId === a.id || selectedNodeId === b.id;
                            return (
                              <div key={`${a.id}|${b.id}`}
                                className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                onClick={() => focusNode(a.id)}
                                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                              >
                                <Icon name="Copy" size={12} className="text-purple-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-1 flex-wrap">
                                    {nodeBtn(a)}
                                    <span className="text-gray-300">↔</span>
                                    {nodeBtn(b)}
                                  </div>
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    X={a.x.toFixed(2)} Y={a.y.toFixed(2)} Z={a.z.toFixed(2)}
                                    <span className="mx-1">·</span>№{a.number || "—"} и №{b.number || "—"}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Вкладка: Дублирующие ветви ── */}
                  {checkTab === "dupbranch" && (
                    <div className="flex-1 overflow-y-auto">
                      {dupBranches.length === 0 ? <EmptyOk text="Дублирующих ветвей нет" /> : (
                        <div className="flex flex-col">
                          <div className="px-2 py-1 text-[10px] text-gray-500" style={{ background: "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                            Несколько ветвей соединяют одну пару узлов. Групп: <b className="text-amber-700">{dupBranches.length}</b>
                          </div>
                          {dupBranches.map(({ branches: grp, key }) => (
                            <div key={key} className="px-2 py-1.5" style={{ borderBottom: "1px solid #f5f5f5" }}>
                              <div className="flex items-center gap-1.5 mb-1">
                                <Icon name="CopyPlus" size={12} className="text-amber-500 flex-shrink-0" />
                                <span className="text-[10px] text-gray-500">Параллельных ветвей: {grp.length}</span>
                              </div>
                              <div className="flex flex-col gap-0.5 pl-4">
                                {grp.map(b => (
                                  <div key={b.id} className="flex items-center gap-1"
                                    style={{ background: selectedBranchId === b.id ? "#fef3c7" : "transparent" }}>
                                    {branchBtn(b)}
                                    <span className="text-[10px] text-gray-400">· L={b.length.toFixed(0)}м · R={(b.resistance ?? 0).toFixed(3)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Вкладка: Ветви с нулевым сопротивлением ── */}
                  {checkTab === "zeroR" && (
                    <div className="flex-1 overflow-y-auto">
                      {zeroRBranches.length === 0 ? <EmptyOk text="Ветвей с нулевым сопротивлением нет" /> : (
                        <div className="flex flex-col">
                          <div className="px-2 py-1 text-[10px] text-gray-500" style={{ background: "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                            R = 0 приводит к некорректному расчёту. Ветвей: <b className="text-red-600">{zeroRBranches.length}</b>
                          </div>
                          {zeroRBranches.map(b => {
                            const isSel = selectedBranchId === b.id;
                            return (
                              <div key={b.id}
                                className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                onClick={() => focusBranch(b.id)}
                                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                              >
                                <Icon name="CircleSlash" size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  {branchBtn(b)}
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    L={b.length.toFixed(0)}м · S={b.area.toFixed(1)}м² · R={(b.resistance ?? 0).toFixed(4)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Вкладка: Ветви с нулевой длиной ── */}
                  {checkTab === "zeroLen" && (
                    <div className="flex-1 overflow-y-auto">
                      {zeroLenBranches.length === 0 ? <EmptyOk text="Ветвей с длиной = 0 нет" /> : (
                        <div className="flex flex-col">
                          <div className="px-2 py-1 text-[10px] text-gray-500" style={{ background: "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
                            Длина = 0 → нет сопротивления, расчёт воздухораспределения невозможен. Ветвей: <b className="text-red-600">{zeroLenBranches.length}</b>
                          </div>
                          {zeroLenBranches.map(b => {
                            const isSel = selectedBranchId === b.id;
                            const fn = nodes.find(n => n.id === b.fromId);
                            const tn = nodes.find(n => n.id === b.toId);
                            const autoLen = fn && tn ? Math.round(calcBranchLength(fn, tn)) : null;
                            return (
                              <div key={b.id}
                                className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                onClick={() => focusBranch(b.id)}
                                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                              >
                                <Icon name="MoveHorizontal" size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  {branchBtn(b)}
                                  <div className="text-[10px] text-gray-400 mt-0.5">
                                    L=<b className="text-red-600">{b.length.toFixed(0)}</b>м · S={b.area.toFixed(1)}м²
                                    {autoLen != null && autoLen > 0 && (
                                      <> · по коорд.: <b className="text-gray-600">{autoLen}</b>м</>
                                    )}
                                  </div>
                                  {autoLen != null && autoLen > 0 && (
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        updateBranch(b.id, { manualLength: false, length: autoLen });
                                      }}
                                      className="mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border"
                                      style={{ borderColor: "#93c5fd", background: "#eff6ff", color: "#1d4ed8" }}
                                    >
                                      Задать длину по координатам ({autoLen}м)
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Вкладка: Ветви с большим сопротивлением ── */}
                  {checkTab === "highR" && (
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <div className="px-2 py-1.5" style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                        <div className="text-[10px] text-gray-500 mb-1">Сопротивление ветви выше порога — вероятна ошибка в сечении/длине.</div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-600 flex-shrink-0">Порог R:</span>
                          <input
                            type="number" min={0} step={10}
                            value={checkHighRThreshold}
                            onChange={e => setCheckHighRThreshold(Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-20 text-right border border-gray-300 rounded px-1 bg-white"
                            style={{ fontSize: 11, height: 20 }}
                          />
                          <span className="text-[10px] text-gray-500">Н·с²/м⁸</span>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {highRBranches.length === 0 ? <EmptyOk text="Ветвей с большим сопротивлением не найдено" /> : (
                          <div className="flex flex-col">
                            <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                              Ветвей: <b className="text-amber-700">{highRBranches.length}</b>
                            </div>
                            {highRBranches.map(b => {
                              const isSel = selectedBranchId === b.id;
                              return (
                                <div key={b.id}
                                  className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                  style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                  onClick={() => focusBranch(b.id)}
                                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                >
                                  <Icon name="TrendingUp" size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    {branchBtn(b)}
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      R=<b className="text-amber-700">{(b.resistance ?? 0).toFixed(2)}</b> Н·с²/м⁸ · L={b.length.toFixed(0)}м · S={b.area.toFixed(1)}м²
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Вкладка: Перемычки с большим R ── */}
                  {checkTab === "bulkR" && (
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <div className="px-2 py-1.5" style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                        <div className="text-[10px] text-gray-500 mb-1">Сопротивление перемычки выше норматива.</div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-gray-600 flex-shrink-0">Норматив:</span>
                          <input
                            type="number" min={0} step={1}
                            value={checkBulkRThreshold}
                            onChange={e => setCheckBulkRThreshold(Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-20 text-right border border-gray-300 rounded px-1 bg-white"
                            style={{ fontSize: 11, height: 20 }}
                          />
                          <span className="text-[10px] text-gray-500">кМюрг</span>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {bulkBranches.length === 0 ? <EmptyOk text="Перемычек с превышением норматива нет" /> : (
                          <div className="flex flex-col">
                            <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                              Перемычек: <b className="text-red-600">{bulkBranches.length}</b>
                            </div>
                            {bulkBranches.map(({ branch: b, rKmu }) => {
                              const isSel = selectedBranchId === b.id;
                              return (
                                <div key={b.id}
                                  className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                  style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                  onClick={() => focusBranch(b.id)}
                                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                >
                                  <Icon name="DoorClosed" size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    {branchBtn(b)}
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      {b.bulkheadName || "Перемычка"} · R=<b className="text-red-600">{rKmu.toFixed(0)}</b> кМюрг
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Вкладка: Ветви с длиной, заданной вручную ── */}
                  {checkTab === "manualLen" && (
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <div className="px-2 py-1.5" style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                        <div className="text-[10px] text-gray-500 mb-1.5">
                          У этих ветвей длина задана вручную и не пересчитывается из координат.
                          Если она меньше реальной — сопротивление занижено, если больше — завышено.
                        </div>
                        {manualLenBranches.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setBranches(prev => prev.map(b => {
                              if (!b.manualLength) return b;
                              const fn = nodes.find(n => n.id === b.fromId);
                              const tn = nodes.find(n => n.id === b.toId);
                              const len = fn && tn ? Math.round(calcBranchLength(fn, tn)) : b.length;
                              return { ...b, manualLength: false, length: len };
                            }))}
                            className="text-[10px] font-medium px-2 py-1 rounded border"
                            style={{ borderColor: "#93c5fd", background: "#eff6ff", color: "#1d4ed8" }}
                          >
                            Все на авто (из координат)
                          </button>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {manualLenBranches.length === 0 ? <EmptyOk text="Ветвей с ручной длиной нет" /> : (
                          <div className="flex flex-col">
                            <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                              Ветвей: <b className="text-amber-700">{manualLenBranches.length}</b>
                            </div>
                            {manualLenBranches.map(b => {
                              const isSel = selectedBranchId === b.id;
                              const fn = nodes.find(n => n.id === b.fromId);
                              const tn = nodes.find(n => n.id === b.toId);
                              const autoLen = fn && tn ? Math.round(calcBranchLength(fn, tn)) : null;
                              const mismatch = autoLen != null && Math.abs(autoLen - b.length) >= 1;
                              return (
                                <div key={b.id}
                                  className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                  style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                  onClick={() => focusBranch(b.id)}
                                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                >
                                  <Icon name="Ruler" size={12} className={`${mismatch ? "text-red-400" : "text-amber-500"} flex-shrink-0 mt-0.5`} />
                                  <div className="flex-1 min-w-0">
                                    {branchBtn(b)}
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      Ручная: <b>{b.length.toFixed(0)}</b>м
                                      {autoLen != null && (
                                        <> · по коорд.: <b className={mismatch ? "text-red-600" : "text-gray-500"}>{autoLen}</b>м</>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={e => {
                                        e.stopPropagation();
                                        updateBranch(b.id, { manualLength: false, length: autoLen ?? b.length });
                                      }}
                                      className="mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border"
                                      style={{ borderColor: "#93c5fd", background: "#eff6ff", color: "#1d4ed8" }}
                                    >
                                      На авто
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Вкладка: Изолированные ветви (нет выхода на поверхность) ── */}
                  {checkTab === "isolatedBranch" && (
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <div className="px-2 py-1.5" style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                        <div className="text-[10px] text-gray-500 mb-1.5">
                          Ветви построены, но их подсеть не связана с поверхностью —
                          нет ни одного пути к атмосферному узлу (выхода на поверхность).
                          Такие ветви не дают провести расчёт воздухораспределения.
                        </div>
                        {noAtmosphere && (
                          <div className="text-[10px] font-medium px-2 py-1 rounded flex items-start gap-1"
                            style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
                            <Icon name="AlertTriangle" size={12} className="flex-shrink-0 mt-0.5" />
                            В схеме нет ни одного выхода на поверхность (атмосферного узла).
                            Отметьте хотя бы один узел как связанный с атмосферой.
                          </div>
                        )}
                        {isolatedBranches.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedBranchIds(new Set(isolatedBranches.map(b => b.id)));
                              setSelectedNodeId(null);
                              setSelectedBranchId(isolatedBranches[0].id);
                              setFocusBranchId(isolatedBranches[0].id);
                              setFocusNonce(Date.now());
                            }}
                            className="mt-1.5 text-[10px] font-medium px-2 py-1 rounded border"
                            style={{ borderColor: "#fca5a5", background: "#fef2f2", color: "#b91c1c" }}
                          >
                            Выделить все на схеме
                          </button>
                        )}
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        {isolatedBranches.length === 0 ? (
                          <EmptyOk text={noAtmosphere
                            ? "Ветвей нет"
                            : "Изолированных ветвей не найдено — вся сеть связана с поверхностью"} />
                        ) : (
                          <div className="flex flex-col">
                            <div className="px-2 py-1 text-[10px] text-gray-400" style={{ borderBottom: "1px solid #f0f0f0" }}>
                              Ветвей: <b className="text-red-600">{isolatedBranches.length}</b>
                            </div>
                            {isolatedBranches.map(b => {
                              const isSel = selectedBranchId === b.id;
                              return (
                                <div key={b.id}
                                  className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer"
                                  style={{ borderBottom: "1px solid #f5f5f5", background: isSel ? "#fef3c7" : "transparent" }}
                                  onClick={() => focusBranch(b.id)}
                                  onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; }}
                                  onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                                >
                                  <Icon name="Network" size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    {branchBtn(b)}
                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                      Нет связи с поверхностью · L={b.length.toFixed(0)}м · S={b.area.toFixed(1)}м²
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

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

                  {/* ── Масштаб УО ── */}
                  {fireSymId && (() => {
                    const fireSym = schemaSymbols.find(s => s.id === fireSymId.id);
                    const updFireSym = (patch: Record<string, unknown>) =>
                      setSchemaSymbols(prev => prev.map(s => s.id === fireSymId.id ? { ...s, ...patch } : s));
                    const scaleVal = Math.round((fireSym?.scale ?? 1) * 100);
                    return (
                      <div className="flex items-center gap-1 px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Масштаб УО:</span>
                        <input type="range" min={5} max={400} step={5}
                          value={scaleVal}
                          onChange={e => updFireSym({ scale: Number(e.target.value) / 100 })}
                          className="flex-1" style={{ accentColor: "#dc2626" }} />
                        <input type="number" min={5} max={400} step={5}
                          value={scaleVal}
                          onChange={e => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); updFireSym({ scale: v / 100 }); }}
                          className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
                          style={{ fontSize: 11, height: 18 }} />
                        <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
                      </div>
                    );
                  })()}

                  <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                    <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Задаётся:</span>
                    <select value={b.fireMode ?? "heat"} onChange={e => updateBranch(b.id, { fireMode: e.target.value as "heat" | "temp" })}
                      className="flex-1 text-[11px] px-1" style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }}>
                      <option value="heat">Мощностью (МВт)</option>
                      <option value="temp">Температурой (°C)</option>
                    </select>
                  </div>

                  {(b.fireMode ?? "heat") === "heat" && (() => {
                    // Для материалов с авто-расчётом (кабель/дерево/конвейер/техника)
                    // мощность считается из свойств — поле только для чтения.
                    const autoP = calcFirePowerFromMaterial(b);
                    const isAuto = autoP != null && autoP > 0;
                    return (
                      <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                        <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Мощность пожара, МВт:</span>
                        <input type="number" step="0.5" min="0.1" max="100"
                          value={isAuto ? (Math.round(autoP! * 100) / 100) : (b.fireHeatRelease ?? 5)}
                          readOnly={isAuto}
                          onChange={e => { if (!isAuto) updateBranch(b.id, { fireHeatRelease: parseFloat(e.target.value) || 5 }); }}
                          className="flex-1 text-[11px] text-right px-1"
                          style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: isAuto ? "#f3f4f6" : "white", color: isAuto ? "#6b7280" : "inherit" }} />
                        {isAuto && <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">авто</span>}
                      </div>
                    );
                  })()}
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

                  {/* ── Уголь / масло / произвольный: площадь очага и скорость выгорания ── */}
                  {["coal", "oil", "custom"].includes(b.fireCombustible ?? "coal") && (() => {
                    const comb = COMBUSTIBLES.find(c => c.id === (b.fireCombustible ?? "coal"));
                    const psiDefault = comb?.burnRate ?? 0.013;
                    const psi = (b.fireSourceBurnRate ?? 0) > 0 ? b.fireSourceBurnRate! : psiDefault;
                    const area = (b.fireSourceArea ?? 0) > 0 ? b.fireSourceArea! : (comb?.defaultArea ?? 5);
                    return (
                      <>
                        <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Площадь очага, м²:</span>
                          <input type="number" step="0.5" min="0.1" max="1000"
                            value={area}
                            onChange={e => updateBranch(b.id, { fireSourceArea: parseFloat(e.target.value) || 0 })}
                            className="flex-1 text-[11px] text-right px-1"
                            style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                        </div>
                        <div className="flex items-center px-1 py-0.5" style={{ borderBottom: "1px solid #ebebeb" }}>
                          <span className="text-[11px] text-gray-600 flex-shrink-0" style={{ width: 140 }}>Скорость выгор. ψ, кг/(м²·с):</span>
                          <input type="number" step="0.001" min="0" max="1"
                            value={psi}
                            onChange={e => updateBranch(b.id, { fireSourceBurnRate: parseFloat(e.target.value) || 0 })}
                            className="flex-1 text-[11px] text-right px-1"
                            style={{ border: "1px solid #c8c8c8", height: 18, outline: "none", background: "white" }} />
                        </div>
                      </>
                    );
                  })()}

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
            {(["topology","fan","waterpipes","conveyor","fireload","params","bulkhead"].includes(activeSide)) && !selectedNode && selectedBranch && (
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
                bulkheadSymbol={schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === selectedBranch.id)}
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
                onRemoveGate={selectedBranch.wpHasGate ? () => {
                  const sym = schemaSymbols.find(s => s.typeId === "valve_water" && s.branchId === selectedBranch.id);
                  if (sym) removeSymbol(sym.id);
                  updateBranch(selectedBranch.id, { wpHasGate: false, wpGateClosed: false });
                } : undefined}
              />
            )}



            {/* ═══ Панель выделенного условного обозначения ══════════════ */}
            {activeSide === "params" && !selectedNode && !selectedBranch && selectedSymbolId && (() => {
              const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
              if (!sym) return null;
              const isMeasureStationSym = sym.typeId === "measure_station";
              const isBulkheadSym = BULKHEAD_SYMBOL_IDS.has(sym.typeId) && !isMeasureStationSym;
              const isWindowBulkhead = WINDOW_BULKHEAD_IDS.has(sym.typeId);
              const brForSym = sym.branchId ? branches.find(b => b.id === sym.branchId) : null;
              // ΔP перемычки = R_sym × Q × |Q| (не dP всей ветви, а только вклад этого символа)
              const symDeltaP = (() => {
                if (!brForSym) return null;
                const q = brForSym.flow ?? 0;
                const mode = sym.bkResMode ?? "project";
                if (mode === "manual") {
                  // кМюрг = Па·с²/м⁶, коэффициент = 1
                  const r = (sym.bkManualR ?? 0);
                  return r * q * Math.abs(q);
                }
                if (mode === "survey") {
                  const sq = sym.bkSurveyQ ?? 0; const dp = sym.bkSurveyDP ?? 0;
                  const r = sq > 0 ? dp / (sq * sq) : 0;
                  return r * q * Math.abs(q);
                }
                // project
                const sw = sym.bkWindowArea ?? 0;
                const branchArea = brForSym.area ?? 0;
                const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                  || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                if (isFullyOpen) return 0;
                let r = 0;
                if (sw > 0.001) {
                  const fnFrom2 = nodes.find(n => n.id === brForSym.fromId);
                  const fnTo2   = nodes.find(n => n.id === brForSym.toId);
                  const tF2 = fnFrom2 ? (fnFrom2.atmosphereLink ? surfaceTemp : (fnFrom2.airTemp ?? surfaceTemp)) : surfaceTemp;
                  const tT2 = fnTo2   ? (fnTo2.atmosphereLink   ? surfaceTemp : (fnTo2.airTemp   ?? surfaceTemp)) : surfaceTemp;
                  const rho2 = 353.0 / (273.0 + Math.max(-30, Math.min(100, (tF2 + tT2) / 2)));
                  const mu = 0.65;
                  r = rho2 / (2 * mu * mu * sw * sw);
                } else {
                  const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0)
                    : (sym.bkAirPerm
                      ?? (sym.bkBulkheadId ? mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.airPermeability : undefined)
                      ?? brForSym.bulkheadAirPerm ?? 0);
                  const rRefSym = sym.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.rMkyurg ?? 0) : 0;
                  // 1/A² → Мюрг → /1000 → кМюрг; rMkyurg/bkBulkheadR/bulkheadR в кМюрг
                  if (kAir > 0) {
                    r = (1 / (kAir * kAir)) / 1000;
                  } else {
                    r = sym.bkBulkheadR ?? rRefSym ?? brForSym.bulkheadR ?? 0;
                  }
                }
                return r * q * Math.abs(q);
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

                  {/* ── Замерная станция ── */}
                  {isMeasureStationSym && (
                    <>
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Замерная станция
                      </div>

                      {/* Номер */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Номер</span>
                        <input type="text"
                          value={sym.msNumber ?? ""}
                          onChange={(e) => updSym({ msNumber: e.target.value })}
                          placeholder="№"
                          className="flex-1 px-1 py-0.5 text-[11px]"
                          style={{ border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 }} />
                      </div>

                      {/* Местоположение */}
                      <div className="flex items-start gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0 pt-0.5">Местоположение</span>
                        <textarea
                          value={sym.msLocation ?? ""}
                          onChange={(e) => updSym({ msLocation: e.target.value })}
                          rows={2}
                          placeholder="Введите местоположение..."
                          className="flex-1 px-1 py-0.5 text-[11px] resize-none"
                          style={{ border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 }} />
                      </div>

                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-2 uppercase tracking-wide">
                        Параметры воздуха
                      </div>

                      {/* Площадь сечения */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Сечение</span>
                        <input type="number" min={0} step={0.1}
                          value={sym.msArea ?? ""}
                          onChange={(e) => updSym({ msArea: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="0.0"
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 }} />
                        <span className="text-gray-400 flex-shrink-0">м²</span>
                      </div>

                      {/* Расход воздуха */}
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className="text-gray-500 w-24 flex-shrink-0">Расход</span>
                        <input type="number" min={0} step={0.1}
                          value={sym.msFlow ?? ""}
                          onChange={(e) => updSym({ msFlow: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="0.0"
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 }} />
                        <span className="text-gray-400 flex-shrink-0">м³/с</span>
                      </div>

                      {/* Скорость воздуха */}
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-gray-500 w-24 flex-shrink-0">Скорость</span>
                        <input type="number" min={0} step={0.1}
                          value={sym.msVelocity ?? ""}
                          onChange={(e) => updSym({ msVelocity: e.target.value === "" ? undefined : Number(e.target.value) })}
                          placeholder="0.0"
                          className="flex-1 px-1 py-0.5 text-[11px] text-right"
                          style={{ border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 }} />
                        <span className="text-gray-400 flex-shrink-0">м/с</span>
                      </div>

                      {/* Вычисленные значения из расчёта сети */}
                      {brForSym && (brForSym.flow != null || brForSym.velocity != null) && (
                        <div className="text-[10px] text-gray-400 bg-gray-50 rounded p-1.5 mt-1">
                          <div className="font-semibold text-gray-500 mb-0.5">Из расчёта сети:</div>
                          {brForSym.flow != null && (
                            <div>Расход: <span className="text-gray-600">{Math.abs(brForSym.flow).toFixed(2)} м³/с</span></div>
                          )}
                          {brForSym.velocity != null && (
                            <div>Скорость: <span className="text-gray-600">{Math.abs(brForSym.velocity).toFixed(2)} м/с</span></div>
                          )}
                          {brForSym.area != null && brForSym.area > 0 && (
                            <div>Сечение ветви: <span className="text-gray-600">{brForSym.area.toFixed(2)} м²</span></div>
                          )}
                        </div>
                      )}

                      {/* Отображаемые индикаторы */}
                      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 mt-3 uppercase tracking-wide">
                        Отображаемые индикаторы
                      </div>
                      {[
                        { key: "msIndNumber"   as const, label: "Номер замерной станции" },
                        { key: "msIndLocation" as const, label: "Местоположение" },
                        { key: "msIndFlow"     as const, label: "Расход воздуха" },
                        { key: "msIndArea"     as const, label: "Площадь сечения" },
                        { key: "msIndVelocity" as const, label: "Скорость воздуха" },
                      ].map(({ key, label }) => (
                        <label key={key} className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                          <input type="checkbox"
                            checked={!!sym[key]}
                            onChange={(e) => updSym({ [key]: e.target.checked })}
                            style={{ width: 13, height: 13, accentColor: "#2563eb" }} />
                          <span className="text-gray-700">{label}</span>
                        </label>
                      ))}

                      {/* Настройки индикаторов (если хоть один включён) */}
                      {(sym.msIndNumber || sym.msIndLocation || sym.msIndFlow || sym.msIndArea || sym.msIndVelocity) && (
                        <div className="mt-2">
                          <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide">
                            Настройки
                          </div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <span className="text-gray-500 w-20 flex-shrink-0">Размер</span>
                            <input type="number" min={1} max={50} step={0.5}
                              value={sym.msIndFontSize ?? 9}
                              onChange={(e) => updSym({ msIndFontSize: Math.max(1, Math.min(50, Number(e.target.value) || 9)) })}
                              className="w-16 border border-gray-300 rounded px-1 text-right"
                              style={{ fontSize: 11 }} />
                            <span className="text-gray-400">м</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}

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
                            // Все R в кМюрг = Па·с²/м⁶ (коэффициент = 1)
                            let rKmu = 0;
                            if (mode === "manual") {
                              rKmu = sym.bkManualR ?? 0; // кМюрг
                            } else if (mode === "survey") {
                              // ΔP/Q² = Па/(м³/с)² = Па·с²/м⁶ = кМюрг
                              const q = sym.bkSurveyQ ?? 0;
                              const dp = sym.bkSurveyDP ?? 0;
                              rKmu = q > 0 ? dp / (q * q) : 0;
                            } else {
                              const sw = sym.bkWindowArea ?? 0;
                              const branchArea = brForSym?.area ?? 0;
                              const isFullyOpen = (OPEN_DOOR_IDS.has(sym.typeId) && sw <= 0.001)
                                || (sw > 0.001 && branchArea > 0 && sw >= branchArea * 0.999);
                              if (isFullyOpen) {
                                rKmu = 0;
                              } else if (sw > 0.001) {
                                // ρ/(2μ²S²) = кМюрг (Па·с²/м⁶)
                                const mu = 0.65;
                                rKmu = rho / (2 * mu * mu * sw * sw);
                              } else {
                                const kAir = sym.bkManualAirPerm ? (sym.bkCustomAirPerm ?? 0)
                                  : (sym.bkAirPerm
                                    ?? (sym.bkBulkheadId ? mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.airPermeability : undefined)
                                    ?? brForSym?.bulkheadAirPerm ?? 0);
                                const rRefKmu = sym.bkBulkheadId ? (mineBulkheads.find(mb => mb.id === sym.bkBulkheadId)?.rMkyurg ?? 0) : 0;
                                // 1/A² → Мюрг → /1000 → кМюрг; rMkyurg/bkBulkheadR/bulkheadR в кМюрг
                                rKmu = kAir > 0 ? (1 / (kAir * kAir)) / 1000 : (sym.bkBulkheadR ?? rRefKmu ?? brForSym?.bulkheadR ?? 0);
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

                  {/* ── Давление разрушения (только для перемычек с ветвью) ── */}
                  {isBulkheadSym && brForSym && !isWindowBulkhead && (() => {
                    const fp = sym.bkFailurePressure
                      ?? (sym.bkBulkheadId ? mineBulkheads.find(b => b.id === sym.bkBulkheadId)?.failurePressure : undefined)
                      ?? brForSym?.bulkheadFailurePressure;
                    return fp != null && fp > 0 ? (
                      <div className="flex items-center gap-1 mb-1" style={{ borderBottom: "1px solid #ebebeb", paddingBottom: 4 }}>
                        <span className="text-gray-500 flex-shrink-0" style={{ width: 120 }}>Р разр.:</span>
                        <span className="flex-1 text-right text-[11px]" style={{ color: "#b91c1c" }}>
                          {fp} МПа
                        </span>
                      </div>
                    ) : null;
                  })()}

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

                  {/* ── Насос ── */}
                  {sym.typeId === "pump" && (
                    <PumpPanel
                      sym={sym}
                      userPumps={userPumps}
                      onUpdate={updSym}
                      onAddUserPump={(pump) => setUserPumps((prev) => [...prev, pump])}
                      waterBranchResult={sym.branchId ? waterNetwork.branchResults.get(sym.branchId) : undefined}
                    />
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
                      const isHovered = hoveredHorizonId === h.id;
                      return (
                        <div key={h.id}
                          draggable
                          onDragStart={() => handleHorizonDragStart(hIdx)}
                          onDragOver={(e) => handleHorizonDragOver(e, hIdx)}
                          onDrop={() => handleHorizonDrop(hIdx)}
                          onDragEnd={() => { setHorizonDragIdx(null); setHorizonDragOverIdx(null); }}
                          onMouseEnter={() => setHoveredHorizonId(h.id)}
                          onMouseLeave={() => setHoveredHorizonId(prev => prev === h.id ? null : prev)}
                          className="border rounded"
                          style={{
                            background: isHovered ? "#fffbeb" : isActive ? "#eff6ff" : "white",
                            borderColor: isDragOver ? "#2563eb" : isHovered ? "#f59e0b" : isActive ? "#3b82f6" : "#d1d5db",
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
                              <button onClick={() => moveHorizonToFront(h.id)}
                                disabled={hIdx === 0}
                                className="w-5 h-5 flex items-center justify-center hover:bg-blue-100 rounded flex-shrink-0 disabled:opacity-30"
                                title="На передний план (поверх всех)">
                                <Icon name="ChevronsUp" size={12} className="text-gray-600" />
                              </button>
                            )}
                            {!isOverview && (
                              <button onClick={() => moveHorizonToBack(h.id)}
                                disabled={hIdx === horizons.length - 1}
                                className="w-5 h-5 flex items-center justify-center hover:bg-blue-100 rounded flex-shrink-0 disabled:opacity-30"
                                title="На задний план (под всеми)">
                                <Icon name="ChevronsDown" size={12} className="text-gray-600" />
                              </button>
                            )}
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
                                  <button
                                    title="Разместить план в центре схемы"
                                    onClick={() => {
                                      const curNodes = nodesRef.current;
                                      if (!h.image) return;
                                      const imgW = 1, imgH = 1; // пропорции из bounds
                                      const bw = Math.abs(h.image.bounds.x2 - h.image.bounds.x1);
                                      const bh = Math.abs(h.image.bounds.y2 - h.image.bounds.y1);
                                      const aspect = bw > 0 && bh > 0 ? bw / bh : 1;
                                      void imgW; void imgH;
                                      let cx = 0, cy = 0, halfH2 = 1000;
                                      if (curNodes.length > 0) {
                                        const xs = curNodes.map(n => n.x);
                                        const ys = curNodes.map(n => n.y);
                                        cx = (Math.min(...xs) + Math.max(...xs)) / 2;
                                        cy = (Math.min(...ys) + Math.max(...ys)) / 2;
                                        const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 1000);
                                        const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 1000);
                                        halfH2 = Math.max(spanX, spanY) * 0.75;
                                      }
                                      const halfW2 = halfH2 * aspect;
                                      setHorizonImageBounds(h.id, {
                                        x1: cx - halfW2, y1: cy - halfH2,
                                        x2: cx + halfW2, y2: cy + halfH2,
                                      });
                                      setEditingHorizonImageId(h.id);
                                    }}
                                    className="px-2 py-1 text-[11px] border border-blue-300 text-blue-700 rounded hover:bg-blue-50">
                                    ⌖
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
              // ВАЖНО: IndRow/IndSection — обычные функции, а НЕ вложенные компоненты.
              // Если объявить их как компоненты внутри render, React пересоздаёт их тип
              // на каждом рендере и ремонтирует <input>, из-за чего в canvas-режиме
              // (частые перерисовки схемы) клик по чекбоксу «теряется» и не срабатывает.
              const indRow = (k: string, label: string) => (
                <label key={k} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-blue-50 px-1 rounded">
                  <input type="checkbox" checked={ind[k] ?? false}
                    onChange={e => setInd(k, e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#2563eb", cursor: "pointer" }} />
                  <span className="text-[11px] text-gray-700">{label}</span>
                </label>
              );
              const indSection = (title: string, rows: React.ReactNode) => (
                <div className="mb-2" key={title}>
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-1 py-1 mt-1"
                    style={{ borderBottom: "1px solid #e5e7eb" }}>{title}</div>
                  <div className="pt-0.5">{rows}</div>
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

                  {indSection("Общее", [
                    indRow("branchName", "Название"),
                    indRow("branchNumber", "Номер"),
                  ])}

                  {indSection("Вентиляция", [
                    indRow("branchVelocity", "Макс. допустимая скорость воздуха"),
                    indRow("branchAlpha", "Коэффициент шероховатости (α)"),
                    indRow("branchLocalXi", "Мин. допустимая скорость воздуха"),
                    indRow("branchResistance", "Аэродинамическое сопротивление"),
                    indRow("branchAngle", "Уклон"),
                    indRow("branchFlow", "Фактический расход воздуха"),
                    indRow("branchDepression", "Фактический перепад давления"),
                    indRow("branchLength", "Длина"),
                    indRow("branchHeight", "Объём"),
                    indRow("branchSection", "Поперечное сечение"),
                    indRow("branchFlowCalc", "Расход воздуха"),
                    indRow("branchVelocityModel", "Скорость воздуха"),
                    indRow("branchDepressionModel", "Перепад давления"),
                    indRow("branchExtraFan", "Энергозатраты на единицу длины"),
                    indRow("branchResistanceSum", "Финзатраты на единицу длины"),
                    indRow("branchNatDragC", "Гарантированный расход воздуха"),
                  ])}

                  {indSection("Авария", [
                    indRow("branchMethane", "Концентрация метана"),
                    indRow("branchCOEmission", "Концентрация угарного газа"),
                    indRow("branchGasEmission", "Концентрация водорода"),
                    indRow("branchGasSpreadTime", "Концентрация оксидов азота"),
                    indRow("branchNatDragT", "Тепловая критическая депрессия"),
                    indRow("branchNatDragW", "Тепловая депрессия пожара"),
                  ])}
                </div>
              );
            })()}

            {/* ═══ ВКЛАДКА: ИНДИКАТОРЫ ВЕНТИЛЯТОРА ══════════════════════ */}
            {activeSide === "fan-indicators" && (() => {
              if (!selectedBranch?.hasFan) return (
                <div className="p-4 text-center text-gray-400 text-xs">Нет вентилятора на ветви</div>
              );
              const ind = selectedBranch.indicators ?? {};
              const setInd = (key: string, val: boolean) =>
                updateBranch(selectedBranch.id, { indicators: { ...ind, [key]: val } });
              // См. комментарий во вкладке «Индикаторы»: функции, а не компоненты,
              // иначе в canvas-режиме клики по чекбоксам теряются.
              const indRow = (k: string, label: string) => (
                <label key={k} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-blue-50 px-1 rounded">
                  <input type="checkbox" checked={ind[k] ?? false}
                    onChange={e => setInd(k, e.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "#2563eb", cursor: "pointer" }} />
                  <span className="text-[11px] text-gray-700">{label}</span>
                </label>
              );
              const indSection = (title: string, rows: React.ReactNode) => (
                <div className="mb-2" key={title}>
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide px-1 py-1 mt-1"
                    style={{ borderBottom: "1px solid #e5e7eb" }}>{title}</div>
                  <div className="pt-0.5">{rows}</div>
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
                  {indSection("Расход воздуха", [
                    indRow("branchFlowCalc", "Расход воздуха на вентиляторе"),
                    indRow("branchFlow", "Фактический расход воздуха"),
                  ])}
                  {indSection("Напор и мощность", [
                    indRow("fanPressure", "Напор вентилятора"),
                    indRow("fanShaftPower", "Мощность вентилятора"),
                    indRow("fanEfficiency", "КПД вентилятора"),
                  ])}
                  {indSection("Описание", [
                    indRow("branchName", "Описание объекта"),
                  ])}
                </div>
              );
            })()}

            {/* ═══ ВКЛАДКА: УЧАСТКИ ═════════════════════════════════════ */}
            {activeSide === "areas" && selectedBranch && (() => {
              const b = selectedBranch;
              const SH = "#f0f4ff"; const SB = "1px solid #c7d7f0";
              return (
                <div className="flex flex-col h-full overflow-y-auto" style={{ fontSize: 11 }}>
                  {/* ── Воздушный поток ── */}
                  <div className="px-1 py-0.5 text-[10px] font-semibold select-none"
                    style={{ background: SH, borderBottom: SB, color: "#1d3a6b" }}>
                    Воздушный поток
                  </div>
                  {/* Галочка: Загрязняет воздух */}
                  <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none hover:bg-blue-50 transition-colors"
                    style={{ borderBottom: "1px solid #ebebeb" }}>
                    <input
                      type="checkbox"
                      checked={b.pollutesAir ?? false}
                      onChange={e => updateBranch(b.id, { pollutesAir: e.target.checked })}
                      className="w-3.5 h-3.5 rounded"
                      style={{ accentColor: "#2563eb" }}
                    />
                    <span className="text-[11px] text-gray-700 leading-tight">Загрязняет воздух</span>
                  </label>
                  {/* Подсказка */}
                  {(b.pollutesAir ?? false) && (
                    <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px] leading-snug"
                      style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af" }}>
                      Стрелки направления воздуха в ветвях ниже по потоку от этой ветви
                      будут отображаться синим цветом.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ═══ ОСТАЛЬНЫЕ ВКЛАДКИ ═════════════════════════════════════ */}
            {(activeSide === "thermo"
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

            {/* ═══ СРАВНЕНИЕ СХЕМ ══════════════════════════════════════ */}
            {activeSide === "compare" && (() => {
              const allDiffs = [
                ...((compareResult?.branches ?? []).filter(b => b.status !== "unchanged")),
              ];
              const filtered = compareFilter === "all" ? allDiffs : allDiffs.filter(b => b.status === compareFilter);
              const added   = compareResult?.branches.filter(b => b.status === "added").length ?? 0;
              const removed = compareResult?.branches.filter(b => b.status === "removed").length ?? 0;
              const changed = compareResult?.branches.filter(b => b.status === "changed").length ?? 0;
              const statusColor = (s: CompareStatus) => s === "added" ? "#16a34a" : s === "removed" ? "#dc2626" : "#d97706";
              const statusLabel = (s: CompareStatus) => s === "added" ? "Добавлена" : s === "removed" ? "Удалена" : "Изменена";
              const statusBg   = (s: CompareStatus) => s === "added" ? "#f0fdf4" : s === "removed" ? "#fef2f2" : "#fffbeb";
              return (
                <div className="flex flex-col h-full">
                  {/* Шапка */}
                  <div className="px-2 py-1.5 border-b border-gray-200 flex-shrink-0"
                    style={{ background: "linear-gradient(180deg,#eff6ff,#dbeafe)" }}>
                    <div className="text-[11px] font-semibold text-blue-800">↔ Сравнение схем</div>
                    {compareResult ? (
                      <div className="text-[10px] text-blue-600 mt-0.5 truncate" title={compareResult.fileName}>
                        с: {compareResult.fileName}
                      </div>
                    ) : (
                      <div className="text-[10px] text-gray-400 mt-0.5">Файл не выбран</div>
                    )}
                  </div>

                  {!compareResult ? (
                    <div className="flex flex-col items-center justify-center flex-1 gap-3 px-4">
                      <Icon name="GitCompare" size={32} style={{ color: "#93c5fd" }} />
                      <div className="text-[11px] text-center text-gray-500">
                        Загрузите предыдущую версию схемы для сравнения
                      </div>
                      <button
                        onClick={() => setCompareShowDialog(true)}
                        className="px-3 py-1.5 rounded text-[11px] font-medium text-white"
                        style={{ background: "#2563eb" }}>
                        Выбрать файл...
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Счётчики */}
                      <div className="flex gap-1 px-2 py-1.5 flex-shrink-0 border-b border-gray-100">
                        {[
                          { key: "all",     label: `Все (${allDiffs.length})`,     color: "#374151", bg: "#f3f4f6" },
                          { key: "changed", label: `Изм. (${changed})`,            color: "#d97706", bg: "#fffbeb" },
                          { key: "added",   label: `Доб. (${added})`,              color: "#16a34a", bg: "#f0fdf4" },
                          { key: "removed", label: `Уд. (${removed})`,             color: "#dc2626", bg: "#fef2f2" },
                        ].map(f => (
                          <button key={f.key}
                            onClick={() => setCompareFilter(f.key as typeof compareFilter)}
                            className="flex-1 px-1 py-0.5 rounded text-[9px] font-medium border transition-all"
                            style={{
                              background: compareFilter === f.key ? f.bg : "white",
                              color: f.color,
                              borderColor: compareFilter === f.key ? f.color : "#e5e7eb",
                              fontWeight: compareFilter === f.key ? 700 : 500,
                            }}>
                            {f.label}
                          </button>
                        ))}
                      </div>

                      {/* Список */}
                      <div className="flex-1 overflow-y-auto">
                        {filtered.length === 0 ? (
                          <div className="p-4 text-center text-[11px] text-gray-400">Нет объектов</div>
                        ) : (
                          filtered.map(diff => (
                            <div key={diff.id}
                              className="border-b border-gray-100 cursor-pointer"
                              style={{ background: compareSelectedId === diff.id ? statusBg(diff.status) : "white" }}
                              onClick={() => {
                                setCompareSelectedId(diff.id === compareSelectedId ? null : diff.id);
                                // Центрируем камеру на ветви если она есть в текущей схеме
                                const br = branches.find(b => b.id === diff.id);
                                if (br) { setFocusBranchId(diff.id); setFocusNonce(n => n + 1); setSelectedBranchId(diff.id); }
                              }}>
                              {/* Строка ветви */}
                              <div className="flex items-center gap-1.5 px-2 py-1.5">
                                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                  style={{ background: statusColor(diff.status) }} />
                                <span className="text-[10px] font-medium flex-1 truncate" style={{ color: "#1f2937" }}>
                                  {diff.name || diff.id}
                                </span>
                                <span className="text-[9px] px-1 rounded flex-shrink-0"
                                  style={{ background: statusBg(diff.status), color: statusColor(diff.status), border: `1px solid ${statusColor(diff.status)}40` }}>
                                  {statusLabel(diff.status)}
                                </span>
                              </div>
                              {/* Изменения — раскрываются при выборе */}
                              {compareSelectedId === diff.id && diff.changes && diff.changes.length > 0 && (
                                <div className="mx-2 mb-1.5 rounded overflow-hidden border border-amber-200"
                                  style={{ background: "#fffbeb" }}>
                                  <div className="px-2 py-0.5 text-[9px] font-semibold text-amber-700"
                                    style={{ background: "#fef3c7", borderBottom: "1px solid #fde68a" }}>
                                    Изменённые поля
                                  </div>
                                  {diff.changes.map(ch => (
                                    <div key={ch.field} className="px-2 py-0.5 border-b border-amber-100 last:border-0">
                                      <div className="text-[9px] text-gray-500 font-medium">{ch.label}</div>
                                      <div className="flex items-center gap-1 text-[9px]">
                                        <span className="line-through text-red-500">{ch.oldVal}</span>
                                        <span className="text-gray-400">→</span>
                                        <span className="font-semibold text-green-700">{ch.newVal}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>

                      {/* Нижняя кнопка сброса */}
                      <div className="px-2 py-1.5 border-t border-gray-200 flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => setCompareShowDialog(true)}
                          className="flex-1 py-1 rounded text-[10px] font-medium border"
                          style={{ background: "white", color: "#374151", borderColor: "#d1d5db" }}>
                          Сменить файл
                        </button>
                        <button
                          onClick={() => { setCompareResult(null); setCompareSelectedId(null); }}
                          className="flex-1 py-1 rounded text-[10px] font-medium"
                          style={{ background: "#fee2e2", color: "#dc2626" }}>
                          Сбросить
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

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
                onWaypointsChange={setRescueWaypointIds}
              />
            )}

            {/* ═══ ВРЕМЯ ХОДА ГОРНОРАБОЧЕГО ════════════════════════════ */}
            {activeSide === "workerPath" && (
              <WorkerPathPanel
                nodes={nodes}
                branches={branches.map(b => {
                  // Как у горноспасателей: если bulkheadId не задан на ветви —
                  // берём typeId символа перемычки на этой ветви, иначе ветвь
                  // ошибочно считается глухой непроходимой перемычкой и выпадает
                  // из графа (маршрут «не найден»).
                  if (!b.hasBulkhead || b.bulkheadId) return b;
                  const sym = schemaSymbols.find(s => BULKHEAD_SYMBOL_IDS.has(s.typeId) && s.branchId === b.id);
                  return sym ? { ...b, bulkheadId: sym.typeId, bulkheadName: sym.typeId } : b;
                })}
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
                onWaypointsChange={setWorkerWaypointIds}
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
          <div className="h-8 flex items-center gap-1 px-2 overflow-x-auto overflow-y-hidden [&>*]:shrink-0 cad-toolbar-scroll"
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
            style={{ cursor: leaderDrawMode || tool === "textblock" ? "crosshair" : undefined }}
            onMouseMove={(e) => {
              const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
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
                const _xyS = xyScale ?? 1;
                for (const b of branches) {
                  const fromN = nodes.find(n => n.id === b.fromId);
                  const toN   = nodes.find(n => n.id === b.toId);
                  if (!fromN || !toN) continue;
                  const f = project3D({ x: fromN.x * _xyS, y: fromN.y * _xyS, z: fromN.z * (zScale ?? 1) },
                    { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation });
                  const t2 = project3D({ x: toN.x * _xyS, y: toN.y * _xyS, z: toN.z * (zScale ?? 1) },
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
                const pz = (dragPos?.z ?? 0) * (zScale ?? 1);
                const xy = xyScale ?? 1;
                // Компенсируем «фиксированный масштаб» выноски: на экране конец выноски
                // отрисован в зажатом масштабе (clampRatio), поэтому курсор нужно
                // вернуть в реальные мировые координаты вокруг центра маркера.
                let dsx = sx, dsy = sy;
                if (scaleLimitsEnabled && dragPos) {
                  const _xySFPosD = Math.max(1, xy);
                  const _rawPosSFD = vs.scale / (_xySFPosD * 0.4);
                  const posSFD = Math.min(scalePositionMax / 100, Math.max(scalePositionMin / 100, _rawPosSFD));
                  const clampRatio = _rawPosSFD > 0 ? posSFD / _rawPosSFD : 1;
                  if (clampRatio !== 0 && clampRatio !== 1) {
                    const pm = project3D(
                      { x: dragPos.x * xy, y: dragPos.y * xy, z: (dragPos.z ?? 0) * (zScale ?? 1) },
                      { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation }
                    );
                    dsx = pm.sx + (sx - pm.sx) / clampRatio;
                    dsy = pm.sy + (sy - pm.sy) / clampRatio;
                  }
                }
                const w = unprojectToPlane(dsx, dsy, vs, { axis: "z", value: pz });
                if (!w) return;
                setPositions(prev => prev.map(p =>
                  p.id === leaderDragRef.current!.posId
                    ? { ...p, leaderEndX: xy !== 1 ? w.x / xy : w.x, leaderEndY: xy !== 1 ? w.y / xy : w.y }
                    : p
                ));
                return;
              }
              // Drag текстового блока
              if (textDragRef.current) {
                const { id, startSx, startSy, startWx, startWy } = textDragRef.current;
                if (Math.hypot(sx - startSx, sy - startSy) < 4) return;
                const wStart = unprojectToPlane(startSx, startSy, vs, { axis: "z", value: 0 });
                const wCur   = unprojectToPlane(sx, sy, vs, { axis: "z", value: 0 });
                if (!wStart || !wCur) return;
                const xy = xyScale ?? 1;
                const dx = xy !== 1 ? (wCur.x - wStart.x) / xy : wCur.x - wStart.x;
                const dy = xy !== 1 ? (wCur.y - wStart.y) / xy : wCur.y - wStart.y;
                setTextBlocks(prev => prev.map(t => t.id === id ? { ...t, x: startWx + dx, y: startWy + dy } : t));
                return;
              }
              // Drag маркера позиции — только если мышь реально сдвинулась (порог 4px)
              if (!posDragRef.current) return;
              const { id, startSx, startSy, startWx, startWy } = posDragRef.current;
              if (Math.hypot(sx - startSx, sy - startSy) < 4) return;
              const dragPos = positions.find(p => p.id === id);
              const pz = (dragPos?.z ?? 0) * (zScale ?? 1);
              const wStart = unprojectToPlane(startSx, startSy, vs, { axis: "z", value: pz });
              const wCur   = unprojectToPlane(sx, sy, vs, { axis: "z", value: pz });
              if (!wStart || !wCur) return;
              const xy = xyScale ?? 1;
              const dx = xy !== 1 ? (wCur.x - wStart.x) / xy : wCur.x - wStart.x;
              const dy = xy !== 1 ? (wCur.y - wStart.y) / xy : wCur.y - wStart.y;
              setPositions(prev => prev.map(p => p.id === id ? { ...p, x: startWx + dx, y: startWy + dy, placed: true } : p));
            }}
            onClick={(e) => {
              // Режим текстового блока — создаём блок в точке клика
              if (tool === "textblock") {
                const vs2 = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                const rect = e.currentTarget.getBoundingClientRect();
                const sx2 = e.clientX - rect.left;
                const sy2 = e.clientY - rect.top;
                const w = unprojectToPlane(sx2, sy2, vs2, { axis: "z", value: 0 });
                if (w) {
                  const xy = xyScale ?? 1;
                  const nb = makeTextBlock({ x: xy !== 1 ? w.x / xy : w.x, y: xy !== 1 ? w.y / xy : w.y });
                  pushHistory();
                  setTextBlocks(prev => [...prev, nb]);
                  setSelectedTextBlockId(nb.id);
                  setEditingTextBlockId(nb.id);
                  setTool("select");
                }
                return;
              }
              // Клик на пустое место — снять выбор позиции и текстового блока
              if (!leaderDrawMode) {
                if (posBranchBindMode) return;
                setSelectedPositionId(null);
                setSelectedTextBlockId(null);
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
                const vs2 = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                const rect = e.currentTarget.getBoundingClientRect();
                const sx2 = e.clientX - rect.left;
                const sy2 = e.clientY - rect.top;
                const drawPos = positions.find(p => p.id === leaderDrawMode);
                // Если z позиции = 0 и есть узлы — берём z ближайшего узла чтобы не улететь при больших координатах
                let pz = drawPos?.z ?? 0;
                if (pz === 0 && nodes.length > 0) {
                  pz = nodes[0].z;
                }
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
              textDragRef.current = null; setDraggingTextId(null);
            }}
            onMouseLeave={() => {
              posDragRef.current = null; setDraggingPosId(null);
              leaderDragRef.current = null; setDraggingLeaderPosId(null);
              textDragRef.current = null; setDraggingTextId(null);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              if (!file.name.endsWith(".vproj") && !file.name.endsWith(".json")) {
                alert("Поддерживаются только файлы .vproj");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                try {
                  const data = JSON.parse(reader.result as string);
                  if (!data.nodes || !Array.isArray(data.nodes)) {
                    alert("Файл не является проектом Вентиляция-CAD.");
                    return;
                  }
                  if ((nodes.length > 0 || branchesRaw.length > 0) &&
                      !window.confirm("Открыть проект? Текущие данные будут заменены.")) return;
                  applyProjectData(data, file.name);
                } catch {
                  alert("Ошибка чтения файла.");
                }
              };
              reader.readAsText(file);
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
              highlightHorizonId={hoveredHorizonId}
              branchWidth={branchWidth}
              branchBorder={branchBorder}
              thinLines={thinLines}
              fixedObjectScale={scaleLimitsEnabled}
              canvasThreshold={canvasThreshold}
              scaleLimits={scaleLimitsEnabled ? {
                textMin: scaleTextMin, textMax: scaleTextMax,
                branchMin: scaleBranchMin, branchMax: scaleBranchMax,
              } : undefined}
              bulkheadScale={bulkheadScale}
              fanScale={fanScale}
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
              onViewStateChange={handleViewStateChange}
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
                // Одиночный клик: устанавливаем как основную выделенную ветвь
                // и делаем её единственной в мультиселекте (не сбрасываем весь Set,
                // а заменяем на Set из одной ветви — это позволяет Ctrl+клик накапливать дальше)
                setSelectedBranchId(id);
                setSelectedBranchIds(id ? new Set([id]) : new Set());
                setSelectedSymbolId(null); setSelectedSymbolIds(new Set());
                if (id) { setSelectedNodeId(null); setFanSymbolBranchId(null); setActiveSide("general"); }
              }}
              onNodeContextMenu={(id, x, y) => { setSelectedNodeId(id); setSelectedBranchId(null); setCtxMenu({ kind: "node", id, x, y }); }}
              onBranchContextMenu={(id, x, y) => {
                // Правый клик: если ветвь уже в мультиселекте — не трогаем Set,
                // иначе начинаем новый мультиселект с этой ветви
                setSelectedBranchId(id);
                setSelectedNodeId(null);
                setSelectedBranchIds(prev => prev.has(id) ? prev : new Set([id]));
                setCtxMenu({ kind: "branch", id, x, y });
              }}
              selectedBranchIds={selectedBranchIds}
              onBranchMultiSelect={handleBranchMultiSelect}
              selectedNodeIds={selectedNodeIds}
              onNodeMultiSelect={handleNodeMultiSelect}
              infoConfig={infoConfig}
              unitsConfig={unitsConfig}
              waterNodeResults={waterNetwork.nodeResults}
              waterBranchResults={waterNetwork.branchResults}
              zScale={zScale}
              xyScale={xyScale}
              schemaSymbols={schemaSymbols}
              selectedSymbolId={selectedSymbolId}
              selectedSymbolIds={selectedSymbolIds}
              onSelectSymbol={(id) => { setSelectedSymbolId(id); setSelectedSymbolIds(new Set()); if (id) setActiveSide("params"); }}
              onSymbolMultiSelect={(id) => {
                setSelectedSymbolIds(prev => {
                  const next = new Set(prev);
                  // Если Set пуст и есть одиночно выбранный символ — включаем его тоже
                  if (next.size === 0 && selectedSymbolId && selectedSymbolId !== id) {
                    next.add(selectedSymbolId);
                  }
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
              onSymbolMsIndOffset={(id, ox, oy) => setSchemaSymbols(prev => prev.map(s => s.id === id ? { ...s, msIndOffsetX: ox, msIndOffsetY: oy } : s))}
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
                // Сброс запорного вентиля при удалении символа
                if (sym?.typeId === "valve_water" && sym.branchId) {
                  updateBranch(sym.branchId, { wpHasGate: false, wpGateClosed: false }, false);
                }
                removeSymbol(id);
                setSelectedSymbolId(null);
                setSelectedSymbolIds(new Set());
              }}
              onSymbolClick={(symId) => {
                // Одиночный клик: выбрать УО и показать свойства (панель params)
                const sym = schemaSymbols.find(s => s.id === symId);
                setSelectedSymbolId(symId);
                // Одиночный клик по вентилятору — сразу открываем вкладку настроек
                // вентилятора в левой панели (а не свойства ветви).
                if (sym?.typeId === "fan" && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(sym.branchId);
                  setActiveSide("fan");
                  return;
                }
                // Одиночный клик по запорному вентилю (водопровод) —
                // открываем вкладку "Трубы: вода" с его настройками.
                if ((sym?.typeId === "valve_water" || (sym && REDUCER_SYMBOL_IDS.has(sym.typeId))) && sym.branchId) {
                  setSelectedBranchId(sym.branchId);
                  setSelectedNodeId(null);
                  setFanSymbolBranchId(null);
                  setActiveSide("waterpipes");
                  return;
                }
                // Для перемычек, замерных станций и насосов — НЕ выбираем ветвь,
                // чтобы открылась панель символа (а не свойства ветви).
                if (sym?.branchId && sym.typeId !== "pump" && !BULKHEAD_SYMBOL_IDS.has(sym.typeId) && sym.typeId !== "measure_station") {
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
                } else if ((sym?.typeId === "valve_water" || (sym && REDUCER_SYMBOL_IDS.has(sym.typeId))) && sym.branchId) {
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
              onPositionPlace={(wx, wy, wz) => {
                const sel = selectedPositionId ? positions.find(p => p.id === selectedPositionId) : null;
                if (!sel) return;
                setPositions(prev => prev.map(p => p.id === sel.id ? { ...p, x: wx, y: wy, z: wz, placed: true } : p));
                setPositionPlaceMode(false);
              }}
              branchFireColors={(() => {
                if (!showSmoke || !fireCalcDone || !fireResult) return undefined;
                const map = new Map<string, { color: string; fromT: number; toT: number }>();

                // Вспомогательная функция: цвет дыма по уровню опасности (оттенки серого — цвет дыма)
                const hazardCol = (level: string) =>
                  level === "lethal"  ? "#1f2937"
                : level === "danger"  ? "#374151"
                : level === "warning" ? "#4b5563"
                : "#6b7280"; // safe — светло-серый, задымление слабое но видимое

                fireResult.branches.forEach((fr, bid) => {
                  const branch = branches.find(b => b.id === bid);
                  if (!branch) return;
                  const col = hazardCol(fr.hazardLevel);

                  if (branch.hasFire) {
                    if (smokeTimeMinutes <= 0) return;
                    const ft = branch.fireT ?? 0.5;
                    const flowSpeed = fr.airSpeed > 0 ? fr.airSpeed : 0.3;
                    const len = branch.length > 0 ? branch.length : 1;
                    const elapsedSec = smokeTimeMinutes * 60;
                    // Используем flowSign из результата расчёта (не branch.flow из state — он может быть устаревшим)
                    const flowDir = (fr.flowSign ?? 1) >= 0; // true = from→to

                    // Дым от очага распространяется ТОЛЬКО ВНИЗ по потоку (по направлению
                    // струи воздуха). Против потока (к входному узлу очага, откуда идёт
                    // свежий воздух) дым не идёт.
                    const downLen = Math.min(
                      flowDir ? (1 - ft) * len : ft * len,
                      elapsedSec * flowSpeed
                    );
                    const downFrac = downLen / len;

                    const fromT = flowDir ? ft : Math.max(0, ft - downFrac);
                    const toT   = flowDir ? Math.min(1, ft + downFrac) : ft;

                    map.set(bid, { color: col, fromT, toT });
                    return;
                  }

                  // Обычная ветвь: дым входит начиная с smokeArrivalTime
                  if (smokeTimeMinutes <= 0 || fr.smokeArrivalTime > smokeTimeMinutes) return;

                  const elapsedInBranch = smokeTimeMinutes - fr.smokeArrivalTime;
                  const speed = fr.airSpeed > 0 ? fr.airSpeed : 0.3;
                  const smokedLen = elapsedInBranch * 60 * speed;
                  const smokedFrac = branch.length > 0
                    ? Math.min(1, smokedLen / branch.length)
                    : 1;

                  // ВХОДНОЙ узел ветви — тот, куда дым пришёл раньше (по времени
                  // задымления узлов). Заливка ВСЕГДА растёт ОТ входного узла по
                  // направлению струи — это гарантирует НЕПРЕРЫВНОСТЬ фронта, в т.ч.
                  // на опрокинутых ветвях (дым не «перескакивает» на другой конец).
                  const nat = fireResult.nodeArrivalTime;
                  const tFrom = nat?.get(branch.fromId);
                  const tTo = nat?.get(branch.toId);
                  let inputIsFrom: boolean;
                  if (tFrom !== undefined && tTo !== undefined) {
                    // Вход — узел, задымлённый раньше
                    inputIsFrom = tFrom <= tTo;
                  } else if (tFrom !== undefined) {
                    inputIsFrom = true;
                  } else if (tTo !== undefined) {
                    inputIsFrom = false;
                  } else {
                    // fallback на знак потока из расчёта
                    inputIsFrom = (fr.flowSign ?? (((branch.flow ?? 0) >= 0) ? 1 : -1)) >= 0;
                  }

                  if (inputIsFrom) {
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
                    // Волна останавливается на атмосферных узлах (выход на поверхность)
                    const toNode = nodes.find(n => n.id === e.to);
                    if (toNode?.atmosphereLink) continue;
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
                  // Ветви достигнутые волной (узел в distNode) — красим всегда, включая зелёную безопасную зону
                  map.set(b.id, zoneColor(dp));
                });

                return map.size > 0 ? map : undefined;
              })()}
              reversedBranchIds={fireCalcDone && fireResult && showSmoke ? fireResult.reversedBranches : undefined}
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
              compareBranchColors={(() => {
                if (!compareResult || compareResult.branches.length === 0) return undefined;
                const map = new Map<string, string>();
                compareResult.branches.forEach(diff => {
                  if (diff.status === "added")   map.set(diff.id, "#22c55e"); // зелёный
                  if (diff.status === "removed")  map.set(diff.id, "#ef4444"); // красный
                  if (diff.status === "changed")  map.set(diff.id, "#f59e0b"); // жёлтый
                });
                return map.size > 0 ? map : undefined;
              })()}
              rescuePathBranchIds={
                depressogramPickMode && depressogramManualBranches.size > 0 ? depressogramManualBranches
                : depressogramHighlight.length > 0 ? new Set(depressogramHighlight)
                : workerPathBranchIds.size > 0 ? workerPathBranchIds
                : rescuePathBranchIds.size > 0 ? rescuePathBranchIds
                : undefined
              }
              rescuePathBranchDirs={
                depressogramHighlight.length > 0 ? undefined
                : workerPathBranchDirs.size > 0 ? workerPathBranchDirs
                : rescuePathBranchDirs.size > 0 ? rescuePathBranchDirs
                : undefined
              }
              rescuePathNodeIds={
                workerPathNodeIds.size > 0 ? workerPathNodeIds
                : rescuePathNodeIds.size > 0 ? rescuePathNodeIds
                : undefined
              }
              rescueNodeLetters={
                workerNodeLetters.size > 0 ? workerNodeLetters
                : rescueNodeLetters.size > 0 ? rescueNodeLetters
                : undefined
              }
              rescuePickMode={depressogramPickMode ? "depress" : (rescuePickMode ?? workerPickMode)}
              onRescueNodePick={(nodeId) => {
                if (rescuePickMode) rescuePickHandlerRef.current?.(nodeId);
                else if (workerPickMode) workerPickHandlerRef.current?.(nodeId);
              }}
              onRescueBranchPick={(branchId) => {
                if (depressogramPickMode) setDepressogramManualBranches(prev => {
                  const next = new Set(prev);
                  if (next.has(branchId)) { next.delete(branchId); } else { next.add(branchId); }
                  return next;
                });
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
                        explosionMethod: "fnip_494",
                        explosionSourceType: "mass",
                        explosionGasId: "methane",
                        explosionGasVolume: 100,
                        explosionGasConcentration: 9.5,
                        explosionExplosiveId: "ammonit",
                        explosionExplosiveMass: 100,
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
                  } else if (typeId === "valve_water" && branchId) {
                    // Запорный вентиль на водопроводе — перекрывает/открывает
                    // течение воды в ветви. По умолчанию установлен открытым.
                    const br = branches.find(b => b.id === branchId);
                    const newSym: SchemaSymbol = {
                      id: `SYM_VW_${Date.now()}`,
                      typeId, x, y, branchId, t: 0.5,
                    };
                    setSchemaSymbols(prev => [...prev, newSym]);
                    if (br) {
                      updateBranch(branchId, { wpHasGate: true, wpGateClosed: false });
                    }
                    setSelectedSymbolId(newSym.id);
                    setSelectedBranchId(branchId);
                    setSelectedNodeId(null);
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
              void viewStateTick; // подписка на обновления камеры через rAF-throttled state
              const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const projOpts = { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation };
              // xyScale и zScale применяем к осям, как это делает TopoCanvas
              const proj = (wx: number, wy: number, wz = 0) => {
                const p = project3D({ x: wx * (xyScale ?? 1), y: wy * (xyScale ?? 1), z: wz * (zScale ?? 1) }, projOpts);
                return { sx: p.sx, sy: p.sy };
              };
              // Проекция узла с xyScale и zScale
              const projNode = (n: { x: number; y: number; z: number }) =>
                project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, projOpts);
              // Масштаб маркеров позиций ПЛА — В ТОЧНОСТИ как у перемычек/ветвей.
              // «Сырой» коэффициент объекта = view.scale / (xyScale * 0.4) — тот же, что _objSF ветвей.
              // Нормируем на xyScale: при реальных координатах «нормальный» vs.scale меньше в xyScale раз.
              // Режим «Пределы масштаба ВКЛ» (fixedObjectScale): размер зажат между posMin% и posMax%.
              // Режим ВЫКЛ: свободно масштабируется с зумом (мин. 0.25, макс. 8), как ветвь.
              const _xySFPos = Math.max(1, xyScale ?? 1);
              const _rawPosSF = vs.scale / (_xySFPos * 0.4);
              const posSF = scaleLimitsEnabled
                ? Math.min(scalePositionMax / 100, Math.max(scalePositionMin / 100, _rawPosSF))
                : Math.min(8, Math.max(0.25, _rawPosSF));
              const PX_PER_MM = 3.78 * posSF;
              // ГОСТ-диаметр маркера позиции (мм). Действует ГЛОБАЛЬНО как множитель
              // относительно эталона 13 мм: эффективный диаметр = pos.diameter · (ГОСТ / 13).
              // Так поле «Размер по ГОСТ» всегда влияет на схему, сохраняя индивидуальные
              // размеры отдельных позиций.
              const _posGostMm = positionGostMm > 0 ? positionGostMm : 13;
              const _gostFactor = _posGostMm / 13;

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
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", pointerEvents: "none", cursor: leaderDrawMode ? "crosshair" : "inherit", zIndex: 2 }}
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
                    const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
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

                    // Фиксированный масштаб выноски: когда «Пределы масштаба» ВКЛ,
                    // маркер имеет фиксированный экранный размер (posSF зажат), а конец
                    // выноски — мировая точка, проецируемая полным зумом. Из-за этого
                    // при отдалении/приближении выноска «убегает» от маркера.
                    //
                    // ВАЖНО: если выноска ПРИВЯЗАНА к ветви (isBranchAttached) — её конец
                    // ОБЯЗАН лежать точно на ветви, поэтому масштабировать (отрывать от
                    // ветви) нельзя. Вместо этого маркер сам «плавает» вместе с точкой
                    // привязки — он тоже мировая точка (pos.x, pos.y), проецируемая тем же
                    // зумом, что и ветвь, поэтому выноска маркер↔ветвь корректна при любом
                    // масштабе. Коэффициент зажатия применяем ТОЛЬКО к свободным выноскам
                    // (не привязанным к ветви), чтобы их длина совпадала с размером маркера.
                    // В режиме рисования (isDrawing) не трогаем — конец следует за курсором.
                    if (!isDrawing && !isBranchAttached && scaleLimitsEnabled && _rawPosSF > 0) {
                      const clampRatio = posSF / _rawPosSF;
                      if (clampRatio !== 1) {
                        endSx = pm.sx + (endSx - pm.sx) * clampRatio;
                        endSy = pm.sy + (endSy - pm.sy) * clampRatio;
                      }
                    }

                    const dx = endSx - pm.sx, dy = endSy - pm.sy;
                    const dist = Math.hypot(dx, dy);
                    if (dist < 2) return null;
                    const ux = dx / dist, uy = dy / dist;
                    const x1 = pm.sx + ux * (r + 2), y1 = pm.sy + uy * (r + 2);
                    const isDragging = draggingLeaderPosId === pos.id;

                    return (
                      <g key={`leader-${pos.id}`}>
                        {/* Пунктирная линия-выноска — красная (единый стиль SVG/Canvas) */}
                        <line
                          x1={x1} y1={y1} x2={endSx} y2={endSy}
                          stroke="#e11d48" strokeWidth={lw}
                          strokeDasharray="6,3" strokeLinecap="round"
                          opacity={isDrawing ? 0.6 : 0.95}
                          style={{ pointerEvents: "none" }}
                        />
                        {/* Точка привязки к ветви */}
                        {isBranchAttached && !isDrawing && (
                          <circle cx={endSx} cy={endSy} r={4}
                            fill="#e11d48" stroke="#fff" strokeWidth={1.5}
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
                    const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
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
                            <circle r={r + r * 0.14} fill="none" stroke="#e53e3e" strokeWidth={Math.max(1.5, r * 0.06)} />
                            <circle r={r + r * 0.08} fill="none" stroke="#fff" strokeWidth={Math.max(1.5, r * 0.07)} />
                          </>
                        )}
                        {isSelected && <circle r={r + r * 0.08} fill="none" stroke="#2563eb" strokeWidth={Math.max(1.5, r * 0.05)} strokeDasharray="5,2.5" />}
                        <circle r={r} fill={pos.color} stroke={pos.borderColor} strokeWidth={Math.max(1, r * 0.05)} />
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

                  {/* ── Текстовые блоки ── */}
                  {(() => {
                    const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
                    const _xySF = xyScale ?? 1;
                    const pxPerMm = 3.78 * Math.min(8, Math.max(0.25, vs.scale / (_xySF * 0.5)));
                    return textBlocks.map((tb) => {
                      const { sx, sy } = project3D(
                        { x: tb.x * _xySF, y: tb.y * _xySF, z: 0 },
                        { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation }
                      );
                      const fsPx = tb.fontSize * pxPerMm;
                      const isSel = tb.id === selectedTextBlockId;
                      const lines = tb.text.split("\n");
                      const lineH = fsPx * 1.35;
                      const maxLen = Math.max(...lines.map(l => l.length), 4);
                      const estW = Math.max(60, maxLen * fsPx * 0.58 + 16);
                      const estH = lines.length * lineH + 12;
                      return (
                        <g key={tb.id}
                          transform={`translate(${sx},${sy})`}
                          style={{ cursor: draggingTextId === tb.id ? "grabbing" : isSel ? "grab" : "pointer", pointerEvents: "all" }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            const cr = (e.currentTarget.closest(".relative") as HTMLElement)?.getBoundingClientRect();
                            if (!cr) return;
                            const startSx = e.clientX - cr.left;
                            const startSy = e.clientY - cr.top;
                            const now = Date.now();
                            const el = e.currentTarget as SVGGElement & { _lastClick?: number };
                            const isDbl = now - (el._lastClick ?? 0) < 350;
                            el._lastClick = now;
                            if (isDbl) { setEditingTextBlockId(tb.id); setSelectedTextBlockId(tb.id); return; }
                            setSelectedTextBlockId(tb.id);
                            setEditingTextBlockId(null);
                            setDraggingTextId(tb.id);
                            textDragRef.current = { id: tb.id, startSx, startSy, startWx: tb.x, startWy: tb.y };
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {tb.background !== "none" && (
                            <rect x={-estW/2} y={-estH/2} width={estW} height={estH} fill={tb.background} rx={3} />
                          )}
                          {isSel && (
                            <rect x={-estW/2-3} y={-estH/2-3} width={estW+6} height={estH+6}
                              fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="5,2.5" rx={4} />
                          )}
                          {tb.borderColor !== "none" && (
                            <rect x={-estW/2} y={-estH/2} width={estW} height={estH}
                              fill="none" stroke={tb.borderColor} strokeWidth={1} rx={3} />
                          )}
                          {lines.map((line, li) => (
                            <text key={li}
                              x={0} y={(-estH/2 + 8) + li * lineH + fsPx * 0.8}
                              textAnchor="middle" fill={tb.color} fontSize={fsPx}
                              fontWeight={tb.bold ? "bold" : "normal"}
                              fontStyle={tb.italic ? "italic" : "normal"}
                              fontFamily="sans-serif"
                              style={{ userSelect: "none" }}
                            >{line}</text>
                          ))}
                        </g>
                      );
                    });
                  })()}
                </svg>
              );
            })()}

            {/* ── Inline-редактор текстового блока ── */}
            {editingTextBlockId && (() => {
              const tb = textBlocks.find(t => t.id === editingTextBlockId);
              if (!tb) return null;
              const vs = savedViewStateRef.current ?? { scale: 1, offsetX: 0, offsetY: 0, azimuth: 0, elevation: 90 };
              const _xySF = xyScale ?? 1;
              const { sx, sy } = project3D(
                { x: tb.x * _xySF, y: tb.y * _xySF, z: 0 },
                { scale: vs.scale, offsetX: vs.offsetX, offsetY: vs.offsetY, azimuth: vs.azimuth, elevation: vs.elevation }
              );
              const pxPerMm = 3.78 * Math.min(8, Math.max(0.25, vs.scale / (_xySF * 0.5)));
              const fsPx = tb.fontSize * pxPerMm;
              return (
                <textarea
                  autoFocus
                  defaultValue={tb.text}
                  onBlur={(e) => {
                    setTextBlocks(prev => prev.map(t => t.id === editingTextBlockId ? { ...t, text: e.target.value } : t));
                    setEditingTextBlockId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setEditingTextBlockId(null); }
                    e.stopPropagation();
                  }}
                  style={{
                    position: "absolute",
                    left: sx - 80, top: sy - fsPx * 1.2,
                    minWidth: 160, minHeight: fsPx * 2.5,
                    fontSize: fsPx,
                    fontWeight: tb.bold ? "bold" : "normal",
                    fontStyle: tb.italic ? "italic" : "normal",
                    fontFamily: "sans-serif",
                    color: tb.color,
                    background: tb.background !== "none" ? tb.background : "rgba(255,255,255,0.97)",
                    border: "2px solid #2563eb",
                    borderRadius: 4, padding: "4px 8px",
                    outline: "none", resize: "both",
                    zIndex: 200,
                    boxShadow: "0 2px 12px rgba(0,0,0,0.18)",
                    lineHeight: 1.4,
                  }}
                />
              );
            })()}

            {/* Подсказка в режиме текстового блока */}
            {tool === "textblock" && (
              <div style={{
                position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
                background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 12, fontWeight: 500,
                padding: "5px 14px", borderRadius: 6, pointerEvents: "none", zIndex: 100,
                letterSpacing: 0.2, boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              }}>
                T Кликните на схеме для добавления текста  [Esc — отмена]
              </div>
            )}

            {/* Легенда сравнения схем */}
            {compareResult && compareResult.branches.some(b => b.status !== "unchanged") && (
              <div style={{
                position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
                background: "rgba(15,23,42,0.88)", color: "#fff", fontSize: 11,
                padding: "5px 14px", borderRadius: 6, pointerEvents: "none", zIndex: 50,
                display: "flex", alignItems: "center", gap: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                backdropFilter: "blur(4px)",
              }}>
                <span style={{ color: "#a5b4fc", fontWeight: 600, marginRight: 4 }}>↔ Сравнение:</span>
                <span><span style={{ color: "#f59e0b" }}>●</span> есть изменения</span>
                <span><span style={{ color: "#22c55e" }}>●</span> добавленный объект</span>
                <span><span style={{ color: "#ef4444" }}>●</span> удалённый объект</span>
              </div>
            )}

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
                          const next = Math.round((prev + smokeTimeStep) * 1000) / 1000;
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
                  {smokeTimeMinutes > 0 && smokeTimeMinutes < 1
                    ? `T = ${Math.round(smokeTimeMinutes * 60)} сек`
                    : `T = ${Number(smokeTimeMinutes.toFixed(2))} мин`}
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
                  {[
                    { v: 1 / 60, label: "1 сек" },
                    { v: 30 / 60, label: "30 сек" },
                    { v: 1, label: "1 мин" },
                    { v: 2, label: "2 мин" },
                    { v: 5, label: "5 мин" },
                    { v: 10, label: "10 мин" },
                    { v: 15, label: "15 мин" },
                    { v: 30, label: "30 мин" },
                    { v: 60, label: "60 мин" },
                  ].map(s => (
                    <option key={s.label} value={s.v}>{s.label}</option>
                  ))}
                </select>

                <div style={{ width: 1, background: "#7f1d1d", alignSelf: "stretch", margin: "0 2px" }} />

                {/* Порог видимости задымления — применяется при следующем расчёте пожара */}
                <span style={{ fontSize: 10, color: "#fca5a5", whiteSpace: "nowrap" }}
                  title="Дым распространяется, пока видимость в дыму ниже этого порога. Применяется при следующем расчёте пожара.">
                  Порог видимости:
                </span>
                <input
                  type="number" min={1} max={200} step={5}
                  value={smokeVisThreshold}
                  onChange={e => setSmokeVisThreshold(Math.max(1, Math.min(200, Number(e.target.value))))}
                  title="Дым распространяется, пока видимость в дыму ниже этого порога. Применяется при следующем расчёте пожара."
                  style={{
                    width: 48, fontSize: 11, background: "#3b0000", color: "#fca5a5",
                    border: "1px solid #7f1d1d", borderRadius: 3, padding: "1px 4px", textAlign: "center",
                  }}
                />
                <span style={{ fontSize: 10, color: "#fca5a5" }}>м</span>
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
                <input type="range" min="0.1" max="20" step="0.1"
                  value={zScale}
                  onChange={(e) => setZScale(parseFloat(e.target.value))}
                  className="w-full"
                  style={{ accentColor: "#2563eb" }} />
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>0.1×</span><span>10×</span><span>20×</span>
                </div>
                {/* Порог SVG ↔ Canvas (сворачиваемый, по умолчанию свёрнут) */}
                <div className="border-t border-gray-300 mt-2 pt-2">
                  <button onClick={() => setThresholdOpen((v) => !v)}
                    className="w-full flex items-center gap-1 text-[11px] font-semibold hover:opacity-80"
                    style={{ color: "#1a3a6b" }}>
                    <Icon name={thresholdOpen ? "ChevronDown" : "ChevronRight"} size={12} />
                    <span>Порог SVG→Canvas: {canvasThreshold}</span>
                  </button>
                  {thresholdOpen && (
                    <div className="mt-2">
                      <div className="flex items-center justify-end mb-1">
                        <button onClick={() => setCanvasThreshold(800)}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-gray-400 hover:bg-gray-200">
                          Сброс
                        </button>
                      </div>
                      <input type="range" min="200" max="2000" step="50"
                        value={canvasThreshold}
                        onChange={(e) => setCanvasThreshold(parseInt(e.target.value, 10))}
                        className="w-full"
                        style={{ accentColor: "#7c3aed" }} />
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>200</span><span>1000</span><span>2000</span>
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: branches.length > canvasThreshold ? "#7c3aed" : "#16a34a" }}>
                        Ветвей: {branches.length} · режим:{" "}
                        <b>{branches.length > canvasThreshold ? "Canvas (быстрый)" : "SVG (детальный)"}</b>
                      </div>
                    </div>
                  )}
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

    <CadImportDialogs
      nodes={nodes}
      branches={branches}
      horizons={horizons}
      projectFileName={projectFileName}
      unitsConfig={unitsConfig}
      showDxfImport={showDxfImport}
      setShowDxfImport={setShowDxfImport}
      handleDxfImport={handleDxfImport}
      showExcelImport={showExcelImport}
      setShowExcelImport={setShowExcelImport}
      handleExcelImport={handleExcelImport}
      showExcelExport={showExcelExport}
      setShowExcelExport={setShowExcelExport}
      showCombinedImport={showCombinedImport}
      setShowCombinedImport={setShowCombinedImport}
      handleCombinedImport={handleCombinedImport}
      showCsvImport={showCsvImport}
      setShowCsvImport={setShowCsvImport}
      handleCsvImport={handleCsvImport}
      showVent2CsvImport={showVent2CsvImport}
      setShowVent2CsvImport={setShowVent2CsvImport}
      handleVent2CsvImport={handleVent2CsvImport}
      showVentsimImport={showVentsimImport}
      setShowVentsimImport={setShowVentsimImport}
      handleVentsimImport={handleVentsimImport}
      showEquipRef={showEquipRef}
      setShowEquipRef={setShowEquipRef}
      equipRefTab={equipRefTab}
      setEquipRefTab={setEquipRefTab}
      mineFans={mineFans}
      setMineFans={setMineFans}
      mineBulkheads={mineBulkheads}
      setMineBulkheads={setMineBulkheads}
      mineTypes={mineTypes}
      setMineTypes={setMineTypes}
      setUnitsConfig={setUnitsConfig}
      showLogPanel={showLogPanel}
      setShowLogPanel={setShowLogPanel}
      logEntries={logEntries}
      setLogEntries={setLogEntries}
      ctxMenu={ctxMenu}
      setCtxMenu={setCtxMenu}
      handleCtxAction={handleCtxAction}
      branchParamBuffer={branchParamBuffer}
      selectedNodeIds={selectedNodeIds}
      selectedBranchIds={selectedBranchIds}
    />

    <CadToolDialogs
      nodes={nodes}
      branches={branches}
      branchesRaw={branchesRaw}
      horizons={horizons}
      projectFileName={projectFileName}
      unitsConfig={unitsConfig}
      showLegend={showLegend}
      setShowLegend={setShowLegend}
      showPrintDialog={showPrintDialog}
      setShowPrintDialog={setShowPrintDialog}
      schemaSymbols={schemaSymbols}
      savedViewStateRef={savedViewStateRef}
      savedViewState={savedViewState}
      canvasSize={canvasSize}
      branchWidth={branchWidth}
      branchBorder={branchBorder}
      thinLines={thinLines}
      colorByHorizon={colorByHorizon}
      flowDisplay={flowDisplay}
      infoConfig={infoConfig}
      zScale={zScale}
      getSvgRef={getSvgRef}
      colorMode={colorMode}
      posColorInner={posColorInner}
      posColorOuter={posColorOuter}
      positions={positions}
      showPositions={showPositions}
      scaleLimitsEnabled={scaleLimitsEnabled}
      xyScale={xyScale}
      printDialogOpenExport={printDialogOpenExport}
      setPrintDialogOpenExport={setPrintDialogOpenExport}
      showRenumberDialog={showRenumberDialog}
      setShowRenumberDialog={setShowRenumberDialog}
      renumberAll={renumberAll}
      showSelectSimilar={showSelectSimilar}
      setShowSelectSimilar={setShowSelectSimilar}
      selectedBranch={selectedBranch}
      selectedSymbolId={selectedSymbolId}
      setSelectedBranchId={setSelectedBranchId}
      setSelectedBranchIds={setSelectedBranchIds}
      setSelectedNodeId={setSelectedNodeId}
      setSelectedSymbolId={setSelectedSymbolId}
      setSelectedSymbolIds={setSelectedSymbolIds}
      showDepressogram={showDepressogram}
      setShowDepressogram={setShowDepressogram}
      setDepressogramHighlight={setDepressogramHighlight}
      depressogramPickMode={depressogramPickMode}
      setDepressogramPickMode={setDepressogramPickMode}
      depressogramManualBranches={depressogramManualBranches}
      setDepressogramManualBranches={setDepressogramManualBranches}
      showFireStability={showFireStability}
      setShowFireStability={setShowFireStability}
      showVds={showVds}
      setShowVds={setShowVds}
      solveResult={solveResult}
      computeFireStabilityFacts={computeFireStabilityFacts}
      showLicenseDialog={showLicenseDialog}
      setShowLicenseDialog={setShowLicenseDialog}
      license={license}
      isDemo={isDemo}
      showMultiBranchProps={showMultiBranchProps}
      setShowMultiBranchProps={setShowMultiBranchProps}
      selectedBranchIds={selectedBranchIds}
      pushHistory={pushHistory}
      updateBranch={updateBranch}
      showVentPipeDialog={showVentPipeDialog}
      setShowVentPipeDialog={setShowVentPipeDialog}
      ventPipeBranchIds={ventPipeBranchIds}
      buildVentPipeLine={buildVentPipeLine}
      showHelpDialog={showHelpDialog}
      setShowHelpDialog={setShowHelpDialog}
    />

    <CadModals
      nodes={nodes}
      branches={branches}
      branchesRaw={branchesRaw}
      projectFileName={projectFileName}
      scaleSettingsOpen={scaleSettingsOpen}
      setScaleSettingsOpen={setScaleSettingsOpen}
      scaleTextMin={scaleTextMin}
      setScaleTextMin={setScaleTextMin}
      scaleTextMax={scaleTextMax}
      setScaleTextMax={setScaleTextMax}
      scaleBranchMin={scaleBranchMin}
      setScaleBranchMin={setScaleBranchMin}
      scaleBranchMax={scaleBranchMax}
      setScaleBranchMax={setScaleBranchMax}
      scalePositionMin={scalePositionMin}
      setScalePositionMin={setScalePositionMin}
      scalePositionMax={scalePositionMax}
      setScalePositionMax={setScalePositionMax}
      positionGostMm={positionGostMm}
      setPositionGostMm={setPositionGostMm}
      bulkheadScale={bulkheadScale}
      setBulkheadScale={setBulkheadScale}
      fanScale={fanScale}
      setFanScale={setFanScale}
      setScaleLimitsEnabled={setScaleLimitsEnabled}
      mergeNodeDialog={mergeNodeDialog}
      setMergeNodeDialog={setMergeNodeDialog}
      doDeleteNode={doDeleteNode}
      mergeAdjacentBranches={mergeAdjacentBranches}
      squadDialog={squadDialog}
      setSquadDialog={setSquadDialog}
      squadCount={squadCount}
      setSquadCount={setSquadCount}
      addSymbol={addSymbol}
      setTool={setTool}
      setActiveSymbolTypeId={setActiveSymbolTypeId}
      showCloseConfirm={showCloseConfirm}
      setShowCloseConfirm={setShowCloseConfirm}
      handleSave={handleSave}
      showAbout={showAbout}
      setShowAbout={setShowAbout}
      compareShowDialog={compareShowDialog}
      setCompareShowDialog={setCompareShowDialog}
      compareLoading={compareLoading}
      setCompareLoading={setCompareLoading}
      setCompareResult={setCompareResult}
      setCompareFilter={setCompareFilter}
      setCompareSelectedId={setCompareSelectedId}
      setActiveSide={setActiveSide}
      setLeftPanelOpen={setLeftPanelOpen}
      setActiveRibbon={setActiveRibbon}
    />




    </>
  );
}