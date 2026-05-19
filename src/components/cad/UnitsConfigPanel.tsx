import { PHYSICAL_QUANTITIES, DEFAULT_UNITS_CONFIG, type UnitsConfig } from "@/lib/unitsConfig";

interface Props {
  unitsConfig: UnitsConfig;
  onChange: (config: UnitsConfig) => void;
}

export default function UnitsConfigPanel({ unitsConfig, onChange }: Props) {
  const handleChange = (quantityId: string, unitId: string) => {
    onChange({ ...unitsConfig, [quantityId]: unitId });
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_UNITS_CONFIG });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10">
            <tr style={{ background: "#e8eef8" }}>
              <th className="text-left px-3 py-1.5 font-semibold text-gray-700 border-b border-gray-200" style={{ width: "40%" }}>
                Физическая величина
              </th>
              <th className="text-left px-3 py-1.5 font-semibold text-gray-700 border-b border-gray-200">
                Единица измерения
              </th>
              <th className="text-center px-3 py-1.5 font-semibold text-gray-700 border-b border-gray-200" style={{ width: 80 }}>
                Символ
              </th>
            </tr>
          </thead>
          <tbody>
            {PHYSICAL_QUANTITIES.map((q, i) => {
              const selectedId = unitsConfig[q.id] ?? q.defaultUnitId;
              const selectedUnit = q.units.find(u => u.id === selectedId) ?? q.units[0];
              const isDefault = selectedId === q.defaultUnitId;
              return (
                <tr
                  key={q.id}
                  style={{ background: i % 2 === 0 ? "#ffffff" : "#f8fafd" }}
                  className="hover:bg-blue-50 transition-colors"
                >
                  <td className="px-3 py-1.5 text-gray-800 border-b border-gray-100">
                    {q.label}
                  </td>
                  <td className="px-3 py-1.5 border-b border-gray-100">
                    <select
                      value={selectedId}
                      onChange={e => handleChange(q.id, e.target.value)}
                      className="w-full text-[11px] px-1"
                      style={{
                        background: isDefault ? "white" : "#eff6ff",
                        border: `1px solid ${isDefault ? "#c8c8c8" : "#93c5fd"}`,
                        height: 20,
                        outline: "none",
                        borderRadius: 2,
                        color: isDefault ? "#374151" : "#1d4ed8",
                      }}
                    >
                      {q.units.map(u => (
                        <option key={u.id} value={u.id}>{u.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 text-center border-b border-gray-100">
                    <span className="font-mono text-[10px] text-gray-600 bg-gray-100 px-1 rounded">
                      {selectedUnit.symbol}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-200 flex-shrink-0"
        style={{ background: "#f0f0f0" }}>
        <span className="text-[10px] text-gray-400">
          Синие строки — изменены от значения по умолчанию
        </span>
        <button
          onClick={handleReset}
          className="h-6 px-3 text-[11px] border border-gray-400 rounded hover:bg-gray-200 text-gray-700"
        >
          Сбросить к умолчаниям
        </button>
      </div>
    </div>
  );
}
