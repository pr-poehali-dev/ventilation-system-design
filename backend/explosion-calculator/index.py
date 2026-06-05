"""
Расчёт параметров воздушных ударных волн при взрывах.

POST: {
  method: "gas_dynamics" | "fnip_494",
  sourceType: "gas" | "mass",
  gasId, gasVolume_m3, gasConcentration,
  explosiveId, explosiveMass_kg,
  excavationArea_m2, excavationLength_m,
  ambientPressure_kPa, considerWalls,
  distances: [r1, r2, ...]   — опционально, давление в точках
}
"""
import json, math

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

Q_TNT   = 4520.0   # кДж/кг — теплота взрыва ТНТ
P0      = 101.3    # кПа    — атмосферное давление
C0      = 340.0    # м/с    — скорость звука

GAS_TYPES = {
    "methane":   {"qCombust": 33.8,  "lowerLimit": 5.0,  "upperLimit": 15.0, "stoichConc": 9.5,  "efficiency": 0.08},
    "hydrogen":  {"qCombust": 10.8,  "lowerLimit": 4.0,  "upperLimit": 75.0, "stoichConc": 29.5, "efficiency": 0.10},
    "propane":   {"qCombust": 93.2,  "lowerLimit": 2.1,  "upperLimit": 9.5,  "stoichConc": 4.0,  "efficiency": 0.07},
    "acetylene": {"qCombust": 56.0,  "lowerLimit": 2.5,  "upperLimit": 80.0, "stoichConc": 7.7,  "efficiency": 0.12},
    "coal_dust": {"qCombust": 22.0,  "lowerLimit": 60.0, "upperLimit": 400.0,"stoichConc": 200,  "efficiency": 0.05},
}

EXPLOSIVE_TYPES = {
    "tnt":       {"tntEq": 1.00},
    "ammonit":   {"tntEq": 0.97},
    "granulite": {"tntEq": 0.85},
    "igdanit":   {"tntEq": 0.90},
    "anfo":      {"tntEq": 0.82},
    "emulsion":  {"tntEq": 0.80},
    "custom":    {"tntEq": 1.00},
}

HAZARD_THRESHOLDS = {"lethal": 100, "heavy": 50, "medium": 30, "light": 10, "safe": 5}


def gas_to_tnt(gas, volume_m3, concentration_pct):
    fuel_fraction = concentration_pct / 100.0
    fuel_vol = volume_m3 * fuel_fraction
    e_chem = fuel_vol * gas["qCombust"]
    e_mech = e_chem * gas["efficiency"] * 1000
    return e_mech / Q_TNT


def sadovsky_delta_p(r_m, q_tnt):
    if q_tnt <= 0 or r_m <= 0:
        return 0.0
    r_bar = r_m / (q_tnt ** (1.0 / 3.0))
    if r_bar < 0.1:
        return 10000.0
    return round(P0 * (0.84 / r_bar + 2.7 / r_bar**2 + 7.15 / r_bar**3), 1)


def fnip494_delta_p(r_m, q_tnt):
    if q_tnt <= 0 or r_m <= 0:
        return 0.0
    return round(1.07 * (q_tnt / r_m**3) ** (1.0 / 3.0) * P0, 1)


def sadovsky_impulse(r_m, q_tnt):
    if q_tnt <= 0 or r_m <= 0:
        return 0.0
    return round(200 * q_tnt ** (1.0 / 3.0) / r_m, 1)


def wave_front_speed(delta_p_kpa):
    return round(C0 * math.sqrt(1 + (6.0 / 7.0) * (delta_p_kpa / P0)), 1)


def wall_reflection_factor(area_m2):
    if area_m2 <= 0:  return 1.5
    if area_m2 < 10:  return 2.0
    if area_m2 < 20:  return 1.8
    if area_m2 < 40:  return 1.5
    return 1.3


def hazard_level(dp):
    if dp >= 100: return "lethal"
    if dp >= 50:  return "heavy"
    if dp >= 30:  return "medium"
    if dp >= 10:  return "light"
    return "safe"


def radius_at_pressure(target_p, q_tnt, method, wall_factor):
    if target_p <= 0 or q_tnt <= 0:
        return 0
    lo, hi = 0.1, 5000.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        dp_fn = sadovsky_delta_p if method == "gas_dynamics" else fnip494_delta_p
        dp = dp_fn(mid, q_tnt) * wall_factor
        if dp > target_p:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2.0)


def pressure_at(r, q_tnt, method, wall_factor):
    dp_fn = sadovsky_delta_p if method == "gas_dynamics" else fnip494_delta_p
    return round(dp_fn(r, q_tnt) * wall_factor, 1)


def handler(event: dict, context) -> dict:
    """Расчёт параметров воздушной ударной волны при взрыве (Садовский / ФНиП-494)."""
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    body = json.loads(event.get("body") or "{}")

    method       = body.get("method", "gas_dynamics")
    source_type  = body.get("sourceType", "gas")
    area_m2      = float(body.get("excavationArea_m2", 12))
    consider_walls = bool(body.get("considerWalls", True))
    distances    = body.get("distances", [])

    log = []
    warnings = []

    # 1. Тротиловый эквивалент
    q_tnt = 0.0
    if source_type == "gas":
        gas_id  = body.get("gasId", "methane")
        gas     = GAS_TYPES.get(gas_id, GAS_TYPES["methane"])
        volume  = float(body.get("gasVolume_m3", 100))
        conc    = float(body.get("gasConcentration", 9.5))
        if conc < gas["lowerLimit"]:
            warnings.append(f"Концентрация {conc}% ниже НПВ ({gas['lowerLimit']}%) — смесь не взрывоопасна")
        elif conc > gas["upperLimit"]:
            warnings.append(f"Концентрация {conc}% выше ВПВ ({gas['upperLimit']}%) — смесь не взрывоопасна")
        eff_conc = min(conc, gas["stoichConc"] * 1.2)
        q_tnt = gas_to_tnt(gas, volume, eff_conc)
        log.append(f"Газ: {gas_id}, объём: {volume} м³, концентрация: {conc}%")
    else:
        expl_id = body.get("explosiveId", "ammonit")
        expl    = EXPLOSIVE_TYPES.get(expl_id, EXPLOSIVE_TYPES["ammonit"])
        mass_kg = float(body.get("explosiveMass_kg", 10))
        q_tnt   = mass_kg * expl["tntEq"]
        log.append(f"ВВ: {expl_id}, масса: {mass_kg} кг, k_тнт = {expl['tntEq']}")

    if q_tnt <= 0:
        warnings.append("Тротиловый эквивалент = 0 — расчёт невозможен")
        q_tnt = 0.001

    q_tnt_rounded = round(q_tnt * 100) / 100
    log.append(f"Тротиловый эквивалент: Q_tnt = {q_tnt_rounded} кг ТНТ")

    # 2. Коэффициент выработки
    wall_factor = wall_reflection_factor(area_m2) if consider_walls else 1.0
    if consider_walls:
        log.append(f"Коэффициент отражения от стенок: k = {wall_factor}")

    # 3. Параметры в эпицентре (r=1м)
    max_dp   = pressure_at(1.0, q_tnt, method, wall_factor)
    max_imp  = round(sadovsky_impulse(1.0, q_tnt) * wall_factor, 1)
    wave_spd = wave_front_speed(max_dp)

    log.append(f"Методика: {'Газодинамическая (Садовский)' if method == 'gas_dynamics' else 'ФНиП №494'}")
    log.append(f"Давление во фронте (r=1м): ΔP = {max_dp} кПа")
    log.append(f"Скорость фронта: D = {wave_spd} м/с")

    # 4. Зоны поражения
    zone_defs = [
        ("Летальная",          "ΔP > 100 кПа — летальный исход, полное разрушение", HAZARD_THRESHOLDS["lethal"],  "lethal"),
        ("Тяжёлые поражения",  "ΔP 50–100 кПа — тяжёлые травмы, обрушение",         HAZARD_THRESHOLDS["heavy"],   "heavy"),
        ("Средние поражения",  "ΔP 30–50 кПа — средние травмы, повреждение",          HAZARD_THRESHOLDS["medium"],  "medium"),
        ("Лёгкие поражения",   "ΔP 10–30 кПа — контузии, лёгкие повреждения",         HAZARD_THRESHOLDS["light"],   "light"),
        ("Безопасная зона",    "ΔP < 10 кПа — незначительное воздействие",            HAZARD_THRESHOLDS["safe"],    "safe"),
    ]
    zones = []
    for name, desc, thresh, hlevel in zone_defs:
        r = radius_at_pressure(thresh, q_tnt, method, wall_factor)
        imp = round(sadovsky_impulse(r, q_tnt) * wall_factor, 1) if r > 0 else 0
        zones.append({"name": name, "description": desc, "radius_m": r,
                      "deltaP_kPa": thresh, "impulse_Pas": imp, "hazardLevel": hlevel})
        log.append(f"{name}: r = {r} м, ΔP = {thresh} кПа")

    # 5. Давление в произвольных точках (опционально)
    pressure_points = []
    for r in distances:
        dp = pressure_at(float(r), q_tnt, method, wall_factor)
        imp = round(sadovsky_impulse(float(r), q_tnt) * wall_factor, 1)
        pressure_points.append({"r_m": r, "deltaP_kPa": dp, "impulse_Pas": imp,
                                 "hazardLevel": hazard_level(dp)})

    result = {
        "q_tnt_kg":           q_tnt_rounded,
        "maxDeltaP_kPa":      max_dp,
        "maxImpulse_Pas":     max_imp,
        "waveFrontSpeed_ms":  wave_spd,
        "zones":              zones,
        "pressurePoints":     pressure_points,
        "log":                log,
        "warnings":           warnings,
    }
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(result, ensure_ascii=False)}
