// ─────────────────────────────────────────────────────────────────────────────
// useCadHotkeys — горячие клавиши CAD-редактора.
//
// Вынесено из Cad.tsx БЕЗ изменений логики: тот же обработчик keydown, тот же
// порядок проверок клавиш и тот же список зависимостей useEffect. Блок
// самодостаточен — он ничего не отдаёт наружу, только читает состояние и
// вызывает уже существующие обработчики, поэтому вынесен целиком.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import type { Position } from "@/lib/positions";
import type { SideTab } from "./cadTypes";
import type { CadTool } from "@/components/cad/TopoCanvas";
import type { SchemaSymbol } from "./cadTypes";

export interface CadHotkeysDeps {
  // Данные схемы — участвуют в списке зависимостей эффекта
  nodes: unknown[];
  branchesRaw: unknown[];
  schemaSymbols: SchemaSymbol[];
  positions: Position[];

  // Текущее выделение
  selectedNodeId: string | null;
  selectedBranchId: string | null;
  selectedBranchIds: Set<string>;
  selectedSymbolId: string | null;
  selectedSymbolIds: Set<string>;
  selectedPositionId: string | null;

  // Буфер и режимы
  symbolClipboard: SchemaSymbol | null;
  pendingSymbol: SchemaSymbol | null;
  leaderDrawMode: string | null;
  lastSPressRef: React.MutableRefObject<number>;

  // Команды
  handleUndo: () => void;
  handleSave: () => void;
  handleSolve: () => void;
  handleDeleteSelected: () => void;
  handleReverseBranch: (id: string) => void;
  toggleRibbonCollapsed: () => void;

  // Сеттеры
  setLeftPanelOpen: (v: boolean) => void;
  setActiveSide: (v: SideTab) => void;
  setShowPrintDialog: (v: boolean) => void;
  setPendingSymbol: (v: SchemaSymbol | null) => void;
  setSymbolClipboard: (v: SchemaSymbol) => void;
  setPosBranchBindMode: (fn: (v: boolean) => boolean) => void;
  setThinLines: (fn: (v: boolean) => boolean) => void;
  setPositions: (fn: (prev: Position[]) => Position[]) => void;
  setLeaderDrawMode: (v: string | null) => void;
  setLeaderExtraMode: (v: boolean) => void;
  setLeaderCursorScreen: (v: null) => void;
  setLeaderSnapBranch: (v: null) => void;
  setShowSelectSimilar: (v: boolean) => void;
  setSelectedNodeId: (v: string | null) => void;
  setSelectedBranchId: (v: string | null) => void;
  setTool: (v: CadTool) => void;
}

/**
 * Горячие клавиши CAD.
 * F6 — переключить «тонкие линии» (как в АэроСеть/Венти-CAD: подача в одну тонкую линию).
 * F9 — запустить расчёт воздухораспределения. Esc — снять выделение.
 */
export function useCadHotkeys(d: CadHotkeysDeps): void {
  const {
    nodes, branchesRaw, schemaSymbols, positions,
    selectedNodeId, selectedBranchId, selectedBranchIds,
    selectedSymbolId, selectedSymbolIds, selectedPositionId,
    symbolClipboard, pendingSymbol, leaderDrawMode, lastSPressRef,
    handleUndo, handleSave, handleSolve, handleDeleteSelected,
    handleReverseBranch, toggleRibbonCollapsed,
    setLeftPanelOpen, setActiveSide, setShowPrintDialog,
    setPendingSymbol, setSymbolClipboard, setPosBranchBindMode,
    setThinLines, setPositions, setLeaderDrawMode, setLeaderExtraMode,
    setLeaderCursorScreen, setLeaderSnapBranch, setShowSelectSimilar,
    setSelectedNodeId, setSelectedBranchId, setTool,
  } = d;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // isEditing: true если активный элемент — поле ввода или contentEditable
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName ?? "";
      const isEditing = ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        && active !== document.body)
        || (active?.isContentEditable ?? false);

      if (e.ctrlKey && (e.key === "z" || e.key === "я" || e.key === "Я")) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.ctrlKey && (e.key === "s" || e.key === "ы" || e.key === "Ы")) {
        e.preventDefault();
        handleSave();
        return;
      }
      // Ctrl+F / Ctrl+А — открыть поиск по схеме
      if (e.ctrlKey && (e.key === "f" || e.key === "F" || e.key === "а" || e.key === "А")) {
        e.preventDefault();
        setLeftPanelOpen(true);
        setActiveSide("search");
        return;
      }
      // Ctrl+P / Ctrl+З — открыть диалог печати
      if (e.ctrlKey && (e.key === "p" || e.key === "P" || e.key === "з" || e.key === "З")) {
        e.preventDefault();
        setShowPrintDialog(true);
        return;
      }
      // Ctrl+V / Ctrl+М — вставить условное обозначение из буфера (режим ожидания привязки)
      if (e.ctrlKey && (e.key === "v" || e.key === "V" || e.key === "м" || e.key === "М") && !isEditing) {
        if (symbolClipboard) {
          e.preventDefault();
          setPendingSymbol({ ...symbolClipboard, id: `SYM_${Date.now()}` });
        }
        return;
      }
      // Ctrl+C / Ctrl+С — скопировать выбранное обозначение
      if (e.ctrlKey && (e.key === "c" || e.key === "C" || e.key === "с" || e.key === "С") && !isEditing && selectedSymbolId) {
        const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
        if (sym) { e.preventDefault(); setSymbolClipboard(sym); }
        return;
      }
      // Ctrl+D / Ctrl+В — дублировать выбранное обозначение (режим ожидания привязки)
      if (e.ctrlKey && (e.key === "d" || e.key === "D" || e.key === "в" || e.key === "В") && !isEditing && selectedSymbolId) {
        const sym = schemaSymbols.find(s => s.id === selectedSymbolId);
        if (sym) {
          e.preventDefault();
          setPendingSymbol({ ...sym, id: `SYM_${Date.now()}` });
        }
        return;
      }
      // Ctrl+F1 — свернуть/развернуть ленту (привычно по офисным программам)
      if (e.ctrlKey && e.key === "F1") {
        e.preventDefault();
        toggleRibbonCollapsed();
        return;
      }
      // F3 — режим привязки ветвей к позиции
      if (e.key === "F3") {
        e.preventDefault();
        if (selectedPositionId) setPosBranchBindMode((v) => !v);
        return;
      }
      // F6, F9 — всегда работают
      if (e.key === "F6") { e.preventDefault(); setThinLines((v) => !v); return; }
      if (e.key === "F9") { e.preventDefault(); handleSolve(); return; }
      // И/B — добавить выноску (режим рисования) или убрать
      if ((e.key === "и" || e.key === "И" || e.key === "b" || e.key === "B") && !isEditing) {
        e.preventDefault();
        if (selectedPositionId) {
          const pos = positions.find(p => p.id === selectedPositionId);
          if (pos) {
            const hasLeader = pos.leaderEndX != null || pos.leaderBranchId != null;
            if (hasLeader) {
              // Уже есть выноска — убираем
              setPositions(prev => prev.map(p =>
                p.id === selectedPositionId
                  ? { ...p, leaderEndX: null, leaderEndY: null, leaderBranchId: null, leaderT: null }
                  : p
              ));
            } else {
              // Нет выноски — запускаем режим рисования
              setLeaderDrawMode(selectedPositionId);
              setLeaderCursorScreen(null);
              setLeaderSnapBranch(null);
            }
          }
        }
        return;
      }

      // Ctrl+R — развернуть выбранную ветвь
      if (e.ctrlKey && (e.key === "r" || e.key === "R") && !isEditing) {
        e.preventDefault();
        if (selectedBranchId) handleReverseBranch(selectedBranchId);
        return;
      }

      // S+S (англ.) / Ы+Ы (рус.) — диалог выделения подобных объектов
      const isSKey = e.key === "s" || e.key === "S" || e.key === "ы" || e.key === "Ы";
      if (isSKey && !isEditing) {
        const now = Date.now();
        if (now - lastSPressRef.current < 600) {
          e.preventDefault();
          setShowSelectSimilar(true);
          lastSPressRef.current = 0;
        } else {
          lastSPressRef.current = now;
        }
        return;
      }

      // Del/Backspace — блокируем только если input активен И имеет текстовое содержимое
      // (т.е. пользователь действительно редактирует текст, а не просто кликнул по полю)
      if (e.key === "Delete") {
        if (isEditing) return; // редактируем текст в поле — не удаляем объект
        e.preventDefault();
        handleDeleteSelected();
        return;
      }
      if (e.key === "Backspace") {
        if (isEditing) return;
        e.preventDefault();
        handleDeleteSelected();
        return;
      }

      if (isEditing) return;

      if (e.key === "Escape" || e.key === "Enter") {
        // Выход из режима рисования выноски
        if (leaderDrawMode) {
          setLeaderDrawMode(null);
          setLeaderExtraMode(false);
          setLeaderCursorScreen(null);
          setLeaderSnapBranch(null);
          return;
        }
        if (pendingSymbol) {
          setPendingSymbol(null);
          return;
        }
        setSelectedNodeId(null);
        setSelectedBranchId(null);
        setTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, branchesRaw, selectedNodeId, selectedBranchId, selectedSymbolId, selectedSymbolIds, selectedBranchIds, schemaSymbols, symbolClipboard, pendingSymbol, selectedPositionId, leaderDrawMode]);
}
