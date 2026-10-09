"""I numeri dell'analisi del libro: attribuzione, rischio, fattori, stress, tecnica, catalizzatori.

Uso:  python3 scripts/numeri_libro.py [--sedute N] [--json FILE] [--registra]
      --sedute 1  -> l'ultima seduta (analisi giornaliera, il default)
      --sedute 5  -> la settimana
      --registra  -> scrive la riga della seduta CONCLUSA nel registro della performance
                     (memoria/registro_performance.jsonl). Mai durante la seduta. Lo passa
                     scripts/analisi.py a ogni «Aggiorna analisi».

Lo script CALCOLA, il modello SCRIVE (regola v448): qui non c'e' nessuna frase di giudizio,
solo grandezze col proprio denominatore. Il formato della lettura sta in memoria/FORMATO_ANALISI.md.

Posizioni da memoria/LIBRO.md (mai dalla pipeline, v439); barre giornaliere vere da
stockanalysis.com via brief.barre(); macro dalla pipeline via brief.macro_dalla_pipeline().

v474 (decisioni del CEO del 09/10/2026) — tre blocchi nuovi, tutti CALCOLATI qui:
  SEMAFORO D'USCITA   il colore di LIBRO.md §1ter dalle sue sei famiglie, con le soglie che il
                      libro dichiara convenzioni; la reazione si legge dal libro parola per parola;
  DECISIONI APERTE    per ogni decisione confermata e non eseguita (LIBRO.md §1quinquies) quanto
                      e' costato o ha fatto guadagnare aspettare dalla chiusura della conferma;
  REGISTRO            il libro in dollari e il patrimonio in euro contro QQQ, il riferimento
                      scelto dal CEO, a rendimento ponderato per il tempo (LIBRO.md §0).
"""
import argparse, json, math, re, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
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


def _barre_o_vuoto(tk):
    """Le barre dei nomi ACCESSORI (leader non posseduti, decisioni su nomi fuori dal libro, posizioni
    chiuse dopo l'ultima riga del registro): un nome che non risponde diventa un buco dichiarato a
    valle, non porta via l'intera analisi."""
    import brief
    try:
        return brief.barre(tk)
    except Exception:
        return []


def calcola(sedute=1, registra=False, adesso=None):
    import brief
    pos, cassa_eur, sorv = brief.leggi_libro()
    az = [p for p in pos if p["valuta"] == "USD"]
    TK = [p["tk"] for p in az]
    decisioni = leggi_decisioni()
    reg_righe, _ = leggi_registro()
    aperte = [d["tk"] for d in (decisioni or []) if d["aperta"]]
    extra = sorted((set(aperte) | set(LEADER) | set((reg_righe[-1].get("posizioni") or {}) if reg_righe else ()))
                   - set(TK) - set(FATTORI))
    with ThreadPoolExecutor(6) as ex:
        B = dict(zip(TK + FATTORI, ex.map(brief.barre, TK + FATTORI)))
        B.update(zip(extra, ex.map(_barre_o_vuoto, extra)))
        TEC = dict(zip(TK, ex.map(brief.tecnica, TK)))
        fuori = [t for t in aperte if t not in TK]
        TEC.update(zip(fuori, ex.map(lambda t: brief.tecnica(t, d=B.get(t) or None), fuori)))
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
    out["calendario"] = brief.calendario_trimestrali(TK + [s["tk"] for s in sorv] + fuori, giorni=45)
    out["macro"] = brief.macro_dalla_pipeline()
    out["attesa"] = costo_attesa(tot, ris["vol_ann"], ris["var95"], ris["es95"], out["calendario"], TK)
    _fcf, _ccc = credito_dalla_pipeline(TK)
    out["credito"] = dipendenti_credito([{**x, "valore": val[x["tk"]]} for x in out["titoli"]], out["tecnica"], _fcf, _ccc)
    # v474 — semaforo, decisioni aperte, registro. Il file della pipeline si apre in una funzione
    #   propria: le POSIZIONI di questo corpo restano quelle del libro (v439, gate v460).
    pipe = _carica_pipeline()
    out["semaforo"] = semaforo(B["SMH"], {t: B.get(t) for t in LEADER}, segnali_pipeline(pipe), adesso)
    out["semaforo"]["reazioni"] = reazioni_libro(testo_libro())
    out["decisioni"] = (None if decisioni is None else
                        costo_decisioni(decisioni, B, {t: (TEC.get(t) or {}).get("px") for t in aperte},
                                        out["calendario"], adesso))
    eur = {p["tk"]: p for p in pos if p["valuta"] == "EUR"}
    out["registro"] = aggiorna_registro(B, {p["tk"]: p["qta"] for p in az}, {t: p["qta"] for t, p in eur.items()},
                                        cassa_eur, patrimonio_pipeline(pipe, {t: p["pmc"] for t, p in eur.items()}),
                                        out["semaforo"]["colore"], registra, adesso)
    return out


def costo_attesa(tot, vol_ann, var95, es95, calendario, nomi):
    """Quanto costa ASPETTARE a decidere, e fino a quando si puo' (v464, decisione del CEO del 06/10).
    Il costo e' il rischio del libro in dollari: oscillazione tipica di una seduta e di una
    settimana, perdita di una seduta cattiva (VaR) e media delle sedute peggiori (ES).
    ⚠ La settimana e' la seduta per radice di 5: CONVENZIONE (sedute indipendenti), e si dichiara.
    La scadenza di ogni nome e' la sua PRIMA trimestrale dichiarata DALLA FONTE: nessuna data
    proiettata (v396). Un nome senza data nella finestra si NOMINA (v406): 'nessuna uscita' e
    'la fonte non la dichiara' si leggono uguali e sono cose diverse."""
    sig = vol_ann / math.sqrt(252)
    prime = {}
    for e in (calendario or {}).get("attesi") or []:
        if e["tk"] in nomi and e["tk"] not in prime:
            prime[e["tk"]] = e
    scad = sorted(prime.values(), key=lambda e: e["data"])
    return {"seduta_1s": tot * sig, "settimana_1s": tot * sig * math.sqrt(5),
            "var_usd": tot * var95, "es_usd": tot * es95,
            "scadenze": [{"tk": e["tk"], "data": e["data"], "giorni": e.get("giorni")} for e in scad],
            "senza_data": [t for t in nomi if t not in prime],
            "prima": scad[0] if scad else None,
            "finestra": (calendario or {}).get("finestra"),
            "giorni_non_letti": (calendario or {}).get("giorni_non_letti") or []}


SOGLIA_CCC_PP = 1.5   # la stessa convenzione del semaforo (LIBRO.md §1ter), non una seconda


def _carica_pipeline():
    """data/data.json una volta sola, o None. Un file illeggibile non diventa mai un default: chi lo
    usa dichiara il buco (v396)."""
    import brief
    try:
        return json.loads((Path(brief.RADICE) / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    except (OSError, ValueError):
        return None


def credito_dalla_pipeline(nomi):
    """Da data.json: il SEGNO del flusso di cassa libero di ciascun nome (v404: solo segni e
    rapporti, mai grandezze fra titoli — SKHY pubblica in won) e macro.credit_ccc.
    None = la pipeline non lo ha; un file illeggibile da' None ovunque, mai un default."""
    d = _carica_pipeline()
    if d is None:
        return {t: None for t in nomi}, None
    righe = {r.get("ticker"): r for r in (d.get("portfolio") or []) + (d.get("watchlist") or [])}
    return ({t: ((righe.get(t) or {}).get("combustione") or {}).get("fcf_ttm") for t in nomi},
            (d.get("macro") or {}).get("credit_ccc"))


def dipendenti_credito(titoli, tecnica, fcf, ccc):
    """Il CCC dice se il credito peggiore si chiude NEL MERCATO; questo blocco dice se la chiusura
    sta ARRIVANDO AL LIBRO (v467). Il gruppo e' chi ha flusso di cassa libero negativo, cioe' chi
    deve finanziarsi fuori: il registro si muove col libro, non e' un elenco di nomi (C10).
    ⚠ E' la STESSA famiglia del semaforo (credito): una conferma sul libro non e' un secondo
    segnale (B3). Cambia la PRIORITA' delle protezioni su quei nomi, non il colore.
    titoli: [{tk, peso, pnl_21}] · tecnica: [{tk, d50_atr}] · fcf: {tk: fcf o None} · ccc: macro.credit_ccc"""
    d50 = {x["tk"]: x.get("d50_atr") for x in tecnica}
    dip = [t for t in titoli if fcf.get(t["tk"]) is not None and fcf[t["tk"]] < 0]
    aut = [t for t in titoli if fcf.get(t["tk"]) is not None and fcf[t["tk"]] >= 0]
    ignoti = [t["tk"] for t in titoli if fcf.get(t["tk"]) is None]

    def rend(gr):
        # rendimento a 21 sedute del gruppo, pesato: P&L su valore iniziale (valore - P&L).
        # Un nome senza P&L a 21 sedute e' un buco, non uno zero (v205): esce dalla base.
        ok = [t for t in gr if t.get("pnl_21") is not None]
        if not ok:
            return None
        pnl = sum(t["pnl_21"] for t in ok)
        tot = sum(t["valore"] for t in ok)
        return pnl / (tot - pnl) if tot - pnl else None

    peso_dip = sum(t["peso"] for t in dip)
    misurati = [t for t in dip if d50.get(t["tk"]) is not None]
    sotto = [t for t in misurati if d50[t["tk"]] < 0]
    quota_sotto = (sum(t["peso"] for t in sotto) / sum(t["peso"] for t in misurati)) if misurati else None
    r_dip, r_aut = rend(dip), rend(aut)
    salita = (ccc or {}).get("salita_60_pp")
    cond = {"ccc": salita is not None and salita >= SOGLIA_CCC_PP,
            "sotto_media": quota_sotto is not None and quota_sotto > 0.5,
            "peggio": r_dip is not None and r_aut is not None and r_dip < r_aut}
    misurabile = salita is not None and quota_sotto is not None and r_dip is not None and r_aut is not None
    return {"dipendenti": [{"tk": t["tk"], "peso": t["peso"], "d50_atr": d50.get(t["tk"])} for t in dip],
            "peso_dipendenti": peso_dip, "ignoti": ignoti, "quota_sotto_50": quota_sotto,
            "ret21_dipendenti": r_dip, "ret21_autofinanziati": r_aut, "salita_ccc": salita,
            "condizioni": cond, "misurabile": misurabile,
            "arrivato_al_libro": misurabile and all(cond.values())}


def righe_credito(c):
    p = lambda x: "n.d." if x is None else f"{x*100:+.1f}%"
    if not c["dipendenti"]:
        L = ["CREDITO SUL LIBRO: nessuna posizione con flusso di cassa libero negativo"]
    else:
        L = [f"CREDITO SUL LIBRO — chi brucia cassa (flusso di cassa libero negativo, deve finanziarsi fuori): "
             f"{c['peso_dipendenti']*100:.1f}% dell'azionario · "
             + " · ".join(f"{d['tk']} {d['peso']*100:.1f}% ({'n.d.' if d['d50_atr'] is None else format(d['d50_atr'], '+.1f')} ATR dalla media 50)"
                          for d in c["dipendenti"]),
             f"  21 sedute: chi brucia cassa {p(c['ret21_dipendenti'])} · chi si autofinanzia {p(c['ret21_autofinanziati'])}"
             f" · peso sotto la propria media 50: {'n.d.' if c['quota_sotto_50'] is None else format(c['quota_sotto_50']*100, '.0f') + '%'}"
             f" · spread CCC {'n.d.' if c['salita_ccc'] is None else format(c['salita_ccc'], '+.2f') + ' pp dal minimo di 60 sedute'}"]
        if not c["misurabile"]:
            L.append("  conferma sul libro NON MISURABILE: manca uno dei tre ingressi (non vuol dire 'non arrivata')")
        else:
            si = [k for k, v in c["condizioni"].items() if v]
            L.append(f"  conferma sul libro (CCC in salita + oltre meta' del peso sotto la media 50 + rendimento peggiore "
                     f"di chi si autofinanzia): {'ACCESA' if c['arrivato_al_libro'] else 'spenta'} "
                     f"({len(si)} condizioni su 3: {', '.join(si) or 'nessuna'}) · stessa famiglia del CCC, non un secondo segnale")
    if c["ignoti"]:
        L.append(f"  senza flusso di cassa nella pipeline (fuori dal conto, non 'si autofinanzia'): {', '.join(c['ignoti'])}")
    return L


def righe_attesa(a):
    L = [f"COSTO DELL'ATTESA: seduta tipica ±{a['seduta_1s']:,.0f} $ · settimana tipica ±{a['settimana_1s']:,.0f} $"
         f" (seduta x radice di 5, convenzione) · seduta cattiva (VaR95) -{a['var_usd']:,.0f} $ · media delle peggiori (ES95) -{a['es_usd']:,.0f} $"]
    if a["scadenze"]:
        L.append("SCADENZE (prima trimestrale dichiarata dalla fonte): "
                 + " · ".join(f"{s['tk']} {s['data']} ({s['giorni']} g)" for s in a["scadenze"]))
    else:
        L.append(f"SCADENZE: nessuna trimestrale dichiarata dalla fonte nei prossimi {a['finestra']} giorni")
    if a["senza_data"]:
        L.append(f"  senza data nella finestra di {a['finestra']} giorni (la fonte non la dichiara, non 'nessuna uscita'): "
                 + ", ".join(a["senza_data"]))
    if a["giorni_non_letti"]:
        L.append(f"  ⚠ {len(a['giorni_non_letti'])} giorni del calendario NON letti: le scadenze possono essere incomplete")
    return L


# ════════════════════════════════════════════════════════════════ v474 — SEMAFORO CALCOLATO
# Decisione del CEO del 09/10/2026: il colore lo calcola lo script invece di leggerlo a mano da sei
# fonti. Le soglie sono quelle di LIBRO.md §1ter, CONVENZIONI scelte col CEO il 06/10/2026 e non
# dati (v240): stanno qui come numeri perche' il codice le confronta, e un gate verifica che
# coincidano con quelle scritte nel libro — una regola in due posti diverge al primo ritocco
# (v161, v207). La REAZIONE di ogni colore invece non sta qui: si legge dal libro (v436).
SOGLIA_HY = 3.5
SOGLIA_HY_ROSSO = 4.0
SOGLIA_T10 = 5.4
SOGLIA_VOL_ALTI = 50          # percentile dell'anno: la stessa soglia della conferma d'ingresso (v473)
LEADER = ("NVDA", "AMD", "MU")        # nominati dalla regola del CEO, non un registro di somiglianze
REVISIONI_AI = ("NVDA", "MU")
# Prezzo e Leader sono il prezzo che parla due volte (LIBRO.md §1ter, B3): per il colore contano UNA.
GRUPPI_COLORE = (("prezzo", ("prezzo", "leader")), ("credito", ("credito",)), ("tassi", ("tassi",)),
                 ("fondamentali AI", ("fondamentali",)), ("leva", ("leva",)))
COLORI = {"verde": "🟢", "giallo": "🟡", "arancione": "🟠", "rosso": "🔴"}
ARTICOLO = {"verde": "del verde", "giallo": "del giallo", "arancione": "dell'arancione", "rosso": "del rosso"}
MESI = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
        "settembre", "ottobre", "novembre", "dicembre")


def _it(x, d=2):
    """Convenzione del pacchetto: virgola decimale, punto per le migliaia (v442, v443)."""
    return "n.d." if x is None else f"{x:,.{d}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _sg(x, d=1):
    return "n.d." if x is None else ("+" if x > 0 else "") + _it(x, d)


def _conta(n, uno, molti):
    return f"{n} {uno if n == 1 else molti}"


def _mese(data):
    try:
        a, m = str(data).split("-")[:2]
        return f"{MESI[int(m) - 1]} {a}"
    except (ValueError, IndexError):
        return str(data or "n.d.")


def concluse(barre, adesso=None):
    """Le barre senza quella in formazione: il semaforo legge CHIUSURE, e a seduta aperta l'ultima
    barra non lo e' ancora (v471). La stessa funzione dei volumi, non una seconda (v161)."""
    import rotazione
    return barre[:-1] if rotazione.seduta_in_corso(barre, adesso) else barre


def famiglia_prezzo(smh, adesso=None):
    """SMH sotto la propria media a 50 (primo gradino) o a 200 (secondo, quello del rosso)."""
    import brief
    b = concluse(smh or [], adesso)
    if len(b) < 200:
        return {"stato": "non misurabile", "perche": f"SMH: {len(b)} sedute concluse, la media a 200 ne chiede 200"}
    c, m50, m200, atr = b[-1]["c"], brief.sma(b, 50), brief.sma(b, 200), brief.atr_wilder(b)
    sotto200 = c < m200
    return {"stato": "acceso" if (c < m50 or sotto200) else "spento", "sotto200": sotto200, "seduta": b[-1]["t"],
            "chiusura": c, "sma50": m50, "sma200": m200,
            "d50_atr": (c - m50) / atr if atr else None, "d200_atr": (c - m200) / atr if atr else None}


def famiglia_leader(barre, adesso=None):
    """NVDA, AMD e MU INSIEME sotto la propria media a 50, con volumi alti: volume della seduta oltre
    il 50o percentile dell'anno per tutti e tre (convenzione v474). Uno solo sopra la media basta a
    dirla spenta; un nome non misurato la rende non misurabile solo se gli altri sono tutti sotto."""
    import brief, rotazione
    righe = []
    for tk in LEADER:
        b = concluse(barre.get(tk) or [], adesso)
        if len(b) < 50:
            righe.append({"tk": tk, "misurato": False}); continue
        c, m50, atr = b[-1]["c"], brief.sma(b, 50), brief.atr_wilder(b)
        righe.append({"tk": tk, "misurato": True, "seduta": b[-1]["t"], "sotto": c < m50,
                      "d50_atr": (c - m50) / atr if atr else None,
                      "vol_pct": rotazione.volumi(barre.get(tk) or [], adesso).get("vol_pct_seduta")})
    mis = [r for r in righe if r["misurato"]]
    tutti_sotto = len(mis) == len(LEADER) and all(r["sotto"] for r in mis)
    if any(not r["sotto"] for r in mis):
        stato = "spento"
    elif not tutti_sotto or any(r["vol_pct"] is None for r in mis):
        stato = "non misurabile"
    else:
        stato = "acceso" if all(r["vol_pct"] > SOGLIA_VOL_ALTI for r in mis) else "spento"
    return {"stato": stato, "righe": righe, "tutti_sotto": tutti_sotto}


def famiglia_credito(ccc, hy):
    """Spread CCC salito di 1,5 punti o piu' sul minimo di 60 sedute, OPPURE HY OAS sopra 3,5; il
    secondo gradino (per il rosso) e' HY sopra 4,0. Se un dato manca e l'altro e' spento la famiglia
    e' NON MISURABILE: quello mancante potrebbe essere acceso, e 'spento' lo affermerebbe."""
    salita = (ccc or {}).get("salita_60_pp")
    v = (hy or {}).get("valore")
    acc_ccc = salita is not None and salita >= SOGLIA_CCC_PP
    acc_hy = v is not None and v > SOGLIA_HY
    stato = "acceso" if (acc_ccc or acc_hy) else ("non misurabile" if salita is None or v is None else "spento")
    return {"stato": stato, "ccc": ccc, "hy": hy, "ccc_acceso": acc_ccc, "hy_acceso": acc_hy,
            "rosso": v is not None and v > SOGLIA_HY_ROSSO}


def famiglia_tassi(t10):
    v = (t10 or {}).get("valore")
    return {"stato": "non misurabile" if v is None else ("acceso" if v > SOGLIA_T10 else "spento"), "t10": t10}


def famiglia_fondamentali(analisti):
    """Revisioni a 30 giorni su NVDA e MU: accesa se su ALMENO UNO dei due i tagli superano i rialzi
    (lettura della regola "su NVDA/MU"). La guida sugli investimenti degli hyperscaler non e' una
    serie: non e' calcolata, e la resa lo dice ogni volta."""
    righe = []
    for tk in REVISIONI_AI:
        a = (analisti or {}).get(tk) or {}
        su, giu = a.get("su_30g"), a.get("giu_30g")
        righe.append({"tk": tk, "su": su, "giu": giu, "misurato": su is not None and giu is not None})
    acc = any(r["misurato"] and r["giu"] > r["su"] for r in righe)
    return {"stato": "acceso" if acc else ("spento" if all(r["misurato"] for r in righe) else "non misurabile"),
            "righe": righe}


def famiglia_leva(md):
    """Margin debt FINRA: l'ultimo mese contro il precedente. ⚠ Il campo 'qoq' della pipeline e' la
    variazione MENSILE nonostante il nome (v326): qui si ricalcola dallo storico, che e' il dato."""
    h = (md or {}).get("history") or []
    if len(h) < 2 or not h[-2] or h[-1] is None:
        return {"stato": "non misurabile", "perche": "storico del margin debt assente o troppo corto"}
    var = h[-1] / h[-2] - 1
    return {"stato": "acceso" if var < 0 else "spento", "var_mese": var, "mese": (md or {}).get("date")}


def colore_semaforo(fam):
    """Il colore dalle famiglie (LIBRO.md §1ter): nessuna accesa verde, una gialla, due di famiglie
    DIVERSE arancione — prezzo e leader contano come una (B3). Rosso: SMH sotto la 200 E (HY sopra
    4,0 OPPURE taglio della guida capex, che lo script non vede). Con una famiglia non misurabile il
    colore e' un MINIMO: il dato mancante puo' alzarlo, mai abbassarlo."""
    accesi, ignoti = [], []
    for nome, membri in GRUPPI_COLORE:
        st = [fam[m]["stato"] for m in membri]
        if "acceso" in st:
            accesi.append(nome)
        elif "non misurabile" in st:
            ignoti.append(nome)
    colore = "verde" if not accesi else ("giallo" if len(accesi) == 1 else "arancione")
    sotto200 = bool(fam["prezzo"].get("sotto200"))
    if sotto200 and fam["credito"].get("rosso"):
        colore = "rosso"
    return {"colore": colore, "accesi": accesi, "non_misurabili": ignoti, "minimo": bool(ignoti),
            "rosso_possibile": sotto200 and colore != "rosso"}


def segnali_pipeline(d):
    """Gli ingressi del semaforo che vengono dalla pipeline, ciascuno con la SUA data (v431)."""
    if not d:
        return {"ccc": None, "hy": None, "t10": None, "analisti": {}, "margin": None}
    m = d.get("macro") or {}
    cr = m.get("credit") or {}
    a10 = next((s for s in ((m.get("tassi") or {}).get("scadenze") or []) if s.get("key") == "a10"), None)
    righe = {r.get("ticker"): r for r in (d.get("portfolio") or []) + (d.get("watchlist") or []) if isinstance(r, dict)}
    return {"ccc": m.get("credit_ccc"),
            "hy": {"valore": cr["spread_hy"], "data": cr.get("date")} if cr.get("spread_hy") is not None else None,
            "t10": ({"valore": a10["value"], "data": a10.get("observation_date")}
                    if a10 and a10.get("value") is not None else None),
            "analisti": {tk: (righe.get(tk) or {}).get("analisti") for tk in REVISIONI_AI},
            "margin": m.get("margin_debt")}


def semaforo(smh, leader, seg, adesso=None):
    fam = {"prezzo": famiglia_prezzo(smh, adesso), "leader": famiglia_leader(leader or {}, adesso),
           "credito": famiglia_credito(seg.get("ccc"), seg.get("hy")), "tassi": famiglia_tassi(seg.get("t10")),
           "fondamentali": famiglia_fondamentali(seg.get("analisti")), "leva": famiglia_leva(seg.get("margin"))}
    return {"famiglie": fam, "seduta": fam["prezzo"].get("seduta"), **colore_semaforo(fam)}


def testo_libro():
    import brief
    try:
        return (Path(brief.RADICE) / "memoria" / "LIBRO.md").read_text(encoding="utf-8")
    except OSError:
        return ""


def reazioni_libro(testo):
    """La reazione di ogni colore, da LIBRO.md §1ter parola per parola: le regole stanno in un posto
    solo (v436). Un colore che manca resta fuori dal dizionario, e la resa lo dichiara."""
    i = testo.find("## 1ter")
    if i < 0:
        return {}
    j = testo.find("\n## ", i + 1)
    out, chiave = {}, None
    for riga in testo[i:j if j > 0 else len(testo)].splitlines():
        m = re.match(r"- (?:🟢|🟡|🟠|🔴) \*\*(\w+)\*\*\s*—\s*(.*)", riga)
        if m:
            chiave = m.group(1).lower()
            out[chiave] = m.group(2).strip()
        elif chiave and riga.startswith("  ") and riga.strip():
            out[chiave] += " " + riga.strip()
        else:
            chiave = None
    return {k: v.replace("**", "") for k, v in out.items()}


def righe_semaforo(s, precedente=None, mcr=None):
    f = s["famiglie"]
    st = lambda x: {"acceso": "ACCESO", "spento": "spento", "non misurabile": "NON MISURABILE"}[x["stato"]]
    L = [f"SEMAFORO D'USCITA — {COLORI[s['colore']]} {s['colore'].upper()}"
         + (" (MINIMO)" if s["minimo"] else "")
         + f" · famiglie accese: {', '.join(s['accesi']) or 'nessuna'} ({len(s['accesi'])} su {len(GRUPPI_COLORE)} per il colore:"
         + " prezzo e leader contano come una, B3)"
         + f" · ultima chiusura {s.get('seduta') or 'n.d.'} · soglie = convenzioni scelte col CEO (LIBRO.md §1ter)"]
    p = f["prezzo"]
    if p["stato"] == "non misurabile":
        L.append(f"  prezzo: NON MISURABILE — {p['perche']}")
    else:
        L.append(f"  prezzo: SMH chiusura {_it(p['chiusura'])} · media 50 {_it(p['sma50'])} ({_sg(p['d50_atr'])} ATR) · "
                 f"media 200 {_it(p['sma200'])} ({_sg(p['d200_atr'])} ATR) — {st(p)}"
                 + (" · SOTTO LA MEDIA A 200, il gradino del rosso" if p.get("sotto200") else ""))
    ld = f["leader"]
    parti = [(f"{r['tk']} {_sg(r['d50_atr'])} ATR dalla media 50, volume "
              + ("n.d." if r["vol_pct"] is None else f"{r['vol_pct']:.0f}/100")) if r["misurato"] else f"{r['tk']} n.d."
             for r in ld["righe"]]
    L.append(f"  leader: {' · '.join(parti)} — {st(ld)}"
             + (" · tutti e tre sotto la media 50 ma i volumi non sono tutti oltre il 50° percentile: in osservazione"
                if ld["tutti_sotto"] and ld["stato"] == "spento" else "")
             + " · conta col prezzo: stessa famiglia (B3)")
    c = f["credito"]
    ccc, hy = c["ccc"] or {}, c["hy"] or {}
    L.append("  credito: "
             + (f"spread CCC {_it(ccc.get('valore'))}% del {ccc.get('data') or 'n.d.'}, {_sg(ccc['salita_60_pp'], 2)} punti "
                f"dal minimo di 60 sedute (soglia +1,5)" if ccc.get("salita_60_pp") is not None else "spread CCC n.d.")
             + (f" · HY OAS {_it(hy['valore'])}% del {hy.get('data') or 'n.d.'} (soglie 3,5 e 4,0)"
                if hy.get("valore") is not None else " · HY OAS n.d.") + f" — {st(c)}")
    tv = f["tassi"]["t10"] or {}
    L.append(f"  tassi: Treasury 10 anni {_it(tv.get('valore'))}% del {tv.get('data') or 'n.d.'} (soglia 5,4) — {st(f['tassi'])}")
    fo = f["fondamentali"]
    rev = " · ".join(f"{r['tk']} {r['su']} su, {r['giu']} giù" if r["misurato"] else f"{r['tk']} n.d." for r in fo["righe"])
    L.append(f"  fondamentali AI: revisioni a 30 giorni {rev} — {st(fo)} · la guida sugli investimenti degli "
             "hyperscaler NON è calcolata: va verificata in rete, e se un hyperscaler l'ha tagliata la famiglia è accesa")
    lv = f["leva"]
    L.append(f"  leva: margin debt FINRA di {_mese(lv['mese'])} {_sg(lv['var_mese'] * 100)}% sul mese precedente — {st(lv)}"
             if lv["stato"] != "non misurabile" else f"  leva: NON MISURABILE — {lv['perche']}")
    if s["rosso_possibile"]:
        L.append("  ⚠ SMH sotto la media a 200: il rosso scatta col credito sopra 4,0 OPPURE con un taglio della guida "
                 "sugli investimenti AI, che lo script non vede — va verificato in rete prima di tutto il resto")
    if s["non_misurabili"]:
        L.append(f"  ⚠ colore MINIMO: {', '.join(s['non_misurabili'])} non misurabile — col dato che manca il colore "
                 "potrebbe salire, mai scendere")
    if precedente is None:
        L.append("  colore della seduta precedente: n.d. — il registro della performance non ha ancora una riga prima di questa")
    elif precedente["colore"] == s["colore"]:
        L.append(f"  colore della seduta precedente nel registro ({precedente['seduta']}): {precedente['colore']} → invariato")
    else:
        L.append(f"  ⚠⚠ COLORE CAMBIATO: da {precedente['colore']} ({precedente['seduta']}) a {s['colore']} — "
                 "va in cima alla risposta, prima di tutto il resto")
    reaz = (s.get("reazioni") or {}).get(s["colore"])
    L.append(f"  reazione {ARTICOLO[s['colore']]} (LIBRO.md §1ter, parola per parola): «{reaz}»" if reaz else
             f"  ⚠ reazione {ARTICOLO[s['colore']]} NON letta da LIBRO.md §1ter: la regola va riletta a mano")
    if s["colore"] in ("arancione", "rosso") and mcr:
        L.append("  chi pesa di più nel rischio oggi (contributo di Euler; il settore non è nei dati): "
                 + " · ".join(f"{t} {_it(v * 100, 1)}%" for t, v in sorted(mcr.items(), key=lambda x: -x[1])[:4]))
    return L


# ════════════════════════════════════════════════════════════════ v474 — DECISIONI APERTE
UNITA_AZIONI = 10     # quantita' da decidere: il conto si fa per 10 azioni, unita' di calcolo e non consiglio
VERSI = {"vendita": ("uscita", "alleggerimento", "vendita", "riduzione"),
         "acquisto": ("ingresso", "acquisto", "incremento", "rinforzo")}


def _num_it(s):
    s = (s or "").replace("*", "").strip()
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def leggi_decisioni(testo=None):
    """La tabella DECISIONI APERTE di LIBRO.md (§1quinquies). None = sezione ASSENTE, che si legge
    diverso da 'nessuna decisione' (v389, v406). Si legge solo dentro il proprio titolo (v454)."""
    if testo is None:
        testo = testo_libro()
    out, sez, trovata = [], False, False
    for riga in testo.splitlines():
        if riga.startswith("## "):
            sez = "DECISIONI APERTE" in riga.upper()
            trovata = trovata or sez
            continue
        if not sez or not riga.startswith("|"):
            continue
        celle = [x.strip() for x in riga.strip().strip("|").split("|")]
        if len(celle) < 7 or celle[0] in ("Nome", "") or set(celle[0]) <= set("-: "):
            continue
        tk, dec, q, cond, liv, conf, stato = celle[:7]
        da_decidere = q.lower().startswith("da decidere")
        qta = None if da_decidere else _num_it(q)
        out.append({"tk": tk.upper(), "decisione": dec, "condizione": cond, "livello": _num_it(liv),
                    "verso": next((v for v, parole in VERSI.items() if dec.lower().startswith(parole)), None),
                    "qta": qta, "qta_testo": q, "qta_illeggibile": qta is None and not da_decidere,
                    "confermata": conf, "stato": stato, "aperta": stato.lower().startswith("aperta")})
    return out if trovata else None


def costo_decisioni(decisioni, barre, prezzi, calendario, adesso=None):
    """Per ogni decisione APERTA: il prezzo di conferma (la chiusura del giorno della conferma, dalle
    barre: non scritto a mano, v410), il prezzo di adesso, l'effetto dell'attesa, le sedute trascorse,
    la scadenza (prima trimestrale dichiarata dalla fonte, v396) e se la condizione vale ancora.
    Effetto: per una vendita qta x (adesso - conferma), per un acquisto qta x (conferma - adesso);
    positivo = l'attesa ha fatto guadagnare, negativo = e' costata. Un conto a posteriori."""
    prime = {}
    for e in (calendario or {}).get("attesi") or []:
        prime.setdefault(e["tk"], e)
    out = []
    for d in decisioni or []:
        if not d["aperta"]:
            continue
        b = concluse(barre.get(d["tk"]) or [], adesso)
        conf = next((x["c"] for x in b if x["t"] == d["confermata"]), None)
        px = prezzi.get(d["tk"])
        q, per_unita = (d["qta"], False) if d["qta"] is not None else (UNITA_AZIONI, True)
        eff = None
        if conf is not None and px is not None and d["verso"]:
            eff = q * ((px - conf) if d["verso"] == "vendita" else (conf - px))
        cond, liv = d["condizione"].lower(), d["livello"]
        vale = None
        if px is not None and liv is not None:
            vale = (px < liv) if "sotto" in cond else ((px > liv) if "sopra" in cond else None)
        out.append({**d, "conferma_px": conf, "px": px, "qta_conto": q, "per_unita": per_unita, "effetto": eff,
                    "prezzo_pct": (px / conf - 1) * 100 if (conf and px) else None,
                    "sedute": sum(1 for x in b if x["t"] > d["confermata"]),
                    "scadenza": prime.get(d["tk"]), "vale_ancora": vale})
    return out


def righe_decisioni(dd, finestra=45):
    if dd is None:
        return ["DECISIONI APERTE: sezione NON trovata in LIBRO.md — non vuol dire 'nessuna decisione aperta'"]
    if not dd:
        return ["DECISIONI APERTE: nessuna in LIBRO.md §1quinquies"]
    L = ["DECISIONI APERTE (LIBRO.md §1quinquies, confermate e non eseguite) · effetto dell'attesa per una vendita = "
         "quantità × (prezzo di adesso − chiusura del giorno della conferma): un conto a posteriori, non un giudizio"]
    for x in dd:
        if x["per_unita"]:
            qt = (f"quantità ILLEGGIBILE in LIBRO.md («{x['qta_testo']}»)" if x["qta_illeggibile"] else
                  f"quantità {x['qta_testo']}") + f": conto per {UNITA_AZIONI} azioni (unità di calcolo, non una quantità consigliata)"
        else:
            qt = f"{_it(x['qta'], 0)} azioni"
        vale = {True: "VALE ANCORA", False: "RIENTRATA — la decisione resta presa, la premessa va ridiscussa",
                None: "non valutabile"}[x["vale_ancora"]]
        cond = f"«{x['condizione']} {_it(x['livello'])}»: adesso {_it(x['px'])}, {vale}"
        if not x["verso"]:
            eff = f"verso della decisione non riconosciuto («{x['decisione']}»): effetto n.d."
        elif x["conferma_px"] is None:
            eff = f"chiusura del {x['confermata']} NON trovata nelle barre: effetto n.d."
        elif x["effetto"] is None:
            eff = "prezzo di adesso mancante: effetto n.d."
        else:
            e = x["effetto"]
            eff = ((f"l'attesa è COSTATA {_it(-e, 0)} $" if e < 0 else
                    f"l'attesa ha FATTO GUADAGNARE {_it(e, 0)} $" if e > 0 else "effetto nullo")
                   + f" finora (prezzo {_sg(x['prezzo_pct'])}% dalla conferma)")
        sc = x["scadenza"]
        scad = (f"scadenza: trimestrale {sc['data']} ({sc['giorni']} g)" if sc else
                f"scadenza: nessuna trimestrale dichiarata dalla fonte nei {finestra} giorni (non 'nessuna uscita')")
        L.append(f"  {x['tk']} {x['decisione']}, {qt} · condizione {cond} · confermata il {x['confermata']}"
                 + (f" a {_it(x['conferma_px'])}" if x["conferma_px"] is not None else "")
                 + f" · {eff} · {x['sedute']} {'seduta conclusa' if x['sedute'] == 1 else 'sedute concluse'} dalla conferma"
                 + f" · {scad}")
    return L


# ════════════════════════════════════════════════════════════════ v474 — REGISTRO DELLA PERFORMANCE
# Il riferimento e' QQQ, scelto dal CEO il 09/10/2026 (LIBRO.md §0). Una riga per seduta CONCLUSA:
# posizioni, chiusure, QQQ, cambio, liquidita' e obbligazioni di quel giorno. Il rendimento e'
# ponderato per il tempo (TWR): ogni intervallo si calcola con le posizioni registrate al suo
# INIZIO, quindi vendite, acquisti e depositi non falsano il confronto con l'indice.
REGISTRO = Path(__file__).resolve().parent.parent / "memoria" / "registro_performance.jsonl"


def leggi_registro(percorso=None):
    """(righe in ordine di seduta, righe illeggibili). Una riga illeggibile si CONTA e si dichiara:
    toglierla in silenzio cambierebbe il rendimento senza dirlo."""
    p = Path(percorso or REGISTRO)
    if not p.exists():
        return [], 0
    righe, rotte = [], 0
    for testo in p.read_text(encoding="utf-8").splitlines():
        if not testo.strip():
            continue
        try:
            r = json.loads(testo)
        except ValueError:
            rotte += 1; continue
        if isinstance(r, dict) and r.get("seduta") and isinstance(r.get("prezzi"), dict):
            righe.append(r)
        else:
            rotte += 1
    return sorted(righe, key=lambda r: r["seduta"]), rotte


def patrimonio_pipeline(d, eur_pmc):
    """(cambio EUR/USD, sua fonte, {obbligazione: (prezzo, fonte)}) dalla pipeline. Senza la riga
    della pipeline l'obbligazione resta AL CARICO, dichiarato: farla sparire rimpicciolirebbe il
    patrimonio e gonfierebbe ogni percentuale (v439)."""
    fx, fonte = None, None
    if d:
        e = next((x for x in ((d.get("macro") or {}).get("markets") or []) if x.get("key") == "EURUSD=X"), None)
        try:
            fx = float(e["value"]) if e else None
        except (TypeError, ValueError, KeyError):
            fx = None
        if fx:
            fonte = f"pipeline, run {d.get('updated_at') or 'n.d.'}"
    righe = {r.get("ticker"): r for r in ((d or {}).get("portfolio") or []) if isinstance(r, dict)}
    prezzi = {}
    for tk, pmc in (eur_pmc or {}).items():
        p = (righe.get(tk) or {}).get("price")
        prezzi[tk] = (float(p), "pipeline") if isinstance(p, (int, float)) else (pmc, "carico: la pipeline non ha il prezzo")
    return fx, fonte, prezzi


def patrimonio_eur(valore_az_usd, fx, cassa_eur, obbligazioni):
    """Azionario in euro + liquidita' + obbligazioni (nominale x prezzo / 100). Senza cambio None:
    un patrimonio con l'azionario in dollari sommato agli euro e' la classe v432."""
    if not fx:
        return None
    obb = sum(n * p / 100 for n, p in obbligazioni)
    az = valore_az_usd / fx
    return {"azionario": az, "liquidita": cassa_eur or 0.0, "obbligazioni": obb,
            "totale": az + (cassa_eur or 0.0) + obb}


def nuova_riga(seduta, az, obb, barre, cassa_eur, pat, colore, precedente=None, adesso=None):
    """La riga della seduta CONCLUSA `seduta`. az {tk: quantita'} in dollari, obb {tk: nominale} in
    euro, pat = patrimonio_pipeline(). I prezzi si salvano per le posizioni di oggi E per quelle della
    riga precedente: l'intervallo che finisce qui si calcola con le posizioni di allora (TWR)."""
    fx, fonte_fx, prezzi_eur = pat
    chiusura = lambda tk: next((x["c"] for x in (barre.get(tk) or []) if x["t"] == seduta), None)
    nomi = sorted(set(az) | set((precedente or {}).get("posizioni") or {}))
    nomi_obb = sorted(set(obb) | set((precedente or {}).get("obbligazioni") or {}))
    return {"seduta": seduta, "scritto": (adesso or datetime.now(timezone.utc)).astimezone(timezone.utc)
            .isoformat(timespec="seconds"), "posizioni": dict(az), "prezzi": {tk: chiusura(tk) for tk in nomi},
            "obbligazioni": dict(obb),
            "prezzi_obbligazioni": {tk: {"prezzo": (prezzi_eur.get(tk) or (None, None))[0],
                                         "fonte": (prezzi_eur.get(tk) or (None, "n.d."))[1]} for tk in nomi_obb},
            "qqq": chiusura("QQQ"), "eurusd": fx, "fonte_cambio": fonte_fx, "cassa_eur": cassa_eur,
            "semaforo": colore, "versione": 474}


def registra(riga, percorso=None, adesso=None):
    """Appende la riga se la sua seduta non c'e' gia' e non e' piu' vecchia dell'ultima. MAI durante
    la seduta: LIBRO.md puo' gia' contenere le operazioni di oggi, e la riga di ieri scritta con le
    posizioni di oggi sarebbe falsa. (scritta, perche')."""
    import analisi
    if analisi.fase(adesso) == "seduta":
        return False, "seduta in corso a New York: il registro si scrive a mercato chiuso"
    righe, _ = leggi_registro(percorso)
    if any(r["seduta"] == riga["seduta"] for r in righe):
        return False, f"seduta {riga['seduta']} già registrata"
    if righe and righe[-1]["seduta"] > riga["seduta"]:
        return False, f"il registro arriva già al {righe[-1]['seduta']}, oltre la seduta {riga['seduta']} dei prezzi letti"
    if not riga.get("qqq"):
        return False, f"chiusura di QQQ del {riga['seduta']} mancante: senza il riferimento la riga non serve"
    p = Path(percorso or REGISTRO)
    with open(p, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(riga, ensure_ascii=False, sort_keys=True) + "\n")
    return True, f"seduta {riga['seduta']} registrata"


def intervallo(a, b):
    """Il rendimento fra due righe con le posizioni di A. (rendimenti, None) oppure (None, perche'):
    se manca un prezzo l'intervallo si salta per il libro E per QQQ, cosi' il confronto resta sugli
    stessi giorni. Il patrimonio in euro esce solo se c'e' il cambio a entrambi i capi."""
    pos = a.get("posizioni") or {}
    manca = [tk for tk in pos if a["prezzi"].get(tk) is None or b["prezzi"].get(tk) is None]
    if not a.get("qqq") or not b.get("qqq"):
        manca.append("QQQ")
    if manca or not pos:
        return None, ("manca il prezzo di " + ", ".join(manca)) if manca else "nessuna posizione all'inizio"
    v0 = sum(q * a["prezzi"][tk] for tk, q in pos.items())
    v1 = sum(q * b["prezzi"][tk] for tk, q in pos.items())
    r = {"libro": v1 / v0 - 1, "qqq": b["qqq"] / a["qqq"] - 1, "patrimonio": None, "qqq_eur": None}
    obb = a.get("obbligazioni") or {}
    pa = {tk: (a.get("prezzi_obbligazioni") or {}).get(tk, {}).get("prezzo") for tk in obb}
    pb = {tk: (b.get("prezzi_obbligazioni") or {}).get(tk, {}).get("prezzo") for tk in obb}
    if a.get("eurusd") and b.get("eurusd") and None not in pa.values() and None not in pb.values():
        p0 = patrimonio_eur(v0, a["eurusd"], a.get("cassa_eur"), [(obb[t], pa[t]) for t in obb])["totale"]
        p1 = patrimonio_eur(v1, b["eurusd"], a.get("cassa_eur"), [(obb[t], pb[t]) for t in obb])["totale"]
        r["patrimonio"] = p1 / p0 - 1
        r["qqq_eur"] = (b["qqq"] / b["eurusd"]) / (a["qqq"] / a["eurusd"]) - 1
    return r, None


def twr(righe):
    """Rendimento ponderato per il tempo, catenato riga per riga, del libro e di QQQ sugli STESSI
    intervalli; idem patrimonio e QQQ in euro. Gli intervalli saltati si NOMINANO."""
    cat = {"libro": 1.0, "qqq": 1.0, "patrimonio": 1.0, "qqq_eur": 1.0}
    n_l = n_p = 0
    saltati, ultimo = [], None
    for a, b in zip(righe, righe[1:]):
        r, perche = intervallo(a, b)
        if r is None:
            saltati.append(f"{a['seduta']}→{b['seduta']}: {perche}"); continue
        cat["libro"] *= 1 + r["libro"]; cat["qqq"] *= 1 + r["qqq"]; n_l += 1
        if r["patrimonio"] is not None:
            cat["patrimonio"] *= 1 + r["patrimonio"]; cat["qqq_eur"] *= 1 + r["qqq_eur"]; n_p += 1
        ultimo = {**r, "da": a["seduta"], "a": b["seduta"]}
    return {"righe": len(righe), "dal": righe[0]["seduta"] if righe else None, "al": righe[-1]["seduta"] if righe else None,
            "libro": cat["libro"] - 1 if n_l else None, "qqq": cat["qqq"] - 1 if n_l else None, "intervalli": n_l,
            "patrimonio": cat["patrimonio"] - 1 if n_p else None, "qqq_eur": cat["qqq_eur"] - 1 if n_p else None,
            "intervalli_patrimonio": n_p, "saltati": saltati, "ultimo": ultimo}


def aggiorna_registro(barre, az, obb, cassa_eur, pat, colore, scrivi, adesso=None, percorso=None):
    """Legge il registro, scrive la riga della seduta conclusa se richiesto, e restituisce il confronto."""
    righe, rotte = leggi_registro(percorso)
    esito = None
    if scrivi:
        conc = concluse(barre.get("QQQ") or [], adesso)
        if not conc:
            esito = "non scritto: barre di QQQ assenti"
        else:
            riga = nuova_riga(conc[-1]["t"], az, obb, barre, cassa_eur, pat, colore, righe[-1] if righe else None, adesso)
            ok, perche = registra(riga, percorso, adesso)
            esito = ("scritto: " if ok else "non scritto: ") + perche
            if ok:
                righe, rotte = leggi_registro(percorso)
    return {"twr": twr(righe), "esito": esito, "rotte": rotte,
            "ultime": [{"seduta": r["seduta"], "semaforo": r.get("semaforo")} for r in righe[-5:]]}


def precedente_semaforo(reg, seduta):
    """Il colore dell'ultima riga del registro PRIMA della seduta di oggi."""
    prima = [r for r in (reg or {}).get("ultime") or [] if seduta and r["seduta"] < seduta and r.get("semaforo")]
    return {"seduta": prima[-1]["seduta"], "colore": prima[-1]["semaforo"]} if prima else None


def righe_registro(reg):
    t = reg["twr"]
    if not t["righe"]:
        L = ["REGISTRO DELLA PERFORMANCE contro QQQ: vuoto — la prima riga si scrive a mercato chiuso "
             "(numeri_libro.py --registra, che scripts/analisi.py passa da solo)"]
    elif t["righe"] == 1:
        L = [f"REGISTRO DELLA PERFORMANCE contro QQQ: avviato con la seduta del {t['dal']} — il primo confronto "
             "esce con la riga della seduta successiva"]
    else:
        L = [f"REGISTRO DELLA PERFORMANCE contro QQQ (riferimento scelto dal CEO, LIBRO.md §0) — dal {t['dal']} al "
             f"{t['al']}, {_conta(t['intervalli'], 'intervallo', 'intervalli')}, rendimento ponderato per il tempo"]
        if t["libro"] is not None:
            L.append(f"  libro azionario in dollari {_sg(t['libro'] * 100, 2)}% · QQQ {_sg(t['qqq'] * 100, 2)}% · "
                     f"differenza {_sg((t['libro'] - t['qqq']) * 100, 2)} punti")
        if t["patrimonio"] is not None:
            L.append(f"  patrimonio intero in euro (liquidità e BTP compresi) {_sg(t['patrimonio'] * 100, 2)}% · QQQ in "
                     f"euro {_sg(t['qqq_eur'] * 100, 2)}% · differenza {_sg((t['patrimonio'] - t['qqq_eur']) * 100, 2)} punti"
                     f" ({_conta(t['intervalli_patrimonio'], 'intervallo', 'intervalli')})")
        else:
            L.append("  patrimonio in euro: n.d. — in nessun intervallo c'è il cambio (o il prezzo del BTP) a entrambi i capi")
        u = t["ultimo"]
        if u:
            L.append(f"  ultimo intervallo {u['da']} → {u['a']}: libro {_sg(u['libro'] * 100, 2)}% · QQQ {_sg(u['qqq'] * 100, 2)}%")
        if t["saltati"]:
            L.append(f"  ⚠ {_conta(len(t['saltati']), 'intervallo saltato', 'intervalli saltati')} per il libro E per QQQ (stessi giorni da entrambi i lati): "
                     + "; ".join(t["saltati"]))
        L.append("  ⚠ ogni intervallo usa le posizioni registrate al suo inizio: le operazioni non falsano il confronto · "
                 "dividendi esclusi da entrambi i lati · liquidità contata in euro e costante fra due righe")
    if reg.get("esito"):
        L.append(f"  registro: {reg['esito']}")
    if reg.get("rotte"):
        L.append(f"  ⚠ {_conta(reg['rotte'], 'riga del registro illeggibile', 'righe del registro illeggibili')}: "
                 "escluse dal conto, e lo si dice")
    return L


def sintesi(o):
    """Righe compatte per la chat: numeri, non frasi di giudizio."""
    r, b = o["rischio"], o["bench"]
    p = lambda x, d=2: "n.d." if x is None else f"{x*100:+.{d}f}%"
    # v474 — il semaforo per primo: e' la sezione 0 della risposta (FORMATO_ANALISI.md)
    L = (righe_semaforo(o["semaforo"], precedente_semaforo(o.get("registro"), o["semaforo"].get("seduta")), r["mcr"])
         if o.get("semaforo") else [])
    L += [f"Periodo {o['inizio']} -> {o['fine']} ({o['sedute']} sedute) · azionario {o['tot_usd']:,.0f} $",
         f"Libro {p(o['ret_libro'])} ({o['pnl_libro']:+,.0f} $) · QQQ {p(b['QQQ'])} · SMH {p(b['SMH'])} · SPY {p(b['SPY'])} · RSP {p(b['RSP'])}",
         f"21 sedute: libro {p(o['ret_21'],1)} · SMH {p(o['bench_21']['SMH'],1)} · QQQ {p(o['bench_21']['QQQ'],1)}"]
    if o.get("registro"):
        L.extend(righe_registro(o["registro"]))
    L += [f"Vol {r['vol_ann']*100:.1f}% · VaR95 {r['var95']*100:.2f}% · ES95 {r['es95']*100:.2f}% · scommesse eff. {r['scommesse_eff']:.2f}"
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
    if o.get("attesa"):
        L.extend(righe_attesa(o["attesa"]))
    if "decisioni" in o:
        L.extend(righe_decisioni(o["decisioni"], (o.get("calendario") or {}).get("finestra") or 45))
    if o.get("credito"):
        L.extend(righe_credito(o["credito"]))
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
    ap.add_argument("--registra", action="store_true",
                    help="scrive la riga della seduta conclusa nel registro della performance (mai durante la seduta)")
    a = ap.parse_args()
    if a.esteso:
        print(esteso()); sys.exit(0)
    o = calcola(a.sedute, registra=a.registra)
    if a.json:
        Path(a.json).write_text(json.dumps(o, default=str, indent=1))
    print(sintesi(o))
