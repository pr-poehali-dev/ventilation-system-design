// ─────────────────────────────────────────────────────────────────────────────
// BranchVentPipeTab.tsx — вкладка «Вентстав» панели свойств выработки.
//
// Отвечает на главный вопрос при проветривании тупикового забоя вентилятором
// местного проветривания (ВМП) по нагнетательной схеме:
//
//     вентилятор даёт Q_вент  →  утечки по ставу  →  в забой приходит Q_забой
//
// и на обратный вопрос: НА КАКУЮ ДЛИНУ ХВАТИТ СТАВА, чтобы в забой пришло
// требуемое по газу/людям/взрывным работам количество воздуха.
//
// Утечки считаются одной из двух методик на выбор пользователя:
//   • по паспорту рукава (удельные потери на 100 м от изготовителя);
//   • по нормативной формуле коэффициента доставки воздуха.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { type VentSection, type VentNorms } from "@/lib/ventSections";
import { calcFaceDemand } from "@/lib/airDemand";
import { getDuctBrand, getDuctSize, VENT_DUCT_BRANDS } from "@/lib/ventDucts";
import { getFanById, fanHAngle } from "@/lib/fanCurves";
import {
  calcVentPipe, calcVentPipeMaxLength, buildDeliveryCurve, solveFanFlow,
  type VpLeakMethod,
} from "@/lib/ventPipeCalc";
import {
  SectionHeader, NumberInput, ComputedInput, SelectField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchVentPipeTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  ventSections: VentSection[];
  ventNorms: VentNorms;
}

function numFmt(v: number, d = 2): string {
  if (!isFinite(v) || v === undefined) return "—";
  return v.toFixed(d);
}

export default function BranchVentPipeTab({
  branch, onUpdate, ventSections, ventNorms,
}: BranchVentPipeTabProps) {
  // ── Ставa на ветви нет — предлагаем его построить ───────────────────────
  if (!branch.hasVentPipe) {
    return (
      <div>
        <SectionHeader title="Вентиляционный став" />
        <div className="mx-2 my-2 px-2 py-2 rounded text-[11px] leading-snug"
          style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}>
          На этой выработке вентиляционный став не задан. Постройте став
          (маршрут от вентилятора до забоя), и здесь появится расчёт доставки
          воздуха: сколько воздуха дойдёт до забоя и на какую длину хватит става.
        </div>
      </div>
    );
  }

  const method: VpLeakMethod = branch.vpLeakMethod ?? "passport";
  const brand = getDuctBrand(branch.vpBrandId);
  const size = getDuctSize(brand, branch.vpDiameter);

  // Паспортные потери: приоритет у типоразмера выбранной марки, иначе — то,
  // что пользователь задал вручную в параметрах става.
  const lossPer100m = size?.lossPer100m ?? branch.vpLeakageCoeff ?? 0;
  // Паспортное предельное давление рукава (0 = марка не выбрана, предела нет).
  const workPressure = size?.workPressure ?? branch.vpWorkPressure ?? 0;

  // Подача вентилятора — фактический расход, посчитанный решателем сети.
  const fanFlow = Math.abs(branch.flow ?? 0);
  // Напор вентилятора — рабочая точка из расчёта сети.
  const fanPressure = Math.abs(branch.fanPressure ?? 0);

  const length = branch.vpLength ?? 0;

  // ── Характеристика вентилятора H(Q) ────────────────────────────────────
  // Без неё расчёт предельной длины врёт в разы: программа считала бы, что
  // вентилятор и на трёх километрах гонит столько же воздуха, сколько на
  // трёхстах метрах. На деле подача падает с ростом сопротивления става.
  const fanCurveObj = branch.hasFan ? getFanById(branch.fanCurveId) : undefined;
  const fanCurve = fanCurveObj
    ? (Q: number) => fanHAngle(
        fanCurveObj, Q, branch.fanBladeAngle,
        branch.fanRpm > 0 ? branch.fanRpm : fanCurveObj.rpmNominal,
      )
    : undefined;

  // Плотность стыков: сколько стыков приходится на метр става. При переборе
  // длин число стыков должно расти вместе со ставом.
  const jointsPerMeter = length > 0 && (branch.vpJointCount ?? 0) > 0
    ? (branch.vpJointCount ?? 0) / length
    : (branch.vpLinkLength ?? 20) > 0 ? 1 / (branch.vpLinkLength ?? 20) : 0;

  const baseInput = {
    method,
    diameter: branch.vpDiameter ?? 0,
    alpha: brand?.alpha ?? branch.vpPipeAlpha ?? 0,
    lossPer100m,
    linkLength: branch.vpLinkLength ?? 20,
    jointCount: branch.vpJointCount ?? 0,
    localXi: branch.vpLocalXi ?? 0,
    jointLeakK: branch.vpJointLeakK ?? 0,
    jointsPerMeter,
    fanFlow,
  };

  // Расход, который даёт паспортная кривая на нынешней длине става. Если он
  // сильно расходится с расчётом сети — значит, вентилятор работает вне
  // паспортной зоны, и об этом надо честно предупредить, а не подгонять цифры.
  const rNow = calcVentPipe({ ...baseInput, length }).R;
  const qByCurve = fanCurve ? solveFanFlow(fanCurve, rNow) : 0;
  const curveMismatch = fanCurve !== undefined && length > 0 && fanFlow > 0.01
    && qByCurve > 0.01 && Math.abs(qByCurve - fanFlow) / fanFlow > 0.15;

  const input = { ...baseInput, fanCurve };
  const res = calcVentPipe({ ...input, length });

  // ── Требуемый расход в забое ───────────────────────────────────────────
  // По умолчанию берём из расчёта потребности воздуха (вкладка «Расход
  // воздуха»): там уже определён максимум по газу, людям, ВВ и дизелю.
  // Пользователь может переопределить вручную.
  const section = ventSections.find(s => s.id === (branch.ventSectionId ?? "")) ?? null;
  const demand = calcFaceDemand(branch, ventNorms, section);
  const autoRequired = demand.total ?? 0;
  const required = (branch.vpRequiredFlow ?? 0) > 0
    ? branch.vpRequiredFlow!
    : autoRequired;

  // ── Предельная длина става ─────────────────────────────────────────────
  // Ограничение по давлению — меньшее из напора вентилятора и паспортного
  // предела рукава: став не должен ни «не продавиться», ни порваться.
  const pressureLimit = (() => {
    const limits = [fanPressure, workPressure].filter(v => v > 0);
    return limits.length ? Math.min(...limits) : 0;
  })();

  const limit = required > 0
    ? calcVentPipeMaxLength(input, required, pressureLimit, length)
    : null;

  // ── Проверки для предупреждений ────────────────────────────────────────
  const flowShort = required > 0 && res.flowFace < required;
  const overPressure = workPressure > 0 && res.deltaP > workPressure;
  const overFanHead = fanPressure > 0 && res.deltaP > fanPressure;

  // График «расход в забое от длины става»
  const curveMax = Math.max(length * 1.6, (limit?.maxLength ?? 0) * 1.3, 100);
  const curve = buildDeliveryCurve(input, curveMax, 44);

  const Warn = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded leading-snug"
      style={{ background: "#fef3c7", border: "1px solid #f59e0b", color: "#92400e" }}>
      {children}
    </div>
  );

  const Ok = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-1 my-1 px-2 py-1 text-[11px] rounded leading-snug"
      style={{ background: "#ecfdf5", border: "1px solid #6ee7b7", color: "#065f46" }}>
      {children}
    </div>
  );

  return (
    <div>
      <SectionHeader title="Схема проветривания" />
      <div className="mx-2 my-1 px-2 py-1 rounded text-[10px] leading-snug"
        style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af" }}>
        Нагнетательная схема: вентилятор подаёт свежий воздух по ставу в забой,
        отработанный выходит по выработке.
      </div>

      <SectionHeader title="Методика расчёта утечек" />
      <InlineLabel label="Методика">
        <SelectField
          value={method}
          onChange={(v) => onUpdate({ vpLeakMethod: v as VpLeakMethod })}
          options={[
            { value: "kolavent", label: "По таблицам KolaVent Flex" },
            { value: "passport", label: "По паспорту рукава" },
            { value: "normative", label: "По нормативной формуле" },
          ]}
        />
      </InlineLabel>

      <div className="mx-2 my-1 px-2 py-1 rounded text-[10px] leading-snug"
        style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}>
        {method === "kolavent" ? (
          <>Коэффициент утечек берётся из таблиц изготовителя KolaVent Flex.
          До 200 м — по формуле, дальше — по таблицам, где значение зависит от
          длины става, диаметра рукава и подачи в забой. Самые точные данные
          для этой марки.</>
        ) : method === "passport" ? (
          <>Потери берутся из паспорта рукава — {numFmt(lossPer100m, 1)} % на
          каждые 100 м става. Точно для нового рукава известной марки.</>
        ) : (
          <>Утечки считаются через стыки звеньев с учётом давления в ставе:
          чем длиннее став, тем выше давление и сильнее утечки. Даёт запасную
          (осторожную) оценку для става, собранного из отдельных звеньев.</>
        )}
      </div>

      {method === "kolavent" && res.leakUnsupported && (
        <Warn>
          {res.leakUnsupported}
          {(res.leakSuggest?.length ?? 0) > 0 && (
            <> Для этих условий изготовитель подтверждает диаметры:{" "}
            {res.leakSuggest!.map(d => `⌀${d}`).join(", ")} мм. Показанные ниже
            числа посчитаны по паспорту рукава и носят справочный характер.</>
          )}
        </Warn>
      )}

      {method === "kolavent" && !res.leakUnsupported && res.leakNote && (
        <div className="mx-2 my-1 px-2 py-1 rounded text-[10px] leading-snug"
          style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534" }}>
          {res.leakNote} Коэффициент утечек Kу.т = {numFmt(1 / res.delivery, 3)}.
        </div>
      )}

      {method === "passport" && !brand && (
        <Warn>
          Марка рукава не выбрана — расчёт идёт по утечкам, заданным вручную
          ({numFmt(lossPer100m, 1)} % на 100 м). Выберите марку в параметрах
          става, чтобы использовать паспортные данные.
        </Warn>
      )}

      {method === "normative" && (
        <>
          <InlineLabel label="Длина звена, м">
            <NumberInput
              value={branch.vpLinkLength ?? 20}
              placeholder="20"
              min={0}
              onChange={(v) => onUpdate({ vpLinkLength: v })}
            />
          </InlineLabel>
          <InlineLabel label="Стыковой расход">
            <NumberInput
              value={branch.vpJointLeakK ?? 0}
              placeholder="0.003"
              min={0}
              onChange={(v) => onUpdate({ vpJointLeakK: v })}
            />
          </InlineLabel>
          <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
            Качество сборки стыков. Пусто — 0,003 (рукав с кольцами, обычная
            сборка). Изношенный или плохо затянутый став — до 0,01.
          </div>
        </>
      )}

      {/* Сравнение методик: инженеру важно видеть, насколько расходятся
          оценки, чтобы понимать степень неопределённости. */}
      {fanFlow > 0.01 && length > 0 && (() => {
        const titles: Record<VpLeakMethod, string> = {
          kolavent: "по таблицам KolaVent Flex",
          passport: "по паспорту рукава",
          normative: "по нормативной формуле",
        };
        const others = (["kolavent", "passport", "normative"] as VpLeakMethod[])
          .filter(m => m !== method)
          .map(m => ({ m, r: calcVentPipe({ ...input, method: m, length }) }))
          // Методику, которую изготовитель не подтверждает на этих условиях,
          // в сравнении не показываем: её число ничего не значит.
          .filter(x => !x.r.leakUnsupported);
        if (!others.length) return null;
        return (
          <div className="mx-2 my-1 px-2 py-1 rounded text-[10px] leading-snug"
            style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#4b5563" }}>
            Для сравнения:
            {others.map(({ m, r }) => (
              <div key={m}>
                {titles[m]} — в забой пришло бы {numFmt(r.flowFace, 2)} м³/с
                {" "}(доставка {numFmt(r.delivery, 3)}).
              </div>
            ))}
          </div>
        );
      })()}

      <SectionHeader title="Исходные данные" />
      <InlineLabel label="Диаметр, мм">
        <ComputedInput value={numFmt(branch.vpDiameter ?? 0, 0)} />
      </InlineLabel>
      <InlineLabel label="Длина става, м">
        <ComputedInput value={numFmt(length, 0)} />
      </InlineLabel>
      <InlineLabel label="Подача ВМП, м³/с">
        <ComputedInput value={numFmt(fanFlow, 2)} />
      </InlineLabel>
      <InlineLabel label="Напор ВМП, Па">
        <ComputedInput value={numFmt(fanPressure, 0)} />
      </InlineLabel>
      {fanCurve && (
        <InlineLabel label="Подача по кривой">
          <ComputedInput value={numFmt(qByCurve, 2)} />
        </InlineLabel>
      )}
      {fanCurve && (
        <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
          Подача падает с удлинением става: чем выше сопротивление, тем меньше
          воздуха вентилятор прогоняет по паспортной характеристике.
        </div>
      )}

      {curveMismatch && (
        <Warn>
          Расчёт сети даёт {numFmt(fanFlow, 2)} м³/с, а по паспортной кривой
          вентилятора на ставе такой длины должно быть {numFmt(qByCurve, 2)} м³/с.
          Вентилятор работает вне паспортной зоны — предельная длина посчитана
          по паспорту и может расходиться с фактом. Проверьте угол лопаток,
          обороты и сопротивление става.
        </Warn>
      )}

      {!fanCurve && (
        <Warn>
          Характеристика вентилятора не задана — подача считается неизменной
          при любой длине става. На деле она падает с удлинением, поэтому
          предельная длина получится завышенной. Выберите модель вентилятора.
        </Warn>
      )}

      {fanFlow < 0.01 && (
        <Warn>
          Подача вентилятора равна нулю. Выполните расчёт сети — без рабочей
          точки ВМП доставку воздуха посчитать нельзя.
        </Warn>
      )}

      <SectionHeader title="Доставка воздуха в забой" />
      <InlineLabel label="Коэф. доставки">
        <ComputedInput value={numFmt(res.delivery, 3)} />
      </InlineLabel>
      <InlineLabel label="Утечки, м³/с">
        <ComputedInput value={numFmt(res.leakage, 2)} />
      </InlineLabel>
      <InlineLabel label="Утечки, %">
        <ComputedInput value={numFmt(res.leakagePercent, 1)} />
      </InlineLabel>

      {/* Наглядная цепочка: сколько дал вентилятор → сколько дошло */}
      <div className="mx-2 my-1 px-2 py-2 rounded"
        style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-gray-600">Вентилятор</span>
          <span className="tabular-nums font-semibold" style={{ color: "#1e40af" }}>
            {numFmt(res.flowFan, 2)} м³/с
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] py-0.5">
          <span className="text-gray-500">− утечки в ставе</span>
          <span className="tabular-nums" style={{ color: "#b45309" }}>
            −{numFmt(res.leakage, 2)} м³/с
          </span>
        </div>
        <div className="flex items-center justify-between text-[12px] pt-1"
          style={{ borderTop: "1px solid #e2e8f0" }}>
          <span className="font-semibold text-gray-700">В забой придёт</span>
          <span className="tabular-nums font-bold"
            style={{ color: flowShort ? "#b91c1c" : "#047857" }}>
            {numFmt(res.flowFace, 2)} м³/с
          </span>
        </div>
      </div>

      <SectionHeader title="Требуемый расход в забое" />
      <InlineLabel label="Требуется, м³/с">
        <NumberInput
          value={branch.vpRequiredFlow ?? 0}
          placeholder={autoRequired > 0 ? numFmt(autoRequired, 2) : "задайте"}
          min={0}
          onChange={(v) => onUpdate({ vpRequiredFlow: v })}
        />
      </InlineLabel>
      <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
        Пусто — берётся из расчёта потребности воздуха
        {autoRequired > 0 ? ` (${numFmt(autoRequired, 2)} м³/с)` : ""}.
      </div>

      {required <= 0 && (
        <Warn>
          Требуемый расход не задан. Заполните вкладку «Расход воздуха» или
          введите значение вручную — без него нельзя определить, на какую
          длину хватит става.
        </Warn>
      )}

      {flowShort && (
        <Warn>
          Воздуха в забое не хватает: приходит {numFmt(res.flowFace, 2)} м³/с
          при требуемых {numFmt(required, 2)} м³/с. Сократите став, увеличьте
          диаметр рукава или поставьте более мощный вентилятор.
        </Warn>
      )}
      {!flowShort && required > 0 && (
        <Ok>
          Воздуха достаточно: в забой приходит {numFmt(res.flowFace, 2)} м³/с
          при требуемых {numFmt(required, 2)} м³/с.
        </Ok>
      )}

      <SectionHeader title="Давление в ставе" />
      <InlineLabel label="Сопр. става, кМюрг">
        <ComputedInput value={numFmt(res.R, 4)} />
      </InlineLabel>
      <InlineLabel label="Депрессия става, Па">
        <ComputedInput value={numFmt(res.deltaP, 0)} />
      </InlineLabel>
      {workPressure > 0 && (
        <InlineLabel label="Предел рукава, Па">
          <ComputedInput value={numFmt(workPressure, 0) + (size?.workPressureEstimated ? " (оценка)" : "")} />
        </InlineLabel>
      )}
      {size?.workPressureEstimated && (
        <div className="px-2 pb-1 text-[9px] text-gray-400 leading-snug">
          Изготовитель даёт предельное давление только для ⌀1000 и ⌀1200 мм.
          Для этого диаметра оно оценено расчётом в запас.
        </div>
      )}
      <InlineLabel label="Скорость, м/с">
        <ComputedInput value={numFmt(res.velocity, 1)} />
      </InlineLabel>

      {overFanHead && (
        <Warn>
          Напора вентилятора не хватает: на став нужно {numFmt(res.deltaP, 0)} Па,
          а вентилятор даёт {numFmt(fanPressure, 0)} Па. Воздух до забоя
          не дойдёт в расчётном количестве.
        </Warn>
      )}
      {overPressure && (
        <Warn>
          Давление {numFmt(res.deltaP, 0)} Па превышает паспортный предел рукава
          {" "}{numFmt(workPressure, 0)} Па — рукав может раздуть или порвать.
        </Warn>
      )}

      <SectionHeader title="Предельная длина става" />
      {limit ? (
        <>
          <InlineLabel label="Хватит на, м">
            <ComputedInput value={limit.maxLength > 0 ? numFmt(limit.maxLength, 0) : "—"} />
          </InlineLabel>
          <InlineLabel label="Запас длины, м">
            <ComputedInput value={numFmt(limit.reserve, 0)} />
          </InlineLabel>

          {limit.maxLength <= 0 ? (
            <Warn>
              Требуемый расход недостижим даже при коротком ставе. Нужен более
              мощный вентилятор или рукав большего диаметра.
            </Warn>
          ) : limit.reserve < 0 ? (
            <Warn>
              Став уже длиннее предельного на {numFmt(-limit.reserve, 0)} м.
              При Ø{numFmt(branch.vpDiameter ?? 0, 0)} мм и требуемых
              {" "}{numFmt(required, 2)} м³/с хватает только
              на {numFmt(limit.maxLength, 0)} м.
            </Warn>
          ) : (
            <Ok>
              При Ø{numFmt(branch.vpDiameter ?? 0, 0)} мм и требуемых
              {" "}{numFmt(required, 2)} м³/с става хватит
              на {numFmt(limit.maxLength, 0)} м — запас
              {" "}{numFmt(limit.reserve, 0)} м.
            </Ok>
          )}

          {limit.maxLength > 0 && limit.limitedBy !== "none" && (
            <div className="mx-2 my-1 px-2 py-1 rounded text-[10px] leading-snug"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}>
              Ограничивает {limit.limitedBy === "flow"
                ? "нехватка воздуха в забое: дальше утечки съедают требуемый расход"
                : "давление: дальше депрессия става превысит допустимую"}.
            </div>
          )}
        </>
      ) : (
        <div className="mx-2 my-1 px-2 py-1 rounded text-[10px] text-gray-500"
          style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          Задайте требуемый расход в забое, чтобы рассчитать предельную длину.
        </div>
      )}

      {/* ── График: расход в забое в зависимости от длины става ─────────── */}
      {required > 0 && fanFlow > 0.01 && (() => {
        const W = 300, H = 120, padL = 34, padB = 18, padT = 8, padR = 8;
        const maxX = curveMax;
        const maxY = Math.max(fanFlow, required) * 1.1;
        if (maxX <= 0 || maxY <= 0) return null;
        const px = (x: number) => padL + (x / maxX) * (W - padL - padR);
        const py = (y: number) => H - padB - (y / maxY) * (H - padB - padT);
        const path = curve
          .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.length).toFixed(1)},${py(p.flowFace).toFixed(1)}`)
          .join(" ");
        const yReq = py(required);
        const xLim = limit && limit.maxLength > 0 && limit.maxLength < maxX
          ? px(limit.maxLength) : null;
        const xCur = length > 0 && length < maxX ? px(length) : null;

        return (
          <>
            <SectionHeader title="Расход в забое от длины става" />
            <div className="px-2 py-1">
              <svg width={W} height={H} style={{ maxWidth: "100%" }}>
                {/* оси */}
                <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#cbd5e1" />
                <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#cbd5e1" />
                {/* требуемый расход — горизонтальная красная линия */}
                <line x1={padL} y1={yReq} x2={W - padR} y2={yReq}
                  stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1} />
                <text x={W - padR} y={yReq - 3} fontSize={8} fill="#dc2626" textAnchor="end">
                  требуется {numFmt(required, 1)}
                </text>
                {/* предельная длина — вертикальная линия */}
                {xLim !== null && (
                  <>
                    <line x1={xLim} y1={padT} x2={xLim} y2={H - padB}
                      stroke="#f59e0b" strokeDasharray="4 3" strokeWidth={1} />
                    <text x={xLim + 2} y={padT + 8} fontSize={8} fill="#b45309">
                      предел {numFmt(limit!.maxLength, 0)} м
                    </text>
                  </>
                )}
                {/* текущая длина става */}
                {xCur !== null && (
                  <>
                    <line x1={xCur} y1={padT} x2={xCur} y2={H - padB}
                      stroke="#2563eb" strokeWidth={1} />
                    <text x={xCur + 2} y={H - padB - 3} fontSize={8} fill="#1d4ed8">
                      сейчас {numFmt(length, 0)} м
                    </text>
                  </>
                )}
                {/* кривая доставки */}
                <path d={path} fill="none" stroke="#0f766e" strokeWidth={1.6} />
                {/* подписи осей */}
                <text x={padL - 4} y={py(maxY) + 8} fontSize={8} fill="#64748b" textAnchor="end">
                  {numFmt(maxY, 0)}
                </text>
                <text x={padL - 4} y={H - padB} fontSize={8} fill="#64748b" textAnchor="end">0</text>
                <text x={W - padR} y={H - 4} fontSize={8} fill="#64748b" textAnchor="end">
                  {numFmt(maxX, 0)} м
                </text>
                <text x={padL} y={H - 4} fontSize={8} fill="#64748b">м³/с ↑ / длина →</text>
              </svg>
            </div>
          </>
        );
      })()}

      <SectionHeader title="Параметры рукава" />
      <InlineLabel label="Марка">
        <SelectField
          value={branch.vpBrandId ?? ""}
          onChange={(v) => {
            const b = getDuctBrand(v);
            const s = b?.sizes.find(x => x.diameter === branch.vpDiameter) ?? b?.sizes[0];
            onUpdate({
              vpBrandId: v,
              ...(b ? { vpPipeAlpha: b.alpha } : {}),
              ...(s ? {
                vpDiameter: s.diameter,
                vpLeakageCoeff: s.lossPer100m,
                vpWorkPressure: s.workPressure,
              } : {}),
            });
          }}
          options={[
            { value: "", label: "— не выбрана —" },
            ...VENT_DUCT_BRANDS.map(b => ({ value: b.id, label: b.name })),
          ]}
        />
      </InlineLabel>
      <InlineLabel label="Коэф. α, ×10⁻⁴">
        <ComputedInput value={numFmt(input.alpha, 3)} />
      </InlineLabel>
      <InlineLabel label="Стыков, шт">
        <NumberInput
          value={branch.vpJointCount ?? 0}
          placeholder="0"
          min={0}
          onChange={(v) => onUpdate({ vpJointCount: v })}
        />
      </InlineLabel>
      <InlineLabel label="Местные ξ">
        <NumberInput
          value={branch.vpLocalXi ?? 0}
          placeholder="0"
          min={0}
          onChange={(v) => onUpdate({ vpLocalXi: v })}
        />
      </InlineLabel>
    </div>
  );
}