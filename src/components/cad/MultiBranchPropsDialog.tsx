import { useState } from "react";
import Icon from "@/components/ui/icon";
import { type TopoBranch } from "@/lib/topology";

interface Props {
  branches: TopoBranch[];
  onClose: () => void;
  onApply: (patch: Partial<TopoBranch>) => void;
}

export default function MultiBranchPropsDialog({ branches, onClose, onApply }: Props) {
  const count = branches.length;

  // Определяем «смешанные» значения (если у ветвей разные — показываем «разные»)
  const mixed = <T,>(vals: T[]): T | "mixed" =>
    vals.every(v => v === vals[0]) ? vals[0] : "mixed";

  const allCapital  = mixed(branches.map(b => b.capital));
  const allDesigned = mixed(branches.map(b => b.designed));
  const allType     = mixed(branches.map(b => b.type));
  const allLayer    = mixed(branches.map(b => b.layer));
  const allLineWidth = mixed(branches.map(b => b.lineWidth));
  const allAlpha    = mixed(branches.map(b => b.alphaCoef));
  const allLocalXi  = mixed(branches.map(b => b.localXi));
  const allVMax     = mixed(branches.map(b => b.vMax));

  const [capital,   setCapital]   = useState<boolean | "mixed">(allCapital);
  const [designed,  setDesigned]  = useState<boolean | "mixed">(allDesigned);
  const [type,      setType]      = useState<string | "mixed">(allType);
  const [layer,     setLayer]     = useState<string | "mixed">(allLayer);
  const [lineWidth, setLineWidth] = useState<number | "mixed">(allLineWidth);
  const [alpha,     setAlpha]     = useState<number | "mixed">(allAlpha);
  const [localXi,   setLocalXi]   = useState<number | "mixed">(allLocalXi);
  const [vMax,      setVMax]      = useState<number | "mixed">(allVMax);

  // Какие поля пользователь хочет применить (чекбоксы)
  const [applyCapital,   setApplyCapital]   = useState(false);
  const [applyDesigned,  setApplyDesigned]  = useState(false);
  const [applyType,      setApplyType]      = useState(false);
  const [applyLayer,     setApplyLayer]     = useState(false);
  const [applyLineWidth, setApplyLineWidth] = useState(false);
  const [applyAlpha,     setApplyAlpha]     = useState(false);
  const [applyLocalXi,   setApplyLocalXi]   = useState(false);
  const [applyVMax,      setApplyVMax]      = useState(false);

  const inputCls = "border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-400 w-full";

  const handleApply = () => {
    const patch: Partial<TopoBranch> = {};
    if (applyCapital   && capital   !== "mixed") patch.capital   = capital as boolean;
    if (applyDesigned  && designed  !== "mixed") patch.designed  = designed as boolean;
    if (applyType      && type      !== "mixed") patch.type      = type as string;
    if (applyLayer     && layer     !== "mixed") patch.layer     = layer as string;
    if (applyLineWidth && lineWidth !== "mixed") patch.lineWidth = lineWidth as number;
    if (applyAlpha     && alpha     !== "mixed") patch.alphaCoef = alpha as number;
    if (applyLocalXi   && localXi   !== "mixed") patch.localXi   = localXi as number;
    if (applyVMax      && vMax      !== "mixed") patch.vMax      = vMax as number;
    if (Object.keys(patch).length > 0) onApply(patch);
    onClose();
  };

  const totalLen = branches.reduce((s, b) => s + (b.length || 0), 0);
  const avgRes   = branches.reduce((s, b) => s + (b.resistance || 0), 0) / count;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ background: "#1a3a6b" }}>
          <div className="flex items-center gap-2 text-white font-bold text-[14px]">
            <Icon name="Layers" size={16} />
            Свойства выбранных ветвей ({count} шт.)
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Сводка */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[11px]">
            <div className="font-semibold text-blue-700 mb-1 flex items-center gap-1">
              <Icon name="Info" size={12} /> Выбрано {count} ветвей
            </div>
            <div className="grid grid-cols-2 gap-1 text-gray-600">
              <span>Суммарная длина:</span><span className="font-medium">{totalLen.toFixed(1)} м</span>
              <span>Среднее R:</span><span className="font-medium">{avgRes.toFixed(4)} Н·с²/м⁸</span>
            </div>
            <div className="text-[10px] text-blue-500 mt-1">
              Отметьте поля которые хотите изменить и нажмите «Применить»
            </div>
          </div>

          {/* Тип и слой */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 mb-1">
                <input type="checkbox" checked={applyType} onChange={e => setApplyType(e.target.checked)} className="accent-blue-600" />
                Тип выработки
              </label>
              <input className={inputCls} value={type === "mixed" ? "" : (type as string)}
                placeholder={type === "mixed" ? "(разные)" : ""}
                onChange={e => { setType(e.target.value); setApplyType(true); }} />
            </div>
            <div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 mb-1">
                <input type="checkbox" checked={applyLayer} onChange={e => setApplyLayer(e.target.checked)} className="accent-blue-600" />
                Слой
              </label>
              <input className={inputCls} value={layer === "mixed" ? "" : (layer as string)}
                placeholder={layer === "mixed" ? "(разные)" : ""}
                onChange={e => { setLayer(e.target.value); setApplyLayer(true); }} />
            </div>
          </div>

          {/* Флаги */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 cursor-pointer p-2 border rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={applyCapital} onChange={e => setApplyCapital(e.target.checked)} className="accent-blue-600" />
              <span className="text-[12px] text-gray-700">Капитальная</span>
              {applyCapital && (
                <input type="checkbox"
                  checked={capital === true}
                  ref={el => { if (el) el.indeterminate = capital === "mixed"; }}
                  onChange={e => setCapital(e.target.checked)}
                  className="ml-auto accent-blue-600" />
              )}
            </label>
            <label className="flex items-center gap-2 cursor-pointer p-2 border rounded-lg hover:bg-gray-50">
              <input type="checkbox" checked={applyDesigned} onChange={e => setApplyDesigned(e.target.checked)} className="accent-blue-600" />
              <span className="text-[12px] text-gray-700">Проектируемая</span>
              {applyDesigned && (
                <input type="checkbox"
                  checked={designed === true}
                  ref={el => { if (el) el.indeterminate = designed === "mixed"; }}
                  onChange={e => setDesigned(e.target.checked)}
                  className="ml-auto accent-blue-600" />
              )}
            </label>
          </div>

          {/* Аэродинамика */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 mb-1">
                <input type="checkbox" checked={applyAlpha} onChange={e => setApplyAlpha(e.target.checked)} className="accent-blue-600" />
                α коэф., ×10⁻⁴ Н·с²/м⁴
              </label>
              <input type="number" className={inputCls} min={0} step={0.1}
                value={alpha === "mixed" ? "" : (alpha as number)}
                placeholder={alpha === "mixed" ? "(разные)" : ""}
                onChange={e => { setAlpha(Number(e.target.value)); setApplyAlpha(true); }} />
            </div>
            <div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 mb-1">
                <input type="checkbox" checked={applyLocalXi} onChange={e => setApplyLocalXi(e.target.checked)} className="accent-blue-600" />
                Σξ местных сопр.
              </label>
              <input type="number" className={inputCls} min={0} step={0.1}
                value={localXi === "mixed" ? "" : (localXi as number)}
                placeholder={localXi === "mixed" ? "(разные)" : ""}
                onChange={e => { setLocalXi(Number(e.target.value)); setApplyLocalXi(true); }} />
            </div>
          </div>

          {/* Отображение */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 mb-1">
                <input type="checkbox" checked={applyLineWidth} onChange={e => setApplyLineWidth(e.target.checked)} className="accent-blue-600" />
                Толщина линии, px
              </label>
              <input type="number" className={inputCls} min={1} max={20} step={1}
                value={lineWidth === "mixed" ? "" : (lineWidth as number)}
                placeholder={lineWidth === "mixed" ? "(разные)" : ""}
                onChange={e => { setLineWidth(Number(e.target.value)); setApplyLineWidth(true); }} />
            </div>
            <div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-gray-600 mb-1">
                <input type="checkbox" checked={applyVMax} onChange={e => setApplyVMax(e.target.checked)} className="accent-blue-600" />
                V макс., м/с
              </label>
              <input type="number" className={inputCls} min={0} step={0.5}
                value={vMax === "mixed" ? "" : (vMax as number)}
                placeholder={vMax === "mixed" ? "(разные)" : ""}
                onChange={e => { setVMax(Number(e.target.value)); setApplyVMax(true); }} />
            </div>
          </div>

        </div>

        {/* Кнопки */}
        <div className="flex gap-2 px-5 py-3 border-t border-gray-100 flex-shrink-0">
          <div className="text-[11px] text-gray-400 flex items-center">
            {[applyCapital, applyDesigned, applyType, applyLayer, applyLineWidth, applyAlpha, applyLocalXi, applyVMax].filter(Boolean).length} полей выбрано
          </div>
          <div className="flex-1" />
          <button onClick={onClose}
            className="px-4 py-1.5 rounded text-[12px] border border-gray-300 text-gray-600 hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={handleApply}
            className="px-4 py-1.5 rounded text-[12px] font-semibold text-white"
            style={{ background: "#1a3a6b" }}>
            Применить к {count} ветвям
          </button>
        </div>
      </div>
    </div>
  );
}
