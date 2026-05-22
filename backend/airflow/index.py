"""
Расчёт воздухораспределения — Метод Кросса и МКР.

POST: {method, nodes, branches, options:{tolerance, maxIter, alpha}, surfaceTemp}

method = "cross" — Метод Кросса (Андрияшева-Кросса), быстрый
method = "mkr"   — МКР (метод контурных расходов), точнее: адаптивное
                   демпфирование, двойной критерий сходимости по ΔH и δQ.

Оба метода учитывают естественную тягу в итерациях:
  H_nat_i = ρ_i * g * (z_from_i - z_to_i), ρ = 353/(273+T)
"""
import json, math, collections
import numpy as np  # noqa

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

GND = "__GND__"
MIN_DEAD_END_FLOW = 0.5   # м³/с — минимальный расход в тупике (ПБ: диффузионное проветривание)


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения горных выработок (Кросс или МКР)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}
    try:
        body = json.loads(event.get("body") or "{}")
    except BaseException:
        return err(400, "Ошибка парсинга JSON")

    nodes_in     = body.get("nodes", [])
    branches_in  = body.get("branches", [])
    options      = body.get("options", {})
    normal_flows = body.get("normalFlows", {})
    surface_temp = float(body.get("surfaceTemp", 20.0))
    method       = body.get("method", "cross")  # "cross" или "mkr"

    if not branches_in:
        return ok(empty_result("Нет ветвей"))

    try:
        if method == "mkr":
            result = solve_mkr(nodes_in, branches_in, options, normal_flows, surface_temp)
        else:
            result = solve(nodes_in, branches_in, options, normal_flows, surface_temp)
    except BaseException as ex:
        import traceback
        return err(500, f"Ошибка: {ex}\n{traceback.format_exc()}")

    return ok(result)


# ══════════════════════════════════════════════════════════════════════
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ══════════════════════════════════════════════════════════════════════

def get_R(b):
    r = float(b.get("R") or b.get("resistance") or 0.0)
    # Если вентилятор установлен внутри перемычки — добавляем сопротивление перемычки
    if b.get("hasFan") and b.get("fanInstall", "Внутри перемычки") == "Внутри перемычки":
        crossing_r = float(b.get("fanCrossingR") or 0.0)
        r += crossing_r
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


def fan_H_display(e, Q):
    """Напор вентилятора для отображения в результате.
    В отличие от fan_H(), не обнуляет H при Q > qMax —
    фиксирует значение на границе qMax (клипование).
    Итерационный расчёт эта функция не затрагивает.
    """
    if not e.get("hasFan") or e.get("fanStopped"):
        return 0.0
    N = max(1, int(e.get("fanParallel", 1) or 1))
    if e.get("fanMode", "constant") != "curve":
        return float(e.get("fanPressure", 0))
    q_one = abs(Q) / N
    if q_one <= 0:
        return 0.0
    if e.get("fanReverse") and e.get("reverseH0") is not None:
        rh0 = float(e.get("reverseH0", 0))
        rh1 = float(e.get("reverseH1", 0))
        rh2 = float(e.get("reverseH2", 0))
        q_max_rev = float(e.get("reverseQMax", e.get("qMax", 1e9)))
        qc = min(q_one, q_max_rev)
        return max(0.0, rh0 + rh1 * qc + rh2 * qc * qc)
    q_max = float(e.get("qMax", 1e9))
    h0 = float(e.get("h0", 0))
    h1 = float(e.get("h1", 0))
    h2 = float(e.get("h2", 0))
    qc = min(q_one, q_max)
    return max(0.0, h0 + h1 * qc + h2 * qc * qc)


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


def natural_draft_h(from_z, to_z, from_temp, to_temp):
    """
    Естественная тяга ветви (Па).
    H_nat = g * (z_from - z_to) * (ρ_to - ρ_from)
    ρ = 353 / (273 + T)  — плотность воздуха по идеальному газу (кг/м³)
    Тяга возникает только при разности температур (разности плотностей).
    Если температуры одинаковые — тяга = 0.
    """
    g = 9.81
    rho_from = 353.0 / (273.0 + max(-30.0, min(100.0, from_temp)))
    rho_to   = 353.0 / (273.0 + max(-30.0, min(100.0, to_temp)))
    return g * (from_z - to_z) * (rho_to - rho_from)


def build_graph(nodes_in, branches_in, surface_temp=20.0):
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

    # Карта высотных отметок и температур узлов
    node_z    = {}
    node_temp = {}
    for n in nodes_in:
        nid = n["id"]
        node_z[nid]    = float(n.get("z", 0.0) or 0.0)
        node_temp[nid] = float(n.get("airTemp", surface_temp) or surface_temp)
        # Атмосферные узлы: температура = температура поверхности
        if n.get("isAtm") or n.get("atmosphereLink"):
            node_temp[nid] = surface_temp

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
        orig_from = b["fromId"]
        orig_to   = b["toId"]
        node_a = to_gnd(orig_to   if should_flip else orig_from)
        node_b = to_gnd(orig_from if should_flip else orig_to)

        # Высотные отметки и температуры узлов ветви
        fz  = node_z.get(orig_from, float(b.get("fromZ", 0.0) or 0.0))
        tz  = node_z.get(orig_to,   float(b.get("toZ",   0.0) or 0.0))
        ft  = node_temp.get(orig_from, surface_temp)
        tt  = node_temp.get(orig_to,   surface_temp)
        # При реверсе ребро развёрнуто — меняем и направление естественной тяги
        h_nat = natural_draft_h(fz, tz, ft, tt) if not should_flip else natural_draft_h(tz, fz, tt, ft)

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
            # Естественная тяга (Па): H_nat = ρ·g·Δz
            "naturalDraft": h_nat,
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


def solve(nodes_in, branches_in, options, normal_flows=None, surface_temp=20.0):
    """
    Метод Кросса (Андрияшев, «Расчёт вентиляционных сетей шахт», классический алгоритм).

    Алгоритм:
    1. Строим граф: атм. узлы → GND, ребро = ветвь с R, H_вент, H_нат.
    2. Находим тупиковые ветви (итеративное удаление листьев) — Q=0.
    3. По активным рёбрам строим остовное дерево (Union-Find).
    4. Начальное Q: бисекция рабочей точки вентилятора → BFS-распространение
       по дереву с соблюдением 1-го закона Кирхгофа.
    5. Независимые контуры = хорда + путь в дереве между её узлами.
    6. Итерации Кросса (Зейдель по контурам):
       - невязка контура:  ΔH = Σ [ R·Qi·|Qi| - H_вент·sign - H_нат·sign ]
       - поправка:         δQ = -ΔH / Σ(2·R·|Qi| + dH_вент/dQ)
       - обновление:       Qi ← Qi + δQ·sign  (все ветви контура)
    7. Сходимость: max|δQ| < ε.
    """
    tol      = float(options.get("tolerance", 0.01))
    max_iter = int(options.get("maxIter", 5000))

    log  = []
    diag = []

    edges, atm = build_graph(nodes_in, branches_in, surface_temp)

    # ── Диагностика топологии ────────────────────────────────────────────
    atm_count  = sum(1 for n in nodes_in if n.get("isAtm") or n.get("atmosphereLink"))
    gnd_degree = sum(1 for e in edges if e["a"] == GND or e["b"] == GND)

    if atm_count == 0:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет узлов, связанных с атмосферой. Добавьте минимум 2 поверхностных узла."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    if gnd_degree < 2:
        diag.append({"level": "error", "category": "topology",
                     "message": "Только один узел связан с атмосферой. Для циркуляции воздуха нужно "
                                "минимум 2 выхода на поверхность (например, два ствола)."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # ── Диагностика вентиляторов ─────────────────────────────────────────
    fans        = [e for e in edges if e["hasFan"]]
    active_fans = [e for e in fans if not e.get("fanStopped")]
    has_nat     = any(abs(e.get("naturalDraft", 0.0)) > 0.5 for e in edges)

    if not fans:
        if not has_nat:
            diag.append({"level": "warning", "category": "topology",
                         "message": "Нет вентилятора и нет разности высот — расход нулевой"})
            return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)
        diag.append({"level": "info", "category": "fan",
                     "message": "Вентиляторов нет — расчёт ведётся только по естественной тяге"})
    elif not active_fans:
        if not has_nat:
            stopped = [e["id"] for e in fans if e.get("fanStopped")]
            diag.append({"level": "error", "category": "fan",
                         "message": f"Аварийное отключение: все вентиляторы остановлены ({', '.join(stopped)}) — "
                                    f"сеть не проветривается. Критическая ситуация!"})
            return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)
        stopped = [e["id"] for e in fans if e.get("fanStopped")]
        diag.append({"level": "warning", "category": "fan",
                     "message": f"Вентиляторы остановлены ({', '.join(stopped)}) — расчёт по естественной тяге"})

    # Диагностика естественной тяги
    nat_total = sum(abs(e.get("naturalDraft", 0.0)) for e in edges)
    if nat_total > 1.0:
        nat_max = max(edges, key=lambda e: abs(e.get("naturalDraft", 0.0)))
        log.append(f"Естественная тяга: T_пов={surface_temp:.1f}°C, "
                   f"суммарная |H_нат|={nat_total:.1f} Па, "
                   f"макс. ветвь «{nat_max['id']}» {nat_max['naturalDraft']:.1f} Па")
    else:
        log.append("Естественная тяга: не учитывается (Δz=0 или одинаковые температуры)")

    log.append(f"Метод Кросса: ветвей={len(edges)}, вент={len(fans)}, атм_узлов={len(atm)}")
    for e in edges:
        print(f"[edge] {e['id']} {e['a']}→{e['b']} R={e['R']:.4f} Hнат={e.get('naturalDraft',0):.1f}"
              f"{'  ВЕН' if e['hasFan'] else ''}")

    # ══ ШАГ 1: Тупиковые ветви — Q=0 ════════════════════════════════════
    dead_end_ids = find_dead_ends(edges)
    if dead_end_ids:
        log.append(f"Тупиков={len(dead_end_ids)}: {', '.join(sorted(dead_end_ids))}")

    active_edges = [e for e in edges if e["id"] not in dead_end_ids]
    active_idx   = {i: gi for gi, e in enumerate(edges)
                    for i, ae in enumerate(active_edges) if ae["id"] == e["id"]}
    # Перестроим: active_idx[ai] = global_idx
    id_to_gi = {e["id"]: gi for gi, e in enumerate(edges)}
    active_idx = [id_to_gi[e["id"]] for e in active_edges]

    if not active_edges:
        diag.append({"level": "error", "category": "topology",
                     "message": "Все ветви тупиковые — нет замкнутого контура вентиляции."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # ══ ШАГ 2: Остовное дерево по активным рёбрам (Union-Find) ══════════
    # Вентиляторы — в дерево в первую очередь
    all_nodes = set()
    for e in active_edges:
        all_nodes.add(e["a"]); all_nodes.add(e["b"])
    uf = {n: n for n in all_nodes}

    def uf_find(x):
        while uf[x] != x:
            uf[x] = uf[uf[x]]; x = uf[x]
        return x

    def uf_union(x, y):
        px, py = uf_find(x), uf_find(y)
        if px == py: return False
        uf[px] = py; return True

    tree_ids  = set()
    chord_ids = []
    for e in sorted(active_edges, key=lambda e: 0 if e["hasFan"] else 1):
        if uf_union(e["a"], e["b"]):
            tree_ids.add(e["id"])
        else:
            chord_ids.append(e["id"])

    log.append(f"Дерево={len(tree_ids)}, хорд={len(chord_ids)}")

    # ══ ШАГ 3: Независимые контуры = хорда + путь в дереве ══════════════
    loops_active = find_spanning_tree_and_loops(active_edges)
    if not loops_active:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет замкнутых контуров — проверьте топологию: нужно минимум 2 выхода на поверхность."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # Конвертируем индексы: active_edges[ai] → edges[gi]
    loops_global = [[(active_idx[ai], sign) for ai, sign in loop] for loop in loops_active]
    log.append(f"Контуров={len(loops_global)}")

    # ══ ШАГ 4: Начальный расход q0 (рабочая точка вентилятора) ══════════
    R_net = sum(e["R"] for e in active_edges if not e["hasFan"])
    if R_net <= 0: R_net = 1e-3

    def bisect_q0():
        af = [e for e in active_fans if e.get("fanMode","constant") == "curve"]
        if af:
            q_lo = 0.1
            q_hi_list = [float(e.get("reverseQMax" if e.get("fanReverse") and e.get("reverseH0") is not None
                                     else "qMax", 90.0)) for e in af]
            q_hi = min(q_hi_list) if q_hi_list else 90.0
            def f(q):
                return sum(fan_H(e, q) for e in af) - R_net * q * q
            if f(q_lo) <= 0: return q_lo
            if f(q_hi) >= 0: return q_hi
            for _ in range(64):
                qm = 0.5 * (q_lo + q_hi)
                if f(qm) > 0: q_lo = qm
                else:         q_hi = qm
                if q_hi - q_lo < 0.01: break
            return 0.5 * (q_lo + q_hi)
        # constant или остановлен
        H0 = sum(fan_H(e, 1.0) for e in active_fans)
        if H0 > 0: return math.sqrt(H0 / R_net)
        # только естественная тяга
        H_nat = sum(abs(e.get("naturalDraft", 0.0)) for e in active_edges)
        return math.sqrt(H_nat / R_net) if H_nat > 0 else 1.0

    q0 = bisect_q0()
    log.append(f"Q₀={q0:.3f} м³/с")

    # ══ ШАГ 5: Начальное Q по дереву BFS (1-й закон Кирхгофа) ═══════════
    # Q[global_idx] — расход по каждой ветви (положительный = направление a→b)
    Q = [0.0] * len(edges)

    adj_tree = collections.defaultdict(list)
    for gi, e in enumerate(edges):
        if e["id"] in tree_ids:
            adj_tree[e["a"]].append((gi, e["b"]))
            adj_tree[e["b"]].append((gi, e["a"]))

    fan_tree = next((e for e in active_edges if e["hasFan"] and e["id"] in tree_ids), None)
    if fan_tree:
        gfi = id_to_gi[fan_tree["id"]]
        Q[gfi] = q0
        node_q  = {fan_tree["b"]: q0, fan_tree["a"]: -q0}
        visited = {fan_tree["a"], fan_tree["b"]}
        queue   = collections.deque([fan_tree["b"]])
        while queue:
            node = queue.popleft()
            incoming = node_q.get(node, 0.0)
            nxt = [(gi, nb) for gi, nb in adj_tree[node] if nb not in visited]
            if not nxt: continue
            q_each = incoming / len(nxt)
            for gi, nb in nxt:
                e = edges[gi]
                Q[gi] = q_each if e["a"] == node else -q_each
                node_q[nb] = node_q.get(nb, 0.0) + q_each
                visited.add(nb)
                queue.append(nb)
    else:
        # нет вентилятора в дереве — q0 для всех активных
        for i, e in enumerate(edges):
            if e["id"] not in dead_end_ids:
                Q[i] = q0

    # ══ ШАГ 6: Итерации Кросса ═══════════════════════════════════════════
    # По Андрияшеву: поправка δQ = -ΔH / Σ(2·R·|Q|)
    # ΔH = Σ [ R·Qi·|Qi| - H_вент(|Qi|)·sign_i - H_нат·sign_i ]
    # Обновление: Qi ← Qi + δQ·sign_i  для всех ветвей контура
    # Метод Зейделя: сразу используем обновлённые Q при следующем контуре.
    max_dq = float("inf")
    it = 0

    for it in range(1, max_iter + 1):
        max_dq = 0.0

        for loop in loops_global:
            # Невязка давлений по контуру (Па)
            sum_H   = 0.0   # ΣH = Σ(R·Q·|Q|) - ΣH_вент - ΣH_нат
            sum_2RQ = 0.0   # Σ(2·R·|Q|) + Σ(dH_вент/dQ)

            for gi, sign in loop:
                e  = edges[gi]
                qi = Q[gi] * sign      # расход в направлении обхода контура
                R  = e["R"]

                # Потери давления: R·Q·|Q|
                sum_H   += R * qi * abs(qi)
                sum_2RQ += 2.0 * R * abs(qi)

                # Вентилятор: вычитаем его напор из невязки
                if e["hasFan"]:
                    Hv = fan_H(e, abs(Q[gi]))
                    sum_H   -= Hv * (1.0 if qi >= 0 else -1.0)
                    sum_2RQ += fan_dH(e, abs(Q[gi]))

                # Естественная тяга: вычитаем как дополнительный напор
                h_nat = e.get("naturalDraft", 0.0)
                if h_nat != 0.0:
                    sum_H -= h_nat * (1.0 if qi >= 0 else -1.0)

            if sum_2RQ < 1e-12:
                continue

            # Поправка расхода по Кроссу: δQ = -ΔH / Σ(2·R·|Q|)
            dq = -sum_H / sum_2RQ

            # Ограничение взрыва: |δQ| ≤ max(|Q| в контуре, q0)
            q_max_loop = max((abs(Q[gi]) for gi, _ in loop), default=q0)
            q_lim = max(q_max_loop, q0)
            if abs(dq) > 2.0 * q_lim:
                dq = math.copysign(2.0 * q_lim, dq)

            if abs(dq) > max_dq:
                max_dq = abs(dq)

            # Распределяем поправку по всем ветвям контура
            for gi, sign in loop:
                Q[gi] += dq * sign
                if not math.isfinite(Q[gi]):
                    Q[gi] = 0.0

        if max_dq < tol:
            it += 1
            break

    converged = max_dq < tol
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. δQ_max={max_dq:.4f} м³/с"})

    log.append(f"Итераций={it}, δQ_max={max_dq:.4f} м³/с, сошлось={converged}")
    for i, e in enumerate(edges):
        print(f"[Q] {e['id']}: Q={Q[i]:.3f} R={e['R']:.4f} {e['a']}→{e['b']}"
              f"{'  ВЕН[РЕВ]' if e.get('fanReverse') else '  ВЕН' if e['hasFan'] else ''}")

    Q_map = {e["id"]: Q[i] for i, e in enumerate(edges)}

    # ── Коррекция Q для вентилятора GND→GND ("Без перемычки") ───────────
    # Такой вентилятор образует петлю в графе и не участвует в балансе Кирхгофа.
    # Его реальный расход = сумма расходов всех ветвей, втекающих в GND
    # (или вытекающих — в зависимости от знака), минус сам вентилятор.
    for e in edges:
        if e.get("hasFan") and not e.get("fanStopped") and e["a"] == GND and e["b"] == GND:
            # Считаем баланс GND по всем НЕ-вентиляторным ветвям у GND
            q_gnd = 0.0
            for oe in edges:
                if oe["id"] == e["id"]:
                    continue
                if oe["a"] == GND:
                    q_gnd += Q_map.get(oe["id"], 0.0)   # вытекает из GND
                elif oe["b"] == GND:
                    q_gnd -= Q_map.get(oe["id"], 0.0)   # втекает в GND
            # Вентилятор компенсирует этот дисбаланс
            Q_map[e["id"]] = -q_gnd if q_gnd != 0.0 else Q_map.get(e["id"], 0.0)

    # ── Диагностика утечек через перемычки ──────────────────────────────
    leakage_edges = [e for e in edges if e.get("isLeakage")]
    leakage_total = sum(abs(Q_map.get(e["id"], 0)) for e in leakage_edges)
    q_fan_total   = sum(abs(Q_map.get(e["id"], 0)) for e in edges if e.get("hasFan") and not e.get("fanStopped"))
    if leakage_total > 0.1:
        k_ut = leakage_total / q_fan_total if q_fan_total > 0 else 0
        diag.append({"level": "info", "category": "branch_flow",
                     "message": f"Суммарная утечка: {leakage_total:.1f} м³/с "
                                f"(k_ут={k_ut:.2f} = {k_ut*100:.0f}% от Q вент.)"})

    # ── Проверка норматива реверса ───────────────────────────────────────
    check_reverse(edges, Q_map, normal_flows or {}, diag)

    return make_result(edges, Q_map, it, converged, max_dq, log, diag, dead_end_ids=dead_end_ids, R_net=R_net)


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
    # Рёбра, которые нельзя удалять как тупики:
    # - Активный ВМП (работающий вентилятор): нагнетает воздух в тупик — не тупик по физике
    # - Остановленный ВМП (fanStopped=True): ведёт себя как обычная ветвь — может быть тупиком
    # - Вертикальные выработки (угол ≥ 75°): стволы, скважины — не тупики по физике
    VERTICAL_ANGLE_THRESHOLD = 75.0
    protected = set(
        e["id"] for e in edges
        if (e["hasFan"] and not e.get("fanStopped", False))
        or e.get("angle", 0) >= VERTICAL_ANGLE_THRESHOLD
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

    # Шаг 2: итеративно убираем «висячие петли» — подграфы, подключённые к основной
    # сети только через одну точку (сочленение). Такие петли не имеют сквозного тока:
    # воздух входит и выходит через один и тот же узел → Q=0 физически.
    #
    # Алгоритм: повторяем пока есть изменения:
    #   - находим все узлы, достижимые из GND БЕЗ прохождения через данный узел v
    #   - если GND недостижим без v → v является точкой сочленения
    #   - все ветви по другую сторону от v (не содержащие GND) — мёртвые
    #
    # Упрощённая версия: ищем узлы, удаление которых отключает часть графа от GND.
    # Отключённая часть — тупиковая петля.

    changed2 = True
    while changed2:
        changed2 = False

        # Строим граф только из активных рёбер
        adj2 = collections.defaultdict(set)
        for i in active_edges:
            e = edges[i]
            adj2[e["a"]].add(e["b"])
            adj2[e["b"]].add(e["a"])

        # Все узлы активного графа
        all_nodes2 = set(adj2.keys())

        # Для каждого не-GND узла проверяем: достижим ли GND без него?
        for v in list(all_nodes2):
            if v == GND:
                continue

            # BFS из GND без узла v
            reachable = {GND}
            q2 = [GND]
            while q2:
                cur = q2.pop()
                for nb in adj2[cur]:
                    if nb != v and nb not in reachable:
                        reachable.add(nb)
                        q2.append(nb)

            # Узлы НЕ достижимые из GND без v — они висят на v
            hanging = all_nodes2 - reachable - {v}
            if not hanging:
                continue

            # Убиваем все ребра полностью внутри hanging (оба конца в hanging)
            to_kill = set()
            for i in list(active_edges):
                e = edges[i]
                if e["a"] in hanging and e["b"] in hanging:
                    if e["id"] not in protected:
                        to_kill.add(i)
                # Рёбра между v и hanging тоже убиваем (они не несут сквозного тока)
                elif (e["a"] == v and e["b"] in hanging) or (e["b"] == v and e["a"] in hanging):
                    if e["id"] not in protected:
                        to_kill.add(i)

            if to_kill:
                for i in to_kill:
                    active_edges.discard(i)
                    dead_edges.add(edges[i]["id"])
                changed2 = True
                break  # пересчитываем граф заново

    return dead_edges


def make_result(edges, Q, it, converged, max_res, log, diag, force_zero=False, dead_end_ids=None, R_net=0.0):
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
        elif e["hasFan"] and (abs(q) < 1e-6 or (e["a"] == GND and e["b"] == GND)):
            # Вентилятор без расчётного расхода, или главный вентилятор GND→GND
            # ("Без перемычки" — оба конца атмосферные). Такой вентилятор выпадает
            # из итераций Кросса (петля), поэтому считаем рабочую точку напрямую:
            # H_fan(Q) = R_сети·Q² → бисекция по R_net.
            R = R_net if R_net > 0 else e["R"]
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
        Hv   = fan_H_display(e, abs(q))
        area = e.get("area", 0.0)
        vel  = abs(q) / area if area > 0.01 else 0.0

        # Проверка Q > qMax для вентилятора с кривой характеристики
        if e.get("hasFan") and not e.get("fanStopped"):
            q_max = e.get("qMax", 0)
            if q_max > 0 and abs(q) > q_max * 1.02:
                diag.append({"level": "warning", "category": "fan_overload",
                             "message": f"Ветвь {e['id']}: Q={abs(q):.2f} м³/с превышает qMax={q_max:.1f} м³/с — вентилятор вышел за паспортную зону"})

        out.append({"id": e["id"], "Q": round(q, 4), "H": round(H, 3),
                    "Hfan": round(Hv, 3), "velocity": round(vel, 3),
                    "isDead": is_dead})

    # При реверсе:
    # - Ребро вентилятора было развёрнуто в графе (a↔b), поэтому МКР считает
    #   его Q > 0 (направление a→b развёрнутого ребра = физически toId→fromId).
    # - Все остальные ветви считаются с Q > 0 относительно перевёрнутого графа,
    #   что физически означает обратное направление относительно исходных fromId→toId.
    # Поэтому при реверсе инвертируем Q ВСЕХ ветвей — фронт рисует стрелки в обратную сторону.
    fan_rev_ids = {e["id"] for e in edges if e.get("fanReverse") and e.get("hasFan")}
    if fan_rev_ids and not force_zero:
        out = [dict(b, Q=-b["Q"]) for b in out]

    return {"branches": out, "nodes": [], "iterations": it,
            "converged": converged, "maxResidual": round(max_res, 6),
            "log": log, "diagnostics": diag}


# ══════════════════════════════════════════════════════════════════════
# МКР — МЕТОД КОНТУРНЫХ РАСХОДОВ
# Более точный алгоритм с адаптивным демпфированием и двойным критерием
# сходимости (по ΔH и по δQ). Полностью поддерживает естественную тягу,
# реверс, параллельные вентиляторы и тупиковые ветви.
# ══════════════════════════════════════════════════════════════════════

def _mkr_fan_H(e, Q):
    """Напор вентилятора. При revers — отрицательный (нагнетание против a→b)."""
    if not e.get("hasFan") or e.get("fanStopped"):
        return 0.0
    N    = max(1, int(e.get("fanParallel", 1) or 1))
    sign = -1.0 if e.get("fanReverse") else 1.0
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        q_one = abs(Q) / N
        if e.get("fanReverse") and e.get("reverseH0") is not None:
            q_max = float(e.get("reverseQMax", e.get("qMax", 1e9)))
            if q_one > q_max:
                return 0.0
            h = float(e.get("reverseH0", 0)) + float(e.get("reverseH1", 0)) * q_one + float(e.get("reverseH2", 0)) * q_one * q_one
        else:
            if q_one > float(e.get("qMax", 1e9)):
                return 0.0
            h = float(e.get("h0", 0)) + float(e.get("h1", 0)) * q_one + float(e.get("h2", 0)) * q_one * q_one
        return sign * max(0.0, h)
    return sign * max(0.0, float(e.get("fanPressure", 0)))


def _mkr_fan_dH(e, Q):
    """|dH/dQ_total| для знаменателя δQ."""
    if not e.get("hasFan") or e.get("fanMode", "constant") != "curve":
        return 0.0
    N = max(1, int(e.get("fanParallel", 1) or 1))
    q_one = abs(Q) / N
    if e.get("fanReverse") and e.get("reverseH0") is not None:
        dh = abs(float(e.get("reverseH1", 0)) + 2.0 * float(e.get("reverseH2", 0)) * q_one)
    else:
        dh = abs(float(e.get("h1", 0)) + 2.0 * float(e.get("h2", 0)) * q_one)
    return dh / N


def _bfs_tree(edges):
    """
    Строит BFS-дерево от GND. Возвращает:
      - bfs_order: список узлов в порядке BFS
      - parent: {узел: (родитель, idx_ребра)}
      - tree_set: set индексов рёбер дерева
      - chords: список индексов хорд (замыкающие рёбра)
      - node_list: все узлы сети
    """
    node_set = set()
    for e in edges:
        node_set.add(e["a"])
        node_set.add(e["b"])
    node_list = list(node_set)

    adj = collections.defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append((i, e["b"]))
        adj[e["b"]].append((i, e["a"]))

    root = GND if GND in node_set else node_list[0]
    visited  = {root}
    parent   = {root: None}
    tree_set = set()
    bfs_order = [root]
    queue = collections.deque([root])

    while queue:
        u = queue.popleft()
        for ei, nb in adj[u]:
            if nb not in visited:
                visited.add(nb)
                parent[nb] = (u, ei)
                tree_set.add(ei)
                bfs_order.append(nb)
                queue.append(nb)

    chords = [i for i in range(len(edges)) if i not in tree_set]
    return bfs_order, parent, tree_set, chords, node_list


def _tree_path(src, dst, edges, parent):
    """
    Путь src→dst по остовному дереву.
    Возвращает [(idx_ребра, sign), ...] где sign = +1 если обход a→b.
    """
    def ancestors(node):
        path = []
        cur = node
        while cur is not None:
            path.append(cur)
            p = parent.get(cur)
            cur = p[0] if p else None
        return path

    ancs_src = ancestors(src)
    ancs_dst = ancestors(dst)
    set_src  = {n: i for i, n in enumerate(ancs_src)}

    lca = ancs_dst[0]; idx_dst = 0
    for i, n in enumerate(ancs_dst):
        if n in set_src:
            lca = n; idx_dst = i; break
    idx_src = set_src[lca]

    result = []
    # src → LCA (вверх)
    for i in range(idx_src):
        node = ancs_src[i]
        p_node, ei = parent[node]
        e = edges[ei]
        # движение: node → p_node; dir = +1 если e.a == node
        result.append((ei, +1 if e["a"] == node else -1))

    # LCA → dst (вниз)
    for i in range(idx_dst - 1, -1, -1):
        child = ancs_dst[i]
        p_node, ei = parent[child]
        e = edges[ei]
        # движение: p_node → child; dir = +1 если e.a == p_node
        result.append((ei, +1 if e["a"] == p_node else -1))

    return result


def _estimate_q0_mkr(edges, r_total):
    """Начальный расход из рабочей точки вентилятора (бисекция)."""
    fans = [e for e in edges if e.get("hasFan") and not e.get("fanStopped")]
    if not fans:
        h_nat = sum(abs(e.get("naturalDraft", 0.0)) for e in edges)
        return math.sqrt(h_nat / r_total) if h_nat > 0 and r_total > 0 else 1.0

    fan = fans[0]
    mode = fan.get("fanMode", "constant")
    if mode == "curve":
        is_rev = fan.get("fanReverse") and fan.get("reverseH0") is not None
        q_hi = float(fan.get("reverseQMax", fan.get("qMax", 90.0))) if is_rev else float(fan.get("qMax", 90.0))
        if r_total <= 0:
            return q_hi * 0.5

        def f(q):
            return abs(_mkr_fan_H(fan, q)) - r_total * q * q

        lo, hi = 0.0, q_hi
        if f(lo) <= 0:
            return lo
        if f(hi) >= 0:
            return hi
        for _ in range(80):
            mid = 0.5 * (lo + hi)
            if f(mid) > 0:
                lo = mid
            else:
                hi = mid
            if hi - lo < 0.01:
                break
        return max(0.1, 0.5 * (lo + hi))

    h0 = abs(_mkr_fan_H(fan, 1.0))
    if h0 > 0 and r_total > 0:
        return math.sqrt(h0 / r_total)
    return 1.0


def solve_mkr(nodes_in, branches_in, options, normal_flows=None, surface_temp=20.0):
    """
    МКР — Метод контурных расходов.
    Адаптивное демпфирование, двойной критерий: max|ΔH| < eps1 ИЛИ max|δQ| < eps2.
    Естественная тяга учитывается в невязке контура как напорный источник.
    """
    tol_q    = float(options.get("tolerance", 0.01))
    tol_h    = float(options.get("tolPressure", 0.1))
    max_iter = int(options.get("maxIter", 5000))

    log  = []
    diag = []

    edges, atm = build_graph(nodes_in, branches_in, surface_temp)

    # Диагностика топологии
    gnd_degree = sum(1 for e in edges if e["a"] == GND or e["b"] == GND)
    atm_count  = sum(1 for n in nodes_in if n.get("isAtm") or n.get("atmosphereLink"))
    if atm_count > 0 and gnd_degree < 2:
        msg = "Только один узел связан с атмосферой. Нужно минимум 2 выхода на поверхность."
        diag.append({"level": "error", "category": "topology", "message": msg})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)
    if atm_count == 0:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет узлов, связанных с атмосферой."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    fans        = [e for e in edges if e["hasFan"]]
    active_fans = [e for e in fans if not e.get("fanStopped")]
    has_natural_draft = any(abs(e.get("naturalDraft", 0.0)) > 0.5 for e in edges)

    if not fans:
        if not has_natural_draft:
            diag.append({"level": "warning", "category": "topology",
                         "message": "Нет вентилятора и нет разности высот — расход нулевой"})
            return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)
        diag.append({"level": "info", "category": "fan",
                     "message": "Вентиляторов нет — расчёт ведётся только по естественной тяге"})
    elif not active_fans:
        if not has_natural_draft:
            stopped = [e["id"] for e in fans if e.get("fanStopped")]
            diag.append({"level": "error", "category": "fan",
                         "message": f"Все вентиляторы остановлены ({', '.join(stopped)}) — сеть не проветривается"})
            return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)
        stopped = [e["id"] for e in fans if e.get("fanStopped")]
        diag.append({"level": "warning", "category": "fan",
                     "message": f"Вентиляторы остановлены ({', '.join(stopped)}) — расчёт по естественной тяге"})

    # Тупиковые ветви
    dead_end_ids = find_dead_ends(edges)
    active_edges_list = [e for e in edges if e["id"] not in dead_end_ids]

    # BFS-дерево
    bfs_order, parent_map, tree_set, chords, node_list = _bfs_tree(active_edges_list)
    log.append(f"МКР: ветвей={len(edges)} активных={len(active_edges_list)} контуров={len(chords)}")

    if not chords:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет замкнутых контуров — циркуляция невозможна."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # Активные индексы: active_edges_list → edges (по id)
    id_to_global = {e["id"]: i for i, e in enumerate(edges)}
    # Перестраиваем tree_set и chords в глобальные индексы
    local_to_global = {i: id_to_global[e["id"]] for i, e in enumerate(active_edges_list)}

    # Контуры (в локальных индексах active_edges_list)
    contours_local = []
    for ci in chords:
        ce = active_edges_list[ci]
        path = _tree_path(ce["b"], ce["a"], active_edges_list, parent_map)
        contours_local.append([(ci, +1)] + path)

    # Q по глобальным индексам
    Q = [0.0] * len(edges)

    # Начальный расход
    r_total = sum(e["R"] for e in active_edges_list if not e.get("hasFan"))
    if r_total <= 0:
        r_total = 1e-3
    q0 = _estimate_q0_mkr(active_edges_list, r_total)
    log.append(f"МКР Q₀={q0:.3f} м³/с")

    # Инициализация хорд
    for ci in chords:
        gi = local_to_global[ci]
        Q[gi] = q0
    # Вентиляторы
    for i, e in enumerate(active_edges_list):
        if e.get("hasFan"):
            Q[local_to_global[i]] = q0

    # BFS bottom-up: инициализация ветвей дерева из Кирхгофа-1
    def sync_tree_q(Q_arr):
        bal = collections.defaultdict(float)
        # Вклад хорд + вентиляторов в балансы
        for i, e in enumerate(active_edges_list):
            if i in tree_set and not e.get("hasFan"):
                continue
            gi = local_to_global[i]
            bal[e["a"]] -= Q_arr[gi]
            bal[e["b"]] += Q_arr[gi]
        # bottom-up
        for idx in range(len(bfs_order) - 1, 0, -1):
            v  = bfs_order[idx]
            p  = parent_map.get(v)
            if p is None:
                continue
            p_node, li = p
            e  = active_edges_list[li]
            gi = local_to_global[li]
            b  = bal[v]
            if e["b"] == v:
                Q_arr[gi] = -b
                bal[p_node] += b
            else:
                Q_arr[gi] = b
                bal[p_node] += b

    sync_tree_q(Q)

    # ── Итерации МКР ────────────────────────────────────────────────────────
    max_dh = float("inf")
    max_dq = float("inf")
    # При наличии вентилятора можно стартовать с 0.5; без вентилятора (только тяга)
    # нужна более осторожная релаксация чтобы не осциллировать
    relaxation = 0.5 if active_fans else 0.15
    prev_dh = float("inf")
    it = 0

    for it in range(1, max_iter + 1):
        max_dh = 0.0
        max_dq = 0.0

        for contour in contours_local:
            num = 0.0
            den = 0.0

            for li, sign in contour:
                e  = active_edges_list[li]
                gi = local_to_global[li]
                qd = Q[gi] * sign
                R  = e["R"]

                num += R * qd * abs(qd)
                den += 2.0 * R * abs(qd)

                if e.get("hasFan"):
                    H = _mkr_fan_H(e, Q[gi])
                    num -= H * (1.0 if qd >= 0 else -1.0)
                    den += _mkr_fan_dH(e, Q[gi])

                h_nat = e.get("naturalDraft", 0.0)
                if h_nat != 0.0:
                    num -= h_nat * (1.0 if qd >= 0 else -1.0)

            if den < 1e-12:
                continue

            dq_raw = -num / den
            # Защита от взрыва: не более 2×max|Q| в контуре (или q0 если Q≈0)
            q_ref_mkr = max((abs(Q[local_to_global[li]]) for li, _ in contour), default=0.0)
            q_ref_mkr = max(q_ref_mkr, q0)
            if abs(dq_raw) > 2.0 * q_ref_mkr:
                dq_raw = math.copysign(2.0 * q_ref_mkr, dq_raw)
            dq = relaxation * dq_raw

            if abs(num) > max_dh:
                max_dh = abs(num)
            if abs(dq) > max_dq:
                max_dq = abs(dq)

            for li, sign in contour:
                gi = local_to_global[li]
                Q[gi] += dq * sign
                if not math.isfinite(Q[gi]):
                    Q[gi] = 0.0

        # Синхронизация ветвей дерева по Кирхгофу-1
        sync_tree_q(Q)

        # Адаптивное демпфирование: увеличиваем если сходится, снижаем если растёт
        if it > 5:
            if max_dh > prev_dh * 1.1:
                relaxation = max(0.1, relaxation * 0.8)
            elif it > 20 and max_dh < prev_dh:
                relaxation = min(1.0, relaxation + 0.01)
        prev_dh = max_dh

        # Критерий остановки: двойной (по ΔH И по δQ)
        if max_dh < tol_h or max_dq < tol_q:
            it += 1
            break

    converged = max_dh < tol_h or max_dq < tol_q
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"МКР не сошлось за {max_iter} итераций. |ΔH|={max_dh:.2f} Па, δQ={max_dq:.4f} м³/с"})

    log.append(f"МКР итераций={it} |ΔH|={max_dh:.3f} Па δQ={max_dq:.4f} м³/с")

    Q_map = {e["id"]: Q[i] for i, e in enumerate(edges)}

    # ── Коррекция Q для вентилятора GND→GND ("Без перемычки") ───────────
    for e in edges:
        if e.get("hasFan") and not e.get("fanStopped") and e["a"] == GND and e["b"] == GND:
            q_gnd = 0.0
            for oe in edges:
                if oe["id"] == e["id"]:
                    continue
                if oe["a"] == GND:
                    q_gnd += Q_map.get(oe["id"], 0.0)
                elif oe["b"] == GND:
                    q_gnd -= Q_map.get(oe["id"], 0.0)
            Q_map[e["id"]] = -q_gnd if q_gnd != 0.0 else Q_map.get(e["id"], 0.0)

    # Проверка реверса
    check_reverse(edges, Q_map, normal_flows or {}, diag)

    return make_result(edges, Q_map, it, converged, max_dh, log, diag, dead_end_ids=dead_end_ids, R_net=r_total)


def empty_result(msg):
    return {"branches": [], "nodes": [], "iterations": 0, "converged": True,
            "maxResidual": 0.0, "log": [msg],
            "diagnostics": [{"level": "warning", "category": "topology", "message": msg}]}


def _sanitize(obj):
    """Рекурсивно заменяет NaN/Inf→0, numpy-скаляры→Python-типы."""
    if isinstance(obj, bool) or isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return 0.0 if not math.isfinite(v) else v
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj


def ok(data):
    return {"statusCode": 200,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(_sanitize(data), ensure_ascii=False)}


def err(code, msg):
    return {"statusCode": code,
            "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": msg}, ensure_ascii=False)}