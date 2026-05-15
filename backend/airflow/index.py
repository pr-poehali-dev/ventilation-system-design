"""
Расчёт воздухораспределения — МКР (Метод контурных расходов).

Алгоритм идентичен src/lib/networkSolver.ts (7 шагов):
  1. Подготовка данных: граф, атмосферные узлы → GND.
  2. Инициализация Q^(0) от рабочей точки вентилятора.
  3. Формирование независимых контуров (BFS-дерево + хорды).
  4. Итерационный процесс МКР (формула Кросса).
  5. Пересчёт Q ветвей дерева по 1-му закону Кирхгофа (bottom-up).
  6. Определение тупиков (итеративное удаление листьев).
  7. Специальная обработка ВМП в тупиках.

POST: {nodes, branches, options:{tolerance, maxIter}}
"""
import json, math, collections

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

GND = "__GND__"
EPS1 = 0.1   # Па — критерий ΔH
EPS2 = 0.01  # м³/с — критерий ΔQ
MIN_R = 1e-9


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения горных выработок (МКР)."""
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
# ВЕНТИЛЯТОР
# ══════════════════════════════════════════════════════════════════════

def fan_H(e, Q):
    """Напор вентилятора H(|Q|) в Па. Нагнетает в направлении a→b."""
    if not e.get("hasFan"):
        return 0.0
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        Qa = abs(Q)
        if Qa > float(e.get("qMax", 1e9)):
            return 0.0
        h0 = float(e.get("h0", 0))
        h1 = float(e.get("h1", 0))
        h2 = float(e.get("h2", 0))
        return max(0.0, h0 + h1 * Qa + h2 * Qa * Qa)
    return max(0.0, float(e.get("fanPressure", 0)))


def fan_dH(e, Q):
    """|dH/dQ| для уточнения знаменателя δQ."""
    if not e.get("hasFan"):
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        Qa = abs(Q)
        return abs(float(e.get("h1", 0)) + 2.0 * float(e.get("h2", 0)) * Qa)
    return 0.0


def estimate_q0(edges, R_total):
    """Оценка рабочей точки бисекцией: H_вент(Q) = R_total·Q²."""
    fan = next((e for e in edges if e["hasFan"]), None)
    if not fan:
        return 5.0

    if fan.get("fanMode", "constant") == "constant":
        H0 = fan_H(fan, 0)
        if H0 > 0 and R_total > 0:
            return math.sqrt(H0 / R_total)
        return 5.0

    # curve
    q_hi = float(fan.get("qMax", 90.0))
    if R_total <= 0:
        return (float(fan.get("qMin", 1.0)) + q_hi) / 2.0

    lo, hi = 0.0, q_hi
    for _ in range(80):
        q = (lo + hi) / 2.0
        Hf = fan_H(fan, q)
        Hn = R_total * q * q
        if abs(Hf - Hn) < 0.05:
            return max(0.1, q)
        if Hf > Hn:
            lo = q
        else:
            hi = q
    return max(0.1, (lo + hi) / 2.0)


# ══════════════════════════════════════════════════════════════════════
# ПУТЬ МЕЖДУ УЗЛАМИ ПО ДЕРЕВУ (через LCA)
# Идентично treePath() в networkSolver.ts
# ══════════════════════════════════════════════════════════════════════

def tree_path(from_node, to_node, edges, parent):
    """
    Возвращает [(edge_idx, dir), ...] — путь from_node → to_node по дереву.
    dir = +1 если обход идёт в направлении a→b ребра, -1 иначе.
    parent: dict node → {node: str, edge_idx: int} | None
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

    # LCA
    lca = ancs_to[0]
    idx_to = 0
    for i, n in enumerate(ancs_to):
        if n in set_from:
            lca = n
            idx_to = i
            break
    idx_from = set_from.get(lca, 0)

    result = []

    # from → LCA (движемся вверх: node → parent)
    for i in range(idx_from):
        node = ancs_from[i]
        p    = parent[node]
        e    = edges[p["edge_idx"]]
        # Движение: node → p["node"]
        # Ребро a→b: если e["a"] == node → движение a→b → dir=+1
        #            если e["b"] == node → движение b→a → dir=-1
        result.append((p["edge_idx"], 1 if e["a"] == node else -1))

    # LCA → to (движемся вниз: p["node"] → child)
    for i in range(idx_to - 1, -1, -1):
        child = ancs_to[i]
        p     = parent[child]
        e     = edges[p["edge_idx"]]
        # Движение: p["node"] → child
        # Если e["a"] == p["node"] → движение a→b → dir=+1
        result.append((p["edge_idx"], 1 if e["a"] == p["node"] else -1))

    return result


# ══════════════════════════════════════════════════════════════════════
# ТУПИКОВЫЕ ВЕТВИ (итеративное удаление листьев)
# ══════════════════════════════════════════════════════════════════════

def find_dead_ends(edges):
    """
    Итеративно удаляет листья (degree=1, без вентилятора).
    Возвращает set id мёртвых ветвей.
    """
    adj       = collections.defaultdict(set)
    edge_by_id = {}
    for e in edges:
        adj[e["a"]].add(e["id"])
        adj[e["b"]].add(e["id"])
        edge_by_id[e["id"]] = e

    alive   = {e["id"] for e in edges}
    dead    = set()
    changed = True

    while changed:
        changed = False
        degree  = collections.defaultdict(int)
        for eid in alive:
            e = edge_by_id[eid]
            if e["a"] != GND: degree[e["a"]] += 1
            if e["b"] != GND: degree[e["b"]] += 1

        fan_nodes = set()
        for eid in alive:
            e = edge_by_id[eid]
            if e["hasFan"]:
                fan_nodes.add(e["a"])
                fan_nodes.add(e["b"])

        to_kill = set()
        for eid in alive:
            e = edge_by_id[eid]
            if e["hasFan"]:
                continue
            a_leaf = (e["a"] != GND and degree[e["a"]] == 1 and e["a"] not in fan_nodes)
            b_leaf = (e["b"] != GND and degree[e["b"]] == 1 and e["b"] not in fan_nodes)
            if a_leaf or b_leaf:
                to_kill.add(eid)

        if to_kill:
            alive  -= to_kill
            dead   |= to_kill
            changed = True

    return dead


# ══════════════════════════════════════════════════════════════════════
# ГЛАВНЫЙ РЕШАТЕЛЬ
# ══════════════════════════════════════════════════════════════════════

def solve(nodes_in, branches_in, options):
    eps2     = float(options.get("tolerance", EPS2))
    eps1     = float(options.get("tolPressure", EPS1))
    max_iter = int(options.get("maxIter", 2000))

    log  = []
    diag = []

    # ── ШАГ 1. Подготовка данных ──────────────────────────────────────
    atm = set()
    for n in nodes_in:
        if n.get("isAtm") or n.get("atmosphereLink"):
            atm.add(n["id"])
    if not atm:
        for n in nodes_in:
            nid = str(n.get("id", "")).lower()
            if any(x in nid for x in ("атм", "atm", "gnd", "surface")):
                atm.add(n["id"])

    if not atm:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов"})

    def to_gnd(nid):
        return GND if nid in atm else nid

    edges = []
    for b in branches_in:
        edges.append({
            "id":          b["id"],
            "a":           to_gnd(b["fromId"]),
            "b":           to_gnd(b["toId"]),
            "R":           max(MIN_R, float(b.get("R") or b.get("resistance") or 0)),
            "Q":           0.0,
            "hasFan":      bool(b.get("hasFan")),
            "fanMode":     b.get("fanMode", "constant"),
            "fanPressure": float(b.get("fanPressure", 0)),
            "h0":          float(b.get("h0", 0)),
            "h1":          float(b.get("h1", 0)),
            "h2":          float(b.get("h2", 0)),
            "qMin":        float(b.get("qMin", 1.0)),
            "qMax":        float(b.get("qMax", 1e9)),
            "area":        float(b.get("area", 0)),
        })

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой"})
        return make_result(edges, 0, True, 0.0, log, diag)

    # ── ШАГ 3 (BFS-дерево) + ШАГ 4 (контуры) ────────────────────────

    # Все узлы
    node_set = set()
    for e in edges:
        node_set.add(e["a"])
        node_set.add(e["b"])
    node_list = list(node_set)

    # Список смежности
    adj = collections.defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append({"edge_idx": i, "other": e["b"]})
        adj[e["b"]].append({"edge_idx": i, "other": e["a"]})

    root = GND if GND in node_set else node_list[0]

    # BFS от root → строим дерево
    parent    = {root: None}   # node → {"node": str, "edge_idx": int} | None
    visited   = {root}
    tree_set  = set()           # set of edge indices в дереве
    bfs_order = []
    queue     = collections.deque([root])

    while queue:
        u = queue.popleft()
        bfs_order.append(u)
        for nb in adj[u]:
            if nb["other"] not in visited:
                visited.add(nb["other"])
                parent[nb["other"]] = {"node": u, "edge_idx": nb["edge_idx"]}
                tree_set.add(nb["edge_idx"])
                queue.append(nb["other"])

    # Хорды = ребра не в дереве
    chords = [i for i in range(len(edges)) if i not in tree_set]

    log.append(f"Узлов={len(node_list)} ветвей={len(edges)} контуров={len(chords)}")

    # Контуры: хорда (dir=+1) + путь в дереве от e.b → e.a
    contours = []
    for ci in chords:
        e    = edges[ci]
        path = tree_path(e["b"], e["a"], edges, parent)
        contours.append([(ci, 1)] + path)

    # ── ШАГ 2. Инициализация Q^(0) ───────────────────────────────────
    # R только дерева для оценки рабочей точки
    R_tree = sum(edges[i]["R"] for i in tree_set)
    Q0     = max(0.1, estimate_q0(edges, R_tree))
    log.append(f"Q₀={Q0:.2f} м³/с")

    # BFS-позиция для определения направления
    bfs_pos = {n: i for i, n in enumerate(bfs_order)}

    for i, e in enumerate(edges):
        if i not in tree_set:
            e["Q"] = Q0          # хорда — всегда положительно a→b
        else:
            # Ветвь дерева: Q>0 если b дальше от корня (posB > posA)
            posA = bfs_pos.get(e["a"], 10**9)
            posB = bfs_pos.get(e["b"], 10**9)
            e["Q"] = Q0 if posB > posA else -Q0

    # ── ШАГ 5. Итерационный процесс МКР ──────────────────────────────
    max_dQ = math.inf
    max_dH = math.inf
    it     = 0

    for it in range(1, max_iter + 1):
        max_dQ = 0.0
        max_dH = 0.0

        for contour in contours:
            num = 0.0
            den = 0.0

            for ei, dir_ in contour:
                e  = edges[ei]
                Qd = e["Q"] * dir_               # расход в направлении обхода
                H  = fan_H(e, e["Q"])            # напор вентилятора (≥0, в a→b)

                num += e["R"] * Qd * abs(Qd)
                # Вклад вентилятора:
                # dir=+1: обход совпадает с a→b → вентилятор помогает → вычитаем H
                # dir=-1: против a→b → вентилятор мешает → прибавляем H
                # Итого: num -= H * dir_
                num -= H * dir_

                den += 2.0 * e["R"] * abs(Qd) + fan_dH(e, e["Q"])

            if den < 1e-12:
                continue

            dQ = -num / den

            if abs(num) > max_dH: max_dH = abs(num)
            if abs(dQ)  > max_dQ: max_dQ = abs(dQ)

            for ei, dir_ in contour:
                edges[ei]["Q"] += dQ * dir_

        # Защита от NaN
        for e in edges:
            if not math.isfinite(e["Q"]):
                e["Q"] = 0.0

        # Критерий остановки (идентично TS: ИЛИ по ΔH ИЛИ по ΔQ)
        if max_dH < eps1 or max_dQ < eps2:
            it += 1
            break

    converged = max_dH < eps1 or max_dQ < eps2
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. ΔQ={max_dQ:.4f} м³/с, ΔH={max_dH:.2f} Па"})

    log.append(f"Итераций={it} max|ΔH|={max_dH:.3f} Па max|δQ|={max_dQ:.4f} м³/с")

    # ── ПЕРЕСЧЁТ Q ВЕТВЕЙ ДЕРЕВА по 1-му закону Кирхгофа (bottom-up) ─
    # Идентично блоку lines 498-550 в networkSolver.ts

    # Балансы узлов только от хорд
    balance = collections.defaultdict(float)
    for i, e in enumerate(edges):
        if i in tree_set:
            continue   # ветви дерева будут пересчитаны
        balance[e["a"]] -= e["Q"]   # отток из a
        balance[e["b"]] += e["Q"]   # приток в b

    # Обход снизу вверх (от листьев к корню)
    for idx in range(len(bfs_order) - 1, 0, -1):
        v = bfs_order[idx]
        p = parent.get(v)
        if not p:
            continue

        e     = edges[p["edge_idx"]]
        pNode = p["node"]
        bal   = balance[v]

        # Нужно balance[v] = 0: Q_ребра_к_v = −bal
        # Ребро e ориентировано a→b:
        #   e["b"] == v: Q > 0 = приток в v. Нужен приток = −bal → e.Q = −bal
        #   e["a"] == v: Q > 0 = отток из v. Нужен отток = bal → e.Q = bal
        if e["b"] == v:
            e["Q"] = -bal
            balance[pNode] -= e["Q"]   # отток из pNode (e["a"] = pNode)
        else:
            e["Q"] = bal
            balance[pNode] += e["Q"]   # приток в pNode (e["b"] = pNode)

    return make_result(edges, it, converged, max_dQ, log, diag)


# ══════════════════════════════════════════════════════════════════════
# ФОРМИРОВАНИЕ РЕЗУЛЬТАТА
# ══════════════════════════════════════════════════════════════════════

def make_result(edges, it, converged, max_res, log, diag):
    dead_ends = find_dead_ends(edges)
    out = []

    for e in edges:
        is_dead = e["id"] in dead_ends
        q = 0.0 if is_dead else e["Q"]

        # ВМП в тупике: вентилятор в разомкнутой ветви → бисекция рабочей точки
        if not is_dead and e["hasFan"] and abs(q) < 1e-6:
            R = e["R"]
            if R > 0:
                q_lo = float(e.get("qMin", 1.0))
                q_hi = float(e.get("qMax", 90.0))

                def f_local(qv, _e=e):
                    return fan_H(_e, qv) - _e["R"] * qv * qv

                if f_local(q_lo) > 0 and f_local(q_hi) < 0:
                    for _ in range(60):
                        q_mid = 0.5 * (q_lo + q_hi)
                        if f_local(q_mid) > 0:
                            q_lo = q_mid
                        else:
                            q_hi = q_mid
                        if q_hi - q_lo < 0.01:
                            break
                    q = 0.5 * (q_lo + q_hi)
                elif f_local(q_lo) <= 0:
                    q = q_lo
                else:
                    q = q_hi

        H    = e["R"] * q * abs(q)
        Hv   = fan_H(e, abs(q))
        area = e.get("area", 0.0)
        vel  = abs(q) / area if area > 0.01 else 0.0

        out.append({
            "id":       e["id"],
            "Q":        round(q, 4),
            "H":        round(H, 3),
            "Hfan":     round(Hv, 3),
            "velocity": round(vel, 3),
            "isDead":   is_dead,
        })

    return {
        "branches":    out,
        "nodes":       [],
        "iterations":  it,
        "converged":   converged,
        "maxResidual": round(max_res, 6),
        "log":         log,
        "diagnostics": diag,
    }


def empty_result(msg):
    return {
        "branches": [], "nodes": [], "iterations": 0, "converged": True,
        "maxResidual": 0.0, "log": [msg],
        "diagnostics": [{"level": "warning", "category": "topology", "message": msg}],
    }


def ok(data):
    return {"statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(data, ensure_ascii=False)}


def err(code, msg):
    return {"statusCode": code,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": msg}, ensure_ascii=False)}