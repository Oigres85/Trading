#!/usr/bin/env python3
"""v528 — LA STATISTICA PRIMA DELLA DECISIONE: la prova d'ingresso, la pagina statistica e il diario.

Decisione del CEO del 01/11/2026, testuale: *"riforma l'analisi in forma statistica prendendo spunto anche dal caso
di Intel"*. Il sistema misurava lo STATO di ogni nome e non rispondeva mai alla domanda che viene prima di
un'operazione: **nei casi simili, cos'e' successo dopo?** Qui la risposta si conta, sui cinque anni di storico dei
nomi che il libro possiede e sorveglia:

- lo STATO del giorno: la seduta (un movimento oltre 3 deviazioni standard delle 60 sedute prima e' un CROLLO o
  un'IMPENNATA; con volumi da almeno 2 volte la media delle 20 sedute e' «con volumi da notizia», il modo di
  riconoscerla senza leggere i titoli), la tendenza (la regola della tenuta: numeri_libro.tendenza) e, nelle sedute
  normali, l'RSI;
- i CASI SIMILI: ogni giorno con lo stesso stato, in ogni titolo dell'universo, al piu' uno ogni 20 sedute per
  titolo (due giorni vicini dello stesso titolo sono lo stesso caso, non due prove);
- cosa e' successo DOPO: il rendimento a 20 e a 60 sedute, contro la BASE (tutti i giorni dello stesso universo,
  contati allo stesso modo): la differenza e' il vantaggio, o lo svantaggio, dello stato;
- la GEOMETRIA dell'operazione: stop e obiettivo di oggi, in ATR, riapplicati a ogni caso simile — chi tocca prima
  lo stop, chi l'obiettivo, chi nessuno dei due in 60 sedute — e il VALORE ATTESO in R (1 R = la perdita allo stop);
- la variante «ASPETTA LA CONFERMA»: dopo un crollo, entrare solo quando una chiusura supera il massimo del giorno
  del crollo (entro 10 sedute). E' la domanda del caso Intel, misurata invece che detta.

Solo FATTI contati: nessun punteggio (v200), e le soglie sono convenzioni dichiarate (v240) in LIBRO.md
§1quindecies, rilette da un gate. ⚠ L'universo sono i nomi seguiti OGGI — scelti perche' interessanti adesso, cioe'
anche perche' sopravvissuti: la statistica pende verso chi e' andato bene, e la resa lo dice ogni volta. Sotto 30
casi indipendenti la statistica non generalizza, e lo dice invece di concludere.

Uso:
  python3 scripts/statistica.py ingresso TICKER [PREZZO] [--data AAAA-MM-GG] [--registra "intuizione"]
  python3 scripts/statistica.py pagina          la pagina statistica delle posizioni (passo del comando unico)
  python3 scripts/statistica.py bilancio        il diario delle decisioni contro cio' che e' successo dopo
"""
import json
import math
import os
import statistics as st
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)
import brief                      # noqa: E402
import comuni                     # noqa: E402
import rotazione as R             # noqa: E402

RADICE = os.path.dirname(QUI)
CACHE = os.path.join(RADICE, "memoria", "dati", "statistica_barre.json")
DIARIO = os.path.join(RADICE, "memoria", "diario_ingressi.jsonl")
VALIDITA_MIN = 60                  # le barre si rileggono dopo un'ora: cambiano solo alla campana
RIFERIMENTO = "QQQ"

# Le convenzioni (LIBRO.md §1quindecies, rilette dal gate v528): non sono misure, sono il modo di contare.
SIGMA_GRANDE = 3.0                # una seduta oltre 3 deviazioni standard delle 60 prima e' un crollo o un'impennata
SEDUTE_SIGMA = 60
VOLUME_NOTIZIA = 2.0              # volume da almeno 2 volte la media delle 20 sedute prima: la traccia di una notizia
SEDUTE_VOLUME = 20
RSI_BASSO, RSI_ALTO = 30, 70
SEDUTE_ANNO = 252
FASCE_MASSIMO = (10, 25, 40)        # distanza dal massimo dell'anno: entro 10%, 10-25%, 25-40%, oltre 40%
ORIZZONTI = (20, 60)
DISTANZA = 20                     # un caso al piu' ogni 20 sedute per titolo
MIN_CASI = 30                     # sotto, la statistica non generalizza
ERRORI = 2                        # una differenza conta oltre 2 errori standard (circa il 95%)
SOGLIA_EV = 0.10                  # un valore atteso dentro ±0,1 R non distingue un'operazione dal caso
ATTESA_MAX = 10                   # la conferma dopo un crollo si aspetta al piu' 10 sedute
STOP_PAREGGIO_ATR = (0.5, 1.0, 2.0)   # v529: lo stop al prezzo d'ingresso, armato dopo un rialzo di tanti ATR
STOP_FISSO_ATR = (1.0, 2.0, 3.0)      # v529: lo stop fisso, tanti ATR sotto l'ingresso
STOP_LONTANO_ATR = 4.0            # un pavimento oltre 4 ATR sotto il prezzo non fa da stop: si usa lo stop standard
STOP_STANDARD_ATR = 2.0           # lo stop senza un pavimento vicino: 2 ATR, la convenzione del rischio del sistema
OBIETTIVO_STANDARD_R = 2.0        # senza una resistenza sopra il prezzo, l'obiettivo e' 2 volte il rischio


def _n(x, d=1, segno=False):
    """Virgola decimale; il segno sul valore GIA' arrotondato, mai «-0,0» (v496)."""
    if x is None:
        return "n.d."
    v = round(x, d)
    if v == 0:
        v = 0.0
    s = f"{v:+.{d}f}" if segno else f"{v:.{d}f}"
    return s.replace(".", ",")


# ───────────────────────── le barre ─────────────────────────

def universo():
    """Posizioni in dollari e sorvegliati di LIBRO.md (mai la pipeline, v439), piu' il riferimento."""
    pos, _, sorv = brief.leggi_libro()
    nomi = [p["tk"] for p in pos if p.get("valuta") == "USD"] + [s["tk"] for s in sorv]
    return list(dict.fromkeys(nomi + [RIFERIMENTO])), {p["tk"]: p for p in pos if p.get("valuta") == "USD"}


def leggi_barre(nomi, adesso=None, rete=True):
    """{ticker: barre CONCLUSE} — cinque anni dalla fonte delle schede (rotazione.barre_lunghe), la seduta in
    corso tolta (v471). Una lettura per ora in memoria/dati (fuori da git). None per chi non si legge: un nome
    non letto si nomina, non sparisce (v389)."""
    adesso = adesso or datetime.now(timezone.utc)
    try:
        c = json.load(open(CACHE, encoding="utf-8"))
        eta = (adesso - datetime.fromisoformat(c["scritto"])).total_seconds() / 60
        if eta <= VALIDITA_MIN and set(nomi) <= set(c["barre"]):
            return {tk: c["barre"][tk] for tk in nomi}
    except Exception:
        pass
    if not rete:
        return {tk: None for tk in nomi}

    def una(tk):
        b = R.barre_lunghe(tk)
        if not b:
            return None
        b = [{k: x.get(k) for k in ("t", "h", "l", "c", "v", "a")} for x in b if x.get("c")]
        return b[:-1] if brief.barra_in_formazione(b, adesso) else b

    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        B = dict(zip(nomi, ex.map(una, nomi)))
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump({"scritto": adesso.isoformat(), "barre": B}, open(CACHE, "w", encoding="utf-8"))
    except Exception:
        pass
    return B


def serie(barre, veicolo=None):
    """La serie della societa' di oggi: dall'ultima operazione societaria e dalla fine del veicolo di quotazione
    (rotazione.serie_della_societa, v492). Una regola sola per pavimenti, lettura a 5 anni e statistica (v161)."""
    if not barre:
        return []
    s, _, _ = R.serie_della_societa(barre, veicolo)
    return s


# ───────────────────────── lo stato di ogni giorno ─────────────────────────

def atr_serie(b, n=14):
    """L'ATR di Wilder su tutta la serie, allineato alle barre: lo stesso seme di brief.atr_wilder (un gate
    confronta l'ultimo valore, v161). None prima di n variazioni."""
    out = [None] * len(b)
    if len(b) < n + 1:
        return out
    tr = [max(b[i]["h"] - b[i]["l"], abs(b[i]["h"] - b[i - 1]["c"]), abs(b[i]["l"] - b[i - 1]["c"]))
          for i in range(1, len(b))]
    a = sum(tr[:n]) / n
    out[n] = a
    for i, x in enumerate(tr[n:], start=n + 1):
        a = (a * (n - 1) + x) / n
        out[i] = a
    return out


def stati(b):
    """Per ogni barra lo stato del giorno, con soli dati fino a quel giorno (niente futuro).
    tendenza: la regola di numeri_libro.tendenza — rotta (chiusura sotto la 200 e la 50 sotto la 200), in
    correzione (sotto una delle due), intatta; sotto 200 sedute None, mai 'intatta' (v406). Somme mobili: la
    deviazione standard e la media dei volumi delle sedute PRIMA, senza ricalcolare la finestra a ogni giorno."""
    c = [x["c"] for x in b]
    rsi = R.rsi_serie(c)
    atr = atr_serie(b)
    lr = [None] + [math.log(c[k] / c[k - 1]) if (c[k] and c[k - 1]) else None for k in range(1, len(c))]
    out = []
    s50 = s200 = 0.0
    sr = sq = 0.0; nr = 0           # log-rendimenti delle SEDUTE_SIGMA sedute prima di i
    sv = 0.0; nv = 0                # volumi delle SEDUTE_VOLUME sedute prima di i
    from collections import deque
    dq = deque()                    # indici delle chiusure massime dell'ultimo anno (fino a i compreso)
    for i, x in enumerate(b):
        s50 += c[i] - (c[i - 50] if i >= 50 else 0)
        s200 += c[i] - (c[i - 200] if i >= 200 else 0)
        d = {"i": i, "t": x["t"], "atr": atr[i], "rsi": rsi[i], "giorno": None, "tendenza": None}
        while dq and c[dq[-1]] <= c[i]:
            dq.pop()
        dq.append(i)
        while dq[0] <= i - SEDUTE_ANNO:
            dq.popleft()
        if i >= SEDUTE_ANNO - 1:
            d["dal_massimo"] = (c[i] / c[dq[0]] - 1) * 100
        if i >= SEDUTE_SIGMA + 1 and nr > 10 and lr[i] is not None:
            m = sr / nr
            sd = math.sqrt(max(sq / nr - m * m, 0))
            vr = (x.get("v") / (sv / nv)) if (nv and sv and x.get("v")) else None
            if sd:
                z = lr[i] / sd
                d.update({"z": z, "volumi": vr})
                tipo = "crollo" if z <= -SIGMA_GRANDE else "impennata" if z >= SIGMA_GRANDE else "normale"
                if tipo != "normale":
                    tipo += " con volumi da notizia" if (vr is not None and vr >= VOLUME_NOTIZIA) else \
                        " senza volumi anomali" if vr is not None else " (volumi non misurati)"
                d["giorno"] = tipo
        if i >= 199:
            m50, m200 = s50 / 50, s200 / 200
            d["tendenza"] = "rotta" if (c[i] < m200 and m50 < m200) else \
                ("in correzione" if (c[i] < m50 or c[i] < m200) else "intatta")
        out.append(d)
        # la finestra del giorno dopo (i+1) e' [i+1-finestra, i]: entra il giorno i, esce il giorno i - finestra
        if lr[i] is not None:
            sr += lr[i]; sq += lr[i] * lr[i]; nr += 1
        k = i - SEDUTE_SIGMA
        if k >= 1 and lr[k] is not None:
            sr -= lr[k]; sq -= lr[k] * lr[k]; nr -= 1
        if x.get("v"):
            sv += x["v"]; nv += 1
        k = i - SEDUTE_VOLUME
        if k >= 0 and b[k].get("v"):
            sv -= b[k]["v"]; nv -= 1
    return out


_STATI = {}


def stati_di(tk, b):
    """Gli stati di una serie si calcolano una volta per giro (la stessa lista di barre, la stessa risposta)."""
    k = (tk, len(b), b[-1]["t"] if b else None)
    if k not in _STATI:
        _STATI[k] = stati(b)
    return _STATI[k]


def chiave(d):
    """Lo stato che decide i casi simili. Una seduta fuori dal comune conta piu' dell'RSI: un crollo si confronta
    coi crolli nella stessa tendenza; una seduta normale con la tendenza e, se l'RSI e' agli estremi, la sua fascia,
    altrimenti la distanza dal massimo dell'anno (convenzioni in LIBRO.md §1quindecies)."""
    if not d or d.get("giorno") is None or d.get("tendenza") is None:
        return None
    if d["giorno"] != "normale":
        return (d["giorno"], d["tendenza"])
    r, m = d.get("rsi"), d.get("dal_massimo")
    if r is not None and (r < RSI_BASSO or r > RSI_ALTO):
        fascia = "RSI ipervenduto" if r < RSI_BASSO else "RSI ipercomprato"
    elif m is not None:
        a, b, c = FASCE_MASSIMO
        fascia = (f"entro il {a}% dal massimo dell'anno" if m > -a else f"fra il {a}% e il {b}% sotto il massimo dell'anno"
                  if m > -b else f"fra il {b}% e il {c}% sotto il massimo dell'anno" if m > -c else f"oltre il {c}% sotto il massimo dell'anno")
    else:
        return None
    return ("normale", d["tendenza"], fascia)


def chiave_larga(k):
    """Quando lo stato pieno ha troppi pochi casi: la sola seduta (crollo, impennata) o la sola tendenza."""
    if not k:
        return None
    return (k[0],) if k[0] != "normale" else ("normale", k[1])


def corrisponde(k, kk):
    return kk is not None and k is not None and tuple(k[:len(kk)]) == tuple(kk)


# ───────────────────────── i casi simili e cosa e' successo dopo ─────────────────────────

def esito_geometria(b, i, ks, kt, h=60, fino=None):
    """L'operazione di oggi riapplicata al caso i: entrata alla chiusura, stop a ks ATR sotto, obiettivo a kt ATR
    sopra. Chi viene toccato PRIMA nelle 60 sedute dopo; se nello stesso giorno sono toccati entrambi conta lo stop
    (prudente, dichiarato). Nessuno dei due: l'esito e' la chiusura della sessantesima seduta, in R.
    None se la finestra non e' tutta prima di `fino` (niente futuro nelle prove retroattive)."""
    atr = atr_serie(b[:i + 1])[-1] if not isinstance(b[i].get("_atr"), (int, float)) else b[i]["_atr"]
    if not atr or i + h >= len(b) or (fino and b[i + h]["t"] > fino):
        return None
    e = b[i]["c"]
    stop, obiettivo = e - ks * atr, e + kt * atr
    for j in range(i + 1, i + h + 1):
        if b[j]["l"] <= stop:
            return {"esito": "stop", "R": -1.0, "sedute": j - i}
        if b[j]["h"] >= obiettivo:
            return {"esito": "obiettivo", "R": kt / ks, "sedute": j - i}
    return {"esito": "nessuno", "R": (b[i + h]["c"] - e) / (ks * atr), "sedute": h}


def strategie_stop(b, i, atr, h=60):
    """v529 — cosa avrebbero dato, nel caso i, TENERE senza stop, lo stop al PAREGGIO armato dopo un rialzo di k ATR
    (si esce al prezzo d'ingresso se poi ci torna) e lo stop FISSO k ATR sotto l'ingresso, in % a 60 sedute. Lo stop al
    pareggio si arma col massimo di una seduta e scatta dalle sedute DOPO (prudente: nello stesso giorno non si sa
    cosa e' venuto prima). Il prezzo pagato non entra: conta solo cosa succede dopo l'ingresso."""
    if not atr or i + h >= len(b):
        return None
    e = b[i]["c"]
    fine = (b[i + h]["c"] / e - 1) * 100
    out = {"tenere": fine}
    for k in STOP_PAREGGIO_ATR:
        armato, r = False, fine
        for j in range(i + 1, i + h + 1):
            if armato and b[j]["l"] <= e:
                r = 0.0
                break
            if b[j]["h"] >= e + k * atr:
                armato = True
        out[f"pareggio dopo +{_n(k)} ATR"] = r
    for k in STOP_FISSO_ATR:
        r = fine
        for j in range(i + 1, i + h + 1):
            if b[j]["l"] <= e - k * atr:
                r = -k * atr / e * 100
                break
        out[f"stop fisso -{_n(k)} ATR"] = r
    return out


def conferma(b, i, fino=None):
    """L'indice della prima chiusura sopra il massimo del giorno i, entro ATTESA_MAX sedute (None se non arriva,
    o se arriverebbe dopo `fino`)."""
    for j in range(i + 1, min(i + ATTESA_MAX, len(b) - 1) + 1):
        if fino and b[j]["t"] > fino:
            return None
        if b[j]["c"] > b[i]["h"]:
            return j
    return None


def casi(B, k, ks, kt, fino=None, rif=None, escludi=None):
    """Tutti i casi dello stato k (o della chiave larga, se k e' una chiave larga) nell'universo, al piu' uno ogni
    DISTANZA sedute per titolo, con la finestra di 60 sedute tutta prima di `fino`. k=None = la BASE: ogni giorno.
    Per ogni caso: rendimento a 20 e 60 sedute, eccesso sul riferimento negli stessi giorni (per DATA, v207),
    esito della geometria e, dopo un crollo o un'impennata, la variante con la conferma."""
    rrif = {x["t"]: x["c"] for x in (rif or [])}
    out = []
    for tk, b in B.items():
        if not b or tk == escludi:
            continue
        ss = stati_di(tk, b)
        for x, s in zip(b, ss):
            x["_atr"] = s["atr"]
        ultimo = -10 ** 9
        for s in ss:
            i = s["i"]
            if i - ultimo < DISTANZA or s["atr"] is None:
                continue
            kk = chiave(s)
            if kk is None or (k is not None and not corrisponde(kk, k)):
                continue
            if i + max(ORIZZONTI) >= len(b) or (fino and b[i + max(ORIZZONTI)]["t"] > fino):
                continue
            c0 = b[i]["c"]
            r = {h: (b[i + h]["c"] / c0 - 1) * 100 for h in ORIZZONTI}
            ecc = {}
            for h in ORIZZONTI:
                a0, a1 = rrif.get(b[i]["t"]), rrif.get(b[i + h]["t"])
                ecc[h] = r[h] - (a1 / a0 - 1) * 100 if (a0 and a1) else None
            g = esito_geometria(b, i, ks, kt, fino=fino)
            att = None
            if kk[0] != "normale":
                j = conferma(b, i, fino)
                att = {"confermato": j is not None,
                       "esito": esito_geometria(b, j, ks, kt, fino=fino) if j is not None else None}
            out.append({"tk": tk, "t": b[i]["t"], "r": r, "eccesso": ecc, "geometria": g, "attesa": att,
                        "stop": strategie_stop(b, i, s["atr"])})
            ultimo = i
    return out


def riassunto(cc):
    """I numeri di un insieme di casi: quanti, su quanti titoli, mediana e quartili, quota positiva, eccesso
    mediano, valore atteso in R con il suo errore standard."""
    if not cc:
        return {"n": 0, "titoli": 0}
    out = {"n": len(cc), "titoli": len({c["tk"] for c in cc})}
    for h in ORIZZONTI:
        v = sorted(c["r"][h] for c in cc)
        e = [c["eccesso"][h] for c in cc if c["eccesso"][h] is not None]
        q = st.quantiles(v, n=4) if len(v) >= 4 else [None, st.median(v), None]
        out[h] = {"mediana": st.median(v), "q1": q[0], "q3": q[2], "positivi": sum(x > 0 for x in v) / len(v) * 100,
                  "media": st.fmean(v), "es": (st.stdev(v) / math.sqrt(len(v))) if len(v) > 1 else None,
                  "eccesso": st.median(e) if e else None}
    g = [c["geometria"] for c in cc if c["geometria"]]
    if g:
        rr = [x["R"] for x in g]
        out["geometria"] = {"n": len(g), "ev": st.fmean(rr), "es": (st.stdev(rr) / math.sqrt(len(rr))) if len(rr) > 1 else None,
                            "obiettivo": sum(x["esito"] == "obiettivo" for x in g) / len(g) * 100,
                            "stop": sum(x["esito"] == "stop" for x in g) / len(g) * 100}
    sv = [c["stop"] for c in cc if c.get("stop")]
    if sv:
        out["stop"] = {}
        for nome in sv[0]:
            v = sorted(x[nome] for x in sv)
            q = st.quantiles(v, n=10) if len(v) >= 10 else [None] * 9
            out["stop"][nome] = {"media": st.fmean(v), "es": (st.stdev(v) / math.sqrt(len(v))) if len(v) > 1 else None,
                                 "peggiori": q[0], "migliori": q[-1],
                                 "uscito": sum(x[nome] != x["tenere"] for x in sv) / len(sv) * 100}
    a = [c["attesa"] for c in cc if c.get("attesa") is not None]
    if a:
        ok = [x["esito"]["R"] for x in a if x["confermato"] and x["esito"]]
        out["attesa"] = {"casi": len(a), "confermati": sum(x["confermato"] for x in a) / len(a) * 100,
                         "n": len(ok), "ev": st.fmean(ok) if ok else None,
                         "es": (st.stdev(ok) / math.sqrt(len(ok))) if len(ok) > 1 else None}
    return out


def verdetto(geo):
    """La lettura della geometria — convenzione dichiarata (LIBRO.md §1quindecies), non un ordine: A FAVORE se il
    valore atteso supera +0,1 R E due errori standard; CONTRO se sta sotto -0,1 R e oltre due errori; altrimenti la
    statistica non distingue l'operazione dal caso. Due errori, come il confronto con la base: una regola sola. Sotto 30 casi NON DICE."""
    if not geo or geo["n"] < MIN_CASI:
        return "LA STATISTICA NON DICE", f"meno di {MIN_CASI} casi indipendenti"
    ev, es = geo["ev"], geo["es"] or 0
    if ev >= SOGLIA_EV and ev > ERRORI * es:
        return "A FAVORE", f"valore atteso positivo oltre {ERRORI} errori standard"
    if ev <= -SOGLIA_EV and -ev > ERRORI * es:
        return "CONTRO", f"valore atteso negativo oltre {ERRORI} errori standard"
    return "NON DISTINGUIBILE DAL CASO", f"valore atteso dentro ±{_n(SOGLIA_EV)} R o entro {ERRORI} errori standard"


# ───────────────────────── l'operazione di oggi ─────────────────────────

def geometria_oggi(b, px, atr, veicolo=None):
    """Stop e obiettivo dell'operazione, in ATR. Stop: quello del pavimento piu' vicino sotto il prezzo
    (rotazione.pavimenti: il fondo meno 1 ATR, la convenzione del CEO del 15/10); se non c'e' o sta oltre 4 ATR,
    2 ATR. Obiettivo: il massimo di oscillazione piu' vicino sopra il prezzo (rotazione.perni, la regola dei
    pavimenti, v494); se non c'e', 2 volte il rischio. Ogni scelta e' dichiarata nella riga."""
    p = R.pavimenti(b, px, atr) or {}
    sotto = [z for z in (p.get("minimi") or []) if z.get("stop") is not None and z["stop"] < px]
    z = max(sotto, key=lambda z: z["stop"]) if sotto else None
    if z and (px - z["stop"]) / atr <= STOP_LONTANO_ATR:
        ks, perche_s = (px - z["stop"]) / atr, f"sotto il pavimento {_n(z['fondo'], 2)} (meno 1 ATR)"
    else:
        ks, perche_s = STOP_STANDARD_ATR, f"lo stop standard: nessun pavimento entro {_n(STOP_LONTANO_ATR)} ATR sotto il prezzo"
    s = serie(b, veicolo)
    alti = sorted(s[i]["h"] for i in R.perni(s, campo="h", massimi=True) if s[i]["h"] > px + 0.5 * atr) if s else []
    if alti:
        kt, perche_t = (alti[0] - px) / atr, f"il massimo di oscillazione {_n(alti[0], 2)}"
    else:
        kt, perche_t = OBIETTIVO_STANDARD_R * ks, f"{_n(OBIETTIVO_STANDARD_R)} volte il rischio: nessun massimo di oscillazione sopra"
    return {"ks": ks, "kt": kt, "stop": px - ks * atr, "obiettivo": px + kt * atr, "perche_stop": perche_s,
            "perche_obiettivo": perche_t, "pareggio": 1 / (1 + kt / ks) * 100}


def sopravvivenza(k):
    """Vero negli stati di una discesa profonda (oltre il 25% sotto il massimo dell'anno): e' li' che i nomi seguiti
    OGGI sono per costruzione quelli che si sono ripresi, e chi non si e' ripreso non e' nell'universo."""
    return bool(k) and len(k) > 2 and (k[2].startswith(f"fra il {FASCE_MASSIMO[1]}%") or k[2].startswith("oltre il"))


def descrivi(k):
    if not k:
        return "stato non misurabile"
    if k[0] != "normale":
        return f"{k[0]}" + (f", tendenza {k[1]}" if len(k) > 1 else "")
    return "seduta normale" + (f", tendenza {k[1]}" if len(k) > 1 else "") + (f", {k[2]}" if len(k) > 2 else "")


def prova(tk, prezzo=None, data=None, B=None, veicolo=None, adesso=None):
    """La prova d'ingresso: lo stato del nome alla data, i casi simili, la geometria, il valore atteso, la
    variante con la conferma e, in una prova retroattiva, cosa e' successo dopo. Solo fatti contati."""
    nomi, _ = universo()
    nomi = list(dict.fromkeys(nomi + [tk]))
    B = B if B is not None else leggi_barre(nomi, adesso)
    if not B.get(tk):
        return {"tk": tk, "errore": "storico NON letto: senza le barre non c'e' statistica, e non e' 'nessun segnale'"}
    Bs = {t: serie(b, veicolo if t == tk else None) for t, b in B.items() if b}
    b = Bs[tk]
    fino = data or b[-1]["t"][:10]
    idx = max((i for i, x in enumerate(b) if x["t"][:10] <= fino), default=None)
    if idx is None or idx < 200:
        return {"tk": tk, "errore": f"meno di 200 sedute fino al {fino}: la tendenza non si misura"}
    ss = stati(b[:idx + 1])
    oggi = ss[-1]
    px = prezzo or b[idx]["c"]
    atr = oggi["atr"]
    g = geometria_oggi(b[:idx + 1], px, atr)
    k = chiave(oggi)
    rif = Bs.get(RIFERIMENTO)
    Bu = {t: x for t, x in Bs.items() if t != RIFERIMENTO}
    pieno = riassunto(casi(Bu, k, g["ks"], g["kt"], fino=fino, rif=rif))
    largo = None
    if pieno["n"] < MIN_CASI:
        largo = riassunto(casi(Bu, chiave_larga(k), g["ks"], g["kt"], fino=fino, rif=rif))
    base = riassunto(casi(Bu, None, g["ks"], g["kt"], fino=fino, rif=rif))
    dopo = None
    if idx < len(b) - 1:
        fine = b[-1]
        dopo = {"fino_al": fine["t"][:10], "sedute": len(b) - 1 - idx, "rendimento": (fine["c"] / px - 1) * 100,
                "minimo": min(x["l"] for x in b[idx + 1:]), "massimo": max(x["h"] for x in b[idx + 1:])}
    return {"tk": tk, "data": b[idx]["t"][:10], "prezzo": px, "chiusura": b[idx]["c"], "atr": atr, "oggi": oggi,
            "chiave": k, "geometria": g, "pieno": pieno, "largo": largo, "base": base, "dopo": dopo,
            "universo": len(Bu), "non_letti": sorted(t for t in nomi if not B.get(t))}


def _riga_r(nome, s, h):
    x = s.get(h) or {}
    return (f"{nome}: mediana {_n(x.get('mediana'), 1, True)}% (fra {_n(x.get('q1'), 1, True)}% e "
            f"{_n(x.get('q3'), 1, True)}% per meta' dei casi) · positivi {_n(x.get('positivi'), 0)}% · sul "
            f"{RIFERIMENTO} {_n(x.get('eccesso'), 1, True)} punti")


def resa_prova(p):
    if p.get("errore"):
        return [f"PROVA D'INGRESSO — {p['tk']}: {p['errore']}"]
    o, g = p["oggi"], p["geometria"]
    L = [f"PROVA D'INGRESSO — {p['tk']} a {_n(p['prezzo'], 2)} · seduta del {p['data']} (chiusura {_n(p['chiusura'], 2)})"
         " · solo fatti contati, non un ordine (v528)",
         f"  STATO: {descrivi(p['chiave'])}" + (f" · seduta a {_n(o.get('z'), 1, True)} deviazioni standard, volumi "
                                                 f"{_n(o.get('volumi'), 1)} volte la media" if o.get("z") is not None else "")
         + (f" · RSI {_n(o.get('rsi'), 0)}" if o.get("rsi") is not None else ""),
         f"  GEOMETRIA: stop {_n(g['stop'], 2)} ({_n(g['ks'], 1)} ATR, {g['perche_stop']}) · obiettivo "
         f"{_n(g['obiettivo'], 2)} ({_n(g['kt'], 1)} ATR, {g['perche_obiettivo']}) · rapporto {_n(g['kt'] / g['ks'], 2)} R · "
         f"per andare in pari basta avere ragione il {_n(g['pareggio'], 0)}% delle volte"]
    usa = p["pieno"]
    L.append(f"  CASI SIMILI: {usa['n']} su {usa['titoli']} titoli (un caso al piu' ogni {DISTANZA} sedute per titolo)"
             + (" ⚠ discesa profonda: qui la distorsione da sopravvivenza pesa di piu'" if sopravvivenza(p['chiave']) else ""))
    if usa["n"] < MIN_CASI and p["largo"]:
        L.append(f"  ⚠ sotto {MIN_CASI} casi lo stato pieno non generalizza: si legge lo stato LARGO, "
                 f"«{descrivi(chiave_larga(p['chiave']))}» — {p['largo']['n']} casi su {p['largo']['titoli']} titoli")
        usa = p["largo"]
    if usa["n"]:
        for h in ORIZZONTI:
            L.append("    " + _riga_r(f"a {h} sedute", usa, h))
        L.append("    " + _riga_r(f"BASE (tutti i giorni, a {max(ORIZZONTI)} sedute)", p["base"], max(ORIZZONTI)))
        diff = usa[max(ORIZZONTI)]["media"] - p["base"][max(ORIZZONTI)]["media"]
        es = usa[max(ORIZZONTI)]["es"] or 0
        L.append(f"    differenza dalla base a {max(ORIZZONTI)} sedute (medie): {_n(diff, 1, True)} punti, errore standard "
                 f"{_n(es, 1)} → " + ("lo stato fa MEGLIO della base" if diff > ERRORI * es else
                                      "lo stato fa PEGGIO della base" if diff < -ERRORI * es else
                                      f"non distinguibile dalla base (entro {ERRORI} errori standard)"))
    geo = usa.get("geometria")
    v, perche = verdetto(geo)
    if geo:
        L.append(f"  L'OPERAZIONE NEI CASI SIMILI: obiettivo prima dello stop {_n(geo['obiettivo'], 0)}% · stop prima "
                 f"{_n(geo['stop'], 0)}% · nessuno dei due in {max(ORIZZONTI)} sedute il resto · VALORE ATTESO "
                 f"{_n(geo['ev'], 2, True)} R (errore {_n(geo['es'], 2)})")
    L.append(f"  → {v}: {perche} (convenzione, LIBRO.md §1quindecies)")
    a = usa.get("attesa")
    if a:
        L.append(f"  ASPETTARE LA CONFERMA (una chiusura sopra il massimo del giorno, entro {ATTESA_MAX} sedute): arriva "
                 f"nel {_n(a['confermati'], 0)}% dei casi · valore atteso di chi aspetta {_n(a['ev'], 2, True)} R su "
                 f"{a['n']} casi (errore {_n(a['es'], 2)}) contro {_n(geo['ev'] if geo else None, 2, True)} R di chi entra subito")
    sp = usa.get("stop")
    if sp:
        L.append(f"  GLI STOP NEI CASI SIMILI (a {max(ORIZZONTI)} sedute; 1 ATR = {_n(p['atr'], 2)} $, il "
                 f"{_n(p['atr'] / p['prezzo'] * 100, 1)}% del prezzo: piu' stretto di cosi' lo stop lo tocca il rumore):")
        for nome, x in sp.items():
            L.append(f"    {nome:24} media {_n(x['media'], 1, True)}% (errore {_n(x['es'], 1)}) · peggior 10% "
                     f"{_n(x['peggiori'], 1, True)}% · miglior 10% {_n(x['migliori'], 1, True)}% · esce nel "
                     f"{_n(x['uscito'], 0)}% dei casi")
        L.append("    il prezzo pagato non entra nel conto: conta solo cosa e' successo DOPO l'ingresso")
    if p.get("dopo"):
        d = p["dopo"]
        L.append(f"  COSA E' SUCCESSO DOPO (fino al {d['fino_al']}, {d['sedute']} sedute): {_n(d['rendimento'], 1, True)}% "
                 f"dal prezzo d'ingresso · minimo {_n(d['minimo'], 2)} · massimo {_n(d['massimo'], 2)} · stop "
                 + ("TOCCATO" if d["minimo"] <= g["stop"] else "non toccato")
                 + " · obiettivo " + ("TOCCATO" if d["massimo"] >= g["obiettivo"] else "non toccato"))
    L.append(f"  ⚠ universo: i {p['universo']} nomi seguiti oggi (posizioni e sorvegliati, 5 anni) — scelti perche' "
             "interessanti adesso, cioe' anche sopravvissuti: la statistica pende verso chi e' andato bene"
             + (f" · non letti: {', '.join(p['non_letti'])}" if p["non_letti"] else ""))
    return L


# ───────────────────────── la pagina statistica delle posizioni ─────────────────────────

def pagina(B=None, adesso=None):
    """Per ogni posizione: lo stato di oggi e cosa e' successo nei casi simili a 20 e 60 sedute, contro la base.
    E' la lettura di chi TIENE: la geometria e' quella standard (stop 2 ATR, obiettivo 2 R), dichiarata."""
    nomi, pos = universo()
    B = B if B is not None else leggi_barre(nomi, adesso)
    Bs = {t: serie(b) for t, b in B.items() if b}
    rif = Bs.get(RIFERIMENTO)
    Bu = {t: x for t, x in Bs.items() if t != RIFERIMENTO}
    ks, kt = STOP_STANDARD_ATR, STOP_STANDARD_ATR * OBIETTIVO_STANDARD_R
    base = riassunto(casi(Bu, None, ks, kt, rif=rif))
    righe = []
    for tk in pos:
        b = Bs.get(tk)
        if not b or len(b) < 200:
            righe.append({"tk": tk, "errore": "storico NON letto" if not b else f"{len(b)} sedute: la tendenza non si misura"})
            continue
        oggi = stati(b)[-1]
        k = chiave(oggi)
        s = riassunto(casi(Bu, k, ks, kt, rif=rif))
        largo = s["n"] < MIN_CASI
        if largo:
            s = riassunto(casi(Bu, chiave_larga(k), ks, kt, rif=rif))
        righe.append({"tk": tk, "data": b[-1]["t"][:10], "chiave": k, "largo": largo, "s": s})
    return {"base": base, "righe": righe, "universo": len(Bu)}


def resa_pagina(pg):
    h = max(ORIZZONTI)
    bs = pg["base"].get(h) or {}
    L = [f"PAGINA STATISTICA (v528) — per ogni posizione: lo stato di oggi e cosa e' successo nei casi simili dei "
         f"{pg['universo']} nomi seguiti (5 anni, un caso al piu' ogni {DISTANZA} sedute per titolo), contro la BASE di "
         f"tutti i giorni: a {h} sedute mediana {_n(bs.get('mediana'), 1, True)}%, positivi {_n(bs.get('positivi'), 0)}%",
         "  ⚠ e' cio' che e' successo, non una previsione; l'universo pende verso chi e' sopravvissuto"]
    for r in pg["righe"]:
        if r.get("errore"):
            L.append(f"  {r['tk']:5} {r['errore']}")
            continue
        s = r["s"]
        x = s.get(h) or {}
        if not s["n"]:
            L.append(f"  {r['tk']:5} {descrivi(r['chiave'])} · nessun caso simile")
            continue
        diff = x["media"] - (bs.get("media") or 0)
        es = x.get("es") or 0
        giudizio = "MEGLIO della base" if diff > ERRORI * es else "PEGGIO della base" if diff < -ERRORI * es else "come la base"
        L.append(f"  {r['tk']:5} {descrivi(r['chiave'])}" + (" (stato LARGO: lo stato pieno ha meno di "
                                                             f"{MIN_CASI} casi)" if r["largo"] else "")
                 + f" · {s['n']} casi su {s['titoli']} titoli · a 20 sedute {_n((s.get(20) or {}).get('mediana'), 1, True)}%"
                 f" · a {h} {_n(x['mediana'], 1, True)}% (positivi {_n(x['positivi'], 0)}%) → {giudizio}"
                 + (" ⚠ discesa profonda: qui la distorsione da sopravvivenza pesa di piu'" if sopravvivenza(r['chiave']) else ""))
    return L


# ───────────────────────── il diario delle decisioni ─────────────────────────

def registra(p, intuizione, adesso=None):
    """Una riga per decisione: lo stato, la statistica di quel giorno e l'intuizione del CEO, PRIMA di sapere
    com'e' andata. Dopo 20-30 righe il bilancio dice se l'intuito batte la statistica (v528)."""
    usa = p["largo"] if (p["pieno"]["n"] < MIN_CASI and p["largo"]) else p["pieno"]
    geo = usa.get("geometria") or {}
    riga = {"scritto": (adesso or datetime.now(timezone.utc)).isoformat(timespec="minutes"), "tk": p["tk"],
            "data": p["data"], "prezzo": p["prezzo"], "stato": descrivi(p["chiave"]), "casi": usa["n"],
            "ev_R": round(geo["ev"], 3) if geo.get("ev") is not None else None, "verdetto": verdetto(geo or None)[0],
            "stop": round(p["geometria"]["stop"], 4), "obiettivo": round(p["geometria"]["obiettivo"], 4),
            "intuizione": intuizione}
    with open(DIARIO, "a", encoding="utf-8") as f:
        f.write(json.dumps(riga, ensure_ascii=False) + "\n")
    return riga


def bilancio(B=None, adesso=None):
    """Ogni decisione del diario contro cio' che e' successo dopo: rendimento a 20 e 60 sedute dal prezzo
    d'ingresso, quando le sedute ci sono; prima, si dice quante ne mancano. Raggruppato per verdetto."""
    try:
        righe = [json.loads(x) for x in open(DIARIO, encoding="utf-8") if x.strip()]
    except FileNotFoundError:
        return {"righe": [], "assente": True}
    B = B if B is not None else leggi_barre(sorted({r["tk"] for r in righe}), adesso)
    out = []
    for r in righe:
        b = B.get(r["tk"]) or []
        i = max((k for k, x in enumerate(b) if x["t"][:10] <= r["data"]), default=None)
        e = {"riga": r}
        for h in ORIZZONTI:
            e[h] = ((b[i + h]["c"] / r["prezzo"] - 1) * 100) if (i is not None and i + h < len(b)) else None
        e["sedute"] = (len(b) - 1 - i) if i is not None else None
        out.append(e)
    return {"righe": out}


def resa_bilancio(bl):
    if bl.get("assente"):
        return ["DIARIO DELLE DECISIONI: nessuna riga ancora (memoria/diario_ingressi.jsonl)"]
    L = [f"DIARIO DELLE DECISIONI — {len(bl['righe'])} righe: l'intuito contro la statistica, misurato dopo"]
    for e in bl["righe"]:
        r = e["riga"]
        esiti = " · ".join(f"a {h} sedute {_n(e[h], 1, True)}%" if e[h] is not None else
                           f"a {h} sedute: ne mancano {h - (e['sedute'] or 0)}" for h in ORIZZONTI)
        L.append(f"  {r['data']} {r['tk']} a {_n(r['prezzo'], 2)} · statistica: {r['verdetto']} ({_n(r['ev_R'], 2, True)} R su "
                 f"{r['casi']} casi) · intuizione: {r.get('intuizione') or '—'} · {esiti}")
    chiusi = [e for e in bl["righe"] if e[max(ORIZZONTI)] is not None]
    if len(chiusi) < MIN_CASI:
        L.append(f"  ⚠ {len(chiusi)} decisioni con {max(ORIZZONTI)} sedute dopo: sotto {MIN_CASI} il confronto fra intuito "
                 "e statistica non si legge ancora")
    return L


def main(argv):
    if not argv or argv[0] not in ("ingresso", "pagina", "bilancio"):
        print(__doc__)
        return 2
    if argv[0] == "pagina":
        pg = pagina()
        print("\n".join(resa_pagina(pg)))
        return 0
    if argv[0] == "bilancio":
        print("\n".join(resa_bilancio(bilancio())))
        return 0
    args = argv[1:]
    data = intuizione = None
    if "--data" in args:
        k = args.index("--data"); data = args[k + 1]; del args[k:k + 2]
    if "--registra" in args:
        k = args.index("--registra"); intuizione = args[k + 1]; del args[k:k + 2]
    tk = args[0].upper()
    prezzo = float(args[1].replace(",", ".")) if len(args) > 1 else None
    try:
        d = __import__("fonti_titoli").carica()
        veicolo = R.veicolo_pipeline(d, tk)
    except Exception:
        veicolo = None
    p = prova(tk, prezzo, data, veicolo=veicolo)
    print("\n".join(resa_prova(p)))
    if intuizione is not None and not p.get("errore"):
        registra(p, intuizione)
        print(f"  registrata nel diario (memoria/diario_ingressi.jsonl): si committa, come le altre memorie")
    return 0 if not p.get("errore") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
