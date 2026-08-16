// ─────────────────────────────────────────────────────────────────────────────
// buildVentPipeLine — построение вент. трубопровода как параллельной нити.
//
// Вынесено из Cad.tsx БЕЗ изменений логики: тот же порядок шагов (упорядочивание
// цепочки, дубликаты узлов со смещением, соединение ветвями, привязка концов),
// те же формулы и те же вызовы сеттеров в конце.
//
// Блок оформлен обычной функцией (хуков внутри нет) — состояние передаётся
// параметрами, поэтому поведение полностью совпадает с прежним замыканием.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type TopoNode, type TopoBranch,
  makeNode, makeBranch, calcBranchLength,
} from "@/lib/topology";
import { calcSection } from "@/lib/aerodynamics";

export interface BuildVentPipeDeps {
  nodes: TopoNode[];
  branchesRaw: TopoBranch[];
  branchWidth: number;
  nextNodeId: (existing?: TopoNode[]) => string;
  nextBranchId: (existing?: TopoBranch[]) => string;
  pushHistory: () => void;
  setNodes: (v: TopoNode[]) => void;
  setBranches: (v: TopoBranch[] | ((prev: TopoBranch[]) => TopoBranch[])) => void;
  setSelectedBranchIds: (v: Set<string>) => void;
  setSelectedBranchId: (v: string | null) => void;
  setSelectedNodeId: (v: string | null) => void;
}

/**
 * По выбранным ветвям строим ОТДЕЛЬНУЮ нить трубопровода: дубликаты узлов
 * маршрута со смещением вбок, соединённые узкими светло-серыми ветвями
 * (isVentPipeBranch, ширина ~20% от ветви). Концы нити привязаны к первому и
 * последнему узлу маршрута — через трубопровод пойдёт воздух (можно ставить ВМП).
 */
export function buildVentPipeLine(
  branchIds: string[],
  vpPatchRaw: Partial<TopoBranch>,
  d: BuildVentPipeDeps,
): void {
  const {
    nodes, branchesRaw, branchWidth, nextNodeId, nextBranchId, pushHistory,
    setNodes, setBranches, setSelectedBranchIds, setSelectedBranchId, setSelectedNodeId,
  } = d;

  const brMap = new Map(branchesRaw.map((b) => [b.id, b]));
  const selected = branchIds.map((id) => brMap.get(id)).filter(Boolean) as TopoBranch[];
  if (selected.length === 0) return;

  // Параметры трубы (диаметр, материал, R, утечки и т.д.) переносим на ветви
  // нити — тогда они видны и редактируемы во вкладке свойств ветви. Флаг
  // hasVentPipe оставляем true (нужен для отображения параметров), а лишний
  // пунктирный legacy-оверлей для таких ветвей скрыт по isVentPipeBranch.
  // Вентилятор на ветви вентрубопровода НЕ ставим — явно снимаем hasFan,
  // иначе на нити появляется лишний символ ВМП.
  const noFan: Partial<TopoBranch> = { hasFan: false };
  const vpPatch: Partial<TopoBranch> = { ...vpPatchRaw, hasVentPipe: true, ...noFan };

  // Тот же набор параметров, но БЕЗ снятия вентилятора. Нужен при правке уже
  // готового става: на одной из его ветвей стоит ВМП, и hasFan:false сорвал бы
  // с неё вентилятор — на схеме оставался бы значок УО без характеристик,
  // а из расчёта сети исчезал бы источник напора.
  const vpPatchKeepFan: Partial<TopoBranch> = { ...vpPatchRaw, hasVentPipe: true };

  // ── РЕДАКТИРОВАНИЕ существующей нити ────────────────────────────────
  // Если ВСЕ выбранные ветви — уже ветви вентрубопровода (isVentPipeBranch),
  // значит пользователь повторно открыл диалог для готовой нити. В этом случае
  // НЕ создаём дубликат, а обновляем эти ветви на месте (синхронизируем
  // геометрию сечения и распределённое сопротивление трубы).
  if (selected.every((b) => b.isVentPipeBranch)) {
    pushHistory();
    const editDiaM = (vpPatchRaw.vpDiameter ?? 500) / 1000;
    const editSec = calcSection({ shape: "round", diameter: editDiaM });
    const editGeom: Partial<TopoBranch> = {
      shape: "round",
      diameter: editDiaM,
      area: Math.round(editSec.area * 1000) / 1000,
      perimeter: Math.round(editSec.perimeter * 1000) / 1000,
      dh: Math.round(editSec.dh * 1000) / 1000,
      manualSection: false,
    };
    // Ручной R (если задан) распределяем по длине сегментов; иначе каждый
    // сегмент считает R по формуле R=6.48·α·L/D⁵ (режим "pipe" из vpPatch).
    const editManualR = vpPatchRaw.vpManualR && vpPatchRaw.vpManualR > 0 ? vpPatchRaw.vpManualR : 0;
    const mainLen = selected.reduce((s, b) => s + (b.length ?? 0), 0) || 1;
    const idSet = new Set(branchIds);
    setBranches((prev) => prev.map((b) => {
      if (!idSet.has(b.id)) return b;
      const manualOverride: Partial<TopoBranch> = editManualR > 0
        ? { resistanceMode: "manual", manualR: editManualR * ((b.length ?? 0) / mainLen) }
        : {};
      return {
        ...b,
        // Правка существующего става не должна трогать вентилятор: если он
        // уже стоит на этой ветви, его характеристики (модель, угол лопаток,
        // обороты) сохраняются. Снимать hasFan здесь нельзя — значок УО
        // остался бы на схеме пустышкой без характеристик.
        ...vpPatchKeepFan,
        ...editGeom,
        ...manualOverride,
      };
    }));
    return;
  }

  // 1) Упорядочиваем ветви в цепочку from→to и получаем последовательность узлов.
  type Item = { b: TopoBranch; fromId: string; toId: string };
  const chain: Item[] = [{ b: selected[0], fromId: selected[0].fromId, toId: selected[0].toId }];
  const rest = selected.slice(1);
  let changed = true;
  while (rest.length && changed) {
    changed = false;
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i];
      const head = chain[0], tail = chain[chain.length - 1];
      if (b.fromId === tail.toId) { chain.push({ b, fromId: b.fromId, toId: b.toId }); rest.splice(i, 1); changed = true; break; }
      if (b.toId === tail.toId)   { chain.push({ b, fromId: b.toId, toId: b.fromId }); rest.splice(i, 1); changed = true; break; }
      if (b.toId === head.fromId) { chain.unshift({ b, fromId: b.fromId, toId: b.toId }); rest.splice(i, 1); changed = true; break; }
      if (b.fromId === head.fromId){ chain.unshift({ b, fromId: b.toId, toId: b.fromId }); rest.splice(i, 1); changed = true; break; }
    }
  }
  // Ветви, не примкнувшие к цепочке (разрыв) — добавляем как есть в конец.
  for (const b of rest) chain.push({ b, fromId: b.fromId, toId: b.toId });

  // 2) Последовательность узлов маршрута.
  const nodeSeq: string[] = [chain[0].fromId];
  for (const c of chain) nodeSeq.push(c.toId);

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  // Смещение нити вбок — перпендикулярно среднему направлению маршрута.
  const firstN = nodeMap.get(nodeSeq[0]);
  const lastN = nodeMap.get(nodeSeq[nodeSeq.length - 1]);
  if (!firstN || !lastN) return;
  const dxAll = (lastN.x - firstN.x), dyAll = (lastN.y - firstN.y);
  const lenAll = Math.hypot(dxAll, dyAll) || 1;
  // Перпендикуляр (нормированный) × величина смещения (доля длины маршрута, но в разумных пределах)
  const off = Math.max(2, Math.min(15, lenAll * 0.04));
  const perpX = (-dyAll / lenAll) * off;
  const perpY = (dxAll / lenAll) * off;

  pushHistory();

  // 3) Создаём дубликаты узлов маршрута со смещением.
  const workNodes = [...nodes];
  const workBranches = [...branchesRaw];
  const dupNodeId = new Map<string, string>(); // исходный узел → узел нити

  for (const origId of nodeSeq) {
    if (dupNodeId.has(origId)) continue;
    const orig = nodeMap.get(origId);
    if (!orig) continue;
    const nid = nextNodeId(workNodes);
    const usedNums = new Set(workNodes.map((n) => parseInt(n.number, 10)).filter((v) => !isNaN(v)));
    let num = 1; while (usedNums.has(num)) num++;
    const nn = makeNode(nid, {
      x: orig.x + perpX, y: orig.y + perpY, z: orig.z,
      name: "", number: String(num),
      // Узлы в проекте несут привязку к горизонту; в базовом типе поля нет,
      // поэтому читаем так же, как это делалось в исходном коде Cad.tsx.
      horizonId: (orig as TopoNode & { horizonId?: string }).horizonId,
    } as Partial<TopoNode>);
    workNodes.push(nn);
    dupNodeId.set(origId, nid);
  }

  // Аэродинамическое сопротивление трубы.
  // Если R задан вручную (vpManualR) — распределяем его по длине сегментов.
  // Иначе каждый сегмент считает R сам по формуле R=6.48·α·L/D⁵ (режим "pipe"),
  // как во вкладке «Топология» — vpPatch уже содержит resistanceMode/pipeAlpha/pipeDiameter.
  const manualPipeR = vpPatchRaw.vpManualR && vpPatchRaw.vpManualR > 0 ? vpPatchRaw.vpManualR : 0;
  const chainTotalLen = chain.reduce((s, c) => s + (c.b.length ?? 0), 0) || 1;

  // Геометрия сечения ветвей нити = КРУГЛАЯ труба диаметром vpDiameter (мм → м).
  const pipeDiaM = (vpPatchRaw.vpDiameter ?? 500) / 1000;
  const pipeSec = calcSection({ shape: "round", diameter: pipeDiaM });
  const pipeGeom: Partial<TopoBranch> = {
    shape: "round",
    diameter: pipeDiaM,
    area: Math.round(pipeSec.area * 1000) / 1000,
    perimeter: Math.round(pipeSec.perimeter * 1000) / 1000,
    dh: Math.round(pipeSec.dh * 1000) / 1000,
    manualSection: false,
  };

  // 4) Соединяем дубликаты ветвями-трубопроводом (узкими, светло-серыми).
  const createdIds: string[] = [];
  for (const c of chain) {
    const fromDup = dupNodeId.get(c.fromId);
    const toDup = dupNodeId.get(c.toId);
    if (!fromDup || !toDup) continue;
    const bid = nextBranchId(workBranches);
    // В ручном режиме — доля общего R по длине; иначе оставляем режим "pipe" из vpPatch.
    const manualOverride: Partial<TopoBranch> = manualPipeR > 0
      ? { resistanceMode: "manual", manualR: manualPipeR * ((c.b.length ?? 0) / chainTotalLen) }
      : {};
    const nb = makeBranch(bid, fromDup, toDup, {
      horizonId: c.b.horizonId,
      type: "Вентрубопровод",
      length: c.b.length,
      manualLength: true,
      lineWidth: Math.max(0.6, (c.b.lineWidth && c.b.lineWidth > 0 ? c.b.lineWidth : branchWidth) * 0.2),
      lineBorder: 0.1,
      isVentPipeBranch: true,
      ...vpPatch,
      ...pipeGeom,
      ...manualOverride,
    });
    workBranches.push(nb);
    createdIds.push(bid);
  }

  // 5) Привязываем концы нити к исходным узлам маршрута (вход/выход воздуха).
  // Длину этих соединительных ветвей считаем ПО КООРДИНАТАМ (узел маршрута →
  // смещённый дубликат), а не оставляем 0 — иначе проверка ругается «L=0».
  const workNodeMap = new Map(workNodes.map((n) => [n.id, n]));
  const startDup = dupNodeId.get(nodeSeq[0]);
  const endDup = dupNodeId.get(nodeSeq[nodeSeq.length - 1]);
  if (startDup && startDup !== nodeSeq[0]) {
    const bid = nextBranchId(workBranches);
    const a = workNodeMap.get(nodeSeq[0]);
    const b = workNodeMap.get(startDup);
    const segLen = a && b ? Math.round(calcBranchLength(a, b)) : 0;
    workBranches.push(makeBranch(bid, nodeSeq[0], startDup, {
      horizonId: (firstN as TopoNode & { horizonId?: string }).horizonId, type: "Вентрубопровод (вход)", length: segLen, manualLength: false,
      lineWidth: Math.max(0.6, branchWidth * 0.2), lineBorder: 0.1, isVentPipeBranch: true, ...vpPatch, ...pipeGeom,
    }));
  }
  if (endDup && endDup !== nodeSeq[nodeSeq.length - 1]) {
    const bid = nextBranchId(workBranches);
    const a = workNodeMap.get(endDup);
    const b = workNodeMap.get(nodeSeq[nodeSeq.length - 1]);
    const segLen = a && b ? Math.round(calcBranchLength(a, b)) : 0;
    workBranches.push(makeBranch(bid, endDup, nodeSeq[nodeSeq.length - 1], {
      horizonId: (lastN as TopoNode & { horizonId?: string }).horizonId, type: "Вентрубопровод (выход)", length: segLen, manualLength: false,
      lineWidth: Math.max(0.6, branchWidth * 0.2), lineBorder: 0.1, isVentPipeBranch: true, ...vpPatch, ...pipeGeom,
    }));
  }

  setNodes(workNodes);
  setBranches(workBranches);
  setSelectedBranchIds(new Set(createdIds));
  setSelectedBranchId(createdIds[0] ?? null);
  setSelectedNodeId(null);
}