/**
 * Мини-график напорной характеристики насоса Q–H (+ кривая КПД).
 * Переиспользуется в панели свойств насоса и в справочнике «Насосы».
 */
import { useMemo } from "react";
import { type PumpModel, pumpHead, pumpEfficiency } from "@/lib/pumps";

interface Props {
  pump: PumpModel;
  /** Рабочая подача для отметки точки на кривой (по умолчанию Qopt) */
  workQ?: number;
  width?: number;
  height?: number;
}

export default function PumpChart({ pump, workQ, width = 250, height = 130 }: Props) {
  const W = width, H = height;
  const pad = { l: 34, r: 12, t: 12, b: 24 };
  const Qmax = pump.Qmax * 1.1;
  const Hmax = pump.H0 * 1.15;

  const xScale = (q: number) => pad.l + (q / Qmax) * (W - pad.l - pad.r);
  const yScale = (h: number) => H - pad.b - (h / Hmax) * (H - pad.t - pad.b);
  const yEta = (e: number) => H - pad.b - e * (H - pad.t - pad.b);

  const headCurve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const Q = (i / 60) * Qmax;
      const h = pumpHead(pump, Q);
      if (h > 0) pts.push([Q, h]);
    }
    return pts;
  }, [pump, Qmax]);

  const etaCurve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) {
      const Q = (i / 60) * Qmax;
      pts.push([Q, pumpEfficiency(pump, Q)]);
    }
    return pts;
  }, [pump, Qmax]);

  const path = (pts: [number, number][], yfn: (v: number) => number) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p[0]).toFixed(1)},${yfn(p[1]).toFixed(1)}`).join(" ");

  const wQ = workQ && workQ > 0 ? workQ : pump.Qopt;
  const wH = pumpHead(pump, wQ);

  return (
    <svg width={W} height={H} style={{ background: "#fafafa", border: "1px solid #e5e7eb", borderRadius: 3 }}>
      {/* Оси */}
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="#9ca3af" strokeWidth={1} />
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#9ca3af" strokeWidth={1} />
      {/* Сетка Y */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad.l} y1={yScale(Hmax * f)} x2={W - pad.r} y2={yScale(Hmax * f)} stroke="#eee" strokeWidth={0.5} />
      ))}
      {/* Кривая КПД (серая пунктирная) */}
      <path d={path(etaCurve, yEta)} fill="none" stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 2" />
      {/* Напорная кривая Q-H (красная) */}
      <path d={path(headCurve, yScale)} fill="none" stroke="#dc2626" strokeWidth={1.8} />
      {/* Рабочая точка */}
      <circle cx={xScale(wQ)} cy={yScale(wH)} r={3} fill="#dc2626" stroke="white" strokeWidth={1} />
      {/* Подписи осей */}
      <text x={W - pad.r} y={H - 6} fontSize={8} textAnchor="end" fill="#6b7280">Q, м³/ч</text>
      <text x={4} y={pad.t + 6} fontSize={8} fill="#6b7280">H,м</text>
      <text x={xScale(wQ)} y={yScale(wH) - 5} fontSize={8} textAnchor="middle" fill="#dc2626" fontWeight="bold">
        {Math.round(wH)}
      </text>
    </svg>
  );
}
