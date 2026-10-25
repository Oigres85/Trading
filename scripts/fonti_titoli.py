#!/usr/bin/env python3
"""FONTI PER TITOLO — i dati per titolo che portava solo la pipeline, letti ALLA FONTE all'ora dell'analisi (v512).

Uso:  python3 scripts/fonti_titoli.py
      (stampa il blocco DATI PER TITOLO e scrive la lettura che gli altri strumenti riusano; scripts/analisi.py lo
      esegue PRIMA di tutti gli altri, insieme a fonti_dirette.py)

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il CEO, 25/10/2026, testuale: *"target degli analisti, FedWatch, storico dei CDS, vendite allo scoperto, bilanci SEC
della pipeline se non sono aggiornati (non so ogni quanto si aggiornano) trovali altrove anche attraverso news; dati
non aggiornati non sono affidabili come per esempio errore stagionalità, non voglio avere mai errori simili fanno danni
sull'analisi"*.

La v511 aveva tolto dalla coda del cron le serie macro, e DICHIARATO che i dati per titolo non si trovavano altrove:
«Yahoo risponde 429 da qui». Rimisurato il 25/10/2026 invece che ricordato: Yahoo risponde (59 titoli in 4 secondi), e
con lui i future Fed Funds per esteso; ICE e FINRA rispondevano gia'. Una conclusione «non disponibile» si rimisura
quando la domanda torna (v497).

Cosa fa, e con QUALI funzioni — sempre quelle della pipeline, perche' la stessa domanda alla stessa fonte dia la stessa
risposta nei due posti (v161):
  · ANALISTI (Yahoo): update_data.analisti_da, per ogni posizione e sorvegliato. Vince la lettura di adesso; un titolo
    per cui Yahoo non restituisce niente tiene la pipeline, DICHIARATO.
  · FEDWATCH (future Fed Funds per esteso via Yahoo, EFFR della NY Fed): update_data.fedwatch_da, la catena delle
    riunioni (v477).
  · CDS (ICE): si legge l'ultimo giorno; se per qualche nome o indice ICE ha un giorno PIU' RECENTE della pipeline, le
    misure si rifanno con update_data.aggiorna_cds su una COPIA dello storico (memoria/dati/, fuori dal repo) e coi
    rendimenti del titolo letti adesso. E il giorno che lo storico del repo non ha si CONSERVA in
    memoria/cds_sessione.jsonl, che la pipeline unisce al proprio storico al run dopo: ICE pubblica solo l'ultimo giorno,
    e un giorno che nessuno raccoglie e' perso per sempre (v497, v508 — il 21/10 e' andato perso cosi').
  · VENDITE ALLO SCOPERTO (FINRA): se FINRA ha pubblicato un regolamento PIU' RECENTE di quello della pipeline, le
    misure si rifanno con update_data.aggiorna_short.
  · DEPOSITI SEC: le date dei 10-Q e 10-K da Yahoo (SEC risponde 403 da qui senza un contatto, e il contatto del CEO non
    si manda a un servizio nuovo). Un deposito periodico piu' recente della lettura del debito della pipeline si NOMINA,
    e cosi' una tabella dei trimestri ferma prima di un 10-Q depositato. Le voci XBRL non si rileggono da qui: si dice.
⚠ UNA LETTURA PER ANALISI: memoria/dati/fonti_titoli.json (ignorata da git), riusata per TRENTA minuti da chi carica
  data.json (carica): due strumenti che leggessero lo stesso titolo in due momenti potrebbero vederne due consensi.
⚠ VINCE LA PIU' RECENTE: un CDS o un regolamento della pipeline piu' avanti di quello letto restano quelli della
  pipeline — l'ultimo dato ufficiale, da qualunque parte arrivi (v396).
⚠ QUANDO NEMMENO LA FONTE E' AGGIORNATA (i conti di un 10-Q che Yahoo non ha ancora, un regolamento che il calendario di
  FINRA dichiara pubblicato e l'API no) lo strumento lo scrive in DA CERCARE IN RETE, e la risposta lo cerca nelle
  notizie con fonte e data (memoria/FORMATO_ANALISI.md, [freschezza]).
⚠ NON E' UN GIUDIZIO: sposta l'ora del dato, non la sua lettura. Le regole che leggono analisti, CDS e short restano
  quelle di prima.
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

RADICE = Path(__file__).resolve().parent.parent
CACHE = RADICE / "memoria" / "dati" / "fonti_titoli.json"
STORIA_COPIA = RADICE / "memoria" / "dati" / "cds_storia_copia.jsonl"
CDS_SESSIONE = RADICE / "memoria" / "cds_sessione.jsonl"
CDS_SESSIONE_GIORNI = 30
VALIDITA_MINUTI = 30
PERIODICI = ("10-Q", "10-K")
URL_NASDAQ_FIN = "https://api.nasdaq.com/api/company/{tk}/financials?frequency=2"
# le voci del conto di Nasdaq che possono essere la STESSA grandezza della pipeline (update_data.conto_trimestrale):
#   quale lo sono lo decide il trimestre in comune, non il nome
VOCI_NASDAQ = {"ricavi": ("Total Revenue",),
               "operativo": ("Operating Income",),
               "utile": ("Net Income", "Net Income Applicable to Common Shareholders", "Net Income-Cont. Operations")}
SPENTA = "TRADING_FONTI_TITOLI"     # ="spenta": le suite non leggono la lettura del giro (dipenderebbero dall'ora)
NEW_YORK = ZoneInfo("America/New_York")
ROMA = ZoneInfo("Europe/Rome")
BLOCCHI = ("analisti", "fedwatch", "cds", "short", "sec", "trimestri")

# ⚠ OGNI QUANTO CAMBIA CIASCUN DATO, e ogni quanto la pipeline lo rilegge: la domanda del CEO del 25/10. Fatti delle fonti
#   (orari, scadenze di legge, calendario), non stime: dove la cadenza non e' fissata dalla fonte si dice.
CADENZE = (
    ("analisti", "Analisti (Yahoo)",
     "nessuna cadenza fissa: una casa alza o taglia un target o una stima in qualunque giorno, e la lettura di adesso e' "
     "il consenso che Yahoo pubblica in questo momento"),
    ("fedwatch", "FedWatch (future Fed Funds CME, EFFR NY Fed)",
     "i future quotano da domenica alle 18:00 a venerdi' alle 17:00 di New York, con un'ora di pausa ogni giorno dalle "
     "17:00; l'EFFR la NY Fed lo pubblica ogni giorno lavorativo verso le 9:00 di New York, per il giorno lavorativo prima"),
    ("cds", "CDS (ICE Clear Credit)",
     "un prezzo di fine giornata per ogni giorno di compensazione, pubblicato a ondate (Asia, Europa, Nord America con "
     "gli indici CDX fra le 19:50 e le 21:00 UTC, misurato in v508); ICE pubblica SOLO l'ultimo giorno, lo storico lo "
     "raccoglie chi lo legge"),
    ("short", "Vendite allo scoperto (FINRA)",
     "due regolamenti al mese (meta' e fine mese), pubblicati secondo il calendario ufficiale di FINRA, di solito sette "
     "giorni lavorativi dopo"),
    ("sec", "Depositi SEC",
     "10-Q ogni trimestre, entro 40 o 45 giorni dalla chiusura secondo la dimensione della societa'; 10-K ogni anno, "
     "entro 60, 75 o 90 giorni; 8-K entro quattro giorni lavorativi da un evento (i conti escono di solito con un 8-K il "
     "giorno stesso). La pipeline rilegge le voci del debito solo dopo un 10-Q o 10-K nuovo, al piu' dieci per run"),
)
CADENZA_PIPELINE = ("La pipeline rilegge analisti, FedWatch, CDS e short a ogni run: 14-15 run al giorno nei feriali e "
                    "11 nel fine settimana, che partono con 99-263 minuti di ritardo sull'orario (la coda del cron di "
                    "GitHub, v437)")


def _ud():
    """update_data si importa una volta e in silenzio: stampa l'elenco dei simboli quando viene caricato (come
    concorrenti.py)."""
    if "update_data" not in sys.modules:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            import update_data  # noqa: F401
    return sys.modules["update_data"]


def _sicuro(f):
    def g(x):
        try:
            return f(x)
        except Exception:  # noqa: BLE001 — un titolo che non risponde non porta via gli altri
            return None
    return g


def _in_parallelo(f, nomi, thread=6):
    nomi = list(nomi)
    with ThreadPoolExecutor(thread) as ex:
        return dict(zip(nomi, ex.map(_sicuro(f), nomi)))


def _simbolo(tk):
    """Il simbolo che la pipeline chiede a Yahoo (update_data.TICKER_ALIAS): lo stesso titolo, la stessa domanda."""
    tk = str(tk or "").strip()
    return _ud().TICKER_ALIAS.get(tk.upper(), tk)


def nomi_libro():
    """(posizioni in dollari, sorvegliati): gli stessi nomi delle schede del progetto."""
    import brief
    pos, _, sorv = brief.leggi_libro()
    p = [x["tk"] for x in pos if x.get("valuta") == "USD"]
    return p, [s["tk"] for s in sorv if s["tk"] not in p]


def _righe(d):
    return [r for r in ((d or {}).get("portfolio") or []) + ((d or {}).get("watchlist") or [])
            if isinstance(r, dict) and r.get("ticker")]


def _riferimento(tk):
    """Indici, cambi, future e criptovalute si riconoscono dalla FORMA del simbolo (v410)."""
    tk = str(tk or "")
    return tk.startswith("^") or "=" in tk or tk.endswith("-USD")


# ══════════════════════════════════ LE LETTURE ═══════════════════════════════════════════════════════════════════
def leggi_analisti(nomi, lettore=None):
    """{tk: dict o None} con update_data.analisti_da. None = Yahoo non ha restituito niente (o non ha risposto): la
    funzione della pipeline non distingue i due casi, e questo strumento nemmeno — tiene la pipeline e lo dice."""
    if lettore is None:
        import yfinance as yf
        ud = _ud()
        lettore = lambda tk: ud.analisti_da(yf.Ticker(_simbolo(tk)), tk)  # noqa: E731
    return _in_parallelo(lettore, nomi)


def periodici_da(depositi):
    """{'10-Q': 'AAAA-MM-GG', '10-K': ...}: l'ultimo deposito periodico di ciascun tipo, dalla lista di Yahoo (le
    modifiche, «10-Q/A», non sono un trimestre nuovo e restano fuori)."""
    out = {}
    for f in depositi or []:
        tipo = str((f or {}).get("type") or "").strip().upper()
        if tipo not in PERIODICI:
            continue
        g = f.get("date")
        g = g.isoformat() if hasattr(g, "isoformat") else str(g or "")[:10]
        if len(g) == 10 and g > out.get(tipo, ""):
            out[tipo] = g
    return out


def leggi_sec(nomi, lettore=None):
    """{tk: {'10-Q', '10-K'} o None}: None = Yahoo non ha risposto; {} = ha risposto senza 10-Q ne' 10-K (un emittente
    estero deposita 20-F e 6-K, che la pipeline non legge)."""
    if lettore is None:
        import yfinance as yf
        lettore = lambda tk: yf.Ticker(_simbolo(tk)).sec_filings  # noqa: E731
    letti = _in_parallelo(lettore, nomi)
    return {tk: (periodici_da(v) if v is not None else None) for tk, v in letti.items()}


def rendimenti_di(nomi, lettore=None):
    """{tk: (_ret_series, _ret_dates)} come li costruisce la pipeline (update_data.rendimenti_datati sui log-rendimenti
    di un anno di chiusure rettificate, senza le barre vuote): il lato azionario di CDS e short si legge su quelli."""
    ud = _ud()
    if lettore is None:
        import yfinance as yf
        lettore = lambda tk: yf.Ticker(_simbolo(tk)).history(period="1y", interval="1d", auto_adjust=True)  # noqa: E731

    def uno(tk):
        h = ud.drop_void_bars(lettore(tk))
        if h is None or h.empty:
            return None
        return ud.rendimenti_datati(ud.rendimenti_log(h["Close"]))
    return {k: v for k, v in _in_parallelo(uno, nomi).items() if v}


def _num_nasdaq(s):
    """'$1,235,837' → 1235837000 (Nasdaq scrive in MIGLIAIA); '-$49,000' → -49000000; '--' o vuoto → None."""
    t = str(s or "").strip().replace("$", "").replace(",", "")
    if t in ("", "--", "-"):
        return None
    try:
        return round(float(t) * 1000)
    except ValueError:
        return None


def trimestri_nasdaq(js):
    """[{trim, voci: {nome: valore}}] dal conto trimestrale di Nasdaq, dal piu' recente. [] se la forma non e' quella
    attesa: una forma diversa si dichiara, non si indovina."""
    from datetime import date
    t = ((((js or {}).get("data") or {}).get("incomeStatementTable")) or {})
    h, rows = t.get("headers") or {}, t.get("rows") or []
    out = []
    for k in sorted((k for k in h if k != "value1"), key=lambda k: int(k[5:]) if k[5:].isdigit() else 99):
        try:
            m, g, a = (int(x) for x in str(h[k]).split("/"))
            d = date(a, m, g).isoformat()
        except (ValueError, TypeError):
            continue
        out.append({"trim": d, "voci": {r.get("value1"): _num_nasdaq(r.get(k)) for r in rows if r.get("value1")}})
    return sorted(out, key=lambda x: x["trim"], reverse=True)


def _vicini(a, b, giorni=5):
    from datetime import date
    try:
        return abs((date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days) <= giorni
    except ValueError:
        return False


def completa_trimestri(conto, nasdaq):
    """I trimestri che Nasdaq porta e la tabella della pipeline no, nella forma di update_data.conto_trimestrale.
    ⚠⚠ DUE FORNITORI NON SI MESCOLANO PER IPOTESI: sul trimestre piu' recente IN COMUNE ogni voce di Nasdaq deve dare il
    numero della pipeline (Nasdaq scrive in migliaia: lo scarto ammesso e' quell'arrotondamento). I ricavi devono
    coincidere o non si aggiunge niente; utile e risultato operativo entrano solo con la voce che coincide (sull'utile i
    fornitori usano definizioni diverse: il 25/10 BE, 196,3 milioni da Yahoo, e' la voce «Net Income Applicable to
    Common Shareholders» di Nasdaq e non il suo «Net Income» di 200,6). Restituisce {esito, nuovi, comune, voci}."""
    ct = sorted([x for x in conto or [] if isinstance(x, dict) and x.get("trim") and x.get("ricavi") is not None],
                key=lambda x: str(x["trim"]), reverse=True)
    if not ct or not nasdaq:
        return {"esito": "nessun confronto possibile", "nuovi": []}
    u = ct[0]
    com = next((q for q in nasdaq if _vicini(q["trim"], str(u["trim"]))), None)
    if com is None:
        return {"esito": f"Nasdaq non porta il trimestre del {str(u['trim'])[:10]}: nessun confronto, niente si aggiunge",
                "nuovi": []}

    def uguali(a, b):
        return a is not None and b is not None and abs(a - b) <= max(1000, abs(b) * 0.0005)
    scelte = {}
    for campo, nomi in VOCI_NASDAQ.items():
        scelte[campo] = next((n for n in nomi if uguali(com["voci"].get(n), u.get(campo))), None)
    if not scelte["ricavi"]:
        return {"esito": (f"sul trimestre in comune ({str(u['trim'])[:10]}) i ricavi di Nasdaq non coincidono con quelli "
                          "della pipeline: le due fonti non si mescolano"), "nuovi": [], "comune": str(u["trim"])[:10]}
    nuovi = []
    for q in nasdaq:
        if q["trim"] <= str(u["trim"])[:10] or _vicini(q["trim"], str(u["trim"]), 20):
            continue
        r = q["voci"].get(scelte["ricavi"])
        if r is None:
            continue
        o = q["voci"].get(scelte["operativo"]) if scelte["operativo"] else None
        ut = q["voci"].get(scelte["utile"]) if scelte["utile"] else None
        nuovi.append({"trim": q["trim"], "ricavi": r, "utile": ut, "operativo": o,
                      "margine": round(ut / r * 100, 1) if ut is not None and r else None,
                      "margine_op": round(o / r * 100, 1) if o is not None and r else None,
                      "fonte": "Nasdaq"})
    return {"esito": "completata" if nuovi else "Nasdaq non porta trimestri piu' recenti", "nuovi": nuovi,
            "comune": str(u["trim"])[:10], "voci": {k: v for k, v in scelte.items()}}


def leggi_trimestri(nomi, lettore=None):
    """{tk: trimestri di Nasdaq o None}."""
    if lettore is None:
        import brief
        lettore = lambda tk: trimestri_nasdaq(brief.jget(URL_NASDAQ_FIN.format(tk=tk), 20))  # noqa: E731
    return _in_parallelo(lettore, nomi, thread=4)


def ferme(d, periodici):
    """I nomi la cui tabella dei trimestri e' FERMA: l'ultimo deposito di risultati (8-K item 2.02 della pipeline o
    10-Q/10-K letti adesso) cade oltre la soglia dopo l'ultimo trimestre della tabella (schede.deposito_oltre_la_tabella,
    una regola sola: v161). {tk: esito di deposito_oltre_la_tabella}."""
    import schede_progetto
    sec = ((((d or {}).get("macro") or {}).get("sec_calendario")) or {}).get("per_titolo") or {}
    out = {}
    for r in _righe(d):
        tk = r["ticker"]
        cand = [str((sec.get(tk) or {}).get("ultimo_deposito") or "")[:10]] + list(((periodici or {}).get(tk) or {}).values())
        cand = [c for c in cand if len(c) == 10]
        if not cand:
            continue
        f = schede_progetto.deposito_oltre_la_tabella(r, {"ultimo_deposito": max(cand)})
        if f:
            out[tk] = f
    return out


def mercato_qqq():
    """QQQ con le sue date, dallo stesso canale 'mercato' della pipeline (update_data.canali_macro)."""
    m = (_ud().canali_macro() or {}).get("mercato")
    if m and m[2] is not None and len(m[2]):
        return {d.strftime("%Y-%m-%d"): float(v) for d, v in m[2].items() if v == v}
    return None


def date_cds_pipeline(d):
    """({tk: giorno del CDS della pipeline}, {famiglia: giorno dell'indice}) — None dove la pipeline non quota."""
    nomi = {r["ticker"]: ((r.get("cds") or {}).get("data") if (r.get("cds") or {}).get("stato") == "quotato" else None)
            for r in _righe(d)}
    ind = {f: v.get("data") for f, v in ((((d or {}).get("macro") or {}).get("cds") or {}).get("indici") or {}).items()}
    return nomi, ind


def cds_piu_recenti(lettura, d, mappa):
    """(nomi, indici) per cui ICE porta adesso un giorno PIU' RECENTE di quello della pipeline. Un nome che la pipeline
    non quotava e ICE oggi si' e' piu' recente per definizione."""
    pn, pi = date_cds_pipeline(d)
    ent = (lettura or {}).get("entita") or {}
    nomi = []
    for tk, cod in ((mappa or {}).get("entita") or {}).items():
        if cod is None or tk not in pn:
            continue
        g = (ent.get(cod) or {}).get("data")
        if g and (pn[tk] is None or g > pn[tk]):
            nomi.append(tk)
    indici = sorted(f for f, v in ((lettura or {}).get("indici") or {}).items()
                    if v.get("data") and (pi.get(f) is None or v["data"] > pi[f]))
    return sorted(nomi), indici


def conserva_giorni_cds(lettura, tasso, storia_repo, percorso=CDS_SESSIONE, giorni=CDS_SESSIONE_GIORNI):
    """I giorni di ICE che lo storico del repo non ha (o ha a meta') si scrivono in memoria/cds_sessione.jsonl, che la
    pipeline unisce al proprio storico al run successivo (update_data.aggiorna_cds): un giorno letto qui e non
    conservato sarebbe perso — ICE non lo ripubblica. Restituisce i giorni scritti ([] se non c'era niente di nuovo)."""
    ud = _ud()
    righe = ud.righe_storia_cds(lettura, tasso)
    _, es = ud.unisci_storia_cds(copy.deepcopy(storia_repo or []), copy.deepcopy(righe), inserisci_vecchi=True)
    utili = set(es["nuove"]) | set(es["completate"]) | set(es.get("inseriti") or [])
    if not utili:
        return []
    righe = [{**r, "origine": "sessione d'analisi (scripts/fonti_titoli.py)"} for r in righe if r["d"] in utili]
    sess = ud.leggi_storia_cds(Path(percorso))
    sess, es2 = ud.unisci_storia_cds(sess, righe, massimo=giorni, inserisci_vecchi=True)
    if es2["cambiato"]:
        ud.scrivi_storia_cds(sess, Path(percorso))
    return sorted(utili)


def leggi_cds(d, fedwatch, lettura=None, rendimenti=None, mercato=None, get=None, percorso_sessione=CDS_SESSIONE):
    """{'esito', 'ice', 'nuovi', 'indici_nuovi', 'macro', 'per_titolo', 'conservati', 'errore'}.
    esito: «rifatto» (ICE piu' avanti della pipeline: misure rifatte) · «stesso giorno» · «non letto»."""
    ud = _ud()
    cache = {}

    def cget(u):
        if u not in cache:
            cache[u] = (get or (lambda x: ud.http_get(x, tries=2, timeout=40)))(u)
        return cache[u]
    out = {"esito": "non letto", "ice": None, "nuovi": [], "indici_nuovi": [], "macro": None, "per_titolo": {},
           "conservati": [], "errore": None}
    try:
        lettura = lettura or ud.leggi_cds_ice(cget)
    except Exception as e:  # noqa: BLE001
        out["errore"] = f"{type(e).__name__}: {str(e)[:120]}"
        return out
    if not (lettura or {}).get("data"):
        out["errore"] = "ICE ha risposto senza prezzi"
        return out
    out["ice"] = {"data": lettura["data"], "date": dict(lettura.get("date") or {})}
    try:
        mappa = json.loads(Path(ud.CDS_ENTITA).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        mappa = {}
    out["nuovi"], out["indici_nuovi"] = cds_piu_recenti(lettura, d, mappa)
    macro = {"fedwatch": fedwatch or (((d or {}).get("macro") or {}).get("fedwatch")) or {}}
    storia = ud.leggi_storia_cds(ud.CDS_STORIA)
    tasso, _ = ud.tasso_cds(macro, storia)
    try:
        out["conservati"] = conserva_giorni_cds(lettura, tasso, storia, percorso_sessione)
    except Exception as e:  # noqa: BLE001 — conservare e' un di piu': il suo guasto si dice, non porta via il giro
        out["errore_conservazione"] = f"{type(e).__name__}: {str(e)[:120]}"
    if not out["nuovi"] and not out["indici_nuovi"]:
        out["esito"] = "stesso giorno"
        return out
    # le letture costose si fanno solo qui, quando ICE e' davvero piu' avanti: rendimenti e mercato possono arrivare
    #   come funzioni da chiamare
    rendimenti = rendimenti() if callable(rendimenti) else rendimenti
    mercato = mercato() if callable(mercato) else mercato
    righe = copy.deepcopy(_righe(d))
    for r in righe:
        rd = (rendimenti or {}).get(r["ticker"])
        if rd:
            r["_ret_series"], r["_ret_dates"] = rd
    STORIA_COPIA.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ud.CDS_STORIA, STORIA_COPIA)
    with contextlib.redirect_stdout(io.StringIO()):
        m = ud.aggiorna_cds(righe, macro, get=cget, percorso_storia=STORIA_COPIA, mercato=mercato,
                            percorso_sessione=percorso_sessione)
    out["macro"] = m
    out["per_titolo"] = {r["ticker"]: r["cds"] for r in righe if "cds" in r}
    out["esito"] = "rifatto"
    return out


def leggi_short(d, rendimenti_di_fn=None, post=None, get=None, oggi=None):
    """{'esito', 'regolamento', 'prossimo', 'macro', 'per_titolo', 'errore'}. Una richiesta per sapere quale regolamento
    FINRA porta adesso; solo se e' piu' recente di quello della pipeline le misure si rifanno (coi rendimenti letti
    adesso). esito: «rifatto» · «stesso regolamento» · «non letto»."""
    ud = _ud()
    pipe = (((d or {}).get("macro") or {}).get("short_interest") or {})
    righe = [r for r in copy.deepcopy(_righe(d)) if not _riferimento(r["ticker"])]
    out = {"esito": "non letto", "regolamento": None, "prossimo": None, "pubblicato": None, "macro": None,
           "per_titolo": {}, "errore": None, "calendario": None}
    with contextlib.redirect_stdout(io.StringIO()):
        m = ud.aggiorna_short(copy.deepcopy(righe), None, post=post, get=get, oggi=oggi)
    out.update(regolamento=m.get("regolamento"), prossimo=m.get("prossimo"), pubblicato=m.get("pubblicato"),
               calendario=m.get("calendario"))
    if not m.get("letto"):
        out["errore"] = m.get("errore") or "FINRA non ha risposto"
        return out
    if not m.get("regolamento") or (pipe.get("regolamento") and m["regolamento"] <= pipe["regolamento"]):
        out["esito"] = "stesso regolamento"
        return out
    rend = (rendimenti_di_fn or rendimenti_di)([r["ticker"] for r in righe])
    for r in righe:
        if rend.get(r["ticker"]):
            r["_ret_series"], r["_ret_dates"] = rend[r["ticker"]]
    prec = {r["ticker"]: r.get("short_interest") for r in _righe(d) if r.get("short_interest")}
    with contextlib.redirect_stdout(io.StringIO()):
        m2 = ud.aggiorna_short(righe, prec, post=post, get=get, oggi=oggi)
    out["macro"] = m2
    out["per_titolo"] = {r["ticker"]: r["short_interest"] for r in righe if "short_interest" in r}
    out["esito"] = "rifatto"
    return out


def leggi_alla_fonte(d, nomi):
    """Il giro: le cinque letture in parallelo (CDS dopo FedWatch, che ne da' il tasso). Non solleva mai."""
    t0 = time.time()
    g = {k: {"esito": "non letto"} for k in BLOCCHI}
    ud = _ud()

    def fw():
        return ud.fedwatch_da()
    with ThreadPoolExecutor(4) as ex:
        f_an = ex.submit(leggi_analisti, nomi)
        f_fw = ex.submit(fw)
        f_sec = ex.submit(leggi_sec, nomi)
        f_si = ex.submit(leggi_short, d)
        try:
            an = f_an.result()
            g["analisti"] = {"esito": "letto", "per_titolo": {k: v for k, v in an.items() if v},
                             "vuoti": sorted(k for k, v in an.items() if not v)}
        except Exception as e:  # noqa: BLE001
            g["analisti"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            g["fedwatch"] = {"esito": "letto", "valore": f_fw.result()}
        except Exception as e:  # noqa: BLE001
            g["fedwatch"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            sec = f_sec.result()
            g["sec"] = {"esito": "letto", "per_titolo": {k: v for k, v in sec.items() if v is not None},
                        "non_letti": sorted(k for k, v in sec.items() if v is None)}
        except Exception as e:  # noqa: BLE001
            g["sec"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            g["short"] = f_si.result()
        except Exception as e:  # noqa: BLE001
            g["short"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    try:
        _fe = ferme(d, (g["sec"] or {}).get("per_titolo"))
        _fe = {k: v for k, v in _fe.items() if k in set(nomi)}
        _nq = leggi_trimestri(sorted(_fe)) if _fe else {}
        righe_d = {r["ticker"]: r for r in _righe(d)}
        g["trimestri"] = {"esito": "letto", "ferme": _fe,
                          "per_titolo": {tk: completa_trimestri(((righe_d.get(tk) or {}).get("tv") or {}).get("conto_trim"),
                                                                _nq.get(tk))
                                         for tk in sorted(_fe)},
                          "non_letti": sorted(tk for tk in _fe if not _nq.get(tk))}
    except Exception as e:  # noqa: BLE001
        g["trimestri"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    try:
        mappa = json.loads(Path(ud.CDS_ENTITA).read_text(encoding="utf-8"))
        quotabili = [tk for tk, c in (mappa.get("entita") or {}).items() if c]

        def rend_cds():
            return rendimenti_di([r["ticker"] for r in _righe(d) if r["ticker"] in quotabili])
        g["cds"] = leggi_cds(d, (g["fedwatch"] or {}).get("valore"), rendimenti=rend_cds, mercato=mercato_qqq)
    except Exception as e:  # noqa: BLE001
        g["cds"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    g["secondi"] = round(time.time() - t0, 1)
    return _jsonabile(g)


def _jsonabile(x):
    return json.loads(json.dumps(x, default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o)))


# ══════════════════════════════════ LA LETTURA DEL GIRO E LA SOVRAPPOSIZIONE ════════════════════════════════════
def _carica_pipeline():
    try:
        return json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    except (OSError, ValueError):
        return None


def leggi(forza=False, percorso=None, max_minuti=VALIDITA_MINUTI, adesso=None, d=None, nomi=None):
    """La lettura del giro, riusata se scritta da meno di `max_minuti`; altrimenti si legge alla fonte e si scrive."""
    p = Path(percorso) if percorso else CACHE
    ora = adesso or datetime.now(timezone.utc)
    if not forza:
        c = dal_disco(p, max_minuti, ora)
        if c:
            return c
    d = _carica_pipeline() if d is None else d
    if nomi is None:
        a, b = nomi_libro()
        nomi = a + b
    g = leggi_alla_fonte(d, nomi)
    g["letto"] = ora.isoformat()
    g["run"] = (d or {}).get("updated_at")
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as e:
        g["errore_scrittura"] = f"lettura non salvata ({e}): gli altri strumenti useranno la pipeline"
    return g


def dal_disco(percorso=None, max_minuti=VALIDITA_MINUTI, adesso=None):
    """La lettura del giro dal disco se valida, altrimenti None. Non legge MAI la rete: chi carica data.json la usa se
    c'e' (scripts/analisi.py la fa scrivere prima di tutti), e se non c'e' resta sulla pipeline e lo dice."""
    p = Path(percorso) if percorso else CACHE
    ora = adesso or datetime.now(timezone.utc)
    try:
        c = json.loads(p.read_text(encoding="utf-8"))
        t = datetime.fromisoformat(c["letto"])
        if timedelta(0) <= ora - t <= timedelta(minutes=max_minuti):
            return c
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def sovrapponi(d, giro):
    """Una copia di data.json con la lettura di adesso al posto della pipeline, blocco per blocco, dove e' piu'
    recente. macro._fonti_titoli dice quale ha vinto per ciascun blocco: chi stampa lo dichiara."""
    if not d:
        return d
    out = copy.deepcopy(d)
    m = out.setdefault("macro", {})
    esiti = {}
    if not giro:
        m["_fonti_titoli"] = {"letto": None, "esiti": {k: "pipeline (nessuna lettura alla fonte in questo giro)"
                                                        for k in BLOCCHI}}
        return out
    an = giro.get("analisti") or {}
    sec = giro.get("sec") or {}
    cds = giro.get("cds") or {}
    si = giro.get("short") or {}
    rifatti_an, completati = [], []
    for r in _righe(out):
        tk = r["ticker"]
        v = (an.get("per_titolo") or {}).get(tk)
        if v:
            r["analisti"] = v
            rifatti_an.append(tk)
        if cds.get("esito") == "rifatto" and tk in (cds.get("per_titolo") or {}):
            r["cds"] = cds["per_titolo"][tk]
        if si.get("esito") == "rifatto" and tk in (si.get("per_titolo") or {}):
            r["short_interest"] = si["per_titolo"][tk]
        if tk in (sec.get("per_titolo") or {}):
            r["_periodici"] = sec["per_titolo"][tk]
        nq = ((giro.get("trimestri") or {}).get("per_titolo") or {}).get(tk) or {}
        if nq.get("nuovi"):
            tv = r.setdefault("tv", {})
            tv["conto_trim"] = sorted(list(nq["nuovi"]) + list(tv.get("conto_trim") or []),
                                      key=lambda x: str(x.get("trim")), reverse=True)
            completati.append(tk)
    esiti["analisti"] = (f"fonte per {len(rifatti_an)} titoli" if rifatti_an else
                         "pipeline (" + (an.get("errore") or "nessun titolo letto alla fonte") + ")")
    fw = (giro.get("fedwatch") or {}).get("valore")
    if fw:
        m["fedwatch"] = fw
        esiti["fedwatch"] = "fonte"
    else:
        esiti["fedwatch"] = "pipeline (" + ((giro.get("fedwatch") or {}).get("errore") or "non letto") + ")"
    if cds.get("esito") == "rifatto" and cds.get("macro"):
        m["cds"] = cds["macro"]
        esiti["cds"] = "fonte (ICE piu' avanti della pipeline)"
    else:
        esiti["cds"] = "pipeline (" + (cds.get("esito") or "non letto") + ")"
    if si.get("esito") == "rifatto" and si.get("macro"):
        m["short_interest"] = si["macro"]
        esiti["short"] = "fonte (FINRA piu' avanti della pipeline)"
    else:
        esiti["short"] = "pipeline (" + (si.get("esito") or "non letto") + ")"
    esiti["sec"] = "date dei depositi dalla fonte" if sec.get("esito") == "letto" else "solo la pipeline"
    esiti["trimestri"] = (f"Nasdaq per {', '.join(completati)} (verificato sul trimestre in comune)" if completati
                          else "pipeline")
    m["_fonti_titoli"] = {"letto": giro.get("letto"), "esiti": esiti}
    return out


def carica(d=None, percorso=None, adesso=None):
    """data.json con la lettura del giro sovrapposta, se c'e' (mai la rete). Con TRADING_FONTI_TITOLI=spenta resta la
    pipeline: le suite non devono dipendere da una lettura scritta da un'analisi di mezz'ora prima."""
    d = _carica_pipeline() if d is None else d
    if d is None or os.environ.get(SPENTA) == "spenta":
        return d
    return sovrapponi(d, dal_disco(percorso, adesso=adesso))


# ══════════════════════════════════ LA RESA ══════════════════════════════════════════════════════════════════════
def _n(x, dec=2):
    return f"{x:.{dec}f}".replace(".", ",").replace("-", "−") if isinstance(x, (int, float)) else "n.d."


def _data_it(g):
    g = str(g or "")[:10]
    return f"{g[8:10]}/{g[5:7]}/{g[0:4]}" if len(g) == 10 else "n.d."


def future_aperti(adesso=None):
    """Se i future CME quotano adesso: domenica dalle 18:00 a venerdi' alle 17:00 di New York, pausa 17-18 ogni giorno.
    Le festivita' CME non sono note al calcolo: in quei giorni la riga dice «aperti» e il prezzo e' quello di prima."""
    ny = (adesso or datetime.now(timezone.utc)).astimezone(NEW_YORK)
    g, h = ny.weekday(), ny.hour
    if g == 5 or (g == 6 and h < 18) or (g == 4 and h >= 17):
        return False
    return h != 17


def cambi_analisti(pipe, fonte):
    """Le differenze fra il consenso della pipeline e quello letto adesso, sulle grandezze che l'analisi legge."""
    out = []
    for k, nome, dec in (("eps_ora", "utile atteso", 2), ("target_mediana", "target mediano", 2),
                         ("su_30g", "rialzi a 30 g", 0), ("giu_30g", "tagli a 30 g", 0)):
        a, b = (pipe or {}).get(k), (fonte or {}).get(k)
        if a != b:
            out.append(f"{nome} {_n(a, dec)} → {_n(b, dec)}")
    return out


def riga_riunione(v):
    if not v.get("prezzata_dal_contratto"):
        return f"{_data_it(v.get('riunione') or v.get('date'))}: non prezzata ({v.get('motivo') or 'contratto non letto'})"
    rami = []
    if v.get("hike_prob") is not None:
        rami.append(f"RIALZO {v['hike_prob']}%")
    if v.get("cut_prob") is not None:
        rami.append(f"TAGLIO {v['cut_prob']}%")
    if v.get("hold_prob") is not None:
        rami.append(f"invariato {v['hold_prob']}%")
    m = v.get("mosse_25bp")
    s = f"{_data_it(v.get('riunione') or v.get('date'))}: {'+' if (m or 0) > 0 else ''}{_n(m)} movimenti da 25 pb"
    if v.get("mosse_cumulate") is not None and v.get("mosse_cumulate") != m:
        s += f" ({'+' if v['mosse_cumulate'] > 0 else ''}{_n(v['mosse_cumulate'])} cumulati da oggi)"
    return s + (f" — {' · '.join(rami)}" if rami else " — sopra il movimento intero non e' una probabilita'")


def sintesi(d, giro, adesso=None):
    """Il blocco DATI PER TITOLO: per ciascuno la fonte che ha vinto, il confronto con la pipeline, e cosa cercare in
    rete perche' nemmeno la fonte e' aggiornata."""
    ora = adesso or datetime.now(timezone.utc)
    L = ["DATI PER TITOLO — LA PIPELINE E LA FONTE LETTA ADESSO (v512)"]
    run = (d or {}).get("updated_at")
    eta = None
    if run:
        try:
            eta = (ora - datetime.fromisoformat(str(run).replace("Z", "+00:00"))).total_seconds() / 3600
        except ValueError:
            pass
    letto = (giro or {}).get("letto")
    L.append(f"  run della pipeline {run or 'n.d.'}" + (f" ({_n(eta, 1)} ore fa)" if eta is not None else "")
             + (f" · lettura alla fonte {datetime.fromisoformat(letto).astimezone(ROMA):%d/%m %H:%M} ora italiana"
                f" ({_n((giro or {}).get('secondi'), 1)} s)" if letto else " · NESSUNA lettura alla fonte in questo giro"))
    L.append("  OGNI QUANTO CAMBIANO:")
    for _k, nome, testo in CADENZE:
        L.append(f"    · {nome}: {testo}")
    L.append("    · " + CADENZA_PIPELINE)
    cercare = []
    righe = {r["ticker"]: r for r in _righe(d)}
    g = giro or {}
    # analisti
    an = g.get("analisti") or {}
    if an.get("esito") == "letto":
        pt = an.get("per_titolo") or {}
        cambiati = []
        for tk, v in sorted(pt.items()):
            c = cambi_analisti((righe.get(tk) or {}).get("analisti"), v)
            if c:
                cambiati.append(f"{tk} ({'; '.join(c)})")
        vuoti = an.get("vuoti") or []
        tenuti = [t for t in vuoti if (righe.get(t) or {}).get("analisti")]
        L.append(f"  · ANALISTI: letti adesso per {len(pt)} titoli; rispetto al run della pipeline "
                 + (f"CAMBIATI in {len(cambiati)}: " + ", ".join(cambiati) if cambiati else "nessuna differenza")
                 + (f" · Yahoo non restituisce niente per {', '.join(vuoti)}"
                    + (f" (vale la pipeline per {', '.join(tenuti)}, dichiarato)" if tenuti else "") if vuoti else ""))
    else:
        L.append(f"  · ANALISTI: NON letti alla fonte ({an.get('errore') or 'n.d.'}): valgono quelli del run della "
                 "pipeline")
        cercare.append("consenso e target dei nomi in esame: la fonte non ha risposto")
    # fedwatch
    fw = g.get("fedwatch") or {}
    pfw = ((d or {}).get("macro") or {}).get("fedwatch") or {}
    if fw.get("esito") == "letto" and fw.get("valore"):
        v = fw["valore"]
        ef = v.get("effr") or {}
        L.append(f"  · FEDWATCH: dai contratti letti adesso"
                 + ("" if future_aperti(ora) else " — mercato dei future CHIUSO: sono le quotazioni dell'ultima seduta")
                 + f"; EFFR {_n(ef.get('valore'))}% del {_data_it(ef.get('data'))} ({ef.get('fonte') or 'n.d.'})"
                 + f" · fascia {v.get('target_range') or 'n.d.'}")
        prec = {x.get("riunione") or x.get("date"): x for x in (pfw.get("meetings") or [])}
        for x in (v.get("meetings") or [])[:4]:
            p = prec.get(x.get("riunione") or x.get("date"))
            dif = ""
            if p and p.get("mosse_25bp") != x.get("mosse_25bp"):
                dif = f" (nel run della pipeline: {_n(p.get('mosse_25bp'))})"
            L.append("      " + riga_riunione(x) + dif)
    else:
        L.append(f"  · FEDWATCH: NON letto alla fonte ({fw.get('errore') or 'n.d.'}): vale il run della pipeline")
        cercare.append("le probabilita' della prossima riunione Fed (CME FedWatch, mercati di previsione)")
    # cds
    cd = g.get("cds") or {}
    pcd = ((d or {}).get("macro") or {}).get("cds") or {}
    if cd.get("esito") in ("rifatto", "stesso giorno"):
        ice = cd.get("ice") or {}
        dd = ", ".join(f"{k}: {n}" for k, n in sorted((ice.get("date") or {}).items()))
        s = f"  · CDS (ICE): ultimo giorno {ice.get('data')} ({dd} entita')"
        if cd["esito"] == "rifatto":
            s += (f"; la pipeline era INDIETRO per {', '.join(cd.get('nuovi') or []) or 'nessun nome'}"
                  + (f" e per gli indici {', '.join(cd['indici_nuovi'])}" if cd.get("indici_nuovi") else "")
                  + ": misure rifatte sul giorno nuovo con le funzioni della pipeline")
        else:
            ind = ", ".join(f"{k} {v.get('data')}" for k, v in sorted((pcd.get("indici") or {}).items()))
            s += f"; la pipeline ha gli stessi giorni (indici CDX: {ind or 'n.d.'})"
        if cd.get("conservati"):
            s += (f" · giorni che lo storico del repo non ha, conservati in memoria/cds_sessione.jsonl per la pipeline: "
                  f"{', '.join(cd['conservati'])}")
        L.append(s)
    else:
        L.append(f"  · CDS (ICE): NON letto ({cd.get('errore') or 'n.d.'}): valgono il giorno e lo storico della "
                 f"pipeline ({pcd.get('data') or 'n.d.'})")
    L.append("    lo storico dei CDS non ha una fonte alternativa (ICE pubblica solo l'ultimo giorno, DTCC risponde 403 "
             "anche dai runner di GitHub: v498): lo raccoglie la pipeline, e un giorno in cui non gira la sera lo "
             "raccoglie questa lettura")
    # short
    si = g.get("short") or {}
    psi = ((d or {}).get("macro") or {}).get("short_interest") or {}
    pros = si.get("prossimo") or psi.get("prossimo") or {}
    if si.get("esito") in ("rifatto", "stesso regolamento"):
        s = (f"  · VENDITE ALLO SCOPERTO (FINRA): regolamento {si.get('regolamento')}"
             + (f", pubblicato il {_data_it(si.get('pubblicato'))}" if si.get("pubblicato") else ""))
        s += ("; la pipeline aveva quello del " + str(psi.get("regolamento")) + ": misure rifatte"
              if si["esito"] == "rifatto" else "; la pipeline ha lo stesso")
        if pros.get("pubblicazione"):
            s += f" · prossimo: regolamento {pros.get('regolamento')}, pubblicazione {_data_it(pros['pubblicazione'])}"
            oggi_ny = ora.astimezone(NEW_YORK).date().isoformat()
            if pros["pubblicazione"] < oggi_ny and si["esito"] != "rifatto":
                cercare.append(f"vendite allo scoperto: il calendario di FINRA dava il regolamento {pros.get('regolamento')} "
                               f"pubblicato il {_data_it(pros['pubblicazione'])}, e l'API porta ancora quello del "
                               f"{si.get('regolamento')}")
        L.append(s)
    else:
        L.append(f"  · VENDITE ALLO SCOPERTO (FINRA): NON lette ({si.get('errore') or 'n.d.'}): vale il regolamento "
                 f"della pipeline ({psi.get('regolamento') or 'n.d.'})")
    # sec e trimestri
    L.extend(righe_sec(d, g.get("sec") or {}, cercare, g.get("trimestri") or {}))
    L.append("  DA CERCARE IN RETE — dove nemmeno la fonte e' aggiornata o raggiungibile (con fonte e data):")
    L.extend(["    · " + c for c in cercare] or ["    · niente: le fonti lette adesso sono allineate o piu' avanti "
                                                  "della pipeline"])
    return "\n".join(L)


def righe_sec(d, sec, cercare, trim=None):
    """I depositi periodici (10-Q, 10-K) piu' recenti della lettura del debito della pipeline, e le tabelle dei
    trimestri ferme prima di un deposito di risultati — con il trimestre ritrovato da Nasdaq dove le due fonti
    coincidono sul trimestre in comune: fatti, coi loro giorni."""
    import schede_progetto
    if sec.get("esito") != "letto":
        return [f"  · DEPOSITI SEC: date NON lette ({sec.get('errore') or 'n.d.'}): restano quelle della pipeline"]
    ds = ((((d or {}).get("macro") or {}).get("debito_sec")) or {}).get("per_titolo") or {}
    righe = {r["ticker"]: r for r in _righe(d)}
    dietro, ferme_l, ritrovati = [], [], []
    for tk, per in sorted((sec.get("per_titolo") or {}).items()):
        if not per:
            continue
        ultimo = max(per.items(), key=lambda kv: kv[1])
        lett = ((ds.get(tk) or {}).get("deposito") or {})
        if tk in ds and lett.get("data") and ultimo[1] > lett["data"]:
            dietro.append(f"{tk} ({ultimo[0]} del {_data_it(ultimo[1])}; il sistema ha letto il {lett.get('forma')} del "
                          f"{_data_it(lett['data'])})")
    for tk, f in sorted(((trim or {}).get("ferme") or {}).items()):
        nq = ((trim or {}).get("per_titolo") or {}).get(tk) or {}
        base = f"{tk} (conti al {_data_it(f['trim'])}, risultati depositati il {_data_it(f['dep'])}, {f['gg']} giorni dopo"
        if nq.get("nuovi"):
            ritrovati.append(base + f"; da Nasdaq il trimestre al {_data_it(nq['nuovi'][0]['trim'])}, verificato sul "
                             f"{_data_it(nq.get('comune'))}" + ("" if (nq.get("voci") or {}).get("utile") else
                                                                ", senza l'utile: le due fonti lo definiscono diversamente")
                             + ")")
        else:
            ferme_l.append(base + f"; Nasdaq: {nq.get('esito') or 'non letto'})")
    L = [f"  · DEPOSITI SEC (date dei 10-Q e 10-K da Yahoo): {len(sec.get('per_titolo') or {})} titoli letti"
         + (f", non letti {', '.join(sec['non_letti'])}" if sec.get("non_letti") else "")]
    if dietro:
        L.append("      ⚠ un bilancio periodico PIU' RECENTE di quello da cui il sistema legge debito, scadenze e "
                 "derivati: " + ", ".join(dietro) + " — quelle voci sono del bilancio precedente (SEC non risponde da "
                 "qui: le rilegge la pipeline, al piu' dieci per run)")
        cercare.append("debito e scadenze dei nomi col bilancio nuovo non ancora letto: " + ", ".join(dietro))
    if ritrovati:
        L.append("      ⚠ tabella dei trimestri della pipeline FERMA (Yahoo non porta ancora l'ultimo trimestre), "
                 "COMPLETATA da Nasdaq: " + ", ".join(ritrovati) + " — ricavi e risultato operativo del trimestre nuovo "
                 "entrano nelle schede e nella tenuta dichiarando la fonte; cassa, debito e Altman restano del bilancio "
                 "precedente, ciascuno con la sua data")
    if ferme_l:
        L.append(f"      ⚠ tabella dei trimestri FERMA (risultati depositati oltre {schede_progetto.GIORNI_DEPOSITO_OLTRE} "
                 "giorni dopo l'ultimo trimestre della tabella) e NON completata: " + ", ".join(ferme_l)
                 + " — ricavi e utili di quei nomi sono di un trimestre prima")
        cercare.append("i conti dell'ultimo trimestre (comunicato o 10-Q) di " + ", ".join(x.split(" ")[0] for x in ferme_l))
    if not dietro and not ritrovati and not ferme_l:
        L.append("      nessun bilancio periodico piu' recente di quelli letti dal sistema")
    return L


def main():
    d = _carica_pipeline()
    if d is None:
        print("DATI PER TITOLO — data/data.json NON leggibile: nessun confronto possibile, dato non disponibile")
        sys.exit(1)
    giro = leggi(d=d)
    print(sintesi(d, giro))


if __name__ == "__main__":
    main()
