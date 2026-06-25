"""
Расчёт времени хода горноспасателей по горным выработкам.
Алгоритм Дейкстры с учётом задымления, скоростей ВГСЧ, расхода кислорода ИДА.
Источник методики: РД 15-11-2007, ГОСТ Р 22.0.007.

POST: {
  nodes: [{id, name, number, x, y, z}],
  branches: [{id, fromId, toId, length, angle, area, name?,
              fireComputedSmokeDens?, fireComputedCO?, flow?,
              hasBulkhead?, bulkheadId?, isLeakage?}],
  startNodeId: str,
  targetNodeId: str,
  params: {
    operationType, useAirTemp, useIdaTime, idaWorkTime,
    provideCare, careTime, useInterpolation,
    oxygenConsumption, oxygenVolume,
    waypointNodeIds?: [str]
  }
}
"""
import json, math, heapq

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


# ─── Нормативные скорости ─────────────────────────────────────────────────────
# Источник: Инструкция по локализации и ликвидации последствий аварий
# (пр. Ростехнадзора от 11.12.2020 N 520), Приложение 4.
#
# Базовые скорости в чистом воздухе (м/мин) — линейная интерполяция по углу:
#   подъём:  0°=45, 5°=37.5, 10°=30, 15°=24, 20°=20, 30°=14, 45°=10, 90°=6
#   спуск:   0°=45, 5°=42,   10°=39, 15°=34, 20°=28, 30°=22, 45°=15, 90°=10
#
# Коэффициент k3 по зонам задымления (Рв = 2 / smoke_density):
#   k3 = 1.00 — чистый воздух (Рв > 10 м)
#   k3 = 1.43 — слабое задымление (Рв 5–10 м)
#   k3 = 2.00 — густое задымление (Рв < 5 м)

_SPEED_TABLE = [
    # (angle, v_up, v_down)
    (0,   45.0, 45.0),
    (5,   37.5, 42.0),
    (10,  30.0, 39.0),
    (15,  24.0, 34.0),
    (20,  20.0, 28.0),
    (30,  14.0, 22.0),
    (45,  10.0, 15.0),
    (90,   6.0, 10.0),
]

def get_base_speed(angle_deg: float) -> float:
    a = abs(angle_deg)
    is_down = angle_deg < 0
    for i in range(len(_SPEED_TABLE) - 1):
        a0, u0, d0 = _SPEED_TABLE[i]
        a1, u1, d1 = _SPEED_TABLE[i + 1]
        if a0 <= a <= a1:
            t = (a - a0) / (a1 - a0)
            return (d0 + t * (d1 - d0)) if is_down else (u0 + t * (u1 - u0))
    return 10.0 if is_down else 6.0

def get_speed(zone: str, angle_deg: float) -> float:
    v = get_base_speed(angle_deg)
    if zone == "clean":      return v
    if zone == "smoky_low":  return v / 1.43
    return v / 2.0


def get_zone(smoke_density: float) -> str:
    if smoke_density <= 0.001:
        return "clean"
    vis = 2.0 / smoke_density
    if vis >= 10: return "clean"
    if vis >= 5:  return "smoky_low"
    return "smoky_high"


# ─── Проходимость перемычки ────────────────────────────────────────────────────

def is_bulkhead_passable(bulkhead_id: str) -> bool:
    if not bulkhead_id:
        return False
    bid = bulkhead_id.lower()
    if bid.startswith("solid_") or bid.startswith("bk_"):
        return False
    if bid in ("bulkhead", "bulkhead_concrete", "bulkhead_wood",
               "bulkhead_brick", "bulkhead_metal"):
        return False
    if bid.startswith("water_dam") or bid.startswith("water_"):
        return False
    if bid in ("bulkhead_barrier", "barrier"):
        return False
    if bid == "sail":
        return True
    if (bid.startswith("door_") or bid.startswith("auto_") or bid.startswith("open_")
            or bid.startswith("win_") or bid.startswith("lat_") or bid.startswith("proem_")):
        return True
    if bid.startswith("regulator_") or bid == "regulator":
        return True
    if bid in ("fire_door", "fire_door_pp"):
        return True
    return False


# ─── Дейкстра ─────────────────────────────────────────────────────────────────

def build_dijkstra(nodes, branch_map, adj, start_id):
    dist = {n["id"]: math.inf for n in nodes}
    prev = {n["id"]: None for n in nodes}
    dist[start_id] = 0.0

    heap = [(0.0, start_id)]
    visited = set()

    while heap:
        cur_d, cur = heapq.heappop(heap)
        if cur in visited:
            continue
        visited.add(cur)
        for edge in adj.get(cur, []):
            b = branch_map.get(edge["branchId"])
            if not b:
                continue
            smoke_dens = float(b.get("fireComputedSmokeDens") or 0)
            signed_angle = float(b.get("angle") or 0) * (1 if edge["forward"] else -1)
            zone = get_zone(smoke_dens)
            speed = get_speed(zone, signed_angle)
            length = float(b.get("length") or 0)
            t = length / speed if speed > 0 and length > 0 else 0
            nd = cur_d + t
            nbr = edge["toId"]
            if nd < dist.get(nbr, math.inf):
                dist[nbr] = nd
                prev[nbr] = {"nodeId": cur, "branchId": b["id"], "forward": edge["forward"]}
                heapq.heappush(heap, (nd, nbr))

    return dist, prev


def build_path(prev, to_id):
    path = []
    cur = to_id
    while cur and prev.get(cur) is not None:
        p = prev[cur]
        path.insert(0, {"nodeId": p["nodeId"], "branchId": p["branchId"], "forward": p["forward"]})
        cur = p["nodeId"]
    return path


# ─── Построение сегментов маршрута ────────────────────────────────────────────

def build_segments(edges, branch_map, node_map, o2c):
    result = []
    cum_time = 0.0
    cum_o2 = 0.0

    for i, edge in enumerate(edges):
        b = branch_map.get(edge["branchId"])
        if not b:
            continue
        is_forward = edge["forward"]
        smoke_dens = float(b.get("fireComputedSmokeDens") or 0)
        zone = get_zone(smoke_dens)
        signed_angle = float(b.get("angle") or 0) * (1 if is_forward else -1)

        speed    = get_speed(zone, signed_angle)
        speed_cl = get_speed("clean",      signed_angle)
        speed_sl = get_speed("smoky_low",  signed_angle)
        speed_sh = get_speed("smoky_high", signed_angle)
        length   = float(b.get("length") or 0)

        time_min        = length / speed    if speed > 0 and length > 0 else 0
        time_clean      = length / speed_cl if speed_cl > 0 and length > 0 else 0
        time_smoky_low  = length / speed_sl if speed_sl > 0 and length > 0 else 0
        time_smoky_high = length / speed_sh if speed_sh > 0 and length > 0 else 0

        o2_liters      = time_min * o2c
        o2_clean       = time_clean       * o2c
        o2_smoky_low   = time_smoky_low  * o2c
        o2_smoky_high  = time_smoky_high * o2c

        vis = 2.0 / smoke_dens if smoke_dens > 0 else 999

        from_node_id = b["fromId"] if is_forward else b["toId"]
        to_node_id   = b["toId"]   if is_forward else b["fromId"]
        from_node    = node_map.get(from_node_id, {})
        to_node      = node_map.get(to_node_id, {})

        cum_time += time_min
        cum_o2   += o2_liters

        speed_back = get_speed(zone, -signed_angle)
        time_back  = length / speed_back if speed_back > 0 and length > 0 else 0
        o2_back    = time_back * o2c

        branch_label = (b.get("name") or "").strip()
        node_from = from_node.get("name") or (f"Узел {from_node.get('number')}" if from_node.get("number") else from_node_id)
        node_to   = to_node.get("name")   or (f"Узел {to_node.get('number')}"   if to_node.get("number")   else to_node_id)
        branch_name = f"{branch_label} ({node_from} → {node_to})" if branch_label else f"{node_from} → {node_to}"

        result.append({
            "branchId":        b["id"],
            "branchName":      branch_name,
            "branchLabel":     branch_label,
            "segmentNumber":   i + 1,
            "length":          length,
            "angle":           signed_angle,
            "fromNodeId":      from_node_id,
            "toNodeId":        to_node_id,
            "smokeDensity":    smoke_dens,
            "coConc":          float(b.get("fireComputedCO") or 0),
            "visibility":      vis,
            "zone":            zone,
            "speed_mpm":       speed,
            "time_min":        round(time_min, 3),
            "time_back_min":   round(time_back, 3),
            "o2_liters":       round(o2_liters, 3),
            "o2_back_liters":  round(o2_back, 3),
            "cumulTime":       round(cum_time, 3),
            "cumulO2":         round(cum_o2, 3),
            "speed_clean":      speed_cl,
            "time_clean":       round(time_clean, 3),
            "o2_clean":         round(o2_clean, 3),
            "speed_smoky_low":  speed_sl,
            "time_smoky_low":   round(time_smoky_low, 3),
            "o2_smoky_low":     round(o2_smoky_low, 3),
            "speed_smoky_high": speed_sh,
            "time_smoky_high":  round(time_smoky_high, 3),
            "o2_smoky_high":    round(o2_smoky_high, 3),
        })

    return result


# ─── Основной расчёт ──────────────────────────────────────────────────────────

def calc_rescue(nodes, branches, start_node_id, target_node_id, params):
    warnings = []
    waypoint_ids = params.get("waypointNodeIds") or []
    o2c = float(params.get("oxygenConsumption") or 1.4)

    # Граф смежности
    adj = {n["id"]: [] for n in nodes}
    branch_map = {}
    for b in branches:
        branch_map[b["id"]] = b
        if b.get("isLeakage"):
            continue
        if float(b.get("length") or 0) <= 0:
            continue
        if b.get("hasBulkhead") and not is_bulkhead_passable(b.get("bulkheadId") or ""):
            continue
        if b["fromId"] in adj:
            adj[b["fromId"]].append({"toId": b["toId"], "branchId": b["id"], "forward": True})
        if b["toId"] in adj:
            adj[b["toId"]].append({"toId": b["fromId"], "branchId": b["id"], "forward": False})

    node_map = {n["id"]: n for n in nodes}

    # Маршрут: старт → [вайпоинты] → цель
    checkpoints = [start_node_id] + waypoint_ids + [target_node_id]
    all_path_edges = []
    route_ok = True

    for i in range(len(checkpoints) - 1):
        frm = checkpoints[i]
        to  = checkpoints[i + 1]
        dist, prev = build_dijkstra(nodes, branch_map, adj, frm)
        if dist.get(to, math.inf) == math.inf:
            warnings.append(f"Маршрут от узла {frm} до узла {to} не найден — проверьте связность сети")
            route_ok = False
            continue
        seg_edges = build_path(prev, to)
        all_path_edges.extend(seg_edges)

    segments = build_segments(all_path_edges, branch_map, node_map, o2c)
    back_edges = [{"nodeId": e["nodeId"], "branchId": e["branchId"], "forward": not e["forward"]}
                  for e in reversed(all_path_edges)]
    segments_back = build_segments(back_edges, branch_map, node_map, o2c)

    # Направления ветвей для подсветки
    branch_dirs = {e["branchId"]: e["forward"] for e in all_path_edges}

    # ── Логика включения обратного пути по типу операции ──────────────────────
    # "scout"       — только разведка туда, без обратного пути и помощи
    # "liquidation" — туда + работы на месте (care), без обратного пути
    # остальные     — туда + помощь + обратно
    op_type = params.get("operationType", "scout_and_transport")
    include_back = op_type not in ("scout", "liquidation")
    include_care = op_type != "scout"

    total_time_fwd = sum(s["time_min"] for s in segments)
    total_time_bck = sum(s["time_min"] for s in segments_back)
    total_o2_fwd   = sum(s["o2_liters"] for s in segments)
    total_o2_bck   = sum(s["o2_liters"] for s in segments_back)
    care_raw = float(params.get("careTime") or 10) if params.get("provideCare") else 0.0
    care = care_raw if include_care else 0.0
    eff_time_bck = total_time_bck if include_back else 0.0
    eff_o2_bck   = total_o2_bck   if include_back else 0.0

    smoke_segs = segments + (segments_back if include_back else [])
    ida_time_in_smoke = sum(s["time_min"]   for s in smoke_segs if s["zone"] != "clean")
    ida_o2_in_smoke   = sum(s["o2_liters"]  for s in smoke_segs if s["zone"] != "clean")

    total_time = total_time_fwd + care + eff_time_bck
    total_o2   = total_o2_fwd + care * o2c + eff_o2_bck

    fwd_cl = sum(s["time_clean"]      for s in segments)
    fwd_sl = sum(s["time_smoky_low"]  for s in segments)
    fwd_sh = sum(s["time_smoky_high"] for s in segments)
    bck_cl = sum(s["time_clean"]      for s in segments_back) if include_back else 0.0
    bck_sl = sum(s["time_smoky_low"]  for s in segments_back) if include_back else 0.0
    bck_sh = sum(s["time_smoky_high"] for s in segments_back) if include_back else 0.0
    total_time_cl = fwd_cl + care + bck_cl
    total_time_sl = fwd_sl + care + bck_sl
    total_time_sh = fwd_sh + care + bck_sh
    total_o2_cl = (sum(s["o2_clean"]     for s in segments) + care * o2c
                   + (sum(s["o2_clean"]     for s in segments_back) if include_back else 0.0))
    total_o2_sl = (sum(s["o2_smoky_low"]  for s in segments) + care * o2c
                   + (sum(s["o2_smoky_low"]  for s in segments_back) if include_back else 0.0))
    total_o2_sh = (sum(s["o2_smoky_high"] for s in segments) + care * o2c
                   + (sum(s["o2_smoky_high"] for s in segments_back) if include_back else 0.0))

    ida_work_time = float(params.get("idaWorkTime") or 400)
    o2_volume     = float(params.get("oxygenVolume") or 400)
    use_ida_time  = bool(params.get("useIdaTime"))

    ida_time_pct = total_time / ida_work_time * 100 if use_ida_time and ida_work_time > 0 else 0
    ida_o2_pct   = total_o2 / o2_volume * 100 if o2_volume > 0 else 0

    route_found = len(segments) > 0
    ok = route_found and (not use_ida_time or total_time <= ida_work_time) and total_o2 <= o2_volume

    if not ok:
        if use_ida_time and total_time > ida_work_time:
            warnings.append(f"Время операции {total_time:.1f} мин превышает ресурс ИДА {ida_work_time} мин")
        if total_o2 > o2_volume:
            warnings.append(f"Расход O₂ {total_o2:.1f} л превышает объём ИДА {o2_volume} л")
    if not route_ok and not segments:
        warnings.append("Маршрут не построен — проверьте начальный, промежуточные и целевой узлы")

    return {
        "targetNodeId":         target_node_id,
        "startNodeId":          start_node_id,
        "waypointNodeIds":      waypoint_ids,
        "operationType":        params.get("operationType", "scout"),
        "segments":             segments,
        "segmentsBack":         segments_back,
        "totalTime":            round(total_time, 2),
        "totalTimeForward":     round(total_time_fwd, 2),
        "totalTimeBack":        round(total_time_bck, 2),
        "careTime":             round(care, 2),
        "totalO2":              round(total_o2, 2),
        "totalO2Forward":       round(total_o2_fwd, 2),
        "totalO2Back":          round(total_o2_bck, 2),
        "o2IdaPercent":         round(ida_o2_pct, 1),
        "timeIdaPercent":       round(ida_time_pct, 1),
        "idaTimeInSmoke":       round(ida_time_in_smoke, 2),
        "idaO2InSmoke":         round(ida_o2_in_smoke, 2),
        "totalTime_clean":       round(total_time_cl, 2),
        "totalO2_clean":         round(total_o2_cl, 2),
        "totalTime_smoky_low":  round(total_time_sl, 2),
        "totalTime_smoky_high": round(total_time_sh, 2),
        "totalO2_smoky_low":    round(total_o2_sl, 2),
        "totalO2_smoky_high":   round(total_o2_sh, 2),
        "ok":                   ok,
        "warnings":             warnings,
        "branchDirs":           branch_dirs,
    }


def handler(event: dict, context) -> dict:
    """Расчёт маршрута горноспасателей (Дейкстра, РД 15-11-2007)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = json.loads(event.get("body") or "{}")
    nodes          = body.get("nodes", [])
    branches       = body.get("branches", [])
    start_node_id  = body.get("startNodeId", "")
    target_node_id = body.get("targetNodeId", "")
    params         = body.get("params", {})

    if not start_node_id or not target_node_id:
        return {"statusCode": 400, "headers": CORS,
                "body": json.dumps({"error": "startNodeId и targetNodeId обязательны"})}

    result = calc_rescue(nodes, branches, start_node_id, target_node_id, params)
    return {"statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": result}