// ─────────────────────────────────────────────────────────────────────────────
// h–Q диаграмма проветривания уклонного поля при пожаре (Приложение 2, рис. 2.1,б).
// Показывает влияние тепловой депрессии пожара на режим проветривания
// нисходящей наклонной выработки и границу опрокидывания струи.
//
//   Кривая 1 — напорная характеристика уклонного поля h = R_y·Q²
//   Кривая 2 — линия тепловой депрессии h_т (параллельна оси Q)
//   Кривая 3 — активизированная характеристика ШВС при пожаре: h_т + R_y·Q²
//   Точка A — нормальный режим ДО пожара        (Q = OM, h = R_y·Q_A²)
//   Точка B — режим ПРИ пожаре                  (Q = ON, h = h_т + R_y·Q_B²)
//   Точка C — критическая (Q = 0, вся депрессия расходуется на h_т) — h = h_кр
//   Точка D — опрокидывание струи (Q < 0)
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  Ry: number;            // сопротивление уклонного поля, Н·с²/м⁸
  Qa: number;            // расход ДО пожара (точка A), м³/с
  Qb: number;            // расход ПРИ пожаре (точка B), м³/с (может быть < 0 при опрокидывании)
  hT: number;            // тепловая депрессия пожара, Па (> 0)
  hKr?: number;          // критическая депрессия h_кр, Па (если есть параллель)
  reversed?: boolean;    // струя опрокинута (режим D)
  width?: number;
  height?: number;
}

export default function HQFireDiagram({
  Ry, Qa, Qb, hT, hKr, reversed = false, width = 300, height = 210,
}: Props) {
  const padL = 42, padR = 12, padT = 14, padB = 30;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const absQa = Math.abs(Qa);
  const absQb = Math.abs(Qb);
  const R = Math.max(1e-6, Ry);

  // Диапазон Q: слева допускаем отрицательную зону (опрокидывание, точка D)
  const qMaxPos = Math.max(absQa, absQb, 1) * 1.15;
  const qMinNeg = reversed ? -Math.max(absQb, qMaxPos * 0.4) * 1.1 : -qMaxPos * 0.15;
  const qSpan = qMaxPos - qMinNeg;

  // Диапазон H: макс из h_кр, активизированной кривой на qMax, h_т
  const hActivMax = hT + R * qMaxPos * qMaxPos;
  const hMax = Math.max(hActivMax, hKr ?? 0, hT, R * absQa * absQa, 1) * 1.1;

  const sx = (q: number) => padL + ((q - qMinNeg) / qSpan) * W;
  const sy = (h: number) => padT + H - (h / hMax) * H;

  // Дискретизация кривых
  const N = 60;
  const netPts: { q: number; h: number }[] = [];   // кривая 1: R·Q²
  const activPts: { q: number; h: number }[] = []; // кривая 3: h_т + R·Q²
  for (let i = 0; i <= N; i++) {
    const q = qMinNeg + (i / N) * qSpan;
    netPts.push({ q, h: R * q * q });
    activPts.push({ q, h: hT + R * q * q });
  }
  const netPath = netPts.map((p, i) => `${i ? "L" : "M"} ${sx(p.q)} ${sy(p.h)}`).join(" ");
  const activPath = activPts.map((p, i) => `${i ? "L" : "M"} ${sx(p.q)} ${sy(p.h)}`).join(" ");

  // Точки A / B / C / D
  const hA = R * absQa * absQa;                         // до пожара
  const hB = hT + R * absQb * absQb;                    // при пожаре
  // При опрокидывании точка B уходит в отрицательную зону (совпадает с D)
  const bQ = reversed ? -absQb : absQb;
  const A = { x: sx(absQa), y: sy(hA) };
  const B = { x: sx(bQ), y: sy(hB) };
  const C = { x: sx(0), y: sy(hKr ?? hT) };             // критическая (Q=0)
  const D = reversed ? { x: sx(-absQb), y: sy(hT + R * absQb * absQb) } : null;

  // Оси нулевой линии Q=0
  const x0 = sx(0);

  // Тики
  const qTicks = [qMinNeg, 0, qMaxPos * 0.5, qMaxPos].filter((v, i, a) => a.indexOf(v) === i);
  const hTicks = [0, hMax * 0.5, hMax];

  return (
    <svg width={width} height={height} style={{ background: "#fafafa", border: "1px solid #d0d0d0" }}>
      {/* Сетка */}
      {hTicks.map((h, i) => (
        <line key={`hg${i}`} x1={padL} x2={padL + W} y1={sy(h)} y2={sy(h)} stroke="#ececec" strokeWidth="0.5" />
      ))}
      {/* Ось h (в позиции Q=0 — как на рис. 2.1,б) */}
      <line x1={x0} y1={padT} x2={x0} y2={padT + H} stroke="#888" strokeWidth="1" />
      {/* Ось Q */}
      <line x1={padL} y1={padT + H} x2={padL + W} y2={padT + H} stroke="#666" strokeWidth="1" />

      {/* Метки осей */}
      <text x={padL + W} y={padT + H + 18} textAnchor="end" fontSize="10" fontFamily="Segoe UI" fill="#444">Q, м³/с</text>
      <text x={x0 + 4} y={padT + 8} fontSize="10" fontFamily="Segoe UI" fill="#444">h, Па</text>
      {qTicks.map((q, i) => (
        <text key={`qt${i}`} x={sx(q)} y={padT + H + 12} textAnchor="middle" fontSize="8" fontFamily="Segoe UI" fill="#888">{q.toFixed(0)}</text>
      ))}
      {hTicks.map((h, i) => (
        <text key={`ht${i}`} x={padL - 4} y={sy(h) + 3} textAnchor="end" fontSize="8" fontFamily="Segoe UI" fill="#888">{Math.round(h)}</text>
      ))}

      {/* Кривая 1: характеристика уклонного поля h = R·Q² */}
      <path d={netPath} fill="none" stroke="#0369a1" strokeWidth="1.6" />
      <text x={A.x + 6} y={A.y + 20} fontSize="8" fontFamily="Segoe UI" fill="#0369a1">1: R·Q²</text>

      {/* Кривая 3: активизированная характеристика ШВС h_т + R·Q² */}
      <path d={activPath} fill="none" stroke="#dc2626" strokeWidth="1.4" strokeDasharray="4 2" />
      <text x={sx(qMaxPos * 0.62)} y={sy(hT + R * (qMaxPos * 0.62) ** 2) - 4} fontSize="8" fontFamily="Segoe UI" fill="#dc2626">3: h_т+R·Q²</text>

      {/* Кривая 2: линия тепловой депрессии h_т */}
      <line x1={padL} x2={padL + W} y1={sy(hT)} y2={sy(hT)} stroke="#c2410c" strokeWidth="1" strokeDasharray="6 3" />
      <text x={padL + 4} y={sy(hT) - 3} fontSize="8" fontFamily="Segoe UI" fill="#c2410c">2: h_т = {hT.toFixed(0)} Па</text>

      {/* Граница критической депрессии h_кр */}
      {hKr !== undefined && hKr > 0 && (
        <line x1={padL} x2={padL + W} y1={sy(hKr)} y2={sy(hKr)} stroke="#7c3aed" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.7" />
      )}

      {/* Точка A — до пожара */}
      <g>
        <line x1={A.x} y1={A.y} x2={A.x} y2={padT + H} stroke="#0369a1" strokeWidth="0.6" strokeDasharray="3 2" opacity="0.5" />
        <circle cx={A.x} cy={A.y} r="4" fill="#0369a1" stroke="white" strokeWidth="1.2" />
        <text x={A.x + 6} y={A.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#0369a1">A</text>
      </g>

      {/* Точка B — при пожаре */}
      <g>
        <line x1={B.x} y1={B.y} x2={B.x} y2={padT + H} stroke="#dc2626" strokeWidth="0.6" strokeDasharray="3 2" opacity="0.5" />
        <circle cx={B.x} cy={B.y} r="4" fill="#dc2626" stroke="white" strokeWidth="1.2" />
        <text x={B.x + 6} y={B.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#dc2626">B</text>
      </g>

      {/* Точка C — критическая (Q = 0) */}
      <g>
        <circle cx={C.x} cy={C.y} r="4" fill="#7c3aed" stroke="white" strokeWidth="1.2" />
        <text x={C.x + 6} y={C.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#7c3aed">C</text>
      </g>

      {/* Точка D — опрокидывание (Q < 0) */}
      {D && (
        <g>
          <line x1={D.x} y1={D.y} x2={D.x} y2={padT + H} stroke="#450a0a" strokeWidth="0.6" strokeDasharray="3 2" opacity="0.5" />
          <circle cx={D.x} cy={D.y} r="4.5" fill="#450a0a" stroke="white" strokeWidth="1.2" />
          <text x={D.x + 6} y={D.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#450a0a">D</text>
        </g>
      )}
    </svg>
  );
}