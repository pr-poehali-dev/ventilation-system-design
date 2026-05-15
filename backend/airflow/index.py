"""
Расчёт воздухораспределения — Метод Кросса (Андрияшева–Кросса).

Метод Кросса:
  Дано: граф сети, R каждой ветви, H_вент.
  Найти: Q_i — расходы в каждой ветви.

  Алгоритм:
  1. Выделяем независимые контуры (остовное дерево + хорды).
  2. Начальные Q: хорды = 0, дерево — балансировка снизу-вверх.
  3. Итерации по контурам:
       ΔH_k = Σ sign_i·(R_i·Q_i·|Q_i| − H_вент,i)
       ΔQ_k = −ΔH_k / (2·Σ R_i·|Q_i|)
       Q_i += sign_i · α · ΔQ_k
  4. Повторяем до max|ΔH_k| < ε.
"""
import json, math

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
        result = solve_cross(nodes_in, branches_in, options)
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
    """Напор вентилятора при расходе Q (>= 0 всегда)."""
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


def estimate_Q0(edges):
    """Оценка начального расхода по рабочей точке вентилятора."""
    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        return 10.0
    fe = fans[0]
    # H(Q0) = R_net * Q0^2  →  Q0 = sqrt(H0 / R_net)
    R_net = sum(e["R"] for e in edges if not e["hasFan"])
    R_net = max(R_net, fe["R"], 1e-9)
    H0 = fan_H(fe, 1.0)  # напор при малом Q
    if H0 <= 0:
        H0 = float(fe.get("fanPressure", 100))
    if H0 <= 0:
        return 10.0
    Q0 = math.sqrt(H0 / R_net)
    return max(1.0, min(Q0, float(fe.get("qMax", 500))))


# ══════════════════════════════════════════════════════════════════════
# ШАГ 1: ОСТОВНОЕ ДЕРЕВО → КОНТУРЫ
#
# BFS от атмосферных узлов (корни дерева).
# Хорды = рёбра не вошедшие в дерево.
# Каждая хорда (u,v) даёт контур: хорда + путь(v→LCA) + путь(LCA→u).
# ══════════════════════════════════════════════════════════════════════

def build_tree_and_loops(edges, atm):
    """
    Возвращает (tree_ids, parent, loops).
    parent[node] = (edge_id, parent_node, fwd)
      fwd=True  → ребро ориентировано parent→node (a→b)
      fwd=False → ребро ориентировано node→parent (a→b)
    loops = [[(edge_id, sign), ...], ...]
      sign=+1: Q_edge вклад в контур совпадает с ориентацией ребра
      sign=-1: против
    """
    if not edges:
        return set(), {}, []

    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    adj = {v: [] for v in all_nodes}
    for e in edges:
        adj[e["a"]].append(e)
        adj[e["b"]].append(e)

    # BFS — корни: атмосферные узлы (или все стартовые узлы)
    roots = [n for n in all_nodes if n in atm] or list(all_nodes)[:1]

    visited  = set()
    parent   = {}   # node → (eid, par_node, fwd)
    tree_ids = set()
    queue    = list(roots)
    for r in roots:
        visited.add(r)

    while queue:
        v = queue.pop(0)
        for e in adj[v]:
            u = e["b"] if e["a"] == v else e["a"]
            if u not in visited:
                visited.add(u)
                fwd = (e["a"] == v)   # True → ребро v→u совпадает с a→b
                parent[u] = (e["id"], v, fwd)
                tree_ids.add(e["id"])
                queue.append(u)

    # Для несвязных компонент — добавляем их узлы
    for node in all_nodes:
        if node not in visited:
            visited.add(node)
            queue = [node]
            while queue:
                v = queue.pop(0)
                for e in adj[v]:
                    u = e["b"] if e["a"] == v else e["a"]
                    if u not in visited:
                        visited.add(u)
                        fwd = (e["a"] == v)
                        parent[u] = (e["id"], v, fwd)
                        tree_ids.add(e["id"])
                        queue.append(u)

    edge_by_id = {e["id"]: e for e in edges}

    def path_up(node):
        """Путь от node до корня: [(eid, sign_движения_к_корню)]."""
        path = []
        cur = node
        while cur in parent:
            eid, par, fwd = parent[cur]
            # Движение cur → par (вверх по дереву)
            # fwd=True: ребро par→cur (a→b), движение против → sign=-1
            # fwd=False: ребро cur→par (a→b), движение по ребру → sign=+1
            path.append((eid, -1 if fwd else +1))
            cur = par
        return path, cur  # cur = корень компоненты

    def lca_and_paths(u, v):
        """LCA + пути u→LCA и v→LCA."""
        anc = {}
        cur = u
        d = 0
        while True:
            anc[cur] = d
            if cur not in parent:
                break
            _, par, _ = parent[cur]
            cur = par
            d += 1

        # Путь v→LCA (идём вверх пока не встретим предка u)
        path_v = []
        cur = v
        while cur not in anc:
            if cur not in parent:
                break   # разные компоненты — берём текущий как LCA
            eid, par, fwd = parent[cur]
            path_v.append((eid, -1 if fwd else +1))
            cur = par
        lca = cur

        # Путь u→LCA
        path_u = []
        cur = u
        while cur != lca:
            if cur not in parent:
                break
            eid, par, fwd = parent[cur]
            path_u.append((eid, -1 if fwd else +1))
            cur = par

        return lca, path_u, path_v

    # Строим контур для каждой хорды
    chords = [e for e in edges if e["id"] not in tree_ids]
    loops  = []

    for chord in chords:
        u, v = chord["a"], chord["b"]
        lca, path_u, path_v = lca_and_paths(u, v)

        # Контур (обход): u →(хорда)→ v →(дерево)→ LCA →(дерево)→ u
        # Хорда u→v: sign=+1 (по ориентации ребра a→b, т.к. a=u)
        loop = [(chord["id"], +1)]

        # v → LCA (путь вверх от v): уже в path_v
        loop.extend(path_v)

        # LCA → u (обратный путь: u→LCA перевернуть и инвертировать знаки)
        for eid, sgn in reversed(path_u):
            loop.append((eid, -sgn))

        if len(loop) >= 2:
            loops.append(loop)

    return tree_ids, parent, loops


# ══════════════════════════════════════════════════════════════════════
# ШАГ 2: НАЧАЛЬНЫЕ Q — 1-й ЗАКОН КИРХГОФА
#
# Хорды = 0.
# Дерево: обходим от листьев к корням (постордер),
# каждый лист получает Q0/N_листьев,
# каждый узел накапливает сумму дочерних → передаёт родителю.
# Результат: в каждом внутреннем узле Σ_входящих = Σ_исходящих.
# ══════════════════════════════════════════════════════════════════════

def initial_Q(edges, atm, tree_ids, parent, Q0):
    """
    Начальные расходы строго по 1-му закону Кирхгофа.
    Q > 0 → ток в направлении a→b ребра.
    """
    Q = {e["id"]: 0.0 for e in edges}

    # Узлы дерева → дети каждого узла
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    children = {v: [] for v in all_nodes}
    for node, (eid, par, fwd) in parent.items():
        children[par].append(node)

    # Корни дерева (нет parent)
    roots = [v for v in all_nodes if v not in parent]

    # Листья дерева = узлы без детей, не являющиеся корнями
    leaves = [v for v in all_nodes
              if not children[v] and v in parent]

    n_leaves = max(len(leaves), 1)
    q_leaf   = Q0 / n_leaves

    # node_Q[v] = расход который нужно «протолкнуть» от v к его родителю
    node_Q = {v: 0.0 for v in all_nodes}
    for leaf in leaves:
        node_Q[leaf] = q_leaf

    # Постордерный обход (от листьев к корням)
    # Считаем число детей для каждого узла → как только все дети обработаны,
    # передаём сумму родителю.
    pending  = {v: len(children[v]) for v in all_nodes}
    process_queue = [v for v in all_nodes if pending[v] == 0 and v in parent]

    while process_queue:
        v = process_queue.pop(0)
        eid, par, fwd = parent[v]

        flow = node_Q[v]   # расход который v передаёт вверх по ребру

        # Ориентация ребра: fwd=True → a=par, b=v → Q>0 означает par→v
        # Мы хотим поток ОТ v К par (вверх), т.е. против ориентации → Q < 0
        # fwd=False → a=v, b=par → Q>0 означает v→par (вверх) → Q > 0
        Q[eid] = -flow if fwd else flow

        # Накапливаем в родителе
        node_Q[par] += flow

        # Уменьшаем счётчик ожидания родителя
        pending[par] -= 1
        if pending[par] == 0 and par in parent:
            process_queue.append(par)

    return Q


# ══════════════════════════════════════════════════════════════════════
# МЕТОД КРОССА
# ══════════════════════════════════════════════════════════════════════

def solve_cross(nodes_in, branches_in, options):
    """Метод Кросса (Андрияшева–Кросса) для вентиляционной сети."""
    tol      = float(options.get("tolerance", 0.0001))
    max_iter = int(options.get("maxIter", 10000))
    alpha    = float(options.get("alpha", 0.8))

    log  = []
    diag = []

    # Атмосферные узлы
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
                     "message": "Нет атмосферных узлов — отметьте устья стволов как «Выход (атмосфера)»"})

    # Строим рёбра
    edges = []
    for b in branches_in:
        edges.append({
            "id":  b["id"],
            "a":   b["fromId"],
            "b":   b["toId"],
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

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход будет нулевым"})

    # Остовное дерево + контуры
    tree_ids, parent, loops = build_tree_and_loops(edges, atm)
    log.append(f"Ветвей={len(edges)}, контуров={len(loops)}, вент={len(fans)}, атм={len(atm)}")

    if not loops:
        # Линейная сеть
        diag.append({"level": "info", "category": "topology",
                     "message": "Сеть без контуров — линейный расчёт"})
        Q = solve_linear(edges, atm, fans, log)
        return make_result(edges, Q, 1, True, 0.0, log, diag, nodes_in)

    # Начальные Q (1-й закон Кирхгофа)
    Q0 = estimate_Q0(edges)
    Q  = initial_Q(edges, atm, tree_ids, parent, Q0)
    log.append(f"Q0={Q0:.2f} м³/с, листьев={sum(1 for v in set(e['a'] for e in edges)|set(e['b'] for e in edges) if v not in parent or True)}")

    edge_by_id = {e["id"]: e for e in edges}

    # Итерации Кросса
    max_dH = float("inf")
    it = 0

    for it in range(1, max_iter + 1):
        max_dH = 0.0

        for loop in loops:
            # Невязка: ΔH = Σ sign·(R·Q·|Q| − H_вент)
            dH    = 0.0
            denom = 0.0   # 2·Σ R·|Q|

            for eid, sgn in loop:
                e  = edge_by_id[eid]
                q  = Q[eid]
                Hv = fan_H(e, q)
                dH    += sgn * (e["R"] * q * abs(q) - Hv)
                denom += 2.0 * e["R"] * abs(q)

            max_dH = max(max_dH, abs(dH))

            if denom < 1e-12:
                # Q=0 во всём контуре → оцениваем первый шаг
                R_avg  = sum(edge_by_id[eid]["R"] for eid, _ in loop) / len(loop)
                Hv_max = max((fan_H(edge_by_id[eid], 0.0) for eid, _ in loop), default=0.0)
                if Hv_max > 0 and R_avg > 0:
                    q_est  = math.sqrt(Hv_max / R_avg)
                    denom  = 2.0 * R_avg * q_est * len(loop)
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

    log.append(f"Итераций={it}, max|ΔH|={max_dH:.6f} Па")

    # Проверка 1-го закона (дисбаланс узлов)
    node_bal = {}
    for e in edges:
        q = Q[e["id"]]
        node_bal[e["a"]] = node_bal.get(e["a"], 0.0) - q
        node_bal[e["b"]] = node_bal.get(e["b"], 0.0) + q

    max_imb = 0.0
    worst   = None
    for node, bal in node_bal.items():
        if node not in atm and abs(bal) > max_imb:
            max_imb = abs(bal)
            worst   = node

    log.append(f"Макс. дисбаланс={max_imb:.4f} м³/с (узел {worst})")
    if max_imb > 1.0:
        diag.append({"level": "error", "category": "balance",
                     "message": f"Дисбаланс {max_imb:.2f} м³/с в узле {worst}",
                     "objectId": worst})

    return make_result(edges, Q, it, converged, max_dH, log, diag, nodes_in)


# ══════════════════════════════════════════════════════════════════════
# ЛИНЕЙНАЯ СЕТЬ (дерево без хорд)
# ══════════════════════════════════════════════════════════════════════

def solve_linear(edges, atm, fans, log):
    """Q из рабочей точки вентилятора для линейной сети."""
    Q = {e["id"]: 0.0 for e in edges}
    if not fans:
        return Q

    fe = fans[0]
    passive = [e for e in edges if not e["hasFan"]]
    R_net = sum(e["R"] for e in passive) or fe["R"]
    R_net = max(R_net, 1e-9)

    # Бисекция рабочей точки H(Q*) = R_net·Q*²
    lo, hi = 0.0, float(fe.get("qMax", 500))
    for _ in range(200):
        qm = (lo + hi) / 2.0
        hf = fan_H(fe, qm)
        hn = R_net * qm * qm
        if abs(hf - hn) < 0.001:
            break
        if hf > hn:
            lo = qm
        else:
            hi = qm
    Qwp = (lo + hi) / 2.0
    log.append(f"Линейная сеть: Q_wp={Qwp:.2f} м³/с")

    for e in edges:
        Q[e["id"]] = Qwp
    return Q


# ══════════════════════════════════════════════════════════════════════
# РЕЗУЛЬТАТ
# ══════════════════════════════════════════════════════════════════════

def make_result(edges, Q, it, converged, max_dH, log, diag, nodes_in=None):
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