// ─────────────────────────────────────────────────────────────────────────────
// Гидравлический расчёт водопроводной сети ППЗ
// Метод: двухпроходный (bottom-up расходы → top-down давления)
//
// Проход 1 (снизу-вверх): от потребителей к резервуару.
//   Собираем суммарный расход в каждой ветви = сумма расходов всех потребителей
//   downstream. Расход каждого потребителя вычисляется по начальному давлению
//   резервуара (верхняя оценка), затем уточняется на проходе 2.
//
// Проход 2 (сверху-вниз): от резервуара к потребителям.
//   Распределяем давление по сети с учётом суммарных расходов в трубах,
//   найденных на проходе 1. Пересчитываем расходы потребителей по реальному
//   давлению на их входе.
//
// Для сложных кольцевых сетей выполняем несколько итераций до сходимости.
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode, type TopoBranch } from "@/lib/topology";

export interface WaterNodeResult {
  nodeId: string;
  staticP: number;    // МПа — статическое давление (давление в узле)
  dynamicP: number;   // МПа — динамическое давление (потери на кране)
  flow: number;       // м³/ч — расход через узел (потребители)
  resistance: number; // МН·с²/м⁸ — гидравлическое сопротивление узла
  drainTime: number;  // мин — время истечения (только для резервуаров)
}

export interface WaterBranchResult {
  branchId: string;
  flow: number;           // м³/ч — суммарный расход в трубе
  velocity: number;       // м/с
  deltaP: number;         // МПа — потери давления
  resistance: number;     // МН·с²/м⁸
  reducerActive: boolean; // редуктор сработал (срезал давление)
  reducerInP: number;     // МПа — давление на входе клапана
  reducerOutP: number;    // МПа — давление на выходе клапана
  reducerDeltaP: number;  // МПа — сколько срезал клапан
  pumpActive?: boolean;   // насос повышает напор на этой ветви
  pumpHeadM?: number;     // м вод. ст. — напор насоса (суммарно)
  pumpDeltaP?: number;    // МПа — прибавка давления от насоса
}

// ─── Формулы ──────────────────────────────────────────────────────────────────

// Сопротивление трубы по Дарси-Вейсбаху (МН·с²/м⁸)
export function calcPipeResistance(
  lengthM: number,
  diamMm: number,
  roughnessMm: number,
  localXi: number,
): number {
  if (diamMm <= 0 || lengthM <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  const rho = 1000;
  const lambda = 0.11 * Math.pow(roughnessMm / diamMm, 0.25);
  const Rpa = (lambda * lengthM / d + localXi) / (A * A) * rho / 2;
  return Rpa / 1e6;
}

// Скорость воды (м/с)
export function calcPipeVelocity(flowM3h: number, diamMm: number): number {
  if (diamMm <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  return (flowM3h / 3600) / A;
}

// Потери давления в трубе (МПа): ΔP = R × Q|Q|
export function calcPipeDeltaP(flowM3h: number, resistanceMNs2m8: number): number {
  const flowM3s = flowM3h / 3600;
  return resistanceMNs2m8 * flowM3s * Math.abs(flowM3s);
}

// Сопротивление выходного отверстия крана (МН·с²/м⁸)
export function calcNozzleResistance(diamMm: number, mu = 0.82): number {
  if (diamMm <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  const rho = 1000;
  const muA = mu * A;
  return rho / (2 * muA * muA) / 1e6;
}

// Расход через потребитель: Q = √(ΔP / R) [м³/с] → м³/ч
export function calcConsumerFlow(pressureMPa: number, resistanceMNs2m8: number): number {
  if (resistanceMNs2m8 <= 0 || pressureMPa <= 0) return 0;
  const pressurePa = pressureMPa * 1e6;
  const R = resistanceMNs2m8 * 1e6;
  return Math.sqrt(pressurePa / R) * 3600;
}

// Время истечения резервуара (мин)
export function calcDrainTime(capacityM3: number, flowM3h: number): number {
  if (flowM3h <= 0) return 0;
  return (capacityM3 / flowM3h) * 60;
}

// ─── Вспомогательные типы для внутреннего расчёта ─────────────────────────────

interface NodePressure {
  nodeId: string;
  pressure: number; // МПа
}

// ─── Основная функция расчёта ──────────────────────────────────────────────────
export function calcWaterNetwork(
  nodes: TopoNode[],
  branches: TopoBranch[],
): { nodeResults: Map<string, WaterNodeResult>; branchResults: Map<string, WaterBranchResult> } {
  const nodeResults = new Map<string, WaterNodeResult>();
  const branchResults = new Map<string, WaterBranchResult>();

  // Только трубопроводные ветви
  const waterBranches = branches.filter(b => b.hasWaterPipe);
  if (waterBranches.length === 0) return { nodeResults, branchResults };

  // Инициализация: вычисляем сопротивление каждой трубы
  const pipeR = new Map<string, number>(); // branchId → R [МН·с²/м⁸]
  for (const b of waterBranches) {
    const len = b.wpLengthManual ? (b.wpLength ?? 0) : (b.length ?? 0);
    let R = 0;
    const mode = b.wpRoughnessMode ?? "rough";
    if (mode === "manual") {
      R = b.wpManualR ?? 0;
    } else {
      const roughness = mode === "smooth" ? 0.03 : (b.wpRoughness ?? 0.5);
      R = calcPipeResistance(len, b.wpDiameter ?? 100, roughness, b.wpLocalXi ?? 0);
    }
    pipeR.set(b.id, R);
    branchResults.set(b.id, {
      branchId: b.id, flow: 0, velocity: 0, deltaP: 0, resistance: R,
      reducerActive: false, reducerInP: 0, reducerOutP: 0, reducerDeltaP: 0,
    });
  }

  // Инициализируем результаты узлов
  for (const n of nodes) {
    const ft = n.fireNodeType ?? "none";
    if (ft === "none") continue;
    nodeResults.set(n.id, {
      nodeId: n.id,
      staticP: ft === "reservoir" ? (n.fireInitPressure ?? 0) : 0,
      dynamicP: 0, flow: 0, resistance: 0, drainTime: 0,
    });
  }

  // Собираем список резервуаров и потребителей
  const reservoirs = nodes.filter(n => (n.fireNodeType ?? "none") === "reservoir");
  const consumers  = nodes.filter(n =>
    (n.fireNodeType ?? "none") === "consumer" && (n.fireHydrantOpen ?? false),
  );
  if (reservoirs.length === 0) return { nodeResults, branchResults };

  // ─── Строим граф смежности только из water-ветвей ───────────────────────────
  // adj[nodeId] = [{branchId, neighborId}]
  const adj = new Map<string, { branchId: string; neighborId: string }[]>();
  const addAdj = (nid: string, branchId: string, neighborId: string) => {
    if (!adj.has(nid)) adj.set(nid, []);
    adj.get(nid)!.push({ branchId, neighborId });
  };
  for (const b of waterBranches) {
    addAdj(b.fromId, b.id, b.toId);
    addAdj(b.toId,   b.id, b.fromId);
  }

  // ─── Итерационный расчёт (3 итерации достаточно для нелинейной сети) ─────────
  // На каждой итерации:
  //   1. Top-down: распределяем давления от резервуаров
  //   2. Расходы потребителей по текущему давлению
  //   3. Bottom-up: суммируем расходы по ветвям от листьев к корню

  // Начальные расходы потребителей — используем давление резервуара как верхнюю оценку
  const consumerFlow = new Map<string, number>(); // nodeId → м³/ч
  const initP = reservoirs[0].fireInitPressure ?? 0;
  for (const c of consumers) {
    const mode = c.fireResistanceMode ?? "project";
    const nozR = mode === "project"
      ? calcNozzleResistance(c.fireHydrantDiameter ?? 0)
      : (c.fireManualR ?? 0);
    const q = nozR > 0 ? calcConsumerFlow(initP, nozR) : 0;
    consumerFlow.set(c.id, q);
  }

  const MAX_ITER = 5;
  let nodePressures = new Map<string, number>(); // nodeId → МПа

  for (let iter = 0; iter < MAX_ITER; iter++) {

    // ── Проход 1: Bottom-up — суммируем расходы по ветвям ────────────────────
    // Топологическая сортировка: BFS от листьев (потребителей) к резервуарам
    // branchFlow[branchId] = суммарный расход через трубу
    const branchFlow = new Map<string, number>();
    for (const b of waterBranches) branchFlow.set(b.id, 0);

    // Считаем количество «не-обработанных» соседей каждого узла (in-degree из листьев)
    const degree = new Map<string, number>();
    for (const b of waterBranches) {
      degree.set(b.fromId, (degree.get(b.fromId) ?? 0) + 1);
      degree.set(b.toId,   (degree.get(b.toId)   ?? 0) + 1);
    }

    // Накопленный расход: сколько воды «вытекает» из узла в сторону резервуара
    const nodeOutflow = new Map<string, number>(); // nodeId → м³/ч
    for (const c of consumers) nodeOutflow.set(c.id, consumerFlow.get(c.id) ?? 0);
    for (const r of reservoirs) nodeOutflow.set(r.id, 0);

    // BFS от потребителей к резервуарам по дереву трубопровода
    // Используем алгоритм Кана: начинаем с узлов, смежных только с одной ветвью
    // (листья дерева), и идём к корню (резервуару)
    const leafQueue: string[] = [];
    degree.forEach((deg, nid) => {
      if (deg <= 1 && !reservoirs.find(r => r.id === nid)) leafQueue.push(nid);
    });

    const processedEdges = new Set<string>();
    const bfsQueue = [...leafQueue];
    const bfsVisited = new Set<string>();

    while (bfsQueue.length > 0) {
      const nid = bfsQueue.shift()!;
      if (bfsVisited.has(nid)) continue;
      bfsVisited.add(nid);

      const outflow = nodeOutflow.get(nid) ?? 0;
      const edges = adj.get(nid) ?? [];

      // Находим «вышестоящую» ветвь (ту, что ближе к резервуару и ещё не обработана)
      // Если узел — не потребитель, его расход = сумма всех входящих расходов от листьев
      for (const { branchId, neighborId } of edges) {
        if (processedEdges.has(branchId)) continue;
        if (bfsVisited.has(neighborId)) continue; // сосед уже обработан — он ниже по потоку

        // Добавляем расход этой ветви
        const prevFlow = branchFlow.get(branchId) ?? 0;
        branchFlow.set(branchId, prevFlow + outflow);
        processedEdges.add(branchId);

        // Добавляем в очередь соседа, передавая ему расход
        const neighborOutflow = (nodeOutflow.get(neighborId) ?? 0) + outflow;
        nodeOutflow.set(neighborId, neighborOutflow);
        bfsQueue.push(neighborId);
        break; // от каждого листа только одна «вышестоящая» ветвь
      }
    }

    // ── Проход 2: Top-down — распределяем давления от резервуаров ───────────
    nodePressures = new Map<string, number>();
    for (const r of reservoirs) nodePressures.set(r.id, r.fireInitPressure ?? 0);

    const tdQueue: string[] = reservoirs.map(r => r.id);
    const tdVisited = new Set<string>();

    while (tdQueue.length > 0) {
      const nid = tdQueue.shift()!;
      if (tdVisited.has(nid)) continue;
      tdVisited.add(nid);

      const pNode = nodePressures.get(nid) ?? 0;
      const edges = adj.get(nid) ?? [];

      for (const { branchId, neighborId } of edges) {
        if (tdVisited.has(neighborId)) continue;

        const br = waterBranches.find(b => b.id === branchId)!;
        const R = pipeR.get(branchId) ?? 0;

        // Высотная поправка
        const fromNode = nodes.find(n => n.id === br.fromId);
        const toNode   = nodes.find(n => n.id === br.toId);
        const dz = fromNode && toNode ? (toNode.z - fromNode.z) : 0;
        const isFrom = br.fromId === nid;
        const deltaPh = 1000 * 9.81 * (isFrom ? dz : -dz) / 1e6;

        const pAvailRaw = Math.max(0, pNode - deltaPh);

        // Редукционный клапан
        const hasReducer = br.wpHasReducer ?? false;
        const reducerOutTarget = br.wpReducerOutPressure ?? 0.5;
        const reducerActive = hasReducer && pAvailRaw > reducerOutTarget;
        const pAvail = reducerActive ? reducerOutTarget : pAvailRaw;
        const reducerDeltaP = reducerActive ? pAvailRaw - reducerOutTarget : 0;

        // Суммарный расход в этой трубе (из bottom-up прохода)
        const flow = branchFlow.get(branchId) ?? 0;
        // Ограничение редуктором
        const maxFlow = hasReducer ? (br.wpReducerMaxFlow ?? 9999) : 9999;
        const flowEff = Math.min(flow, maxFlow);

        const deltaP = calcPipeDeltaP(flowEff, R);
        const pOut   = Math.max(0, pAvail - deltaP);
        const vel    = calcPipeVelocity(flowEff, br.wpDiameter ?? 100);

        branchResults.set(branchId, {
          branchId, flow: flowEff, velocity: vel, deltaP, resistance: R,
          reducerActive,
          reducerInP:   pAvailRaw,
          reducerOutP:  pAvail,
          reducerDeltaP,
        });

        // Давление в соседнем узле
        if (!nodePressures.has(neighborId) || pOut > (nodePressures.get(neighborId) ?? 0)) {
          nodePressures.set(neighborId, pOut);
        }
        tdQueue.push(neighborId);
      }
    }

    // ── Обновляем расходы потребителей по реальному давлению ─────────────────
    let maxChange = 0;
    for (const c of consumers) {
      const pAtNode = nodePressures.get(c.id) ?? 0;
      const mode = c.fireResistanceMode ?? "project";
      const nozR = mode === "project"
        ? calcNozzleResistance(c.fireHydrantDiameter ?? 0)
        : (c.fireManualR ?? 0);
      const newQ = nozR > 0 ? calcConsumerFlow(pAtNode, nozR) : 0;
      const oldQ = consumerFlow.get(c.id) ?? 0;
      maxChange = Math.max(maxChange, Math.abs(newQ - oldQ));
      consumerFlow.set(c.id, newQ);
    }

    // Сходимость: если изменение < 0.01 м³/ч — останавливаемся
    if (maxChange < 0.01) break;
  }

  // ─── Записываем финальные результаты узлов ────────────────────────────────
  for (const n of nodes) {
    const ft = n.fireNodeType ?? "none";
    if (ft === "none") continue;

    const pAtNode = nodePressures.get(n.id) ?? (ft === "reservoir" ? (n.fireInitPressure ?? 0) : 0);

    if (ft === "consumer") {
      const isOpen = n.fireHydrantOpen ?? false;
      if (!isOpen) {
        // Закрытый кран: только статическое давление
        nodeResults.set(n.id, {
          nodeId: n.id, staticP: pAtNode,
          dynamicP: 0, flow: 0, resistance: 0, drainTime: 0,
        });
      } else {
        const mode = n.fireResistanceMode ?? "project";
        const nozR = mode === "project"
          ? calcNozzleResistance(n.fireHydrantDiameter ?? 0)
          : (n.fireManualR ?? 0);
        const flow = consumerFlow.get(n.id) ?? 0;
        const dynP = nozR > 0 ? calcPipeDeltaP(flow, nozR) : 0;
        nodeResults.set(n.id, {
          nodeId: n.id,
          staticP: pAtNode + dynP,  // полное давление (статика + динамика)
          dynamicP: dynP,
          flow,
          resistance: nozR,
          drainTime: 0,
        });
      }
    } else if (ft === "reservoir") {
      // Суммарный расход резервуара = сумма всех потребителей
      const totalFlow = consumers.reduce((s, c) => s + (consumerFlow.get(c.id) ?? 0), 0);
      const capacity  = n.fireCapacity ?? 0;
      nodeResults.set(n.id, {
        nodeId: n.id,
        staticP: n.fireInitPressure ?? 0,
        dynamicP: 0,
        flow: totalFlow,
        resistance: 0,
        drainTime: calcDrainTime(capacity, totalFlow),
      });
    } else {
      // junction — давление в узле
      nodeResults.set(n.id, {
        nodeId: n.id, staticP: pAtNode,
        dynamicP: 0, flow: 0, resistance: 0, drainTime: 0,
      });
    }
  }

  return { nodeResults, branchResults };
}