import { useState, useEffect } from "react";
import Icon from "@/components/ui/icon";
import { type TopoBranch } from "@/lib/topology";
import { resistanceFromPipe, PIPE_ALPHA_TYPES } from "@/lib/aerodynamics";
import { VENT_DUCT_BRANDS, getDuctBrand, getDuctSize, formatStaticResistance } from "@/lib/ventDucts";

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

// ─── Расчёт аэродинамического сопротивления вентрубопровода ──────────────────
// Используем ту же формулу, что и во вкладке «Топология» → «Способ задания R»
// → «Трубопровод (R=6.48·α·L/D⁵)»: resistanceFromPipe(α, L, D).
// Стыки учитываем добавкой к α (каждый стык слегка увеличивает сопротивление).
function calcVentPipeR(params: {
  diameter: number;     // мм
  length: number;       // м
  pipeAlpha: number;    // α, ×10⁻⁴ Н·с²/м⁴
  jointCount: number;
  leakageCoeff: number; // % на 100 м
}): { R: number; leakage: number } {
  const D = params.diameter / 1000; // мм → м
  const L = params.length;
  // Стыки: каждый стык эквивалентен +2% к α трубопровода.
  const effAlpha = params.pipeAlpha * (1 + params.jointCount * 0.02);
  const R = resistanceFromPipe(effAlpha, L, D);
  const leakageFraction = (params.leakageCoeff / 100) * (L / 100);
  return { R, leakage: leakageFraction };
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

  // Диаметр и α берём с учётом правок во вкладке «Топология» (pipeDiameter /
  // pipeAlpha) — иначе окно показывало старые значения и при «Применить»
  // затирало то, что пользователь только что изменил в свойствах ветви.
  const [diameter, setDiameter]       = useState(
    first.vpDiameter || (first.pipeDiameter ? Math.round(first.pipeDiameter * 1000) : 500),
  );
  const [pipeType, setPipeType]       = useState(first.vpPipeType || "flex_standard");
  const [pipeAlpha, setPipeAlpha]     = useState(first.pipeAlpha ?? first.vpPipeAlpha ?? 0.45);
  const [lengthManual, setLengthManual] = useState(first.vpLengthManual || false);
  const [length, setLength]           = useState(first.vpLengthManual ? first.vpLength : totalLength);
  const [leakage, setLeakage]         = useState(first.vpLeakageCoeff ?? 0.5);
  const [joints, setJoints]           = useState(first.vpJointCount ?? 0);
  const [localXi, setLocalXi]         = useState(first.vpLocalXi ?? 0);
  const [manualR, setManualR]         = useState<boolean>((first.vpManualR ?? 0) > 0);
  const [manualRVal, setManualRVal]   = useState(first.vpManualR ?? 0);
  // Марка рукава из справочника — подставляет паспортные характеристики
  const [brandId, setBrandId]         = useState(first.vpBrandId ?? "");
  // Длина одного звена рукава и требуемый расход в забое участвуют в расчёте
  // доставки воздуха. Раньше их можно было задать только в панели свойств
  // отдельной ветви — при правке всего става это было неудобно.
  const [linkLength, setLinkLength]   = useState(first.vpLinkLength ?? 20);
  const [requiredFlow, setRequiredFlow] = useState(first.vpRequiredFlow ?? 0);

  // Правка готовой нити: все выбранные ветви уже являются ветвями става.
  const editingLine = branches.every(b => b.isVentPipeBranch);

  const brand = getDuctBrand(brandId);
  const brandSize = getDuctSize(brand, diameter);

  // Выбор марки: подставляем паспортные α, утечки и давление.
  const applyBrand = (id: string) => {
    setBrandId(id);
    const b = getDuctBrand(id);
    if (!b) return;
    setPipeAlpha(b.alpha);
    setPipeType("");
    // Если текущий диаметр не выпускается в этой марке — берём первый типоразмер
    const size = getDuctSize(b, diameter) ?? b.sizes[0];
    if (size) {
      setDiameter(size.diameter);
      setLeakage(size.lossPer100m);
    }
  };

  // Смена диаметра: если выбрана марка — подтягиваем её паспортные утечки
  const applyDiameter = (d: number) => {
    setDiameter(d);
    const size = getDuctSize(brand, d);
    if (size) setLeakage(size.lossPer100m);
  };

  // Итоговая длина (авто или ручная)
  const effLength = lengthManual ? length : totalLength;

  // Расчёт (формула R=6.48·α·L/D⁵, как во вкладке «Топология»)
  const calc = calcVentPipeR({
    diameter,
    length: effLength,
    pipeAlpha,
    jointCount: joints,
    leakageCoeff: leakage,
  });

  const R = manualR ? manualRVal : calc.R;

  useEffect(() => {
    if (!lengthManual) setLength(totalLength);
  }, [totalLength, lengthManual]);

  const handleApply = () => {
    const patch: Partial<TopoBranch> = {
      hasVentPipe: true,
      vpDiameter: diameter,
      vpPipeType: pipeType,
      vpPipeAlpha: pipeAlpha,
      vpLengthManual: lengthManual,
      vpLength: lengthManual ? length : totalLength,
      vpLeakageCoeff: leakage,
      vpJointCount: joints,
      vpLocalXi: localXi,
      vpManualR: manualR ? manualRVal : 0,
      vpBrandId: brandId,
      vpWorkPressure: brandSize?.workPressure ?? 0,
      vpLinkLength: linkLength,
      vpRequiredFlow: requiredFlow,
      vpComputedR: R,
      vpComputedFlow: 0,
      vpComputedVelocity: 0,
      vpComputedDeltaP: 0,
      vpComputedLeakage: calc.leakage,
      // Синхронизация с вкладкой «Топология»: та же формула R=6.48·α·L/D⁵.
      // Если R задан вручную — режим "manual", иначе "pipe" с α и диаметром трубы.
      resistanceMode: manualR ? "manual" : "pipe",
      pipeAlpha,
      pipeDiameter: diameter / 1000,
      // Сечение ветви пересчитываем под диаметр рукава, чтобы во вкладке
      // «Топология» площадь и периметр соответствовали выбранной марке.
      shape: "round",
      diameter: diameter / 1000,
      manualSection: false,
      localXi,
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
            {editingLine
              ? `Вентстав — правка целиком (${branches.length} сегм.)`
              : multi
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
              {editingLine ? "Существующий став" : "Маршрут трубопровода"}
            </div>
            {editingLine && (
              <div className="text-[11px] text-blue-800 mb-1">
                Изменения применятся ко всем {branches.length} сегментам става сразу —
                удалять и строить его заново не нужно.
              </div>
            )}
            <div className="text-[12px] text-blue-900">
              {multi
                ? `${branches.length} ветвей · Узлы: ${branches[0].fromId.slice(-4)} → … → ${branches[branches.length - 1].toId.slice(-4)}`
                : `Ветвь: ${first.fromId.slice(-4)} → ${first.toId.slice(-4)}`}
            </div>
            <div className="text-[11px] text-blue-600 mt-0.5">
              Суммарная длина по ветвям: <b>{totalLength.toFixed(1)} м</b>
            </div>
          </div>

          {/* Марка рукава */}
          <div>
            <div className="text-[12px] font-bold text-gray-700 mb-2 flex items-center gap-1">
              <Icon name="BookMarked" size={13} />
              Марка рукава
            </div>
            <select value={brandId} onChange={e => applyBrand(e.target.value)} className={inputCls}>
              <option value="">— без марки (параметры вручную) —</option>
              {VENT_DUCT_BRANDS.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.antistatic ? " (антистатический)" : ""}
                </option>
              ))}
            </select>

            {brand && (
              <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-700 bg-gray-50 border-b border-gray-200">
                  Характеристики · {brand.name}
                </div>
                <table className="w-full text-[11px]">
                  <tbody>
                    {[
                      ["Диаметр трубы", `${(brandSize ?? brand.sizes[0]).diameter} мм`],
                      ["Плотность мембраны", `${brand.density} ± ${brand.densityTol}% г/м²`],
                      ["Адгезия сварного шва, не менее", `${brand.seamAdhesion} Н`],
                      ["Разрыв мембраны: уток / основа, не менее", `${brand.tensileWeft} / ${brand.tensileWarp} Н`],
                      ["Раздирание: уток / основа, не менее", `${brand.tearWeft} / ${brand.tearWarp} Н`],
                      ["Воздухопроницаемость, не более", `${brand.airPermeability} мм²/м²`],
                      ["Потери на 100 м вентстава, не более", `${(brandSize ?? brand.sizes[0]).lossPer100m} %`],
                      ["Температура эксплуатации", `${brand.tempMin} … +${brand.tempMax} °C`],
                      ["Эл. стат. сопротивление, не более", `${formatStaticResistance(brand.staticResistance)} Ом`],
                      ["Кислородный индекс, не менее", `${brand.oxygenIndex} %`],
                      ["Рабочее давление (нагнетание), не более",
                        `${(brandSize ?? brand.sizes[0]).workPressure} Па`
                        + ((brandSize ?? brand.sizes[0]).workPressureEstimated ? " (оценка)" : "")],
                    ].map(([k, v], i) => (
                      <tr key={k} style={{ background: i % 2 ? "#fafafa" : "white" }}>
                        <td className="px-3 py-1 text-gray-600 align-top">{k}</td>
                        <td className="px-3 py-1 text-right font-semibold text-gray-900 whitespace-nowrap">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-1.5 text-[10px] text-gray-500 border-t border-gray-200 bg-gray-50">
                  Паспортные утечки и рабочее давление подставлены в расчёт автоматически.
                  {(brandSize ?? brand.sizes[0]).workPressureEstimated && (
                    <> Изготовитель приводит предельное давление только для ⌀1000 и
                    ⌀1200 мм. Для этого диаметра оно оценено расчётом в запас —
                    уточните у изготовителя, если давление в ставе близко к пределу.</>
                  )}
                </div>
              </div>
            )}
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
                {/* Если выбрана марка — предлагаем только её типоразмеры */}
                <select value={diameter} onChange={e => applyDiameter(Number(e.target.value))}
                  className={inputCls}>
                  {(brand
                    ? brand.sizes.map(s => ({ d: s.diameter, label: `Ø ${s.diameter} мм` }))
                    : VENT_PIPE_DIAMETERS
                  ).map(d => (
                    <option key={d.d} value={d.d}>{d.label}</option>
                  ))}
                  <option value={diameter} hidden={
                    brand
                      ? brand.sizes.some(s => s.diameter === diameter)
                      : VENT_PIPE_DIAMETERS.some(d => d.d === diameter)
                  }>
                    Ø {diameter} мм (задан)
                  </option>
                </select>
                {!brand && (
                  <input type="number" min={100} max={2000} step={50} value={diameter}
                    onChange={e => applyDiameter(Number(e.target.value))}
                    className={`${inputCls} mt-1`} placeholder="Другой диаметр, мм" />
                )}
              </div>
              <div>
                <label className={labelCls}>Тип трубопровода</label>
                <select
                  value={PIPE_ALPHA_TYPES.find(p => p.id === pipeType) ? pipeType : ""}
                  onChange={e => {
                    const p = PIPE_ALPHA_TYPES.find(x => x.id === e.target.value);
                    if (p) { setPipeType(p.id); setPipeAlpha(p.alpha); }
                  }}
                  className={inputCls}>
                  <option value="">— задан вручную —</option>
                  {PIPE_ALPHA_TYPES.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.alphaMin}–{p.alphaMax})
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-gray-500 mt-1">
                  Коэф. α: {pipeAlpha} ×10⁻⁴ Н·с²/м⁴
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
                ξ стыка ≈ 0.05 за шт. На весь став
              </div>
            </div>
          </div>

          {/* Звено рукава и требуемый расход — участвуют в расчёте доставки */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Длина звена рукава, м</label>
              <input type="number" min={1} step={1} value={linkLength}
                onChange={e => setLinkLength(Number(e.target.value))}
                className={inputCls} />
              <div className="text-[10px] text-gray-500 mt-0.5">
                Обычно 5–20 м. Задаёт частоту стыков
              </div>
            </div>
            <div>
              <label className={labelCls}>Требуется в забое, м³/с</label>
              <input type="number" min={0} step={0.1} value={requiredFlow}
                onChange={e => setRequiredFlow(Number(e.target.value))}
                className={inputCls} placeholder="0 — по расчёту потребности" />
              <div className="text-[10px] text-gray-500 mt-0.5">
                0 — берётся из расчёта потребности воздуха
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

          {/* Коэффициент α трубопровода (формула R=6.48·α·L/D⁵) */}
          <div>
            <label className={labelCls}>Коэф. α, ×10⁻⁴ Н·с²/м⁴</label>
            <input type="number" min={0} step={0.05} value={pipeAlpha}
              onChange={e => { setPipeAlpha(Number(e.target.value)); setPipeType(""); }}
              className={inputCls} placeholder="α ×10⁻⁴" />
            <div className="text-[10px] text-gray-500 mt-0.5">
              R = 6.48·α·L/D⁵ (как во вкладке «Топология» → «Способ задания R»)
            </div>
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
              <div className="text-gray-700">Коэф. α:</div>
              <div className="font-semibold text-gray-900">{pipeAlpha} ×10⁻⁴</div>
              <div className="text-gray-700 font-bold">R трубы (6.48·α·L/D⁵):</div>
              <div className="font-bold text-green-800">{R.toFixed(4)} кМюрг</div>
              <div className="text-gray-500">Утечки на маршруте:</div>
              <div className="font-semibold text-orange-700">
                {(calc.leakage * 100).toFixed(1)}% от расхода
              </div>
            </div>
            {brandSize && (() => {
              // Ориентировочное давление в ставе: ΔP = R·Q², где Q — паспортная
              // подача ВМП неизвестна, поэтому показываем сам предел и
              // напоминаем сверить его с напором вентилятора.
              return (
                <div className="mt-2 pt-2 border-t border-green-200 text-[11px] flex justify-between">
                  <span className="text-gray-700">Предел по паспорту рукава:</span>
                  <span className="font-semibold text-gray-900">{brandSize.workPressure} Па</span>
                </div>
              );
            })()}
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
            {editingLine ? "Удалить весь став" : "Удалить трубу"}
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