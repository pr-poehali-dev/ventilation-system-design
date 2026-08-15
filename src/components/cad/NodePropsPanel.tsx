import { type TopoNode } from "@/lib/topology";
import { SectionHeader, EditInput, ComputedInput, CheckField } from "@/components/cad/BranchPropsPrimitives";

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

interface NodePropsPanelProps {
  node: TopoNode;
  onUpdate: (patch: Partial<TopoNode>) => void;
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
      {/* Влажность узла (норматив, прил. 9, форм. 9.2). Пусто = значение по
          умолчанию из параметров расчёта: для атмосферных узлов влажность на
          поверхности, для подземных — влажность рудничного воздуха. */}
      <Row label="Влажность, %">
        <EditInput type="number" step="1"
          value={node.airHumidity ?? ""}
          placeholder="по умолчанию"
          onChange={(v) => onUpdate({
            airHumidity: v.trim() === "" ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0)),
          })} />
      </Row>
      <Row label="CO в узле, мг/м³">
        <ComputedInput value="—" />
      </Row>

      <SectionHeader title="Вычисленные параметры" />

      <Row label="Концентрация газа СО (расч.), %">
        <ComputedInput value={numVal(node.computedCO, 4)} />
      </Row>
      <Row label="Концентрация газа СО₂ (расч.), %">
        <ComputedInput value={numVal(node.computedCO2, 2)} />
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
      <Row label="Депрессия (расч.), Па">
        <ComputedInput value={numVal(node.computedFanPressure, 0)} />
      </Row>
      <Row label="Давление взрыва (расч.), кПа">
        <ComputedInput value={numVal(node.computedExplosivePressure, 2)} />
      </Row>

    </div>
  );
}