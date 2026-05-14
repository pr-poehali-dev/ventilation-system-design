"""
Решатель вентиляционной сети — Python backend.

Метод: узловых давлений (Node Pressure Method) с итерациями Ньютона-Рафсона.
Это промышленный стандарт, используемый в Ventsim, VentGraph, VUMA.

Физика:
  Для ветви i (узлы a→b): Q_i = sign(ΔP_i) · sqrt(|ΔP_i| / R_i)
  где ΔP_i = P_a - P_b + H_fan_i

  В каждом узле k ≠ GND:  Σ Q_входящих - Σ Q_исходящих = 0

Решение: итерационный Ньютон-Рафсон по давлениям P.
  J · ΔP = -F  →  P ← P + ΔP  (с демпфированием)
"""

import json
import math
import os

def handler(event: dict, context) -> dict:
    """Расчёт воздухораспределения вентиляционной сети."""

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
        body = json.loads(event.get("body") or "{}")
        nodes_in = body.get("nodes", [])
        branches_in = body.get("branches", [])
        options = body.get("options", {})

        result = solve_network(nodes_in, branches_in, options)

        return {
            "statusCode": 200,
            "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
            "body": json.dumps(result),
        }
    except Exception as e:
        import traceback
        return {
            "statusCode": 500,
            "headers": {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
            "body": json.dumps({"error": str(e), "trace": traceback.format_exc()}),
        }


GND = "@gnd"


def solve_network(nodes_in: list, branches_in: list, options: dict) -> dict:
    max_iter = options.get("maxIter", 100)
    tol = options.get("tolerance", 0.1)
    log = []

    # ── 1. Ремаппинг атмосферных узлов → GND
    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def remap(nid: str) -> str:
        return GND if nid in atm_ids else nid

    # ── 2. Строим рёбра
    edges = []
    for b in branches_in:
        R = max(1e-6, float(b.get("resistance", 0) or 0))
        has_fan = bool(b.get("hasFan", False))
        fan_mode = b.get("fanMode", "constant")
        H_const = float(b.get("fanPressure", 0) or 0)  # уже в Па

        edges.append({
            "id": b["id"],
            "a": remap(b["fromId"]),
            "b": remap(b["toId"]),
            "R": R,
            "hasFan": has_fan,
            "fanMode": fan_mode,
            "Hconst": H_const,
            "Q": 0.0,
        })

    if not edges:
        return {"ok": False, "branches": [], "nodes": nodes_in, "log": ["Нет ветвей"], "iterations": 0, "maxDeltaQ": 0}

    # ── 3. Список свободных узлов (не GND)
    all_node_ids = set()
    for e in edges:
        all_node_ids.add(e["a"])
        all_node_ids.add(e["b"])

    free_nodes = sorted(all_node_ids - {GND})
    node_idx = {n: i for i, n in enumerate(free_nodes)}
    N = len(free_nodes)

    if N == 0:
        return {"ok": True, "branches": branches_in, "nodes": nodes_in, "log": ["Только атмосфера"], "iterations": 0, "maxDeltaQ": 0}

    log.append(f"Узлов: {len(all_node_ids)}, ветвей: {len(edges)}, свободных: {N}")

    # ── 4. Начальное давление: оцениваем H вентилятора
    H0 = 0.0
    for e in edges:
        if e["hasFan"] and e["fanMode"] == "constant" and e["Hconst"] > 0:
            H0 = max(H0, e["Hconst"])
    if H0 == 0:
        H0 = 1000.0  # если нет вентилятора — ставим заглушку

    P = [H0 * 0.3] * N  # начальное приближение давлений

    # ── 5. Функции расчёта Q и dQ/dP для ветви
    def branch_Q(e: dict, P: list) -> float:
        Pa = 0.0 if e["a"] == GND else P[node_idx[e["a"]]]
        Pb = 0.0 if e["b"] == GND else P[node_idx[e["b"]]]
        H = e["Hconst"] if e["hasFan"] else 0.0
        dP = Pa - Pb + H
        R = e["R"]
        return math.copysign(math.sqrt(abs(dP) / R), dP)

    def branch_dQdP(e: dict, P: list) -> float:
        """|dQ/dP_a| = 1 / (2 * sqrt(R * |ΔP|))"""
        Pa = 0.0 if e["a"] == GND else P[node_idx[e["a"]]]
        Pb = 0.0 if e["b"] == GND else P[node_idx[e["b"]]]
        H = e["Hconst"] if e["hasFan"] else 0.0
        dP = Pa - Pb + H
        R = e["R"]
        abs_dP = max(0.5, abs(dP))
        return 1.0 / (2.0 * math.sqrt(R * abs_dP))

    # ── 6. Ньютон-Рафсон
    max_delta = float("inf")
    it = 0

    for it in range(max_iter):
        # Обновляем Q всех ветвей
        for e in edges:
            q = branch_Q(e, P)
            e["Q"] = q if math.isfinite(q) else 0.0

        # Вектор невязок F[i] = Σ Q_входящих - Σ Q_исходящих в узле i
        F = [0.0] * N
        for e in edges:
            Q = e["Q"]
            if e["a"] != GND:
                F[node_idx[e["a"]]] -= Q
            if e["b"] != GND:
                F[node_idx[e["b"]]] += Q

        max_delta = max(abs(f) for f in F)
        if max_delta < tol:
            it += 1
            break

        # Якобиан J (плотный, N×N)
        J = [[0.0] * N for _ in range(N)]
        for e in edges:
            dqdp = branch_dQdP(e, P)
            ai = -1 if e["a"] == GND else node_idx[e["a"]]
            bi = -1 if e["b"] == GND else node_idx[e["b"]]
            # F_a -= Q → ∂F_a/∂P_a = -dqdp, ∂F_a/∂P_b = +dqdp
            # F_b += Q → ∂F_b/∂P_a = +dqdp, ∂F_b/∂P_b = -dqdp
            if ai >= 0:
                J[ai][ai] -= dqdp
                if bi >= 0:
                    J[ai][bi] += dqdp
            if bi >= 0:
                J[bi][bi] -= dqdp
                if ai >= 0:
                    J[bi][ai] += dqdp

        # Регуляризация диагонали
        for i in range(N):
            if abs(J[i][i]) < 1e-9:
                J[i][i] = -1e-6

        # Решаем J·ΔP = -F методом Гаусса
        dP_vec = gauss_solve(J, [-f for f in F])
        if dP_vec is None:
            log.append(f"Итерация {it}: вырожденная матрица")
            break

        # Демпфирование: max |ΔP| ≤ H0/2
        max_dp = max(abs(x) for x in dP_vec) if dP_vec else 0
        alpha = min(1.0, H0 / 2 / max_dp) if max_dp > H0 / 2 else 1.0

        for i in range(N):
            P[i] += alpha * dP_vec[i]
            if not math.isfinite(P[i]):
                P[i] = 0.0

    log.append(f"Итерации: {it}, max|F| = {max_delta:.4f} м³/с")

    # ── 7. Финальный пересчёт Q
    for e in edges:
        q = branch_Q(e, P)
        e["Q"] = q if math.isfinite(q) else 0.0

    # ── 8. Формируем ответ
    branch_results = []
    for b, e in zip(branches_in, edges):
        # Знак: если fromId → a, то Q сохраняется; если fromId → b, то инвертируем
        a_orig = remap(b["fromId"])
        Q_signed = e["Q"] if e["a"] == a_orig else -e["Q"]
        S = float(b.get("area", 1) or 1)
        V = abs(Q_signed) / S if S > 0 else 0.0
        fan_H = e["Hconst"] if e["hasFan"] else 0.0

        branch_results.append({
            "id": b["id"],
            "flow": round(Q_signed, 3),
            "velocity": round(V, 2),
            "dP": round(e["R"] * Q_signed * abs(Q_signed), 1),
            "fanPressure": round(fan_H, 0) if e["hasFan"] else b.get("fanPressure", 0),
        })

    # ── 9. Давления в узлах
    node_pressures = {}
    for i, nid in enumerate(free_nodes):
        node_pressures[nid] = P[i]

    node_results = []
    for n in nodes_in:
        remapped = remap(n["id"])
        if remapped == GND:
            node_results.append({**n, "computedPressure": 101325})
        else:
            P_node = node_pressures.get(n["id"], 0)
            z_corr = 12 * (-float(n.get("z", 0)))
            node_results.append({**n, "computedPressure": round(101325 + P_node + z_corr)})

    # ── 10. Диагностика
    diagnostics = []

    # Дисбаланс узлов
    bal = {n: 0.0 for n in all_node_ids}
    for e in edges:
        bal[e["a"]] = bal.get(e["a"], 0) - e["Q"]
        bal[e["b"]] = bal.get(e["b"], 0) + e["Q"]

    for nid, b_val in bal.items():
        if nid == GND:
            continue
        if abs(b_val) > 2:
            diagnostics.append({
                "level": "error" if abs(b_val) > 10 else "warning",
                "category": "node_balance",
                "message": f"Дисбаланс в узле {nid[:30]}: ΔQ = {b_val:.2f} м³/с",
                "objectId": nid,
                "value": b_val,
            })

    if max_delta > tol:
        diagnostics.append({
            "level": "error" if max_delta > 1 else "warning",
            "category": "convergence",
            "message": f"max|ΔQ| = {max_delta:.3f} м³/с (норма < {tol})",
            "value": max_delta,
        })

    if not any(b.get("hasFan") for b in branches_in):
        diagnostics.append({
            "level": "warning",
            "category": "topology",
            "message": "Нет ни одного вентилятора — расход будет нулевым",
        })

    return {
        "ok": max_delta < tol,
        "iterations": it,
        "maxDeltaQ": max_delta,
        "branches": branch_results,
        "nodes": node_results,
        "log": log,
        "cyclesCount": 0,
        "diagnostics": diagnostics,
    }


def gauss_solve(A: list, b: list) -> list | None:
    """Метод Гаусса с частичной пивотизацией. Возвращает x или None."""
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]

    for i in range(n):
        # Поиск главного элемента
        max_row = max(range(i, n), key=lambda k: abs(M[k][i]))
        if abs(M[max_row][i]) < 1e-12:
            return None
        M[i], M[max_row] = M[max_row], M[i]

        for k in range(i + 1, n):
            f = M[k][i] / M[i][i]
            for j in range(i, n + 1):
                M[k][j] -= f * M[i][j]

    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        s = M[i][n]
        for j in range(i + 1, n):
            s -= M[i][j] * x[j]
        x[i] = s / M[i][i]
        if not math.isfinite(x[i]):
            return None

    return x
