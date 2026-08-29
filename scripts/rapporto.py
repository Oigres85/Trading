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


SCARTO_PREZZO = 2.0      # oltre questo scarto le due fonti si dichiarano ENTRAMBE


def snapshot_piu_fresco(updated_at, libro_al):
    """Lo snapshot della pipeline ha visto una seduta PIU' RECENTE di quella di libro.json?

    ⚠ NASCE DA UN CASO REALE (29/08/2026). libro.json scarta una seduta INTERA se un solo nome
    non ha ancora la barra (dropna listwise, trappola n.1 di analisi_libro.py); la pipeline no.
    Quel giorno libro.json si fermava al 27/08 mentre data.json — che questo stesso rapporto
    apre gia' per i fondamentali — portava il 28/08. In mezzo MRVL aveva perso il 10,3% sulla
    trimestrale: la scheda dava +12,8% dal carico dove il libro aveva +1,2%, e il target di
    consenso era calcolato sul prezzo sbagliato. Il rapporto aveva il dato giusto aperto in
    memoria e stampava quello vecchio.
    Si confrontano le DATE, non le ore: `updated_at` e' quando la pipeline ha girato, `al` e'
    l'ultima seduta completa. Se la pipeline gira a mercato aperto il suo prezzo e' un
    infragiornaliero, non una chiusura — e' comunque il piu' recente, e l'etichetta dice da
    quale snapshot viene senza rivendicare una seduta."""
    try:
        s = datetime.fromisoformat(str(updated_at).replace("Z", "+00:00")).date()
        return s > datetime.fromisoformat(str(libro_al)[:10]).date()
    except (TypeError, ValueError):
        return False


def prezzo_da_usare(px_libro, px_snap, preferisci_snap):
    """(prezzo, scarto%) — lo scarto e' None quando non c'e' una seconda lettura da dichiarare.

    ⚠ Non si sceglie la fonte "migliore" in astratto: si prende la piu' RECENTE e si dichiara
    l'altra quando divergono. Due valori per la stessa grandezza, uno solo dei quali stampato,
    e' la classe di difetto che in questo progetto ha gia' fatto dimensionare una compensazione
    fiscale sul numero sbagliato (v183, gate valuta)."""
    if preferisci_snap and px_snap:
        return px_snap, ((px_snap / px_libro - 1) * 100 if px_libro else None)
    return px_libro, None


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


def mld(v, cifre=1):
    if v is None:
        return None
    return f"{v/1e9:+.{cifre}f} mld" if abs(v) >= 1e9 else f"{v/1e6:+.0f} mln"


def extra(t, r, px):
    """Tutto il resto che il sistema ha e che il rapporto taceva. Ogni blocco e' condizionato al
    proprio dato: se manca, tace. Un blocco vuoto stampato e' peggio di un blocco assente."""
    an = r.get("analisti") or {}
    if an.get("eps_min") is not None and an.get("eps_max") is not None:
        med = an.get("eps_ora")
        amp = (an["eps_max"] - an["eps_min"]) / med * 100 if med else None
        print(f"   CONSENSO+ stime utili da {an['eps_min']} a {an['eps_max']}"
              + (f" su {an['eps_n']} analisti" if an.get("eps_n") else "")
              + (f" — forbice pari al {amp:.0f}% della media" if amp else "")
              + (f" · {an['su_30g']}↑ {an['giu_30g']}↓ in 30 giorni"
                 if an.get("su_30g") is not None else ""))
    if an.get("target_min") is not None:
        sotto = px and an["target_min"] < px
        print(f"   TARGET   da {an['target_min']} a {an['target_max']}"
              + (f", mediana {an['target_mediana']}" if an.get("target_mediana") else "")
              + ("  ⚠ il minimo sta SOTTO il prezzo" if sotto else ""))
    cb = r.get("combustione") or {}
    if cb.get("ocf_ttm") is not None or cb.get("cassa") is not None:
        pezzi = [x for x in (
            f"cassa {mld(cb.get('cassa'))}" if cb.get("cassa") else None,
            f"debito netto {mld(cb.get('debito_netto'))}" if cb.get("debito_netto") is not None else None,
            f"flusso operativo {mld(cb.get('ocf_ttm'))}" if cb.get("ocf_ttm") is not None else None,
            f"investimenti {mld(cb.get('capex_ttm'))}" if cb.get("capex_ttm") is not None else None,
            f"flusso libero {mld(cb.get('fcf_ttm'))}" if cb.get("fcf_ttm") is not None else None) if x]
        origine = ""
        if cb.get("ocf_ttm") is not None and cb.get("fcf_ttm") is not None:
            origine = ("  → la gestione genera cassa, il flusso libero e' negativo per gli INVESTIMENTI"
                       if cb["ocf_ttm"] > 0 and cb["fcf_ttm"] < 0 else
                       "  → la gestione ASSORBE cassa" if cb["ocf_ttm"] <= 0 else "")
        print("   CASSA    " + " · ".join(pezzi) + origine)
        if cb.get("emissione_netta_pct"):
            print(f"            emissione netta di azioni {cb['emissione_netta_pct']:+.2f}% in un anno (diluizione)")
    cr = r.get("credito") or {}
    if cr.get("oneri_ttm") is not None:
        v = [f"oneri finanziari {mld(cr['oneri_ttm'])}"]
        if cr.get("oneri_var_4trim_pct") is not None:
            v.append(f"{cr['oneri_var_4trim_pct']:+.0f}% in 4 trimestri")
        if cr.get("debito_corrente") is not None:
            cassa = cb.get("cassa")
            v.append(f"in scadenza entro 12 mesi {mld(cr['debito_corrente'])}"
                     + ("  ⚠ SOPRA la cassa" if cassa and cassa < cr["debito_corrente"] else ""))
        print("   DEBITO   " + " · ".join(v))
    fin = r.get("financials") or []
    if len(fin) >= 2:
        ult = fin[-4:]
        print("   CONTO    " + " · ".join(
            f"{x['year']}: ricavi {x['revenue']/1e9:.1f} mld, margine {x['margin']:+.0f}%" for x in ult))
    fm = r.get("fuori_mercato") or {}
    piene = [x for x in (fm.get("settimane") or []) if not x.get("incompleta")]
    if len(piene) >= 2:
        u = piene[-1]
        quota = u["ats"] / (u["ats"] + u["otc"]) * 100 if (u["ats"] + u["otc"]) else None
        print(f"   FLUSSO   settimana {u['w']}: dark pool (ATS) {u['ats']/1e6:.1f}M azioni, "
              f"fuori borsa non-ATS {u['otc']/1e6:.1f}M"
              + (f" — quota ATS {quota:.0f}%" if quota else "")
              + "  ⚠ non-ATS = internalizzatori, molto flusso al dettaglio")
    sf = r.get("short_flusso") or {}
    if sf.get("ultimo_pct") is not None:
        print(f"   SHORT    {sf['ultimo_pct']:.0f}% del volume venduto allo scoperto"
              + (f" (media {sf['media_pct']:.0f}% su {len(sf.get('serie') or [])} sedute)" if sf.get("media_pct") else "")
              + "  ⚠ e' flusso di giornata, non short interest")
    sens = ((r.get("tv") or {}).get("sensibilita")) or {}
    if isinstance(sens, dict) and sens:
        vv = []
        for k, d2 in sens.items():
            if isinstance(d2, dict) and d2.get("r2") is not None:
                forte = d2["r2"] >= 0.05
                vv.append(f"{k} beta {d2.get('beta', '?'):+.2f} R² {d2['r2']:.2f}"
                          + ("" if forte else " (canale assente)"))
        if vv:
            print("   CANALI   " + " · ".join(vv))
    stg = ((r.get("tv") or {}).get("stagionalita")) or []
    if isinstance(stg, list) and stg:
        import datetime as _dt
        m0 = _dt.date.today().month
        prossimi = [n if n <= 12 else n - 12 for n in (m0, m0 + 1, m0 + 2)]
        NOMI = ["", "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
        pr = [x for x in stg if isinstance(x, dict) and x.get("mese") in prossimi]
        pr.sort(key=lambda x: prossimi.index(x["mese"]))
        if pr:
            print("   STAGION. " + " · ".join(
                f"{NOMI[x['mese']]}: mediana {x.get('mediana', 0):+.1f}%, "
                f"{x.get('positivi_pct', 0):.0f}% positivi su {x.get('campione', 0)} anni"
                for x in pr) + "  ⚠ conto di cosa e' successo, non previsione")


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
    preferisci_snap = (not vivo) and snapshot_piu_fresco(d.get("updated_at"), a.get("al"))
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
    if preferisci_snap:
        print(f"⚠ PREZZI PRESI DALLO SNAPSHOT del {str(d.get('updated_at'))[:10]}, piu' recente "
              f"della seduta {a['al']} di libro.json: prezzo, distanza dal carico e distanza dal "
              f"target vengono da li'.")
        print(f"  PESO, VARIANZA E CORRELAZIONI restano invece alla seduta {a['al']} — si "
              f"ricalcolano solo con la rete. Le divergenze oltre il {SCARTO_PREZZO:.0f}% sono "
              f"scritte per esteso sotto ogni posizione.")
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
        px_libro = a["prezzi"].get(t)
        px, scarto = prezzo_da_usare(px_libro, r.get("price"), preferisci_snap)
        tc = tecnica(hist[t]) if hist.get(t) is not None and not hist[t].empty else None
        print(f"\n▸ {t}  {r.get('name', '')[:34]}")
        riga = f"   peso {a['pesi'][t]*100:5.1f}%  →  varianza {m['contrib'][t]*100:5.1f}%   " \
               f"vol {m['vol_nome'][t]*100:.0f}%"
        print(riga)
        if px:
            print(f"   prezzo {px:.2f}" + (f" · carico {pmc} ({(px/pmc-1)*100:+.1f}%)" if pmc else "")
                  + (f" · seduta {r['change_pct']:+.2f}%"
                     if preferisci_snap and r.get("change_pct") is not None else ""))
            if scarto is not None and abs(scarto) > SCARTO_PREZZO:
                print(f"      ⚠ {scarto:+.1f}% rispetto alla seduta {a['al']} ({px_libro:.2f}"
                      + (f", {(px_libro/pmc-1)*100:+.1f}% dal carico" if pmc else "")
                      + "), che e' quella su cui poggiano peso, varianza e correlazioni")
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
        extra(t, r, px)

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
