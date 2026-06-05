"""
Аэродинамические расчёты горных выработок (формулы Аткинсона/Альтшуля).
Источник: АэроСеть / Вентиляция 2.0, справочник ВНИИГД / Воронина.

POST: {
  branches: [{
    id, shape, diameter?, width?, height?, topWidth?, archHeight?,
    area?, perimeter?,                   -- для custom-сечения
    resistanceMode, alphaCoef, roughness, manualR, localXi,
    length, flow?, rho?
  }]
}

Ответ: { branches: [{id, area, perimeter, dh, resistance, rFriction,
                       rLocal, lambda, velocity, dP, power, reynolds}] }
"""
import json, math

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


# ─── Геометрия сечения ─────────────────────────────────────────────────────────

def calc_section(b: dict) -> dict:
    shape = b.get("shape", "custom")
    area = perimeter = 0.0

    if shape == "round":
        d = float(b.get("diameter") or 0)
        area = math.pi * d * d / 4
        perimeter = math.pi * d

    elif shape == "rect":
        a = float(b.get("width") or b.get("rectWidth") or 0)
        h = float(b.get("height") or b.get("rectHeight") or 0)
        area = a * h
        perimeter = 2 * (a + h)

    elif shape == "trap":
        a = float(b.get("width") or 0)
        c = float(b.get("topWidth") or b.get("trapTopWidth") or a)
        h = float(b.get("height") or 0)
        area = ((a + c) / 2) * h
        side = math.sqrt(h * h + ((a - c) / 2) ** 2)
        perimeter = a + c + 2 * side

    elif shape == "arch":
        a = float(b.get("width") or 0)
        ht = float(b.get("height") or 0)
        arch_h = b.get("archHeight") or b.get("arch_height")
        h = min(float(arch_h), a / 2) if arch_h and float(arch_h) > 0 else (a / 2)
        r = (a * a / 4 + h * h) / (2 * h) if h > 0 else (a / 2 if a > 0 else 0)
        sin_half = min(1.0, a / (2 * r)) if a > 0 and r > 0 else 0
        theta = 2 * math.asin(sin_half)
        arc_area = r * r * (theta - math.sin(theta)) / 2
        arc_len = r * theta
        area = a * ht + arc_area
        perimeter = a + 2 * ht + arc_len

    else:  # custom
        area = float(b.get("area") or 0)
        perimeter = float(b.get("perimeter") or 0)

    dh = (4 * area) / perimeter if perimeter > 0 else 0
    return {"area": round(area, 3), "perimeter": round(perimeter, 2), "dh": round(dh, 3)}


# ─── Сопротивление ────────────────────────────────────────────────────────────

def resistance_from_alpha(alpha, P, L, S):
    if S <= 0.05 or L <= 0 or P <= 0:
        return 0.0
    a = alpha * 1e-4
    r = (a * P * L) / (S ** 3)
    return min(r, 1000.0) if math.isfinite(r) else 0.0


def resistance_from_roughness(delta_mm, S, P, L, Re=None):
    if S <= 0.05 or P <= 0 or L <= 0:
        return 0.0
    Dh = (4 * S) / P
    if Dh <= 0:
        return 0.0
    rel_r = max(0.0, (delta_mm / 1000.0) / Dh)
    lam = 0.11 * ((rel_r + 68 / Re) ** 0.25) if Re and Re > 0 else \
          0.11 * (max(1e-9, rel_r) ** 0.25)
    r = (lam * L * P) / (8 * S ** 3)
    return min(r, 1000.0) if math.isfinite(r) else 0.0


def calc_resistance(b: dict, S: float, P: float, L: float, rho: float, Q: float) -> dict:
    Dh = (4 * S) / P if P > 0 else 0
    mode = b.get("resistanceMode", "alpha")
    alpha = float(b.get("alphaCoef") or 35)
    roughness = float(b.get("roughness") or 50)
    manual_r = float(b.get("manualR") or 0) * 9.81  # кмюрг → Н·с²/м⁸
    local_xi = float(b.get("localXi") or 0)

    # Число Рейнольдса
    Re = None
    if Q and S > 0 and Dh > 0:
        V = Q / S
        Re = V * Dh / 1.5e-5

    r_friction = 0.0
    lam = None
    rho_factor = rho / 1.2

    if mode in ("alpha", "surface"):
        r_friction = resistance_from_alpha(alpha, P, L, S) * rho_factor
    elif mode == "roughness":
        r_friction = resistance_from_roughness(roughness, S, P, L, Re)
        rel_r = (roughness / 1000.0) / (Dh or 1)
        lam = 0.11 * ((rel_r + 68 / Re) ** 0.25 if Re and Re > 0 else max(1e-9, rel_r) ** 0.25)
    elif mode == "manual":
        r_friction = manual_r

    r_local = (local_xi * rho) / (2 * S * S) if S > 0 else 0.0
    return {"R": r_friction + r_local, "Rfriction": r_friction, "Rlocal": r_local,
            "lambda": lam, "Re": Re, "Dh": Dh}


# ─── Вспомогательные формулы ──────────────────────────────────────────────────

def calc_velocity(Q, S):
    return Q / S if S > 0 else 0.0


def calc_depression(R, Q):
    dp = R * abs(Q) * Q
    return dp if math.isfinite(dp) else 0.0


def calc_air_power(dP, Q):
    p = abs(dP * Q)
    return p if math.isfinite(p) else 0.0


# ─── Основная обработка ───────────────────────────────────────────────────────

def calc_branch_aero(b: dict) -> dict:
    sec = calc_section(b)
    area = sec["area"]
    perimeter = sec["perimeter"]
    dh = sec["dh"]

    length = float(b.get("length") or 0)
    Q = float(b.get("flow") or 0)
    rho = float(b.get("rho") or 1.2)

    r = calc_resistance(b, area, perimeter, length, rho, Q)
    total_r = r["R"]

    V = calc_velocity(Q, area)
    dP = calc_depression(total_r, Q)
    N = calc_air_power(dP, Q)
    Re = area > 0 and dh > 0 and round((V * dh) / 1.5e-5) or 0

    return {
        "id":          b.get("id"),
        "area":        area,
        "perimeter":   perimeter,
        "dh":          dh,
        "resistance":  round(total_r, 6),
        "rFriction":   round(r["Rfriction"], 6),
        "rLocal":      round(r["Rlocal"], 6),
        "lambda":      round(r["lambda"], 5) if r["lambda"] is not None else 0,
        "velocity":    round(V * 100) / 100,
        "dP":          round(dP * 10) / 10,
        "power":       round(N),
        "reynolds":    round(Re),
    }


def handler(event: dict, context) -> dict:
    """Аэродинамический расчёт выработок: Аткинсон, Альтшуль, геометрия сечений."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = json.loads(event.get("body") or "{}")
    branches_in = body.get("branches", [])

    result = [calc_branch_aero(b) for b in branches_in]
    return {"statusCode": 200, "headers": CORS,
            "body": json.dumps({"branches": result}, ensure_ascii=False)}
