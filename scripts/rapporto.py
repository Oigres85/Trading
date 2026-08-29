# -*- coding: utf-8 -*-
"""RAPPORTO COMPLETO DEL PORTAFOGLIO — un comando, tutto il libro.

Mette insieme, per OGNI posizione: prezzo e distanza dal carico, tecnica (medie, RSI, ATR,
distanza dai livelli), fondamentali (multipli, crescita, margini, solidita'), e il posto della
posizione nel rischio del libro. Piu' il quadro macro e gli scenari a fattore.

⚠ E' l'ossatura NUMERICA su cui si scrive l'analisi: non la sostituisce. Le notizie, le
trimestrali e il perche' di un movimento non stanno qui — quelli si cercano in rete.

⚠ TRE ETA' DIVERSE, e vanno lette separate:
   · i PREZZI e la tecnica: scaricati adesso (o dichiarati vecchi se la rete manca)
   · i FONDAMENTALI: dallo snapshot della pipeline, che ha la sua eta'
   · le POSIZIONI: da config/posizioni.json, che scrive la dashboard e nessun altro

uso:  python3 scripts/rapporto.py
"""
import json, math, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))


def eta_ore(iso):
    try:
        q = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if q.tzinfo is None:
            q = q.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - q).total_seconds() / 3600
    except Exception:
        return None


def tecnica(h):
    c = h["Close"].dropna()
    if len(c) < 60:
        return None
    p = float(c.iloc[-1])
    out = {"p": p, "seduta": str(c.index[-1].date())}
    for g in (20, 50, 200):
        if len(c) > g:
            out[f"sma{g}"] = float(c.rolling(g).mean().iloc[-1])
    d = c.diff()
    su = d.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    giu = (-d.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    out["rsi"] = float(100 - 100 / (1 + (su / giu).iloc[-1])) if giu.iloc[-1] else 100.0
    hl = (h["High"] - h["Low"]).dropna()
    out["atr_pct"] = float(hl.rolling(14).mean().iloc[-1]) / p * 100 if len(hl) >= 14 else None
    out["max20"], out["min20"] = float(c.tail(20).max()), float(c.tail(20).min())
    out["dd"] = float(c.iloc[-1] / c.cummax().iloc[-1] - 1) * 100
    for gg, et in ((5, "5g"), (21, "1m"), (63, "3m"), (252, "1a")):
        out[et] = float(c.iloc[-1] / c.iloc[-1 - gg] - 1) * 100 if len(c) > gg else None
    return out


def main():
    import yfinance as yf
    import analisi_libro as A
    try:
        a = A.analizza()
        vivo = True
    except (Exception, SystemExit) as e:
        print(f"⚠ misure non calcolabili dal vivo ({type(e).__name__}) — valori pubblicati",
              file=sys.stderr)
        a, vivo = A.da_pubblicato(), False
    d = json.loads((ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    perTk = {r["ticker"]: r for r in d.get("watchlist", [])}
    m, q = a["m"], a.get("quota_az")
    ore_snap = eta_ore(d.get("updated_at"))

    print("═" * 78)
    print("RAPPORTO DEL PORTAFOGLIO")
    print("═" * 78)
    print(f"prezzi e tecnica: {'scaricati adesso' if vivo else 'DA data/libro.json, non ricalcolati'}"
          f" · ultima seduta usata {a['al']}")
    print(f"fondamentali:     dallo snapshot della pipeline"
          + (f", {ore_snap:.0f} ore fa" if ore_snap is not None else ", eta' ignota")
          + (" ⚠ la pipeline non sta aggiornando" if (ore_snap or 0) > 24 else ""))
    g = a.get("posizioni_giorni")
    print(f"posizioni:        config/posizioni.json al {a.get('posizioni_al')}"
          + (f", {g} giorni fa" if g is not None else "")
          + (" ⚠⚠ se hai operato dopo, questi numeri sono esatti su un libro che non hai piu'"
             if (g or 0) > 7 else ""))
    for gg, mancanti in (m.get("sedute_scartate") or {}).items():
        n = mancanti if isinstance(mancanti, int) else len(mancanti)
        print(f"⚠ seduta del {gg} non usata: {n} nomi senza barra")
    if a.get("esclusi"):
        print("⚠ fuori dalla matrice: " + ", ".join(
            f"{t} ({a.get('perche_esclusi', {}).get(t, '?')})" for t in a["esclusi"]))

    print("\n" + "─" * 78)
    print("IL LIBRO NEL SUO INSIEME")
    print("─" * 78)
    if a.get("tot_az"):
        print(f"azionario {a['tot_az']:,.0f}€ ({q*100:.1f}% del patrimonio) · liquidita' "
              f"{a['cassa']:,.0f}€ · titoli di Stato {a['btp']:,.0f}€ · TOTALE {a['patrimonio']:,.0f}€")
    print(f"volatilita' {m['vol']*100:.1f}% sull'azionario"
          + (f" → {m['vol']*q*100:.1f}% sul patrimonio" if q else ""))
    print(f"drawdown massimo {m['dd_max']*100:.1f}%"
          + (f" → {m['dd_max']*q*100:.1f}% sul patrimonio" if q else "")
          + f" · adesso {m['dd_oggi']*100:.1f}%")
    print(f"scommesse effettive {m['eff']:.2f} su {len(a['pesi'])} nomi (correlazione media {m['rho']:.2f})"
          + (f" · nei ribassi {m['eff_giu']:.2f}" if m.get("eff_giu") else ""))

    print("\n" + "─" * 78)
    print("POSIZIONE PER POSIZIONE")
    print("─" * 78)
    ordine = sorted(a["pesi"], key=lambda t: -m["contrib"][t])
    hist = {}
    if vivo:
        for t in ordine:
            try:
                hist[t] = yf.Ticker(t).history(period="18mo", auto_adjust=True)
            except Exception:
                hist[t] = None
    for t in ordine:
        r = perTk.get(t, {})
        st = r.get("stats") or {}
        pmc = (a.get("carico") or {}).get(t)
        px = a["prezzi"].get(t)
        tc = tecnica(hist[t]) if hist.get(t) is not None and not hist[t].empty else None
        print(f"\n▸ {t}  {r.get('name', '')[:34]}")
        riga = f"   peso {a['pesi'][t]*100:5.1f}%  →  varianza {m['contrib'][t]*100:5.1f}%   " \
               f"vol {m['vol_nome'][t]*100:.0f}%"
        print(riga)
        if px:
            print(f"   prezzo {px:.2f}" + (f" · carico {pmc} ({(px/pmc-1)*100:+.1f}%)" if pmc else ""))
        if tc:
            sopra = [f"SMA{g}" for g in (20, 50, 200) if tc.get(f"sma{g}") and tc["p"] > tc[f"sma{g}"]]
            print(f"   TECNICA  RSI {tc['rsi']:.0f} · ATR {tc['atr_pct']:.1f}% · dal proprio massimo {tc['dd']:+.1f}%"
                  f" · sopra {len(sopra)}/3 medie ({', '.join(sopra) or 'nessuna'})")
            print(f"            5g {tc['5g']:+.1f}% · 1m {tc['1m']:+.1f}%"
                  + (f" · 3m {tc['3m']:+.1f}%" if tc.get("3m") is not None else "")
                  + (f" · 1a {tc['1a']:+.1f}%" if tc.get("1a") is not None else "")
                  + f" · banda 20 sedute {tc['min20']:.2f}–{tc['max20']:.2f}")
        f = []
        if st.get("ps"): f.append(f"P/S {st['ps']:.1f}×")
        if st.get("pe_ttm"): f.append(f"P/E {st['pe_ttm']:.1f}×")
        elif st.get("eps_ttm") is not None and st["eps_ttm"] < 0: f.append("P/E n.d. (utili negativi)")
        if st.get("forward_pe") and st["forward_pe"] > 0: f.append(f"P/E atteso {st['forward_pe']:.1f}×")
        if st.get("revenue_growth") is not None: f.append(f"ricavi {st['revenue_growth']*100:+.0f}% a/a")
        if st.get("gross_margin"): f.append(f"margine lordo {st['gross_margin']*100:.0f}%")
        if st.get("profit_margin") is not None: f.append(f"margine netto {st['profit_margin']*100:+.0f}%")
        if f: print("   FONDAM.  " + " · ".join(f))
        s2 = []
        if st.get("debt_to_equity") is not None:
            s2.append(f"debito/mezzi propri {st['debt_to_equity']/100:.2f}×")
        if st.get("altman_z") is not None: s2.append(f"Altman Z {st['altman_z']:.1f} ({st.get('altman_model','')})")
        if st.get("fcf"): s2.append(f"flusso libero {st['fcf']/1e9:+.1f} mld")
        cr = r.get("credito") or {}
        if cr.get("copertura") is not None:
            s2.append(f"copertura interessi {cr['copertura']:.1f}×" if cr["copertura"] >= 0 else "interessi NON coperti")
        if s2: print("   SOLIDITA' " + " · ".join(s2))
        rt = r.get("rating") or {}
        if rt.get("target"):
            s3 = f"target medio {rt['target']:.0f} ({(rt['target']/px-1)*100:+.0f}%)" if px else f"target {rt['target']}"
            if rt.get("n"): s3 += f" · {rt['n']} giudizi"
            an = r.get("analisti") or {}
            if an.get("revisione_90g_pct") is not None:
                s3 += f" · stima utili {an['revisione_90g_pct']:+.1f}% in 90g"
            print("   CONSENSO " + s3)
        if r.get("earnings_date"): print(f"   trimestrale attesa {r['earnings_date']}")
        vic = sorted(((u, c) for u, c in m["corr"][t].items() if u != t), key=lambda x: -x[1])[:3]
        print("   si muove con: " + ", ".join(f"{u} {c:.2f}" for u, c in vic))

    print("\n" + "─" * 78)
    print("QUADRO MACRO (dallo snapshot della pipeline)")
    print("─" * 78)
    mac = d.get("macro") or {}

    def v(*strada, default=None):
        cur = mac
        for k in strada:
            if not isinstance(cur, dict) or k not in cur:
                return default
            cur = cur[k]
        return cur

    righe = [
        ("VIX", v("vix", "value"), v("vix", "status")),
        ("Fear & Greed", v("fear_greed", "score"), v("fear_greed", "rating")),
        ("Treasury 10A", v("tassi", "us10y") or v("markets", "us10y"), "%"),
        ("Dollaro (DXY)", v("dollar_ruler", "value"), v("dollar_ruler", "status")),
        ("Credito HY (OAS)", v("systemic_risk", "hy_oas"), v("systemic_risk", "status")),
        ("Forward P/E S&P", v("forward_pe", "value"), v("forward_pe", "status")),
        ("Ciclo (MacroQuant)", v("macroquant", "label"), None),
        ("Leva operatori", v("margin_debt", "pct_of_gdp"), "% del PIL"),
    ]
    stampate = 0
    for et, val, nota in righe:
        if val is None:
            continue
        stampate += 1
        print(f"   {et:20} {val}" + (f"  {nota}" if nota else ""))
    if stampate < 4:
        print(f"   ⚠ solo {stampate} voci macro lette dallo snapshot: le chiavi potrebbero essere "
              f"cambiate. Il quadro macro completo resta in data/data.json.")

    print("\n(le notizie e le trimestrali NON sono qui: si cercano in rete)")


if __name__ == "__main__":
    main()
