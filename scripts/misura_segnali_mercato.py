#!/usr/bin/env python3
"""v500 — MISURA DEI SEGNALI DI MERCATO: avrebbero anticipato i cali? NON e' un gate e NON e' un passo dell'analisi.

Decisione del CEO del 18/10/2026, testuale: *"1 ok tua proposta"*. Le misure della v496-v499 — curva della volatilita'
(VIX/VIX3M), gamma dei dealer, dark pool, put/call, grandi operatori, multipli degli indici — restano INFORMAZIONE: non
entrano nel colore del semaforo ne' nella tenuta. Dove lo storico esiste si misura ADESSO se avrebbero anticipato i
cali, con lo stesso metodo del CCC (v465); dove no, lo strumento dice quanta storia e' stata raccolta. Si riesegue
quando lo storico cresce, come backtest_signals.mjs: la conclusione sta nel libro (LIBRO.md §1ter), qui c'e' la misura.

Metodo, uguale per ogni segnale:
- un EPISODIO e' il primo giorno di un tratto in cui il segnale e' acceso, dopo almeno GAP sedute spente;
- per ogni episodio: il rendimento a 21 e 63 sedute, il calo massimo nelle 63 sedute dopo, e quanto il mercato era
  GIA' sotto il massimo dell'anno quando il segnale si e' acceso;
- la FREQUENZA DI BASE: gli stessi numeri su tutti i giorni. Lo scarto si legge in errori standard binomiali della
  base sul numero di episodi — approssimato, perche' le finestre di 63 sedute si sovrappongono: sotto due errori
  standard la differenza e' DENTRO IL RUMORE (convenzione, v240);
- per ogni calo di almeno il 10% dal massimo precedente: il segnale si e' acceso ENTRO il giorno in cui il calo toccava
  il -5% (contando fino a 21 sedute prima del massimo), solo DENTRO il calo, o MAI.
⚠ Nessun segnale si valuta con un dato che quel giorno non era pubblico: i percentili usano solo la storia fino a quel
giorno, il rapporto della CFTC vale dal venerdi' in cui esce (non dal martedi' che fotografa) e il P/E mensile dal
mese dopo, quando la media dei prezzi del mese e' nota. Quando la CFTC ha pubblicato in ritardo (blocchi
dell'amministrazione federale) la misura vede il rapporto prima del mercato: approssimazione dichiarata.

Fonti, tutte pubbliche e lette da qui il 18/10/2026:
- CBOE: VIX (dal 1990), VIX3M (dal 18/09/2009), SPX (dal 1975); le statistiche giornaliere delle opzioni dal
  07/10/2019 (il 01/10/2019 la fonte risponde 403);
- SqueezeMetrics, DIX.csv (dal 2011): DIX e GEX dell'S&P 500;
- FRED, NASDAQ100 (CSV pubblico, dal 1986);
- CFTC, Traders in Financial Futures (fut_fin_txt_AAAA.zip dal 2010: il 2006 risponde 404);
- multpl: P/E e CAPE dell'S&P 500 per mese (dal 1871 e dal 1881);
- stockanalysis: SMH e i titoli (5 anni); la memoria del sistema per il dark pool per titolo.
I lettori sono quelli del sistema (posizionamento.py, indici.py, rotazione.py): una misura che leggesse i dati in un
altro modo misurerebbe un'altra cosa (v161).

Uso: python3 scripts/misura_segnali_mercato.py [--parti ABCDEFGH] [--dettaglio] [--cache DIR]
--cache tiene le statistiche giornaliere CBOE e gli archivi CFTC degli anni chiusi (i file sono immutabili): il primo
giro ne legge circa 1.600, i successivi solo quelli nuovi.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import indici as IND          # noqa: E402  (i lettori degli storici CBOE e di multpl)
import numeri_libro as NL     # noqa: E402  (i formattatori: virgola decimale, un posto solo — v443)
import posizionamento as POS  # noqa: E402  (i lettori di CBOE, CFTC, FINRA e SqueezeMetrics)
import rotazione              # noqa: E402  (percentile midrank, storico a 5 anni, taglio societario)

# ⚠ Convenzioni, dichiarate (v240): nessuna di queste e' un dato del mercato.
GAP = 20                 # sedute spente fra due episodi (la convenzione del CCC, v465)
AVANTI = (21, 63)        # orizzonti del rendimento dopo il segnale
FINESTRA = 63            # il calo massimo si cerca nelle 63 sedute dopo
SOGLIE_CALO = (0.05, 0.10)
CALO = 0.10              # un calo "da anticipare": almeno il 10% dal massimo precedente
AVVISO = 0.05            # anticipa = acceso entro il giorno in cui il calo tocca il -5%
PRIMA = 21               # ... contando fino a 21 sedute prima del massimo
ANNO = 252
CODA = 10                # le code di una distribuzione: fino al 10° percentile e dal 90°
RUMORE = 2.0             # sotto due errori standard lo scarto dalla base e' dentro il rumore
MIN_PERCENTILE = 60      # sotto 60 valori nessun percentile: su pochi valori e' rumore
MIN_SETTIMANE_COT = 104  # due anni di rapporti prima del primo percentile dei grandi operatori
MESI_VALUTAZIONE = 240   # il P/E contro i propri 20 anni: la finestra che indici.py pubblica (rango20)
AVANTI_VALUTAZIONE = (63, 252)  # i multipli lavorano piano: si guarda anche l'anno dopo
INIZIO_PC = date(2019, 10, 7)
INIZIO_COT = 2010
GIORNI_PUBBLICAZIONE_COT = 3    # il rapporto del martedi' esce il venerdi'
SEDUTE_DPI = 21                 # il dark pool per titolo: il rendimento in eccesso su SPY a un mese
URL_FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={s}"
# FRED chiude la connessione a chi si presenta come un browser (misurato il 18/10/2026: «Mozilla/5.0» → nessuna
# risposta dopo 31 secondi, due volte su due) e risponde a chi dice chi e'. E' l'intestazione della pipeline
# (update_data.UA_ONESTO): un gate verifica che le due restino uguali.
UA_FRED = {"User-Agent": "Trading-dashboard/1.0 (+https://github.com/Oigres85/Trading)", "Accept": "*/*"}
MERCATI_COT = (("13874+", "S&P 500", "spx"), ("20974+", "Nasdaq-100", "ndx"))   # i codici di posizionamento.py
PARTI = "ABCDEFGH"

_it, _sg, _gma = NL._it, NL._sg, POS._gma
PROVE = []      # (nome, soglia, scarti) di ogni confronto con la base: il conto dei confronti chiude il rapporto


# ══════════════════════════════════════ LE MISURE (nessuna rete qui) ══════════════════════════════════════
def episodi(accesi, gap=GAP):
    """Gli indici dei PRIMI giorni di ogni tratto acceso dopo almeno `gap` sedute spente. `accesi` e' una lista di
    vero/falso/None per seduta: None (segnale non calcolabile quel giorno) conta come spento."""
    ep, spente = [], gap
    for i, a in enumerate(accesi):
        if a:
            if spente >= gap:
                ep.append(i)
            spente = 0
        else:
            spente += 1
    return ep


def dopo(px, i, avanti=AVANTI, finestra=FINESTRA, anno=ANNO):
    """Dal giorno i: il rendimento a ciascun orizzonte, il calo massimo nelle `finestra` sedute dopo (None se la
    finestra non e' completa: un calo misurato su meta' finestra sarebbe piu' piccolo del vero) e la distanza dal
    massimo dell'anno quel giorno."""
    p0 = px[i]
    out = {f"r{a}": (px[i + a] / p0 - 1) if i + a < len(px) else None for a in avanti}
    out["calo"] = (min(px[i:i + finestra + 1]) / p0 - 1) if i + finestra < len(px) else None
    out["gia"] = p0 / max(px[max(0, i - anno + 1):i + 1]) - 1
    return out


def confronto(px, accesi, avanti=AVANTI, finestra=FINESTRA, gap=GAP):
    """Gli episodi del segnale contro la frequenza di base di tutti i giorni con la finestra completa."""
    idx = episodi(accesi, gap)
    ep = [dopo(px, i, avanti, finestra) for i in idx]
    base = [b for b in (dopo(px, i, avanti, finestra) for i in range(len(px))) if b["calo"] is not None]
    comp = [e for e in ep if e["calo"] is not None]

    def med(v, k):
        v = [x[k] for x in v if x[k] is not None]
        return statistics.median(v) if v else None

    def quota(v, s):
        return (sum(1 for x in v if x["calo"] <= -s) / len(v)) if v else None

    out = {"idx": idx, "n": len(idx), "completi": len(comp), "episodi": ep,
           "gia5": (sum(1 for e in ep if e["gia"] <= -AVVISO) / len(ep)) if ep else None}
    for a in avanti:
        out[f"r{a}"], out[f"base_r{a}"] = med(ep, f"r{a}"), med(base, f"r{a}")
    for s in SOGLIE_CALO:
        p, b = quota(comp, s), quota(base, s)
        se = math.sqrt(b * (1 - b) / len(comp)) if comp and b is not None else None
        out[f"calo{round(s * 100)}"] = {"quota": p, "base": b, "se": se,
                                        "scarti": (p - b) / se if se else None}
    return out


def lettura(k, rumore=RUMORE):
    """Lo scarto dalla base, in errori standard, e la sua lettura."""
    if k.get("scarti") is None:
        return "non misurabile"
    giudizio = ("DENTRO IL RUMORE" if abs(k["scarti"]) < rumore else
                ("SOPRA la base" if k["scarti"] > 0 else "SOTTO la base"))
    return f"{_sg(k['scarti'], 1)} errori standard: {giudizio}"


def cali(px, soglia=CALO):
    """I cali di almeno `soglia` dal massimo precedente, come indici (massimo, minimo, ampiezza). Un calo finisce
    quando il prezzo torna sopra il massimo da cui era partito; quello ancora aperto a fine serie resta, col minimo
    toccato fin li'."""
    out, picco, ip, minimo, im, in_calo = [], px[0], 0, px[0], 0, False
    for i, p in enumerate(px):
        if p > picco:
            if in_calo:
                out.append((ip, im, minimo / picco - 1))
                in_calo = False
            picco, ip, minimo, im = p, i, p, i
        elif p < minimo:
            minimo, im = p, i
            if minimo / picco - 1 <= -soglia:
                in_calo = True
    if in_calo:
        out.append((ip, im, minimo / picco - 1))
    return out


def anticipo(px, cali_, accesi, avviso=AVVISO, prima=PRIMA):
    """Per ogni calo: il segnale si e' acceso ENTRO il giorno in cui il calo tocca il -avviso (da `prima` sedute prima
    del massimo), solo DENTRO il calo dopo quel giorno, o MAI? Un calo in cui il segnale non era ancora calcolabile
    (None nella finestra) non si giudica: si conta a parte."""
    out = []
    for i0, i1, amp in cali_:
        da = max(0, i0 - prima)
        if any(a is None for a in accesi[da:i1 + 1]):
            out.append({"massimo": i0, "minimo": i1, "ampiezza": amp, "esito": "non calcolabile"})
            continue
        i5 = next((i for i in range(i0, i1 + 1) if px[i] / px[i0] - 1 <= -avviso), i1)
        pre = [i for i in range(da, i5 + 1) if accesi[i]]
        den = [i for i in range(i5 + 1, i1 + 1) if accesi[i]]
        primo = pre[0] if pre else (den[0] if den else None)
        out.append({"massimo": i0, "minimo": i1, "ampiezza": amp, "avviso": i5, "acceso": primo,
                    "esito": "entro" if pre else ("dentro" if den else "mai"),
                    "calo_al_segnale": (px[primo] / px[i0] - 1) if primo is not None and primo >= i0 else None})
    return out


def percentile_mobile(valori, n=ANNO, minimo=MIN_PERCENTILE):
    """Per ogni giorno il percentile (midrank) del valore fra gli ultimi n, il giorno compreso: la lettura che il
    sistema pubblica, senza nessuno sguardo in avanti. Sotto `minimo` valori, None."""
    out = []
    for i, v in enumerate(valori):
        fin = [x for x in valori[max(0, i - n + 1):i + 1] if x is not None]
        out.append(rotazione.percentile_midrank(v, fin) if v is not None and len(fin) >= minimo else None)
    return out


def su_sedute(date_sedute, pubblicati):
    """Il valore in vigore in ogni seduta: quello dell'ultima pubblicazione USCITA entro quel giorno.
    `pubblicati` = [(data di pubblicazione ISO, valore)] in ordine di data."""
    out, k = [], -1
    for s in date_sedute:
        while k + 1 < len(pubblicati) and pubblicati[k + 1][0] <= s:
            k += 1
        out.append(pubblicati[k][1] if k >= 0 else None)
    return out


def coda(v, alta, soglia=CODA):
    """Vero se il percentile sta nella coda alta (>= 100-soglia) o bassa (<= soglia); None resta None."""
    if v is None:
        return None
    return v >= 100 - soglia if alta else v <= soglia


def cot_netti(righe, codice, categoria="lev"):
    """[(data del rapporto, netto in % dell'open interest)] per DATA, una per settimana."""
    per = {}
    for r in righe:
        if r.get("codice") == codice and r.get(categoria) is not None and r.get("oi"):
            per[r["data"]] = r[categoria] / r["oi"] * 100
    return sorted(per.items())


def cot_percentili(serie, anni=POS.ANNI_COT, minimo=MIN_SETTIMANE_COT, ritardo=GIORNI_PUBBLICAZIONE_COT):
    """[(data di PUBBLICAZIONE, percentile)]: il percentile del netto fra le rilevazioni degli ultimi `anni` anni, lei
    compresa — la finestra di cot_stato — e la data spostata al venerdi' in cui il rapporto esce."""
    out = []
    for i, (d, v) in enumerate(serie):
        limite = (date.fromisoformat(d) - timedelta(days=365 * anni)).isoformat()
        fin = [x for dd, x in serie[:i + 1] if dd > limite]
        pub = (date.fromisoformat(d) + timedelta(days=ritardo)).isoformat()
        out.append((pub, rotazione.percentile_midrank(v, fin) if len(fin) >= minimo else None))
    return out


def mesi_valutazione(righe, mesi=MESI_VALUTAZIONE):
    """multpl [(data, valore, stima)] → [(primo giorno del mese DOPO, percentile fra gli ultimi `mesi` mesi, lui
    compreso)]: il valore del mese poggia sulla media dei prezzi del mese, quindi si conosce a mese chiuso. La riga
    del giorno (non un primo del mese) resta fuori, come in indici.stato_mensile."""
    m = [(d, v) for d, v, _s in righe if d[8:10] == "01"]
    out = []
    for i, (d, v) in enumerate(m):
        fin = [x for _, x in m[max(0, i - mesi + 1):i + 1]]
        a, mm = int(d[:4]), int(d[5:7])
        dopo_ = f"{a + mm // 12:04d}-{mm % 12 + 1:02d}-01"
        out.append((dopo_, rotazione.percentile_midrank(v, fin) if len(fin) >= mesi else None))
    return out


def osservazioni_dpi(righe, p, spy, sedute=SEDUTE_DPI):
    """Il dark pool di UN titolo contro il suo mese dopo: per ogni seduta con un anno di medie, il percentile della
    media di 10 sedute ponderata sui volumi (la funzione che il sistema pubblica, POS.medie_dp) fra le medie
    dell'anno, lei compresa, e il rendimento del titolo meno quello di SPY nelle `sedute` dopo, sulle date del
    titolo. righe = [(data, [scoperto, totale])]; p e spy = {data: prezzo}. Il DPI si pubblica la sera: la base
    e' la chiusura dello stesso giorno."""
    medie = POS.medie_dp(righe)
    rango = percentile_mobile([v for _, v in medie], n=ANNO - POS.MEDIA_DP + 1)
    dp = sorted(p)
    pos_ = {d: i for i, d in enumerate(dp)}
    out = []
    for (d, _v), r in zip(medie, rango):
        if r is None or d not in pos_ or d not in spy:
            continue
        i = pos_[d]
        if i + sedute >= len(dp) or dp[i + sedute] not in spy:
            continue
        d2 = dp[i + sedute]
        out.append((r, (p[d2] / p[d] - 1) - (spy[d2] / spy[d] - 1), d))
    return out


def quinti(px, rango, avanti=AVANTI, finestra=FINESTRA):
    """I giorni divisi per quinto del percentile del segnale: per ciascuno il rendimento mediano e la quota dei cali
    di almeno il 10% nelle `finestra` sedute dopo (finestre sovrapposte: e' una distribuzione, non episodi)."""
    out = []
    for q in range(5):
        lo, hi = q * 20, (q + 1) * 20
        g = [dopo(px, i, avanti, finestra) for i, r in enumerate(rango)
             if r is not None and (lo <= r < hi or (q == 4 and r == 100)) and i + finestra < len(px)]
        out.append({"da": lo, "a": hi, "n": len(g),
                    **{f"r{a}": statistics.median([x[f"r{a}"] for x in g]) if g else None for a in avanti},
                    "calo10": (sum(1 for x in g if x["calo"] <= -0.10) / len(g)) if g else None})
    return out


# ══════════════════════════════════════ LA RESA ══════════════════════════════════════
def _pc(x):
    return "n.d." if x is None else f"{_sg(x * 100, 1)}%"


def _q(x):
    return "n.d." if x is None else f"{_it(x * 100, 0)}%"


def righe_segnale(nome, date_, px, accesi, dettaglio=False, avanti=AVANTI, finestra=FINESTRA):
    if len(px) <= finestra:
        return [f"   {nome}: storia troppo corta ({len(px)} sedute)"]
    c = confronto(px, accesi, avanti, finestra)
    calcolabili = sum(1 for a in accesi if a is not None)
    L = [f"   {nome}, sedute dal {_gma(date_[0])} al {_gma(date_[-1])}: acceso {_it(sum(1 for a in accesi if a), 0)} "
         f"giorni su {_it(calcolabili, 0)} · {c['n']} episodi, {c['completi']} con le {finestra} sedute dopo complete"]
    if not c["n"]:
        L.append("      mai acceso: niente da misurare")
        return L
    L.append("      dopo il segnale, mediana: " + " · ".join(
        f"a {a} sedute {_pc(c[f'r{a}'])} (base {_pc(c[f'base_r{a}'])})" for a in avanti))
    L.append(f"      calo ulteriore entro {finestra} sedute: " + " · ".join(
        f"di almeno il {round(s * 100)}% {_q(c[f'calo{round(s * 100)}']['quota'])} "
        f"(base {_q(c[f'calo{round(s * 100)}']['base'])}; {lettura(c[f'calo{round(s * 100)}'])})" for s in SOGLIE_CALO))
    L.append(f"      al segnale il mercato era gia' oltre il -5% dal massimo dell'anno nel {_q(c['gia5'])} degli episodi")
    PROVE.extend((nome, s, c[f"calo{round(s * 100)}"]["scarti"]) for s in SOGLIE_CALO)
    an = anticipo(px, cali(px), accesi)
    giud = [a for a in an if a["esito"] != "non calcolabile"]
    conta = {k: sum(1 for a in giud if a["esito"] == k) for k in ("entro", "dentro", "mai")}
    prima_del_massimo = sum(1 for a in giud if a["esito"] == "entro" and a["acceso"] < a["massimo"])
    L.append(f"      cali di almeno il {round(CALO * 100)}%: {len(giud)}"
             + (f" (piu' {len(an) - len(giud)} quando il segnale non era ancora calcolabile)" if len(an) > len(giud) else "")
             + f" — acceso entro il -{round(AVVISO * 100)}% in {conta['entro']} (di cui prima del massimo in "
             f"{prima_del_massimo}), solo dentro il calo in {conta['dentro']}, mai in {conta['mai']}")
    if dettaglio:
        for a in giud:
            quando = ("" if a["acceso"] is None else
                      f" (dal {_gma(date_[a['acceso']])}, " + ("prima del massimo)" if a["calo_al_segnale"] is None
                                                               else f"mercato a {_pc(a['calo_al_segnale'])})"))
            L.append(f"        massimo {_gma(date_[a['massimo']])} → minimo {_gma(date_[a['minimo']])} "
                     f"({_pc(a['ampiezza'])}): {a['esito'].upper()}{quando}")
        for i, e in zip(c["idx"], c["episodi"]):
            L.append(f"        episodio {_gma(date_[i])}: gia' {_pc(e['gia'])} dal massimo dell'anno · "
                     + " · ".join(f"{a} sedute {_pc(e[f'r{a}'])}" for a in avanti)
                     + f" · calo massimo {_pc(e['calo'])}")
    return L


def righe_prove(prove, rumore=RUMORE):
    """Il conto dei confronti: con molti confronti, alcuni superano la soglia per puro caso. A due errori standard, a
    due code, la quota attesa per caso e' erfc(2/radice di 2) = 4,55%: un confronto oltre la soglia su venti e' quello
    che il caso produce, e non si promuove (v500)."""
    validi = [p for p in prove if p[2] is not None]
    if not validi:
        return []
    oltre = [p for p in validi if abs(p[2]) >= rumore]
    attesi = len(validi) * math.erfc(rumore / math.sqrt(2))
    return [f"CONTO DEI CONFRONTI: {len(validi)} confronti con la base, {len(oltre)} oltre {_it(rumore, 0)} errori standard; per "
            f"puro caso se ne aspettano circa {_it(attesi, 1)}"
            + (" — " + "; ".join(f"{n} (calo di almeno il {round(s * 100)}%, {_sg(z, 1)} e.s.)" for n, s, z in oltre)
               if oltre else "")]


def righe_quinti(nome, date_, px, rango):
    L = [f"   {nome}, sedute dal {_gma(date_[0])} al {_gma(date_[-1])} (giorni per quinto del percentile dell'anno; "
         "finestre sovrapposte)"]
    for q in quinti(px, rango):
        L.append(f"      percentile {q['da']}-{q['a']}: {_it(q['n'], 0)} giorni · mediana a 21 sedute {_pc(q['r21'])}, "
                 f"a 63 {_pc(q['r63'])} · cali di almeno il 10% entro 63 sedute {_q(q['calo10'])}")
    return L


# ══════════════════════════════════════ LE FONTI ══════════════════════════════════════
def _testo(url):
    return POS.scarica(url, timeout=60).decode("utf-8", "replace")


def _testo_fred(url):
    req = urllib.request.Request(url, headers=UA_FRED)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def serie_cboe(simbolo, colonna="CLOSE"):
    return dict(IND.leggi_vol(_testo(IND.URL_VOL.format(s=simbolo)), colonna))


def leggi_fred(testo):
    """Il CSV pubblico di FRED → {data: valore}. I giorni senza valore («.») si saltano: un buco non e' uno zero (v205)."""
    out = {}
    for riga in testo.splitlines()[1:]:
        p = riga.split(",")
        try:
            out[p[0][:10]] = float(p[1])
        except (IndexError, ValueError):
            continue
    return out


def serie_titolo(tk):
    """Cinque anni di chiusure RETTIFICATE, dall'ultima operazione societaria (v487). None = non letto."""
    b = rotazione.barre_lunghe(tk)
    if not b:
        return None
    b, _ = rotazione.serie_omogenea(b)
    return {x["t"][:10]: float(x.get("a") or x["c"]) for x in b if x.get("a") or x.get("c")}


def storia_pc(oggi, cache=None, paralleli=POS.PARALLELI):
    """Il put/call delle azioni per seduta dal 07/10/2019: le sedute che la memoria del sistema ha si prendono da li',
    le altre si leggono da CBOE (immutabili: con --cache si tengono). Ritorna ({data: rapporto}, conti)."""
    memoria = POS.leggi_memoria_pc()
    out = {d: r["azioni"] for d, r in memoria.items() if r.get("azioni") is not None}
    cartella = Path(cache) / "cboe_pc" if cache else None
    if cartella:
        cartella.mkdir(parents=True, exist_ok=True)
    giorni, g = [], INIZIO_PC
    while g < oggi:
        if g.weekday() < 5 and g.isoformat() not in memoria:
            giorni.append(g.isoformat())
        g += timedelta(days=1)

    def uno(d):
        p = cartella / f"{d}.json" if cartella else None
        if p and p.exists():
            return d, json.loads(p.read_text(encoding="utf-8")), "cache"
        try:
            r = POS.leggi_pc(json.loads(POS.scarica(POS.URL_PC.format(d=d))), d)
        except urllib.error.HTTPError as e:
            if e.code not in (403, 404):
                return d, None, f"HTTP {e.code}"
            r = {"data": d, "assente": e.code}
            if (oggi - date.fromisoformat(d)).days <= POS.MARGINE_ASSENTE:
                return d, r, "letta"          # forse non ancora pubblicato: non si tiene in cache
        except Exception as e:  # noqa: BLE001
            return d, None, type(e).__name__
        if p:
            p.write_text(json.dumps(r), encoding="utf-8")
        return d, r, "letta"

    conti = {"memoria": len(out), "lette": 0, "cache": 0, "assenti": 0, "non_lette": []}
    with ThreadPoolExecutor(paralleli) as ex:
        for d, r, come in ex.map(uno, giorni):
            if r is None:
                conti["non_lette"].append(d)
            elif r.get("azioni") is not None:
                out[d] = r["azioni"]
                conti["lette" if come == "letta" else "cache"] += 1
            else:
                conti["assenti"] += 1
    return out, conti


def storia_cot(anno_fine, cache=None):
    """Le righe del rapporto TFF dal 2010, coi lettori di posizionamento.py. Gli anni chiusi si tengono in cache."""
    cartella = Path(cache) / "cftc" if cache else None
    if cartella:
        cartella.mkdir(parents=True, exist_ok=True)

    def uno(anno):
        p = cartella / f"tff_{anno}.json" if cartella and anno < anno_fine else None
        if p and p.exists():
            return anno, json.loads(p.read_text(encoding="utf-8")), None
        a, rr, err = POS._cot(anno)
        if p and not err and rr:
            p.write_text(json.dumps(rr), encoding="utf-8")
        return a, rr, err

    righe, errori = [], []
    with ThreadPoolExecutor(POS.PARALLELI) as ex:
        for _a, rr, err in ex.map(uno, range(INIZIO_COT, anno_fine + 1)):
            righe += rr
            if err:
                errori.append(err)
    return righe, errori


FONTI = {
    "vix": lambda o: serie_cboe("VIX"),
    "vix3m": lambda o: serie_cboe("VIX3M"),
    "spx": lambda o: serie_cboe("SPX", "SPX"),
    "ndx": lambda o: leggi_fred(_testo_fred(URL_FRED.format(s="NASDAQ100"))),
    "smh": lambda o: serie_titolo("SMH"),
    "dix": lambda o: {r["data"]: r for r in POS.leggi_dix(_testo(POS.URL_DIX))},
    "pc": lambda o: storia_pc(o["oggi"], o["cache"]),
    "cot": lambda o: storia_cot(o["oggi"].year, o["cache"]),
    "cape": lambda o: IND.leggi_multpl(_testo(IND.URL_MULTPL["cape"])),
    "pe": lambda o: IND.leggi_multpl(_testo(IND.URL_MULTPL["pe"])),
}
SERVE = {"A": ("vix", "vix3m", "spx", "ndx", "smh"), "B": ("dix", "spx"), "C": ("dix", "spx"), "D": ("pc", "spx"),
         "E": ("cot", "spx", "ndx"), "F": ("cape", "pe", "spx"), "G": (), "H": ()}


def carica(parti, oggi, cache=None):
    """Le fonti che le parti chiedono, in parallelo. Una fonte che non risponde si DICHIARA nella sua parte."""
    chiavi = sorted({k for p in parti for k in SERVE[p]})
    ctx = {"oggi": oggi, "cache": cache}

    def uno(k):
        try:
            return k, FONTI[k](ctx), None
        except Exception as e:  # noqa: BLE001
            return k, None, f"{type(e).__name__}: {str(e)[:80]}"

    dati, errori = {}, {}
    with ThreadPoolExecutor(max(1, len(chiavi))) as ex:
        for k, v, err in ex.map(uno, chiavi):
            dati[k] = v
            if err:
                errori[k] = err
    return dati, errori


# ══════════════════════════════════════ LE PARTI ══════════════════════════════════════
def _mancano(dati, errori, *chiavi):
    m = [f"{k} ({errori.get(k, 'vuota')})" for k in chiavi if not dati.get(k)]
    return f"   NON misurabile adesso: fonti non lette — {', '.join(m)}" if m else None


def parte_a(dati, errori, dettaglio):
    L = ["A) CURVA DELLA VOLATILITA' INVERTITA — VIX/VIX3M >= 1: la paura a un mese supera quella a tre (CBOE)"]
    vix, v3m = dati.get("vix"), dati.get("vix3m")
    if _mancano(dati, errori, "vix", "vix3m"):
        return L + [_mancano(dati, errori, "vix", "vix3m")]
    for nome, k in (("S&P 500 (CBOE)", "spx"), ("Nasdaq-100 (FRED)", "ndx"), ("SMH, semiconduttori (5 anni)", "smh")):
        p = dati.get(k)
        if not p:
            L.append(f"   {nome}: prezzi NON letti ({errori.get(k, 'vuoti')})")
            continue
        d_ = [d for d in sorted(p) if d in vix and v3m.get(d)]
        L += righe_segnale(nome, d_, [p[d] for d in d_], [vix[d] / v3m[d] >= 1 for d in d_], dettaglio)
    return L


def parte_b(dati, errori, dettaglio):
    L = ["B) GAMMA DEI DEALER NEGATIVA — GEX dell'S&P 500 < 0, la stima di SqueezeMetrics"]
    if _mancano(dati, errori, "dix", "spx"):
        return L + [_mancano(dati, errori, "dix", "spx")]
    dx, p = dati["dix"], dati["spx"]
    d_ = [d for d in sorted(p) if d in dx]
    return L + righe_segnale("S&P 500", d_, [p[d] for d in d_], [dx[d]["gex"] < 0 for d in d_], dettaglio)


def parte_c(dati, errori, dettaglio):
    L = ["C) DIX — il dark pool dell'S&P 500 ponderato in dollari (SqueezeMetrics), per quinto del proprio anno"]
    if _mancano(dati, errori, "dix", "spx"):
        return L + [_mancano(dati, errori, "dix", "spx")]
    dx, p = dati["dix"], dati["spx"]
    d_ = [d for d in sorted(p) if d in dx]
    return L + righe_quinti("S&P 500", d_, [p[d] for d in d_], percentile_mobile([dx[d]["dix"] for d in d_]))


def parte_d(dati, errori, dettaglio):
    L = [f"D) PUT/CALL DELLE AZIONI (CBOE) — media di {POS.MEDIA_PC} sedute nelle code del proprio anno"]
    if _mancano(dati, errori, "pc", "spx"):
        return L + [_mancano(dati, errori, "pc", "spx")]
    pc, conti = dati["pc"]
    p = dati["spx"]
    d_ = [d for d in sorted(p) if d in pc]
    if conti["non_lette"]:
        L.append(f"   ⚠ {len(conti['non_lette'])} sedute NON lette (errore di rete): la serie ne ha di meno")
    medie = [None] * (POS.MEDIA_PC - 1) + POS.medie_semplici([pc[d] for d in d_])
    rango = percentile_mobile(medie)
    px = [p[d] for d in d_]
    L += righe_segnale(f"coda ALTA (paura, dal {100 - CODA}° percentile) → S&P 500", d_, px,
                       [coda(r, True) for r in rango], dettaglio)
    L += righe_segnale(f"coda BASSA (compiacenza, fino al {CODA}° percentile) → S&P 500", d_, px,
                       [coda(r, False) for r in rango], dettaglio)
    return L


def parte_e(dati, errori, dettaglio):
    L = [f"E) GRANDI OPERATORI (CFTC) — netto dei fondi a leva nelle code dei propri {POS.ANNI_COT} anni, dal venerdi' "
         "in cui il rapporto esce"]
    if _mancano(dati, errori, "cot"):
        return L + [_mancano(dati, errori, "cot")]
    righe, err = dati["cot"]
    if err:
        L.append(f"   ⚠ archivi NON letti: {', '.join(err)}")
    for codice, nome, k in MERCATI_COT:
        p = dati.get(k)
        if not p:
            L.append(f"   {nome}: prezzi NON letti ({errori.get(k, 'vuoti')})")
            continue
        serie = cot_netti(righe, codice)
        if not serie:
            L.append(f"   {nome}: codice {codice} NON trovato negli archivi")
            continue
        pub = cot_percentili(serie)
        d_ = [d for d in sorted(p) if d >= pub[0][0]]
        stato = su_sedute(d_, pub)
        px = [p[d] for d in d_]
        L += righe_segnale(f"{nome}, fondi a leva nella coda CORTA (fino al {CODA}° percentile)", d_, px,
                           [coda(r, False) for r in stato], dettaglio)
        L += righe_segnale(f"{nome}, fondi a leva nella coda LUNGA (dal {100 - CODA}° percentile)", d_, px,
                           [coda(r, True) for r in stato], dettaglio)
    return L


def parte_f(dati, errori, dettaglio):
    L = ["F) MULTIPLI DELL'S&P 500 (multpl) — nella coda alta dei propri 20 anni, dal mese dopo; orizzonti di 63 e 252 "
         "sedute (i multipli lavorano piano)"]
    if _mancano(dati, errori, "spx"):
        return L + [_mancano(dati, errori, "spx")]
    p = dati["spx"]
    for k, nome in (("cape", "CAPE (Shiller)"), ("pe", "P/E degli ultimi 12 mesi")):
        if not dati.get(k):
            L.append(f"   {nome}: NON letto ({errori.get(k, 'vuoto')})")
            continue
        pub = [(d, r) for d, r in mesi_valutazione(dati[k]) if r is not None]
        d_ = [d for d in sorted(p) if pub and d >= pub[0][0]]
        stato = su_sedute(d_, pub)
        L += righe_segnale(f"{nome} dal {100 - CODA}° percentile → S&P 500", d_, [p[d] for d in d_],
                           [coda(r, True) for r in stato], dettaglio, avanti=AVANTI_VALUTAZIONE,
                           finestra=max(AVANTI_VALUTAZIONE))
    return L


def parte_g(dati, errori, dettaglio, prezzi=None):
    """Il dark pool per titolo (FINRA, la memoria del sistema): la media di 10 sedute ponderata sui volumi, il suo
    percentile fra le medie dell'anno (lei compresa), e il rendimento IN ECCESSO su SPY nelle 21 sedute dopo."""
    memoria = POS.leggi_memoria_pc(POS.CACHE_DP)
    date_ = sorted(memoria)
    tks = sorted({t for d in date_ for t in (memoria[d].get("v") or {})} - set(POS.INDICI_DP))
    L = [f"G) DARK POOL PER TITOLO (FINRA, memoria del sistema) — DPI medio di {POS.MEDIA_DP} sedute per quinto del "
         f"proprio anno, e il rendimento in eccesso su SPY a {SEDUTE_DPI} sedute"]
    if not tks:
        return L + ["   NON misurabile: la memoria del dark pool e' vuota"]
    if prezzi is None:
        with ThreadPoolExecutor(POS.PARALLELI) as ex:
            prezzi = dict(zip(tks + ["SPY"], ex.map(serie_titolo, tks + ["SPY"])))
    spy = prezzi.get("SPY")
    if not spy:
        return L + ["   NON misurabile adesso: prezzi di SPY non letti"]
    oss, senza = [], []
    for tk in tks:
        p = prezzi.get(tk)
        if not p:
            senza.append(tk)
            continue
        righe = [(d, memoria[d]["v"][tk]) for d in date_ if tk in (memoria[d].get("v") or {})]
        oss += [(r, e, tk, d) for r, e, d in osservazioni_dpi(righe, p, spy)]
    if senza:
        L.append(f"   prezzi NON letti per {len(senza)} titoli: {', '.join(senza)}")
    if not oss:
        return L + ["   NON misurabile adesso: nessuna osservazione con un anno di medie e un mese dopo"]
    L.append(f"   {_it(len(oss), 0)} osservazioni su {len({o[2] for o in oss})} titoli e {len({o[3] for o in oss})} "
             f"date, dal {_gma(min(o[3] for o in oss))} al {_gma(max(o[3] for o in oss))} — finestre sovrapposte e titoli "
             "che si muovono insieme: il campione EFFETTIVO e' molto piu' piccolo")
    for q in range(5):
        lo, hi = q * 20, (q + 1) * 20
        g = [e for r, e, _t, _d in oss if lo <= r < hi or (q == 4 and r == 100)]
        if g:
            L.append(f"      percentile {lo}-{hi}: {_it(len(g), 0)} osservazioni · eccesso su SPY, mediana "
                     f"{_pc(statistics.median(g))} · sotto il -10%: {_q(sum(1 for e in g if e <= -0.10) / len(g))}")
    return L


def parte_h(dati, errori, dettaglio):
    """Cio' che non ha storia: si dice quanta ne e' stata raccolta, e da quando."""
    tit = POS.leggi_memoria_titoli()
    per_tk = {}
    for r in tit:
        per_tk.setdefault(r["tk"], set()).add(r["data"])
    gex = sorted({r["data"] for r in tit if r.get("gex_netta") is not None})
    ndx = sorted(d for d, r in IND.leggi_memoria().items() if r.get("ndx_fwd") is not None)
    mx = max((len(v) for v in per_tk.values()), default=0)
    return ["H) NON ANCORA MISURABILI — la storia non c'e', e si dice quanta ne e' stata raccolta",
            f"   la nostra gamma dei dealer sulle catene (posizionamento.py): {NL._conta(len(gex), 'seduta registrata', 'sedute registrate')}"
            + (f" dal {_gma(gex[0])}" if gex else "") + " — la raccolta comincia con la v500 (memoria/opzioni_titoli.jsonl)",
            f"   put/call e volatilita' implicita per titolo: fino a {NL._conta(mx, 'seduta registrata', 'sedute registrate')} "
            "per titolo (memoria/opzioni_titoli.jsonl)",
            f"   P/E del Nasdaq-100 (WSJ): {NL._conta(len(ndx), 'rilevazione raccolta', 'rilevazioni raccolte')}"
            + (f" dal {_gma(ndx[0])}" if ndx else "") + " (memoria/indici.jsonl)",
            "   P/E prospettico dell'S&P 500 (FactSet): la fonte pubblica il valore della settimana e le proprie medie a 5 e "
            "10 anni, non la serie — non misurabile da qui",
            "   scadenze delle opzioni e bitcoin nel weekend: un calendario e una sensibilita' gia' misurata (beta e R² su "
            "IBIT), non segnali che pretendano di anticipare: non c'e' niente da misurare",
            "   si rimisura con almeno un anno di sedute raccolte: un percentile su meno non ha una distribuzione, e un "
            "anno da' comunque pochi episodi indipendenti"]


ESEGUI = {"A": parte_a, "B": parte_b, "C": parte_c, "D": parte_d, "E": parte_e, "F": parte_f, "G": parte_g,
          "H": parte_h}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--parti", default=PARTI, help="quali parti, per lettera (predefinito: tutte)")
    ap.add_argument("--dettaglio", action="store_true", help="elenca cali ed episodi")
    ap.add_argument("--cache", default=None, help="cartella per i file immutabili di CBOE e CFTC")
    a = ap.parse_args()
    parti = [p for p in a.parti.upper() if p in PARTI]
    adesso = datetime.now(POS.NEW_YORK)
    dati, errori = carica(parti, adesso.date(), a.cache)
    L = [f"MISURA DEI SEGNALI DI MERCATO — {adesso.astimezone(POS.ROMA):%d/%m/%Y %H:%M} ora italiana · NON e' un gate: "
         "avrebbero anticipato i cali? (decisione del CEO del 18/10/2026)",
         f"   metodo: episodio = primo giorno acceso dopo {GAP} sedute spente · base = tutti i giorni · scarto in errori "
         f"standard binomiali (approssimati: le finestre si sovrappongono), sotto {_it(RUMORE, 0)} = dentro il rumore · "
         f"un calo di almeno il {round(CALO * 100)}% e' anticipato se il segnale si accende entro il giorno in cui tocca "
         f"il -{round(AVVISO * 100)}% (da {PRIMA} sedute prima del massimo)", ""]
    for p in parti:
        L += ESEGUI[p](dati, errori, a.dettaglio)
        L.append("")
    L += righe_prove(PROVE)
    if "D" in parti and dati.get("pc"):
        c = dati["pc"][1]
        L.append(f"   put/call: {c['memoria']} sedute dalla memoria del sistema, {c['lette']} lette ora, {c['cache']} dalla "
                 f"cache, {c['assenti']} giorni di borsa chiusa, {len(c['non_lette'])} NON lette")
    L.append("   Nessuna di queste misure entra nel colore del semaforo o nella tenuta: restano INFORMAZIONE (LIBRO.md §1ter).")
    print("\n".join(L))


if __name__ == "__main__":
    main()
