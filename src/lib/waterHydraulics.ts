// ─────────────────────────────────────────────────────────────────────────────
// Гидравлический расчёт водопроводной сети ППЗ
// Метод: последовательное распределение давлений и расходов
// ─────────────────────────────────────────────────────────────────────────────

import { type TopoNode, type TopoBranch } from "@/lib/topology";

export interface WaterNodeResult {
  nodeId: string;
  staticP: number;    // МПа — статическое давление
  dynamicP: number;   // МПа — динамическое давление
  flow: number;       // м³/ч — расход через узел (потребители)
  resistance: number; // МН·с²/м⁸ — гидравлическое сопротивление узла
  drainTime: number;  // мин — время истечения (только для резервуаров)
}

export interface WaterBranchResult {
  branchId: string;
  flow: number;       // м³/ч
  velocity: number;   // м/с
  deltaP: number;     // МПа — потери давления
  resistance: number; // МН·с²/м⁸
}

// Расчёт гидравлического сопротивления трубы (МН·с²/м⁸)
// Используется формула Дарси-Вейсбаха для напорного трубопровода
export function calcPipeResistance(
  lengthM: number,     // длина, м
  diamMm: number,      // внутренний диаметр, мм
  roughnessMm: number, // абс. шероховатость, мм
  localXi: number,     // сумма ξ местных сопротивлений
): number {
  if (diamMm <= 0 || lengthM <= 0) return 0;
  const d = diamMm / 1000;           // м
  const A = Math.PI * d * d / 4;    // м²
  const rho = 1000;                  // кг/м³ — плотность воды
  // Коэффициент Дарси по формуле Шифринсона (приближение для турбулентного режима)
  const lambda = 0.11 * Math.pow(roughnessMm / diamMm, 0.25);
  // R = λ·L/(d·A²) + Σξ/(A²) — в системе Па/(м³/с)²
  const Rpa = (lambda * lengthM / d + localXi) / (A * A) * rho / 2;
  // Переводим в МН·с²/м⁸ (1 МН·с²/м⁸ = 1e6 Па·с²/м⁶ = 1e6/(3600²) Па/(м³/ч)²)
  // Р = R × Q²: Q в м³/с → переводим R в МН·с²/м⁸
  // R [Па/(м³/с)²] → R [МН·с²/м⁸]: 1 МН = 1e6 Н, 1 Па = 1 Н/м², поэтому R_MN = Rpa / 1e6
  return Rpa / 1e6;
}

// Расчёт скорости (м/с) по расходу (м³/ч) и диаметру (мм)
export function calcPipeVelocity(flowM3h: number, diamMm: number): number {
  if (diamMm <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  const flowM3s = flowM3h / 3600;
  return flowM3s / A;
}

// Расчёт потерь давления в трубе (МПа) по расходу (м³/ч) и сопротивлению (МН·с²/м⁸)
export function calcPipeDeltaP(flowM3h: number, resistanceMNs2m8: number): number {
  const flowM3s = flowM3h / 3600;
  return resistanceMNs2m8 * flowM3s * Math.abs(flowM3s);
}

// Расчёт гидравлического сопротивления выходного отверстия потребителя
// Используется формула истечения через отверстие Q = μ·A·√(2·ΔP/ρ)
// Отсюда: R = ρ / (2 · (μ·A)²) [Па/(м³/с)²]
export function calcNozzleResistance(
  diamMm: number,  // диаметр отверстия, мм
  mu = 0.82,       // коэффициент расхода (0.82 для пожарного крана)
): number {
  if (diamMm <= 0) return 0;
  const d = diamMm / 1000;
  const A = Math.PI * d * d / 4;
  const rho = 1000;
  const muA = mu * A;
  return rho / (2 * muA * muA) / 1e6;  // МН·с²/м⁸
}

// Расчёт расхода через потребитель по давлению и сопротивлению
// Q = √(ΔP / R) [м³/с], переводим в м³/ч
export function calcConsumerFlow(pressureMPa: number, resistanceMNs2m8: number): number {
  if (resistanceMNs2m8 <= 0 || pressureMPa <= 0) return 0;
  const pressurePa = pressureMPa * 1e6;
  const R = resistanceMNs2m8 * 1e6;
  const flowM3s = Math.sqrt(pressurePa / R);
  return flowM3s * 3600;  // м³/ч
}

// Расчёт времени истечения резервуара (мин)
// t = V / Q [с] → [мин]
export function calcDrainTime(capacityM3: number, flowM3h: number): number {
  if (flowM3h <= 0) return 0;
  return (capacityM3 / flowM3h) * 60;  // мин
}

// ─── Основная функция расчёта сети ────────────────────────────────────────────
export function calcWaterNetwork(
  nodes: TopoNode[],
  branches: TopoBranch[],
): { nodeResults: Map<string, WaterNodeResult>; branchResults: Map<string, WaterBranchResult> } {
  const nodeResults = new Map<string, WaterNodeResult>();
  const branchResults = new Map<string, WaterBranchResult>();

  // Инициализируем все fire-узлы
  for (const n of nodes) {
    const ft = n.fireNodeType ?? "none";
    if (ft === "none") continue;
    nodeResults.set(n.id, {
      nodeId: n.id,
      staticP: ft === "reservoir" ? (n.fireInitPressure ?? 0) : 0,
      dynamicP: 0,
      flow: 0,
      resistance: 0,
      drainTime: 0,
    });
  }

  // Инициализируем ветви с водопроводами
  for (const b of branches) {
    if (!b.hasWaterPipe) continue;
    const len = b.wpLengthManual ? (b.wpLength ?? 0) : (b.length ?? 0);
    let R = 0;
    const mode = b.wpRoughnessMode ?? "rough";
    if (mode === "manual") {
      R = b.wpManualR ?? 0;
    } else {
      const roughness = mode === "smooth" ? 0.03 : (b.wpRoughness ?? 0.5);
      R = calcPipeResistance(len, b.wpDiameter ?? 100, roughness, b.wpLocalXi ?? 0);
    }
    branchResults.set(b.id, {
      branchId: b.id, flow: 0, velocity: 0, deltaP: 0, resistance: R,
    });
  }

  // Простой расчёт: распространяем давление от резервуаров к потребителям
  // (однократный проход без итераций — для простых линейных сетей)
  const waterBranches = branches.filter(b => b.hasWaterPipe);

  // BFS от резервуаров
  const pressureMap = new Map<string, number>();
  const queue: string[] = [];

  for (const n of nodes) {
    if ((n.fireNodeType ?? "none") === "reservoir") {
      const p = n.fireInitPressure ?? 0;
      pressureMap.set(n.id, p);
      // Учитываем высотное давление: ΔP = ρgh / 1e6 МПа
      queue.push(n.id);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const pIn = pressureMap.get(nodeId) ?? 0;

    for (const br of waterBranches) {
      const isFrom = br.fromId === nodeId;
      const isTo = br.toId === nodeId;
      if (!isFrom && !isTo) continue;

      const neighborId = isFrom ? br.toId : br.fromId;
      if (visited.has(neighborId)) continue;

      const brRes = branchResults.get(br.id);
      if (!brRes) continue;

      // Учитываем разность высот: Δz в метрах → ΔP = ρgh / 1e6
      const fromNode = nodes.find(n => n.id === br.fromId);
      const toNode = nodes.find(n => n.id === br.toId);
      const dz = fromNode && toNode ? (toNode.z - fromNode.z) : 0;
      const deltaPh = 1000 * 9.81 * (isFrom ? dz : -dz) / 1e6; // МПа

      // Предварительный расход (по максимально возможному давлению)
      const pAvail = Math.max(0, pIn - deltaPh);
      const neighborNode = nodes.find(n => n.id === neighborId);
      const neighborFt = neighborNode?.fireNodeType ?? "none";

      let flow = 0;
      if (neighborFt === "consumer" && neighborNode) {
        // Кран закрыт → расход 0, давление не падает
        const isOpen = neighborNode.fireHydrantOpen ?? false;
        if (isOpen) {
          const mode = neighborNode.fireResistanceMode ?? "project";
          let nozR = 0;
          if (mode === "project") {
            nozR = calcNozzleResistance(neighborNode.fireHydrantDiameter ?? 0);
          } else {
            nozR = neighborNode.fireManualR ?? 0;
          }
          const totalR = brRes.resistance + nozR;
          flow = totalR > 0 ? calcConsumerFlow(pAvail, totalR) : 0;
        }
      }
      // junction и все остальные — flow=0, просто передаём давление дальше

      const deltaP = calcPipeDeltaP(flow, brRes.resistance);
      const pOut = Math.max(0, pAvail - deltaP);
      const vel = calcPipeVelocity(flow, br.wpDiameter ?? 100);

      branchResults.set(br.id, { ...brRes, flow, velocity: vel, deltaP });
      pressureMap.set(neighborId, pOut);

      if (neighborNode) {
        const isOpen = neighborFt === "consumer" ? (neighborNode.fireHydrantOpen ?? false) : true;
        const nozR = (() => {
          if (neighborFt !== "consumer" || !isOpen) return 0;
          const mode = neighborNode.fireResistanceMode ?? "project";
          return mode === "project"
            ? calcNozzleResistance(neighborNode.fireHydrantDiameter ?? 0)
            : (neighborNode.fireManualR ?? 0);
        })();
        const nFlow = nozR > 0 ? calcConsumerFlow(pOut, nozR) : 0;
        const dynP = nozR > 0 ? calcPipeDeltaP(nFlow, nozR) : 0;
        const drainT = neighborFt === "reservoir"
          ? calcDrainTime(neighborNode.fireCapacity ?? 0, flow)
          : 0;

        nodeResults.set(neighborId, {
          nodeId: neighborId,
          staticP: pOut + (neighborFt === "consumer" && !isOpen ? 0 : dynP),
          dynamicP: dynP,
          flow: nFlow,
          resistance: nozR,
          drainTime: drainT,
        });
      }

      queue.push(neighborId);
    }
  }

  // Обновляем время истечения для резервуаров
  for (const n of nodes) {
    if ((n.fireNodeType ?? "none") !== "reservoir") continue;
    // Суммарный расход из резервуара
    let totalFlow = 0;
    for (const br of waterBranches) {
      if (br.fromId === n.id || br.toId === n.id) {
        totalFlow += branchResults.get(br.id)?.flow ?? 0;
      }
    }
    const res = nodeResults.get(n.id);
    if (res) {
      nodeResults.set(n.id, {
        ...res,
        flow: totalFlow,
        drainTime: calcDrainTime(n.fireCapacity ?? 0, totalFlow),
      });
    }
  }

  return { nodeResults, branchResults };
}