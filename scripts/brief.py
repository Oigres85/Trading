#!/usr/bin/env python3
"""BRIEF — il prodotto quotidiano (v451).

Due letture al giorno, decise dal CEO il 12/09/2026:
  --mattina    08:30 ora italiana — cosa e' successo stanotte e cosa guardare oggi
  --pomeriggio 16:00 ora italiana — apertura USA appena avvenuta: chi si muove oltre la propria ampiezza

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
from zoneinfo import ZoneInfo
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comuni import testo_feed, seduta_aperta  # noqa: E402 — v510 il titolo di una voce; v514 la barra in formazione

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
    pos, cassa, sorv = [], None, []
    # ⚠ v454 — SI LEGGE SOLO LA SEZIONE CHE SI DICHIARA DI LEGGERE. Il parser scorreva il file
    #   intero e raccoglieva anche la tabella delle correlazioni (sezione 4), dove
    #   "| MU | 0,40 | 0,71 | WDC |" diventava quantita' 0,40, PMC 0,71, valuta WDC: 26 righe
    #   invece di 14. Reggeva solo perche' il filtro valuta=="USD" le scartava per COINCIDENZA —
    #   nessuna correlazione si chiama "USD". Ora ogni tabella si legge dentro il proprio
    #   titolo, e una sezione nuova non puo' piu' finire nelle posizioni.
    sez = None
    for riga in open(p, encoding="utf-8"):
        if riga.startswith("## "):
            t = riga.upper()
            sez = "pos" if "POSIZIONI" in t else ("sorv" if "SORVEGLIATI" in t else None)
        if sez == "sorv":
            ms = re.match(r"\|\s*([A-Z][A-Z0-9.\-]{0,5})\s*\|\s*([^|]*)\|", riga)
            if ms and ms.group(1) != "Ticker":   # la riga separatore |---| non ha lettere
                sorv.append({"tk": ms.group(1), "nota": ms.group(2).strip()})
        m = re.match(r"\|\s*([A-Z0-9.\-]+)\s*\|\s*([\d.,]+)(?:\s*nominali)?\s*\|\s*\*{0,2}([\d.,]+)\*{0,2}\s*\|\s*(\w+)", riga) if sez == "pos" else None
        if m:
            tk, q, pmc, val = m.group(1), m.group(2), m.group(3), m.group(4)
            if tk in ("Ticker",):
                continue
            pos.append({"tk": tk, "qta": float(q.replace(".", "").replace(",", ".")),
                        "pmc": float(pmc.replace(".", "").replace(",", ".")), "valuta": val})
        # ⚠ v459: il CEO dichiara anche cifre APPROSSIMATE ("~50.000 €"). La tilde faceva fallire
        #   la lettura e la liquidita' spariva in silenzio dal brief: si accetta, e il valore
        #   resta quello dichiarato.
        mc = re.search(r"Liquidit[aà]:\s*\*{0,2}\s*~?\s*([\d.]+)\s*€", riga)
        if mc:
            cassa = float(mc.group(1).replace(".", ""))
    return pos, cassa, sorv


# ---------------------------------------------------------------- prezzi e livelli
def dopo_la_campana(giorno, adesso=None):
    """v485 — vero se `giorno` (ISO) e' OGGI a New York e la campana delle 16:00 e' gia' suonata: e' la
    finestra in cui l'ultima barra dello storico puo' non essere ancora la chiusura ufficiale. Sullo
    stesso giorno e' il complemento di rotazione.seduta_in_corso (un gate lo verifica: v161). Il fuso,
    mai uno scarto a mano (v470)."""
    adesso = (adesso or datetime.now(NEW_YORK)).astimezone(NEW_YORK)
    return giorno == adesso.date().isoformat() and adesso.hour >= 16


def chiusura_ufficiale(d, q):
    """v485 — se la quotazione dichiara la seduta regolare CHIUSA (ms 'closed') sulla STESSA data
    dell'ultima barra (td), quella barra prende apertura, massimo, minimo e chiusura della seduta
    regolare dalla quotazione, ed e' marcata 'ufficiale': la CHIUSURA e' confermata. ⚠ Il volume della
    quotazione invece cresce dopo la campana con gli scambi fuori orario (misurato il 14/10: NVDA da
    116.058.310 a 116.359.994 in pochi minuti): e' piu' vicino al vero dei 70,7 milioni della barra
    parziale, NON e' il solo volume della seduta regolare, e lo storico del giorno dopo lo sostituisce.
    Senza conferma la barra resta com'e', NON marcata: chi registra un fatto permanente lo vede
    (numeri_libro.aggiorna_registro). Non modifica `d`."""
    if not d or not isinstance(q, dict):
        return d
    u = d[-1]
    p = q.get("p")
    if q.get("ms") != "closed" or q.get("td") != u.get("t") or not isinstance(p, (int, float)) or p <= 0:
        return d
    nuova = dict(u, c=p, a=p, ufficiale=True)
    for k in ("o", "h", "l", "v"):
        if isinstance(q.get(k), (int, float)) and q[k] > 0:
            nuova[k] = q[k]
    if isinstance(q.get("cp"), (int, float)):
        nuova["ch"] = q["cp"]
    return d[:-1] + [nuova]


def barre(tk, adesso=None):
    """Lo storico giornaliero, in ordine di data. ⚠⚠ v485 — DOPO LA CAMPANA l'ultima barra dello storico
    NON e' ancora la chiusura ufficiale: misurato il 14/10/2026 alle 16:26 ET, NVDA 223,715 nello storico
    contro 221,30 ufficiale, MU 921,30 contro 914,13, e il volume di NVDA a 70,7 milioni contro 116. La
    sera stessa la conferma la quotazione (chiusura_ufficiale); il giorno dopo lo storico era gia'
    definitivo (righe del registro scritte 1,5 e 12 ore dopo la campana: 11 prezzi su 11 coincidono)."""
    d = sorted(jget(f"{SA}/symbol/s/{tk}/history?range=1Y&period=Daily")["data"], key=lambda x: x["t"])
    if not d or not dopo_la_campana(d[-1]["t"], adesso):
        return d
    try:
        q = quota(tk)
    except Exception:
        return d          # resta NON marcata: il registro non la scrive come una chiusura confermata
    return chiusura_ufficiale(d, q)


def quota(tk):
    return jget(f"{SA}/quotes/s/{tk}")["data"]


def barre_5min(tk):
    """v491 — Le barre a 5 minuti delle ultime cinque sedute REGOLARI (stockanalysis.com, 5D/c), con l'ora di
    New York. Servono a una domanda sola: il prezzo DOPO un certo momento della seduta (numeri_libro, ordini
    aperti — un ordine visto ancora attivo alle 18:02 non puo' essersi eseguito sul minimo delle 15:30).
    ⚠⚠ L'ora e' quella di PARETE di New York scritta come se fosse UTC: misurato il 15/10/2026, cosi' letta ogni
    giornata comincia alle 09:30, e i minimi e massimi delle barre riproducono lo storico giornaliero di ORCL,
    OKLO e SMCI entro lo 0,064% sulle sedute concluse. La lettura si VERIFICA a ogni chiamata — ogni giornata deve
    cominciare alle 09:30 —: se la fonte cambiasse codifica l'ora sbaglierebbe di 4-5 ore, e un prezzo di prima
    diventerebbe un prezzo di dopo. Meglio un dato dichiarato illeggibile che uno sbagliato (v396)."""
    out = []
    for b in jget(f"{SA}/charts/s/{tk}/5D/c")["data"]:
        if b.get("t") is None or b.get("l") is None or b.get("h") is None:
            continue
        dt = datetime.fromtimestamp(b["t"], timezone.utc).replace(tzinfo=NEW_YORK)
        out.append({"dt": dt, "o": b.get("o"), "h": b["h"], "l": b["l"], "c": b.get("c"), "v": b.get("v")})
    out.sort(key=lambda x: x["dt"])
    primo = {}
    for b in out:
        primo.setdefault(b["dt"].date(), b["dt"])
    storti = [f"{g:%d/%m} alle {t:%H:%M}" for g, t in primo.items() if (t.hour, t.minute) != (9, 30)]
    if storti:
        raise ValueError("ore delle barre a 5 minuti non verificabili: la giornata comincia " + ", ".join(storti)
                         + " invece che alle 09:30")
    return out


def barra_in_formazione(d, adesso=None):
    """Vero se l'ultima barra e' quella di OGGI a New York e la campana delle 16:00 non e' ancora suonata: quella barra
    e' in formazione (v439, v469). Il fuso, mai uno scarto a mano (v470).
    v512 — spostata qui da rotazione.seduta_in_corso (che la chiama, col suo nome di prima): la usa anche tecnica(), e
    una regola in due posti diverge al primo ritocco (v161)."""
    if not d:
        return False
    return seduta_aperta(d[-1]["t"], adesso)      # v514 — la regola vive in comuni.py: la usa anche la pipeline


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


def tecnica(tk, d=None, adesso=None):
    """Tutto cio' che si puo' AFFERMARE su un titolo dalle sue barre vere. Niente altro.
    d: barre gia' scaricate (v468, rotazione.py) — evita di chiederle due volte alla fonte.
    ⚠⚠ v512 — LE MISURE SI FANNO SULLE SEDUTE CONCLUSE. A seduta aperta la fonte aggiunge allo storico la barra di
    oggi, in formazione (misurato in v489: dalle 13:50 di New York c'e', alle 09:40 no), e ATR, medie, massimo e minimo
    dell'anno, supporto e resistenza la contavano come una seduta intera — un pezzo di giornata letto come una giornata,
    la stessa forma dell'ottobre «su 42 anni» a tre quarti della stagionalita' (v511). E «chiusura_prec» era il prezzo
    di adesso. Il PREZZO resta quello della quota, di adesso: la distanza e' fra il prezzo vivo e i livelli conclusi."""
    if d is None:
        try:
            d = barre(tk)
        except Exception as e:
            return {"tk": tk, "errore": str(e)[:80]}
    if not d:
        return {"tk": tk, "errore": "nessuna barra"}
    vive = d
    d = d[:-1] if barra_in_formazione(d, adesso) else d
    if not d:
        return {"tk": tk, "errore": "nessuna seduta conclusa"}
    try:
        q = quota(tk)
    except Exception:
        q = {}
    px = q.get("p") or vive[-1]["c"]
    atr = atr_wilder(d)
    r = {"tk": tk, "barre": len(d), "seduta": d[-1]["t"], "px": px,
         # v512 — la barra di oggi tolta dalle misure perche' ancora in formazione: chi stampa lo puo' dire
         "in_formazione": len(vive) > len(d),
         "chiusura_prec": d[-1]["c"], "var_pct": q.get("cp"), "stato_mercato": q.get("ms"),
         # ⚠ La variazione e l'escursione vengono dalla QUOTA, non dall'ultima barra storica: la
         #   seduta che descrivono e' quella dichiarata dalla quota (td). d[-1]["t"] e' la barra
         #   precedente quando la seduta e' in corso — etichettarle con quella data e' la classe
         #   v431 (l'etichetta da una fonte, il valore da un'altra).
         "seduta_quota": q.get("td"),
         "esteso_px": q.get("ep"), "esteso_pct": q.get("ecp"), "esteso_fase": q.get("es"),
         # v489 — la seduta come la dichiara la quota: volume finora, minimo e massimo, ora
         #   dell'aggiornamento. Servono agli ordini aperti (il minimo ha toccato il limite?) e ai
         #   volumi della seduta in corso (rotazione.volume_seduta), che si leggono con l'ora accanto.
         "vol_oggi": q.get("v"), "minimo_oggi": q.get("l"), "massimo_oggi": q.get("h"), "quota_ora": q.get("u"),
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
        # v510 — il parser XML toglie UN livello di entita', e Nasdaq ne scrive due («&amp;quot;»): usciva «&quot;»
        t = testo_feed(it.findtext("title"))
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


def leggi_conti_dichiarati(testo=None):
    """v489 — LIBRO.md §1octies: le date dei conti DICHIARATE DALL'EMITTENTE con un documento (un 6-K, un
    comunicato) per chi il calendario Nasdaq non porta. Il 15/10/2026 SK hynix aveva dichiarato con un 6-K
    del 14/10 i conti del 28/10 e il calendario non li aveva: la posizione restava senza scadenza e senza
    l'avviso dei 14 giorni. Non e' una stima: e' una data che la societa' ha scritto, con la fonte accanto
    (v396). Si legge solo dentro il proprio titolo (v454). None = sezione assente (v406)."""
    if testo is None:
        try:
            with open(os.path.join(RADICE, "memoria", "LIBRO.md"), encoding="utf-8") as f:
                testo = f.read()
        except OSError:
            return None
    out, sez, trovata = [], False, False
    for riga in testo.splitlines():
        if riga.startswith("## "):
            sez = "CONTI DICHIARATI" in riga.upper()
            trovata = trovata or sez
            continue
        if not sez or not riga.startswith("|"):
            continue
        celle = [x.strip() for x in riga.strip().strip("|").split("|")]
        if len(celle) < 4 or not re.match(r"\d{4}-\d{2}-\d{2}$", celle[1]):
            continue
        # v510 — la quinta colonna, facoltativa, e' l'ORA dichiarata («09:00 Asia/Seoul»): in coda, cosi' le
        #   prime quattro non si spostano (v208)
        out.append({"tk": celle[0].upper(), "data": celle[1], "fonte": celle[2], "depositato": celle[3],
                    "ora": celle[4] if len(celle) > 4 and celle[4] else None})
    return out if trovata else None


def ora_dichiarata(data, cella):
    """⚠ v510 — L'ORA DEI CONTI DICHIARATA DALL'EMITTENTE, nel SUO fuso, convertita col fuso e mai con uno scarto
    a mano (v470). Il 24/10/2026 la riga di SK hynix diceva «orario non dichiarato» accanto alla propria fonte, che
    lo dichiarava: «teleconferenza alle 9:00 di Seul». La cella e' «HH:MM Zona/IANA» (LIBRO.md §1octies, colonna
    Ora). Torna (codice, testo): il codice e' quello di Nasdaq per la seduta di New York della data dei conti —
    prima dell'apertura, dopo la chiusura, o None durante la seduta — cosi' chi lo usa (le scadenze delle opzioni,
    v496) lo legge come quello del calendario. (None, None) se la cella non si legge: un orario indovinato e'
    peggio di nessun orario (v199)."""
    m = re.match(r"\s*(\d{1,2}):(\d{2})\s+([A-Za-z]+/[A-Za-z_]+)\s*$", str(cella or ""))
    if not m:
        return None, None
    try:
        g = datetime.fromisoformat(str(data)[:10]).date()
        quando = datetime(g.year, g.month, g.day, int(m.group(1)), int(m.group(2)), tzinfo=ZoneInfo(m.group(3)))
    except (ValueError, KeyError, OSError):
        return None, None
    apre = datetime(g.year, g.month, g.day, 9, 30, tzinfo=NEW_YORK)
    chiude = datetime(g.year, g.month, g.day, 16, 0, tzinfo=NEW_YORK)
    codice = "time-pre-market" if quando < apre else "time-after-hours" if quando >= chiude else None
    it, ny = quando.astimezone(ROMA), quando.astimezone(NEW_YORK)
    rispetto = ("prima dell'apertura di New York" if codice == "time-pre-market" else
                "dopo la chiusura di New York" if codice == "time-after-hours" else "a seduta di New York aperta")
    return codice, (f"{rispetto} del {g:%d/%m} — {int(m.group(1)):02d}:{m.group(2)} {m.group(3)}, cioe' "
                    f"{it:%H:%M} ora italiana del {it:%d/%m} e {ny:%H:%M} a New York del {ny:%d/%m} "
                    "(ora dichiarata dall'emittente)")


def con_conti_dichiarati(attesi, cercati, oggi, giorni, dichiarati):
    """Le date dell'emittente entrano nella finestra accanto a quelle di Nasdaq. Dove ci sono entrambe e
    divergono vince l'emittente — e' la fonte primaria — e la data di Nasdaq resta scritta accanto. Una data
    gia' passata o fuori dalla finestra non entra: l'evento e' avvenuto, o il sistema non guarda cosi'
    lontano (stessa finestra di Nasdaq). Ogni voce porta la sua fonte."""
    out = [{**a, "fonte": a.get("fonte") or "calendario Nasdaq"} for a in attesi]
    for c in dichiarati or []:
        if c["tk"] not in cercati:
            continue
        try:
            g = (datetime.fromisoformat(c["data"]).date() - oggi).days
        except ValueError:
            continue
        if g < 0 or g >= giorni:
            continue
        nasdaq = sorted(a["data"] for a in out if a["tk"] == c["tk"])
        codice, orario = ora_dichiarata(c["data"], c.get("ora"))
        voce = {"tk": c["tk"], "data": c["data"], "quando": codice or "", "eps_atteso": None, "trimestre": None,
                "giorni": g, "fonte": f"dichiarata dall'emittente: {c['fonte']}, depositato il {c['depositato']}"}
        if orario:
            voce["orario_dichiarato"] = orario
        if nasdaq and nasdaq[0] != c["data"]:
            voce["nasdaq"] = nasdaq[0]
        out = [a for a in out if a["tk"] != c["tk"]] + [voce]
    out.sort(key=lambda x: x["data"])
    return out


def calendario_trimestrali(tickers, giorni=21):
    """Le uscite dichiarate DALLA FONTE nei prossimi giorni. Nessuna proiezione nostra: se
    una data non c'e', si dice che non c'e' (istruzione permanente del CEO, v396).
    v489 — le fonti sono due: il calendario Nasdaq e, per chi non c'e', la data che l'emittente ha
    dichiarato con un documento (LIBRO.md §1octies). Ogni voce dice da quale viene."""
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
    attesi = con_conti_dichiarati(attesi, cercati, oggi, giorni, leggi_conti_dichiarati())
    for x in attesi:                     # v500 — resi una volta per il testo e per la pagina (v455)
        x["orario"] = x.get("orario_dichiarato") or orario_trimestrale(x.get("quando"))
        x["consenso"] = consenso_testo(x.get("eps_atteso"))
    return {"attesi": attesi, "giorni_non_letti": non_letti, "finestra": giorni}


# ---------------------------------------------------------------- v500: l'ultima trimestrale riportata
MESI_NASDAQ = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9,
               "Oct": 10, "Nov": 11, "Dec": 12}


def leggi_ultima_trimestrale(d):
    """La risposta di Nasdaq (earnings-surprise) -> l'ultima trimestrale RIPORTATA: {stato, data, trimestre,
    eps, consenso, sorpresa_pct}. Nessuna rete qui: la riceve gia' letta (cosi' un gate la prova sul testo)."""
    righe = ((((d or {}).get("data") or {}).get("earningsSurpriseTable") or {}).get("rows")) or []
    voci = []
    for r in righe:
        try:
            m, g, a = str(r.get("dateReported") or "").split("/")
            data = f"{int(a):04d}-{int(m):02d}-{int(g):02d}"
        except ValueError:
            continue
        num = lambda x: None if x in (None, "", "N/A", "--") else float(str(x).replace(",", ""))
        try:
            eps, cons, sorp = num(r.get("eps")), num(r.get("consensusForecast")), num(r.get("percentageSurprise"))
        except ValueError:
            eps = cons = sorp = None
        tq = str(r.get("fiscalQtrEnd") or "").split()
        trim = (f"{MESI_IT[MESI_NASDAQ[tq[0]] - 1]} {tq[1]}" if len(tq) == 2 and tq[0] in MESI_NASDAQ else
                (r.get("fiscalQtrEnd") or None))
        voci.append({"data": data, "trimestre": trim, "eps": eps, "consenso": cons, "sorpresa_pct": sorp})
    if not voci:
        return {"stato": "senza righe"}
    voci.sort(key=lambda x: x["data"], reverse=True)
    return {"stato": "ok", **voci[0]}


def ultime_trimestrali(tickers):
    """v500 — L'ULTIMA TRIMESTRALE GIA' RIPORTATA, dichiarata dalla fonte: Nasdaq pubblica per ogni titolo le ultime
    quattro, col trimestre fiscale, la data del comunicato, l'EPS riportato e il consenso. E' il FATTO da cui parte il
    VWAP ancorato ai conti (decisione del CEO del 18/10/2026). L'8-K con item 2.02 non basta: una societa' ne deposita
    anche fuori dal ciclo — il 02/10 Tesla ci ha depositato le consegne del trimestre — e gli emittenti esteri non lo
    hanno. Tre esiti per nome (v389): {"stato": "ok", ...} · {"stato": "senza righe"} · {"stato": "NON letto (...)"}."""
    def uno(tk):
        try:
            return tk, leggi_ultima_trimestrale(jget(f"https://api.nasdaq.com/api/company/{tk}/earnings-surprise", 15))
        except Exception as ex:
            return tk, {"stato": f"NON letto ({str(ex)[:40]})"}
    nomi = list(dict.fromkeys(t.upper() for t in tickers if t))
    with ThreadPoolExecutor(max_workers=PARALLELI) as ex:
        return dict(ex.map(uno, nomi))


# ---------------------------------------------------------------- aste del Tesoro USA
# ⚠⚠ v470 — L'ORARIO DI UN EVENTO SI LEGGE DALLA FONTE UFFICIALE, NEL SUO FUSO, E SI CONVERTE
# COL FUSO. Il 07/10/2026 l'analisi ha scritto tre volte "asta del decennale alle 17:00",
# presa da un calendario web: 17:00 era l'ora UTC, in Italia erano le 19:00 — accanto ai
# verbali della Fed "alle 20:00", che invece erano in ora italiana. Due orologi nella stessa
# riga (classe v431). Il Tesoro pubblica calendario, importo e ora di chiusura su
# TreasuryDirect, gratis e senza chiave: si legge di la'.
#
# ⚠ Mai uno scarto scritto a mano (v437, v439): fra l'ultima domenica di ottobre e la prima di
# novembre, e fra la seconda domenica di marzo e l'ultima, New York e Roma distano 5 ore invece
# di 6. Un +6 sbaglierebbe proprio quelle settimane, e senza rompere niente.
#
# ⚠ Solo note e bond: e' l'offerta che pesa sulla parte lunga della curva, cioe' sul 10 anni
# del semaforo (famiglia tassi). I bills (sotto l'anno) sono gestione di cassa e i FRN hanno
# tasso variabile: esclusi, e il blocco lo dichiara.
TD = "https://www.treasurydirect.gov/TA_WS/securities"
ROMA = ZoneInfo("Europe/Rome")
NEW_YORK = ZoneInfo("America/New_York")


def ora_da_new_york(giorno, hhmm):
    """'2026-10-07T00:00:00' + '01:00 PM' (come li scrive il Tesoro, ora di New York) ->
    datetime in ora italiana. None se uno dei due non si legge: un orario indovinato e'
    peggio di nessun orario (v199)."""
    try:
        g = datetime.fromisoformat(str(giorno)[:10]).date()
        t = datetime.strptime(str(hhmm).strip(), "%I:%M %p").time()
    except (TypeError, ValueError):
        return None
    return datetime.combine(g, t, tzinfo=NEW_YORK).astimezone(ROMA)


def _duration(a):
    return a.get("securityType") in ("Note", "Bond") and a.get("floatingRate") != "Yes"


def _campo(a, *nomi):
    """Il primo campo NON VUOTO fra i nomi dati. ⚠⚠ v510 — il Tesoro ha cambiato i nomi: il giorno dell'asta sta in
    `competitiveAuctionCloseDate` (auctionDate e' null), l'ora in `competitiveAuctionCloseTime` (closingTimeCompetitive
    e' null), l'indicizzazione in `inflationProtected` (tips e' null). Verificato il 24/10/2026: il blocco leggeva i
    nomi vecchi e diceva «nessuna asta annunciata» con 2, 5 e 7 anni — 183 miliardi — fra il 26 e il 29/10. I nomi
    vecchi restano come ripiego: una fonte che torna indietro non deve spegnerlo di nuovo."""
    for n in nomi:
        v = a.get(n)
        if v not in (None, ""):
            return v
    return None


def _indicizzato(a):
    return _campo(a, "inflationProtected", "tips") == "Yes"


def _scadenza(a):
    """'10-Year' -> '10 anni'. Conta il termine ORIGINALE: una riapertura del decennale si
    chiama '9-Year 10-Month' ed e' lo stesso titolo dell'asta originale."""
    t = a.get("originalSecurityTerm") or a.get("securityTerm") or "scadenza n.d."
    t = re.sub(r"(\d+)-Year", r"\1 anni", t)
    t = re.sub(r"(\d+)-Month", r"\1 mesi", t)
    return t + (" indicizzato all'inflazione" if _indicizzato(a) else "")


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def aste_tesoro(giorni=7, adesso=None, leggi=None):
    """Aste di note e bond ANNUNCIATE dal Tesoro nei prossimi giorni, con l'ora di chiusura in
    ora italiana, e gli esiti degli ultimi tre giorni accanto all'asta precedente della stessa
    scadenza. Nessuna proiezione: un'asta non annunciata non c'e' (v396). Le due letture hanno
    ciascuna tre sorti distinte — con voci, senza voci, NON letta (v389)."""
    leggi = leggi or jget
    adesso = adesso or datetime.now(ROMA)
    oggi = adesso.astimezone(ROMA).date()
    out = {"finestra": giorni, "calendario": "ok", "esiti": "ok", "prossime": [], "concluse": []}
    try:
        annunciate = [a for a in (leggi(f"{TD}/upcoming?format=json", 20) or []) if _duration(a)]
    except Exception as ex:
        annunciate = None
        out["calendario"] = f"NON letto ({str(ex)[:40]})"
    try:
        fatte = []
        for tipo in ("Note", "Bond"):
            fatte += [a for a in (leggi(f"{TD}/auctioned?format=json&type={tipo}&days=60", 20) or [])
                      if _duration(a) and _num(a.get("highYield")) is not None]
    except Exception as ex:
        fatte = None
        out["esiti"] = f"NON letti ({str(ex)[:40]})"

    def giorno(a):
        try:
            return datetime.fromisoformat(str(_campo(a, "competitiveAuctionCloseDate", "auctionDate") or "")[:10]).date()
        except ValueError:
            return None

    # ⚠ v510 — UNA LETTURA CON VOCI CHE NON SI SANNO DATARE NON E' UN CALENDARIO VUOTO (v389): e' la quarta sorte,
    #   accanto a «con voci», «senza voci» e «NON letto». Senza, un cambio di nomi della fonte si legge «nessuna asta».
    if annunciate and not any(giorno(a) for a in annunciate):
        out["calendario"] = (f"letto ma ILLEGGIBILE: {len(annunciate)} aste di note e bond annunciate, nessuna con un "
                             "giorno riconoscibile")
    if fatte and not any(giorno(a) for a in fatte):
        out["esiti"] = (f"letti ma ILLEGGIBILI: {len(fatte)} esiti di note e bond, nessuno con un giorno "
                        "riconoscibile")

    def precedente(a):
        # ⚠ La stessa scadenza ORIGINALE, e la stessa natura (nominale o indicizzata): una
        #   riapertura si confronta col proprio titolo, non con un'altra scadenza.
        chiave = (a.get("originalSecurityTerm"), _indicizzato(a))
        prima = [x for x in (fatte or []) if (x.get("originalSecurityTerm"), _indicizzato(x)) == chiave
                 and giorno(x) and giorno(a) and giorno(x) < giorno(a)]
        if not prima:
            return None
        p = max(prima, key=giorno)
        return {"data": giorno(p).strftime("%d/%m"), "rendimento": _num(p.get("highYield")),
                "copertura": _num(p.get("bidToCoverRatio"))}

    concluse = {(x.get("cusip"), giorno(x)) for x in (fatte or [])}
    for a in annunciate or []:
        g = giorno(a)
        # ⚠ Un'asta gia' conclusa esce fra gli esiti, non anche fra le prossime: la stessa asta
        #   in due righe con due stati si legge come due aste.
        if g is None or not (oggi <= g <= oggi + timedelta(days=giorni)) \
           or (a.get("cusip"), g) in concluse:
            continue
        quando = ora_da_new_york(_campo(a, "competitiveAuctionCloseDate", "auctionDate"),
                                 _campo(a, "competitiveAuctionCloseTime", "closingTimeCompetitive"))
        out["prossime"].append({
            "giorno": g.isoformat(), "scadenza": _scadenza(a), "riapertura": a.get("reopening") == "Yes",
            "importo_mld": ((_num(a.get("offeringAmount")) or 0) / 1e9) or None,
            "quando": quando.strftime("%d/%m %H:%M") if quando else None,
            # ⚠ Passata l'ora di chiusura l'asta NON e' piu' "in arrivo", anche se la fonte non ne
            #   ha ancora pubblicato l'esito: la sera si leggerebbe "19:00" come un appuntamento.
            "chiusa": bool(quando and quando <= adesso),
            "precedente": precedente(a)})
    for a in fatte or []:
        g = giorno(a)
        if g is None or not (oggi - timedelta(days=3) <= g <= oggi):
            continue
        out["concluse"].append({
            "giorno": g.isoformat(), "data": g.strftime("%d/%m"), "scadenza": _scadenza(a),
            "rendimento": _num(a.get("highYield")),
            "copertura": _num(a.get("bidToCoverRatio")), "precedente": precedente(a)})
    out["prossime"].sort(key=lambda x: (x["giorno"], x["quando"] or ""))
    out["concluse"].sort(key=lambda x: x["giorno"], reverse=True)
    return out


# ---------------------------------------------------------------- macro dalla pipeline
# ⚠⚠ LA CHIAVE FRED NON VIVE QUI, E NON VIVE DA NESSUNA PARTE. La pipeline
# (scripts/update_data.py, GitHub Actions) ce l'ha nei secret e pubblica queste serie in
# data/data.json 14-15 volte al giorno. Leggerle di la' costa zero credenziali: il repo e'
# PUBBLICO (verificato il 12/09/2026), quindi una chiave committata sarebbe una chiave
# pubblicata, e l'ambiente delle Routine non la puo' ereditare.
#
# ⚠ E' UNA SOLA DERIVAZIONE, non due: la fetch diretta a FRED e' stata TOLTA, non affiancata.
# Due strade per la stessa grandezza divergono al primo ritocco (v161, v207, v316).
#
# ⚠⚠ IL PREZZO DI QUESTA SCELTA VA DICHIARATO, non nascosto: se la pipeline si ferma, la
# macro si ferma con lei. Quindi ogni riga porta la PROPRIA data di rilevazione (dal file, non
# dall'orologio) e il blocco dichiara l'ETA' DEL RUN. Le POSIZIONI restano fuori: quelle
# vengono da memoria/LIBRO.md e da nient'altro, cosi' se la pipeline muore il libro resta
# vero (regola v439).

# (chiave in data.json, nome da mostrare, come arrivarci)
def _ind(macro, key):
    for x in (macro.get("indicators") or []):
        if x.get("key") == key:
            return x
    return None


def macro_dalla_pipeline():
    p = os.path.join(RADICE, "data", "data.json")
    if not os.path.exists(p):
        # ⚠ Si DICHIARA il buco, non si finge (istruzione permanente del CEO, v396).
        return {"stato": "data.json ASSENTE", "serie": [], "eta_ore": None, "run": None}
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception as e:
        return {"stato": f"data.json ILLEGGIBILE: {str(e)[:40]}", "serie": [],
                "eta_ore": None, "run": None}
    import fonti_titoli
    d = fonti_titoli.carica(d)          # v512 — FedWatch e EFFR letti alla fonte nel giro, dove piu' recenti
    m = d.get("macro") or {}
    run = d.get("updated_at")
    eta = None
    if run:
        try:
            t = datetime.fromisoformat(run.replace("Z", "+00:00"))
            eta = (datetime.now(timezone.utc) - t).total_seconds() / 3600
        except Exception:
            pass

    def riga(nome, valore, data, prec=None, nota=None, periodo=None, unita=""):
        # v500 — la resa si fa QUI, una volta, per il testo e per la pagina (v455): virgola decimale come il
        #   resto dell'uscita (v442) e, su una serie mensile, il MESE descritto invece di un giorno (v392)
        return {"nome": nome, "valore": valore, "data": data, "prec": prec, "nota": nota,
                "valore_testo": valore_serie(valore, unita), "quando_testo": quando_serie(data, periodo)}

    out = []
    # tassi: la scadenza a 10 anni, con la data che la pipeline dichiara sulla scadenza stessa
    a10 = next((s for s in ((m.get("tassi") or {}).get("scadenze") or [])
                if s.get("key") == "a10"), None)
    if a10:
        out.append(riga("Treasury 10A", a10.get("value"), a10.get("observation_date"), unita="%"))
    # v500 — CPI, disoccupazione e posti di lavoro descrivono un MESE: "al 2026-09-01" si legge come una
    #   data di 47 giorni prima, ed e' la lettura che ha fatto scrivere a un LLM reale due correzioni false (v392)
    for key, nome, periodo in (("curve", "Curva 10A-2A", None), ("cpi", "Inflazione CPI (a/a)", "mese"),
                               ("unemp", "Disoccupazione", "mese"), ("nfp", "Non-Farm Payrolls", "mese"),
                               ("real10", "Tasso reale 10A (TIPS)", None)):
        x = _ind(m, key)
        if x:
            # ⚠ il campo e' "date": provato sul file vero, non indovinato dal nome della
            #   chiave usata da `tassi.scadenze`, che invece scrive "observation_date".
            out.append(riga(nome, x.get("value"), x.get("date"), periodo=periodo))
    cr = m.get("credit") or {}
    if cr.get("spread_hy") is not None:
        out.append(riga("HY OAS (credito)", cr["spread_hy"], cr.get("date"), unita="%"))
    cc = m.get("credit_ccc") or {}
    if cc.get("valore") is not None:
        # v465 — la salita dal minimo di 60 sedute e' il segnale del semaforo (LIBRO.md §1ter)
        nota = (f"{sgn(cc['salita_60_pp'], 2, ' pp')} dal minimo di 60 sedute ({n2(cc.get('min_60'), 2)}%)"
                if cc.get("salita_60_pp") is not None else "storico insufficiente per la salita")
        out.append(riga("Spread CCC (fascia peggiore)", cc["valore"], cc.get("data"),
                        prec=cc.get("mese_fa"), nota=nota, unita="%"))
    cb = m.get("credito_banche") or {}
    nf = cb.get("nfci") or {}
    if nf.get("valore") is not None:
        out.append(riga("NFCI (condizioni fin.)", nf["valore"], nf.get("data"),
                        prec=nf.get("mese_fa")))
    sl = cb.get("sloos") or {}
    if sl.get("valore") is not None:
        # ⚠ IL SEGNO DI SLOOS NON E' INTUITIVO (v390): negativo = banche che ALLENTANO.
        out.append(riga("SLOOS (banche)", sl["valore"], sl.get("data"),
                        prec=sl.get("precedente"),
                        nota="negativo = le banche allentano", periodo="indagine"))
    fm = m.get("fed_market") or {}
    ef = (m.get("fedwatch") or {}).get("effr") or {}
    if ef.get("valore") is not None:
        # ⚠⚠ v478 — L'EFFR DEL GIORNO, con la sua data e la fonte: la stessa base della catena
        #   FedWatch (v477). Questa riga leggeva `fed_market.current_rate`, che e' FEDFUNDS, la
        #   media MENSILE: il 13/10 scriveva "Fed Funds effettivo 3,75" con l'EFFR a 3,88 — la
        #   media di settembre mescola i quindici giorni prima del rialzo del 16/09 e i quindici dopo.
        out.append(riga("Fed Funds effettivo (EFFR del giorno)", ef["valore"], ef.get("data"),
                        nota=f"fonte {ef.get('fonte') or 'n.d.'}", unita="%"))
    elif fm.get("current_rate") is not None:
        # ⚠ Senza l'EFFR del giorno resta la media mensile, e si NOMINA per quello che e', col
        #   suo mese (v392: un dato mensile descrive un mese, non un giorno) — mai "effettivo".
        _mesi = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
                 "agosto", "settembre", "ottobre", "novembre", "dicembre")
        _rd = str(fm.get("rate_date") or "")
        _mese = (f"{_mesi[int(_rd[5:7]) - 1]} {_rd[:4]}"
                 if len(_rd) >= 7 and _rd[5:7].isdigit() and 1 <= int(_rd[5:7]) <= 12 else "mese non dichiarato")
        out.append(riga("Fed Funds, media MENSILE (FEDFUNDS)", fm["current_rate"], None,
                        nota=f"media di {_mese}, non il tasso di oggi: un mese con una riunione "
                             "mescola il tasso di prima e quello di dopo", unita="%"))
    eur = next((x for x in (m.get("markets") or []) if x.get("key") == "EURUSD=X"), None)
    if eur:
        out.append(riga("EUR/USD", eur.get("value"), None,
                        prec=None, nota="quotazione dello snapshot, non una serie datata"))
    return {"stato": "ok", "serie": out, "eta_ore": eta, "run": run}


# ---------------------------------------------------------------- v511: la macro ALLA FONTE, la pipeline come ripiego
# Decisione del CEO del 25/10/2026: «i dati in ritardo ... Elimina le dipendenze e cercale altrove se puoi». Le serie di
# questo blocco hanno una fonte pubblica raggiungibile SENZA credenziali (FRED il CSV pubblico, NY Fed, BCE): le legge
# scripts/fonti_dirette.py una volta per giro, con le STESSE derivazioni della pipeline (scripts/comuni.py), e la
# pipeline resta il ripiego RIGA PER RIGA, dichiarato. ⚠ La chiave FRED continua a non servire e a non vivere qui: il
# CSV pubblico e' senza chiave, e nessuno strumento ne nomina una (gate v452, riagganciato in v511).
def macro_del_giorno(giro=None):
    import fonti_dirette
    if giro is None:
        giro = fonti_dirette.del_giro()
    sc = giro.get("scelta") or {}
    out = []

    def riga(k, nome, nota=None, periodo=None, prec=None):
        v = sc.get(k)
        if not v:
            return
        out.append({"nome": nome, "valore": v.get("valore"), "data": v.get("data"), "prec": prec, "nota": nota,
                    "valore_testo": fonti_dirette.valore_testo(k, v), "quando_testo": quando_serie(v.get("data"), periodo),
                    "fonte": v.get("fonte"), "esito": v.get("esito")})

    riga("t10", "Treasury 10A")
    riga("curva", "Curva 10A-2A")
    for k, nome in (("cpi", "Inflazione CPI (a/a)"), ("disoccupazione", "Disoccupazione"), ("nfp", "Non-Farm Payrolls")):
        mesi = (sc.get(k) or {}).get("mesi")
        span = (f"su {mesi} mesi: la base esatta non c'e'" if (k == "cpi" and mesi and mesi != 12)
                or (k == "nfp" and mesi and mesi != 1) else None)
        riga(k, nome, nota=span, periodo="mese")
    riga("reale10", "Tasso reale 10A (TIPS)")
    riga("hy", "HY OAS (credito)")
    cc = sc.get("ccc") or {}
    riga("ccc", "Spread CCC (fascia peggiore)", prec=cc.get("mese_fa"),
         nota=(f"{sgn(cc['salita_60_pp'], 2, ' pp')} dal minimo di 60 sedute ({n2(cc.get('min_60'), 2)}%)"
               if cc.get("salita_60_pp") is not None else "storico insufficiente per la salita"))
    riga("nfci", "NFCI (condizioni fin.)", prec=(sc.get("nfci") or {}).get("mese_fa"))
    riga("sloos", "SLOOS (banche)", prec=(sc.get("sloos") or {}).get("precedente"),
         nota="negativo = le banche allentano", periodo="indagine")
    riga("effr", "Fed Funds effettivo (EFFR del giorno)")
    ev = sc.get("eurusd") or {}
    riga("eurusd", "EUR/USD",
         nota=("riferimento BCE delle 14:15 CET, datato" if ev.get("esito") == "fonte"
               else "quotazione dello snapshot della pipeline, non una serie datata"))
    assenti = [fonti_dirette.NOMI[k] for k in fonti_dirette.ORDINE
               if k not in sc and k not in ("fear_greed",)]
    stato = "ok" if out else "nessuna serie: ne' la fonte ne' la pipeline le hanno"
    return {"stato": stato, "serie": out, "eta_ore": giro.get("eta_ore"), "run": giro.get("run"),
            "dirette": sum(1 for r in out if r["esito"] == "fonte"),
            "ripiego": sum(1 for r in out if r["esito"] == "pipeline"), "assenti": assenti}


# ---------------------------------------------------------------- v501: gli eventi del credito dalla pipeline
def credito_dalla_pipeline(tickers, percorso=None):
    """Gli EVENTI del credito dei nomi del brief — il CDS che si allarga di colpo (settimana) o per un mese, e la
    divergenza col titolo — letti da data.json e valutati da scripts/credito.py: una lettura, un proprietario (v436).
    Richiesta del CEO del 18/10/2026: «avvisami se il costo per assicurarsi contro il default subisce rincari anomali
    o improvvisi». Le CONDIZIONI di bilancio (Altman, scadenze oltre la liquidita') restano nell'analisi: cambiano coi
    trimestri, e un avviso che suona tutte le mattine non avvisa (v421, v427)."""
    import credito
    p = percorso or os.path.join(RADICE, "data", "data.json")
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception as e:
        return {"stato": f"data.json non leggibile ({str(e)[:40]})", "eventi": []}
    if percorso is None:
        import fonti_titoli
        d = fonti_titoli.carica(d)      # v512 — il CDS letto alla fonte nel giro, se ICE e' piu' avanti della pipeline
    righe = {r.get("ticker"): r for r in (d.get("watchlist") or []) if isinstance(r, dict)}
    _sto = (((d.get("macro") or {}).get("cds") or {}).get("storia") or {})
    giorni = _sto.get("giorni")
    # v508 — i giorni raccolti a meta' si dicono anche qui: quelli dentro le finestre delle misure (uno snapshot
    #   precedente alla divisione porta solo l'elenco intero)
    parziali = (_sto.get("parziali_recenti") if "parziali_recenti" in _sto else _sto.get("parziali")) or []
    eventi, con_cds, servono = [], [], {}
    for tk in tickers:
        r = righe.get(tk)
        c = (r or {}).get("cds") or {}
        if c.get("stato") != "quotato":
            continue
        con_cds.append(tk)
        for chiave in ("finestra5", "finestra"):
            f = c.get(chiave) or {}
            if f.get("n") is not None:
                servono.setdefault(chiave, f.get("servono") or f["n"] + 1)
        eventi.extend((tk, testo) for tipo, testo in credito.segnali(r) if tipo == "evento")
    return {"stato": "ok", "eventi": eventi, "con_cds": con_cds, "giorni": giorni, "servono": servono,
            "parziali": parziali}


def righe_credito(cr):
    """Il blocco del credito, una resa sola per il testo (la pagina impagina gli stessi dati: v455)."""
    out = ["CREDITO — i CDS dei tuoi nomi: rincaro improvviso (settimana), allargamento (mese), divergenza col titolo"]
    if (cr or {}).get("stato") != "ok":
        out.append(f"  ⚠ {(cr or {}).get('stato') or 'non letto'} — non e' 'nessun evento', e' il dato che manca")
        return out
    for tk, t in cr["eventi"]:
        out.append(f"  {tk:6} {t}")
    if not cr["eventi"]:
        out.append(f"  nessun evento sui {len(cr['con_cds'])} nomi con un CDS compensato a ICE.")
    sv = cr.get("servono") or {}
    g = cr.get("giorni")
    if g is not None and sv and g < max(sv.values()):
        parti = [f"{nome} si misura da {sv[k]} giorni" if k in sv else f"{nome}: la pipeline non la pubblica ancora"
                 for k, nome in (("finestra5", "la settimana"), ("finestra", "il mese"))]
        pz = cr.get("parziali") or []
        _parz = (f" (di cui {len(pz)} raccolti a meta': " + ", ".join(f"{x[8:10]}/{x[5:7]}" for x in pz)
                 + " — un nome assente quei giorni non e' stato letto)") if pz else ""
        out.append(f"  storico dei CDS raccolto: {g} {'giorno' if g == 1 else 'giorni'}{_parz} — {', '.join(parti)}: prima, il "
                   "silenzio qui NON vuol dire 'nessun rincaro'")
    return out


# ---------------------------------------------------------------- resa
def n2(x, d=2):
    return "n.d." if x is None else f"{x:,.{d}f}".replace(",", "@").replace(".", ",").replace("@", ".")


def sgn(x, d=2, suff="%"):
    """v510 — il segno sul valore GIA' arrotondato (v496): -0,001 a due cifre e' «+0,00», mai «-0,00»."""
    if x is None:
        return "n.d."
    v = round(x, d) + 0.0
    return f"{'+' if v >= 0 else ''}{n2(v, d)}{suff}"


MESI_IT = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
           "settembre", "ottobre", "novembre", "dicembre")


def valore_serie(v, unita=""):
    """v500 — una serie della pipeline nella convenzione del resto dell'uscita (v442, v443), con le cifre
    che la fonte pubblica: 5.1 resta a una cifra, 1.1242 a quattro. I valori che la pipeline scrive gia'
    come testo ("3.7%", "+0.35 pp") cambiano solo il separatore decimale, mai il numero."""
    if v is None or isinstance(v, bool):
        return "n.d."
    if isinstance(v, (int, float)):
        s = repr(float(v))
        dec = 0 if ("e" in s or "." not in s) else len(s.split(".")[1].rstrip("0"))
        return n2(float(v), max(1, dec)) + unita
    return re.sub(r"(?<=[0-9])[.](?=[0-9])", ",", str(v)) + ("" if str(v).endswith(unita) else unita)


def quando_serie(data, periodo=None):
    """v500 — una serie mensile descrive un MESE, un'indagine trimestrale il mese in cui si e' svolta:
    scriverli come un giorno invita a leggerli vecchi di settimane (v392). Le serie giornaliere e
    settimanali portano il giorno della rilevazione."""
    if not data:
        return "rilevazione non dichiarata"
    d = str(data)[:10]
    if periodo in ("mese", "indagine") and len(d) >= 7 and d[5:7].isdigit() and 1 <= int(d[5:7]) <= 12:
        mese = f"{MESI_IT[int(d[5:7]) - 1]} {d[:4]}"
        return f"riferito a {mese}" if periodo == "mese" else f"indagine di {mese}"
    return f"al {d}"


ORARI_TRIMESTRALE = {"time-pre-market": "prima della campana", "time-after-hours": "dopo la campana",
                     "time-not-supplied": "orario non dichiarato"}


def orario_trimestrale(codice):
    """v500 — una traduzione sola per il testo e per la pagina (v455). Il 18/10 "time-not-supplied" usciva
    grezzo accanto a "orario non dichiarato": due rese dello stesso stato. Un codice nuovo della fonte si
    mostra com'e', dichiarato, invece di sparire."""
    if not codice:
        return "orario non dichiarato"
    return ORARI_TRIMESTRALE.get(codice) or f"orario «{codice}» (codice della fonte)"


def consenso_testo(eps):
    """"$0.82" della fonte → "0,82 $"; un valore che non si legge resta com'e'.
    ⚠ v509 — il calendario di Nasdaq scrive i NEGATIVI fra parentesi contabili, «($1.45)», e la
    v500 provava solo «-$1.25», che la fonte non usa: su CRWV, RGTI, OKLO e CBRS il consenso usciva
    grezzo e si leggeva positivo. Le parentesi sono un segno, e diventano un meno."""
    if eps in (None, ""):
        return None
    s = str(eps).replace("$", "").replace(",", "").strip()
    negativo = len(s) > 2 and s[0] == "(" and s[-1] == ")"
    try:
        v = float(s[1:-1].strip() if negativo else s)
    except ValueError:
        return str(eps)
    return n2((-v if negativo else v) or 0.0, 2) + " $"     # «or 0.0»: mai un «-0,00 $»


def _prec(p):
    if not p:
        return " · asta precedente della stessa scadenza non trovata negli ultimi 60 giorni"
    return f" · precedente {p['data']}: rendimento {n2(p['rendimento'], 3)}%, domanda/offerta {n2(p['copertura'])}"


def righe_aste(x):
    """Il blocco delle aste. L'ora arriva GIA' convertita da aste_tesoro: qui non si fa
    nessun conto sugli orari, cosi' testo e pagina non possono divergere (v161, v207)."""
    if not x:
        return ["ASTE DEL TESORO USA", "  ⚠ non lette in questo run (diverso da 'nessuna asta')."]
    R = [f"ASTE DEL TESORO USA — note e bond, prossimi {x['finestra']} giorni (TreasuryDirect)",
         "  calendario, importo e ora DICHIARATI dal Tesoro; l'ora di New York e' convertita col",
         "  fuso, mai con uno scarto a mano. Esclusi bills (sotto l'anno) e tasso variabile."]
    if x["calendario"] != "ok":
        R.append(f"  ⚠ calendario {x['calendario']} — diverso da 'nessuna asta'.")
    elif not x["prossime"]:
        R.append(f"  nessuna asta annunciata nei prossimi {x['finestra']} giorni.")
    for a in x["prossime"]:
        quando = f"{a['quando']} ora italiana" if a.get("quando") else f"{a['giorno']}, ora non dichiarata"
        imp = f" · {n2(a['importo_mld'], 0)} mld $" if a.get("importo_mld") else ""
        rip = " (riapertura)" if a.get("riapertura") else ""
        chiusa = " — CHIUSA: esito non ancora pubblicato dalla fonte" if a.get("chiusa") else ""
        R.append(f"  {quando} · {a['scadenza']}{rip}{imp}{chiusa}{_prec(a.get('precedente'))}")
    if x["esiti"] != "ok":
        R.append(f"  ⚠ esiti {x['esiti']} — diverso da 'nessuna asta conclusa'.")
    elif x["concluse"]:
        R.append("  esiti degli ultimi 3 giorni — domanda/offerta = quante volte le domande hanno")
        R.append("  coperto l'importo:")
        for a in x["concluse"]:
            R.append(f"  {a['data']} {a['scadenza']}: rendimento {n2(a['rendimento'], 3)}%, "
                     f"domanda/offerta {n2(a['copertura'])}{_prec(a.get('precedente'))}")
        R.append("  ⚠ lo scarto dal rendimento che il mercato si aspettava (tail) NON e' in questa fonte.")
    return R


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
    A(f"BRIEF {'MATTINA' if modo=='mattina' else 'POMERIGGIO'} — {ora.strftime('%d/%m/%Y %H:%M')} ora italiana")
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
        A(f"  {r['tk']:6} seduta del {r.get('seduta_quota') or r.get('seduta','n.d.')}: {' · '.join(q)}")
        A(f"         {riga_titolo(r, True).split(chr(10))[1].strip()}")

    # --- 1bis. TRIMESTRALI IN ARRIVO
    cal = dati["trimestrali"]
    A("")
    A(f"TRIMESTRALI DICHIARATE DALLA FONTE — prossimi {cal['finestra']} giorni")
    if not cal["attesi"]:
        A("  nessuna. ⚠ Non e' 'nessuna trimestrale mai': e' che nella finestra la fonte non")
        A("  ne dichiara. Oltre la finestra il sistema non guarda.")
    for x in cal["attesi"]:
        q = x.get("orario") or orario_trimestrale(x.get("quando"))
        _cons = x.get("consenso") or consenso_testo(x.get("eps_atteso"))
        eps = f" · consenso {_cons}" if _cons else ""
        fonte = "" if x.get("fonte", "calendario Nasdaq") == "calendario Nasdaq" else f" · {x['fonte']}"
        A(f"  {x['tk']:6} {x['data']} (fra {x['giorni']}g) · {q}{eps}{fonte}")
    if cal["giorni_non_letti"]:
        A(f"  ⚠ giorni NON letti (diverso da 'nessuna uscita'): {len(cal['giorni_non_letti'])}")

    # --- 1ter. ASTE DEL TESORO USA (v470)
    A("")
    for riga in righe_aste(dati.get("aste")):
        A(riga)

    # --- 1quater. CREDITO (v501)
    A("")
    for riga in righe_credito(dati.get("credito")):
        A(riga)

    # --- 2. LIVELLI DEL LIBRO
    A("")
    A("DOVE STA OGNI POSIZIONE (livelli misurati — la decisione resta sul tuo grafico)")
    for r in sorted([x for x in vivi if not x.get("sorvegliato")], key=lambda x: -(x.get("peso") or 0)):
        A(riga_titolo(r, True))
    for r in t:
        if r.get("errore"):
            A(riga_titolo(r))

    # --- 2bis. SORVEGLIATI — stessa tecnica, ma NON sono posizioni e la riga lo dichiara
    osservati = [x for x in vivi if x.get("sorvegliato")]
    if osservati:
        A("")
        A(f"SORVEGLIATI — {len(osservati)}, NON in posizione: zero quote, zero peso, fuori da")
        A("  patrimonio, contributo al rischio e da ogni misura del libro. Solo tecnica e notizie.")
        for r in osservati:
            A(riga_titolo(r, True))
            if r.get("nota_sorv"):
                A(f"         {r['nota_sorv']}")

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
        eta = mf.get("eta_ore")
        # v511 — le serie si leggono ALLA FONTE (scripts/fonti_dirette.py); la pipeline e' il ripiego riga per riga.
        #   ⚠ L'eta' del run si dichiara quando una riga viene da lei: se la pipeline si ferma, quelle righe si
        #   fermano con lei, e chi legge deve poterlo vedere invece di dedurlo (v369, v406).
        rip = mf.get("ripiego")
        if rip is None:                                   # la resa della sola pipeline (macro_dalla_pipeline)
            rip = len(mf["serie"])
        if mf.get("dirette"):
            A(f"  lette ALLA FONTE adesso: {mf['dirette']} serie (FRED, NY Fed, BCE) — ogni riga porta la PROPRIA "
              "rilevazione; la pipeline e' il ripiego")
        if rip:
            if eta is None:
                A(f"  ⚠ {rip} serie dalla pipeline, che non dichiara quando ha girato")
            elif eta > 24:
                A(f"  ⚠⚠ PIPELINE FERMA DA {n2(eta,1)} ORE: le {rip} serie che vengono da lei non si aggiornano da allora.")
            else:
                A(f"  {rip} serie dalla pipeline (ripiego), run di {n2(eta,1)} ore fa — ogni riga porta la PROPRIA rilevazione")
        for s in mf["serie"]:
            quando = s.get("quando_testo") or quando_serie(s.get("data"))
            prec = ""
            if s.get("prec") is not None and isinstance(s.get("valore"), (int, float)):
                prec = f"   (prima {valore_serie(s['prec'])})"
            nota = f"   — {s['nota']}" if s.get("nota") else ""
            dove = "   [pipeline]" if s.get("esito") == "pipeline" and mf.get("dirette") else ""
            A(f"  {s['nome']:24} {(s.get('valore_testo') or valore_serie(s.get('valore'))):>10}   {quando}{prec}{nota}{dove}")
        if mf.get("assenti"):
            A(f"  ⚠ NON DISPONIBILI (ne' alla fonte ne' nella pipeline): {', '.join(mf['assenti'])} — e' il dato che "
              "manca, non un valore neutro")

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
    pos, cassa, sorv = leggi_libro()
    azioni = [p for p in pos if p["valuta"] == "USD"]
    # ⚠ v454 — i SORVEGLIATI entrano nella tecnica e nelle notizie, MAI negli aggregati del
    #   libro: il peso si calcola sul solo `azioni`, quindi un titolo non posseduto non puo'
    #   diluire i pesi ne' entrare nel patrimonio. Portano `sorvegliato: True` perche' chi
    #   legge non li confonda con una posizione.
    tickers = [p["tk"] for p in azioni] + [s["tk"] for s in sorv]

    with ThreadPoolExecutor(max_workers=PARALLELI) as ex:
        tec = list(ex.map(tecnica, tickers))
    idx = {r["tk"]: r for r in tec}
    tot = sum((idx[p["tk"]].get("px") or 0) * p["qta"] for p in azioni)
    for p in azioni:
        r = idx[p["tk"]]
        r["peso"] = ((r.get("px") or 0) * p["qta"] / tot * 100) if tot else None
        r["qta"] = p["qta"]; r["pmc"] = p["pmc"]
    for s in sorv:
        r = idx.get(s["tk"])
        if r:
            r["sorvegliato"] = True; r["nota_sorv"] = s["nota"]

    ora_utc = datetime.now(timezone.utc)
    da = ora_utc - timedelta(hours=finestra)
    nw = raccogli_news(tickers, da)
    cal = calendario_trimestrali(tickers)
    aste = aste_tesoro()
    mf = macro_del_giorno()                    # v511 — alla fonte, la pipeline come ripiego
    cr = credito_dalla_pipeline(tickers)       # v501

    sedute = [r["seduta"] for r in tec if r.get("seduta")]
    base = max(set(sedute), key=sedute.count) if sedute else "n.d."

    # ⚠ v470 — l'ora italiana dal FUSO: il "+2 ore" scritto a mano qui era giusto solo
    #   d'estate, e dal 25/10 avrebbe datato ogni brief un'ora avanti (v437, v439).
    dati = {"ora": ora_utc.astimezone(ROMA), "ora_utc": ora_utc, "modo": modo,
            "finestra_h": finestra, "tecnica": tec, "news": nw, "macro_fred": mf,
            "trimestrali": cal, "aste": aste, "credito": cr,
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
