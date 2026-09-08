#!/usr/bin/env python3
"""Il cambio EUR/USD dalla fonte ufficiale europea.

⚠ Perche' la BCE e non FRED: `DEXUSEU` esiste ed e' comodo, ma FRED lo ridistribuisce con
giorni di ritardo (misurato l'08/09/2026: ultima osservazione il 28/08, undici giorni prima).
Su un moltiplicatore che riporta TUTTE le misure di rischio dal comparto azionario al
patrimonio, undici giorni di cambio sono circa un punto percentuale.

⚠⚠ LA CONVERSIONE E' AL CAMBIO DI OGGI, NON AL COSTO SOSTENUTO (lezione v315). Il cambio di
carico e' diverso posizione per posizione e il sistema non lo conosce: sommare euro convertiti
oggi con euro spesi allora darebbe un patrimonio mai esistito. Chi stampa il numero lo dichiara.

⚠ La BCE pubblica il fixing intorno alle 16:00 CET di ogni giorno lavorativo TARGET: prima di
quell'ora la data piu' recente e' quella di ieri, ed e' corretto. La data viaggia col numero.
"""
import re, sys, json
from datetime import datetime, timezone
from preleva import _get, salva

FONTE = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"

def eurusd():
    t = _get(FONTE, timeout=30, tentativi=2)
    # <Cube time="2026-09-07"> ... <Cube currency="USD" rate="1.1622"/>
    blocchi = re.findall(r'time=["\']([0-9]{4}-[0-9]{2}-[0-9]{2})["\'](.*?)(?=time=["\']|\Z)', t, re.S)
    punti = []
    for data, corpo in blocchi:
        m = re.search(r'currency=["\']USD["\']\s+rate=["\']([0-9.]+)["\']', corpo)
        if m: punti.append([data, float(m.group(1))])
    if not punti: raise RuntimeError("nessuna quotazione USD nel documento BCE")
    punti.sort()
    return {"fonte": "BCE, tasso di riferimento giornaliero", "url": FONTE,
            "letto_il": datetime.now(timezone.utc).isoformat(),
            "eurusd": punti[-1][1], "data": punti[-1][0],
            "storico": punti, "punti": len(punti)}

if __name__ == "__main__":
    d = eurusd()
    p = d["storico"]
    print(f"EUR/USD {d['eurusd']} al {d['data']} · {d['punti']} rilevazioni dal {p[0][0]} · {d['fonte']}")
    print(f"  minimo {min(x[1] for x in p)} · massimo {max(x[1] for x in p)} "
          f"· variazione sul periodo {(p[-1][1]/p[0][1]-1)*100:+.2f}%")
    salva("cambio.json", d)
