// Диалог импорта DXF-файла вентиляционной схемы
import { useState, useRef } from "react";
import { parseDxf, type DxfImportResult } from "@/lib/dxfImport";
import Icon from "@/components/ui/icon";

interface DxfImportDialogProps {
  onImport: (result: DxfImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function DxfImportDialog({ onImport, onClose }: DxfImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DxfImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      const text = await f.text();
      const parsed = parseDxf(text);
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
    if (f && (f.name.endsWith(".dxf") || f.name.endsWith(".DXF"))) {
      handleFile(f);
    } else {
      setError("Поддерживаются только файлы .dxf");
    }
  };

  const handleConfirm = () => {
    if (result && result.branches.length > 0) {
      onImport(result, mode);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col shadow-2xl"
        style={{ width: 520, maxHeight: "80vh", background: "#f5f5f5", border: "1px solid #999" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
          <span className="text-sm font-semibold text-gray-800">Импорт схемы из DXF</span>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Зона перетаскивания */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 cursor-pointer rounded border-2 border-dashed py-6 hover:bg-blue-50 transition-colors"
            style={{ borderColor: file ? "#2563eb" : "#9ca3af" }}>
            <Icon name="FileUp" size={28} />
            {file ? (
              <>
                <div className="text-sm font-semibold text-blue-700">{file.name}</div>
                <div className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(1)} КБ · нажмите для замены файла
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-700">
                  Перетащите DXF-файл сюда или нажмите для выбора
                </div>
                <div className="text-xs text-gray-400">
                  Поддерживается: НаноКАД, АэроСеть, AutoCAD (формат DXF ASCII)
                </div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".dxf,.DXF" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {/* Индикатор загрузки */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-blue-600 px-1">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Анализ файла...
            </div>
          )}

          {/* Ошибка */}
          {error && (
            <div className="px-3 py-2 rounded text-xs text-red-700 border border-red-300" style={{ background: "#fef2f2" }}>
              {error}
            </div>
          )}

          {/* Результат анализа */}
          {result && (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Результат анализа:</div>

              {/* Статистика */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Отрезков LINE", value: result.stats.lines },
                  { label: "Полилиний", value: result.stats.polylines },
                  { label: "Узлов", value: result.stats.nodes, highlight: true },
                  { label: "Ветвей", value: result.stats.branches, highlight: true },
                ].map((s) => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.highlight ? "#dbeafe" : "#f9f9f9", borderColor: s.highlight ? "#93c5fd" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.highlight ? "#1d4ed8" : "#1f2937" }}>
                      {s.value}
                    </div>
                    <div className="text-[10px] text-gray-500 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Предупреждения */}
              {result.warnings.length > 0 && (
                <div className="rounded border border-yellow-300 px-3 py-2 space-y-1"
                  style={{ background: "#fffbeb" }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
                      <Icon name="AlertTriangle" size={12} />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Режим импорта */}
              {result.branches.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Способ добавления:</div>
                  <div className="flex flex-col gap-1.5">
                    {([
                      { v: "replace" as const, label: "Заменить текущую схему", desc: "Удалить все существующие узлы и ветви, загрузить только из DXF" },
                      { v: "append" as const, label: "Добавить к текущей схеме", desc: "Оставить существующую сеть и добавить узлы и ветви из DXF" },
                    ]).map((opt) => (
                      <label key={opt.v} className="flex items-start gap-2 cursor-pointer">
                        <input type="radio" name="mode" value={opt.v} checked={mode === opt.v}
                          onChange={() => setMode(opt.v)} className="mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-xs font-medium">{opt.label}</div>
                          <div className="text-[10px] text-gray-500">{opt.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Подвал */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-300"
          style={{ background: "#ececec" }}>
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm border border-gray-400 rounded hover:bg-gray-100">
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={!result || result.branches.length === 0}
            className="px-4 py-1.5 text-sm rounded text-white font-medium"
            style={{
              background: result && result.branches.length > 0 ? "#2563eb" : "#9ca3af",
              cursor: result && result.branches.length > 0 ? "pointer" : "not-allowed",
            }}>
            Импортировать ({result?.branches.length ?? 0} ветвей)
          </button>
        </div>
      </div>
    </div>
  );
}
