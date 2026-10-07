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
from datetime import datetime
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


SEDUTE_BETA = 250


def seduta_in_corso(barre, adesso=None):
    """Vero se l'ultima barra e' quella di OGGI a New York e la campana delle 16:00 non e' ancora
    suonata: quella barra e' in formazione (v439, v469). Il fuso, mai uno scarto a mano (v470)."""
    if not barre:
        return False
    adesso = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    return barre[-1]["t"] == adesso.date().isoformat() and adesso.hour < 16


def beta_mercato(rt, rm, n=SEDUTE_BETA):
    """Beta del titolo sull'S&P 500 (SPY) e il suo R2, sulle ultime n date COMUNI (v207): quanto
    il titolo amplifica il mercato. Un beta senza R2 e' mezzo numero (v316). Sotto 60 date
    comuni non e' una misura: None."""
    comuni = sorted(set(rt) & set(rm))[-n:]
    if len(comuni) < 60:
        return None, None, len(comuni)
    x = [rm[t] for t in comuni]; y = [rt[t] for t in comuni]
    mx, my = sum(x) / len(x), sum(y) / len(y)
    vx = sum((v - mx) ** 2 for v in x); vy = sum((v - my) ** 2 for v in y)
    if not vx or not vy:
        return None, None, len(comuni)
    cov = sum((a - mx) * (b - my) for a, b in zip(x, y))
    return cov / vx, cov * cov / (vx * vy), len(comuni)


def vol_annua(rt, n=SEDUTE_BETA):
    """Volatilita' annualizzata in %: deviazione dei rendimenti giornalieri x radice di 252
    (convenzione dichiarata: sedute indipendenti)."""
    r = [rt[t] for t in sorted(rt)][-n:]
    if len(r) < 60:
        return None
    m = sum(r) / len(r)
    return math.sqrt(sum((v - m) ** 2 for v in r) / (len(r) - 1)) * math.sqrt(252) * 100


def target_pipeline(dati):
    """Prezzo obiettivo degli analisti dalla pipeline (data.json, analisti.target_*): e' la
    fonte gia' sorvegliata, e porta la data del proprio run. Un titolo che la pipeline non segue
    NON ha un target qui: si dichiara, non si inventa (v396)."""
    out = {}
    for r in (dati.get("watchlist") or []) + (dati.get("portfolio") or []):
        a = r.get("analisti") or {}
        if a.get("target_mediana") is not None:
            out[r.get("ticker")] = {"mediana": a.get("target_mediana"), "min": a.get("target_min"),
                                    "max": a.get("target_max")}
    return out


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


def rsi_wilder(barre, n=14):
    """RSI a smorzamento di Wilder, seme = media delle prime n variazioni (la convenzione della
    pipeline, verificata in v436). Sotto 100 barre il valore dipende dalla convenzione piu' che
    dal mercato (v436, SKHY 58-75 secondo il seme): None, un buco e non un numero."""
    c = [x["c"] for x in barre]
    if len(c) < 100:
        return None
    d = [b - a for a, b in zip(c, c[1:])]
    g = sum(max(x, 0) for x in d[:n]) / n
    p = sum(max(-x, 0) for x in d[:n]) / n
    for x in d[n:]:
        g = (g * (n - 1) + max(x, 0)) / n
        p = (p * (n - 1) + max(-x, 0)) / n
    return 100.0 if p == 0 else 100 - 100 / (1 + g / p)


def volumi(barre, adesso=None):
    """Volume dell'ultima seduta CONCLUSA contro la media delle 20 precedenti, e media delle
    ultime 20 contro quella delle 60: la prima dice se l'ultima seduta e' stata partecipata,
    la seconda se l'interesse sta crescendo. Sedute senza volume escono dal conto (v205).
    ⚠ v471 — a borsa aperta l'ultima barra e' quella di OGGI, in formazione: il 07/10 alle 09:46
    di New York dava 0,03-0,3x la media su tutti i titoli, cioe' un crollo d'interesse che non
    c'era. Quella barra si toglie, e la riga dice di quale seduta parla."""
    if seduta_in_corso(barre, adesso):
        barre = barre[:-1]
    v = [x.get("v") for x in barre]
    if len(v) < 81 or any(x is None for x in v[-81:]):
        return {"vol_ultima_rel": None, "vol_20_su_60": None, "vol_seduta": None}
    m20p = sum(v[-21:-1]) / 20
    m20 = sum(v[-20:]) / 20
    m60 = sum(v[-80:-20]) / 60
    return {"vol_ultima_rel": v[-1] / m20p if m20p else None,
            "vol_20_su_60": m20 / m60 if m60 else None, "vol_seduta": barre[-1]["t"]}


def scheda(tk, barre, rlibro, rspy=None, target=None):
    t = brief.tecnica(tk, d=barre) if barre else {"tk": tk, "errore": "nessuna barra"}
    if t.get("errore"):
        return {"tk": tk, "errore": t["errore"]}
    pend = pendenza_sma50(barre)
    rt = rendimenti_per_data(barre)
    corr = correlazione(rt, rlibro)
    beta, r2, nb = beta_mercato(rt, rspy or {})
    tg = (target or {}).get(tk)
    tg_dist = (tg["mediana"] / t["px"] - 1) * 100 if tg and t.get("px") else None
    return {"tk": tk, "px": t["px"], "seduta": t.get("seduta_quota") or t["seduta"],
            "m1": variazione(barre, 21), "m3": variazione(barre, 63),
            "d50_atr": t["d50_atr"], "d200_atr": t["d200_atr"], "pend50": pend,
            "supp": t["supporto20"], "supp_atr": t["supp_atr"], "res": t["resistenza20"],
            "res_atr": t["res_atr"], "dmax52": t["dmax52_pct"], "corr_libro": corr,
            "sma200": t["sma200"], "sma20": t["sma20"], "sma50": t["sma50"],
            "d20_atr": t["d20_atr"], "atr_pct": t["atr_pct"], "rsi": rsi_wilder(barre),
            "max52": t["max52"], "beta_spy": beta, "r2_spy": r2, "sedute_beta": nb,
            "vol_annua": vol_annua(rt), "target": tg, "target_dist": tg_dist, **volumi(barre)}


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
        tilt, d = [], {}
    target = target_pipeline(d)
    asof_target = d.get("updated_at")
    nomi = sorted({p["tk"] for r in tilt for p in (r.get("prime") or [])})
    tutti = sorted(set(qta) | {r["ticker"] for r in tilt} | set(nomi) | {s["tk"] for s in sorv} | {"SPY"})
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        B = dict(zip(tutti, ex.map(_barre_sicure, tutti)))
    rlibro = serie_libro({tk: B.get(tk) for tk in qta if B.get(tk)}, qta)
    rspy = rendimenti_per_data(B["SPY"]) if B.get("SPY") else {}
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        S = dict(zip(tutti, ex.map(lambda tk: scheda(tk, B.get(tk), rlibro, rspy, target), tutti)))
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
    watch = [{**(S.get(s["tk"]) or {"tk": s["tk"], "errore": "non letto"}),
              "stato": stato_titolo(*(lambda x: (x.get("px"), x.get("sma200"), x.get("pend50"),
                                                  x.get("d50_atr"), x.get("corr_libro")))(S.get(s["tk"]) or {}))}
             for s in sorv]
    return {"settori": settori, "universo_assente": not tilt, "libro": sorted(qta),
            "libro_sedute": len(rlibro), "watchlist": watch, "asof_target": asof_target,
            "spy_assente": not rspy}


def n(x, d=1, s=""):
    return "n.d." if x is None else f"{x:+.{d}f}{s}".replace(".", ",")


def piano(x, d=1):
    """Grandezze senza verso (un peso, un'ampiezza): niente segno davanti (v430)."""
    return "n.d." if x is None else f"{x:.{d}f}".replace(".", ",")


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


def riga_target_beta(t):
    """Target, beta e volatilita' in una riga (v471, richiesta del CEO del 07/10/2026). Il beta
    viaggia col suo R2 e il campione (v316); il target dice da dove viene, e se manca lo dice."""
    tg = t.get("target")
    if tg:
        ttxt = (f"target analisti (pipeline) mediana {prezzo(tg['mediana'])} ({n(t.get('target_dist'),1,'%')} dal "
                f"prezzo) · forchetta {prezzo(tg.get('min'))}-{prezzo(tg.get('max'))}")
    else:
        ttxt = "target: n.d. — titolo non seguito dalla pipeline, il sistema non ha la stima degli analisti"
    b = t.get("beta_spy")
    btxt = ("beta S&P 500 n.d. (storia comune insufficiente)" if b is None else
            f"beta S&P 500 {piano(b, 2)} (R2 {piano(t.get('r2_spy'), 2)}, {t.get('sedute_beta')} sedute)")
    return f"{ttxt} · {btxt} · volatilita' annua {piano(t.get('vol_annua'), 0)}%"


def riga_volumi(t):
    vr, vt = t.get("vol_ultima_rel"), t.get("vol_20_su_60")
    return (f"volumi: seduta conclusa del {t.get('vol_seduta') or 'n.d.'} "
            f"{'n.d.' if vr is None else format(vr, '.2f').replace('.', ',') + 'x la media a 20'} · media 20 "
            f"{'n.d.' if vt is None else format(vt, '.2f').replace('.', ',') + 'x la media a 60'}")


def righe_watchlist(o):
    """I sorvegliati del libro (memoria/LIBRO.md) con la stessa misura dei candidati (v471): la
    sezione 7 dell'analisi li riporta sempre."""
    w = o.get("watchlist") or []
    L = [f"WATCHLIST DEL LIBRO — {len(w)} nomi · target dalla pipeline (run {o.get('asof_target') or 'n.d.'}) · "
         "beta e volatilita' su un anno di sedute (stockanalysis.com) · stati = convenzioni in testa allo script"]
    if o.get("spy_assente"):
        L.append("   ⚠ serie dell'S&P 500 NON letta: i beta mancano tutti, non sono zero")
    for t in w:
        if t.get("errore"):
            L.append(f"   {t['tk']:6} non letto ({t['errore']})"); continue
        L.append(f"   {t['tk']:6} {prezzo(t['px'])} · {t['stato']} · 1m {n(t['m1'],1,'%')} · 3m {n(t['m3'],1,'%')} · "
                 f"media50 {n(t['d50_atr'],1)} ATR · supp {prezzo(t['supp'])} · res {prezzo(t['res'])}")
        L.append(f"          {riga_target_beta(t)}")
        L.append(f"          {riga_volumi(t)} · corr libro {n(t.get('corr_libro'),2)}")
    return L


def e_candidato(t):
    return str(t.get("stato", "")).startswith("CANDIDATO") and not t.get("nel_libro")


def notizie_candidati(o, giorni=7):
    """Notizie dal feed Nasdaq PER SIMBOLO, solo per i candidati (v398-v399: l'attribuzione viene
    dalla fonte). Tre esiti distinti: con voci, senza voci, NON letto (v389)."""
    from datetime import datetime, timedelta, timezone
    tks = sorted({t["tk"] for s in o["settori"] for t in s["titoli"] if e_candidato(t)})
    da = datetime.now(timezone.utc) - timedelta(days=giorni)
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        ris = list(ex.map(brief.news_titolo, tks))
    return {tk: {"stato": st, "voci": [v for v in voci if v.get("quando") and v["quando"] >= da][:4]}
            for tk, st, voci in ris}


def righe_candidati(o, news, giorni=7):
    """Il blocco che l'analisi giornaliera riporta SEMPRE (v469): per ogni settore la riga dei
    suoi numeri, e solo i titoli CANDIDATI con tutta la tecnica e le notizie."""
    if o["universo_assente"]:
        return righe(o)[:1]
    L = ["CANDIDATI PER SETTORE — prezzi di oggi (stockanalysis.com) · stati = convenzioni in testa "
         "allo script · volumi sull'ultima seduta CONCLUSA (quella in corso esclusa) · notizie: feed Nasdaq del simbolo, ultimi "
         f"{giorni} giorni ([TK] = trovata nel feed di TK, non 'notizia su TK')"]
    for s in sorted(o["settori"], key=lambda s: -(s.get("m3") if s.get("m3") is not None else -1e9)):
        cand = [t for t in s["titoli"] if e_candidato(t)]
        L.append(f"■ {s['etf']} {s['nome']} — {s['stato']} · 1m {n(s.get('m1'),1,'%')} · 3m {n(s.get('m3'),1,'%')} · "
                 f"media50 {n(s.get('d50_atr'),1)} ATR · media200 {n(s.get('d200_atr'),1)} ATR · "
                 f"corr libro {n(s.get('corr_libro'),2)} · candidati {len(cand)} su {len(s['titoli'])}")
        for t in cand:
            L.append(f"   {t['tk']} ({t.get('nome') or ''}, {piano(t.get('peso_etf'))}% dell'ETF) {prezzo(t['px'])} · "
                     f"1m {n(t['m1'],1,'%')} · 3m {n(t['m3'],1,'%')} · {n(t['dmax52'],1,'%')} dal massimo 52s · "
                     f"RSI14 {'n.d.' if t.get('rsi') is None else format(t['rsi'], '.0f')} · ATR {piano(t.get('atr_pct'))}%")
            L.append(f"      medie: 20 {prezzo(t.get('sma20'))} ({n(t.get('d20_atr'),1)} ATR) · 50 {prezzo(t.get('sma50'))} "
                     f"({n(t['d50_atr'],1)} ATR, pendenza {n(t['pend50'],1,'%')} in 20 sedute) · 200 {prezzo(t['sma200'])} "
                     f"({n(t['d200_atr'],1)} ATR)")
            L.append(f"      livelli: supporto 20s {prezzo(t['supp'])} ({n(t['supp_atr'],1)} ATR) · resistenza 20s "
                     f"{prezzo(t['res'])} ({n(t['res_atr'],1)} ATR) · {riga_volumi(t)} · "
                     f"corr libro {n(t['corr_libro'],2)}")
            L.append(f"      {riga_target_beta(t)}")
            nw = news.get(t["tk"]) or {"stato": "non richiesto", "voci": []}
            if nw["stato"] != "ok":
                L.append(f"      notizie: feed NON letto ({nw['stato']}) — non vuol dire 'nessuna notizia'")
            elif not nw["voci"]:
                L.append(f"      notizie: feed letto, nessuna voce negli ultimi {giorni} giorni")
            for v in nw["voci"]:
                L.append(f"      [{t['tk']}] {v['quando']:%d/%m} {v['titolo'][:110]}")
    return L


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--tutti", action="store_true", help="tabella completa di tutti i titoli, senza notizie")
    a = ap.parse_args()
    o = raccogli()
    if a.json:
        Path(a.json).write_text(json.dumps(o, default=str, indent=1))
    if a.tutti:
        print("\n".join(righe(o)))
    else:
        print("\n".join(righe_candidati(o, notizie_candidati(o))))
        print()
        print("\n".join(righe_watchlist(o)))
