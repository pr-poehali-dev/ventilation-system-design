// Диалог импорта CSV из ПО Вентиляция 2.0 с настраиваемым маппингом столбцов
import { useState, useRef } from "react";
import {
  parseVent2Csv,
  type CsvImportResult,
  type Vent2ColMap,
  type Vent2ParseOptions,
  VENT2_DEFAULT_COLS,
} from "@/lib/csvImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: CsvImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

type Sep = ";" | "," | "\t";

// ── Поле настройки номера столбца ────────────────────────────────────────────
function ColInput({
  label, value, onChange, hint,
}: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] text-gray-700 flex-1 truncate" title={hint ?? label}>{label}</span>
      <input
        type="number" min={0} max={99} step={1}
        value={value === 0 ? "" : value}
        placeholder="—"
        onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-10 text-center text-[11px] border border-gray-300 rounded px-1 py-0.5 bg-white"
        title={hint}
      />
    </div>
  );
}

// ── Зона перетаскивания файла ─────────────────────────────────────────────────
function DropZone({
  label, fileName, onFile, accept,
}: { label: string; fileName: string; onFile: (f: File) => void; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onDragOver={e => e.preventDefault()}
      className="flex items-center gap-2 cursor-pointer rounded border border-dashed px-3 py-2 hover:bg-blue-50 transition-colors"
      style={{ borderColor: fileName ? "#22c55e" : "#9ca3af", background: fileName ? "#f0fdf4" : "#fafafa" }}>
      <Icon name={fileName ? "FileCheck" : "FileText"} size={16}
        className={fileName ? "text-green-600 flex-shrink-0" : "text-gray-400 flex-shrink-0"} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-gray-700 truncate">{label}</div>
        <div className="text-[10px] truncate" style={{ color: fileName ? "#16a34a" : "#9ca3af" }}>
          {fileName || "Перетащите файл или нажмите для выбора"}
        </div>
      </div>
      <button onClick={e => e.stopPropagation()} className="flex-shrink-0">
        <Icon name="FolderOpen" size={14} className="text-gray-400" />
      </button>
      <input ref={ref} type="file" accept={accept ?? ".csv,.txt,.CSV"} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

export default function Vent2CsvImportDialog({ onImport, onClose }: Props) {
  const [cols, setCols] = useState<Vent2ColMap>({ ...VENT2_DEFAULT_COLS });
  const [sep, setSep] = useState<Sep>(";");
  const [rUnit, setRUnit] = useState<"kmu" | "si" | "auto">("auto");
  const [mode, setMode] = useState<"replace" | "append">("replace");

  const [branchFile, setBranchFile] = useState<File | null>(null);
  const [bkFile, setBkFile]         = useState<File | null>(null);
  const [fanFile, setFanFile]       = useState<File | null>(null);
  const [hasBulkheads, setHasBulkheads] = useState(true);
  const [hasFans, setHasFans]           = useState(true);

  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCol = (key: keyof Vent2ColMap) => (v: number) =>
    setCols(prev => ({ ...prev, [key]: v }));

  const readFile = async (file: File): Promise<string> => {
    let text = await file.text();
    if (text.includes("â€") || text.includes("\uFFFD")) {
      const buf = await file.arrayBuffer();
      text = new TextDecoder("windows-1251").decode(buf);
    }
    return text;
  };

  const handleParse = async () => {
    if (!branchFile) { setError("Выберите файл выработок"); return; }
    setError(null); setLoading(true);
    try {
      const brContent  = await readFile(branchFile);
      const bkContent  = (hasBulkheads && bkFile)  ? await readFile(bkFile)  : undefined;
      const fanContent = (hasFans && fanFile)       ? await readFile(fanFile) : undefined;

      const opts: Vent2ParseOptions = {
        cols, sep, resistanceUnit: rUnit,
        hasBulkheads: hasBulkheads && !!bkFile,
        bulkheadContent: bkContent,
        hasFans: hasFans && !!fanFile,
        fanContent,
      };
      const res = parseVent2Csv(brContent, opts);
      setResult(res);
    } catch (e) {
      setError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    if (result) { onImport(result, mode); onClose(); }
  };

  const canImport = !!result && result.branches.length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="flex flex-col shadow-2xl overflow-hidden"
        style={{ width: 760, maxHeight: "92vh", background: "#f4f4f4", border: "1px solid #999", borderRadius: 4 }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2 flex-shrink-0"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d5d5d5)", borderBottom: "1px solid #bbb" }}>
          <div className="flex items-center gap-2">
            <Icon name="FileText" size={16} className="text-blue-700" />
            <span className="text-[13px] font-semibold text-gray-800">Импорт CSV из ПО Вентиляция 2.0</span>
          </div>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-red-500 hover:text-white rounded">✕</button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ── Левая панель: файлы + настройки ─────────────────────────── */}
          <div className="flex flex-col gap-3 p-3 overflow-y-auto flex-shrink-0"
            style={{ width: 320, borderRight: "1px solid #ccc" }}>

            {/* Схема и разделитель */}
            <div className="flex items-center gap-3">
              <div className="text-[11px] font-medium text-gray-600">Схема:</div>
              <div className="px-2 py-0.5 rounded text-[11px] font-semibold"
                style={{ background: "#dbeafe", color: "#1e40af" }}>Вентиляция 2.0</div>
              <div className="ml-auto flex items-center gap-1 text-[11px] text-gray-600">
                Разделитель:
                <select value={sep} onChange={e => setSep(e.target.value as Sep)}
                  className="text-[11px] border border-gray-300 rounded px-1 py-0.5 bg-white ml-1">
                  <option value=";">; (точка с запятой)</option>
                  <option value=",">, (запятая)</option>
                  <option value={"\t"}>Tab</option>
                </select>
              </div>
            </div>

            {/* Файлы */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Файлы CSV</div>
              <div className="space-y-1.5">
                <DropZone label="Выработки *" fileName={branchFile?.name ?? ""}
                  onFile={setBranchFile} />
                <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={hasBulkheads} onChange={e => setHasBulkheads(e.target.checked)} />
                  Перемычки
                </label>
                {hasBulkheads && (
                  <DropZone label="Перемычки" fileName={bkFile?.name ?? ""}
                    onFile={setBkFile} />
                )}
                <label className="flex items-center gap-2 text-[11px] text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={hasFans} onChange={e => setHasFans(e.target.checked)} />
                  Источники тяги
                </label>
                {hasFans && (
                  <DropZone label="Источники тяги" fileName={fanFile?.name ?? ""}
                    onFile={setFanFile} />
                )}
              </div>
            </div>

            {/* Единицы R */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 mb-1 uppercase tracking-wide">Единицы сопротивления</div>
              <div className="flex flex-col gap-0.5">
                {([["auto","Авто (рекомендуется)"],["kmu","кМюрг (÷1000)"],["si","Нс²/м⁸ (СИ)"]] as const).map(([v,l]) => (
                  <label key={v} className="flex items-center gap-2 text-[11px] text-gray-700 cursor-pointer">
                    <input type="radio" name="runit2" value={v} checked={rUnit === v}
                      onChange={() => setRUnit(v)} />
                    {l}
                  </label>
                ))}
              </div>
            </div>

            {/* Режим импорта */}
            <div>
              <div className="text-[11px] font-semibold text-gray-600 mb-1 uppercase tracking-wide">Режим</div>
              <div className="flex gap-2">
                {(["replace","append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                    <input type="radio" name="mode2" value={m} checked={mode === m}
                      onChange={() => setMode(m)} />
                    {m === "replace" ? "Заменить" : "Добавить к схеме"}
                  </label>
                ))}
              </div>
            </div>

          </div>

          {/* ── Правая панель: маппинг столбцов ──────────────────────────── */}
          <div className="flex flex-col flex-1 overflow-y-auto p-3 gap-3">

            {/* Выработки */}
            <div className="rounded border border-gray-300 overflow-hidden">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-blue-800 flex items-center gap-2"
                style={{ background: "#dbeafe", borderBottom: "1px solid #bfdbfe" }}>
                <Icon name="GitBranch" size={13} />
                Столбцы в файле выработок
                <span className="ml-auto text-[10px] text-blue-500 font-normal">0 = не импортировать</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 px-3 py-2">
                <ColInput label="Ид выработки *"      value={cols.id}         onChange={setCol("id")} />
                <ColInput label="Нач. вершина *"       value={cols.from}       onChange={setCol("from")} />
                <ColInput label="Кон. вершина *"       value={cols.to}         onChange={setCol("to")} />
                <ColInput label="Название"             value={cols.name}       onChange={setCol("name")} />
                <ColInput label="Длина, м"             value={cols.length}     onChange={setCol("length")} />
                <ColInput label="Тип"                  value={cols.type}       onChange={setCol("type")} />
                <ColInput label="Сечение, м²"          value={cols.area}       onChange={setCol("area")} />
                <ColInput label="Периметр, м"          value={cols.perimeter}  onChange={setCol("perimeter")} />
                <ColInput label="Расход, м³/с"         value={cols.flow}       onChange={setCol("flow")} />
                <ColInput label="Сопротивление"        value={cols.resistance} onChange={setCol("resistance")}
                  hint="Сопротивление выработки" />
                <ColInput label="Суммарное сопр."      value={cols.sumR}       onChange={setCol("sumR")}
                  hint="Суммарное сопротивление (вместо сопр. выработки)" />
                <ColInput label="Слой"                 value={cols.layer}      onChange={setCol("layer")} />
              </div>
            </div>

            {/* Перемычки */}
            {hasBulkheads && (
              <div className="rounded border border-gray-300 overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-amber-800 flex items-center gap-2"
                  style={{ background: "#fef3c7", borderBottom: "1px solid #fde68a" }}>
                  <Icon name="Square" size={13} />
                  Столбцы в файле перемычек
                </div>
                <div className="grid grid-cols-2 gap-x-4 px-3 py-2">
                  <ColInput label="Ид выработки *"   value={cols.bk_branchId}  onChange={setCol("bk_branchId")} />
                  <ColInput label="Смещение"          value={cols.bk_offset}    onChange={setCol("bk_offset")} />
                  <ColInput label="Тип перемычки"     value={cols.bk_type}      onChange={setCol("bk_type")} />
                  <ColInput label="Сопротивление"     value={cols.bk_resistance} onChange={setCol("bk_resistance")} />
                </div>
              </div>
            )}

            {/* Вентиляторы */}
            {hasFans && (
              <div className="rounded border border-gray-300 overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-red-800 flex items-center gap-2"
                  style={{ background: "#fee2e2", borderBottom: "1px solid #fecaca" }}>
                  <Icon name="Wind" size={13} />
                  Столбцы в файле источников тяги
                </div>
                <div className="grid grid-cols-2 gap-x-4 px-3 py-2">
                  <ColInput label="Ид выработки *"  value={cols.fan_branchId} onChange={setCol("fan_branchId")} />
                  <ColInput label="Смещение"         value={cols.fan_offset}   onChange={setCol("fan_offset")} />
                  <ColInput label="Напор, Па"        value={cols.fan_pressure} onChange={setCol("fan_pressure")} />
                </div>
              </div>
            )}

            {/* Результат */}
            {result && (
              <div className="rounded border px-3 py-2 text-[11px] space-y-0.5"
                style={{ background: "#f0fdf4", borderColor: "#86efac" }}>
                <div className="font-semibold text-green-800">Результат анализа:</div>
                <div className="text-green-700">✓ Узлов: {result.stats.nodes} · Ветвей: {result.stats.branches}</div>
                {result.stats.bulkheads > 0 && <div className="text-green-700">✓ Перемычек: {result.stats.bulkheads}</div>}
                {result.stats.fans > 0 && <div className="text-green-700">✓ Вентиляторов: {result.stats.fans}</div>}
                {result.warnings.map((w, i) => (
                  <div key={i} className="text-amber-700">⚠ {w}</div>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded border border-red-300 px-3 py-2 text-[11px] text-red-700"
                style={{ background: "#fef2f2" }}>⚠ {error}</div>
            )}
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex items-center justify-between px-4 py-2 flex-shrink-0"
          style={{ background: "#e8e8e8", borderTop: "1px solid #ccc" }}>
          <button onClick={onClose}
            className="px-4 py-1 text-[12px] rounded border border-gray-400 bg-white hover:bg-gray-100">
            Отмена
          </button>
          <div className="flex gap-2">
            <button onClick={handleParse} disabled={!branchFile || loading}
              className="flex items-center gap-2 px-4 py-1 text-[12px] rounded border disabled:opacity-40"
              style={{ background: "#dbeafe", borderColor: "#93c5fd", color: "#1e40af" }}>
              {loading
                ? <><div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Анализ...</>
                : <><Icon name="Play" size={13} />Анализ</>}
            </button>
            <button onClick={handleImport} disabled={!canImport}
              className="flex items-center gap-2 px-5 py-1 text-[12px] rounded border disabled:opacity-40"
              style={{ background: canImport ? "#16a34a" : "#86efac", borderColor: "#15803d", color: "white" }}>
              <Icon name="Download" size={13} />
              Импорт
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
