#!/usr/bin/env python3
"""v535 — LE PROBABILITA' DEGLI EVENTI DI PREZZO col metodo dei CASI SIMILI (sistema previsionale del 03/11/2026).

Decisione del CEO del 03/11/2026: per ogni evento una probabilita' e la sua affidabilita' MISURATA — l'«eccezione
misurata» alla regola n.1. Qui gli eventi di PREZZO delle posizioni (famiglia "titoli") e di QQQ e SMH ("mercato"):
- «sopra il prezzo di oggi fra 20 e fra 60 sedute» (chiude_sopra);
- «tocca +10% / -10% entro 20 sedute» (tocca_su / tocca_giu);
- per chi e' sotto la media a 200: «chiude sopra la media a 200 entro 20 / 60 sedute» (chiude_sopra_media);
- per le posizioni sotto il carico del CEO: «tocca il carico entro 60 / 120 / 252 sedute» (tocca_su, soglia = carico).

Il METODO "casi_simili": la probabilita' e' la FREQUENZA dell'evento nei casi simili dell'universo — lo stesso stato
di statistica.py (chiave; con meno di 30 casi lo stato largo; sotto ancora «non disponibile»), un caso al piu' ogni
20 sedute per titolo — con la SOGLIA espressa nelle unita' di volatilita' di ciascun caso:
    z = ln(soglia / chiusura) / (sigma a 20 sedute · radice di h)
(sigma = deviazione standard, di popolazione, dei 20 rendimenti logaritmici fino al giorno compreso). Ogni caso e'
valutato alla STESSA z di oggi: +10% in 20 sedute per un titolo che oscilla l'1% al giorno e' z 2,1; per uno che
oscilla il 4% e' z 0,5 — due eventi diversi, e i casi lo sanno. Per la media a 200, che si muove col prezzo, la z
non si riapplica: i casi sono i giorni sotto la media con la distanza normalizzata nella STESSA FASCIA di oggi.
La BASE: lo stesso evento normalizzato in tutti i giorni, senza condizioni sullo stato. Intervallo di Wilson al 95%.

SENZA FUTURO: `prevedi(..., fino)` usa solo i casi il cui esito e' noto entro `fino` (la seduta h dopo il caso sta
entro `fino`, per DATA, v207). La calibrazione walk-forward rifa' cosi' le previsioni del passato e le misura con
affidabilita.valuta, per tipo di evento e orizzonte: e' la «% di affidabilita'».

⚠ L'universo sono i nomi seguiti OGGI: anche perche' sopravvissuti (la statistica pende verso chi e' andato bene,
di piu' nelle discese profonde). I casi dello stesso giorno si muovono insieme e, oltre 20 sedute, le finestre di due
casi dello stesso titolo si sovrappongono: l'intervallo di Wilson suppone casi indipendenti ed e' piu' stretto del
vero. Probabilita', non fatti: stanno separate dai fatti e non si mediano mai con altri metodi (v200).

Uso:
  python3 scripts/previsioni_titoli.py                       le verifiche (fixture sintetiche, senza rete)
  python3 scripts/previsioni_titoli.py oggi [--barre FILE]   le previsioni di oggi e la calibrazione sui dati veri
"""
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

QUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, QUI)
import affidabilita as A          # noqa: E402
import statistica as S            # noqa: E402

RADICE = os.path.dirname(QUI)
CACHE = os.path.join(RADICE, "memoria", "dati", "calibrazione_titoli.json")
VALIDITA_ORE = 24                 # la calibrazione si rifa' dopo 24 ore (o se cambiano le convenzioni)

# ── Le convenzioni (v240): non sono misure, sono il modo di contare ──
METODO = "casi_simili"
SEDUTE_VOL = 20                   # la sigma che normalizza la soglia: 20 rendimenti logaritmici fino al giorno
ORIZZONTI_SOPRA = (20, 60)        # «sopra il prezzo di oggi fra h sedute»
TOCCA_PCT = 10.0                  # «tocca +10% / -10%»
ORIZZONTE_TOCCA = 20              # … entro 20 sedute
MEDIA = 200                       # la media mobile semplice delle chiusure, chiusura del giorno compresa
ORIZZONTI_MEDIA = (20, 60)        # «chiude sopra la media a 200 entro h sedute», solo per chi e' sotto
ORIZZONTI_CARICO = (60, 120, 252)  # «tocca il carico entro h sedute», solo per le posizioni sotto il carico
SALITE_CALIBRAZIONE = (5.0, 25.0, 50.0)   # il carico del CEO nel passato non c'era: la calibrazione di
#                                          «tocca_su» a 60/120/252 sedute usa salite di +5, +25 e +50%
FASCE_SOGLIA = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0)   # le fasce della soglia normalizzata z (in sigma·radice di h)
DISTANZA = S.DISTANZA             # un caso al piu' ogni 20 sedute per titolo (lo stesso movimento non conta due volte)
MIN_CASI = S.MIN_CASI             # sotto 30 casi: lo stato largo, poi «non disponibile»
RISCALDAMENTO = S.SEDUTE_ANNO     # la calibrazione comincia dopo il primo anno di ogni serie
PASSO = 20                        # una previsione storica ogni 20 sedute per titolo
MERCATO = ("QQQ", "SMH")          # la famiglia "mercato"
DIVERSIFICANTI = ("XLV", "XLP", "XLE")    # nell'universo con QQQ e SMH, quando le barre si leggono qui
_ORIZZONTI = tuple(sorted(set(ORIZZONTI_SOPRA + (ORIZZONTE_TOCCA,) + ORIZZONTI_MEDIA + ORIZZONTI_CARICO)))
_LONTANO = np.iinfo(np.int64).max     # «esito non ancora noto»: nessun `fino` lo raggiunge
TIPI = ("chiude_sopra", "tocca_su", "tocca_giu", "chiude_sopra_media")
NOMI_GRUPPO = {"chiude_sopra": "sopra il prezzo di oggi fra {h} sedute", "tocca_su": "tocca una soglia sopra entro {h} sedute",
               "tocca_giu": "tocca una soglia sotto entro {h} sedute",
               "chiude_sopra_media": "chiude sopra la media a 200 entro {h} sedute"}

_n = S._n


def _convenzioni():
    """Le convenzioni che decidono la calibrazione: se una cambia, la calibrazione salvata non vale piu'."""
    return {"metodo": METODO, "sedute_vol": SEDUTE_VOL, "orizzonti_sopra": list(ORIZZONTI_SOPRA), "tocca_pct": TOCCA_PCT,
            "orizzonte_tocca": ORIZZONTE_TOCCA, "media": MEDIA, "orizzonti_media": list(ORIZZONTI_MEDIA),
            "orizzonti_carico": list(ORIZZONTI_CARICO), "salite_calibrazione": list(SALITE_CALIBRAZIONE),
            "fasce_soglia": list(FASCE_SOGLIA), "distanza": DISTANZA, "min_casi": MIN_CASI,
            "riscaldamento": RISCALDAMENTO, "stato": "statistica.chiave / chiave_larga"}


def fascia_soglia(z):
    """L'indice della fascia della soglia normalizzata |z| e la sua etichetta («fra 0,5 e 0,75 sigma»)."""
    if z is None or not math.isfinite(z):
        return None, "non misurabile"
    a = abs(z)
    k = int(np.searchsorted(FASCE_SOGLIA, a, side="right"))
    lo = FASCE_SOGLIA[k - 1] if k else 0.0
    return k, (f"oltre {_n(lo, 2)} sigma" if k == len(FASCE_SOGLIA) else f"fra {_n(lo, 2)} e {_n(FASCE_SOGLIA[k], 2)} sigma")


def _giorno(s):
    return int(np.datetime64(str(s)[:10], "D").astype(np.int64))


# ───────────────────────── la preparazione: stati ed esiti in array, una volta per universo ─────────────────────────

class _Titolo:
    """Le barre di un titolo (la serie della societa' di oggi) in array: stato, sigma, media e — per ogni orizzonte —
    il massimo, il minimo, la chiusura e «una chiusura sopra la media» delle h sedute DOPO ogni giorno, con la data in
    cui quell'esito diventa noto."""

    def __init__(self, tk, b, codici):
        self.tk, self.b, self.n = tk, b, len(b)
        n = self.n
        self.t = [x["t"][:10] for x in b]
        self.d = np.array(self.t, dtype="datetime64[D]").astype(np.int64)
        self.c = np.array([x["c"] for x in b], float)
        hi = np.array([x["h"] for x in b], float)
        lo = np.array([x["l"] for x in b], float)
        with np.errstate(divide="ignore", invalid="ignore"):
            lr = np.full(n, np.nan)
            lr[1:] = np.log(self.c[1:] / self.c[:-1])
            self.sig = np.full(n, np.nan)
            if n > SEDUTE_VOL:
                self.sig[SEDUTE_VOL:] = sliding_window_view(lr[1:], SEDUTE_VOL).std(axis=1)
            self.ma = np.full(n, np.nan)
            if n >= MEDIA:
                cs = np.concatenate([[0.0], np.cumsum(self.c)])
                self.ma[MEDIA - 1:] = (cs[MEDIA:] - cs[:-MEDIA]) / MEDIA
            sopra = np.where(np.isfinite(self.ma), self.c > self.ma, False)
        ss = S.stati(b)
        self.stati = ss
        kp, kl = np.full(n, -1), np.full(n, -1)
        for i, s in enumerate(ss):
            k = S.chiave(s)
            if k is None or s["atr"] is None:
                continue
            kp[i] = codici.setdefault(k, len(codici))
            kl[i] = codici.setdefault(S.chiave_larga(k), len(codici))
        self.kp, self.kl = kp, kl
        self.valido = (kp >= 0) & np.isfinite(self.sig) & (self.sig > 0) & (self.c > 0)
        self.sotto = self.valido & np.isfinite(self.ma) & (self.c < self.ma)
        self.f = {}
        for h in _ORIZZONTI:
            fmax, fmin, fin, fsm = (np.full(n, np.nan) for _ in range(4))
            noto = np.full(n, _LONTANO, dtype=np.int64)
            if n > h:
                fmax[:n - h] = sliding_window_view(hi[1:], h).max(axis=1)
                fmin[:n - h] = sliding_window_view(lo[1:], h).min(axis=1)
                fin[:n - h] = self.c[h:]
                fsm[:n - h] = sliding_window_view(sopra[1:], h).any(axis=1)
                noto[:n - h] = self.d[h:]
            with np.errstate(divide="ignore", invalid="ignore"):
                u = self.sig * math.sqrt(h)
                self.f[h] = {"max": fmax, "min": fmin, "fin": fin, "sopra_media": fsm, "noto": noto,
                             "su": np.log(fmax / self.c) / u, "giu": np.log(self.c / fmin) / u,
                             "ch": np.log(fin / self.c) / u, "z_media": np.log(self.ma / self.c) / u}

    def indice(self, giorno):
        """L'ultima seduta con data entro `giorno` (AAAA-MM-GG); None se non ce n'e'."""
        k = int(np.searchsorted(self.d, _giorno(giorno), side="right")) - 1
        return k if k >= 0 else None


def _dirada(idx):
    """Un caso al piu' ogni DISTANZA sedute, in ordine di tempo (come statistica.casi): la scelta di un giorno dipende
    solo dai giorni prima, quindi tagliare la coda per `fino` dopo la scelta da' gli stessi casi di prima."""
    out, ultimo = [], -10 ** 9
    for i in idx.tolist():
        if i - ultimo >= DISTANZA:
            out.append(i)
            ultimo = i
    return np.array(out, dtype=np.int64)


class _Universo:
    def __init__(self, B, veicoli):
        self.codici = {}
        self.titoli = {}
        self.non_letti = []
        for tk, b in B.items():
            s = S.serie(b, (veicoli or {}).get(tk)) if b else []
            if len(s) < 2:
                self.non_letti.append(tk)
                continue
            self.titoli[tk] = _Titolo(tk, s, self.codici)
        self._casi = {}
        self.inverso = {}

    def _maschera(self, T, genere, code):
        m = T.valido if genere == "base" else T.valido & ((T.kp if genere == "pieno" else T.kl) == code)
        return m

    def casi(self, genere, code, h):
        """I casi dello stato (genere 'pieno' o 'largo' col suo codice; 'base' = ogni giorno misurabile), ordinati per
        la data in cui l'esito a h sedute diventa noto: {'noto', 'su', 'giu', 'ch'}."""
        chiave = ("soglia", genere, code, h)
        if chiave not in self._casi:
            parti = []
            for T in self.titoli.values():
                i = _dirada(np.flatnonzero(self._maschera(T, genere, code)))
                if len(i):
                    f = T.f[h]
                    parti.append((f["noto"][i], f["su"][i], f["giu"][i], f["ch"][i]))
            self._casi[chiave] = _ordina(parti, ("noto", "su", "giu", "ch"))
        return self._casi[chiave]

    def casi_media(self, genere, code, h, fascia):
        """I casi sotto la media a 200 con la distanza normalizzata nella stessa fascia: {'noto', 'esito'}."""
        chiave = ("media", genere, code, h, fascia)
        if chiave not in self._casi:
            parti = []
            for T in self.titoli.values():
                f = T.f[h]
                with np.errstate(invalid="ignore"):
                    fz = np.searchsorted(FASCE_SOGLIA, np.nan_to_num(np.abs(f["z_media"]), nan=-1.0), side="right")
                m = self._maschera(T, genere, code) & T.sotto & (fz == fascia)
                i = _dirada(np.flatnonzero(m))
                if len(i):
                    parti.append((f["noto"][i], f["sopra_media"][i]))
            self._casi[chiave] = _ordina(parti, ("noto", "esito"))
        return self._casi[chiave]


def _ordina(parti, nomi):
    if not parti:
        return {k: np.array([], dtype=np.int64 if k == "noto" else float) for k in nomi}
    cols = [np.concatenate([p[j] for p in parti]) for j in range(len(nomi))]
    o = np.argsort(cols[0], kind="stable")
    return {k: c[o] for k, c in zip(nomi, cols)}


_PREP = {}


def _impronta(B, veicoli):
    return (tuple(sorted((tk, len(b or []), (b or [{}])[0].get("t"), (b or [{}])[-1].get("t"), (b or [{}])[-1].get("c"))
                         for tk, b in B.items())),
            json.dumps(veicoli or {}, sort_keys=True, default=str))


def prepara(B, veicoli=None):
    """L'universo in array, una volta per insieme di barre (memoria per impronta: titoli, lunghezze, prima e ultima
    seduta, ultima chiusura, veicoli)."""
    k = _impronta(B, veicoli)
    if k not in _PREP:
        _PREP.clear()
        _PREP[k] = _Universo(B, veicoli)
    return _PREP[k]


def veicoli_pipeline():
    """La fine dei veicoli di quotazione verificata sul registro SEC (rotazione.veicolo_pipeline, v492), letta da
    data.json sul disco (mai la rete): OKLO e RGTI prima della fusione erano un'altra cosa. {} se non si legge."""
    try:
        import fonti_titoli
        import rotazione as R
        d = fonti_titoli.carica()
        sq = (((d or {}).get("macro") or {}).get("sec_calendario") or {}).get("storia_quotazione") or {}
        return {tk: R.veicolo_pipeline(d, tk) for tk in (sq.get("per_titolo") or {})}
    except Exception:
        return {}


# ───────────────────────── la previsione ─────────────────────────

def _taglio(noto, fino):
    """Quanti casi hanno l'esito noto entro `fino` (giorno intero): la sola porta da cui passa il futuro."""
    return int(np.searchsorted(noto, fino, side="right"))


def _conta(arr, campo, z, fino, stretto):
    m = _taglio(arr["noto"], fino)
    v = arr[campo][:m]
    return (int((v > z).sum()) if stretto else int((v >= z).sum())), m


def _prevedi_indice(U, T, t, tipo, soglia, h, fino):
    """La previsione dell'evento per il titolo T alla seduta t, coi soli casi noti entro `fino` (giorno intero)."""
    c, sig = T.c[t], T.sig[t]
    out = {"tk": T.tk, "data": T.t[t], "prezzo": float(c), "tipo": tipo, "soglia": soglia, "h": h, "stato": None,
           "largo": False, "z": None, "fascia_soglia": None}
    kp = int(T.kp[t])
    if kp < 0 or not T.valido[t]:
        out["non_disponibile"] = (f"stato non misurabile alla seduta del {T.t[t]} ({t + 1} sedute di storia: la tendenza"
                                  f" ne vuole 200, la distanza dal massimo un anno)")
        return out
    if len(U.inverso) != len(U.codici):
        U.inverso = {v: k for k, v in U.codici.items()}
    out["stato"] = S.descrivi(U.inverso[kp])
    if tipo == "chiude_sopra_media":
        if not T.sotto[t]:
            out["non_disponibile"] = "il prezzo non e' sotto la media a 200: l'evento non si prevede"
            return out
        z = float(T.f[h]["z_media"][t])
        fz, et = fascia_soglia(z)
        out.update({"z": z, "fascia_soglia": et})
        scelte = [("pieno", kp), ("largo", int(T.kl[t]))]
        for genere, code in scelte:
            arr = U.casi_media(genere, code, h, fz)
            k, n = _conta(arr, "esito", 0.5, fino, True)
            if n >= MIN_CASI:
                break
        bb = U.casi_media("base", -1, h, fz)
        kb, nb = _conta(bb, "esito", 0.5, fino, True)
    else:
        if tipo == "tocca_giu":
            z, campo, stretto = math.log(c / soglia) / (sig * math.sqrt(h)), "giu", False
        else:
            z = math.log(soglia / c) / (sig * math.sqrt(h))
            campo, stretto = ("ch", True) if tipo == "chiude_sopra" else ("su", False)
        out.update({"z": z, "fascia_soglia": fascia_soglia(z)[1]})
        for genere, code in (("pieno", kp), ("largo", int(T.kl[t]))):
            k, n = _conta(U.casi(genere, code, h), campo, z, fino, stretto)
            if n >= MIN_CASI:
                break
        kb, nb = _conta(U.casi("base", -1, h), campo, z, fino, stretto)
    out["largo"] = genere == "largo"
    if out["largo"]:
        out["stato"] += " (stato largo: lo stato pieno ha meno di 30 casi)"
    out.update({"k": k, "n": n, "n_base": nb, "base": (kb / nb) if nb else None})
    if n < MIN_CASI:
        out["non_disponibile"] = f"{n} casi simili anche con lo stato largo: sotto {MIN_CASI} la statistica non generalizza"
        return out
    out["p"] = k / n
    out["intervallo"] = A.wilson(k, n)
    return out


def prevedi(tk, evento, B, fino=None, veicoli=None):
    """La probabilita' di un evento (un risolutore affidabilita.evento_prezzo) col metodo dei casi simili, come la si
    sarebbe data alla data `dal` dell'evento coi soli casi il cui esito e' noto entro `fino` (None: entro `dal`). Un
    `fino` oltre `dal` non si usa: tra i casi noti dopo `dal` ci sarebbe l'evento stesso.
    → {'p', 'k', 'n', 'base', 'n_base', 'intervallo', 'stato', 'largo', 'z', 'fascia_soglia', ...}
      oppure con 'non_disponibile' e il perche'."""
    U = prepara(B, veicoli)
    T = U.titoli.get(tk)
    if T is None:
        return {"tk": tk, "non_disponibile": "storico NON letto: senza barre non c'e' statistica"}
    dal = evento.get("dal") or T.t[-1]
    lim = min(str(fino)[:10], dal) if fino else dal
    t = T.indice(lim)
    if t is None:
        return {"tk": tk, "non_disponibile": f"nessuna seduta entro il {lim}"}
    return _prevedi_indice(U, T, t, evento["tipo"], evento.get("soglia"), int(evento["sedute"]), _giorno(lim))


def _esito(T, t, tipo, soglia, h):
    """L'esito vero dalle barre, con la semantica di affidabilita.evento_prezzo; None se non ancora noto."""
    if t + h > T.n - 1:
        return None
    f = T.f[h]
    if tipo == "chiude_sopra":
        return bool(f["fin"][t] > soglia)
    if tipo == "tocca_su":
        return bool(f["max"][t] >= soglia)
    if tipo == "tocca_giu":
        return bool(f["min"][t] <= soglia)
    return bool(f["sopra_media"][t])


def _esito_scalare(b, t, ev):
    """L'oracolo delle verifiche: lo stesso esito contato barra per barra, senza array (la semantica scritta in
    affidabilita.evento_prezzo)."""
    h = ev["sedute"]
    if t + h > len(b) - 1:
        return None
    fut = b[t + 1:t + h + 1]
    if ev["tipo"] == "chiude_sopra":
        return fut[-1]["c"] > ev["soglia"]
    if ev["tipo"] == "tocca_su":
        return any(x["h"] >= ev["soglia"] for x in fut)
    if ev["tipo"] == "tocca_giu":
        return any(x["l"] <= ev["soglia"] for x in fut)
    m = ev.get("media") or MEDIA
    return any(b[j]["c"] > sum(x["c"] for x in b[j - m + 1:j + 1]) / m for j in range(t + 1, t + h + 1))


# ───────────────────────── la calibrazione walk-forward ─────────────────────────

def _eventi_storici(T, t):
    """Gli eventi della calibrazione alla seduta t: gli stessi di oggi, col carico sostituito da salite fisse."""
    c = T.c[t]
    ev = [("chiude_sopra", h, c) for h in ORIZZONTI_SOPRA]
    ev += [("tocca_su", ORIZZONTE_TOCCA, c * (1 + TOCCA_PCT / 100)), ("tocca_giu", ORIZZONTE_TOCCA, c * (1 - TOCCA_PCT / 100))]
    if T.sotto[t]:
        ev += [("chiude_sopra_media", h, None) for h in ORIZZONTI_MEDIA]
    ev += [("tocca_su", h, c * (1 + s / 100)) for h in ORIZZONTI_CARICO for s in SALITE_CALIBRAZIONE]
    return ev


def calibrazione(B, passo=PASSO, veicoli=None, adesso=None, percorso=CACHE, usa_cache=True):
    """Per ogni titolo, una seduta ogni `passo` dopo il primo anno: la previsione fatta con fino = quella seduta e
    l'esito vero; poi affidabilita.valuta(ps, ys, basi) per tipo di evento e orizzonte ('tipo|h'). La base di ogni
    previsione e' anch'essa contata col solo passato. Salvata in memoria/dati (fuori da git) e riusata per 24 ore se
    le convenzioni sono le stesse."""
    adesso = adesso or datetime.now(timezone.utc)
    # v537 (revisore, rilievo 8): la calibrazione si fa sullo STESSO universo delle previsioni di oggi (i veicoli di
    #   quotazione tagliati come in previsioni_oggi) e la cache vale solo per quello: universo e veicoli nella chiave
    veicoli = veicoli_pipeline() if veicoli == "pipeline" else (veicoli or {})
    import hashlib
    chiave_dati = hashlib.sha256(repr(_impronta(B, veicoli)).encode()).hexdigest()
    if usa_cache and percorso:
        try:
            c = json.load(open(percorso, encoding="utf-8"))
            eta = (adesso - datetime.fromisoformat(c["scritto"])).total_seconds() / 3600
            if (0 <= eta < VALIDITA_ORE and c.get("convenzioni") == _convenzioni() and c.get("passo") == passo
                    and c.get("universo") == chiave_dati):
                c["riusata"] = True
                return c
        except Exception:
            pass
    t0 = time.time()
    U = prepara(B, veicoli)
    acc, nd, date = {}, {}, []
    for T in U.titoli.values():
        for t in range(RISCALDAMENTO, T.n, passo):
            fino = int(T.d[t])
            for tipo, h, soglia in _eventi_storici(T, t):
                y = _esito(T, t, tipo, soglia, h)
                if y is None:
                    continue
                g = f"{tipo}|{h}"
                r = _prevedi_indice(U, T, t, tipo, soglia, h, fino)
                if r.get("non_disponibile"):
                    nd[g] = nd.get(g, 0) + 1
                    continue
                a = acc.setdefault(g, {"ps": [], "ys": [], "basi": [], "fz": []})
                a["ps"].append(r["p"]); a["ys"].append(y); a["basi"].append(r["base"])
                a["fz"].append(fascia_soglia(r["z"])[1])
                date.append(T.t[t])
    val, per_fascia = {}, {}
    for g, a in sorted(acc.items()):
        val[g] = A.valuta(a["ps"], a["ys"], a["basi"])
        pf = {}
        for et in sorted(set(a["fz"])):
            sel = [j for j, x in enumerate(a["fz"]) if x == et]
            v = A.valuta([a["ps"][j] for j in sel], [a["ys"][j] for j in sel], [a["basi"][j] for j in sel])
            pf[et] = {k: v[k] for k in ("n", "avverate", "brier", "brier_base", "abilita", "ece")}
        per_fascia[g] = pf
    out = {"scritto": adesso.isoformat(timespec="seconds"), "passo": passo, "convenzioni": _convenzioni(),
           "universo": chiave_dati,
           "metodo": METODO, "universo": sorted(U.titoli), "non_letti": sorted(U.non_letti),
           "dal": min(date) if date else None, "al": max(date) if date else None,
           "fino_al": max((T.t[-1] for T in U.titoli.values()), default=None),
           "previsioni": sum(v["n"] for v in val.values()), "non_disponibili": nd, "valutazioni": val,
           "per_fascia_soglia": per_fascia, "durata_s": round(time.time() - t0, 1), "riusata": False}
    if percorso:
        try:
            os.makedirs(os.path.dirname(percorso), exist_ok=True)
            json.dump(out, open(percorso, "w", encoding="utf-8"), ensure_ascii=False)
        except Exception as e:
            out["non_salvata"] = str(e)
    return out


# ───────────────────────── le previsioni di oggi ─────────────────────────

class Previsioni(list):
    """La lista dei record (affidabilita.previsione) con le ASSENZE accanto (v406): chi non ha la previsione si
    nomina col perche', non sparisce."""
    assenze = ()


def _data_it(g):
    return f"{g[8:10]}/{g[5:7]}/{g[0:4]}"


def _scade(dal, h):
    """Indicativa: h giorni feriali dopo `dal`, senza le festivita' di borsa (l'evento si risolve dalle sedute)."""
    return str(np.busday_offset(np.datetime64(dal, "D"), h, roll="forward"))


def _eventi_oggi(T, t, pmc):
    c = T.c[t]
    ev = [("chiude_sopra", h, c, f"sopra {_n(c, 2)} (la chiusura del {_data_it(T.t[t])}) fra {h} sedute") for h in ORIZZONTI_SOPRA]
    su, giu = c * (1 + TOCCA_PCT / 100), c * (1 - TOCCA_PCT / 100)
    ev += [("tocca_su", ORIZZONTE_TOCCA, su, f"tocca {_n(su, 2)} (+{_n(TOCCA_PCT, 0)}%) entro {ORIZZONTE_TOCCA} sedute"),
           ("tocca_giu", ORIZZONTE_TOCCA, giu, f"tocca {_n(giu, 2)} (-{_n(TOCCA_PCT, 0)}%) entro {ORIZZONTE_TOCCA} sedute")]
    if np.isfinite(T.ma[t]) and c < T.ma[t]:
        ev += [("chiude_sopra_media", h, None, f"chiude sopra la media a {MEDIA} (al {_data_it(T.t[t])} {_n(T.ma[t], 2)}) "
                f"entro {h} sedute") for h in ORIZZONTI_MEDIA]
    if pmc and c < pmc:
        ev += [("tocca_su", h, pmc, f"tocca il carico {_n(pmc, 2)} ({_n((pmc / c - 1) * 100, 1, True)}%) entro {h} sedute")
               for h in ORIZZONTI_CARICO]
    return ev


def previsioni_oggi(B, posiz, adesso=None, veicoli="pipeline"):
    """I record delle previsioni di oggi: per ogni posizione in dollari ("titoli") e per QQQ e SMH ("mercato"), alla
    ultima seduta CONCLUSA (la barra in formazione si toglie, v471), coi casi noti fino a quella seduta. risolutore =
    affidabilita.evento_prezzo con dal = l'ultima seduta conclusa. → Previsioni (lista) con .assenze."""
    import brief
    adesso = adesso or datetime.now(timezone.utc)
    veicoli = veicoli_pipeline() if veicoli == "pipeline" else (veicoli or {})
    B2 = {tk: (b[:-1] if (b and brief.barra_in_formazione(b, adesso)) else b) for tk, b in B.items()}
    U = prepara(B2, veicoli)
    scritto = adesso.astimezone(timezone.utc).isoformat(timespec="minutes")
    out, assenze = Previsioni(), []
    nomi = [(p["tk"], "titoli", p.get("pmc")) for p in posiz if p.get("valuta") == "USD"]
    nomi += [(tk, "mercato", None) for tk in MERCATO if tk not in {x[0] for x in nomi}]
    for p in posiz:
        if p.get("valuta") != "USD":
            assenze.append({"soggetto": p["tk"], "evento": "eventi di prezzo",
                            "perche": f"posizione in {p.get('valuta')}: fuori dall'universo delle barre in dollari"})
    for tk, fam, pmc in nomi:
        T = U.titoli.get(tk)
        if T is None:
            assenze.append({"soggetto": tk, "evento": "eventi di prezzo", "perche": "storico NON letto"})
            continue
        t = T.n - 1
        fino = int(T.d[t])
        if T.kp[t] < 0 or not T.valido[t]:
            assenze.append({"soggetto": tk, "evento": "eventi di prezzo", "perche": (
                f"stato non misurabile ({T.n} sedute di storia: la tendenza ne vuole 200, la distanza dal massimo un anno)")})
            continue
        for tipo, h, soglia, frase in _eventi_oggi(T, t, pmc):
            r = _prevedi_indice(U, T, t, tipo, soglia, h, fino)
            if r.get("non_disponibile"):
                assenze.append({"soggetto": tk, "evento": f"{tk} {frase}", "perche": r["non_disponibile"]})
                continue
            ris = A.evento_prezzo(tk, tipo, None if soglia is None else round(float(soglia), 4), T.t[t], h,
                                  MEDIA if tipo == "chiude_sopra_media" else None)
            extra = {"gruppo": f"{tipo}|{h}", "stato": r["stato"], "largo": r["largo"], "z": round(r["z"], 3),
                     "fascia_soglia": r["fascia_soglia"], "n_base": r["n_base"], "prezzo": round(r["prezzo"], 4),
                     "carico": tipo == "tocca_su" and h in ORIZZONTI_CARICO and soglia == pmc}
            if h > DISTANZA:
                extra["sovrapposte"] = (f"finestre di {h} sedute con casi ogni {DISTANZA}: si sovrappongono, "
                                        "l'intervallo e' piu' stretto del vero")
            out.append(A.previsione(fam, tk, f"{tk} {frase}", r["p"], METODO, ris, scade=_scade(T.t[t], h),
                                    base=r["base"], n=r["n"], intervallo=r["intervallo"], extra=extra, scritto=scritto))
    out.assenze = assenze
    return out


# ───────────────────────── la resa ─────────────────────────

def _pc(x):
    return "n.d." if x is None else _n(100 * x, 0) + "%"


def riga(prev, calib):
    """La riga di affidabilita' (affidabilita.riga_affidabilita) di una previsione, dalla calibrazione del suo gruppo."""
    v = ((calib or {}).get("valutazioni") or {}).get(prev["extra"]["gruppo"])
    return A.riga_affidabilita(prev["probabilita"], v, METODO)


def _breve(prev):
    e = prev["evento"].split(" ", 1)[1]
    r = prev["risolutore"]
    if r["tipo"] == "chiude_sopra":
        return f"sopra fra {r['sedute']}"
    if prev["extra"].get("carico"):
        return f"carico entro {r['sedute']}"
    if r["tipo"] == "chiude_sopra_media":
        return f"sopra la media 200 entro {r['sedute']}"
    return e.split(" (", 1)[1].split(")")[0] + f" entro {r['sedute']}"


def resa(previsioni, calibrazione):
    """Le righe per l'analisi: l'intestazione (metodo, dati, avvertenze), per ogni nome due righe — gli eventi con
    probabilita', base, casi e intervallo; poi, per ognuno, cosa e' successo quando il metodo ha detto la stessa
    fascia (la riga_affidabilita in breve) — e in fondo l'abilita' contro la base per tipo di evento."""
    cal = calibrazione or {}
    val = cal.get("valutazioni") or {}
    L = [f"PREVISIONI DI PREZZO — metodo dei casi simili: PROBABILITA', non fatti (l'eccezione misurata alla regola n.1)."
         f" Affidabilita' misurata senza futuro su {cal.get('previsioni', 'n.d.')} previsioni storiche"
         + (f" dal {_data_it(cal['dal'])} al {_data_it(cal['al'])}" if cal.get("dal") else "")
         + (f", calibrazione del {_data_it(cal['scritto'][:10])}" if cal.get("scritto") else ""),
         "  ⚠ l'universo sono i nomi seguiti OGGI (sopravvissuti: pende verso chi e' andato bene); i casi dello stesso "
         "giorno si muovono insieme e oltre 20 sedute le finestre si sovrappongono: gli intervalli sono piu' stretti del vero"]
    per_nome = {}
    for p in previsioni:
        per_nome.setdefault(p["soggetto"], []).append(p)
    for tk, pp in per_nome.items():
        x = pp[0]["extra"]
        L.append(f"  {tk:5} {_n(x['prezzo'], 2)} al {_data_it(pp[0]['risolutore']['dal'])[:5]} ({x['stato']}) · "
                 + " · ".join(f"{_breve(p)}: {_pc(p['probabilita'])} [{_pc(p['intervallo'][0])}-{_pc(p['intervallo'][1])}]"
                              f" base a pari volatilita' {_pc(p['base'])} n {p['n']}" for p in pp))
        aff = []
        for p in pp:
            f = A.fascia_di(p["probabilita"], val.get(p["extra"]["gruppo"]))
            aff.append(f"{_breve(p)}: " + ("non misurata" if not f else
                                           f"{_pc(f['da'])}-{_pc(f['a'])} → {_pc(f['frequenza'])} su {f['n']}"
                                           + ("" if f["misurabile"] else " (non misurabile)")))
        L.append("        affidabilita' misurata (detto quella fascia → successo): " + " · ".join(aff))
    gruppi = {}
    for a in getattr(previsioni, "assenze", ()):
        ev = a["evento"].split(" ", 1)[1] if a["evento"].startswith(a["soggetto"] + " ") else a["evento"]
        gruppi.setdefault((a["soggetto"], a["perche"]), []).append(ev)
    for (tk, perche), evv in gruppi.items():
        L.append(f"  {tk:5} non disponibile — {'; '.join(evv)}: {perche}")
    if val:
        L.append("  abilita' contro la base per evento (1 - Brier/Brier della base: sotto zero il metodo NON fa meglio della "
                 "base; ECE = distanza media fra detto e successo): "
                 + " · ".join(f"{NOMI_GRUPPO[g.split('|')[0]].format(h=g.split('|')[1])} {_n(v['abilita'], 3, True)}, "
                              f"ECE {_n(v['ece'], 3)} ({v['n']})" for g, v in sorted(val.items(), key=lambda kv: (
                                  TIPI.index(kv[0].split('|')[0]), int(kv[0].split('|')[1])))))
    else:
        L.append("  affidabilita': calibrazione NON disponibile — le probabilita' qui sopra non hanno ancora la loro misura")
    return L


# ───────────────────────── le verifiche (fixture sintetiche, senza rete) ─────────────────────────

def _fixture(nomi_vol, sedute=900, seme=7, inizio="2020-01-01", deriva=0.0003):
    """Barre sintetiche (moto geometrico casuale) con date feriali: {tk: barre}. Solo per le prove."""
    rng = np.random.RandomState(seme)
    giorni = np.busday_offset(np.datetime64(inizio, "D"), np.arange(sedute), roll="forward")
    B = {}
    for tk, vol in nomi_vol.items():
        r = rng.normal(deriva, vol, sedute)
        c = 100 * np.exp(np.cumsum(r))
        sp = np.abs(rng.normal(0, vol / 2, sedute))
        B[tk] = [{"t": str(giorni[i]), "c": float(c[i]), "h": float(c[i] * (1 + sp[i])), "l": float(c[i] * (1 - sp[i])),
                  "v": float(1e6 * (1 + abs(rng.normal()))), "a": float(c[i])} for i in range(sedute)]
    return B


def verifiche():
    V = []
    t0 = time.time()
    vols = {f"T{k}": v for k, v in enumerate((0.008, 0.012, 0.016, 0.02, 0.025, 0.03, 0.035, 0.04))}
    B = _fixture(vols)
    tk = "T3"
    giorno = B[tk][600]["t"]
    ev = [A.evento_prezzo(tk, "chiude_sopra", B[tk][600]["c"], giorno, 20),
          A.evento_prezzo(tk, "tocca_su", B[tk][600]["c"] * 1.1, giorno, 20),
          A.evento_prezzo(tk, "tocca_giu", B[tk][600]["c"] * 0.9, giorno, 20),
          A.evento_prezzo(tk, "tocca_su", B[tk][600]["c"] * 1.25, giorno, 120)]

    # (a) nessun futuro: le barre aggiunte DOPO fino (un rialzo violento di tutti) non cambiano la previsione
    def senza_futuro():
        corto = {k: b[:640] for k, b in B.items()}
        lungo = {k: b[:640] + [dict(x, c=x["c"] * 3, h=x["h"] * 3, l=x["l"] * 3, a=x["a"] * 3) for x in b[640:]]
                 for k, b in B.items()}
        uguali = []
        for e in ev:
            r1 = prevedi(tk, e, corto, fino=giorno, veicoli={})
            r2 = prevedi(tk, e, lungo, fino=giorno, veicoli={})
            uguali.append(all(r1.get(k) == r2.get(k) for k in ("p", "n", "base", "n_base", "stato")) and r1.get("n"))
        return all(uguali), f"{sum(map(bool, uguali))}/{len(uguali)} eventi identici"
    ok, det = senza_futuro()
    V.append(("(a) nessun futuro: una previsione con `fino` non cambia se dopo `fino` si aggiungono barre (tutti x3)", ok, det))

    # (c) la prova morde: tolto il vincolo `fino` (in memoria), la stessa prova (a) deve CADERE
    vero = globals()["_taglio"]
    globals()["_taglio"] = lambda noto, fino: len(noto)
    _PREP.clear()
    try:
        cade, det2 = senza_futuro()
    finally:
        globals()["_taglio"] = vero
        _PREP.clear()
    V.append(("(c) la prova (a) CADE se si toglie il vincolo `fino` (iniezione in memoria, poi ripristino)", not cade, det2))

    # (b) la soglia normalizzata: lo stesso +10% in 20 sedute su un titolo calmo e uno agitato
    U = prepara(B, {})
    calmo, agitato = U.titoli["T0"], U.titoli["T7"]
    zc = math.log(1.1) / (calmo.sig[600] * math.sqrt(20))
    za = math.log(1.1) / (agitato.sig[600] * math.sqrt(20))
    pc = prevedi("T0", A.evento_prezzo("T0", "tocca_su", calmo.c[600] * 1.1, calmo.t[600], 20), B, veicoli={})
    pa = prevedi("T7", A.evento_prezzo("T7", "tocca_su", agitato.c[600] * 1.1, agitato.t[600], 20), B, veicoli={})
    V.append(("(b) soglia normalizzata: +10% su un calmo e su un agitato cade in fasce diverse, e l'agitato ha p piu' alta",
              fascia_soglia(zc)[0] != fascia_soglia(za)[0] and pa.get("p", 0) > pc.get("p", 1),
              f"z {_n(zc, 2)} ({fascia_soglia(zc)[1]}) p {_pc(pc.get('p'))} · z {_n(za, 2)} ({fascia_soglia(za)[1]}) p {_pc(pa.get('p'))}"))

    # gli esiti in array coincidono con l'oracolo barra per barra (la semantica di evento_prezzo)
    T = U.titoli[tk]
    diversi = 0
    for t in range(250, 860, 37):
        for tipo, h, s in (("chiude_sopra", 20, T.c[t]), ("tocca_su", 20, T.c[t] * 1.1), ("tocca_giu", 20, T.c[t] * 0.9),
                           ("chiude_sopra_media", 60, None), ("tocca_su", 120, T.c[t] * 1.25)):
            e = A.evento_prezzo(tk, tipo, s, T.t[t], h, MEDIA if s is None else None)
            diversi += _esito(T, t, tipo, s, h) != _esito_scalare(T.b, t, e)
    V.append(("gli esiti in array = l'oracolo barra per barra, per i quattro tipi di evento", diversi == 0, f"{diversi} diversi"))

    # un caso al piu' ogni DISTANZA sedute per titolo
    codice = int(T.kl[600])
    vicini = 0
    for X in U.titoli.values():
        i = _dirada(np.flatnonzero(U._maschera(X, "largo", codice)))
        vicini += int((np.diff(i) < DISTANZA).sum())
    V.append(("diradamento: nessun titolo ha due casi a meno di 20 sedute", vicini == 0, f"{vicini} coppie vicine"))

    # sotto 30 casi: lo stato largo o «non disponibile»; uno storico corto non ha stato
    poco = {k: b[:330] for k, b in list(B.items())[:2]}
    r = prevedi("T0", A.evento_prezzo("T0", "chiude_sopra", poco["T0"][300]["c"], poco["T0"][300]["t"], 20), poco, veicoli={})
    V.append(("sotto 30 casi la previsione si dichiara «non disponibile», non si inventa", bool(r.get("non_disponibile"))
              and "p" not in r, r.get("non_disponibile", "")[:70]))

    # le previsioni di oggi: record validi, risolutore con dal = ultima seduta, eventi condizionati, assenze nominate
    Bo = dict(B)
    Bo["QQQ"], Bo["SMH"], Bo["NUOVO"] = B["T2"], B["T5"], B["T4"][-80:]
    ult = B["T6"][-1]["c"]
    posiz = [{"tk": "T6", "pmc": ult * 1.3, "valuta": "USD"}, {"tk": "T1", "pmc": 1.0, "valuta": "USD"},
             {"tk": "NUOVO", "pmc": 1.0, "valuta": "USD"}, {"tk": "BOND", "pmc": 100.0, "valuta": "EUR"}]
    adesso = datetime(2026, 11, 3, 23, 0, tzinfo=timezone.utc)
    pv = previsioni_oggi(Bo, posiz, adesso, veicoli={})
    carichi = [p for p in pv if p["extra"].get("carico")]
    medie = {p["soggetto"] for p in pv if p["risolutore"]["tipo"] == "chiude_sopra_media"} | {
        a["soggetto"] for a in pv.assenze if "media a 200" in a["evento"]}
    sotto = {tk for tk in ("T6", "T1", "QQQ", "SMH") if np.isfinite(prepara(Bo, {}).titoli[tk].ma[-1])
             and prepara(Bo, {}).titoli[tk].c[-1] < prepara(Bo, {}).titoli[tk].ma[-1]}
    ok = (all(p["metodo"] == METODO and p["risolutore"]["dal"] == B["T6"][-1]["t"] and 0 <= p["probabilita"] <= 1
              and p["n"] >= MIN_CASI for p in pv) and len(carichi) == 3 and all(p["soggetto"] == "T6" for p in carichi)
          and medie == sotto and {a["soggetto"] for a in pv.assenze} >= {"NUOVO", "BOND"}
          and {p["famiglia"] for p in pv if p["soggetto"] == "QQQ"} == {"mercato"})
    V.append(("previsioni di oggi: record validi, dal = ultima seduta, il carico solo per chi e' sotto, la media 200 solo "
              "per chi e' sotto, le assenze nominate", ok, f"{len(pv)} previsioni, {len(pv.assenze)} assenze"))

    # la calibrazione walk-forward: gira senza file, la base e' quella del passato, valuta per tipo e orizzonte
    cal = calibrazione(B, passo=40, veicoli={}, percorso=None, usa_cache=False)
    g = cal["valutazioni"].get("chiude_sopra|20") or {}
    V.append(("calibrazione walk-forward: una valutazione per tipo e orizzonte, con la base del solo passato",
              g.get("n", 0) > 50 and g.get("base_dichiarata", "").startswith("la base di ogni previsione")
              and "tocca_su|252" in cal["valutazioni"], f"{cal['previsioni']} previsioni, gruppi {len(cal['valutazioni'])}"))

    # la resa: virgola decimale, le assenze dette, la riga di affidabilita'
    L = resa(pv, cal)
    testo = "\n".join(L)
    import re
    V.append(("resa: virgola decimale, assenze «non disponibile», affidabilita' per fascia", bool(re.search(r"\d,\d", testo))
              and not re.search(r"\d\.\d", testo) and "non disponibile" in testo and "→" in testo
              and A.riga_affidabilita(pv[0]["probabilita"], cal["valutazioni"].get(pv[0]["extra"]["gruppo"]), METODO)
              == riga(pv[0], cal), f"{len(L)} righe"))
    dur = time.time() - t0
    V.append(("le verifiche durano meno di 60 secondi", dur < 60, f"{_n(dur, 1)} s"))
    return V


def main(argv):
    if argv and argv[0] == "oggi":
        import brief
        if "--barre" in argv:
            B = json.load(open(argv[argv.index("--barre") + 1], encoding="utf-8"))["barre"]
        else:
            nomi, _ = S.universo()
            B = S.leggi_barre(list(dict.fromkeys(nomi + list(MERCATO) + list(DIVERSIFICANTI))))
        pos, _, _ = brief.leggi_libro()
        vei = veicoli_pipeline()
        adesso = datetime.now(timezone.utc)
        cal = calibrazione(B, veicoli=vei, adesso=adesso)
        pv = previsioni_oggi(B, pos, adesso, veicoli=vei)
        print("\n".join(resa(pv, cal)))
        print(f"  (calibrazione {'riusata' if cal.get('riusata') else 'rifatta in ' + _n(cal.get('durata_s'), 1) + ' s'}: "
              f"{os.path.relpath(CACHE, RADICE)})")
        return 0
    ok = True
    for nome, esito, dettaglio in verifiche():
        print(("PASS  " if esito else "FAIL  ") + nome + (f" — {dettaglio}" if dettaglio else ""))
        ok &= bool(esito)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
