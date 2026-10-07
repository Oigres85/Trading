"""Rotazione settoriale e possibili ingressi fuori dal libro, su prezzi DI OGGI (v468).

Uso:  python3 scripts/rotazione.py [--json FILE]

Decisione del CEO (07/10/2026): l'analisi della rotazione e dei possibili ingressi in settori
diversi da quelli del libro va fatta SEMPRE, con dati aggiornati, e per singoli titoli.

Cosa viene da dove — e perche' (regola v436: una grandezza, un proprietario):
- l'UNIVERSO (i 21 ETF settoriali e i loro primi cinque titoli per peso) viene da
  data/data.json -> macro.tilt: la composizione la dichiara l'EMITTENTE dell'ETF, non noi, e
  cambia lentamente. Un elenco di nomi scritto qui invecchierebbe da solo (C10);
- i PREZZI vengono da stockanalysis.com, cioe' dalla stessa fonte di brief.py e numeri_libro.py,
  e sono di OGGI: la tabella della pipeline e' ferma al proprio run;
- le POSIZIONI vengono da memoria/LIBRO.md (v439).

Lo script CALCOLA, il modello SCRIVE (v448). Gli stati sono CONVENZIONI dichiarate (v240):
  settore IN TENDENZA  = prezzo sopra la media a 200 e media a 50 in salita su 20 sedute
  settore IN RIBASSO   = prezzo sotto la media a 200 e media a 50 in discesa
  titolo CANDIDATO     = sopra la propria media a 200, media a 50 in salita, a non piu' di
                         2 ATR sopra la media a 50 (non inseguito) e non piu' di 1 ATR sotto,
                         correlazione col libro sotto 0,5 (aggiunge una scommessa diversa)
  titolo ESTESO        = oltre 3 ATR sopra la media a 50: si aspetta il ritorno
Nessun punteggio, nessuna classifica: l'ordine dei settori e' il rendimento a 3 mesi, che e'
un fatto, e dentro un settore l'ordine e' quello del peso nell'ETF, dichiarato dall'emittente.
"""
import argparse, json, math, os, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief

SEDUTE_CORR = 60
SOGLIA_CORR = 0.5
CAND_SOPRA_ATR = 2.0
CAND_SOTTO_ATR = -1.0
ESTESO_ATR = 3.0
PENDENZA_SEDUTE = 20


def rendimenti_per_data(barre):
    """{data: log-rendimento} — allineamento per DATA, mai per posizione (v207, v391)."""
    out = {}
    for a, b in zip(barre, barre[1:]):
        ca, cb = a.get("a") or a["c"], b.get("a") or b["c"]
        if ca and cb:
            out[b["t"]] = math.log(cb / ca)
    return out


def correlazione(ra, rb, n=SEDUTE_CORR):
    """Sulle ultime n date COMUNI. Sotto 30 date comuni non e' una misura: None (un buco)."""
    comuni = sorted(set(ra) & set(rb))[-n:]
    if len(comuni) < 30:
        return None
    x = [ra[t] for t in comuni]; y = [rb[t] for t in comuni]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    sx = math.sqrt(sum((v - mx) ** 2 for v in x)); sy = math.sqrt(sum((v - my) ** 2 for v in y))
    if not sx or not sy:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy)


def serie_libro(barre_pos, qta):
    """Rendimento giornaliero del libro a pesi di OGGI (convenzione dichiarata: e' il libro
    attuale guardato all'indietro, non il libro che c'era). Un titolo senza rendimento in una
    data esce da quella data invece di valere zero (v205)."""
    rend = {tk: rendimenti_per_data(b) for tk, b in barre_pos.items() if b}
    val = {tk: qta[tk] * (barre_pos[tk][-1]["c"]) for tk in rend}
    date = sorted(set().union(*[set(r) for r in rend.values()])) if rend else []
    out = {}
    for t in date:
        presenti = [tk for tk in rend if t in rend[tk]]
        peso = sum(val[tk] for tk in presenti)
        if peso:
            out[t] = sum(val[tk] * rend[tk][t] for tk in presenti) / peso
    return out


def variazione(barre, sedute):
    if len(barre) <= sedute:
        return None
    a, b = barre[-1 - sedute]["c"], barre[-1]["c"]
    return (b / a - 1) * 100 if a else None


def pendenza_sma50(barre, n=PENDENZA_SEDUTE):
    """Media a 50 oggi contro n sedute fa, in %."""
    if len(barre) < 50 + n:
        return None
    ora = sum(x["c"] for x in barre[-50:]) / 50
    prima = sum(x["c"] for x in barre[-50 - n:-n]) / 50
    return (ora / prima - 1) * 100


def stato_settore(px, sma200, pend50):
    if px is None or sma200 is None or pend50 is None:
        return "NON MISURABILE"
    if px > sma200 and pend50 > 0:
        return "IN TENDENZA"
    if px < sma200 and pend50 < 0:
        return "IN RIBASSO"
    return "MISTO"


def stato_titolo(px, sma200, pend50, d50_atr, corr):
    """CANDIDATO / ESTESO / SOTTO LA 200 / DEBOLE / LEGATO AL LIBRO / NON MISURABILE."""
    if None in (px, sma200, pend50, d50_atr):
        return "NON MISURABILE"
    if px < sma200:
        return "SOTTO LA 200"
    if d50_atr > ESTESO_ATR:
        return "ESTESO"
    if pend50 <= 0 or d50_atr < CAND_SOTTO_ATR:
        return "DEBOLE"
    if d50_atr > CAND_SOPRA_ATR:
        return "TIRATO"
    if corr is None:
        return "CANDIDATO (correlazione non misurabile)"
    if corr >= SOGLIA_CORR:
        return "LEGATO AL LIBRO"
    return "CANDIDATO"


def scheda(tk, barre, rlibro):
    t = brief.tecnica(tk, d=barre) if barre else {"tk": tk, "errore": "nessuna barra"}
    if t.get("errore"):
        return {"tk": tk, "errore": t["errore"]}
    pend = pendenza_sma50(barre)
    corr = correlazione(rendimenti_per_data(barre), rlibro)
    return {"tk": tk, "px": t["px"], "seduta": t.get("seduta_quota") or t["seduta"],
            "m1": variazione(barre, 21), "m3": variazione(barre, 63),
            "d50_atr": t["d50_atr"], "d200_atr": t["d200_atr"], "pend50": pend,
            "supp": t["supporto20"], "supp_atr": t["supp_atr"], "res": t["resistenza20"],
            "res_atr": t["res_atr"], "dmax52": t["dmax52_pct"], "corr_libro": corr,
            "sma200": t["sma200"]}


def _barre_sicure(tk):
    """Le classi di azioni (BRK-B) la fonte le scrive col punto (BRK.B): si prova anche quella
    forma prima di dichiarare il titolo non letto."""
    for forma in dict.fromkeys([tk, tk.replace("-", ".")]):
        try:
            b = brief.barre(forma)
            if b:
                return b
        except Exception:
            pass
    return None


def raccogli():
    pos, _, sorv = brief.leggi_libro()
    qta = {p["tk"]: p["qta"] for p in pos if p["valuta"] == "USD"}
    try:
        d = json.loads((Path(brief.RADICE) / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
        tilt = (d.get("macro") or {}).get("tilt") or []
    except (OSError, ValueError):
        tilt = []
    nomi = sorted({p["tk"] for r in tilt for p in (r.get("prime") or [])})
    tutti = sorted(set(qta) | {r["ticker"] for r in tilt} | set(nomi))
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        B = dict(zip(tutti, ex.map(_barre_sicure, tutti)))
    rlibro = serie_libro({tk: B.get(tk) for tk in qta if B.get(tk)}, qta)
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        S = dict(zip(tutti, ex.map(lambda tk: scheda(tk, B.get(tk), rlibro), tutti)))
    seguiti = set(qta) | {s["tk"] for s in sorv}
    settori = []
    for r in tilt:
        e = S.get(r["ticker"]) or {}
        settori.append({"etf": r["ticker"], "nome": r.get("name"), "asof_composizione": r.get("asof"),
                        **{k: e.get(k) for k in ("px", "seduta", "m1", "m3", "d50_atr", "d200_atr",
                                                 "pend50", "corr_libro", "errore")},
                        "stato": stato_settore(e.get("px"), e.get("sma200"), e.get("pend50")),
                        "titoli": [{**(S.get(p["tk"]) or {"tk": p["tk"], "errore": "non letto"}),
                                    "peso_etf": p.get("peso"), "nome": p.get("nome"),
                                    "nel_libro": p["tk"] in qta, "seguito": p["tk"] in seguiti,
                                    "stato": stato_titolo(*(lambda x: (x.get("px"), x.get("sma200"),
                                             x.get("pend50"), x.get("d50_atr"), x.get("corr_libro")))(S.get(p["tk"]) or {}))}
                                   for p in (r.get("prime") or [])]})
    return {"settori": settori, "universo_assente": not tilt, "libro": sorted(qta),
            "libro_sedute": len(rlibro)}


def n(x, d=1, s=""):
    return "n.d." if x is None else f"{x:+.{d}f}{s}".replace(".", ",")


def prezzo(x):
    """Convenzione del pacchetto: virgola decimale, punto per le migliaia (v442, v443)."""
    return "n.d." if x is None else f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def righe(o):
    if o["universo_assente"]:
        return ["ROTAZIONE: universo NON DISPONIBILE — data/data.json non porta macro.tilt. "
                "Non e' 'nessun settore in tendenza': e' la composizione degli ETF che manca."]
    L = [f"ROTAZIONE SETTORIALE — prezzi stockanalysis.com di oggi · correlazione col libro su "
         f"{SEDUTE_CORR} sedute (libro a pesi di oggi, {o['libro_sedute']} sedute di storia) · "
         "stati = convenzioni dichiarate in testa allo script, non giudizi"]
    for s in sorted(o["settori"], key=lambda s: -(s.get("m3") if s.get("m3") is not None else -1e9)):
        if s.get("errore"):
            L.append(f"{s['etf']:5} {s['nome']}: prezzi NON letti ({s['errore']})"); continue
        L.append(f"{s['etf']:5} {s['nome']:18} {s['stato']:14} 1m {n(s['m1'],1,'%'):>7} 3m {n(s['m3'],1,'%'):>7} · "
                 f"media50 {n(s['d50_atr'],1)} ATR · media200 {n(s['d200_atr'],1)} ATR · pend.50 {n(s['pend50'],1,'%')} · "
                 f"corr libro {n(s['corr_libro'],2)} · seduta {s['seduta']}")
        for t in s["titoli"]:
            tag = " [NEL LIBRO]" if t["nel_libro"] else (" [in watchlist]" if t["seguito"] else "")
            if t.get("errore"):
                L.append(f"      {t['tk']:6} non letto ({t['errore']}){tag}"); continue
            L.append(f"      {t['tk']:6} {prezzo(t['px']):>9}  {t['stato']:<22} media50 {n(t['d50_atr'],1)} ATR · "
                     f"media200 {n(t['d200_atr'],1)} ATR · supp {prezzo(t['supp'])} ({n(t['supp_atr'],1)} ATR) · "
                     f"res {prezzo(t['res'])} ({n(t['res_atr'],1)} ATR) · 3m {n(t['m3'],1,'%')} · "
                     f"corr libro {n(t['corr_libro'],2)}{tag}")
    return L


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    a = ap.parse_args()
    o = raccogli()
    if a.json:
        Path(a.json).write_text(json.dumps(o, default=str, indent=1))
    print("\n".join(righe(o)))
