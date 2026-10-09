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


def riga_cassa(r):
    """Solo rapporti, mai importi (v404). Esce solo per chi brucia cassa: per gli altri la
    domanda 'quanto dura la cassa' non si pone."""
    c = r.get("combustione") or {}
    k = r.get("credito") or {}
    if c.get("fcf_ttm") is None:
        return None
    if c["fcf_ttm"] >= 0:
        return f"cassa: flusso di cassa libero POSITIVO su 12 mesi (bilancio al {c.get('cashflow_al', 'n.d.')}) — si autofinanzia"
    pz = [f"flusso di cassa libero NEGATIVO su 12 mesi (bilancio al {c.get('cashflow_al', 'n.d.')})"]
    if c.get("mesi_capex") is not None:
        pz.append(f"la cassa copre {_n(c['mesi_capex'])} mesi di investimenti")
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
    for f in (riga_cassa, riga_short):
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
