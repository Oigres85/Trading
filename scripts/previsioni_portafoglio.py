#!/usr/bin/env python3
"""v535 — LE PREVISIONI DEL PORTAFOGLIO: la famiglia «portafoglio» del sistema previsionale.

Decisione del CEO del 03/11/2026: un sistema previsionale «stile Polymarket», con l'ECCEZIONE MISURATA alla sua
istruzione permanente n.1 («nessuna proiezione»): le previsioni entrano SOLO come probabilita', separate dai fatti,
ognuna col suo metodo, la sua base, il suo intervallo e l'affidabilita' MISURATA (scripts/affidabilita.py, la misura
comune: qui non se ne scrive un'altra, v161). Gli eventi del portafoglio:

- il SALVAVITA scatta (LIBRO.md §1ter: -30% dal massimo dell'azionario) entro 20 e 60 sedute;
- il portafoglio TORNA AL MASSIMO (quello del salvavita, il 09/10/2026) entro 60, 120 e 252 sedute;
- TUTTI I RAMI SECCHI tornano al carico entro 60, 120 e 252 sedute — un evento CONGIUNTO: si contano i percorsi in
  cui ognuno ci arriva, non si moltiplicano le probabilita' (i titoli si muovono insieme) — e, per confronto, ognuno
  da solo. I rami secchi sono RAMI_SECCHI qui sotto, IN ATTESA DELLA CONFERMA DEL CEO (LIBRO.md §1undecies, domanda
  del 03/11/2026), e il recupero si misura AL CARICO (il pmc di LIBRO.md §1): cambiati il nome o la misura, cambia
  l'evento.

IL METODO, uno solo ("simulazione"): bootstrap a BLOCCHI CIRCOLARE delle righe dei rendimenti giornalieri del
portafoglio di oggi (laboratorio.portafoglio: quantita' di LIBRO.md, ultime 252 sedute allineate per DATA, i nomi con
la storia corta fuori e nominati). Si estrae la RIGA INTERA — tutti i titoli dello stesso giorno —, cosi' le
correlazioni restano; a blocchi di BLOCCO sedute consecutive, cosi' resta anche la memoria corta (la volatilita' che
si raggruppa); circolare, cosi' ogni giorno ha lo stesso peso e la variante centrata ha media esattamente zero.
PERCORSI percorsi con seme fisso. Il portafoglio simulato e' a QUANTITA' FERME (come la misura del salvavita: ogni
intervallo con le posizioni del suo inizio), il punto di partenza e' il calo di oggi dal massimo LETTO da
numeri_libro.salvavita (non ricalcolato), e il massimo si riarma come nel salvavita (un massimo nuovo riparte da zero).
Il carico si «tocca» col massimo della seduta: il rapporto massimo/chiusura dello stesso giorno storico, della stessa
riga.

DUE VARIANTI AFFIANCATE, MAI MEDIATE (v200):
- «deriva dell'ultimo anno»: i rendimenti come sono — l'ultimo anno e' stato eccezionale, e la simulazione lo ripete;
- «solo rumore»: ogni titolo centrato a media zero (rendimenti semplici): nessun guadagno atteso, il valore atteso di
  ogni titolo resta quello di oggi, e la mediana dei piu' volatili scende (l'attrito della volatilita').
⚠ La DISTORSIONE DA SOPRAVVIVENZA: i nomi sono quelli scelti OGGI, anche perche' sono andati bene; il passato pende
verso chi e' andato bene, e la variante con la deriva ne eredita la pendenza.

LA CALIBRAZIONE (walk-forward, senza futuro): lo STESSO metodo (stessa funzione `simula`, stessa finestra, stessi
blocchi) su QQQ, SMH e le altre serie delle barre, alla data t SOLO coi rendimenti fino a t, contro l'esito vero dopo
t. Gli eventi analoghi, sulla serie stessa, col suo massimo dell'ultimo anno (252 sedute) che si riarma:
- "calo": il calo dal massimo arriva a SOGLIA_SALVAVITA entro h (20, 60) — analogo del salvavita;
- "torna": la chiusura torna al massimo entro h (60, 120, 252) — analogo del ritorno al massimo;
- "tocca": il massimo della seduta tocca il massimo dell'anno entro h (60, 120, 252) — analogo del ritorno al carico
  (un livello sopra il prezzo, toccato col massimo della seduta).
I casi: una data ogni PASSO sedute per serie, solo quelle a CALO_ANALOGO o piu' sotto il massimo, come oggi. La BASE di
ogni caso: la frequenza dello stesso evento su TUTTI i giorni di tutte le serie il cui esito era gia' noto alla data
del caso (senza futuro, senza condizioni). Poi affidabilita.valuta per evento, orizzonte e variante. L'evento congiunto
dei rami secchi non ha una calibrazione propria (la storia comune dei quattro comincia il 31/03/2025): poggia sugli
stessi percorsi degli eventi da soli, e lo si dice.

Le soglie qui sotto sono convenzioni dichiarate (v240). Cache della calibrazione in memoria/dati (fuori da git),
riusata per VALIDITA_ORE.

Uso:
  python3 scripts/previsioni_portafoglio.py                 le verifiche (fixture sintetiche, senza rete)
  python3 scripts/previsioni_portafoglio.py oggi [--barre FILE.json] [--rifai]
                                                            le verifiche e le previsioni di oggi
"""
import bisect
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
if QUI not in sys.path:
    sys.path.insert(0, QUI)

import numpy as np  # noqa: E402

import affidabilita as A  # noqa: E402
import laboratorio as LAB  # noqa: E402
import numeri_libro as NL  # noqa: E402
import statistica as SA  # noqa: E402

RADICE = os.path.dirname(QUI)
CACHE = os.path.join(RADICE, "memoria", "dati", "calibrazione_portafoglio.json")
VALIDITA_ORE = 24                   # la calibrazione si rifa' dopo un giorno
FINESTRA = LAB.FINESTRA             # 252 sedute: la storia del portafoglio di oggi (la stessa del laboratorio)
BLOCCO = 10                         # sedute consecutive per blocco del bootstrap
PERCORSI = 5000                     # percorsi delle previsioni di oggi
PERCORSI_CALIBRAZIONE = PERCORSI    # la calibrazione con gli stessi percorsi: lo stesso metodo per intero
SEME = LAB.SEMENTE                  # il seme fisso (lo stesso del laboratorio)
SOGLIA_SALVAVITA = NL.SOGLIA_SALVAVITA   # -30%: la soglia del libro, letta dal codice che la misura
ORIZZONTI_SALVAVITA = (20, 60)
ORIZZONTI_MASSIMO = (60, 120, 252)
ORIZZONTI_CARICO = (60, 120, 252)
RAMI_SECCHI = ("RGTI", "CRWV", "MSTR", "ORCL")   # IN ATTESA DELLA CONFERMA DEL CEO (LIBRO.md §1undecies, 03/11/2026)
CALENDARIO = "QQQ"                  # le sedute si contano sul calendario delle barre di QQQ
PASSO = 20                          # calibrazione: una data ogni 20 sedute per serie
CALO_ANALOGO = -0.10                # calibrazione: solo le date ad almeno il 10% sotto il massimo dell'anno, come oggi
MIN_BASE = 100                      # sotto questi esiti gia' noti la base di un caso non si calcola e il caso salta
VARIANTI = {"storico": "deriva dell'ultimo anno", "rumore": "solo rumore, media zero"}
ANALOGHI = {"calo": ORIZZONTI_SALVAVITA, "torna": ORIZZONTI_MASSIMO, "tocca": ORIZZONTI_CARICO}
NOMI_ANALOGHI = {"calo": "il calo dal massimo dell'anno arriva a -30%",
                 "torna": "la chiusura torna al massimo dell'anno",
                 "tocca": "il massimo della seduta tocca il massimo dell'anno"}


def _n(x, d=1, segno=False):
    return SA._n(x, d, segno)


def _p(x, d=0, segno=False):
    return "n.d." if x is None else _n(100 * x, d, segno) + "%"


def _data_it(d):
    return datetime.fromisoformat(str(d)[:10]).strftime("%d/%m/%Y") if d else "n.d."


class Previsioni(list):
    """La lista dei record di affidabilita.previsione, con le ASSENZE dichiarate (v406): un evento che non si
    calcola si nomina col perche', non sparisce."""

    def __init__(self, *a):
        super().__init__(*a)
        self.assenze = []
        self.contesto = {}


# ───────────────────────── il metodo: bootstrap a blocchi delle righe ─────────────────────────

def indici_blocchi(T, H, n, rng, blocco=BLOCCO):
    """(n, H) indici di riga: blocchi di `blocco` righe consecutive, partenze uniformi, CIRCOLARE (dopo l'ultima
    riga si riprende dalla prima): ogni riga ha la stessa probabilita' di essere estratta."""
    k = -(-H // blocco)
    inizi = rng.integers(0, T, size=(n, k))
    return ((inizi[:, :, None] + np.arange(blocco)) % T).reshape(n, k * blocco)[:, :H]


def _indici_colonne(T, H, n, N, rng, colonne_separate=False, blocco=BLOCCO):
    """Gli indici per ogni colonna: lo STESSO array per tutte (la riga intera, le correlazioni restano).
    colonne_separate=True solo nella prova che deve CADERE (verifiche, (a))."""
    if colonne_separate:
        return [indici_blocchi(T, H, n, rng, blocco) for _ in range(N)]
    idx = indici_blocchi(T, H, n, rng, blocco)
    return [idx] * N


def primo(cond):
    """L'indice (0 = la prima seduta dopo la partenza) del primo vero lungo l'asse 1; H se non succede."""
    H = cond.shape[1]
    return np.where(cond.any(axis=1), cond.argmax(axis=1), H)


def tocchi(L, soglia=None):
    """I primi tocchi di un livello L (n, H) misurato contro il massimo di partenza (= 1): 'calo' — il calo dal
    massimo, che si RIARMA con un massimo nuovo come nel salvavita, arriva alla soglia; 'torna' — L torna a 1."""
    out = {"torna": primo(L >= 1.0 - 1e-12)}
    if soglia is not None:
        picco = np.maximum(1.0, np.maximum.accumulate(L, axis=1))
        out["calo"] = primo(L / picco - 1.0 <= soglia + 1e-12)
    return out


def simula(R, Q, w, livello0, soglia, livelli_tocco, H, n=PERCORSI, seme=SEME, variante="storico",
           colonne_separate=False):
    """Il metodo, uno per previsioni e calibrazione. R (T, N): rendimenti giornalieri semplici, righe = giorni;
    Q (T, N): massimo/chiusura dello stesso giorno; w: pesi a quantita' ferme (None: nessun portafoglio);
    livello0: il livello di partenza contro il massimo (1 + calo); livelli_tocco {colonna: prezzo/livello da
    toccare}: il primo giorno in cui il massimo della seduta lo tocca. (tocchi del portafoglio o None, {colonna: primo
    tocco}). variante 'rumore': ogni colonna centrata a media zero."""
    R = np.asarray(R, dtype=float)
    Q = np.asarray(Q, dtype=float)
    if variante == "rumore":
        R = R - R.mean(axis=0, keepdims=True)
    T, N = R.shape
    rng = np.random.default_rng(seme)
    idxs = _indici_colonne(T, H, n, N, rng, colonne_separate)
    V = np.zeros((n, H)) if w is not None else None
    nomi = {}
    for j in range(N):
        G = np.cumprod(1.0 + R[idxs[j], j], axis=1)
        if V is not None:
            V += float(w[j]) * G
        if j in livelli_tocco:
            nomi[j] = primo(float(livelli_tocco[j]) * G * Q[idxs[j], j] >= 1.0 - 1e-12)
    return (tocchi(float(livello0) * V, soglia) if V is not None else None), nomi


def prob(primi, h):
    return float(np.mean(primi < h))


# ───────────────────────── le previsioni di oggi ─────────────────────────

def _matrici(P, B):
    """(R, Q, colonne, date) dal portafoglio del laboratorio: Q = massimo/chiusura dello stesso giorno (le date per
    DATA, v207); un massimo che manca vale la chiusura, e si contano."""
    cols = list(P["rend"].columns)
    date = [d.strftime("%Y-%m-%d") for d in P["rend"].index]
    Q = np.ones((len(date), len(cols)))
    mancanti = 0
    for j, tk in enumerate(cols):
        per_data = {str(b.get("t"))[:10]: b for b in B.get(tk) or []}
        for i, d in enumerate(date):
            b = per_data.get(d) or {}
            if b.get("h") and b.get("c"):
                Q[i, j] = max(1.0, float(b["h"]) / float(b["c"]))
            else:
                mancanti += 1
    return P["rend"].values.astype(float), Q, cols, date, mancanti


def _scade(dal, sedute):
    """La data indicativa: `sedute` giorni feriali dopo `dal` (senza le feste di borsa: l'evento si risolve dal
    risolutore, non da questa data)."""
    return str(np.busday_offset(np.datetime64(dal[:10]), int(sedute), roll="forward"))


def previsioni_oggi(B, posiz, adesso=None, righe=None, calib=None, percorsi=PERCORSI):
    """I record (affidabilita.previsione, famiglia "portafoglio", metodo "simulazione", risolutore =
    evento_portafoglio) degli eventi del portafoglio, in due varianti affiancate. righe: il registro della performance
    (None: memoria/registro_performance.jsonl); calib: la calibrazione (None: calibrazione(B), dalla cache se fresca).
    Le assenze stanno in .assenze."""
    adesso = adesso or datetime.now(timezone.utc)
    scritto = adesso.astimezone(timezone.utc).isoformat(timespec="minutes")
    out = Previsioni()
    if righe is None:
        righe, rotte = NL.leggi_registro()
        if rotte:
            out.assenze.append(f"registro della performance: {rotte} righe illeggibili, contate e lasciate fuori")
    # v536 — la partenza e' la misura fino all'ULTIMA seduta conclusa, non all'ultima riga scritta del registro: il 06/11
    #   la riga piu' recente era del 02/11 (-19,49%) e la misura vera al 05/11 era -29,83%, a un passo dal salvavita.
    #   Le sedute che mancano si ricostruiscono come nel risolutore (una regola sola, v161), e si dice.
    cal_b = [str(b.get("t"))[:10] for b in ((B or {}).get(CALENDARIO) or []) if b.get("c")]
    if righe and cal_b and cal_b[-1] > max(r["seduta"] for r in righe):
        righe = _righe_complete(sorted(righe, key=lambda x: x["seduta"]), B, cal_b[-1])
        out.assenze.append(f"il calo di partenza comprende le sedute dopo l'ultima riga del registro, ricostruite dalle "
                           f"barre fino al {_data_it(cal_b[-1])} con le posizioni dell'ultima riga")
    s = NL.salvavita(righe)
    if s["stato"] != "misurato":
        out.assenze.append(f"nessuna previsione del portafoglio: salvavita non misurabile — {s['perche']}")
        return out
    P = LAB.portafoglio(B, posiz)
    if P is None:
        out.assenze.append("nessuna previsione del portafoglio: nessuna posizione con la storia sufficiente")
        return out
    R, Q, cols, date, mancanti = _matrici(P, B)
    w = P["w"][cols].values
    calo0, soglia = float(s["calo"]), float(s["soglia"])
    deriva = float(np.prod(1.0 + P["rp"].values) - 1.0)
    peso_fuori = sum(P["peso"].get(tk, 0.0) for tk in P["esclusi"])
    if calib is None:
        calib = calibrazione(B, adesso=adesso)
    basi = (calib or {}).get("basi") or {}
    out.contesto = {"calo": calo0, "massimo": s["massimo"], "seduta_calo": s["al"], "soglia": soglia,
                    "ulteriore": s["ulteriore"], "dal": P["dal"], "al": P["al"], "sedute": len(date),
                    "deriva": deriva, "esclusi": dict(P["esclusi"]), "peso_fuori": peso_fuori,
                    "pesi_fuori": {tk: P["peso"].get(tk) for tk in P["esclusi"]},
                    "massimi_mancanti": mancanti, "percorsi": percorsi}
    if s["al"] != P["al"]:
        out.assenze.append(f"il calo e' della seduta {_data_it(s['al'])} (registro), le barre arrivano al "
                           f"{_data_it(P['al'])}: la partenza della simulazione e' quella del registro")
    if s.get("saltati"):
        out.assenze.append(f"salvavita: {len(s['saltati'])} intervalli del registro saltati ({'; '.join(s['saltati'])})")
    rami = [tk for tk in RAMI_SECCHI if tk in cols and (posiz.get(tk) or {}).get("pmc") and B.get(tk)]
    for tk in RAMI_SECCHI:
        if tk not in rami:
            perche = ("non in portafoglio" if tk not in posiz else
                      P["esclusi"].get(tk, "barre o carico mancanti"))
            out.assenze.append(f"ramo secco {tk}: {perche} — l'evento congiunto dei rami secchi non si calcola")
    carichi = {tk: float(posiz[tk]["pmc"]) for tk in rami}
    ultimi = {tk: float(B[tk][-1]["c"]) for tk in rami}
    livelli = {cols.index(tk): ultimi[tk] / carichi[tk] for tk in rami}
    H = max(ORIZZONTI_SALVAVITA + ORIZZONTI_MASSIMO + ORIZZONTI_CARICO)
    comuni_extra = {"blocco": BLOCCO, "percorsi": percorsi, "seme": SEME, "storia": [P["dal"], P["al"]],
                    "sedute_storia": len(date), "calo_partenza": calo0, "massimo": s["massimo"],
                    "seduta_calo": s["al"], "esclusi": dict(P["esclusi"]), "peso_fuori": peso_fuori,
                    "rendimento_storia": deriva,
                    "intervallo_e": "l'errore della simulazione (Wilson sui percorsi), non l'incertezza del modello",
                    "sopravvivenza": "i nomi sono quelli di oggi: il passato pende verso chi e' andato bene"}
    gia_scattato = bool(s.get("scattato_il"))
    if gia_scattato:
        out.assenze.append(f"il salvavita e' gia' scattato il {_data_it(s['scattato_il'])}: il suo evento non si prevede")

    def record(soggetto, evento, p, risolutore, h, analogo, v, dal, extra=None):
        b = (basi.get(f"{analogo}|{h}") or {}).get("frequenza") if analogo else None
        k = int(round(p * percorsi))
        out.append(A.previsione(
            "portafoglio", soggetto, f"{evento} [{VARIANTI[v]}]", p, "simulazione", risolutore,
            scade=_scade(dal, h), base=b, n=len(date), intervallo=A.wilson(k, percorsi),
            extra={**comuni_extra, "variante": v, "orizzonte": h, "analogo": f"{analogo}|{h}" if analogo else None,
                   **(extra or {})}, scritto=scritto))

    for v in VARIANTI:
        port, nomi = simula(R, Q, w, 1.0 + calo0, soglia, livelli, H, percorsi, SEME, v)
        if not gia_scattato:
            for h in ORIZZONTI_SALVAVITA:
                record("portafoglio", f"il salvavita scatta ({_n(soglia * 100, 0)}% dal massimo) entro {h} sedute",
                       prob(port["calo"], h), A.evento_portafoglio("calo_dal_massimo", soglia, s["al"], h), h, "calo",
                       v, s["al"])
        for h in ORIZZONTI_MASSIMO:
            record("portafoglio", f"il portafoglio torna al massimo del {_data_it(s['massimo'])} entro {h} sedute",
                   prob(port["torna"], h), A.evento_portafoglio("torna_al_massimo", 0.0, s["al"], h), h, "torna",
                   v, s["al"])
        for h in ORIZZONTI_CARICO:
            singole = {}
            for tk in rami:
                pj = nomi[cols.index(tk)]
                singole[tk] = prob(pj, h)
                record(tk, f"{tk} torna al carico ({_n(carichi[tk], 2)} $, {_p(carichi[tk] / ultimi[tk] - 1, 1, True)}) "
                           f"entro {h} sedute", singole[tk],
                       A.evento_portafoglio("tutti_al_carico", {tk: carichi[tk]}, P["al"], h, nomi=[tk]), h, "tocca",
                       v, P["al"], {"carico": carichi[tk], "ultima_chiusura": ultimi[tk]})
            if len(rami) == len(RAMI_SECCHI):
                insieme = np.max(np.stack([nomi[cols.index(tk)] for tk in rami]), axis=0)
                record("rami secchi", f"tutti i rami secchi ({', '.join(rami)}) tornano al carico entro {h} sedute",
                       prob(insieme, h), A.evento_portafoglio("tutti_al_carico", carichi, P["al"], h, nomi=rami), h,
                       None, v, P["al"],
                       {"carichi": carichi, "da_soli": singole, "prodotto_se_indipendenti": float(np.prod(list(singole.values()))),
                        "calibrazione": "nessuna propria: gli stessi percorsi degli eventi da soli (analogo 'tocca')"})
    return out


# ───────────────────────── la risoluzione dal vivo ─────────────────────────

def _righe_complete(righe, B, fino):
    """Le righe del registro fino a `fino`, con le sedute che mancano RICOSTRUITE dalle barre (chiusure 'c', come il
    registro) con le posizioni della riga prima: la stessa regola del rendimento ponderato per il tempo (ogni
    intervallo con le posizioni del suo inizio). Un prezzo che manca resta None e numeri_libro.intervallo salta
    l'intervallo, nominandolo."""
    reg = {r["seduta"]: r for r in righe if r["seduta"] <= fino}
    if not reg:
        return []
    primo_g = min(reg)
    tks = set()
    for r in reg.values():
        tks |= set(r.get("posizioni") or {})
    chius = {tk: {str(b.get("t"))[:10]: b.get("c") for b in (B.get(tk) or [])} for tk in tks | {"QQQ"}}
    cal = sorted({d for d in chius["QQQ"] if primo_g <= d <= fino} | set(reg))
    out, prec = [], None
    for d in cal:
        if d in reg:
            r = reg[d]
        else:
            pos = dict(prec.get("posizioni") or {})
            r = {"seduta": d, "posizioni": pos, "prezzi": {tk: chius.get(tk, {}).get(d) for tk in pos},
                 "qqq": chius["QQQ"].get(d), "ricostruita": True}
        out.append(r)
        prec = r
    return out


def risolvi_portafoglio(risolutore, righe_registro, B):
    """True / False / None (non ancora, o un buco nei dati: un buco non e' un NO, v205) per un evento_portafoglio.
    Le sedute si contano sul calendario delle barre di QQQ dopo `dal`. 'calo_dal_massimo' e 'torna_al_massimo' con la
    misura del salvavita (numeri_libro.salvavita sul registro, le sedute mancanti ricostruite dalle barre);
    'tutti_al_carico' col massimo della seduta ('h') di ogni nome contro il suo carico."""
    r = risolutore or {}
    tipo, dal, sedute = r.get("tipo"), str(r.get("dal") or "")[:10], int(r.get("sedute") or 0)
    cal = [str(b.get("t"))[:10] for b in ((B or {}).get(CALENDARIO) or []) if b.get("c")]
    if not cal or not dal or sedute <= 0:
        return None
    finestra = [d for d in cal if d > dal][:sedute]
    if not finestra:
        return None
    concluso = len(finestra) >= sedute
    if tipo == "tutti_al_carico":
        soglie = r.get("soglia") or {}
        nomi = r.get("nomi") or list(soglie)
        toccati, buco = set(), False
        for tk in nomi:
            hb = {str(b.get("t"))[:10]: b.get("h") for b in ((B or {}).get(tk) or [])}
            manca = False
            for d in finestra:
                h = hb.get(d)
                if h is None:
                    manca = True
                    continue
                if float(h) >= float(soglie[tk]):
                    toccati.add(tk)
                    break
            buco |= manca and tk not in toccati
        if set(nomi) <= toccati:
            return True
        return None if (not concluso or buco) else False
    if tipo not in ("calo_dal_massimo", "torna_al_massimo"):
        return None
    righe = sorted(righe_registro or [], key=lambda x: x["seduta"])
    if not righe or righe[0]["seduta"] > dal:
        return None
    rr = _righe_complete(righe, B, finestra[-1])
    buco = False
    for d in finestra:
        pref = [x for x in rr if x["seduta"] <= d]
        if not pref or pref[-1]["seduta"] != d:
            buco = True
            continue
        s = NL.salvavita(pref)
        if s["stato"] != "misurato":
            buco = True
            continue
        if any(x.split("→")[1].split(":")[0] > dal for x in s.get("saltati") or []):
            buco = True
        if tipo == "calo_dal_massimo" and s["calo"] <= float(r["soglia"]) + 1e-12:
            return True
        if tipo == "torna_al_massimo" and s["massimo"] > dal:
            return True
    return None if (not concluso or buco) else False


# ───────────────────────── la calibrazione walk-forward ─────────────────────────

def _serie(barre):
    """(date, chiusure rettificate, massimo/chiusura) della societa' di oggi (statistica.serie, v492)."""
    date, a, q = [], [], []
    for x in SA.serie(barre or []):
        c, aa, h = x.get("c"), x.get("a") or x.get("c"), x.get("h")
        if not c or not aa:
            continue
        date.append(str(x["t"])[:10])
        a.append(float(aa))
        q.append(max(1.0, float(h) / float(c)) if h else 1.0)
    return date, np.array(a), np.array(q)


def _stato(a, i):
    """(massimo delle chiusure dell'ultimo anno fino a i compreso, calo dal massimo)."""
    M = float(a[max(0, i - FINESTRA + 1):i + 1].max())
    return M, a[i] / M - 1.0


def esiti_veri(a, q, i, H):
    """Gli esiti veri dopo i (la stessa funzione dei tocchi simulati): (calo a i, {analogo: primo tocco})."""
    M, d = _stato(a, i)
    L = (a[i + 1:i + 1 + H] / M)[None, :]
    t = tocchi(L, SOGLIA_SALVAVITA)
    return d, {"calo": int(t["calo"][0]), "torna": int(t["torna"][0]),
               "tocca": int(primo(L * q[i + 1:i + 1 + H][None, :] >= 1.0 - 1e-12)[0])}


def prevedi_serie(a, q, i, H, n=PERCORSI_CALIBRAZIONE, seme=SEME, varianti=tuple(VARIANTI)):
    """Il metodo alla data i di una serie, SOLO coi dati fino a i: i FINESTRA rendimenti che finiscono a i, il
    massimo dell'anno fino a i. (calo a i, {variante: {analogo: primi tocchi}})."""
    M, d = _stato(a, i)
    r = a[i - FINESTRA + 1:i + 1] / a[i - FINESTRA:i] - 1.0
    Qw = q[i - FINESTRA + 1:i + 1]
    out = {}
    for v in varianti:
        port, nomi = simula(r[:, None], Qw[:, None], np.array([1.0]), 1.0 + d, SOGLIA_SALVAVITA, {0: 1.0 + d}, H, n,
                            seme, v)
        out[v] = {"calo": port["calo"], "torna": port["torna"], "tocca": nomi[0]}
    return d, out


def _nel_dominio(analogo, d):
    """v537 (revisore, rilievo 1): la base sullo STESSO dominio dei casi — almeno CALO_ANALOGO sotto il massimo, e per il
    calo non ancora oltre la soglia. Prima la base prendeva ogni giorno sotto il massimo (anche a −0,5%): «torna al
    massimo entro 60» aveva base 47,6% contro il 26,5% del dominio dei casi, e l'abilita' cambiava segno."""
    return d <= CALO_ANALOGO and (d > SOGLIA_SALVAVITA if analogo == "calo" else True)


def _base(pool, data):
    """La frequenza degli esiti gia' noti alla data (data dell'esito <= data): (frequenza, quanti)."""
    dd, cum = pool
    m = bisect.bisect_right(dd, data)
    return (cum[m - 1] / m, m) if m else (None, 0)


def _parametri(percorsi):
    return {"finestra": FINESTRA, "blocco": BLOCCO, "percorsi": percorsi, "seme": SEME, "passo": PASSO,
            "calo_analogo": CALO_ANALOGO, "soglia": SOGLIA_SALVAVITA, "min_base": MIN_BASE,
            "analoghi": {k: list(v) for k, v in ANALOGHI.items()}, "versione": 2}


def calibrazione(B, adesso=None, percorsi=PERCORSI_CALIBRAZIONE, rifai=False, cache=CACHE):
    """La calibrazione walk-forward del metodo sulle serie di B: {'scritto', 'parametri', 'serie', 'fuori',
    'valutazioni': {'analogo|h|variante': affidabilita.valuta}, 'basi': {'analogo|h': {'frequenza', 'n'}},
    'senza_base': {...}, 'secondi'}. Dalla cache se ha meno di VALIDITA_ORE ore e gli stessi parametri."""
    adesso = adesso or datetime.now(timezone.utc)
    par = _parametri(percorsi)
    if not rifai and cache:
        try:
            c = json.load(open(cache, encoding="utf-8"))
            eta = (adesso - datetime.fromisoformat(c["scritto"])).total_seconds() / 3600
            if 0 <= eta < VALIDITA_ORE and c.get("parametri") == par:
                c["dalla_cache"] = True
                return c
        except Exception:  # noqa: BLE001 — una cache illeggibile si rifa'
            pass
    t0 = time.time()
    H_max = max(max(v) for v in ANALOGHI.values())
    tutti_h = sorted({h for v in ANALOGHI.values() for h in v})
    dati, fuori = {}, {}
    for tk in sorted(B or {}):
        date, a, q = _serie(B[tk])
        if len(a) < FINESTRA + 1 + min(tutti_h):
            fuori[tk] = f"storia corta: {len(a)} sedute (ne servono {FINESTRA + 1 + min(tutti_h)})"
            continue
        dati[tk] = (date, a, q)
    # 1. la base: ogni giorno di ogni serie, con la data in cui il suo esito diventa noto
    grezzi = {(k, h): [] for k, hs in ANALOGHI.items() for h in hs}
    for tk, (date, a, q) in dati.items():
        n = len(a)
        for s in range(FINESTRA, n - 1):
            H = min(H_max, n - 1 - s)
            d, pr = esiti_veri(a, q, s, H)
            for k, hs in ANALOGHI.items():
                if not _nel_dominio(k, d):
                    continue
                for h in hs:
                    if h <= H:
                        grezzi[(k, h)].append((date[s + h], pr[k] < h))
    pool, basi = {}, {}
    for key, lst in grezzi.items():
        lst.sort()
        dd = [x[0] for x in lst]
        cum = np.cumsum([1.0 if x[1] else 0.0 for x in lst]).tolist()
        pool[key] = (dd, cum)
        basi[f"{key[0]}|{key[1]}"] = {"frequenza": cum[-1] / len(cum) if cum else None, "n": len(cum),
                                      "fino_al": dd[-1] if dd else None}
    # 2. i casi: una data ogni PASSO sedute, SOLO coi dati fino a quella data
    raccolta = {(k, h, v): ([], [], []) for k, hs in ANALOGHI.items() for h in hs for v in VARIANTI}
    senza_base = {f"{k}|{h}": 0 for k, hs in ANALOGHI.items() for h in hs}
    for j, (tk, (date, a, q)) in enumerate(sorted(dati.items())):
        n = len(a)
        for i in range(FINESTRA, n - 1, PASSO):
            hs_ok = [h for h in tutti_h if i + h <= n - 1]
            if not hs_ok:
                break
            _, d = _stato(a, i)
            if d > CALO_ANALOGO:
                continue
            H = max(hs_ok)
            _, sim = prevedi_serie(a, q, i, H, percorsi, [SEME, j, i])
            _, vero = esiti_veri(a, q, i, H)
            for k, hs in ANALOGHI.items():
                if not _nel_dominio(k, d):
                    continue
                for h in hs:
                    if h > H:
                        continue
                    b, m = _base(pool[(k, h)], date[i])
                    if m < MIN_BASE:
                        senza_base[f"{k}|{h}"] += 1
                        continue
                    for v in VARIANTI:
                        ps, ys, bs = raccolta[(k, h, v)]
                        ps.append(prob(sim[v][k], h))
                        ys.append(vero[k] < h)
                        bs.append(b)
    valutazioni = {f"{k}|{h}|{v}": A.valuta(ps, ys, bs) for (k, h, v), (ps, ys, bs) in raccolta.items()}
    out = {"scritto": adesso.astimezone(timezone.utc).isoformat(timespec="seconds"), "parametri": par,
           "serie": sorted(dati), "fuori": fuori, "valutazioni": valutazioni, "basi": basi,
           "senza_base": senza_base, "secondi": round(time.time() - t0, 1),
           "ultima_seduta": max((d[0][-1] for d in dati.values()), default=None)}
    if cache:
        try:
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            json.dump(out, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
        except Exception:  # noqa: BLE001 — senza cache si ricalcola la volta dopo, e basta
            pass
    return out


# ───────────────────────── la resa ─────────────────────────

def _affid_breve(p, val):
    """La fascia di calibrazione in cui cade p, in breve (stessa fonte di affidabilita.riga_affidabilita)."""
    if not val or not val.get("n"):
        return "non misurata"
    f = A.fascia_di(p, val)
    ab = val.get("abilita")
    coda = (f" · abilita' {_n(ab, 2, True)}" if ab is not None else "") + \
           ("" if val.get("misurabile") else f" ⚠ {val['n']} casi, sotto i {A.MIN_VALUTAZIONE}")
    if not f:
        return f"nessun caso nella fascia {_p(A.fascia(p) * A.LARGHEZZA_FASCIA)}-" \
               f"{_p((A.fascia(p) + 1) * A.LARGHEZZA_FASCIA)}" + coda
    if not f["misurabile"]:
        return f"fascia {_p(f['da'])}-{_p(f['a'])}: {f['n']} casi, non misurabile" + coda
    return (f"fascia {_p(f['da'])}-{_p(f['a'])}: avverata {_p(f['frequenza'])} ({f['n']} casi, "
            f"{_p(f['basso'])}-{_p(f['alto'])})" + coda)


def _fascia_corta(p, val):
    """«detto 20-30% → avverato 34% su 127»: la fascia di p nella calibrazione, in breve."""
    f = A.fascia_di(p, val)
    if not f:
        return "fascia senza casi"
    testo = f"detto {_n(100 * f['da'], 0)}-{_p(f['a'])} → avverato {_p(f['frequenza'])} su {f['n']}"
    return testo + ("" if f["misurabile"] else " (non misurabile)")


def resa(previsioni, calibrazione):
    """Le righe in italiano: ogni evento con le due varianti affiancate (mai mediate), la base, e dove cade ogni
    probabilita' nella calibrazione del suo analogo."""
    cal = calibrazione or {}
    V = cal.get("valutazioni") or {}
    ctx = getattr(previsioni, "contesto", {}) or {}
    R = []
    if ctx:
        fuori = ", ".join(f"{tk} ({_p(ctx['pesi_fuori'].get(tk), 1)})" for tk in sorted(ctx["esclusi"]))
        percorsi = f"{ctx['percorsi']:,}".replace(",", ".")
        R.append(f"PREVISIONI DEL PORTAFOGLIO (probabilita', non fatti) — simulazione: bootstrap a blocchi circolare di "
                 f"{BLOCCO} sedute, {percorsi} percorsi, seme {SEME}, sulle righe intere di "
                 f"{ctx['sedute']} sedute dal {_data_it(ctx['dal'])} al {_data_it(ctx['al'])}, quantita' ferme")
        R.append(f"  partenza: {_p(ctx['calo'], 2, True)} dal massimo del {_data_it(ctx['massimo'])} (salvavita, "
                 f"registro del {_data_it(ctx['seduta_calo'])}: scatta con un altro {_p(ctx['ulteriore'], 1, True)}) · "
                 f"⚠ nomi di oggi (sopravvivenza), e nell'ultimo anno il portafoglio di oggi ha fatto "
                 f"{_p(ctx['deriva'], 0, True)}: la variante «solo rumore» lo toglie"
                 + (f" · fuori per la storia corta: {fuori}" if fuori else ""))
    per = {}
    for r in previsioni or []:
        ev = r["evento"].rsplit(" [", 1)[0]
        per.setdefault((r["soggetto"], ev), {})[r["extra"]["variante"]] = r
    rami_righe = {}
    for (sog, ev), vv in per.items():
        r0 = next(iter(vv.values()))
        h, an = r0["extra"]["orizzonte"], r0["extra"].get("analogo")
        if sog in RAMI_SECCHI:
            rami_righe.setdefault(h, {})[sog] = vv
            continue
        if sog == "rami secchi":
            rami_righe.setdefault(h, {})["_tutti"] = vv
            continue
        R.append(f"• {ev}: {_p(vv['storico']['probabilita'])} con la deriva · {_p(vv['rumore']['probabilita'])} "
                 f"col solo rumore · base {_p(r0['base'])}")
        R.append("    affidabilita' — deriva: " + _affid_breve(vv["storico"]["probabilita"], V.get(f"{an}|storico"))
                 + " | rumore: " + _affid_breve(vv["rumore"]["probabilita"], V.get(f"{an}|rumore")))
    for h in sorted(rami_righe):
        g = rami_righe[h]
        tutti = g.get("_tutti")
        testa = (f"• tutti i rami secchi al carico entro {h} sedute: {_p(tutti['storico']['probabilita'])} con la "
                 f"deriva · {_p(tutti['rumore']['probabilita'])} col solo rumore (moltiplicando quelle da soli: "
                 f"{_p(tutti['storico']['extra']['prodotto_se_indipendenti'])} · "
                 f"{_p(tutti['rumore']['extra']['prodotto_se_indipendenti'])})" if tutti else
                 f"• rami secchi al carico entro {h} sedute (l'evento congiunto non si calcola)")
        soli = " · ".join(f"{tk} {_p(g[tk]['storico']['probabilita'])}/{_p(g[tk]['rumore']['probabilita'])}"
                          for tk in RAMI_SECCHI if tk in g)
        R.append(testa + f" | da soli (deriva/rumore): {soli}")
        for v in VARIANTI:
            val = V.get(f"tocca|{h}|{v}")
            if val and val.get("n") and any(tk in g for tk in RAMI_SECCHI):
                R.append(f"    affidabilita' da soli [{VARIANTI[v]}], analogo «{NOMI_ANALOGHI['tocca']}» (abilita' "
                         f"{_n(val['abilita'], 2, True)}, ECE {_n(val['ece'], 2)}): "
                         + " · ".join(f"{tk} " + _fascia_corta(g[tk][v]["probabilita"], val)
                                      for tk in RAMI_SECCHI if tk in g))
    for a in getattr(previsioni, "assenze", []) or []:
        R.append(f"  ⚠ {a}")
    if cal:
        R.append(f"  calibrazione walk-forward (stesso metodo, {cal['parametri']['percorsi']} percorsi per caso, senza "
                 f"futuro) su {len(cal.get('serie') or [])} serie, una data ogni {PASSO} sedute ad almeno "
                 f"{_p(-CALO_ANALOGO)} sotto il massimo dell'anno; base = la frequenza su tutti i giorni gia' risolti · "
                 "l'evento congiunto non ha calibrazione propria · le varianti stanno affiancate, mai mediate")
    else:
        R.append("  ⚠ calibrazione non disponibile: l'affidabilita' non e' misurata")
    return R


def resa_calibrazione(cal):
    """Una riga per analogo, orizzonte e variante: Brier, abilita' contro la base, ECE, casi."""
    R = []
    for key, v in sorted((cal or {}).get("valutazioni", {}).items()):
        an, h, var = key.split("|")
        R.append(f"  {NOMI_ANALOGHI[an]} entro {h} [{VARIANTI[var]}]: {v['n']} casi, avverati {v['avverate']} · Brier "
                 f"{_n(v['brier'], 3)} (base {_n(v['brier_base'], 3)}) · abilita' {_n(v['abilita'], 2, True)} · ECE "
                 f"{_n(v['ece'], 3)}" + ("" if v["misurabile"] else " ⚠ non ancora misurabile"))
    return R


# ───────────────────────── le verifiche (fixture sintetiche, senza rete) ─────────────────────────

def _barre_sintetiche(rng, n, vol, deriva=0.0, inizio="2024-01-02", p0=100.0, z=None):
    date = np.busday_offset(np.datetime64(inizio), np.arange(n), roll="forward")
    z = rng.standard_normal(n) if z is None else z
    r = deriva + vol * z
    c = p0 * np.cumprod(1 + r)
    h = c * (1 + np.abs(rng.standard_normal(n)) * vol * 0.5)
    return [{"t": str(d), "h": float(hh), "l": float(cc * 0.99), "c": float(cc), "v": 1e6, "a": float(cc)}
            for d, cc, hh in zip(date, c, h)]


def verifiche():
    """(nome, esito, dettaglio) — fixture sintetiche, nessuna rete, nessun file scritto."""
    Vv = []
    rng = np.random.default_rng(7)
    # (a) la riga intera conserva la correlazione; le colonne separate la distruggono (l'iniezione deve CADERE)
    T, rho = FINESTRA, 0.8
    z1 = rng.standard_normal(T)
    z2 = rho * z1 + math.sqrt(1 - rho ** 2) * rng.standard_normal(T)
    Rm = 0.02 * np.column_stack([z1, z2])
    orig = float(np.corrcoef(Rm[:, 0], Rm[:, 1])[0, 1])

    def corr_simulata(separate):
        g = np.random.default_rng(1)
        i0, i1 = _indici_colonne(T, 20, 3000, 2, g, separate)
        s0, s1 = Rm[i0, 0].ravel(), Rm[i1, 1].ravel()   # i rendimenti giornalieri estratti, seduta per seduta
        return float(np.corrcoef(s0, s1)[0, 1])

    def conserva(c):
        return abs(c - orig) < 0.05
    c_righe, c_sep = corr_simulata(False), corr_simulata(True)
    Vv.append(("(a) il bootstrap a blocchi conserva la correlazione fra due serie correlate; la stessa prova CADE se si "
               "campionano le colonne separatamente (iniezione)", conserva(c_righe) and not conserva(c_sep),
               f"correlazione vera {_n(orig, 2)} · righe intere {_n(c_righe, 2)} · colonne separate {_n(c_sep, 2)} "
               f"(la prova sull'iniezione: {'cade' if not conserva(c_sep) else 'NON cade'})"))
    # (b) l'evento congiunto non supera nessun evento da solo, e non e' il prodotto delle probabilita'
    z = rng.standard_normal((T, 1))
    R3 = 0.03 * (0.7 * z + math.sqrt(1 - 0.49) * rng.standard_normal((T, 3)))
    Q3 = 1 + np.abs(rng.standard_normal((T, 3))) * 0.01
    liv = {0: 0.80, 1: 0.70, 2: 0.90}
    _, nomi = simula(R3, Q3, None, 1.0, None, liv, 120, 3000, 3, "rumore")
    ok_b, det = True, []
    for h in (20, 60, 120):
        sol = [prob(nomi[j], h) for j in liv]
        ins = prob(np.max(np.stack([nomi[j] for j in liv]), axis=0), h)
        ok_b &= all(ins <= s + 1e-12 for s in sol)
        det.append(f"{h}: insieme {_p(ins)} · da soli {'/'.join(_p(s) for s in sol)} · prodotto {_p(float(np.prod(sol)))}")
    Vv.append(("(b) l'evento congiunto ha probabilita' <= di ciascun evento da solo", ok_b, " | ".join(det)))
    # (c) nessun futuro: cambiare i dati dopo t non cambia la probabilita' a t (e l'esito, si', o la prova e' vuota)
    b = _barre_sintetiche(rng, 700, 0.025)
    _, a, q = _serie(b)
    i, H = 450, 120
    _, s1 = prevedi_serie(a, q, i, H, 1000, 5)
    _, e1 = esiti_veri(a, q, i, H)
    a2, q2 = a.copy(), q.copy()
    a2[i + 1:] = a2[i + 1:] * np.linspace(0.5, 0.3, len(a2) - i - 1)
    q2[i + 1:] = 1.0
    _, s2 = prevedi_serie(a2, q2, i, H, 1000, 5)
    _, e2 = esiti_veri(a2, q2, i, H)
    uguali = all(np.array_equal(s1[v][k], s2[v][k]) for v in VARIANTI for k in ANALOGHI)
    Vv.append(("(c) nessun futuro nella calibrazione: i dati dopo t non cambiano la previsione a t, cambiano l'esito",
               uguali and e1 != e2, f"esiti prima {e1} · dopo il cambio del futuro {e2}"))
    dd = ["2024-01-10", "2024-01-20", "2024-02-01", "2024-03-01"]
    pool = (dd, np.cumsum([0.0, 0.0, 1.0, 1.0]).tolist())
    fb, mb = _base(pool, "2024-01-25")
    Vv.append(("(c) la base di un caso conta solo gli esiti gia' noti alla sua data", fb == 0.0 and mb == 2,
               f"base {fb} su {mb} esiti noti"))
    # (d) la variante «solo rumore» ha media zero (bootstrap circolare: ogni riga pesa uguale)
    Rr = 0.02 * rng.standard_normal((T, 1)) + 0.003
    g = np.random.default_rng(2)
    idx = indici_blocchi(T, 50, 4000, g)
    cen = (Rr - Rr.mean(axis=0))[idx, 0]
    conteggio = np.bincount(indici_blocchi(T, 30, 20000, np.random.default_rng(4)).ravel(), minlength=T)
    Vv.append(("(d) solo rumore: rendimenti centrati a media zero; ogni riga estratta con la stessa frequenza",
               abs(float(cen.mean())) < 3e-4 and conteggio.min() > 0.85 * conteggio.mean(),
               f"media simulata {cen.mean():.2e} (prima {Rr.mean():.2e}) · righe min/media {conteggio.min() / conteggio.mean():.2f}"))
    # (e) la partenza e' il calo LETTO dal salvavita, e il portafoglio e' quello del laboratorio
    nomi_f = ("NVDA", "RGTI", "CRWV", "MSTR", "ORCL")
    zc = rng.standard_normal(320)
    Bf = {tk: _barre_sintetiche(rng, 320, 0.02 + 0.01 * k, 0.0005, p0=50.0 + 10 * k,
                                z=0.6 * zc + 0.8 * rng.standard_normal(320)) for k, tk in enumerate(nomi_f)}
    Bf["QQQ"] = _barre_sintetiche(rng, 320, 0.01, 0.0003, p0=400.0)
    posf = {tk: {"tk": tk, "qta": 10.0 + k, "pmc": float(Bf[tk][-1]["c"]) * (1.1 + 0.1 * k), "valuta": "USD"}
            for k, tk in enumerate(nomi_f)}
    d_ult = [x["t"] for x in Bf["QQQ"]]

    def riga(d, fattore=1.0):
        return {"seduta": d, "posizioni": {tk: posf[tk]["qta"] for tk in nomi_f},
                "prezzi": {tk: next(x["c"] for x in Bf[tk] if x["t"] == d) * fattore for tk in nomi_f},
                "qqq": next(x["c"] for x in Bf["QQQ"] if x["t"] == d)}
    righe_f = [riga(d_ult[-3], 1.3), riga(d_ult[-2]), riga(d_ult[-1])]
    sv = NL.salvavita(righe_f)
    pr = previsioni_oggi(Bf, posf, datetime(2026, 11, 3, 12, tzinfo=timezone.utc), righe=righe_f, calib={},
                         percorsi=800)
    partenze = {r["extra"]["calo_partenza"] for r in pr}
    tipi = {(r["risolutore"]["tipo"], r["extra"]["variante"]) for r in pr}
    Vv.append(("(e) previsioni_oggi: partenza = il calo di numeri_libro.salvavita, due varianti per ogni evento, "
               "record dello schema comune", partenze == {sv["calo"]} and len(tipi) == 6 and
               all(r["famiglia"] == "portafoglio" and r["metodo"] == "simulazione" and 0 <= r["probabilita"] <= 1
                   for r in pr) and len({r["id"] for r in pr}) == len(pr),
               f"{len(pr)} record · calo di partenza {_p(sv['calo'], 2, True)}"))
    cong = {r["extra"]["orizzonte"]: r for r in pr if r["soggetto"] == "rami secchi" and r["extra"]["variante"] == "storico"}
    soli = {}
    for r in pr:
        if r["soggetto"] in RAMI_SECCHI and r["extra"]["variante"] == "storico":
            soli.setdefault(r["extra"]["orizzonte"], []).append(r["probabilita"])
    Vv.append(("(e) sul portafoglio: l'evento congiunto dei rami secchi <= ciascuno da solo",
               bool(cong) and all(cong[h]["probabilita"] <= min(soli[h]) + 1e-12 for h in cong),
               " · ".join(f"{h}: {_p(cong[h]['probabilita'])} vs min {_p(min(soli[h]))}" for h in sorted(cong))))
    # (f) la risoluzione: un tocco, un no a finestra chiusa, un non-ancora, un buco
    base_r = [riga(d_ult[-60]), riga(d_ult[-59])]
    dal = d_ult[-59]
    ev_calo = A.evento_portafoglio("calo_dal_massimo", -0.30, dal, 20)
    Bc = json.loads(json.dumps(Bf))
    k = len(Bc["QQQ"]) - 50
    for tk in nomi_f:
        for x in Bc[tk][k:]:
            x["c"] *= 0.6
    e_tocco = risolvi_portafoglio(ev_calo, base_r, Bc)
    e_no = risolvi_portafoglio(A.evento_portafoglio("calo_dal_massimo", -0.95, dal, 20), base_r, Bf)
    e_presto = risolvi_portafoglio(A.evento_portafoglio("calo_dal_massimo", -0.95, d_ult[-5], 20), base_r + [riga(d_ult[-5])], Bf)
    Bb = json.loads(json.dumps(Bf))
    Bb["NVDA"] = [x for x in Bb["NVDA"] if x["t"] != d_ult[-50]]
    e_buco = risolvi_portafoglio(A.evento_portafoglio("calo_dal_massimo", -0.95, dal, 20), base_r, Bb)
    carico = {tk: max(x["h"] for x in Bf[tk][-58:-38]) * 0.999 for tk in ("RGTI", "MSTR")}
    e_car = risolvi_portafoglio(A.evento_portafoglio("tutti_al_carico", carico, dal, 20, nomi=list(carico)), base_r, Bf)
    carico["MSTR"] *= 10
    e_car_no = risolvi_portafoglio(A.evento_portafoglio("tutti_al_carico", carico, dal, 20, nomi=list(carico)), base_r, Bf)
    Vv.append(("(f) risolvi_portafoglio: tocco = True, finestra chiusa senza tocco = False, non ancora = None, "
               "buco nei dati = None, tutti al carico = True, uno no = False",
               (e_tocco, e_no, e_presto, e_buco, e_car, e_car_no) == (True, False, None, None, True, False),
               f"{(e_tocco, e_no, e_presto, e_buco, e_car, e_car_no)}"))
    return Vv


def main(argv):
    t0 = time.time()
    ok = True
    for nome, esito, dettaglio in verifiche():
        print(("PASS  " if esito else "FAIL  ") + nome + (f" — {dettaglio}" if dettaglio else ""))
        ok &= bool(esito)
    print(f"verifiche in {time.time() - t0:.1f} s")
    if argv and argv[0] == "oggi":
        adesso = datetime.now(timezone.utc)
        if "--barre" in argv:
            B = json.load(open(argv[argv.index("--barre") + 1], encoding="utf-8"))["barre"]
            _, posiz = SA.universo()
        else:
            B, posiz = LAB.dati(adesso=adesso)
        cal = calibrazione(B, adesso=adesso, rifai="--rifai" in argv)
        pr = previsioni_oggi(B, posiz, adesso, calib=cal)
        print("\n".join(resa(pr, cal)))
        print(f"CALIBRAZIONE ({'dalla cache del ' + cal['scritto'] if cal.get('dalla_cache') else 'calcolata in ' + str(cal.get('secondi')) + ' s'}):")
        print("\n".join(resa_calibrazione(cal)))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
