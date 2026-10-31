#!/usr/bin/env python3
"""FONTI PER TITOLO — i dati per titolo che portava solo la pipeline, letti ALLA FONTE all'ora dell'analisi (v512).

Uso:  python3 scripts/fonti_titoli.py
      (stampa il blocco DATI PER TITOLO e scrive la lettura che gli altri strumenti riusano; scripts/analisi.py lo
      esegue PRIMA di tutti gli altri, insieme a fonti_dirette.py)

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il CEO, 25/10/2026, testuale: *"target degli analisti, FedWatch, storico dei CDS, vendite allo scoperto, bilanci SEC
della pipeline se non sono aggiornati (non so ogni quanto si aggiornano) trovali altrove anche attraverso news; dati
non aggiornati non sono affidabili come per esempio errore stagionalità, non voglio avere mai errori simili fanno danni
sull'analisi"*.

La v511 aveva tolto dalla coda del cron le serie macro, e DICHIARATO che i dati per titolo non si trovavano altrove:
«Yahoo risponde 429 da qui». Rimisurato il 25/10/2026 invece che ricordato: Yahoo risponde (59 titoli in 4 secondi), e
con lui i future Fed Funds per esteso; ICE e FINRA rispondevano gia'. Una conclusione «non disponibile» si rimisura
quando la domanda torna (v497).

Cosa fa, e con QUALI funzioni — sempre quelle della pipeline, perche' la stessa domanda alla stessa fonte dia la stessa
risposta nei due posti (v161):
  · RIGHE INTERE (v519, opzione B scelta dal CEO il 30/10/2026): update_data.fetch_symbol per ogni riga della pipeline,
    con gli stessi argomenti e lo snapshot del run come «run precedente»; prezzo, tecnica, multipli, conti, combustione,
    solidita', flottante e sensibilita' ai canali arrivano cosi' da adesso. Una riga piu' povera della pipeline (una
    chiamata di Yahoo rifiutata) si rilegge una volta; un campo stabile che resta piu' povero vale quello del run,
    DICHIARATO. Controvalore, guadagno e forza relativa a un mese si rifanno; correlazioni, beta sul Nasdaq-100 e
    contributo al rischio restano del run (si calcolano sui titoli insieme). Misurato: 67 righe in 33-56 s.
  · ANALISTI (Yahoo): update_data.analisti_da, per ogni posizione e sorvegliato. Vince la lettura di adesso; un titolo
    per cui Yahoo non restituisce niente tiene la pipeline, DICHIARATO.
  · FEDWATCH (future Fed Funds per esteso via Yahoo, EFFR della NY Fed): update_data.fedwatch_da, la catena delle
    riunioni (v477).
  · CDS (ICE): si legge l'ultimo giorno; se per qualche nome o indice ICE ha un giorno PIU' RECENTE della pipeline, le
    misure si rifanno con update_data.aggiorna_cds su una COPIA dello storico (memoria/dati/, fuori dal repo) e coi
    rendimenti del titolo letti adesso. E il giorno che lo storico del repo non ha si CONSERVA in
    memoria/cds_sessione.jsonl, che la pipeline unisce al proprio storico al run dopo: ICE pubblica solo l'ultimo giorno,
    e un giorno che nessuno raccoglie e' perso per sempre (v497, v508 — il 21/10 e' andato perso cosi').
  · VENDITE ALLO SCOPERTO (FINRA): se FINRA ha pubblicato un regolamento PIU' RECENTE di quello della pipeline, le
    misure si rifanno con update_data.aggiorna_short.
  · SEC EDGAR (v522, consenso del CEO del 31/10/2026 a mandare il contatto della pipeline): update_data.sec_edgar_da, la
    STESSA funzione del run — calendario dei risultati (8-K 2.02), ore dei depositi, storia della quotazione e voci dei
    bilanci (debito, scadenze, derivati: companyfacts) — con la stessa intestazione (update_data.SEC_UA). La cache del
    debito della sessione (memoria/dati/debito_sec_sessione.json) parte da quella del repo: companyfacts si legge solo
    per un 10-Q/10-K che nessuno dei due ha ancora letto, senza il tetto di dieci per run. Misurato il 31/10/2026: 54
    bilanci, 30 secondi, uscita IDENTICA a quella del run. Se SEC non risponde, le date dei 10-Q e 10-K si prendono da
    Yahoo (sec_filings), DICHIARATO: un ripiego, non una seconda derivazione.
  · COMPOSIZIONE DEGLI ETF (v522): update_data.prime_etf, le prime cinque partecipazioni di ciascun ETF della rotazione
    come l'emittente le dichiara. Senza macro.tilt nel run, le righe si costruiscono da update_data.SECTOR_ETF.
⚠ UNA LETTURA PER ANALISI: memoria/dati/fonti_titoli.json (ignorata da git), riusata per TRENTA minuti da chi carica
  data.json (carica): due strumenti che leggessero lo stesso titolo in due momenti potrebbero vederne due consensi.
⚠ VINCE LA PIU' RECENTE: un CDS o un regolamento della pipeline piu' avanti di quello letto restano quelli della
  pipeline — l'ultimo dato ufficiale, da qualunque parte arrivi (v396).
⚠ QUANDO NEMMENO LA FONTE E' AGGIORNATA (i conti di un 10-Q che Yahoo non ha ancora, un regolamento che il calendario di
  FINRA dichiara pubblicato e l'API no) lo strumento lo scrive in DA CERCARE IN RETE, e la risposta lo cerca nelle
  notizie con fonte e data (memoria/FORMATO_ANALISI.md, [freschezza]).
⚠ NON E' UN GIUDIZIO: sposta l'ora del dato, non la sua lettura. Le regole che leggono analisti, CDS e short restano
  quelle di prima.
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

RADICE = Path(__file__).resolve().parent.parent
CACHE = RADICE / "memoria" / "dati" / "fonti_titoli.json"
DEBITO_SESSIONE = RADICE / "memoria" / "dati" / "debito_sec_sessione.json"     # v522 — fuori dal repo, come la lettura
STORIA_COPIA = RADICE / "memoria" / "dati" / "cds_storia_copia.jsonl"
CDS_SESSIONE = RADICE / "memoria" / "cds_sessione.jsonl"
# v522 — la riserva della sessione deve reggere anche una pipeline ferma a lungo: lo stesso tetto dello storico del repo
#   (circa due anni). Non cresce quando la pipeline gira, perche' i giorni che il repo ha gia' completi si tolgono
#   (conserva_giorni_cds): resta solo cio' che nessun altro ha raccolto
CDS_SESSIONE_GIORNI = 520
VALIDITA_MINUTI = 30
PERIODICI = ("10-Q", "10-K")
URL_NASDAQ_FIN = "https://api.nasdaq.com/api/company/{tk}/financials?frequency=2"
# le voci del conto di Nasdaq che possono essere la STESSA grandezza della pipeline (update_data.conto_trimestrale):
#   quale lo sono lo decide il trimestre in comune, non il nome
VOCI_NASDAQ = {"ricavi": ("Total Revenue",),
               "operativo": ("Operating Income",),
               "utile": ("Net Income", "Net Income Applicable to Common Shareholders", "Net Income-Cont. Operations")}
SPENTA = "TRADING_FONTI_TITOLI"     # ="spenta": le suite non leggono la lettura del giro (dipenderebbero dall'ora)
NEW_YORK = ZoneInfo("America/New_York")
ROMA = ZoneInfo("Europe/Rome")
BLOCCHI = ("righe", "analisti", "fedwatch", "cds", "short", "sec", "trimestri", "btp", "leva", "edgar", "etf")

# ⚠ OGNI QUANTO CAMBIA CIASCUN DATO, e ogni quanto la pipeline lo rilegge: la domanda del CEO del 25/10. Fatti delle fonti
#   (orari, scadenze di legge, calendario), non stime: dove la cadenza non e' fissata dalla fonte si dice.
CADENZE = (
    ("righe", "Righe dei titoli (Yahoo, con la funzione della pipeline)",
     "prezzo, tecnica e volumi cambiano a ogni scambio; multipli, consenso e flottante quando Yahoo li aggiorna; conti, "
     "combustione di cassa e solidita' a ogni trimestre, quando la societa' deposita i conti"),
    ("analisti", "Analisti (Yahoo)",
     "nessuna cadenza fissa: una casa alza o taglia un target o una stima in qualunque giorno, e la lettura di adesso e' "
     "il consenso che Yahoo pubblica in questo momento"),
    ("fedwatch", "FedWatch (future Fed Funds CME, EFFR NY Fed)",
     "i future quotano da domenica alle 18:00 a venerdi' alle 17:00 di New York, con un'ora di pausa ogni giorno dalle "
     "17:00; l'EFFR la NY Fed lo pubblica ogni giorno lavorativo verso le 9:00 di New York, per il giorno lavorativo prima"),
    ("cds", "CDS (ICE Clear Credit)",
     "un prezzo di fine giornata per ogni giorno di compensazione, pubblicato a ondate (Asia, Europa, Nord America con "
     "gli indici CDX fra le 19:50 e le 21:00 UTC, misurato in v508); ICE pubblica SOLO l'ultimo giorno, lo storico lo "
     "raccoglie chi lo legge"),
    ("short", "Vendite allo scoperto (FINRA)",
     "due regolamenti al mese (meta' e fine mese), pubblicati secondo il calendario ufficiale di FINRA, di solito sette "
     "giorni lavorativi dopo"),
    ("sec", "Depositi SEC",
     "10-Q ogni trimestre, entro 40 o 45 giorni dalla chiusura secondo la dimensione della societa'; 10-K ogni anno, "
     "entro 60, 75 o 90 giorni; 8-K entro quattro giorni lavorativi da un evento (i conti escono di solito con un 8-K il "
     "giorno stesso). Le voci del debito cambiano solo con un 10-Q o 10-K nuovo: la pipeline ne rilegge al piu' dieci "
     "per run, questa lettura tutti quelli nuovi (v522)"),
    ("btp", "Prezzo del BTP (Borsa Italiana, v521)",
     "per ogni seduta del MOT un prezzo di riferimento e un prezzo ufficiale, ciascuno con la data che la pagina "
     "dichiara accanto: il prezzo ufficiale esce piu' tardi, e vale il piu' recente dei due (v522)"),
    ("leva", "Debito a margine (FINRA, v521)",
     "una rilevazione al mese, per il mese concluso: il giorno di pubblicazione lo fissa FINRA, e qui non si stima; "
     "la tabella della pagina e il file storico si uniscono per data, con la funzione della pipeline"),
    ("edgar", "SEC EDGAR (v522)",
     "un deposito quando la societa' lo fa: i conti con un 8-K, di solito il giorno stesso; 10-Q e 10-K entro le "
     "scadenze di legge; l'archivio dei depositi e' consultabile in qualunque momento"),
    ("etf", "Composizione degli ETF (v522)",
     "la dichiara l'emittente, di solito ogni giorno; cambia coi ribilanciamenti del fondo, quindi lentamente"),
)
CADENZA_PIPELINE = ("La pipeline rilegge analisti, FedWatch, CDS, short, prezzo del BTP, debito a margine, SEC EDGAR "
                    "e composizione degli ETF a ogni run: 14-15 run al giorno nei feriali e "
                    "11 nel fine settimana, che partono con 99-263 minuti di ritardo sull'orario (la coda del cron di "
                    "GitHub, v437)")


def _ud():
    """update_data si importa una volta e in silenzio: stampa l'elenco dei simboli quando viene caricato (come
    concorrenti.py)."""
    if "update_data" not in sys.modules:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            import update_data  # noqa: F401
    return sys.modules["update_data"]


def _sicuro(f):
    def g(x):
        try:
            return f(x)
        except Exception:  # noqa: BLE001 — un titolo che non risponde non porta via gli altri
            return None
    return g


def _in_parallelo(f, nomi, thread=6):
    nomi = list(nomi)
    with ThreadPoolExecutor(thread) as ex:
        return dict(zip(nomi, ex.map(_sicuro(f), nomi)))


def _simbolo(tk):
    """Il simbolo che la pipeline chiede a Yahoo (update_data.TICKER_ALIAS): lo stesso titolo, la stessa domanda."""
    tk = str(tk or "").strip()
    return _ud().TICKER_ALIAS.get(tk.upper(), tk)


def nomi_libro():
    """(posizioni in dollari, sorvegliati): gli stessi nomi delle schede del progetto."""
    import brief
    pos, _, sorv = brief.leggi_libro()
    p = [x["tk"] for x in pos if x.get("valuta") == "USD"]
    return p, [s["tk"] for s in sorv if s["tk"] not in p]


def _righe(d):
    return [r for r in ((d or {}).get("portfolio") or []) + ((d or {}).get("watchlist") or [])
            if isinstance(r, dict) and r.get("ticker")]


def _riferimento(tk):
    """Indici, cambi, future e criptovalute si riconoscono dalla FORMA del simbolo (v410)."""
    tk = str(tk or "")
    return tk.startswith("^") or "=" in tk or tk.endswith("-USD")


# ══════════════════════════════════ LE LETTURE ═══════════════════════════════════════════════════════════════════
def leggi_analisti(nomi, lettore=None):
    """{tk: dict o None} con update_data.analisti_da. None = Yahoo non ha restituito niente (o non ha risposto): la
    funzione della pipeline non distingue i due casi, e questo strumento nemmeno — tiene la pipeline e lo dice."""
    if lettore is None:
        import yfinance as yf
        ud = _ud()
        lettore = lambda tk: ud.analisti_da(yf.Ticker(_simbolo(tk)), tk)  # noqa: E731
    return _in_parallelo(lettore, nomi)


def periodici_da(depositi):
    """{'10-Q': 'AAAA-MM-GG', '10-K': ...}: l'ultimo deposito periodico di ciascun tipo, dalla lista di Yahoo (le
    modifiche, «10-Q/A», non sono un trimestre nuovo e restano fuori)."""
    out = {}
    for f in depositi or []:
        tipo = str((f or {}).get("type") or "").strip().upper()
        if tipo not in PERIODICI:
            continue
        g = f.get("date")
        g = g.isoformat() if hasattr(g, "isoformat") else str(g or "")[:10]
        if len(g) == 10 and g > out.get(tipo, ""):
            out[tipo] = g
    return out


def leggi_sec(nomi, lettore=None):
    """{tk: {'10-Q', '10-K'} o None}: None = Yahoo non ha risposto; {} = ha risposto senza 10-Q ne' 10-K (un emittente
    estero deposita 20-F e 6-K, che la pipeline non legge)."""
    if lettore is None:
        import yfinance as yf
        lettore = lambda tk: yf.Ticker(_simbolo(tk)).sec_filings  # noqa: E731
    letti = _in_parallelo(lettore, nomi)
    return {tk: (periodici_da(v) if v is not None else None) for tk, v in letti.items()}


def rendimenti_di(nomi, lettore=None):
    """{tk: (_ret_series, _ret_dates)} come li costruisce la pipeline (update_data.rendimenti_datati sui log-rendimenti
    di un anno di chiusure rettificate, senza le barre vuote): il lato azionario di CDS e short si legge su quelli."""
    ud = _ud()
    if lettore is None:
        import yfinance as yf
        lettore = lambda tk: yf.Ticker(_simbolo(tk)).history(period="1y", interval="1d", auto_adjust=True)  # noqa: E731

    def uno(tk):
        h = ud.drop_void_bars(lettore(tk))
        if h is None or h.empty:
            return None
        return ud.rendimenti_datati(ud.rendimenti_log(h["Close"]))
    return {k: v for k, v in _in_parallelo(uno, nomi).items() if v}


def _num_nasdaq(s):
    """'$1,235,837' → 1235837000 (Nasdaq scrive in MIGLIAIA); '-$49,000' → -49000000; '--' o vuoto → None."""
    t = str(s or "").strip().replace("$", "").replace(",", "")
    if t in ("", "--", "-"):
        return None
    try:
        return round(float(t) * 1000)
    except ValueError:
        return None


def trimestri_nasdaq(js):
    """[{trim, voci: {nome: valore}}] dal conto trimestrale di Nasdaq, dal piu' recente. [] se la forma non e' quella
    attesa: una forma diversa si dichiara, non si indovina."""
    from datetime import date
    t = ((((js or {}).get("data") or {}).get("incomeStatementTable")) or {})
    h, rows = t.get("headers") or {}, t.get("rows") or []
    out = []
    for k in sorted((k for k in h if k != "value1"), key=lambda k: int(k[5:]) if k[5:].isdigit() else 99):
        try:
            m, g, a = (int(x) for x in str(h[k]).split("/"))
            d = date(a, m, g).isoformat()
        except (ValueError, TypeError):
            continue
        out.append({"trim": d, "voci": {r.get("value1"): _num_nasdaq(r.get(k)) for r in rows if r.get("value1")}})
    return sorted(out, key=lambda x: x["trim"], reverse=True)


def _vicini(a, b, giorni=5):
    from datetime import date
    try:
        return abs((date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days) <= giorni
    except ValueError:
        return False


def completa_trimestri(conto, nasdaq):
    """I trimestri che Nasdaq porta e la tabella della pipeline no, nella forma di update_data.conto_trimestrale.
    ⚠⚠ DUE FORNITORI NON SI MESCOLANO PER IPOTESI: sul trimestre piu' recente IN COMUNE ogni voce di Nasdaq deve dare il
    numero della pipeline (Nasdaq scrive in migliaia: lo scarto ammesso e' quell'arrotondamento). I ricavi devono
    coincidere o non si aggiunge niente; utile e risultato operativo entrano solo con la voce che coincide (sull'utile i
    fornitori usano definizioni diverse: il 25/10 BE, 196,3 milioni da Yahoo, e' la voce «Net Income Applicable to
    Common Shareholders» di Nasdaq e non il suo «Net Income» di 200,6). Restituisce {esito, nuovi, comune, voci}."""
    ct = sorted([x for x in conto or [] if isinstance(x, dict) and x.get("trim") and x.get("ricavi") is not None],
                key=lambda x: str(x["trim"]), reverse=True)
    if not ct or not nasdaq:
        return {"esito": "nessun confronto possibile", "nuovi": []}
    u = ct[0]
    com = next((q for q in nasdaq if _vicini(q["trim"], str(u["trim"]))), None)
    if com is None:
        return {"esito": f"Nasdaq non porta il trimestre del {str(u['trim'])[:10]}: nessun confronto, niente si aggiunge",
                "nuovi": []}

    def uguali(a, b):
        return a is not None and b is not None and abs(a - b) <= max(1000, abs(b) * 0.0005)
    scelte = {}
    for campo, nomi in VOCI_NASDAQ.items():
        scelte[campo] = next((n for n in nomi if uguali(com["voci"].get(n), u.get(campo))), None)
    if not scelte["ricavi"]:
        return {"esito": (f"sul trimestre in comune ({str(u['trim'])[:10]}) i ricavi di Nasdaq non coincidono con quelli "
                          "della pipeline: le due fonti non si mescolano"), "nuovi": [], "comune": str(u["trim"])[:10]}
    nuovi = []
    for q in nasdaq:
        if q["trim"] <= str(u["trim"])[:10] or _vicini(q["trim"], str(u["trim"]), 20):
            continue
        r = q["voci"].get(scelte["ricavi"])
        if r is None:
            continue
        o = q["voci"].get(scelte["operativo"]) if scelte["operativo"] else None
        ut = q["voci"].get(scelte["utile"]) if scelte["utile"] else None
        nuovi.append({"trim": q["trim"], "ricavi": r, "utile": ut, "operativo": o,
                      "margine": round(ut / r * 100, 1) if ut is not None and r else None,
                      "margine_op": round(o / r * 100, 1) if o is not None and r else None,
                      "fonte": "Nasdaq"})
    return {"esito": "completata" if nuovi else "Nasdaq non porta trimestri piu' recenti", "nuovi": nuovi,
            "comune": str(u["trim"])[:10], "voci": {k: v for k, v in scelte.items()}}


# ══════════════════════ v513 — I CONTI DAL COMUNICATO UFFICIALE (memoria/trimestri_ufficiali.json) ══════════════════════
# Il CEO, 25/10/2026, alla domanda «per GS, JPM e BLK le due fonti non concordano sui ricavi: (a) a ogni analisi si cerca
# il comunicato ufficiale e si usa quello, con fonte e data; (b) restano sui dati della pipeline con l'avviso», ha
# risposto: *"A"*.
# ⚠⚠ UNA DEFINIZIONE SOLA PER CONFRONTO. I ricavi di una banca non hanno una definizione unica: il 25/10 il «Total
#   Revenue» di Nasdaq non coincideva con quello di Yahoo su nessuna delle tre, e su JPM quello di Yahoo non coincide
#   nemmeno col comunicato (2° trimestre 2026: 52,852 miliardi contro i 57,347 del «Net revenue - reported»). Quindi un
#   trimestre del comunicato si confronta SOLO coi trimestri che il comunicato stesso stampa accanto — l'anno prima e il
#   trimestre prima, nella stessa tabella — e mai con la tabella di un altro fornitore. Il confronto con la pipeline sui
#   trimestri in comune si fa lo stesso, ma per DICHIARARE se le definizioni coincidono, non per scegliere i numeri.
# ⚠ I numeri si trascrivono come il comunicato li stampa (di solito in milioni: `unita` 1000000), con la voce che li
#   porta, il link, la data del comunicato e quella della verifica. Un comunicato con un difetto non si usa e si NOMINA.
# ⚠ Una volta registrato, un trimestre passato non cambia: la ricerca si fa una volta per trimestre e per nome, e a ogni
#   analisi lo strumento dice cosa manca (DA CERCARE IN RETE). Un intervallo di guida o un risultato preliminare non e'
#   un numero del trimestre: non si registra (v396).
UFFICIALI = RADICE / "memoria" / "trimestri_ufficiali.json"
CAMPI_UFFICIALI = ("ticker", "trim", "periodo", "valuta", "unita", "voci", "ricavi", "fonte", "link", "data_comunicato",
                   "verificato_il")
VOCI_UFFICIALI = ("ricavi", "utile", "operativo")
GIORNI_COMUNICATO = 100     # convenzione (v240): i conti di un trimestre si pubblicano entro cento giorni dalla chiusura
NOMI_VOCI = {"ricavi": "ricavi", "utile": "utile", "operativo": "risultato operativo"}


def _numero(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x


def _giorno(x):
    from datetime import date
    try:
        return date.fromisoformat(str(x)[:10]) if len(str(x)) >= 10 else None
    except ValueError:
        return None


def difetti_ufficiale(e):
    """I difetti di un comunicato registrato, ciascuno col suo motivo. Vuoto = si puo' usare."""
    if not isinstance(e, dict):
        return ["la voce non e' un oggetto"]
    out = [f"manca il campo «{c}»" for c in CAMPI_UFFICIALI if e.get(c) in (None, "", {})]
    t, dc, dv = _giorno(e.get("trim")), _giorno(e.get("data_comunicato")), _giorno(e.get("verificato_il"))
    if e.get("trim") and t is None:
        out.append("«trim» non e' una data")
    if e.get("data_comunicato") and dc is None:
        out.append("«data_comunicato» non e' una data")
    if e.get("verificato_il") and dv is None:
        out.append("«verificato_il» non e' una data")
    if t and dc and not (t < dc and (dc - t).days <= GIORNI_COMUNICATO):
        out.append(f"il comunicato del {dc} non cade entro {GIORNI_COMUNICATO} giorni dopo la chiusura del trimestre "
                   f"({t})")
    if dc and dv and dv < dc:
        out.append("la verifica e' precedente al comunicato")
    if e.get("link") and not str(e["link"]).startswith("https://"):
        out.append("il link non e' un indirizzo https")
    if e.get("unita") is not None and not (_numero(e["unita"]) and e["unita"] > 0):
        out.append("«unita» non e' un numero positivo")
    voci = e.get("voci") if isinstance(e.get("voci"), dict) else {}
    if e.get("voci") is not None and not isinstance(e.get("voci"), dict):
        out.append("«voci» non e' un oggetto")
    for campo in VOCI_UFFICIALI:
        presenti = [k for k in (campo, campo + "_anno_prima", campo + "_trim_prima") if e.get(k) is not None]
        for k in presenti:
            if not _numero(e[k]):
                out.append(f"«{k}» non e' un numero")
        if presenti and not voci.get(campo):
            out.append(f"manca la voce del comunicato per «{campo}» (come la chiama la societa')")
    for k in ("ricavi", "ricavi_anno_prima", "ricavi_trim_prima"):
        if _numero(e.get(k)) and e[k] <= 0:
            out.append(f"«{k}» non e' positivo")
    return out


def leggi_ufficiali(percorso=None):
    """{comunicati: [validi], difetti: [(chi, motivi)], stato}. Un comunicato con un difetto non si usa e si nomina."""
    p = Path(percorso) if percorso else UFFICIALI
    try:
        reg = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"stato": "assente", "comunicati": [], "difetti": []}
    except (OSError, ValueError) as e:
        return {"stato": "illeggibile", "comunicati": [], "difetti": [("registro", [f"{type(e).__name__}"])]}
    ok, difetti, visti = [], [], set()
    prel = []
    for i, e in enumerate(reg.get("preliminari") or []):
        dd = ([f"manca il campo «{c}»" for c in ("ticker", "deposito", "link", "verificato_il", "nota")
               if not (isinstance(e, dict) and e.get(c))] if isinstance(e, dict) else ["la voce non e' un oggetto"])
        if isinstance(e, dict) and e.get("deposito") and _giorno(e["deposito"]) is None:
            dd.append("«deposito» non e' una data")
        if dd:
            difetti.append((f"preliminare {e.get('ticker') if isinstance(e, dict) else i + 1}", dd))
        else:
            prel.append(e)
    for i, e in enumerate(reg.get("comunicati") or []):
        chi = f"{e.get('ticker')} {str(e.get('trim'))[:10]}" if isinstance(e, dict) else f"voce {i + 1}"
        dd = difetti_ufficiale(e)
        chiave = (e.get("ticker"), str(e.get("trim"))[:10]) if isinstance(e, dict) else None
        if chiave in visti:
            dd.append("lo stesso trimestre e' registrato due volte")
        visti.add(chiave)
        if dd:
            difetti.append((chi, dd))
        else:
            ok.append(e)
    return {"stato": "letto", "comunicati": ok, "preliminari": prel, "difetti": difetti}


def _uff(e, k):
    x = e.get(k)
    return x * e["unita"] if _numero(x) else None


def riga_ufficiale(e):
    """Il trimestre del comunicato nella forma di update_data.conto_trimestrale, coi confronti del comunicato stesso."""
    r = {c: _uff(e, c) for c in VOCI_UFFICIALI}
    r.update({"trim": str(e["trim"])[:10],
              "margine": round(r["utile"] / r["ricavi"] * 100, 1) if r["utile"] is not None and r["ricavi"] else None,
              "margine_op": (round(r["operativo"] / r["ricavi"] * 100, 1) if r["operativo"] is not None and r["ricavi"]
                             else None),
              "fonte": f"dal comunicato ufficiale del {_data_it(e['data_comunicato'])}",
              "voci": dict(e["voci"]), "link": e["link"], "verificato_il": str(e["verificato_il"])[:10]})
    conf = {}
    for quale, suff in (("anno", "_anno_prima"), ("prec", "_trim_prima")):
        conf[quale] = ({c: _uff(e, c + suff) for c in VOCI_UFFICIALI} if _uff(e, "ricavi" + suff) is not None else None)
    r["confronti"] = conf
    return r


def confronto_con_pipeline(e, conto):
    """I confronti del comunicato contro la tabella della pipeline sugli STESSI trimestri, trovati per data (v207):
    servono a dichiarare se le definizioni coincidono, mai a scegliere i numeri."""
    import schede_progetto
    out = []
    ct = [x for x in conto or [] if isinstance(x, dict) and x.get("trim")]
    for quale, suff, gg in (("l'anno prima", "_anno_prima", 365), ("il trimestre prima", "_trim_prima", 91)):
        p = schede_progetto._trimestre_a(ct, e["trim"], gg)
        for c in VOCI_UFFICIALI:
            a = _uff(e, c + suff)
            if a is None:
                continue
            b = (p or {}).get(c)
            out.append({"voce": c, "quale": quale, "trim": (p or {}).get("trim"), "comunicato": a, "pipeline": b,
                        "coincide": None if b is None else abs(a - b) <= max(abs(b) * 0.0005, e["unita"])})
    return out


def applica_ufficiali(d, reg):
    """Sovrappone a `d` (che MODIFICA: va passata una copia) il comunicato piu' recente di ciascun nome, se e' dello
    stesso trimestre dell'ultimo della tabella o piu' recente. Un comunicato piu' vecchio dell'ultimo trimestre della
    tabella NON entra: messo in mezzo, farebbe da confronto ai trimestri di un altro fornitore. {tk: esito}."""
    esiti = {}
    righe = {r["ticker"]: r for r in _righe(d)}
    per = {}
    for e in (reg or {}).get("comunicati") or []:
        per.setdefault(e["ticker"], []).append(e)
    for tk, lst in sorted(per.items()):
        e = max(lst, key=lambda x: str(x["trim"]))
        r = righe.get(tk)
        if r is None:
            esiti[tk] = {"esito": "non seguito", "trim": str(e["trim"])[:10]}
            continue
        tv = r.setdefault("tv", {})
        ct = [x for x in tv.get("conto_trim") or [] if isinstance(x, dict) and x.get("trim")]
        cima = max((str(x["trim"])[:10] for x in ct), default=None)
        if cima and str(e["trim"])[:10] < cima and not _vicini(str(e["trim"]), cima, 20):
            esiti[tk] = {"esito": "superato", "trim": str(e["trim"])[:10], "tabella": cima}
            continue
        resto = [x for x in ct if not _vicini(str(x["trim"]), str(e["trim"]), 20)]
        tv["conto_trim"] = sorted([riga_ufficiale(e)] + resto, key=lambda x: str(x["trim"]), reverse=True)
        esiti[tk] = {"esito": "sostituito" if len(resto) < len(ct) else "aggiunto", "trim": str(e["trim"])[:10],
                     "data": str(e["data_comunicato"])[:10], "verificato_il": str(e["verificato_il"])[:10],
                     "periodo": e.get("periodo"), "voci": dict(e["voci"]), "valuta": e.get("valuta"),
                     "confronto": confronto_con_pipeline(e, ct)}
    return esiti


def testo_confronti_propri(es):
    """Quali confronti porta il comunicato stesso: quelli che mancano restano n.d., mai presi da un altro fornitore."""
    tutti = ("l'anno prima", "il trimestre prima")
    cc = {c["quale"] for c in es.get("confronto") or []}
    ci, manca = [x for x in tutti if x in cc], [x for x in tutti if x not in cc]
    if not ci:
        return "il comunicato non stampa trimestri di confronto: variazioni n.d."
    return ("confronti dal comunicato stesso: " + " e ".join(ci)
            + (f" ({manca[0]} non e' nel comunicato: quella variazione e' n.d.)" if manca else ""))


def testo_confronto(es):
    """Il confronto coi numeri della pipeline sugli stessi trimestri, voce per voce, in una riga."""
    cc = [c for c in es.get("confronto") or [] if c.get("pipeline") is not None]
    if not cc:
        return "la tabella della pipeline non ha i trimestri di confronto del comunicato"
    ok = [c for c in cc if c["coincide"]]
    no = [c for c in cc if not c["coincide"]]
    pz = []
    if ok:
        pz.append("coincidono con la pipeline: " + ", ".join(f"{NOMI_VOCI[c['voce']]} del {_data_it(c['trim'])}"
                                                               for c in ok))
    if no:
        pz.append("NON coincidono: " + ", ".join(
            f"{NOMI_VOCI[c['voce']]} del {_data_it(c['trim'])} ({_n(c['comunicato'] / 1e9, 3)} contro "
            f"{_n(c['pipeline'] / 1e9, 3)} mld {es.get('valuta') or ''})".replace(" )", ")") for c in no)
                  + " — le due fonti definiscono la voce diversamente: valgono i confronti del comunicato")
    return " · ".join(pz)


def righe_ufficiali(reg, es):
    """La riga CONTI DAL COMUNICATO UFFICIALE, sempre stampata: un registro vuoto e un registro non letto si leggono
    uguali e sono due cose diverse (v389, v406)."""
    reg = reg or {"stato": "assente", "comunicati": [], "difetti": []}
    s = "  · CONTI DAL COMUNICATO UFFICIALE (memoria/trimestri_ufficiali.json, v513): "
    if reg["stato"] == "assente":
        s += "registro assente: nessun comunicato in uso"
    elif reg["stato"] == "illeggibile":
        s += "registro ILLEGGIBILE: nessun comunicato in uso"
    elif reg["stato"] == "spento":
        s += "registro non letto (TRADING_FONTI_TITOLI=spenta): nessun comunicato in uso"
    else:
        n = len(reg["comunicati"])
        s += (f"{n} comunicat{'o' if n == 1 else 'i'} registrat{'o' if n == 1 else 'i'} e valid{'o' if n == 1 else 'i'}"
              if n else "nessun comunicato registrato")
    L = [s]
    for tk, v in sorted((es or {}).items()):
        if v["esito"] in ("aggiunto", "sostituito"):
            L.append(f"      {tk}: {v.get('periodo') or 'trimestre'} (al {_data_it(v['trim'])}), comunicato del "
                     f"{_data_it(v['data'])}, verificato il {_data_it(v['verificato_il'])}, voce dei ricavi "
                     f"«{(v.get('voci') or {}).get('ricavi')}» — "
                     + ("prende il posto dello stesso trimestre della pipeline" if v["esito"] == "sostituito" else
                        "la tabella della pipeline non lo porta")
                     + "; " + testo_confronti_propri(v) + " · " + testo_confronto(v))
        elif v["esito"] == "superato":
            L.append(f"      {tk}: il comunicato registrato (trimestre al {_data_it(v['trim'])}) e' superato dalla "
                     f"tabella della pipeline, che arriva al {_data_it(v['tabella'])}: non entra")
        else:
            L.append(f"      {tk}: comunicato registrato (trimestre al {_data_it(v['trim'])}) per un nome che il sistema "
                     "non segue: non entra")
    for p in reg.get("preliminari") or []:
        L.append(f"      {p['ticker']}: il deposito del {_data_it(p['deposito'])} e' registrato come aggiornamento "
                 f"PRELIMINARE (non e' un numero del trimestre): {p['nota']}")
    for chi, motivi in reg.get("difetti") or []:
        L.append(f"      ⚠ NON USATO {chi}: " + "; ".join(motivi))
    return L


def leggi_trimestri(nomi, lettore=None):
    """{tk: trimestri di Nasdaq o None}."""
    if lettore is None:
        import brief
        lettore = lambda tk: trimestri_nasdaq(brief.jget(URL_NASDAQ_FIN.format(tk=tk), 20))  # noqa: E731
    return _in_parallelo(lettore, nomi, thread=4)


def ferme(d, periodici):
    """I nomi la cui tabella dei trimestri e' FERMA: l'ultimo deposito di risultati (8-K item 2.02 della pipeline o
    10-Q/10-K letti adesso) cade oltre la soglia dopo l'ultimo trimestre della tabella (schede.deposito_oltre_la_tabella,
    una regola sola: v161). {tk: esito di deposito_oltre_la_tabella}."""
    import schede_progetto
    sec = ((((d or {}).get("macro") or {}).get("sec_calendario")) or {}).get("per_titolo") or {}
    out = {}
    for r in _righe(d):
        tk = r["ticker"]
        cand = [str((sec.get(tk) or {}).get("ultimo_deposito") or "")[:10]] + list(((periodici or {}).get(tk) or {}).values())
        cand = [c for c in cand if len(c) == 10]
        if not cand:
            continue
        f = schede_progetto.deposito_oltre_la_tabella(r, {"ultimo_deposito": max(cand)})
        if f:
            out[tk] = f
    return out


def mercato_qqq():
    """QQQ con le sue date, dallo stesso canale 'mercato' della pipeline (update_data.canali_macro)."""
    m = (_ud().canali_macro() or {}).get("mercato")
    if m and m[2] is not None and len(m[2]):
        return {d.strftime("%Y-%m-%d"): float(v) for d, v in m[2].items() if v == v}
    return None


def date_cds_pipeline(d):
    """({tk: giorno del CDS della pipeline}, {famiglia: giorno dell'indice}) — None dove la pipeline non quota."""
    nomi = {r["ticker"]: ((r.get("cds") or {}).get("data") if (r.get("cds") or {}).get("stato") == "quotato" else None)
            for r in _righe(d)}
    ind = {f: v.get("data") for f, v in ((((d or {}).get("macro") or {}).get("cds") or {}).get("indici") or {}).items()}
    return nomi, ind


def cds_piu_recenti(lettura, d, mappa):
    """(nomi, indici) per cui ICE porta adesso un giorno PIU' RECENTE di quello della pipeline. Un nome che la pipeline
    non quotava e ICE oggi si' e' piu' recente per definizione."""
    pn, pi = date_cds_pipeline(d)
    ent = (lettura or {}).get("entita") or {}
    nomi = []
    for tk, cod in ((mappa or {}).get("entita") or {}).items():
        if cod is None or tk not in pn:
            continue
        g = (ent.get(cod) or {}).get("data")
        if g and (pn[tk] is None or g > pn[tk]):
            nomi.append(tk)
    indici = sorted(f for f, v in ((lettura or {}).get("indici") or {}).items()
                    if v.get("data") and (pi.get(f) is None or v["data"] > pi[f]))
    return sorted(nomi), indici


def conserva_giorni_cds(lettura, tasso, storia_repo, percorso=CDS_SESSIONE, giorni=CDS_SESSIONE_GIORNI):
    """I giorni di ICE che lo storico del repo non ha (o ha a meta') si scrivono in memoria/cds_sessione.jsonl, che la
    pipeline unisce al proprio storico al run successivo (update_data.aggiorna_cds): un giorno letto qui e non
    conservato sarebbe perso — ICE non lo ripubblica. Restituisce i giorni scritti ([] se non c'era niente di nuovo)."""
    ud = _ud()
    righe = ud.righe_storia_cds(lettura, tasso)
    _, es = ud.unisci_storia_cds(copy.deepcopy(storia_repo or []), copy.deepcopy(righe), inserisci_vecchi=True)
    utili = set(es["nuove"]) | set(es["completate"]) | set(es.get("inseriti") or [])
    sess0 = ud.leggi_storia_cds(Path(percorso))
    # v522 — i giorni che lo storico del repo ha gia' COMPLETI (ogni entita' e ogni indice della riga di sessione) si
    #   tolgono: la pipeline li ha uniti, e la riserva resta piccola finche' la pipeline gira
    sess = [r for r in sess0 if not gia_nel_repo(r, storia_repo)]
    tolti = len(sess0) - len(sess)
    if not utili:
        if tolti:
            ud.scrivi_storia_cds(sess, Path(percorso))
        return []
    righe = [{**r, "origine": "sessione d'analisi (scripts/fonti_titoli.py)"} for r in righe if r["d"] in utili]
    sess, es2 = ud.unisci_storia_cds(sess, righe, massimo=giorni, inserisci_vecchi=True)
    if es2["cambiato"] or tolti:
        ud.scrivi_storia_cds(sess, Path(percorso))
    return sorted(utili)


def gia_nel_repo(riga, storia_repo):
    """v522 — True se lo storico del repo ha il giorno della riga con TUTTE le sue entita' e i suoi indici: quel giorno
    nella riserva della sessione non serve piu'. Un giorno che il repo ha a meta' resta."""
    r = next((x for x in (storia_repo or []) if x.get("d") == (riga or {}).get("d")), None)
    return bool(r) and set((riga or {}).get("p") or {}) <= set(r.get("p") or {}) \
        and set((riga or {}).get("i") or {}) <= set(r.get("i") or {})


def leggi_cds(d, fedwatch, lettura=None, rendimenti=None, mercato=None, get=None, percorso_sessione=CDS_SESSIONE):
    """{'esito', 'ice', 'nuovi', 'indici_nuovi', 'macro', 'per_titolo', 'conservati', 'errore'}.
    esito: «rifatto» (ICE piu' avanti della pipeline: misure rifatte) · «stesso giorno» · «non letto»."""
    ud = _ud()
    cache = {}

    def cget(u):
        if u not in cache:
            cache[u] = (get or (lambda x: ud.http_get(x, tries=2, timeout=40)))(u)
        return cache[u]
    out = {"esito": "non letto", "ice": None, "nuovi": [], "indici_nuovi": [], "macro": None, "per_titolo": {},
           "conservati": [], "errore": None}
    try:
        lettura = lettura or ud.leggi_cds_ice(cget)
    except Exception as e:  # noqa: BLE001
        out["errore"] = f"{type(e).__name__}: {str(e)[:120]}"
        return out
    if not (lettura or {}).get("data"):
        out["errore"] = "ICE ha risposto senza prezzi"
        return out
    out["ice"] = {"data": lettura["data"], "date": dict(lettura.get("date") or {})}
    try:
        mappa = json.loads(Path(ud.CDS_ENTITA).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        mappa = {}
    out["nuovi"], out["indici_nuovi"] = cds_piu_recenti(lettura, d, mappa)
    macro = {"fedwatch": fedwatch or (((d or {}).get("macro") or {}).get("fedwatch")) or {}}
    storia = ud.leggi_storia_cds(ud.CDS_STORIA)
    tasso, _ = ud.tasso_cds(macro, storia)
    try:
        out["conservati"] = conserva_giorni_cds(lettura, tasso, storia, percorso_sessione)
    except Exception as e:  # noqa: BLE001 — conservare e' un di piu': il suo guasto si dice, non porta via il giro
        out["errore_conservazione"] = f"{type(e).__name__}: {str(e)[:120]}"
    if not out["nuovi"] and not out["indici_nuovi"]:
        out["esito"] = "stesso giorno"
        return out
    # le letture costose si fanno solo qui, quando ICE e' davvero piu' avanti: rendimenti e mercato possono arrivare
    #   come funzioni da chiamare
    rendimenti = rendimenti() if callable(rendimenti) else rendimenti
    mercato = mercato() if callable(mercato) else mercato
    righe = copy.deepcopy(_righe(d))
    for r in righe:
        rd = (rendimenti or {}).get(r["ticker"])
        if rd:
            r["_ret_series"], r["_ret_dates"] = rd
    STORIA_COPIA.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ud.CDS_STORIA, STORIA_COPIA)
    with contextlib.redirect_stdout(io.StringIO()):
        m = ud.aggiorna_cds(righe, macro, get=cget, percorso_storia=STORIA_COPIA, mercato=mercato,
                            percorso_sessione=percorso_sessione)
    out["macro"] = m
    out["per_titolo"] = {r["ticker"]: r["cds"] for r in righe if "cds" in r}
    out["esito"] = "rifatto"
    return out


def leggi_short(d, rendimenti_di_fn=None, post=None, get=None, oggi=None):
    """{'esito', 'regolamento', 'prossimo', 'macro', 'per_titolo', 'errore'}. Una richiesta per sapere quale regolamento
    FINRA porta adesso; solo se e' piu' recente di quello della pipeline le misure si rifanno (coi rendimenti letti
    adesso). esito: «rifatto» · «stesso regolamento» · «non letto»."""
    ud = _ud()
    pipe = (((d or {}).get("macro") or {}).get("short_interest") or {})
    righe = [r for r in copy.deepcopy(_righe(d)) if not _riferimento(r["ticker"])]
    out = {"esito": "non letto", "regolamento": None, "prossimo": None, "pubblicato": None, "macro": None,
           "per_titolo": {}, "errore": None, "calendario": None}
    with contextlib.redirect_stdout(io.StringIO()):
        m = ud.aggiorna_short(copy.deepcopy(righe), None, post=post, get=get, oggi=oggi)
    out.update(regolamento=m.get("regolamento"), prossimo=m.get("prossimo"), pubblicato=m.get("pubblicato"),
               calendario=m.get("calendario"))
    if not m.get("letto"):
        out["errore"] = m.get("errore") or "FINRA non ha risposto"
        return out
    if not m.get("regolamento") or (pipe.get("regolamento") and m["regolamento"] <= pipe["regolamento"]):
        out["esito"] = "stesso regolamento"
        return out
    rend = (rendimenti_di_fn or rendimenti_di)([r["ticker"] for r in righe])
    for r in righe:
        if rend.get(r["ticker"]):
            r["_ret_series"], r["_ret_dates"] = rend[r["ticker"]]
    prec = {r["ticker"]: r.get("short_interest") for r in _righe(d) if r.get("short_interest")}
    with contextlib.redirect_stdout(io.StringIO()):
        m2 = ud.aggiorna_short(righe, prec, post=post, get=get, oggi=oggi)
    out["macro"] = m2
    out["per_titolo"] = {r["ticker"]: r["short_interest"] for r in righe if "short_interest" in r}
    out["esito"] = "rifatto"
    return out


# ══════════════════════════════════ LE RIGHE DEI TITOLI (v519) ══════════════════════════════════════════════════
# Opzione B scelta dal CEO il 30/10/2026: i dati per titolo di TUTTE le righe della pipeline (posizioni, sorvegliati e
# riferimenti) si producono in sessione a ogni analisi, con update_data.fetch_symbol — la stessa funzione, gli stessi
# argomenti, lo snapshot del run come «run precedente» (PREV_DATA), cosi' la stessa domanda alla stessa fonte da' la
# stessa risposta nei due posti (v161).
THREAD_RIGHE = 10   # misurato il 30/10/2026 su 67 righe: 33 s con 10 thread e nessun 429; 50 s con 6 e un 429
# Campi che la pipeline calcola DOPO fetch_symbol, sui titoli INSIEME o sulle posizioni: la lettura di una riga sola non
# li produce, e restano quelli del run (la forza relativa no: si ricalcola, sotto)
DOPO_LA_RIGA = ("rs_1m", "rs_bench", "rs_ndx_1m", "qta", "pmc", "controvalore", "gain_pct_pos", "qty", "value", "gain",
                "gain_pct", "bval", "bgain", "risk_contrib_pct", "avg_corr", "max_corr", "max_corr_with", "beta_ndx",
                "stop_atr", "stop_violated", "cds", "short_interest")
PRIVATI = ("_ret_series", "_ret_dates")     # la pipeline li toglie prima di scrivere (strip_private)
# Campi dell'ISTANTE: la lettura di adesso vince anche quando e' vuota, perche' vuoto e' uno stato — fuori dalla sessione
#   estesa non c'e' un prezzo esteso, un filtro di sanita' scarta una variazione. Tenere quello del run vorrebbe dire
#   affiancare a un prezzo di adesso un prezzo esteso di ore prima (la classe v186)
DELL_ISTANTE = ("price", "price_asof", "price_asof_arretrata_da", "price_live", "price_src", "change_pct", "prepost",
                "prezzo_limite_aggiustato", "volume", "vol_ratio", "day_high", "day_low", "support", "resistance", "rsi",
                "signal", "signal_class", "sparks", "risk_reward", "risk_reward_base", "sma200_dist_pct",
                "sma50_dist_pct", "w52_high", "w52_low", "w52_dist_pct", "ath", "ath_dist_pct", "atr_14", "atr_pct",
                "tech_by_range", "smc", "fuori_mercato", "short_flusso", "sharpe_1y", "sortino_1y", "sharpe_6m",
                "sortino_6m")
TV_ISTANTE = ("tecnica", "performance", "ohlc")     # dentro tv: misure sulle barre, come quelle qui sopra
# Gli altri campi (multipli, conti, bilanci, settore, consenso, sensibilita', stagionalita', flottante…) sono STABILI: la
#   lettura di adesso vince solo se non perde niente di cio' che la pipeline ha. Una chiamata di Yahoo rifiutata fa uscire
#   una riga piu' povera — misurato il 30/10: AMZN, GOOGL, STX, WDC e TSM senza settore, multipli, consenso e flottante —
#   e il dato piu' fresco non deve cancellare quello completo


def _foglie(x, p=""):
    """I percorsi delle foglie NON vuote (un elenco vuoto, None e il settore «Altro» sono vuoti)."""
    if isinstance(x, dict):
        for k, v in x.items():
            yield from _foglie(v, f"{p}.{k}")
    elif isinstance(x, list):
        if x:
            yield p
    elif x is not None and not (p.endswith("sector") and x == "Altro"):
        yield p


def _perde(pipe, ora, nome=""):
    """True se `ora` non ha una foglia non vuota che `pipe` ha."""
    return bool(set(_foglie(pipe, nome)) - set(_foglie(ora, nome)))


def fonde(pipe, ora, oggi=None):
    """(riga, tenuti): la riga della pipeline con la lettura di adesso sopra, campo per campo, e i campi tenuti dalla
    pipeline perche' la lettura di adesso li perdeva. I campi calcolati dopo la riga non si toccano.
    `oggi` (giorno di New York, AAAA-MM-GG) decide un caso solo: la data dei conti che la lettura di adesso non porta
    perche' e' PASSATA (fetch_symbol tiene solo le date future) non si ripesca dal run."""
    out = dict(pipe or {})
    tenuti = []
    oggi = oggi or datetime.now(NEW_YORK).date().isoformat()
    for k, v in (ora or {}).items():
        if k in DOPO_LA_RIGA or k in PRIVATI or k == "ticker":
            continue
        if k == "earnings_date" and v is None and out.get(k) and str(out[k])[:10] < oggi:
            out[k] = None
        elif k == "tv" and isinstance(v, dict) and isinstance(out.get("tv"), dict):
            tv = dict(out["tv"])
            for s, sv in v.items():
                if s in TV_ISTANTE or not _perde(tv.get(s), sv, s):
                    tv[s] = sv
                else:
                    tenuti.append(f"tv.{s}")
            out["tv"] = tv
        elif k in DELL_ISTANTE or not _perde(out.get(k), v, k):
            out[k] = v
        else:
            tenuti.append(k)
    return out, tenuti


def ricalcola_posizione(r, bench_m1=None):
    """Dopo la fusione: controvalore e guadagno sul prezzo di adesso (gli stessi conti della pipeline in main, perche' un
    prezzo nuovo accanto a un guadagno vecchio e' due istanti in una riga, v316), e la forza relativa a un mese con
    update_data.forza_relativa sulle sparks nuove. Senza i benchmark letti adesso la forza relativa resta del run, e lo
    dice il campo `_rs_del_run`."""
    pz = r.get("price")
    if r.get("qta") and r.get("pmc") and pz:
        r["controvalore"] = round(float(pz) * float(r["qta"]), 2)
        r["gain_pct_pos"] = round((float(pz) / float(r["pmc"]) - 1) * 100, 2)
    if bench_m1 and any(v is not None for v in bench_m1.values()):
        r["rs_1m"], r["rs_bench"], r["rs_ndx_1m"] = _ud().forza_relativa(r["ticker"], r, bench_m1)
        r.pop("_rs_del_run", None)
    else:
        r["_rs_del_run"] = True
    return r


def leggi_righe(d, lettore=None, thread=THREAD_RIGHE, bench=None):
    """{"esito", "per_titolo": {tk: riga}, "non_letti", "parziali": {tk: campi tenuti dalla pipeline}, "bench_m1"}.
    Una riga che perde qualcosa rispetto alla pipeline si rilegge UNA volta (una chiamata rifiutata e' quasi sempre di
    quell'istante), e si tiene la lettura che perde meno. `lettore(riga) -> riga o None` e `bench() -> dict` si
    sostituiscono nei gate."""
    ud = _ud()
    righe = [r for r in ((d or {}).get("watchlist") or []) if isinstance(r, dict) and r.get("ticker")]
    pipe = {r["ticker"]: r for r in righe}
    if lettore is None:
        ud.PREV_DATA = d or {}
        conf = {w.get("ticker"): w for w in (getattr(ud, "WATCHLIST", None) or []) if isinstance(w, dict)}
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            # ⚠ le cache della pipeline si riempiono UNA volta, prima dei thread: _CANALI si riempie un canale alla
            #   volta, e un thread che la trova a meta' perde i canali che mancano — misurato il 30/10/2026: MU e BE
            #   senza settore, tassi e dollaro. La pipeline gira in sequenza e non lo vede
            ud.canali_macro()

        def lettore(r):
            w = conf.get(r["ticker"]) or {}
            return ud.fetch_symbol(r["ticker"], w.get("name") if w else r.get("name"),
                                   w.get("currency", "USD") if w else (r.get("currency") or "USD"))
    if bench is None:
        bench = ud.benchmark_mese
    t0 = time.time()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            bench_m1 = bench()
        except Exception:  # noqa: BLE001 — senza benchmark la forza relativa resta del run, dichiarata
            bench_m1 = None
        letti = _in_parallelo(lambda tk: lettore(pipe[tk]), list(pipe), thread=thread)

        def conta(tk, x):
            return None if not x else len(fonde(pipe[tk], x)[1])
        da_rileggere = [tk for tk, x in letti.items() if not x or conta(tk, x)]
        if da_rileggere:
            nuovi = _in_parallelo(lambda tk: lettore(pipe[tk]), da_rileggere, thread=3)
            for tk, x in nuovi.items():
                if x and (not letti.get(tk) or conta(tk, x) < conta(tk, letti[tk])):
                    letti[tk] = x
    per_titolo, parziali, rendimenti = {}, {}, {}
    for tk, x in letti.items():
        if not x:
            continue
        per_titolo[tk] = {k: v for k, v in x.items() if k not in PRIVATI}
        if x.get("_ret_series") and x.get("_ret_dates"):
            rendimenti[tk] = (x["_ret_series"], x["_ret_dates"])
        t = fonde(pipe[tk], x)[1]
        if t:
            parziali[tk] = t
    # `_rendimenti` serve al giro (il lato azionario di CDS e short sugli stessi rendimenti della riga, senza scaricarli
    #   una seconda volta) e non si scrive su disco: leggi_alla_fonte lo toglie
    return {"esito": "letto" if per_titolo else "non letto", "per_titolo": per_titolo,
            "non_letti": sorted(tk for tk in pipe if tk not in per_titolo), "parziali": parziali,
            "riletti": sorted(da_rileggere), "bench_m1": bench_m1, "righe_pipeline": len(pipe),
            "secondi": round(time.time() - t0, 1), "_rendimenti": rendimenti}


def con_righe(d, rg):
    """Una copia di data.json con le righe lette adesso fuse sopra (fonde), senza i ricalcoli di posizione: serve al
    giro, perche' tabelle dei trimestri, flottante e CDS si giudichino sulle righe di adesso."""
    if not d:
        return d
    out = copy.deepcopy(d)
    pt = (rg or {}).get("per_titolo") or {}
    for r in _righe(out):
        x = pt.get(r["ticker"])
        if x:
            nuova = fonde(r, x)[0]
            r.clear()
            r.update(nuova)
    return out


def leggi_btp(get=None):
    """v521 — il prezzo del BTP da Borsa Italiana, con la funzione della pipeline (update_data.leggi_prezzo_btp)."""
    try:
        x = _ud().leggi_prezzo_btp(get)
    except Exception as e:  # noqa: BLE001
        return {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    if not x or not x.get("prezzo"):
        return {"esito": "non letto", "errore": "Borsa Italiana non ha risposto o la pagina non porta il prezzo"}
    return {"esito": "letto", **x}


def leggi_leva(fetch=None):
    """v521 — il debito a margine da FINRA, con la funzione della pipeline e SENZA il suo ripiego sul run precedente
    (qui il run precedente e' la pipeline stessa: riportarlo sarebbe leggere due volte la stessa cosa). La Fed Z.1 e'
    un'altra misura, piu' piccola, che la pipeline usa come ultima spiaggia marcandola inaffidabile: qui non vale."""
    try:
        md = (fetch or _ud().fetch_margin_debt)(None)
    except Exception as e:  # noqa: BLE001
        return {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    if not isinstance(md, dict) or not md.get("date"):
        return {"esito": "non letto", "errore": "FINRA non ha risposto"}
    if md.get("unreliable") or md.get("carried") or "FINRA" not in str(md.get("series") or ""):
        return {"esito": "non letto", "errore": "FINRA non ha risposto (resta la sola Fed Z.1, un'altra misura)"}
    return {"esito": "letto", "valore": md}


def semina_debito(repo=None, sessione=None):
    """v522 — la cache del debito della sessione parte da quella del repo (data/debito_sec.json, scritta dalla
    pipeline): per ogni nome vale la lettura del bilancio piu' recente, a parita' quella della versione corrente, poi
    la piu' recente letta. Cosi' companyfacts si legge solo per i bilanci che NESSUNO dei due ha ancora letto. Ritorna
    il percorso della cache della sessione."""
    ud = _ud()
    rp = Path(repo) if repo else Path(ud.DEBITO_SEC)
    sp = Path(sessione) if sessione else DEBITO_SESSIONE

    def per(p):
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("per_titolo") or {}
        except (OSError, ValueError, AttributeError):
            return {}

    def chiave(x):
        dep = (x or {}).get("deposito") or {}
        return (str(dep.get("data") or ""), (x or {}).get("versione") == ud.XBRL_VERSIONE,
                str((x or {}).get("letto_il") or ""))
    a, b = per(rp), per(sp)
    out = {tk: max([x for x in (a.get(tk), b.get(tk)) if x], key=chiave) for tk in set(a) | set(b)}
    sp.parent.mkdir(parents=True, exist_ok=True)
    tmp = sp.with_suffix(".tmp")
    tmp.write_text(json.dumps({"aggiornato": datetime.now(timezone.utc).date().isoformat(), "per_titolo": out,
                               "seme": str(rp)}, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, sp)
    return sp


def leggi_edgar(posizioni=(), get=None, percorso=None, repo=None, watchlist=None, pausa=0.12, pausa_xbrl=0.15):
    """v522 — il giro di SEC EDGAR con la funzione della pipeline (update_data.sec_edgar_da) e la sua intestazione, sui
    nomi che la pipeline segue (config/ui_watchlist.json), senza il tetto di dieci bilanci per run. Non solleva mai."""
    ud = _ud()
    t0 = time.time()
    try:
        p = semina_debito(repo, percorso)
        if watchlist is None:
            with contextlib.redirect_stdout(io.StringIO()):
                _, watchlist, _ = ud.load_holdings()
        seguiti = ud.seguiti_sec(watchlist)
        r = ud.sec_edgar_da(seguiti, posizioni=list(posizioni or ()), get=get, ua=ud.SEC_UA, percorso_debito=p,
                            budget=max(len(seguiti), 1), pausa=pausa, pausa_xbrl=pausa_xbrl)
    except Exception as e:  # noqa: BLE001
        return {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    return {"esito": "letto", **r, "seguiti": len(seguiti), "secondi": round(time.time() - t0, 1)}


def periodici_edgar(lettura):
    """{tk: {forma: data}} dell'ultimo 10-Q o 10-K letto adesso da EDGAR: la stessa forma di periodici_da (Yahoo),
    perche' ferme e la resa ne leggano una sola. Le modifiche («10-Q/A») contano come la forma di base."""
    return {tk: {str(ub["forma"]).split("/")[0]: ub["data"]}
            for tk, ub in ((lettura or {}).get("bilanci") or {}).items() if ub and ub.get("forma") and ub.get("data")}


def applica_edgar(m, lettura):
    """v522 — il calendario dei risultati, le ore, la storia della quotazione e il debito letti adesso al posto del run.
    Un nome che SEC non ha restituito in questo giro tiene la voce del run, DICHIARATO in `_sessione.dalla_pipeline`."""
    if (lettura or {}).get("esito") != "letto":
        return "pipeline (" + ((lettura or {}).get("errore") or "non letto") + ")"
    err = lettura.get("errori_titoli") or {}
    p_cal = m.get("sec_calendario") or {}
    cal = copy.deepcopy(lettura.get("sec_calendario"))
    tenuti = []
    if cal:
        for tk in sorted(err):
            preso = False
            for sotto in (None, "ore_depositi", "storia_quotazione"):
                src = p_cal.get(sotto) if sotto else p_cal
                dst = cal.setdefault(sotto, {}) if sotto else cal
                v = ((src or {}).get("per_titolo") or {}).get(tk)
                if v is not None:
                    dst.setdefault("per_titolo", {})[tk] = v
                    preso = True
            if tk in (p_cal.get("senza_8k") or []) and tk not in (cal.get("senza_8k") or []):
                cal.setdefault("senza_8k", []).append(tk)
                preso = True
            if preso:
                tenuti.append(tk)
        cal["_sessione"] = {"letto": True, "dalla_pipeline": tenuti, "errori": err}
        m["sec_calendario"] = cal
    ds = copy.deepcopy(lettura.get("debito_sec"))
    if ds is not None:
        p_ds = (m.get("debito_sec") or {}).get("per_titolo") or {}
        for tk in sorted(err):
            if tk in p_ds and tk not in ds.setdefault("per_titolo", {}):
                ds["per_titolo"][tk] = p_ds[tk]
        m["debito_sec"] = ds
    parti = [f"SEC EDGAR letto adesso per {lettura.get('seguiti')} nomi"]
    if not cal:
        parti.append("calendario del run (la lettura non ha restituito nessun nome)")
    if tenuti:
        parti.append("del run per " + ", ".join(tenuti) + " (SEC non li ha restituiti)")
    if ds is None:
        parti.append("debito del run (" + (lettura.get("errore_debito") or "non letto") + ")")
    elif ds.get("letti_ora"):
        parti.append("bilanci letti ora: " + ", ".join(ds["letti_ora"]))
    return "fonte (" + "; ".join(parti) + ")"


def leggi_etf(lettore=None):
    """v522 — le prime cinque partecipazioni di ogni ETF della rotazione, con update_data.prime_etf."""
    ud = _ud()
    simboli = list(ud.SECTOR_ETF)
    letti = _in_parallelo(lettore or ud.prime_etf, simboli)
    per = {s: v for s, v in letti.items() if v}
    return {"esito": "letto" if per else "non letto", "per_etf": per,
            "vuoti": sorted(s for s in simboli if not letti.get(s)),
            "giorno": datetime.now(NEW_YORK).date().isoformat()}


def applica_etf(m, lettura):
    """v522 — la composizione letta adesso al posto di quella del run, ETF per ETF; un ETF che il fornitore non ha
    restituito tiene quella del run. Senza macro.tilt nel run le righe si costruiscono da update_data.SECTOR_ETF (nome e
    gruppo), cosi' la rotazione ha il suo universo anche quando la pipeline non l'ha scritto."""
    if (lettura or {}).get("esito") != "letto":
        return "pipeline (" + ((lettura or {}).get("errore") or "non letta") + ")"
    per = lettura.get("per_etf") or {}
    tilt = m.get("tilt")
    costruite = not tilt
    if costruite:
        tilt = [{"ticker": s, "name": n, "group": g, "prime": []} for s, (n, g) in _ud().SECTOR_ETF.items()]
    tenuti = []
    for r in tilt:
        v = per.get(r.get("ticker"))
        if v:
            r["prime"] = v
            r["prime_letto_il"] = lettura.get("giorno")
        elif r.get("prime"):
            tenuti.append(r["ticker"])
    m["tilt"] = tilt
    return ("fonte (composizione letta adesso per " + str(len(per)) + " ETF"
            + ("; righe costruite da SECTOR_ETF: il run non porta macro.tilt" if costruite else "")
            + (f"; del run per {', '.join(tenuti)}" if tenuti else "")
            + (f"; senza composizione: {', '.join(lettura['vuoti'])}" if lettura.get("vuoti") else "") + ")")


def leggi_alla_fonte(d, nomi):
    """Il giro: le letture in parallelo (CDS dopo FedWatch, che ne da' il tasso). Non solleva mai."""
    t0 = time.time()
    g = {k: {"esito": "non letto"} for k in BLOCCHI}
    ud = _ud()

    def fw():
        return ud.fedwatch_da()
    # 1. le righe (le piu' lunghe), FedWatch, SEC EDGAR e la composizione degli ETF insieme: nessuno dipende dalle righe
    with ThreadPoolExecutor(4) as ex:
        f_rg = ex.submit(leggi_righe, d)
        f_fw = ex.submit(fw)
        f_ed = ex.submit(leggi_edgar, nomi)       # v522
        f_etf = ex.submit(leggi_etf)              # v522
        g["edgar"] = f_ed.result()
        try:
            g["etf"] = f_etf.result()
        except Exception as e:  # noqa: BLE001
            g["etf"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            g["righe"] = f_rg.result()
        except Exception as e:  # noqa: BLE001
            g["righe"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            g["fedwatch"] = {"esito": "letto", "valore": f_fw.result()}
        except Exception as e:  # noqa: BLE001
            g["fedwatch"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    rend = g["righe"].pop("_rendimenti", None) or {}
    # 2. il resto sulle righe GIA' FUSE: una tabella dei trimestri ferma si giudica su quella di adesso (Yahoo puo' aver
    #    gia' portato il trimestre), e il flottante delle vendite allo scoperto e' quello di adesso
    dd = con_righe(d, g["righe"])
    if dd:
        applica_edgar(dd.setdefault("macro", {}), g["edgar"])     # v522 — le tabelle ferme sui depositi di adesso

    def rend_di(tks):
        """I rendimenti delle righe lette adesso; si scaricano a parte solo quelli che mancano."""
        manca = [tk for tk in tks if tk not in rend]
        return {**{tk: rend[tk] for tk in tks if tk in rend}, **(rendimenti_di(manca) if manca else {})}
    # gli analisti vengono dalla riga (fetch_symbol chiama update_data.analisti_da): si rileggono a parte solo i nomi
    #   che la riga non ha portato
    dalla_riga = {tk: x.get("analisti") for tk, x in ((g["righe"].get("per_titolo") or {}).items()) if tk in set(nomi)}

    def an_resto():
        resto = [tk for tk in nomi if not dalla_riga.get(tk)]
        return {**dalla_riga, **(leggi_analisti(resto) if resto else {})}
    with ThreadPoolExecutor(5) as ex:
        f_an = ex.submit(an_resto)
        # v522 — le date dei 10-Q e 10-K da Yahoo solo se EDGAR non ha risposto: un ripiego, non una seconda derivazione
        f_sec = None if g["edgar"].get("esito") == "letto" else ex.submit(leggi_sec, nomi)
        f_si = ex.submit(leggi_short, dd, rend_di)
        f_btp = ex.submit(leggi_btp)       # v521
        f_lv = ex.submit(leggi_leva)       # v521
        g["btp"] = f_btp.result()
        g["leva"] = f_lv.result()
        try:
            an = f_an.result()
            g["analisti"] = {"esito": "letto", "per_titolo": {k: v for k, v in an.items() if v},
                             "vuoti": sorted(k for k, v in an.items() if not v),
                             "dalla_riga": sorted(k for k, v in dalla_riga.items() if v)}
        except Exception as e:  # noqa: BLE001
            g["analisti"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        if f_sec is None:
            g["sec"] = {"esito": "letto", "fonte": "SEC EDGAR", "per_titolo": periodici_edgar(g["edgar"]),
                        "non_letti": sorted(g["edgar"].get("errori_titoli") or {})}
        else:
            try:
                sec = f_sec.result()
                g["sec"] = {"esito": "letto", "fonte": "Yahoo, ripiego: EDGAR "
                            + (g["edgar"].get("errore") or "non letto"),
                            "per_titolo": {k: v for k, v in sec.items() if v is not None},
                            "non_letti": sorted(k for k, v in sec.items() if v is None)}
            except Exception as e:  # noqa: BLE001
                g["sec"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            g["short"] = f_si.result()
        except Exception as e:  # noqa: BLE001
            g["short"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    try:
        _fe = ferme(dd, (g["sec"] or {}).get("per_titolo"))
        _fe = {k: v for k, v in _fe.items() if k in set(nomi)}
        _nq = leggi_trimestri(sorted(_fe)) if _fe else {}
        righe_d = {r["ticker"]: r for r in _righe(dd)}
        g["trimestri"] = {"esito": "letto", "ferme": _fe,
                          "per_titolo": {tk: completa_trimestri(((righe_d.get(tk) or {}).get("tv") or {}).get("conto_trim"),
                                                                _nq.get(tk))
                                         for tk in sorted(_fe)},
                          "non_letti": sorted(tk for tk in _fe if not _nq.get(tk))}
    except Exception as e:  # noqa: BLE001
        g["trimestri"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    try:
        mappa = json.loads(Path(ud.CDS_ENTITA).read_text(encoding="utf-8"))
        quotabili = [tk for tk, c in (mappa.get("entita") or {}).items() if c]

        def rend_cds():
            return rend_di([r["ticker"] for r in _righe(dd) if r["ticker"] in quotabili])
        g["cds"] = leggi_cds(dd, (g["fedwatch"] or {}).get("valore"), rendimenti=rend_cds, mercato=mercato_qqq)
    except Exception as e:  # noqa: BLE001
        g["cds"] = {"esito": "non letto", "errore": f"{type(e).__name__}: {str(e)[:120]}"}
    g["secondi"] = round(time.time() - t0, 1)
    return _jsonabile(g)


def _jsonabile(x):
    return json.loads(json.dumps(x, default=lambda o: o.isoformat() if hasattr(o, "isoformat") else str(o)))


# ══════════════════════════════════ LA LETTURA DEL GIRO E LA SOVRAPPOSIZIONE ════════════════════════════════════
def _carica_pipeline():
    try:
        return json.loads((RADICE / "data" / "data.json").read_text(encoding="utf-8").replace("NaN", "null"))
    except (OSError, ValueError):
        return None


def leggi(forza=False, percorso=None, max_minuti=VALIDITA_MINUTI, adesso=None, d=None, nomi=None):
    """La lettura del giro, riusata se scritta da meno di `max_minuti`; altrimenti si legge alla fonte e si scrive."""
    p = Path(percorso) if percorso else CACHE
    ora = adesso or datetime.now(timezone.utc)
    if not forza:
        c = dal_disco(p, max_minuti, ora)
        if c:
            return c
    d = _carica_pipeline() if d is None else d
    if nomi is None:
        a, b = nomi_libro()
        nomi = a + b
    g = leggi_alla_fonte(d, nomi)
    g["letto"] = ora.isoformat()
    g["run"] = (d or {}).get("updated_at")
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as e:
        g["errore_scrittura"] = f"lettura non salvata ({e}): gli altri strumenti useranno la pipeline"
    return g


def dal_disco(percorso=None, max_minuti=VALIDITA_MINUTI, adesso=None):
    """La lettura del giro dal disco se valida, altrimenti None. Non legge MAI la rete: chi carica data.json la usa se
    c'e' (scripts/analisi.py la fa scrivere prima di tutti), e se non c'e' resta sulla pipeline e lo dice."""
    p = Path(percorso) if percorso else CACHE
    ora = adesso or datetime.now(timezone.utc)
    try:
        c = json.loads(p.read_text(encoding="utf-8"))
        t = datetime.fromisoformat(c["letto"])
        if timedelta(0) <= ora - t <= timedelta(minutes=max_minuti):
            return c
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def sovrapponi(d, giro):
    """Una copia di data.json con la lettura di adesso al posto della pipeline, blocco per blocco, dove e' piu'
    recente. macro._fonti_titoli dice quale ha vinto per ciascun blocco: chi stampa lo dichiara."""
    if not d:
        return d
    out = copy.deepcopy(d)
    m = out.setdefault("macro", {})
    esiti = {}
    if not giro:
        m["_fonti_titoli"] = {"letto": None, "esiti": {k: "pipeline (nessuna lettura alla fonte in questo giro)"
                                                        for k in BLOCCHI}}
        return out
    an = giro.get("analisti") or {}
    sec = giro.get("sec") or {}
    cds = giro.get("cds") or {}
    si = giro.get("short") or {}
    rg = giro.get("righe") or {}
    rg_pt = rg.get("per_titolo") or {}
    rifatti_an, completati, dalla_fonte, tenuti, rs_run = [], [], [], {}, []
    for r in _righe(out):
        tk = r["ticker"]
        x = rg_pt.get(tk)
        if x:
            nuova, t = fonde(r, x)
            r.clear()
            r.update(ricalcola_posizione(nuova, rg.get("bench_m1")))
            dalla_fonte.append(tk)
            if t:
                tenuti[tk] = t
            if r.get("_rs_del_run"):
                rs_run.append(tk)
        v = (an.get("per_titolo") or {}).get(tk)
        if v:
            r["analisti"] = v
            rifatti_an.append(tk)
        if cds.get("esito") == "rifatto" and tk in (cds.get("per_titolo") or {}):
            r["cds"] = cds["per_titolo"][tk]
        if si.get("esito") == "rifatto" and tk in (si.get("per_titolo") or {}):
            r["short_interest"] = si["per_titolo"][tk]
        if tk in (sec.get("per_titolo") or {}):
            r["_periodici"] = sec["per_titolo"][tk]
        nq = ((giro.get("trimestri") or {}).get("per_titolo") or {}).get(tk) or {}
        tv = r.get("tv") if isinstance(r.get("tv"), dict) else {}
        # v519 — un trimestre che la riga di adesso porta gia' non si aggiunge una seconda volta
        gia = {str(x.get("trim")) for x in (tv.get("conto_trim") or [])}
        nuovi = [x for x in (nq.get("nuovi") or []) if str(x.get("trim")) not in gia]
        if nuovi:
            tv = r.setdefault("tv", {})
            tv["conto_trim"] = sorted(nuovi + list(tv.get("conto_trim") or []),
                                      key=lambda x: str(x.get("trim")), reverse=True)
            completati.append(tk)
    n_pipe = len([r for r in _righe(out) if not str(r["ticker"]).startswith("BTP")])
    esiti["righe"] = ((f"fonte per {len(dalla_fonte)} titoli su {n_pipe}"
                       + (f"; campi tenuti dalla pipeline perche' la lettura di adesso li perdeva: "
                          + "; ".join(f"{tk} ({', '.join(c)})" for tk, c in sorted(tenuti.items())) if tenuti else "")
                       + (f"; forza relativa del run (benchmark non letti adesso): {', '.join(rs_run)}" if rs_run else ""))
                      if dalla_fonte else "pipeline (" + (rg.get("errore") or "nessuna riga letta alla fonte") + ")")
    esiti["analisti"] = (f"fonte per {len(rifatti_an)} titoli" if rifatti_an else
                         "pipeline (" + (an.get("errore") or "nessun titolo letto alla fonte") + ")")
    fw = (giro.get("fedwatch") or {}).get("valore")
    if fw:
        m["fedwatch"] = fw
        esiti["fedwatch"] = "fonte"
    else:
        esiti["fedwatch"] = "pipeline (" + ((giro.get("fedwatch") or {}).get("errore") or "non letto") + ")"
    if cds.get("esito") == "rifatto" and cds.get("macro"):
        m["cds"] = cds["macro"]
        esiti["cds"] = "fonte (ICE piu' avanti della pipeline)"
    else:
        esiti["cds"] = "pipeline (" + (cds.get("esito") or "non letto") + ")"
    if si.get("esito") == "rifatto" and si.get("macro"):
        m["short_interest"] = si["macro"]
        esiti["short"] = "fonte (FINRA piu' avanti della pipeline)"
    else:
        esiti["short"] = "pipeline (" + (si.get("esito") or "non letto") + ")"
    esiti["btp"] = applica_btp(out, giro.get("btp") or {})
    esiti["leva"] = applica_leva(m, giro.get("leva") or {})
    esiti["edgar"] = applica_edgar(m, giro.get("edgar") or {})     # v522
    esiti["etf"] = applica_etf(m, giro.get("etf") or {})           # v522
    esiti["sec"] = (f"date dei depositi dalla fonte ({sec.get('fonte') or 'Yahoo'})" if sec.get("esito") == "letto"
                    else "solo la pipeline")
    esiti["trimestri"] = (f"Nasdaq per {', '.join(completati)} (verificato sul trimestre in comune)" if completati
                          else "pipeline")
    m["_fonti_titoli"] = {"letto": giro.get("letto"), "esiti": esiti}
    return out


CAMPI_BTP = ("price", "price_asof", "price_src", "value", "gain", "gain_pct", "rateo_netto")


def applica_btp(d, lettura):
    """v521 — il prezzo del BTP letto adesso al posto di quello del run, se e' almeno della stessa seduta. Una lettura
    senza data non scavalca un prezzo datato (v396); la riga si rifa' con update_data.fetch_btp, la funzione della
    pipeline, e se ne prendono solo prezzo e valori: carico e nominale restano quelli del run."""
    r = next((x for x in ((d or {}).get("portfolio") or []) if isinstance(x, dict)
              and str(x.get("ticker", "")).startswith("BTP")), None)
    if r is None:
        return "nessuna riga del BTP nel run"
    if lettura.get("esito") != "letto":
        return "pipeline (" + (lettura.get("errore") or "non letto") + "; prezzo del run: " + str(r.get("price_src")
                                                                                              or "fonte non dichiarata") + ")"
    pa, la = r.get("price_asof"), lettura.get("data")
    if pa and (not la or la < pa):
        return (f"pipeline (il run ha il prezzo del {_data_it(pa)}, la lettura di adesso "
                + (f"del {_data_it(la)}" if la else "senza data") + ")")
    nuova = _ud().fetch_btp(None, lettura)
    for k in CAMPI_BTP:
        r[k] = nuova.get(k)
    return f"fonte ({lettura.get('voce')} del {_data_it(la)})" if la else "fonte (Borsa Italiana, senza data nella pagina)"


def applica_leva(m, lettura):
    """v521 — il debito a margine letto adesso al posto di quello del run, se il mese e' almeno lo stesso: vale
    l'ultimo dato ufficiale, da qualunque parte arrivi (v511). Un run che riportava il mese prima o che stava sulla
    Fed Z.1 cede il posto a FINRA letta adesso."""
    from stato_sistema import giorno_it     # il mese per nome, una resa sola (v392)
    p = m.get("margin_debt") or {}
    if lettura.get("esito") != "letto":
        stato = ("riportato dal run precedente" if p.get("carried") else
                 "Fed Z.1, un'altra misura" if p.get("unreliable") else giorno_it(p.get("date"), mese=True))
        return "pipeline (" + (lettura.get("errore") or "non letto") + f"; nel run: {stato})"
    v = lettura["valore"]
    if p.get("date") and not (p.get("carried") or p.get("unreliable")) and str(v["date"]) < str(p["date"]):
        return (f"pipeline (il run ha {giorno_it(p['date'], mese=True)}, piu' recente della lettura di adesso, "
                f"{giorno_it(v['date'], mese=True)})")
    m["margin_debt"] = v
    return f"fonte (FINRA, {giorno_it(v['date'], mese=True)})"


def carica(d=None, percorso=None, adesso=None, ufficiali=None):
    """data.json con la lettura del giro sovrapposta, se c'e' (mai la rete), e i conti dei comunicati ufficiali
    registrati (v513). Con TRADING_FONTI_TITOLI=spenta resta la pipeline: le suite non devono dipendere da una lettura
    scritta da un'analisi di mezz'ora prima, ne' dal registro dei comunicati che cresce a ogni trimestre."""
    d = _carica_pipeline() if d is None else d
    if d is None or os.environ.get(SPENTA) == "spenta":
        return d
    out = sovrapponi(d, dal_disco(percorso, adesso=adesso))
    reg = leggi_ufficiali(ufficiali)
    es = applica_ufficiali(out, reg)
    usati = sorted(tk for tk, v in es.items() if v["esito"] in ("aggiunto", "sostituito"))
    ft = out.setdefault("macro", {}).setdefault("_fonti_titoli", {"letto": None, "esiti": {}})
    ft.setdefault("esiti", {})["comunicati"] = (
        f"comunicato ufficiale per {', '.join(usati)} (confronti dal comunicato stesso)" if usati else
        "nessun comunicato registrato in uso" + (f" (registro {reg['stato']})" if reg["stato"] != "letto" else ""))
    return out


# ══════════════════════════════════ LA RESA ══════════════════════════════════════════════════════════════════════
def _n(x, dec=2):
    return f"{x:.{dec}f}".replace(".", ",").replace("-", "−") if isinstance(x, (int, float)) else "n.d."


def _data_it(g):
    g = str(g or "")[:10]
    return f"{g[8:10]}/{g[5:7]}/{g[0:4]}" if len(g) == 10 else "n.d."


def future_aperti(adesso=None):
    """Se i future CME quotano adesso: domenica dalle 18:00 a venerdi' alle 17:00 di New York, pausa 17-18 ogni giorno.
    Le festivita' CME non sono note al calcolo: in quei giorni la riga dice «aperti» e il prezzo e' quello di prima."""
    ny = (adesso or datetime.now(timezone.utc)).astimezone(NEW_YORK)
    g, h = ny.weekday(), ny.hour
    if g == 5 or (g == 6 and h < 18) or (g == 4 and h >= 17):
        return False
    return h != 17


def cambi_analisti(pipe, fonte):
    """Le differenze fra il consenso della pipeline e quello letto adesso, sulle grandezze che l'analisi legge."""
    out = []
    for k, nome, dec in (("eps_ora", "utile atteso", 2), ("target_mediana", "target mediano", 2),
                         ("su_30g", "rialzi a 30 g", 0), ("giu_30g", "tagli a 30 g", 0)):
        a, b = (pipe or {}).get(k), (fonte or {}).get(k)
        if a != b:
            out.append(f"{nome} {_n(a, dec)} → {_n(b, dec)}")
    return out


def riga_riunione(v):
    if not v.get("prezzata_dal_contratto"):
        return f"{_data_it(v.get('riunione') or v.get('date'))}: non prezzata ({v.get('motivo') or 'contratto non letto'})"
    rami = []
    if v.get("hike_prob") is not None:
        rami.append(f"RIALZO {v['hike_prob']}%")
    if v.get("cut_prob") is not None:
        rami.append(f"TAGLIO {v['cut_prob']}%")
    if v.get("hold_prob") is not None:
        rami.append(f"invariato {v['hold_prob']}%")
    m = v.get("mosse_25bp")
    s = f"{_data_it(v.get('riunione') or v.get('date'))}: {'+' if (m or 0) > 0 else ''}{_n(m)} movimenti da 25 pb"
    if v.get("mosse_cumulate") is not None and v.get("mosse_cumulate") != m:
        s += f" ({'+' if v['mosse_cumulate'] > 0 else ''}{_n(v['mosse_cumulate'])} cumulati da oggi)"
    return s + (f" — {' · '.join(rami)}" if rami else " — sopra il movimento intero non e' una probabilita'")


def sintesi(d, giro, adesso=None, ufficiali=None):
    """Il blocco DATI PER TITOLO: per ciascuno la fonte che ha vinto, il confronto con la pipeline, e cosa cercare in
    rete perche' nemmeno la fonte e' aggiornata. `ufficiali`: il percorso del registro dei comunicati (v513)."""
    ora = adesso or datetime.now(timezone.utc)
    # il registro dei comunicati cresce a ogni trimestre: con TRADING_FONTI_TITOLI=spenta le suite non lo leggono (come
    #   carica), salvo un percorso esplicito
    uff_reg = (leggi_ufficiali(ufficiali) if ufficiali or os.environ.get(SPENTA) != "spenta"
               else {"stato": "spento", "comunicati": [], "difetti": []})
    uff_es = applica_ufficiali(sovrapponi(d, giro), uff_reg) if d else {}
    L = ["DATI PER TITOLO — LA PIPELINE E LA FONTE LETTA ADESSO (v512)"]
    run = (d or {}).get("updated_at")
    eta = None
    if run:
        try:
            eta = (ora - datetime.fromisoformat(str(run).replace("Z", "+00:00"))).total_seconds() / 3600
        except ValueError:
            pass
    letto = (giro or {}).get("letto")
    L.append(f"  run della pipeline {run or 'n.d.'}" + (f" ({_n(eta, 1)} ore fa)" if eta is not None else "")
             + (f" · lettura alla fonte {datetime.fromisoformat(letto).astimezone(ROMA):%d/%m %H:%M} ora italiana"
                f" ({_n((giro or {}).get('secondi'), 1)} s)" if letto else " · NESSUNA lettura alla fonte in questo giro"))
    L.append("  OGNI QUANTO CAMBIANO:")
    for _k, nome, testo in CADENZE:
        L.append(f"    · {nome}: {testo}")
    L.append("    · " + CADENZA_PIPELINE)
    cercare = []
    righe = {r["ticker"]: r for r in _righe(d)}
    g = giro or {}
    L.extend(righe_righe(d, g.get("righe") or {}, cercare))
    # analisti
    an = g.get("analisti") or {}
    if an.get("esito") == "letto":
        pt = an.get("per_titolo") or {}
        cambiati = []
        for tk, v in sorted(pt.items()):
            c = cambi_analisti((righe.get(tk) or {}).get("analisti"), v)
            if c:
                cambiati.append(f"{tk} ({'; '.join(c)})")
        vuoti = an.get("vuoti") or []
        tenuti = [t for t in vuoti if (righe.get(t) or {}).get("analisti")]
        L.append(f"  · ANALISTI: letti adesso per {len(pt)} titoli; rispetto al run della pipeline "
                 + (f"CAMBIATI in {len(cambiati)}: " + ", ".join(cambiati) if cambiati else "nessuna differenza")
                 + (f" · Yahoo non restituisce niente per {', '.join(vuoti)}"
                    + (f" (vale la pipeline per {', '.join(tenuti)}, dichiarato)" if tenuti else "") if vuoti else ""))
    else:
        L.append(f"  · ANALISTI: NON letti alla fonte ({an.get('errore') or 'n.d.'}): valgono quelli del run della "
                 "pipeline")
        cercare.append("consenso e target dei nomi in esame: la fonte non ha risposto")
    # fedwatch
    fw = g.get("fedwatch") or {}
    pfw = ((d or {}).get("macro") or {}).get("fedwatch") or {}
    if fw.get("esito") == "letto" and fw.get("valore"):
        v = fw["valore"]
        ef = v.get("effr") or {}
        L.append(f"  · FEDWATCH: dai contratti letti adesso"
                 + ("" if future_aperti(ora) else " — mercato dei future CHIUSO: sono le quotazioni dell'ultima seduta")
                 + f"; EFFR {_n(ef.get('valore'))}% del {_data_it(ef.get('data'))} ({ef.get('fonte') or 'n.d.'})"
                 + f" · fascia {v.get('target_range') or 'n.d.'}")
        prec = {x.get("riunione") or x.get("date"): x for x in (pfw.get("meetings") or [])}
        for x in (v.get("meetings") or [])[:4]:
            p = prec.get(x.get("riunione") or x.get("date"))
            dif = ""
            if p and p.get("mosse_25bp") != x.get("mosse_25bp"):
                dif = f" (nel run della pipeline: {_n(p.get('mosse_25bp'))})"
            L.append("      " + riga_riunione(x) + dif)
    else:
        L.append(f"  · FEDWATCH: NON letto alla fonte ({fw.get('errore') or 'n.d.'}): vale il run della pipeline")
        cercare.append("le probabilita' della prossima riunione Fed (CME FedWatch, mercati di previsione)")
    # cds
    cd = g.get("cds") or {}
    pcd = ((d or {}).get("macro") or {}).get("cds") or {}
    if cd.get("esito") in ("rifatto", "stesso giorno"):
        ice = cd.get("ice") or {}
        dd = ", ".join(f"{k}: {n}" for k, n in sorted((ice.get("date") or {}).items()))
        s = f"  · CDS (ICE): ultimo giorno {ice.get('data')} ({dd} entita')"
        if cd["esito"] == "rifatto":
            s += (f"; la pipeline era INDIETRO per {', '.join(cd.get('nuovi') or []) or 'nessun nome'}"
                  + (f" e per gli indici {', '.join(cd['indici_nuovi'])}" if cd.get("indici_nuovi") else "")
                  + ": misure rifatte sul giorno nuovo con le funzioni della pipeline")
        else:
            ind = ", ".join(f"{k} {v.get('data')}" for k, v in sorted((pcd.get("indici") or {}).items()))
            s += f"; la pipeline ha gli stessi giorni (indici CDX: {ind or 'n.d.'})"
        if cd.get("conservati"):
            s += (f" · giorni che lo storico del repo non ha, conservati in memoria/cds_sessione.jsonl per la pipeline: "
                  f"{', '.join(cd['conservati'])}")
        L.append(s)
    else:
        L.append(f"  · CDS (ICE): NON letto ({cd.get('errore') or 'n.d.'}): valgono il giorno e lo storico della "
                 f"pipeline ({pcd.get('data') or 'n.d.'})")
    L.append("    lo storico dei CDS non ha una fonte alternativa (ICE pubblica solo l'ultimo giorno, DTCC risponde 403 "
             "anche dai runner di GitHub: v498): lo raccoglie la pipeline, e un giorno in cui non gira la sera lo "
             "raccoglie questa lettura")
    # short
    si = g.get("short") or {}
    psi = ((d or {}).get("macro") or {}).get("short_interest") or {}
    pros = si.get("prossimo") or psi.get("prossimo") or {}
    if si.get("esito") in ("rifatto", "stesso regolamento"):
        s = (f"  · VENDITE ALLO SCOPERTO (FINRA): regolamento {si.get('regolamento')}"
             + (f", pubblicato il {_data_it(si.get('pubblicato'))}" if si.get("pubblicato") else ""))
        s += ("; la pipeline aveva quello del " + str(psi.get("regolamento")) + ": misure rifatte"
              if si["esito"] == "rifatto" else "; la pipeline ha lo stesso")
        if pros.get("pubblicazione"):
            s += f" · prossimo: regolamento {pros.get('regolamento')}, pubblicazione {_data_it(pros['pubblicazione'])}"
            oggi_ny = ora.astimezone(NEW_YORK).date().isoformat()
            if pros["pubblicazione"] < oggi_ny and si["esito"] != "rifatto":
                cercare.append(f"vendite allo scoperto: il calendario di FINRA dava il regolamento {pros.get('regolamento')} "
                               f"pubblicato il {_data_it(pros['pubblicazione'])}, e l'API porta ancora quello del "
                               f"{si.get('regolamento')}")
        L.append(s)
    else:
        L.append(f"  · VENDITE ALLO SCOPERTO (FINRA): NON lette ({si.get('errore') or 'n.d.'}): vale il regolamento "
                 f"della pipeline ({psi.get('regolamento') or 'n.d.'})")
    L.extend(righe_btp_leva(d, g, cercare))       # v521
    L.extend(righe_edgar(d, g.get("edgar") or {}, cercare))     # v522
    L.extend(righe_etf(d, g.get("etf") or {}))                  # v522
    # sec e trimestri
    L.extend(righe_sec(d, g.get("sec") or {}, cercare, g.get("trimestri") or {}, uff_es, uff_reg))
    L.extend(righe_ufficiali(uff_reg, uff_es))
    L.append("  DA CERCARE IN RETE — dove nemmeno la fonte e' aggiornata o raggiungibile (con fonte e data):")
    L.extend(["    · " + c for c in cercare] or ["    · niente: le fonti lette adesso sono allineate o piu' avanti "
                                                  "della pipeline"])
    return "\n".join(L)


def righe_btp_leva(d, g, cercare):
    """v521 — prezzo del BTP e debito a margine: cosa ha letto la sessione e cosa aveva il run. Un prezzo del BTP che il
    run dichiara RIPIEGO, o un mese di leva riportato, e' un dato che va cercato se nemmeno la fonte ha risposto."""
    from stato_sistema import giorno_it     # il mese per nome, una resa sola (v392)
    L = []
    r = next((x for x in ((d or {}).get("portfolio") or []) if isinstance(x, dict)
              and str(x.get("ticker", "")).startswith("BTP")), None) or {}
    b = g.get("btp") or {}
    run_btp = (f"{_n(r.get('price'))} " + (f"del {_data_it(r.get('price_asof'))}" if r.get("price_asof") else "senza data")
               + f" ({r.get('price_src') or 'fonte non dichiarata: snapshot precedente alla v521'})") if r else "riga assente"
    if b.get("esito") == "letto":
        L.append(f"  · PREZZO DEL BTP (Borsa Italiana): {_n(b.get('prezzo'), 3)} "
                 + (f"del {_data_it(b.get('data'))}" if b.get("data") else "SENZA DATA nella pagina")
                 + f" ({b.get('voce')})"
                 # v522 — l'altro prezzo datato della pagina e il rateo, dichiarati: il valore resta a corso secco
                 + (f" · {(b.get('altro') or {}).get('voce')} {_n((b.get('altro') or {}).get('prezzo'), 3)} del "
                    f"{_data_it((b.get('altro') or {}).get('data'))}" if (b.get("altro") or {}).get("prezzo") else "")
                 + (f" · rateo netto {_n(b.get('rateo_netto'), 4)} ogni 100 di nominale (il broker lo aggiunge al "
                    "controvalore; qui il valore e' a corso secco)" if b.get("rateo_netto") is not None else "")
                 + f" · nel run: {run_btp}")
    else:
        L.append(f"  · PREZZO DEL BTP: NON letto alla fonte ({b.get('errore') or 'n.d.'}) · vale il run: {run_btp}")
        if str(r.get("price_src") or "").startswith("RIPIEGO"):
            cercare.append("il prezzo del BTP: nel run e' il valore scritto nel codice, non un prezzo di mercato")
    lv = g.get("leva") or {}
    p = ((d or {}).get("macro") or {}).get("margin_debt") or {}
    run_lv = (f"{giorno_it(p.get('date'), mese=True)}" + (" RIPORTATO dal run precedente" if p.get("carried") else "")
              + (" dalla Fed Z.1 (un'altra misura)" if p.get("unreliable") else "")) if p else "assente"
    if lv.get("esito") == "letto":
        v = lv["valore"]
        dif = "" if (v.get("date") == p.get("date") and v.get("value") == p.get("value")) else " — DIVERSO dal run"
        mld = f"{round((v.get('value') or 0) / 1e3):,}".replace(",", ".")     # FINRA scrive in milioni di dollari
        L.append(f"  · DEBITO A MARGINE (FINRA): {giorno_it(v.get('date'), mese=True)}, {mld} miliardi $"
                 f" · nel run: {run_lv}{dif}")
    else:
        L.append(f"  · DEBITO A MARGINE: NON letto alla fonte ({lv.get('errore') or 'n.d.'}) · vale il run: {run_lv}")
        if p.get("carried") or p.get("unreliable") or not p:
            cercare.append("il debito a margine di FINRA dell'ultimo mese: ne' la fonte ne' il run lo hanno")
    return L


def righe_edgar(d, ed, cercare):
    """v522 — SEC EDGAR letto adesso: quanti nomi, i depositi di risultati PIU' RECENTI del run, i bilanci riletti, chi
    SEC non ha restituito (e tiene la voce del run, dichiarato)."""
    if (ed or {}).get("esito") != "letto":
        cercare.append("i depositi SEC piu' recenti dei nomi in esame: EDGAR non ha risposto, e calendario, ore, storia "
                       "della quotazione e voci dei bilanci sono quelli del run")
        return [f"  · SEC EDGAR: NON letto alla fonte ({(ed or {}).get('errore') or 'n.d.'}): calendario dei risultati, "
                "ore dei depositi, storia della quotazione e voci dei bilanci sono quelli del run della pipeline"]
    cal = ed.get("sec_calendario") or {}
    pt = cal.get("per_titolo") or {}
    pp = ((((d or {}).get("macro") or {}).get("sec_calendario")) or {}).get("per_titolo") or {}
    nuovi = sorted(f"{tk} (8-K del {_data_it(v.get('ultimo_deposito'))}; nel run "
                   + (f"{_data_it((pp.get(tk) or {}).get('ultimo_deposito'))})" if (pp.get(tk) or {}).get("ultimo_deposito")
                      else "assente)")
                   for tk, v in pt.items()
                   if str(v.get("ultimo_deposito") or "") > str((pp.get(tk) or {}).get("ultimo_deposito") or ""))
    ds = ed.get("debito_sec") or {}
    L = [f"  · SEC EDGAR (letto adesso con l'intestazione della pipeline, la stessa funzione del run; "
         f"{_n(ed.get('secondi'), 1)} s): {ed.get('seguiti')} nomi seguiti, {len(pt)} col calendario dei risultati, "
         f"{len(cal.get('senza_8k') or [])} emittenti senza 8-K"
         + (f"; voci dei bilanci per {len(ds.get('per_titolo') or {})} nomi, "
            + (f"rilette ADESSO per {', '.join(ds['letti_ora'])} (un 10-Q o 10-K che il run non aveva ancora letto)"
               if ds.get("letti_ora") else "nessun bilancio nuovo da rileggere") if ed.get("debito_sec") is not None
            else f"; voci dei bilanci NON lette ({ed.get('errore_debito') or 'n.d.'}): valgono quelle del run")]
    if nuovi:
        L.append("      deposito di risultati PIU' RECENTE di quello del run: " + ", ".join(nuovi))
    if ed.get("errori_titoli"):
        L.append("      NON restituiti da SEC in questo giro, vale la voce del run: " + ", ".join(sorted(ed["errori_titoli"])))
    if ds.get("errori"):
        L.append("      ⚠ bilancio nuovo NON riletto (companyfacts ha dato errore): " + ", ".join(sorted(ds["errori"]))
                 + " — debito, scadenze e derivati di quei nomi sono del bilancio precedente")
        cercare.append("debito e scadenze dal 10-Q o 10-K piu' recente di " + ", ".join(sorted(ds["errori"]))
                       + ": SEC non ha restituito i fatti del bilancio")
    return L


def righe_etf(d, etf):
    """v522 — la composizione degli ETF della rotazione letta adesso, e dove cambia rispetto al run."""
    if (etf or {}).get("esito") != "letto":
        return [f"  · COMPOSIZIONE DEGLI ETF: NON letta alla fonte ({(etf or {}).get('errore') or 'n.d.'}): vale quella del "
                "run (cambia coi ribilanciamenti, quindi lentamente)"]
    per = etf.get("per_etf") or {}
    pp = {r.get("ticker"): r.get("prime") for r in (((d or {}).get("macro") or {}).get("tilt") or [])}
    cambiati = sorted(s for s, v in per.items() if pp.get(s) and [x.get("tk") for x in v] != [x.get("tk") for x in pp[s]])
    return [f"  · COMPOSIZIONE DEGLI ETF (le prime cinque partecipazioni, come l'emittente le dichiara): letta adesso per "
            f"{len(per)} ETF"
            + ("; il run non porta macro.tilt, le righe si costruiscono da update_data.SECTOR_ETF" if not pp else
               (f"; nomi diversi dal run per {', '.join(cambiati)}" if cambiati else "; stessi nomi del run"))
            + (f"; senza composizione dal fornitore: {', '.join(etf['vuoti'])}" if etf.get("vuoti") else "")]


def righe_righe(d, rg, cercare):
    """v519 — la resa del blocco delle righe: quante lette adesso, quali campi restano della pipeline e perche', e cosa
    la lettura di una riga sola non puo' produrre."""
    n = rg.get("righe_pipeline") or len([r for r in ((d or {}).get("watchlist") or []) if r.get("ticker")])
    pt = rg.get("per_titolo") or {}
    if rg.get("esito") != "letto" or not pt:
        cercare.append("prezzi, multipli e conti dei nomi in esame: le righe dei titoli non sono state lette alla fonte, "
                       "e vale il run della pipeline")
        return [f"  · RIGHE DEI TITOLI (v519): NON lette alla fonte ({rg.get('errore') or 'nessuna riga letta'}): "
                "prezzo, tecnica, multipli, conti, combustione di cassa, solidita', flottante e sensibilita' ai canali "
                "sono quelli del run della pipeline"]
    L = [f"  · RIGHE DEI TITOLI (v519): {len(pt)} su {n} lette adesso con update_data.fetch_symbol, la funzione della "
         f"pipeline ({_n(rg.get('secondi'), 1)} s)"
         + (f"; rilette una seconda volta perche' la prima lettura perdeva qualcosa: {', '.join(rg['riletti'])}"
            if rg.get("riletti") else "")]
    if rg.get("non_letti"):
        L.append(f"      NON lette, vale la riga del run: {', '.join(rg['non_letti'])}")
        cercare.append(f"i dati del giorno di {', '.join(rg['non_letti'])}: la fonte non ha restituito la riga")
    if rg.get("parziali"):
        L.append("      campi tenuti dalla pipeline, perche' la lettura di adesso li perdeva (una chiamata di Yahoo "
                 "rifiutata fa uscire una riga piu' povera): "
                 + "; ".join(f"{tk} ({', '.join(c)})" for tk, c in sorted(rg["parziali"].items())))
    if not any(v is not None for v in (rg.get("bench_m1") or {}).values()):
        L.append("      ⚠ benchmark della forza relativa non letti adesso: la forza relativa a un mese resta quella del "
                 "run, accanto a prezzi di adesso")
    L.append("      restano del run, perche' si calcolano sui titoli INSIEME o hanno un blocco proprio: correlazioni, "
             "beta sul Nasdaq-100 e contributo al rischio delle righe (servono alla pagina: quelli dell'analisi li "
             "calcola numeri_libro.py sulle barre, v460); CDS e vendite allo scoperto (qui sotto). Controvalore, "
             "guadagno sul carico e forza relativa a un mese si rifanno sul prezzo di adesso")
    return L


def righe_sec(d, sec, cercare, trim=None, uff_es=None, uff_reg=None):
    """I depositi periodici (10-Q, 10-K) piu' recenti della lettura del debito della pipeline, e le tabelle dei
    trimestri ferme prima di un deposito di risultati — con il trimestre ritrovato da Nasdaq dove le due fonti
    coincidono sul trimestre in comune: fatti, coi loro giorni."""
    import schede_progetto
    if sec.get("esito") != "letto":
        return [f"  · DEPOSITI SEC: date NON lette ({sec.get('errore') or 'n.d.'}): restano quelle della pipeline"]
    ds = ((((d or {}).get("macro") or {}).get("debito_sec")) or {}).get("per_titolo") or {}
    righe = {r["ticker"]: r for r in _righe(d)}
    dietro, ferme_l, ritrovati, dal_com = [], [], [], []
    for tk, per in sorted((sec.get("per_titolo") or {}).items()):
        if not per:
            continue
        ultimo = max(per.items(), key=lambda kv: kv[1])
        lett = ((ds.get(tk) or {}).get("deposito") or {})
        if tk in ds and lett.get("data") and ultimo[1] > lett["data"]:
            dietro.append(f"{tk} ({ultimo[0]} del {_data_it(ultimo[1])}; il sistema ha letto il {lett.get('forma')} del "
                          f"{_data_it(lett['data'])})")
    for tk, f in sorted(((trim or {}).get("ferme") or {}).items()):
        nq = ((trim or {}).get("per_titolo") or {}).get(tk) or {}
        base = f"{tk} (conti al {_data_it(f['trim'])}, risultati depositati il {_data_it(f['dep'])}, {f['gg']} giorni dopo"
        ue = (uff_es or {}).get(tk) or {}
        in_uso = ue.get("esito") in ("aggiunto", "sostituito")
        # v513 — un deposito di risultati che e' un aggiornamento PRELIMINARE (un intervallo di stime non revisionate:
        #   SMCI il 20/10/2026) non e' un numero del trimestre: registrato come tale, non si cerca a ogni analisi
        pre = next((p for p in (uff_reg or {}).get("preliminari") or []
                    if p["ticker"] == tk and str(p["deposito"])[:10] == f["dep"]), None)
        # v513 — il comunicato copre il deposito se, messo in cima alla tabella, la tabella non e' piu' ferma: la stessa
        #   regola delle schede e della tenuta (v161), non una seconda soglia
        if in_uso and not schede_progetto.deposito_oltre_la_tabella({"tv": {"conto_trim": [{"trim": ue["trim"]}]}},
                                                                     {"ultimo_deposito": f["dep"]}):
            dal_com.append(base + f"; dal comunicato ufficiale del {_data_it(ue['data'])} il trimestre al "
                           f"{_data_it(ue['trim'])})")
        elif pre and not nq.get("nuovi"):
            ferme_l.append(base + f"; il deposito del {_data_it(f['dep'])} e' un aggiornamento PRELIMINARE, registrato il "
                           f"{_data_it(pre['verificato_il'])}: {pre['nota']} — non e' un numero del trimestre)")
        elif nq.get("nuovi"):
            ritrovati.append(base + f"; da Nasdaq il trimestre al {_data_it(nq['nuovi'][0]['trim'])}, verificato sul "
                             f"{_data_it(nq.get('comune'))}" + ("" if (nq.get("voci") or {}).get("utile") else
                                                                ", senza l'utile: le due fonti lo definiscono diversamente")
                             + ")")
        else:
            ferme_l.append(base + f"; Nasdaq: {nq.get('esito') or 'non letto'}"
                           + (f"; il comunicato registrato e' del trimestre al {_data_it(ue['trim'])}, precedente a quel "
                              "deposito" if in_uso else "") + ")")
            perche = (" — sul trimestre in comune Yahoo e Nasdaq non danno gli stessi ricavi: le due fonti li definiscono "
                      "diversamente" if "non coincidono" in str(nq.get("esito")) else "")
            if f.get("irregolare"):
                perche += (" (⚠ deposita risultati anche fuori ciclo: se il deposito e' un preliminare o una guida, non "
                           "e' un numero del trimestre e non si registra)")
            cercare.append(f"il comunicato ufficiale di {tk} sui risultati depositati il {_data_it(f['dep'])}{perche}: "
                           "ricavi, utile e risultato operativo del trimestre COI CONFRONTI DEL COMUNICATO STESSO "
                           "(l'anno prima e il trimestre prima), con la voce, il link e la data, da scrivere in "
                           "memoria/trimestri_ufficiali.json")
    L = [f"  · DEPOSITI SEC (date dei 10-Q e 10-K da {sec.get('fonte') or 'Yahoo'}): "
         f"{len(sec.get('per_titolo') or {})} titoli letti"
         + (f", non letti {', '.join(sec['non_letti'])}" if sec.get("non_letti") else "")]
    if dietro:
        L.append("      ⚠ un bilancio periodico PIU' RECENTE di quello da cui il sistema legge debito, scadenze e "
                 "derivati: " + ", ".join(dietro) + " — quelle voci sono del bilancio precedente ("
                 + ("companyfacts non e' stato riletto in questo giro" if str(sec.get("fonte") or "").startswith("SEC")
                    else "EDGAR non ha risposto in questo giro: le rilegge la pipeline, al piu' dieci per run") + ")")
        cercare.append("debito e scadenze dei nomi col bilancio nuovo non ancora letto: " + ", ".join(dietro))
    if ritrovati:
        L.append("      ⚠ tabella dei trimestri della pipeline FERMA (Yahoo non porta ancora l'ultimo trimestre), "
                 "COMPLETATA da Nasdaq: " + ", ".join(ritrovati) + " — ricavi e risultato operativo del trimestre nuovo "
                 "entrano nelle schede e nella tenuta dichiarando la fonte; cassa, debito e Altman restano del bilancio "
                 "precedente, ciascuno con la sua data")
    if ferme_l:
        L.append(f"      ⚠ tabella dei trimestri FERMA (risultati depositati oltre {schede_progetto.GIORNI_DEPOSITO_OLTRE} "
                 "giorni dopo l'ultimo trimestre della tabella) e NON completata: " + ", ".join(ferme_l)
                 + " — ricavi e utili di quei nomi sono di un trimestre prima")
    if dal_com:
        L.append("      ✓ tabella dei trimestri della pipeline ferma, COMPLETATA dal comunicato ufficiale registrato: "
                 + ", ".join(dal_com) + " — ricavi e utile del trimestre entrano nelle schede e nella tenuta coi "
                 "confronti del comunicato stesso; cassa, debito e Altman restano del bilancio precedente")
    if not dietro and not ritrovati and not ferme_l and not dal_com:
        L.append("      nessun bilancio periodico piu' recente di quelli letti dal sistema")
    return L


def main():
    d = _carica_pipeline()
    if d is None:
        print("DATI PER TITOLO — data/data.json NON leggibile: nessun confronto possibile, dato non disponibile")
        sys.exit(1)
    giro = leggi(d=d)
    print(sintesi(d, giro))


if __name__ == "__main__":
    main()
