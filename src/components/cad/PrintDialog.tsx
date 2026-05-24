import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";

interface PrintDialogProps {
  onClose: () => void;
  // SVG-разметка схемы для печати (можно получить из canvas)
  schemaSvg?: string;
  projectName?: string;
}

type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0" | "custom";
type Orientation = "portrait" | "landscape";

// Размеры в мм
const PAPER_SIZES: Record<Exclude<PaperFormat, "custom">, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

export default function PrintDialog({ onClose, schemaSvg, projectName = "Проект" }: PrintDialogProps) {
  const [format, setFormat] = useState<PaperFormat>("A1");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [customW, setCustomW] = useState<number>(594);
  const [customH, setCustomH] = useState<number>(841);
  const [scale, setScale] = useState<number>(100);    // % от Fit to page
  const [margin, setMargin] = useState<number>(10);   // мм
  const [showStamp, setShowStamp] = useState<boolean>(true);
  const [showFrame, setShowFrame] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [tiling, setTiling] = useState<boolean>(false); // разбивка большой схемы на A4-листы
  const [copies, setCopies] = useState<number>(1);
  const [drawingNumber, setDrawingNumber] = useState<string>("ВН-001");
  const [drawingTitle, setDrawingTitle] = useState<string>(projectName);
  const [engineer, setEngineer] = useState<string>("");
  const [approvedBy, setApprovedBy] = useState<string>("");
  const [organization, setOrganization] = useState<string>("");
  const [printDate, setPrintDate] = useState<string>(() => new Date().toLocaleDateString("ru"));

  const paper = useMemo(() => {
    if (format === "custom") return { w: customW, h: customH };
    const s = PAPER_SIZES[format];
    return orientation === "landscape" ? { w: s.h, h: s.w } : s;
  }, [format, orientation, customW, customH]);

  const handlePrint = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      alert("Не удалось открыть окно печати. Разрешите всплывающие окна в браузере.");
      return;
    }

    const svgContent = schemaSvg || document.querySelector("svg")?.outerHTML || "<div>Схема недоступна</div>";

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${drawingTitle} — ${drawingNumber}</title>
<style>
  @page {
    size: ${paper.w}mm ${paper.h}mm;
    margin: ${margin}mm;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Arial', sans-serif; background: white; color: #000; }
  .page {
    width: ${paper.w - margin * 2}mm;
    height: ${paper.h - margin * 2}mm;
    position: relative;
    page-break-after: always;
    background: white;
  }
  .page:last-child { page-break-after: auto; }
  .frame {
    position: absolute; inset: 0;
    border: 2px solid #000;
  }
  .schema-area {
    position: absolute;
    top: ${showFrame ? 4 : 0}mm;
    left: ${showFrame ? 24 : 0}mm;
    right: ${showFrame ? 4 : 0}mm;
    bottom: ${showStamp ? 60 : (showFrame ? 4 : 0)}mm;
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
  }
  .schema-area svg { width: 100%; height: 100%; max-width: 100%; max-height: 100%; }
  .stamp {
    position: absolute;
    bottom: 0; right: 0;
    width: 185mm; height: 55mm;
    border: 1.5px solid #000;
    display: grid;
    grid-template-columns: 7mm 17mm 23mm 15mm 10mm 70mm 15mm 10mm 18mm;
    grid-template-rows: repeat(8, 5mm) 15mm;
    font-size: 9pt;
  }
  .stamp .cell {
    border-right: 0.5px solid #000;
    border-bottom: 0.5px solid #000;
    padding: 1mm 2mm;
    display: flex; align-items: center;
    overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis;
  }
  .stamp .cell-title {
    font-size: 7pt; color: #555;
    align-items: flex-start; padding-top: 0.5mm;
  }
  .stamp .row-title {
    grid-column: 1 / 10;
    text-align: center;
    font-size: 11pt; font-weight: bold;
    justify-content: center;
    border-bottom: 1.5px solid #000;
  }
  .title-block {
    position: absolute; top: ${showFrame ? 6 : 2}mm;
    left: 28mm;
    font-size: 10pt; font-weight: bold;
  }
  .grid-overlay {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(0,0,0,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0,0,0,0.04) 1px, transparent 1px);
    background-size: 10mm 10mm;
    pointer-events: none;
  }
  .vert-label {
    position: absolute; left: 0; top: 50%;
    transform: translateY(-50%) rotate(-90deg); transform-origin: left top;
    font-size: 8pt;
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${Array.from({ length: copies }, (_, c) => `
  <div class="page">
    ${showFrame ? '<div class="frame"></div>' : ''}
    ${showGrid ? '<div class="grid-overlay"></div>' : ''}
    <div class="title-block">${drawingTitle} ${copies > 1 ? `· экз. ${c + 1}/${copies}` : ''}</div>
    <div class="schema-area" style="transform: scale(${scale / 100}); transform-origin: center;">
      ${svgContent}
    </div>
    ${showStamp ? `
    <div class="stamp">
      <div class="cell cell-title">Изм.</div>
      <div class="cell cell-title">Лист</div>
      <div class="cell cell-title">№ докум.</div>
      <div class="cell cell-title">Подп.</div>
      <div class="cell cell-title">Дата</div>
      <div class="cell" style="grid-row: 1 / 9; flex-direction: column; align-items: flex-start; font-size: 11pt; font-weight: bold; padding: 2mm;">
        <div style="font-size: 8pt; color: #666; font-weight: normal;">Наименование</div>
        <div style="margin-top: 2mm; font-size: 12pt;">${drawingTitle}</div>
      </div>
      <div class="cell cell-title">Стадия</div>
      <div class="cell cell-title">Лист</div>
      <div class="cell cell-title">Листов</div>

      <div class="cell">Разраб.</div>
      <div class="cell">${engineer || ''}</div>
      <div class="cell"></div>
      <div class="cell"></div>
      <div class="cell">${printDate}</div>
      <div class="cell" style="grid-row: 9 / 10; font-weight: bold; font-size: 10pt; justify-content: center;">${organization}</div>
      <div class="cell" style="grid-row: 2 / 3;">Р</div>
      <div class="cell" style="grid-row: 2 / 3;">1</div>
      <div class="cell" style="grid-row: 2 / 3;">1</div>

      <div class="cell">Пров.</div>
      <div class="cell">${approvedBy || ''}</div>
      <div class="cell"></div>
      <div class="cell"></div>
      <div class="cell">${printDate}</div>
      <div class="cell" style="grid-row: 3 / 9; font-size: 9pt; padding: 2mm;" colspan="3">Чертёж № ${drawingNumber}</div>
      <div class="cell"></div><div class="cell"></div><div class="cell"></div>

      <div class="cell">Н.контр.</div>
      <div class="cell"></div><div class="cell"></div><div class="cell"></div><div class="cell"></div>
      <div class="cell"></div><div class="cell"></div><div class="cell"></div>

      <div class="cell">Утв.</div>
      <div class="cell"></div><div class="cell"></div><div class="cell"></div><div class="cell"></div>
      <div class="cell"></div><div class="cell"></div><div class="cell"></div>
    </div>` : ''}
    <div class="vert-label">${format === 'custom' ? `${customW}×${customH} мм` : `Формат ${format} (${orientation === 'landscape' ? 'альбомная' : 'книжная'})`} · Масштаб ${scale}%</div>
  </div>
`).join('')}
<script>
  window.onload = function() {
    setTimeout(function() {
      window.print();
    }, 250);
  };
</script>
</body>
</html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  // Превью соотношения сторон листа
  const previewRatio = paper.w / paper.h;
  const previewW = previewRatio > 1 ? 200 : 200 * previewRatio;
  const previewH = previewRatio > 1 ? 200 / previewRatio : 200;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-lg shadow-2xl border border-gray-300 flex flex-col"
        style={{ width: 760, maxHeight: "92vh", fontFamily: "Segoe UI, Arial, sans-serif" }}>

        {/* Шапка */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200"
          style={{ background: "linear-gradient(180deg,#f5f5f5,#e8e8e8)" }}>
          <div className="flex items-center gap-2">
            <Icon name="Printer" size={16} className="text-blue-600" />
            <span className="font-semibold text-[13px] text-gray-800">Печать чертежа</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-6 hover:bg-red-500 hover:text-white rounded flex items-center justify-center text-xs">✕</button>
        </div>

        {/* Контент: 2 колонки */}
        <div className="flex-1 overflow-y-auto flex">
          {/* Левая колонка — настройки */}
          <div className="flex-1 p-4 border-r border-gray-200 space-y-4 text-[12px]">

            {/* Формат бумаги */}
            <div>
              <div className="font-semibold text-gray-700 mb-1.5 pb-1 border-b border-gray-200">Формат листа</div>
              <div className="grid grid-cols-6 gap-1">
                {(["A4","A3","A2","A1","A0","custom"] as PaperFormat[]).map(f => (
                  <button key={f}
                    onClick={() => setFormat(f)}
                    className="h-7 px-2 rounded border text-[11px] font-medium"
                    style={{
                      background: format === f ? "#2563eb" : "white",
                      color: format === f ? "white" : "#374151",
                      borderColor: format === f ? "#2563eb" : "#c8c8c8",
                    }}>
                    {f === "custom" ? "Свой" : f}
                  </button>
                ))}
              </div>
              {format === "custom" && (
                <div className="flex gap-2 mt-2">
                  <label className="flex-1">
                    <span className="text-[10px] text-gray-500">Ширина, мм</span>
                    <input type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value) || 0)}
                      className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                  </label>
                  <label className="flex-1">
                    <span className="text-[10px] text-gray-500">Высота, мм</span>
                    <input type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value) || 0)}
                      className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                  </label>
                </div>
              )}
              {format !== "custom" && (
                <div className="flex gap-1 mt-2">
                  <button onClick={() => setOrientation("portrait")}
                    className="flex-1 h-7 rounded border text-[11px] flex items-center justify-center gap-1"
                    style={{
                      background: orientation === "portrait" ? "#dbeafe" : "white",
                      borderColor: orientation === "portrait" ? "#2563eb" : "#c8c8c8",
                    }}>
                    <Icon name="RectangleVertical" size={12} /> Книжная
                  </button>
                  <button onClick={() => setOrientation("landscape")}
                    className="flex-1 h-7 rounded border text-[11px] flex items-center justify-center gap-1"
                    style={{
                      background: orientation === "landscape" ? "#dbeafe" : "white",
                      borderColor: orientation === "landscape" ? "#2563eb" : "#c8c8c8",
                    }}>
                    <Icon name="RectangleHorizontal" size={12} /> Альбомная
                  </button>
                </div>
              )}
              <div className="text-[10px] text-gray-500 mt-1.5">
                Итоговый размер: <b>{paper.w} × {paper.h} мм</b>
              </div>
            </div>

            {/* Масштаб и поля */}
            <div>
              <div className="font-semibold text-gray-700 mb-1.5 pb-1 border-b border-gray-200">Масштабирование</div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="text-[10px] text-gray-500">Масштаб печати, %</span>
                  <input type="number" value={scale} min={10} max={400}
                    onChange={(e) => setScale(Math.max(10, Math.min(400, Number(e.target.value) || 100)))}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Поля, мм</span>
                  <input type="number" value={margin} min={0} max={50}
                    onChange={(e) => setMargin(Math.max(0, Math.min(50, Number(e.target.value) || 10)))}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
              </div>
              <div className="flex gap-1 mt-2">
                {[25, 50, 75, 100, 150, 200].map(s => (
                  <button key={s} onClick={() => setScale(s)}
                    className="flex-1 h-6 text-[10px] rounded border border-gray-300 hover:bg-blue-50"
                    style={scale === s ? { background: "#dbeafe", borderColor: "#2563eb" } : {}}>
                    {s}%
                  </button>
                ))}
              </div>
            </div>

            {/* Штамп */}
            <div>
              <div className="font-semibold text-gray-700 mb-1.5 pb-1 border-b border-gray-200">Основная надпись (штамп ГОСТ 2.104)</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2">
                  <span className="text-[10px] text-gray-500">Наименование чертежа</span>
                  <input type="text" value={drawingTitle} onChange={(e) => setDrawingTitle(e.target.value)}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">№ чертежа</span>
                  <input type="text" value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Дата</span>
                  <input type="text" value={printDate} onChange={(e) => setPrintDate(e.target.value)}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Разработал</span>
                  <input type="text" value={engineer} onChange={(e) => setEngineer(e.target.value)}
                    placeholder="Фамилия И.О."
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Проверил</span>
                  <input type="text" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)}
                    placeholder="Фамилия И.О."
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label className="col-span-2">
                  <span className="text-[10px] text-gray-500">Организация</span>
                  <input type="text" value={organization} onChange={(e) => setOrganization(e.target.value)}
                    placeholder="ООО «Рудник»"
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
              </div>
            </div>

            {/* Опции */}
            <div>
              <div className="font-semibold text-gray-700 mb-1.5 pb-1 border-b border-gray-200">Элементы чертежа</div>
              <div className="space-y-1.5">
                {[
                  { key: "frame", label: "Рамка чертежа", val: showFrame, set: setShowFrame },
                  { key: "stamp", label: "Основная надпись (штамп)", val: showStamp, set: setShowStamp },
                  { key: "legend", label: "Условные обозначения", val: showLegend, set: setShowLegend },
                  { key: "grid", label: "Координатная сетка", val: showGrid, set: setShowGrid },
                  { key: "tiling", label: "Разбивка на листы A4 (для обычного принтера)", val: tiling, set: setTiling },
                ].map(o => (
                  <label key={o.key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={o.val} onChange={(e) => o.set(e.target.checked)}
                      style={{ width: 13, height: 13, accentColor: "#2563eb" }} />
                    <span className="text-[11px] text-gray-700">{o.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Копии */}
            <div>
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-gray-700">Количество экземпляров:</span>
                <input type="number" value={copies} min={1} max={50}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className="w-16 h-7 px-2 border border-gray-300 rounded text-[12px]" />
              </label>
            </div>
          </div>

          {/* Правая колонка — превью */}
          <div className="w-[280px] p-4 bg-gray-50 flex flex-col">
            <div className="text-[11px] font-semibold text-gray-600 mb-2 uppercase tracking-wide">Предпросмотр</div>
            <div className="flex-1 flex items-center justify-center">
              <div
                style={{
                  width: previewW,
                  height: previewH,
                  background: "white",
                  border: "1px solid #aaa",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  position: "relative",
                }}>
                {showFrame && (
                  <div style={{ position: "absolute", inset: 4, border: "1.5px solid #333" }} />
                )}
                <div style={{
                  position: "absolute",
                  top: showFrame ? 6 : 2,
                  left: showFrame ? 8 : 4,
                  fontSize: 7,
                  color: "#555",
                  fontWeight: 600,
                }}>
                  {drawingTitle}
                </div>
                <div style={{
                  position: "absolute",
                  top: "30%", left: "10%",
                  fontSize: 6, color: "#888",
                }}>
                  [ область схемы ]
                </div>
                {showStamp && (
                  <div style={{
                    position: "absolute",
                    bottom: showFrame ? 6 : 2,
                    right: showFrame ? 6 : 2,
                    width: "60%", height: 24,
                    border: "1px solid #333",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 6,
                    background: "#fafafa",
                    color: "#444",
                  }}>
                    штамп ГОСТ 2.104
                  </div>
                )}
              </div>
            </div>
            <div className="text-[10px] text-gray-500 mt-3 text-center leading-snug">
              {format === "custom"
                ? `Свой формат ${customW}×${customH} мм`
                : `${format} ${orientation === "landscape" ? "альбомная" : "книжная"}`}
              <br/>
              Масштаб: {scale}% · Поля: {margin} мм
            </div>
          </div>
        </div>

        {/* Футер */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-gray-200 bg-gray-50">
          <div className="text-[11px] text-gray-500">
            <Icon name="Info" size={11} className="inline mr-1 text-blue-500" />
            Для широкоформатных принтеров укажите формат A0/A1 и проверьте поддержку принтером
          </div>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="h-8 px-4 text-[12px] border border-gray-300 rounded hover:bg-gray-100">
              Отмена
            </button>
            <button onClick={handlePrint}
              className="h-8 px-5 text-[12px] rounded text-white font-medium flex items-center gap-1.5"
              style={{ background: "#2563eb" }}>
              <Icon name="Printer" size={13} /> Печать
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
