#!/usr/bin/env python3
"""BRIEF — il prodotto quotidiano (v451).

Due letture al giorno, decise dal CEO il 12/09/2026:
  --mattina    08:30 CEST — cosa e' successo stanotte e cosa guardare oggi
  --pomeriggio 16:00 CEST — apertura USA appena avvenuta: chi si muove oltre la propria ampiezza

⚠⚠ LO SCRIPT SELEZIONA, IL MODELLO GIUDICA (regola v448). Qui dentro c'e' solo la parte
deterministica: finestra temporale, attribuzione dalla fonte, ampiezza in ATR, livelli.
Nessun elenco di parole decide se una notizia e' importante — quello invecchia da solo
(C10, red team I6) e non separa un comunicato da un "3 stocks to buy".

⚠ NON DIPENDE DA GitHub Actions. Misurato il 12/09/2026 da questo ambiente:
  · stockanalysis.com: 13 nomi su 13, 252 barre datate, 3,0 secondi
  · Yahoo: 429 sempre (e' la ragione per cui NON si usa qui)
  · l'ATR di Wilder calcolato da queste barre riproduce data.json su 8 titoli su 8
    (MU 51,84 = 51,84 · AMD 22,64 = 22,64 · WDC 31,46 = 31,46), scarto 0,0-0,5%.
    La media semplice a 14 NO: dava 44,15 su MU, il 17% in meno. La convenzione e' Wilder.
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
SA = "https://stockanalysis.com/api"

# ⚠ La soglia e' in ATR, MAI in percentuale: una percentuale segnala il titolo sbagliato
# perche' ogni titolo ha la propria ampiezza (v210, misurato su WDC contro MSFT).
SOGLIA_ATR = 1.5
# ⚠ Il parallelismo resta basso: le fonti sono gratuite e non vanno martellate (v399).
PARALLELI = 4

# I tre canali macro che toccano QUESTO libro, non "la macro" (deciso col CEO il 12/09).
# Il bool finale: True = generalista, passa dal filtro; False = e' gia' un feed di economia
# e si prende per intero (la selezione l'ha fatta una redazione, che e' meglio del mio elenco).
NEWS_MACRO = [
    ("CNBC Economia", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258", False),
    ("Bloomberg",     "https://feeds.bloomberg.com/markets/news.rss", True),
    ("Bloomberg Tech","https://feeds.bloomberg.com/technology/news.rss", True),
    ("MarketWatch",   "https://feeds.content.dowjones.io/public/rss/mw_topstories", True),
]

# ⚠⚠ I TRE CANALI, non "la macro" (deciso col CEO il 12/09/2026). Ognuno ha la sua ragione:
#   tassi  — riprezza il piano di chi costruisce a debito (4 nomi, 16,2% dell'azionario)
#   credito— arriva PRIMA su quegli stessi nomi: e' se le banche prestano, non quanto costa
#   semi   — ci sta sopra il ~75% del capitale
#   cambio — vivi in euro e ogni utile in dollari torna a casa da li'
# ⚠ E' UN REGISTRO DI PAROLE, quindi e' fallibile e va DICHIARATO in fondo al blocco.
TERMINI_MACRO = (
    "fed","fomc","powell","rate","rates","yield","treasury","inflation","cpi","ppi",
    "jobs","payroll","unemployment","ecb","bce","boj",
    "credit","spread","high-yield","junk","bond","lending","default","refinanc",
    "chip","chips","semiconductor","nvidia","tsmc","export control","tariff","taiwan","china",
    "dollar","euro",
)


def _e_macro(titolo):
    t = (titolo or "").lower()
    return any(x in t for x in TERMINI_MACRO)
# ⚠ Reddit e i forum restano VIETATI (regola gia' nella pipeline, dopo che un LLM marco'
#   [VERIFICATO] medie mobili con fonte Reddit). X non e' leggibile: risponde 200 con il
#   solo involucro JavaScript, zero testo di tweet. StockTwits e' raggiungibile ed e'
#   chiacchiera misurata, non fatti. Misurato il 12/09/2026.
# ⚠⚠ WSJ (feeds.a.dj.com) E' ESCLUSO DELIBERATAMENTE: risponde 200 con 20 voci ben formate
#   datate GENNAIO 2025 — venti mesi fa. Una fonte che risponde 200 con contenuto morto e'
#   peggio di una che non risponde. Se un domani si volesse aggiungere: guardare le date.


def http(url, timeout=20):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def jget(url, timeout=20):
    return json.loads(http(url, timeout))


# ---------------------------------------------------------------- il libro
def leggi_libro():
    """Le posizioni vengono da memoria/LIBRO.md, MAI dalla pipeline: se la pipeline muore,
    il brief deve continuare a dire la verita' sul libro (regola v439)."""
    p = os.path.join(RADICE, "memoria", "LIBRO.md")
    pos, cassa = [], None
    for riga in open(p, encoding="utf-8"):
        m = re.match(r"\|\s*([A-Z0-9.\-]+)\s*\|\s*([\d.,]+)(?:\s*nominali)?\s*\|\s*\*{0,2}([\d.,]+)\*{0,2}\s*\|\s*(\w+)", riga)
        if m:
            tk, q, pmc, val = m.group(1), m.group(2), m.group(3), m.group(4)
            if tk in ("Ticker",):
                continue
            pos.append({"tk": tk, "qta": float(q.replace(".", "").replace(",", ".")),
                        "pmc": float(pmc.replace(".", "").replace(",", ".")), "valuta": val})
        mc = re.search(r"Liquidit[aà]:\s*([\d.]+)\s*€", riga)
        if mc:
            cassa = float(mc.group(1).replace(".", ""))
    return pos, cassa


# ---------------------------------------------------------------- prezzi e livelli
def barre(tk):
    d = jget(f"{SA}/symbol/s/{tk}/history?range=1Y&period=Daily")["data"]
    return sorted(d, key=lambda x: x["t"])


def quota(tk):
    return jget(f"{SA}/quotes/s/{tk}")["data"]


def atr_wilder(d, n=14):
    """⚠ WILDER, non la media semplice. Verificato contro data.json su 8 titoli su 8."""
    if len(d) < n + 1:
        return None
    tr = [max(d[i]["h"] - d[i]["l"], abs(d[i]["h"] - d[i-1]["c"]), abs(d[i]["l"] - d[i-1]["c"]))
          for i in range(1, len(d))]
    a = sum(tr[:n]) / n
    for x in tr[n:]:
        a = (a * (n - 1) + x) / n
    return a


def sma(d, n):
    return sum(x["c"] for x in d[-n:]) / n if len(d) >= n else None


def tecnica(tk):
    """Tutto cio' che si puo' AFFERMARE su un titolo dalle sue barre vere. Niente altro."""
    try:
        d = barre(tk)
    except Exception as e:
        return {"tk": tk, "errore": str(e)[:80]}
    try:
        q = quota(tk)
    except Exception:
        q = {}
    px = q.get("p") or d[-1]["c"]
    atr = atr_wilder(d)
    r = {"tk": tk, "barre": len(d), "seduta": d[-1]["t"], "px": px,
         "chiusura_prec": d[-1]["c"], "var_pct": q.get("cp"), "stato_mercato": q.get("ms"),
         "esteso_px": q.get("ep"), "esteso_pct": q.get("ecp"), "esteso_fase": q.get("es"),
         "atr": atr, "atr_pct": (atr / px * 100) if (atr and px) else None}
    for n in (20, 50, 200):
        m = sma(d, n)
        r[f"sma{n}"] = m
        # ⚠ La distanza si porta in ATR, che e' l'unita' in cui i titoli sono confrontabili.
        r[f"d{n}_atr"] = ((px - m) / atr) if (m and atr) else None
    hi52 = max(x["h"] for x in d); lo52 = min(x["l"] for x in d)
    r["max52"] = hi52; r["min52"] = lo52
    r["dmax52_pct"] = (px / hi52 - 1) * 100 if hi52 else None
    ultimi = d[-20:]
    r["supporto20"] = min(x["l"] for x in ultimi)
    r["resistenza20"] = max(x["h"] for x in ultimi)
    r["supp_atr"] = ((px - r["supporto20"]) / atr) if atr else None
    r["res_atr"] = ((r["resistenza20"] - px) / atr) if atr else None
    # escursione della seduta in corso (o dell'ultima), contro l'ampiezza tipica.
    # ⚠ Misura l'ANDATA E RITORNO: la sola chiusura e' cieca alla seduta in cui il prezzo
    #   va lontano e torna, che e' la forma di una trimestrale respinta (v449, ORCL 11/09).
    hi, lo = q.get("h"), q.get("l")
    r["escursione_pct"] = ((hi - lo) / px * 100) if (hi and lo and px) else None
    r["escursione_atr"] = (r["escursione_pct"] / r["atr_pct"]) if (r.get("escursione_pct") and r.get("atr_pct")) else None
    r["var_atr"] = (abs(q["cp"]) / r["atr_pct"]) if (q.get("cp") is not None and r.get("atr_pct")) else None
    return r


# ---------------------------------------------------------------- notizie
def _voci_rss(xml, fonte):
    out = []
    try:
        root = ElementTree.fromstring(xml)
    except Exception:
        return out
    for it in root.iter("item"):
        t = (it.findtext("title") or "").strip()
        dt = it.findtext("pubDate")
        link = (it.findtext("link") or "").strip()
        when = None
        if dt:
            try:
                when = parsedate_to_datetime(dt)
                if when.tzinfo is None:
                    when = when.replace(tzinfo=timezone.utc)
            except Exception:
                when = None
        out.append({"titolo": t, "quando": when, "link": link, "fonte": fonte})
    return out


def news_titolo(tk):
    """⚠ L'ATTRIBUZIONE VIENE DALLA FONTE, non da un'euristica nostra (v399): Nasdaq espone
    un feed PER SIMBOLO. Google News si interroga con una stringa di ricerca e l'attribuzione
    la dovremmo indovinare: escluso.
    ⚠ [TK] significa 'trovata nel feed di TK', NON 'notizia su TK': i feed dei fornitori
    includono regolarmente pezzi su concorrenti e sul comparto (v415, misurato 4 su 14)."""
    try:
        v = _voci_rss(http(f"https://www.nasdaq.com/feed/rssoutbound?symbol={tk}", 20), f"Nasdaq[{tk}]")
        for x in v:
            x["tk"] = tk
        return tk, "ok", v
    except urllib.error.HTTPError as e:
        return tk, f"HTTP {e.code}", []          # ⚠ non si ritenta: un 429 e' una quota, non un intoppo
    except Exception as e:
        return tk, str(e)[:40], []


def raccogli_news(tickers, da):
    per_titolo, fonti_ko, muti = [], [], []
    with ThreadPoolExecutor(max_workers=PARALLELI) as ex:
        for tk, stato, voci in ex.map(news_titolo, tickers):
            if stato != "ok":
                fonti_ko.append(f"{tk}({stato})"); continue
            fresche = [v for v in voci if v["quando"] and v["quando"] >= da]
            if not fresche:
                muti.append(tk)
            per_titolo += fresche
    macro, macro_ko, macro_muti, scartate = [], [], [], 0
    for nome, url, generalista in NEWS_MACRO:
        try:
            v = _voci_rss(http(url, 20), nome)
        except Exception as e:
            macro_ko.append(f"{nome}({str(e)[:24]})"); continue
        fresche = [x for x in v if x["quando"] and x["quando"] >= da]
        if generalista:
            prima = len(fresche)
            fresche = [x for x in fresche if _e_macro(x["titolo"])]
            scartate += prima - len(fresche)
        if not fresche:
            macro_muti.append(nome)
        macro += fresche
    quanti = {}
    for v in per_titolo:
        k = v["titolo"].strip().lower()
        quanti[k] = quanti.get(k, 0) + 1
    visti = set()
    unite = []
    for v in per_titolo:
        k = v["titolo"].strip().lower()
        v["in_feed"] = quanti[k]
        if k in visti:
            continue
        visti.add(k)
        v["tks"] = sorted({x["tk"] for x in per_titolo if x["titolo"].strip().lower() == k})
        unite.append(v)
    per_titolo = unite
    per_titolo.sort(key=lambda x: x["quando"], reverse=True)
    macro.sort(key=lambda x: x["quando"], reverse=True)
    # ⚠ "letta e muta" e "NON letta" si leggono uguali e significano l'opposto (v389, v421).
    return {"per_titolo": per_titolo, "macro": macro, "macro_scartate": scartate,
            "titoli_non_letti": fonti_ko, "titoli_muti": muti,
            "macro_non_lette": macro_ko, "macro_mute": macro_muti}


# ---------------------------------------------------------------- trimestrali
# ⚠ NON via FMP: le Routine non portano connettori, quindi una sessione automatica non
#   avrebbe quel tool. Un pezzo del brief che funziona solo quando lo lancio io a mano non
#   serve a niente (trappola v203: la strada che conta e' quella della produzione).
# ⚠ Nasdaq espone il calendario PER GIORNO: l'attribuzione viene dalla fonte, non da noi (v399).
def _trim_giorno(giorno):
    try:
        d = jget(f"https://api.nasdaq.com/api/calendar/earnings?date={giorno}", 15)
    except Exception as ex:
        return giorno, None, str(ex)[:40]
    righe = (d.get("data") or {}).get("rows") or []
    return giorno, righe, None


def calendario_trimestrali(tickers, giorni=21):
    """Le uscite dichiarate DALLA FONTE nei prossimi giorni. Nessuna proiezione nostra: se
    una data non c'e', si dice che non c'e' (istruzione permanente del CEO, v396)."""
    oggi = datetime.now(timezone.utc).date()
    date = []
    for i in range(giorni):
        g = oggi + timedelta(days=i)
        if g.weekday() < 5:                      # i mercati USA non riportano nel fine settimana
            date.append(g.isoformat())
    attesi, non_letti = [], []
    cercati = {t.upper() for t in tickers}
    with ThreadPoolExecutor(max_workers=PARALLELI) as ex:
        for giorno, righe, errore in ex.map(_trim_giorno, date):
            if righe is None:
                non_letti.append(giorno); continue
            for r in righe:
                if str(r.get("symbol", "")).upper() in cercati:
                    attesi.append({"tk": r["symbol"].upper(), "data": giorno,
                                   "quando": r.get("time", ""), "eps_atteso": r.get("epsForecast"),
                                   "trimestre": r.get("fiscalQuarterEnding"),
                                   "giorni": (datetime.fromisoformat(giorno).date() - oggi).days})
    attesi.sort(key=lambda x: x["data"])
    return {"attesi": attesi, "giorni_non_letti": non_letti, "finestra": giorni}


# ---------------------------------------------------------------- macro FRED
SERIE_FRED = [("DGS10", "Treasury 10A"), ("T10Y2Y", "Curva 10A-2A"),
              ("BAMLH0A0HYM2", "HY OAS"), ("NFCI", "NFCI"),
              ("CPIAUCNS", "CPI (grezzo)"), ("UNRATE", "Disoccupazione"),
              ("DFF", "Fed Funds effettivo"), ("DEXUSEU", "EUR/USD")]


def macro_fred():
    chiave = os.environ.get("FRED_API_KEY") or ""
    p = os.path.join(RADICE, "config", "fred_key.txt")
    if not chiave and os.path.exists(p):
        chiave = open(p).read().strip()
    if not chiave:
        # ⚠ Si DICHIARA il buco, non si finge (istruzione permanente del CEO, v396).
        return {"stato": "CHIAVE ASSENTE", "serie": []}
    out = []
    for sid, nome in SERIE_FRED:
        try:
            d = jget(f"https://api.stlouisfed.org/fred/series/observations?series_id={sid}"
                     f"&api_key={chiave}&file_type=json&sort_order=desc&limit=2", 20)
            oss = [o for o in d.get("observations", []) if o.get("value") not in (".", None)]
            if not oss:
                out.append({"id": sid, "nome": nome, "stato": "nessuna osservazione"}); continue
            v = float(oss[0]["value"])
            prec = float(oss[1]["value"]) if len(oss) > 1 else None
            out.append({"id": sid, "nome": nome, "valore": v, "data": oss[0]["date"],
                        "prec": prec, "delta": (v - prec) if prec is not None else None})
        except Exception as e:
            out.append({"id": sid, "nome": nome, "stato": str(e)[:40]})
    return {"stato": "ok", "serie": out}


# ---------------------------------------------------------------- resa
def n2(x, d=2):
    return "n.d." if x is None else f"{x:,.{d}f}".replace(",", "@").replace(".", ",").replace("@", ".")


def sgn(x, d=2, suff="%"):
    return "n.d." if x is None else f"{'+' if x >= 0 else ''}{n2(x, d)}{suff}"


def riga_titolo(r, esteso=False):
    if r.get("errore"):
        return f"  {r['tk']:6} NON LETTO: {r['errore']}"
    p = [f"  {r['tk']:6} {n2(r['px'])}"]
    if r.get("var_pct") is not None:
        # ⚠ "nell'ultima seduta", mai "oggi": gli strumenti hanno barre di sedute diverse
        #   e un avverbio che afferma QUANDO e' la classe v416.
        p.append(f"{sgn(r['var_pct'])} nell'ultima seduta")
    if r.get("atr_pct"):
        p.append(f"ampiezza {n2(r['atr_pct'])}%")
    riga = " · ".join(p)
    if esteso:
        det = []
        for n in (20, 50, 200):
            if r.get(f"d{n}_atr") is not None:
                det.append(f"SMA{n} {sgn(r[f'd{n}_atr'], 1, '')} ATR")
        if r.get("supp_atr") is not None:
            det.append(f"supporto 20s {n2(r['supporto20'])} a {n2(r['supp_atr'],1)} ATR sotto")
        if r.get("res_atr") is not None:
            det.append(f"resistenza {n2(r['resistenza20'])} a {n2(r['res_atr'],1)} ATR sopra")
        if r.get("dmax52_pct") is not None:
            det.append(f"{sgn(r['dmax52_pct'],1)} dal massimo 52s")
        riga += "\n         " + " · ".join(det)
    return riga


def componi(modo, dati):
    L = []
    A = L.append
    ora = dati["ora"]
    A(f"BRIEF {'MATTINA' if modo=='mattina' else 'POMERIGGIO'} — {ora.strftime('%d/%m/%Y %H:%M')} CEST")
    A("=" * 66)

    # --- 1. QUELLO CHE SI MUOVE
    t = dati["tecnica"]
    vivi = [r for r in t if not r.get("errore")]
    mossi = [r for r in vivi
             if (r.get("var_atr") or 0) >= SOGLIA_ATR or (r.get("escursione_atr") or 0) >= SOGLIA_ATR]
    mossi.sort(key=lambda r: max(r.get("var_atr") or 0, r.get("escursione_atr") or 0), reverse=True)
    A("")
    A(f"OLTRE LA PROPRIA AMPIEZZA (soglia {n2(SOGLIA_ATR,1)}x ATR — non una percentuale, v210)")
    if not mossi:
        A(f"  nessuno dei {len(vivi)} nomi. Il silenzio qui e' l'esito normale.")
    for r in mossi:
        q = []
        if (r.get("var_atr") or 0) >= SOGLIA_ATR:
            q.append(f"chiusura {sgn(r['var_pct'])} = {n2(r['var_atr'],1)}x")
        if (r.get("escursione_atr") or 0) >= SOGLIA_ATR:
            # ⚠ Un'escursione ampia che chiude piatta dice che il prezzo e' andato lontano ed
            #   e' TORNATO: non afferma una direzione che il dato non porta (v405, v449).
            q.append(f"escursione {n2(r['escursione_pct'])}% = {n2(r['escursione_atr'],1)}x")
        A(f"  {r['tk']:6} seduta del {r.get('seduta','n.d.')}: {' · '.join(q)}")
        A(f"         {riga_titolo(r, True).split(chr(10))[1].strip()}")

    # --- 1bis. TRIMESTRALI IN ARRIVO
    cal = dati["trimestrali"]
    A("")
    A(f"TRIMESTRALI DICHIARATE DALLA FONTE — prossimi {cal['finestra']} giorni")
    if not cal["attesi"]:
        A("  nessuna. ⚠ Non e' 'nessuna trimestrale mai': e' che nella finestra la fonte non")
        A("  ne dichiara. Oltre la finestra il sistema non guarda.")
    for x in cal["attesi"]:
        q = {"time-pre-market": "prima della campana", "time-after-hours": "dopo la campana"}.get(
            x["quando"], x["quando"] or "orario non dichiarato")
        eps = f" · consenso {x['eps_atteso']}" if x.get("eps_atteso") else ""
        A(f"  {x['tk']:6} {x['data']} (fra {x['giorni']}g) · {q}{eps}")
    if cal["giorni_non_letti"]:
        A(f"  ⚠ giorni NON letti (diverso da 'nessuna uscita'): {len(cal['giorni_non_letti'])}")

    # --- 2. LIVELLI DEL LIBRO
    A("")
    A("DOVE STA OGNI POSIZIONE (livelli misurati — la decisione resta sul tuo grafico)")
    for r in sorted(vivi, key=lambda x: -(x.get("peso") or 0)):
        A(riga_titolo(r, True))
    for r in t:
        if r.get("errore"):
            A(riga_titolo(r))

    # --- 3. NOTIZIE SUI NOMI
    nw = dati["news"]
    A("")
    A(f"NOTIZIE SUI TUOI NOMI — finestra {dati['finestra_h']}h, {len(nw['per_titolo'])} voci")
    A("  [TK] = trovata nel feed di TK, NON 'notizia su TK': i feed dei fornitori includono")
    A("  pezzi su concorrenti e sul comparto. Il titolo dell'articolo e' sotto i tuoi occhi.")
    for v in nw["per_titolo"][:25]:
        eta = (dati["ora_utc"] - v["quando"]).total_seconds() / 3600
        et = ",".join(v["tks"]);  et = et if len(et) <= 16 else et[:14] + ".."
        # ⚠ Una voce che compare nei feed di piu' nomi e' quasi sempre cronaca di mercato.
        molti = f"  ⟨in {v['in_feed']} feed⟩" if v["in_feed"] >= 3 else ""
        A(f"  [{et:16}] {eta:4.1f}h  {v['titolo'][:92]}{molti}")
    if len(nw["per_titolo"]) > 25:
        A(f"  ... e altre {len(nw['per_titolo'])-25} non elencate (tetto di 25)")
    if nw["titoli_muti"]:
        A(f"  letti e senza voci in finestra: {', '.join(nw['titoli_muti'])}")
    if nw["titoli_non_letti"]:
        A(f"  ⚠ NON LETTI (diverso da 'nessuna notizia'): {', '.join(nw['titoli_non_letti'])}")

    # --- 4. MACRO
    A("")
    A(f"MACRO — i canali che toccano QUESTO libro ({len(nw['macro'])} voci in finestra)")
    for v in nw["macro"][:15]:
        eta = (dati["ora_utc"] - v["quando"]).total_seconds() / 3600
        A(f"  {v['fonte']:14} {eta:4.1f}h  {v['titolo'][:92]}")
    if nw["macro_mute"]:
        A(f"  lette e senza voci: {', '.join(nw['macro_mute'])}")
    if nw["macro_non_lette"]:
        A(f"  ⚠ NON LETTE: {', '.join(nw['macro_non_lette'])}")
    if nw.get("macro_scartate"):
        A(f"  {nw['macro_scartate']} voci generaliste scartate da un filtro A PAROLE, che e'")
        A("  fallibile in entrambi i versi: puo' far passare un titolo che non c'entra e puo'")
        A("  scartarne uno che c'entra. CNBC Economia entra per intero, senza filtro.")

    mf = dati["macro_fred"]
    A("")
    if mf["stato"] != "ok":
        A(f"  ⚠ SERIE MACRO: {mf['stato']} — inflazione, curva, HY OAS, NFCI e Fed Funds NON")
        A("    sono in questo brief. Non e' 'nessun movimento': e' il dato che manca.")
    else:
        for s in mf["serie"]:
            if "valore" in s:
                A(f"  {s['nome']:22} {n2(s['valore'],2):>10}   al {s['data']}   {sgn(s.get('delta'),2,'') if s.get('delta') is not None else ''}")
            else:
                A(f"  {s['nome']:22} {s.get('stato','n.d.')}")

    A("")
    A("-" * 66)
    A(f"Prezzi: stockanalysis.com, ultima barra {dati['seduta_base']}. Notizie: Nasdaq per simbolo")
    A("+ CNBC/Bloomberg/MarketWatch. Il sistema NON conosce: altri conti, altri strumenti,")
    A("posizioni corte, coperture, situazione fiscale. Direzione e livelli si', quantita' no.")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mattina", action="store_true")
    ap.add_argument("--pomeriggio", action="store_true")
    ap.add_argument("--finestra", type=float, default=None, help="ore di finestra notizie")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    modo = "pomeriggio" if a.pomeriggio else "mattina"
    # mattina: da ieri sera (la sessione USA e' finita) · pomeriggio: da stamattina
    finestra = a.finestra if a.finestra else (16.0 if modo == "mattina" else 8.0)

    t0 = time.time()
    pos, cassa = leggi_libro()
    azioni = [p for p in pos if p["valuta"] == "USD"]
    tickers = [p["tk"] for p in azioni]

    with ThreadPoolExecutor(max_workers=PARALLELI) as ex:
        tec = list(ex.map(tecnica, tickers))
    idx = {r["tk"]: r for r in tec}
    tot = sum((idx[p["tk"]].get("px") or 0) * p["qta"] for p in azioni)
    for p in azioni:
        r = idx[p["tk"]]
        r["peso"] = ((r.get("px") or 0) * p["qta"] / tot * 100) if tot else None
        r["qta"] = p["qta"]; r["pmc"] = p["pmc"]

    ora_utc = datetime.now(timezone.utc)
    da = ora_utc - timedelta(hours=finestra)
    nw = raccogli_news(tickers, da)
    cal = calendario_trimestrali(tickers)
    mf = macro_fred()

    sedute = [r["seduta"] for r in tec if r.get("seduta")]
    base = max(set(sedute), key=sedute.count) if sedute else "n.d."

    dati = {"ora": ora_utc + timedelta(hours=2), "ora_utc": ora_utc, "modo": modo,
            "finestra_h": finestra, "tecnica": tec, "news": nw, "macro_fred": mf,
            "trimestrali": cal,
            "seduta_base": base, "cassa_eur": cassa, "secondi": round(time.time() - t0, 1)}
    testo = componi(modo, dati)
    print(testo)
    print(f"\n[generato in {dati['secondi']}s]")
    if a.json:
        s = dict(dati); s["ora"] = s["ora"].isoformat(); s["ora_utc"] = s["ora_utc"].isoformat()
        def _ser(v):
            # ⚠ nw contiene liste di dizionari, liste di stringhe E un intero (macro_scartate):
            #   un ramo che assume una forma sola rompe sul primo valore diverso.
            if isinstance(v, list):
                return [{**x, "quando": x["quando"].isoformat()} if isinstance(x, dict) and x.get("quando")
                        else x for x in v]
            return v
        s["news"] = {k: _ser(v) for k, v in nw.items()}
        s["testo"] = testo
        json.dump(s, open(a.json, "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
