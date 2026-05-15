"""
Решатель вентиляционной сети — Метод Контурных Расходов (МКР).
Реализация как в ПО АэроСеть.

Правила:
  - Минимум 2 атмосферных узла + вентилятор для работы расчёта
  - Все атмосферные узлы объединяются в GND (опорный узел)
  - Вентилятор нагнетает воздух по направлению a→b (fromId→toId)
  - Q > 0 означает поток от fromId к toId

Алгоритм МКР (7 шагов):
  Шаг 1. Граф: узлы + рёбра, атмосфера → GND
  Шаг 2. Q^(0) = Q0 (рабочая точка вентилятора), ветви дерева — от корня к листьям
  Шаг 3. R = α·P·L/S³ (пересчитывается если resistance=0 или не передано)
  Шаг 4. BFS-дерево + хорды → независимые контуры
  Шаг 5. Итерации: ΔH_k = Σ R·Qd·|Qd| − Σ H_f·dir; δQ = −ΔH/(2ΣR|Qd|)
  Шаг 6. Стоп: max|ΔH| < 0.1 Па  ИЛИ  max|δQ| < 0.01 м³/с
  Шаг 7. Проверка: баланс узлов, напоры вентиляторов
"""

import json
import math
from collections import deque

GND     = "@gnd"
EPS1    = 0.1       # Па
EPS2    = 0.01      # м³/с
MAX_IT  = 2000
MIN_R   = 1e-6      # Минимальное R (не 1e-9 — слишком мало!)
# Типовое сопротивление для ветви без параметров (штрек 100м, 10м²)
# R = α·P·L/S³ = 9e-4 * 12 * 100 / 1000 = 0.001 Н·с²/м⁸
DEFAULT_R = 0.001


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения вентиляционной сети методом МКР."""

    if event.get("httpMethod") == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
            "body": "",
        }

    try:
        body        = json.loads(event.get("body") or "{}")
        nodes_in    = body.get("nodes", [])
        branches_in = body.get("branches", [])
        options     = body.get("options", {})

        result = solve_network(nodes_in, branches_in, options)

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            "body": json.dumps(result),
        }
    except Exception as exc:
        import traceback
        return {
            "statusCode": 500,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            "body": json.dumps({"error": str(exc), "trace": traceback.format_exc()}),
        }


# =============================================================================
# ШАГ 3. РАСЧЁТ СОПРОТИВЛЕНИЯ R = α·P·L / S³
# =============================================================================

# Справочные значения α (×10⁻⁴ Н·с²/м⁴) по ID поверхности
SURFACE_ALPHA = {
    "smooth":          9,
    "concrete":       12,
    "concrete_rough": 30,
    "anchor":         35,
    "wood":           60,
    "metal_arch":     50,
    "uncoupled":      25,
    "uncoupled_r":    80,
    "shaft_smooth":   15,
    "shaft_skip":     45,
    "lava":          150,
}


def calc_resistance(b: dict) -> float:
    """
    Вычисляет R (Н·с²/м⁸) для ветви.
    Приоритет:
      1. Если resistance передан и > MIN_R — используем его.
      2. Если resistanceMode == "manual" — используем manualR.
      3. Иначе пересчитываем R = α·P·L / S³ (режим alpha/surface/roughness).
    """
    R_given = float(b.get("resistance") or 0)
    if R_given > MIN_R:
        return R_given

    mode = str(b.get("resistanceMode") or "alpha")

    if mode == "manual":
        mr = float(b.get("manualR") or 0)
        return max(MIN_R, mr) if mr > 0 else DEFAULT_R

    S = float(b.get("area") or 0)
    P = float(b.get("perimeter") or 0)
    L = float(b.get("length") or 0)

    if S <= 0.05 or L <= 0 or P <= 0:
        # Нет геометрии — используем типовое сопротивление
        return DEFAULT_R

    if mode == "roughness":
        delta_mm = float(b.get("roughness") or 1)
        Dh = (4 * S) / P
        if Dh <= 0:
            return DEFAULT_R
        rel = max(1e-9, (delta_mm / 1000.0) / Dh)
        lam = 0.11 * (rel ** 0.25)
        R_fric = (lam * L * P) / (8.0 * S ** 3)
    else:
        # alpha или surface
        surf_id = str(b.get("surfaceId") or "")
        alpha = float(b.get("alphaCoef") or SURFACE_ALPHA.get(surf_id, 9))
        a = alpha * 1e-4
        R_fric = (a * P * L) / (S ** 3)

    # Местные сопротивления ξ → R_loc = ξ·ρ/(2·S²)
    xi   = float(b.get("localXi") or 0)
    R_loc = (xi * 1.2) / (2 * S * S) if xi > 0 and S > 0 else 0.0

    R = R_fric + R_loc
    return max(MIN_R, R) if R > 0 else DEFAULT_R


# =============================================================================
# НАПОР ВЕНТИЛЯТОРА
# =============================================================================

def fan_h(edge: dict, Q: float) -> float:
    """
    H(Q) ≥ 0 Па. Вентилятор нагнетает в направлении a→b.
    constant: H = fanPressure.
    curve:    H = h0 + h1·|Q| + h2·Q² (коэффициенты уже с учётом RPM и угла лопаток).
    """
    if not edge.get("hasFan"):
        return 0.0
    fp   = float(edge.get("fanPressure") or 0)
    mode = str(edge.get("fanMode") or "constant")

    if mode == "constant":
        return max(0.0, fp)

    # curve
    h0 = float(edge.get("h0") or 0)
    h1 = float(edge.get("h1") or 0)
    h2 = float(edge.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        return max(0.0, fp)  # кривая не передана

    q_max = float(edge.get("qMax") or 1e9)
    Qn    = abs(Q)
    if Qn > q_max:
        return 0.0   # вне диапазона — вентилятор не работает

    return max(0.0, h0 + h1 * Qn + h2 * Qn * Qn)


def fan_dh(edge: dict, Q: float) -> float:
    """|dH/dQ| — производная напора (только для curve)."""
    if not edge.get("hasFan") or str(edge.get("fanMode") or "") != "curve":
        return 0.0
    h1 = float(edge.get("h1") or 0)
    h2 = float(edge.get("h2") or 0)
    return abs(h1 + 2 * h2 * abs(Q))


def estimate_q0(edges: list, R_eff: float) -> float:
    """
    Начальный Q0: пересечение H_fan(Q) = R_eff·Q².
    R_eff — ЭФФЕКТИВНОЕ сопротивление сети (не сумма, а оценка главного пути).
    """
    fan = next((e for e in edges if e.get("hasFan")), None)
    if not fan:
        return 5.0

    mode  = str(fan.get("fanMode") or "constant")
    H0    = fan_h(fan, 0.0)
    q_min = float(fan.get("qMin") or 0)
    q_max = float(fan.get("qMax") or 100.0)

    if mode == "constant":
        if H0 > 0 and R_eff > 0:
            q = math.sqrt(H0 / R_eff)
            return max(q_min or 0.1, min(q_max, q))
        return max(0.1, q_max * 0.5)

    # curve — бисекция H_fan(q) = R_eff·q²
    if R_eff <= 0:
        return (q_min + q_max) / 2.0

    lo, hi = q_min or 0.0, q_max
    for _ in range(80):
        q  = (lo + hi) / 2.0
        Hf = fan_h(fan, q)
        Hn = R_eff * q * q
        if abs(Hf - Hn) < 0.1:
            break
        if Hf > Hn:
            lo = q
        else:
            hi = q

    q0 = (lo + hi) / 2.0
    # Ограничиваем диапазоном вентилятора
    return max(q_min or 0.1, min(q_max, q0))


# =============================================================================
# BFS-ДЕРЕВО
# =============================================================================

def build_bfs_tree(edges: list, adj: dict, root: str):
    parent    = {root: None}
    visited   = {root}
    tree_set  = set()
    bfs_order = []
    queue     = deque([root])

    while queue:
        u = queue.popleft()
        bfs_order.append(u)
        for item in adj.get(u, []):
            ei, other = item["ei"], item["v"]
            if other not in visited:
                visited.add(other)
                parent[other] = {"node": u, "ei": ei}
                tree_set.add(ei)
                queue.append(other)

    chords  = [i for i in range(len(edges)) if i not in tree_set]
    bfs_pos = {n: i for i, n in enumerate(bfs_order)}
    return parent, bfs_order, tree_set, chords, bfs_pos


# =============================================================================
# ПУТЬ В ДЕРЕВЕ (через LCA)
# =============================================================================

def tree_path(from_v: str, to_v: str, edges: list, parent: dict) -> list:
    """
    Путь от from_v до to_v через LCA.
    dir=+1: ребро обходится a→b; dir=-1: b→a.
    """
    def ancs(v):
        lst = []
        cur = v
        while cur is not None:
            lst.append(cur)
            p = parent.get(cur)
            cur = p["node"] if p else None
        return lst

    af   = ancs(from_v)
    at   = ancs(to_v)
    sf   = {n: i for i, n in enumerate(af)}

    lca, ito = at[0], 0
    for i, n in enumerate(at):
        if n in sf:
            lca, ito = n, i
            break

    ifrom = sf.get(lca, 0)
    res   = []

    # from → LCA (вверх: node → parent)
    for i in range(ifrom):
        v = af[i]
        p = parent[v]
        e = edges[p["ei"]]
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == v else -1})

    # LCA → to (вниз: p["node"] → child)
    for i in range(ito - 1, -1, -1):
        child = at[i]
        p     = parent[child]
        e     = edges[p["ei"]]
        res.append({"ei": p["ei"], "dir": 1 if e["a"] == p["node"] else -1})

    return res


# =============================================================================
# ГЛАВНАЯ ФУНКЦИЯ
# =============================================================================

def solve_network(nodes_in: list, branches_in: list, options: dict) -> dict:
    max_it = int(options.get("maxIter",      MAX_IT))
    eps1   = float(options.get("tolPressure", EPS1))
    eps2   = float(options.get("tolerance",   EPS2))
    log    = []
    diag   = []

    # ── ШАГ 1. ГРАФ ──────────────────────────────────────────────────────────

    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def gnd(nid: str) -> str:
        return GND if nid in atm_ids else nid

    edges = []
    for b in branches_in:
        # ШАГ 3. Расчёт R
        R = calc_resistance(b)
        edges.append({
            "id":          b["id"],
            "a":           gnd(b["fromId"]),
            "b":           gnd(b["toId"]),
            "R":           R,
            "Q":           0.0,
            "hasFan":      bool(b.get("hasFan", False)),
            "fanMode":     str(b.get("fanMode") or "constant"),
            "fanPressure": float(b.get("fanPressure") or 0),
            "h0":          float(b.get("h0") or 0),
            "h1":          float(b.get("h1") or 0),
            "h2":          float(b.get("h2") or 0),
            "qMin":        float(b.get("qMin") or 0),
            "qMax":        float(b.get("qMax") or 100),
            "_fromId":     b["fromId"],
            "_area":       float(b.get("area") or 0),
        })

    if not edges:
        return _empty(nodes_in, "Нет ветвей")

    # Диагностика входных данных
    if not atm_ids:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов. Отметьте ≥2 узла как «атмосфера»."})
    if not any(e["hasFan"] for e in edges):
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход будет нулевым."})

    # Список смежности
    node_set = set()
    for e in edges:
        node_set.add(e["a"])
        node_set.add(e["b"])
    node_list = list(node_set)

    adj = {n: [] for n in node_list}
    for i, e in enumerate(edges):
        adj[e["a"]].append({"ei": i, "v": e["b"]})
        adj[e["b"]].append({"ei": i, "v": e["a"]})

    root = GND if GND in node_set else node_list[0]

    # ── ШАГ 4. КОНТУРЫ ───────────────────────────────────────────────────────

    parent, bfs_order, tree_set, chords, bfs_pos = build_bfs_tree(edges, adj, root)
    log.append(f"Узлов: {len(node_list)}, ветвей: {len(edges)}, контуров: {len(chords)}")

    contours = []
    for ci in chords:
        e    = edges[ci]
        path = tree_path(e["b"], e["a"], edges, parent)
        contours.append([{"ei": ci, "dir": 1}] + path)

    # ── ШАГ 2. ИНИЦИАЛИЗАЦИЯ Q^(0) ───────────────────────────────────────────
    #
    # R_eff = эффективное сопротивление: оцениваем как среднее R дерева,
    # делённое на оценку числа параллельных путей (√N).
    # Это даёт разумный Q0 для разветвлённых сетей.

    R_tree_list = [edges[i]["R"] for i in range(len(edges)) if i in tree_set]
    N_tree = len(R_tree_list)

    if N_tree > 0:
        # Оценка: главный путь от вентилятора до атмосферы
        # Берём среднее R дерева как грубую оценку
        R_avg   = sum(R_tree_list) / N_tree
        # Число "веток" ≈ sqrt(N) для оценки параллельности
        n_paths = max(1, int(math.sqrt(N_tree)))
        R_eff   = R_avg * n_paths   # ≈ R главного пути
    else:
        R_eff = DEFAULT_R

    Q0 = estimate_q0(edges, R_eff)
    log.append(f"Q₀ = {Q0:.2f} м³/с, R_eff = {R_eff:.4f}")

    for i, e in enumerate(edges):
        if i not in tree_set:
            e["Q"] = Q0
        elif e["hasFan"]:
            # Вентилятор ВСЕГДА Q = +Q0 (нагнетает a→b)
            e["Q"] = Q0
        else:
            pa = bfs_pos.get(e["a"], 10**9)
            pb = bfs_pos.get(e["b"], 10**9)
            e["Q"] = Q0 if pb > pa else -Q0

    # ── ШАГ 5. ИТЕРАЦИИ МКР ──────────────────────────────────────────────────

    max_dh = float("inf")
    max_dq = float("inf")
    it     = 0

    for it in range(max_it):
        max_dh = 0.0
        max_dq = 0.0

        for contour in contours:
            num = 0.0
            den = 0.0

            for ce in contour:
                e  = edges[ce["ei"]]
                d  = ce["dir"]
                Qd = e["Q"] * d
                H  = fan_h(e, e["Q"])

                num += e["R"] * Qd * abs(Qd)
                num -= H * d

                den += 2.0 * e["R"] * abs(Qd) + fan_dh(e, e["Q"])

            if den < 1e-12:
                continue

            dQ = -num / den

            if abs(num) > max_dh:
                max_dh = abs(num)
            if abs(dQ) > max_dq:
                max_dq = abs(dQ)

            for ce in contour:
                edges[ce["ei"]]["Q"] += dQ * ce["dir"]

        # Защита от NaN и ограничение Q вентилятора диапазоном кривой
        for e in edges:
            if not math.isfinite(e["Q"]):
                e["Q"] = 0.0
            if e["hasFan"] and str(e.get("fanMode")) == "curve":
                qm = e.get("qMax") or 100.0
                if abs(e["Q"]) > qm:
                    e["Q"] = math.copysign(qm, e["Q"])

        if max_dh < eps1 or max_dq < eps2:
            it += 1
            break

    log.append(f"Итерации: {it}, max|ΔH|={max_dh:.3f} Па, max|δQ|={max_dq:.4f} м³/с")

    # ── ПЕРЕСЧЁТ Q ДЕРЕВА (bottom-up, 1-й закон Кирхгофа) ───────────────────

    balance = {n: 0.0 for n in node_list}
    for i, e in enumerate(edges):
        if i in tree_set:
            continue
        balance[e["a"]] -= e["Q"]
        balance[e["b"]] += e["Q"]

    for idx in range(len(bfs_order) - 1, 0, -1):
        v = bfs_order[idx]
        p = parent.get(v)
        if not p:
            continue
        e     = edges[p["ei"]]
        pnode = p["node"]
        bal   = balance[v]

        if e["b"] == v:
            e["Q"] = -bal
            balance[pnode] -= e["Q"]
        else:
            e["Q"] = bal
            balance[pnode] += e["Q"]

    # ── РЕЗУЛЬТАТЫ ВЕТВЕЙ ────────────────────────────────────────────────────

    branch_out = []
    for i, b in enumerate(branches_in):
        e        = edges[i]
        a_map    = gnd(b["fromId"])
        Q_signed = e["Q"] if e["a"] == a_map else -e["Q"]
        if not math.isfinite(Q_signed):
            Q_signed = 0.0

        S  = float(b.get("area") or 0)
        V  = abs(Q_signed) / S if S > 0 else 0.0
        dP = e["R"] * Q_signed * abs(Q_signed)

        branch_out.append({
            "id":       b["id"],
            "flow":     round(Q_signed, 3),
            "velocity": round(V, 2),
            "dP":       round(dP, 1),
        })

    # ── ДАВЛЕНИЯ УЗЛОВ ───────────────────────────────────────────────────────

    pressure = {root: 0.0}
    pvis     = {root}
    pqueue   = deque([root])

    while pqueue:
        u = pqueue.popleft()
        for item in adj.get(u, []):
            ei, other = item["ei"], item["v"]
            if other in pvis or ei not in tree_set:
                continue
            e  = edges[ei]
            H  = fan_h(e, e["Q"])
            dP = e["R"] * e["Q"] * abs(e["Q"]) - H
            Pu = pressure[u]
            pressure[other] = (Pu - dP) if e["a"] == u else (Pu + dP)
            pvis.add(other)
            pqueue.append(other)

    node_out = []
    for n in nodes_in:
        nid = gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            p_rel = pressure.get(n["id"], 0.0)
            z_cor = 12.0 * (-float(n.get("z") or 0))
            cp    = round(101325 + p_rel + z_cor)
        node_out.append({**n, "computedPressure": cp})

    # ── ШАГ 7. ДИАГНОСТИКА ───────────────────────────────────────────────────

    final_bal = {n: 0.0 for n in node_list}
    for e in edges:
        final_bal[e["a"]] -= e["Q"]
        final_bal[e["b"]] += e["Q"]

    for nid, bv in final_bal.items():
        if nid == GND or abs(bv) <= 0.5:
            continue
        diag.append({
            "level":    "error" if abs(bv) > 5 else "warning",
            "category": "node_balance",
            "message":  f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
            "objectId": nid, "value": bv,
        })

    for e in edges:
        if e["hasFan"]:
            H = fan_h(e, e["Q"])
            if H <= 0:
                diag.append({
                    "level": "error", "category": "fan",
                    "message": f"Вентилятор {e['id'][:25]}: напор=0 Па (fp={e['fanPressure']}, h0={e.get('h0',0):.0f})",
                    "objectId": e["id"],
                })

    converged = max_dh < eps1 or max_dq < eps2
    if not converged:
        diag.append({
            "level": "warning", "category": "convergence",
            "message": f"Не сошлось: max|ΔH|={max_dh:.2f} Па, max|δQ|={max_dq:.3f} м³/с",
            "value": max_dq,
        })

    reachable = {root}
    stk = [root]
    while stk:
        u = stk.pop()
        for item in adj.get(u, []):
            ov = item["v"]
            if ov not in reachable:
                reachable.add(ov)
                stk.append(ov)
    isolated = [n for n in node_list if n not in reachable]
    if isolated:
        diag.append({"level": "error", "category": "topology",
                     "message": f"Изолировано {len(isolated)} узлов"})

    return {
        "ok":          converged,
        "iterations":  it,
        "maxDeltaQ":   round(max_dq, 4),
        "maxDeltaH":   round(max_dh, 3),
        "branches":    branch_out,
        "nodes":       node_out,
        "log":         log,
        "cyclesCount": len(chords),
        "diagnostics": diag,
    }


def _empty(nodes_in, msg):
    return {
        "ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
        "branches": [], "nodes": nodes_in, "log": [msg],
        "cyclesCount": 0, "diagnostics": [],
    }
