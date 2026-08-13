import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import {
  checkWaterNetwork, checkFireWaterSupply,
  DEFAULT_WATER_NORMS, DEFAULT_FIRE_WATER_OPTIONS, DEFAULT_RESCUE_WATER_OPTIONS,
  type WaterCheckRow, type WaterNorms, type FireHydrantRow,
} from "@/lib/waterFireCheck";
import { exportWaterCheckAct } from "@/lib/waterCheckExport";
import { CONSUMER_CATALOG } from "@/lib/waterConsumers";
import { withWaterPumps, type PumpSymbolLite } from "@/lib/waterHydraulics";
// Блоки диалога вынесены в отдельные файлы (перенос 1:1, без правок логики)
import FireSourceSettings from "@/components/cad/waterFireCheck/FireSourceSettings";
import FireVerdictBanner from "@/components/cad/waterFireCheck/FireVerdictBanner";
import WaterNormsPanel from "@/components/cad/waterFireCheck/WaterNormsPanel";
import WaterCheckTable from "@/components/cad/waterFireCheck/WaterCheckTable";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  /** Символы схемы — нужны, чтобы учесть напор насосных станций */
  schemaSymbols?: PumpSymbolLite[];
  projectName?: string;
  /** Подсветить точку на схеме по клику в таблице */
  onHighlightNode?: (nodeId: string) => void;
  onClose: () => void;
}

// Название модели ствола по её id (для колонки «Тип ствола»)
function consumerName(id: string | undefined): string {
  if (!id) return "";
  return CONSUMER_CATALOG.find(m => m.id === id)?.name ?? "";
}

export default function WaterFireCheckDialog({
  branches: rawBranches, nodes, schemaSymbols = [],
  projectName = "Подземный рудник", onHighlightNode, onClose,
}: Props) {
  // Впечатываем напор насосных станций со схемы в поля ветвей — без этого
  // насос на схеме есть, а давление в проверке не поднимается.
  const branches = useMemo(
    () => withWaterPumps(rawBranches, schemaSymbols),
    [rawBranches, schemaSymbols],
  );
  const [minPressure, setMinPressure]   = useState(String(DEFAULT_WATER_NORMS.minPressure));
  const [maxPressure, setMaxPressure]   = useState(String(DEFAULT_WATER_NORMS.maxPressure));
  const [minFlow, setMinFlow]           = useState(String(DEFAULT_WATER_NORMS.minFlow));
  const [minDuration, setMinDuration]   = useState(String(DEFAULT_WATER_NORMS.minDuration));
  const [simultaneous, setSimultaneous] = useState(String(DEFAULT_WATER_NORMS.simultaneous));
  const [maxVelocity, setMaxVelocity]   = useState(String(DEFAULT_WATER_NORMS.maxVelocity));
  // Показывать только проблемные точки
  const [onlyFailed, setOnlyFailed] = useState(false);

  // ── Режим работы: вся сеть или конкретный очаг пожара ──
  const [mode, setMode] = useState<"network" | "fire">("network");
  // Параметры тушения очага
  const [hoseLength, setHoseLength] = useState(String(DEFAULT_FIRE_WATER_OPTIONS.hoseLength));
  const [maxHoses, setMaxHoses]     = useState(String(DEFAULT_FIRE_WATER_OPTIONS.maxHoses));
  const [intensity, setIntensity]   = useState(String(DEFAULT_FIRE_WATER_OPTIONS.intensity));
  // ── Ход отделения ВГСЧ ──
  const [baseNodeId, setBaseNodeId]       = useState("");
  const [hoseDeployTime, setHoseDeployTime] = useState(String(DEFAULT_RESCUE_WATER_OPTIONS.hoseDeployTime));
  const [idaWorkTime, setIdaWorkTime]     = useState(String(DEFAULT_RESCUE_WATER_OPTIONS.idaWorkTime));

  // Ветви с установленным очагом пожара
  const fireBranches = useMemo(() => branches.filter(b => b.hasFire), [branches]);
  const [fireBranchId, setFireBranchId] = useState<string>("");
  const activeFireBranch = useMemo(() => {
    if (fireBranches.length === 0) return null;
    return fireBranches.find(b => b.id === fireBranchId) ?? fireBranches[0];
  }, [fireBranches, fireBranchId]);

  const num = (s: string, d: number) => {
    const v = parseFloat(s.replace(",", "."));
    return Number.isFinite(v) ? v : d;
  };

  const result = useMemo(() => {
    const norms: Partial<WaterNorms> = {
      minPressure:  num(minPressure,  DEFAULT_WATER_NORMS.minPressure),
      maxPressure:  num(maxPressure,  DEFAULT_WATER_NORMS.maxPressure),
      minFlow:      num(minFlow,      DEFAULT_WATER_NORMS.minFlow),
      minDuration:  num(minDuration,  DEFAULT_WATER_NORMS.minDuration),
      simultaneous: Math.max(1, Math.round(num(simultaneous, DEFAULT_WATER_NORMS.simultaneous))),
      maxVelocity:  num(maxVelocity,  DEFAULT_WATER_NORMS.maxVelocity),
    };
    return checkWaterNetwork(nodes, branches, norms, consumerName);
  }, [nodes, branches, minPressure, maxPressure, minFlow, minDuration, simultaneous, maxVelocity]);

  // ── Расчёт по конкретному очагу пожара ──
  const fireResult = useMemo(() => {
    if (mode !== "fire" || !activeFireBranch) return null;
    return checkFireWaterSupply(
      activeFireBranch, nodes, branches,
      {
        hoseLength: num(hoseLength, DEFAULT_FIRE_WATER_OPTIONS.hoseLength),
        maxHoses:   Math.max(1, Math.round(num(maxHoses, DEFAULT_FIRE_WATER_OPTIONS.maxHoses))),
        intensity:  num(intensity, DEFAULT_FIRE_WATER_OPTIONS.intensity),
      },
      {
        minPressure: num(minPressure, DEFAULT_WATER_NORMS.minPressure),
        maxPressure: num(maxPressure, DEFAULT_WATER_NORMS.maxPressure),
        minFlow:     num(minFlow,     DEFAULT_WATER_NORMS.minFlow),
        minDuration: num(minDuration, DEFAULT_WATER_NORMS.minDuration),
      },
      consumerName,
      {
        baseNodeId,
        hoseDeployTime: num(hoseDeployTime, DEFAULT_RESCUE_WATER_OPTIONS.hoseDeployTime),
        idaWorkTime:    num(idaWorkTime,    DEFAULT_RESCUE_WATER_OPTIONS.idaWorkTime),
      },
    );
  }, [mode, activeFireBranch, nodes, branches, hoseLength, maxHoses, intensity,
      minPressure, maxPressure, minFlow, minDuration,
      baseNodeId, hoseDeployTime, idaWorkTime]);

  const visibleRows = mode === "fire"
    ? (fireResult?.hydrants ?? [])
    : (onlyFailed ? result.rows.filter(r => !r.ok) : result.rows);

  function handleExport() {
    exportWaterCheckAct(result, { projectName });
    onClose();
  }

  const numInput = (value: string, set: (v: string) => void) => (
    <input value={value} onChange={e => set(e.target.value)}
      className="text-[12px] border border-gray-300 rounded px-2 py-1 w-20 text-right" />
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-12"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 1080, maxHeight: "88vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">
            Проверка пожарно-оросительного трубопровода
          </span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {/* Переключатель режима: вся сеть / конкретный очаг */}
        <div className="flex items-center gap-1 px-4 pt-2.5" style={{ borderBottom: "1px solid #e0e4ee" }}>
          {([
            { key: "network" as const, label: "Вся сеть", icon: "Network" },
            { key: "fire" as const,    label: "По очагу пожара", icon: "Flame" },
          ]).map(t => (
            <button key={t.key} onClick={() => setMode(t.key)}
              className="text-[12px] px-3 py-1.5 rounded-t flex items-center gap-1.5"
              style={{
                background: mode === t.key ? "#ffffff" : "transparent",
                border: mode === t.key ? "1px solid #d0d8e8" : "1px solid transparent",
                borderBottom: mode === t.key ? "1px solid #ffffff" : "1px solid transparent",
                marginBottom: -1,
                color: mode === t.key ? "#1d4ed8" : "#6b7280",
                fontWeight: mode === t.key ? 600 : 400,
              }}>
              <Icon name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Выбор очага пожара */}
        {mode === "fire" && (
          <FireSourceSettings
            fireBranches={fireBranches}
            activeFireBranch={activeFireBranch}
            setFireBranchId={setFireBranchId}
            nodes={nodes}
            hoseLength={hoseLength} setHoseLength={setHoseLength}
            maxHoses={maxHoses} setMaxHoses={setMaxHoses}
            intensity={intensity} setIntensity={setIntensity}
            baseNodeId={baseNodeId} setBaseNodeId={setBaseNodeId}
            hoseDeployTime={hoseDeployTime} setHoseDeployTime={setHoseDeployTime}
            idaWorkTime={idaWorkTime} setIdaWorkTime={setIdaWorkTime}
            numInput={numInput}
          />
        )}

        {/* Вердикт по очагу */}
        {mode === "fire" && fireResult && (
          <FireVerdictBanner fireResult={fireResult} />
        )}

        {mode === "fire" && fireResult?.error && (
          <div className="px-4 py-2 text-[11px] flex items-center gap-2"
            style={{ background: "#fff4e5", borderBottom: "1px solid #f0d9b5", color: "#8a5a00" }}>
            <Icon name="TriangleAlert" size={14} />
            {fireResult.error}
          </div>
        )}

        {mode === "network" && result.error && (
          <div className="px-4 py-2 text-[11px] flex items-center gap-2"
            style={{ background: "#fff4e5", borderBottom: "1px solid #f0d9b5", color: "#8a5a00" }}>
            <Icon name="TriangleAlert" size={14} />
            {result.error}
          </div>
        )}

        {/* Нормативные требования */}
        <WaterNormsPanel
          minPressure={minPressure} setMinPressure={setMinPressure}
          maxPressure={maxPressure} setMaxPressure={setMaxPressure}
          minFlow={minFlow} setMinFlow={setMinFlow}
          minDuration={minDuration} setMinDuration={setMinDuration}
          simultaneous={simultaneous} setSimultaneous={setSimultaneous}
          maxVelocity={maxVelocity} setMaxVelocity={setMaxVelocity}
          numInput={numInput}
        />

        {/* Сводка */}
        {mode === "network" && !result.error && (
          <div className="px-4 py-2 flex items-center gap-5 text-[11px]"
            style={{ background: "#f6f8fc", borderBottom: "1px solid #e0e4ee" }}>
            <span className="text-gray-600">Проверено точек: <b>{result.total}</b></span>
            {result.pumpCount > 0 && (
              <span style={{ color: "#1d4ed8" }}
                title="Напор насосных станций учтён в расчёте давлений">
                Насосов: {result.pumpCount} (+{result.pumpHeadTotal} м вод. ст.)
              </span>
            )}
            <span className="text-green-700">Обеспечено: {result.total - result.failed}</span>
            {result.failed > 0
              ? <span className="text-red-600 font-semibold">Не обеспечено: {result.failed}</span>
              : <span className="text-gray-400">Не обеспечено: 0</span>}
            {result.worst && (
              <span className="text-gray-600 ml-auto">
                Худшая точка: <b>№ {result.worst.nodeNumber}</b> — {result.worst.pressure} МПа
              </span>
            )}
          </div>
        )}

        {/* Таблица результатов */}
        <WaterCheckTable
          visibleRows={visibleRows}
          mode={mode}
          fireResult={fireResult}
          onHighlightNode={onHighlightNode}
          fireBranchesCount={fireBranches.length}
          resultError={result.error}
          onlyFailed={onlyFailed}
        />

        {/* Итог + действия */}
        <div className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: "#f2f5fb", borderTop: "1px solid #d8e0ee" }}>
          {mode === "network" ? (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={onlyFailed} onChange={e => setOnlyFailed(e.target.checked)} />
              Показывать только проблемные точки
            </label>
          ) : (
            <span className="text-[10px] text-gray-400">
              Расстояние считается по горным выработкам — реальный путь прокладки рукавов
            </span>
          )}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
              Закрыть
            </button>
            <button onClick={handleExport} disabled={result.total === 0}
              title={mode === "fire"
                ? "Акт формируется по всей сети (режим «Вся сеть»)"
                : "Сформировать акт проверки ППЗ"}
              className="text-[12px] px-3 py-1.5 rounded text-white flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "#2563eb" }}>
              <Icon name="FileSpreadsheet" size={14} />
              Сформировать акт (Excel)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}