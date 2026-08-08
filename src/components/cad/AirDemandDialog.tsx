// ─────────────────────────────────────────────────────────────────────────────
// AirDemandDialog — сводный расчёт количества воздуха по руднику.
// Забои сгруппированы по участкам, показаны итоги по участкам и по руднику.
// ФНиП № 505, п. 155 — позабойный расчёт с суммированием.
// ─────────────────────────────────────────────────────────────────────────────

import { Fragment, useMemo, useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch } from "@/lib/topology";
import { calcAirDemand, FACTOR_LABEL, type FaceDemand } from "@/lib/airDemand";
import { exportAirDemandXlsx } from "@/lib/airDemandExcel";
import { FACE_TYPE_LABEL, type FaceType, type VentNorms, type VentSection } from "@/lib/ventSections";

interface Props {
  branches: TopoBranch[];
  sections: VentSection[];
  norms: VentNorms;
  projectName: string;
  /** Показать выработку на схеме */
  onSelectBranch?: (id: string) => void;
  onClose: () => void;
}

export default function AirDemandDialog({
  branches, sections, norms, projectName, onSelectBranch, onClose,
}: Props) {
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [exporting, setExporting] = useState(false);

  const result = useMemo(
    () => calcAirDemand(branches, sections, norms),
    [branches, sections, norms],
  );

  const doExport = async () => {
    setExporting(true);
    try {
      await exportAirDemandXlsx(result, norms, projectName);
    } finally {
      setExporting(false);
    }
  };

  const th = (label: string, w?: number, align: "left" | "right" | "center" = "right") => (
    <th className="px-1 py-1 font-medium text-gray-600 sticky top-0"
      style={{
        border: "1px solid #d1d5db", background: "#eef2f7",
        textAlign: align, width: w, fontSize: 10, whiteSpace: "nowrap", zIndex: 1,
      }}>
      {label}
    </th>
  );

  const FaceRow = ({ f }: { f: FaceDemand }) => {
    const ok = f.flowOk && f.velocityOk;
    const cell = (v: React.ReactNode, align: "left" | "right" | "center" = "right", extra?: React.CSSProperties) => (
      <td className="px-1 py-0.5" style={{ border: "1px solid #e5e7eb", textAlign: align, ...extra }}>{v}</td>
    );
    const num = (v: number) => (v > 0 ? v.toFixed(2) : "—");
    const hl = (active: boolean): React.CSSProperties => active
      ? { background: "#eff6ff", color: "#1d4ed8", fontWeight: 700 }
      : {};

    return (
      <tr className="hover:bg-gray-50">
        {cell(
          <button onClick={() => onSelectBranch?.(f.branchId)}
            className="text-blue-600 hover:underline" title="Показать на схеме">
            {f.branchId}
          </button>, "center")}
        {cell(<span title={f.name}>{f.name}</span>, "left")}
        {cell(FACE_TYPE_LABEL[f.faceType as FaceType] ?? f.faceType, "left", { color: "#6b7280" })}
        {cell(f.area.toFixed(1))}
        {cell(num(f.byPeople), "right", hl(f.factor === "people"))}
        {cell(num(f.byBlast), "right", hl(f.factor === "blast"))}
        {cell(num(f.byDiesel), "right", hl(f.factor === "diesel"))}
        {cell(num(f.byVMin), "right", hl(f.factor === "vmin"))}
        {cell(<span style={{ color: "#1d4ed8" }}>{FACTOR_LABEL[f.factor]}</span>, "left")}
        {cell(<b>{f.total > 0 ? f.total.toFixed(2) : "—"}</b>)}
        {cell(<span style={{ color: f.flowOk ? "#15803d" : "#dc2626", fontWeight: 600 }}>
          {f.actualFlow.toFixed(2)}
        </span>)}
        {cell(<span style={{ color: f.velocityOk ? "#15803d" : "#dc2626" }} title={`Допустимо ${f.vMin}–${f.vMax} м/с`}>
          {f.actualVelocity.toFixed(2)}
        </span>)}
        {cell(
          <span style={{ color: ok ? "#15803d" : "#b91c1c", fontWeight: ok ? 400 : 600 }}
            title={f.recommendation}>
            {f.verdict}
          </span>, "left")}
      </tr>
    );
  };

  const filterFaces = (list: FaceDemand[]) =>
    onlyFailed ? list.filter(f => !(f.flowOk && f.velocityOk)) : list;

  const COLSPAN = 13;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-10"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: "min(1360px, 96vw)", maxHeight: "88vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <div className="flex items-center gap-2">
            <Icon name="Calculator" size={15} className="text-blue-700" />
            <span className="text-[13px] font-semibold text-gray-800">
              Расчёт количества воздуха по руднику
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={onlyFailed} onChange={e => setOnlyFailed(e.target.checked)} />
              Только проблемные
            </label>
            <button onClick={doExport} disabled={exporting || !!result.error}
              className="text-[11px] px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 flex items-center gap-1 disabled:opacity-40">
              <Icon name="Download" size={11} /> {exporting ? "Выгрузка…" : "Excel"}
            </button>
            <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
              <Icon name="X" size={15} className="text-gray-600" />
            </button>
          </div>
        </div>

        {result.error ? (
          <div className="px-6 py-10 text-center">
            <Icon name="Info" size={22} className="text-gray-300 mx-auto mb-2" />
            <div className="text-[12px] text-gray-500 leading-relaxed max-w-lg mx-auto">
              {result.error}
            </div>
          </div>
        ) : (<>
          {/* Сводка */}
          <div className="flex items-stretch gap-0 flex-shrink-0"
            style={{ borderBottom: "1px solid #e0e4ee", background: "#f8fafc" }}>
            {[
              { label: "Забоев в расчёте", value: String(result.faces.length), color: "#0f172a" },
              { label: "Участков", value: String(result.sections.length), color: "#0f172a" },
              { label: "Потребность, м³/с", value: result.totalDemand.toFixed(2), color: "#1d4ed8" },
              { label: "Фактически, м³/с", value: result.totalActual.toFixed(2),
                color: result.totalActual >= result.totalDemand ? "#15803d" : "#dc2626" },
              { label: "Не обеспечено забоев", value: String(result.failedCount),
                color: result.failedCount > 0 ? "#dc2626" : "#15803d" },
            ].map((c, i) => (
              <div key={i} className="px-4 py-2" style={{ borderRight: i < 4 ? "1px solid #e6eaf2" : undefined }}>
                <div className="text-[9px] text-gray-500 uppercase tracking-wide">{c.label}</div>
                <div className="text-[15px] font-bold tabular-nums" style={{ color: c.color }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* Таблица */}
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  {th("Выраб.", 60, "center")}
                  {th("Наименование забоя", 150, "left")}
                  {th("Тип забоя", 130, "left")}
                  {th("S, м²", 50)}
                  {th("Люди", 56)}
                  {th("Газы ВР", 62)}
                  {th("Дизель", 58)}
                  {th("v_min", 54)}
                  {th("Определяющий", 110, "left")}
                  {th("Потребн.", 66)}
                  {th("Факт.", 62)}
                  {th("v, м/с", 54)}
                  {th("Заключение", 160, "left")}
                </tr>
                <tr>
                  <th colSpan={4} style={{ border: "1px solid #d1d5db", background: "#f6f8fb" }} />
                  <th colSpan={4} className="px-1 font-normal text-gray-400"
                    style={{ border: "1px solid #d1d5db", background: "#f6f8fb", fontSize: 9 }}>
                    потребность по факторам, м³/с
                  </th>
                  <th colSpan={5} style={{ border: "1px solid #d1d5db", background: "#f6f8fb" }} />
                </tr>
              </thead>
              <tbody>
                {result.sections.map(sec => {
                  const list = filterFaces(sec.faces);
                  if (list.length === 0) return null;
                  return (
                    <Fragment key={sec.sectionId}>
                      <tr>
                        <td colSpan={COLSPAN} className="px-2 py-1"
                          style={{ border: "1px solid #d1d5db", background: "#dbeafe" }}>
                          <div className="flex items-center gap-2">
                            <span style={{ width: 9, height: 9, borderRadius: 2, background: sec.color }} />
                            <b className="text-[11px]">
                              Участок {sec.number ? `${sec.number}. ` : ""}{sec.name}
                            </b>
                            {sec.isReserve && <span className="text-[10px] text-gray-500">резервный</span>}
                            <span className="text-[10px] text-gray-500">· забоев: {sec.faces.length}</span>
                          </div>
                        </td>
                      </tr>
                      {list.map(f => <FaceRow key={f.branchId} f={f} />)}
                      <tr>
                        <td colSpan={9} className="px-2 py-0.5 text-right font-semibold text-[11px]"
                          style={{ border: "1px solid #e5e7eb", background: "#f1f5f9" }}>
                          Итого по участку:
                        </td>
                        <td className="px-1 py-0.5 text-right font-bold"
                          style={{ border: "1px solid #e5e7eb", background: "#f1f5f9" }}>
                          {sec.total.toFixed(2)}
                        </td>
                        <td className="px-1 py-0.5 text-right font-bold"
                          style={{ border: "1px solid #e5e7eb", background: "#f1f5f9",
                            color: sec.ok ? "#15803d" : "#dc2626" }}>
                          {sec.actual.toFixed(2)}
                        </td>
                        <td style={{ border: "1px solid #e5e7eb", background: "#f1f5f9" }} />
                        <td className="px-1 py-0.5 text-[10px] font-semibold"
                          style={{ border: "1px solid #e5e7eb", background: "#f1f5f9",
                            color: sec.ok ? "#15803d" : "#b91c1c" }}>
                          {sec.ok ? "обеспечено" : `не обеспечено: ${sec.failed}`}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}

                {/* Забои вне участков */}
                {(() => {
                  const list = filterFaces(result.unassigned);
                  if (list.length === 0) return null;
                  return (
                    <>
                      <tr>
                        <td colSpan={COLSPAN} className="px-2 py-1"
                          style={{ border: "1px solid #d1d5db", background: "#fef3c7" }}>
                          <b className="text-[11px]">Забои вне участков</b>
                          <span className="text-[10px] text-gray-600 pl-2">
                            отнесите их к участкам, чтобы получить итоги по участкам
                          </span>
                        </td>
                      </tr>
                      {list.map(f => <FaceRow key={f.branchId} f={f} />)}
                    </>
                  );
                })()}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={9} className="px-2 py-1.5 text-right font-bold text-[12px]"
                    style={{ border: "1px solid #1e3a5f", background: "#1e3a5f", color: "white" }}>
                    ВСЕГО ПО РУДНИКУ:
                  </td>
                  <td className="px-1 py-1.5 text-right font-bold text-[12px]"
                    style={{ border: "1px solid #1e3a5f", background: "#1e3a5f", color: "white" }}>
                    {result.totalDemand.toFixed(2)}
                  </td>
                  <td className="px-1 py-1.5 text-right font-bold text-[12px]"
                    style={{ border: "1px solid #1e3a5f", background: "#1e3a5f", color: "white" }}>
                    {result.totalActual.toFixed(2)}
                  </td>
                  <td style={{ border: "1px solid #1e3a5f", background: "#1e3a5f" }} />
                  <td className="px-1 py-1.5 text-[10px] font-semibold"
                    style={{ border: "1px solid #1e3a5f", background: "#1e3a5f",
                      color: result.failedCount > 0 ? "#fca5a5" : "#86efac" }}>
                    {result.failedCount > 0
                      ? `Не обеспечено: ${result.failedCount}`
                      : "Все забои обеспечены"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="px-4 py-1.5 text-[9px] text-gray-400 leading-snug flex-shrink-0"
            style={{ borderTop: "1px solid #e6eaf2", background: "#fafbfd" }}>
            Потребность = максимум по факторам × коэф. запаса × коэф. утечек.
            Синим выделен определяющий фактор. «Факт.» — расход по результатам расчёта сети.
            ФНиП № 505, п. 155.
          </div>
        </>)}
      </div>
    </div>
  );
}