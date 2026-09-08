#!/usr/bin/env python3
"""Raccoglitore: storico OHLC per titolo e serie FRED. Nessuna chiave, due canali per i titoli.

⚠ REGOLA: chi ha servito il dato si REGISTRA (lezione v393 — la riga UMich affermava tre cose
false perche' descriveva il ripiego). Ogni file salvato porta la fonte e l'istante di lettura.
"""
import json, subprocess, sys, os, time
from datetime import datetime, timezone

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CACHE = "/home/user/Trading/memoria/dati"

def _get(url, timeout=30, tentativi=3, ua=UA):
    """⚠ --http1.1 OBBLIGATORIO: attraverso il proxy, HTTP/2 chiude lo stream a meta' su
    trasferimenti lunghi (curl rc=92, INTERNAL_ERROR). E' un errore di TRASPORTO, non della
    fonte: senza questo flag FRED risulta 'non letto' mentre risponde benissimo.

    ⚠⚠ L'USER-AGENT VA PER FONTE, E IL VERSO E' OPPOSTO FRA LE DUE. Misurato, deterministico:

        fonte           con UA browser      senza UA
        stockanalysis   ok                  ok
        api.nasdaq.com  ok                  rc=28 (nessuna risposta)
        FRED            rc=28 / rc=52       ok, 268 KB in 0,4 s

    E' la GOTCHA gia' scritta in CLAUDE.md per FINRA e WSJ (403 all'UA "browser completo",
    200 a un UA generico), qui su due fonti nuove e con un sintomo diverso: FRED non rifiuta,
    TACE — la connessione muore senza codice di stato, quindi si legge come un guasto di rete
    o come un limite di frequenza, che e' esattamente la diagnosi sbagliata che ho dato prima
    di misurare. Un rifiuto muto e' peggio di un 403 perche' non si dichiara.
    ⚠ Percio' `ua=None` non e' "nessun header": e' la scelta esplicita che alcune fonti
    richiedono, e va passata dal chiamante che conosce la propria fonte.

    ⚠ Si ritenta solo sugli errori di trasporto, mai su un rifiuto della fonte (un 429 che si
    ritenta e' martellare chi ti sta dicendo di rallentare — lezione v398)."""
    testa = ["-A", ua] if ua else []
    ultimo = ""
    for i in range(tentativi):
        r = subprocess.run(["curl", "-sS", "--http1.1", "--compressed", "--max-time",
                            str(timeout)] + testa + [url], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout
        ultimo = f"rc={r.returncode}: {r.stderr[:110]}"
        if r.returncode not in (18, 55, 56, 92):    # non di trasporto: non si insiste
            break
        time.sleep(1.5 * (i + 1))
    raise RuntimeError("curl " + ultimo)

def storico_titolo(tk, anni=5):
    """Ritorna {fonte, letto_il, barre:[{d,o,h,l,c,adj,v}]} dal piu' VECCHIO al piu' recente."""
    errori = []
    # canale 1 — stockanalysis: porta anche la chiusura RETTIFICATA, che e' quella giusta
    # per medie e rendimenti (dividendi e frazionamenti).
    try:
        j = json.loads(_get(f"https://stockanalysis.com/api/symbol/s/{tk.lower()}/history?range={anni}Y&period=Daily"))
        if j.get("status") == 200 and j.get("data"):
            b = [{"d": x["t"], "o": x["o"], "h": x["h"], "l": x["l"],
                  "c": x["c"], "adj": x.get("a", x["c"]), "v": x.get("v")}
                 for x in j["data"] if x.get("c") is not None]
            b.sort(key=lambda x: x["d"])
            if len(b) >= 60:
                return {"fonte": "stockanalysis.com", "letto_il": datetime.now(timezone.utc).isoformat(),
                        "ticker": tk.upper(), "barre": b}
            errori.append(f"stockanalysis: solo {len(b)} barre")
        else:
            errori.append("stockanalysis: risposta senza dati")
    except Exception as e:
        errori.append(f"stockanalysis: {e}")
    # canale 2 — Nasdaq. ⚠ NON rettificata: si dichiara.
    try:
        oggi = datetime.now(timezone.utc).date()
        da = oggi.replace(year=oggi.year - anni)
        j = json.loads(_get("https://api.nasdaq.com/api/quote/%s/historical?assetclass=stocks"
                            "&fromdate=%s&todate=%s&limit=9999" % (tk.upper(), da, oggi)))
        rows = (((j.get("data") or {}).get("tradesTable") or {}).get("rows")) or []
        def n(v):
            v = str(v).replace("$", "").replace(",", "").strip()
            return float(v) if v and v not in ("N/A", "--") else None
        b = []
        for x in rows:
            dd = x["date"]           # MM/DD/YYYY
            m, g, a = dd.split("/")
            c = n(x.get("close"))
            if c is None: continue
            b.append({"d": f"{a}-{m}-{g}", "o": n(x.get("open")), "h": n(x.get("high")),
                      "l": n(x.get("low")), "c": c, "adj": c, "v": n(x.get("volume"))})
        b.sort(key=lambda x: x["d"])
        if len(b) >= 60:
            return {"fonte": "api.nasdaq.com (chiusure NON rettificate)",
                    "letto_il": datetime.now(timezone.utc).isoformat(),
                    "ticker": tk.upper(), "barre": b}
        errori.append(f"nasdaq: solo {len(b)} barre")
    except Exception as e:
        errori.append(f"nasdaq: {e}")
    # ⚠ "non letto" e "senza dati" si leggono uguali e sono cose diverse (v389).
    return {"fonte": None, "errori": errori, "ticker": tk.upper(),
            "letto_il": datetime.now(timezone.utc).isoformat(), "barre": []}

def serie_fred(sid):
    """Serie FRED completa, senza chiave. Ritorna {fonte, letto_il, punti:[[data,valore]]}."""
    t = _get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}", ua=None)
    righe = [r for r in t.strip().split("\n")[1:] if r.strip()]
    p = []
    for r in righe:
        parti = r.split(",")
        if len(parti) < 2: continue
        try: p.append([parti[0], float(parti[1])])
        except ValueError: continue      # FRED usa "." per il dato mancante: si SALTA, non si azzera
    return {"fonte": f"FRED {sid}", "letto_il": datetime.now(timezone.utc).isoformat(),
            "serie": sid, "punti": p}

def salva(nome, dati):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, nome)
    json.dump(dati, open(p, "w"), separators=(",", ":"))
    return p

if __name__ == "__main__":
    for tk in sys.argv[1:]:
        d = storico_titolo(tk)
        if d["barre"]:
            print(f"{tk:<6} {len(d['barre']):>5} barre · {d['barre'][0]['d']} → {d['barre'][-1]['d']} · {d['fonte']}")
        else:
            print(f"{tk:<6} NON LETTO · {d['errori']}")
        salva(f"ohlc_{tk.upper()}.json", d)
        time.sleep(0.4)
