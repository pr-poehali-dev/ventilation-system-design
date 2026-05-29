import { useState, useMemo, useEffect, useCallback } from "react";
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

// ─── Мини-секция панели ───────────────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #d8d8d8" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1 px-3 py-1.5 text-left hover:bg-gray-100"
        style={{ fontSize: 12, fontWeight: 700, color: "#111", background: "#e0e0e0", borderBottom: open ? "1px solid #c8c8c8" : "none" }}>
        <span style={{ fontSize: 9, color: "#666" }}>{open ? "▼" : "►"}</span>
        {title}
      </button>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span style={{ width: 90, fontSize: 11, color: "#111", flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const inputCls = "w-full border border-gray-500 px-1.5 rounded text-[12px] text-gray-900 bg-white focus:outline-none focus:border-blue-500";
const inputStyle = { height: 22 };
const selectCls = inputCls + " cursor-pointer";

export default function PrintDialog({ onClose, getSvg, projectName = "Проект" }: PrintDialogProps) {
  // ─── Параметры листа ───────────────────────────────────────────────────────
  const [format, setFormat] = useState<PaperFormat>("A3");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [customW, setCustomW] = useState<number>(420);
  const [customH, setCustomH] = useState<number>(297);

  // ─── Диапазон ─────────────────────────────────────────────────────────────
  const [pageRange, setPageRange] = useState<string>("");
  const [copies, setCopies] = useState<number>(1);
  const [reverseOrder, setReverseOrder] = useState<boolean>(false);

  // ─── Преобразование схемы ─────────────────────────────────────────────────
  const [scale, setScale] = useState<number>(100);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);

  // ─── Поля ────────────────────────────────────────────────────────────────
  const [marginTop, setMarginTop] = useState<number>(5);
  const [marginBottom, setMarginBottom] = useState<number>(5);
  const [marginLeft, setMarginLeft] = useState<number>(5);
  const [marginRight, setMarginRight] = useState<number>(5);

  // ─── Опции ───────────────────────────────────────────────────────────────
  const [showPageNumbers, setShowPageNumbers] = useState<boolean>(true);
  const [showStamp, setShowStamp] = useState<boolean>(false);
  const [showFrame, setShowFrame] = useState<boolean>(false);
  const [tiling, setTiling] = useState<boolean>(false);

  // ─── Штамп ───────────────────────────────────────────────────────────────
  const [drawingNumber, setDrawingNumber] = useState<string>("");
  const [drawingTitle, setDrawingTitle] = useState<string>(projectName);
  const [engineer, setEngineer] = useState<string>("");
  const [approvedBy, setApprovedBy] = useState<string>("");
  const [organization, setOrganization] = useState<string>("");
  const [printDate] = useState<string>(() => new Date().toLocaleDateString("ru"));

  // ─── Шаблоны ─────────────────────────────────────────────────────────────
  const [templateName, setTemplateName] = useState<string>("");
  const [templates, setTemplates] = useState<Record<string, object>>({});

  // ─── Источник предпросмотра ───────────────────────────────────────────────
  // isPng=true  → getSvg() вернул PNG dataUrl (canvas-режим)
  // isPng=false → getSvg() вернул SVG outerHTML (svg-режим)
  const [previewSrc, setPreviewSrc] = useState<string>("");   // итоговый dataUrl для <img>
  const [rawContent, setRawContent] = useState<string>("");   // оригинал для печати/экспорта
  const [selectedPage, setSelectedPage] = useState<number>(0);

  // ─── Диалог экспорта ──────────────────────────────────────────────────────
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png"|"jpg"|"bmp"|"svg"|"pdf">("png");
  const [exportDpi, setExportDpi] = useState(150);
  const [exportQuality, setExportQuality] = useState(95);

  // ─── Захват содержимого схемы ─────────────────────────────────────────────
  useEffect(() => {
    if (!getSvg) return;
    try {
      const raw = getSvg();
      if (!raw) return;
      setRawContent(raw);

      // Определяем тип: PNG dataUrl (canvas-режим) или SVG-строка
      if (raw.startsWith("data:image/png")) {
        // Canvas-режим: уже готовый PNG — показываем напрямую
        setPreviewSrc(raw);
      } else {
        // SVG-режим: нормализуем и конвертируем в PNG через offscreen canvas

        // Парсим размеры
        const vbMatch = raw.match(/viewBox="([^"]+)"/);
        const wMatch  = raw.match(/\s+width="(\d+(?:\.\d+)?)"/);
        const hMatch  = raw.match(/\s+height="(\d+(?:\.\d+)?)"/);
        let svgW = 0, svgH = 0;
        if (vbMatch) {
          const p = vbMatch[1].trim().split(/[\s,]+/).map(Number);
          if (p.length >= 4) { svgW = p[2]; svgH = p[3]; }
        }
        if (svgW <= 0 && wMatch) svgW = parseFloat(wMatch[1]);
        if (svgH <= 0 && hMatch) svgH = parseFloat(hMatch[1]);

        // Нормализованный SVG: убираем px-width/height, задаём % чтобы масштабировался
        const normalized = raw.replace(/<svg([^>]*)>/, (_full, attrs: string) => {
          let a = attrs;
          a = a.replace(/\s+width="[^"]*"/, "");
          a = a.replace(/\s+height="[^"]*"/, "");
          // Если нет viewBox — добавляем из w/h
          if (!vbMatch && svgW > 0 && svgH > 0) {
            a += ` viewBox="0 0 ${svgW} ${svgH}"`;
          }
          return `<svg${a} preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;">`;
        });

        // Рендерим SVG в canvas → PNG dataUrl для надёжного предпросмотра
        const RENDER_W = svgW > 0 ? Math.min(svgW, 2400) : 1600;
        const RENDER_H = svgH > 0 ? Math.round(RENDER_W * svgH / svgW) : 900;

        const blob = new Blob([normalized], { type: "image/svg+xml;charset=utf-8" });
        const blobUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width  = RENDER_W;
          canvas.height = RENDER_H;
          const ctx = canvas.getContext("2d");
          if (!ctx) { setPreviewSrc(blobUrl); return; }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, RENDER_W, RENDER_H);
          ctx.drawImage(img, 0, 0, RENDER_W, RENDER_H);
          URL.revokeObjectURL(blobUrl);
          setPreviewSrc(canvas.toDataURL("image/png"));
        };
        img.onerror = () => {
          // Fallback: показываем blob напрямую
          setPreviewSrc(blobUrl);
        };
        img.src = blobUrl;
      }
    } catch { /* noop */ }
  }, [getSvg]);

  // ─── Экспорт ─────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!rawContent && !previewSrc) return;

    const dpiScale = exportDpi / 96;

    if (exportFormat === "svg") {
      // Экспорт SVG как есть
      const content = rawContent.startsWith("data:image/png")
        ? "" // canvas mode — нет SVG, пропускаем
        : rawContent;
      if (!content) { alert("SVG недоступен в Canvas-режиме. Используйте PNG."); return; }
      const blob = new Blob([content], { type: "image/svg+xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${projectName}.svg`;
      a.click();
      return;
    }

    if (exportFormat === "pdf") {
      // PDF через печать в PDF (системный диалог)
      handlePrint();
      return;
    }

    // Растровые форматы: рисуем через canvas
    const sourceUrl = previewSrc || rawContent;
    if (!sourceUrl) return;

    // Получаем нативные размеры
    const img = new Image();
    await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = sourceUrl; });

    const nativeW = img.naturalWidth  || 1600;
    const nativeH = img.naturalHeight || 900;
    const outW = Math.round(nativeW  * dpiScale);
    const outH = Math.round(nativeH * dpiScale);

    const canvas = document.createElement("canvas");
    canvas.width  = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = exportFormat === "jpg" ? "#ffffff" : "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);

    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", bmp: "image/bmp", tiff: "image/tiff",
    };
    const mime = mimeMap[exportFormat] ?? "image/png";
    const ext  = exportFormat;
    const quality = exportFormat === "jpg" ? exportQuality / 100 : undefined;
    const dataUrl = canvas.toDataURL(mime, quality);

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${projectName}.${ext}`;
    a.click();
    setShowExportDialog(false);
  }, [rawContent, previewSrc, exportFormat, exportDpi, exportQuality, projectName]);

  // ─── Размер бумаги ───────────────────────────────────────────────────────
  const paper = useMemo(() => {
    if (format === "custom") return { w: customW, h: customH };
    const s = PAPER_SIZES[format];
    return orientation === "landscape" ? { w: s.h, h: s.w } : s;
  }, [format, orientation, customW, customH]);

  // Рабочая область (за вычетом полей)
  const workArea = useMemo(() => ({
    w: paper.w - marginLeft - marginRight,
    h: paper.h - marginTop - marginBottom - (showStamp ? 56 : 0),
  }), [paper, marginLeft, marginRight, marginTop, marginBottom, showStamp]);

  // Подобрать масштаб чтобы всё вошло на один лист
  const fitScale = useCallback(() => {
    setScale(100);
    setOffsetX(0);
    setOffsetY(0);
  }, []);

  // Тайлинг: всегда одна страница (упрощённо — многостраничность через масштаб)
  const tiles = useMemo(() => {
    return [{ col: 0, row: 0, x: 0, y: 0 }];
  }, []);

  const totalPages = tiles.length;

  // ─── Подобрать масштаб ───────────────────────────────────────────────────
  const handleFitScale = () => { fitScale(); };

  // ─── Печать ──────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const svg = rawContent || (getSvg ? getSvg() : "");

    const stampHtml = showStamp ? `
      <table class="stamp" cellpadding="0" cellspacing="0">
        <tr>
          <td colspan="5"></td>
          <td rowspan="6" class="col-name">${drawingTitle}</td>
          <td class="col-stage">Стадия</td><td class="col-sheet">Лист</td><td class="col-total">Листов</td>
        </tr>
        <tr>
          <td>Разраб.</td><td>${engineer}</td><td></td><td></td><td>${printDate}</td>
          <td rowspan="5" class="org-cell">${organization}</td>
          <td>Р</td><td>1</td><td>${totalPages}</td>
        </tr>
        <tr>
          <td>Пров.</td><td>${approvedBy}</td><td></td><td></td><td>${printDate}</td>
          <td rowspan="4" colspan="3" class="num-cell">${drawingNumber}</td>
        </tr>
        <tr><td>Н.контр.</td><td></td><td></td><td></td><td></td></tr>
        <tr><td>Утв.</td><td></td><td></td><td></td><td></td></tr>
        <tr><td colspan="5"></td></tr>
      </table>` : "";

    const scaleFactor = scale / 100;

    const pageHtmlArr = tiles.map((tile, idx) => {
      const pageNum = idx + 1;
      const tileSvgW = workArea.w / scaleFactor;
      const tileSvgH = workArea.h / scaleFactor;
      const vbX = tile.x + offsetX;
      const vbY = tile.y + offsetY;

      // Перезаписываем viewBox чтобы показать только эту плитку
      const adjustedSvg = svg.replace(
        /<svg([^>]*)>/,
        `<svg$1 viewBox="${vbX} ${vbY} ${tileSvgW} ${tileSvgH}" preserveAspectRatio="xMinYMin meet" width="${workArea.w}mm" height="${workArea.h}mm">`
      );

      return `
<div class="page">
  ${showFrame ? '<div class="frame"></div>' : ''}
  <div class="schema-wrap">${adjustedSvg}</div>
  ${stampHtml}
  ${showPageNumbers ? `<div class="page-num">${pageNum} / ${totalPages}</div>` : ''}
</div>`;
    });

    const orderedPages = reverseOrder ? [...pageHtmlArr].reverse() : pageHtmlArr;
    const allPages = Array.from({ length: copies }, () => orderedPages.join("")).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${drawingTitle}</title>
<style>
@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }
*{box-sizing:border-box;margin:0;padding:0;}
body{background:white;font-family:Arial,sans-serif;font-size:10pt;}
.page{
  width:${paper.w}mm;height:${paper.h}mm;
  position:relative;page-break-after:always;overflow:hidden;
  padding:${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm;
}
.page:last-child{page-break-after:auto;}
.frame{position:absolute;top:${marginTop}mm;left:${marginLeft}mm;right:${marginRight}mm;bottom:${marginBottom + (showStamp ? 56 : 0)}mm;border:1px solid #000;pointer-events:none;}
.schema-wrap{
  width:100%;height:calc(100% - ${showStamp ? 56 : 0}mm);
  display:flex;align-items:flex-start;justify-content:flex-start;overflow:hidden;
}
.schema-wrap svg{display:block;}
.stamp{
  position:absolute;bottom:${marginBottom}mm;right:${marginRight}mm;
  width:185mm;height:55mm;border-collapse:collapse;border:1px solid #000;font-size:8pt;
}
.stamp td{border:0.5px solid #000;padding:1mm 2mm;white-space:nowrap;overflow:hidden;}
.col-name{font-size:11pt;font-weight:bold;text-align:center;width:65mm;}
.col-stage,.col-sheet,.col-total{width:12mm;text-align:center;}
.num-cell{font-size:10pt;font-weight:bold;text-align:center;}
.org-cell{font-size:9pt;text-align:center;}
.page-num{position:absolute;bottom:${marginBottom + (showStamp ? 58 : 2)}mm;right:${marginRight + 2}mm;font-size:9pt;color:#555;}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
${allPages}
<script>window.onload=()=>setTimeout(()=>window.print(),400);</script>
</body></html>`;

    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) { alert("Разрешите всплывающие окна в браузере."); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  };

  // ─── Превью одной страницы ───────────────────────────────────────────────
  const PREVIEW_W = 700;
  const PREVIEW_H = 540;

  const pageW = paper.w;
  const pageH = paper.h;
  const aspect = pageW / pageH;
  const previewH = Math.min(PREVIEW_H, PREVIEW_W / aspect);
  const previewW = previewH * aspect;
  const px = (mm: number) => mm * (previewW / pageW);



  // ─── Шаблоны (localStorage) ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("printTemplates") || "{}");
      setTemplates(saved);
    } catch { /* noop */ }
  }, []);

  const saveTemplate = () => {
    if (!templateName.trim()) { alert("Введите название шаблона"); return; }
    const tpl = { format, orientation, scale, marginTop, marginBottom, marginLeft, marginRight, showStamp, showFrame, showPageNumbers, tiling };
    const next = { ...templates, [templateName.trim()]: tpl };
    setTemplates(next);
    localStorage.setItem("printTemplates", JSON.stringify(next));
  };

  const loadTemplate = (name: string) => {
    const tpl = templates[name] as Record<string, unknown>;
    if (!tpl) return;
    if (tpl.format) setFormat(tpl.format as PaperFormat);
    if (tpl.orientation) setOrientation(tpl.orientation as Orientation);
    if (tpl.scale) setScale(tpl.scale as number);
    if (tpl.marginTop !== undefined) setMarginTop(tpl.marginTop as number);
    if (tpl.marginBottom !== undefined) setMarginBottom(tpl.marginBottom as number);
    if (tpl.marginLeft !== undefined) setMarginLeft(tpl.marginLeft as number);
    if (tpl.marginRight !== undefined) setMarginRight(tpl.marginRight as number);
    if (tpl.showStamp !== undefined) setShowStamp(tpl.showStamp as boolean);
    if (tpl.showFrame !== undefined) setShowFrame(tpl.showFrame as boolean);
    if (tpl.showPageNumbers !== undefined) setShowPageNumbers(tpl.showPageNumbers as boolean);
  };

  const deleteTemplate = (name: string) => {
    const next = { ...templates };
    delete next[name];
    setTemplates(next);
    localStorage.setItem("printTemplates", JSON.stringify(next));
  };

  const clampedPage = Math.min(selectedPage, totalPages - 1);
  const curTile = tiles[clampedPage] ?? tiles[0];

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="bg-white flex flex-col shadow-2xl border border-gray-400"
        style={{ width: 1040, maxHeight: "96vh", fontFamily: "Tahoma, Segoe UI, Arial, sans-serif", fontSize: 12, borderRadius: 2 }}>

        {/* ── Заголовок окна ── */}
        <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#4a7fc8 0%,#3060a8 100%)", borderBottom: "1px solid #1e4080" }}>
          <div className="flex items-center gap-2">
            <Icon name="Printer" size={14} className="text-white opacity-90" />
            <span className="font-bold text-white text-[12px]">{projectName || "Проект"} — Просмотр</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handlePrint}
              className="flex items-center gap-1 px-3 py-0.5 bg-white text-[11px] font-semibold rounded text-gray-700 hover:bg-gray-100 border border-gray-300"
              title="Печать">
              <Icon name="Printer" size={12} /> Печать
            </button>
            <button onClick={onClose}
              className="w-5 h-5 flex items-center justify-center text-white hover:bg-red-500 rounded text-[11px]">✕</button>
          </div>
        </div>

        {/* ── Тело ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Левая панель настроек ── */}
          <div className="flex-shrink-0 overflow-y-auto border-r border-gray-300"
            style={{ width: 200, background: "#f5f5f5", fontSize: 12, color: "#111" }}>

            {/* Кнопки печать / экспорт */}
            <div className="flex gap-2 px-2 py-2" style={{ borderBottom: "1px solid #d8d8d8" }}>
              <button onClick={handlePrint}
                className="flex flex-col items-center gap-0.5 flex-1 py-1 hover:bg-gray-200 rounded"
                style={{ border: "1px solid #c8c8c8", background: "white" }}>
                <Icon name="Printer" size={20} className="text-gray-700" />
                <span style={{ fontSize: 10 }}>Печать</span>
              </button>
              <button onClick={() => setShowExportDialog(true)}
                className="flex flex-col items-center gap-0.5 flex-1 py-1 hover:bg-gray-200 rounded"
                style={{ border: "1px solid #c8c8c8", background: "white" }}>
                <Icon name="Download" size={20} className="text-gray-700" />
                <span style={{ fontSize: 10 }}>Экспорт</span>
              </button>
            </div>

            {/* Шаблон */}
            <Section title="Шаблон">
              <select className={selectCls} style={{ ...inputStyle, marginBottom: 4 }}
                value="" onChange={e => { if (e.target.value) loadTemplate(e.target.value); }}>
                <option value="">— выбрать шаблон —</option>
                {Object.keys(templates).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <div className="text-[10px] text-gray-500 mb-1">Название шаблона:</div>
              <input className={inputCls} style={inputStyle} placeholder="Мой шаблон"
                value={templateName} onChange={e => setTemplateName(e.target.value)} />
              <div className="flex gap-1 mt-1.5">
                <button onClick={saveTemplate}
                  className="flex-1 py-0.5 text-[10px] border border-gray-400 rounded hover:bg-gray-200 bg-white">Сохранить</button>
                <button onClick={() => templateName && deleteTemplate(templateName)}
                  className="flex-1 py-0.5 text-[10px] border border-gray-400 rounded hover:bg-red-50 hover:border-red-400 bg-white text-gray-600">Удалить</button>
              </div>
            </Section>

            {/* Основные параметры */}
            <Section title="Основные параметры">
              <div style={{ fontSize: 11, color: "#333", marginBottom: 3 }}>Принтер:</div>
              <select className={selectCls} style={inputStyle}>
                <option>Системный принтер</option>
              </select>
            </Section>

            {/* Диапазон */}
            <Section title="Печатный диапазон">
              <Row label="Страницы:">
                <input className={inputCls} style={inputStyle} placeholder={`Пример: 1-${totalPages}`}
                  value={pageRange} onChange={e => setPageRange(e.target.value)} />
              </Row>
              <Row label="Копии:">
                <input type="number" min={1} max={99} className={inputCls} style={{ ...inputStyle, width: 60 }}
                  value={copies} onChange={e => setCopies(Math.max(1, +e.target.value || 1))} />
              </Row>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={reverseOrder} onChange={e => setReverseOrder(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span className="text-[11px]">Печать в обратном порядке</span>
              </label>
            </Section>

            {/* Размер бумаги */}
            <Section title="Размер бумаги">
              <Row label="Ориентация:">
                <select className={selectCls} style={inputStyle}
                  value={orientation} onChange={e => setOrientation(e.target.value as Orientation)}>
                  <option value="landscape">Альбомная</option>
                  <option value="portrait">Книжная</option>
                </select>
              </Row>
              <Row label="Формат:">
                <select className={selectCls} style={inputStyle}
                  value={format} onChange={e => setFormat(e.target.value as PaperFormat)}>
                  {(["A4","A3","A2","A1","A0"] as PaperFormat[]).map(f => (
                    <option key={f} value={f}>{f} ({PAPER_SIZES[f].w}×{PAPER_SIZES[f].h} мм)</option>
                  ))}
                  <option value="custom">Произвольный</option>
                </select>
              </Row>
              {format === "custom" ? (
                <>
                  <Row label="Ширина:">
                    <div className="flex items-center gap-1">
                      <input type="number" className={inputCls} style={{ ...inputStyle, width: 60 }}
                        value={customW} onChange={e => setCustomW(+e.target.value || 210)} />
                      <span className="text-[10px] text-gray-500">мм</span>
                    </div>
                  </Row>
                  <Row label="Высота:">
                    <div className="flex items-center gap-1">
                      <input type="number" className={inputCls} style={{ ...inputStyle, width: 60 }}
                        value={customH} onChange={e => setCustomH(+e.target.value || 297)} />
                      <span className="text-[10px] text-gray-500">мм</span>
                    </div>
                  </Row>
                </>
              ) : (
                <>
                  <Row label="Ширина:"><span className="text-[11px]">{paper.w} мм</span></Row>
                  <Row label="Высота:"><span className="text-[11px]">{paper.h} мм</span></Row>
                </>
              )}
            </Section>

            {/* Преобразование схемы */}
            <Section title="Преобразование схемы">
              <Row label="Масштаб:">
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={1000} className={inputCls} style={{ ...inputStyle, width: 55 }}
                    value={scale} onChange={e => setScale(Math.max(1, +e.target.value || 1))} />
                  <span className="text-[10px] text-gray-500">%</span>
                </div>
              </Row>
              <button onClick={handleFitScale}
                className="w-full py-0.5 text-[10px] border border-gray-400 rounded hover:bg-blue-50 hover:border-blue-400 bg-white mb-2">
                Подобрать масштаб
              </button>
              <div style={{ fontSize: 11, color: "#333", marginBottom: 4, fontWeight: 500 }}>Смещение:</div>
              <Row label="вправо:">
                <div className="flex items-center gap-1">
                  <input type="number" className={inputCls} style={{ ...inputStyle, width: 55 }}
                    value={offsetX} onChange={e => setOffsetX(+e.target.value || 0)} />
                  <span className="text-[10px] text-gray-500">мм</span>
                </div>
              </Row>
              <Row label="вниз:">
                <div className="flex items-center gap-1">
                  <input type="number" className={inputCls} style={{ ...inputStyle, width: 55 }}
                    value={offsetY} onChange={e => setOffsetY(+e.target.value || 0)} />
                  <span className="text-[10px] text-gray-500">мм</span>
                </div>
              </Row>
            </Section>

            {/* Поля */}
            <Section title="Поля" defaultOpen={false}>
              {([
                ["Верхнее:", marginTop, setMarginTop],
                ["Нижнее:", marginBottom, setMarginBottom],
                ["Левое:", marginLeft, setMarginLeft],
                ["Правое:", marginRight, setMarginRight],
              ] as [string, number, (v: number) => void][]).map(([lbl, val, set]) => (
                <Row key={lbl} label={lbl}>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={50} className={inputCls} style={{ ...inputStyle, width: 50 }}
                      value={val} onChange={e => set(Math.max(0, +e.target.value || 0))} />
                    <span className="text-[10px] text-gray-500">мм</span>
                  </div>
                </Row>
              ))}
            </Section>

            {/* Номера страниц */}
            <Section title="Номера страниц" defaultOpen={false}>
              <label className="flex items-center gap-1.5 cursor-pointer mb-1">
                <input type="checkbox" checked={showPageNumbers} onChange={e => setShowPageNumbers(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span>Показывать номера страниц</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer mb-1">
                <input type="checkbox" checked={showFrame} onChange={e => setShowFrame(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span>Рамка страницы</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showStamp} onChange={e => setShowStamp(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span>Штамп (основная надпись)</span>
              </label>
              {showStamp && (
                <div className="mt-2 space-y-1 border-t border-gray-200 pt-2">
                  {([
                    ["Номер:", drawingNumber, setDrawingNumber],
                    ["Название:", drawingTitle, setDrawingTitle],
                    ["Разработал:", engineer, setEngineer],
                    ["Проверил:", approvedBy, setApprovedBy],
                    ["Организация:", organization, setOrganization],
                  ] as [string, string, (v: string) => void][]).map(([lbl, val, set]) => (
                    <div key={lbl}>
                      <div style={{ fontSize: 11, color: "#333", marginBottom: 2 }}>{lbl}</div>
                      <input className={inputCls} style={inputStyle} value={val} onChange={e => set(e.target.value)} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Сброс */}
            <div className="px-3 py-2">
              <button onClick={() => {
                setScale(100); setOffsetX(0); setOffsetY(0);
                setMarginTop(5); setMarginBottom(5); setMarginLeft(5); setMarginRight(5);
                setShowPageNumbers(true); setShowFrame(false); setShowStamp(false);
              }}
                className="w-full py-0.5 text-[10px] border border-gray-400 rounded hover:bg-gray-200 bg-white text-gray-600">
                Сбросить настройки
              </button>
            </div>
          </div>

          {/* ── Правая область — предпросмотр ── */}
          <div className="flex-1 overflow-auto flex flex-col"
            style={{ background: "#808080", padding: 16 }}>

            {/* ── Предпросмотр листа ── */}
            <div className="flex items-start justify-center flex-1">
              <div style={{
                width: previewW, height: previewH,
                background: "white",
                boxShadow: "4px 4px 16px rgba(0,0,0,0.6)",
                position: "relative",
                flexShrink: 0,
              }}>
                {/* Рамка листа */}
                {showFrame && (
                  <div style={{
                    position: "absolute",
                    top: px(marginTop), left: px(marginLeft),
                    right: px(marginRight),
                    bottom: px(marginBottom + (showStamp ? 56 : 0)),
                    border: "1px solid #333", pointerEvents: "none", zIndex: 2,
                  }} />
                )}

                {/* Схема — img из dataUrl (работает и для PNG canvas-режима, и для SVG→PNG) */}
                <div style={{
                  position: "absolute",
                  top: px(marginTop),
                  left: px(marginLeft),
                  width: px(workArea.w),
                  height: px(workArea.h),
                  overflow: "hidden",
                  background: "#fff",
                }}>
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt="preview"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        objectPosition: "left top",
                        display: "block",
                      }}
                    />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#aaa", fontSize: 13,
                    }}>
                      Загрузка схемы…
                    </div>
                  )}
                </div>

                {/* Штамп — мини-макет */}
                {showStamp && (
                  <div style={{
                    position: "absolute",
                    bottom: px(marginBottom),
                    right: px(marginRight),
                    width: px(185), height: px(55),
                    border: "1px solid #555", background: "white", zIndex: 3,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    fontSize: Math.max(6, px(2.5)),
                    color: "#333",
                  }}>
                    <div style={{ borderRight: "1px solid #aaa", padding: "2px 4px" }}>
                      <div style={{ fontWeight: 600, fontSize: Math.max(6, px(2)) }}>{drawingTitle || "Название"}</div>
                      <div style={{ color: "#777" }}>{engineer && `Разраб.: ${engineer}`}</div>
                    </div>
                    <div style={{ padding: "2px 4px", fontWeight: 700, textAlign: "center" }}>
                      {drawingNumber || "Номер"}
                    </div>
                  </div>
                )}

                {/* Номер страницы */}
                {showPageNumbers && (
                  <div style={{
                    position: "absolute",
                    bottom: px(marginBottom + (showStamp ? 57 : 1)),
                    right: px(marginRight + 1),
                    fontSize: Math.max(8, px(3)),
                    color: "#666", zIndex: 3,
                  }}>
                    {clampedPage + 1} / {totalPages}
                  </div>
                )}
              </div>

              {/* Сетка страниц (если > 1) */}
              {totalPages > 1 && (
                <div style={{ marginLeft: 16, display: "flex", flexDirection: "column", gap: 4, maxHeight: previewH, overflowY: "auto" }}>
                  <div style={{ color: "white", fontSize: 10, marginBottom: 4, textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                    Страниц: {totalPages}
                  </div>
                  {tiles.map((_, idx) => {
                    const isSel = idx === clampedPage;
                    return (
                      <button key={idx} onClick={() => setSelectedPage(idx)}
                        style={{
                          width: 60, height: Math.round(60 / aspect),
                          background: "white",
                          border: isSel ? "2px solid #4a9eff" : "1px solid #888",
                          boxShadow: isSel ? "0 0 0 1px #4a9eff" : "1px 1px 3px rgba(0,0,0,0.3)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: isSel ? 700 : 400,
                          color: isSel ? "#2563eb" : "#555",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}>
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Строка состояния ── */}
            <div className="flex items-center justify-between mt-3 flex-shrink-0"
              style={{ color: "white", fontSize: 11 }}>
              <span style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                {paper.w}×{paper.h} мм · {orientation === "landscape" ? "Альбомная" : "Книжная"} · Масштаб {scale}%
                {totalPages > 1 ? ` · ${totalPages} стр.` : ""}
              </span>
              <span style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>100 %</span>
            </div>
          </div>
        </div>

        {/* ── Кнопки внизу ── */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 flex-shrink-0"
          style={{ background: "#efefef", borderTop: "1px solid #d0d0d0" }}>
          <button onClick={handlePrint}
            className="px-5 py-1 rounded text-[12px] font-semibold text-white hover:bg-blue-600"
            style={{ background: "#2563eb", border: "1px solid #1e4db7" }}>
            <Icon name="Printer" size={13} className="inline mr-1.5" />Печать
          </button>
          <button onClick={onClose}
            className="px-4 py-1 rounded text-[12px] border border-gray-400 bg-white hover:bg-gray-100 text-gray-700">
            Закрыть
          </button>
        </div>
      </div>

      {/* ══ ДИАЛОГ ЭКСПОРТА ══════════════════════════════════════════════════ */}
      {showExportDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="bg-white rounded shadow-2xl border border-gray-400"
            style={{ width: 380, fontFamily: "Tahoma, Segoe UI, Arial, sans-serif" }}>

            {/* Заголовок */}
            <div className="flex items-center justify-between px-4 py-2"
              style={{ background: "linear-gradient(180deg,#4a7fc8,#3060a8)", borderRadius: "4px 4px 0 0" }}>
              <div className="flex items-center gap-2">
                <Icon name="Download" size={14} className="text-white" />
                <span className="text-white font-bold text-[13px]">Экспорт схемы</span>
              </div>
              <button onClick={() => setShowExportDialog(false)}
                className="text-white hover:bg-red-500 w-5 h-5 flex items-center justify-center rounded text-[11px]">✕</button>
            </div>

            {/* Тело */}
            <div className="p-5 space-y-4">
              {/* Формат */}
              <div>
                <div className="text-[12px] font-semibold text-gray-800 mb-2">Формат файла:</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["png","jpg","bmp","tiff","svg","pdf"] as const).map(f => (
                    <button key={f}
                      onClick={() => setExportFormat(f)}
                      className="py-1.5 rounded border text-[12px] font-semibold uppercase transition-colors"
                      style={{
                        background: exportFormat === f ? "#2563eb" : "white",
                        color: exportFormat === f ? "white" : "#374151",
                        borderColor: exportFormat === f ? "#2563eb" : "#d1d5db",
                      }}>
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 text-[11px] text-gray-500">
                  {exportFormat === "png"  && "PNG — без потерь, прозрачность, рекомендуется для схем"}
                  {exportFormat === "jpg"  && "JPEG — с потерями, меньший размер файла"}
                  {exportFormat === "bmp"  && "BMP — без сжатия, максимальное качество"}
                  {exportFormat === "tiff" && "TIFF — для полиграфии и архивов"}
                  {exportFormat === "svg"  && "SVG — векторный формат, масштабируется без потерь"}
                  {exportFormat === "pdf"  && "PDF — откроется диалог печати в PDF"}
                </div>
              </div>

              {/* Разрешение (только для растровых) */}
              {!["svg","pdf"].includes(exportFormat) && (
                <div>
                  <div className="text-[12px] font-semibold text-gray-800 mb-2">Разрешение (DPI):</div>
                  <div className="flex gap-2 mb-2">
                    {[72, 96, 150, 300, 600].map(d => (
                      <button key={d} onClick={() => setExportDpi(d)}
                        className="flex-1 py-1 rounded border text-[11px] font-medium"
                        style={{
                          background: exportDpi === d ? "#2563eb" : "white",
                          color: exportDpi === d ? "white" : "#374151",
                          borderColor: exportDpi === d ? "#2563eb" : "#d1d5db",
                        }}>
                        {d}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-700">Своё:</span>
                    <input type="number" min={36} max={1200} value={exportDpi}
                      onChange={e => setExportDpi(Math.max(36, Math.min(1200, +e.target.value || 96)))}
                      className="border border-gray-400 rounded px-2 text-[12px] text-gray-900"
                      style={{ width: 70, height: 24 }} />
                    <span className="text-[11px] text-gray-500">dpi</span>
                  </div>
                </div>
              )}

              {/* Качество (только JPEG) */}
              {exportFormat === "jpg" && (
                <div>
                  <div className="text-[12px] font-semibold text-gray-800 mb-2">
                    Качество JPEG: {exportQuality}%
                  </div>
                  <input type="range" min={10} max={100} step={5}
                    value={exportQuality} onChange={e => setExportQuality(+e.target.value)}
                    className="w-full" style={{ accentColor: "#2563eb" }} />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                    <span>Низкое</span><span>Среднее</span><span>Высокое</span>
                  </div>
                </div>
              )}

              {/* Предполагаемый размер */}
              {!["svg","pdf"].includes(exportFormat) && (
                <div className="text-[11px] text-gray-500 bg-gray-50 rounded px-3 py-2 border border-gray-200">
                  Приблизительный размер файла зависит от содержимого схемы
                  {exportFormat === "jpg" && ` · Качество: ${exportQuality}%`}
                </div>
              )}
            </div>

            {/* Кнопки */}
            <div className="flex gap-2 px-5 pb-5 justify-end">
              <button onClick={handleExport}
                className="px-5 py-1.5 rounded text-[12px] font-semibold text-white hover:bg-blue-600"
                style={{ background: "#2563eb", border: "1px solid #1e4db7" }}>
                <Icon name="Download" size={13} className="inline mr-1.5" />
                Скачать {exportFormat.toUpperCase()}
              </button>
              <button onClick={() => setShowExportDialog(false)}
                className="px-4 py-1.5 rounded text-[12px] border border-gray-400 bg-white hover:bg-gray-100 text-gray-700">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}