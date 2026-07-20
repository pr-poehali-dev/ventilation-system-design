// Barrel-файл: реэкспорт констант и утилит из canvasRenderer для TopoCanvas.
// Вынесены из CanvasLayer.tsx чтобы не ломать Fast Refresh
// (Fast Refresh требует чтобы файл с компонентом экспортировал ТОЛЬКО компонент).
export { CANVAS_THRESHOLD, hitNodeCanvas, hitBranchCanvas, hitBranchLabelCanvas, velocityColor, flowQColor } from "@/lib/canvasRenderer";
export { buildProjNodesMap, computeProjNodes } from "@/lib/canvasUtils";