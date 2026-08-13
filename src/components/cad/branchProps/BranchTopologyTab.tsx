// ─────────────────────────────────────────────────────────────────────────────
// BranchTopologyTab.tsx — вкладка «Топология» панели свойств выработки:
// геометрия (длина, угол, сечение), сопротивление, вентиляционная труба,
// расчётные показатели потока.
//
// Вынесено из BranchPropsPanel.tsx БЕЗ изменений разметки, формул и подписей.
// ─────────────────────────────────────────────────────────────────────────────
import { type TopoBranch } from "@/lib/topology";
import { SURFACE_TYPES, PIPE_ALPHA_TYPES } from "@/lib/aerodynamics";
import { VENT_DUCT_BRANDS, getDuctBrand, getDuctSize } from "@/lib/ventDucts";
import { G_ACCEL } from "@/lib/bulkheads";
import { type VentSection } from "@/lib/ventSections";
import {
  SectionHeader, ParamRow, EditInput, ComputedInput, CheckField, InlineLabel,
} from "@/components/cad/BranchPropsPrimitives";

interface BranchTopologyTabProps {
  branch: TopoBranch;
  onUpdate: (patch: Partial<TopoBranch>) => void;
  shortNode: (id: string) => string;
  visible: Set<string>;
  toggle: (id: string) => void;
  angle: number;
  unitR: number;
  uRes: { fromBase: (v: number) => number; symbol: string; decimals: number };
  rToDisplay: (rKmurg: number) => number;
  numFmt: (v: number, d?: number) => string;
  fmtR: (rKmu: number, minDecimals?: number) => string;
  bulkheadRKmu: number;
  ventSections: VentSection[];
  onOpenSectionsLibrary?: () => void;
}

export default function BranchTopologyTab({
  branch, onUpdate, shortNode, visible, toggle, angle, unitR, uRes, rToDisplay,
  numFmt, fmtR, bulkheadRKmu, ventSections, onOpenSectionsLibrary,
}: BranchTopologyTabProps) {
  return (
  <div>
    <SectionHeader title="Геометрия" />

    <InlineLabel label="Ветвь №">
      <EditInput value={branch.id} readOnly />
    </InlineLabel>

    <InlineLabel label="Нач. узел">
      <EditInput value={shortNode(branch.fromId)} readOnly />
    </InlineLabel>

    <InlineLabel label="Кон. узел">
      <EditInput value={shortNode(branch.toId)} readOnly />
    </InlineLabel>

    <InlineLabel label="Длина, м">
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          {branch.manualLength ? (
            <EditInput
              type="number"
              step="0.5"
              value={branch.length}
              onChange={(v) => onUpdate({ length: parseFloat(v) || 0 })}
            />
          ) : (
            <ComputedInput value={numFmt(branch.length, 1)} />
          )}
        </div>
        <button
          onClick={() => onUpdate({ manualLength: !branch.manualLength })}
          title={branch.manualLength ? "Вычислять автоматически из координат" : "Задать вручную"}
          style={{ fontSize: 10, padding: "1px 4px", border: "1px solid #c8c8c8", borderRadius: 2, background: branch.manualLength ? "#dbeafe" : "#f5f5f5", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
          {branch.manualLength ? "рук" : "авт"}
        </button>
      </div>
    </InlineLabel>

    <InlineLabel label="Угол наклона, °">
      <div className="flex items-center gap-0.5 flex-1 min-w-0">
        <div className="flex-1 min-w-0">
          {branch.manualAngle ? (
            <EditInput
              type="number"
              step="1"
              value={angle}
              onChange={(v) => onUpdate({ angle: Math.max(0, Math.min(90, Math.abs(parseFloat(v) || 0))) })}
            />
          ) : (
            <ComputedInput value={numFmt(angle, 1)} />
          )}
        </div>
        <button
          onClick={() => onUpdate({ manualAngle: !branch.manualAngle })}
          title={branch.manualAngle ? "Вычислять автоматически из координат" : "Задать вручную"}
          style={{ fontSize: 10, padding: "1px 4px", border: "1px solid #c8c8c8", borderRadius: 2, background: branch.manualAngle ? "#dbeafe" : "#f5f5f5", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
          {branch.manualAngle ? "рук" : "авт"}
        </button>
      </div>
    </InlineLabel>

    <InlineLabel label="Форма сечения">
      <select
        value={branch.shape}
        onChange={(e) => {
          const s = e.target.value as TopoBranch["shape"];
          const extra: Partial<TopoBranch> = { shape: s, manualSection: s === "custom" };
          if (s === "arch" && (!branch.archHeight || branch.archHeight > branch.rectWidth / 2)) {
            extra.archHeight = branch.rectWidth / 2;
          }
          onUpdate(extra);
        }}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
        <option value="round">Круглое</option>
        <option value="rect">Прямоугольное</option>
        <option value="trap">Трапециевидное</option>
        <option value="arch">Арочное</option>
        <option value="custom">Задано вручную</option>
      </select>
    </InlineLabel>

    {/* Участок рудника — группа выработок для позабойного расчёта
        количества воздуха (ФНиП № 505, п. 155). */}
    <InlineLabel label="Участок">
      <div className="flex items-center gap-0.5 w-full">
        <select
          value={branch.ventSectionId ?? ""}
          onChange={(e) => onUpdate({ ventSectionId: e.target.value })}
          className="flex-1 min-w-0 text-[11px] px-1"
          style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
          <option value="">— не задан —</option>
          {ventSections.map(s => (
            <option key={s.id} value={s.id}>
              {s.number ? `${s.number}. ` : ""}{s.name || "Без названия"}
            </option>
          ))}
        </select>
        {onOpenSectionsLibrary && (
          <button
            onClick={onOpenSectionsLibrary}
            title="Справочник участков рудника"
            style={{ fontSize: 10, padding: "1px 4px", border: "1px solid #c8c8c8", borderRadius: 2, background: "#f5f5f5", cursor: "pointer", flexShrink: 0, lineHeight: "14px" }}>
            …
          </button>
        )}
      </div>
    </InlineLabel>

    {/* Способ задания сечения: по габаритам (S и P считаются) или вручную
        (задаются прямо S и P). Тип выработки из справочника включает ручной
        режим — там площадь берётся из справочника. */}
    <InlineLabel label="Задание сечения">
      <select
        value={branch.manualSection ? "manual" : "dims"}
        onChange={(e) => onUpdate({ manualSection: e.target.value === "manual" })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
        <option value="dims">По габаритам</option>
        <option value="manual">Вручную (S и P)</option>
      </select>
    </InlineLabel>

    {!branch.manualSection && branch.shape === "round" && (
      <InlineLabel label="Диаметр D, м">
        <EditInput
          type="number" step="0.1"
          value={branch.diameter}
          onChange={(v) => onUpdate({ diameter: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && (branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
      <InlineLabel label="Ширина a, м">
        <EditInput
          type="number" step="0.1"
          value={branch.rectWidth}
          onChange={(v) => onUpdate({ rectWidth: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && (branch.shape === "rect" || branch.shape === "trap" || branch.shape === "arch") && (
      <InlineLabel label="Высота b, м">
        <EditInput
          type="number" step="0.1"
          value={branch.rectHeight}
          onChange={(v) => onUpdate({ rectHeight: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && branch.shape === "arch" && (
      <InlineLabel label="Стрела свода h, м">
        <EditInput
          type="number" step="0.05"
          value={branch.archHeight}
          onChange={(v) => onUpdate({ archHeight: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {!branch.manualSection && branch.shape === "trap" && (
      <InlineLabel label="Верх c, м">
        <EditInput
          type="number" step="0.1"
          value={branch.trapTopWidth}
          onChange={(v) => onUpdate({ trapTopWidth: parseFloat(v) || 0, manualSection: false })}
        />
      </InlineLabel>
    )}
    {/* Итоговые S и P. Если сечение задано вручную (в т.ч. после выбора типа
        выработки из справочника) — разрешаем править их напрямую, иначе они
        считаются по габаритам и остаются только для чтения. */}
    <InlineLabel label="Периметр P, м">
      {branch.manualSection ? (
        <EditInput
          type="number" step="0.1"
          value={branch.perimeter}
          onChange={(v) => onUpdate({ perimeter: parseFloat(v) || 0, manualSection: true })}
        />
      ) : (
        <ComputedInput value={numFmt(branch.perimeter, 2)} />
      )}
    </InlineLabel>

    <InlineLabel label="Площадь S, м²">
      {branch.manualSection ? (
        <EditInput
          type="number" step="0.1"
          value={branch.area}
          onChange={(v) => onUpdate({ area: parseFloat(v) || 0, manualSection: true })}
        />
      ) : (
        <ComputedInput value={numFmt(branch.area, 2)} />
      )}
    </InlineLabel>

    <InlineLabel label="Гидр. диаметр Dh, м">
      <ComputedInput value={numFmt(branch.dh, 3)} />
    </InlineLabel>

    <div style={{ borderBottom: "1px solid #e0e0e0", margin: "2px 0" }} />

    <InlineLabel label="Капитальная">
      <CheckField checked={branch.capital ?? false} onChange={(v) => onUpdate({ capital: v })} />
    </InlineLabel>

    <InlineLabel label="Проектируемая">
      <CheckField checked={branch.designed ?? false} onChange={(v) => onUpdate({ designed: v })} />
    </InlineLabel>

    <SectionHeader title="Аэродинамика" />

    <InlineLabel label="Способ задания R">
      <select
        value={branch.resistanceMode}
        onChange={(e) => onUpdate({ resistanceMode: e.target.value as TopoBranch["resistanceMode"] })}
        className="w-full text-[11px] px-1"
        style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
        <option value="surface">По типу поверхности</option>
        <option value="alpha">По коэф. α</option>
        <option value="roughness">По шероховатости Δ</option>
        <option value="manual">Вручную (R)</option>
        <option value="pipe">Трубопровод (R=6.48αL/D⁵)</option>
      </select>
    </InlineLabel>

    {branch.resistanceMode === "surface" && (
      <InlineLabel label="Тип поверхности">
        <select
          value={branch.surfaceId}
          onChange={(e) => {
            const s = SURFACE_TYPES.find((x) => x.id === e.target.value);
            if (s) onUpdate({ surfaceId: s.id, surface: s.name, alphaCoef: s.alpha, roughness: s.roughness });
          }}
          className="w-full text-[11px] px-1"
          style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
          {SURFACE_TYPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </InlineLabel>
    )}

    {(branch.resistanceMode === "alpha" || branch.resistanceMode === "surface") && (
      <InlineLabel label="Коэф. α, ×10⁻⁴">
        {branch.resistanceMode === "alpha" ? (
          <EditInput
            type="number" step="1"
            value={branch.alphaCoef}
            onChange={(v) => onUpdate({ alphaCoef: parseFloat(v) || 0 })}
          />
        ) : (
          <ComputedInput value={numFmt(branch.alphaCoef, 0)} />
        )}
      </InlineLabel>
    )}

    {branch.resistanceMode === "roughness" && (
      <InlineLabel label="Шероховатость Δ, мм">
        <EditInput
          type="number" step="1"
          value={branch.roughness}
          onChange={(v) => onUpdate({ roughness: parseFloat(v) || 0 })}
        />
      </InlineLabel>
    )}

    {branch.resistanceMode === "manual" && (
      <InlineLabel label={`Сопротивление R, ${uRes.symbol}`}>
        <EditInput
          type="number" step="0.001"
          value={branch.manualR}
          onChange={(v) => onUpdate({ manualR: parseFloat(v) || 0 })}
        />
      </InlineLabel>
    )}

    {branch.resistanceMode === "pipe" && (() => {
      const duct = getDuctBrand(branch.vpBrandId);
      return (
      <>
        {/* Марка рукава — синхронизирована с окном построения
            вентрубопровода: выбор марки подставляет α, диаметр,
            паспортные утечки и предельное рабочее давление. */}
        <InlineLabel label="Марка рукава">
          <select
            value={branch.vpBrandId ?? ""}
            onChange={(e) => {
              const b = getDuctBrand(e.target.value);
              if (!b) {
                onUpdate({ vpBrandId: "", vpWorkPressure: 0 });
                return;
              }
              const curD = Math.round((branch.pipeDiameter ?? 0.5) * 1000);
              const size = getDuctSize(b, curD) ?? b.sizes[0];
              onUpdate({
                vpBrandId: b.id,
                pipeAlpha: b.alpha,
                vpPipeAlpha: b.alpha,
                pipeDiameter: size.diameter / 1000,
                vpDiameter: size.diameter,
                shape: "round", diameter: size.diameter / 1000, manualSection: false,
                vpLeakageCoeff: size.lossPer100m,
                vpWorkPressure: size.workPressure,
                vpPipeType: "",
              });
            }}
            className="w-full text-[11px] px-1"
            style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
            <option value="">— без марки —</option>
            {VENT_DUCT_BRANDS.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </InlineLabel>
        {duct ? (
          <>
            {/* У марки диаметр выбирается только из выпускаемых типоразмеров */}
            <InlineLabel label="Диаметр D, мм">
              <select
                value={Math.round((branch.pipeDiameter ?? 0.5) * 1000)}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  const size = getDuctSize(duct, d);
                  onUpdate({
                    pipeDiameter: d / 1000,
                    vpDiameter: d,
                    // Сечение ветви — под диаметр рукава
                    shape: "round", diameter: d / 1000, manualSection: false,
                    ...(size ? { vpLeakageCoeff: size.lossPer100m, vpWorkPressure: size.workPressure } : {}),
                  });
                }}
                className="w-full text-[11px] px-1"
                style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
                {duct.sizes.map(sz => (
                  <option key={sz.diameter} value={sz.diameter}>Ø {sz.diameter}</option>
                ))}
              </select>
            </InlineLabel>
            <InlineLabel label="Утечки, % на 100 м">
              <ComputedInput value={numFmt(branch.vpLeakageCoeff ?? 0, 1)} />
            </InlineLabel>
            <InlineLabel label="Раб. давление, Па">
              <ComputedInput value={numFmt(branch.vpWorkPressure ?? 0, 0)} />
            </InlineLabel>
          </>
        ) : (
        <InlineLabel label="Диаметр D, м">
          <EditInput
            type="number" step="0.05"
            value={branch.pipeDiameter ?? 0.5}
            onChange={(v) => {
              const d = parseFloat(v) || 0;
              onUpdate({ pipeDiameter: d, vpDiameter: Math.round(d * 1000) });
            }}
          />
        </InlineLabel>
        )}
        {/* Тип трубопровода — только когда марка не задана: у марки
            коэффициент α берётся из её паспорта. */}
        {!duct && (
          <InlineLabel label="Тип трубопровода">
            <select
              value={PIPE_ALPHA_TYPES.find(p => p.alpha === (branch.pipeAlpha ?? 9))?.id ?? ""}
              onChange={(e) => {
                const p = PIPE_ALPHA_TYPES.find(x => x.id === e.target.value);
                if (p) onUpdate({ pipeAlpha: p.alpha, vpPipeAlpha: p.alpha, vpPipeType: p.id });
              }}
              className="w-full text-[11px] px-1"
              style={{ background: "white", border: "1px solid #c8c8c8", height: 18, outline: "none" }}>
              <option value="">— выбрать из справочника —</option>
              {PIPE_ALPHA_TYPES.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.alphaMin}–{p.alphaMax})
                </option>
              ))}
            </select>
          </InlineLabel>
        )}
        <InlineLabel label="Коэф. α, ×10⁻⁴">
          <EditInput
            type="number" step="0.05"
            value={branch.pipeAlpha ?? 9}
            onChange={(v) => {
              const a = parseFloat(v) || 0;
              // Ручная правка α — марка больше не соответствует паспорту
              onUpdate({ pipeAlpha: a, vpPipeAlpha: a, ...(duct ? { vpBrandId: "" } : {}) });
            }}
          />
        </InlineLabel>
      </>
      );
    })()}

    <InlineLabel label="Местные ξ (сумма)">
      <EditInput
        type="number" step="0.1"
        value={branch.localXi}
        onChange={(v) => onUpdate({ localXi: parseFloat(v) || 0 })}
      />
    </InlineLabel>

    <InlineLabel label="V max допустимая, м/с">
      <EditInput
        type="number" step="0.5"
        value={branch.vMax}
        onChange={(v) => onUpdate({ vMax: parseFloat(v) || 0 })}
      />
    </InlineLabel>

    <SectionHeader title="Признаки ветви" />

    <InlineLabel label="Утечка">
      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", height: 18 }}>
        <input
          type="checkbox"
          checked={branch.isLeakage ?? false}
          onChange={(e) => onUpdate({ isLeakage: e.target.checked })}
          style={{ accentColor: "#f97316", width: 13, height: 13 }}
        />
        <span style={{
          fontSize: 11,
          color: branch.isLeakage ? "#c2410c" : "#6b7280",
          fontWeight: branch.isLeakage ? 600 : 400,
        }}>
          {branch.isLeakage ? "Утечка (перемычка/целик)" : "Не утечка"}
        </span>
      </label>
    </InlineLabel>

    {branch.isLeakage && (
      <InlineLabel label="Коэф. утечки">
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number"
            min={0} max={1} step={0.01}
            value={branch.leakageCoeff ?? 0}
            onChange={(e) => onUpdate({ leakageCoeff: Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)) })}
            style={{ width: 52, height: 18, fontSize: 11, border: "1px solid #fca5a5",
              background: "white", outline: "none", textAlign: "right", paddingRight: 2 }}
          />
          <span style={{ fontSize: 10, color: "#9ca3af" }}>
            {branch.leakageCoeff > 0
              ? `${(branch.leakageCoeff * 100).toFixed(0)}% от Q`
              : "не задан"}
          </span>
        </div>
      </InlineLabel>
    )}

    <InlineLabel label="Тупик">
      <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", height: 18 }}>
        <input
          type="checkbox"
          checked={branch.isDead ?? false}
          onChange={(e) => onUpdate({ isDead: e.target.checked })}
          style={{ accentColor: "#6b7280", width: 13, height: 13 }}
        />
        <span style={{
          fontSize: 11,
          color: branch.isDead ? "#374151" : "#6b7280",
          fontWeight: branch.isDead ? 600 : 400,
        }}>
          {branch.isDead ? "Тупиковая (Q→0)" : "Сквозная"}
        </span>
      </label>
    </InlineLabel>
    {branch.isDead && (
      <div className="mx-1 mb-1 px-2 py-1 text-[10px] rounded"
        style={{ background: "#f9fafb", border: "1px solid #d1d5db", color: "#6b7280" }}>
        Расчёт задаст Q=0. Контролируется MIN_DEAD_END_FLOW = 0.5 м³/с
      </div>
    )}

    <SectionHeader title="Вычисленные параметры" />

    <ParamRow id="v_name" label="Название ветви" visible={visible.has("v_name")} onToggle={toggle}>
      <ComputedInput value={branch.type || branch.id} />
    </ParamRow>

    <ParamRow id="v_length" label="Длина ветви, м" visible={visible.has("v_length")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.length, 1)} />
    </ParamRow>

    <ParamRow id="v_angle" label="Угол наклона, °" visible={visible.has("v_angle")} onToggle={toggle}>
      <ComputedInput value={numFmt(angle, 1)} />
    </ParamRow>

    <ParamRow id="v_area" label="Попер. сечение S, м²" visible={visible.has("v_area")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.area, 2)} />
    </ParamRow>

    <ParamRow id="v_resistance" label={`Аэродин. сопр. R, ${uRes.symbol}`} visible={visible.has("v_resistance")} onToggle={toggle}>
      {(() => {
        const rAero = rToDisplay(branch.resistance);
        const rGeom = rToDisplay(branch.rFriction);
        const isWrong = branch.rFriction > 0 && branch.resistance < branch.rFriction;
        return (
          <div className="relative flex items-center flex-1">
            <ComputedInput
              value={fmtR(rAero, uRes.decimals)}
              color={isWrong ? "#dc2626" : undefined}
            />
            {isWrong && (
              <span
                title={`Ошибка: аэродинамическое сопротивление (${fmtR(rAero, 4)}) меньше геометрического (${fmtR(rGeom, 4)}). Аэродинамическое R не может быть меньше геометрического — проверьте параметры ветви.`}
                className="ml-1 cursor-help flex-shrink-0"
                style={{ fontSize: 12, color: "#dc2626" }}
              >⚠</span>
            )}
          </div>
        );
      })()}
    </ParamRow>

    <ParamRow id="v_total_r" label={`Общее сопр. R, ${uRes.symbol}`} visible={visible.has("v_total_r")} onToggle={toggle}>
      {(() => {
        // Общее R ветви = сопротивление выработки + сопротивление
        // перемычки (если установлена) + сопротивление вентилятора,
        // установленного «Внутри перемычки». Единицы: Н·с²/м⁸ (= кМюрг).
        const fanCrossingKmu = (branch.hasFan && (branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
          ? (branch.fanCrossingR ?? 0) / 1000 : 0;
        const totalNsm8 = branch.resistance + (bulkheadRKmu ?? 0) + fanCrossingKmu;
        return <ComputedInput value={fmtR(rToDisplay(totalNsm8), uRes.decimals)} />;
      })()}
    </ParamRow>

    <ParamRow id="v_geom_r" label={`Геометр. сопр. R, ${uRes.symbol}`} visible={visible.has("v_geom_r")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(branch.rFriction), uRes.decimals)} />
    </ParamRow>

    <ParamRow id="v_unit_r" label={`Ед. сопр. R(ед), ${uRes.symbol}/м`} visible={visible.has("v_unit_r")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(unitR), uRes.decimals + 1)} />
    </ParamRow>

    <ParamRow id="v_velocity" label="Скорость V, м/с" visible={visible.has("v_velocity")} onToggle={toggle}>
      <ComputedInput value={`${numFmt(branch.velocity, 2)}${branch.velocity > branch.vMax ? " ⚠" : ""}`} />
    </ParamRow>

    <ParamRow id="v_adddep" label="Доп. депрессия, Па" visible={visible.has("v_adddep")} onToggle={toggle}>
      {/* Депрессии показываем до сотых: на слабонапорных ветвях разница
          в десятых долях паскаля существенна для анализа устойчивости. */}
      <ComputedInput value={branch.hasFan ? numFmt(branch.fanPressure, 2) : "0.00"} />
    </ParamRow>

    <ParamRow id="v_flow" label="Расход Q, м³/с" visible={visible.has("v_flow")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.flow, 2)} />
    </ParamRow>

    <ParamRow id="v_dep" label="Депрессия H, Па" visible={visible.has("v_dep")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.dP, 2)} />
    </ParamRow>

    <ParamRow id="v_dep_total" label="Общая депрессия, Па" visible={visible.has("v_dep_total")} onToggle={toggle}>
      {(() => {
        // Общая депрессия = R_общее · Q² · 9,81 − H вентилятора, где
        // R_общее = выработка + перемычка/окно + окно ГВУ (та же сумма,
        // что в строке «Общее сопротивление»). Именно эта величина
        // считается решателем сети и используется в расчёте пожара.
        const fanCrossingKmu = (branch.hasFan && (branch.fanInstall ?? "Внутри перемычки") === "Внутри перемычки")
          ? (branch.fanCrossingR ?? 0) / 1000 : 0;
        const totalR = branch.resistance + (bulkheadRKmu ?? 0) + fanCrossingKmu;
        const Q = branch.flow ?? 0;
        const fanH = branch.hasFan ? (branch.fanPressure ?? 0) : 0;
        const dpTotal = totalR * Math.abs(Q) * Q * G_ACCEL - fanH;
        const hasBk = (bulkheadRKmu ?? 0) > 0;
        return (
          <div className="flex items-center flex-1 min-w-0">
            <ComputedInput value={numFmt(dpTotal, 2)} />
            {hasBk && (
              <span
                title={`Учтено сопротивление вентиляционного сооружения на ветви. Депрессия самой выработки — ${numFmt(branch.dP, 2)} Па.`}
                className="ml-1 flex-shrink-0 cursor-help"
                style={{ fontSize: 11, color: "#2563eb" }}
              >⛨</span>
            )}
          </div>
        );
      })()}
    </ParamRow>

    <ParamRow id="v_r_friction" label={`R трение, ${uRes.symbol}`} visible={visible.has("v_r_friction")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(branch.rFriction), uRes.decimals)} />
    </ParamRow>

    <ParamRow id="v_r_local" label={`R местные, ${uRes.symbol}`} visible={visible.has("v_r_local")} onToggle={toggle}>
      <ComputedInput value={fmtR(rToDisplay(branch.rLocal), uRes.decimals)} />
    </ParamRow>

    <ParamRow id="v_reynolds" label="Re (Рейнольдс), тыс." visible={visible.has("v_reynolds")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.reynolds / 1000, 1)} />
    </ParamRow>

    <ParamRow id="v_power" label="Энергозатраты N, Вт" visible={visible.has("v_power")} onToggle={toggle}>
      <ComputedInput value={numFmt(branch.power, 0)} />
    </ParamRow>
  </div>
  );
}