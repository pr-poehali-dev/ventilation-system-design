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
    """Напор вентилятора H при суммарном расходе Q (м³/с → Па).
    При fanReverse ребро в графе развёрнуто (a↔b), поэтому H >= 0 всегда.
    N параллельных вентиляторов: каждый пропускает Q/N → характеристика сдвигается вправо в N раз.
    """
    if not e.get("hasFan"):
        return 0.0
    N = max(1, int(e.get("fanParallel", 1) or 1))
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        q_one = abs(Q) / N
        if q_one <= 0:
            return 0.0
        if q_one > float(e.get("qMax", 1e9)):
            return 0.0
        h0 = float(e.get("h0", 0))
        h1 = float(e.get("h1", 0))
        h2 = float(e.get("h2", 0))
        return max(0.0, h0 + h1 * q_one + h2 * q_one * q_one)
    return float(e.get("fanPressure", 0))


def fan_dH(e, Q):
    """|dH/dQ_total| для curve-вентилятора (с учётом параллели)."""
    if not e.get("hasFan"):
        return 0.0
    if e.get("fanMode", "constant") == "curve":
        N = max(1, int(e.get("fanParallel", 1) or 1))
        q_one = abs(Q) / N
        dh_one = float(e.get("h1", 0)) + 2.0 * float(e.get("h2", 0)) * q_one
        return abs(dh_one) / N
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
        reverse = bool(b.get("fanReverse", False))
        # При реверсе разворачиваем только ребро с вентилятором.
        # Метод Кросса требует H >= 0. После расчёта Q этой ветви инвертируем знак.
        node_a = to_gnd(b["toId"]  if reverse else b["fromId"])
        node_b = to_gnd(b["fromId"] if reverse else b["toId"])
        edges.append({
            "id":          b["id"],
            "a":           node_a,
            "b":           node_b,
            "R":           get_R(b),
            "hasFan":      bool(b.get("hasFan")),
            "fanMode":     b.get("fanMode", "constant"),
            "fanPressure": float(b.get("fanPressure", 0)),
            "h0": float(b.get("h0", 0)),
            "h1": float(b.get("h1", 0)),
            "h2": float(b.get("h2", 0)),
            "qMin":        float(b.get("qMin", 1.0)),
            "qMax":        float(b.get("qMax", 1e9)),
            "area":        float(b.get("area", 0)),
            "fanReverse":  reverse,
            "fanParallel": max(1, int(b.get("fanParallel", 1) or 1)),
        })
    return edges, atm


# ══════════════════════════════════════════════════════════════════════
# НАЧАЛЬНОЕ РАСПРЕДЕЛЕНИЕ РАСХОДОВ (первый закон Кирхгофа)
# ══════════════════════════════════════════════════════════════════════

def init_flows(edges):
    """
    Начальное приближение методом обхода дерева (BFS от GND).
    Даёт Q, удовлетворяющий 1-му закону Кирхгофа во всех узлах.
    """
    # Строим граф смежности
    adj = collections.defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append((i, e["b"], +1))
        adj[e["b"]].append((i, e["a"], -1))

    # Начальный Q = 1.0 для всех ветвей (направление a→b)
    Q = [1.0] * len(edges)

    # BFS-обход: пускаем Q от вентилятора
    fans = [i for i, e in enumerate(edges) if e["hasFan"]]
    if fans:
        fi = fans[0]
        fe = edges[fi]
        Q[fi] = 10.0  # начальный расход через вентилятор
        start = fe["b"] if fe["b"] != GND else fe["a"]
    else:
        start = GND

    # Балансируем 1-й закон через BFS
    visited_nodes = {GND}
    tree_edges = set()
    queue = collections.deque([GND])

    while queue:
        node = queue.popleft()
        for ei, nb, sign in adj[node]:
            if nb not in visited_nodes:
                visited_nodes.add(nb)
                tree_edges.add(ei)
                queue.append(nb)

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

    # Проверяем связность с атмосферой: GND должен иметь степень >= 2
    # (подключён минимум к 2 рёбрам, т.е. есть реальный вход и выход на поверхность).
    # Если степень GND == 1 — только один выход, циркуляция невозможна.
    gnd_degree = sum(1 for e in edges if e["a"] == GND or e["b"] == GND)
    atm_count = sum(1 for n in nodes_in if n.get("isAtm") or n.get("atmosphereLink"))
    if atm_count > 0 and gnd_degree < 2:
        msg = (
            "Только один узел связан с атмосферой. Для циркуляции воздуха нужно "
            "минимум 2 выхода на поверхность (например, два ствола)."
        )
        diag.append({"level": "error", "category": "topology", "message": msg})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)
    if atm_count == 0:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет узлов, связанных с атмосферой. Добавьте минимум 2 поверхностных узла."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой"})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)

    log.append(f"Метод Кросса: ветвей={len(edges)} вент={len(fans)}")
    for e in edges:
        log.append(f"[edge] {e['id']} {e['a']}→{e['b']} R={e['R']:.4f}{'  ВЕН' if e['hasFan'] else ''}")
        print(f"[edge] {e['id']} {e['a']}→{e['b']} R={e['R']:.4f}{'  ВЕН' if e['hasFan'] else ''}")

    # Независимые контуры
    loops = find_spanning_tree_and_loops(edges)
    log.append(f"Контуров={len(loops)}")
    for li, loop in enumerate(loops):
        parts = [f"{edges[ei]['id']}({'+'if s>0 else'-'})" for ei, s in loop]
        log.append(f"[loop-{li}] " + " ".join(parts))
        print(f"[loop-{li}] " + " ".join(parts))

    # Если нет ни одного замкнутого контура — сеть разомкнута, циркуляция невозможна.
    # Например: после «разорвать связь» один ствол стал тупиком.
    if not loops:
        diag.append({"level": "error", "category": "topology",
                     "message": "Сеть не имеет замкнутых контуров — циркуляция воздуха невозможна. "
                                "Проверьте топологию: нужно минимум 2 выхода на поверхность, "
                                "образующих замкнутый путь."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

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

        # constant-вентилятор: H >= 0 (ребро уже развёрнуто при реверсе)
        H_fan = sum(fan_H(e, 1.0) for e in fans)
        return math.sqrt(H_fan / R_total) if H_fan > 0 else 1.0

    # Для линейной сети (нет контуров) — рабочая точка = результат бисекции
    if not loops:
        q0 = bisect_q0()
        for i, e in enumerate(edges):
            Q[i] = q0
        return make_result(edges, {e["id"]: Q[i] for i, e in enumerate(edges)},
                           1, True, 0.0, log, diag)

    # Начальное распределение для сети с контурами
    q0 = bisect_q0()
    log.append(f"Q0={q0:.3f} м³/с")
    for i, e in enumerate(edges):
        Q[i] = q0  # знак q0 уже учитывает реверс (отрицательный при fanReverse)

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
                qi = Q[ei] * sign  # расход в направлении обхода контура
                R  = e["R"]

                sum_h   += R * qi * abs(qi)
                sum_2rq += 2.0 * R * abs(qi)

                if e["hasFan"]:
                    # H знаковый: >0 прямой, <0 реверс.
                    # Вентилятор создаёт напор в направлении a→b при H>0, b→a при H<0.
                    # Вклад в невязку: -H·sign(qi) — стандартная формула Кросса.
                    H = fan_H(e, abs(Q[ei]))
                    sum_h   -= H * (1.0 if qi >= 0 else -1.0)
                    sum_2rq += fan_dH(e, abs(Q[ei]))

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
    for i, e in enumerate(edges):
        log.append(f"[Q] {e['id']}: Q={Q[i]:.3f}")

    return make_result(edges, {e["id"]: Q[i] for i, e in enumerate(edges)},
                       it, converged, max_dq, log, diag)


def find_dead_ends(edges):
    """
    Возвращает множество id тупиковых ветвей (Q=0).

    Тупиковая: хотя бы один конец (не GND) имеет степень 1
    И при этом ни одна из примыкающих ветвей НЕ имеет вентилятора.

    Ветви с вентилятором (ВМП) в тупике — НЕ тупиковые:
    вентилятор создаёт расход, а воздух возвращается диффузией/утечками.
    
    ВАЖНО: GND считается как нормальный узел для подсчёта степени —
    ствол, подключённый к атмосфере (GND) с одной стороны, не является тупиком.
    """
    degree = collections.defaultdict(int)
    for e in edges:
        degree[e["a"]] += 1
        degree[e["b"]] += 1

    # Узлы, к которым примыкает хотя бы один вентилятор
    fan_nodes = set()
    for e in edges:
        if e["hasFan"]:
            fan_nodes.add(e["a"])
            fan_nodes.add(e["b"])

    dead = set()
    for e in edges:
        # Ветвь с вентилятором — никогда не тупик
        if e["hasFan"]:
            continue
        a_dead = (e["a"] != GND and degree[e["a"]] == 1 and e["a"] not in fan_nodes)
        b_dead = (e["b"] != GND and degree[e["b"]] == 1 and e["b"] not in fan_nodes)
        if a_dead or b_dead:
            dead.add(e["id"])
    return dead


def make_result(edges, Q, it, converged, max_res, log, diag, force_zero=False):
    dead_ends = find_dead_ends(edges)
    out = []
    for e in edges:
        is_dead = e["id"] in dead_ends
        q = Q.get(e["id"], 0.0)

        if is_dead:
            q = 0.0
        elif force_zero:
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

        # При fanReverse ребро было развёрнуто внутри солвера (a↔b).
        # Q солвера положительный (поток a→b развёрнутого ребра),
        # но физически это поток toId→fromId → возвращаем отрицательным.
        if e.get("fanReverse") and not is_dead and not force_zero:
            q = -abs(q)

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