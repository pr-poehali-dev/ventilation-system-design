"""
Расчёт воздухораспределения — Метод Кросса (Андрияшева–Кросса).

Ключевые решения:
1. Все атмосферные узлы объединяются в один виртуальный узел GND.
   Это гарантирует связность графа и единый корень дерева.
2. BFS строит дерево от GND — ровно один корень.
3. Хорды дают независимые контуры.
4. Начальные Q: все ветви дерева получают Q0 от корня к листу.
   Хорды получают Q0 (в направлении a→b).
   Нарушение баланса в начале допустимо — метод Кросса итерациями
   устраняет небаланс через контуры (каждая ветвь входит хотя бы
   в один контур благодаря GND-объединению).
5. Поправка Кросса: ΔQ_k = −ΔH_k / (2·Σ R_i·|Q_i|).
"""
import json, math, collections

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

GND = "__GND__"   # виртуальный атмосферный узел


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения горных выработок методом Кросса."""
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
# УТИЛИТЫ
# ══════════════════════════════════════════════════════════════════════

def get_R(b):
    r = float(b.get("R") or b.get("resistance") or 0.0)
    return max(r, 1e-9)


def fan_H(e, Q):
    if not e.get("hasFan"):
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        qa = abs(Q)
        if qa > float(e.get("qMax", 1e9)):
            return 0.0
        h0 = float(e.get("h0", 0))
        h1 = float(e.get("h1", 0))
        h2 = float(e.get("h2", 0))
        return max(0.0, h0 + h1 * qa + h2 * qa * qa)
    return float(e.get("fanPressure", 0))


def fan_dH(e, Q):
    """|dH/dQ| для знаменателя Кросса (только curve)."""
    if not e.get("hasFan") or e.get("fanMode", "constant") != "curve":
        return 0.0
    h1 = float(e.get("h1", 0))
    h2 = float(e.get("h2", 0))
    return abs(h1 + 2 * h2 * abs(Q))


def estimate_Q0(edges):
    """Рабочая точка вентилятора: H(Q0) = R_net·Q0²."""
    fans    = [e for e in edges if e.get("hasFan")]
    passive = [e for e in edges if not e.get("hasFan")]
    if not fans:
        return 10.0
    fe    = fans[0]
    R_net = sum(e["R"] for e in passive) or fe["R"]
    R_net = max(R_net, 1e-9)
    H0    = fan_H(fe, 0.0)
    if H0 <= 0:
        H0 = float(fe.get("fanPressure", 0)) or 100.0
    # Бисекция: H_fan(Q) = R_net·Q²
    lo, hi = 0.0, float(fe.get("qMax", 500))
    for _ in range(80):
        qm = (lo + hi) / 2.0
        if fan_H(fe, qm) > R_net * qm * qm:
            lo = qm
        else:
            hi = qm
    Q0 = max(0.1, (lo + hi) / 2.0)
    return Q0


# ══════════════════════════════════════════════════════════════════════
# ШАГ 1: ГРАФ С GND-ОБЪЕДИНЕНИЕМ
#
# Все атмосферные узлы заменяются на GND.
# Это превращает "несколько входов/выходов на поверхность" в один узел.
# Граф становится гарантированно связным с единым корнем GND.
# ══════════════════════════════════════════════════════════════════════

def build_graph(nodes_in, branches_in):
    """Строит граф с GND-объединением. Возвращает (edges, adj, atm_orig)."""
    atm_orig = set()
    for n in nodes_in:
        if n.get("isAtm") or n.get("atmosphereLink"):
            atm_orig.add(n["id"])
    if not atm_orig:
        for n in nodes_in:
            nid = str(n.get("id", "")).lower()
            if any(x in nid for x in ("атм", "atm", "gnd", "surface")):
                atm_orig.add(n["id"])

    def to_gnd(node_id):
        return GND if node_id in atm_orig else node_id

    edges = []
    for b in branches_in:
        a = to_gnd(b["fromId"])
        bv = to_gnd(b["toId"])
        edges.append({
            "id":          b["id"],
            "a":           a,
            "b":           bv,
            "orig_a":      b["fromId"],
            "orig_b":      b["toId"],
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

    adj = collections.defaultdict(list)
    for e in edges:
        adj[e["a"]].append(e)
        adj[e["b"]].append(e)

    return edges, adj, atm_orig


# ══════════════════════════════════════════════════════════════════════
# ШАГ 2: ОСТОВНОЕ ДЕРЕВО (BFS от GND) + КОНТУРЫ
# ══════════════════════════════════════════════════════════════════════

def build_tree_and_loops(edges, adj):
    """
    BFS от GND строит остовное дерево.
    Хорды → контуры через LCA.

    Возвращает (tree_ids, bfs_depth, parent_map, loops).

    parent_map[v] = (edge_id, parent_node)
    bfs_depth[v]  = глубина в BFS-дереве (GND=0)
    loops: [[(edge_id, sign), ...]]
      sign=+1: Q_edge вклад в контур по направлению a→b
      sign=-1: против
    """
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    # BFS от GND (или первого узла если GND нет)
    root = GND if GND in all_nodes else next(iter(all_nodes))

    visited   = {root}
    parent_map = {}      # v → (eid, par)
    bfs_depth  = {root: 0}
    tree_ids   = set()
    queue      = collections.deque([root])

    while queue:
        v = queue.popleft()
        for e in adj[v]:
            u = e["b"] if e["a"] == v else e["a"]
            if u not in visited:
                visited.add(u)
                parent_map[u] = (e["id"], v)
                bfs_depth[u]  = bfs_depth[v] + 1
                tree_ids.add(e["id"])
                queue.append(u)

    # Несвязные компоненты (не должно быть при GND, но на всякий случай)
    for node in all_nodes:
        if node not in visited:
            visited.add(node)
            parent_map[node] = (None, None)
            bfs_depth[node]  = 999
            queue = collections.deque([node])
            while queue:
                v = queue.popleft()
                for e in adj[v]:
                    u = e["b"] if e["a"] == v else e["a"]
                    if u not in visited:
                        visited.add(u)
                        parent_map[u] = (e["id"], v)
                        bfs_depth[u]  = bfs_depth[v] + 1
                        tree_ids.add(e["id"])
                        queue.append(u)

    # LCA и пути
    def ancestors(node):
        """Список предков от node до корня."""
        chain = []
        cur = node
        while cur in parent_map:
            chain.append(cur)
            _, par = parent_map[cur]
            if par is None:
                break
            cur = par
        chain.append(cur)  # корень
        return chain

    def path_sign(node, target_ancestor, edges_map):
        """
        Путь node → target_ancestor по дереву.
        Возвращает [(eid, sign)].
        sign=+1 если движение node→parent совпадает с направлением ребра a→b.
        """
        result = []
        cur = node
        while cur != target_ancestor:
            eid, par = parent_map[cur]
            if eid is None:
                break
            e = edges_map[eid]
            # Движение cur → par
            # Если e["a"]==cur: ребро cur→par, движение совпадает → sign=+1
            # Если e["b"]==cur: ребро par→cur, движение против → sign=-1
            sign = +1 if e["a"] == cur else -1
            result.append((eid, sign))
            cur = par
        return result

    edges_map = {e["id"]: e for e in edges}
    chords = [e for e in edges if e["id"] not in tree_ids]
    loops  = []

    for chord in chords:
        u, v = chord["a"], chord["b"]

        # LCA
        anc_u = ancestors(u)
        anc_u_set = {n: i for i, n in enumerate(anc_u)}
        anc_v = ancestors(v)
        lca = None
        for node in anc_v:
            if node in anc_u_set:
                lca = node
                break
        if lca is None:
            continue

        # Контур: u →(хорда)→ v →(дерево)→ LCA →(дерево)→ u
        # Хорда u→v: chord["a"]=u, chord["b"]=v → движение по ребру → sign=+1
        loop = [(chord["id"], +1)]

        # v → LCA
        path_v = path_sign(v, lca, edges_map)
        loop.extend(path_v)

        # LCA → u = обратный путь u→LCA с инвертированными знаками
        path_u = path_sign(u, lca, edges_map)
        for eid, sgn in reversed(path_u):
            loop.append((eid, -sgn))

        if len(loop) >= 2:
            loops.append(loop)

    return tree_ids, bfs_depth, parent_map, loops


# ══════════════════════════════════════════════════════════════════════
# ШАГ 3: НАЧАЛЬНЫЕ Q
#
# Все ветви дерева: Q0 в направлении от корня (GND) к листу.
#   Если bfs_depth[b] > bfs_depth[a]: ребро a→b идёт от корня → Q > 0
#   Иначе: ребро b→a идёт от корня → Q < 0
# Хорды: Q0 (в направлении a→b).
#
# Нарушение баланса в начале допустимо при условии что каждая ветвь
# входит хотя бы в один контур — тогда Кросс всё скорректирует.
# С GND-объединением это гарантировано.
# ══════════════════════════════════════════════════════════════════════

def initial_Q(edges, tree_ids, bfs_depth, Q0):
    Q = {}
    for e in edges:
        if e["id"] not in tree_ids:
            # Хорда
            Q[e["id"]] = Q0
        else:
            # Дерево: Q > 0 если ребро идёт от корня (глубина a < глубина b)
            da = bfs_depth.get(e["a"], 0)
            db = bfs_depth.get(e["b"], 0)
            Q[e["id"]] = Q0 if db > da else -Q0
    return Q


# ══════════════════════════════════════════════════════════════════════
# МЕТОД КРОССА
# ══════════════════════════════════════════════════════════════════════

def solve(nodes_in, branches_in, options):
    tol      = float(options.get("tolerance", 0.0001))
    max_iter = int(options.get("maxIter", 10000))
    alpha    = float(options.get("alpha", 0.8))

    log  = []
    diag = []

    edges, adj, atm_orig = build_graph(nodes_in, branches_in)

    if not atm_orig:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов — отметьте устья стволов как «Выход (атмосфера)»"})

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой"})

    tree_ids, bfs_depth, parent_map, loops = build_tree_and_loops(edges, adj)
    log.append(f"Ветвей={len(edges)} дерево={len(tree_ids)} контуров={len(loops)} "
               f"вент={len(fans)} атм={len(atm_orig)}")

    if not loops:
        diag.append({"level": "info", "category": "topology",
                     "message": "Контуры не найдены — линейная сеть"})
        Q = solve_linear(edges, fans, log)
        return make_result(edges, Q, 1, True, 0.0, log, diag, atm_orig)

    Q0 = estimate_Q0(edges)
    Q  = initial_Q(edges, tree_ids, bfs_depth, Q0)
    log.append(f"Q0={Q0:.2f} м³/с")

    # DEBUG: начальные Q и контуры
    for e in edges:
        log.append(f"Q0[{e['id']}]={Q[e['id']]:.1f} a={e['a']} b={e['b']} "
                   f"da={bfs_depth.get(e['a'],9)} db={bfs_depth.get(e['b'],9)} "
                   f"tree={'Y' if e['id'] in tree_ids else 'N'}")
    for i, loop in enumerate(loops):
        log.append(f"loop{i}: {[(eid,s) for eid,s in loop]}")

    edge_by_id = {e["id"]: e for e in edges}
    max_dH = float("inf")
    it = 0

    for it in range(1, max_iter + 1):
        max_dH = 0.0

        for loop in loops:
            dH    = 0.0
            denom = 0.0

            for eid, sgn in loop:
                e  = edge_by_id[eid]
                q  = Q[eid]
                qd = q * sgn          # расход в направлении обхода контура
                Hv = fan_H(e, q)

                dH    += e["R"] * qd * abs(qd) - Hv * sgn
                denom += 2.0 * e["R"] * abs(qd) + fan_dH(e, q)

            max_dH = max(max_dH, abs(dH))

            if denom < 1e-12:
                # Все Q=0 — оцениваем первый шаг
                Hv_max = max((fan_H(edge_by_id[eid], 0.0) for eid, _ in loop), default=0.0)
                R_avg  = sum(edge_by_id[eid]["R"] for eid, _ in loop) / max(len(loop), 1)
                if Hv_max > 0 and R_avg > 0:
                    denom = 2.0 * R_avg * math.sqrt(Hv_max / R_avg) * max(len(loop), 1)
                else:
                    continue

            dQ = -alpha * dH / denom
            for eid, sgn in loop:
                Q[eid] += sgn * dQ

        if max_dH < tol:
            it += 1
            break

    converged = max_dH < tol
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. |ΔH|={max_dH:.4f} Па"})

    # Проверка 1-го закона (дисбаланс узлов)
    node_bal = {}
    for e in edges:
        q = Q[e["id"]]
        node_bal[e["a"]] = node_bal.get(e["a"], 0.0) - q
        node_bal[e["b"]] = node_bal.get(e["b"], 0.0) + q

    max_imb = max((abs(v) for k, v in node_bal.items() if k != GND), default=0.0)
    log.append(f"Итераций={it} max|ΔH|={max_dH:.4f} дисбаланс={max_imb:.4f}")

    if max_imb > 0.5:
        diag.append({"level": "error", "category": "balance",
                     "message": f"Дисбаланс {max_imb:.2f} м³/с — нарушение 1-го закона Кирхгофа"})

    return make_result(edges, Q, it, converged, max_dH, log, diag, atm_orig)


# ══════════════════════════════════════════════════════════════════════
# ЛИНЕЙНАЯ СЕТЬ
# ══════════════════════════════════════════════════════════════════════

def solve_linear(edges, fans, log):
    Q = {e["id"]: 0.0 for e in edges}
    if not fans:
        return Q
    fe    = fans[0]
    R_net = max(sum(e["R"] for e in edges if not e["hasFan"]), fe["R"], 1e-9)
    lo, hi = 0.0, float(fe.get("qMax", 500))
    for _ in range(200):
        qm = (lo + hi) / 2.0
        if fan_H(fe, qm) > R_net * qm * qm:
            lo = qm
        else:
            hi = qm
    Qwp = max(0.1, (lo + hi) / 2.0)
    log.append(f"Линейная: Q_wp={Qwp:.2f} м³/с")
    for e in edges:
        Q[e["id"]] = Qwp
    return Q


# ══════════════════════════════════════════════════════════════════════
# РЕЗУЛЬТАТ
# ══════════════════════════════════════════════════════════════════════

def make_result(edges, Q, it, converged, max_dH, log, diag, atm_orig=None):
    branches_out = []
    for e in edges:
        q    = Q.get(e["id"], 0.0)
        H    = e["R"] * q * abs(q)
        Hv   = fan_H(e, q)
        area = e.get("area", 0.0)
        vel  = abs(q) / area if area > 0.01 else 0.0
        branches_out.append({
            "id":       e["id"],
            "Q":        round(q, 4),
            "H":        round(H, 3),
            "Hfan":     round(Hv, 3),
            "velocity": round(vel, 3),
        })
    return {
        "branches":    branches_out,
        "nodes":       [],
        "iterations":  it,
        "converged":   converged,
        "maxResidual": round(max_dH, 6),
        "log":         log,
        "diagnostics": diag,
    }


def empty_result(msg):
    return {
        "branches": [], "nodes": [], "iterations": 0,
        "converged": True, "maxResidual": 0.0,
        "log": [msg],
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