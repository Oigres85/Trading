#!/usr/bin/env python3
"""Sensibilita' di ogni titolo ai canali macro, misurata come regressione dei rendimenti
giornalieri su uno strumento QUOTATO che rappresenta il canale.

Quotato perche' ha la stessa barra giornaliera: la finestra comune esiste per costruzione e le
serie si allineano PER DATA, mai per posizione (lezione v207).

⚠⚠ UN BETA SENZA IL SUO R2 E' MEZZO NUMERO (v316). Beta, R2, campione e finestra viaggiano
insieme, e sotto il pavimento del rumore la riga dichiara che il canale NON e' misurabile invece
di pubblicare un numero.
⚠ IL PAVIMENTO SI CALCOLA DAL CAMPIONE, non e' una convenzione (v401): con 251 osservazioni il
puro caso supera R2 0,015 nel 5% dei campioni, con 60 osservazioni supera 0,065. Una soglia fissa
a 0,05 sarebbe prudente sulla finestra lunga e PERMISSIVA su quella corta — accenderebbe canali
dal nulla, cioe' fabbricherebbe proprio il segnale che deve rilevare.
⚠ Tre sguardi, e il terzo NON e' una terza finestra: e' la regressione sul quinto di sedute in
cui il canale ha l'escursione maggiore, cioe' "il giorno che il canale salta, quanto perdo".
Il suo R2 ha un DENOMINATORE DIVERSO e non si confronta con gli altri due (v403).
"""
import json, math, os, sys
CACHE = "/home/user/Trading/memoria/dati"

CANALI = {"mercato": ("QQQ", "il Nasdaq 100: il fattore che muove tutto insieme"),
          "comparto": ("SMH", "i semiconduttori"),
          "tassi": ("TLT", "il Treasury lungo: sale quando i rendimenti scendono"),
          "dollaro": ("UUP", "il dollaro contro un paniere di valute")}

# quantile 97,5% di Student, per gradi di liberta'. Sotto 30 df si interpola sui tabulati.
_T = {10: 2.228, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000,
      80: 1.990, 120: 1.980, 250: 1.970, 1000: 1.962}

def t_critico(df):
    ks = sorted(_T)
    if df <= ks[0]: return _T[ks[0]]
    if df >= ks[-1]: return _T[ks[-1]]
    for a, b in zip(ks, ks[1:]):
        if a <= df <= b:
            return _T[a] + (_T[b] - _T[a]) * (df - a) / (b - a)
    return 1.96

def r2_rumore(n):
    """Il pavimento sotto cui un R2 e' indistinguibile dal caso: t2/(t2+df) con df = n-2."""
    df = n - 2
    if df < 5: return None
    t = t_critico(df)
    return t * t / (t * t + df)

def _serie(tk):
    p = os.path.join(CACHE, f"ohlc_{tk}.json")
    if not os.path.exists(p): return None
    d = json.load(open(p))
    return {x["d"]: x["adj"] for x in d["barre"]} if d.get("barre") else None

def _rend(p, date):
    v = [p[d] for d in date]
    return [math.log(v[i] / v[i-1]) for i in range(1, len(v)) if v[i-1] > 0]

def _ols(y, x):
    n = len(x)
    mx, my = sum(x)/n, sum(y)/n
    sxx = sum((a-mx)**2 for a in x)
    if not sxx: return None
    beta = sum((a-mx)*(b-my) for a, b in zip(x, y)) / sxx
    alfa = my - beta*mx
    sst = sum((b-my)**2 for b in y)
    sse = sum((b - (alfa + beta*a))**2 for a, b in zip(x, y))
    return {"beta": beta, "r2": (1 - sse/sst) if sst else None, "n": n}

def _misura(y, x, etichetta):
    o = _ols(y, x)
    if not o: return {"stato": "non calcolabile", "finestra": etichetta}
    pav = r2_rumore(o["n"])
    r2 = o["r2"]
    return {"finestra": etichetta, "beta": round(o["beta"], 2),
            "r2": round(r2, 3) if r2 is not None else None,
            "n": o["n"], "pavimento_rumore": round(pav, 3) if pav else None,
            "misurabile": bool(pav is not None and r2 is not None and r2 > pav),
            "stato": ("canale presente" if (pav is not None and r2 is not None and r2 > pav)
                      else "sotto il pavimento del rumore: nessuna relazione misurabile")}

def per_titolo(tk, lunga=251, corta=60, quinto=5):
    s = _serie(tk)
    if not s: return {"ticker": tk, "stato": "nessuna serie"}
    out = {"ticker": tk, "canali": {}}
    for nome, (bench, spiega) in CANALI.items():
        b = _serie(bench)
        if not b: continue
        com = sorted(set(s) & set(b))
        if len(com) < 30:
            out["canali"][nome] = {"strumento": bench, "spiegazione": spiega,
                                   "stato": f"solo {len(com)} sedute in comune"}
            continue
        cl = com[-(lunga+1):]
        y, x = _rend(s, cl), _rend(b, cl)
        r = {"strumento": bench, "spiegazione": spiega,
             "dal": cl[0], "al": cl[-1],
             "lunga": _misura(y, x, f"{len(y)} sedute"),
             "corta": None, "coda": None}
        if len(com) >= corta + 1:
            cc = com[-(corta+1):]
            yc, xc = _rend(s, cc), _rend(b, cc)
            r["corta"] = _misura(yc, xc, f"{len(yc)} sedute")
        # coda: il quinto di sedute in cui il CANALE ha l'escursione maggiore.
        # ⚠ Si seleziona sulla CAUSA (il canale), non sull'effetto (il titolo): selezionare sul
        # movimento del titolo distorcerebbe il beta.
        soglia = sorted(range(len(x)), key=lambda i: -abs(x[i]))[:max(1, len(x)//quinto)]
        if len(soglia) >= 32:
            yq = [y[i] for i in soglia]; xq = [x[i] for i in soglia]
            m = _misura(yq, xq, f"{len(yq)} sedute di massima escursione del canale")
            m["nota_denominatore"] = ("R2 su un sottoinsieme SCELTO: ha un denominatore diverso "
                                      "dagli altri due e non si confronta con loro. Quello che si "
                                      "confronta e' il beta.")
            r["coda"] = m
        else:
            r["coda"] = {"stato": f"solo {len(soglia)} sedute selezionate, sotto le 32 minime: "
                                  "sotto quella soglia il pavimento del rumore non e' affidabile"}
        # la transizione si chiama per nome
        L, C = r["lunga"], r["corta"]
        if C and L.get("misurabile") is not None:
            if C.get("misurabile") and not L.get("misurabile"): r["transizione"] = "IL CANALE SI E' ACCESO"
            elif L.get("misurabile") and not C.get("misurabile"): r["transizione"] = "IL CANALE SI E' SPENTO"
            elif L.get("misurabile") and C.get("misurabile"): r["transizione"] = "canale presente su entrambe le finestre"
            else: r["transizione"] = "nessuna relazione misurabile su nessuna delle due finestre"
        out["canali"][nome] = r
    return out

if __name__ == "__main__":
    for tk in sys.argv[1:]:
        d = per_titolo(tk)
        print(f"── {tk}")
        for nome, c in (d.get("canali") or {}).items():
            L = c.get("lunga") or {}; C = c.get("corta") or {}; Q = c.get("coda") or {}
            print(f"   {nome:<9} {c['strumento']:<5} lunga b={L.get('beta')} R2={L.get('r2')} "
                  f"(pav {L.get('pavimento_rumore')}) · corta b={C.get('beta')} R2={C.get('r2')} "
                  f"(pav {C.get('pavimento_rumore')}) · coda b={Q.get('beta')} · {c.get('transizione')}")
