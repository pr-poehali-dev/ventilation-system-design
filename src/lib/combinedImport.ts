// ─────────────────────────────────────────────────────────────────────────────
// Комбинированный импорт: DXF (X/Y координаты) + Excel (Z, длины, сечения)
//
// Алгоритм:
//   1. DXF → узлы с X/Y (без Z) + ветви с топологией
//   2. Excel → узлы с номерами + Z (глубина) + ветви с параметрами
//   3. Сшивка: находим узлы DXF, ближайшие к каждому узлу Excel по номеру
//      или по позиции, назначаем Z из Excel
//   4. Для каждой ветви Excel ищем соответствующую ветвь DXF (по парам узлов)
//      и берём длины/сечения из Excel, X/Y из DXF
// ─────────────────────────────────────────────────────────────────────────────

import { parseDxf, type DxfImportResult } from "@/lib/dxfImport";
import { parseExcel, type ExcelImportResult } from "@/lib/excelImport";
import { makeNode, makeBranch, type TopoNode, type TopoBranch } from "@/lib/topology";

export interface CombinedImportResult {
  nodes: TopoNode[];
  branches: TopoBranch[];
  warnings: string[];
  stats: {
    nodes: number;
    branches: number;
    nodesWithXY: number;
    nodesWithZ: number;
    branchesWithParams: number;
  };
  debugDxf?: string;
  debugExcel?: string;
}

export function combineImports(
  dxfResult: DxfImportResult,
  excelResult: ExcelImportResult
): CombinedImportResult {
  const warnings: string[] = [...dxfResult.warnings, ...excelResult.warnings];
  const ts = Date.now();

  // ── Шаг 1: Базовые узлы из Excel (у них есть номера и Z) ─────────────────
  // Excel-узлы: number = "001", "002"... name = "1", "2"...
  // DXF-узлы: number = "001"..., x/y из координат

  // Строим карту DXF-узлов по номеру
  const dxfByNumber = new Map<string, TopoNode>();
  for (const n of dxfResult.nodes) {
    const num = n.number.replace(/^0+/, "") || "0";  // "001" → "1"
    dxfByNumber.set(num, n);
    dxfByNumber.set(n.number, n);  // тоже "001"
  }

  // Строим карту Excel-узлов по номеру
  const excelByNumber = new Map<string, TopoNode>();
  for (const n of excelResult.nodes) {
    const num = n.number.replace(/^0+/, "") || "0";
    excelByNumber.set(num, n);
    excelByNumber.set(n.number, n);
  }

  // ── Шаг 2: Сшиваем узлы ─────────────────────────────────────────────────
  // Для каждого Excel-узла ищем DXF-узел с тем же номером → берём X/Y из DXF, Z из Excel
  let nodesWithXY = 0;
  let nodesWithZ = 0;

  const mergedNodes = new Map<string, TopoNode>();  // ключ = Excel node id

  for (const exNode of excelResult.nodes) {
    const num = exNode.number.replace(/^0+/, "") || "0";
    const dxfNode = dxfByNumber.get(num) ?? dxfByNumber.get(exNode.number);

    const x = dxfNode ? dxfNode.x : exNode.x;
    const y = dxfNode ? dxfNode.y : exNode.y;
    const z = exNode.z;

    if (dxfNode) nodesWithXY++;
    if (z !== 0) nodesWithZ++;

    mergedNodes.set(exNode.id, makeNode(`N${ts}_${num}`, {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      z: Math.round(z * 10) / 10,
      number: exNode.number,
      name: exNode.name,
    }));
  }

  // Если часть узлов не найдена в DXF — предупреждение
  const missingXY = excelResult.nodes.length - nodesWithXY;
  if (missingXY > 0) {
    warnings.push(
      `⚠ ${missingXY} из ${excelResult.nodes.length} узлов не найдены в DXF ` +
      `— X/Y для них вычислены автоматически (force-directed layout).`
    );
  }

  // ── Шаг 3: Строим карту соответствия Excel id → merged id ────────────────
  // Ветви Excel ссылаются на Excel-node id, нужно перевести в merged id
  const excelIdToMerged = new Map<string, string>();
  for (const [exId, mergedNode] of mergedNodes) {
    excelIdToMerged.set(exId, mergedNode.id);
  }

  // ── Шаг 4: Ветви из Excel с обогащёнными параметрами ─────────────────────
  // Берём ветви Excel — они содержат длину, угол, сечение, Z.
  // fromId/toId переводим через карту.
  const branches: TopoBranch[] = [];
  let branchesWithParams = 0;

  for (const b of excelResult.branches) {
    const fromMerged = excelIdToMerged.get(b.fromId);
    const toMerged   = excelIdToMerged.get(b.toId);
    if (!fromMerged || !toMerged) continue;

    const hasParams = b.area > 0 || b.length > 0;
    if (hasParams) branchesWithParams++;

    branches.push({
      ...b,
      id: `B${ts}_${branches.length}`,
      fromId: fromMerged,
      toId: toMerged,
    });
  }

  const nodes = [...mergedNodes.values()];

  if (nodesWithXY === 0) {
    warnings.push(
      "⚠ Ни один узел Excel не совпал с узлами DXF по номеру. " +
      "Убедитесь что нумерация узлов совпадает в обоих файлах."
    );
  }

  return {
    nodes,
    branches,
    warnings,
    stats: {
      nodes: nodes.length,
      branches: branches.length,
      nodesWithXY,
      nodesWithZ,
      branchesWithParams,
    },
    debugDxf: dxfResult.debug,
    debugExcel: excelResult.debug,
  };
}
