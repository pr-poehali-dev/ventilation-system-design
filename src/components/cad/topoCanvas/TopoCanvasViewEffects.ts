import React, { useEffect, useRef } from "react";
import { type TopoNode, type TopoBranch, type ProjOptions, project3D } from "@/lib/topology";
import { type Props, type ViewState } from "@/components/cad/topoCanvas/topoCanvasTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Эффекты ВИДА холста (вынесено из TopoCanvas.tsx, перенос 1:1).
// Отвечают за то, как камера реагирует на внешние команды и настройки:
//   • компенсация сдвига при изменении масштабов XY и Z (камера не «убегает»)
//   • применение масштаба, заданного снаружи (поле ввода, «По экрану»)
//   • «Вписать в экран» — подбор масштаба и центровка схемы
//   • переход к объекту (узел / ветвь / точка) по внешней команде
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewEffectsDeps {
  nodes: TopoNode[];
  branches: TopoBranch[];
  xyScale: number;
  zScale: number;
  size: { w: number; h: number };
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
  scaleOverride?: Props["scaleOverride"];
  fitToScreenNonce?: Props["fitToScreenNonce"];
  focusNonce?: Props["focusNonce"];
  focusNodeId?: Props["focusNodeId"];
  focusBranchId?: Props["focusBranchId"];
  focusPos?: Props["focusPos"];
  /** Счётчик восстановления сохранённого вида: пока идёт восстановление, внешние команды масштаба игнорируются */
  restoredViewNonce: React.MutableRefObject<number>;
}

/** Подключает эффекты вида. Вызывается из TopoCanvas — там же, где раньше жили эти useEffect. */
export function useViewEffects(deps: ViewEffectsDeps) {
  const {
    nodes, branches, xyScale, zScale, size, view, setView,
    scaleOverride, fitToScreenNonce, focusNonce, focusNodeId, focusBranchId, focusPos,
    restoredViewNonce,
  } = deps;

  // ─── СИНХРОНИЗАЦИЯ ВНЕШНЕГО МАСШТАБА ────────────────────────────────
  // scaleOverride используется ТОЛЬКО для внешних команд (ввод в поле, fitToScreen).
  // Компенсация сдвига view при изменении xyScale/zScale без сброса позиции камеры
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const prevXyScale = useRef<number>(xyScale);
  const prevZScale = useRef<number>(zScale);
  useEffect(() => {
    const prev = prevXyScale.current;
    prevXyScale.current = xyScale;
    if (prev === xyScale || prev === 0) return;
    // Если вид только что восстановлен из файла — не перекрываем его
    if (restoredViewNonce.current && (Date.now() - restoredViewNonce.current) < 3000) return;
    const ratio = xyScale / prev;
    // Масштабируем от центра bbox схемы (а не от центра экрана)
    setView((v) => {
      // Центр bbox узлов в экранных координатах при СТАРОМ xyScale
      const curNodes = nodesRef.current;
      if (curNodes.length > 0) {
        const tmpProj: ProjOptions = { scale: v.scale, offsetX: v.offsetX, offsetY: v.offsetY, azimuth: v.azimuth, elevation: v.elevation, zScale };
        let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
        curNodes.forEach(n => {
          const p = project3D({ x: n.x * prev, y: n.y * prev, z: n.z * (zScale ?? 1) }, tmpProj);
          if (p.sx < minSx) minSx = p.sx; if (p.sx > maxSx) maxSx = p.sx;
          if (p.sy < minSy) minSy = p.sy; if (p.sy > maxSy) maxSy = p.sy;
        });
        const csx = (minSx + maxSx) / 2;
        const csy = (minSy + maxSy) / 2;
        return {
          ...v,
          offsetX: csx - (csx - v.offsetX) * ratio,
          offsetY: csy - (csy - v.offsetY) * ratio,
        };
      }
      return {
        ...v,
        offsetX: size.w / 2 - (size.w / 2 - v.offsetX) * ratio,
        offsetY: size.h / 2 - (size.h / 2 - v.offsetY) * ratio,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xyScale]);

  useEffect(() => {
    const prev = prevZScale.current;
    prevZScale.current = zScale;
    if (prev === zScale || prev === 0) return;
    // Если вид только что восстановлен из файла — не перекрываем его
    if (restoredViewNonce.current && (Date.now() - restoredViewNonce.current) < 3000) return;
    const ratio = zScale / prev;
    // Масштабируем от центра bbox схемы (в 3D Z влияет на обе оси проекции)
    setView((v) => {
      const curNodes2 = nodesRef.current;
      if (curNodes2.length > 0) {
        const tmpProj: ProjOptions = { scale: v.scale, offsetX: v.offsetX, offsetY: v.offsetY, azimuth: v.azimuth, elevation: v.elevation, zScale: prev };
        let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
        curNodes2.forEach(n => {
          const p = project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * prev }, tmpProj);
          if (p.sx < minSx) minSx = p.sx; if (p.sx > maxSx) maxSx = p.sx;
          if (p.sy < minSy) minSy = p.sy; if (p.sy > maxSy) maxSy = p.sy;
        });
        const csx = (minSx + maxSx) / 2;
        const csy = (minSy + maxSy) / 2;
        // В плановом виде (elevation≈90) Z не проецируется по X — offsetX не трогаем
        const isTopView = Math.abs(v.elevation - 90) < 5;
        return {
          ...v,
          offsetX: isTopView ? v.offsetX : csx - (csx - v.offsetX) * ratio,
          offsetY: csy - (csy - v.offsetY) * ratio,
        };
      }
      return { ...v, offsetY: size.h / 2 - (size.h / 2 - v.offsetY) * ratio };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zScale]);

  // Wheel-зум работает полностью внутри и не синхронизируется с родителем.
  const prevScaleOverride = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (scaleOverride === undefined) return;
    // Реагируем только если значение реально изменилось снаружи
    if (prevScaleOverride.current === scaleOverride) return;
    prevScaleOverride.current = scaleOverride;
    setView((v) => {
      if (Math.abs(scaleOverride - v.scale) < 1e-6) return v;
      return { ...v, scale: scaleOverride };
    });
  }, [scaleOverride]);

  // ─── ВПИСАТЬ ВСЮ СЕТЬ В ЭКРАН ───────────────────────────────────────
  // Реагируем на смену nonce из родителя — вписываем все узлы в экран.
  // Используем project3D с текущим ракурсом, чтобы корректно работать для план/фронт/профиль/3D.
  useEffect(() => {
    if (!fitToScreenNonce) return;
    if (nodes.length === 0) return;
    if (size.w < 50 || size.h < 50) return;
    // Если view был восстановлен из файла менее 5 секунд назад — не перезаписываем
    if (restoredViewNonce.current && (Date.now() - restoredViewNonce.current) < 5000) return;
    // Проецируем узлы при масштабе 1 и offset(0,0) — получаем "мировые экранные" координаты
    const tmpProj: ProjOptions = {
      scale: 1, offsetX: 0, offsetY: 0,
      azimuth: view.azimuth, elevation: view.elevation, zScale,
    };
    let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
    nodes.forEach((n) => {
      const p = project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, tmpProj);
      if (p.sx < minSx) minSx = p.sx;
      if (p.sx > maxSx) maxSx = p.sx;
      if (p.sy < minSy) minSy = p.sy;
      if (p.sy > maxSy) maxSy = p.sy;
    });
    const dw = Math.max(1, maxSx - minSx);
    const dh = Math.max(1, maxSy - minSy);
    const pad = 0.1;
    const scaleX = (size.w * (1 - pad * 2)) / dw;
    const scaleY = (size.h * (1 - pad * 2)) / dh;
    const newScale = Math.max(0.0005, Math.min(5000, Math.min(scaleX, scaleY)));
    const csx = (minSx + maxSx) / 2;
    const csy = (minSy + maxSy) / 2;
    setView((v) => ({
      ...v,
      scale: newScale,
      offsetX: size.w / 2 - csx * newScale,
      offsetY: size.h / 2 - csy * newScale,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToScreenNonce]);

  // ─── Центрирование камеры на конкретном узле/ветви ───────────────
  useEffect(() => {
    if (!focusNonce) return;
    if (size.w < 50 || size.h < 50) return;

    const tmpProj: ProjOptions = {
      scale: 1, offsetX: 0, offsetY: 0,
      azimuth: view.azimuth, elevation: view.elevation, zScale,
    };

    let targetX = 0, targetY = 0, found = false;
    if (focusPos) {
      const p = project3D({ x: focusPos.x * (xyScale ?? 1), y: focusPos.y * (xyScale ?? 1), z: focusPos.z * (zScale ?? 1) }, tmpProj);
      targetX = p.sx; targetY = p.sy; found = true;
    } else if (focusNodeId) {
      const n = nodes.find(nn => nn.id === focusNodeId);
      if (n) {
        const p = project3D({ x: n.x * (xyScale ?? 1), y: n.y * (xyScale ?? 1), z: n.z * (zScale ?? 1) }, tmpProj);
        targetX = p.sx; targetY = p.sy; found = true;
      }
    } else if (focusBranchId) {
      const b = branches.find(bb => bb.id === focusBranchId);
      if (b) {
        const fromN = nodes.find(n => n.id === b.fromId);
        const toN = nodes.find(n => n.id === b.toId);
        if (fromN && toN) {
          const pf = project3D({ x: fromN.x * (xyScale ?? 1), y: fromN.y * (xyScale ?? 1), z: fromN.z * (zScale ?? 1) }, tmpProj);
          const pt = project3D({ x: toN.x * (xyScale ?? 1),   y: toN.y * (xyScale ?? 1),   z: toN.z   * (zScale ?? 1) }, tmpProj);
          targetX = (pf.sx + pt.sx) / 2;
          targetY = (pf.sy + pt.sy) / 2;
          found = true;
        }
      }
    }
    if (!found) return;

    // Если масштаб слишком мелкий — приблизим, чтобы объект было видно.
    const minScaleForFocus = 0.6;
    const newScale = Math.max(view.scale, minScaleForFocus);

    setView((v) => ({
      ...v,
      scale: newScale,
      offsetX: size.w / 2 - targetX * newScale,
      offsetY: size.h / 2 - targetY * newScale,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // prevScaleOverride отдаём наружу: щипковый зум (touch) в TopoCanvas тоже
  // помечает им новый масштаб, чтобы внешняя команда не сработала повторно.
  return { nodesRef, prevScaleOverride };
}
