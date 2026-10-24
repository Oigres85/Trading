#!/usr/bin/env python3
"""La salute del credito di ogni societa' — v501 (richieste del CEO del 18/10/2026).

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il CEO: «Analizza e monitora la salute finanziaria delle aziende presenti nel mio portafoglio e
nella mia watchlist … per anticipare eventuali impatti negativi sulle azioni» — rendimenti e spread
delle obbligazioni, CDS a 5 anni con un avviso sui rincari anomali o improvvisi, il debito dai
10-Q e 10-K — «e rendilo strutturale per individuare ogni volta che rilevi una divergenza in cui il
mercato obbligazionario o dei CDS prezza un rischio di liquidita', rifinanziamento o fallimento che
non si e' ancora riflesso nel prezzo delle azioni»; e poi: «Monitora anche Altman Z-Score fornendo
la % di rischio del parametro ed il range temporale entro il quale puo' avvenire il potenziale
default».

═══ COSA FA E COSA NON FA ════════════════════════════════════════════════════════════════════
E' una LIBRERIA, non uno strumento: la usano schede_progetto.py (il blocco SALUTE DEL CREDITO
dell'analisi), brief.py (gli avvisi delle due letture del giorno) e numeri_libro.py (la soglia del
mese, la stessa della prova di tenuta: una soglia, un posto).
· la MISURA la fa la pipeline (update_data: le finestre del CDS al netto dell'indice, il titolo
  contro QQQ sugli stessi giorni, lo Z'' sul bilancio piu' recente, il debito XBRL); qui solo le
  soglie, le mappature dichiarate e la resa — la divisione della prova di tenuta (v498);
· Altman: punteggio → rating equivalente → FREQUENZE STORICHE di insolvenza delle obbligazioni con
  quel rating (tabelle pubblicate da Altman), non una previsione sul nome;
· CDS: probabilita' implicite NEUTRALI AL RISCHIO (comprendono il premio che il mercato chiede): si
  leggono nel tempo, contro se stesse, non contro le frequenze di Altman;
· obbligazioni sul secondario, asset swap spread e Z-spread: NON disponibili gratis in forma
  automatizzabile (TRACE di FINRA: l'API vuole credenziali, il dato di fine giornata un contratto),
  e lo si dice ogni volta invece di lasciarlo dedurre da un silenzio (v406).
E' INFORMAZIONE: nessuna di queste letture e' un colore del semaforo o una vendita, e solo il CDS
del mese era gia' una prova della tenuta (v498). Le soglie sono convenzioni del 18/10/2026 (v240),
scritte in memoria/LIBRO.md §1novies e rilette da un gate.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comuni import art  # noqa: E402  — v510: «l'89,7%», non «il 89,7%»

# ═══ soglie (convenzioni: LIBRO.md §1novies, rilette dai gate) ═══════════════════════════════
SOGLIA_RAPIDA = 15.0     # CDS oltre l'indice della stessa cedola in 5 giorni raccolti: rincaro IMPROVVISO
SOGLIA_MESE = 20.0       # in 21 giorni: la stessa soglia della prova di tenuta (v498) — numeri_libro la importa da qui
PERCENTILE_ANOMALO = 95  # quando la pipeline ha abbastanza settimane: il rincaro contro le settimane del nome stesso
SETTORI_ESCLUSI = ("Financial Services",)   # banche e intermediari: Altman li esclude, e il loro debito e' il mestiere

# ═══ Altman: lo Z'' (pipeline) → il modello per i mercati emergenti → il rating equivalente ═══
# Fonte: E. Altman, presentazione del 6/2/2019 alla CFA Society India — "Z''-Score Model, Z = 3,25 + 6,56·X1 + 3,26·X2 +
# 6,72·X3 + 1,05·X4" e la tabella delle mediane per rating. Si usa la colonna PIU' RECENTE: quella la cui riga CC/D
# viene dai 94 fallimenti in Chapter 11 del 2010-2013 (nota "c" della tabella). Lo Z'' della pipeline e' senza la
# costante: si aggiunge qui.
ALTMAN_COSTANTE_EM = 3.25
ALTMAN_PERICOLO, ALTMAN_SICUREZZA = 1.1, 2.6       # le soglie di Altman sullo Z'' senza costante
BRE = (("AAA/AA+", 8.80), ("AA/AA-", 8.40), ("A+", 8.22), ("A", 6.94), ("A-", 6.12), ("BBB+", 5.80),
       ("BBB", 5.75), ("BBB-", 5.70), ("BB+", 5.65), ("BB", 5.52), ("BB-", 5.07), ("B+", 4.81), ("B", 4.03),
       ("B-", 3.74), ("CCC+", 2.84), ("CCC", 2.57), ("CCC-", 1.72), ("CC/D", 0.05))
# il rating equivalente → la riga della tabella di mortalita' (che ha solo le classi principali). AAA/AA+ va su AA:
# la scelta prudente, dichiarata. CC/D non ha una riga: e' il punteggio tipico di chi e' gia' in procedura.
RIGA_MORTALITA = {"AAA/AA+": "AA", "AA/AA-": "AA", "A+": "A", "A": "A", "A-": "A", "BBB+": "BBB", "BBB": "BBB",
                  "BBB-": "BBB", "BB+": "BB", "BB": "BB", "BB-": "BB", "B+": "B", "B": "B", "B-": "B",
                  "CCC+": "CCC", "CCC": "CCC", "CCC-": "CCC", "CC/D": None}
# Tassi CUMULATI di mortalita' (insolvenza) per rating all'emissione, anni 1-10 dopo l'emissione, in %: obbligazioni
# societarie valutate da S&P all'emissione, 1971-2018, 3.454 emissioni (stessa presentazione, "Mortality Rates by
# Original Rating"). I tassi marginali si RICAVANO da questi (marginali()): una tabella, un posto.
MORTALITA = {
    "AAA": (0.00, 0.00, 0.00, 0.00, 0.01, 0.03, 0.04, 0.04, 0.04, 0.04),
    "AA": (0.00, 0.00, 0.18, 0.23, 0.25, 0.26, 0.29, 0.33, 0.36, 0.40),
    "A": (0.01, 0.03, 0.12, 0.22, 0.29, 0.33, 0.35, 0.57, 0.62, 0.65),
    "BBB": (0.29, 2.54, 3.71, 4.63, 5.07, 5.26, 5.46, 5.60, 5.74, 6.03),
    "BB": (0.89, 2.88, 6.56, 8.38, 10.57, 11.92, 13.17, 14.10, 15.28, 17.88),
    "B": (2.84, 10.24, 17.16, 23.57, 27.93, 31.13, 33.60, 34.94, 36.05, 36.50),
    "CCC": (8.05, 19.42, 33.65, 44.40, 47.11, 53.23, 55.75, 57.86, 58.11, 59.88),
}
TRASCURABILE = 1.0       # sotto l'1% a 10 anni una finestra temporale non dice niente: si scrive "trascurabile"
FONTE_ALTMAN = ("E. Altman, presentazione del 6/2/2019 (CFA Society India): mediane per rating dello Z''-score per i "
                "mercati emergenti — colonna piu' recente, la riga CC/D sui 94 fallimenti del 2010-2013 — e tassi di "
                "mortalita' delle obbligazioni per rating all'emissione (S&P, 1971-2018, 3.454 emissioni)")
TERMINI_ALTMAN = ("capitale circolante / attivo", "utili non distribuiti / attivo", "EBIT / attivo",
                  "patrimonio netto contabile / passivita'")
PESI_ALTMAN = (6.56, 3.26, 6.72, 1.05)


def _n(x, dec=1):
    try:
        return f"{float(x):.{dec}f}".replace(".", ",")
    except (TypeError, ValueError):
        return "n.d."


def _sg(x, dec=1):
    """Il segno sul valore GIA' arrotondato: "-0,0" non si stampa (v496)."""
    try:
        v = round(float(x), dec)
    except (TypeError, ValueError):
        return "n.d."
    if v == 0:
        return _n(0, dec)
    return ("+" if v > 0 else "") + _n(v, dec)


def testo_zona(zona):
    """«zona di PERICOLO», «zona di SICUREZZA», ma «zona GRIGIA»: il terzo nome e' un aggettivo (v510 — usciva «zona di
    GRIGIA» in due righe di ogni analisi)."""
    return "zona GRIGIA" if zona == "GRIGIA" else f"zona di {zona}"


def _data(d):
    s = str(d or "")[:10]
    return f"{s[8:10]}/{s[5:7]}/{s[:4]}" if len(s) == 10 else (s or "n.d.")


def _importo(v, valuta=None):
    """Un importo della societa' nella SUA valuta, con l'unita' scelta sul valore (v447): mai confrontato fra titoli
    (v404)."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "n.d."
    a = abs(v)
    div, et = (1e9, "mld") if a >= 1e9 else (1e6, "mln") if a >= 1e6 else (1e3, "mila") if a >= 1e3 else (1, "")
    return f"{_n(v / div, 1)}{' ' + et if et else ''}{' ' + valuta if valuta else ''}"


def escluso(r):
    return str((r or {}).get("sector") or "") in SETTORI_ESCLUSI


# ═══ ALTMAN ═══════════════════════════════════════════════════════════════════════════════════
def marginali(cumulati):
    """I tassi marginali dai cumulati: m_t = (C_t - C_(t-1)) / (100 - C_(t-1)), in %. Sono quelli che la fonte
    pubblica accanto (un gate li confronta): ricavarli evita una seconda tabella da tenere allineata."""
    out, prima = [], 0.0
    for c in cumulati:
        out.append((c - prima) / (100.0 - prima) * 100.0 if prima < 100 else 0.0)
        prima = c
    return out


def rating_equivalente(em):
    """La mediana PIU' VICINA della tabella di Altman: (rating, mediana)."""
    return min(BRE, key=lambda x: (abs(em - x[1]), -x[1]))


def finestra_altman(riga):
    """Dalla riga di mortalita': l'anno col rischio annuo piu' alto e l'anno entro cui cade meta' delle insolvenze dei
    primi dieci anni (la mediana del tempo all'insolvenza, fra chi ci arriva entro dieci anni)."""
    cum = MORTALITA[riga]
    mg = marginali(cum)
    picco = max(range(10), key=lambda i: (mg[i], -i))
    meta = next(i for i, c in enumerate(cum) if c >= cum[-1] / 2.0)
    return {"picco_anno": picco + 1, "picco_pct": mg[picco], "meta_entro": meta + 1}


def altman_rischio(r):
    """La lettura di Altman per una riga della pipeline: {stato, ...}. Stati (v406): non applicabile (intermediari
    finanziari) · n.d. (nessun punteggio) · fuori scala (calcolato e non pubblicato) · ok."""
    st = (r or {}).get("stats") or {}
    if escluso(r):
        return {"stato": "non applicabile",
                "perche": "intermediario finanziario: Altman esclude banche e assicurazioni, e il loro debito e' il mestiere"}
    if st.get("altman_z") is None:
        if st.get("altman_fuori_scala") is not None:
            return {"stato": "fuori scala", "z": st["altman_fuori_scala"],
                    "perche": f"Z'' calcolato a {_n(st['altman_fuori_scala'], 2)}, fuori dalla banda plausibile: non pubblicato"}
        return {"stato": "n.d.", "perche": "bilancio incompleto nella fonte: Z'' non calcolabile"}
    z = float(st["altman_z"])
    em = z + ALTMAN_COSTANTE_EM
    bre, med = rating_equivalente(em)
    riga = RIGA_MORTALITA[bre]
    zona = ("PERICOLO" if z < ALTMAN_PERICOLO else "SICUREZZA" if z > ALTMAN_SICUREZZA else "GRIGIA")
    out = {"stato": "ok", "z": z, "em": em, "zona": zona, "bre": bre, "mediana": med, "riga": riga,
           "al": st.get("altman_al"), "base": st.get("altman_base"), "mancanti": st.get("altman_missing") or 0}
    x = st.get("altman_x")
    if isinstance(x, list) and len(x) == 4:
        contr = [(PESI_ALTMAN[i] * x[i], i) for i in range(4) if x[i] is not None]
        if contr:
            v, i = min(contr)
            out["debole"] = {"termine": TERMINI_ALTMAN[i], "rapporto": x[i], "contributo": v}
        out["ebit_attivo"] = x[2]
        out["x"] = list(x)          # v504 — i quattro termini: circolante e patrimonio si spiegano anche se non sono i piu' deboli
    if riga:
        cum = MORTALITA[riga]
        out["pd"] = {1: cum[0], 3: cum[2], 5: cum[4], 10: cum[9]}
        out.update(finestra_altman(riga))
    return out


def utili_negativi_penalizzano(a):
    """v503 — utili non distribuiti NEGATIVI con un EBIT positivo, fuori dalla zona di sicurezza: il punteggio penalizza
    piu' del credito di oggi. ⚠ La causa puo' essere doppia — perdite accumulate negli anni (Palantir, Bloom) o
    riacquisti di azioni (Oracle, Dell) — e la fonte non dice quale: la v501 scriveva «il segno tipico di chi ha
    riacquistato», e lo scriveva anche su chi non riacquista. In zona di sicurezza non cambia niente, e non si dice.
    Una regola sola per la riga di Altman e per il confronto coi concorrenti (v161)."""
    d = (a or {}).get("debole") or {}
    return bool(d and d.get("termine") == TERMINI_ALTMAN[1] and (d.get("rapporto") or 0) < 0
                and ((a or {}).get("ebit_attivo") or 0) > 0 and (a or {}).get("zona") != "SICUREZZA")


def circolante_dai_fornitori(a, sol):
    """v504 — il capitale circolante NEGATIVO fuori dalla zona di sicurezza: nasce dal ciclo di cassa o no?
    Il CEO, 18/10/2026, su Dell e Lenovo: «riescono a farsi pagare dai clienti prima di dover pagare i fornitori … un
    capitale circolante che abbassa … lo Z-Score, ma che nella realta' dimostra un grande potere contrattuale». Vero quando
    il CICLO di cassa e' negativo (Dell, misurato: -25 giorni), e allora il termine X1 dello Z'' penalizza un
    finanziamento dei fornitori; falso quando il ciclo e' positivo (Lenovo, sui conti della fonte al 30/09/2025: +15
    giorni) — il circolante negativo viene da altre passivita' a breve, e la riga lo dice invece di generalizzare.
    {dai_fornitori, testo} oppure None (circolante non negativo, zona di sicurezza, ciclo che non si calcola)."""
    if not a or a.get("stato") != "ok" or a.get("zona") == "SICUREZZA":
        return None
    x = a.get("x") or []
    if len(x) != 4 or x[0] is None or x[0] >= 0:
        return None
    g = (sol or {}).get("giorni") or {}
    if g.get("ciclo") is None:
        return None
    if g["ciclo"] < 0:
        return {"dai_fornitori": True,
                "testo": (f"capitale circolante NEGATIVO che nasce dal ciclo di cassa ({g['ciclo']} giorni al "
                          f"{_data(g.get('al'))}: i clienti pagano in {g['crediti']}, il magazzino gira in "
                          f"{g['magazzino']}, i fornitori sono pagati in {g['fornitori']}) — e' credito dei fornitori, "
                          "cioe' potere contrattuale finche' i volumi tengono: se le vendite calano si restituisce, e "
                          "diventa un'uscita di cassa")}
    return {"dai_fornitori": False,
            "testo": (f"capitale circolante NEGATIVO che NON nasce dal ciclo di cassa (+{g['ciclo']} giorni al "
                      f"{_data(g.get('al'))}): viene da altre passivita' a breve — debito in scadenza, anticipi, fondi: la "
                      "fonte non dice quali")}


def patrimonio_negativo(a, comb=None, sol=None):
    """v504 — il patrimonio netto contabile NEGATIVO fuori dalla zona di sicurezza: viene da perdite o no? Lo dicono
    gli utili non distribuiti e le azioni proprie, nelle voci della fonte. Dell (misurato il 18/10/2026): patrimonio
    -1,4 mld con utili non distribuiti +10,1 mld e azioni proprie per 20,0 mld — viene dai riacquisti. Il termine X4
    dello Z'' lo legge come debolezza. Testo, o None."""
    if not a or a.get("stato") != "ok" or a.get("zona") == "SICUREZZA":
        return None
    x = a.get("x") or []
    if len(x) != 4 or x[3] is None or x[3] >= 0:
        return None
    val = (comb or {}).get("valuta") or (sol or {}).get("valuta")
    pat = (comb or {}).get("patrimonio")
    s = "patrimonio netto contabile NEGATIVO" + (f" ({_importo(pat, val)})" if pat is not None and pat < 0 else "")
    re_, tsy = (sol or {}).get("utili_non_distribuiti"), (sol or {}).get("azioni_proprie")
    if re_ is None:
        return s + ": la fonte non porta gli utili non distribuiti, e da dove venga non si legge"
    if re_ > 0:
        s += f" con utili non distribuiti positivi ({_importo(re_, val)}): non viene da perdite"
        if tsy and tsy > 0:
            return s + f" — le azioni proprie riacquistate valgono {_importo(tsy, val)}"
        return (s + " — viene da altre voci del patrimonio (azioni riacquistate e annullate, distribuzioni, operazioni "
                "sul capitale: la fonte non dice quale)")
    return s + f" con utili non distribuiti negativi ({_importo(re_, val)}): almeno in parte viene da perdite accumulate"


def riga_altman(a, sol=None, comb=None):
    """Lo Z'' in UNA riga: zona, base e data del bilancio, rating equivalente, frequenze storiche per orizzonte, la
    finestra in cui il rischio si concentra, il termine piu' debole — e, v504, da dove vengono un circolante o un
    patrimonio negativi (sol: la solidita' operativa della pipeline; comb: la combustione)."""
    if not a:
        return "Altman: n.d."
    if a["stato"] != "ok":
        return f"Altman: {a['stato'].upper() if a['stato'] != 'n.d.' else 'n.d.'} — {a.get('perche')}"
    soglia = (f"sotto {_n(ALTMAN_PERICOLO, 1)}" if a["zona"] == "PERICOLO" else
              f"sopra {_n(ALTMAN_SICUREZZA, 1)}" if a["zona"] == "SICUREZZA" else
              f"fra {_n(ALTMAN_PERICOLO, 1)} e {_n(ALTMAN_SICUREZZA, 1)}")
    s = f"Altman Z'' {_n(a['z'], 2)}: {testo_zona(a['zona'])} ({soglia})"
    if a.get("base"):
        s += f" · {a['base']}"
    elif a.get("al"):
        s += f" · bilancio al {a['al']}"
    else:
        s += " · base del bilancio non dichiarata (snapshot precedente alla v501: era l'annuale)"
    if a.get("mancanti"):
        s += f" · ⚠ {a['mancanti']} componente mancante nella fonte, contata zero"
    s += f" · rating equivalente {a['bre']} (punteggio per i mercati emergenti {_n(a['em'], 2)}, mediana {_n(a['mediana'], 2)})"
    if not a.get("riga"):
        s += (" · e' il punteggio tipico di chi e' gia' in procedura (mediana dei 94 fallimenti 2010-2013): la tabella "
              "non ha una frequenza per orizzonte")
    else:
        pd = a["pd"]
        if pd[10] < TRASCURABILE:
            s += f" · frequenza storica di insolvenza per quel rating TRASCURABILE: {_n(pd[10], 2)}% a 10 anni"
        else:
            s += (f" · frequenza storica di insolvenza per quel rating (riga {a['riga']}): {_n(pd[1], 1)}% a 1 anno, "
                  f"{_n(pd[3], 1)}% a 3, {_n(pd[5], 1)}% a 5, {_n(pd[10], 1)}% a 10 · rischio annuo massimo nel "
                  f"{a['picco_anno']}° anno ({_n(a['picco_pct'], 1)}%), meta' delle insolvenze dei primi 10 anni entro il "
                  f"{a['meta_entro']}° anno")
    if a.get("debole"):
        d = a["debole"]
        s += f" · termine piu' debole: {d['termine']} ({_n(d['rapporto'], 3)}, contributo {_sg(d['contributo'], 2)})"
        if utili_negativi_penalizzano(a):
            s += (" — utili non distribuiti NEGATIVI con un EBIT positivo: vengono da perdite accumulate in passato o da "
                  "riacquisti di azioni (la fonte non dice quale), e il punteggio penalizza piu' del credito di oggi")
    cf = circolante_dai_fornitori(a, sol)
    if cf:
        s += " · " + cf["testo"]
    # senza la solidita' della pipeline (uno snapshot precedente, o chi chiama senza) non si dice niente: «la fonte non
    #   porta gli utili» sarebbe falso — non e' la fonte a mancare, e' la lettura
    pn = patrimonio_negativo(a, comb, sol) if sol else None
    if pn:
        s += " · " + pn
    return s


# ═══ CDS ═══════════════════════════════════════════════════════════════════════════════════════
def pd_cds(pb, recupero, anni=(1, 3, 5)):
    """Probabilita' di insolvenza implicita nello spread, NEUTRALE AL RISCHIO: intensita' costante
    lambda = spread / (1 - recupero) (il "triangolo del credito"), cumulata 1 - e^(-lambda·t), in %."""
    try:
        pb, recupero = float(pb), float(recupero)
    except (TypeError, ValueError):
        return None
    if pb <= 0 or not (0 <= recupero < 1):
        return None
    lam = pb / 1e4 / (1.0 - recupero)
    return {t: (1.0 - math.exp(-lam * t)) * 100.0 for t in anni}


def valuta_finestra(f, soglia, azione=None, rango=None):
    """Una finestra della pipeline (finestra o finestra5) contro la soglia, col lato azionario degli stessi giorni
    (cds.azione) e, per la settimana, il rango fra quelle del nome (cds.rango5): {stato, ...}.
    Stati: non ancora in funzione · non misurabile (con il perche') · misurato (verso: RINCARO, CALO, entro).
    "Oltre la soglia" e' STRETTO, come nella prova di tenuta (numeri_libro.prova_cds)."""
    if not f:
        return {"stato": "n.d.", "perche": "la pipeline non pubblica ancora questa finestra (snapshot precedente alla v501)"}
    if f.get("stato") == "storico corto":
        return {"stato": "non ancora in funzione", "giorni": f.get("giorni"), "servono": f.get("servono"), "n": f.get("n")}
    if f.get("stato") != "misurato":
        return {"stato": "non misurabile", "perche": f.get("perche") or f.get("stato"), "n": f.get("n")}
    e = float(f["eccesso_pct"])
    rg = rango or {}
    out = {"stato": "misurato", "n": f.get("n"), "da": f.get("da"), "a": f.get("a"), "eccesso": e,
           "nome": f.get("nome_pct"), "indice": f.get("indice_pct"), "famiglia": f.get("indice"),
           "verso": "RINCARO" if e > soglia else "CALO" if e < -soglia else "entro", "soglia": soglia,
           "rango": rg or None,
           # ANOMALO: sotto la soglia, ma fra le settimane piu' brutte del nome stesso (da quando lo storico basta)
           "anomalo": bool(rg.get("percentile") is not None and rg["percentile"] >= PERCENTILE_ANOMALO and e > 0)}
    az = azione
    if az:
        out["azione"] = az
    if out["verso"] == "RINCARO" or out["anomalo"]:
        if not az or az.get("stato") != "misurato":
            out["divergenza"] = "non misurabile"
        else:
            out["divergenza"] = "DIVERGENZA" if az["eccesso_pct"] >= 0 else "concordano"
    return out


def valuta_cds(c):
    """Il CDS di una riga: probabilita' implicite e le due finestre valutate. None se il nome non e' quotato."""
    if not c or c.get("stato") != "quotato":
        return None
    az = c.get("azione") or {}
    return {"rapida": valuta_finestra(c.get("finestra5"), SOGLIA_RAPIDA, az.get("finestra5"), c.get("rango5")),
            "mese": valuta_finestra(c.get("finestra"), SOGLIA_MESE, az.get("finestra"))}


def _testo_finestra(nome, v):
    if v["stato"] == "non ancora in funzione":
        g = v.get("giorni")
        return f"{nome}: non ancora in funzione ({g} {'giorno raccolto' if g == 1 else 'giorni raccolti'} su {v.get('servono')})"
    if v["stato"] != "misurato":
        return f"{nome}: non misurabile — {v.get('perche')}"
    s = (f"{nome} (dal {_data(v['da'])} al {_data(v['a'])}): nome {_sg(v['nome'])}% contro l'indice CDX "
         f"{v.get('famiglia') or ''} {_sg(v['indice'])}% → eccesso {_sg(v['eccesso'])}%")
    if v["verso"] == "RINCARO":
        s += f" — {'RINCARO IMPROVVISO' if nome == 'settimana' else 'ALLARGAMENTO'} (soglia +{_n(v['soglia'], 0)}%)"
    elif v.get("anomalo"):
        s += f" — RINCARO ANOMALO per il nome (dal {PERCENTILE_ANOMALO}° percentile delle sue finestre)"
    elif v["verso"] == "CALO":
        s += f" — il credito MIGLIORA oltre la soglia (-{_n(v['soglia'], 0)}%)"
    rg = v.get("rango") or {}
    if rg.get("percentile") is not None:
        s += f" · {_n(rg['percentile'], 0)}° percentile su {rg.get('finestre')} finestre raccolte del nome"
    az = v.get("azione")
    if az and az.get("stato") == "misurato":
        s += (f" · titolo {_sg(az['titolo_pct'])}% contro {az.get('mercato')} {_sg(az['mercato_pct'])}% "
              f"(eccesso {_sg(az['eccesso_pct'])}%)")
    elif az:
        s += f" · titolo: {az.get('perche') or az.get('stato')}"
    if v.get("divergenza") == "non misurabile":
        s += " → divergenza col titolo non misurabile"
    elif v.get("divergenza") == "DIVERGENZA":
        s += " → ⚠ DIVERGENZA: il credito peggiora e il titolo non lo sconta (non ha fatto peggio del mercato)"
    elif v.get("divergenza") == "concordano":
        s += " → concordano: il titolo ha gia' fatto peggio del mercato"
    return s


def riga_credito_cds(r, meta=None):
    """La lettura del CDS che il CEO ha chiesto oltre al livello (quello lo stampa schede.riga_cds): probabilita'
    implicite, rincaro improvviso della settimana, allargamento del mese, e il titolo sugli stessi giorni."""
    c = (r or {}).get("cds")
    if not c or c.get("stato") != "quotato":
        return None
    pz = []
    p = pd_cds(c.get("pb"), (meta or {}).get("recupero"))
    if p:
        pz.append(f"insolvenza implicita nel CDS (neutrale al rischio, recupero {_n(((meta or {}).get('recupero') or 0) * 100, 0)}%): "
                  f"{_n(p[1], 1)}% a 1 anno, {_n(p[3], 1)}% a 3, {_n(p[5], 1)}% a 5"
                  + (" — ⚠ con molti punti anticipati dipende dal recupero assunto" if c.get("indicativo") else ""))
    v = valuta_cds(c)
    pz.append(_testo_finestra("settimana", v["rapida"]))
    pz.append(_testo_finestra("mese", v["mese"]))
    return "credito (CDS): " + " · ".join(pz)


# ═══ DEBITO ════════════════════════════════════════════════════════════════════════════════════
# ⚠⚠ v510 — I NOMI DELLE SCADENZE DIPENDONO DAL DOCUMENTO. Per la tassonomia FASB (definizioni del 2025) la voce
#   «...InNextTwelveMonths» e' il debito che scade nell'esercizio SUCCESSIVO a quello in corso, non nei prossimi dodici
#   mesi, e «...InYearTwo» il secondo esercizio successivo. In un 10-K l'esercizio in corso e' quello appena chiuso e le
#   due letture quasi coincidono; in un 10-Q no: su CRWV (10-Q al 30/06/2026) la riga scriveva «30% nei 12 mesi, 21%
#   nel resto dell'esercizio», cioe' metteva PRIMA la scadenza che viene DOPO. Ora l'ordine e il nome seguono la forma,
#   e il resto dell'esercizio in corso — la scadenza piu' vicina — viene per primo.
SCADENZE_NOMI_10K = (("resto_esercizio", "nel resto dell'esercizio"), ("entro_12_mesi", "nel prossimo esercizio"),
                     ("anno_2", "nel 2° esercizio"), ("anno_3", "nel 3°"), ("anno_4", "nel 4°"), ("anno_5", "nel 5°"),
                     ("oltre_5", "oltre il 5°"))
SCADENZE_NOMI_10Q = (("resto_esercizio", "nel resto dell'esercizio in corso"),
                     ("entro_12_mesi", "nell'esercizio successivo"), ("anno_2", "nel 2° esercizio successivo"),
                     ("anno_3", "nel 3°"), ("anno_4", "nel 4°"), ("anno_5", "nel 5°"), ("oltre_5", "oltre il 5°"))


def nomi_scadenze(forma):
    """I nomi delle scadenze per la forma del documento da cui sono lette: 10-Q (esercizio in corso) o 10-K."""
    return SCADENZE_NOMI_10Q if str(forma or "").upper().startswith("10-Q") else SCADENZE_NOMI_10K


# ⚠ v501 — l'ETICHETTA DEL TASSO SEGUE LA VOCE che lo dichiara (v240, v405). Le prime due sono medie ponderate del
#   debito; la terza e' il tasso effettivo di UNO strumento, e un fatto non dimensionale non dice quale: chiamarla
#   «tasso medio» affermerebbe una media che il dato non porta.
VOCI_TASSO = {
    "LongTermDebtWeightedAverageInterestRate": ("tasso medio ponderato dichiarato", "debito a lungo termine"),
    "DebtWeightedAverageInterestRate": ("tasso medio ponderato dichiarato", "debito complessivo"),
    "DebtInstrumentInterestRateEffectivePercentage": (
        "tasso effettivo di UNO strumento dichiarato", "la voce non dice quale strumento: non e' la media del debito"),
}


def riga_tasso(t):
    """Il tasso dichiarato nei bilanci SEC con il nome della SUA voce; senza voce non si afferma una media."""
    if not t or t.get("valore_pct") is None:
        return "tasso medio ponderato non dichiarato (le cedole per obbligazione sono per strumento: non leggibili qui)"
    nome, nota = VOCI_TASSO.get(t.get("voce"), (
        "tasso dichiarato", f"voce {t.get('voce') or 'non indicata'}: non e' detto che sia la media del debito"))
    return f"{nome} {_n(t['valore_pct'], 2)}% ({nota}, al {_data(t.get('al'))})"


# v502 — le voci SEC che la pipeline non pubblica perche' ferme a bilanci di oltre un anno fa: si nominano con la data
# del loro ultimo deposito. Una voce vecchia letta come attuale e' peggio di una voce assente (v396).
NOMI_VOCI_SEC = {"scadenze": "scadenze del capitale", "tasso": "tasso", "equo": "valore di mercato del debito",
                 "linee_disponibili": "linee di credito non utilizzate", "carta_commerciale": "carta commerciale"}


def riga_debito(r, x=None, liquidita=None, esteri=(), versione=None):
    """Il debito in UNA riga: dal bilancio della fonte (yfinance: totale, quota corrente, oneri) e dai fatti XBRL
    depositati (scadenze, tasso medio, valore di mercato, linee di credito, carta commerciale, derivati sui tassi).
    x: macro.debito_sec.per_titolo[tk] o None; liquidita: (valore, nome, dettaglio) da schede.liquidita_societa —
    passata da chi chiama, perche' la lettura della liquidita' ha un proprietario solo (v161, v476).
    versione: quella della lettura SEC della pipeline (macro.debito_sec.versione); una voce in cache da una versione
    precedente, o senza versione, lo dichiara (v502)."""
    if escluso(r):
        return "debito: lettura non significativa per un intermediario finanziario (il debito e' il mestiere)"
    c, k = (r or {}).get("combustione") or {}, (r or {}).get("credito") or {}
    val = c.get("valuta") or k.get("valuta")
    tot = c.get("debito")
    corr, lungo = k.get("debito_corrente"), k.get("debito_lungo")
    # ⚠ il debito FINANZIARIO (finanziamenti a breve e a lungo, senza i leasing) e' la base della quota corrente e del
    #   costo: il "Total Debt" della fonte comprende i leasing (CRWV 51,6 miliardi contro 35,1 di finanziamenti), e
    #   dividere gli oneri per quel totale abbassava il costo di un terzo
    fin = (corr or 0) + (lungo or 0) if (corr is not None or lungo is not None) else None
    pz = []
    if fin:
        s = (f"debito finanziario {_importo(fin, val)} (a breve {_importo(corr, val) if corr is not None else 'n.d.'}, "
             f"a lungo {_importo(lungo, val) if lungo is not None else 'n.d.'}; "
             f"bilancio al {c.get('bilancio_al') or k.get('conto_al') or 'n.d.'}, fonte yfinance)")
        if tot and tot > fin * 1.02:
            s += f" · con i leasing {_importo(tot, val)}"
        pz.append(s)
    elif tot is not None:
        pz.append(f"debito totale {_importo(tot, val)} (con i leasing; bilancio al {c.get('bilancio_al') or 'n.d.'}, fonte "
                  "yfinance) — la fonte non separa i finanziamenti")
    else:
        pz.append("debito n.d. nella fonte")
    if corr is not None and fin:
        pz.append(f"quota corrente (entro 12 mesi) {_n(corr / fin * 100, 1)}% dei finanziamenti")
    liq = (liquidita or (None, None, None))[0]
    if corr and liq is not None:
        if liq < corr:
            pz.append(f"⚠ la {liquidita[1]} ({_importo(liq, val)}) NON copre la quota corrente ({_importo(corr, val)}): "
                      "quel debito va rinnovato o rimborsato col flusso di cassa")
        else:
            pz.append(f"la {liquidita[1]} copre {_n(liq / corr, 1)} volte la quota corrente")
    # il costo: gli oneri dell'ULTIMO trimestre annualizzati sul debito di fine periodo — stessa data al numeratore e al
    #   denominatore. Con gli oneri di 12 mesi su un debito che nel frattempo e' cambiato molto il numero mentiva: MU 7,5%
    #   (ha rimborsato quasi tutto nell'anno), CRWV 5,3% (il debito e' raddoppiato). Un trimestre senza oneri non e' un
    #   costo zero: e' un dato che la fonte non riporta (v205)
    ot = k.get("oneri_trim") or []
    if fin and ot:
        if ot[-1]:
            pz.append(f"costo APPROSSIMATO {_n(ot[-1] * 4 / fin * 100, 1)}% (oneri finanziari dell'ultimo trimestre "
                      "annualizzati, diviso i finanziamenti di fine periodo: comprende commissioni, sconti ammortizzati e "
                      "interessi dei leasing finanziari, esclude quelli capitalizzati)")
        else:
            pz.append("costo n.d.: l'ultimo trimestre della fonte non riporta oneri finanziari (non vuol dire zero)")
    if k.get("copertura") is not None:
        pz.append(f"utile operativo / oneri {_n(k['copertura'], 2)}×")
    elif k.get("oneri_al") and k.get("conto_al"):
        # v510 — la pipeline non divide due periodi diversi (v207), e l'assenza si dichiara (v406)
        pz.append(f"utile operativo / oneri n.d.: nella fonte gli oneri si fermano al {_data(k['oneri_al'])} e l'utile "
                  f"operativo al {_data(k['conto_al'])} — due periodi diversi non si dividono")
    if k.get("oneri_var_4trim_pct") is not None:
        pz.append(f"oneri {_sg(k['oneri_var_4trim_pct'])}% in 4 trimestri")
    tk = (r or {}).get("ticker")
    if x is None:
        pz.append("bilanci SEC: " + ("emittente estero (20-F/6-K, principi IFRS), non letto" if tk in esteri else
                                     "non ancora letti (la pipeline li legge solo dopo un 10-Q o 10-K nuovo, al massimo "
                                     "10 per run)"))
        return "debito: " + " · ".join(pz)
    dep = x.get("deposito") or {}
    sez = [f"dal {dep.get('forma')} depositato il {_data(dep.get('data'))}" if dep else "bilanci SEC"]
    st = x.get("stantii") or {}
    sc = x.get("scadenze")
    if sc and sc.get("voci"):
        totale = sum(v for v in sc["voci"].values() if v is not None)
        if totale > 0:
            parti = [f"{_n(sc['voci'][kk] / totale * 100, 0)}% {nome}" for kk, nome in nomi_scadenze(sc.get("forma"))
                     if sc["voci"].get(kk) is not None]
            sez.append(f"scadenze del capitale ({sc.get('forma')} al {_data(sc.get('al'))}, totale dichiarato "
                       f"{_importo(totale, sc.get('valuta'))}): " + ", ".join(parti))
    elif "scadenze" not in st:
        sez.append("scadenze per anno non dichiarate in forma leggibile")
    if x.get("tasso") or "tasso" not in st:
        sez.append(riga_tasso(x.get("tasso")))
    e = x.get("equo")
    if e and e.get("rapporto_pct") is not None:
        sez.append(f"il mercato valuta il debito {art('il', _n(e['rapporto_pct'], 1) + '%')} del valore di carico (al {_data(e['al'])}: "
                   "sotto 100 chiede piu' delle cedole — tassi saliti o credito peggiorato, il dato non separa le due cose)")
    l_ = x.get("linee_disponibili")
    if l_:
        sez.append(f"linee di credito non utilizzate {_importo(l_['valore'], l_.get('valuta'))} (al {_data(l_['al'])})")
    cp = x.get("carta_commerciale")
    if cp:
        sez.append(f"carta commerciale in essere {_importo(cp['valore'], cp.get('valuta'))} (al {_data(cp['al'])})")
    d = x.get("derivati_tassi") or {}
    sez.append(f"derivati sui tassi: il bilancio li nomina ({', '.join(d['voci'])})" if d.get("voci") else
               "derivati sui tassi: nessuna voce XBRL non dimensionale li nomina — non vuol dire che non ne usi")
    if st:
        sez.append("NON pubblicate perche' ferme a bilanci di oltre un anno fa (una voce vecchia letta come attuale e' "
                   "peggio di una voce assente): " + ", ".join(f"{NOMI_VOCI_SEC.get(k, k)} (ultimo deposito {_data(v)})"
                                                            for k, v in sorted(st.items())))
    if x.get("versione") is None or (versione is not None and x.get("versione") != versione):
        sez.append("⚠ lettura precedente alla regola dell'eta' (v502): queste voci possono venire da bilanci vecchi "
                   "di anni — la pipeline le rilegge ai prossimi giri, le posizioni per prime")
    if x.get("errore_ultimo"):
        sez.append(f"⚠ ultima lettura fallita il {_data(x['errore_ultimo'].get('il'))}: vale quella precedente")
    pz.append(" · ".join(sez))
    return "debito: " + " · ".join(pz)


# ═══ v504 — LE DUE SOLIDITA' ═══════════════════════════════════════════════════════════════════
# Il CEO, 18/10/2026: «Per i titoli tieni conto della differenza tra solidita' operativa da cash flow e solidita'
# patrimoniale statica. Rendila strutturale. Questo mi fa capire la % di rischio sulla base del rendimento e se questo
# rapporto ne vale la pena». Due domande diverse:
#   PATRIMONIALE (statica) — il bilancio, a una data, regge un colpo? Altman (zona e frequenza storica d'insolvenza del
#     rating equivalente) e la liquidita' contro il debito a breve: la v501;
#   OPERATIVA (dinamica) — l'attivita' produce cassa? Il flusso operativo e la cassa libera dei 12 mesi (combustione),
#     il flusso dell'ultimo trimestre, se l'utile diventa cassa, il ciclo di cassa e il magazzino (update_data,
#     solidita_operativa).
# Lo stato OPERATIVO viene dai SEGNI dei flussi, senza soglie da sostenere (v240); il PATRIMONIALE dalle zone di Altman.
# Nessun punteggio d'insieme (v200): le due solidita', il rischio storico e il rendimento del prezzo stanno ACCANTO, e
# il giudizio — se il rapporto ne vale la pena — e' di chi legge.
OPERATIVA_AUTOFINANZIA = "SI AUTOFINANZIA"
OPERATIVA_NON_COPRE = "FA CASSA MA NON COPRE GLI INVESTIMENTI"
OPERATIVA_CONSUMA = "CONSUMA CASSA"
PATRIMONIALE = {"SICUREZZA": "FORTE", "GRIGIA": "INTERMEDIA", "PERICOLO": "DEBOLE"}


def stato_operativo(comb):
    """La solidita' OPERATIVA dai segni dei flussi di 12 mesi della combustione: flusso operativo negativo = CONSUMA
    CASSA; positivo con la cassa libera positiva = SI AUTOFINANZIA; positivo con la cassa libera negativa = FA CASSA MA
    NON COPRE GLI INVESTIMENTI (per crescere dipende dal mercato dei capitali, v404). None senza quattro trimestri: tre
    non fanno 12 mesi."""
    c = comb or {}
    ocf = c.get("ocf_ttm")
    if ocf is None or c.get("trimestri") != 4:
        return None
    if ocf < 0:
        return OPERATIVA_CONSUMA
    fcf = c.get("fcf_ttm")
    if fcf is None:
        return None
    return OPERATIVA_AUTOFINANZIA if fcf >= 0 else OPERATIVA_NON_COPRE


def stato_patrimoniale(a):
    return PATRIMONIALE.get((a or {}).get("zona")) if (a or {}).get("stato") == "ok" else None


def divergenza_solidita(pat, op):
    """Le due combinazioni in cui le solidita' dicono cose opposte: il testo, o None."""
    if pat == "FORTE" and op == OPERATIVA_CONSUMA:
        return ("il bilancio regge un colpo e l'attivita' non fa cassa: il rischio non e' l'insolvenza, e' la cassa che "
                "serve per andare avanti — chi la mette (debito, azioni nuove) e a che prezzo")
    if pat == "DEBOLE" and op == OPERATIVA_AUTOFINANZIA:
        return ("il punteggio di Altman e' basso e l'attivita' si autofinanzia: lo tiene giu' la struttura del bilancio "
                "(nella riga di Altman: il termine piu' debole e da dove viene), non la cassa — la frequenza storica "
                "d'insolvenza del rating equivalente descrive le societa' con quel punteggio, e va letta con questo")
    return None


def alla_pari(sol, chiave):
    """La voce dei 12 mesi finisce lo stesso giorno del flusso operativo (la fine della sua finestra): solo allora si
    confrontano. La fonte puo' essere indietro col conto e non coi flussi (AMZN il 18/10/2026), e un rapporto fra due
    periodi diversi non e' un rapporto (v207)."""
    s = sol or {}
    f = (s.get("fine_periodo") or {}).get(chiave)
    return bool(f and s.get("ocf_ultimo_al") and str(f)[:10] == str(s["ocf_ultimo_al"])[:10]
                and (s.get("trimestri") or {}).get(chiave) == 4)


def ocf_su_ricavi(r):
    """Il flusso operativo dei 12 mesi sui ricavi dei 12 mesi, in %: una derivazione sola per la riga, la cassa e i
    segnali (v161). None senza quattro trimestri di tutti e due, o se i due periodi non finiscono lo stesso giorno."""
    c, s = (r or {}).get("combustione") or {}, (r or {}).get("solidita") or {}
    ric = s.get("ricavi_12m") if alla_pari(s, "ricavi_12m") else None
    if c.get("ocf_ttm") is None or c.get("trimestri") != 4 or not ric or ric <= 0:
        return None
    return c["ocf_ttm"] / ric * 100


def _rischio_storico(a):
    """La frequenza storica d'insolvenza del rating equivalente, con la STESSA resa della riga di Altman (v415)."""
    pd = (a or {}).get("pd")
    if not pd:
        return None
    if pd[10] < TRASCURABILE:
        return f"insolvenza storica del rating equivalente TRASCURABILE ({_n(pd[10], 2)}% a 10 anni)"
    return f"insolvenza storica del rating equivalente {_n(pd[5], 1)}% a 5 anni"


def rendimento_prezzo(r):
    """Quanto rende il PREZZO di oggi — non quanto rendera' l'azione: la cassa libera dei 12 mesi sulla
    capitalizzazione, solo se bilancio e prezzo sono nella stessa valuta (v404: SKHY pubblica il bilancio in won), e
    l'utile atteso sul prezzo (l'inverso del P/E prospettico). None se nessuno dei due si calcola."""
    st, comb = (r or {}).get("stats") or {}, (r or {}).get("combustione") or {}
    pz = []
    mc = st.get("market_cap")
    if comb.get("fcf_ttm") is not None and comb.get("trimestri") == 4 and mc and mc > 0:
        vb, vq = (r or {}).get("valuta_bilancio"), (r or {}).get("currency")
        if st.get("cross_currency") or (vb and vq and vb != vq):
            pz.append(f"cassa libera sulla capitalizzazione n.d. (bilancio in {vb or 'altra valuta'}, prezzo in "
                      f"{vq or 'altra valuta'}: due unita' diverse)")
        else:
            pz.append(f"cassa libera 12 mesi {_sg(comb['fcf_ttm'] / mc * 100, 1)}% della capitalizzazione")
    fpe = st.get("forward_pe")
    if isinstance(fpe, (int, float)):
        pz.append(f"utile atteso {_n(100.0 / fpe, 1)}% del prezzo (l'inverso del P/E prospettico)" if fpe > 0 else
                  "utile atteso NEGATIVO: nessun rendimento da utili")
    return ("rendimento del prezzo di oggi: " + " · ".join(pz)) if pz else None


def riga_solidita(r, a=None):
    """Le due solidita' in UNA riga, col rischio storico e il rendimento del prezzo accanto — mai fusi (v200)."""
    if escluso(r):
        return "solidita': lettura non significativa per un intermediario finanziario (il debito e' il mestiere)"
    a = a if a is not None else altman_rischio(r)
    pat, op = stato_patrimoniale(a), stato_operativo((r or {}).get("combustione"))
    pz = []
    if pat:
        p = f"PATRIMONIALE (il bilancio a una data): {pat} — Altman in {testo_zona(a['zona'])}"
        rs = _rischio_storico(a)
        pz.append(p + (f", {rs}" if rs else ""))
    else:
        pz.append("PATRIMONIALE: n.d. — " + ((a or {}).get("perche") or "Altman non calcolabile"))
    if op:
        o = f"OPERATIVA (la cassa dell'attivita' in 12 mesi): {op}"
        pc = ocf_su_ricavi(r)
        pz.append(o + (f" — flusso operativo {_sg(pc, 1)}% dei ricavi" if pc is not None else ""))
    else:
        pz.append("OPERATIVA: n.d. — la fonte non porta quattro trimestri di flussi (tre non fanno 12 mesi)")
    rp = rendimento_prezzo(r)
    if rp:
        pz.append(rp)
    s = "solidita': " + " · ".join(pz)
    d = divergenza_solidita(pat, op)
    return s + (f" → ⚠ DIVERGONO: {d}" if d else "")


def _testo_ciclo(g, al_bilancio=None):
    if not g:
        return "ciclo di cassa: n.d. — la pipeline non lo porta per questo nome (snapshot precedente alla v504)"
    if g.get("ciclo") is not None:
        s = (f"ciclo di cassa {g['ciclo']} giorni al {_data(g.get('al'))} (crediti {g['crediti']} + magazzino "
             f"{g['magazzino']} - fornitori {g['fornitori']})")
        if g["ciclo"] < 0:
            s += " — NEGATIVO: i clienti pagano prima che si paghino i fornitori"
        if al_bilancio and str(g.get("al")) != str(al_bilancio)[:10]:
            s += (f" ⚠ al {_data(g.get('al'))} e non al {_data(al_bilancio)}: il conto della fonte non ha il trimestre "
                  "dell'ultimo stato patrimoniale")
        return s
    if g.get("motivo") == "senza_magazzino":
        s = ("ciclo di cassa: non si calcola senza un magazzino materiale (i debiti verso fornitori di chi vende servizi "
             "sono in gran parte per gli investimenti)")
        return s + (f" · i clienti pagano in {g['crediti']} giorni" if g.get("crediti") is not None else "")
    return "ciclo di cassa: n.d. — la fonte non porta tutte le voci (crediti, magazzino, fornitori, ricavi, costo del venduto)"


def riga_cassa_attivita(r):
    """La solidita' OPERATIVA nel dettaglio: il flusso dei 12 mesi sui ricavi e dell'ultimo trimestre (il verso di
    oggi), se l'utile diventa cassa, il ciclo di cassa contro un anno prima, il magazzino, quanto va agli azionisti.
    Importi nella valuta di bilancio, mai confrontati fra titoli (v404)."""
    if escluso(r):
        return None
    comb, sol = (r or {}).get("combustione") or {}, (r or {}).get("solidita") or {}
    if not comb and not sol:
        return "cassa dell'attivita': n.d. — la pipeline non porta i flussi di questo nome"
    val = sol.get("valuta") or comb.get("valuta")
    n = sol.get("trimestri") or {}
    pz = []
    ocf, quattro = comb.get("ocf_ttm"), comb.get("trimestri") == 4
    if ocf is not None and quattro:
        pc = ocf_su_ricavi(r)
        pz.append(f"flusso operativo 12 mesi {_importo(ocf, val)}" + (f" ({_sg(pc, 1)}% dei ricavi)" if pc is not None else ""))
    elif ocf is not None:
        pz.append(f"flusso operativo su {comb.get('trimestri')} trimestri {_importo(ocf, val)} (non sono 12 mesi)")
    if sol.get("ocf_ultimo_trim") is not None:
        pz.append(f"ultimo trimestre {_importo(sol['ocf_ultimo_trim'], val)} (al {_data(sol.get('ocf_ultimo_al'))})")
    ut = sol.get("utile_12m") if alla_pari(sol, "utile_12m") else None
    if sol.get("utile_12m") is not None and ut is None and n.get("utile_12m") == 4 and ocf is not None:
        pz.append(f"utile netto 12 mesi fino al {_data((sol.get('fine_periodo') or {}).get('utile_12m'))}, flusso fino "
                  f"al {_data(sol.get('ocf_ultimo_al'))}: periodi diversi, il confronto non si fa")
    if ut is not None and ocf is not None and quattro:
        if ut > 0 and ocf >= 0:
            pz.append(f"utile netto 12 mesi {_importo(ut, val)}: il flusso operativo ne vale {_n(ocf / ut, 2)} volte")
        elif ut > 0:
            pz.append(f"utile netto 12 mesi {_importo(ut, val)}: NON e' diventato cassa")
        else:
            pz.append(f"utile netto 12 mesi {_importo(ut, val)}: negativo, il confronto col flusso non si legge")
    if "giorni" in sol or "bilancio_al" in sol:
        t = _testo_ciclo(sol.get("giorni"), sol.get("bilancio_al"))
        g1 = sol.get("giorni_anno_prima") or {}
        if (sol.get("giorni") or {}).get("ciclo") is not None and g1.get("ciclo") is not None:
            t += f", un anno prima {g1['ciclo']} giorni (al {_data(g1.get('al'))})"
        pz.append(t)
    else:
        pz.append(_testo_ciclo(None))
    vm = sol.get("var_magazzino_12m") if n.get("var_magazzino_12m") == 4 else None
    if vm is not None and vm < 0:
        pz.append(f"il magazzino ha assorbito {_importo(-vm, val)} di cassa in 12 mesi")
    elif vm is not None and vm > 0:
        pz.append(f"il magazzino ha liberato {_importo(vm, val)} di cassa in 12 mesi")
    parti, tot = [], 0.0
    for chiave, nome in (("riacquisti_12m", "riacquisti"), ("dividendi_12m", "dividendi pagati")):
        x = sol.get(chiave)
        if x is None:
            continue
        if n.get(chiave) != 4:
            parti.append(f"{nome}: la fonte porta {n.get(chiave)} trimestri, non 12 mesi")
            continue
        if x < 0:
            parti.append(f"{nome} {_importo(-x, val)}")
            tot += -x
    if tot > 0:
        s = f"agli azionisti in 12 mesi {_importo(tot, val)} ({', '.join(parti)})"
        fcf = comb.get("fcf_ttm")
        if fcf is not None and quattro and fcf > 0:
            s += f" = {_n(tot / fcf * 100, 0)}% della cassa libera"
        elif fcf is not None and quattro:
            s += " con la cassa libera negativa: li pagano il debito o la liquidita'"
        pz.append(s)
    elif parti:
        pz.append("agli azionisti: " + ", ".join(parti))
    return "cassa dell'attivita' (solidita' operativa): " + " · ".join(pz)


# ═══ SEGNALI ══════════════════════════════════════════════════════════════════════════════════
def segnali(r, x=None, liquidita=None):
    """I segnali di un nome per la sintesi in testa al blocco: [(tipo, testo)]. EVENTI (si muovono coi prezzi):
    rincaro improvviso, allargamento, divergenza. CONDIZIONI (cambiano coi bilanci): Altman in zona di pericolo,
    quota corrente oltre la liquidita'."""
    out = []
    v = valuta_cds((r or {}).get("cds"))
    if v:
        for chiave, nome in (("rapida", "RINCARO IMPROVVISO del CDS (settimana)"), ("mese", "ALLARGAMENTO del CDS (mese)")):
            f = v[chiave]
            if f["stato"] == "misurato" and (f["verso"] == "RINCARO" or f.get("anomalo")):
                out.append(("evento", f"{nome if f['verso'] == 'RINCARO' else 'RINCARO ANOMALO del CDS per il nome'}: "
                                      f"eccesso {_sg(f['eccesso'])}% sull'indice"))
                if f.get("divergenza") == "DIVERGENZA":
                    az = f["azione"]
                    out.append(("evento", f"DIVERGENZA credito-azione ({'settimana' if chiave == 'rapida' else 'mese'}): "
                                          f"il titolo {_sg(az['titolo_pct'])}% contro {az.get('mercato')} "
                                          f"{_sg(az['mercato_pct'])}%"))
    a = altman_rischio(r)
    op = stato_operativo((r or {}).get("combustione"))
    pc = ocf_su_ricavi(r)
    if a and a.get("stato") == "ok" and a["zona"] == "PERICOLO":
        out.append(("condizione", f"Altman in zona di PERICOLO (Z'' {_n(a['z'], 2)}, rating equivalente {a['bre']}"
                                  + (f", {_n(a['pd'][5], 1)}% a 5 anni" if a.get("pd") else "") + ")"
                                  # v504 — la stessa condizione letta con la cassa: le due solidita' divergono
                                  + (" — ma l'attivita' SI AUTOFINANZIA"
                                     + (f" (flusso operativo {_sg(pc, 1)}% dei ricavi in 12 mesi)" if pc is not None else "")
                                     + ": lo tiene giu' la struttura del bilancio, non la cassa"
                                     if op == OPERATIVA_AUTOFINANZIA else "")))
    # v504 — il caso opposto, che nessuna condizione vedeva: il bilancio in sicurezza e l'attivita' che brucia cassa
    if stato_patrimoniale(a) == "FORTE" and op == OPERATIVA_CONSUMA:
        out.append(("condizione", f"bilancio in zona di SICUREZZA (Altman {_n(a['z'], 2)}) ma l'attivita' CONSUMA CASSA"
                                  + (f" (flusso operativo {_sg(pc, 1)}% dei ricavi in 12 mesi)" if pc is not None else "")
                                  + ": il rischio e' la cassa per andare avanti, non l'insolvenza"))
    if not escluso(r):
        corr = ((r or {}).get("credito") or {}).get("debito_corrente")
        liq = (liquidita or (None,))[0]
        if corr and liq is not None and liq < corr:
            out.append(("condizione", f"quota corrente del debito oltre la {liquidita[1]} ({_n(corr / liq, 1)} volte)"))
    return out


def riferimento_credito(macro):
    """L'intestazione del blocco, UNA volta (v407): cosa c'e', da dove viene, cosa non c'e' e perche'."""
    m = macro or {}
    c = m.get("cds") or {}
    st = (c.get("storia") or {}).get("giorni")
    ds = m.get("debito_sec") or {}
    pz = ["SALUTE DEL CREDITO (richiesta del CEO del 18/10/2026: anticipare con il credito gli impatti sulle azioni) — "
          "INFORMAZIONE, non una prova della tenuta (il CDS del mese lo e' gia': v498) ne' una vendita",
          f"CDS: rincaro IMPROVVISO = in 5 giorni raccolti lo spread del nome cresce oltre {art('il', _n(SOGLIA_RAPIDA, 0) + '%')} "
          f"PIU' dell'indice CDX della stessa cedola; ALLARGAMENTO = in 21 giorni oltre {art('il', _n(SOGLIA_MESE, 0) + '%')} "
          "(la soglia della "
          "prova di tenuta); DIVERGENZA = un rincaro o un allargamento mentre il titolo, negli STESSI giorni, non fa peggio "
          "di QQQ — il credito prezza un rischio che l'azione non sconta ancora (convenzioni del 18/10, LIBRO.md §1novies)"
          + (f" · storico raccolto: {st} {'giorno' if st == 1 else 'giorni'}" if st is not None else ""),
          "probabilita' implicite nel CDS: NEUTRALI AL RISCHIO (comprendono il premio per il rischio: piu' alte della "
          "frequenza storica) — si leggono nel tempo, non contro quelle di Altman",
          f"Altman: lo Z'' della pipeline sul bilancio piu' recente, +{_n(ALTMAN_COSTANTE_EM, 2)} = punteggio per i mercati "
          "emergenti, che si confronta con le mediane per rating; la riga di quel rating da' la FREQUENZA STORICA di "
          f"insolvenza a 1, 3, 5 e 10 anni e l'anno in cui il rischio si concentra — fonte: {FONTE_ALTMAN}. Non e' una "
          "previsione sul nome: e' cosa e' successo alle obbligazioni con quel rating. E' un bilancio contabile: chi "
          "riacquista molte azioni ha utili non distribuiti bassi o negativi e un patrimonio piccolo, e il punteggio lo "
          "penalizza piu' del suo credito reale; per gli intermediari finanziari non si applica. Un'azione puo' perdere "
          "molto anche senza insolvenza (aumenti di capitale, diluizione)",
          "SOLIDITA' (v504, richiesta del CEO del 18/10/2026): PATRIMONIALE = il bilancio a una data (Altman, liquidita' "
          "contro il debito a breve); OPERATIVA = la cassa che l'attivita' produce in 12 mesi, dai SEGNI dei flussi: SI "
          "AUTOFINANZIA (flusso operativo e cassa libera positivi) · FA CASSA MA NON COPRE GLI INVESTIMENTI (operativo "
          "positivo, libera negativa: per crescere dipende dal mercato dei capitali) · CONSUMA CASSA (operativo "
          "negativo). Possono dire cose opposte, e la riga lo dice. Il ciclo di cassa (crediti + magazzino - fornitori, "
          "in giorni del trimestre) si calcola solo con un magazzino materiale; negativo = i fornitori finanziano "
          "l'attivita'. Accanto, il RENDIMENTO DEL PREZZO di oggi (cassa libera sulla capitalizzazione, utile atteso sul "
          "prezzo): non e' quanto rendera' l'azione, e un titolo growth rende poco oggi per costruzione, perche' il "
          "prezzo paga la crescita. Rischio e rendimento stanno accanto, mai fusi in un punteggio",
          "obbligazioni sul secondario (rendimenti, asset swap spread, Z-spread): NON disponibili gratis in forma "
          "automatizzabile — TRACE di FINRA le ha, ma l'API vuole credenziali e il dato di fine giornata un contratto; il "
          "sito di FINRA le mostra per la consultazione (finra.org, Fixed Income Data). Al loro posto: il CDS dove esiste, "
          "e il valore di mercato del debito che la societa' dichiara nei 10-Q e 10-K"]
    if ds:
        pz.append(f"debito dai bilanci SEC (XBRL, fatti non dimensionali): {len(ds.get('per_titolo') or {})} nomi in "
                  "archivio"
                  + (f", {len(ds['in_attesa'])} in attesa (si leggono solo dopo un deposito nuovo, al massimo "
                     f"{ds.get('budget')} per run)" if ds.get("in_attesa") else "")
                  + (f", ERRORI di lettura: {', '.join(sorted(ds['errori']))}" if ds.get("errori") else "")
                  + (f"; emittenti esteri non letti: {', '.join(ds['senza_10q'])}" if ds.get("senza_10q") else ""))
    else:
        pz.append("debito dai bilanci SEC: il run della pipeline non lo porta — non e' 'nessun debito', e' il dato che manca")
    return " · ".join(pz)


def sintesi(voci):
    """voci: [(ticker, ruolo, [(tipo, testo)])] → le righe della sintesi in testa al blocco. Nessun segnale si dice."""
    ev = [(tk, ru, t) for tk, ru, ss in voci for tipo, t in ss if tipo == "evento"]
    co = [(tk, ru, t) for tk, ru, ss in voci for tipo, t in ss if tipo == "condizione"]
    out = ["SEGNALI DEL CREDITO — eventi (si muovono coi prezzi): "
           + ("; ".join(f"{tk} [{ru}] {t}" for tk, ru, t in ev) if ev else "nessuno")]
    out.append("SEGNALI DEL CREDITO — condizioni (cambiano coi bilanci): "
               + ("; ".join(f"{tk} [{ru}] {t}" for tk, ru, t in co) if co else "nessuna"))
    return out
