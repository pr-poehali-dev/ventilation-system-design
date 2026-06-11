// Слой печати горизонта: рамка, заголовок, блок УТВЕРЖДАЮ, нижний штамп, УО
// Поддерживает редактирование прямо в рабочей области (двойной клик по тексту)
import { useState, useRef, useEffect } from "react";
import { type HorizonPrintLayer } from "@/lib/topology";

interface Props {
  layer: HorizonPrintLayer;
  width: number;
  height: number;
  onChange?: (patch: Partial<HorizonPrintLayer>) => void;
}

const C = "#111";
const FONT = "Arial, sans-serif";

// Список УО для слоя печати
const LEGEND_ITEMS: { svg: React.ReactNode; name: string }[] = [
  { name: "Позиция ПЛА", svg: <svg width={32} height={24} viewBox="0 0 48 36"><circle cx={24} cy={18} r={13} fill="none" stroke={C} strokeWidth={1.5}/></svg> },
  { name: "Реверсивная позиция", svg: <svg width={32} height={24} viewBox="0 0 48 36"><circle cx={24} cy={18} r={13} fill="none" stroke="#dc2626" strokeWidth={2}/><circle cx={24} cy={18} r={6} fill="none" stroke="#dc2626" strokeWidth={1.5}/></svg> },
  { name: "Станция замера воздуха", svg: <svg width={32} height={24} viewBox="0 0 48 36"><line x1={2} y1={13} x2={46} y2={13} stroke="#dc2626" strokeWidth={3}/><line x1={2} y1={21} x2={46} y2={21} stroke="#dc2626" strokeWidth={3}/></svg> },
  { name: "Струя входящая", svg: <svg width={32} height={24} viewBox="0 0 48 36"><line x1={2} y1={18} x2={38} y2={18} stroke="#dc2626" strokeWidth={2.5}/><polygon points="36,12 46,18 36,24" fill="#dc2626"/></svg> },
  { name: "Струя исходящая", svg: <svg width={32} height={24} viewBox="0 0 48 36"><line x1={2} y1={18} x2={38} y2={18} stroke="#2196f3" strokeWidth={2.5}/><polygon points="12,12 2,18 12,24" fill="#2196f3"/></svg> },
  { name: "Устье ствола (квадратное)", svg: <svg width={32} height={24} viewBox="0 0 48 36"><rect x={14} y={6} width={20} height={24} fill="none" stroke={C} strokeWidth={1.5}/><line x1={14} y1={6} x2={34} y2={30} stroke={C} strokeWidth={1}/><line x1={34} y1={6} x2={14} y2={30} stroke={C} strokeWidth={1}/></svg> },
  { name: "Блоковый запасной выход", svg: <svg width={32} height={24} viewBox="0 0 48 36"><rect x={4} y={10} width={10} height={16} fill="#222"/><rect x={16} y={10} width={10} height={16} fill="#ffd600"/><rect x={28} y={10} width={10} height={16} fill="#222"/></svg> },
  { name: "Аварийная сигнализация", svg: <svg width={32} height={24} viewBox="0 0 48 36"><polygon points="8,12 22,12 30,6 30,30 22,24 8,24" fill="none" stroke={C} strokeWidth={1.5}/><path d="M32 12 Q40 18 32 24" fill="none" stroke={C} strokeWidth={1.5}/></svg> },
  { name: "Общешахтный запасной выход", svg: <svg width={32} height={24} viewBox="0 0 48 36"><rect x={4} y={10} width={10} height={16} fill="#111"/><rect x={16} y={10} width={10} height={16} fill="#111"/><rect x={28} y={10} width={10} height={16} fill="#111"/></svg> },
  { name: "Огнетушитель", svg: <svg width={32} height={24} viewBox="0 0 48 36"><circle cx={24} cy={18} r={11} fill="none" stroke="#dc2626" strokeWidth={1.5}/><circle cx={24} cy={18} r={5} fill="none" stroke="#dc2626" strokeWidth={1.5}/></svg> },
  { name: "Телефон / связь", svg: <svg width={32} height={24} viewBox="0 0 48 36"><circle cx={24} cy={18} r={11} fill="none" stroke={C} strokeWidth={1.5}/><text x={24} y={23} textAnchor="middle" fontSize={11} fontWeight="bold" fill={C}>T</text></svg> },
  { name: "Противопожарные материалы", svg: <svg width={32} height={24} viewBox="0 0 48 36"><circle cx={24} cy={18} r={11} fill="none" stroke={C} strokeWidth={1.5}/><text x={24} y={23} textAnchor="middle" fontSize={12} fontWeight="bold" fill={C}>П</text></svg> },
];

// Компонент инлайн-редактирования текста (двойной клик → textarea)
function EditableText({
  value, onChange, style, className,
  as: Tag = "span",
  multiline = false,
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  className?: string;
  as?: "span" | "div";
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); (ref.current as HTMLTextAreaElement).select(); } }, [editing]);

  const commit = () => { setEditing(false); onChange(draft); };

  if (editing) {
    const base: React.CSSProperties = {
      ...style,
      background: "#fffde7",
      border: "1.5px solid #f59e0b",
      borderRadius: 2,
      outline: "none",
      resize: "none",
      fontFamily: style?.fontFamily ?? FONT,
      fontSize: style?.fontSize,
      fontWeight: style?.fontWeight,
      color: style?.color ?? C,
      padding: "1px 3px",
      minWidth: 80,
      width: "100%",
      boxSizing: "border-box" as const,
    };
    if (multiline) {
      return (
        <textarea ref={ref as React.Ref<HTMLTextAreaElement>}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Escape") { setEditing(false); } }}
          style={{ ...base, minHeight: 40 }}
          rows={3}
        />
      );
    }
    return (
      <input ref={ref as React.Ref<HTMLInputElement>}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        style={base}
      />
    );
  }

  return (
    <Tag
      className={className}
      title="Двойной клик для редактирования"
      onDoubleClick={() => setEditing(true)}
      style={{
        ...style,
        cursor: onChange ? "text" : "default",
        borderBottom: onChange ? "1px dashed #bbb" : "none",
        display: "inline-block",
        minWidth: 40,
        whiteSpace: "pre-wrap",
      }}
    >
      {value || <span style={{ color: "#bbb", fontStyle: "italic" }}>—</span>}
    </Tag>
  );
}

export default function HorizonPrintLayerOverlay({ layer, width, height, onChange }: Props) {
  const sc = width / 794;
  const fs = (mm: number) => mm * sc * 3.78;

  const upd = onChange
    ? (patch: Partial<HorizonPrintLayer>) => onChange(patch)
    : undefined;

  const pad     = fs(8);
  const padLeft = fs(20); // левое поле увеличено под подшивку

  // ── Нижний штамп по ГОСТ 21.101 ──────────────────────────────────────────
  // Штамп: ширина 185мм, высота 55мм (в пикселях)
  const stH   = layer.showStamp ? fs(55) : 0;
  const stW   = Math.min(fs(185), width - padLeft - pad);
  const stX   = width - pad - stW;
  const stY   = height - pad - stH;

  // УО — левее штампа
  const legW  = layer.showLegend ? fs(72) : 0;
  const legX  = padLeft;
  const legBottom = pad + stH + fs(3);

  // Блок "УТВЕРЖДАЮ" — правый верхний угол, ширина ~80мм
  const apW   = fs(82);
  const apX   = width - pad - apW;
  const apY   = pad + fs(3);

  // Заголовок чертежа — левее блока УТВЕРЖДАЮ
  const titX  = padLeft + fs(4);
  const titY  = pad + fs(6);

  const lw    = Math.max(0.4, sc * 0.8);
  const lwB   = Math.max(1, sc * 1.8);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: onChange ? "auto" : "none", userSelect: "none" }}>

      {/* ── SVG: рамки + линии штампа ── */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {/* Внешняя рамка */}
        <rect x={pad * 0.4} y={pad * 0.4} width={width - pad * 0.8} height={height - pad * 0.8}
          fill="none" stroke={C} strokeWidth={lwB} />
        {/* Внутренняя рамка (левое поле 20мм — для подшивки) */}
        <rect x={padLeft} y={pad} width={width - padLeft - pad} height={height - pad * 2}
          fill="none" stroke={C} strokeWidth={lwB} />

        {/* ── Нижний штамп — линии ── */}
        {layer.showStamp && (() => {
          // Строки (снизу вверх): 2 строки по 8мм + 3 строки по 8мм + шапка 7мм
          // Колонки: Изм(7) | Кол(10) | Лист(7) | №докум(15) | Подпись(15) | Дата(10) || Наим(80) | Стадия(15) | Лист(8) | Масштаб(13)
          const cols  = [7,10,7,15,15,10,80,15,8,13].map(mm => fs(mm));
          const rowH  = fs(8);
          const rows  = 6;
          // Накопленные X позиции колонок
          const cx: number[] = [];
          cols.reduce((a, w) => { cx.push(stX + a); return a + w; }, 0);
          const totalW = cols.reduce((a, b) => a + b, 0);

          return <>
            {/* Внешний контур */}
            <rect x={stX} y={stY} width={totalW} height={stH} fill="white" stroke={C} strokeWidth={lwB} />
            {/* Горизонтальные строки */}
            {Array.from({ length: rows - 1 }, (_, i) => (
              <line key={`sr${i}`} x1={stX} y1={stY + (i + 1) * rowH} x2={stX + totalW} y2={stY + (i + 1) * rowH}
                stroke={C} strokeWidth={lw} />
            ))}
            {/* Вертикальные разделители первых 6 колонок — на всю высоту */}
            {cx.slice(1, 6).map((x, i) => (
              <line key={`vc${i}`} x1={x} y1={stY} x2={x} y2={stY + stH} stroke={C} strokeWidth={lw} />
            ))}
            {/* Вертикальные разделители правой части (колонки 6-9) — только нижние 3 строки */}
            {cx.slice(6).map((x, i) => (
              <line key={`vr${i}`} x1={x} y1={stY + rowH * 3} x2={x} y2={stY + stH}
                stroke={C} strokeWidth={lw} />
            ))}
            {/* Горизонтальная линия разделяющая левую и правую части сверху */}
            <line x1={cx[6]} y1={stY} x2={cx[6]} y2={stY + rowH * 3} stroke={C} strokeWidth={lw} />
            {/* Шапка левой части (Изм / Кол / ...) */}
            {["Изм.", "Кол.уч.", "Лист", "№ докум.", "Подпись", "Дата"].map((t, i) => (
              <text key={t} x={cx[i] + cols[i] / 2} y={stY + rowH * 0.7}
                textAnchor="middle" fontSize={fs(2.3)} fontFamily={FONT} fill={C}>{t}</text>
            ))}
            {/* Шапка правой части */}
            {[["Стадия", 7], ["Лист", 8], ["Масштаб", 9]].map(([t, ci]) => (
              <text key={t as string} x={cx[ci as number] + cols[ci as number] / 2} y={stY + rowH * 3.7}
                textAnchor="middle" fontSize={fs(2.3)} fontFamily={FONT} fill={C}>{t}</text>
            ))}
          </>;
        })()}
      </svg>

      {/* ── HTML: редактируемые блоки поверх SVG ── */}

      {/* Заголовок чертежа */}
      <div style={{
        position: "absolute",
        left: titX,
        top: titY,
        width: apX - titX - fs(4),
        fontFamily: FONT,
      }}>
        <EditableText
          as="div"
          value={layer.title || ""}
          onChange={v => upd?.({ title: v })}
          multiline
          style={{ fontSize: fs(7), fontWeight: "bold", color: C, lineHeight: 1.2 }}
        />
        {layer.period !== undefined && (
          <EditableText
            as="div"
            value={layer.period}
            onChange={v => upd?.({ period: v })}
            style={{ fontSize: fs(3.5), color: "#444", marginTop: fs(2) }}
          />
        )}
      </div>

      {/* Блок УТВЕРЖДАЮ */}
      <div style={{
        position: "absolute",
        left: apX,
        top: apY,
        width: apW,
        border: `${lw}px solid ${C}`,
        background: "white",
        padding: `${fs(2)}px ${fs(3)}px`,
        fontFamily: FONT,
        boxSizing: "border-box",
      }}>
        <div style={{ fontWeight: "bold", fontSize: fs(3.8), textAlign: "center", marginBottom: fs(2), color: C }}>
          УТВЕРЖДАЮ
        </div>
        <EditableText
          as="div"
          value={layer.approverTitle || ""}
          onChange={v => upd?.({ approverTitle: v })}
          multiline
          style={{ fontSize: fs(3), color: C, marginBottom: fs(1), textAlign: "center" }}
        />
        <EditableText
          as="div"
          value={layer.orgName || ""}
          onChange={v => upd?.({ orgName: v })}
          multiline
          style={{ fontSize: fs(3), color: C, marginBottom: fs(2), textAlign: "center" }}
        />
        <div style={{ borderTop: `${lw}px solid ${C}`, marginTop: fs(2), marginBottom: fs(1) }} />
        <EditableText
          as="div"
          value={layer.approverName || ""}
          onChange={v => upd?.({ approverName: v })}
          style={{ fontSize: fs(3), color: C, textAlign: "center" }}
        />
        <div style={{ fontSize: fs(3), color: C, marginTop: fs(2), textAlign: "right" }}>
          «___» ______ <EditableText
            value={layer.year || String(new Date().getFullYear())}
            onChange={v => upd?.({ year: v })}
            style={{ fontSize: fs(3), color: C, width: fs(12), display: "inline-block" }}
          /> г.
        </div>
      </div>

      {/* ── Нижний штамп — редактируемые ячейки ── */}
      {layer.showStamp && (() => {
        const cols   = [7,10,7,15,15,10,80,15,8,13].map(mm => fs(mm));
        const rowH   = fs(8);
        const stTotalW = cols.reduce((a, b) => a + b, 0);
        const cx: number[] = [];
        cols.reduce((a, w) => { cx.push(a); return a + w; }, 0);

        const Cell = ({ col, row, value, field, bold = false, placeholder = "" }: {
          col: number; row: number; value: string;
          field: keyof HorizonPrintLayer; bold?: boolean; placeholder?: string;
        }) => (
          <div style={{
            position: "absolute",
            left: stX + cx[col],
            top: stY + row * rowH,
            width: cols[col],
            height: rowH,
            display: "flex", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
            boxSizing: "border-box",
            padding: `0 ${fs(0.5)}px`,
          }}>
            <EditableText
              value={value}
              onChange={v => upd?.({ [field]: v } as Partial<HorizonPrintLayer>)}
              style={{
                fontSize: fs(2.8), fontFamily: FONT, color: C,
                fontWeight: bold ? "bold" : "normal",
                textAlign: "center", width: "100%",
              }}
            />
          </div>
        );

        const StaticCell = ({ col, row, text, span = 1 }: { col: number; row: number; text: string; span?: number }) => {
          const w = cols.slice(col, col + span).reduce((a, b) => a + b, 0);
          return (
            <div style={{
              position: "absolute",
              left: stX + cx[col],
              top: stY + row * rowH,
              width: w,
              height: rowH,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: fs(2.3), fontFamily: FONT, color: C,
              overflow: "hidden",
            }}>
              {text}
            </div>
          );
        };

        return (
          <div style={{ position: "absolute", left: stX, top: stY, width: stTotalW, height: stH }}>
            {/* Строка 1: Нач.УПВ — имя */}
            <StaticCell col={0} row={1} text="Нач. УПВ" />
            <Cell col={1} row={1} value={layer.developer || ""} field="developer" placeholder="Фамилия И.О." />

            {/* Строка 2: РР */}
            <Cell col={1} row={2} value={layer.checker || ""} field="checker" placeholder="Фамилия И.О." />

            {/* Правая часть — большой блок наименования (строки 0-2) */}
            <div style={{
              position: "absolute",
              left: cx[6],
              top: 0,
              width: cols[6],
              height: rowH * 3,
              display: "flex", flexDirection: "column", justifyContent: "center",
              padding: `${fs(1)}px ${fs(2)}px`,
              boxSizing: "border-box",
            }}>
              <EditableText
                as="div"
                value={layer.orgName || ""}
                onChange={v => upd?.({ orgName: v })}
                style={{ fontSize: fs(3), fontFamily: FONT, color: C, fontWeight: "bold", marginBottom: fs(1) }}
                multiline
              />
              <EditableText
                as="div"
                value={layer.title || ""}
                onChange={v => upd?.({ title: v })}
                style={{ fontSize: fs(3), fontFamily: FONT, color: C }}
                multiline
              />
            </div>

            {/* Строка 3 правая: шапки Стадия/Лист/Масштаб — статика */}

            {/* Строка 4: значения Стадия/Лист/Масштаб */}
            <Cell col={7} row={4} value="" field="sheetNum" />
            <Cell col={8} row={4} value={layer.sheetNum || "1"} field="sheetNum" bold />
            <Cell col={9} row={4} value={layer.scale || "1:2000"} field="scale" bold />

            {/* Строка 3: название в правой части */}
            <div style={{
              position: "absolute",
              left: cx[6],
              top: rowH * 3,
              width: cols[6],
              height: rowH,
              display: "flex", alignItems: "center",
              padding: `0 ${fs(2)}px`,
              boxSizing: "border-box",
            }}>
              <EditableText
                value={layer.title || ""}
                onChange={v => upd?.({ title: v })}
                style={{ fontSize: fs(2.8), fontFamily: FONT, color: C }}
              />
            </div>

            {/* Строка 5: период / режим */}
            <div style={{
              position: "absolute",
              left: cx[6],
              top: rowH * 5,
              width: cols[6],
              height: rowH,
              display: "flex", alignItems: "center",
              padding: `0 ${fs(2)}px`,
              boxSizing: "border-box",
            }}>
              <EditableText
                value={layer.period || "Нормальный режим проветривания"}
                onChange={v => upd?.({ period: v })}
                style={{ fontSize: fs(2.8), fontFamily: FONT, color: C }}
              />
            </div>

            {/* Организация в строке 4 правой */}
            <div style={{
              position: "absolute",
              left: cx[6],
              top: rowH * 4,
              width: cols[6],
              height: rowH,
              display: "flex", alignItems: "center",
              padding: `0 ${fs(2)}px`,
              boxSizing: "border-box",
            }}>
              <EditableText
                value={layer.orgName || ""}
                onChange={v => upd?.({ orgName: v })}
                style={{ fontSize: fs(2.8), fontFamily: FONT, color: C, fontWeight: "bold" }}
              />
            </div>
          </div>
        );
      })()}

      {/* ── Блок "Условные обозначения" ── */}
      {layer.showLegend && (
        <div style={{
          position: "absolute",
          left: legX,
          bottom: legBottom,
          width: legW,
          background: "white",
          border: `${lw}px solid ${C}`,
          padding: `${fs(2)}px ${fs(3)}px`,
          fontFamily: FONT,
          boxSizing: "border-box",
        }}>
          <div style={{ fontSize: fs(3.5), fontWeight: "bold", marginBottom: fs(2), color: C }}>
            Условные обозначения
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: fs(1) }}>
            {LEGEND_ITEMS.map((item, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: fs(2) }}>
                <div style={{ flexShrink: 0, width: fs(8.5), height: fs(7), display: "flex", alignItems: "center" }}>
                  <div style={{ transform: `scale(${sc * 0.9})`, transformOrigin: "left center" }}>
                    {item.svg}
                  </div>
                </div>
                <span style={{ fontSize: fs(2.8), color: C, lineHeight: 1.2 }}>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
