#!/usr/bin/env python3
"""NARRAZIONE TEMPORALE (v194) — "dove siamo rispetto al passato, e le altre volte com'è andata".

Perché esiste. Il payload sapeva dire il LIVELLO di un indicatore ("curva +0,36pp", "HY OAS
2,77%") e poco altro. Mancava la dimensione che un analista usa per prima: da quanto dura questo
stato, quanto è estremo rispetto alla storia intera, e le volte precedenti in cui il quadro
somigliava a oggi che cosa è successo dopo. È l'unica parte che non si può improvvisare a memoria
e che il sistema può calcolare meglio di chiunque, perché ha le serie.

Tre misure, in ordine di solidità decrescente — ed è dichiarata, perché non valgono uguale:

  1. PERCENTILE sulla serie completa. Solidissimo: è una descrizione, non una previsione.
  2. DURATA DEL REGIME. Solido: quante osservazioni consecutive nello stato attuale, e come si
     colloca quella durata rispetto agli episodi passati dello stesso stato.
  3. EPISODI ANALOGHI. Il più interessante e il più fragile: le finestre passate in cui
     l'indicatore era in configurazione simile, e cosa ha fatto l'indice nei mesi successivi.
     Gli episodi sono POCHI e SOVRAPPOSTI, quindi la funzione restituisce SEMPRE quanti ne ha
     trovati e si rifiuta di produrre una media sotto una soglia minima. Un numero senza il suo
     campione, qui, sarebbe peggio di nessun numero.

Le funzioni sono PURE (liste di (data, valore) in ingresso) proprio per poterle provare senza
rete: la fetch la fa la pipeline in CI, la correttezza si verifica qui.
"""
from __future__ import annotations

MIN_EPISODI = 3          # sotto questa soglia non si pubblica alcuna media


def _coppie(serie):
    """Normalizza QUALUNQUE forma di serie in [(data, valore)].

    Le serie di questo progetto arrivano in tre forme diverse — liste di numeri
    (margin_debt.history), liste di dizionari {d, v} (curve_history) e liste di coppie — e
    passarne una della forma sbagliata faceva confrontare dizionari fra loro. Il difetto e'
    emerso provando il motore sui dati VERI, non nei test sintetici: i test usavano una forma
    sola, che e' esattamente il modo in cui una suite puo' essere verde su codice fragile.
    """
    out = []
    for x in (serie or []):
        if isinstance(x, dict):
            v = x.get("v", x.get("value", x.get("val")))
            out.append((x.get("d", x.get("date")), v))
        elif isinstance(x, (tuple, list)) and len(x) >= 2:
            out.append((x[0], x[1]))
        else:
            out.append((None, x))
    return [(d, v) for d, v in out if isinstance(v, (int, float))]


def percentile(serie, valore=None):
    """Posizione percentuale del valore nella serie (0 = minimo storico, 100 = massimo).

    serie: lista di (data, valore) oppure di valori. valore: quello da collocare (default: l'ultimo).
    """
    vals = [v for _, v in _coppie(serie)]
    if len(vals) < 2:
        return None
    x = vals[-1] if valore is None else valore
    sotto = sum(1 for v in vals if v < x)
    uguali = sum(1 for v in vals if v == x)
    # definizione "midrank": i valori uguali contano metà, così un valore ripetuto non
    # salta al 100° percentile solo perché si ripete.
    return round((sotto + uguali / 2) / len(vals) * 100)


def durata_regime(serie, stato):
    """Da quante osservazioni consecutive (dalla fine) la serie è nello stato dato.

    stato: funzione valore -> bool. Ritorna (n_osservazioni, data_di_inizio) oppure (0, None).
    """
    coppie = _coppie(serie)
    if not coppie:
        return 0, None
    n, inizio = 0, None
    for d, v in reversed(coppie):
        if v is None or not stato(v):
            break
        n += 1
        inizio = d
    return n, inizio


def episodi_regime(serie, stato, min_len=5):
    """Tutti gli episodi passati in cui la serie è stata nello stato dato.

    Ritorna la lista di (data_inizio, data_fine, durata). L'episodio in corso è ESCLUSO: non è
    ancora finito, e includerlo fra i "conclusi" falserebbe la mediana delle durate verso il basso.
    """
    coppie = _coppie(serie)
    if not coppie:
        return []
    out, corrente = [], None
    for d, v in coppie:
        dentro = v is not None and stato(v)
        if dentro and corrente is None:
            corrente = [d, d, 1]
        elif dentro:
            corrente[1] = d
            corrente[2] += 1
        elif corrente is not None:
            if corrente[2] >= min_len:
                out.append(tuple(corrente))
            corrente = None
    # `corrente` non chiuso = episodio IN CORSO: si scarta di proposito
    return out


def rendimento_dopo(indice, data_inizio, giorni):
    """Rendimento % dell'indice nei `giorni` (osservazioni) successivi a data_inizio.

    indice: lista di (data, valore) ordinata. Ritorna None se la finestra non è matura.
    """
    indice = _coppie(indice)
    if not indice:
        return None
    idx = None
    for i, (d, _) in enumerate(indice):
        if d >= data_inizio:
            idx = i
            break
    if idx is None:
        return None
    fine = idx + giorni
    if fine >= len(indice):
        return None                      # finestra non ancora matura: non si inventa
    a, b = indice[idx][1], indice[fine][1]
    if not a or a <= 0 or b is None:
        return None
    return round((b / a - 1) * 100, 1)


def _date_valide(coppie):
    """True se le date sembrano date vere (AAAA-MM-GG) e non etichette sintetiche."""
    d = [x for x, _ in coppie if isinstance(x, str)]
    if len(d) < max(2, len(coppie) // 2):
        return False
    import re as _re
    return all(_re.match(r"^\d{4}-\d{2}-\d{2}", x) for x in d[:5])


def _dominio_compatibile(serie, indice):
    """L'indice puo' misurare cio' che e' successo DOPO un episodio solo se vive sullo stesso
    asse temporale della serie. Senza questo controllo il motore ha prodotto, sui dati veri,
    una "mediana +50,7% a 63 giorni": la serie del credito era giornaliera e datata, l'indice
    era una spark con etichette sintetiche, e il confronto per data pescava a caso.
    E' lo stesso difetto gia' pagato in backtest_signals mescolando granularita' diverse — la
    forma piu' pericolosa, perche' produce un numero PLAUSIBILE invece di un errore."""
    a, b = _coppie(serie), _coppie(indice)
    if not a or not b:
        return False, "indice assente"
    if not _date_valide(a) or not _date_valide(b):
        return False, "serie senza date reali: impossibile allineare gli episodi all'indice"
    ia, fa = a[0][0], a[-1][0]
    ib, fb = b[0][0], b[-1][0]
    if fb < ia or fa < ib:
        return False, "nessuna sovrapposizione temporale fra indicatore e indice"
    return True, ""


def analoghi(serie, indice, stato, orizzonti=(63, 126, 252), min_len=5):
    """Le altre volte che l'indicatore è entrato in questo stato, cosa ha fatto l'indice dopo.

    Ritorna un dizionario con gli episodi e, SOLO se sono almeno MIN_EPISODI, la mediana per
    orizzonte. Il campione è sempre dichiarato: è il numero che conta più delle mediane.
    """
    ok, motivo = _dominio_compatibile(serie, indice)
    if not ok:
        # si restituisce la struttura completa con il MOTIVO: un blocco vuoto e' informazione,
        # un numero sbagliato no.
        return {"episodi": [], "n": 0, "sufficiente": False, "non_calcolabile": motivo}
    eps = episodi_regime(serie, stato, min_len=min_len)
    righe = []
    for inizio, fine, dur in eps:
        r = {"inizio": inizio, "fine": fine, "durata": dur}
        for g in orizzonti:
            r[f"idx_{g}"] = rendimento_dopo(indice, inizio, g)
        righe.append(r)
    out = {"episodi": righe, "n": len(righe), "sufficiente": len(righe) >= MIN_EPISODI}
    if out["sufficiente"]:
        for g in orizzonti:
            vals = sorted(v for v in (r.get(f"idx_{g}") for r in righe) if v is not None)
            if len(vals) >= MIN_EPISODI:
                m = len(vals) // 2
                out[f"mediana_{g}"] = vals[m] if len(vals) % 2 else round((vals[m - 1] + vals[m]) / 2, 1)
                out[f"n_{g}"] = len(vals)
    return out


def racconto(nome, serie, indice, stato, etichetta_stato, unita="", orizzonti=(63, 126, 252)):
    """Compone le tre misure in un dizionario pronto da rendere nel payload."""
    coppie = _coppie(serie)
    if len(coppie) < 30:
        return None
    ultimo = coppie[-1][1]
    dur, da = durata_regime(coppie, stato)
    an = analoghi(coppie, indice or [], stato, orizzonti=orizzonti)
    durate = sorted(e["durata"] for e in an["episodi"]) if an["episodi"] else []
    med_dur = None
    if durate:
        m = len(durate) // 2
        med_dur = durate[m] if len(durate) % 2 else (durate[m - 1] + durate[m]) // 2
    return {
        "nome": nome,
        "valore": ultimo,
        "unita": unita,
        "percentile": percentile(coppie),
        "osservazioni": len(coppie),
        "dal": coppie[0][0],
        "stato": etichetta_stato,
        "durata_stato": dur,
        "stato_da": da,
        "durata_mediana_episodi_passati": med_dur,
        "analoghi": an,
    }
