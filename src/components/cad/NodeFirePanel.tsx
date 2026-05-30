import { type TopoNode } from "@/lib/topology";
import { type WaterNodeResult } from "@/lib/waterHydraulics";

interface NodeFirePanelProps {
  node: TopoNode;
  onUpdate: (patch: Partial<TopoNode>) => void;
  waterResult?: WaterNodeResult;
  allNodes?: TopoNode[];
  allNodeResults?: Map<string, WaterNodeResult>;
}

const SH = "#e8eef8";
const SB = "1px solid #c8d4e8";
const CB = "#d4d4d4";
const CBB = "1px solid #b0b0b0";

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center px-1 py-0.5 text-[11px] font-semibold select-none"
      style={{ background: SH, borderBottom: SB, borderTop: SB, color: "#1a3a6b" }}>
      {title}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center" style={{ minHeight: 20, borderBottom: "1px solid #ebebeb" }}>
      <div className="flex-shrink-0 text-[11px] text-gray-700 px-1 leading-tight"
        style={{ width: 148, whiteSpace: "normal", lineHeight: "1.2" }}>
        {label}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function EditInput({
  value, onChange, type = "text", step, suffix,
}: {
  value: string | number; onChange: (v: string) => void;
  type?: string; step?: string; suffix?: string;
}) {
  return (
    <div className="flex items-center w-full">
      <input type={type} step={step} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-[11px] text-right px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none", fontFamily: "inherit", minWidth: 0 }}
      />
      {suffix && <span className="text-[10px] text-gray-500 px-1 flex-shrink-0">{suffix}</span>}
    </div>
  );
}

function ComputedInput({ value, empty }: { value: string; empty?: boolean }) {
  return (
    <div className="w-full text-[11px] text-right px-1 font-bold"
      style={{ background: CB, border: CBB, height: 18, lineHeight: "18px",
        color: empty ? "#999" : "#1a1a1a", userSelect: "text" }}>
      {value}
    </div>
  );
}

function CheckField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center px-1" style={{ height: 18 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 12, height: 12, cursor: "pointer" }} />
    </div>
  );
}

function SelectField({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full text-[11px] px-1"
      style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none", fontFamily: "inherit" }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const FIRE_NODE_TYPES = [
  { value: "none",      label: "— не задан —" },
  { value: "reservoir", label: "Резервуар с водой" },
  { value: "consumer",  label: "Потребитель воды" },
  { value: "junction",  label: "Соединение труб" },
];

const CONSUMER_TYPES = [
  { value: "fire_hydrant", label: "Кран пожарный" },
  { value: "sprinkler",    label: "Спринклер" },
  { value: "monitor",      label: "Лафетный ствол" },
  { value: "other",        label: "Прочее" },
];

const RESISTANCE_MODES = [
  { value: "project", label: "Проектными данными" },
  { value: "manual",  label: "Вручную" },
];

function numVal(v: number | undefined, d = 3): string {
  if (v === undefined || isNaN(v) || v === 0) return "";
  return v.toFixed(d);
}

function computedVal(v: number | undefined, d = 3, suffix = ""): string {
  if (v === undefined || isNaN(v) || v === 0) return `0${suffix ? " " + suffix : ""}`;
  return `${v.toFixed(d)}${suffix ? " " + suffix : ""}`;
}

export default function NodeFirePanel({ node, onUpdate, waterResult, allNodes = [], allNodeResults }: NodeFirePanelProps) {
  const fireType = node.fireNodeType ?? "none";
  const isOpen = node.fireHydrantOpen ?? false;
  const isConsumer = fireType === "consumer";
  const isReservoir = fireType === "reservoir";

  // Список всех открытых потребителей и их расчётные данные
  const openConsumers = isReservoir
    ? allNodes.filter(n => (n.fireNodeType ?? "none") === "consumer" && (n.fireHydrantOpen ?? false))
    : [];
  const totalFlow = openConsumers.reduce((s, c) => s + (allNodeResults?.get(c.id)?.flow ?? 0), 0);
  const capacity = node.fireCapacity ?? 0;
  const drainTime = totalFlow > 0 && capacity > 0 ? (capacity / totalFlow) * 60 : 0;

  // ─── Предупреждения ────────────────────────────────────────────
  // Минимально допустимое давление пожарного рукава (0.1 МПа = 1 атм)
  const MIN_PRESSURE = 0.1;
  // Нормативное время работы пожаротушения (60 мин по ГОСТ)
  const MIN_DRAIN_TIME = 60;

  const warnings: { level: "error" | "warn"; text: string }[] = [];

  if (isReservoir && openConsumers.length > 0) {
    // 1. Время работы резервуара меньше норматива
    if (drainTime > 0 && drainTime < MIN_DRAIN_TIME) {
      warnings.push({
        level: "error",
        text: `Время работы ${Math.round(drainTime)} мин < норматива ${MIN_DRAIN_TIME} мин. Увеличьте ёмкость резервуара.`,
      });
    }
    // 2. Потребители с недостаточным давлением (динамическое < 0.1 МПа)
    const lowPressure = openConsumers.filter(c => {
      const dp = allNodeResults?.get(c.id)?.dynamicP ?? 0;
      return dp > 0 && dp < MIN_PRESSURE;
    });
    if (lowPressure.length > 0) {
      const names = lowPressure.map(c => c.name || c.number || c.id.slice(-4)).join(", ");
      warnings.push({
        level: "error",
        text: `Давление ниже 0.1 МПа (1 атм) на: ${names}. Рукав может не работать.`,
      });
    }
    // 3. Потребители с расходом меньше требуемого
    const lowFlow = openConsumers.filter(c => {
      const req = c.fireRequiredFlow ?? 0;
      const act = allNodeResults?.get(c.id)?.flow ?? 0;
      return req > 0 && act < req * 0.9;
    });
    if (lowFlow.length > 0) {
      const names = lowFlow.map(c => c.name || c.number || c.id.slice(-4)).join(", ");
      warnings.push({
        level: "warn",
        text: `Расход < 90% от требуемого на: ${names}. Проверьте диаметры труб.`,
      });
    }
    // 4. Давление резервуара выше 1.0 МПа (10 атм) — риск разрыва рукавов
    const initP = node.fireInitPressure ?? 0;
    if (initP > 1.0) {
      warnings.push({
        level: "warn",
        text: `Давление резервуара ${(initP * 10).toFixed(1)} атм > 10 атм. Установите редукционный клапан на подводящих ветвях.`,
      });
    }
  }

  // Для потребителя — предупреждение о низком давлении
  if (isConsumer && isOpen) {
    const dp = waterResult?.dynamicP ?? 0;
    if (dp > 0 && dp < MIN_PRESSURE) {
      warnings.push({
        level: "error",
        text: `Динамическое давление ${(dp * 10).toFixed(2)} атм < 1 атм. Рукав не обеспечит тушение.`,
      });
    }
    const req = node.fireRequiredFlow ?? 0;
    const act = waterResult?.flow ?? 0;
    if (req > 0 && act < req * 0.9) {
      warnings.push({
        level: "warn",
        text: `Фактический расход ${act.toFixed(2)} м³/ч < требуемого ${req.toFixed(2)} м³/ч.`,
      });
    }
  }

  return (
    <div className="flex flex-col" style={{ fontSize: 11 }}>

      {/* Тип узла — всегда виден */}
      <SectionHeader title="Противопожарная защита" />
      <Row label="Тип узла:">
        <SelectField
          value={fireType}
          options={FIRE_NODE_TYPES}
          onChange={(v) => onUpdate({ fireNodeType: v as TopoNode["fireNodeType"] })}
        />
      </Row>

      {/* ─── РЕЗЕРВУАР ───────────────────────────────────────────── */}
      {fireType === "reservoir" && (<>
        <Row label="Начальное давление:">
          <EditInput type="number" step="0.01" suffix="МПа"
            value={node.fireInitPressure ?? 0}
            onChange={(v) => onUpdate({ fireInitPressure: parseFloat(v) || 0 })}
          />
        </Row>
        <Row label="Ёмкость:">
          <EditInput type="number" step="1" suffix="м³"
            value={node.fireCapacity ?? 0}
            onChange={(v) => onUpdate({ fireCapacity: parseFloat(v) || 0 })}
          />
        </Row>
      </>)}

      {/* ─── ПОТРЕБИТЕЛЬ ─────────────────────────────────────────── */}
      {fireType === "consumer" && (<>
        <Row label="Тип потребителя:">
          <SelectField
            value={node.fireConsumerType ?? "fire_hydrant"}
            options={CONSUMER_TYPES}
            onChange={(v) => onUpdate({ fireConsumerType: v as TopoNode["fireConsumerType"] })}
          />
        </Row>
        <Row label="Требуемый расход:">
          <EditInput type="number" step="0.1" suffix="м³/ч"
            value={node.fireRequiredFlow ?? 0}
            onChange={(v) => onUpdate({ fireRequiredFlow: parseFloat(v) || 0 })}
          />
        </Row>
        <Row label="Открыт:">
          <CheckField
            checked={node.fireHydrantOpen ?? false}
            onChange={(v) => onUpdate({ fireHydrantOpen: v })}
          />
        </Row>

        <SectionHeader title="Гидравлическое сопротивление" />
        <Row label="Задаётся:">
          <SelectField
            value={node.fireResistanceMode ?? "project"}
            options={RESISTANCE_MODES}
            onChange={(v) => onUpdate({ fireResistanceMode: v as TopoNode["fireResistanceMode"] })}
          />
        </Row>
        <Row label="Диаметр выходного отверстия:">
          <EditInput type="number" step="1" suffix="мм"
            value={node.fireHydrantDiameter ?? 0}
            onChange={(v) => onUpdate({ fireHydrantDiameter: parseFloat(v) || 0 })}
          />
        </Row>
        {(node.fireResistanceMode ?? "project") === "manual" && (
          <Row label="R, МН·с²/м⁸:">
            <EditInput type="number" step="0.001"
              value={node.fireManualR ?? 0}
              onChange={(v) => onUpdate({ fireManualR: parseFloat(v) || 0 })}
            />
          </Row>
        )}
      </>)}

      {/* ─── Вычисленные параметры ─────────────────────────────── */}
      {fireType !== "none" && (<>
        <SectionHeader title="Вычисленные параметры" />

        {/* Статическое давление — всегда */}
        <Row label="Статическое давление:">
          <ComputedInput
            value={numVal(waterResult?.staticP, 3)}
            empty={!waterResult?.staticP}
          />
        </Row>

        {/* Динамическое давление, расход, сопротивление — только при открытом кране */}
        {(!isConsumer || isOpen) && (
          <Row label="Динамическое давление:">
            <ComputedInput
              value={computedVal(waterResult?.dynamicP, 3, "МПа")}
              empty={!waterResult?.dynamicP}
            />
          </Row>
        )}
        {(!isConsumer || isOpen) && (
          <Row label="Расход:">
            <ComputedInput
              value={computedVal(waterResult?.flow, 2, "м³/ч")}
              empty={!waterResult?.flow}
            />
          </Row>
        )}
        {(!isConsumer || isOpen) && (
          <Row label="Сопротивление:">
            <ComputedInput
              value={computedVal(waterResult?.resistance, 4, "МН·с²/м⁸")}
              empty={!waterResult?.resistance}
            />
          </Row>
        )}

        {/* ─── Резервуар: суммарный расход и время работы ─── */}
        {isReservoir && (<>
          <Row label="Суммарный расход:">
            <ComputedInput
              value={totalFlow > 0 ? `${totalFlow.toFixed(2)} м³/ч` : "0.00 м³/ч"}
              empty={totalFlow === 0}
            />
          </Row>
          <Row label="Время работы:">
            <ComputedInput
              value={drainTime > 0 ? `${Math.round(drainTime)} мин` : "— мин"}
              empty={drainTime === 0}
            />
          </Row>

          {/* Таблица открытых потребителей */}
          {openConsumers.length > 0 && (<>
            <div className="flex items-center px-1 py-0.5 text-[10px] font-semibold select-none"
              style={{ background: SH, borderBottom: SB, borderTop: SB, color: "#1a3a6b" }}>
              Открытые краны ({openConsumers.length})
            </div>
            {/* Шапка таблицы */}
            <div className="flex text-[9px] text-gray-500 px-1 py-0.5"
              style={{ borderBottom: "1px solid #ebebeb", background: "#f8fafc" }}>
              <div style={{ width: 90 }}>Название / №</div>
              <div style={{ width: 55, textAlign: "right" }}>Расход</div>
              <div style={{ width: 55, textAlign: "right" }}>Дин. давл.</div>
              <div style={{ width: 40, textAlign: "right" }}>%</div>
            </div>
            {openConsumers.map(c => {
              const res = allNodeResults?.get(c.id);
              const q   = res?.flow    ?? 0;
              const dp  = res?.dynamicP ?? 0;
              const req = c.fireRequiredFlow ?? 0;
              const pct = req > 0 ? Math.round((q / req) * 100) : null;
              const ok  = pct !== null && pct >= 90;
              const label = c.name ? c.name : (c.number ? `Узел ${c.number}` : c.id.slice(-4));
              return (
                <div key={c.id} className="flex items-center text-[10px] px-1"
                  style={{ minHeight: 18, borderBottom: "1px solid #ebebeb" }}>
                  <div className="truncate" style={{ width: 90, color: "#374151" }} title={label}>
                    {label}
                  </div>
                  <div style={{ width: 55, textAlign: "right", fontWeight: 600, color: "#1a1a1a" }}>
                    {q.toFixed(2)}
                  </div>
                  <div style={{ width: 55, textAlign: "right", color: "#374151" }}>
                    {dp.toFixed(3)}
                  </div>
                  <div style={{ width: 40, textAlign: "right",
                    color: pct === null ? "#9ca3af" : ok ? "#15803d" : "#dc2626",
                    fontWeight: 600 }}>
                    {pct !== null ? `${pct}%` : "—"}
                  </div>
                </div>
              );
            })}
            {/* Итого */}
            <div className="flex items-center text-[10px] px-1 font-semibold"
              style={{ minHeight: 18, borderTop: "2px solid #c8d4e8", background: "#f0f4ff" }}>
              <div style={{ width: 90, color: "#1a3a6b" }}>Итого:</div>
              <div style={{ width: 55, textAlign: "right", color: "#1a3a6b" }}>
                {totalFlow.toFixed(2)}
              </div>
              <div style={{ width: 55, textAlign: "right" }}></div>
              <div style={{ width: 40, textAlign: "right", color: "#6b7280" }}>м³/ч</div>
            </div>
          </>)}

          {openConsumers.length === 0 && (
            <div className="px-2 py-1 text-[10px] text-gray-400 italic">
              Нет открытых потребителей
            </div>
          )}
        </>)}

        {/* Подсказка при закрытом кране */}
        {isConsumer && !isOpen && (
          <div className="px-2 py-1 text-[10px] text-gray-400 italic">
            Откройте кран для расчёта расхода
          </div>
        )}

        {/* ─── Блок предупреждений ──────────────────────────────── */}
        {warnings.length > 0 && (
          <div className="flex flex-col gap-0.5 px-1 py-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1 px-1.5 py-1 rounded text-[10px] leading-tight"
                style={{
                  background: w.level === "error" ? "#fef2f2" : "#fffbeb",
                  border: `1px solid ${w.level === "error" ? "#fca5a5" : "#fcd34d"}`,
                  color: w.level === "error" ? "#991b1b" : "#92400e",
                }}>
                <span style={{ flexShrink: 0, fontWeight: 700 }}>
                  {w.level === "error" ? "✕" : "⚠"}
                </span>
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        )}
      </>)}

      {/* ─── Описание узла ─────────────────────────────────────── */}
      {fireType !== "none" && (<>
        <div className="px-1 pt-1 text-[11px] text-gray-700">Описание узла:</div>
        <div className="px-1 pb-1">
          <textarea
            value={node.fireDescription ?? ""}
            onChange={(e) => onUpdate({ fireDescription: e.target.value })}
            rows={4}
            className="w-full text-[11px] px-1 py-0.5 resize-none"
            style={{ border: "1px solid #c8c8c8", outline: "none", fontFamily: "inherit", background: "white" }}
          />
        </div>
      </>)}

    </div>
  );
}