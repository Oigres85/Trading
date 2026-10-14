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
        verso = f"stima {'in salita' if d > 0 else 'in discesa'} del {_n(abs(d) / prima * 100)}%"
    s = f"revisioni: EPS atteso {_n(prima, 2)} → {_n(ora, 2)} a 90 giorni, {verso}"
    if a.get("su_30g") is not None or a.get("giu_30g") is not None:
        s += f" · ultimi 30 giorni {a.get('su_30g', 0)} su, {a.get('giu_30g', 0)} giu'"
    if con_target and a.get("target_mediana") is not None:
        s += (f" · target mediano {_n(a['target_mediana'], 2)} (min {_n(a.get('target_min'), 2)}"
              f", max {_n(a.get('target_max'), 2)})")
    return s


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
        pz.append(f"ultimo trimestre (al {t['trim']}) "
                  + (", ".join(parti) if parti else "senza un trimestre di confronto nel dato"))
        a, b = u.get("operativo"), (anno or {}).get("operativo")
        if a is not None and b is not None:
            if a < 0 and b < 0:
                pz.append(f"perdita operativa {'AMPLIATA' if a < b else 'RIDOTTA'} del {_n(abs(a / b - 1) * 100)}% sull'anno prima")
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
            inv += (f" (⚠ il {_n(c['quota_immateriali_pct'])}% sono acquisti di attivita' immateriali,"
                    " non impianti: non e' un piano di costruzione"
                    + (f"; sui soli impianti {_mesi(c['mesi_impianti'])}"
                       if c.get("mesi_impianti") is not None else "") + ")")
        voci.append(inv)
    if c.get("mesi_obblighi") is not None:
        # ⚠⚠ v477 — i dividendi sulle privilegiate stanno fuori dal flusso operativo
        ob = f"{_mesi(c['mesi_obblighi'])} di perdita operativa piu' dividendi sulle privilegiate"
        ttm, ult = c.get("dividendi_privilegiate_ttm"), c.get("dividendi_privilegiate_ultimo_trim")
        if ttm and ult is not None:
            volte = ult / (ttm / 4)
            if volte > 1.1:
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


def riga_short(r):
    st = r.get("stats") or {}
    sf = r.get("short_flusso") or {}
    pz = []
    if st.get("short_float") is not None:
        pz.append(f"short interest {_n(st['short_float'] * 100)}% del flottante")
    if sf.get("ultimo_pct") is not None:
        pz.append(f"quota short dei volumi {_n(sf['ultimo_pct'])}% (media {_n(sf.get('media_pct'))}%)")
    return ("short: " + " · ".join(pz)) if pz else None


def riga_trimestrale(r, sec):
    pz = []
    if r.get("earnings_date"):
        pz.append(f"trimestrale {r['earnings_date']} (STIMA yfinance, non una data confermata)")
    s = (sec or {}).get(r["ticker"]) or {}
    if s.get("ultimo_deposito"):
        pz.append(f"ultimo 8-K risultati su EDGAR {s['ultimo_deposito']}")
    return ("calendario: " + " · ".join(pz)) if pz else "calendario: nessuna data nel progetto"


def scheda(tk, ruolo, righe, sec):
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
    for f in (riga_ricavi, riga_cassa, riga_short):
        x = f(r)
        if x:
            out.append("  " + x)
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
    out.append("Opzioni: non qui — le guardie di plausibilita' vivono nel pacchetto titolo della dashboard.")
    mancanti = []
    for gruppo, ruolo in ((pos, "POSIZIONE"), (sorv, "SORVEGLIATO")):
        for tk in gruppo:
            if filtro and tk not in filtro:
                continue
            if tk not in righe:
                mancanti.append(tk)
            out.append("")
            out.extend(scheda(tk, ruolo, righe, sec))
    if mancanti:
        out.append("")
        out.append(f"⚠ {len(mancanti)} {'nome' if len(mancanti) == 1 else 'nomi'} senza dati del progetto: {', '.join(mancanti)}")
    return "\n".join(out)


def main():
    pos, _, sorv = brief.leggi_libro()
    tks_pos = [p["tk"] for p in pos if p.get("valuta") == "USD"]
    tks_sorv = [s["tk"] for s in sorv if s["tk"] not in tks_pos]
    dati = json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    filtro = set(a.upper() for a in sys.argv[1:]) or None
    print(genera(dati, tks_pos, tks_sorv, filtro))


if __name__ == "__main__":
    main()
