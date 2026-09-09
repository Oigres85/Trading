#!/usr/bin/env python3
"""RICONCILIAZIONE FRA I DUE STRATI DATI (v436).

Il progetto ha due sorgenti che calcolano le stesse grandezze:
  · `scripts/update_data.py` -> `data/data.json`  — la PIPELINE, su cron, che alimenta la
    pagina viva e il pacchetto. E' la fonte di verita' PUBBLICATA.
  · `scripts/raccolta/`      -> `memoria/dati/*`  — lo STRUMENTO DI MISURA, a richiesta, per
    cio' che la pipeline non ha: storico OHLC completo con le date, bilanci depositati,
    universo esteso.

⚠ Misurato il 09/09/2026 su dodici titoli: le due implementazioni COINCIDONO — chiusure
identiche al centesimo, RSI entro 0,05 punti, ATR% identico, distanza dalla media a 50 entro
0,05. Il pericolo quindi non e' che divergano oggi: e' che possano cominciare a farlo senza
che nessuno se ne accorga. Questo script rende quel silenzio impossibile.

⚠⚠ E UNA CLASSE E' ESCLUSA PER MISURA, NON PER COMODITA'. Gli indicatori a smorzamento di
Wilder (RSI, ATR, ADX) su una serie corta dipendono dalla CONVENZIONE piu' che dal mercato.
Misurato su SKHY, 41 barre: Wilder col seme sulla media dei primi 14 da' 64,2 · col seme sulla
prima variazione 75,3 · la media semplice 74,8 · la pipeline pubblica 58,1. Diciassette punti
di ventaglio. Sulle stesse convenzioni MU (1.255 barre) da' 57,7 tre volte su tre.
Quindi sotto BARRE_MINIME i titoli NON si confrontano — e si NOMINANO (v406: "il sistema non
ha il dato" e "ce l'ha e non te lo passa" si leggono uguali).

⚠ Quando la cache della raccolta non c'e' lo script si DICHIARA non misurabile ed esce 2, mai
verde per assenza (la trappola pagata cinque volte in questo progetto).
"""
import json, os, sys

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(RADICE, "memoria", "dati")
sys.path.insert(0, os.path.join(RADICE, "scripts", "raccolta"))

BARRE_MINIME = 100      # sotto questa soglia lo smorzamento di Wilder non e' ancora convergente

# tolleranza, e la RAGIONE per cui e' quella e non un'altra (v240: una soglia e' un'affermazione)
TOLLERANZE = {
    "chiusura_pct": (0.05, "stessa chiusura da due fornitori: oltre lo 0,05% e' una seduta "
                           "diversa o un'operazione sul capitale, non un arrotondamento"),
    "rsi":          (0.50, "su serie lunga le convenzioni convergono: misurato max 0,05 su 12 titoli"),
    "atr_pct":      (0.10, "la pipeline pubblica due decimali: misurato 0,00 su 12 titoli"),
    "dist_media":   (0.15, "la pipeline arrotonda a un decimale, la raccolta a due"),
}

def _num(x):
    try:
        v = float(x)
        return v if v == v else None          # NaN -> None
    except (TypeError, ValueError):
        return None

def carica_pipeline():
    p = os.path.join(RADICE, "data", "data.json")
    if not os.path.exists(p):
        return None, None
    D = json.loads(open(p).read().replace("NaN", "null"))
    righe = {}
    for r in (D.get("watchlist") or []) + (D.get("portfolio") or []):
        tk = str(r.get("ticker") or "").upper()
        if tk:
            righe[tk] = r
    return D, righe

def confronta():
    D, PIPE = carica_pipeline()
    if not PIPE:
        print("NON MISURABILE: data/data.json assente o senza righe")
        return 2
    try:
        from tecnica import scheda
    except Exception as e:
        print(f"NON MISURABILE: la raccolta non e' importabile ({e})")
        return 2

    tickers = sorted(tk for tk in PIPE
                     if os.path.exists(os.path.join(CACHE, f"ohlc_{tk}.json")))
    if not tickers:
        print("NON MISURABILE: nessuno storico in memoria/dati/ — rigenerare con "
              "`python3 scripts/raccolta/preleva.py <TICKER...>`")
        return 2

    guai, confrontati, corti, saltati = [], [], [], []
    print(f"pipeline: {D.get('updated_at')}   ·   {len(tickers)} titoli con storico nella raccolta\n")
    print(f"{'tk':<7}{'barre':>6}{'chiusura':>11}{'Δ%':>8}{'RSI':>7}{'Δ':>7}{'ATR%':>7}{'Δ':>7}"
          f"{'d50':>8}{'Δ':>7}{'d200':>8}{'Δ':>7}")

    for tk in tickers:
        r = PIPE[tk]
        try:
            s = scheda(tk)
        except Exception as e:
            saltati.append(f"{tk} ({str(e)[:50]})")
            continue
        if not s or "errore" in s:
            saltati.append(tk)
            continue
        m, t = s["mercato"], s["tecnica"]
        nb = s.get("barre") or 0
        d = t.get("dist_medie_pct") or {}

        pp, pr = _num(r.get("price")), _num(m.get("chiusura"))
        riga = f"{tk:<7}{nb:>6}"
        if pp and pr:
            dp = (pp / pr - 1) * 100
            riga += f"{pr:>11.2f}{dp:>+8.2f}"
            lim, perche = TOLLERANZE["chiusura_pct"]
            if abs(dp) > lim:
                guai.append(f"{tk} chiusura: pipeline {pp:.2f} contro raccolta {pr:.2f} "
                            f"({dp:+.2f}%) — {perche}")
        else:
            riga += f"{'n.d.':>11}{'':>8}"

        # ── gli indicatori di Wilder si confrontano SOLO su serie convergente
        if nb < BARRE_MINIME:
            corti.append(f"{tk} ({nb} barre)")
            print(riga + f"{'—':>7}{'—':>7}{'—':>7}{'—':>7}{'—':>8}{'—':>7}{'—':>8}{'—':>7}"
                  "   serie corta: convenzione, non fatto")
            confrontati.append(tk)
            continue

        for etichetta, a, b, chiave, larg in (
            ("RSI",  _num(r.get("rsi")),             t.get("rsi14"),   "rsi",        7),
            ("ATR%", _num(r.get("atr_pct")),         t.get("atr_pct"), "atr_pct",    7),
            ("d50",  _num(r.get("sma50_dist_pct")),  d.get("sma50"),   "dist_media", 8),
            ("d200", _num(r.get("sma200_dist_pct")), d.get("sma200"),  "dist_media", 8),
        ):
            if a is None or b is None:
                riga += f"{'n.d.':>{larg}}{'':>7}"
                continue
            riga += f"{b:>{larg}.2f}{a - b:>+7.2f}"
            lim, perche = TOLLERANZE[chiave]
            if abs(a - b) > lim:
                guai.append(f"{tk} {etichetta}: pipeline {a:.2f} contro raccolta {b:.2f} "
                            f"(Δ {a-b:+.2f}, tolleranza {lim}) — {perche}")
        print(riga)
        confrontati.append(tk)

    print()
    print(f"confrontati: {len(confrontati)} titoli")
    if corti:
        print(f"⚠ indicatori NON confrontati su {len(corti)} titoli con meno di {BARRE_MINIME} "
              f"barre — su serie corta RSI/ATR dipendono dalla convenzione (misurato: 17 punti "
              f"di ventaglio su SKHY): {' · '.join(corti)}")
    if saltati:
        print(f"⚠ non leggibili dalla raccolta: {' · '.join(saltati)}")

    # ⚠ un confronto che non confronta niente non e' un confronto (v196, v229)
    pieni = [tk for tk in confrontati if tk not in [c.split(" ")[0] for c in corti]]
    if len(pieni) < 3:
        print(f"\nNON MISURABILE: solo {len(pieni)} titoli con serie abbastanza lunga "
              f"per confrontare gli indicatori")
        return 2

    if guai:
        print(f"\nDIVERGENZE ({len(guai)}):")
        for g in guai:
            print("  ✗ " + g)
        print("\nI DUE STRATI NON COINCIDONO PIU'. La pipeline resta la fonte pubblicata: "
              "la domanda e' quale delle due ha cambiato comportamento.")
        return 1

    print(f"\nOK — i due strati coincidono su {len(pieni)} titoli, entro le tolleranze dichiarate.")
    return 0

if __name__ == "__main__":
    sys.exit(confronta())
