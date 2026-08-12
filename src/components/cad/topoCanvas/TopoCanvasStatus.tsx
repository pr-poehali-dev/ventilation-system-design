// ─────────────────────────────────────────────────────────────────────────────
// TopoCanvasStatus.tsx — строка состояния и подсказки инструментов холста:
//   • левый индикатор: режим Canvas, ракурс 3D, координаты курсора, плоскость;
//   • правый индикатор: числовой масштаб схемы;
//   • подсказки активного инструмента (узел / ветвь / вращение / привязка УО).
//
// Вынесено из TopoCanvas.tsx БЕЗ изменений разметки, стилей и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import { type WorkPlane } from "@/lib/topology";
import { type CadTool } from "./topoCanvasTypes";

interface StatusProps {
  useCanvas: boolean;
  visibleBranchCount: number;
  is3D: boolean;
  azimuth: number;
  elevation: number;
  hoverPos: { x: number; y: number } | null;
  effPlane: WorkPlane;
  zLevel: number;
  scale: number;
}

/** Индикаторы внизу холста (координаты, плоскость, масштаб). */
export function TopoCanvasIndicators({
  useCanvas, visibleBranchCount, is3D, azimuth, elevation,
  hoverPos, effPlane, zLevel, scale,
}: StatusProps) {
  return (
    <>
      {/* Индикаторы */}
      <div className="absolute bottom-1 left-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444", marginLeft: "0px", paddingBottom: "0px" }}>
        {useCanvas && (
          <span className="mr-2 px-1 rounded" style={{ background: "#d1fae5", color: "#065f46" }}>
            Canvas · {visibleBranchCount} вет.
          </span>
        )}
        {is3D && <span className="mr-2">3D · Az: {azimuth.toFixed(0)}° · El: {elevation.toFixed(0)}°</span>}
        {hoverPos && (() => {
          // Вывод координат с учётом активной плоскости
          const fixZ = effPlane.axis === "z" ? effPlane.value : null;
          const fixY = effPlane.axis === "y" ? effPlane.value : null;
          const fixX = effPlane.axis === "x" ? effPlane.value : null;
          return (
            <span>
              X: {fixX ?? hoverPos.x} м · Y: {fixY ?? hoverPos.y} м · Z: {fixZ ?? (is3D ? "?" : zLevel)} м
            </span>
          );
        })()}
        <span className="ml-3 px-1.5 py-0.5 rounded"
          style={{ background: "#fef3c7", color: "#92400e" }}>
          Плоск: {effPlane.axis.toUpperCase()}={effPlane.value} м
        </span>
      </div>
      <div className="absolute bottom-1 right-2 text-[11px] font-mono pointer-events-none"
        style={{ color: "#444" }}>
        М 1:{(1 / Math.max(0.00001, scale * 0.001)).toFixed(0)}
      </div>
    </>
  );
}

interface HintsProps {
  pendingSymbolTypeId: string | null | undefined;
  tool: CadTool;
  effPlane: WorkPlane;
  branchFrom: string | null;
}

/** Подсказки активного инструмента в левом верхнем углу холста. */
export function TopoCanvasHints({ pendingSymbolTypeId, tool, effPlane, branchFrom }: HintsProps) {
  return (
    <>
      {/* Подсказка — режим ожидания привязки */}
      {pendingSymbolTypeId && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#059669", color: "white" }}>
          Кликните на ветвь чтобы разместить УО · Esc — отмена
        </div>
      )}

      {/* Подсказка */}
      {tool === "node" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white" }}>
          ✚ Клик на холсте — создать узел на плоскости{" "}
          {effPlane.axis === "z" ? `Z = ${effPlane.value} м (XY)` :
           effPlane.axis === "y" ? `Y = ${effPlane.value} м (XZ)` :
           `X = ${effPlane.value} м (YZ)`}
        </div>
      )}
      {tool === "branch" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#2563eb", color: "white" }}>
          {branchFrom ? "Выберите второй узел" : "Выберите начальный узел ветви"}
        </div>
      )}
      {tool === "rotate" && (
        <div className="absolute top-2 left-2 px-2 py-1 rounded text-[11px]"
          style={{ background: "#7c3aed", color: "white" }}>
          🔄 Драг — вращение камеры (Az/El)
        </div>
      )}
    </>
  );
}
