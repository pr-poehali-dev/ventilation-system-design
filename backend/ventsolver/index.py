"""
Решатель вентиляционной сети.

Метод: узловых давлений (Node Pressure Method) с итерациями Newton-Raphson.
Работает для ЛЮБОЙ топологии: дерево, кольца, смешанная.

Математическая модель:
  Для каждого узла v (кроме GND): Σ Q_i = 0  (1-й закон Кирхгофа)
  Для каждого ребра: Q_i = sign(ΔP_i) * sqrt(|ΔP_i| / R_i)
  Для ребра с вентилятором: ΔP_i_eff = ΔP_i + H_fan
    (вентилятор повышает давление в направлении a→b)

Newton-Raphson:
  F_v = Σ Q_i(P) = 0  для всех свободных узлов
  J_vw = ∂F_v/∂P_w = Σ ∂Q_i/∂P_w
  Итерация: P += -(J^-1) * F

Преимущества перед МКР:
  - Работает для деревьев (без колец)
  - Правильно обрабатывает любую топологию
  - Быстрая сходимость (2-5 итераций при хорошем начальном приближении)
"""

import json
import math

GND       = "@gnd"
EPS_Q     = 0.01    # м³/с — критерий сходимости по дисбалансу
MAX_IT    = 200
MIN_R     = 1e-6
DEFAULT_R = 0.001

SURFACE_ALPHA = {
    "smooth": 9, "concrete": 12, "concrete_rough": 30, "anchor": 35,
    "wood": 60, "metal_arch": 50, "uncoupled": 25, "uncoupled_r": 80,
    "shaft_smooth": 15, "shaft_skip": 45, "lava": 150,
}


def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения вентиляционной сети."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }, "body": ""}
    try:
        body   = json.loads(event.get("body") or "{}")
        result = solve(body.get("nodes", []), body.get("branches", []), body.get("options", {}))
        return {"statusCode": 200,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps(result)}
    except Exception as exc:
        import traceback
        return {"statusCode": 500,
                "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                "body": json.dumps({"error": str(exc), "trace": traceback.format_exc()})}


# ─── Сопротивление ────────────────────────────────────────────────────────────

def calc_r(b: dict) -> float:
    R = float(b.get("resistance") or 0)
    if R > MIN_R:
        return R
    mode = str(b.get("resistanceMode") or "alpha")
    if mode == "manual":
        mr = float(b.get("manualR") or 0)
        return max(MIN_R, mr) if mr > 0 else DEFAULT_R
    S = float(b.get("area") or 0)
    P = float(b.get("perimeter") or 0)
    L = float(b.get("length") or 0)
    if S <= 0.05 or L <= 0 or P <= 0:
        return DEFAULT_R
    if mode == "roughness":
        Dh  = (4 * S) / P
        rel = max(1e-9, float(b.get("roughness") or 1) / 1000 / Dh)
        Rf  = 0.11 * rel ** 0.25 * L * P / (8 * S ** 3)
    else:
        sid   = str(b.get("surfaceId") or "")
        alpha = float(b.get("alphaCoef") or SURFACE_ALPHA.get(sid, 9))
        Rf    = alpha * 1e-4 * P * L / S ** 3
    xi = float(b.get("localXi") or 0)
    Rl = xi * 1.2 / (2 * S * S) if xi > 0 else 0
    return max(MIN_R, Rf + Rl) if (Rf + Rl) > 0 else DEFAULT_R


# ─── Напор вентилятора ────────────────────────────────────────────────────────

def fan_h(e: dict, Q: float) -> float:
    """H(|Q|) ≥ 0 Па. Нагнетает в направлении a→b."""
    if not e.get("hasFan"):
        return 0.0
    mode = str(e.get("fanMode") or "constant")
    fp   = float(e.get("fanPressure") or 0)
    if mode == "constant":
        return max(0.0, fp)
    h0 = float(e.get("h0") or 0)
    h1 = float(e.get("h1") or 0)
    h2 = float(e.get("h2") or 0)
    if h0 == 0 and h1 == 0 and h2 == 0:
        return max(0.0, fp)
    qmax = float(e.get("qMax") or 1e9)
    Qn   = abs(Q)
    if Qn > qmax:
        return 0.0
    return max(0.0, h0 + h1 * Qn + h2 * Qn * Qn)


# ─── Главная функция ──────────────────────────────────────────────────────────

def solve(nodes_in, branches_in, options):
    max_it = int(options.get("maxIter",   MAX_IT))
    eps    = float(options.get("tolerance", EPS_Q))
    log    = []
    diag   = []

    # 1. Атмосферные узлы → GND (опорный узел, давление = 0)
    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}
    def gnd(nid): return GND if nid in atm_ids else nid

    # 2. Строим рёбра
    edges = []
    for b in branches_in:
        edges.append({
            "id":          b["id"],
            "a":           gnd(b["fromId"]),
            "b":           gnd(b["toId"]),
            "R":           calc_r(b),
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

    if not atm_ids:
        diag.append({"level": "error", "category": "topology",
                     "message": "Нет атмосферных узлов. Отметьте ≥2 узла как «атмосфера»."})
    if not any(e["hasFan"] for e in edges):
        diag.append({"level": "warning", "category": "topology",
                     "message": "Нет вентилятора — расход нулевой."})

    # 3. Список свободных узлов (все кроме GND)
    node_set = set()
    for e in edges:
        node_set.add(e["a"]); node_set.add(e["b"])
    free_nodes = sorted(node_set - {GND})
    N = len(free_nodes)
    ni = {v: i for i, v in enumerate(free_nodes)}  # узел → индекс
    log.append(f"Узлов свободных: {N}, ветвей: {len(edges)}")

    if N == 0:
        return _empty(nodes_in, "Только атмосферные узлы")

    # 4. Начальное давление
    # Для вентиляторов: P ≈ H_fan * 0.5 (грубая оценка)
    fan_h_max = max((fan_h(e, 0) for e in edges if e["hasFan"]), default=1000.0)
    P = [fan_h_max * 0.5] * N  # начальное давление всех узлов

    # 5. Newton-Raphson
    max_res = float("inf")
    it = 0

    for it in range(max_it):
        # Давления: Pa[i], Pb[i] (0 для GND)
        def get_p(nid): return P[ni[nid]] if nid in ni else 0.0

        # Токи и невязки
        F   = [0.0] * N
        # Якобиан J[i][j] = ∂F_i/∂P_j
        J   = [[0.0] * N for _ in range(N)]

        for e in edges:
            a, b, R = e["a"], e["b"], e["R"]
            Pa = get_p(a)
            Pb = get_p(b)
            H  = fan_h(e, 0.0)  # начальная оценка напора

            # Эффективное ΔP: от a к b
            # Вентилятор нагнетает в направлении a→b → повышает P_a относительно P_b
            # ΔP_eff = Pa - Pb + H  (H > 0 → ток идёт из a в b)
            dP_eff = Pa - Pb + H
            abs_dP = max(abs(dP_eff), 1e-9)
            Q      = math.copysign(math.sqrt(abs_dP / R), dP_eff)

            # Вклад в невязку: F_a -= Q (отток из a), F_b += Q (приток в b)
            if a in ni: F[ni[a]] -= Q
            if b in ni: F[ni[b]] += Q

            # Производная: dQ/dPa = 1/(2*sqrt(R*|dP|)) = dqdp
            dqdp = 1.0 / (2.0 * math.sqrt(R * abs_dP))

            # Якобиан
            if a in ni:
                ia = ni[a]
                J[ia][ia] -= dqdp
                if b in ni: J[ia][ni[b]] += dqdp
            if b in ni:
                ib = ni[b]
                J[ib][ib] -= dqdp
                if a in ni: J[ib][ni[a]] += dqdp

        max_res = max(abs(f) for f in F)
        if max_res < eps:
            it += 1
            break

        # Решаем J * dP = -F методом Гаусса
        dP_vec = _gauss(J, [-f for f in F], N)
        if dP_vec is None:
            log.append(f"Итерация {it}: система вырождена")
            break

        # Ограничение шага для устойчивости
        max_step = max(abs(d) for d in dP_vec) if dP_vec else 1.0
        alpha = min(1.0, fan_h_max / max(max_step, 1e-9)) if max_step > fan_h_max else 1.0

        for i in range(N):
            P[i] += alpha * dP_vec[i]
            if not math.isfinite(P[i]):
                P[i] = fan_h_max * 0.3

    log.append(f"Итерации: {it}, max|F|={max_res:.4f} м³/с")

    # 6. Финальные токи
    def get_p(nid): return P[ni[nid]] if nid in ni else 0.0

    branch_out = []
    for b_in, e in zip(branches_in, edges):
        a, b, R = e["a"], e["b"], e["R"]
        Pa = get_p(a); Pb = get_p(b)
        H  = fan_h(e, 0.0)
        dP_eff = Pa - Pb + H
        Q_ab   = math.copysign(math.sqrt(max(abs(dP_eff), 0) / R), dP_eff)

        # Знак Q: Q_ab = ток в направлении a→b ребра.
        # Физический знак Q_fromId→toId:
        a_map  = gnd(b_in["fromId"])
        Q_s    = Q_ab if e["a"] == a_map else -Q_ab
        if not math.isfinite(Q_s): Q_s = 0.0

        S  = e["_area"]
        V  = abs(Q_s) / S if S > 0 else 0.0
        dP = e["R"] * Q_s * abs(Q_s)

        branch_out.append({
            "id":       b_in["id"],
            "flow":     round(Q_s, 3),
            "velocity": round(V, 2),
            "dP":       round(dP, 1),
        })

    # 7. Давления узлов
    node_out = []
    for n in nodes_in:
        nid = gnd(n["id"])
        if nid == GND:
            cp = 101325
        else:
            p_rel = get_p(n["id"])
            z_cor = 12.0 * (-float(n.get("z") or 0))
            cp    = round(101325 + p_rel + z_cor)
        node_out.append({**n, "computedPressure": cp})

    # 8. Диагностика
    # Баланс узлов
    fb = {v: 0.0 for v in free_nodes}
    for e in edges:
        a, b, R = e["a"], e["b"], e["R"]
        Pa = get_p(a); Pb = get_p(b)
        H  = fan_h(e, 0.0)
        dP_eff = Pa - Pb + H
        Q_ab   = math.copysign(math.sqrt(max(abs(dP_eff), 0) / R), dP_eff)
        if a in fb: fb[a] -= Q_ab
        if b in fb: fb[b] += Q_ab

    for nid, bv in fb.items():
        if abs(bv) <= 0.5: continue
        diag.append({"level": "error" if abs(bv) > 5 else "warning",
                     "category": "node_balance",
                     "message": f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
                     "objectId": nid, "value": bv})

    # Вентиляторы
    for e in edges:
        if e["hasFan"]:
            # Ток через вентилятор
            a, b = e["a"], e["b"]
            Pa = get_p(a); Pb = get_p(b)
            H  = fan_h(e, 0.0)
            dP_eff = Pa - Pb + H
            Q_fan  = math.copysign(math.sqrt(max(abs(dP_eff), 0) / e["R"]), dP_eff)
            H_act  = fan_h(e, abs(Q_fan))
            if H_act <= 0:
                diag.append({"level": "error", "category": "fan",
                             "message": f"Вент. {e['id'][:25]}: напор=0 (Q={Q_fan:.1f})",
                             "objectId": e["id"]})

    converged = max_res < eps
    if not converged:
        diag.append({"level": "warning", "category": "convergence",
                     "message": f"Не сошлось: max|F|={max_res:.3f} м³/с (норма < {eps})",
                     "value": max_res})

    # Изолированные узлы
    adj2 = {n: [] for n in node_set}
    for e in edges:
        adj2[e["a"]].append(e["b"]); adj2[e["b"]].append(e["a"])
    reach, stk = {GND}, [GND]
    while stk:
        u = stk.pop()
        for v in adj2.get(u, []):
            if v not in reach: reach.add(v); stk.append(v)
    iso = [n for n in node_set if n not in reach]
    if iso:
        diag.append({"level": "error", "category": "topology",
                     "message": f"Изолировано {len(iso)} узлов"})

    return {"ok": converged, "iterations": it, "maxDeltaQ": round(max_res, 4),
            "maxDeltaH": 0.0, "branches": branch_out, "nodes": node_out,
            "log": log, "cyclesCount": 0, "diagnostics": diag}


# ─── Решение системы методом Гаусса ──────────────────────────────────────────

def _gauss(A_in, b_in, n):
    """Решение A*x = b методом Гаусса с частичным выбором ведущего элемента."""
    A = [row[:] for row in A_in]
    b = b_in[:]
    for col in range(n):
        # Частичный выбор
        max_row = max(range(col, n), key=lambda r: abs(A[r][col]))
        if abs(A[max_row][col]) < 1e-12:
            # Вырожденная строка — регуляризация
            A[col][col] = 1e-6
            continue
        A[col], A[max_row] = A[max_row], A[col]
        b[col], b[max_row] = b[max_row], b[col]
        pivot = A[col][col]
        for row in range(col + 1, n):
            if abs(A[row][col]) < 1e-15: continue
            factor = A[row][col] / pivot
            for j in range(col, n):
                A[row][j] -= factor * A[col][j]
            b[row] -= factor * b[col]
    # Обратный ход
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        if abs(A[i][i]) < 1e-12:
            x[i] = 0.0
            continue
        x[i] = (b[i] - sum(A[i][j] * x[j] for j in range(i + 1, n))) / A[i][i]
        if not math.isfinite(x[i]):
            x[i] = 0.0
    return x


def _empty(nodes_in, msg):
    return {"ok": False, "iterations": 0, "maxDeltaQ": 0, "maxDeltaH": 0,
            "branches": [], "nodes": nodes_in, "log": [msg],
            "cyclesCount": 0, "diagnostics": []}


# Псевдоним
solve_network = solve
