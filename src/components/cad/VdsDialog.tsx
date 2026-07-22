// ─────────────────────────────────────────────────────────────────────────────
// VdsDialog — «ВДС» (воздушно-депрессионная съёмка).
// Пока содержит один расчёт: эквивалентное отверстие шахты в зависимости от
// количества ГВУ (главных вентиляторных установок) — формулы (24) и (25).
//
//   Для одного ГВУ (24):   A_ш = 0.38 * Q / sqrt(H)
//   Для нескольких ГВУ (25):
//                          A_общ = 0.38 * Σ Q_i / sqrt( Σ (h_i * Q_i) / Σ Q_i )
//
//   Q — подача воздуха ГВУ, м³/с;  H (h) — депрессия ГВУ, даПа.
//
// Классификация шахт по эквивалентному отверстию:
//   до 1 м²          — труднопроветриваемые
//   от 1 до 2 м²     — средней трудности
//   свыше 2 м²       — легкопроветриваемые
//
// Диалог спроектирован как контейнер с секциями расчётов — позже сюда можно
// добавлять другие расчёты по схеме (каждый в свой блок).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Icon from "@/components/ui/icon";

interface Props {
  onClose: () => void;
}

interface GvuRow {
  id: number;
  name: string;
  q: string; // подача воздуха, м³/с
  h: string; // депрессия, даПа
}

let nextId = 1;
function newRow(name = ""): GvuRow {
  return { id: nextId++, name, q: "", h: "" };
}

function num(s: string): number {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function classify(a: number): { label: string; color: string } {
  if (a <= 0) return { label: "—", color: "#6b7280" };
  if (a < 1) return { label: "Труднопроветриваемая", color: "#dc2626" };
  if (a <= 2) return { label: "Средней трудности проветривания", color: "#d97706" };
  return { label: "Легкопроветриваемая", color: "#16a34a" };
}

export default function VdsDialog({ onClose }: Props) {
  const [rows, setRows] = useState<GvuRow[]>(() => [newRow("ГВУ-1")]);

  function updateRow(id: number, patch: Partial<GvuRow>) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows(rs => [...rs, newRow(`ГВУ-${rs.length + 1}`)]);
  }
  function removeRow(id: number) {
    setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : rs));
  }

  const calc = useMemo(() => {
    // Учитываем только строки с положительными Q и H.
    const valid = rows
      .map(r => ({ q: num(r.q), h: num(r.h) }))
      .filter(r => r.q > 0 && r.h > 0);

    const sumQ = valid.reduce((s, r) => s + r.q, 0);
    const sumHQ = valid.reduce((s, r) => s + r.h * r.q, 0);

    let A = 0;
    let Havg = 0; // эквивалентная депрессия шахты
    if (valid.length === 1) {
      // формула (24)
      A = (0.38 * valid[0].q) / Math.sqrt(valid[0].h);
      Havg = valid[0].h;
    } else if (valid.length > 1 && sumQ > 0) {
      // формула (25)
      Havg = sumHQ / sumQ;
      A = (0.38 * sumQ) / Math.sqrt(Havg);
    }
    return { count: valid.length, sumQ, Havg, A, formula: valid.length <= 1 ? "(24)" : "(25)" };
  }, [rows]);

  const cls = classify(calc.A);

  const inputCls =
    "w-full px-2 py-1 text-[12px] border border-gray-300 rounded outline-none focus:border-blue-500";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-16"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 640, maxHeight: "82vh", border: "1px solid #b0b8cc" }}
      >
        {/* Заголовок */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}
        >
          <span className="text-[13px] font-semibold text-gray-800 flex items-center gap-2">
            <Icon name="Gauge" size={16} />
            ВДС — воздушно-депрессионная съёмка
          </span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 transition-colors"
            title="Закрыть"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3" style={{ flex: 1 }}>
          {/* ── Секция: Эквивалентное отверстие шахты ── */}
          <div className="mb-2">
            <div className="text-[13px] font-semibold text-gray-800">
              Эквивалентное отверстие шахты
            </div>
            <div className="text-[11px] text-gray-500 leading-snug">
              Расчёт по числу ГВУ: при одной установке — формула (24), при
              нескольких — формула (25). Q — подача воздуха ГВУ (м³/с), H —
              депрессия ГВУ (даПа).
            </div>
          </div>

          {/* Таблица ГВУ */}
          <table className="w-full text-[12px] border-collapse mb-2">
            <thead>
              <tr className="text-gray-600" style={{ background: "#f1f4f9" }}>
                <th className="text-left font-medium px-2 py-1 border border-gray-200 w-8">№</th>
                <th className="text-left font-medium px-2 py-1 border border-gray-200">ГВУ</th>
                <th className="text-left font-medium px-2 py-1 border border-gray-200">Q, м³/с</th>
                <th className="text-left font-medium px-2 py-1 border border-gray-200">H, даПа</th>
                <th className="text-center font-medium px-2 py-1 border border-gray-200 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="px-2 py-1 border border-gray-200 text-gray-500 text-center">{i + 1}</td>
                  <td className="px-1 py-1 border border-gray-200">
                    <input
                      className={inputCls}
                      value={r.name}
                      placeholder={`ГВУ-${i + 1}`}
                      onChange={e => updateRow(r.id, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 border border-gray-200">
                    <input
                      className={inputCls}
                      value={r.q}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={e => updateRow(r.id, { q: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 border border-gray-200">
                    <input
                      className={inputCls}
                      value={r.h}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={e => updateRow(r.id, { h: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 border border-gray-200 text-center">
                    <button
                      onClick={() => removeRow(r.id)}
                      disabled={rows.length <= 1}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400"
                      title="Удалить ГВУ"
                    >
                      <Icon name="Trash2" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={addRow}
            className="text-[12px] text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-3"
          >
            <Icon name="Plus" size={14} /> Добавить ГВУ
          </button>

          {/* Результат */}
          <div
            className="rounded p-3"
            style={{ background: "#f7f9fc", border: "1px solid #dde3ec" }}
          >
            <div className="grid grid-cols-2 gap-y-1.5 text-[12px]">
              <span className="text-gray-600">Учтено ГВУ:</span>
              <span className="text-gray-900 font-medium">{calc.count}</span>

              <span className="text-gray-600">Суммарная подача ΣQ:</span>
              <span className="text-gray-900 font-medium">
                {calc.sumQ ? calc.sumQ.toFixed(2) : "—"} м³/с
              </span>

              <span className="text-gray-600">Эквивалентная депрессия H:</span>
              <span className="text-gray-900 font-medium">
                {calc.Havg ? calc.Havg.toFixed(2) : "—"} даПа
              </span>

              <span className="text-gray-600">Формула:</span>
              <span className="text-gray-900 font-medium">{calc.formula}</span>
            </div>

            <div className="mt-2 pt-2 flex items-baseline gap-2" style={{ borderTop: "1px solid #dde3ec" }}>
              <span className="text-[13px] text-gray-700 font-semibold">
                Эквивалентное отверстие A:
              </span>
              <span className="text-[18px] font-bold text-blue-700">
                {calc.A ? calc.A.toFixed(3) : "—"}
              </span>
              <span className="text-[13px] text-gray-600">м²</span>
            </div>

            <div className="mt-1 text-[12px]">
              <span className="text-gray-600">Категория: </span>
              <span className="font-semibold" style={{ color: cls.color }}>
                {cls.label}
              </span>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-gray-400 leading-snug">
            Классификация действительна при отсутствии активной аэродинамической
            связи выработок с выработанным пространством.
          </div>
        </div>

        {/* Футер */}
        <div
          className="flex items-center justify-end gap-2 px-4 py-2.5"
          style={{ background: "#f1f4f9", borderTop: "1px solid #c0cad8" }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
