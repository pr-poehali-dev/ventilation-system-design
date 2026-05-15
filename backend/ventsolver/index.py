"""
Решатель вентиляционной сети — Метод Контурных Расходов (МКР).

Алгоритм (7 шагов по методике):
  Шаг 1. Подготовка данных: граф, атмосфера → GND.
  Шаг 2. Инициализация Q^(0) = Q0 (рабочая точка вентилятора).
  Шаг 3. Сопротивления R переданы из фронтенда (уже посчитаны).
  Шаг 4. BFS-дерево + хорды → независимые контуры.
  Шаг 5. Итерации МКР:
           ΔH_k = Σ R_i·Q_i·|Q_i| − Σ H_f·dir_i
           δQ_k = −ΔH_k / (2·Σ R_i·|Q_i|)
           Q_i += δQ_k · dir_i
  Шаг 6. Критерий: max|ΔH_k| < 0.1 Па  ИЛИ  max|δQ_k| < 0.01 м³/с.
  Шаг 7. Проверка: баланс узлов, H(Q) вентиляторов.
"""

import json
import math
from collections import deque

GND    = "@gnd"
EPS1   = 0.1      # Па — критерий по невязке давления
EPS2   = 0.01     # м³/с — критерий по изменению расхода
MAX_IT = 2000     # предельное число итераций
MIN_R  = 1e-9     # минимальное R


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
        body      = json.loads(event.get("body") or "{}")
        nodes_in  = body.get("nodes", [])
        branches_in = body.get("branches", [])
        options   = body.get("options", {})

        result = solve_network(nodes_in, branches_in, options)

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            "body": json.dumps(result),
        }
    except Exception as e:
        import traceback
        return {
            "statusCode": 500,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            "body": json.dumps({"error": str(e), "trace": traceback.format_exc()}),
        }


# =============================================================================
# Вспомогательные функции
# =============================================================================

def fan_h(edge: dict, Q: float) -> float:
    """
    Напор вентилятора H(Q) в Па.
    Вентилятор нагнетает по направлению a→b (H > 0).
    Для режима constant: H = fanPressure (независимо от Q).
    """
    if not edge.get("hasFan"):
        return 0.0
    mode = edge.get("fanMode", "constant")
    if mode == "constant":
        return max(0.0, float(edge.get("fanPressure", 0) or 0))
    # curve — используем квадратичную аппроксимацию если есть h0/h1/h2
    h0 = float(edge.get("h0") or 0)
    h1 = float(edge.get("h1") or 0)
    h2 = float(edge.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        # кривая не передана — используем fanPressure как constant
        return max(0.0, float(edge.get("fanPressure", 0) or 0))
    Qn = abs(Q)
    return max(0.0, h0 + h1 * Qn + h2 * Qn * Qn)


def fan_dh(edge: dict, Q: float) -> float:
    """
    |dH/dQ| — производная напора вентилятора по расходу.
    Нужна для уточнения знаменателя δQ при кривой вентилятора.
    """
    if not edge.get("hasFan"):
        return 0.0
    mode = edge.get("fanMode", "constant")
    if mode != "curve":
        return 0.0
    h1 = float(edge.get("h1") or 0)
    h2 = float(edge.get("h2") or 0)
    Qn = abs(Q)
    return abs(h1 + 2 * h2 * Qn)


def estimate_q0(edges: list, R_total: float) -> float:
    """
    Оценка начального расхода Q0 из рабочей точки вентилятора:
    пересечение H_fan(Q) и сети H_net = R·Q².
    """
    fan = next((e for e in edges if e.get("hasFan")), None)
    if not fan:
        return 5.0

    H0 = fan_h(fan, 0.0)  # напор при Q=0

    if fan.get("fanMode", "constant") == "constant":
        if H0 > 0 and R_total > 0:
            return math.sqrt(H0 / R_total)
        return 5.0

    # Кривая: бисекция H_fan(q) = R_total * q^2
    q_max = float(fan.get("qMax") or 100.0)
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


def bfs_tree(edges: list, node_list: list, adj: dict, root: str):
    """
    Строим BFS-остовное дерево.
    Возвращает:
      parent[v]   = {"node": u, "edgeIdx": i}  или None для root
      bfs_order   = список узлов в BFS-порядке
      tree_set    = set индексов рёбер дерева
      chords      = список индексов хорд
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
            ei, other = item["edgeIdx"], item["other"]
            if other not in visited:
                visited.add(other)
                parent[other] = {"node": u, "edgeIdx": ei}
                tree_set.add(ei)
                queue.append(other)

    chords = [i for i in range(len(edges)) if i not in tree_set]
    return parent, bfs_order, tree_set, chords


def tree_path(from_node: str, to_node: str, edges: list, parent: dict) -> list:
    """
    Путь от from_node до to_node по остовному дереву через LCA.
    Возвращает список {"edgeIdx": i, "dir": ±1}.
    dir=+1: ребро обходится в направлении a→b.
    dir=-1: ребро обходится в направлении b→a.
    """
    def ancestors(start):
        lst = []
        cur = start
        while cur is not None:
            lst.append(cur)
            p = parent.get(cur)
            cur = p["node"] if p else None
        return lst

    ancs_from = ancestors(from_node)
    ancs_to   = ancestors(to_node)
    set_from  = {n: i for i, n in enumerate(ancs_from)}

    lca    = ancs_to[0]
    idx_to = 0
    for i, n in enumerate(ancs_to):
        if n in set_from:
            lca    = n
            idx_to = i
            break

    idx_from = set_from.get(lca, 0)
    result   = []

    # from → LCA (вверх по дереву: node → parent)
    for i in range(idx_from):
        node = ancs_from[i]
        p    = parent[node]
        e    = edges[p["edgeIdx"]]
        # движение: node → p["node"]
        # если e["a"] == node → идём a→b → dir = +1
        # если e["b"] == node → идём b→a → dir = -1
        result.append({
            "edgeIdx": p["edgeIdx"],
            "dir":     1 if e["a"] == node else -1,
        })

    # LCA → to (вниз: p["node"] → child)
    for i in range(idx_to - 1, -1, -1):
        child = ancs_to[i]
        p     = parent[child]
        e     = edges[p["edgeIdx"]]
        # движение: p["node"] → child
        # если e["a"] == p["node"] → dir = +1, иначе -1
        result.append({
            "edgeIdx": p["edgeIdx"],
            "dir":     1 if e["a"] == p["node"] else -1,
        })

    return result


# =============================================================================
# ГЛАВНАЯ ФУНКЦИЯ РАСЧЁТА
# =============================================================================

def solve_network(nodes_in: list, branches_in: list, options: dict) -> dict:

    max_it = options.get("maxIter", MAX_IT)
    eps1   = options.get("tolPressure", EPS1)
    eps2   = options.get("tolerance", EPS2)
    log    = []

    # ── ШАГ 1. Подготовка данных ─────────────────────────────────────────────

    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def to_gnd(nid: str) -> str:
        return GND if nid in atm_ids else nid

    # Строим рёбра
    edges = []
    for b in branches_in:
        R = float(b.get("resistance") or 0)
        R = max(MIN_R, R)
        edges.append({
            "id":         b["id"],
            "a":          to_gnd(b["fromId"]),
            "b":          to_gnd(b["toId"]),
            "R":          R,
            "Q":          0.0,
            "hasFan":     bool(b.get("hasFan", False)),
            "fanMode":    b.get("fanMode", "constant"),
            "fanPressure": float(b.get("fanPressure") or 0),
            # кривая вентилятора (если передана)
            "h0":         float(b.get("h0") or 0),
            "h1":         float(b.get("h1") or 0),
            "h2":         float(b.get("h2") or 0),
            "qMax":       float(b.get("qMax") or 100),
            # оригинальные данные для результата
            "_area":      float(b.get("area") or 0),
            "_fromId":    b["fromId"],
        })

    if not edges:
        return {
            "ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
            "branches": [], "nodes": nodes_in, "log": ["Нет ветвей"],
            "cyclesCount": 0, "diagnostics": [],
        }

    # Список узлов и список смежности
    node_set = set()
    for e in edges:
        node_set.add(e["a"])
        node_set.add(e["b"])
    node_list = list(node_set)

    adj = {n: [] for n in node_list}
    for i, e in enumerate(edges):
        adj[e["a"]].append({"edgeIdx": i, "other": e["b"]})
        adj[e["b"]].append({"edgeIdx": i, "other": e["a"]})

    root = GND if GND in node_set else node_list[0]

    # ── ШАГ 4. BFS-дерево + контуры ─────────────────────────────────────────

    parent, bfs_order, tree_set, chords = bfs_tree(edges, node_list, adj, root)
    bfs_pos = {n: i for i, n in enumerate(bfs_order)}

    log.append(f"Узлов: {len(node_list)}, ветвей: {len(edges)}, контуров: {len(chords)}")

    # Контуры: хорда (dir=+1) + путь в дереве от e.b обратно к e.a
    contours = []
    for ci in chords:
        e    = edges[ci]
        path = tree_path(e["b"], e["a"], edges, parent)
        contours.append([{"edgeIdx": ci, "dir": 1}] + path)

    # ── ШАГ 2. Инициализация Q^(0) ───────────────────────────────────────────

    R_tree = sum(edges[i]["R"] for i in range(len(edges)) if i in tree_set)
    Q0     = estimate_q0(edges, R_tree)
    Q0     = max(0.1, Q0)
    log.append(f"Q₀ = {Q0:.2f} м³/с")

    for i, e in enumerate(edges):
        if i not in tree_set:
            e["Q"] = Q0
        else:
            pos_a = bfs_pos.get(e["a"], 10**9)
            pos_b = bfs_pos.get(e["b"], 10**9)
            e["Q"] = Q0 if pos_b > pos_a else -Q0

    # ── ШАГ 5. Итерации МКР ──────────────────────────────────────────────────
    #
    #  ΔH_k = Σ_{i∈k} R_i · Q_i · |Q_i| · dir_i²  −  Σ_{f∈k} H_f(Q_i) · dir_i
    #       = Σ_{i∈k} R_i · Qd_i · |Qd_i|  −  Σ_{f∈k} H_f · dir_i
    #  δQ_k = −ΔH_k / (2·Σ R_i·|Qd_i|)
    #  Q_i += δQ_k · dir_i
    #
    # Где Qd_i = Q_i * dir_i (расход в направлении обхода контура).

    max_delta_q = float("inf")
    max_delta_h = float("inf")
    it = 0

    for it in range(max_it):
        max_delta_q = 0.0
        max_delta_h = 0.0

        for contour in contours:
            num = 0.0   # ΔH_k (числитель)
            den = 0.0   # 2·Σ R·|Qd| (знаменатель)

            for ce in contour:
                e   = edges[ce["edgeIdx"]]
                d   = ce["dir"]
                Qd  = e["Q"] * d           # расход в направлении обхода
                H   = fan_h(e, e["Q"])     # напор вентилятора (≥ 0, по a→b)

                # Потеря напора вдоль ребра (в направлении обхода)
                num += e["R"] * Qd * abs(Qd)
                # Вентилятор уменьшает потери если dir=+1 (помогает обходу)
                num -= H * d
                # Знаменатель
                den += 2.0 * e["R"] * abs(Qd) + fan_dh(e, e["Q"])

            if den < 1e-12:
                continue

            dQ = -num / den

            if abs(num) > max_delta_h:
                max_delta_h = abs(num)
            if abs(dQ) > max_delta_q:
                max_delta_q = abs(dQ)

            # Обновляем Q всех рёбер контура
            for ce in contour:
                edges[ce["edgeIdx"]]["Q"] += dQ * ce["dir"]

        # Защита от NaN
        for e in edges:
            if not math.isfinite(e["Q"]):
                e["Q"] = 0.0

        # ШАГ 6. Критерий остановки
        if max_delta_h < eps1 or max_delta_q < eps2:
            it += 1
            break

    log.append(
        f"Итерации: {it}, "
        f"max|ΔH|={max_delta_h:.3f} Па, "
        f"max|δQ|={max_delta_q:.4f} м³/с"
    )

    # ── ПЕРЕСЧЁТ Q ДЕРЕВА (1-й закон Кирхгофа, bottom-up) ───────────────────
    #
    # Q хорд зафиксированы итерациями.
    # Q ветвей дерева вычисляем снизу вверх:
    #   balance[v] = Σ Q_вх − Σ Q_вых  (только хорды)
    #   Q_ребра_к_родителю = −balance[v]

    balance = {n: 0.0 for n in node_list}

    # Учитываем только хорды
    for i, e in enumerate(edges):
        if i in tree_set:
            continue
        balance[e["a"]] -= e["Q"]   # отток из a
        balance[e["b"]] += e["Q"]   # приток в b

    # Bottom-up обход
    for idx in range(len(bfs_order) - 1, 0, -1):
        v   = bfs_order[idx]
        p   = parent.get(v)
        if not p:
            continue

        e      = edges[p["edgeIdx"]]
        p_node = p["node"]
        bal    = balance[v]

        # e.b == v → Q>0 приток в v → ставим e.Q = −bal
        # e.a == v → Q>0 отток из v → ставим e.Q = +bal
        if e["b"] == v:
            e["Q"] = -bal
            balance[p_node] -= e["Q"]   # e.Q > 0 → отток из p_node (a)
        else:
            e["Q"] = bal
            balance[p_node] += e["Q"]   # e.Q > 0 → приток в p_node (b)

    # ── ШАГ 8. Результаты ветвей ─────────────────────────────────────────────

    branch_results = []
    for i, b in enumerate(branches_in):
        e     = edges[i]
        a_map = to_gnd(b["fromId"])
        # Знак Q: если a ребра совпадает с физическим fromId → знак тот же
        Q_signed = e["Q"] if e["a"] == a_map else -e["Q"]
        if not math.isfinite(Q_signed):
            Q_signed = 0.0

        S   = float(b.get("area") or 0)
        V   = abs(Q_signed) / S if S > 0 else 0.0
        dP  = e["R"] * Q_signed * abs(Q_signed)
        H_f = fan_h(e, e["Q"]) if e["hasFan"] else 0.0

        branch_results.append({
            "id":          b["id"],
            "flow":        round(Q_signed, 3),
            "velocity":    round(V, 2),
            "dP":          round(dP, 1),
            "fanPressure": round(H_f, 0) if e["hasFan"] else b.get("fanPressure", 0),
        })

    # ── Давления в узлах (BFS по дереву) ─────────────────────────────────────

    pressure = {root: 0.0}   # GND = 0 Па относительно атмосферы
    p_visited = {root}
    p_queue   = deque([root])

    while p_queue:
        u = p_queue.popleft()
        for item in adj.get(u, []):
            ei, other = item["edgeIdx"], item["other"]
            if other in p_visited or ei not in tree_set:
                continue
            e   = edges[ei]
            H   = fan_h(e, e["Q"])
            dP  = e["R"] * e["Q"] * abs(e["Q"]) - H
            Pu  = pressure[u]
            # P_b = P_a − dP (если u == e.a)
            # P_a = P_b + dP → P_other = Pu + dP (если u == e.b)
            pressure[other] = (Pu - dP) if e["a"] == u else (Pu + dP)
            p_visited.add(other)
            p_queue.append(other)

    node_results = []
    for n in nodes_in:
        nid = to_gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            p_rel = pressure.get(n["id"], 0.0)
            z_cor = 12.0 * (-float(n.get("z") or 0))
            cp    = round(101325 + p_rel + z_cor)
        node_results.append({**n, "computedPressure": cp})

    # ── ШАГ 7. ДИАГНОСТИКА ───────────────────────────────────────────────────

    diagnostics = []

    # 7а. Баланс узлов
    final_balance = {n: 0.0 for n in node_list}
    for e in edges:
        final_balance[e["a"]] -= e["Q"]
        final_balance[e["b"]] += e["Q"]

    for nid, bv in final_balance.items():
        if nid == GND or abs(bv) <= 0.5:
            continue
        diagnostics.append({
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
                diagnostics.append({
                    "level":    "error",
                    "category": "fan",
                    "message":  f"Вентилятор {e['id'][:25]}: напор = 0 Па (fanPressure={e['fanPressure']})",
                    "objectId": e["id"],
                })

    # 7в. Нет вентилятора
    if not any(e["hasFan"] for e in edges):
        diagnostics.append({
            "level":    "warning",
            "category": "topology",
            "message":  "Нет вентилятора — расход нулевой",
        })

    # 7г. Сходимость
    converged = max_delta_h < eps1 or max_delta_q < eps2
    if not converged:
        diagnostics.append({
            "level":    "warning",
            "category": "convergence",
            "message":  (
                f"Не сошлось за {it} итераций: "
                f"max|ΔH|={max_delta_h:.2f} Па, max|δQ|={max_delta_q:.3f} м³/с"
            ),
            "value": max_delta_q,
        })

    # 7д. Изолированные узлы
    reachable = {root}
    stk = [root]
    while stk:
        u = stk.pop()
        for item in adj.get(u, []):
            other = item["other"]
            if other not in reachable:
                reachable.add(other)
                stk.append(other)
    isolated = [n for n in node_list if n not in reachable]
    if isolated:
        diagnostics.append({
            "level":    "error",
            "category": "topology",
            "message":  f"Изолировано {len(isolated)} узлов без атмосферной связи",
        })

    return {
        "ok":          converged,
        "iterations":  it,
        "maxDeltaQ":   round(max_delta_q, 4),
        "maxDeltaH":   round(max_delta_h, 3),
        "branches":    branch_results,
        "nodes":       node_results,
        "log":         log,
        "cyclesCount": len(chords),
        "diagnostics": diagnostics,
    }
