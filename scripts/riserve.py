#!/usr/bin/env python3
"""v542 — LE RISERVE: nessuna famiglia di dati dipende da un solo fornitore.

Il 10/11/2026 Nasdaq ha risposto 403 alle letture della sessione: il calendario dei conti, le notizie per titolo e
l'ultima trimestrale sono usciti «NON letti» proprio la sera dei conti di CRWV. Macro, tecnica, fondamentali, opzioni e
credito erano letti: mancava una SECONDA strada per le tre letture che avevano una fonte sola. Il CEO, 10/11/2026:
*"Trova soluzione per acquisire dati … aggiornati ogni volta che chiedo analisi … e in forma gratuita."*

Un rifiuto non si aggira (niente travestimenti delle richieste): si passa a un'ALTRA fonte, e lo si dice. Le catene:

  NOTIZIE PER TITOLO   feed per simbolo di Nasdaq → feed per simbolo di Yahoo Finance (gli stessi due della pipeline) →
                       riserva: le notizie per titolo lette dalla pipeline su GitHub (altri indirizzi, col suo orario) e
                       Google News cercato per NOME della societa' (dichiarato: e' una ricerca, non un feed per
                       simbolo; entra solo il titolo che porta il nome o il ticker — v399)
  CALENDARIO DEI CONTI calendario Nasdaq letto qui → l'ULTIMA LETTURA RIUSCITA, datata (memoria/riserva_conti.json) →
                       la data di Yahoo (yfinance, dalle righe dei titoli), dichiarata STIMA e solo nei giorni che
                       Nasdaq non ha dato; le date dichiarate dall'emittente (LIBRO.md §1octies) restano sopra tutto
  ULTIMA TRIMESTRALE   Nasdaq letto qui → la piu' recente fra l'ultima lettura riuscita e il deposito dei risultati
                       su SEC EDGAR (8-K con item 2.02: fonte ufficiale e gratuita, solo la data)

L'11/11/2026 la prova ha detto due cose: Nasdaq rifiuta questo lettore anche dai runner di GitHub (la riserva dei conti
pubblicata dalla pipeline e' arrivata vuota, ed e' stata tolta), e il connettore FMP del piano gratuito copre 4 dei 14
nomi del libro. Per questo le riserve del calendario sono la memoria, Yahoo e SEC EDGAR, non un altro indirizzo.

Ogni voce dice chi l'ha servita; i giorni che NESSUNA fonte ha letto restano «NON letti» (v389, v406). Nessuna soglia:
una riserva porta sempre la sua data, e la legge chi decide. Le suite non leggono e non scrivono le riserve
(TRADING_FONTI_TITOLI=spenta), salvo quando un gate passa dati e percorso suoi.
"""
import fcntl
import json
import os
import re
import sys
import threading
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RADICE = Path(__file__).resolve().parent.parent
MEMORIA = RADICE / "memoria" / "riserva_conti.json"
DATI = RADICE / "data" / "data.json"
ROMA = ZoneInfo("Europe/Rome")
CAMPI = ("tk", "data", "quando", "eps_atteso", "trimestre")
NASDAQ = "calendario Nasdaq"
_serratura = threading.Lock()
_carico = threading.Lock()
_dati_cache = {}

# i nomi che una ricerca per nome non distingue: il nome breve e' una parola comune, o il titolo si cerca con un altro nome
ALIAS = {"MSTR": ("MicroStrategy", "MSTR", "Strategy Inc"), "GOOGL": ("Alphabet", "Google")}
_SUFFISSO = re.compile(r"[,\s]+(Inc|Incorporated|Corporation|Corp|Company|Co|Holdings?|Technology|Technologies|Group|plc|"
                       r"Ltd|Limited|N\.V|S\.A|SE|AG|Platforms|Class [A-C])\.?$", re.I)


def attive():
    return os.environ.get("TRADING_FONTI_TITOLI") != "spenta"


def orario(iso):
    """«10/11 21:08» ora italiana, da un ISO in UTC; None se non si legge."""
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(ROMA).strftime("%d/%m %H:%M")


def leggi_dati(dati=None, p=None):
    """data/data.json (la pipeline) con le righe e i depositi SEC riletti in questo giro, una volta per processo; {}
    se non si legge.
    ⚠ v542 — SI CARICA SOTTO SERRATURA, UN THREAD ALLA VOLTA, E L'USCITA SI RIMETTE AL SUO POSTO. Le notizie si
    leggono in piu' thread, e fonti_titoli.carica zittisce l'uscita con redirect_stdout, che non e' fatto per i
    thread: due ingressi intrecciati lasciano sys.stdout puntato su un testo in memoria PER SEMPRE. L'11/11/2026 il
    brief e' uscito 0 con l'uscita VUOTA dentro l'analisi: tre richieste della scheda risultavano assenti."""
    if dati is not None:
        return dati
    p = Path(p or DATI)
    try:
        chiave = (str(p), p.stat().st_mtime)
    except OSError:
        return {}
    with _carico:
        if chiave not in _dati_cache:
            try:
                d = json.loads(p.read_text(encoding="utf-8").replace("NaN", "null"))
            except (OSError, ValueError):
                return {}
            uscite = sys.stdout, sys.stderr
            try:                       # le righe e i depositi SEC riletti in questo giro, se ci sono (fonti_titoli)
                import fonti_titoli
                d = fonti_titoli.carica(d)
            except Exception:  # noqa: BLE001
                pass
            finally:
                sys.stdout, sys.stderr = uscite
            _dati_cache.clear()
            _dati_cache[chiave] = d
        return _dati_cache[chiave]


# ── la memoria dell'ultima lettura riuscita ────────────────────────────────────────────────────────────────────────
def leggi_memoria(p=None):
    try:
        m = json.loads(Path(p or MEMORIA).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        m = {}
    return {"calendario": dict(m.get("calendario") or {}), "ultime": dict(m.get("ultime") or {})}


def _aggiorna(fn, p=None):
    """Leggi-modifica-scrivi sotto serratura: quattro strumenti del giro leggono il calendario in parallelo."""
    p = Path(p or MEMORIA)
    p.parent.mkdir(parents=True, exist_ok=True)
    # la serratura della memoria vera sta in memoria/dati (fuori da git): accanto al file sarebbe un file da committare
    serratura = (RADICE / "memoria" / "dati" / "riserva_conti.lock") if p == MEMORIA else Path(str(p) + ".lock")
    serratura.parent.mkdir(parents=True, exist_ok=True)
    with _serratura, open(serratura, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        m = leggi_memoria(p)
        prima = json.dumps(m, sort_keys=True)
        fn(m)
        if json.dumps(m, sort_keys=True) != prima:
            tmp = Path(str(p) + ".tmp")
            tmp.write_text(json.dumps(m, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
            os.replace(tmp, p)


def ricorda_calendario(giorni_letti, voci, cercati, letto_il, via, p=None):
    """Una lettura riuscita entra in memoria: le voci trovate, e — per i nomi cercati — spariscono quelle che la fonte
    non dichiara piu' nel giorno che ha letto (una data spostata non resta in memoria). Vince la lettura piu' recente."""
    giorni_letti, cercati = set(giorni_letti), set(cercati)

    def fn(m):
        cal = m["calendario"]
        trovati = {(v["tk"], v["data"]) for v in voci}
        for tk, e in list(cal.items()):
            if (tk in cercati and e.get("data") in giorni_letti and (tk, e["data"]) not in trovati
                    and str(e.get("letto_il", "")) <= letto_il):
                del cal[tk]
        for v in voci:
            if v["tk"] in cercati and str((cal.get(v["tk"]) or {}).get("letto_il", "")) <= letto_il:
                cal[v["tk"]] = {**{k: v.get(k) for k in CAMPI}, "letto_il": letto_il, "via": via}
    _aggiorna(fn, p)


def ricorda_ultime(esiti, letto_il, via, p=None):
    buoni = {tk: v for tk, v in (esiti or {}).items() if isinstance(v, dict) and v.get("stato") == "ok"}
    if not buoni:
        return

    def fn(m):
        for tk, v in buoni.items():
            if str((m["ultime"].get(tk) or {}).get("letto_il", "")) <= letto_il:
                m["ultime"][tk] = {**{k: x for k, x in v.items() if k != "fonte"}, "letto_il": letto_il, "via": via}
    _aggiorna(fn, p)


# ── il calendario dei conti ────────────────────────────────────────────────────────────────────────────────────────
def _voce(e, oggi, fonte, **altro):
    g = (datetime.fromisoformat(e["data"]).date() - oggi).days
    return {**{k: e.get(k) for k in CAMPI}, "quando": e.get("quando") or "", "giorni": g, "fonte": fonte, **altro}


def completa_calendario(attesi, giorni_letti, non_letti, cercati, oggi, giorni, adesso, dati=None, memoria=None):
    """(attesi, giorni rimasti NON letti, riserva). `attesi`: le voci di Nasdaq lette qui; la riserva dice chi ha
    servito il resto: {'da_memoria': [tk], 'stime': [tk]}. I giorni restano «non letti»: una riserva non e' una
    lettura del giorno, e lo si dice (v389)."""
    cercati = set(cercati)
    ora = adesso.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = list(attesi)
    ris = {"da_memoria": [], "stime": []}
    if giorni_letti:
        ricorda_calendario(giorni_letti, [a for a in out if a.get("fonte", NASDAQ) == NASDAQ], cercati, ora, "sessione",
                           memoria)
    scoperti = list(non_letti)
    presenti = {a["tk"] for a in out}
    if scoperti:
        fino = oggi.toordinal() + giorni
        for tk, e in sorted(leggi_memoria(memoria)["calendario"].items()):
            if tk in cercati and tk not in presenti and e.get("data") in scoperti:
                out.append(_voce(e, oggi, f"ultima lettura riuscita del {NASDAQ}: {orario(e.get('letto_il'))} "
                                          f"({e.get('via')}) — il giorno oggi NON e' stato letto", riserva="memoria"))
                presenti.add(tk)
                ris["da_memoria"].append(tk)
        for r in leggi_dati(dati).get("watchlist") or []:
            tk, d = str((r or {}).get("ticker") or "").upper(), (r or {}).get("earnings_date")
            if tk in cercati and tk not in presenti and d in scoperti and \
                    oggi.toordinal() <= datetime.fromisoformat(d).date().toordinal() < fino:
                out.append(_voce({"tk": tk, "data": d}, oggi,
                                 "STIMA di Yahoo (yfinance), non confermata: il calendario di quel giorno NON e' stato "
                                 "letto", riserva="stima", stima=True))
                presenti.add(tk)
                ris["stime"].append(tk)
    return out, scoperti, ris


ETICHETTA = {"memoria": "dall'ultima lettura riuscita", "stima": "⚠ STIMA di Yahoo, non dichiarata"}


def etichetta(voce):
    """Da dove viene una data dei conti che il calendario Nasdaq oggi non ha dato a questa sessione; '' se l'ha data."""
    return ETICHETTA.get((voce or {}).get("riserva"), "")


def riga_date(voci):
    """Una riga che nomina le date arrivate da una riserva, per chi le usa senza scrivere la fonte accanto (v405)."""
    per = {}
    for v in voci or []:
        if etichetta(v):
            per.setdefault(etichetta(v), []).append(v["tk"])
    return ("  date dei conti che il calendario Nasdaq oggi non ha dato a questa sessione — "
            + " · ".join(f"{e}: {', '.join(t)}" for e, t in per.items())) if per else None


def righe_riserva(ris, residui):
    """Le righe che dicono chi ha servito il calendario quando Nasdaq non ha risposto a questa sessione."""
    L = []
    if not ris:
        return L
    if ris.get("da_memoria"):
        L.append(f"  dall'ultima lettura riuscita del calendario, datata accanto: {', '.join(ris['da_memoria'])}")
    if ris.get("stime"):
        L.append(f"  ⚠ solo una STIMA di Yahoo, non una data dichiarata: {', '.join(ris['stime'])}")
    return L


# ── l'ultima trimestrale ───────────────────────────────────────────────────────────────────────────────────────────
def ultima_da_edgar(tk, dati=None):
    """L'ultimo deposito dei risultati su SEC EDGAR (8-K con item 2.02): una fonte UFFICIALE e gratuita per la DATA
    dell'ultima trimestrale. Non porta l'utile ne' il consenso, e chi deposita risultati anche fuori dal ciclo lo
    dice (v500: le consegne di Tesla). None per chi non ha depositi (gli emittenti esteri)."""
    per = (((leggi_dati(dati).get("macro") or {}).get("sec_calendario") or {}).get("per_titolo") or {}).get(tk)
    if not isinstance(per, dict) or not per.get("ultimo_deposito"):
        return None
    d = str(per["ultimo_deposito"])[:10]
    return {"stato": "ok", "data": d, "trimestre": None, "eps": None, "consenso": None, "sorpresa_pct": None,
            "fonte": f"SEC EDGAR: l'ultimo deposito dei risultati (8-K, item 2.02) e' del {d[8:]}/{d[5:7]}/{d[:4]}"
                     + (" — ⚠ questa societa' deposita risultati anche fuori dal ciclo: puo' non essere una trimestrale"
                        if per.get("cadenza_irregolare_gg") else "")}


def completa_ultime(esiti, adesso, dati=None, memoria=None):
    """Chi Nasdaq non ha letto qui: l'ultima lettura riuscita (con l'utile e la sorpresa) e il deposito su SEC EDGAR
    (solo la data) — vince la data PIU' RECENTE, perche' una memoria puo' essere di un trimestre fa. La voce resta «ok»
    e porta `fonte`. Chi non ha nessuna delle due resta «NON letto»."""
    ora = adesso.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ricorda_ultime(esiti, ora, "sessione", memoria)
    mem = None
    out = {}
    for tk, v in esiti.items():
        if isinstance(v, dict) and str(v.get("stato", "")).startswith("NON letto"):
            mem = leggi_memoria(memoria)["ultime"] if mem is None else mem
            e = mem.get(tk)
            cand = []
            if e and e.get("data"):
                cand.append({**{k: x for k, x in e.items() if k not in ("letto_il", "via")},
                             "fonte": f"ultima lettura riuscita di Nasdaq: {orario(e.get('letto_il'))} ({e.get('via')})"})
            ed = ultima_da_edgar(tk, dati)
            if ed:
                cand.append(ed)
            if cand:
                v = max(cand, key=lambda x: str(x["data"]))
        out[tk] = v
    return out


# ── le notizie per titolo ──────────────────────────────────────────────────────────────────────────────────────────
def nome_breve(nome):
    n = str(nome or "").strip()
    for _ in range(4):
        m = _SUFFISSO.sub("", n).strip(" ,.")
        if m == n:
            break
        n = m
    return n


def termini(tk, dati=None):
    """Cosa deve comparire nel titolo perche' una voce cercata per nome entri: il nome breve della societa' (o i suoi
    alias) e il ticker, se ha almeno tre lettere. Nessun nome = nessuna ricerca."""
    if tk in ALIAS:
        return list(ALIAS[tk])
    nome = next((nome_breve(r.get("name")) for r in leggi_dati(dati).get("watchlist") or []
                 if str((r or {}).get("ticker") or "").upper() == tk and r.get("name")), "")
    return ([nome] if len(nome) >= 3 else []) + ([tk] if nome and len(tk) >= 3 else [])


def news_pipeline(tk, dati=None):
    """(voci, orario del run) dalle notizie per titolo della pipeline; None se la pipeline non ha letto quel nome."""
    nt = leggi_dati(dati).get("news_titoli") or {}
    per = nt.get("per_titolo") or {}
    if tk not in per and tk not in (nt.get("senza_notizie") or []):
        return None
    out = []
    for x in per.get(tk) or []:
        try:
            q = datetime.fromisoformat(str(x.get("quando")).replace("Z", "+00:00"))
        except ValueError:
            continue
        out.append({"titolo": x.get("titolo") or "", "quando": q, "link": x.get("url") or "", "tk": tk,
                    "fonte": f"pipeline · {x.get('fonte') or 'feed'}[{tk}]"})
    return out, orario(nt.get("letto_il"))


def news_google(tk, http, voci_rss, dati=None):
    """Google News cercato per NOME: None se non c'e' un nome o la fonte non risponde; entra solo il titolo che porta
    il nome o il ticker (l'attribuzione di una ricerca si dichiara e si filtra, v399)."""
    t = termini(tk, dati)
    if not t:
        return None
    q = urllib.parse.quote(f'"{t[0]}" stock when:3d')
    try:
        v = voci_rss(http(f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en", 20),
                     f"Google News «{t[0]}»")
    except Exception:  # noqa: BLE001
        return None
    return [dict(x, tk=tk) for x in v
            if any(re.search(rf"(?<![A-Za-z0-9]){re.escape(k)}(?![A-Za-z0-9])", x.get("titolo") or "") for k in t)]


def news_di_riserva(tk, http, voci_rss, dati=None):
    """(voci, chi ha risposto). Le due riserve si sommano: la pipeline ha l'attribuzione per simbolo ma l'eta' del suo
    run, Google News e' di adesso ma cercato per nome. Un titolo uguale entra una volta."""
    voci, serviti = [], []
    pn = news_pipeline(tk, dati)
    if pn is not None:
        voci += pn[0]
        serviti.append(f"pipeline (run del {pn[1]})")
    g = news_google(tk, http, voci_rss, dati)
    if g is not None:
        visti = {x["titolo"].strip().lower() for x in voci}
        voci += [x for x in g if x["titolo"].strip().lower() not in visti]
        serviti.append("Google News (ricerca per nome)")
    return voci, serviti
