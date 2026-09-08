#!/usr/bin/env python3
"""Rischio di LIBRO dalle serie raccolte: correlazioni, contributo al rischio, beta, VaR/ES,
scommesse effettive, drawdown e i portafogli di confronto.

⚠ E' la parte che avevo dichiarato NON ricalcolabile senza il sistema. Con lo storico completo
delle posizioni lo e'. Ogni misura dichiara la FINESTRA su cui e' calcolata: due misure di
rischio dello stesso libro su finestre diverse non si confrontano (lezione v430).
"""
import json, math, os, sys
CACHE = "/home/user/Trading/memoria/dati"

POS = {"MU":(70,87.6300),"NVDA":(270,87.1667),"AMD":(100,153.9160),"MSTR":(173,173.3045),
       "PLTR":(100,113.5000),"GOOGL":(50,340.2000),"WDC":(25,458.0000),"ORCL":(70,143.0000),
       "BE":(40,214.0000),"MRVL":(42,214.0800),"CRWV":(105,97.1990),"SKHY":(45,139.0000),
       "RGTI":(463,26.5048)}

def serie(tk):
    p = os.path.join(CACHE, f"ohlc_{tk}.json")
    if not os.path.exists(p): return None
    d = json.load(open(p))
    if not d.get("barre"): return None
    return {x["d"]: x["adj"] for x in d["barre"]}

def rendimenti(prezzi, date):
    v = [prezzi[d] for d in date]
    return [math.log(v[i]/v[i-1]) for i in range(1, len(v)) if v[i-1] > 0]

def media(x): return sum(x)/len(x)
def dev(x):
    m = media(x); return math.sqrt(sum((y-m)**2 for y in x)/(len(x)-1))
def cov(x, y):
    mx, my = media(x), media(y)
    return sum((a-mx)*(b-my) for a, b in zip(x, y))/(len(x)-1)
def corr(x, y):
    sx, sy = dev(x), dev(y)
    return cov(x, y)/(sx*sy) if sx and sy else None

def analizza(sedute=125, ancora="NVDA"):
    S = {tk: serie(tk) for tk in POS}
    mancanti = [tk for tk, s in S.items() if not s]
    S = {tk: s for tk, s in S.items() if s}
    comuni = sorted(set.intersection(*[set(s) for s in S.values()]))
    fin = comuni[-sedute:] if len(comuni) >= sedute else comuni
    R = {tk: rendimenti(S[tk], fin) for tk in S}
    tks = sorted(R, key=lambda t: -POS[t][0]*S[t][fin[-1]])
    # pesi MTM sul comparto azionario misurabile
    val = {t: POS[t][0]*S[t][fin[-1]] for t in tks}
    tot = sum(val.values())
    w = {t: val[t]/tot for t in tks}
    # matrice di covarianza e contributo al rischio: w_i*(Sigma w)_i / (w'Sigma w)
    C = {a: {b: cov(R[a], R[b]) for b in tks} for a in tks}
    sw = {a: sum(C[a][b]*w[b] for b in tks) for a in tks}
    var_p = sum(w[a]*sw[a] for a in tks)
    mcr = {a: w[a]*sw[a]/var_p*100 for a in tks}
    # correlazione con l'ancora
    corr_anc = {t: corr(R[t], R[ancora]) for t in tks} if ancora in R else {}
    # correlazione media a coppie
    coppie = [corr(R[a], R[b]) for i, a in enumerate(tks) for b in tks[i+1:]]
    rho = media([c for c in coppie if c is not None])
    # scommesse effettive con l'Herfindahl dei pesi VERI (v430)
    H = sum(x*x for x in w.values())
    eff = 1/((1-rho)*H + rho)
    # serie del portafoglio, VaR/ES storici, volatilita', drawdown
    rp = [sum(w[t]*R[t][i] for t in tks) for i in range(len(fin)-1)]
    rp_s = sorted(rp)
    q5 = rp_s[max(0, int(len(rp_s)*0.05)-1)]
    coda = [x for x in rp_s if x <= q5]
    vol = dev(rp)*math.sqrt(252)*100
    # drawdown della curva del libro
    curva = [1.0]
    for x in rp: curva.append(curva[-1]*math.exp(x))
    picco = curva[0]; dd = 0.0
    for x in curva:
        picco = max(picco, x); dd = min(dd, x/picco-1)
    return {"finestra_sedute": len(fin)-1, "dal": fin[0], "al": fin[-1],
            "non_misurabili": mancanti, "ancora": ancora,
            "pesi": {t: round(w[t]*100, 1) for t in tks},
            "contributo_rischio": {t: round(mcr[t], 1) for t in tks},
            "corr_ancora": {t: round(corr_anc[t], 2) for t in tks if corr_anc.get(t) is not None},
            "corr_media": round(rho, 3), "scommesse_effettive": round(eff, 1),
            "volatilita_annua_pct": round(vol, 1),
            "var95_1g_pct": round(-q5*100, 2), "es95_1g_pct": round(-media(coda)*100, 2),
            "drawdown_max_pct": round(dd*100, 1)}

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 125
    print(json.dumps(analizza(n), indent=1, ensure_ascii=False))
