// ─────────────────────────────────────────────────────────────────────────────
// PrintSettingsPanel.tsx — левая панель диалога печати: кнопки «Печать» и
// «Экспорт», шаблоны настроек, основные параметры, печатный диапазон, размер
// бумаги, преобразование схемы (масштаб и сдвиг), поля и номера страниц.
//
// Вынесено из PrintDialog.tsx БЕЗ изменений разметки, стилей и обработчиков.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import {
  Section, Row, inp, sel, ih, PAPER_SIZES, type PaperFormat, type Orientation,
} from "@/components/cad/printPreview/printDialogParts";

interface PrintSettingsPanelProps {
  handlePrint: () => void;
  printing: boolean;
  printProgress: { done: number; total: number } | null;
  setShowExportDialog: (v: boolean) => void;
  templates: Record<string, object>;
  loadTemplate: (name: string) => void;
  saveTemplate: () => void;
  deleteTemplate: (name: string) => void;
  templateName: string;
  setTemplateName: (v: string) => void;
  format: PaperFormat;
  setFormat: (v: PaperFormat) => void;
  orientation: Orientation;
  setOrientation: (v: Orientation) => void;
  customW: number;
  setCustomW: (v: number) => void;
  customH: number;
  setCustomH: (v: number) => void;
  copies: number;
  setCopies: (v: number) => void;
  reverseOrder: boolean;
  setReverseOrder: (v: boolean) => void;
  pageRange: string;
  setPageRange: (v: string) => void;
  scaleDisplay: number;
  setScaleDisplay: (v: number) => void;
  offsetXDisplay: number;
  setOffsetXDisplay: (v: number) => void;
  offsetYDisplay: number;
  setOffsetYDisplay: (v: number) => void;
  setUserScale: (v: number | null) => void;
  setUserOffsetX: (v: number | null) => void;
  setUserOffsetY: (v: number | null) => void;
  marginTop: number;
  setMarginTop: (v: number) => void;
  marginBottom: number;
  setMarginBottom: (v: number) => void;
  marginLeft: number;
  setMarginLeft: (v: number) => void;
  marginRight: number;
  setMarginRight: (v: number) => void;
  showPageNumbers: boolean;
  setShowPageNumbers: (v: boolean) => void;
  paper: { w: number; h: number };
  baseView: { defaultOffsetX: number; defaultOffsetY: number };
}

export default function PrintSettingsPanel({
  handlePrint, printing, printProgress, setShowExportDialog, templates, loadTemplate, saveTemplate, deleteTemplate,
  templateName, setTemplateName, format, setFormat, orientation, setOrientation,
  customW, setCustomW, customH, setCustomH, copies, setCopies,
  reverseOrder, setReverseOrder, pageRange, setPageRange,
  scaleDisplay, setScaleDisplay, offsetXDisplay, setOffsetXDisplay,
  offsetYDisplay, setOffsetYDisplay, setUserScale, setUserOffsetX, setUserOffsetY,
  marginTop, setMarginTop, marginBottom, setMarginBottom,
  marginLeft, setMarginLeft, marginRight, setMarginRight,
  showPageNumbers, setShowPageNumbers, paper, baseView,
}: PrintSettingsPanelProps) {
  return (
<div className="flex-shrink-0 overflow-y-auto border-r border-gray-300"
  style={{ width: 215, background: "#f4f4f4", color: "#1a1a1a" }}>

  {/* Кнопки */}
  <div className="flex gap-2 px-2 py-2 border-b border-gray-300">
    <button onClick={handlePrint} disabled={printing}
      className="flex flex-col items-center gap-0.5 flex-1 py-1.5 hover:bg-gray-200 rounded border border-gray-300 bg-white disabled:opacity-60">
      <Icon name={printing ? "Loader" : "Printer"} size={22}
        className={printing ? "text-gray-700 animate-spin" : "text-gray-700"} />
      <span style={{ fontSize: 11, color: "#222" }}>
        {printing
          ? (printProgress && printProgress.total > 1
              ? `${printProgress.done} / ${printProgress.total}`
              : "Подготовка…")
          : "Печать"}
      </span>
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
        {(["A4","A3","A2","A1","A0"] as Exclude<PaperFormat, "custom">[]).map(f =>
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
            // userScale = множитель относительно fit (100% = fit = 1.0)
            setUserScale(v / 100);
          }} />
        <span style={{ fontSize: 11, color: "#555" }}>%</span>
      </div>
    </Row>
    <button onClick={() => {
      // 100% = fit в 1 лист
      setUserScale(null);
      setUserOffsetX(null); setUserOffsetY(null);
      setOffsetXDisplay(0); setOffsetYDisplay(0);
      setScaleDisplay(100);
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
            const mm = +e.target.value || 0;
            setOffsetXDisplay(mm);
            // дельта от дефолтного положения
            setUserOffsetX(baseView.defaultOffsetX + mm * 150 / 25.4);
          }} />
        <span style={{ fontSize: 11, color: "#555" }}>мм</span>
      </div>
    </Row>
    <Row label="вниз:">
      <div className="flex items-center gap-1">
        <input type="number" className={inp} style={{ ...ih, width: 60 }}
          value={offsetYDisplay}
          onChange={e => {
            const mm = +e.target.value || 0;
            setOffsetYDisplay(mm);
            setUserOffsetY(baseView.defaultOffsetY + mm * 150 / 25.4);
          }} />
        <span style={{ fontSize: 11, color: "#555" }}>мм</span>
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
    <label className="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={showPageNumbers} onChange={e => setShowPageNumbers(e.target.checked)}
        style={{ accentColor: "#2563eb" }} />
      <span style={{ fontSize: 12, color: "#1a1a1a" }}>Номера страниц</span>
    </label>
    <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
      Рамка, штамп и УО управляются через «Слой печати» в панели горизонтов.
    </p>
  </Section>

  {/* Сброс */}
  <div className="px-3 py-2">
    <button onClick={() => {
      setUserScale(null); setUserOffsetX(null); setUserOffsetY(null);
      setScaleDisplay(100); setOffsetXDisplay(0); setOffsetYDisplay(0);
      setMarginTop(5); setMarginBottom(5); setMarginLeft(5); setMarginRight(5);
      setShowPageNumbers(true);
    }} className="w-full py-0.5 text-[11px] border border-gray-400 rounded hover:bg-gray-200 bg-white text-gray-700">
      Сбросить настройки
    </button>
  </div>
</div>
  );
}