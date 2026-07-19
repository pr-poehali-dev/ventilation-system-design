import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { type TopoBranch } from "@/lib/topology";

// ─── Справочник диаметров вентиляционных труб ────────────────────────────────
const VENT_PIPE_DIAMETERS = [
  { d: 300, label: "Ø 300 мм" },
  { d: 400, label: "Ø 400 мм" },
  { d: 500, label: "Ø 500 мм" },
  { d: 600, label: "Ø 600 мм" },
  { d: 700, label: "Ø 700 мм" },
  { d: 800, label: "Ø 800 мм" },
  { d: 1000, label: "Ø 1000 мм" },
  { d: 1200, label: "Ø 1200 мм" },
];

// Шероховатость по материалу (мм)
const ROUGHNESS_BY_MATERIAL: Record<string, number> = {
  "Пластик": 0.1,
  "Металл": 0.5,
  "Гибкий рукав": 3.0,
};

// ─── Расчёт аэродинамического сопротивления вентрубопровода ──────────────────
function calcVentPipeR(params: {
  diameter: number;     // мм
  length: number;       // м
  material: string;
  roughness: number;    // мм (при ручном режиме)
  roughnessMode: "auto" | "manual";
  localXi: number;
  leakageCoeff: number; // % на 100 м
  jointCount: number;
}): { R: number; lambda: number; leakage: number; dP_at1: number } {
  const D = params.diameter / 1000; // м
  const L = params.length;
  if (D <= 0 || L <= 0) return { R: 0, lambda: 0, leakage: 0, dP_at1: 0 };

  const eps = (params.roughnessMode === "auto"
    ? ROUGHNESS_BY_MATERIAL[params.material] ?? 0.2
    : params.roughness) / 1000; // м

  // Относительная шероховатость
  const relRough = eps / D;

  // Коэффициент Дарси-Вейсбаха (формула Колбрука–Уайта, упрощение для турбулентного режима)
  // λ ≈ 0.11 * (eps/D)^0.25 — для шероховатых труб (Re > 10^5)
  const lambda = Math.max(0.011, 0.11 * Math.pow(relRough, 0.25));

  const A = Math.PI * D * D / 4; // м²
  const rho = 1.2; // кг/м³

  // Учёт стыков: каждый стык +0.05 к xi
  const xiJoints = params.jointCount * 0.05;
  const xiTotal = params.localXi + xiJoints;

  // R = (lambda * L / D + xi) * rho / (2 * A²)  [Н·с²/м⁸]
  const R = (lambda * L / D + xiTotal) * rho / (2 * A * A);

  // Утечки: Q_утечка = leakageCoeff% * Q на каждые 100 м
  // Суммарные утечки как доля от расхода
  const leakageFraction = (params.leakageCoeff / 100) * (L / 100);

  // Давление при Q=1 м³/с (для индикации)
  const dP_at1 = R * 1.0;

  return { R, lambda, leakage: leakageFraction, dP_at1 };
}

// ─── Интерфейс пропсов ───────────────────────────────────────────────────────
interface Props {
  branches: TopoBranch[];           // выделенные ветви (одна или несколько)
  onClose: () => void;
  onApply: (patch: Partial<TopoBranch>) => void;
  onRemove: () => void;
}

// ─── Компонент диалога ───────────────────────────────────────────────────────
export default function VentPipeDialog({ branches, onClose, onApply, onRemove }: Props) {
  const first = branches[0];
  const multi = branches.length > 1;

  const totalLength = branches.reduce((s, b) => s + (b.vpLengthManual ? b.vpLength : b.length), 0);

  const [diameter, setDiameter]       = useState(first.vpDiameter || 500);
  const [material, setMaterial]       = useState(first.vpMaterial || "Пластик");
  const [lengthManual, setLengthManual] = useState(first.vpLengthManual || false);
  const [length, setLength]           = useState(first.vpLengthManual ? first.vpLength : totalLength);
  const [leakage, setLeakage]         = useState(first.vpLeakageCoeff ?? 0.5);
  const [joints, setJoints]           = useState(first.vpJointCount ?? 0);
  const [localXi, setLocalXi]         = useState(first.vpLocalXi ?? 0);
  const [roughnessMode, setRoughnessMode] = useState<"auto" | "manual">(first.vpRoughnessMode ?? "auto");
  const [roughness, setRoughness]     = useState(first.vpRoughness ?? 0.2);
  const [manualR, setManualR]         = useState<boolean>(false);
  const [manualRVal, setManualRVal]   = useState(first.vpManualR ?? 0);

  // Итоговая длина (авто или ручная)
  const effLength = lengthManual ? length : totalLength;

  // Расчёт
  const calc = calcVentPipeR({
    diameter,
    length: effLength,
    material,
    roughness,
    roughnessMode,
    localXi,
    leakageCoeff: leakage,
    jointCount: joints,
  });

  const R = manualR ? manualRVal : calc.R;

  useEffect(() => {
    if (!lengthManual) setLength(totalLength);
  }, [totalLength, lengthManual]);

  const handleApply = () => {
    const patch: Partial<TopoBranch> = {
      hasVentPipe: true,
      vpDiameter: diameter,
      vpMaterial: material,
      vpLengthManual: lengthManual,
      vpLength: lengthManual ? length : totalLength,
      vpLeakageCoeff: leakage,
      vpJointCount: joints,
      vpLocalXi: localXi,
      vpRoughnessMode: roughnessMode,
      vpRoughness: roughness,
      vpManualR: manualR ? manualRVal : 0,
      vpComputedR: R,
      vpComputedFlow: 0,
      vpComputedVelocity: 0,
      vpComputedDeltaP: 0,
      vpComputedLeakage: calc.leakage,
    };
    onApply(patch);
    onClose();
  };

  const inputCls = "w-full border border-gray-300 rounded px-2 py-1 text-[12px] text-gray-900 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400";
  const labelCls = "block text-[11px] font-semibold text-gray-800 mb-0.5";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col" style={{ maxHeight: "90vh" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ background: "#1a3a6b" }}>
          <div className="flex items-center gap-2 text-white font-bold text-[14px]">
            <Icon name="Wind" size={16} />
            {multi
              ? `Вентрубопровод — ${branches.length} ветв.`
              : "Вентиляционный трубопровод"}
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Маршрут */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-[11px] font-semibold text-blue-700 mb-1 flex items-center gap-1">
              <Icon name="Route" size={12} />
              Маршрут трубопровода
            </div>
            <div className="text-[12px] text-blue-900">
              {multi
                ? `${branches.length} ветвей · Узлы: ${branches[0].fromId.slice(-4)} → … → ${branches[branches.length - 1].toId.slice(-4)}`
                : `Ветвь: ${first.fromId.slice(-4)} → ${first.toId.slice(-4)}`}
            </div>
            <div className="text-[11px] text-blue-600 mt-0.5">
              Суммарная длина по ветвям: <b>{totalLength.toFixed(1)} м</b>
            </div>
          </div>

          {/* Параметры трубы */}
          <div>
            <div className="text-[12px] font-bold text-gray-700 mb-2 flex items-center gap-1">
              <Icon name="Cylinder" size={13} />
              Параметры трубы
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Диаметр</label>
                <select value={diameter} onChange={e => setDiameter(Number(e.target.value))}
                  className={inputCls}>
                  {VENT_PIPE_DIAMETERS.map(d => (
                    <option key={d.d} value={d.d}>{d.label}</option>
                  ))}
                  <option value={diameter} hidden={VENT_PIPE_DIAMETERS.some(d => d.d === diameter)}>
                    Ø {diameter} мм (задан)
                  </option>
                </select>
                <input type="number" min={100} max={2000} step={50} value={diameter}
                  onChange={e => setDiameter(Number(e.target.value))}
                  className={`${inputCls} mt-1`} placeholder="Другой диаметр, мм" />
              </div>
              <div>
                <label className={labelCls}>Материал</label>
                <select value={material} onChange={e => setMaterial(e.target.value)}
                  className={inputCls}>
                  <option>Пластик</option>
                  <option>Металл</option>
                  <option>Гибкий рукав</option>
                </select>
                <div className="text-[10px] text-gray-500 mt-1">
                  Шероховатость: {ROUGHNESS_BY_MATERIAL[material] ?? 0.2} мм
                </div>
              </div>
            </div>
          </div>

          {/* Длина */}
          <div>
            <div className="text-[12px] font-bold text-gray-700 mb-2">Длина трубопровода</div>
            <label className="flex items-center gap-2 text-[12px] text-gray-700 mb-2 cursor-pointer">
              <input type="checkbox" checked={lengthManual}
                onChange={e => setLengthManual(e.target.checked)}
                className="accent-blue-600" />
              Задать длину вручную
            </label>
            {lengthManual ? (
              <div>
                <label className={labelCls}>Длина, м</label>
                <input type="number" min={1} step={1} value={length}
                  onChange={e => setLength(Number(e.target.value))}
                  className={inputCls} />
              </div>
            ) : (
              <div className="text-[12px] text-gray-600 bg-gray-50 rounded px-3 py-2 border border-gray-200">
                Авто: <b>{totalLength.toFixed(1)} м</b> (по длинам ветвей)
              </div>
            )}
          </div>

          {/* Утечки и стыки */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Утечки, % на 100 м</label>
              <input type="number" min={0} max={30} step={0.1} value={leakage}
                onChange={e => setLeakage(Number(e.target.value))}
                className={inputCls} />
              <div className="text-[10px] text-gray-500 mt-0.5">
                Норма: 0.5–2% (пластик), 1–3% (металл)
              </div>
            </div>
            <div>
              <label className={labelCls}>Кол-во стыков</label>
              <input type="number" min={0} step={1} value={joints}
                onChange={e => setJoints(Number(e.target.value))}
                className={inputCls} />
              <div className="text-[10px] text-gray-500 mt-0.5">
                ξ стыка ≈ 0.05 за шт.
              </div>
            </div>
          </div>

          {/* Местные сопротивления */}
          <div>
            <label className={labelCls}>Сумма ξ местных сопротивлений (повороты, фасонины)</label>
            <input type="number" min={0} step={0.1} value={localXi}
              onChange={e => setLocalXi(Number(e.target.value))}
              className={inputCls} />
          </div>

          {/* Шероховатость */}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <label className={`${labelCls} mb-0`}>Шероховатость</label>
              <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer">
                <input type="radio" value="auto" checked={roughnessMode === "auto"}
                  onChange={() => setRoughnessMode("auto")} className="accent-blue-600" />
                Авто (по материалу)
              </label>
              <label className="flex items-center gap-1 text-[11px] text-gray-600 cursor-pointer">
                <input type="radio" value="manual" checked={roughnessMode === "manual"}
                  onChange={() => setRoughnessMode("manual")} className="accent-blue-600" />
                Вручную
              </label>
            </div>
            {roughnessMode === "manual" && (
              <input type="number" min={0.01} max={10} step={0.01} value={roughness}
                onChange={e => setRoughness(Number(e.target.value))}
                className={inputCls} placeholder="мм" />
            )}
          </div>

          {/* Ручное сопротивление */}
          <div>
            <label className="flex items-center gap-2 text-[12px] text-gray-700 cursor-pointer mb-1">
              <input type="checkbox" checked={manualR}
                onChange={e => setManualR(e.target.checked)}
                className="accent-blue-600" />
              Задать сопротивление вручную
            </label>
            {manualR && (
              <div>
                <label className={labelCls}>R, Н·с²/м⁸</label>
                <input type="number" min={0} step={0.001} value={manualRVal}
                  onChange={e => setManualRVal(Number(e.target.value))}
                  className={inputCls} />
              </div>
            )}
          </div>

          {/* Результаты расчёта */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="text-[11px] font-semibold text-green-700 mb-2 flex items-center gap-1">
              <Icon name="Calculator" size={12} />
              Расчётные параметры
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div className="text-gray-700">Диаметр:</div>
              <div className="font-semibold text-gray-900">{diameter} мм</div>
              <div className="text-gray-700">Площадь сечения:</div>
              <div className="font-semibold text-gray-900">
                {(Math.PI * (diameter/1000) ** 2 / 4).toFixed(4)} м²
              </div>
              <div className="text-gray-700">Длина:</div>
              <div className="font-semibold text-gray-900">{effLength.toFixed(1)} м</div>
              <div className="text-gray-700">λ Дарси:</div>
              <div className="font-semibold text-gray-900">{calc.lambda.toFixed(4)}</div>
              <div className="text-gray-700 font-bold">R трубы:</div>
              <div className="font-bold text-green-800">{R.toFixed(3)} Н·с²/м⁸</div>
              <div className="text-gray-500">Утечки на маршруте:</div>
              <div className="font-semibold text-orange-700">
                {(calc.leakage * 100).toFixed(1)}% от расхода
              </div>
            </div>
            {calc.leakage > 0.3 && (
              <div className="mt-2 text-[10px] text-orange-600 flex items-center gap-1">
                <Icon name="AlertTriangle" size={11} />
                Высокие утечки — проверьте стыки и выберите трубу с меньшей утечкой
              </div>
            )}
          </div>

        </div>

        {/* Кнопки */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onRemove}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] border border-red-200 text-red-600 hover:bg-red-50">
            <Icon name="Trash2" size={13} />
            Удалить трубу
          </button>
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-1.5 rounded text-[12px] border border-gray-300 text-gray-600 hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={handleApply}
            className="px-4 py-1.5 rounded text-[12px] font-semibold text-white"
            style={{ background: "#1a3a6b" }}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}