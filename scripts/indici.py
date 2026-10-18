#!/usr/bin/env python3
"""INDICI — S&P 500 e Nasdaq-100 (v499): valutazione, stagione delle trimestrali, volatilita' implicita,
concentrazione, ampiezza e tendenza.

Uso:  python3 scripts/indici.py [--no-memoria]

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il CEO, 17/10/2026: «Monitora anche Nasdaq e sep ed il relativo pe e altri parametri di analisi che ritieni
utili. Rendi tutt'e questi nuovi inserimenti strutturali», con un video che confronta il P/E prospettico
dell'S&P 500 con la sua media decennale, pesa i primi dieci titoli dell'indice e paragona il P/E del Nasdaq
con quello del 1999.

Lo script SELEZIONA e MISURA; il giudizio lo scrive il modello (v448). E' INFORMAZIONE: nessuna di queste
misure e' una prova della tenuta, un colore del semaforo o una vendita (FORMATO_ANALISI.md, 5ter).

═══ UN MULTIPLO SI CONFRONTA SOLO CON LA STORIA DELLA PROPRIA FONTE ═══════════════════════════
Il P/E «degli ultimi 12 mesi» dell'S&P 500 non e' un numero solo: multpl usa gli utili riportati (la serie di
Shiller), il WSJ un'altra definizione, worldperatio gli utili delle societa' dell'ETF — misurato il 16/10/2026,
tre numeri veri e diversi. Confrontare il valore di una fonte con la media di un'altra e' la classe dei
denominatori non dichiarati (v240). Qui ogni multiplo esce con la storia DELLA SUA fonte, o senza storia:
- S&P 500, prospettico: FactSet, con le medie a 5 e 10 anni della stessa FactSet;
- S&P 500, ultimi 12 mesi e CAPE: multpl, con le medie calcolate QUI sulla stessa serie mensile;
- Nasdaq-100: WSJ, ultimi 12 mesi e prospettico. L'unica storia gratuita e' il valore di 52 settimane prima:
  il resto si raccoglie da oggi (memoria/indici.jsonl), come lo storico dei CDS (v498).
Esclusi, con la ragione: worldperatio — una terza definizione, e il 16/10 il suo valore stava a -3,7 deviazioni
dalla media del proprio anno, un salto che da qui non si verifica; la «media storica 16,5» che la pipeline porta
accanto al prospettico, senza provenienza (v240).

═══ LE FONTI, MISURATE IL 17/10/2026 DA QUESTO AMBIENTE (lo strumento gira nella sessione, non nel CI) ═══
- FactSet, Earnings Insight: un PDF ogni venerdi', l'indirizzo porta la data (404 se quel giorno non c'e').
  Il testo che Word scrive sta in blocchi posizionati, spezzati anche dentro un numero: si ricompone per RIGA
  DI BASE con la sola libreria standard (zlib) — provato su tre rapporti (02/10, 09/10, 16/10), le frasi
  chiave escono intere. Le frasi cambiano con la stagione (conteggi prima delle percentuali, «estimated»
  prima di «blended»): ogni forma si riconosce, e una frase non trovata si DICHIARA, mai si indovina.
- multpl: tabelle mensili dal 1871 (P/E) e dal 1881 (CAPE). La prima riga e' il valore del giorno, che la
  fonte stima dall'ultimo utile riportato; i mesi marcati † sono stime della fonte, e si contano.
- WSJ, «P/Es & Yields on Major Indexes»: un oggetto JSON per indice dentro la pagina, con la seduta.
- CBOE: storico dei valori di chiusura di VIX, VXN e VIX3M (dal 1990, dal 2009).
- stockanalysis: barre di SPY, QQQ, RSP e QQEW — prezzi di oggi, la stessa fonte di brief e rotazione — e la
  composizione degli ETF (la quota dei primi dieci, i loro nomi, la data dei dati dell'emittente).
- pipeline (data/data.json): Treasury e TIPS a 10 anni con le loro date — una grandezza, un proprietario (v436).
"""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import re
import statistics
import sys
import urllib.error
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief            # noqa: E402
import numeri_libro as NL  # noqa: E402  (i formattatori: virgola decimale, un posto solo — v443)
import posizionamento as POS  # noqa: E402  (scarica, il segno sul valore arrotondato, il percentile: v161)
import rotazione        # noqa: E402

RADICE = Path(__file__).resolve().parent.parent
NEW_YORK, ROMA = brief.NEW_YORK, brief.ROMA
MEMORIA = RADICE / "memoria" / "indici.jsonl"

URL_FACTSET = ("https://advantage.factset.com/hubfs/Website/Resources%20Section/Research%20Desk/Earnings%20Insight/"
               "EarningsInsight_{d}.pdf")
URL_MULTPL = {"pe": "https://www.multpl.com/s-p-500-pe-ratio/table/by-month",
              "cape": "https://www.multpl.com/shiller-pe/table/by-month"}
URL_WSJ = "https://www.wsj.com/market-data/stocks/peyields"
URL_COMPOSIZIONE = "https://stockanalysis.com/etf/{tk}/holdings/"
URL_VOL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/{s}_History.csv"

# ⚠ Convenzioni, dichiarate (v240): nessuna di queste e' un dato del mercato.
GIORNI_FACTSET = 21      # i rapporti si cercano tre settimane indietro: un venerdi' festivo non basta a perderli
ANNI_MEDIE = (5, 10, 20)  # le medie della serie mensile di multpl
SEDUTE_ANNO = 252        # la distribuzione di un anno di sedute (volatilita', struttura a termine)
MIN_STORIA = 252         # la storia raccolta del Nasdaq-100: sotto un anno di sedute il percentile non si pubblica
SEDUTE_AMPIEZZA = (21, 63)  # un mese e tre mesi di sedute
NOME_WSJ = {"ndx": "NASDAQ 100 Index"}
VOLATILITA = (("VIX", "S&P 500, prossimi 30 giorni"), ("VXN", "Nasdaq-100, prossimi 30 giorni"),
              ("VIX3M", "S&P 500, prossimi 3 mesi"))
TENDENZA = (("SPY", "S&P 500"), ("QQQ", "Nasdaq-100"))
AMPIEZZA = (("RSP", "SPY", "S&P 500"), ("QQEW", "QQQ", "Nasdaq-100"))
MESI_EN = {m: i for i, m in enumerate(("January", "February", "March", "April", "May", "June", "July", "August",
                                       "September", "October", "November", "December"), 1)}
GIORNI_EN = {"Monday": "lunedi'", "Tuesday": "martedi'", "Wednesday": "mercoledi'", "Thursday": "giovedi'",
             "Friday": "venerdi'"}

_it, _mese = NL._it, NL._mese
_sg, _gma, _rango, _pct_rank = POS._sg, POS._gma, POS._rango, POS._pct_rank


# ══════════════════════════════════════ IL TESTO DI UN PDF, CON LA SOLA LIBRERIA STANDARD ══════════════════════
_ESC = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}
_RX_BLOCCO = re.compile(rb"\bBT\b(.*?)\bET\b", re.S)
_RX_TM = re.compile(rb"(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm")
_RX_TESTO = re.compile(rb"\[(.*?)\]\s*TJ|(\((?:\\.|[^\\)])*\))\s*Tj", re.S)


def _letterali(s):
    """Le stringhe letterali di un operando PDF, con le sequenze di escape (ottale compreso). Le stringhe
    esadecimali (font composti) si saltano: Word ci scrive i simboli, non le frasi che servono qui."""
    out, i = [], 0
    while True:
        i = s.find(b"(", i)
        if i < 0:
            return out
        depth, j, buf = 1, i + 1, bytearray()
        while j < len(s):
            ch = s[j:j + 1]
            if ch == b"\\":
                m = re.match(rb"[0-7]{1,3}", s[j + 1:j + 4])
                if m:
                    buf.append(int(m.group(0), 8) & 0xFF)
                    j += 1 + len(m.group(0))
                    continue
                nx = s[j + 1:j + 2]
                buf += _ESC.get(nx, b"" if nx in (b"\r", b"\n") else nx)
                j += 2
                continue
            if ch == b"(":
                depth += 1
            elif ch == b")":
                depth -= 1
                if depth == 0:
                    break
            buf += ch
            j += 1
        out.append(bytes(buf))
        i = j + 1


def testo_pdf(b):
    """Il testo di un PDF scritto da Word: i flussi compressi (zlib), i blocchi BT…ET con la loro posizione (Tm),
    le stringhe di TJ e Tj in WinAnsi. ⚠ Word spezza una riga in molti blocchi, anche DENTRO un numero («2»
    «9.0%»): i blocchi sulla stessa riga di base si uniscono SENZA spazio, un cambio di riga diventa un a capo —
    misurato su tre rapporti FactSet, «29.0%» esce intero. Unire con uno spazio darebbe «2 9.0%», che una
    regola sui numeri leggerebbe come due numeri."""
    pezzi = []
    for n, grezzo in enumerate(re.findall(rb"stream\r?\n(.*?)\r?\nendstream", b, re.S)):
        try:
            d = zlib.decompress(grezzo)
        except zlib.error:
            continue
        for blocco in _RX_BLOCCO.findall(d):
            m = _RX_TM.search(blocco)
            y = float(m.group(6)) if m else None
            t = "".join(s.decode("cp1252", "replace") for op in _RX_TESTO.findall(blocco)
                        for s in _letterali(op[0] or op[1]))
            if t:
                pezzi.append((n, y, t))
    out, prec = [], None
    for n, y, t in pezzi:
        if prec is not None and (n != prec[0] or y is None or prec[1] is None or abs(y - prec[1]) > 1.0):
            out.append("\n")
        out.append(t)
        prec = (n, y)
    return "".join(out)


# ══════════════════════════════════════ FACTSET — P/E PROSPETTICO E STAGIONE DELLE TRIMESTRALI ═════════════════
_V = r"(above|below|equal to)"
RX_FACTSET = {
    "data": re.compile(r"EARNINGS INSIGHT (" + "|".join(MESI_EN) + r") (\d{1,2}), (\d{4})"),
    # «is 19.0. This P/E ratio is below the 5-year average (19.8) and below the 10-year average (19.1)»; nella
    #   sezione di dettaglio «… average of 19.8 but equal to …»: le due forme, «and» e «but»
    "pe": re.compile(r"The forward 12-month P/E ratio for the S&P 500 is (\d+\.\d)[^.]*?\. This P/E ratio is " + _V
                     + r" the 5-year average (?:of )?\(?(\d+\.\d)\)? (?:and|but) " + _V
                     + r" the 10-year average (?:of )?\(?(\d+\.\d)\)?"),
    "giorno": re.compile(r"based on (" + "|".join(GIORNI_EN) + r")[’']?s closing price"),
    # prima della stagione FactSet scrive CONTEGGI («with 19 S&P 500 companies»), poi PERCENTUALI («with 9% of»)
    "pagella": re.compile(r"For (Q\d \d{4}) \(with (\d+)(%)? (?:of )?S&P 500 companies reporting actual results\), "
                          r"(\d+)%? (?:of )?S&P 500 companies ha(?:s|ve) reported a positive EPS surprise and (\d+)%? "
                          r"(?:of )?S&P 500 companies ha(?:s|ve) reported a positive revenue surprise"),
    "crescita": re.compile(r"For (Q\d \d{4}), the (blended|estimated) \(year-over-year\) earnings (growth rate|decline) "
                           r"for the S&P 500 is (-?\d+\.\d)%"),
    "battono": re.compile(r"Of these companies, (\d+)% have reported actual EPS above estimates, which is " + _V
                          + r" the 5-year average of (\d+)% (?:and|but) " + _V + r" the 10-year average of (\d+)%"),
    "sorpresa": re.compile(r"companies are reporting earnings that are (\d+\.\d)% (above|below) estimates, which is "
                           + _V + r" the 5-year average of (-?\d+\.\d)% (?:and|but) " + _V
                           + r" the 10-year average of (-?\d+\.\d)%"),
}


def leggi_factset(testo):
    """Le misure del rapporto, ciascuna dalla SUA frase. Una frase non trovata va in 'mancano' — una lettura in
    meno dichiarata, mai un numero indovinato (v396). Il testo si appiattisce prima: le frasi vanno a capo."""
    t = re.sub(r"\s+", " ", testo)
    out, mancano = {}, []
    m = RX_FACTSET["data"].search(t)
    if m:
        out["data"] = date(int(m.group(3)), MESI_EN[m.group(1)], int(m.group(2))).isoformat()
    m = RX_FACTSET["pe"].search(t)
    if m:
        out["pe"] = {"valore": float(m.group(1)), "media5": float(m.group(3)), "media10": float(m.group(5))}
    else:
        mancano.append("P/E prospettico")
    m = RX_FACTSET["giorno"].search(t)
    out["giorno_prezzo"] = GIORNI_EN.get(m.group(1)) if m else None
    m = RX_FACTSET["pagella"].search(t)
    if m:
        out["pagella"] = {"trimestre": m.group(1), "riportato": int(m.group(2)), "in_percentuale": bool(m.group(3)),
                          "utile_sopra": int(m.group(4)), "ricavi_sopra": int(m.group(5))}
    else:
        mancano.append("pagella della stagione")
    m = RX_FACTSET["crescita"].search(t)
    if m:
        out["crescita"] = {"trimestre": m.group(1), "tipo": m.group(2), "valore": float(m.group(4))}
    else:
        mancano.append("crescita degli utili")
    m = RX_FACTSET["battono"].search(t)
    if m:
        out["battono"] = {"valore": int(m.group(1)), "media5": int(m.group(3)), "media10": int(m.group(5))}
    m = RX_FACTSET["sorpresa"].search(t)
    if m:
        segno = 1 if m.group(2) == "above" else -1
        out["sorpresa"] = {"valore": segno * float(m.group(1)), "media5": float(m.group(4)),
                           "media10": float(m.group(6))}
    out["mancano"] = mancano
    return out


def cerca_factset(oggi, leggi=POS.scarica, giorni=GIORNI_FACTSET, quanti=2):
    """I `quanti` rapporti piu' recenti, dal giorno feriale di oggi all'indietro. Un 404 e' «quel giorno non c'e'»
    (FactSet pubblica il venerdi'); un altro errore e' una lettura NON riuscita, che si conta (v389): «nessun
    rapporto nelle tre settimane» e «la fonte non ha risposto» si leggono uguali e sono cose diverse."""
    trovati, errori = [], []
    for k in range(giorni):
        g = oggi - timedelta(days=k)
        if g.weekday() >= 5:
            continue
        try:
            b = leggi(URL_FACTSET.format(d=g.strftime("%m%d%y")))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                errori.append(f"{g:%d/%m} HTTP {e.code}")
            continue
        except Exception as e:  # noqa: BLE001
            errori.append(f"{g:%d/%m} {type(e).__name__}")
            continue
        if not b.startswith(b"%PDF"):
            errori.append(f"{g:%d/%m} non e' un PDF")
            continue
        trovati.append((g.isoformat(), b))
        if len(trovati) >= quanti:
            break
    return trovati, errori


def stato_factset(oggi, leggi=POS.scarica):
    trovati, errori = cerca_factset(oggi, leggi)
    rapporti = []
    for d, b in trovati:
        r = leggi_factset(testo_pdf(b))
        r.setdefault("data", d)
        rapporti.append(r)
    return {"rapporti": rapporti, "errori": errori}


# ══════════════════════════════════════ MULTPL — P/E E CAPE CON LA LORO STORIA ═════════════════════════════════
def leggi_multpl(testo):
    """[(data ISO, valore, stima)] in ordine di data. La stima e' il † della fonte."""
    out = []
    for a, b in re.findall(r"<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", testo, flags=re.S):
        etichetta = html.unescape(re.sub(r"<[^>]+>", "", a)).strip()
        valore = html.unescape(re.sub(r"<[^>]+>", " ", b)).strip()
        try:
            g = datetime.strptime(etichetta, "%b %d, %Y").date()
        except ValueError:
            continue
        m = re.search(r"-?\d+(?:\.\d+)?", valore.replace(",", ""))
        if m:
            out.append((g.isoformat(), float(m.group(0)), "†" in valore))
    return sorted(out)


def stato_mensile(righe, anni=ANNI_MEDIE):
    """Il valore del giorno contro la SUA serie mensile: le MEDIANE degli ultimi N anni di mesi, quanti di quei mesi
    sono stime della fonte, il percentile sugli ultimi 20 anni e su tutta la serie, il massimo con la data.
    La riga del giorno non e' un mese: resta fuori dalla serie con cui si confronta.
    ⚠ La MEDIANA e non la media: misurato il 17/10/2026, la media a 20 anni del P/E valeva 25,6 e la mediana 22,7 —
    la gonfiavano i mesi del 2009, quando gli utili crollati portarono il P/E sopra 100. Con la media il valore di
    oggi si leggeva «in linea con la storia» mentre stava al 76° percentile. La mediana e' il 50° percentile: la
    stessa misura del percentile accanto, che quei mesi non spostano."""
    if not righe:
        return None
    oggi = righe[-1]
    mesi = [r for r in righe[:-1] if r[0][8:10] == "01"]
    if not mesi:
        return None
    medie = {}
    for a in anni:
        fin = mesi[-a * 12:]
        if len(fin) < a * 12:
            medie[a] = None
            continue
        medie[a] = {"valore": statistics.median(v for _, v, _s in fin), "stime": sum(1 for *_x, s in fin if s),
                    "dal": fin[0][0]}
    venti = [v for _, v, _s in mesi[-max(anni) * 12:]]
    mx = max(mesi, key=lambda r: r[1])
    return {"data": oggi[0], "valore": oggi[1], "stima": oggi[2], "medie": medie, "dal": mesi[0][0],
            "rango20": _rango(_pct_rank(oggi[1], venti)), "rango_tutto": _rango(_pct_rank(oggi[1], [v for _, v, _s in mesi])),
            "massimo": {"data": mx[0], "valore": mx[1]}}


# ══════════════════════════════════════ WSJ — NASDAQ-100 ══════════════════════════════════════════════════════
def leggi_wsj(testo, nome=NOME_WSJ["ndx"]):
    """Il record JSON dell'indice nella pagina, e la seduta (tradeDate) del blocco che lo contiene: l'ultima
    dichiarata PRIMA del record. Un campo vuoto o non numerico e' un buco, non uno zero (v205)."""
    m = re.search(r'\{"instrumentId":"[^"]*","name":"' + re.escape(nome) + r'"[^{}]*\}', testo)
    if not m:
        return None
    try:
        r = json.loads(m.group(0))
    except ValueError:
        return None
    sedute = re.findall(r'"tradeDate":"(\d{4}-\d{2}-\d{2})', testo[:m.start()])

    def f(k):
        try:
            return float(r.get(k))
        except (TypeError, ValueError):
            return None
    return {"data": sedute[-1] if sedute else None, "pe": f("priceEarningsRatio"), "fwd": f("priceEarningsRatioEstimate"),
            "pe_52s": f("priceEarningsRatio52WeekAgo")}


def leggi_memoria(p=MEMORIA):
    out = {}
    try:
        testo = Path(p).read_text(encoding="utf-8")
    except OSError:
        return out
    for riga in testo.splitlines():
        try:
            r = json.loads(riga)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("data"):
            out[r["data"]] = r
    return out


def aggiungi_memoria(memoria, wsj):
    """Una riga per SEDUTA del WSJ, mai riscritta: la prima lettura di una seduta resta quella (la riga e'
    immutabile come i file di CBOE e FINRA). Senza la seduta dichiarata non si registra niente — una data
    indovinata sarebbe una storia falsa (v396). True se la memoria e' cambiata."""
    if not wsj or not wsj.get("data") or wsj["data"] in memoria or wsj.get("fwd") is None:
        return False
    memoria[wsj["data"]] = {"data": wsj["data"], "ndx_pe": wsj.get("pe"), "ndx_fwd": wsj["fwd"]}
    return True


def scrivi_memoria(memoria, p=MEMORIA):
    Path(p).write_text("".join(json.dumps(memoria[d], ensure_ascii=False, sort_keys=True) + "\n" for d in sorted(memoria)),
                       encoding="utf-8")


def storia_raccolta(memoria, chiave="ndx_fwd", minimo=MIN_STORIA):
    """Quante sedute raccolte, da quando, la seduta precedente, e il percentile solo da `minimo` in su."""
    righe = [(d, memoria[d].get(chiave)) for d in sorted(memoria) if memoria[d].get(chiave) is not None]
    if not righe:
        return {"n": 0}
    out = {"n": len(righe), "dal": righe[0][0], "ultima": righe[-1], "prec": righe[-2] if len(righe) > 1 else None}
    if len(righe) >= minimo:
        out["rango"] = _rango(_pct_rank(righe[-1][1], [v for _, v in righe[-SEDUTE_ANNO:]]))
    return out


# ══════════════════════════════════════ CBOE — VOLATILITA' IMPLICITA DEGLI INDICI ══════════════════════════════
def leggi_vol(testo, colonna="CLOSE"):
    """Lo storico di CBOE → [(data ISO, chiusura)] in ordine di data. v500 — `colonna`: lo storico dell'SPX non ha
    CLOSE ma una colonna col nome dell'indice, e la misura dei segnali lo legge con questo stesso lettore (v161)."""
    out = []
    for r in csv.DictReader(io.StringIO(testo)):
        try:
            g = datetime.strptime(str(r["DATE"]).strip(), "%m/%d/%Y").date()
            out.append((g.isoformat(), float(r[colonna])))
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out)


def stato_vol(serie, n=SEDUTE_ANNO):
    if not serie:
        return None
    anno = [v for _, v in serie[-n:]]
    d, v = serie[-1]
    prec = serie[-2][1] if len(serie) > 1 else None
    return {"data": d, "valore": v, "var": (v / prec - 1) * 100 if prec else None, "rango": _rango(_pct_rank(v, anno)),
            "n": len(anno)}


def struttura_termine(breve, lunga, n=SEDUTE_ANNO):
    """VIX contro VIX3M negli STESSI giorni (per data, v207): il rapporto di oggi e il suo percentile dell'anno."""
    if not breve or not lunga:
        return None
    lu = dict(lunga)
    comuni = [(d, v / lu[d]) for d, v in breve if d in lu and lu[d]]
    if not comuni:
        return None
    anno = [r for _, r in comuni[-n:]]
    d, r = comuni[-1]
    return {"data": d, "rapporto": r, "breve": dict(breve)[d], "lunga": lu[d], "rango": _rango(_pct_rank(r, anno)),
            "n": len(anno)}


# ══════════════════════════════════════ COMPOSIZIONE DEGLI ETF — CONCENTRAZIONE ═══════════════════════════════
def leggi_composizione(testo):
    """La quota dei primi dieci come la pubblica la pagina, la data dei dati dell'emittente, e i primi dieci nomi
    col loro peso. ⚠ Le due classi di Alphabet sono due righe: i «primi dieci» della fonte le contano due volte."""
    m = re.search(r"Top 10 Percentage\s*<div[^>]*>\s*([\d.]+)%", testo)
    a = re.search(r'lastUpdated:"([^"]+)"', testo)
    try:
        aggiornato = datetime.strptime(a.group(1), "%b %d, %Y").date().isoformat() if a else None
    except ValueError:
        aggiornato = None
    primi = []
    for no, tk, nome, peso in re.findall(r'\{no:(\d+),s:"\$?([^"]+)",n:"([^"]*)",holdingWeight:([\d.]+)', testo):
        if int(no) <= 10:
            primi.append({"tk": tk.replace(".", "-"), "nome": nome, "peso": float(peso)})
    if not m and not primi:
        return None
    return {"top10": float(m.group(1)) if m else None, "data": aggiornato, "primi": primi}


# ══════════════════════════════════════ AMPIEZZA E TENDENZA — PREZZI DI OGGI ══════════════════════════════════
def variazione_comune(ba, bb, sedute):
    """Le variazioni di due ETF sulle STESSE sedute (per data, v207): l'ultima data comune e quella `sedute`
    date comuni prima. None se la storia comune e' piu' corta."""
    da, db = {x["t"]: x["c"] for x in ba or []}, {x["t"]: x["c"] for x in bb or []}
    comuni = sorted(set(da) & set(db))
    if len(comuni) <= sedute:
        return None
    a, b = comuni[-1 - sedute], comuni[-1]
    if not da[a] or not db[a]:
        return None
    return {"da": a, "a": b, "uguale": (da[b] / da[a] - 1) * 100, "cap": (db[b] / db[a] - 1) * 100}


def da_inizio_anno(barre):
    """Dalla chiusura dell'ultima seduta dell'anno prima; None se la storia non ci arriva."""
    if not barre:
        return None
    anno = barre[-1]["t"][:4]
    prima = [x for x in barre if x["t"][:4] < anno]
    if not prima or not prima[-1]["c"]:
        return None
    return (barre[-1]["c"] / prima[-1]["c"] - 1) * 100


def scheda_indice(tk, barre, lunghe=None, adesso=None):
    """La tendenza dell'ETF con le funzioni dei titoli (brief.tecnica, rotazione.*): una regola, un posto (v161)."""
    t = brief.tecnica(tk, d=barre) if barre else {"tk": tk, "errore": "nessuna barra"}
    if t.get("errore"):
        return {"tk": tk, "errore": t["errore"]}
    px, atr = t["px"], t.get("atr")
    out = {"tk": tk, "px": px, "seduta": t.get("seduta_quota") or t["seduta"], "oggi": t.get("var_pct"),
           "s5": rotazione.variazione(barre, 5), "s21": rotazione.variazione(barre, 21),
           "s63": rotazione.variazione(barre, 63), "anno": da_inizio_anno(barre), "rsi": rotazione.rsi_wilder(barre),
           "dmax52": t.get("dmax52_pct"), "max52": t.get("max52"), "atr_pct": t.get("atr_pct"),
           **{f"sma{k}": t.get(f"sma{k}") for k in (20, 50, 200)}, **{f"d{k}_atr": t.get(f"d{k}_atr") for k in (20, 50, 200)},
           **rotazione.volumi(barre, adesso)}
    out["cinque_anni"] = rotazione.lettura_5anni(lunghe, px, adesso) if lunghe else None
    out["struttura"] = rotazione.struttura(lunghe, px, atr, adesso) if lunghe else None
    return out


def tassi_pipeline(d):
    """Treasury e TIPS a 10 anni dalla pipeline, per CHIAVE (non per il nome che si legge: v196), con le loro date."""
    m = (d or {}).get("macro") or {}
    a10 = next((s for s in ((m.get("tassi") or {}).get("scadenze") or []) if s.get("key") == "a10"), None) or {}
    r10 = next((x for x in (m.get("indicators") or []) if x.get("key") == "real10"), None) or {}

    def num(x):
        mm = re.search(r"-?\d+(?:\.\d+)?", str(x if x is not None else ""))
        return float(mm.group(0)) if mm else None
    return {"nominale": num(a10.get("value")), "data_nominale": a10.get("observation_date"),
            "reale": num(r10.get("value")), "data_reale": r10.get("date")}


def premio(pe_fwd, tassi):
    """Il rendimento degli utili attesi (100 / P/E prospettico) meno i rendimenti a 10 anni: il «modello Fed»."""
    if not pe_fwd:
        return None
    ry = 100 / pe_fwd
    return {"rendimento": ry, "nominale": None if tassi.get("nominale") is None else ry - tassi["nominale"],
            "reale": None if tassi.get("reale") is None else ry - tassi["reale"]}


# ══════════════════════════════════════ RESA ═══════════════════════════════════════════════════════════════════
def _x(v, d=1):
    return "n.d." if v is None else f"{_it(v, d)}×"


def _verso(a, b):
    return "sopra" if a > b else ("sotto" if a < b else "alla pari con")


def righe_valutazione(fs, mp, wsj, mem, tassi, errori):
    L = ["VALUTAZIONE — ogni multiplo con la storia DELLA SUA fonte, mai con quella di un'altra: fonti diverse usano "
         "utili diversi (riportati, operativi, stimati), quindi i valori di due fonti non si confrontano fra loro · le "
         "storie di multpl sono MEDIANE (il 50° percentile): la media aritmetica la gonfiano i mesi in cui gli utili "
         "crollano, come il 2009"]
    r0 = (fs or {}).get("rapporti") or []
    ultimo = r0[0] if r0 else None
    if ultimo and ultimo.get("pe"):
        p = ultimo["pe"]
        g = f", prezzo di chiusura di {ultimo['giorno_prezzo']}" if ultimo.get("giorno_prezzo") else ""
        L.append(f"  S&P 500 · prospettico, utili attesi a 12 mesi (FactSet, Earnings Insight del {_gma(ultimo['data'])}{g}): "
                 f"{_x(p['valore'])} · media 5 anni {_x(p['media5'])} · media 10 anni {_x(p['media10'])} — medie della "
                 f"stessa FactSet · {_verso(p['valore'], p['media5'])} la media a 5 anni, {_verso(p['valore'], p['media10'])} "
                 "quella a 10")
    elif ultimo:
        L.append(f"  S&P 500 · prospettico: la frase del P/E NON trovata nel rapporto FactSet del {_gma(ultimo['data'])} — "
                 "non vuol dire 'nessun valore', vuol dire che il rapporto ha cambiato forma")
    else:
        L.append("  S&P 500 · prospettico: rapporto FactSet NON letto nelle ultime tre settimane ("
                 + ("; ".join((fs or {}).get("errori") or []) or "nessun rapporto trovato") + ")")
    for chiave, nome, cosa in (("pe", "ultimi 12 mesi", "P/E sugli utili «as reported» degli ultimi 12 mesi, serie di Shiller"),
                               ("cape", "CAPE di Shiller", "prezzo su utili REALI medi di 10 anni")):
        s = (mp or {}).get(chiave)
        if not s:
            L.append(f"  S&P 500 · {nome}: multpl NON letto ({(errori or {}).get('multpl_' + chiave) or 'tabella vuota'})")
            continue
        med = " · ".join(f"{a} anni {_x(x['valore'])}" if x else f"{a} anni n.d." for a, x in s["medie"].items())
        stime = max((x["stime"] for x in s["medie"].values() if x), default=0)
        # ⚠ una cifra decimale, come la pipeline: le schede stampano lo stesso valore di multpl come riferimento
        #   accanto ai multipli dei titoli, e due rese dello stesso numero dalla stessa fonte sono la classe v415
        L.append(f"  S&P 500 · {nome} ({cosa}; multpl, valore del {_gma(s['data'])}"
                 + (", stimato dalla fonte sull'ultimo utile riportato" if s["stima"] else "") + f"): {_x(s['valore'])} · "
                 f"mediane della stessa serie mensile: {med}"
                 + (f" (gli ultimi {stime} mesi sono stime della fonte, †)" if stime else "")
                 + f" · percentile {s['rango20']}° sugli ultimi 20 anni, {s['rango_tutto']}° dal {s['dal'][:4]}"
                 + (f" · massimo della serie {_x(s['massimo']['valore'])} ({_mese(s['massimo']['data'])})"
                    if chiave == "cape" else ""))
    if wsj and wsj.get("fwd") is not None:
        st = storia_raccolta(mem or {})
        sto = (f"storia raccolta: {NL._conta(st['n'], 'seduta', 'sedute')} dal {_gma(st['dal'])}"
               + (f", percentile {st['rango']}° dell'ultimo anno" if st.get("rango") is not None else
                  f" (il percentile si pubblica da {MIN_STORIA} sedute)")
               + (f", seduta precedente {_gma(st['prec'][0])} {_x(st['prec'][1], 2)}" if st.get("prec") else "")
               if st["n"] else "storia raccolta: nessuna seduta")
        L.append(f"  Nasdaq-100 (WSJ, seduta del {_gma(wsj.get('data'))}): ultimi 12 mesi {_x(wsj.get('pe'), 2)} "
                 f"(52 settimane prima {_x(wsj.get('pe_52s'), 2)}) · prospettico {_x(wsj['fwd'], 2)} — nessuna delle fonti "
                 f"misurate il 17/10/2026 pubblica la storia del prospettico: si raccoglie (memoria/indici.jsonl), {sto}")
    else:
        L.append(f"  Nasdaq-100: WSJ NON letto ({(errori or {}).get('wsj') or 'record dell indice non trovato'}) — non vuol "
                 "dire 'nessun valore'")
    pr = premio((ultimo or {}).get("pe", {}).get("valore") if ultimo else None, tassi or {})
    if pr:
        L.append(f"  premio sul Tesoro (CONVENZIONE, il «modello Fed»): rendimento degli utili attesi {_it(pr['rendimento'])}% "
                 f"(100 / P/E prospettico FactSet) − Treasury 10 anni "
                 + (f"{_it(tassi['nominale'])}% ({_gma(tassi['data_nominale'])}) = {_sg(pr['nominale'], 2)} punti"
                    if pr["nominale"] is not None else "n.d.")
                 + " · sul tasso reale, TIPS 10 anni "
                 + (f"{_it(tassi['reale'])}% ({_gma(tassi['data_reale'])}) = {_sg(pr['reale'], 2)} punti"
                    if pr["reale"] is not None else "n.d.")
                 + " — un rendimento atteso contro uno certo: il nominale mescola inflazione e tasso reale, e nessuna delle "
                   "due differenze e' il premio per il rischio della teoria · sotto zero le azioni rendono meno dei titoli di "
                   "Stato (lettura convenzionale)")
    else:
        L.append("  premio sul Tesoro: n.d. — serve il P/E prospettico di FactSet")
    return L


def righe_stagione(fs):
    r0 = (fs or {}).get("rapporti") or []
    if not r0:
        return ["STAGIONE DELLE TRIMESTRALI — S&P 500: rapporto FactSet NON letto (vedi sopra)"]
    u = r0[0]
    pg, cr, bt, so = u.get("pagella"), u.get("crescita"), u.get("battono"), u.get("sorpresa")
    trim = (pg or cr or {}).get("trimestre") or "trimestre n.d."
    L = [f"STAGIONE DELLE TRIMESTRALI — S&P 500, {trim} (FactSet, Earnings Insight del {_gma(u['data'])})"]
    if pg:
        if pg["in_percentuale"]:
            riga = (f"  hanno riportato il {pg['riportato']}% delle societa' · utile sopra le attese: {pg['utile_sopra']}%"
                    + (f" (media 5 anni {bt['media5']}%, 10 anni {bt['media10']}%)" if bt else "")
                    + f" · ricavi sopra le attese: {pg['ricavi_sopra']}%")
        else:
            riga = (f"  hanno riportato {pg['riportato']} societa' (FactSet a inizio stagione scrive i conteggi): utile sopra "
                    f"le attese {pg['utile_sopra']} su {pg['riportato']} · ricavi sopra le attese {pg['ricavi_sopra']} su "
                    f"{pg['riportato']}")
        if so:
            riga += (f" · sorpresa aggregata sugli utili {_sg(so['valore'])}% (media 5 anni {_sg(so['media5'])}%, 10 anni "
                     f"{_sg(so['media10'])}%)")
        L.append(riga)
    else:
        L.append("  pagella della stagione: frase NON trovata nel rapporto")
    if cr:
        tipo = ("«blended»: effettivi di chi ha riportato + stime di chi non l'ha ancora fatto" if cr["tipo"] == "blended"
                else "«estimated»: solo stime, la stagione non e' cominciata")
        riga = f"  crescita degli utili sull'anno: {_sg(cr['valore'])}% ({tipo})"
        prima = r0[1] if len(r0) > 1 else None
        if prima and prima.get("crescita"):
            pc = prima["crescita"]
            riga += (f" · nel rapporto del {_gma(prima['data'])}: {_sg(pc['valore'])}% («{pc['tipo']}»"
                     + ("" if pc["trimestre"] == cr["trimestre"] else f", {pc['trimestre']}") + ")")
            if prima.get("pe") and u.get("pe"):
                riga += f", P/E prospettico {_x(prima['pe']['valore'])}"
        L.append(riga)
    else:
        L.append("  crescita degli utili: frase NON trovata nel rapporto")
    if u.get("mancano"):
        L.append("  ⚠ frasi non trovate nel rapporto: " + ", ".join(u["mancano"]) + " — il rapporto ha cambiato forma o non "
                 "le contiene: una lettura in meno dichiarata, mai un numero indovinato")
    return L


def righe_volatilita(vol, ts, errori):
    L = ["VOLATILITA' IMPLICITA DEGLI INDICI (CBOE, valori di chiusura) — quanto costa assicurarsi: sale nelle discese"]
    for s, cosa in VOLATILITA:
        v = (vol or {}).get(s)
        if not v:
            L.append(f"  {s}: NON letto ({(errori or {}).get('vol_' + s) or 'storico vuoto'})")
            continue
        L.append(f"  {s} ({cosa}): {_it(v['valore'])} il {_gma(v['data'])}"
                 + (f" ({_sg(v['var'])}% sulla seduta prima)" if v.get("var") is not None else "")
                 + f" · {v['rango']}° percentile dell'anno ({v['n']} sedute)")
    if ts:
        L.append(f"  struttura a termine VIX / VIX3M: {_it(ts['rapporto'])} il {_gma(ts['data'])} ({_it(ts['breve'])} / "
                 f"{_it(ts['lunga'])}) · {ts['rango']}° percentile dell'anno — sotto 1 la protezione a 30 giorni costa meno "
                 "di quella a 3 mesi, la forma normale; sopra 1 la curva e' INVERTITA, la forma che prende lo stress "
                 "(lettura convenzionale)")
    return L


def righe_concentrazione(comp, libro, errori):
    L = ["CONCENTRAZIONE — quanto pesano i primi dieci titoli dell'indice (stockanalysis, dati dell'emittente dell'ETF; "
         "le due classi di Alphabet sono due righe e la fonte le conta entrambe)"]
    for tk, nome in TENDENZA:
        c = (comp or {}).get(tk)
        if not c:
            L.append(f"  {nome} ({tk}): composizione NON letta ({(errori or {}).get('comp_' + tk) or 'pagina senza dati'})")
            continue
        nel = [p for p in c["primi"] if p["tk"] in (libro or ())]
        L.append(f"  {nome} ({tk}, dati al {_gma(c['data'])}): i primi 10 pesano il "
                 + (f"{_it(c['top10'])}%" if c.get("top10") is not None else "n.d.")
                 + (" — " + " · ".join(f"{p['tk']} {_it(p['peso'])}%" for p in c["primi"]) if c["primi"] else "")
                 + (" · nel libro: " + ", ".join(p["tk"] for p in nel) if nel else " · nessuno di questi e' nel libro"))
    return L


def righe_ampiezza(barre):
    L = ["AMPIEZZA — l'indice a pesi UGUALI contro quello pesato per capitalizzazione, sulle stesse sedute (prezzi di oggi): "
         "positivo = la media dei titoli fa meglio dei piu' grandi (partecipazione larga), negativo = il movimento lo portano "
         "i giganti (lettura convenzionale)"]
    for uguale, cap, nome in AMPIEZZA:
        pezzi = []
        for s in SEDUTE_AMPIEZZA:
            v = variazione_comune((barre or {}).get(uguale), (barre or {}).get(cap), s)
            if v is None:
                pezzi.append(f"{s} sedute n.d. (storia comune piu' corta)")
                continue
            # due decimali anche sulle due variazioni: con una sola cifra «+0,4 contro +0,1» e la differenza +0,28
            #   non tornerebbero a chi li sottrae
            pezzi.append(f"{s} sedute: {uguale} {_sg(v['uguale'], 2)}% contro {cap} {_sg(v['cap'], 2)}% → "
                         f"{_sg(v['uguale'] - v['cap'], 2)} punti")
        L.append(f"  {nome}: " + " · ".join(pezzi) + (f" (al {_gma(v['a'])})" if v else ""))
    return L


def righe_tendenza(schede):
    L = ["TENDENZA — gli ETF SPY e QQQ (prezzi di oggi, stockanalysis), con le regole dei titoli: medie in ATR, struttura "
         "delle oscillazioni e lettura a 5 anni come nella watchlist"]
    for tk, nome in TENDENZA:
        s = (schede or {}).get(tk)
        if not s or s.get("errore"):
            L.append(f"  {nome} ({tk}): prezzi NON letti ({(s or {}).get('errore') or 'nessuna barra'})")
            continue

        def media(k):
            m, a = s.get(f"sma{k}"), s.get(f"d{k}_atr")
            if m is None:
                return f"media {k} n.d."
            return f"media {k} {_sg((s['px'] / m - 1) * 100)}% ({_sg(a)} ATR)"
        L.append(f"  {nome} ({tk}) {_it(s['px'])} · seduta del {_gma(s['seduta'])} {_sg(s.get('oggi'))}% · "
                 f"5 sedute {_sg(s['s5'])}% · 21 sedute {_sg(s['s21'])}% · 63 sedute {_sg(s['s63'])}% · da inizio anno "
                 f"{_sg(s['anno'])}% · " + " · ".join(media(k) for k in (20, 50, 200))
                 + f" · RSI {_it(s.get('rsi'), 0)} · dal massimo a 52 settimane {_sg(s.get('dmax52'))}%")
        L.append("     " + rotazione.riga_volumi(s))
        for r in rotazione.righe_5anni(s.get("cinque_anni")):
            L.append("     " + r.strip())
        for r in rotazione.righe_struttura(s.get("struttura")):
            L.append("     " + r.strip())
    return L


def sintesi(o):
    L = ["INDICI — S&P 500 e Nasdaq-100 (decisione del CEO del 17/10/2026) · INFORMAZIONE: nessuna di queste misure e' una "
         "prova della tenuta, un colore del semaforo o una vendita"]
    L += righe_valutazione(o.get("factset"), o.get("multpl"), o.get("wsj"), o.get("memoria"), o.get("tassi"), o.get("errori"))
    L += righe_stagione(o.get("factset"))
    L += righe_volatilita(o.get("vol"), o.get("termine"), o.get("errori"))
    L += righe_concentrazione(o.get("composizione"), o.get("libro"), o.get("errori"))
    L += righe_ampiezza(o.get("barre"))
    L += righe_tendenza(o.get("schede"))
    return L


# ══════════════════════════════════════ ESECUZIONE ══════════════════════════════════════
def _testo(url):
    return POS.scarica(url).decode("utf-8", "replace")


def calcola(adesso=None, memoria=None):
    adesso = adesso or datetime.now(NEW_YORK)
    oggi = adesso.astimezone(NEW_YORK).date()
    errori = {}

    def prova(chiave, fn, *a):
        try:
            return fn(*a)
        except Exception as e:  # noqa: BLE001
            errori[chiave] = (f"HTTP {e.code}" if isinstance(e, urllib.error.HTTPError) else type(e).__name__)
            return None
    etf = sorted({t for t, _ in TENDENZA} | {u for u, _, _ in AMPIEZZA} | {c for _, c, _ in AMPIEZZA})
    with ThreadPoolExecutor(POS.PARALLELI) as ex:
        f_fs = ex.submit(prova, "factset", stato_factset, oggi)
        f_mp = {k: ex.submit(prova, "multpl_" + k, _testo, u) for k, u in URL_MULTPL.items()}
        f_wsj = ex.submit(prova, "wsj", _testo, URL_WSJ)
        f_vol = {s: ex.submit(prova, "vol_" + s, _testo, URL_VOL.format(s=s)) for s, _ in VOLATILITA}
        f_comp = {tk: ex.submit(prova, "comp_" + tk, _testo, URL_COMPOSIZIONE.format(tk=tk.lower())) for tk, _ in TENDENZA}
        f_b = {tk: ex.submit(prova, "barre_" + tk, brief.barre, tk) for tk in etf}
        f_l = {tk: ex.submit(prova, "lunghe_" + tk, rotazione.barre_lunghe, tk) for tk, _ in TENDENZA}
        mp = {k: (stato_mensile(leggi_multpl(f.result())) if f.result() else None) for k, f in f_mp.items()}
        wsj = leggi_wsj(f_wsj.result()) if f_wsj.result() else None
        vol_serie = {s: (leggi_vol(f.result()) if f.result() else None) for s, f in f_vol.items()}
        comp = {tk: (leggi_composizione(f.result()) if f.result() else None) for tk, f in f_comp.items()}
        barre = {tk: f.result() for tk, f in f_b.items()}
        lunghe = {tk: f.result() for tk, f in f_l.items()}
        fs = f_fs.result()
    try:
        d = json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    except (OSError, ValueError):
        d = {}
    pos, _cassa, _sorv = brief.leggi_libro()
    mem = memoria if memoria is not None else {}
    cambiata = aggiungi_memoria(mem, wsj)
    return {"factset": fs, "multpl": mp, "wsj": wsj, "memoria": mem, "memoria_cambiata": cambiata,
            "tassi": tassi_pipeline(d), "vol": {s: stato_vol(v) for s, v in vol_serie.items()},
            "termine": struttura_termine(vol_serie.get("VIX"), vol_serie.get("VIX3M")), "composizione": comp,
            "libro": sorted(p["tk"] for p in pos), "barre": barre,
            "schede": {tk: scheda_indice(tk, barre.get(tk), lunghe.get(tk), adesso) for tk, _ in TENDENZA},
            "errori": errori}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-memoria", action="store_true", help="non scrive memoria/indici.jsonl")
    a = ap.parse_args()
    mem = leggi_memoria()
    o = calcola(memoria=mem)
    print("\n".join(sintesi(o)))
    if not a.no_memoria and o["memoria_cambiata"]:
        scrivi_memoria(mem)
    st = storia_raccolta(mem)
    print(f"\nmemoria degli indici (memoria/indici.jsonl): {NL._conta(st['n'], 'seduta', 'sedute')} del WSJ"
          + (", una aggiunta ora" if o["memoria_cambiata"] and not a.no_memoria else ""))


if __name__ == "__main__":
    main()
