# -*- coding: utf-8 -*-
"""LIBRERIA COMUNE della pipeline e degli strumenti d'analisi (v510).

Esiste per una ragione sola: tre domande che pipeline e strumenti si fanno ALLO STESSO MODO, e che
due copie farebbero divergere al primo ritocco (v161, v207 — la classe di rumore_yf.py, v387):
  · r2_rumore    — sotto quale R² un beta e' rumore (la pipeline per i canali dei titoli,
                   numeri_libro per i beta del libro: la v510 ha trovato TLT 0,53 con R² 0,01
                   pubblicato come un numero da una parte e «non misurabile» dall'altra);
  · testo_feed   — il titolo di una notizia come lo legge una persona (Nasdaq scrive le
                   virgolette due volte codificate, «&amp;quot;», e una decodifica sola lasciava
                   «&quot;» nel brief, nelle notizie e nei pacchetti);
  · art          — l'articolo davanti a un numero in italiano («dello 0,4%», «l'11%»).
v511 — e le derivazioni delle serie macro che l'analisi legge ALLA FONTE (scripts/fonti_dirette.py) e la pipeline
pubblica (scripts/update_data.py): CPI anno su anno per DATA (v393), variazione mensile dei posti di lavoro, salita
dello spread CCC dal minimo di 60 sedute (v465), NFCI e SLOOS col loro confronto, Fear & Greed con la data e l'anno
(v510), percentile midrank (v161). Spostate qui dalla pipeline, che le importa coi nomi di prima: la stessa domanda
fatta alla stessa fonte deve dare la stessa risposta, in qualunque dei due posti la si faccia.
Niente rete, niente pandas: si importa da qualunque parte senza costo.
"""
import html
import math
import re
import sys
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


def r2_rumore(n):
    """L'R2 che il PURO CASO supera nel 5% dei campioni, a questa numerosita'.

    ⚠⚠ NASCE DA UNA SOGLIA CHE NON REGGEVA IL CAMBIO DI FINESTRA. Il sistema dichiarava
    "canale presente" sopra R2 0,05 — una CONVENZIONE, non una misura, e nel v240 questo
    progetto ha gia' pagato che ogni soglia disegnata e' un'AFFERMAZIONE. Con una finestra sola
    la convenzione era innocua perche' conservativa; con due finestre diventa falsa, e in
    direzioni opposte:
      · su 251 osservazioni il caso supera R2 0,015 nel 5% dei campioni → 0,05 e' PRUDENTE
      · su  60 osservazioni la stessa cifra e' 0,065 → 0,05 accenderebbe canali dal NULLA
    Cioe' la finestra corta, con la vecchia soglia, avrebbe fabbricato esattamente il segnale
    che deve rilevare. Qui la soglia si CALCOLA dal campione invece di essere scelta.

    R2 critico = t2 / (t2 + df), con df = n - 2 e t il quantile 97,5% di Student — cioe' il
    punto in cui una regressione semplice diventa significativa al 5% bilaterale.
    L'approssimazione di Cornish-Fisher su t e' esatta a ~1e-5 per df >= 30 (verificata contro
    i valori tabulati: df=58 → 2,00171 contro 2,00172; df=249 → 1,96954 contro 1,96959), e
    sotto df 30 NON si restituisce niente invece di restituire un numero peggiore del silenzio.
    v510 — spostata qui da update_data.py, che la importa: una funzione, due consumatori.
    """
    df = int(n) - 2
    if df < 30:
        return None
    z = 1.959964                      # quantile 97,5% della normale
    t = z + 2.37243 / df + 2.82264 / (df * df)
    t2 = t * t
    return t2 / (t2 + df)


def testo_feed(s):
    """Il testo di una voce di feed come lo legge una persona: entita' HTML decodificate FINCHE' ce
    ne sono (al massimo tre giri), tag tolti, spazi compressi.
    ⚠ v510 — Nasdaq scrive «Is &amp;quot;Off the Charts.&amp;quot;»: il parser XML (o un
    html.unescape) toglie un livello solo e lascia «&quot;» nel titolo. Il 24/10/2026 usciva
    cosi' nel brief, nelle notizie di numeri_libro e nei pacchetti della pagina."""
    t = "" if s is None else str(s)
    for _ in range(3):
        u = html.unescape(t)
        if u == t:
            break
        t = u
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", t)).strip()


def _elisione(testo):
    """'lo' davanti a zero, "l'" davanti a uno, otto, undici (e ottanta, ottocento, ottomila,
    undicimila), None altrove. Si legge dalla parte intera del numero com'e' scritto («1.436,1»,
    «0,4», «11»); un segno davanti («+5%») si legge «piu'» e non elide."""
    m = re.match(r"(\d[\d.]*)", str(testo))
    if not m:
        return None
    try:
        n = int(m.group(1).replace(".", ""))
    except ValueError:
        return None
    if n == 0:
        return "lo"
    if n in (1, 11) or str(n)[0] == "8" or 11000 <= n < 12000:
        return "l'"
    return None


def art(prep, testo):
    """L'articolo (o la preposizione articolata) giusto davanti a un numero: art("del", "0,4%") →
    «dello 0,4%», art("il", "11%") → «l'11%», art("del", "27,8%") → «del 27,8%».
    ⚠ v510 — «stima in discesa del 0,1%» e «ne ha restituito il 11%» uscivano dagli strumenti
    tredici volte in un'analisi sola."""
    e = _elisione(testo)
    forme = {"il": ("il ", "lo ", "l'"), "del": ("del ", "dello ", "dell'")}[prep]
    return (forme[1] if e == "lo" else forme[2] if e == "l'" else forme[0]) + str(testo)


# ══════════════════════════ v514 — DUE REGOLE CHE PIPELINE E STRUMENTI DEVONO DARE UGUALI ══════════════════════════
def seduta_aperta(data_iso, adesso=None):
    """Vero se `data_iso` e' OGGI a New York e la campana delle 16:00 non e' ancora suonata: la barra di quella data e'
    in formazione (v439, v469, v471). Il fuso, mai uno scarto a mano (v470). Una regola sola per la pipeline (la
    rotazione del flottante, v514) e per gli strumenti (brief.barra_in_formazione la chiama)."""
    from zoneinfo import ZoneInfo
    ny = ZoneInfo("America/New_York")
    adesso = (adesso or datetime.now(ny)).astimezone(ny)
    return str(data_iso or "")[:10] == adesso.date().isoformat() and adesso.hour < 16


def trimestre_a(q, data, giorni, tolleranza=20):
    """Il trimestre di `q` (voci con «trim») che cade `giorni` prima di `data`: per DATA, mai per posizione (v207,
    v393). Una regola sola per i conti delle schede e per le azioni in circolazione della pipeline (v514)."""
    from datetime import date
    try:
        d0 = date.fromisoformat(str(data)[:10])
    except ValueError:
        return None
    for x in q:
        try:
            dx = date.fromisoformat(str(x.get("trim"))[:10])
        except ValueError:
            continue
        if abs((d0 - dx).days - giorni) <= tolleranza:
            return x
    return None


# ══════════════════════════ v511 — LE DERIVAZIONI DELLE SERIE MACRO, UNA COPIA SOLA ══════════════════════════════
def distanza_mesi(a: str, b: str) -> int:
    """quanti mesi separano due osservazioni ISO (b - a)."""
    return (int(b[:4]) - int(a[:4])) * 12 + (int(b[5:7]) - int(a[5:7]))


def mese_meno(iso: str, n: int) -> str:
    """la data ISO di n mesi prima. Le osservazioni mensili FRED stanno sempre al giorno 01."""
    tot = int(iso[:4]) * 12 + (int(iso[5:7]) - 1) - n
    return f"{tot // 12:04d}-{tot % 12 + 1:02d}-{iso[8:10]}"


def var_per_data(serie, mesi: int):
    """Variazione percentuale su `mesi`, agganciata alla DATA e non alla POSIZIONE (v393: CPIAUCSL ha un buco a
    ottobre 2025, e la posizione -13 cadeva su giugno invece che su luglio — 3,5% dove l'anno su anno vero era 3,3%).
    Quando la base esatta non c'e' si prende l'osservazione precedente piu' vicina e si RESTITUISCE LA DISTANZA VERA,
    cosi' chi stampa puo' dichiarare "su 13 mesi" invece di scrivere "a/a" su una cosa che non lo e'.
    Ritorna (valore, data_ultima_osservazione, mesi_effettivi)."""
    if not serie or len(serie) < 2:
        raise ValueError("serie troppo corta per una variazione")
    ultima, valore = serie[-1]
    atteso = mese_meno(ultima, mesi)
    per_data = {d: v for d, v in serie}
    base = per_data.get(atteso)
    effettivi = mesi
    if base is None:
        precedenti = [(d, v) for d, v in serie if d < atteso]
        if not precedenti:
            raise ValueError(f"nessuna osservazione a {mesi} mesi da {ultima}")
        d0, base = precedenti[-1]
        effettivi = distanza_mesi(d0, ultima)
        print(f"!! {atteso} assente nella serie: base a {d0}, distanza reale {effettivi} mesi",
              file=sys.stderr)
    if not base:
        raise ValueError(f"base nulla a {atteso}")
    return round((valore / base - 1) * 100, 1), ultima, effettivi


def delta_mensile(serie):
    """La variazione assoluta sull'ultimo mese (i posti di lavoro: PAYEMS in migliaia), per DATA come var_per_data.
    Senza il mese prima si prende l'osservazione precedente piu' vicina e se ne restituisce la distanza vera: lo stesso
    numero che la pipeline pubblicava per posizione (s[-1] - s[-2]), ora con i mesi che copre davvero.
    Ritorna (delta arrotondato, data_ultima_osservazione, mesi_effettivi)."""
    if not serie or len(serie) < 2:
        raise ValueError("serie troppo corta per una variazione")
    ultima, valore = serie[-1]
    atteso = mese_meno(ultima, 1)
    base = dict(serie).get(atteso)
    effettivi = 1
    if base is None:
        precedenti = [(d, v) for d, v in serie if d < atteso]
        if not precedenti:
            raise ValueError(f"nessuna osservazione prima di {ultima}")
        _d0, base = precedenti[-1]
        effettivi = distanza_mesi(_d0, ultima)
    return round(valore - base), ultima, effettivi


def rango_midrank(x, serie):
    """Percentile 'midrank': quota della serie sotto x piu' meta' dei pari, x 100. E' la convenzione di
    dgPercentile (assets/app.js) e di rotazione.percentile_midrank: un gate le confronta (v161)."""
    if x is None or not serie:
        return None
    sotto = sum(1 for y in serie if y < x)
    pari = sum(1 for y in serie if y == x)
    return (sotto + pari / 2) / len(serie) * 100


def credito_ccc(serie):
    """Lo spread della fascia CCC (BAMLH0A3HYC) con la salita dal minimo di 60 sedute, che e' il segnale del semaforo
    (v465, memoria/LIBRO.md §1ter). serie: [(data, valore)] in ordine cronologico. Un buco non e' uno zero (v205)."""
    vals = [(d, v) for d, v in (serie or []) if v is not None]
    if not vals:
        return None
    ult_d, ult = vals[-1]
    finestra = [v for _, v in vals[-61:-1]]
    minimo = min(finestra) if len(finestra) >= 60 else None
    return {"valore": round(ult, 2), "data": ult_d, "serie": "BAMLH0A3HYC",
            "min_60": round(minimo, 2) if minimo is not None else None,
            "salita_60_pp": round(ult - minimo, 2) if minimo is not None else None,
            "mese_fa": round(vals[-22][1], 2) if len(vals) >= 22 else None,
            "sedute": len(vals)}


def nfci_da(serie):
    """Il National Financial Conditions Index (settimanale) col valore di quattro settimane prima. serie: le ultime 60
    osservazioni [(data, valore)]. None se vuota."""
    if not serie:
        return None
    return {"valore": round(serie[-1][1], 2), "data": serie[-1][0],
            "mese_fa": round(serie[-5][1], 2) if len(serie) > 5 else None,
            "serie": "NFCI", "storia": [{"d": d, "v": round(v, 2)} for d, v in serie]}


def sloos_da(serie):
    """L'indagine trimestrale della Fed sui funzionari del credito (DRTSCILM) con l'indagine precedente. ⚠ Il segno non
    e' intuitivo (v390): un valore NEGATIVO vuol dire che le banche ALLENTANO. None se vuota."""
    if not serie:
        return None
    return {"valore": round(serie[-1][1], 1), "data": serie[-1][0],
            "precedente": round(serie[-2][1], 1) if len(serie) > 1 else None,
            "serie": "DRTSCILM", "storia": [{"d": d, "v": round(v, 1)} for d, v in serie]}


def numero_o_none(x):
    """Il valore come numero finito, o None: un campo nullo, una stringa o un NaN non sono un numero."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


# ⚠ v510 — il Fear & Greed col SUO anno. Sotto FG_STORIA_MINIMO rilevazioni un «percentile dell'anno» non e' dell'anno
#   (convenzione dichiarata, v240): la riga dice che lo storico manca invece di pubblicare un percentile corto.
FG_STORIA_MINIMO = 120


def data_fg(ts):
    """La data della rilevazione CNN dal suo `timestamp` (ISO, o millisecondi dall'epoca), nel fuso di New York: e' la
    seduta che il punteggio descrive. None se la fonte non la dichiara — e allora la riga lo dice (v396)."""
    if ts in (None, ""):
        return None
    try:
        if isinstance(ts, (int, float)):
            t = datetime.fromtimestamp(float(ts) / 1000, tz=timezone.utc)
        else:
            t = datetime.fromisoformat(str(ts).strip().replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None
    return (t.astimezone(ZoneInfo("America/New_York")) if ZoneInfo is not None else t).date().isoformat()


def storia_fear_greed(data, giorni=365):
    """⚠ v510 — IL FEAR & GREED COL SUO ANNO. La fonte pubblica la serie (`fear_and_greed_historical.data`, punti
    {x: millisecondi, y: punteggio}) e il pacchetto ne portava tre punti soli. Qui: le rilevazioni dell'ultimo anno
    PER DATA (v207: l'ultima del giorno vince, un giorno senza punto e' un buco), il percentile midrank di quella di
    oggi (rango_midrank, la convenzione di tutto il sistema, v161) arrotondato per eccesso sul mezzo (v496), il minimo
    e il massimo con l'ultima data in cui sono stati toccati. None se la serie manca o e' corta."""
    punti = (((data or {}).get("fear_and_greed_historical") or {}).get("data")) or []
    serie = {}
    for p in punti:
        try:
            g = data_fg(float(p["x"]))
            v = float(p["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if g and v == v:
            serie[g] = v
    if not serie:
        return None
    ultimo = max(serie)
    fine = datetime.fromisoformat(ultimo).date()
    anno = sorted((g, v) for g, v in serie.items() if (fine - datetime.fromisoformat(g).date()).days < giorni)
    if len(anno) < FG_STORIA_MINIMO:
        return None
    vals = [v for _, v in anno]
    oggi = anno[-1][1]
    mn = max((g for g, v in anno if v == min(vals)))
    mx = max((g for g, v in anno if v == max(vals)))
    return {"n": len(anno), "da": anno[0][0], "a": ultimo,
            "rango": int(math.floor(rango_midrank(oggi, vals) + 0.5)),
            "minimo": {"valore": round(min(vals)), "data": mn}, "massimo": {"valore": round(max(vals)), "data": mx}}


def fg_intero(x):
    """Un confronto che la fonte non porta e' un buco, non uno zero (v205)."""
    v = numero_o_none(x)
    return None if v is None else round(v)


def fear_greed_base(data):
    """Il Fear & Greed della CNN dalla risposta della fonte: punteggio, giudizio, la DATA della rilevazione (v510), i
    confronti che la fonte porta (assenti restano None, v205) e l'anno (storia_fear_greed). Le sette componenti e la
    FOMO li aggiunge la pipeline (servono alla pagina). Solleva se manca il punteggio: un F&G senza punteggio non e' un
    F&G. Lo storico che non si calcola non porta via il resto."""
    fg = data["fear_and_greed"]
    out = {"score": round(fg["score"]), "rating": fg["rating"],
           "asof": data_fg(fg.get("timestamp")),
           "prev_close": fg_intero(fg.get("previous_close")),
           "week_ago": fg_intero(fg.get("previous_1_week")),
           "month_ago": fg_intero(fg.get("previous_1_month")),
           "year_ago": fg_intero(fg.get("previous_1_year"))}
    try:
        st = storia_fear_greed(data)
        if st:
            out["storia"] = st
    except Exception as e:  # noqa: BLE001
        print(f"!! fear&greed storico: {e}", file=sys.stderr)
    return out


def fredgraph(testo):
    """Le osservazioni [(data, valore)] dal CSV pubblico di FRED (fredgraph.csv): un valore che non e' un numero (il
    «.» dei giorni senza dato) e' un buco e non entra (v205)."""
    out = []
    for line in str(testo or "").strip().splitlines()[1:]:
        d, _, val = line.partition(",")
        try:
            out.append((d, float(val)))
        except ValueError:
            continue
    return out
