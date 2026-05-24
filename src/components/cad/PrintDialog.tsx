import { useState, useMemo, useEffect, useRef } from "react";
import Icon from "@/components/ui/icon";

interface PrintDialogProps {
  onClose: () => void;
  getSvg?: () => string;
  projectName?: string;
}

type PaperFormat = "A4" | "A3" | "A2" | "A1" | "A0" | "custom";
type Orientation = "portrait" | "landscape";

const PAPER_SIZES: Record<Exclude<PaperFormat, "custom">, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

export default function PrintDialog({ onClose, getSvg, projectName = "Проект" }: PrintDialogProps) {
  const [format, setFormat] = useState<PaperFormat>("A1");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [customW, setCustomW] = useState<number>(594);
  const [customH, setCustomH] = useState<number>(841);
  const [scale, setScale] = useState<number>(100);
  const [margin, setMargin] = useState<number>(10);
  const [showStamp, setShowStamp] = useState<boolean>(true);
  const [showFrame, setShowFrame] = useState<boolean>(true);
  const [showLegend, setShowLegend] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [tiling, setTiling] = useState<boolean>(false);
  const [copies, setCopies] = useState<number>(1);
  const [drawingNumber, setDrawingNumber] = useState<string>("ВН-001");
  const [drawingTitle, setDrawingTitle] = useState<string>(projectName);
  const [engineer, setEngineer] = useState<string>("");
  const [approvedBy, setApprovedBy] = useState<string>("");
  const [organization, setOrganization] = useState<string>("");
  const [printDate] = useState<string>(() => new Date().toLocaleDateString("ru"));

  // Захват SVG для превью
  const [svgDataUrl, setSvgDataUrl] = useState<string>("");
  const previewContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getSvg) return;
    try {
      const svgStr = getSvg();
      if (!svgStr) return;
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      setSvgDataUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch { /* noop */ }
  }, [getSvg]);

  const paper = useMemo(() => {
    if (format === "custom") return { w: customW, h: customH };
    const s = PAPER_SIZES[format];
    return orientation === "landscape" ? { w: s.h, h: s.w } : s;
  }, [format, orientation, customW, customH]);

  const handlePrint = () => {
    const svgContent = getSvg ? getSvg() : "";
    const win = window.open("", "_blank", "width=1200,height=900");
    if (!win) {
      alert("Разрешите всплывающие окна в браузере для печати.");
      return;
    }

    const stampHtml = showStamp ? `
      <table class="stamp" cellpadding="0" cellspacing="0">
        <tr>
          <td colspan="5" class="col-changes"></td>
          <td rowspan="8" class="col-name">${drawingTitle}</td>
          <td class="col-stage">Стадия</td>
          <td class="col-sheet">Лист</td>
          <td class="col-total">Листов</td>
        </tr>
        <tr>
          <td>Разраб.</td><td>${engineer}</td><td></td><td></td><td>${printDate}</td>
          <td rowspan="6" class="org-cell">${organization}</td>
          <td>Р</td><td>1</td><td>1</td>
        </tr>
        <tr>
          <td>Пров.</td><td>${approvedBy}</td><td></td><td></td><td>${printDate}</td>
          <td rowspan="5" colspan="3" class="num-cell">${drawingNumber}</td>
        </tr>
        <tr><td>Н.контр.</td><td></td><td></td><td></td><td></td></tr>
        <tr><td>Утв.</td><td></td><td></td><td></td><td></td></tr>
        <tr><td colspan="5"></td></tr>
        <tr><td colspan="5"></td></tr>
        <tr><td colspan="5"></td></tr>
      </table>` : "";

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${drawingTitle}</title>
<style>
@page { size: ${paper.w}mm ${paper.h}mm; margin: ${margin}mm; }
*{box-sizing:border-box;margin:0;padding:0;}
body{background:white;font-family:Arial,sans-serif;font-size:10pt;}
.page{
  width:${paper.w - margin*2}mm;
  height:${paper.h - margin*2}mm;
  position:relative;
  page-break-after:always;
  overflow:hidden;
}
.page:last-child{page-break-after:auto;}
.frame{position:absolute;top:4mm;left:20mm;right:4mm;bottom:${showStamp?"62mm":"4mm"};border:1.5px solid #000;}
.schema-wrap{
  position:absolute;
  top:${showFrame?"6mm":"2mm"};
  left:${showFrame?"22mm":"2mm"};
  right:${showFrame?"6mm":"2mm"};
  bottom:${showStamp?(showFrame?"65mm":"62mm"):(showFrame?"6mm":"2mm")};
  display:flex;align-items:center;justify-content:center;
  overflow:hidden;
}
.schema-wrap svg{
  max-width:100%;max-height:100%;
  transform:scale(${scale/100});transform-origin:center center;
}
.stamp{
  position:absolute;bottom:${showFrame?"5mm":"1mm"};right:${showFrame?"5mm":"1mm"};
  width:185mm;height:55mm;
  border-collapse:collapse;
  border:1.5px solid #000;
  font-size:8pt;
}
.stamp td{
  border:0.5px solid #000;
  padding:1mm 2mm;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.col-name{font-size:12pt;font-weight:bold;text-align:center;width:70mm;}
.col-stage,.col-sheet,.col-total{width:12mm;text-align:center;}
.num-cell{font-size:10pt;font-weight:bold;text-align:center;}
.org-cell{font-size:9pt;text-align:center;}
${showGrid?`.page::before{content:'';position:absolute;inset:0;
  background-image:linear-gradient(to right,rgba(0,0,0,0.05) 1px,transparent 1px),
    linear-gradient(to bottom,rgba(0,0,0,0.05) 1px,transparent 1px);
  background-size:10mm 10mm;pointer-events:none;}`:""}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
${Array.from({length:copies},()=>`
<div class="page">
  ${showFrame?"<div class=\"frame\"></div>":""}
  <div class="schema-wrap">${svgContent}</div>
  ${stampHtml}
</div>`).join("")}
<script>window.onload=()=>setTimeout(()=>window.print(),300);</script>
</body></html>`;

    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  // Размер превью — пропорционально бумаге
  const previewMaxH = 520;
  const previewMaxW = 460;
  const aspect = paper.w / paper.h;
  const previewH = Math.min(previewMaxH, previewMaxW / aspect);
  const previewW = previewH * aspect;

  // Позиции элементов в превью (в пикселях, масштабируем мм → px)
  const mm2px = (mm: number) => mm * (previewW / paper.w);
  const stampH = mm2px(55);
  const stampW = mm2px(185);
  const frameTop = mm2px(4);
  const frameLeft = mm2px(20);
  const frameRight = mm2px(4);
  const frameBottom = showStamp ? mm2px(62) : mm2px(4);
  const schemaTop = showFrame ? frameTop + 2 : mm2px(2);
  const schemaLeft = showFrame ? frameLeft + 2 : mm2px(2);
  const schemaRight = showFrame ? frameRight + 2 : mm2px(2);
  const schemaBottom = showStamp ? frameBottom + 2 : (showFrame ? frameBottom + 2 : mm2px(2));

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-lg shadow-2xl border border-gray-300 flex flex-col"
        style={{ width: 920, maxHeight: "95vh", fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 12 }}>

        {/* Шапка */}
        <div className="flex items-center justify-between px-4 py-2"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)", borderBottom: "1px solid #b8b8b8", borderRadius: "8px 8px 0 0" }}>
          <div className="flex items-center gap-2">
            <Icon name="Printer" size={15} className="text-blue-600" />
            <span className="font-semibold text-[13px]">Печать чертежа</span>
          </div>
          <button onClick={onClose}
            className="w-7 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded">✕</button>
        </div>

        {/* Тело */}
        <div className="flex flex-1 overflow-hidden">
          {/* Левая панель — настройки */}
          <div className="w-[360px] flex-shrink-0 flex flex-col overflow-y-auto p-4 gap-4 border-r border-gray-200">

            {/* Формат */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Формат листа</div>
              <div className="flex gap-1 mb-2">
                {(["A4","A3","A2","A1","A0"] as PaperFormat[]).map(f => (
                  <button key={f} onClick={() => setFormat(f)}
                    className="flex-1 h-7 rounded border text-[11px] font-medium transition-colors"
                    style={{ background: format===f?"#2563eb":"white", color: format===f?"white":"#374151", borderColor: format===f?"#2563eb":"#d1d5db" }}>
                    {f}
                  </button>
                ))}
                <button onClick={() => setFormat("custom")}
                  className="flex-1 h-7 rounded border text-[11px] font-medium transition-colors"
                  style={{ background: format==="custom"?"#2563eb":"white", color: format==="custom"?"white":"#374151", borderColor: format==="custom"?"#2563eb":"#d1d5db" }}>
                  Свой
                </button>
              </div>
              {format === "custom" ? (
                <div className="flex gap-2">
                  <label className="flex-1">
                    <span className="text-[10px] text-gray-500">Ширина, мм</span>
                    <input type="number" value={customW} onChange={e => setCustomW(+e.target.value || 210)}
                      className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                  </label>
                  <label className="flex-1">
                    <span className="text-[10px] text-gray-500">Высота, мм</span>
                    <input type="number" value={customH} onChange={e => setCustomH(+e.target.value || 297)}
                      className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                  </label>
                </div>
              ) : (
                <div className="flex gap-1">
                  {(["portrait","landscape"] as Orientation[]).map(o => (
                    <button key={o} onClick={() => setOrientation(o)}
                      className="flex-1 h-7 rounded border text-[11px] flex items-center justify-center gap-1 transition-colors"
                      style={{ background: orientation===o?"#dbeafe":"white", borderColor: orientation===o?"#2563eb":"#d1d5db" }}>
                      <Icon name={o==="portrait"?"RectangleVertical":"RectangleHorizontal"} size={11} />
                      {o === "portrait" ? "Книжная" : "Альбомная"}
                    </button>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-gray-500 mt-1">
                Итоговый размер: <b>{paper.w} × {paper.h} мм</b>
              </div>
            </div>

            {/* Масштаб */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Масштабирование</div>
              <div className="flex gap-2 mb-2">
                <label className="flex-1">
                  <span className="text-[10px] text-gray-500">Масштаб печати, %</span>
                  <input type="number" value={scale} min={10} max={400}
                    onChange={e => setScale(Math.max(10, Math.min(400, +e.target.value || 100)))}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label className="flex-1">
                  <span className="text-[10px] text-gray-500">Поля, мм</span>
                  <input type="number" value={margin} min={0} max={50}
                    onChange={e => setMargin(Math.max(0, Math.min(50, +e.target.value || 10)))}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
              </div>
              <div className="flex gap-1">
                {[25,50,75,100,150,200].map(s => (
                  <button key={s} onClick={() => setScale(s)}
                    className="flex-1 h-6 text-[10px] rounded border border-gray-200 hover:border-blue-400 transition-colors"
                    style={scale===s?{background:"#dbeafe",borderColor:"#2563eb"}:{}}>
                    {s}%
                  </button>
                ))}
              </div>
            </div>

            {/* Штамп */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Основная надпись (штамп ГОСТ 2.104)</div>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="col-span-2">
                  <span className="text-[10px] text-gray-500">Наименование чертежа</span>
                  <input type="text" value={drawingTitle} onChange={e => setDrawingTitle(e.target.value)}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">№ чертежа</span>
                  <input type="text" value={drawingNumber} onChange={e => setDrawingNumber(e.target.value)}
                    className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Дата</span>
                  <input type="text" value={printDate} readOnly
                    className="w-full h-7 px-2 border border-gray-200 rounded text-[12px] bg-gray-50" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Разработал</span>
                  <input type="text" value={engineer} onChange={e => setEngineer(e.target.value)}
                    placeholder="Фамилия И.О." className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label>
                  <span className="text-[10px] text-gray-500">Проверил</span>
                  <input type="text" value={approvedBy} onChange={e => setApprovedBy(e.target.value)}
                    placeholder="Фамилия И.О." className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
                <label className="col-span-2">
                  <span className="text-[10px] text-gray-500">Организация</span>
                  <input type="text" value={organization} onChange={e => setOrganization(e.target.value)}
                    placeholder="ООО «Рудник»" className="w-full h-7 px-2 border border-gray-300 rounded text-[12px]" />
                </label>
              </div>
            </div>

            {/* Элементы */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Элементы чертежа</div>
              <div className="space-y-1.5">
                {[
                  { v: showFrame, set: setShowFrame, l: "Рамка чертежа" },
                  { v: showStamp, set: setShowStamp, l: "Основная надпись (штамп)" },
                  { v: showLegend, set: setShowLegend, l: "Условные обозначения" },
                  { v: showGrid, set: setShowGrid, l: "Координатная сетка" },
                  { v: tiling, set: setTiling, l: "Разбивка на листы A4 (для обычного принтера)" },
                ].map(o => (
                  <label key={o.l} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={o.v} onChange={e => o.set(e.target.checked)}
                      style={{ width: 13, height: 13, accentColor: "#2563eb" }} />
                    <span className="text-[11px] text-gray-700">{o.l}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Копии */}
            <label className="flex items-center gap-2">
              <span className="text-[11px] text-gray-700">Количество экземпляров:</span>
              <input type="number" value={copies} min={1} max={50}
                onChange={e => setCopies(Math.max(1, Math.min(50, +e.target.value || 1)))}
                className="w-16 h-7 px-2 border border-gray-300 rounded text-[12px]" />
            </label>
          </div>

          {/* Правая панель — превью */}
          <div className="flex-1 flex flex-col items-center justify-center p-4 bg-gray-100">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3">Предпросмотр</div>

            {/* Лист */}
            <div ref={previewContainerRef}
              style={{
                width: previewW, height: previewH,
                background: "white",
                border: "1px solid #999",
                boxShadow: "2px 4px 16px rgba(0,0,0,0.2)",
                position: "relative",
                flexShrink: 0,
              }}>
              {/* Рамка */}
              {showFrame && (
                <div style={{
                  position: "absolute",
                  top: frameTop, left: frameLeft,
                  right: frameRight, bottom: frameBottom,
                  border: "1.5px solid #333",
                  pointerEvents: "none",
                }} />
              )}
              {/* Сетка */}
              {showGrid && (
                <div style={{
                  position: "absolute", inset: 0,
                  backgroundImage: "linear-gradient(to right,rgba(0,0,0,0.07) 1px,transparent 1px),linear-gradient(to bottom,rgba(0,0,0,0.07) 1px,transparent 1px)",
                  backgroundSize: `${mm2px(10)}px ${mm2px(10)}px`,
                  pointerEvents: "none",
                }} />
              )}
              {/* Схема */}
              <div style={{
                position: "absolute",
                top: schemaTop, left: schemaLeft,
                right: schemaRight, bottom: schemaBottom,
                overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {svgDataUrl ? (
                  <img src={svgDataUrl} alt="схема"
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
                      transform: `scale(${scale/100})`, transformOrigin: "center" }} />
                ) : (
                  <div style={{ color: "#aaa", fontSize: 10, textAlign: "center", lineHeight: 1.4 }}>
                    схема загружается…
                  </div>
                )}
              </div>
              {/* Штамп */}
              {showStamp && (
                <div style={{
                  position: "absolute",
                  bottom: showFrame ? mm2px(5) : mm2px(1),
                  right: showFrame ? mm2px(5) : mm2px(1),
                  width: stampW, height: stampH,
                  border: "1px solid #333",
                  display: "flex", flexDirection: "column",
                  justifyContent: "center", alignItems: "center",
                  background: "#fafafa",
                  fontSize: Math.max(5, mm2px(2.5)),
                }}>
                  <div style={{ fontWeight: 600, color: "#333", textAlign: "center", padding: "0 4px", wordBreak: "break-all" }}>
                    {drawingTitle}
                  </div>
                  <div style={{ color: "#666", fontSize: Math.max(4, mm2px(2)) }}>
                    {drawingNumber} · {organization || "Организация"}
                  </div>
                </div>
              )}
            </div>

            <div className="text-[10px] text-gray-500 mt-3 text-center leading-snug">
              {format === "custom" ? `Свой формат ${customW}×${customH} мм` : `${format} ${orientation==="landscape"?"альбомная":"книжная"}`}
              <br/>Масштаб: {scale}% · Поля: {margin} мм
            </div>
          </div>
        </div>

        {/* Футер */}
        <div className="flex justify-between items-center px-4 py-2.5 border-t border-gray-200 bg-gray-50"
          style={{ borderRadius: "0 0 8px 8px" }}>
          <div className="text-[11px] text-gray-500 flex items-center gap-1">
            <Icon name="Info" size={11} className="text-blue-500" />
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
              <Icon name="Printer" size={13} />
              Печать
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
