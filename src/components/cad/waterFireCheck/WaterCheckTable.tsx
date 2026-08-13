// ─────────────────────────────────────────────────────────────────────────────
// WaterCheckTable.tsx — таблица результатов проверки: набор колонок зависит
// от режима (вся сеть / по очагу пожара). В режиме очага дополнительно
// показываются путь до очага, число рукавов, ход отделения ВГСЧ и время
// начала подачи воды.
//
// Вынесено из WaterFireCheckDialog.tsx БЕЗ изменений разметки, колонок,
// подсветки нарушений и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import type { WaterCheckRow, FireHydrantRow } from "@/lib/waterFireCheck";

interface WaterCheckTableProps {
  visibleRows: WaterCheckRow[];
  mode: "network" | "fire";
  fireResult: {
    rescueComputed?: boolean;
    fastestHydrant?: { nodeId: string } | null;
  } | null;
  onHighlightNode?: (nodeId: string) => void;
  fireBranchesCount: number;
  resultError: string | null;
  onlyFailed: boolean;
}

export default function WaterCheckTable({
  visibleRows, mode, fireResult, onHighlightNode,
  fireBranchesCount, resultError, onlyFailed,
}: WaterCheckTableProps) {
  const fireBranches = { length: fireBranchesCount };
  const result = { error: resultError };
  return (
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
  );
}
