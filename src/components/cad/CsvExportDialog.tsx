import { useState } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode } from "@/lib/topology";
import type { Position } from "@/lib/positions";
import {
  buildCsv,
  downloadCsv,
  buildVent2Files,
  downloadVent2Zip,
  DEFAULT_CSV_FIELDS,
  DEFAULT_CSV_UNITS,
  type CsvExportSchema,
  type CsvSep,
  type CsvDecimal,
  type CsvExportFields,
  type CsvExportUnits,
} from "@/lib/csvExport";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  positions: Position[];
  projectName?: string;
  onClose: () => void;
}

// ── Чекбокс с подписью и порядковым номером столбца ──────────────────────────
function Chk({ label, order, checked, onChange, disabled }: {
  label: string; order?: number; checked: boolean; onChange: () => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-1.5 py-0.5 select-none ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange}
        className="w-3.5 h-3.5 accent-blue-600" />
      <span className="text-[12px] text-gray-700">{label}</span>
      {order !== undefined && <span className="text-[11px] text-blue-600">({order})</span>}
    </label>
  );
}

// ── Диалог единиц измерения ──────────────────────────────────────────────────
function UnitsDialog({ units, onSave, onCancel }: {
  units: CsvExportUnits; onSave: (u: CsvExportUnits) => void; onCancel: () => void;
}) {
  const [res, setRes] = useState<"kmu" | "si">(units.resistanceUnit);
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-gray-700 flex-shrink-0" style={{ width: 120 }}>{label}</span>
      {children}
    </div>
  );
  const fixedSelect = (val: string) => (
    <select value={val} disabled className="flex-1 text-[12px] px-1 py-0.5 border rounded bg-gray-100 text-gray-500"
      style={{ borderColor: "#d1d5db" }}>
      <option>{val}</option>
    </select>
  );
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white rounded shadow-2xl" style={{ width: 420, border: "1px solid #b0b8cc" }}>
        <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">Единицы измерения</span>
          <button onClick={onCancel} className="hover:bg-black/10 rounded p-0.5"><Icon name="X" size={15} className="text-gray-600" /></button>
        </div>
        <div className="px-4 py-3">
          <div className="text-[12px] font-semibold text-gray-600 mb-1">Конечные вершины</div>
          <Row label="Координаты:">{fixedSelect("Метр")}</Row>
          <div className="text-[12px] font-semibold text-gray-600 mb-1 mt-2">Выработки</div>
          <Row label="Длина:">{fixedSelect("Метр")}</Row>
          <Row label="Сечение:">{fixedSelect("Метр квадратный")}</Row>
          <Row label="Периметр:">{fixedSelect("Метр")}</Row>
          <Row label="Расход:">{fixedSelect("Метр кубический в секунду")}</Row>
          <Row label="Сопротивление:">
            <select value={res} onChange={e => setRes(e.target.value as "kmu" | "si")}
              className="flex-1 text-[12px] px-1 py-0.5 border rounded bg-white" style={{ borderColor: "#d1d5db" }}>
              <option value="kmu">Киломюрг</option>
              <option value="si">Н·с²/м⁸ (СИ)</option>
            </select>
          </Row>
          <Row label="Напор венти-ра:">{fixedSelect("Паскаль")}</Row>
        </div>
        <div className="flex justify-end gap-2 px-4 py-2.5" style={{ borderTop: "1px solid #e0e4ee" }}>
          <button onClick={() => onSave({ ...units, resistanceUnit: res })}
            className="text-[12px] px-4 py-1 rounded text-white" style={{ background: "#2563eb" }}>Сохранить</button>
          <button onClick={onCancel} className="text-[12px] px-4 py-1 rounded border" style={{ borderColor: "#c8c8c8" }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

export default function CsvExportDialog({ branches, nodes, positions, projectName = "ПВ-Система", onClose }: Props) {
  const [schema, setSchema] = useState<CsvExportSchema>("vent2");
  const [sep, setSep] = useState<CsvSep>(";");
  const [decimal, setDecimal] = useState<CsvDecimal>(",");
  const [fields, setFields] = useState<CsvExportFields>({ ...DEFAULT_CSV_FIELDS });
  const [units, setUnits] = useState<CsvExportUnits>({ ...DEFAULT_CSV_UNITS });
  const [showUnits, setShowUnits] = useState(false);

  const set = <K extends keyof CsvExportFields>(k: K) =>
    setFields(prev => ({ ...prev, [k]: !prev[k] }));

  function handleExport() {
    if (schema === "vent2") {
      // «Вентиляция 2.0» — 5 отдельных файлов в ZIP-архиве.
      const files = buildVent2Files(nodes, branches, positions, units);
      void downloadVent2Zip(files, `${projectName}_vent2`);
      onClose();
      return;
    }
    const csv = buildCsv(nodes, branches, positions, { schema, sep, decimal, fields, units });
    downloadCsv(csv, `${projectName}_aeroset.csv`);
    onClose();
  }

  const sepLabel = (s: CsvSep) => s === ";" ? ";" : s === "," ? "," : "Tab";

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-10" style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded shadow-2xl flex flex-col" style={{ width: 640, maxHeight: "88vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">Экспорт в CSV</span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5"><Icon name="X" size={15} className="text-gray-600" /></button>
        </div>

        {/* Схема + разделитель */}
        <div className="flex items-center gap-4 px-4 py-2.5" style={{ borderBottom: "1px solid #e0e4ee" }}>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-700">Схема:</span>
            <select value={schema} onChange={e => setSchema(e.target.value as CsvExportSchema)}
              className="text-[12px] px-2 py-0.5 border rounded bg-white" style={{ borderColor: "#d1d5db" }}>
              <option value="vent2">Вентиляция 2.0</option>
              <option value="aeroset">АэроСеть</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-700">Разделитель:</span>
            <select value={schema === "vent2" ? "," : sep} disabled={schema === "vent2"} onChange={e => setSep(e.target.value as CsvSep)}
              className="text-[12px] px-2 py-0.5 border rounded bg-white disabled:bg-gray-100 disabled:text-gray-400" style={{ borderColor: "#d1d5db", width: 56 }}>
              {([";", ",", "\t"] as CsvSep[]).map(s => <option key={s} value={s}>{sepLabel(s)}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-gray-500">дробная часть:</span>
            <select value={schema === "vent2" ? "." : decimal} disabled={schema === "vent2"} onChange={e => setDecimal(e.target.value as CsvDecimal)}
              className="text-[12px] px-2 py-0.5 border rounded bg-white disabled:bg-gray-100 disabled:text-gray-400" style={{ borderColor: "#d1d5db", width: 56 }}>
              <option value=",">,</option>
              <option value=".">.</option>
            </select>
          </div>
        </div>

        {schema === "vent2" && (
          <div className="px-4 py-1.5 text-[11px] text-gray-500 flex items-center gap-1.5" style={{ background: "#f5f8ff", borderBottom: "1px solid #e0e4ee" }}>
            <Icon name="Info" size={13} className="text-blue-500 flex-shrink-0" />
            <span>Выгружается ZIP-архив из 5 файлов: nodes.csv, links.csv, jumpers.csv, fans.csv, positions.csv. Формат фиксирован (разделитель «,», точка).</span>
          </div>
        )}

        {/* Тело — прокрутка */}
        <div className="overflow-y-auto px-4 py-3 space-y-3">

          {/* Вершины */}
          <div className="rounded border px-3 py-2" style={{ borderColor: "#e0e4ee" }}>
            <div className="text-[12px] text-gray-600 mb-1">Вершины — экспортируемые свойства (порядок компоновки):</div>
            <div className="grid grid-cols-2 gap-x-6">
              <Chk label="Ид вершины:" order={1} checked={fields.nodeId} onChange={() => set("nodeId")} />
              <Chk label="Атмосфера (Да/Нет)" order={5} checked={fields.nodeAtm} onChange={() => set("nodeAtm")} />
              <div className="col-span-2 text-[12px] text-gray-500 mt-1">Координаты</div>
              <Chk label="X" order={2} checked={fields.nodeX} onChange={() => set("nodeX")} />
              <span />
              <Chk label="Y" order={3} checked={fields.nodeY} onChange={() => set("nodeY")} />
              <span />
              <Chk label="Z" order={4} checked={fields.nodeZ} onChange={() => set("nodeZ")} />
            </div>
          </div>

          {/* Выработки */}
          <div className="rounded border px-3 py-2" style={{ borderColor: "#e0e4ee" }}>
            <div className="text-[12px] text-gray-600 mb-1">Выработки — экспортируемые свойства (порядок компоновки):</div>
            <div className="grid grid-cols-2 gap-x-6">
              <Chk label="Ид выработки" order={1} checked={fields.brId} onChange={() => set("brId")} />
              <Chk label="Сечение" order={7} checked={fields.brArea} onChange={() => set("brArea")} />
              <Chk label="Начальная вершина" order={2} checked={fields.brFrom} onChange={() => set("brFrom")} />
              <Chk label="Периметр" order={8} checked={fields.brPerimeter} onChange={() => set("brPerimeter")} />
              <Chk label="Конечная вершина" order={3} checked={fields.brTo} onChange={() => set("brTo")} />
              <Chk label="Расход" order={9} checked={fields.brFlow} onChange={() => set("brFlow")} />
              <Chk label="Название" order={4} checked={fields.brName} onChange={() => set("brName")} />
              <Chk label="Сопротивление" order={10} checked={fields.brResistance} onChange={() => set("brResistance")} />
              <Chk label="Длина" order={5} checked={fields.brLength} onChange={() => set("brLength")} />
              <Chk label="Слой" order={11} checked={fields.brLayer} onChange={() => set("brLayer")} />
              <Chk label="Тип" order={6} checked={fields.brType} onChange={() => set("brType")} />
              <Chk label="Ид позиции" order={12} checked={fields.brPositionId} onChange={() => set("brPositionId")} />
            </div>
          </div>

          {/* Позиции */}
          <div className="rounded border px-3 py-2" style={{ borderColor: "#e0e4ee" }}>
            <Chk label="Позиции — экспортируемые свойства" checked={fields.exportPositions} onChange={() => set("exportPositions")} />
            <div className="text-[11px] text-gray-400 mt-0.5 ml-5">ID; X; Y; Z; Номер; Название; Тип позиции; Цвет границы</div>
          </div>

          {/* Перемычки */}
          <div className="rounded border px-3 py-2" style={{ borderColor: "#e0e4ee" }}>
            <Chk label="Перемычки — экспортируемые свойства" checked={fields.exportBulkheads} onChange={() => set("exportBulkheads")} />
            <div className="text-[11px] text-gray-400 mt-0.5 ml-5">Ид выработки; Смещение %; Тип перемычки; Сопротивление</div>
          </div>

          {/* Источники тяги */}
          <div className="rounded border px-3 py-2" style={{ borderColor: "#e0e4ee" }}>
            <Chk label="Источники тяги — экспортируемые свойства" checked={fields.exportFans} onChange={() => set("exportFans")} />
            <div className="text-[11px] text-gray-400 mt-0.5 ml-5">Ид выработки; Смещение %; Напор</div>
          </div>
        </div>

        {/* Футер */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid #e0e4ee" }}>
          <button onClick={() => setShowUnits(true)} className="text-[12px] px-3 py-1 rounded border" style={{ borderColor: "#c8c8c8" }}>
            Единицы измерения
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400 mr-1">узлов {nodes.length} · ветвей {branches.length}</span>
            <button onClick={handleExport} className="text-[12px] px-4 py-1 rounded text-white" style={{ background: "#2563eb" }}>{schema === "vent2" ? "Экспорт (ZIP)" : "Экспорт"}</button>
            <button onClick={onClose} className="text-[12px] px-4 py-1 rounded border" style={{ borderColor: "#c8c8c8" }}>Отмена</button>
          </div>
        </div>
      </div>

      {showUnits && (
        <UnitsDialog units={units} onSave={u => { setUnits(u); setShowUnits(false); }} onCancel={() => setShowUnits(false)} />
      )}
    </div>
  );
}