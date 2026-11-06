#!/usr/bin/env python3
"""v535 — L'AFFIDABILITA' DI UNA PREVISIONE: la misura comune a tutti i metodi del sistema previsionale.

Decisione del CEO del 03/11/2026: un sistema previsionale «stile Polymarket» — per ogni evento una probabilita' e la
percentuale di affidabilita' — con l'ECCEZIONE MISURATA alla sua istruzione permanente n.1 («nessuna proiezione»): le
previsioni entrano SOLO come probabilita', separate dai fatti, ognuna col suo metodo, la sua base, il suo intervallo e
l'affidabilita' MISURATA — prima sul passato senza guardare il futuro, poi dal vivo dal registro. Mai una media di metodi
diversi (v200): i metodi stanno affiancati.

Una previsione e' una probabilita' su un evento che si risolve in SI' o NO entro una scadenza. La sua affidabilita' non
si dichiara: si misura, nello stesso modo per ogni metodo (v161, una grandezza una derivazione):
- BRIER: la media di (p - esito)², 0 e' perfetto, 0,25 e' dire sempre 50%;
- la BASE: la frequenza dell'evento senza condizioni (tutti i giorni), calcolata anch'essa solo col passato, e il
  Brier di chi dice sempre la base;
- l'ABILITA' (Brier skill score) = 1 - Brier / Brier della base: sopra zero il metodo sa qualcosa in piu' della base,
  sotto zero fa peggio di chi ripete la media;
- le FASCE DI CALIBRAZIONE: delle previsioni date fra il 60 e il 70%, quante si sono avverate, con l'intervallo di
  Wilson al 95% — e' la «% di affidabilita'» che il CEO chiede: quando il metodo dice 65%, succede davvero circa 65
  volte su 100?
- l'ERRORE DI CALIBRAZIONE (ECE): la distanza media, pesata per numerosita', fra le probabilita' dette e le frequenze
  avverate, fascia per fascia;
- su n previsioni insieme: quante se ne attendono (la somma delle p) e la probabilita' che se ne avverino almeno k
  (Poisson-binomiale: vale se gli eventi fossero indipendenti — non lo sono del tutto, e lo si dice).

Lo SCHEMA comune: `previsione(...)` costruisce il record che ogni metodo restituisce e che il registro conserva; il
campo `risolutore` descrive l'evento in modo che si possa risolvere DA SOLO con i dati (barre, serie FRED, registro
della performance, mercato esterno) — `evento_prezzo`, `evento_serie`, `evento_portafoglio`, `evento_esterno`.
Le soglie qui sotto sono convenzioni dichiarate (v240).

Modulo puro: nessuna rete, nessun file. Le rese testuali usano il formattatore unico (statistica._n), importato solo
quando serve.
"""
import math
from datetime import datetime, timezone

LARGHEZZA_FASCIA = 0.10      # le fasce di calibrazione: 0-10%, 10-20%, … 90-100%
Z = 1.96                     # intervallo di Wilson al 95%
MIN_FASCIA = 20              # sotto, la frequenza di una fascia non si legge: «non misurabile»
MIN_VALUTAZIONE = 100        # sotto, l'affidabilita' di un metodo non e' ancora misurabile, e lo si dice
SOGLIA_ABILITA = 0.02        # v537: un'abilita' dentro ±0,02 non distingue il metodo dalla base (v405: l'etichetta non
                             #   afferma piu' del dato)

METODI = {                   # il nome di ogni metodo come lo legge il CEO (i metodi stanno affiancati, mai mediati)
    "casi_simili": "casi simili (5 anni dei nomi seguiti)",
    "base": "base (tutti i giorni, senza condizioni)",
    "lognormale": "modello lognormale con la volatilita' realizzata",
    "opzioni": "opzioni (probabilita' neutrale al rischio, dal prezzo delle opzioni)",
    "polymarket": "Polymarket (quanto paga il mercato)",
    "kalshi": "Kalshi (quanto paga il mercato)",
    "fedwatch": "FedWatch (contratti sui Fed Funds)",
    "serie_storiche": "serie storiche (FRED, casi simili della serie)",
    "simulazione": "simulazione dai rendimenti storici (bootstrap a blocchi)",
}
FAMIGLIE = ("titoli", "portafoglio", "macro", "mercato")


# ───────────────────────── le misure ─────────────────────────

def wilson(k, n, z=Z):
    """(basso, alto) dell'intervallo di Wilson per k successi su n prove; None se n = 0."""
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - m), min(1.0, c + m)


def _esiti(ys):
    return [1.0 if bool(y) else 0.0 for y in ys]


def brier(ps, ys):
    """Media di (p - esito)²; None se non ci sono previsioni."""
    ys = _esiti(ys)
    if not ps:
        return None
    return sum((float(p) - y) ** 2 for p, y in zip(ps, ys)) / len(ps)


def fascia(p, larghezza=LARGHEZZA_FASCIA):
    """L'indice della fascia di p: 0,65 → 6 (60-70%); p = 1 sta nell'ultima."""
    # v537 (revisore, rilievo 10): int(0,3/0,1) = 2 in virgola mobile; si arrotonda prima di prendere la parte intera
    k = int(math.floor(round(float(p) / larghezza, 9)))
    return min(k, int(round(1 / larghezza)) - 1)


def valuta(ps, ys, basi=None, larghezza=LARGHEZZA_FASCIA, min_fascia=MIN_FASCIA, min_valutazione=MIN_VALUTAZIONE):
    """La misura dell'affidabilita' di un metodo su previsioni RISOLTE.
    ps: le probabilita' dette; ys: gli esiti (vero/falso); basi: la base AL MOMENTO di ogni previsione (senza futuro).
    Senza basi la base e' la frequenza delle stesse previsioni (in-campione): lo si dichiara nel campo 'base_dichiarata'.
    {'n', 'avverate', 'brier', 'brier_base', 'abilita', 'ece', 'fasce': [{da, a, n, p_media, frequenza, basso, alto,
    misurabile}], 'misurabile', 'base_dichiarata'}."""
    ps = [float(p) for p in ps]
    ys = _esiti(ys)
    n = len(ps)
    out = {"n": n, "avverate": int(sum(ys)), "brier": brier(ps, ys), "brier_base": None, "abilita": None, "ece": None,
           "fasce": [], "misurabile": n >= min_valutazione,
           "base_dichiarata": "la base di ogni previsione, calcolata col solo passato" if basi is not None
           else "la frequenza delle stesse previsioni (in campione)"}
    if not n:
        return out
    if basi is None:
        f = sum(ys) / n
        basi = [f] * n
    out["brier_base"] = brier([float(b) for b in basi], ys)
    if out["brier_base"]:
        out["abilita"] = 1 - out["brier"] / out["brier_base"]
    gruppi = {}
    for p, y in zip(ps, ys):
        gruppi.setdefault(fascia(p, larghezza), []).append((p, y))
    ece = 0.0
    for k in sorted(gruppi):
        g = gruppi[k]
        m = len(g)
        avv = sum(y for _, y in g)
        pm = sum(p for p, _ in g) / m
        fr = avv / m
        lo, hi = wilson(avv, m)
        out["fasce"].append({"da": round(k * larghezza, 10), "a": round((k + 1) * larghezza, 10), "n": m,
                             "p_media": pm, "frequenza": fr, "basso": lo, "alto": hi, "misurabile": m >= min_fascia})
        ece += m / n * abs(pm - fr)
    out["ece"] = ece
    return out


def fascia_di(p, valutazione):
    """La fascia di calibrazione in cui cade una previsione nuova, dalla valutazione del suo metodo; None se il metodo
    non ha previsioni in quella fascia."""
    if not valutazione:
        return None
    k = fascia(p)
    return next((f for f in valutazione["fasce"] if abs(f["da"] - k * LARGHEZZA_FASCIA) < 1e-9), None)


def quante_si_avverano(ps):
    """Su n previsioni insieme: {'n', 'attese': somma delle p, 'almeno': [P(almeno k) per k = 0..n]} —
    Poisson-binomiale, che suppone gli eventi INDIPENDENTI (non lo sono del tutto: i titoli si muovono insieme)."""
    dist = [1.0]
    for p in ps:
        p = float(p)
        nuova = [0.0] * (len(dist) + 1)
        for k, q in enumerate(dist):
            nuova[k] += q * (1 - p)
            nuova[k + 1] += q * p
        dist = nuova
    almeno = [sum(dist[k:]) for k in range(len(dist))]
    return {"n": len(ps), "attese": sum(float(p) for p in ps), "almeno": almeno}


# ───────────────────────── lo schema comune ─────────────────────────

def evento_prezzo(tk, tipo, soglia, dal, sedute, media=None):
    """Un evento sul prezzo di un titolo o di un riferimento, risolvibile dalle barre:
    tipo: 'chiude_sopra' (la chiusura della seduta n. `sedute` dopo `dal` sopra la soglia) · 'tocca_su' (un massimo
    sopra o alla soglia entro `sedute`) · 'tocca_giu' (un minimo sotto o alla soglia entro `sedute`) ·
    'chiude_sopra_media' (una chiusura sopra la media a `media` sedute entro `sedute`; soglia ignorata)."""
    assert tipo in ("chiude_sopra", "tocca_su", "tocca_giu", "chiude_sopra_media")
    return {"genere": "prezzo", "tk": tk, "tipo": tipo, "soglia": soglia, "dal": dal, "sedute": int(sedute),
            "media": media}


def evento_serie(serie, tipo, soglia, dal, sedute):
    """Un evento su una serie FRED giornaliera (spread, rendimenti, volatilita'): 'tocca_sopra' · 'tocca_sotto' ·
    'finisce_sopra' entro `sedute` osservazioni dopo `dal`."""
    assert tipo in ("tocca_sopra", "tocca_sotto", "finisce_sopra")
    return {"genere": "serie", "serie": serie, "tipo": tipo, "soglia": soglia, "dal": dal, "sedute": int(sedute)}


def evento_portafoglio(tipo, soglia, dal, sedute, nomi=None):
    """Un evento sul portafoglio: 'calo_dal_massimo' (il calo dal massimo della misura del salvavita arriva alla
    soglia, negativa, entro `sedute`) · 'torna_al_massimo' (la misura torna al massimo entro `sedute`) ·
    'tutti_al_carico' (ognuno dei `nomi` tocca il proprio carico entro `sedute`; soglia = {ticker: carico})."""
    assert tipo in ("calo_dal_massimo", "torna_al_massimo", "tutti_al_carico")
    return {"genere": "portafoglio", "tipo": tipo, "soglia": soglia, "dal": dal, "sedute": int(sedute),
            "nomi": list(nomi) if nomi else None}


def evento_esterno(fonte, id_mercato, esito_atteso, scade, url=None):
    """Un evento di un mercato di previsione esterno (Polymarket, Kalshi, FedWatch): si risolve con l'esito che il
    mercato dichiara. esito_atteso: l'esito di cui p e' la probabilita' (per esempio 'Yes')."""
    return {"genere": "esterno", "fonte": fonte, "id": str(id_mercato), "esito_atteso": esito_atteso, "scade": scade,
            "url": url}


def previsione(famiglia, soggetto, evento, probabilita, metodo, risolutore, scade=None, base=None, n=None,
               intervallo=None, extra=None, scritto=None):
    """Il record di una previsione, uguale per tutti i metodi. evento: la frase che legge il CEO («NVDA sopra 203,80 fra
    20 sedute»); probabilita' in [0, 1]; base: la base dello stesso evento (senza condizioni); n: i casi su cui poggia;
    intervallo: (basso, alto) se il metodo lo ha; scade: la data indicativa (AAAA-MM-GG) — l'evento si risolve dal
    risolutore, non da questa data."""
    assert famiglia in FAMIGLIE, famiglia
    assert metodo in METODI, metodo
    p = float(probabilita)
    assert 0.0 <= p <= 1.0, p
    scritto = scritto or datetime.now(timezone.utc).isoformat(timespec="minutes")
    chiave = f"{soggetto}|{evento}"
    return {"id": f"{scritto[:10]}|{chiave}|{metodo}", "scritto": scritto, "famiglia": famiglia, "soggetto": soggetto,
            "evento": evento, "chiave": chiave, "probabilita": p, "metodo": metodo, "base": base, "n": n,
            "intervallo": list(intervallo) if intervallo else None, "scade": scade, "risolutore": risolutore,
            "extra": extra or {}, "esito": None, "risolto_il": None}


def risolvi(prev, esito, quando):
    """La previsione con l'esito: True/False, o None con il perche' in extra['non_risolta'] (un dato mancante non e' un
    NO, v205)."""
    r = dict(prev)
    r["esito"] = None if esito is None else bool(esito)
    r["risolto_il"] = quando
    return r


# ───────────────────────── le rese ─────────────────────────

def _p(x, d=0):
    from statistica import _n
    return "n.d." if x is None else _n(100 * x, d) + "%"


def riga_affidabilita(p, valutazione, metodo=None):
    """La frase dell'affidabilita' di una previsione nuova: la fascia in cui cade, quante volte si e' avverata, su
    quanti casi, con l'intervallo; e l'abilita' del metodo contro la base. Le assenze si dicono."""
    nome = METODI.get(metodo, metodo or "il metodo")
    if not valutazione or not valutazione.get("n"):
        return f"affidabilita' di {nome}: non ancora misurata (nessuna previsione risolta)"
    f = fascia_di(p, valutazione)
    if not f:
        testo = f"nella fascia {_p(fascia(p) * LARGHEZZA_FASCIA)}-{_p((fascia(p) + 1) * LARGHEZZA_FASCIA)} il metodo non ha previsioni risolte"
    elif not f["misurabile"]:
        testo = f"nella fascia {_p(f['da'])}-{_p(f['a'])} solo {f['n']} previsioni risolte: non misurabile"
    else:
        testo = (f"quando {nome} ha detto {_p(f['da'])}-{_p(f['a'])}, e' successo nel {_p(f['frequenza'])} dei casi "
                 f"({f['n']}, fra {_p(f['basso'])} e {_p(f['alto'])})")
    from statistica import _n
    ab = valutazione.get("abilita")
    sk = ("" if ab is None else f" · contro la base: abilita' {_n(ab, 2, True)} "
          f"({'sa qualcosa in piu' if ab > SOGLIA_ABILITA else ('non si distingue' if ab >= -SOGLIA_ABILITA else 'fa peggio')} della base)")
    if not valutazione.get("misurabile"):
        sk += f" · ⚠ {valutazione['n']} previsioni risolte, sotto le {MIN_VALUTAZIONE}: affidabilita' non ancora solida"
    return testo + sk


def verifiche():
    """Le prove della fondazione, senza rete: (nome, esito, dettaglio)."""
    V = []
    lo, hi = wilson(50, 100)
    V.append(("wilson: 50 su 100 sta fra circa 40 e 60%", 0.40 < lo < 0.41 and 0.59 < hi < 0.60, f"{lo:.4f}-{hi:.4f}"))
    V.append(("brier: sempre 50% su esiti misti vale 0,25", abs(brier([0.5] * 4, [1, 0, 1, 0]) - 0.25) < 1e-12, ""))
    # un metodo perfettamente calibrato: in ogni fascia la frequenza avverata e' vicina alla p detta
    ps, ys = [], []
    for k in range(10):
        p = (k + 0.5) / 10
        for i in range(200):
            ps.append(p)
            ys.append(i < round(p * 200))
    v = valuta(ps, ys, basi=[0.5] * len(ps))
    V.append(("valuta: un metodo calibrato ha ECE quasi zero e abilita' positiva contro la base del 50%",
              v["ece"] < 0.01 and v["abilita"] > 0.3 and all(f["misurabile"] for f in v["fasce"]),
              f"ece {v['ece']:.4f} abilita' {v['abilita']:.3f}"))
    # un metodo sovraconfidente (dice 90% quando succede il 50%) deve mostrare ECE alto e abilita' negativa
    v2 = valuta([0.9] * 200, [i % 2 == 0 for i in range(200)], basi=[0.5] * 200)
    V.append(("valuta: un metodo sovraconfidente ha ECE alto e abilita' negativa (fa peggio della base)",
              v2["ece"] > 0.35 and v2["abilita"] < 0, f"ece {v2['ece']:.3f} abilita' {v2['abilita']:.3f}"))
    q = quante_si_avverano([0.5, 0.5])
    V.append(("quante_si_avverano: due monete — attese 1, almeno una 75%, entrambe 25%",
              abs(q["attese"] - 1) < 1e-12 and abs(q["almeno"][1] - 0.75) < 1e-12 and abs(q["almeno"][2] - 0.25) < 1e-12, ""))
    r = previsione("titoli", "NVDA", "NVDA sopra 203,80 fra 20 sedute", 0.62, "casi_simili",
                   evento_prezzo("NVDA", "chiude_sopra", 203.80, "2026-11-03", 20), base=0.58, n=600,
                   scritto="2026-11-03T15:00+00:00")
    V.append(("schema: il record porta metodo, base, risolutore e l'id per giorno, chiave e metodo",
              r["id"] == "2026-11-03|NVDA|NVDA sopra 203,80 fra 20 sedute|casi_simili" and r["risolutore"]["sedute"] == 20
              and r["esito"] is None, r["id"]))
    try:
        previsione("titoli", "X", "x", 1.2, "casi_simili", {})
        fuori = False
    except AssertionError:
        fuori = True
    V.append(("schema: una probabilita' fuori da [0, 1] non entra", fuori, ""))
    return V


if __name__ == "__main__":
    import sys
    ok = True
    for nome, esito, dettaglio in verifiche():
        print(("PASS  " if esito else "FAIL  ") + nome + (f" — {dettaglio}" if dettaglio else ""))
        ok &= bool(esito)
    sys.exit(0 if ok else 1)
