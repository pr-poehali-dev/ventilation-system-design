// ─────────────────────────────────────────────────────────────────────────────
// TopoCanvasHud.tsx — служебная графика поверх схемы:
//   • ViewCube — индикатор/переключатель ракурсов;
//   • ScaleBar  — масштабная линейка (как в АэроСети);
//   • PivotMarker — маркер центра вращения камеры.
//
// Вынесено из TopoCanvas.tsx БЕЗ изменений разметки и вычислений: те же
// координаты, размеры, цвета и подписи.
// ─────────────────────────────────────────────────────────────────────────────
import { type ViewPreset } from "@/lib/topology";

// ─── ViewCube: индикатор/переключатель ракурсов ────────────────────────────
export function ViewCube({ x, y, azimuth, elevation, onPick }: {
  x: number; y: number; azimuth: number; elevation: number; onPick: (p: ViewPreset) => void;
}) {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const proj = (px: number, py: number, pz: number) => {
    const x1 = Math.cos(az) * px + Math.sin(az) * py;
    const y1 = -Math.sin(az) * px + Math.cos(az) * py;
    const y2 = Math.sin(el) * y1 - Math.cos(el) * pz;
    return { sx: x1, sy: -y2 };
  };
  const s = 18;  // полу-сторона куба
  // 8 вершин куба
  const verts = [
    proj(-s, -s, -s), proj(s, -s, -s), proj(s, s, -s), proj(-s, s, -s),
    proj(-s, -s,  s), proj(s, -s,  s), proj(s, s,  s), proj(-s, s,  s),
  ];
  // 6 граней (топ/бот/фронт/бэк/лев/прав), порядок вершин CCW
  const faces: { idx: [number, number, number, number]; preset: ViewPreset; color: string; label: string }[] = [
    { idx: [4, 5, 6, 7], preset: "plan",   color: "#fde68a", label: "ПЛАН" },
    { idx: [0, 3, 2, 1], preset: "plan",   color: "#fef3c7", label: "" },     // низ
    { idx: [0, 1, 5, 4], preset: "front",  color: "#bfdbfe", label: "ФРНТ" },
    { idx: [2, 3, 7, 6], preset: "back",   color: "#dbeafe", label: "ТЫЛ" },
    { idx: [0, 4, 7, 3], preset: "left",   color: "#bbf7d0", label: "ЛЕВ" },
    { idx: [1, 2, 6, 5], preset: "right",  color: "#d1fae5", label: "ПРАВ" },
  ];
  // Сортировка граней по средней Z (примитивный hidden-faces)
  const facesWithDepth = faces.map((f) => {
    const cx = (verts[f.idx[0]].sx + verts[f.idx[2]].sx) / 2;
    const cy = (verts[f.idx[0]].sy + verts[f.idx[2]].sy) / 2;
    return { ...f, cx, cy };
  });

  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-26} y={-26} width={52} height={52} fill="white" fillOpacity="0.7" stroke="#9ca3af" rx="4" />
      {facesWithDepth.map((f, i) => {
        const pts = f.idx.map((vi) => `${verts[vi].sx},${verts[vi].sy}`).join(" ");
        const cx = f.idx.reduce((a, vi) => a + verts[vi].sx, 0) / 4;
        const cy = f.idx.reduce((a, vi) => a + verts[vi].sy, 0) / 4;
        return (
          <g key={i} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick(f.preset); }}>
            <polygon points={pts} fill={f.color} stroke="#374151" strokeWidth="0.8" />
            {f.label && (
              <text x={cx} y={cy + 3} textAnchor="middle" fontSize="7" fontWeight="600" fill="#1f2937"
                style={{ pointerEvents: "none" }}>
                {f.label}
              </text>
            )}
          </g>
        );
      })}
      {/* Изо-уголки */}
      <circle cx={20} cy={-20} r="4" fill="#a78bfa" stroke="#374151" strokeWidth="0.6"
        style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick("isoSE"); }} />
      <circle cx={-20} cy={-20} r="4" fill="#a78bfa" stroke="#374151" strokeWidth="0.6"
        style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onPick("isoSW"); }} />
    </g>
  );
}

// ─── МАСШТАБНАЯ ЛИНЕЙКА (как в АэроСети) ─────────────────────
// Разметка идентична обоим прежним местам вызова (SVG-режим и HUD над canvas).
export function ScaleBar({ scale, height }: { scale: number; height: number }) {
  // Подбираем «красивое» значение шага линейки
  const targetPx = 120;  // целевая длина линейки в пикселях
  const rawM = targetPx / scale;  // метры при текущем масштабе
  const exp = Math.pow(10, Math.floor(Math.log10(rawM)));
  const nice = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const stepM = nice.find(n => n * scale >= 60) ?? nice[nice.length - 1];
  const barPx = stepM * scale;
  const bx = 16, by = height - 36;
  const segments = 5;
  const segPx = barPx / segments;
  void exp;
  return (
    <g style={{ pointerEvents: "none" }} data-export-exclude="true">
      {/* Белая подложка */}
      <rect x={bx - 4} y={by - 18} width={barPx + 8} height={36}
        fill="white" fillOpacity="0.88" rx="3"
        stroke="#c0c0c0" strokeWidth="0.5" />
      {/* Полосы чёрно-белые как в Аэросети */}
      {Array.from({ length: segments }).map((_, i) => (
        <rect key={i}
          x={bx + i * segPx} y={by - 8}
          width={segPx} height={10}
          fill={i % 2 === 0 ? "#1a1a1a" : "#ffffff"}
          stroke="#1a1a1a" strokeWidth="0.8" />
      ))}
      {/* Левая граница */}
      <line x1={bx} y1={by - 8} x2={bx} y2={by - 14} stroke="#1a1a1a" strokeWidth="1.5" />
      {/* Правая граница */}
      <line x1={bx + barPx} y1={by - 8} x2={bx + barPx} y2={by - 14} stroke="#1a1a1a" strokeWidth="1.5" />
      {/* Деления по середине */}
      {Array.from({ length: segments - 1 }).map((_, i) => (
        <line key={i}
          x1={bx + (i + 1) * segPx} y1={by - 8}
          x2={bx + (i + 1) * segPx} y2={by - 12}
          stroke="#1a1a1a" strokeWidth="1" />
      ))}
      {/* Метки */}
      <text x={bx} y={by + 12} fontSize="10" fontFamily="Arial, sans-serif"
        fill="#111" textAnchor="middle" fontWeight="600">0</text>
      <text x={bx + barPx / 2} y={by + 12} fontSize="10" fontFamily="Arial, sans-serif"
        fill="#111" textAnchor="middle">
        {stepM / 2 >= 1000 ? `${stepM / 2000}тыс` : `${stepM / 2}`}
      </text>
      <text x={bx + barPx} y={by + 12} fontSize="10" fontFamily="Arial, sans-serif"
        fill="#111" textAnchor="middle" fontWeight="600">
        {stepM >= 1000 ? `${stepM / 1000} км` : `${stepM} м`}
      </text>
    </g>
  );
}

// ─── МАРКЕР PIVOT-ТОЧКИ (виден только во время вращения) ───
export function PivotMarker({ sx, sy }: { sx: number; sy: number }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Внешний полупрозрачный круг */}
      <circle cx={sx} cy={sy} r="14"
        fill="none" stroke="#f59e0b" strokeWidth="1.2"
        strokeDasharray="3 2" opacity="0.6" />
      {/* Крестик */}
      <line x1={sx - 8} y1={sy} x2={sx + 8} y2={sy}
        stroke="#f59e0b" strokeWidth="1.5" />
      <line x1={sx} y1={sy - 8} x2={sx} y2={sy + 8}
        stroke="#f59e0b" strokeWidth="1.5" />
      {/* Центральная точка */}
      <circle cx={sx} cy={sy} r="2.5"
        fill="#f59e0b" stroke="#7c2d12" strokeWidth="0.8" />
      {/* Подпись */}
      <text x={sx + 18} y={sy + 4} fontSize="10"
        fontFamily="Arial, sans-serif" fill="#7c2d12" fontWeight="600">
        центр вращения
      </text>
    </g>
  );
}
