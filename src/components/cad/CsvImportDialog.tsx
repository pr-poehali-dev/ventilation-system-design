// Диалог импорта CSV из АэроСети — поддерживает несколько файлов сразу
import { useState, useRef } from "react";
import { parseCsvMulti, detectFileType, type CsvImportResult, type CsvFileInput } from "@/lib/csvImport";
import Icon from "@/components/ui/icon";

interface Props {
  onImport: (result: CsvImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

const FILE_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  nodes:       { label: "Узлы",       color: "#166534", bg: "#dcfce7" },
  excavations: { label: "Выработки",  color: "#1e40af", bg: "#dbeafe" },
  positions:   { label: "Позиции",    color: "#7c3aed", bg: "#ede9fe" },
  bulkheads:   { label: "Перемычки",  color: "#92400e", bg: "#fef3c7" },
  fans:        { label: "Вент-ры",    color: "#9f1239", bg: "#ffe4e6" },
  unknown:     { label: "?",          color: "#374151", bg: "#f3f4f6" },
};

export default function CsvImportDialog({ onImport, onClose }: Props) {
  const [files, setFiles] = useState<CsvFileInput[]>([]);
  const [fileTypes, setFileTypes] = useState<string[]>([]);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [rUnit, setRUnit] = useState<"kmu" | "si" | "auto">("auto");
  const [detectedUnit, setDetectedUnit] = useState<"kmu" | "si" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<CsvFileInput[]>([]);

  const readFiles = async (fileList: FileList | File[]) => {
    setError(null); setResult(null); setLoading(true);
    try {
      const inputs: CsvFileInput[] = [];
      const types: string[] = [];
      for (const f of Array.from(fileList)) {
        if (!/\.(csv|txt)$/i.test(f.name)) continue;
        let text = await f.text();
        if (text.includes("â€") || text.includes("\uFFFD")) {
          const buf = await f.arrayBuffer();
          text = new TextDecoder("windows-1251").decode(buf);
        }
        inputs.push({ name: f.name, content: text });
        types.push(detectFileType(f.name, text.split("\n").slice(0, 5).join("\n")));
      }
      if (inputs.length === 0) { setError("Не найдено .csv файлов"); setLoading(false); return; }
      filesRef.current = inputs;
      setFiles(inputs); setFileTypes(types);
      const parsed = parseCsvMulti(inputs, { resistanceUnit: rUnit });
      setResult(parsed);
      if (rUnit === "auto") {
        const debugLine = parsed.debug.split("\n").find(l => l.includes("Автодетект"));
        setDetectedUnit(debugLine?.includes("кмю") ? "kmu" : debugLine?.includes("СИ") ? "si" : null);
      } else {
        setDetectedUnit(null);
      }
    } catch (e) {
      setError(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const hasNodes = fileTypes.includes("nodes");
  const hasExcav = fileTypes.includes("excavations");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-col shadow-2xl"
        style={{ width: 520, maxHeight: "88vh", background: "#f5f5f5", border: "1px solid #999" }}>

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

          <div className="text-xs rounded border border-green-100 px-3 py-2 space-y-1" style={{ background: "#f0fdf4" }}>
            <div className="font-semibold text-green-800">Как экспортировать из АэроСети:</div>
            <div className="text-green-700">1. <b>Файл → Экспорт в CSV</b>, схема <b>Aeroset</b>, разделитель <b>;</b></div>
            <div className="text-green-700">2. Единицы измерения → <b>Метры</b></div>
            <div className="text-green-700">3. Отметить <b>Вершины</b> (X,Y,Z) и <b>Выработки</b>, нажать <b>Экспорт</b></div>
            <div className="text-[10px] text-green-600">
              Выберите все 5 файлов сразу: *-nodes.csv, *-excavations.csv и остальные
            </div>
          </div>

          {/* Единицы сопротивления */}
          <div className="text-[11px] text-gray-700">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium">Единицы R в CSV:</span>
              {(["auto", "kmu", "si"] as const).map(u => (
                <label key={u} className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="runit" value={u} checked={rUnit === u}
                    onChange={() => {
                      setRUnit(u);
                      setDetectedUnit(null);
                      if (filesRef.current.length > 0) {
                        const p = parseCsvMulti(filesRef.current, { resistanceUnit: u });
                        setResult(p);
                        if (u === "auto") {
                          const dbg = p.debug.split("\n").find(l => l.includes("Автодетект"));
                          setDetectedUnit(dbg?.includes("кмю") ? "kmu" : dbg?.includes("СИ") ? "si" : null);
                        }
                      }
                    }} />
                  {u === "auto" ? "Авто (рекомендуется)" : u === "kmu" ? "кмю (×10⁻³)" : "Нс²/м⁸ (SI)"}
                </label>
              ))}
            </div>
            {rUnit === "auto" && detectedUnit && (
              <div className="mt-1 px-2 py-0.5 rounded text-[10px] inline-block"
                style={{ background: "#dbeafe", color: "#1e40af" }}>
                Определено: {detectedUnit === "kmu" ? "кмю — значения будут делиться на 1000" : "СИ — значения без изменений"}
              </div>
            )}
          </div>

          <div
            onDrop={(e) => { e.preventDefault(); readFiles(e.dataTransfer.files); }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 cursor-pointer rounded border-2 border-dashed py-6 hover:bg-green-50 transition-colors"
            style={{ borderColor: files.length > 0 ? "#16a34a" : "#9ca3af", background: files.length > 0 ? "#f0fdf4" : "#fafafa" }}>
            <Icon name="FolderOpen" size={28} className={files.length > 0 ? "text-green-600" : "text-gray-400"} />
            {files.length > 0 ? (
              <div className="text-sm font-semibold text-green-700">Загружено {files.length} файлов — нажмите для замены</div>
            ) : (
              <>
                <div className="text-sm font-medium text-gray-700">Перетащите все CSV-файлы или нажмите</div>
                <div className="text-xs text-gray-400">Ctrl+A для выбора всех файлов сразу</div>
              </>
            )}
            <input ref={inputRef} type="file" accept=".csv,.txt,.CSV" multiple className="hidden"
              onChange={(e) => { if (e.target.files) readFiles(e.target.files); }} />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              Анализ файлов...
            </div>
          )}
          {error && <div className="px-3 py-2 rounded text-xs text-red-700 border border-red-300" style={{ background: "#fef2f2" }}>{error}</div>}

          {files.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Распознанные файлы:</div>
              {files.map((f, i) => {
                const t = fileTypes[i] ?? "unknown";
                const st = FILE_TYPE_LABELS[t] ?? FILE_TYPE_LABELS.unknown;
                return (
                  <div key={f.name} className="flex items-center gap-2 px-2 py-1 rounded text-xs border"
                    style={{ background: st.bg, borderColor: st.color + "44" }}>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
                      style={{ background: st.color, color: "#fff" }}>{st.label}</span>
                    <span className="text-gray-700 truncate flex-1 text-[11px]">{f.name}</span>
                    {(t === "nodes" || t === "excavations") && <Icon name="CheckCircle" size={12} className="text-green-600 shrink-0" />}
                  </div>
                );
              })}
              {!hasNodes && <div className="text-[10px] text-orange-600 flex items-center gap-1"><Icon name="AlertTriangle" size={11} />Нет *-nodes.csv — координаты X/Y/Z будут отсутствовать</div>}
              {!hasExcav && <div className="text-[10px] text-orange-600 flex items-center gap-1"><Icon name="AlertTriangle" size={11} />Нет *-excavations.csv — выработки не импортируются</div>}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Узлов",    value: result.stats.nodes,      hi: result.stats.nodes > 0 },
                  { label: "Ветвей",   value: result.stats.branches,   hi: result.stats.branches > 0 },
                  { label: "С Z≠0",   value: result.stats.nodesWithZ, hi: result.stats.nodesWithZ > 0 },
                  { label: "Вент-ров", value: result.stats.fans ?? 0,  hi: (result.stats.fans ?? 0) > 0 },
                ].map(s => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dcfce7" : "#f9f9f9", borderColor: s.hi ? "#86efac" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.hi ? "#15803d" : "#6b7280" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {result.branches.length > 0 && (
                <pre className="text-[10px] bg-gray-100 rounded px-2 py-1.5 overflow-auto max-h-24 border border-gray-300">
                  {result.branches.slice(0, 5).map(b =>
                    `${b.id.slice(-4)}: L=${b.length}м A=${b.angle}° S=${b.area}м² P=${b.perimeter}м`
                  ).join("\n")}
                </pre>
              )}

              {result.warnings.length > 0 && (
                <div className="rounded border border-yellow-300 px-3 py-2 space-y-1" style={{ background: "#fffbeb" }}>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
                      <Icon name="AlertTriangle" size={12} className="mt-0.5 shrink-0" /><span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowDebug(v => !v)} className="text-[11px] text-blue-600 underline">
                {showDebug ? "Скрыть лог" : "Показать лог парсера"}
              </button>
              {showDebug && <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">{result.debug}</pre>}

              <div className="border rounded px-3 py-2 space-y-1.5" style={{ background: "#f9f9f9" }}>
                <div className="text-[11px] font-semibold text-gray-700">Способ добавления:</div>
                {(["replace", "append"] as const).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="csvmode" value={m} checked={mode === m} onChange={() => setMode(m)} className="w-3 h-3" />
                    <div className="text-xs text-gray-800">{m === "replace" ? "Заменить текущую схему" : "Добавить к текущей"}</div>
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