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
    # ⚠⚠ UNA SERIE CORTA NON DEVE ACCORCIARE IL LIBRO. Intersecando tutto, l'ADS SKHY
    # (40 barre) portava la finestra da 125 a 39 sedute per TUTTI e cambiava ogni numero in
    # silenzio: il contributo di NVDA passava da 11,7% a 9,7%, quello di GOOGL a 0,0%, e il
    # segno che la misura aveva smesso di misurare era ES95 IDENTICO al VaR95 — con 39
    # rendimenti la coda al 5% ha due osservazioni, quindi la media della coda E' il quantile.
    # Si tiene la finestra chiesta e si ESCLUDE chi non la copre, dichiarandolo: `corte()` poi
    # li misura sulla loro finestra, che e' un'altra domanda con un altro denominatore.
    lunghe = {tk: v for tk, v in S.items() if len(v) >= sedute}
    corti = sorted(set(S) - set(lunghe))
    if not lunghe: raise RuntimeError("nessuna serie copre la finestra chiesta")
    comuni = sorted(set.intersection(*[set(s) for s in lunghe.values()]))
    fin = comuni[-sedute:] if len(comuni) >= sedute else comuni
    S = lunghe
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
            "non_misurabili": mancanti, "fuori_finestra": corti, "ancora": ancora,
            "pesi": {t: round(w[t]*100, 1) for t in tks},
            "contributo_rischio": {t: round(mcr[t], 1) for t in tks},
            "corr_ancora": {t: round(corr_anc[t], 2) for t in tks if corr_anc.get(t) is not None},
            "corr_media": round(rho, 3), "scommesse_effettive": round(eff, 1),
            "volatilita_annua_pct": round(vol, 1),
            "var95_1g_pct": round(-q5*100, 2), "es95_1g_pct": round(-media(coda)*100, 2),
            "drawdown_max_pct": round(dd*100, 1)}

# ─────────────────────────────────────────────────────────────────────────────────────────
def corte(sedute=125, minimo=25, ancora="NVDA"):
    """Le posizioni che NON entrano nella matrice principale, misurate sulla LORO finestra.

    ⚠⚠ NASCE DA UNA MISURA CHE HA RIFIUTATO LA RISPOSTA COMODA. SKHY e' l'ADS di SK hynix,
    quotata dal 13/07/2026: 40 sedute, sotto le 125 della matrice. Il listino di casa (Seoul,
    KRX-000660) ne ha 1.222 — e usarlo come sostituto sembrava il rimedio ovvio. Misurato:

        ADS SKHY  vs NVDA, 40 sedute        corr 0,452     vs MU  corr 0,826
        Seoul KRW vs NVDA, 250 sedute       corr 0,196
        Seoul KRW vs NVDA, sfasata di 1     corr 0,219

    La serie LUNGA e' la serie SBAGLIATA: il won e la seduta coreana che chiude prima di New
    York spezzano una giornata di informazione americana su due barre, e la correlazione scende
    sotto la meta'. Col sostituto SKHY sarebbe finita fra gli "indipendenti dall'ancora"
    (0,20 < 0,35) mentre lo strumento posseduto sta DENTRO il gruppo correlato. Un numero
    plausibile che inverte la conclusione e' il difetto peggiore che questo progetto produca.

    Quindi: finestra corta e DICHIARATA, mai una finestra lunga di un'altra cosa.
    ⚠ I numeri di qui NON si confrontano con quelli di `analizza()`: altra finestra, altro
    denominatore. Si leggono come "quanto si muove con", non come quota del rischio di libro.
    """
    p = analizza(sedute)
    fuori = [t for t in POS if t not in p["pesi"]]
    out = {}
    for tk in fuori:
        s = serie(tk)
        if not s:
            out[tk] = {"stato": "nessuna serie", "sedute": 0}
            continue
        altri = {t: serie(t) for t in POS if t != tk}
        altri = {t: v for t, v in altri.items() if v}
        com = sorted(set(s) & set.intersection(*[set(v) for v in altri.values()]))
        if len(com) < minimo:
            out[tk] = {"stato": f"solo {len(com)} sedute in comune, sotto il minimo di {minimo}",
                       "sedute": len(com)}
            continue
        rr = rendimenti(s, com)
        c = {t: corr(rr, rendimenti(altri[t], com)) for t in altri}
        c = {t: round(v, 2) for t, v in c.items() if v is not None}
        ordinati = sorted(c.items(), key=lambda x: -x[1])
        out[tk] = {"stato": "misurata su finestra corta", "sedute": len(com),
                   "dal": com[0], "al": com[-1],
                   "corr_ancora": c.get(ancora), "corr_per_titolo": dict(ordinati),
                   "piu_correlato": ordinati[0] if ordinati else None,
                   "volatilita_annua_pct": round(dev(rr) * (252 ** 0.5) * 100, 1)}
    return out

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 125
    print(json.dumps({"principale": analizza(n), "finestra_corta": corte(n)},
                     indent=1, ensure_ascii=False))
