import { useState } from "react";
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

function ParamRow({
  id,
  label,
  visible,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  visible: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center" style={{ minHeight: 20, borderBottom: "1px solid #ebebeb" }}>
      <div className="flex items-center justify-center flex-shrink-0" style={{ width: 18 }}>
        <input
          type="checkbox"
          checked={visible}
          onChange={() => onToggle(id)}
          style={{ width: 11, height: 11, cursor: "pointer" }}
        />
      </div>
      <div className="flex-shrink-0 text-[11px] text-gray-700 px-1 leading-tight"
        style={{ width: 130, whiteSpace: "normal", lineHeight: "1.2" }}>
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
}: {
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
}) {
  return (
    <input
      type={type}
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full text-[11px] text-right px-1"
      style={{
        background: "white",
        border: "1px solid #c8c8c8",
        height: 18,
        outline: "none",
        fontFamily: "inherit",
      }}
    />
  );
}

function ComputedInput({ value }: { value: string }) {
  return (
    <div
      className="w-full text-[11px] text-right px-1 font-bold"
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

export default function NodePropsPanel({ node, onUpdate }: NodePropsPanelProps) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(["num", "x", "y", "z", "zsurf", "surface", "exit", "pressure", "temp", "conc", "humidity", "co",
      "c_gasconc", "c_airtemp", "c_walltemp", "c_pressure", "c_exppressure"])
  );

  const toggle = (id: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const numVal = (v: number, d = 2) => isNaN(v) ? "—" : v.toFixed(d);

  return (
    <div className="flex flex-col" style={{ fontSize: 11 }}>

      <SectionHeader title="Геометрия" />

      <ParamRow id="num" label="Номер узла" visible={visible.has("num")} onToggle={toggle}>
        <EditInput
          value={node.number}
          onChange={(v) => onUpdate({ number: v })}
        />
      </ParamRow>

      <ParamRow id="x" label="X, м" visible={visible.has("x")} onToggle={toggle}>
        <EditInput
          type="number"
          step="0.1"
          value={node.x}
          onChange={(v) => onUpdate({ x: parseFloat(v) || 0 })}
        />
      </ParamRow>

      <ParamRow id="y" label="Y, м" visible={visible.has("y")} onToggle={toggle}>
        <EditInput
          type="number"
          step="0.1"
          value={node.y}
          onChange={(v) => onUpdate({ y: parseFloat(v) || 0 })}
        />
      </ParamRow>

      <ParamRow id="z" label="Z, м (высотная отм.)" visible={visible.has("z")} onToggle={toggle}>
        <EditInput
          type="number"
          step="1"
          value={node.z}
          onChange={(v) => onUpdate({ z: parseFloat(v) || 0 })}
        />
      </ParamRow>

      <ParamRow id="zsurf" label="Z поверхности, м" visible={visible.has("zsurf")} onToggle={toggle}>
        <ComputedInput value="0" />
      </ParamRow>

      <ParamRow id="surface" label="Поверхностный" visible={visible.has("surface")} onToggle={toggle}>
        <CheckField
          checked={false}
          onChange={() => {}}
        />
      </ParamRow>

      <ParamRow id="exit" label="Выход (атмосфера)" visible={visible.has("exit")} onToggle={toggle}>
        <CheckField
          checked={node.atmosphereLink}
          onChange={(v) => onUpdate({ atmosphereLink: v })}
        />
      </ParamRow>

      <SectionHeader title="Физика" />

      <ParamRow id="pressure" label="Давление приведённое, Па" visible={visible.has("pressure")} onToggle={toggle}>
        <EditInput
          type="number"
          step="1"
          value={node.reducedPressure}
          onChange={(v) => onUpdate({ reducedPressure: parseFloat(v) || 0 })}
        />
      </ParamRow>

      <ParamRow id="temp" label="Температура воздуха, °C" visible={visible.has("temp")} onToggle={toggle}>
        <EditInput
          type="number"
          step="0.1"
          value={node.airTemp}
          onChange={(v) => onUpdate({ airTemp: parseFloat(v) || 0 })}
        />
      </ParamRow>

      <ParamRow id="conc" label="Концентрация газа, %" visible={visible.has("conc")} onToggle={toggle}>
        <EditInput
          type="number"
          step="0.01"
          value={node.computedGasConc}
          onChange={(v) => onUpdate({ computedGasConc: parseFloat(v) || 0 })}
        />
      </ParamRow>

      <ParamRow id="humidity" label="Влажность, %" visible={visible.has("humidity")} onToggle={toggle}>
        <ComputedInput value="—" />
      </ParamRow>

      <ParamRow id="co" label="CO в узле, мг/м³" visible={visible.has("co")} onToggle={toggle}>
        <ComputedInput value="—" />
      </ParamRow>

      <SectionHeader title="Вычисленные параметры" />

      <ParamRow id="c_gasconc" label="Концентрация газа (расч.), %" visible={visible.has("c_gasconc")} onToggle={toggle}>
        <ComputedInput value={numVal(node.computedGasConc, 3)} />
      </ParamRow>

      <ParamRow id="c_airtemp" label="Температура воздуха (расч.), °C" visible={visible.has("c_airtemp")} onToggle={toggle}>
        <ComputedInput value={numVal(node.computedAirTemp, 2)} />
      </ParamRow>

      <ParamRow id="c_walltemp" label="Температура стенок (расч.), °C" visible={visible.has("c_walltemp")} onToggle={toggle}>
        <ComputedInput value={numVal(node.computedWallTemp, 2)} />
      </ParamRow>

      <ParamRow id="c_pressure" label="Давление абс. (расч.), Па" visible={visible.has("c_pressure")} onToggle={toggle}>
        <ComputedInput value={numVal(node.computedPressure, 0)} />
      </ParamRow>

      <ParamRow id="c_exppressure" label="Давление взрыва (расч.), кПа" visible={visible.has("c_exppressure")} onToggle={toggle}>
        <ComputedInput value={numVal(node.computedExplosivePressure, 2)} />
      </ParamRow>

    </div>
  );
}
