// Диалог комбинированного импорта DXF + Excel (Вентиляция 2.0)
import { useState, useRef } from "react";
import { parseDxf, type DxfImportResult } from "@/lib/dxfImport";
import { parseExcel, type ExcelImportResult } from "@/lib/excelImport";
import { combineImports, type CombinedImportResult } from "@/lib/combinedImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: CombinedImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function CombinedImportDialog({ onImport, onClose }: Props) {
  const [dxfFile, setDxfFile] = useState<File | null>(null);
  const [xlsFile, setXlsFile] = useState<File | null>(null);
  const [dxfResult, setDxfResult] = useState<DxfImportResult | null>(null);
  const [xlsResult, setXlsResult] = useState<ExcelImportResult | null>(null);
  const [combined, setCombined] = useState<CombinedImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState<"dxf" | "xls" | "combine" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const dxfRef = useRef<HTMLInputElement>(null);
  const xlsRef = useRef<HTMLInputElement>(null);

  const handleDxf = async (f: File) => {
    setDxfFile(f);
    setDxfResult(null);
    setCombined(null);
    setError(null);
    setLoading("dxf");
    try {
      let text = await f.text();
      if (text.includes("â€") || text.includes("\uFFFD")) {
        const buf = await f.arrayBuffer();
        text = new TextDecoder("windows-1251").decode(buf);
      }
      const result = parseDxf(text);
      setDxfResult(result);
      if (xlsResult) mergeBoth(result, xlsResult);
    } catch (e) {
      setError(`DXF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(null);
    }
  };

  const handleXls = async (f: File) => {
    setXlsFile(f);
    setXlsResult(null);
    setCombined(null);
    setError(null);
    setLoading("xls");
    try {
      const buf = await f.arrayBuffer();
      const result = parseExcel(buf);
      setXlsResult(result);
      if (dxfResult) mergeBoth(dxfResult, result);
    } catch (e) {
      setError(`Excel: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(null);
    }
  };

  const mergeBoth = (dxf: DxfImportResult, xls: ExcelImportResult) => {
    setLoading("combine");
    try {
      const result = combineImports(dxf, xls);
      setCombined(result);
    } finally {
      setLoading(null);
    }
  };

  const FileZone = ({
    label, hint, accept, file, status, loading: isLoading, inputRef, onFile,
  }: {
    label: string; hint: string; accept: string;
    file: File | null; status: string | null; loading: boolean;
    inputRef: React.RefObject<HTMLInputElement>;
    onFile: (f: File) => void;
  }) => (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-gray-700">{label}</div>
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        onDragOver={(e) => e.preventDefault()}
        className="flex items-center gap-3 cursor-pointer rounded border-2 border-dashed px-3 py-3 hover:bg-blue-50 transition-colors"
        style={{ borderColor: file ? "#2563eb" : "#9ca3af", background: file ? "#eff6ff" : "#fafafa" }}>
        <Icon name={file ? "CheckCircle" : "Upload"} size={20}
          className={file ? "text-blue-600" : "text-gray-400"} />
        <div className="flex-1 min-w-0">
          {file ? (
            <div className="text-xs font-medium text-blue-700 truncate">{file.name}</div>
          ) : (
            <div className="text-xs text-gray-500">{hint}</div>
          )}
          {status && <div className="text-[10px] text-green-700 mt-0.5">{status}</div>}
          {isLoading && <div className="text-[10px] text-blue-500 mt-0.5">Анализирую...</div>}
        </div>
        {file && <Icon name="RefreshCw" size={14} className="text-gray-400 shrink-0" />}
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col shadow-2xl"
        style={{ width: 540, maxHeight: "88vh", background: "#f5f5f5", border: "1px solid #999" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">Импорт DXF + Excel</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded text-blue-700 border border-blue-300"
              style={{ background: "#dbeafe" }}>Вентиляция 2.0</span>
          </div>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Инструкция */}
          <div className="text-xs rounded border border-blue-100 px-3 py-2 space-y-1"
            style={{ background: "#eff6ff" }}>
            <div className="font-semibold text-blue-800">Как экспортировать из Вентиляции 2.0:</div>
            <div className="text-blue-700">1. <b>DXF</b> — схема → экспорт в DXF (план, вид сверху)</div>
            <div className="text-blue-700">2. <b>Excel</b> — Отчёты → Список ветвей + Список узлов → .xlsx</div>
            <div className="text-blue-700">DXF даёт расположение, Excel даёт параметры и глубины.</div>
          </div>

          {/* Зоны файлов */}
          <FileZone
            label="Шаг 1 — DXF файл (координаты X/Y)"
            hint="Схема .dxf из Вентиляции — для расположения узлов на плане"
            accept=".dxf,.DXF"
            file={dxfFile}
            status={dxfResult ? `${dxfResult.stats.nodes} узлов, ${dxfResult.stats.branches} ветвей` : null}
            loading={loading === "dxf"}
            inputRef={dxfRef}
            onFile={handleDxf}
          />

          <FileZone
            label="Шаг 2 — Excel файл (параметры и глубины)"
            hint="Выгрузка .xlsx из Вентиляции — длины, сечения, Z-координаты"
            accept=".xlsx,.xls,.csv"
            file={xlsFile}
            status={xlsResult ? `${xlsResult.stats.nodes} узлов, ${xlsResult.stats.branches} ветвей, Z: ${xlsResult.stats.nodesWithZ}` : null}
            loading={loading === "xls"}
            inputRef={xlsRef}
            onFile={handleXls}
          />

          {error && (
            <div className="px-3 py-2 rounded text-xs text-red-700 border border-red-300"
              style={{ background: "#fef2f2" }}>{error}</div>
          )}

          {/* Результат сшивки */}
          {combined && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Узлов",     value: combined.stats.nodes },
                  { label: "Ветвей",    value: combined.stats.branches },
                  { label: "С X/Y",     value: combined.stats.nodesWithXY,     hi: combined.stats.nodesWithXY > 0 },
                  { label: "С Z≠0",     value: combined.stats.nodesWithZ,      hi: combined.stats.nodesWithZ > 0 },
                ].map(s => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dbeafe" : "#f9f9f9", borderColor: s.hi ? "#93c5fd" : "#e0e0e0" }}>
                    <div className="text-lg font-bold" style={{ color: s.hi ? "#1d4ed8" : "#374151" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Качество сшивки */}
              {(() => {
                const pct = Math.round(combined.stats.nodesWithXY / combined.stats.nodes * 100);
                const color = pct >= 80 ? "#059669" : pct >= 50 ? "#d97706" : "#dc2626";
                const bg    = pct >= 80 ? "#f0fdf4" : pct >= 50 ? "#fffbeb" : "#fef2f2";
                return (
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs border"
                    style={{ background: bg, borderColor: color + "66", color }}>
                    <Icon name={pct >= 80 ? "CheckCircle" : "AlertTriangle"} size={13} />
                    <span className="font-semibold">
                      {pct}% узлов сопоставлено DXF↔Excel ({combined.stats.nodesWithXY} из {combined.stats.nodes})
                    </span>
                  </div>
                );
              })()}

              {combined.warnings.length > 0 && (
                <div className="rounded border border-yellow-300 px-3 py-2 space-y-1" style={{ background: "#fffbeb" }}>
                  {combined.warnings.slice(0, 4).map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
                      <Icon name="AlertTriangle" size={12} className="mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowDebug(v => !v)}
                className="text-[11px] text-blue-600 underline hover:text-blue-800">
                {showDebug ? "Скрыть лог" : "Показать лог парсера"}
              </button>
              {showDebug && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-gray-500">DXF:</div>
                  <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-24 whitespace-pre-wrap">{combined.debugDxf}</pre>
                  <div className="text-[10px] font-semibold text-gray-500">Excel:</div>
                  <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-24 whitespace-pre-wrap">{combined.debugExcel}</pre>
                </div>
              )}

              {/* Режим */}
              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "#f9f9f9" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="cmode" value={m} checked={mode === m}
                      onChange={() => setMode(m)} className="w-3 h-3" />
                    <div>
                      <div className="text-xs font-medium text-gray-800">
                        {m === "replace" ? "Заменить текущую схему" : "Добавить к текущей"}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Подсказка если только один файл */}
          {(dxfResult || xlsResult) && !combined && !loading && (
            <div className="text-xs text-center text-gray-500 py-2">
              {dxfResult && !xlsResult && "Теперь загрузи Excel-файл →"}
              {xlsResult && !dxfResult && "Теперь загрузи DXF-файл →"}
            </div>
          )}
        </div>

        {/* Кнопки */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-300"
          style={{ background: "#ececec" }}>
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm border border-gray-400 rounded hover:bg-gray-200">
            Отмена
          </button>
          <button
            disabled={!combined || combined.branches.length === 0}
            onClick={() => combined && onImport(combined, mode)}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded disabled:opacity-40"
            style={{ background: "#2563eb" }}>
            Импортировать ({combined?.branches.length ?? 0} ветвей)
          </button>
        </div>
      </div>
    </div>
  );
}
