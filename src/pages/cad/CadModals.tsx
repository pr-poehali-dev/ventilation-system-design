// ─────────────────────────────────────────────────────────────────────────────
// CadModals — presentational-обёртка над модальными окнами с инлайновым JSX:
// настройки пределов масштабов, объединение ветвей при удалении узла, число
// людей в отделении, подтверждение закрытия, «О программе», сравнение схем.
// Логика/состояние остаются в CadPage. Поведение 1:1 с исходником.
// ─────────────────────────────────────────────────────────────────────────────
import type React from "react";
import Icon from "@/components/ui/icon";
import AppLogo from "@/components/AppLogo";
import UpdateCheckButton from "@/components/cad/UpdateCheckButton";
import { APP_VERSION, APP_BUILD_DATE } from "@/lib/appVersion";
import { compareBranches, compareNodes } from "./cadUtils";
import { type TopoNode, type TopoBranch } from "@/lib/topology";
import { type CompareResult } from "./cadTypes";

type MergeNodeState = { nodeId: string; branchA: string; branchB: string };
type SquadState = { typeId: string; x: number; y: number; branchId: string | null };

export interface CadModalsProps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  branchesRaw: TopoBranch[];
  projectFileName: string;

  // Диалог настройки пределов масштабов
  scaleSettingsOpen: boolean;
  setScaleSettingsOpen: (v: boolean) => void;
  scaleTextMin: number; setScaleTextMin: (v: number) => void;
  scaleTextMax: number; setScaleTextMax: (v: number) => void;
  scaleBranchMin: number; setScaleBranchMin: (v: number) => void;
  scaleBranchMax: number; setScaleBranchMax: (v: number) => void;
  scalePositionMin: number; setScalePositionMin: (v: number) => void;
  scalePositionMax: number; setScalePositionMax: (v: number) => void;
  positionGostMm: number; setPositionGostMm: (v: number) => void;
  bulkheadScale: number; setBulkheadScale: (v: number) => void;
  fanScale: number; setFanScale: (v: number) => void;
  setScaleLimitsEnabled: (v: boolean) => void;

  // Объединение ветвей при удалении промежуточного узла
  mergeNodeDialog: MergeNodeState | null;
  setMergeNodeDialog: (v: MergeNodeState | null) => void;
  doDeleteNode: (nodeId: string) => void;
  mergeAdjacentBranches: (nodeId: string, branchAId: string, branchBId: string) => void;

  // Число людей в отделении
  squadDialog: SquadState | null;
  setSquadDialog: (v: SquadState | null) => void;
  squadCount: string;
  setSquadCount: (v: string) => void;
  addSymbol: (typeId: string, x: number, y: number, branchId?: string | null, label?: string) => void;
  setTool: (v: "select") => void;
  setActiveSymbolTypeId: (v: string | null) => void;

  // Подтверждение закрытия
  showCloseConfirm: boolean;
  setShowCloseConfirm: (v: boolean) => void;
  handleSave: () => Promise<void>;

  // О программе
  showAbout: boolean;
  setShowAbout: (v: boolean) => void;

  // Сравнение схем
  compareShowDialog: boolean;
  setCompareShowDialog: (v: boolean) => void;
  compareLoading: boolean;
  setCompareLoading: (v: boolean) => void;
  setCompareResult: (v: CompareResult | null) => void;
  setCompareFilter: (v: "all" | "changed" | "added" | "removed") => void;
  setCompareSelectedId: (v: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setActiveSide: React.Dispatch<React.SetStateAction<any>>;
  setLeftPanelOpen: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setActiveRibbon: React.Dispatch<React.SetStateAction<any>>;
}

export default function CadModals(p: CadModalsProps) {
  return (
    <>
      {/* ═══ ДИАЛОГ НАСТРОЙКИ ПРЕДЕЛОВ МАСШТАБОВ ═══════════════════════ */}
      {p.scaleSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => p.setScaleSettingsOpen(false)}>
          <div className="bg-white shadow-2xl border border-gray-300 flex"
            style={{ minWidth: 600, fontFamily: "Segoe UI, Tahoma, sans-serif", borderRadius: 0 }}
            onClick={e => e.stopPropagation()}>
            {/* Левая панель (дерево) */}
            <div className="border-r border-gray-300" style={{ width: 180, background: "#f5f5f5" }}>
              <div className="px-3 py-2 border-b border-gray-300 text-[12px] font-semibold text-gray-700" style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
                Настройки технологической схемы
              </div>
              <div className="py-1">
                {["Схема", "Единицы измерения", "Координатная сетка", "Размеры объектов", "Пределы масштабов", "Цвета и шрифты"].map((item, i) => (
                  <div key={i}
                    className="px-3 py-1 text-[12px] cursor-pointer"
                    style={{
                      background: item === "Пределы масштабов" ? "#0078d7" : "transparent",
                      color: item === "Пределы масштабов" ? "white" : "#222",
                      paddingLeft: i > 0 ? 24 : 12,
                    }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {/* Правая панель (содержимое) */}
            <div className="flex flex-col" style={{ flex: 1 }}>
              {/* Заголовок */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-300"
                style={{ background: "linear-gradient(180deg,#e8e8e8,#d8d8d8)" }}>
                <span className="text-[12px] font-semibold text-gray-800">Настройки технологической схемы</span>
                <button onClick={() => p.setScaleSettingsOpen(false)}
                  className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white text-gray-600">
                  <Icon name="X" size={12} />
                </button>
              </div>

              <div className="px-6 py-4 flex-1">
                <div className="text-[14px] font-semibold text-gray-800 mb-4">Пределы масштабов</div>

                {/* Таблица */}
                <table className="text-[12px] w-full mb-4" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th className="text-left py-1 pr-4 font-normal text-gray-500" style={{ width: "50%" }}></th>
                      <th className="text-center py-1 px-3 font-semibold text-gray-700" style={{ width: "25%" }}>Минимум</th>
                      <th className="text-center py-1 px-3 font-semibold text-gray-700" style={{ width: "25%" }}>Максимум</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Строка 1: Текстовые объекты */}
                    <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "top" }}>
                        Размер текстовых объектов<br />
                        <span className="text-[11px] text-gray-500">(номер узла, номер ветви, номер устройства, название и т.п.)</span>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleTextMin}
                            onChange={e => p.setScaleTextMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleTextMax}
                            onChange={e => p.setScaleTextMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 2: Толщина ветви */}
                    <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "middle" }}>
                        Толщина ветви
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleBranchMin}
                            onChange={e => p.setScaleBranchMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scaleBranchMax}
                            onChange={e => p.setScaleBranchMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 3: Масштаб перемычек */}
                    <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                        <div className="text-gray-700">Масштаб перемычек</div>
                        <span className="text-[11px] text-gray-500">(размер по отношению к ширине ветви, синхронно с масштабом схемы)</span>
                      </td>
                      <td className="py-2 px-3 text-center" colSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={20} max={500} value={p.bulkheadScale}
                            onChange={e => p.setBulkheadScale(Math.max(20, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 60, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">% от ширины ветви</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 4: Масштаб вентиляторов */}
                    <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                        <div className="text-gray-700">Масштаб вентиляторов</div>
                        <span className="text-[11px] text-gray-500">(размер по отношению к ширине ветви, синхронно с масштабом схемы)</span>
                      </td>
                      <td className="py-2 px-3 text-center" colSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={50} max={2000} value={p.fanScale}
                            onChange={e => p.setFanScale(Math.max(50, Math.min(2000, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 60, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">% от ширины ветви</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 5: Пределы масштаба Позиций ПЛА */}
                    <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td className="py-2 pr-4 text-gray-700" style={{ verticalAlign: "middle" }}>
                        Размер позиций ПЛА
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scalePositionMin}
                            onChange={e => p.setScalePositionMin(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={10} max={500} value={p.scalePositionMax}
                            onChange={e => p.setScalePositionMax(Math.max(10, Math.min(500, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 50, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">%</span>
                        </div>
                      </td>
                    </tr>

                    {/* Строка 6: ГОСТ-размер маркера позиции ПЛА */}
                    <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td className="py-2 pr-4" style={{ verticalAlign: "top" }}>
                        <div className="text-gray-700">Размер позиции по ГОСТ</div>
                        <span className="text-[11px] text-gray-500">(диаметр маркера позиции ПЛА на чертеже, по умолчанию 13 мм)</span>
                      </td>
                      <td className="py-2 px-3 text-center" colSpan={2}>
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={2} max={100} step={0.5} value={p.positionGostMm}
                            onChange={e => p.setPositionGostMm(Math.max(2, Math.min(100, Number(e.target.value))))}
                            className="text-right text-[12px] px-1"
                            style={{ width: 60, height: 22, border: "1px solid #999", outline: "none" }} />
                          <span className="text-gray-500">мм</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Подвал диалога */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-gray-300" style={{ background: "#f5f5f5" }}>
                <button
                  onClick={() => {
                    p.setScaleTextMin(80); p.setScaleTextMax(150);
                    p.setScaleBranchMin(80); p.setScaleBranchMax(150);
                    p.setScalePositionMin(80); p.setScalePositionMax(150);
                    p.setPositionGostMm(13);
                    p.setBulkheadScale(150); p.setFanScale(450);
                  }}
                  className="px-4 py-1 text-[12px] border border-gray-400 bg-white hover:bg-gray-100"
                  style={{ minWidth: 70 }}>
                  Сброс
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      p.setScaleLimitsEnabled(true);
                      p.setScaleSettingsOpen(false);
                    }}
                    className="px-4 py-1 text-[12px] border border-gray-500 bg-white hover:bg-gray-100"
                    style={{ minWidth: 70 }}>
                    ОК
                  </button>
                  <button
                    onClick={() => p.setScaleSettingsOpen(false)}
                    className="px-4 py-1 text-[12px] border border-gray-500 bg-white hover:bg-gray-100"
                    style={{ minWidth: 70 }}>
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ ДИАЛОГ: ОБЪЕДИНИТЬ ВЕТВИ ПРИ УДАЛЕНИИ ПРОМЕЖУТОЧНОГО УЗЛА ══════ */}
      {p.mergeNodeDialog && (() => {
        const brA = p.branchesRaw.find(b => b.id === p.mergeNodeDialog!.branchA) as (TopoBranch & { name?: string }) | undefined;
        const brB = p.branchesRaw.find(b => b.id === p.mergeNodeDialog!.branchB) as (TopoBranch & { name?: string }) | undefined;
        const nameA = brA?.name || p.mergeNodeDialog!.branchA.substring(0, 12);
        const nameB = brB?.name || p.mergeNodeDialog!.branchB.substring(0, 12);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <div className="flex flex-col shadow-2xl border border-gray-400"
              style={{ width: 360, background: "#fff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}>
              {/* Заголовок */}
              <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
                style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
                <span className="text-[12px] font-semibold text-gray-800">Удаление узла</span>
                <button onClick={() => p.setMergeNodeDialog(null)}
                  className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                  <Icon name="X" size={12} />
                </button>
              </div>
              {/* Тело */}
              <div className="p-4 flex flex-col gap-3">
                <p className="text-[12px] text-gray-700">
                  Узел соединяет две выработки. Объединить их в одну?
                </p>
                <div className="rounded text-[11px] text-gray-600 px-3 py-2" style={{ background: "#f0f4ff", border: "1px solid #c8d4e8" }}>
                  <div className="font-semibold text-gray-700 mb-1">Будут объединены:</div>
                  <div>· {nameA || "Выработка 1"}</div>
                  <div>· {nameB || "Выработка 2"}</div>
                  <div className="mt-1 text-[10px] text-gray-500">Длина = сумма длин. Параметры берутся от первой выработки.</div>
                </div>
              </div>
              {/* Кнопки */}
              <div className="flex gap-2 justify-end px-4 py-3 border-t border-gray-200"
                style={{ background: "#f8f8f8" }}>
                <button
                  onClick={() => { p.doDeleteNode(p.mergeNodeDialog!.nodeId); p.setMergeNodeDialog(null); }}
                  className="text-[11px] px-3 py-1 rounded"
                  style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b", cursor: "pointer" }}>
                  Удалить без объединения
                </button>
                <button
                  onClick={() => {
                    p.mergeAdjacentBranches(p.mergeNodeDialog!.nodeId, p.mergeNodeDialog!.branchA, p.mergeNodeDialog!.branchB);
                    p.setMergeNodeDialog(null);
                  }}
                  className="text-[11px] px-3 py-1 rounded font-semibold"
                  style={{ background: "#1d4ed8", border: "1px solid #1d4ed8", color: "white", cursor: "pointer" }}>
                  Объединить выработки
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ ДИАЛОГ: ЧИСЛО ЛЮДЕЙ В ОТДЕЛЕНИИ ════════════════════════════════ */}
      {p.squadDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => p.setSquadDialog(null)}>
          <div className="flex flex-col shadow-2xl border border-gray-400"
            style={{ width: 320, background: "#fff", fontFamily: "Segoe UI, Tahoma, sans-serif" }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-3 h-8 border-b border-gray-300"
              style={{ background: "linear-gradient(180deg,#e8e8e8,#d4d4d4)" }}>
              <span className="text-[12px] font-semibold text-gray-800">Число людей в отделении</span>
              <button onClick={() => p.setSquadDialog(null)} className="w-6 h-6 flex items-center justify-center hover:bg-red-500 hover:text-white rounded text-gray-600">
                <Icon name="X" size={12} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <label className="text-[11px] text-gray-600">Количество человек:</label>
              <input
                autoFocus
                type="number" min={1} max={99}
                value={p.squadCount}
                onChange={e => p.setSquadCount(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const n = parseInt(p.squadCount) || 5;
                    p.addSymbol(p.squadDialog!.typeId, p.squadDialog!.x, p.squadDialog!.y, p.squadDialog!.branchId, `${n} чел.`);
                    p.setTool("select"); p.setActiveSymbolTypeId(null); p.setSquadDialog(null);
                  }
                  if (e.key === "Escape") p.setSquadDialog(null);
                }}
                className="border border-gray-300 rounded px-2 py-1 text-[13px] text-center w-full outline-none focus:border-blue-500" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => p.setSquadDialog(null)}
                  className="h-7 px-3 text-[11px] border border-gray-300 rounded hover:bg-gray-100">Отмена</button>
                <button onClick={() => {
                  const n = parseInt(p.squadCount) || 5;
                  p.addSymbol(p.squadDialog!.typeId, p.squadDialog!.x, p.squadDialog!.y, p.squadDialog!.branchId, `${n} чел.`);
                  p.setTool("select"); p.setActiveSymbolTypeId(null); p.setSquadDialog(null);
                }}
                  className="h-7 px-3 text-[11px] rounded text-white" style={{ background: "#2563eb" }}>
                  Разместить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Диалог подтверждения закрытия ───────────────────────────────── */}
      {p.showCloseConfirm && (() => {
        type W = Window & { __IS_DESKTOP__?: boolean; chrome?: { webview?: { postMessage: (s: string) => void } } };
        const w = window as W;
        const isDesktop = !!w.__IS_DESKTOP__;
        const doClose = () => {
          p.setShowCloseConfirm(false);
          if (isDesktop) {
            w.chrome?.webview?.postMessage(JSON.stringify({ cmd: "win-close-confirmed" }));
          } else {
            window.close();
          }
        };
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.45)" }}>
            <div className="bg-white rounded shadow-xl border border-gray-300 w-[340px]"
              style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200"
                style={{ background: "#f5f5f5", borderRadius: "8px 8px 0 0" }}>
                <Icon name="FileQuestion" size={16} className="text-yellow-600" />
                <span className="text-[13px] font-semibold text-gray-800">Несохранённые изменения</span>
              </div>
              <div className="px-4 py-4">
                <p className="text-[13px] text-gray-700 mb-1">
                  Проект <strong>«{p.projectFileName}»</strong> содержит несохранённые изменения.
                </p>
                <p className="text-[12px] text-gray-500">Сохранить перед закрытием?</p>
              </div>
              <div className="flex gap-2 justify-end px-4 pb-4">
                <button
                  onClick={() => p.setShowCloseConfirm(false)}
                  className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-gray-100 text-gray-700">
                  Отмена
                </button>
                <button
                  onClick={doClose}
                  className="h-7 px-3 text-[12px] border border-gray-300 rounded hover:bg-red-50 text-red-600">
                  Не сохранять
                </button>
                <button
                  onClick={async () => { await p.handleSave(); doClose(); }}
                  className="h-7 px-3 text-[12px] rounded text-white"
                  style={{ background: "#2563eb" }}>
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Окно «О программе» ──────────────────────────────────────────── */}
      {p.showAbout && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => p.setShowAbout(false)}>
          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-[460px] overflow-hidden"
            style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}
            onClick={(e) => e.stopPropagation()}>
            {/* Шапка диалога */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200"
              style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)" }}>
              <span className="text-[12px] font-semibold text-gray-800">О программе</span>
              <button
                onClick={() => p.setShowAbout(false)}
                className="w-6 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded-sm">✕</button>
            </div>

            {/* Контент */}
            <div className="px-6 py-6 flex flex-col items-center text-center"
              style={{ background: "linear-gradient(160deg, #ffffff 0%, #eaf4fc 100%)" }}>
              <AppLogo
                className="w-48 object-contain mb-2"
                style={{ filter: "drop-shadow(0 4px 12px rgba(14,99,176,0.15))" }}
              />

              <div className="w-full mt-5 border-t border-gray-200 pt-4 text-left text-[12px] text-gray-700 space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-500">Версия:</span><span className="font-medium">{APP_VERSION}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Сборка:</span><span className="font-medium">{APP_BUILD_DATE}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Назначение:</span><span className="font-medium">Проектирование систем вентиляции и водоснабжения</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Платформа:</span><span className="font-medium">Web / Desktop</span></div>
                {(() => {
                  const isOnline = navigator.onLine;
                  return (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Сеть:</span>
                      <span className="font-medium flex items-center gap-1.5">
                        <span style={{
                          width: 8, height: 8, borderRadius: 999,
                          background: isOnline ? "#22c55e" : "#f59e0b",
                          display: "inline-block",
                        }} />
                        {isOnline ? "Онлайн" : "Офлайн-режим"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="w-full mt-4 pt-3 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed">
                © 2026 ПВ-Система. Все права защищены.<br/>
                Программа предназначена для проектирования систем<br/>
                вентиляции и водоснабжения рудников и шахт.
              </div>
            </div>

            {/* Футер */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <UpdateCheckButton currentVersion={APP_VERSION} />
              <button
                onClick={() => p.setShowAbout(false)}
                className="h-7 px-4 text-[12px] rounded text-white font-medium flex-shrink-0"
                style={{ background: "#2563eb" }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Диалог сравнения схем ──────────────────────────────────────── */}
      {p.compareShowDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={() => p.setCompareShowDialog(false)}>
          <div className="bg-white rounded-lg shadow-2xl border border-gray-300 w-[480px]"
            style={{ fontFamily: "Segoe UI, Arial, sans-serif" }}
            onClick={e => e.stopPropagation()}>
            {/* Шапка */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200"
              style={{ background: "linear-gradient(180deg,#e8e8e8,#d6d6d6)" }}>
              <span className="text-[12px] font-semibold text-gray-800">↔ Сравнение схем</span>
              <button onClick={() => p.setCompareShowDialog(false)}
                className="w-6 h-5 hover:bg-red-500 hover:text-white flex items-center justify-center text-xs rounded-sm">✕</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              {/* Текущая схема */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1 font-medium">Исходный файл:</div>
                <div className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200"
                  style={{ background: "#f9fafb" }}>
                  <Icon name="FileText" size={18} style={{ color: "#2563eb" }} />
                  <span className="text-[12px] font-medium text-gray-800">{p.projectFileName}</span>
                  <span className="ml-auto text-[10px] text-gray-400">{p.nodes.length} уз. / {p.branches.length} вет.</span>
                </div>
              </div>

              {/* Выбор файла для сравнения */}
              <div>
                <div className="text-[11px] text-gray-500 mb-1 font-medium">Изменённая схема:</div>
                <button
                  disabled={p.compareLoading}
                  onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file";
                    inp.accept = ".vproj,.json,application/json,text/plain";
                    inp.onchange = () => {
                      const file = inp.files?.[0];
                      if (!file) return;
                      p.setCompareLoading(true);
                      const reader = new FileReader();
                      reader.onload = () => {
                        try {
                          const data = JSON.parse(reader.result as string) as Record<string, unknown>;
                          if (!data.nodes || !Array.isArray(data.nodes)) {
                            alert("Файл не является проектом ПВ-Система.");
                            p.setCompareLoading(false);
                            return;
                          }
                          const oldBranches = p.branchesRaw;
                          const oldNodes    = p.nodes;
                          const newBranches = (data.branches as typeof p.branchesRaw) ?? [];
                          const newNodes    = (data.nodes    as typeof p.nodes) ?? [];
                          const branchDiffs = compareBranches(oldBranches, newBranches);
                          const nodeDiffs   = compareNodes(oldNodes, newNodes);
                          p.setCompareResult({
                            branches: branchDiffs,
                            nodes:    nodeDiffs,
                            fileName: file.name,
                          });
                          p.setCompareFilter("all");
                          p.setCompareSelectedId(null);
                          p.setActiveSide("compare");
                          p.setLeftPanelOpen(true);
                          p.setCompareShowDialog(false);
                          p.setActiveRibbon("vent");
                        } catch {
                          alert("Ошибка чтения файла.");
                        } finally {
                          p.setCompareLoading(false);
                        }
                      };
                      reader.readAsText(file);
                    };
                    inp.click();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded border-2 border-dashed transition-colors"
                  style={{
                    borderColor: p.compareLoading ? "#93c5fd" : "#d1d5db",
                    background: p.compareLoading ? "#eff6ff" : "#f9fafb",
                    cursor: p.compareLoading ? "wait" : "pointer",
                  }}>
                  <Icon name={p.compareLoading ? "Loader" : "FolderOpen"} size={22}
                    style={{ color: "#2563eb" }} className={p.compareLoading ? "animate-spin" : ""} />
                  <div className="text-left">
                    <div className="text-[12px] font-medium text-gray-800">
                      {p.compareLoading ? "Загрузка..." : "Выбрать файл для сравнения"}
                    </div>
                    <div className="text-[10px] text-gray-400">Формат .vproj</div>
                  </div>
                </button>
              </div>

              <div className="text-[10px] text-gray-400 leading-relaxed">
                Сравнение покажет: добавленные, удалённые и изменённые выработки.
                Жёлтым выделяются изменённые, зелёным — добавленные, красным — удалённые.
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <button onClick={() => p.setCompareShowDialog(false)}
                className="h-7 px-4 text-[12px] rounded border border-gray-300 text-gray-700 hover:bg-gray-100">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}