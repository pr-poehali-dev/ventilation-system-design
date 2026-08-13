// ─────────────────────────────────────────────────────────────────────────────
// BranchFanTab.tsx — вкладка «Вентилятор» панели свойств выработки: выбор
// модели из каталога и справочника рудника, режим работы, обороты, угол
// лопаток, реверс и проверка нормы ПБ, масштаб условного обозначения.
//
// Вынесено из BranchPropsPanel.tsx БЕЗ изменений разметки, расчётов и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { FAN_CATALOG, getFanById } from "@/lib/fanCurves";
import { type MineFanExport } from "@/components/cad/EquipmentRefDialog";
import { fanWindowRkMurg } from "@/lib/bulkheads";
import {
  SectionHeader, EditInput, ComputedInput, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchFanTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  numFmt: (v: number, d?: number) => string;
  onRemoveFan?: () => void;
  fanSymbolScale?: number;
  onFanSymbolScale?: (scale: number) => void;
  /** Размер подписи вентилятора (показатели у значка), по умолчанию 9 */
  fanIndFontSize?: number;
  onFanIndFontSize?: (size: number) => void;
  /** Вернуть подпись на место (сбросить смещение перетаскивания) */
  onFanIndResetOffset?: () => void;
  onFanSymbolDelete?: () => void;
  onReverse?: () => void;
  normalFlows?: Record<string, number>;
  mineFans?: MineFanExport[];
  onOpenFanLibrary?: () => void;
}

export default function BranchFanTab({
  branch, onUpdate, numFmt, onRemoveFan, fanSymbolScale, onFanSymbolScale,
  fanIndFontSize, onFanIndFontSize, onFanIndResetOffset,
  onFanSymbolDelete, onReverse, normalFlows, mineFans, onOpenFanLibrary,
}: BranchFanTabProps) {
  return (
  <div>
    {onRemoveFan && (
      <div className="px-1 py-1 flex justify-end" style={{ borderBottom: "1px solid #f0d0d0", background: "#fff5f5" }}>
        <button
          onClick={onRemoveFan}
          className="text-[11px] px-3 py-0.5 rounded flex items-center gap-1"
          style={{ background: "#dc2626", color: "white", border: "none", cursor: "pointer" }}>
          ✕ Удалить вентилятор
        </button>
      </div>
    )}
    <SectionHeader title="Вентилятор" />

    <InlineLabel label="Название">
      <input
        type="text"
        value={branch.fanName ?? ""}
        onChange={(e) => onUpdate({ fanName: e.target.value })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}
        placeholder="Название вентилятора"
      />
    </InlineLabel>

    {onFanSymbolScale && (
      <InlineLabel label="Масштаб УО">
        <div className="flex items-center gap-1 w-full">
          <input type="range" min={5} max={400} step={5}
            value={Math.round((fanSymbolScale ?? 1) * 100)}
            onChange={(e) => onFanSymbolScale(Number(e.target.value) / 100)}
            className="flex-1" style={{ accentColor: "#2563eb" }} />
          <input type="number" min={5} max={400} step={5}
            value={Math.round((fanSymbolScale ?? 1) * 100)}
            onChange={(e) => { const v = Math.min(400, Math.max(5, Number(e.target.value) || 100)); onFanSymbolScale(v / 100); }}
            className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
            style={{ fontSize: 11 }} />
          <span className="text-[11px] text-gray-500 flex-shrink-0">%</span>
        </div>
      </InlineLabel>
    )}

    {/* Размер ПОДПИСИ вентилятора (показатели у значка: расход, напор,
        мощность, КПД, название). Какие именно строки выводить — задаётся на
        вкладке «Индикаторы вентилятора». Положение подписи меняется
        перетаскиванием её мышью прямо на схеме. */}
    {onFanIndFontSize && (
      <InlineLabel label="Размер подписи">
        <div className="flex items-center gap-1 w-full">
          <input type="range" min={1} max={50} step={0.5}
            value={fanIndFontSize ?? 9}
            onChange={(e) => onFanIndFontSize(Number(e.target.value))}
            className="flex-1" style={{ accentColor: "#2563eb" }} />
          <input type="number" min={1} max={50} step={0.5}
            value={fanIndFontSize ?? 9}
            onChange={(e) => { const v = Math.min(50, Math.max(1, Number(e.target.value) || 9)); onFanIndFontSize(v); }}
            className="w-12 text-right text-gray-700 flex-shrink-0 border border-gray-300 rounded px-1"
            style={{ fontSize: 11 }} />
        </div>
      </InlineLabel>
    )}

    {onFanIndResetOffset && (
      <div className="px-1 pb-1">
        <button
          onClick={onFanIndResetOffset}
          className="text-[11px] px-2 py-0.5 rounded"
          style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", cursor: "pointer" }}
          title="Подпись двигается мышью прямо на схеме — эта кнопка вернёт её на место">
          Вернуть подпись на место
        </button>
      </div>
    )}

    {(onFanSymbolDelete || onReverse) && (
      <div className="px-1 py-1 flex gap-1">
        {onFanSymbolDelete && (
          <button
            onClick={onFanSymbolDelete}
            className="text-[11px] px-2 py-0.5 rounded"
            style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", cursor: "pointer" }}>
            Удалить УО
          </button>
        )}
        {onReverse && (
          <button
            onClick={onReverse}
            className="text-[11px] px-2 py-0.5 rounded flex items-center gap-1"
            style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", cursor: "pointer" }}>
            ⇄ Развернуть
          </button>
        )}
      </div>
    )}

    <SectionHeader title="Режим проветривания" />

    <InlineLabel label="Назначение">
      <select
        value={branch.fanType ?? "ГВУ"}
        onChange={(e) => onUpdate({ fanType: e.target.value as "ГВУ" | "ВВУ" | "ВМП" })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
        <option value="ГВУ">ГВУ — главная вентиляторная установка</option>
        <option value="ВВУ">ВВУ — вспомогательная вентиляторная установка</option>
        <option value="ВМП">ВМП — вентилятор местного проветривания</option>
      </select>
    </InlineLabel>

    <InlineLabel label="Тип">
      <select
        value={branch.fanMode}
        onChange={(e) => onUpdate({ fanMode: e.target.value as "constant" | "curve" })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
        <option value="constant">Постоянный напор</option>
        <option value="curve">Напорная характеристика</option>
      </select>
    </InlineLabel>

    {branch.fanType !== "ВМП" && (
      <>
        <InlineLabel label="Направление">
          <button
            onClick={() => onUpdate({ fanReverse: !(branch.fanReverse ?? false) })}
            disabled={branch.fanStopped}
            className="w-full text-[11px] px-2 rounded"
            style={{
              height: 18,
              background: branch.fanStopped ? "#f3f4f6" : branch.fanReverse ? "#fee2e2" : "#f0fdf4",
              color: branch.fanStopped ? "#9ca3af" : branch.fanReverse ? "#b91c1c" : "#15803d",
              border: `1px solid ${branch.fanStopped ? "#d1d5db" : branch.fanReverse ? "#fca5a5" : "#86efac"}`,
              cursor: branch.fanStopped ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}>
            {branch.fanReverse ? "⟵ Реверс (обратный)" : "⟶ Прямой (нормальный)"}
          </button>
        </InlineLabel>
        {branch.fanReverse && normalFlows && Object.keys(normalFlows).length === 0 && (
          <div className="mx-1 my-0.5 px-2 py-1 text-[10px] rounded"
            style={{ background: "#fef9c3", border: "1px solid #fde047", color: "#854d0e" }}>
            ⚠ Сначала выполните расчёт в прямом режиме — для проверки норматива ПБ (Q_рев ≥ 60%)
          </div>
        )}
      </>
    )}
    {branch.fanType === "ВМП" && (
      <div className="mx-1 my-0.5 px-2 py-1 text-[10px] rounded"
        style={{ background: "#f0f9ff", border: "1px solid #bae6fd", color: "#0369a1" }}>
        Для смены направления нагнетания — разверните ветвь (Ctrl+R)
      </div>
    )}

    <InlineLabel label="Состояние">
      <button
        onClick={() => onUpdate({ fanStopped: !(branch.fanStopped ?? false) })}
        className="w-full text-[11px] px-2 rounded"
        style={{
          height: 18,
          background: branch.fanStopped ? "#fef3c7" : "#f0fdf4",
          color: branch.fanStopped ? "#92400e" : "#15803d",
          border: `1px solid ${branch.fanStopped ? "#fcd34d" : "#86efac"}`,
          cursor: "pointer",
          fontWeight: 600,
        }}>
        {branch.fanStopped ? "⏹ Остановлен (H=0)" : "▶ Работает"}
      </button>
    </InlineLabel>

    {branch.fanMode === "constant" && (
      <>
        {branch.fanPressure <= 0 && (
          <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded"
            style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c" }}>
            ⚠ Напор = 0 Па. Расчёт даст Q=0. Задайте напор вентилятора.
          </div>
        )}
        <InlineLabel label="Напор, Па">
          <EditInput type="number" step="10" value={branch.fanPressure}
            onChange={(v) => onUpdate({ fanPressure: parseFloat(v) || 0 })} />
        </InlineLabel>
        <InlineLabel label="КПД, %">
          <EditInput type="number" step="1" value={Math.round(branch.fanEfficiency * 100) || 65}
            onChange={(v) => onUpdate({ fanEfficiency: (parseFloat(v) || 65) / 100 })} />
        </InlineLabel>
      </>
    )}

    {branch.fanMode === "curve" && (() => {
      const curve = getFanById(branch.fanCurveId);
      const rpm = branch.fanRpm || (curve?.rpmNominal ?? 0);
      const bladeAngle = branch.fanBladeAngle ?? (curve?.bladeAngles?.length ? curve.bladeAngles[Math.floor(curve.bladeAngles.length / 2)] : 45);

      // Строим Q-H график (SVG 240×110)
      const W = 240, H_svg = 110, padL = 36, padR = 8, padT = 8, padB = 24;
      const gW = W - padL - padR;
      const gH = H_svg - padT - padB;

      const renderChart = () => {
        if (!curve) return null;
        // Закон подобия: Q ~ n/n0, H ~ (n/n0)²
        const k = rpm > 0 && curve.rpmNominal > 0 ? rpm / curve.rpmNominal : 1;
        // Масштабированные пределы оси X
        const qMin = curve.qMin * k;
        const qMax = curve.qMax * k;

        const anglesToDraw = curve.bladeAngles.length > 0
          ? curve.bladeAngles
          : [bladeAngle];

        // Угловой коэф. лопаток (линейная интерполяция по диапазону углов)
        const angleFactor = (a: number) => {
          if (curve.bladeAngles.length < 2) return 1;
          const aMin = curve.bladeAngles[0];
          const aMax = curve.bladeAngles[curve.bladeAngles.length - 1];
          return 0.55 + 0.9 * (a - aMin) / Math.max(1, aMax - aMin);
        };

        // Шкала H: максимум по всем углам при номинальных оборотах * k²
        let hMax = 0;
        anglesToDraw.forEach(a => {
          const af = angleFactor(a);
          for (let i = 0; i <= 20; i++) {
            const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 20;
            const h = Math.max(0, curve.h0 * af + curve.h1 * qn + curve.h2 * qn * qn) * k * k;
            if (h > hMax) hMax = h;
          }
        });
        hMax = Math.ceil(hMax / 500) * 500 || 2000;

        // Маппинг координат: Q в диапазоне [qMin..qMax] (уже масштабированных)
        const tx = (q: number) => padL + (q - qMin) / (qMax - qMin) * gW;
        const ty = (h: number) => padT + gH - Math.max(0, Math.min(1, h / hMax)) * gH;

        const paths = anglesToDraw.map((a, ai) => {
          const af = angleFactor(a);
          const pts: string[] = [];
          for (let i = 0; i <= 30; i++) {
            // qn — номинальный расход, q — масштабированный (= qn * k)
            const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 30;
            const q = qn * k;
            const h = Math.max(0, curve.h0 * af + curve.h1 * qn + curve.h2 * qn * qn) * k * k;
            pts.push(`${tx(q).toFixed(1)},${ty(h).toFixed(1)}`);
          }
          const isSelected = a === bladeAngle;
          return (
            <polyline key={a}
              points={pts.join(" ")}
              fill="none"
              stroke={isSelected ? "#2563eb" : "#93c5fd"}
              strokeWidth={isSelected ? 1.8 : 1}
              strokeDasharray={isSelected ? undefined : "3,2"}
              opacity={isSelected ? 1 : 0.7}
              style={{ cursor: "pointer" }}
              onClick={() => onUpdate({ fanBladeAngle: a })}
            >
              <title>Угол {a}°</title>
            </polyline>
          );
          void ai;
        });

        // Рабочая точка
        const qWork = Math.abs(branch.flow);
        const R = qWork > 0.01 ? branch.fanPressure / (qWork * qWork) : 0;
        const workDot = qWork > 0.01 ? (
          <>
            <polyline
              points={Array.from({ length: 20 }, (_, i) => {
                const q = qMin + (qMax - qMin) * i / 19;
                return `${tx(q).toFixed(1)},${ty(R * q * q).toFixed(1)}`;
              }).join(" ")}
              fill="none" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4,2" />
            <circle cx={tx(qWork)} cy={ty(branch.fanPressure)} r={4} fill="#ef4444" stroke="white" strokeWidth={1} />
          </>
        ) : null;

        // Оси
        const nTicks = 4;
        const hTicks = Array.from({ length: nTicks + 1 }, (_, i) => Math.round(hMax * i / nTicks));
        const qTicks = Array.from({ length: 5 }, (_, i) => Math.round(qMin + (qMax - qMin) * i / 4));

        return (
          <svg width={W} height={H_svg} style={{ display: "block" }}>
            <rect x={padL} y={padT} width={gW} height={gH} fill="#f8faff" stroke="#d1d5db" strokeWidth={0.5} />
            {hTicks.map(h => (
              <g key={h}>
                <line x1={padL} y1={ty(h)} x2={padL + gW} y2={ty(h)} stroke="#e5e7eb" strokeWidth={0.5} />
                <text x={padL - 3} y={ty(h) + 3} textAnchor="end" fontSize={8} fill="#6b7280">{h}</text>
              </g>
            ))}
            {qTicks.map(q => (
              <g key={q}>
                <line x1={tx(q)} y1={padT} x2={tx(q)} y2={padT + gH} stroke="#e5e7eb" strokeWidth={0.5} />
                <text x={tx(q)} y={padT + gH + 10} textAnchor="middle" fontSize={8} fill="#6b7280">{q}</text>
              </g>
            ))}
            {/* Прямые кривые (прозрачнее при реверсе) */}
            <g opacity={branch.fanReverse ? 0.35 : 1}>{paths}</g>

            {/* Реверсная P–Q кривая */}
            {curve.reverseH0 !== undefined && curve.reverseH1 !== undefined && curve.reverseH2 !== undefined && (() => {
              const revQMax = (curve.reverseQMax ?? curve.qMax) * k;
              const revPts: string[] = [];
              for (let i = 0; i <= 30; i++) {
                const qn = curve.qMin + (curve.qMax - curve.qMin) * i / 30;
                const q  = qn * k;
                const hr = Math.max(0, curve.reverseH0! + curve.reverseH1! * qn + curve.reverseH2! * qn * qn) * k * k;
                if (q > revQMax) break;
                revPts.push(`${tx(q).toFixed(1)},${ty(hr).toFixed(1)}`);
              }
              return (
                <g opacity={branch.fanReverse ? 1 : 0.4}>
                  <polyline points={revPts.join(" ")} fill="none"
                    stroke="#dc2626" strokeWidth={branch.fanReverse ? 2 : 1.2}
                    strokeDasharray={branch.fanReverse ? undefined : "5,3"} />
                  <text x={padL + gW * 0.6} y={ty(curve.reverseH0! * k * k) - 3}
                    fontSize={7.5} fill="#dc2626">
                    {branch.fanReverse ? "⟵ Реверс" : "Реверс (инфо)"}
                  </text>
                </g>
              );
            })()}

            {workDot}
            <text x={padL + gW / 2} y={H_svg - 2} textAnchor="middle" fontSize={8} fill="#6b7280">Q, м³/с</text>
            <text x={6} y={padT + gH / 2} textAnchor="middle" fontSize={8} fill="#6b7280"
              transform={`rotate(-90,6,${padT + gH / 2})`}>H, Па</text>
            {curve.bladeAngles.length > 0 && (
              <text x={padL + gW - 2} y={padT + 10} textAnchor="end" fontSize={7.5} fill="#2563eb">
                — Угол {bladeAngle}°
              </text>
            )}
            {qWork > 0.01 && (
              <text x={tx(qWork) + 6} y={ty(Math.abs(branch.fanPressure)) - 4} fontSize={7.5} fill="#ef4444">
                Q={qWork.toFixed(1)}
              </text>
            )}
          </svg>
        );
      };

      return (
        <>
          {(!mineFans || mineFans.length === 0) ? (
            <div className="px-2 py-2 mx-1 my-1 rounded text-[10px] text-amber-700 leading-tight"
              style={{ background: "#fffbeb", border: "1px solid #fcd34d" }}>
              Вентиляторы не добавлены в библиотеку рудника.
              {onOpenFanLibrary && (
                <button onClick={onOpenFanLibrary}
                  className="block mt-1 underline text-blue-600 cursor-pointer"
                  style={{ background: "none", border: "none", padding: 0, fontSize: 10 }}>
                  Открыть справочник оборудования →
                </button>
              )}
            </div>
          ) : (
            <InlineLabel label="Модель">
              <select
                value={branch.fanCurveId}
                onChange={(e) => {
                  const f = getFanById(e.target.value);
                  // Площадь окна ΔS автоматически = площадь рабочего колеса π·D²/4
                  const dS = f && f.diameter > 0
                    ? Math.round((Math.PI * f.diameter * f.diameter / 4) * 100) / 100
                    : 0;
                  onUpdate({
                    fanCurveId: e.target.value,
                    fanName: f?.name ?? "",
                    fanRpm: f ? (f.rpmNominal ?? 0) : 0,
                    fanBladeAngle: f?.bladeAngles?.length ? f.bladeAngles[Math.floor(f.bladeAngles.length / 2)] : 45,
                    fanWindowArea: dS,
                  });
                }}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                <option value="">— выберите модель —</option>
                {FAN_CATALOG.filter(f => mineFans.some(mf => mf.catalogId === f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.name} (Ø{f.diameter} м)</option>
                ))}
              </select>
            </InlineLabel>
          )}

          {curve && curve.bladeAngles.length > 0 && (
            <InlineLabel label="Лопатки">
              <select
                value={bladeAngle}
                onChange={(e) => onUpdate({ fanBladeAngle: Number(e.target.value) })}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                {curve.bladeAngles.map(a => (
                  <option key={a} value={a}>Угол {a}°</option>
                ))}
              </select>
            </InlineLabel>
          )}

          {curve && (
            <>
              <InlineLabel label="Скорость">
                <div className="flex items-center gap-1 w-full">
                  <input
                    type="range"
                    min={curve.rpmMin} max={curve.rpmMax} step={10}
                    value={rpm}
                    onChange={(e) => onUpdate({ fanRpm: Number(e.target.value) })}
                    className="flex-1"
                    style={{ accentColor: "#2563eb" }} />
                  <span className="text-[10px] text-gray-700 w-16 text-right flex-shrink-0">
                    {rpm} об/мин
                  </span>
                </div>
              </InlineLabel>
              <div style={{ marginLeft: 88 }} className="pb-0.5">
                <span className="text-[9px] text-gray-400">от {curve.rpmMin} до {curve.rpmMax} об/мин</span>
              </div>

              <SectionHeader title="Характеристики" />
              <div className="flex justify-center py-1 overflow-x-auto" style={{ background: "#f8faff" }}>
                {renderChart()}
              </div>
              <div className="px-2 pb-1 flex gap-3 text-[9px] text-gray-400 justify-center flex-wrap">
                <span style={{ color: "#2563eb" }}>— выбранный угол</span>
                <span style={{ color: "#93c5fd" }}>-- другие углы</span>
                {Math.abs(branch.flow) > 0.01 && <span style={{ color: "#ef4444" }}>● рабочая точка</span>}
              </div>
            </>
          )}
        </>
      );
    })()}

    <InlineLabel label="В параллели">
      <EditInput type="number" step="1" value={branch.fanParallel ?? 1}
        onChange={(v) => onUpdate({ fanParallel: Math.max(1, parseInt(v) || 1) })} />
    </InlineLabel>

    <InlineLabel label="Установка">
      <select
        value={branch.fanInstall ?? "Внутри перемычки"}
        onChange={(e) => onUpdate({ fanInstall: e.target.value })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
        <option>Внутри перемычки</option>
        <option>Без перемычки</option>
      </select>
    </InlineLabel>

    {(branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки" && (() => {
      const cv = getFanById(branch.fanCurveId);
      const autoDS = cv && cv.diameter > 0 ? Math.PI * cv.diameter * cv.diameter / 4 : 0;
      const dS = (branch.fanWindowArea ?? 0) > 0.001 ? branch.fanWindowArea! : autoDS;
      return (
        <InlineLabel label="Пл. окна ΔS, м²">
          <ComputedInput value={numFmt(dS, 2)} />
        </InlineLabel>
      );
    })()}

    <SectionHeader title="Вычисленные параметры" />

    {branch.fanStopped && (
      <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded flex items-center gap-1"
        style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e" }}>
        ⏹ Вентилятор остановлен — напор H=0, воздух движется по естественной тяге
      </div>
    )}
    {!branch.fanStopped && branch.fanReverse && branch.fanType !== "ВМП" && (
      <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded flex items-center gap-1"
        style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c" }}>
        {(() => {
          const curve = getFanById(branch.fanCurveId);
          const eff = curve?.reverseEfficiencyFactor ?? 0.82;
          const pct = Math.round((1 - eff) * 100);
          return `⟵ Реверс (обратный): напор ~${Math.round(eff * 100)}% от прямого, КПД −${pct}%`;
        })()}
      </div>
    )}

    {(() => {
      if (!branch.hasFan || branch.fanMode !== "curve" || Math.abs(branch.flow) < 0.01) return null;
      const curve = getFanById(branch.fanCurveId);
      if (!curve) return null;
      const Q = Math.abs(branch.flow);
      const k = (branch.fanRpm > 0 && curve.rpmNominal > 0) ? branch.fanRpm / curve.rpmNominal : 1;
      let af = 1.0;
      if (curve.bladeAngles.length >= 2) {
        const lo = curve.bladeAngles[0], hi = curve.bladeAngles[curve.bladeAngles.length - 1];
        const a = Math.min(hi, Math.max(lo, branch.fanBladeAngle ?? (lo + hi) / 2));
        af = 0.65 + ((a - lo) / Math.max(1, hi - lo)) * 0.70;
      }
      const qMaxScaled = curve.qMax * af * k;
      if (Q <= qMaxScaled * 1.02) return null;
      return (
        <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded"
          style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e" }}>
          ⚠ Q={Q.toFixed(2)} м³/с превышает max {qMaxScaled.toFixed(1)} м³/с для {curve.name} (угол {branch.fanBladeAngle ?? "-"}°). Вентилятор вне паспортной зоны.
        </div>
      );
    })()}

    <InlineLabel label="Q выраб., м³/с">
      <ComputedInput value={branch.fanReverse && branch.fanType !== "ВМП"
        ? numFmt(-Math.abs(branch.flow), 2)
        : numFmt(Math.abs(branch.flow), 2)} />
    </InlineLabel>
    <InlineLabel label="Напор, Па">
      <ComputedInput value={numFmt(Math.abs(branch.fanPressure), 0)} />
    </InlineLabel>
    <InlineLabel label="Мощность, кВт">
      <ComputedInput value={numFmt(branch.fanShaftPower / 1000, 1)} />
    </InlineLabel>
    <InlineLabel label="КПД, %">
      <ComputedInput value={numFmt(branch.fanEfficiency * 100, 1)} />
    </InlineLabel>
    {(branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки" && (() => {
      const cv = getFanById(branch.fanCurveId);
      const autoDS = cv && cv.diameter > 0 ? Math.PI * cv.diameter * cv.diameter / 4 : 0;
      const dS = (branch.fanWindowArea ?? 0) > 0.001 ? branch.fanWindowArea! : autoDS;
      if (dS <= 0.001) return null;
      const sBr = branch.area ?? 0;
      const rWin = fanWindowRkMurg(dS, sBr);
      // ПОЧЕМУ R МОЖЕТ БЫТЬ НУЛЁМ. Окно в перемычке — это сужение потока:
      // сопротивление возникает только если окно УЖЕ выработки. Формула
      // R = ρ/(2·μ²)·(1/ΔS² − 1/S²) при ΔS ≥ S даёт ноль или отрицательное
      // значение, и раньше пользователь видел просто «0.0000» без пояснений.
      // Теперь показываем причину: сечение выработки не задано или меньше окна.
      const noSection = sBr <= 0.001;
      const windowTooBig = !noSection && dS >= sBr;
      return (
        <>
          <InlineLabel label="R окна, кМюрг">
            <ComputedInput value={numFmt(rWin, 4)} />
          </InlineLabel>
          {windowTooBig && (
            <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded"
              style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e" }}>
              ⚠ Площадь окна ΔS={numFmt(dS, 2)} м² не меньше сечения выработки
              S={numFmt(sBr, 2)} м² — окно не сужает поток, поэтому R окна = 0.
              Проверьте сечение выработки или уменьшите площадь окна.
            </div>
          )}
          {noSection && (
            <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded"
              style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e" }}>
              ⚠ У выработки не задано сечение S — R окна посчитан без учёта
              скорости подхода (как для очень большой выработки).
            </div>
          )}
        </>
      );
    })()}
    {(() => {
      const curve = getFanById(branch.fanCurveId);
      return curve ? (
        <InlineLabel label="Диаметр, м">
          <ComputedInput value={numFmt(curve.diameter, 1)} />
        </InlineLabel>
      ) : null;
    })()}
    <div className="px-1 py-0.5 text-[10px] text-gray-400">
      + : {branch.fromId} → {branch.toId}
    </div>
  </div>
  );
}
