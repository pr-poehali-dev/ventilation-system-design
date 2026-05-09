"""
VentCore — расчётное ядро вентиляционных, пожарных и инженерных сетей шахты.

Маршрутизация по полю action в теле запроса:
  vent     — воздухораспределение (метод Кросса / Newton-Raphson)
  fire     — задымление и CO при пожаре
  methane  — распространение метана
  evac     — маршруты эвакуации (Дейкстра)
  thermal  — тепловой режим выработок
  water    — водоснабжение (Дарси-Вейсбах + Харди-Кросс)
  full     — все расчёты за один запрос
"""

import json
import math
import os
from collections import defaultdict, deque
from typing import Optional

import numpy as np
from scipy import sparse
from scipy.sparse.linalg import spsolve


# ═══════════════════════════════════════════════════════════════════════════════
# CORS
# ═══════════════════════════════════════════════════════════════════════════════

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Id, X-Auth-Token",
}


def ok(data: dict) -> dict:
    return {"statusCode": 200, "headers": {**CORS_HEADERS, "Content-Type": "application/json"}, "body": json.dumps(data, ensure_ascii=False)}


def err(msg: str, code: int = 400) -> dict:
    return {"statusCode": code, "headers": {**CORS_HEADERS, "Content-Type": "application/json"}, "body": json.dumps({"error": msg}, ensure_ascii=False)}


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 1: АЭРОДИНАМИКА ВЫРАБОТКИ  (R по формуле Атькинсона)
# ═══════════════════════════════════════════════════════════════════════════════

# Коэффициенты аэродинамического трения α (кг/м³) по типу крепи
SURFACE_ALPHA = {
    "bare_rock":         0.012,
    "shotcrete":         0.014,
    "concrete":          0.011,
    "brick":             0.016,
    "wood_frame":        0.020,
    "steel_arch":        0.024,
    "steel_sets":        0.026,
    "mixed":             0.018,
    "conveyor":          0.028,
    "ventilation_duct":  0.005,
}


def calc_section(shape: str, **kw) -> tuple[float, float]:
    """Возвращает (area м², perimeter м)."""
    if shape == "round":
        d = kw.get("diameter", 0)
        return math.pi * d * d / 4, math.pi * d
    elif shape == "rect":
        a, b = kw.get("width", 0), kw.get("height", 0)
        return a * b, 2 * (a + b)
    elif shape == "trap":
        a, c, h = kw.get("width", 0), kw.get("topWidth", 0), kw.get("height", 0)
        side = math.sqrt(h * h + ((a - c) / 2) ** 2)
        return (a + c) / 2 * h, a + c + 2 * side
    elif shape == "arch":
        a, b = kw.get("width", 0), kw.get("height", 0)
        r = a / 2
        return a * b + math.pi * r * r / 2, a + 2 * b + math.pi * r
    else:  # custom
        return kw.get("area", 0), kw.get("perimeter", 0)


def calc_resistance(branch: dict) -> float:
    """
    Аэродинамическое сопротивление R (кг/м⁷).
    R·Q·|Q| = депрессия (Па).
    """
    mode = branch.get("resistanceMode", "alpha")
    L = branch.get("length", 100.0)

    shape = branch.get("shape", "rect")
    S, P = calc_section(
        shape,
        diameter=branch.get("diameter", 3.0),
        width=branch.get("rectWidth", 7.0),
        height=branch.get("rectHeight", 5.5),
        topWidth=branch.get("trapTopWidth", 7.0),
        height_=branch.get("rectHeight", 5.5),
        area=branch.get("area", 38.5),
        perimeter=branch.get("perimeter", 25.0),
    )
    if S < 1e-6:
        S = 38.5
    if P < 1e-6:
        P = 25.0
    Dh = 4 * S / P if P > 0 else 1.0

    if mode == "manual":
        return max(0.0, branch.get("manualR", 0.0))

    # Коэффициент α
    if mode == "alpha":
        alpha = branch.get("alphaCoef", 0.014)
    elif mode == "surface":
        surf = branch.get("surfaceId", "concrete")
        alpha = SURFACE_ALPHA.get(surf, 0.014)
    else:  # roughness — формула Альтшуля
        rough = branch.get("roughness", 0.05) / 1000  # мм → м
        alpha = 0.0625 * (rough / Dh) ** (1 / 3) * 1.2 / 8
        alpha = max(0.005, alpha)

    # R = α · L · P / S³  (кг/м⁷)
    R_fr = alpha * L * P / (S ** 3)

    # Местные сопротивления (ξ)
    xi = branch.get("localXi", 0.0)
    rho = 1.2  # кг/м³
    R_loc = xi * rho / (2 * S * S) if S > 0 else 0.0

    return max(1e-6, R_fr + R_loc)


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 2: РАСЧЁТ ВЕНТИЛЯЦИОННОЙ СЕТИ (метод Кросса + Newton-Raphson)
# ═══════════════════════════════════════════════════════════════════════════════

GND = "@gnd"


def solve_ventilation(nodes: list, branches: list, options: dict = {}) -> dict:
    """
    Метод контурных расходов Кросса с поддержкой вентиляторов (кривые Q-H).
    Для сетей > 500 ветвей автоматически переключается на Newton-Raphson.
    """
    max_iter = options.get("maxIter", 300)
    tol = options.get("tolerance", 0.001)
    Q0 = options.get("initialFlow", 50.0)
    use_nr = len(branches) > 500 or options.get("method") == "newton"

    # --- Атмосферные узлы → GND ---
    atm_ids = {n["id"] for n in nodes if n.get("atmosphereLink")}

    def remap(nid: str) -> str:
        return GND if nid in atm_ids else nid

    # --- Рассчитываем R для каждой ветви ---
    edges = []
    for b in branches:
        R = b.get("resistance") if b.get("resistance", 0) > 1e-9 else calc_resistance(b)
        edges.append({
            "id": b["id"],
            "a": remap(b["fromId"]),
            "b": remap(b["toId"]),
            "R": max(R, 1e-6),
            "hasFan": b.get("hasFan", False),
            "fanMode": b.get("fanMode", "constant"),
            "Hfan": b.get("fanPressure", 0.0),
            "Q": 0.0,
            "orig": b,
        })

    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])
    node_list = list(all_nodes)

    if not edges:
        return {"ok": False, "error": "Нет ветвей", "branches": branches, "nodes": nodes}

    if use_nr:
        result = _solve_nr(nodes, edges, node_list, atm_ids, max_iter, tol)
    else:
        result = _solve_cross(nodes, edges, node_list, atm_ids, max_iter, tol, Q0)

    return result


def _solve_cross(nodes, edges, node_list, atm_ids, max_iter, tol, Q0):
    """Классический метод Кросса (контурных расходов)."""
    log = []

    # BFS — остовное дерево
    adj = defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append((i, e["b"]))
        adj[e["b"]].append((i, e["a"]))

    root = GND if GND in node_list else node_list[0]
    parent = {root: None}
    tree_set = set()
    visited = {root}
    queue = deque([root])
    while queue:
        u = queue.popleft()
        for ei, v in adj[u]:
            if v not in visited:
                visited.add(v)
                parent[v] = (u, ei)
                tree_set.add(ei)
                queue.append(v)

    chords = [i for i in range(len(edges)) if i not in tree_set]
    log.append(f"Узлов: {len(node_list)}, ветвей: {len(edges)}, хорд: {len(chords)}")

    # Путь по дереву от from до to
    def path_in_tree(frm, to):
        anc_f, anc_t = [], []
        cur = frm
        while cur is not None:
            anc_f.append(cur)
            cur = parent[cur][0] if parent.get(cur) else None
        s_f = set(anc_f)
        cur = to
        while cur not in s_f:
            anc_t.append(cur)
            cur = parent[cur][0] if parent.get(cur) else None
        lca = cur
        up = anc_f[:anc_f.index(lca) + 1]
        path = []
        for i in range(len(up) - 1):
            n = up[i]
            pi, ei = parent[n]
            e = edges[ei]
            path.append((ei, 1 if e["a"] == n else -1))
        for n in reversed(anc_t):
            pi, ei = parent[n]
            e = edges[ei]
            path.append((ei, 1 if e["a"] == pi else -1))
        return path

    # Контуры
    cycles = []
    for ci in chords:
        e = edges[ci]
        cycle = [(ci, 1)]
        try:
            for ei, d in path_in_tree(e["b"], e["a"]):
                cycle.append((ei, d))
        except Exception:
            continue
        cycles.append(cycle)

    # Начальное распределение Q
    for cyc in cycles:
        for ei, d in cyc:
            edges[ei]["Q"] += Q0 * d

    # Итерации Кросса
    max_delta = float("inf")
    itr = 0
    for itr in range(max_iter):
        max_delta = 0.0
        for cyc in cycles:
            num, den = 0.0, 0.0
            for ei, d in cyc:
                e = edges[ei]
                Q = e["Q"] * d
                H = e["Hfan"] * d if e["hasFan"] else 0.0
                num += e["R"] * Q * abs(Q) - H
                den += 2 * e["R"] * abs(Q)
            dQ = -num / den if den > 1e-12 else 0.0
            dQ *= 0.85  # релаксация
            if abs(dQ) > max_delta:
                max_delta = abs(dQ)
            for ei, d in cyc:
                edges[ei]["Q"] += dQ * d
        if max_delta < tol:
            itr += 1
            break

    return _build_result(nodes, edges, node_list, atm_ids, itr, max_delta, tol, "cross", log)


def _solve_nr(nodes, edges, node_list, atm_ids, max_iter, tol, *_):
    """Newton-Raphson через разреженные матрицы (быстро для 10k+ ветвей)."""
    log = ["Newton-Raphson (разреженные матрицы)"]

    n_nodes = len(node_list)
    n_edges = len(edges)
    idx = {nid: i for i, nid in enumerate(node_list)}

    # Начальные Q
    for e in edges:
        e["Q"] = e.get("Hfan", 0.0) / max(e["R"] * 2, 1e-3) if e["hasFan"] else 1.0

    # Опорные узлы (атмосфера = 0 Па)
    ref_idx = {idx[GND]} if GND in idx else set()
    if not ref_idx and idx:
        ref_idx = {0}

    itr = 0
    max_delta = float("inf")
    for itr in range(max_iter):
        # Строим систему: A·dP = b, где A — матрица инциденций с весами 1/(2R|Q|)
        rows, cols, vals = [], [], []
        rhs = [0.0] * n_nodes

        for j, e in enumerate(edges):
            i_a = idx.get(e["a"])
            i_b = idx.get(e["b"])
            if i_a is None or i_b is None:
                continue
            R, Q = e["R"], e["Q"]
            w = 1.0 / max(2 * R * abs(Q), 1e-10)
            H = e["Hfan"] if e["hasFan"] else 0.0
            res = R * Q * abs(Q) - H  # невязка ветви

            # Матрица инциденций × вес
            for si, di in [(i_a, i_b), (i_b, i_a)]:
                rows.append(si); cols.append(si); vals.append(w)
                rows.append(si); cols.append(di); vals.append(-w)

            # RHS: невязка баланса расходов
            rhs[i_a] += res * w
            rhs[i_b] -= res * w

        # Фиксируем опорные узлы
        for ri in ref_idx:
            rhs[ri] = 0.0

        A = sparse.coo_matrix((vals, (rows, cols)), shape=(n_nodes, n_nodes)).tocsr()
        for ri in ref_idx:
            A[ri, :] = 0
            A[ri, ri] = 1.0

        try:
            dP = spsolve(A, rhs)
        except Exception:
            break

        max_delta = float(np.max(np.abs(dP)))

        for j, e in enumerate(edges):
            i_a = idx.get(e["a"])
            i_b = idx.get(e["b"])
            if i_a is None or i_b is None:
                continue
            dp = dP[i_a] - dP[i_b]
            H = e["Hfan"] if e["hasFan"] else 0.0
            dQ = (dp + H - e["R"] * e["Q"] * abs(e["Q"])) / max(2 * e["R"] * abs(e["Q"]), 1e-10)
            e["Q"] += dQ * 0.7

        if max_delta < tol:
            itr += 1
            break

    return _build_result(nodes, edges, node_list, atm_ids, itr, max_delta, tol, "newton_raphson", log)


def _build_result(nodes, edges, node_list, atm_ids, iterations, max_delta, tol, method, log):
    """Формирует итоговый результат: расходы, скорости, депрессии, давления."""
    # Расходы в ветвях
    Q_map = {e["id"]: e["Q"] for e in edges}
    R_map = {e["id"]: e["R"] for e in edges}

    branch_results = []
    for b in [e["orig"] for e in edges]:
        bid = b["id"]
        Q = Q_map.get(bid, 0.0)
        R = R_map.get(bid, calc_resistance(b))
        # Площадь сечения
        shape = b.get("shape", "rect")
        S, _ = calc_section(
            shape,
            diameter=b.get("diameter", 3.0),
            width=b.get("rectWidth", 7.0),
            height=b.get("rectHeight", 5.5),
            area=b.get("area", 38.5),
            perimeter=b.get("perimeter", 25.0),
        )
        S = max(S, 0.1)
        V = abs(Q) / S
        dP = R * Q * abs(Q)
        Hfan = b.get("fanPressure", 0.0) if b.get("hasFan") else 0.0
        # КПД и мощность вентилятора (упрощённо: η≈0.7)
        eta = b.get("fanEfficiency", 0.7) if b.get("hasFan") else 0.0
        power = abs(Q) * abs(Hfan) / max(eta, 0.01) / 1000.0 if b.get("hasFan") and abs(Q) > 0 else 0.0
        br = {**b, "flow": Q, "velocity": V, "dP": dP, "power": power, "resistance": R}
        branch_results.append(br)

    # Давления в узлах (BFS от GND=0 Па)
    adj_r = defaultdict(list)
    for e in edges:
        adj_r[e["a"]].append(e)
        adj_r[e["b"]].append(e)

    pressures = {GND: 0.0}
    for nid in node_list:
        if nid != GND:
            n = next((x for x in nodes if x["id"] == nid), None)
            if n and n.get("reducedPressure", 0) != 0:
                pressures[nid] = n["reducedPressure"]

    visited_p = set(pressures.keys())
    queue = deque(list(pressures.keys()))
    while queue:
        u = queue.popleft()
        for e in adj_r.get(u, []):
            v = e["b"] if e["a"] == u else e["a"]
            if v in visited_p:
                continue
            Q = e["Q"]
            dP = e["R"] * Q * abs(Q)
            H = e["Hfan"] if e["hasFan"] else 0.0
            if e["a"] == u:
                pressures[v] = pressures[u] - dP + H
            else:
                pressures[v] = pressures[u] + dP - H
            visited_p.add(v)
            queue.append(v)

    node_results = []
    for n in nodes:
        nid_mapped = GND if n["id"] in atm_ids else n["id"]
        p = pressures.get(nid_mapped, 0.0)
        node_results.append({**n, "computedPressure": round(p, 2)})

    return {
        "ok": max_delta <= tol,
        "method": method,
        "iterations": iterations,
        "maxDeltaQ": round(max_delta, 6),
        "cyclesCount": 0,
        "log": log,
        "branches": branch_results,
        "nodes": node_results,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 3: ПОЖАР И ЗАДЫМЛЕНИЕ
# ═══════════════════════════════════════════════════════════════════════════════

def solve_fire(nodes: list, branches: list, flows: list, fire: dict) -> dict:
    """
    Распространение дыма и CO по вентиляционной сети.
    Использует расходы из расчёта вентиляции.
    """
    # Индексы потоков по branch id
    Q_map = {b["id"]: q for b, q in zip(branches, flows)}

    n_nodes = {n["id"]: i for i, n in enumerate(nodes)}
    smoke = [0.0] * len(nodes)
    co_ppm = [0.0] * len(nodes)
    temp = [20.0] * len(nodes)

    fire_nid = fire.get("nodeId") or fire.get("node_id")
    heat_kw = fire.get("heatRelease", fire.get("heat_release", 5000.0))
    smoke_dens = fire.get("smokeDensity", fire.get("smoke_density", 0.3))
    co_pct = fire.get("coConcentration", fire.get("co_concentration", 0.01))

    fi = n_nodes.get(fire_nid)
    if fi is not None:
        smoke[fi] = 1.0
        temp[fi] = 20.0 + heat_kw / 50.0
        co_ppm[fi] = co_pct * 10000.0

    # Итеративное распространение по потокам
    for _ in range(80):
        for b in branches:
            Q = Q_map.get(b["id"], 0.0)
            src_id = b["fromId"] if Q >= 0 else b["toId"]
            dst_id = b["toId"] if Q >= 0 else b["fromId"]
            si = n_nodes.get(src_id)
            di = n_nodes.get(dst_id)
            if si is None or di is None:
                continue
            L = b.get("length", 100.0)
            atten = math.exp(-0.001 * L)
            new_smoke = smoke[si] * atten * smoke_dens
            if new_smoke > smoke[di]:
                smoke[di] = new_smoke
                temp[di] = 20.0 + (temp[si] - 20.0) * atten
                co_ppm[di] = co_ppm[si] * atten

    node_results = []
    danger_zones = []
    safe_exits = []
    for i, n in enumerate(nodes):
        s = smoke[i]
        c = co_ppm[i]
        t = temp[i]
        vis = min(100.0, 1.0 / s) if s > 0.01 else 100.0
        dangerous = c > 50.0 or s > 0.5 or vis < 5.0
        alarm = ("critical" if c > 200 or s > 0.8
                 else "danger" if c > 50 or s > 0.5
                 else "warning" if c > 20 or s > 0.2
                 else "safe")
        nr = {
            "nodeId": n["id"],
            "smokeLevel": round(s, 4),
            "coPpm": round(c, 2),
            "temperature": round(t, 2),
            "visibility": round(vis, 2),
            "isDangerous": dangerous,
            "alarmLevel": alarm,
        }
        node_results.append(nr)
        if dangerous:
            danger_zones.append(n["id"])
        if n.get("atmosphereLink") and s < 0.1:
            safe_exits.append(n["id"])

    avg_v = sum(
        abs(Q_map.get(b["id"], 0.0)) / max(b.get("area", 38.5), 0.1)
        for b in branches
    ) / max(len(branches), 1)
    max_L = max((b.get("length", 100) for b in branches), default=100)
    spread_time = max_L / max(avg_v, 0.1)

    return {
        "nodes": node_results,
        "dangerZones": danger_zones,
        "safeExits": safe_exits,
        "spreadTimeSec": round(spread_time, 1),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 4: МЕТАН
# ═══════════════════════════════════════════════════════════════════════════════

def solve_methane(nodes: list, branches: list, flows: list, sources: list) -> dict:
    """
    Расчёт распределения концентрации CH₄ по вентиляционной сети.
    sources: [{nodeId, emissionRate (м³/мин), sourceType}]
    """
    Q_map = {b["id"]: q for b, q in zip(branches, flows)}
    n_idx = {n["id"]: i for i, n in enumerate(nodes)}

    ch4 = [0.0] * len(nodes)   # % объёма
    air_flow = [0.0] * len(nodes)  # м³/мин — входящий поток воздуха

    # Суммарный входящий воздух по узлам
    for b in branches:
        Q = Q_map.get(b["id"], 0.0)
        dst_id = b["toId"] if Q >= 0 else b["fromId"]
        di = n_idx.get(dst_id)
        if di is not None:
            air_flow[di] += abs(Q) * 60.0  # м³/с → м³/мин

    # Источники CH4
    emission_map = defaultdict(float)
    for s in sources:
        nid = s.get("nodeId") or s.get("node_id")
        emission_map[nid] += s.get("emissionRate", s.get("emission_rate", 0.0))

    total_emission = sum(emission_map.values())

    # Начальные концентрации в источниках
    for nid, rate in emission_map.items():
        i = n_idx.get(nid)
        if i is not None:
            q = air_flow[i]
            ch4[i] = rate / (q + rate) * 100.0 if (q + rate) > 0 else 0.0

    # Распространение по потокам
    for _ in range(100):
        for b in branches:
            Q = Q_map.get(b["id"], 0.0)
            src_id = b["fromId"] if Q >= 0 else b["toId"]
            dst_id = b["toId"] if Q >= 0 else b["fromId"]
            si = n_idx.get(src_id)
            di = n_idx.get(dst_id)
            if si is None or di is None:
                continue
            q_min = abs(Q) * 60.0  # м³/мин
            branch_emission = (emission_map.get(src_id, 0.0) + emission_map.get(dst_id, 0.0)) / 2
            if q_min + branch_emission > 0:
                new_c = (ch4[si] / 100.0 * q_min + branch_emission) / (q_min + branch_emission) * 100.0
            else:
                new_c = ch4[si]
            if new_c > ch4[di]:
                ch4[di] = min(new_c, 100.0)

    node_results = []
    dangerous = []
    explosive = []
    for i, n in enumerate(nodes):
        c = ch4[i]
        is_exp = 5.0 <= c <= 15.0
        is_dng = c > 1.0
        is_crit = c > 2.0
        alarm = ("critical" if c > 5.0 else "danger" if c > 2.0
                 else "warning" if c > 1.0 else "safe")
        node_results.append({
            "nodeId": n["id"],
            "ch4Percent": round(c, 4),
            "isExplosive": is_exp,
            "isDangerous": is_dng,
            "isCritical": is_crit,
            "alarmLevel": alarm,
        })
        if is_dng:
            dangerous.append(n["id"])
        if is_exp:
            explosive.append(n["id"])

    branch_results = []
    for b in branches:
        Q = Q_map.get(b["id"], 0.0)
        si = n_idx.get(b["fromId"])
        di = n_idx.get(b["toId"])
        c_avg = ((ch4[si] if si is not None else 0) + (ch4[di] if di is not None else 0)) / 2
        branch_results.append({
            "branchId": b["id"],
            "ch4Percent": round(c_avg, 4),
            "ch4Flow": round(abs(Q) * 60.0 * c_avg / 100.0, 4),
        })

    return {
        "nodes": node_results,
        "branches": branch_results,
        "dangerousNodes": dangerous,
        "explosiveNodes": explosive,
        "maxCh4Percent": round(max(ch4, default=0.0), 4),
        "totalEmission": round(total_emission, 4),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 5: ЭВАКУАЦИЯ (алгоритм Дейкстры)
# ═══════════════════════════════════════════════════════════════════════════════

def solve_evac(nodes: list, branches: list, groups: list, danger_nodes: list) -> dict:
    """
    Расчёт маршрутов эвакуации.
    groups: [{id, nodeId, count, mobility (0..1)}]
    danger_nodes: список id опасных узлов (из fire/methane)
    """
    n_idx = {n["id"]: i for i, n in enumerate(nodes)}
    exits = [n["id"] for n in nodes if n.get("atmosphereLink")]
    danger_set = set(danger_nodes)

    # Граф: нид → [(сосед_nid, длина, branch_id)]
    graph = defaultdict(list)
    for b in branches:
        L = b.get("length", 100.0)
        graph[b["fromId"]].append((b["toId"], L, b["id"]))
        graph[b["toId"]].append((b["fromId"], L, b["id"]))

    def dijkstra(start: str):
        dist = {start: 0.0}
        prev = {}
        visited = set()
        heap = [(0.0, start)]
        import heapq
        while heap:
            d, u = heapq.heappop(heap)
            if u in visited:
                continue
            visited.add(u)
            if u in danger_set and u != start:
                continue
            for v, w, bid in graph[u]:
                nd = d + w
                if nd < dist.get(v, float("inf")):
                    dist[v] = nd
                    prev[v] = (u, bid)
                    heapq.heappush(heap, (nd, v))
        return dist, prev

    def reconstruct(prev, end):
        path, br_path = [end], []
        cur = end
        while cur in prev:
            u, bid = prev[cur]
            path.append(u)
            br_path.append(bid)
            cur = u
        path.reverse()
        br_path.reverse()
        return path, br_path

    routes = []
    critical = []
    total_people = sum(g.get("count", 1) for g in groups)

    for g in groups:
        start = g.get("nodeId") or g.get("node_id")
        mob = max(g.get("mobility", 1.0), 0.01)
        dist, prev = dijkstra(start)

        # Ближайший безопасный выход
        best = None
        for ex in exits:
            if ex in dist and dist[ex] < float("inf"):
                if best is None or dist[ex] < dist[best]:
                    best = ex

        if best:
            path, br_path = reconstruct(prev, best)
            total_L = dist[best]
            walk_speed = 1.2 * mob  # м/с
            t = total_L / walk_speed
            is_safe = not any(p in danger_set for p in path)
            routes.append({
                "groupId": g["id"],
                "path": path,
                "branchPath": br_path,
                "totalTimeSec": round(t, 1),
                "totalLength": round(total_L, 1),
                "isSafe": is_safe,
            })
        else:
            critical.append(start)
            routes.append({
                "groupId": g["id"],
                "path": [start],
                "branchPath": [],
                "totalTimeSec": -1,
                "totalLength": 0,
                "isSafe": False,
            })

    max_time = max((r["totalTimeSec"] for r in routes if r["totalTimeSec"] > 0), default=0)
    return {
        "routes": routes,
        "totalPeople": total_people,
        "maxEvacTimeSec": round(max_time, 1),
        "allSafe": all(r["isSafe"] for r in routes),
        "criticalNodes": critical,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 6: ТЕПЛОВОЙ РЕЖИМ
# ═══════════════════════════════════════════════════════════════════════════════

def solve_thermal(nodes: list, branches: list, flows: list, params: dict) -> dict:
    """
    Тепловой режим выработок: нагрев воздуха от горных пород.
    """
    Q_map = {b["id"]: q for b, q in zip(branches, flows)}
    n_idx = {n["id"]: i for i, n in enumerate(nodes)}

    T_inlet = params.get("inletAirTemp", params.get("inlet_air_temp", 10.0))
    H_inlet = params.get("inletAirHumidity", params.get("inlet_air_humidity", 70.0))
    depth = params.get("depth", 300.0)
    grad = params.get("geothermalGradient", params.get("geothermal_gradient", 3.0))
    T_surface = params.get("surfaceTemp", params.get("surface_temp", 8.0))

    T_rock = T_surface + grad * depth / 100.0  # температура пород на глубине

    temps = [T_inlet] * len(nodes)
    humid = [H_inlet] * len(nodes)

    # Устанавливаем температуру на входах (узлы связи с атмосферой)
    for i, n in enumerate(nodes):
        if n.get("atmosphereLink"):
            temps[i] = T_inlet
            humid[i] = H_inlet

    branch_results = []
    for _ in range(60):
        seen_br = {}
        for b in branches:
            Q = Q_map.get(b["id"], 0.0)
            src_id = b["fromId"] if Q >= 0 else b["toId"]
            dst_id = b["toId"] if Q >= 0 else b["fromId"]
            si = n_idx.get(src_id)
            di = n_idx.get(dst_id)
            if si is None or di is None:
                continue

            T_in = temps[si]
            # Коэффициент теплообмена α (Вт/м²·°C)
            S, P = calc_section(
                b.get("shape", "rect"),
                diameter=b.get("diameter", 3.0),
                width=b.get("rectWidth", 7.0),
                height=b.get("rectHeight", 5.5),
                area=b.get("area", 38.5),
                perimeter=b.get("perimeter", 25.0),
            )
            S = max(S, 0.1)
            P = max(P, 1.0)
            V = abs(Q) / S
            alpha = 8.0 + 0.4 * V
            L = b.get("length", 100.0)
            surf = P * L
            heat_gain_kw = alpha * surf * max(T_rock - T_in, 0.0) / 1000.0

            # dT = Q_heat / (Q_mass · Cp)
            mass_flow = abs(Q) * 1.2  # кг/с
            dT = heat_gain_kw / (mass_flow * 1.005) if mass_flow > 0.001 else 0.0
            T_out = T_in + dT

            if T_out > temps[di]:
                temps[di] = T_out
                humid[di] = min(humid[si] * 0.98, 100.0)

            if b["id"] not in seen_br:
                seen_br[b["id"]] = {
                    "branchId": b["id"],
                    "heatGain": round(heat_gain_kw, 3),
                    "tempRise": round(dT, 3),
                    "avgTemp": round((T_in + T_out) / 2, 2),
                }
        branch_results = list(seen_br.values())

    def wet_bulb(T, RH):
        """Приближение температуры мокрого термометра."""
        return (T * math.atan(0.151977 * math.sqrt(RH + 8.313659))
                + math.atan(T + RH) - math.atan(RH - 1.676331)
                + 0.00391838 * RH ** 1.5 * math.atan(0.023101 * RH) - 4.686035)

    node_results = []
    dangerous = []
    total_cooling = 0.0
    for i, n in enumerate(nodes):
        T = temps[i]
        RH = humid[i]
        wb = wet_bulb(T, RH)
        comfortable = wb < 26.0
        is_dng = wb > 33.0
        cooling = max(0.0, (T - 24.0) * 1.2 * abs(Q_map.get(
            next((b["id"] for b in branches if b["fromId"] == n["id"] or b["toId"] == n["id"]), ""), 0.0
        )) * 1.005) if T > 24.0 else 0.0
        total_cooling += cooling
        node_results.append({
            "nodeId": n["id"],
            "airTemp": round(T, 2),
            "humidity": round(RH, 2),
            "wetBulbTemp": round(wb, 2),
            "isComfortable": comfortable,
            "isDangerous": is_dng,
            "coolingNeeded": round(cooling, 2),
        })
        if is_dng:
            dangerous.append(n["id"])

    total_heat = sum(r["heatGain"] for r in branch_results)
    max_wb = max((r["wetBulbTemp"] for r in node_results), default=0.0)

    return {
        "nodes": node_results,
        "branches": branch_results,
        "totalHeatLoad": round(total_heat, 2),
        "maxWetBulb": round(max_wb, 2),
        "dangerousNodes": dangerous,
        "totalCoolingNeeded": round(total_cooling, 2),
        "rockTemp": round(T_rock, 2),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# МОДУЛЬ 7: ВОДОСНАБЖЕНИЕ (Дарси-Вейсбах + Харди-Кросс)
# ═══════════════════════════════════════════════════════════════════════════════

def solve_water(w_nodes: list, w_pipes: list, options: dict = {}) -> dict:
    """
    Расчёт водопроводной сети.
    w_nodes: [{id, name, pressure (Па), demand (л/с), elevation (м)}]
    w_pipes: [{id, fromId, toId, diameter (мм), length (м), roughness (мм)}]
    """
    min_pressure = options.get("minPressure", 100000.0)  # 1 атм

    def pipe_R(pipe):
        d = pipe.get("diameter", 150.0) / 1000.0  # мм → м
        L = pipe.get("length", 100.0)
        rough = pipe.get("roughness", 0.25) / 1000.0 / d  # отн. шероховатость
        S = math.pi * d * d / 4
        lam = 0.11 * rough ** 0.25
        return lam * L / (d * 2 * 9.81 * S * S) * 1e-6  # (м·с²)/л²

    # Начальные расходы
    flows = {p["id"]: p.get("flow", 1.0) for p in w_pipes}

    # Контуры (упрощённо: все ветви)
    for _ in range(500):
        max_d = 0.0
        for p in w_pipes:
            R = pipe_R(p)
            q = flows[p["id"]]
            # Баланс расхода
            demand_from = next((n.get("demand", 0) for n in w_nodes if n["id"] == p["fromId"]), 0)
            demand_to = next((n.get("demand", 0) for n in w_nodes if n["id"] == p["toId"]), 0)
            imb = demand_from - demand_to
            dq = imb / (2 * R * max(abs(q), 0.001) * len(w_pipes))
            flows[p["id"]] += dq
            max_d = max(max_d, abs(dq))
        if max_d < 0.001:
            break

    # Давления
    pressures = {}
    for n in w_nodes:
        if n.get("pressure") is not None:
            pressures[n["id"]] = n["pressure"]

    changed = True
    while changed:
        changed = False
        for p in w_pipes:
            R = pipe_R(p)
            q = flows[p["id"]]
            dp = R * q * abs(q) * 1000.0 * 9.81
            if p["fromId"] in pressures and p["toId"] not in pressures:
                pressures[p["toId"]] = pressures[p["fromId"]] - dp
                changed = True
            elif p["toId"] in pressures and p["fromId"] not in pressures:
                pressures[p["fromId"]] = pressures[p["toId"]] + dp
                changed = True

    pipe_results = []
    for p in w_pipes:
        q = flows[p["id"]]
        d = p.get("diameter", 150.0) / 1000.0
        S = math.pi * d * d / 4
        v = abs(q) / 1000.0 / S
        R = pipe_R(p)
        hl = R * q * abs(q)
        dp = hl * 1000.0 * 9.81
        pipe_results.append({
            "id": p["id"],
            "flow": round(q, 4),
            "velocity": round(v, 3),
            "pressureLoss": round(abs(dp), 2),
            "headLoss": round(abs(hl), 4),
            "isOverloaded": v > 2.0,
        })

    node_results = []
    deficient = []
    for n in w_nodes:
        pr = pressures.get(n["id"], 0.0)
        head = pr / (1000.0 * 9.81) + n.get("elevation", 0.0)
        is_def = 0 < pr < min_pressure
        node_results.append({
            "id": n["id"],
            "pressure": round(pr, 2),
            "head": round(head, 2),
            "isDeficient": is_def,
        })
        if is_def:
            deficient.append(n["id"])

    return {
        "pipes": pipe_results,
        "nodes": node_results,
        "deficientNodes": deficient,
        "overloadedPipes": [r["id"] for r in pipe_results if r["isOverloaded"]],
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ТОЧКА ВХОДА
# ═══════════════════════════════════════════════════════════════════════════════

def handler(event: dict, context) -> dict:
    """
    VentCore API — расчётное ядро для вентиляционных, пожарных и инженерных сетей шахты.
    Принимает POST с JSON. Поле action определяет тип расчёта.
    """
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    method = event.get("httpMethod", "GET")
    if method == "GET":
        return ok({
            "status": "ok",
            "version": "2.0.0",
            "actions": ["vent", "fire", "methane", "evac", "thermal", "water", "full"],
            "description": "VentCore — расчётное ядро шахтных сетей",
        })

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError as exc:
        return err(f"Неверный JSON: {exc}")

    action = body.get("action", "vent")
    nodes = body.get("nodes", [])
    branches = body.get("branches", [])
    options = body.get("options", {})

    # ── ВЕНТИЛЯЦИЯ ──────────────────────────────────────────────────────────
    if action == "vent":
        result = solve_ventilation(nodes, branches, options)
        return ok(result)

    # ── ПОЖАР / ЗАДЫМЛЕНИЕ ──────────────────────────────────────────────────
    elif action == "fire":
        fire = body.get("fire", {})
        flows = body.get("flows") or [b.get("flow", 0.0) for b in branches]
        if not flows or not fire:
            # Сначала считаем вентиляцию, потом пожар
            vent = solve_ventilation(nodes, branches, options)
            flows = [b.get("flow", 0.0) for b in vent["branches"]]
            result = solve_fire(nodes, branches, flows, fire)
            result["ventilation"] = {"ok": vent["ok"], "iterations": vent["iterations"]}
        else:
            result = solve_fire(nodes, branches, flows, fire)
        return ok(result)

    # ── МЕТАН ───────────────────────────────────────────────────────────────
    elif action == "methane":
        sources = body.get("methaneSources", body.get("sources", []))
        flows = body.get("flows") or [b.get("flow", 0.0) for b in branches]
        if not any(abs(q) > 0 for q in flows):
            vent = solve_ventilation(nodes, branches, options)
            flows = [b.get("flow", 0.0) for b in vent["branches"]]
        result = solve_methane(nodes, branches, flows, sources)
        return ok(result)

    # ── ЭВАКУАЦИЯ ───────────────────────────────────────────────────────────
    elif action == "evac":
        groups = body.get("evacuationGroups", body.get("groups", []))
        danger_nodes = body.get("dangerNodes", body.get("danger_nodes", []))
        result = solve_evac(nodes, branches, groups, danger_nodes)
        return ok(result)

    # ── ТЕПЛОВОЙ РЕЖИМ ──────────────────────────────────────────────────────
    elif action == "thermal":
        params = body.get("thermalParams", body.get("params", {}))
        flows = body.get("flows") or [b.get("flow", 0.0) for b in branches]
        if not any(abs(q) > 0 for q in flows):
            vent = solve_ventilation(nodes, branches, options)
            flows = [b.get("flow", 0.0) for b in vent["branches"]]
        result = solve_thermal(nodes, branches, flows, params)
        return ok(result)

    # ── ВОДОСНАБЖЕНИЕ ────────────────────────────────────────────────────────
    elif action == "water":
        w_nodes = body.get("waterNodes", nodes)
        w_pipes = body.get("waterPipes", branches)
        result = solve_water(w_nodes, w_pipes, options)
        return ok(result)

    # ── ПОЛНЫЙ РАСЧЁТ (все модули за один запрос) ────────────────────────────
    elif action == "full":
        # 1. Вентиляция (обязательно)
        vent = solve_ventilation(nodes, branches, options)
        flows = [b.get("flow", 0.0) for b in vent["branches"]]
        result = {"ventilation": vent}

        # 2. Пожар (если задан)
        fire = body.get("fire")
        if fire:
            result["fire"] = solve_fire(nodes, vent["branches"], flows, fire)
            danger_nodes = result["fire"].get("dangerZones", [])
        else:
            danger_nodes = []

        # 3. Метан (если заданы источники)
        sources = body.get("methaneSources", [])
        if sources:
            result["methane"] = solve_methane(nodes, vent["branches"], flows, sources)
            danger_nodes += result["methane"].get("dangerousNodes", [])

        # 4. Эвакуация (если заданы группы)
        groups = body.get("evacuationGroups", [])
        if groups:
            result["evacuation"] = solve_evac(nodes, branches, groups, list(set(danger_nodes)))

        # 5. Тепловой режим (если заданы параметры)
        t_params = body.get("thermalParams")
        if t_params:
            result["thermal"] = solve_thermal(nodes, vent["branches"], flows, t_params)

        return ok(result)

    else:
        return err(f"Неизвестный action: '{action}'. Допустимые: vent, fire, methane, evac, thermal, water, full")
