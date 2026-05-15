"""
Решатель вентиляционной сети — метод узловых давлений (Node Pressure Method).
Newton-Raphson + numpy (O(N²) вместо O(N³) Гаусса).

Математика:
  GND = 0 Па (опора).
  Для ребра i (a→b): Q_i = sign(ΔP_eff) * sqrt(|ΔP_eff| / R_i)
    ΔP_eff = P_a - P_b + H_fan_i  (H_fan > 0 нагнетает a→b)
  1-й закон Кирхгофа: Σ Q_i(P) = 0 для каждого свободного узла.
  Итерации Newton-Raphson: P_{n+1} = P_n - J^{-1}·F(P_n).
"""

import json
import math

GND       = "@gnd"
EPS_Q     = 0.01
MAX_IT    = 50
MIN_R     = 1e-6
DEFAULT_R = 0.001

SURFACE_ALPHA = {
    "smooth": 9, "concrete": 12, "concrete_rough": 30, "anchor": 35,
    "wood": 60, "metal_arch": 50, "uncoupled": 25, "uncoupled_r": 80,
    "shaft_smooth": 15, "shaft_skip": 45, "lava": 150,
}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }, "body": ""}
    try:
        body   = json.loads(event.get("body") or "{}")
        result = solve(body.get("nodes", []), body.get("branches", []), body.get("options", {}))
        return {"statusCode": 200,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps(result)}
    except Exception as exc:
        import traceback
        return {"statusCode": 500,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps({"error": str(exc), "trace": traceback.format_exc()})}


def calc_r(b):
    R = float(b.get("resistance") or 0)
    if R > MIN_R: return R
    mode = str(b.get("resistanceMode") or "alpha")
    if mode == "manual":
        mr = float(b.get("manualR") or 0)
        return max(MIN_R, mr) if mr > 0 else DEFAULT_R
    S = float(b.get("area") or 0)
    P = float(b.get("perimeter") or 0)
    L = float(b.get("length") or 0)
    if S <= 0.05 or L <= 0 or P <= 0: return DEFAULT_R
    if mode == "roughness":
        Dh  = (4 * S) / P
        rel = max(1e-9, float(b.get("roughness") or 1) / 1000 / Dh)
        Rf  = 0.11 * rel ** 0.25 * L * P / (8 * S ** 3)
    else:
        sid   = str(b.get("surfaceId") or "")
        alpha = float(b.get("alphaCoef") or SURFACE_ALPHA.get(sid, 9))
        Rf    = alpha * 1e-4 * P * L / S ** 3
    xi = float(b.get("localXi") or 0)
    Rl = xi * 1.2 / (2 * S * S) if xi > 0 else 0
    return max(MIN_R, Rf + Rl) if (Rf + Rl) > 0 else DEFAULT_R


def fan_h(e, Q):
    """H(|Q|) ≥ 0. Нагнетает в направлении a→b."""
    if not e.get("hasFan"): return 0.0
    mode = str(e.get("fanMode") or "constant")
    fp   = float(e.get("fanPressure") or 0)
    if mode == "constant": return max(0.0, fp)
    h0 = float(e.get("h0") or 0)
    h1 = float(e.get("h1") or 0)
    h2 = float(e.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0: return max(0.0, fp)
    qmax = float(e.get("qMax") or 1e9)
    Qn   = abs(Q)
    if Qn > qmax: return 0.0
    return max(0.0, h0 + h1 * Qn + h2 * Qn * Qn)


def fan_dh(e, Q):
    if not e.get("hasFan") or str(e.get("fanMode")) != "curve": return 0.0
    return abs(float(e.get("h1") or 0) + 2 * float(e.get("h2") or 0) * abs(Q))


def edge_q_and_deriv(e, Pa, Pb):
    """
    Вычисляет Q и производные для ребра.
    Q > 0: ток из a в b.
    ΔP_eff = Pa - Pb + H_fan(Q)   (H_fan > 0: вентилятор нагнетает a→b)
    Q = sign(ΔP_eff) * sqrt(|ΔP_eff| / R)
    """
    R    = e["R"]
    qmax = float(e.get("qMax") or 1e9) if e.get("hasFan") else 1e9

    # Начальная оценка с H(0)
    H0  = fan_h(e, 0.0)
    dPe = Pa - Pb + H0
    Q   = math.copysign(math.sqrt(max(abs(dPe), 1e-12) / R), dPe)

    # Ограничение Q диапазоном кривой вентилятора
    if e.get("hasFan"):
        qmin = float(e.get("qMin") or 0)
        Q = max(-qmax, min(qmax, Q))

    # Итерации для уточнения Q (важно для curve-режима)
    if e.get("hasFan") and str(e.get("fanMode")) == "curve":
        for _ in range(15):
            H_new  = fan_h(e, Q)
            dPe    = Pa - Pb + H_new
            Q_new  = math.copysign(math.sqrt(max(abs(dPe), 1e-12) / R), dPe)
            # Ограничение в диапазон [−qmax, qmax]
            Q_new  = max(-qmax, min(qmax, Q_new))
            if abs(Q_new - Q) < 1e-5: Q = Q_new; break
            Q = Q_new
        H   = fan_h(e, Q)
        dPe = Pa - Pb + H
    else:
        dPe = Pa - Pb + fan_h(e, Q)

    abs_dP = max(abs(dPe), 1e-12)
    dqdP   = 1.0 / (2.0 * math.sqrt(R * abs_dP))
    dH     = fan_dh(e, Q)
    # Производная с учётом нелинейности H(Q):
    # dQ/dPa из: Q = f(Pa - Pb + H(Q)) → неявное дифференцирование
    # dQ/dPa = dqdP / (1 - dH * dqdP * sign_correction)
    denom  = max(1e-9, 1.0 - dH * dqdP)
    dQ_dPa =  dqdP / denom
    dQ_dPb = -dqdP / denom

    return Q, dQ_dPa, dQ_dPb


def _estimate_r_net(edges, fan_edge):
    """
    Оценка суммарного R сети на главном пути вентилятор→атмосфера.
    Строим BFS от узла вентилятора до GND и суммируем R по пути.
    """
    from collections import deque
    if not fan_edge:
        return DEFAULT_R

    # Список смежности
    node_set = set()
    for e in edges:
        node_set.add(e["a"]); node_set.add(e["b"])
    adj = {n: [] for n in node_set}
    for i, e in enumerate(edges):
        adj[e["a"]].append((i, e["b"]))
        adj[e["b"]].append((i, e["a"]))

    # BFS от конца вентилятора ≠ GND до GND, берём путь с минимальным R
    start = fan_edge["a"] if fan_edge["b"] == GND else fan_edge["b"]
    if start == GND:
        start = fan_edge["a"]

    # Dijkstra — путь с минимальным суммарным R
    import heapq
    dist = {start: 0.0}
    heap = [(0.0, start)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == GND:
            return max(MIN_R, fan_edge["R"] + d)
        if d > dist.get(u, float("inf")) + 1e-9:
            continue
        for ei, v in adj.get(u, []):
            nd = d + edges[ei]["R"]
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))

    # Fallback: среднее R по всем ветвям
    r_avg = sum(e["R"] for e in edges) / max(1, len(edges))
    return max(MIN_R, r_avg * max(1, int(len(edges) ** 0.5)))


def _find_working_point(fan_edge, R_net):
    """Рабочая точка: бисекция H_fan(Q) = R_net * Q^2."""
    if not fan_edge:
        return 5.0
    qmax = float(fan_edge.get("qMax") or 100)
    qmin = float(fan_edge.get("qMin") or 0)
    if R_net <= 0:
        return (qmin + qmax) / 2

    lo, hi = max(qmin, 0.0), qmax
    for _ in range(100):
        q  = (lo + hi) / 2
        Hf = fan_h(fan_edge, q)
        Hn = R_net * q * q
        if abs(Hf - Hn) < 0.1: break
        if Hf > Hn: lo = q
        else:       hi = q
    return max(max(qmin, 0.1), min(qmax, (lo + hi) / 2))


def solve(nodes_in, branches_in, options):
    import numpy as np

    max_it = int(options.get("maxIter",   MAX_IT))
    eps    = float(options.get("tolerance", EPS_Q))
    log    = []
    diag   = []

    # Граф
    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}
    def gnd(nid): return GND if nid in atm_ids else nid

    edges = []
    for b in branches_in:
        edges.append({
            "id":          b["id"],
            "a":           gnd(b["fromId"]),
            "b":           gnd(b["toId"]),
            "R":           calc_r(b),
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

    if not edges: return _empty(nodes_in, "Нет ветвей")

    # Диагностический лог виден в UI через diag[info]
    for e in edges:
        if e["hasFan"]:
            diag.append({"level": "info", "category": "fan",
                "message": f"ВЕНТ {e['id'][:20]}: R={e['R']:.4f}, mode={e['fanMode']}, fp={e['fanPressure']:.0f}, h0={e['h0']:.0f}, h1={e['h1']:.2f}, h2={e['h2']:.4f}, qMax={e['qMax']:.0f}, H(0)={fan_h(e,0):.0f}",
                "objectId": e["id"]})

    if not atm_ids:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов. Отметьте ≥2 узла как «атмосфера»."})
    if not any(e["hasFan"] for e in edges):
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой."})

    # Свободные узлы
    node_set = set()
    for e in edges:
        node_set.add(e["a"]); node_set.add(e["b"])
    free_nodes = sorted(node_set - {GND})
    N  = len(free_nodes)
    ni = {v: i for i, v in enumerate(free_nodes)}
    log.append(f"Свободных узлов: {N}, ветвей: {len(edges)}")

    if N == 0: return _empty(nodes_in, "Только атмосферные узлы")

    # Начальное давление = рабочая точка вентилятора
    # Находим: H_fan(Q*) = R_сети * Q*^2
    # Оцениваем R_сети как сумму R всех ветвей / N_branches (среднее по ветви) * типовой путь
    fan_edge = next((e for e in edges if e["hasFan"]), None)
    fan_h_max = fan_h(fan_edge, 0) if fan_edge else 1000.0
    if fan_h_max <= 0:
        fan_h_max = max((fan_h(fan_edge, q) for q in [10, 20, 50, 100]), default=1000.0)

    # Оцениваем R_net от вентилятора до GND по BFS-дереву
    # Строим быстрое дерево для оценки
    R_net = _estimate_r_net(edges, fan_edge)
    log.append(f"fan_h_max={fan_h_max:.0f} Па, R_net≈{R_net:.5f}")

    # Рабочая точка: H_fan(Q*) = R_net * Q*^2
    Q_work = _find_working_point(fan_edge, R_net)
    log.append(f"Q_work≈{Q_work:.2f} м³/с")

    # P_init = давление в сети при Q=Q_work
    # Для узлов между источником и GND: P ≈ R_part * Q_work^2
    P_init = R_net * Q_work * Q_work * 0.5
    P_init = max(P_init, fan_h_max * 0.1)
    P = np.full(N, P_init)

    # Newton-Raphson
    max_res = float("inf")
    it = 0

    for it in range(max_it):
        F = np.zeros(N)
        J = np.zeros((N, N))

        for e in edges:
            a, b = e["a"], e["b"]
            Pa = float(P[ni[a]]) if a in ni else 0.0
            Pb = float(P[ni[b]]) if b in ni else 0.0

            Q, dQ_dPa, dQ_dPb = edge_q_and_deriv(e, Pa, Pb)

            # F: невязка (баланс расходов)
            if a in ni: F[ni[a]] -= Q   # отток из a
            if b in ni: F[ni[b]] += Q   # приток в b

            # J: якобиан
            if a in ni:
                ia = ni[a]
                J[ia, ia] -= dQ_dPa      # ∂(-Q)/∂Pa = -dQ/dPa
                if b in ni: J[ia, ni[b]] -= dQ_dPb  # ∂(-Q)/∂Pb

            if b in ni:
                ib = ni[b]
                J[ib, ib] += dQ_dPb      # ∂(+Q)/∂Pb = dQ/dPb
                if a in ni: J[ib, ni[a]] += dQ_dPa  # ∂(+Q)/∂Pa

        max_res = float(np.max(np.abs(F)))
        if max_res < eps:
            it += 1; break

        # Регуляризация
        diag_J = np.abs(np.diag(J))
        J[diag_J < 1e-10, diag_J < 1e-10] = 1e-6

        # Решение J * dP = -F
        try:
            dP = np.linalg.solve(J, -F)
        except np.linalg.LinAlgError:
            try:
                dP, _, _, _ = np.linalg.lstsq(J, -F, rcond=None)
            except Exception:
                log.append(f"iter {it}: матрица вырождена"); break

        dP = np.where(np.isfinite(dP), dP, 0.0)

        # Ограничение шага
        step = float(np.max(np.abs(dP)))
        alpha = min(1.0, fan_h_max / (2 * step)) if step > fan_h_max / 2 else 1.0
        P += alpha * dP
        P  = np.where(np.isfinite(P), P, fan_h_max * 0.3)

    log.append(f"iter={it}, max|F|={max_res:.4f} м³/с")

    # Результаты
    def get_p(nid): return float(P[ni[nid]]) if nid in ni else 0.0

    branch_out = []
    for b_in, e in zip(branches_in, edges):
        Pa = get_p(e["a"]); Pb = get_p(e["b"])
        Q, _, _ = edge_q_and_deriv(e, Pa, Pb)
        a_map = gnd(b_in["fromId"])
        Q_s   = Q if e["a"] == a_map else -Q
        if not math.isfinite(Q_s): Q_s = 0.0
        S  = e["_area"]
        V  = abs(Q_s) / S if S > 0 else 0.0
        dP = e["R"] * Q_s * abs(Q_s)
        branch_out.append({"id": b_in["id"], "flow": round(Q_s, 3),
                           "velocity": round(V, 2), "dP": round(dP, 1)})

    node_out = []
    for n in nodes_in:
        nid = gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            cp = round(101325 + get_p(n["id"]) + 12 * (-float(n.get("z") or 0)))
        node_out.append({**n, "computedPressure": cp})

    # Диагностика: баланс
    fb = {v: 0.0 for v in free_nodes}
    for e in edges:
        Pa = get_p(e["a"]); Pb = get_p(e["b"])
        Q, _, _ = edge_q_and_deriv(e, Pa, Pb)
        if e["a"] in fb: fb[e["a"]] -= Q
        if e["b"] in fb: fb[e["b"]] += Q
    for nid, bv in fb.items():
        if abs(bv) <= 0.5: continue
        diag.append({"level": "error" if abs(bv) > 5 else "warning",
                     "category": "node_balance",
                     "message": f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
                     "objectId": nid, "value": bv})

    for b_in, e in zip(branches_in, edges):
        if e["hasFan"]:
            Pa = get_p(e["a"]); Pb = get_p(e["b"])
            Q, _, _ = edge_q_and_deriv(e, Pa, Pb)
            if fan_h(e, abs(Q)) <= 0:
                diag.append({"level": "error", "category": "fan",
                             "message": f"Вент. {e['id'][:25]}: напор=0 (Q={Q:.1f})",
                             "objectId": e["id"]})

    converged = max_res < eps
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось: max|F|={max_res:.3f} м³/с", "value": max_res})

    adj2 = {n: [] for n in node_set}
    for e in edges:
        adj2[e["a"]].append(e["b"]); adj2[e["b"]].append(e["a"])
    reach, stk = {GND}, [GND]
    while stk:
        u = stk.pop()
        for v in adj2.get(u, []):
            if v not in reach: reach.add(v); stk.append(v)
    iso = [n for n in node_set if n not in reach]
    if iso:
        diag.append({"level": "error", "category": "topology",
                     "message": f"Изолировано {len(iso)} узлов"})

    return {"ok": converged, "iterations": it, "maxDeltaQ": round(max_res, 4),
            "maxDeltaH": 0.0, "branches": branch_out, "nodes": node_out,
            "log": log, "cyclesCount": 0, "diagnostics": diag}


def _empty(nodes_in, msg):
    return {"ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
            "branches": [], "nodes": nodes_in, "log": [msg],
            "cyclesCount": 0, "diagnostics": []}


solve_network = solve