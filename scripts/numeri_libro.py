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

v484 (decisioni del CEO del 14/10/2026, sera) — tre blocchi nuovi, anche questi CALCOLATI qui:
  SALVAVITA           il calo dell'azionario dal suo massimo sul rendimento ponderato per il tempo del
                      registro; a -30% scatta il gradino di riduzione, qualunque sia il colore;
  PIANO DI RIDUZIONE  il gradino del salvavita calcolato PRIMA: un terzo dei semiconduttori del
                      libro, in proporzione al rischio di ciascuno — azioni intere, imposta, rischio
                      in dollari prima e dopo;
  SCADENZE            ogni CONFLITTO con i suoi conti successivi e l'esame scritto prima (§1quinquies).

v486 (decisione del CEO del 15/10/2026, «non vendi sui ribassi ma sui massimi») — al primo arancione
il gradino non e' stato eseguito e la regola e' cambiata: arancione e rosso restano COLORI (un segnale,
e una prova CONTRO nella tenuta) ma non vendono piu'. Il piano si esegue solo col salvavita scattato.
"""
import argparse, json, math, re, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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
    ordini = leggi_ordini()               # v489 — gli ordini con limite aperti (LIBRO.md §1septies)
    reg_righe, _ = leggi_registro()
    aperte = [d["tk"] for d in (decisioni or []) if d["aperta"]]
    in_ordine = list(dict.fromkeys(o["tk"] for o in (ordini or []) if o["attivo"]))
    extra = sorted((set(aperte) | set(in_ordine) | set(LEADER)
                    | set((reg_righe[-1].get("posizioni") or {}) if reg_righe else ())) - set(TK) - set(FATTORI))
    with ThreadPoolExecutor(6) as ex:
        B = dict(zip(TK + FATTORI, ex.map(brief.barre, TK + FATTORI)))
        B.update(zip(extra, ex.map(_barre_o_vuoto, extra)))
        TEC = dict(zip(TK, ex.map(brief.tecnica, TK)))
        fuori = [t for t in dict.fromkeys(aperte + in_ordine) if t not in TK]
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
    # v481-v482 — la tenuta di ogni posizione (LIBRO.md §1sexies): la stessa funzione dei sorvegliati, e
    #   per le posizioni in perdita l'aritmetica della media con le funzioni degli ingressi (v161)
    import rotazione
    eur = {p["tk"]: p for p in pos if p["valuta"] == "EUR"}
    pat_pipe = patrimonio_pipeline(pipe, {t: p["pmc"] for t, p in eur.items()})
    prima_trim = {}
    for a in out["calendario"].get("attesi") or []:
        prima_trim.setdefault(a["tk"], a.get("giorni"))       # gli attesi arrivano gia' in ordine di data
    media = {"fx": pat_pipe[0], "valore": tot, "trim": prima_trim,
             "rlibro": rotazione.serie_libro({t: B[t] for t in TK if B.get(t)}, qty),
             "rqqq": rotazione.rendimenti_per_data(B["QQQ"]),
             "rend": {t: rotazione.rendimenti_per_data(B[t]) for t in TK if B.get(t)}}
    # v489 — i pavimenti delle posizioni (la media sui pavimenti) e dei nomi con un ordine aperto, sullo
    #   storico di cinque anni e sul prezzo di adesso, come quelli dei sorvegliati (rotazione.py)
    con_pav = list(dict.fromkeys(TK + in_ordine))
    with ThreadPoolExecutor(6) as ex:
        BL = dict(zip(con_pav, ex.map(rotazione.barre_lunghe, con_pav)))
    pav = {t: rotazione.pavimenti(BL.get(t), (TEC.get(t) or {}).get("px"), (TEC.get(t) or {}).get("atr"), adesso)
           for t in TK}
    out["tenuta"] = tenuta_posizioni(TK, B, righe_pipeline(pipe), out["semaforo"], px, pmc, qty, w, adesso,
                                     decisioni, media, pav)
    out["ordini"] = valuta_ordini(ordini, B, TEC, BL, out["calendario"], righe_pipeline(pipe), out["semaforo"],
                                  media["rlibro"], media["rqqq"], tot, media["fx"], adesso, cassa_eur=cassa_eur)
    out["rimandate"] = leggi_rimandate()          # v483 — le decisioni che aspettano un evento
    # v484 — ogni CONFLITTO con la sua scadenza (i conti successivi) e l'esame scritto prima (LIBRO.md §1sexies)
    scad = {}
    for a in out["calendario"].get("attesi") or []:
        scad.setdefault(a["tk"], a)                       # gli attesi arrivano gia' in ordine di data
    out["esami"] = leggi_esami()
    out["tenuta"] = con_scadenze(out["tenuta"], scad, out["esami"], out["calendario"].get("finestra"), adesso)
    out["decisioni"] = (None if decisioni is None else
                        costo_decisioni(decisioni, B, {t: (TEC.get(t) or {}).get("px") for t in aperte},
                                        out["calendario"], adesso))
    out["registro"] = aggiorna_registro(B, {p["tk"]: p["qta"] for p in az}, {t: p["qta"] for t, p in eur.items()},
                                        cassa_eur, pat_pipe, out["semaforo"]["colore"], registra, adesso)
    # v484 — il gradino di riduzione calcolato PRIMA, e il salvavita sul registro (con la seduta conclusa non
    #   ancora registrata, costruita come una riga vera e non scritta)
    out["piano"] = piano_riduzione(semiconduttori_libro(), val, qty, px, pmc, ris["mcr"], R, lunghi)
    reg_ora, _ = leggi_registro()
    conc = concluse(B.get("QQQ") or [], adesso)
    out["salvavita"] = salvavita(reg_ora, nuova_riga(conc[-1]["t"], qty, {t: p["qta"] for t, p in eur.items()}, B,
                                                     cassa_eur, pat_pipe, out["semaforo"]["colore"],
                                                     reg_ora[-1] if reg_ora else None, adesso) if conc else None)
    return out


def _da_emittente(e):
    """v489 — ', dichiarata dall'emittente' quando la data viene da LIBRO.md §1octies e non dal calendario
    Nasdaq: chi legge la scadenza deve sapere da dove viene. Vuoto per Nasdaq e per le voci senza fonte."""
    f = (e or {}).get("fonte") or "calendario Nasdaq"
    return "" if f == "calendario Nasdaq" else ", dichiarata dall'emittente"


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
            "scadenze": [{"tk": e["tk"], "data": e["data"], "giorni": e.get("giorni"), "fonte": e.get("fonte")}
                         for e in scad],
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


def fcf_di(riga):
    """Il flusso di cassa libero su 12 mesi di una riga della pipeline, o None. Se ne usa SOLO il
    segno (v404): l'importo e' nella valuta di bilancio dell'emittente. Una lettura sola (v161)."""
    return ((riga or {}).get("combustione") or {}).get("fcf_ttm")


def credito_dalla_pipeline(nomi):
    """Da data.json: il SEGNO del flusso di cassa libero di ciascun nome (v404: solo segni e
    rapporti, mai grandezze fra titoli — SKHY pubblica in won) e macro.credit_ccc.
    None = la pipeline non lo ha; un file illeggibile da' None ovunque, mai un default."""
    d = _carica_pipeline()
    if d is None:
        return {t: None for t in nomi}, None
    righe = righe_pipeline(d)
    return ({t: fcf_di(righe.get(t)) for t in nomi},
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
                 + " · ".join(f"{s['tk']} {s['data']} ({s['giorni']} g{_da_emittente(s)})" for s in a["scadenze"]))
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


def righe_pipeline(d):
    """{ticker: riga} da portafoglio E watchlist della pipeline: una costruzione sola per il semaforo,
    il credito sul libro e la tenuta (v161). Un file assente da' {}, mai un default (v396)."""
    return {r.get("ticker"): r for r in ((d or {}).get("portfolio") or []) + ((d or {}).get("watchlist") or [])
            if isinstance(r, dict)}


def segnali_pipeline(d):
    """Gli ingressi del semaforo che vengono dalla pipeline, ciascuno con la SUA data (v431)."""
    if not d:
        return {"ccc": None, "hy": None, "t10": None, "analisti": {}, "margin": None}
    m = d.get("macro") or {}
    cr = m.get("credit") or {}
    a10 = next((s for s in ((m.get("tassi") or {}).get("scadenze") or []) if s.get("key") == "a10"), None)
    righe = righe_pipeline(d)
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
                 + (" · SOTTO LA MEDIA A 200, il livello del rosso" if p.get("sotto200") else ""))
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
        L.append("  chi pesa di più nel rischio oggi (contributo di Euler) — un'informazione, non una vendita: dal "
                 "15/10/2026 arancione e rosso non vendono, l'unica vendita automatica è il salvavita (LIBRO.md §1ter): "
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
        scad = (f"scadenza: trimestrale {sc['data']} ({sc['giorni']} g{_da_emittente(sc)})" if sc else
                f"scadenza: nessuna trimestrale dichiarata dalla fonte nei {finestra} giorni (non 'nessuna uscita')")
        L.append(f"  {x['tk']} {x['decisione']}, {qt} · condizione {cond} · confermata il {x['confermata']}"
                 + (f" a {_it(x['conferma_px'])}" if x["conferma_px"] is not None else "")
                 + f" · {eff} · {x['sedute']} {'seduta conclusa' if x['sedute'] == 1 else 'sedute concluse'} dalla conferma"
                 + f" · {scad}")
    return L


# ════════════════════════════════════════════════════════════════ v483 — RIMANDATE DI PROPOSITO
# LIBRO.md §1quater, regola 4: una decisione che aspetta un evento si DICHIARA rimandata di proposito,
# non si lascia scadere. Il 14/10/2026 il CEO, sulla media di CRWV: "per ora attendo i conti". Una
# decisione cosi' vive in una riga del libro e, senza uno strumento che la riporti, esce dall'analisi
# alla prima compattazione — il difetto del 09/10, quando un «Aggiorna analisi» e' uscito senza la
# sezione 7 perche' gli strumenti c'erano ma nessuno li chiamava (v473). Qui la si riporta a ogni
# analisi, con la prima trimestrale del nome dichiarata dalla fonte: nessuna data scritta a mano (v410).
def _lista_sotto(testo, titoletto):
    """Le righe «- TICKER — testo» sotto un titoletto in grassetto, dentro la sezione delle decisioni del
    libro (v454: si legge solo dentro il proprio titolo). La lista finisce alla prima riga vuota dopo le
    voci o al titoletto successivo. None = sezione delle decisioni assente (v406). Una funzione sola per
    rimandate ed esami: due lettori della stessa forma divergono al primo ritocco (v161)."""
    if testo is None:
        testo = testo_libro()
    out, sez, trovata, dentro = [], False, False, False
    for riga in testo.splitlines():
        if riga.startswith("## "):
            sez = "DECISIONI APERTE" in riga.upper()
            trovata, dentro = trovata or sez, False
            continue
        if not sez:
            continue
        if riga.startswith("**"):
            dentro = riga.startswith(titoletto)
            continue
        if dentro:
            m = re.match(r"- ([A-Z][A-Z0-9.\-]*) — (.+)$", riga.strip())
            if m:
                out.append({"tk": m.group(1), "testo": m.group(2)})
            elif not riga.strip() and out:
                dentro = False
    return out if trovata else None


def leggi_rimandate(testo=None):
    """Le righe «- TICKER — cosa si rimanda» sotto il titoletto «Rimandate di proposito». None = sezione
    delle decisioni assente, che si legge diverso da 'nessuna rimandata' (v406)."""
    return _lista_sotto(testo, "**Rimandate di proposito**")


def leggi_esami(testo=None):
    """v484 — le righe «- TICKER — conti del AAAA-MM-GG · tenere se … · mediare se … · vendere se …» sotto
    il titoletto «Esami dei conflitti» (decisione del CEO del 14/10/2026: ogni CONFLITTO si decide ai conti
    successivi, con l'esame scritto prima). Un esame senza la data dei conti si legge lo stesso, e la resa
    non lo confronta con l'uscita. None = sezione delle decisioni assente (v406)."""
    rr = _lista_sotto(testo, "**Esami dei conflitti**")
    for r in rr or []:
        m = re.search(r"conti del (\d{4}-\d{2}-\d{2})", r["testo"])
        r["conti"] = m.group(1) if m else None
    return rr


def righe_rimandate(rr, calendario, finestra=45):
    """Ogni rimandata con la prima trimestrale del nome come la dichiara la fonte (§1quater, regola 2).
    Nessuna data nella finestra si dice, e non e' 'nessuna uscita' (v396)."""
    if rr is None:
        return ["RIMANDATE DI PROPOSITO: sezione delle decisioni NON trovata in LIBRO.md"]
    if not rr:
        return []
    prime = {}
    for e in (calendario or {}).get("attesi") or []:
        prime.setdefault(e["tk"], e)
    L = ["RIMANDATE DI PROPOSITO (LIBRO.md §1quinquies, §1quater regola 4) — si riprendono all'evento, "
         "non si lasciano scadere"]
    for r in rr:
        sc = prime.get(r["tk"])
        L.append(f"  {r['tk']} — {r['testo']} · " + (f"prima trimestrale {sc['data']} ({sc['giorni']} g{_da_emittente(sc)})" if sc else
                 f"nessuna trimestrale dichiarata dalla fonte nei {finestra} giorni (non 'nessuna uscita')"))
    return L

# ════════════════════════════════════════════════════════════════ v489 — ORDINI APERTI
# Il 15/10/2026 il CEO ha inserito tre ordini con limite (ORCL 65 a 129,50, OKLO 260 a 28,50, SMCI 300 a
# 32,50) e ha chiesto due volte se alzare i limiti per prendere lo storno: "perché entrare su qualche punto
# più caro quando posso acquistare bene su questo storno?". La risposta dipendeva dal TITOLO, non dal
# prezzo: uno STORNO è una pausa dentro una salita, una DISCESA no (LIBRO.md §1bis). Poi: "Rendi questa
# conversazione di oggi parte strutturale dell'analisi globale". Un ordine scritto solo in chat esce
# dall'analisi alla prima compattazione — il difetto delle rimandate (v483) — e un ordine non seguito può
# eseguirsi senza che l'analisi lo sappia. Qui ogni ordine aperto torna a ogni analisi coi fatti che servono
# a decidere se lasciarlo, spostarlo o toglierlo. Solo fatti misurati: la frase la scrive la resa (v448).
NATURA = {"intatta": "STORNO", "in correzione": "STORNO", "rotta": "DISCESA"}

# v490 — la VALIDITA' dell'ordine (CEO, 15/10/2026 sera, testuale: "Ordini giornalieri per ora"). Un ordine
#   giornaliero finisce con la propria seduta: dopo la campana non e' piu' "attivo", e' ESEGUITO o SCADUTO, e lo
#   sa solo il conto. Senza questa distinzione l'analisi del mattino dopo lo mostrava ancora attivo — un registro
#   che invecchia da solo (v410), dentro il blocco nato per tenere onesti gli ordini — e contava la sua spesa
#   come liquidita' ancora impegnata. La campana e' quella di brief.dopo_la_campana (v485): una regola, un posto
#   (v161). Una validita' non dichiarata NON si indovina: l'ordine resta attivo, e la resa lo dice.
VALIDITA = {"giornaliero": ("giornalier", "giorno", "day"), "fino a revoca": ("fino a revoca", "revoca", "gtc")}


def validita_ordine(testo):
    """'giornaliero' · 'fino a revoca' · None (non dichiarata) · il testo stesso, se non si riconosce."""
    t = (testo or "").strip().lower()
    if not t:
        return None
    return next((v for v, parole in VALIDITA.items() if t.startswith(parole)), t)


def chiusura_seduta(giorno):
    """La campana delle 16:00 di New York del `giorno` (ISO) in ora italiana: 22:00 di solito, 21:00 nelle
    settimane in cui le due ore legali non coincidono — dal fuso, mai uno scarto a mano (v470). None se il giorno
    non si legge."""
    import brief
    if not re.match(r"\d{4}-\d{2}-\d{2}$", str(giorno or "")[:10]) or len(str(giorno)) < 10:
        return None
    g = datetime.fromisoformat(str(giorno)[:10])
    return datetime(g.year, g.month, g.day, 16, 0, tzinfo=brief.NEW_YORK).astimezone(brief.ROMA)


def seduta_finita(giorno, adesso=None):
    """Vero se la seduta regolare del `giorno` (ISO) e' chiusa: un giorno gia' passato a New York, o lo stesso
    giorno dopo la campana (brief.dopo_la_campana, v485). None se il giorno non si legge: non si decide."""
    import brief
    if chiusura_seduta(giorno) is None:
        return None
    ny = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    g = str(giorno)[:10]
    return g < ny.date().isoformat() or brief.dopo_la_campana(g, ny)


def leggi_ordini(testo=None):
    """La tabella ORDINI APERTI di LIBRO.md (§1septies): ordini con limite inseriti dal CEO e non ancora
    eseguiti. None = sezione ASSENTE, che si legge diverso da 'nessun ordine' (v389, v406). Si legge solo
    dentro il proprio titolo (v454)."""
    if testo is None:
        testo = testo_libro()
    out, sez, trovata = [], False, False
    for riga in testo.splitlines():
        if riga.startswith("## "):
            sez = "ORDINI APERTI" in riga.upper()
            trovata = trovata or sez
            continue
        if not sez or not riga.startswith("|"):
            continue
        celle = [x.strip() for x in riga.strip().strip("|").split("|")]
        if len(celle) < 6 or celle[0] in ("Nome", "") or set(celle[0]) <= set("-: "):
            continue
        tk, verso, q, lim, ins, stato = celle[:6]
        val = celle[6] if len(celle) > 6 else ""        # v490 — la validita' sta IN CODA: le prime sei non si spostano
        out.append({"tk": tk.upper(), "verso_testo": verso, "qta": _num_it(q), "limite": _num_it(lim),
                    "verso": next((v for v, parole in VERSI.items() if verso.lower().startswith(parole)), None),
                    "inserito": ins, "stato": stato, "attivo": stato.lower().startswith(("attivo", "aperto")),
                    "validita": validita_ordine(val), "validita_testo": val})
    return out if trovata else None


def valuta_ordini(ordini, barre, tec, lunghe, calendario, righe, sem, rlibro, rqqq, valore_libro, fx, adesso=None,
                  cassa_eur=None):
    """Per ogni ordine d'ACQUISTO attivo: la distanza dal prezzo; se il minimo della seduta di OGGI ha toccato il
    limite (l'ordine può essere già eseguito: si verifica sul conto); STORNO o DISCESA dalla tendenza della tenuta
    (§1sexies) e se alzare il limite è coerente con la regola dei minimi (§1bis); il pavimento SOTTO IL LIMITE con
    lo stop e il rischio fino allo stop — col limite e col prezzo di adesso, perché alzare il limite allunga la
    distanza dallo stop —; dove sta il limite rispetto al pavimento più vicino al prezzo; la tenuta se fosse in
    portafoglio; la correlazione col libro; i conti dentro la vita dell'ordine; il volume della seduta; e
    l'effetto dell'INSIEME degli ordini sul libro. None = sezione assente (v406)."""
    if ordini is None:
        return None
    import brief, rotazione
    ny = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    prime = {}
    for e in (calendario or {}).get("attesi") or []:
        prime.setdefault(e["tk"], e)                       # gli attesi arrivano gia' in ordine di data
    out, spese, rend, chiusi = [], {}, {}, []
    for o in ordini:
        if not o["attivo"]:
            continue
        if o.get("validita") == "giornaliero" and seduta_finita(o["inserito"], ny):
            # v490 — la sua seduta e' chiusa: ESEGUITO o SCADUTO, non piu' attivo. Il minimo (o il massimo, per una
            #   vendita) di QUELLA seduta dice se il limite e' stato raggiunto: un acquisto con limite non si esegue
            #   sopra il limite. Dalla barra della seduta; la sera stessa, se la barra non c'e', dalla quota
            g, t = str(o["inserito"])[:10], tec.get(o["tk"]) or {}
            bar = next((x for x in (barre.get(o["tk"]) or []) if str(x.get("t"))[:10] == g), None)
            lo, hi = (bar or {}).get("l"), (bar or {}).get("h")
            if bar is None and t.get("seduta_quota") == g:
                lo, hi = t.get("minimo_oggi"), t.get("massimo_oggi")
            lim = o.get("limite")
            toccato = (None if not lim else lo <= lim if (o["verso"] == "acquisto" and lo is not None)
                       else hi >= lim if (o["verso"] == "vendita" and hi is not None) else None)
            chiusi.append({**o, "minimo_seduta": lo, "massimo_seduta": hi, "toccato": toccato})
            continue
        t, b = tec.get(o["tk"]) or {}, barre.get(o["tk"]) or []
        px, lim, q, atr = t.get("px"), o["limite"], o["qta"], t.get("atr")
        r = {**o, "px": px, "var_pct": t.get("var_pct"), "seduta_quota": t.get("seduta_quota"),
             "minimo_oggi": t.get("minimo_oggi"), "quota_ora": t.get("quota_ora"),
             "scade": chiusura_seduta(o["inserito"]) if o.get("validita") == "giornaliero" else None}
        if o["verso"] != "acquisto":
            out.append({**r, "errore": f"verso «{o['verso_testo']}»: il blocco valuta gli ordini d'acquisto"})
            continue
        if not (px and lim and q and atr):
            out.append({**r, "errore": "prezzo, limite, quantità o ATR mancanti: ordine non valutabile"})
            continue
        tend = tendenza(b, adesso)
        natura = NATURA.get(tend["stato"], "NON MISURABILE")
        bl = lunghe.get(o["tk"])
        pv_px = rotazione.pavimenti(bl, px, atr, adesso)
        # i pavimenti SOTTO IL LIMITE: quello piu' vicino regge l'ordine, e il suo stop e' lo stop dell'ordine.
        #   Il ritocco minimo fa entrare anche un minimo che coincide col limite (un ordine SUL pavimento)
        pv_lim = rotazione.pavimenti(bl, lim * (1 + 1e-9), atr, adesso)
        primo = ((pv_px or {}).get("minimi") or [None])[0]
        sotto = ((pv_lim or {}).get("minimi") or [None])[0]
        stop = sotto["stop"] if sotto else None
        posizione = (None if primo is None else "sopra" if lim > primo["alto"] else
                     "sul" if lim >= primo["fondo"] else "sotto")
        vp = t.get("var_pct")
        alzare = ("non misurabile" if natura == "NON MISURABILE" else "discesa" if natura == "DISCESA"
                  else "coerente" if (vp is not None and vp < 0) else "risalita")
        rt = rotazione.rendimenti_per_data(b)
        sc = prime.get(o["tk"])
        out.append({**r, "distanza_pct": (lim / px - 1) * 100, "sopra_prezzo": lim >= px,
                    "toccato_oggi": (t.get("seduta_quota") == ny.date().isoformat()
                                     and t.get("minimo_oggi") is not None and t["minimo_oggi"] <= lim),
                    "tendenza": tend, "natura": natura, "alzare": alzare, "media_sopra": rotazione.prima_media_sopra(t),
                    "pavimenti_letti": pv_px is not None, "pavimento_vicino": primo, "pavimento_sotto": sotto,
                    "posizione": posizione, "stop": stop,
                    "rischio": q * (lim - stop) if (stop is not None and stop < lim) else None,
                    "rischio_pct": (stop / lim - 1) * 100 if (stop is not None and stop < lim) else None,
                    "rischio_mercato": q * (px - stop) if (stop is not None and stop < px) else None,
                    "rischio_mercato_pct": (stop / px - 1) * 100 if (stop is not None and stop < px) else None,
                    "tenuta": valuta_tenuta(b, (righe or {}).get(o["tk"]), sem, adesso),
                    "corr_libro": rotazione.correlazione(rt, rlibro or {}),
                    "conti": sc, "conti_vicini": bool(sc and sc.get("giorni") is not None
                                                     and sc["giorni"] <= rotazione.TRIMESTRALE_VICINA),
                    "volume": rotazione.volume_seduta(t, b, adesso)})
        spese[o["tk"]] = spese.get(o["tk"], 0) + q * lim
        rend[o["tk"]] = rt
    insieme, tot = None, sum(spese.values())
    if tot:
        comuni = set.intersection(*[set(v) for v in rend.values()])
        serie = {d: sum(spese[k] * rend[k][d] for k in spese) / tot for d in comuni}
        valutati = [x for x in out if not x.get("errore")]
        rv = [x["rischio"] for x in valutati if x.get("rischio") is not None]
        # v490 — la liquidita' che gli ordini ATTIVI tengono bloccata sul conto: ogni acquisto con limite, anche
        #   quello non valutabile qui (il broker lo blocca lo stesso). LIBRO.md §1 dichiara la liquidita' IN TUTTO,
        #   bloccata compresa: un ordine non eseguito non ha speso niente. La libera e' la differenza
        imp = sum(x["qta"] * x["limite"] for x in out if x.get("verso") == "acquisto" and x.get("qta") and x.get("limite"))
        insieme = {"spesa": tot, "nomi": len(spese), "fx": fx, "rischio": sum(rv) if rv else None,
                   "rischio_completo": len(rv) == len(valutati),
                   "conseguenze": rotazione.conseguenze(serie, rlibro or {}, rqqq or {}, valore_libro, tot),
                   "impegnata_usd": imp, "impegnata_eur": imp / fx if fx else None, "cassa_eur": cassa_eur,
                   "libera_eur": (cassa_eur - imp / fx) if (fx and cassa_eur is not None) else None}
    return {"righe": out, "insieme": insieme, "inattivi": [o for o in ordini if not o["attivo"]], "chiusi": chiusi}


def righe_ordini(oo, finestra=45):
    import rotazione
    if oo is None:
        return ["ORDINI APERTI: sezione NON trovata in LIBRO.md — non vuol dire 'nessun ordine aperto'"]
    L = []
    if not oo["righe"]:
        L.append("ORDINI APERTI: nessuno attivo in LIBRO.md §1septies")
    else:
        L.append("ORDINI APERTI (LIBRO.md §1septies, inseriti dal CEO e non ancora eseguiti) · regola (§1bis, 15/10/2026): "
                 "STORNO = tendenza non rotta: alzare il limite è coerente se nella seduta il titolo scende — si compra "
                 "lo storno, non la risalita · DISCESA = tendenza rotta: lo sconto è il rischio e il limite resta sul "
                 "pavimento · lo stop resta quello del pavimento sotto il limite: alzare il limite allunga la distanza "
                 "dallo stop, e il rischio in più si scrive in dollari")
    for x in oo["righe"]:
        testa = (f"  {x['tk']} {x['verso_testo']} {_it(x['qta'], 0)} a {_it(x['limite'])} (inserito {x['inserito']})"
                 + testo_validita(x))
        if x.get("errore"):
            L.append(testa + f" · {x['errore']}")
            continue
        vp = x.get("var_pct")
        L.append(testa + f" · ora {_it(x['px'])}"
                 + (f" ({_sg(vp)}% nella seduta del {x['seduta_quota']})" if vp is not None else "")
                 + (" · ⚠ il limite sta SOPRA il prezzo: si esegue subito" if x["sopra_prezzo"] else
                    f" · il limite è il {_it(-x['distanza_pct'], 1)}% sotto il prezzo"))
        if x["toccato_oggi"]:
            L.append(f"      ⚠ il minimo di oggi ({_it(x['minimo_oggi'])}) ha toccato il limite: se l'ordine era già attivo "
                     "in quel momento può essere ESEGUITO — si verifica sul conto, e se lo è si aggiorna il libro (§1)")
        td, ms = x["tendenza"], x.get("media_sopra")
        if x["natura"] == "NON MISURABILE":
            nat = f"tendenza NON MISURABILE ({td.get('perche')}): la regola storno/discesa non si applica, e lo si dice"
        else:
            nat = (f"{x['natura']} — tendenza {td['stato']}: chiusura {_sg(td['d50_atr'])} ATR dalla media 50, "
                   f"{_sg(td['d200_atr'])} dalla 200" + (", media 50 sotto la 200" if td["incrocio"] else ""))
        alz = {"coerente": "alzare il limite è COERENTE con la regola: è uno storno e nella seduta il titolo scende",
               "risalita": "alzare il limite NON è coerente adesso: è uno storno, ma nella seduta il titolo sale — sarebbe "
                           "comprare la risalita",
               "discesa": "alzare il limite NON è coerente: lo sconto è il rischio, il limite resta sul pavimento"
                          + (f"; la discesa smette di scendere con una chiusura sopra la {ms[0]} ({_it(ms[1])}), che non è "
                             "ancora un ingresso" if ms else ""),
               "non misurabile": "alzare il limite: non valutabile con la regola"}[x["alzare"]]
        L.append(f"      {nat} · {alz}")
        pv = x["pavimento_vicino"]
        if not x["pavimenti_letti"]:
            pav = "pavimenti: storico NON letto — non vuol dire 'nessun pavimento'"
        elif pv is None:
            pav = "pavimenti: nessun minimo di oscillazione sotto il prezzo nei due anni — lo stop non ha dove appoggiarsi"
        else:
            rif = (f"{_it(pv['fondo'])}–{_it(pv['alto'])}" if pv["fondo"] != pv["alto"] else _it(pv["alto"])) + \
                  f", {_conta(len(pv['tocchi']), 'tocco', 'tocchi')}"
            pav = {"sopra": f"il limite sta SOPRA il pavimento più vicino ({rif}): si esegue prima di arrivarci, non è un "
                            "ingresso sui minimi",
                   "sul": f"il limite sta SUL pavimento più vicino ({rif})",
                   "sotto": f"il limite sta SOTTO il pavimento più vicino ({rif}): si esegue solo se quel pavimento cede"
                   }[x["posizione"]]
        if x["rischio"] is not None:
            pav += (f" · stop del pavimento sotto il limite {_it(x['stop'])} (chiusura sotto) → fino allo stop "
                    f"{_it(x['rischio'], 0)} $ ({_sg(x['rischio_pct'])}%)")
            if x["rischio_mercato"] is not None and not x["sopra_prezzo"]:
                pav += (f"; col limite alzato al prezzo di adesso {_it(x['rischio_mercato'], 0)} $ "
                        f"({_sg(x['rischio_mercato_pct'])}%)")
        elif x["pavimenti_letti"] and pv is not None:
            pav += " · nessun pavimento sotto il limite: stop n.d."
        L.append("      " + pav)
        c, sc = x["corr_libro"], x["conti"]
        parti = [f"tenuta se fosse in portafoglio: {etichetta_esito(x['tenuta'])}",
                 "correlazione col libro n.d." if c is None else
                 f"correlazione col libro {_sg(c, 2)}" + (" (stessa scommessa)" if c >= rotazione.SOGLIA_CORR else " (diversifica)"),
                 (f"conti {sc['data']} ({sc['giorni']} g, {sc.get('fonte') or 'calendario Nasdaq'})" if sc else
                  f"conti: nessuna data dichiarata nei {finestra} giorni (non 'nessuna uscita')")]
        L.append("      " + " · ".join(parti))
        if x["conti_vicini"]:
            L.append(f"      ⚠ conti entro {rotazione.TRIMESTRALE_VICINA} giorni: un ordine lasciato attivo durante i conti può "
                     "eseguirsi all'apertura dopo, anche sotto il pavimento — si decide prima se tenerlo aperto")
        vs = rotazione.testo_volume_seduta(x["volume"])
        if vs:
            L.append(f"      volumi: {vs}")
    ins = oo.get("insieme")
    if ins:
        c = ins["conseguenze"]
        s = (f"  INSIEME, se eseguiti tutti ai limiti: {_it(ins['spesa'], 0)} $ su {_conta(ins['nomi'], 'nome', 'nomi')}"
             + (" · conseguenze sul libro n.d." if c is None else
                f" · {_it(c['peso'] * 100, 1)}% dell'azionario dopo · volatilità del libro {_sg(c['dvol'], 2)} punti, "
                f"beta su QQQ {_sg(c['dbeta'], 3)} ({c['sedute']} sedute)"))
        if ins["rischio"] is not None:
            s += (f" · fino agli stop {_it(ins['rischio'], 0)} $"
                  + (f" ≈ {_it(ins['rischio'] / ins['fx'], 0)} €" if ins.get("fx") else "")
                  + ("" if ins["rischio_completo"] else " (parziale: uno o più ordini senza stop)"))
        L.append(s)
        if ins.get("impegnata_eur") is not None:
            L.append(f"  liquidità bloccata dagli ordini attivi ≈ {_it(ins['impegnata_eur'], 0)} € ({_it(ins['impegnata_usd'], 0)} $ "
                     "ai limiti, al cambio di oggi)"
                     + (f" · libera ≈ {_it(ins['libera_eur'], 0)} € sui {_it(ins['cassa_eur'], 0)} € di LIBRO.md §1, che "
                        "dichiara la liquidità in tutto, bloccata compresa" if ins.get("libera_eur") is not None else
                        " · la liquidità di LIBRO.md §1 non si legge: la libera non si calcola"))
    if oo.get("chiusi"):
        L.append("  ordini GIORNALIERI di sedute già chiuse: ESEGUITI o SCADUTI — lo sa il conto, non questo calcolo; si "
                 "verifica e si aggiorna il libro (§1 se eseguito, §1septies in ogni caso)")
        for o in oo["chiusi"]:
            q = f"    {o['tk']} {o['verso_testo']} {_it(o['qta'], 0)} a {_it(o['limite'])} (seduta del {o['inserito']})"
            vendita = o.get("verso") == "vendita"
            estremo, nome = (o.get("massimo_seduta"), "massimo") if vendita else (o.get("minimo_seduta"), "minimo")
            if o.get("toccato") is True:
                q += (f" · il {nome} della seduta ({_it(estremo)}) ha raggiunto il limite: può essere stato ESEGUITO, "
                      "se l'ordine era già sul conto in quel momento")
            elif o.get("toccato") is False:
                q += (f" · il {nome} della seduta ({_it(estremo)}) non ha raggiunto il limite: SCADUTO senza esecuzione, "
                      "salvo un ordine valido anche fuori dalla seduta regolare")
            else:
                q += f" · {nome} della seduta n.d.: eseguito o scaduto non si ricava dai prezzi"
            L.append(q)
    if oo.get("inattivi"):
        L.append("  in tabella ma non attivi (si tolgono quando eseguiti o revocati, §1septies): "
                 + ", ".join(f"{o['tk']} ({o['stato']})" for o in oo["inattivi"]))
    return L


def testo_validita(x):
    """v490 — la validita' dell'ordine nella sua testa: la scadenza in ora italiana se giornaliero; dichiarato se
    manca, invece di indovinarla."""
    v = x.get("validita")
    if v == "giornaliero":
        sc = x.get("scade")
        return (f" · giornaliero: scade alla campana delle {sc:%H:%M} italiane del {sc:%d/%m}, se non eseguito" if sc else
                " · giornaliero, ma la data d'inserimento non si legge: la scadenza non si calcola")
    if v == "fino a revoca":
        return " · fino a revoca"
    if v is None:
        return " · validità non dichiarata in §1septies (giornaliero o fino a revoca?)"
    return f" · validità «{x.get('validita_testo')}» non riconosciuta: vale quella del broker"



# ════════════════════════════════════════════════════════════════ v481-v482 — TENUTA DELLE POSIZIONI
# v481 — decisione del CEO del 14/10/2026 (LIBRO.md §1sexies): si lascia correre, si vende per EVIDENZA.
# v482 — lo stesso giorno, dopo il primo giro: "bisogna valutare l'insieme dei fattori macro news
#   bilanci etc e non solo analisi tecnica … se si ha la possibilita' che esploda a rialzo per x
#   fattori allora valutalo". Il v481 cercava solo prove CONTRO: una tendenza rotta piu' una conferma
#   bastavano, e la crescita del bilancio non poteva opporsi. Ora e' un BILANCIO DELL'EVIDENZA: ogni
#   misura sta CONTRO la tenuta, A FAVORE o in mezzo, con la stessa soglia nei due versi, e quando il
#   prezzo e la crescita dicono cose opposte l'esito e' CONFLITTO — decidono le notizie e il giudizio,
#   non lo script. Nessun punteggio (v200): conta QUALI prove ci sono, non quante. Le soglie sono
#   convenzioni (v240): stanno qui perche' il codice le confronta, e un gate le rilegge dal libro
#   (v474). Notizie e consenso degli analisti restano FUORI dal bilancio — le prime non si calcolano,
#   il secondo e' un'opinione — e si riportano accanto, dichiarati per cio' che sono.
MEDIA_LUNGA, MEDIA_BREVE = 200, 50
SOGLIA_EPS_90 = 5.0          # stima dell'EPS a 90 giorni mossa di oltre il 5% del proprio valore, nei due versi
SOGLIA_RICAVI = 25.0         # ricavi del trimestre sull'anno prima: da +25% sono una prova di CRESCITA
AUTONOMIA_CORTA, AUTONOMIA_SOLIDA = 12, 24     # mesi: sotto 12 il bilancio e' corto, da 24 e' solido
CONFLITTO = "CONFLITTO — DA VALUTARE"
ESITI = ("VENDITA PER EVIDENZA", CONFLITTO, "IN OSSERVAZIONE", "NON MISURABILE", "LASCIAR CORRERE")  # urgenza
PROVE = ("tendenza", "stime", "revisioni", "ricavi", "bilancio", "macro")
CRESCITA = ("stime", "revisioni", "ricavi")    # le sole prove a favore che possono opporsi a una tendenza rotta
VERSI_POSSIBILI = {**{p: ("contro", "neutro", "favore") for p in PROVE}, "macro": ("contro", "neutro")}


def tendenza(barre, adesso=None):
    """La tendenza del nome sulle chiusure CONCLUSE (v471). ROTTA: chiusura sotto la media a 200 E
    media a 50 sotto la 200. IN CORREZIONE: chiusura sotto una delle due medie senza la rottura —
    non e' un segnale di vendita. Sotto 200 sedute concluse e' NON MISURABILE, mai 'intatta' (v406)."""
    import brief
    b = concluse(barre or [], adesso)
    if len(b) < MEDIA_LUNGA:
        return {"stato": "non misurabile", "sedute": len(b),
                "perche": f"{len(b)} sedute concluse, la media a {MEDIA_LUNGA} ne chiede {MEDIA_LUNGA}"}
    c, m50, m200, atr = b[-1]["c"], brief.sma(b, MEDIA_BREVE), brief.sma(b, MEDIA_LUNGA), brief.atr_wilder(b)
    stato = "rotta" if (c < m200 and m50 < m200) else ("in correzione" if (c < m50 or c < m200) else "intatta")
    return {"stato": stato, "seduta": b[-1]["t"], "chiusura": c, "sma50": m50, "sma200": m200,
            "incrocio": m50 < m200, "d50_atr": (c - m50) / atr if atr else None,
            "d200_atr": (c - m200) / atr if atr else None}


def prove_fondamentali(riga):
    """Tre prove dalla pipeline, ciascuna nei DUE versi con la stessa soglia (LIBRO.md §1sexies):
    le STIME (EPS a 90 giorni; il verso dalla DIFFERENZA, v400: su una perdita, la perdita che si
    allarga e' contro), le REVISIONI a 30 giorni (piu' tagli che rialzi contro, piu' rialzi a favore:
    la convenzione del semaforo, una sola, v161) e i RICAVI dell'ultimo trimestre sullo stesso
    trimestre dell'anno prima, trovato per DATA dalla funzione delle schede (v161, v207).
    Senza dato il verso e' None, mai 'neutro' (v406)."""
    import schede_progetto
    a = (riga or {}).get("analisti") or {}
    su, giu = a.get("su_30g"), a.get("giu_30g")
    ora, prima = a.get("eps_ora"), a.get("eps_90g_fa")
    var = (ora - prima) / abs(prima) * 100 if (ora is not None and prima is not None and abs(prima) > 1e-9) else None
    q = schede_progetto.ultimo_trimestre(riga or {}) or {}
    yoy = q.get("yoy")
    due = lambda x, giu_, su_: None if x is None else "contro" if giu_ else "favore" if su_ else "neutro"
    return {"stime": {"verso": due(var, var is not None and var < -SOGLIA_EPS_90, var is not None and var > SOGLIA_EPS_90),
                      "ora": ora, "prima": prima, "var": var},
            "revisioni": {"verso": None if su is None or giu is None else due(0, giu > su, su > giu), "su": su, "giu": giu},
            "ricavi": {"verso": due(yoy, yoy is not None and yoy < 0, yoy is not None and yoy >= SOGLIA_RICAVI),
                       "yoy": yoy, "trim": q.get("trim")}}


def prova_bilancio(riga):
    """L'autonomia della societa' (LIBRO.md §1sexies). Chi ha flusso di cassa libero positivo si
    autofinanzia: SOLIDO. Chi brucia cassa si misura sul denominatore che VINCOLA, il piu' corto fra
    perdita operativa, perdita piu' dividendi sulle privilegiate e investimenti — sui soli impianti
    quando gli investimenti sono acquisti di attivita' immateriali (v477). Sotto 12 mesi e' CORTO: la
    societa' dipende dal mercato dei capitali entro l'anno. Solo rapporti, mai importi (v404)."""
    import schede_progetto
    c = (riga or {}).get("combustione") or {}
    fcf, al = c.get("fcf_ttm"), c.get("cashflow_al")
    if fcf is None:
        return {"verso": None, "perche": "flusso di cassa libero n.d."}
    if fcf >= 0:
        return {"verso": "favore", "autofinanzia": True, "al": al}
    cand = []
    if c.get("mesi_operativi") is not None:
        cand.append((c["mesi_operativi"], "perdita operativa"))
    if c.get("mesi_obblighi") is not None:
        cand.append((c["mesi_obblighi"], "perdita operativa più dividendi sulle privilegiate"))
    if c.get("investimenti_immateriali_prevalenti"):
        if c.get("mesi_impianti") is not None:
            cand.append((c["mesi_impianti"], "investimenti nei soli impianti"))
    elif c.get("mesi_capex") is not None:
        cand.append((c["mesi_capex"], "investimenti"))
    if not cand:
        return {"verso": None, "perche": "brucia cassa, autonomia n.d.", "al": al}
    mesi, den = min(cand)
    _, nome, _ = schede_progetto.liquidita_societa(c)
    return {"verso": "contro" if mesi < AUTONOMIA_CORTA else "favore" if mesi >= AUTONOMIA_SOLIDA else "neutro",
            "autofinanzia": False, "mesi": mesi, "denominatore": den, "al": al,
            "numeratore": "cassa (soli contanti)" if nome == "cassa" else "liquidità",
            "ritmo_dividendi": schede_progetto.ritmo_dividendi(c) if "dividendi" in den else None}


def macro_nome(fcf, sem):
    """Il canale macro del nome (LIBRO.md §1sexies): semaforo del libro arancione o rosso, OPPURE il
    nome BRUCIA CASSA e la famiglia credito e' accesa — e' da li' che una stretta gli arriva (v404,
    v467). Solo il SEGNO del flusso: gli importi sono in valuta di bilancio (v404). Spenta solo se
    ogni via che potrebbe accenderla si misura; un semaforo MINIMO puo' ancora salire (v474). Non ha
    un verso a favore: un quadro calmo e' l'assenza di un rischio, non una prova di crescita."""
    sem = sem or {}
    colore = sem.get("colore")
    cred = ((sem.get("famiglie") or {}).get("credito") or {}).get("stato")
    brucia = None if fcf is None else fcf < 0
    if colore in ("arancione", "rosso"):
        return {"stato": "acceso", "perche": f"semaforo {colore}", "brucia": brucia}
    if brucia and cred == "acceso":
        return {"stato": "acceso", "perche": "brucia cassa e il credito è acceso", "brucia": True}
    ignote = []
    if colore is None or sem.get("minimo"):
        ignote.append("semaforo " + ("assente" if colore is None else "MINIMO"))
    if brucia is None and cred != "spento":
        ignote.append("flusso di cassa libero n.d.")
    elif brucia and cred != "spento":
        ignote.append("credito non misurato")
    if ignote:
        return {"stato": "non misurabile", "perche": ", ".join(ignote), "brucia": brucia}
    return {"stato": "spento", "perche": "brucia cassa, credito spento" if brucia else "si autofinanzia", "brucia": brucia}


def regola_esito(versi):
    """L'esito da QUALI prove ci sono (LIBRO.md §1sexies), mai da quante (v200). versi: {prova: verso}.
    VENDITA = tendenza ROTTA + un'altra prova contro + nessuna prova di crescita a favore · CONFLITTO =
    tendenza ROTTA con la crescita a favore (il prezzo e il bilancio dicono cose opposte) · IN
    OSSERVAZIONE = la tendenza rotta da sola, o una prova contro con la tendenza non rotta ·
    LASCIAR CORRERE = nessuna prova contro."""
    rotta = versi.get("tendenza") == "contro"
    altre = any(v == "contro" for k, v in versi.items() if k != "tendenza")
    crescita = any(versi.get(k) == "favore" for k in CRESCITA)
    if rotta:
        return CONFLITTO if crescita else ("VENDITA PER EVIDENZA" if altre else "IN OSSERVAZIONE")
    return "IN OSSERVAZIONE" if altre else "LASCIAR CORRERE"


def esito_bilancio(prove):
    """L'esito sulle prove MISURATE, e quelli possibili riempiendo le mancanti in ogni verso che possono
    avere: se sono piu' d'uno l'esito e' PROVVISORIO e la resa nomina gli altri — mai un esito
    dichiarato definitivo che un dato mancante potrebbe cambiare (v474, era il MINIMO del v481).
    Nulla di misurato: NON MISURABILE."""
    import itertools
    noti = {k: p["verso"] for k, p in prove.items() if p.get("verso") is not None}
    ignoti = [k for k in PROVE if (prove.get(k) or {}).get("verso") is None]
    if not noti:
        return {"esito": "NON MISURABILE", "possibili": [], "ignoti": ignoti, "provvisorio": False}
    esito = regola_esito(noti)
    possibili = {regola_esito({**noti, **dict(zip(ignoti, c))})
                 for c in itertools.product(*(VERSI_POSSIBILI[k] for k in ignoti))}
    altri = [e for e in ESITI if e in possibili and e != esito]
    return {"esito": esito, "possibili": altri, "ignoti": ignoti, "provvisorio": bool(altri)}


def consenso(riga, chiusura):
    """Il target degli analisti come DISTANZA dalla chiusura: un'OPINIONE, non una prova — resta fuori
    dal bilancio e si legge accanto, perche' il CEO chiede di valutare anche il rialzo possibile
    (v482). I valori stanno gia' nelle schede (riga_revisioni): qui solo le distanze, per non scrivere
    lo stesso numero in due rese (v415)."""
    a = (riga or {}).get("analisti") or {}
    if not chiusura or a.get("target_mediana") is None:
        return None
    pct = lambda x: None if x is None else (x / chiusura - 1) * 100
    return {"mediana": pct(a["target_mediana"]), "min": pct(a.get("target_min")), "max": pct(a.get("target_max"))}


def pareggio_fiscale(px, pmc, qta):
    """L'interesse composto, misurato (LIBRO.md §1sexies): vendere un vincitore paga SUBITO l'imposta
    sulla plusvalenza, che tenendo resta investita. Pareggio = di quanto deve scendere il titolo perche'
    vendere oggi e ricomprare ridia le stesse azioni: ALIQUOTA x (prezzo - carico) / prezzo. L'aliquota
    e' un FATTO e vive in conseguenze.py (un posto solo). In dollari al prezzo di oggi: il conto vero
    lo fa il broker in euro col cambio di carico, e la resa lo dichiara."""
    import conseguenze
    if not px or pmc is None or qta is None:
        return None
    plus = (px - pmc) * qta
    if px > pmc:
        return {"plus": plus, "imposta": plus * conseguenze.ALIQUOTA,
                "pareggio_pct": conseguenze.ALIQUOTA * (px - pmc) / px * 100}
    return {"plus": plus, "imposta": 0.0, "pareggio_pct": None, "minus": -plus}


def media_aritmetica(px, pmc, qta, peso, valore_libro, fx, rt=None, rlibro=None, rqqq=None, giorni_trim=None):
    """Cosa fa UN'UNITA' di calcolo (rotazione.UNITA_EUR) aggiunta a una posizione IN PERDITA — il caso
    di AMD che il CEO ha mediato (LIBRO.md §1sexies): azioni INTERE (una frazione non si compra, v440),
    carico nuovo, rialzo che serve per tornare al carico prima e dopo, peso, e conseguenze sul libro
    con la funzione degli ingressi (rotazione.conseguenze: una derivazione sola, v161). Unita' di
    calcolo, NON una quantita' consigliata (v474): dice cosa comporta, non se farlo."""
    import rotazione
    if not px or pmc is None or qta is None or px >= pmc:
        return None
    if not fx:
        return {"errore": "cambio EUR/USD non letto dalla pipeline: l'unità in dollari non si calcola"}
    usd = rotazione.UNITA_EUR * fx
    n = int(usd // px)
    if n < 1:
        return {"errore": f"un'azione ({_it(px)} $) costa più dell'unità di calcolo ({_it(usd, 0)} $)"}
    spesa = n * px
    carico = (qta * pmc + spesa) / (qta + n)
    return {"usd": usd, "px": px, "azioni": n, "spesa": spesa, "carico_prima": pmc, "carico_dopo": carico,
            "rientro_prima": (pmc / px - 1) * 100, "rientro_dopo": (carico / px - 1) * 100,
            "peso_prima": peso, "peso_dopo": (qta * px + spesa) / (valore_libro + spesa) if valore_libro else None,
            "conseguenze": rotazione.conseguenze(rt or {}, rlibro or {}, rqqq or {}, valore_libro, spesa),
            "giorni_trim": giorni_trim}


def media_pavimenti(pv, pmc, qta, peso, md, tk, px=None):
    """v489 — la media sui PAVIMENTI (CEO, 15/10/2026: «valuta anche mediazione su SK hynix», con SK hynix un
    soffio sopra il carico). Comprare sopra il carico ALZA il carico: è un incremento, non una media. La media vera
    si fa sotto il carico, e la regola dei minimi (LIBRO.md §1bis) dice dove: sui pavimenti. Per ogni pavimento
    sotto il carico l'aritmetica di media_aritmetica — la stessa funzione della media al prezzo di adesso (v161) —
    accanto allo stop del pavimento. Un'unità di calcolo, non una quantità (v474).
    ⚠ Il peso dopo si conta al valore di OGGI (px), come il libro a cui l'unità si aggiunge: valutare la
    posizione al prezzo del pavimento e il libro a quello di oggi mescola due date nello stesso rapporto, e su
    MSTR faceva scendere il peso dopo un acquisto (9,7% → 9,6%) — una frase falsa da un denominatore doppio."""
    if not pv or not pv.get("minimi") or pmc is None:
        return []
    md = md or {}
    out = []
    for z in pv["minimi"]:
        if z["ordine"] >= pmc:
            continue
        m = media_aritmetica(z["ordine"], pmc, qta, peso, md.get("valore"), md.get("fx"),
                             (md.get("rend") or {}).get(tk), md.get("rlibro"), md.get("rqqq"),
                             (md.get("trim") or {}).get(tk))
        if m and not m.get("errore"):
            if px and qta is not None and md.get("valore"):
                m["peso_dopo"] = (qta * px + m["spesa"]) / (md["valore"] + m["spesa"])
            out.append({"pavimento": z, "media": m})
    return out


def riga_pavimenti_posizione(pv):
    """I pavimenti di una posizione in una riga: prezzo dell'ordine, distanza, tocchi e stop. La versione estesa,
    con rimbalzi e volumi, è quella dei sorvegliati (rotazione.righe_pavimenti)."""
    if pv is None:
        return "pavimenti: storico o prezzo NON letti — non vuol dire 'nessun pavimento'"
    if not pv.get("minimi"):
        ms = pv.get("minimo_serie")
        return ("pavimenti: nessuno sotto il prezzo nella finestra"
                + (f" (minimo della serie {_it(ms['minimo'])} del {ms['data']})" if ms else ""))
    return "pavimenti: " + " · ".join(
        f"{'★ ' if z.get('piu_toccato') else ''}{_it(z['ordine'])} ({_sg(z['pct'])}%, "
        f"{_conta(len(z['tocchi']), 'tocco', 'tocchi')}) stop {_it(z['stop'])}" for z in pv["minimi"])


def valuta_tenuta(barre, riga, sem, adesso=None):
    """Le prove e l'esito di UN nome: la stessa funzione per le posizioni (qui) e per i sorvegliati
    (rotazione.py), perche' la regola del CEO vale per tutti i nomi oggetto di analisi (v481)."""
    t = tendenza(barre, adesso)
    m = macro_nome(fcf_di(riga), sem)
    prove = {"tendenza": {**t, "verso": {"rotta": "contro", "in correzione": "neutro", "intatta": "favore"}.get(t["stato"])},
             **prove_fondamentali(riga), "bilancio": prova_bilancio(riga),
             "macro": {**m, "verso": {"acceso": "contro", "spento": "neutro"}.get(m["stato"])}}
    b = concluse(barre or [], adesso)
    return {"prove": prove, "consenso": consenso(riga, b[-1]["c"] if b else None), **esito_bilancio(prove)}


def tenuta_posizioni(tks, barre, righe, sem, prezzi, pmc, qta, pesi, adesso=None, decisioni=None, media=None,
                     pav=None):
    """decisioni: la tabella di LIBRO.md §1quinquies. Una VENDITA PER EVIDENZA con una vendita gia'
    aperta e' una decisione presa; senza, e' una PROPOSTA al CEO. Una vendita aperta su un nome che la
    regola non sostiene da sola (CONFLITTO, OSSERVAZIONE, LASCIAR CORRERE) e' una premessa da
    ridiscutere col CEO. media: cambio, valore del libro e serie per l'aritmetica della media sulle
    posizioni in perdita (media_aritmetica); None = non calcolata, e la resa lo dice. pav: {tk: pavimenti} di
    rotazione.pavimenti sul prezzo di adesso (v489), per la media sui pavimenti sotto il carico; None = non
    calcolati, e la resa tace."""
    vendite = {d["tk"] for d in (decisioni or []) if d.get("aperta") and d.get("verso") == "vendita"}
    md = media or {}
    out = []
    for t in tks:
        v = valuta_tenuta(barre.get(t), righe.get(t), sem, adesso)
        mm = (None if media is None else
              media_aritmetica(prezzi.get(t), pmc.get(t), qta.get(t), pesi.get(t), md.get("valore"), md.get("fx"),
                               (md.get("rend") or {}).get(t), md.get("rlibro"), md.get("rqqq"),
                               (md.get("trim") or {}).get(t)))
        pv = (pav or {}).get(t)
        out.append({"tk": t, "peso": pesi.get(t), **v, "vendita_aperta": t in vendite,
                    "fisco": pareggio_fiscale(prezzi.get(t), pmc.get(t), qta.get(t)), "media": mm,
                    "carico": pmc.get(t), "pavimenti": pv,
                    "media_pavimenti": None if pav is None else media_pavimenti(pv, pmc.get(t), qta.get(t), pesi.get(t), md, t,
                                                                                 prezzi.get(t))})
    out.sort(key=lambda x: (ESITI.index(x["esito"]), -(x["peso"] or 0)))
    return {"righe": out, "seduta": max((x["prove"]["tendenza"].get("seduta") or "" for x in out), default="") or None,
            "colore": (sem or {}).get("colore"), "minimo_semaforo": bool((sem or {}).get("minimo")),
            "media_calcolata": media is not None, "cambio": md.get("fx"), "pav_calcolati": pav is not None}


NOMI_PROVE = {"tendenza": "tendenza", "stime": "stime a 90 giorni", "revisioni": "revisioni a 30 giorni",
              "ricavi": "ricavi del trimestre", "bilancio": "bilancio", "macro": "macro"}


def testo_prova(k, p):
    """Una prova in parole, col suo numero e la sua soglia: la stessa resa per posizioni e sorvegliati
    (una sola, v161). Senza verso dice perche' manca."""
    if k == "tendenza":
        if p.get("verso") is None:
            return f"tendenza NON MISURABILE ({p.get('perche')})"
        nome = {"rotta": "ROTTA", "in correzione": "in correzione", "intatta": "intatta"}[p["stato"]]
        return (f"tendenza {nome}: chiusura {_sg(p['d50_atr'])} ATR dalla media 50, {_sg(p['d200_atr'])} ATR dalla 200"
                + (" · media 50 sotto la 200" if p["incrocio"] else ""))
    if k == "stime":
        if p.get("verso") is None:
            return "stime a 90 giorni n.d."
        a, b, soglia = p["prima"], p["ora"], f"{_it(SOGLIA_EPS_90, 0)}%"
        if a < 0 and b < 0:
            s = f"perdita attesa {'AMPLIATA' if b < a else 'RIDOTTA'} del {_it(abs(p['var']), 1)}% a 90 giorni"
        elif a > 0 > b:
            s = "stima a 90 giorni passata da utile a PERDITA"
        elif a < 0 < b:
            s = "stima a 90 giorni passata da perdita a UTILE"
        else:
            s = f"EPS atteso {_sg(p['var'])}% a 90 giorni"
        return s + (f" (entro il {soglia})" if p["verso"] == "neutro" else "")
    if k == "revisioni":
        if p.get("verso") is None:
            return "revisioni a 30 giorni n.d."
        return f"revisioni a 30 giorni: {p['su']} su, {p['giu']} giù"
    if k == "ricavi":
        if p.get("verso") is None:
            return "ricavi del trimestre n.d."
        return (f"ricavi {_sg(p['yoy'])}% sullo stesso trimestre dell'anno prima (al {p['trim']})"
                + (f" — sotto la soglia di crescita del {_it(SOGLIA_RICAVI, 0)}%" if p["verso"] == "neutro" else ""))
    if k == "bilancio":
        if p.get("verso") is None:
            return f"bilancio n.d. ({p.get('perche')})"
        if p.get("autofinanzia"):
            return f"bilancio SOLIDO: si autofinanzia, flusso di cassa libero positivo su 12 mesi (al {p.get('al') or 'n.d.'})"
        import schede_progetto
        nome = {"contro": "CORTO", "favore": "SOLIDO", "neutro": "intermedio"}[p["verso"]]
        s = (f"bilancio {nome}: brucia cassa, e la {p['numeratore']} copre {schede_progetto._mesi(p['mesi'])} di "
             f"{p['denominatore']} (al {p.get('al') or 'n.d.'})")
        if p.get("ritmo_dividendi"):
            s += f" — ⚠ l'ultimo trimestre di dividendi vale {_it(p['ritmo_dividendi'], 1)} volte la media: sul ritmo recente i mesi sono meno"
        return s + (" — dipende dal mercato dei capitali entro l'anno" if p["verso"] == "contro" else "")
    if k == "macro":
        if p.get("verso") is None:
            return f"macro NON MISURABILE ({p.get('perche')})"
        return f"macro {'ACCESA' if p['verso'] == 'contro' else 'spenta'} ({p.get('perche')})"
    return k


def testo_prove(v):
    """{verso: [testi]} — contro, a favore, in mezzo, non misurate — e due note: quando macro e bilancio
    sono lo stesso canale (il mercato dei capitali) visto da due lati, una prova in due righe non e' due
    prove (B3); quando stime e revisioni puntano in versi opposti, e' la stessa famiglia (le stime degli
    analisti) che si contraddice fra due orizzonti, e il disaccordo e' un fatto da leggere."""
    pr = v["prove"]
    out = {"contro": [], "favore": [], "neutro": [], None: []}
    for k in PROVE:
        out[pr[k].get("verso")].append(testo_prova(k, pr[k]))
    canale = (pr["macro"].get("verso") == "contro" and pr["macro"].get("brucia") and pr["bilancio"].get("verso") == "contro"
              and str(pr["macro"].get("perche", "")).startswith("brucia cassa"))
    discordi = {pr["stime"].get("verso"), pr["revisioni"].get("verso")} == {"contro", "favore"}
    return {"contro": out["contro"], "favore": out["favore"], "neutro": out["neutro"], "ignote": out[None],
            "stesso_canale": canale, "analisti_discordi": discordi}


NOTA_DISCORDI = ("stime a 90 giorni e revisioni a 30 giorni puntano in versi opposti: sono la stessa famiglia — le "
                 "stime degli analisti — su due orizzonti, e le revisioni sono le più recenti")


def riga_prove(v):
    """Le prove di un nome in UNA riga: per i sorvegliati di rotazione.py."""
    t = testo_prove(v)
    pz = [f"contro: {' · '.join(t['contro']) if t['contro'] else 'nessuna prova'}",
          f"a favore: {' · '.join(t['favore']) if t['favore'] else 'nessuna prova'}"]
    if t["neutro"]:
        pz.append(f"in mezzo: {' · '.join(t['neutro'])}")
    if t["ignote"]:
        pz.append(f"non misurate: {' · '.join(t['ignote'])}")
    if t["stesso_canale"]:
        pz.append("macro e bilancio sono lo stesso canale (il mercato dei capitali) visto da due lati")
    if t["analisti_discordi"]:
        pz.append(NOTA_DISCORDI)
    return " ; ".join(pz)


def etichetta_esito(v):
    return v["esito"] + (f" (PROVVISORIO: con i dati mancanti può essere {' o '.join(v['possibili'])})"
                         if v.get("provvisorio") else "")


def righe_tenuta(t):
    if not t or not t.get("righe"):
        return ["TENUTA DELLE POSIZIONI: nessuna posizione azionaria"]
    col = t.get("colore")
    L = [f"TENUTA DELLE POSIZIONI — bilancio dell'evidenza (LIBRO.md §1sexies, decisioni del CEO del 14/10/2026: si "
         f"lascia correre, si vende per EVIDENZA, e si valuta l'insieme — non la sola tecnica) · ultima chiusura "
         f"{t.get('seduta') or 'n.d.'} · semaforo {col or 'n.d.'}" + (" (MINIMO)" if t.get("minimo_semaforo") else ""),
         "  regola: VENDITA PER EVIDENZA = tendenza ROTTA + un'altra prova CONTRO e nessuna prova di CRESCITA a favore · "
         f"{CONFLITTO} = tendenza ROTTA con la crescita a favore (ricavi, stime o revisioni): il prezzo e il bilancio "
         "dicono cose opposte, e decidono notizie e giudizio · IN OSSERVAZIONE = la tendenza rotta da sola, o una prova "
         "contro con la tendenza non rotta · LASCIAR CORRERE = nessuna prova contro · conta QUALI prove ci sono, non "
         "quante: nessun punteggio · soglie = convenzioni scelte col CEO (LIBRO.md §1sexies) · l'esito è la regola "
         "applicata, non un ordine"]
    for r in t["righe"]:
        tp = testo_prove(r)
        L.append(f"  {r['tk']:5} {etichetta_esito(r)}" + (f" · peso {_it(r['peso'] * 100, 1)}%" if r.get("peso") is not None else ""))
        L.append(f"      contro: {' · '.join(tp['contro']) if tp['contro'] else 'nessuna prova'}"
                 + (" (macro e bilancio sono lo stesso canale — il mercato dei capitali — visto da due lati: "
                    "una prova, non due)" if tp["stesso_canale"] else ""))
        L.append(f"      a favore: {' · '.join(tp['favore']) if tp['favore'] else 'nessuna prova'}")
        if tp["analisti_discordi"]:
            L.append(f"      ⚠ {NOTA_DISCORDI}")
        if tp["neutro"] or tp["ignote"]:
            L.append("      " + " ; ".join(([f"in mezzo: {' · '.join(tp['neutro'])}"] if tp["neutro"] else [])
                                         + ([f"non misurate: {' · '.join(tp['ignote'])}"] if tp["ignote"] else [])))
        fuori = []
        c = r.get("consenso")
        if c:
            fuori.append(f"consenso degli analisti (un'opinione, non una prova) mediana {_sg(c['mediana'])}% dalla "
                         f"chiusura, forchetta da {_sg(c['min'])}% a {_sg(c['max'])}%")
        fi = r["fisco"]
        if fi is None:
            fuori.append("pareggio fiscale n.d.")
        elif fi["pareggio_pct"] is not None:
            fuori.append(f"pareggio fiscale {_it(fi['pareggio_pct'], 1)}%: vendere oggi paga ~{_it(fi['imposta'], 0)} $ "
                         "d'imposta, e conviene solo se poi il titolo scende di più")
        else:
            fuori.append(f"in perdita sul carico: minusvalenza ~{_it(fi['minus'], 0)} $, utile solo se ci sono "
                         "plusvalenze da compensare (il sistema non lo sa)")
        L.append(f"      fuori dal bilancio: {' · '.join(fuori)}")
        if r["esito"] == CONFLITTO:
            L.append("      " + testo_scadenza(r, t.get("oggi"), t.get("finestra")))
        m = r.get("media")
        if m and m.get("errore"):
            L.append(f"      media: non calcolabile — {m['errore']}")
        elif m:
            s = (f"      media (un'unità di calcolo, non una quantità): {m['azioni']} azioni a {_it(m['px'])} $ "
                 f"({_it(m['spesa'], 0)} $) → carico da {_it(m['carico_prima'])} a {_it(m['carico_dopo'])}; per tornare al "
                 f"carico serve {_sg(m['rientro_prima'])}% oggi, {_sg(m['rientro_dopo'])}% dopo")
            if m.get("peso_prima") is not None and m.get("peso_dopo") is not None:
                s += f" · peso da {_it(m['peso_prima'] * 100, 1)}% a {_it(m['peso_dopo'] * 100, 1)}%"
            cq = m.get("conseguenze")
            s += (" · conseguenze sul libro n.d." if cq is None else
                  f" · volatilità del libro {_sg(cq['dvol'], 2)} punti, beta su QQQ {_sg(cq['dbeta'], 3)} ({cq['sedute']} sedute)")
            import rotazione
            if m.get("giorni_trim") is not None and m["giorni_trim"] <= rotazione.TRIMESTRALE_VICINA:
                s += (f" · ⚠ trimestrale fra {m['giorni_trim']} giorni: mediare prima dei conti è una scommessa "
                      "binaria (LIBRO.md §1quater)")
            if r["esito"] == "VENDITA PER EVIDENZA":
                s += " · ⚠ con questo esito mediare è comprare CONTRO l'evidenza: speculativo, ammesso e dichiarato"
            if r["vendita_aperta"]:
                s += " · ⚠ c'è una vendita APERTA su questo nome: mediare e vendere non stanno insieme, va decisa prima"
            L.append(s)
        if t.get("pav_calcolati"):
            L.append("      " + riga_pavimenti_posizione(r.get("pavimenti")))
            mp = r.get("media_pavimenti") or []
            if mp:
                cq = mp[0]["media"].get("conseguenze")
                s = (f"      media sui pavimenti (sotto il carico {_it(r['carico'])}; un'unità di calcolo, non una quantità): "
                     + " · ".join(f"a {_it(x['pavimento']['ordine'])} → {x['media']['azioni']} azioni, carico "
                                  f"{_it(x['media']['carico_dopo'])}, per tornare al carico {_sg(x['media']['rientro_prima'])}% "
                                  f"→ {_sg(x['media']['rientro_dopo'])}%"
                                  + (f", peso {_it(x['media']['peso_prima'] * 100, 1)}% → {_it(x['media']['peso_dopo'] * 100, 1)}%"
                                     if x["media"].get("peso_dopo") is not None and x["media"].get("peso_prima") is not None else "")
                                  + f", stop {_it(x['pavimento']['stop'])} ({_it(-x['pavimento']['perdita_eur'], 0)} € ogni 5.000 €)"
                                  for x in mp)
                     + ("" if cq is None else f" · volatilità del libro {_sg(cq['dvol'], 2)} punti, beta su QQQ "
                        f"{_sg(cq['dbeta'], 3)} ({cq['sedute']} sedute)"))
                import rotazione
                gt = mp[0]["media"].get("giorni_trim")
                if gt is not None and gt <= rotazione.TRIMESTRALE_VICINA:
                    s += (f" · ⚠ conti fra {gt} giorni: un ordine sul pavimento attivo durante i conti può eseguirsi "
                          "all'apertura dopo, anche sotto")
                if r["esito"] == "VENDITA PER EVIDENZA":
                    s += " · ⚠ con questo esito mediare è comprare CONTRO l'evidenza: speculativo, ammesso e dichiarato"
                L.append(s)
    L.append("  notizie: NON calcolate — per ogni nome in VENDITA, CONFLITTO o OSSERVAZIONE si cercano in rete NEI DUE "
             "VERSI, con fonte e data: i catalizzatori che possono farlo salire forte (contratti, guida alzata, ordini, "
             "clienti nuovi) e i fatti che rompono la tesi (guida tagliata, cliente perso, diluizione pesante, indagine). "
             "Un fatto che rompe la tesi porta un CONFLITTO o un'OSSERVAZIONE verso la VENDITA; un catalizzatore "
             "verificato porta un CONFLITTO verso il tenere — o il mediare")
    L.append("  consenso: il target degli analisti è un'opinione e resta FUORI dal bilancio; i valori sono nelle schede")
    if not t.get("media_calcolata"):
        L.append("  media: aritmetica NON calcolata in questo giro")
    elif any(r.get("media") for r in t["righe"]):
        import rotazione
        fx, u = t.get("cambio"), rotazione.UNITA_EUR
        L.append(f"  media = un'unità di calcolo da {_it(u, 0)} €" + (f" (≈ {_it(u * fx, 0)} $ al cambio {_it(fx, 4)})"
                 if fx else "") + " sulle sole posizioni in perdita, NON una quantità: dice cosa fa al carico e al "
                 "libro, non se farlo. Mediare ha senso se la tesi regge — il caso di AMD (LIBRO.md §1sexies)")
    if t.get("pav_calcolati"):
        sopra = [r["tk"] for r in t["righe"] if r.get("pavimenti") and r["pavimenti"].get("minimi")
                 and not r.get("media_pavimenti")]
        if sopra:
            L.append(f"  media sui pavimenti: nessun pavimento sotto il carico per {', '.join(sopra)} — lì comprare sui "
                     "pavimenti è un incremento (il carico sale), non una media (v489, LIBRO.md §1bis)")
    L.append("  ⚠ imposta e pareggio in dollari al prezzo di oggi: il conto vero lo fa il broker in euro col cambio di "
             "carico, e regime fiscale e minusvalenze pregresse non sono nel sistema")
    prov = [r["tk"] for r in t["righe"] if r.get("provvisorio")]
    if prov:
        L.append(f"  ⚠ esito PROVVISORIO per {', '.join(prov)}: una prova non si misura, e col dato che manca l'esito "
                 "può cambiare nei versi indicati sulla riga")
    if col in ("arancione", "rosso"):
        L.append(f"  ⚠ semaforo {col}: è una prova CONTRO per ogni nome (famiglia macro), non una vendita — dal 15/10/2026 "
                 "arancione e rosso non vendono, l'unica vendita automatica è il salvavita (LIBRO.md §1ter)")
    vend = [r for r in t["righe"] if r["esito"] == "VENDITA PER EVIDENZA"]
    gia = [r["tk"] for r in vend if r["vendita_aperta"]]
    nuove = [r["tk"] for r in vend if not r["vendita_aperta"]]
    if gia:
        L.append(f"  VENDITA PER EVIDENZA con la decisione già aperta (blocco DECISIONI APERTE): {', '.join(gia)}")
    if nuove:
        L.append(f"  VENDITA PER EVIDENZA SENZA decisione aperta: {', '.join(nuove)} — si PROPONE al CEO, la decisione è sua")
    conf = [r["tk"] for r in t["righe"] if r["esito"] == CONFLITTO]
    if conf:
        L.append(f"  {CONFLITTO}: {', '.join(conf)} — prezzo e bilancio dicono cose opposte: la lettura la fanno le "
                 "notizie, nei due versi, e la decisione è del CEO · ciascuno si decide ai propri conti, con l'esame "
                 f"scritto prima e mandato al CEO {GIORNI_ESAME} giorni prima (LIBRO.md §1sexies)")
    senza = [f"{r['tk']} ({r['esito']})" for r in t["righe"] if r["vendita_aperta"] and r["esito"] != "VENDITA PER EVIDENZA"]
    if senza:
        L.append(f"  ⚠ vendita APERTA che la regola non sostiene da sola: {', '.join(senza)} — la premessa va ridiscussa "
                 "col CEO")
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
            "semaforo": colore, "versione": 485}


def chiusure_non_confermate(seduta, nomi, barre, adesso=None):
    """v485 — i nomi la cui barra della seduta `seduta` NON e' marcata 'ufficiale' (brief.chiusura_ufficiale),
    quando la seduta e' OGGI a New York: la sera stessa della campana l'ultima barra dello storico puo' non
    essere ancora la chiusura definitiva, e una riga del registro e' un fatto permanente. Per una seduta
    passata lo storico e' gia' definitivo (misurato: v485) e la lista e' vuota. Un nome senza barra quel
    giorno non e' qui: e' un prezzo mancante, che il TWR salta e nomina."""
    import brief
    if not brief.dopo_la_campana(seduta, adesso):
        return []
    out = []
    for tk in nomi:
        b = next((x for x in (barre.get(tk) or []) if x["t"] == seduta), None)
        if b is not None and not b.get("ufficiale"):
            out.append(tk)
    return sorted(out)


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
            manca = chiusure_non_confermate(riga["seduta"], sorted(riga["prezzi"]) + ["QQQ"], barre, adesso)
            if manca:
                # v485 — meglio una riga in meno che una riga sbagliata (istruzione permanente del CEO, v396)
                esito = (f"non scritto: chiusure del {riga['seduta']} non ancora confermate dalla quotazione per "
                         f"{', '.join(manca)} — la sera stessa della campana l'ultima barra dello storico può non essere "
                         "quella definitiva (v485): si riprova più tardi")
            else:
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


# ════════════════════════════════════════════════════════════════ v484 — PIANO DI RIDUZIONE E SALVAVITA
# Decisioni del CEO del 14/10/2026, sera, alle domande sulle logiche della tenuta (LIBRO.md §1ter, §1sexies):
#  1 «tra b e c» — il gradino dell'arancione (e del rosso) toglie un terzo dei semiconduttori IN PROPORZIONE
#    AL RISCHIO di ciascuno: una via di mezzo fra il togliere solo MU e AMD e il togliere un terzo di ciascuno.
#    Chi porta piu' rischio di quanto pesa si taglia di piu' di un terzo, chi ne porta meno (oggi NVDA) di
#    meno. Si vende, non ci si copre: il CEO non opera con opzioni o ETF short, per ora.
#  2a — il SALVAVITA: a -30% dal massimo dell'azionario, sul rendimento ponderato per il tempo del registro
#    (vendite, acquisti e depositi non lo falsano), lo stesso gradino, qualunque sia il colore del semaforo.
#  3a — ogni CONFLITTO si decide ai conti successivi, con un ESAME scritto prima e mandato al CEO 7 giorni
#    prima (righe «Esami dei conflitti» di LIBRO.md §1quinquies).
#  4b — il rallentamento della crescita NON e' una prova: proposta respinta, nessun codice.
# Il piano si calcola PRIMA (§1ter: "si decidono PRIMA i segnali e la reazione, poi si esegue senza
# ridiscuterla"): il 14/10 SMH stava l'1,4% sopra la propria media a 50 col credito gia' acceso, cioe' a
# una seduta normale dall'arancione. E' la regola del CEO applicata, non una raccomandazione (v439).
# v486 — 15/10/2026: l'arancione e' arrivato e il CEO non ha eseguito il gradino («non vendi sui ribassi ma
# sui massimi»); alle due domande ha risposto «Solo il salvavita» e «Solo col semaforo acceso». Quindi il
# gradino resta, calcolato ogni giorno, ma si esegue SOLO col salvavita scattato: arancione e rosso no.
QUOTA_GRADINO = 1 / 3        # «un terzo dei semiconduttori», il gradino del salvavita: LIBRO.md §1ter
SOGLIA_SALVAVITA = -0.30     # convenzione scelta col CEO il 14/10 (v240): un gate la rilegge dal libro
GIORNI_ESAME = 7             # l'esame di un conflitto si manda al CEO la settimana prima dei conti


def semiconduttori_libro(testo=None):
    """L'elenco di LIBRO.md §1ter, riga «**I semiconduttori del libro** (…): MU, NVDA, …». Il settore non
    e' nei dati (la pipeline mette RGTI fra i semiconduttori e SK hynix no, v473): lo dichiara il libro, e
    chi ne resta fuori si NOMINA a ogni analisi (v406). None = riga non trovata, che si dichiara."""
    if testo is None:
        testo = testo_libro()
    i = testo.find("## 1ter")
    if i < 0:
        return None
    j = testo.find("\n## ", i + 1)
    for riga in testo[i:j if j > 0 else len(testo)].splitlines():
        if riga.startswith("**I semiconduttori del libro**") and "):" in riga:
            nomi = [x.strip() for x in riga.split("):", 1)[1].split(".")[0].split(",")]
            return [x for x in nomi if re.fullmatch(r"[A-Z][A-Z0-9\-]*", x)]
    return None


def piano_riduzione(semi, val, qty, px, pmc, mcr, R=None, nomi_R=None, quota=QUOTA_GRADINO):
    """Il gradino dell'arancione e del salvavita: `quota` dei semiconduttori del libro ripartita IN
    PROPORZIONE AL RISCHIO (contributo di Euler, `mcr`). La frazione venduta di un nome e' quota x (sua parte
    del rischio) / (sua parte del valore), fra i semiconduttori di cui il rischio si misura: oltre la quota
    per chi porta piu' rischio di quanto pesa, sotto per chi ne porta meno. Un nome fuori matrice si taglia
    per PESO, dichiarato; un contributo nullo o negativo non si vende (toglierlo non toglie rischio). Mai
    oltre la posizione: l'eccedenza si ripartisce sugli altri, e quella che non trova posto si dichiara.
    Azioni intere, le piu' vicine. R, nomi_R: rendimenti log giornalieri (sedute x nomi) per il rischio in
    dollari prima e dopo; None = non calcolato, e la resa lo dice."""
    import conseguenze
    if semi is None:
        return {"errore": "elenco dei semiconduttori NON trovato in LIBRO.md §1ter"}
    presenti = [t for t in semi if (val.get(t) or 0) > 0]
    out = {"presenti": presenti, "fuori_elenco": [t for t in semi if t not in presenti],
           "fuori_piano": [t for t in val if t not in semi], "quota": quota,
           "totale": sum(val[t] for t in presenti), "libro": sum(val.values())}
    out["obiettivo"] = out["totale"] * quota
    misurati = [t for t in presenti if mcr.get(t) is not None]
    vend = {t: (0.0 if t in misurati else val[t] * quota) for t in presenti}
    attivi = [t for t in misurati if mcr[t] > 0]
    resto = quota * sum(val[t] for t in misurati)
    while attivi and resto > 1e-6:
        s = sum(mcr[t] for t in attivi)
        parti = {t: resto * mcr[t] / s for t in attivi}
        pieni = [t for t in attivi if parti[t] >= val[t] - vend[t] - 1e-9]
        if not pieni:
            for t in attivi:
                vend[t] += parti[t]
            resto = 0.0
            break
        for t in pieni:
            resto -= val[t] - vend[t]
            vend[t] = val[t]
            attivi.remove(t)
    out["non_ripartito"] = resto if resto > 1e-6 else 0.0
    righe = []
    for t in presenti:
        n = qty[t] if vend[t] >= val[t] - 1e-6 else min(qty[t], int(round(vend[t] / px[t])))
        guad = n * (px[t] - pmc[t]) if pmc.get(t) is not None else None
        righe.append({"tk": t, "mcr": mcr.get(t), "peso": val[t] / out["libro"], "teorico": vend[t], "azioni": n,
                      "venduto": n * px[t], "frazione": n / qty[t] if qty[t] else None,
                      "per_peso": t not in misurati, "nullo": t in misurati and mcr[t] <= 0,
                      "imposta": conseguenze.ALIQUOTA * guad if guad is not None and guad > 0 else 0.0,
                      "minus": -guad if guad is not None and guad < 0 else 0.0})
    out["righe"] = righe
    out["venduto"] = sum(r["venduto"] for r in righe)
    out["imposta"] = sum(r["imposta"] for r in righe)
    out["minus"] = sum(r["minus"] for r in righe)
    out["peso_semi_prima"] = out["totale"] / out["libro"] if out["libro"] else None
    out["peso_semi_dopo"] = ((out["totale"] - out["venduto"]) / (out["libro"] - out["venduto"])
                             if out["libro"] > out["venduto"] else None)
    out["rischio"] = None
    if R is not None and nomi_R:
        C = np.atleast_2d(np.cov(np.asarray(R, float), rowvar=False)) * 252
        venduto = {r["tk"]: r["venduto"] for r in righe}
        v0 = np.array([val.get(t, 0.0) for t in nomi_R])
        v1 = np.array([val.get(t, 0.0) - venduto.get(t, 0.0) for t in nomi_R])
        out["rischio"] = {"prima": math.sqrt(float(v0 @ C @ v0)), "dopo": math.sqrt(float(v1 @ C @ v1)),
                          "fuori": [t for t in val if t not in nomi_R]}
    return out


def righe_piano(p, colore=None, salv=None):
    """Il piano in parole. Da eseguire SOLO col salvavita scattato (v486, decisione del CEO del 15/10/2026:
    arancione e rosso non vendono piu'): in ogni altro caso si stampa perche' la reazione si decide prima
    (§1ter), e il colore si nomina perche' chi legge non lo scambi per un ordine."""
    if not p:
        return []
    if p.get("errore"):
        return [f"PIANO DI RIDUZIONE: NON calcolato — {p['errore']}"]
    pc = lambda x, d=1: "n.d." if x is None else _it(x * 100, d)
    attivo = bool((salv or {}).get("scattato_il"))
    L = [("⚠⚠ " if attivo else "") + "PIANO DI RIDUZIONE — il gradino del salvavita, calcolato prima "
         "(LIBRO.md §1ter, decisioni del CEO del 14/10/2026: un terzo dei semiconduttori, in proporzione al rischio di "
         f"ciascuno; e del 15/10/2026: arancione e rosso non vendono) · semaforo {colore or 'n.d.'}"
         + (" · DA ESEGUIRE: il salvavita è scattato" if attivo else
            " · si esegue SOLO col salvavita scattato"
            + (f" — il semaforo {colore} è un segnale, non una vendita" if colore in ("arancione", "rosso") else ""))]
    if not p["presenti"]:
        L.append("  nessun semiconduttore dell'elenco di LIBRO.md §1ter è in portafoglio: il gradino non ha niente da togliere")
    else:
        L.append(f"  semiconduttori del libro (elenco di LIBRO.md §1ter): {', '.join(p['presenti'])} = {_it(p['totale'], 0)} $ "
                 f"({pc(p['peso_semi_prima'])}% dell'azionario) · un terzo = {_it(p['obiettivo'], 0)} $")
        for r in sorted(p["righe"], key=lambda x: -x["venduto"]):
            if r["per_peso"]:
                perche = "fuori matrice: il suo rischio non si misura, si taglia per PESO"
            elif r["nullo"]:
                perche = f"contributo al rischio {pc(r['mcr'])}%: toglierlo non toglie rischio, non si vende"
            else:
                perche = f"rischio {pc(r['mcr'])}% del libro su un peso del {pc(r['peso'])}%"
            fisco = (f"imposta ~{_it(r['imposta'], 0)} $" if r["imposta"] else
                     f"minusvalenza ~{_it(r['minus'], 0)} $" if r["minus"] else "nessuna imposta")
            L.append(f"  {r['tk']:5} vendere {r['azioni']} azioni = {_it(r['venduto'], 0)} $ "
                     f"({pc(r['frazione'], 0)}% della posizione) · {perche} · {fisco}")
        rs = p.get("rischio")
        tot = (f"  totale {_it(p['venduto'], 0)} $ · imposta ~{_it(p['imposta'], 0)} $"
               + (f" · minusvalenze ~{_it(p['minus'], 0)} $" if p["minus"] else "")
               + (f" · i semiconduttori passano dal {pc(p['peso_semi_prima'])}% al {pc(p['peso_semi_dopo'])}% "
                  "dell'azionario" if p.get("peso_semi_dopo") is not None else ""))
        if rs and rs["prima"]:
            tot += (f" · rischio del libro in dollari (una deviazione standard annua) da {_it(rs['prima'], 0)} $ a "
                    f"{_it(rs['dopo'], 0)} $ ({_sg((rs['dopo'] / rs['prima'] - 1) * 100)}%)"
                    + (f", senza {', '.join(rs['fuori'])} che è fuori matrice" if rs["fuori"] else ""))
        else:
            tot += " · rischio prima e dopo n.d."
        L.append(tot)
        if p.get("non_ripartito"):
            L.append(f"  ⚠ {_it(p['non_ripartito'], 0)} $ del gradino non trovano posto: i nomi che possono venderli sono "
                     "già venduti per intero, o il loro contributo al rischio è nullo — il gradino resta incompleto, e lo si dice")
    if p["fuori_piano"]:
        L.append(f"  fuori dal piano (non nell'elenco dei semiconduttori): {', '.join(p['fuori_piano'])} — se uno di loro "
                 "è un semiconduttore, l'elenco va corretto in LIBRO.md §1ter")
    if p["fuori_elenco"]:
        L.append(f"  ⚠ nell'elenco dei semiconduttori ma non in portafoglio: {', '.join(p['fuori_elenco'])}")
    L.append("  ⚠ è la regola del CEO applicata, non una raccomandazione · un terzo dei semiconduttori di OGGI · il "
             "salvavita scatta una volta per discesa, e dopo il suo gradino non ce n'è un secondo automatico (decisione "
             "del CEO del 15/10/2026) · azioni intere, le più vicine · imposta in dollari al prezzo di oggi: il "
             "conto vero lo fa il broker in euro col cambio di carico")
    return L


def salvavita(righe, provvisoria=None, soglia=SOGLIA_SALVAVITA):
    """Il calo dell'azionario dal suo massimo sul rendimento ponderato per il tempo del registro: ogni
    intervallo con le posizioni del suo INIZIO (intervallo(), la stessa funzione del confronto con QQQ, v161),
    quindi vendite, acquisti e depositi non lo falsano. provvisoria = la riga della seduta conclusa non ancora
    registrata (nuova_riga, non scritta). Scatta UNA volta per discesa — la data e' la prima seduta oltre la
    soglia dopo l'ultimo massimo — e si riarma col massimo nuovo. Gli intervalli saltati si NOMINANO."""
    rr = list(righe or [])
    if provvisoria and (not rr or provvisoria["seduta"] > rr[-1]["seduta"]):
        rr.append(provvisoria)
    else:
        provvisoria = None
    if len(rr) < 2:
        return {"stato": "non misurabile", "soglia": soglia,
                "perche": "il registro della performance ha meno di due sedute: il calo si misura dalla seconda"}
    liv = picco = 1.0
    massimo, scattato, peggiore, n, saltati = rr[0]["seduta"], None, 0.0, 0, []
    for a, b in zip(rr, rr[1:]):
        r, perche = intervallo(a, b)
        if r is None:
            saltati.append(f"{a['seduta']}→{b['seduta']}: {perche}")
            continue
        liv *= 1 + r["libro"]
        n += 1
        if liv >= picco:
            picco, massimo, scattato = liv, b["seduta"], None
        calo = liv / picco - 1
        peggiore = min(peggiore, calo)
        if calo <= soglia and scattato is None:
            scattato = b["seduta"]
    if not n:
        return {"stato": "non misurabile", "soglia": soglia, "saltati": saltati,
                "perche": "nessun intervallo del registro ha tutti i prezzi"}
    calo = liv / picco - 1
    return {"stato": "misurato", "soglia": soglia, "dal": rr[0]["seduta"], "al": rr[-1]["seduta"], "intervalli": n,
            "massimo": massimo, "calo": calo, "peggiore": peggiore, "scattato_il": scattato,
            "ulteriore": (1 + soglia) / (1 + calo) - 1, "saltati": saltati, "provvisoria": provvisoria is not None}


def righe_salvavita(s):
    if not s:
        return []
    soglia = _it(s["soglia"] * 100, 0)
    if s["stato"] != "misurato":
        return [f"SALVAVITA (LIBRO.md §1ter, decisione del CEO del 14/10/2026: {soglia}% dal massimo dell'azionario) — "
                f"NON MISURABILE: {s['perche']}"]
    if s["scattato_il"]:
        L = [f"⚠⚠ SALVAVITA SCATTATO il {s['scattato_il']}: l'azionario è {_sg(s['calo'] * 100, 2)}% dal massimo del "
             f"{s['massimo']} (soglia {soglia}%) — la reazione è il gradino del blocco PIANO DI RIDUZIONE, qualunque sia "
             "il colore del semaforo: è l'unica vendita automatica del libro, una volta per discesa (LIBRO.md §1ter, "
             "decisione del CEO del 15/10/2026) · va in cima alla risposta, prima di tutto il resto"]
    else:
        L = [f"SALVAVITA (LIBRO.md §1ter, decisione del CEO del 14/10/2026) — azionario {_sg(s['calo'] * 100, 2)}% dal "
             f"massimo del {s['massimo']} · scatta a {soglia}%, cioè con un altro {_sg(s['ulteriore'] * 100, 1)}% da qui · "
             f"peggior calo dal {s['dal']}: {_sg(s['peggiore'] * 100, 2)}%"]
    L.append(f"  misura: rendimento ponderato per il tempo del registro della performance, in dollari, dal {s['dal']} al "
             f"{s['al']} ({_conta(s['intervalli'], 'intervallo', 'intervalli')}"
             + (", l'ultimo fino alla chiusura non ancora registrata" if s["provvisoria"] else "")
             + "): vendite, acquisti e depositi non lo falsano · il massimo si conta dalla prima riga del registro")
    if s["saltati"]:
        L.append(f"  ⚠ {_conta(len(s['saltati']), 'intervallo saltato', 'intervalli saltati')}: " + "; ".join(s["saltati"]))
    return L


def con_scadenze(t, scadenze, esami, finestra=None, adesso=None):
    """Aggiunge a ogni riga della tenuta la prima trimestrale dichiarata dalla fonte e l'esame scritto in
    LIBRO.md §1quinquies (decisione del CEO del 14/10/2026: ogni CONFLITTO si decide ai conti successivi, con
    l'esame scritto prima). Separata da tenuta_posizioni: la tenuta pesa le prove, questa ne fissa la data."""
    if not t or not t.get("righe"):
        return t
    per_tk = {e["tk"]: e for e in (esami or [])}
    for r in t["righe"]:
        r["scadenza"] = (scadenze or {}).get(r["tk"])
        r["esame"] = per_tk.get(r["tk"])
    t["finestra"] = finestra
    t["oggi"] = (adesso or datetime.now(timezone.utc)).date().isoformat()
    t["esami_letti"] = esami is not None
    return t


def testo_scadenza(r, oggi=None, finestra=None):
    """La scadenza di un CONFLITTO: i conti successivi, con l'esame mandato al CEO 7 giorni prima. La data e'
    quella dichiarata dalla fonte, mai proiettata (v396): se cambia, la scadenza si sposta con lei."""
    pre = "scadenza (LIBRO.md §1sexies, decisione del CEO del 14/10/2026): "
    if "scadenza" not in r:
        return pre + "NON calcolata in questo giro"
    es, sc = r.get("esame"), r.get("scadenza")
    if es and es.get("conti") and oggi and es["conti"] <= oggi:
        return pre + (f"conti del {es['conti']} USCITI — l'esame scritto (§1quinquies) si confronta coi risultati, e la "
                      "decisione è del CEO")
    if not sc:
        return pre + (f"nessuna trimestrale dichiarata dalla fonte nei prossimi {finestra or 'n.d.'} giorni: il conflitto "
                      "resta senza data, e lo si dice (non è 'nessuna uscita')"
                      + (" · esame scritto (§1quinquies)" if es else ""))
    s = pre + f"si decide coi conti del {sc['data']} ({sc['giorni']} g{_da_emittente(sc)})"
    if es:
        return s + " · esame scritto (§1quinquies)"
    if sc["giorni"] <= GIORNI_ESAME:
        return s + f" · ⚠ esame DA SCRIVERE ORA e da mandare al CEO: i conti sono entro {GIORNI_ESAME} giorni"
    dal = (datetime.fromisoformat(sc["data"]) - timedelta(days=GIORNI_ESAME)).date().isoformat()
    return s + f" · esame da mandare al CEO dal {dal} (fra {sc['giorni'] - GIORNI_ESAME} g)"


def sintesi(o):
    """Righe compatte per la chat: numeri, non frasi di giudizio."""
    r, b = o["rischio"], o["bench"]
    p = lambda x, d=2: "n.d." if x is None else f"{x*100:+.{d}f}%"
    # v474 — il semaforo per primo: e' la sezione 0 della risposta (FORMATO_ANALISI.md)
    L = (righe_semaforo(o["semaforo"], precedente_semaforo(o.get("registro"), o["semaforo"].get("seduta")), r["mcr"])
         if o.get("semaforo") else [])
    # v484 — subito sotto il semaforo: il salvavita e il gradino di riduzione, decisi prima (LIBRO.md §1ter)
    if o.get("salvavita"):
        L.extend(righe_salvavita(o["salvavita"]))
    if o.get("piano"):
        L.extend(righe_piano(o["piano"], (o.get("semaforo") or {}).get("colore"), o.get("salvavita")))
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
    if "rimandate" in o:
        L.extend(righe_rimandate(o["rimandate"], o.get("calendario"), (o.get("calendario") or {}).get("finestra") or 45))
    if "ordini" in o:                     # v489
        L.extend(righe_ordini(o["ordini"], (o.get("calendario") or {}).get("finestra") or 45))
    if o.get("credito"):
        L.extend(righe_credito(o["credito"]))
    if o.get("tenuta"):
        L.extend(righe_tenuta(o["tenuta"]))
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
