import { type FanCurve, fanH, fanEfficiency } from "@/lib/fanCurves";

// ─────────────────────────────────────────────────────────────────────────────
// Q-H характеристика вентилятора с наложением характеристики сети
// и рабочей точкой пересечения
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  curve: FanCurve;
  netResistance: number;   // R сети (без вентилятора), Н·с²/м⁸
  workingQ: number;        // фактический расход (рабочая точка), м³/с
  workingH: number;        // фактическая депрессия, Па
  fanReverse?: boolean;    // показывать реверсную кривую
  width?: number;
  height?: number;
}

export default function FanCurveChart({ curve, netResistance, workingQ, workingH, fanReverse = false, width = 280, height = 180 }: Props) {
  const padL = 40, padR = 8, padT = 10, padB = 28;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const hasReverseCurve = !!(curve.reverseH0 !== undefined && curve.reverseH1 !== undefined && curve.reverseH2 !== undefined);

  // Дискретизируем кривые
  const N = 60;
  const qMax = fanReverse && curve.reverseQMax ? Math.max(curve.qMax, curve.reverseQMax) : curve.qMax;
  const qStep = (qMax - curve.qMin) / N;
  const fanPts: { Q: number; H: number }[] = [];
  const revPts: { Q: number; H: number }[] = [];
  const netPts: { Q: number; H: number }[] = [];
  const effPts: { Q: number; eta: number }[] = [];
  let hMax = 0;

  for (let i = 0; i <= N; i++) {
    const Q = curve.qMin + i * qStep;
    const Hf = fanH(curve, Q);
    const Hn = netResistance * Q * Q;
    const eta = fanEfficiency(curve, Q);
    fanPts.push({ Q, H: Hf });
    netPts.push({ Q, H: Hn });
    effPts.push({ Q, eta });
    if (Hf > hMax) hMax = Hf;
    if (Hn > hMax && Hn < hMax * 3) hMax = Hn;
    // Реверсная кривая
    if (hasReverseCurve) {
      const Qr = curve.qMin + i * ((curve.reverseQMax ?? curve.qMax) - curve.qMin) / N;
      const Hr = Math.max(0, curve.reverseH0! + curve.reverseH1! * Qr + curve.reverseH2! * Qr);
      revPts.push({ Q: Qr, H: Hr });
      if (Hr > hMax) hMax = Hr;
    }
  }
  hMax = Math.max(hMax, workingH * 1.1) * 1.05;

  // Преобразование в координаты SVG
  const sx = (Q: number) => padL + ((Q - curve.qMin) / (curve.qMax - curve.qMin)) * W;
  const yH = (Hpa: number) => padT + H - (Hpa / hMax) * H;
  const yEta = (eta: number) => padT + H - (eta / 1.0) * H;

  const fanPath = fanPts.map((p, i) => `${i ? "L" : "M"} ${sx(p.Q)} ${yH(p.H)}`).join(" ");
  const revPath = revPts.length > 0 ? revPts.map((p, i) => `${i ? "L" : "M"} ${sx(p.Q)} ${yH(p.H)}`).join(" ") : null;
  const netPath = netPts.map((p, i) => `${i ? "L" : "M"} ${sx(p.Q)} ${yH(p.H)}`).join(" ");
  const etaPath = effPts.map((p, i) => `${i ? "L" : "M"} ${sx(p.Q)} ${yEta(p.eta)}`).join(" ");

  // Рабочая точка
  const wpInRange = workingQ >= curve.qMin && workingQ <= curve.qMax;
  const wpX = wpInRange ? sx(workingQ) : null;
  const wpY = wpInRange ? yH(workingH) : null;

  // Тики Q (4 шт)
  const qTicks = [curve.qMin, curve.qMin + (curve.qMax - curve.qMin) * 0.33,
                  curve.qMin + (curve.qMax - curve.qMin) * 0.66, curve.qMax];
  // Тики H (4 шт)
  const hTicks = [0, hMax * 0.33, hMax * 0.66, hMax];

  return (
    <svg width={width} height={height} style={{ background: "#fafafa", border: "1px solid #d0d0d0" }}>
      {/* Сетка */}
      {qTicks.map((q, i) => (
        <line key={`vx${i}`} x1={sx(q)} x2={sx(q)} y1={padT} y2={padT + H}
          stroke="#e8e8e8" strokeWidth="0.5" />
      ))}
      {hTicks.map((h, i) => (
        <line key={`hy${i}`} x1={padL} x2={padL + W} y1={yH(h)} y2={yH(h)}
          stroke="#e8e8e8" strokeWidth="0.5" />
      ))}

      {/* Оси */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + H} stroke="#666" strokeWidth="1" />
      <line x1={padL} y1={padT + H} x2={padL + W} y2={padT + H} stroke="#666" strokeWidth="1" />

      {/* Метки тиков */}
      {qTicks.map((q, i) => (
        <text key={`tx${i}`} x={sx(q)} y={padT + H + 12} textAnchor="middle"
          fontSize="9" fontFamily="Segoe UI" fill="#666">{q.toFixed(0)}</text>
      ))}
      {hTicks.map((h, i) => (
        <text key={`ty${i}`} x={padL - 4} y={yH(h) + 3} textAnchor="end"
          fontSize="9" fontFamily="Segoe UI" fill="#666">{(h / 1000).toFixed(1)}</text>
      ))}
      <text x={padL + W / 2} y={height - 4} textAnchor="middle" fontSize="10"
        fontFamily="Segoe UI" fill="#444">Q, м³/с</text>
      <text x={4} y={padT + H / 2} fontSize="10" fontFamily="Segoe UI" fill="#444"
        transform={`rotate(-90 12,${padT + H / 2})`}>H, кПа</text>

      {/* КПД (правая шкала, штрих) */}
      <path d={etaPath} fill="none" stroke="#16a34a" strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
      <text x={padL + W - 4} y={padT + 10} textAnchor="end" fontSize="9"
        fontFamily="Segoe UI" fill="#16a34a">η (КПД)</text>

      {/* Q-H вентилятора (прямой режим) */}
      <path d={fanPath} fill="none" stroke="#7c3aed" strokeWidth={fanReverse ? 1 : 2}
        opacity={fanReverse ? 0.35 : 1} strokeDasharray={fanReverse ? "4 2" : undefined} />
      <text x={padL + W * 0.15} y={yH(fanPts[Math.floor(N * 0.15)].H) - 4}
        fontSize="9" fontFamily="Segoe UI" fill="#7c3aed" opacity={fanReverse ? 0.5 : 1}>
        {fanReverse ? "H_прям" : "H_вент"}
      </text>

      {/* Реверсная Q-H кривая */}
      {revPath && (
        <>
          <path d={revPath} fill="none" stroke="#dc2626" strokeWidth="2"
            opacity={fanReverse ? 1 : 0.4} strokeDasharray={fanReverse ? undefined : "6 3"} />
          <text x={padL + W * 0.15} y={yH(revPts[Math.floor(revPts.length * 0.15)]?.H ?? 0) - 4}
            fontSize="9" fontFamily="Segoe UI" fill="#dc2626"
            opacity={fanReverse ? 1 : 0.6}>
            {fanReverse ? "H_реверс" : "H_реверс (инфо)"}
          </text>
        </>
      )}

      {/* Характеристика сети */}
      <path d={netPath} fill="none" stroke="#dc2626" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x={padL + W * 0.85} y={yH(netPts[Math.floor(N * 0.85)].H) - 4}
        fontSize="9" fontFamily="Segoe UI" fill="#dc2626">H_сеть = R·Q²</text>

      {/* Рабочая точка */}
      {wpX !== null && wpY !== null && (
        <g>
          <line x1={wpX} y1={padT} x2={wpX} y2={padT + H}
            stroke="#0369a1" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5" />
          <line x1={padL} y1={wpY} x2={padL + W} y2={wpY}
            stroke="#0369a1" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.5" />
          <circle cx={wpX} cy={wpY} r="5" fill="#0369a1" stroke="white" strokeWidth="1.5" />
          <text x={wpX + 8} y={wpY - 8} fontSize="10" fontFamily="Segoe UI"
            fontWeight="600" fill="#0369a1">
            Q={workingQ.toFixed(1)} · H={(workingH / 1000).toFixed(2)}кПа
          </text>
        </g>
      )}
    </svg>
  );
}