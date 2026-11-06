#!/usr/bin/env python3
"""v535 — PREVISIONI MACRO: le probabilita' degli eventi del semaforo e della macro dalle serie storiche giornaliere.

Decisione del CEO del 03/11/2026: un sistema previsionale «stile Polymarket», con l'ECCEZIONE MISURATA alla regola n.1
(«nessuna proiezione»): le previsioni entrano SOLO come probabilita', separate dai fatti, col metodo, la base,
l'intervallo e l'affidabilita' MISURATA (scripts/affidabilita.py, la misura comune: qui non se ne fa una seconda, v161).
Metodo: "serie_storiche". Mai una media con altri metodi (v200): si affianca.

LE SERIE (FRED, il CSV pubblico fredgraph.csv, con l'intestazione onesta e la funzione di lettura di
scripts/fonti_dirette.py): la storia INTERA si scarica una volta e si tiene in memoria/dati/serie_macro_storia.json
(fuori da git), riletta quando ha piu' di 24 ore. ⚠ STORIA MISURATA il 03/11/2026, non supposta:
  · BAMLH0A3HYC (CCC) e BAMLH0A0HYM2 (HY OAS), ICE BofA: SOLO TRE ANNI, una finestra MOBILE (il 03/11/2026 partiva dal
    03/11/2023, 784 osservazioni; il 06/11 dal 07/11/2023): e' il taglio di licenza di ICE su FRED — chiedere l'inizio
    al 1996 (cosd) non cambia niente, e ALFRED risponde 404. La resa stampa ogni volta da quando parte. Con tre anni e
    un caso ogni 20 osservazioni i casi indipendenti non arrivano a 30: per CCC e HY la previsione e' quasi sempre «non
    disponibile», e lo si dice invece di inventarla;
  · DGS10 (Treasury 10 anni) dal 1962; VIXCLS (VIX) dal 1990. ⚠ VIXCLS esce su FRED con una seduta o piu' di ritardo
    sulla quotazione della pipeline (Yahoo): la previsione parte dall'ultima osservazione FRED, con la SUA data.

GLI EVENTI (famiglia "macro"), entro 20 e 60 OSSERVAZIONI della serie dopo l'ultima (non giorni di calendario):
  · la parte CCC della famiglia credito si spegne: la salita del CCC sul minimo delle 60 sedute torna sotto
    numeri_libro.SOGLIA_CCC_PP (1,5). E' una serie DERIVATA: il risolutore porta la chiave 'derivazione'
    (DERIVAZIONE_CCC), e la derivazione e' comuni.credito_ccc stessa — la funzione del semaforo, non una copia. ⚠ La
    FAMIGLIA si spegne solo se anche l'HY resta entro numeri_libro.SOGLIA_HY (3,5): l'evento dice solo la parte CCC;
  · l'HY OAS sopra numeri_libro.SOGLIA_HY_ROSSO (4,0): il gradino del rosso;
  · il Treasury 10 anni sopra numeri_libro.SOGLIA_T10 (5,4): la famiglia tassi si accende;
  · il VIX sotto VIX_SOTTO (20) e sopra VIX_SOPRA (30): convenzioni di questo file (v240), il semaforo non le ha.
  I CONFRONTI sono STRETTI come nel semaforo: «sopra» = valore > soglia (numeri_libro confronta HY e Treasury con «>»),
  «sotto» = valore < soglia (la parte CCC e' accesa da 1,5 compreso, quindi spenta sotto 1,5).
  Se all'ultimo dato la serie e' gia' oltre la soglia (il LATO «oltre»), l'evento non e' piu' un attraversamento: la
  frase cambia («ancora sotto 20 in almeno una delle prossime 20 osservazioni») e la misura e' tenuta a parte.

IL METODO "serie_storiche" (convenzioni dichiarate qui sotto, v240):
  · lo STATO di un giorno: il LATO della soglia (aperto / oltre), la FASCIA del livello per percentile storico (midrank,
    la convenzione comuni.rango_midrank, calcolato SOLO col passato: il giorno e quelli prima, dopo MIN_STORIA
    osservazioni) nelle fasce FASCE_PCT, e il VERSO della variazione a SEDUTE_VERSO osservazioni (in salita / in calo o
    ferma). Lo stato LARGO toglie il verso;
  · i CASI: i giorni nello stesso stato, al piu' uno ogni statistica.DISTANZA osservazioni (la stessa convenzione della
    forma statistica: due giorni vicini sono la stessa fase), contati solo se il loro esito era NOTO alla data della
    previsione (il caso del giorno j entra alla data t solo se j + orizzonte <= t);
  · la probabilita' = la frequenza dell'evento nei casi; la BASE = la frequenza nei giorni dello stesso LATO senza altre
    condizioni, contati allo stesso modo (stesso lato, perche' «tocca 5,4» quando il decennale sta gia' sopra e' vero per
    costruzione e gonfierebbe l'abilita'); n e l'intervallo di Wilson; sotto statistica.MIN_CASI casi lo stato largo, e
    sotto anche quello «non disponibile»;
  · la CALIBRAZIONE walk-forward: una data ogni PASSO_CALIBRAZIONE osservazioni (ancorate all'inizio della serie: i dati
    nuovi aggiungono date, non spostano le vecchie), dopo il riscaldamento (MIN_STORIA osservazioni, poi le date senza 30
    casi sono «non disponibili» e si contano), con affidabilita.valuta e le basi di ogni data, per evento, orizzonte e
    lato. Cache in memoria/dati/calibrazione_macro.json, rifatta quando cambiano le serie o le convenzioni.
⚠ LIMITI, detti ogni volta: a 60 osservazioni con una data ogni 20 le finestre si sovrappongono (tre previsioni
  consecutive condividono parte del futuro): gli esiti non sono indipendenti e gli intervalli delle fasce sono ottimisti.
  Il percentile sulla storia intera mette insieme mondi diversi (un decennale «medio» del 1965 e del 2025). Gli eventi
  dello stesso giorno non sono indipendenti fra loro (VIX e credito si muovono insieme).

Uso:  python3 scripts/previsioni_macro.py          le verifiche (senza rete)
      python3 scripts/previsioni_macro.py oggi     le verifiche, poi le previsioni di oggi con la loro affidabilita'
"""
import bisect
import hashlib
import json
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI))
import affidabilita as A          # noqa: E402
import comuni                     # noqa: E402
import numeri_libro as NL         # noqa: E402
import statistica as ST           # noqa: E402

RADICE = QUI.parent
STORIA = RADICE / "memoria" / "dati" / "serie_macro_storia.json"
CALIBRAZIONE = RADICE / "memoria" / "dati" / "calibrazione_macro.json"
VALIDITA_ORE = 24

# ── le convenzioni (v240): il modo di contare, non misure ──
ORIZZONTI = (20, 60)              # osservazioni della serie dopo l'ultima
DISTANZA = ST.DISTANZA            # un caso al piu' ogni 20 osservazioni: la convenzione della forma statistica (v528)
MIN_CASI = ST.MIN_CASI            # sotto 30 casi la frequenza non generalizza: stato largo, poi «non disponibile»
MIN_STORIA = 252                  # il percentile del livello si calcola da un anno di osservazioni in su
FASCE_PCT = (20, 40, 60, 80)      # le fasce del percentile: 0-20, 20-40, 40-60, 60-80, 80-100
SEDUTE_VERSO = 20                 # il verso: la variazione sulle 20 osservazioni prima
PASSO_CALIBRAZIONE = 20           # una data della calibrazione ogni 20 osservazioni
VIX_SOTTO = 20.0                  # convenzioni di questo file: il semaforo non ha soglie sul VIX
VIX_SOPRA = 30.0

SERIE = {"BAMLH0A3HYC": "spread CCC (ICE BofA)", "BAMLH0A0HYM2": "HY OAS (ICE BofA)",
         "DGS10": "Treasury 10 anni", "VIXCLS": "VIX (Cboe)"}

# La serie derivata della parte CCC del semaforo: per ogni osservazione, il valore meno il minimo delle 60 PRIMA (esclusa
# la stessa), arrotondato a 2 decimali — la 'salita_60_pp' di comuni.credito_ccc, che si chiama sulla finestra.
DERIVAZIONE_CCC = {"tipo": "salita_dal_minimo", "finestra": 60, "funzione": "comuni.credito_ccc",
                   "descrizione": "valore meno il minimo delle 60 osservazioni precedenti, arrotondato a 2 decimali "
                                  "(la salita_60_pp del semaforo, LIBRO.md §1ter)"}

# (chiave, serie FRED, derivazione, tipo, soglia, decimali della soglia, soggetto, frase col lato aperto, col lato oltre)
EVENTI = (
    ("credito_ccc_spento", "BAMLH0A3HYC", DERIVAZIONE_CCC, "tocca_sotto", NL.SOGLIA_CCC_PP, 1, "CCC (famiglia credito)",
     "il CCC torna sotto +{s} punti dal minimo di 60 sedute (la parte CCC della famiglia credito si spegne) entro {h} "
     "osservazioni",
     "il CCC ancora sotto +{s} punti dal minimo di 60 sedute in almeno una delle prossime {h} osservazioni (all'ultimo "
     "dato e' gia' sotto)"),
    ("hy_rosso", "BAMLH0A0HYM2", None, "tocca_sopra", NL.SOGLIA_HY_ROSSO, 1, "HY OAS (famiglia credito)",
     "l'HY OAS sopra {s} (il gradino del rosso) entro {h} osservazioni",
     "l'HY OAS ancora sopra {s} in almeno una delle prossime {h} osservazioni (all'ultimo dato e' gia' sopra)"),
    ("t10_acceso", "DGS10", None, "tocca_sopra", NL.SOGLIA_T10, 1, "Treasury 10A (famiglia tassi)",
     "il Treasury 10 anni sopra {s} (la famiglia tassi si accende) entro {h} osservazioni",
     "il Treasury 10 anni ancora sopra {s} in almeno una delle prossime {h} osservazioni (all'ultimo dato e' gia' sopra)"),
    ("vix_sotto_20", "VIXCLS", None, "tocca_sotto", VIX_SOTTO, 0, "VIX",
     "il VIX torna sotto {s} entro {h} osservazioni",
     "il VIX ancora sotto {s} in almeno una delle prossime {h} osservazioni (all'ultimo dato e' gia' sotto)"),
    ("vix_sopra_30", "VIXCLS", None, "tocca_sopra", VIX_SOPRA, 0, "VIX",
     "il VIX sopra {s} entro {h} osservazioni",
     "il VIX ancora sopra {s} in almeno una delle prossime {h} osservazioni (all'ultimo dato e' gia' sopra)"),
)
CAMPI = ("chiave", "sid", "derivazione", "tipo", "soglia", "decimali", "soggetto", "aperto", "oltre")
EVENTI = tuple(dict(zip(CAMPI, e)) for e in EVENTI)


def _convenzioni():
    return {"orizzonti": ORIZZONTI, "distanza": DISTANZA, "min_casi": MIN_CASI, "min_storia": MIN_STORIA,
            "fasce": FASCE_PCT, "verso": SEDUTE_VERSO, "passo": PASSO_CALIBRAZIONE,
            "eventi": [[e["chiave"], e["sid"], e["tipo"], e["soglia"], bool(e["derivazione"])] for e in EVENTI]}


# ══════════════════════════════════ le serie ══════════════════════════════════

def _leggi_json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _scrivi_json(p, dati):
    try:
        Path(p).parent.mkdir(parents=True, exist_ok=True)
        Path(p).write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
        return True
    except (OSError, TypeError, ValueError) as e:
        print(f"⚠ cache NON scritta in {p}: {type(e).__name__}: {e}", file=sys.stderr)
        return False


def _leggi_fred(sid):
    """La storia intera di una serie FRED, col modo di leggere di fonti_dirette (URL_FRED, _get, l'intestazione onesta)
    e il lettore del CSV della pipeline (comuni.fredgraph: il «.» dei giorni senza dato e' un buco, non uno zero)."""
    import fonti_dirette as FD
    return comuni.fredgraph(FD._get(FD.URL_FRED.format(sid=sid), FD.UA_ONESTO, timeout=40).text)


def _eta_ore(iso, ora):
    try:
        return (ora - datetime.fromisoformat(iso)).total_seconds() / 3600
    except (TypeError, ValueError):
        return None


def storia(rete=True, adesso=None):
    """{'serie': {sid: {'oss': [[data, valore]], 'prima', 'ultima', 'n', 'letta'}}, 'errori': {sid: perche'},
    'eta_ore': {sid: ore}}. Una serie si rilegge solo se la sua copia ha piu' di VALIDITA_ORE; una lettura fallita tiene
    la copia vecchia e lo dice in 'errori'. rete=False: solo la cache, qualunque eta' abbia (dichiarata)."""
    ora = (adesso or datetime.now(timezone.utc)).astimezone(timezone.utc)
    cache = _leggi_json(STORIA) or {"serie": {}}
    out = {"serie": dict(cache.get("serie") or {}), "errori": {}, "eta_ore": {}}
    scritto = False
    for sid in SERIE:
        vecchia = out["serie"].get(sid)
        eta = _eta_ore((vecchia or {}).get("letta"), ora)
        if vecchia and (not rete or (eta is not None and eta < VALIDITA_ORE)):
            out["eta_ore"][sid] = eta
            continue
        if not rete:
            out["errori"][sid] = "nessuna storia in cache e rete spenta"
            continue
        try:
            oss = _leggi_fred(sid)
            if not oss:
                raise ValueError("la fonte ha risposto senza osservazioni")
            out["serie"][sid] = {"oss": [list(x) for x in oss], "prima": oss[0][0], "ultima": oss[-1][0], "n": len(oss),
                                 "letta": ora.isoformat(timespec="minutes")}
            out["eta_ore"][sid] = 0.0
            scritto = True
        except Exception as e:  # noqa: BLE001 — una fonte che non risponde e' un esito, non un'eccezione
            out["errori"][sid] = f"{type(e).__name__}: {str(e)[:90]}" + (" (resta la copia vecchia)" if vecchia else "")
            if vecchia:
                out["eta_ore"][sid] = eta
    if scritto:
        _scrivi_json(STORIA, {"serie": out["serie"]})
    return out


def deriva(oss, derivazione):
    """La serie derivata [(data, valore)]. 'salita_dal_minimo': comuni.credito_ccc sulla finestra delle 61 osservazioni
    che legge (le 60 prima e quella del giorno) — la stessa funzione del semaforo, quindi lo stesso arrotondamento."""
    if (derivazione or {}).get("tipo") != "salita_dal_minimo" or derivazione.get("finestra") != 60:
        raise ValueError(f"derivazione non conosciuta: {derivazione}")
    vals = [(d, float(v)) for d, v in oss if v is not None]
    out = []
    for i in range(60, len(vals)):
        x = comuni.credito_ccc(vals[i - 60:i + 1])
        if x and x.get("salita_60_pp") is not None:
            out.append((vals[i][0], x["salita_60_pp"]))
    return out


def _oss_evento(ev, st):
    s = ((st or {}).get("serie") or {}).get(ev["sid"])
    if not s or not s.get("oss"):
        return None
    oss = [(d, float(v)) for d, v in s["oss"]]
    return deriva(oss, ev["derivazione"]) if ev["derivazione"] else oss


# ══════════════════════════════════ gli esiti ══════════════════════════════════

def _oltre(v, tipo, soglia):
    """Il confronto STRETTO del semaforo: «sopra» = v > soglia, «sotto» = v < soglia."""
    return v < soglia if tipo == "tocca_sotto" else v > soglia


def _esito_futuro(futuro, tipo, soglia, h):
    """True/False/None sulle osservazioni dopo il giorno di partenza: un tocco gia' visto e' True anche prima delle h
    osservazioni; il NO chiede tutte le h (prima e' None: un dato che manca non e' un NO, v205)."""
    if tipo == "finisce_sopra":
        return (futuro[h - 1] > soglia) if len(futuro) >= h else None
    if any(_oltre(x, tipo, soglia) for x in futuro[:h]):
        return True
    return False if len(futuro) >= h else None


def risolvi_serie(risolutore, storia):
    """L'esito di un evento_serie: True/False, o None se le osservazioni dopo 'dal' non bastano ancora.
    storia: [(data, valore)] della serie del risolutore, o {sid: [(data, valore)]}, o la forma della cache
    ({'serie': {sid: {'oss': ...}}}). Con 'derivazione' la serie si deriva prima (DERIVAZIONE_CCC)."""
    sid = risolutore["serie"]
    oss = storia
    if isinstance(storia, dict):
        oss = (storia.get("serie") or {}).get(sid) if "serie" in storia and isinstance(storia["serie"], dict) else storia.get(sid)
        if isinstance(oss, dict):
            oss = oss.get("oss")
    if not oss:
        return None
    oss = sorted((d, float(v)) for d, v in oss if v is not None)
    if risolutore.get("derivazione"):
        oss = deriva(oss, risolutore["derivazione"])
    futuro = [v for d, v in oss if d > risolutore["dal"]]
    return _esito_futuro(futuro, risolutore["tipo"], risolutore["soglia"], int(risolutore["sedute"]))


# ══════════════════════════════════ il metodo ══════════════════════════════════

def percentili(valori, minimo=MIN_STORIA, tutta=False):
    """Il percentile midrank di ogni osservazione fra quelle fino a lei COMPRESA (comuni.rango_midrank sul passato),
    None prima di `minimo` osservazioni. tutta=True e' il DIFETTO INIETTATO della prova (c) — il percentile su tutta la
    serie, futuro compreso — e non si usa mai fuori dalle verifiche."""
    ordinati = sorted(valori) if tutta else []
    out = []
    for i, x in enumerate(valori):
        if not tutta:
            bisect.insort(ordinati, x)
        if i + 1 < minimo:
            out.append(None)
            continue
        lo, hi = bisect.bisect_left(ordinati, x), bisect.bisect_right(ordinati, x)
        out.append((lo + (hi - lo) / 2) / len(ordinati) * 100)
    return out


def _fascia_testo(b):
    lim = (0,) + FASCE_PCT + (100,)
    return f"percentile {lim[b]}-{lim[b + 1]}"


def prepara(oss, tipo, soglia, h, tutta=False):
    """Per ogni giorno: lo stato (lato, fascia, verso), l'esito a h osservazioni, e le CELLE dei casi diradati (un caso
    al piu' ogni DISTANZA osservazioni per cella, in ordine di tempo: la scelta di un caso dipende solo dai giorni prima,
    quindi i dati nuovi non cambiano i casi vecchi)."""
    date = [d for d, _ in oss]
    v = [float(x) for _, x in oss]
    pct = percentili(v, tutta=tutta)
    stato, esito = [], []
    for i in range(len(v)):
        esito.append(_esito_futuro(v[i + 1:i + 1 + h], tipo, soglia, h))
        if pct[i] is None or i < SEDUTE_VERSO:
            stato.append(None)
            continue
        stato.append(("oltre" if _oltre(v[i], tipo, soglia) else "aperto", bisect.bisect_right(FASCE_PCT, pct[i]),
                      "su" if v[i] - v[i - SEDUTE_VERSO] > 0 else "giu"))
    celle = {}
    for i, s in enumerate(stato):
        if s is None or esito[i] is None:
            continue
        for k in (s, s[:2], s[:1]):
            c = celle.setdefault(k, {"j": [], "k": [0], "ultimo": -10 ** 9})
            if i - c["ultimo"] < DISTANZA:
                continue
            c["j"].append(i)
            c["k"].append(c["k"][-1] + (1 if esito[i] else 0))
            c["ultimo"] = i
    return {"date": date, "valori": v, "pct": pct, "stato": stato, "esito": esito, "celle": celle, "h": h,
            "tipo": tipo, "soglia": soglia}


def _conta(P, chiave, t):
    """(casi, avverati, primo caso) della cella con l'esito NOTO alla data t: j + h <= t."""
    c = P["celle"].get(chiave)
    if not c:
        return 0, 0, None
    m = bisect.bisect_right(c["j"], t - P["h"])
    return m, c["k"][m], (P["date"][c["j"][0]] if m else None)


def previsione_a(P, t):
    """La previsione del giorno t col solo passato. {'disponibile', 'p', 'n', 'avverati', 'base', 'n_base',
    'largo', 'intervallo', 'stato', 'pct', 'valore', 'data', 'dal_caso', 'perche'}."""
    s = P["stato"][t]
    out = {"data": P["date"][t], "valore": P["valori"][t], "pct": P["pct"][t], "stato": s, "disponibile": False}
    if s is None:
        out["perche"] = f"meno di {MIN_STORIA} osservazioni prima: il percentile del livello non si misura"
        return out
    n_p, k_p, d_p = _conta(P, s, t)
    n_l, k_l, d_l = _conta(P, s[:2], t)
    n_b, k_b, _d = _conta(P, s[:1], t)
    out.update({"n_pieno": n_p, "n_largo": n_l, "n_base": n_b, "base": k_b / n_b if n_b else None})
    if n_p >= MIN_CASI:
        n, k, d0, largo = n_p, k_p, d_p, False
    elif n_l >= MIN_CASI:
        n, k, d0, largo = n_l, k_l, d_l, True
    else:
        out["perche"] = (f"{n_p} casi nello stato, {n_l} nello stato largo, {n_b} nella base: sotto i {MIN_CASI} "
                         f"la frequenza non generalizza")
        return out
    out.update({"disponibile": True, "p": k / n, "n": n, "avverati": k, "largo": largo, "dal_caso": d0,
                "intervallo": A.wilson(k, n)})
    return out


def _calibra(P):
    """Walk-forward: una data ogni PASSO_CALIBRAZIONE osservazioni dopo il riscaldamento, la previsione col solo
    passato contro l'esito vero; per lato. {lato: valuta + date e non disponibili}."""
    gr = {}
    for t in range(MIN_STORIA - 1, len(P["valori"]), PASSO_CALIBRAZIONE):
        e, s = P["esito"][t], P["stato"][t]
        if e is None or s is None:
            continue
        g = gr.setdefault(s[0], {"ps": [], "ys": [], "basi": [], "nd": 0, "larghi": 0, "date": []})
        f = previsione_a(P, t)
        if not f["disponibile"]:
            g["nd"] += 1
            continue
        g["ps"].append(f["p"])
        g["ys"].append(e)
        g["basi"].append(f["base"])
        g["larghi"] += f["largo"]
        g["date"].append(P["date"][t])
    out = {}
    for lato, g in gr.items():
        v = A.valuta(g["ps"], g["ys"], basi=g["basi"])
        v.update({"non_disponibili": g["nd"], "larghi": g["larghi"],
                  "dal": g["date"][0] if g["date"] else None, "al": g["date"][-1] if g["date"] else None})
        out[lato] = v
    return out


def _impronta(st):
    serie = {sid: [s.get("n"), s.get("ultima"), (s.get("oss") or [[None, None]])[-1][1]]
             for sid, s in sorted(((st or {}).get("serie") or {}).items())}
    conv = hashlib.sha256(json.dumps(_convenzioni(), sort_keys=True).encode()).hexdigest()[:16]
    return {"serie": serie, "convenzioni": conv}


def calibrazione(rete=True, adesso=None):
    """{'valutazioni': {'chiave|orizzonte|lato': valuta + 'non_disponibili', 'larghi', 'dal', 'al'}, 'storia': {sid:
    {prima, ultima, n}}, 'impronta', 'scritto', 'errori'}. Dalla cache se serie e convenzioni non sono cambiate."""
    st = storia(rete, adesso)
    imp = _impronta(st)
    cache = _leggi_json(CALIBRAZIONE)
    if cache and cache.get("impronta") == imp:
        cache["errori"] = st["errori"]
        return cache
    val = {}
    for ev in EVENTI:
        oss = _oss_evento(ev, st)
        if not oss:
            continue
        for h in ORIZZONTI:
            for lato, v in _calibra(prepara(oss, ev["tipo"], ev["soglia"], h)).items():
                val[f"{ev['chiave']}|{h}|{lato}"] = v
    out = {"scritto": datetime.now(timezone.utc).isoformat(timespec="minutes"), "impronta": imp, "valutazioni": val,
           "storia": {sid: {k: s.get(k) for k in ("prima", "ultima", "n")} for sid, s in st["serie"].items()},
           "convenzioni": _convenzioni()}
    if val:
        _scrivi_json(CALIBRAZIONE, out)
    out["errori"] = st["errori"]
    return out


def _scade(dal, h):
    """La data INDICATIVA: h giorni feriali dopo 'dal' (senza le festivita'); l'evento lo risolve il risolutore."""
    d = date.fromisoformat(dal)
    while h > 0:
        d += timedelta(days=1)
        h -= d.weekday() < 5
    return d.isoformat()


def _frase(ev, lato, h):
    return ev["aperto" if lato == "aperto" else "oltre"].format(s=ST._n(ev["soglia"], ev["decimali"]), h=h)


def previsioni_oggi(adesso=None, rete=True, assenze=None):
    """I record affidabilita.previsione di oggi, uno per evento e orizzonte con almeno MIN_CASI casi; il risolutore e'
    evento_serie con dal = l'ultima osservazione (piu' 'derivazione' per il CCC). Gli eventi senza previsione vanno in
    `assenze` (se e' una lista) come {'soggetto', 'evento', 'perche'}: un'assenza si dichiara (v406)."""
    adesso = (adesso or datetime.now(timezone.utc)).astimezone(timezone.utc)
    scritto = adesso.isoformat(timespec="minutes")
    assenze = assenze if assenze is not None else []
    st = storia(rete, adesso)
    out = []
    for ev in EVENTI:
        oss = _oss_evento(ev, st)
        if not oss:
            for h in ORIZZONTI:
                assenze.append({"soggetto": ev["soggetto"], "evento": _frase(ev, "aperto", h),
                                "perche": f"serie FRED {ev['sid']} non letta: {st['errori'].get(ev['sid'], 'n.d.')}"})
            continue
        for h in ORIZZONTI:
            P = prepara(oss, ev["tipo"], ev["soglia"], h)
            t = len(oss) - 1
            f = previsione_a(P, t)
            lato = f["stato"][0] if f["stato"] else "aperto"
            frase = _frase(ev, lato, h)
            if not f["disponibile"]:
                assenze.append({"soggetto": ev["soggetto"], "evento": frase, "perche": f["perche"], "data": f["data"],
                                "valore": f["valore"], "base": f.get("base"), "n_base": f.get("n_base") or 0})
                continue
            ris = A.evento_serie(ev["sid"], ev["tipo"], ev["soglia"], f["data"], h)
            if ev["derivazione"]:
                ris["derivazione"] = dict(ev["derivazione"])
            s = f["stato"]
            out.append(A.previsione(
                "macro", ev["soggetto"], frase, f["p"], "serie_storiche", ris, scade=_scade(f["data"], h),
                base=f["base"], n=f["n"], intervallo=f["intervallo"], scritto=scritto,
                extra={"chiave_evento": ev["chiave"], "orizzonte": h, "lato": lato, "fonte": f"FRED {ev['sid']}",
                       "ultimo_dato": f["data"], "valore": f["valore"], "percentile": f["pct"],
                       "fascia": _fascia_testo(s[1]), "verso": "in salita" if s[2] == "su" else "in calo o ferma",
                       "largo": f["largo"], "n_base": f["n_base"], "casi_dal": f["dal_caso"],
                       "storia_dal": oss[0][0], "derivata": bool(ev["derivazione"])}))
    return out


# ══════════════════════════════════ la resa ══════════════════════════════════

def _d(iso):
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}" if iso else "n.d."


def _pc(x, d=0):
    return "n.d." if x is None else ST._n(100 * x, d) + "%"


def resa(previsioni, calibrazione, assenze=None):
    """Le righe brevi in italiano: per ogni previsione la probabilita', l'intervallo, i casi, la base, l'ultimo dato
    con la sua data, e l'affidabilita' misurata (walk-forward) dello stesso evento, orizzonte e lato."""
    val = (calibrazione or {}).get("valutazioni") or {}
    L = ["PREVISIONI MACRO — metodo «serie storiche» (FRED): probabilita', non fatti; ogni numero col suo metodo, "
         "la sua base e la sua affidabilita' misurata sul passato senza guardare il futuro"]
    for r in previsioni:
        x = r["extra"]
        lo, hi = r["intervallo"] or (None, None)
        L.append(f"· {r['soggetto']}: {r['evento']} — {_pc(r['probabilita'])} (fra {_pc(lo)} e {_pc(hi)}; {r['n']} casi "
                 f"{'dello stato largo, senza il verso' if x['largo'] else 'nello stesso stato'} dal {_d(x['casi_dal'])};"
                 f" base {_pc(r['base'])} su {x['n_base']}) · ultimo dato {x['fonte']} del {_d(x['ultimo_dato'])}: "
                 f"{ST._n(x['valore'], 2)}{' (serie derivata)' if x['derivata'] else ''}, {x['fascia']}, "
                 f"{x['verso']} a {SEDUTE_VERSO} osservazioni")
        v = val.get(f"{x['chiave_evento']}|{x['orizzonte']}|{x['lato']}")
        if x["lato"] == "oltre":
            L.append("    ⚠ lato «oltre»: la serie e' gia' oltre la soglia, l'evento e' quasi certo per persistenza e "
                     "l'abilita' contro una base quasi certa non dice niente")
        if v and v.get("n"):
            L.append(f"    affidabilita' (walk-forward {_d(v['dal'])}-{_d(v['al'])}, {v['n']} previsioni, "
                     f"{v['non_disponibili']} date senza casi): Brier {ST._n(v['brier'], 3)} contro "
                     f"{ST._n(v['brier_base'], 3)} della base, ECE {ST._n(v['ece'], 3)} · "
                     + A.riga_affidabilita(r["probabilita"], v, "serie_storiche"))
        else:
            L.append("    " + A.riga_affidabilita(r["probabilita"], v, "serie_storiche"))
    for a in assenze or []:
        L.append(f"· {a['soggetto']}: {a['evento']} — non disponibile: {a['perche']}"
                 + (f" (ultimo dato del {_d(a['data'])}: {ST._n(a['valore'], 2)})" if a.get("data") else "")
                 + (f" · la sola base, stesso lato e nessuno stato (NON e' la previsione del metodo): {_pc(a['base'])} su "
                    f"{a['n_base']}" if a.get("n_base", 0) >= MIN_CASI and a.get("base") is not None else ""))
    sto = (calibrazione or {}).get("storia") or {}
    if sto:
        L.append("  storia FRED: " + " · ".join(f"{sid} dal {_d(s.get('prima'))} ({s.get('n')} oss.)"
                                                for sid, s in sto.items())
                 + " — le ICE BofA hanno solo tre anni su FRED (licenza)")
    for sid, e in ((calibrazione or {}).get("errori") or {}).items():
        L.append(f"  ⚠ {sid}: {e}")
    L.append(f"  ⚠ con una data ogni {PASSO_CALIBRAZIONE} osservazioni le finestre a 60 si sovrappongono: gli intervalli "
             "delle fasce sono ottimisti; gli eventi dello stesso giorno non sono indipendenti fra loro")
    return L


# ══════════════════════════════════ le verifiche ══════════════════════════════════

def _feriali(n, inizio="2000-01-03"):
    d, out = date.fromisoformat(inizio), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _sintetica(n, seme):
    """Una serie che torna verso la media (come il VIX), arrotondata a 2 decimali."""
    rnd, x, out = random.Random(seme), 16.0, []
    for d in _feriali(n):
        x = max(9.0, x + 0.03 * (16.0 - x) + rnd.gauss(0, 1.1))
        out.append((d, round(x, 2)))
    return out


def _uguali(oss, tipo, soglia, h, date_t, tutta):
    """La prova del futuro: percentile e previsione alla data t uguali con la serie tagliata a t e con la serie intera."""
    piena = prepara(oss, tipo, soglia, h, tutta=tutta)
    diverse, disponibili = 0, 0
    for t in date_t:
        tagliata = prepara(oss[:t + 1], tipo, soglia, h, tutta=tutta)
        a, b = previsione_a(piena, t), previsione_a(tagliata, t)
        disponibili += a["disponibile"]
        diverse += (a != b) or piena["pct"][t] != tagliata["pct"][t]
    return diverse, disponibili


def verifiche():
    """(nome, esito, dettaglio), senza rete, su serie sintetiche."""
    V = []
    t0 = time.time()
    oss = _sintetica(6000, 7)
    date_t = (3000, 4000, 5000, 5900)
    # (a) nessun futuro
    dv, disp = _uguali(oss, "tocca_sopra", 20.0, 20, date_t, tutta=False)
    V.append(("(a) nessun futuro: percentile e previsione alla data t non cambiano aggiungendo le osservazioni dopo t",
              dv == 0 and disp >= 2, f"{dv} date diverse su {len(date_t)}, {disp} previsioni disponibili"))
    # (c) il difetto iniettato: il percentile su tutta la serie deve far cadere la stessa prova
    dv2, _ = _uguali(oss, "tocca_sopra", 20.0, 20, date_t, tutta=True)
    V.append(("(c) la prova (a) CADE se il percentile usa tutta la serie (difetto iniettato: percentili(tutta=True))",
              dv2 > 0, f"col difetto {dv2} date su {len(date_t)} cambiano: la prova morde"))
    # (a') la base e i casi della calibrazione: nessun caso con l'esito dopo la data della previsione
    P = prepara(oss, "tocca_sopra", 20.0, 60)
    fuori = 0
    for t in range(MIN_STORIA - 1, len(oss), PASSO_CALIBRAZIONE):
        s = P["stato"][t]
        if s is None:
            continue
        for k in (s, s[:2], s[:1]):
            c = P["celle"].get(k)
            m = bisect.bisect_right(c["j"], t - 60) if c else 0
            fuori += bool(m) and c["j"][m - 1] + 60 > t
    V.append(("(a') calibrazione: ogni caso usato alla data t ha l'esito noto entro t (j + 60 <= t)", fuori == 0,
              f"{fuori} casi col futuro"))
    # il percentile e' quello di comuni.rango_midrank sul passato (una derivazione, v161)
    vv = [x for _, x in oss[:1500]]
    pc = percentili(vv)
    campione = random.Random(3).sample(range(MIN_STORIA, 1500), 40)
    ok = all(abs(pc[i] - comuni.rango_midrank(vv[i], vv[:i + 1])) < 1e-9 for i in campione)
    V.append(("il percentile veloce coincide con comuni.rango_midrank sul solo passato", ok, "40 giorni a caso"))
    # i casi diradati: nella stessa cella due casi distano almeno DISTANZA, e stanno tutti dallo stesso lato
    ok = all(all(b - a >= DISTANZA for a, b in zip(c["j"], c["j"][1:])) and all(P["stato"][j][0] == k[0] for j in c["j"])
             for k, c in P["celle"].items())
    V.append((f"i casi: al piu' uno ogni {DISTANZA} osservazioni per cella, tutti dal lato della cella", ok,
              f"{len(P['celle'])} celle"))
    # (b) la serie derivata riproduce l'acceso/spento del semaforo, passando dalla strada vera (fonti_dirette.da_fred)
    import fonti_dirette as FD
    # 8,03 - 6,53 in virgola mobile fa 1,4999999999999991: senza l'arrotondamento del semaforo sarebbe «spenta»
    vals = [6.80] * 30 + [6.53] + [6.90] * 29 + [8.03, 8.01, 8.16, 8.06, 7.96] + [7.30] * 30
    ccc = list(zip(_feriali(len(vals)), vals))
    der = deriva(ccc, DERIVAZIONE_CCC)
    attesi = {60: True, 61: False, 62: True, 63: True, 64: False}
    sem, coincide = {}, True
    for i in range(60, len(vals)):
        voce = FD.da_fred("ccc", ccc[:i + 1][-260:])
        fam = NL.famiglia_credito(voce, {"valore": 3.0})
        sem[i] = fam["ccc_acceso"]
        coincide &= der[i - 60] == (ccc[i][0], voce["salita_60_pp"]) and (not _oltre(der[i - 60][1], "tocca_sotto",
                                                                                     NL.SOGLIA_CCC_PP)) == fam["ccc_acceso"]
    V.append(("(b) la serie derivata «sopra il minimo di 60» riproduce l'acceso/spento del semaforo (fonti_dirette.da_fred "
              "→ numeri_libro.famiglia_credito), anche sul bordo 8,03 - 6,53 che in virgola mobile sta sotto 1,5",
              coincide and all(sem[i] == a for i, a in attesi.items()) and 8.03 - 6.53 < NL.SOGLIA_CCC_PP,
              f"8,03 - 6,53 = {8.03 - 6.53!r} → derivata {der[0][1]!r}, "
              f"{'spenta' if _oltre(der[0][1], 'tocca_sotto', NL.SOGLIA_CCC_PP) else 'accesa'}; "
              f"semaforo 60-64 {[sem[i] for i in attesi]}"))
    ris = A.evento_serie("BAMLH0A3HYC", "tocca_sotto", NL.SOGLIA_CCC_PP, ccc[60][0], 1)
    ris["derivazione"] = dict(DERIVAZIONE_CCC)
    r1 = risolvi_serie(ris, {"BAMLH0A3HYC": ccc})
    r2 = risolvi_serie(dict(ris, dal=ccc[62][0]), {"BAMLH0A3HYC": ccc})
    r3 = risolvi_serie(dict(ris, dal=ccc[62][0], sedute=2), {"BAMLH0A3HYC": ccc})
    r4 = risolvi_serie(dict(ris, dal=ccc[-1][0]), {"BAMLH0A3HYC": ccc})
    V.append(("il risolutore della serie derivata: spenta il giorno dopo (si), accesa il giorno dopo (no), entro due "
              "(si), senza osservazioni dopo (None)", (r1, r2, r3, r4) == (True, False, True, None), f"{(r1, r2, r3, r4)}"))
    # i confronti stretti, come il semaforo
    s = [("2026-01-0" + str(i), x) for i, x in enumerate((5.0, 5.4, 5.4, 5.41), start=1)]
    e1 = risolvi_serie(A.evento_serie("DGS10", "tocca_sopra", 5.4, s[0][0], 2), s)
    e2 = risolvi_serie(A.evento_serie("DGS10", "tocca_sopra", 5.4, s[0][0], 3), s)
    e3 = risolvi_serie(A.evento_serie("DGS10", "tocca_sopra", 5.4, s[0][0], 5), s[:3])
    tassi = NL.famiglia_tassi({"valore": 5.4})["stato"], NL.famiglia_tassi({"valore": 5.41})["stato"]
    rosso = NL.famiglia_credito({"salita_60_pp": 0.0}, {"valore": 4.0})["rosso"], NL.famiglia_credito(
        {"salita_60_pp": 0.0}, {"valore": 4.01})["rosso"]
    V.append(("confronti stretti come il semaforo: 5,4 non accende i tassi, 5,41 si'; 4,0 non e' il rosso, 4,01 si'; "
              "un NO prima delle osservazioni che servono e' None",
              (e1, e2, e3) == (False, True, None) and tassi == ("spento", "acceso") and rosso == (False, True)
              and not _oltre(4.0, "tocca_sopra", NL.SOGLIA_HY_ROSSO) and _oltre(4.01, "tocca_sopra", NL.SOGLIA_HY_ROSSO),
              f"{(e1, e2, e3)} {tassi} {rosso}"))
    sog = {e["chiave"]: e["soglia"] for e in EVENTI}
    V.append(("le soglie del semaforo vengono dalle costanti di numeri_libro, non ricopiate",
              sog["credito_ccc_spento"] is NL.SOGLIA_CCC_PP and sog["hy_rosso"] is NL.SOGLIA_HY_ROSSO
              and sog["t10_acceso"] is NL.SOGLIA_T10, str(sog)))
    # la calibrazione su una serie sintetica: gira, usa le basi senza futuro, e la previsione e' un record valido
    cal = _calibra(prepara(oss, "tocca_sopra", 22.0, 20))
    ap = cal.get("aperto") or {}
    V.append(("la calibrazione walk-forward misura con le basi di ogni data (affidabilita.valuta)",
              ap.get("n", 0) > 50 and ap.get("abilita") is not None
              and ap.get("base_dichiarata") == "la base di ogni previsione, calcolata col solo passato",
              f"{ap.get('n')} previsioni, abilita' {ST._n(ap.get('abilita'), 3)}, ECE {ST._n(ap.get('ece'), 3)}"))
    V.append(("tempo delle verifiche sotto 60 s", time.time() - t0 < 60, f"{time.time() - t0:.1f} s"))
    return V


if __name__ == "__main__":
    ok = True
    for nome, esito, dettaglio in verifiche():
        print(("PASS  " if esito else "FAIL  ") + nome + (f" — {dettaglio}" if dettaglio else ""))
        ok &= bool(esito)
    if "oggi" in sys.argv[1:]:
        assenze = []
        prev = previsioni_oggi(datetime.now(timezone.utc), rete=True, assenze=assenze)
        print()
        print("\n".join(resa(prev, calibrazione(rete=True), assenze)))
    sys.exit(0 if ok else 1)
