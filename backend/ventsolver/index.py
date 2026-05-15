"""
Решатель вентиляционной сети — Метод Контурных Расходов (МКР).
Реализация как в ПО АэроСеть.

Правила:
  - Минимум 2 атмосферных узла + вентилятор для работы расчёта
  - Все атмосферные узлы объединяются в GND (опорный узел)
  - Вентилятор нагнетает воздух по направлению a→b (fromId→toId)
  - Q > 0 означает поток от fromId к toId

Алгоритм МКР (7 шагов):
  Шаг 1. Граф: узлы + рёбра, атмосфера → GND
  Шаг 2. Q^(0) = Q0 (рабочая точка вентилятора), ветви дерева — от корня к листьям
  Шаг 3. R уже передан с фронтенда (рассчитан через α·P·L/S³)
  Шаг 4. BFS-дерево + хорды → независимые контуры
  Шаг 5. Итерации: ΔH_k = Σ R·Qd·|Qd| − Σ H_f·dir; δQ = −ΔH/(2ΣR|Qd|)
  Шаг 6. Стоп: max|ΔH| < 0.1 Па  ИЛИ  max|δQ| < 0.01 м³/с
  Шаг 7. Проверка: баланс узлов, напоры вентиляторов
"""

import json
import math
from collections import deque

GND    = "@gnd"
EPS1   = 0.1       # Па
EPS2   = 0.01      # м³/с
MAX_IT = 2000
MIN_R  = 1e-9


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения вентиляционной сети методом МКР."""

    if event.get("httpMethod") == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            "body": "",
        }

    try:
        body        = json.loads(event.get("body") or "{}")
        nodes_in    = body.get("nodes", [])
        branches_in = body.get("branches", [])
        options     = body.get("options", {})

        result = solve_network(nodes_in, branches_in, options)

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            "body": json.dumps(result),
        }
    except Exception as exc:
        import traceback
        return {
            "statusCode": 500,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            "body": json.dumps({"error": str(exc), "trace": traceback.format_exc()}),
        }


# =============================================================================
# НАПОР ВЕНТИЛЯТОРА
# =============================================================================

def fan_h(edge: dict, Q: float) -> float:
    """
    H(Q) ≥ 0 Па. Вентилятор нагнетает в направлении a→b.
    constant: H = fanPressure (не зависит от Q).
    curve:    H = h0 + h1·|Q| + h2·Q²  (если коэффициенты переданы).
    """
    if not edge.get("hasFan"):
        return 0.0
    fp = float(edge.get("fanPressure") or 0)
    mode = edge.get("fanMode", "constant")
    if mode == "constant":
        return max(0.0, fp)
    # curve
    h0 = float(edge.get("h0") or 0)
    h1 = float(edge.get("h1") or 0)
    h2 = float(edge.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        return max(0.0, fp)  # кривая не передана — как constant
    Qn = abs(Q)
    return max(0.0, h0 + h1 * Qn + h2 * Qn * Qn)


def fan_dh(edge: dict, Q: float) -> float:
    """|dH/dQ| — производная напора (только для curve-режима)."""
    if not edge.get("hasFan") or edge.get("fanMode") != "curve":
        return 0.0
    h1 = float(edge.get("h1") or 0)
    h2 = float(edge.get("h2") or 0)
    return abs(h1 + 2 * h2 * abs(Q))


def estimate_q0(edges: list, R_total: float) -> float:
    """
    Начальный Q0: рабочая точка вентилятора H(Q) = R·Q².
    Если вентилятора нет — возвращает 5 м³/с.
    """
    fan = next((e for e in edges if e.get("hasFan")), None)
    if not fan:
        return 5.0
    H0 = fan_h(fan, 0.0)
    if fan.get("fanMode", "constant") == "constant":
        if H0 > 0 and R_total > 0:
            return max(0.1, math.sqrt(H0 / R_total))
        return max(0.1, H0 / 1000) if H0 > 0 else 5.0
    # curve — бисекция
    q_max = float(fan.get("qMax") or 100.0)
    if R_total <= 0:
        return q_max / 2.0
    lo, hi = 0.0, q_max
    for _ in range(80):
        q  = (lo + hi) / 2.0
        Hf = fan_h(fan, q)
        Hn = R_total * q * q
        if abs(Hf - Hn) < 0.05:
            return max(0.1, q)
        if Hf > Hn:
            lo = q
        else:
            hi = q
    return max(0.1, (lo + hi) / 2.0)


# =============================================================================
# BFS-ДЕРЕВО
# =============================================================================

def build_bfs_tree(edges: list, adj: dict, root: str):
    """
    BFS от root. Возвращает:
      parent    dict: v → {node, edgeIdx} или None для root
      bfs_order list: узлы в BFS-порядке
      tree_set  set:  индексы рёбер дерева
      chords    list: индексы хорд (независимые контуры)
      bfs_pos   dict: v → позиция в BFS-порядке
    """
    parent    = {root: None}
    visited   = {root}
    tree_set  = set()
    bfs_order = []
    queue     = deque([root])

    while queue:
        u = queue.popleft()
        bfs_order.append(u)
        for item in adj.get(u, []):
            ei, other = item["ei"], item["v"]
            if other not in visited:
                visited.add(other)
                parent[other] = {"node": u, "ei": ei}
                tree_set.add(ei)
                queue.append(other)

    chords  = [i for i in range(len(edges)) if i not in tree_set]
    bfs_pos = {n: i for i, n in enumerate(bfs_order)}
    return parent, bfs_order, tree_set, chords, bfs_pos


# =============================================================================
# ПУТЬ В ДЕРЕВЕ (через LCA)
# =============================================================================

def tree_path(from_v: str, to_v: str, edges: list, parent: dict) -> list:
    """
    Путь от from_v до to_v через LCA.
    dir=+1: ребро обходится a→b; dir=-1: b→a.
    """
    def ancs(v):
        lst = []
        cur = v
        while cur is not None:
            lst.append(cur)
            p = parent.get(cur)
            cur = p["node"] if p else None
        return lst

    af   = ancs(from_v)
    at   = ancs(to_v)
    sf   = {n: i for i, n in enumerate(af)}

    lca    = at[0]
    ito    = 0
    for i, n in enumerate(at):
        if n in sf:
            lca = n
            ito = i
            break

    ifrom = sf.get(lca, 0)
    res   = []

    # from → LCA (вверх: node → parent)
    for i in range(ifrom):
        v = af[i]
        p = parent[v]
        e = edges[p["ei"]]
        # движение: v → p["node"]
        # e.a == v → идём a→b → dir=+1; e.b == v → b→a → dir=-1
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == v else -1})

    # LCA → to (вниз: p["node"] → child)
    for i in range(ito - 1, -1, -1):
        child = at[i]
        p     = parent[child]
        e     = edges[p["ei"]]
        # движение: p["node"] → child
        # e.a == p["node"] → dir=+1; иначе -1
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == p["node"] else -1})

    return res


# =============================================================================
# ГЛАВНАЯ ФУНКЦИЯ
# =============================================================================

def solve_network(nodes_in: list, branches_in: list, options: dict) -> dict:
    max_it = int(options.get("maxIter",     MAX_IT))
    eps1   = float(options.get("tolPressure", EPS1))
    eps2   = float(options.get("tolerance",   EPS2))
    log    = []
    diag   = []

    # ── ШАГ 1. ГРАФ ────────────────────────────────────────────────────────

    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def gnd(nid: str) -> str:
        return GND if nid in atm_ids else nid

    edges = []
    for b in branches_in:
        R = max(MIN_R, float(b.get("resistance") or 0))
        edges.append({
            "id":          b["id"],
            "a":           gnd(b["fromId"]),
            "b":           gnd(b["toId"]),
            "R":           R,
            "Q":           0.0,
            "hasFan":      bool(b.get("hasFan", False)),
            "fanMode":     str(b.get("fanMode") or "constant"),
            "fanPressure": float(b.get("fanPressure") or 0),
            "h0":          float(b.get("h0") or 0),
            "h1":          float(b.get("h1") or 0),
            "h2":          float(b.get("h2") or 0),
            "qMax":        float(b.get("qMax") or 100),
            "_fromId":     b["fromId"],
            "_area":       float(b.get("area") or 0),
        })

    if not edges:
        return _empty(nodes_in, "Нет ветвей")

    # Проверяем наличие атмосферных узлов и вентилятора
    has_fan = any(e["hasFan"] for e in edges)
    if not atm_ids:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов. Отметьте ≥2 узла как «атмосфера»."})
    if not has_fan:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход будет нулевым."})

    # Список смежности
    node_set = set()
    for e in edges:
        node_set.add(e["a"])
        node_set.add(e["b"])
    node_list = list(node_set)

    adj = {n: [] for n in node_list}
    for i, e in enumerate(edges):
        adj[e["a"]].append({"ei": i, "v": e["b"]})
        adj[e["b"]].append({"ei": i, "v": e["a"]})

    root = GND if GND in node_set else node_list[0]

    # ── ШАГ 4. КОНТУРЫ ─────────────────────────────────────────────────────

    parent, bfs_order, tree_set, chords, bfs_pos = build_bfs_tree(edges, adj, root)
    log.append(f"Узлов: {len(node_list)}, ветвей: {len(edges)}, контуров: {len(chords)}")

    # Контур = хорда (dir=+1) + путь в дереве от e.b → e.a
    contours = []
    for ci in chords:
        e    = edges[ci]
        path = tree_path(e["b"], e["a"], edges, parent)
        contours.append([{"ei": ci, "dir": 1}] + path)

    # ── ШАГ 2. ИНИЦИАЛИЗАЦИЯ Q^(0) ─────────────────────────────────────────
    #
    # Q0 = рабочая точка вентилятора.
    # Ветви дерева: Q = +Q0 если b дальше от корня, -Q0 иначе.
    # Вентилятор: ВСЕГДА Q = +Q0 (нагнетает в направлении a→b).
    # Хорды: Q = +Q0.

    R_tree = sum(edges[i]["R"] for i in range(len(edges)) if i in tree_set)
    Q0     = max(0.1, estimate_q0(edges, R_tree))
    log.append(f"Q₀ = {Q0:.2f} м³/с")

    for i, e in enumerate(edges):
        if i not in tree_set:
            # хорда
            e["Q"] = Q0
        elif e["hasFan"]:
            # вентилятор в дереве — ВСЕГДА положительное направление a→b
            e["Q"] = Q0
        else:
            # ветвь дерева — от корня к листьям
            pa = bfs_pos.get(e["a"], 10**9)
            pb = bfs_pos.get(e["b"], 10**9)
            e["Q"] = Q0 if pb > pa else -Q0

    # ── ШАГ 5. ИТЕРАЦИИ МКР ────────────────────────────────────────────────

    max_dh = float("inf")
    max_dq = float("inf")
    it     = 0

    for it in range(max_it):
        max_dh = 0.0
        max_dq = 0.0

        for contour in contours:
            num = 0.0
            den = 0.0

            for ce in contour:
                e  = edges[ce["ei"]]
                d  = ce["dir"]
                Qd = e["Q"] * d               # расход в направлении обхода
                H  = fan_h(e, e["Q"])         # напор (≥0, по a→b)

                num += e["R"] * Qd * abs(Qd)  # потеря напора
                num -= H * d                   # вентилятор убавляет ΔH

                den += 2.0 * e["R"] * abs(Qd) + fan_dh(e, e["Q"])

            if den < 1e-12:
                continue

            dQ = -num / den

            if abs(num) > max_dh:
                max_dh = abs(num)
            if abs(dQ) > max_dq:
                max_dq = abs(dQ)

            for ce in contour:
                edges[ce["ei"]]["Q"] += dQ * ce["dir"]

        # Защита от NaN
        for e in edges:
            if not math.isfinite(e["Q"]):
                e["Q"] = 0.0

        # ШАГ 6. Критерий остановки
        if max_dh < eps1 or max_dq < eps2:
            it += 1
            break

    log.append(f"Итерации: {it}, max|ΔH|={max_dh:.3f} Па, max|δQ|={max_dq:.4f} м³/с")

    # ── ПЕРЕСЧЁТ Q ДЕРЕВА (bottom-up, 1-й закон Кирхгофа) ──────────────────
    #
    # balance[v] = Σ Q_вх − Σ Q_вых  (только хорды → баланс от хорд)
    # Q_ребра_к_родителю = −balance[v]

    balance = {n: 0.0 for n in node_list}
    for i, e in enumerate(edges):
        if i in tree_set:
            continue
        balance[e["a"]] -= e["Q"]
        balance[e["b"]] += e["Q"]

    for idx in range(len(bfs_order) - 1, 0, -1):
        v = bfs_order[idx]
        p = parent.get(v)
        if not p:
            continue
        e      = edges[p["ei"]]
        pnode  = p["node"]
        bal    = balance[v]

        if e["b"] == v:
            # e.a=pnode, e.b=v: Q>0 → приток в v → нужен приток = -bal
            e["Q"] = -bal
            balance[pnode] -= e["Q"]   # отток из pnode (= e.a)
        else:
            # e.a=v, e.b=pnode: Q>0 → отток из v → нужен отток = bal
            e["Q"] = bal
            balance[pnode] += e["Q"]   # приток в pnode (= e.b)

    # ── РЕЗУЛЬТАТЫ ВЕТВЕЙ ───────────────────────────────────────────────────

    branch_out = []
    for i, b in enumerate(branches_in):
        e        = edges[i]
        a_map    = gnd(b["fromId"])
        # Знак Q: ребро ориентировано a→b. Если a == fromId → знак тот же.
        Q_signed = e["Q"] if e["a"] == a_map else -e["Q"]
        if not math.isfinite(Q_signed):
            Q_signed = 0.0

        S  = float(b.get("area") or 0)
        V  = abs(Q_signed) / S if S > 0 else 0.0
        dP = e["R"] * Q_signed * abs(Q_signed)

        branch_out.append({
            "id":       b["id"],
            "flow":     round(Q_signed, 3),
            "velocity": round(V, 2),
            "dP":       round(dP, 1),
        })

    # ── ДАВЛЕНИЯ УЗЛОВ (BFS по дереву) ─────────────────────────────────────

    pressure  = {root: 0.0}
    pvis      = {root}
    pqueue    = deque([root])

    while pqueue:
        u = pqueue.popleft()
        for item in adj.get(u, []):
            ei, other = item["ei"], item["v"]
            if other in pvis or ei not in tree_set:
                continue
            e   = edges[ei]
            H   = fan_h(e, e["Q"])
            dP  = e["R"] * e["Q"] * abs(e["Q"]) - H
            Pu  = pressure[u]
            pressure[other] = (Pu - dP) if e["a"] == u else (Pu + dP)
            pvis.add(other)
            pqueue.append(other)

    node_out = []
    for n in nodes_in:
        nid = gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            p_rel = pressure.get(n["id"], 0.0)
            z_cor = 12.0 * (-float(n.get("z") or 0))
            cp    = round(101325 + p_rel + z_cor)
        node_out.append({**n, "computedPressure": cp})

    # ── ШАГ 7. ДИАГНОСТИКА ─────────────────────────────────────────────────

    # 7а. Баланс узлов
    final_bal = {n: 0.0 for n in node_list}
    for e in edges:
        final_bal[e["a"]] -= e["Q"]
        final_bal[e["b"]] += e["Q"]

    for nid, bv in final_bal.items():
        if nid == GND or abs(bv) <= 0.5:
            continue
        diag.append({
            "level":    "error" if abs(bv) > 5 else "warning",
            "category": "node_balance",
            "message":  f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
            "objectId": nid,
            "value":    bv,
        })

    # 7б. Вентиляторы с нулевым напором
    for e in edges:
        if e["hasFan"]:
            H = fan_h(e, e["Q"])
            if H <= 0:
                diag.append({
                    "level":    "error",
                    "category": "fan",
                    "message":  f"Вентилятор {e['id'][:25]}: напор = 0 Па (fanPressure={e['fanPressure']})",
                    "objectId": e["id"],
                })

    # 7в. Сходимость
    converged = max_dh < eps1 or max_dq < eps2
    if not converged:
        diag.append({
            "level":    "warning",
            "category": "convergence",
            "message":  (
                f"Не сошлось за {it} ит.: "
                f"max|ΔH|={max_dh:.2f} Па, max|δQ|={max_dq:.3f} м³/с"
            ),
            "value": max_dq,
        })

    # 7г. Изолированные узлы
    reachable = {root}
    stk       = [root]
    while stk:
        u = stk.pop()
        for item in adj.get(u, []):
            ov = item["v"]
            if ov not in reachable:
                reachable.add(ov)
                stk.append(ov)
    isolated = [n for n in node_list if n not in reachable]
    if isolated:
        diag.append({
            "level": "error", "category": "topology",
            "message": f"Изолировано {len(isolated)} узлов без атмосферной связи",
        })

    return {
        "ok":          converged,
        "iterations":  it,
        "maxDeltaQ":   round(max_dq, 4),
        "maxDeltaH":   round(max_dh, 3),
        "branches":    branch_out,
        "nodes":       node_out,
        "log":         log,
        "cyclesCount": len(chords),
        "diagnostics": diag,
    }


def _empty(nodes_in, msg):
    return {
        "ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
        "branches": [], "nodes": nodes_in, "log": [msg],
        "cyclesCount": 0, "diagnostics": [],
    }
