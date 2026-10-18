#!/usr/bin/env python3
"""POSIZIONAMENTO DEL MERCATO — put e call, scadenze delle opzioni, grandi operatori, bitcoin nel weekend (v496).

Uso:  python3 scripts/posizionamento.py [--no-memoria]

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il CEO, 17/10/2026: «Effettua anche analisi su put e call e sui grandi movimenti che vengono effettuati il
week end (non ricordo nome tecnico). Rendi sempre tutto strutturale». Alla domanda su quali movimenti:
«Scadenza delle opzioni, Posizioni dei grandi operatori, Bitcoin nel weekend».

Lo script SELEZIONA e CALCOLA; il giudizio lo scrive il modello (v448). Ogni lettura convenzionale del
mestiere — il rapporto put/call alto come paura, il «max pain» come calamita, il salto del future CME sul
bitcoin — si DICHIARA convenzione e non diventa una misura (v240, v487). Ogni blocco ha tre esiti — con
dati, senza dati, NON letto — perche' «nessuna voce» e «la fonte non ha risposto» si leggono uguali e
significano l'opposto (v389).

═══ LE FONTI, MISURATE PRIMA DI SCRIVERE IL CODICE (17/10/2026, da questo ambiente) ═══════════
- CBOE, statistiche giornaliere di mercato (cdn.cboe.com, un file per seduta, ~7 KB): i rapporti put/call
  PUBBLICATI dalla borsa — azioni, indici, totale, SPX, VIX — e i volumi. Una seduta senza file risponde 403
  (festivi, fine settimana, o non ancora pubblicata). I file sono immutabili: si tengono in memoria
  (memoria/cboe_putcall.jsonl) e si legge solo cio' che manca. ⚠ Il vecchio CSV storico di CBOE e' fermo al
  2019 e l'API giornaliera di www.cboe.com risponde 403: questa e' la strada che funziona.
- CBOE, catene complete delle opzioni (cdn.cboe.com → cdn-api.cboe.com, compresse: MU 5,3 MB → ~0,5 MB):
  tutte le scadenze e tutti gli strike, open interest, volumi, denaro e lettera, volatilita' implicita a 30
  giorni del sottostante. Differite di 15 minuti. ⚠ La catena della PIPELINE (Yahoo) porta solo le tre
  scadenze piu' vicine e 25 strike attorno al prezzo: la scadenza mensile e quella dei conti non ci sono.
- CFTC, Traders in Financial Futures (cftc.gov, archivio annuale ~0,6 MB): posizioni del MARTEDI',
  pubblicate il VENERDI' alle 15:30 di New York. I mercati si riconoscono dal CODICE del regolatore, non dal
  nome (i nomi cambiano: C10).
- Coinbase Exchange (candele orarie del bitcoin, senza chiave): il bitcoin scambia anche nel fine settimana.
- stockanalysis (via brief.barre): MSTR e IBIT, per la sensibilita' MISURATA del titolo al bitcoin.

═══ v499 — DARK POOL E GAMMA DEI DEALER (richiesta del CEO del 17/10/2026, sera) ═══════════════
Il CEO: «Valuta se puoi inserimento dei movimenti del darkpool», con un video che usa i livelli «GEX» (call wall,
put wall, cambio di regime della gamma) e un indice del dark pool con la sua media a 10 sedute. Misurato prima:
- FINRA, file giornaliero consolidato delle vendite allo scoperto fuori borsa (cdn.finra.org, ~0,5 MB, ogni sera,
  gratis): per ogni titolo il volume venduto allo scoperto e il volume totale riportati a FINRA. Una seduta senza
  file risponde 403 (fine settimana, festivi, o non ancora pubblicato). Memoria: memoria/dark_pool.jsonl.
- SqueezeMetrics, DIX.csv (~0,2 MB): l'indice del dark pool dell'S&P 500 ponderato in dollari (DIX) e la loro stima
  della gamma dei dealer sull'S&P 500 (GEX), una riga per seduta dal 2011.
- CBOE, le stesse catene complete di sopra: per ogni opzione l'open interest e la volatilita' implicita, da cui la
  gamma si ricalcola su una griglia di prezzi per trovare il CAMBIO DI REGIME.
⚠ Le singole operazioni fuori borsa NON sono pubbliche in tempo utile: «movimenti del dark pool» qui vuol dire il
  rapporto delle vendite allo scoperto, e la sua lettura come acquisto e' una CONVENZIONE (SqueezeMetrics), non una
  misura. Lo stesso vale per la gamma: chi detiene le opzioni non si osserva, e il segno dei dealer e' un'ipotesi.

⚠ Un'opzione su un sottostante con piu' di una radice (contratti rettificati dopo un'operazione societaria)
si tiene SOLO se la radice e' il simbolo: la classe degli strike-relitto che la pipeline filtra dal v104.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import re
import sys
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief            # noqa: E402
import numeri_libro as NL  # noqa: E402  (solo i formattatori: virgola decimale, un posto solo — v443)
import rotazione        # noqa: E402

RADICE = Path(__file__).resolve().parent.parent
NEW_YORK, ROMA = brief.NEW_YORK, brief.ROMA
CACHE_PC = RADICE / "memoria" / "cboe_putcall.jsonl"
# la storia per TITOLO non la pubblica nessuna fonte gratuita: si costruisce, una riga per seduta conclusa
CACHE_TIT = RADICE / "memoria" / "opzioni_titoli.jsonl"
MIN_STORIA = 20          # sotto 20 sedute registrate un percentile non si pubblica (convenzione)
URL_PC = "https://cdn.cboe.com/data/us/options/market_statistics/daily/{d}_daily_options"
URL_CATENA = "https://cdn.cboe.com/api/global/delayed_quotes/options/{tk}.json"
URL_COT = "https://www.cftc.gov/files/dea/history/fut_fin_txt_{a}.zip"
URL_BTC = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600"

# ⚠ Convenzioni, dichiarate (v240): nessuna di queste e' un dato del mercato.
SEDUTE_PC = 252          # la distribuzione del put/call: un anno di sedute
MEDIA_PC = 10            # un giorno solo e' rumore: si legge anche la media di 10 sedute
GIORNI_PC = 380          # giorni di calendario tenuti in memoria (un anno di sedute e un margine)
MARGINE_ASSENTE = 4      # un giorno feriale senza file, piu' vecchio di cosi', e' una borsa chiusa
ANNI_COT = 3             # tre anni di rilevazioni settimanali per la distribuzione del posizionamento
FASCIA = (0.5, 2.0)      # strike plausibili attorno al prezzo: la sanita' degli strike della pipeline (v104)
GIORNI_CONTI = 60        # i conti abbastanza vicini da cercare la scadenza che li comprende
PARALLELI = 6            # fonti gratuite: non si martellano (v399)

RATIO = {"EQUITY PUT/CALL RATIO": "azioni", "TOTAL PUT/CALL RATIO": "totale", "INDEX PUT/CALL RATIO": "indici",
         "SPX + SPXW PUT/CALL RATIO": "spx", "CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO": "vix",
         "EXCHANGE TRADED PRODUCTS PUT/CALL RATIO": "etp"}

# Il CODICE del regolatore, non il nome: "NASDAQ-100 Consolidated" oggi, un altro nome domani (C10).
MERCATI_COT = (("20974+", "Nasdaq-100 (future consolidati)"), ("13874+", "S&P 500 (future consolidati)"),
               ("1170E1", "VIX (future)"), ("133741", "Bitcoin (future CME)"), ("043602", "Treasury 10 anni (future)"))
CATEGORIE_COT = (("lev", "fondi a leva", "Lev_Money"), ("am", "gestori istituzionali", "Asset_Mgr"),
                 ("dealer", "dealer", "Dealer"))
RE_OPZ = re.compile(r"^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$")

_it, _mese = NL._it, NL._mese


def _sg(x, d=1):
    """Il formattatore col segno del libro (NL._sg, un posto solo: v443), su un valore gia' arrotondato: un
    movimento che si arrotonda a zero non porta un segno («-0,0%» si legge come un calo che non c'e')."""
    return NL._sg(None if x is None else round(x, d) + 0.0, d)


def scarica(url, timeout=30):
    """GET con l'UA del brief e la compressione: la catena di MU passa da 5,3 MB a ~0,5 MB."""
    req = urllib.request.Request(url, headers={**brief.UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dati = r.read()
        return gzip.decompress(dati) if r.headers.get("Content-Encoding") == "gzip" else dati


def oggi_ny(adesso=None):
    return (adesso or datetime.now(NEW_YORK)).astimezone(NEW_YORK).date()


def _gm(d):
    """'2026-10-16' → '16/10'."""
    return f"{d[8:10]}/{d[5:7]}" if d and len(d) >= 10 else str(d or "n.d.")


def _gma(d):
    return f"{d[8:10]}/{d[5:7]}/{d[:4]}" if d and len(d) >= 10 else str(d or "n.d.")


def _pct_rank(x, serie):
    """Un percentile solo, midrank, quello di rotazione e di dgPercentile (v161)."""
    return rotazione.percentile_midrank(x, serie)


def _rango(x):
    """Un arrotondamento solo, per eccesso sul mezzo, come Math.round (v415, v496)."""
    return None if x is None else int(math.floor(x + 0.5))


# ══════════════════════════════════════ PUT/CALL DI MERCATO (CBOE) ══════════════════════════════════════
def leggi_pc(j, d):
    """Il file CBOE di una seduta → una riga di memoria. I rapporti sono quelli PUBBLICATI dalla borsa, a due
    decimali: ricalcolarli dai volumi darebbe una seconda resa della stessa grandezza (v415)."""
    r = {"data": d}
    for x in (j or {}).get("ratios") or []:
        k = RATIO.get(str(x.get("name", "")).strip().upper())
        if k:
            try:
                r[k] = float(x["value"])
            except (KeyError, TypeError, ValueError):
                pass
    vol = {v.get("name"): v for v in ((j or {}).get("EQUITY OPTIONS") or [])}.get("VOLUME") or {}
    if vol.get("put") is not None and vol.get("call") is not None:
        r["azioni_put"], r["azioni_call"] = vol["put"], vol["call"]
    return r


def leggi_memoria_pc(p=CACHE_PC):
    out = {}
    try:
        testo = Path(p).read_text(encoding="utf-8")
    except OSError:
        return out
    for riga in testo.splitlines():
        try:
            r = json.loads(riga)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("data"):
            out[r["data"]] = r
    return out


def scrivi_memoria_pc(righe, p=CACHE_PC):
    Path(p).write_text("".join(json.dumps(righe[d], ensure_ascii=False, sort_keys=True) + "\n" for d in sorted(righe)),
                       encoding="utf-8")


def giorni_mancanti(oggi, memoria, giorni=GIORNI_PC):
    """I giorni feriali della finestra che la memoria non ha (ne' come seduta ne' come assenza). Oggi compreso:
    se la borsa non ha ancora pubblicato, risponde 403 e non si registra niente."""
    return [g.isoformat() for g in (oggi - timedelta(days=k) for k in range(giorni))
            if g.weekday() < 5 and g.isoformat() not in memoria]


def aggiorna_pc(oggi, memoria, leggi=scarica, paralleli=PARALLELI):
    """Legge le sedute mancanti. Un 403/404 su un giorno vecchio di oltre MARGINE_ASSENTE giorni e' una borsa
    chiusa e si registra (cosi' non si chiede di nuovo); su un giorno recente e' un file non ancora pubblicato e
    non si registra. Un errore di rete non e' un'assenza: si conta fra le NON lette (v389)."""
    mancanti = giorni_mancanti(oggi, memoria)

    def uno(d):
        try:
            return d, leggi_pc(json.loads(leggi(URL_PC.format(d=d))), d), None
        except urllib.error.HTTPError as e:
            return d, None, e.code
        except Exception as e:  # noqa: BLE001
            return d, None, type(e).__name__

    nuove, assenti, non_lette, attese = 0, 0, [], []
    with ThreadPoolExecutor(paralleli) as ex:
        for d, r, err in ex.map(uno, mancanti):
            if r is not None:
                memoria[d] = r
                nuove += 1
            elif err in (403, 404):
                if (oggi - date.fromisoformat(d)).days > MARGINE_ASSENTE:
                    memoria[d] = {"data": d, "assente": err}
                    assenti += 1
                else:
                    attese.append(d)
            else:
                non_lette.append(d)
    return {"nuove": nuove, "assenti": assenti, "non_lette": non_lette, "non_ancora_pubblicate": attese}


def medie_semplici(valori, m=MEDIA_PC):
    """La media di m sedute, per ogni seduta da m in poi. Una funzione sola: la usano il put/call pubblicato e la
    misura del suo valore predittivo (misura_segnali_mercato.py, v500) — due medie scritte due volte divergono."""
    return [sum(valori[i - m + 1:i + 1]) / m for i in range(m - 1, len(valori))]


def stato_pc(memoria, n=SEDUTE_PC, m=MEDIA_PC):
    righe = [memoria[d] for d in sorted(memoria) if memoria[d].get("azioni") is not None][-n:]
    if not righe:
        return None
    az = [r["azioni"] for r in righe]
    medie = medie_semplici(az, m)
    ult = righe[-1]
    tot = [r["totale"] for r in righe if r.get("totale") is not None]
    return {"ultima": ult, "n": len(righe), "dal": righe[0]["data"],
            "rango": _rango(_pct_rank(ult["azioni"], az)),
            "media": medie[-1] if medie else None,
            "rango_media": _rango(_pct_rank(medie[-1], medie)) if medie else None, "n_medie": len(medie),
            "minimo": min(righe, key=lambda r: r["azioni"]), "massimo": max(righe, key=lambda r: r["azioni"]),
            "rango_totale": _rango(_pct_rank(ult.get("totale"), tot)) if ult.get("totale") is not None else None}


def righe_pc(st, agg):
    L = ["PUT/CALL DI MERCATO — CBOE, rapporti pubblicati dalla borsa (contratti put / contratti call scambiati)"]
    if agg.get("non_lette"):
        L.append(f"  ⚠ {len(agg['non_lette'])} sedute NON lette (errore di rete): la distribuzione ne ha di meno — "
                 f"{', '.join(_gm(d) for d in agg['non_lette'][:6])}{' …' if len(agg['non_lette']) > 6 else ''}")
    if st is None:
        L.append("  NON DISPONIBILE: nessuna seduta letta (la memoria e' vuota e la fonte non ha risposto)")
        return L
    u = st["ultima"]
    L.append(f"  seduta del {_gma(u['data'])} · azioni (opzioni su singoli titoli) {_it(u['azioni'])} — "
             f"{st['rango']}° percentile delle {st['n']} sedute dal {_gma(st['dal'])}"
             + (f" · media di {MEDIA_PC} sedute {_it(st['media'])} ({st['rango_media']}° percentile delle "
                f"{st['n_medie']} medie)" if st.get("media") is not None else ""))
    altri = " · ".join(f"{nome} {_it(u[k])}" for k, nome in (("totale", "totale"), ("indici", "indici"),
                                                              ("spx", "SPX"), ("vix", "VIX")) if u.get(k) is not None)
    if altri:
        L.append(f"  {altri}" + (f" (totale al {st['rango_totale']}° percentile)" if st.get("rango_totale") is not None else ""))
    if u.get("azioni_put") is not None:
        L.append(f"  volumi sulle azioni: {_it(u['azioni_put'], 0)} put contro {_it(u['azioni_call'], 0)} call")
    L.append(f"  nell'anno: minimo {_it(st['minimo']['azioni'])} il {_gma(st['minimo']['data'])} · massimo "
             f"{_it(st['massimo']['azioni'])} il {_gma(st['massimo']['data'])}")
    L.append("  lettura convenzionale del mestiere, non una misura: un rapporto ALTO e' domanda di protezione (paura), "
             "uno BASSO e' domanda di rialzo (compiacenza); agli estremi della propria distribuzione la lettura "
             "«contraria» (troppa paura = vicino a un minimo) e' una convenzione, e un giorno solo e' rumore")
    if agg.get("non_ancora_pubblicate"):
        L.append(f"  non ancora pubblicate dalla borsa: {', '.join(_gm(d) for d in agg['non_ancora_pubblicate'])}")
    return L


# ══════════════════════════════════════ CATENE DELLE OPZIONI (CBOE) ══════════════════════════════════════
def contratti(j, tk):
    """[{scad, tipo, strike, oi, vol, bid, ask, ultimo}] dalla catena CBOE, SOLO la radice del simbolo."""
    radice = tk.replace(".", "").replace("-", "")
    out = []
    for o in ((j or {}).get("data") or {}).get("options") or []:
        m = RE_OPZ.match(str(o.get("option", "")))
        if not m or m.group(1) != radice:
            continue
        out.append({"scad": f"20{m.group(2)}-{m.group(3)}-{m.group(4)}", "tipo": m.group(5),
                    "strike": int(m.group(6)) / 1000, "oi": o.get("open_interest") or 0, "vol": o.get("volume") or 0,
                    "bid": o.get("bid"), "ask": o.get("ask"), "ultimo": o.get("last_trade_price"),
                    "iv": o.get("iv")})                                     # v499 — per la gamma dei dealer
    return out


def _mid(x):
    b, a = x.get("bid"), x.get("ask")
    return (b + a) / 2 if (b or 0) > 0 and (a or 0) > 0 else None


def _round2_js(x):
    """Math.round(x * 100) / 100, come in app.js: lo stesso numero nelle due lingue (v415)."""
    return math.floor(x * 100 + 0.5) / 100


def movimento_implicito(contr, spot, scad):
    """⚠ LA STESSA DEFINIZIONE di movimentoImplicito in assets/app.js — un gate le confronta sulla stessa catena
    (v161: due implementazioni della stessa formula divergono al primo ritocco). Lo strike comune a call e put piu'
    vicino al prezzo (a parita' di distanza il piu' basso), il prezzo medio denaro/lettera di ciascuna (entrambi
    sopra zero), lo straddle diviso il prezzo; e il massimo open interest DENTRO il movimento implicito, per lato."""
    if not spot or spot <= 0:
        return None
    call = {c["strike"]: c for c in sorted(contr, key=lambda c: c["strike"]) if c["scad"] == scad and c["tipo"] == "C"}
    put = {c["strike"]: c for c in sorted(contr, key=lambda c: c["strike"]) if c["scad"] == scad and c["tipo"] == "P"}
    comuni = sorted((k for k in call if k in put), key=lambda k: abs(k - spot))
    if not comuni:
        return None
    K = comuni[0]
    c, p = _mid(call[K]), _mid(put[K])
    if c is None or p is None:
        return None
    strad = c + p
    pct = strad / spot * 100

    def dentro(m):
        ok = [(k, v) for k, v in m.items() if abs(k / spot - 1) * 100 <= pct]
        return max(ok, key=lambda kv: kv[1]["oi"] or 0) if ok else None

    pv, cv = dentro(put), dentro(call)
    return {"data": scad, "strike": K, "straddle": _round2_js(strad), "pct": _round2_js(pct),
            "put_vicino": {"strike": pv[0], "oi": pv[1]["oi"] or 0} if pv else None,
            "call_vicino": {"strike": cv[0], "oi": cv[1]["oi"] or 0} if cv else None}


def terzo_venerdi(anno, mese):
    d = date(anno, mese, 1)
    return d + timedelta(days=(4 - d.weekday()) % 7 + 14)


def scadenze_mensili(scadenze, oggi):
    """Le scadenze MENSILI fra quelle LISTATE dalla fonte: il terzo venerdi', o il giovedi' prima se il venerdi'
    non e' listato (borsa chiusa: Venerdi' Santo). Nessuna data si proietta: una scadenza che la fonte non lista
    non c'e' (v396). Trimestrale = marzo, giugno, settembre, dicembre — le «tre streghe»."""
    lista = sorted(set(scadenze))
    out = []
    for s in lista:
        d = date.fromisoformat(s)
        if d < oggi:
            continue
        tv = terzo_venerdi(d.year, d.month)
        if d == tv or (d == tv - timedelta(days=1) and tv.isoformat() not in lista):
            out.append({"data": s, "trimestrale": d.month in (3, 6, 9, 12), "giorni": (d - oggi).days})
    return out


def max_pain(contr, scad, spot):
    """Lo strike, fra quelli plausibili (FASCIA del prezzo), a cui il valore intrinseco di tutte le opzioni in
    scadenza sarebbe minimo. Che il prezzo vi gravi verso la scadenza e' una CONVENZIONE di lettura, non una
    misura (v240): si pubblica come tale."""
    c = [x for x in contr if x["scad"] == scad]
    cand = sorted({x["strike"] for x in c if FASCIA[0] * spot <= x["strike"] <= FASCIA[1] * spot})
    if not cand or not any(x["oi"] for x in c):
        return None

    def valore(K):
        return sum((x["oi"] or 0) * max(0.0, (K - x["strike"]) if x["tipo"] == "C" else (x["strike"] - K)) for x in c)

    return min(cand, key=valore)


def scadenza_dei_conti(scadenze, conti, oggi):
    """La prima scadenza listata che COMPRENDE i conti: lo stesso giorno se escono prima dell'apertura, la
    successiva altrimenti (dopo la chiusura, o ora non dichiarata: il verso prudente)."""
    if not conti or not conti.get("data"):
        return None
    prima = str(conti.get("quando") or "") == "time-pre-market"
    for s in sorted(set(scadenze)):
        if s < oggi.isoformat():
            continue
        if s > conti["data"] or (prima and s == conti["data"]):
            return s
    return None


def piu_scambiati(contr, spot, seduta):
    """Per lato, il contratto FUORI DAL DENARO (call sopra il prezzo, put sotto) con piu' contratti scambiati
    nella seduta, ESCLUSA la scadenza della seduta stessa: quella e' scambio del giorno, non posizionamento
    (convenzione dichiarata). In CONTRATTI, non in premio: il premio pagato non e' nei dati — moltiplicare il
    volume per un prezzo di fine giornata metteva in cima i contratti profondamente nel denaro (prima stesura:
    MSTR call 45 con il titolo a 137, «60 milioni»). E il VERSO, comprato o venduto, non e' nei dati."""
    out = {}
    for tipo in ("C", "P"):
        fuori = [x for x in contr if x["tipo"] == tipo and (x["vol"] or 0) > 0 and x["scad"] != seduta
                 and (x["strike"] > spot if tipo == "C" else x["strike"] < spot)]
        if fuori:
            out[tipo] = max(sorted(fuori, key=lambda x: (x["scad"], x["strike"])), key=lambda x: x["vol"] or 0)
    return out


def riepilogo(j, tk, oggi, conti=None, in_seduta=False):
    """Tutto quello che la risposta legge di un titolo dalla sua catena."""
    d = (j or {}).get("data") or {}
    contr = contratti(j, tk)
    if not contr:
        return None
    spot = d.get("current_price") if in_seduta else (d.get("close") or d.get("current_price"))
    if not spot:
        return None
    o = oggi.isoformat()
    vive = [c for c in contr if c["scad"] >= o]
    scad = sorted({c["scad"] for c in vive})
    somma = lambda xs, k, t: sum((x[k] or 0) for x in xs if x["tipo"] == t)  # noqa: E731
    vc, vp = somma(contr, "vol", "C"), somma(contr, "vol", "P")
    oc, op = somma(vive, "oi", "C"), somma(vive, "oi", "P")
    mens = scadenze_mensili(scad, oggi)
    m1 = mens[0] if mens else None
    alla = None
    if m1:
        cm = [c for c in vive if c["scad"] == m1["data"]]
        oi_m = sum(c["oi"] or 0 for c in cm)
        alla = {**m1, "quota_oi": oi_m / (oc + op) * 100 if (oc + op) else None,
                "pc_oi": (somma(cm, "oi", "P") / somma(cm, "oi", "C")) if somma(cm, "oi", "C") else None,
                "max_pain": max_pain(vive, m1["data"], spot),
                "movimento": movimento_implicito(vive, spot, m1["data"])}
    prima = scad[0] if scad else None
    sc = scadenza_dei_conti(scad, conti, oggi)
    seduta = str(d.get("last_trade_time") or "")[:10] or None
    # le scadenze gia' passate che l'istantanea porta ancora: se fra queste c'e' una mensile, e' appena scaduta
    passate = sorted({c["scad"] for c in contr if c["scad"] < o})
    ultima_mensile = next((s for s in reversed(passate)
                           if date.fromisoformat(s) in (terzo_venerdi(int(s[:4]), int(s[5:7])),
                                                        terzo_venerdi(int(s[:4]), int(s[5:7])) - timedelta(days=1))), None)
    return {"tk": tk, "spot": spot, "chiusura": d.get("close"), "seduta": seduta,
            # ⚠ la variazione della volatilita' implicita NON si pubblica: il 17/10 valeva esattamente 0,0 su tre
            #   catene su undici (AMD, BE, CRWV) — un campo che la fonte non aggiorna si legge come «ferma» (v396)
            "iv30": d.get("iv30"),
            "pc_vol": vp / vc if vc else None, "vol_put": vp, "vol_call": vc,
            "pc_oi": op / oc if oc else None, "oi_put": op, "oi_call": oc,
            "prima_scadenza": movimento_implicito(vive, spot, prima) if prima else None,
            "mensile": alla, "conti": conti, "scadenza_conti": sc,
            "distacco_conti": ((date.fromisoformat(sc) - date.fromisoformat(conti["data"])).days if sc and conti else None),
            "movimento_conti": movimento_implicito(vive, spot, sc) if sc else None,
            "scambiati": piu_scambiati(contr, spot, seduta), "scadenze": scad, "mensile_scaduta": ultima_mensile}


def _strike(x):
    return _it(x, 0) if x is not None and float(x).is_integer() else _it(x, 2)


def _mov(m, etichetta):
    if not m:
        return f"{etichetta}: n.d. (libro vuoto o nessuno strike comune a call e put)"
    return f"{etichetta} ±{_it(m['pct'], 1)}% (straddle {_strike(m['strike'])} a {_it(m['straddle'], 2)} $)"


def righe_scadenze(ind, oggi):
    """Le scadenze del mercato, dalla catena di SPY (le date le lista la borsa)."""
    L = ["SCADENZE DELLE OPZIONI — le date che la borsa LISTA (catene CBOE); mensile = terzo venerdi', "
         "trimestrale («tre streghe») = marzo, giugno, settembre, dicembre"]
    spy = ind.get("SPY")
    if not spy:
        L.append("  NON DISPONIBILE: la catena di SPY non e' stata letta — le date delle scadenze non si proiettano (v396)")
        return L
    mens = scadenze_mensili(spy["scadenze"], oggi)
    if not mens:
        L.append("  nessuna scadenza mensile fra quelle listate per SPY")
        return L
    m1 = mens[0]
    tri = next((m for m in mens if m["trimestrale"]), None)
    if spy.get("mensile_scaduta"):
        L.append(f"  la mensile del {_gma(spy['mensile_scaduta'])} e' SCADUTA: l'istantanea della borsa la porta ancora, "
                 "e le coperture legate a quella scadenza sono chiuse")
    quando = "OGGI" if m1["giorni"] == 0 else ("DOMANI" if m1["giorni"] == 1 else f"fra {m1['giorni']} giorni")
    L.append(f"  prossima mensile: {_gma(m1['data'])} ({quando})" + (" — TRIMESTRALE, «tre streghe»" if m1["trimestrale"] else "")
             + (f" · prossima trimestrale: {_gma(tri['data'])} (fra {tri['giorni']} giorni)" if tri and tri is not m1 else ""))
    if m1["giorni"] <= 5:
        L.append("  ⚠ settimana di scadenza: alla scadenza le coperture legate alle opzioni si chiudono, e da quel giorno il "
                 "prezzo puo' muoversi piu' liberamente — e' una convenzione del mestiere, non una misura")
    for tk in ("SPY", "QQQ"):
        r = ind.get(tk)
        if not r or not r.get("mensile"):
            L.append(f"  {tk}: catena non letta o mensile assente")
            continue
        a = r["mensile"]
        L.append(f"  {tk} (chiusura {_it(r['spot'], 2)}): alla mensile scade il {_it(a['quota_oi'], 0)}% dell'open interest di "
                 f"tutte le scadenze · put/call sull'open interest di quella scadenza {_it(a['pc_oi'])} · max pain "
                 f"{_strike(a['max_pain'])} ({_sg((a['max_pain'] / r['spot'] - 1) * 100)}% dal prezzo) · "
                 + _mov(a.get("movimento"), "movimento implicito"))
    L.append("  «max pain»: lo strike a cui il valore delle opzioni in scadenza sarebbe minimo — che il prezzo vi gravi e' "
             "una convenzione di lettura, non una misura")
    return L


def righe_opzioni(rie, pos_qta, storia=None):
    sedute = sorted({r["seduta"] for r in rie.values() if r and r.get("seduta")})
    L = ["OPZIONI SULLE POSIZIONI — catene complete CBOE (differite di 15 minuti): volumi della seduta del "
         + (", ".join(_gma(s) for s in sedute) if sedute else "n.d.")
         + " (a borsa aperta: della seduta in corso, fin li'), open interest d'inizio seduta"]
    for tk in sorted(pos_qta):
        r = rie.get(tk)
        if r is None:
            L.append(f"  {tk}: catena NON letta o senza contratti — nessuna lettura delle opzioni")
            continue
        iv = f" · volatilita' implicita a 30 giorni {_it(r['iv30'], 1)}%" if r.get("iv30") else ""
        L.append(f"  {tk} — prezzo {_it(r['spot'], 2)}{iv}")
        st = (storia or {}).get(tk)
        if st:
            L.append("    " + st)
        L.append(f"    put/call: volumi {_it(r['pc_vol'])} ({_it(r['vol_put'], 0)} put / {_it(r['vol_call'], 0)} call) · "
                 f"open interest {_it(r['pc_oi'])} ({_it(r['oi_put'], 0)} / {_it(r['oi_call'], 0)})"
                 if r.get("pc_vol") is not None and r.get("pc_oi") is not None else "    put/call: n.d. (nessun volume o open interest)")
        pezzi = [_mov(r.get("prima_scadenza"), f"alla prima scadenza ({_gm(r['prima_scadenza']['data'])})"
                      if r.get("prima_scadenza") else "alla prima scadenza")]
        a = r.get("mensile")
        if a:
            pezzi.append(_mov(a.get("movimento"), f"alla mensile del {_gm(a['data'])}"))
        if r.get("conti"):
            c = r["conti"]
            if r.get("movimento_conti"):
                dist = r.get("distacco_conti")
                pezzi.append(_mov(r["movimento_conti"], f"fino alla scadenza che comprende i conti del {_gm(c['data'])} "
                                                         f"({_gm(r['scadenza_conti'])})")
                             + (f" — la scadenza listata piu' vicina cade {dist} giorni dopo i conti: il movimento comprende "
                                "anche quei giorni" if dist is not None and dist > 7 else ""))
            else:
                pezzi.append(f"conti del {_gm(c['data'])}: nessuna scadenza listata che li comprenda, o libro vuoto")
        L.append("    movimento implicito: " + " · ".join(pezzi))
        if a:
            mv = a.get("movimento") or {}
            conc = []
            if mv.get("call_vicino"):
                conc.append(f"call {_strike(mv['call_vicino']['strike'])} ({_it(mv['call_vicino']['oi'], 0)} contratti)")
            if mv.get("put_vicino"):
                conc.append(f"put {_strike(mv['put_vicino']['strike'])} ({_it(mv['put_vicino']['oi'], 0)})")
            L.append(f"    alla mensile: scade il {_it(a['quota_oi'], 0)}% dell'open interest · put/call sull'open interest "
                     f"{_it(a['pc_oi'])} · max pain {_strike(a['max_pain'])}"
                     + (f" ({_sg((a['max_pain'] / r['spot'] - 1) * 100)}%)" if a.get("max_pain") else "")
                     + (" · massimo open interest dentro il movimento implicito: " + ", ".join(conc) if conc else ""))
        if r.get("scambiati"):
            parti = []
            for tipo, nome in (("C", "call"), ("P", "put")):
                x = r["scambiati"].get(tipo)
                if not x:
                    continue
                nuovo = " → oltre l'open interest d'inizio seduta: probabilmente posizioni NUOVE" if x["vol"] > (x["oi"] or 0) else ""
                parti.append(f"{nome} {_strike(x['strike'])} {_gm(x['scad'])}: {_it(x['vol'], 0)} contratti "
                             f"(open interest {_it(x['oi'], 0)}){nuovo}")
            if parti:
                L.append("    piu' scambiate fuori dal denaro, esclusa la scadenza del giorno (il verso, comprate o vendute, "
                         "non e' nei dati): " + " · ".join(parti))
    L.append("  movimento implicito = prezzo dello straddle sullo strike piu' vicino diviso il prezzo: l'ampiezza che il "
             "mercato paga, NON il verso e non una previsione (convenzione del mestiere, la stessa del pacchetto della pagina)")
    return L


# ══════════════════════════════════ LA STORIA DELLE OPZIONI PER TITOLO ══════════════════════════════════
def leggi_memoria_titoli(p=CACHE_TIT):
    out = []
    try:
        testo = Path(p).read_text(encoding="utf-8")
    except OSError:
        return out
    for riga in testo.splitlines():
        try:
            r = json.loads(riga)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("data") and r.get("tk"):
            out.append(r)
    return out


def scrivi_memoria_titoli(righe, p=CACHE_TIT):
    Path(p).write_text("".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n"
                               for r in sorted(righe, key=lambda r: (r["data"], r["tk"]))), encoding="utf-8")


def registra_titoli(rie, memoria, fase, adesso, gex=None):
    """Una riga per titolo e per seduta CONCLUSA: put/call dei volumi e dell'open interest, volatilita' implicita.
    v500 — e la NOSTRA gamma dei dealer (netta, cambio di regime, il prezzo su cui e' calcolata): nessuna fonte
    gratuita ne pubblica la storia, e senza raccoglierla «la si misura quando lo storico lo permette» (decisione
    del CEO del 18/10/2026) sarebbe una promessa senza un modo di mantenerla.
    Solo a borsa chiusa (weekend) o dalle 16:30 di New York (i dati sono differiti di 15 minuti): in seduta i
    volumi sono parziali, e prima dell'apertura l'istantanea puo' gia' portare la data di oggi sui volumi di ieri.
    La seduta e' quella che l'istantanea dichiara (ultimo scambio del sottostante)."""
    ny = adesso.astimezone(NEW_YORK)
    if fase not in ("after-hours", "chiuso") or (fase == "after-hours" and ny.hour * 60 + ny.minute < 16 * 60 + 30):
        return 0
    presenti = {(r["data"], r["tk"]) for r in memoria}
    nuove = 0
    for tk, r in sorted(rie.items()):
        if not r or not r.get("seduta") or r.get("pc_vol") is None or r.get("pc_oi") is None:
            continue
        if (r["seduta"], tk) in presenti:
            continue
        riga = {"data": r["seduta"], "tk": tk, "pc_vol": round(r["pc_vol"], 4),
                "pc_oi": round(r["pc_oi"], 4), "iv30": r.get("iv30")}
        g = (gex or {}).get(tk)
        if g and g.get("netta") is not None and g.get("spot"):
            riga.update({"gex_netta": round(g["netta"]), "gex_spot": round(g["spot"], 4),
                         "gex_flip": None if g.get("flip") is None else round(g["flip"], 4)})
        memoria.append(riga)
        nuove += 1
    return nuove


def storia_titolo(memoria, tk, n=SEDUTE_PC, minimo=MIN_STORIA):
    """Il percentile dell'ultima seduta registrata fra le sedute registrate del titolo. Sotto `minimo` sedute non
    c'e' una distribuzione: si dice quante ce ne sono, e da quante il percentile si pubblica (v406)."""
    rr = sorted((r for r in memoria if r["tk"] == tk), key=lambda r: r["data"])[-n:]
    if len(rr) < minimo:
        return (f"storia delle opzioni in costruzione: {NL._conta(len(rr), 'seduta registrata', 'sedute registrate')}, "
                f"i percentili si pubblicano da {minimo} (nessuna fonte gratuita la pubblica per titolo)")
    u = rr[-1]
    pz = []
    for k, nome in (("pc_vol", "put/call dei volumi"), ("pc_oi", "put/call dell'open interest"),
                    ("iv30", "volatilita' implicita")):
        serie = [r[k] for r in rr if r.get(k) is not None]
        if u.get(k) is not None and len(serie) >= minimo:
            pz.append(f"{nome} al {_rango(_pct_rank(u[k], serie))}° percentile")
    return f"sulle {len(rr)} sedute registrate (dal {_gma(rr[0]['data'])}, ultima {_gma(u['data'])}): " + " · ".join(pz)


# ══════════════════════════════════════ GRANDI OPERATORI (CFTC) ══════════════════════════════════════
def _int(x):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return None


def cot_righe(testo):
    """Le righe del rapporto TFF che servono, coi netti per categoria. Una riga illeggibile si salta."""
    out = []
    codici = {c for c, _ in MERCATI_COT}
    for x in csv.DictReader(io.StringIO(testo)):
        cod = str(x.get("CFTC_Contract_Market_Code") or "").strip()
        if cod not in codici:
            continue
        r = {"codice": cod, "nome": str(x.get("Market_and_Exchange_Names") or "").strip(),
             "data": str(x.get("Report_Date_as_YYYY-MM-DD") or "").strip()[:10], "oi": _int(x.get("Open_Interest_All"))}
        for k, _, col in CATEGORIE_COT:
            lo, sh = _int(x.get(f"{col}_Positions_Long_All")), _int(x.get(f"{col}_Positions_Short_All"))
            r[k] = (lo - sh) if lo is not None and sh is not None else None
        if r["oi"] and r["data"]:
            out.append(r)
    return out


def cot_stato(righe, anni=ANNI_COT):
    """Per mercato: l'ultima rilevazione, quella prima (per DATA), il netto in % dell'open interest e il suo
    percentile sugli ultimi `anni` anni di rilevazioni settimanali."""
    out = {}
    for cod, nome in MERCATI_COT:
        serie = sorted({r["data"]: r for r in righe if r["codice"] == cod}.values(), key=lambda r: r["data"])
        if not serie:
            out[cod] = {"nome": nome, "assente": True}
            continue
        ult = serie[-1]
        limite = (date.fromisoformat(ult["data"]) - timedelta(days=365 * anni)).isoformat()
        fin = [r for r in serie if r["data"] > limite]
        prec = serie[-2] if len(serie) >= 2 else None
        cat = {}
        for k, _, _ in CATEGORIE_COT:
            if ult.get(k) is None:
                continue
            pct = ult[k] / ult["oi"] * 100
            storia = [r[k] / r["oi"] * 100 for r in fin if r.get(k) is not None and r["oi"]]
            cat[k] = {"netto": ult[k], "pct": pct,
                      "var_pct": (pct - prec[k] / prec["oi"] * 100) if prec and prec.get(k) is not None and prec["oi"] else None,
                      "rango": _rango(_pct_rank(pct, storia)), "n": len(storia)}
        out[cod] = {"nome": nome, "data": ult["data"], "precedente": prec["data"] if prec else None,
                    "oi": ult["oi"], "categorie": cat, "dal": fin[0]["data"] if fin else None}
    return out


def righe_cot(st, errori):
    L = ["GRANDI OPERATORI — CFTC, Traders in Financial Futures: posizioni nette (lunghe meno corte) in % dell'open interest"]
    if errori:
        L.append(f"  ⚠ archivi NON letti: {', '.join(errori)} — la distribuzione e' piu' corta, o assente")
    if not st:
        L.append("  NON DISPONIBILE: il rapporto non e' stato letto")
        return L
    date_ = sorted({v["data"] for v in st.values() if v.get("data")})
    d = date_[-1] if date_ else None
    if d:
        pub = date.fromisoformat(d) + timedelta(days=3)
        ora = datetime(pub.year, pub.month, pub.day, 15, 30, tzinfo=NEW_YORK).astimezone(ROMA)
        L.append(f"  posizioni del martedi' {_gma(d)}, pubblicate di regola il venerdi' {_gma(pub.isoformat())} alle 15:30 "
                 f"di New York ({ora:%H:%M} italiane): e' la fotografia di quattro giorni prima, non di oggi · fra "
                 "parentesi la variazione sulla settimana e il percentile del netto nella distribuzione")
    for cod, _ in MERCATI_COT:
        v = st.get(cod) or {}
        if v.get("assente"):
            L.append(f"  {v.get('nome', cod)}: codice {cod} NON trovato nel rapporto — il mercato potrebbe aver cambiato codice")
            continue
        parti, n = [], None
        for k, etichetta, _ in CATEGORIE_COT:
            c = v["categorie"].get(k)
            if not c:
                continue
            n = c.get("n")
            dentro = [x for x in ((f"{_sg(c['var_pct'])} punti" if c.get("var_pct") is not None else None),
                                  (f"{c['rango']}° percentile" if c.get("rango") is not None else None)) if x]
            parti.append(f"{etichetta} {_sg(c['pct'])}%" + (f" ({'; '.join(dentro)})" if dentro else ""))
        L.append(f"  {v['nome']}" + (f" — rilevazione del {_gm(v['data'])}, piu' vecchia delle altre" if d and v["data"] != d else "")
                 + ": " + " · ".join(parti) + (f" [{n} settimane dal {_gma(v['dal'])}]" if n else ""))
    L.append("  chi e' chi: fondi a leva = hedge fund e strategie sistematiche, direzionali e veloci · gestori istituzionali = "
             "fondi pensione e comuni, lunghi per mestiere · dealer = le banche dall'altro lato degli scambi")
    L.append("  percentile: dove sta il netto di oggi fra quelli delle settimane della distribuzione — 0 = il piu' corto "
             "(o il meno lungo), 100 = il piu' lungo (o il meno corto): un corto al 100° percentile e' il MENO corto")
    L.append("  ⚠ su Treasury e bitcoin il corto dei fondi a leva e' in buona parte l'operazione sulla BASE (lunghi sul "
             "titolo o sull'ETF, corti sul future, per incassare la differenza): non e' una scommessa al ribasso — "
             "convenzione del mestiere, il rapporto non distingue le due cose")
    L.append("  lettura convenzionale, non una misura: un netto ESTREMO dei fondi a leva (nella coda della propria "
             "distribuzione) e' una posizione affollata che puo' girarsi in fretta — un corto estremo e' carburante per le "
             "ricoperture; sul VIX un netto corto e' una scommessa sulla calma")
    return L


# ══════════════════════════════════════ BITCOIN DALL'ULTIMA CHIUSURA USA ══════════════════════════════════════
def candele_btc(j):
    """Coinbase: [tempo, minimo, massimo, apertura, chiusura, volume], il piu' recente per primo → in ordine."""
    out = []
    for c in j or []:
        try:
            out.append({"t": int(c[0]), "chiusura": float(c[4])})
        except (TypeError, ValueError, IndexError):
            continue
    return sorted(out, key=lambda c: c["t"])


def prezzo_alle(candele, quando):
    """La chiusura della candela oraria che FINISCE a `quando` (datetime con fuso). None se manca: un buco,
    non la candela vicina (v207)."""
    t = int(quando.timestamp()) - 3600
    return next((c["chiusura"] for c in candele if c["t"] == t), None)


def ultima_chiusura_usa(barre, adesso=None):
    """La data dell'ultima seduta USA CONCLUSA e l'istante della sua campana (16:00 di New York, col fuso: v470)."""
    if not barre:
        return None
    b = barre[:-1] if rotazione.seduta_in_corso(barre, adesso) else barre
    if not b:
        return None
    g = date.fromisoformat(b[-1]["t"])
    return g, datetime(g.year, g.month, g.day, 16, 0, tzinfo=NEW_YORK)


def bitcoin(candele, barre_mstr, barre_ibit, qta_mstr, adesso=None):
    adesso = adesso or datetime.now(NEW_YORK)
    uc = ultima_chiusura_usa(barre_mstr, adesso)
    if not candele or not uc:
        return None
    g, campana = uc
    ora = candele[-1]
    p0 = prezzo_alle(candele, campana)
    # l'ultima candela e' quella in corso: il suo prezzo e' di adesso, e la sua fine sta nel futuro
    out = {"seduta": g.isoformat(), "campana": campana, "adesso": ora["chiusura"],
           "ora": min(datetime.fromtimestamp(ora["t"] + 3600, timezone.utc), adesso.astimezone(timezone.utc)),
           "alla_campana": p0,
           "var": (ora["chiusura"] / p0 - 1) * 100 if p0 else None, "venerdi": g.weekday() == 4}
    if out["venerdi"]:
        cme = prezzo_alle(candele, campana + timedelta(hours=1))
        out["cme"] = cme
        out["var_cme"] = (ora["chiusura"] / cme - 1) * 100 if cme else None
    bm = barre_mstr[:-1] if rotazione.seduta_in_corso(barre_mstr, adesso) else barre_mstr
    bi = barre_ibit[:-1] if rotazione.seduta_in_corso(barre_ibit or [], adesso) else (barre_ibit or [])
    beta, r2, n = rotazione.beta_mercato(rotazione.rendimenti_per_data(bm), rotazione.rendimenti_per_data(bi))
    out.update({"beta": beta, "r2": r2, "n": n, "mstr": (bm[-1].get("c") if bm else None), "qta": qta_mstr})
    if beta is not None and out["var"] is not None and out["mstr"]:
        out["mstr_equivalente"] = beta * out["var"]
        out["dollari"] = out["mstr_equivalente"] / 100 * out["mstr"] * (qta_mstr or 0)
    return out


def righe_btc(b, errore=None):
    L = ["BITCOIN DALL'ULTIMA CHIUSURA USA — il bitcoin scambia anche di notte e nel fine settimana; MSTR riapre sul "
         "prezzo di adesso"]
    if errore or not b:
        L.append(f"  NON DISPONIBILE: {errore or 'candele o barre assenti'}")
        return L
    ita = b["campana"].astimezone(ROMA)
    ora_ita = b["ora"].astimezone(ROMA)
    giorno = ("venerdi'" if b["venerdi"] else "")
    L.append(f"  chiusura USA di {giorno} {_gma(b['seduta'])} (16:00 di New York = {ita:%H:%M} italiane): "
             + (f"BTC {_it(b['alla_campana'], 0)} $" if b.get("alla_campana") else "BTC n.d. (candela mancante)")
             + f" · adesso ({ora_ita:%d/%m %H:%M} italiane) {_it(b['adesso'], 0)} $"
             + (f" → {_sg(b['var'])}%" if b.get("var") is not None else ""))
    if b["venerdi"]:
        L.append(f"  livello delle 17:00 di New York di venerdi' (chiusura del future CME sul bitcoin, approssimata con lo "
                 f"spot): {_it(b['cme'], 0) if b.get('cme') else 'n.d.'} $"
                 + (f" → {_sg(b['var_cme'])}% da li'" if b.get("var_cme") is not None else "")
                 + " — il future riapre domenica alle 18:00 di New York; che il prezzo torni a chiudere il salto e' una "
                   "convenzione di lettura, come i vuoti di prezzo, non una misura")
    if b.get("beta") is None:
        L.append(f"  MSTR sul bitcoin: sensibilita' NON misurabile ({b.get('n', 0)} sedute comuni con IBIT, ne servono 60)")
    else:
        L.append(f"  MSTR sul bitcoin (IBIT, {b['n']} sedute allineate per data): beta {_it(b['beta'])} · R² {_it(b['r2'])}"
                 + (f" → a relazione invariata il movimento del bitcoin vale {_sg(b['mstr_equivalente'])}% su MSTR, "
                    f"≈ {_sg(b['dollari'], 0)} $ sulle {_it(b['qta'], 0)} azioni: un conto su una relazione misurata, NON una "
                    "previsione dell'apertura" if b.get("mstr_equivalente") is not None else ""))
    return L


# ══════════════════════════════════════ v499 — DARK POOL (FINRA) E DIX (SqueezeMetrics) ══════════════════════════════
URL_DP = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{d}.txt"
URL_DIX = "https://squeezemetrics.com/monitor/static/DIX.csv"
CACHE_DP = RADICE / "memoria" / "dark_pool.jsonl"
INDICI_DP = ("SPY", "QQQ", "IWM")       # gli ETF degli indici accanto ai nomi del libro
SEDUTE_DP = 252                          # la distribuzione: un anno di sedute
MEDIA_DP = 10                            # la media di 10 sedute (quella del video): un giorno solo e' rumore


def leggi_dp(testo, d, universo):
    """Il file FINRA di una seduta → una riga di memoria: per ogni nome dell'universo [volume allo scoperto, volume
    totale riportato], interi. 'u' registra l'universo CHIESTO: un nome aggiunto dopo fa rileggere il giorno; uno che
    quel giorno non scambiava (una quotazione recente) resta assente, e non si richiede."""
    voluti = {tk.replace("-", "."): tk for tk in universo}      # FINRA scrive le classi col punto (BRK.B)
    v = {}
    for riga in testo.splitlines()[1:]:
        p = riga.split("|")
        if len(p) < 5 or p[1] not in voluti:
            continue
        try:
            corto, tot = float(p[2]), float(p[4])
        except ValueError:
            continue
        if tot > 0:
            v[voluti[p[1]]] = [int(round(corto)), int(round(tot))]
    return {"data": d, "u": sorted(set(universo)), "v": v}


def giorni_dp(oggi, memoria, universo, giorni=GIORNI_PC):
    """I giorni feriali della finestra da leggere: quelli che la memoria non ha, e quelli letti per un universo che non
    comprendeva un nome di oggi (il nome nuovo si riempie all'indietro, una volta)."""
    u, out = set(universo), []
    for g in (oggi - timedelta(days=k) for k in range(giorni)):
        if g.weekday() >= 5:
            continue
        r = memoria.get(g.isoformat())
        if r is None or (not r.get("assente") and not u <= set(r.get("u") or [])):
            out.append(g.isoformat())
    return out


def aggiorna_dp(oggi, memoria, universo, leggi=scarica, paralleli=PARALLELI):
    """Come aggiorna_pc: un 403/404 vecchio e' una borsa chiusa e si registra, uno recente e' un file non ancora
    pubblicato; un errore di rete si conta fra le NON lette (v389). I file sono immutabili: si legge solo cio' che manca."""
    def uno(d):
        try:
            return d, leggi_dp(leggi(URL_DP.format(d=d.replace("-", ""))).decode("latin-1"), d, universo), None
        except urllib.error.HTTPError as e:
            return d, None, e.code
        except Exception as e:  # noqa: BLE001
            return d, None, type(e).__name__

    nuove, assenti, non_lette, attese = 0, 0, [], []
    with ThreadPoolExecutor(paralleli) as ex:
        for d, r, err in ex.map(uno, giorni_dp(oggi, memoria, universo)):
            if r is not None:
                memoria[d] = r
                nuove += 1
            elif err in (403, 404):
                if (oggi - date.fromisoformat(d)).days > MARGINE_ASSENTE:
                    memoria[d] = {"data": d, "assente": err}
                    assenti += 1
                else:
                    attese.append(d)
            else:
                non_lette.append(d)
    return {"nuove": nuove, "assenti": assenti, "non_lette": non_lette, "non_ancora_pubblicate": attese}


def medie_dp(righe, m=MEDIA_DP):
    """[(data, media di m sedute PONDERATA sui volumi, in %)] da righe [(data, [scoperto, totale])]: somma dello
    scoperto su somma del totale, cosi' un giorno sottile non pesa come uno pieno. Una funzione sola per il dato
    pubblicato e per la misura del suo valore predittivo (v500)."""
    return [(righe[i][0], sum(c for _, (c, _t) in righe[i - m + 1:i + 1])
             / sum(t for _, (_c, t) in righe[i - m + 1:i + 1]) * 100) for i in range(m - 1, len(righe))]


def stato_dp(memoria, tk, n=SEDUTE_DP, m=MEDIA_DP, minimo=MIN_STORIA):
    """Il rapporto delle vendite allo scoperto fuori borsa di UN nome: l'ultima seduta, la media di m sedute PONDERATA
    sui volumi (somma dello scoperto su somma del totale: un giorno sottile non pesa come uno pieno) e i percentili
    dell'anno. Sotto `minimo` sedute il percentile non si pubblica (convenzione)."""
    righe = [(d, memoria[d]["v"][tk]) for d in sorted(memoria) if tk in (memoria[d].get("v") or {})][-n:]
    if not righe:
        return None
    dpi = [c / t * 100 for _, (c, t) in righe]
    medie = [v for _, v in medie_dp(righe, m)]
    out = {"tk": tk, "data": righe[-1][0], "dpi": dpi[-1], "n": len(righe), "dal": righe[0][0],
           "media": medie[-1] if medie else None, "n_medie": len(medie)}
    if len(dpi) >= minimo:
        out["rango"] = _rango(_pct_rank(dpi[-1], dpi))
    if len(medie) >= minimo:
        out["rango_media"] = _rango(_pct_rank(medie[-1], medie))
    return out


def leggi_dix(testo):
    """DIX.csv → [{data, dix (in %), gex ($ per 1% di movimento dell'S&P 500, la stima della fonte)}]."""
    out = []
    for r in csv.DictReader(io.StringIO(testo)):
        try:
            out.append({"data": str(r["date"])[:10], "dix": float(r["dix"]) * 100, "gex": float(r["gex"])})
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(out, key=lambda x: x["data"])


def stato_dix(righe, n=SEDUTE_DP, m=MEDIA_DP):
    if not righe:
        return None
    anno, ult = righe[-n:], righe[-1]
    dix, gex = [r["dix"] for r in anno], [r["gex"] for r in anno]
    return {"data": ult["data"], "dix": ult["dix"], "rango": _rango(_pct_rank(ult["dix"], dix)),
            "media": sum(dix[-m:]) / len(dix[-m:]), "rango_media": _rango(_pct_rank(sum(dix[-m:]) / len(dix[-m:]),
                                                                                  [sum(dix[i - m + 1:i + 1]) / m
                                                                                   for i in range(m - 1, len(dix))])),
            "gex": ult["gex"], "rango_gex": _rango(_pct_rank(ult["gex"], gex)),
            "gex_negativi": sum(1 for x in gex if x < 0), "n": len(anno), "dal_storia": righe[0]["data"]}


def _miliardi(x):
    """Dollari per 1% di movimento, col segno: miliardi da uno in su, milioni da uno in su, migliaia sotto, dollari
    sotto il migliaio. Su un titolo piccolo la gamma netta vale decine di migliaia di dollari: in milioni la prima
    stesura stampava «0 mln $ (NEGATIVA)», un regime dichiarato accanto a uno zero (v499)."""
    if x is None:
        return "n.d."
    if abs(x) >= 1e9:
        return f"{_sg(x / 1e9, 2)} mld $"
    if abs(x) >= 1e6:
        return f"{_sg(x / 1e6, 1 if abs(x) < 1e7 else 0)} mln $"
    if abs(x) >= 1e3:
        return f"{_sg(x / 1e3, 0)} mila $"
    return f"{_sg(x, 0)} $"


def righe_dp(stati, agg, dix, err_dix=None):
    L = ["DARK POOL — vendite allo scoperto sui mercati fuori borsa (FINRA, file giornaliero consolidato) · DPI = "
         "volume venduto allo scoperto / volume totale riportato a FINRA, per titolo",
         "  ⚠ convenzione, non misura (v240): chi compra fuori borsa riceve spesso azioni che il market maker gli vende "
         "allo scoperto e ricopre dopo, quindi un DPI ALTO si LEGGE come acquisto e uno basso come vendita — e' il "
         "modello di SqueezeMetrics, che con lo stesso dato costruisce il DIX; chi compra davvero non si osserva · conta "
         f"il confronto col proprio anno, non il livello: un ETF ha rapporti strutturalmente diversi da un'azione · media "
         f"di {MEDIA_DP} sedute ponderata sui volumi"]
    if agg.get("non_lette"):
        L.append(f"  ⚠ {NL._conta(len(agg['non_lette']), 'seduta NON letta', 'sedute NON lette')} per errore di rete: "
                 f"{', '.join(_gm(d) for d in agg['non_lette'][:6])}")
    if agg.get("non_ancora_pubblicate"):
        L.append(f"  non ancora pubblicate da FINRA: {', '.join(_gm(d) for d in agg['non_ancora_pubblicate'])}")
    for tk, s in stati.items():
        if s is None:
            L.append(f"  {tk}: nessuna seduta nella memoria — non vuol dire 'nessuno scambio fuori borsa'")
            continue
        r = f" ({s['rango']}° percentile dell'anno)" if s.get("rango") is not None else f" (storia di {s['n']} sedute: percentile n.d.)"
        rm = f" ({s['rango_media']}°)" if s.get("rango_media") is not None else ""
        L.append(f"  {tk}: DPI {_it(s['dpi'], 1)}% il {_gm(s['data'])}{r} · media {MEDIA_DP} sedute "
                 + (f"{_it(s['media'], 1)}%{rm}" if s.get("media") is not None else "n.d."))
    if dix is None:
        L.append(f"  DIX dell'S&P 500: NON letto ({err_dix or 'motivo n.d.'}) — non vuol dire 'nessun segnale'")
    else:
        L.append(f"  DIX dell'S&P 500 (SqueezeMetrics, ponderato in dollari sui titoli dell'indice): {_it(dix['dix'], 1)}% il "
                 f"{_gma(dix['data'])} ({dix['rango']}° percentile dell'anno) · media {MEDIA_DP} sedute {_it(dix['media'], 1)}% "
                 + (f"({dix['rango_media']}°)" if dix.get("rango_media") is not None
                    else f"(percentile n.d.: servono {MEDIA_DP} sedute per una media)"))
        L.append(f"  GEX dell'S&P 500 (stima di SqueezeMetrics, dollari che i dealer comprano o vendono per 1% di "
                 f"movimento): {_miliardi(dix['gex'])} ({'POSITIVA' if dix['gex'] > 0 else 'NEGATIVA'}, "
                 f"{dix['rango_gex']}° percentile dell'anno; negativa in {dix['gex_negativi']} sedute su {dix['n']}) — la "
                 "loro stima, con un metodo proprio: il blocco GAMMA DEI DEALER la ricava dalle catene dell'ETF SPY — strumenti e "
                 "metodi diversi, e i due segni possono differire")
    return L


# ══════════════════════════════════════ v499 — GAMMA DEI DEALER (GEX), STIMATA DALLE CATENE ══════════════════════
GEX_GRIGLIA = 0.20       # il cambio di regime si cerca entro ±20% dal prezzo (convenzione)
GEX_PASSO = 0.0025       # un quarto di punto percentuale: la risoluzione del livello
INDICI_GEX = ("SPY", "QQQ", "IWM")


def anni_alla_scadenza(scad, adesso):
    """Dalla data e ora di adesso alla chiusura del giorno di scadenza (16:00 di New York), in anni."""
    fine = datetime(int(scad[:4]), int(scad[5:7]), int(scad[8:10]), 16, 0, tzinfo=NEW_YORK)
    return max((fine - adesso).total_seconds(), 0.0) / (365.25 * 86400)


def gamma_dealer(contr, spot, adesso, griglia=GEX_GRIGLIA, passo=GEX_PASSO):
    """La gamma dei dealer stimata da una catena (convenzione dichiarata: dealer LUNGHI le call, CORTI le put).
    Per ogni contratto vivo con open interest e volatilita' implicita: gamma di Black-Scholes (tasso zero, senza
    dividendi) × open interest × 100 azioni × prezzo² × 1% = dollari che i dealer comprano o vendono per un movimento
    dell'1%. La NETTA al prezzo di oggi dice il regime; la stessa somma su una griglia di prezzi trova il prezzo a cui
    passa per zero (il cambio di regime, interpolato fra i due punti); call wall e put wall sono gli strike sopra e
    sotto il prezzo con piu' gamma sul proprio lato, sommata su tutte le scadenze."""
    import numpy as np
    usa = [(c["strike"], anni_alla_scadenza(c["scad"], adesso), float(c.get("iv") or 0), float(c.get("oi") or 0), c["tipo"])
           for c in contr]
    usa = [u for u in usa if u[0] > 0 and u[1] > 0 and u[2] > 0 and u[3] > 0]
    if not usa or not spot or spot <= 0:
        return None
    K = np.array([u[0] for u in usa])
    T = np.array([u[1] for u in usa])
    IV = np.array([u[2] for u in usa])
    OI = np.array([u[3] for u in usa])
    SG = np.array([1.0 if u[4] == "C" else -1.0 for u in usa])
    den = IV * np.sqrt(T)

    def esposizioni(S):
        S = np.atleast_1d(np.asarray(S, dtype=float))[:, None]
        d1 = (np.log(S / K) + 0.5 * IV * IV * T) / den
        g = np.exp(-0.5 * d1 * d1) / (np.sqrt(2 * np.pi) * S * den)
        return SG * g * OI * 100.0 * S * S * 0.01

    e0 = esposizioni(spot)[0]
    prezzi = spot * (1.0 + np.arange(-griglia, griglia + passo / 2, passo))
    curva = esposizioni(prezzi).sum(axis=1)
    flip = None
    for i in range(len(prezzi) - 1):
        a, b = float(curva[i]), float(curva[i + 1])
        if a == 0 or (a < 0) != (b < 0):
            x = float(prezzi[i]) if a == 0 else float(prezzi[i] + (prezzi[i + 1] - prezzi[i]) * (-a) / (b - a))
            if flip is None or abs(x - spot) < abs(flip - spot):
                flip = x
    lato = {}
    for (k, _t, _iv, _oi, tipo), e in zip(usa, e0):
        lato[(tipo, k)] = lato.get((tipo, k), 0.0) + abs(float(e))
    cw = max(((k, v) for (tp, k), v in lato.items() if tp == "C" and k >= spot), key=lambda kv: kv[1], default=None)
    pw = max(((k, v) for (tp, k), v in lato.items() if tp == "P" and k <= spot), key=lambda kv: kv[1], default=None)
    return {"spot": spot, "netta": float(e0.sum()), "flip": flip, "call_wall": cw[0] if cw else None,
            "put_wall": pw[0] if pw else None, "contratti": len(usa), "griglia": griglia}


def righe_gex(g, errori=None):
    L = ["GAMMA DEI DEALER (GEX) — stima dalle catene complete di CBOE (open interest della sera prima, volatilita' "
         "implicita della fonte; gamma di Black-Scholes a tasso zero e senza dividendi; contratti senza volatilita' "
         "implicita esclusi)",
         "  ⚠ convenzione, non misura (v240): si assume che i dealer siano LUNGHI le call (le vendono i clienti) e CORTI "
         "le put (le comprano i clienti); chi detiene davvero cosa non si osserva · gamma netta POSITIVA: le coperture "
         "dei dealer smorzano i movimenti (comprano i ribassi, vendono i rialzi); NEGATIVA: li amplificano · call wall = "
         "lo strike SOPRA il prezzo con piu' gamma sulle call (spesso un tetto) · put wall = SOTTO il prezzo con piu' "
         "gamma sulle put (spesso un supporto) · cambio di regime = il prezzo a cui la gamma netta passa per zero, "
         f"cercato entro ±{_it(GEX_GRIGLIA * 100, 0)}% · sono livelli dove il prezzo SI E' FERMATO piu' spesso, non "
         "dove si fermera'"]
    for tk, x in g.items():
        if x is None:
            L.append(f"  {tk}: gamma n.d. — " + ((errori or {}).get(tk) or "catena senza contratti utili"))
            continue
        s = x["spot"]
        d = lambda v: f"{_strike(v)} ({_sg((v / s - 1) * 100)}%)" if v is not None else "n.d."  # noqa: E731
        reg = ("POSITIVA" if x["netta"] > 0 else "NEGATIVA") if x["netta"] != 0 else "NULLA"
        cambio = (f"cambio di regime {_it(x['flip'], 2)} ({_sg((x['flip'] / s - 1) * 100)}%)" if x["flip"] is not None
                  else f"nessun cambio di regime entro ±{_it(x['griglia'] * 100, 0)}%")
        L.append(f"  {tk} {_it(s, 2)} · gamma netta {_miliardi(x['netta'])} per 1% ({reg}) · {cambio} · call wall "
                 f"{d(x['call_wall'])} · put wall {d(x['put_wall'])}")
    return L


# ══════════════════════════════════════ ESECUZIONE ══════════════════════════════════════
def _catena(tk):
    try:
        return tk, json.loads(scarica(URL_CATENA.format(tk=tk))), None
    except urllib.error.HTTPError as e:
        return tk, None, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        return tk, None, type(e).__name__


def _cot(anno):
    try:
        z = zipfile.ZipFile(io.BytesIO(scarica(URL_COT.format(a=anno), timeout=60)))
        nome = next(n for n in z.namelist() if n.lower().endswith(".txt"))
        return anno, cot_righe(z.read(nome).decode("latin-1")), None
    except Exception as e:  # noqa: BLE001
        return anno, [], f"{anno} ({type(e).__name__})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-memoria", action="store_true", help="non scrive memoria/cboe_putcall.jsonl")
    a = ap.parse_args()
    adesso = datetime.now(NEW_YORK)
    oggi = adesso.date()
    import analisi
    in_seduta = analisi.fase(adesso) == "seduta"
    pos, _, sorv = brief.leggi_libro()
    qta = {p["tk"]: p["qta"] for p in pos if p.get("valuta") == "USD"}
    simboli = sorted(qta) + [t for t in INDICI_GEX if t not in qta]     # v499 — IWM accanto a SPY e QQQ
    memoria = leggi_memoria_pc()
    memoria_tit = leggi_memoria_titoli()
    # v499 — il dark pool di posizioni, sorvegliati e indici: un file FINRA per seduta li porta tutti
    universo_dp = list(dict.fromkeys(sorted(qta) + [s["tk"] for s in sorv] + list(INDICI_DP)))
    memoria_dp = leggi_memoria_pc(CACHE_DP)
    with ThreadPoolExecutor(PARALLELI) as ex:
        f_dix = ex.submit(lambda: leggi_dix(scarica(URL_DIX).decode("utf-8", "replace")))
        f_cat = [ex.submit(_catena, tk) for tk in simboli]
        f_cot = [ex.submit(_cot, oggi.year - k) for k in range(ANNI_COT + 1)]
        f_btc = ex.submit(lambda: candele_btc(json.loads(scarica(URL_BTC))))
        f_mstr = ex.submit(brief.barre, "MSTR")
        f_ibit = ex.submit(brief.barre, "IBIT")
        f_conti = ex.submit(brief.calendario_trimestrali, sorted(qta), GIORNI_CONTI)
        agg = aggiorna_pc(oggi, memoria)
        agg_dp = aggiorna_dp(oggi, memoria_dp, universo_dp)
    if not a.no_memoria:
        scrivi_memoria_pc(memoria)
        scrivi_memoria_pc(memoria_dp, CACHE_DP)
    try:
        dix, err_dix = stato_dix(f_dix.result()), None
    except Exception as e:  # noqa: BLE001
        dix, err_dix = None, f"{type(e).__name__}: {str(e)[:80]}"
    stati_dp = {tk: stato_dp(memoria_dp, tk) for tk in universo_dp}
    try:
        conti_cal = f_conti.result()
    except Exception:  # noqa: BLE001
        conti_cal = {"attesi": []}
    conti = {}
    for c in conti_cal.get("attesi") or []:
        conti.setdefault(c["tk"], c)
    rie, errori_cat, gex = {}, {}, {}
    for f in f_cat:
        tk, j, err = f.result()
        if j is None:
            errori_cat[tk] = err
            gex[tk] = None
            continue
        rie[tk] = riepilogo(j, tk, oggi, conti.get(tk), in_seduta)
        # v499 — la gamma dei dealer sullo stesso prezzo del riepilogo (in seduta l'ultimo, fuori la chiusura)
        gex[tk] = gamma_dealer(contratti(j, tk), (rie[tk] or {}).get("spot"), adesso) if rie[tk] else None
    nuove_tit = registra_titoli(rie, memoria_tit, analisi.fase(adesso), adesso, gex)     # v500 — anche la gamma
    if not a.no_memoria and nuove_tit:
        scrivi_memoria_titoli(memoria_tit)
    storia = {tk: storia_titolo(memoria_tit, tk) for tk in qta}
    righe_c, err_cot = [], []
    for f in f_cot:
        anno, rr, err = f.result()
        righe_c += rr
        if err:
            err_cot.append(err)
    try:
        btc = bitcoin(f_btc.result(), f_mstr.result(), f_ibit.result(), qta.get("MSTR"), adesso)
        err_btc = None
    except Exception as e:  # noqa: BLE001
        btc, err_btc = None, f"{type(e).__name__}: {e}"
    L = [f"POSIZIONAMENTO — {adesso.astimezone(ROMA):%d/%m/%Y %H:%M} ora italiana · New York {adesso:%H:%M} · "
         f"fase: {analisi.fase(adesso).upper()}",
         "  fonti: CBOE (statistiche giornaliere e catene complete delle opzioni, differite di 15 minuti), CFTC (rapporto "
         "settimanale Traders in Financial Futures), Coinbase Exchange (bitcoin, candele orarie), stockanalysis (MSTR e IBIT), "
         "FINRA (vendite allo scoperto fuori borsa, file giornaliero) e SqueezeMetrics (DIX e GEX dell'S&P 500)",
         ""]
    L += righe_pc(stato_pc(memoria), agg)
    L.append("")
    L += righe_scadenze(rie, oggi)
    L.append("")
    if errori_cat:
        L.append("⚠ catene NON lette: " + ", ".join(f"{k} ({v})" for k, v in sorted(errori_cat.items())))
    L += righe_opzioni(rie, qta, storia)
    L.append("")
    L += righe_gex(gex, errori_cat)                 # v499
    L.append("")
    L += righe_dp(stati_dp, agg_dp, dix, err_dix)   # v499
    L.append("")
    L += righe_cot(cot_stato(righe_c), err_cot)
    L.append("")
    L += righe_btc(btc, err_btc)
    L.append("")
    L.append(f"  memoria del put/call: {sum(1 for r in memoria.values() if r.get('azioni') is not None)} sedute, "
             f"{agg['nuove']} lette ora, {agg['assenti']} giorni di borsa chiusa registrati"
             + ("" if not a.no_memoria else " — NON scritta (--no-memoria)"))
    L.append(f"  memoria del dark pool: {sum(1 for r in memoria_dp.values() if r.get('v'))} sedute, {agg_dp['nuove']} lette ora, "
             f"{agg_dp['assenti']} giorni senza file registrati" + ("" if not a.no_memoria else " — NON scritta (--no-memoria)"))
    L.append(f"  memoria delle opzioni per titolo: {len(memoria_tit)} righe, {nuove_tit} nuove"
             + (" (si registra solo a borsa chiusa o dalle 16:30 di New York)" if not nuove_tit else "")
             + ("" if not a.no_memoria else " — NON scritta (--no-memoria)"))
    print("\n".join(L))


if __name__ == "__main__":
    main()
