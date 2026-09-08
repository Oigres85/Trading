#!/usr/bin/env python3
"""Scarica le serie FRED UNA ALLA VOLTA, con pausa, e le mette in cache su disco.

⚠ Perche' esiste: due processi in parallelo che chiedevano 21 serie x 3 tentativi hanno fatto
mettere l'IP in castigo da FRED (rc=28, zero byte). Non era la fonte a essere rotta: ero io a
martellarla. La lezione v398 (un 429 non si ritenta) qui vale prima ancora del rifiuto.
⚠ Ogni serie ha il suo file: un run interrotto RIPRENDE invece di ricominciare, e una serie
che oggi non risponde non cancella le venti che hanno risposto.
"""
import os, sys, time, json
from preleva import _get, CACHE

GREZZO = os.path.join(CACHE, "fred")

def scarica(sid, eta_max_ore=12, pausa=3.0, timeout=60):
    os.makedirs(GREZZO, exist_ok=True)
    f = os.path.join(GREZZO, f"{sid}.csv")
    if os.path.exists(f) and os.path.getsize(f) > 200:
        eta = (time.time() - os.path.getmtime(f)) / 3600
        if eta < eta_max_ore:
            return open(f).read(), f"cache ({eta:.1f}h)"
    # ⚠ ua=None: FRED TACE all'UA "browser completo" (misurato, vedi preleva._get)
    t = _get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}",
             timeout=timeout, tentativi=1, ua=None)
    open(f, "w").write(t)
    time.sleep(pausa)
    return t, "rete"

def punti(sid, **kw):
    t, come = scarica(sid, **kw)
    p = []
    for r in t.strip().split("\n")[1:]:
        parti = r.split(",")
        if len(parti) < 2: continue
        try: p.append([parti[0].strip(), float(parti[1])])
        except ValueError: continue     # FRED scrive "." per il dato mancante: si SALTA
    return p, come

if __name__ == "__main__":
    for sid in sys.argv[1:]:
        try:
            p, come = punti(sid)
            print(f"{sid:<20} {len(p):>6} punti · {p[0][0]} -> {p[-1][0]} · {p[-1][1]} · {come}")
        except Exception as e:
            print(f"{sid:<20} NON LETTO: {str(e)[:100]}")
