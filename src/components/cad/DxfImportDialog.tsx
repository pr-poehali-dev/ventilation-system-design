// Диалог импорта DXF-файла вентиляционной схемы
import { useState, useRef } from "react";
import { parseDxf, type DxfImportResult } from "@/lib/dxfImport";
import Icon from "@/components/ui/icon";

interface DxfImportDialogProps {
  onImport: (result: DxfImportResult, mode: "replace" | "append") => void;
  onClose: () => void;
}

// ── Кодировки DXF ────────────────────────────────────────────────────────────
// АэроСеть и «Вентиляция 2.0» экспортируют DXF в Windows-1251 (ANSI, кириллица),
// AutoCAD/НаноКАД — часто в UTF-8. При неверной кодировке кириллические имена
// слоёв («ось», «Стволы») превращаются в мусор («Р'РЎРљР»), и парсер не находит
// осевые слои → схема не импортируется. Поэтому декодируем байты, а не строку.
type EncodingId = "auto" | "windows-1251" | "utf-8" | "utf-16le";

const ENCODING_OPTIONS: { id: EncodingId; label: string }[] = [
  { id: "auto",         label: "Авто (определить)" },
  { id: "windows-1251", label: "ANSI / Windows-1251 (АэроСеть, Вентиляция 2.0)" },
  { id: "utf-8",        label: "UTF-8 (AutoCAD, НаноКАД)" },
  { id: "utf-16le",     label: "Unicode (UTF-16)" },
];

/** «Испорченность» текста: доля типичных мусорных последовательностей кириллицы
 *  в UTF-8 (Р-/С-мусор, «â€», символ замены). Чем больше — тем хуже кодировка. */
function mojibakeScore(text: string): number {
  if (!text) return 1;
  // Типичный «мусор» при чтении Windows-1251 как UTF-8: символ замены \uFFFD и
  // латинские Ð/Ñ/Â/Ã/â/€, в которые превращаются кириллические байты.
  const bad = (text.match(/[\uFFFDÐÑÂÃâ€]/g) || []).length;
  return bad / Math.max(text.length, 1);
}

/** Декодирует байты DXF в текст. При "auto" выбирает кодировку с наименьшим
 *  количеством мусора (UTF-8 vs Windows-1251), дополнительно ловит UTF-16. */
function decodeDxfBytes(buf: ArrayBuffer, enc: EncodingId): string {
  const bytes = new Uint8Array(buf);
  // BOM UTF-16LE / UTF-16BE
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(buf);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(buf);

  if (enc !== "auto") {
    try { return new TextDecoder(enc).decode(buf); }
    catch { return new TextDecoder("windows-1251").decode(buf); }
  }

  // Авто: сравниваем UTF-8 и Windows-1251, берём наименее «испорченный».
  let utf8 = "";
  try { utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf); } catch { /* ignore */ }
  const cp1251 = new TextDecoder("windows-1251").decode(buf);
  const noCyrillic = !/[А-Яа-яЁё]/.test(utf8) && !/[А-Яа-яЁё]/.test(cp1251);
  if (noCyrillic) return utf8 || cp1251;  // латиница — любая подойдёт
  return mojibakeScore(utf8) <= mojibakeScore(cp1251) ? utf8 : cp1251;
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
  const [encoding, setEncoding] = useState<EncodingId>("auto");
  const fileTextRef = useRef<string>("");
  const fileBufRef = useRef<ArrayBuffer | null>(null);
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
      const buf = await f.arrayBuffer();
      fileBufRef.current = buf;
      const text = decodeDxfBytes(buf, encoding);
      fileTextRef.current = text;
      setFilePreview(text.split("\n").slice(0, 60).join("\n"));
      parseWithEpsilon(text, epsilon, true);  // первый парсинг — автоопределение epsilon
    } catch (e) {
      setError(`Ошибка чтения файла: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Смена кодировки — перечитываем сохранённые байты и парсим заново.
  const handleEncodingChange = (enc: EncodingId) => {
    setEncoding(enc);
    if (!fileBufRef.current) return;
    const text = decodeDxfBytes(fileBufRef.current, enc);
    fileTextRef.current = text;
    setFilePreview(text.split("\n").slice(0, 60).join("\n"));
    parseWithEpsilon(text, epsilon, true);
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

          {/* Кодировка файла — как в АэроСеть / Вентиляция 2.0 */}
          {file && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600 flex-shrink-0">Кодировка файла:</span>
              <select
                value={encoding}
                onChange={(e) => handleEncodingChange(e.target.value as EncodingId)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 bg-white">
                {ENCODING_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          )}
          {file && result && result.branches.length === 0 && (
            <div className="text-[11px] text-orange-700 px-1 -mt-1">
              Схема не распозналась? Если в логе видны «кракозябры» в именах слоёв — смените кодировку на
              <b> ANSI / Windows-1251</b>.
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
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Результат анализа:</div>

              {/* Статистика */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Узлов (CIRCLE)", value: result.stats.circles ?? result.stats.nodes },
                  { label: "Отрезков LINE",  value: result.stats.lines },
                  { label: "Узлов итого",    value: result.stats.nodes,    hi: true },
                  { label: "Ветвей",         value: result.stats.branches, hi: true },
                ].map((s) => (
                  <div key={s.label} className="rounded px-2 py-2 text-center border"
                    style={{ background: s.hi ? "#dbeafe" : "#f9f9f9", borderColor: s.hi ? "#93c5fd" : "#e0e0e0" }}>
                    <div className="text-xl font-bold" style={{ color: s.hi ? "#1d4ed8" : "#1f2937" }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 leading-tight">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Косоугольная проекция / единицы */}
              {result.obliqueFactor !== undefined && result.obliqueFactor !== 0 && (
                <div className="flex items-start gap-2 px-2 py-1.5 rounded text-xs border border-green-200"
                  style={{ background: "#f0fdf4" }}>
                  <Icon name="Axis3d" size={13} />
                  <span>Косоугольная проекция АэроСети обнаружена (k={result.obliqueFactor.toFixed(2)}). Координаты и длины пересчитаны в реальные мировые.</span>
                </div>
              )}
              {result.scaleUsed !== undefined && result.scaleUsed !== 1 && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs border border-blue-200"
                  style={{ background: "#eff6ff" }}>
                  <Icon name="Info" size={13} />
                  <span>Координаты в {result.scaleUsed === 0.001 ? "мм" : "см"} → переведены в м.</span>
                </div>
              )}
              {result.zRange && (
                <div className="rounded text-xs border px-2 py-1.5"
                  style={{ background: result.zRange.hasZ ? "#ecfdf5" : "#fff7ed", borderColor: result.zRange.hasZ ? "#a7f3d0" : "#fed7aa" }}>
                  <span style={{ color: result.zRange.hasZ ? "#047857" : "#9a3412" }}>
                    {result.zRange.hasZ
                      ? `3D: Z от ${result.zRange.min.toFixed(0)} до ${result.zRange.max.toFixed(0)} м`
                      : "⚠ Все Z=0 — плоский файл"}
                  </span>
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

              {/* Диагностика — всегда доступна */}
              <div>
                <button onClick={() => setShowDebug((v) => !v)}
                  className="text-[11px] text-blue-600 underline hover:text-blue-800">
                  {showDebug ? "Скрыть диагностику" : "Показать лог парсера"}
                </button>
                {showDebug && (
                  <div className="mt-2 space-y-2">
                    <div className="text-[10px] font-semibold text-gray-500">Лог парсера:</div>
                    <pre className="text-[10px] bg-gray-900 text-green-400 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                      {result.debug ?? "нет данных"}
                    </pre>
                    {result.branches.length > 0 && (
                      <>
                        <div className="text-[10px] font-semibold text-gray-500">Ветви (первые 8):</div>
                        <pre className="text-[10px] bg-gray-100 rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap border border-gray-300">
                          {result.branches.slice(0, 8).map(b =>
                            `${b.id.slice(-6)}: L=${b.length}м A=${b.angle}° | S=${b.area}м² P=${b.perimeter}м dh=${b.dh}м | ${b.rectWidth}×${b.rectHeight}`
                          ).join("\n")}
                        </pre>
                      </>
                    )}
                    <div className="text-[10px] font-semibold text-gray-500">Первые 60 строк файла:</div>
                    <pre className="text-[10px] bg-gray-100 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap border border-gray-300">
                      {filePreview}
                    </pre>
                  </div>
                )}
              </div>

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