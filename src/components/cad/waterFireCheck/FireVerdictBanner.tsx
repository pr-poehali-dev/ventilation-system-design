// ─────────────────────────────────────────────────────────────────────────────
// FireVerdictBanner.tsx — итоговый вердикт по очагу пожара: сколько кранов
// дотягивается рукавами, суммарная подача против требуемой, запас воды и
// расчёт, откуда вода пойдёт раньше всего с учётом хода отделения ВГСЧ.
//
// Вынесено из WaterFireCheckDialog.tsx БЕЗ изменений разметки и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import Icon from "@/components/ui/icon";

interface FireVerdictBannerProps {
  fireResult: {
    sufficient: boolean;
    verdict: string;
    reaching: unknown[];
    hydrants: unknown[];
    totalFlow: number;
    requiredFlow: number;
    duration: number;
    rescueComputed?: boolean;
    fastestHydrant?: { nodeNumber: string | number; rescueTime?: number | null; hoseCount: number } | null;
    waterStartTime?: number | null;
  };
}

export default function FireVerdictBanner({ fireResult }: FireVerdictBannerProps) {
  return (
<div className="px-4 py-2.5 flex items-center gap-3"
  style={{
    background: fireResult.sufficient ? "#f0fdf4" : "#fff1f1",
    borderBottom: "1px solid #e0e4ee",
  }}>
  <Icon name={fireResult.sufficient ? "ShieldCheck" : "ShieldAlert"} size={18}
    style={{ color: fireResult.sufficient ? "#15803d" : "#dc2626" }} />
  <div className="flex-1">
    <div className="text-[12px] font-semibold"
      style={{ color: fireResult.sufficient ? "#15803d" : "#b91c1c" }}>
      {fireResult.verdict}
    </div>
    <div className="text-[10px] text-gray-500 pt-0.5">
      Дотягиваются рукавами: {fireResult.reaching.length} из {fireResult.hydrants.length} ·
      {" "}подача {fireResult.totalFlow} м³/ч при требуемых {fireResult.requiredFlow} м³/ч
      {fireResult.duration > 0 && ` · воды на ${Math.round(fireResult.duration)} мин`}
    </div>
    {/* Откуда вода пойдёт раньше всего — это НЕ всегда ближайший кран */}
    {fireResult.rescueComputed && fireResult.fastestHydrant && (
      <div className="text-[10px] pt-1" style={{ color: "#1d4ed8" }}>
        Вода быстрее всего от крана <b>№ {fireResult.fastestHydrant.nodeNumber}</b>:
        {" "}ход отделения {Math.round(fireResult.fastestHydrant.rescueTime ?? 0)} мин
        {" "}+ развёртывание {fireResult.fastestHydrant.hoseCount} рукав.
        {" "}= подача через <b>{Math.round(fireResult.waterStartTime ?? 0)} мин</b>
      </div>
    )}
  </div>
</div>
  );
}
