"""
Решатель вентиляционной сети.

Метод: узловых давлений (Node Pressure) + Newton-Raphson + numpy.

Математика:
  GND = 0 Па (атмосфера).
  Для ребра (a→b): Q = sign(ΔP) * sqrt(|ΔP| / R),  ΔP = Pa - Pb + H_fan
  Кирхгоф-1: Σ Q_i(P) = 0 в каждом свободном узле.

Ключевые решения:
  1. P_init = рабочая точка вентилятора по главному пути.
  2. Q в edge_q ограничен [−qMax, +qMax] вентилятора.
  3. Итерации уточняют Q для curve-режима (H зависит от Q).
  4. Якобиан строится корректно с учётом dH/dQ.
"""

import json
import math

GND       = "@gnd"
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


# ── Сопротивление ─────────────────────────────────────────────────────────────

def calc_r(b):
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


# ── Напор вентилятора ─────────────────────────────────────────────────────────

def fan_h(e, Q):
    """H(|Q|) ≥ 0 Па. Нагнетает a→b."""
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


def fan_dh(e, Q):
    """|dH/dQ|."""
    if not e.get("hasFan") or str(e.get("fanMode")) != "curve":
        return 0.0
    return abs(float(e.get("h1") or 0) + 2 * float(e.get("h2") or 0) * abs(Q))


# ── Ток через ребро и производные ────────────────────────────────────────────

def edge_flow(e, Pa, Pb):
    """
    Q и производные dQ/dPa, dQ/dPb.
    Q > 0: ток из a в b.
    ΔP_eff = Pa - Pb + H_fan(Q)
    Q = sign(ΔP_eff) * sqrt(|ΔP_eff| / R)
    """
    R    = e["R"]
    qmax = float(e.get("qMax") or 1e9) if e.get("hasFan") else 1e9

    # Начальная оценка
    H   = fan_h(e, 0.0)
    dPe = Pa - Pb + H
    Q   = math.copysign(math.sqrt(max(abs(dPe), 1e-12) / R), dPe)
    if e.get("hasFan"):
        Q = max(-qmax, min(qmax, Q))

    # Уточнение для curve (10 итераций)
    if e.get("hasFan") and str(e.get("fanMode")) == "curve":
        for _ in range(10):
            H    = fan_h(e, Q)
            dPe  = Pa - Pb + H
            Qnew = math.copysign(math.sqrt(max(abs(dPe), 1e-12) / R), dPe)
            Qnew = max(-qmax, min(qmax, Qnew))
            if abs(Qnew - Q) < 1e-5:
                Q = Qnew
                break
            Q = Qnew

    H   = fan_h(e, Q)
    dPe = Pa - Pb + H

    abs_dP = max(abs(dPe), 1e-12)
    dqdP   = 1.0 / (2.0 * math.sqrt(R * abs_dP))
    dH     = fan_dh(e, Q)
    # Неявная производная: Q = f(dPe), dPe = Pa - Pb + H(Q)
    # dQ/dPa = dqdP / (1 - dH*dqdP)
    denom  = max(1e-9, 1.0 - dH * dqdP)
    dQdPa  =  dqdP / denom
    dQdPb  = -dqdP / denom
    return Q, dQdPa, dQdPb


# ── Рабочая точка вентилятора ─────────────────────────────────────────────────

def find_working_point(fan_e, r_net):
    """Бисекция: H_fan(Q) = r_net * Q^2."""
    if not fan_e or r_net <= 0:
        return 5.0
    qmax = float(fan_e.get("qMax") or 100)
    qmin = float(fan_e.get("qMin") or 0)
    lo, hi = max(qmin, 0.0), qmax
    for _ in range(100):
        q  = (lo + hi) / 2
        Hf = fan_h(fan_e, q)
        Hn = r_net * q * q
        if abs(Hf - Hn) < 0.05:
            break
        if Hf > Hn:
            lo = q
        else:
            hi = q
    return max(max(qmin, 0.1), min(qmax, (lo + hi) / 2))


def shortest_r(edges, fan_e):
    """Dijkstra: минимальный суммарный R от вентилятора до GND."""
    import heapq
    if not fan_e:
        return DEFAULT_R
    # Строим adj
    ns = set()
    for e in edges:
        ns.add(e["a"]); ns.add(e["b"])
    adj = {n: [] for n in ns}
    for i, e in enumerate(edges):
        adj[e["a"]].append((e["R"], i, e["b"]))
        adj[e["b"]].append((e["R"], i, e["a"]))

    start = fan_e["a"] if fan_e["b"] == GND else fan_e["b"]
    if start == GND:
        start = fan_e["a"]

    dist = {start: fan_e["R"]}
    heap = [(fan_e["R"], start)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == GND:
            return max(MIN_R, d)
        if d > dist.get(u, 1e18) + 1e-9:
            continue
        for r, _, v in adj.get(u, []):
            nd = d + r
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    # Fallback
    return max(MIN_R, sum(e["R"] for e in edges) / max(1, len(edges)))


# ── Главная функция ───────────────────────────────────────────────────────────

def solve(nodes_in, branches_in, options):
    import numpy as np

    max_it = int(options.get("maxIter",   MAX_IT))
    eps    = float(options.get("tolerance", 0.01))
    log    = []
    diag   = []

    # 1. Граф
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

    if not edges:
        return _empty(nodes_in, "Нет ветвей")

    # Диагностика входных данных
    if not atm_ids:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов — отметьте ≥2 узла как «атмосфера» (выход на поверхность)."})
    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой."})

    # 2. Свободные узлы
    node_set = set()
    for e in edges:
        node_set.add(e["a"]); node_set.add(e["b"])
    free = sorted(node_set - {GND})
    N    = len(free)
    ni   = {v: i for i, v in enumerate(free)}
    log.append(f"N={N}, E={len(edges)}, fans={len(fans)}")

    if N == 0:
        return _empty(nodes_in, "Только атмосферные узлы")

    # 3. Начальное давление
    fan_e = fans[0] if fans else None
    r_net = shortest_r(edges, fan_e)
    q_wp  = find_working_point(fan_e, r_net) if fan_e else 0.0
    h_wp  = fan_h(fan_e, q_wp) if fan_e else 1000.0
    # P_init: давление линейно убывает от H_wp до 0 по BFS-уровням
    # Простая оценка: все узлы получают H_wp * 0.5
    P_init = max(1.0, h_wp * 0.5)
    log.append(f"r_net={r_net:.5f}, q_wp={q_wp:.2f}, h_wp={h_wp:.0f}, P_init={P_init:.0f}")

    # Инициализация давлений по BFS-уровням для лучшей сходимости
    P = np.full(N, P_init)
    if fan_e and (fan_e["a"] in ni or fan_e["b"] in ni):
        # Узел на выходе вентилятора получает H_wp, на входе — 0
        fan_out = fan_e["b"] if fan_e["a"] == GND else fan_e["a"]
        if fan_out in ni:
            P[ni[fan_out]] = h_wp * 0.9

    # 4. Newton-Raphson
    max_res = float("inf")
    it = 0

    for it in range(max_it):
        F = np.zeros(N)
        J = np.zeros((N, N))

        for e in edges:
            a, b = e["a"], e["b"]
            Pa = float(P[ni[a]]) if a in ni else 0.0
            Pb = float(P[ni[b]]) if b in ni else 0.0

            Q, dQdPa, dQdPb = edge_flow(e, Pa, Pb)

            if a in ni:
                ia = ni[a]
                F[ia]        -= Q
                J[ia, ia]    -= dQdPa
                if b in ni:
                    J[ia, ni[b]] -= dQdPb
            if b in ni:
                ib = ni[b]
                F[ib]        += Q
                J[ib, ib]    += dQdPb
                if a in ni:
                    J[ib, ni[a]] += dQdPa

        max_res = float(np.max(np.abs(F)))
        if max_res < eps:
            it += 1
            break

        # Регуляризация вырожденных строк
        d_abs = np.abs(np.diag(J))
        bad   = d_abs < 1e-10
        J[bad, bad] = 1e-6

        # Решение
        try:
            dP = np.linalg.solve(J, -F)
        except np.linalg.LinAlgError:
            try:
                dP, _, _, _ = np.linalg.lstsq(J, -F, rcond=None)
            except Exception:
                log.append(f"iter {it}: вырождена")
                break

        dP = np.where(np.isfinite(dP), dP, 0.0)

        # Ограничение шага: не более P_init за итерацию
        step = float(np.max(np.abs(dP)))
        if step > P_init:
            dP *= P_init / step

        P += dP
        P  = np.where(np.isfinite(P), P, P_init * 0.3)

    log.append(f"iter={it}, max|F|={max_res:.4f} м³/с")

    # 5. Результаты
    def get_p(nid): return float(P[ni[nid]]) if nid in ni else 0.0

    branch_out = []
    for b_in, e in zip(branches_in, edges):
        Pa = get_p(e["a"]); Pb = get_p(e["b"])
        Q, _, _ = edge_flow(e, Pa, Pb)
        am    = gnd(b_in["fromId"])
        Q_s   = Q if e["a"] == am else -Q
        if not math.isfinite(Q_s): Q_s = 0.0
        S   = e["_area"]
        V   = abs(Q_s) / S if S > 0 else 0.0
        dP  = e["R"] * Q_s * abs(Q_s)
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

    # 6. Диагностика
    fb = {v: 0.0 for v in free}
    for e in edges:
        Pa = get_p(e["a"]); Pb = get_p(e["b"])
        Q, _, _ = edge_flow(e, Pa, Pb)
        if e["a"] in fb: fb[e["a"]] -= Q
        if e["b"] in fb: fb[e["b"]] += Q

    for nid, bv in fb.items():
        if abs(bv) <= 0.5: continue
        diag.append({"level": "error" if abs(bv) > 5 else "warning",
                     "category": "node_balance",
                     "message": f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
                     "objectId": nid, "value": bv})

    for e in edges:
        if e["hasFan"]:
            Pa = get_p(e["a"]); Pb = get_p(e["b"])
            Q, _, _ = edge_flow(e, Pa, Pb)
            H_act = fan_h(e, abs(Q))
            diag.append({"level": "info", "category": "fan",
                         "message": f"Вент. {e['id'][:20]}: Q={Q:.2f} м³/с, H={H_act:.0f} Па, R={e['R']:.5f}",
                         "objectId": e["id"]})
            if H_act <= 0:
                diag.append({"level": "error", "category": "fan",
                             "message": f"Вент. {e['id'][:20]}: напор=0! Q={Q:.1f} > qMax={e['qMax']:.0f}",
                             "objectId": e["id"]})

    converged = max_res < eps
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось: max|F|={max_res:.3f} м³/с",
                     "value": max_res})

    # Изолированные узлы
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
                     "message": f"Изолировано {len(iso)} узлов без связи с атмосферой"})

    return {"ok": converged, "iterations": it, "maxDeltaQ": round(max_res, 4),
            "maxDeltaH": 0.0, "branches": branch_out, "nodes": node_out,
            "log": log, "cyclesCount": 0, "diagnostics": diag}


def _empty(nodes_in, msg):
    return {"ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
            "branches": [], "nodes": nodes_in, "log": [msg],
            "cyclesCount": 0, "diagnostics": []}


solve_network = solve
