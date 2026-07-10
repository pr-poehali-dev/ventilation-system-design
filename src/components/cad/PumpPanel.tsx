/**
 * Панель свойств насоса (УО «Насос» на трубе водопровода).
 * Аналог функции вентилятора: выбор модели из библиотеки PUMP_CATALOG,
 * характеристики (напор/подача/обороты/КПД), график напорной кривой Q–H,
 * добавление пользовательских моделей.
 */

import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import {
  PUMP_CATALOG, PUMP_TYPE_NAMES, type PumpModel, type PumpType,
  pumpHead, pumpEfficiency, pumpPower, getPumpById,
} from "@/lib/pumps";
import PumpChart from "@/components/cad/PumpChart";
import type { SchemaSymbol } from "@/pages/cad/cadTypes";
import type { WaterBranchResult } from "@/lib/waterHydraulics";

interface Props {
  sym: SchemaSymbol;
  /** Пользовательские модели насосов (сохраняются в проекте) */
  userPumps: PumpModel[];
  onUpdate: (patch: Partial<SchemaSymbol>) => void;
  onAddUserPump: (pump: PumpModel) => void;
  /** Результат гидравлического расчёта по ветви, на которой стоит насос */
  waterBranchResult?: WaterBranchResult;
}

const inputCls = "flex-1 px-1 py-0.5 text-[11px] text-right";
const inputStyle: React.CSSProperties = { border: "1px solid #c8c8c8", outline: "none", background: "white", borderRadius: 2 };

export default function PumpPanel({ sym, userPumps, onUpdate, onAddUserPump, waterBranchResult }: Props) {
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [filterType, setFilterType] = useState<PumpType | "all">("all");

  const allPumps = useMemo(() => [...PUMP_CATALOG, ...userPumps], [userPumps]);
  const currentModel = getPumpById(sym.pumpModelId) ?? userPumps.find((p) => p.id === sym.pumpModelId);

  // Применить модель из библиотеки к символу
  const applyModel = (pump: PumpModel) => {
    onUpdate({
      pumpModelId: pump.id,
      pumpName: `${pump.brand} ${pump.model}`,
      pumpHead: Math.round(pumpHead(pump, pump.Qopt) * 10) / 10,
      pumpFlow: pump.Qopt,
      pumpRpm: pump.rpm,
      pumpEfficiency: Math.round(pumpEfficiency(pump, pump.Qopt) * 100) / 100,
      pumpPower: Math.round(pumpPower(pump, pump.Qopt) * 100) / 100,
    });
    setShowLibrary(false);
  };

  const filtered = filterType === "all" ? allPumps : allPumps.filter((p) => p.type === filterType);

  return (
    <div className="mt-2">
      <div className="font-semibold text-[11px] text-gray-600 pb-1 border-b border-gray-200 mb-2 uppercase tracking-wide flex items-center gap-1">
        <Icon name="Waves" size={12} /> Насос
      </div>

      {/* Марка / выбранная модель */}
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">Марка</span>
        <input type="text" value={sym.pumpName ?? ""}
          onChange={(e) => onUpdate({ pumpName: e.target.value })}
          placeholder="Насос" className="flex-1 px-1 py-0.5 text-[11px]" style={inputStyle} />
      </div>

      {/* Кнопки библиотеки */}
      <div className="flex gap-1 mb-2">
        <button onClick={() => setShowLibrary((v) => !v)}
          className="flex-1 flex items-center justify-center gap-1 py-1 rounded text-[10px] font-medium border"
          style={{ background: showLibrary ? "#fef2f2" : "white", color: "#dc2626", borderColor: "#fca5a5" }}>
          <Icon name="Library" size={11} /> Библиотека насосов
        </button>
      </div>

      {/* Список моделей библиотеки */}
      {showLibrary && (
        <div className="mb-2 border border-gray-200 rounded overflow-hidden">
          {/* Фильтр по типу */}
          <div className="flex flex-wrap gap-1 p-1.5 bg-gray-50 border-b border-gray-200">
            <button onClick={() => setFilterType("all")}
              className={`text-[9px] px-1.5 py-0.5 rounded ${filterType === "all" ? "bg-red-600 text-white" : "bg-white text-gray-600 border border-gray-300"}`}>
              Все
            </button>
            {(Object.keys(PUMP_TYPE_NAMES) as PumpType[]).map((t) => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`text-[9px] px-1.5 py-0.5 rounded ${filterType === t ? "bg-red-600 text-white" : "bg-white text-gray-600 border border-gray-300"}`}>
                {PUMP_TYPE_NAMES[t]}
              </button>
            ))}
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.map((pump) => {
              const isCur = pump.id === sym.pumpModelId;
              return (
                <button key={pump.id} onClick={() => applyModel(pump)}
                  className={`w-full text-left px-2 py-1 border-b border-gray-100 hover:bg-red-50 ${isCur ? "bg-red-50" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-gray-800">{pump.brand} {pump.model}</span>
                    {isCur && <Icon name="Check" size={11} className="text-red-600" />}
                  </div>
                  <div className="text-[9px] text-gray-400">
                    Q={pump.Qopt} м³/ч · H={Math.round(pumpHead(pump, pump.Qopt))} м · {pump.power} кВт · {pump.rpm} об/мин
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="text-[10px] text-gray-400 text-center py-3">Нет моделей</div>
            )}
          </div>
          {/* Добавить свою модель */}
          <div className="p-1.5 border-t border-gray-200 bg-gray-50">
            <button onClick={() => setShowAddForm((v) => !v)}
              className="w-full flex items-center justify-center gap-1 py-1 rounded text-[10px] text-gray-700 border border-gray-300 hover:bg-white">
              <Icon name="Plus" size={11} /> Добавить свою модель
            </button>
          </div>
        </div>
      )}

      {/* Форма добавления пользовательской модели */}
      {showAddForm && (
        <AddPumpForm onAdd={(p) => { onAddUserPump(p); applyModel(p); setShowAddForm(false); }} onCancel={() => setShowAddForm(false)} />
      )}

      {/* Характеристики */}
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">Напор</span>
        <input type="number" min={0} step={1} value={sym.pumpHead ?? ""}
          onChange={(e) => onUpdate({ pumpHead: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder="0" className={inputCls} style={inputStyle} />
        <span className="text-gray-400 flex-shrink-0 w-8">м</span>
      </div>
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">Подача</span>
        <input type="number" min={0} step={1} value={sym.pumpFlow ?? ""}
          onChange={(e) => onUpdate({ pumpFlow: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder="0" className={inputCls} style={inputStyle} />
        <span className="text-gray-400 flex-shrink-0 w-8">м³/ч</span>
      </div>
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">Обороты</span>
        <input type="number" min={0} step={10} value={sym.pumpRpm ?? ""}
          onChange={(e) => onUpdate({ pumpRpm: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder="0" className={inputCls} style={inputStyle} />
        <span className="text-gray-400 flex-shrink-0 w-8">об/м</span>
      </div>
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">КПД</span>
        <input type="number" min={0} max={100} step={1}
          value={sym.pumpEfficiency != null ? Math.round(sym.pumpEfficiency * 100) : ""}
          onChange={(e) => onUpdate({ pumpEfficiency: e.target.value === "" ? undefined : Number(e.target.value) / 100 })}
          placeholder="0" className={inputCls} style={inputStyle} />
        <span className="text-gray-400 flex-shrink-0 w-8">%</span>
      </div>
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">Мощность</span>
        <input type="number" min={0} step={0.1} value={sym.pumpPower ?? ""}
          onChange={(e) => onUpdate({ pumpPower: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder="0" className={inputCls} style={inputStyle} />
        <span className="text-gray-400 flex-shrink-0 w-8">кВт</span>
      </div>
      <div className="flex items-center gap-1 mb-2">
        <span className="text-gray-500 w-16 flex-shrink-0">Параллельно</span>
        <input type="number" min={1} max={10} step={1} value={sym.pumpParallel ?? 1}
          onChange={(e) => onUpdate({ pumpParallel: Math.max(1, Number(e.target.value) || 1) })}
          className={inputCls} style={inputStyle} />
        <span className="text-gray-400 flex-shrink-0 w-8">шт</span>
      </div>

      {/* Направление стрелки (как у вентилятора) */}
      <div className="flex items-center gap-1 mb-1.5">
        <span className="text-gray-500 w-16 flex-shrink-0">Направление</span>
        <select value={sym.airDirection ?? "forward"}
          onChange={(e) => onUpdate({ airDirection: e.target.value as "forward" | "reverse" })}
          className="flex-1 px-1 py-0.5 text-[11px]" style={inputStyle}>
          <option value="forward">По ветви (прямое)</option>
          <option value="reverse">Против ветви (реверс)</option>
        </select>
      </div>
      <label className="flex items-center gap-1.5 mb-2 cursor-pointer text-gray-600">
        <input type="checkbox" checked={sym.showFanArrow ?? true}
          onChange={(e) => onUpdate({ showFanArrow: e.target.checked })}
          style={{ accentColor: "#dc2626" }} />
        Показывать стрелку направления
      </label>

      {/* График характеристики (если выбрана модель из библиотеки) */}
      {currentModel && (
        <div className="mb-2">
          <div className="text-[10px] text-gray-500 mb-1">Напорная характеристика Q–H</div>
          <PumpChart pump={currentModel} workQ={sym.pumpFlow} />
          <div className="text-[9px] text-gray-400 mt-1">
            <span className="inline-block w-3 h-0.5 align-middle" style={{ background: "#dc2626" }} /> напор ·
            <span className="inline-block w-3 h-0.5 align-middle ml-1" style={{ background: "#9ca3af", borderTop: "1px dashed #9ca3af" }} /> КПД
          </div>
        </div>
      )}

      {/* Результат гидравлического расчёта водопровода на ветви насоса */}
      {waterBranchResult && (
        <div className="mt-2 rounded p-2" style={{ background: waterBranchResult.pumpActive ? "#f0fdf4" : "#f9fafb", border: "1px solid #e5e7eb" }}>
          <div className="text-[10px] font-medium text-gray-600 mb-1 flex items-center gap-1">
            <Icon name="Activity" size={11} /> Результат расчёта
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mb-0.5">
            <span className="text-gray-400">Насос</span>
            <span className={waterBranchResult.pumpActive ? "text-green-700 font-medium" : "text-gray-400"}>
              {waterBranchResult.pumpActive ? "● Повышает напор" : "○ Не активен"}
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mb-0.5">
            <span className="text-gray-400">Прибавка напора</span>
            <span className="font-medium text-gray-800">
              {(waterBranchResult.pumpHeadM ?? 0).toFixed(1)} м · +{(waterBranchResult.pumpDeltaP ?? 0).toFixed(3)} МПа
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-600 mb-0.5">
            <span className="text-gray-400">Расход в трубе</span>
            <span className="font-medium text-gray-800">{waterBranchResult.flow.toFixed(1)} м³/ч</span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-600">
            <span className="text-gray-400">Скорость воды</span>
            <span className="font-medium text-gray-800">{waterBranchResult.velocity.toFixed(2)} м/с</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Форма добавления пользовательской модели насоса ──────────────────────────
function AddPumpForm({ onAdd, onCancel }: { onAdd: (p: PumpModel) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PumpType>("sectional");
  const [H0, setH0] = useState(200);
  const [Qopt, setQopt] = useState(100);
  const [Qmax, setQmax] = useState(160);
  const [rpm, setRpm] = useState(1480);
  const [power, setPower] = useState(75);
  const [eta, setEta] = useState(70);

  const submit = () => {
    if (!name.trim()) return;
    // b подбираем так, чтобы напор падал до ~0.6·H0 при Qmax; a=0
    const b = -(0.4 * H0) / (Qmax * Qmax);
    const pump: PumpModel = {
      id: `user_pump_${Date.now()}`,
      brand: "Пользов.", model: name.trim(), type,
      H0, a: 0, b,
      Qmin: Math.round(Qopt * 0.5), Qmax, Qopt,
      etaMax: eta / 100,
      power, rpm, weight: 0,
      notes: "Пользовательская модель",
    };
    onAdd(pump);
  };

  const row = (label: string, val: number, set: (v: number) => void, unit: string, step = 1) => (
    <div className="flex items-center gap-1 mb-1">
      <span className="text-gray-500 w-16 flex-shrink-0 text-[10px]">{label}</span>
      <input type="number" step={step} value={val} onChange={(e) => set(Number(e.target.value) || 0)}
        className="flex-1 px-1 py-0.5 text-[10px] text-right" style={inputStyle} />
      <span className="text-gray-400 flex-shrink-0 w-8 text-[10px]">{unit}</span>
    </div>
  );

  return (
    <div className="mb-2 border border-red-200 rounded p-2 bg-red-50/40">
      <div className="text-[10px] font-medium text-gray-700 mb-1.5">Новая модель насоса</div>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-gray-500 w-16 flex-shrink-0 text-[10px]">Название</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ЦНС ..."
          className="flex-1 px-1 py-0.5 text-[10px]" style={inputStyle} />
      </div>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-gray-500 w-16 flex-shrink-0 text-[10px]">Тип</span>
        <select value={type} onChange={(e) => setType(e.target.value as PumpType)}
          className="flex-1 px-1 py-0.5 text-[10px]" style={inputStyle}>
          {(Object.keys(PUMP_TYPE_NAMES) as PumpType[]).map((t) => (
            <option key={t} value={t}>{PUMP_TYPE_NAMES[t]}</option>
          ))}
        </select>
      </div>
      {row("Напор H₀", H0, setH0, "м")}
      {row("Подача опт", Qopt, setQopt, "м³/ч")}
      {row("Подача макс", Qmax, setQmax, "м³/ч")}
      {row("Обороты", rpm, setRpm, "об/м", 10)}
      {row("Мощность", power, setPower, "кВт", 0.5)}
      {row("КПД", eta, setEta, "%")}
      <div className="flex gap-1 mt-1.5">
        <button onClick={submit}
          className="flex-1 py-1 rounded text-[10px] font-medium text-white" style={{ background: "#dc2626" }}>
          Добавить
        </button>
        <button onClick={onCancel}
          className="flex-1 py-1 rounded text-[10px] font-medium border border-gray-300 text-gray-600 bg-white">
          Отмена
        </button>
      </div>
    </div>
  );
}