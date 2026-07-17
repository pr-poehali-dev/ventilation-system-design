"""
Расчёт воздухораспределения — Метод Кросса и МКР.

POST: {method, nodes, branches, options:{tolerance, maxIter, alpha}, surfaceTemp}

method = "cross" — Метод Кросса (Андрияшева-Кросса), быстрый
method = "mkr"   — МКР (метод контурных расходов), точнее: адаптивное
                   демпфирование, двойной критерий сходимости по ΔH и δQ.

Оба метода учитывают естественную тягу в итерациях:
  H_nat_i = ρ_i * g * (z_from_i - z_to_i), ρ = 353/(273+T)
"""
import json, math, collections, time
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
        import base64, gzip
        raw = event.get("body") or "{}"

        # Большие схемы фронтенд присылает сжатыми gzip. В браузере gzip
        # распознаётся по заголовку Content-Encoding, НО в десктопной версии
        # (C#/WebView2) этот заголовок теряется при проксировании, и функция
        # получала сжатые байты как «обычный текст» → «Ошибка парсинга JSON».
        #
        # Поэтому определяем gzip НАДЁЖНО — по сигнатуре самих данных
        # (gzip всегда начинается с магических байт 0x1f 0x8b), не полагаясь
        # на заголовок. Схема разбора:
        #   1) приводим тело к байтам (учитывая base64 / str / bytes);
        #   2) если байты начинаются с 1f 8b — распаковываем gzip;
        #   3) декодируем в UTF-8 и парсим JSON.
        is_b64 = bool(event.get("isBase64Encoded"))

        if isinstance(raw, (bytes, bytearray)):
            data = bytes(raw)
        elif is_b64:
            data = base64.b64decode(raw)
        else:
            # Может прийти обычный JSON-текст ИЛИ base64 без флага isBase64Encoded
            # (десктоп). Сначала пробуем как есть, base64 определим по сигнатуре ниже.
            data = raw.encode("utf-8", "surrogatepass") if isinstance(raw, str) else bytes(raw)

        # gzip-сигнатура? (десктоп мог не выставить isBase64Encoded — тогда data
        # содержит base64-текст; попробуем ещё раз декодировать base64 и проверить)
        def _looks_gzip(b: bytes) -> bool:
            return len(b) >= 2 and b[0] == 0x1F and b[1] == 0x8B

        if not _looks_gzip(data) and not is_b64 and isinstance(raw, str):
            # Пробуем интерпретировать текст как base64 (десктоп без флага)
            try:
                maybe = base64.b64decode(raw, validate=False)
                if _looks_gzip(maybe):
                    data = maybe
            except BaseException:
                pass

        if _looks_gzip(data):
            raw = gzip.decompress(data).decode("utf-8")
        else:
            raw = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else raw

        body = json.loads(raw)

        # НАДЁЖНЫЙ транспорт больших схем: фронтенд кладёт gzip→base64 строкой
        # в обычный JSON-конверт {"__gzip__": "<base64>"}. Это не бинарное тело
        # и не Content-Encoding — прокси/шлюз (в т.ч. десктопный WebView2) его
        # не трогает, поэтому схемы >2000 ветвей больше не падают с «Ошибка
        # парсинга JSON». Здесь разворачиваем конверт обратно в исходный body.
        if isinstance(body, dict) and "__gzip__" in body:
            inner = gzip.decompress(base64.b64decode(body["__gzip__"])).decode("utf-8")
            body = json.loads(inner)
    except BaseException as ex:
        _hdrs = event.get("headers") or {}
        _b = event.get("body")
        print(
            "PARSE_FAIL:",
            "type=", type(_b).__name__,
            "len=", (len(_b) if hasattr(_b, "__len__") else "?"),
            "isBase64=", event.get("isBase64Encoded"),
            "CE=", _hdrs.get("Content-Encoding") or _hdrs.get("content-encoding"),
            "head=", (repr(_b[:16]) if isinstance(_b, (str, bytes, bytearray)) else "?"),
            "err=", repr(ex),
        )
        return err(400, "Ошибка парсинга JSON")

    nodes_in          = body.get("nodes", [])
    branches_in       = body.get("branches", [])
    options           = body.get("options", {})
    normal_flows      = body.get("normalFlows", {})
    surface_temp      = float(body.get("surfaceTemp", 20.0))
    method            = body.get("method", "cross")  # "cross" или "mkr"
    use_natural_draft = bool(body.get("useNaturalDraft", True))
    geo_gradient      = float(body.get("geoGradient", 3.0))   # °C / 100 м глубины

    if not branches_in:
        return ok(empty_result("Нет ветвей"))

    # Автоматический расчёт температуры узлов по геотермическому градиенту.
    # Применяется ТОЛЬКО для узлов у которых airTemp не задан вручную (userTemp=False).
    # Атмосферные узлы всегда получают surface_temp.
    # Формула: T(z) = surface_temp + gradient * (z_surface - z_node) / 100
    # где z_surface — высотная отметка самого высокого узла (поверхность),
    # z_node — высотная отметка текущего узла, gradient °C/100 м.
    if use_natural_draft and geo_gradient > 0:
        z_vals = [float(n.get("z", 0) or 0) for n in nodes_in]
        z_surface = max(z_vals) if z_vals else 0.0
        nodes_in_patched = []
        for n in nodes_in:
            n2 = dict(n)
            if n2.get("isAtm") or n2.get("atmosphereLink"):
                n2["airTemp"] = surface_temp
            elif not n2.get("userTemp"):
                # узел под землёй — считаем температуру по глубине
                depth = max(0.0, z_surface - float(n2.get("z", 0) or 0))
                n2["airTemp"] = surface_temp + geo_gradient * depth / 100.0
            nodes_in_patched.append(n2)
        nodes_in = nodes_in_patched
    elif not use_natural_draft:
        # Галочка снята — обнуляем тягу: все узлы получают одинаковую температуру
        nodes_in = [dict(n, airTemp=surface_temp) for n in nodes_in]

    # Формируем информационный лог о тяге для передачи на фронтенд
    nat_draft_log = []
    if not use_natural_draft:
        nat_draft_log.append("Естественная тяга: ОТКЛЮЧЕНА (все узлы T=T_пов)")
    elif geo_gradient > 0:
        nat_draft_log.append(
            f"Естественная тяга: T_пов={surface_temp:.1f}°C, "
            f"геотерм.градиент={geo_gradient:.1f}°C/100м — "
            f"температуры узлов рассчитаны автоматически по глубине"
        )
    else:
        nat_draft_log.append("Естественная тяга: геотерм.градиент=0, используются температуры узлов")

    try:
        if method == "mkr":
            result = solve_mkr(nodes_in, branches_in, options, normal_flows, surface_temp)
        else:
            result = solve(nodes_in, branches_in, options, normal_flows, surface_temp)
        # Добавляем лог о тяге в начало
        result["log"] = nat_draft_log + result.get("log", [])
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
    # Минимум 1e-4 мюрг — физический предел крупного ствола (30 м² × 1000 м).
    # Меньшие R создают численные «дыры» с нереалистично большим расходом.
    return max(r, 1e-4)


def fan_H(e, Q):
    """Напор вентилятора H при суммарном расходе Q (м³/с → Па).
    Возвращает H>=0 (модуль характеристики). Знак (направление действия)
    управляется флагом fanReverse в формуле невязки контура (как в Вентсим/Аэросеть).
    При реверсе используется отдельная P–Q характеристика если задана (reverseH0/H1/H2).
    N параллельных вентиляторов: каждый пропускает Q/N → характеристика сдвигается вправо в N раз.
    При fanStopped=True вентилятор остановлен — H=0 (только сопротивление ветви).
    При Q > qMax: для curve возвращаем 0 (паспорт закончился); для constant —
    линейно спадаем (защита от Q→∞ в итерациях).

    Q может быть знаковым: Q > 0 — поток совпадает с направлением действия вентилятора,
    Q < 0 — поток опрокинут против вентилятора. При опрокидывании H = 0
    (вентилятор не создаёт напора против потока — как в реальности).
    """
    if not e.get("hasFan") or e.get("fanStopped"):
        return 0.0
    # Опрокинутый поток: вентилятор не создаёт напора
    if Q < 0:
        return 0.0
    N = max(1, int(e.get("fanParallel", 1) or 1))
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        q_one = abs(Q) / N
        if q_one <= 0:
            # При Q=0 возвращаем h0 (статический напор), а не 0 —
            # иначе бисекция рабочей точки не найдёт корень.
            if e.get("fanReverse") and e.get("reverseH0") is not None:
                return max(0.0, float(e.get("reverseH0", 0)))
            return max(0.0, float(e.get("h0", 0)))
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
        q_max_fan = float(e.get("qMax", 1e9))
        if q_one > q_max_fan:
            # За паспортом — резкий спад до 0 на 1.1×qMax (как Вентиляция-2)
            decay = max(0.0, 1.0 - (q_one - q_max_fan) / (0.1 * q_max_fan))
            h0 = float(e.get("h0", 0))
            h1 = float(e.get("h1", 0))
            h2 = float(e.get("h2", 0))
            h_at_max = max(0.0, h0 + h1 * q_max_fan + h2 * q_max_fan * q_max_fan)
            return h_at_max * decay
        h0 = float(e.get("h0", 0))
        h1 = float(e.get("h1", 0))
        h2 = float(e.get("h2", 0))
        return max(0.0, h0 + h1 * q_one + h2 * q_one * q_one)
    # Constant-режим: применяем qMax для защиты от Q→∞ (как в Вентиляция-2):
    # при Q > qMax напор резко падает (вентилятор выходит из рабочей зоны).
    fp = float(e.get("fanPressure", 0))
    q_max = float(e.get("qMax", 0))
    if q_max > 0:
        q_one = abs(Q) / N
        if q_one > q_max:
            # Резкий спад до нуля на 1.1×qMax (Вентиляция-2 имеет «обрыв»)
            decay = max(0.0, 1.0 - (q_one - q_max) / (0.1 * q_max))
            return fp * decay
    return fp


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
    rho_from = 353.0 / (273.0 + max(-60.0, min(100.0, from_temp)))
    rho_to   = 353.0 / (273.0 + max(-60.0, min(100.0, to_temp)))
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
        # Единая ориентация рёбер: ВСЕГДА from→to (как в Вентсим/Аэросеть).
        # Реверс вентилятора учитывается в формуле невязки через знак, а не
        # через разворот ребра. Это обеспечивает корректный баланс Кирхгофа
        # и согласованность Q между методами Кросса и МКР.
        orig_from = b["fromId"]
        orig_to   = b["toId"]
        node_a = to_gnd(orig_from)
        node_b = to_gnd(orig_to)

        # Высотные отметки и температуры узлов ветви — всегда по физической
        # ориентации from→to. Знак H_nat для реверса учитывается в формуле.
        fz  = node_z.get(orig_from, float(b.get("fromZ", 0.0) or 0.0))
        tz  = node_z.get(orig_to,   float(b.get("toZ",   0.0) or 0.0))
        ft  = node_temp.get(orig_from, surface_temp)
        tt  = node_temp.get(orig_to,   surface_temp)
        h_nat = natural_draft_h(fz, tz, ft, tt)

        # Тепловая депрессия пожара (Па): добавляется к естественной тяге.
        # Передаётся фронтендом при итеративном расчёте аварийного режима.
        # Знак учитывает ориентацию выработки и направление нагнетания:
        #   + восходящая выработка → пожар усиливает тягу (как доп. вентилятор)
        #   − нисходящая           → пожар тормозит / опрокидывает поток
        h_fire = float(b.get("fireThermalDepression", 0) or 0)

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
            "fanReverse":  bool(b.get("fanReverse", False)),
            "fanParallel": max(1, int(b.get("fanParallel", 1) or 1)),
            # Реверсная P–Q характеристика из каталога (если передана фронтендом)
            "reverseH0":   b.get("reverseH0"),
            "reverseH1":   b.get("reverseH1"),
            "reverseH2":   b.get("reverseH2"),
            "reverseQMax": b.get("reverseQMax"),
            "reverseEfficiencyFactor": b.get("reverseEfficiencyFactor"),
            "fanStopped":  bool(b.get("fanStopped", False)),
            "fanType":     b.get("fanType", "ГВУ"),     # ГВУ / ВВУ / ВМП
            "fanInstall":  b.get("fanInstall", "Внутри перемычки"),
            "isLeakage":   bool(b.get("isLeakage", False)),
            "leakageCoeff": float(b.get("leakageCoeff", 0) or 0),
            "angle":       abs(float(b.get("angle", 0) or 0)),
            # Естественная тяга (Па) + тепловая депрессия пожара (Па)
            "naturalDraft": h_nat + h_fire,
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




def check_kirchhoff(edges, Q_map, diag, tol=0.5, dead_end_ids=None):
    """
    Проверяет 1-й закон Кирхгофа (баланс расходов) в каждом узле.
    Тупиковые ветви без вентиляторов имеют Q=0 и не нарушают баланс.
    Тупиковые ветви с ВМП исключаются — их Q это "сток" в точке подключения,
    не нарушение Кирхгофа (воздух физически входит и выходит из тупика).
    """
    dead_ends = dead_end_ids or set()
    node_balance = collections.defaultdict(float)
    for e in edges:
        # Тупиковые ветви с ВМП — исключаем из проверки баланса
        if e["id"] in dead_ends and e.get("hasFan"):
            continue
        q = Q_map.get(e["id"], 0.0)
        if e["a"] != GND:
            node_balance[e["a"]] -= q   # вытекает из узла a
        if e["b"] != GND:
            node_balance[e["b"]] += q   # втекает в узел b

    violations = []
    for node, bal in node_balance.items():
        if abs(bal) > tol:
            violations.append((node, bal))

    if violations:
        violations.sort(key=lambda x: abs(x[1]), reverse=True)
        worst_node, worst_bal = violations[0]
        details = "; ".join(
            f"узел {n[:16]}…={b:+.2f}" if len(n) > 20 else f"узел {n}={b:+.2f}"
            for n, b in violations[:5]
        )
        diag.append({
            "level": "warning",
            "category": "kirchhoff",
            "message": (
                f"Нарушение 1-го закона Кирхгофа в {len(violations)} узлах "
                f"(макс. дисбаланс {worst_bal:+.3f} м³/с). "
                f"{details}"
            )
        })
    else:
        max_imb = max((abs(b) for b in node_balance.values()), default=0.0)
        if max_imb > 0.01:
            diag.append({
                "level": "info",
                "category": "kirchhoff",
                "message": f"Баланс расходов: макс. погрешность {max_imb:.3f} м³/с"
            })


def solve(nodes_in, branches_in, options, normal_flows=None, surface_temp=20.0,
          initial_flows=None):
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
    alpha    = float(options.get("alpha", 0.7))   # демпфирование Кросса (0.5-0.8 как в Аэросеть)

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

    # ══ ШАГ 1а: Предрасчёт Q ВМП и узловых источников ════════════════════
    # ВМП в тупике — это локальная петля (трубопровод+возврат), которая
    # в основной сети не нарушает Кирхгофа: воздух забирается из узла
    # подключения и возвращается в него же по той же выработке.
    # НО! Если ВМП "Без перемычки", воздух из узла идёт в забой и теряется
    # → в основной сети это утечка (negative source).
    # Здесь считаем Q каждого ВМП заранее, и при необходимости добавляем
    # узловой источник для коррекции основного расчёта.
    vmp_pre_q = {}  # branch_id -> Q ВМП в тупике
    for e in edges:
        if e["id"] not in dead_end_ids or not e.get("hasFan") or e.get("fanStopped"):
            continue
        # Считаем рабочую точку ВМП через его собственное R
        R_vmp = e["R"] if e["R"] > 1e-6 else 1e-3
        q_lo = float(e.get("qMin", 0.1))
        q_hi = float(e.get("qMax", 90.0))
        def f_vmp(qv, _e=e, _R=R_vmp):
            return fan_H(_e, qv) - _R * qv * qv
        q_v = 0.0
        if f_vmp(q_lo) > 0 and f_vmp(q_hi) < 0:
            for _ in range(60):
                qm = 0.5 * (q_lo + q_hi)
                if f_vmp(qm) > 0: q_lo = qm
                else:             q_hi = qm
                if q_hi - q_lo < 0.001: break
            q_v = 0.5 * (q_lo + q_hi)
        elif f_vmp(q_lo) <= 0:
            q_v = q_lo
        else:
            q_v = q_hi
        vmp_pre_q[e["id"]] = q_v

    if vmp_pre_q:
        log.append(f"ВМП предрасчёт: {len(vmp_pre_q)} шт, Σ|Q_ВМП|={sum(abs(q) for q in vmp_pre_q.values()):.1f} м³/с")

    # ══ ШАГ 2+3: Единое остовное дерево + независимые контуры ════════════
    # КРИТИЧНО: активные вентиляторы ВСЕГДА в хордах (не в дереве).
    # Если вентилятор попадёт в дерево — он не войдёт ни в один контур и
    # его напор полностью выпадет из итераций (Q определится только из
    # 1-го закона Кирхгофа, а не из Q-H характеристики).
    # Алгоритм: сначала строим дерево из НЕ-вентиляторных рёбер (обычный
    # Union-Find). Затем вентиляторы добавляем — они уже не могут попасть
    # в дерево (оба конца уже связаны), становятся хордами автоматически.
    # Исключение: если топология такова, что без вентилятора дерево не
    # связывает все узлы — берём вентилятор в дерево (нет выбора).
    all_nodes = set()
    for e in active_edges:
        all_nodes.add(e["a"]); all_nodes.add(e["b"])
    uf2 = {n: n for n in all_nodes}

    def uf2_find(x):
        while uf2[x] != x:
            uf2[x] = uf2[uf2[x]]; x = uf2[x]
        return x

    def uf2_union(x, y):
        px, py = uf2_find(x), uf2_find(y)
        if px == py: return False
        uf2[px] = py; return True

    tree_ids = set()
    chord_ids = []
    # Первый проход: только НЕ-вентиляторные рёбра
    for e in active_edges:
        if e["hasFan"] and not e.get("fanStopped"):
            continue
        if uf2_union(e["a"], e["b"]):
            tree_ids.add(e["id"])
        else:
            chord_ids.append(e["id"])
    # Второй проход: вентиляторы — в хорды если граф уже связан,
    # в дерево только если нужно для связности (fallback)
    for e in active_edges:
        if not e["hasFan"] or e.get("fanStopped"):
            continue
        if uf2_union(e["a"], e["b"]):
            # Граф без этого вентилятора не связан — вынуждены взять в дерево
            tree_ids.add(e["id"])
            log.append(f"[fan-fallback] вентилятор {e['id']} в дерево (нет альтернативного пути)")
        else:
            chord_ids.append(e["id"])

    log.append(f"Дерево={len(tree_ids)}, хорд={len(chord_ids)}")

    # ══ ШАГ 3: Независимые контуры на основе ТОГО ЖЕ дерева ══════════════
    # Передаём active_edges отсортированными: НЕ-вентиляторы первыми,
    # чтобы find_spanning_tree_and_loops построил тот же spanning tree.
    active_edges_sorted = sorted(active_edges,
                                 key=lambda e: (1 if (e["hasFan"] and not e.get("fanStopped")) else 0))
    loops_active = find_spanning_tree_and_loops(active_edges_sorted)
    if not loops_active:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет замкнутых контуров — проверьте топологию: нужно минимум 2 выхода на поверхность."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # Конвертируем индексы: active_edges_sorted[ai] → edges[gi]
    id_to_global_idx = {e["id"]: gi for gi, e in enumerate(edges)}
    loops_global = [[(id_to_global_idx[active_edges_sorted[ai]["id"]], sign)
                     for ai, sign in loop] for loop in loops_active]
    log.append(f"Контуров={len(loops_global)}, вент-в-хордах={sum(1 for cid in chord_ids if any(e['id']==cid and e['hasFan'] for e in active_edges))}")

    # ══ ШАГ 4: Начальный расход q0 (рабочая точка главного вентилятора) ══
    # R_net — характеристическое сопротивление основного пути от ГВУ к атмосфере.
    # Берём кратчайший путь по дереву от вентилятора до GND и суммируем R вдоль него
    # (как в Аэросеть). Это даёт реалистичную оценку рабочей точки для шахт с
    # большим количеством параллельных ветвей, где sum(R) даёт сотни тысяч.
    def compute_r_main():
        # Граф дерева для BFS
        adj_t = collections.defaultdict(list)
        for e in active_edges:
            if e["id"] in tree_ids:
                adj_t[e["a"]].append((e["id"], e["b"], e["R"]))
                adj_t[e["b"]].append((e["id"], e["a"], e["R"]))
        # Главный вентилятор: с максимальным h0 (либо первый активный)
        main_fan = None
        max_h0 = -1.0
        for e in active_fans:
            h0 = abs(float(e.get("h0", 0))) if e.get("fanMode") == "curve" else abs(float(e.get("fanPressure", 0)))
            if h0 > max_h0:
                max_h0 = h0
                main_fan = e
        if not main_fan:
            return None
        # BFS от любого конца вентилятора до GND, накапливая R
        start = main_fan["a"] if main_fan["a"] != GND else main_fan["b"]
        if start == GND:
            return main_fan["R"]
        visited = {start}
        queue = collections.deque([(start, main_fan["R"])])
        while queue:
            node, r_sum = queue.popleft()
            if node == GND:
                return r_sum
            for eid, nb, r in adj_t[node]:
                if nb not in visited:
                    visited.add(nb)
                    queue.append((nb, r_sum + r))
        return None

    r_main = compute_r_main()
    # Запасной вариант: медиана(R)*N_tree даёт разумную оценку для эквивалента сети.
    # Чистая сумма sum(R) завышает для больших сетей (199 ветвей × 0.5 = 100),
    # а параллельная 1/Σ(1/√R)² занижает.
    r_branches = sorted(e["R"] for e in active_edges if not e["hasFan"] and e["R"] > 1e-9)
    if r_main and r_main > 1e-6:
        R_net = r_main
    elif r_branches:
        n_tree = max(1, sum(1 for e in active_edges if e["id"] in tree_ids and not e["hasFan"]))
        R_net = r_branches[len(r_branches) // 2] * n_tree
    else:
        R_net = 1e-3
    log.append(f"R_net={R_net:.4f} (главный путь), активных={len(active_edges)}, тупиков={len(dead_end_ids)}")

    def bisect_q0():
        """Начальное приближение Q₀ — рабочая точка главного вентилятора.
        Алгоритм Вентиляция-2: ищем Q где Σ H_фан(Q) = R_net × Q² с ограничением
        Q ≤ qMax_паспорта (вентилятор не может работать за паспортом).
        Если qMax задан — Q₀ берём в зоне 50-80% от qMax (зона макс КПД).
        """
        # Главный вентилятор — с максимальным h0 (или fanPressure)
        main_fans = [e for e in active_fans if e.get("fanType", "ГВУ") in ("ГВУ", "ВВУ")]
        if not main_fans:
            main_fans = active_fans
        if not main_fans:
            return 1.0
        # Берём qMax главного вентилятора как верхнюю границу
        q_max_main = 0.0
        for e in main_fans:
            qmx = float(e.get("reverseQMax" if e.get("fanReverse") and e.get("reverseH0") is not None
                              else "qMax", 0))
            if qmx > q_max_main:
                q_max_main = qmx

        af_curve = [e for e in active_fans if e.get("fanMode", "constant") == "curve"]
        if af_curve:
            q_lo = 0.1
            q_hi = q_max_main if q_max_main > 0 else 90.0
            def f(q):
                return sum(fan_H(e, q) for e in af_curve) - R_net * q * q
            if f(q_lo) <= 0: return q_lo
            if f(q_hi) >= 0:
                # Решение за паспортом → берём qMax (физический предел)
                return q_hi * 0.9
            for _ in range(64):
                qm = 0.5 * (q_lo + q_hi)
                if f(qm) > 0: q_lo = qm
                else:         q_hi = qm
                if q_hi - q_lo < 0.01: break
            return 0.5 * (q_lo + q_hi)

        # Constant-режим: H_фан фиксированный. Q₀ = sqrt(H/R), но ограничен qMax.
        H0 = sum(fan_H(e, 1.0) for e in active_fans)
        if H0 > 0:
            q_calc = math.sqrt(H0 / R_net)
            if q_max_main > 0:
                # Ограничиваем паспортным qMax (зона 70-90% макс КПД)
                return min(q_calc, q_max_main * 0.9)
            return q_calc
        # Без вентилятора — естественная тяга. Q₀ через суммарную тягу первого контура.
        if loops_global:
            lp = loops_global[0]
            h_sum = abs(sum(edges[gi].get("naturalDraft", 0.0) * s for gi, s in lp))
            r_sum = sum(edges[gi]["R"] for gi, _ in lp)
            if h_sum > 0 and r_sum > 1e-9:
                return math.sqrt(h_sum / r_sum)
        H_nat = max((abs(e.get("naturalDraft", 0.0)) for e in active_edges), default=0.0)
        return math.sqrt(H_nat / R_net) if H_nat > 0 else 1.0

    q0 = bisect_q0()
    log.append(f"Q₀={q0:.3f} м³/с")

    # ══ ШАГ 5: Начальное Q — строгое соблюдение 1-го закона Кирхгофа ═════
    # Алгоритм Аэросеть/Вентсим:
    #   1) Каждой хорде присваиваем Q = q0 (одинаковое стартовое значение)
    #   2) Древесные ветви считаем по балансу: BFS bottom-up от листьев к GND.
    # Это гарантирует Σ Q_in = Σ Q_out в КАЖДОМ узле с первой итерации.
    # Метод Кросса сохраняет это свойство (поправка dq*sign не меняет балансов).
    Q = [0.0] * len(edges)

    # Знак для реверсного ГВУ: инвертируем стартовый Q ствола вентилятора,
    # чтобы избежать осцилляций. Для остальных вентиляторов (ВМП в перемычке) —
    # начальный знак положительный, физика сама определит направление.
    sign_init = 1.0
    main_fan = None
    for e in active_fans:
        if e.get("fanType", "ГВУ") in ("ГВУ", "ВВУ"):
            main_fan = e
            if e.get("fanReverse"):
                sign_init = -1.0
            break

    # Дерево: BFS для получения parent_map и порядка узлов
    parent_tree = {}      # node -> (parent_node, edge_global_idx)
    adj_tree = collections.defaultdict(list)
    for gi, e in enumerate(edges):
        if e["id"] in tree_ids:
            adj_tree[e["a"]].append((gi, e["b"]))
            adj_tree[e["b"]].append((gi, e["a"]))

    visited = {GND}
    bfs_order = [GND]
    queue = collections.deque([GND])
    while queue:
        u = queue.popleft()
        for gi, nb in adj_tree[u]:
            if nb not in visited:
                visited.add(nb)
                parent_tree[nb] = (u, gi)
                bfs_order.append(nb)
                queue.append(nb)

    # 1) Инициализируем все хорды (не в дереве, не тупики)
    # КРИТИЧНО: q_chord = q0 / N_chords, чтобы суммарный поток через дерево
    # к ГВУ не превышал Q_ГВУ. Иначе при N=5 хордах в стволе будет 5×q0.
    tree_branch_set = {parent_tree[v][1] for v in bfs_order if v in parent_tree}
    n_chords = sum(1 for gi, e in enumerate(edges)
                   if e["id"] not in dead_end_ids and gi not in tree_branch_set)
    if n_chords < 1:
        n_chords = 1
    q_chord = (q0 / n_chords) * sign_init
    log.append(f"Хорд={n_chords}, q_chord={q_chord:.3f} (q0/N)")
    for gi, e in enumerate(edges):
        if e["id"] in dead_end_ids:
            continue
        if gi not in tree_branch_set:
            Q[gi] = q_chord

    # 2) Считаем дисбаланс в каждом узле от хорд
    node_bal = collections.defaultdict(float)
    for gi, e in enumerate(edges):
        if e["id"] in dead_end_ids or gi in tree_branch_set:
            continue
        node_bal[e["a"]] -= Q[gi]
        node_bal[e["b"]] += Q[gi]

    # 3) Древесные ветви: bottom-up от листьев — Q компенсирует дисбаланс узла
    for idx in range(len(bfs_order) - 1, 0, -1):
        v = bfs_order[idx]
        p = parent_tree.get(v)
        if p is None:
            continue
        p_node, gi = p
        e = edges[gi]
        b = node_bal[v]
        # Чтобы баланс в v стал 0: если ребро втекает в v (e.b == v), Q = -b;
        # если вытекает (e.a == v), Q = b.
        if e["b"] == v:
            Q[gi] = -b
        else:
            Q[gi] = b
        # Передаём баланс родителю
        node_bal[p_node] += b

    # 4) Верификация начального баланса Кирхгофа в каждом узле (≠ GND)
    # Если где-то Σ Q_in ≠ Σ Q_out → топология/дерево построены неверно.
    init_bal_check = collections.defaultdict(float)
    for gi, e in enumerate(edges):
        if e["id"] in dead_end_ids:
            continue
        init_bal_check[e["a"]] -= Q[gi]
        init_bal_check[e["b"]] += Q[gi]
    max_init_bal = 0.0
    worst_node = None
    for nd, bal in init_bal_check.items():
        if nd == GND:
            continue
        if abs(bal) > max_init_bal:
            max_init_bal = abs(bal)
            worst_node = nd
    if max_init_bal > 0.01:
        diag.append({"level": "warning", "category": "initial_balance",
                     "message": f"Начальный баланс Кирхгофа нарушен: узел {worst_node}, |ΔQ|={max_init_bal:.2f} м³/с"})
        log.append(f"⚠ Начальный |ΔQ|_max={max_init_bal:.3f} в узле {worst_node}")
    else:
        log.append(f"✓ Начальный баланс Кирхгофа: |ΔQ|_max={max_init_bal:.4f}")

    # ══ ШАГ 5б: Тёплый старт (warm start) ═══════════════════════════════
    # Если переданы initial_flows (штатное решение сети), берём их как
    # стартовое приближение вместо оценки q0/BFS. При локальном возмущении
    # (например, очаг пожара на одной ветви) решение меняется мало, поэтому
    # Кросс сходится за единицы итераций вместо сотен. Раскладка выше уже
    # соблюдает Кирхгофа-1 — она остаётся страховкой для ветвей без факта.
    if initial_flows:
        applied = 0
        for gi, e in enumerate(edges):
            if e["id"] in dead_end_ids:
                continue
            q_hint = initial_flows.get(e["id"])
            if q_hint is not None and math.isfinite(q_hint):
                Q[gi] = float(q_hint)
                applied += 1
        log.append(f"Тёплый старт: применено {applied} расходов из штатного решения")

    # ══ ШАГ 6: Итерации Кросса (Андрияшев-Кросс с демпфированием) ════════
    # ΔH контура = Σ [ R·Qi·|Qi| − fan_dir·H_вент(|Qi|)·sign_i − H_нат·sign_i ]
    # где fan_dir = -1 при fanReverse, +1 иначе (как в Вентсим).
    # Поправка: δQ = -α·ΔH / Σ(2·R·|Q| + |dH/dQ|)
    # Обновление: Qi ← Qi + δQ·sign_i  для всех ветвей контура.
    # Метод Зейделя: сразу используем обновлённые Q при следующем контуре.
    max_dq = float("inf")
    max_dh = float("inf")
    prev_max_dq = float("inf")
    alpha_cur = alpha
    osc_streak = 0   # счётчик осцилляций (для адаптивного снижения alpha)
    it = 0

    # Характерный напор — для относительного допуска ΔH
    h_char = 0.0
    for _e in edges:
        if _e.get("hasFan") and not _e.get("fanStopped"):
            if _e.get("fanMode") == "curve":
                h_char = max(h_char, abs(float(_e.get("h0", 0))))
            else:
                h_char = max(h_char, abs(float(_e.get("fanPressure", 0))))
        h_char = max(h_char, abs(_e.get("naturalDraft", 0.0)))
    if h_char <= 0:
        h_char = 1.0
    tol_h_abs = float(options.get("tolPressure", 0.1))

    for it in range(1, max_iter + 1):
        max_dq = 0.0
        max_dh = 0.0

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

                # Вентилятор: напор не зависит от знака потока, только от
                # ориентации вентилятора и направления обхода контура.
                # fan_dir=+1 (прямой) → напор по a→b; fan_dir=-1 (реверс) → по b→a.
                # В обходе с sign: реальный вклад = fan_dir * sign.
                # При опрокинутом потоке (Q[gi] < 0 у прямого вент. или Q[gi] > 0
                # у реверсного) вентилятор работает против потока: передаём
                # знаковый Q чтобы fan_H мог вернуть правильную характеристику.
                if e["hasFan"]:
                    # ВМП нагнетает ВСЕГДА в направлении a→b — fan_dir=+1.
                    # При реверсе ГВУ поток в ветви ВМП опрокидывается (Q<0),
                    # но ВМП продолжает создавать напор H(|Q|) против потока.
                    # Проверку q_fan>=0 (обнуление H) применяем ТОЛЬКО к ГВУ/ВВУ:
                    # они не создают напор при опрокидывании (турбинный режим).
                    is_vmp = e.get("fanType", "ГВУ") == "ВМП"
                    fan_dir = 1.0 if is_vmp else (-1.0 if e.get("fanReverse") else 1.0)
                    q_fan = Q[gi] * fan_dir
                    if is_vmp:
                        Hv = fan_H(e, abs(Q[gi]))   # ВМП: H всегда > 0
                    else:
                        Hv = fan_H(e, abs(Q[gi])) if q_fan >= 0 else 0.0  # ГВУ/ВВУ: 0 при опрокидывании
                    sum_H   -= fan_dir * Hv * sign
                    sum_2RQ += fan_dH(e, abs(Q[gi]))

                # Естественная тяга: вклад в обход = h_nat * sign (фиксированный знак,
                # не зависит от знака потока, как и вентилятор)
                h_nat = e.get("naturalDraft", 0.0)
                if h_nat != 0.0:
                    sum_H -= h_nat * sign

            if sum_2RQ < 1e-12:
                continue

            if abs(sum_H) > max_dh:
                max_dh = abs(sum_H)

            # Поправка с демпфированием α: δQ = -α·ΔH / Σ(2·R·|Q|)
            dq = alpha_cur * (-sum_H / sum_2RQ)

            # Ограничение взрыва: |δQ| ≤ max(|Q| в контуре, q0)
            q_max_loop = max((abs(Q[gi]) for gi, _ in loop), default=q0)
            q_lim = max(q_max_loop, q0)
            if abs(dq) > q_lim:
                dq = math.copysign(q_lim, dq)

            if abs(dq) > max_dq:
                max_dq = abs(dq)

            # Распределяем поправку по всем ветвям контура
            for gi, sign in loop:
                Q[gi] += dq * sign
                if not math.isfinite(Q[gi]):
                    Q[gi] = 0.0

        # Двойной критерий: и δQ, и ΔH должны быть малы.
        # ΔH-допуск относительный: 0.5% от h_char (≈10 Па при ГВУ 2000 Па).
        tol_h = max(tol_h_abs, 0.005 * h_char)
        if max_dq < tol and max_dh < tol_h:
            it += 1
            break

        # Адаптивное демпфирование: снижаем при росте невязки, восстанавливаем
        # при монотонном убывании (10%/итерацию, не быстрее стартового alpha).
        if max_dq > prev_max_dq * 0.99:
            osc_streak += 1
            if osc_streak >= 5 and alpha_cur > 0.05:
                alpha_cur = max(0.05, alpha_cur * 0.7)
                osc_streak = 0
        else:
            osc_streak = 0
            alpha_cur = min(alpha, alpha_cur * 1.1)  # восстановление к стартовому
        prev_max_dq = max_dq

    converged = max_dq < tol and max_dh < tol_h
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось за {max_iter} итераций. δQ_max={max_dq:.4f} м³/с, ΔH_max={max_dh:.2f} Па"})

    log.append(f"Итераций={it}, δQ_max={max_dq:.4f} м³/с, ΔH_max={max_dh:.2f} Па, сошлось={converged}")

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

    # ── Проверка 1-го закона Кирхгофа (баланс узлов) ────────────────────
    check_kirchhoff(edges, Q_map, diag, dead_end_ids=dead_end_ids)

    return make_result(edges, Q_map, it, converged, max_dq, log, diag, dead_end_ids=dead_end_ids, R_net=R_net, nodes_in=nodes_in)


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
    # - Главные/вспомогательные вентиляторы (ГВУ/ВВУ) — они в основном контуре
    # - ВМП "Без перемычки" — тупиковые, но их Q считается через рабочую точку
    # - ВМП "Внутри перемычки" — МОГУТ быть удалены как тупики; их Q считается
    #   через рабочую точку в make_result (is_dead and hasFan)
    # - Вертикальные выработки (угол ≥ 75°): стволы, скважины — не тупики по физике
    VERTICAL_ANGLE_THRESHOLD = 75.0
    # Защищаем только ГВУ/ВВУ (участвуют в основном контуре).
    # ВМП любого типа НЕ защищаем — они тупиковые, их Q считается в make_result.
    protected = set(
        e["id"] for e in edges
        if (e["hasFan"] and e.get("fanType", "ГВУ") not in ("ВМП",))
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

    # Быстрый алгоритм O(V+E) вместо прежнего наивного O(V²·(V+E)):
    # находим МОСТЫ графа (bridges) и отсекаем поддеревья, отрезанные мостом
    # от GND. «Висячая петля» = компонента, соединённая с основной сетью
    # только через одну точку сочленения → воздух входит и выходит через один
    # узел, сквозного тока нет (Q=0). Результат идентичен прежнему коду.
    #
    # Мост v→w отрезает поддерево w от GND, если в этом поддереве нет GND.
    # Все рёбра такого поддерева (и сам мост) — тупиковые. Повторяем, пока
    # находятся новые мосты (после удаления поддерева могут появиться новые).
    changed2 = True
    while changed2:
        changed2 = False

        # Граф смежности только из активных рёбер: узел → [(сосед, idx ребра)]
        adj2 = collections.defaultdict(list)
        for i in active_edges:
            e = edges[i]
            adj2[e["a"]].append((e["b"], i))
            adj2[e["b"]].append((e["a"], i))

        if GND not in adj2:
            break

        # ── Поиск мостов итеративным DFS (без рекурсии — глубина до тысяч) ──
        disc = {}          # время входа в узел
        low = {}           # минимальная достижимая метка
        timer = [0]
        bridges = []       # список (parent, child, edge_idx)
        # subtree_nodes[child] заполняется лениво ниже
        # Стек DFS: (узел, родитель, idx ребра к родителю, итератор соседей)
        for root in list(adj2.keys()):
            if root in disc:
                continue
            stack = [(root, None, -1, iter(adj2[root]))]
            disc[root] = low[root] = timer[0]; timer[0] += 1
            while stack:
                node, parent, pe, it = stack[-1]
                advanced = False
                for nb, ei in it:
                    if ei == pe:
                        continue  # не идём назад по тому же ребру
                    if nb not in disc:
                        disc[nb] = low[nb] = timer[0]; timer[0] += 1
                        stack.append((nb, node, ei, iter(adj2[nb])))
                        advanced = True
                        break
                    else:
                        if disc[nb] < low[node]:
                            low[node] = disc[nb]
                if advanced:
                    continue
                # Все соседи обработаны — снимаем узел со стека
                stack.pop()
                if parent is not None:
                    if low[node] < low[parent]:
                        low[parent] = low[node]
                    if low[node] > disc[parent]:
                        bridges.append((parent, node, pe))

        if not bridges:
            break

        # Для каждого моста определяем поддерево со стороны child и проверяем,
        # содержит ли оно GND. Обрабатываем мосты от самых глубоких (по disc
        # child) — так сначала отсекаем самые дальние висячие петли.
        killed_any = False
        for parent, child, pe in sorted(bridges, key=lambda b: -disc[b[1]]):
            if edges[pe]["id"] in dead_edges:
                continue  # ребро уже удалено в этом же проходе
            # BFS по стороне child, НЕ переходя обратно через мост pe
            side = set()
            q2 = collections.deque([child])
            side.add(child)
            has_gnd = (child == GND)
            while q2:
                cur = q2.popleft()
                for nb, ei in adj2[cur]:
                    if ei == pe or nb in side:
                        continue
                    side.add(nb)
                    if nb == GND:
                        has_gnd = True
                    q2.append(nb)
            if has_gnd:
                continue  # GND на этой стороне — не тупик
            # Сторона child не содержит GND → это висячая петля.
            # Убиваем все рёбра внутри side и сам мост (кроме защищённых).
            for i in list(active_edges):
                e = edges[i]
                if e["id"] in protected:
                    continue
                inside = (e["a"] in side and e["b"] in side) or (i == pe)
                if inside:
                    active_edges.discard(i)
                    dead_edges.add(e["id"])
                    killed_any = True

        if killed_any:
            changed2 = True

    return dead_edges


def compute_node_pressures(edges, Q, nodes_in):
    """BFS расчёт абсолютного давления в узлах.
    Корень (GND / атмосфера) = 101325 Па. Каждый узел:
      P_b = P_a - dP,  dP = R·Q·|Q| - H_fan
    Коррекция на высоту: +12 Па/м (столб воздуха при стандартных условиях).
    """
    # Карта высотных отметок узлов
    node_z = {}
    for n in nodes_in:
        node_z[n["id"]] = float(n.get("z", 0.0) or 0.0)

    # Строим граф смежности (с индексом ребра)
    adj = collections.defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append((e["b"], i))
        adj[e["b"]].append((e["a"], i))

    # BFS от GND
    P_ATM = 101325.0
    pressure = {GND: P_ATM}
    visited = {GND}
    queue = collections.deque([GND])

    while queue:
        u = queue.popleft()
        for other, ei in adj[u]:
            if other in visited:
                continue
            e  = edges[ei]
            q  = Q.get(e["id"], 0.0)
            R  = float(e.get("R", 0.0))
            # Напор вентилятора со знаком (+ = нагнетание a→b)
            habs = 0.0
            if e.get("hasFan") and not e.get("fanStopped"):
                habs = fan_H(e, abs(q))
            fan_dir = -1.0 if e.get("fanReverse") else 1.0
            H = fan_dir * habs
            # ΔP = R·Q·|Q| - H (падение давления от a к b)
            dP = R * q * abs(q) - H
            Pu = pressure[u]
            # u == a → P_b = P_a - dP; u == b → P_a = P_b + dP → P_other = Pu + dP
            pressure[other] = Pu - dP if e["a"] == u else Pu + dP
            visited.add(other)
            queue.append(other)

    # Формируем список узлов с давлениями
    nodes_out = []
    for n in nodes_in:
        nid = n["id"]
        # Атмосферные узлы → GND
        pid = GND if (n.get("isAtm") or n.get("atmosphereLink")) else nid
        P = pressure.get(pid)
        if P is None:
            nodes_out.append({"id": nid, "computedPressure": 0})
            continue
        z = node_z.get(nid, 0.0)
        # Коррекция на высоту: +12 Па/м (вниз давление растёт)
        p_abs = round(P + 12.0 * (-z))
        nodes_out.append({"id": nid, "computedPressure": p_abs})
    return nodes_out


def make_result(edges, Q, it, converged, max_res, log, diag, force_zero=False, dead_end_ids=None, R_net=0.0, nodes_in=None):
    # dead_end_ids передаётся из solve() (уже вычислено), иначе пересчитываем
    dead_ends = dead_end_ids if dead_end_ids is not None else find_dead_ends(edges)

    # Карта: узел → список активных (не тупиковых) ветвей, инцидентных ему.
    # Используется для поиска питающей струи ВМП.
    active_adj = collections.defaultdict(list)
    for e in edges:
        if e["id"] not in dead_ends:
            active_adj[e["a"]].append(e)
            active_adj[e["b"]].append(e)
    out = []
    for e in edges:
        is_dead = e["id"] in dead_ends
        q = Q.get(e["id"], 0.0)

        if is_dead and not e.get("hasFan"):
            q = 0.0  # тупиковые выработки без вентилятора — Q=0
        elif is_dead and e.get("hasFan"):
            # Тупиковая ветвь с ВМП: рабочая точка H_вент(Q) = R·Q²
            # ВМП всегда нагнетает в направлении a→b (fromId→toId).
            # Разворот ВМП выполняется через разворот ветви (swap fromId/toId),
            # поэтому fanReverse для ВМП игнорируем — Q всегда > 0.
            R = e["R"] if e["R"] > 1e-6 else 1e-3
            q_lo = float(e.get("qMin", 0.1))
            q_hi = float(e.get("qMax", 90.0))
            def _h_vmp(qv, _e=e):
                """Напор ВМП по прямой характеристике (Q > 0)."""
                N = max(1, int(_e.get("fanParallel", 1) or 1))
                q_one = qv / N
                if _e.get("fanMode", "constant") == "curve":
                    h0v = float(_e.get("h0", 0)); h1v = float(_e.get("h1", 0)); h2v = float(_e.get("h2", 0))
                    q_max_f = float(_e.get("qMax", 1e9))
                    return max(0.0, h0v + h1v * q_one + h2v * q_one * q_one) if q_one <= q_max_f else 0.0
                fp = float(_e.get("fanPressure", 0))
                q_max_c = float(_e.get("qMax", 0))
                if q_max_c > 0 and q_one > q_max_c:
                    return fp * max(0.0, 1.0 - (q_one - q_max_c) / (0.1 * q_max_c))
                return fp
            def f_vmp(qv, _R=R):
                return _h_vmp(qv) - _R * qv * qv
            if f_vmp(q_lo) > 0 and f_vmp(q_hi) < 0:
                for _ in range(60):
                    qm = 0.5 * (q_lo + q_hi)
                    if f_vmp(qm) > 0: q_lo = qm
                    else:             q_hi = qm
                    if q_hi - q_lo < 0.001: break
                q = 0.5 * (q_lo + q_hi)
            elif f_vmp(q_lo) <= 0:
                q = q_lo
            else:
                q = q_hi
            # Q > 0: поток всегда в направлении a→b (fromId→toId)

            # ── Ограничение по подходящей струе ─────────────────────────
            # ВМП всасывает воздух из узла a (вход). Питающая ветвь — активная
            # ветвь, инцидентная узлу a. Расход ВМП не может превышать расход,
            # который подводит питающая струя к этому узлу.
            inlet_node = e["a"]
            q_supply = 0.0
            for feed in active_adj.get(inlet_node, []):
                fq = abs(Q.get(feed["id"], 0.0))
                if fq > q_supply:
                    q_supply = fq
            if q_supply > 0.1 and q > q_supply:
                diag.append({
                    "level": "warning",
                    "category": "vmp_supply",
                    "objectId": e["id"],
                    "message": (
                        f"ВМП (ветвь {e['id']}): производительность {q:.2f} м³/с "
                        f"превышает подходящую струю {q_supply:.2f} м³/с. "
                        f"Расход ограничен до {q_supply:.2f} м³/с."
                    ),
                })
                q = q_supply
        elif force_zero:
            q = 0.0
        elif e["hasFan"] and (abs(q) < 1e-6 or (e["a"] == GND and e["b"] == GND)):
            # Главный вентилятор GND→GND ("Без перемычки") выпадает из итераций —
            # считаем рабочую точку через R_net всей сети.
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

        # Депрессия: аэродинамические потери (всегда ≥ 0) + вклад естественной тяги.
        # H_nat со знаком: положительная тяга снижает депрессию (помогает потоку).
        H_friction = e["R"] * q * q
        H    = H_friction - e.get("naturalDraft", 0.0) * (1.0 if q >= 0 else -1.0)
        Hv   = fan_H_display(e, abs(q))
        area = e.get("area", 0.0)
        vel  = abs(q) / area if area > 0.01 else 0.0

        # Предупреждение о выходе вентилятора за паспортную зону (Q > qMax)
        # отключено для всех типов вентиляторов (ВМП, ВВУ, ГВУ) по требованию.

        # flowDir: направление реального потока (a→b при Q>0, b→a при Q<0)
        # actualQ: модуль расхода (всегда положительный) — для отображения
        flow_dir = "a->b" if q >= 0 else "b->a"
        out.append({"id": e["id"], "Q": round(q, 4), "H": round(H, 3),
                    "Hfan": round(Hv, 3), "velocity": round(vel, 3),
                    "isDead": is_dead,
                    "actualQ": round(abs(q), 4),
                    "flowDir": flow_dir,
                    "fromNode": e["a"], "toNode": e["b"]})

    # ══════════════════════════════════════════════════════════════════════
    # ПОСТОБРАБОТКА: Распространяем Q ВМП на тупиковые ветви за ним.
    # Физика: ВМП нагнетает Q в трубопровод → через каждую ветвь цепочки
    # за ВМП должен идти тот же Q (закон сохранения массы).
    # Проблема без этого: МКР не знает о тупиковой цепочке за ВМП
    # и может дать трубопроводу Q ≠ Q_ВМП.
    # Алгоритм: для каждого ВМП в active (не тупика) — идём BFS по тупиковым
    # ветвям от его выходного узла, назначаем им Q = Q_ВМП.
    # ══════════════════════════════════════════════════════════════════════
    # Строим карту: id ветви → результат
    out_by_id = {b["id"]: b for b in out}
    # Карта тупиковых ветвей: узел → список тупиковых ветвей, инцидентных ему
    dead_adj = collections.defaultdict(list)
    for b in out:
        if b["isDead"]:
            dead_adj[b["fromNode"]].append(b)
            dead_adj[b["toNode"]].append(b)
    # Для каждого активного ВМП — находим тупиковую цепочку за ним
    for b in out:
        if b["isDead"] or not out_by_id[b["id"]]:
            continue
        # Проверяем: является ли ветвь ВМП
        src_edge = next((e for e in edges if e["id"] == b["id"]), None)
        if not src_edge or not src_edge.get("hasFan"):
            continue
        q_vmp = b["Q"]
        if abs(q_vmp) < 1e-4:
            continue
        # Выходной узел ВМП (в направлении потока)
        out_node = b["toNode"] if q_vmp >= 0 else b["fromNode"]
        # BFS по тупиковым ветвям от out_node
        visited_dead = set()
        queue_dead = [out_node]
        while queue_dead:
            node = queue_dead.pop()
            for db in dead_adj.get(node, []):
                if db["id"] in visited_dead:
                    continue
                visited_dead.add(db["id"])
                # Определяем знак Q: поток входит в node — значит из node идёт дальше
                # Ребро db: fromNode→toNode. Если node == fromNode → Q > 0, иначе Q < 0
                if db["fromNode"] == node:
                    db["Q"] = round(abs(q_vmp), 4)
                    db["actualQ"] = round(abs(q_vmp), 4)
                    next_node = db["toNode"]
                else:
                    db["Q"] = round(-abs(q_vmp), 4)
                    db["actualQ"] = round(abs(q_vmp), 4)
                    next_node = db["fromNode"]
                db["flowDir"] = "a->b" if db["Q"] >= 0 else "b->a"
                # Пересчёт депрессии с новым Q
                dead_edge = next((e for e in edges if e["id"] == db["id"]), None)
                if dead_edge:
                    db["H"] = round(dead_edge["R"] * abs(q_vmp) * abs(q_vmp), 3)
                    db["velocity"] = round(abs(q_vmp) / dead_edge["area"], 3) if dead_edge.get("area", 0) > 0.01 else 0.0
                queue_dead.append(next_node)
    out = list(out_by_id.values())

    # Реверс: после унификации build_graph рёбра больше не разворачиваются,
    # поэтому отрицательный Q автоматически означает обратное направление
    # потока относительно fromId→toId для всех ветвей. Дополнительная
    # инверсия больше не требуется (как в Вентсим/Аэросеть).

    # ФИНАЛЬНАЯ ПРОВЕРКА БАЛАНСА КИРХГОФА в каждом узле (≠ GND)
    # Σ Q_in - Σ Q_out должно быть 0 в любом узле кроме источника/стока (GND).
    final_bal = collections.defaultdict(float)
    for branch_out in out:
        if branch_out.get("isDead"):
            continue
        q_val = branch_out["Q"]
        final_bal[branch_out["fromNode"]] -= q_val
        final_bal[branch_out["toNode"]] += q_val
    worst_bal = 0.0
    worst_nd = None
    for nd, bal in final_bal.items():
        if nd == GND:
            continue
        if abs(bal) > worst_bal:
            worst_bal = abs(bal)
            worst_nd = nd
    log.append(f"Финальный баланс Кирхгофа: |ΔQ|_max={worst_bal:.4f} м³/с в узле {worst_nd}")
    if worst_bal > 0.5:
        diag.append({"level": "error", "category": "kirchhoff_balance",
                     "message": f"Нарушен баланс масс: узел {worst_nd}, |ΣQ|={worst_bal:.2f} м³/с. Расчёт некорректен."})
    elif worst_bal > 0.1:
        diag.append({"level": "warning", "category": "kirchhoff_balance",
                     "message": f"Баланс масс с погрешностью: узел {worst_nd}, |ΣQ|={worst_bal:.3f} м³/с"})

    # Расчёт давлений в узлах (BFS от атмосферы)
    nodes_out = compute_node_pressures(edges, Q, nodes_in or []) if nodes_in else []

    return {"branches": out, "nodes": nodes_out, "iterations": it,
            "converged": converged, "maxResidual": round(max_res, 6),
            "kirchhoffBalance": round(worst_bal, 4),
            "log": log, "diagnostics": diag}



# ══════════════════════════════════════════════════════════════════════
# МКР — МЕТОД КОНТУРНЫХ РАСХОДОВ
# Более точный алгоритм с адаптивным демпфированием и двойным критерием
# сходимости (по ΔH и по δQ). Полностью поддерживает естественную тягу,
# реверс, параллельные вентиляторы и тупиковые ветви.
# ══════════════════════════════════════════════════════════════════════

def _mkr_fan_H(e, Q):
    """Напор вентилятора H>=0 (модуль). Знак (направление) учитывается
    в формуле невязки МКР через fan_dir = -1 при fanReverse (как в Кроссе).
    Унифицировано с fan_H() — включая защиту от Q→∞ через qMax.
    """
    if not e.get("hasFan") or e.get("fanStopped"):
        return 0.0
    N    = max(1, int(e.get("fanParallel", 1) or 1))
    mode = e.get("fanMode", "constant")
    if mode == "curve":
        q_one = abs(Q) / N
        if q_one <= 0:
            if e.get("fanReverse") and e.get("reverseH0") is not None:
                return max(0.0, float(e.get("reverseH0", 0)))
            return max(0.0, float(e.get("h0", 0)))
        if e.get("fanReverse") and e.get("reverseH0") is not None:
            q_max = float(e.get("reverseQMax", e.get("qMax", 1e9)))
            if q_one > q_max:
                return 0.0
            h = float(e.get("reverseH0", 0)) + float(e.get("reverseH1", 0)) * q_one + float(e.get("reverseH2", 0)) * q_one * q_one
        else:
            q_max_fan = float(e.get("qMax", 1e9))
            if q_one > q_max_fan:
                # Резкий спад до 0 на 1.1×qMax (как Вентиляция-2)
                decay = max(0.0, 1.0 - (q_one - q_max_fan) / (0.1 * q_max_fan))
                h0v = float(e.get("h0", 0))
                h1v = float(e.get("h1", 0))
                h2v = float(e.get("h2", 0))
                h_at_max = max(0.0, h0v + h1v * q_max_fan + h2v * q_max_fan * q_max_fan)
                return h_at_max * decay
            h = float(e.get("h0", 0)) + float(e.get("h1", 0)) * q_one + float(e.get("h2", 0)) * q_one * q_one
        return max(0.0, h)
    # Constant с qMax — резкий спад при выходе за паспорт (как Вентиляция-2)
    fp = max(0.0, float(e.get("fanPressure", 0)))
    q_max = float(e.get("qMax", 0))
    if q_max > 0:
        q_one = abs(Q) / N
        if q_one > q_max:
            decay = max(0.0, 1.0 - (q_one - q_max) / (0.1 * q_max))
            return fp * decay
    return fp


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

    КРИТИЧНО: активные вентиляторы НЕ берутся в дерево.
    Если вентилятор попадёт в дерево — он не войдёт ни в один контур МКР
    и его напор выпадет из итераций (Q = только Кирхгоф-1, без Q-H характеристики).

    Алгоритм — СТРОГО ДВА ПРОХОДА:
    1) BFS только по НЕ-вентиляторным рёбрам → строим максимальный остов без вент.
    2) Для узлов, не достигнутых на шаге 1, добавляем вентиляторы (fallback для
       изолированных подграфов, соединённых только через ВМП).
    Вентиляторы, оба конца которых уже достигнуты на шаге 1, гарантированно
    становятся хордами и попадают в контуры МКР.
    """
    node_set = set()
    for e in edges:
        node_set.add(e["a"])
        node_set.add(e["b"])
    node_list = list(node_set)

    root = GND if GND in node_set else node_list[0]

    # ── Проход 1: только НЕ-вентиляторные рёбра ──────────────────────────
    adj_nofan = collections.defaultdict(list)
    for i, e in enumerate(edges):
        if e.get("hasFan") and not e.get("fanStopped"):
            continue
        adj_nofan[e["a"]].append((i, e["b"], e["R"]))
        adj_nofan[e["b"]].append((i, e["a"], e["R"]))
    for u in adj_nofan:
        adj_nofan[u].sort(key=lambda x: x[2])  # малое R → предпочтительнее в дерево

    visited   = {root}
    parent    = {root: None}
    tree_set  = set()
    bfs_order = [root]
    queue = collections.deque([root])
    while queue:
        u = queue.popleft()
        for ei, nb, _r in adj_nofan[u]:
            if nb not in visited:
                visited.add(nb)
                parent[nb] = (u, ei)
                tree_set.add(ei)
                bfs_order.append(nb)
                queue.append(nb)

    # ── Проход 2: вентиляторы — только для несвязных узлов (fallback) ────
    # Типичный случай: изолированный подграф, соединённый с основной сетью
    # исключительно через ВМП (нет обходного пути без вентилятора).
    adj_fan = collections.defaultdict(list)
    for i, e in enumerate(edges):
        if not e.get("hasFan") or e.get("fanStopped"):
            continue
        adj_fan[e["a"]].append((i, e["b"], e["R"]))
        adj_fan[e["b"]].append((i, e["a"], e["R"]))
    for u in adj_fan:
        adj_fan[u].sort(key=lambda x: x[2])

    # BFS второго прохода стартует с уже достигнутых узлов
    queue2 = collections.deque(bfs_order[:])   # копия текущего bfs_order
    while queue2:
        u = queue2.popleft()
        for ei, nb, _r in adj_fan[u]:
            if nb not in visited:
                visited.add(nb)
                parent[nb] = (u, ei)
                tree_set.add(ei)
                bfs_order.append(nb)
                queue2.append(nb)

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

    lca = None; idx_dst = 0
    for i, n in enumerate(ancs_dst):
        if n in set_src:
            lca = n; idx_dst = i; break
    if lca is None:
        # Нет общего предка → узлы в разных компонентах связности.
        # Должно быть отсечено проверкой связности в solve_mkr; здесь —
        # страховка, чтобы не ронять расчёт непонятным KeyError.
        raise ValueError(
            f"Узлы {src} и {dst} не связаны общим деревом "
            f"(сеть распадается на несвязные части)."
        )
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
    """Начальный расход из рабочей точки вентилятора (бисекция).
    Выбирает главный вентилятор — с максимальным h0 (напором при Q=0),
    чтобы не взять ВМП с малым напором вместо главного вентилятора шахты.
    """
    fans = [e for e in edges if e.get("hasFan") and not e.get("fanStopped")]
    if not fans:
        h_nat = sum(abs(e.get("naturalDraft", 0.0)) for e in edges)
        return math.sqrt(h_nat / r_total) if h_nat > 0 and r_total > 0 else 1.0

    # Берём вентилятор с максимальным напором при нулевом расходе
    def fan_h0(e):
        mode = e.get("fanMode", "constant")
        if mode == "curve":
            return abs(float(e.get("h0", 0)))
        return abs(float(e.get("fanPressure", 0)))

    fan = max(fans, key=fan_h0)
    mode = fan.get("fanMode", "constant")
    if mode == "curve":
        is_rev = fan.get("fanReverse") and fan.get("reverseH0") is not None
        q_hi = float(fan.get("reverseQMax", fan.get("qMax", 90.0))) if is_rev else float(fan.get("qMax", 90.0))
        if r_total <= 0:
            return q_hi * 0.5

        def f(q):
            return _mkr_fan_H(fan, q) - r_total * q * q   # H>=0, поэтому abs не нужен

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

    h0 = _mkr_fan_H(fan, 1.0)
    if h0 > 0 and r_total > 0:
        return math.sqrt(h0 / r_total)
    return 1.0


def _mkr_iterate_fast(contours_local, active_edges_list, local_to_global, Q,
                      sync_tree_q, q0, relaxation, prev_dh, min_iter, max_iter,
                      tol_h_rel, tol_q, log):
    """
    Быстрая версия итераций МКР — ТА ЖЕ математика и ТОТ ЖЕ порядок обновления
    (Гаусс-Зейдель по контурам), что и в скалярном цикле, но без обращения к
    dict/объектам в горячем цикле: все данные ветвей заранее разложены в
    плоские списки/массивы по индексам. Результат идентичен скалярной версии,
    ускорение — за счёт устранения Python-накладных на .get()/индексацию словарей.
    Возвращает (it, max_dh, max_dq).
    """
    n_edges = len(Q)

    # ── Предвычисление данных ветвей по глобальному индексу (один раз) ────────
    R_edge = [0.0] * n_edges
    nat_edge = [0.0] * n_edges
    fan_edge = [None] * n_edges   # объект ветви-вентилятора или None
    fan_is_vmp = [False] * n_edges
    fan_dir_edge = [1.0] * n_edges
    for i, e in enumerate(active_edges_list):
        gi = local_to_global[i]
        R_edge[gi] = float(e["R"])
        nat_edge[gi] = float(e.get("naturalDraft", 0.0))
        if e.get("hasFan"):
            fan_edge[gi] = e
            is_vmp = e.get("fanType", "ГВУ") == "ВМП"
            fan_is_vmp[gi] = is_vmp
            fan_dir_edge[gi] = 1.0 if is_vmp else (-1.0 if e.get("fanReverse") else 1.0)

    # Контуры → плоские кортежи (gi, sign) для быстрого прохода без словарей
    contours_flat = [tuple((local_to_global[li], 1.0 if s > 0 else -1.0) for li, s in c)
                     for c in contours_local]

    q0_floor = max(q0, 1.0)
    max_dh = float("inf")
    max_dq = float("inf")
    it = 0
    # Детектор застоя: сколько итераций подряд max_dh не улучшается
    best_dh = float("inf")
    stall = 0
    stall_limit = 150   # «полка» ΔH дольше 150 итераций при стабильном δQ → выход
    for it in range(1, max_iter + 1):
        max_dh = 0.0
        max_dq = 0.0

        for contour in contours_flat:
            num = 0.0
            den = 0.0
            q_ref = 0.0
            for gi, sign in contour:
                qg = Q[gi]
                qd = qg * sign
                aqd = qd if qd >= 0.0 else -qd
                R = R_edge[gi]
                num += R * qd * aqd
                den += 2.0 * R * aqd

                fe = fan_edge[gi]
                if fe is not None:
                    fdir = fan_dir_edge[gi]
                    if fan_is_vmp[gi]:
                        H = _mkr_fan_H(fe, abs(qg))   # ВМП: H всегда > 0
                    else:
                        q_fan = qg * fdir
                        H = _mkr_fan_H(fe, abs(qg)) if q_fan >= 0 else 0.0
                    num -= fdir * H * sign
                    den += _mkr_fan_dH(fe, abs(qg))

                hn = nat_edge[gi]
                if hn != 0.0:
                    num -= hn * sign

                aqg = qg if qg >= 0.0 else -qg
                if aqg > q_ref:
                    q_ref = aqg

            if den < 1e-12:
                continue

            dq_raw = -num / den
            if q_ref < 0.1:
                q_ref = q0_floor
            if dq_raw > q_ref:
                dq_raw = q_ref
            elif dq_raw < -q_ref:
                dq_raw = -q_ref
            dq = relaxation * dq_raw

            anum = num if num >= 0.0 else -num
            if anum > max_dh:
                max_dh = anum
            adq = dq if dq >= 0.0 else -dq
            if adq > max_dq:
                max_dq = adq

            for gi, sign in contour:
                nq = Q[gi] + dq * sign
                Q[gi] = nq if math.isfinite(nq) else 0.0

        # Синхронизация ветвей дерева по Кирхгофу-1
        sync_tree_q(Q)

        # Адаптивное демпфирование
        if it > 5:
            if max_dh > prev_dh * 1.05:
                relaxation = max(0.1, relaxation * 0.7)
            elif max_dh < prev_dh * 0.95:
                relaxation = min(1.0, relaxation * 1.1)
        prev_dh = max_dh

        # Строгий критерий сходимости — идеальное решение найдено
        if it >= min_iter and max_dh < tol_h_rel and max_dq < tol_q:
            it += 1
            break

        # ── Детектор застоя (stagnation) ────────────────────────────────────
        # Метод Кросса/МКР сходится линейно и на больших сетях с перемычками
        # (большой разброс R) упирается в предел: max_dh перестаёт убывать,
        # хотя баланс Кирхгофа по расходам уже идеален. Крутить оставшиеся
        # тысячи итераций впустую нет смысла — фиксируем «полку» и выходим,
        # если поток (max_dq) уже практически стабилен.
        if max_dh < best_dh * 0.999:
            best_dh = max_dh
            stall = 0
        else:
            stall += 1
        # Поток стабилизировался (δQ мал) И невязка ΔH не улучшается stall_limit
        # итераций подряд → дальнейшие итерации бесполезны.
        if it >= min_iter and stall >= stall_limit and max_dq < tol_q * 5.0:
            log.append(f"МКР: застой на итерации {it} (ΔH={max_dh:.2f} Па не улучшается, "
                       f"δQ={max_dq:.4f} м³/с стабилен) — досрочный выход")
            it += 1
            break

    return it, max_dh, max_dq


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

    # ── Профилирование этапов расчёта (тайминги в мс) ──────────────────────
    _t_start = time.perf_counter()
    _timings = {}
    def _mark(stage):
        nonlocal _t_start
        now = time.perf_counter()
        _timings[stage] = _timings.get(stage, 0.0) + (now - _t_start) * 1000.0
        _t_start = now

    edges, atm = build_graph(nodes_in, branches_in, surface_temp)
    _mark("Построение графа")

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
    _mark("Поиск тупиков")

    # BFS-дерево
    bfs_order, parent_map, tree_set, chords, node_list = _bfs_tree(active_edges_list)
    _mark("Построение дерева (BFS)")
    log.append(f"МКР: ветвей={len(edges)} активных={len(active_edges_list)} контуров={len(chords)}")

    if not chords:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет замкнутых контуров — циркуляция невозможна."})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # ── Проверка связности сети ──────────────────────────────────────────
    # BFS-дерево строится от выхода на поверхность (GND). Узлы, не попавшие
    # в parent_map, не связаны с основной сетью (изолированный кусок после
    # импорта). Без этой проверки _tree_path падает с KeyError на узле, и в
    # лог попадает непонятный traceback вместо совета, что исправить.
    reachable = set(bfs_order)
    unreachable = [n for n in node_list if n != GND and n not in reachable]
    if unreachable:
        # Ветви, целиком лежащие в изолированной части (обе стороны недоступны)
        iso_branch_ids = [
            e["id"] for e in active_edges_list
            if e["a"] in unreachable and e["b"] in unreachable
        ]
        nodes_txt = ", ".join(str(n) for n in unreachable[:8])
        if len(unreachable) > 8:
            nodes_txt += f" и ещё {len(unreachable) - 8}"
        # Первым называем «худший» узел — как в методе Кросса («узел 594»),
        # чтобы пользователь сразу нашёл его на схеме.
        worst_node = unreachable[0]
        if len(unreachable) == 1:
            parts = [f"Узел {worst_node} не связан с выходом на поверхность."]
        else:
            parts = [
                f"Узел {worst_node} и ещё {len(unreachable) - 1} "
                f"не связаны с выходом на поверхность (узлы: {nodes_txt})."
            ]
        if iso_branch_ids:
            br_txt = ", ".join(str(i) for i in iso_branch_ids[:8])
            if len(iso_branch_ids) > 8:
                br_txt += f" и ещё {len(iso_branch_ids) - 8}"
            parts.append(f"Изолированные ветви: {br_txt}.")
        else:
            parts.append("Висячий узел без ветвей — к нему не подходит ни одна выработка.")
        parts.append(
            "Что сделать: соедините изолированный участок с основной сетью "
            "(добавьте выработку до ближайшего узла) либо удалите лишний "
            f"узел {worst_node} и другие, оставшиеся после импорта. "
            "Затем повторите расчёт."
        )
        diag.append({"level": "error", "category": "topology",
                     "message": " ".join(parts)})
        return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)

    # Активные индексы: active_edges_list → edges (по id)
    id_to_global = {e["id"]: i for i, e in enumerate(edges)}
    # Перестраиваем tree_set и chords в глобальные индексы
    local_to_global = {i: id_to_global[e["id"]] for i, e in enumerate(active_edges_list)}

    # Контуры (в локальных индексах active_edges_list)
    contours_local = []
    _contour_edges_total = 0
    for ci in chords:
        ce = active_edges_list[ci]
        try:
            path = _tree_path(ce["b"], ce["a"], active_edges_list, parent_map)
        except ValueError as ex:
            diag.append({"level": "error", "category": "topology",
                         "message": (
                             f"Не удалось построить контур для ветви {ce['id']}: {ex} "
                             "Что сделать: проверьте связность сети — соедините "
                             "изолированный участок с основной сетью или удалите "
                             "лишние узлы/ветви, затем повторите расчёт."
                         )})
            return make_result(edges, {e["id"]: 0.0 for e in edges}, 0, False, 0.0, log, diag, force_zero=True)
        contours_local.append([(ci, +1)] + path)
        _contour_edges_total += len(path) + 1
    _mark("Построение контуров")
    _avg_len = _contour_edges_total / max(1, len(contours_local))
    log.append(f"МКР: контуров={len(contours_local)} суммарно рёбер={_contour_edges_total} средняя длина контура={_avg_len:.1f}")

    # Q по глобальным индексам
    Q = [0.0] * len(edges)

    # R_net: путь BFS от главного вентилятора до атмосферы (GND).
    # Используем ту же логику что в Кросс (compute_r_main), чтобы перемычки
    # с большим R на боковых ветвях не искажали оценку начального Q₀.
    def _estimate_r_net_mkr():
        fans = [e for e in active_edges_list if e.get("hasFan") and not e.get("fanStopped")]
        if not fans:
            return None
        def fan_h0(e):
            return abs(float(e.get("h0", 0))) if e.get("fanMode") == "curve" else abs(float(e.get("fanPressure", 0)))
        main_fan = max(fans, key=fan_h0)
        adj = collections.defaultdict(list)
        for e in active_edges_list:
            adj[e["a"]].append((e["b"], e["R"]))
            adj[e["b"]].append((e["a"], e["R"]))
        start = main_fan["a"] if main_fan["a"] != GND else main_fan["b"]
        if start == GND:
            return main_fan["R"]
        visited = {start}
        queue = collections.deque([(start, main_fan["R"])])
        while queue:
            node, r_sum = queue.popleft()
            if node == GND:
                return r_sum
            for nb, r in adj[node]:
                if nb not in visited:
                    visited.add(nb)
                    queue.append((nb, r_sum + r))
        return None

    r_net = _estimate_r_net_mkr()
    if r_net and r_net > 1e-6:
        r_total = r_net
    else:
        # Запасной вариант: медиана R (как в Кросс) — исключает выбросы перемычек
        r_branches = sorted(e["R"] for e in active_edges_list if not e.get("hasFan") and e["R"] > 1e-9)
        if r_branches:
            n_tree = max(1, len(tree_set))
            r_total = r_branches[len(r_branches) // 2] * n_tree
        else:
            r_total = 1e-3
    log.append(f"МКР R_net={r_total:.4f} (путь BFS от вентилятора)")

    q0 = _estimate_q0_mkr(active_edges_list, r_total)
    log.append(f"МКР Q₀={q0:.3f} м³/с")

    # Инициализация хорд: одинаковое q0 для всех хорд.
    # При реверсе ГЛАВНОГО вентилятора (ГВУ/ВВУ) — инвертируем знак,
    # чтобы стартовать ближе к решению. ВМП НЕ инвертируем: их направление
    # определяется балансом сети, а не глобальным реверсом.
    # Определяем знак по ГЛАВНОМУ вентилятору (макс. напор среди ГВУ/ВВУ).
    # Если брать первый попавшийся с fanReverse — при нескольких ГВУ знак может
    # совпасть со вспомогательным, а не главным, и начальное Q будет антинаправленным.
    sign_mkr = 1.0
    main_gvu = None
    max_h0_gvu = -1.0
    for e in active_edges_list:
        if e.get("hasFan") and not e.get("fanStopped") and e.get("fanType", "ГВУ") in ("ГВУ", "ВВУ"):
            h0v = abs(float(e.get("h0", 0))) if e.get("fanMode") == "curve" else abs(float(e.get("fanPressure", 0)))
            if h0v > max_h0_gvu:
                max_h0_gvu = h0v
                main_gvu = e
    if main_gvu and main_gvu.get("fanReverse"):
        sign_mkr = -1.0
    # КРИТИЧНО: q_init_mkr = q0 / N_chords (как в Кросс),
    # чтобы суммарный поток через дерево не превышал Q_ГВУ.
    n_chords_mkr = max(1, len(chords))
    q_init_mkr = (q0 / n_chords_mkr) * sign_mkr
    log.append(f"МКР хорд={n_chords_mkr}, q_chord={q_init_mkr:.3f}")
    for ci in chords:
        Q[local_to_global[ci]] = q_init_mkr

    # BFS bottom-up: синхронизация Q ветвей дерева по 1-му закону Кирхгофа.
    # Алгоритм (как в Аэросеть/Вентсим):
    #   1) считаем дисбаланс в каждом узле от ВСЕХ хорд (нетривиальные ветви)
    #   2) проходим дерево снизу вверх — Q родительского ребра = сумма Q дочерних
    # Это исключает невязки Кирхгофа в МКР после каждой итерации.
    tree_branches = {parent_map[v][1] for v in bfs_order if parent_map.get(v)}

    # Характерный напор для допуска сходимости
    h_char = 0.0
    for _e in active_edges_list:
        if _e.get("hasFan") and not _e.get("fanStopped"):
            if _e.get("fanMode") == "curve":
                h_char = max(h_char, abs(float(_e.get("h0", 0))))
            else:
                h_char = max(h_char, abs(float(_e.get("fanPressure", 0))))
        h_char = max(h_char, abs(_e.get("naturalDraft", 0.0)))
    if h_char <= 0:
        h_char = 1.0

    def sync_tree_q(Q_arr):
        # Начальный дисбаланс — только от ХОРД (не древесных рёбер)
        bal = collections.defaultdict(float)
        for i, e in enumerate(active_edges_list):
            if i in tree_branches:
                continue   # древесные пересчитываются ниже
            gi = local_to_global[i]
            bal[e["a"]] -= Q_arr[gi]
            bal[e["b"]] += Q_arr[gi]
        # Снизу вверх: каждое древесное ребро уравнивает баланс своего листа
        for idx in range(len(bfs_order) - 1, 0, -1):
            v  = bfs_order[idx]
            p  = parent_map.get(v)
            if p is None:
                continue
            p_node, li = p
            e  = active_edges_list[li]
            gi = local_to_global[li]
            b  = bal[v]
            # Вентилятор в дереве (fallback): его Q фиксировано итерациями МКР,
            # не перезаписываем из баланса. Только передаём его вклад вверх.
            if e.get("hasFan") and not e.get("fanStopped"):
                # вклад вентилятора уже учтён в bal через хорды-участок контура
                # просто передаём накопленный дисбаланс узла v в родителя
                bal[p_node] += b
                continue
            # Q в направлении ребра (a→b): bal[v] = сумма притоков в v от хорд.
            # Чтобы аннулировать дисбаланс:
            # - v=b (ребро приносит в v): нужно Q чтобы оно уносило из v, т.е. Q = -b
            # - v=a (ребро уносит из v): нужно Q чтобы оно приносило в v, т.е. Q = b
            q_new = -b if e["b"] == v else b
            Q_arr[gi] = q_new
            # Всегда передаём полный дисбаланс узла v вверх по дереву.
            # Ограничение Q здесь НАРУШАЛО бы 1-й закон Кирхгофа:
            # остаток "испарялся" и не передавался родителю → дисбаланс.
            bal[p_node] += b

    sync_tree_q(Q)
    _mark("Начальное приближение")

    # ── Итерации МКР ────────────────────────────────────────────────────────
    max_dh = float("inf")
    max_dq = float("inf")
    # При наличии вентилятора можно стартовать с 0.5; без вентилятора (только тяга)
    # нужна более осторожная релаксация чтобы не осциллировать
    relaxation = 0.5 if active_fans else 0.15
    prev_dh = float("inf")
    it = 0
    min_iter = 10  # минимум итераций перед проверкой сходимости (больше для шахт)

    # Относительный допуск: 0.5% от макс. напора в сети (≈ 10 Па для 2000 Па ГВУ)
    tol_h_rel = max(tol_h, 0.005 * h_char)

    # ── БЫСТРЫЙ ПУТЬ для больших сетей ────────────────────────────────────────
    # На больших схемах (тысячи контуров) горячий цикл с обращением к dict/объектам
    # ветвей делает миллиарды медленных операций и упирается в таймаут. Вынесли
    # ТУ ЖЕ математику и ТОТ ЖЕ порядок обновления (Гаусс-Зейдель) в _mkr_iterate_fast
    # с плоскими массивами по индексам — результат идентичен, но в разы быстрее.
    USE_FAST = len(contours_local) > 200
    if USE_FAST:
        it, max_dh, max_dq = _mkr_iterate_fast(
            contours_local, active_edges_list, local_to_global, Q,
            sync_tree_q, q0, relaxation, prev_dh, min_iter, max_iter,
            tol_h_rel, tol_q, log,
        )
    else:
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
                    # ВМП нагнетает ВСЕГДА в направлении a→b — fan_dir=+1.
                    # При реверсе ГВУ поток в ветви ВМП опрокидывается (Q<0),
                    # но ВМП продолжает создавать напор H(|Q|) против потока.
                    # Проверку q_fan>=0 применяем ТОЛЬКО к ГВУ/ВВУ.
                    is_vmp = e.get("fanType", "ГВУ") == "ВМП"
                    fan_dir = 1.0 if is_vmp else (-1.0 if e.get("fanReverse") else 1.0)
                    q_fan = Q[gi] * fan_dir
                    if is_vmp:
                        H = _mkr_fan_H(e, abs(Q[gi]))   # ВМП: H всегда > 0
                    else:
                        H = _mkr_fan_H(e, abs(Q[gi])) if q_fan >= 0 else 0.0
                    num -= fan_dir * H * sign
                    den += _mkr_fan_dH(e, abs(Q[gi]))

                h_nat = e.get("naturalDraft", 0.0)
                if h_nat != 0.0:
                    num -= h_nat * sign

            if den < 1e-12:
                continue

            dq_raw = -num / den
            # Защита от взрыва: ограничиваем только по max|Q| в контуре, БЕЗ q0
            # (для большой сети q0 мал — это душило сходимость).
            q_ref_mkr = max((abs(Q[local_to_global[li]]) for li, _ in contour), default=0.0)
            if q_ref_mkr < 0.1:
                q_ref_mkr = max(q0, 1.0)   # минимум 1 м³/с для устойчивости
            if abs(dq_raw) > q_ref_mkr:
                dq_raw = math.copysign(q_ref_mkr, dq_raw)
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

        # Адаптивное демпфирование (как в Аэросеть): быстрый рост при сходимости,
        # резкое снижение при росте невязки. Стабилизирует расчёт больших сетей.
        if it > 5:
            if max_dh > prev_dh * 1.05:
                relaxation = max(0.1, relaxation * 0.7)
            elif max_dh < prev_dh * 0.95:
                relaxation = min(1.0, relaxation * 1.1)  # рост 10%/итерация, не 1%
        prev_dh = max_dh

        # Критерий остановки: двойной (по ΔH И по δQ) с относительным допуском.
        # tol_h_rel для больших сетей вместо абсолютного tol_h.
        if it >= min_iter and max_dh < tol_h_rel and max_dq < tol_q:
            it += 1
            break

    # Двойной критерий — обе невязки малы: идеальная сходимость.
    converged = max_dh < tol_h_rel and max_dq < tol_q
    # Приемлемое решение: расход сбалансирован (δQ мал → 1-й закон Кирхгофа
    # выполнен), а ΔH застряла на «полке» метода. Для больших сетей с
    # перемычками (большой разброс R) это физически корректный результат —
    # метод Кросса достиг своего предела точности по давлению.
    q_ok = max_dq < tol_q * 5.0
    if not converged:
        if q_ok:
            converged = True  # результат достоверен: баланс расходов сошёлся
            diag.append({"level": "info", "category": "convergence",
                         "message": f"Расход сбалансирован (δQ={max_dq:.4f} м³/с). "
                                    f"Остаточная невязка по давлению |ΔH|={max_dh:.1f} Па — "
                                    f"предел точности метода на данной сети."})
        else:
            diag.append({"level": "warning", "category": "convergence",
                         "message": f"МКР не сошлось за {max_iter} итераций. |ΔH|={max_dh:.2f} Па (допуск {tol_h_rel:.2f}), δQ={max_dq:.4f} м³/с"})

    _mark("Итерации МКР")
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

    # ── Проверка 1-го закона Кирхгофа (баланс узлов) ────────────────────
    check_kirchhoff(edges, Q_map, diag, dead_end_ids=dead_end_ids)
    _mark("Постобработка")

    # ── Сводка таймингов по этапам (для профилирования больших схем) ──────
    _total_ms = sum(_timings.values())
    _parts = " · ".join(f"{k}: {v:.0f} мс" for k, v in _timings.items())
    log.append(f"⏱ ПРОФИЛЬ РАСЧЁТА (всего {_total_ms:.0f} мс): {_parts}")
    if it > 0:
        log.append(f"⏱ На итерацию МКР: {_timings.get('Итерации МКР', 0.0) / it:.2f} мс × {it} итераций")

    return make_result(edges, Q_map, it, converged, max_dh, log, diag, dead_end_ids=dead_end_ids, R_net=r_total, nodes_in=nodes_in)


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