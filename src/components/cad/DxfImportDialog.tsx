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
  const [showDebug, setShowDebug] = useState(false);
  const [filePreview, setFilePreview] = useState<string>("");
  const [epsilon, setEpsilon] = useState<number>(0.05);
  const fileTextRef = useRef<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const parseWithEpsilon = (text: string, eps: number, useAutoEpsilon = false) => {
    const parsed = parseDxf(text, useAutoEpsilon ? undefined : eps);
    setResult(parsed);
    // При первом парсинге — берём epsilon из файла
    if (useAutoEpsilon && parsed.epsilonUsed !== undefined) {
      setEpsilon(parsed.epsilonUsed);
    }
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setError(null);
    setLoading(true);
    try {
      let text = "";
      try {
        text = await f.text();
        if (text.includes("â€") || text.includes("\uFFFD")) {
          const buf = await f.arrayBuffer();
          text = new TextDecoder("windows-1251").decode(buf);
        }
      } catch {
        const buf = await f.arrayBuffer();
        text = new TextDecoder("windows-1251").decode(buf);
      }
      fileTextRef.current = text;
      setFilePreview(text.split("\n").slice(0, 60).join("\n"));
      parseWithEpsilon(text, epsilon, true);  // первый парсинг — автоопределение epsilon
    } catch (e) {
      setError(`Ошибка чтения файла: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEpsilonChange = (val: number) => {
    setEpsilon(val);
    if (fileTextRef.current) {
      parseWithEpsilon(fileTextRef.current, val);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.name.toLowerCase().endsWith(".dxf"))) {
      handleFile(f);
    } else {
      setError("Поддерживаются только файлы .dxf");
    }
  };

  const handleConfirm = () => {
    if (result && result.branches.length > 0) onImport(result, mode);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col shadow-2xl"
        style={{ width: 540, maxHeight: "85vh", background: "#f5f5f5", border: "1px solid #999" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-400"
          style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
          <span className="text-sm font-semibold text-gray-800">Импорт схемы из DXF</span>
          <button onClick={onClose}
            className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Зона перетаскивания */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 cursor-pointer rounded border-2 border-dashed py-5 hover:bg-blue-50 transition-colors"
            style={{ borderColor: file ? "#2563eb" : "#9ca3af" }}>
            <Icon name="FileUp" size={26} />
            {file ? (
              <>
                <div className="text-sm font-semibold text-blue-700">{file.name}</div>
                <div className="text-xs text-gray-500">
                  {(file.size / 1024).toFixed(1)} КБ · нажмите для замены файла
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-700">Перетащите DXF-файл или нажмите для выбора</div>
                <div className="text-xs text-gray-400">НаноКАД, АэроСеть, AutoCAD (ASCII DXF)</div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".dxf,.DXF" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>

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
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Результат анализа:</div>

              {/* Статистика */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Отрезков LINE", value: result.stats.lines },
                  { label: "Полилиний",     value: result.stats.polylines },
                  { label: "Узлов",         value: result.stats.nodes,    hi: true },
                  { label: "Ветвей",        value: result.stats.branches, hi: true },
                ].map((s) => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dbeafe" : "#f9f9f9", borderColor: s.hi ? "#93c5fd" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.hi ? "#1d4ed8" : "#1f2937" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Единицы */}
              {result.scaleUsed !== undefined && result.scaleUsed !== 1 && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs border border-blue-200"
                  style={{ background: "#eff6ff" }}>
                  <Icon name="Info" size={13} />
                  <span>Координаты файла в {result.scaleUsed === 0.001 ? "мм" : "см"} → автоматически переведены в метры.</span>
                </div>
              )}

              {/* Настройка точности слияния узлов */}
              {result.stats.lines + result.stats.polylines > 0 && (
                <div className="border rounded px-3 py-2 space-y-1.5"
                  style={{ background: "#f0f4ff", borderColor: "#c7d7fa" }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-blue-800">Точность слияния узлов</span>
                    <span className="text-[11px] font-mono text-blue-700">{epsilon < 0.1 ? epsilon.toFixed(3) : epsilon.toFixed(2)} м</span>
                  </div>
                  <input type="range" min={0.01} max={10} step={0.01}
                    value={epsilon}
                    onChange={(e) => handleEpsilonChange(parseFloat(e.target.value))}
                    className="w-full" style={{ accentColor: "#2563eb" }} />
                  <div className="flex justify-between text-[10px] text-blue-600">
                    <span>0.01 м (точно)</span>
                    <span className="text-gray-400">← уменьшить если много узлов дублируются</span>
                    <span>10 м (грубо)</span>
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Точки ближе {epsilon < 0.1 ? epsilon.toFixed(3) : epsilon.toFixed(2)} м объединяются в один узел.
                    {result.stats.nodes > 500 && <span className="text-orange-600"> ⚠ Много узлов — попробуйте увеличить порог.</span>}
                    {result.stats.nodes === 0 && <span className="text-red-600"> Нет узлов — уменьшите порог.</span>}
                  </div>
                </div>
              )}

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

              {/* Диагностика при 0 ветвях */}
              {result.stats.branches === 0 && (
                <div>
                  <button onClick={() => setShowDebug((v) => !v)}
                    className="text-[11px] text-blue-600 underline hover:text-blue-800">
                    {showDebug ? "Скрыть диагностику" : "Показать диагностику файла"}
                  </button>
                  {showDebug && (
                    <div className="mt-2 space-y-2">
                      <div className="text-[10px] font-semibold text-gray-500">Лог парсера:</div>
                      <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-28 whitespace-pre-wrap">
                        {result.debug ?? "нет данных"}
                      </pre>
                      <div className="text-[10px] font-semibold text-gray-500">Первые строки файла:</div>
                      <pre className="text-[10px] bg-gray-100 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap border border-gray-300">
                        {filePreview}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Режим импорта */}
              {result.branches.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Способ добавления:</div>
                  <div className="flex flex-col gap-1.5">
                    {([
                      { v: "replace" as const, label: "Заменить текущую схему", desc: "Удалить всё существующее, загрузить только из DXF" },
                      { v: "append"  as const, label: "Добавить к текущей схеме", desc: "Оставить существующую сеть и добавить из DXF" },
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
            className="px-4 py-1.5 text-sm border border-gray-400 rounded hover:bg-gray-100">Отмена</button>
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