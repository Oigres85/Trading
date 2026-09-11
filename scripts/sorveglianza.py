#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SORVEGLIANZA — il brief su cui la Routine oraria decide se svegliare il CEO.

═══ COSA FA, E SOPRATTUTTO COSA NON FA ══════════════════════════════════════════════════════
Questo script **SELEZIONA, non classifica**. Fa la parte deterministica — la finestra
temporale, l'attribuzione, la freschezza, il movimento misurato sull'ampiezza del titolo, le
soglie — e lascia al modello che lo legge l'unica parte che e' giudizio: *questa notizia cambia
la tesi di QUESTO libro?*

La divisione non e' estetica. Un elenco di parole chiave che decide "importante / non
importante" e' il registro fisso che in questo progetto e' gia' costato piu' volte (C10, red
team I6, MACRO_CARD_BY_PANEL che copriva 7 pannelli su 37): invecchia da solo e in silenzio.
Misurato sul feed vero: 72 voci per-titolo e 18 macro per run, in larghissima parte commento e
non evento. Nessuna lista di parole separa "Oracle Q1 2027 Earnings Call Transcript" da
"Forget the Capex Fears: Why Alphabet and Amazon Are Must-Buys". Un modello che legge le voci
FRESCHE, che sono poche, si'.

═══ LA DEDUPLICA E' LA FINESTRA, E NON SERVE NESSUNO STATO ══════════════════════════════════
La Routine accende una sessione NUOVA a ogni scatto: non c'e' memoria fra un'ora e l'altra, e
scrivere uno stato nel repo vorrebbe dire far committare una sessione autonoma su `main`, che
e' la produzione. Quindi una voce entra nel brief **una volta sola**, l'ora in cui e' dentro la
finestra, e all'ora dopo ne e' fuori da se'.

⚠ Per la stessa ragione i **prezzi** non stanno nel brief orario: `change_pct` e' la variazione
dalla chiusura precedente, quindi resterebbe sopra soglia per tutta la giornata e suonerebbe a
ogni scatto. *Un avviso che suona sempre non avvisa* (v421, v427). Il movimento si guarda con
`--chiusura`, che la Routine passa solo allo scatto dopo la campana.

═══ LE SOGLIE SONO CONVENZIONI, E LO DICHIARANO (v240) ══════════════════════════════════════
Nel file non esiste nessun limite di movimento, nessuna soglia di spread. Ogni numero qui sotto
viene dal mestiere, non dai dati, e la riga che lo stampa lo scrive.

uso:  python3 scripts/sorveglianza.py                    → brief orario (eventi)
      python3 scripts/sorveglianza.py --chiusura         → + movimenti, trimestrali, credito
      python3 scripts/sorveglianza.py --finestra 180     → finestra piu' larga
      python3 scripts/sorveglianza.py --adesso 2026-09-11T15:30:00Z   → orologio iniettato
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── SOGLIE: tutte CONVENZIONI DEL MESTIERE, nessuna viene dal file ───────────────────────────
FINESTRA_MIN = 70      # minuti: lo scatto e' orario, 70 copre il giro senza far ripassare una voce
SOGLIA_ATR = 2.0       # movimento oltre 2x l'ampiezza tipica DEL TITOLO (non una percentuale
                       # uguale per tutti: MU ha ATR 5,3% e NVDA 3,1%, una soglia fissa
                       # segnalerebbe sempre lo stesso nome — lezione v210)
SOGLIA_HY = 4.00       # % HY OAS: la soglia di tensione che il pacchetto usa gia'
GIORNI_TRIM = 2        # trimestrale entro due giorni
ETA_GUASTO_H = 24      # oltre, data.json e' un guasto della pipeline, non un ritardo

# ⚠ MARCATORI, NON FILTRI. Servono a far vedere al lettore attraverso quale canale misurato una
# voce macro potrebbe toccare questo libro. Una voce che non prende nessun marcatore resta nel
# brief: marcare e' un aiuto alla lettura, escludere sarebbe una decisione presa qui.
CANALI = [
    ("tassi/Fed", ("fed ", "fed'", "federal reserve", "fomc", "powell", "rate hike", "rate cut",
                   "interest rate", "treasur", "yield", "mortgage")),
    ("inflazione", ("cpi", "inflation", "ppi", "pce", "wholesale price", "consumer price")),
    ("credito", ("credit", "spread", "high-yield", "high yield", "junk bond", "default",
                 "lending", "debt")),
    ("semi/export", ("chip", "semiconductor", "export control", "tariff", "china", "taiwan")),
    ("energia", ("oil", "crude", "diesel", "opec", "gasoline")),
    ("AI/datacenter", ("data center", "datacenter", "openai", "capex", "artificial intelligence")),
]

# ⚠ Portano il peso le parole che sono il PRIMO token di un nome del libro — oggi `strategy`
# (MSTR e' `Strategy Inc`), `advanced` (AMD), `western` (WDC), `valore` (il BTP). Le altre non
# cambiano nulla su questo libro e restano come copertura per un nome futuro: `energy` non fa
# niente su `Bloom Energy` perche' "Bloom" viene prima, ne farebbe su un `Energy Transfer`.
# ⚠ PAROLE CHE NON POSSONO FARE DA NOME. Non e' un elenco di titoli (quello invecchierebbe a
# ogni posizione nuova): e' un elenco di parole INGLESI GENERICHE, che cambia molto piu'
# lentamente del libro. Serve perche' il nome della societa' spesso ne contiene una e quella
# parola compare ovunque: `Strategy Inc` (MSTR) accenderebbe il marcatore su ogni titolo che
# parla di una strategia, e `Bloom Energy` lo ha davvero acceso su "PBF Energy and Lennar...".
GENERICHE = {"inc", "inc.", "corp", "corp.", "corporation", "company", "co", "co.", "the",
             "ltd", "ltd.", "plc", "holdings", "group", "technologies", "technology",
             "strategy", "energy", "digital", "advanced", "western", "micro", "systems",
             "solutions", "computing", "semiconductor", "international", "industries",
             "labs", "devices", "valore"}


def _dati():
    return json.loads((ROOT / "data" / "data.json").read_text(encoding="utf-8"))


def _posizioni():
    """Dalla FONTE, non dallo snapshot — stessa regola di analisi_libro.py: se la pipeline
    muore, il libro resta quello vero.

    ⚠ Di questo file si usa SOLO l'elenco dei simboli, mai le quantita': dall'08/09/2026 la
    fonte di verita' delle quantita' e' `memoria/LIBRO.md`, e `posizioni.json` puo' essere
    indietro. Per decidere in quali feed guardare serve l'insieme dei nomi, che e' lo stesso
    nei due file — e l'eta' del file si stampa comunque nel brief, perche' chi legge la veda."""
    p = json.loads((ROOT / "config" / "posizioni.json").read_text(encoding="utf-8"))
    return [str(r.get("ticker")) for r in p.get("posizioni", []) if r.get("ticker")], \
        p.get("aggiornato")


def _ts(s):
    """⚠ Le date del feed sono UTC: `letto_il` esce con la Z e nessuna voce e' posteriore a
    quella. L'assunzione e' dichiarata qui invece di essere sepolta nel confronto."""
    if not s:
        return None
    t = str(s).strip().replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(t)
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _ore(da, a):
    if da is None or a is None:
        return None
    return (a - da).total_seconds() / 3600.0


def _num(x):
    try:
        v = float(x)
        return v if v == v and abs(v) != float("inf") else None
    except (TypeError, ValueError):
        return None


def _pct(v, cifre=2):
    """Una sola resa per le percentuali, con la virgola: due formattazioni della stessa
    grandezza divergono al primo ritocco (v421, v442, v443)."""
    n = _num(v)
    if n is None:
        return "n.d."
    return f"{n:.{cifre}f}".replace(".", ",") + "%"


def nomi_citati(titolo, righe):
    """Quali nomi DEL LIBRO compaiono nel titolo dell'articolo.

    ⚠⚠ E' la ragione per cui il blocco vale il suo costo (v398): il modello che cerca online
    conosce il titolo che analizza e NON conosce il libro. Una voce trovata nel feed di MRVL
    che nomina NVDA riguarda anche quella posizione, e quel collegamento lo puo' fare solo chi
    ha il libro davanti.

    ⚠ Il confronto sul ticker e' SENSIBILE AL MAIUSCOLO di proposito: `BE` e `MU` sono parole
    inglesi comuni in minuscolo, e un ancoraggio aperto qui produrrebbe un marcatore acceso su
    ogni titolo (la trappola gia' pagata con mg-card/mg-card-head e calendario_uscite)."""
    t = str(titolo or "")
    tb = t.lower()
    fuori = []
    for tk, nome in righe.items():
        if re.search(r"(?<![A-Za-z0-9])" + re.escape(tk) + r"(?![A-Za-z0-9])", t):
            fuori.append(tk)
            continue
        # ⚠ SI PROVA SOLO IL PRIMO token utile, non tutti: provandoli tutti, `Bloom Energy`
        # trovava "Energy" in "PBF Energy and Lennar..." e marcava BE su una notizia di un'altra
        # societa'. Il nome distintivo e' il primo; quelli dopo sono il settore.
        tok = next((t for t in re.split(r"[^A-Za-z]+", str(nome or ""))
                    if len(t) >= 4 and t.lower() not in GENERICHE), None)
        if tok and tok.lower() in tb:
            fuori.append(tk)
    return sorted(set(fuori))


def canali(titolo):
    t = str(titolo or "").lower()
    return [n for n, chiavi in CANALI if any(k in t for k in chiavi)]


def raccogli(d, adesso, finestra_min, tickers):
    """Tutto cio' che il brief mostra, gia' selezionato. Nessuna stampa qui dentro."""
    righe = {}
    for r in (d.get("portfolio") or []) + (d.get("watchlist") or []):
        tk = str(r.get("ticker") or "")
        if tk in tickers:
            righe[tk] = r

    limite = adesso - timedelta(minutes=finestra_min)
    nomi = {tk: (r.get("name") or "") for tk, r in righe.items()}

    # ── notizie sui titoli del libro ────────────────────────────────────────────────────────
    nt = d.get("news_titoli") or {}
    per_tk = nt.get("per_titolo") or {}
    titoli = []
    visti = {}
    for tk in sorted(per_tk):
        if tk not in tickers:
            continue
        for v in per_tk[tk] or []:
            q = _ts(v.get("quando"))
            if q is None or q < limite:
                continue
            chiave = str(v.get("titolo") or "")
            # ⚠ Lo stesso pezzo compare nei feed di piu' titoli, e in QUANTI compare e' a sua
            # volta informazione: una voce in un feed solo e' una notizia sul nome, una in otto
            # e' una cronaca di mercato. Tenerne una e buttare le altre perderebbe la
            # differenza, che e' quella che decide se serve svegliare qualcuno.
            if chiave in visti:
                visti[chiave]["feed"].append(tk)
                continue
            voce = {"quando": q, "feed": [tk], "fonte": v.get("fonte"), "titolo": chiave,
                    "url": v.get("url"), "cita": nomi_citati(chiave, nomi)}
            visti[chiave] = voce
            titoli.append(voce)
    titoli.sort(key=lambda x: x["quando"], reverse=True)

    # ── notizie macro ───────────────────────────────────────────────────────────────────────
    mn = (d.get("macro") or {}).get("news") or {}
    macro = []
    for v in mn.get("voci") or []:
        q = _ts(v.get("quando"))
        if q is None or q < limite:
            continue
        macro.append({
            "quando": q, "fonte": v.get("fonte"), "titolo": v.get("titolo"),
            "url": v.get("url"), "canali": canali(v.get("titolo")),
            "cita": nomi_citati(v.get("titolo"), nomi),
        })
    macro.sort(key=lambda x: x["quando"], reverse=True)

    # ── movimenti: solo con --chiusura, e la ragione sta nella docstring ────────────────────
    # ⚠⚠ DUE GRANDEZZE, NON UNA. La variazione da chiusura a chiusura non vede la seduta in cui
    #   il prezzo va lontano e torna: misurato sul libro dell'11/09, ORCL ha percorso il 10,1%
    #   fra minimo e massimo — DUE VOLTE la propria ampiezza, dopo la trimestrale — e ha chiuso
    #   a +0,04%. Con la sola variazione quel giorno il brief sarebbe stato muto sull'unico nome
    #   che aveva avuto una giornata. L'escursione e' la seconda meta' della stessa domanda.
    #   ⚠ E non e' una soglia che suona sempre: misurata sulle 13 posizioni di quel giorno, la
    #   supera UNA (ORCL), mentre la variazione non ne prende nessuna.
    moss = []
    for tk, r in righe.items():
        ch, atr = _num(r.get("change_pct")), _num(r.get("atr_pct"))
        if ch is None or not atr:
            continue
        hi, lo, px = _num(r.get("day_high")), _num(r.get("day_low")), _num(r.get("price"))
        esc = ((hi - lo) / px * 100) if (hi is not None and lo is not None and px) else None
        rap = abs(ch) / atr
        rap_esc = (esc / atr) if esc is not None else None
        if rap >= SOGLIA_ATR or (rap_esc is not None and rap_esc >= SOGLIA_ATR):
            moss.append({"tk": tk, "var": ch, "atr": atr, "rap": rap, "esc": esc,
                         "rap_esc": rap_esc, "rischio": _num(r.get("risk_contrib_pct"))})
    moss.sort(key=lambda x: -max(x["rap"], x["rap_esc"] or 0))

    # ── trimestrali ─────────────────────────────────────────────────────────────────────────
    trim = []
    oggi = adesso.date()
    for tk, r in righe.items():
        ed = str(r.get("earnings_date") or "")[:10]
        try:
            g = (datetime.strptime(ed, "%Y-%m-%d").date() - oggi).days
        except ValueError:
            continue
        if 0 <= g <= GIORNI_TRIM:
            trim.append({"tk": tk, "data": ed, "giorni": g})
    trim.sort(key=lambda x: x["giorni"])

    # ── credito e FOMC ──────────────────────────────────────────────────────────────────────
    m = d.get("macro") or {}
    hy = _num((m.get("credit") or {}).get("spread_hy"))
    fw = m.get("fedwatch") or {}
    riun = None
    for mt in fw.get("meetings") or []:
        dt = str(mt.get("date") or "")[:10]
        try:
            g = (datetime.strptime(dt, "%Y-%m-%d").date() - oggi).days
        except ValueError:
            continue
        if g >= 0:
            riun = {"data": dt, "giorni": g, "mosse": _num(mt.get("mosse_25bp")),
                    "prezzata": bool(mt.get("prezzata_dal_contratto"))}
            break

    # ── freschezza, e i tre esiti distinti delle fonti (v389, v421) ─────────────────────────
    return {
        "eta_dati_h": _ore(_ts(d.get("updated_at")), adesso),
        "updated_at": d.get("updated_at"),
        "letto_il": nt.get("letto_il"),
        "feed_non_letti": nt.get("non_letti") or [],
        "feed_senza_voci": nt.get("senza_notizie") or [],
        "feed_assente": not bool(per_tk),
        "macro_assente": not bool(mn),
        "macro_fonti": mn.get("fonti") or [],
        "macro_mute": mn.get("fonti_mute") or [],
        "macro_non_lette": mn.get("fonti_non_lette") or [],
        "feed_letti": len([t for t in per_tk if t in tickers]),
        "titoli": titoli, "macro": macro, "movimenti": moss, "trimestrali": trim,
        "hy": hy, "riunione": riun, "righe": righe,
    }


def stampa(b, adesso, finestra_min, chiusura, pos_al):
    L = []
    a = L.append
    a(f"=== SORVEGLIANZA LIBRO — {adesso.strftime('%Y-%m-%d %H:%M')} UTC ===")

    eta = b["eta_dati_h"]
    if eta is None:
        a("ETA DATI: NON CALCOLABILE (updated_at illeggibile) — tratta i numeri come non datati")
    elif eta > ETA_GUASTO_H:
        a(f"⚠⚠ PIPELINE FERMA: data.json di {eta:.1f} ore fa ({b['updated_at']}), oltre le "
          f"{ETA_GUASTO_H} di convenzione. I prezzi qui sotto NON sono quelli di adesso.")
    else:
        a(f"ETA DATI: data.json di {eta:.1f} ore fa ({b['updated_at']})")
    a(f"POSIZIONI: config/posizioni.json al {pos_al} (nessuno lo aggiorna da solo)")

    # ── stato delle fonti: "muta" e "non letta" si leggono uguali e significano l'opposto ────
    if b["feed_assente"]:
        a("⚠ FEED PER-TITOLO: ASSENTE dallo snapshot — non e' 'nessuna notizia', e' una misura "
          "che manca.")
    else:
        p = []
        if b["feed_non_letti"]:
            p.append("NON letti (la fonte non ha risposto): " + ", ".join(b["feed_non_letti"]))
        if b["feed_senza_voci"]:
            p.append("letti e senza voci: " + ", ".join(b["feed_senza_voci"]))
        a("FEED PER-TITOLO: raccolto il " + str(b["letto_il"]) +
          (" · " + " · ".join(p) if p else " · tutti i feed hanno risposto con voci"))
    if b["macro_assente"]:
        a("⚠ FEED MACRO: ASSENTE dallo snapshot — dato mancante, non assenza di notizie.")
    else:
        p = [f"fonti: {', '.join(b['macro_fonti'])}"]
        if b["macro_non_lette"]:
            p.append("NON lette: " + ", ".join(b["macro_non_lette"]))
        if b["macro_mute"]:
            p.append("lette e mute: " + ", ".join(b["macro_mute"]))
        a("FEED MACRO: " + " · ".join(p))

    a("")
    a(f"--- NOTIZIE SUI NOMI DEL LIBRO, ultimi {finestra_min} minuti "
      f"({len(b['titoli'])} voci) ---")
    a("⚠ [TK] dice IN QUALE FEED la voce e' stata trovata, non che parli di quel titolo: i feed "
      "dei fornitori includono pezzi su concorrenti e sul comparto. 'cita:' elenca i nomi del "
      "libro che compaiono nel TITOLO dell'articolo.")
    if not b["titoli"]:
        a("(nessuna voce nuova nella finestra)")
    for v in b["titoli"]:
        c = (" · cita: " + ", ".join(v["cita"])) if v["cita"] else ""
        n = len(v["feed"])
        f = ",".join(v["feed"]) + (f" — in {n} feed su {b['feed_letti']}" if n > 1 else "")
        a(f"  {v['quando'].strftime('%H:%M')} [{f}] {v['titolo']}{c}")
        if v.get("url"):
            a(f"      {v['url']}")

    a("")
    a(f"--- MACRO, ultimi {finestra_min} minuti ({len(b['macro'])} voci) ---")
    a("⚠ I canali fra parentesi quadre sono una CONVENZIONE DI LETTURA scritta qui, non una "
      "classificazione della fonte: dicono attraverso quale canale misurato la voce POTREBBE "
      "toccare il libro. Una voce senza canale resta in elenco.")
    if not b["macro"]:
        a("(nessuna voce nuova nella finestra)")
    for v in b["macro"]:
        c = (" [" + ", ".join(v["canali"]) + "]") if v["canali"] else ""
        n = (" · cita: " + ", ".join(v["cita"])) if v["cita"] else ""
        a(f"  {v['quando'].strftime('%H:%M')} {v['fonte']}: {v['titolo']}{c}{n}")
        if v.get("url"):
            a(f"      {v['url']}")

    if not chiusura:
        a("")
        a("--- MOVIMENTI, TRIMESTRALI, CREDITO: non in questo scatto ---")
        a(f"La variazione e' quella dalla chiusura precedente: sopra soglia resterebbe tale per "
          f"tutta la seduta e suonerebbe a ogni scatto. Si guardano con --chiusura, dopo la "
          f"campana.")
        return "\n".join(L)

    a("")
    a(f"--- MOVIMENTO OLTRE {SOGLIA_ATR:g}x LA PROPRIA AMPIEZZA ---")
    a(f"⚠ La soglia e' una CONVENZIONE ({SOGLIA_ATR:g} volte l'ATR% del titolo), misurata sul "
      f"titolo e non in percentuale uguale per tutti. 'rischio' e' la quota di varianza che la "
      f"pipeline attribuisce alla posizione: dice se il movimento conta per il libro.")
    if not b["movimenti"]:
        a("(nessuna posizione oltre la propria ampiezza)")
    for v in b["movimenti"]:
        r = f" · {_pct(v['rischio'], 1)} della varianza" if v["rischio"] is not None else \
            " · quota di varianza non pubblicata"
        rap = f"{v['rap']:.1f}".replace(".", ",")
        a(f"  {v['tk']}: chiusura {_pct(v['var'])} contro ATR {_pct(v['atr'])} → {rap}x{r}")
        if v["rap_esc"] is not None and v["rap_esc"] >= SOGLIA_ATR:
            re_ = f"{v['rap_esc']:.1f}".replace(".", ",")
            # ⚠ L'etichetta non afferma una direzione che il dato non porta (v405): un'escursione
            #   ampia che chiude piatta dice che il prezzo e' andato lontano ed e' tornato, non
            #   che e' salito o sceso. Dove invece anche la chiusura supera la soglia, le due
            #   misure concordano e la riga lo scrive: e' un segnale solo, non due prove.
            q = ("ed e' tornato: la chiusura resta dentro la propria ampiezza"
                 if v["rap"] < SOGLIA_ATR else "e la chiusura conferma la direzione")
            a(f"      escursione della seduta {_pct(v['esc'])} → {re_}x l'ampiezza — "
              f"il prezzo e' andato lontano {q}")

    a("")
    a(f"--- TRIMESTRALI ENTRO {GIORNI_TRIM} GIORNI ---")
    if not b["trimestrali"]:
        a("(nessuna)")
    for v in b["trimestrali"]:
        q = "OGGI" if v["giorni"] == 0 else ("DOMANI" if v["giorni"] == 1
                                             else f"fra {v['giorni']} giorni")
        a(f"  {v['tk']}: {q} ({v['data']}) — data ATTESA, non confermata dall'emittente")

    a("")
    if b["hy"] is None:
        a("--- CREDITO: spread HY non pubblicato nello snapshot (misura mancante) ---")
    else:
        st = "OLTRE" if b["hy"] > SOGLIA_HY else "sotto"
        a(f"--- CREDITO: HY OAS {_pct(b['hy'])} — {st} la soglia di tensione {_pct(SOGLIA_HY)} "
          f"(convenzione, non un dato del file) ---")

    r = b["riunione"]
    if not r:
        a("--- FOMC: nessuna riunione futura in elenco ---")
    elif not r["prezzata"]:
        a(f"--- FOMC {r['data']}, fra {r['giorni']} giorni — NON prezzata dal contratto letto "
          f"(il front-month prezza solo il proprio mese) ---")
    else:
        m = r["mosse"]
        a(f"--- FOMC {r['data']}, fra {r['giorni']} giorni — "
          f"{('%.2f' % m).replace('.', ',') if m is not None else 'n.d.'} mosse da 25bp "
          f"implicite (nostro calcolo sul future, NON una probabilita') ---")
    return "\n".join(L)


def main(argv):
    fin = FINESTRA_MIN
    chiusura = "--chiusura" in argv
    adesso = datetime.now(timezone.utc)
    if "--finestra" in argv:
        fin = int(argv[argv.index("--finestra") + 1])
    if "--adesso" in argv:
        adesso = _ts(argv[argv.index("--adesso") + 1]) or adesso
    d = _dati()
    tickers, pos_al = _posizioni()
    b = raccogli(d, adesso, fin, set(tickers))
    print(stampa(b, adesso, fin, chiusura, pos_al))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
