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

v473 — GLI INGRESSI SULLA WATCHLIST (istruzione del CEO del 09/10/2026: "rendi strutturale
questa ultima analisi"). Per ogni sorvegliato di LIBRO.md, convenzioni dichiarate (v240):
  ZONA D'INGRESSO      = la convenzione CANDIDATO tradotta in PREZZI con le medie di oggi: sopra
                         la media a 200, fra 1 ATR sotto e 2 ATR sopra la media a 50. Se la 200
                         sta oltre la 50 + 2 ATR la zona e' VUOTA: nessun prezzo la soddisfa
                         finche' le medie non si avvicinano. Un gate verifica che zona e
                         stato_titolo non divergano.
  LIVELLO D'INGRESSO   = il bordo della zona dalla parte del prezzo: chiusura SOPRA il bordo
                         basso per chi sta sotto, ritorno SOTTO il bordo alto per chi e' tirato.
                         Conta la chiusura, con volume oltre il 50o percentile dell'anno.
  STESSA SCOMMESSA     = correlazione col libro da 0,5 in su, in qualunque stato: non diversifica.
  STRUTTURA DEI MINIMI = minimo delle ultime 10 sedute concluse contro quello delle 10 precedenti.
  STOP                 = il supporto delle 20 sedute, lo stesso livello del brief.
Le trimestrali vengono dal calendario Nasdaq (la fonte delle SCADENZE di numeri_libro); dove
manca nella finestra resta la stima yfinance della pipeline, DICHIARATA come stima (v396). Le
revisioni passano dalla stessa funzione di schede_progetto (v400: il verso dalla differenza).

v474 — IL PIANO PER LA LIQUIDITA' (decisione del CEO del 09/10/2026: in giallo "se c'e'
possibilita' di ingresso non proibirli ma segnalane le conseguenze di rischio"). Per ogni ingresso
possibile — i sorvegliati di LIBRO.md e i candidati di settore — cosa fa al LIBRO AZIONARIO
un'unita' di 5.000 EUR (unita' di calcolo dichiarata, non una quantita' consigliata): variazione
della volatilita' annua e del beta su QQQ, sulle stesse date comuni a libro, QQQ e titolo, e la
perdita allo stop. Il patrimonio e la quota della liquidita' passano da numeri_libro (una grandezza,
un proprietario: v436). Ordine dichiarato: gli operabili per riduzione della volatilita', gli
avvisi per distanza dal livello in ATR.
"""
import argparse, json, math, os, sys
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief
import schede_progetto

SEDUTE_CORR = 60
SOGLIA_CORR = 0.5
CAND_SOPRA_ATR = 2.0
CAND_SOTTO_ATR = -1.0
ESTESO_ATR = 3.0
PENDENZA_SEDUTE = 20
SEDUTE_MINIMI = 10          # v473: struttura dei minimi, 10 sedute concluse contro le 10 prima
SOGLIA_VOL_CONFERMA = 50    # v473: la chiusura sul livello conta con volume oltre la norma dell'anno
GIORNI_CALENDARIO = 45      # v473: la stessa finestra delle SCADENZE di numeri_libro
UNITA_EUR = 5000            # v474: unita' di calcolo delle conseguenze, NON una quantita' consigliata
TRIMESTRALE_VICINA = 14     # v474: giorni; un ingresso prima dei conti e' una scommessa binaria (LIBRO.md §1quater)


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
    # v472 — il CEO: "non capisco il valore dei volumi (dammi una % da 0 a 100)". Il rapporto
    # "0,68x la media a 20" chiede di sapere quanto oscilla quel titolo; il PERCENTILE nell'anno
    # no: 0 = la seduta meno scambiata dell'anno, 100 = la piu' scambiata, 50 = nella norma.
    # Convenzione midrank (meta' dei pari), la stessa di dgPercentile. Le sedute senza volume
    # escono dal confronto: un buco non e' uno zero (v205).
    anno = [x for x in v[-SEDUTE_BETA:] if x is not None]
    medie = [sum(v[i - 20:i]) / 20 for i in range(max(20, len(v) - SEDUTE_BETA + 1), len(v) + 1)
             if all(x is not None for x in v[i - 20:i])]
    return {"vol_ultima_rel": v[-1] / m20p if m20p else None,
            "vol_20_su_60": m20 / m60 if m60 else None, "vol_seduta": barre[-1]["t"],
            "vol_pct_seduta": percentile_midrank(v[-1], anno),
            "vol_pct_20": percentile_midrank(m20, medie), "vol_campione": len(anno)}


def percentile_midrank(x, serie):
    """Quota della serie sotto x, piu' meta' dei pari, x 100. Serie vuota = buco."""
    if x is None or not serie:
        return None
    sotto = sum(1 for y in serie if y < x)
    pari = sum(1 for y in serie if y == x)
    return (sotto + pari / 2) / len(serie) * 100


# ---------------------------------------------------------------- v473: ingressi sulla watchlist
def struttura_minimi(barre, adesso=None, n=SEDUTE_MINIMI):
    """Il minimo delle ultime n sedute CONCLUSE contro quello delle n precedenti (convenzione,
    n=10): crescenti = la discesa ha smesso di fare nuovi minimi, decrescenti = li sta ancora
    facendo. La seduta in corso si toglie: il suo minimo puo' ancora scendere (v471)."""
    if seduta_in_corso(barre or [], adesso):
        barre = barre[:-1]
    if not barre or len(barre) < 2 * n:
        return None
    lo = [x.get("l") for x in barre[-2 * n:]]
    if any(v is None for v in lo):
        return None
    ora, prima = min(lo[n:]), min(lo[:n])
    verso = "crescenti" if ora > prima else ("decrescenti" if ora < prima else "pari")
    return {"ora": ora, "prima": prima, "verso": verso, "fino_a": barre[-1]["t"]}


def dal_minimo(barre, px):
    """Il minimo dell'anno (le barre della fonte coprono un anno, come min52 del brief), quando e'
    stato toccato l'ULTIMA volta, quante sedute fa e quanto il prezzo ne sta sopra."""
    lo = [(i, x.get("l")) for i, x in enumerate(barre or []) if x.get("l") is not None]
    if not lo or px is None:
        return None
    i, v = min(lo, key=lambda iv: (iv[1], -iv[0]))
    return {"minimo": v, "data": barre[i]["t"], "sedute": len(barre) - 1 - i,
            "sopra_pct": (px / v - 1) * 100 if v else None}


def zona_ingresso(t):
    """La convenzione CANDIDATO tradotta in prezzi con le medie di oggi: sopra la media a 200, fra
    1 ATR sotto e 2 ATR sopra la media a 50. Le stesse costanti di stato_titolo: un gate verifica
    che le due letture non divergano. Bordo basso >= bordo alto = zona VUOTA con le medie di oggi."""
    s50, s200, atr = t.get("sma50"), t.get("sma200"), t.get("atr")
    if s50 is None or s200 is None or not atr:
        return None
    sotto50 = s50 + CAND_SOTTO_ATR * atr
    basso, quale = (s200, "media a 200") if s200 >= sotto50 else (sotto50, "media a 50 meno 1 ATR")
    alto = s50 + CAND_SOPRA_ATR * atr
    return {"basso": basso, "quale": quale, "alto": alto, "vuota": basso >= alto}


def gruppo_libro(corr):
    if corr is None:
        return "CORRELAZIONE NON MISURABILE"
    return "STESSA SCOMMESSA DEL LIBRO" if corr >= SOGLIA_CORR else "DIVERSIFICA"


def piano_ingresso(t):
    """Dove sta il prezzo rispetto alla zona, il livello che lo porterebbe dentro, la scala dei
    livelli intorno al prezzo e lo stop. Solo fatti misurati: la frase la scrive la resa."""
    px, atr, z = t.get("px"), t.get("atr"), zona_ingresso(t)
    p = {"gruppo": gruppo_libro(t.get("corr_libro")), "zona": z, "livello": None, "posizione": None,
         "sopra": [], "sotto": [], "stop": None, "rischio": None, "distanza_atr": float("inf"),
         "primo_segnale": None}
    if z is None or px is None or not atr:
        p["posizione"] = "non misurabile"
        return p
    dist = lambda liv: {"prezzo": liv, "pct": (liv / px - 1) * 100, "atr": (liv - px) / atr}
    if z["vuota"]:
        p["posizione"] = "zona vuota"
    elif px < z["basso"]:
        p["posizione"], p["livello"] = "sotto", dist(z["basso"])
    elif px > z["alto"]:
        p["posizione"], p["livello"] = "sopra", dist(z["alto"])
    else:
        p["posizione"] = "dentro"
    livelli = [("media 20", t.get("sma20")), ("media 50", t.get("sma50")), ("media 200", t.get("sma200")),
               ("resistenza 20s", t.get("res")), ("supporto 20s", t.get("supp"))]
    # una resistenza alla pari col prezzo e' ancora da rompere: sta sopra (il 09/10 AMZN chiudeva la
    #   seduta proprio sul massimo delle 20 sedute, e finiva fra i livelli "sotto" a +0,0%)
    su = lambda nm, v: v > px or (nm.startswith("resistenza") and v == px)
    p["sopra"] = sorted(((nm, dist(v)) for nm, v in livelli if v is not None and su(nm, v)), key=lambda x: x[1]["prezzo"])
    p["sotto"] = sorted(((nm, dist(v)) for nm, v in livelli if v is not None and not su(nm, v)), key=lambda x: -x[1]["prezzo"])
    # il PRIMO SEGNALE: la media piu' vicina sopra il prezzo, quando viene prima del livello d'ingresso
    #   o quando la zona e' vuota. Non e' un ingresso: e' la discesa che smette di scendere.
    medie_su = sorted((v, nm) for nm, v in livelli[:3] if v is not None and v > px)
    p["primo_segnale"] = None
    if medie_su and (p["posizione"] == "zona vuota" or (p["posizione"] == "sotto" and medie_su[0][0] < z["basso"])):
        p["primo_segnale"] = (medie_su[0][1], dist(medie_su[0][0]))
    supp = t.get("supp")
    p["stop"] = dist(supp) if supp is not None else None
    # il rischio dall'ingresso allo stop solo se l'ingresso NON e' il prezzo di adesso: per chi e'
    #   gia' dentro la zona coincide con la distanza dello stop, gia' scritta fra i livelli
    ingresso = (p["livello"] or {}).get("prezzo") if p["posizione"] in ("sotto", "sopra") else None
    if ingresso and supp is not None and supp < ingresso:
        p["rischio"] = {"pct": (supp / ingresso - 1) * 100, "atr": (supp - ingresso) / atr, "da": ingresso}
    else:
        p["rischio"] = None
    # distanza dalla zona in ATR, per ordinare la lista: un FATTO, non un giudizio (v200)
    p["distanza_atr"] = 0.0 if p["posizione"] == "dentro" else (
        abs(p["livello"]["atr"]) if p["livello"] else float("inf"))
    return p


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
            "vol_annua": vol_annua(rt), "target": tg, "target_dist": tg_dist, **volumi(barre),
            # v473 — per il piano d'ingresso: l'ATR in prezzo (la zona si misura in ATR), la base
            "atr": t.get("atr"), "min52": t.get("min52"), "minimi": struttura_minimi(barre),
            "dal_minimo": dal_minimo(barre, t["px"])}


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
    pos, cassa, sorv = brief.leggi_libro()
    qta = {p["tk"]: p["qta"] for p in pos if p["valuta"] == "USD"}
    try:
        d = json.loads((Path(brief.RADICE) / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
        tilt = (d.get("macro") or {}).get("tilt") or []
    except (OSError, ValueError):
        tilt, d = [], {}
    target = target_pipeline(d)
    asof_target = d.get("updated_at")
    nomi = sorted({p["tk"] for r in tilt for p in (r.get("prime") or [])})
    tutti = sorted(set(qta) | {r["ticker"] for r in tilt} | set(nomi) | {s["tk"] for s in sorv} | {"SPY", "QQQ"})
    # v473 — il calendario delle trimestrali gira MENTRE si scaricano le barre: ~20 secondi di
    #   richieste a Nasdaq che altrimenti si sommerebbero al resto.
    with ThreadPoolExecutor(1) as ex_cal:
        # v474: tutto l'universo, non i soli sorvegliati — il calendario si legge per GIORNO e si
        #   filtra dopo, quindi i candidati di settore hanno la loro trimestrale allo stesso costo
        fut_cal = ex_cal.submit(calendario_sicuro, tutti)
        with ThreadPoolExecutor(brief.PARALLELI) as ex:
            B = dict(zip(tutti, ex.map(_barre_sicure, tutti)))
        cal = fut_cal.result()
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
    pipe = {r.get("ticker"): r for r in (d.get("watchlist") or []) + (d.get("portfolio") or []) if isinstance(r, dict)}
    prima_trim = {}
    for a in cal.get("attesi") or []:
        prima_trim.setdefault(a["tk"], a)          # gli attesi arrivano gia' in ordine di data
    watch = [{**(S.get(s["tk"]) or {"tk": s["tk"], "errore": "non letto"}),
              "stato": stato_titolo(*(lambda x: (x.get("px"), x.get("sma200"), x.get("pend50"),
                                                  x.get("d50_atr"), x.get("corr_libro")))(S.get(s["tk"]) or {})),
              # v473 — cio' che serve al piano d'ingresso e che la scheda non ha
              "nota": s.get("nota"), "trimestrale": prima_trim.get(s["tk"]),
              "trimestrale_yf": (pipe.get(s["tk"]) or {}).get("earnings_date"),
              "analisti": (pipe.get(s["tk"]) or {}).get("analisti"), "in_pipeline": s["tk"] in pipe}
             for s in sorv]
    # v474 — il piano per la liquidita': patrimonio e cambio da numeri_libro (un proprietario, v436)
    import numeri_libro
    eur_pmc = {p["tk"]: p["pmc"] for p in pos if p["valuta"] == "EUR"}
    eur_nom = {p["tk"]: p["qta"] for p in pos if p["valuta"] == "EUR"}
    fx, fonte_fx, prezzi_eur = numeri_libro.patrimonio_pipeline(d, eur_pmc)
    valore_libro = sum(qta[tk] * B[tk][-1]["c"] for tk in qta if B.get(tk))
    pat = numeri_libro.patrimonio_eur(valore_libro, fx, cassa, [(eur_nom[t], prezzi_eur[t][0]) for t in eur_nom])
    rqqq = rendimenti_per_data(B["QQQ"]) if B.get("QQQ") else {}
    in_watch = {t["tk"] for t in watch}
    possibili = [(t, "watchlist") for t in watch if not t.get("errore")]
    possibili += [({**t, "trimestrale": prima_trim.get(t["tk"])}, f"candidato di settore, {s['etf']} {s.get('nome') or ''}".strip())
                  for s in settori for t in s["titoli"] if e_candidato(t) and t["tk"] not in in_watch]
    piano = []
    for t, fonte in possibili:
        if any(x["tk"] == t["tk"] for x in piano):
            continue
        piano.append(voce_piano(t, fonte, rendimenti_per_data(B.get(t["tk"]) or []), rlibro, rqqq,
                                valore_libro, UNITA_EUR * fx if fx else None))
    return {"settori": settori, "universo_assente": not tilt, "libro": sorted(qta),
            "libro_sedute": len(rlibro), "watchlist": watch, "asof_target": asof_target,
            "spy_assente": not rspy, "calendario": {k: cal.get(k) for k in ("giorni_non_letti", "finestra", "errore")},
            "piano": {"voci": piano, "liquidita": cassa, "patrimonio": pat, "cambio": fx, "fonte_cambio": fonte_fx,
                      "qqq_assente": not rqqq, "obbligazioni": {t: prezzi_eur[t] for t in eur_nom}}}


def calendario_sicuro(tks, giorni=GIORNI_CALENDARIO):
    """Il calendario Nasdaq, con tre esiti distinti (v389): data trovata, nessuna data nella
    finestra, calendario NON letto. Un'eccezione non deve portarsi via la watchlist intera."""
    try:
        return brief.calendario_trimestrali(tks, giorni=giorni)
    except Exception as e:
        return {"attesi": [], "giorni_non_letti": [], "finestra": giorni, "errore": str(e)[:80]}


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
    """v472: percentili nell'anno (0 = il minimo dell'anno, 100 = il massimo, ~50 = norma)."""
    ps, p20 = t.get("vol_pct_seduta"), t.get("vol_pct_20")
    def p(x):
        return "n.d." if x is None else f"{x:.0f}/100"
    return (f"volumi (0 = minimo dell'anno, 100 = massimo, 50 = norma): seduta conclusa del "
            f"{t.get('vol_seduta') or 'n.d.'} {p(ps)} · media delle ultime 20 sedute {p(p20)}"
            + (f" · su {t['vol_campione']} sedute" if t.get("vol_campione") else ""))


def riga_trimestrale(t, cal=None):
    """La prima trimestrale dal calendario Nasdaq (la fonte delle SCADENZE di numeri_libro). La
    stima yfinance della pipeline si scrive solo se diversa o se Nasdaq tace, e si chiama STIMA.
    Tre esiti distinti (v389): data trovata · nessuna data nella finestra · calendario NON letto."""
    cal = cal or {}
    tr, yf = t.get("trimestrale"), t.get("trimestrale_yf")
    if tr:
        s = f"trimestrale {tr['data']} ({tr['giorni']} g, calendario Nasdaq)"
        return s + (f" — la pipeline (yfinance) stima {yf}" if yf and yf != tr["data"] else "")
    if cal.get("errore"):
        s = f"trimestrale: calendario Nasdaq NON letto ({cal['errore']}) — non vuol dire 'nessuna uscita'"
    elif cal.get("giorni_non_letti"):
        k = len(cal["giorni_non_letti"])
        s = (f"trimestrale: nessuna data nei giorni letti, ma {k} {'giorno' if k == 1 else 'giorni'} del calendario "
             "Nasdaq NON letti — non vuol dire 'nessuna uscita'")
    else:
        s = f"trimestrale: nessuna data nel calendario Nasdaq a {cal.get('finestra') or GIORNI_CALENDARIO} giorni"
    return s + (f" · la pipeline (yfinance) stima {yf}: STIMA, non una data confermata" if yf else "")


def righe_ingresso(t, cal=None):
    """Le righe di un sorvegliato (v473): stato e gruppo, il livello d'ingresso secondo la
    convenzione, la scala dei livelli con lo stop, la base, volumi/target/beta, trimestrale e
    revisioni, e la nota del CEO in LIBRO.md parola per parola."""
    p = piano_ingresso(t)
    z = p["zona"]
    liv = lambda nome, d: f"{nome} {prezzo(d['prezzo'])} ({n(d['pct'],1,'%')}, {n(d['atr'],1)} ATR)"
    rsi = "n.d." if t.get("rsi") is None else format(t["rsi"], ".0f")
    L = [f"   {t['tk']:6} {prezzo(t['px'])} · {t['stato']} · {p['gruppo']} (corr {n(t.get('corr_libro'),2)}) · "
         f"1m {n(t.get('m1'),1,'%')} · 3m {n(t.get('m3'),1,'%')} · RSI14 {rsi} · ATR {piano(t.get('atr_pct'))}%"]
    if p["posizione"] == "non misurabile":
        ing = "ingresso: zona non misurabile (medie o ATR mancanti)"
    elif p["posizione"] == "zona vuota":
        ing = (f"ingresso: zona VUOTA con le medie di oggi — la media a 200 ({prezzo(t.get('sma200'))}) sta oltre "
               f"2 ATR sopra la media a 50 ({prezzo(t.get('sma50'))}): nessun prezzo soddisfa la convenzione "
               "finche' le medie non si avvicinano")
    elif p["posizione"] == "sotto":
        ing = (f"ingresso: CHIUSURA sopra {liv(z['quale'], p['livello'])}, con volume oltre il "
               f"{SOGLIA_VOL_CONFERMA}o percentile dell'anno · zona {prezzo(z['basso'])}-{prezzo(z['alto'])}")
    elif p["posizione"] == "sopra":
        ing = (f"ingresso: prezzo SOPRA la zona, non si insegue — ritorno sotto "
               f"{liv('media 50 + 2 ATR', p['livello'])} · zona {prezzo(z['basso'])}-{prezzo(z['alto'])}")
    else:
        ing = f"ingresso: prezzo DENTRO la zona {prezzo(z['basso'])}-{prezzo(z['alto'])}"
    if p.get("primo_segnale"):
        ing += (f" · primo segnale, NON un ingresso: chiusura sopra la {liv(*p['primo_segnale'])} — la discesa "
                "che smette di scendere")
    pend = t.get("pend50")
    if p["posizione"] != "non misurabile":
        ing += (" · pendenza della media a 50 n.d." if pend is None else
                f" · media a 50 in DISCESA ({n(pend,1,'%')} in 20 sedute): la convenzione chiede anche che giri"
                if pend <= 0 else f" · media a 50 in salita ({n(pend,1,'%')} in 20 sedute)")
    L.append(f"      {ing}")
    sopra = " · ".join(liv(nm, d) for nm, d in p.get("sopra") or []) or "nessuno"
    sotto = " · ".join(liv(nm + (" = STOP" if nm == "supporto 20s" else ""), d) for nm, d in p.get("sotto") or []) or "nessuno"
    rischio = p.get("rischio")
    L.append(f"      livelli sopra: {sopra}")
    L.append(f"      livelli sotto: {sotto}"
             + (f" · dall'ingresso a {prezzo(rischio['da'])} allo stop {n(rischio['pct'],1,'%')} ({n(rischio['atr'],1)} ATR)"
                if rischio else ""))
    m, dm = t.get("minimi"), t.get("dal_minimo")
    base = (f"base: minimi delle ultime {SEDUTE_MINIMI} sedute concluse {m['verso'].upper()} ({prezzo(m['ora'])} "
            f"contro {prezzo(m['prima'])} delle {SEDUTE_MINIMI} prima)" if m else "base: struttura dei minimi n.d.")
    if dm:
        quando = ("nell'ultima barra" if dm["sedute"] == 0 else
                  "1 seduta fa" if dm["sedute"] == 1 else f"{dm['sedute']} sedute fa")
        base += (f" · minimo dell'anno {prezzo(dm['minimo'])} il {dm['data']}, {quando}, "
                 f"prezzo {n(dm['sopra_pct'],1,'%')} sopra")
    L.append(f"      {base}")
    L.append(f"      {riga_volumi(t)} · {riga_target_beta(t)}")
    rev = (schede_progetto.riga_revisioni(t.get("analisti"), con_target=False) if t.get("in_pipeline")
           else "revisioni: titolo non seguito dalla pipeline")
    L.append(f"      {riga_trimestrale(t, cal)} · {rev}")
    if t.get("nota"):
        L.append(f"      nota del CEO in LIBRO.md (i suoi livelli sono del giorno in cui e' scritta): «{t['nota']}»")
    return L


GRUPPI_WATCHLIST = (   # (titolo del gruppo, chiave, nome breve per il conteggio)
    ("CANDIDATI — zona, pendenza e correlazione soddisfatte", "candidato", "candidati"),
    ("DIVERSIFICANO (correlazione col libro sotto 0,5) — non ancora candidati", "diversifica", "diversificano"),
    ("STESSA SCOMMESSA DEL LIBRO (correlazione da 0,5 in su) — aggiungono alla concentrazione, non la riducono",
     "stessa", "stessa scommessa"),
    ("CORRELAZIONE NON MISURABILE", "ignota", "correlazione non misurabile"),
)


def gruppo_watchlist(t):
    """Un nome sta in UN gruppo solo: il candidato per primo, poi la correlazione decide."""
    if str(t.get("stato", "")).startswith("CANDIDATO"):
        return "candidato"
    c = t.get("corr_libro")
    return "ignota" if c is None else ("stessa" if c >= SOGLIA_CORR else "diversifica")


def righe_watchlist(o):
    """I sorvegliati del libro (memoria/LIBRO.md) con la stessa misura dei candidati (v471) e,
    da v473, il piano d'ingresso di ciascuno: la sezione 7 dell'analisi li riporta sempre."""
    w = o.get("watchlist") or []
    cal = o.get("calendario") or {}
    letti = [t for t in w if not t.get("errore")]
    per = {k: sorted((t for t in letti if gruppo_watchlist(t) == k),
                     key=lambda t: piano_ingresso(t)["distanza_atr"]) for _, k, _ in GRUPPI_WATCHLIST}
    non_letti = [t["tk"] for t in w if t.get("errore")]
    L = [f"WATCHLIST DEL LIBRO E INGRESSI — {len(w)} nomi: " + " · ".join(
            f"{len(per[k])} {breve}" for _, k, breve in GRUPPI_WATCHLIST) + f" · {len(non_letti)} non letti",
         f"   prezzi di oggi (stockanalysis.com) · target e revisioni dalla pipeline (run {o.get('asof_target') or 'n.d.'}) · "
         f"trimestrali dal calendario Nasdaq ({cal.get('finestra') or GIORNI_CALENDARIO} giorni) · stati, zona e stop = "
         "convenzioni in testa allo script, non giudizi",
         "   zona d'ingresso = sopra la media a 200, fra 1 ATR sotto e 2 ATR sopra la media a 50 (le medie di oggi); "
         "il candidato chiede in piu' media a 50 in salita e correlazione col libro sotto 0,5 · dentro ogni gruppo "
         "l'ordine e' la distanza dalla zona in ATR, un fatto e non una classifica",
         "   ⚠ il SEMAFORO decide cosa e' ammesso (LIBRO.md §1ter): il settore di un titolo NON e' in questi dati, "
         "la correlazione col libro si'"]
    if o.get("spy_assente"):
        L.append("   ⚠ serie dell'S&P 500 NON letta: i beta mancano tutti, non sono zero")
    if cal.get("errore") or cal.get("giorni_non_letti"):
        L.append("   ⚠ calendario delle trimestrali incompleto: una data mancante non vuol dire 'nessuna uscita'")
    for etichetta, k, _ in GRUPPI_WATCHLIST:
        if not per[k]:
            continue
        L.append(f"■ {etichetta} — {len(per[k])}")
        for t in per[k]:
            L.extend(righe_ingresso(t, cal))
    if non_letti:
        L.append(f"■ NON LETTI — {len(non_letti)}: {', '.join(non_letti)} (prezzi non arrivati: non e' 'nessun segnale')")
    return L


# ---------------------------------------------------------------- v474: il piano per la liquidita'
def conseguenze(rt, rlibro, rqqq, valore_libro, unita_usd, n=SEDUTE_BETA):
    """Cosa fa al LIBRO AZIONARIO un ingresso di `unita_usd`: variazione della volatilita' annua e
    del beta su QQQ, sulle STESSE date comuni a libro, QQQ e titolo (v207), con le stesse formule
    della scheda (vol_annua, beta_mercato: una derivazione sola). Il libro e' quello di oggi
    guardato all'indietro, la convenzione di serie_libro. Sotto 60 date comuni None: un buco."""
    comuni = sorted(set(rt) & set(rlibro) & set(rqqq))[-n:]
    if len(comuni) < 60 or not valore_libro or not unita_usd:
        return None
    w = unita_usd / (valore_libro + unita_usd)
    prima = {t: rlibro[t] for t in comuni}
    dopo = {t: (1 - w) * rlibro[t] + w * rt[t] for t in comuni}
    q = {t: rqqq[t] for t in comuni}
    bp, _, _ = beta_mercato(prima, q, n)
    bd, _, _ = beta_mercato(dopo, q, n)
    vp, vd = vol_annua(prima, n), vol_annua(dopo, n)
    return {"dvol": None if vp is None or vd is None else vd - vp,
            "dbeta": None if bp is None or bd is None else bd - bp,
            "peso": w, "sedute": len(comuni)}


def voce_piano(t, fonte, rt, rlibro, rqqq, valore_libro, unita_usd):
    """Una voce del piano: dove sta il prezzo rispetto alla zona, l'ingresso secondo la convenzione
    (il prezzo di adesso se e' dentro, il livello se e' fuori), lo stop, la perdita allo stop per
    l'unita' e le conseguenze sul libro. Solo fatti misurati: la frase la scrive la resa."""
    p = piano_ingresso(t)
    ingresso = (p["livello"] or {}).get("prezzo") if p["posizione"] in ("sotto", "sopra") else (
        t.get("px") if p["posizione"] == "dentro" else None)
    stop = t.get("supp")
    perdita = (UNITA_EUR * (stop / ingresso - 1), (stop / ingresso - 1) * 100) if (
        ingresso and stop is not None and stop < ingresso) else (None, None)
    return {"tk": t["tk"], "fonte": fonte, "px": t.get("px"), "posizione": p["posizione"], "livello": p["livello"],
            "zona": p["zona"], "ingresso": ingresso, "stop": stop, "perdita_eur": perdita[0], "perdita_pct": perdita[1],
            "gruppo": gruppo_libro(t.get("corr_libro")), "corr": t.get("corr_libro"), "pend50": t.get("pend50"),
            "trimestrale": t.get("trimestrale"), "stato": t.get("stato"), "distanza_atr": p["distanza_atr"],
            "conseguenze": conseguenze(rt, rlibro, rqqq, valore_libro, unita_usd)}


def _euro(x):
    return "n.d." if x is None else f"{x:,.0f}".replace(",", ".") + " €"


def riga_piano(v):
    c = v["conseguenze"]
    gr = ("STESSA SCOMMESSA del libro" if v["gruppo"].startswith("STESSA") else
          "correlazione col libro NON misurabile" if v["gruppo"].startswith("CORRELAZIONE") else "DIVERSIFICA")
    L = f"    {v['tk']} ({v['fonte']}) {prezzo(v['px'])} · {gr} (corr {n(v['corr'], 2)})"
    if v["posizione"] == "sotto":
        L += f" · avviso: CHIUSURA sopra {prezzo(v['livello']['prezzo'])} ({n(v['livello']['pct'], 1, '%')}, {n(v['livello']['atr'], 1)} ATR) con volume oltre il {SOGLIA_VOL_CONFERMA}o percentile"
    elif v["posizione"] == "sopra":
        L += f" · avviso: ritorno SOTTO {prezzo(v['livello']['prezzo'])} ({n(v['livello']['pct'], 1, '%')}, {n(v['livello']['atr'], 1)} ATR): oggi è tirato"
    if v["pend50"] is not None and v["pend50"] <= 0 and v["posizione"] in ("dentro", "sotto", "sopra"):
        L += " · media a 50 in DISCESA: la convenzione del candidato non è soddisfatta"
    if c is None:
        L += " · conseguenze n.d. (meno di 60 sedute comuni col libro e con QQQ, o cambio mancante)"
    else:
        L += (f" · per {_euro(UNITA_EUR)}: volatilità del libro {n(c['dvol'], 2)} punti, beta su QQQ {n(c['dbeta'], 3)}"
              f" ({c['sedute']} sedute)")
    if v["perdita_eur"] is not None:
        L += f" · allo stop {prezzo(v['stop'])} ({n(v['perdita_pct'], 1, '%')} dall'ingresso) si perdono {_euro(-v['perdita_eur'])}"
    elif v["ingresso"] is not None:
        L += " · stop n.d. (il supporto a 20 sedute non sta sotto l'ingresso)"
    tr = v["trimestrale"]
    if tr:
        L += f" · trimestrale {tr['data']} ({tr['giorni']} g)"
        if tr.get("giorni") is not None and tr["giorni"] <= TRIMESTRALE_VICINA:
            L += f" ⚠ entro {TRIMESTRALE_VICINA} giorni: un ingresso prima dei conti è una scommessa binaria (LIBRO.md §1quater)"
    return L


def righe_piano(o):
    """Il blocco PIANO PER LA LIQUIDITA' (v474): la liquidita' con la sua quota del patrimonio, e per
    ogni ingresso possibile le conseguenze di rischio — anche per chi e' nella stessa scommessa del
    libro, perche' in giallo non e' vietato ma va detto cosa comporta (decisione del CEO del 09/10)."""
    pi = o.get("piano") or {}
    pat, fx, liq = pi.get("patrimonio"), pi.get("cambio"), pi.get("liquidita")
    voci = pi.get("voci") or []
    if pat and liq is not None:
        quota = liq / pat["totale"] * 100
        az0 = pat["azionario"] / pat["totale"] * 100
        az1 = (pat["azionario"] + UNITA_EUR) / pat["totale"] * 100
        testa = (f"PIANO PER LA LIQUIDITÀ — {_euro(liq)} dichiarati in LIBRO.md, {piano(quota)}% del patrimonio "
                 f"(azionario {_euro(pat['azionario'])}, obbligazioni {_euro(pat['obbligazioni'])}, totale {_euro(pat['totale'])}; "
                 f"cambio EUR/USD {piano(fx, 4)}, {pi.get('fonte_cambio')})")
        quota_txt = (f"ogni {_euro(UNITA_EUR)} spostati dalla liquidità all'azionario portano la quota azionaria del "
                     f"patrimonio da {piano(az0)}% a {piano(az1)}%")
    else:
        testa = ("PIANO PER LA LIQUIDITÀ — patrimonio NON calcolabile: "
                 + ("cambio EUR/USD non letto dalla pipeline" if not fx else "liquidità non letta da LIBRO.md")
                 + " — non vuol dire 'niente da investire'")
        quota_txt = None
    L = [testa,
         f"   conseguenze per {_euro(UNITA_EUR)}" + (f" (≈ {UNITA_EUR * fx:,.0f} $)".replace(",", ".") if fx else "")
         + ": unità di calcolo, NON una quantità consigliata · volatilità e beta del LIBRO AZIONARIO sulle stesse date comuni "
           "a libro, QQQ e titolo (fino a 250 sedute; il livello del libro è nel blocco NUMERI) · perdita allo stop = unità × "
           "(stop / ingresso − 1)",
         "   il SEMAFORO decide il gradino (numeri_libro.py, LIBRO.md §1ter): in giallo nessun divieto, ogni ingresso porta "
         "le sue conseguenze; in arancione e rosso vale prima la riduzione del gradino"]
    if quota_txt:
        L.append(f"   {quota_txt}")
    if pi.get("qqq_assente"):
        L.append("   ⚠ serie di QQQ NON letta: le variazioni di beta e volatilità mancano tutte, non sono zero")
    gruppi = (("OPERABILI ADESSO — prezzo dentro la zona d'ingresso · ordine: chi riduce di più la volatilità del libro",
               lambda v: v["posizione"] == "dentro",
               lambda v: (v["conseguenze"] or {}).get("dvol") if (v["conseguenze"] or {}).get("dvol") is not None else 1e9),
              ("CON UN LIVELLO DA METTERE COME AVVISO (Investing.com) · ordine: distanza dal livello in ATR",
               lambda v: v["posizione"] in ("sotto", "sopra"), lambda v: v["distanza_atr"]),
              ("SENZA LIVELLO OGGI — zona vuota o non misurabile", lambda v: v["posizione"] in ("zona vuota", "non misurabile"),
               lambda v: v["tk"]))
    for titolo, scelta, ordine in gruppi:
        sel = sorted((v for v in voci if scelta(v)), key=ordine)
        L.append(f"■ {titolo} — {len(sel)}")
        if titolo.startswith("SENZA"):
            if sel:
                L.append("    " + " · ".join(f"{v['tk']} ({v['posizione']})" for v in sel))
            continue
        L.extend(riga_piano(v) for v in sel)
    stessa = [v["tk"] for v in voci if v["gruppo"].startswith("STESSA") and v["posizione"] in ("dentro", "sotto", "sopra")]
    if stessa:
        L.append(f"   ⚠ nella stessa scommessa del libro (correlazione da {piano(SOGLIA_CORR)} in su): {', '.join(stessa)} — "
                 "un ingresso lì aggiunge alla concentrazione invece di ridurla, e la volatilità del libro lo mostra")
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
        print()
        print("\n".join(righe_piano(o)))
