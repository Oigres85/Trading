#!/usr/bin/env python3
"""v535 — I MERCATI DI PREVISIONE: quanto PAGANO Polymarket, Kalshi e i future Fed Funds, e quanto si sono rivelati
affidabili.

Uso:  python3 scripts/mercati_previsione.py            le verifiche (senza rete)
      python3 scripts/mercati_previsione.py oggi       le verifiche e i mercati di oggi
      python3 scripts/mercati_previsione.py calibra    la calibrazione storica di Polymarket (rete, qualche minuto)

Decisione del CEO del 03/11/2026: il sistema previsionale «stile Polymarket», con l'ECCEZIONE MISURATA alla regola n.1.
Questo modulo porta le probabilita' che pagano i mercati di previsione come record di affidabilita.previsione, accanto
agli altri metodi e MAI mediati con loro (v200). Sono prezzi, non fatti: chi li legge li trova separati dai fatti, con
la fonte, la liquidita', la scadenza e l'affidabilita' MISURATA sul passato.

Le fonti (gratuite, senza chiave, lette con pause e una cache: non si martellano):
  · POLYMARKET (gamma-api.polymarket.com, lo stesso endpoint della pipeline, update_data.fetch_predictions): gli eventi
    APERTI delle etichette di TAG_OGGI, poi un filtro per PAROLE dichiarato (TEMI, ESCLUSI). La probabilita' e' il
    prezzo dell'ESITO cercato, preso per NOME dell'esito e mai per posizione (v207). Sotto SOGLIA_SOTTILE di liquidita'
    il mercato si dice «sottile».
  · KALSHI (api.elections.kalshi.com, API pubblica di sola lettura): le serie di SERIE_KALSHI, l'evento piu' vicino di
    ciascuna; la probabilita' e' il punto medio fra denaro e lettera del SI', solo se lo scarto non supera SPREAD_MAX.
  · FEDWATCH: NON si ricalcola. Si prende l'esito di update_data.fedwatch_da, nell'ordine: la lettura del giro
    (fonti_titoli, valida 30 minuti) · con la rete, la stessa funzione chiamata adesso · la pipeline (data.json), con
    l'ora del run. Diventa rialzo / invariato / taglio alla prossima riunione.
  · CALIBRAZIONE STORICA di Polymarket: un campione dichiarato di mercati CHIUSI di economia, finanza e crypto
    (TAG_CAMPIONE, i piu' scambiati), lo storico dei prezzi del CLOB (clob.polymarket.com/prices-history, in finestre
    che finiscono all'istante misurato) e l'esito
    dichiarato: il prezzo a 1, 7 e 30 giorni dalla SCADENZA dichiarata, e affidabilita.valuta per ciascun anticipo.
    Cache in memoria/dati/calibrazione_mercati.json (fuori da git), riusata per 7 giorni.

⚠ L'ANCORA E' LA SCADENZA DICHIARATA (endDate), NON L'ORA DI CHIUSURA. Un mercato «X entro la data» che si avvera prima
  chiude in anticipo: misurare «un giorno prima della chiusura» vorrebbe dire scegliere l'istante sapendo quando
  l'evento e' successo (il futuro). Si misura invece a scadenza − k giorni, solo se a quell'istante il mercato era
  ancora aperto: un mercato gia' risolto non e' una previsione, e chi guarda in quel momento lo sa.
⚠ LE FASCE ESTREME (0-10%, 90-100%) contengono anche mercati gia' decisi e non ancora chiusi: le fasce che dicono
  qualcosa sono quelle di mezzo.
⚠ I MERCATI DI UNO STESSO EVENTO sono legati fra loro (le soglie di un indice, gli esiti di una riunione): se ne prendono
  al piu' MAX_PER_EVENTO per evento, e gli intervalli di Wilson, che li suppongono indipendenti, sono troppo stretti.
⚠ IL PREZZO NON E' UNA PROBABILITA' PURA: porta lo scarto fra denaro e lettera e il premio per il rischio; negli eventi a
  piu' esiti la somma dei prezzi puo' non fare 100 (si registra in extra['somma_evento']).
⚠ SU ANTHROPIC nessun mercato (istruzione permanente n.6: solo i fatti del prospetto).
Le soglie sono convenzioni dichiarate (v240).
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import affidabilita as af  # noqa: E402

RADICE = Path(__file__).resolve().parent.parent
CACHE_CAL = RADICE / "memoria" / "dati" / "calibrazione_mercati.json"
CACHE_OGGI = RADICE / "memoria" / "dati" / "mercati_previsione_oggi.json"
GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
KALSHI = "https://api.elections.kalshi.com/trade-api/v2"
NYFED_RICERCA = "https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json"
INTESTAZIONI = {"User-Agent": "Trading-dashboard/1.0 (+https://github.com/Oigres85/Trading)", "Accept": "application/json"}
NEW_YORK = ZoneInfo("America/New_York")
ROMA = ZoneInfo("Europe/Rome")

# ── le convenzioni dichiarate (v240) ──
PAUSA = 0.4                  # secondi fra due richieste alla stessa fonte
VALIDITA_OGGI_MINUTI = 30    # la lettura dei mercati di oggi si riusa per 30 minuti, come la lettura del giro
VALIDITA_CAL_GIORNI = 7      # la calibrazione storica si rifa' una volta a settimana
SOGLIA_SOTTILE = 25_000      # $ di liquidita' (Polymarket) o di interesse aperto (Kalshi): sotto, il mercato e' «sottile»
SPREAD_MAX = 0.10            # Kalshi: oltre 10 centesimi fra denaro e lettera il punto medio non e' un prezzo
ORE_MIN_SCADENZA = 24        # bitcoin e indici: le scommesse che scadono entro un giorno (le scale giornaliere) no
PREZZO_MIN_OGGI, PREZZO_MAX_OGGI = 0.03, 0.97   # fuori, il mercato ha gia' deciso: non e' una previsione che informi
MAX_PER_EVENTO_OGGI = 6      # le scale di soglie di un evento: al piu' 6 mercati, i piu' liquidi
ANTICIPI = (1, 7, 30)        # giorni prima della scadenza dichiarata
MAX_CAMPIONE = 400           # mercati chiusi del campione di calibrazione
MAX_PER_EVENTO = 4           # al piu' 4 mercati per evento (i piu' scambiati): sono legati fra loro
PAGINE_CAMPIONE = 3          # pagine da 100 eventi chiusi per etichetta, i piu' scambiati per primi
VOLUME_MIN_CAMPIONE = 10_000  # $: sotto, il prezzo storico non e' un mercato
FIDELITY_MINUTI = 60         # lo storico dei prezzi a passo di un'ora, in una finestra che FINISCE all'istante
TOLLERANZA_ORE = 48          # il prezzo di un anticipo e' l'ultimo punto non successivo, al piu' 48 ore prima
MARGINE_CHIUSURA_ORE = 1     # un anticipo vale solo se il mercato era aperto almeno un'ora dopo

TAG_OGGI = ("fed-rates", "economy", "inflation", "recession", "stocks", "indices", "big-tech", "nvidia", "tariffs",
            "bitcoin", "midterms")
TAG_CAMPIONE = ("fed-rates", "economy", "inflation", "finance", "stocks", "big-tech", "tariffs", "bitcoin", "crypto")
TAG_ESCLUSI = {"parlays"}    # le combinazioni di piu' esiti non sono un evento

# il filtro per parole, sulla domanda e sul titolo dell'evento: un tema, la sua famiglia, cosa lo prende, cosa no
TEMI = (
    ("fed_tassi", "Fed e tassi", "macro",
     r"\bfed\b|\bfomc\b|federal reserve|fed funds|federal funds|\bpowell\b|\bwarsh\b|\brate (cut|hike)s?\b|"
     r"\binterest rates?\b|treasury yields?|\d+-year treasury|treasury (bills?|notes?|bonds?)", None),
    ("inflazione_lavoro", "Inflazione e lavoro USA", "macro",
     r"\binflation\b|\bcpi\b|\bpce\b|unemployment|jobless|jobs report|non-?farm|\bpayrolls?\b|\bnfp\b", None),
    ("recessione", "Recessione e crescita USA", "macro", r"recession|\bgdp\b|economic state|stagflation", None),
    ("fisco", "Politica fiscale USA", "macro",
     r"shutdown|debt ceiling|debt limit|government funding|\btax (bill|cuts?)\b|reconciliation bill", None),
    ("midterm", "Midterm USA (controllo del Congresso)", "macro",
     r"balance of power|\b(control|win|majority)\b.*\b(house|senate|congress)\b|"
     r"\b(house|senate|congress)\b.*\b(control|majority)\b", r"\brace\b|\bseats?\b|district|governor|mayor|\bstate\b"),
    ("indici", "S&P 500 e Nasdaq", "mercato",
     r"s&p ?500|\bs&p\b|\bspx\b|nasdaq|dow jones|\bqqq\b|\bndx\b|russell 2000|\bvix\b|stock market|"
     r"circuit breaker", None),
    ("grandi_tech", "NVIDIA e grandi tecnologiche", "mercato",
     r"nvidia|\bnvda\b|largest company|\bgpu\b|\bamd\b|micron|broadcom|marvell|alphabet|google|oracle|palantir|"
     r"coreweave|western digital|hynix|rigetti|bloom energy|microsoft|apple|amazon|\bmeta\b|tesla",
     r"\bai model|best ai|top ai|\barena\b|\bsearch|gemini|chatbot|app store|robotaxi|iphone|optimus|cybertruck|product line|\brelease\b"),
    ("chip_cina", "Chip ed export verso la Cina", "macro",
     r"semiconductor|\bchips?\b|export control|\btsmc\b|taiwan|tariffs?\b.*\bchina\b|"
     r"\bchina\b.*\btariffs?\b|\bchina\b.*\bexport|\bexport.*\bchina\b|trade deal.*\bchina\b|\bchina\b.*trade deal", None),
    ("bitcoin", "Bitcoin", "mercato", r"\bbitcoin\b|\bbtc\b|microstrategy|\bmstr\b|saylor",
     r"halving|quantum|satoshi|knots|\bbip|sha-256|kimchi|dominance|best month|volatility index|implied volatility"),
)
ESCLUSI = re.compile(
    # altre banche centrali e altri paesi: il libro e' esposto agli USA
    r"bank of (england|canada|japan|mexico|brazil|korea)|\bboe\b|\becb\b|\bboj\b|banxico|\brbi\b|\brba\b|\bsnb\b|"
    r"riksbank|norges|brazil|\buk\b|u\.k\.|united kingdom|england|eurozone|euro area|europe|germany|france|japan|"
    r"\bindia\b|mexico|argentina|south africa|canada|turkey|australia|korea|russia|\biran(ian)?\b|venezuela|cuba|"
    r"israel|ukraine|china (annual|gdp|inflation|cpi)|chinese (gdp|inflation)|inflation china|gdp china|world gdp|"
    r"global gdp|"
    # le vicende giudiziarie delle persone non sono eventi economici
    r"\bjail\b|charged|indicted|prison|arrest|"
    # le parole dette, i messaggi, le monete lanciate a breve: non sono eventi economici
    r"\bsay\b|\bsays\b|\bsaid\b|mention|tweet|\bposts?\b|\bwords?\b|up or down|"
    # sport e spettacolo (lo stesso elenco della pipeline)
    r"world cup|fifa|super bowl|oscar|grammy|\bnba\b|\bnfl\b|soccer|champions league|\bufc\b|tennis|olympic|nobel|"
    r"esports|dota|movie|album|"
    # istruzione permanente n.6: su Anthropic solo i fatti del prospetto
    r"anthropic|\bclaude\b", re.I)
SERIE_KALSHI = (("KXFEDDECISION", "fed_tassi"), ("KXCPIYOY", "inflazione_lavoro"), ("KXCPI", "inflazione_lavoro"),
                ("KXPAYROLLS", "inflazione_lavoro"), ("KXU3", "inflazione_lavoro"), ("KXRECSSNBER", "recessione"),
                ("KXGDP", "recessione"))
MESI = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
        "novembre", "dicembre")
MESI_EN = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
           "november", "december")
_TEMA = {t[0]: t for t in TEMI}


# ───────────────────────── la rete, con le pause ─────────────────────────

def _lettore(pausa=PAUSA, timeout=30):
    """Una funzione url → JSON che aspetta `pausa` secondi fra una richiesta e l'altra. Un 401/403/404 non si ripete."""
    import requests
    stato = {"ultima": 0.0, "richieste": 0}

    def get(url):
        ultimo = None
        for i in range(2):
            attesa = stato["ultima"] + pausa - time.time()
            if attesa > 0:
                time.sleep(attesa)
            stato["ultima"] = time.time()
            stato["richieste"] += 1
            try:
                r = requests.get(url, headers=INTESTAZIONI, timeout=timeout)
                if r.status_code == 200:
                    return r.json()
                ultimo = RuntimeError(f"HTTP {r.status_code}")
                if r.status_code in (401, 403, 404):
                    break
            except Exception as e:  # noqa: BLE001
                ultimo = e
            time.sleep(pausa * (i + 2))
        raise ultimo
    get.stato = stato
    return get


# ───────────────────────── le letture comuni ─────────────────────────

def _lista(x):
    """Polymarket scrive gli elenchi come testo JSON ('["Yes", "No"]')."""
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except ValueError:
            return []
    return list(x) if isinstance(x, (list, tuple)) else []


def _num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _istante(s):
    """Un istante della fonte in secondi UTC; None se manca. Senza fuso si legge in UTC (come v534)."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$",
                 str(s or "").strip())
    if not m:
        return None
    a, me, g, hh, mm, ss, fuso = m.groups()
    dt = datetime(int(a), int(me), int(g), int(hh or 0), int(mm or 0), int(ss or 0), tzinfo=timezone.utc)
    if fuso and fuso != "Z":
        segno = -1 if fuso[0] == "-" else 1
        cifre = fuso[1:].replace(":", "")
        dt -= segno * timedelta(hours=int(cifre[:2]), minutes=int(cifre[2:4] or 0))
    return dt.timestamp()


def _giorno_ny(ts):
    """Il giorno di New York della scadenza; una scadenza alla mezzanotte esatta chiude il giorno PRIMA («by December
    31» scade il 01/01 alle 00:00 di New York)."""
    return None if ts is None else datetime.fromtimestamp(ts - 1, NEW_YORK).date().isoformat()


def esito_principale(m):
    """L'esito di cui si legge la probabilita': «Yes» se c'e', altrimenti il primo dichiarato (detto nell'evento)."""
    esiti = _lista(m.get("outcomes"))
    return "Yes" if "Yes" in esiti else (esiti[0] if esiti else None)


def prezzo_esito(m, esito):
    """Il prezzo dell'esito `esito`, preso per NOME nell'elenco degli esiti (mai per posizione, v207); None se l'esito
    non c'e' o gli elenchi non si corrispondono."""
    esiti, prezzi = _lista(m.get("outcomes")), _lista(m.get("outcomePrices"))
    if esito not in esiti or len(esiti) != len(prezzi):
        return None
    v = _num(prezzi[esiti.index(esito)])
    return v if v is not None and 0.0 <= v <= 1.0 else None


def token_esito(m, esito):
    esiti, token = _lista(m.get("outcomes")), _lista(m.get("clobTokenIds"))
    if esito not in esiti or len(esiti) != len(token):
        return None
    return str(token[esiti.index(esito)])


def _intervallo_pm(m, esito, p):
    """(denaro, lettera) dell'esito: Polymarket li pubblica per il PRIMO esito; per il secondo sono i complementi."""
    esiti = _lista(m.get("outcomes"))
    bb, ba = _num(m.get("bestBid")), _num(m.get("bestAsk"))
    if bb is None or ba is None or esito not in esiti or len(esiti) != 2:
        return None
    lo, hi = (bb, ba) if esiti.index(esito) == 0 else (1 - ba, 1 - bb)
    lo, hi = round(lo, 4), round(hi, 4)
    if not (0 <= lo <= hi <= 1) or p < lo - 0.011 or p > hi + 0.011:
        return None
    return lo, hi


def tema_di(*testi):
    """Il tema di un mercato dalle sue parole (domanda e titolo dell'evento), o None se non e' pertinente al libro."""
    testo = " ".join(t for t in testi if t)
    if not testo or ESCLUSI.search(testo):
        return None
    for chiave, _nome, _fam, includi, escludi in TEMI:
        if re.search(includi, testo, re.I) and not (escludi and re.search(escludi, testo, re.I)):
            return chiave
    return None


# ── la Fed con un nome solo per tutti i metodi: la chiave e' la stessa e i metodi si affiancano ──

def _soggetto_fed(anno, mese):
    return f"Fed — riunione di {MESI[mese - 1]} {anno}"


def _evento_fed(verso, pb=None, o_piu=False):
    if verso == "invariato":
        return "tassi invariati"
    return f"{'rialzo' if verso == 'rialzo' else 'taglio'} dei tassi di {pb} pb" + (" o più" if o_piu else "")


def fed_polymarket(domanda):
    """(soggetto, evento) comuni per una domanda di Polymarket su una riunione («... after the December 2026 meeting»)."""
    t = (domanda or "").lower()
    mm = re.search(r"\b(" + "|".join(MESI_EN) + r")\s+(\d{4})\s+meeting\b", t)
    if not mm:
        return None
    sogg = _soggetto_fed(int(mm.group(2)), MESI_EN.index(mm.group(1)) + 1)
    if re.search(r"no change|unchanged|maintain|\bhold\b|\bpause\b", t):
        return sogg, _evento_fed("invariato")
    for verso, parole in (("rialzo", r"increase|raise|hike"), ("taglio", r"decrease|lower|cut")):
        x = re.search(r"\b(" + parole + r")s?\b[^?]*?\b(\d+)\s*(\+)?\s*bps?\b", t)
        if x:
            return sogg, _evento_fed(verso, int(x.group(2)), bool(x.group(3)))
    return None


def fed_kalshi(evento_ticker, sottotitolo):
    """(soggetto, evento) comuni per KXFEDDECISION-26DEC: «Hike 25bps», «Hike >25bps», «Fed maintains rate»…"""
    mm = re.search(r"-(\d{2})([A-Z]{3})$", evento_ticker or "")
    sigle = [m[:3].upper() for m in MESI_EN]
    if not mm or mm.group(2) not in sigle:
        return None
    sogg = _soggetto_fed(2000 + int(mm.group(1)), sigle.index(mm.group(2)) + 1)
    t = (sottotitolo or "").lower()
    if re.search(r"maintain|no change|hold", t):
        return sogg, _evento_fed("invariato")
    x = re.search(r"\b(hike|cut)\s*(>)?\s*(\d+)\s*bps?\b", t)
    if not x:
        return None
    pb = int(x.group(3)) + (25 if x.group(2) else 0)          # «>25» con passi da 25 vuol dire 50 o piu'
    return sogg, _evento_fed("rialzo" if x.group(1) == "hike" else "taglio", pb, bool(x.group(2)))


# ───────────────────────── Polymarket, i mercati aperti ─────────────────────────

def leggi_polymarket(get, tag=TAG_OGGI, limite=50):
    """Gli eventi aperti delle etichette dichiarate, senza doppioni."""
    eventi = {}
    for slug in tag:
        for e in get(f"{GAMMA}/events?tag_slug={slug}&closed=false&active=true&limit={limite}"
                     f"&order=volume&ascending=false") or []:
            eventi.setdefault(str(e.get("id")), e)
    return list(eventi.values())


def record_polymarket(e, m, tema, adesso, somma=None):
    esito = esito_principale(m)
    p = prezzo_esito(m, esito)
    if p is None:
        return None
    domanda = (m.get("question") or e.get("title") or "").strip()
    fed = fed_polymarket(domanda) if tema == "fed_tassi" and esito == "Yes" else None
    soggetto, evento = fed or (_TEMA[tema][1], f"«{domanda}»" + ("" if esito == "Yes" else f" → «{esito}»"))
    liq = _num(m.get("liquidityNum") if m.get("liquidityNum") is not None else m.get("liquidity"))
    fine = _istante(m.get("endDate") or e.get("endDate"))
    slug = e.get("slug") or m.get("slug")
    url = f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com"
    scade = _giorno_ny(fine)
    return af.previsione(
        _TEMA[tema][2], soggetto, evento, p, "polymarket",
        af.evento_esterno("polymarket", m.get("id"), esito, scade, url=url), scade=scade,
        intervallo=_intervallo_pm(m, esito, p),
        extra={"fonte": "Polymarket", "tema": tema, "domanda": domanda, "esito": esito, "liquidita": liq,
               "misura_liquidita": "liquidità del libro degli ordini", "volume": _num(m.get("volumeNum")),
               "volume_24h": _num(m.get("volume24hr")), "sottile": None if liq is None else liq < SOGLIA_SOTTILE,
               "scade_utc": m.get("endDate") or e.get("endDate"), "evento_mercato": e.get("title"),
               "somma_evento": somma, "id_mercato": str(m.get("id"))},
        scritto=adesso.isoformat(timespec="minutes"))


def mercati_polymarket(eventi, adesso, scarti=None):
    """I record dei mercati APERTI e pertinenti. `scarti` (facoltativo) conta i perche' dei mercati lasciati fuori."""
    scarti = {} if scarti is None else scarti
    out = []
    for e in eventi:
        tags = {t.get("slug") for t in e.get("tags") or [] if isinstance(t, dict)}
        mercati = [m for m in e.get("markets") or [] if isinstance(m, dict)]
        if tags & TAG_ESCLUSI:
            scarti["combinazioni"] = scarti.get("combinazioni", 0) + len(mercati)
            continue
        aperti = [m for m in mercati if not m.get("closed") and m.get("active", True)]
        prezzi = [prezzo_esito(m, "Yes") for m in aperti]
        somma = round(sum(prezzi), 4) if len(aperti) > 1 and all(x is not None for x in prezzi) else None
        for m in aperti:
            tema = tema_di(m.get("question"), e.get("title"))
            if not tema:
                scarti["non pertinenti"] = scarti.get("non pertinenti", 0) + 1
                continue
            fine = _istante(m.get("endDate") or e.get("endDate"))
            if fine is not None and fine <= adesso.timestamp():
                scarti["scaduti"] = scarti.get("scaduti", 0) + 1
                continue
            if tema in ("bitcoin", "indici") and fine is not None and fine - adesso.timestamp() < ORE_MIN_SCADENZA * 3600:
                scarti["scala giornaliera"] = scarti.get("scala giornaliera", 0) + 1
                continue
            r = record_polymarket(e, m, tema, adesso, somma)
            if r is None:
                scarti["prezzo dell'esito illeggibile"] = scarti.get("prezzo dell'esito illeggibile", 0) + 1
                continue
            out.append(r)
    return seleziona(out, scarti)


def seleziona(recs, scarti=None):
    """Fuori dalla banda 3-97% il mercato ha gia' deciso; delle scale di soglie di un evento restano i 6 mercati piu'
    liquidi. Convenzioni dichiarate (v240): ogni esclusione si conta in `scarti`."""
    scarti = {} if scarti is None else scarti
    per_evento, out = {}, []
    for r in recs:
        if not (PREZZO_MIN_OGGI <= r["probabilita"] <= PREZZO_MAX_OGGI):
            scarti["prezzo fuori da 3-97% (gia' deciso)"] = scarti.get("prezzo fuori da 3-97% (gia' deciso)", 0) + 1
            continue
        per_evento.setdefault((r["metodo"], r["extra"].get("evento_mercato") or r["extra"].get("serie")), []).append(r)
    for rr in per_evento.values():
        rr.sort(key=lambda r: -(r["extra"].get("liquidita") or 0))
        out += rr[:MAX_PER_EVENTO_OGGI]
        if len(rr) > MAX_PER_EVENTO_OGGI:
            scarti["oltre 6 per evento"] = scarti.get("oltre 6 per evento", 0) + len(rr) - MAX_PER_EVENTO_OGGI
    return out


# ───────────────────────── Kalshi ─────────────────────────

def record_kalshi(m, tema, adesso, serie):
    bid, ask = _num(m.get("yes_bid_dollars")), _num(m.get("yes_ask_dollars"))
    if bid is None or ask is None or ask < bid or ask - bid > SPREAD_MAX + 1e-9:
        return None
    p = round((bid + ask) / 2, 4)
    fed = fed_kalshi(m.get("event_ticker"), m.get("yes_sub_title")) if tema == "fed_tassi" else None
    titolo = (m.get("title") or "").strip()
    soggetto, evento = fed or (_TEMA[tema][1], f"«{titolo}»")
    oi = _num(m.get("open_interest_fp"))
    nozionale = _num(m.get("notional_value_dollars")) or 1.0
    liq = None if oi is None else oi * nozionale
    scade = _giorno_ny(_istante(m.get("close_time")))
    return af.previsione(
        _TEMA[tema][2], soggetto, evento, p, "kalshi",
        af.evento_esterno("kalshi", m.get("ticker"), "yes", scade, url=f"https://kalshi.com/markets/{serie.lower()}"),
        scade=scade, intervallo=(bid, ask),
        extra={"fonte": "Kalshi", "tema": tema, "domanda": titolo, "esito": m.get("yes_sub_title"), "liquidita": liq,
               "misura_liquidita": "interesse aperto (contratti da 1 $): Kalshi non pubblica la liquidità del libro",
               "volume": _num(m.get("volume_fp")), "sottile": None if liq is None else liq < SOGLIA_SOTTILE,
               "scade_utc": m.get("close_time"), "id_mercato": m.get("ticker"), "serie": serie},
        scritto=adesso.isoformat(timespec="minutes"))


def mercati_kalshi(get, adesso, scarti=None):
    """Per ogni serie dichiarata, i mercati dell'evento APERTO piu' vicino."""
    scarti = {} if scarti is None else scarti
    out = []
    for serie, tema in SERIE_KALSHI:
        ms = (get(f"{KALSHI}/markets?series_ticker={serie}&status=open&limit=200") or {}).get("markets") or []
        ms = [m for m in ms if (_istante(m.get("close_time")) or 0) > adesso.timestamp()]
        if not ms:
            scarti[f"{serie}: nessun mercato aperto"] = 1
            continue
        primo = min(ms, key=lambda m: _istante(m.get("close_time")))["event_ticker"]
        for m in ms:
            if m.get("event_ticker") != primo:
                continue
            r = record_kalshi(m, tema, adesso, serie)
            if r is None:
                scarti["Kalshi: scarto oltre 10 centesimi"] = scarti.get("Kalshi: scarto oltre 10 centesimi", 0) + 1
            else:
                out.append(r)
    return seleziona(out, scarti)


# ───────────────────────── FedWatch (l'esito del sistema, non ricalcolato) ─────────────────────────

def fedwatch_del_sistema(adesso, rete=True):
    """(blocco fedwatch, provenienza): la lettura del giro se fresca · con la rete update_data.fedwatch_da adesso (la
    stessa funzione, v161) · la pipeline. (None, perche') se nessuno lo ha."""
    import fonti_titoli as ft
    if os.environ.get(ft.SPENTA) != "spenta":
        g = ft.dal_disco(adesso=adesso)
        fw = (g or {}).get("fedwatch") or {}
        if fw.get("esito") == "letto" and fw.get("valore"):
            ora = datetime.fromisoformat(g["letto"]).astimezone(ROMA).strftime("%H:%M")
            return fw["valore"], f"lettura del giro delle {ora} di Roma (fonti_titoli, update_data.fedwatch_da)"
    errore = ""
    if rete:
        try:
            import contextlib, io, warnings
            with warnings.catch_warnings(), contextlib.redirect_stderr(io.StringIO()):
                warnings.simplefilter("ignore")
                return ft._ud().fedwatch_da(adesso), "letto adesso alla fonte (update_data.fedwatch_da)"
        except Exception as e:  # noqa: BLE001
            errore = f"; la lettura alla fonte non e' riuscita ({type(e).__name__}: {str(e)[:80]})"
    d = ft._carica_pipeline() or {}
    fw = (d.get("macro") or {}).get("fedwatch")
    if fw:
        return fw, f"pipeline, run del {d.get('updated_at') or 'n.d.'}{errore}"
    return None, "FedWatch non disponibile: ne' giro, ne' fonte, ne' pipeline" + errore


def mercati_fedwatch(fw, provenienza, adesso, scarti=None):
    """Rialzo / invariato / taglio alla PROSSIMA riunione, dalle probabilita' che fedwatch_da gia' pubblica. Sopra il
    movimento intero non c'e' una probabilita' (v400) e il modello CME a una direzione non quota il ramo opposto."""
    scarti = {} if scarti is None else scarti
    v = next(iter((fw or {}).get("meetings") or []), None)
    if not v or not v.get("prezzata_dal_contratto"):
        scarti["FedWatch: prossima riunione non prezzata"] = 1
        return []
    d = v.get("riunione") or v.get("date")
    soggetto = _soggetto_fed(int(d[:4]), int(d[5:7]))
    rami = [("hike_prob", _evento_fed("rialzo", 25)), ("cut_prob", _evento_fed("taglio", 25)),
            ("hold_prob", _evento_fed("invariato"))]
    out = []
    for campo, evento in rami:
        if v.get(campo) is None:
            continue
        out.append(af.previsione(
            "macro", soggetto, evento, v[campo] / 100, "fedwatch",
            af.evento_esterno("fedwatch", f"{d}|{evento}", evento, d, url="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"),
            scade=d,
            extra={"fonte": "FedWatch", "tema": "fed_tassi", "provenienza": provenienza, "riunione": d,
                   "mosse_25bp": v.get("mosse_25bp"), "contratto": v.get("contratto"), "base_effr": v.get("base_effr"),
                   "nota": "modello CME a una direzione: il ramo opposto non e' quotato, non e' zero"},
            scritto=adesso.isoformat(timespec="minutes")))
    if not out:
        scarti["FedWatch: sopra il movimento intero non e' una probabilita'"] = 1
    return out


# ───────────────────────── i mercati di oggi ─────────────────────────

def _dal_disco(percorso, adesso, max_minuti):
    try:
        c = json.loads(Path(percorso).read_text(encoding="utf-8"))
        eta = adesso - datetime.fromisoformat(c["letto"])
        if eta >= timedelta(0) and (max_minuti is None or eta <= timedelta(minutes=max_minuti)):
            return c
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def _scrivi(percorso, dati):
    try:
        p = Path(percorso)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
        return None
    except OSError as e:
        return f"non salvata ({e})"


def _senza_doppioni(recs):
    """Un record per chiave e metodo: il piu' liquido (l'id del registro e' giorno|chiave|metodo)."""
    migliori = {}
    for r in recs:
        k = (r["chiave"], r["metodo"])
        if k not in migliori or ((r["extra"].get("liquidita") or 0) > (migliori[k]["extra"].get("liquidita") or 0)):
            migliori[k] = r
    return list(migliori.values())


def previsioni_oggi(adesso=None, rete=True, esiti=None, get=None, fedwatch=None, cache=CACHE_OGGI):
    """I record di oggi (affidabilita.previsione, risolutore = evento_esterno) di Polymarket, Kalshi e FedWatch.
    `esiti` (facoltativo) riceve per ogni fonte cosa e' successo: letto, non leggibile, dal disco. Le assenze si
    dichiarano (v389): una fonte che non risponde non e' una fonte senza mercati."""
    adesso = adesso or datetime.now(timezone.utc)
    esiti = {} if esiti is None else esiti
    c = _dal_disco(cache, adesso, VALIDITA_OGGI_MINUTI if rete else None) if cache else None
    if c:
        ora = datetime.fromisoformat(c["letto"]).astimezone(ROMA).strftime("%d/%m %H:%M")
        esiti.update({k: f"{v} (dal disco: lettura del {ora} di Roma)" for k, v in (c.get("esiti") or {}).items()})
        return c["previsioni"]
    recs, scarti = [], {}
    if rete:
        get = get or _lettore()
        try:
            recs += mercati_polymarket(leggi_polymarket(get), adesso, scarti)
            esiti["polymarket"] = f"letto: {sum(r['metodo'] == 'polymarket' for r in recs)} mercati pertinenti"
        except Exception as e:  # noqa: BLE001
            esiti["polymarket"] = f"non leggibile ({type(e).__name__}: {str(e)[:80]})"
        try:
            k = mercati_kalshi(get, adesso, scarti)
            recs += k
            esiti["kalshi"] = f"letto senza chiave: {len(k)} mercati"
        except Exception as e:  # noqa: BLE001
            esiti["kalshi"] = f"non leggibile ({type(e).__name__}: {str(e)[:80]})"
    else:
        esiti["polymarket"] = esiti["kalshi"] = "non letto: rete spenta e nessuna lettura sul disco"
    fw, prov = fedwatch if fedwatch is not None else fedwatch_del_sistema(adesso, rete)
    f = mercati_fedwatch(fw, prov, adesso, scarti) if fw else []
    recs += f
    esiti["fedwatch"] = (f"{len(f)} esiti alla prossima riunione — {prov}" if f else prov if not fw else
                         f"nessuna probabilita' alla prossima riunione — {prov}")
    esiti["scarti"] = scarti
    recs = _senza_doppioni(recs)
    if rete and cache and not str(esiti.get("polymarket", "")).startswith("non"):
        errore = _scrivi(cache, {"letto": adesso.isoformat(), "previsioni": recs,
                                 "esiti": {k: v for k, v in esiti.items() if k != "scarti"}})
        if errore:
            esiti["cache"] = errore
    return recs


# ───────────────────────── la calibrazione storica di Polymarket ─────────────────────────

def esito_finale(m, esito):
    """True/False se il mercato chiuso dichiara l'esito con prezzi 1/0; None se non risolto (annullato, 50-50, aperto)."""
    if not m.get("closed") or (m.get("umaResolutionStatus") not in (None, "", "resolved")):
        return None
    v = prezzo_esito(m, esito)
    if v is None:
        return None
    return True if abs(v - 1) < 1e-9 else False if abs(v) < 1e-9 else None


def idoneo(m, adesso_ts):
    """None se il mercato chiuso entra nel campione, altrimenti il perche' (contato nella cache)."""
    esito = esito_principale(m)
    if not m.get("closed"):
        return "aperto"
    if len(_lista(m.get("outcomes"))) != 2:
        return "non binario"
    if re.search(r"up or down", m.get("question") or "", re.I):
        return "moneta lanciata a breve (up or down)"
    if (_num(m.get("volumeNum")) or 0) < VOLUME_MIN_CAMPIONE:
        return "volume sotto la soglia"
    if esito_finale(m, esito) is None:
        return "non risolto con 1/0"
    if not token_esito(m, esito):
        return "senza token dell'esito"
    fine, chiuso = _istante(m.get("endDate")), _istante(m.get("closedTime"))
    if fine is None or chiuso is None:
        return "senza scadenza o senza ora di chiusura"
    if fine > adesso_ts:
        return "chiuso prima di una scadenza ancora futura"
    if chiuso - MARGINE_CHIUSURA_ORE * 3600 <= fine - max(ANTICIPI) * 86400:
        return "chiuso piu' di 30 giorni prima della scadenza"
    return None


def campione_chiusi(get, adesso, campione=MAX_CAMPIONE, scarti=None):
    """[(evento, mercato)]: per ogni etichetta di TAG_CAMPIONE gli eventi chiusi PIU' SCAMBIATI, al piu' MAX_PER_EVENTO
    mercati ciascuno (i piu' scambiati), fino a una quota uguale per etichetta. Per volume e non per data: misurato il
    06/11/2026, i piu' recenti per scadenza sono scale mensili nate meno di 30 giorni prima (10 casi a 30 giorni su 140)."""
    scarti = {} if scarti is None else scarti
    quota = math.ceil(campione / len(TAG_CAMPIONE))
    ts = adesso.timestamp()
    scelti, visti = [], set()
    for slug in TAG_CAMPIONE:
        presi = 0
        for pg in range(PAGINE_CAMPIONE):
            js = get(f"{GAMMA}/events?tag_slug={slug}&closed=true&limit=100&offset={pg * 100}"
                     f"&order=volume&ascending=false") or []
            for e in js:
                tags = {t.get("slug") for t in e.get("tags") or [] if isinstance(t, dict)}
                if tags & TAG_ESCLUSI:
                    continue
                cand = []
                for m in e.get("markets") or []:
                    if str(m.get("id")) in visti:
                        continue
                    mot = idoneo(m, ts)
                    if mot:
                        scarti[mot] = scarti.get(mot, 0) + 1
                    else:
                        cand.append(m)
                cand.sort(key=lambda m: -(_num(m.get("volumeNum")) or 0))
                for m in cand[:MAX_PER_EVENTO]:
                    visti.add(str(m.get("id")))
                    scelti.append((e, m))
                    presi += 1
                if presi >= quota:
                    break
            if presi >= quota or len(js) < 100:
                break
    return scelti[:campione]


def prezzi_agli_anticipi(storia, fine, chiuso, anticipi=ANTICIPI):
    """{k: prezzo a scadenza − k giorni}: l'ultimo punto NON successivo all'istante (nessun futuro), al piu'
    TOLLERANZA_ORE prima; None se il mercato era gia' chiuso o non ancora quotato."""
    punti = sorted((int(x["t"]), float(x["p"])) for x in storia or []
                   if isinstance(x, dict) and _num(x.get("t")) is not None and _num(x.get("p")) is not None)
    out = {}
    for k in anticipi:
        t = fine - k * 86400
        if t > chiuso - MARGINE_CHIUSURA_ORE * 3600:
            out[k] = None
            continue
        prima = [pt for pt in punti if pt[0] <= t]
        out[k] = prima[-1][1] if prima and t - prima[-1][0] <= TOLLERANZA_ORE * 3600 else None
    return out


def riga_calibrazione(e, m, storia):
    esito = esito_principale(m)
    fine, chiuso = _istante(m.get("endDate")), _istante(m.get("closedTime"))
    return {"id": str(m.get("id")), "domanda": m.get("question"), "evento": e.get("title"), "esito": esito,
            "avverato": esito_finale(m, esito), "scadenza": m.get("endDate"), "chiuso": m.get("closedTime"),
            "volume": _num(m.get("volumeNum")),
            "p": {str(k): v for k, v in prezzi_agli_anticipi(storia, fine, chiuso).items()}}


def storia_prezzi(get, token, fine, chiuso):
    """I punti dello storico del CLOB nelle finestre di TOLLERANZA_ORE che FINISCONO a ciascun istante (scadenza − k
    giorni, solo a mercato aperto): nessun punto successivo viene nemmeno chiesto. Misurato il 06/11/2026: con
    interval=max lo storico dei mercati chiusi torna vuoto per 159 mercati su 299, la finestra risponde."""
    punti = {}
    for k in ANTICIPI:
        t = int(fine - k * 86400)
        if t > chiuso - MARGINE_CHIUSURA_ORE * 3600:
            continue
        js = get(f"{CLOB}/prices-history?market={token}&startTs={t - TOLLERANZA_ORE * 3600}&endTs={t}"
                 f"&fidelity={FIDELITY_MINUTI}") or {}
        for x in js.get("history") or []:
            if isinstance(x, dict) and _num(x.get("t")) is not None:
                punti[int(x["t"])] = x
    return [punti[t] for t in sorted(punti)]


def calibra(righe):
    """Per ogni anticipo: affidabilita.valuta con la base = frequenza del SI' nello stesso campione (in campione,
    come valuta dichiara) e, accanto, l'abilita' contro chi dice sempre 50%."""
    out = {}
    for k in ANTICIPI:
        coppie = [(r["p"][str(k)], r["avverato"]) for r in righe
                  if r.get("p", {}).get(str(k)) is not None and r.get("avverato") is not None]
        ps, ys = [p for p, _ in coppie], [y for _, y in coppie]
        v = af.valuta(ps, ys)
        v50 = af.valuta(ps, ys, basi=[0.5] * len(ps)) if ps else {}
        out[str(k)] = {"anticipo_giorni": k, "valutazione": v, "abilita_contro_50": v50.get("abilita"),
                       "frequenza_si": (v["avverate"] / v["n"]) if v["n"] else None}
    return out


def calibrazione(rete=True, adesso=None, forza=False, percorso=CACHE_CAL, get=None, campione=MAX_CAMPIONE):
    """La calibrazione storica di Polymarket per anticipo (1, 7, 30 giorni dalla scadenza). Riusa la cache se ha meno di
    7 giorni; senza rete restituisce la cache anche vecchia, DICHIARANDOLO, o un esito «non disponibile»."""
    adesso = adesso or datetime.now(timezone.utc)
    c = _dal_disco(percorso, adesso, None) if percorso else None
    if c and not forza and adesso - datetime.fromisoformat(c["letto"]) <= timedelta(days=VALIDITA_CAL_GIORNI):
        return c
    if not rete:
        if c:
            c["esito"] = f"dal disco, vecchia di {(adesso - datetime.fromisoformat(c['letto'])).days} giorni"
            return c
        return {"esito": "non disponibile: rete spenta e nessuna calibrazione sul disco", "anticipi": {}}
    get = get or _lettore()
    scarti = {}
    scelti = campione_chiusi(get, adesso, campione, scarti)
    righe, senza_storia = [], 0
    for e, m in scelti:
        try:
            storia = storia_prezzi(get, token_esito(m, esito_principale(m)), _istante(m.get("endDate")),
                                   _istante(m.get("closedTime")))
        except Exception:  # noqa: BLE001 — un mercato senza storico non porta via gli altri
            storia = []
        if not storia:
            senza_storia += 1
            continue
        righe.append(riga_calibrazione(e, m, storia))
    out = {"letto": adesso.isoformat(), "esito": "letto",
           "fonte": "Polymarket: gamma-api (mercati chiusi) e clob prices-history (storico dei prezzi)",
           "campione": {"dichiarato": (
               f"mercati chiusi delle etichette {', '.join(TAG_CAMPIONE)}, i piu' scambiati, quota uguale per "
               f"etichetta (al piu' {MAX_CAMPIONE}); binari, risolti 1/0, volume di almeno {VOLUME_MIN_CAMPIONE} $, "
               f"esclusi gli «up or down» e le combinazioni; al piu' {MAX_PER_EVENTO} per evento; l'esito «Yes» (o il "
               f"primo dichiarato); prezzo a passo di {FIDELITY_MINUTI} minuti, l'ultimo non successivo all'istante "
               f"(al piu' {TOLLERANZA_ORE} ore prima), a scadenza dichiarata − 1, 7, 30 giorni, solo a mercato aperto"),
               "scelti": len(scelti), "con_storico": len(righe), "senza_storico": senza_storia, "scarti": scarti},
           "base": "frequenza del SI' nello stesso campione (in campione); accanto l'abilita' contro il 50%",
           "anticipi": calibra(righe), "righe": righe}
    if percorso:
        errore = _scrivi(percorso, out)
        if errore:
            out["cache"] = errore
    return out


# ───────────────────────── l'esito dichiarato, per il registro dal vivo ─────────────────────────

def _esito_fed(evento, delta_pb):
    """Vero/falso di un evento Fed comune dato lo spostamento del tetto della fascia in punti base."""
    if evento == "tassi invariati":
        return delta_pb == 0
    x = re.match(r"(rialzo|taglio) dei tassi di (\d+) pb( o più)?$", evento or "")
    if not x:
        return None
    mossa = delta_pb if x.group(1) == "rialzo" else -delta_pb
    return mossa >= int(x.group(2)) if x.group(3) else mossa == int(x.group(2))


def risolvi_esterno(risolutore, rete=True, get=None, adesso=None):
    """True/False con l'esito che la fonte DICHIARA a evento chiuso; None se non e' ancora chiuso, se non e' risolto o
    se la fonte non risponde (un dato mancante non e' un NO, v205)."""
    if not rete or not risolutore or risolutore.get("genere") != "esterno":
        return None
    get = get or _lettore()
    fonte, ident, atteso = risolutore.get("fonte"), str(risolutore.get("id")), risolutore.get("esito_atteso")
    try:
        if fonte == "polymarket":
            m = get(f"{GAMMA}/markets/{ident}") or {}
            return esito_finale(m, atteso)
        if fonte == "kalshi":
            m = (get(f"{KALSHI}/markets/{ident}") or {}).get("market") or {}
            if m.get("status") not in ("settled", "finalized") or m.get("result") not in ("yes", "no"):
                return None
            return m["result"] == str(atteso).lower()
        if fonte == "fedwatch":
            # la decisione della Fed: il tetto della fascia dichiarata dalla NY Fed prima e dopo il giorno della decisione
            giorno, evento = ident.split("|", 1)
            g = datetime.strptime(giorno, "%Y-%m-%d").date()
            if (adesso or datetime.now(timezone.utc)).date() <= g:
                return None
            js = get(f"{NYFED_RICERCA}?startDate={g - timedelta(days=10)}&endDate={g + timedelta(days=10)}") or {}
            righe = sorted((r.get("effectiveDate"), _num(r.get("targetRateTo"))) for r in js.get("refRates") or [])
            prima = [v for d, v in righe if d and d <= giorno and v is not None]
            dopo = [v for d, v in righe if d and d > giorno and v is not None]
            if not prima or not dopo:
                return None
            return _esito_fed(evento, round((dopo[0] - prima[-1]) * 100))
    except Exception:  # noqa: BLE001
        return None
    return None


# ───────────────────────── la resa ─────────────────────────

def _n(x, d=0):
    from statistica import _n as n
    return n(x, d)


def _soldi(x):
    if x is None:
        return "n.d."
    if x >= 1e6:
        return f"{_n(x / 1e6, 1)} mln $"
    if x >= 1e3:
        return f"{_n(x / 1e3, 0)} mila $"
    return f"{_n(x, 0)} $"


def _data_it(g):
    g = str(g or "")[:10]
    return f"{g[8:10]}/{g[5:7]}/{g[0:4]}" if len(g) == 10 else "n.d."


NOME_BREVE = {"polymarket": "Polymarket", "kalshi": "Kalshi", "fedwatch": "FedWatch"}


def _quanto_paga(r):
    x = r["extra"]
    if r["metodo"] == "fedwatch":
        return f"FedWatch {af._p(r['probabilita'])} (future Fed Funds)"
    liq = x.get("liquidita")
    nome = "liquidità" if r["metodo"] == "polymarket" else "interesse aperto"
    sott = " — SOTTILE" if x.get("sottile") else ""
    return f"{NOME_BREVE[r['metodo']]} paga {af._p(r['probabilita'])} ({nome} {_soldi(liq)}{sott})"


def anticipo_per(scade, adesso):
    """L'anticipo misurato piu' vicino ai giorni che mancano alla scadenza."""
    try:
        giorni = (datetime.strptime(scade, "%Y-%m-%d").date() - adesso.date()).days
    except (TypeError, ValueError):
        return None
    return min(ANTICIPI, key=lambda k: abs(k - max(giorni, 1)))


def riga_affidabilita_mercato(r, cal, adesso):
    if r["metodo"] != "polymarket":
        return af.riga_affidabilita(r["probabilita"], None, r["metodo"])
    k = anticipo_per(r.get("scade"), adesso)
    v = (((cal or {}).get("anticipi") or {}).get(str(k)) or {}).get("valutazione") if k else None
    return af.riga_affidabilita(r["probabilita"], v, "polymarket") + (f" [misura a {k} g dalla scadenza]" if v else "")


def riassunto_calibrazione(cal):
    """Le righe della calibrazione storica: per anticipo Brier, base, abilita', ECE e le fasce di mezzo misurabili."""
    if not cal or not cal.get("anticipi"):
        return [f"calibrazione storica di Polymarket: {(cal or {}).get('esito') or 'non disponibile'}"]
    c = cal.get("campione") or {}
    out = [f"calibrazione storica di Polymarket ({c.get('con_storico', 'n.d.')} mercati chiusi con lo storico, letta il "
           f"{_data_it(cal.get('letto'))}; {cal.get('esito')}):"]
    for k in ANTICIPI:
        a = cal["anticipi"].get(str(k)) or {}
        v = a.get("valutazione") or {}
        if not v.get("n"):
            out.append(f"  a {k} g: nessun mercato misurabile")
            continue
        fasce = [f for f in v["fasce"] if f["misurabile"] and 0.1 <= f["da"] < 0.9]
        ft = "; ".join(f"detto {af._p(f['da'])}-{af._p(f['a'])} → avverato {af._p(f['frequenza'])} su {f['n']}" for f in fasce)
        ab = a.get("abilita_contro_50")
        out.append(f"  a {k} g: n {v['n']}, Brier {_n(v['brier'], 3)} (base {_n(v['brier_base'], 3)}), abilità "
                   f"{_n(v['abilita'], 2)} (contro il 50%: {_n(ab, 2) if ab is not None else 'n.d.'}), ECE "
                   f"{_n(v['ece'], 3)}" + (f" · {ft}" if ft else " · nessuna fascia di mezzo misurabile")
                   + ("" if v.get("misurabile") else " · ⚠ sotto i 100 casi"))
    return out


def resa(previsioni, calibrazione=None, limite=12, adesso=None):
    """Righe brevi in italiano: prima gli eventi che piu' metodi prezzano (AFFIANCATI, mai mediati), poi i mercati per
    tema e liquidita', ognuno con quanto paga, la liquidita', la scadenza e l'affidabilita' misurata."""
    adesso = adesso or datetime.now(timezone.utc)
    recs = list(previsioni or [])
    out = ["MERCATI DI PREVISIONE — prezzi, non fatti: quanto paga chi scommette, con la sua affidabilità misurata; "
           "dove piu' metodi prezzano lo stesso evento stanno affiancati, mai mediati"]
    if not recs:
        return out + ["nessun mercato pertinente letto (vedi gli esiti delle fonti)"] + riassunto_calibrazione(calibrazione)
    per_chiave = {}
    for r in recs:
        per_chiave.setdefault(r["chiave"], []).append(r)
    ordine = {"polymarket": 0, "kalshi": 1, "fedwatch": 2}
    mostrate, fatti = set(), 0
    for chiave, rr in sorted(per_chiave.items(), key=lambda kv: kv[0]):
        if len({r["metodo"] for r in rr}) < 2:
            continue
        rr.sort(key=lambda r: ordine.get(r["metodo"], 9))
        out.append(f"{rr[0]['soggetto']} · {rr[0]['evento']}: " + " · ".join(_quanto_paga(r) for r in rr))
        mostrate.add(chiave)
        fatti += 1
    resto = sorted((r for r in recs if r["chiave"] not in mostrate), key=lambda r: -(r["extra"].get("liquidita") or 0))
    # un giro per tema nell'ordine di TEMI, a ogni giro il mercato piu' liquido di un evento non ancora mostrato
    code = {t[0]: [r for r in resto if r["extra"].get("tema") == t[0]] for t in TEMI}
    scelti, eventi_visti = [], set()
    while len(scelti) < max(limite - fatti, 0) and any(code.values()):
        for t in TEMI:
            coda = code[t[0]]
            while coda:
                r = coda.pop(0)
                ev = (r["metodo"], r["extra"].get("evento_mercato") or r["extra"].get("serie") or r["chiave"])
                if ev not in eventi_visti:
                    eventi_visti.add(ev)
                    scelti.append(r)
                    break
            if len(scelti) >= max(limite - fatti, 0):
                break
    for r in scelti:
        out.append(f"{r['soggetto']}: {r['evento']} — {_quanto_paga(r)} · scade {_data_it(r.get('scade'))}")
        out.append(f"   ↳ {riga_affidabilita_mercato(r, calibrazione, adesso)}")
    if len(resto) > len(scelti):
        out.append(f"… altri {len(resto) - len(scelti)} mercati pertinenti non mostrati (tutti nei record)")
    return out + riassunto_calibrazione(calibrazione)


# ───────────────────────── le verifiche (senza rete) ─────────────────────────

def _fixture():
    """Risposte JSON di esempio con la forma delle fonti vere (campi verificati il 03-06/11/2026)."""
    def mk(i, q, prezzi, esiti=("Yes", "No"), liq=200000, fine="2026-12-10T00:00:00Z", bb=None, ba=None, **kw):
        m = {"id": str(i), "question": q, "outcomes": json.dumps(list(esiti)), "outcomePrices": json.dumps(prezzi),
             "liquidityNum": liq, "volumeNum": 1e6, "volume24hr": 1e4, "endDate": fine, "active": True,
             "closed": False, "clobTokenIds": json.dumps([f"tok{i}a", f"tok{i}b"]), "bestBid": bb, "bestAsk": ba}
        m.update(kw)
        return m

    def ev(i, titolo, mercati, tags=("economy",), slug=None):
        return {"id": str(i), "title": titolo, "slug": slug or f"ev-{i}", "tags": [{"slug": t} for t in tags],
                "markets": mercati, "endDate": mercati[0]["endDate"] if mercati else None}
    pertinenti = [
        ev(1, "Fed Decision in December?", [
            mk(11, "Will the Fed increase interest rates by 25 bps after the December 2026 meeting?", ["0.78", "0.22"],
               bb=0.77, ba=0.79),
            mk(12, "Will there be no change in Fed interest rates after the December 2026 meeting?", ["0.2", "0.8"],
               bb=0.19, ba=0.21)], tags=("fed", "fed-rates")),
        ev(2, "US recession by end of 2026?", [mk(21, "US recession by end of 2026?", ["0.04", "0.96"], liq=12000,
                                                 fine="2026-12-31T12:00:00Z")]),
        ev(3, "Largest Company end of December 2026?", [mk(31, "Will NVIDIA be the largest company in the world by market cap on December 31?", ["0.81", "0.19"], fine="2027-01-01T00:00:00Z")], tags=("big-tech",)),
        ev(4, "Which party will win the House in 2026?", [mk(41, "Will the Democratic Party control the House after the 2026 Midterm elections?", ["0.83", "0.17"], fine="2026-11-20T00:00:00Z")], tags=("midterms",)),
        ev(5, "What price will Bitcoin hit in November?", [mk(51, "Will Bitcoin reach $120,000 in November?", ["0.1", "0.9"], fine="2026-12-01T05:00:00Z")], tags=("bitcoin",)),
        # l'esito cercato in SECONDA posizione: la probabilita' e' 0,15, non 0,85
        ev(6, "Chip tariffs on China?", [mk(61, "Will Trump impose new semiconductor tariffs on China by December 31?", ["0.85", "0.15"], esiti=("No", "Yes"), bb=0.84, ba=0.86, fine="2026-12-31T12:00:00Z")], tags=("tariffs",)),
    ]
    estranei = [
        ev(101, "Bank of England decision in November?", [mk(1011, "Will the BoE cut interest rates by 25 bps after the November 2026 meeting?", ["0.6", "0.4"])]),
        ev(102, "Brazil Annual Inflation 2026", [mk(1021, "Will Brazil's inflation be above 5% in 2026?", ["0.5", "0.5"])]),
        ev(103, "What will Powell say?", [mk(1031, "Will Powell say 'recession' during the December press conference?", ["0.3", "0.7"])], tags=("fed",)),
        ev(104, "Bitcoin Up or Down - November 7, 3PM ET", [mk(1041, "Bitcoin Up or Down - November 7, 3PM ET", ["0.5", "0.5"])], tags=("bitcoin",)),
        ev(105, "Fed decisions (Oct-Jan)", [mk(1051, "Hike-Hold-Hold?", ["0.2", "0.8"])], tags=("fed", "parlays")),
        ev(106, "Dota 2: Team A vs Team B", [mk(1061, "Dota 2: Team A vs Team B", ["0.5", "0.5"])]),
        ev(107, "Anthropic IPO before 2027?", [mk(1071, "Will Anthropic IPO before 2027?", ["0.3", "0.7"])], tags=("big-tech",)),
        ev(108, "Which company has the best AI model end of November?", [mk(1081, "Will Google have the best AI model end of November?", ["0.6", "0.4"])], tags=("big-tech",)),
        ev(109, "Strait of Hormuz traffic returns to normal by December 31?", [mk(1091, "Strait of Hormuz traffic returns to normal by December 31?", ["0.3", "0.7"])]),
        ev(110, "Texas Senate race", [mk(1101, "Will the Democrats win the Texas Senate race?", ["0.2", "0.8"])], tags=("midterms",)),
        ev(111, "China Annual GDP Growth 2026", [mk(1111, "Will China's GDP growth be above 5% in 2026?", ["0.4", "0.6"])]),
        ev(112, "Who will the OpenAI spy be accused of working for in 2026?", [mk(1121, "Will the OpenAI spy be accused of working for Russia?", ["0.3", "0.7"])], tags=("stocks",)),
        ev(113, "October Inflation China - Annual", [mk(1131, "Will China's annual inflation be 0.5% in October?", ["0.3", "0.7"])], tags=("inflation",)),
        ev(114, "Jerome Powell in jail before 2027?", [mk(1141, "Jerome Powell in jail before 2027?", ["0.05", "0.95"])], tags=("fed",)),
        ev(115, "When will the Bitcoin halving occur?", [mk(1151, "Bitcoin halving by April 2028?", ["0.5", "0.5"])], tags=("bitcoin",)),
        ev(116, "2026 World GDP Growth", [mk(1161, "Will world GDP growth be above 3% in 2026?", ["0.5", "0.5"])]),
    ]
    pertinenti.append(ev(7, "US Treasury announces Bitcoin purchase by ___?", [mk(71, "US Treasury announces Bitcoin purchase by December 31?", ["0.06", "0.94"], fine="2026-12-31T12:00:00Z")], tags=("bitcoin",)))
    # una scala di soglie: fuori dalla banda 3-97% e oltre i 6 piu' liquidi non entra
    pertinenti.append(ev(8, "What will NVIDIA (NVDA) hit in November 2026?", [
        mk(800 + i, f"Will NVIDIA (NVDA) reach ${180 + 10 * i} in November?", [str(p), str(round(1 - p, 2))], liq=1000 * (20 - i),
           fine="2026-12-01T05:00:00Z") for i, p in enumerate((0.99, 0.9, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05, 0.02, 0.01))],
        tags=("nvidia",)))
    kalshi = {"markets": [
        {"ticker": "KXFEDDECISION-26DEC-H25", "event_ticker": "KXFEDDECISION-26DEC", "title": "Will the Federal Reserve Hike rates by 25bps at their December 2026 meeting?",
         "yes_sub_title": "Hike 25bps", "yes_bid_dollars": "0.7600", "yes_ask_dollars": "0.7800", "open_interest_fp": "695518.51",
         "notional_value_dollars": "1.0000", "volume_fp": "1194739.88", "close_time": "2026-12-09T18:59:00Z", "status": "active"},
        {"ticker": "KXFEDDECISION-26DEC-H0", "event_ticker": "KXFEDDECISION-26DEC", "title": "Will the Federal Reserve maintain rates at their December 2026 meeting?",
         "yes_sub_title": "Fed maintains rate", "yes_bid_dollars": "0.2000", "yes_ask_dollars": "0.2100", "open_interest_fp": "579079.65",
         "notional_value_dollars": "1.0000", "volume_fp": "1232025.85", "close_time": "2026-12-09T18:59:00Z", "status": "active"},
        {"ticker": "KXFEDDECISION-26DEC-C26", "event_ticker": "KXFEDDECISION-26DEC", "title": "Will the Federal Reserve Cut rates by >25bps at their December 2026 meeting?",
         "yes_sub_title": "Cut >25bps", "yes_bid_dollars": "0.0100", "yes_ask_dollars": "0.5600", "open_interest_fp": "100",
         "notional_value_dollars": "1.0000", "volume_fp": "10", "close_time": "2026-12-09T18:59:00Z", "status": "active"},
        {"ticker": "KXFEDDECISION-27JAN-H0", "event_ticker": "KXFEDDECISION-27JAN", "title": "Will the Federal Reserve maintain rates at their January 2027 meeting?",
         "yes_sub_title": "Fed maintains rate", "yes_bid_dollars": "0.5000", "yes_ask_dollars": "0.5200", "open_interest_fp": "1000",
         "notional_value_dollars": "1.0000", "volume_fp": "100", "close_time": "2027-01-27T18:59:00Z", "status": "active"}]}
    fedwatch = {"meetings": [{"date": "2026-12-09", "riunione": "2026-12-09", "prezzata_dal_contratto": True,
                              "mosse_25bp": 0.79, "contratto": "ZQZ26.CBT", "base_effr": 3.88, "hike_prob": 79,
                              "cut_prob": None, "hold_prob": 21}]}
    return pertinenti, estranei, kalshi, fedwatch


def _get_fixture(rotte):
    def get(url):
        for prefisso, risposta in rotte:
            if url.startswith(prefisso):
                return risposta(url) if callable(risposta) else risposta
        raise RuntimeError(f"HTTP 404 (fixture: {url[:60]})")
    return get


def verifiche():
    """Le prove del modulo, senza rete: (nome, esito, dettaglio)."""
    V = []
    adesso = datetime(2026, 11, 6, 16, 0, tzinfo=timezone.utc)
    pertinenti, estranei, kalshi, fw = _fixture()

    # 1. il filtro: i pertinenti passano tutti, gli estranei nessuno — sulla strada vera (mercati_polymarket)
    rec = mercati_polymarket(pertinenti + estranei, adesso)
    attesi = {m["id"] for e in pertinenti for m in e["markets"] if e["id"] != "8"} | {"801", "802", "803", "804", "805", "806"}
    presi = {r["extra"]["id_mercato"] for r in rec}
    intrusi = sorted(r["extra"]["domanda"][:40] for r in rec if r["extra"]["id_mercato"] not in attesi)
    V.append(("filtro: passano i mercati del libro (Fed, recessione, NVIDIA, Congresso, bitcoin, chip e Cina) e nessun "
              "estraneo (BoE, Brasile, parole dette, up or down, combinazioni, esport, Anthropic, modelli di IA, Hormuz, "
              "una corsa di uno stato, PIL cinese e mondiale, la spia di OpenAI, processi, halving); della scala di NVDA "
              "restano i 6 piu' liquidi dentro 3-97%; il Tesoro che compra bitcoin e' bitcoin, non tassi",
              presi == attesi and (per_id_tema := {r["extra"]["id_mercato"]: r["extra"]["tema"] for r in rec}).get("71") == "bitcoin",
              f"intrusi {intrusi} · mancanti {sorted(attesi - presi)}"))

    # 2. il prezzo dell'esito GIUSTO: per nome, anche quando «Yes» sta in seconda posizione
    per_id = {r["extra"]["id_mercato"]: r for r in rec}
    r61, r11 = per_id.get("61"), per_id.get("11")
    ok = (r61 is not None and abs(r61["probabilita"] - 0.15) < 1e-9 and r61["intervallo"] == [0.14, 0.16]
          and r61["risolutore"]["esito_atteso"] == "Yes" and r11 is not None and abs(r11["probabilita"] - 0.78) < 1e-9)
    V.append(("prezzo: la probabilita' e' il prezzo dell'esito cercato preso per NOME (Yes in seconda posizione → 15%, "
              "non 85%), con denaro e lettera complementari", ok,
              f"61: {r61 and r61['probabilita']} {r61 and r61['intervallo']} · 11: {r11 and r11['probabilita']}"))

    # 3. sottile e liquidita'
    r21 = per_id.get("21")
    V.append(("liquidita': sotto 25.000 $ il mercato e' «sottile», sopra no",
              bool(r21 and r21["extra"]["sottile"] is True and r11 and r11["extra"]["sottile"] is False), ""))

    # 4. Kalshi: punto medio, scarto oltre 10 centesimi fuori, solo l'evento piu' vicino, la chiave comune della Fed
    sc = {}
    rk = mercati_kalshi(_get_fixture([(f"{KALSHI}/markets?series_ticker=KXFEDDECISION", kalshi),
                                      (f"{KALSHI}/markets?", {"markets": []})]), adesso, sc)
    chiavi_k = {r["chiave"]: r for r in rk}
    k_h = chiavi_k.get("Fed — riunione di dicembre 2026|rialzo dei tassi di 25 pb")
    V.append(("kalshi: punto medio fra denaro e lettera (77%), lo scarto di 55 centesimi resta fuori, l'evento di gennaio "
              "non entra, la chiave della riunione e' la stessa di Polymarket",
              len(rk) == 2 and k_h is not None and abs(k_h["probabilita"] - 0.77) < 1e-9 and r11 is not None
              and r11["chiave"] == k_h["chiave"] and sc.get("Kalshi: scarto oltre 10 centesimi") == 1,
              f"{len(rk)} record · {sorted(chiavi_k)}"))

    # 5. FedWatch: l'esito del sistema in record, nessun ricalcolo; sopra il movimento intero nessuna probabilita'
    rf = mercati_fedwatch(fw, "fixture", adesso)
    ok = ({r["evento"]: r["probabilita"] for r in rf} == {"rialzo dei tassi di 25 pb": 0.79, "tassi invariati": 0.21}
          and all(r["chiave"].startswith("Fed — riunione di dicembre 2026|") for r in rf))
    sc2 = {}
    oltre = {"meetings": [dict(fw["meetings"][0], mosse_25bp=1.4, hike_prob=None, hold_prob=None)]}
    V.append(("fedwatch: rialzo 79% e invariato 21% dalla prossima riunione, con la chiave comune; a 1,4 movimenti "
              "nessun record e il perche' dichiarato",
              ok and mercati_fedwatch(oltre, "fixture", adesso, sc2) == [] and len(sc2) == 1, ""))

    # 6. la strada intera: previsioni_oggi con le fonti finte, e la resa affiancata (mai una media)
    es = {}
    rotte = [(f"{GAMMA}/events", pertinenti + estranei), (f"{KALSHI}/markets?series_ticker=KXFEDDECISION", kalshi),
             (f"{KALSHI}/markets?", {"markets": []})]
    tutti = previsioni_oggi(adesso, rete=True, esiti=es, get=_get_fixture(rotte), fedwatch=(fw, "fixture"), cache=None)
    righe = resa(tutti, None, adesso=adesso)
    fed = [x for x in righe if x.startswith("Fed — riunione di dicembre 2026 · rialzo dei tassi di 25 pb")]
    V.append(("collegamento: previsioni_oggi porta le tre fonti e la resa affianca Polymarket 78%, Kalshi 77% e FedWatch "
              "79% sulla stessa riga, senza una media",
              len(fed) == 1 and all(s in fed[0] for s in ("Polymarket paga 78%", "Kalshi paga 77%", "FedWatch 79%"))
              and "77,7" not in fed[0] and "78%" in fed[0] and es.get("polymarket", "").startswith("letto")
              and any("SOTTILE" in x for x in righe) and any("il mercato" not in x for x in righe),
              fed[0] if fed else " | ".join(righe[:3])))

    # 7. calibrazione: nessun futuro (l'ultimo punto NON successivo), ancora alla scadenza, mercato gia' chiuso fuori
    fine = _istante("2026-10-31T00:00:00Z")
    storia = [{"t": int(fine - 40 * 86400), "p": 0.30}, {"t": int(fine - 30 * 86400 - 3600), "p": 0.35},
              {"t": int(fine - 30 * 86400 + 3600), "p": 0.99}, {"t": int(fine - 7 * 86400 - 7200), "p": 0.60},
              {"t": int(fine - 3 * 86400), "p": 0.97}]
    pa = prezzi_agli_anticipi(storia, fine, chiuso=fine - 2 * 86400)
    V.append(("calibrazione: il prezzo a 30 g e' l'ultimo NON successivo (35%, non il 99% un'ora dopo), a 7 g il 60%, "
              "a 1 g nessuno perche' il mercato era gia' chiuso", pa == {1: None, 7: 0.60, 30: 0.35}, str(pa)))

    # 8. calibrazione: lo storico e l'esito dell'esito GIUSTO (token e prezzo finale per nome)
    chiuso = mk_chiuso = {"id": "900", "question": "Will the Fed cut rates in October 2026?",
                          "outcomes": json.dumps(["No", "Yes"]), "outcomePrices": json.dumps(["1", "0"]),
                          "clobTokenIds": json.dumps(["tokNO", "tokSI"]), "closed": True, "umaResolutionStatus": "resolved",
                          "volumeNum": 50000, "endDate": "2026-10-29T00:00:00Z", "closedTime": "2026-10-28 18:30:00+00"}
    storie = {"tokSI": [{"t": int(_istante("2026-10-28T00:00:00Z") - 86400 * k), "p": 0.1} for k in (0, 6, 29)],
              "tokNO": [{"t": int(_istante("2026-10-28T00:00:00Z") - 86400 * k), "p": 0.9} for k in (0, 6, 29)]}
    def finestra(u):                   # il CLOB finto rispetta la finestra startTs-endTs, come quello vero
        a_, b_ = (int(re.search(k + r"=(\d+)", u).group(1)) for k in ("startTs", "endTs"))
        return {"history": [x for x in storie[re.search(r"market=(\w+)", u).group(1)] if a_ <= x["t"] <= b_]}
    g8 = _get_fixture([(f"{CLOB}/prices-history", finestra)])
    riga = riga_calibrazione({"title": "x"}, chiuso, storia_prezzi(g8, token_esito(chiuso, esito_principale(chiuso)),
                                                                   _istante(chiuso["endDate"]), _istante(chiuso["closedTime"])))
    V.append(("calibrazione: si segue l'esito «Yes» anche in seconda posizione — il suo storico (10%) e il suo esito (NO)",
              riga["avverato"] is False and riga["p"] == {"1": 0.1, "7": 0.1, "30": 0.1} and idoneo(mk_chiuso, adesso.timestamp()) is None,
              str(riga["p"])))

    # 9. calibra: valuta per anticipo, con la base dichiarata e l'abilita' contro il 50%
    righe_c = [{"p": {"1": 0.9, "7": 0.8, "30": None}, "avverato": True}] * 60 + [{"p": {"1": 0.1, "7": 0.3, "30": None}, "avverato": False}] * 60
    cc = calibra(righe_c)
    V.append(("calibra: Brier e abilita' per anticipo; a 30 g nessun caso e lo si dice",
              cc["1"]["valutazione"]["n"] == 120 and abs(cc["1"]["valutazione"]["brier"] - 0.01) < 1e-9
              and cc["1"]["abilita_contro_50"] > 0.9 and cc["30"]["valutazione"]["n"] == 0,
              f"brier 1g {cc['1']['valutazione']['brier']:.3f}"))

    # 10. risolvi_esterno: l'esito dichiarato; aperto o annullato → None; la Fed dalla fascia della NY Fed
    g10 = _get_fixture([
        (f"{GAMMA}/markets/900", chiuso), (f"{GAMMA}/markets/901", dict(chiuso, closed=False)),
        (f"{GAMMA}/markets/902", dict(chiuso, outcomePrices=json.dumps(["0.5", "0.5"]))),
        (f"{KALSHI}/markets/KX-NO", {"market": {"status": "finalized", "result": "no"}}),
        (f"{KALSHI}/markets/KX-APERTO", {"market": {"status": "active", "result": ""}}),
        (NYFED_RICERCA, {"refRates": [{"effectiveDate": "2026-12-08", "targetRateTo": 4.0},
                                      {"effectiveDate": "2026-12-09", "targetRateTo": 4.0},
                                      {"effectiveDate": "2026-12-10", "targetRateTo": 4.25}]})])
    dopo = datetime(2026, 12, 11, tzinfo=timezone.utc)

    def es_(f, i, a, quando=None):
        return risolvi_esterno({"genere": "esterno", "fonte": f, "id": i, "esito_atteso": a}, get=g10, adesso=quando)
    risultati = [es_("polymarket", "900", "Yes"), es_("polymarket", "900", "No"), es_("polymarket", "901", "Yes"),
                 es_("polymarket", "902", "Yes"), es_("kalshi", "KX-NO", "yes"), es_("kalshi", "KX-APERTO", "yes"),
                 es_("fedwatch", "2026-12-09|rialzo dei tassi di 25 pb", "x", dopo),
                 es_("fedwatch", "2026-12-09|tassi invariati", "x", dopo),
                 es_("fedwatch", "2026-12-09|rialzo dei tassi di 25 pb", "x", adesso)]
    V.append(("risolvi_esterno: Yes perso → False, No vinto → True, aperto e 50-50 → None, Kalshi «no» → False, "
              "Fed +25 pb → rialzo vero e invariato falso, prima della riunione → None",
              risultati == [False, True, None, None, False, None, True, False, None], str(risultati)))
    return V


if __name__ == "__main__":
    t0 = time.time()
    ok = True
    for nome, esito, dettaglio in verifiche():
        print(("PASS  " if esito else "FAIL  ") + nome + (f" — {dettaglio}" if dettaglio and not esito else ""))
        ok &= bool(esito)
    print(f"({time.time() - t0:.1f} s)")
    if "oggi" in sys.argv[1:]:
        es = {}
        prev = previsioni_oggi(datetime.now(timezone.utc), rete=True, esiti=es)
        for k, v in es.items():
            print(f"· {k}: {v}")
        print("\n".join(resa(prev, calibrazione(rete=False))))
    if "calibra" in sys.argv[1:]:
        print("\n".join(riassunto_calibrazione(calibrazione(rete=True, forza="forza" in sys.argv[1:]))))
    sys.exit(0 if ok else 1)
