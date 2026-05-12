// Диалог импорта CSV из АэроСети
import { useState, useRef } from "react";
import { parseCsv, type CsvImportResult } from "@/lib/csvImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: CsvImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function CsvImportDialog({ onImport, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f); setResult(null); setError(null); setLoading(true);
    try {
      let text = await f.text();
      if (text.includes("â€") || text.includes("\uFFFD")) {
        const buf = await f.arrayBuffer();
        text = new TextDecoder("windows-1251").decode(buf);
      }
      setResult(parseCsv(text));
    } catch (e) {
      setError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col shadow-2xl"
        style={{ width: 500, maxHeight: "85vh", background: "#f5f5f5", border: "1px solid #999" }}>

        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">Импорт CSV из АэроСети</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded text-green-700 border border-green-300"
              style={{ background: "#dcfce7" }}>Рекомендуется</span>
          </div>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* Инструкция */}
          <div className="text-xs rounded border border-green-100 px-3 py-2 space-y-1"
            style={{ background: "#f0fdf4" }}>
            <div className="font-semibold text-green-800">Как экспортировать из АэроСети:</div>
            <div className="text-green-700">1. Меню <b>Файл → Экспорт в CSV</b></div>
            <div className="text-green-700">2. Схема: <b>Aeroset</b>, разделитель <b>;</b></div>
            <div className="text-green-700">3. Отметить: <b>Вершины</b> (с X,Y,Z) и <b>Выработки</b></div>
            <div className="text-green-700">4. Нажать <b>Экспорт</b></div>
          </div>

          {/* Зона загрузки */}
          <div
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 cursor-pointer rounded border-2 border-dashed py-5 hover:bg-green-50 transition-colors"
            style={{ borderColor: file ? "#16a34a" : "#9ca3af", background: file ? "#f0fdf4" : "#fafafa" }}>
            <Icon name="FileText" size={26} className={file ? "text-green-600" : "text-gray-400"} />
            {file ? (
              <>
                <div className="text-sm font-semibold text-green-700">{file.name}</div>
                <div className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} КБ · нажмите для замены</div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-700">Перетащите CSV-файл или нажмите</div>
                <div className="text-xs text-gray-400">Экспорт из АэроСети (.csv, .txt)</div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".csv,.txt,.CSV" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              Анализ файла...
            </div>
          )}
          {error && <div className="px-3 py-2 rounded text-xs text-red-700 border border-red-300" style={{ background: "#fef2f2" }}>{error}</div>}

          {result && (
            <div className="space-y-3">
              {/* Статистика */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Узлов",   value: result.stats.nodes,       hi: result.stats.nodes > 0 },
                  { label: "Ветвей",  value: result.stats.branches,    hi: result.stats.branches > 0 },
                  { label: "С Z≠0",   value: result.stats.nodesWithZ,  hi: result.stats.nodesWithZ > 0 },
                ].map(s => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dcfce7" : "#f9f9f9", borderColor: s.hi ? "#86efac" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.hi ? "#15803d" : "#6b7280" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Превью ветвей */}
              {result.branches.length > 0 && (
                <pre className="text-[10px] bg-gray-100 rounded px-2 py-1.5 overflow-auto max-h-28 border border-gray-300">
                  {result.branches.slice(0, 5).map(b =>
                    `${b.name || b.id.slice(-5)}: L=${b.length}м A=${b.angle}° S=${b.area}м² P=${b.perimeter}м`
                  ).join("\n")}
                </pre>
              )}

              {result.warnings.length > 0 && (
                <div className="rounded border border-yellow-300 px-3 py-2 space-y-1" style={{ background: "#fffbeb" }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
                      <Icon name="AlertTriangle" size={12} className="mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowDebug(v => !v)} className="text-[11px] text-blue-600 underline">
                {showDebug ? "Скрыть лог" : "Показать лог парсера"}
              </button>
              {showDebug && (
                <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{result.debug}</pre>
              )}

              {/* Режим */}
              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "#f9f9f9" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="csvmode" value={m} checked={mode === m} onChange={() => setMode(m)} className="w-3 h-3" />
                    <div className="text-xs text-gray-800">
                      {m === "replace" ? "Заменить текущую схему" : "Добавить к текущей"}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-300" style={{ background: "#ececec" }}>
          <button onClick={onClose} className="px-4 py-1.5 text-sm border border-gray-400 rounded hover:bg-gray-200">Отмена</button>
          <button
            disabled={!result || result.branches.length === 0}
            onClick={() => result && onImport(result, mode)}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded disabled:opacity-40"
            style={{ background: "#16a34a" }}>
            Импортировать ({result?.branches.length ?? 0} ветвей)
          </button>
        </div>
      </div>
    </div>
  );
}
