import { useState, useMemo, useCallback, useRef } from "react";
import Icon from "@/components/ui/icon";
import PrintPreviewCanvas, { type PrintPreviewCanvasHandle } from "./PrintPreviewCanvas";
import { type TopoNode, type TopoBranch, type Horizon, project3D } from "@/lib/topology";
import { renderCanvas, type FlowDisplayMode } from "@/lib/canvasRenderer";
import { type InfoDisplayConfig } from "@/lib/infoConfig";
import { type UnitsConfig, DEFAULT_UNITS_CONFIG } from "@/lib/unitsConfig";
import { type SchemaSymbol } from "@/pages/Cad";
import { drawSymbolsToCanvas } from "@/lib/drawSymbolsToCanvas";

interface PrintDialogProps {
  onClose: () => void;
  projectName?: string;
  nodes: TopoNode[];
  branches: TopoBranch[];
  horizons: Horizon[];
  viewState: { scale: number; offsetX: number; offsetY: number; azimuth: number; elevation: number };
  // Параметры отображения — как настроено в рабочей области
  schemaSymbols?: SchemaSymbol[];
  branchWidth?: number;
  branchBorder?: number;
  thinLines?: boolean;
  colorByHorizon?: boolean;
  flowDisplay?: FlowDisplayMode;
  infoConfig?: InfoDisplayConfig | null;
  unitsConfig?: UnitsConfig;
  zScale?: number;
  getSvgRaw?: () => string;
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

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid #d0d0d0" }}>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left"
        style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a", background: "#e4e4e4" }}>
        <span style={{ fontSize: 8, color: "#555" }}>{open ? "▼" : "►"}</span>
        {title}
      </button>
      {open && <div className="px-3 py-2 space-y-1.5">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 88, fontSize: 12, color: "#1a1a1a", flexShrink: 0, fontWeight: 500 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const inp = "border border-gray-500 px-1.5 rounded text-[12px] text-gray-900 bg-white focus:outline-none focus:border-blue-500";
const sel = inp + " cursor-pointer w-full";
const ih = { height: 22 } as React.CSSProperties;

export default function PrintDialog({
  onClose, projectName = "Проект",
  nodes, branches, horizons, viewState,
  schemaSymbols = [],
  branchWidth = 2, branchBorder = 0.4,
  thinLines = false, colorByHorizon = false,
  flowDisplay = "off", infoConfig = null,
  unitsConfig = DEFAULT_UNITS_CONFIG,
  zScale = 1,
  getSvgRaw,
}: PrintDialogProps) {
  // Ref на живой canvas предпросмотра — для кнопки "Подобрать масштаб" и экспорта
  const previewRef = useRef<PrintPreviewCanvasHandle>(null);

  const [format, setFormat] = useState<PaperFormat>("A3");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [customW, setCustomW] = useState(420);
  const [customH, setCustomH] = useState(297);

  // null = auto-fit; number = явно заданный пользователем
  const [userScale,   setUserScale]   = useState<number | null>(null);
  const [userOffsetX, setUserOffsetX] = useState<number | null>(null);
  const [userOffsetY, setUserOffsetY] = useState<number | null>(null);

  // Отображаемые значения (для полей ввода)
  const [scaleDisplay,   setScaleDisplay]   = useState<number>(100);
  const [offsetXDisplay, setOffsetXDisplay] = useState<number>(0);
  const [offsetYDisplay, setOffsetYDisplay] = useState<number>(0);
  const [marginTop, setMarginTop] = useState(5);
  const [marginBottom, setMarginBottom] = useState(5);
  const [marginLeft, setMarginLeft] = useState(5);
  const [marginRight, setMarginRight] = useState(5);
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [showStamp, setShowStamp] = useState(false);
  const [showFrame, setShowFrame] = useState(false);
  const [copies, setCopies] = useState(1);
  const [reverseOrder, setReverseOrder] = useState(false);
  const [pageRange, setPageRange] = useState("");
  const [drawingNumber, setDrawingNumber] = useState("");
  const [drawingTitle, setDrawingTitle] = useState(projectName);
  const [engineer, setEngineer] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [organization, setOrganization] = useState("");
  const [printDate] = useState(() => new Date().toLocaleDateString("ru"));
  const [templateName, setTemplateName] = useState("");
  const [templates, setTemplates] = useState<Record<string, object>>(() => {
    try { return JSON.parse(localStorage.getItem("printTemplates") || "{}"); } catch { return {}; }
  });
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<"png"|"jpg"|"bmp"|"svg"|"pdf">("png");
  const [exportDpi, setExportDpi] = useState(150);
  const [exportQuality, setExportQuality] = useState(95);

  // ─── Размеры бумаги ───────────────────────────────────────────────────
  const paper = useMemo(() => {
    if (format === "custom") return { w: customW, h: customH };
    const s = PAPER_SIZES[format];
    return orientation === "landscape" ? { w: s.h, h: s.w } : s;
  }, [format, orientation, customW, customH]);

  const workArea = useMemo(() => ({
    w: paper.w - marginLeft - marginRight,
    h: paper.h - marginTop - marginBottom - (showStamp ? 56 : 0),
  }), [paper, marginLeft, marginRight, marginTop, marginBottom, showStamp]);

  // ─── Размеры предпросмотра ────────────────────────────────────────────
  const PREV_MAX_W = 700;
  const PREV_MAX_H = 520;
  const aspect = paper.w / paper.h;
  const prevH = Math.min(PREV_MAX_H, PREV_MAX_W / aspect);
  const prevW = prevH * aspect;
  const px = (mm: number) => mm * (prevW / paper.w);

  // ─── Рендер схемы в offscreen canvas для печати/экспорта ─────────────
  // Использует тот же fit-алгоритм что и PrintPreviewCanvas
  const renderToCanvas = useCallback(async (outW: number, outH: number): Promise<string> => {
    const oc = document.createElement("canvas");
    oc.width = outW; oc.height = outH;
    const ctx = oc.getContext("2d");
    if (!ctx) return "";

    const horizonMap = new Map(horizons.map(h => [h.id, h]));
    const visibleBranches = branches.filter(b => {
      if (!b.horizonId) return true;
      const h = horizonMap.get(b.horizonId);
      return !h || h.visible;
    });

    // Вычисляем fit-view для нужного размера (идентично PrintPreviewCanvas)
    const isScene3D = viewState.elevation < 89.5 || viewState.azimuth !== 0;
    let sc = 1, offsetX = 0, offsetY = 0;
    if (nodes.length > 0) {
      const tmpProj = { scale: 1, offsetX: 0, offsetY: 0, azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const p = project3D({ x: n.x, y: n.y, z: n.z * zScale }, tmpProj);
        if (p.sx < minX) minX = p.sx; if (p.sx > maxX) maxX = p.sx;
        if (p.sy < minY) minY = p.sy; if (p.sy > maxY) maxY = p.sy;
      }
      const pad = 40;
      const sw = maxX - minX || 1, sh = maxY - minY || 1;
      sc = Math.min((outW - pad * 2) / sw, (outH - pad * 2) / sh);
      if (userScale !== null) sc = userScale;
      offsetX = userOffsetX ?? ((outW  - sw * sc) / 2 - minX * sc);
      offsetY = userOffsetY ?? ((outH - sh * sc) / 2 - minY * sc);
    }

    const sv = { scale: sc, offsetX, offsetY, azimuth: viewState.azimuth, elevation: viewState.elevation, zScale };
    const proj = sv;
    const projNodes = nodes.map(n => ({ node: n, ...project3D({ x: n.x, y: n.y, z: n.z * zScale }, proj), depth: 0 }));
    const projNodesMap = new Map(projNodes.map(p => [p.node.id, p]));

    ctx.fillStyle = isScene3D ? "#f0f4f8" : "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
    renderCanvas({
      ctx, width: outW, height: outH,
      nodes, branches, horizons, horizonMap,
      visibleBranches, hiddenBranchIds: new Set(),
      projNodes, projNodesMap, proj, view: sv,
      is3D: isScene3D, zScale, zLevel: 0,
      selectedBranchId: null, selectedBranchIds: new Set(),
      selectedNodeId: null, selectedNodeIds: new Set(),
      hoverBranchId: null, branchWidth, branchBorder,
      thinLines, colorByHorizon,
      showFlowArrows: false, flowDisplay,
      animOffset: 0, infoConfig, unitsConfig,
    });

    // Рисуем условные обозначения поверх схемы
    if (schemaSymbols.length > 0) {
      await drawSymbolsToCanvas(ctx, schemaSymbols, branches, projNodesMap, sc, unitsConfig);
    }

    return oc.toDataURL("image/png");
  }, [nodes, branches, horizons, schemaSymbols, viewState, zScale, userScale, userOffsetX, userOffsetY,
      branchWidth, branchBorder, thinLines, colorByHorizon, flowDisplay, infoConfig, unitsConfig]);

  // ─── Печать ──────────────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    // Для печати рендерим схему в PNG нужного размера
    const DPI = 150;
    const mmToPx = (mm: number) => Math.round(mm * DPI / 25.4);
    const printW = mmToPx(workArea.w);
    const printH = mmToPx(workArea.h);
    const schemaPng = await renderToCanvas(printW, printH);

    const stampHtml = showStamp ? `
      <table class="stamp" cellpadding="0" cellspacing="0">
        <tr><td colspan="5"></td>
          <td rowspan="6" class="col-name">${drawingTitle}</td>
          <td class="col-stage">Стадия</td><td class="col-sheet">Лист</td><td class="col-total">Листов</td></tr>
        <tr><td>Разраб.</td><td>${engineer}</td><td></td><td></td><td>${printDate}</td>
          <td rowspan="5" class="org-cell">${organization}</td>
          <td>Р</td><td>1</td><td>1</td></tr>
        <tr><td>Пров.</td><td>${approvedBy}</td><td></td><td></td><td>${printDate}</td>
          <td rowspan="4" colspan="3" class="num-cell">${drawingNumber}</td></tr>
        <tr><td>Н.контр.</td><td></td><td></td><td></td><td></td></tr>
        <tr><td>Утв.</td><td></td><td></td><td></td><td></td></tr>
        <tr><td colspan="5"></td></tr>
      </table>` : "";

    const pageHtml = `<div class="page">
      ${showFrame ? '<div class="frame"></div>' : ''}
      <div class="schema-wrap">
        <img src="${schemaPng}" style="width:${workArea.w}mm;height:${workArea.h}mm;display:block;" />
      </div>
      ${stampHtml}
      ${showPageNumbers ? '<div class="page-num">1 / 1</div>' : ''}
    </div>`;

    const allPages = Array.from({ length: copies }, () => pageHtml).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${drawingTitle}</title>
<style>
@page{size:${paper.w}mm ${paper.h}mm;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
body{background:white;font-family:Arial,sans-serif}
.page{width:${paper.w}mm;height:${paper.h}mm;position:relative;page-break-after:always;overflow:hidden;padding:${marginTop}mm ${marginRight}mm ${marginBottom}mm ${marginLeft}mm}
.page:last-child{page-break-after:auto}
.frame{position:absolute;top:${marginTop}mm;left:${marginLeft}mm;right:${marginRight}mm;bottom:${marginBottom+(showStamp?56:0)}mm;border:1px solid #000;pointer-events:none}
.schema-wrap{width:100%;height:calc(100% - ${showStamp?56:0}mm);overflow:hidden}
.stamp{position:absolute;bottom:${marginBottom}mm;right:${marginRight}mm;width:185mm;height:55mm;border-collapse:collapse;border:1px solid #000;font-size:8pt}
.stamp td{border:.5px solid #000;padding:1mm 2mm;white-space:nowrap;overflow:hidden}
.col-name{font-size:11pt;font-weight:bold;text-align:center;width:65mm}
.col-stage,.col-sheet,.col-total{width:12mm;text-align:center}
.num-cell{font-size:10pt;font-weight:bold;text-align:center}
.org-cell{font-size:9pt;text-align:center}
.page-num{position:absolute;bottom:${marginBottom+(showStamp?58:2)}mm;right:${marginRight+2}mm;font-size:9pt;color:#555}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${allPages}
<script>window.onload=()=>setTimeout(()=>window.print(),400)</script>
</body></html>`;

    const win = window.open("", "_blank", "width=1400,height=900");
    if (!win) { alert("Разрешите всплывающие окна"); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }, [paper, workArea, marginTop, marginBottom, marginLeft, marginRight, showStamp, showFrame,
      showPageNumbers, copies, drawingTitle, drawingNumber, engineer, approvedBy, organization,
      printDate, renderToCanvas]);

  // ─── Экспорт ─────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (exportFormat === "svg") {
      const raw = getSvgRaw ? getSvgRaw() : "";
      if (!raw || raw.startsWith("data:")) {
        alert("SVG-экспорт недоступен. Используйте PNG.");
        return;
      }
      const blob = new Blob([raw], { type: "image/svg+xml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${projectName}.svg`;
      a.click();
      setShowExportDialog(false);
      return;
    }
    if (exportFormat === "pdf") {
      await handlePrint();
      setShowExportDialog(false);
      return;
    }

    // Растровые форматы — рендерим напрямую
    const scale2 = exportDpi / 96;
    const outW = Math.round(prevW * scale2);
    const outH = Math.round(prevH * scale2);
    const pngSrc = await renderToCanvas(outW, outH);
    if (!pngSrc) { alert("Ошибка рендера"); return; }

    if (exportFormat === "png") {
      const a = document.createElement("a");
      a.href = pngSrc; a.download = `${projectName}.png`; a.click();
      setShowExportDialog(false);
      return;
    }

    // Для jpg/bmp/tiff — перерисовываем через canvas
    const img = new Image();
    await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); img.src = pngSrc; });
    const oc = document.createElement("canvas");
    oc.width = outW; oc.height = outH;
    const ctx = oc.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0);
    const mime: Record<string, string> = { jpg: "image/jpeg", bmp: "image/bmp", tiff: "image/tiff" };
    const q = exportFormat === "jpg" ? exportQuality / 100 : undefined;
    const a = document.createElement("a");
    a.href = oc.toDataURL(mime[exportFormat] ?? "image/png", q);
    a.download = `${projectName}.${exportFormat}`;
    a.click();
    setShowExportDialog(false);
  }, [exportFormat, exportDpi, exportQuality, projectName, getSvgRaw, handlePrint, renderToCanvas, prevW, prevH]);

  // ─── Шаблоны ─────────────────────────────────────────────────────────
  const saveTemplate = () => {
    if (!templateName.trim()) { alert("Введите название"); return; }
    const tpl = { format, orientation, scale, marginTop, marginBottom, marginLeft, marginRight, showStamp, showFrame, showPageNumbers };
    const next = { ...templates, [templateName.trim()]: tpl };
    setTemplates(next); localStorage.setItem("printTemplates", JSON.stringify(next));
  };
  const loadTemplate = (name: string) => {
    const t = templates[name] as Record<string, unknown>;
    if (!t) return;
    if (t.format) setFormat(t.format as PaperFormat);
    if (t.orientation) setOrientation(t.orientation as Orientation);
    if (t.scale) setScale(t.scale as number);
    if (t.marginTop !== undefined) setMarginTop(t.marginTop as number);
    if (t.marginBottom !== undefined) setMarginBottom(t.marginBottom as number);
    if (t.marginLeft !== undefined) setMarginLeft(t.marginLeft as number);
    if (t.marginRight !== undefined) setMarginRight(t.marginRight as number);
    if (t.showStamp !== undefined) setShowStamp(t.showStamp as boolean);
    if (t.showFrame !== undefined) setShowFrame(t.showFrame as boolean);
    if (t.showPageNumbers !== undefined) setShowPageNumbers(t.showPageNumbers as boolean);
  };
  const deleteTemplate = (name: string) => {
    const next = { ...templates }; delete next[name];
    setTemplates(next); localStorage.setItem("printTemplates", JSON.stringify(next));
  };

  // ─── JSX ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}>
      <div className="bg-white flex flex-col shadow-2xl border border-gray-400"
        style={{ width: 1060, maxHeight: "96vh", fontFamily: "Tahoma, Segoe UI, Arial, sans-serif", fontSize: 12, borderRadius: 2 }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#4a7fc8,#3060a8)" }}>
          <div className="flex items-center gap-2">
            <Icon name="Printer" size={14} className="text-white opacity-90" />
            <span className="font-bold text-white text-[13px]">{projectName} — Просмотр</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-0.5 bg-white rounded text-[12px] font-semibold text-gray-800 hover:bg-gray-100 border border-gray-300">
              <Icon name="Printer" size={13} />Печать
            </button>
            <button onClick={onClose}
              className="w-6 h-6 flex items-center justify-center text-white hover:bg-red-500 rounded text-[13px]">✕</button>
          </div>
        </div>

        {/* Тело */}
        <div className="flex flex-1 overflow-hidden">

          {/* Левая панель */}
          <div className="flex-shrink-0 overflow-y-auto border-r border-gray-300"
            style={{ width: 215, background: "#f4f4f4", color: "#1a1a1a" }}>

            {/* Кнопки */}
            <div className="flex gap-2 px-2 py-2 border-b border-gray-300">
              <button onClick={handlePrint}
                className="flex flex-col items-center gap-0.5 flex-1 py-1.5 hover:bg-gray-200 rounded border border-gray-300 bg-white">
                <Icon name="Printer" size={22} className="text-gray-700" />
                <span style={{ fontSize: 11, color: "#222" }}>Печать</span>
              </button>
              <button onClick={() => setShowExportDialog(true)}
                className="flex flex-col items-center gap-0.5 flex-1 py-1.5 hover:bg-gray-200 rounded border border-gray-300 bg-white">
                <Icon name="Download" size={22} className="text-gray-700" />
                <span style={{ fontSize: 11, color: "#222" }}>Экспорт</span>
              </button>
            </div>

            {/* Шаблон */}
            <Section title="Шаблон">
              <select className={sel} style={ih} value=""
                onChange={e => { if (e.target.value) loadTemplate(e.target.value); }}>
                <option value="">— выбрать шаблон —</option>
                {Object.keys(templates).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Название шаблона:</div>
              <input className={inp + " w-full"} style={ih} placeholder="Мой шаблон"
                value={templateName} onChange={e => setTemplateName(e.target.value)} />
              <div className="flex gap-1 pt-1">
                <button onClick={saveTemplate}
                  className="flex-1 py-0.5 text-[11px] border border-gray-400 rounded hover:bg-gray-200 bg-white font-medium text-gray-800">Сохранить</button>
                <button onClick={() => templateName && deleteTemplate(templateName)}
                  className="flex-1 py-0.5 text-[11px] border border-gray-400 rounded hover:bg-red-50 hover:border-red-400 bg-white text-gray-700">Удалить</button>
              </div>
            </Section>

            {/* Основные параметры */}
            <Section title="Основные параметры">
              <div style={{ fontSize: 12, color: "#333", marginBottom: 3 }}>Принтер:</div>
              <select className={sel} style={ih}><option>Системный принтер</option></select>
            </Section>

            {/* Диапазон */}
            <Section title="Печатный диапазон">
              <Row label="Страницы:">
                <input className={inp + " w-full"} style={ih} placeholder="Пример: 1-1"
                  value={pageRange} onChange={e => setPageRange(e.target.value)} />
              </Row>
              <Row label="Копии:">
                <input type="number" min={1} max={99} className={inp} style={{ ...ih, width: 60 }}
                  value={copies} onChange={e => setCopies(Math.max(1, +e.target.value || 1))} />
              </Row>
              <label className="flex items-center gap-1.5 cursor-pointer pt-0.5">
                <input type="checkbox" checked={reverseOrder} onChange={e => setReverseOrder(e.target.checked)}
                  style={{ accentColor: "#2563eb" }} />
                <span style={{ fontSize: 12, color: "#1a1a1a" }}>Печать в обратном порядке</span>
              </label>
            </Section>

            {/* Размер бумаги */}
            <Section title="Размер бумаги">
              <Row label="Ориентация:">
                <select className={sel} style={ih} value={orientation}
                  onChange={e => setOrientation(e.target.value as Orientation)}>
                  <option value="landscape">Альбомная</option>
                  <option value="portrait">Книжная</option>
                </select>
              </Row>
              <Row label="Формат:">
                <select className={sel} style={ih} value={format}
                  onChange={e => setFormat(e.target.value as PaperFormat)}>
                  {(["A4","A3","A2","A1","A0"] as PaperFormat[]).map(f =>
                    <option key={f} value={f}>{f} ({PAPER_SIZES[f].w}×{PAPER_SIZES[f].h} мм)</option>)}
                  <option value="custom">Произвольный</option>
                </select>
              </Row>
              {format === "custom" ? (
                <>
                  <Row label="Ширина:">
                    <div className="flex items-center gap-1">
                      <input type="number" className={inp} style={{ ...ih, width: 60 }}
                        value={customW} onChange={e => setCustomW(+e.target.value || 210)} />
                      <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                    </div>
                  </Row>
                  <Row label="Высота:">
                    <div className="flex items-center gap-1">
                      <input type="number" className={inp} style={{ ...ih, width: 60 }}
                        value={customH} onChange={e => setCustomH(+e.target.value || 297)} />
                      <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                    </div>
                  </Row>
                </>
              ) : (
                <>
                  <Row label="Ширина:"><span style={{ fontSize: 12, color: "#333" }}>{paper.w} мм</span></Row>
                  <Row label="Высота:"><span style={{ fontSize: 12, color: "#333" }}>{paper.h} мм</span></Row>
                </>
              )}
            </Section>

            {/* Преобразование схемы */}
            <Section title="Преобразование схемы">
              <Row label="Масштаб:">
                <div className="flex items-center gap-1">
                  <input type="number" min={1} max={10000} className={inp} style={{ ...ih, width: 60 }}
                    value={scaleDisplay}
                    onChange={e => {
                      const v = Math.max(1, +e.target.value || 1);
                      setScaleDisplay(v);
                      setUserScale(v / 100);
                    }} />
                  <span style={{ fontSize: 11, color: "#555" }}>%</span>
                </div>
              </Row>
              <button onClick={() => {
                // Сбрасываем в auto-fit
                setUserScale(null); setUserOffsetX(null); setUserOffsetY(null);
                setOffsetXDisplay(0); setOffsetYDisplay(0);
                // Читаем реальный fit-scale из canvas и показываем в поле
                const fit = previewRef.current?.getFitView();
                if (fit) setScaleDisplay(Math.round(fit.scale * 100));
              }}
                className="w-full py-0.5 text-[11px] border border-gray-400 rounded hover:bg-blue-50 hover:border-blue-400 bg-white font-medium text-gray-800">
                Подобрать масштаб
              </button>
              <div style={{ fontSize: 12, color: "#333", fontWeight: 500, paddingTop: 4 }}>Смещение:</div>
              <Row label="вправо:">
                <div className="flex items-center gap-1">
                  <input type="number" className={inp} style={{ ...ih, width: 60 }}
                    value={offsetXDisplay}
                    onChange={e => {
                      const v = +e.target.value || 0;
                      setOffsetXDisplay(v);
                      setUserOffsetX(v);
                    }} />
                  <span style={{ fontSize: 11, color: "#555" }}>px</span>
                </div>
              </Row>
              <Row label="вниз:">
                <div className="flex items-center gap-1">
                  <input type="number" className={inp} style={{ ...ih, width: 60 }}
                    value={offsetYDisplay}
                    onChange={e => {
                      const v = +e.target.value || 0;
                      setOffsetYDisplay(v);
                      setUserOffsetY(v);
                    }} />
                  <span style={{ fontSize: 11, color: "#555" }}>px</span>
                </div>
              </Row>
            </Section>

            {/* Поля */}
            <Section title="Поля" defaultOpen={false}>
              {([["Верхнее:", marginTop, setMarginTop],["Нижнее:", marginBottom, setMarginBottom],
                 ["Левое:", marginLeft, setMarginLeft],["Правое:", marginRight, setMarginRight]
              ] as [string, number, (v: number) => void][]).map(([lbl, val, set]) => (
                <Row key={lbl} label={lbl}>
                  <div className="flex items-center gap-1">
                    <input type="number" min={0} max={50} className={inp} style={{ ...ih, width: 55 }}
                      value={val} onChange={e => set(Math.max(0, +e.target.value || 0))} />
                    <span style={{ fontSize: 11, color: "#555" }}>мм</span>
                  </div>
                </Row>
              ))}
            </Section>

            {/* Номера страниц */}
            <Section title="Номера страниц" defaultOpen={false}>
              {([
                [showPageNumbers, setShowPageNumbers, "Номера страниц"],
                [showFrame, setShowFrame, "Рамка"],
                [showStamp, setShowStamp, "Штамп (основная надпись)"],
              ] as [boolean, (v: boolean) => void, string][]).map(([v, set, label]) => (
                <label key={label} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={v} onChange={e => set(e.target.checked)}
                    style={{ accentColor: "#2563eb" }} />
                  <span style={{ fontSize: 12, color: "#1a1a1a" }}>{label}</span>
                </label>
              ))}
              {showStamp && (
                <div className="mt-2 space-y-1.5 border-t border-gray-300 pt-2">
                  {([["Номер:", drawingNumber, setDrawingNumber],["Название:", drawingTitle, setDrawingTitle],
                     ["Разработал:", engineer, setEngineer],["Проверил:", approvedBy, setApprovedBy],
                     ["Организация:", organization, setOrganization]
                  ] as [string, string, (v: string) => void][]).map(([lbl, val, set]) => (
                    <div key={lbl}>
                      <div style={{ fontSize: 11, color: "#333", marginBottom: 2 }}>{lbl}</div>
                      <input className={inp + " w-full"} style={ih} value={val} onChange={e => set(e.target.value)} />
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Сброс */}
            <div className="px-3 py-2">
              <button onClick={() => {
                setUserScale(null); setUserOffsetX(null); setUserOffsetY(null);
                setScaleDisplay(100); setOffsetXDisplay(0); setOffsetYDisplay(0);
                setMarginTop(5); setMarginBottom(5); setMarginLeft(5); setMarginRight(5);
                setShowPageNumbers(true); setShowFrame(false); setShowStamp(false);
              }} className="w-full py-0.5 text-[11px] border border-gray-400 rounded hover:bg-gray-200 bg-white text-gray-700">
                Сбросить настройки
              </button>
            </div>
          </div>

          {/* Предпросмотр */}
          <div className="flex-1 overflow-auto flex flex-col items-center justify-start p-5"
            style={{ background: "#6e6e6e" }}>

            {/* Лист */}
            <div style={{
              width: prevW, height: prevH, background: "white", flexShrink: 0,
              boxShadow: "4px 4px 20px rgba(0,0,0,0.65)", position: "relative",
            }}>
              {/* Рамка */}
              {showFrame && (
                <div style={{
                  position: "absolute", zIndex: 2, pointerEvents: "none",
                  top: px(marginTop), left: px(marginLeft),
                  right: px(marginRight), bottom: px(marginBottom + (showStamp ? 56 : 0)),
                  border: "1px solid #222",
                }} />
              )}

              {/* Схема — живой рендер через PrintPreviewCanvas */}
              <div style={{
                position: "absolute",
                top: px(marginTop), left: px(marginLeft),
                width: px(workArea.w), height: px(workArea.h),
                overflow: "hidden",
              }}>
                <PrintPreviewCanvas
                  ref={previewRef}
                  nodes={nodes}
                  branches={branches}
                  horizons={horizons}
                  schemaSymbols={schemaSymbols}
                  azimuth={viewState.azimuth}
                  elevation={viewState.elevation}
                  zScale={zScale}
                  is3D={viewState.elevation < 89.5 || viewState.azimuth !== 0}
                  scale={userScale ?? undefined}
                  offsetX={userOffsetX ?? undefined}
                  offsetY={userOffsetY ?? undefined}
                  width={Math.max(1, Math.round(px(workArea.w)))}
                  height={Math.max(1, Math.round(px(workArea.h)))}
                  branchWidth={branchWidth}
                  branchBorder={branchBorder}
                  thinLines={thinLines}
                  colorByHorizon={colorByHorizon}
                  flowDisplay={flowDisplay}
                  infoConfig={infoConfig}
                  unitsConfig={unitsConfig}
                />
              </div>

              {/* Штамп */}
              {showStamp && (
                <div style={{
                  position: "absolute", zIndex: 3,
                  bottom: px(marginBottom), right: px(marginRight),
                  width: px(185), height: px(55),
                  border: "1px solid #666", background: "white",
                  display: "grid", gridTemplateColumns: "1fr 1fr",
                  fontSize: Math.max(6, px(2.5)), color: "#333",
                }}>
                  <div style={{ borderRight: "1px solid #aaa", padding: "2px 4px" }}>
                    <div style={{ fontWeight: 600 }}>{drawingTitle || "Название"}</div>
                    {engineer && <div style={{ fontSize: "0.9em", color: "#666" }}>Разраб.: {engineer}</div>}
                  </div>
                  <div style={{ padding: "2px 4px", fontWeight: 700, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {drawingNumber || "Номер"}
                  </div>
                </div>
              )}

              {/* Номер страницы */}
              {showPageNumbers && (
                <div style={{
                  position: "absolute", zIndex: 3,
                  bottom: px(marginBottom + (showStamp ? 57 : 1)),
                  right: px(marginRight + 1),
                  fontSize: Math.max(8, px(3)), color: "#888",
                }}>1 / 1</div>
              )}
            </div>

            {/* Статус-строка */}
            <div className="flex items-center justify-between w-full mt-3 flex-shrink-0"
              style={{ color: "white", fontSize: 11, textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
              <span>{paper.w}×{paper.h} мм · {orientation === "landscape" ? "Альбомная" : "Книжная"} · Масштаб {scaleDisplay}%</span>
              <span>100 %</span>
            </div>
          </div>
        </div>

        {/* Кнопки внизу */}
        <div className="flex items-center justify-end gap-2 px-4 py-2 flex-shrink-0"
          style={{ background: "#efefef", borderTop: "1px solid #d0d0d0" }}>
          <button onClick={handlePrint}
            className="px-5 py-1.5 rounded text-[12px] font-semibold text-white hover:bg-blue-600"
            style={{ background: "#2563eb", border: "1px solid #1e4db7" }}>
            <Icon name="Printer" size={13} className="inline mr-1.5" />Печать
          </button>
          <button onClick={onClose}
            className="px-4 py-1.5 rounded text-[12px] border border-gray-400 bg-white hover:bg-gray-100 text-gray-700">
            Закрыть
          </button>
        </div>
      </div>

      {/* Диалог экспорта */}
      {showExportDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="bg-white rounded shadow-2xl border border-gray-400"
            style={{ width: 400, fontFamily: "Tahoma, Segoe UI, Arial, sans-serif" }}>

            <div className="flex items-center justify-between px-4 py-2"
              style={{ background: "linear-gradient(180deg,#4a7fc8,#3060a8)", borderRadius: "4px 4px 0 0" }}>
              <div className="flex items-center gap-2">
                <Icon name="Download" size={14} className="text-white" />
                <span className="text-white font-bold text-[13px]">Экспорт схемы</span>
              </div>
              <button onClick={() => setShowExportDialog(false)}
                className="text-white hover:bg-red-500 w-5 h-5 flex items-center justify-center rounded">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 8 }}>Формат файла:</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["png","jpg","bmp","tiff","svg","pdf"] as const).map(f => (
                    <button key={f} onClick={() => setExportFormat(f)}
                      className="py-1.5 rounded border text-[12px] font-semibold uppercase"
                      style={{
                        background: exportFormat === f ? "#2563eb" : "white",
                        color: exportFormat === f ? "white" : "#1a1a1a",
                        borderColor: exportFormat === f ? "#2563eb" : "#9ca3af",
                      }}>{f.toUpperCase()}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                  {exportFormat === "png"  && "PNG — без потерь, рекомендуется"}
                  {exportFormat === "jpg"  && "JPEG — с потерями, меньше размер"}
                  {exportFormat === "bmp"  && "BMP — без сжатия"}
                  {exportFormat === "tiff" && "TIFF — для полиграфии"}
                  {exportFormat === "svg"  && "SVG — векторный формат"}
                  {exportFormat === "pdf"  && "PDF — через диалог печати"}
                </div>
              </div>

              {!["svg","pdf"].includes(exportFormat) && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 8 }}>Разрешение (DPI):</div>
                  <div className="flex gap-2 mb-2">
                    {[72,96,150,300,600].map(d => (
                      <button key={d} onClick={() => setExportDpi(d)}
                        className="flex-1 py-1 rounded border text-[11px] font-medium"
                        style={{
                          background: exportDpi === d ? "#2563eb" : "white",
                          color: exportDpi === d ? "white" : "#1a1a1a",
                          borderColor: exportDpi === d ? "#2563eb" : "#9ca3af",
                        }}>{d}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12, color: "#333" }}>Своё:</span>
                    <input type="number" min={36} max={1200} value={exportDpi}
                      onChange={e => setExportDpi(Math.max(36, Math.min(1200, +e.target.value || 96)))}
                      className="border border-gray-400 rounded px-2 text-[12px] text-gray-900"
                      style={{ width: 70, height: 24 }} />
                    <span style={{ fontSize: 11, color: "#555" }}>dpi</span>
                  </div>
                </div>
              )}

              {exportFormat === "jpg" && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>
                    Качество: {exportQuality}%
                  </div>
                  <input type="range" min={10} max={100} step={5}
                    value={exportQuality} onChange={e => setExportQuality(+e.target.value)}
                    className="w-full" style={{ accentColor: "#2563eb" }} />
                </div>
              )}
            </div>

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