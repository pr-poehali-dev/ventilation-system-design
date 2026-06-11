// Слой печати горизонта: рамка, заголовок, блок УТВЕРЖДАЮ, УО, штамп
// Рендерится поверх PrintPreviewCanvas как абсолютный div
import { useState, useRef, useEffect } from "react";
import { type HorizonPrintLayer } from "@/lib/topology";

interface Props {
  layer: HorizonPrintLayer;
  width: number;
  height: number;
  onChange?: (patch: Partial<HorizonPrintLayer>) => void;
}

// Инлайн-редактирование: двойной клик → input/textarea
function InlineEdit({
  value, onChange, multiline = false, style, textStyle,
}: {
  value: string; onChange: (v: string) => void;
  multiline?: boolean; style?: React.CSSProperties; textStyle?: React.CSSProperties;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);

  const commit = () => { setEditing(false); if (draft !== value) onChange(draft); };

  const inputStyle: React.CSSProperties = {
    ...textStyle,
    background: "rgba(255,253,230,0.97)",
    border: "1.5px solid #f59e0b",
    borderRadius: 2,
    outline: "none",
    resize: "none",
    padding: "1px 3px",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => e.key === "Escape" && setEditing(false)}
          style={{ ...inputStyle, minHeight: 28, display: "block" }}
          rows={Math.max(2, draft.split("\n").length)}
        />
      );
    }
    return (
      <input
        ref={ref as React.Ref<HTMLInputElement>}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={{ ...inputStyle, display: "block" }}
      />
    );
  }

  return (
    <span
      title="Двойной клик для редактирования"
      onDoubleClick={() => setEditing(true)}
      style={{ ...style, cursor: "text", display: "block", minWidth: 20, whiteSpace: "pre-wrap", ...textStyle }}
    >
      {value || <span style={{ color: "#bbb", fontStyle: "italic" }}>—</span>}
    </span>
  );
}

const S = "#333";

// Статический список УО для слоя печати
const LEGEND_ITEMS: { svg: React.ReactNode; name: string }[] = [
  {
    name: "Позиция",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><circle cx={24} cy={20} r={14} fill="none" stroke={S} strokeWidth={1.5}/></svg>,
  },
  {
    name: "Реверсивная позиция",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><circle cx={24} cy={20} r={14} fill="none" stroke="#dc2626" strokeWidth={2}/><circle cx={24} cy={20} r={7} fill="none" stroke="#dc2626" strokeWidth={1.5}/></svg>,
  },
  {
    name: "Станция замера количества воздуха",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><line x1={2} y1={15} x2={46} y2={15} stroke="#dc2626" strokeWidth={3}/><line x1={2} y1={23} x2={46} y2={23} stroke="#dc2626" strokeWidth={3}/></svg>,
  },
  {
    name: "Струя вентиляционная входящая",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><line x1={2} y1={20} x2={38} y2={20} stroke="#dc2626" strokeWidth={2.5}/><polygon points="36,14 46,20 36,26" fill="#dc2626"/></svg>,
  },
  {
    name: "Струя вентиляционная исходящая",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><line x1={2} y1={20} x2={38} y2={20} stroke="#2196f3" strokeWidth={2.5}/><polygon points="12,14 2,20 12,26" fill="#2196f3"/></svg>,
  },
  {
    name: "Устье вертикальной выработки (квадратное)",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><rect x={14} y={8} width={20} height={24} fill="none" stroke={S} strokeWidth={1.5}/><line x1={14} y1={8} x2={34} y2={32} stroke={S} strokeWidth={1}/><line x1={34} y1={8} x2={14} y2={32} stroke={S} strokeWidth={1}/></svg>,
  },
  {
    name: "Блоковый запасной выход",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><rect x={4} y={12} width={10} height={16} fill="#222"/><rect x={16} y={12} width={10} height={16} fill="#ffd600"/><rect x={28} y={12} width={10} height={16} fill="#222"/></svg>,
  },
  {
    name: "Звуковая аварийная сигнализация",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><polygon points="8,14 22,14 30,8 30,32 22,26 8,26" fill="none" stroke={S} strokeWidth={1.5}/><path d="M32 14 Q40 20 32 26" fill="none" stroke={S} strokeWidth={1.5}/><path d="M34 10 Q46 20 34 30" fill="none" stroke={S} strokeWidth={1.5}/></svg>,
  },
  {
    name: "Общешахтный запасной выход",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><rect x={4} y={12} width={10} height={16} fill="#111"/><rect x={16} y={12} width={10} height={16} fill="#111"/><rect x={28} y={12} width={10} height={16} fill="#111"/></svg>,
  },
  {
    name: "Считыватель системы позиционирования",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><circle cx={24} cy={20} r={10} fill="none" stroke={S} strokeWidth={1.5}/><path d="M10 12 Q24 4 38 12" fill="none" stroke={S} strokeWidth={1.5}/><path d="M6 8 Q24 -2 42 8" fill="none" stroke={S} strokeWidth={1.5}/></svg>,
  },
  {
    name: "Дверь вентиляционная с регулируемым окном (металлическая)",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><line x1={4} y1={20} x2={44} y2={20} stroke={S} strokeWidth={1.5}/><rect x={14} y={8} width={20} height={24} fill="none" stroke="#9c27b0" strokeWidth={2}/><rect x={19} y={13} width={10} height={14} fill="#9c27b0" opacity={0.4}/></svg>,
  },
  {
    name: "Камера хранения противопожарных материалов",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><circle cx={24} cy={20} r={12} fill="none" stroke={S} strokeWidth={1.5}/><text x={24} y={25} textAnchor="middle" fontSize={12} fontWeight="bold" fill={S}>П</text></svg>,
  },
  {
    name: "Место установки огнетушителей",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><circle cx={24} cy={20} r={12} fill="none" stroke="#dc2626" strokeWidth={1.5}/><circle cx={24} cy={20} r={6} fill="none" stroke="#dc2626" strokeWidth={1.5}/></svg>,
  },
  {
    name: "Место установки телефона",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><circle cx={24} cy={20} r={12} fill="none" stroke={S} strokeWidth={1.5}/><text x={24} y={25} textAnchor="middle" fontSize={11} fontWeight="bold" fill={S}>T</text></svg>,
  },
];

export default function HorizonPrintLayerOverlay({ layer, width, height, onChange }: Props) {
  // Масштаб относительно A4 (794px при 96dpi)
  const sc = width / 794;
  const fs = (mm: number) => mm * sc * 3.78; // мм → px при 96dpi

  const pad = fs(8);
  const stampH = layer.showStamp ? fs(55) : 0;
  const legendW = layer.showLegend ? fs(70) : 0;
  const legendX = pad;
  const stampX = legendW > 0 ? legendX + legendW + fs(4) : legendX;
  const stampY = height - pad - stampH;
  const stampW = width - stampX - pad;

  // Блок УТВЕРЖДАЮ: ширина ~75мм, правый верхний угол
  const apprW = fs(75);
  const apprX = width - pad - apprW;
  const apprY = pad + fs(2);

  const titleY = pad + fs(6);
  const lw = Math.max(0.5, sc * 0.6);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: layer.showApprover && onChange ? "auto" : "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/* Внешняя рамка */}
        <rect x={pad * 0.5} y={pad * 0.5} width={width - pad} height={height - pad}
          fill="none" stroke="#333" strokeWidth={Math.max(1, sc * 2)} />
        {/* Внутренняя рамка (отступ 5мм) */}
        <rect x={pad} y={pad} width={width - pad * 2} height={height - pad * 2}
          fill="none" stroke="#333" strokeWidth={Math.max(0.5, sc)} />

        {/* Заголовок */}
        {layer.title && (
          <text
            x={width / 2} y={titleY + fs(12)}
            textAnchor="middle"
            fontSize={fs(8)} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
            {layer.title}
          </text>
        )}
      </svg>

      {/* ── Блок УТВЕРЖДАЮ — HTML для редактирования ── */}
      {layer.showApprover && (
        <div style={{
          position: "absolute",
          right: pad,
          top: apprY,
          width: apprW,
          fontFamily: "Arial, sans-serif",
          fontSize: fs(3.2),
          color: "#111",
          textAlign: "center",
          lineHeight: 1.5,
          pointerEvents: onChange ? "auto" : "none",
        }}>
          {/* УТВЕРЖДАЮ */}
          <div style={{ fontWeight: "bold", fontSize: fs(3.8), marginBottom: fs(1) }}>
            УТВЕРЖДАЮ
          </div>
          {/* Должность (многострочная) */}
          <InlineEdit
            value={layer.approverTitle || "Должность"}
            onChange={v => onChange?.({ approverTitle: v })}
            multiline
            textStyle={{ fontSize: fs(3.2), textAlign: "center", color: "#111" }}
          />
          {/* Организация (многострочная) */}
          <InlineEdit
            value={layer.orgName || "Организация"}
            onChange={v => onChange?.({ orgName: v })}
            multiline
            textStyle={{ fontSize: fs(3.2), textAlign: "center", color: "#111" }}
          />
          {/* Линия + ФИО */}
          <div style={{ borderTop: `${lw}px solid #111`, margin: `${fs(2)}px ${fs(4)}px ${fs(0.5)}px` }} />
          <InlineEdit
            value={layer.approverName || "И.О. Фамилия"}
            onChange={v => onChange?.({ approverName: v })}
            textStyle={{ fontSize: fs(3.2), textAlign: "right", color: "#111", paddingRight: fs(1) }}
          />
          {/* Дата */}
          <div style={{ borderTop: `${lw}px solid #111`, margin: `${fs(1.5)}px 0 ${fs(0.5)}px` }} />
          <div style={{ display: "flex", alignItems: "center", gap: fs(1), fontSize: fs(3.2) }}>
            <span>«</span>
            <InlineEdit
              value={layer.year || "_____"}
              onChange={v => onChange?.({ year: v })}
              textStyle={{ fontSize: fs(3.2), width: fs(10), textAlign: "center", color: "#111" }}
            />
            <span>»</span>
            <span style={{ flexGrow: 1, borderBottom: `${lw}px solid #111`, minWidth: fs(20) }} />
            <span>г.</span>
          </div>
        </div>
      )}

      {/* ── SVG: штамп ── */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>

        {/* ── Штамп (угловой штамп) ── */}
        {layer.showStamp && (
          <g transform={`translate(${stampX},${stampY})`}>
            {/* Внешний прямоугольник штампа */}
            <rect x={0} y={0} width={stampW} height={stampH} fill="white" stroke="#333" strokeWidth={Math.max(0.5, sc)} />

            {/* Строки штампа — горизонтальные разделители */}
            {[1, 2, 3, 4, 5, 6].map(i => (
              <line key={i} x1={0} y1={i * (stampH / 7)} x2={stampW} y2={i * (stampH / 7)}
                stroke="#333" strokeWidth={Math.max(0.3, sc * 0.4)} />
            ))}
            {/* Вертикальные разделители в верхней части */}
            {[0.25, 0.5, 0.67, 0.83].map((t, i) => (
              <line key={i} x1={stampW * t} y1={0} x2={stampW * t} y2={stampH * 5 / 7}
                stroke="#333" strokeWidth={Math.max(0.3, sc * 0.4)} />
            ))}
            {/* Разделители нижней части */}
            <line x1={stampW * 0.4} y1={stampH * 5 / 7} x2={stampW * 0.4} y2={stampH} stroke="#333" strokeWidth={Math.max(0.3, sc * 0.4)} />
            <line x1={stampW * 0.7} y1={stampH * 5 / 7} x2={stampW * 0.7} y2={stampH} stroke="#333" strokeWidth={Math.max(0.3, sc * 0.4)} />

            {/* Лейблы верхних строк */}
            {["Изм.", "Кол. уч.", "Лист", "№ док.", "Подпись", "Дата"].map((t, i) => (
              <text key={i} x={stampW * ([0, 0.25, 0.5, 0.67, 0.83, 1.0][i] + (i < 5 ? 0.125 : 0)) / 1}
                y={stampH * 6 / 7 + fs(2)}
                textAnchor="middle" fontSize={fs(2.5)} fontFamily="Arial, sans-serif" fill="#333">
                {t}
              </text>
            ))}

            {/* Разработал / Проверил */}
            {layer.developer && (
              <text x={fs(2)} y={stampH * 3 / 7 + fs(3)} fontSize={fs(2.8)} fontFamily="Arial, sans-serif" fill="#333">
                Разработал: {layer.developer}
              </text>
            )}
            {layer.checker && (
              <text x={fs(2)} y={stampH * 4 / 7 + fs(3)} fontSize={fs(2.8)} fontFamily="Arial, sans-serif" fill="#333">
                Проверил: {layer.checker}
              </text>
            )}

            {/* Название организации */}
            {layer.orgName && (
              <text x={stampW * 0.55} y={stampH * 5.5 / 7} textAnchor="middle"
                fontSize={fs(3)} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
                {layer.orgName}
              </text>
            )}

            {/* Заголовок в штампе */}
            {layer.title && (
              <foreignObject x={stampW * 0.4 + fs(1)} y={stampH * 5 / 7 + fs(1)}
                width={stampW * 0.3 - fs(2)} height={stampH * 2 / 7 - fs(2)}>
                <div style={{
                  fontSize: fs(3), fontFamily: "Arial, sans-serif", color: "#111",
                  lineHeight: 1.2, wordBreak: "break-word",
                }}>
                  {layer.title}
                  {layer.period && <><br />{layer.period}</>}
                </div>
              </foreignObject>
            )}

            {/* Масштаб */}
            <text x={stampW * 0.85} y={stampH * 5.5 / 7}
              textAnchor="middle" fontSize={fs(2.5)} fontFamily="Arial, sans-serif" fill="#333">
              Масштаб
            </text>
            <text x={stampW * 0.85} y={stampH * 6 / 7}
              textAnchor="middle" fontSize={fs(3)} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
              {layer.scale || "1:2000"}
            </text>

            {/* Лист / Листов */}
            <text x={stampW * 0.55} y={stampH * 6.5 / 7}
              textAnchor="middle" fontSize={fs(2.5)} fontFamily="Arial, sans-serif" fill="#333">
              Лист
            </text>
            <text x={stampW * 0.85} y={stampH * 6.5 / 7}
              textAnchor="middle" fontSize={fs(2.5)} fontFamily="Arial, sans-serif" fill="#333">
              Листов
            </text>
            <text x={stampW * 0.55} y={stampH * 7 / 7 - fs(1)}
              textAnchor="middle" fontSize={fs(4)} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
              {layer.sheetNum}
            </text>
            <text x={stampW * 0.85} y={stampH * 7 / 7 - fs(1)}
              textAnchor="middle" fontSize={fs(4)} fontFamily="Arial, sans-serif" fontWeight="bold" fill="#111">
              {layer.sheetTotal}
            </text>
          </g>
        )}
      </svg>

      {/* УО — HTML div с иконками и подписями */}
      {layer.showLegend && (
        <div style={{
          position: "absolute",
          left: legendX,
          bottom: pad + stampH + fs(2),
          width: legendW,
          background: "white",
          border: `${Math.max(0.5, sc * 0.5)}px solid #333`,
          padding: `${fs(2)}px ${fs(3)}px`,
          fontFamily: "Arial, sans-serif",
        }}>
          <div style={{ fontSize: fs(4), fontWeight: "bold", marginBottom: fs(2), color: "#111" }}>
            Условные обозначения
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: fs(1) }}>
            {LEGEND_ITEMS.map((item, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: fs(2) }}>
                <div style={{ flexShrink: 0, width: 32 * sc * 0.9, height: 28 * sc * 0.9, display: "flex", alignItems: "center" }}>
                  <div style={{ transform: `scale(${sc * 0.9})`, transformOrigin: "left center" }}>
                    {item.svg}
                  </div>
                </div>
                <span style={{ fontSize: fs(2.8), color: "#333", lineHeight: 1.2 }}>
                  {item.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}