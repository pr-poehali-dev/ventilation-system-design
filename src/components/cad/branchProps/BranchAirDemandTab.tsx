// ─────────────────────────────────────────────────────────────────────────────
// BranchAirDemandTab.tsx — вкладка «Расход воздуха» панели свойств выработки:
// карточка забоя по ФНиП № 505 п. 155 — потребность по каждому фактору
// отдельно, в зачёт идёт максимум, с проверкой фактической скорости.
//
// Вынесено из BranchPropsPanel.tsx БЕЗ изменений разметки, формул и текстов.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import {
  type VentSection, type VentNorms, type FaceType,
  FACE_TYPE_OPTIONS, FACE_TYPE_LABEL, FACE_TYPE_FACTORS, simultaneityFactor,
} from "@/lib/ventSections";
import { calcFaceDemand, FACTOR_LABEL } from "@/lib/airDemand";
import {
  SectionHeader, EditInput, ComputedInput, SelectField, CheckField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchAirDemandTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  ventSections: VentSection[];
  ventNorms: VentNorms;
}

export default function BranchAirDemandTab({
  branch, onUpdate, ventSections, ventNorms,
}: BranchAirDemandTabProps) {
  const faceType = (branch.ventFaceType ?? "none") as FaceType;
  const isNone = faceType === "none";
  const section = ventSections.find(s => s.id === (branch.ventSectionId ?? "")) ?? null;
  const d = calcFaceDemand(branch, ventNorms, section);

  // Набор факторов, применимых к выбранному типу забоя: лишние поля
  // не показываем, чтобы карточка не пугала объёмом. Если по скрытому
  // фактору остались данные от прежнего типа забоя — блок показываем
  // с предупреждением, иначе цифра «молча» уйдёт в расчёт.
  const F = FACE_TYPE_FACTORS[faceType];
  const hasBlastData  = (branch.ventBlastMassCoal ?? 0) > 0 || (branch.ventBlastMassRock ?? 0) > 0;
  const hasDieselData = (branch.ventDieselPower ?? 0) > 0 || (branch.ventDieselCount ?? 0) > 0;
  const showBlast  = F.blast  || hasBlastData;
  const showDiesel = F.diesel || hasDieselData;

  /** Предупреждение о данных, не типичных для этого типа забоя */
  const StaleNote = ({ what }: { what: string }) => (
    <div className="mx-2 mb-1 px-2 py-1 rounded text-[9px] leading-snug"
      style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}>
      Для типа «{FACE_TYPE_LABEL[faceType]}» {what} обычно не учитывают,
      но данные заданы и участвуют в расчёте. Очистите поля, если они не нужны.
    </div>
  );

  // Подсказка расчётного значения для полей «взять из норм»
  const ph = (v: number) => `${v}`;

  const FactorRow = ({ label, value, active, hint }: {
    label: string; value: number; active: boolean; hint?: string;
  }) => (
    <div className="flex items-center px-1 py-0.5"
      style={{
        borderBottom: "1px solid #ebebeb",
        background: active ? "#eff6ff" : undefined,
      }}>
      <span className="text-[11px] flex-shrink-0"
        style={{ width: 128, color: active ? "#1d4ed8" : "#4b5563", fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
      <span className="text-[11px] text-right flex-1 tabular-nums"
        style={{ color: active ? "#1d4ed8" : "#374151", fontWeight: active ? 700 : 400 }}>
        {value > 0 ? value.toFixed(2) : "—"}
      </span>
      <span className="text-[10px] text-gray-400 flex-shrink-0" style={{ width: 34, textAlign: "right" }}>
        м³/с
      </span>
      {hint && <span className="text-[9px] text-gray-400 pl-1 flex-shrink-0" title={hint}>ⓘ</span>}
    </div>
  );

  return (
    <div>
      <SectionHeader title="Забой" />

      <InlineLabel label="Тип забоя">
        <SelectField
          value={faceType}
          onChange={(v) => onUpdate({ ventFaceType: v })}
          options={FACE_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        />
      </InlineLabel>

      {/* Загрязнение воздуха — свойство самой выработки, не зависит
          от того, задан тип забоя или нет. Влияет на окраску стрелок
          направления воздуха ниже по потоку. */}
      <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer select-none hover:bg-blue-50 transition-colors"
        style={{ borderBottom: "1px solid #ebebeb" }}>
        <input
          type="checkbox"
          checked={branch.pollutesAir ?? false}
          onChange={(e) => onUpdate({ pollutesAir: e.target.checked })}
          className="w-3.5 h-3.5 rounded"
          style={{ accentColor: "#2563eb" }}
        />
        <span className="text-[11px] text-gray-700 leading-tight">Загрязняет воздух</span>
      </label>
      {(branch.pollutesAir ?? false) && (
        <div className="mx-2 my-1 px-2 py-1.5 rounded text-[10px] leading-snug"
          style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af" }}>
          Стрелки направления воздуха в ветвях ниже по потоку от этой ветви
          будут отображаться синим цветом.
        </div>
      )}

      {isNone ? (
        <div className="px-2 py-2 text-[10px] text-gray-500 leading-snug">
          Укажите тип забоя — выработка попадёт в расчёт количества
          воздуха. Потребность считается по людям, газам взрывных работ,
          дизельной технике и минимальной скорости; в зачёт идёт
          наибольшее из значений (ФНиП № 505, п. 155).
        </div>
      ) : (<>
        <div className="px-2 py-1 text-[9px] text-gray-500 leading-snug"
          style={{ background: "#f8fafc", borderBottom: "1px solid #ebebeb" }}>
          Учитываемые факторы: люди
          {F.blast && ", газы взрывных работ"}
          {F.diesel && ", дизельное оборудование"}
          , минимальная скорость.
        </div>
        <InlineLabel label="Наименование">
          <EditInput value={branch.ventDescription ?? ""}
            onChange={(v) => onUpdate({ ventDescription: v })} />
        </InlineLabel>
        <InlineLabel label="Участок">
          <select
            value={branch.ventSectionId ?? ""}
            onChange={(e) => onUpdate({ ventSectionId: e.target.value })}
            className="w-full text-[11px] px-1"
            style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
            <option value="">— не задан —</option>
            {ventSections.map(s => (
              <option key={s.id} value={s.id}>
                {s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}
              </option>
            ))}
          </select>
        </InlineLabel>
        <InlineLabel label="Резервный забой">
          <CheckField checked={branch.ventReserve ?? false}
            onChange={(v) => onUpdate({ ventReserve: v })} />
        </InlineLabel>

        {/* ── По людям ── */}
        <SectionHeader title="По людям" />
        <InlineLabel label="Людей в смену, чел">
          <EditInput type="number" step="1"
            value={branch.ventPeopleCount || ""}
            onChange={(v) => onUpdate({ ventPeopleCount: Math.max(0, Math.round(parseFloat(v) || 0)) })} />
        </InlineLabel>
        <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
          Норма {ventNorms.airPerPerson} м³/мин на человека, по максимальному
          числу одновременно работающих.
        </div>

        {/* ── Взрывные работы ── */}
        {showBlast && (<>
        <SectionHeader title="Взрывные работы" />
        {!F.blast && <StaleNote what="газы взрывных работ" />}
        <InlineLabel label="ВВ по углю, кг">
          <EditInput type="number" step="0.1"
            value={branch.ventBlastMassCoal || ""}
            onChange={(v) => onUpdate({ ventBlastMassCoal: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="ВВ по породе, кг">
          <EditInput type="number" step="0.1"
            value={branch.ventBlastMassRock || ""}
            onChange={(v) => onUpdate({ ventBlastMassRock: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="Время провет., мин">
          <EditInput type="number" step="1"
            value={branch.ventBlastTime || ""}
            placeholder={ph(ventNorms.blastVentTime)}
            onChange={(v) => onUpdate({ ventBlastTime: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="Объём выраб., м³">
          <EditInput type="number" step="1"
            value={branch.ventBlastVolume || ""}
            placeholder={(branch.area * branch.length).toFixed(0)}
            onChange={(v) => onUpdate({ ventBlastVolume: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="Коэф. обводнён.">
          <EditInput type="number" step="0.05"
            value={branch.ventBlastWatering || ""}
            placeholder={ph(ventNorms.wateringFactor)}
            onChange={(v) => onUpdate({ ventBlastWatering: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
          Газовыделение: {ventNorms.gasPerKgCoal} л/кг по углю,
          {" "}{ventNorms.gasPerKgRock} л/кг по породе. Пустые поля —
          значения из справочника норм.
        </div>
        </>)}

        {/* ── Дизельное оборудование ── */}
        {showDiesel && (<>
        <SectionHeader title="Дизельное оборудование" />
        {!F.diesel && <StaleNote what="дизельное оборудование" />}
        <InlineLabel label="Число машин">
          <EditInput type="number" step="1"
            value={branch.ventDieselCount || ""}
            onChange={(v) => {
              const n = Math.max(0, Math.round(parseFloat(v) || 0));
              onUpdate({ ventDieselCount: n });
            }} />
        </InlineLabel>
        <InlineLabel label="Мощность Σ, кВт">
          <EditInput type="number" step="1"
            value={branch.ventDieselPower || ""}
            onChange={(v) => onUpdate({ ventDieselPower: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="Норма, м³/мин·кВт">
          <EditInput type="number" step="0.1"
            value={branch.ventDieselNorm || ""}
            placeholder={ph(ventNorms.airPerKwDiesel)}
            onChange={(v) => onUpdate({ ventDieselNorm: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="Коэф. одноврем.">
          <EditInput type="number" step="0.05"
            value={branch.ventDieselSimult || ""}
            placeholder={ph(simultaneityFactor(branch.ventDieselCount ?? 0, ventNorms))}
            onChange={(v) => onUpdate({ ventDieselSimult: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
          Коэффициент одновременности подставляется по числу машин;
          можно задать своё значение.
        </div>
        </>)}

        {/* ── Коэффициенты ── */}
        <SectionHeader title="Коэффициенты" />
        <InlineLabel label="Коэф. запаса">
          <EditInput type="number" step="0.05"
            value={branch.ventReserveFactor || ""}
            placeholder={ph(d.reserveFactor)}
            onChange={(v) => onUpdate({ ventReserveFactor: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <InlineLabel label="Коэф. утечек">
          <EditInput type="number" step="0.05"
            value={branch.ventLeakFactor || ""}
            placeholder={ph(d.leakFactor)}
            onChange={(v) => onUpdate({ ventLeakFactor: Math.max(0, parseFloat(v) || 0) })} />
        </InlineLabel>
        <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
          Пусто — берётся из участка, а если там не задано — из норм.
        </div>

        {/* ── Результат ── */}
        <SectionHeader title="Потребность по факторам" />
        <FactorRow label="По людям"          value={d.byPeople} active={d.factor === "people"} />
        {showBlast &&
          <FactorRow label="По газам ВР"     value={d.byBlast}  active={d.factor === "blast"} />}
        {showDiesel &&
          <FactorRow label="По дизелю"       value={d.byDiesel} active={d.factor === "diesel"} />}
        <FactorRow label="По мин. скорости"  value={d.byVMin}   active={d.factor === "vmin"} />

        {d.formula && (
          <div className="px-2 py-1 text-[9px] text-gray-500 leading-snug"
            style={{ background: "#f8fafc", borderBottom: "1px solid #ebebeb" }}>
            Определяющий: {FACTOR_LABEL[d.factor]} = {d.formula}
          </div>
        )}

        <InlineLabel label="Расчётная, м³/с">
          <ComputedInput value={d.base > 0 ? d.base.toFixed(2) : "—"} />
        </InlineLabel>
        <InlineLabel label="С коэффициентами">
          <div className="w-full text-[11px] text-right px-1 font-bold tabular-nums"
            style={{ background: "#eef2f7", border: "1px solid #dde3ec", borderRadius: 2, height: 18, lineHeight: "16px", color: "#0f172a" }}>
            {d.total > 0 ? `${d.total.toFixed(2)} м³/с` : "—"}
          </div>
        </InlineLabel>
        <InlineLabel label="Фактически, м³/с">
          <div className="w-full text-[11px] text-right px-1 font-semibold tabular-nums"
            style={{ background: "#eef2f7", border: "1px solid #dde3ec", borderRadius: 2, height: 18, lineHeight: "16px",
              color: d.flowOk ? "#15803d" : "#dc2626" }}>
            {d.actualFlow.toFixed(2)}
          </div>
        </InlineLabel>
        <InlineLabel label="Скорость, м/с">
          <div className="w-full text-[11px] text-right px-1 font-semibold tabular-nums"
            style={{ background: "#eef2f7", border: "1px solid #dde3ec", borderRadius: 2, height: 18, lineHeight: "16px",
              color: d.velocityOk ? "#15803d" : "#dc2626" }}
            title={`Допустимо: ${d.vMin}–${d.vMax} м/с`}>
            {d.actualVelocity.toFixed(2)}
          </div>
        </InlineLabel>

        <div className="px-2 py-1.5 text-[11px] font-semibold leading-snug"
          style={{ color: d.verdict === "Обеспечено" ? "#15803d" : "#b91c1c" }}>
          {d.verdict}
          {d.recommendation && (
            <div className="text-[9px] font-normal text-gray-500 pt-0.5">
              {d.recommendation}
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}
