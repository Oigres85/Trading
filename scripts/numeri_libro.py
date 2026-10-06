"""I numeri dell'analisi del libro: attribuzione, rischio, fattori, stress, tecnica, catalizzatori.

Uso:  python3 scripts/numeri_libro.py [--sedute N] [--json FILE]
      --sedute 1  -> l'ultima seduta (analisi giornaliera, il default)
      --sedute 5  -> la settimana

Lo script CALCOLA, il modello SCRIVE (regola v448): qui non c'e' nessuna frase di giudizio,
solo grandezze col proprio denominatore. Il formato della lettura sta in memoria/FORMATO_ANALISI.md.

Posizioni da memoria/LIBRO.md (mai dalla pipeline, v439); barre giornaliere vere da
stockanalysis.com via brief.barre(); macro dalla pipeline via brief.macro_dalla_pipeline().
"""
import argparse, json, math, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np

FATTORI = ["QQQ", "SMH", "SPY", "TLT", "HYG", "IBIT", "RSP"]
# Uno shock alla volta, propagato coi beta di ciascun titolo. Non si sommano: si sovrappongono.
SCENARI = {"Nasdaq 100 -10%": ("QQQ", -0.10), "Semiconduttori -15%": ("SMH", -0.15),
           "Credito HY -3%": ("HYG", -0.03), "Bitcoin -20%": ("IBIT", -0.20),
           "Treasury lunghi -8%": ("TLT", -0.08)}
MIN_BARRE_MATRICE = 200   # sotto, il titolo esce dalla matrice e si NOMINA (v406)


def misure_rischio(R, w):
    """R: rendimenti log (sedute x titoli), w: pesi che sommano a 1.
    Contributo al rischio di Euler (somma 1 per costruzione), VaR/ES storici, scommesse
    effettive 1/((1-rho)H + rho) con H l'Herfindahl dei pesi VERI (v430)."""
    w = np.asarray(w, float)
    port = R @ w
    cov = np.cov(R, rowvar=False)
    var_p = float(w @ cov @ w)
    mcr = w * (cov @ w) / var_p
    corr = np.corrcoef(R, rowvar=False)
    iu = np.triu_indices(R.shape[1], 1)
    rho = float(corr[iu].mean())
    H = float((w ** 2).sum())
    cum = np.cumsum(port)
    q5 = np.percentile(port, 5)
    r5 = np.convolve(port, np.ones(5), "valid")
    return {"vol_ann": math.sqrt(var_p * 252), "mcr": [float(x) for x in mcr],
            "var95": -float(q5), "var99": -float(np.percentile(port, 1)),
            "es95": -float(port[port <= q5].mean()),
            "maxdd": float(math.exp((cum - np.maximum.accumulate(cum)).min()) - 1),
            "rho": rho, "scommesse_eff": 1 / ((1 - rho) * H + rho),
            "peggior_seduta": float(math.exp(port.min()) - 1),
            "peggior_settimana": float(math.exp(r5.min()) - 1)}


def beta(y, x):
    c = np.cov(y, x)
    return float(c[0, 1] / c[1, 1]), float(c[0, 1] ** 2 / (c[0, 0] * c[1, 1]))


def attribuzione(qty, prezzo_ini, prezzo_fine):
    """P&L per titolo a quantita' costanti. Un titolo senza prezzo iniziale e' None, mai 0:
    uno zero direbbe 'fermo', un buco dice 'non misurabile' (v205)."""
    pnl = {t: (qty[t] * (prezzo_fine[t] - prezzo_ini[t]) if prezzo_ini.get(t) else None) for t in qty}
    base = sum(qty[t] * prezzo_ini[t] for t in qty if prezzo_ini.get(t))
    tot = sum(v for v in pnl.values() if v is not None)
    return pnl, (tot / base if base else None)


def calcola(sedute=1):
    import brief
    pos, cassa_eur, sorv = brief.leggi_libro()
    az = [p for p in pos if p["valuta"] == "USD"]
    TK = [p["tk"] for p in az]
    with ThreadPoolExecutor(6) as ex:
        B = dict(zip(TK + FATTORI, ex.map(brief.barre, TK + FATTORI)))
        TEC = dict(zip(TK, ex.map(brief.tecnica, TK)))
    S = {t: {x["t"]: (x.get("a") or x["c"]) for x in B[t]} for t in TK + FATTORI}
    dq = [x["t"] for x in B["QQQ"]]
    fine, ini, ini21 = dq[-1], dq[-1 - sedute], dq[-22]
    qty = {p["tk"]: p["qta"] for p in az}
    pmc = {p["tk"]: p["pmc"] for p in az}
    px = {t: S[t][fine] for t in TK}
    val = {t: qty[t] * px[t] for t in TK}
    tot = sum(val.values())
    w = {t: val[t] / tot for t in TK}

    pnl, ret = attribuzione(qty, {t: S[t].get(ini) for t in TK}, px)
    pnl21, ret21 = attribuzione(qty, {t: S[t].get(ini21) for t in TK}, px)
    out = {"fine": fine, "inizio": ini, "sedute": sedute, "tot_usd": tot, "cassa_eur": cassa_eur,
           "ret_libro": ret, "pnl_libro": sum(v for v in pnl.values() if v is not None),
           "ret_21": ret21, "pnl_21": sum(v for v in pnl21.values() if v is not None),
           "bench": {f: S[f][fine] / S[f][ini] - 1 for f in FATTORI},
           "bench_21": {f: S[f][fine] / S[f][ini21] - 1 for f in FATTORI},
           "titoli": [{"tk": t, "peso": w[t], "pnl": pnl[t], "pnl_21": pnl21[t],
                       "vs_pmc": px[t] / pmc[t] - 1, "latente": qty[t] * (px[t] - pmc[t])} for t in TK]}

    lunghi = [t for t in TK if len(B[t]) >= MIN_BARRE_MATRICE]
    out["esclusi_matrice"] = [t for t in TK if t not in lunghi]
    date = sorted(set.intersection(*[set(S[t]) for t in lunghi + FATTORI]))
    rend = lambda t: np.array([math.log(S[t][date[i]] / S[t][date[i - 1]]) for i in range(1, len(date))])
    R = np.column_stack([rend(t) for t in lunghi])
    F = {f: rend(f) for f in FATTORI}
    wl = np.array([w[t] for t in lunghi]); wl = wl / wl.sum()
    ris = misure_rischio(R, wl)
    ris["mcr"] = dict(zip(lunghi, ris["mcr"]))
    ris["n_sedute"] = len(date) - 1
    port = R @ wl
    ris["beta_libro"] = {f: beta(port, F[f]) for f in FATTORI if f != "RSP"}
    out["rischio"] = ris

    bt = {t: {f: beta(R[:, i], F[f])[0] for f in F} for i, t in enumerate(lunghi)}
    st = {}
    for nome, (f, s) in SCENARI.items():
        # chi e' fuori dalla matrice non ha un beta proprio: usa quello del LIBRO, e si dichiara.
        # Non un nome scelto a mano: un registro di somiglianze invecchia da solo (C10).
        det = {t: val[t] * (bt[t][f] if t in bt else ris["beta_libro"][f][0]) * s for t in TK}
        st[nome] = {"pnl": sum(det.values()), "pct": sum(det.values()) / tot,
                    "r2": ris["beta_libro"][f][1], "peggiori": sorted(det.items(), key=lambda x: x[1])[:3]}
    out["stress"] = st
    out["stress_proxy"] = {"fuori_matrice": out["esclusi_matrice"], "usa": "beta del libro"}

    out["tecnica"] = [{"tk": t, **{k: TEC[t].get(k) for k in
                       ("px", "d50_atr", "d200_atr", "supporto20", "supp_atr", "resistenza20", "res_atr",
                        "atr_pct", "dmax52_pct", "seduta_quota")}} for t in TK]
    out["calendario"] = brief.calendario_trimestrali(TK + [s["tk"] for s in sorv], giorni=45)
    out["macro"] = brief.macro_dalla_pipeline()
    return out


def sintesi(o):
    """Righe compatte per la chat: numeri, non frasi di giudizio."""
    r, b = o["rischio"], o["bench"]
    p = lambda x, d=2: "n.d." if x is None else f"{x*100:+.{d}f}%"
    L = [f"Periodo {o['inizio']} -> {o['fine']} ({o['sedute']} sedute) · azionario {o['tot_usd']:,.0f} $",
         f"Libro {p(o['ret_libro'])} ({o['pnl_libro']:+,.0f} $) · QQQ {p(b['QQQ'])} · SMH {p(b['SMH'])} · SPY {p(b['SPY'])} · RSP {p(b['RSP'])}",
         f"21 sedute: libro {p(o['ret_21'],1)} · SMH {p(o['bench_21']['SMH'],1)} · QQQ {p(o['bench_21']['QQQ'],1)}",
         f"Vol {r['vol_ann']*100:.1f}% · VaR95 {r['var95']*100:.2f}% · ES95 {r['es95']*100:.2f}% · scommesse eff. {r['scommesse_eff']:.2f}"
         f" su {len(r['mcr'])} nomi (fuori matrice: {', '.join(o['esclusi_matrice']) or 'nessuno'}) · {r['n_sedute']} sedute",
         "Beta libro: " + " · ".join(f"{f} {bb:.2f} (R² {r2:.2f})" for f, (bb, r2) in r["beta_libro"].items())]
    for t in sorted(o["titoli"], key=lambda x: -(x["pnl"] or 0)):
        m = r["mcr"].get(t["tk"])
        ris_s = "n.d." if m is None else f"{m*100:5.1f}%"
        pnl_s = "n.d." if t["pnl"] is None else f"{t['pnl']:+,.0f} $"
        L.append(f"  {t['tk']:5} peso {t['peso']*100:5.1f}% rischio {ris_s}  periodo {pnl_s}  vs carico {t['vs_pmc']*100:+.0f}%")
    for k, v in o["stress"].items():
        L.append(f"Stress {k}: {v['pnl']:+,.0f} $ ({v['pct']*100:+.1f}%) · R² {v['r2']:.2f}")
    if o["esclusi_matrice"]:
        L.append(f"(stress: {', '.join(o['esclusi_matrice'])} senza storia sufficiente, propagati col beta del libro)")
    return "\n".join(L)


def movimento_esteso(righe, qty):
    """Pre-market / after-hours: P&L e distanze dai livelli ricalcolati sul prezzo ESTESO.
    righe: {tk: tecnica(tk)}. Un titolo senza prezzo esteso e' None, mai 0 (v205): 'fermo' e
    'non quotato fuori sessione' si leggono uguali e sono cose diverse."""
    out, pnl, base = [], 0.0, 0.0
    for tk, x in righe.items():
        ep, px, atr = x.get("esteso_px"), x.get("px"), x.get("atr")
        if not ep or not px:
            out.append({"tk": tk, "esteso": None}); continue
        d = {"tk": tk, "esteso": ep, "pct": (ep / px - 1) * 100, "fase": x.get("esteso_fase")}
        if atr:
            d["res_atr"] = (x["resistenza20"] - ep) / atr
            d["supp_atr"] = (ep - x["supporto20"]) / atr
            d["oltre"] = ("SOPRA la resistenza" if ep > x["resistenza20"] else
                          "SOTTO il supporto" if ep < x["supporto20"] else None)
        if tk in qty:
            d["pnl"] = qty[tk] * (ep - px); pnl += d["pnl"]; base += qty[tk] * px
        out.append(d)
    return out, pnl, (pnl / base if base else None)


def esteso():
    import brief
    pos, _, sorv = brief.leggi_libro()
    qty = {p["tk"]: p["qta"] for p in pos if p["valuta"] == "USD"}
    tks = list(qty) + [s["tk"] for s in sorv] + ["QQQ", "SMH", "SPY"]
    with ThreadPoolExecutor(6) as ex:
        righe = dict(zip(tks, ex.map(brief.tecnica, tks)))
    out, pnl, ret = movimento_esteso(righe, qty)
    L = [f"FUORI SESSIONE rispetto all'ultima chiusura · libro {pnl:+,.0f} $ ({ret*100:+.2f}%)" if ret is not None
         else "FUORI SESSIONE: nessun prezzo esteso per le posizioni"]
    for grp, sel in (("POSIZIONI", lambda d: d["tk"] in qty), ("RIFERIMENTI", lambda d: d["tk"] in ("QQQ", "SMH", "SPY")),
                     ("SORVEGLIATI", lambda d: d["tk"] not in qty and d["tk"] not in ("QQQ", "SMH", "SPY"))):
        L.append(grp)
        for d in sorted([d for d in out if sel(d)], key=lambda d: -(abs(d.get("pct") or 0))):
            if d["esteso"] is None:
                L.append(f"  {d['tk']:5} non quotato fuori sessione"); continue
            liv = f" · res {d['res_atr']:+.1f} ATR · supp {d['supp_atr']:+.1f} ATR" if "res_atr" in d else ""
            L.append(f"  {d['tk']:5} {d['esteso']:>10,.2f} {d['pct']:+6.2f}%"
                     + (f" {d['pnl']:+8,.0f} $" if "pnl" in d else "") + liv
                     + (f"  ⚠ {d['oltre']}" if d.get("oltre") else ""))
    return "\n".join(L)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sedute", type=int, default=1)
    ap.add_argument("--json")
    ap.add_argument("--esteso", action="store_true", help="pre-market / after-hours")
    a = ap.parse_args()
    if a.esteso:
        print(esteso()); sys.exit(0)
    o = calcola(a.sedute)
    if a.json:
        Path(a.json).write_text(json.dumps(o, default=str, indent=1))
    print(sintesi(o))
