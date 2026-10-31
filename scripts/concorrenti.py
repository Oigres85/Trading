#!/usr/bin/env python3
"""CONCORRENTI E QUOTE DI MERCATO (v503) — per ogni nome del libro, e per i sorvegliati che hanno un registro: chi sono
i concorrenti, quanta parte del mercato hanno (con la fonte e la data), e se sono piu' o meno sani del nome, misurato
con le STESSE formule per tutti.

Uso:  python3 scripts/concorrenti.py [--tutti] [--no-memoria]

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il CEO, 18/10/2026: «Smci però ha quote di mercato molto bassa rispetto ai competitor che sono effettivamente più
sani. Analizza anche questo per gli altri e rendilo strutturale, ovvero i competitor e delle relative quote di
mercato». Lo script SELEZIONA e MISURA; il giudizio lo scrive il modello (v448). E' INFORMAZIONE: non e' una prova
della tenuta, un colore del semaforo o una vendita.

═══ DUE COSE DIVERSE, DUE PROPRIETARI ═══════════════════════════════════════════════════════
- LE QUOTE vengono da fonti terze (IDC, TrendForce, Counterpoint, Mercury Research, Synergy, BitcoinTreasuries): non
  ce n'e' una gratuita in forma automatizzabile, quindi vivono in un REGISTRO (memoria/concorrenti.json) con il
  mercato dichiarato — una quota senza il suo mercato non si legge (v400) —, la misura, il periodo, la fonte, il link
  e la data di pubblicazione. Lo strumento non le calcola: le riporta con l'eta', e oltre ETA_QUOTE_GIORNI dalla
  pubblicazione le dichiara da riverificare (le fonti escono ogni trimestre). Dove una quota pubblica verificabile non
  esiste (Palantir, Bloom, Rigetti) lo dice: meglio non avere il dato che averlo sbagliato (v396). Una STIMA di
  analisti (spesso di seconda mano) non e' una misura di un tracker, e la riga lo dice.
- LA SALUTE la misura lo strumento, con le funzioni della pipeline sui conti di yfinance, le stesse per il nome e per
  ogni concorrente (v161): la crescita dei ricavi sullo stesso trimestre dell'anno prima trovato per data
  (schede_progetto.ultimo_trimestre), il margine lordo (la voce di yfinance che usa la pipeline), il margine
  operativo e la cassa libera degli ultimi 4 trimestri, Altman Z'' con la zona e il rating equivalente (update_data e
  credito), la liquidita' contro il debito in scadenza entro un anno. Solo RAPPORTI: i bilanci sono in valute diverse
  (v404, v447).
- NESSUN PUNTEGGIO (v200): per ogni misura il posto del nome nel gruppo, e chi non ha il dato si nomina.

═══ LA MEMORIA ═══════════════════════════════════════════════════════════════════════════════
Un conto trimestrale cambia una volta ogni tre mesi: le letture stanno in memoria/concorrenti_dati.json e si rifanno
dopo ETA_DATI_GIORNI, al massimo LETTURE_PER_GIRO per giro — yfinance ha una quota per IP (v398) —; chi resta indietro
si dichiara con la data della sua lettura. --tutti le rifa' tutte. Misurato il 18/10/2026 da questo ambiente: ~1,5
secondi a titolo, anche per Taiwan, Hong Kong, Shenzhen, Seul e Tokyo.
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief  # noqa: E402
import credito as CR  # noqa: E402
import schede_progetto as SP  # noqa: E402

RADICE = Path(__file__).resolve().parent.parent
REGISTRO = RADICE / "memoria" / "concorrenti.json"
MEMORIA = RADICE / "memoria" / "concorrenti_dati.json"
# convenzioni del 18/10/2026 (v240): una quota trimestrale oltre 120 giorni dalla pubblicazione e' di un trimestre fa
# (la fonte ne ha gia' pubblicata un'altra, o sta per); un conto trimestrale letto da piu' di 7 giorni si rilegge
ETA_QUOTE_GIORNI = 120
ETA_DATI_GIORNI = 7
LETTURE_PER_GIRO = 15
# la versione delle letture in memoria: quando cambia una formula, le letture di prima si rifanno (la lezione della
# v502 — una cache di dati DERIVATI senza versione conserva per sempre la formula vecchia)
VERSIONE = 520          # v504: il flusso operativo sui ricavi e il ciclo di cassa · v520: ROIC e ROE — le letture di prima si rifanno
PAUSA = 0.4
TIPI = ("misura", "stima", "nessuna")
# i conti trimestrali della fonte possono fermarsi PRIMA del trimestre che la stessa fonte dichiara chiuso
# (mostRecentQuarter): misurato il 18/10/2026, Amazon fermo al 31/03 con il 30/06 dichiarato (ricavi del trimestre
# vuoti), Micron al 31/05 col 03/09, Lenovo al 30/09/2025 col 30/06/2026. Entro TRIM_TOLLERANZA_GIORNI le due date sono
# lo stesso trimestre (fine mese contro fine della settimana fiscale); un trimestre di ritardo si DICHIARA, piu' di
# TRIM_INDIETRO_MAX descrive un altro periodo e resta fuori dal confronto dei posti, nominato (convenzioni del 18/10)
TRIM_TOLLERANZA_GIORNI = 20
TRIM_INDIETRO_MAX = 1
# le misure del confronto, nell'ordine in cui si stampano; per tutte vale «piu' alto e' meglio» TRANNE quelle in
# PIU_BASSO_MEGLIO (v504: il ciclo di cassa — meno giorni fra il pagamento dei fornitori e l'incasso dai clienti)
MISURE = (("ricavi_yoy", "crescita dei ricavi sull'anno"), ("margine_lordo", "margine lordo"),
          ("margine_op_12m", "margine operativo 12 mesi"), ("ocf_12m_pct", "flusso operativo 12 mesi sui ricavi"),
          ("fcf_12m_pct", "cassa libera 12 mesi sui ricavi"), ("ciclo", "ciclo di cassa"),
          ("roic_12m", "ROIC 12 mesi"), ("roe_12m", "ROE 12 mesi"),
          ("altman_z", "Altman Z''"), ("liq_su_breve", "liquidita' sul debito a breve"))
PIU_BASSO_MEGLIO = ("ciclo",)


# ═══ IL REGISTRO ══════════════════════════════════════════════════════════════════════════════
def carica_registro(percorso=REGISTRO):
    return (json.loads(Path(percorso).read_text(encoding="utf-8")) or {}).get("nomi") or {}


def mercati_di(tk, nomi):
    """I mercati di un nome: i suoi, piu' quelli che dichiara di condividere con un altro nome (mai copiati: v161)."""
    v = nomi.get(tk) or {}
    out = [m for m in (v.get("mercati") or []) if isinstance(m, dict)]
    for c in v.get("mercati_condivisi") or []:
        da = (nomi.get(c.get("da")) or {}).get("mercati") or []
        out.extend(m for m in da if isinstance(m, dict) and (not c.get("mercato") or m.get("mercato") == c["mercato"]))
    return out


def data_pubblicazione(s):
    """AAAA-MM-GG, oppure AAAA-MM quando la fonte dichiara solo il mese: l'eta' si conta dal primo del mese, per
    eccesso. None se la data manca o non si legge — allora l'eta' non e' nota, e si dice."""
    s = str(s or "")
    for fmt, n in (("%Y-%m-%d", 10), ("%Y-%m", 7)):
        if len(s) == n:
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                return None
    return None


def controlla_registro(nomi):
    """I difetti del registro, come elenco di frasi: un mercato senza le sue dichiarazioni non si pubblica."""
    out = []
    for tk, v in nomi.items():
        if not isinstance(v, dict):
            out.append(f"{tk}: voce non leggibile")
            continue
        if not mercati_di(tk, nomi):
            out.append(f"{tk}: nessun mercato (ne' suo ne' condiviso)")
        for c in v.get("mercati_condivisi") or []:
            if c.get("da") not in nomi:
                out.append(f"{tk}: rimanda ai mercati di {c.get('da')}, che non e' nel registro")
        for m in v.get("mercati") or []:
            if not isinstance(m, dict):
                out.append(f"{tk}: mercato non strutturato ({str(m)[:40]})")
                continue
            if m.get("tipo") not in TIPI:
                out.append(f"{tk} · {m.get('mercato')}: tipo {m.get('tipo')!r} non fra {TIPI}")
            if not m.get("mercato") or not m.get("fonte") or not m.get("verificato_il"):
                out.append(f"{tk}: mercato senza nome, fonte o data di verifica")
            if m.get("tipo") in ("misura", "stima"):
                for k in ("misura", "periodo", "url"):
                    if not m.get(k):
                        out.append(f"{tk} · {m.get('mercato')}: manca '{k}'")
                if data_pubblicazione(m.get("pubblicato")) is None:
                    out.append(f"{tk} · {m.get('mercato')}: data di pubblicazione assente o illeggibile")
                if not m.get("quote"):
                    out.append(f"{tk} · {m.get('mercato')}: {m.get('tipo')} senza quote")
                # ogni quota arrotondata dalla fonte puo' sbagliare di mezzo punto: tre interi possono fare 101
                somma = sum(q.get("quota_pct") or q.get("quota_min_pct") or 0 for q in m.get("quote") or [])
                if somma > 100 + 0.5 * len(m.get("quote") or []):
                    out.append(f"{tk} · {m.get('mercato')}: le quote sommano {CR._n(somma, 1)}%, oltre il 100%")
            elif m.get("quote"):
                out.append(f"{tk} · {m.get('mercato')}: 'nessuna' quota dichiarata ma con quote")
    return out


def _quota(q):
    """La quota come la fonte la pubblica: un numero, o un intervallo per le stime."""
    if q.get("quota_pct") is not None:
        s = f"{CR._n(q['quota_pct'], 1)}%"
        if q.get("un_anno_prima_pct") is not None:
            s += f" (un anno prima {CR._n(q['un_anno_prima_pct'], 1)}%)"
        return s
    if q.get("quota_min_pct") is not None:
        return f"{CR._n(q['quota_min_pct'], 0)}-{CR._n(q.get('quota_max_pct'), 0)}%"
    return "n.d."


def righe_mercato(m, tk, oggi):
    """Una quota di mercato con tutto cio' che serve per leggerla: il mercato, cosa misura, il periodo, la fonte, la
    data e l'eta'. Il nome in esame si marca; se la fonte non lo pubblica, si dice."""
    if m.get("tipo") == "nessuna":
        return [f"mercato: {m.get('mercato')} — NESSUNA QUOTA PUBBLICA VERIFICABILE: {m.get('fonte')} "
                f"(verificato il {CR._data(m.get('verificato_il'))}). Il confronto fra concorrenti resta sulla salute."]
    pub = data_pubblicazione(m.get("pubblicato"))
    eta = (oggi - pub).days if pub else None
    data_txt = (CR._data(m.get("pubblicato")) if len(str(m.get("pubblicato"))) == 10
                else f"{m.get('pubblicato')} (la fonte dichiara solo il mese)")
    vecchia = eta is not None and eta > ETA_QUOTE_GIORNI
    testa = (f"mercato: {m.get('mercato')} — {m.get('misura')}, {m.get('periodo')} · "
             f"{'STIMA di analisti, non una misura di un tracker' if m.get('tipo') == 'stima' else 'misura'} · "
             f"fonte {m.get('fonte')}, pubblicata il {data_txt}"
             + (f", {eta} giorni fa" if eta is not None else "")
             + (f" — ⚠ DA RIVERIFICARE: oltre {ETA_QUOTE_GIORNI} giorni, la fonte ha probabilmente un trimestre piu' "
                "recente" if vecchia else ""))
    quote = m.get("quote") or []
    parti = []
    for q in quote:
        nome = q.get("nome") + (" ◀" if q.get("ticker") == tk else "")
        parti.append(f"{nome} {_quota(q)}" + (" [categoria, non una societa']" if q.get("categoria") else ""))
    out = [testa, "   " + " · ".join(parti)]
    if not any(q.get("ticker") == tk for q in quote):
        out.append(f"   ⚠ la quota di {tk} NON e' pubblicata da questa fonte")
    if m.get("tipo") == "misura":
        somma = sum(q.get("quota_pct") or 0 for q in quote)
        if somma < 99.5:
            out.append(f"   le quote elencate sommano {CR._n(somma, 1)}%: il resto e' di altri che la fonte non elenca")
    if m.get("nota"):
        out.append(f"   nota: {m['nota']}")
    out.append(f"   link: {m.get('url')}")
    return out


# ═══ LA SALUTE ════════════════════════════════════════════════════════════════════════════════
def _ud():
    """update_data si importa una volta e in silenzio: stampa l'elenco dei simboli quando viene caricato."""
    if "update_data" not in sys.modules:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            import update_data  # noqa: F401
    return sys.modules["update_data"]


def stesso_trimestre(a, b):
    """Due date di fine trimestre entro TRIM_TOLLERANZA_GIORNI: lo stesso trimestre (fine mese contro fine della
    settimana fiscale). False se una delle due non si legge."""
    try:
        return abs((date.fromisoformat(str(a)[:10]) - date.fromisoformat(str(b)[:10])).days) <= TRIM_TOLLERANZA_GIORNI
    except (TypeError, ValueError):
        return False


def _ultimi4(conto, chiave):
    q = sorted([x for x in (conto or []) if isinstance(x, dict) and x.get("trim") and x.get(chiave) is not None
                and x.get("ricavi")], key=lambda x: str(x["trim"]), reverse=True)[:4]
    return q if len(q) == 4 else None


def salute(tk, ticker=None, oggi=None):
    """Le misure di salute di un titolo con le funzioni della pipeline. ticker: un oggetto con l'interfaccia di
    yfinance.Ticker (per i gate); di default si legge yfinance. Tre esiti (v389): letto · vuoto (la fonte risponde
    senza conti) · NON letto (errore, col suo testo)."""
    oggi = oggi or date.today().isoformat()
    ud = _ud()
    try:
        if ticker is None:
            import yfinance as yf
            ticker = yf.Ticker(tk)
        conto = ud.conto_trimestrale(ticker) or []
        cred = ud.credito(ticker) or {}
        comb = ud.combustione(ticker, None, None) or {}
        try:
            info = ticker.info or {}
        except Exception:  # noqa: BLE001
            info = {}
    except Exception as e:  # noqa: BLE001
        return {"tk": tk, "stato": "NON letto", "errore": f"{type(e).__name__}: {str(e)[:100]}", "letto_il": oggi}
    if not conto and not cred and not comb:
        return {"tk": tk, "stato": "vuoto", "letto_il": oggi}
    out = {"tk": tk, "stato": "letto", "letto_il": oggi, "versione": VERSIONE,
           "nome": info.get("shortName") or info.get("longName"), "valuta": info.get("financialCurrency")}
    if isinstance(info.get("mostRecentQuarter"), (int, float)) and info["mostRecentQuarter"] > 0:
        out["trim_dichiarato"] = datetime.fromtimestamp(info["mostRecentQuarter"], tz=timezone.utc).date().isoformat()
    u = SP.ultimo_trimestre({"tv": {"conto_trim": conto}})
    if u:
        out["trim"] = u["trim"]
        out["ricavi_yoy"] = round(u["yoy"], 1) if u["yoy"] is not None else None
    if isinstance(info.get("grossMargins"), (int, float)):
        out["margine_lordo"] = round(info["grossMargins"] * 100, 1)
    q4 = _ultimi4(conto, "operativo")
    if q4:
        out["margine_op_12m"] = round(sum(x["operativo"] for x in q4) / sum(x["ricavi"] for x in q4) * 100, 1)
    q4r = _ultimi4(conto, "ricavi")
    # v504 — la solidita' OPERATIVA accanto alla patrimoniale: il flusso operativo sui ricavi (stessi ricavi della cassa
    #   libera) e il ciclo di cassa con la funzione della pipeline, uguale per il nome e per ogni concorrente (v161)
    try:
        sol = ud.solidita_operativa(ticker, comb) or {}
    except Exception:  # noqa: BLE001
        sol = {}
    g = sol.get("giorni") or {}
    if g.get("ciclo") is not None:
        out["ciclo"], out["ciclo_al"] = g["ciclo"], g.get("al")
    elif g.get("motivo") == "senza_magazzino":
        out["senza_magazzino"] = True
    # ⚠ v504 — flussi e ricavi sullo STESSO periodo: i quattro trimestri dei ricavi devono finire entro
    #   TRIM_TOLLERANZA_GIORNI dall'ultimo trimestre dei flussi, o il rapporto mescola due periodi (v207). Vale da qui
    #   anche per la cassa libera della v503, che lo dava per scontato: quando la fonte e' indietro col conto e non coi
    #   flussi, il rapporto non si fa e la riga lo dice
    fine = sol.get("ocf_ultimo_al") or comb.get("cashflow_al")
    pari = bool(q4r and fine and stesso_trimestre(q4r[0]["trim"], fine))
    if q4r and fine and not pari and comb.get("trimestri") == 4:
        out["periodi_diversi"] = {"ricavi": str(q4r[0]["trim"])[:10], "flussi": str(fine)[:10]}
    if pari and comb.get("ocf_ttm") is not None and comb.get("trimestri") == 4:
        out["ocf_12m_pct"] = round(comb["ocf_ttm"] / sum(x["ricavi"] for x in q4r) * 100, 1)
    if pari and comb.get("fcf_ttm") is not None and comb.get("trimestri") == 4:
        out["fcf_12m_pct"] = round(comb["fcf_ttm"] / sum(x["ricavi"] for x in q4r) * 100, 1)
        # v477: quando gli «investimenti» sono soprattutto attivita' immateriali (per Strategy: bitcoin), la cassa
        # libera non misura un'azienda che costruisce — la riga lo dice, con la quota dichiarata dalla fonte
        if comb.get("investimenti_immateriali_prevalenti"):
            out["immateriali_pct"] = comb.get("quota_immateriali_pct")
    breve, liq = cred.get("debito_corrente"), comb.get("liquidita")
    if breve and breve > 0 and liq is not None:
        out["liq_su_breve"] = round(liq / breve, 2)
    elif liq is not None and breve is not None and breve <= 0:
        out["senza_debito_breve"] = True
    # v520 — ROIC e ROE con la funzione della pipeline, la stessa per il nome e per ogni concorrente (v161)
    try:
        rend = ud.rendimento_capitale(ticker) or {}
    except Exception:  # noqa: BLE001
        rend = {}
    for k, kk in (("roic", "roic_12m"), ("roe", "roe_12m")):
        if rend.get(k) is not None:
            out[kk] = round(rend[k] * 100, 1)
        elif rend.get("motivo_" + k):
            out[kk + "_motivo"] = rend["motivo_" + k]
    if rend.get("al"):
        out["rendimento_al"] = rend["al"]
    qp = rend.get("quota_patrimonio")
    if qp is not None:
        out["quota_patrimonio"] = qp
    try:
        az = ud.altman_zpp(*ud.altman_voci(ticker, cred))
    except Exception:  # noqa: BLE001
        az = {}
    a = CR.altman_rischio({"stats": {k: v for k, v in az.items()}, "sector": info.get("sector")})
    if a.get("stato") == "ok":
        out.update({"altman_z": round(a["z"], 2), "altman_zona": a["zona"], "altman_rating": a["bre"]})
        if CR.utili_negativi_penalizzano(a):
            out["altman_utili_negativi"] = True
        cf = CR.circolante_dai_fornitori(a, sol)       # v504 — da dove viene un circolante negativo
        if cf:
            out["altman_circolante_fornitori"] = cf["dai_fornitori"]
    elif a.get("stato") == "non applicabile":
        out["altman_na"] = info.get("sector") or True
    return out


def aggiorna_dati(tickers, memoria, oggi, budget=LETTURE_PER_GIRO, tutti=False, lettore=salute, pausa=PAUSA):
    """Rilegge chi manca o ha una lettura piu' vecchia di ETA_DATI_GIORNI, al massimo `budget` (tutti con --tutti).
    Un errore lascia la lettura precedente, dichiarata con l'errore. Ritorna (memoria, letti, in_attesa, errori)."""
    limite = (date.fromisoformat(oggi) - timedelta(days=ETA_DATI_GIORNI)).isoformat()
    vecchi = [t for t in tickers if tutti or str((memoria.get(t) or {}).get("letto_il") or "") < limite
              or (memoria.get(t) or {}).get("stato") != "letto" or (memoria.get(t) or {}).get("versione") != VERSIONE]
    vecchi.sort(key=lambda t: (t in memoria, str((memoria.get(t) or {}).get("letto_il") or "")))
    letti, errori = [], {}
    for t in (vecchi if tutti else vecchi[:budget]):
        r = lettore(t, oggi=oggi)
        if r.get("stato") == "NON letto":
            errori[t] = r.get("errore")
            # una lettura buona precedente resta, dichiarata con l'errore; senza, resta l'errore — mai un 'letto'
            memoria[t] = ({**memoria[t], "errore_ultimo": {"il": oggi, "errore": r.get("errore")}}
                          if (memoria.get(t) or {}).get("stato") == "letto" else r)
            continue
        memoria[t] = r
        letti.append(t)
        if pausa:
            time.sleep(pausa)
    attesa = [t for t in vecchi if t not in letti and t not in errori]
    return memoria, letti, attesa, errori


def trimestri_indietro(r):
    """Di quanti trimestri i conti trimestrali della fonte restano indietro rispetto al trimestre che la STESSA fonte
    dichiara chiuso: 0 se coincidono entro TRIM_TOLLERANZA_GIORNI o se una delle due date manca (non si indovina)."""
    try:
        d = (date.fromisoformat(str(r.get("trim_dichiarato"))[:10]) - date.fromisoformat(str(r.get("trim"))[:10])).days
    except (TypeError, ValueError):
        return 0
    return max(1, round(d / 91)) if d > TRIM_TOLLERANZA_GIORNI else 0


def _misura_txt(chiave, v, r):
    if v is None:
        if chiave == "liq_su_breve" and r.get("senza_debito_breve"):
            return "nessun debito a breve"
        if chiave == "altman_z" and r.get("altman_na"):
            return "non si applica (la fonte classifica la societa' nel settore finanziario)"
        if chiave == "ciclo" and r.get("senza_magazzino"):
            return "non si calcola (senza magazzino materiale)"
        if chiave in ("roic_12m", "roe_12m"):
            if (r.get("versione") or 0) < 520:
                return "n.d. (lettura precedente alla v520: si rifa' al prossimo giro)"
            m = r.get(chiave + "_motivo")
            return f"n.d. ({SP.MOTIVI_RENDIMENTO.get(m, m)})" if m else "n.d."
        if chiave in ("ocf_12m_pct", "fcf_12m_pct") and r.get("periodi_diversi"):
            p = r["periodi_diversi"]
            return (f"n.d. (ricavi fino al {CR._data(p.get('ricavi'))}, flussi fino al {CR._data(p.get('flussi'))}: "
                    "periodi diversi)")
        return "n.d."
    if chiave == "ciclo":
        return f"{v} giorni" + (" (i fornitori finanziano l'attivita')" if v < 0 else "")
    if chiave == "ricavi_yoy":
        return f"{CR._sg(v, 1)}%"
    if chiave == "fcf_12m_pct" and r.get("immateriali_pct") is not None:
        return (f"{CR._n(v, 1)}% — ⚠ il {CR._n(r['immateriali_pct'], 1)}% degli investimenti e' in attivita' "
                "immateriali (non impianti): non misura un'azienda che costruisce")
    if chiave == "roe_12m":
        qp = r.get("quota_patrimonio")
        return f"{CR._n(v, 1)}%" + (f" (patrimonio {CR._n(qp * 100, 0)}% del capitale investito: porta la leva)"
                                     if qp is not None and 0 < qp < SP.LEVA_QUOTA_PATRIMONIO else "")
    if chiave in ("margine_lordo", "margine_op_12m", "fcf_12m_pct", "ocf_12m_pct", "roic_12m"):
        return f"{CR._n(v, 1)}%"
    if chiave == "altman_z":
        return (f"{CR._n(v, 2)} {r.get('altman_zona')} ({r.get('altman_rating')})"
                + (" — utili non distribuiti negativi con un EBIT positivo (perdite passate o riacquisti di azioni): "
                   "il punteggio penalizza piu' del credito di oggi" if r.get("altman_utili_negativi") else "")
                + (" — circolante negativo che nasce dal ciclo di cassa (credito dei fornitori): il punteggio lo legge "
                   "come debolezza" if r.get("altman_circolante_fornitori") is True else
                   " — circolante negativo che NON nasce dal ciclo di cassa" if r.get("altman_circolante_fornitori") is False
                   else ""))
    if chiave == "liq_su_breve":
        return "meno di 0,1×" if v < 0.1 else f"{CR._n(v, 1)}×"
    return str(v)


def riga_salute(r, tk_esame):
    """Una riga per societa': tutte le misure, la data del trimestre e quella della lettura."""
    if not r or r.get("stato") != "letto":
        return (f"{(r or {}).get('tk')}: NON letto ({(r or {}).get('errore') or (r or {}).get('stato') or 'nessuna lettura'}) "
                "— non e' 'nessun dato', e' la lettura che manca")
    nome = r["tk"] + (" ◀" if r["tk"] == tk_esame else "") + (f" {r['nome']}" if r.get("nome") else "")
    pz = [f"{lab} {_misura_txt(k, r.get(k), r)}" for k, lab in MISURE]
    coda = f" (trimestre al {CR._data(r.get('trim'))}, letto il {CR._data(r.get('letto_il'))}"
    coda += f"; ⚠ ultima rilettura fallita il {CR._data(r['errore_ultimo']['il'])}" if r.get("errore_ultimo") else ""
    n = trimestri_indietro(r)
    if n:
        coda += (f"; ⚠ conti trimestrali indietro di {n} trimestr{'e' if n == 1 else 'i'}: la fonte dichiara chiuso il "
                 f"trimestre al {CR._data(r['trim_dichiarato'])}, e crescita, margine operativo e cassa libera "
                 "descrivono quello precedente")
    return f"{nome}: " + " · ".join(pz) + coda + ")"


def fuori_dal_confronto(gruppo, dati):
    """Chi ha i conti indietro di oltre TRIM_INDIETRO_MAX trimestri: descrive un altro periodo, e nei posti non entra."""
    return [t for t in gruppo if (dati.get(t) or {}).get("stato") == "letto"
            and trimestri_indietro(dati[t]) > TRIM_INDIETRO_MAX]


def posti(tk, gruppo, dati):
    """Per ogni misura il posto del nome fra chi ha il dato (1 = il migliore: il valore piu' alto, il piu' basso per le
    misure in PIU_BASSO_MEGLIO). Nessun punteggio d'insieme (v200)."""
    out = []
    fuori = set(fuori_dal_confronto(gruppo, dati))
    for k, lab in MISURE:
        vals = [(dati[t].get(k), t) for t in gruppo if (dati.get(t) or {}).get("stato") == "letto"
                and dati[t].get(k) is not None and t not in fuori]
        mio = (dati.get(tk) or {}).get(k) if tk not in fuori else None
        if mio is None or not vals:
            out.append(f"{lab}: n.d.")
            continue
        posto = 1 + sum(1 for v, _ in vals if (v < mio if k in PIU_BASSO_MEGLIO else v > mio))
        out.append(f"{lab} {posto}° su {len(vals)}")
    return out


def righe_nome(tk, nomi, dati, oggi, ruolo):
    v = nomi.get(tk) or {}
    out = [f"{tk} [{ruolo}] {v.get('nome') or ''}"]
    for m in mercati_di(tk, nomi):
        out.extend("  " + x for x in righe_mercato(m, tk, oggi))
    gruppo = [tk] + [t for t in v.get("concorrenti_quotati") or [] if t != tk]
    out.append("  salute a confronto (stesse formule per tutti; solo rapporti, i bilanci sono in valute diverse):")
    out.extend("     " + riga_salute(dati.get(t) or {"tk": t}, tk) for t in gruppo)
    fuori = fuori_dal_confronto(gruppo, dati)
    out.append(f"  il posto di {tk} per misura (1 = il migliore: il valore piu' alto, il piu' basso per il ciclo di "
               "cassa; nessun punteggio d'insieme): "
               + " · ".join(posti(tk, gruppo, dati))
               + (f" · fuori dal confronto perche' i loro conti sono indietro di oltre {TRIM_INDIETRO_MAX} trimestre "
                  f"(un altro periodo): {', '.join(fuori)}" if fuori else ""))
    if v.get("concorrenti_non_quotati"):
        out.append("  concorrenti non quotati (nessun bilancio pubblico da confrontare): " + ", ".join(v["concorrenti_non_quotati"]))
    return out


def intestazione():
    return ("CONCORRENTI E QUOTE DI MERCATO (richiesta del CEO del 18/10/2026) — INFORMAZIONE, non una prova della "
            "tenuta ne' una vendita · le QUOTE vengono da fonti terze, ciascuna col suo mercato, periodo, fonte e data "
            f"(registro memoria/concorrenti.json; oltre {ETA_QUOTE_GIORNI} giorni dalla pubblicazione si dichiarano "
            "da riverificare); una STIMA di analisti non e' una misura · la SALUTE la misura lo strumento con le "
            "funzioni della pipeline, uguali per il nome e per i concorrenti: crescita dei ricavi sullo stesso "
            "trimestre dell'anno prima (per data), margine lordo, margine operativo, flusso operativo e cassa libera "
            "degli ultimi 4 trimestri, il ciclo di cassa (crediti + magazzino - fornitori, in giorni; solo con un "
            "magazzino materiale) — la solidita' OPERATIVA —, Altman Z'' con zona e rating equivalente e la liquidita' "
            "sul debito in scadenza entro un anno — la PATRIMONIALE (v504: possono dire cose opposte) · i "
            "trimestri delle societa' finiscono in date diverse, e ciascuna riga dice la sua")


def calcola(oggi=None, tutti=False, memoria=True, percorso_memoria=MEMORIA, registro=REGISTRO):
    oggi = oggi or date.today().isoformat()
    nomi = carica_registro(registro)
    pos, _, sorv = brief.leggi_libro()
    posizioni = [p["tk"] for p in pos if p.get("valuta") == "USD"]
    sorvegliati = [s["tk"] for s in sorv]
    try:
        mem = json.loads(Path(percorso_memoria).read_text(encoding="utf-8")) if memoria else {}
    except Exception:  # noqa: BLE001
        mem = {}
    in_esame = [t for t in posizioni if t in nomi] + [t for t in sorvegliati if t in nomi and t not in posizioni]
    tickers = []
    for t in in_esame:
        for x in [t] + list((nomi[t].get("concorrenti_quotati") or [])):
            if x not in tickers:
                tickers.append(x)
    mem, letti, attesa, errori = aggiorna_dati(tickers, mem, oggi, tutti=tutti)
    if memoria and (letti or errori):
        Path(percorso_memoria).write_text(json.dumps(mem, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
                                          encoding="utf-8")
    return {"oggi": oggi, "nomi": nomi, "posizioni": posizioni, "sorvegliati": sorvegliati, "in_esame": in_esame,
            "dati": mem, "letti": letti, "attesa": attesa, "errori": errori, "difetti": controlla_registro(nomi)}


def sintesi(o):
    oggi = date.fromisoformat(o["oggi"])
    out = [intestazione()]
    if o["difetti"]:
        out.append("⚠ REGISTRO CON DIFETTI (le voci difettose vanno corrette prima di leggerle): " + " · ".join(o["difetti"]))
    for t in o["in_esame"]:
        out.append("")
        out.extend(righe_nome(t, o["nomi"], o["dati"], oggi, "POSIZIONE" if t in o["posizioni"] else "SORVEGLIATO"))
    senza_p = [t for t in o["posizioni"] if t not in o["nomi"]]
    senza_s = [t for t in o["sorvegliati"] if t not in o["nomi"]]
    out.append("")
    out.append("SENZA REGISTRO (concorrenti e quote non ancora cercati, non 'nessun concorrente'): "
               + (f"posizioni {', '.join(senza_p)}" if senza_p else "nessuna posizione")
               + (f" · sorvegliati {len(senza_s)}: {', '.join(senza_s)}" if senza_s else "")
               + " — un sorvegliato riceve il registro quando diventa un ingresso (FORMATO_ANALISI.md §7)")
    stato = (f"letture: {len(o['letti'])} nuove in questo giro" + (f", {len(o['attesa'])} rimandate al prossimo "
             f"(al massimo {LETTURE_PER_GIRO} per giro): {', '.join(o['attesa'])}" if o["attesa"] else "")
             + (f" · NON lette: {', '.join(f'{k} ({v})' for k, v in o['errori'].items())}" if o["errori"] else ""))
    out.append(stato)
    return out


def main():
    args = sys.argv[1:]
    o = calcola(tutti="--tutti" in args, memoria="--no-memoria" not in args)
    print("\n".join(sintesi(o)))


if __name__ == "__main__":
    main()
