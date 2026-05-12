// Диалог импорта Excel-отчёта из Вентиляции 2.0 / АэроСети
import { useState, useRef } from "react";
import { parseExcel, type ExcelImportResult } from "@/lib/excelImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: ExcelImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function ExcelImportDialog({ onImport, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExcelImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const buf = await f.arrayBuffer();
      const parsed = parseExcel(buf);
      setResult(parsed);
    } catch (e) {
      setError(`Ошибка чтения файла: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && /\.(xlsx|xls|csv)$/i.test(f.name)) handleFile(f);
    else setError("Поддерживаются файлы .xlsx, .xls, .csv");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col shadow-2xl"
        style={{ width: 520, maxHeight: "85vh", background: "#f5f5f5", border: "1px solid #999" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
          <span className="text-sm font-semibold text-gray-800">Импорт из Excel (Вентиляция 2.0)</span>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* Зона загрузки */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 cursor-pointer rounded border-2 border-dashed py-5 hover:bg-blue-50 transition-colors"
            style={{ borderColor: file ? "#2563eb" : "#9ca3af" }}>
            <Icon name="FileSpreadsheet" size={26} />
            {file ? (
              <>
                <div className="text-sm font-semibold text-blue-700">{file.name}</div>
                <div className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} КБ · нажмите для замены</div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-700">Перетащите Excel-файл или нажмите для выбора</div>
                <div className="text-xs text-gray-400">Вентиляция 2.0 → Отчёт → Список ветвей (.xlsx)</div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {/* Инструкция */}
          {!file && (
            <div className="text-xs text-gray-600 rounded border border-blue-100 px-3 py-2 space-y-1"
              style={{ background: "#eff6ff" }}>
              <div className="font-semibold text-blue-800">Как экспортировать из Вентиляции 2.0:</div>
              <div>1. Меню <b>Отчёты</b> → <b>Список ветвей</b> → сохранить как .xlsx</div>
              <div>2. Также нужен лист <b>Список узлов</b> — для Z-координат (глубина)</div>
              <div>3. Оба листа могут быть в одном файле или в разных</div>
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Анализ файла...
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded text-xs text-red-700 border border-red-300"
              style={{ background: "#fef2f2" }}>{error}</div>
          )}

          {result && (
            <div className="space-y-3">
              {/* Статистика */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Узлов",  value: result.stats.nodes,    hi: true },
                  { label: "Ветвей", value: result.stats.branches, hi: true },
                  { label: "С Z≠0",  value: result.stats.nodesWithZ, hi: result.stats.nodesWithZ > 0 },
                ].map(s => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dbeafe" : "#f9f9f9", borderColor: s.hi ? "#93c5fd" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.hi ? "#1d4ed8" : "#6b7280" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Z-координаты */}
              {result.stats.nodesWithZ > 0 && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs border border-green-200"
                  style={{ background: "#f0fdf4" }}>
                  <Icon name="Mountain" size={13} />
                  <span className="text-green-800">
                    Z-координаты (глубина) импортированы для {result.stats.nodesWithZ} из {result.stats.nodes} узлов
                  </span>
                </div>
              )}

              {/* Предупреждения */}
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

              {/* Превью ветвей */}
              {result.branches.length > 0 && (
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Первые ветви:</div>
              )}
              {result.branches.length > 0 && (
                <pre className="text-[10px] bg-gray-100 rounded px-2 py-1.5 overflow-auto max-h-32 whitespace-pre-wrap border border-gray-300">
                  {result.branches.slice(0, 6).map(b =>
                    `${b.name || b.id.slice(-6)}: L=${b.length}м A=${b.angle}° | S=${b.area}м² P=${b.perimeter}м`
                  ).join("\n")}
                </pre>
              )}

              {/* Диагностика */}
              <button onClick={() => setShowDebug(v => !v)}
                className="text-[11px] text-blue-600 underline hover:text-blue-800">
                {showDebug ? "Скрыть лог" : "Показать лог парсера"}
              </button>
              {showDebug && (
                <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap">
                  {result.debug}
                </pre>
              )}

              {/* Режим импорта */}
              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "#f9f9f9" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="mode" value={m} checked={mode === m}
                      onChange={() => setMode(m)} className="w-3 h-3" />
                    <div>
                      <div className="text-xs font-medium text-gray-800">
                        {m === "replace" ? "Заменить текущую схему" : "Добавить к текущей схеме"}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {m === "replace"
                          ? "Удалить всё существующее, загрузить только из Excel"
                          : "Оставить существующую сеть и добавить из Excel"}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
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
            disabled={!result || result.branches.length === 0}
            onClick={() => result && onImport(result, mode)}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded disabled:opacity-40"
            style={{ background: "#2563eb" }}>
            Импортировать ({result?.branches.length ?? 0} ветвей)
          </button>
        </div>
      </div>
    </div>
  );
}
