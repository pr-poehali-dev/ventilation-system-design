// ─────────────────────────────────────────────────────────────────────────────
// useCadSchemaCheck / useCadLeftPanelResize — два самодостаточных блока,
// вынесенных из Cad.tsx БЕЗ изменений логики.
//
//   • useCadSchemaCheck        — поиск по схеме + пороги и результат проверки;
//   • useCadLeftPanelResize    — перетаскивание границы левой панели.
//
// Оба блока хранят собственное состояние и не зависят от остального тела
// компонента (проверка схемы получает данные параметрами), поэтому вынесены
// целиком: те же начальные значения, те же зависимости useMemo/useEffect.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useMemo, useRef, useEffect } from "react";
import { checkSchema } from "@/lib/schemaCheck";
import type { TopoNode, TopoBranch } from "@/lib/topology";
import type { SideTab } from "./cadTypes";

export type CheckTab =
  | "near" | "isolated" | "dupes" | "dupbranch" | "zeroR"
  | "zeroLen" | "highR" | "bulkR" | "manualLen" | "isolatedBranch";

export type SearchScope = "all" | "nodes" | "branches";

/**
 * Поиск по схеме и проверка схемы.
 * Результат проверки считается только когда открыта панель «Проверка» —
 * мемоизация исключает тяжёлый O(n) пересчёт на каждый ререндер (ховеры и т.п.).
 */
export function useCadSchemaCheck(
  activeSide: SideTab,
  nodes: TopoNode[],
  branches: TopoBranch[],
) {
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [checkThreshold, setCheckThreshold] = useState<number>(0.01);
  const [checkTab, setCheckTab] = useState<CheckTab>("near");
  // Порог «большого» сопротивления ветви, Н·с²/м⁸ (кМюрг). По умолчанию 100.
  const [checkHighRThreshold, setCheckHighRThreshold] = useState<number>(100);
  // Порог сопротивления перемычки, кМюрг (норматив — 686 кМюрг)
  const [checkBulkRThreshold, setCheckBulkRThreshold] = useState<number>(686);
  // Результат проверки схемы — считается только когда открыта панель «Проверка».
  // Мемоизация исключает тяжёлый O(n) пересчёт на каждый ререндер (ховеры и т.п.).
  const schemaCheckResult = useMemo(() => {
    if (activeSide !== "check") return null;
    return checkSchema(nodes, branches, {
      nearThreshold: checkThreshold,
      highRThreshold: checkHighRThreshold,
      bulkRThreshold: checkBulkRThreshold,
    });
  }, [activeSide, nodes, branches, checkThreshold, checkHighRThreshold, checkBulkRThreshold]);

  return {
    searchQuery, setSearchQuery,
    searchScope, setSearchScope,
    checkThreshold, setCheckThreshold,
    checkTab, setCheckTab,
    checkHighRThreshold, setCheckHighRThreshold,
    checkBulkRThreshold, setCheckBulkRThreshold,
    schemaCheckResult,
  };
}

/**
 * Ресайз левой панели: тянем границу мышью, ширина ограничена 220…640 px.
 */
export function useCadLeftPanelResize() {
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(420);
  const leftDragRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!leftDragRef.current) return;
      const dx = e.clientX - leftDragRef.current.startX;
      const next = Math.min(640, Math.max(220, leftDragRef.current.startW + dx));
      setLeftPanelWidth(next);
    };
    const onUp = () => { leftDragRef.current = null; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);
  const startLeftDrag = (e: React.MouseEvent) => {
    leftDragRef.current = { startX: e.clientX, startW: leftPanelWidth };
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  };

  return { leftPanelWidth, setLeftPanelWidth, startLeftDrag };
}
