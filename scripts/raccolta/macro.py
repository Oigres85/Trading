#!/usr/bin/env python3
"""Serie macro da FRED, con percentile calcolato da me sulla serie intera e su finestre dichiarate.

⚠ FRED usa "." per il dato mancante: si SALTA, non si azzera (un buco non e' uno zero).
⚠ Ogni riga porta la finestra su cui il percentile e' calcolato: un percentile senza la sua
finestra e' mezzo numero.
"""
import json, sys, os
from preleva import serie_fred, salva, CACHE

SERIE = {
 "DGS10":"Treasury 10 anni","DGS30":"Treasury 30 anni","DGS2":"Treasury 2 anni",
 "DGS3MO":"Treasury 3 mesi","T10Y2Y":"Curva 10A-2A","T10Y3M":"Curva 10A-3M",
 "DFII10":"Tasso reale 10A (TIPS)","T10YIE":"Inflazione attesa 10A",
 "BAMLH0A0HYM2":"Spread high yield (OAS)","BAMLC0A0CM":"Spread investment grade (OAS)",
 "VIXCLS":"VIX","NFCI":"Condizioni finanziarie (Chicago Fed)",
 "DRTSCILM":"Standard di credito banche (SLOOS)","UNRATE":"Disoccupazione",
 "CPIAUCNS":"CPI (non destagionalizzato)","PCEPI":"PCE","UMCSENT":"Fiducia consumatori UMich",
 "DCOILWTICO":"Petrolio WTI","RMFNS":"Fondi monetari retail",
 "GACDFSA066MSFRBPHI":"Manifattura Philly Fed","DFF":"Tasso Fed effettivo",
}

def pct(serie, v):
    if not serie: return None
    sotto = sum(1 for x in serie if x < v); pari = sum(1 for x in serie if x == v)
    return round((sotto + pari/2)/len(serie)*100)

def yoy_per_data(punti):
    """anno su anno allineato per DATA, non per posizione (lezione v393)."""
    d = {a: b for a, b in punti}
    ultima, val = punti[-1]
    a, m, g = ultima.split("-")
    for cand in (f"{int(a)-1}-{m}-{g}",):
        if cand in d and d[cand]: return round((val/d[cand]-1)*100, 2), cand
    # base esatta assente: si prende la piu' vicina e si DICHIARA la distanza vera
    prec = [x for x in punti if x[0] < f"{int(a)-1}-{m}-{g}"]
    if not prec: return None, None
    b = prec[-1]
    return (round((val/b[1]-1)*100, 2), b[0]) if b[1] else (None, None)

if __name__ == "__main__":
    out = {}
    for sid, nome in SERIE.items():
        try:
            d = serie_fred(sid)
            p = d["punti"]
            if not p: raise RuntimeError("serie vuota")
            v = p[-1][1]
            un_anno = [x[1] for x in p[-252:]] if len(p) > 252 else [x[1] for x in p]
            cinque = [x[1] for x in p[-1260:]] if len(p) > 1260 else [x[1] for x in p]
            r = {"nome": nome, "serie": sid, "valore": v, "data": p[-1][0],
                 "punti_totali": len(p), "dal": p[0][0],
                 "percentile_1a": pct(un_anno, v), "n_1a": len(un_anno),
                 "percentile_5a": pct(cinque, v), "n_5a": len(cinque),
                 "percentile_storico": pct([x[1] for x in p], v),
                 "min_1a": min(un_anno), "max_1a": max(un_anno),
                 "fonte": d["fonte"], "letto_il": d["letto_il"]}
            if sid in ("CPIAUCNS","PCEPI","RMFNS","UMCSENT"):
                y, base = yoy_per_data(p)
                r["yoy_pct"], r["base_yoy"] = y, base
            out[sid] = r
            print(f"{sid:<20} {nome[:34]:<34} {v:>10} · {p[-1][0]} · perc.1a {r['percentile_1a']:>3}° · {len(p)} punti dal {p[0][0]}")
        except Exception as e:
            out[sid] = {"nome": nome, "serie": sid, "errore": str(e)[:90]}
            print(f"{sid:<20} NON LETTO: {e}")
    salva("macro_fred.json", out)
