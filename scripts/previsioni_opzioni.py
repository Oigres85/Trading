#!/usr/bin/env python3
"""v535 — DUE METODI PER GLI STESSI EVENTI DI PREZZO: il LOGNORMALE con la volatilita' realizzata e le OPZIONI.

Decisione del CEO del 03/11/2026: un sistema previsionale «stile Polymarket», con l'ECCEZIONE MISURATA alla sua
istruzione n.1 («nessuna proiezione»): le previsioni entrano SOLO come probabilita', separate dai fatti, ognuna col suo
metodo, la sua base, il suo intervallo e l'affidabilita' MISURATA (scripts/affidabilita.py, la fondazione comune). Mai
una media di metodi diversi (v200): qui due metodi affiancati, evento per evento, sugli stessi eventi dei casi simili:
- «sopra il prezzo di oggi fra 20 e fra 60 sedute» (chiude_sopra, soglia = la chiusura dell'ultima seduta conclusa);
- «tocca +10% / -10% entro 20 sedute» (tocca_su / tocca_giu);
- «tocca il carico entro 60 / 120 / 252 sedute», solo per le posizioni SOTTO il carico.

1. LOGNORMALE — il prezzo come una passeggiata casuale lognormale con la volatilita' REALIZZATA delle ultime 60 sedute
   (la radice della media dei quadrati dei log-rendimenti di chiusura: deriva zero anche nella stima) e DERIVA ZERO: il
   prezzo atteso e' quello di oggi, nessuna tendenza si proietta (la mediana sta un poco sotto: -sigma²/2 nel
   logaritmo). P(chiude sopra K fra h sedute) = N(d2), d2 = [ln(S/K) - s²/2] / s, s = sigma × radice(h).
   P(tocca K entro h) col PRINCIPIO DI RIFLESSIONE sulla passeggiata con la deriva del modello: N(d2) + (S/K)·N(d1)
   sopra, N(-d2) + (S/K)·N(-d1) sotto — circa 2 volte la probabilita' di finire oltre (esattamente 2 volte senza
   deriva nel logaritmo), mai sopra 1. E' un'APPROSSIMAZIONE: vale per percorsi continui, e i salti (i conti, le
   notizie della notte) la violano. Misurato il 06/11/2026: il «2 volte» secco, limitato a 1, dava 100% a CRWV per un
   -10% con il prezzo a un soffio dalla soglia (la mediana sta sotto il prezzo: finire sotto vale piu' del 50%). Si misura sul passato SENZA guardare il futuro
   (walk-forward): per ogni titolo una data ogni 20 sedute dopo un anno di riscaldamento, la volatilita' col solo
   passato, l'esito vero dalle barre, la base = la frequenza dell'evento in tutto l'universo fra le prove gia' RISOLTE a
   quella data. Il carico non ha storia (e' del CEO): la sua affidabilita' si legge da una famiglia vicina — «tocca un
   livello sopra il prezzo» a una SCALA di distanze dichiarata (SCALA_CARICO), con la base di ogni distanza.
2. OPZIONI — la probabilita' NEUTRALE AL RISCHIO dalla volatilita' implicita della catena CBOE (posizionamento._catena,
   una lettura per simbolo e per giro): la scadenza listata piu' vicina che COPRE l'orizzonte (mai una piu' corta), lo
   strike piu' vicino alla soglia, il contratto fuori dal denaro a quello strike (call sopra il prezzo, put sotto: il
   piu' scambiato), la STESSA formula del lognormale (v161: una derivazione, cambia solo la volatilita') con tasso zero
   e senza dividendi come la gamma dei dealer (v499), e il tempo dal momento della lettura alla chiusura della seduta
   dell'orizzonte (posizionamento.anni_alla_scadenza). E' la misura del MERCATO, non una frequenza reale: i prezzi delle
   opzioni pagano anche la paura (il premio per il rischio), e N(d2) con la volatilita' di uno strike trascura la
   pendenza del sorriso. Non ha storia: la sua affidabilita' si misura solo DAL VIVO, dal registro. Se CBOE non
   risponde: «non disponibile», mai un numero inventato.

Il calendario delle sedute di New York e' quello delle REGOLE della borsa (festivita' fisse e mobili, con i giorni
osservati): le chiusure straordinarie (lutto nazionale, uragani) non sono note e spostano l'orizzonte di un giorno.
Le soglie sono convenzioni dichiarate (v240). Cache fuori da git in memoria/dati: la calibrazione (24 ore) e le catene
(la durata del giro, fonti_dirette.VALIDITA_MINUTI).

Uso:
  python3 scripts/previsioni_opzioni.py                 le verifiche (fixture sintetiche, senza rete)
  python3 scripts/previsioni_opzioni.py oggi [--barre FILE] [--senza-rete]   e le previsioni di oggi
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)
import affidabilita as A          # noqa: E402
import brief                      # noqa: E402
import posizionamento as P        # noqa: E402
import statistica as S            # noqa: E402

RADICE = os.path.dirname(QUI)
CACHE_CAL = os.path.join(RADICE, "memoria", "dati", "calibrazione_lognormale.json")
CACHE_OPZ = os.path.join(RADICE, "memoria", "dati", "opzioni_previsioni.json")

FINESTRA = 60                     # sedute della volatilita' realizzata (convenzione)
RISCALDAMENTO = S.SEDUTE_ANNO     # un anno di barre prima della prima previsione del walk-forward
PASSO = S.DISTANZA                # una data ogni 20 sedute per titolo, come i casi simili
MOSSA = 0.10                      # «tocca +10% / -10%»
ORIZZONTI_PREZZO = S.ORIZZONTI    # 20 e 60 sedute
ORIZZONTE_MOSSA = 20
ORIZZONTI_CARICO = (60, 120, 252)
SCALA_CARICO = (0.05, 0.10, 0.25, 0.50, 1.00)   # le distanze della famiglia vicina al carico (convenzione)
MIN_DATE_BASE = 20                # sotto 20 date di risoluzione nell'universo la base non c'e' ancora: la prova si salta
ORE_CALIBRAZIONE = 24
TOLLERANZA_PENDENZA = 0.10        # pendenza di calibrazione entro 1 ± 0,10: «calibrata nella pendenza» (convenzione)
MIN_FASCE_PENDENZA = 3            # sotto tre fasce misurabili la pendenza di calibrazione non si legge (convenzione)
VERSIONE = 3                      # cambia con le convenzioni: una cache scritta con altre regole non si riusa

FAMIGLIE_CAL = {                  # nome → (tipo, orizzonte, distanze della soglia dal prezzo)
    "chiude_sopra_20": ("chiude_sopra", 20, (0.0,)),
    "chiude_sopra_60": ("chiude_sopra", 60, (0.0,)),
    "tocca_su_20": ("tocca_su", ORIZZONTE_MOSSA, (MOSSA,)),
    "tocca_giu_20": ("tocca_giu", ORIZZONTE_MOSSA, (-MOSSA,)),
    **{f"carico_{h}": ("tocca_su", h, SCALA_CARICO) for h in ORIZZONTI_CARICO},
}
NOMI_FAMIGLIE = {
    "chiude_sopra_20": "sopra il prezzo di oggi fra 20 sedute",
    "chiude_sopra_60": "sopra il prezzo di oggi fra 60 sedute",
    "tocca_su_20": "tocca +10% entro 20 sedute",
    "tocca_giu_20": "tocca -10% entro 20 sedute",
    **{f"carico_{h}": f"tocca un livello sopra (+5/10/25/50/100%) entro {h} sedute — vicina al carico"
       for h in ORIZZONTI_CARICO},
}
OPZIONI_NON_MISURATE = ("affidabilita' non ancora misurata: le opzioni non hanno storia nel sistema, si misura solo "
                        "dal vivo, dal registro delle previsioni risolte")


# ───────────────────────── la formula, una sola per i due metodi ─────────────────────────

def _N(x):
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def p_finisce_oltre(S0, K, s, verso="su"):
    """P(prezzo all'orizzonte oltre K) con deriva zero (martingala): su = sopra K, giu = sotto K. s = deviazione
    standard del logaritmo all'orizzonte (sigma × radice del tempo). A volatilita' zero il prezzo resta S0."""
    if s is None or not s > 0:
        return 1.0 if (S0 > K if verso == "su" else S0 < K) else 0.0
    d2 = (math.log(S0 / K) - s * s / 2) / s
    return _N(d2) if verso == "su" else _N(-d2)


def p_tocca(S0, K, s, verso="su"):
    """P(tocca K entro l'orizzonte) col principio di riflessione per il logaritmo con deriva -s²/2 (la martingala):
    su N(d2) + (S/K)·N(d1), giu N(-d2) + (S/K)·N(-d1), d1 = d2 + s — circa 2 × P(finisce oltre), fra quella e 1
    (APPROSSIMAZIONE: percorsi continui). Una soglia gia' dalla parte giusta e' toccata: 1."""
    if (verso == "su" and S0 >= K) or (verso == "giu" and S0 <= K):
        return 1.0
    if s is None or not s > 0:
        return 0.0
    d2 = (math.log(S0 / K) - s * s / 2) / s
    d1 = d2 + s
    p = _N(d2) + S0 / K * _N(d1) if verso == "su" else _N(-d2) + S0 / K * _N(-d1)
    return min(1.0, max(p, p_finisce_oltre(S0, K, s, verso)))


def probabilita(tipo, S0, K, s):
    if tipo == "chiude_sopra":
        return p_finisce_oltre(S0, K, s, "su")
    if tipo == "tocca_su":
        return p_tocca(S0, K, s, "su")
    if tipo == "tocca_giu":
        return p_tocca(S0, K, s, "giu")
    raise ValueError(tipo)


def sigme(c, finestra=FINESTRA):
    """La volatilita' realizzata giornaliera a ogni seduta i, col SOLO passato: i log-rendimenti delle sedute
    i-finestra+1 … i (chiusure i-finestra … i), radice della media dei quadrati (deriva zero). NaN prima."""
    c = np.asarray(c, dtype=float)
    out = np.full(len(c), np.nan)
    if len(c) <= finestra:
        return out
    with np.errstate(divide="ignore", invalid="ignore"):
        r2 = np.diff(np.log(c)) ** 2
    cs = np.concatenate([[0.0], np.cumsum(r2)])
    i = np.arange(finestra, len(c))
    out[finestra:] = np.sqrt((cs[i] - cs[i - finestra]) / finestra)
    return out


def _sigma_chi2(sig, n=FINESTRA, z=A.Z):
    """(basso, alto) della volatilita' stimata su n rendimenti, chi-quadro con n gradi (Wilson-Hilferty), al 95%:
    l'incertezza della STIMA con rendimenti normali — le code grasse la allargano, l'errore del modello no."""
    def q(zz):
        return n * (1 - 2 / (9 * n) + zz * math.sqrt(2 / (9 * n))) ** 3
    return sig * math.sqrt(n / q(z)), sig * math.sqrt(n / q(-z))


def intervallo_lognormale(tipo, S0, K, sig, h, n=FINESTRA):
    """(min, max) della probabilita' al variare della volatilita' dentro il suo intervallo di stima (21 punti: la
    probabilita' non e' sempre monotona nella volatilita')."""
    if not sig > 0:
        return None
    lo, hi = _sigma_chi2(sig, n)
    ps = [probabilita(tipo, S0, K, (lo + (hi - lo) * k / 20) * math.sqrt(h)) for k in range(21)]
    return min(ps), max(ps)


# ───────────────────────── il calendario delle sedute di New York ─────────────────────────

def _pasqua(a):
    """La domenica di Pasqua (algoritmo gregoriano anonimo)."""
    g, b, c = a % 19, a // 100, a % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    h = (19 * g + b - d - (b - f + 1) // 3 + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (g + 11 * h + 22 * m) // 451
    return date(a, (h + m - 7 * n + 114) // 31, (h + m - 7 * n + 114) % 31 + 1)


def _ennesimo(anno, mese, giorno_sett, n):
    """L'n-esimo giorno della settimana del mese (n = -1: l'ultimo)."""
    if n > 0:
        d = date(anno, mese, 1)
        return d + timedelta(days=(giorno_sett - d.weekday()) % 7 + 7 * (n - 1))
    d = date(anno + (mese == 12), mese % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - giorno_sett) % 7)


def _osservato(d):
    return d - timedelta(days=1) if d.weekday() == 5 else (d + timedelta(days=1) if d.weekday() == 6 else d)


_FESTIVI = {}


def festivi_nyse(anno):
    """Le chiusure REGOLARI della borsa di New York: Capodanno (di domenica il lunedi'; di sabato nessuna chiusura),
    Martin Luther King, Presidenti, Venerdi' Santo, Memorial Day, Juneteenth (dal 2022), Indipendenza, Labor Day,
    Ringraziamento, Natale, coi giorni osservati. Le chiusure straordinarie non sono note (dichiarato)."""
    if anno not in _FESTIVI:
        f = set()
        capo = date(anno, 1, 1)
        if capo.weekday() == 6:
            f.add(capo + timedelta(days=1))
        elif capo.weekday() < 5:
            f.add(capo)
        f |= {_ennesimo(anno, 1, 0, 3), _ennesimo(anno, 2, 0, 3), _pasqua(anno) - timedelta(days=2),
              _ennesimo(anno, 5, 0, -1), _ennesimo(anno, 9, 0, 1), _ennesimo(anno, 11, 3, 4),
              _osservato(date(anno, 7, 4)), _osservato(date(anno, 12, 25))}
        if anno >= 2022:
            f.add(_osservato(date(anno, 6, 19)))
        _FESTIVI[anno] = f
    return _FESTIVI[anno]


def e_seduta(d):
    return d.weekday() < 5 and d not in festivi_nyse(d.year)


def sedute_dopo(dal, h):
    """La data della seduta n. h DOPO `dal` (dal esclusa), col calendario della borsa."""
    d = date.fromisoformat(str(dal)[:10])
    k = 0
    while k < h:
        d += timedelta(days=1)
        k += e_seduta(d)
    return d


def ultima_seduta_conclusa(adesso):
    """L'ultima seduta di New York gia' chiusa alle 16:00, col fuso (v470)."""
    ny = adesso.astimezone(P.NEW_YORK)
    d = ny.date()
    if not (e_seduta(d) and ny.hour >= 16):
        d -= timedelta(days=1)
        while not e_seduta(d):
            d -= timedelta(days=1)
    return d


def scadenza_per(orizzonte, scadenze):
    """La scadenza LISTATA piu' vicina che copre l'orizzonte (>= la data della seduta dell'orizzonte): mai una piu'
    corta. None se nessuna lo copre: allora il metodo non risponde (v396)."""
    o = str(orizzonte)[:10]
    dopo = sorted(s for s in set(scadenze) if s >= o)
    return dopo[0] if dopo else None


# ───────────────────────── l'esito di un evento sulle barre ─────────────────────────

def esito(b, i, tipo, soglia, h):
    """L'esito dell'evento detto alla chiusura della seduta i, con le sedute i+1 … i+h (la semantica di
    affidabilita.evento_prezzo): None se le barre non arrivano ancora all'orizzonte (un buco non e' un NO, v205)."""
    if i + h >= len(b):
        return None
    if tipo == "chiude_sopra":
        return b[i + h]["c"] > soglia
    if tipo == "tocca_su":
        return max(x["h"] for x in b[i + 1:i + h + 1]) >= soglia
    if tipo == "tocca_giu":
        return min(x["l"] for x in b[i + 1:i + h + 1]) <= soglia
    raise ValueError(tipo)


def _prepara(Bs):
    out = {}
    for tk, b in Bs.items():
        if not b:
            continue
        out[tk] = {"c": np.array([x["c"] for x in b], dtype=float),
                   "h": np.array([x["h"] for x in b], dtype=float),
                   "l": np.array([x["l"] for x in b], dtype=float),
                   "t": np.array([str(x["t"])[:10] for x in b], dtype="datetime64[D]"), "esiti": {}}
    return out


def _esiti(a, tipo, d, h):
    """Gli esiti di ogni seduta i (0 … n-h-1) per la soglia prezzo × (1 + d): la stessa semantica di esito()."""
    k = (tipo, d, h)
    if k not in a["esiti"]:
        c = a["c"]
        n = len(c)
        if n <= h:
            y = np.zeros(0, dtype=bool)
        else:
            K = c[:n - h] * (1 + d)
            if tipo == "chiude_sopra":
                y = c[h:] > K
            elif tipo == "tocca_su":
                y = sliding_window_view(a["h"][1:], h).max(axis=1) >= K
            else:
                y = sliding_window_view(a["l"][1:], h).min(axis=1) <= K
        a["esiti"][k] = y
    return a["esiti"][k]


def _tabella_base(arr, tipo, d, h):
    """Gli esiti di TUTTI i giorni dell'universo ordinati per DATA DI RISOLUZIONE (la seduta i+h, v207)."""
    dd, yy = [], []
    for a in arr.values():
        y = _esiti(a, tipo, d, h)
        if len(y):
            dd.append(a["t"][h:])
            yy.append(y)
    if not dd:
        return None
    t = np.concatenate(dd)
    y = np.concatenate(yy).astype(float)
    o = np.argsort(t, kind="stable")
    return t[o], np.concatenate([[0.0], np.cumsum(y[o])]), np.unique(t)


def _base_al(tab, t):
    """La base alla data t: la frequenza dell'evento fra le prove dell'universo gia' RISOLTE (risoluzione <= t).
    (frequenza, casi); None se le date di risoluzione sono meno di MIN_DATE_BASE."""
    if tab is None:
        return None, 0
    date_, cum, uniche = tab
    t = np.datetime64(str(t)[:10], "D")
    k = int(np.searchsorted(date_, t, side="right"))
    if int(np.searchsorted(uniche, t, side="right")) < MIN_DATE_BASE or not k:
        return None, k
    return float(cum[k] / k), k


# ───────────────────────── la calibrazione walk-forward del lognormale ─────────────────────────

def _calibra(Bs, famiglie=FAMIGLIE_CAL, sig_fn=sigme, finestra=FINESTRA, passo=PASSO, riscaldamento=RISCALDAMENTO):
    """{famiglia: [prove]}: per ogni titolo una data ogni `passo` sedute dopo il riscaldamento, la probabilita' con
    la volatilita' del solo passato, la base del solo passato, l'esito vero."""
    arr = _prepara(Bs)
    for a in arr.values():
        a["sig"] = sig_fn(a["c"], finestra)
    out = {}
    for f, (tipo, h, distanze) in famiglie.items():
        righe = []
        for d in distanze:
            tab = _tabella_base(arr, tipo, d, h)
            for tk, a in arr.items():
                y = _esiti(a, tipo, d, h)
                for i in range(riscaldamento, len(a["c"]) - h, passo):
                    s = a["sig"][i]
                    if not np.isfinite(s):
                        continue
                    base, _ = _base_al(tab, a["t"][i])
                    if base is None:
                        continue
                    S0 = float(a["c"][i])
                    righe.append({"tk": tk, "t": str(a["t"][i]), "d": d, "base": base, "y": bool(y[i]),
                                  "p": probabilita(tipo, S0, S0 * (1 + d), float(s) * math.sqrt(h))})
        out[f] = righe
    return out


def _pendenza(ps, ys):
    """La pendenza di calibrazione: la regressione logistica dell'esito sul logit della probabilita' detta (Newton).
    1 = calibrata; sotto 1 le probabilita' sono troppo ESTREME (sovraconfidente); sopra 1 troppo TIMIDE."""
    if len(ps) < A.MIN_VALUTAZIONE or len(set(ys)) < 2:
        return None
    p = np.clip(np.asarray(ps, dtype=float), 1e-4, 1 - 1e-4)
    X = np.column_stack([np.ones(len(p)), np.log(p / (1 - p))])
    y = np.asarray(ys, dtype=float)
    w = np.zeros(2)
    for _ in range(50):
        m = 1 / (1 + np.exp(-(X @ w)))
        H = X.T @ (X * (m * (1 - m))[:, None])
        try:
            passo = np.linalg.solve(H, X.T @ (y - m))
        except np.linalg.LinAlgError:
            return None
        w += passo
        if np.max(np.abs(passo)) < 1e-9:
            break
    return float(w[1]) if np.all(np.isfinite(w)) else None


def verso_di(pendenza):
    if pendenza is None:
        return "pendenza non misurabile (probabilita' dette in meno di tre fasce)"
    if abs(pendenza - 1) <= TOLLERANZA_PENDENZA:
        return "calibrata nella pendenza"
    return "sovraconfidente (probabilita' troppo estreme)" if pendenza < 1 else "sottoconfidente (probabilita' troppo timide)"


def misura(righe):
    ps = [r["p"] for r in righe]
    ys = [r["y"] for r in righe]
    v = A.valuta(ps, ys, basi=[r["base"] for r in righe])
    # una pendenza si legge solo se le probabilita' dette si allargano su almeno MIN_FASCE_PENDENZA fasce misurabili:
    #   «sopra il prezzo di oggi» col lognormale a deriva zero sta tutto fra 40 e 50% (N(-s/2)), e la regressione
    #   su una nuvola senza ampiezza da' un numero qualsiasi (misurato: -0,52 a 60 sedute)
    larghe = sum(1 for f in v["fasce"] if f["misurabile"]) >= MIN_FASCE_PENDENZA
    pend = _pendenza(ps, ys) if larghe else None
    n = len(righe)
    return {"valutazione": v, "media_p": sum(ps) / n if n else None, "frequenza": sum(ys) / n if n else None,
            "media_base": sum(r["base"] for r in righe) / n if n else None, "pendenza": pend, "verso": verso_di(pend),
            "dal": min((r["t"] for r in righe), default=None), "al": max((r["t"] for r in righe), default=None),
            "titoli": len({r["tk"] for r in righe})}


def _concluse(b, adesso):
    return b[:-1] if b and brief.barra_in_formazione(b, adesso) else b


def veicoli_pipeline(nomi):
    """{ticker: veicolo} dal registro SEC della pipeline (rotazione.veicolo_pipeline, v492), dal disco: mai la rete.
    Un fallimento lascia {} e lo si dichiara nella calibrazione."""
    try:
        d = __import__("fonti_titoli").carica()
        return {tk: __import__("rotazione").veicolo_pipeline(d, tk) for tk in nomi}
    except Exception:
        return {}


def serie_universo(B, veicoli, adesso, escludi=(S.RIFERIMENTO,)):
    """L'universo delle prove: la serie della societa' di oggi di ogni nome (statistica.serie, v492), senza la
    seduta in corso (v471) e senza il riferimento, come la base della statistica."""
    return {tk: S.serie(_concluse(b, adesso), (veicoli or {}).get(tk)) for tk, b in B.items()
            if b and tk not in escludi}


def calibrazione_lognormale(B, veicoli=None, adesso=None, usa_cache=True, percorso=CACHE_CAL):
    """La calibrazione walk-forward del lognormale su B ({ticker: barre}), famiglia per famiglia, misurata con
    affidabilita.valuta. Riusata dalla cache se ha meno di 24 ore ed e' dello stesso universo e delle stesse regole."""
    adesso = adesso or datetime.now(timezone.utc)
    universo = sorted(tk for tk, b in B.items() if b and tk != S.RIFERIMENTO)
    if usa_cache:
        try:
            c = json.load(open(percorso, encoding="utf-8"))
            eta = (adesso - datetime.fromisoformat(c["scritto"])).total_seconds() / 3600
            if 0 <= eta < ORE_CALIBRAZIONE and c.get("versione") == VERSIONE and c.get("universo") == universo:
                c["da_cache"] = True
                return c
        except Exception:
            pass
    if veicoli is None:
        veicoli = veicoli_pipeline(universo)
    letti = bool(veicoli)
    Bs = serie_universo(B, veicoli, adesso)
    prove = _calibra(Bs)
    out = {"scritto": adesso.isoformat(timespec="minutes"), "versione": VERSIONE, "universo": universo,
           "fino": max((b[-1]["t"][:10] for b in Bs.values() if b), default=None),
           "veicoli": "letti dal registro SEC della pipeline" if letti else
           "NON letti: i periodi dei veicoli di quotazione restano nella serie",
           "tagliati": {tk: Bs[tk][0]["t"][:10] for tk in Bs if Bs[tk] and B[tk] and Bs[tk][0]["t"] != B[tk][0]["t"]},
           "convenzioni": {"finestra": FINESTRA, "riscaldamento": RISCALDAMENTO, "passo": PASSO, "deriva": "zero",
                           "scala_carico": list(SCALA_CARICO), "min_date_base": MIN_DATE_BASE},
           "famiglie": {f: misura(r) for f, r in prove.items()}, "da_cache": False}
    if usa_cache:
        try:
            os.makedirs(os.path.dirname(percorso), exist_ok=True)
            json.dump(out, open(percorso, "w", encoding="utf-8"))
        except Exception:
            pass
    return out


# ───────────────────────── le catene delle opzioni ─────────────────────────

def _compatta(j, tk, adesso):
    """Di una catena CBOE solo cio' che serve: il prezzo (la regola di posizionamento.riepilogo), l'ora della quota e
    (scadenza, tipo, strike, volatilita' implicita) dei contratti vivi con una volatilita' sopra zero."""
    import analisi
    oggi = adesso.astimezone(P.NEW_YORK).date()
    rie = P.riepilogo(j, tk, oggi, None, analisi.fase(adesso) == "seduta")
    if not rie or not rie.get("spot"):
        return None
    righe = [[c["scad"], c["tipo"], c["strike"], float(c["iv"])] for c in P.contratti(j, tk)
             if c["scad"] >= oggi.isoformat() and (c.get("iv") or 0) > 0]
    if not righe:
        return None
    return {"letto": adesso.isoformat(timespec="seconds"), "spot": rie["spot"],
            "quota": ((j.get("data") or {}).get("last_trade_time")), "contratti": righe}


def catene(nomi, adesso, rete=True, leggi=None, percorso=CACHE_OPZ):
    """{ticker: (catena compatta | None, perche')}: una lettura per simbolo e per giro (la memoria del giro vale
    fonti_dirette.VALIDITA_MINUTI), in parallelo con il limite di posizionamento (fonti gratuite: non si martellano)."""
    from fonti_dirette import VALIDITA_MINUTI
    leggi = leggi or P._catena
    try:
        mem = (json.load(open(percorso, encoding="utf-8")).get("catene") or {}) if percorso else {}
    except Exception:
        mem = {}
    out, da_leggere = {}, []
    for tk in nomi:
        m = mem.get(tk)
        try:
            eta = (adesso - datetime.fromisoformat(m["letto"])).total_seconds() / 60 if m else None
        except Exception:
            eta = None
        if eta is not None and 0 <= eta <= VALIDITA_MINUTI:
            out[tk] = (m, "memoria del giro")
        else:
            da_leggere.append(tk)
    if not rete:
        for tk in da_leggere:
            out[tk] = (None, "non letta: senza rete e senza una lettura del giro")
        return out
    with ThreadPoolExecutor(P.PARALLELI) as ex:
        lette = list(ex.map(leggi, da_leggere))
    for tk, j, err in lette:
        c = None
        if j is not None:
            try:
                c = _compatta(j, tk, adesso)
            except Exception as e:  # noqa: BLE001
                err = type(e).__name__
        out[tk] = (c, "letta adesso" if c else f"CBOE non disponibile ({err or 'catena senza contratti utili'})")
        if c:
            mem[tk] = c
    if percorso:                       # percorso None: nessuna memoria (le verifiche non scrivono file)
        try:
            os.makedirs(os.path.dirname(percorso), exist_ok=True)
            json.dump({"catene": mem}, open(percorso, "w", encoding="utf-8"))
        except Exception:
            pass
    return out


def contratto_vicino(cat, scad, K):
    """(strike, tipo, iv) alla scadenza: lo strike piu' vicino alla soglia (a parita' il piu' basso, come
    movimento_implicito), il contratto fuori dal denaro a quello strike, l'altro se quello manca."""
    alla = [r for r in cat["contratti"] if r[0] == scad]
    if not alla:
        return None
    k = min(sorted({r[2] for r in alla}), key=lambda x: abs(x - K))
    tipi = {r[1]: r[3] for r in alla if r[2] == k}
    primo = "C" if k >= cat["spot"] else "P"
    for t in (primo, "P" if primo == "C" else "C"):
        if t in tipi:
            return k, t, tipi[t]
    return None


# ───────────────────────── le previsioni di oggi ─────────────────────────

def eventi_di(tk, S0, pmc, dal):
    """(tipo, soglia, orizzonte, famiglia di calibrazione, frase, distanza) — gli eventi comuni ai metodi, con la
    STESSA frase e la stessa soglia dei casi simili (previsioni_titoli): la chiave soggetto|evento li affianca."""
    gma = f"{dal[8:10]}/{dal[5:7]}/{dal[0:4]}"
    ev = [("chiude_sopra", S0, h, f"chiude_sopra_{h}", f"{tk} sopra {S._n(S0, 2)} (la chiusura del {gma}) fra {h} sedute")
          for h in ORIZZONTI_PREZZO]
    for verso, m in (("tocca_su", MOSSA), ("tocca_giu", -MOSSA)):
        K = S0 * (1 + m)
        ev.append((verso, K, ORIZZONTE_MOSSA, f"{verso}_{ORIZZONTE_MOSSA}",
                   f"{tk} tocca {S._n(K, 2)} ({S._n(100 * m, 0, True)}%) entro {ORIZZONTE_MOSSA} sedute"))
    if pmc and S0 < pmc:
        ev += [("tocca_su", pmc, h, f"carico_{h}",
                f"{tk} tocca il carico {S._n(pmc, 2)} ({S._n((pmc / S0 - 1) * 100, 1, True)}%) entro {h} sedute")
               for h in ORIZZONTI_CARICO]
    return [(t, K, h, f, fr, K / S0 - 1) for t, K, h, f, fr in ev]


def previsioni_oggi(B, posiz, adesso=None, rete=True, calibrazione=None, veicoli=None, assenze=None, leggi=None,
                    percorso_opzioni=CACHE_OPZ):
    """I record affidabilita.previsione dei due metodi per ogni posizione in dollari di `posiz` (brief.leggi_libro:
    tk, qta, pmc) e per ogni evento comune. Il risolutore e' evento_prezzo con dal = l'ultima seduta conclusa delle
    barre. Le assenze (nome senza barre, catena non letta, scadenza che non copre) vanno in `assenze`, se passata."""
    adesso = adesso or datetime.now(timezone.utc)
    assenze = assenze if assenze is not None else []
    if veicoli is None:
        veicoli = veicoli_pipeline(sorted(B))
    if calibrazione is None:
        calibrazione = calibrazione_lognormale(B, veicoli=veicoli, adesso=adesso)
    fam = (calibrazione or {}).get("famiglie") or {}
    arr = _prepara(serie_universo(B, veicoli, adesso))
    scritto = adesso.astimezone(timezone.utc).isoformat(timespec="minutes")
    titoli = [p for p in posiz if p.get("valuta", "USD") == "USD"]
    for p in posiz:
        if p not in titoli:
            assenze.append((p["tk"], "non e' un titolo in dollari: nessuna barra, nessuna previsione di prezzo"))
    cat = catene([p["tk"] for p in titoli], adesso, rete, leggi, percorso_opzioni)
    tabelle, out = {}, []
    for p in titoli:
        tk = p["tk"]
        b = S.serie(_concluse(B.get(tk), adesso), veicoli.get(tk)) if B.get(tk) else []
        if len(b) <= FINESTRA:
            assenze.append((tk, "barre NON lette" if not b else f"{len(b)} sedute: la volatilita' a {FINESTRA} non si misura"))
            continue
        dal, S0 = b[-1]["t"][:10], float(b[-1]["c"])
        sig = float(sigme([x["c"] for x in b])[-1])
        c_tk, perche = cat.get(tk, (None, "non letta"))
        if not c_tk:
            assenze.append((tk, f"opzioni non disponibili: {perche}"))
        for tipo, K, h, f, frase, d in eventi_di(tk, S0, p.get("pmc"), dal):
            chiave = (tipo, round(d, 6), h)
            if chiave not in tabelle:
                tabelle[chiave] = _tabella_base(arr, tipo, d, h)
            base, n_base = _base_al(tabelle[chiave], dal)
            scade = sedute_dopo(dal, h).isoformat()
            ris = A.evento_prezzo(tk, tipo, K, dal, h)
            pl = probabilita(tipo, S0, K, sig * math.sqrt(h))
            v = (fam.get(f) or {}).get("valutazione")
            out.append(A.previsione(
                "titoli", tk, frase, pl, "lognormale", ris, scade=scade, base=base, n=FINESTRA,
                intervallo=intervallo_lognormale(tipo, S0, K, sig, h), scritto=scritto,
                extra={"prezzo": S0, "dal": dal, "sigma_giorno": sig, "sigma_anno": sig * math.sqrt(S.SEDUTE_ANNO),
                       "finestra": FINESTRA, "deriva": "zero", "distanza": d, "famiglia_calibrazione": f,
                       "casi_base": n_base, "approssimazione": "riflessione" if tipo != "chiude_sopra" else None,
                       "affidabilita": A.riga_affidabilita(pl, v, "lognormale")}))
            if not c_tk:
                continue
            E = scadenza_per(scade, {r[0] for r in c_tk["contratti"]})
            ct = contratto_vicino(c_tk, E, K) if E else None
            if not ct:
                assenze.append((tk, f"opzioni: nessuna scadenza listata copre {frase.split(' ', 1)[1]}" if not E
                                else f"opzioni: nessuno strike con volatilita' alla scadenza {E}"))
                continue
            T = P.anni_alla_scadenza(scade, adesso)
            po = probabilita(tipo, c_tk["spot"], K, ct[2] * math.sqrt(T))
            out.append(A.previsione(
                "titoli", tk, frase, po, "opzioni", ris, scade=scade, base=base, n=None, scritto=scritto,
                extra={"prezzo": c_tk["spot"], "quota": c_tk["quota"], "letto": c_tk["letto"], "scadenza": E,
                       "strike": ct[0], "contratto": "call" if ct[1] == "C" else "put", "iv": ct[2], "anni": T,
                       "distanza": d, "misura": "neutrale al rischio (tasso zero, senza dividendi): non una frequenza",
                       "approssimazione": "riflessione" if tipo != "chiude_sopra" else None,
                       "affidabilita": OPZIONI_NON_MISURATE}))
    return out


# ───────────────────────── la resa ─────────────────────────

def _pc(x):
    if x is None:
        return "n.d."
    if 0 < x < 0.005:
        return "<1%"
    if 0.995 < x < 1:
        return ">99%"
    return S._n(100 * x, 0) + "%"


def righe_calibrazione(cal):
    if not cal or not cal.get("famiglie"):
        return ["  calibrazione del lognormale: NON disponibile"]
    L = [f"  calibrazione walk-forward del lognormale (al {P._gma(cal.get('fino'))}, {len(cal['universo'])} nomi, "
         f"veicoli {cal.get('veicoli')}): ⚠ i nomi sono quelli seguiti OGGI, cioe' anche sopravvissuti; le prove dello "
         f"stesso giorno si muovono insieme, e gli intervalli che le trattano come indipendenti sono troppo stretti"]
    for f, m in cal["famiglie"].items():
        v = m["valutazione"]
        if not v["n"]:
            L.append(f"    {NOMI_FAMIGLIE[f]}: nessuna prova")
            continue
        L.append(f"    {NOMI_FAMIGLIE[f]}: Brier {S._n(v['brier'], 3)} (base {S._n(v['brier_base'], 3)}) · abilita' "
                 f"{S._n(v['abilita'], 3, True)} · ECE {S._n(v['ece'], 3)} · detto in media {_pc(m['media_p'])}, "
                 f"avverato {_pc(m['frequenza'])} · pendenza {S._n(m['pendenza'], 2)}: {m['verso']} · {v['n']} prove")
    return L


def resa(previsioni, calibrazione, assenze=None):
    """Righe brevi: le convenzioni, la calibrazione, e per ogni evento i due metodi AFFIANCATI con la base."""
    L = ["PREVISIONI DI PREZZO — probabilita', non fatti (eccezione misurata del 03/11/2026): due metodi affiancati, "
         "mai mediati (v200)",
         f"  lognormale: volatilita' realizzata delle ultime {FINESTRA} sedute, deriva zero (nessuna tendenza "
         "proiettata); «tocca» dal principio di riflessione, circa 2 × «finisce oltre» (approssimazione: i salti la violano)",
         "  opzioni: probabilita' NEUTRALE AL RISCHIO dalla volatilita' implicita CBOE (scadenza che copre l'orizzonte, "
         f"strike piu' vicino alla soglia, tasso zero): la misura del mercato, non una frequenza — {OPZIONI_NON_MISURATE}"]
    L += righe_calibrazione(calibrazione)
    if previsioni:
        dal = max(p["risolutore"]["dal"] for p in previsioni)
        L.append(f"  le soglie partono dalla chiusura del {P._gma(dal)}; le opzioni guardano al prezzo della loro lettura")
    per = {}
    for p in previsioni:
        per.setdefault(p["soggetto"], {}).setdefault(p["evento"], {})[p["metodo"]] = p
    fam = (calibrazione or {}).get("famiglie") or {}
    for tk, ev in per.items():
        x = next(iter(ev.values()))
        lg, op = x.get("lognormale"), x.get("opzioni")
        testa = f"  {tk}"
        if lg:
            testa += f" — chiusura {S._n(lg['extra']['prezzo'], 2)}, volatilita' {S._n(100 * lg['extra']['sigma_anno'], 0)}% annua"
        if op:
            testa += (f" · opzioni al prezzo {S._n(op['extra']['prezzo'], 2)} "
                      f"({str(op['extra'].get('quota') or op['extra']['letto'])[:16].replace('T', ' ')} NY)")
        L.append(testa)
        for evento, m in ev.items():
            r = []
            lg, op = m.get("lognormale"), m.get("opzioni")
            if lg:
                iv = lg.get("intervallo")
                f_ = A.fascia_di(lg["probabilita"], (fam.get(lg["extra"]["famiglia_calibrazione"]) or {}).get("valutazione"))
                aff = (f"; detto {_pc(f_['da'])}-{_pc(f_['a'])} → avverato {_pc(f_['frequenza'])} su {f_['n']}"
                       if f_ and f_["misurabile"] else "; fascia non misurabile")
                r.append(f"lognormale {_pc(lg['probabilita'])}" + (f" [{_pc(iv[0])}-{_pc(iv[1])}]" if iv else "") + aff)
            if op:
                e = op["extra"]
                r.append(f"opzioni {_pc(op['probabilita'])} (impl. {S._n(100 * e['iv'], 0)}%, {e['contratto']} "
                         f"{S._n(e['strike'], 2)}, scad. {P._gm(e['scadenza'])})")
            else:
                r.append("opzioni non disponibili")
            base = (lg or op or {}).get("base")
            L.append(f"    {evento.split(' ', 1)[1]} ({P._gm((lg or op)['scade'])}): " + " · ".join(r)
                     + f" · base {_pc(base)}")
    for tk, perche in assenze or []:
        L.append(f"  ⚠ {tk}: {perche}")
    return L


# ───────────────────────── le verifiche ─────────────────────────

def _fixture(seme, n=700, inizio="2023-01-02", vol=(0.02, 0.04), spezza=350):
    """Barre sintetiche deterministiche: una passeggiata lognormale con due regimi di volatilita'."""
    import random
    g = random.Random(seme)
    d, c, out = date.fromisoformat(inizio), 100.0, []
    while len(out) < n:
        if e_seduta(d):
            s = vol[0] if len(out) < spezza else vol[1]
            o = c
            c = c * math.exp(g.gauss(0, s))
            out.append({"t": d.isoformat(), "h": max(o, c) * math.exp(abs(g.gauss(0, s / 2))),
                        "l": min(o, c) * math.exp(-abs(g.gauss(0, s / 2))), "c": c, "v": 1, "a": c})
        d += timedelta(days=1)
    return out


def _perturba(b, dopo):
    """Le barre DOPO la data `dopo` sostituite da un futuro diverso (salti dieci volte piu' larghi)."""
    out, k = [], None
    for x in b:
        if x["t"] <= dopo:
            out.append(dict(x))
            k = x["c"]
            continue
        f = 1.6 if (len(out) % 2) else 0.6
        y = {**x, "c": k * f}
        y["h"], y["l"], y["a"] = y["c"] * 1.05, y["c"] * 0.95, y["c"]
        out.append(y)
    return out


def _sigme_sbirciata(c, finestra=FINESTRA):
    """Il DIFETTO da trovare: alla seduta i la volatilita' della seduta i+1 (una seduta di futuro)."""
    s = sigme(c, finestra)
    return np.concatenate([s[1:], [np.nan]])


def _invariata(Bs, dopo, sig_fn):
    """Vero se ogni prova detta entro `dopo` ha la stessa probabilita' e la stessa base con un futuro diverso."""
    a = _calibra(Bs, sig_fn=sig_fn)
    b = _calibra({tk: _perturba(x, dopo) for tk, x in Bs.items()}, sig_fn=sig_fn)
    diverse = tot = 0
    for f in a:
        ia = {(r["tk"], r["t"], r["d"]): r for r in a[f] if r["t"] <= dopo}
        ib = {(r["tk"], r["t"], r["d"]): r for r in b[f] if r["t"] <= dopo}
        tot += len(ia)
        diverse += len(set(ia) ^ set(ib)) + sum(abs(ia[k]["p"] - ib[k]["p"]) > 1e-12
                                                or abs(ia[k]["base"] - ib[k]["base"]) > 1e-12 for k in ia if k in ib)
    return diverse == 0 and tot > 0, tot, diverse


def verifiche():
    """(nome, esito, dettaglio) — fixture sintetiche, nessuna rete, nessun file."""
    V = []
    # (a) volatilita' zero: una soglia sopra il prezzo non si supera (0), una sotto e' gia' superata (1)
    piatta = [100.0] * 80
    s0 = float(sigme(piatta)[-1])
    a_ok = (s0 == 0 and p_finisce_oltre(100, 110, s0 * math.sqrt(20)) == 0.0
            and p_finisce_oltre(100, 90, s0 * math.sqrt(20)) == 1.0 and p_tocca(100, 110, 0.0, "su") == 0.0
            and p_tocca(100, 90, 0.0, "giu") == 0.0 and p_finisce_oltre(100, 90, 0.0, "giu") == 0.0)
    V.append(("(a) a volatilita' zero: sopra il prezzo 0, sotto 1 (e nessun tocco)", a_ok, f"sigma {s0}"))
    # (b) riflessione: P(tocca) >= P(chiude oltre) e <= 1, su una griglia
    b_ok, prove = True, 0
    for K in (50, 80, 95, 99.9, 100, 100.1, 105, 120, 200):
        for s in (0.001, 0.05, 0.2, 0.5, 1.5):
            for verso in ("su", "giu"):
                pf, pt = p_finisce_oltre(100, K, s, verso), p_tocca(100, K, s, verso)
                b_ok &= pf - 1e-15 <= pt <= 1.0 and 0.0 <= pf <= 1.0
                prove += 1
    V.append(("(b) riflessione: P(tocca) >= P(finisce oltre) e <= 1", b_ok, f"{prove} combinazioni"))
    # la riflessione contro una simulazione della stessa passeggiata (deriva -s²/2, 4.000 percorsi da 400 passi): il
    #   massimo osservato a passi discreti sta sotto quello continuo, e si corregge spostando la soglia di 0,5826
    #   deviazioni di un passo (Broadie-Glasserman). La prova distingue la formula dal «2 volte» secco
    g = np.random.default_rng(535)
    s, n_p = 0.25, 400
    x = np.cumsum(g.normal(-s * s / 2 / n_p, s / math.sqrt(n_p), size=(4000, n_p)), axis=1)
    mc_su, mc_giu = float(np.mean(x.max(axis=1) >= math.log(1.1))), float(np.mean(x.min(axis=1) <= math.log(0.9)))
    sp = math.exp(0.5826 * s / math.sqrt(n_p))
    an_su, an_giu = p_tocca(100, 110 * sp, s, "su"), p_tocca(100, 90 / sp, s, "giu")
    x2_su, x2_giu = 2 * p_finisce_oltre(100, 110 * sp, s, "su"), 2 * p_finisce_oltre(100, 90 / sp, s, "giu")
    V.append(("riflessione: la formula contro la simulazione della passeggiata (+10% e -10%), meglio del 2× secco",
              abs(mc_su - an_su) < 0.025 and abs(mc_giu - an_giu) < 0.025
              and abs(mc_su - x2_su) + abs(mc_giu - x2_giu) > abs(mc_su - an_su) + abs(mc_giu - an_giu),
              f"su {an_su:.3f} contro {mc_su:.3f} (2× {x2_su:.3f}), giu {an_giu:.3f} contro {mc_giu:.3f} (2× {x2_giu:.3f})"))
    # N(d2) con deriva zero: il prezzo atteso resta S0 (martingala) — controllo d'integrazione numerica grossolano
    s = 0.3
    xs = [(-6 + 12 * k / 4000) for k in range(4001)]
    att = sum(100 * math.exp(-s * s / 2 + s * z) * math.exp(-z * z / 2) / math.sqrt(2 * math.pi) * 12 / 4000 for z in xs)
    V.append(("deriva zero: il prezzo atteso della lognormale e' quello di oggi", abs(att - 100) < 0.01, f"{att:.4f}"))
    # (c) nessun futuro nella calibrazione
    Bs = {f"T{k}": _fixture(k) for k in range(3)}
    dopo = Bs["T0"][RISCALDAMENTO + 10 * PASSO]["t"]      # una data della griglia: la sbirciata vi cade dentro
    ok, tot, div = _invariata(Bs, dopo, sigme)
    ok_sb, _, div_sb = _invariata(Bs, dopo, _sigme_sbirciata)
    V.append(("(c) nessun futuro: le prove dette entro una data non cambiano se cambia il futuro (e il controllo cade "
              "con una volatilita' che guarda una seduta avanti)", ok and not ok_sb,
              f"{tot} prove dette entro il {dopo}: cambiate col futuro {div}, con una seduta di futuro {div_sb}"))
    # gli esiti vettoriali della calibrazione sono quelli del risolutore scalare
    a = _prepara({"T0": Bs["T0"]})["T0"]
    e_ok = True
    for tipo, d, h in (("chiude_sopra", 0.0, 20), ("tocca_su", 0.10, 20), ("tocca_giu", -0.10, 20), ("tocca_su", 0.5, 252)):
        y = _esiti(a, tipo, d, h)
        e_ok &= len(y) == len(Bs["T0"]) - h and all(
            bool(y[i]) == esito(Bs["T0"], i, tipo, Bs["T0"][i]["c"] * (1 + d), h) for i in range(0, len(y), 7))
    V.append(("esiti: la calibrazione usa la semantica di evento_prezzo (sedute i+1 … i+h)", e_ok, ""))
    # (d) la mappatura sedute → scadenza non sceglie una scadenza piu' corta dell'orizzonte
    oriz = sedute_dopo("2026-11-02", 20)
    scelta = scadenza_per(oriz, ["2026-11-27", "2026-11-30", "2026-12-02", "2026-12-04"])
    d_ok = oriz == date(2026, 12, 1) and scelta == "2026-12-02"       # il Ringraziamento sposta la ventesima seduta
    lista = [d_.isoformat() for d_ in (date(2026, 11, 6) + timedelta(days=k) for k in range(0, 400))
             if d_.weekday() in (0, 2, 4) and e_seduta(d_)][::3]
    for h in range(1, 300):
        o = sedute_dopo("2026-11-02", h).isoformat()
        e = scadenza_per(o, lista)
        d_ok &= (e is None and o > max(lista)) or (e is not None and e >= o and not any(o <= x < e for x in lista))
    d_ok &= scadenza_per("2099-01-01", lista) is None
    V.append(("(d) sedute → scadenza: la piu' vicina che copre l'orizzonte, mai una piu' corta (anche col festivo)",
              d_ok, f"20 sedute dal 02/11/2026 = {oriz.isoformat()} → {scelta}"))
    # il calendario: festivita' osservate e una seduta conclusa col fuso
    f26 = festivi_nyse(2026)
    cal_ok = (date(2026, 7, 3) in f26 and date(2026, 4, 3) in f26 and date(2026, 11, 26) in f26
              and date(2022, 12, 31) not in festivi_nyse(2022) and date(2022, 6, 20) in festivi_nyse(2022)
              and ultima_seduta_conclusa(datetime(2026, 11, 27, 10, 0, tzinfo=P.NEW_YORK)) == date(2026, 11, 25))
    V.append(("calendario: festivita' osservate e ultima seduta conclusa col fuso", cal_ok, ""))
    # le opzioni: senza catena nessun numero; con una catena a volatilita' piatta la stessa formula del lognormale
    adesso = datetime(2026, 11, 3, 15, 0, tzinfo=P.NEW_YORK)
    barre = {"TST": _fixture(7, n=400, inizio="2025-04-01"), **{f"U{k}": _fixture(10 + k, n=400, inizio="2025-04-01")
                                                               for k in range(2)}}
    dal = barre["TST"][-1]["t"]
    pos = [{"tk": "TST", "qta": 1, "pmc": barre["TST"][-1]["c"] * 1.3, "valuta": "USD"},
           {"tk": "XEUR", "qta": 1, "pmc": 100, "valuta": "EUR"}]

    def rotta(tk):
        return tk, None, "HTTP 503"
    ass = []
    pr = previsioni_oggi(barre, pos, adesso, rete=True, calibrazione={}, veicoli={}, assenze=ass, leggi=rotta,
                         percorso_opzioni=None)
    o_ok = (not any(p["metodo"] == "opzioni" for p in pr) and any("non disponibili" in x[1] for x in ass)
            and any(x[0] == "XEUR" for x in ass) and len(pr) == 7
            and all(p["risolutore"]["dal"] == dal and p["metodo"] == "lognormale" for p in pr))
    V.append(("opzioni: CBOE che non risponde → «non disponibile», nessun numero; lognormale sui 7 eventi", o_ok,
              f"{len(pr)} previsioni, {len(ass)} assenze"))
    S0 = barre["TST"][-1]["c"]
    oggi = adesso.date().isoformat()
    scad = ["2026-11-20", "2026-12-04", "2026-12-18", "2027-01-15", "2027-03-19", "2027-06-17", "2027-12-17"]
    strikes = [round(S0 * k / 20, 2) for k in range(10, 41)]
    sint = {"data": {"current_price": S0, "close": S0, "last_trade_time": oggi + "T14:45:00", "options": [
        {"option": f"TST{s[2:4]}{s[5:7]}{s[8:10]}{t}{int(round(k * 1000)):08d}", "iv": 0.5, "bid": 1, "ask": 1.1,
         "open_interest": 1, "volume": 1} for s in scad for k in strikes for t in "CP"]}}
    pr2 = previsioni_oggi(barre, pos[:1], adesso, rete=True, calibrazione={}, veicoli={}, assenze=[],
                          leggi=lambda tk: (tk, sint, None), percorso_opzioni=None)
    op = [p for p in pr2 if p["metodo"] == "opzioni"]
    f_ok = len(op) == 7
    for p in op:
        e, r = p["extra"], p["risolutore"]
        atteso = probabilita(r["tipo"], S0, r["soglia"], 0.5 * math.sqrt(P.anni_alla_scadenza(p["scade"], adesso)))
        vicino = min(sorted(strikes), key=lambda k: abs(k - r["soglia"]))
        f_ok &= (abs(p["probabilita"] - atteso) < 1e-12 and e["scadenza"] >= p["scade"] and e["strike"] == vicino
                 and e["contratto"] == ("call" if vicino >= S0 else "put"))
    V.append(("opzioni: stessa formula del lognormale con la volatilita' implicita, strike piu' vicino, fuori dal "
              "denaro, scadenza che copre", f_ok, f"{len(op)} previsioni dalle opzioni"))
    return V


def main(argv):
    ok = True
    for nome, e, det in verifiche():
        print(("PASS  " if e else "FAIL  ") + nome + (f" — {det}" if det else ""))
        ok &= bool(e)
    if argv and argv[0] == "oggi":
        adesso = datetime.now(timezone.utc)
        if "--barre" in argv:
            B = json.load(open(argv[argv.index("--barre") + 1], encoding="utf-8"))["barre"]
        else:
            nomi, _ = S.universo()
            B = S.leggi_barre(nomi, adesso)
        posiz = brief.leggi_libro()[0]
        veicoli = veicoli_pipeline(sorted(B))
        cal = calibrazione_lognormale(B, veicoli=veicoli, adesso=adesso)
        ass = []
        prev = previsioni_oggi(B, posiz, adesso, rete="--senza-rete" not in argv, calibrazione=cal, veicoli=veicoli,
                               assenze=ass)
        fine = max((p["risolutore"]["dal"] for p in prev), default=None)
        conclusa = ultima_seduta_conclusa(adesso).isoformat()
        if fine and fine < conclusa:
            ass.append(("barre", f"finiscono il {P._gma(fine)}, l'ultima seduta conclusa e' il {P._gma(conclusa)}: il "
                                 "lognormale guarda a quella data, le opzioni ad adesso"))
        print("\n".join(resa(prev, cal, ass)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
