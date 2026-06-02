import { useState, useRef } from "react";
import { parseVentsimCsv, type VentsimImportResult } from "@/lib/ventsimImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: VentsimImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

export default function VentsimImportDialog({ onImport, onClose }: Props) {
  const [result, setResult] = useState<VentsimImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (f: File) => {
    setError(null); setResult(null); setLoading(true); setFileName(f.name);
    try {
      let text = await f.text();
      if (text.includes("â€") || text.includes("\uFFFD")) {
        const buf = await f.arrayBuffer();
        text = new TextDecoder("windows-1251").decode(buf);
      }
      const res = parseVentsimCsv(text);
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto flex flex-col" style={{ border: "1.5px solid #d1d5db" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-200">
          <div>
            <div className="text-[15px] font-bold text-gray-900">Импорт CSV из Ventsim</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded p-1"><Icon name="X" size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 flex-1">

          {/* Инструкция */}
          <div className="rounded-lg px-3 py-2.5 text-[11px] space-y-0.5" style={{ background: "#f0fdf4", border: "1px solid #86efac" }}>
            <div className="font-semibold text-green-800 mb-1">Как экспортировать из Ventsim:</div>
            <div className="text-green-700">1. Reports → Branch Report → Export to CSV</div>
            <div className="text-green-700">2. Убедитесь что включены колонки: From, To, Length, Area, Resistance, Airflow</div>
            <div className="text-gray-500 text-[10px] mt-1">Поддерживается Ventsim Design 5/6, разделитель , или ;</div>
          </div>

          {/* Зона загрузки */}
          <div
            className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors py-6"
            style={{ borderColor: fileName ? "#22c55e" : "#d1d5db", background: fileName ? "#f0fdf4" : "#fafafa" }}
            onClick={() => inputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
          >
            <Icon name={fileName ? "CheckCircle" : "FolderOpen"} size={28} style={{ color: fileName ? "#22c55e" : "#9ca3af" }} />
            <div className="mt-2 text-sm font-medium" style={{ color: fileName ? "#15803d" : "#6b7280" }}>
              {loading ? "Анализирую файл…" : fileName ? `${fileName} — нажмите для замены` : "Перетащите CSV-файл или нажмите для выбора"}
            </div>
            <input ref={inputRef} type="file" accept=".csv,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

          {/* Ошибка */}
          {error && (
            <div className="rounded border border-red-300 px-3 py-2 text-xs text-red-700 bg-red-50 flex items-center gap-2">
              <Icon name="AlertCircle" size={14} />{error}
            </div>
          )}

          {/* Результат */}
          {result && (
            <div className="space-y-3">
              {/* Счётчики */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Узлов",   value: result.stats.nodes,    hi: result.stats.nodes > 0 },
                  { label: "Ветвей",  value: result.stats.branches, hi: result.stats.branches > 0 },
                  { label: "Вент-ров",value: result.stats.fans,     hi: result.stats.fans > 0 },
                ].map(s => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dcfce7" : "#f9f9f9", borderColor: s.hi ? "#86efac" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.hi ? "#15803d" : "#6b7280" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Предупреждения */}
              {result.warnings.length > 0 && (
                <div className="rounded border border-yellow-300 px-3 py-2 space-y-1" style={{ background: "#fffbeb" }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
                      <Icon name="AlertTriangle" size={12} className="mt-0.5 shrink-0" /><span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Отладка */}
              <button onClick={() => setShowDebug(v => !v)} className="text-[11px] text-blue-600 underline">
                {showDebug ? "Скрыть лог" : "Показать лог парсера"}
              </button>
              {showDebug && <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{result.debug}</pre>}

              {/* Режим */}
              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "#f9f9f9" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="vsmode" value={m} checked={mode === m} onChange={() => setMode(m)} className="w-3 h-3" />
                    <div className="text-xs text-gray-800">{m === "replace" ? "Заменить текущую схему" : "Добавить к текущей"}</div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Кнопки */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 rounded hover:bg-gray-200">Отмена</button>
          <button
            onClick={() => result && onImport(result, mode)}
            disabled={!result || result.stats.branches === 0}
            className="px-5 py-1.5 text-sm font-semibold text-white rounded-lg transition-colors"
            style={{ background: result && result.stats.branches > 0 ? "#16a34a" : "#9ca3af", cursor: result && result.stats.branches > 0 ? "pointer" : "not-allowed" }}
          >
            {result ? `Импортировать (${result.stats.branches} ветвей)` : "Выберите файл"}
          </button>
        </div>
      </div>
    </div>
  );
}
