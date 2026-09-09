#!/usr/bin/env python3
"""Notizie per titolo dai feed dei fornitori. Un titolo, una richiesta, quattro in parallelo.

⚠ L'ATTRIBUZIONE VIENE DALLA FONTE, non da un'euristica nostra (lezione v399: Yahoo ha un feed
multi-ticker che costerebbe una richiesta sola e restituisce le voci senza dire a quale ticker
appartengono — attribuirle vorrebbe dire cercare il nome nel titolo, cioe' indovinare).
⚠⚠ MA "[MRVL]" SIGNIFICA "TROVATA NEL FEED DI MRVL", NON "NOTIZIA SU MRVL" (lezione v415): i
feed dei fornitori includono regolarmente pezzi sui concorrenti e sul comparto. L'etichetta lo
dichiara e NON si filtra — filtrare vorrebbe dire indovinare di chi parla un titolo.
⚠ Tre esiti distinti, mai due: con voci · senza voci · NON letto. "Nessuna notizia" e "la fonte
non ha risposto" si leggono uguali e significano l'opposto (v389).
⚠ Un 429 NON si ritenta: e' la fonte che dice di rallentare (v398).
"""
import re, sys, json, html
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from preleva import _get, salva

CANALI = [("nasdaq", "https://www.nasdaq.com/feed/rssoutbound?symbol={tk}"),
          ("yahoo",  "https://feeds.finance.yahoo.com/rss/2.0/headline?s={tk}&region=US&lang=en-US")]

def _voci(xml):
    out = []
    for m in re.finditer(r"<item>(.*?)</item>", xml, re.S):
        b = m.group(1)
        def campo(t):
            g = re.search(rf"<{t}>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{t}>", b, re.S)
            return html.unescape(g.group(1).strip()) if g else None
        titolo, link, data = campo("title"), campo("link"), campo("pubDate")
        quando = None
        if data:
            try: quando = parsedate_to_datetime(data).astimezone(timezone.utc)
            except Exception: quando = None
        fonte = campo("dc:creator") or campo("source") or None
        if titolo: out.append({"titolo": titolo, "link": link, "quando": quando, "fonte_voce": fonte})
    return out

def per_titolo(tk):
    errori = []
    for nome, tmpl in CANALI:
        try:
            v = _voci(_get(tmpl.format(tk=tk.upper()), timeout=25, tentativi=1))
            if v:
                return {"ticker": tk.upper(), "canale": nome, "stato": "con voci", "voci": v}
            errori.append(f"{nome}: 200 ma nessuna voce")
        except Exception as e:
            errori.append(f"{nome}: {str(e)[:70]}")
    return {"ticker": tk.upper(), "canale": None,
            "stato": "NON letto" if errori else "senza voci", "voci": [], "errori": errori}

def raccogli(tickers, paralleli=4):
    """⚠ Parallelismo BASSO di proposito: le fonti sono gratuite e non vanno martellate — la
    stessa ragione per cui un 429 non si ritenta."""
    with ThreadPoolExecutor(max_workers=paralleli) as ex:
        return list(ex.map(per_titolo, tickers))

def formatta(d, ore=None):
    ora = datetime.now(timezone.utc)
    out = []
    for v in d["voci"]:
        q = v["quando"]
        eta = (ora - q).total_seconds() / 3600 if q else None
        if ore is not None and eta is not None and eta > ore: continue
        out.append({"titolo": v["titolo"], "link": v["link"], "fonte_voce": v["fonte_voce"],
                    "quando": q.isoformat() if q else None,
                    "ore_fa": round(eta, 1) if eta is not None else None})
    return out

if __name__ == "__main__":
    # ⚠ v436: NON si ripiega su un titolo di comodo. Il default `or ["MU"]` faceva sembrare
    # riuscita una raccolta che copriva 1 titolo su 13, e riscriveva la cache con quell'unica
    # voce: e' la classe "verde per assenza" applicata a uno strumento. Si dichiara e si esce.
    tks = [t.upper() for t in sys.argv[1:]]
    if not tks:
        print("NESSUN TICKER: uso `python3 notizie.py MU NVDA ...` — questo script non ha un\n"
              "default, perche' una raccolta parziale che riscrive la cache si legge come completa.")
        sys.exit(2)
    res = raccogli(tks)
    tutto = {}
    for d in res:
        v = formatta(d)
        tutto[d["ticker"]] = {"canale": d["canale"], "stato": d["stato"],
                              "errori": d.get("errori"), "voci": v}
        recenti = [x for x in v if x["ore_fa"] is not None and x["ore_fa"] <= 48]
        print(f"{d['ticker']:<6} {d['stato']:<10} {str(d['canale']):<8} {len(v):>3} voci, "
              f"{len(recenti)} nelle ultime 48h" + (f"  ⚠ {d.get('errori')}" if d.get("errori") else ""))
    salva("notizie_titoli.json", {"letto_il": datetime.now(timezone.utc).isoformat(), "per_titolo": tutto})
