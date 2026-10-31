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
  STRUTTURA DEI MINIMI = minimo delle ultime 10 sedute concluse contro quello delle 10 precedenti;
                         entro mezzo ATR sono ALLA PARI, la regola dei pavimenti (v500).
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

v487 — I PAVIMENTI (decisione del CEO del 15/10/2026, testuale: "Non voglio entrare quando
risalgono, ma voglio entrare sui minimi"; poi "Si" a renderli un calcolo con le stesse regole per
tutti i titoli). Per ogni sorvegliato, convenzioni dichiarate (v240), scritte anche in LIBRO.md §1bis
e rilette da un gate:
  FINESTRA             = due anni di sedute, per DATA (v207), dall'ultima operazione societaria in poi:
                         un salto oltre il 3% in un giorno del rapporto fra prezzo rettificato e grezzo
                         (uno scorporo, un dividendo straordinario) rende i prezzi di prima non
                         confrontabili — WDC il 24/02/2025, lo scorporo di Sandisk.
  PAVIMENTO            = un minimo di oscillazione sotto il prezzo: il piu' basso di 5 sedute prima e 5
                         dopo. Minimi entro mezzo ATR sono lo stesso pavimento (largo al massimo mezzo
                         ATR). Per ciascuno: quante volte il prezzo ci e' tornato, quando l'ultima, quanto
                         e' rimbalzato nelle 20 sedute dopo, con quali volumi.
  ORDINE               = con limite al bordo alto del pavimento: si esegue solo se il prezzo scende fin
                         li', quindi mai sulla risalita.
  STOP                 = una chiusura sotto il fondo del pavimento meno 1 ATR.
  VUOTO DI PREZZO      = la fascia saltata da un rialzo e mai piu' scambiata. Che il prezzo torni a
                         riempirla e' una convenzione di lettura dei grafici, NON una misura: si
                         scrive a parte, e non diventa mai un pavimento.
I livelli della zona d'ingresso (v473) restano accanto: sono la lettura di chi entra sulla risalita,
che il CEO non vuole, e servono come segnale che la discesa e' finita.

v492 — LA LETTURA A 5 ANNI e IL P/E (decisione del CEO del 16/10/2026: "Si" a far entrare sempre negli
ingressi la lettura a 5 anni, "inoltre inserisci anche il fattore P/e come metrica di analisi delle
azioni"). Per ogni ingresso — sorvegliati, candidati di settore, e in numeri_libro gli ordini aperti e le
posizioni in perdita da mediare —, convenzioni di LETTURA dei grafici e non soglie di decisione (v240):
  MEDIE SETTIMANALI    = a 30, 50 e 200 settimane, sulle chiusure delle settimane CONCLUSE (la settimana in
                         corso non entra: la sua chiusura non esiste ancora), con la pendenza su 13 settimane.
                         Senza abbastanza settimane la media e' n.d., mai calcolata su meno.
  MASSIMO E MINIMO     = delle sedute concluse dei cinque anni, con la data; la POSIZIONE NELL'INTERVALLO e'
                         0 al minimo e 100 al massimo; il RIALZO RESTITUITO e' la quota del rialzo dal minimo
                         che precede il massimo fino al massimo, che il prezzo ha gia' riperso.
  LA SERIE             = quella della societa' di oggi, la stessa dei pavimenti: dall'ultima operazione
                         societaria, e per chi e' nato da un VEICOLO DI QUOTAZIONE (SPAC) dal giorno dopo la sua
                         fine dichiarata sul registro SEC (8-K con item 5.06, letto dalla pipeline). Su OKLO lo
                         storico della fonte comincia con AltC Acquisition Corp. — un prezzo fermo intorno a 10 $
                         fino al 09/05/2024 — e una media a 200 settimane che lo comprende disegna un supporto che
                         nessuno ha mai difeso. Un titolo non verificato lo DICHIARA (v406).
Il P/E viene da schede_progetto.riga_valutazione (una resa sola per schede e ingressi, v161): i multipli
dell'aggregatore, mai ricalcolati qui.
"""
import argparse, json, math, os, sys
from datetime import datetime, timedelta, time as dtime, timezone
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief
import schede_progetto
from comuni import art   # v510 — l'articolo davanti a un numero, un posto solo

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
# v487 — i pavimenti (decisione del CEO del 15/10/2026: entrare sui minimi). Convenzioni scritte anche in
#   LIBRO.md §1bis e rilette da un gate: un numero, un posto.
ANNI_PAVIMENTI = 2          # la finestra: due anni di sedute, per data
PAV_LATO = 5                # un minimo di oscillazione e' il piu' basso di 5 sedute prima e 5 dopo
PAV_LARGHEZZA_ATR = 0.5     # minimi entro mezzo ATR sono lo stesso pavimento
PAV_STOP_ATR = 1.0          # lo stop: una chiusura sotto il fondo del pavimento meno 1 ATR
PAV_RIMBALZO = 20           # il rimbalzo dopo un minimo si misura sulle 20 sedute successive
PAV_SALTO = 0.03            # un salto oltre il 3% del rapporto rettificato/grezzo in un giorno: operazione societaria
PAV_MOSTRA = 3              # i pavimenti piu' vicini sotto il prezzo
PAV_VUOTI = 2               # i vuoti di prezzo piu' vicini sotto il prezzo
PAV_CODA_ATR = 2.0          # v488: il piu' toccato in coda solo entro 2 ATR sotto l'ultimo pavimento mostrato
# v492 — la lettura a 5 anni: convenzioni di LETTURA, scritte in testa allo script (v240)
ANNI_LETTURA = 5
SETTIMANE_MEDIE = (30, 50, 200)
SETTIMANE_PENDENZA = 13     # la pendenza di una media settimanale: su un trimestre
# v494 — la struttura delle oscillazioni (richiesta del CEO del 17/10/2026: "analizza anche massimi e minimi
#   decrescenti ... tecnicamente i grafici quando si presenta la possibilita' di ingresso o si attivano i parametri di
#   uscita"). I punti di oscillazione sono quelli dei pavimenti (PAV_LATO) e "alla pari" e' la loro stessa regola
#   (PAV_LARGHEZZA_ATR): due minimi alla pari sono lo stesso pavimento. Convenzioni scritte anche in LIBRO.md §1bis
#   e rilette da un gate (v474: un numero, un posto).
ANNI_STRUTTURA = 1          # la finestra: l'ultimo anno di sedute concluse, per data
STR_MOSTRA = 3              # gli ultimi tre massimi e gli ultimi tre minimi di oscillazione
STR_RSI = 3.0               # una divergenza chiede almeno 3 punti di RSI fra i due punti: sotto e' rumore
STR_VOLUMI = 20             # sedute in salita contro sedute in discesa: le ultime 20 concluse
STR_RECENTE = 10            # una chiusura oltre il collo di un doppio e' un segnale NUOVO per 10 sedute concluse
VICINO_ATR = 1.0            # un pavimento entro 1 ATR dal prezzo si raggiunge in una seduta ordinaria
NOTIZIE_ORE = 72            # le ultimissime notizie: 72 ore, cosi' il lunedi' mattina comprende il venerdi'
STATI_STRUTTURA = {("crescenti", "crescenti"): "RIALZISTA", ("decrescenti", "decrescenti"): "RIBASSISTA",
                   ("decrescenti", "crescenti"): "IN COMPRESSIONE", ("crescenti", "decrescenti"): "IN ESPANSIONE"}


SEDUTE_BETA = 250


def seduta_in_corso(barre, adesso=None):
    """Vero se l'ultima barra e' quella di OGGI a New York e la campana delle 16:00 non e' ancora
    suonata: quella barra e' in formazione (v439, v469). Il fuso, mai uno scarto a mano (v470).
    v512 — la regola vive in brief.barra_in_formazione, che la usa anche per la tecnica: una sola (v161)."""
    return brief.barra_in_formazione(barre, adesso)


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
    # v500 — il numero deciso e' quello stampato (v498): arrotondata qui, una volta. Il 18/10 TSLA usciva
    #   "DIVERSIFICA (corr +0,50)" con la regola "stessa scommessa da 0,5 in su": decideva lo 0,4996
    return round(sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy), 2)


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


def rsi_serie(chiusure, n=14):
    """v494 — l'RSI di Wilder su TUTTA la serie, allineato alle chiusure (None prima di n variazioni): seme = media
    delle prime n variazioni, la convenzione della pipeline (v436). Serve alla divergenza fra due punti di
    oscillazione; rsi_wilder ne prende l'ultimo valore: una derivazione sola (v161)."""
    out = [None] * len(chiusure)
    if len(chiusure) <= n:
        return out
    d = [b - a for a, b in zip(chiusure, chiusure[1:])]
    g = sum(max(x, 0) for x in d[:n]) / n
    p = sum(max(-x, 0) for x in d[:n]) / n
    out[n] = 100.0 if p == 0 else 100 - 100 / (1 + g / p)
    for k, x in enumerate(d[n:], start=n + 1):
        g = (g * (n - 1) + max(x, 0)) / n
        p = (p * (n - 1) + max(-x, 0)) / n
        out[k] = 100.0 if p == 0 else 100 - 100 / (1 + g / p)
    return out


def rsi_wilder(barre, n=14):
    """RSI a smorzamento di Wilder, seme = media delle prime n variazioni (la convenzione della
    pipeline, verificata in v436). Sotto 100 barre il valore dipende dalla convenzione piu' che
    dal mercato (v436, SKHY 58-75 secondo il seme): None, un buco e non un numero.
    v494: e' l'ultimo valore di rsi_serie, una derivazione sola (v161)."""
    c = [x["c"] for x in barre]
    if len(c) < 100:
        return None
    return rsi_serie(c, n)[-1]


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


SEDUTA_MINUTI = 390        # la seduta regolare di New York, 09:30-16:00


def volume_seduta(t, barre, adesso=None):
    """v489 — il volume della seduta IN CORSO (richiesta del CEO del 15/10/2026: «fornisci anche volumi», a
    seduta aperta). volumi() la esclude di proposito: una barra in formazione confrontata con sedute intere
    si legge come un crollo d'interesse (v471). Qui si pubblica col tempo trascorso ACCANTO — N azioni finora
    = X% di una seduta media, in M minuti su 390 — due frazioni che si leggono insieme, senza proiettare la
    giornata (v396). Il 15/10 alle 09:46 di New York SK hynix aveva scambiato il 47% di una seduta media in 16
    minuti, gli altri sei nomi guardati fra il 16 e il 19%: e' il confronto fra nomi che parla. La media e'
    sulle ultime 20 sedute CONCLUSE. Solo a seduta aperta e con la quota di OGGI; altrimenti None."""
    adesso = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    minuti = adesso.hour * 60 + adesso.minute - (9 * 60 + 30)
    if (adesso.weekday() >= 5 or not 0 < minuti < SEDUTA_MINUTI or not barre
            or t.get("seduta_quota") != adesso.date().isoformat() or not t.get("vol_oggi")):
        return None
    b = barre[:-1] if seduta_in_corso(barre, adesso) else barre
    v = [x.get("v") for x in b[-20:]]
    if len(v) < 20 or any(not x for x in v):
        return None
    m20 = sum(v) / 20
    return {"azioni": t["vol_oggi"], "pct_media": t["vol_oggi"] / m20 * 100, "minuti": minuti,
            "pct_tempo": minuti / SEDUTA_MINUTI * 100, "ora": t.get("quota_ora")}


def testo_volume_seduta(vs):
    """La frase del volume in corso, una sola per watchlist e ordini aperti (v161)."""
    if not vs:
        return None
    az = vs["azioni"]
    q = (f"{az / 1e6:.1f} mln".replace(".", ",") if az >= 1e6 else f"{az / 1e3:.0f} mila")
    return (f"seduta IN CORSO: {q} azioni finora = {vs['pct_media']:.0f}% di una seduta media, in {vs['minuti']} "
            f"minuti su {SEDUTA_MINUTI} ({vs['pct_tempo']:.0f}% del tempo)")


def percentile_midrank(x, serie):
    """Quota della serie sotto x, piu' meta' dei pari, x 100. Serie vuota = buco."""
    if x is None or not serie:
        return None
    sotto = sum(1 for y in serie if y < x)
    pari = sum(1 for y in serie if y == x)
    return (sotto + pari / 2) / len(serie) * 100


# ---------------------------------------------------------------- v473: ingressi sulla watchlist
def struttura_minimi(barre, adesso=None, n=SEDUTE_MINIMI, atr=None):
    """Il minimo delle ultime n sedute CONCLUSE contro quello delle n precedenti (convenzione,
    n=10): crescenti = la discesa ha smesso di fare nuovi minimi, decrescenti = li sta ancora
    facendo. La seduta in corso si toglie: il suo minimo puo' ancora scendere (v471).
    v500 — entro mezzo ATR i due minimi sono ALLA PARI, la regola dei pavimenti e della struttura (v494): il
    18/10 la base di CRM diceva DECRESCENTI (220,29 contro 221,18) e due righe sotto la struttura chiamava gli
    stessi due minimi ALLA PARI. Una regola sola per "stesso livello"."""
    if seduta_in_corso(barre or [], adesso):
        barre = barre[:-1]
    if not barre or len(barre) < 2 * n:
        return None
    lo = [x.get("l") for x in barre[-2 * n:]]
    if any(v is None for v in lo):
        return None
    ora, prima = min(lo[n:]), min(lo[:n])
    if atr and abs(ora - prima) <= PAV_LARGHEZZA_ATR * atr:
        verso = "alla pari"
    else:
        verso = "crescenti" if ora > prima else ("decrescenti" if ora < prima else "alla pari")
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


def prima_media_sopra(t):
    """La media (20, 50, 200) piu' vicina SOPRA il prezzo, come (nome, valore): il PRIMO SEGNALE che la discesa
    smette di scendere (v473). Una funzione sola per il piano d'ingresso e per gli ordini aperti di
    numeri_libro (v489): due letture della stessa regola divergono al primo ritocco (v161). None = nessuna."""
    px = t.get("px")
    su = sorted((t.get(f"sma{n}"), f"media {n}") for n in (20, 50, 200)
                if px is not None and t.get(f"sma{n}") is not None and t.get(f"sma{n}") > px)
    return (su[0][1], su[0][0]) if su else None


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
    ms = prima_media_sopra(t)
    p["primo_segnale"] = None
    if ms and (p["posizione"] == "zona vuota" or (p["posizione"] == "sotto" and ms[1] < z["basso"])):
        p["primo_segnale"] = (ms[0], dist(ms[1]))
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



# ---------------------------------------------------------------- v487: i pavimenti — entrare sui minimi
def barre_lunghe(tk):
    """Cinque anni di storico giornaliero, per i pavimenti (v487). La fonte non ha l'intervallo di due anni:
    misurato il 15/10/2026, "2Y" e "3Y" restituiscono 252 sedute come "1Y", "5Y" ne restituisce 1.231. Le
    classi di azioni anche nella forma col punto, come _barre_sicure. None = storico NON letto, che la resa
    distingue da 'nessun pavimento' (v389)."""
    for forma in dict.fromkeys([tk, tk.replace("-", ".")]):
        try:
            d = sorted(brief.jget(f"{brief.SA}/symbol/s/{forma}/history?range=5Y&period=Daily")["data"],
                       key=lambda x: x["t"])
            if d:
                return d
        except Exception:
            pass
    return None


def serie_omogenea(barre, salto=PAV_SALTO):
    """La serie dall'ULTIMA operazione societaria in poi, e la data del taglio (None se non ce n'e'). I prezzi
    grezzi di prima di uno scorporo non sono confrontabili con quelli di oggi: WDC il 24/02/2025 (Sandisk)
    passa da 68,70 a 49,02 di chiusura grezza, e il rapporto fra prezzo rettificato e grezzo salta da 0,75 a
    1,00. Un minimo di allora sarebbe un pavimento inventato: meglio non avere il dato che averlo sbagliato
    (v396). I dividendi ordinari spostano quel rapporto di poco e non tagliano."""
    taglio = 0
    for i in range(1, len(barre)):
        a0, c0, a1, c1 = barre[i - 1].get("a"), barre[i - 1].get("c"), barre[i].get("a"), barre[i].get("c")
        if a0 and c0 and a1 and c1 and abs((a1 / c1) / (a0 / c0) - 1) > salto:
            taglio = i
    return barre[taglio:], (barre[taglio]["t"] if taglio else None)


def veicolo_pipeline(d, tk):
    """v492 — la storia della quotazione di `tk`, letta dalla pipeline (SEC EDGAR, 8-K con item 5.06:
    update_data.storia_quotazione). {"verificato": True, "fine": data|None, "deposito": data|None} oppure
    {"verificato": False, "perche": ...}: un titolo non verificato si DICHIARA, non si tratta come uno senza
    veicolo (v406). Qui niente rete: la SEC chiede un contatto nella richiesta, e la pipeline ce l'ha gia'."""
    sq = (((d or {}).get("macro") or {}).get("sec_calendario") or {}).get("storia_quotazione")
    if not isinstance(sq, dict):
        return {"verificato": False, "perche": "la pipeline non pubblica ancora il dato del registro SEC"}
    v = (sq.get("per_titolo") or {}).get(tk)
    if v is None:
        return {"verificato": False, "perche": "SEC EDGAR non letto per questo nome"}
    if v.get("non_verificabile"):
        return {"verificato": False, "perche": v["non_verificabile"]}
    return {"verificato": True, "fine": v.get("fine_veicolo"), "deposito": v.get("deposito")}


def serie_della_societa(barre, veicolo=None, salto=PAV_SALTO):
    """(serie, taglio, motivo) — la serie della SOCIETA' DI OGGI: dall'ultima operazione societaria (serie_omogenea)
    e, per chi e' nato da un veicolo di quotazione VERIFICATO sul registro SEC, dal giorno dopo la sua fine (v492):
    il primo giorno di OKLO come Oklo e' il 10/05/2024, la fine dichiarata il 09/05 (misurato). motivo:
    "veicolo", "societaria" o None. Una regola sola per pavimenti e lettura a 5 anni (v161)."""
    serie, taglio = serie_omogenea(barre, salto)
    v = veicolo or {}
    fine = v.get("fine") if v.get("verificato") else None
    if fine and serie and str(serie[0]["t"])[:10] <= fine:
        dopo = [b for b in serie if str(b["t"])[:10] > fine]
        return dopo, (dopo[0]["t"] if dopo else None), "veicolo"
    return serie, taglio, ("societaria" if taglio else None)


def perni(serie, campo="l", massimi=False, lato=PAV_LATO):
    """v494 — gli indici dei PUNTI DI OSCILLAZIONE di una serie: il piu' basso (o il piu' alto, con massimi=True) di
    `lato` sedute prima e `lato` dopo, e il PRIMO a toccare quel prezzo: un tratto piatto da' un punto solo, al suo
    inizio (v487). Una regola sola per pavimenti e struttura (v161). Un buco nella finestra non da' un punto (v205), e
    le ultime `lato` sedute non possono darne: manca ancora chi lo conferma."""
    scegli = max if massimi else min
    out = []
    for i in range(lato, len(serie) - lato):
        fin = [b.get(campo) for b in serie[i - lato:i + lato + 1]]
        v = serie[i].get(campo)
        if v is None or any(x is None for x in fin) or v != scegli(fin) or fin.index(v) != lato:
            continue
        out.append(i)
    return out


def _con_ordine(z, px, atr):
    """Ordine con limite al bordo alto, stop una chiusura sotto il fondo meno PAV_STOP_ATR, e la perdita allo
    stop per l'unita' di calcolo: la stessa aritmetica per pavimenti e vuoti."""
    stop = z["fondo"] - PAV_STOP_ATR * atr
    stop = stop if stop > 0 else None
    z.update({"ordine": z["alto"], "stop": stop, "pct": (z["alto"] / px - 1) * 100, "atr": (z["alto"] - px) / atr,
              "perdita_pct": (stop / z["alto"] - 1) * 100 if stop else None,
              "perdita_eur": UNITA_EUR * (stop / z["alto"] - 1) if stop else None})
    return z


def pavimenti(barre, px, atr, adesso=None, anni=ANNI_PAVIMENTI, veicolo=None):
    """v487 — i PAVIMENTI sotto il prezzo (decisione del CEO del 15/10/2026: «entrare sui minimi», non sulla
    risalita): dove negli ultimi due anni il titolo ha smesso di scendere ed e' risalito — minimi di
    oscillazione raggruppati entro mezzo ATR — e, a parte, i vuoti di prezzo mai richiusi. Per ciascuno
    l'ordine con limite al bordo alto, lo stop e la perdita allo stop per l'unita' di calcolo. Solo fatti delle
    barre: la frase la scrive la resa (v448). La seduta in corso si toglie: il suo minimo puo' ancora scendere
    (v471). None = storico non letto o prezzo/ATR mancanti, che NON e' 'nessun pavimento'."""
    if not barre or px is None or not atr:
        return None
    if seduta_in_corso(barre, adesso):
        barre = barre[:-1]
    # v492 — la serie della societa' di oggi: anche il veicolo di quotazione si taglia, non solo lo scorporo
    serie, taglio, motivo = serie_della_societa(barre, veicolo)
    if not serie:
        return None
    fine = datetime.fromisoformat(serie[-1]["t"]).date()
    inizio = fine.replace(year=fine.year - anni, day=min(fine.day, 28) if fine.month == 2 else fine.day).isoformat()
    serie = [b for b in serie if b["t"] >= inizio]
    vols = [b["v"] for b in serie if b.get("v")]
    minimi = []
    # il piu' basso della finestra E il primo a toccare quel prezzo: un tratto piatto da' un pavimento solo, al suo
    #   inizio, invece di un 'tocco' per ogni seduta uguale — la regola di perni, la stessa della struttura (v494)
    for i in perni(serie, "l"):
        lo = serie[i]["l"]
        if lo >= px:
            continue
        dopo = [b["h"] for b in serie[i + 1:i + 1 + PAV_RIMBALZO] if b.get("h") is not None]
        minimi.append({"data": serie[i]["t"], "minimo": lo,
                       "rimbalzo_pct": (max(dopo) / lo - 1) * 100 if dopo else None,
                       "volume_pct": percentile_midrank(serie[i].get("v"), vols)})
    zone = []
    for m in sorted(minimi, key=lambda m: (-m["minimo"], m["data"])):
        if zone and zone[-1]["alto"] - m["minimo"] <= PAV_LARGHEZZA_ATR * atr:
            zone[-1]["fondo"] = m["minimo"]
            zone[-1]["tocchi"].append(m)
        else:
            zone.append({"alto": m["minimo"], "fondo": m["minimo"], "tocchi": [m]})
    vuoti = []
    for i in range(1, len(serie)):
        su, giu = serie[i - 1].get("h"), serie[i].get("l")
        if su is None or giu is None or giu <= su:
            continue
        # la parte MAI scambiata: fra il massimo del giorno prima e il minimo toccato da allora
        resta = min(b["l"] for b in serie[i:] if b.get("l") is not None)
        if su < resta < px:
            vuoti.append({"data": serie[i]["t"], "fondo": su, "alto": resta})
    lo_serie = min((b for b in serie if b.get("l") is not None), key=lambda b: b["l"], default=None)
    # i piu' vicini, e in coda il PIU' TOCCATO quando sta piu' in basso e ha piu' tocchi di tutti quelli mostrati:
    #   su OKLO i tre piu' vicini sono minimi singoli, e il triplo minimo a 17 restava fuori (misurato il 15/10)
    scelte = zone[:PAV_MOSTRA]
    # v488 — solo SUBITO SOTTO i tre mostrati (entro PAV_CODA_ATR dall'ultimo): la prima stesura pescava il piu'
    #   toccato in tutta la finestra e su MU portava 118 (-87%), la base di due anni fa da cui il titolo e' partito:
    #   un fatto vero e inutile per entrare (misurato il 15/10: 33 code su 56 titoli, ne restano 10, tutte vicine)
    vicine = [z for z in zone[PAV_MOSTRA:] if scelte and scelte[-1]["fondo"] - z["alto"] <= PAV_CODA_ATR * atr]
    if vicine:
        forte = max(vicine, key=lambda z: (len(z["tocchi"]), z["alto"]))
        if len(forte["tocchi"]) > max(len(z["tocchi"]) for z in scelte):
            scelte = scelte + [dict(forte, piu_toccato=True)]
    return {"minimi": [_con_ordine(z, px, atr) for z in scelte],
            "vuoti": [_con_ordine(v, px, atr) for v in sorted(vuoti, key=lambda v: -v["alto"])[:PAV_VUOTI]],
            "da": serie[0]["t"], "fino_a": serie[-1]["t"], "sedute": len(serie), "taglio": taglio,
            "taglio_motivo": motivo,
            "minimo_serie": {"minimo": lo_serie["l"], "data": lo_serie["t"]} if lo_serie else None}


def settimane_concluse(barre, adesso=None):
    """[(data dell'ultima seduta della settimana, chiusura)] delle settimane CONCLUSE, per data (v207). Una
    settimana e' conclusa dalle 16:00 di New York del suo venerdi': prima la sua chiusura non esiste ancora — la
    regola della seduta in corso (v471), col fuso e non con uno scarto (v470). Un venerdi' festivo la chiude un
    giorno dopo: un ritardo dichiarato, non un prezzo inventato."""
    from datetime import date as _data, time as _ora, timedelta as _td
    ny = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    sett = {}
    for b in barre or []:
        if b.get("c") is None or not b.get("t"):
            continue
        g = _data.fromisoformat(str(b["t"])[:10])
        sett[g - _td(days=g.weekday())] = (str(b["t"])[:10], b["c"])     # in ordine di data: vince l'ultima seduta
    return [sett[lun] for lun in sorted(sett)
            if datetime.combine(lun + _td(days=4), _ora(16, 0), tzinfo=brief.NEW_YORK) <= ny]


def lettura_5anni(barre, px, adesso=None, veicolo=None, anni=ANNI_LETTURA):
    """v492 — LA LETTURA A 5 ANNI di un titolo (decisione del CEO del 16/10/2026): medie a 30, 50 e 200 settimane
    con la loro pendenza, massimo e minimo con la data, posizione nell'intervallo e quota del rialzo gia'
    restituita. Solo fatti delle barre, la frase la scrive la resa (v448). La serie e' quella dei pavimenti
    (serie_della_societa: una regola sola, v161) e la seduta in corso si toglie (v471). Una media senza abbastanza
    settimane e' None, mai calcolata su meno. None = storico non letto o prezzo mancante, che NON e' 'nessun
    livello' (v389)."""
    from datetime import date as _data, timedelta as _td
    if not barre or px is None:
        return None
    if seduta_in_corso(barre, adesso):
        barre = barre[:-1]
    serie, taglio, motivo = serie_della_societa(barre, veicolo)
    if not serie:
        return None
    fine = _data.fromisoformat(str(serie[-1]["t"])[:10])
    inizio = fine.replace(year=fine.year - anni, day=min(fine.day, 28) if fine.month == 2 else fine.day).isoformat()
    serie = [b for b in serie if str(b["t"])[:10] >= inizio]
    con_h = [b for b in serie if b.get("h") is not None]
    con_l = [b for b in serie if b.get("l") is not None]
    if not con_h or not con_l:
        return None
    chiusure = [c for _, c in settimane_concluse(serie, adesso)]
    medie = {}
    for k in SETTIMANE_MEDIE:
        if len(chiusure) < k:
            medie[k] = None
            continue
        m = sum(chiusure[-k:]) / k
        prima = (sum(chiusure[-k - SETTIMANE_PENDENZA:-SETTIMANE_PENDENZA]) / k
                 if len(chiusure) >= k + SETTIMANE_PENDENZA else None)
        medie[k] = {"valore": m, "dist_pct": (px / m - 1) * 100, "pend_pct": (m / prima - 1) * 100 if prima else None}
    hi = max(con_h, key=lambda b: b["h"])                 # a parita', il primo giorno in cui e' stato toccato
    lo = min(con_l, key=lambda b: b["l"])
    prima_hi = [b for b in con_l if b["t"] < hi["t"]]
    base = min(prima_hi, key=lambda b: b["l"]) if prima_hi else None
    amp = hi["h"] - lo["l"]
    breve = str(serie[0]["t"])[:10] > (_data.fromisoformat(inizio) + _td(days=14)).isoformat()
    # v505 — IL PUNTO DI PARTENZA DEL RIALZO DEVE STARE DENTRO LA FINESTRA. Se la finestra di cinque anni si apre gia' a
    #   quel livello o sotto (il minimo delle prime PAV_LATO sedute, la regola dei pavimenti: un minimo si riconosce
    #   dalle sedute che lo precedono), il rialzo verso il massimo e' cominciato PRIMA della finestra e la sua base
    #   vera non si vede: misurato il 19/10 su PFE e NKE, base il primo giorno, «restituito» 155% e 613% di un rialzo
    #   di cui la finestra mostra solo la coda. Vale solo se la storia continua oltre la finestra: un titolo quotato
    #   di recente (breve) parte dal suo primo prezzo, e quello e' un punto di partenza vero.
    censurato = bool(base) and not breve and min(b["l"] for b in con_l[:PAV_LATO]) <= base["l"]
    return {"da": str(serie[0]["t"])[:10], "fino_a": str(serie[-1]["t"])[:10], "inizio_finestra": inizio,
            "breve": breve,
            "settimane": len(chiusure), "taglio": taglio, "motivo": motivo, "medie": medie, "px": px,
            "massimo": {"prezzo": hi["h"], "data": str(hi["t"])[:10]},
            "minimo": {"prezzo": lo["l"], "data": str(lo["t"])[:10]},
            "dmax_pct": (px / hi["h"] - 1) * 100, "dmin_pct": (px / lo["l"] - 1) * 100 if lo["l"] > 0 else None,
            "posizione": (px - lo["l"]) / amp * 100 if amp > 0 else None,
            "rialzo": ({"da": base["l"], "data": str(base["t"])[:10], "censurato": censurato,
                        "restituito_pct": None if censurato else (hi["h"] - px) / (hi["h"] - base["l"]) * 100,
                        "dist_base_pct": (px / base["l"] - 1) * 100 if base["l"] > 0 else None}
                       if base and hi["h"] > base["l"] else None)}


def struttura(barre, px, atr, adesso=None, veicolo=None, anni=ANNI_STRUTTURA):
    """v494 — LA STRUTTURA DELLE OSCILLAZIONI (richiesta del CEO del 17/10/2026: «analizza anche massimi e minimi
    decrescenti … quando si presenta la possibilità di ingresso o si attivano i parametri di uscita»): i punti di
    oscillazione dell'ultimo anno con la regola dei pavimenti (perni); il verso degli ultimi due massimi e degli
    ultimi due minimi — ALLA PARI entro mezzo ATR, la regola per cui due minimi sono lo stesso pavimento — e quanti
    di fila; la chiusura conclusa OLTRE l'ultimo punto, cioè la sequenza rotta prima che un punto nuovo la confermi,
    con l'estremo toccato da allora; i doppi minimi e doppi massimi col loro collo; la divergenza dell'RSI; le sedute
    in salita e in discesa. Solo fatti delle barre: la frase la scrive la resa (v448). La serie è quella della società
    di oggi (serie_della_societa, v492) e la seduta in corso si toglie (v471). L'RSI si calcola su tutta la serie e un
    punto con meno di 100 chiusure prima non ne ha (v436). None = storico non letto o prezzo/ATR mancanti, che NON è
    'nessuna struttura' (v389)."""
    from datetime import date as _data
    if not barre or px is None or not atr:
        return None
    if seduta_in_corso(barre, adesso):
        barre = barre[:-1]
    piena, taglio, motivo = serie_della_societa(barre, veicolo)
    if not piena:
        return None
    fine = _data.fromisoformat(str(piena[-1]["t"])[:10])
    inizio = fine.replace(year=fine.year - anni, day=min(fine.day, 28) if fine.month == 2 else fine.day).isoformat()
    s0 = next((k for k, b in enumerate(piena) if str(b["t"])[:10] >= inizio), len(piena))
    serie = piena[s0:]
    chiusure = [b.get("c") for b in piena]
    rsi = rsi_serie(chiusure) if all(c is not None for c in chiusure) else [None] * len(piena)

    def punto(i, campo):
        k = s0 + i
        return {"data": str(serie[i]["t"])[:10], "prezzo": serie[i][campo], "i": i,
                "rsi": rsi[k] if k >= 99 else None}
    massimi = [punto(i, "h") for i in perni(serie, "h", massimi=True)]
    minimi = [punto(i, "l") for i in perni(serie, "l")]

    def verso(a, b):
        if abs(b - a) <= PAV_LARGHEZZA_ATR * atr:
            return "alla pari"
        return "crescenti" if b > a else "decrescenti"

    def di_fila(P):
        """Il verso degli ultimi due punti e quanti punti di fila lo seguono (2 = solo gli ultimi due)."""
        if len(P) < 2:
            return None, len(P)
        v, k = verso(P[-2]["prezzo"], P[-1]["prezzo"]), 2
        for j in range(len(P) - 2, 0, -1):
            if verso(P[j - 1]["prezzo"], P[j]["prezzo"]) != v:
                break
            k += 1
        return v, k
    vm, km = di_fila(massimi)
    vn, kn = di_fila(minimi)
    stato = "NON MISURABILE" if vm is None or vn is None else STATI_STRUTTURA.get((vm, vn), "LATERALE")
    c = serie[-1].get("c")
    dist = lambda v: {"pct": (v / px - 1) * 100, "atr": (v - px) / atr}
    su, giu = (massimi[-1] if massimi else None), (minimi[-1] if minimi else None)
    sotto = bool(giu and c is not None and c < giu["prezzo"])
    sopra = bool(su and c is not None and c > su["prezzo"])
    if sotto and sopra:          # solo se l'ultimo massimo sta sotto l'ultimo minimo: decide il punto piu' recente
        sotto, sopra = giu["i"] > su["i"], su["i"] > giu["i"]
    rottura = "ribasso" if sotto else ("rialzo" if sopra else None)
    estremo = None
    if rottura:
        rif, campo = (giu, "l") if rottura == "ribasso" else (su, "h")
        dopo = [(i, b[campo]) for i, b in enumerate(serie) if i > rif["i"] and b.get(campo) is not None]
        if dopo:
            # il primo a toccare l'estremo, come per i punti di oscillazione
            i, v = (min if rottura == "ribasso" else max)(dopo, key=lambda iv: iv[1])
            estremo = {"prezzo": v, "data": str(serie[i]["t"])[:10], "i": i, "sedute_dopo": len(serie) - 1 - i,
                       "rsi": rsi[s0 + i] if s0 + i >= 99 else None}
    doppi = []
    for P, tipo, campo in ((minimi, "minimo", "h"), (massimi, "massimo", "l")):
        if len(P) < 2 or verso(P[-2]["prezzo"], P[-1]["prezzo"]) != "alla pari" or c is None:
            continue
        a, b = P[-2], P[-1]
        mezzo = [x[campo] for x in serie[a["i"] + 1:b["i"]] if x.get(campo) is not None]
        if not mezzo:
            continue
        collo = max(mezzo) if tipo == "minimo" else min(mezzo)
        basso, alto = min(a["prezzo"], b["prezzo"]), max(a["prezzo"], b["prezzo"])
        if tipo == "minimo":
            esito = "confermato" if c > collo else ("rotto" if c < basso else "da confermare")
        else:
            esito = "confermato" if c < collo else ("superato" if c > alto else "da confermare")
        # da quando l'esito di oggi regge: l'inizio della fila di chiusure, dopo il secondo punto, tutte oltre il
        #   livello — un doppio minimo confermato a fine agosto e' storia, uno confermato ieri e' un segnale
        oltre = {("minimo", "confermato"): lambda x: x > collo, ("minimo", "rotto"): lambda x: x < basso,
                 ("massimo", "confermato"): lambda x: x < collo, ("massimo", "superato"): lambda x: x > alto
                 }.get((tipo, esito))
        dal = None
        if oltre:
            k = len(serie) - 1
            while k > b["i"] and serie[k].get("c") is not None and oltre(serie[k]["c"]):
                k -= 1
            dal = k + 1
        doppi.append({"tipo": tipo, "basso": basso, "alto": alto, "date": (a["data"], b["data"]), "collo": collo,
                      "esito": esito, **dist(collo),
                      "dal": None if dal is None else str(serie[dal]["t"])[:10],
                      "sedute_dal": None if dal is None else len(serie) - 1 - dal})
    divergenze = []

    def _div(a, b, tipo, formazione):
        if a.get("rsi") is None or b.get("rsi") is None:
            return
        v = verso(a["prezzo"], b["prezzo"])
        if (tipo == "rialzista" and v == "decrescenti" and b["rsi"] - a["rsi"] >= STR_RSI) or \
           (tipo == "ribassista" and v == "crescenti" and a["rsi"] - b["rsi"] >= STR_RSI):
            divergenze.append({"tipo": tipo, "in_formazione": formazione, "prezzi": (a["prezzo"], b["prezzo"]),
                               "rsi": (a["rsi"], b["rsi"]), "date": (a["data"], b["data"])})
    if len(minimi) >= 2:
        _div(minimi[-2], minimi[-1], "rialzista", False)
    if len(massimi) >= 2:
        _div(massimi[-2], massimi[-1], "ribassista", False)
    if estremo and rottura == "ribasso":
        _div(giu, estremo, "rialzista", True)
    if estremo and rottura == "rialzo":
        _div(su, estremo, "ribassista", True)
    ult = serie[-(STR_VOLUMI + 1):]
    volumi = None
    if len(ult) == STR_VOLUMI + 1 and all(x.get("v") is not None and x.get("c") is not None for x in ult):
        in_su = [b["v"] for a, b in zip(ult, ult[1:]) if b["c"] > a["c"]]
        in_giu = [b["v"] for a, b in zip(ult, ult[1:]) if b["c"] < a["c"]]
        volumi = {"su": len(in_su), "giu": len(in_giu),
                  "rapporto": ((sum(in_su) / len(in_su)) / (sum(in_giu) / len(in_giu))
                               if in_su and in_giu and sum(in_giu) else None)}
    return {"da": str(serie[0]["t"])[:10], "fino_a": str(serie[-1]["t"])[:10], "inizio_finestra": inizio,
            "sedute": len(serie), "taglio": taglio if taglio and str(taglio)[:10] > inizio else None, "motivo": motivo,
            "chiusura": c, "seduta": str(serie[-1]["t"])[:10], "stato": stato,
            "massimi": massimi[-STR_MOSTRA:], "minimi": minimi[-STR_MOSTRA:],
            "verso_massimi": vm, "fila_massimi": km, "verso_minimi": vn, "fila_minimi": kn,
            "su": None if su is None else {**su, **dist(su["prezzo"])},
            "giu": None if giu is None else {**giu, **dist(giu["prezzo"])},
            "rottura": rottura, "estremo": estremo, "doppi": doppi, "divergenze": divergenze, "volumi": volumi}


# ---------------------------------------------------------------- v511: ipervenduto, supporto e accumulo, stagionalita'
# Domanda del CEO del 24/10/2026: «Anche la stagionalità, il sentiment e quando un'azione è in ipervenduto tutte queste
# cose sono strutturati nell'analisi? O se un'azione è in una zona di supporto e accumulo e quindi c'è un cambio
# eventualmente di tendenza»; il 25/10, alla proposta: «Ok». Tre righe per ogni posizione e ogni sorvegliato, tutte
# INFORMAZIONE — non una prova della tenuta, non un colore, non un ingresso (la regola della struttura dal 17/10):
#   · gli OSCILLATORI coi loro estremi: le stesse formule della pipeline (update_data.batteria_tecnica, un gate le
#     confronta) sulle barre dell'analisi, quelle di tutti gli altri numeri tecnici in chat, e solo sulle sedute
#     CONCLUSE (v471). Le soglie sono le convenzioni di lettura dei manuali, dichiarate (v240);
#   · SUPPORTO E ACCUMULO: quante delle quattro condizioni che i manuali leggono come una base che si forma sono
#     presenti oggi — nessun punteggio (v200): si dice QUALI, e una condizione non misurata e' un buco (v205);
#   · la STAGIONALITA' del titolo nel mese in corso e nel successivo, dallo storico mensile che la pipeline pubblica
#     (almeno 8 anni per mese, v316: una media su tre anni fra esiti opposti e' rumore), col campione accanto. Cambia
#     una volta al mese: il ritardo della pipeline qui non pesa. ⚠ Una media su N anni non e' una previsione.
SOGLIE_OSCILLATORI = {"rsi": (30.0, 70.0), "stocastico": (20.0, 80.0), "williams": (-80.0, -20.0), "cci": (-100.0, 100.0)}
OSC_MINIMO = 2               # ipervenduto (o ipercomprato) = almeno 2 dei 4 oltre la propria soglia: convenzione
NOMI_OSCILLATORI = {"rsi": "RSI 14", "stocastico": "stocastico 14/3 (%K)", "williams": "Williams %R 14", "cci": "CCI 20"}


def oscillatori(barre, adesso=None):
    """v511 — RSI 14 (Wilder, rsi_wilder: None sotto 100 barre, v436), stocastico 14/3, Williams %R 14 e CCI 20 con le
    formule di update_data.batteria_tecnica, sulle sedute concluse. None = barre non lette o meno di 30 sedute."""
    if not barre:
        return None
    if seduta_in_corso(barre, adesso):
        barre = barre[:-1]
    b = [x for x in barre if x.get("h") is not None and x.get("l") is not None and x.get("c") is not None]
    if len(b) < 30:
        return None
    h, lo, c = [x["h"] for x in b], [x["l"] for x in b], [x["c"] for x in b]

    def k_a(i):
        aa, bb = max(h[i - 13:i + 1]), min(lo[i - 13:i + 1])
        return None if aa == bb else 100 * (c[i] - bb) / (aa - bb)
    k3 = [k_a(i) for i in range(len(b) - 3, len(b))]
    aa, bb = max(h[-14:]), min(lo[-14:])
    tp = [(x + y + z) / 3 for x, y, z in zip(h, lo, c)]
    m20 = [None] * len(tp)
    for i in range(19, len(tp)):
        m20[i] = sum(tp[i - 19:i + 1]) / 20
    cci = None
    if len(tp) >= 39:
        dev = [abs(tp[i] - m20[i]) for i in range(len(tp) - 20, len(tp))]
        md = sum(dev) / 20
        cci = (tp[-1] - m20[-1]) / (0.015 * md) if md else None
    return {"seduta": str(b[-1]["t"])[:10], "rsi": rsi_wilder(b), "stocastico": k3[-1],
            "stocastico_d": sum(k3) / 3 if all(x is not None for x in k3) else None,
            "williams": None if aa == bb else -100 * (aa - c[-1]) / (aa - bb), "cci": cci}


def lettura_oscillatori(o):
    """{stato, ipervenduto: [nomi], ipercomprato: [nomi], misurati}. Lo stato e' una CONVENZIONE di lettura: almeno
    OSC_MINIMO dei quattro oltre la soglia; sotto OSC_MINIMO misurati e' NON MISURABILE (v389)."""
    if not o:
        return None
    vals = {k: o.get(k) for k in SOGLIE_OSCILLATORI}
    giu = [k for k, v in vals.items() if v is not None and v <= SOGLIE_OSCILLATORI[k][0]]
    su = [k for k, v in vals.items() if v is not None and v >= SOGLIE_OSCILLATORI[k][1]]
    mis = [k for k, v in vals.items() if v is not None]
    if len(mis) < OSC_MINIMO:
        stato = "NON MISURABILE"
    elif len(giu) >= OSC_MINIMO and len(su) >= OSC_MINIMO:
        stato = "CONTRADDITTORIO"
    elif len(giu) >= OSC_MINIMO:
        stato = "IPERVENDUTO"
    elif len(su) >= OSC_MINIMO:
        stato = "IPERCOMPRATO"
    else:
        stato = "NELLA NORMA"
    return {"stato": stato, "ipervenduto": giu, "ipercomprato": su, "misurati": mis}


def supporto_accumulo(pav, osc, st):
    """v511 — le quattro condizioni che i manuali leggono come una BASE che si forma, una per una: [(nome, vera,
    testo)] dove vera e' True, False o None (non misurata: un buco, non un no). Nessun punteggio (v200).
      1. sul pavimento: un minimo di oscillazione raggruppato entro 1 ATR dal prezzo (VICINO_ATR, rotazione.pavimenti);
      2. ipervenduto: lettura_oscillatori;
      3. accumulo: nelle ultime 20 sedute concluse il volume medio delle sedute in salita supera quello delle sedute in
         discesa (rotazione.struttura);
      4. segnale di svolta: una divergenza rialzista dell'RSI, o un doppio minimo confermato da non piu' di STR_RECENTE
         sedute (rotazione.struttura)."""
    L = []
    if pav is None:
        L.append(("sul pavimento", None, "pavimenti non calcolati"))
    else:
        vic = [z for z in pav.get("minimi") or [] if z.get("atr") is not None and abs(z["atr"]) <= VICINO_ATR]
        L.append(("sul pavimento", bool(vic),
                  (f"pavimento {prezzo(vic[0]['alto'])} a {piano(abs(vic[0]['atr']), 1)} ATR" if vic
                   else "nessun pavimento entro 1 ATR")))
    lo = lettura_oscillatori(osc)
    if not lo or lo["stato"] == "NON MISURABILE":
        L.append(("ipervenduto", None, "oscillatori non misurabili"))
    else:
        L.append(("ipervenduto", lo["stato"] == "IPERVENDUTO",
                  (f"{len(lo['ipervenduto'])} oscillatori su {len(lo['misurati'])} oltre la soglia" if lo["ipervenduto"]
                   else "nessun oscillatore oltre la soglia dell'ipervenduto")))
    v = (st or {}).get("volumi")
    if not v or v.get("rapporto") is None:
        L.append(("accumulo", None, "volumi in salita e in discesa non misurabili"))
    else:
        L.append(("accumulo", v["rapporto"] > 1,
                  f"volume medio in salita {piano(v['rapporto'], 2)} volte quello in discesa ({v['su']} sedute su, "
                  f"{v['giu']} giu')"))
    if st is None:
        L.append(("segnale di svolta", None, "struttura non letta"))
    else:
        div = [d for d in st.get("divergenze") or [] if d["tipo"] == "rialzista"]
        dop = [d for d in st.get("doppi") or [] if d["tipo"] == "minimo" and d["esito"] == "confermato"
               and d.get("sedute_dal") is not None and d["sedute_dal"] <= STR_RECENTE]
        testo = ("divergenza rialzista dell'RSI" + (" in formazione" if div and div[0]["in_formazione"] else "")
                 if div else f"doppio minimo confermato dal {dop[0]['dal']}" if dop
                 else "ne' divergenza rialzista ne' doppio minimo confermato di recente")
        L.append(("segnale di svolta", bool(div or dop), testo))
    return L


def righe_ipervenduto_accumulo(osc, pav, st):
    """La resa: la riga degli oscillatori e quella del supporto e dell'accumulo. Le soglie si dichiarano una volta per
    blocco (INTESTAZIONE_IPERVENDUTO, v407)."""
    if not osc:
        r1 = "oscillatori: barre NON lette o meno di 30 sedute concluse — non vuol dire 'nella norma'"
    else:
        lo = lettura_oscillatori(osc)
        # RSI e stocastico sono livelli su 0-100, senza verso (piano); Williams e CCI hanno il segno nella definizione
        parti = [f"{NOMI_OSCILLATORI[k]} " + ("n.d." if osc.get(k) is None else
                                              (piano(osc[k], 1) if k in ("rsi", "stocastico") else n(osc[k], 1)))
                 for k in SOGLIE_OSCILLATORI]
        r1 = f"oscillatori (seduta del {osc['seduta']}): " + " · ".join(parti) + f" — {lo['stato']}"
        if lo["ipervenduto"]:
            r1 += " (oltre la soglia dell'ipervenduto: " + ", ".join(NOMI_OSCILLATORI[k] for k in lo["ipervenduto"]) + ")"
        if lo["ipercomprato"]:
            r1 += " (oltre la soglia dell'ipercomprato: " + ", ".join(NOMI_OSCILLATORI[k] for k in lo["ipercomprato"]) + ")"
    cond = supporto_accumulo(pav, osc, st)
    vere = [c for c in cond if c[1] is True]
    nm = [c for c in cond if c[1] is None]
    r2 = (f"supporto e accumulo: {len(vere)} {'condizione' if len(vere) == 1 else 'condizioni'} su {len(cond)}"
          + (f" ({len(nm)} non misurate)" if nm else "") + " — "
          + " · ".join(f"{'SI' if c[1] else ('n.d.' if c[1] is None else 'no')} {c[0]}: {c[2]}" for c in cond)
          + " · un'informazione, non un ingresso")
    return [r1, r2]


def _soglie_testo(i, segno):
    # le soglie sono intere: si scrivono senza decimali e col meno, da sole — l'intestazione si costruisce al
    #   caricamento del modulo, prima delle funzioni di resa (piano, n) definite piu' sotto
    return ", ".join(f"{NOMI_OSCILLATORI[k].split(' ')[0]} {segno} {int(round(v[i]))}"
                     for k, v in SOGLIE_OSCILLATORI.items())


INTESTAZIONE_IPERVENDUTO = (   # v511 — dichiarata una volta per blocco (v407), e in LIBRO.md §1bis; le soglie dalle costanti
    "oscillatori e supporto/accumulo (domanda del CEO del 24/10/2026) = RSI 14 (Wilder), stocastico 14/3, Williams %R 14 "
    "e CCI 20 sulle sedute concluse, con le formule della pipeline · soglie di lettura dei manuali, convenzioni: "
    f"ipervenduto {_soglie_testo(0, '<=')}; ipercomprato {_soglie_testo(1, '>=')}; "
    f"lo stato vale con almeno {OSC_MINIMO} dei quattro oltre la soglia · supporto e "
    "accumulo = quante delle quattro condizioni di una base sono presenti (sul pavimento entro 1 ATR, ipervenduto, volume "
    f"in salita maggiore che in discesa sulle ultime {STR_VOLUMI} sedute, divergenza rialzista o doppio minimo confermato "
    f"da non piu' di {STR_RECENTE} sedute) — contate, non pesate (v200) · informazione, non una prova della tenuta ne' "
    "un ingresso")


def stagionalita_mesi(stag, adesso=None):
    """v511 — la stagionalita' del titolo nel mese in corso e nel successivo (mese di New York), dallo storico mensile
    della pipeline (tv.stagionalita: media, mediana, quota di mesi positivi, campione, peggiore e migliore). Un mese
    senza voce non ha abbastanza anni (almeno 8): si dice, non si stima."""
    ny = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    mesi = (ny.month, ny.month % 12 + 1)
    per = {x.get("mese"): x for x in (stag or []) if isinstance(x, dict)}
    return [(m, per.get(m)) for m in mesi]


def riga_stagionalita(stag, adesso=None):
    if not stag:
        return ("stagionalita' del titolo: la pipeline non la pubblica (meno di 8 anni di storico mensile, o titolo non "
                "seguito) — non vuol dire 'nessuna stagionalita''")
    parti = []
    for m, x in stagionalita_mesi(stag, adesso):
        nome = brief.MESI_IT[m - 1]
        if not x:
            parti.append(f"{nome}: meno di 8 anni nello storico, nessuna media")
            continue
        parti.append(f"{nome} media {n(x.get('media'), 1, '%')}, mediana {n(x.get('mediana'), 1, '%')}, positivo "
                     f"{art('il', str(x.get('positivi_pct')) + '%')} delle volte su {x.get('campione')} anni (peggiore {n(x.get('peggio'), 1, '%')}, "
                     f"migliore {n(x.get('meglio'), 1, '%')})")
    return ("stagionalita' del titolo (storico mensile della pipeline; una media su N anni, non una previsione): "
            + " · ".join(parti))


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
            "atr": t.get("atr"), "min52": t.get("min52"), "minimi": struttura_minimi(barre, atr=t.get("atr")),
            "dal_minimo": dal_minimo(barre, t["px"]),
            # v489 — il volume della seduta in corso, col tempo trascorso (None fuori dalla seduta)
            "vol_seduta_corso": volume_seduta(t, barre),
            # v511 — gli oscillatori coi loro estremi, sulle sedute concluse delle stesse barre
            "oscillatori": oscillatori(barre)}


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
        # v512 — analisti, CDS, short e trimestri letti alla fonte nel giro, dove piu' recenti (scripts/fonti_titoli.py)
        import fonti_titoli
        d = fonti_titoli.carica(d)
        tilt = (d.get("macro") or {}).get("tilt") or []
    except (OSError, ValueError):
        tilt, d = [], {}
    target = target_pipeline(d)
    asof_target = d.get("updated_at")
    nomi = sorted({p["tk"] for r in tilt for p in (r.get("prime") or [])})
    import numeri_libro
    # v481 — SMH e i leader del semaforo sempre: la tenuta dei sorvegliati ne legge il colore
    tutti = sorted(set(qta) | {r["ticker"] for r in tilt} | set(nomi) | {s["tk"] for s in sorv} | {"SPY", "QQQ", "SMH"}
                   | set(numeri_libro.LEADER))
    # v473 — il calendario delle trimestrali gira MENTRE si scaricano le barre: ~20 secondi di
    #   richieste a Nasdaq che altrimenti si sommerebbero al resto.
    with ThreadPoolExecutor(2) as ex_cal:
        # v474: tutto l'universo, non i soli sorvegliati — il calendario si legge per GIORNO e si
        #   filtra dopo, quindi i candidati di settore hanno la loro trimestrale allo stesso costo
        fut_cal = ex_cal.submit(calendario_sicuro, tutti)
        # v500 — l'ultima trimestrale riportata dei sorvegliati (Nasdaq), ACCANTO al calendario e mentre si scaricano
        #   le barre. In coda al calendario costava 24 secondi in piu' a ogni giro; misurato il 18/10: 46 nomi in
        #   15 secondi con otto richieste insieme verso la stessa fonte, nessun rifiuto. Se la fonte rifiuta, ogni
        #   nome lo dichiara (NON letto) invece di sparire (v389)
        fut_ut = ex_cal.submit(ultime_sicure, [s["tk"] for s in sorv])
        with ThreadPoolExecutor(brief.PARALLELI) as ex:
            B = dict(zip(tutti, ex.map(_barre_sicure, tutti)))
        cal = fut_cal.result()
        ultime = fut_ut.result()
    rlibro = serie_libro({tk: B.get(tk) for tk in qta if B.get(tk)}, qta)
    rspy = rendimenti_per_data(B["SPY"]) if B.get("SPY") else {}
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        S = dict(zip(tutti, ex.map(lambda tk: scheda(tk, B.get(tk), rlibro, rspy, target), tutti)))
    seguiti = set(qta) | {s["tk"] for s in sorv}
    # v500 — le righe della pipeline si costruiscono in un posto solo (v161), con il deposito SEC attaccato
    pipe = numeri_libro.righe_pipeline(d)
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
                                    # v492 — il P/E dei candidati: solo chi la pipeline segue ha i multipli
                                    "in_pipeline": p["tk"] in pipe, "stats": (pipe.get(p["tk"]) or {}).get("stats"),
                                    "rendimento": (pipe.get(p["tk"]) or {}).get("rendimento", "assente"),
                                    "analisti": (pipe.get(p["tk"]) or {}).get("analisti"),
                                    "stato": stato_titolo(*(lambda x: (x.get("px"), x.get("sma200"),
                                             x.get("pend50"), x.get("d50_atr"), x.get("corr_libro")))(S.get(p["tk"]) or {}))}
                                   for p in (r.get("prime") or [])]})
    prima_trim = {}
    for a in cal.get("attesi") or []:
        prima_trim.setdefault(a["tk"], a)          # gli attesi arrivano gia' in ordine di data
    # v481 — la regola di tenuta del CEO (LIBRO.md §1sexies) vale anche per i nomi oggetto di analisi:
    #   la STESSA funzione delle posizioni, col semaforo calcolato sugli stessi dati (un'implementazione).
    # v511 — credito e tassi del semaforo dalla fonte letta adesso, la stessa lettura del giro (scripts/fonti_dirette.py)
    import fonti_dirette
    giro = fonti_dirette.del_giro(d)
    sem = numeri_libro.semaforo(B.get("SMH"), {t: B.get(t) for t in numeri_libro.LEADER},
                                numeri_libro.segnali_pipeline(d, giro["scelta"]))
    watch = [{**(S.get(s["tk"]) or {"tk": s["tk"], "errore": "non letto"}),
              "stato": stato_titolo(*(lambda x: (x.get("px"), x.get("sma200"), x.get("pend50"),
                                                  x.get("d50_atr"), x.get("corr_libro")))(S.get(s["tk"]) or {})),
              # v473 — cio' che serve al piano d'ingresso e che la scheda non ha
              "nota": s.get("nota"), "trimestrale": prima_trim.get(s["tk"]),
              "trimestrale_yf": (pipe.get(s["tk"]) or {}).get("earnings_date"),
              "analisti": (pipe.get(s["tk"]) or {}).get("analisti"), "in_pipeline": s["tk"] in pipe,
              # v492 — i multipli per il P/E, e la storia della quotazione (veicolo, SEC EDGAR) dalla pipeline
              "stats": (pipe.get(s["tk"]) or {}).get("stats"), "veicolo": veicolo_pipeline(d, s["tk"]),
              # v520 — ROIC e ROE dalla pipeline (o dalla lettura del giro): "assente" = snapshot precedente alla v520
              "rendimento": (pipe.get(s["tk"]) or {}).get("rendimento", "assente"),
              "sector_pipeline": (pipe.get(s["tk"]) or {}).get("sector"),
              # v511 — la stagionalita' del titolo dallo storico mensile della pipeline (cambia una volta al mese)
              "stagionalita": ((pipe.get(s["tk"]) or {}).get("tv") or {}).get("stagionalita"),
              "tenuta": numeri_libro.valuta_tenuta(B.get(s["tk"]), pipe.get(s["tk"]), sem)}
             for s in sorv]
    # v487 — i pavimenti (decisione del CEO del 15/10/2026: entrare sui minimi). Lo storico di cinque anni
    #   SOLO per i sorvegliati, in parallelo: le schede restano sull'anno della fonte, i pavimenti guardano due anni
    # v492 — e anche per i CANDIDATI di settore: la lettura a 5 anni entra in ogni ingresso
    cand = [t for s in settori for t in s["titoli"] if e_candidato(t)]      # anche chi e' in watchlist: stessa lettura
    # v512 — a gennaio il calendario fiscale guarda l'anno appena chiuso: le posizioni servono coi cinque anni
    _fa_anno, _fa_attivo = anno_fiscale()
    _gennaio = _fa_attivo and datetime.now(brief.NEW_YORK).month == 1
    lunghi = list(dict.fromkeys([t["tk"] for t in watch] + [t["tk"] for t in cand] + (sorted(qta) if _gennaio else [])))
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        BL = dict(zip(lunghi, ex.map(barre_lunghe, lunghi)))
    ore_sec = ore_depositi_pipeline(d)
    for t in watch:
        t["pavimenti"] = pavimenti(BL.get(t["tk"]), t.get("px"), t.get("atr"), veicolo=t["veicolo"])
        # v500 — il VWAP dall'ultima trimestrale, accanto ai pavimenti e sulla stessa serie della societa'
        t["vwap"] = vwap_conti(BL.get(t["tk"]), ultime.get(t["tk"]), None if ore_sec is None else ore_sec.get(t["tk"], []),
                               t.get("px"), t.get("atr"), veicolo=t["veicolo"])
    for t in watch + cand:
        t.setdefault("veicolo", veicolo_pipeline(d, t["tk"]))
        t["cinque_anni"] = lettura_5anni(BL.get(t["tk"]), t.get("px"), veicolo=t["veicolo"])
        # v494 — la struttura delle oscillazioni accompagna ogni ingresso, sulla stessa serie della societa'
        t["struttura"] = struttura(BL.get(t["tk"]), t.get("px"), t.get("atr"), veicolo=t["veicolo"])
    # v512 — il calendario fiscale di fine anno (informazione, ottobre-gennaio), sulle stesse barre e sulle sedute concluse
    fa = {"attivo": _fa_attivo, "anno": _fa_anno, "voci": []}
    if _fa_attivo:
        for tk, ruolo in [(x, "posizione") for x in sorted(qta)] + [(t["tk"], "sorvegliato") for t in watch]:
            _serie = BL.get(tk) or B.get(tk)
            x = fine_anno(_serie, _fa_anno) if _serie else None
            # «non lette» e «storia corta» si leggono uguali e sono due cose diverse (v389): la fonte che non risponde
            #   (stockanalysis rifiuta con 429 quando la si interroga troppo) non e' un titolo quotato da poco
            fa["voci"].append({"tk": tk, "ruolo": ruolo,
                               "cap": ((pipe.get(tk) or {}).get("stats") or {}).get("market_cap"),
                               **(x or {"assente": "corta" if _serie else "non lette"})})
    # v474 — il piano per la liquidita': patrimonio e cambio da numeri_libro (un proprietario, v436)
    eur_pmc = {p["tk"]: p["pmc"] for p in pos if p["valuta"] == "EUR"}
    eur_nom = {p["tk"]: p["qta"] for p in pos if p["valuta"] == "EUR"}
    fx, fonte_fx, prezzi_eur = numeri_libro.patrimonio_pipeline(d, eur_pmc, giro["scelta"])
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
            "semaforo": {k: sem.get(k) for k in ("colore", "minimo", "accesi")},
            "libro_sedute": len(rlibro), "watchlist": watch, "asof_target": asof_target,
            # v492 — l'intestazione dei multipli col riferimento dell'S&P 500, una volta per blocco (v407)
            "valutazione_rif": schede_progetto.riferimento_valutazione(d.get("macro")),
            "spy_assente": not rspy, "calendario": {k: cal.get(k) for k in ("giorni_non_letti", "finestra", "errore")},
            "fine_anno": fa,
            "piano": {"voci": piano, "liquidita": cassa, "patrimonio": pat, "cambio": fx, "fonte_cambio": fonte_fx,
                      "qqq_assente": not rqqq, "obbligazioni": {t: prezzi_eur[t] for t in eur_nom}}}


# ═══ v512 — IL CALENDARIO FISCALE DI FINE ANNO: INFORMAZIONE, DA OTTOBRE A GENNAIO ══════════════════════════════
# Il CEO, 25/10/2026: «a fine anno i fondi si muovono anche per compensare le fiscalità … prima verifica se è corretta
# la mia affermazione», e poi, sul se renderlo strutturale: «decidi tu in base al fatto che sia rumore o utile, forse va
# bene il ultimo mese di ottobre essendo quello il momento utile? Scegli tu».
# Misurato sui portafogli di Kenneth French (decili per rendimento dei 12 mesi prima, dati fino ad agosto 2026; LIBRO.md
# §1ter): la vendita per le minusvalenze e il rimbalzo di gennaio sono REALI sui nomi piccoli e a pesi uguali, e RUMORE
# sui grandi dal 1987. La scelta: il blocco si accende da ottobre (molti fondi comuni americani chiudono l'esercizio il 31
# ottobre) a gennaio (il rimbalzo misurato), nomina i nomi in perdita sull'anno con la capitalizzazione accanto, e dice
# su quali la regolarita' e' misurata e su quali no. NON e' una prova della tenuta, ne' un ingresso: e' un calendario.
FINE_ANNO_MESI = (10, 11, 12, 1)
CAP_PICCOLA = 10e9          # convenzione (v240): sotto i 10 miliardi di dollari «piccola o media», dove l'effetto e' misurato
FINE_ANNO_MISURA = (
    "a PESI UGUALI (pesano i piccoli), perdenti meno vincitori dell'anno, 1987-2025: ottobre 1,31 punti al mese sotto gli "
    "altri mesi (t −1,8), dicembre 2,71 sotto (t −2,4), gennaio 7,30 sopra (t +3,8)",
    "PESATI PER CAPITALIZZAZIONE, stesso periodo: nessun mese oltre due errori standard (ottobre t −0,5, dicembre t −0,7, "
    "gennaio t +1,6); fra le GRANDI (il quinto piu' capitalizzato) nemmeno; fra le PICCOLE (il quinto meno "
    "capitalizzato) regge solo gennaio (t +2,1)",
    "il segno cambia da un anno all'altro (gennaio, pesati per capitalizzazione: 2018 −13,0 punti, 2023 +21,6): e' una "
    "frequenza sui portafogli, non una previsione sul singolo nome",
)


def anno_fiscale(adesso=None):
    """(anno descritto, attivo): da ottobre a dicembre l'anno in corso, a gennaio quello appena chiuso; fuori dalla
    finestra (None, False). Il mese di New York (v470)."""
    ny = (adesso or datetime.now(brief.NEW_YORK)).astimezone(brief.NEW_YORK)
    if ny.month not in FINE_ANNO_MESI:
        return None, False
    return (ny.year - 1 if ny.month == 1 else ny.year), True


def fine_anno(barre, anno, adesso=None):
    """Il risultato di un nome nell'anno fiscale descritto, sulle SEDUTE CONCLUSE (v512: un pezzo di giornata non e' una
    giornata): la base e' l'ultima chiusura dell'anno prima, la fine l'ultima chiusura dell'anno (a gennaio) o l'ultima
    conclusa (da ottobre a dicembre); il prezzo medio dell'anno pesato sui volumi (chi ha comprato nell'anno, in media,
    a che prezzo) e la distanza dell'ultima chiusura da lui; a gennaio anche il mese finora. None se la storia non copre
    la fine dell'anno prima: un buco, non uno zero (v205)."""
    b = [x for x in (barre or []) if x.get("c")]
    b = b[:-1] if brief.barra_in_formazione(b, adesso) else b
    prima = [x for x in b if x["t"] < f"{anno}-01-01"]
    dentro = [x for x in b if f"{anno}-01-01" <= x["t"] <= f"{anno}-12-31"]
    if not prima or not dentro:
        return None
    base, fine = prima[-1], dentro[-1]
    pv = [(x["c"], x.get("v") or 0) for x in dentro]
    vol = sum(v for _, v in pv)
    vwap = sum(c * v for c, v in pv) / vol if vol else None
    ult = b[-1]
    out = {"anno": anno, "base_t": base["t"], "base": base["c"], "fine_t": fine["t"], "fine": fine["c"],
           "anno_pct": (fine["c"] / base["c"] - 1) * 100, "vwap": vwap,
           "dist_vwap_pct": (ult["c"] / vwap - 1) * 100 if vwap else None, "ultima_t": ult["t"]}
    if ult["t"] > fine["t"]:
        out["dopo_pct"] = (ult["c"] / fine["c"] - 1) * 100
    return out


def righe_fine_anno(o):
    """Il blocco CALENDARIO FISCALE DI FINE ANNO: fuori dalla finestra una riga che lo dice (un blocco che sparisce si
    legge come «non c'e' niente», v406); dentro, la misura e i nomi in perdita sull'anno, con la loro capitalizzazione."""
    fa = (o or {}).get("fine_anno") or {}
    if not fa.get("attivo"):
        return ["CALENDARIO FISCALE DI FINE ANNO — fuori finestra: si accende da ottobre a gennaio (decisione del "
                "25/10/2026, LIBRO.md §1ter)"]
    L = [f"CALENDARIO FISCALE DI FINE ANNO {fa['anno']} — INFORMAZIONE, non un segnale ne' una prova della tenuta "
         "(decisione del 25/10/2026): molti fondi comuni americani chiudono l'esercizio fiscale il 31 ottobre, i privati "
         "il 31 dicembre, e chi ha minusvalenze le realizza prima della chiusura. Misurato sui portafogli di Kenneth "
         "French (LIBRO.md §1ter):"]
    L += ["  · " + m for m in FINE_ANNO_MISURA]
    voci = fa.get("voci") or []
    misurati = [v for v in voci if v.get("anno_pct") is not None]
    perd = sorted([v for v in misurati if v["anno_pct"] < 0], key=lambda v: v["anno_pct"])
    L.append(f"  in perdita sull'anno {fa['anno']}: {len(perd)} su {len(misurati)} nomi (dall'ultima chiusura dell'anno "
             "prima all'ultima seduta conclusa)")
    for v in perd:
        cap = v.get("cap")
        dim = ("piccola o media: la' la regolarita' e' misurata" if cap and cap < CAP_PICCOLA else
               "grande: qui e' rumore" if cap else "capitalizzazione n.d.")
        s = (f"  {v['tk']} — anno {v['anno']}: {n(v['anno_pct'])}% (base {_data_it(v['base_t'])}) · rispetto al prezzo "
             f"medio dell'anno pesato sui volumi {n(v.get('dist_vwap_pct'))}% · {v['ruolo']} · capitalizzazione "
             + (f"{piano(cap / 1e9)} mld $" if cap else "n.d.") + f" ({dim})")
        if v.get("dopo_pct") is not None:
            s += f" · nell'anno nuovo finora {n(v['dopo_pct'])}%"
        L.append(s)
    corte = [v["tk"] for v in voci if v.get("assente") == "corta"]
    nonlette = [v["tk"] for v in voci if v.get("assente") == "non lette"]
    if corte:
        L.append("  la storia non copre la fine dell'anno prima (quotati da poco o storia tagliata: n.d., non uno zero): "
                 + ", ".join(corte))
    if nonlette:
        L.append("  prezzi NON letti in questo giro (la fonte non ha risposto: non e' 'nessuna perdita'): " + ", ".join(nonlette))
    return L


def calendario_sicuro(tks, giorni=GIORNI_CALENDARIO):
    """Il calendario Nasdaq, con tre esiti distinti (v389): data trovata, nessuna data nella
    finestra, calendario NON letto. Un'eccezione non deve portarsi via la watchlist intera."""
    try:
        return brief.calendario_trimestrali(tks, giorni=giorni)
    except Exception as e:
        return {"attesi": [], "giorni_non_letti": [], "finestra": giorni, "errore": str(e)[:80]}


def n(x, d=1, s=""):
    """Col segno, sul valore GIA' arrotondato (v496): «-0,0 ATR» e «-0,0%» si leggevano come un movimento che non c'e'
    (v510 — undici volte in un'analisi sola, sulle distanze dagli ordini e dalle medie). Lo zero non porta segno."""
    if x is None:
        return "n.d."
    v = round(x, d) + 0.0
    return (f"{v:+.{d}f}" if v != 0 else f"{0:.{d}f}").replace(".", ",") + s


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
    vs = testo_volume_seduta(t.get("vol_seduta_corso"))
    return (f"volumi (0 = minimo dell'anno, 100 = massimo, 50 = norma): seduta conclusa del "
            f"{t.get('vol_seduta') or 'n.d.'} {p(ps)} · media delle ultime 20 sedute {p(p20)}"
            + (f" · su {t['vol_campione']} sedute" if t.get("vol_campione") else "") + (f" · {vs}" if vs else ""))


def riga_trimestrale(t, cal=None):
    """La prima trimestrale dal calendario Nasdaq (la fonte delle SCADENZE di numeri_libro). La
    stima yfinance della pipeline si scrive solo se diversa o se Nasdaq tace, e si chiama STIMA.
    Tre esiti distinti (v389): data trovata · nessuna data nella finestra · calendario NON letto."""
    cal = cal or {}
    tr, yf = t.get("trimestrale"), t.get("trimestrale_yf")
    if tr:
        # v489 — la fonte e' scritta sulla voce: il calendario Nasdaq, o la data dichiarata dall'emittente
        #   (LIBRO.md §1octies) per chi il calendario non porta
        s = f"trimestrale {tr['data']} ({tr['giorni']} g, {tr.get('fonte') or 'calendario Nasdaq'})"
        if tr.get("nasdaq"):
            s += f" — il calendario Nasdaq dice {tr['nasdaq']}"
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
    if "struttura" in t:          # v494 — la struttura delle oscillazioni: il calcolo vive in raccogli
        L.extend(f"      {r}" for r in righe_struttura(t["struttura"]))
    if "oscillatori" in t:        # v511 — ipervenduto e ipercomprato, supporto e accumulo: informazione
        L.extend(f"      {r}" for r in righe_ipervenduto_accumulo(t["oscillatori"], t.get("pavimenti"), t.get("struttura")))
    if "stagionalita" in t:       # v511 — il mese in corso e il successivo, col campione
        L.append(f"      {riga_stagionalita(t['stagionalita'])}")
    if "pavimenti" in t:          # v487 — solo i sorvegliati: il calcolo vive in raccogli
        L.extend(f"      {r}" for r in righe_pavimenti(t["pavimenti"]))
    if "vwap" in t:               # v500 — il VWAP dall'ultima trimestrale, accanto ai pavimenti
        L.append(f"      {riga_vwap(t['vwap'])}")
    if "cinque_anni" in t:        # v492 — la lettura a 5 anni: il calcolo vive in raccogli
        L.extend(f"      {r}" for r in righe_5anni(t["cinque_anni"], t.get("veicolo")))
    L.append(f"      {riga_volumi(t)} · {riga_target_beta(t)}")
    rev = (schede_progetto.riga_revisioni(t.get("analisti"), con_target=False) if t.get("in_pipeline")
           else "revisioni: titolo non seguito dalla pipeline")
    L.append(f"      {riga_trimestrale(t, cal)} · {rev}")
    L.append(f"      {riga_valutazione(t)}")
    L.append(f"      {riga_rendimento(t)}")
    if t.get("tenuta"):
        L.append(f"      {riga_tenuta(t['tenuta'])}")
    if t.get("nota"):
        L.append(f"      nota del CEO in LIBRO.md (i suoi livelli sono del giorno in cui e' scritta): «{t['nota']}»")
    return L


def _fascia(z):
    return prezzo(z["alto"]) if z["fondo"] == z["alto"] else f"{prezzo(z['fondo'])}–{prezzo(z['alto'])}"


# ---------------------------------------------------------------- v500: VWAP ancorato all'ultima trimestrale
# Decisione del CEO del 18/10/2026 («2ok»): accanto ai pavimenti di ogni titolo il VWAP calcolato dall'ultima
# trimestrale, cioe' il prezzo medio pagato da chi ha comprato dopo i conti. Convenzioni dichiarate (v240):
#   ANCORA  = la prima seduta dopo il comunicato. La DATA la dichiara Nasdaq (brief.ultime_trimestrali: le
#             trimestrali riportate, non le stime). L'ORA viene dal deposito su SEC EDGAR accettato fra le 16:00 di
#             New York del giorno prima e la fine del giorno dopo — l'8-K con item 2.02, o il primo 6-K per un
#             emittente estero —: prima delle 09:30 muove la seduta stessa, dalle 16:00 la successiva, in mezzo la
#             seduta stessa (a seduta aperta: la sua barra mescola il prima e il dopo). Senza l'ora, la seduta piu'
#             scambiata fra il giorno del comunicato e il successivo, DICHIARATO (la reazione ai conti e' quasi
#             sempre la seduta piu' scambiata del trimestre).
#   VWAP    = dalle barre GIORNALIERE: prezzo tipico (massimo + minimo + chiusura) / 3 pesato sui volumi, dall'ancora
#             all'ultima seduta CONCLUSA, sulla serie della societa' (serie_della_societa: un'operazione societaria
#             nel mezzo mescolerebbe due societa'). E' un'approssimazione del VWAP dei grafici, che usa barre di
#             pochi minuti: i due numeri possono differire di poco.
#   LETTURA = convenzione: sopra il VWAP chi ha comprato dopo i conti e' in media in guadagno, sotto in perdita. E'
#             un livello accanto ai pavimenti — non una prova della tenuta, non un ordine.
VWAP_APERTURA = (9, 30)
VWAP_CHIUSURA = (16, 0)
INTESTAZIONE_VWAP = ("il VWAP dai conti (decisione del CEO del 18/10/2026) = il prezzo medio pagato da chi ha comprato "
                     "dopo l'ultima trimestrale: prezzo tipico (massimo+minimo+chiusura)/3 delle barre GIORNALIERE "
                     "pesato sui volumi, dalla prima seduta dopo il comunicato all'ultima conclusa — un'approssimazione "
                     "di quello dei grafici, che usa barre di pochi minuti · data del comunicato da Nasdaq, ora dal "
                     "deposito su SEC EDGAR, che e' il PIU' TARDI a cui i conti erano pubblici, non l'ora del comunicato "
                     "(prima delle 09:30 di New York muove la seduta stessa, dalle 16:00 la successiva); senza l'ora, "
                     "la seduta piu' scambiata fra il giorno dei conti e il successivo, "
                     "dichiarato · sopra il VWAP chi ha comprato dopo i conti e' in media in guadagno, sotto in perdita "
                     "(lettura convenzionale): un livello, non una prova della tenuta")


def ancora_conti(trim, depositi, barre, adesso=None):
    """La seduta d'ancora del VWAP. trim: brief.ultime_trimestrali()[tk]. depositi: le ore della pipeline per il nome
    (macro.sec_calendario.ore_depositi.per_titolo[tk]); None = la pipeline non le pubblica ancora, che e' diverso da
    "nessun deposito" (v406). barre: giornaliere, in ordine di data."""
    if not trim or trim.get("stato") != "ok" or not trim.get("data"):
        return {"errore": f"data dell'ultima trimestrale NON letta (Nasdaq: {(trim or {}).get('stato') or 'non richiesta'}) "
                          "— non vuol dire 'nessuna trimestrale'"}
    b = [x for x in (barre or []) if x.get("t")]
    if seduta_in_corso(b, adesso):
        b = b[:-1]                     # la seduta in corso non decide niente: il suo volume e' a meta' (v471)
    sedute = [str(x["t"])[:10] for x in b]
    D = str(trim["data"])[:10]
    i0 = next((i for i, s in enumerate(sedute) if s >= D), None)
    g = datetime.fromisoformat(D).date()
    inizio = datetime.combine(g - timedelta(days=1), dtime(16, 0), tzinfo=brief.NEW_YORK)
    fine = datetime.combine(g + timedelta(days=1), dtime(23, 59), tzinfo=brief.NEW_YORK)
    cand = []
    for x in depositi or []:
        # ⚠⚠ v501 — l'ora di EDGAR e' UTC: la 'Z' della fonte e' un UTC VERO. Misurato il 18/10/2026 sull'8-K di Oracle
        #   del 10/09: il JSON scrive 20:16:50Z, l'indice del deposito "Accepted 2026-09-10 16:16:50" (ora di New York).
        #   La v500 la leggeva come ora di New York: un deposito alle 09:04 (le consegne di Tesla) diventava "a seduta
        #   aperta", e uno fra mezzogiorno e le 16:00 finiva sulla seduta SUCCESSIVA. Si converte col fuso (v470).
        try:
            t = (datetime.fromisoformat(str(x.get("accettato") or "")[:19]).replace(tzinfo=timezone.utc)
                 .astimezone(brief.NEW_YORK))
        except ValueError:
            continue
        if inizio <= t <= fine:
            cand.append((0 if str(x.get("forma", "")).startswith("8-K") else 1, t, x))
    if cand:
        _, t, x = min(cand, key=lambda c: (c[0], c[1]))
        giorno, hm = t.date().isoformat(), (t.hour, t.minute)
        if hm >= VWAP_CHIUSURA:
            seduta, quando = next((s for s in sedute if s > giorno), None), "dopo la chiusura"
        else:
            seduta = next((s for s in sedute if s >= giorno), None)
            # ⚠ v510 — UN DEPOSITO A SEDUTA APERTA NON DICE CHE IL COMUNICATO SIA USCITO A SEDUTA APERTA: l'ora di
            #   accettazione e' il PIU' TARDI a cui i conti erano pubblici. SK hynix pubblica a Seul e deposita il 6-K
            #   ore dopo (10:01 di New York il 29/07); molti emittenti americani escono prima dell'apertura e depositano
            #   l'8-K alle 10-11. La riga diceva «a seduta aperta: la barra mescola il prima e il dopo», cioe' affermava
            #   un'ora che il dato non porta. La seduta d'ancora non cambia: e' la prima dopo i conti in entrambi i casi
            quando = ("prima dell'apertura" if hm < VWAP_APERTURA or seduta != giorno else
                      "a seduta aperta: i conti erano pubblici al piu' tardi a quell'ora — spesso escono prima "
                      "dell'apertura e il deposito segue — e questa e' comunque la prima seduta dopo i conti")
        if seduta is None:
            return {"errore": f"la prima seduta dopo i conti del {D} non e' ancora conclusa", "comunicato": D}
        return {"seduta": seduta, "comunicato": D, "ora": f"{t:%H:%M}", "giorno_deposito": giorno,
                "quando": quando, "forma": x.get("forma"), "da_volumi": False}
    if i0 is None:
        return {"errore": f"la prima seduta dopo i conti del {D} non e' ancora conclusa", "comunicato": D}
    perche = ("la pipeline non pubblica ancora l'ora dei depositi SEC" if depositi is None else
              "nessun deposito SEC con l'ora fra il giorno prima e il giorno dopo il comunicato")
    if sedute[i0] > D or i0 + 1 >= len(sedute):
        return {"seduta": sedute[i0], "comunicato": D, "ora": None, "da_volumi": True, "perche": perche,
                "quando": "prima seduta dalla data del comunicato"}
    v0, v1 = b[i0].get("v") or 0, b[i0 + 1].get("v") or 0
    seduta = sedute[i0 + 1] if v1 > v0 else sedute[i0]
    return {"seduta": seduta, "comunicato": D, "ora": None, "da_volumi": True, "perche": perche,
            "quando": "la seduta piu' scambiata fra il giorno del comunicato e il successivo"}


def vwap_conti(barre, trim, depositi, px, atr, adesso=None, veicolo=None):
    """{ancora..., vwap, sedute, fino_a, dist_pct, dist_atr, trimestrale} oppure {errore, ...}: il VWAP dall'ultima
    trimestrale (convenzioni in testa al blocco). Sulla serie della societa' di oggi, come pavimenti e struttura."""
    serie, taglio, motivo = serie_della_societa(barre or [], veicolo)
    # l'ancora si cerca sulla serie INTERA: su quella gia' tagliata, un'operazione societaria caduta DOPO i conti
    #   spostava l'ancora in silenzio al giorno del taglio, e il controllo qui sotto non poteva scattare mai (trovato
    #   scrivendo il gate v500: un ramo che non puo' essere raggiunto non e' una protezione, v234)
    a = ancora_conti(trim, depositi, barre or [], adesso)
    if a.get("errore"):
        return {**a, "trimestrale": trim}
    b = list(serie)
    if seduta_in_corso(b, adesso):
        b = b[:-1]
    if taglio and str(taglio)[:10] > a["seduta"]:
        return {**a, "trimestrale": trim,
                "errore": f"un'operazione societaria del {str(taglio)[:10]} cade dopo i conti: il VWAP mescolerebbe due societa'"}
    sel = [x for x in b if str(x.get("t"))[:10] >= a["seduta"]]
    if not sel:
        return {**a, "trimestrale": trim, "errore": "la prima seduta dopo i conti non e' ancora conclusa"}
    buchi = [str(x.get("t"))[:10] for x in sel if any(x.get(k) is None for k in ("h", "l", "c", "v"))]
    if buchi:
        return {**a, "trimestrale": trim,
                "errore": f"{len(buchi)} barre senza massimo, minimo, chiusura o volume dal {buchi[0]}: un buco non e' uno zero (v205)"}
    vol = sum(x["v"] for x in sel)
    if vol <= 0:
        return {**a, "trimestrale": trim, "errore": "volumi nulli dalla seduta d'ancora"}
    vw = sum((x["h"] + x["l"] + x["c"]) / 3 * x["v"] for x in sel) / vol
    return {**a, "trimestrale": trim, "vwap": vw, "sedute": len(sel), "fino_a": str(sel[-1]["t"])[:10],
            "dist_pct": (px / vw - 1) * 100 if px else None,
            "dist_atr": (px - vw) / atr if (px and atr) else None}


def riga_vwap(v):
    """Il VWAP dai conti in UNA riga, la stessa per sorvegliati, posizioni e ordini (v161)."""
    if not v:
        return "VWAP dai conti: non calcolato"
    tr = v.get("trimestrale") or {}
    conti = f"conti del {_data_it(v.get('comunicato') or tr.get('data'))}"
    if tr.get("trimestre"):
        conti += f" ({tr['trimestre']}"
        if tr.get("eps") is not None and tr.get("consenso") is not None:
            # un utile per azione non ha un verso: niente "+" davanti, il "-" resta su una perdita (v430)
            conti += (f": EPS {piano(tr['eps'], 2)} contro {piano(tr['consenso'], 2)} attesi"
                      + (f", {n(tr['sorpresa_pct'], 1, '%')}" if tr.get("sorpresa_pct") is not None else ""))
        conti += ")"
    if v.get("errore"):
        return f"VWAP dai conti: non calcolabile — {v['errore']}" + (f" · {conti}" if v.get("comunicato") or tr.get("data") else "")
    if v.get("da_volumi"):
        ancora = f"dalla seduta del {_data_it(v['seduta'])} — {v['quando']}, perche' {v['perche']}"
    else:
        ancora = (f"deposito accettato alle {v['ora']} di New York del {_data_it(v['giorno_deposito'])} ({v.get('forma')} su "
                  f"SEC EDGAR), {v['quando']} → dalla seduta del {_data_it(v['seduta'])}")
    s = f"VWAP dai conti {prezzo(v['vwap'])} — {conti} · {ancora}, {v['sedute']} {'seduta' if v['sedute'] == 1 else 'sedute'}"
    if v.get("dist_pct") is not None:
        s += (f" · il prezzo ne dista {n(v['dist_pct'], 1, '%')}"
              + (f" ({n(v['dist_atr'], 1)} ATR)" if v.get("dist_atr") is not None else "")
              + (": chi ha comprato dopo i conti e' in media in guadagno" if v["dist_pct"] > 0 else
                 ": chi ha comprato dopo i conti e' in media in perdita" if v["dist_pct"] < 0 else ""))
    return s


def _data_it(iso):
    s = str(iso or "")[:10]
    return f"{s[8:10]}/{s[5:7]}/{s[:4]}" if len(s) == 10 else (s or "n.d.")


def ore_depositi_pipeline(d):
    """{tk: [depositi con l'ora]} dalla pipeline, o None se la pipeline non le pubblica ancora (v406)."""
    od = (((d or {}).get("macro") or {}).get("sec_calendario") or {}).get("ore_depositi")
    return None if od is None else (od.get("per_titolo") or {})


def ultime_sicure(tks):
    """brief.ultime_trimestrali con un'eccezione che non si porta via la watchlist (v389)."""
    try:
        return brief.ultime_trimestrali(tks)
    except Exception as e:
        return {t: {"stato": f"NON letto ({str(e)[:40]})"} for t in tks}


def righe_pavimenti(pv):
    """v487 — i pavimenti di un sorvegliato, con la convenzione in testa allo script e in LIBRO.md §1bis: la
    stessa per tutti i titoli. Tre esiti distinti (v389): pavimenti trovati · nessun pavimento sotto il prezzo
    nella finestra (si dice dove sta il minimo della serie) · storico NON letto."""
    if pv is None:
        return ["pavimenti: storico NON letto (o prezzo e ATR mancanti) — non vuol dire 'nessun pavimento'"]
    taglio = ((f" · la serie parte dal {pv['taglio']}: prima il titolo era il VEICOLO DI QUOTAZIONE (SPAC) da cui e' "
               "nato — registro SEC, 8-K con item 5.06 — e quei prezzi sono di un'altra societa'")
              if pv.get("taglio_motivo") == "veicolo" else
              (f" · la serie parte dal {pv['taglio']}: un'operazione societaria (salto oltre il {PAV_SALTO * 100:.0f}% "
               "del rapporto fra prezzo rettificato e grezzo) rende i prezzi di prima non confrontabili") if pv["taglio"] else "")
    L = [f"pavimenti (LIBRO.md §1bis, decisione del CEO del 15/10/2026: entrare sui minimi, non sulla risalita) — "
         f"minimi di oscillazione delle {pv['sedute']} sedute dal {pv['da']}{taglio}"]
    if not pv["minimi"]:
        ms = pv.get("minimo_serie")
        L.append("   nessun pavimento sotto il prezzo nella finestra"
                 + (f": il minimo della serie e' {prezzo(ms['minimo'])} del {ms['data']}" if ms else "")
                 + " — un ingresso qui non ha un pavimento misurato sotto, e lo stop non ha dove appoggiarsi")
    for k, z in enumerate(pv["minimi"], 1):
        tocchi = sorted(z["tocchi"], key=lambda m: m["data"])
        vol = max((m["volume_pct"] for m in tocchi if m.get("volume_pct") is not None), default=None)
        stop = ("stop n.d." if z["stop"] is None else
                f"stop {prezzo(z['stop'])}, chiusura sotto il fondo meno {piano(PAV_STOP_ATR, 0)} ATR "
                f"({n(z['perdita_pct'], 1, '%')}: {_euro(-z['perdita_eur'])} ogni {_euro(UNITA_EUR)})")
        L.append(f"   {k}) {_fascia(z)} ({n(z['pct'], 1, '%')}, {n(z['atr'], 1)} ATR) · "
                 f"{len(tocchi)} {'tocco' if len(tocchi) == 1 else 'tocchi'}, l'ultimo il {tocchi[-1]['data']} · "
                 f"rimbalzo nelle {PAV_RIMBALZO} sedute dopo: "
                 + ", ".join(n(m["rimbalzo_pct"], 0, "%") for m in tocchi)
                 + (" · il pavimento con PIU' TOCCHI subito sotto i piu' vicini" if z.get("piu_toccato") else "")
                 + (f" · volumi fino a {vol:.0f}/100" if vol is not None else "")
                 + f" → ordine con limite {prezzo(z['ordine'])} · {stop}")
    if pv["vuoti"]:
        L.append("   vuoti di prezzo mai richiusi (convenzione di lettura dei grafici, NON una misura di compratori): "
                 + " · ".join(f"{prezzo(v['fondo'])}–{prezzo(v['alto'])} dal {v['data']} ({n(v['pct'], 1, '%')})"
                              for v in pv["vuoti"]))
    return L


def righe_5anni(l, veicolo=None):
    """v492 — la lettura a 5 anni in due righe, tre con l'avviso; le convenzioni sono in testa allo script e nel
    blocco. Tre esiti distinti (v389): letta · storico NON letto · storia della quotazione NON verificata, che si
    dichiara invece di passare per 'nessun veicolo' (v406)."""
    if l is None:
        return ["lettura a 5 anni: storico NON letto (o prezzo mancante) — non vuol dire 'nessun livello'"]
    if l["motivo"] == "veicolo":
        v = veicolo or {}
        orig = (f"la serie parte dal {l['da']}: fino al {v.get('fine') or 'n.d.'} il titolo era il VEICOLO DI QUOTAZIONE "
                f"(SPAC) — registro SEC, 8-K del {v.get('deposito') or 'n.d.'} con item 5.06 — e quei prezzi sono di "
                "un'altra societa'")
    elif l["motivo"] == "societaria":
        orig = (f"la serie parte dal {l['da']}: un'operazione societaria (salto oltre il {PAV_SALTO * 100:.0f}% del "
                "rapporto fra prezzo rettificato e grezzo) rende i prezzi di prima non confrontabili")
    elif l["breve"]:
        orig = f"quotato dal {l['da']}: la storia e' piu' corta di {ANNI_LETTURA} anni"
    else:
        orig = f"dal {l['da']}"

    def media(k):
        x = l["medie"].get(k)
        if x is None:
            return f"{k} n.d. (servono {k} settimane, ce ne sono {l['settimane']})"
        p = x["pend_pct"]
        verso = ("pendenza n.d." if p is None else
                 f"{'in salita' if p > 0 else 'in discesa' if p < 0 else 'ferma'} {n(p, 1, '%')} in "
                 f"{SETTIMANE_PENDENZA} settimane")
        return f"{k} {prezzo(x['valore'])} (il prezzo ne dista {n(x['dist_pct'], 1, '%')}, {verso})"
    L = [f"lettura a {ANNI_LETTURA} anni — {orig} · {l['settimane']} settimane concluse · medie settimanali: "
         + " · ".join(media(k) for k in SETTIMANE_MEDIE)]
    mx, mn, pos, r = l["massimo"], l["minimo"], l["posizione"], l["rialzo"]
    if pos is None:
        ptxt = "posizione nell'intervallo n.d."
    elif pos < 0:
        ptxt = "prezzo SOTTO il minimo delle sedute concluse"
    elif pos > 100:
        ptxt = "prezzo SOPRA il massimo delle sedute concluse"
    else:
        ptxt = f"posizione nell'intervallo {piano(pos, 0)}/100 (0 = il minimo, 100 = il massimo)"
    if r is None:
        rtxt = "rialzo restituito n.d. (il massimo sta all'inizio della serie: nessun rialzo da misurare)"
    elif r.get("censurato"):
        rtxt = (f"rialzo restituito n.d. (la finestra si apre gia' al livello da cui sale verso il massimo, "
                f"{prezzo(r['da'])} il {r['data']}: il rialzo e' cominciato prima dei {ANNI_LETTURA} anni e la sua base "
                "vera non si vede)")
    elif r["restituito_pct"] <= 0:
        rtxt = f"del rialzo da {prezzo(r['da'])} ({r['data']}) al massimo non ha restituito nulla"
    elif r["restituito_pct"] > 100:
        # v505 — oltre il 100% una percentuale non dice piu' quanto: DIS il 19/10 usciva «619%» di un rialzo di dieci
        #   giorni. Aritmeticamente esatto, comunicativamente falso (classe v389): si dice che e' restituito per intero
        #   e di quanto il prezzo sta sotto il punto di partenza, che e' la grandezza che il numero nascondeva.
        d = r.get("dist_base_pct")
        rtxt = (f"del rialzo da {prezzo(r['da'])} ({r['data']}) al massimo l'ha restituito tutto, e oltre il punto di "
                "partenza" + (f" (il prezzo ne dista {n(d, 1, '%')})" if d is not None else ""))
    else:
        # v510 — «ne ha restituito il 87%», «il 11%», «il 0%»: l'articolo si sceglie sul numero (comuni.art), e un
        #   valore che si arrotonda a zero si dice in parole invece che come «lo 0%»
        rtxt = (f"del rialzo da {prezzo(r['da'])} ({r['data']}) al massimo "
                + (f"ne ha restituito {art('il', piano(r['restituito_pct'], 0) + '%')}"
                   if round(r["restituito_pct"]) > 0 else "ne ha restituito meno dell'1%"))
    L.append(f"   massimo {prezzo(mx['prezzo'])} del {mx['data']} (il prezzo ne dista {n(l['dmax_pct'], 1, '%')}) · "
             f"minimo {prezzo(mn['prezzo'])} del {mn['data']} (il prezzo ne dista {n(l['dmin_pct'], 1, '%')}) · {ptxt} · {rtxt}")
    v = veicolo or {}
    if veicolo is not None and not v.get("verificato"):
        L.append(f"   ⚠ storia della quotazione NON verificata — {v.get('perche') or 'motivo n.d.'}: se il titolo e' nato "
                 "da un veicolo di quotazione (SPAC), medie e massimi mescolano i prezzi di un'altra societa'")
    return L


def _punti(P):
    return " → ".join(f"{prezzo(x['prezzo'])} il {x['data']}" for x in P)


def _sequenza(P, verso, fila, nome):
    if not P:
        return f"{nome}: nessun punto di oscillazione nella finestra"
    if verso is None:
        return f"{nome}: un punto solo ({_punti(P)}), nessun verso"
    di_fila = "" if verso == "alla pari" else f", gli ultimi {fila} di fila"
    return f"{nome} {verso.upper()}{di_fila} ({_punti(P)})"


TESTO_DOPPIO = {   # v494 — l'esito di oggi di un doppio minimo o massimo, letto dalla chiusura conclusa
    ("minimo", "confermato"): "la chiusura sta SOPRA il collo: confermato",
    ("minimo", "rotto"): "la chiusura sta SOTTO i due minimi: il doppio minimo NON ha tenuto",
    ("minimo", "da confermare"): "si conferma con una chiusura sopra il collo",
    ("massimo", "confermato"): "la chiusura sta SOTTO il collo: confermato",
    ("massimo", "superato"): "la chiusura sta SOPRA i due massimi: superato",
    ("massimo", "da confermare"): "si conferma con una chiusura sotto il collo",
}


def righe_struttura(st):
    """v494 — la struttura delle oscillazioni di un nome: la sequenza, i due livelli che la cambiano o la rottura gia'
    in corso, e la lettura dei grafici. Le convenzioni sono dichiarate UNA volta nell'intestazione del blocco che la
    porta (v407) e in LIBRO.md §1bis. Tre esiti distinti (v389): letta · storico NON letto · meno di due punti per
    verso, che e' NON MISURABILE e lo dice."""
    if st is None:
        return ["struttura delle oscillazioni: storico NON letto (o prezzo e ATR mancanti) — non vuol dire 'nessuna struttura'"]
    origine = (f"dal {st['da']}: la serie parte da un taglio — "
               + ("la fine del veicolo di quotazione (SPAC)" if st.get("motivo") == "veicolo" else "un'operazione societaria")
               if st.get("taglio") else f"ultimo anno, dal {st['da']}")
    rott = st.get("rottura")
    testa = (f"struttura delle oscillazioni ({origine}, {st['sedute']} sedute concluse) — {st['stato']}"
             + (" sui punti confermati, ⚠ ROTTA AL " + ("RIBASSO" if rott == "ribasso" else "RIALZO") if rott else "")
             + ": " + _sequenza(st["massimi"], st["verso_massimi"], st["fila_massimi"], "massimi") + " · "
             + _sequenza(st["minimi"], st["verso_minimi"], st["fila_minimi"], "minimi"))
    L = [testa]
    if rott:
        rif, e = (st["giu"], st["estremo"]) if rott == "ribasso" else (st["su"], st["estremo"])
        quale, verso_s = ("minimo", "sotto") if rott == "ribasso" else ("massimo", "sopra")
        s = (f"   ⚠ la chiusura del {st['seduta']} ({prezzo(st['chiusura'])}) sta {verso_s} l'ultimo {quale} di oscillazione "
             f"({prezzo(rif['prezzo'])} del {rif['data']}): la sequenza si e' rotta prima che un punto nuovo la confermi")
        if e:
            mancano = max(PAV_LATO - e["sedute_dopo"], 1)
            s += (f" — il {quale} toccato da allora, {prezzo(e['prezzo'])} il {e['data']}, diventa un punto di oscillazione "
                  f"se nelle prossime {mancano} {'seduta' if mancano == 1 else 'sedute'} concluse il prezzo non va "
                  + ("sotto" if rott == "ribasso" else "sopra"))
        L.append(s)
    liv = []
    if st.get("su") and rott != "rialzo":
        liv.append(f"una chiusura sopra {prezzo(st['su']['prezzo'])} (l'ultimo massimo, {n(st['su']['pct'], 1, '%')}, "
                   f"{n(st['su']['atr'], 1)} ATR) fa un massimo crescente")
    if st.get("giu") and rott != "ribasso":
        liv.append(f"una chiusura sotto {prezzo(st['giu']['prezzo'])} (l'ultimo minimo, {n(st['giu']['pct'], 1, '%')}, "
                   f"{n(st['giu']['atr'], 1)} ATR) fa un minimo decrescente")
    if liv:
        L.append("   " + " · ".join(liv))
    let = []
    for d in st.get("doppi") or []:
        fascia = prezzo(d["alto"]) if d["basso"] == d["alto"] else f"{prezzo(d['basso'])}–{prezzo(d['alto'])}"
        let.append(f"doppio {d['tipo']} {fascia} ({d['date'][0]} e {d['date'][1]}), collo {prezzo(d['collo'])} "
                   f"({n(d['pct'], 1, '%')}): {TESTO_DOPPIO[(d['tipo'], d['esito'])]}"
                   + (f" dal {d['dal']}" if d.get("dal") else ""))
    for d in st.get("divergenze") or []:
        a, b = d["prezzi"]
        ra, rb = d["rsi"]
        let.append(f"divergenza {d['tipo'].upper()} dell'RSI" + (" IN FORMAZIONE (il secondo punto non e' ancora confermato)"
                                                                 if d["in_formazione"] else "")
                   + (f": minimo piu' basso ({prezzo(a)} → {prezzo(b)}) con RSI piu' alto ({ra:.0f} → {rb:.0f})"
                      if d["tipo"] == "rialzista" else
                      f": massimo piu' alto ({prezzo(a)} → {prezzo(b)}) con RSI piu' basso ({ra:.0f} → {rb:.0f})"))
    v = st.get("volumi")
    let.append("sedute in salita e in discesa n.d. (volumi mancanti)" if v is None else
               f"ultime {STR_VOLUMI} sedute concluse: {v['su']} in salita e {v['giu']} in discesa, volume medio in salita "
               + ("n.d." if v["rapporto"] is None else f"{piano(v['rapporto'], 2)} volte") + " quello in discesa")
    L.append("   lettura dei grafici (convenzioni di lettura, non misure): " + " · ".join(let))
    return L


INTESTAZIONE_STRUTTURA = (   # v494 — dichiarata una volta per blocco (v407), e in LIBRO.md §1bis
    f"struttura delle oscillazioni (richiesta del CEO del 17/10/2026) = i punti di oscillazione dell'ultimo anno con le "
    f"regole dei pavimenti — il piu' basso o il piu' alto di {PAV_LATO} sedute prima e {PAV_LATO} dopo, alla pari entro "
    "mezzo ATR — e il verso degli ultimi due: RIALZISTA = massimi e minimi crescenti · RIBASSISTA = massimi e minimi "
    "decrescenti · IN COMPRESSIONE = massimi decrescenti e minimi crescenti · IN ESPANSIONE = il contrario · LATERALE = "
    "uno dei due alla pari · ROTTA = la chiusura conclusa oltre l'ultimo punto, prima che un punto nuovo lo confermi · "
    "doppi, divergenze dell'RSI e sedute in salita o in discesa = convenzioni di lettura dei grafici, non misure · e' la "
    "famiglia del PREZZO, la stessa della tendenza della tenuta: un'informazione in piu', non una prova in piu' (B3)")


def segnali_ingresso(t):
    """v494 — perche' un nome ha un INGRESSO POSSIBILE adesso: un pavimento entro 1 ATR — l'ingresso sui minimi deciso
    dal CEO il 15/10 —, o le convenzioni d'ingresso del sistema (candidato, prezzo dentro la zona). Lista vuota =
    nessuno. Servono a scegliere su quali nomi le ULTIMISSIME notizie si leggono (CEO, 17/10/2026).
    ⚠ Una chiusura sopra l'ultimo massimo di oscillazione o sopra il collo di un doppio minimo NON e' un ingresso
    possibile: e' la risalita, che il CEO non compra («Non voglio entrare quando risalgono»). Resta nella riga della
    struttura come segnale che la discesa e' finita, come i livelli della zona (v487)."""
    if t.get("errore"):
        return []
    s = []
    z = (((t.get("pavimenti") or {}).get("minimi")) or [None])[0]
    if z and z.get("atr") is not None and z["atr"] >= -VICINO_ATR:
        s.append(f"pavimento entro {piano(VICINO_ATR, 0)} ATR (ordine {prezzo(z['ordine'])})")
    if str(t.get("stato", "")).startswith("CANDIDATO"):
        s.append("candidato")
    if piano_ingresso(t)["posizione"] == "dentro":
        s.append("prezzo dentro la zona d'ingresso")
    return s


def leggi_feed(tks, leggi=None):
    """{tk: (stato, voci)} dal feed Nasdaq del simbolo, in parallelo e una volta per nome. leggi: la funzione di
    lettura (brief.news_titolo), sostituibile nei gate. Un 429 non si ritenta (v398): e' una quota, non un intoppo."""
    leggi = leggi or brief.news_titolo
    tks = list(dict.fromkeys(tks))
    if not tks:
        return {}
    with ThreadPoolExecutor(brief.PARALLELI) as ex:
        return {tk: (st, v) for tk, st, v in ex.map(leggi, tks)}


def notizie_recenti(tks, ore=NOTIZIE_ORE, adesso=None, leggi=None):
    """v494 — le ULTIMISSIME notizie (richiesta del CEO del 17/10/2026: «fermo restando che anche le ultimissime news
    sono importanti») dal feed Nasdaq del simbolo: l'attribuzione viene dalla FONTE (v399). {tk: {"stato", "voci"}},
    le voci delle ultime `ore` dalla piu' recente. Tre esiti distinti (v389): con voci · feed letto e nessuna voce
    nella finestra · feed NON letto. Una voce senza data non entra: non si colloca nella finestra."""
    from datetime import timedelta, timezone
    adesso = (adesso or datetime.now(timezone.utc)).astimezone(timezone.utc)
    da = adesso - timedelta(hours=ore)
    letti = leggi_feed(tks, leggi)
    out = {}
    for tk in dict.fromkeys(tks):
        st, voci = letti.get(tk) or ("non letto", [])
        datate = [v for v in voci or [] if v.get("quando")]
        # il feed restituisce le sue ULTIME voci (15, misurate il 17/10): se cadono TUTTE nella finestra, non si sa
        #   cosa ci sia prima della piu' vecchia — la finestra e' coperta solo fin li', e si dichiara
        copre = min(v["quando"] for v in datate) if datate and min(v["quando"] for v in datate) >= da else None
        out[tk] = {"stato": st, "lette": len(voci or []), "copre_da": copre,
                   "voci": sorted((v for v in datate if v["quando"] >= da), key=lambda v: v["quando"], reverse=True)}
        # v499 — un feed VUOTO o FERMO non porta le notizie del nome, e va detto: il 17/10 quello di SpaceX aveva tre voci,
        #   l'ultima del 01/07, mentre la Roadster di Tesla con i propulsori di SpaceX era nei feed di mezzo mercato.
        #   «Nessuna voce nelle ultime 72 ore» si sarebbe letto come «niente da dire su SpaceX» (v389, v406)
        ultima = max((v["quando"] for v in datate), default=None)
        if st == "ok" and not voci:
            out[tk]["vuoto"] = True
        elif st == "ok" and ultima is not None and ultima < adesso - timedelta(days=FEED_FERMO_GIORNI):
            out[tk]["fermo_dal"] = ultima
    return out


NOTIZIE_MOSTRA = 6
NOTIZIE_MOSTRA_SENZA = 3     # v499 — i nomi SENZA un segnale: le voci piu' recenti, perche' un evento non aspetta un segnale
FEED_FERMO_GIORNI = 14       # v499 — un feed la cui ultima voce e' piu' vecchia di cosi' e' FERMO (convenzione, v240)
# v500 — la voce nel feed di ALMENO tanti nomi del blocco e' cronaca di mercato (convenzione, v240). Con due il
#   conteggio non discrimina: il 18/10 «CoreWeave Is Projected to Have a 6.3x Gross Leverage Ratio» (feed di CRWV e
#   NVDA) e «1 Red Flag That AMD Investors Should Be Aware Of» (AMD e NVDA) finivano in fondo sotto "e' il mercato,
#   non il nome" — notizie su un nome che compaiono anche nel feed di un secondo. La v451 aveva misurato 12 feed
#   contro 1, non 2 contro 1.
SOGLIA_CRONACA = 3


def righe_notizie(titolo, segnali, news, ore=NOTIZIE_ORE, altrove=None):
    """v494 — il blocco delle ultimissime notizie dei nomi con un segnale: uno solo per rotazione.py e numeri_libro.py
    (v161). Per ogni nome PERCHE' e' qui (i segnali), poi le voci con data e ora italiana. Tre esiti distinti (v389).
    Le voci oltre NOTIZIE_MOSTRA si contano e si dichiarano, non si nascondono (v393). altrove: {tk: dove} per i nomi
    le cui notizie stanno gia' in un altro blocco dello stesso strumento."""
    altrove = altrove or {}
    if not segnali:
        return [f"{titolo}: nessun nome con un segnale in questo giro"]
    chiave = lambda v: v["titolo"].strip().lower()
    quando = lambda v: f"{v['quando'].astimezone(brief.ROMA):%d/%m %H:%M}"
    # la STESSA voce nel feed di piu' nomi del blocco e' cronaca di mercato, non una notizia sul nome (v451): non si
    #   toglie, si conta e si scrive una volta sola, in fondo. Il 17/10 «Stock Indexes Finish Sharply Lower» stava
    #   in cima al feed di cinque posizioni e copriva «Why Is CoreWeave Stock Falling Today?»
    chi = {}
    for tk in segnali:
        nw = news.get(tk) or {}
        if tk not in altrove and nw.get("stato") == "ok":
            for v in nw.get("voci") or []:
                chi.setdefault(chiave(v), {"voce": v, "tk": set()})["tk"].add(tk)
    comuni = {k: x for k, x in chi.items() if len(x["tk"]) >= SOGLIA_CRONACA}
    # nel feed di due nomi: resta con ciascuno, e dice dove altro compare — e' il titolo a dire di chi parla (v415)
    anche = {k: sorted(x["tk"]) for k, x in chi.items() if 2 <= len(x["tk"]) < SOGLIA_CRONACA}

    def non_mostrate(k):
        return ("… e un" + chr(39) + "altra voce nelle stesse ore, non mostrata" if k == 1 else
                f"… e altre {k} voci nelle stesse ore, non mostrate")
    L = [f"{titolo} — feed Nasdaq del simbolo, ultime {ore} ore, ora italiana · [TK] = trovata nel feed di TK, non "
         f"'notizia su TK' (v415) · la voce che sta nel feed di almeno {SOGLIA_CRONACA} nomi del blocco e' cronaca di "
         "mercato: una volta, in fondo; quella nel feed di due resta con ciascuno, e dice dove altro compare (v500) "
         "· il feed e' UNA fonte: la ricerca web nelle stesse ore resta obbligatoria, con fonte e data "
         f"(FORMATO_ANALISI.md) · chi ha un segnale porta il perche' e fino a {NOTIZIE_MOSTRA} voci proprie, chi non ne ha "
         f"le {NOTIZIE_MOSTRA_SENZA} piu' recenti (v499)"]
    for tk, motivi in segnali.items():
        L.append(f"  {tk} — " + (" · ".join(motivi) if motivi else
                                 "nessun segnale: le voci piu' recenti, perche' un evento non aspetta un segnale"))
        if tk in altrove:
            L.append(f"      notizie: nel blocco {altrove[tk]}")
            continue
        nw = news.get(tk) or {"stato": "non richiesto", "voci": []}
        if nw["stato"] != "ok":
            L.append(f"      feed NON letto ({nw['stato']}) — non vuol dire 'nessuna notizia'")
            continue
        proprie = [v for v in nw["voci"] if chiave(v) not in comuni]
        k_com = len(nw["voci"]) - len(proprie)
        tetto = NOTIZIE_MOSTRA if motivi else NOTIZIE_MOSTRA_SENZA
        if nw.get("vuoto"):
            L.append("      ⚠ il feed del simbolo e' VUOTO: questa fonte non serve il nome — le notizie vanno cercate in rete")
        elif nw.get("fermo_dal"):
            L.append(f"      ⚠ il feed del simbolo e' FERMO: l'ultima voce e' del {nw['fermo_dal'].astimezone(brief.ROMA):%d/%m/%Y} "
                     "— per questo nome la fonte non porta le notizie, vanno cercate in rete")
        elif not nw["voci"]:
            L.append(f"      feed letto, nessuna voce nelle ultime {ore} ore")
        elif not proprie:
            # v510 — «le 1 del feed sono»: il plurale fisso su una voce sola
            L.append("      nessuna voce propria: " + ("l'unica voce del feed e' cronaca di mercato" if k_com == 1 else
                                                      f"le {k_com} voci del feed sono cronaca di mercato")
                     + ", in fondo al blocco")
        for v in proprie[:tetto]:
            altri = [x for x in anche.get(chiave(v), []) if x != tk]
            L.append(f"      [{tk}] {quando(v)} {v['titolo'][:110]}"
                     + (f" (anche nel feed di {', '.join(altri)})" if altri else ""))
        if len(proprie) > tetto:
            L.append("      " + non_mostrate(len(proprie) - tetto))
        if proprie and k_com:
            L.append(f"      + {k_com} {'voce' if k_com == 1 else 'voci'} di cronaca di mercato, in fondo al blocco")
        if nw.get("copre_da"):
            L.append(f"      ⚠ il feed ha restituito {nw.get('lette')} voci e cadono tutte nelle ultime {ore} ore: arriva "
                     f"solo fino al {nw['copre_da'].astimezone(brief.ROMA):%d/%m %H:%M}, e prima la finestra puo' averne altre")
    if comuni:
        L.append(f"  CRONACA DI MERCATO — {len(comuni)} {'voce' if len(comuni) == 1 else 'voci'} nel feed di almeno "
                 f"{SOGLIA_CRONACA} nomi di questo blocco: per lo piu' il mercato, non il nome — il titolo dice se parla "
                 "di uno di loro")
        ordinate = sorted(comuni.values(), key=lambda x: x["voce"]["quando"], reverse=True)
        for x in ordinate[:NOTIZIE_MOSTRA]:
            L.append(f"      {quando(x['voce'])} {x['voce']['titolo'][:110]} (nel feed di {', '.join(sorted(x['tk']))})")
        if len(ordinate) > NOTIZIE_MOSTRA:
            L.append("      " + non_mostrate(len(ordinate) - NOTIZIE_MOSTRA))
    return L


def riga_valutazione(t):
    """v492 — il P/E di un ingresso: la resa delle schede (una sola, v161). Fuori dalla pipeline i multipli
    non ci sono, e si dice invece di cercarli altrove: due fonti per lo stesso multiplo divergono."""
    return (schede_progetto.riga_valutazione(t) if t.get("in_pipeline") else
            "valutazione: P/E n.d. — titolo non seguito dalla pipeline, il sistema non ha i multipli dell'aggregatore")


def riga_rendimento(t):
    """v520 — ROIC e ROE di un ingresso: la resa delle schede (una sola, v161). Fuori dalla pipeline non ci sono."""
    if not t.get("in_pipeline"):
        return "rendimento del capitale: n.d. — titolo non seguito dalla pipeline, il sistema non ha i bilanci"
    x = t.get("rendimento")
    return schede_progetto.riga_rendimento({"stats": t.get("stats"), "sector": t.get("sector_pipeline"),
                                            **({} if x == "assente" else {"rendimento": x})})


LETTURA_INGRESSO = {   # v481-v482 — l'esito della tenuta letto da chi NON possiede il nome
    "VENDITA PER EVIDENZA": "un ingresso qui e' speculativo, CONTRO l'evidenza: ammesso, e si dichiara tale",
    "CONFLITTO — DA VALUTARE": ("prezzo e crescita dicono cose opposte: e' il caso in cui un ingresso puo' essere "
                                "un'occasione (AMD, LIBRO.md §1sexies) o una trappola — decidono le notizie, nei due versi"),
    "IN OSSERVAZIONE": "una parte dell'evidenza e' contraria",
    "LASCIAR CORRERE": "nessuna evidenza contraria: se entra, si lascia correre",
    "NON MISURABILE": "nessuna prova si misura ancora",
}


def riga_tenuta(v):
    """La regola di tenuta del CEO (LIBRO.md §1sexies) applicata a un sorvegliato: cosa direbbe se
    il nome fosse in portafoglio. La resa delle famiglie e' quella delle posizioni (una sola, v161)."""
    import numeri_libro
    return (f"tenuta se fosse in portafoglio (LIBRO.md §1sexies): {numeri_libro.etichetta_esito(v)}"
            + f" — {LETTURA_INGRESSO[v['esito']]} · {numeri_libro.riga_prove(v)}")


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
         "   ⚠ il SEMAFORO non vieta ingressi in nessun colore (LIBRO.md §1ter, decisioni del CEO del 09/10 e del "
         "15/10): il settore di un titolo NON e' in questi dati, la correlazione col libro si' — chi e' nella stessa "
         "scommessa lo dichiara",
         f"   lettura a {ANNI_LETTURA} anni (decisione del CEO del 16/10/2026) = convenzioni di lettura, non soglie: medie "
         f"a {', '.join(str(k) for k in SETTIMANE_MEDIE)} settimane sulle chiusure delle settimane CONCLUSE, pendenza su "
         f"{SETTIMANE_PENDENZA} settimane, massimo e minimo delle sedute concluse · la serie e' quella della societa' di "
         "oggi: dall'ultima operazione societaria e dalla fine del veicolo di quotazione (SPAC) dichiarata sul registro SEC",
         "   " + (o.get("valutazione_rif") or "valutazione: riferimento n.d."),
         "   " + INTESTAZIONE_STRUTTURA,
         "   " + INTESTAZIONE_IPERVENDUTO,
         "   " + INTESTAZIONE_VWAP]          # v500 — una volta per blocco (v407)
    if o.get("spy_assente"):
        L.append("   ⚠ serie dell'S&P 500 NON letta: i beta mancano tutti, non sono zero")
    sem = o.get("semaforo") or {}
    if sem:
        L.append("   tenuta (LIBRO.md §1sexies, decisioni del CEO del 14/10): per ogni nome cosa direbbe la regola se fosse "
                 "in portafoglio — il bilancio dell'evidenza, contro e a favore, non la sola tecnica · semaforo "
                 + f"{sem.get('colore') or 'n.d.'}{' (MINIMO)' if sem.get('minimo') else ''} sugli stessi dati di numeri_libro")
        # v498 — la prova del CDS una volta per blocco: la stessa riga delle posizioni (una resa, v161)
        import numeri_libro
        L.append("   " + numeri_libro.riga_regola_cds([(t["tk"], ((t.get("tenuta") or {}).get("prove") or {}).get("cds"))
                                                       for t in w]))
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
            "conseguenze": conseguenze(rt, rlibro, rqqq, valore_libro, unita_usd),
            # v487 — i pavimenti viaggiano con la voce: solo i sorvegliati li hanno (la chiave manca ai candidati)
            "pavimenti": t.get("pavimenti"), "ha_pavimenti": "pavimenti" in t}


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


def righe_piano_pavimenti(voci):
    """v487 — il gruppo SUI PAVIMENTI del piano: per ogni sorvegliato l'ordine con limite sul pavimento piu'
    vicino, lo stop, la perdita allo stop e la volatilita' del libro per l'unita' di calcolo; chi non ha un
    pavimento sotto il prezzo e chi non ha lo storico si NOMINANO (v406). Ordine: la distanza in ATR, un fatto."""
    w = [v for v in voci if v.get("ha_pavimenti")]
    if not w:
        return []
    con = sorted((v for v in w if v["pavimenti"] and v["pavimenti"]["minimi"]),
                 key=lambda v: abs(v["pavimenti"]["minimi"][0]["atr"]))
    senza = [v["tk"] for v in w if v["pavimenti"] and not v["pavimenti"]["minimi"]]
    non_letti = [v["tk"] for v in w if v["pavimenti"] is None]
    L = [f"■ SUI PAVIMENTI — ordini con limite sul pavimento più vicino (decisione del CEO del 15/10/2026: entrare sui "
         f"minimi, non sulla risalita) · si eseguono solo se il prezzo scende fin lì · ordine: distanza in ATR — {len(con)}"]
    for v in con:
        z, c = v["pavimenti"]["minimi"][0], v["conseguenze"]
        gr = ("STESSA SCOMMESSA del libro" if v["gruppo"].startswith("STESSA") else
              "correlazione col libro NON misurabile" if v["gruppo"].startswith("CORRELAZIONE") else "DIVERSIFICA")
        r = (f"    {v['tk']} {prezzo(v['px'])} · {gr} (corr {n(v['corr'], 2)}) · ordine con limite {prezzo(z['ordine'])} "
             f"({n(z['pct'], 1, '%')}, {n(z['atr'], 1)} ATR) sul pavimento {_fascia(z)} ({len(z['tocchi'])} "
             f"{'tocco' if len(z['tocchi']) == 1 else 'tocchi'})")
        r += (" · stop n.d." if z["stop"] is None else
              f" · stop {prezzo(z['stop'])}: {_euro(-z['perdita_eur'])} ogni {_euro(UNITA_EUR)}")
        if c and c.get("dvol") is not None:
            r += f" · volatilità del libro {n(c['dvol'], 2)} punti"
        tr = v.get("trimestrale")
        if tr:
            r += f" · trimestrale {tr['data']} ({tr['giorni']} g)"
            if tr.get("giorni") is not None and tr["giorni"] <= TRIMESTRALE_VICINA:
                r += (" ⚠ un ordine lasciato attivo durante i conti può eseguirsi all'apertura dopo, anche sotto il "
                      "pavimento: si decide prima se tenerlo aperto")
        L.append(r)
    if senza:
        L.append(f"    senza un pavimento sotto il prezzo nei {ANNI_PAVIMENTI} anni (nessun minimo di oscillazione sotto): "
                 + ", ".join(senza))
    if non_letti:
        L.append("    storico NON letto (non vuol dire 'nessun pavimento'): " + ", ".join(non_letti))
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
         "   il SEMAFORO non vieta ingressi (numeri_libro.py, LIBRO.md §1ter): in giallo, arancione e rosso ogni ingresso "
         "porta le sue conseguenze — dal 15/10/2026 arancione e rosso non vendono; col salvavita scattato vale prima il "
         "suo gradino"]
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
    L.extend(righe_piano_pavimenti(voci))
    stessa = [v["tk"] for v in voci if v["gruppo"].startswith("STESSA") and v["posizione"] in ("dentro", "sotto", "sopra")]
    if stessa:
        L.append(f"   ⚠ nella stessa scommessa del libro (correlazione da {piano(SOGLIA_CORR)} in su): {', '.join(stessa)} — "
                 "un ingresso lì aggiunge alla concentrazione invece di ridurla, e la volatilità del libro lo mostra")
    return L


def e_candidato(t):
    return str(t.get("stato", "")).startswith("CANDIDATO") and not t.get("nel_libro")


def segnali_watchlist(o):
    """v494 — {tk: motivi} dei sorvegliati con un INGRESSO POSSIBILE, nell'ordine di LIBRO.md; e {tk: blocco} per chi
    ha gia' le notizie nel blocco dei CANDIDATI (un candidato di settore, feed letto a 7 giorni): la stessa fonte non
    si chiede due volte, e la stessa voce non si scrive in due blocchi."""
    seg = {}
    for t in o.get("watchlist") or []:
        m = segnali_ingresso(t)
        if m:
            seg[t["tk"]] = m
    cand = {t["tk"] for s in o.get("settori") or [] for t in s["titoli"] if e_candidato(t)}
    return seg, {tk: "CANDIDATI PER SETTORE (ultimi 7 giorni)" for tk in seg if tk in cand}


def nomi_notizie(segnali, tutti):
    """v499 — {tk: motivi} per il blocco delle notizie: prima i nomi con un segnale (il perche' accanto), poi TUTTI gli
    altri con la lista vuota. Una sola costruzione per sorvegliati (qui) e posizioni (numeri_libro, v161)."""
    return {**{tk: m for tk, m in segnali.items()}, **{tk: [] for tk in tutti if tk not in segnali}}


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
    # v500 — gli stati si definiscono NELL'USCITA: il 18/10 SMH era "IN TENDENZA" con 1m -3,7% e 3m -3,4%, e la
    #   definizione stava solo in testa allo script, che chi legge non vede (v406)
    L = ["CANDIDATI PER SETTORE — prezzi di oggi (stockanalysis.com) · stati = convenzioni: settore IN TENDENZA = prezzo "
         "sopra la media a 200 e media a 50 in salita su 20 sedute (anche coi rendimenti a 1 e 3 mesi negativi: la media a "
         "50 porta con se' il rialzo dei mesi prima), IN RIBASSO = sotto la 200 e media a 50 in discesa, MISTO = il resto "
         "· volumi sull'ultima seduta CONCLUSA (quella in corso esclusa) · notizie: feed Nasdaq del simbolo, ultimi "
         f"{giorni} giorni ([TK] = trovata nel feed di TK, non 'notizia su TK') · lettura a {ANNI_LETTURA} anni, P/E e "
         "struttura delle oscillazioni: convenzioni e riferimento dell'S&P 500 in testa al blocco WATCHLIST"]
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
            L.append(f"      {riga_valutazione(t)}")
            L.append(f"      {riga_rendimento(t)}")
            if "cinque_anni" in t:        # v492
                L.extend(f"      {r}" for r in righe_5anni(t["cinque_anni"], t.get("veicolo")))
            if "struttura" in t:          # v494
                L.extend(f"      {r}" for r in righe_struttura(t["struttura"]))
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
        print("\n".join(righe_fine_anno(o)))         # v512 — il calendario fiscale di fine anno
        print()
        # v494 — le ultimissime notizie dei sorvegliati (CEO, 17/10/2026)
        # v499 — di TUTTI i sorvegliati, non solo di quelli con un ingresso possibile: la Roadster di Tesla (16/10) sarebbe
        #   rimasta fuori se TSLA non avesse avuto un pavimento vicino. Chi ha un segnale viene prima, col suo perche'
        seg, altrove = segnali_watchlist(o)
        nomi = nomi_notizie(seg, [t["tk"] for t in o.get("watchlist") or []])
        print("\n".join(righe_notizie("NOTIZIE ULTIMISSIME — TUTTI I SORVEGLIATI (il perche' accanto a chi ha un ingresso "
                                      "possibile)", nomi, notizie_recenti([tk for tk in nomi if tk not in altrove]),
                                      altrove=altrove)))
        print()
        print("\n".join(righe_piano(o)))
