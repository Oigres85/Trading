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
    if riga:
        cum = MORTALITA[riga]
        out["pd"] = {1: cum[0], 3: cum[2], 5: cum[4], 10: cum[9]}
        out.update(finestra_altman(riga))
    return out


def riga_altman(a):
    """Lo Z'' in UNA riga: zona, base e data del bilancio, rating equivalente, frequenze storiche per orizzonte, la
    finestra in cui il rischio si concentra, il termine piu' debole."""
    if not a:
        return "Altman: n.d."
    if a["stato"] != "ok":
        return f"Altman: {a['stato'].upper() if a['stato'] != 'n.d.' else 'n.d.'} — {a.get('perche')}"
    soglia = (f"sotto {_n(ALTMAN_PERICOLO, 1)}" if a["zona"] == "PERICOLO" else
              f"sopra {_n(ALTMAN_SICUREZZA, 1)}" if a["zona"] == "SICUREZZA" else
              f"fra {_n(ALTMAN_PERICOLO, 1)} e {_n(ALTMAN_SICUREZZA, 1)}")
    s = f"Altman Z'' {_n(a['z'], 2)}: zona di {a['zona']} ({soglia})"
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
        if d["termine"] == TERMINI_ALTMAN[1] and d["rapporto"] < 0 and (a.get("ebit_attivo") or 0) > 0:
            s += (" — utili non distribuiti NEGATIVI con un EBIT positivo: e' il segno tipico di chi ha riacquistato "
                  "molte azioni, e il punteggio lo penalizza piu' del suo credito reale")
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
SCADENZE_NOMI = (("entro_12_mesi", "nei 12 mesi"), ("resto_esercizio", "nel resto dell'esercizio"),
                 ("anno_2", "nel 2° anno"), ("anno_3", "nel 3°"), ("anno_4", "nel 4°"), ("anno_5", "nel 5°"),
                 ("oltre_5", "oltre il 5°"))


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
            parti = [f"{_n(sc['voci'][kk] / totale * 100, 0)}% {nome}" for kk, nome in SCADENZE_NOMI
                     if sc["voci"].get(kk) is not None]
            sez.append(f"scadenze del capitale ({sc.get('forma')} al {_data(sc.get('al'))}, totale dichiarato "
                       f"{_importo(totale, sc.get('valuta'))}): " + ", ".join(parti))
    elif "scadenze" not in st:
        sez.append("scadenze per anno non dichiarate in forma leggibile")
    if x.get("tasso") or "tasso" not in st:
        sez.append(riga_tasso(x.get("tasso")))
    e = x.get("equo")
    if e and e.get("rapporto_pct") is not None:
        sez.append(f"il mercato valuta il debito il {_n(e['rapporto_pct'], 1)}% del valore di carico (al {_data(e['al'])}: "
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
    if a and a.get("stato") == "ok" and a["zona"] == "PERICOLO":
        out.append(("condizione", f"Altman in zona di PERICOLO (Z'' {_n(a['z'], 2)}, rating equivalente {a['bre']}"
                                  + (f", {_n(a['pd'][5], 1)}% a 5 anni" if a.get("pd") else "") + ")"))
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
          f"CDS: rincaro IMPROVVISO = in 5 giorni raccolti lo spread del nome cresce oltre il {_n(SOGLIA_RAPIDA, 0)}% PIU' "
          f"dell'indice CDX della stessa cedola; ALLARGAMENTO = in 21 giorni oltre il {_n(SOGLIA_MESE, 0)}% (la soglia della "
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
