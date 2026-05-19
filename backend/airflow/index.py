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
MIN_DEAD_END_FLOW = 0.5   # м³/с — минимальный расход в тупике (ПБ: диффузионное проветривание)


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения горных выработок (метод Кросса)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return err(400, "Ошибка парсинга JSON")

    nodes_in     = body.get("nodes", [])
    branches_in  = body.get("branches", [])
    options      = body.get("options", {})
    normal_flows = body.get("normalFlows", {})  # расходы прямого режима для проверки k_rev

    if not branches_in:
        return ok(empty_result("Нет ветвей"))

    try:
        result = solve(nodes_in, branches_in, options, normal_flows)
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
    При реверсе используется отдельная P–Q характеристика если задана (reverseH0/H1/H2).
    N параллельных вентиляторов: каждый пропускает Q/N → характеристика сдвигается вправо в N раз.
    При fanStopped=True вентилятор остановлен — H=0 (только сопротивление ветви).
    """
    if not e.get("hasFan") or e.get("fanStopped"):
        return 0.0
    N = max(1, int(e.get("fanParallel", 1) or 1))
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        q_one = abs(Q) / N
        if q_one <= 0:
            return 0.0
        # При реверсе — используем отдельную характеристику если передана
        if e.get("fanReverse") and e.get("reverseH0") is not None:
            q_max_rev = float(e.get("reverseQMax", e.get("qMax", 1e9)))
            if q_one > q_max_rev:
                return 0.0
            rh0 = float(e.get("reverseH0", 0))
            rh1 = float(e.get("reverseH1", 0))
            rh2 = float(e.get("reverseH2", 0))
            return max(0.0, rh0 + rh1 * q_one + rh2 * q_one * q_one)
        # Прямая характеристика
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
        # При реверсе с отдельной кривой — используем её коэффициенты
        if e.get("fanReverse") and e.get("reverseH0") is not None:
            dh_one = float(e.get("reverseH1", 0)) + 2.0 * float(e.get("reverseH2", 0)) * q_one
        else:
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
        is_fan  = bool(b.get("hasFan", False))
        # Разворачиваем ТОЛЬКО ребро вентилятора при реверсе.
        # Остальные ветви остаются в исходной ориентации — иначе вся сеть переворачивается
        # и нарушается 1-й закон Кирхгофа (Q вентилятора ≠ Q сети).
        should_flip = reverse and is_fan
        node_a = to_gnd(b["toId"]  if should_flip else b["fromId"])
        node_b = to_gnd(b["fromId"] if should_flip else b["toId"])
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
            # Реверсная P–Q характеристика из каталога (если передана фронтендом)
            "reverseH0":   b.get("reverseH0"),
            "reverseH1":   b.get("reverseH1"),
            "reverseH2":   b.get("reverseH2"),
            "reverseQMax": b.get("reverseQMax"),
            "reverseEfficiencyFactor": b.get("reverseEfficiencyFactor"),
            "fanStopped":  bool(b.get("fanStopped", False)),
            "isLeakage":   bool(b.get("isLeakage", False)),
            "leakageCoeff": float(b.get("leakageCoeff", 0) or 0),
            "angle":       abs(float(b.get("angle", 0) or 0)),
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

    Рёбра GND→GND (оба конца — атмосфера) исключаются: они не образуют
    физических контуров циркуляции и создают ложные хорды.
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
        # Ребро GND→GND: оба конца — атмосфера. Такое ребро физически означает
        # поверхностный трубопровод между двумя выходами на поверхность.
        # В контурном методе оно не несёт смысла: вся атмосфера — один узел GND,
        # поэтому ребро GND→GND — это петля (самоконтур). Исключаем его из
        # остовного дерева и из хорд, чтобы не порождать ложные контуры.
        if e["a"] == GND and e["b"] == GND:
            continue
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

def check_reverse(edges, Q_result, normal_flows, diag):
    """
    Проверка норматива реверса по ПБ: расход в каждой выработке при реверсе
    должен быть не менее 60% от прямого режима.
    Проверяем только ветви с ненулевым прямым расходом.
    """
    has_reverse = any(e.get("fanReverse") for e in edges)
    if not has_reverse or not normal_flows:
        return

    failed = []
    warned = []
    for e in edges:
        bid = e["id"]
        q_normal = float(normal_flows.get(bid, 0))
        if q_normal < 0.1:  # тупиковые и нулевые пропускаем
            continue
        q_rev = abs(Q_result.get(bid, 0))
        k_rev = q_rev / q_normal
        if k_rev < 0.6:
            failed.append((bid, k_rev))
        elif k_rev < 0.8:
            warned.append((bid, k_rev))

    if failed:
        ids = ", ".join(f"{b} ({k:.0%})" for b, k in failed)
        diag.append({
            "level": "error",
            "category": "fan",
            "message": f"Реверс не соответствует нормативу ПБ (Q_рев < 60% от Q_прям): {ids}",
            "objectId": failed[0][0],
            "value": failed[0][1],
        })
    elif warned:
        ids = ", ".join(f"{b} ({k:.0%})" for b, k in warned)
        diag.append({
            "level": "warning",
            "category": "fan",
            "message": f"Реверс выполнен, но расход в ветвях ниже 80% от нормального: {ids}",
        })
    else:
        diag.append({
            "level": "info",
            "category": "fan",
            "message": "Реверс выполнен успешно — расход во всех ветвях ≥ 60% от прямого режима",
        })


def solve(nodes_in, branches_in, options, normal_flows=None):
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
    active_fans = [e for e in fans if not e.get("fanStopped")]
    if not fans:
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой"})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)
    if not active_fans:
        # Аналог disable_fan() → "Критическая ошибка: сеть не проветривается"
        stopped_names = [e["id"] for e in fans if e.get("fanStopped")]
        diag.append({"level": "error", "category": "fan",
                     "message": f"Аварийное отключение: все вентиляторы остановлены ({', '.join(stopped_names)}) — "
                                f"сеть не проветривается. Критическая ситуация!"})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)

    log.append(f"Метод Кросса: ветвей={len(edges)} вент={len(fans)} атм_узлов={len(atm)}")
    # Степень GND — важна для диагностики потерь
    gnd_edges = [e for e in edges if e["a"] == GND or e["b"] == GND]
    log.append(f"GND степень={len(gnd_edges)}: {[e['id'] for e in gnd_edges]}")
    print(f"[TOPO] GND степень={len(gnd_edges)}, атм={sorted(atm)}")
    for e in gnd_edges:
        print(f"[GND-edge] {e['id']} {e['a']}→{e['b']} R={e['R']:.4f}{'  ВЕН' if e['hasFan'] else ''}")
    for e in edges:
        log.append(f"[edge] {e['id']} {e['a']}→{e['b']} R={e['R']:.4f}{'  ВЕН' if e['hasFan'] else ''}")
        print(f"[edge] {e['id']} {e['a']}→{e['b']} R={e['R']:.4f}{'  ВЕН' if e['hasFan'] else ''}")

    log.append(f"Метод Кросса: всего ветвей={len(edges)}, вентиляторов={len(fans)}")

    # ── Определяем тупиковые ветви ДО расчёта ──────────────────────────
    # Тупиковые ветви ИСКЛЮЧАЮТСЯ из итераций Кросса (Q=0 принудительно).
    # Причина: они не образуют замкнутых контуров → в них нет циркуляции.
    # ВМП (вентилятор в тупике) — исключение, их расход вычисляется отдельно.
    dead_end_ids = find_dead_ends(edges)
    if dead_end_ids:
        log.append(f"Тупиков={len(dead_end_ids)}: {', '.join(sorted(dead_end_ids))}")
        for eid in dead_end_ids:
            log.append(f"  [тупик] {eid} → Q=0 (нет замкнутого пути)")

    # Активные рёбра для расчёта Кросса (без тупиков)
    active_edges = [e for e in edges if e["id"] not in dead_end_ids]
    active_idx   = [i for i, e in enumerate(edges) if e["id"] not in dead_end_ids]

    # Если все рёбра тупиковые — нет контуров
    if not active_edges:
        diag.append({"level": "error", "category": "topology",
                     "message": "Все ветви тупиковые — нет замкнутого контура вентиляции."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # Перестраиваем контуры только по активным рёбрам
    loops_active = find_spanning_tree_and_loops(active_edges)
    log.append(f"Контуров по активным={len(loops_active)}")

    if not loops_active:
        diag.append({"level": "error", "category": "topology",
                     "message": "Сеть не имеет замкнутых контуров — циркуляция воздуха невозможна. "
                                "Проверьте топологию: нужно минимум 2 выхода на поверхность."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # Начальный расход
    Q = [0.0] * len(edges)

    def bisect_q0():
        """
        Находит начальный Q методом бисекции: ΣH_fan(Q) = R_active · Q².
        При нескольких вентиляторах суммируем напоры (последовательная работа).
        Q ограничен min(qMax) всех вентиляторов — за этим пределом H_fan=0.
        """
        R_total = sum(e["R"] for e in active_edges if not e["hasFan"])
        if R_total <= 0:
            R_total = 1e-3

        curve_fans = [e for e in fans if e.get("fanMode", "constant") == "curve"]
        if curve_fans:
            # Диапазон Q: от qMin до min(qMax) по всем вентиляторам
            # (за min(qMax) суммарный напор обнуляется)
            q_lo = max(float(e.get("qMin", 1.0)) for e in curve_fans)
            q_hi_vals = []
            for fan_e in curve_fans:
                if fan_e.get("fanReverse") and fan_e.get("reverseH0") is not None:
                    q_hi_vals.append(float(fan_e.get("reverseQMax", fan_e.get("qMax", 90.0))))
                else:
                    q_hi_vals.append(float(fan_e.get("qMax", 90.0)))
            q_hi = min(q_hi_vals)  # ограничиваем самым узким вентилятором
            if q_lo >= q_hi:
                q_lo = q_hi * 0.1

            def f_total(q):
                h_sum = sum(fan_H(fe, q) for fe in curve_fans)
                return h_sum - R_total * q * q

            if f_total(q_lo) <= 0:
                return q_lo
            if f_total(q_hi) >= 0:
                # Весь диапазон H > R·Q² — возвращаем q_hi (максимальный расход)
                return q_hi
            for _ in range(60):
                q_mid = 0.5 * (q_lo + q_hi)
                if f_total(q_mid) > 0:
                    q_lo = q_mid
                else:
                    q_hi = q_mid
                if q_hi - q_lo < 0.01:
                    break
            return 0.5 * (q_lo + q_hi)

        # constant-вентилятор
        H_fan = sum(fan_H(e, 1.0) for e in fans)
        return math.sqrt(H_fan / R_total) if H_fan > 0 else 1.0

    # Начальное распределение через остовное дерево + BFS.
    # Все активные ветви получают Q удовлетворяющий 1-му закону Кирхгофа.
    # Хорды (замыкающие контуры) стартуют с Q=0 — метод Кросса их выравняет.
    q0 = bisect_q0()
    log.append(f"Q0={q0:.3f} м³/с")

    # ── Шаг 1: строим остовное дерево (Union-Find) ─────────────────────
    all_nodes_set = set()
    for e in active_edges:
        all_nodes_set.add(e["a"])
        all_nodes_set.add(e["b"])
    uf = {n: n for n in all_nodes_set}

    def uf_find(x):
        while uf[x] != x:
            uf[x] = uf[uf[x]]
            x = uf[x]
        return x

    def uf_union(x, y):
        px, py = uf_find(x), uf_find(y)
        if px == py:
            return False
        uf[px] = py
        return True

    # Вентиляторы — в дерево первыми (чтобы гарантировать их попадание в дерево)
    tree_ids = set()
    for e in sorted(active_edges, key=lambda e: 0 if e["hasFan"] else 1):
        if uf_union(e["a"], e["b"]):
            tree_ids.add(e["id"])
        # хорды оставляем Q=0

    # ── Шаг 2: BFS по дереву от вентилятора, пропагируем q0 ────────────
    # adj_tree: узел → [(global_edge_idx, сосед)]
    adj_tree = collections.defaultdict(list)
    for gi, e in enumerate(edges):
        if e["id"] in tree_ids:
            adj_tree[e["a"]].append((gi, e["b"]))
            adj_tree[e["b"]].append((gi, e["a"]))

    # Стартуем от узла «b» вентилятора — туда входит q0
    fan_tree = next((e for e in active_edges if e["hasFan"] and e["id"] in tree_ids), None)
    if fan_tree:
        gfi = next(gi for gi, e in enumerate(edges) if e["id"] == fan_tree["id"])
        Q[gfi] = q0

        # node_q[v] = расход, «входящий» в узел v со стороны уже обработанных рёбер
        node_q = {fan_tree["b"]: q0, fan_tree["a"]: -q0}
        visited = {fan_tree["a"], fan_tree["b"]}
        queue = collections.deque([fan_tree["b"]])

        while queue:
            node = queue.popleft()
            incoming = node_q.get(node, 0.0)
            # Незаполненные соседние рёбра дерева
            nxt = [(gi, nb) for gi, nb in adj_tree[node] if nb not in visited]
            if not nxt:
                continue
            # Делим входящий расход ПОРОВНУ между выходящими рёбрами
            q_each = incoming / len(nxt)
            for gi, nb in nxt:
                e = edges[gi]
                # Знак: ребро a→b; если node==a — ток a→b (положительный),
                # если node==b — ток b→a (отрицательный в глобальном соглашении)
                sign = +1 if e["a"] == node else -1
                Q[gi] = q_each * sign
                node_q[nb] = node_q.get(nb, 0.0) + q_each
                visited.add(nb)
                queue.append(nb)
    else:
        # нет вентилятора в дереве — просто q0 для всех активных (fallback)
        for i, e in enumerate(edges):
            if e["id"] not in dead_end_ids:
                Q[i] = q0

    # Пересчитываем индексы контуров из active_edges → edges
    # loops_active[i] = [(ai, sign), ...] где ai — индекс в active_edges
    # нужно преобразовать в [(gi, sign), ...] где gi — индекс в edges
    loops_global = []
    for loop in loops_active:
        global_loop = [(active_idx[ai], sign) for ai, sign in loop]
        loops_global.append(global_loop)

    # Основной цикл Кросса (только по активным контурам)
    max_dq = float("inf")
    it     = 0

    for it in range(1, max_iter + 1):
        max_dq = 0.0

        for loop in loops_global:
            # Невязка контура: ΔH = Σ(R·Q·|Q| - H_fan) по контуру
            sum_h   = 0.0  # Σ R·Q·|Q| - H_fan
            sum_2rq = 0.0  # Σ 2·R·|Q| + |dH/dQ|  (знаменатель)

            for gi, sign in loop:
                e  = edges[gi]
                qi = Q[gi] * sign  # расход в направлении обхода контура
                R  = e["R"]

                sum_h   += R * qi * abs(qi)
                sum_2rq += 2.0 * R * abs(qi)

                if e["hasFan"]:
                    H = fan_H(e, abs(Q[gi]))
                    sum_h   -= H * (1.0 if qi >= 0 else -1.0)
                    sum_2rq += fan_dH(e, abs(Q[gi]))

            if sum_2rq < 1e-12:
                continue

            dq = alpha * sum_h / sum_2rq
            # Ограничиваем поправку: не более 50% от текущего среднего Q в контуре,
            # чтобы не улетать за рабочий диапазон вентилятора при плохом начальном приближении
            q_avg = sum(abs(Q[gi]) for gi, _ in loop) / max(1, len(loop))
            if q_avg > 0:
                dq = max(-q_avg * 0.5, min(q_avg * 0.5, dq))
            max_dq = max(max_dq, abs(dq))

            for gi, sign in loop:
                Q[gi] -= dq * sign

        if max_dq < tol:
            it += 1
            break

    converged = max_dq < tol
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. ΔQ={max_dq:.4f} м³/с"})

    log.append(f"Итераций={it} ΔQ={max_dq:.4f} м³/с")
    print(f"Итераций={it} ΔQ={max_dq:.4f} converged={converged}")
    for i, e in enumerate(edges):
        log.append(f"[Q] {e['id']}: Q={Q[i]:.3f}")
        print(f"[Q] {e['id']}: Q={Q[i]:.3f} R={e['R']:.4f}{'  ВЕН[РЕВ]' if e.get('fanReverse') else '  ВЕН' if e['hasFan'] else ''}")

    Q_map = {e["id"]: Q[i] for i, e in enumerate(edges)}

    # Суммарная утечка через ветви-перемычки + проверка коэффициентов
    leakage_edges = [e for e in edges if e.get("isLeakage")]
    leakage_total = sum(abs(Q_map.get(e["id"], 0)) for e in leakage_edges)
    q_fan_total = sum(abs(Q_map.get(e["id"], 0)) for e in edges if e.get("hasFan") and not e.get("fanStopped"))

    if leakage_total > 0.1:
        k_ut = leakage_total / q_fan_total if q_fan_total > 0 else 0
        diag.append({"level": "info", "category": "branch_flow",
                     "message": f"Суммарная утечка через перемычки: {leakage_total:.1f} м³/с "
                                f"(k_ут = {k_ut:.2f} = {k_ut*100:.0f}% от Q вентилятора)"})
        # Проверка по заданным коэффициентам утечки
        for e in leakage_edges:
            coeff = float(e.get("leakageCoeff", 0) or 0)
            if coeff <= 0:
                continue
            q_actual = abs(Q_map.get(e["id"], 0))
            q_expected = coeff * q_fan_total
            if q_fan_total > 0 and abs(q_actual - q_expected) / max(q_expected, 0.1) > 0.3:
                diag.append({
                    "level": "warning",
                    "category": "branch_flow",
                    "message": f"Утечка «{e['id']}»: расчётная {q_actual:.1f} м³/с, "
                               f"ожидалось {q_expected:.1f} м³/с (k={coeff:.2f}). "
                               f"Проверьте сопротивление перемычки.",
                    "objectId": e["id"],
                    "value": q_actual,
                })

    # Диагностика тупиковых ветвей (уже определены выше как dead_end_ids)
    for e in edges:
        if e["id"] not in dead_end_ids:
            continue
        q_dead = abs(Q_map.get(e["id"], 0))
        diag.append({
            "level": "warning",
            "category": "branch_flow",
            "message": f"Тупик «{e['id']}»: Q=0 (нет замкнутого контура). "
                       f"Для проветривания установите ВМП с трубопроводом.",
            "objectId": e["id"],
            "value": 0.0,
        })

    # Проверка норматива реверса k_rev >= 0.6 (ПБ для шахтных вентиляционных сетей)
    check_reverse(edges, Q_map, normal_flows or {}, diag)

    return make_result(edges, Q_map, it, converged, max_dq, log, diag, dead_end_ids=dead_end_ids)


def find_dead_ends(edges):
    """
    Возвращает множество id тупиковых ветвей — т.е. ветвей, не участвующих
    ни в одном замкнутом пути от GND до GND.

    Алгоритм: ветвь НЕ тупиковая только если через неё проходит хотя бы
    один простой путь GND→...→GND (замкнутый контур через атмосферу).
    Все остальные ветви — тупиковые (Q=0 физически: воздух не может
    войти и выйти через тупик без источника/стока).

    Исключение: ветвь с ВМП (вентилятором местного проветривания) в тупике —
    НЕ тупиковая: ВМП нагнетает воздух по трубопроводу в тупик,
    обратный поток идёт по той же выработке (вентиляция с исходящей струёй).
    Такие ветви сохраняют ненулевой расход.

    ВАЖНО: определяется ИТЕРАТИВНО — многократное удаление листьев,
    пока не останутся только ветви с двусторонней связностью.
    Это правильно находит длинные тупиковые цепочки любой глубины.
    """
    # Строим множество «живых» рёбер — начинаем со всех
    # Узлы с ВМП (вентилятором местного проветривания) не удаляем
    vmp_nodes = set()
    for e in edges:
        if e["hasFan"]:
            vmp_nodes.add(e["a"])
            vmp_nodes.add(e["b"])

    # Рёбра, которые нельзя удалять:
    # - ВМП (вентилятор местного проветривания)
    # - вертикальные выработки (угол ≥ 75°): стволы, скважины — не тупики по физике
    VERTICAL_ANGLE_THRESHOLD = 75.0
    protected = set(
        e["id"] for e in edges
        if e["hasFan"] or e.get("angle", 0) >= VERTICAL_ANGLE_THRESHOLD
    )

    # Граф: узел → список индексов рёбер
    adj = collections.defaultdict(set)
    edge_by_id = {}
    for i, e in enumerate(edges):
        adj[e["a"]].add(i)
        adj[e["b"]].add(i)
        edge_by_id[i] = e

    active_edges = set(range(len(edges)))  # все активные рёбра
    dead_edges   = set()                   # итогово тупиковые

    # Итеративно удаляем «листья» — узлы со степенью 1 (не GND, не ВМП)
    changed = True
    while changed:
        changed = False
        # Пересчитываем степени только по активным рёбрам
        degree = collections.defaultdict(int)
        for i in active_edges:
            e = edges[i]
            degree[e["a"]] += 1
            degree[e["b"]] += 1

        # Ищем тупиковые узлы: степень 1, не GND
        dead_nodes = set()
        for node, deg in degree.items():
            if node != GND and deg == 1:
                dead_nodes.add(node)

        if not dead_nodes:
            break

        # Удаляем рёбра, инцидентные тупиковым узлам (кроме защищённых ВМП)
        # Итерируем по копии set, чтобы избежать изменения во время итерации
        to_remove = set()
        for i in list(active_edges):
            e = edges[i]
            if (e["a"] in dead_nodes or e["b"] in dead_nodes):
                if e["id"] not in protected:
                    to_remove.add(i)
                    changed = True

        for i in to_remove:
            active_edges.discard(i)
            dead_edges.add(edges[i]["id"])

    return dead_edges


def make_result(edges, Q, it, converged, max_res, log, diag, force_zero=False, dead_end_ids=None):
    # dead_end_ids передаётся из solve() (уже вычислено), иначе пересчитываем
    dead_ends = dead_end_ids if dead_end_ids is not None else find_dead_ends(edges)
    out = []
    for e in edges:
        is_dead = e["id"] in dead_ends
        q = Q.get(e["id"], 0.0)

        if is_dead:
            q = 0.0  # тупиковые выработки без ВМП — Q=0 всегда
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

        H    = e["R"] * q * abs(q)
        Hv   = fan_H(e, abs(q))
        area = e.get("area", 0.0)
        vel  = abs(q) / area if area > 0.01 else 0.0
        out.append({"id": e["id"], "Q": round(q, 4), "H": round(H, 3),
                    "Hfan": round(Hv, 3), "velocity": round(vel, 3),
                    "isDead": is_dead})

    # При реверсе:
    # - Сетевые ветви уже имеют Q < 0 (поток против fromId→toId) — правильно для фронта.
    # - Ребро вентилятора было развёрнуто в графе (a↔b), поэтому Q вентилятора
    #   положительное (направление a→b развёрнутого ребра).
    #   Физически это toId→fromId, т.е. тоже обратное направление — инвертируем
    #   только ребро вентилятора, чтобы фронт рисовал его стрелку тоже в реверсе.
    fan_rev_ids = {e["id"] for e in edges if e.get("fanReverse") and e.get("hasFan")}
    if fan_rev_ids and not force_zero:
        out = [dict(b, Q=-b["Q"]) if b["id"] in fan_rev_ids else b for b in out]

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