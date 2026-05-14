"""
Решатель вентиляционной сети — Python backend.

Метод: узловых давлений (Node Pressure Method) с итерациями Ньютона-Рафсона.
Матричные операции через numpy — быстро даже для 500+ узлов.
"""

import json
import math

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
    import numpy as np

    max_iter = options.get("maxIter", 50)
    tol = options.get("tolerance", 0.5)
    log = []

    # ── 1. Атмосферные узлы → GND (опорное давление = 0)
    atm_ids = {n["id"] for n in nodes_in if n.get("atmosphereLink")}

    def remap(nid: str) -> str:
        return GND if nid in atm_ids else nid

    # ── 2. Рёбра графа
    edges = []
    for b in branches_in:
        R = float(b.get("resistance") or 0)
        R = max(1e-4, R)
        has_fan = bool(b.get("hasFan", False))
        H = float(b.get("fanPressure") or 0) if has_fan else 0.0

        edges.append({
            "id": b["id"],
            "a": remap(b["fromId"]),
            "b": remap(b["toId"]),
            "R": R,
            "H": H,
            "hasFan": has_fan,
        })

    if not edges:
        return {"ok": False, "branches": [], "nodes": nodes_in,
                "log": ["Нет ветвей"], "iterations": 0, "maxDeltaQ": 0}

    # ── 3. Список свободных узлов
    all_nodes = set()
    for e in edges:
        all_nodes.add(e["a"])
        all_nodes.add(e["b"])

    free_nodes = sorted(all_nodes - {GND})
    N = len(free_nodes)
    node_idx = {n: i for i, n in enumerate(free_nodes)}
    log.append(f"Узлов: {len(all_nodes)}, свободных: {N}, ветвей: {len(edges)}")

    if N == 0:
        return {"ok": True, "branches": branches_in, "nodes": nodes_in,
                "log": ["Только атмосфера"], "iterations": 0, "maxDeltaQ": 0}

    # ── 4. Векторы для numpy
    ai_arr = np.array([node_idx[e["a"]] if e["a"] != GND else -1 for e in edges], dtype=np.int32)
    bi_arr = np.array([node_idx[e["b"]] if e["b"] != GND else -1 for e in edges], dtype=np.int32)
    R_arr = np.array([e["R"] for e in edges], dtype=np.float64)
    H_arr = np.array([e["H"] for e in edges], dtype=np.float64)

    # ── 5. Начальное давление
    H_max = float(np.max(H_arr)) if np.any(H_arr > 0) else 1000.0
    P = np.full(N, H_max * 0.3, dtype=np.float64)

    # ── 6. Итерации Ньютона с numpy
    max_delta = float("inf")
    it = 0

    # Маски для быстрого накопления в F и J
    # Для каждого ребра k: ai=индекс узла a, bi=индекс узла b (-1=GND)

    for it in range(max_iter):
        # Давления в узлах ветвей (GND=0)
        Pa = np.where(ai_arr >= 0, P[np.maximum(ai_arr, 0)], 0.0)
        Pb = np.where(bi_arr >= 0, P[np.maximum(bi_arr, 0)], 0.0)

        dP = Pa - Pb + H_arr
        abs_dP = np.abs(dP)
        Q = np.sign(dP) * np.sqrt(abs_dP / R_arr)

        # Вектор невязок F
        F = np.zeros(N, dtype=np.float64)
        # Векторное накопление через np.add.at
        np.add.at(F, ai_arr[ai_arr >= 0], -Q[ai_arr >= 0])
        np.add.at(F, bi_arr[bi_arr >= 0],  Q[bi_arr >= 0])

        max_delta = float(np.max(np.abs(F)))
        if max_delta < tol:
            it += 1
            break

        # Производная |dQ/dP| = 1/(2*sqrt(R*|dP|))
        abs_dP_safe = np.maximum(abs_dP, 0.5)
        dqdp = 1.0 / (2.0 * np.sqrt(R_arr * abs_dP_safe))

        # Якобиан (sparse через numpy)
        J = np.zeros((N, N), dtype=np.float64)

        # Вклад каждого ребра в J
        mask_a = ai_arr >= 0
        mask_b = bi_arr >= 0
        mask_ab = mask_a & mask_b

        # F_a -= Q → ∂F_a/∂P_a = -dqdp, ∂F_a/∂P_b = +dqdp
        ai_valid = ai_arr[mask_a]
        np.add.at(J, (ai_valid, ai_valid), -dqdp[mask_a])

        bi_valid = bi_arr[mask_b]
        np.add.at(J, (bi_valid, bi_valid), -dqdp[mask_b])

        ai_ab = ai_arr[mask_ab]
        bi_ab = bi_arr[mask_ab]
        np.add.at(J, (ai_ab, bi_ab), +dqdp[mask_ab])
        np.add.at(J, (bi_ab, ai_ab), +dqdp[mask_ab])

        # Регуляризация
        diag = np.diag(J)
        small = np.abs(diag) < 1e-9
        J[small, small] = -1e-6

        # Решение системы J·ΔP = -F
        try:
            dP_vec = np.linalg.solve(J, -F)
        except np.linalg.LinAlgError:
            try:
                dP_vec, _, _, _ = np.linalg.lstsq(J, -F, rcond=None)
            except Exception:
                log.append(f"Итерация {it}: не удалось решить систему")
                break

        if not np.all(np.isfinite(dP_vec)):
            log.append(f"Итерация {it}: nan/inf в ΔP")
            break

        # Демпфирование
        max_step = float(np.max(np.abs(dP_vec)))
        alpha = min(1.0, H_max / 2 / max_step) if max_step > H_max / 2 else 1.0

        P += alpha * dP_vec
        P = np.where(np.isfinite(P), P, 0.0)

    log.append(f"Итерации: {it + 1}, max|F| = {max_delta:.3f} м³/с")

    # ── 7. Финальный Q
    Pa = np.where(ai_arr >= 0, P[np.maximum(ai_arr, 0)], 0.0)
    Pb = np.where(bi_arr >= 0, P[np.maximum(bi_arr, 0)], 0.0)
    dP_f = Pa - Pb + H_arr
    Q_final = np.sign(dP_f) * np.sqrt(np.abs(dP_f) / R_arr)
    Q_final = np.where(np.isfinite(Q_final), Q_final, 0.0)

    # ── 8. Результаты ветвей
    branch_results = []
    for i, b in enumerate(branches_in):
        a_orig = remap(b["fromId"])
        q_signed = float(Q_final[i]) if edges[i]["a"] == a_orig else -float(Q_final[i])
        S = float(b.get("area") or 0)
        V = abs(q_signed) / S if S > 0 else 0.0
        H_fan = edges[i]["H"] if edges[i]["hasFan"] else 0.0

        branch_results.append({
            "id": b["id"],
            "flow": round(q_signed, 3),
            "velocity": round(V, 2),
            "dP": round(edges[i]["R"] * q_signed * abs(q_signed), 1),
            "fanPressure": round(H_fan, 0) if edges[i]["hasFan"] else b.get("fanPressure", 0),
        })

    # ── 9. Давления в узлах
    node_results = []
    for n in nodes_in:
        nid = remap(n["id"])
        if nid == GND:
            cp = 101325
        else:
            idx = node_idx.get(n["id"])
            p_val = float(P[idx]) if idx is not None else 0.0
            z_corr = 12 * (-float(n.get("z") or 0))
            cp = round(101325 + p_val + z_corr)
        node_results.append({**n, "computedPressure": cp})

    # ── 10. Диагностика
    diagnostics = []

    bal = np.zeros(N, dtype=np.float64)
    np.add.at(bal, ai_arr[ai_arr >= 0], -Q_final[ai_arr >= 0])
    np.add.at(bal, bi_arr[bi_arr >= 0],  Q_final[bi_arr >= 0])

    for i, nid in enumerate(free_nodes):
        bv = float(bal[i])
        if abs(bv) > 2:
            diagnostics.append({
                "level": "error" if abs(bv) > 10 else "warning",
                "category": "node_balance",
                "message": f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с",
                "objectId": nid, "value": bv,
            })

    if max_delta > tol * 5:
        diagnostics.append({
            "level": "warning", "category": "convergence",
            "message": f"max|ΔQ|={max_delta:.2f} м³/с. Попробуйте увеличить допуск.",
            "value": max_delta,
        })

    zero_fan = [e for e in edges if e["hasFan"] and e["H"] <= 0]
    for e in zero_fan:
        diagnostics.append({
            "level": "error", "category": "fan",
            "message": f"Вентилятор {e['id'][:25]}: напор = 0 Па",
            "objectId": e["id"],
        })

    if not any(e["hasFan"] for e in edges):
        diagnostics.append({
            "level": "warning", "category": "topology",
            "message": "Нет вентилятора — расход нулевой",
        })

    return {
        "ok": max_delta < tol * 2,
        "iterations": it + 1,
        "maxDeltaQ": max_delta,
        "branches": branch_results,
        "nodes": node_results,
        "log": log,
        "cyclesCount": 0,
        "diagnostics": diagnostics,
    }
