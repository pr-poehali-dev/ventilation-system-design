"""
Расчёт воздухораспределения — Метод Кросса (Андрияшева–Кросса).

Алгоритм (по учебнику):
1. Строим граф: вершины=узлы, рёбра=ветви.
2. Находим остовное дерево BFS → хорды → независимые контуры.
3. Задаём начальные Q, удовлетворяющие 1-му закону Кирхгофа (баланс в узлах).
4. Итерируем по контурам:
   ΔH_k  = Σ(R_i · Q_i · |Q_i|) - H_вент,k   (невязка депрессии)
   ΔQ_k  = -ΔH_k / (2 · Σ R_i · |Q_i|)         (поправка Кросса)
   Q_i  += sign_i · α · ΔQ_k                    (обновление с демпф.)
5. Сходимость: max|ΔH_k| < ε.

POST JSON:
  method: "cross" | "mkr"
  nodes: [{id, isAtm?}]
  branches: [{id, fromId, toId, R, hasFan?, fanMode?, fanPressure?, h0?, h1?, h2?, qMax?, area?}]
  options: {tolerance?, maxIter?, alpha?}

Ответ:
  branches: [{id, Q, H, Hfan, velocity}]
  iterations, converged, maxResidual, log, diagnostics
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

    method  = body.get("method", "cross").lower()
    nodes_in   = body.get("nodes", [])
    branches_in = body.get("branches", [])
    options = body.get("options", {})

    if not branches_in:
        return ok(empty_result("Нет ветвей для расчёта"))

    try:
        result = solve_cross(nodes_in, branches_in, options)
    except Exception as ex:
        import traceback
        return err(500, f"Ошибка: {ex}\n{traceback.format_exc()}")

    return ok(result)


# ─────────────────────────────────────────────────────────────────────────────
# УТИЛИТЫ
# ─────────────────────────────────────────────────────────────────────────────

def get_R(b: dict) -> float:
    r = float(b.get("R") or b.get("resistance") or 0.0)
    return max(r, 1e-9)


def Hfan(e: dict, Q: float) -> float:
    """Напор вентилятора при расходе Q."""
    if not e.get("hasFan"):
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        qa  = abs(Q)
        qmx = float(e.get("qMax", 1e9))
        if qa > qmx:
            return 0.0
        h0, h1, h2 = float(e.get("h0", 0)), float(e.get("h1", 0)), float(e.get("h2", 0))
        return max(0.0, h0 + h1 * qa + h2 * qa * qa)
    return float(e.get("fanPressure", 0))


# ─────────────────────────────────────────────────────────────────────────────
# ПОСТРОЕНИЕ ГРАФА
# ─────────────────────────────────────────────────────────────────────────────

def build_graph(nodes_in, branches_in):
    """Возвращает (atm_set, edges_list)."""
    atm = set()
    for n in nodes_in:
        if n.get("isAtm") or n.get("atmosphereLink"):
            atm.add(n["id"])
    # Если нет явных — ищем по имени
    if not atm:
        for n in nodes_in:
            nid = str(n.get("id", "")).lower()
            if any(x in nid for x in ("атм", "atm", "gnd", "surface", "поверхн")):
                atm.add(n["id"])

    edges = []
    for b in branches_in:
        edges.append({
            "id":  b["id"],
            "a":   b["fromId"],
            "b":   b["toId"],
            "R":   get_R(b),
            "hasFan":     bool(b.get("hasFan")),
            "fanMode":    b.get("fanMode", "constant"),
            "fanPressure": float(b.get("fanPressure", 0)),
            "h0": float(b.get("h0", 0)),
            "h1": float(b.get("h1", 0)),
            "h2": float(b.get("h2", 0)),
            "qMax": float(b.get("qMax", 1e9)),
            "area": float(b.get("area", 0)),
        })
    return atm, edges


# ─────────────────────────────────────────────────────────────────────────────
# ШАГ 2: ОСТОВНОЕ ДЕРЕВО + ХОРДЫ → НЕЗАВИСИМЫЕ КОНТУРЫ
#
# Алгоритм:
#  1. BFS по всему графу → строим дерево (parent[v] = (edge_id, parent_v))
#  2. Хорды = все рёбра не вошедшие в дерево
#  3. Каждая хорда u-v порождает один независимый контур:
#     путь(корень→u) + хорда(u→v) + путь(v→корень)
#     Знаки определяем единым обходом контура.
# ─────────────────────────────────────────────────────────────────────────────

def spanning_tree_and_loops(edges):
    """
    Возвращает loops — список независимых контуров.
    Каждый контур: [(edge_id, sign), ...], sign=+1 если Q_edge совпадает
    с обходом контура, -1 — против.
    """
    if not edges:
        return []

    # Собираем все узлы
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    adj = {v: [] for v in all_nodes}
    for e in edges:
        adj[e["a"]].append(e)
        adj[e["b"]].append(e)

    # BFS — строим остовное дерево (обрабатываем все компоненты связности)
    visited  = set()
    parent   = {}          # node → (edge_id, parent_node, direction_to_node)
    tree_ids = set()

    for start in all_nodes:
        if start in visited:
            continue
        visited.add(start)
        queue = [start]
        while queue:
            v = queue.pop(0)
            for e in adj[v]:
                u = e["b"] if e["a"] == v else e["a"]
                if u not in visited:
                    visited.add(u)
                    # direction: True = движемся по ребру a→b (v==a, u==b)
                    parent[u] = (e["id"], v, (e["a"] == v))
                    tree_ids.add(e["id"])
                    queue.append(u)

    edge_by_id = {e["id"]: e for e in edges}

    def path_to_root(node):
        """
        Путь от node до корня дерева.
        Возвращает список (edge_id, sign) где sign=+1 значит мы движемся
        в направлении ребра (a→b), -1 — против (b→a).
        """
        path = []
        cur = node
        while cur in parent:
            eid, par, fwd = parent[cur]
            # Мы движемся от cur к par (к корню).
            # Если fwd=True, ребро par→cur (a→b), значит мы идём ПРОТИВ — sign=-1
            # Если fwd=False, ребро cur→par (a→b), значит мы идём ПО ребру — sign=+1
            path.append((eid, -1 if fwd else +1))
            cur = par
        return path

    def ancestors(node):
        """Все предки node (включая сам node) → {node: depth}."""
        anc = {}
        cur = node
        d = 0
        while True:
            anc[cur] = d
            if cur not in parent:
                break
            _, par, _ = parent[cur]
            cur = par
            d += 1
        return anc

    # Для каждой хорды строим контур
    chords = [e for e in edges if e["id"] not in tree_ids]
    loops  = []

    for chord in chords:
        u, v = chord["a"], chord["b"]

        # LCA (наименьший общий предок)
        anc_u = ancestors(u)
        cur = v
        while cur not in anc_u:
            if cur not in parent:
                break
            _, par, _ = parent[cur]
            cur = par
        lca = cur

        # Контур: u → lca (по дереву) → v (по дереву обратно) + хорда v→u
        # Обходим контур в направлении: хорда идёт u→v (+1)

        # Путь u → lca: идём по parent от u до lca
        seg_u = []  # (eid, sign) движение u→lca
        cur = u
        while cur != lca:
            eid, par, fwd = parent[cur]
            # fwd=True: ребро par→cur, движемся против (cur→par), sign=-1 по ребру
            # fwd=False: ребро cur→par, движемся по ребру, sign=+1
            seg_u.append((eid, -1 if fwd else +1))
            cur = par

        # Путь lca → v: идём по parent от v до lca и разворачиваем
        seg_v = []  # (eid, sign) движение lca→v (обратный от path v→lca)
        cur = v
        path_v_to_lca = []
        while cur != lca:
            eid, par, fwd = parent[cur]
            # Движение cur→par: fwd=True → против ребра (-1); fwd=False → по ребру (+1)
            path_v_to_lca.append((eid, -1 if fwd else +1))
            cur = par
        # Разворачиваем: теперь движение lca→v (знаки инвертируем)
        for eid, sgn in reversed(path_v_to_lca):
            seg_v.append((eid, -sgn))

        # Контур: seg_u (u→lca) + seg_v (lca→v) + хорда (v→u, т.е. -1)
        # НО мы хотим направление хорды u→v = +1
        # Контур обхода: u→(lca по дереву)→v→(хорда)→u
        # хорда: a=u, b=v, мы идём v→u = против = -1
        # Меняем направление обхода: хорда u→v (+1), потом v→lca, потом lca→u
        loop = [(chord["id"], +1)]   # хорда u→v
        # lca → v уже есть в seg_v, нам нужен путь v→lca→u
        # = обратный seg_v + seg_u в обратном направлении
        for eid, sgn in reversed(seg_v):
            loop.append((eid, -sgn))   # v→lca
        for eid, sgn in reversed(seg_u):
            loop.append((eid, -sgn))   # lca→u

        if loop:
            loops.append(loop)

    return loops


# ─────────────────────────────────────────────────────────────────────────────
# ШАГ 3: НАЧАЛЬНЫЕ Q — строго удовлетворяют 1-му закону Кирхгофа
#
# Правильный алгоритм:
#  1. Хордам (не-дерево) назначаем Q=0.
#  2. По дереву Q назначаем СНИЗУ ВВЕРХ (от листьев к корню),
#     суммируя расходы потомков — баланс в каждом узле выполняется автоматически.
#
# Суть: дерево ориентируем от корня (атмосфера/вентилятор) к листьям.
# Каждый лист получает долю Q0 = Q_fan / N_листьев.
# Каждый внутренний узел = сумма дочерних ветвей.
# ─────────────────────────────────────────────────────────────────────────────

def initial_flows(edges, atm):
    """
    Начальное Q строго по 1-му закону Кирхгофа.
    Хорды = 0. Ветви дерева получают Q снизу-вверх:
    каждый лист = Q0/кол_листьев, каждый узел = сумма дочерних.
    """
    fans = [e for e in edges if e["hasFan"]]

    # Оценка Q0 — рабочая точка первого вентилятора
    Q0 = 50.0
    if fans:
        fe = fans[0]
        fp = Hfan(fe, Q0)
        passive = [e for e in edges if not e["hasFan"]]
        R_total = sum(e["R"] for e in passive)
        R_total = max(R_total, fe["R"], 1e-9)
        if fp > 0:
            Q0 = math.sqrt(fp / R_total)
        Q0 = max(1.0, min(Q0, float(fe.get("qMax", 500))))

    Q = {e["id"]: 0.0 for e in edges}

    # Строим остовное дерево (те же tree_ids что в spanning_tree_and_loops,
    # но пересчитываем здесь чтобы не зависеть от порядка вызовов)
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    adj = {v: [] for v in all_nodes}
    for e in edges:
        adj[e["a"]].append(e)
        adj[e["b"]].append(e)

    # BFS: строим дерево от атмосферных / вентиляторных узлов
    starts = list(atm) if atm else []
    if not starts:
        # Нет атмосферных — стартуем с узла вентилятора
        if fans:
            starts = [fans[0]["a"]]
        else:
            starts = [edges[0]["a"]]

    visited = set(starts)
    parent_edge = {}   # node → edge_id (ребро к родителю в дереве)
    children   = {v: [] for v in all_nodes}   # дерево: parent → [child]
    tree_ids   = set()
    queue = list(starts)

    while queue:
        v = queue.pop(0)
        for e in adj[v]:
            u = e["b"] if e["a"] == v else e["a"]
            if u not in visited:
                visited.add(u)
                tree_ids.add(e["id"])
                parent_edge[u] = (e["id"], v, e["a"] == v)
                # v = родитель, u = ребёнок
                children[v].append(u)
                queue.append(u)

    # Находим листья дерева (узлы без детей, не являющиеся атмосферными)
    atm_set = set(starts)
    leaves = [v for v in all_nodes
              if not children[v] and v not in atm_set]

    n_leaves = max(len(leaves), 1)
    q_leaf   = Q0 / n_leaves   # каждый лист получает равную долю

    # Назначаем Q листьям и суммируем снизу вверх (постордерный обход)
    # node_flow[v] = суммарный расход через узел v (в дерево к корню)
    node_flow = {v: 0.0 for v in all_nodes}
    for leaf in leaves:
        node_flow[leaf] = q_leaf

    # Топологическая сортировка (от листьев к корню)
    # Используем BFS в обратном направлении: степень = кол-во детей
    in_degree = {v: len(children[v]) for v in all_nodes}
    topo_queue = [v for v in all_nodes if in_degree[v] == 0]  # листья
    topo_order = []
    while topo_queue:
        v = topo_queue.pop(0)
        topo_order.append(v)
        if v in parent_edge:
            _, par, _ = parent_edge[v]
            in_degree[par] -= 1
            if in_degree[par] == 0:
                topo_queue.append(par)

    # Проходим от листьев к корню: суммируем расходы
    for v in topo_order:
        if v not in parent_edge:
            continue  # корень — нечего передавать
        eid, par, fwd = parent_edge[v]
        flow_v = node_flow[v]
        # Направление ребра: fwd=True → ребро par→v, Q>0 означает par→v
        # Мы хотим передать flow_v ОТ v К par (вверх по дереву)
        # Если ребро par→v (fwd=True): flow к корню = отрицательное направление = Q<0
        # Если ребро v→par (fwd=False): flow к корню = положительное направление = Q>0
        Q[eid] += -flow_v if fwd else flow_v
        # Накапливаем в родителе
        node_flow[par] += flow_v

    return Q


# ─────────────────────────────────────────────────────────────────────────────
# ШАГ 4–6: ИТЕРАЦИИ КРОССА
# ─────────────────────────────────────────────────────────────────────────────

def solve_cross(nodes_in, branches_in, options):
    """Метод Кросса (Андрияшева–Кросса) для вентиляционной сети."""
    tol      = float(options.get("tolerance", 0.0001))
    max_iter = int(options.get("maxIter", 10000))
    alpha    = float(options.get("alpha", 0.8))   # демпфирующий множитель α∈(0,1)

    log  = []
    diag = []

    atm, edges = build_graph(nodes_in, branches_in)

    if not atm:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов — отметьте устья стволов как «Выход (атмосфера)»"})

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход будет нулевым"})

    # Шаг 1: независимые контуры
    loops = spanning_tree_and_loops(edges)
    log.append(f"Ветвей: {len(edges)}, контуров: {len(loops)}, вентиляторов: {len(fans)}")

    if not loops:
        # Линейная сеть (дерево) — Q из рабочей точки вентилятора
        diag.append({"level": "info", "category": "topology",
                     "message": "Контуры не найдены — сеть линейная, Q из рабочей точки"})
        Q = solve_linear(edges, atm, fans, log)
        return make_result(edges, Q, 1, True, 0.0, log, diag)

    # Шаг 2: начальные расходы
    Q = initial_flows(edges, atm)
    log.append(f"Q0 (пример): {[round(v,1) for v in list(Q.values())[:5]]}")

    # Словарь для быстрого доступа к ветвям
    edge_by_id = {e["id"]: e for e in edges}

    # Шаги 3–6: итерации Кросса
    max_dH = float("inf")
    it = 0

    for it in range(1, max_iter + 1):
        max_dH = 0.0

        for loop in loops:
            # Невязка депрессии контура k:
            # ΔH_k = Σ_i[ sign_i · (R_i · Q_i · |Q_i| - H_вент,i) ]
            dH    = 0.0
            denom = 0.0   # 2 · Σ R_i · |Q_i|

            for eid, sgn in loop:
                e  = edge_by_id[eid]
                q  = Q[eid]
                Hv = Hfan(e, q)
                dH    += sgn * (e["R"] * q * abs(q) - Hv)
                denom += 2.0 * e["R"] * abs(q)

            max_dH = max(max_dH, abs(dH))

            # При нулевом знаменателе (Q=0 везде): используем малый denom
            # чтобы всё равно сделать первый шаг к балансу
            if denom < 1e-12:
                # Оценка первоначального dQ: если есть вентилятор в контуре,
                # берём Q ≈ sqrt(H_fan / R_avg)
                R_avg = sum(edge_by_id[eid]["R"] for eid, _ in loop) / len(loop)
                Hv_max = max((Hfan(edge_by_id[eid], 0.0) for eid, _ in loop), default=0.0)
                if Hv_max > 0 and R_avg > 0:
                    q_est = math.sqrt(Hv_max / R_avg)
                    denom = 2.0 * R_avg * q_est * len(loop)
                else:
                    continue  # нет вентилятора и нет расхода — пропускаем

            # Поправка Кросса с демпфированием
            dQ = -alpha * dH / denom

            # Обновляем Q для всех ветвей контура
            for eid, sgn in loop:
                Q[eid] += sgn * dQ

        if max_dH < tol:
            it += 1
            break

    converged = max_dH < tol
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. |ΔH|={max_dH:.4f} Па"})

    log.append(f"Итераций: {it}, max|ΔH|={max_dH:.6f} Па")

    # Проверка 1-го закона Кирхгофа (баланс узлов)
    node_bal = {}
    all_nodes_set = set()
    for e in edges:
        all_nodes_set.add(e["a"])
        all_nodes_set.add(e["b"])
    for e in edges:
        q = Q[e["id"]]
        node_bal[e["a"]] = node_bal.get(e["a"], 0.0) - q   # вытекает из a
        node_bal[e["b"]] = node_bal.get(e["b"], 0.0) + q   # втекает в b

    # Атмосферные узлы — баланс не проверяем (источник/сток)
    atm_set = set()
    for n in nodes_in:
        if n.get("isAtm") or n.get("atmosphereLink"):
            atm_set.add(n["id"])

    max_node_imbalance = 0.0
    worst_node = None
    for node, bal in node_bal.items():
        if node not in atm_set:
            ab = abs(bal)
            if ab > max_node_imbalance:
                max_node_imbalance = ab
                worst_node = node

    log.append(f"Макс. дисбаланс узла: {max_node_imbalance:.4f} м³/с (узел {worst_node})")
    if max_node_imbalance > 1.0:
        diag.append({"level": "error", "category": "balance",
                     "message": f"Нарушение 1-го закона Кирхгофа: дисбаланс {max_node_imbalance:.2f} м³/с в узле {worst_node}",
                     "objectId": worst_node})

    return make_result(edges, Q, it, converged, max_dH, log, diag)


# ─────────────────────────────────────────────────────────────────────────────
# ЛИНЕЙНАЯ СЕТЬ (без контуров)
# ─────────────────────────────────────────────────────────────────────────────

def solve_linear(edges, atm, fans, log):
    """Для линейной (древовидной) сети — расход из рабочей точки вентилятора."""
    Q = {e["id"]: 0.0 for e in edges}
    if not fans:
        return Q

    fe = fans[0]
    # Суммарное сопротивление пассивных ветвей
    passive = [e for e in edges if not e["hasFan"]]
    R_net = sum(e["R"] for e in passive) or fe["R"]
    R_net = max(R_net, 1e-9)

    # Рабочая точка: H(Q*) = R_net · Q*²  (бисекция)
    lo, hi = 0.0, float(fe.get("qMax", 500))
    for _ in range(200):
        qm = (lo + hi) / 2.0
        hf = Hfan(fe, qm)
        hn = R_net * qm * qm
        if abs(hf - hn) < 0.001:
            break
        if hf > hn:
            lo = qm
        else:
            hi = qm
    Qwp = (lo + hi) / 2.0
    log.append(f"Линейная сеть: Q_рабочая={Qwp:.2f} м³/с")

    for e in edges:
        Q[e["id"]] = Qwp
    return Q


# ─────────────────────────────────────────────────────────────────────────────
# ФОРМИРОВАНИЕ ОТВЕТА
# ─────────────────────────────────────────────────────────────────────────────

def make_result(edges, Q, it, converged, max_dH, log, diag):
    branches_out = []
    for e in edges:
        q   = Q.get(e["id"], 0.0)
        H   = e["R"] * q * abs(q)
        Hv  = Hfan(e, q)
        area = e.get("area", 0.0)
        vel = abs(q) / area if area > 0.01 else 0.0
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