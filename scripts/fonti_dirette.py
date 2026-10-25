#!/usr/bin/env python3
"""FONTI DIRETTE — le serie macro lette ALLA FONTE all'ora dell'analisi, con la pipeline come ripiego dichiarato (v511).

Uso:  python3 scripts/fonti_dirette.py
      (stampa il blocco FRESCHEZZA DEI DATI e scrive la lettura che gli altri strumenti riusano; scripts/analisi.py lo
      esegue PRIMA di tutti gli altri)

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Decisione del CEO del 25/10/2026, testuale: *"Per ciò che concerne i dati in ritardo o altri dati in ritardo che
impattano sull'analisi creando errori o dati non affidabili Elimina le dipendenze e cercale altrove se puoi. Non voglio
tornare ai vecchi problemi."*

La pipeline (scripts/update_data.py) gira sulla coda del cron di GitHub: da 99 a 263 minuti di ritardo misurati (v437),
e lo scheduler esterno che la anticipava tace dal 15/09 (memoria/OROLOGIO.md). Il semaforo (le famiglie del credito e
dei tassi), il brief e il blocco degli indici leggevano da lei serie che hanno una fonte pubblica raggiungibile da qui
SENZA credenziali — misurato il 25/10/2026:
  · FRED, il CSV pubblico (fredgraph.csv), con l'intestazione onesta (v266, v500): 0,4-0,5 s a serie
  · NY Fed, l'EFFR del giorno: 0,6 s
  · BCE, il cambio di riferimento EUR/USD delle 14:15 CET, con la sua data: 0,9 s
  · CNN, il Fear & Greed: 0,5 s con l'intestazione della pipeline (UA); 418 con quella onesta
Si leggono ALLA FONTE una volta per analisi; la pipeline resta il RIPIEGO, dichiarato riga per riga.

⚠⚠ UNA DERIVAZIONE SOLA. CPI anno su anno per data, posti di lavoro, salita del CCC, NFCI, SLOOS e Fear & Greed passano
  dalle STESSE funzioni della pipeline (scripts/comuni.py), che le importa coi nomi di prima: la stessa domanda alla stessa
  fonte deve dare la stessa risposta in qualunque dei due posti la si faccia (v161). Un gate lo verifica sugli stessi
  ingressi.
⚠ UNA LETTURA PER ANALISI. Il giro si scrive in memoria/dati/fonti_dirette.json (ignorata da git) e gli altri strumenti
  lo riusano per TRENTA minuti: due strumenti che leggessero la stessa serie in due momenti potrebbero vederne due
  osservazioni diverse nello stesso giro.
⚠ TRE ESITI per serie (v389): letta alla fonte · servita dalla pipeline (ripiego, con l'eta' del run) · non
  disponibile. "Non letta" e "nessun movimento" si leggono uguali e sono l'opposto (v406).
⚠ IL CONFRONTO CON LA PIPELINE si stampa: stessa data e stesso valore e' il caso normale; la fonte piu' avanti dice di
  quanto la pipeline e' indietro; stessa data e valore diverso e' una revisione della fonte o un difetto, e si nomina.
⚠ IL CAMBIO NON E' LA STESSA GRANDEZZA nei due posti: la BCE pubblica un riferimento datato (il fixing delle 14:15 CET),
  la pipeline una quotazione dello snapshot senza data. Si dichiara ogni volta, perche' "1,1193" e "1,1204" non sono un
  disaccordo.
⚠ COSA NON SI TROVA ALTROVE, misurato: le sensibilita' ai canali, le voci dei bilanci SEC (403 senza un contatto), lo
  storico dei CDS (ICE pubblica solo l'ultimo giorno), il debito a margine, la composizione degli ETF, il prezzo del BTP.
  Per quelli il blocco DICHIARA l'eta' del run e se e' precedente all'ultima chiusura USA conclusa: chi legge sa che
  descrivono la seduta prima, invece di scoprirlo.
⚠⚠ v512 — QUESTO DOCSTRING DICEVA «Yahoo risponde 429 da qui», e il 25/10/2026 non era vero: rimisurato, Yahoo risponde
  (59 titoli in 4 secondi). Target e revisioni degli analisti, FedWatch, il CDS dell'ultimo giorno, le vendite allo
  scoperto, le date dei depositi SEC e i trimestri che la pipeline non ha ancora li rilegge alla fonte
  scripts/fonti_titoli.py (blocco DATI PER TITOLO). Una conclusione «non disponibile» si rimisura (v497).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comuni  # noqa: E402

RADICE = Path(__file__).resolve().parent.parent
CACHE = RADICE / "memoria" / "dati" / "fonti_dirette.json"
VALIDITA_MINUTI = 30
NEW_YORK = ZoneInfo("America/New_York")
ROMA = ZoneInfo("Europe/Rome")

# ⚠ LE STESSE INTESTAZIONI DELLA PIPELINE (update_data.UA e UA_ONESTO): un gate le confronta (v500). Su FRED e BCE ci si
#   identifica per quello che si e'; la CNN risponde 418 a un'intestazione che si dichiara e 200 a quella della pipeline.
UA_ONESTO = {"User-Agent": "Trading-dashboard/1.0 (+https://github.com/Oigres85/Trading)",
             "Accept": "*/*"}
UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "*/*",
}

URL_FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
URL_EFFR = "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json"
URL_BCE = ("https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=10&format=csvdata")
URL_CNN = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"

# (chiave, nome da stampare, serie FRED, quante osservazioni tiene la pipeline per la stessa derivazione)
SERIE_FRED = (
    ("t10", "Treasury 10A", "DGS10", 380),
    ("curva", "Curva 10A-2A", "T10Y2Y", 1),
    ("reale10", "Tasso reale 10A (TIPS)", "DFII10", 1),
    ("hy", "HY OAS (credito)", "BAMLH0A0HYM2", 260),
    ("ccc", "Spread CCC (fascia peggiore)", "BAMLH0A3HYC", 260),
    ("nfci", "NFCI (condizioni fin.)", "NFCI", 60),
    ("sloos", "SLOOS (banche)", "DRTSCILM", 20),
    ("cpi", "Inflazione CPI (a/a)", "CPIAUCNS", 14),
    ("disoccupazione", "Disoccupazione", "UNRATE", 2),
    ("nfp", "Non-Farm Payrolls", "PAYEMS", 3),
)
NOMI = {k: n for k, n, _s, _o in SERIE_FRED}
NOMI.update({"effr": "Fed Funds effettivo (EFFR del giorno)", "eurusd": "EUR/USD", "fear_greed": "Fear & Greed (CNN)"})
ORDINE = tuple(k for k, *_ in SERIE_FRED[:7]) + ("effr", "eurusd", "fear_greed") + tuple(k for k, *_ in SERIE_FRED[7:])

# ⚠ COSA LA PIPELINE PORTA DA SOLA (nessuna fonte raggiungibile da qui): si nomina quando il run e' indietro.
SOLO_PIPELINE = ("sensibilita' ai canali macro", "storico dei CDS (il giorno di oggi lo rilegge fonti_titoli.py)",
                 "voci dei bilanci SEC (debito, scadenze, derivati) e salute del credito",
                 "debito a margine (famiglia «leva» del semaforo)", "composizione degli ETF della rotazione",
                 "prezzo del BTP")
# v512 — quelli che una fonte raggiungibile ce l'hanno: li rilegge scripts/fonti_titoli.py (blocco DATI PER TITOLO)
RILETTI_PER_TITOLO = ("target e revisioni degli analisti", "FedWatch", "CDS dell'ultimo giorno", "vendite allo scoperto",
                      "date dei depositi SEC e trimestri che la pipeline non ha ancora")


# ══════════════════════════════════ LETTURA ALLA FONTE ═════════════════════════════════════════════════════════
def _get(url, intestazioni, timeout=20):
    import requests
    r = requests.get(url, headers=intestazioni, timeout=timeout)
    r.raise_for_status()
    return r


def da_fred(chiave, serie):
    """La voce di una serie FRED, con la STESSA derivazione della pipeline (comuni.py). serie: le osservazioni di
    fredgraph.csv, gia' ridotte alle ultime che la pipeline tiene. None se la serie non basta."""
    if not serie:
        return None
    sid = next(s for k, _n, s, _o in SERIE_FRED if k == chiave)
    fonte = f"FRED {sid}"
    if chiave == "ccc":
        v = comuni.credito_ccc(serie)
        return {**v, "fonte": fonte} if v else None
    if chiave == "nfci":
        v = comuni.nfci_da(serie)
        return {**v, "fonte": fonte} if v else None
    if chiave == "sloos":
        v = comuni.sloos_da(serie)
        return {**v, "fonte": fonte} if v else None
    if chiave == "cpi":
        v, d, mesi = comuni.var_per_data(serie, 12)
        return {"valore": v, "data": d, "mesi": mesi, "fonte": fonte}
    if chiave == "nfp":
        v, d, mesi = comuni.delta_mensile(serie)
        return {"valore": v, "data": d, "mesi": mesi, "fonte": fonte}
    d, v = serie[-1]
    return {"valore": round(float(v), 2), "data": d, "fonte": fonte}


def da_effr(js):
    rr = (js or {})["refRates"][0]
    return {"valore": float(rr["percentRate"]), "data": str(rr["effectiveDate"])[:10], "fonte": "NY Fed"}


def da_bce(testo):
    """L'ultimo riferimento EUR/USD della BCE (dollari per un euro) con la sua data; colonne lette per INTESTAZIONE."""
    righe = [r for r in str(testo or "").strip().splitlines() if r.strip()]
    if len(righe) < 2:
        return None
    import csv
    tab = list(csv.DictReader(righe))
    oss = [(r.get("TIME_PERIOD"), comuni.numero_o_none(r.get("OBS_VALUE"))) for r in tab]
    oss = [(d, v) for d, v in oss if d and v is not None]
    if not oss:
        return None
    d, v = max(oss)
    return {"valore": v, "data": d, "fonte": "BCE, riferimento delle 14:15 CET"}


CNN_COMPONENTI = ("market_momentum_sp500", "stock_price_strength", "stock_price_breadth", "put_call_options",
                  "market_volatility_vix", "safe_haven_demand", "junk_bond_demand")


def da_cnn(js):
    """Il Fear & Greed con la derivazione della pipeline (comuni.fear_greed_base) e le chiavi delle componenti che la
    fonte porta in questa risposta: chi lo legge sa da se' se il VIX e il put/call ne fanno parte (B3)."""
    b = comuni.fear_greed_base(js)
    comp = [k for k in CNN_COMPONENTI if isinstance(js.get(k), dict) and js[k].get("rating")]
    return {**b, "valore": b["score"], "data": b.get("asof"), "componenti": comp, "fonte": "CNN"}


def leggi_alla_fonte():
    """{chiave: voce}, {chiave: errore}. Non solleva mai: una fonte che non risponde e' un esito, non un'eccezione."""
    voci, errori = {}, {}

    def fred(k, sid, n):
        return k, da_fred(k, comuni.fredgraph(_get(URL_FRED.format(sid=sid), UA_ONESTO).text)[-n:])

    def effr():
        try:
            return "effr", da_effr(_get(URL_EFFR, UA).json())
        except Exception as e1:  # noqa: BLE001 — la stessa catena della pipeline: NY Fed, poi FRED EFFR
            s = comuni.fredgraph(_get(URL_FRED.format(sid="EFFR"), UA_ONESTO).text)
            if not s:
                raise RuntimeError(f"NY Fed: {e1}; FRED EFFR vuota") from e1
            return "effr", {"valore": float(s[-1][1]), "data": s[-1][0], "fonte": "FRED EFFR (NY Fed non letta)"}

    lavori = [(k, (lambda k=k, s=s, n=n: fred(k, s, n))) for k, _nome, s, n in SERIE_FRED]
    lavori += [("effr", effr), ("eurusd", lambda: ("eurusd", da_bce(_get(URL_BCE, UA_ONESTO).text))),
               ("fear_greed", lambda: ("fear_greed", da_cnn(_get(URL_CNN, UA).json())))]
    with ThreadPoolExecutor(8) as ex:
        fut = {k: ex.submit(f) for k, f in lavori}
        for k, f in fut.items():
            try:
                _k, v = f.result()
                if v is None:
                    errori[k] = "la fonte ha risposto senza osservazioni utilizzabili"
                else:
                    voci[k] = v
            except Exception as e:  # noqa: BLE001
                errori[k] = f"{type(e).__name__}: {str(e)[:90]}"
    return voci, errori


# ══════════════════════════════════ LA PIPELINE, COME RIPIEGO ══════════════════════════════════════════════════
def _num(x):
    m = re.search(r"[-+]?\d+(?:\.\d+)?", str(x if x is not None else ""))
    return float(m.group(0)) if m else None


def dalla_pipeline(d):
    """{chiave: voce} dalle stesse serie in data/data.json, nella forma di leggi_alla_fonte, ciascuna con la SUA data."""
    m = (d or {}).get("macro") or {}
    out = {}

    def ind(k):
        return next((x for x in (m.get("indicators") or []) if x.get("key") == k), None)

    a10 = next((s for s in ((m.get("tassi") or {}).get("scadenze") or []) if s.get("key") == "a10"), None)
    if a10 and a10.get("value") is not None:
        out["t10"] = {"valore": float(a10["value"]), "data": a10.get("observation_date"), "fonte": "pipeline"}
    for k, chiave in (("curve", "curva"), ("real10", "reale10"), ("unemp", "disoccupazione")):
        x = ind(k)
        if x and _num(x.get("value")) is not None:
            out[chiave] = {"valore": _num(x["value"]), "data": x.get("date"), "fonte": "pipeline"}
    for k, chiave, mesi in (("cpi", "cpi", 12), ("nfp", "nfp", 1)):
        x = ind(k)
        if x and _num(x.get("value")) is not None:
            v = _num(x["value"])
            out[chiave] = {"valore": int(v) if chiave == "nfp" else v, "data": x.get("date"),
                           "mesi": x.get("span_mesi") or mesi, "fonte": "pipeline"}
    cr = m.get("credit") or {}
    if cr.get("spread_hy") is not None:
        out["hy"] = {"valore": cr["spread_hy"], "data": cr.get("date"), "fonte": "pipeline"}
    if (m.get("credit_ccc") or {}).get("valore") is not None:
        out["ccc"] = {**m["credit_ccc"], "fonte": "pipeline"}
    cb = m.get("credito_banche") or {}
    for k in ("nfci", "sloos"):
        if (cb.get(k) or {}).get("valore") is not None:
            out[k] = {**cb[k], "fonte": "pipeline"}
    ef = (m.get("fedwatch") or {}).get("effr") or {}
    if ef.get("valore") is not None:
        out["effr"] = {**ef, "fonte": f"pipeline ({ef.get('fonte') or 'n.d.'})"}
    eur = next((x for x in (m.get("markets") or []) if x.get("key") == "EURUSD=X"), None)
    if eur and _num(eur.get("value")) is not None:
        out["eurusd"] = {"valore": _num(eur["value"]), "data": None,
                         "fonte": "pipeline: quotazione dello snapshot, non datata"}
    fg = m.get("fear_greed") or {}
    if fg.get("score") is not None:
        out["fear_greed"] = {**fg, "valore": fg["score"], "data": fg.get("asof"), "fonte": "pipeline"}
    return out


def eta_run(d, adesso=None):
    run = (d or {}).get("updated_at")
    if not run:
        return None, None
    try:
        t = datetime.fromisoformat(str(run).replace("Z", "+00:00"))
    except ValueError:
        return run, None
    return run, ((adesso or datetime.now(timezone.utc)) - t).total_seconds() / 3600


def ultima_chiusura_usa(adesso=None):
    """Le 16:00 di New York dell'ultimo giorno feriale gia' chiuso, col FUSO (v470). ⚠ Le festivita' USA non sono note:
    in un giorno di chiusura questa risposta e' un'ora che non c'e' stata, e un run del mattino risulta «precedente
    all'ultima chiusura» — il verso PRUDENTE, che fa dichiarare indietro un dato che forse non lo e'."""
    ny = (adesso or datetime.now(timezone.utc)).astimezone(NEW_YORK)
    g = ny.replace(hour=16, minute=0, second=0, microsecond=0)
    if ny < g:
        g -= timedelta(days=1)
    while g.weekday() >= 5:
        g -= timedelta(days=1)
    return g


# ══════════════════════════════════ LA SCELTA, UNA PER GIRO ═══════════════════════════════════════════════════
def _confronto(dir_, pipe, chiave):
    """Come la pipeline sta rispetto alla fonte, sulla stessa serie."""
    if not pipe:
        return "la pipeline non la porta"
    if chiave == "eurusd":
        return (f"la pipeline porta una quotazione dello snapshot, {comuni_it(pipe['valore'], 4)}, non datata: "
                "un'altra grandezza (il riferimento BCE e' un fixing delle 14:15 CET), non un disaccordo")
    dd, dp = str(dir_.get("data") or ""), str(pipe.get("data") or "")
    vd, vp = dir_.get("valore"), pipe.get("valore")
    if dd == dp:
        if vd == vp:
            return "pipeline: stessa osservazione"
        return (f"⚠ STESSA DATA, VALORE DIVERSO nella pipeline ({valore_testo(chiave, pipe)} contro "
                f"{valore_testo(chiave, dir_)}): una revisione della fonte dopo il run, o un difetto — vale la fonte "
                "letta adesso")
    if dp and dd and dp < dd:
        return f"⚠ la pipeline e' INDIETRO: ha l'osservazione del {dp}, la fonte quella del {dd}"
    if dp and dd and dp > dd:
        return (f"⚠ la pipeline ha un'osservazione PIU' RECENTE ({dp}) di quella letta adesso ({dd}): vale la piu' "
                "recente, e la fonte va guardata")
    return f"pipeline: rilevazione {dp or 'non dichiarata'}"


def comuni_it(v, dec):
    return f"{v:.{dec}f}".replace(".", ",") if isinstance(v, (int, float)) else "n.d."


def scegli(diretta, pipe):
    """{chiave: voce scelta} — la fonte letta adesso, oppure la pipeline come ripiego, oppure niente. Ogni voce porta
    «esito» ("fonte" · "pipeline") e «confronto». ⚠ Se la pipeline ha un'osservazione piu' recente vale la piu' recente:
    l'ultimo dato ufficiale (v396), da qualunque parte arrivi."""
    out = {}
    for k in ORDINE:
        dv, pv = (diretta or {}).get(k), (pipe or {}).get(k)
        if dv:
            if (pv and k != "eurusd" and pv.get("data") and dv.get("data")
                    and str(pv["data"]) > str(dv["data"])):
                out[k] = {**pv, "esito": "pipeline", "confronto": _confronto(dv, pv, k)}
            else:
                out[k] = {**dv, "esito": "fonte", "confronto": _confronto(dv, pv, k)}
        elif pv:
            out[k] = {**pv, "esito": "pipeline", "confronto": "non letta alla fonte in questo giro"}
    return out


def _carica_pipeline():
    try:
        return json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    except (OSError, ValueError):
        return None


def leggi(forza=False, percorso=None, max_minuti=VALIDITA_MINUTI, adesso=None):
    """La lettura del giro: {"letto", "diretta", "errori", "secondi"}. Riusa quella scritta da meno di `max_minuti`
    (una lettura per analisi); altrimenti legge alla fonte e la scrive. Non solleva mai."""
    p = Path(percorso) if percorso else CACHE
    ora = adesso or datetime.now(timezone.utc)
    if not forza:
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
            t = datetime.fromisoformat(c["letto"])
            if timedelta(0) <= ora - t <= timedelta(minutes=max_minuti):
                return c
        except (OSError, ValueError, KeyError, TypeError):
            pass
    t0 = time.time()
    voci, errori = leggi_alla_fonte()
    c = {"letto": ora.isoformat(), "diretta": voci, "errori": errori, "secondi": round(time.time() - t0, 1)}
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(c, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as e:
        c["errori"]["_scrittura"] = f"lettura non salvata ({e}): gli altri strumenti la rifaranno"
    return c


def del_giro(d=None, lettura=None):
    """Cio' che gli strumenti usano: {"scelta", "lettura", "run", "eta_ore"}. d: data.json gia' aperto (o None)."""
    d = _carica_pipeline() if d is None else d
    lettura = leggi() if lettura is None else lettura
    run, eta = eta_run(d)
    return {"scelta": scegli(lettura.get("diretta"), dalla_pipeline(d)), "lettura": lettura, "run": run, "eta_ore": eta}


# ══════════════════════════════════ RESA ══════════════════════════════════════════════════════════════════════
def valore_testo(k, v):
    """La resa di una voce, nella convenzione del resto dell'uscita (virgola decimale, v442)."""
    x = v.get("valore")
    if x is None:
        return "n.d."
    if k == "curva":
        return ("+" if x > 0 else "") + comuni_it(x, 2) + " pp"
    if k == "nfp":
        return f"{int(x):+d}K"
    if k == "fear_greed":
        return f"{int(x)} ({v.get('rating') or 'giudizio n.d.'})"
    if k == "eurusd":
        return comuni_it(x, 4)
    if k == "cpi":
        return comuni_it(x, 1) + "%"
    if k in ("nfci",):
        return comuni_it(x, 2)
    if k == "sloos":
        return comuni_it(x, 1)
    return comuni_it(x, 2) + "%" if k != "disoccupazione" else comuni_it(x, 1) + "%"


MESI = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
        "novembre", "dicembre")
PERIODO = {"cpi": "mese", "disoccupazione": "mese", "nfp": "mese", "sloos": "indagine"}


def quando(k, data):
    """v392 — una serie mensile descrive un MESE e un'indagine trimestrale il mese in cui si e' svolta: scriverli come un
    giorno invita a leggerli vecchi di settimane. Le giornaliere e le settimanali portano il giorno."""
    d = str(data or "")[:10]
    if not d:
        return "rilevazione non dichiarata"
    p = PERIODO.get(k)
    if p and len(d) >= 7 and d[5:7].isdigit() and 1 <= int(d[5:7]) <= 12:
        mese = f"{MESI[int(d[5:7]) - 1]} {d[:4]}"
        return f"riferito a {mese}" if p == "mese" else f"indagine di {mese}"
    return f"rilevazione {d}"


def sintesi(g, adesso=None):
    ora = (adesso or datetime.now(timezone.utc))
    let = g["lettura"]
    # l'ora e' quella della LETTURA, non di adesso: una lettura riusata dalla memoria del giro (fino a 30 minuti) non
    #   si dichiara fatta adesso (v431: l'etichetta dall'orologio, il valore dai dati)
    try:
        letto = datetime.fromisoformat(let["letto"])
    except (KeyError, TypeError, ValueError):
        letto = None
    L = [(f"FRESCHEZZA DEI DATI — letta alla fonte il {letto.astimezone(ROMA):%d/%m/%Y alle %H:%M} ora italiana "
          f"(New York {letto.astimezone(NEW_YORK):%H:%M}), in {comuni_it(let.get('secondi'), 1)} s" if letto else
          "FRESCHEZZA DEI DATI — ora della lettura NON dichiarata"),
         "  Serie macro: la fonte letta adesso; la pipeline e' il ripiego, e ogni riga porta la PROPRIA rilevazione."]
    sc = g["scelta"]
    for k in ORDINE:
        v = sc.get(k)
        nome = NOMI[k]
        if not v:
            L.append(f"  {nome:38} NON DISPONIBILE — ne' la fonte ({let.get('errori', {}).get(k, 'n.d.')}) ne' la "
                     "pipeline: e' il dato che manca, non un valore neutro")
            continue
        mesi = v.get("mesi")
        span = (f" (su {mesi} mesi: la base esatta non c'e')" if (k == "cpi" and mesi and mesi != 12)
                or (k == "nfp" and mesi and mesi != 1) else "")
        L.append(f"  {nome:38} {valore_testo(k, v):>12}{span}   {quando(k, v.get('data'))}   {v.get('fonte')}")
        L.append(f"  {'':38} {v['confronto']}")
    n_f = sum(1 for v in sc.values() if v.get("esito") == "fonte")
    n_p = sum(1 for v in sc.values() if v.get("esito") == "pipeline")
    L.append(f"  -> {n_f} su {len(ORDINE)} lette alla fonte, {n_p} dalla pipeline, {len(ORDINE) - n_f - n_p} non "
             "disponibili")
    for k, e in sorted((let.get("errori") or {}).items()):
        if k in NOMI:
            L.append(f"  ⚠ {NOMI[k]}: fonte non letta ({e})")
    run, eta = g.get("run"), g.get("eta_ore")
    chiusura = ultima_chiusura_usa(ora)
    L.append("")
    if run is None:
        L.append("  PIPELINE (data/data.json): ASSENTE o illeggibile — i dati per titolo che porta solo lei NON sono in "
                 "questa analisi: " + "; ".join(SOLO_PIPELINE))
        return L
    try:
        t = datetime.fromisoformat(str(run).replace("Z", "+00:00"))
    except ValueError:
        t = None
    prima = t is not None and t < chiusura
    L.append(f"  PIPELINE (data/data.json): run del {run}, {comuni_it(eta, 1) if eta is not None else 'n.d.'} ore fa — "
             + (f"⚠ PRECEDENTE all'ultima chiusura USA ({chiusura:%d/%m %H:%M} di New York)" if prima
                else f"dopo l'ultima chiusura USA ({chiusura:%d/%m %H:%M} di New York)"))
    if prima or (eta is not None and eta > 24):
        L.append("    ⚠ descrivono la seduta PRIMA, perche' una fonte raggiungibile da qui non c'e' (SEC 403, ICE solo "
                 "l'ultimo giorno, FINRA per il debito a margine): " + "; ".join(SOLO_PIPELINE))
        L.append("    ⚠ le festivita' USA non sono note al calcolo dell'ultima chiusura: in un giorno di chiusura questo "
                 "avviso suona nel verso prudente")
    else:
        L.append("    solo dalla pipeline (nessuna fonte raggiungibile da qui), allineati all'ultima seduta: "
                 + "; ".join(SOLO_PIPELINE))
    L.append("    riletti alla fonte da scripts/fonti_titoli.py, blocco DATI PER TITOLO (v512): " + "; ".join(RILETTI_PER_TITOLO))
    return L


def main():
    g = del_giro(lettura=leggi(forza=True))
    print("\n".join(sintesi(g)))


if __name__ == "__main__":
    main()
