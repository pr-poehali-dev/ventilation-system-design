import { type TopoNode, surveyXYZ, nodeSurveyOffset, isNodeMoved } from "@/lib/topology";
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
  /** Вернуть узел на его маркшейдерское место */
  onResetToSurvey?: () => void;
}

export default function NodePropsPanel({ node, onUpdate, onResetToSurvey }: NodePropsPanelProps) {
  const numVal = (v: number | undefined, d = 2) => v === undefined || isNaN(v) ? "—" : v.toFixed(d);

  // Маркшейдерские координаты и величина сдвига изображения узла от них.
  const survey = surveyXYZ(node);
  const offset = nodeSurveyOffset(node);
  const moved = isNodeMoved(node);

  return (
    <div className="flex flex-col" style={{ fontSize: 11 }}>

      <SectionHeader title="Геометрия" />

      <Row label="Номер узла">
        <EditInput value={node.number} onChange={(v) => onUpdate({ number: v })} />
      </Row>
      <Row label="Название">
        <EditInput value={node.name} onChange={(v) => onUpdate({ name: v })} />
      </Row>
      {/* Ручной ввод координат — это ввод МАРКШЕЙДЕРСКИХ значений, поэтому
          двигаем и эталон, и изображение узла: пользователь уточняет, где
          выработка находится на самом деле, а не двигает картинку. */}
      <Row label="X, м">
        <EditInput type="number" step="0.1" value={survey.x}
          onChange={(v) => { const x = parseFloat(v) || 0; onUpdate({ x, surveyX: x }); }} />
      </Row>
      <Row label="Y, м">
        <EditInput type="number" step="0.1" value={survey.y}
          onChange={(v) => { const y = parseFloat(v) || 0; onUpdate({ y, surveyY: y }); }} />
      </Row>
      <Row label="Z, м (высотная отм.)">
        <EditInput type="number" step="1" value={survey.z}
          onChange={(v) => { const z = parseFloat(v) || 0; onUpdate({ z, surveyZ: z }); }} />
      </Row>

      {/* Узел сдвинут для читаемости схемы. Показываем, насколько именно, и
          даём вернуть его на место — раньше исходные координаты терялись. */}
      {moved && (
        <div className="mx-1 my-1 px-2 py-1.5 rounded text-[10px] leading-snug"
          style={{ background: "#fffbeb", border: "1px solid #fcd34d", color: "#92400e" }}>
          <div className="font-semibold mb-0.5">
            Узел сдвинут на {offset < 10 ? offset.toFixed(1) : Math.round(offset)} м
          </div>
          <div>
            Это сдвиг только по схеме, для читаемости. Расчёт длин выработок
            идёт по маркшейдерским координатам выше — они не изменились.
          </div>
          {onResetToSurvey && (
            <button onClick={onResetToSurvey}
              className="mt-1 px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{ background: "#fff", border: "1px solid #d97706", color: "#92400e", cursor: "pointer" }}>
              Вернуть на маркшейдерское место
            </button>
          )}
        </div>
      )}
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