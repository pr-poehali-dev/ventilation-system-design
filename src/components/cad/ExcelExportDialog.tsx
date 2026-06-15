import { useState, useMemo } from "react";
import Icon from "@/components/ui/icon";
import type { TopoBranch, TopoNode, Horizon } from "@/lib/topology";
import {
  BRANCH_COLUMNS,
  NODE_COLUMNS,
  BRANCH_PRESETS,
  PRESET_LABELS,
  exportToExcel,
  type ExportAreaId,
  type ExportType,
  type ExportPreset,
} from "@/lib/excelExport";

interface Props {
  branches: TopoBranch[];
  nodes: TopoNode[];
  horizons: Horizon[];
  projectName?: string;
  onClose: () => void;
}

export default function ExcelExportDialog({ branches, nodes, horizons, projectName = "ПВ-Система", onClose }: Props) {
  const [areaId, setAreaId]   = useState<ExportAreaId>("all");
  const [type, setType]       = useState<ExportType>("branches");
  const [preset, setPreset]   = useState<ExportPreset>("custom");
  const [customKeys, setCustomKeys] = useState<Set<string>>(() => new Set(
    BRANCH_COLUMNS.map(c => c.key)
  ));

  const allColumns = type === "branches" ? BRANCH_COLUMNS : NODE_COLUMNS;

  // Сгруппировать колонки по group
  const groups = useMemo(() => {
    const map = new Map<string, typeof allColumns>();
    allColumns.forEach(c => {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    });
    return map;
  }, [allColumns]);

  // При смене пресета — обновить набор ключей
  function applyPreset(p: ExportPreset) {
    setPreset(p);
    if (type === "branches" && p !== "custom") {
      setCustomKeys(new Set(BRANCH_PRESETS[p]));
    } else if (p === "all") {
      setCustomKeys(new Set(allColumns.map(c => c.key)));
    }
  }

  // При смене типа — сбросить набор
  function changeType(t: ExportType) {
    setType(t);
    setPreset("all");
    const cols = t === "branches" ? BRANCH_COLUMNS : NODE_COLUMNS;
    setCustomKeys(new Set(cols.map(c => c.key)));
  }

  function toggleKey(key: string) {
    setCustomKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setPreset("custom");
  }

  function toggleGroup(keys: string[]) {
    const allOn = keys.every(k => customKeys.has(k));
    setCustomKeys(prev => {
      const next = new Set(prev);
      if (allOn) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
    setPreset("custom");
  }

  function handleExport() {
    exportToExcel({
      areaId,
      type,
      selectedKeys: Array.from(customKeys),
      branches,
      nodes,
      horizons,
      projectName,
    });
    onClose();
  }

  const presetList: ExportPreset[] = type === "branches"
    ? ["all","depressions","flows","main_vent","speed_check","stability","objects","waterpipes","custom"]
    : ["all","custom"];

  const selectedCount = customKeys.size;
  const totalCount = allColumns.length;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16"
      style={{ background: "rgba(0,0,0,0.35)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div className="bg-white rounded shadow-2xl flex flex-col"
        style={{ width: 520, maxHeight: "80vh", border: "1px solid #b0b8cc" }}>

        {/* Заголовок */}
        <div className="flex items-center justify-between px-4 py-2.5"
          style={{ background: "#e8edf5", borderBottom: "1px solid #c0cad8" }}>
          <span className="text-[13px] font-semibold text-gray-800">Экспорт параметров выработок</span>
          <button onClick={onClose} className="hover:bg-black/10 rounded p-0.5">
            <Icon name="X" size={15} className="text-gray-600" />
          </button>
        </div>

        {/* Фильтры */}
        <div className="px-4 pt-3 pb-2 space-y-2" style={{ borderBottom: "1px solid #e0e4ee" }}>
          {/* Область */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 w-16 flex-shrink-0">Область:</span>
            <select
              value={areaId}
              onChange={e => setAreaId(e.target.value as ExportAreaId)}
              className="flex-1 text-[12px] border border-gray-300 rounded px-2 py-1"
              style={{ background: "white" }}>
              <option value="all">Все</option>
              {horizons.map(h => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>

          {/* Тип */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 w-16 flex-shrink-0">Тип:</span>
            <select
              value={type}
              onChange={e => changeType(e.target.value as ExportType)}
              className="flex-1 text-[12px] border border-gray-300 rounded px-2 py-1"
              style={{ background: "white" }}>
              <option value="branches">Выработки</option>
              <option value="nodes">Конечные вершины</option>
            </select>
          </div>

          {/* Пресет */}
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-gray-600 w-16 flex-shrink-0"></span>
            <select
              value={preset}
              onChange={e => applyPreset(e.target.value as ExportPreset)}
              className="flex-1 text-[12px] border border-gray-300 rounded px-2 py-1"
              style={{ background: "white" }}>
              {presetList.map(p => (
                <option key={p} value={p}>{PRESET_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Список параметров */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {/* Шапка со сводкой */}
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-[10px] text-gray-500">{selectedCount} из {totalCount} параметров</span>
            <div className="flex gap-2">
              <button
                className="text-[10px] text-blue-600 hover:underline"
                onClick={() => { setCustomKeys(new Set(allColumns.map(c => c.key))); setPreset("all"); }}>
                Выбрать все
              </button>
              <button
                className="text-[10px] text-gray-400 hover:underline"
                onClick={() => { setCustomKeys(new Set()); setPreset("custom"); }}>
                Снять все
              </button>
            </div>
          </div>

          {/* Группы и чекбоксы */}
          {Array.from(groups.entries()).map(([groupName, cols]) => {
            const groupKeys = cols.map(c => c.key);
            const allOn = groupKeys.every(k => customKeys.has(k));
            const someOn = groupKeys.some(k => customKeys.has(k));
            return (
              <div key={groupName} className="mb-1">
                {/* Заголовок группы */}
                <div className="flex items-center gap-2 py-0.5 px-1 cursor-pointer select-none"
                  style={{ borderBottom: "1px solid #e5e9f0" }}
                  onClick={() => toggleGroup(groupKeys)}>
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                    readOnly
                    style={{ width: 12, height: 12, accentColor: "#2563eb", cursor: "pointer" }} />
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{groupName}</span>
                </div>
                {/* Колонки группы */}
                <div className="pt-0.5">
                  {cols.map(col => (
                    <label key={col.key}
                      className="flex items-center gap-2 py-0.5 px-2 cursor-pointer hover:bg-blue-50 rounded">
                      <input
                        type="checkbox"
                        checked={customKeys.has(col.key)}
                        onChange={() => toggleKey(col.key)}
                        style={{ width: 12, height: 12, accentColor: "#2563eb", cursor: "pointer", flexShrink: 0 }} />
                      <span className="text-[11px] text-gray-700 leading-tight">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Кнопки */}
        <div className="flex items-center justify-end gap-2 px-4 py-2.5"
          style={{ borderTop: "1px solid #d8dde8", background: "#f5f7fc" }}>
          <span className="text-[10px] text-gray-400 mr-auto">
            {type === "branches"
              ? `${areaId === "all" ? branches.length : branches.filter(b => b.horizonId === areaId).length} выработок`
              : `${nodes.filter(n => !n.atmosphereLink).length} вершин`}
          </span>
          <button onClick={onClose}
            className="px-4 py-1.5 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
            Закрыть
          </button>
          <button
            onClick={handleExport}
            disabled={selectedCount === 0}
            className="px-5 py-1.5 text-[12px] rounded text-white disabled:opacity-40"
            style={{ background: "#2563eb" }}>
            <span className="flex items-center gap-1.5">
              <Icon name="Download" size={13} />
              Экспорт
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
