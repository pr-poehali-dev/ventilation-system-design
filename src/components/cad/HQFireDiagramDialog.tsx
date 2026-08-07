// ─────────────────────────────────────────────────────────────────────────────
// HQFireDiagramDialog — увеличенный просмотр h–Q диаграммы пожара (Прил. 2)
// с экспортом в Excel: лист с полноценной диаграммой (нативный график Excel,
// который можно редактировать) + лист с таблицей исходных точек кривых.
// ─────────────────────────────────────────────────────────────────────────────

import { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import Icon from "@/components/ui/icon";
import HQFireDiagram from "./HQFireDiagram";
import { exportHQDiagramToExcel, type HQDiagramData } from "@/lib/hqDiagramExcel";

interface Props {
  open: boolean;
  onClose: () => void;
  data: HQDiagramData;
  branchName?: string;
}

export default function HQFireDiagramDialog({ open, onClose, data, branchName }: Props) {
  const svgWrapRef = useRef<HTMLDivElement>(null);

  const { Ry, Qa, Qb, hT, hKr, pU, reversed, ascending } = data;

  const handleExcel = () => {
    exportHQDiagramToExcel(data, branchName);
  };

  // Сохранение картинки диаграммы (PNG) — для вставки в отчёты и презентации.
  const handlePng = () => {
    const svg = svgWrapRef.current?.querySelector("svg");
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2; // ретина-качество для печати
      const canvas = document.createElement("canvas");
      canvas.width = (svg.clientWidth || 900) * scale;
      canvas.height = (svg.clientHeight || 560) * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `Диаграмма h-Q${branchName ? ` ${branchName}` : ""}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    };
    img.src = url;
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[1000px] p-0 gap-0">
        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2 border-b" style={{ background: "#fef2f2", borderColor: "#fecaca" }}>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: "#991b1b" }}>
              Режим проветривания уклонного поля (h–Q, {ascending ? "восходящее, рис. 2.2" : "нисходящее, рис. 2.1,б"})
            </div>
            {branchName && <div className="text-[11px] text-gray-500">{branchName}</div>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePng}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border bg-white hover:bg-gray-50"
              style={{ borderColor: "#d1d5db", color: "#374151" }}
              title="Сохранить диаграмму как изображение PNG"
            >
              <Icon name="Image" size={13} /> PNG
            </button>
            <button
              onClick={handleExcel}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded text-white"
              style={{ background: "#16794a" }}
              title="Экспорт в Excel: полноценная диаграмма + таблица точек кривых"
            >
              <Icon name="Sheet" size={13} /> Экспорт в Excel
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/70" title="Закрыть">
              <Icon name="X" size={16} />
            </button>
          </div>
        </div>

        {/* Увеличенная диаграмма */}
        <div ref={svgWrapRef} className="flex justify-center p-4 bg-white">
          <HQFireDiagram
            Ry={Ry} Qa={Qa} Qb={Qb} hT={hT} hKr={hKr} pU={pU}
            reversed={reversed} ascending={ascending}
            width={920} height={520}
          />
        </div>

        {/* Расшифровка */}
        <div className="px-4 pb-3 text-[11px] leading-relaxed text-gray-600 border-t pt-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <div><b style={{ color: "#0369a1" }}>Кривая 1</b> — характеристика уклонного поля h = R·Q²</div>
            <div><b style={{ color: "#c2410c" }}>Кривая 2</b> — тепловая депрессия пожара h_т = {hT.toFixed(1)} Па</div>
            <div><b style={{ color: "#dc2626" }}>Кривая 3</b> — активизированная характеристика h_т + R·Q²</div>
            {hKr !== undefined && hKr > 0 && (
              <div><b style={{ color: "#7c3aed" }}>h_кр</b> — критическая депрессия = {hKr.toFixed(1)} Па</div>
            )}
            <div><b style={{ color: "#0369a1" }}>A</b> — режим до пожара, Q = {Math.abs(Qa).toFixed(2)} м³/с</div>
            <div>
              <b style={{ color: "#dc2626" }}>{ascending ? "E" : "B"}</b> — режим при пожаре, Q = {Math.abs(Qb).toFixed(2)} м³/с
              {ascending ? " (растёт)" : " (падает)"}
            </div>
            {!ascending && <div><b style={{ color: "#7c3aed" }}>C</b> — критический режим (Q = 0)</div>}
            {reversed && <div><b style={{ color: "#450a0a" }}>D</b> — опрокидывание струи (Q &lt; 0)</div>}
          </div>
          {pU !== undefined && (
            <div className="mt-2 pt-2 border-t">
              Показатель устойчивости p_у = h_кр/h_т = <b>{pU.toFixed(3)}</b> —{" "}
              {pU > 1 ? "выработка устойчивая" : pU < 0.3 ? "весьма неустойчивая (p_у < 0.3)" : "неустойчивая"}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
