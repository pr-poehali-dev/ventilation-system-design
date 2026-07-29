// ─────────────────────────────────────────────────────────────────────────────
// h–Q диаграмма проветривания уклонного поля при пожаре (Приложение 2).
// Показывает влияние тепловой депрессии пожара на режим проветривания
// наклонной выработки и границу опрокидывания / критического режима.
//
// ДВА СЦЕНАРИЯ (выбираются пропом ascending):
//
// НИСХОДЯЩЕЕ проветривание (рис. 2.1,б) — тепловая тяга ПРОТИВ потока:
//   Кривая 1 — характеристика уклонного поля h = R·Q²
//   Кривая 2 — линия тепловой депрессии h_т
//   Кривая 3 — активизированная характеристика ШВС: h_т + R·Q²
//   A — режим до пожара · B — при пожаре (расход ПАДАЕТ) ·
//   C — критическая (Q=0) · D — опрокидывание струи (Q<0)
//
// ВОСХОДЯЩЕЕ проветривание (рис. 2.2) — тепловая тяга ПО потоку:
//   Тепловая депрессия сонаправлена с депрессией ВГП → расход РАСТЁТ.
//   A — режим до пожара · E — при пожаре (расход растёт, OT>OM) ·
//   F — критическая (2.4): h_т = R·Q₀², депрессия ВГП = 0 (точка на оси Q) ·
//   K — за F: депрессия ВГП отрицательна (вентилятор как сопротивление).
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  Ry: number;            // сопротивление уклонного поля, Н·с²/м⁸
  Qa: number;            // расход ДО пожара (точка A), м³/с
  Qb: number;            // расход ПРИ пожаре (точка B/E), м³/с (может быть < 0 при опрокидывании)
  hT: number;            // тепловая депрессия пожара, Па (> 0)
  hKr?: number;          // критическая депрессия h_кр, Па (если есть параллель)
  pU?: number;           // показатель устойчивости p_у = h_кр/h_т (Прил. 3, ф. 3.1)
  reversed?: boolean;    // струя опрокинута (режим D)
  ascending?: boolean;   // восходящее проветривание (рис. 2.2) — иначе нисходящее (2.1,б)
  width?: number;
  height?: number;
}

export default function HQFireDiagram({
  Ry, Qa, Qb, hT, hKr, pU, reversed = false, ascending = false, width = 300, height = 210,
}: Props) {
  const padL = 42, padR = 12, padT = 14, padB = 30;
  const W = width - padL - padR;
  const H = height - padT - padB;

  const absQa = Math.abs(Qa);
  const absQb = Math.abs(Qb);
  const R = Math.max(1e-6, Ry);

  // Критический расход Q₀ (точка F, восходящий режим): h_т = R·Q₀²  →  Q₀ = √(h_т/R)
  const Q0 = Math.sqrt(hT / R);

  // ── Диапазон осей ──────────────────────────────────────────────────────────
  // Восходящий: расход растёт вправо (A → E → F → K), отрицательная зона не нужна.
  // Нисходящий: возможна отрицательная зона Q (опрокидывание, точка D).
  const qMaxPos = ascending
    ? Math.max(absQa, absQb, Q0, 1) * 1.2
    : Math.max(absQa, absQb, 1) * 1.15;
  const qMinNeg = ascending
    ? -qMaxPos * 0.08
    : (reversed ? -Math.max(absQb, qMaxPos * 0.4) * 1.1 : -qMaxPos * 0.15);
  const qSpan = qMaxPos - qMinNeg;

  const hActivMax = hT + R * qMaxPos * qMaxPos;
  const hMax = Math.max(hActivMax, hKr ?? 0, hT, R * absQa * absQa, R * absQb * absQb, 1) * 1.1;

  const sx = (q: number) => padL + ((q - qMinNeg) / qSpan) * W;
  const sy = (h: number) => padT + H - (h / hMax) * H;

  // ── Кривые ─────────────────────────────────────────────────────────────────
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

  const x0 = sx(0);

  // ── Точки режимов ────────────────────────────────────────────────────────────
  const hA = R * absQa * absQa;   // до пожара
  const A = { x: sx(absQa), y: sy(hA) };

  // Нисходящий: B (расход падает), C (Q=0), D (опрокидывание)
  const hB = hT + R * absQb * absQb;
  const bQ = reversed ? -absQb : absQb;
  const B = { x: sx(bQ), y: sy(hB) };
  const C = { x: sx(0), y: sy(hKr ?? hT) };
  const D = reversed ? { x: sx(-absQb), y: sy(hT + R * absQb * absQb) } : null;

  // Восходящий: E (расход растёт, на активизированной кривой), F (Q₀ на оси Q), K (за F)
  const E = { x: sx(absQb), y: sy(hT + R * absQb * absQb) };
  const F = { x: sx(Q0), y: sy(hT) };                 // h_т = R·Q₀², депрессия ВГП = 0
  const overF = absQb > Q0 + 0.01;                    // режим за критической точкой F → K
  const K = overF ? { x: sx(absQb), y: sy(hT + R * absQb * absQb) } : null;

  const qTicks = ascending
    ? [0, qMaxPos * 0.5, qMaxPos]
    : [qMinNeg, 0, qMaxPos * 0.5, qMaxPos].filter((v, i, a) => a.indexOf(v) === i);
  const hTicks = [0, hMax * 0.5, hMax];

  const vline = (x: number, y: number, color: string) => (
    <line x1={x} y1={y} x2={x} y2={padT + H} stroke={color} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.5" />
  );

  return (
    <svg width={width} height={height} style={{ background: "#fafafa", border: "1px solid #d0d0d0" }}>
      {/* Сетка */}
      {hTicks.map((h, i) => (
        <line key={`hg${i}`} x1={padL} x2={padL + W} y1={sy(h)} y2={sy(h)} stroke="#ececec" strokeWidth="0.5" />
      ))}
      {/* Ось h (в позиции Q=0) */}
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

      {/* Граница критической депрессии h_кр (нисходящий, при наличии параллели) */}
      {!ascending && hKr !== undefined && hKr > 0 && (
        <line x1={padL} x2={padL + W} y1={sy(hKr)} y2={sy(hKr)} stroke="#7c3aed" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.7" />
      )}

      {/* Точка A — до пожара (общая) */}
      <g>
        {vline(A.x, A.y, "#0369a1")}
        <circle cx={A.x} cy={A.y} r="4" fill="#0369a1" stroke="white" strokeWidth="1.2" />
        <text x={A.x + 6} y={A.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#0369a1">A</text>
      </g>

      {ascending ? (
        <>
          {/* Точка E — режим при пожаре (расход вырос) */}
          <g>
            {vline(E.x, E.y, "#dc2626")}
            <circle cx={E.x} cy={E.y} r="4" fill="#dc2626" stroke="white" strokeWidth="1.2" />
            <text x={E.x + 6} y={E.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#dc2626">E</text>
          </g>
          {/* Точка F — критическая: Q₀, депрессия ВГП = 0 (на оси Q) */}
          <g>
            <circle cx={F.x} cy={F.y} r="4" fill="#7c3aed" stroke="white" strokeWidth="1.2" />
            <text x={F.x + 6} y={F.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#7c3aed">F</text>
          </g>
          {/* Точка K — за F: депрессия ВГП отрицательна */}
          {K && (
            <g>
              {vline(K.x, K.y, "#450a0a")}
              <circle cx={K.x} cy={K.y} r="4.5" fill="#450a0a" stroke="white" strokeWidth="1.2" />
              <text x={K.x + 6} y={K.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#450a0a">K</text>
            </g>
          )}
        </>
      ) : (
        <>
          {/* Точка B — при пожаре (расход упал) */}
          <g>
            {vline(B.x, B.y, "#dc2626")}
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
              {vline(D.x, D.y, "#450a0a")}
              <circle cx={D.x} cy={D.y} r="4.5" fill="#450a0a" stroke="white" strokeWidth="1.2" />
              <text x={D.x + 6} y={D.y - 4} fontSize="10" fontWeight="700" fontFamily="Segoe UI" fill="#450a0a">D</text>
            </g>
          )}
        </>
      )}

      {/* Показатель устойчивости p_у = h_кр/h_т (Прил. 3, ф. 3.1) */}
      {pU !== undefined && (
        <g>
          <rect x={padL + 4} y={padT + 2} width="86" height="14" rx="2"
            fill={pU > 1 ? "#f0fdf4" : pU < 0.3 ? "#450a0a" : "#fffbeb"}
            stroke={pU > 1 ? "#86efac" : pU < 0.3 ? "#7f1d1d" : "#fcd34d"} strokeWidth="0.8" />
          <text x={padL + 8} y={padT + 12} fontSize="9" fontFamily="Segoe UI" fontWeight="700"
            fill={pU > 1 ? "#15803d" : pU < 0.3 ? "#fecaca" : "#b45309"}>
            p_у = {pU.toFixed(2)} {pU > 1 ? "✓" : pU < 0.3 ? "⚠⚠" : "△"}
          </text>
        </g>
      )}
    </svg>
  );
}