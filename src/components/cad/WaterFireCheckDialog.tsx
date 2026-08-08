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

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
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
  branches, nodes, projectName = "Подземный рудник", onHighlightNode, onClose,
}: Props) {
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
          <div className="px-4 pt-2.5 pb-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
            {fireBranches.length === 0 ? (
              <div className="text-[11px] flex items-center gap-2 py-1"
                style={{ color: "#8a5a00" }}>
                <Icon name="TriangleAlert" size={14} />
                В схеме не задан очаг пожара. Установите очаг на вкладке «Аварии».
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-[12px] text-gray-600">Очаг пожара</span>
                  <select value={activeFireBranch?.id ?? ""}
                    onChange={e => setFireBranchId(e.target.value)}
                    className="text-[12px] border border-gray-300 rounded px-2 py-1 flex-1">
                    {fireBranches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.type || `Ветвь ${b.fromId.slice(-4)}–${b.toId.slice(-4)}`}
                        {b.fireHeatRelease > 0 ? ` — ${b.fireHeatRelease.toFixed(2)} МВт` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-gray-600 flex-1">Длина рукава, м</span>
                    {numInput(hoseLength, setHoseLength)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-gray-600 flex-1">Рукавов в линии</span>
                    {numInput(maxHoses, setMaxHoses)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-gray-600 flex-1">Интенсивность, л/(с·м²)</span>
                    {numInput(intensity, setIntensity)}
                  </div>
                </div>

                {/* ── Ход отделения ВГСЧ ── */}
                <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px dashed #dde3ee" }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[12px] text-gray-600">База ВГСЧ</span>
                    <select value={baseNodeId} onChange={e => setBaseNodeId(e.target.value)}
                      className="text-[12px] border border-gray-300 rounded px-2 py-1 flex-1">
                      <option value="">— не учитывать ход отделения —</option>
                      {nodes.map(n => (
                        <option key={n.id} value={n.id}>
                          {n.number ? `№ ${n.number}` : n.id.slice(-4)}
                          {n.name ? ` — ${n.name}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-gray-600 flex-1">Развёртывание рукава, мин</span>
                      {numInput(hoseDeployTime, setHoseDeployTime)}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-gray-600 flex-1">Время ИДА, мин</span>
                      {numInput(idaWorkTime, setIdaWorkTime)}
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-400 leading-snug pt-1.5">
                    Укажите базу ВГСЧ — программа посчитает время хода отделения до каждого крана
                    с учётом задымления и уклонов, и определит, откуда вода пойдёт раньше всего.
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Вердикт по очагу */}
        {mode === "fire" && fireResult && (
          <div className="px-4 py-2.5 flex items-center gap-3"
            style={{
              background: fireResult.sufficient ? "#f0fdf4" : "#fff1f1",
              borderBottom: "1px solid #e0e4ee",
            }}>
            <Icon name={fireResult.sufficient ? "ShieldCheck" : "ShieldAlert"} size={18}
              style={{ color: fireResult.sufficient ? "#15803d" : "#dc2626" }} />
            <div className="flex-1">
              <div className="text-[12px] font-semibold"
                style={{ color: fireResult.sufficient ? "#15803d" : "#b91c1c" }}>
                {fireResult.verdict}
              </div>
              <div className="text-[10px] text-gray-500 pt-0.5">
                Дотягиваются рукавами: {fireResult.reaching.length} из {fireResult.hydrants.length} ·
                {" "}подача {fireResult.totalFlow} м³/ч при требуемых {fireResult.requiredFlow} м³/ч
                {fireResult.duration > 0 && ` · воды на ${Math.round(fireResult.duration)} мин`}
              </div>
              {/* Откуда вода пойдёт раньше всего — это НЕ всегда ближайший кран */}
              {fireResult.rescueComputed && fireResult.fastestHydrant && (
                <div className="text-[10px] pt-1" style={{ color: "#1d4ed8" }}>
                  Вода быстрее всего от крана <b>№ {fireResult.fastestHydrant.nodeNumber}</b>:
                  {" "}ход отделения {Math.round(fireResult.fastestHydrant.rescueTime ?? 0)} мин
                  {" "}+ развёртывание {fireResult.fastestHydrant.hoseCount} рукав.
                  {" "}= подача через <b>{Math.round(fireResult.waterStartTime ?? 0)} мин</b>
                </div>
              )}
            </div>
          </div>
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
        <div className="px-4 pt-3 pb-2.5" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Нормативные требования
          </div>
          <div className="grid grid-cols-3 gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Напор мин., МПа</span>
              {numInput(minPressure, setMinPressure)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Напор макс., МПа</span>
              {numInput(maxPressure, setMaxPressure)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Расход мин., м³/ч</span>
              {numInput(minFlow, setMinFlow)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Время работы, мин</span>
              {numInput(minDuration, setMinDuration)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Стволов одновременно</span>
              {numInput(simultaneous, setSimultaneous)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-600 flex-1">Скорость макс., м/с</span>
              {numInput(maxVelocity, setMaxVelocity)}
            </div>
          </div>
          <div className="text-[10px] text-gray-400 leading-snug pt-2">
            Каждый пожарный кран проверяется отдельным гидравлическим расчётом: открывается
            только он и ближайшие к нему краны по числу одновременно работающих стволов.
          </div>
        </div>

        {/* Сводка */}
        {mode === "network" && !result.error && (
          <div className="px-4 py-2 flex items-center gap-5 text-[11px]"
            style={{ background: "#f6f8fc", borderBottom: "1px solid #e0e4ee" }}>
            <span className="text-gray-600">Проверено точек: <b>{result.total}</b></span>
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
        <div className="flex-1 overflow-auto">
          {visibleRows.length > 0 ? (
            <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
              <thead className="sticky top-0" style={{ background: "#eef2f9", zIndex: 1 }}>
                <tr className="text-gray-600">
                  {(mode === "fire"
                    ? ["№", "Узел", "Наименование", "До очага, м", "Рукавов",
                       ...(fireResult?.rescueComputed ? ["Ход ВГСЧ, мин", "Подача воды, мин"] : []),
                       "Напор, МПа", "Расход, м³/ч", "Требуется, м³/ч", "Время, мин", "Результат"]
                    : ["№", "Узел", "Наименование", "Напор, МПа", "Потери, МПа",
                       "Расход, м³/ч", "Требуется, м³/ч", "Время, мин", "V, м/с", "Результат"]
                  ).map(h => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap"
                      style={{ borderBottom: "1px solid #ccd6e6" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r: WaterCheckRow) => (
                  <tr key={r.nodeId}
                    onClick={() => onHighlightNode?.(r.nodeId)}
                    className={onHighlightNode ? "cursor-pointer hover:bg-blue-50" : ""}
                    style={{ background: r.ok ? undefined : "#fff1f1" }}
                    title={r.recommendation || undefined}>
                    <td className="px-2 py-1 text-gray-400" style={{ borderBottom: "1px solid #eef1f6" }}>{r.index}</td>
                    <td className="px-2 py-1 font-medium" style={{ borderBottom: "1px solid #eef1f6" }}>{r.nodeNumber}</td>
                    <td className="px-2 py-1 text-gray-700" style={{ borderBottom: "1px solid #eef1f6", maxWidth: 220 }}>
                      <div className="truncate">{r.nodeName || r.description || "—"}</div>
                      {r.consumerName && <div className="text-[10px] text-gray-400 truncate">{r.consumerName}</div>}
                    </td>
                    {/* В режиме очага вместо потерь показываем путь до очага и рукава */}
                    {mode === "fire" && (() => {
                      const fr = r as FireHydrantRow;
                      return (<>
                        <td className="px-2 py-1 text-right tabular-nums"
                          style={{ borderBottom: "1px solid #eef1f6",
                            color: fr.reachesFire ? undefined : "#dc2626",
                            fontWeight: fr.reachesFire ? undefined : 600 }}>
                          {fr.distanceToFire.toFixed(0)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums"
                          style={{ borderBottom: "1px solid #eef1f6",
                            color: fr.reachesFire ? "#6b7280" : "#dc2626" }}>
                          {fr.hoseCount}
                        </td>
                        {/* Ход отделения ВГСЧ и время начала подачи воды */}
                        {fireResult?.rescueComputed && (<>
                          <td className="px-2 py-1 text-right tabular-nums"
                            style={{ borderBottom: "1px solid #eef1f6",
                              color: fr.rescueReachable ? "#6b7280" : "#dc2626",
                              fontWeight: fr.rescueReachable ? undefined : 600 }}
                            title={fr.rescueO2 !== null ? `Расход кислорода: ${fr.rescueO2} л` : undefined}>
                            {fr.rescueTime !== null ? fr.rescueTime.toFixed(0) : "—"}
                            {!fr.rescueReachable && " ⚠"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums"
                            style={{ borderBottom: "1px solid #eef1f6",
                              fontWeight: fireResult.fastestHydrant?.nodeId === fr.nodeId ? 700 : undefined,
                              color: fireResult.fastestHydrant?.nodeId === fr.nodeId ? "#1d4ed8" : "#374151" }}>
                            {fr.waterStartTime !== null ? fr.waterStartTime.toFixed(0) : "—"}
                          </td>
                        </>)}
                      </>);
                    })()}
                    <td className="px-2 py-1 text-right tabular-nums"
                      style={{ borderBottom: "1px solid #eef1f6",
                        color: r.fails.includes("no-pressure") || r.fails.includes("over-pressure") ? "#dc2626" : undefined,
                        fontWeight: r.fails.includes("no-pressure") || r.fails.includes("over-pressure") ? 600 : undefined }}>
                      {r.pressure.toFixed(3)}
                    </td>
                    {mode === "network" && (
                      <td className="px-2 py-1 text-right tabular-nums text-gray-500" style={{ borderBottom: "1px solid #eef1f6" }}>
                        {r.pressureLoss.toFixed(3)}
                      </td>
                    )}
                    <td className="px-2 py-1 text-right tabular-nums"
                      style={{ borderBottom: "1px solid #eef1f6",
                        color: r.fails.includes("low-flow") ? "#dc2626" : undefined,
                        fontWeight: r.fails.includes("low-flow") ? 600 : undefined }}>
                      {r.flow.toFixed(1)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-gray-500" style={{ borderBottom: "1px solid #eef1f6" }}>
                      {r.requiredFlow.toFixed(1)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums"
                      style={{ borderBottom: "1px solid #eef1f6",
                        color: r.fails.includes("short-duration") ? "#dc2626" : undefined }}>
                      {r.duration > 0 ? r.duration.toFixed(0) : "—"}
                    </td>
                    {mode === "network" && (
                      <td className="px-2 py-1 text-right tabular-nums text-gray-500" style={{ borderBottom: "1px solid #eef1f6" }}>
                        {r.maxVelocity.toFixed(2)}
                      </td>
                    )}
                    <td className="px-2 py-1" style={{ borderBottom: "1px solid #eef1f6", maxWidth: 240 }}>
                      {r.ok
                        ? <span className="text-green-700">Обеспечено</span>
                        : <span className="text-red-600 font-semibold">{r.verdict}</span>}
                      {!r.ok && r.recommendation && (
                        <div className="text-[10px] text-gray-500 truncate">{r.recommendation}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[12px] text-gray-500 text-center py-8">
              {mode === "fire"
                ? (fireBranches.length === 0
                    ? "Установите очаг пожара на вкладке «Аварии»."
                    : "Пожарных кранов, связанных с очагом, не найдено.")
                : result.error
                  ? "Проверка невозможна — устраните замечание выше."
                  : onlyFailed
                    ? "Все точки водоразбора отвечают нормативу."
                    : "Точек водоразбора не найдено."}
            </div>
          )}
        </div>

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