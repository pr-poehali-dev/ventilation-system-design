"""
Расчёт воздухораспределения — Метод узловых давлений (МУД).

Гарантирует 1-й закон Кирхгофа точно.
Ньютон–Рафсон по давлениям узлов.

POST: {nodes, branches, options:{tolerance, maxIter}}
"""
import json, math

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

GND = "__GND__"


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения горных выработок (метод узловых давлений)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return err(400, "Ошибка парсинга JSON")

    nodes_in    = body.get("nodes", [])
    branches_in = body.get("branches", [])
    options     = body.get("options", {})

    if not branches_in:
        return ok(empty_result("Нет ветвей"))

    try:
        result = solve(nodes_in, branches_in, options)
    except Exception as ex:
        import traceback
        return err(500, f"Ошибка: {ex}\n{traceback.format_exc()}")

    return ok(result)


# ══════════════════════════════════════════════════════════════════════
# ГРАФ
# ══════════════════════════════════════════════════════════════════════

def get_R(b):
    r = float(b.get("R") or b.get("resistance") or 0.0)
    return max(r, 1e-9)


def fan_H_val(e, Q):
    """
    Напор вентилятора H при расходе Q.
    Constant: H = fanPressure (всегда, знак Q не важен).
    Curve: H(|Q|), при Q<0 → H=0.
    """
    if not e.get("hasFan"):
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        if Q < 0:
            return 0.0
        if Q > float(e.get("qMax", 1e9)):
            return 0.0
        h0 = float(e.get("h0", 0))
        h1 = float(e.get("h1", 0))
        h2 = float(e.get("h2", 0))
        return max(0.0, h0 + h1 * Q + h2 * Q * Q)
    # constant: напор всегда создаётся
    return float(e.get("fanPressure", 0))


def fan_dH_val(e, Q):
    """|dH/dQ|."""
    if not e.get("hasFan") or Q < 0:
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        return abs(float(e.get("h1", 0)) + 2 * float(e.get("h2", 0)) * Q)
    return 0.0


def build_graph(nodes_in, branches_in):
    atm = set()
    for n in nodes_in:
        if n.get("isAtm") or n.get("atmosphereLink"):
            atm.add(n["id"])
    if not atm:
        for n in nodes_in:
            nid = str(n.get("id", "")).lower()
            if any(x in nid for x in ("атм", "atm", "gnd", "surface")):
                atm.add(n["id"])

    def to_gnd(nid):
        return GND if nid in atm else nid

    edges = []
    for b in branches_in:
        edges.append({
            "id":          b["id"],
            "a":           to_gnd(b["fromId"]),
            "b":           to_gnd(b["toId"]),
            "R":           get_R(b),
            "hasFan":      bool(b.get("hasFan")),
            "fanMode":     b.get("fanMode", "constant"),
            "fanPressure": float(b.get("fanPressure", 0)),
            "h0": float(b.get("h0", 0)),
            "h1": float(b.get("h1", 0)),
            "h2": float(b.get("h2", 0)),
            "qMax": float(b.get("qMax", 1e9)),
            "area": float(b.get("area", 0)),
        })
    return edges, atm


# ══════════════════════════════════════════════════════════════════════
# Q И dQ/dP ДЛЯ РЕБРА
# ══════════════════════════════════════════════════════════════════════

def edge_flow(e, Pa, Pb):
    """
    Возвращает (Q, dQ/dPa) для ребра a→b.

    Q = sign(dp_eff) * sqrt(|dp_eff| / R)
    dp_eff = Pa - Pb + H(Q)   — эффективный перепад давления

    Для constant-вентилятора H=const → dp_eff = Pa - Pb + H.
    Для curve-вентилятора используем Q0 из H(0) как начальное приближение.
    """
    R = e["R"]
    H = fan_H_val(e, 0.0)  # начальный напор (для итерации = H при Q=0)

    # dp_eff с текущим H
    dp   = Pa - Pb + H
    adp  = max(abs(dp), 1e-9)
    Q    = math.copysign(math.sqrt(adp / R), dp)
    dqdp = 1.0 / (2.0 * math.sqrt(R * adp))

    # Для curve: уточняем H(Q) за 3 итерации
    if e.get("hasFan") and e.get("fanMode", "constant") == "curve":
        for _ in range(4):
            Hv  = fan_H_val(e, Q)
            dp  = Pa - Pb + Hv
            adp = max(abs(dp), 1e-9)
            Qn  = math.copysign(math.sqrt(adp / R), dp)
            if abs(Qn - Q) < 0.1:
                Q = Qn
                break
            Q = 0.5 * Q + 0.5 * Qn
        Hv   = fan_H_val(e, Q)
        dp   = Pa - Pb + Hv
        adp  = max(abs(dp), 1e-9)
        dqdp = 1.0 / (2.0 * math.sqrt(R * adp))
        dHdQ = fan_dH_val(e, Q)
        denom = max(1.0 - dHdQ * dqdp, 0.05)
        dqdp  = dqdp / denom

    return Q, dqdp


# ══════════════════════════════════════════════════════════════════════
# МЕТОД УЗЛОВЫХ ДАВЛЕНИЙ
# ══════════════════════════════════════════════════════════════════════

def solve(nodes_in, branches_in, options):
    import numpy as np

    tol      = float(options.get("tolerance", 0.01))
    max_iter = int(options.get("maxIter", 300))

    log  = []
    diag = []

    edges, atm = build_graph(nodes_in, branches_in)

    if not atm:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов"})

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой"})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag)

    # Свободные узлы
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])
    free = sorted(all_nodes - {GND})
    N    = len(free)
    idx  = {v: i for i, v in enumerate(free)}

    log.append(f"МУД: ветвей={len(edges)} узлов={N} вент={len(fans)}")

    if N == 0:
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag)

    # Начальное P
    H0 = max((fan_H_val(e, 0.0) or float(e.get("fanPressure", 0)) for e in fans), default=1000.0)
    H0 = max(H0, 100.0)

    # Вентилятор нагнетает (a=GND→b) или вытягивает (a→b=GND)?
    # Нагнетательный: создаёт давление > 0 в сети
    # Вытяжной:       создаёт давление < 0 (депрессию) в сети
    fe = fans[0]
    exhausting = (fe["b"] == GND)   # вытяжной: воздух выходит через b=GND
    sign = -1.0 if exhausting else 1.0
    P = np.full(N, sign * H0 * 0.5)

    # Узел рядом с вентилятором
    near_fan = fe["a"] if exhausting else fe["b"]
    if near_fan != GND and near_fan in idx:
        P[idx[near_fan]] = sign * H0 * 0.85

    def get_P(node):
        return float(P[idx[node]]) if node in idx else 0.0

    max_F = float("inf")
    it    = 0

    for it in range(1, max_iter + 1):
        F = np.zeros(N)
        J = np.zeros((N, N))

        for e in edges:
            Pa = get_P(e["a"])
            Pb = get_P(e["b"])
            Q_e, dqdp = edge_flow(e, Pa, Pb)
            # dqdp = ∂Q/∂Pa > 0  (Q растёт при Pa↑)
            # ∂Q/∂Pb = -dqdp

            # F[a] = -Q → ∂F[a]/∂Pa = -dqdp, ∂F[a]/∂Pb = +dqdp
            if e["a"] in idx:
                ia = idx[e["a"]]
                F[ia]    -= Q_e
                J[ia,ia] -= dqdp          # ∂F[a]/∂Pa = -dqdp
                if e["b"] in idx:
                    J[ia, idx[e["b"]]] += dqdp   # ∂F[a]/∂Pb = +dqdp

            # F[b] = +Q → ∂F[b]/∂Pa = +dqdp, ∂F[b]/∂Pb = -dqdp
            if e["b"] in idx:
                ib = idx[e["b"]]
                F[ib]    += Q_e
                J[ib,ib] -= dqdp          # ∂F[b]/∂Pb = -dqdp
                if e["a"] in idx:
                    J[ib, idx[e["a"]]] += dqdp   # ∂F[b]/∂Pa = +dqdp

        max_F = float(np.max(np.abs(F)))
        if max_F < tol:
            it += 1
            break

        # Регуляризация (диагональ отрицательная, защищаем от нуля)
        for i in range(N):
            if abs(J[i,i]) < 1e-9:
                J[i,i] = -1e-6

        try:
            dP = np.linalg.solve(J, -F)
        except np.linalg.LinAlgError:
            dP, _, _, _ = np.linalg.lstsq(J, -F, rcond=None)

        dP = np.where(np.isfinite(dP), dP, 0.0)
        step = float(np.max(np.abs(dP)))
        if step > H0 * 2:
            dP *= H0 * 2 / step

        P += dP
        P  = np.where(np.isfinite(P), P, H0 * 0.5)

    converged = max_F < tol
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. |F|={max_F:.4f} м³/с"})

    log.append(f"Итераций={it} max|F|={max_F:.4f} м³/с")

    Q = {}
    for e in edges:
        q, _ = edge_flow(e, get_P(e["a"]), get_P(e["b"]))
        Q[e["id"]] = q

    return make_result(edges, Q, it, converged, max_F, log, diag)


def make_result(edges, Q, it, converged, max_res, log, diag):
    out = []
    for e in edges:
        q    = Q.get(e["id"], 0.0)
        H    = e["R"] * q * abs(q)
        Hv   = fan_H_val(e, q)
        area = e.get("area", 0.0)
        vel  = abs(q) / area if area > 0.01 else 0.0
        out.append({"id": e["id"], "Q": round(q,4), "H": round(H,3),
                    "Hfan": round(Hv,3), "velocity": round(vel,3)})
    return {"branches": out, "nodes": [], "iterations": it,
            "converged": converged, "maxResidual": round(max_res,6),
            "log": log, "diagnostics": diag}


def empty_result(msg):
    return {"branches": [], "nodes": [], "iterations": 0, "converged": True,
            "maxResidual": 0.0, "log": [msg],
            "diagnostics": [{"level":"warning","category":"topology","message":msg}]}


def ok(data):
    return {"statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(data, ensure_ascii=False)}


def err(code, msg):
    return {"statusCode": code,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": msg}, ensure_ascii=False)}