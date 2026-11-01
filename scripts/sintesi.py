#!/usr/bin/env python3
"""SINTESI OPERATIVA (v524) — gli INCROCI dei dati, non l'elenco: il regime del mercato in sei luci, il libro dentro
quel regime, la mappa tesi × prezzo delle posizioni, cosa e' cambiato dall'analisi precedente, l'agenda, e le azioni
che le regole del CEO danno per ogni casella.

Istruzione del CEO del 31/10/2026, testuale: *"Vorrei che tutta l'analisi … porti ad un'analisi finale dove tu mi dica
questa è la situazione in generale questa è la situazione correlata al tuo portafoglio, fai attenzione su queste cose che
accadranno e secondo me conviene muoverti in questo modo o non muoverti"*, poi *"Io voglio avere tutto ma non voglio
passare un'ora a leggere"* e, sull'impostazione proposta (regime × libro, tesi × prezzo, credito × prezzo, eventi ×
tutto), *"Procedi su tutto"*.

⚠ NON RICALCOLA NIENTE. Legge cio' che gli strumenti del giro hanno scritto (memoria/dati/giro/, con --json: una lettura
sola per analisi, v161) e la lettura alla fonte del giro (fonti_dirette, fonti_titoli). Le luci sono CONVENZIONI
dichiarate (LIBRO.md §1quattuordecies, rilette da un gate: v474) e dove una soglia esiste gia' — credito e tassi del
semaforo — si riusa quella: due verdetti sulla stessa cosa divergerebbero (v161). Nessun punteggio d'insieme (v200):
le luci non si sommano. La mappa e' la TENUTA disegnata (LIBRO.md §1sexies), non una regola nuova: una tendenza ROTTA
con una prova di crescita a favore e' per costruzione il CONFLITTO della tenuta.

Uso:  python3 scripts/sintesi.py [--registra] [--cartella memoria/dati/giro]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numeri_libro as NL                      # noqa: E402

RADICE = Path(__file__).resolve().parent.parent
GIRO = RADICE / "memoria" / "dati" / "giro"
REGISTRO = RADICE / "memoria" / "registro_analisi.jsonl"
ROMA = ZoneInfo("Europe/Rome")
STRUMENTI_GIRO = ("libro", "rotazione", "indici", "posizionamento", "brief", "concorrenti")   # v525 — brief e concorrenti   # i file --json del giro (analisi.py)
MINUTI_GIRO = 30           # oltre, il file e' di un altro giro: si dichiara, non si usa (la stessa regola di fonti_dirette)

# ── le soglie delle luci: CONVENZIONI (v240), scritte anche in LIBRO.md §1quattuordecies e confrontate da un gate ────
CRESCITA_FORTE = 10.0      # utili dell'S&P 500 sull'anno (FactSet, blended) da +10%: la crescita e' forte
TASSI_VICINO = 0.3         # il decennale entro 0,3 punti dalla soglia del semaforo (SOGLIA_T10): vicino
RIALZO_PROB = 50           # probabilita' di rialzo alla prossima riunione della Fed da 50%: la Fed spinge contro
VIX_ALTO = 80              # percentile del VIX nell'anno da 80: rischio percepito alto
VIX_MEDIO = 60             # da 60: sopra la norma
FG_PAURA_FORTE = 25        # Fear & Greed fino a 25: paura forte
FG_PAURA = 45              # fino a 45: paura
TERMINE_INVERTITA = 1.0    # VIX / VIX3M da 1: la curva della volatilita' e' invertita (stress in corso)
FLUSSI_CONTRO = 5.0        # SMH meno SPY a 21 sedute, in punti: da -5 il denaro va contro il libro, da +5 a favore
FLUSSI_FORTE = 10.0        # da -10: contro, forte
VAL_SOPRA = 1.10           # P/E prospettico dell'S&P (FactSet) oltre il 10% sopra la sua media a 10 anni
VAL_MOLTO = 1.20           # oltre il 20%
CAPE_ALTO = 80             # CAPE dal 80° percentile dei 20 anni: caro sulla storia lunga
EVENTO_GIORNI = 14         # conti entro 14 giorni: la regola dell'ingresso binario (LIBRO.md §1quater, rotazione)
LIVELLO_ATR = 1.0          # un livello entro 1 ATR dal prezzo: e' un punto di decisione vicino
AGENDA_GIORNI = 21
SETTORI_CORR = 0.3         # settori in tendenza con correlazione col libro sotto 0,3: dove il denaro va senza di noi
INGRESSI_MAX = 3
SHORT_MOLTO_ALTA = 20.0    # la banda «molto alta» delle schede (schede_progetto.SI_BANDE)
DILUIZIONE_FORTE = 10.0    # la soglia del blocco flottante (schede_progetto.AZ_DILUIZIONE_FORTE)

COLORI = ("🟢", "🟡", "🟠", "🔴")
NOMI_COLORE = {"🟢": "favorevole", "🟡": "neutro", "🟠": "sfavorevole", "🔴": "in tensione", "⚪": "non misurata"}
FAMIGLIE = (("crescita", "CRESCITA E UTILI"), ("tassi", "TASSI E FED"), ("credito", "CREDITO"),
            ("rischio", "RISCHIO PERCEPITO"), ("flussi", "FLUSSI VERSO IL LIBRO"), ("valutazione", "VALUTAZIONE"))
CASELLE = (("sano", "forte"), ("rotto", "forte"), ("sano", "senza"), ("rotto", "senza"), ("nm", "forte"), ("nm", "senza"))
NOME_CASELLA = {("sano", "forte"): "PREZZO SANO · TESI FORTE", ("rotto", "forte"): "PREZZO ROTTO · TESI FORTE",
                ("sano", "senza"): "PREZZO SANO · SENZA CRESCITA", ("rotto", "senza"): "PREZZO ROTTO · SENZA CRESCITA",
                ("nm", "forte"): "PREZZO NON MISURABILE · TESI FORTE", ("nm", "senza"): "PREZZO NON MISURABILE · SENZA CRESCITA"}
# l'azione di ogni casella e' quella delle regole gia' decise dal CEO: qui il rimando, la regola sta in LIBRO.md
AZIONE_CASELLA = {
    ("sano", "forte"): "si lascia correre: nessuna vendita sui ribassi (CEO, 15/10) — il colore del semaforo e' un segnale (LIBRO.md §1ter, §1sexies)",
    ("rotto", "forte"): "CONFLITTO: si decide ai conti successivi, con l'esame scritto prima e mandato al CEO 7 giorni prima (14/10); "
                        "la media solo se la tesi regge — mai prima dei conti, che e' una scommessa binaria (§1quater, §1sexies)",
    ("sano", "senza"): "il motore della tesi non si vede nei numeri: la tenuta dice cosa guardare, la decisione e' del CEO (§1sexies)",
    ("rotto", "senza"): "con un'altra prova contro e' la VENDITA PER EVIDENZA: si propone al CEO, la decisione e' sua (§1sexies)",
    ("nm", "forte"): "la tendenza non si misura (storia corta): l'esito della tenuta e' provvisorio, e lo dice (§1sexies)",
    ("nm", "senza"): "la tendenza non si misura (storia corta): l'esito della tenuta e' provvisorio, e lo dice (§1sexies)"}

_it, _sg, _conta, _data = NL._it, NL._sg, NL._conta, NL._data_it
from comuni import art                     # noqa: E402  — l'articolo davanti a un numero (v510)


def _gm(iso):
    return _data(iso)[:5] if iso else "n.d."


def _pct(x, d=1):
    """Una VARIAZIONE, col segno."""
    return "n.d." if x is None else _sg(x * 100, d) + "%"


def _quota(x, d=1):
    """Una QUOTA (peso, volatilita'), senza segno: «+68,3% dell'azionario» si leggerebbe come una variazione."""
    return "n.d." if x is None else _it(x * 100, d) + "%"


# ── lettura dei file del giro ─────────────────────────────────────────────────────────────────────────────────────
def leggi_giro(nome, cartella=GIRO, adesso=None, massimo=MINUTI_GIRO):
    """(dati, motivo). Un file assente, illeggibile o di un altro giro si DICHIARA: la luce che ne dipende diventa
    ⚪ «non misurata», mai una luce calcolata su dati vecchi senza dirlo (v396, v406)."""
    p = Path(cartella) / f"{nome}.json"
    try:
        eta = ((adesso or datetime.now(timezone.utc)).timestamp() - p.stat().st_mtime) / 60
    except OSError:
        return None, f"{p.name} non scritto in questo giro"
    if eta > massimo:
        return None, f"{p.name} di {_it(eta, 0)} minuti fa: e' di un altro giro"
    try:
        return json.loads(p.read_text(encoding="utf-8")), None
    except (OSError, ValueError) as e:
        return None, f"{p.name} illeggibile ({type(e).__name__})"


# ── le sei luci ───────────────────────────────────────────────────────────────────────────────────────────────────
def _luce(colore, dati, decide, perche=None):
    return {"colore": colore, "dati": dati, "decide": decide, "perche": perche}


def luce_crescita(factset, fondamentali):
    """Utili dell'S&P (FactSet) e revisioni dei leader (la famiglia del semaforo). Gli investimenti delle grandi
    piattaforme cloud non sono una serie: la riga lo dice ogni volta (la stessa avvertenza del semaforo, v474)."""
    r = ((factset or {}).get("rapporti") or [None])[0] or {}
    cr, bt = (r.get("crescita") or {}).get("valore"), r.get("battono") or {}
    fam = (fondamentali or {}).get("stato")
    pezzi = []
    if cr is not None:
        pezzi.append(f"utili dell'S&P 500 {_sg(cr)}% sull'anno (FactSet, {(r.get('crescita') or {}).get('trimestre') or 'n.d.'}, "
                     f"{(r.get('crescita') or {}).get('tipo') or 'n.d.'})")
    if bt.get("valore") is not None:
        pezzi.append(f"battono le attese {art('il', _it(bt['valore'], 0) + '%')} (media 5 anni {_it(bt.get('media5'), 0)}%)")
    righe = (fondamentali or {}).get("righe") or []
    if righe:
        pezzi.append("revisioni a 30 giorni dei leader: " + " · ".join(f"{x['tk']} {x.get('su')} su, {x.get('giu')} giu'" for x in righe))
    pezzi.append("investimenti delle grandi piattaforme cloud: NON calcolati, da verificare in rete")
    decide = (f"crescita ≥ {_it(CRESCITA_FORTE, 0)}% con le attese battute almeno quanto la media a 5 anni e le revisioni "
              "dei leader non accese; negativa, o revisioni accese, = in tensione")
    if fam == "acceso" or (cr is not None and cr < 0):
        return _luce("🔴", pezzi, decide, "revisioni dei leader accese" if fam == "acceso" else "utili in calo")
    if cr is None and fam is None:
        return _luce("⚪", pezzi, decide, "FactSet e revisioni non letti")
    if cr is not None and cr >= CRESCITA_FORTE and bt.get("valore") is not None and bt.get("media5") is not None \
            and bt["valore"] >= bt["media5"] and fam == "spento":
        return _luce("🟢", pezzi, decide)
    return _luce("🟡", pezzi, decide)


def _prossima_riunione(fw):
    for m in (fw or {}).get("meetings") or []:
        if m.get("prezzata_dal_contratto") and (m.get("hike_prob") is not None or m.get("cut_prob") is not None
                                                or m.get("hold_prob") is not None):
            return m
    return None


def luce_tassi(fam_tassi, scelta, fw):
    t10 = ((fam_tassi or {}).get("t10") or {}).get("valore")
    m = _prossima_riunione(fw)
    s = scelta or {}
    pezzi = []
    if t10 is not None:
        pezzi.append(f"decennale {_it(t10, 2)}% del {_gm(((fam_tassi or {}).get('t10') or {}).get('data'))} "
                     f"(soglia del semaforo {_it(NL.SOGLIA_T10, 1)})")
    for k, nome, dec in (("reale10", "tasso reale (TIPS)", 2), ("curva", "curva 10A-2A", 2), ("effr", "tasso effettivo Fed", 2)):
        v = (s.get(k) or {}).get("valore")
        if v is not None:
            pezzi.append(f"{nome} {(_sg(v, dec) + ' punti') if k == 'curva' else _it(v, dec) + '%'}")
    if m:
        esiti = [f"{nome} {_it(m[k], 0)}%" for k, nome in (("hike_prob", "rialzo"), ("hold_prob", "invariato"),
                                                           ("cut_prob", "taglio")) if m.get(k) is not None]
        pezzi.append(f"FedWatch {_gm(m['date'])}: " + " · ".join(esiti))
    decide = (f"decennale sopra {_it(NL.SOGLIA_T10, 1)} (la soglia del semaforo) = in tensione; entro {_it(TASSI_VICINO, 1)} "
              f"punti = sfavorevole; un rialzo alla prossima riunione da {RIALZO_PROB}% = neutro")
    if t10 is None:
        return _luce("⚪", pezzi, decide, "decennale non letto")
    if (fam_tassi or {}).get("stato") == "acceso":
        return _luce("🔴", pezzi, decide, "decennale oltre la soglia")
    if t10 >= NL.SOGLIA_T10 - TASSI_VICINO:
        return _luce("🟠", pezzi, decide, "decennale vicino alla soglia")
    if m and (m.get("hike_prob") or 0) >= RIALZO_PROB:
        return _luce("🟡", pezzi, decide, f"rialzo prezzato al {_it(m['hike_prob'], 0)}%")
    return _luce("🟢", pezzi, decide)


def luce_credito(fam, scelta):
    """La famiglia CREDITO del semaforo, la stessa: acceso = sfavorevole, il gradino del rosso = in tensione."""
    s = scelta or {}
    hy, ccc = (fam or {}).get("hy") or {}, (fam or {}).get("ccc") or {}
    pezzi = []
    if hy.get("valore") is not None:
        pezzi.append(f"high yield {_it(hy['valore'], 2)}% (soglie {_it(NL.SOGLIA_HY, 1)} e {_it(NL.SOGLIA_HY_ROSSO, 1)})")
    if ccc.get("valore") is not None:
        pezzi.append(f"obbligazioni CCC {_it(ccc['valore'], 2)}%, {_sg(ccc.get('salita_60_pp'), 2)} punti dal minimo di 60 sedute "
                     f"(soglia +{_it(NL.SOGLIA_CCC_PP, 1)})")
    n = (s.get("nfci") or {}).get("valore")
    if n is not None:
        pezzi.append(f"condizioni finanziarie (NFCI) {_sg(n, 2)} ({'larghe' if n < 0 else 'strette'})")
    sl = s.get("sloos") or {}
    if sl.get("valore") is not None:
        pezzi.append(f"banche (SLOOS) {_sg(sl['valore'], 1)} (indagine {NL._mese(sl.get('data'))}; negativo = allentano)")
    decide = "la famiglia CREDITO del semaforo: accesa = sfavorevole, high yield oltre 4,0 = in tensione"
    st = (fam or {}).get("stato")
    if (fam or {}).get("rosso"):
        return _luce("🔴", pezzi, decide, "high yield oltre 4,0")
    if st == "acceso":
        return _luce("🟠", pezzi, decide, "CCC salito oltre la soglia" if (fam or {}).get("ccc_acceso") else "high yield oltre 3,5")
    if st == "spento":
        return _luce("🟢", pezzi, decide)
    return _luce("⚪", pezzi, decide, "un dato del credito manca")


def luce_rischio(ind, pos, leva):
    """Un TERMOMETRO: VIX, Fear & Greed e gli altri misurano lo stress di adesso e NON anticipano i cali piu' del caso
    (misurato in LIBRO.md §1ter, v500): la luce da' il tono, non fa scattare un'azione, e la riga lo dice."""
    vol, ter, fg = (ind or {}).get("vol") or {}, (ind or {}).get("termine") or {}, (ind or {}).get("fear_greed") or {}
    vix, vxn = vol.get("VIX") or {}, vol.get("VXN") or {}
    pc, dix = (pos or {}).get("pc") or {}, (pos or {}).get("dix") or {}
    pezzi = []
    if vix.get("valore") is not None:
        pezzi.append(f"VIX {_it(vix['valore'], 2)} ({vix.get('rango')}° percentile dell'anno)")
    if vxn.get("valore") is not None:
        pezzi.append(f"VIX del Nasdaq {_it(vxn['valore'], 1)} ({vxn.get('rango')}°)")
    if ter.get("rapporto") is not None:
        pezzi.append(f"VIX/VIX3M {_it(ter['rapporto'], 2)} ({'invertita' if ter['rapporto'] >= TERMINE_INVERTITA else 'normale'})")
    if fg.get("punteggio") is not None:
        pezzi.append(f"Fear & Greed {fg['punteggio']} ({((fg.get('storia') or {}).get('rango'))}° percentile)")
    if (pc.get("ultima") or {}).get("azioni") is not None:
        pezzi.append(f"put/call azioni {_it(pc['ultima']['azioni'], 2)} ({pc.get('rango')}°)")
    if dix.get("dix") is not None:
        pezzi.append(f"DIX {_it(dix['dix'], 1)}% ({dix.get('rango')}°) · gamma dei "
                     f"dealer sull'S&P {_sg(dix.get('gex', 0) / 1e9, 2)} mld ({dix.get('rango_gex')}°)")
    if (leva or {}).get("yoy") is not None:
        pezzi.append(f"debito a margine {_sg(leva['yoy'], 1)}% sull'anno ({leva.get('yoy_rango')}° percentile)")
    pezzi.append("un termometro: non anticipa i cali piu' del caso (LIBRO.md §1ter)")
    decide = (f"VIX/VIX3M da {_it(TERMINE_INVERTITA, 1)} = in tensione; VIX dal {VIX_ALTO}° percentile o Fear & Greed fino a "
              f"{FG_PAURA_FORTE} = sfavorevole; VIX dal {VIX_MEDIO}° o Fear & Greed fino a {FG_PAURA} = neutro")
    r, rk, f = ter.get("rapporto"), vix.get("rango"), fg.get("punteggio")
    if r is None and rk is None and f is None:
        return _luce("⚪", pezzi, decide, "VIX e Fear & Greed non letti")
    if r is not None and r >= TERMINE_INVERTITA:
        return _luce("🔴", pezzi, decide, "curva della volatilita' invertita")
    if (rk is not None and rk >= VIX_ALTO) or (f is not None and f <= FG_PAURA_FORTE):
        return _luce("🟠", pezzi, decide, "volatilita' alta o paura forte")
    if (rk is not None and rk >= VIX_MEDIO) or (f is not None and f <= FG_PAURA):
        return _luce("🟡", pezzi, decide, "paura senza panico")
    return _luce("🟢", pezzi, decide)


def luce_flussi(bench21, cot):
    """Il denaro va verso il libro o via? Il libro e' per oltre meta' semiconduttori: SMH contro SPY sulle stesse 21
    sedute (bench_21 di numeri_libro, le sedute concluse). L'ampiezza e i grandi operatori sono contesto."""
    b = bench21 or {}
    smh, spy, rsp = b.get("SMH"), b.get("SPY"), b.get("RSP")
    pezzi = []
    diff = None
    if smh is not None and spy is not None:
        diff = (smh - spy) * 100
        pezzi.append(f"a 21 sedute SMH {_pct(smh)} contro SPY {_pct(spy)} → {_sg(diff, 1)} punti")
    if rsp is not None and spy is not None:
        pezzi.append(f"S&P a pesi uguali {_pct(rsp)}: {_sg((rsp - spy) * 100, 1)} punti sui giganti")
    nq = next((v for v in (cot or {}).values() if isinstance(v, dict) and str(v.get("nome", "")).startswith("Nasdaq")), None)
    lev = ((nq or {}).get("categorie") or {}).get("lev")
    if lev:
        pezzi.append(f"CFTC (al {_gm(nq.get('data'))}): fondi a leva sul Nasdaq {_sg(lev['pct'], 1)}% ({lev.get('rango')}° percentile)")
    decide = (f"SMH meno SPY a 21 sedute: da +{_it(FLUSSI_CONTRO, 0)} punti = favorevole, da -{_it(FLUSSI_CONTRO, 0)} = "
              f"sfavorevole, da -{_it(FLUSSI_FORTE, 0)} = in tensione")
    if diff is None:
        return _luce("⚪", pezzi, decide, "SMH o SPY non letti")
    if diff <= -FLUSSI_FORTE:
        return _luce("🔴", pezzi, decide, "il denaro esce forte dai semiconduttori")
    if diff <= -FLUSSI_CONTRO:
        return _luce("🟠", pezzi, decide, "il denaro esce dai semiconduttori")
    if diff >= FLUSSI_CONTRO:
        return _luce("🟢", pezzi, decide, "il denaro entra nei semiconduttori")
    return _luce("🟡", pezzi, decide)


def luce_valutazione(ind):
    fs = (((ind or {}).get("factset") or {}).get("rapporti") or [None])[0] or {}
    pe = fs.get("pe") or {}
    cape = ((ind or {}).get("multpl") or {}).get("cape") or {}
    wsj = (ind or {}).get("wsj") or {}
    pezzi = []
    if pe.get("valore") is not None:
        pezzi.append(f"S&P 500 sugli utili attesi {_it(pe['valore'], 1)}× contro la media a 10 anni {_it(pe.get('media10'), 1)}× (FactSet)")
    if cape.get("valore") is not None:
        pezzi.append(f"CAPE {_it(cape['valore'], 1)}× al {cape.get('rango20')}° percentile dei 20 anni")
    if wsj.get("fwd") is not None:
        pezzi.append(f"Nasdaq-100 sugli utili attesi {_it(wsj['fwd'], 1)}× (WSJ)")
    decide = (f"P/E prospettico oltre il {_it((VAL_MOLTO - 1) * 100, 0)}% sopra la media a 10 anni = in tensione, oltre il "
              f"{_it((VAL_SOPRA - 1) * 100, 0)}% = sfavorevole; sotto la media con il CAPE sotto il {CAPE_ALTO}° percentile = "
              "favorevole")
    v, m10, rk = pe.get("valore"), pe.get("media10"), cape.get("rango20")
    if v is None or not m10:
        return _luce("⚪", pezzi, decide, "P/E di FactSet non letto")
    if v >= m10 * VAL_MOLTO:
        return _luce("🔴", pezzi, decide, "prospettico molto sopra la media")
    if v >= m10 * VAL_SOPRA:
        return _luce("🟠", pezzi, decide, "prospettico sopra la media")
    if v < m10 and rk is not None and rk < CAPE_ALTO:
        return _luce("🟢", pezzi, decide)
    return _luce("🟡", pezzi, decide, "pieno sulla storia lunga" if rk is not None and rk >= CAPE_ALTO else None)


def luci(libro, ind, pos, scelta, fw):
    fam = ((libro or {}).get("semaforo") or {}).get("famiglie") or {}
    return {"crescita": luce_crescita((ind or {}).get("factset"), fam.get("fondamentali")),
            "tassi": luce_tassi(fam.get("tassi"), scelta, fw),
            "credito": luce_credito(fam.get("credito"), scelta),
            "rischio": luce_rischio(ind, pos, fam.get("leva")),
            "flussi": luce_flussi((libro or {}).get("bench_21"), (pos or {}).get("cot")),
            "valutazione": luce_valutazione(ind)}


# ── la mappa tesi × prezzo: la tenuta disegnata ──────────────────────────────────────────────────────────────────
def casella(riga):
    """(prezzo, tesi) di un nome dalle PROVE della tenuta: prezzo ROTTO = la tendenza contro; NON MISURABILE = la
    tendenza senza verso; tesi FORTE = almeno una prova di CRESCITA a favore (NL.CRESCITA). E' la stessa partizione di
    NL.regola_esito: rotto × forte = CONFLITTO, sempre (un gate lo verifica su ogni combinazione)."""
    pr = (riga.get("prove") or {})
    t = (pr.get("tendenza") or {}).get("verso")
    prezzo = "rotto" if t == "contro" else ("nm" if t is None else "sano")
    tesi = "forte" if any((pr.get(k) or {}).get("verso") == "favore" for k in NL.CRESCITA) else "senza"
    return prezzo, tesi


def testo_segnale(tipo, testo):
    """Il nome breve di un segnale di credito (credito.segnali): una condizione si riassume nel suo nome; quella del
    bilancio SICURO che consuma cassa si nomina per la cassa, che e' il rischio (v504) — il suo nome da solo, «bilancio in
    zona di SICUREZZA», non sarebbe un allarme. Una resa sola per la mappa e per il cruscotto (v525, v161)."""
    if tipo == "condizione":
        return "l'attivita' consuma cassa (bilancio sicuro)" if "CONSUMA CASSA" in testo else testo.split(" (")[0]
    return testo


def allarmi(righe_wl, tks, debito_sec=None):
    """Le condizioni di credito e diluizione di ogni nome — le stesse funzioni delle schede (credito.segnali, la quota
    short, la diluizione), mai una seconda derivazione (v161)."""
    import credito
    import schede_progetto as SP
    out = {}
    per = (debito_sec or {}).get("per_titolo") or {}
    for tk in tks:
        r = (righe_wl or {}).get(tk)
        if not r:
            continue
        a = []
        for tipo, testo in credito.segnali(r, per.get(tk), SP.liquidita_societa(r.get("combustione"))):
            a.append(testo_segnale(tipo, testo))
        si = r.get("short_interest") or {}
        if si.get("stato") == "misurato" and (si.get("pct_flottante") or 0) >= SHORT_MOLTO_ALTA:
            a.append(f"posizioni corte al {_it(si['pct_flottante'], 1)}% del flottante")
        az = SP.azioni_di(r) or {}
        va = ((az.get("var_anno") or {}).get("pct"))
        if va is not None and va >= DILUIZIONE_FORTE:
            a.append(f"azioni {_sg(va, 1)}% in un anno")
        if a:
            out[tk] = a
    return out


def mappa(tenuta, scadenze, allarmi_tk):
    sc = {s["tk"]: s for s in (scadenze or [])}
    m = {c: [] for c in CASELLE}
    for r in (tenuta or {}).get("righe") or []:
        c = casella(r)
        s = sc.get(r["tk"])
        m[c].append({"tk": r["tk"], "peso": r.get("peso"), "esito": r.get("esito"), "provvisorio": r.get("provvisorio"),
                     "conti": s["giorni"] if s and s.get("giorni") is not None and s["giorni"] <= EVENTO_GIORNI else None,
                     "allarmi": allarmi_tk.get(r["tk"]) or []})
    for c in m:
        m[c].sort(key=lambda x: -(x["peso"] or 0))
    return m


# ── il confronto col registro ─────────────────────────────────────────────────────────────────────────────────────
def fotografia(adesso, seduta, semaforo, lc, mp):
    return {"quando": adesso.astimezone(timezone.utc).isoformat(timespec="minutes"), "seduta": seduta,
            "semaforo": semaforo, "luci": {k: v["colore"] for k, v in lc.items()},
            "caselle": {x["tk"]: "/".join(c) for c, xs in mp.items() for x in xs},
            "esiti": {x["tk"]: x["esito"] for xs in mp.values() for x in xs}}


def leggi_registro(p=REGISTRO):
    try:
        return [json.loads(r) for r in Path(p).read_text(encoding="utf-8").splitlines() if r.strip()]
    except (OSError, ValueError):
        return []


def base_confronto(righe, seduta):
    """L'analisi precedente con cui confrontare: l'ultima di una SEDUTA diversa (le misure stanno sulle sedute
    concluse: due analisi della stessa seduta vedono gli stessi prezzi); se non c'e', l'ultima in assoluto."""
    if not righe:
        return None
    diverse = [r for r in righe if r.get("seduta") != seduta]
    return (diverse or righe)[-1]


def freccia(prima, ora):
    if prima is None or prima == ora:
        return "=" if prima == ora else "nuova"
    if "⚪" in (prima, ora):
        return f"da {prima}"
    return ("↑ peggiorata" if COLORI.index(ora) > COLORI.index(prima) else "↓ migliorata") + f" da {prima}"


def cambiamenti(base, foto):
    if base is None:
        return ["primo giro del registro: nessun confronto — le frecce partono dalla prossima analisi"]
    L = []
    if base.get("semaforo") != foto["semaforo"]:
        L.append(f"semaforo: da {base.get('semaforo')} a {foto['semaforo']}")
    for k, nome in FAMIGLIE:
        a, b = (base.get("luci") or {}).get(k), foto["luci"].get(k)
        if a != b:
            L.append(f"{nome}: {freccia(a, b)} a {b}")
    for tk, c in foto["caselle"].items():
        a = (base.get("caselle") or {}).get(tk)
        if a is None:
            L.append(f"{tk}: nuovo nella mappa ({NOME_CASELLA[tuple(c.split('/'))]})")
        elif a != c:
            L.append(f"{tk}: da {NOME_CASELLA[tuple(a.split('/'))]} a {NOME_CASELLA[tuple(c.split('/'))]}")
        elif (base.get("esiti") or {}).get(tk) != foto["esiti"].get(tk):
            L.append(f"{tk}: esito da {(base.get('esiti') or {}).get(tk)} a {foto['esiti'].get(tk)}")
    for tk in sorted(set(base.get("caselle") or {}) - set(foto["caselle"])):
        L.append(f"{tk}: uscito dalla mappa (non e' piu' una posizione)")
    return L or ["nessun cambiamento: luci, semaforo, caselle ed esiti invariati"]


# ── agenda, livelli, ingressi ─────────────────────────────────────────────────────────────────────────────────────
USCITE_AGENDA = (("cpi", "inflazione CPI"), ("nfp", "rapporto sul lavoro (posti e disoccupazione)"), ("pce", "inflazione PCE"),
                 ("gdp", "PIL"), ("retail", "vendite al dettaglio"))   # v525 — le uscite macro dell'agenda (calendario FRED)


def agenda(libro, fw, pos, oggi, cal=None, aste=None):
    """v525 — anche le uscite dei dati macro (calendario ufficiale FRED: la data DICHIARATA, mai proiettata, v396) e le
    aste del Tesoro annunciate (TreasuryDirect, con l'ora gia' convertita col fuso)."""
    ev = []
    fine = (oggi + timedelta(days=AGENDA_GIORNI)).isoformat()
    for k, nome in USCITE_AGENDA:
        p = _prossima(cal, k, oggi)
        if p and p <= fine:
            ev.append((p, f"uscita: {nome}"))
    for a in (aste or {}).get("prossime") or []:
        if a.get("giorno") and a["giorno"] <= fine and not a.get("chiusa"):
            ev.append((a["giorno"], f"asta del Tesoro {a.get('scadenza')}"
                       + (f" ({_it(a['importo_mld'], 0)} mld $" + (", riapertura" if a.get("riapertura") else "") + ")" if a.get("importo_mld") else "")
                       + (f" — chiude {a['quando']}" if a.get("quando") else "")))
    for s in ((libro or {}).get("attesa") or {}).get("scadenze") or []:
        if s.get("giorni") is not None and s["giorni"] <= AGENDA_GIORNI:
            ev.append((s["data"], f"conti di {s['tk']}" + (f" ({s['orario']})" if s.get("orario") else "")))
    for r in ((libro or {}).get("tenuta") or {}).get("righe") or []:
        sc = r.get("scadenza")
        if r.get("esito") == NL.CONFLITTO and sc and not r.get("esame") and sc.get("giorni") is not None:
            dal = (datetime.fromisoformat(sc["data"]) - timedelta(days=NL.GIORNI_ESAME)).date().isoformat()
            if dal <= (oggi + timedelta(days=AGENDA_GIORNI)).isoformat():
                ev.append((max(dal, oggi.isoformat()), f"esame del conflitto di {r['tk']} da mandare al CEO (conti del {_gm(sc['data'])})"))
    m = _prossima_riunione(fw)
    if m and m["date"] <= (oggi + timedelta(days=AGENDA_GIORNI * 3)).isoformat():
        p = " · ".join(f"{n} {_it(m[k], 0)}%" for k, n in (("hike_prob", "rialzo"), ("hold_prob", "invariato"),
                                                           ("cut_prob", "taglio")) if m.get(k) is not None)
        ev.append((m["date"], f"riunione della Fed (FedWatch: {p})"))
    mens = (pos or {}).get("mensile")
    if mens and mens.get("data"):
        ev.append((mens["data"], "scadenza mensile delle opzioni" + (" (trimestrale)" if mens.get("trimestrale") else "")))
    return sorted(ev)


def livelli(libro):
    """I punti di decisione vicini: per ogni posizione il pavimento piu' vicino e la media a 200 entro 1 ATR, e la
    media a 200 di SMH (la famiglia del prezzo del semaforo). Lontani, non sono di oggi."""
    L = []
    pz = (((libro or {}).get("semaforo") or {}).get("famiglie") or {}).get("prezzo") or {}
    if pz.get("d200_atr") is not None and abs(pz["d200_atr"]) <= LIVELLO_ATR:
        L.append(f"SMH: media a 200 a {_it(pz['sma200'], 2)} ({_sg(pz['d200_atr'], 1)} ATR) — sotto, il prezzo del semaforo peggiora")
    for r in ((libro or {}).get("tenuta") or {}).get("righe") or []:
        pz_ = []
        t = (r.get("prove") or {}).get("tendenza") or {}
        if t.get("d200_atr") is not None and abs(t["d200_atr"]) <= LIVELLO_ATR:
            pz_.append(f"media a 200 a {_it(t.get('sma200'), 2)} ({_sg(t['d200_atr'], 1)} ATR)")
        mn = ((r.get("pavimenti") or {}).get("minimi") or [])
        if mn and mn[0].get("atr") is not None and abs(mn[0]["atr"]) <= LIVELLO_ATR:
            z = mn[0]
            pz_.append(f"pavimento {_it(z['alto'], 2)} ({_sg(z['pct'], 1)}%, {_conta(len(z.get('tocchi') or []), 'tocco', 'tocchi')})")
        if pz_:
            L.append(f"{r['tk']}: " + " · ".join(pz_))
    return L


def ingressi(rot):
    """Dal piano per la liquidita' di rotazione: chi e' dentro la zona d'ingresso, DIVERSIFICA (correlazione col libro
    sotto la soglia della stessa scommessa) e non ha i conti entro 14 giorni, ordinati per quanto riduce la volatilita'
    del libro — l'ordine del blocco OPERABILI ADESSO, filtrato. Un fatto, non una classifica (v200)."""
    voci = ((rot or {}).get("piano") or {}).get("voci") or []
    sel = [v for v in voci if v.get("posizione") == "dentro" and not str(v.get("gruppo", "")).startswith(("STESSA", "CORRELAZIONE"))
           and (v.get("conseguenze") or {}).get("dvol") is not None
           and not ((v.get("trimestrale") or {}).get("giorni") is not None and v["trimestrale"]["giorni"] <= EVENTO_GIORNI)]
    sel.sort(key=lambda v: v["conseguenze"]["dvol"])
    return sel[:INGRESSI_MAX]


def settori(rot):
    return [s for s in (rot or {}).get("settori") or [] if s.get("stato") == "IN TENDENZA"
            and s.get("corr_libro") is not None and s["corr_libro"] < SETTORI_CORR]


# ══ v525 — IL QUADRO MACRO INTERO, LE NOTIZIE E IL FORUM, IL CRUSCOTTO DI OGNI POSIZIONE ═════════════════════════════
# Il CEO, 01/11/2026, sulla prova della v524: «Non mi piace. Ci sono tantissime variabili di cui non si tiene conto
# macro, news (forum) e tecniche che abbiamo inserito in questi giorni». Le sei luci riassumevano il regime e la mappa la
# tenuta; restavano fuori dot plot, statistiche e calendario delle uscite, aste, BCE, cambio, Giappone, stagionalita',
# calendario fiscale, bitcoin, grandi operatori, le notizie, il forum, e per ogni nome tecnica, opzioni, flussi, credito e
# fondamentali. Qui entrano TUTTI, ciascuno nella forma breve che lo strumento che lo calcola gia' usa: NIENTE si
# ricalcola (v161) — i valori vengono dai file del giro o dalle funzioni delle schede sulle righe della pipeline.
# ⚠ Cio' che le sei luci gia' portano (decennale, curva, tasso effettivo, FedWatch, credito, VIX, Fear & Greed, put/call,
#   DIX, leva, CFTC sul Nasdaq, P/E) qui NON si ripete: due rese dello stesso numero sono la classe v415.
NOTIZIE_MACRO_MOSTRA = 5         # le voci macro piu' recenti nel blocco; le altre si contano (v393)
NOTIZIE_NOME_MOSTRA = 2          # le voci piu' recenti di ogni nome nel cruscotto; le altre si contano
WSB_MOSTRA = 8                   # i piu' citati del forum
VOLUMI_ALTI = 90                 # volumi dal 90° percentile dell'anno: la seduta e' fra le piu' scambiate (convenzione)
MESI_IT = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
           "novembre", "dicembre")


def _ora_it(iso):
    """«dd/mm hh:mm» in ora italiana da un ISO con fuso; senza fuso o illeggibile: la data com'e'."""
    try:
        t = datetime.fromisoformat(str(iso))
        if t.tzinfo is None:
            return str(iso)[:16]
        return f"{t.astimezone(ROMA):%d/%m %H:%M}"
    except ValueError:
        return str(iso or "n.d.")


def _ts(iso):
    try:
        return datetime.fromisoformat(str(iso)).timestamp()
    except ValueError:
        return 0.0


def _mese_di(iso):
    try:
        return f"{MESI_IT[int(str(iso)[5:7]) - 1]} {str(iso)[:4]}"
    except (ValueError, IndexError):
        return str(iso or "n.d.")


def _prossima(cal, chiave, oggi):
    """La prossima uscita DICHIARATA dal calendario ufficiale (FRED, v395-v396), mai proiettata: None se non c'e'."""
    p = (((cal or {}).get("per_chiave") or {}).get(chiave) or {}).get("prossime") or []
    p = [x for x in p if x >= oggi.isoformat()]
    return p[0] if p else None


def _ind_pipe(macro, chiave):
    for x in (macro or {}).get("indicators") or []:
        if isinstance(x, dict) and x.get("key") == chiave:
            return x
    return None


def _virgola(s):
    """Il valore come la pipeline lo stampa («3.6%», «+0.38 pp») nella convenzione del pacchetto (v442)."""
    return str(s).replace(".", ",") if s is not None else "n.d."


def quadro_macro(macro, scelta, libro, ind, pos, brief_g, rot, pred, oggi):
    """Le righe del quadro macro che le sei luci non portano. Ogni dato con la sua data e la prossima uscita dichiarata;
    cio' che manca si dichiara («dato non disponibile», v396), mai un valore neutro."""
    m, s, L = macro or {}, scelta or {}, []
    cal = m.get("calendario_uscite")
    # ── la Fed: il target, la catena delle riunioni (le probabilita' della prima sono nella luce dei tassi), il dot plot
    fw = m.get("fedwatch") or {}
    cat = []
    prima = _prossima_riunione(fw)
    for x in (fw.get("meetings") or [])[:5]:
        if prima is not None and x.get("date") == prima.get("date"):
            continue                      # la prima riunione e' nella luce dei tassi: qui non si ripete (v415)
        if x.get("prezzata_dal_contratto") and x.get("mosse_cumulate") is not None:
            cat.append(f"{_gm(x['date'])} {_sg(x['mosse_cumulate'], 2)}")
        else:
            cat.append(f"{_gm(x.get('date'))} non prezzata")
            break
    pf = m.get("proiezioni_fomc") or {}
    fed = [f"target {(fw.get('target_range') or 'n.d.').replace('.', ',')}"]
    if cat:
        fed.append("dopo la prossima riunione, movimenti da 25 punti base attesi cumulati da oggi: " + " · ".join(cat)
                   + " (contratti Fed Funds, metodo CME; sopra il movimento intero non e' una probabilita')")
    if pf.get("stato") in ("letto", "riportato") and pf.get("mediana"):
        an, me, pr = pf.get("anni") or [], pf.get("mediana") or [], ((pf.get("precedente") or {}).get("mediana") or [])
        pezzi = [f"{a if a != 'Longer run' else 'lungo periodo'} {_it(v, 1)}%"
                 + (f" (prima {_it(pr[i], 1)})" if i < len(pr) and pr[i] is not None else "")
                 for i, (a, v) in enumerate(zip(an, me)) if v is not None][:3]
        fed.append(f"dot plot del {_gm(pf.get('riunione'))}: mediana del tasso a fine " + " · ".join(pezzi)
                   + ("" if pf.get("stato") == "letto" else " — RIPORTATO dal run precedente"))
    else:
        fed.append("dot plot: dato non disponibile")
    fed.append("mercati di previsione (Polymarket): " + ("nessun mercato macro in questo run (la pipeline non distingue una "
                                                          "fonte caduta da una fonte senza mercati)" if not pred else
                                                          f"{len(pred)} mercati macro — nel pacchetto della pagina"))
    L.append("  FED: " + " · ".join(fed))
    # ── le statistiche ufficiali: l'ultimo dato con il suo periodo e la prossima uscita dichiarata
    st = []
    for k, chiave, nome, testo in (("cpi", "cpi", "inflazione CPI", lambda v: f"{_it(v, 1)}%"),
                                   ("disoccupazione", "unemp", "disoccupazione", lambda v: f"{_it(v, 1)}%"),
                                   ("nfp", "nfp", "posti di lavoro", lambda v: f"{_sg(v, 0)} mila")):
        v = s.get(k) or {}
        p = _prossima(cal, chiave, oggi)
        st.append(f"{nome} {testo(v['valore']) if v.get('valore') is not None else 'n.d.'} ({_mese_di(v.get('data'))})"
                  + (f" → {_gm(p)}" if p else " → prossima uscita: dato non disponibile"))
    for chiave, nome in (("pce", "inflazione PCE"), ("gdp", "PIL"), ("retail", "vendite al dettaglio"),
                         ("umich", "fiducia dei consumatori (UMich)")):
        x = _ind_pipe(m, chiave)
        p = _prossima(cal, chiave, oggi)
        if x is None and p is None:
            continue
        per = (x or {}).get("date")
        per_t = (f"{(int(str(per)[5:7]) - 1) // 3 + 1}° trimestre {str(per)[:4]}" if chiave == "gdp" and per else _mese_di(per))
        st.append(f"{nome} {_virgola((x or {}).get('value'))} ({per_t})" + (f" → {_gm(p)}" if p else ""))
    L.append("  DATI USA (ultimo dato ufficiale · → prossima uscita dichiarata dal calendario FRED): " + " · ".join(st))
    # ── aste del Tesoro
    a = (brief_g or {}).get("aste")
    if not a:
        L.append("  ASTE DEL TESORO: non lette in questo giro (diverso da «nessuna asta»)")
    else:
        pr = [f"{x.get('quando') or x.get('giorno')} {x.get('scadenza')}" + (f" {_it(x['importo_mld'], 0)} mld $" if x.get("importo_mld") else "")
              + (" (riapertura)" if x.get("riapertura") else "") for x in a.get("prossime") or []]
        co = [f"{x.get('data')} {x.get('scadenza')} al {_it(x.get('rendimento'), 3)}%, domanda/offerta {_it(x.get('copertura'), 2)}"
              + (f" (prima {_it(x['precedente']['copertura'], 2)})" if (x.get("precedente") or {}).get("copertura") else "")
              for x in a.get("concluse") or []]
        L.append(f"  ASTE DEL TESORO (note e bond, {a.get('finestra')} giorni): "
                 + ("prossime " + " · ".join(pr) if pr else ("nessuna annunciata" if a.get("calendario") == "ok"
                                                             else f"calendario {a.get('calendario')}"))
                 + (" · concluse " + " · ".join(co) if co else ""))
    # ── Europa, cambio, Giappone
    bce, cb, ca = m.get("bce") or {}, (libro or {}).get("cambio") or {}, m.get("carry") or {}
    eu = [f"BCE {_it(bce['tasso_rifinanziamento'], 2)}% ({_gm(bce.get('data'))})" if bce.get("tasso_rifinanziamento") is not None
          else "BCE: dato non disponibile"]
    an = cb.get("anno") or {}
    if cb.get("fx") is not None:
        eu.append(f"EUR/USD {_it(cb['fx'], 4)} ({cb.get('fonte') or 'n.d.'})"
                  + (f", {an.get('percentile')}° percentile dell'anno (minimo {_it(an['minimo'][1], 4)} il {_gm(an['minimo'][0])}, "
                     f"massimo {_it(an['massimo'][1], 4)} il {_gm(an['massimo'][0])})" if an.get("minimo") else "")
                  + (f" · un euro piu' forte dell'1% toglie {_it(-cb['euro_piu_forte'], 0)} € al libro" if cb.get("euro_piu_forte") else ""))
    bm = [x for x in ca.get("boj_meetings") or [] if x >= oggi.isoformat()]
    eu.append("Banca del Giappone: " + (f"prossima decisione {_gm(bm[0])}" if bm else "prossima decisione: dato non disponibile")
              + (f", tasso {_it(ca['boj_rate'], 2)}%" if ca.get("boj_rate") is not None
                 else f", tasso: dato non disponibile (ultimo del {_data(ca.get('boj_rate_date'))})" if ca.get("boj_rate_date") else "")
              + (f" · spread Treasury-JGB a 10 anni {_it(ca['spread'], 2)} punti" if ca.get("spread") is not None else "")
              + (f" · USD/JPY {_it(ca['usdjpy'], 1)} ({_sg(ca.get('usdjpy_chg_1m'), 1)}% a un mese)" if ca.get("usdjpy") else ""))
    L.append("  EUROPA E GIAPPONE: " + " · ".join(eu))
    # ── il calendario del mercato: scadenze, stagionalita', calendario fiscale
    ca2 = []
    mens = (pos or {}).get("mensile")
    if mens and mens.get("data"):
        ca2.append(f"mensile delle opzioni {_gm(mens['data'])}" + (" (trimestrale)" if mens.get("trimestrale") else ""))
    wt = m.get("witching") or {}
    if wt.get("next"):
        ca2.append(f"«tre streghe» {_gm(wt['next'])}")
    sn = ((ind or {}).get("stagionalita_ndx") or {}).get("mesi") or []
    mese = datetime.fromisoformat(oggi.isoformat()).month
    for mm in (mese, mese % 12 + 1):
        x = next((y for y in sn if y.get("mese") == mm), None)
        if x:
            ca2.append(f"Nasdaq-100 a {MESI_IT[mm - 1]}: media {_sg(x.get('media'), 1)}% su {x.get('n')} anni"
                       + (f", negli anni di meta' mandato {_sg(x.get('media_mid'), 1)}% ({x.get('pos_mid')}% positivi su {x.get('n_mid')})"
                          if x.get("media_mid") is not None else ""))
    fa = (rot or {}).get("fine_anno") or {}
    if fa.get("attivo"):
        perd = sorted([v for v in fa.get("voci") or [] if v.get("anno_pct") is not None and v["anno_pct"] < 0
                       and v.get("ruolo") == "posizione"], key=lambda v: v["anno_pct"])
        ca2.append(f"calendario fiscale di fine anno {fa.get('anno')}: posizioni in perdita sull'anno "
                   + (", ".join(f"{v['tk']} {_sg(v['anno_pct'], 0)}%" for v in perd) if perd else "nessuna")
                   + " (dove la vendita per le minusvalenze e' misurata: i piccoli; sui grandi e' rumore — LIBRO.md §1ter)")
    L.append("  CALENDARIO: " + (" · ".join(ca2) if ca2 else "dato non disponibile"))
    # ── bitcoin e grandi operatori (il Nasdaq della CFTC e' nella luce dei flussi)
    b = (pos or {}).get("bitcoin")
    cr = []
    if b and b.get("var") is not None:
        cr.append(f"bitcoin {_sg(b['var'], 1)}% dalla campana della seduta del {_gm(b.get('seduta'))}"
                  + (f" → MSTR equivalente {_sg(b['mstr_equivalente'], 1)}% (beta su IBIT {_it(b.get('beta'), 2)}, R² {_it(b.get('r2'), 2)})"
                     if b.get("mstr_equivalente") is not None else ""))
    else:
        cr.append(f"bitcoin: {(pos or {}).get('bitcoin_errore') or 'non letto'}")
    for v in ((pos or {}).get("cot") or {}).values():
        if not isinstance(v, dict) or str(v.get("nome", "")).startswith("Nasdaq"):
            continue
        lev = (v.get("categorie") or {}).get("lev")
        if lev:
            cr.append(f"{v['nome'].split(' (')[0]}: fondi a leva {_sg(lev['pct'], 1)}% ({lev.get('rango')}° percentile)"
                      + (" — corto in parte di base (lunghi sull'ETF o sul titolo), non solo scommessa al ribasso"
                         if v["nome"].startswith(("Bitcoin", "Treasury")) else ""))
    L.append(f"  CRIPTO E GRANDI OPERATORI (CFTC al {_gm(next((v.get('data') for v in ((pos or {}).get('cot') or {}).values() if isinstance(v, dict)), None))}): "
             + " · ".join(cr))
    return L


def notizie_forum(brief_g, pos, libro):
    """Le notizie macro piu' recenti, la cronaca di mercato, le fonti mute o non lette, e il forum (attenzione, non
    fatti: v451). Tre esiti per ogni fonte (v389)."""
    L, b = [], brief_g or {}
    if not b:
        L.append("  notizie: brief.json non scritto in questo giro — dato non disponibile")
    else:
        mac = b.get("macro") or []
        L.append(f"  MACRO (ultime {_it(b.get('finestra_h'), 0)} ore, {b.get('macro_totale', len(mac))} voci; "
                 + (f"non lette: {', '.join(b['macro_non_lette'])}; " if b.get("macro_non_lette") else "")
                 + (f"mute: {', '.join(b['macro_mute'])}" if b.get("macro_mute") else "tutte le fonti lette") + "):")
        import brief as _B
        prio = {nome: i for i, (nome, _u, _g) in enumerate(_B.NEWS_MACRO)}
        scelte = sorted(mac, key=lambda x: (prio.get(x.get("fonte"), 99), -_ts(x.get("quando"))))[:NOTIZIE_MACRO_MOSTRA]
        L.extend(f"    {_ora_it(x.get('quando'))} {x.get('titolo')} ({x.get('fonte')})"
                 for x in sorted(scelte, key=lambda x: -_ts(x.get("quando"))))
        if len(mac) > NOTIZIE_MACRO_MOSTRA:
            L.append(f"    … e {len(mac) - NOTIZIE_MACRO_MOSTRA} altre (le fonti curate prima delle generaliste: brief.NEWS_MACRO)")
        if not mac:
            L.append("    nessuna voce macro nella finestra")
    nw = (libro or {}).get("notizie") or {}
    import rotazione as _R
    cron = cronaca(nw)
    if cron:
        L.append(f"  CRONACA DI MERCATO (la stessa voce nel feed di almeno {_R.SOGLIA_CRONACA} posizioni: il mercato, non un "
                 "nome — nel cruscotto non si ripete): "
                 + " · ".join(f"{_ora_it(x['quando'])} {x['titolo']} ({x['n']} feed)" for x in cron[:4])
                 + (f" … e {len(cron) - 4} altre" if len(cron) > 4 else ""))
    nl = [tk for tk, x in nw.items() if x.get("stato") != "ok"]
    vu = [tk for tk, x in nw.items() if x.get("stato") == "ok" and (x.get("vuoto") or x.get("fermo_dal"))]
    if nl or vu:
        L.append("  feed dei nomi: " + (f"NON letti {', '.join(nl)}" if nl else "")
                 + ("; " if nl and vu else "") + (f"vuoti o fermi {', '.join(vu)} (lì la ricerca in rete e' obbligatoria)" if vu else ""))
    p = pos or {}
    if not p.get("wsb_letto"):
        L.append(f"  WALLSTREETBETS: NON letto ({p.get('wsb_errore') or 'nessuna risposta'}) — il dato che manca, non un forum muto")
    else:
        tit = p.get("titoli") or {}
        libro_tk = {tk for tk in tit}
        primi = " · ".join(f"{x['rango']} {x['ticker']} {x['menzioni']}" + (" ◀" if x.get("nome") in libro_tk else "")
                           for x in (p.get("wsb_primi") or [])[:WSB_MOSTRA])
        imp = [tk for tk, x in tit.items() if (x.get("wsb") or {}).get("impennata")]
        L.append(f"  WALLSTREETBETS (ApeWisdom, ultime 24 ore: {p.get('wsb_titoli')} titoli, {_it(p.get('wsb_menzioni'), 0)} menzioni; "
                 "◀ = nel libro o sorvegliato) — attenzione, non fatti: " + primi
                 + " · impennate fra i nostri nomi: " + (", ".join(imp) if imp else "nessuna"))
    return L


def _riga_tecnica(r, oggi_adesso):
    import rotazione as _R
    pz = []
    st = r.get("struttura") or {}
    if st.get("stato"):
        t = st["stato"]
        if st.get("rottura"):
            t += f", ⚠ ROTTA AL {'RIBASSO' if st['rottura'] == 'ribasso' else 'RIALZO'}"
        dop = [d for d in st.get("doppi") or [] if d.get("esito") == "confermato" and d.get("sedute_dal") is not None
               and d["sedute_dal"] <= _R.STR_RECENTE]       # la regola dei segnali d'uscita (v494): una sola
        if dop:
            t += f", doppio {dop[0]['tipo']} confermato da {dop[0]['sedute_dal']} sedute"
        if st.get("divergenze"):
            t += f", divergenza {st['divergenze'][0]['tipo']} dell'RSI"
        pz.append("struttura " + t)
    lo = _R.lettura_oscillatori(r.get("oscillatori"))
    if lo:
        pz.append(f"oscillatori {lo['stato'].lower()} ({len(lo['ipervenduto'] or lo['ipercomprato'])} su "
                  f"{len(lo['misurati'])} oltre la soglia; RSI {_it((r.get('oscillatori') or {}).get('rsi'), 0)})"
                  if lo["ipervenduto"] or lo["ipercomprato"] else
                  f"oscillatori {lo['stato'].lower()} (RSI {_it((r.get('oscillatori') or {}).get('rsi'), 0)})")
    v = r.get("volumi") or {}
    if v.get("vol_pct_seduta") is not None:
        pz.append(f"volumi {_it(v['vol_pct_seduta'], 0)}/100 (media 20 sedute {_it(v.get('vol_pct_20'), 0)}/100)"
                  + (" ⚠" if v["vol_pct_seduta"] >= VOLUMI_ALTI else ""))
    cond = _R.supporto_accumulo(r.get("pavimenti"), r.get("oscillatori"), r.get("struttura"))
    pz.append(f"base {sum(1 for c in cond if c[1] is True)}/{len(cond)} condizioni")
    mn = ((r.get("pavimenti") or {}).get("minimi") or [])
    if mn:
        pz.append(f"pavimento {_it(mn[0]['alto'], 2)} ({_sg(mn[0].get('pct'), 1)}%, {_sg(mn[0].get('atr'), 1)} ATR)")
    t = (r.get("prove") or {}).get("tendenza") or {}
    if t.get("sma200") is not None:
        pz.append(f"media 200 {_it(t['sma200'], 2)} ({_sg(t.get('d200_atr'), 1)} ATR)")
    vw = r.get("vwap") or {}
    if vw.get("vwap") is not None:
        pz.append(f"VWAP dai conti del {_gm(vw.get('comunicato'))} {_it(vw['vwap'], 2)} ({_sg(vw.get('dist_pct'), 1)}%)")
    c5 = r.get("cinque_anni") or {}
    if c5.get("posizione") is not None:
        pz.append(f"5 anni al {_it(c5['posizione'], 0)}% dell'intervallo ({_sg(c5.get('dmax_pct'), 0)}% dal massimo)")
    for mm, x in _R.stagionalita_mesi(r.get("stagionalita"), oggi_adesso)[:1]:
        if x:
            pz.append(f"{MESI_IT[mm - 1]}: media {_sg(x.get('media'), 1)}%, positivo {x.get('positivi_pct')}% su {x.get('campione')} anni")
    return " · ".join(pz) or "dato non disponibile"


def _riga_opzioni(x):
    o, g = (x or {}).get("opzioni") or {}, (x or {}).get("gamma") or {}
    if not o:
        return "nessuna catena (non e' una posizione in dollari, o la fonte non l'ha)"
    if o.get("motivo"):
        return f"catena NON letta ({o['motivo']}) — dato non disponibile"
    pz = [f"volatilita' implicita {_it(o.get('iv30'), 1)}%"]
    c = o.get("conti")
    if c and c.get("pct") is not None:
        pz.append(f"ai conti del {_gm(c.get('data_conti'))} ±{_it(c['pct'], 1)}% (scadenza {_gm(c.get('data'))})")
    mz = o.get("mensile") or {}
    if mz.get("pct") is not None:
        pz.append(f"alla mensile ±{_it(mz['pct'], 1)}%" + (f", max pain {_it(mz['max_pain'], 2)} ({_sg((mz['max_pain'] / o['spot'] - 1) * 100, 1)}%)"
                                                            if mz.get("max_pain") and o.get("spot") else ""))
    pz.append(f"put/call {_it(o.get('pc_vol'), 2)} sui volumi, {_it(o.get('pc_oi'), 2)} sull'open interest")
    if g.get("netta") is not None:
        pz.append(f"gamma dei dealer {'POSITIVA (smorza)' if g['netta'] > 0 else 'NEGATIVA (amplifica)'}"
                  + (f", cambio di regime {_it(g['flip'], 2)} ({_sg((g['flip'] / g['spot'] - 1) * 100, 1)}%)" if g.get("flip") and g.get("spot") else "")
                  + (f", call wall {_it(g['call_wall'], 2)} · put wall {_it(g['put_wall'], 2)}" if g.get("call_wall") and g.get("put_wall") else ""))
    return " · ".join(pz)


def _riga_flussi(r, x):
    import schede_progetto as SP
    pz = []
    si = (r or {}).get("short_interest") or {}
    if si.get("stato") == "misurato":
        p = si.get("pct_flottante")
        pz.append((f"short {_it(p, 1)}% del flottante ({SP.banda_short(p)})" if p is not None else "short: quota del flottante n.d.")
                  + (f", {_sg((si.get('var1') or {}).get('pct'), 0)}% sul regolamento prima" if (si.get("var1") or {}).get("pct") is not None else "")
                  + (f", {si['rango']}° percentile dell'anno" if si.get("rango") is not None else "")
                  + (" ⚠" if (p or 0) >= SP.SI_ALTA or (si.get("rango") or 0) >= SP.SI_RANGO_ALTO else ""))
    else:
        pz.append("short: non misurato" + (f" ({si.get('stato')})" if si.get("stato") else ""))
    dp = (x or {}).get("dark_pool") or {}
    if dp.get("dpi") is not None:
        pz.append(f"dark pool {_it(dp['dpi'], 0)}% ({dp.get('rango', 'n.d.')}°), media 10 sedute {_it(dp.get('media'), 0)}% "
                  f"({dp.get('rango_media', 'n.d.')}°)")
    if "wsb" in (x or {}):
        w = x["wsb"]
        pz.append("forum: fuori dai titoli citati" if w is None else
                  f"forum {w['rango']}° con {_conta(w['menzioni'], 'menzione', 'menzioni')}"
                  + (f" (24 ore prima {w['prima']})" if w.get("prima") is not None else " (24 ore prima fuori elenco)")
                  + (" ⚠ IMPENNATA" if w.get("impennata") else ""))
    return " · ".join(pz)


def _riga_credito(r, debito_sec):
    import credito as CR
    import schede_progetto as SP
    pz = []
    c = (r or {}).get("cds") or {}
    if c.get("stato") == "quotato":
        f5, f21 = c.get("finestra5") or {}, c.get("finestra") or {}
        pz.append(f"CDS 5 anni {_it(c.get('pb'), 0)} pb ({_gm(c.get('data'))})"
                  + (f", {_sg(f5['eccesso_pct'], 1)}% in 5 giorni al netto dell'indice" if f5.get("stato") == "misurato" else "")
                  + (f", {_sg(f21['eccesso_pct'], 1)}% in 21" if f21.get("stato") == "misurato" else
                     " (mese: storico corto)" if f21.get("stato") == "storico corto" else ""))
    elif c.get("stato") == "assente":
        pz.append("CDS non compensato")
    else:
        pz.append(f"CDS: {c.get('stato') or 'non classificato'}")
    a = CR.altman_rischio(r)
    if a.get("stato") == "ok":
        pz.append(f"Altman {_it(a['z'], 2)} ({a['zona']}, rating equivalente {a['bre']})")
    else:
        pz.append(f"Altman {a.get('stato')}")
    op = CR.stato_operativo((r or {}).get("combustione"))
    if op:
        pz.append(op.lower())
    seg = CR.segnali(r, ((debito_sec or {}).get("per_titolo") or {}).get((r or {}).get("ticker")),
                     SP.liquidita_societa((r or {}).get("combustione")))
    if seg:
        pz.append("⚠ " + "; ".join(testo_segnale(tp, t).split(" (")[0] if tp == "evento" else testo_segnale(tp, t)
                                   for tp, t in seg))
    return " · ".join(pz)


def _perc0(x):
    """Una frazione in percentuale intera, col segno sul valore GIA' arrotondato: «-0%» non si stampa (v496)."""
    if x is None:
        return "n.d."
    v = round(x * 100)
    return f"{'-' if v < 0 else ''}{_it(abs(v), 0)}%"


def _fra(giorni):
    """0 e 1 non si scrivono in cifre (v458): «fra 0 giorni» si legge oggi, «fra 1 giorni» non e' italiano."""
    return "OGGI" if giorni == 0 else "DOMANI" if giorni == 1 else f"fra {giorni} giorni"


def _riga_fondamentali(r, riga_tenuta, conc):
    import schede_progetto as SP
    pz, pr = [], (riga_tenuta or {}).get("prove") or {}
    ut = SP.ultimo_trimestre(r or {})
    if ut and ut.get("yoy") is not None:
        pz.append(f"ricavi {_sg(ut['yoy'], 1)}% sull'anno (trimestre al {_gm(ut['trim'])})")
    sm = pr.get("stime") or {}
    if sm.get("ora") is not None and sm.get("prima") is not None:
        dirz = ("in salita" if sm["ora"] > sm["prima"] else "in discesa" if sm["ora"] < sm["prima"] else "ferma")
        pz.append(f"utile atteso {_it(sm['prima'], 2)} → {_it(sm['ora'], 2)} a 90 giorni ({dirz})")
    rv = pr.get("revisioni") or {}
    if rv.get("su") is not None:
        pz.append(f"revisioni 30 giorni {rv['su']} su / {rv.get('giu')} giu'")
    p = SP.peg_esercizio(r)
    if p and p.get("peg") is not None:
        pz.append(f"P/E prospettico {_it(p['pe1'], 1)}× · PEG {_it(p['peg'], 2)}" + (" (distorto)" if p.get("distorto") else ""))
    elif p and p.get("motivo"):
        pz.append({"perdita": "utile negativo: nessun P/E ne' PEG", "non cresce": f"P/E prospettico {_it(p.get('pe1'), 1)}×, il consenso non cresce",
                   "manca": "PEG: consenso dell'esercizio in corso assente"}.get(p["motivo"], p["motivo"]))
    rd = (r or {}).get("rendimento") or {}
    if rd.get("roic") is not None or rd.get("roe") is not None:
        pz.append(f"ROIC {_perc0(rd.get('roic'))} · ROE {_perc0(rd.get('roe'))} (12 mesi al {_gm(rd.get('al'))})")
    az = SP.azioni_di(r) or {}
    va = (az.get("var_anno") or {}).get("pct")
    if va is not None:
        pz.append(f"azioni {_sg(va, 1)}% in un anno" + (" ⚠" if va >= SP.AZ_DILUIZIONE_FORTE else ""))
    cs = (riga_tenuta or {}).get("consenso") or {}
    if cs.get("mediana") is not None:
        pz.append(f"target mediano {_sg(cs['mediana'], 0)}%")
    for mm in ((conc or {}).get("mercati") or [])[:1]:
        if mm.get("tipo") == "nessuna":
            pz.append(f"{mm.get('mercato')}: nessuna quota pubblica")
        elif mm.get("quota"):
            pr1 = mm.get("primo") or {}
            pz.append(f"{mm.get('mercato')} {mm['quota']}" + ("" if pr1.get("e_lui") or not pr1 else f" (primo {pr1.get('nome')} {pr1.get('quota')})")
                      + (" ⚠ da riverificare" if mm.get("da_riverificare") else ""))
    return " · ".join(pz) or "dato non disponibile"


def cronaca(notizie):
    """Le voci nel feed di almeno rotazione.SOGLIA_CRONACA posizioni: cronaca di mercato (v451, v500), la stessa regola
    del blocco NOTIZIE ULTIMISSIME. [{titolo, quando, n}] dalla piu' recente."""
    import rotazione as _R
    chi = {}
    for tk, nw in (notizie or {}).items():
        if (nw or {}).get("stato") != "ok":
            continue
        for v in nw.get("voci") or []:
            k = str(v.get("titolo") or "").strip().lower()
            chi.setdefault(k, {"titolo": v.get("titolo"), "quando": v.get("quando"), "tk": set()})["tk"].add(tk)
    out = [{"titolo": x["titolo"], "quando": x["quando"], "n": len(x["tk"])} for x in chi.values()
           if len(x["tk"]) >= _R.SOGLIA_CRONACA]
    return sorted(out, key=lambda x: -_ts(x["quando"]))


def _riga_notizie(nw, escluse=()):
    nw = nw or {}
    if nw.get("stato") != "ok":
        return f"feed NON letto ({nw.get('stato') or 'non richiesto'}) — non vuol dire «nessuna notizia»"
    if nw.get("vuoto") or nw.get("fermo_dal"):
        return "feed vuoto o fermo: la ricerca in rete e' obbligatoria"
    tutte = nw.get("voci") or []
    voci = [v for v in tutte if str(v.get("titolo") or "").strip().lower() not in escluse]
    if not voci:
        return ("solo cronaca di mercato nelle ultime 72 ore (sopra, nel blocco delle notizie)" if tutte
                else "nessuna voce nelle ultime 72 ore")
    altre = len(voci) - NOTIZIE_NOME_MOSTRA
    return (" · ".join(f"{_ora_it(v.get('quando'))} {v.get('titolo')}" for v in voci[:NOTIZIE_NOME_MOSTRA])
            + (f" (e altre {altre})" if altre > 0 else ""))


def cruscotto(libro, pos, conc, righe_wl, debito_sec, mp, adesso):
    """Il cruscotto di ogni POSIZIONE, dal peso piu' alto: sei famiglie, ciascuna in una riga, coi valori degli
    strumenti che li calcolano (v161). ⚠ dove una convenzione gia' dichiarata scatta (rottura, volumi dal 90°, short
    alta, impennata, segnali di credito, diluizione forte): un segnale, non un punteggio (v200)."""
    caselle = {x["tk"]: c for c, xs in (mp or {}).items() for x in xs}
    sc = {s["tk"]: s for s in ((libro or {}).get("attesa") or {}).get("scadenze") or []}
    righe = sorted(((libro or {}).get("tenuta") or {}).get("righe") or [], key=lambda r: -(r.get("peso") or 0))
    nw = (libro or {}).get("notizie") or {}
    escluse = {str(x["titolo"] or "").strip().lower() for x in cronaca(nw)}
    L = []
    for r in righe:
        tk = r["tk"]
        s = sc.get(tk) or {}
        c = caselle.get(tk)
        L.append(f"  {tk} {_it((r.get('peso') or 0) * 100, 1)}% · {NOME_CASELLA[c] if c else 'n.d.'} · tenuta {r.get('esito')}"
                 + (" (provvisorio)" if r.get("provvisorio") else "")
                 + (f" · 📅 conti {_gm(s['data'])}, {_fra(s['giorni'])}" + (f" ({s['orario']})" if s.get("orario") else "")
                    if s.get("data") and s.get("giorni") is not None else ""))
        rw = (righe_wl or {}).get(tk)
        x = ((pos or {}).get("titoli") or {}).get(tk)
        L.append("      tecnica: " + _riga_tecnica(r, adesso))
        L.append("      opzioni: " + _riga_opzioni(x))
        L.append("      flussi e forum: " + _riga_flussi(rw, x))
        L.append("      credito: " + (_riga_credito(rw, debito_sec) if rw else "riga della pipeline assente: dato non disponibile"))
        L.append("      fondamentali: " + (_riga_fondamentali(rw, r, (conc or {}).get(tk)) if rw else "dato non disponibile"))
        L.append("      notizie: " + _riga_notizie(nw.get(tk), escluse))
    return L


# ── la resa ───────────────────────────────────────────────────────────────────────────────────────────────────────
def resa(libro, lc, mp, camb, base, ev, liv, ing, sett, rot, motivi, adesso, nuove=None):
    roma = adesso.astimezone(ROMA)
    sem = (libro or {}).get("semaforo") or {}
    L = [f"SINTESI OPERATIVA (v525) — {roma:%d/%m/%Y %H:%M} ora italiana · ultima seduta conclusa "
         f"{_data((libro or {}).get('fine'))} · " + (f"confronto con l'analisi del "
         f"{datetime.fromisoformat(base['quando']).astimezone(ROMA):%d/%m %H:%M}" if base else "primo giro del registro")]
    for m in motivi:
        L.append(f"  ⚠ NON DISPONIBILE: {m} — le luci che ne dipendono sono ⚪, non calcolate su dati vecchi")
    L.append("")
    L.append("1 · IL REGIME — sei famiglie, ognuna fatta di piu' dati; colori = convenzioni (LIBRO.md §1quattuordecies), "
             "non un punteggio: le luci non si sommano · 🟢 favorevole · 🟡 neutro · 🟠 sfavorevole · 🔴 in tensione · ⚪ non misurata")
    for k, nome in FAMIGLIE:
        x = lc[k]
        f = freccia((base or {}).get("luci", {}).get(k), x["colore"]) if base else "nuova"
        L.append(f"  {x['colore']} {nome} — {NOMI_COLORE[x['colore']]}" + (f": {x['perche']}" if x.get("perche") else "")
                 + ("" if f in ("=", "nuova") else f" ({f})"))
        L.append("      " + " · ".join(x["dati"]))
    L.append("")
    nv = nuove or {}
    L.append("2 · IL QUADRO MACRO, INTERO — cio' che le luci non portano: ogni dato con la sua data e la prossima uscita "
             "dichiarata dalla fonte, mai proiettata (v396); i numeri delle luci qui sopra non si ripetono")
    L.extend(nv.get("macro") or ["  dato non disponibile: il quadro macro non e' stato calcolato in questo giro"])
    L.append("")
    L.append("3 · NOTIZIE E FORUM — i fatti dalle fonti, il forum come attenzione (i post non sono una fonte di fatti, v451)")
    L.extend(nv.get("notizie") or ["  dato non disponibile: notizie e forum non calcolati in questo giro"])
    L.append("")
    ris = (libro or {}).get("rischio") or {}
    sv = (libro or {}).get("salvavita") or {}
    pi = (libro or {}).get("piano") or {}
    at = (libro or {}).get("attesa") or {}
    cr = (libro or {}).get("credito") or {}
    tw = ((libro or {}).get("registro") or {}).get("twr") or {}
    b1, b21 = (libro or {}).get("bench") or {}, (libro or {}).get("bench_21") or {}
    bq = (ris.get("beta_libro") or {}).get("QQQ") or [None, None]
    L.append("4 · IL LIBRO NEL REGIME")
    L.append(f"  semaforo {sem.get('colore', 'n.d.').upper()} (" + ", ".join(sem.get("accesi") or []) + ")"
             + (f" · salvavita {_pct(sv.get('calo'), 2)} dal massimo del {_gm(sv.get('massimo'))}, scatta a {_pct(sv.get('soglia'), 0)}"
                f" (un altro {_pct(sv.get('ulteriore'))})" if sv.get("stato") == "misurato" else " · salvavita non misurato")
             + (f" · se scattasse: vendita di {_it(pi.get('venduto'), 0)} $, imposta ~{_it(pi.get('imposta'), 0)} $"
                if pi.get("venduto") else ""))
    L.append(f"  esposizione: semiconduttori {_quota(pi.get('peso_semi_prima'))} dell'azionario · beta su QQQ "
             f"{_it(bq[0], 2)} (R² {_it(bq[1], 2) if len(bq) > 1 else 'n.d.'}) · scommesse effettive {_it(ris.get('scommesse_eff'), 1)} · "
             f"volatilita' {_quota(ris.get('vol_ann'))}")
    L.append(f"  risultato: ultima seduta {_pct((libro or {}).get('ret_libro'), 2)} (QQQ {_pct(b1.get('QQQ'), 2)}) · 21 sedute "
             f"{_pct((libro or {}).get('ret_21'))} (QQQ {_pct(b21.get('QQQ'))}, SMH {_pct(b21.get('SMH'))})"
             + (f" · dal {_gm(tw.get('dal'))} {_pct(tw.get('libro'), 2)} (QQQ {_pct(tw.get('qqq'), 2)})" if tw.get("libro") is not None else ""))
    L.append(f"  costo dell'attesa: ±{_it(at.get('seduta_1s'), 0)} $ a seduta · ±{_it(at.get('settimana_1s'), 0)} $ a settimana · "
             f"seduta cattiva -{_it(at.get('var_usd'), 0)} $ · media delle peggiori -{_it(at.get('es_usd'), 0)} $")
    if cr.get("misurabile"):
        L.append(f"  credito sul libro: chi brucia cassa {_quota(cr.get('peso_dipendenti'))} dell'azionario · conferma "
                 f"{'ACCESA' if cr.get('arrivato_al_libro') else 'spenta'} "
                 f"({sum(1 for v in (cr.get('condizioni') or {}).values() if v)} condizioni su {len(cr.get('condizioni') or {})})")
    fl = lc["flussi"]["colore"]
    semi = pi.get("peso_semi_prima")
    if fl in ("🟠", "🔴") and semi is not None and semi >= 0.5:
        L.append(f"  incrocio regime × libro: i FLUSSI vanno contro i semiconduttori ({fl}) e il libro ne ha {art('il', _quota(semi))} — "
                 "il regime va CONTRO la concentrazione: un ingresso nella stessa scommessa aggiunge al lato contro cui va il "
                 "denaro (non e' una vendita: dal 15/10 non si vende sui ribassi)")
    elif fl == "🟢" and semi is not None and semi >= 0.5:
        L.append(f"  incrocio regime × libro: i FLUSSI vanno verso i semiconduttori e il libro ne ha {art('il', _quota(semi))} — il "
                 "regime va A FAVORE della concentrazione")
    else:
        L.append("  incrocio regime × libro: i flussi non spingono in nessuno dei due versi")
    L.append("")
    L.append("5 · LA MAPPA — tesi × prezzo, dalla tenuta (LIBRO.md §1sexies): prezzo ROTTO = chiusura sotto la media a 200 "
             "con la 50 sotto la 200 · tesi FORTE = almeno una prova di crescita a favore (ricavi, stime o revisioni) · "
             f"📅 conti entro {EVENTO_GIORNI} giorni · ⚠ allarme di credito o diluizione")
    for c in CASELLE:
        xs = mp.get(c) or []
        if not xs and c[0] == "nm":
            continue
        voce = " · ".join(f"{x['tk']} {_it((x['peso'] or 0) * 100, 1)}%" + (f" 📅{x['conti']}g" if x["conti"] is not None else "")
                          + (" ⚠" if x["allarmi"] else "") + (" (provvisorio)" if x["provvisorio"] else "") for x in xs)
        L.append(f"  {NOME_CASELLA[c]}: {voce or 'nessuno'}")
        if xs:
            L.append(f"      → {AZIONE_CASELLA[c]}")
    es = {}
    for xs in mp.values():
        for x in xs:
            es.setdefault(x["esito"], []).append(x["tk"])
    L.append("  esiti della tenuta: " + " · ".join(f"{e} {', '.join(es[e])}" for e in NL.ESITI if e in es))
    al = [(x["tk"], x["allarmi"]) for xs in mp.values() for x in xs if x["allarmi"]]
    if al:
        L.append("  ⚠ allarmi: " + " · ".join(f"{tk}: {'; '.join(a)}" for tk, a in al))
    L.append("")
    L.append("6 · IL CRUSCOTTO DI OGNI POSIZIONE — sei famiglie per nome, dal peso piu' alto: tecnica, opzioni, flussi e "
             "forum, credito, fondamentali, notizie; ogni numero e' quello dello strumento che lo calcola (v161) · ⚠ dove "
             "scatta una convenzione gia' dichiarata (rottura della struttura, volumi dal 90° percentile, short alta, "
             "impennata sul forum, segnali di credito, diluizione forte): un segnale, non un punteggio (v200)")
    L.extend(nv.get("cruscotto") or ["  dato non disponibile: il cruscotto non e' stato calcolato in questo giro"])
    L.append("")
    L.append("7 · COSA E' CAMBIATO")
    L.extend(f"  {x}" for x in camb)
    L.append("")
    L.append(f"8 · L'AGENDA — i prossimi {AGENDA_GIORNI} giorni (le date le dichiarano le fonti, mai proiettate)")
    L.extend(f"  {_data(d)} {t}" for d, t in ev) if ev else L.append("  nessun evento dichiarato")
    if liv:
        L.append(f"  livelli entro {_it(LIVELLO_ATR, 0)} ATR dal prezzo (punti di decisione vicini):")
        L.extend(f"    {x}" for x in liv)
    L.append("")
    L.append("9 · LE AZIONI DELLE REGOLE, e la liquidita'")
    pi_r = (rot or {}).get("piano") or {}
    pat = pi_r.get("patrimonio") or {}
    if pi_r.get("liquidita") is not None and pat.get("totale"):
        L.append(f"  liquidita' {_it(pi_r['liquidita'], 0)} € ({_it(pi_r['liquidita'] / pat['totale'] * 100, 1)}% del patrimonio)")
    if ing:
        L.append(f"  ingressi DENTRO la zona che diversificano, senza conti entro {EVENTO_GIORNI} giorni, per riduzione della "
                 "volatilita' del libro (5.000 € come unita' di calcolo, non una quantita'):")
        for v in ing:
            c = v["conseguenze"]
            L.append(f"    {v['tk']} {_it(v['px'], 2)} · corr {_it(v.get('corr'), 2)} · volatilita' del libro {_sg(c['dvol'], 2)} punti"
                     + (f" · stop {_it(v['stop'], 2)}: {_it(-v['perdita_eur'], 0)} € ogni 5.000 €" if v.get("perdita_eur") is not None else ""))
    else:
        L.append("  nessun ingresso dentro la zona che diversifichi e non abbia i conti vicini")
    if sett:
        L.append(f"  settori in tendenza con correlazione col libro sotto {_it(SETTORI_CORR, 1)}: "
                 + " · ".join(f"{s['nome']} ({s['etf']}, 1m {_sg(s.get('m1'), 1)}%, corr {_it(s['corr_libro'], 2)})" for s in sett))
    L.append("  (le azioni per casella sono nella mappa; il giudizio — come muoversi — lo scrive la risposta, con le domande)")
    return L


def registra(foto, motivi, percorso=REGISTRO, env=None):
    """(scritto, perche'). La fotografia si aggiunge solo da un giro COMPLETO — con un file mancante le luci ⚪ farebbero
    leggere al confronto dopo un cambiamento che non c'e' stato — e mai dalle suite (TRADING_FONTI_TITOLI=spenta)."""
    env = os.environ if env is None else env
    if motivi:
        return False, "un file del giro manca: " + "; ".join(motivi)
    if env.get("TRADING_FONTI_TITOLI") == "spenta":
        return False, "suite in corso"
    try:
        with open(percorso, "a", encoding="utf-8") as f:
            f.write(json.dumps(foto, ensure_ascii=False) + "\n")
        return True, None
    except OSError as e:
        return False, f"{type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--registra", action="store_true", help="aggiunge la fotografia di questa analisi a memoria/registro_analisi.jsonl")
    ap.add_argument("--cartella", default=str(GIRO))
    a = ap.parse_args()
    adesso = datetime.now(timezone.utc)
    giro, motivi = {}, []
    for n in STRUMENTI_GIRO:
        giro[n], m = leggi_giro(n, a.cartella, adesso)
        if m:
            motivi.append(m)
    try:
        d = json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    except (OSError, ValueError):
        d = {}
    import fonti_dirette
    import fonti_titoli
    d = fonti_titoli.carica(d)
    scelta = fonti_dirette.del_giro(d)["scelta"]
    macro = d.get("macro") or {}
    libro = giro["libro"] or {}
    lc = luci(libro, giro["indici"], giro["posizionamento"], scelta, macro.get("fedwatch"))
    righe_wl = {r["ticker"]: r for r in (d.get("watchlist") or []) if isinstance(r, dict) and r.get("ticker")}
    tks = [r["tk"] for r in (libro.get("tenuta") or {}).get("righe") or []]
    mp = mappa(libro.get("tenuta"), (libro.get("attesa") or {}).get("scadenze"), allarmi(righe_wl, tks, macro.get("debito_sec")))
    seduta = libro.get("fine")
    reg = leggi_registro()
    base = base_confronto(reg, seduta)
    foto = fotografia(adesso, seduta, (libro.get("semaforo") or {}).get("colore"), lc, mp)
    camb = cambiamenti(base, foto)
    oggi = adesso.astimezone(ZoneInfo("America/New_York")).date()
    ev = agenda(libro, macro.get("fedwatch"), giro["posizionamento"], oggi, macro.get("calendario_uscite"),
                (giro["brief"] or {}).get("aste"))
    nuove = {"macro": quadro_macro(macro, scelta, libro, giro["indici"], giro["posizionamento"], giro["brief"],
                                   giro["rotazione"], d.get("predictions"), oggi),
             "notizie": notizie_forum(giro["brief"], giro["posizionamento"], libro),
             "cruscotto": cruscotto(libro, giro["posizionamento"], giro["concorrenti"], righe_wl, macro.get("debito_sec"),
                                    mp, adesso)}
    print("\n".join(resa(libro, lc, mp, camb, base, ev, livelli(libro), ingressi(giro["rotazione"]),
                         settori(giro["rotazione"]), giro["rotazione"], motivi, adesso, nuove=nuove)))
    if a.registra:
        scritto, perche = registra(foto, motivi)
        print(f"\nregistro delle analisi: fotografia aggiunta a memoria/{REGISTRO.name} ({len(reg) + 1} analisi)" if scritto
              else f"\nregistro delle analisi: NON scritto — {perche}")


if __name__ == "__main__":
    main()
