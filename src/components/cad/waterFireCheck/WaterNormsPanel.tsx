// ─────────────────────────────────────────────────────────────────────────────
// WaterNormsPanel.tsx — блок нормативных требований к пожарно-оросительному
// трубопроводу: пределы напора, минимальный расход, время работы, число
// одновременно работающих стволов и предельная скорость воды.
//
// Вынесено из WaterFireCheckDialog.tsx БЕЗ изменений разметки и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";

interface WaterNormsPanelProps {
  minPressure: string;
  setMinPressure: (v: string) => void;
  maxPressure: string;
  setMaxPressure: (v: string) => void;
  minFlow: string;
  setMinFlow: (v: string) => void;
  minDuration: string;
  setMinDuration: (v: string) => void;
  simultaneous: string;
  setSimultaneous: (v: string) => void;
  maxVelocity: string;
  setMaxVelocity: (v: string) => void;
  numInput: (value: string, set: (v: string) => void) => React.ReactNode;
}

export default function WaterNormsPanel({
  minPressure, setMinPressure, maxPressure, setMaxPressure,
  minFlow, setMinFlow, minDuration, setMinDuration,
  simultaneous, setSimultaneous, maxVelocity, setMaxVelocity, numInput,
}: WaterNormsPanelProps) {
  return (
<div className="px-4 pt-3 pb-2.5" style={{ borderBottom: "1px solid #e0e4ee" }}>
  <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
    Нормативные требования
  </div>
  <div className="grid grid-cols-3 gap-x-6 gap-y-2">
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-gray-600 flex-1">Напор мин., МПа</span>
      {numInput(minPressure, setMinPressure)}
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-gray-600 flex-1">Напор макс., МПа</span>
      {numInput(maxPressure, setMaxPressure)}
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-gray-600 flex-1">Расход мин., м³/ч</span>
      {numInput(minFlow, setMinFlow)}
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-gray-600 flex-1">Время работы, мин</span>
      {numInput(minDuration, setMinDuration)}
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-gray-600 flex-1">Стволов одновременно</span>
      {numInput(simultaneous, setSimultaneous)}
    </div>
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-gray-600 flex-1">Скорость макс., м/с</span>
      {numInput(maxVelocity, setMaxVelocity)}
    </div>
  </div>
  <div className="text-[10px] text-gray-400 leading-snug pt-2">
    Каждый пожарный кран проверяется отдельным гидравлическим расчётом: открывается
    только он и ближайшие к нему краны по числу одновременно работающих стволов.
  </div>
</div>
  );
}
