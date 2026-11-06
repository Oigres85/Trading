#!/usr/bin/env python3
"""v536 — IL REGISTRO DAL VIVO DELLE PREVISIONI: si scrive prima, si risolve dopo, si misura sempre.

Decisione del CEO del 03/11/2026: un sistema previsionale «stile Polymarket» con l'ECCEZIONE MISURATA alla sua istruzione
n.1 — ogni previsione e' una probabilita', separata dai fatti, con l'affidabilita' misurata prima sul passato e poi DAL
VIVO. Questo modulo e' il «dal vivo»:

- il REGISTRO `memoria/previsioni.jsonl`: una previsione per riga, il record di affidabilita.previsione. Si aggiunge una
  volta sola per id (giorno, evento, metodo): una seconda analisi nello stesso giorno non raddoppia, e vale la PRIMA
  (una previsione non si ritocca dopo). Entra solo una previsione ancora aperta: il registro dal vivo misura cio' che e'
  stato scritto PRIMA dell'esito. Scrittura atomica (file temporaneo + rename): mai un registro spezzato;
- la RISOLUZIONE dal `risolutore` del record: il genere «prezzo» qui, dalle barre CONCLUSE, contando le sedute vere dopo
  'dal' (le barre, mai i giorni di calendario: un fine settimana non e' una seduta), con la stessa convenzione dei casi
  simili (la seduta n. h dopo 'dal' e' b[i + h], v161); «serie», «portafoglio» ed «esterno» dai moduli che li producono.
  Un evento «tocca» (e «chiude_sopra_media», che e' «entro») si risolve SI' appena succede; un NO solo a orizzonte
  concluso; un dato mancante lascia la previsione APERTA col perche' (v205: un buco non e' un NO). Non risolvibile solo
  cio' che non lo sara' mai (un risolutore guasto, un mercato annullato);
- il BILANCIO: per metodo (e famiglia) affidabilita.valuta sulle risolte — i metodi affiancati, mai mescolati (v200) —
  con i conteggi: registrate, aperte (di cui ferme per un dato o un risolutore), risolte, non risolvibili;
- le APERTE di oggi: su n previsioni di un metodo quante se ne attendono e con che probabilita' almeno k (supponendo gli
  eventi indipendenti: non lo sono, i titoli si muovono insieme, e lo si dice).

Il file cambia solo quando cambia un fatto (una risoluzione, un riferimento di scala, il motivo di un fermo): le righe
aperte non si riscrivono a ogni giro, perche' il registro si committa e un diff quotidiano di righe intatte e' rumore.
Le soglie sono convenzioni dichiarate (v240).

Uso:
  python3 scripts/registro_previsioni.py bilancio    l'affidabilita' dal vivo, per metodo e famiglia
  python3 scripts/registro_previsioni.py aperte      le previsioni aperte e quante se ne attendono
  python3 scripts/registro_previsioni.py risolvi     risolve le aperte (barre dalla cache o dalla fonte)
  python3 scripts/registro_previsioni.py verifiche   le prove, senza rete
"""
import importlib
import json
import math
import os
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone

QUI = os.path.dirname(os.path.abspath(__file__))
if QUI not in sys.path:
    sys.path.insert(0, QUI)
import affidabilita as A          # noqa: E402

RADICE = os.path.dirname(QUI)
REGISTRO = os.path.join(RADICE, "memoria", "previsioni.jsonl")
PERFORMANCE = os.path.join(RADICE, "memoria", "registro_performance.jsonl")
TIPI_PREZZO = ("chiude_sopra", "tocca_su", "tocca_giu", "chiude_sopra_media")
TOLLERANZA_SCALA = 0.02        # la chiusura di 'dal' riletta oltre il 2% da quella registrata: barre riscalate (frazionamento)
MAX_RIGHE = 20                 # le aperte elencate una per una al piu' 20: le altre si contano
ESTERNI = {                    # genere → (modulo, funzione) di chi lo produce
    "serie": ("previsioni_macro", "risolvi_serie"),
    "portafoglio": ("previsioni_portafoglio", "risolvi_portafoglio"),
    "esterno": ("mercati_previsione", "risolvi_esterno"),
}
NOTA_DIPENDENZA = ("⚠ il conto suppone gli eventi indipendenti: non lo sono (i titoli si muovono insieme), "
                   "quindi la dispersione vera e' piu' larga — tutte insieme o nessuna e' piu' probabile di quanto dica")


def _n(x, d=1, segno=False):
    from statistica import _n as n_
    return n_(x, d, segno)


def _p(x, d=0):
    return A._p(x, d)                  # il formattatore delle percentuali della fondazione (v161)


def _ora(adesso=None):
    return (adesso or datetime.now(timezone.utc)).astimezone(timezone.utc)


# ───────────────────────── il registro su disco ─────────────────────────

def leggi(percorso=REGISTRO):
    """Tre esiti (v389): 'assente'/'illeggibile' (NON letto), 'vuoto' (letto, senza voci), 'letto' (con voci).
    Le righe guaste si contano e si nominano: con righe guaste il registro non si riscrive (si sistema a mano)."""
    try:
        with open(percorso, encoding="utf-8") as f:
            testo = f.read()
    except FileNotFoundError:
        return {"stato": "assente", "righe": [], "guaste": []}
    except Exception as e:
        return {"stato": "illeggibile", "righe": [], "guaste": [], "errore": f"{type(e).__name__}: {e}"}
    righe, guaste = [], []
    for k, x in enumerate(testo.splitlines(), 1):
        if not x.strip():
            continue
        try:
            r = json.loads(x)
            if not isinstance(r, dict) or not r.get("id"):
                raise ValueError("non e' un record con id")
            righe.append(r)
        except Exception:
            guaste.append((k, x[:60]))
    return {"stato": "letto" if (righe or guaste) else "vuoto", "righe": righe, "guaste": guaste}


def _blocco(L):
    """Il motivo per cui il registro non si riscrive, o None."""
    if L["stato"] == "illeggibile":
        return f"registro illeggibile ({L.get('errore')}): non si riscrive"
    if L["guaste"]:
        return (f"registro con {len(L['guaste'])} righe guaste (riga {', '.join(str(k) for k, _ in L['guaste'][:5])}): "
                "non si riscrive per non perderle — si sistema a mano")
    return None


def _scrivi(percorso, righe):
    """Scrittura atomica: tutto in un file temporaneo nella stessa cartella, poi rename. Un errore a meta' lascia il
    registro di prima intatto e nessun temporaneo in giro."""
    cartella = os.path.dirname(os.path.abspath(percorso))
    os.makedirs(cartella, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=cartella, prefix=".previsioni-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            for r in righe:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())
        try:
            modo = os.stat(percorso).st_mode & 0o777
        except FileNotFoundError:
            modo = 0o644
        os.chmod(tmp, modo)
        os.replace(tmp, percorso)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def stato(r):
    """'risolta' (esito vero o falso) · 'non_risolvibile' (affidabilita.risolvi con esito None e il perche') · 'aperta'."""
    if r.get("esito") is not None:
        return "risolta"
    if r.get("risolto_il") and (r.get("extra") or {}).get("non_risolta"):
        return "non_risolvibile"
    return "aperta"


def _valida(r):
    """Il motivo per cui un record non entra nel registro, o None."""
    if not isinstance(r, dict) or not isinstance(r.get("id"), str) or not r["id"]:
        return "non e' un record di affidabilita.previsione (manca l'id)"
    p = r.get("probabilita")
    if not isinstance(p, (int, float)) or isinstance(p, bool) or not (0.0 <= p <= 1.0):
        return f"probabilita' fuori da [0, 1]: {p!r}"
    if r.get("metodo") not in A.METODI:
        return f"metodo sconosciuto: {r.get('metodo')!r}"
    if r.get("famiglia") not in A.FAMIGLIE:
        return f"famiglia sconosciuta: {r.get('famiglia')!r}"
    b = r.get("base")
    if b is not None and (not isinstance(b, (int, float)) or not (0.0 <= b <= 1.0)):
        return f"base fuori da [0, 1]: {b!r}"
    if not isinstance(r.get("risolutore"), dict) or not r["risolutore"].get("genere"):
        return "senza risolutore: non si potrebbe mai risolvere"
    if r.get("esito") is not None or r.get("risolto_il"):
        return "porta gia' un esito: il registro dal vivo accoglie solo previsioni scritte prima dell'esito"
    return None


def registra(previsioni, adesso=None, percorso=REGISTRO, B=None):
    """Aggiunge le previsioni nuove, una volta sola per id; vale la prima. Con B (le barre) annota per gli eventi di
    prezzo la chiusura di 'dal' (extra['chiusura_dal']): serve a riconoscere barre riscalate dopo (un frazionamento).
    → {'nuove', 'gia_presenti', 'scartate': [(id, motivo)], 'totale'} oppure {'errore'} (nulla scritto)."""
    adesso = _ora(adesso)
    L = leggi(percorso)
    blocco = _blocco(L)
    if blocco:
        return {"errore": blocco, "nuove": 0, "gia_presenti": 0, "scartate": [], "totale": len(L["righe"])}
    visti = {r["id"] for r in L["righe"]}
    nuove, gia, scartate = [], 0, []
    for r in previsioni or []:
        motivo = _valida(r)
        if not motivo:
            try:
                r = json.loads(json.dumps(r, ensure_ascii=False))       # una copia, e la prova che si serializza
            except Exception as e:
                motivo = f"non serializzabile: {type(e).__name__}"
        if motivo:
            scartate.append(((r or {}).get("id") if isinstance(r, dict) else None, motivo))
            continue
        if r["id"] in visti:
            gia += 1
            continue
        visti.add(r["id"])
        r["extra"] = dict(r.get("extra") or {})
        r["extra"]["registrato"] = adesso.isoformat(timespec="minutes")
        ris = r["risolutore"]
        if B is not None and ris.get("genere") == "prezzo" and "chiusura_dal" not in r["extra"]:
            c0 = _chiusura_dal(_concluse(B.get(ris.get("tk")), adesso), str(ris.get("dal", ""))[:10])
            if c0:
                r["extra"]["chiusura_dal"] = c0
        nuove.append(r)
    if nuove:
        _scrivi(percorso, L["righe"] + nuove)
    return {"nuove": len(nuove), "gia_presenti": gia, "scartate": scartate, "totale": len(L["righe"]) + len(nuove)}


# ───────────────────────── la risoluzione del genere «prezzo» ─────────────────────────

def _concluse(b, adesso):
    """Le barre senza quella in formazione (la campana di New York, comuni.seduta_aperta): una barra a meta' giornata
    non e' una seduta conclusa (v193, v512)."""
    if not b:
        return b
    from brief import barra_in_formazione
    return b[:-1] if barra_in_formazione(b, adesso) else b


def _chiusura_dal(b, dal):
    prima = [x for x in (b or []) if str(x.get("t", ""))[:10] <= dal]
    return prima[-1].get("c") if prima else None


def finestra(b, dal, sedute):
    """Le prime `sedute` barre DOPO 'dal' (data > dal), contate sulle barre: un fine settimana o una festa non sono
    sedute. → (dentro, conclusa)."""
    dopo = [x for x in b if str(x.get("t", ""))[:10] > dal]
    dentro = dopo[:sedute]
    return dentro, len(dentro) == sedute


def _esito(esito=None, quando=None, perche="", definitiva=False, ferma=False, dettaglio=None, annota=None):
    return {"esito": esito, "quando": quando, "perche": perche, "definitiva": definitiva, "ferma": ferma,
            "dettaglio": dettaglio or {}, "annota": annota or {}}


def _numero(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def risolvi_prezzo(ris, b, adesso=None, extra=None):
    """Un evento di affidabilita.evento_prezzo contro le barre del titolo (None = non lette)."""
    tk, tipo, soglia, sedute = ris.get("tk"), ris.get("tipo"), ris.get("soglia"), ris.get("sedute")
    dal = str(ris.get("dal") or "")[:10]
    try:
        date.fromisoformat(dal)
    except ValueError:
        return _esito(perche=f"'dal' non e' una data: {ris.get('dal')!r}", definitiva=True)
    if tipo not in TIPI_PREZZO:
        return _esito(perche=f"tipo di evento sconosciuto: {tipo!r}", definitiva=True)
    if not isinstance(sedute, int) or sedute < 1:
        return _esito(perche=f"orizzonte non valido: {sedute!r} sedute", definitiva=True)
    if tipo == "chiude_sopra_media":
        if not isinstance(ris.get("media"), int) or ris["media"] < 2:
            return _esito(perche=f"media non valida: {ris.get('media')!r}", definitiva=True)
    elif not _numero(soglia):
        return _esito(perche=f"soglia non numerica: {soglia!r}", definitiva=True)
    if b is None:
        return _esito(perche=f"barre di {tk} non lette", ferma=True)
    b = _concluse(b, adesso)
    if not b:
        return _esito(perche=f"nessuna barra conclusa di {tk} dalla fonte", ferma=True)
    c0 = _chiusura_dal(b, dal)
    if c0 is None:
        return _esito(perche=f"le barre di {tk} cominciano il {str(b[0]['t'])[:10]}, dopo 'dal' ({dal}): le sedute "
                             "non si contano", ferma=True)
    annota, dettaglio = {}, {}
    rif = (extra or {}).get("chiusura_dal")
    if tipo != "chiude_sopra_media":
        if _numero(rif) and rif > 0 and _numero(c0):
            fattore = c0 / rif
            if abs(fattore - 1) > TOLLERANZA_SCALA:
                soglia = soglia * fattore
                dettaglio["fattore_scala"] = round(fattore, 6)
                dettaglio["nota_scala"] = (f"la chiusura del {dal} oggi vale {_n(c0, 2)}, registrata {_n(rif, 2)}: barre "
                                           "riscalate (frazionamento o rettifica), soglia riportata alla scala di oggi")
        elif not _numero(rif) and _numero(c0):
            annota["chiusura_dal"] = c0              # il riferimento di scala, preso alla prima verifica
    dentro, conclusa = finestra(b, dal, sedute)
    dettaglio["soglia"] = soglia if tipo != "chiude_sopra_media" else None
    mancano = sedute - len(dentro)
    attesa = f"mancano {mancano} sedute su {sedute} (ultima conclusa: {str(b[-1]['t'])[:10]})"
    if tipo == "chiude_sopra":
        if not conclusa:
            return _esito(perche=attesa, dettaglio=dettaglio, annota=annota)
        x = dentro[-1]
        if not _numero(x.get("c")):
            return _esito(perche=f"la barra del {str(x['t'])[:10]} non ha la chiusura", ferma=True, annota=annota)
        dettaglio.update(seduta=sedute, valore=x["c"])
        return _esito(x["c"] > soglia, str(x["t"])[:10], dettaglio=dettaglio, annota=annota)
    buchi = []
    indice = {id(x): i for i, x in enumerate(b)}
    for j, x in enumerate(dentro, 1):
        if tipo == "tocca_su":
            v, ok = x.get("h"), (lambda v: v >= soglia)
        elif tipo == "tocca_giu":
            v, ok = x.get("l"), (lambda v: v <= soglia)
        else:
            from brief import sma
            m = sma(b[:indice[id(x)] + 1], ris["media"])
            v, ok = x.get("c"), (lambda v, m=m: m is not None and v > m)
            if m is None:
                buchi.append(str(x["t"])[:10])
                continue
            dettaglio["media"] = m
        if not _numero(v):
            buchi.append(str(x["t"])[:10])
            continue
        if ok(v):
            dettaglio.update(seduta=j, valore=v)
            return _esito(True, str(x["t"])[:10], dettaglio=dettaglio, annota=annota)
    if buchi:
        return _esito(perche=f"barre senza il dato ({', '.join(buchi[:3])}): un NO non si conclude", ferma=True,
                      annota=annota)
    if conclusa:
        dettaglio.update(seduta=sedute)
        return _esito(False, str(dentro[-1]["t"])[:10], dettaglio=dettaglio, annota=annota)
    return _esito(perche=attesa + " — non ancora successo", dettaglio=dettaglio, annota=annota)


# ───────────────────────── gli altri generi: i moduli degli altri ─────────────────────────

def _carica(genere):
    """(funzione, None) oppure (None, «risolutore di X non disponibile (…)»): l'assenza si dichiara, non ferma."""
    modulo, nome = ESTERNI[genere]
    try:
        f = getattr(importlib.import_module(modulo), nome, None)
    except Exception as e:
        return None, f"risolutore di {genere} non disponibile ({modulo}.{nome}: {type(e).__name__})"
    if not callable(f):
        return None, f"risolutore di {genere} non disponibile ({modulo}.{nome} non c'e')"
    return f, None


def _normalizza(risposta):
    """La risposta di un risolutore esterno → _esito. Accetta: True/False; None; (esito, perche[, quando]);
    {'esito', 'perche'|'motivo', 'quando', 'definitiva'|'non_risolvibile', 'ferma', 'dettaglio'}."""
    if isinstance(risposta, dict):
        e = risposta.get("esito")
        perche = risposta.get("perche") or risposta.get("motivo") or risposta.get("non_risolta") or ""
        quando = risposta.get("quando") or risposta.get("risolto_il")
        definitiva = bool(risposta.get("definitiva") or risposta.get("non_risolvibile"))
        ferma, dettaglio = bool(risposta.get("ferma")), risposta.get("dettaglio")
    elif isinstance(risposta, (tuple, list)):
        e = risposta[0] if risposta else None
        perche = risposta[1] if len(risposta) > 1 else ""
        quando = risposta[2] if len(risposta) > 2 else None
        definitiva = ferma = False
        dettaglio = None
    else:
        e, perche, quando, definitiva, ferma, dettaglio = risposta, "", None, False, False, None
    if e is not None and not isinstance(e, bool):
        return _esito(perche=f"esito non riconosciuto dal risolutore: {e!r}", ferma=True)
    if e is None and not definitiva and not perche:
        perche = "il risolutore non ha dato un esito"
    return _esito(e, quando, str(perche or ""), definitiva and e is None, ferma, dettaglio if isinstance(dettaglio, dict) else None)


def _risolutori(adesso, B, rete, storia, righe_registro):
    """I risolutori di ogni genere: (risolutore, record) → risposta. Caricati quando servono, una volta per giro."""
    cache = {}

    def esterno(genere, chiama):
        def f(ris, rec):
            if genere not in cache:
                cache[genere] = _carica(genere)
            fn, motivo = cache[genere]
            if fn is None:
                return _esito(perche=motivo, ferma=True)
            return _normalizza(chiama(fn, ris))
        return f

    def performance():
        if righe_registro is not None:
            return righe_registro
        if "perf" not in cache:
            try:
                with open(PERFORMANCE, encoding="utf-8") as fh:
                    cache["perf"] = [json.loads(x) for x in fh if x.strip()]
            except Exception:
                cache["perf"] = None                       # non letto: lo dice il risolutore del portafoglio
        return cache["perf"]

    return {
        "prezzo": lambda ris, rec: risolvi_prezzo(ris, (B or {}).get(ris.get("tk")), adesso, rec.get("extra")),
        "serie": esterno("serie", lambda fn, ris: fn(ris, storia)),
        "portafoglio": esterno("portafoglio", lambda fn, ris: fn(ris, performance(), B)),
        "esterno": esterno("esterno", lambda fn, ris: fn(ris, rete)),
    }


def risolvi_scadute(B=None, adesso=None, percorso=REGISTRO, risolutori=None, rete=True, storia=None,
                    righe_registro=None):
    """Prova a risolvere ogni previsione aperta dal suo risolutore. B: {ticker: barre} (None = si leggono con
    statistica.leggi_barre per i titoli delle aperte). risolutori: {genere: f(risolutore) → risposta} sostituisce quello
    di quel genere (None = non disponibile). Il registro si riscrive solo se qualcosa e' cambiato.
    → {'risolte_ora', 'non_risolvibili_ora', 'aperte': [(id, perche, ferma)], 'scritto'} o {'assente'}/{'errore'}."""
    adesso = _ora(adesso)
    L = leggi(percorso)
    if L["stato"] == "assente":
        return {"assente": True, "risolte_ora": [], "non_risolvibili_ora": [], "aperte": [], "scritto": False}
    blocco = _blocco(L)
    if blocco:
        return {"errore": blocco, "risolte_ora": [], "non_risolvibili_ora": [], "aperte": [], "scritto": False}
    aperte = [r for r in L["righe"] if stato(r) == "aperta"]
    nota_barre = None
    if B is None and any((r.get("risolutore") or {}).get("genere") == "prezzo" for r in aperte):
        nomi = sorted({r["risolutore"].get("tk") for r in aperte if r["risolutore"].get("genere") == "prezzo"} - {None})
        try:
            from statistica import leggi_barre
            B = leggi_barre(nomi, adesso, rete=rete)
        except Exception as e:
            B, nota_barre = {}, f"barre non lette ({type(e).__name__})"
    R = _risolutori(adesso, B, rete, storia, righe_registro)
    for g, f in (risolutori or {}).items():
        R[g] = (lambda ris, rec, f=f: _normalizza(f(ris))) if f is not None else \
            (lambda ris, rec, g=g: _esito(perche=f"risolutore di {g} non disponibile", ferma=True))
    out = {"risolte_ora": [], "non_risolvibili_ora": [], "aperte": [], "scritto": False, "nota_barre": nota_barre}
    nuove, cambiato = [], False
    for r in L["righe"]:
        if stato(r) != "aperta":
            nuove.append(r)
            continue
        ris = r.get("risolutore") or {}
        g = ris.get("genere")
        try:
            if g not in R:
                e = _esito(perche=f"genere di risolutore sconosciuto: {g!r}", definitiva=True)
            else:
                e = R[g](ris, r)
        except Exception as ex:
            e = _esito(perche=f"risolutore di {g} in errore ({type(ex).__name__}: {str(ex)[:80]})", ferma=True)
        extra = dict(r.get("extra") or {})
        extra.update(e["annota"])
        if e["esito"] is not None:
            extra.pop("attesa", None)
            extra["risoluzione"] = {k: v for k, v in e["dettaglio"].items() if v is not None}
            q = A.risolvi(r, e["esito"], e["quando"] or adesso.isoformat(timespec="minutes"))
            out["risolte_ora"].append(q)
        elif e["definitiva"]:
            extra.pop("attesa", None)
            extra["non_risolta"] = e["perche"]
            q = A.risolvi(r, None, e["quando"] or adesso.isoformat(timespec="minutes"))
            out["non_risolvibili_ora"].append(q)
        else:
            q = dict(r)
            if e["ferma"]:
                extra["attesa"] = e["perche"]              # il motivo del fermo resta scritto; l'attesa normale no
            else:
                extra.pop("attesa", None)
            out["aperte"].append((r["id"], e["perche"], e["ferma"]))
        q["extra"] = extra
        cambiato |= json.dumps(q, sort_keys=True) != json.dumps(r, sort_keys=True)
        nuove.append(q)
    if cambiato:
        _scrivi(percorso, nuove)
        out["scritto"] = True
    return out


# ───────────────────────── il bilancio dal vivo ─────────────────────────

def bilancio(percorso=REGISTRO, per=("metodo", "famiglia")):
    """Per gruppo (la combinazione dei campi di `per`) affidabilita.valuta sulle risolte, con la base di ogni record
    quando TUTTE le risolte del gruppo ce l'hanno (altrimenti la frequenza in campione, dichiarata), e i conteggi."""
    L = leggi(percorso)
    righe = L["righe"]

    def conta(rr):
        s = [stato(r) for r in rr]
        return {"registrate": len(rr), "aperte": s.count("aperta"),
                "ferme": sum(1 for r, x in zip(rr, s) if x == "aperta" and (r.get("extra") or {}).get("attesa")),
                "risolte": s.count("risolta"), "si": sum(1 for r in rr if r.get("esito") is True),
                "no": sum(1 for r in rr if r.get("esito") is False), "non_risolvibili": s.count("non_risolvibile")}

    gruppi = {}
    for r in righe:
        gruppi.setdefault(tuple(r.get(k) for k in per), []).append(r)
    G = []
    for chiave in sorted(gruppi, key=lambda k: tuple(str(x) for x in k)):
        rr = gruppi[chiave]
        risolte = [r for r in rr if stato(r) == "risolta"]
        con_base = [r for r in risolte if _numero(r.get("base"))]
        basi = [float(r["base"]) for r in risolte] if risolte and len(con_base) == len(risolte) else None
        v = A.valuta([r["probabilita"] for r in risolte], [r["esito"] for r in risolte], basi=basi)
        G.append({"chiave": dict(zip(per, chiave)), **conta(rr), "valutazione": v,
                  "senza_base": len(risolte) - len(con_base),
                  "periodo": (min(str(r["risolto_il"])[:10] for r in risolte),
                              max(str(r["risolto_il"])[:10] for r in risolte)) if risolte else None})
    return {"stato": L["stato"], "guaste": L["guaste"], "errore": L.get("errore"), "per": tuple(per),
            "mescola_metodi": "metodo" not in per, **conta(righe), "gruppi": G}


def n_previsioni(previsioni, per="metodo", giorno=None):
    """Sulle previsioni APERTE (di `giorno`, se dato: AAAA-MM-GG dell'id), metodo per metodo — lo stesso evento detto da
    due metodi non sono due eventi (v200): {'gruppi': {metodo: {'n', 'attese', 'almeno', 'k50', 'p50', 'k90', 'p90'}},
    'nota'}. k50/k90: il k piu' alto con almeno il 50%/90% di probabilita' che se ne avverino almeno k."""
    aperte = [r for r in previsioni or [] if stato(r) == "aperta" and (giorno is None or str(r["id"])[:10] == giorno)]
    gruppi = {}
    for r in aperte:
        gruppi.setdefault(r.get(per), []).append(float(r["probabilita"]))
    out = {}
    for g, ps in sorted(gruppi.items(), key=lambda x: str(x[0])):
        q = A.quante_si_avverano(ps)
        k50 = max(k for k, p in enumerate(q["almeno"]) if p >= 0.5 - 1e-12)
        k90 = max(k for k, p in enumerate(q["almeno"]) if p >= 0.9 - 1e-12)
        out[g] = {**q, "k50": k50, "p50": q["almeno"][k50], "k90": k90, "p90": q["almeno"][k90]}
    return {"gruppi": out, "nota": NOTA_DIPENDENZA}


# ───────────────────────── le rese ─────────────────────────

def _registro_non_letto(stato_, errore=None):
    if stato_ == "assente":
        return "REGISTRO DELLE PREVISIONI: assente (memoria/previsioni.jsonl) — nessuna previsione registrata: lo crea la prima analisi"
    if stato_ == "illeggibile":
        return f"REGISTRO DELLE PREVISIONI: NON letto ({errore})"
    if stato_ == "vuoto":
        return "REGISTRO DELLE PREVISIONI: letto, nessuna previsione"
    return None


def _nome_gruppo(chiave):
    return " · ".join(A.METODI.get(v, v) if k == "metodo" else str(v) for k, v in chiave.items())


def resa_bilancio(b):
    testa = _registro_non_letto(b["stato"], b.get("errore"))
    if testa:
        return [testa]
    L = [f"AFFIDABILITA' DAL VIVO — {b['registrate']} previsioni registrate: {b['risolte']} risolte (SI' {b['si']}, "
         f"NO {b['no']}) · {b['aperte']} aperte" + (f" (di cui {b['ferme']} ferme per un dato o un risolutore)" if b["ferme"] else "")
         + f" · {b['non_risolvibili']} non risolvibili"]
    if b["guaste"]:
        L.append(f"  ⚠ {len(b['guaste'])} righe guaste nel registro (riga {', '.join(str(k) for k, _ in b['guaste'][:5])}): "
                 "non lette, e il registro non si riscrive finche' non si sistemano")
    if b["mescola_metodi"]:
        L.append("  ⚠ raggruppato senza il metodo: si mescolano metodi diversi (v200), la misura non e' di nessun metodo")
    for g in b["gruppi"]:
        v = g["valutazione"]
        conti = f"risolte {g['risolte']} (SI' {g['si']}, NO {g['no']}) · aperte {g['aperte']} · non risolvibili {g['non_risolvibili']}"
        if not v["n"]:
            L.append(f"  {_nome_gruppo(g['chiave'])} — {conti} · affidabilita' non ancora misurata (nessuna risolta)")
            continue
        ab = v["abilita"]
        L.append(f"  {_nome_gruppo(g['chiave'])} — {conti} · Brier {_n(v['brier'], 3)} contro {_n(v['brier_base'], 3)} della "
                 f"base → abilita' {_n(ab, 2, True) if ab is not None else 'n.d.'} · ECE {_p(v['ece'], 1)}"
                 + (f" · base: {v['base_dichiarata']}" + (f" ({g['senza_base']} senza base)" if g["senza_base"] else "")
                    if g["senza_base"] else "")
                 + ("" if v["misurabile"] else f" · ⚠ {v['n']} risolte, sotto le {A.MIN_VALUTAZIONE}: non ancora solida"))
        L.append("    fasce: " + " · ".join(
            f"{_p(f['da'])}-{_p(f['a'])} → {_p(f['frequenza'])} su {f['n']}"
            + (f" (fra {_p(f['basso'])} e {_p(f['alto'])})" if f["misurabile"] else " (non misurabile)")
            for f in v["fasce"]))
    return L


def resa_aperte(previsioni=None, percorso=REGISTRO, giorno=None, adesso=None, max_righe=MAX_RIGHE):
    """Le aperte, una riga ciascuna (al piu' max_righe), poi per metodo quante se ne attendono."""
    if previsioni is None:
        Lr = leggi(percorso)
        testa = _registro_non_letto(Lr["stato"], Lr.get("errore"))
        if testa:
            return [testa]
        previsioni = Lr["righe"]
    from zoneinfo import ZoneInfo
    oggi = _ora(adesso).astimezone(ZoneInfo("Europe/Rome")).date().isoformat()
    aperte = [r for r in previsioni if stato(r) == "aperta" and (giorno is None or str(r["id"])[:10] == giorno)]
    if not aperte:
        return [f"PREVISIONI APERTE{' del ' + giorno if giorno else ''}: nessuna"]
    L = [f"PREVISIONI APERTE{' del ' + giorno if giorno else ''} — {len(aperte)} (probabilita', non fatti: l'affidabilita' "
         "di ogni metodo e' nel bilancio)"]
    for r in sorted(aperte, key=lambda r: (str(r.get("metodo")), str(r.get("soggetto"))))[:max_righe]:
        x = r.get("extra") or {}
        scade = r.get("scade")
        L.append(f"  {r['evento']}: {_p(r['probabilita'])} · {A.METODI.get(r['metodo'], r['metodo'])}"
                 + (f" · base {_p(r['base'])}" if _numero(r.get("base")) else " · base n.d.")
                 + (f" · scade {scade}" + (" (oltre la scadenza indicativa)" if str(scade) < oggi else "") if scade else "")
                 + (f" · ⚠ ferma: {x['attesa']}" if x.get("attesa") else ""))
    if len(aperte) > max_righe:
        L.append(f"  … altre {len(aperte) - max_righe} non elencate")
    q = n_previsioni(aperte)
    for m, g in q["gruppi"].items():
        L.append(f"  {A.METODI.get(m, m)}: su {g['n']} previsioni se ne attendono {_n(g['attese'], 1)}; almeno {g['k50']} "
                 f"con probabilita' {_p(g['p50'])}"
                 + (f", almeno {g['k90']} con {_p(g['p90'])}" if 0 < g["k90"] < g["k50"] else ""))
    L.append("  " + q["nota"])
    return L


def resa_risolvi(e):
    if e.get("assente"):
        return [_registro_non_letto("assente")]
    if e.get("errore"):
        return [f"RISOLUZIONE: non eseguita — {e['errore']}"]
    si = sum(1 for r in e["risolte_ora"] if r["esito"])
    L = [f"RISOLUZIONE — risolte ora {len(e['risolte_ora'])} (SI' {si}, NO {len(e['risolte_ora']) - si}) · non "
         f"risolvibili ora {len(e['non_risolvibili_ora'])} · ancora aperte {len(e['aperte'])}"
         + ("" if e["scritto"] else " · registro invariato")]
    if e.get("nota_barre"):
        L.append(f"  ⚠ {e['nota_barre']}")
    for r in e["risolte_ora"][:MAX_RIGHE]:
        esito = "SI'" if r["esito"] else "NO"
        L.append(f"  {r['evento']} ({A.METODI.get(r['metodo'], r['metodo'])}, {_p(r['probabilita'])}): "
                 f"{esito} il {str(r['risolto_il'])[:10]}")
    for r in e["non_risolvibili_ora"]:
        L.append(f"  non risolvibile: {r['evento']} — {r['extra'].get('non_risolta')}")
    ferme = {}
    for _, perche, ferma in e["aperte"]:
        if ferma:
            ferme[perche] = ferme.get(perche, 0) + 1
    for perche, k in sorted(ferme.items(), key=lambda x: -x[1]):
        L.append(f"  ⚠ ferme {k}: {perche}")
    return L


# ───────────────────────── le prove ─────────────────────────

def _barre(giorni, chiusure, massimi=None, minimi=None):
    return [{"t": t, "c": c, "h": (massimi or chiusure)[i], "l": (minimi or chiusure)[i], "v": 1000, "a": c}
            for i, (t, c) in enumerate(zip(giorni, chiusure))]


def _rec(tk, tipo, soglia, dal, sedute, p, metodo="casi_simili", scritto="2026-11-05T21:00+00:00", media=None, base=0.5):
    ev = f"{tk} {tipo} {soglia} fra {sedute} sedute"
    return A.previsione("titoli", tk, ev, p, metodo, A.evento_prezzo(tk, tipo, soglia, dal, sedute, media=media),
                        base=base, scritto=scritto)


def verifiche():
    """Le prove del registro dal vivo, su registri temporanei e barre sintetiche, senza rete: (nome, esito, dettaglio)."""
    V = []
    tmp = tempfile.mkdtemp(prefix="registro_previsioni_")
    try:
        _prove(V, tmp)
    except Exception as e:                                  # una prova che muore cade col suo nome (v407, v471)
        V.append(("le prove arrivano in fondo", False, f"{type(e).__name__}: {e}"))
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    return V


def _prove(V, tmp):
    from zoneinfo import ZoneInfo
    sera = datetime(2026, 11, 10, 23, 0, tzinfo=timezone.utc)            # dopo la campana: barre tutte concluse
    # la settimana sintetica: giovedi' 05/11 → venerdi' 06 → (sabato e domenica) → lunedi' 09 → martedi' 10
    G = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"]
    B = {"AAA": _barre(G, [100, 100, 100, 100, 99, 101, 98], massimi=[100, 100, 100, 100, 99.5, 101.5, 98.5]),
         "BBB": _barre(G[:6], [100, 100, 100, 100, 99, 101], massimi=[100, 100, 100, 100, 99.5, 101.5])}

    # (a) due registrazioni nello stesso giorno non raddoppiano; vale la prima; un esito gia' scritto non entra
    p = os.path.join(tmp, "a.jsonl")
    r1 = _rec("AAA", "chiude_sopra", 100, "2026-11-05", 2, 0.6)
    r2 = _rec("AAA", "tocca_su", 100.5, "2026-11-05", 2, 0.4)
    e1 = registra([r1, r2], sera, p)
    e2 = registra([dict(r1, probabilita=0.9), r2], sera, p)
    righe = leggi(p)["righe"]
    V.append(("(a) registrare due volte lo stesso giorno non duplica, e resta la prima probabilita'",
              e1["nuove"] == 2 and e2["nuove"] == 0 and e2["gia_presenti"] == 2 and len(righe) == 2
              and righe[0]["probabilita"] == 0.6, f"prima {e1['nuove']} nuove, poi {e2['nuove']} ({e2['gia_presenti']} gia' presenti)"))
    e3 = registra([A.risolvi(_rec("AAA", "tocca_giu", 90, "2026-11-05", 2, 0.1), True, "2026-11-06")], sera, p)
    V.append(("(a') una previsione che porta gia' l'esito non entra nel registro dal vivo",
              e3["nuove"] == 0 and len(e3["scartate"]) == 1 and len(leggi(p)["righe"]) == 2, str(e3["scartate"][:1])))

    # (b) un «tocca» si risolve SI' appena toccato, prima della scadenza; un «chiude_sopra» aspetta la sua seduta
    p = os.path.join(tmp, "b.jsonl")
    registra([_rec("BBB", "tocca_su", 101, "2026-11-05", 20, 0.5), _rec("BBB", "chiude_sopra", 100, "2026-11-05", 20, 0.5),
              _rec("BBB", "chiude_sopra", 100, "2026-11-05", 3, 0.5), _rec("BBB", "tocca_su", 120, "2026-11-05", 2, 0.2),
              _rec("BBB", "tocca_su", 120, "2026-11-05", 3, 0.2)], sera, p)
    e = risolvi_scadute(B, sera, p)
    s = {r["evento"]: r for r in leggi(p)["righe"]}
    V.append(("(b) un «tocca» si risolve SI' appena toccato, alla 2a seduta di 20",
              s["BBB tocca_su 101 fra 20 sedute"]["esito"] is True
              and s["BBB tocca_su 101 fra 20 sedute"]["risolto_il"] == "2026-11-09", ""))
    V.append(("(b) un «chiude_sopra» non si risolve prima della sua seduta (2 di 3 o di 20 sedute passate)",
              s["BBB chiude_sopra 100 fra 20 sedute"]["esito"] is None and s["BBB chiude_sopra 100 fra 3 sedute"]["esito"] is None
              and stato(s["BBB chiude_sopra 100 fra 3 sedute"]) == "aperta", ""))
    V.append(("(b) un «tocca» mai toccato e' NO solo a orizzonte concluso (2 sedute su 2 si', 2 su 3 no)",
              s["BBB tocca_su 120 fra 2 sedute"]["esito"] is False and s["BBB tocca_su 120 fra 3 sedute"]["esito"] is None,
              f"risolte ora {len(e['risolte_ora'])}"))

    # (c) le sedute si contano sulle barre: dal giovedi', la 2a seduta e' il LUNEDI' (venerdi' 99, lunedi' 101)
    p = os.path.join(tmp, "c.jsonl")
    registra([_rec("AAA", "chiude_sopra", 100, "2026-11-05", 2, 0.5), _rec("AAA", "tocca_su", 100.5, "2026-11-05", 2, 0.5)],
             sera, p)
    risolvi_scadute(B, sera, p)
    s = {r["evento"]: r for r in leggi(p)["righe"]}
    a, t = s["AAA chiude_sopra 100 fra 2 sedute"], s["AAA tocca_su 100.5 fra 2 sedute"]
    V.append(("(c) un fine settimana non e' una seduta: chiude_sopra a 2 sedute dal giovedi' si legge al lunedi' (SI')",
              a["esito"] is True and a["risolto_il"] == "2026-11-09" and t["esito"] is True and t["risolto_il"] == "2026-11-09",
              f"{a['esito']} il {a['risolto_il']}; tocca {t['esito']} il {t['risolto_il']}"))
    # la fixture contiene il fenomeno: contando i giorni di calendario (giovedi' + 2 = sabato) l'esito sarebbe NO
    fine = (date(2026, 11, 5) + timedelta(days=2)).isoformat()
    cal = [x for x in B["AAA"] if "2026-11-05" < x["t"] <= fine]
    V.append(("(c') la fixture distingue: coi giorni di calendario la chiusura sarebbe quella di venerdi' (99, NO)",
              cal[-1]["c"] <= 100 and max(x["h"] for x in cal) < 100.5, f"calendario: {cal[-1]['t']} a {cal[-1]['c']}"))
    # la barra in formazione non e' una seduta: lunedi' alle 15 di New York la chiusura di lunedi' non esiste ancora
    p = os.path.join(tmp, "c2.jsonl")
    registra([_rec("BBB", "chiude_sopra", 100, "2026-11-05", 2, 0.5)], sera, p)
    risolvi_scadute(B, datetime(2026, 11, 9, 15, 0, tzinfo=ZoneInfo("America/New_York")), p)
    V.append(("(c'') la barra di oggi prima della campana non conta: la previsione resta aperta",
              leggi(p)["righe"][0]["esito"] is None, ""))

    # (d) un risolutore mancante lascia la previsione aperta col perche', e non ferma le altre
    p = os.path.join(tmp, "d.jsonl")
    serie = A.previsione("macro", "HY", "spread HY sopra 4% fra 10 sedute", 0.3, "serie_storiche",
                         A.evento_serie("BAMLH0A0HYM2", "tocca_sopra", 4.0, "2026-11-05", 10), scritto="2026-11-05T21:00+00:00")
    est = A.previsione("mercato", "FED", "taglio a dicembre", 0.7, "polymarket", A.evento_esterno("polymarket", "123", "Yes",
                       "2026-12-10"), scritto="2026-11-05T21:00+00:00")
    registra([serie, est, _rec("AAA", "chiude_sopra", 100, "2026-11-05", 2, 0.5)], sera, p)
    vero = ESTERNI["serie"]
    ESTERNI["serie"] = ("modulo_che_non_esiste_v536", "risolvi_serie")
    try:
        risolvi_scadute(B, sera, p, risolutori={"esterno": lambda ris: 1 / 0})
    finally:
        ESTERNI["serie"] = vero
    s = {r["metodo"]: r for r in leggi(p)["righe"]}
    V.append(("(d) un risolutore mancante lascia la previsione aperta col perche' (non diventa NO)",
              s["serie_storiche"]["esito"] is None and stato(s["serie_storiche"]) == "aperta"
              and "non disponibile" in s["serie_storiche"]["extra"].get("attesa", ""), s["serie_storiche"]["extra"].get("attesa", "")))
    V.append(("(d) un risolutore in errore resta aperto col perche', e le altre si risolvono lo stesso",
              s["polymarket"]["esito"] is None and "in errore" in s["polymarket"]["extra"].get("attesa", "")
              and s["casi_simili"]["esito"] is True, s["polymarket"]["extra"].get("attesa", "")))
    risolvi_scadute(B, sera, p, risolutori={"serie": lambda ris: (False, "", "2026-11-19"),
                                            "esterno": lambda ris: {"esito": None, "non_risolvibile": True, "motivo": "mercato annullato"}})
    s = {r["metodo"]: r for r in leggi(p)["righe"]}
    V.append(("(d') tornato il risolutore, la previsione si risolve; un mercato annullato e' non risolvibile, non NO",
              s["serie_storiche"]["esito"] is False and "attesa" not in s["serie_storiche"]["extra"]
              and stato(s["polymarket"]) == "non_risolvibile" and s["polymarket"]["esito"] is None, ""))

    # (e) il bilancio di un metodo calibrato ha ECE piccolo; uno sovraconfidente no; i conteggi tornano
    p = os.path.join(tmp, "e.jsonl")
    righe = []
    for k in range(10):
        q = (k + 0.5) / 10
        for i in range(100):
            r = _rec(f"T{k}", "chiude_sopra", i, "2026-11-05", 20, q, base=0.5)
            righe.append(A.risolvi(r, i < round(q * 100), "2026-12-04"))
    for i in range(200):
        r = _rec(f"S{i}", "chiude_sopra", 1, "2026-11-05", 20, 0.9, metodo="lognormale", base=0.5)
        righe.append(A.risolvi(r, i % 2 == 0, "2026-12-04"))
    righe.append(_rec("AP", "chiude_sopra", 1, "2026-11-05", 20, 0.5))
    _scrivi(p, righe)
    b = bilancio(p)
    g = {x["chiave"]["metodo"]: x for x in b["gruppi"]}
    vc, vs = g["casi_simili"]["valutazione"], g["lognormale"]["valutazione"]
    V.append(("(e) il bilancio di un metodo calibrato ha ECE piccolo e abilita' positiva contro la base del record",
              vc["ece"] < 0.01 and vc["abilita"] > 0.3 and vc["base_dichiarata"].startswith("la base di ogni"),
              f"ece {vc['ece']:.4f} abilita' {vc['abilita']:.3f}"))
    V.append(("(e) un metodo sovraconfidente ha ECE alto: la misura morde",
              vs["ece"] > 0.35 and vs["abilita"] < 0, f"ece {vs['ece']:.3f}"))
    V.append(("(e) i conteggi: registrate, aperte, risolte, non risolvibili",
              (b["registrate"], b["aperte"], b["risolte"], b["non_risolvibili"]) == (1201, 1, 1200, 0)
              and g["casi_simili"]["aperte"] == 1, f"{b['registrate']}/{b['aperte']}/{b['risolte']}/{b['non_risolvibili']}"))
    q = n_previsioni([_rec("X", "tocca_su", 1, "2026-11-05", 5, 0.5), _rec("Y", "tocca_su", 1, "2026-11-05", 5, 0.5)])
    gq = q["gruppi"]["casi_simili"]
    V.append(("n_previsioni: due monete aperte — attese 1, almeno 1 con il 75%, e la nota sull'indipendenza",
              abs(gq["attese"] - 1) < 1e-12 and gq["k50"] == 1 and abs(gq["p50"] - 0.75) < 1e-12 and "indipendenti" in q["nota"], ""))

    # la scrittura e' atomica: un errore a meta' lascia il registro di prima, e nessun temporaneo
    prima = open(p, encoding="utf-8").read()
    try:
        _scrivi(p, righe[:3] + [{"id": "x", "guasto": {1, 2}}])
        rotta = False
    except TypeError:
        rotta = True
    V.append(("scrittura atomica: un errore a meta' lascia il registro intatto e nessun file temporaneo",
              rotta and open(p, encoding="utf-8").read() == prima
              and not [f for f in os.listdir(tmp) if f.endswith(".tmp")], ""))
    # una riga guasta si dichiara e blocca la riscrittura
    with open(p, "a", encoding="utf-8") as f:
        f.write("<<<<<<< HEAD\n")
    e = registra([_rec("Z", "tocca_su", 1, "2026-11-05", 5, 0.5)], sera, p)
    V.append(("una riga guasta si dichiara e il registro non si riscrive (non si perde niente)",
              bool(e.get("errore")) and bilancio(p)["guaste"] and open(p, encoding="utf-8").read() == prima + "<<<<<<< HEAD\n",
              e.get("errore", "")))
    # barre riscalate dopo la previsione (frazionamento 10:1): la soglia si riporta alla scala di oggi
    p = os.path.join(tmp, "f.jsonl")
    registra([_rec("AAA", "chiude_sopra", 100, "2026-11-05", 2, 0.5)], sera, p, B=B)
    divise = {"AAA": [dict(x, c=x["c"] / 10, h=x["h"] / 10, l=x["l"] / 10) for x in B["AAA"]]}
    risolvi_scadute(divise, sera, p)
    r = leggi(p)["righe"][0]
    V.append(("un frazionamento dopo la previsione non la falsa: soglia riscalata e dichiarata",
              r["extra"].get("chiusura_dal") == 100 and r["esito"] is True
              and r["extra"]["risoluzione"].get("fattore_scala") == 0.1, str(r["extra"].get("risoluzione"))))
    # il registro assente non si crea risolvendo; la resa dice «assente»
    p = os.path.join(tmp, "nessuno.jsonl")
    e = risolvi_scadute({}, sera, p)
    V.append(("un registro assente non si crea risolvendo, e la resa lo dichiara",
              e.get("assente") and not os.path.exists(p) and "assente" in resa_bilancio(bilancio(p))[0], ""))


# ───────────────────────── il comando ─────────────────────────

def main(argv):
    if not argv or argv[0] not in ("bilancio", "aperte", "risolvi", "verifiche"):
        print(__doc__)
        return 2
    if argv[0] == "bilancio":
        print("\n".join(resa_bilancio(bilancio())))
        return 0
    if argv[0] == "aperte":
        print("\n".join(resa_aperte()))
        return 0
    if argv[0] == "risolvi":
        e = risolvi_scadute()
        print("\n".join(resa_risolvi(e)))
        return 1 if e.get("errore") else 0
    ok = True
    for nome, esito, dettaglio in verifiche():
        print(("PASS  " if esito else "FAIL  ") + nome + (f" — {dettaglio}" if dettaglio else ""))
        ok &= bool(esito)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
