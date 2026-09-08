#!/usr/bin/env python3
"""Indicatori e statistiche storiche dalle barre giornaliere. Tutto su GIORNALIERO (scelta del CEO).

⚠ Si usa la chiusura RETTIFICATA per medie, rendimenti e volatilita' (dividendi e frazionamenti),
e la chiusura GREZZA per i livelli che si confrontano con un prezzo di schermo.
⚠ Ogni misura dichiara quante barre ha usato: sotto il minimo esce None, mai un numero stimato.
"""
import json, math, sys, os
CACHE = "/home/user/Trading/memoria/dati"

def carica(tk):
    return json.load(open(os.path.join(CACHE, f"ohlc_{tk.upper()}.json")))

def sma(v, n): return sum(v[-n:]) / n if len(v) >= n else None
def _ema(v, n):
    if len(v) < n: return []
    k = 2 / (n + 1); e = [sum(v[:n]) / n]
    for x in v[n:]: e.append(x * k + e[-1] * (1 - k))
    return e
def ema(v, n):
    e = _ema(v, n); return e[-1] if e else None

def rsi(c, n=14):
    if len(c) < n + 1: return None
    g = l = 0.0
    for i in range(1, n + 1):
        d = c[i] - c[i-1]; g += max(d, 0); l += max(-d, 0)
    g /= n; l /= n
    for i in range(n + 1, len(c)):
        d = c[i] - c[i-1]
        g = (g * (n-1) + max(d, 0)) / n; l = (l * (n-1) + max(-d, 0)) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)

def macd(c, a=12, b=26, s=9):
    if len(c) < b + s: return None
    ea, eb = _ema(c, a), _ema(c, b)
    ea = ea[len(ea) - len(eb):]
    linea = [x - y for x, y in zip(ea, eb)]
    sig = _ema(linea, s)
    if not sig: return None
    return {"linea": linea[-1], "segnale": sig[-1], "istogramma": linea[-1] - sig[-1]}

def stoch(h, l, c, n=9, d=6):
    if len(c) < n + d: return None
    ks = []
    for i in range(n - 1, len(c)):
        hh, ll = max(h[i-n+1:i+1]), min(l[i-n+1:i+1])
        ks.append(100 * (c[i] - ll) / (hh - ll) if hh > ll else 50.0)
    return {"K": ks[-1], "D": sum(ks[-d:]) / d}

def stochrsi(c, n=14):
    vals = [rsi(c[:i], n) for i in range(n + 1, len(c) + 1)]
    vals = [v for v in vals if v is not None]
    if len(vals) < n: return None
    w = vals[-n:]; hi, lo = max(w), min(w)
    return 100 * (vals[-1] - lo) / (hi - lo) if hi > lo else 50.0

def cci(h, l, c, n=14):
    if len(c) < n: return None
    tp = [(h[i] + l[i] + c[i]) / 3 for i in range(len(c))]
    w = tp[-n:]; m = sum(w) / n
    md = sum(abs(x - m) for x in w) / n
    return (tp[-1] - m) / (0.015 * md) if md else 0.0

def _tr(h, l, c):
    return [max(h[i]-l[i], abs(h[i]-c[i-1]), abs(l[i]-c[i-1])) for i in range(1, len(c))]

def atr(h, l, c, n=14):
    tr = _tr(h, l, c)
    if len(tr) < n: return None
    a = sum(tr[:n]) / n
    for x in tr[n:]: a = (a * (n-1) + x) / n
    return a

def adx(h, l, c, n=14):
    if len(c) < 2 * n + 1: return None
    pdm, ndm = [], []
    for i in range(1, len(c)):
        up, dn = h[i] - h[i-1], l[i-1] - l[i]
        pdm.append(up if (up > dn and up > 0) else 0.0)
        ndm.append(dn if (dn > up and dn > 0) else 0.0)
    tr = _tr(h, l, c)
    def wil(v):
        s = sum(v[:n]); out = [s]
        for x in v[n:]: s = s - s / n + x; out.append(s)
        return out
    TR, P, N = wil(tr), wil(pdm), wil(ndm)
    dx = []
    for i in range(len(TR)):
        if TR[i] == 0: dx.append(0.0); continue
        p, m = 100 * P[i] / TR[i], 100 * N[i] / TR[i]
        dx.append(100 * abs(p - m) / (p + m) if (p + m) else 0.0)
    if len(dx) < n: return None
    a = sum(dx[:n]) / n
    for x in dx[n:]: a = (a * (n-1) + x) / n
    return a

def pivot_fib(h, l, c):
    p = (h + l + c) / 3; r = h - l
    return {"P": p, "R1": p + .382*r, "R2": p + .618*r, "R3": p + r,
            "S1": p - .382*r, "S2": p - .618*r, "S3": p - r}

def percentile(serie, v):
    """midrank, come il vecchio sistema: due valori uguali non danno percentili diversi."""
    if not serie: return None
    sotto = sum(1 for x in serie if x < v); pari = sum(1 for x in serie if x == v)
    return round((sotto + pari / 2) / len(serie) * 100)

def drawdown(c):
    """discesa massima e sedute sott'acqua, sulla serie data."""
    picco = c[0]; peggio = 0.0; i_p = 0; i_peggio = 0; sedute = 0; recuperato = True
    for i, x in enumerate(c):
        if x > picco: picco, i_p = x, i
        dd = x / picco - 1
        if dd < peggio: peggio, i_peggio = dd, i
    # sedute dal picco che precede il minimo fino al recupero (o a oggi)
    picco_val = max(c[:i_peggio + 1]) if i_peggio else c[0]
    i_picco = c.index(picco_val)
    rec = next((j for j in range(i_peggio, len(c)) if c[j] >= picco_val), None)
    if rec is None: sedute, recuperato = len(c) - 1 - i_picco, False
    else: sedute = rec - i_picco
    return {"pct": round(peggio * 100, 1), "sedute": sedute, "recuperato": recuperato}

def volatilita(c, n=None):
    s = c[-n:] if n else c
    if len(s) < 30: return None
    r = [math.log(s[i] / s[i-1]) for i in range(1, len(s)) if s[i-1] > 0]
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252) * 100

def scheda(tk):
    d = carica(tk)
    b = d["barre"]
    if not b: return {"ticker": tk, "fonte": None, "errori": d.get("errori")}
    h = [x["h"] for x in b]; l = [x["l"] for x in b]
    c = [x["c"] for x in b]; a = [x["adj"] for x in b]; v = [x["v"] or 0 for x in b]
    u = b[-1]
    y = [x for x in b if x["d"] >= b[-1]["d"][:4] and False]  # segnaposto
    n252 = min(252, len(c))
    finestra_1a = c[-n252:]
    out = {
        "ticker": tk.upper(), "fonte": d["fonte"], "letto_il": d["letto_il"],
        "barre": len(b), "dal": b[0]["d"], "al": u["d"],
        "mercato": {
            "chiusura": u["c"], "apertura": u["o"], "min_gg": u["l"], "max_gg": u["h"],
            "volume": u["v"], "volume_medio_3m": round(sum(v[-63:]) / min(63, len(v))) if v else None,
            "min_52s": min(l[-n252:]), "max_52s": max(h[-n252:]),
            "var_1a_pct": round((a[-1] / a[-n252] - 1) * 100, 1) if len(a) >= n252 else None,
            "dal_max_52s_pct": round((u["c"] / max(h[-n252:]) - 1) * 100, 1),
            "max_storico": max(h), "dal_max_storico_pct": round((u["c"] / max(h) - 1) * 100, 1),
            "pos_range_52s_pct": round((u["c"] - min(l[-n252:])) / (max(h[-n252:]) - min(l[-n252:])) * 100)
                                  if max(h[-n252:]) > min(l[-n252:]) else None,
        },
        "tecnica": {
            "rsi14": rsi(a), "macd": macd(a), "stoch_9_6": stoch(h, l, c), "stochrsi14": stochrsi(a),
            "cci14": cci(h, l, c), "atr14": atr(h, l, c), "adx14": adx(h, l, c),
            "atr_pct": round(atr(h, l, c) / u["c"] * 100, 2) if atr(h, l, c) else None,
            "medie": {f"sma{n}": sma(a, n) for n in (5, 10, 20, 50, 100, 200)},
            "ema": {f"ema{n}": ema(a, n) for n in (9, 12, 21, 26, 50)},
            "pivot_fib": pivot_fib(u["h"], u["l"], u["c"]),
            "supporto_20": min(l[-20:]), "resistenza_20": max(h[-20:]),
        },
        "storico": {
            "drawdown_max_5a": drawdown(a),
            "drawdown_max_1a": drawdown(a[-n252:]),
            "volatilita_annua_1a_pct": round(volatilita(a, n252), 1) if volatilita(a, n252) else None,
            "volatilita_annua_5a_pct": round(volatilita(a), 1) if volatilita(a) else None,
            "percentile_prezzo_1a": percentile(finestra_1a, u["c"]),
            "percentile_prezzo_5a": percentile(c, u["c"]),
            "percentile_rsi_1a": None,
            "percentile_atr_1a": None,
        },
    }
    # dove stanno oggi RSI e ATR nella LORO distribuzione dell'anno: e' la lettura che
    # trasforma "RSI 63" in "RSI 63, che per questo titolo e' l'80esimo percentile".
    rs, at = [], []
    for i in range(len(a) - n252, len(a) + 1):
        if i < 30: continue
        r_ = rsi(a[:i]);  rs.append(r_) if r_ is not None else None
    for i in range(max(30, len(c) - n252), len(c) + 1):
        t_ = atr(h[:i], l[:i], c[:i]);  at.append(t_ / c[i-1] * 100) if t_ else None
    if rs: out["storico"]["percentile_rsi_1a"] = percentile(rs, rs[-1])
    if at: out["storico"]["percentile_atr_1a"] = percentile(at, at[-1])
    # distanza dalle medie, in %
    m = out["tecnica"]["medie"]
    out["tecnica"]["dist_medie_pct"] = {k: (round((a[-1] / vv - 1) * 100, 2) if vv else None)
                                        for k, vv in m.items()}
    out["tecnica"]["medie_battute"] = sum(1 for vv in m.values() if vv and a[-1] > vv)
    out["tecnica"]["medie_totali"] = sum(1 for vv in m.values() if vv)
    return out

if __name__ == "__main__":
    for tk in sys.argv[1:]:
        s = scheda(tk)
        print(json.dumps(s, indent=1, ensure_ascii=False, default=str))
