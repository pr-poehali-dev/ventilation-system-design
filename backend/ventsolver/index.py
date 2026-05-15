"""
Решатель вентиляционной сети — Метод Контурных Расходов (МКР).
Реализация как в ПО АэроСеть.

Ключевые принципы:
  - Вентилятор нагнетает воздух из fromId → toId (a→b). Q вентилятора > 0.
  - Все атмосферные узлы объединяются в GND.
  - Сколько воздуха вентилятор подал в рудник — столько должно выйти (1-й закон Кирхгофа).
  - Bottom-up НЕ перезаписывает Q ветвей с вентилятором.
"""

import json
import math
from collections import deque

GND       = "@gnd"
EPS1      = 0.1
EPS2      = 0.01
MAX_IT    = 2000
MIN_R     = 1e-6
DEFAULT_R = 0.001


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения вентиляционной сети (МКР)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }, "body": ""}

    try:
        body   = json.loads(event.get("body") or "{}")
        result = solve_network(
            body.get("nodes", []),
            body.get("branches", []),
            body.get("options", {}),
        )
        return {"statusCode": 200,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps(result)}
    except Exception as exc:
        import traceback
        return {"statusCode": 500,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps({"error": str(exc), "trace": traceback.format_exc()})}


SURFACE_ALPHA = {
    "smooth": 9, "concrete": 12, "concrete_rough": 30, "anchor": 35,
    "wood": 60, "metal_arch": 50, "uncoupled": 25, "uncoupled_r": 80,
    "shaft_smooth": 15, "shaft_skip": 45, "lava": 150,
}


def calc_r(b: dict) -> float:
    R = float(b.get("resistance") or 0)
    if R > MIN_R:
        return R
    mode = str(b.get("resistanceMode") or "alpha")
    if mode == "manual":
        mr = float(b.get("manualR") or 0)
        return max(MIN_R, mr) if mr > 0 else DEFAULT_R
    S = float(b.get("area") or 0)
    P = float(b.get("perimeter") or 0)
    L = float(b.get("length") or 0)
    if S <= 0.05 or L <= 0 or P <= 0:
        return DEFAULT_R
    if mode == "roughness":
        delta = float(b.get("roughness") or 1)
        Dh    = (4 * S) / P
        rel   = max(1e-9, (delta / 1000) / Dh)
        Rf    = 0.11 * rel**0.25 * L * P / (8 * S**3)
    else:
        sid   = str(b.get("surfaceId") or "")
        alpha = float(b.get("alphaCoef") or SURFACE_ALPHA.get(sid, 9))
        Rf    = alpha * 1e-4 * P * L / S**3
    xi = float(b.get("localXi") or 0)
    Rl = xi * 1.2 / (2 * S * S) if xi > 0 and S > 0 else 0
    return max(MIN_R, Rf + Rl) if (Rf + Rl) > 0 else DEFAULT_R


def fan_h(e: dict, Q: float) -> float:
    if not e.get("hasFan"):
        return 0.0
    mode = str(e.get("fanMode") or "constant")
    fp   = float(e.get("fanPressure") or 0)
    if mode == "constant":
        return max(0.0, fp)
    h0 = float(e.get("h0") or 0)
    h1 = float(e.get("h1") or 0)
    h2 = float(e.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        return max(0.0, fp)
    qmax = float(e.get("qMax") or 1e9)
    Qn   = abs(Q)
    if Qn > qmax:
        return 0.0
    return max(0.0, h0 + h1 * Qn + h2 * Qn * Qn)


def fan_dh(e: dict, Q: float) -> float:
    if not e.get("hasFan") or str(e.get("fanMode")) != "curve":
        return 0.0
    h1 = float(e.get("h1") or 0)
    h2 = float(e.get("h2") or 0)
    return abs(h1 + 2 * h2 * abs(Q))


def estimate_q0(fan_e: dict, R_net: float) -> float:
    """Рабочая точка: H_fan(Q) = R_net * Q^2."""
    mode  = str(fan_e.get("fanMode") or "constant")
    qmin  = float(fan_e.get("qMin") or 0)
    qmax  = float(fan_e.get("qMax") or 100)

    if mode == "constant":
        fp = float(fan_e.get("fanPressure") or 0)
        if fp > 0 and R_net > 0:
            return max(qmin or 0.1, min(qmax, math.sqrt(fp / R_net)))
        return qmax * 0.5

    h0 = float(fan_e.get("h0") or 0)
    h1 = float(fan_e.get("h1") or 0)
    h2 = float(fan_e.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        fp = float(fan_e.get("fanPressure") or 0)
        if fp > 0 and R_net > 0:
            return max(qmin or 0.1, min(qmax, math.sqrt(fp / R_net)))
        return qmax * 0.5

    if R_net <= 0:
        return (qmin + qmax) / 2

    lo, hi = qmin or 0.0, qmax
    for _ in range(100):
        q  = (lo + hi) / 2
        Hf = fan_h(fan_e, q)
        Hn = R_net * q * q
        if abs(Hf - Hn) < 0.01:
            break
        if Hf > Hn:
            lo = q
        else:
            hi = q
    return max(qmin or 0.1, min(qmax, (lo + hi) / 2))


def main_path_R(fan_e, edges, parent):
    """R главного пути от узла сети (не GND) на стороне вентилятора до корня."""
    if fan_e is None:
        return DEFAULT_R
    # Стартуем от конца вентилятора, который НЕ GND
    start = fan_e["a"] if fan_e["b"] == GND else fan_e["b"]
    if start == GND:
        start = fan_e["a"]
    R_sum, cur, seen = fan_e["R"], start, set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        p = parent.get(cur)
        if p is None:
            break
        R_sum += edges[p["ei"]]["R"]
        cur    = p["node"]
    return max(MIN_R, R_sum)


def bfs_tree(edges, adj, root):
    parent   = {root: None}
    visited  = {root}
    tree_set = set()
    order    = []
    q        = deque([root])
    while q:
        u = q.popleft()
        order.append(u)
        for item in adj.get(u, []):
            ei, v = item["ei"], item["v"]
            if v not in visited:
                visited.add(v)
                parent[v] = {"node": u, "ei": ei}
                tree_set.add(ei)
                q.append(v)
    chords  = [i for i in range(len(edges)) if i not in tree_set]
    bfs_pos = {n: i for i, n in enumerate(order)}
    return parent, order, tree_set, chords, bfs_pos


def tree_path(from_v, to_v, edges, parent):
    def ancs(v):
        lst, cur = [], v
        while cur is not None:
            lst.append(cur)
            p = parent.get(cur)
            cur = p["node"] if p else None
        return lst

    af = ancs(from_v)
    at = ancs(to_v)
    sf = {n: i for i, n in enumerate(af)}
    lca, ito = at[0], 0
    for i, n in enumerate(at):
        if n in sf:
            lca, ito = n, i
            break
    ifrom = sf.get(lca, 0)
    res   = []
    for i in range(ifrom):
        v = af[i]
        p = parent[v]
        e = edges[p["ei"]]
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == v else -1})
    for i in range(ito - 1, -1, -1):
        child = at[i]
        p     = parent[child]
        e     = edges[p["ei"]]
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == p["node"] else -1})
    return res


def solve_network(nodes_in, branches_in, options):
    max_it = int(options.get("maxIter",      MAX_IT))
    eps1   = float(options.get("tolPressure", EPS1))
    eps2   = float(options.get("tolerance",   EPS2))
    log    = []
    diag   = []

    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def gnd(nid):
        return GND if nid in atm_ids else nid

    edges = []
    for b in branches_in:
        edges.append({
            "id":          b["id"],
            "a":           gnd(b["fromId"]),
            "b":           gnd(b["toId"]),
            "R":           calc_r(b),
            "Q":           0.0,
            "hasFan":      bool(b.get("hasFan", False)),
            "fanMode":     str(b.get("fanMode") or "constant"),
            "fanPressure": float(b.get("fanPressure") or 0),
            "h0":          float(b.get("h0") or 0),
            "h1":          float(b.get("h1") or 0),
            "h2":          float(b.get("h2") or 0),
            "qMin":        float(b.get("qMin") or 0),
            "qMax":        float(b.get("qMax") or 100),
            "_fromId":     b["fromId"],
            "_area":       float(b.get("area") or 0),
        })

    if not edges:
        return _empty(nodes_in, "Нет ветвей")

    if not atm_ids:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов. Отметьте ≥2 узла как «атмосфера»."})
    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход будет нулевым."})

    node_set = set()
    for e in edges:
        node_set.add(e["a"]); node_set.add(e["b"])
    node_list = list(node_set)

    adj = {n: [] for n in node_list}
    for i, e in enumerate(edges):
        adj[e["a"]].append({"ei": i, "v": e["b"]})
        adj[e["b"]].append({"ei": i, "v": e["a"]})

    root = GND if GND in node_set else node_list[0]

    parent, order, tree_set, chords, bfs_pos = bfs_tree(edges, adj, root)
    log.append(f"Узлов: {len(node_list)}, ветвей: {len(edges)}, контуров: {len(chords)}")

    contours = []
    for ci in chords:
        e    = edges[ci]
        path = tree_path(e["b"], e["a"], edges, parent)
        contours.append([{"ei": ci, "dir": 1}] + path)

    # Q^(0) по R главного пути от вентилятора до атмосферы
    fan_e  = fans[0] if fans else None
    R_path = main_path_R(fan_e, edges, parent)
    Q0     = estimate_q0(fan_e, R_path) if fan_e else 5.0
    Q0     = max(0.1, Q0)
    log.append(f"Q₀ = {Q0:.2f} м³/с, R_путь = {R_path:.6f}")

    for i, e in enumerate(edges):
        if i not in tree_set:
            e["Q"] = Q0
        elif e["hasFan"]:
            e["Q"] = Q0
        else:
            pa = bfs_pos.get(e["a"], 10**9)
            pb = bfs_pos.get(e["b"], 10**9)
            e["Q"] = Q0 if pb > pa else -Q0

    # Итерации МКР
    max_dh = float("inf")
    max_dq = float("inf")
    it = 0

    for it in range(max_it):
        max_dh = 0.0
        max_dq = 0.0

        for contour in contours:
            num = den = 0.0
            for ce in contour:
                e  = edges[ce["ei"]]
                d  = ce["dir"]
                Qd = e["Q"] * d
                H  = fan_h(e, e["Q"])
                num += e["R"] * Qd * abs(Qd)
                num -= H * d
                den += 2.0 * e["R"] * abs(Qd) + fan_dh(e, e["Q"])
            if den < 1e-12:
                continue
            dQ = -num / den
            if abs(num) > max_dh: max_dh = abs(num)
            if abs(dQ)  > max_dq: max_dq = abs(dQ)
            for ce in contour:
                edges[ce["ei"]]["Q"] += dQ * ce["dir"]

        for e in edges:
            if not math.isfinite(e["Q"]):
                e["Q"] = 0.0
            if e["hasFan"] and str(e.get("fanMode")) == "curve":
                qm = float(e.get("qMax") or 100)
                if abs(e["Q"]) > qm:
                    e["Q"] = math.copysign(qm, e["Q"])

        if max_dh < eps1 or max_dq < eps2:
            it += 1
            break

    log.append(f"Итерации: {it}, max|ΔH|={max_dh:.3f} Па, max|δQ|={max_dq:.4f} м³/с")

    # Bottom-up: пересчёт Q дерева. Вентиляторы НЕ трогаем.
    balance = {n: 0.0 for n in node_list}
    for i, e in enumerate(edges):
        if i in tree_set:
            continue
        balance[e["a"]] -= e["Q"]
        balance[e["b"]] += e["Q"]

    for idx in range(len(order) - 1, 0, -1):
        v = order[idx]
        p = parent.get(v)
        if not p:
            continue
        e     = edges[p["ei"]]
        pnode = p["node"]

        if e["hasFan"]:
            # Q вентилятора зафиксирован — только корректируем баланс
            if e["b"] == v:
                balance[v]     += e["Q"]   # приток в v
                balance[pnode] -= e["Q"]   # отток из pnode
            else:
                balance[v]     -= e["Q"]   # отток из v
                balance[pnode] += e["Q"]   # приток в pnode
            continue

        bal = balance[v]
        if e["b"] == v:
            e["Q"] = -bal
            balance[pnode] -= e["Q"]
        else:
            e["Q"] = bal
            balance[pnode] += e["Q"]

    # Результаты
    branch_out = []
    for i, b in enumerate(branches_in):
        e   = edges[i]
        am  = gnd(b["fromId"])
        Q_s = e["Q"] if e["a"] == am else -e["Q"]
        if not math.isfinite(Q_s):
            Q_s = 0.0
        S   = float(b.get("area") or 0)
        V   = abs(Q_s) / S if S > 0 else 0.0
        dP  = e["R"] * Q_s * abs(Q_s)
        branch_out.append({"id": b["id"], "flow": round(Q_s, 3),
                           "velocity": round(V, 2), "dP": round(dP, 1)})

    # Давления (BFS по дереву)
    pressure = {root: 0.0}
    pvis     = {root}
    pq       = deque([root])
    while pq:
        u = pq.popleft()
        for item in adj.get(u, []):
            ei, other = item["ei"], item["v"]
            if other in pvis or ei not in tree_set:
                continue
            e  = edges[ei]
            H  = fan_h(e, e["Q"])
            dP = e["R"] * e["Q"] * abs(e["Q"]) - H
            Pu = pressure[u]
            pressure[other] = (Pu - dP) if e["a"] == u else (Pu + dP)
            pvis.add(other); pq.append(other)

    node_out = []
    for n in nodes_in:
        nid = gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            cp = round(101325 + pressure.get(n["id"], 0.0) + 12 * (-float(n.get("z") or 0)))
        node_out.append({**n, "computedPressure": cp})

    # Диагностика
    fb = {n: 0.0 for n in node_list}
    for e in edges:
        fb[e["a"]] -= e["Q"]; fb[e["b"]] += e["Q"]
    for nid, bv in fb.items():
        if nid == GND or abs(bv) <= 0.5:
            continue
        diag.append({"level": "error" if abs(bv) > 5 else "warning",
                     "category": "node_balance",
                     "message": f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
                     "objectId": nid, "value": bv})

    for e in edges:
        if e["hasFan"] and fan_h(e, e["Q"]) <= 0:
            diag.append({"level": "error", "category": "fan",
                         "message": f"Вент. {e['id'][:25]}: напор=0 (Q={e['Q']:.2f}, qMax={e['qMax']:.0f})",
                         "objectId": e["id"]})

    converged = max_dh < eps1 or max_dq < eps2
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось: max|ΔH|={max_dh:.2f} Па, max|δQ|={max_dq:.3f} м³/с",
                     "value": max_dq})

    reach = {root}
    stk   = [root]
    while stk:
        u = stk.pop()
        for item in adj.get(u, []):
            v = item["v"]
            if v not in reach:
                reach.add(v); stk.append(v)
    isolated = [n for n in node_list if n not in reach]
    if isolated:
        diag.append({"level": "error", "category": "topology",
                     "message": f"Изолировано {len(isolated)} узлов"})

    return {"ok": converged, "iterations": it, "maxDeltaQ": round(max_dq, 4),
            "maxDeltaH": round(max_dh, 3), "branches": branch_out, "nodes": node_out,
            "log": log, "cyclesCount": len(chords), "diagnostics": diag}


def _empty(nodes_in, msg):
    return {"ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
            "branches": [], "nodes": nodes_in, "log": [msg],
            "cyclesCount": 0, "diagnostics": []}
