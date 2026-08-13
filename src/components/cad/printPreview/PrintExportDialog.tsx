// ─────────────────────────────────────────────────────────────────────────────
// PrintExportDialog.tsx — окно экспорта схемы: выбор формата (PNG/JPG/BMP/
// SVG/PDF), разрешения в точках на дюйм и качества сжатия.
//
// Вынесено из PrintDialog.tsx БЕЗ изменений разметки, текстов и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import Icon from "@/components/ui/icon";

// Набор форматов — ровно тот же, что в состоянии PrintDialog.
// В списке ниже есть ещё "tiff": так было в исходном коде, поведение сохранено.
type ExportFormat = "png" | "png-hq" | "jpg" | "bmp" | "svg" | "pdf" | "pdf-vector";

interface PrintExportDialogProps {
  exportFormat: ExportFormat;
  setExportFormat: React.Dispatch<React.SetStateAction<ExportFormat>>;
  exportDpi: number;
  setExportDpi: (v: number) => void;
  exportQuality: number;
  setExportQuality: (v: number) => void;
  pdfExporting: boolean;
  handleExport: () => void;
  setShowExportDialog: (v: boolean) => void;
  paper: { w: number; h: number };
}

export default function PrintExportDialog({
  exportFormat, setExportFormat, exportDpi, setExportDpi,
  exportQuality, setExportQuality, pdfExporting, handleExport, setShowExportDialog, paper,
}: PrintExportDialogProps) {
  return (
<div className="fixed inset-0 z-[10000] flex items-center justify-center"
  style={{ background: "rgba(0,0,0,0.6)", pointerEvents: "auto" }}>
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
          {(["png","png-hq","jpg","bmp","tiff","svg","pdf","pdf-vector"] as const).map(f => (
            <button key={f} onClick={() => setExportFormat(f)}
              className="py-1.5 rounded border text-[12px] font-semibold uppercase"
              style={{
                background: exportFormat === f ? "#2563eb" : "white",
                color: exportFormat === f ? "white" : "#1a1a1a",
                borderColor: exportFormat === f ? "#2563eb" : "#9ca3af",
              }}>
              {f === "pdf-vector" ? "PDF ✦" : f === "png-hq" ? "PNG ★" : f.toUpperCase()}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
          {exportFormat === "png"        && "PNG — растр, без потерь. Рекомендуется для экрана."}
          {exportFormat === "png-hq"     && <span style={{ color: "#1a6e2e", fontWeight: 600 }}>PNG ★ — высококачественный растр через SVG-вектор. Рамка, штамп, УО — всё чётко при любом DPI. Идеально для широкоформатной печати.</span>}
          {exportFormat === "jpg"        && "JPEG — растр, с потерями, меньше размер"}
          {exportFormat === "bmp"        && "BMP — растр, без сжатия"}
          {exportFormat === "tiff"       && "TIFF — растр, для полиграфии"}
          {exportFormat === "svg"        && "SVG — вектор, идеально для плоттера, масштаб бесконечен"}
          {exportFormat === "pdf"        && "PDF — растровый, все страницы, выбранный DPI"}
          {exportFormat === "pdf-vector" && "PDF ✦ — векторный, идеально для плоттера. Конвертируется на сервере из SVG."}
        </div>
      </div>

      {!["svg", "pdf-vector"].includes(exportFormat) && (
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
          {(() => {
            const pw = Math.round(paper.w * exportDpi / 25.4);
            const ph = Math.round(paper.h * exportDpi / 25.4);
            const isMobile = /Mobi|Android/i.test(navigator.userAgent);
            const MAX_PX = isMobile ? 8192 : 32768;
            const clipped = pw > MAX_PX || ph > MAX_PX;
            const effW = Math.min(pw, MAX_PX);
            const effH = Math.min(ph, MAX_PX);
            return (
              <div style={{ fontSize: 11, marginTop: 6, color: clipped ? "#b45309" : "#555" }}>
                Размер: {effW} × {effH} пикс.
                {clipped && <span> (ограничено браузером — исходный {pw}×{ph})</span>}
                {exportFormat === "png-hq" && !clipped && <span style={{ color: "#1a6e2e" }}> — вектор без пикселизации</span>}
              </div>
            );
          })()}
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
      <button onClick={handleExport} disabled={pdfExporting}
        className="px-5 py-1.5 rounded text-[12px] font-semibold text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-wait"
        style={{ background: "#2563eb", border: "1px solid #1e4db7" }}>
        {pdfExporting
          ? <><Icon name="Loader" size={13} className="inline mr-1.5 animate-spin" />{exportFormat === "pdf-vector" ? "Конвертация SVG→PDF..." : exportFormat === "png-hq" ? "Рендер PNG HQ..." : "Генерация PDF..."}</>
          : <><Icon name="Download" size={13} className="inline mr-1.5" />Скачать {exportFormat === "pdf-vector" ? "PDF ✦ вектор" : exportFormat === "png-hq" ? "PNG ★ HQ" : exportFormat.toUpperCase()}</>
        }
      </button>
      <button onClick={() => setShowExportDialog(false)} disabled={pdfExporting}
        className="px-4 py-1.5 rounded text-[12px] border border-gray-400 bg-white hover:bg-gray-100 text-gray-700 disabled:opacity-60">
        Отмена
      </button>
    </div>
  </div>
</div>
  );
}
