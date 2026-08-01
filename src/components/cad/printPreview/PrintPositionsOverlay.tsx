// Слой позиций ПЛА (выноски + маркеры) для предпросмотра печати.
// Вынесено из PrintPreviewCanvas.tsx без изменений логики.
import {
  type TopoBranch, type ProjOptions,
  project3D,
} from "@/lib/topology";
import { type ProjNode } from "@/lib/canvasRenderer";
import { type Position } from "@/lib/positions";

interface Props {
  positions: Position[];
  branches: TopoBranch[];
  projNodesMap: Map<string, ProjNode>;
  proj: ProjOptions;
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  activeView: ProjOptions & { scale: number; offsetX: number; offsetY: number };
  zScale: number;
  xyScale?: number;
  fixedObjectScale: boolean;
  scalePositionMin: number;
  scalePositionMax: number;
  positionGostMm: number;
}

export default function PrintPositionsOverlay({
  positions,
  branches,
  projNodesMap,
  proj,
  viewState,
  activeView,
  zScale,
  xyScale,
  fixedObjectScale,
  scalePositionMin,
  scalePositionMax,
  positionGostMm,
}: Props) {
  const _xySF = xyScale ?? 1;
  // posSF: при фиксированном масштабе (fixedObjectScale) размер НЕ зависит от
  // зума — базовый коэффициент = 1, затем зажимается в диапазон posMin%..posMax%
  // (точно как в рабочей области Cad.tsx). Иначе — пропорционально зуму.
  const _rawPosSF = fixedObjectScale ? 1 : Math.min(8, Math.max(0.25, viewState.scale / (_xySF * 0.5)));
  const posSF = fixedObjectScale
    ? Math.min(scalePositionMax / 100, Math.max(scalePositionMin / 100, _rawPosSF))
    : _rawPosSF;
  const previewK = viewState.scale > 0 ? activeView.scale / viewState.scale : 1;
  const _posGostMm = positionGostMm > 0 ? positionGostMm : 13;
  const _gostFactor = _posGostMm / 13;
  const PX_PER_MM = 3.78 * posSF * previewK;

  const posProj = (pos: Position) =>
    project3D({ x: pos.x * _xySF, y: pos.y * _xySF, z: (pos.z ?? 0) * zScale }, proj);

  // Экранный конец выноски: привязка к ветви (branchId + t) или свободная точка
  const posLeaderEnd = (pos: Position): { sx: number; sy: number } | null => {
    if (pos.leaderBranchId && pos.leaderT != null) {
      const br = branches.find(b => b.id === pos.leaderBranchId);
      const fromN = br ? projNodesMap.get(br.fromId) : null;
      const toN   = br ? projNodesMap.get(br.toId)   : null;
      if (!fromN || !toN) return null;
      return { sx: fromN.sx + (toN.sx - fromN.sx) * pos.leaderT, sy: fromN.sy + (toN.sy - fromN.sy) * pos.leaderT };
    }
    if (pos.leaderEndX != null && pos.leaderEndY != null) {
      return project3D({ x: pos.leaderEndX * _xySF, y: pos.leaderEndY * _xySF, z: (pos.z ?? 0) * zScale }, proj);
    }
    return null;
  };

  // Позиция маркера с притягиванием к концу выноски при фиксированном масштабе
  const markerScreenPos = (pos: Position): { sx: number; sy: number } => {
    const base = posProj(pos);
    if (!fixedObjectScale || _rawPosSF <= 0) return base;
    const end = posLeaderEnd(pos);
    if (!end) return base;
    const clampRatio = posSF / _rawPosSF;
    if (clampRatio === 1) return base;
    return { sx: end.sx + (base.sx - end.sx) * clampRatio, sy: end.sy + (base.sy - end.sy) * clampRatio };
  };

  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      {/* Выноски (основная + дополнительные) */}
      {positions.map(pos => {
        if (pos.visible === false || pos.x == null) return null;
        const pm = markerScreenPos(pos);
        const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
        const lw = Math.max(0.3, (pos.leaderThickness ?? 0.02) * PX_PER_MM);
        // Собираем список концов: основная выноска + дополнительные
        const ends: { sx: number; sy: number; attached: boolean; key: string }[] = [];
        const mainEnd = posLeaderEnd(pos);
        if (mainEnd) ends.push({ ...mainEnd, attached: !!(pos.leaderBranchId && pos.leaderT != null), key: "main" });
        (pos.extraLeaders ?? []).forEach(el => {
          let e: { sx: number; sy: number } | null = null;
          let att = false;
          if (el.branchId && el.t != null) {
            const br = branches.find(b => b.id === el.branchId);
            const fromN = br ? projNodesMap.get(br.fromId) : null;
            const toN   = br ? projNodesMap.get(br.toId)   : null;
            if (fromN && toN) { e = { sx: fromN.sx + (toN.sx - fromN.sx) * el.t, sy: fromN.sy + (toN.sy - fromN.sy) * el.t }; att = true; }
          } else if (el.endX != null && el.endY != null) {
            e = project3D({ x: el.endX * _xySF, y: el.endY * _xySF, z: (pos.z ?? 0) * zScale }, proj);
          }
          if (e) ends.push({ ...e, attached: att, key: el.id });
        });
        if (ends.length === 0) return null;
        return (
          <g key={`leader-${pos.id}`}>
            {ends.map(end => {
              const dx = end.sx - pm.sx, dy = end.sy - pm.sy;
              const dist = Math.hypot(dx, dy);
              if (dist < 2) return null;
              const ux = dx / dist, uy = dy / dist;
              const x1 = pm.sx + ux * (r + 2), y1 = pm.sy + uy * (r + 2);
              return (
                <g key={end.key}>
                  <line x1={x1} y1={y1} x2={end.sx} y2={end.sy}
                    stroke="#e11d48" strokeWidth={lw} strokeDasharray="6,3" strokeLinecap="round" opacity={0.95} />
                  {/* Якорь выноски прозрачный — как в рабочей области (виден только при наведении) */}
                </g>
              );
            })}
          </g>
        );
      })}
      {/* Маркеры */}
      {positions.map(pos => {
        if (pos.visible === false || pos.x == null) return null;
        const { sx, sy } = markerScreenPos(pos);
        const r = (pos.diameter ?? 13) * _gostFactor * PX_PER_MM / 2;
        const fontSize = pos.number >= 100 ? r * 0.55 : pos.number >= 10 ? r * 0.7 : r * 0.85;
        const isReverse = pos.positionType === "reverse";
        return (
          <g key={pos.id} transform={`translate(${sx},${sy})`}>
            {isReverse && (
              <>
                <circle r={r + r * 0.14} fill="none" stroke="#e53e3e" strokeWidth={Math.max(1, r * 0.06)} />
                <circle r={r + r * 0.08} fill="none" stroke="#fff" strokeWidth={Math.max(1, r * 0.07)} />
              </>
            )}
            <circle r={r} fill={pos.color} stroke={pos.borderColor ?? "#000000"} strokeWidth={Math.max(0.5, r * 0.12)} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={700}
              fill="#000000" style={{ userSelect: "none" }}>{pos.number}</text>
          </g>
        );
      })}
    </svg>
  );
}
