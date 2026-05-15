"""
Решатель вентиляционной сети — Метод Контурных Расходов (МКР).

ПРИНЦИПЫ:
  1. Все атмосферные узлы → GND (опорный узел, давление = 0).
  2. BFS от GND строит остовное дерево. Хорды = независимые контуры.
  3. Q^(0) — рабочая точка вентилятора. Q > 0 означает ток a→b.
  4. Итерации МКР: корректируем расходы по контурам пока ΔH < ε.
  5. После итераций: Q хорд известны. Q ветвей дерева вычисляем
     снизу-вверх через 1-й закон Кирхгофа (Σ Q_вх = Σ Q_вых).

BOTTOM-UP (критически важно):
  - balance[v] = сумма ВСЕХ известных Q в/из узла v (хорды + вентиляторы)
  - Ветви дерева вычисляются одна за одной от листьев к корню
  - Вентиляторы в дереве обрабатываются как обычные ветви (их Q известен
    после итераций) — они участвуют в формировании balance
  - НЕТ никакого специального случая для вентилятора в bottom-up
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

SURFACE_ALPHA = {
    "smooth": 9, "concrete": 12, "concrete_rough": 30, "anchor": 35,
    "wood": 60, "metal_arch": 50, "uncoupled": 25, "uncoupled_r": 80,
    "shaft_smooth": 15, "shaft_skip": 45, "lava": 150,
}


# ─────────────────────────────────────────────────────────────────────────────
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
        result = solve(body.get("nodes", []), body.get("branches", []), body.get("options", {}))
        return {"statusCode": 200,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps(result)}
    except Exception as exc:
        import traceback
        return {"statusCode": 500,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps({"error": str(exc), "trace": traceback.format_exc()})}


# ─────────────────────────────────────────────────────────────────────────────
# Сопротивление R
# ─────────────────────────────────────────────────────────────────────────────

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
        Dh  = (4 * S) / P
        rel = max(1e-9, float(b.get("roughness") or 1) / 1000 / Dh)
        Rf  = 0.11 * rel**0.25 * L * P / (8 * S**3)
    else:
        sid   = str(b.get("surfaceId") or "")
        alpha = float(b.get("alphaCoef") or SURFACE_ALPHA.get(sid, 9))
        Rf    = alpha * 1e-4 * P * L / S**3
    xi = float(b.get("localXi") or 0)
    Rl = xi * 1.2 / (2 * S * S) if xi > 0 else 0
    return max(MIN_R, Rf + Rl) if (Rf + Rl) > 0 else DEFAULT_R


# ─────────────────────────────────────────────────────────────────────────────
# Напор вентилятора
# ─────────────────────────────────────────────────────────────────────────────

def fan_h(e: dict, Q: float) -> float:
    """H(|Q|) ≥ 0. Нагнетает в направлении a→b."""
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


# ─────────────────────────────────────────────────────────────────────────────
# Начальное Q0: рабочая точка H_fan(Q) = R_path * Q^2
# ─────────────────────────────────────────────────────────────────────────────

def init_q0(fan_e: dict, R_path: float) -> float:
    if fan_e is None:
        return 5.0
    mode  = str(fan_e.get("fanMode") or "constant")
    qmin  = float(fan_e.get("qMin") or 0)
    qmax  = float(fan_e.get("qMax") or 100)
    clamp = lambda q: max(max(qmin, 0.1), min(qmax, q))

    if mode == "constant":
        fp = float(fan_e.get("fanPressure") or 0)
        if fp > 0 and R_path > 0:
            return clamp(math.sqrt(fp / R_path))
        return qmax * 0.5

    h0 = float(fan_e.get("h0") or 0)
    h1 = float(fan_e.get("h1") or 0)
    h2 = float(fan_e.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        fp = float(fan_e.get("fanPressure") or 0)
        if fp > 0 and R_path > 0:
            return clamp(math.sqrt(fp / R_path))
        return qmax * 0.5

    if R_path <= 0:
        return clamp((qmin + qmax) / 2)

    lo, hi = max(qmin, 0.0), qmax
    for _ in range(100):
        q  = (lo + hi) / 2
        Hf = fan_h(fan_e, q)
        Hn = R_path * q * q
        if abs(Hf - Hn) < 0.01:
            break
        if Hf > Hn:
            lo = q
        else:
            hi = q
    return clamp((lo + hi) / 2)


# ─────────────────────────────────────────────────────────────────────────────
# BFS-дерево
# ─────────────────────────────────────────────────────────────────────────────

def build_tree(edges, adj, root):
    parent   = {root: None}
    visited  = {root}
    tree_set = set()
    order    = []
    q        = deque([root])
    while q:
        u = q.popleft()
        order.append(u)
        for nb in adj.get(u, []):
            ei, v = nb["ei"], nb["v"]
            if v not in visited:
                visited.add(v)
                parent[v] = {"node": u, "ei": ei}
                tree_set.add(ei)
                q.append(v)
    chords  = [i for i in range(len(edges)) if i not in tree_set]
    bfs_pos = {n: i for i, n in enumerate(order)}
    return parent, order, tree_set, chords, bfs_pos


# ─────────────────────────────────────────────────────────────────────────────
# Путь между двумя узлами в дереве (через LCA)
# ─────────────────────────────────────────────────────────────────────────────

def tree_path(fv, tv, edges, parent):
    def ancs(v):
        lst, cur = [], v
        while cur is not None:
            lst.append(cur)
            p = parent.get(cur)
            cur = p["node"] if p else None
        return lst

    af, at = ancs(fv), ancs(tv)
    sf = {n: i for i, n in enumerate(af)}
    lca, ito = at[0], 0
    for i, n in enumerate(at):
        if n in sf:
            lca, ito = n, i
            break
    ifrom = sf.get(lca, 0)
    res = []
    for i in range(ifrom):
        v = af[i]; p = parent[v]; e = edges[p["ei"]]
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == v else -1})
    for i in range(ito - 1, -1, -1):
        child = at[i]; p = parent[child]; e = edges[p["ei"]]
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == p["node"] else -1})
    return res


# ─────────────────────────────────────────────────────────────────────────────
# R главного пути от вентилятора до корня
# ─────────────────────────────────────────────────────────────────────────────

def path_r_to_root(fan_e, edges, parent):
    if fan_e is None:
        return DEFAULT_R
    # Начинаем с конца вентилятора ≠ GND
    start = fan_e["a"] if fan_e["b"] == GND else fan_e["b"]
    if start == GND:
        start = fan_e["a"]
    R, cur, seen = fan_e["R"], start, set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        p = parent.get(cur)
        if p is None:
            break
        R  += edges[p["ei"]]["R"]
        cur = p["node"]
    return max(MIN_R, R)


# ─────────────────────────────────────────────────────────────────────────────
# ГЛАВНАЯ ФУНКЦИЯ
# ─────────────────────────────────────────────────────────────────────────────

def solve(nodes_in, branches_in, options):
    max_it = int(options.get("maxIter",      MAX_IT))
    eps1   = float(options.get("tolPressure", EPS1))
    eps2   = float(options.get("tolerance",   EPS2))
    log    = []
    diag   = []

    # ── 1. Граф ───────────────────────────────────────────────────────────────
    atm = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def gnd(nid): return GND if nid in atm else nid

    E = []  # рёбра
    for b in branches_in:
        E.append({
            "id":   b["id"],
            "a":    gnd(b["fromId"]),
            "b":    gnd(b["toId"]),
            "R":    calc_r(b),
            "Q":    0.0,
            "hasFan":      bool(b.get("hasFan", False)),
            "fanMode":     str(b.get("fanMode") or "constant"),
            "fanPressure": float(b.get("fanPressure") or 0),
            "h0":  float(b.get("h0") or 0),
            "h1":  float(b.get("h1") or 0),
            "h2":  float(b.get("h2") or 0),
            "qMin": float(b.get("qMin") or 0),
            "qMax": float(b.get("qMax") or 100),
            "_fid": b["fromId"],
            "_S":   float(b.get("area") or 0),
        })

    if not E:
        return _empty(nodes_in, "Нет ветвей")

    if not atm:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов (≥2 узла должны быть помечены «атмосфера»)."})
    fans = [e for e in E if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой."})

    # Список узлов и смежность
    nodes = set()
    for e in E:
        nodes.add(e["a"]); nodes.add(e["b"])
    nodes = list(nodes)
    adj   = {n: [] for n in nodes}
    for i, e in enumerate(E):
        adj[e["a"]].append({"ei": i, "v": e["b"]})
        adj[e["b"]].append({"ei": i, "v": e["a"]})

    root = GND if GND in nodes else nodes[0]

    # ── 4. Контуры ────────────────────────────────────────────────────────────
    par, order, tree, chords, bpos = build_tree(E, adj, root)
    log.append(f"N={len(nodes)}, E={len(E)}, контуров={len(chords)}")

    contours = []
    for ci in chords:
        e = E[ci]
        contours.append([{"ei": ci, "dir": 1}] + tree_path(e["b"], e["a"], E, par))

    # ── 2. Q^(0) ─────────────────────────────────────────────────────────────
    fan_e  = fans[0] if fans else None
    R_path = path_r_to_root(fan_e, E, par)
    Q0     = max(0.1, init_q0(fan_e, R_path))
    log.append(f"Q0={Q0:.2f} м³/с, R_path={R_path:.5f}")

    for i, e in enumerate(E):
        if i not in tree:
            e["Q"] = Q0   # хорда
        elif e["hasFan"]:
            e["Q"] = Q0   # вентилятор нагнетает a→b
        else:
            pa = bpos.get(e["a"], 10**9)
            pb = bpos.get(e["b"], 10**9)
            e["Q"] = Q0 if pb > pa else -Q0

    # ── 5. Итерации МКР ───────────────────────────────────────────────────────
    max_dh = max_dq = float("inf")
    it = 0
    for it in range(max_it):
        max_dh = max_dq = 0.0
        for C in contours:
            num = den = 0.0
            for ce in C:
                e = E[ce["ei"]]; d = ce["dir"]
                Qd = e["Q"] * d
                H  = fan_h(e, e["Q"])
                num += e["R"] * Qd * abs(Qd) - H * d
                den += 2.0 * e["R"] * abs(Qd) + fan_dh(e, e["Q"])
            if den < 1e-12:
                continue
            dQ = -num / den
            if abs(num) > max_dh: max_dh = abs(num)
            if abs(dQ)  > max_dq: max_dq = abs(dQ)
            for ce in C:
                E[ce["ei"]]["Q"] += dQ * ce["dir"]

        for e in E:
            if not math.isfinite(e["Q"]):
                e["Q"] = 0.0
            if e["hasFan"] and str(e.get("fanMode")) == "curve":
                qm = e.get("qMax") or 100
                if abs(e["Q"]) > qm:
                    e["Q"] = math.copysign(qm, e["Q"])

        if max_dh < eps1 or max_dq < eps2:
            it += 1; break

    log.append(f"iter={it}, max|ΔH|={max_dh:.3f} Па, max|δQ|={max_dq:.4f} м³/с")

    # ── BOTTOM-UP: Q дерева из 1-го закона Кирхгофа ──────────────────────────
    #
    # АЛГОРИТМ:
    # 1. balance[v] = Σ Q_вх(v) − Σ Q_вых(v) для ВСЕХ ветвей кроме ветви к родителю.
    #    Инициализируем balance для ВСЕХ известных ветвей (хорды + ветви дерева,
    #    которые уже были обработаны на предыдущих шагах снизу вверх).
    # 2. Идём снизу вверх. Для узла v: Q_к_родителю = −balance[v].
    #    Обновляем balance[родитель].
    #
    # ВАЖНО: инициализируем balance только хордами. Затем снизу вверх
    # добавляем Q уже обработанных ветвей дерева в balance родителя.
    # Ветвь к родителю НЕ включается в balance[v] — её Q мы сейчас и ищем.

    bal = {n: 0.0 for n in nodes}

    # Инициализация: только хорды (их Q зафиксированы итерациями МКР)
    for i, e in enumerate(E):
        if i in tree:
            continue  # ветви дерева — пока пропускаем
        # e.Q > 0: ток из a в b → отток из a, приток в b
        bal[e["a"]] -= e["Q"]
        bal[e["b"]] += e["Q"]

    # Bottom-up: от листьев к корню
    for idx in range(len(order) - 1, 0, -1):
        v = order[idx]
        p = par.get(v)
        if p is None:
            continue
        ei    = p["ei"]
        e     = E[ei]
        pnode = p["node"]

        # bal[v] = (вклад хорд) + (вклад уже обработанных дочерних ветвей дерева)
        # Ветвь e идёт между v и pnode. Q этой ветви = −bal[v],
        # чтобы компенсировать дисбаланс в v.
        #
        # e.b == v: Q>0 означает приток в v (ток pnode→v).
        #           Нужен приток = −bal[v] → e.Q = −bal[v].
        # e.a == v: Q>0 означает отток из v (ток v→pnode).
        #           Нужен отток = bal[v] → e.Q = bal[v].
        if e["b"] == v:
            e["Q"] = -bal[v]
        else:
            e["Q"] = bal[v]

        # Обновляем баланс родителя:
        # e.Q > 0, e направлено a→b:
        # если e.a == pnode: отток из pnode → bal[pnode] -= e.Q
        # если e.b == pnode: приток в pnode → bal[pnode] += e.Q
        if e["a"] == pnode:
            bal[pnode] -= e["Q"]
        else:
            bal[pnode] += e["Q"]

    # ── Результаты ветвей ─────────────────────────────────────────────────────

    br_out = []
    for i, b in enumerate(branches_in):
        e   = E[i]
        am  = gnd(b["fromId"])
        Qs  = e["Q"] if e["a"] == am else -e["Q"]
        if not math.isfinite(Qs): Qs = 0.0
        S   = e["_S"]
        V   = abs(Qs) / S if S > 0 else 0.0
        dP  = e["R"] * Qs * abs(Qs)
        br_out.append({"id": b["id"], "flow": round(Qs, 3),
                       "velocity": round(V, 2), "dP": round(dP, 1)})

    # ── Давления узлов (BFS по дереву) ────────────────────────────────────────

    pres = {root: 0.0}
    pvis = {root}
    pq   = deque([root])
    while pq:
        u = pq.popleft()
        for nb in adj.get(u, []):
            ei, oth = nb["ei"], nb["v"]
            if oth in pvis or ei not in tree: continue
            e  = E[ei]
            H  = fan_h(e, e["Q"])
            dP = e["R"] * e["Q"] * abs(e["Q"]) - H
            Pu = pres[u]
            pres[oth] = (Pu - dP) if e["a"] == u else (Pu + dP)
            pvis.add(oth); pq.append(oth)

    nd_out = []
    for n in nodes_in:
        nid = gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            cp = round(101325 + pres.get(n["id"], 0.0) + 12 * (-float(n.get("z") or 0)))
        nd_out.append({**n, "computedPressure": cp})

    # ── 7. Диагностика ────────────────────────────────────────────────────────

    # Финальный баланс
    fb = {n: 0.0 for n in nodes}
    for e in E:
        fb[e["a"]] -= e["Q"]; fb[e["b"]] += e["Q"]
    for nid, bv in fb.items():
        if nid == GND or abs(bv) <= 0.5: continue
        diag.append({"level": "error" if abs(bv) > 5 else "warning",
                     "category": "node_balance",
                     "message": f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
                     "objectId": nid, "value": bv})

    for e in E:
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
        for nb in adj.get(u, []):
            v = nb["v"]
            if v not in reach: reach.add(v); stk.append(v)
    iso = [n for n in nodes if n not in reach]
    if iso:
        diag.append({"level": "error", "category": "topology",
                     "message": f"Изолировано {len(iso)} узлов"})

    return {"ok": converged, "iterations": it, "maxDeltaQ": round(max_dq, 4),
            "maxDeltaH": round(max_dh, 3), "branches": br_out, "nodes": nd_out,
            "log": log, "cyclesCount": len(chords), "diagnostics": diag}


def _empty(nodes_in, msg):
    return {"ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
            "branches": [], "nodes": nodes_in, "log": [msg],
            "cyclesCount": 0, "diagnostics": []}


# ─────────────────────────────────────────────────────────────────────────────
# Псевдоним для обратной совместимости
# ─────────────────────────────────────────────────────────────────────────────
solve_network = solve
