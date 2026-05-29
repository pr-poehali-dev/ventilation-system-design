import { type TopoNode } from "@/lib/topology";

interface NodePropsPanelProps {
  node: TopoNode;
  onUpdate: (patch: Partial<TopoNode>) => void;
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

function SubHeader({ title }: { title: string }) {
  return (
    <div className="px-1 py-0.5 text-[11px] font-bold select-none"
      style={{ background: "#f0f4fb", borderBottom: "1px solid #dde4f0", color: "#1a3a6b" }}>
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
  value,
  onChange,
  type = "text",
  step,
  suffix,
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center w-full">
      <input
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 text-[11px] text-right px-1"
        style={{
          background: "white",
          border: "1px solid #c8c8c8",
          height: 18,
          outline: "none",
          fontFamily: "inherit",
          minWidth: 0,
        }}
      />
      {suffix && <span className="text-[10px] text-gray-500 px-1 flex-shrink-0">{suffix}</span>}
    </div>
  );
}

function ComputedInput({ value, suffix }: { value: string; suffix?: string }) {
  return (
    <div className="flex items-center w-full">
      <div
        className="flex-1 text-[11px] text-right px-1 font-bold"
        style={{
          background: CB,
          border: CBB,
          height: 18,
          lineHeight: "18px",
          color: "#1a1a1a",
          userSelect: "text",
        }}>
        {value}
      </div>
      {suffix && <span className="text-[10px] text-gray-500 px-1 flex-shrink-0">{suffix}</span>}
    </div>
  );
}

function CheckField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center px-1" style={{ height: 18 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 12, height: 12, cursor: "pointer" }}
      />
    </div>
  );
}

function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[11px] px-1"
      style={{
        background: "white",
        border: "1px solid #c8c8c8",
        height: 18,
        outline: "none",
        fontFamily: "inherit",
      }}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

const FIRE_NODE_TYPE_OPTIONS = [
  { value: "none",      label: "— не задан —" },
  { value: "reservoir", label: "Резервуар с водой" },
  { value: "consumer",  label: "Потребитель воды" },
  { value: "junction",  label: "Соединение труб" },
];

const FIRE_CONSUMER_TYPE_OPTIONS = [
  { value: "fire_hydrant", label: "Кран пожарный" },
  { value: "sprinkler",    label: "Спринклер" },
  { value: "monitor",      label: "Лафетный ствол" },
  { value: "other",        label: "Прочее" },
];

const FIRE_RESISTANCE_MODE_OPTIONS = [
  { value: "project", label: "Проектными данными" },
  { value: "manual",  label: "Вручную" },
];

export default function NodePropsPanel({ node, onUpdate }: NodePropsPanelProps) {
  const numVal = (v: number | undefined, d = 2) =>
    v === undefined || isNaN(v) ? "—" : v.toFixed(d);

  const fireType = node.fireNodeType ?? "none";

  return (
    <div className="flex flex-col" style={{ fontSize: 11 }}>

      {/* ─── Противопожарная защита ─────────────────────────────── */}
      <SubHeader title="Противопожарная защита" />

      <Row label="Тип узла:">
        <SelectField
          value={fireType}
          options={FIRE_NODE_TYPE_OPTIONS}
          onChange={(v) => onUpdate({ fireNodeType: v as TopoNode["fireNodeType"] })}
        />
      </Row>

      {/* Резервуар с водой */}
      {fireType === "reservoir" && (<>
        <Row label="Начальное давление:">
          <EditInput
            type="number" step="0.01"
            value={node.fireInitPressure ?? 0}
            onChange={(v) => onUpdate({ fireInitPressure: parseFloat(v) || 0 })}
            suffix="МПа"
          />
        </Row>
        <Row label="Ёмкость:">
          <EditInput
            type="number" step="1"
            value={node.fireCapacity ?? 0}
            onChange={(v) => onUpdate({ fireCapacity: parseFloat(v) || 0 })}
            suffix="м³"
          />
        </Row>
      </>)}

      {/* Потребитель воды */}
      {fireType === "consumer" && (<>
        <Row label="Тип потребителя:">
          <SelectField
            value={node.fireConsumerType ?? "fire_hydrant"}
            options={FIRE_CONSUMER_TYPE_OPTIONS}
            onChange={(v) => onUpdate({ fireConsumerType: v as TopoNode["fireConsumerType"] })}
          />
        </Row>
        <Row label="Требуемый расход:">
          <EditInput
            type="number" step="0.1"
            value={node.fireRequiredFlow ?? 0}
            onChange={(v) => onUpdate({ fireRequiredFlow: parseFloat(v) || 0 })}
            suffix="м³/ч"
          />
        </Row>
        <Row label="Открыт:">
          <CheckField
            checked={node.fireHydrantOpen ?? false}
            onChange={(v) => onUpdate({ fireHydrantOpen: v })}
          />
        </Row>
      </>)}

      {/* Гидравлическое сопротивление — для резервуара и потребителя */}
      {(fireType === "consumer") && (<>
        <SubHeader title="Гидравлическое сопротивление" />
        <Row label="Задаётся:">
          <SelectField
            value={node.fireResistanceMode ?? "project"}
            options={FIRE_RESISTANCE_MODE_OPTIONS}
            onChange={(v) => onUpdate({ fireResistanceMode: v as TopoNode["fireResistanceMode"] })}
          />
        </Row>
        <Row label="Диаметр выходного отверстия:">
          <EditInput
            type="number" step="1"
            value={node.fireHydrantDiameter ?? 0}
            onChange={(v) => onUpdate({ fireHydrantDiameter: parseFloat(v) || 0 })}
            suffix="мм"
          />
        </Row>
      </>)}

      {/* Вычисленные параметры ППЗ */}
      {fireType !== "none" && (<>
        <SubHeader title="Вычисленные параметры" />
        <Row label="Статическое давление:">
          <ComputedInput
            value={node.fireComputedStaticP ? numVal(node.fireComputedStaticP, 3) : ""}
          />
        </Row>
        <Row label="Динамическое давление:">
          <ComputedInput
            value={`${numVal(node.fireComputedDynamicP ?? 0, 3)} МПа`}
          />
        </Row>
        <Row label="Расход:">
          <ComputedInput
            value={`${numVal(node.fireComputedFlow ?? 0, 2)} м³/ч`}
          />
        </Row>
        <Row label="Сопротивление:">
          <ComputedInput
            value={`${numVal(node.fireComputedR ?? 0, 2)} МН·с²/м⁸`}
          />
        </Row>
        {fireType === "reservoir" && (
          <Row label="Время истечения:">
            <ComputedInput
              value={`${numVal(node.fireComputedDrainTime ?? 0, 0)} мин`}
            />
          </Row>
        )}
      </>)}

      {/* Описание узла */}
      {fireType !== "none" && (
        <>
          <div className="px-1 pt-1 text-[11px] text-gray-700">Описание узла:</div>
          <div className="px-1 pb-1">
            <textarea
              value={node.fireDescription ?? ""}
              onChange={(e) => onUpdate({ fireDescription: e.target.value })}
              rows={4}
              className="w-full text-[11px] px-1 py-0.5 resize-none"
              style={{
                border: "1px solid #c8c8c8",
                outline: "none",
                fontFamily: "inherit",
                background: "white",
              }}
            />
          </div>
        </>
      )}

      {/* ─── Геометрия ──────────────────────────────────────────── */}
      <SectionHeader title="Геометрия" />

      <Row label="Номер узла">
        <EditInput
          value={node.number}
          onChange={(v) => onUpdate({ number: v })}
        />
      </Row>

      <Row label="X, м">
        <EditInput
          type="number" step="0.1"
          value={node.x}
          onChange={(v) => onUpdate({ x: parseFloat(v) || 0 })}
        />
      </Row>

      <Row label="Y, м">
        <EditInput
          type="number" step="0.1"
          value={node.y}
          onChange={(v) => onUpdate({ y: parseFloat(v) || 0 })}
        />
      </Row>

      <Row label="Z, м (высотная отм.)">
        <EditInput
          type="number" step="1"
          value={node.z}
          onChange={(v) => onUpdate({ z: parseFloat(v) || 0 })}
        />
      </Row>

      <Row label="Z поверхности, м">
        <ComputedInput value="0" />
      </Row>

      <Row label="Выход (атмосфера)">
        <CheckField
          checked={node.atmosphereLink}
          onChange={(v) => onUpdate({ atmosphereLink: v })}
        />
      </Row>

      {/* ─── Физика ─────────────────────────────────────────────── */}
      <SectionHeader title="Физика" />

      <Row label="Давление приведённое, Па">
        <EditInput
          type="number" step="1"
          value={node.reducedPressure}
          onChange={(v) => onUpdate({ reducedPressure: parseFloat(v) || 0 })}
        />
      </Row>

      <Row label="Температура воздуха, °C">
        <EditInput
          type="number" step="0.1"
          value={node.airTemp}
          onChange={(v) => onUpdate({ airTemp: parseFloat(v) || 0 })}
        />
      </Row>

      <Row label="Концентрация газа, %">
        <EditInput
          type="number" step="0.01"
          value={node.computedGasConc}
          onChange={(v) => onUpdate({ computedGasConc: parseFloat(v) || 0 })}
        />
      </Row>

      <Row label="Влажность, %">
        <ComputedInput value="—" />
      </Row>

      <Row label="CO в узле, мг/м³">
        <ComputedInput value="—" />
      </Row>

      {/* ─── Вычисленные параметры ──────────────────────────────── */}
      <SectionHeader title="Вычисленные параметры" />

      <Row label="Концентрация газа (расч.), %">
        <ComputedInput value={numVal(node.computedGasConc, 3)} />
      </Row>

      <Row label="Температура воздуха (расч.), °C">
        <ComputedInput value={numVal(node.computedAirTemp, 2)} />
      </Row>

      <Row label="Температура стенок (расч.), °C">
        <ComputedInput value={numVal(node.computedWallTemp, 2)} />
      </Row>

      <Row label="Давление абс. (расч.), Па">
        <ComputedInput value={numVal(node.computedPressure, 0)} />
      </Row>

      <Row label="Давление взрыва (расч.), кПа">
        <ComputedInput value={numVal(node.computedExplosivePressure, 2)} />
      </Row>

    </div>
  );
}
