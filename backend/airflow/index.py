"""
Решатель воздухораспределения для горных выработок.
Поддерживает два метода: Кросс (cross) и МКР (mkr).

Входные данные (POST JSON):
  method: "cross" | "mkr"
  nodes: [{id, isAtm?}]
  branches: [{id, fromId, toId, R, hasFan?, fanPressure?}]
  options: {tolerance?, maxIter?, alpha?, onlyVisible?}

Выходные данные:
  branches: [{id, Q, H, velocity?}]
  nodes: [{id, P}]
  iterations: int
  converged: bool
  maxResidual: float
  log: [str]
  diagnostics: [{level, message, category, objectId?}]
"""

import json
import math

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения методом Кросса или МКР."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return _err(400, "Ошибка парсинга JSON")

    method = body.get("method", "cross").lower()
    nodes_in = body.get("nodes", [])
    branches_in = body.get("branches", [])
    options = body.get("options", {})

    if not branches_in:
        return _ok({"branches": [], "nodes": [], "iterations": 0,
                     "converged": True, "maxResidual": 0.0, "log": ["Нет ветвей"],
                     "diagnostics": [{"level": "warning", "message": "Нет ветвей для расчёта", "category": "topology"}]})

    try:
        if method == "mkr":
            result = solve_mkr(nodes_in, branches_in, options)
        else:
            result = solve_cross(nodes_in, branches_in, options)
    except Exception as ex:
        return _err(500, f"Ошибка расчёта: {ex}")

    return _ok(result)


# ══════════════════════════════════════════════════════════════════════════════
# ОБЩИЕ УТИЛИТЫ
# ══════════════════════════════════════════════════════════════════════════════

def get_R(b: dict) -> float:
    """Аэродинамическое сопротивление ветви."""
    r = float(b.get("R") or b.get("resistance") or 0.0)
    return max(r, 1e-9)


def fan_pressure(b: dict, Q: float) -> float:
    """Напор вентилятора. Если curve — H(Q) = h0 + h1*Q + h2*Q²."""
    if not b.get("hasFan"):
        return 0.0
    mode = b.get("fanMode", "constant")
    if mode == "curve":
        h0 = float(b.get("h0", 0))
        h1 = float(b.get("h1", 0))
        h2 = float(b.get("h2", 0))
        qa = abs(Q)
        qmax = float(b.get("qMax", 1e9))
        if qa > qmax:
            return 0.0
        return max(0.0, h0 + h1 * qa + h2 * qa * qa)
    else:
        return float(b.get("fanPressure", 0))


def build_graph(nodes_in, branches_in):
    """Строит граф: возвращает узлы, ветви с R и флаг атмосферы."""
    atm = {n["id"] for n in nodes_in if n.get("isAtm") or n.get("atmosphereLink")}
    # Если нет явных атмосферных узлов — ищем узлы с именем "атм" или похожим
    if not atm:
        for n in nodes_in:
            nid = str(n.get("id", "")).lower()
            if "атм" in nid or "atm" in nid or "gnd" in nid:
                atm.add(n["id"])

    edges = []
    for b in branches_in:
        edges.append({
            "id": b["id"],
            "a": b["fromId"],
            "b": b["toId"],
            "R": get_R(b),
            "hasFan": bool(b.get("hasFan")),
            "fanMode": b.get("fanMode", "constant"),
            "fanPressure": float(b.get("fanPressure", 0)),
            "h0": float(b.get("h0", 0)),
            "h1": float(b.get("h1", 0)),
            "h2": float(b.get("h2", 0)),
            "qMax": float(b.get("qMax", 1e9)),
            "area": float(b.get("area", 0)),
            "_raw": b,
        })
    return atm, edges


def initial_Q(edges, atm, diag):
    """Начальное распределение расходов — по дереву обхода BFS."""
    # Находим вентилятор для оценки Q_0
    fan_edges = [e for e in edges if e["hasFan"]]
    Q0 = 50.0  # м³/с по умолчанию
    if fan_edges:
        fe = fan_edges[0]
        fp = fan_pressure(fe, Q0)
        if fp > 0 and fe["R"] > 0:
            Q0 = math.sqrt(fp / fe["R"])
        Q0 = max(1.0, min(Q0, fe["qMax"]))

    # BFS от атмосферных узлов, задаём Q=Q0 для дерева
    adj = {}
    for e in edges:
        adj.setdefault(e["a"], []).append(e)
        adj.setdefault(e["b"], []).append(e)

    visited_nodes = set(atm)
    visited_edges = set()
    queue = list(atm)
    Q = {e["id"]: 0.0 for e in edges}

    while queue:
        node = queue.pop(0)
        for e in adj.get(node, []):
            if e["id"] in visited_edges:
                continue
            visited_edges.add(e["id"])
            other = e["b"] if e["a"] == node else e["a"]
            # Назначаем расход Q0 в направлении обхода дерева
            if other not in visited_nodes:
                visited_nodes.add(other)
                queue.append(other)
                # Направление: из node → other
                if e["a"] == node:
                    Q[e["id"]] = Q0
                else:
                    Q[e["id"]] = -Q0
            else:
                # Хорда — ставим 0
                Q[e["id"]] = 0.0

    return Q


# ══════════════════════════════════════════════════════════════════════════════
# ВЫДЕЛЕНИЕ НЕЗАВИСИМЫХ КОНТУРОВ (дерево + хорды)
# ══════════════════════════════════════════════════════════════════════════════

def find_loops(edges, all_nodes):
    """
    Возвращает список независимых контуров.
    Каждый контур — список (edge_id, sign), где sign=+1 если направление ребра
    совпадает с обходом контура, -1 — обратное.
    Использует алгоритм остовного дерева (spanning tree + хорды).
    """
    # Строим остовное дерево BFS
    nodes = list(all_nodes)
    if not nodes:
        return []

    adj = {}
    for e in edges:
        adj.setdefault(e["a"], []).append(e)
        adj.setdefault(e["b"], []).append(e)

    visited = set()
    tree_edges = set()
    parent = {}  # node → (edge_id, parent_node)
    queue = [nodes[0]]
    visited.add(nodes[0])

    while queue:
        node = queue.pop(0)
        for e in adj.get(node, []):
            other = e["b"] if e["a"] == node else e["a"]
            if other not in visited:
                visited.add(other)
                tree_edges.add(e["id"])
                parent[other] = (e["id"], node)
                queue.append(other)

    # Хорды — рёбра не вошедшие в дерево
    chords = [e for e in edges if e["id"] not in tree_edges]

    loops = []
    edge_by_id = {e["id"]: e for e in edges}

    def path_to_root(node):
        """Путь от node до корня дерева."""
        path = []
        cur = node
        while cur in parent:
            eid, par = parent[cur]
            e = edge_by_id[eid]
            # Направление ребра: e["a"]→e["b"]
            if e["b"] == cur:
                path.append((eid, +1))  # идём против ребра (к корню)
            else:
                path.append((eid, -1))
            cur = par
        return path, cur  # cur = корень

    for chord in chords:
        # Контур: chord + путь от chord.b до LCA + путь от LCA до chord.a
        path_b, root_b = path_to_root(chord["b"])
        path_a, root_a = path_to_root(chord["a"])

        # Найдём LCA
        visited_b = {}
        cur = chord["b"]
        depth = 0
        visited_b[cur] = depth
        for eid, sgn in path_b:
            e = edge_by_id[eid]
            cur = e["a"] if e["b"] == cur else e["b"]
            depth += 1
            visited_b[cur] = depth

        # Ищем первый общий узел
        cur = chord["a"]
        path_a2 = []
        while cur not in visited_b:
            if cur not in parent:
                break
            eid, par = parent[cur]
            e = edge_by_id[eid]
            if e["b"] == cur:
                path_a2.append((eid, -1))
            else:
                path_a2.append((eid, +1))
            cur = par
        lca = cur

        # Путь от b до lca
        cur = chord["b"]
        path_b2 = []
        for eid, sgn in path_b:
            if cur == lca:
                break
            e = edge_by_id[eid]
            path_b2.append((eid, sgn))
            cur = e["a"] if e["b"] == cur else e["b"]

        # Контур: chord (a→b, +1) + path_b2 (от b к lca) + обратный path_a2
        loop = [(chord["id"], +1)] + path_b2 + [(eid, -sgn) for eid, sgn in reversed(path_a2)]
        if len(loop) >= 1:
            loops.append(loop)

    return loops


# ══════════════════════════════════════════════════════════════════════════════
# МЕТОД КРОССА (Андрияшева–Кросса)
# ══════════════════════════════════════════════════════════════════════════════

def solve_cross(nodes_in, branches_in, options):
    tolerance = float(options.get("tolerance", 0.0001))
    max_iter = int(options.get("maxIter", 50000))
    alpha = float(options.get("alpha", 0.8))  # демпфирование

    diag = []
    log = []

    atm, edges = build_graph(nodes_in, branches_in)
    all_nodes = {e["a"] for e in edges} | {e["b"] for e in edges}

    if not atm:
        diag.append({"level": "error", "message": "Нет атмосферных узлов (устьев стволов)", "category": "topology"})
        return _result(edges, {}, 0, False, 999, log, diag)

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "message": "Нет вентилятора — расход будет нулевым", "category": "topology"})

    # Начальное Q
    Q = initial_Q(edges, atm, diag)
    log.append(f"Кросс: узлов={len(all_nodes)}, ветвей={len(edges)}, вент={len(fans)}")

    # Контуры
    loops = find_loops(edges, all_nodes)
    log.append(f"Контуров: {len(loops)}")

    if not loops:
        diag.append({"level": "info", "message": "Контуры не найдены — сеть линейная, Q из баланса", "category": "topology"})
        # Линейная сеть: Q задаётся вентилятором
        return _linear_solve(edges, atm, Q, log, diag)

    max_res = float("inf")
    it = 0
    for it in range(1, max_iter + 1):
        max_res = 0.0

        for loop in loops:
            # Невязка депрессии контура
            dH = 0.0
            denom = 0.0
            for eid, sgn in loop:
                e = next(x for x in edges if x["id"] == eid)
                q = Q[eid]
                Hf = fan_pressure(e, q) if e["hasFan"] else 0.0
                # R·Q·|Q| — с учётом знака направления в контуре
                rq = e["R"] * q * abs(q)
                dH += sgn * (rq - Hf)
                denom += 2.0 * e["R"] * abs(q)

            if denom < 1e-12:
                continue

            dQ = -alpha * dH / denom
            max_res = max(max_res, abs(dH))

            # Обновляем Q для всех ветвей контура
            for eid, sgn in loop:
                Q[eid] += sgn * dQ

        if max_res < tolerance:
            it += 1
            break

    converged = max_res < tolerance
    if not converged:
        diag.append({"level": "warning",
                     "message": f"Не сошлось за {max_iter} итераций. Погрешность: {max_res:.4f} Па",
                     "category": "convergence"})

    log.append(f"iter={it} max|ΔH|={max_res:.6f}")
    return _result(edges, Q, it, converged, max_res, log, diag)


# ══════════════════════════════════════════════════════════════════════════════
# МКР — Метод контурных расходов (Ньютон–Рафсон по контурным поправкам)
# ══════════════════════════════════════════════════════════════════════════════

def solve_mkr(nodes_in, branches_in, options):
    import numpy as np

    tolerance = float(options.get("tolerance", 0.0001))
    max_iter = int(options.get("maxIter", 50000))

    diag = []
    log = []

    atm, edges = build_graph(nodes_in, branches_in)
    all_nodes = {e["a"] for e in edges} | {e["b"] for e in edges}

    if not atm:
        diag.append({"level": "error", "message": "Нет атмосферных узлов (устьев стволов)", "category": "topology"})
        return _result(edges, {}, 0, False, 999, log, diag)

    fans = [e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level": "warning", "message": "Нет вентилятора — расход будет нулевым", "category": "topology"})

    Q = initial_Q(edges, atm, diag)
    log.append(f"МКР: узлов={len(all_nodes)}, ветвей={len(edges)}, вент={len(fans)}")

    loops = find_loops(edges, all_nodes)
    log.append(f"Контуров: {len(loops)}")
    nc = len(loops)

    if nc == 0:
        diag.append({"level": "info", "message": "Контуры не найдены — сеть линейная", "category": "topology"})
        return _linear_solve(edges, atm, Q, log, diag)

    edge_idx = {e["id"]: i for i, e in enumerate(edges)}
    max_res = float("inf")
    it = 0

    for it in range(1, max_iter + 1):
        # Формируем вектор F и матрицу Якоби J размера nc×nc
        F = np.zeros(nc)
        J = np.zeros((nc, nc))

        for k, loop_k in enumerate(loops):
            dH = 0.0
            for eid, sgn in loop_k:
                e = edges[edge_idx[eid]]
                q = Q[eid]
                Hf = fan_pressure(e, q) if e["hasFan"] else 0.0
                dH += sgn * (e["R"] * q * abs(q) - Hf)
            F[k] = dH

            # Якобиан: dF_k/dΔQ_m
            for m, loop_m in enumerate(loops):
                dfdq = 0.0
                # Ветви общие для контуров k и m
                eids_k = {eid: sgn for eid, sgn in loop_k}
                for eid, sgn_m in loop_m:
                    if eid in eids_k:
                        sgn_k = eids_k[eid]
                        e = edges[edge_idx[eid]]
                        q = Q[eid]
                        # d(R·Q·|Q|)/dQ = 2·R·|Q|
                        dfdq += sgn_k * sgn_m * 2.0 * e["R"] * abs(q)
                J[k, m] = dfdq

        max_res = float(np.max(np.abs(F)))
        if max_res < tolerance:
            it += 1
            break

        # Решаем J·ΔQ = -F
        try:
            dQ_loops = np.linalg.solve(J, -F)
        except np.linalg.LinAlgError:
            dQ_loops, _, _, _ = np.linalg.lstsq(J, -F, rcond=None)

        dQ_loops = np.where(np.isfinite(dQ_loops), dQ_loops, 0.0)

        # Ограничение шага
        step = float(np.max(np.abs(dQ_loops)))
        if step > 500:
            dQ_loops *= 500 / step

        # Обновляем Q
        for k, loop_k in enumerate(loops):
            for eid, sgn in loop_k:
                Q[eid] += sgn * float(dQ_loops[k])

    converged = max_res < tolerance
    if not converged:
        diag.append({"level": "warning",
                     "message": f"Не сошлось за {max_iter} итераций. Погрешность: {max_res:.4f} Па",
                     "category": "convergence"})

    log.append(f"iter={it} max|F|={max_res:.6f}")
    return _result(edges, Q, it, converged, max_res, log, diag)


# ══════════════════════════════════════════════════════════════════════════════
# ЛИНЕЙНАЯ СЕТЬ (без контуров)
# ══════════════════════════════════════════════════════════════════════════════

def _linear_solve(edges, atm, Q_init, log, diag):
    """Простой расчёт для линейной (без замкнутых контуров) сети."""
    fans = [e for e in edges if e["hasFan"]]
    Q = dict(Q_init)

    if fans:
        fe = fans[0]
        # Рабочая точка: H(Q) = R_net · Q²
        # Суммарное R сети (последовательно)
        R_net = sum(e["R"] for e in edges if not e["hasFan"])
        R_net = max(R_net, 1e-9)

        # Бисекция
        lo, hi = 0.0, float(fe.get("qMax", 500))
        for _ in range(100):
            qm = (lo + hi) / 2
            hf = fan_pressure(fe, qm)
            hn = R_net * qm * qm
            if abs(hf - hn) < 0.01:
                break
            if hf > hn:
                lo = qm
            else:
                hi = qm
        Q_wp = (lo + hi) / 2

        for e in edges:
            if e["a"] == fe["a"] or e["b"] == fe["b"] or e["a"] == fe["b"] or e["b"] == fe["a"]:
                Q[e["id"]] = Q_wp if not e["hasFan"] else Q_wp
            Q[e["id"]] = Q_wp

    log.append("Линейная сеть — расход из рабочей точки вентилятора")
    max_res = 0.0
    return _result(edges, Q, 1, True, max_res, log, diag)


# ══════════════════════════════════════════════════════════════════════════════
# ФОРМИРОВАНИЕ ОТВЕТА
# ══════════════════════════════════════════════════════════════════════════════

def _result(edges, Q, it, converged, max_res, log, diag):
    branches_out = []
    for e in edges:
        q = Q.get(e["id"], 0.0)
        H = e["R"] * q * abs(q)
        Hf = fan_pressure(e, q) if e["hasFan"] else 0.0
        area = e.get("area", 0.0)
        vel = abs(q) / area if area > 0.01 else 0.0
        branches_out.append({
            "id": e["id"],
            "Q": round(q, 4),
            "H": round(H, 2),
            "Hfan": round(Hf, 2),
            "velocity": round(vel, 3),
        })

    return {
        "branches": branches_out,
        "nodes": [],
        "iterations": it,
        "converged": converged,
        "maxResidual": round(max_res, 6),
        "log": log,
        "diagnostics": diag,
    }


def _ok(data: dict) -> dict:
    return {"statusCode": 200, "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps(data, ensure_ascii=False)}


def _err(code: int, msg: str) -> dict:
    return {"statusCode": code, "headers": {**CORS, "Content-Type": "application/json"},
            "body": json.dumps({"error": msg}, ensure_ascii=False)}
