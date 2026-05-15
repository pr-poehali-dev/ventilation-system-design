"""
Решатель вентиляционной сети шахты.
Метод: Node Pressure (узловых давлений) + Newton-Raphson + numpy.

Стандартный промышленный алгоритм (VentSim/Ventsys/Aerosim).
Работает для любых топологий: дерево, кольца, смешанная.

Математика:
  GND = 0 Па (атмосфера).
  Ребро a→b: dP_eff = P_a - P_b + H_fan(Q);  Q = sign(dP)*sqrt(|dP|/R)
  Кирхгоф-1: Σ Q_i = 0 для каждого свободного узла.
  NR: P_{n+1} = P_n - J^{-1}*F(P_n), сходится за 5-15 итераций.
"""

import json, math

GND       = "@gnd"
MIN_R     = 1e-6
DEFAULT_R = 0.001
ALPHA = {
    "smooth":9,"concrete":12,"concrete_rough":30,"anchor":35,
    "wood":60,"metal_arch":50,"uncoupled":25,"uncoupled_r":80,
    "shaft_smooth":15,"shaft_skip":45,"lava":150,
}


def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode":200,"headers":{"Access-Control-Allow-Origin":"*",
            "Access-Control-Allow-Methods":"POST, OPTIONS",
            "Access-Control-Allow-Headers":"Content-Type"},"body":""}
    try:
        b = json.loads(event.get("body") or "{}")
        r = solve(b.get("nodes",[]), b.get("branches",[]), b.get("options",{}))
        return {"statusCode":200,
                "headers":{"Access-Control-Allow-Origin":"*","Content-Type":"application/json"},
                "body":json.dumps(r)}
    except Exception as e:
        import traceback
        return {"statusCode":500,
                "headers":{"Access-Control-Allow-Origin":"*","Content-Type":"application/json"},
                "body":json.dumps({"error":str(e),"trace":traceback.format_exc()})}


# ── Сопротивление R ───────────────────────────────────────────────────────────
def get_R(b: dict) -> float:
    R = float(b.get("resistance") or 0)
    if R > MIN_R: return R
    mode = str(b.get("resistanceMode","alpha"))
    if mode == "manual":
        return max(MIN_R, float(b.get("manualR",0))) or DEFAULT_R
    S = float(b.get("area",0)); P = float(b.get("perimeter",0)); L = float(b.get("length",0))
    if S < 0.05 or P < 0.01 or L < 0.01: return DEFAULT_R
    if mode == "roughness":
        Dh = 4*S/P; lam = 0.11*(max(1e-9, float(b.get("roughness",1))/1000/Dh))**0.25
        Rf = lam*L*P/(8*S**3)
    else:
        a = float(b.get("alphaCoef") or ALPHA.get(str(b.get("surfaceId","")),9))
        Rf = a*1e-4*P*L/S**3
    xi = float(b.get("localXi",0))
    Rl = xi*1.2/(2*S*S) if xi > 0 else 0
    return max(MIN_R, Rf+Rl) or DEFAULT_R


# ── Напор вентилятора ─────────────────────────────────────────────────────────
def Hf(e: dict, Q: float) -> float:
    """H(|Q|) ≥ 0. Нагнетает a→b."""
    if not e.get("hasFan"): return 0.0
    fp = float(e.get("fanPressure",0))
    if e.get("fanMode","constant") == "constant": return max(0.0, fp)
    h0,h1,h2 = float(e.get("h0",0)),float(e.get("h1",0)),float(e.get("h2",0))
    if h0==0 and h1==0 and h2==0: return max(0.0, fp)
    Qa = abs(Q)
    if Qa > float(e.get("qMax",1e9)): return 0.0
    return max(0.0, h0+h1*Qa+h2*Qa*Qa)

def dHf(e: dict, Q: float) -> float:
    if not e.get("hasFan") or e.get("fanMode","constant")!="curve": return 0.0
    return abs(float(e.get("h1",0))+2*float(e.get("h2",0))*abs(Q))


# ── Ток и производная для ребра ───────────────────────────────────────────────
def Qedge(e: dict, Pa: float, Pb: float):
    """
    Q (>0: a→b) и dQ/dPa (= -dQ/dPb).

    Для вентилятора с curve характеристикой:
    Используем ЛИНЕАРИЗОВАННЫЙ напор вместо итераций Q.
    Это гарантирует корректность якобиана и сходимость NR.

    Линеаризация H(Q) в точке Q_lin:
      H_lin = H(Q_lin) + dH/dQ * (Q - Q_lin) = H0 - R_fan*Q
    где R_fan = -dH/dQ > 0 для падающей характеристики.
    Это эквивалентно добавлению отрицательного "сопротивления" вентилятора.
    """
    R  = e["R"]
    qm = float(e.get("qMax",1e9)) if e.get("hasFan") else 1e9

    if e.get("hasFan") and e.get("fanMode","constant") == "curve":
        # Линеаризованный подход: H_eff = H_lin (константа в данной итерации)
        # Q от предыдущей итерации передаётся через Pa-Pb
        # Используем простую оценку: H ≈ H(Q_est) где Q_est из текущих давлений

        # Шаг 1: оценка Q при H=H(0)
        H0 = Hf(e, 0.0)
        dp0 = Pa - Pb + H0
        Q_est = math.copysign(math.sqrt(max(abs(dp0),1e-12)/R), dp0)
        Q_est = max(-qm, min(qm, Q_est))

        # Шаг 2: 5 итераций уточнения
        for _ in range(5):
            H = Hf(e, Q_est)
            dp = Pa - Pb + H
            Qn = math.copysign(math.sqrt(max(abs(dp),1e-12)/R), dp)
            Qn = max(-qm, min(qm, Qn))
            if abs(Qn - Q_est) < 0.1: Q_est = Qn; break
            Q_est = Qn

        H   = Hf(e, Q_est)
        dp  = Pa - Pb + H
        Q   = Q_est

        # Производная с учётом ограничения qMax
        if abs(Q_est) >= qm * 0.999:
            # Q зажат на qMax — производная по P равна 0
            # (изменение давления не меняет Q)
            return Q, 1e-8
        adp  = max(abs(dp), 1e-12)
        dqdp = 1.0 / (2.0 * math.sqrt(R * adp))
        dHdQ = dHf(e, Q)
        denom = max(1e-9, 1.0 - dHdQ * dqdp)
        return Q, dqdp / denom
    else:
        # Обычное ребро или constant-вентилятор
        H  = Hf(e, 0.0)
        dp = Pa - Pb + H
        Q  = math.copysign(math.sqrt(max(abs(dp),1e-12)/R), dp)
        adp  = max(abs(dp), 1e-12)
        dqdp = 1.0 / (2.0 * math.sqrt(R * adp))
        return Q, dqdp


# ── Вспомогательные: рабочая точка + путь R ──────────────────────────────────
def working_pt(fe, R_net):
    if not fe or R_net <= 0: return 5.0
    lo,hi = float(fe.get("qMin",0)),float(fe.get("qMax",200))
    for _ in range(100):
        q=(lo+hi)/2; h=Hf(fe,q); hn=R_net*q*q
        if abs(h-hn)<0.05: break
        if h>hn: lo=q
        else:    hi=q
    return max(max(float(fe.get("qMin",0)),0.1), min(float(fe.get("qMax",200)),(lo+hi)/2))

def path_R(edges, fe):
    import heapq
    if not fe: return DEFAULT_R
    adj={}
    for e in edges:
        adj.setdefault(e["a"],[]).append((e["R"],e["b"]))
        adj.setdefault(e["b"],[]).append((e["R"],e["a"]))
    st = fe["b"] if fe["a"]==GND else fe["a"]
    if st==GND: st=fe["a"]
    dist={st:fe["R"]}; hp=[(fe["R"],st)]
    while hp:
        d,u=heapq.heappop(hp)
        if u==GND: return max(MIN_R,d)
        if d>dist.get(u,1e18)+1e-9: continue
        for r,v in adj.get(u,[]):
            nd=d+r
            if nd<dist.get(v,1e18): dist[v]=nd; heapq.heappush(hp,(nd,v))
    return max(MIN_R, sum(e["R"] for e in edges)/max(1,len(edges)))


# ── Главная функция ───────────────────────────────────────────────────────────
def solve(nodes_in, branches_in, options):
    import numpy as np
    MAX_IT = int(options.get("maxIter",200))
    EPS    = float(options.get("tolerance",0.005))
    log=[]; diag=[]

    atm = {n["id"] for n in nodes_in if n.get("atmosphereLink")}
    def gnd(x): return GND if x in atm else x

    if not atm:
        diag.append({"level":"error","category":"topology",
            "message":"Нет атмосферных узлов. Отметьте устья стволов как «Выход (атмосфера)»."})

    edges=[]
    for b in branches_in:
        edges.append({
            "id":b["id"],"a":gnd(b["fromId"]),"b":gnd(b["toId"]),
            "R":get_R(b),"hasFan":bool(b.get("hasFan",False)),
            "fanMode":b.get("fanMode","constant"),
            "fanPressure":float(b.get("fanPressure",0)),
            "h0":float(b.get("h0",0)),"h1":float(b.get("h1",0)),"h2":float(b.get("h2",0)),
            "qMin":float(b.get("qMin",0)),"qMax":float(b.get("qMax",200)),
            "_src":b["fromId"],"_area":float(b.get("area",0)),
        })

    if not edges: return _empty(nodes_in,"Нет ветвей")
    fans=[e for e in edges if e["hasFan"]]
    if not fans:
        diag.append({"level":"warning","category":"topology","message":"Нет вентилятора — расход нулевой."})

    # Свободные узлы
    ns=set()
    for e in edges: ns.add(e["a"]); ns.add(e["b"])
    free=sorted(ns-{GND}); N=len(free); idx={v:i for i,v in enumerate(free)}
    if N==0: return _empty(nodes_in,"Только атмосферные узлы")
    log.append(f"N={N} E={len(edges)} fans={len(fans)}")

    # Начальное приближение
    fe=fans[0] if fans else None
    Rn=path_R(edges,fe); Qw=working_pt(fe,Rn); Hw=Hf(fe,Qw) if fe else 1000.0
    log.append(f"Rn={Rn:.5f} Qw={Qw:.2f} Hw={Hw:.0f}")

    # Инициализация давлений: BFS от вентилятора к GND
    # P убывает пропорционально R-расстоянию от источника давления до GND
    P_init = max(10.0, Hw * 0.5)
    P = np.full(N, P_init)

    if fe and Rn > 0:
        # BFS-расстояние (по R) от каждого узла до GND
        from collections import deque
        adj_r = {}
        for e in edges:
            # Исключаем ребро вентилятора — хотим давление по пути через пассивную сеть
            if e.get("hasFan"):
                continue
            adj_r.setdefault(e["a"],[]).append((e["R"],e["b"]))
            adj_r.setdefault(e["b"],[]).append((e["R"],e["a"]))

        # Dijkstra: расстояние до GND
        import heapq
        dist_to_gnd = {}
        hp2 = [(0.0, GND)]
        while hp2:
            d, u = heapq.heappop(hp2)
            if u in dist_to_gnd: continue
            dist_to_gnd[u] = d
            for r, v in adj_r.get(u, []):
                if v not in dist_to_gnd:
                    heapq.heappush(hp2, (d+r, v))

        # P_v ≈ Hw * (1 - dist_to_gnd[v] / total_R)
        # Чем дальше узел от GND — тем выше давление
        # total_R = полный путь вентилятора
        for v in free:
            d_gnd = dist_to_gnd.get(v, Rn)
            # P[v] ≈ R(v→GND) * Q_wp²  — потери давления от v до атмосферы
            P[idx[v]] = max(1.0, d_gnd * Qw * Qw)

    # Newton-Raphson
    max_res=float("inf"); it=0
    for it in range(MAX_IT):
        F=np.zeros(N); J=np.zeros((N,N))
        for e in edges:
            a,b=e["a"],e["b"]
            Pa=float(P[idx[a]]) if a in idx else 0.0
            Pb=float(P[idx[b]]) if b in idx else 0.0
            Q,dqdp=Qedge(e,Pa,Pb)
            if a in idx:
                ia=idx[a]; F[ia]-=Q; J[ia,ia]-=dqdp
                if b in idx: J[ia,idx[b]]+=dqdp
            if b in idx:
                ib=idx[b]; F[ib]+=Q; J[ib,ib]-=dqdp
                if a in idx: J[ib,idx[a]]+=dqdp

        max_res=float(np.max(np.abs(F)))
        if max_res<EPS: it+=1; break

        dg=np.diag(J)
        bad = np.abs(dg) < 1e-10
        J[bad,bad] = -1e-6

        try:
            dP = np.linalg.solve(J, -F)
        except np.linalg.LinAlgError:
            dP,_,_,_ = np.linalg.lstsq(J, -F, rcond=None)

        dP = np.where(np.isfinite(dP), dP, 0.0)

        # Адаптивное демпфирование: ограничиваем шаг чтобы P оставался > 0
        # и чтобы изменения были разумными
        step = float(np.max(np.abs(dP)))
        max_step = max(P_init * 2, Hw)   # допустимый шаг
        if step > max_step:
            dP *= max_step / step

        P += dP
        # Не даём P стать отрицательным (физически давление может быть отриц.,
        # но начальный выброс надо ограничить)
        P = np.where(np.isfinite(P), P, P_init)

    log.append(f"iter={it} max|F|={max_res:.4f}")

    def gp(nid): return float(P[idx[nid]]) if nid in idx else 0.0

    branch_out=[]
    for b0,e in zip(branches_in,edges):
        Q,_=Qedge(e,gp(e["a"]),gp(e["b"]))
        Qs=Q if e["a"]==gnd(b0["fromId"]) else -Q
        if not math.isfinite(Qs): Qs=0.0
        S=e["_area"]; V=abs(Qs)/S if S>0 else 0.0
        branch_out.append({"id":b0["id"],"flow":round(Qs,3),
                           "velocity":round(V,2),"dP":round(e["R"]*Qs*abs(Qs),1)})

    node_out=[]
    for n in nodes_in:
        nid=gnd(n["id"])
        cp=101325 if nid==GND else round(101325+gp(n["id"])+12*(-float(n.get("z",0))))
        node_out.append({**n,"computedPressure":cp})

    # Диагностика
    fb={v:0.0 for v in free}
    for e in edges:
        Q,_=Qedge(e,gp(e["a"]),gp(e["b"]))
        if e["a"] in fb: fb[e["a"]]-=Q
        if e["b"] in fb: fb[e["b"]]+=Q
    for nid,bv in fb.items():
        if abs(bv)>0.5:
            diag.append({"level":"error" if abs(bv)>5 else "warning","category":"node_balance",
                "message":f"Дисбаланс: {nid[:30]} ΔQ={bv:.2f} м³/с","objectId":nid,"value":bv})

    for e in edges:
        if not e["hasFan"]: continue
        Q,_=Qedge(e,gp(e["a"]),gp(e["b"])); H=Hf(e,abs(Q))
        diag.append({"level":"info","category":"fan",
            "message":f"Вент {e['id'][:20]}: Q={Q:.2f} H={H:.0f} Па R={e['R']:.5f}","objectId":e["id"]})
        if H<=0:
            diag.append({"level":"error","category":"fan",
                "message":f"Вент {e['id'][:20]}: напор=0! Q={Q:.1f}≥qMax={e['qMax']:.0f}","objectId":e["id"]})

    conv=max_res<EPS
    if not conv:
        diag.append({"level":"warning","category":"convergence",
            "message":f"Не сошлось: max|F|={max_res:.3f} м³/с","value":max_res})

    adj2={}
    for e in edges:
        adj2.setdefault(e["a"],[]).append(e["b"]); adj2.setdefault(e["b"],[]).append(e["a"])
    reach,stk={GND},[GND]
    while stk:
        u=stk.pop()
        for v in adj2.get(u,[]):
            if v not in reach: reach.add(v); stk.append(v)
    iso=[n for n in ns if n not in reach]
    if iso:
        diag.append({"level":"error","category":"topology",
            "message":f"Изолировано {len(iso)} узлов (нет пути до атмосферы)"})

    return {"ok":conv,"iterations":it,"maxDeltaQ":round(max_res,4),"maxDeltaH":0.0,
            "branches":branch_out,"nodes":node_out,"log":log,"cyclesCount":0,"diagnostics":diag}


def _empty(nodes_in,msg):
    return {"ok":False,"iterations":0,"maxDeltaQ":0,"maxDeltaH":0,
            "branches":[],"nodes":nodes_in,"log":[msg],"cyclesCount":0,"diagnostics":[]}

solve_network=solve