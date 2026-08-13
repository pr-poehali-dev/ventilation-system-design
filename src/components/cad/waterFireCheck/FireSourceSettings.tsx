// ─────────────────────────────────────────────────────────────────────────────
// FireSourceSettings.tsx — блок выбора очага пожара и параметров тушения:
// длина рукава, число рукавов в линии, интенсивность подачи, а также
// параметры хода отделения ВГСЧ (база, развёртывание, время ИДА).
//
// Вынесено из WaterFireCheckDialog.tsx БЕЗ изменений разметки и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";

interface FireSourceSettingsProps {
  fireBranches: TopoBranch[];
  activeFireBranch: TopoBranch | null;
  setFireBranchId: (v: string) => void;
  nodes: TopoNode[];
  hoseLength: string;
  setHoseLength: (v: string) => void;
  maxHoses: string;
  setMaxHoses: (v: string) => void;
  intensity: string;
  setIntensity: (v: string) => void;
  baseNodeId: string;
  setBaseNodeId: (v: string) => void;
  hoseDeployTime: string;
  setHoseDeployTime: (v: string) => void;
  idaWorkTime: string;
  setIdaWorkTime: (v: string) => void;
  numInput: (value: string, set: (v: string) => void) => React.ReactNode;
}

export default function FireSourceSettings({
  fireBranches, activeFireBranch, setFireBranchId, nodes,
  hoseLength, setHoseLength, maxHoses, setMaxHoses, intensity, setIntensity,
  baseNodeId, setBaseNodeId, hoseDeployTime, setHoseDeployTime,
  idaWorkTime, setIdaWorkTime, numInput,
}: FireSourceSettingsProps) {
  return (
<div className="px-4 pt-2.5 pb-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
  {fireBranches.length === 0 ? (
    <div className="text-[11px] flex items-center gap-2 py-1"
      style={{ color: "#8a5a00" }}>
      <Icon name="TriangleAlert" size={14} />
      В схеме не задан очаг пожара. Установите очаг на вкладке «Аварии».
    </div>
  ) : (
    <>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[12px] text-gray-600">Очаг пожара</span>
        <select value={activeFireBranch?.id ?? ""}
          onChange={e => setFireBranchId(e.target.value)}
          className="text-[12px] border border-gray-300 rounded px-2 py-1 flex-1">
          {fireBranches.map(b => (
            <option key={b.id} value={b.id}>
              {b.type || `Ветвь ${b.fromId.slice(-4)}–${b.toId.slice(-4)}`}
              {b.fireHeatRelease > 0 ? ` — ${b.fireHeatRelease.toFixed(2)} МВт` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-600 flex-1">Длина рукава, м</span>
          {numInput(hoseLength, setHoseLength)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-600 flex-1">Рукавов в линии</span>
          {numInput(maxHoses, setMaxHoses)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-600 flex-1">Интенсивность, л/(с·м²)</span>
          {numInput(intensity, setIntensity)}
        </div>
      </div>

      {/* ── Ход отделения ВГСЧ ── */}
      <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px dashed #dde3ee" }}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-[12px] text-gray-600">База ВГСЧ</span>
          <select value={baseNodeId} onChange={e => setBaseNodeId(e.target.value)}
            className="text-[12px] border border-gray-300 rounded px-2 py-1 flex-1">
            <option value="">— не учитывать ход отделения —</option>
            {nodes.map(n => (
              <option key={n.id} value={n.id}>
                {n.number ? `№ ${n.number}` : n.id.slice(-4)}
                {n.name ? ` — ${n.name}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-600 flex-1">Развёртывание рукава, мин</span>
            {numInput(hoseDeployTime, setHoseDeployTime)}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-600 flex-1">Время ИДА, мин</span>
            {numInput(idaWorkTime, setIdaWorkTime)}
          </div>
        </div>
        <div className="text-[10px] text-gray-400 leading-snug pt-1.5">
          Укажите базу ВГСЧ — программа посчитает время хода отделения до каждого крана
          с учётом задымления и уклонов, и определит, откуда вода пойдёт раньше всего.
        </div>
      </div>
    </>
  )}
</div>
  );
}
