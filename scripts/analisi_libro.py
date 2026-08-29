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
import json, math, sys, time
from datetime import datetime, timezone
from pathlib import Path

MIN_SEDUTE = 60          # sotto questa soglia un nome non entra nella matrice, e si dichiara
FINESTRA = "9mo"
ROOT = Path(__file__).resolve().parent.parent


def carica_posizioni():
    """Dalla FONTE, non dallo snapshot: posizioni.json e' cio' che scrive la dashboard.
    ⚠⚠ Nessuno lo aggiorna automaticamente: se la dashboard non viene usata, invecchia e questa
    analisi descrive con precisione un libro che non esiste piu' — peggio che non averla,
    perche' i numeri sono giusti e il portafoglio e' sbagliato. L'eta' si dichiara sempre."""
    p = json.loads((ROOT / "config" / "posizioni.json").read_text(encoding="utf-8"))
    az, altro = [], []
    for r in p.get("posizioni", []):
        (altro if str(r.get("ticker", "")).startswith(("BTP", "BOT", "CCT")) else az).append(r)
    return az, altro, p.get("aggiornato")


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
    grezzo = prezzi[tickers]
    R = grezzo.pct_change().dropna()
    k = len(tickers)
    # ⚠⚠ IL dropna() SCARTA ANCHE L'ULTIMA SEDUTA se un solo nome non ha ancora pubblicato la
    #   barra — e succede spesso a mercato appena chiuso o nel fine settimana. L'analisi finiva
    #   su un giorno prima SENZA DIRLO: trovato da una sessione su telefono che ha notato
    #   "venerdi' manca anche se il CI ha girato". E' la trappola n.1 di questo file applicata
    #   alle DATE invece che ai titoli. Non si tengono le righe incomplete — mischierebbero
    #   giorni diversi — si dichiara quale seduta e' stata lasciata fuori e perche'.
    scartate = [d for d in grezzo.index if d > R.index[-1]]
    senza = {}
    for d in scartate:
        senza[str(d.date())] = [t for t in tickers if grezzo.loc[d, t] != grezzo.loc[d, t]]
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
    return {"sedute": len(R), "al": str(R.index[-1].date()), "sedute_scartate": senza, "vol": math.sqrt(var),
            "dd_max": float(dd.min()), "dd_oggi": float(dd.iloc[-1]), "rho": rho,
            "eff": eff, "contrib": contrib, "vol_nome": sd,
            "corr": {t: {u: float(C.loc[t, u]) for u in tickers} for t in tickers}, **fuori}


def analizza():
    import yfinance as yf
    az, _, pos_al = carica_posizioni()
    tutti = [r["ticker"] for r in az]
    px = None
    for tentativo in range(3):
        px = yf.download(tutti, period=FINESTRA, interval="1d", auto_adjust=True,
                         progress=False, group_by="column")["Close"]
        vuote = [t for t in tutti if t not in px.columns or px[t].notna().sum() == 0]
        if not vuote:
            break
        if tentativo < 2:
            print(f"⚠ tentativo {tentativo + 1}: colonne vuote {', '.join(vuote)} — ritento",
                  file=sys.stderr)
            time.sleep(2)
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
    val, senza_prezzo = {}, []
    for r in az:
        t = r["ticker"]
        p_ = float(ultimi[t]) if t in ultimi.index else float("nan")
        if not (p_ == p_) or p_ <= 0:          # NaN o non positivo
            senza_prezzo.append(t)
            continue
        val[t] = p_ * float(r["qta"]) / (1 if r.get("valuta") == "EUR" else fx)
    if senza_prezzo:
        print(f"⚠ senza prezzo utilizzabile, esclusi dal totale: {', '.join(senza_prezzo)}",
              file=sys.stderr)
    tk = [t for t in tk if t in val]
    if len(tk) < 3:
        raise SystemExit("meno di tre titoli con prezzo e storia: niente da misurare")
    tot_az = sum(val.values())
    base = sum(val[x] for x in tk)
    pesi = {t: val[t] / base for t in tk}
    m = misura(tk, px, pesi)
    sp = stato_patrimoniale() or {}
    fuori_az = (sp.get("cassa") or 0) + (sp.get("btp") or 0)
    patr = tot_az + fuori_az
    if not (tot_az == tot_az) or tot_az <= 0:
        raise SystemExit("controvalore azionario non calcolabile: nessun prezzo valido")
    giorni_pos = None
    if pos_al:
        try:
            giorni_pos = (datetime.now(timezone.utc).date()
                          - datetime.fromisoformat(str(pos_al)[:10]).date()).days
        except ValueError:
            pass
    return {"al": m["al"], "sedute": m["sedute"], "fx": fx, "senza_prezzo": senza_prezzo,
            "posizioni_al": pos_al, "posizioni_giorni": giorni_pos,
            "esclusi": {t: (val[t] / tot_az if t in val else None)
                        for t in dict.fromkeys(list(corti) + list(senza_prezzo))},
            "perche_esclusi": {**{t: "storia corta" for t in corti},
                               **{t: "prezzo non disponibile" for t in senza_prezzo}},
            "tot_az": tot_az, "cassa": sp.get("cassa"), "btp": sp.get("btp"), "patrimonio": patr,
            "quota_az": tot_az / patr if patr else None, "pesi": pesi, "val": val, "m": m,
            "carico": {r["ticker"]: r.get("pmc") for r in az},
            "prezzi": {t: float(ultimi[t]) for t in tutti}}


def stampa(a, tk=None):
    m = a["m"]
    q = a["quota_az"]
    if a.get("da_pubblicato"):
        print(f"⚠⚠ NON CALCOLATO ORA: valori letti da data/libro.json, generato "
              f"{a['da_pubblicato']}. La rete non era disponibile. Nessun numero e' stato "
              f"ricalcolato — sono quelli pubblicati, con l'eta' che hanno.")
    print(f"LIBRO al {a['al']} · {a['sedute']} sedute"
          + (f" · EUR/USD {a['fx']:.4f}" if a["fx"] == a["fx"] else ""))
    sc = a["m"].get("sedute_scartate") or {}
    for giorno, mancanti in sc.items():
        print(f"⚠ SEDUTA DEL {giorno} NON USATA: {len(mancanti)} nomi non hanno ancora la barra"
              + (f" ({', '.join(mancanti[:4])}{'…' if len(mancanti) > 4 else ''})" if mancanti else "")
              + ". L'analisi finisce alla seduta precedente — tenere una riga incompleta "
                "mischierebbe giorni diversi.")
    g = a.get("posizioni_giorni")
    if g is None:
        print("⚠ le POSIZIONI non dichiarano una data: non si sa se sono aggiornate")
    elif g > 7:
        print(f"⚠⚠ LE POSIZIONI HANNO {g} GIORNI (config/posizioni.json al {a['posizioni_al']}). "
              f"Nessuno le aggiorna da solo: le scrive la dashboard. Se hai comprato o venduto dopo "
              f"quella data, questi numeri sono esatti su un libro che non hai piu'.")
    else:
        print(f"posizioni al {a['posizioni_al']} ({g} giorni fa)")
    if a["esclusi"]:
        print("⚠ ESCLUSI dalla matrice: %s" % (", ".join(
            f"{t} ({p*100:.1f}% dell'azionario)" if p else f"{t} (peso n.d.)" for t, p in a["esclusi"].items())))
    if a["tot_az"] is None:
        print("\nPATRIMONIO  non ricalcolabile senza prezzi vivi"
              + (f" · l'azionario era il {q*100:.1f}% del totale" if q else ""))
    else:
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


def _n(x, cifre=4):
    """⚠ mai un NaN in un file pubblicato: sembra un numero e non lo e'. None si vede."""
    try:
        return round(float(x), cifre) if x == x and x is not None else None
    except (TypeError, ValueError):
        return None


def compatto(a):
    """Le sole MISURE, senza importi assoluti: e' il file che la pipeline pubblica e che una
    chat qualunque puo' scaricare e leggere. Deve restare piccolo per essere utile."""
    m = a["m"]
    return {
        "al": m["al"], "sedute": m["sedute"], "generato": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "quota_azionaria": _n(a["quota_az"]) if a["quota_az"] else None,
        "posizioni_al": a.get("posizioni_al"), "posizioni_giorni": a.get("posizioni_giorni"),
        "sedute_scartate": {g: len(v) for g, v in (m.get("sedute_scartate") or {}).items()},
        "esclusi": {t: _n(p) for t, p in a["esclusi"].items()},
        "perche_esclusi": a.get("perche_esclusi") or {},
        "volatilita": _n(m["vol"]), "drawdown_max": _n(m["dd_max"]),
        "drawdown_oggi": _n(m["dd_oggi"]),
        "scommesse_effettive": _n(m["eff"], 2), "correlazione_media": _n(m["rho"], 3),
        "scommesse_effettive_ribassi": _n(m["eff_giu"], 2),
        "correlazione_ribassi": _n(m["rho_giu"], 3),
        "sedute_ribassi": m["sedute_giu"],
        "pesi": {t: _n(w) for t, w in a["pesi"].items()},
        "contributo_rischio": {t: _n(c) for t, c in m["contrib"].items()},
        "volatilita_nome": {t: _n(v, 3) for t, v in m["vol_nome"].items()},
        "correlazioni": {t: {u: _n(c, 2) for u, c in r.items()} for t, r in m["corr"].items()},
        "prezzi": {t: _n(p, 2) for t, p in a["prezzi"].items()},
        "carico": a["carico"],
    }


def da_pubblicato():
    """Ricostruisce la scheda da data/libro.json quando la rete non c'e'. Non ricalcola nulla:
    rimette i valori pubblicati nella forma che stampa() si aspetta, e li marca come tali."""
    c = json.loads((ROOT / "data" / "libro.json").read_text(encoding="utf-8"))
    m = {"al": c["al"], "sedute": c["sedute"], "vol": c["volatilita"],
         "dd_max": c["drawdown_max"], "dd_oggi": c["drawdown_oggi"], "rho": c["correlazione_media"],
         "eff": c["scommesse_effettive"], "eff_giu": c.get("scommesse_effettive_ribassi"),
         "rho_giu": c.get("correlazione_ribassi"), "sedute_giu": c.get("sedute_ribassi", 0),
         "contrib": c["contributo_rischio"], "vol_nome": c["volatilita_nome"],
         "corr": c["correlazioni"], "sedute_scartate": {}}
    return {"al": c["al"], "sedute": c["sedute"], "fx": float("nan"), "senza_prezzo": [],
            "posizioni_al": c.get("posizioni_al"), "posizioni_giorni": c.get("posizioni_giorni"),
            "esclusi": c.get("esclusi", {}), "perche_esclusi": c.get("perche_esclusi", {}),
            "tot_az": None, "cassa": None, "btp": None, "patrimonio": None,
            "quota_az": c.get("quota_azionaria"), "pesi": c["pesi"], "val": {},
            "m": m, "carico": c.get("carico", {}), "prezzi": c["prezzi"],
            "da_pubblicato": c.get("generato")}


if __name__ == "__main__":
    arg = [x for x in sys.argv[1:] if not x.startswith("--")]
    try:
        a = analizza()
    except Exception as e:
        if "--no-fallback" in sys.argv:
            raise
        print(f"⚠ calcolo dal vivo non possibile ({type(e).__name__}: {str(e)[:90]})",
              file=sys.stderr)
        a = da_pubblicato()
    if "--compatto" in sys.argv:
        print(json.dumps(compatto(a), default=float, ensure_ascii=False, indent=1))
    elif "--json" in sys.argv:
        print(json.dumps(a, default=float, ensure_ascii=False, indent=1))
    else:
        stampa(a, arg[0].upper() if arg else None)
