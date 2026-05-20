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
    except Exception:
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


def natural_draft_h(from_z, to_z, from_temp, to_temp):
    """
    Естественная тяга ветви (Па).
    H_nat = ρ_avg * g * (z_from - z_to)
    ρ_avg = 353 / (273 + T_avg)  — плотность воздуха по идеальному газу (кг/м³)
    Положительное значение — тяга направлена от from к to (вверх по выработке).
    """
    g = 9.81
    t_avg = 0.5 * (from_temp + to_temp)
    rho = 353.0 / (273.0 + max(-30.0, min(100.0, t_avg)))
    return rho * g * (from_z - to_z)


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
    tol      = float(options.get("tolerance", 0.01))
    max_iter = int(options.get("maxIter", 5000))
    alpha    = float(options.get("alpha", 1.0))  # релаксация

    log  = []
    diag = []

    edges, atm = build_graph(nodes_in, branches_in, surface_temp)

    # Диагностика: суммарная естественная тяга в сети
    nat_total = sum(abs(e.get("naturalDraft", 0.0)) for e in edges)
    if nat_total > 1.0:
        nat_max = max(edges, key=lambda e: abs(e.get("naturalDraft", 0.0)))
        log.append(
            f"Естественная тяга: T_пов={surface_temp:.1f}°C, "
            f"суммарная |H_nat|={nat_total:.1f} Па, "
            f"макс. ветвь «{nat_max['id']}» {nat_max.get('naturalDraft', 0.0):.1f} Па"
        )
    else:
        log.append("Естественная тяга: не учитывается (все Δz=0 или нет данных о высотах)")

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

    # Проверяем наличие естественной тяги — если есть Δz, расчёт без вентилятора возможен
    has_natural_draft = any(abs(e.get("naturalDraft", 0.0)) > 0.5 for e in edges)

    if not fans:
        if has_natural_draft:
            diag.append({"level": "info", "category": "fan",
                         "message": "Вентиляторов нет — расчёт ведётся только по естественной тяге (разность высот)"})
        else:
            diag.append({"level": "warning", "category": "topology",
                         "message": "Нет вентилятора и нет разности высот — расход нулевой"})
            return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, True, 0.0, log, diag, force_zero=True)
    elif not active_fans:
        if has_natural_draft:
            stopped_names = [e["id"] for e in fans if e.get("fanStopped")]
            diag.append({"level": "warning", "category": "fan",
                         "message": f"Вентиляторы остановлены ({', '.join(stopped_names)}) — "
                                    f"расчёт ведётся только по естественной тяге"})
        else:
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
        if H_fan > 0:
            return math.sqrt(H_fan / R_total)
        # Нет вентиляторов (или все остановлены) — начальный Q из естественной тяги
        H_nat_total = sum(abs(e.get("naturalDraft", 0.0)) for e in active_edges)
        if H_nat_total > 0 and R_total > 0:
            return math.sqrt(H_nat_total / R_total)
        return 1.0

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
            # Делим входящий расход пропорционально проводимости 1/R (лучшее начальное приближение)
            conductances = [1.0 / max(edges[gi]["R"], 1e-9) for gi, nb in nxt]
            total_cond = sum(conductances)
            for (gi, nb), cond in zip(nxt, conductances):
                q_each = incoming * cond / total_cond
                e = edges[gi]
                sign = +1 if e["a"] == node else -1
                Q[gi] = q_each * sign
                node_q[nb] = node_q.get(nb, 0.0) + abs(q_each)
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

    # Основной цикл Кросса — последовательное обновление по контурам (Зейдель)
    max_dq = float("inf")
    it     = 0

    for it in range(1, max_iter + 1):
        max_dq = 0.0

        for loop in loops_global:
            # Невязка контура: ΔH = Σ(R·Q·|Q| - H_fan - H_nat) по контуру
            sum_h   = 0.0
            sum_2rq = 0.0

            for gi, sign in loop:
                e  = edges[gi]
                qi = Q[gi] * sign
                R  = e["R"]

                sum_h   += R * qi * abs(qi)
                sum_2rq += 2.0 * R * abs(qi)

                if e["hasFan"]:
                    H = fan_H(e, abs(Q[gi]))
                    sum_h   -= H * (1.0 if qi >= 0 else -1.0)
                    sum_2rq += fan_dH(e, abs(Q[gi]))

                h_nat = e.get("naturalDraft", 0.0)
                if h_nat != 0.0:
                    sum_h -= h_nat * (1.0 if qi >= 0 else -1.0)

            if sum_2rq < 1e-12:
                continue

            dq = alpha * sum_h / sum_2rq
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
    relaxation = 0.5
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

    # Проверка реверса
    check_reverse(edges, Q_map, normal_flows or {}, diag)

    return make_result(edges, Q_map, it, converged, max_dh, log, diag, dead_end_ids=dead_end_ids)


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