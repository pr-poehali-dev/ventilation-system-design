"""
Гидравлический расчёт водопроводной сети ППЗ.

Метод: двухпроходный (bottom-up расходы → top-down давления), до 5 итераций.

POST: {
  nodes: [{id, fireNodeType, fireInitPressure, fireCapacity,
           fireHydrantOpen, fireHydrantDiameter, fireResistanceMode,
           fireManualR, z}],
  branches: [{id, fromId, toId,
              hasWaterPipe, wpDiameter, wpLengthManual, wpLength, length,
              wpRoughnessMode, wpRoughness, wpManualR, wpLocalXi,
              wpHasReducer, wpReducerOutPressure, wpReducerMaxFlow, z,
              wpHasPump, wpPumpHead, wpPumpReverse}]
}

Насос повышает напор в направлении своего потока (аналог редукционного
клапана, но наоборот): P += ρ·g·H / 1e6, где H — напор насоса в м вод.ст.

"""
import json, math, collections

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


# ─── Формулы ──────────────────────────────────────────────────────────────────

def calc_pipe_resistance(length_m, diam_mm, roughness_mm, local_xi):
    if diam_mm <= 0 or length_m <= 0:
        return 0.0
    d = diam_mm / 1000.0
    A = math.pi * d * d / 4.0
    rho = 1000.0
    lam = 0.11 * (roughness_mm / diam_mm) ** 0.25
    R_pa = (lam * length_m / d + local_xi) / (A * A) * rho / 2.0
    return R_pa / 1e6


def calc_pipe_velocity(flow_m3h, diam_mm):
    if diam_mm <= 0:
        return 0.0
    d = diam_mm / 1000.0
    A = math.pi * d * d / 4.0
    return (flow_m3h / 3600.0) / A


def calc_pipe_delta_p(flow_m3h, resistance):
    flow_m3s = flow_m3h / 3600.0
    return resistance * flow_m3s * abs(flow_m3s)


def calc_nozzle_resistance(diam_mm, mu=0.82):
    if diam_mm <= 0:
        return 0.0
    d = diam_mm / 1000.0
    A = math.pi * d * d / 4.0
    rho = 1000.0
    mu_a = mu * A
    return rho / (2.0 * mu_a * mu_a) / 1e6


def calc_consumer_flow(pressure_mpa, resistance):
    if resistance <= 0 or pressure_mpa <= 0:
        return 0.0
    pressure_pa = pressure_mpa * 1e6
    R = resistance * 1e6
    return math.sqrt(pressure_pa / R) * 3600.0


def calc_drain_time(capacity_m3, flow_m3h):
    if flow_m3h <= 0:
        return 0.0
    return (capacity_m3 / flow_m3h) * 60.0


# ─── Основной расчёт ──────────────────────────────────────────────────────────

def calc_water_network(nodes_in, branches_in):
    node_results   = {}
    branch_results = {}

    # Ветви с закрытым запорным вентилем (wpHasGate + wpGateClosed) полностью
    # исключаются из графа — вода через них не течёт, участок перекрыт.
    def _gate_closed(b):
        return bool(b.get("wpHasGate")) and bool(b.get("wpGateClosed"))

    water_branches = [b for b in branches_in if b.get("hasWaterPipe") and not _gate_closed(b)]

    # Для перекрытых ветвей всё равно выдаём нулевой результат, чтобы UI показывал
    # трубу как перекрытую (flow=0), а не «нет данных».
    for b in branches_in:
        if b.get("hasWaterPipe") and _gate_closed(b):
            branch_results[b["id"]] = {
                "branchId": b["id"], "flow": 0.0, "velocity": 0.0,
                "deltaP": 0.0, "resistance": 0.0,
                "reducerActive": False, "reducerInP": 0.0,
                "reducerOutP": 0.0, "reducerDeltaP": 0.0,
                "pumpActive": False, "pumpHeadM": 0.0, "pumpDeltaP": 0.0,
            }

    if not water_branches:
        return {"nodeResults": node_results, "branchResults": branch_results}

    # Сопротивление каждой трубы
    pipe_r = {}
    for b in water_branches:
        bid = b["id"]
        length = b.get("wpLength") if b.get("wpLengthManual") else b.get("length", 0)
        length = float(length or 0)
        mode = b.get("wpRoughnessMode", "rough")
        if mode == "manual":
            R = float(b.get("wpManualR", 0) or 0)
        else:
            roughness = 0.03 if mode == "smooth" else float(b.get("wpRoughness", 0.5) or 0.5)
            R = calc_pipe_resistance(length, float(b.get("wpDiameter", 100) or 100),
                                     roughness, float(b.get("wpLocalXi", 0) or 0))
        pipe_r[bid] = R
        branch_results[bid] = {
            "branchId": bid, "flow": 0.0, "velocity": 0.0,
            "deltaP": 0.0, "resistance": R,
            "reducerActive": False, "reducerInP": 0.0,
            "reducerOutP": 0.0, "reducerDeltaP": 0.0,
            "pumpActive": False, "pumpHeadM": 0.0, "pumpDeltaP": 0.0,
        }

    # Узлы
    node_map = {n["id"]: n for n in nodes_in}
    reservoirs = [n for n in nodes_in if (n.get("fireNodeType") or "none") == "reservoir"]
    consumers  = [n for n in nodes_in if (n.get("fireNodeType") or "none") == "consumer"
                  and n.get("fireHydrantOpen")]

    for n in nodes_in:
        ft = n.get("fireNodeType") or "none"
        if ft == "none":
            continue
        node_results[n["id"]] = {
            "nodeId": n["id"],
            "staticP": float(n.get("fireInitPressure", 0) or 0) if ft == "reservoir" else 0.0,
            "dynamicP": 0.0, "flow": 0.0, "resistance": 0.0, "drainTime": 0.0,
        }

    if not reservoirs:
        return {"nodeResults": node_results, "branchResults": branch_results}

    # Граф смежности
    adj = collections.defaultdict(list)
    for b in water_branches:
        adj[b["fromId"]].append({"branchId": b["id"], "neighborId": b["toId"]})
        adj[b["toId"]].append({"branchId": b["id"], "neighborId": b["fromId"]})

    reservoir_ids = {r["id"] for r in reservoirs}

    # Начальные расходы потребителей
    init_p = float(reservoirs[0].get("fireInitPressure", 0) or 0)
    consumer_flow = {}
    for c in consumers:
        mode = c.get("fireResistanceMode", "project")
        noz_r = calc_nozzle_resistance(float(c.get("fireHydrantDiameter", 0) or 0)) \
                if mode == "project" else float(c.get("fireManualR", 0) or 0)
        consumer_flow[c["id"]] = calc_consumer_flow(init_p, noz_r) if noz_r > 0 else 0.0

    node_pressures = {}
    MAX_ITER = 5

    for _iter in range(MAX_ITER):

        # ── Проход 1: Bottom-up ──────────────────────────────────────────────
        branch_flow = {b["id"]: 0.0 for b in water_branches}
        degree = collections.defaultdict(int)
        for b in water_branches:
            degree[b["fromId"]] += 1
            degree[b["toId"]]   += 1

        node_outflow = {}
        for c in consumers:
            node_outflow[c["id"]] = consumer_flow.get(c["id"], 0.0)
        for r in reservoirs:
            node_outflow[r["id"]] = 0.0

        leaf_queue = [nid for nid, deg in degree.items()
                      if deg <= 1 and nid not in reservoir_ids]
        bfs_queue   = collections.deque(leaf_queue)
        bfs_visited = set()
        processed_edges = set()

        while bfs_queue:
            nid = bfs_queue.popleft()
            if nid in bfs_visited:
                continue
            bfs_visited.add(nid)
            outflow = node_outflow.get(nid, 0.0)
            for edge in adj[nid]:
                bid, nbr = edge["branchId"], edge["neighborId"]
                if bid in processed_edges:
                    continue
                if nbr in bfs_visited:
                    continue
                branch_flow[bid] = branch_flow.get(bid, 0.0) + outflow
                processed_edges.add(bid)
                node_outflow[nbr] = node_outflow.get(nbr, 0.0) + outflow
                bfs_queue.append(nbr)
                break

        # ── Проход 2: Top-down ───────────────────────────────────────────────
        node_pressures = {}
        for r in reservoirs:
            node_pressures[r["id"]] = float(r.get("fireInitPressure", 0) or 0)

        td_queue   = collections.deque(r["id"] for r in reservoirs)
        td_visited = set()
        b_map = {b["id"]: b for b in water_branches}

        while td_queue:
            nid = td_queue.popleft()
            if nid in td_visited:
                continue
            td_visited.add(nid)
            p_node = node_pressures.get(nid, 0.0)

            for edge in adj[nid]:
                bid, nbr = edge["branchId"], edge["neighborId"]
                if nbr in td_visited:
                    continue
                br = b_map[bid]
                R  = pipe_r.get(bid, 0.0)

                from_n = node_map.get(br["fromId"])
                to_n   = node_map.get(br["toId"])
                dz = (float(to_n.get("z", 0) or 0) - float(from_n.get("z", 0) or 0)) \
                     if from_n and to_n else 0.0
                is_from = br["fromId"] == nid
                delta_ph = 1000.0 * 9.81 * (dz if is_from else -dz) / 1e6

                p_avail_raw = max(0.0, p_node - delta_ph)

                has_reducer      = bool(br.get("wpHasReducer"))
                reducer_target   = float(br.get("wpReducerOutPressure", 0.5) or 0.5)
                reducer_active   = has_reducer and p_avail_raw > reducer_target
                p_avail          = reducer_target if reducer_active else p_avail_raw
                reducer_delta    = p_avail_raw - reducer_target if reducer_active else 0.0

                # ── Насос: повышает напор в направлении своего потока ──────────
                # wpPumpHead — суммарный напор насоса, м вод.ст. (с учётом
                # параллельных). Переводим в МПа: P = ρ·g·H / 1e6.
                # По умолчанию насос качает по направлению ветви from→to; при
                # реверсе (wpPumpReverse) — против. Напор добавляем только когда
                # обход top-down идёт в ту же сторону, что качает насос.
                has_pump   = bool(br.get("wpHasPump"))
                pump_head_m = float(br.get("wpPumpHead", 0) or 0) if has_pump else 0.0
                pump_reverse = bool(br.get("wpPumpReverse"))
                pump_delta = 0.0
                if has_pump and pump_head_m > 0:
                    # Направление качания насоса (from→to) с учётом реверса
                    pump_dir_from_to = not pump_reverse
                    # Обход идёт от текущего узла nid; is_from=True → идём from→to
                    if is_from == pump_dir_from_to:
                        pump_delta = 1000.0 * 9.81 * pump_head_m / 1e6
                p_avail = p_avail + pump_delta

                flow     = branch_flow.get(bid, 0.0)
                max_flow = float(br.get("wpReducerMaxFlow", 9999) or 9999) if has_reducer else 9999.0
                flow_eff = min(flow, max_flow)

                delta_p = calc_pipe_delta_p(flow_eff, R)
                p_out   = max(0.0, p_avail - delta_p)
                vel     = calc_pipe_velocity(flow_eff, float(br.get("wpDiameter", 100) or 100))

                branch_results[bid] = {
                    "branchId": bid, "flow": round(flow_eff, 3),
                    "velocity": round(vel, 3), "deltaP": round(delta_p, 4),
                    "resistance": round(R, 6),
                    "reducerActive": reducer_active,
                    "reducerInP":    round(p_avail_raw, 4),
                    "reducerOutP":   round(p_avail, 4),
                    "reducerDeltaP": round(reducer_delta, 4),
                    "pumpActive":    has_pump and pump_delta > 0,
                    "pumpHeadM":     round(pump_head_m, 2),
                    "pumpDeltaP":    round(pump_delta, 4),
                    "flowFromTo":    is_from,
                }

                prev = node_pressures.get(nbr)
                if prev is None or p_out > prev:
                    node_pressures[nbr] = p_out
                td_queue.append(nbr)

        # ── Обновляем расходы потребителей ───────────────────────────────────
        max_change = 0.0
        for c in consumers:
            p_at = node_pressures.get(c["id"], 0.0)
            mode = c.get("fireResistanceMode", "project")
            noz_r = calc_nozzle_resistance(float(c.get("fireHydrantDiameter", 0) or 0)) \
                    if mode == "project" else float(c.get("fireManualR", 0) or 0)
            new_q = calc_consumer_flow(p_at, noz_r) if noz_r > 0 else 0.0
            old_q = consumer_flow.get(c["id"], 0.0)
            max_change = max(max_change, abs(new_q - old_q))
            consumer_flow[c["id"]] = new_q

        if max_change < 0.01:
            break

    # ── Финальные результаты узлов ────────────────────────────────────────────
    for n in nodes_in:
        ft = n.get("fireNodeType") or "none"
        if ft == "none":
            continue
        nid   = n["id"]
        p_at  = node_pressures.get(nid,
                float(n.get("fireInitPressure", 0) or 0) if ft == "reservoir" else 0.0)

        if ft == "consumer":
            is_open = bool(n.get("fireHydrantOpen"))
            if not is_open:
                node_results[nid] = {
                    "nodeId": nid, "staticP": round(p_at, 4),
                    "dynamicP": 0.0, "flow": 0.0, "resistance": 0.0, "drainTime": 0.0,
                }
            else:
                mode  = n.get("fireResistanceMode", "project")
                noz_r = calc_nozzle_resistance(float(n.get("fireHydrantDiameter", 0) or 0)) \
                        if mode == "project" else float(n.get("fireManualR", 0) or 0)
                flow  = consumer_flow.get(nid, 0.0)
                dyn_p = calc_pipe_delta_p(flow, noz_r) if noz_r > 0 else 0.0
                node_results[nid] = {
                    "nodeId": nid,
                    "staticP":   round(p_at + dyn_p, 4),
                    "dynamicP":  round(dyn_p, 4),
                    "flow":      round(flow, 3),
                    "resistance": round(noz_r, 6),
                    "drainTime": 0.0,
                }
        elif ft == "reservoir":
            total_flow = sum(consumer_flow.get(c["id"], 0.0) for c in consumers)
            capacity   = float(n.get("fireCapacity", 0) or 0)
            node_results[nid] = {
                "nodeId": nid,
                "staticP":   round(float(n.get("fireInitPressure", 0) or 0), 4),
                "dynamicP":  0.0,
                "flow":      round(total_flow, 3),
                "resistance": 0.0,
                "drainTime": round(calc_drain_time(capacity, total_flow), 1),
            }
        else:
            node_results[nid] = {
                "nodeId": nid, "staticP": round(p_at, 4),
                "dynamicP": 0.0, "flow": 0.0, "resistance": 0.0, "drainTime": 0.0,
            }

    return {"nodeResults": node_results, "branchResults": branch_results}


def handler(event: dict, context) -> dict:
    """Гидравлический расчёт сети противопожарного водоснабжения (ППЗ)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body       = json.loads(event.get("body") or "{}")
    nodes_in   = body.get("nodes", [])
    branches_in = body.get("branches", [])

    result = calc_water_network(nodes_in, branches_in)

    # Конвертируем dict-ключи в списки для JSON (Map → array)
    out = {
        "nodeResults":   list(result["nodeResults"].values()),
        "branchResults": list(result["branchResults"].values()),
    }
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(out, ensure_ascii=False)}