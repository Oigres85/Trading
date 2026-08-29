# -*- coding: utf-8 -*-
"""SOGLIE E LIVELLI — quanto piu' vicino possibile a una decisione, restando misure.

⚠⚠ COSA QUESTO FILE FA E NON FA, e la distinzione non e' formale.
   FA: misura dove stanno i livelli, cosa e' ordinario per QUESTO titolo, a che prezzo una
       discesa esce dal suo intervallo storico, quanto pesa la posizione nel rischio del libro,
       e quale movimento di un fattore porterebbe il libro oltre una certa perdita.
   NON FA: non dice di comprare, vendere o alleggerire, e non propone quantita'. La differenza
       fra "a 195 la discesa esce dall'intervallo ordinario" e "vendi a 195" e' che la prima e'
       un fatto sul passato del titolo e la seconda e' una decisione sul capitale di qualcuno.
   Il confine e' li', e questo file ci arriva fino in fondo senza attraversarlo.

uso:  python3 scripts/soglie.py MRVL
"""
import json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
FINESTRA = "2y"


def livelli(tk, h):
    """Livelli dal PREZZO, non da opinioni. Ognuno porta come e' stato ottenuto.
    ⚠ le barre vuote si tolgono PRIMA: l'ultima riga di un fine settimana e' NaN e il NaN
    si propaga su ogni distanza, rendendo l'intera scheda illeggibile senza dirlo."""
    c = h["Close"].dropna()
    p = float(c.iloc[-1])
    out = []
    mx, mn = float(c.max()), float(c.min())
    out.append(("massimo delle ultime 2 sedute-anno", mx, f"toccato il {c.idxmax().date()}"))
    out.append(("minimo delle ultime 2 sedute-anno", mn, f"toccato il {c.idxmin().date()}"))
    for g, et in ((20, "20 sedute"), (50, "50 sedute"), (200, "200 sedute")):
        if len(c) > g:
            out.append((f"media a {et}", float(c.rolling(g).mean().iloc[-1]), "media mobile semplice"))
            out.append((f"massimo delle ultime {et}", float(c.tail(g).max()), "resistenza recente"))
            out.append((f"minimo delle ultime {et}", float(c.tail(g).min()), "supporto recente"))
    for q, et in ((0.236, "23,6%"), (0.382, "38,2%"), (0.5, "50%"), (0.618, "61,8%")):
        out.append((f"ritracciamento {et} del range 2 anni", mx - (mx - mn) * q,
                    "convenzione di Fibonacci, non una previsione"))
    return p, sorted(out, key=lambda x: -x[1])


def ordinario(h):
    """Cosa e' ORDINARIO per questo titolo: ampiezza tipica e distribuzione dei drawdown.
    E' il metro che distingue una discesa normale da una rottura, e viene dal titolo stesso."""
    c = h["Close"].dropna()
    dd = (c / c.cummax() - 1)
    peggiori = sorted(dd.values)
    n = len(peggiori)
    hl = (h["High"] - h["Low"]).dropna()
    atr = float(hl.rolling(14).mean().iloc[-1]) if len(hl) >= 14 else float("nan")
    return {
        "atr": atr, "atr_pct": atr / float(c.iloc[-1]) * 100,
        "dd_ora": float(dd.iloc[-1]) * 100,
        "dd_mediano": peggiori[n // 2] * 100,
        "dd_p10": peggiori[int(n * .10)] * 100,     # il 10% delle sedute e' stato peggio di qui
        "dd_max": peggiori[0] * 100,
        "picco": float(c.cummax().iloc[-1]),
    }


def main():
    import yfinance as yf
    import analisi_libro as A
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    tk = sys.argv[1].upper()
    a = A.analizza()
    if tk not in a["pesi"]:
        print(f"⚠ {tk} non e' fra i nomi misurati del libro: le soglie di portafoglio non si applicano")
    h = yf.Ticker(tk).history(period=FINESTRA, auto_adjust=True)
    if h.empty:
        raise SystemExit(f"nessuno storico per {tk}")
    if h["Close"].dropna().empty:
        raise SystemExit(f"{tk}: nessuna chiusura valida nello storico")
    seduta = h["Close"].dropna().index[-1].date()
    p, liv = livelli(tk, h)
    o = ordinario(h)
    pmc = (a.get("carico") or {}).get(tk)

    print(f"═══ {tk} — LIVELLI E SOGLIE · prezzo {p:.2f} alla chiusura del {seduta} ═══")
    print(f"\nCOSA E' ORDINARIO PER QUESTO TITOLO (2 anni di storia)")
    print(f"   ampiezza tipica di una seduta: {o['atr_pct']:.1f}% ({o['atr']:.2f} punti)")
    print(f"   discesa dal proprio massimo: adesso {o['dd_ora']:.1f}% · mediana storica {o['dd_mediano']:.1f}%"
          f" · peggiore {o['dd_max']:.1f}%")
    soglia_rara = o["picco"] * (1 + o["dd_p10"] / 100)
    print(f"   ⚠ SOGLIA DI ANOMALIA: sotto {soglia_rara:.2f} la discesa entra nel 10% peggiore "
          f"della sua storia a due anni ({o['dd_p10']:.1f}% dal picco di {o['picco']:.2f}).")
    print(f"     Sopra quel livello il calo e' ordinario per questo nome; sotto, non lo e' piu' —")
    print(f"     ed e' il punto in cui una tesi va riesaminata invece che confermata per abitudine.")
    if pmc:
        print(f"   il tuo prezzo di carico {pmc} sta {(p/pmc-1)*100:+.1f}% da qui"
              f" · e' il livello sotto cui la posizione passa in perdita, non un livello di mercato")

    print(f"\nLIVELLI, dal piu' alto (ognuno dice da dove viene)")
    for nome, v, come in liv:
        d = (v / p - 1) * 100
        seg = "  ← sei qui" if abs(d) < 0.6 else ""
        print(f"   {v:9.2f}  {d:+6.1f}%   {nome:42} {come}{seg}")

    if tk in a["pesi"]:
        m = a["m"]
        print(f"\nCOSA CAMBIA NEL LIBRO, se questa posizione si muove")
        print(f"   {tk} pesa {a['pesi'][tk]*100:.1f}% e porta il {m['contrib'][tk]*100:.1f}% della varianza")
        vicini = sorted(((u, c) for u, c in m["corr"][tk].items() if u != tk), key=lambda x: -x[1])[:4]
        gruppo = [u for u, c in vicini if c >= .35]
        peso_gruppo = sum(a["pesi"][u] for u in gruppo + [tk] if u in a["pesi"])
        var_gruppo = sum(m["contrib"][u] for u in gruppo + [tk] if u in m["contrib"])
        print(f"   si muove insieme a: " + ", ".join(f"{u} {c:.2f}" for u, c in vicini))
        print(f"   ⚠ con i nomi sopra 0,35 forma un blocco da {peso_gruppo*100:.0f}% del peso e "
              f"{var_gruppo*100:.0f}% della varianza: {', '.join([tk] + gruppo)}")
        print(f"     Un fatto che colpisce il fattore comune li muove insieme, e allora il rischio "
              f"non e' il peso del singolo nome ma la somma del blocco.")
        q = a.get("quota_az")
        if q:
            print(f"\nQUANTO PUO' COSTARE, in scenari gia' visti")
            for et, mv in (("una seduta ordinaria", -o["atr_pct"]),
                           ("il calo mediano storico di questo nome", o["dd_mediano"]),
                           ("il suo calo peggiore a 2 anni", o["dd_max"])):
                eff = a["pesi"][tk] * mv
                print(f"   {et:42} {mv:+6.1f}% su {tk}  →  {eff:+5.2f}% sull'azionario, "
                      f"{eff*q:+5.2f}% sul patrimonio")
    print(f"\n⚠ Sono misure sul passato di questo titolo e sul libro di oggi, non previsioni e non "
          f"indicazioni operative: dicono dove stanno i confini, non cosa farne.")


if __name__ == "__main__":
    main()
