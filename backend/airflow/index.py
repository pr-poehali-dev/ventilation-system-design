"""
Расчёт воздухораспределения — Метод Кросса (Андрияшева–Кросса).

КЛЮЧЕВОЕ СВОЙСТВО метода Кросса:
  Если начальные Q удовлетворяют 1-му закону Кирхгофа,
  то поправки ΔQ по контурам сохраняют этот баланс на каждой итерации.

  Правильные начальные Q по дереву:
  - Хорды = 0 (не нарушают баланс)
  - Ветви дерева — BFS снизу вверх: Q_ребра = сумма Q всех потомков

  Контуры: хорда + путь по дереву через LCA.
  Знаки: единый обход контура, ребро +1 если Q в направлении обхода.

POST: {nodes, branches, options}
GET:  {branches:[{id,Q,H,Hfan,velocity}], iterations, converged, maxResidual, log, diagnostics}
"""
import json, math, collections

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


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
    """Напор вентилятора при расходе Q."""
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


# ══════════════════════════════════════════════════════════════════════
# ГРАФ
# ══════════════════════════════════════════════════════════════════════

def parse_graph(nodes_in, branches_in):
    """Возвращает (atm, edges, adj)."""
    atm = set()
    for n in nodes_in:
        if n.get("isAtm") or n.get("atmosphereLink"):
            atm.add(n["id"])
    if not atm:
        for n in nodes_in:
            nid = str(n.get("id", "")).lower()
            if any(x in nid for x in ("атм", "atm", "gnd", "surface")):
                atm.add(n["id"])

    edges = []
    for b in branches_in:
        edges.append({
            "id":  b["id"],
            "a":   b["fromId"],   # a = fromId
            "b":   b["toId"],     # b = toId
            "R":   get_R(b),
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

    return atm, edges, adj


# ══════════════════════════════════════════════════════════════════════
# ОСТОВНОЕ ДЕРЕВО + КОНТУРЫ
#
# BFS от атмосферных (корневых) узлов.
# parent[v] = (edge, parent_node)
# tree_dir[edge_id] = +1 если ребро ориентировано от корня (a=parent, b=v)
#                   = -1 если ребро ориентировано к корню (a=v, b=parent)
#
# Контур для хорды (u,v):
#   Обход: u --хорда--> v --> ... --> LCA --> ... --> u
#   sign ребра в контуре: +1 если обход идёт в направлении a→b, -1 иначе
# ══════════════════════════════════════════════════════════════════════

def build_loops(edges, adj, atm):
    """
    Возвращает (tree_ids, parent_map, loops).

    parent_map[v] = (edge_id, parent_node)
    loops = [[(edge_id, sign), ...]]
      sign: +1 если в контуре движемся по ребру a→b
            -1 если против
    """
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    visited    = set()
    parent_map = {}          # v → (eid, parent_v)
    # dir_to_v[eid] = True если ребро ориентировано parent→v (a=parent, b=v)
    dir_to_v   = {}
    tree_ids   = set()

    # BFS: стартуем с атмосферных узлов (= корни)
    queue = collections.deque()
    for r in (atm if atm else list(all_nodes)[:1]):
        if r not in visited:
            visited.add(r)
            queue.append(r)

    while queue:
        v = queue.popleft()
        for e in adj[v]:
            u = e["b"] if e["a"] == v else e["a"]
            if u not in visited:
                visited.add(u)
                parent_map[u] = (e["id"], v)
                dir_to_v[e["id"]] = (e["a"] == v)  # True: a=v(parent), b=u
                tree_ids.add(e["id"])
                queue.append(u)

    # Несвязные компоненты
    for start in all_nodes:
        if start not in visited:
            visited.add(start)
            queue.append(start)
            while queue:
                v = queue.popleft()
                for e in adj[v]:
                    u = e["b"] if e["a"] == v else e["a"]
                    if u not in visited:
                        visited.add(u)
                        parent_map[u] = (e["id"], v)
                        dir_to_v[e["id"]] = (e["a"] == v)
                        tree_ids.add(e["id"])
                        queue.append(u)

    edge_by_id = {e["id"]: e for e in edges}

    def path_to_root(node):
        """
        Путь от node до корня компоненты.
        Возвращает [(eid, sign), ...] где sign — направление движения к корню:
          +1 если идём по ребру (a→b), т.е. движемся к b=parent
          -1 если против ребра (b→a), т.е. движемся к a=parent
        """
        path = []
        cur  = node
        while cur in parent_map:
            eid, par = parent_map[cur]
            # dir_to_v[eid]=True означает ребро par→cur (a=par, b=cur)
            # Мы движемся cur→par = против ребра = sign=-1
            # dir_to_v[eid]=False означает ребро cur→par (a=cur, b=par)
            # Мы движемся cur→par = по ребру = sign=+1
            sign = -1 if dir_to_v[eid] else +1
            path.append((eid, sign))
            cur = par
        return path

    def get_ancestors(node):
        """Множество всех предков node включая сам node."""
        anc = set()
        cur = node
        while True:
            anc.add(cur)
            if cur not in parent_map:
                break
            _, par = parent_map[cur]
            cur = par
        return anc

    # Контуры
    chords = [e for e in edges if e["id"] not in tree_ids]
    loops  = []

    for chord in chords:
        u, v = chord["a"], chord["b"]

        # Находим LCA
        anc_u = get_ancestors(u)
        cur = v
        path_v_to_lca = []
        while cur not in anc_u:
            if cur not in parent_map:
                break
            eid, par = parent_map[cur]
            sign = -1 if dir_to_v[eid] else +1
            path_v_to_lca.append((eid, sign))
            cur = par
        lca = cur

        # Путь u → LCA
        path_u_to_lca = []
        cur = u
        while cur != lca:
            if cur not in parent_map:
                break
            eid, par = parent_map[cur]
            sign = -1 if dir_to_v[eid] else +1
            path_u_to_lca.append((eid, sign))
            cur = par

        # Контур: u →(хорда u→v)→ v →(дерево к LCA)→ LCA →(дерево к u, обратно)→ u
        # Хорда: chord["a"]=u, chord["b"]=v, движемся u→v = по ребру a→b = sign=+1
        loop = [(chord["id"], +1)]

        # v → LCA (по дереву вверх)
        loop.extend(path_v_to_lca)

        # LCA → u = обратный путь от u к LCA (инвертируем знаки)
        for eid, sgn in reversed(path_u_to_lca):
            loop.append((eid, -sgn))

        if len(loop) >= 2:
            loops.append(loop)

    return tree_ids, parent_map, dir_to_v, loops


# ══════════════════════════════════════════════════════════════════════
# НАЧАЛЬНЫЕ Q — 1-й ЗАКОН КИРХГОФА
#
# Алгоритм:
# 1. Хорды = 0 (не нарушают баланс).
# 2. Оцениваем Q0 из рабочей точки вентилятора.
# 3. BFS снизу-вверх по дереву (от листьев к корням):
#    - листья получают Q0 / кол-во_листьев
#    - каждый узел передаёт сумму потомков родителю
# Гарантия: Σ_входящих = Σ_исходящих в каждом внутреннем узле.
# ══════════════════════════════════════════════════════════════════════

def compute_initial_Q(edges, atm, tree_ids, parent_map, dir_to_v):
    """
    Начальные Q строго по 1-му закону Кирхгофа.

    Алгоритм:
    1. Находим источник давления (вентилятор или первый атмосферный узел).
    2. BFS от источника по дереву — строим поток от корня к листьям.
    3. В каждом узле Q_ребра_к_родителю = сумма Q всех дочерних рёбер.
       (снизу вверх, постордерный обход)
    4. Хорды = 0.

    Ключевое: используем subtree_size — кол-во листьев под каждым узлом.
    Q_ребра = Q0 * (subtree_size[v] / total_leaves)
    Это гарантирует баланс в каждом узле.
    """
    fans    = [e for e in edges if e["hasFan"]]
    passive = [e for e in edges if not e["hasFan"]]

    # Оценка Q0 из рабочей точки вентилятора
    Q0 = 10.0
    if fans:
        fe    = fans[0]
        H0    = fan_H(fe, 1.0) or float(fe.get("fanPressure", 100))
        R_net = sum(e["R"] for e in passive) or fe["R"]
        R_net = max(R_net, 1e-9)
        if H0 > 0:
            Q0 = math.sqrt(H0 / R_net)
        Q0 = max(1.0, min(Q0, float(fe.get("qMax", 500))))

    Q = {e["id"]: 0.0 for e in edges}

    # Строим дерево детей
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    children = collections.defaultdict(list)
    for v, (eid, par) in parent_map.items():
        children[par].append(v)

    # Считаем subtree_size[v] = кол-во листьев в поддереве v
    # Лист = узел без детей в дереве
    subtree_size = {}

    def calc_size(v):
        if not children[v]:
            subtree_size[v] = 1
            return 1
        s = sum(calc_size(c) for c in children[v])
        subtree_size[v] = s
        return s

    roots = [v for v in all_nodes if v not in parent_map]
    total_leaves = sum(calc_size(r) for r in roots)
    if total_leaves == 0:
        total_leaves = 1

    # Назначаем Q каждому ребру дерева:
    # Q_ребра(v) = Q0 * subtree_size[v] / total_leaves
    # Направление: от корня к листу (вниз по дереву)
    for v, (eid, par) in parent_map.items():
        flow = Q0 * subtree_size.get(v, 1) / total_leaves
        # dir_to_v[eid]=True  → ребро par→v (a=par, b=v)
        #   поток par→v = по ребру → Q > 0
        # dir_to_v[eid]=False → ребро v→par (a=v, b=par)
        #   поток par→v = против ребра → Q < 0
        Q[eid] = flow if dir_to_v[eid] else -flow

    return Q


# ══════════════════════════════════════════════════════════════════════
# ИТЕРАЦИИ КРОССА
# ══════════════════════════════════════════════════════════════════════

def solve(nodes_in, branches_in, options):
    tol      = float(options.get("tolerance", 0.0001))
    max_iter = int(options.get("maxIter", 10000))
    alpha    = float(options.get("alpha", 0.8))

    log  = []
    diag = []

    atm, edges, adj = parse_graph(nodes_in, branches_in)

    if not atm:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов — отметьте устья стволов как «Выход (атмосфера)»"})

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой"})

    tree_ids, parent_map, dir_to_v, loops = build_loops(edges, adj, atm)
    log.append(f"Ветвей={len(edges)} дерево={len(tree_ids)} хорд={len(loops)} вент={len(fans)} атм={len(atm)}")

    if not loops:
        diag.append({"level": "info", "category": "topology",
                     "message": "Контуры не найдены — линейная сеть"})
        Q = solve_linear(edges, fans, log)
        return make_result(edges, Q, 1, True, 0.0, log, diag, atm)

    # Начальные Q
    Q = compute_initial_Q(edges, atm, tree_ids, parent_map, dir_to_v)

    # Проверка баланса до итераций
    imb0 = max_imbalance(edges, Q, atm)
    log.append(f"Нач. дисбаланс={imb0:.4f} м³/с")

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
                Hv = fan_H(e, q)
                dH    += sgn * (e["R"] * q * abs(q) - Hv)
                denom += 2.0 * e["R"] * abs(q)

            max_dH = max(max_dH, abs(dH))

            if denom < 1e-12:
                R_avg  = sum(edge_by_id[eid]["R"] for eid, _ in loop) / max(len(loop), 1)
                Hv_max = max((fan_H(edge_by_id[eid], 0.0) for eid, _ in loop), default=0.0)
                if Hv_max > 0 and R_avg > 0:
                    q_est = math.sqrt(Hv_max / R_avg)
                    denom = 2.0 * R_avg * q_est * max(len(loop), 1)
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

    imb_final = max_imbalance(edges, Q, atm)
    log.append(f"Итераций={it} max|ΔH|={max_dH:.6f} дисбаланс={imb_final:.4f}")

    if imb_final > 1.0:
        diag.append({"level": "error", "category": "balance",
                     "message": f"Дисбаланс {imb_final:.2f} м³/с — нарушение 1-го закона Кирхгофа"})

    return make_result(edges, Q, it, converged, max_dH, log, diag, atm)


def max_imbalance(edges, Q, atm):
    """Максимальный дисбаланс в ненатмосферных узлах."""
    node_bal = {}
    for e in edges:
        q = Q[e["id"]]
        node_bal[e["a"]] = node_bal.get(e["a"], 0.0) - q
        node_bal[e["b"]] = node_bal.get(e["b"], 0.0) + q
    vals = [abs(v) for k, v in node_bal.items() if k not in atm]
    return max(vals) if vals else 0.0


# ══════════════════════════════════════════════════════════════════════
# ЛИНЕЙНАЯ СЕТЬ
# ══════════════════════════════════════════════════════════════════════

def solve_linear(edges, fans, log):
    Q = {e["id"]: 0.0 for e in edges}
    if not fans:
        return Q
    fe    = fans[0]
    R_net = sum(e["R"] for e in edges if not e["hasFan"]) or fe["R"]
    R_net = max(R_net, 1e-9)
    lo, hi = 0.0, float(fe.get("qMax", 500))
    for _ in range(200):
        qm = (lo + hi) / 2.0
        if abs(fan_H(fe, qm) - R_net * qm * qm) < 0.001:
            break
        if fan_H(fe, qm) > R_net * qm * qm:
            lo = qm
        else:
            hi = qm
    Qwp = (lo + hi) / 2.0
    log.append(f"Линейная: Q_wp={Qwp:.2f} м³/с")
    for e in edges:
        Q[e["id"]] = Qwp
    return Q


# ══════════════════════════════════════════════════════════════════════
# ОТВЕТ
# ══════════════════════════════════════════════════════════════════════

def make_result(edges, Q, it, converged, max_dH, log, diag, atm=None):
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