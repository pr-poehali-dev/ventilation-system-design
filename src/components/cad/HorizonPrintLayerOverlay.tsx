// Слой печати горизонта: рамка, заголовок, блок УТВЕРЖДАЮ, нижний штамп по ГОСТ
// Рендерится поверх PrintPreviewCanvas как абсолютный div
import { type HorizonPrintLayer } from "@/lib/topology";
import React from "react";

interface Props {
  layer: HorizonPrintLayer;
  width: number;
  height: number;
}

const S = "#111";

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
    name: "Устье вертикальной выработки",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><rect x={14} y={8} width={20} height={24} fill="none" stroke={S} strokeWidth={1.5}/><line x1={14} y1={8} x2={34} y2={32} stroke={S} strokeWidth={1}/><line x1={34} y1={8} x2={14} y2={32} stroke={S} strokeWidth={1}/></svg>,
  },
  {
    name: "Блоковый запасной выход",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><rect x={4} y={12} width={10} height={16} fill="#222"/><rect x={16} y={12} width={10} height={16} fill="#ffd600"/><rect x={28} y={12} width={10} height={16} fill="#222"/></svg>,
  },
  {
    name: "Звуковая аварийная сигнализация",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><polygon points="8,14 22,14 30,8 30,32 22,26 8,26" fill="none" stroke={S} strokeWidth={1.5}/><path d="M32 14 Q40 20 32 26" fill="none" stroke={S} strokeWidth={1.5}/></svg>,
  },
  {
    name: "Общешахтный запасной выход",
    svg: <svg width={32} height={28} viewBox="0 0 48 40"><rect x={4} y={12} width={10} height={16} fill="#111"/><rect x={16} y={12} width={10} height={16} fill="#111"/><rect x={28} y={12} width={10} height={16} fill="#111"/></svg>,
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

export default function HorizonPrintLayerOverlay({ layer, width, height }: Props) {
  const sc = width / 794;
  const fs = (mm: number) => mm * sc * 3.78;

  const padOuter = fs(5);   // внешний отступ рамки
  const padInner = fs(20);  // внутренний отступ (левый под подшивку)
  const padRight = fs(5);
  const padTop   = fs(5);
  const padBot   = fs(5);

  // Нижний штамп по ГОСТ 21.101 (185×55 мм)
  const stampH   = layer.showStamp ? fs(55) : 0;
  const stampW   = fs(185);
  const stampX   = width - padRight - stampW;
  const stampY   = height - padBot - stampH;

  // УО — левее штампа или у левого края
  const legendW  = layer.showLegend ? fs(70) : 0;
  const legendX  = padInner;
  const legendY  = height - padBot - stampH - (layer.showLegend ? fs(6) : 0);

  // Блок «УТВЕРЖДАЮ» — правый верхний угол, ширина ~80мм
  const apprW    = fs(80);
  const apprX    = width - padRight - apprW;
  const apprY    = padTop + fs(2);

  // Заголовок чертежа — по центру, ниже верхней рамки
  const titleX   = padInner + (stampX - padInner) / 2;
  const titleY   = padTop + fs(20);

  const lw  = Math.max(0.4, sc * 0.8);
  const lwB = Math.max(0.7, sc * 1.5);
  const font = "Arial, sans-serif";

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>

        {/* ── Рамки чертежа ── */}
        {/* Внешняя */}
        <rect x={padOuter} y={padOuter}
          width={width - padOuter * 2} height={height - padOuter * 2}
          fill="none" stroke={S} strokeWidth={lwB} />
        {/* Внутренняя (с увеличенным левым полем для подшивки 20мм) */}
        <rect x={padInner} y={padTop}
          width={width - padInner - padRight} height={height - padTop - padBot}
          fill="none" stroke={S} strokeWidth={lwB} />

        {/* ── Заголовок чертежа ── */}
        {layer.title && (
          <text x={titleX} y={titleY}
            textAnchor="middle" fontSize={fs(7)} fontFamily={font} fontWeight="bold" fill={S}>
            {layer.title}
          </text>
        )}
        {layer.period && (
          <text x={titleX} y={titleY + fs(9)}
            textAnchor="middle" fontSize={fs(4)} fontFamily={font} fill={S}>
            {layer.period}
          </text>
        )}

        {/* ── Блок «УТВЕРЖДАЮ» — правый верхний угол ── */}
        {/* Рамка блока */}
        <rect x={apprX - fs(2)} y={apprY - fs(2)}
          width={apprW + fs(2)} height={fs(40)}
          fill="white" stroke={S} strokeWidth={lw} />

        <text x={apprX + apprW / 2} y={apprY + fs(3)}
          textAnchor="middle" fontSize={fs(4)} fontFamily={font} fontWeight="bold" fill={S}>
          УТВЕРЖДАЮ
        </text>

        {/* Должность */}
        {layer.approverTitle && layer.approverTitle.split("\n").map((line, i) => (
          <text key={i} x={apprX + apprW / 2} y={apprY + fs(9) + i * fs(4.5)}
            textAnchor="middle" fontSize={fs(3.2)} fontFamily={font} fill={S}>
            {line}
          </text>
        ))}

        {/* Организация */}
        {layer.orgName && layer.orgName.split("\n").map((line, i) => (
          <text key={i} x={apprX + apprW / 2} y={apprY + fs(18) + i * fs(4)}
            textAnchor="middle" fontSize={fs(3.2)} fontFamily={font} fill={S}>
            {line}
          </text>
        ))}

        {/* Линия для подписи */}
        <line x1={apprX + fs(2)} y1={apprY + fs(28)}
          x2={apprX + apprW - fs(2)} y2={apprY + fs(28)}
          stroke={S} strokeWidth={lw} />
        {layer.approverName && (
          <text x={apprX + apprW / 2} y={apprY + fs(32)}
            textAnchor="middle" fontSize={fs(3.2)} fontFamily={font} fill={S}>
            {layer.approverName}
          </text>
        )}

        {/* Дата */}
        <text x={apprX + apprW - fs(2)} y={apprY + fs(38)}
          textAnchor="end" fontSize={fs(3)} fontFamily={font} fill={S}>
          «___» ____________ {layer.year || new Date().getFullYear()} г.
        </text>

        {/* ── Нижний штамп по ГОСТ 21.101 ── */}
        {layer.showStamp && (() => {
          // Колонки штампа (ширина в мм от общей ширины 185мм):
          // Изм | Кол.уч | Лист | №докум | Подпись | Дата || Наименование | Стадия | Лист | Масштаб
          // 7   | 10     | 7    | 15     | 15      | 10   || 80           | 15     | 8    | 13
          const cols = [7, 10, 7, 15, 15, 10, 80, 15, 8, 13].map(mm => fs(mm));
          const rows = [fs(8), fs(8), fs(8), fs(8), fs(8), fs(8), fs(7)]; // 6 строк + заголовок
          const totalH = rows.reduce((a, b) => a + b, 0);
          const totalW = cols.reduce((a, b) => a + b, 0);

          // Накопленные позиции колонок
          const cx: number[] = [];
          cols.reduce((acc, w) => { cx.push(acc); return acc + w; }, 0);
          // Накопленные позиции строк
          const ry2: number[] = [];
          rows.reduce((acc, h2) => { ry2.push(acc); return acc + h2; }, 0);

          const cell = (col: number, row: number, text: string, bold = false, center = true) => {
            const x2 = stampX + cx[col] + cols[col] / 2;
            const y2 = stampY + ry2[row] + rows[row] * 0.62;
            return (
              <text key={`${col}-${row}`}
                x={center ? x2 : stampX + cx[col] + fs(1)}
                y={y2}
                textAnchor={center ? "middle" : "start"}
                fontSize={fs(2.8)} fontFamily={font} fontWeight={bold ? "bold" : "normal"} fill={S}>
                {text}
              </text>
            );
          };

          return (
            <g>
              {/* Внешний контур */}
              <rect x={stampX} y={stampY} width={totalW} height={totalH}
                fill="white" stroke={S} strokeWidth={lwB} />

              {/* Горизонтальные линии строк */}
              {ry2.slice(1).map((y2, i) => (
                <line key={`hr${i}`}
                  x1={stampX} y1={stampY + y2}
                  x2={stampX + totalW} y2={stampY + y2}
                  stroke={S} strokeWidth={lw} />
              ))}

              {/* Вертикальные линии колонок */}
              {cx.slice(1).map((x2, i) => {
                // Колонки 0-5 идут на всю высоту (строки 0-5), колонки 6-9 — только строки 4-6
                const x3 = stampX + x2;
                if (i < 5) {
                  return <line key={`vc${i}`} x1={x3} y1={stampY} x2={x3} y2={stampY + totalH} stroke={S} strokeWidth={lw} />;
                } else {
                  // Объединяем верхние строки 0-3 в одну ячейку для наименования
                  const splitY = stampY + ry2[4];
                  return <line key={`vc${i}`} x1={x3} y1={splitY} x2={x3} y2={stampY + totalH} stroke={S} strokeWidth={lw} />;
                }
              })}

              {/* Горизонтальная линия разделяющая верхние строки от нижних в правой части */}
              <line x1={stampX + cx[6]} y1={stampY + ry2[4]} x2={stampX + totalW} y2={stampY + ry2[4]}
                stroke={S} strokeWidth={lw} />

              {/* Заголовки колонок (строка 0) */}
              {cell(0, 0, "Изм.")}
              {cell(1, 0, "Кол.уч.")}
              {cell(2, 0, "Лист")}
              {cell(3, 0, "№ докум.")}
              {cell(4, 0, "Подпись")}
              {cell(5, 0, "Дата")}

              {/* Строка 1: Разработал/Нач.УПВ */}
              {cell(0, 1, "Нач. УПВ", false, false)}
              {cell(6, 1, "", false, false)}

              {/* Строка 2: Проверил */}
              {cell(0, 2, "РР Бланов", false, false)}

              {/* Подписанты */}
              {layer.developer && cell(0, 1, `Нач. УПВ`, false, false)}
              {layer.developer && cell(1, 1, layer.developer, false, false)}
              {layer.checker  && cell(0, 2, layer.checker,   false, false)}

              {/* Правая часть — большой блок наименования (строки 0-3) */}
              <foreignObject x={stampX + cx[6] + fs(1)} y={stampY + fs(1)}
                width={cols[6] - fs(2)} height={ry2[4] - fs(2)}>
                <div style={{ fontSize: fs(3.5), fontFamily: font, color: S, lineHeight: 1.3, wordBreak: "break-word" }}>
                  {layer.orgName && <div style={{ fontWeight: "bold", marginBottom: fs(1) }}>{layer.orgName}</div>}
                  {layer.title && <div>{layer.title}{layer.period ? `. ${layer.period}` : ""}</div>}
                </div>
              </foreignObject>

              {/* Стадия */}
              {cell(7, 4, "Стадия")}
              {cell(8, 4, "Лист")}
              {cell(9, 4, "Масштаб")}

              {/* Значения */}
              {cell(7, 5, "", false)}
              {cell(8, 5, layer.sheetNum || "1", true)}
              {cell(9, 5, layer.scale || "1:2000", true)}

              {/* Строка организации */}
              {cell(6, 4, layer.orgName || "", false, false)}
              {cell(6, 5, layer.title || "", false, false)}
              {cell(6, 6, layer.period || "Нормальный режим проветривания", false, false)}

              {/* Заголовки нижней части */}
              {cell(7, 6, "стадия", false)}
              {cell(8, 6, "лист", false)}
              {cell(9, 6, "масштаб", false)}
            </g>
          );
        })()}

      </svg>

      {/* ── УО — HTML div ── */}
      {layer.showLegend && (
        <div style={{
          position: "absolute",
          left: legendX,
          bottom: padBot + stampH + fs(3),
          width: legendW,
          background: "white",
          border: `${lw}px solid ${S}`,
          padding: `${fs(2)}px ${fs(3)}px`,
          fontFamily: font,
        }}>
          <div style={{ fontSize: fs(4), fontWeight: "bold", marginBottom: fs(2), color: S }}>
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
                <span style={{ fontSize: fs(2.8), color: S, lineHeight: 1.2 }}>
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
