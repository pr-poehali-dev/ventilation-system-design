// ─────────────────────────────────────────────────────────────────────────────
// NodePeoplePanel — свойства узла в части ЛЮДЕЙ и средств защиты.
// Данные используются расчётом зоны поражения при пожаре (evacuationRisk.ts):
// численность людей на рабочих местах, время защитного действия самоспасателя,
// камеры-убежища, пункты переключения (ПВП) и выходы на поверхность.
// Стилистика 1:1 с NodeFirePanel.
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode } from "@/lib/topology";
import { SectionHeader } from "@/components/cad/BranchPropsPrimitives";
import { SELF_RESCUER_CATALOG } from "@/lib/selfRescuers";

interface NodePeoplePanelProps {
  node: TopoNode;
  onUpdate: (patch: Partial<TopoNode>) => void;
  /** Все узлы — для сводки по численности смены */
  allNodes?: TopoNode[];
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
        className="flex-1 text-[11px] text-right px-1 cad-edit-input"
        style={{ background: "#ffffff", border: "1px solid #94a3b8", borderRadius: 2, height: 18, outline: "none", fontFamily: "inherit", minWidth: 0, color: "#0f172a" }}
      />
      {suffix && <span className="text-[10px] text-gray-500 px-1 flex-shrink-0">{suffix}</span>}
    </div>
  );
}

function ComputedInput({ value, empty }: { value: string; empty?: boolean }) {
  return (
    <div className="w-full text-[11px] text-right px-1 font-semibold tabular-nums"
      title="Расчётное значение — изменить нельзя"
      style={{ background: "#eef2f7", border: "1px solid #dde3ec", borderRadius: 2, height: 18, lineHeight: "16px",
        color: empty ? "#94a3b8" : "#0f172a", userSelect: "text", cursor: "default" }}>
      {value}
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

const PEOPLE_NODE_TYPES = [
  { value: "none",        label: "— не задан —" },
  { value: "workplace",   label: "Рабочее место (люди)" },
  { value: "refuge",      label: "Камера-убежище" },
  { value: "switchpoint", label: "ПВП (пункт переключения)" },
  { value: "exit",        label: "Выход на поверхность" },
];

function numVal(v: number | undefined): string {
  if (v === undefined || isNaN(v) || v === 0) return "";
  return String(v);
}

export default function NodePeoplePanel({ node, onUpdate, allNodes = [] }: NodePeoplePanelProps) {
  const pType = node.peopleNodeType ?? "none";
  const isWorkplace  = pType === "workplace";
  const isRefuge     = pType === "refuge";
  const isSwitch     = pType === "switchpoint";
  const hasCapacity  = isRefuge || isSwitch;

  const count = node.peopleCount ?? 0;
  const capacity = node.refugeCapacity ?? 0;

  // Сводка по шахте: всего людей в смену и число рабочих мест
  const workplaces = allNodes.filter(n => (n.peopleNodeType ?? "none") === "workplace");
  const totalPeople = workplaces.reduce((s, n) => s + (n.peopleCount ?? 0), 0);
  const exits = allNodes.filter(n => (n.peopleNodeType ?? "none") === "exit").length;

  // ─── Предупреждения ──────────────────────────────────────────
  const warnings: { level: "error" | "warn"; text: string }[] = [];

  if (isWorkplace && count <= 0) {
    warnings.push({ level: "warn", text: "Не указана численность людей — рабочее место не попадёт в расчёт" });
  }
  if (hasCapacity && capacity <= 0) {
    warnings.push({ level: "warn", text: "Не указана вместимость — проверка достаточности мест невозможна" });
  }
  if (isWorkplace && count > 0 && exits === 0) {
    warnings.push({ level: "error", text: "В схеме нет ни одного выхода на поверхность — расчёт эвакуации невозможен" });
  }
  if (hasCapacity && capacity > 0 && totalPeople > 0 && capacity < count) {
    warnings.push({ level: "error", text: `Вместимость ${capacity} чел. меньше численности ${count} чел.` });
  }

  const evacTime = node.evacComputedTime ?? 0;
  const evacSafe = node.evacComputedSafe;

  return (
    <div className="text-[11px]">
      <SectionHeader title="Люди и средства защиты" />

      <Row label="Назначение узла">
        <SelectField value={pType} options={PEOPLE_NODE_TYPES}
          onChange={(v) => onUpdate({ peopleNodeType: v as TopoNode["peopleNodeType"] })} />
      </Row>

      {pType === "none" && (
        <div className="px-1 py-1.5 text-[10px] text-gray-500 leading-snug">
          Укажите назначение узла, чтобы он участвовал в расчёте зоны поражения
          при пожаре: рабочие места с людьми, камеры-убежища, пункты переключения
          самоспасателей и выходы на поверхность.
        </div>
      )}

      {/* ─── Рабочее место ──────────────────────────────────────── */}
      {isWorkplace && (<>
        <Row label="Численность в смену">
          <EditInput type="number" step="1" suffix="чел" value={numVal(count)}
            onChange={(v) => onUpdate({ peopleCount: Math.max(0, Math.round(parseFloat(v) || 0)) })} />
        </Row>
        <Row label="Наименование места">
          <EditInput value={node.peopleDescription ?? ""}
            onChange={(v) => onUpdate({ peopleDescription: v })} />
        </Row>
        <Row label="Смена / участок">
          <EditInput value={node.peopleShift ?? ""}
            onChange={(v) => onUpdate({ peopleShift: v })} />
        </Row>
      </>)}

      {/* ─── Самоспасатель (для рабочих мест) ───────────────────── */}
      {isWorkplace && (<>
        <SectionHeader title="Самоспасатель" />
        <Row label="Марка">
          <SelectField
            value={node.selfRescuerModel ?? ""}
            options={[
              { value: "", label: "— по умолчанию —" },
              ...SELF_RESCUER_CATALOG.map(m => ({ value: m.id, label: m.name })),
            ]}
            onChange={(v) => {
              const m = SELF_RESCUER_CATALOG.find(x => x.id === v);
              onUpdate({
                selfRescuerModel: v,
                // Подставляем паспортное время защитного действия выбранной марки
                selfRescuerTime: m ? m.protectionTime : 0,
              });
            }} />
        </Row>
        <Row label="Время защ. действия">
          <EditInput type="number" step="1" suffix="мин"
            value={numVal(node.selfRescuerTime)}
            onChange={(v) => onUpdate({ selfRescuerTime: Math.max(0, parseFloat(v) || 0) })} />
        </Row>
        <div className="px-1 pb-1 text-[10px] text-gray-500 leading-snug">
          Пусто — берётся значение из параметров расчёта зоны поражения.
        </div>
      </>)}

      {/* ─── Камера-убежище / ПВП ───────────────────────────────── */}
      {hasCapacity && (<>
        <Row label="Вместимость">
          <EditInput type="number" step="1" suffix="чел" value={numVal(capacity)}
            onChange={(v) => onUpdate({ refugeCapacity: Math.max(0, Math.round(parseFloat(v) || 0)) })} />
        </Row>
        <Row label="Наименование">
          <EditInput value={node.peopleDescription ?? ""}
            onChange={(v) => onUpdate({ peopleDescription: v })} />
        </Row>
      </>)}

      {/* ─── Выход на поверхность ───────────────────────────────── */}
      {pType === "exit" && (<>
        <Row label="Наименование">
          <EditInput value={node.peopleDescription ?? ""}
            onChange={(v) => onUpdate({ peopleDescription: v })} />
        </Row>
        <div className="px-1 py-1 text-[10px] text-gray-500 leading-snug">
          Узел считается целью эвакуации. Люди с рабочих мест выводятся
          к ближайшему по времени выходу.
        </div>
      </>)}

      {/* ─── Результаты расчёта эвакуации ───────────────────────── */}
      {isWorkplace && (evacTime > 0 || evacSafe !== undefined) && (<>
        <SectionHeader title="Результаты эвакуации" />
        <Row label="Время выхода">
          <ComputedInput value={evacTime > 0 ? `${evacTime.toFixed(1)} мин` : "—"} empty={evacTime <= 0} />
        </Row>
        <Row label="Успевают выйти">
          <div className="w-full text-[11px] text-right px-1 font-semibold"
            style={{ background: "#eef2f7", border: "1px solid #dde3ec", borderRadius: 2, height: 18, lineHeight: "16px",
              color: evacSafe === undefined ? "#94a3b8" : evacSafe ? "#15803d" : "#dc2626" }}>
            {evacSafe === undefined ? "—" : evacSafe ? "Да" : "Нет"}
          </div>
        </Row>
        <Row label="В зоне задымления">
          <div className="w-full text-[11px] text-right px-1 font-semibold"
            style={{ background: "#eef2f7", border: "1px solid #dde3ec", borderRadius: 2, height: 18, lineHeight: "16px",
              color: node.evacComputedSmoke === undefined ? "#94a3b8" : node.evacComputedSmoke ? "#dc2626" : "#15803d" }}>
            {node.evacComputedSmoke === undefined ? "—" : node.evacComputedSmoke ? "Да" : "Нет"}
          </div>
        </Row>
      </>)}

      {/* ─── Сводка по шахте ────────────────────────────────────── */}
      {pType !== "none" && totalPeople > 0 && (
        <div className="px-1 py-1 text-[10px] text-gray-500 leading-snug"
          style={{ borderTop: "1px solid #ebebeb" }}>
          Всего в схеме: {totalPeople} чел. на {workplaces.length} рабочих местах,
          выходов на поверхность — {exits}.
        </div>
      )}

      {/* ─── Предупреждения ─────────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="px-1 py-1" style={{ borderTop: "1px solid #ebebeb" }}>
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1 text-[10px] leading-tight py-0.5"
              style={{ color: w.level === "error" ? "#b91c1c" : "#a16207" }}>
              <span style={{ flexShrink: 0, fontWeight: 700 }}>
                {w.level === "error" ? "✕" : "⚠"}
              </span>
              <span>{w.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
