#!/usr/bin/env python3
"""Le schede del progetto per ogni nome del libro — v462.

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
L'analisi giornaliera usava del progetto solo prezzi, livelli, rischio e macro. La pipeline
pubblica in `data/data.json` molto di piu' — sensibilita' ai canali macro con il loro R²,
revisioni delle stime, autonomia di cassa, copertura degli oneri, short interest, depositi
SEC — e quei blocchi entravano nell'analisi solo quando me ne ricordavo. Questo script li
mette in fila per ogni nome, cosi' entrano sempre.

═══ COSA FA E COSA NON FA ════════════════════════════════════════════════════════════════════
· i NOMI vengono da `memoria/LIBRO.md` (posizioni + sorvegliati), mai dalla pipeline: se un
  nome manca dalla pipeline lo si DICHIARA invece di saltarlo (v406);
· riporta FATTI gia' calcolati dalla pipeline, senza rifarli: una seconda derivazione della
  stessa grandezza diverge al primo ritocco (v161, v207, v316);
· la direzione delle revisioni si prende dalla DIFFERENZA, mai dal rapporto: su una perdita il
  rapporto inverte il senso (v400);
· cassa e credito escono SOLO come rapporti: gli importi sono nella valuta di bilancio
  dell'emittente e fra titoli non si confrontano (v404, v447);
· un canale sotto il proprio pavimento del rumore si dichiara non misurabile, e il suo beta
  non esce: un beta senza R² e' mezzo numero (v316, v415);
· le opzioni NON escono: la lettura dei muri ha guardie di plausibilita' che vivono in app.js,
  e rifarle qui sarebbe la seconda derivazione. Stanno nel pacchetto titolo della dashboard.

Uso:  python3 scripts/schede_progetto.py [TK ...]
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE / "scripts"))
import brief  # noqa: E402
import credito  # noqa: E402  — v501: la salute del credito (Altman, CDS, debito dai bilanci)
from comuni import art  # noqa: E402  — v510: l'articolo davanti a un numero («l'11%», non «il 11%»)

CANALI = (("mercato", "mercato"), ("settore", "comparto"), ("tassi", "tassi"), ("dollaro", "dollaro"))


def _n(x, dec=1):
    try:
        return f"{float(x):.{dec}f}".replace(".", ",")
    except (TypeError, ValueError):
        return "n.d."


def _segno(x, dec=1):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return "n.d."
    x = round(x, dec) + 0.0                  # v510 — il segno sul valore GIA' arrotondato (v496): mai «-0,0»
    return ("+" if x > 0 else "") + _n(x, dec)


def finestra(f):
    """Una finestra di regressione: il beta esce SOLO se l'R² supera il proprio pavimento."""
    if not isinstance(f, dict) or f.get("r2") is None or f.get("r2_soglia") is None:
        return "n.d."
    if f.get("r2") <= f.get("r2_soglia"):
        return f"non misurabile (R² {_n(f['r2'], 3)} sotto il rumore {_n(f['r2_soglia'], 3)}, {f.get('campione')} sedute)"
    return f"beta {_segno(f.get('beta'), 2)}, R² {_n(f['r2'], 2)} ({f.get('campione')} sedute)"


def riga_canale(nome, c):
    if not isinstance(c, dict):
        return f"{nome}: n.d."
    return (f"{nome} ({c.get('strumento')}): anno {finestra(c)} · trimestre {finestra(c.get('breve'))}"
            f" · giornate forti {finestra(c.get('evento'))}")


def riga_revisioni(a, con_target=True):
    """La direzione dalla DIFFERENZA (v400). La percentuale solo dove non e' ambigua.
    con_target=False (v473): rotazione.py stampa il target nella propria riga, e due rese dello
    stesso numero accanto sono la classe v415."""
    if not isinstance(a, dict) or a.get("eps_ora") is None or a.get("eps_90g_fa") is None:
        return "revisioni: n.d."
    ora, prima = float(a["eps_ora"]), float(a["eps_90g_fa"])
    d = ora - prima
    if abs(d) < 1e-9:
        verso = "stima invariata a 90 giorni"
    elif ora < 0 or prima < 0:
        verso = ("la PERDITA attesa si e' AMPLIATA" if d < 0 else "la perdita attesa si e' RIDOTTA") \
            if ora <= 0 and prima <= 0 else ("stima in salita" if d > 0 else "stima in discesa")
    else:
        verso = f"stima {'in salita' if d > 0 else 'in discesa'} {art('del', _n(abs(d) / prima * 100) + '%')}"
    s = f"revisioni: EPS atteso {_n(prima, 2)} → {_n(ora, 2)} a 90 giorni, {verso}"
    if a.get("su_30g") is not None or a.get("giu_30g") is not None:
        s += f" · ultimi 30 giorni {a.get('su_30g', 0)} su, {a.get('giu_30g', 0)} giu'"
    if con_target and a.get("target_mediana") is not None:
        s += (f" · target mediano {_n(a['target_mediana'], 2)} (min {_n(a.get('target_min'), 2)}"
              f", max {_n(a.get('target_max'), 2)})")
    return s


# ⚠ v492 — un trailing almeno 2 volte il prospettico si DICHIARA (convenzione del pacchetto, v193): il
#   consenso si aspetta un utile molto piu' alto di quello degli ultimi 12 mesi, oppure le due basi non
#   coincidono — e da qui le due letture non si distinguono.
SCARTO_PE = 2.0


def riferimento_valutazione(macro):
    """v492 — l'intestazione dei multipli, scritta UNA volta per blocco (v407): da dove vengono, cosa non dicono,
    e il P/E dell'S&P 500 come riferimento con la sua fonte e la sua data. La media storica che la pipeline porta
    accanto al prospettico (16,5) non ha una provenienza dichiarata e resta fuori (v240); il P/E del Nasdaq
    pure, perche' la pipeline lo prende trailing o prospettico senza dire quale."""
    m = macro or {}
    fp, tp = m.get("forward_pe") or {}, m.get("sp500_pe") or {}
    rif = []
    if fp.get("value") is not None:
        rif.append(f"prospettico {_n(fp['value'])}× [{fp.get('source') or 'fonte n.d.'}, {fp.get('fetched_at') or 'data n.d.'}]")
    if tp.get("current") is not None:
        rif.append(f"ultimi 12 mesi {_n(tp['current'])}× [{tp.get('source') or 'fonte n.d.'}, {tp.get('fetched_at') or 'data n.d.'}]")
    return ("valutazione (decisione del CEO del 16/10/2026: il P/E come metrica di analisi) — multipli dell'aggregatore "
            "(yfinance) al prezzo del run della pipeline, mai ricalcolati qui · P/E prospettico = consenso degli analisti "
            "sul prossimo esercizio fiscale, e la fonte NON dichiara quale esercizio · un utile negativo non da' un P/E "
            "basso: non da' un P/E, e su chi e' in perdita il multiplo e' prezzo/ricavi · un trailing almeno "
            f"{_n(SCARTO_PE, 0)} volte il prospettico (convenzione) si dichiara · riferimento S&P 500: "
            + (" · ".join(rif) if rif else "n.d. (la pipeline non lo pubblica)")
            + " — fonti e basi diverse da quelle dei titoli (orizzonte, definizione dell'utile): un confronto "
            "indicativo, non una misura · il P/E e' una METRICA, non una prova della tenuta (§1sexies)"
            # v500 — il 18/10 l'uscita portava "prospettico 19,2× [WSJ]" qui e "19,0× (FactSet)" nel blocco INDICI: due
            #   valori per lo stesso nome di grandezza. Sono due definizioni dell'utile atteso, e si dice (v499)
            + " · il blocco INDICI porta il prospettico di FactSet e la storia di ciascuna fonte: utili attesi "
            "definiti in modo diverso, quindi i due prospettici non si confrontano fra loro")


def riga_valutazione(r):
    """v492 — il P/E come metrica di analisi delle azioni (decisione del CEO del 16/10/2026: «inserisci anche il
    fattore P/e come metrica di analisi delle azioni»). Solo i multipli che l'aggregatore pubblica (v161):
    - utile NEGATIVO: nessun P/E, si dice che non e' un P/E basso (v185, v389), e il multiplo diventa prezzo/ricavi
      (v365);
    - i due utili attesi: `stats.eps_forward` e `analisti.eps_ora` (quello delle revisioni) sono due campi distinti
      e non e' stabilito che descrivano lo stesso esercizio — si dichiara quando differiscono oltre il 5% (v414);
    - trailing e prospettico: il rapporto dice quanto utile in piu' il consenso si aspetta, o una base diversa
      (utile contabile contro stima rettificata); si dichiara da SCARTO_PE in su, e quando l'utile atteso e' piu'
      basso di quello degli ultimi 12 mesi;
    - il PEG dell'aggregatore con la sua riserva: la crescita su cui e' calcolato non e' dichiarata.
    r: una riga della pipeline, o un dizionario con le sue chiavi "stats" e "analisti"."""
    st = (r or {}).get("stats") or {}
    a = (r or {}).get("analisti") or {}
    et, ef, pt, pf = st.get("eps_ttm"), st.get("eps_forward"), st.get("pe_ttm"), st.get("forward_pe")
    if all(x is None for x in (et, ef, pt, pf)):
        return "valutazione: P/E n.d. — l'aggregatore non pubblica ne' utili ne' multipli per questo nome"
    pz = []
    perdita = (et is not None and et <= 0) or (ef is not None and ef <= 0)
    if et is not None and et <= 0:
        pz.append(f"utile degli ultimi 12 mesi NEGATIVO (EPS {_n(et, 2)}): nessun P/E, che non e' un P/E basso")
    elif pt is not None and pt > 0:
        pz.append(f"P/E ultimi 12 mesi {_n(pt)}×" + (f" (EPS {_n(et, 2)})" if et is not None else ""))
    else:
        pz.append("P/E ultimi 12 mesi n.d.")
    if ef is not None and ef <= 0:
        pz.append(f"utile atteso NEGATIVO (EPS {_n(ef, 2)}): nessun P/E prospettico")
    elif pf is not None and pf > 0:
        pz.append(f"P/E prospettico {_n(pf)}×" + (f" (EPS atteso {_n(ef, 2)})" if ef is not None else ""))
    else:
        pz.append("P/E prospettico n.d.")
    if pt and pf and pt > 0 and pf > 0 and not perdita:
        if pt / pf >= SCARTO_PE:
            pz.append(f"il trailing e' {_n(pt / pf)} volte il prospettico: il consenso si aspetta un utile molto piu' "
                      "alto di quello degli ultimi 12 mesi, oppure le due basi non coincidono (utile contabile contro "
                      "stima rettificata)")
        elif pf > pt:
            pz.append("il prospettico e' piu' alto del trailing: il consenso si aspetta un utile PIU' BASSO di quello "
                      "degli ultimi 12 mesi")
    if perdita:
        pz.append(f"su chi e' in perdita il multiplo e' prezzo/ricavi: {_n(st['ps'], 2)}×" if st.get("ps") is not None
                  else "prezzo/ricavi n.d.")
    eo = a.get("eps_ora")
    if eo is not None and ef is not None and abs(eo - ef) > max(0.05, abs(ef) * 0.05):
        pz.append(f"⚠ la riga delle revisioni porta un altro utile atteso ({_n(eo, 2)}): due campi distinti "
                  "dell'aggregatore, e non e' stabilito che descrivano lo stesso esercizio")
    if st.get("peg") is not None:
        pz.append(f"PEG {_n(st['peg'], 2)} (dell'aggregatore: la crescita su cui e' calcolato non e' dichiarata)")
    return "valutazione: " + " · ".join(pz)


# ⚠ v476 — oltre i cinque anni un'autonomia non porta piu' informazione: "175,9 mesi" e'
#   aritmeticamente giusto e comunicativamente falso (v389). E' la stessa soglia di app.js.
MESI_CAP = 60


def liquidita_societa(c):
    """(valore, nome, dettaglio) — la LIQUIDITA' di una societa', la stessa lettura di
    `liquiditaSocieta` in app.js (v476). La pipeline leggeva i soli contanti e lasciava fuori i
    titoli a breve: su RGTI 27,8 milioni contro 393,7. Su uno snapshot precedente il campo nuovo
    non c'e', e la cassa si usa DICENDO che sono i soli contanti (v406)."""
    c = c or {}
    if c.get("liquidita") is not None and c.get("liquidita_base"):
        det = ("la fonte riporta solo i contanti" if c["liquidita_base"] == "solo_cassa"
               else "contanti e titoli a breve termine")
        return c["liquidita"], "liquidita'", det
    if c.get("cassa") is not None:
        return c["cassa"], "cassa", "soli contanti, senza i titoli a breve termine"
    return None, None, None


def ritmo_dividendi(c):
    """Quante volte l'ultimo trimestre di dividendi sulle privilegiate vale la media trimestrale dei 12
    mesi, quando supera 1,1 (v477): sul ritmo recente l'autonomia e' piu' corta. None altrimenti. Una
    lettura sola per le schede e per la tenuta di numeri_libro (v161, v482)."""
    ttm, ult = (c or {}).get("dividendi_privilegiate_ttm"), (c or {}).get("dividendi_privilegiate_ultimo_trim")
    if not ttm or ult is None:
        return None
    volte = ult / (ttm / 4)
    return volte if volte > 1.1 else None


def _mesi(m):
    return "oltre 5 anni" if m > MESI_CAP else f"{_n(m)} mesi"


def scala_importi(valori):
    """(formattatore, unita') scelti UNA volta sul blocco, dal valore piu' grande (v447): righe con
    unita' diverse non si confrontano, e un "mld" fisso cancellava i numeri dei nomi piccoli."""
    vv = [abs(float(v)) for v in valori if v is not None]
    m = max(vv) if vv else 0
    div, et = (1e9, "mld") if m >= 1e9 else (1e6, "mln") if m >= 1e6 else (1e3, "migliaia")
    return (lambda v: "n.d." if v is None else _n(float(v) / div, 2)), et


def _trimestre_a(q, data, giorni, tolleranza=20):
    """Il trimestre che cade `giorni` prima di `data`: per DATA, mai per posizione (v207, v393)."""
    from datetime import date
    try:
        d0 = date.fromisoformat(str(data)[:10])
    except ValueError:
        return None
    for x in q:
        try:
            dx = date.fromisoformat(str(x.get("trim"))[:10])
        except ValueError:
            continue
        if abs((d0 - dx).days - giorni) <= tolleranza:
            return x
    return None


def ultimo_trimestre(r):
    """v481 — l'ultimo trimestre coi suoi due confronti, trovati per DATA (v207, v393):
    {u, anno, prec, trim, yoy, qoq} oppure None. Una derivazione sola per la riga «ricavi» di
    queste schede e per la TENUTA di numeri_libro.py: due rese della stessa variazione divergono
    al primo ritocco (v161, v207)."""
    q = [x for x in ((r.get("tv") or {}).get("conto_trim") or [])
         if isinstance(x, dict) and x.get("ricavi") is not None and x.get("trim")]
    if not q:
        return None
    q.sort(key=lambda x: str(x["trim"]), reverse=True)
    u = q[0]
    if isinstance(u.get("confronti"), dict):
        # v513 — un trimestre del COMUNICATO UFFICIALE (scripts/fonti_titoli.py, memoria/trimestri_ufficiali.json) si
        #   confronta SOLO coi trimestri che il comunicato stesso stampa accanto: sul 2° trimestre 2026 di JPM i ricavi
        #   di Yahoo (52,852 miliardi) e quelli del comunicato (57,347) sono due definizioni, e una variazione fra le due
        #   misurerebbe la differenza di definizione, non l'andamento. Senza un confronto nel comunicato: n.d.
        anno, prec = u["confronti"].get("anno"), u["confronti"].get("prec")
    else:
        anno = _trimestre_a(q, u["trim"], 365)
        prec = _trimestre_a(q, u["trim"], 91)
    return {"u": u, "anno": anno, "prec": prec, "trim": str(u["trim"])[:10],
            "yoy": (u["ricavi"] / anno["ricavi"] - 1) * 100 if anno and anno["ricavi"] else None,
            "qoq": (u["ricavi"] / prec["ricavi"] - 1) * 100 if prec and prec["ricavi"] else None}


def riga_ricavi(r):
    """v476 — i RICAVI per trimestre accanto all'ultimo esercizio chiuso.
    Nasce da un mio errore: il 12/10 ho motivato l'uscita da RGTI con "ricavi -46% in tre anni",
    letto sulla serie ANNUALE ferma al 2025, mentre i trimestri del 2026 dicevano il contrario
    (1,8 milioni nel 2° trimestre 2025, 5,1 nel 2° trimestre 2026). Le schede non portavano i
    ricavi affatto, e l'esercizio chiuso era l'unico a portata di mano. Solo variazioni, mai
    importi: sono nella valuta di bilancio dell'emittente (v404, v447). Quando trimestri ed
    esercizio puntano in versi opposti, la riga lo dice."""
    t = ultimo_trimestre(r)
    pz, verso_trim, verso_anno = [], None, None
    if t:
        u, anno = t["u"], t["anno"]
        parti = []
        if t["yoy"] is not None:
            verso_trim = t["yoy"]
            parti.append(f"{_segno(verso_trim)}% sullo stesso trimestre dell'anno prima")
        if t["qoq"] is not None:
            parti.append(f"{_segno(t['qoq'])}% sul trimestre precedente")
        # v512 — un trimestre che la tabella della pipeline non portava, ritrovato da un'altra fonte (scripts/fonti_titoli.py,
        #   verificato sul trimestre in comune): la fonte viaggia col numero
        _fonte = f", da {u['fonte']}: la tabella della pipeline non lo porta ancora" if u.get("fonte") else ""
        if isinstance(u.get("confronti"), dict):
            _fonte = (f", {u['fonte']}, voce «{(u.get('voci') or {}).get('ricavi')}»: i confronti sono quelli del "
                      "comunicato stesso")
        pz.append(f"ultimo trimestre (al {t['trim']}{_fonte}) "
                  + (", ".join(parti) if parti else "senza un trimestre di confronto nel dato"))
        a, b = u.get("operativo"), (anno or {}).get("operativo")
        if a is not None and b is not None:
            if a < 0 and b < 0:
                pz.append(f"perdita operativa {'AMPLIATA' if a < b else 'RIDOTTA'} "
                          f"{art('del', _n(abs(a / b - 1) * 100) + '%')} sull'anno prima")
            elif a >= 0 and b > 0:
                pz.append(f"utile operativo {_segno((a / b - 1) * 100)}% sull'anno prima")
            elif a >= 0 > b:
                pz.append("da perdita a utile operativo sull'anno prima")
            elif a < 0 <= b:
                pz.append("da utile a perdita operativa sull'anno prima")
    fin = sorted([x for x in (r.get("financials") or []) if isinstance(x, dict) and x.get("revenue") and x.get("year")],
                 key=lambda x: x["year"])
    if len(fin) >= 2:
        verso_anno = (fin[-1]["revenue"] / fin[-2]["revenue"] - 1) * 100
        pz.append(f"ultimo esercizio chiuso ({fin[-1]['year']}) {_segno(verso_anno)}% sul {fin[-2]['year']}")
    if not pz:
        return None
    s = "ricavi: " + " · ".join(pz)
    if verso_trim is not None and verso_anno is not None and (verso_trim > 0) != (verso_anno > 0):
        s += (" ⚠ TRIMESTRI ED ESERCIZIO PUNTANO IN VERSI OPPOSTI: i trimestri sono piu' recenti "
              "dell'esercizio chiuso")
    return s


# ⚠⚠ v500 — LA TABELLA DEI TRIMESTRI FERMA. Il 18/10 la tenuta di MU portava "ricavi +345,7% (al 2026-05-31)"
#   mentre la societa' aveva depositato il trimestre successivo il 30/09: la pagina lo dichiarava dalla v400, gli
#   strumenti dell'analisi no — e la tenuta e' quella su cui si decide. Quel giorno erano sei nomi (MU, AMZN, JPM,
#   GS, BLK, NKE); con la soglia di prima anche TSLA e ABBV, per un deposito fuori ciclo.
#   La soglia e' la fine del trimestre SUCCESSIVO all'ultimo della tabella (91 giorni) piu' dieci giorni: nessuna
#   societa' pubblica i conti di un trimestre nei primi dieci giorni dopo la chiusura (le banche, le piu' veloci, ne
#   impiegano 13-14). Convenzione (v240), la STESSA di depositoOltreLaTabella in assets/app.js: un gate esegue le due
#   lingue sugli stessi casi (v161, v496). Con 60 giorni un 8-K item 2.02 fuori ciclo — le consegne di Tesla del
#   02/10 — si leggeva come un trimestre nuovo.
GIORNI_DEPOSITO_OLTRE = 101


def deposito_oltre_la_tabella(r, sec=None):
    """{dep, gg, trim, irregolare} se l'ultimo 8-K con item 2.02 cade oltre la soglia dopo l'ultimo trimestre della
    tabella dei conti, altrimenti None. sec: la voce di macro.sec_calendario.per_titolo del nome; senza, quella che
    numeri_libro.righe_pipeline attacca alla riga (`_sec`)."""
    ct = [x for x in ((r or {}).get("tv") or {}).get("conto_trim") or [] if isinstance(x, dict) and x.get("trim")]
    if not ct:
        return None
    trim = str(ct[0]["trim"])[:10]          # il primo, come lo legge la pagina (la pipeline li scrive dal piu' recente)
    per = sec if sec is not None else ((r or {}).get("_sec") or {})
    dep = str((per or {}).get("ultimo_deposito") or "")[:10]
    if not dep:
        return None
    try:
        gg = (datetime.fromisoformat(dep).date() - datetime.fromisoformat(trim).date()).days
    except ValueError:
        return None
    if gg <= GIORNI_DEPOSITO_OLTRE:
        return None
    return {"dep": dep, "gg": gg, "trim": trim, "irregolare": bool((per or {}).get("cadenza_irregolare_gg"))}


def testo_tabella_ferma(f):
    """La frase, una sola per le schede e per la tenuta (v161)."""
    s = (f"⚠ tabella dei trimestri FERMA al {f['trim']}: la societa' ha depositato risultati il {f['dep']} (SEC EDGAR, "
         f"8-K item 2.02), {f['gg']} giorni dopo — oltre la fine del trimestre successivo: ricavi, utili e bilancio "
         "qui sono di un trimestre prima dell'ultimo comunicato, che sta alla fonte")
    if f.get("irregolare"):
        s += (" · ⚠ deposita 8-K con risultati anche fuori dal ciclo trimestrale: che questo deposito contenga un "
              "trimestre e' una deduzione dalla data, non un fatto")
    return s


def riga_cassa(r):
    """Solo rapporti, mai importi (v404). Esce solo per chi brucia cassa: per gli altri la
    domanda 'quanto dura la cassa' non si pone.
    ⚠ v476 — il numeratore e' la LIQUIDITA' con la sua base, i denominatori sono DUE quando ci
    sono entrambi e non si confrontano (v409), e oltre cinque anni non si stampa il numero."""
    c = r.get("combustione") or {}
    k = r.get("credito") or {}
    if c.get("fcf_ttm") is None:
        return None
    if c["fcf_ttm"] >= 0:
        return f"cassa: flusso di cassa libero POSITIVO su 12 mesi (bilancio al {c.get('cashflow_al', 'n.d.')}) — si autofinanzia"
    pz = [f"flusso di cassa libero NEGATIVO su 12 mesi (bilancio al {c.get('cashflow_al', 'n.d.')})"]
    _, nome, det = liquidita_societa(c)
    voci = []
    if c.get("mesi_operativi") is not None:
        voci.append(f"{_mesi(c['mesi_operativi'])} di perdita operativa")
    if c.get("mesi_capex") is not None:
        # ⚠⚠ v477 — gli investimenti non sono sempre costruzione: su MSTR il 99,9% del capex sono
        #   acquisti di attivita' immateriali, e "1,4 mesi di investimenti" si leggeva come un
        #   cantiere che resta a meta'. Stessa qualifica di autonomiaCassa in app.js.
        inv = f"{_mesi(c['mesi_capex'])} di investimenti"
        if c.get("investimenti_immateriali_prevalenti") and c.get("quota_immateriali_pct") is not None:
            inv += (f" (⚠ {art('il', _n(c['quota_immateriali_pct']) + '%')} sono acquisti di attivita' immateriali,"
                    " non impianti: non e' un piano di costruzione"
                    + (f"; sui soli impianti {_mesi(c['mesi_impianti'])}"
                       if c.get("mesi_impianti") is not None else "") + ")")
        voci.append(inv)
    if c.get("mesi_obblighi") is not None:
        # ⚠⚠ v477 — i dividendi sulle privilegiate stanno fuori dal flusso operativo
        ob = f"{_mesi(c['mesi_obblighi'])} di perdita operativa piu' dividendi sulle privilegiate"
        volte = ritmo_dividendi(c)
        if volte is not None:
            ob += (f" (l'ultimo trimestre di dividendi vale {_n(volte)} volte la media trimestrale:"
                   " sul ritmo recente i mesi sono meno)")
        voci.append(ob)
    if voci and nome:
        pz.append(f"la {nome} ({det}) copre " + " · ".join(voci)
                  + (f" — {('due' if len(voci) == 2 else 'tre')} denominatori diversi, non si confrontano"
                     if len(voci) > 1 else ""))
    if c.get("emissione_netta_pct") is not None:
        pz.append(f"emissione netta di azioni {_segno(c['emissione_netta_pct'])}% su 12 mesi")
    if k.get("copertura") is not None:
        pz.append(f"utile operativo / oneri finanziari {_n(k['copertura'], 2)}×")
    if k.get("oneri_var_4trim_pct") is not None:
        pz.append(f"oneri finanziari {_segno(k['oneri_var_4trim_pct'])}% in 4 trimestri")
    return "cassa: " + " · ".join(pz)


# ── v506 — VENDITE ALLO SCOPERTO: le posizioni corte APERTE di ogni nome (FINRA), misurate dalla pipeline ───────────
# Richiesta del CEO del 19/10/2026: "Analizza anche azioni allo scoperto ovvero attività short in % sui titoli
# qualora tu non lo faccia già e rendila strutturale". Una resa sola, dalla misura di update_data.aggiorna_short: la
# quota di Yahoo senza data e il flusso giornaliero — che il DPI del dark pool porta gia' — non si ristampano qui, ed
# erano la stessa grandezza scritta due volte (v161, v415).
# Le BANDE della quota del flottante sono una convenzione del mestiere, non un dato del file (v240): la resa lo dice.
SI_BANDE = ((5.0, "bassa"), (10.0, "moderata"), (20.0, "alta"))     # sotto la soglia l'etichetta; da 20% «molto alta»
SI_ALTA = 10.0          # da qui la quota e' alta, e il nome si elenca in testa al blocco
SI_RANGO_ALTO = 90      # dal 90° percentile dei propri regolamenti dell'anno: vicino al massimo dell'anno
SI_BASI = (0.8, 1.25)   # oltre questo rapporto con la quota di Yahoo le due rese si dichiarano diverse
FLOTTANTE_ND = {
    "certificati": "le azioni corte sono certificati di deposito americani e il flottante della fonte è in azioni ordinarie",
    "classi": "il flottante della fonte comprende più classi di azioni ed è più grande delle azioni della classe quotata",
    "assente": "la fonte non pubblica il flottante"}


def banda_short(p):
    if p is None:
        return None
    for soglia, nome in SI_BANDE:
        if p < soglia:
            return nome
    return "molto alta"


def _sg1(x):
    """Il segno sul valore GIA' arrotondato a un decimale: «-0,0%» non si stampa (v496)."""
    try:
        v = round(float(x), 1)
    except (TypeError, ValueError):
        return "n.d."
    if v == 0:
        return "0,0"
    return ("+" if v > 0 else "") + _n(v, 1)


def _azioni(q):
    if q is None:
        return "n.d."
    if q >= 1e6:
        return f"{_n(q / 1e6, 1)} milioni di azioni"
    return f"{int(q):,}".replace(",", ".") + " azioni"


def _data_it(d):
    try:
        return datetime.fromisoformat(str(d)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return str(d or "n.d.")


def quota_short(si):
    p = si.get("pct_flottante")
    if p is None:
        return "quota del flottante non calcolabile: " + FLOTTANTE_ND.get(si.get("flottante_nd"), "motivo n.d.")
    t = f"{_n(p, 1)}% del flottante ({banda_short(p)})"
    y = si.get("pct_yahoo")
    if y and not (SI_BASI[0] <= p / y <= SI_BASI[1]):
        t += (f" — Yahoo ne pubblica {art('il', _n(y, 1) + '%')}: due rese che non coincidono, e i dati qui presenti non dicono se "
              "la differenza sia nel flottante o nella data")
    return t


def _var_short(v, etichetta):
    if not v:
        return None
    t = f"{_sg1(v['pct'])}% {etichetta} (dal {_data_breve(v['da'])})"
    if v.get("titolo_pct") is not None:
        t += f", il titolo negli stessi giorni {_sg1(v['titolo_pct'])}%"
    return t


def _giorni_short(g):
    if g is None:
        return None
    if g < 1:
        return f"meno di un giorno di scambi per ricoprirle ({_n(g, 2)})"
    return f"{_n(g, 1)} giorni di scambi per ricoprirle"


def riga_short(r):
    """La riga «short:» di ogni scheda (v506): le posizioni corte APERTE, con la data del regolamento FINRA. Ogni
    assenza si dichiara (v406): snapshot precedente, nessun dato, non letto."""
    si = r.get("short_interest")
    if si is None:
        return ("short: snapshot precedente alla v506 — la pipeline non pubblica ancora le posizioni corte aperte "
                "(FINRA): è il dato che manca, non un valore nullo")
    stato = si.get("stato")
    if stato == "nessun dato":
        return ("short: FINRA non ha posizioni corte segnalate per questo simbolo nell'ultimo anno — non vuol dire "
                "«nessuno scommette contro»: le segnalazioni negli USA per questo titolo non ci sono")
    if stato != "misurato":
        return "short: posizioni corte aperte NON lette — FINRA non ha risposto e nessun run precedente le aveva"
    pz = [f"posizioni corte aperte al {_data_it(si['data'])} (FINRA)", quota_short(si), _azioni(si.get("q"))]
    for x in (_giorni_short(si.get("giorni")), _var_short(si.get("var1"), "sul regolamento precedente"),
              _var_short(si.get("var3m"), "in tre mesi")):
        if x:
            pz.append(x)
    if si.get("rango") is not None:
        # le date del minimo e del massimo con l'anno: in un anno di regolamenti «31/10» puo' essere di due anni diversi
        pz.append(f"{si['rango']}° percentile dei {si['regolamenti']} regolamenti dell'anno (minimo "
                  f"{_azioni(si['min']['q'])} il {_data_it(si['min']['d'])}, massimo {_azioni(si['max']['q'])} il "
                  f"{_data_it(si['max']['d'])})")
    else:
        pz.append(f"percentile dell'anno n.d. ({si.get('regolamenti')} regolamenti, ne servono {si.get('rango_min')})")
    for t in si.get("tagli") or []:
        if t.get("motivo") == "nome":
            pz.append(f"serie dal {_data_it(t['dal'])}: prima lo stesso simbolo era «{t.get('prima')}»")
        else:
            pz.append(f"serie dal {_data_it(t['dal'])}: un frazionamento, e i regolamenti di prima contano le azioni "
                      "nella base vecchia")
    if si.get("riportato"):
        pz.append("misura del run precedente: FINRA non ha risposto in questo run")
    return "short: " + " · ".join(pz)


def riga_tabella_short(si):
    """La riga di un nome nella tabella in testa: le stesse funzioni della riga «short:», un sottoinsieme."""
    if not si or si.get("stato") != "misurato":
        return {"nessun dato": "nessun dato FINRA nell'ultimo anno", "non letto": "NON letto"}.get(
            (si or {}).get("stato"), "snapshot precedente alla v506")
    p = si.get("pct_flottante")
    pz = [f"{_n(p, 1)}% ({banda_short(p)})" if p is not None else "quota n.d."]
    g = si.get("giorni")
    if g is not None:
        pz.append(f"{_n(g, 1)} giorni" if g >= 1 else f"{_n(g, 2)} giorni")
    v = si.get("var3m") or si.get("var1")
    if v:
        et = "tre mesi" if si.get("var3m") else "un regolamento"
        pz.append(f"{et} {_sg1(v['pct'])}%" + (f" (titolo {_sg1(v['titolo_pct'])}%)" if v.get("titolo_pct") is not None
                                               else ""))
    if si.get("rango") is not None:
        pz.append(f"{si['rango']}° percentile")
    return " · ".join(pz)


def blocco_short(righe, pos, sorv, macro, filtro=None):
    """VENDITE ALLO SCOPERTO, in testa alle schede: date del regolamento e della prossima pubblicazione (calendario
    UFFICIALE di FINRA, mai stimata: v396), la convenzione delle bande, la differenza col flusso giornaliero, i nomi
    con la quota alta o vicini al massimo del proprio anno, e la tabella di posizioni e sorvegliati."""
    m = (macro or {}).get("short_interest")
    L = ["VENDITE ALLO SCOPERTO — le posizioni corte APERTE di ogni nome (FINRA, short interest consolidato, due "
         "regolamenti al mese)"]
    if not m:
        L.append("  snapshot precedente alla v506: la pipeline non pubblica ancora le posizioni corte aperte — il dato "
                 "che manca, non un valore nullo")
        return L
    reg = m.get("regolamento")
    t = f"  regolamento del {_data_it(reg)}" if reg else "  nessun regolamento letto"
    if m.get("pubblicato"):
        t += f", pubblicato il {_data_it(m['pubblicato'])}"
    pr = m.get("prossimo")
    if pr:
        t += (f" · prossimo: regolamento del {_data_it(pr['regolamento'])}, pubblicazione il "
              f"{_data_it(pr['pubblicazione'])} (calendario FINRA)")
    else:
        t += " · prossima pubblicazione: dato non disponibile" + (
            " (calendario FINRA non letto in questo run)" if m.get("calendario") != "letto"
            else " (oltre il calendario che FINRA ha pubblicato)")
    if not m.get("letto"):
        t += f" · ⚠ FINRA non letto in questo run ({m.get('errore') or 'motivo n.d.'}): vale la misura del run precedente"
    L.append(t)
    L.append("  quota del flottante: sotto 5% bassa · 5-10% moderata · 10-20% alta · da 20% molto alta — una "
             "convenzione del mestiere, non un dato")
    L.append("  giorni per ricoprire = posizioni corte ÷ volume medio giornaliero dello stesso periodo, i due numeri che "
             "FINRA pubblica")
    L.append("  ⚠ la quota del volume venduta allo scoperto OGNI GIORNO (FINRA Reg SHO) è un flusso che comprende i "
             "market maker: è il DPI del blocco DARK POOL, e non si confronta con questa")
    voci = []
    for gr, ruolo in ((pos, "POSIZIONI"), (sorv, "SORVEGLIATI")):
        for tk in gr:
            if (filtro and tk not in filtro) or tk not in righe:
                continue
            voci.append((tk, ruolo, righe[tk].get("short_interest") or {}))
    alte = sorted(((tk, si["pct_flottante"]) for tk, _, si in voci if si.get("pct_flottante") is not None
                   and si["pct_flottante"] >= SI_ALTA), key=lambda x: (-x[1], x[0]))
    L.append(f"  quota alta (da {_n(SI_ALTA, 0)}% del flottante): "
             + (" · ".join(f"{tk} {_n(p, 1)}%" for tk, p in alte) if alte else "nessun nome"))
    vicini = sorted(((tk, si["rango"]) for tk, _, si in voci if si.get("rango") is not None
                     and si["rango"] >= SI_RANGO_ALTO), key=lambda x: (-x[1], x[0]))
    L.append(f"  vicine al massimo del proprio anno (dal {SI_RANGO_ALTO}° percentile dei regolamenti): "
             + (" · ".join(f"{tk} {r}°" for tk, r in vicini) if vicini else "nessun nome"))
    for ruolo in ("POSIZIONI", "SORVEGLIATI"):
        gr = [(tk, si) for tk, ru, si in voci if ru == ruolo]
        if not gr:
            continue
        L.append(f"  {ruolo}")
        gr.sort(key=lambda x: (-(x[1].get("pct_flottante") if x[1].get("pct_flottante") is not None else -1.0), x[0]))
        for tk, si in gr:
            L.append(f"    {tk} {riga_tabella_short(si)}")
    return L


def riga_trimestrale(r, sec):
    pz = []
    if r.get("earnings_date"):
        # v500 — due date per lo stesso evento nella stessa uscita si leggono come un disaccordo (v413): la data
        #   dichiarata dalla fonte e' nel blocco SCADENZE e nelle TRIMESTRALI del brief (calendario Nasdaq, v473)
        pz.append(f"trimestrale {r['earnings_date']} (STIMA yfinance, non una data confermata: quella dichiarata dalla "
                  "fonte e' nelle SCADENZE e nelle TRIMESTRALI, calendario Nasdaq)")
    s = (sec or {}).get(r["ticker"]) or {}
    if s.get("ultimo_deposito"):
        # v500 — e' un 8-K con item 2.02, non per forza il comunicato dei conti: Tesla ci deposita le consegne
        pz.append(f"ultimo 8-K con item 2.02 (risultati) su EDGAR {s['ultimo_deposito']}")
    return ("calendario: " + " · ".join(pz)) if pz else "calendario: nessuna data nel progetto"


# ═══ v497 — CDS A 5 ANNI ═════════════════════════════════════════════════════════════════════
# La pipeline legge da ICE Clear Credit i prezzi di fine giornata dei CDS a 5 anni e li converte in punti
# base (update_data.aggiorna_cds). Qui si rendono e basta: una seconda conversione divergerebbe al primo
# ritocco (v161). Il FATTO e' il prezzo; lo spread e' una conversione dichiarata.

def _data_breve(d):
    try:
        return datetime.fromisoformat(str(d)[:10]).strftime("%d/%m")
    except ValueError:
        return str(d or "n.d.")


def _pb(x):
    """Punti base interi, col separatore delle migliaia: 1.139 pb, non 1139 (convenzione delle altre rese)."""
    try:
        return f"{round(float(x)):,}".replace(",", ".")
    except (TypeError, ValueError):
        return "n.d."


def _var_cds(var):
    """Le variazioni per data (5, 21, 63 giorni raccolti) con la base accanto; un buco si dichiara."""
    pz = []
    for n in ("5", "21", "63"):
        v = (var or {}).get(n)
        if not v:
            continue
        if v.get("pb") is None:
            pz.append(f"{n} giorni n.d. ({v.get('nota') or 'il ' + _data_breve(v.get('da')) + ' non era quotato'})")
        else:
            pz.append(f"{n} giorni {'+' if v['pb'] > 0 else ''}{_pb(v['pb'])} pb (dal {_data_breve(v['da'])})")
    return pz


def _punti_cds(p):
    try:
        p = float(p)
    except (TypeError, ValueError):
        return "punti n.d."
    if abs(p) < 0.005:
        return "alla pari"
    return f"{_n(abs(p), 2)} punti {'pagati' if p > 0 else 'ricevuti'} in anticipo"


def riferimento_cds(macro):
    """L'intestazione dei CDS, una volta per blocco (v407): fonte, giorno, cosa e' fatto e cosa e' conversione,
    gli indici e lo storico raccolto. Senza il blocco nel run lo dice: 'nessun CDS' e 'il dato manca' si
    leggono uguali e sono cose diverse (v406)."""
    c = (macro or {}).get("cds")
    if not c:
        return ("CDS a 5 anni: il run della pipeline non li porta — non e' 'nessun CDS', e' il dato che manca")
    pz = [f"CDS a 5 anni (richiesta del CEO del 17/10/2026: monitorare i CDS di posizioni e sorvegliati) — {c.get('fonte')}, "
          f"ultima pubblicazione letta: giorno di compensazione {_data_breve(c.get('data'))}"]
    # v508 — ICE pubblica lo stesso giorno a ondate, per area: quando la lettura porta piu' date lo si dice, perche'
    #   «non ancora pubblicato» e «non quotato» si leggono uguali e non lo sono (v406)
    dt = c.get("date") or {}
    if len(dt) > 1:
        pz.append("ICE pubblica per area in momenti diversi della giornata: "
                  + ", ".join(f"{n} entita' al {_data_breve(d)}" for d, n in sorted(dt.items(), reverse=True))
                  + " — ogni nome porta la data della sua ultima pubblicazione")
    if not c.get("letto"):
        pz.append(f"⚠ ICE NON letto nell'ultimo run ({c.get('errore') or 'motivo n.d.'}): valgono i prezzi dell'ultimo "
                  f"giorno raccolto, il {_data_breve(c.get('data'))}")
    pz.append("il FATTO e' il prezzo (100 meno i punti pagati in anticipo sulla cedola fissa); i punti base sono una "
              f"CONVERSIONE con la convenzione di mercato semplificata (recupero {_n((c.get('recupero') or 0) * 100, 0)}%, "
              f"tasso piatto {_n(c.get('tasso_pct'), 2)}%: {c.get('tasso_fonte')}) — misurata sulle societa' quotate con "
              "due cedole: stesso spread entro 3 pb di mediana; oltre "
              f"{_n(c.get('punti_max'), 0)} punti anticipati lo spread dipende dal recupero assunto e vale il prezzo")
    ri = []
    for fam, nome in (("IG", "CDX investment grade"), ("HY", "CDX high yield")):
        v = (c.get("indici") or {}).get(fam)
        if v:
            _al = f" [al {_data_breve(v.get('data'))}]" if v.get("data") and v.get("data") != c.get("data") else ""
            ri.append(" ".join([f"{nome} serie {v.get('serie')} {_pb(v.get('pb'))} pb{_al}"] + _var_cds(v.get("var"))))
    if ri:
        pz.append("indici: " + " · ".join(ri))
    st = c.get("storia") or {}
    g = st.get("giorni") or 0
    pz.append(f"storico raccolto dalla pipeline dal {_data_breve(st.get('dal'))}: {g} {'giorno' if g == 1 else 'giorni'} "
              "— ICE non pubblica lo storico gratis, e le variazioni compaiono quando i giorni raccolti bastano")
    # v508 — i giorni raccolti a meta' si NOMINANO: un nome assente quel giorno non era «non quotato», non e' stato letto
    # i giorni a meta' DENTRO le finestre delle misure; quelli piu' vecchi si contano (uno snapshot precedente alla
    #   divisione porta solo l'elenco intero)
    _rec = st.get("parziali_recenti") if "parziali_recenti" in st else st.get("parziali")
    if _rec:
        # i giorni con lo stesso motivo insieme, il motivo come la riga dello storico lo dichiara
        gruppi = {}
        for d in _rec:
            gruppi.setdefault((st.get("parziali_motivi") or {}).get(d) or "motivo non dichiarato", []).append(d)
        pz.append("⚠ raccolti a meta' — un nome assente quei giorni non e' stato letto, e non vuol dire che ICE non lo "
                  "quotasse: " + " · ".join(f"{', '.join(_data_breve(d) for d in ds)}: {m}" for m, ds in gruppi.items()))
        _ric = {d: f for d, f in (st.get("ricostruiti") or {}).items() if d in _rec}
        if _ric:
            pz.append("ricostruiti da: " + ", ".join(f"{_data_breve(d)} ← {f}" for d, f in sorted(_ric.items())))
    if st.get("parziali_vecchi"):
        pz.append(f"piu' {st['parziali_vecchi']} {'giorno' if st['parziali_vecchi'] == 1 else 'giorni'} raccolti a meta' "
                  "piu' vecchi, fuori dalle finestre delle misure")
    if st.get("in_corso"):
        pz.append(f"il {_data_breve(st['in_corso'])} e' in corso: ICE non ha ancora pubblicato gli indici CDX e i nomi "
                  "nordamericani di quel giorno, che restano al giorno prima")
    if c.get("non_classificati"):
        pz.append(f"⚠ NON CLASSIFICATI in config/cds_entita.json: {', '.join(c['non_classificati'])} — vanno abbinati a mano")
    return " · ".join(pz)


def riga_cds(r, meta=None):
    """Il CDS a 5 anni del nome, nei quattro stati che la pipeline distingue (v406)."""
    c = (r or {}).get("cds")
    if not c:
        return "CDS 5 anni: n.d. — il run della pipeline non porta i CDS su questo nome"
    st = c.get("stato")
    if st == "assente":
        s = (f"CDS 5 anni: NESSUN CDS compensato a ICE su questo nome (elenco ICE controllato il {_data_breve(c.get('verificato'))}) — "
             "il mercato non lo quota in forma pubblica; restano i fatti di bilancio (cassa, oneri)")
        if c.get("candidati"):
            s += f" · ⚠ ICE compensa ora {', '.join(c['candidati'])}: stesso primo nome, abbinamento non ancora deciso"
        return s
    if st == "non quotato oggi":
        return (f"CDS 5 anni: abbinato a ICE ({c.get('codice')}) ma assente dalla pubblicazione del giorno — non e' uno "
                "spread a zero, e' il dato che manca")
    if st != "quotato":
        return "CDS 5 anni: NON CLASSIFICATO — il nome non e' in config/cds_entita.json, va abbinato a mano"
    # v508 — lo spread n.d. con la causa VERA (la pipeline la dichiara): fino alla v507 la riga scriveva «nel run
    #   mancava il tasso» anche col tasso presente (Repubblica Italiana, 23/10/2026)
    if c.get("pb") is not None:
        pz = [f"CDS 5 anni {_pb(c['pb'])} pb"]
    elif c.get("pb_perche"):
        pz = [f"CDS 5 anni: spread n.d. ({c['pb_perche']}; resta il prezzo)"]
    elif (meta or {}).get("tasso_pct") is None:
        pz = ["CDS 5 anni: spread n.d. (nel run mancava il tasso; resta il prezzo)"]
    else:
        pz = ["CDS 5 anni: spread n.d. (questo run della pipeline non dichiara perche'; resta il prezzo)"]
    pz.append(f"prezzo {_n(c.get('prezzo'), 2)} su cedola {c.get('cedola_pb')} ({_punti_cds(c.get('punti'))}), "
              f"{c.get('entita')} [{c.get('contratto')}], {_data_breve(c.get('data'))}")
    if c.get("ultima_ice"):
        pz.append(f"ICE ha gia' pubblicato il {_data_breve(c['ultima_ice'])} per altre aree: questo nome e' ancora al "
                  f"{_data_breve(c.get('data'))}, e le sue misure finiscono quel giorno")
    if c.get("indicativo"):
        pz.append(f"⚠ oltre {_n((meta or {}).get('punti_max'), 0)} punti anticipati lo spread dipende dal recupero "
                  "assunto: vale il prezzo")
    # la cedola dice in che fascia il mercato tratta il nome: 100 pb come investment grade, 500 pb come high yield
    fam = {100: "IG", 500: "HY"}.get(c.get("cedola_pb"))
    ind = ((meta or {}).get("indici") or {}).get(fam) if fam else None
    if ind and ind.get("pb") and c.get("pb") is not None:
        pz.append(f"{_n(c['pb'] / ind['pb'], 1)} volte l'indice CDX {fam} della stessa cedola ({_pb(ind['pb'])} pb)")
    pz.extend(_var_cds(c.get("var")))
    sto = c.get("storia") or {}
    if sto.get("min_pb") is not None:
        pz.append(f"nello storico raccolto ({sto.get('giorni')} giorni) minimo {_pb(sto['min_pb'])} pb il "
                  f"{_data_breve(sto.get('min_data'))}, massimo {_pb(sto['max_pb'])} pb il {_data_breve(sto.get('max_data'))}")
    if c.get("nota"):
        pz.append(c["nota"])
    return " · ".join(pz)


def righe_credito(r, meta_cds=None, dsec=None):
    """v501 — la salute del credito del nome (richiesta del CEO del 18/10/2026): CDS oltre il livello, Altman con la
    frequenza storica per orizzonte, debito dai bilanci. La lettura vive in scripts/credito.py; qui si mette in fila."""
    tk = r.get("ticker")
    ds = dsec or {}
    x = (ds.get("per_titolo") or {}).get(tk)
    out = []
    cc = credito.riga_credito_cds(r, meta_cds)
    if cc:
        out.append(cc)
    a = credito.altman_rischio(r)
    # v504 — le due solidita' prima del dettaglio: la riga che le mette accanto, poi Altman (patrimoniale) con da dove
    #   vengono un circolante o un patrimonio negativi, il debito, e la cassa dell'attivita' (operativa)
    out.append(credito.riga_solidita(r, a))
    out.append(credito.riga_altman(a, r.get("solidita"), r.get("combustione")))
    out.append(credito.riga_debito(r, x, liquidita_societa(r.get("combustione")), ds.get("senza_10q") or (),
                                   ds.get("versione")))
    ca = credito.riga_cassa_attivita(r)
    if ca:
        out.append(ca)
    return out


def scheda(tk, ruolo, righe, sec, meta_cds=None, dsec=None):
    r = righe.get(tk)
    if r is None:
        return [f"{tk} [{ruolo}] — NON E' NELLA PIPELINE: nessun dato del progetto su questo nome "
                f"(non e' 'nessun segnale', e' il dato che manca)"]
    out = [f"{tk} [{ruolo}] {r.get('name') or ''} — prezzo pipeline del {r.get('price_asof') or 'n.d.'}"]
    out.append("  " + riga_trimestrale(r, sec))
    sens = (r.get("tv") or {}).get("sensibilita") or {}
    if sens:
        for chiave, nome in CANALI:
            out.append("  " + riga_canale(nome, sens.get(chiave)))
    else:
        out.append("  sensibilita' macro: n.d.")
    out.append("  " + riga_revisioni(r.get("analisti")))
    out.append("  " + riga_valutazione(r))          # v492 — il P/E come metrica
    for f in (riga_ricavi, riga_cassa, riga_short):
        x = f(r)
        if x:
            out.append("  " + x)
    ferma = deposito_oltre_la_tabella(r, (sec or {}).get(tk) or {})       # v500
    if ferma:
        out.append("  " + testo_tabella_ferma(ferma))
    out.append("  " + riga_cds(r, meta_cds))       # v497 — il credito prezzato dal mercato, nome per nome
    out.extend("  " + x for x in righe_credito(r, meta_cds, dsec))     # v501 — la salute del credito
    return out


def genera(dati, pos, sorv, filtro=None):
    righe = {r["ticker"]: r for r in (dati.get("watchlist") or []) if isinstance(r, dict) and r.get("ticker")}
    sec = ((dati.get("macro") or {}).get("sec_calendario") or {}).get("per_titolo") or {}
    out = []
    agg = dati.get("updated_at")
    if agg:
        try:
            ore = (datetime.now(timezone.utc) - datetime.fromisoformat(agg.replace("Z", "+00:00"))).total_seconds() / 3600
            out.append(f"Dati del progetto: run della pipeline {agg} ({_n(ore)} ore fa).")
        except ValueError:
            out.append(f"Dati del progetto: run della pipeline {agg}.")
    _ft = (dati.get("macro") or {}).get("_fonti_titoli")
    if _ft:
        # v512 — quale fonte ha vinto per ciascun blocco: chi legge sa se un numero e' della pipeline o di adesso (v406)
        out.append("Lettura alla fonte del giro (scripts/fonti_titoli.py): "
                   + " · ".join(f"{k} {v}" for k, v in (_ft.get("esiti") or {}).items()))
    out.append("Opzioni: non qui — le guardie di plausibilita' vivono nel pacchetto titolo della dashboard.")
    out.append(riferimento_valutazione(dati.get("macro")))      # v492 — una volta per blocco (v407)
    meta_cds = (dati.get("macro") or {}).get("cds")
    out.append(riferimento_cds(dati.get("macro")))              # v497 — una volta per blocco (v407)
    # v501 — la salute del credito: l'intestazione una volta, e in testa i SEGNALI di tutti i nomi, perche' un rincaro
    #   improvviso o una divergenza non devono aspettare di essere trovati scorrendo sessanta schede
    dsec = (dati.get("macro") or {}).get("debito_sec")
    out.append(credito.riferimento_credito(dati.get("macro")))
    _voci = []
    for _gr, _ru in ((pos, "POSIZIONE"), (sorv, "SORVEGLIATO")):
        for _tk in _gr:
            if (filtro and _tk not in filtro) or _tk not in righe:
                continue
            _r = righe[_tk]
            _x = ((dsec or {}).get("per_titolo") or {}).get(_tk)
            _voci.append((_tk, _ru, credito.segnali(_r, _x, liquidita_societa(_r.get("combustione")))))
    out.extend(credito.sintesi(_voci))
    # il BTP non ha una scheda (e' in euro): il suo CDS e' quello sovrano, e sta qui
    for b in (dati.get("portfolio") or []):
        if isinstance(b, dict) and b.get("cds"):
            out.append(f"{b.get('ticker')} [POSIZIONE, titolo di Stato] — " + riga_cds(b, meta_cds))
    out.extend(blocco_short(righe, pos, sorv, dati.get("macro"), filtro))      # v506 — le vendite allo scoperto
    mancanti = []
    for gruppo, ruolo in ((pos, "POSIZIONE"), (sorv, "SORVEGLIATO")):
        for tk in gruppo:
            if filtro and tk not in filtro:
                continue
            if tk not in righe:
                mancanti.append(tk)
            out.append("")
            out.extend(scheda(tk, ruolo, righe, sec, meta_cds, dsec))
    if mancanti:
        out.append("")
        out.append(f"⚠ {len(mancanti)} {'nome' if len(mancanti) == 1 else 'nomi'} senza dati del progetto: {', '.join(mancanti)}")
    return "\n".join(out)


def main():
    pos, _, sorv = brief.leggi_libro()
    tks_pos = [p["tk"] for p in pos if p.get("valuta") == "USD"]
    tks_sorv = [s["tk"] for s in sorv if s["tk"] not in tks_pos]
    dati = json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    import fonti_titoli
    dati = fonti_titoli.carica(dati)    # v512 — la lettura alla fonte del giro, dove piu' recente della pipeline
    filtro = set(a.upper() for a in sys.argv[1:]) or None
    print(genera(dati, tks_pos, tks_sorv, filtro))


if __name__ == "__main__":
    main()
