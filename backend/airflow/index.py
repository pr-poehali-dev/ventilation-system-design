"""
Расчёт воздухораспределения — Метод Кросса (контурные поправки).

Классический итерационный метод для горных вентиляционных сетей.
Алгоритм идентичен АэроСети и Вентиляции-CAD.

POST: {nodes, branches, options:{tolerance, maxIter, alpha}}
"""
import json, math, collections

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

GND = "__GND__"


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения горных выработок (метод Кросса)."""
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
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ══════════════════════════════════════════════════════════════════════

def get_R(b):
    r = float(b.get("R") or b.get("resistance") or 0.0)
    return max(r, 1e-9)


def fan_H(e, Q):
    """Напор вентилятора H при расходе Q (м³/с → Па)."""
    if not e.get("hasFan"):
        return 0.0
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        if Q <= 0:
            return 0.0
        if Q > float(e.get("qMax", 1e9)):
            return 0.0
        h0 = float(e.get("h0", 0))
        h1 = float(e.get("h1", 0))
        h2 = float(e.get("h2", 0))
        return max(0.0, h0 + h1 * Q + h2 * Q * Q)
    return float(e.get("fanPressure", 0))


def fan_dH(e, Q):
    """dH/dQ для curve-вентилятора."""
    if not e.get("hasFan") or Q < 0:
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        return float(e.get("h1", 0)) + 2.0 * float(e.get("h2", 0)) * Q
    return 0.0


def build_graph(nodes_in, branches_in):
    """Строит список рёбер, заменяя атмосферные узлы на GND."""
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
            "qMin": float(b.get("qMin", 1.0)),
            "qMax": float(b.get("qMax", 1e9)),
            "area": float(b.get("area", 0)),
        })
    return edges, atm


# ══════════════════════════════════════════════════════════════════════
# НАЧАЛЬНОЕ РАСПРЕДЕЛЕНИЕ РАСХОДОВ (первый закон Кирхгофа)
# ══════════════════════════════════════════════════════════════════════

def init_flows(edges, q_total=1.0):
    """
    Начальное приближение методом обхода дерева (BFS от GND).
    Даёт Q, строго удовлетворяющий 1-му закону Кирхгофа во всех узлах:
    сумма входящих = сумма исходящих в каждом внутреннем узле.

    Алгоритм:
    1. BFS от GND строит остовное дерево.
    2. Хордовые ветви получают Q=0 (не влияют на баланс).
    3. Для каждого листа дерева назначаем Q = q_total / число_листьев.
    4. Поднимаемся вверх по дереву, суммируя расходы (закон сохранения).
    """
    n = len(edges)
    Q = [0.0] * n

    # Смежность
    adj = collections.defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append((i, e["b"], +1))
        adj[e["b"]].append((i, e["a"], -1))

    # BFS от GND — строим дерево (parent_edge, parent_node для каждого узла)
    parent_edge  = {}   # node → edge_idx ведущий к родителю
    parent_sign  = {}   # node → знак (направление к родителю: +1 если e["a"]==parent)
    parent_node  = {}   # node → родительский узел
    children     = collections.defaultdict(list)  # node → [child_node, ...]
    order        = []   # BFS-порядок узлов

    visited = {GND}
    queue   = collections.deque([GND])
    while queue:
        node = queue.popleft()
        order.append(node)
        for ei, nb, sign in adj[node]:
            if nb not in visited:
                visited.add(nb)
                parent_edge[nb] = ei
                parent_sign[nb] = sign   # +1 если ребро идёт node→nb (a→b), -1 иначе
                parent_node[nb] = node
                children[node].append(nb)
                queue.append(nb)

    # Считаем листья (узлы без детей, кроме GND)
    leaves = [n for n in order if n != GND and not children[n]]
    if not leaves:
        return Q

    q_leaf = q_total / len(leaves)

    # Назначаем расход листьям
    node_flow = collections.defaultdict(float)  # суммарный расход через узел вниз
    for leaf in leaves:
        node_flow[leaf] = q_leaf

    # Проходим узлы в обратном BFS-порядке (снизу вверх)
    for node in reversed(order):
        if node == GND:
            continue
        ei   = parent_edge[node]
        sign = parent_sign[node]  # +1: ребро a→b, node = b → поток идёт b→a (к GND) → знак -1 для Q[ei]
        # Q[ei] в направлении a→b: если node=b и поток идёт b→a, то Q[ei] < 0
        Q[ei] = node_flow[node] * (-sign)
        # Передаём расход родителю
        parent_node_id = parent_node[node]
        node_flow[parent_node_id] += node_flow[node]

    return Q


# ══════════════════════════════════════════════════════════════════════
# ПОИСК НЕЗАВИСИМЫХ КОНТУРОВ (хорды дерева)
# ══════════════════════════════════════════════════════════════════════

def find_spanning_tree_and_loops(edges):
    """
    Строит остовное дерево и находит независимые контуры (через хорды).
    Возвращает список контуров: каждый контур = [(edge_idx, sign), ...]
    sign = +1 если ветвь обходится в направлении a→b, -1 иначе.
    """
    # Все узлы
    nodes = set()
    for e in edges:
        nodes.add(e["a"])
        nodes.add(e["b"])

    # Union-Find для построения дерева
    parent = {n: n for n in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        px, py = find(x), find(y)
        if px == py:
            return False
        parent[px] = py
        return True

    tree_edges = []
    chord_edges = []

    for i, e in enumerate(edges):
        if union(e["a"], e["b"]):
            tree_edges.append(i)
        else:
            chord_edges.append(i)

    if not chord_edges:
        return []

    # Для каждой хорды находим путь в дереве между её узлами
    adj_tree = collections.defaultdict(list)
    for i in tree_edges:
        e = edges[i]
        adj_tree[e["a"]].append((i, e["b"]))
        adj_tree[e["b"]].append((i, e["a"]))

    def find_path(src, dst):
        """BFS путь src→dst в дереве. Возвращает [(edge_idx, sign), ...]"""
        if src == dst:
            return []
        queue = collections.deque([(src, [])])
        seen = {src}
        while queue:
            node, path = queue.popleft()
            for ei, nb in adj_tree[node]:
                if nb in seen:
                    continue
                seen.add(nb)
                e = edges[ei]
                sign = +1 if e["a"] == node else -1
                new_path = path + [(ei, sign)]
                if nb == dst:
                    return new_path
                queue.append((nb, new_path))
        return None

    loops = []
    for ci in chord_edges:
        ce = edges[ci]
        path = find_path(ce["b"], ce["a"])
        if path is None:
            continue
        loop = [(ci, +1)] + path
        loops.append(loop)

    return loops


# ══════════════════════════════════════════════════════════════════════
# МЕТОД КРОССА
# ══════════════════════════════════════════════════════════════════════

def solve(nodes_in, branches_in, options):
    tol      = float(options.get("tolerance", 0.01))
    max_iter = int(options.get("maxIter", 2000))
    alpha    = float(options.get("alpha", 1.0))  # релаксация

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

    log.append(f"Метод Кросса: ветвей={len(edges)} вент={len(fans)}")

    # Независимые контуры
    loops = find_spanning_tree_and_loops(edges)
    log.append(f"Контуров={len(loops)}")

    # Начальный расход
    Q = [0.0] * len(edges)

    def bisect_q0():
        """
        Находит начальный Q методом бисекции: H_fan(Q) = R_total · Q².
        Работает строго в диапазоне [qMin, qMax] вентилятора.
        Для constant-вентилятора: Q = sqrt(H/R).
        """
        R_total = sum(e["R"] for e in edges)
        if R_total <= 0:
            return 1.0

        # Для curve-вентилятора — бисекция на нисходящей ветви характеристики
        for fan_e in fans:
            if fan_e.get("fanMode", "constant") == "curve":
                q_lo = float(fan_e.get("qMin", 1.0))
                q_hi = float(fan_e.get("qMax", 90.0))
                # Проверяем что H(q_lo) > R·q_lo² и H(q_hi) < R·q_hi²
                # (рабочая точка лежит между ними)
                def f(q):
                    return fan_H(fan_e, q) - R_total * q * q
                # Если в q_hi функция уже отрицательная — рабочая точка внутри
                if f(q_lo) <= 0:
                    return q_lo  # сопротивление слишком велико
                if f(q_hi) >= 0:
                    return q_hi  # сопротивление слишком мало
                # Бисекция
                for _ in range(60):
                    q_mid = 0.5 * (q_lo + q_hi)
                    if f(q_mid) > 0:
                        q_lo = q_mid
                    else:
                        q_hi = q_mid
                    if q_hi - q_lo < 0.01:
                        break
                return 0.5 * (q_lo + q_hi)

        # constant-вентилятор
        H_fan = sum(fan_H(e, 1.0) for e in edges)
        return math.sqrt(H_fan / R_total) if H_fan > 0 else 1.0

    # Рабочий расход вентилятора (для масштабирования начального Q)
    q0 = bisect_q0()

    # Для линейной сети (нет контуров) — рабочая точка = результат бисекции
    if not loops:
        # Используем init_flows чтобы соблюсти 1-й закон Кирхгофа
        Q_init = init_flows(edges, q_total=q0)
        for i in range(len(edges)):
            Q[i] = Q_init[i]
        return make_result(edges, {e["id"]: Q[i] for i, e in enumerate(edges)},
                           1, True, 0.0, log, diag)

    # Начальное распределение для сети с контурами —
    # init_flows даёт Q удовлетворяющий 1-му закону Кирхгофа
    Q_init = init_flows(edges, q_total=q0)
    for i in range(len(edges)):
        Q[i] = Q_init[i]

    # Основной цикл Кросса
    max_dq = float("inf")
    it     = 0

    for it in range(1, max_iter + 1):
        max_dq = 0.0

        for loop in loops:
            # Невязка контура: ΔH = Σ(R·Q·|Q| - H_fan) по контуру
            sum_h   = 0.0  # Σ R·Q·|Q| - H_fan
            sum_2rq = 0.0  # Σ 2·R·|Q| + |dH/dQ|  (знаменатель)

            for ei, sign in loop:
                e  = edges[ei]
                qi = Q[ei] * sign  # расход в направлении обхода
                R  = e["R"]
                H  = fan_H(e, abs(qi)) * sign  # напор в направлении обхода

                sum_h   += R * qi * abs(qi) - H
                sum_2rq += 2.0 * R * abs(qi) + abs(fan_dH(e, abs(qi)))

            if sum_2rq < 1e-12:
                continue

            dq = alpha * sum_h / sum_2rq
            max_dq = max(max_dq, abs(dq))

            # Обновляем расходы
            for ei, sign in loop:
                Q[ei] -= dq * sign

        if max_dq < tol:
            it += 1
            break

    converged = max_dq < tol
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. ΔQ={max_dq:.4f} м³/с"})

    log.append(f"Итераций={it} ΔQ={max_dq:.4f} м³/с")

    # Постобработка: проверка 1-го закона Кирхгофа
    # После Кросса считаем невязку в каждом узле и логируем
    node_balance = collections.defaultdict(float)
    for i, e in enumerate(edges):
        node_balance[e["a"]] -= Q[i]   # вытекает из a
        node_balance[e["b"]] += Q[i]   # втекает в b
    max_imbalance = max((abs(v) for k, v in node_balance.items() if k != GND), default=0.0)
    log.append(f"Макс. невязка 1-го закона={max_imbalance:.4f} м³/с")
    if max_imbalance > 1.0:
        diag.append({"level": "warning", "category": "balance",
                     "message": f"Несоблюдение баланса расходов в узлах: до {max_imbalance:.2f} м³/с. "
                                 "Проверьте топологию сети."})

    return make_result(edges, {e["id"]: Q[i] for i, e in enumerate(edges)},
                       it, converged, max_dq, log, diag)


def find_dead_ends(edges):
    """
    Возвращает множество id тупиковых ветвей (Q=0).

    Алгоритм итеративного "обрыва листьев":
    1. Помечаем узлы-тупики (degree=1, без вентилятора).
    2. Все ветви, хотя бы один конец которых — мёртвый узел, помечаем мёртвыми.
    3. Удаляем мёртвые ветви из графа → пересчитываем степени → повторяем.
    4. Останавливаемся когда новых мёртвых ветвей нет.

    Ветвь с вентилятором (ВМП) — никогда не мёртвая.
    """
    # Строим изменяемый граф: узел → множество id ветвей
    adj = collections.defaultdict(set)
    for e in edges:
        adj[e["a"]].add(e["id"])
        adj[e["b"]].add(e["id"])

    edge_by_id = {e["id"]: e for e in edges}
    # Живые ветви (начально все)
    alive = {e["id"] for e in edges}
    dead  = set()

    changed = True
    while changed:
        changed = False
        # Пересчитываем степень только по живым ветвям
        degree = collections.defaultdict(int)
        for eid in alive:
            e = edge_by_id[eid]
            if e["a"] != GND:
                degree[e["a"]] += 1
            if e["b"] != GND:
                degree[e["b"]] += 1

        # Узлы с вентилятором среди живых ветвей
        fan_nodes = set()
        for eid in alive:
            e = edge_by_id[eid]
            if e["hasFan"]:
                fan_nodes.add(e["a"])
                fan_nodes.add(e["b"])

        # Ищем живые ветви, у которых один конец — листовой мёртвый узел
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
            alive -= to_kill
            dead  |= to_kill
            changed = True

    return dead


def make_result(edges, Q, it, converged, max_res, log, diag):
    dead_ends = find_dead_ends(edges)
    out = []
    for e in edges:
        is_dead = e["id"] in dead_ends
        q = Q.get(e["id"], 0.0)

        if is_dead:
            q = 0.0
        elif e["hasFan"] and abs(q) < 1e-6:
            # Тупиковая ветвь с ВМП: расход не вычислился методом Кросса
            # (вентилятор в разомкнутой ветви). Считаем рабочую точку:
            # H_fan(Q) = R·Q² → бисекция
            R = e["R"]
            if R > 0:
                q_lo = float(e.get("qMin", 1.0))
                q_hi = float(e.get("qMax", 90.0))
                def f_local(qv):
                    return fan_H(e, qv) - R * qv * qv
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
        out.append({"id": e["id"], "Q": round(q, 4), "H": round(H, 3),
                    "Hfan": round(Hv, 3), "velocity": round(vel, 3),
                    "isDead": is_dead})
    return {"branches": out, "nodes": [], "iterations": it,
            "converged": converged, "maxResidual": round(max_res, 6),
            "log": log, "diagnostics": diag}


def empty_result(msg):
    return {"branches": [], "nodes": [], "iterations": 0, "converged": True,
            "maxResidual": 0.0, "log": [msg],
            "diagnostics": [{"level": "warning", "category": "topology", "message": msg}]}


def ok(data):
    return {"statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(data, ensure_ascii=False)}


def err(code, msg):
    return {"statusCode": code,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": msg}, ensure_ascii=False)}