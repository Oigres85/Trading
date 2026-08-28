# -*- coding: utf-8 -*-
"""MISURE SUL LIBRO — lo strato che vale, in un file solo.

⚠⚠ NON DIPENDE DALLA PIPELINE, ed e' una scelta, non un caso.
   La pipeline e' rimasta ferma tre giorni senza che nessuno se ne accorgesse (v369), e in quei
   tre giorni MRVL ha perso il 10% su una trimestrale: chi leggeva lo snapshot analizzava un
   prezzo che non esisteva piu'. Qui le POSIZIONI si leggono dalla loro fonte
   (config/posizioni.json, che scrive la dashboard) e i PREZZI si scaricano al momento.
   Se la pipeline muore, questa analisi continua a funzionare e a dire la verita'.

⚠ TRE TRAPPOLE GIA' PAGATE, tutte e tre sul campo:
   1. dropna() listwise: un titolo con storia corta (SKHY, quotato dal 10/07) riduceva 188
      sedute a 35 PER TUTTI, e una matrice 13x13 su 35 sedute non e' stimabile. Si esclude lui,
      dichiarandolo — che e' la regola che il sistema del CEO applicava gia', correttamente.
   2. la correlazione condizionata al ribasso su 10 sedute e' degenere: serve n > 3k.
   3. le scommesse effettive devono vedere i PESI: 1/((1-rho)*somma(w^2) + rho). La formula
      equipesata 1/(1/k + (k-1)/k*rho) e' il caso particolare w = 1/k, e sul libro vero
      sovrastima la diversificazione.

uso:  python3 scripts/analisi_libro.py            → il libro
      python3 scripts/analisi_libro.py MRVL       → il libro + la scheda di un titolo
      python3 scripts/analisi_libro.py --json     → uscita strutturata
"""
import json, math, sys
from pathlib import Path

MIN_SEDUTE = 60          # sotto questa soglia un nome non entra nella matrice, e si dichiara
FINESTRA = "9mo"
ROOT = Path(__file__).resolve().parent.parent


def carica_posizioni():
    """Dalla FONTE, non dallo snapshot: posizioni.json e' cio' che scrive la dashboard."""
    p = json.loads((ROOT / "config" / "posizioni.json").read_text(encoding="utf-8"))
    az, altro = [], []
    for r in p.get("posizioni", []):
        (altro if str(r.get("ticker", "")).startswith(("BTP", "BOT", "CCT")) else az).append(r)
    return az, altro


def stato_patrimoniale():
    try:
        s = json.loads((ROOT / "config" / "portfolio_state.json").read_text(encoding="utf-8"))
    except Exception:
        return None
    cassa = (s.get("cash") or {}).get("v")
    bv = (s.get("btp") or {}).get("v") or {}
    btp = (bv.get("qty") or 0) * (bv.get("pmc") or 0) / 100 or None
    return {"cassa": cassa, "btp": btp, "cassa_al": (s.get("cash") or {}).get("at")}


def misura(tickers, prezzi, pesi, bench="^NDX"):
    import yfinance as yf
    R = prezzi[tickers].pct_change().dropna()
    k = len(tickers)
    sd = {t: R[t].std() * math.sqrt(252) for t in tickers}
    C = R.corr()
    var = sum(pesi[a] * pesi[b] * sd[a] * sd[b] * C.loc[a, b] for a in tickers for b in tickers)
    contrib = {t: pesi[t] * sum(pesi[b] * sd[t] * sd[b] * C.loc[t, b] for b in tickers) / var
               for t in tickers}
    rho = sum(C.loc[a, b] for a in tickers for b in tickers if a != b) / (k * (k - 1))
    hh = sum(pesi[t] ** 2 for t in tickers)
    eff = 1 / ((1 - rho) * hh + rho)
    serie = (R * [pesi[t] for t in tickers]).sum(axis=1).add(1).cumprod()
    dd = serie / serie.cummax() - 1
    fuori = {"eff_giu": None, "rho_giu": None, "sedute_giu": 0}
    try:
        b = yf.download(bench, period=FINESTRA, interval="1d", auto_adjust=True,
                        progress=False)["Close"].squeeze()
        rb = b.pct_change().reindex(R.index).dropna()
        q = max(3 * k, int(len(rb) * 0.25))          # ⚠ n > 3k, altrimenti degenere
        if len(rb) >= q:
            g = R.loc[rb.nsmallest(q).index]
            Cg = g.corr()
            rg = sum(Cg.loc[a, b] for a in tickers for b in tickers if a != b) / (k * (k - 1))
            fuori = {"eff_giu": 1 / ((1 - rg) * hh + rg), "rho_giu": rg, "sedute_giu": len(g)}
    except Exception:
        pass
    return {"sedute": len(R), "al": str(R.index[-1].date()), "vol": math.sqrt(var),
            "dd_max": float(dd.min()), "dd_oggi": float(dd.iloc[-1]), "rho": rho,
            "eff": eff, "contrib": contrib, "vol_nome": sd,
            "corr": {t: {u: float(C.loc[t, u]) for u in tickers} for t in tickers}, **fuori}


def analizza():
    import yfinance as yf
    az, _ = carica_posizioni()
    tutti = [r["ticker"] for r in az]
    px = yf.download(tutti, period=FINESTRA, interval="1d", auto_adjust=True,
                     progress=False, group_by="column")["Close"]
    corti = [t for t in tutti if px[t].notna().sum() < MIN_SEDUTE]
    tk = [t for t in tutti if t not in corti]
    if len(tk) < 3:
        raise SystemExit("meno di tre titoli con storia sufficiente: niente da misurare")
    fx = 1.0
    try:
        fx = float(yf.download("EURUSD=X", period="5d", progress=False)["Close"].squeeze().iloc[-1])
    except Exception:
        pass
    ultimi = px.ffill().iloc[-1]
    val = {r["ticker"]: float(ultimi[r["ticker"]]) * float(r["qta"])
           / (1 if r.get("valuta") == "EUR" else fx) for r in az}
    tot_az = sum(val.values())
    pesi = {t: val[t] / sum(val[x] for x in tk) for t in tk}
    m = misura(tk, px, pesi)
    sp = stato_patrimoniale() or {}
    fuori_az = (sp.get("cassa") or 0) + (sp.get("btp") or 0)
    patr = tot_az + fuori_az
    return {"al": m["al"], "sedute": m["sedute"], "fx": fx,
            "esclusi": {t: val[t] / tot_az for t in corti},
            "tot_az": tot_az, "cassa": sp.get("cassa"), "btp": sp.get("btp"), "patrimonio": patr,
            "quota_az": tot_az / patr if patr else None, "pesi": pesi, "val": val, "m": m,
            "carico": {r["ticker"]: r.get("pmc") for r in az},
            "prezzi": {t: float(ultimi[t]) for t in tutti}}


def stampa(a, tk=None):
    m = a["m"]
    q = a["quota_az"]
    print(f"LIBRO al {a['al']} · {a['sedute']} sedute · EUR/USD {a['fx']:.4f}")
    if a["esclusi"]:
        print("⚠ ESCLUSI per storia corta (<%d sedute): %s" % (MIN_SEDUTE, ", ".join(
            f"{t} ({p*100:.1f}% dell'azionario)" for t, p in a["esclusi"].items())))
    print(f"\nPATRIMONIO  azionario {a['tot_az']:,.0f}€"
          + (f" ({q*100:.1f}%)" if q else " (quota sul totale: n.d.)")
          + (f" · liquidita' {a['cassa']:,.0f}€" if a["cassa"] else " · liquidita' n.d.")
          + (f" · titoli di Stato {a['btp']:,.0f}€" if a["btp"] else "")
          + (f" · TOTALE {a['patrimonio']:,.0f}€" if q else ""))
    riporta = (lambda x: x * q) if q else (lambda x: None)
    print(f"VOLATILITA' {m['vol']*100:.1f}% sull'azionario"
          + (f"  →  {riporta(m['vol'])*100:.1f}% sul PATRIMONIO" if q else ""))
    print(f"DRAWDOWN    massimo {m['dd_max']*100:.1f}%"
          + (f"  →  {riporta(m['dd_max'])*100:.1f}% sul patrimonio" if q else "")
          + f" · oggi {m['dd_oggi']*100:.1f}%")
    print(f"SCOMMESSE EFFETTIVE {m['eff']:.2f} su {len(a['pesi'])} nomi (correlazione media {m['rho']:.2f})")
    if m["eff_giu"]:
        print(f"   nelle {m['sedute_giu']} sedute peggiori del Nasdaq: {m['eff_giu']:.2f} "
              f"(correlazione {m['rho_giu']:.2f})")
    print("\nCONTRIBUTO AL RISCHIO   peso → quota della varianza")
    for t in sorted(a["pesi"], key=lambda x: -m["contrib"][x]):
        print(f"   {t:6} {a['pesi'][t]*100:5.1f}% → {m['contrib'][t]*100:5.1f}%"
              f"   vol {m['vol_nome'][t]*100:5.1f}%")
    if tk and tk in a["pesi"]:
        pmc = a["carico"].get(tk)
        px_ = a["prezzi"][tk]
        print(f"\n── {tk} ──")
        print(f"   prezzo {px_:.2f}" + (f" · carico {pmc} ({(px_/pmc-1)*100:+.1f}%)" if pmc else ""))
        print(f"   peso {a['pesi'][tk]*100:.1f}% → varianza {m['contrib'][tk]*100:.1f}%"
              f" · volatilita' {m['vol_nome'][tk]*100:.0f}%")
        vic = sorted(((u, c) for u, c in m["corr"][tk].items() if u != tk), key=lambda x: -x[1])[:3]
        print("   piu' correlati nel libro: " + ", ".join(f"{u} {c:.2f}" for u, c in vic))


if __name__ == "__main__":
    arg = [x for x in sys.argv[1:] if not x.startswith("--")]
    a = analizza()
    if "--json" in sys.argv:
        print(json.dumps(a, default=float, ensure_ascii=False, indent=1))
    else:
        stampa(a, arg[0].upper() if arg else None)
