import { type TopoNode } from "@/lib/topology";
import { type WaterNodeResult } from "@/lib/waterHydraulics";

interface NodeFirePanelProps {
  node: TopoNode;
  onUpdate: (patch: Partial<TopoNode>) => void;
  waterResult?: WaterNodeResult;
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

export default function NodeFirePanel({ node, onUpdate, waterResult }: NodeFirePanelProps) {
  const fireType = node.fireNodeType ?? "none";

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
        <Row label="Статическое давление:">
          <ComputedInput
            value={numVal(waterResult?.staticP, 3)}
            empty={!waterResult?.staticP}
          />
        </Row>
        <Row label="Динамическое давление:">
          <ComputedInput
            value={computedVal(waterResult?.dynamicP, 3, "МПа")}
            empty={!waterResult?.dynamicP}
          />
        </Row>
        <Row label="Расход:">
          <ComputedInput
            value={computedVal(waterResult?.flow, 2, "м³/ч")}
            empty={!waterResult?.flow}
          />
        </Row>
        <Row label="Сопротивление:">
          <ComputedInput
            value={computedVal(waterResult?.resistance, 4, "МН·с²/м⁸")}
            empty={!waterResult?.resistance}
          />
        </Row>
        {fireType === "reservoir" && (
          <Row label="Время истечения:">
            <ComputedInput
              value={computedVal(waterResult?.drainTime, 0, "мин")}
              empty={!waterResult?.drainTime}
            />
          </Row>
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
