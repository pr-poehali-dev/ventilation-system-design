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
  value, onChange, type = "text", step,
}: {
  value: string | number; onChange: (v: string) => void;
  type?: string; step?: string;
}) {
  return (
    <input type={type} step={step} value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[11px] text-right px-1"
      style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none", fontFamily: "inherit" }}
    />
  );
}

function ComputedInput({ value }: { value: string }) {
  return (
    <div className="w-full text-[11px] text-right px-1 font-bold"
      style={{ background: CB, border: CBB, height: 18, lineHeight: "18px", color: "#1a1a1a", userSelect: "text" }}>
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

export default function NodePropsPanel({ node, onUpdate }: NodePropsPanelProps) {
  const numVal = (v: number | undefined, d = 2) => v === undefined || isNaN(v) ? "—" : v.toFixed(d);

  return (
    <div className="flex flex-col" style={{ fontSize: 11 }}>

      <SectionHeader title="Геометрия" />

      <Row label="Номер узла">
        <EditInput value={node.number} onChange={(v) => onUpdate({ number: v })} />
      </Row>
      <Row label="Название">
        <EditInput value={node.name} onChange={(v) => onUpdate({ name: v })} />
      </Row>
      <Row label="X, м">
        <EditInput type="number" step="0.1" value={node.x} onChange={(v) => onUpdate({ x: parseFloat(v) || 0 })} />
      </Row>
      <Row label="Y, м">
        <EditInput type="number" step="0.1" value={node.y} onChange={(v) => onUpdate({ y: parseFloat(v) || 0 })} />
      </Row>
      <Row label="Z, м (высотная отм.)">
        <EditInput type="number" step="1" value={node.z} onChange={(v) => onUpdate({ z: parseFloat(v) || 0 })} />
      </Row>
      <Row label="Z поверхности, м">
        <ComputedInput value="0" />
      </Row>
      <Row label="Выход (атмосфера)">
        <CheckField checked={node.atmosphereLink} onChange={(v) => onUpdate({ atmosphereLink: v })} />
      </Row>

      <SectionHeader title="Физика" />

      <Row label="Давление приведённое, Па">
        <EditInput type="number" step="1" value={node.reducedPressure}
          onChange={(v) => onUpdate({ reducedPressure: parseFloat(v) || 0 })} />
      </Row>
      <Row label="Температура воздуха, °C">
        <EditInput type="number" step="0.1" value={node.airTemp}
          onChange={(v) => onUpdate({ airTemp: parseFloat(v) || 0 })} />
      </Row>
      <Row label="Концентрация газа, %">
        <EditInput type="number" step="0.01" value={node.computedGasConc}
          onChange={(v) => onUpdate({ computedGasConc: parseFloat(v) || 0 })} />
      </Row>
      <Row label="Влажность, %">
        <ComputedInput value="—" />
      </Row>
      <Row label="CO в узле, мг/м³">
        <ComputedInput value="—" />
      </Row>

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