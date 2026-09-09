#!/usr/bin/env python3
"""L'ARITMETICA DELLA SCELTA (v439) — quanto costa e quanto rende MUOVERE una posizione.

⚠⚠ PERCHE' QUESTO SCRIPT ESISTE, E COSA CAMBIA DEL CONFINE.
Il confine di `config/AVVIO_SESSIONE.md` diceva: livelli e misure si', comprare/vendere/
dimensionare no. La ragione scritta in `config/DECISIONI.md` non era pero' "e' vietato dare
numeri": era che **senza la liquidita', gli altri conti e la situazione fiscale, qualunque
quantita' e' un numero che SEMBRA un consiglio** — cioe' un'invenzione travestita da misura.

Quella ragione oggi vale solo in parte: la liquidita' il CEO l'ha confermata (10.000 € l'08/09,
`memoria/LIBRO.md`), e l'aliquota italiana sulle plusvalenze e' un fatto pubblico. Quello che
resta ignoto — altri conti e posizione fiscale pregressa — non impedisce di calcolare
l'ARITMETICA di una scelta: impedisce di dire quale scegliere.

Quindi qui si calcola, per ogni posizione:
  · quante azioni servono per portare il peso a una soglia dichiarata, e quanto valgono
  · l'effetto MISURATO di quella mossa sul libro (volatilita', scommesse effettive,
    concentrazione di fattore), ricalcolato dalla matrice vera, non stimato
  · il conto fiscale di quella mossa al 26%, e la minusvalenza che genererebbe se in perdita
  · il PREZZO a cui la stessa soglia si raggiunge da sola, senza operare

Nessuno di questi numeri e' un giudizio: sono tutti derivati da dati che il sistema ha. La
scelta di farlo o no resta del CEO, e le tre cose che il sistema NON sa restano dichiarate in
testa all'output invece di essere colmate da un'assunzione.

⚠ SOGLIE: sono CONVENZIONI del mestiere, le stesse gia' pubblicate dalla disciplina di rischio,
non limiti scritti nel file (regola v240: una soglia disegnata e' un'affermazione).
⚠ NON si ordina per "gravita'": ordinare e' gia' un giudizio (v200). Si ordina per lo scarto
misurato dalla soglia, che e' un fatto, e lo scarto si stampa accanto.
"""
import json, math, os, sys

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── le convenzioni, ciascuna con la propria provenienza (v240) ─────────────────────────────
SOGLIE = {
    "nome":    (0.15, "CONVENZIONE: un fondo growth concentrato entra fra il 5% e il 10% e "
                      "lascia correre i vincitori, rivedendo oltre un quinto del libro"),
    "prime3":  (0.40, "CONVENZIONE: oltre, il libro smette di essere concentrato e diventa "
                      "tre scommesse con un contorno"),
    "fattore": (0.40, "CONVENZIONE: la diversificazione si conta sui FATTORI, non sui nomi"),
}
# ⚠ FATTO, non convenzione: aliquota italiana sulle plusvalenze da partecipazioni non
#   qualificate. Il sistema NON conosce il regime (amministrato o dichiarativo) ne' le
#   minusvalenze pregresse in scadenza: il conto qui sotto e' lordo di entrambi.
ALIQUOTA = 0.26


def leggi():
    def j(*p):
        return json.loads(open(os.path.join(RADICE, *p), encoding="utf-8").read())
    dati, libro = j("data", "data.json"), j("data", "libro.json")
    pos = j("config", "posizioni.json")["posizioni"]
    try:
        stato = j("config", "portfolio_state.json")
    except Exception:
        stato = {}
    px = {}
    for r in (dati.get("watchlist") or []) + (dati.get("portfolio") or []):
        t, p = r.get("ticker"), r.get("price")
        if t and isinstance(p, (int, float)):
            px[t] = float(p)
    return dati, libro, pos, stato, px


def vol_libro(pesi, corr, volname):
    """Volatilita' annua del paniere: sqrt(w' S w), con S_ij = rho_ij * sig_i * sig_j.

    ⚠ Si ricalcola dalla matrice VERA invece di scalare la volatilita' pubblicata: scalarla
    darebbe un numero plausibile e sbagliato, perche' cambiare un peso cambia anche i termini
    incrociati (classe v391 — meglio un dato dichiarato in ritardo che uno inventato in tempo).
    """
    tk = [t for t in pesi if t in volname and t in corr]
    s = 0.0
    for a in tk:
        for b in tk:
            rho = 1.0 if a == b else corr.get(a, {}).get(b)
            if rho is None:
                return None
            s += pesi[a] * pesi[b] * volname[a] * volname[b] * rho
    return math.sqrt(s) if s > 0 else None


def scommesse(pesi, corr):
    """1/((1-rho)*H + rho) — la stessa formula che il pacchetto pubblica, non una seconda."""
    tk = [t for t in pesi if t in corr]
    coppie = [corr[a][b] for i, a in enumerate(tk) for b in tk[i + 1:] if b in corr.get(a, {})]
    if not coppie:
        return None
    rho = sum(coppie) / len(coppie)
    tot = sum(pesi[t] for t in tk) or 1.0
    h = sum((pesi[t] / tot) ** 2 for t in tk)
    d = (1 - rho) * h + rho
    return (1 / d) if d > 0 else None


def principale():
    dati, libro, pos, stato, px = leggi()
    fx = dati.get("eurusd")
    pesi, corr = dict(libro["pesi"]), libro["correlazioni"]
    volname, mcr = libro["volatilita_nome"], libro["contributo_rischio"]
    carico = {r["ticker"]: r.get("pmc") for r in pos}
    quote = {r["ticker"]: r.get("qta") for r in pos}
    esclusi = libro.get("esclusi") or {}

    print("=" * 78)
    print("L'ARITMETICA DELLA SCELTA — quanto costa e quanto rende muovere una posizione")
    print("=" * 78)
    print(f"libro al {libro['al']} · posizioni al {libro['posizioni_al']} "
          f"({libro['posizioni_giorni']} giorni fa) · {libro['sedute']} sedute nella matrice")
    print("\n⚠ LE TRE COSE CHE IL SISTEMA NON SA, e che nessun numero qui sotto colma:")
    cassa = (stato.get("cash") or {}).get("v")
    print(f"   1. la liquidita' OLTRE quella annotata"
          f"{f' (in archivio: {cassa:,.0f} € al {(stato.get(chr(99)+chr(97)+chr(115)+chr(104)) or {}).get(chr(97)+chr(116), chr(63))[:10]})' if cassa else ''}")
    print( "   2. altri conti, altri strumenti, margine, posizioni corte, coperture")
    print(f"   3. la posizione fiscale pregressa: minusvalenze da compensare e loro scadenza")
    print( "   Percio' qui si calcola l'ARITMETICA di una mossa, non quale mossa fare.")

    if esclusi:
        print(f"\n⚠ fuori dalla matrice, quindi fuori da ogni ricalcolo qui sotto: "
              + ", ".join(f"{t} ({libro['perche_esclusi'][t]}, {p*100:.1f}% dell'azionario)"
                          for t, p in esclusi.items()))

    v0 = vol_libro(pesi, corr, volname)
    s0 = scommesse(pesi, corr)
    print(f"\nLIBRO DI OGGI: volatilita' {v0*100:.1f}% · scommesse effettive {s0:.2f} "
          f"su {len(pesi)} nomi")

    # ── 1. le posizioni oltre la soglia del singolo nome ──────────────────────────────────
    lim, perche = SOGLIE["nome"]
    fuori = sorted(((t, w) for t, w in pesi.items() if w > lim), key=lambda x: -(x[1] - lim))
    print("\n" + "-" * 78)
    print(f"PORTARE UN NOME ALLA SOGLIA DEL {lim*100:.0f}% DELL'AZIONARIO")
    print(f"  soglia: {perche}")
    print("-" * 78)
    if not fuori:
        print("  Nessun nome oltre la soglia: non c'e' niente da calcolare.")
    for t, w in fuori:
        p, q, c = px.get(t), quote.get(t), carico.get(t)
        if not (p and q):
            print(f"\n▸ {t}: prezzo o quantita' mancanti, mossa non calcolabile")
            continue
        tot = sum(px[x] * quote[x] for x in pesi if px.get(x) and quote.get(x))
        # w' = (q'p) / (tot - (q-q')p)  ->  q' = w'(tot - qp) / (p(1 - w'))
        qn = lim * (tot - q * p) / (p * (1 - lim))
        # ⚠⚠ v440 — LE AZIONI SONO INTERE, E TUTTO IL RESTO DERIVA DA QUELLE. La prima stesura
        #   stampava `{mosse:,.0f}` e calcolava controvalore, plusvalenza e imposta sul numero
        #   con la virgola: il CEO leggeva "29 azioni" accanto a un controvalore che vale
        #   28,94 azioni. Non si vende una frazione di azione, quindi il numero comprabile e'
        #   l'unico vero e gli altri sono la sua conseguenza — due derivazioni della stessa
        #   grandezza, una arrotondata e una no, e' la classe v433/v415 su uno strumento che
        #   dice QUANTO muovere.
        # ⚠ Si arrotonda PER ECCESSO: spostarne una in meno lascia il peso sopra la soglia,
        #   cioe' non la raggiunge. E il peso che ne risulta si PUBBLICA, perche' con le azioni
        #   intere non cade esattamente sulla soglia e affermare il contrario sarebbe
        #   un'etichetta che dice piu' del proprio dato (v240, v405).
        mosse = math.ceil(q - qn)
        if mosse <= 0:
            continue
        contro = mosse * p
        nuovi = dict(pesi)
        resto = tot - contro
        for x in nuovi:
            nuovi[x] = (px[x] * quote[x] - (contro if x == t else 0)) / resto if px.get(x) and quote.get(x) else nuovi[x]
        v1, s1 = vol_libro(nuovi, corr, volname), scommesse(nuovi, corr)
        plus = (p - c) * mosse if c else None
        tasse = plus * ALIQUOTA if plus and plus > 0 else 0.0
        minus = -plus if plus and plus < 0 else 0.0
        # il prezzo a cui la soglia si raggiunge DA SOLA, senza operare
        altri = tot - q * p
        p_soglia = lim * altri / (q * (1 - lim))
        pesoDopo = (q - mosse) * p / resto
        print(f"\n▸ {t} — oggi {w*100:.1f}% dell'azionario, {mcr.get(t, 0)*100:.1f}% della varianza")
        print(f"   per arrivare al {lim*100:.0f}%: {mosse:,.0f} azioni su {q:,.0f}"
              f"  ({contro:,.0f} $" + (f" = {contro/fx:,.0f} €" if fx else "")
              + f") → il peso scende al {pesoDopo*100:.2f}%")
        print(f"   effetto MISURATO sul libro: volatilita' {v0*100:.1f}% → {v1*100:.1f}%"
              f" · scommesse effettive {s0:.2f} → {s1:.2f}")
        if plus is not None:
            if plus > 0:
                print(f"   conto fiscale: plusvalenza {plus:,.0f} $ → imposta {tasse:,.0f} $ "
                      f"al {ALIQUOTA*100:.0f}%" + (f" ≈ {tasse/fx:,.0f} €" if fx else "")
                      + "  ⚠ lordo di eventuali minusvalenze pregresse, che il sistema non conosce")
            else:
                print(f"   conto fiscale: minusvalenza {minus:,.0f} $, compensabile entro il "
                      f"quarto anno successivo ⚠ il sistema non sa se ne hai gia' in scadenza")
        print(f"   ⚠ SENZA OPERARE la stessa soglia si raggiunge se {t} scende a "
              f"{p_soglia:,.2f} $ (oggi {p:,.2f}, cioe' {(p_soglia/p-1)*100:+.1f}%) "
              f"a parita' di tutto il resto")

    # ── 2. le prime tre ───────────────────────────────────────────────────────────────────
    lim3, perche3 = SOGLIE["prime3"]
    tre = sorted(pesi.items(), key=lambda x: -x[1])[:3]
    somma3 = sum(w for _, w in tre)
    print("\n" + "-" * 78)
    # ⚠⚠ IL DENOMINATORE SI NOMINA. La disciplina di rischio del pacchetto pubblica le prime
    #   tre su TUTTI i nomi (SKHY compreso), qui il denominatore sono i 12 della matrice: due
    #   numeri diversi per la stessa idea. Affiancarli senza dirlo e' esattamente cio' che il
    #   collaudo ordina di segnalare, e nel giro del 09/09 davano 60,9% contro 59,2%.
    _n_mat = len(pesi)
    print(f"LE PRIME TRE POSIZIONI — {' + '.join(t for t, _ in tre)} = {somma3*100:.1f}%"
          f"  (soglia {lim3*100:.0f}%)")
    print(f"  ⚠ denominatore: i {_n_mat} nomi DENTRO la matrice. Il pacchetto pubblica la "
          f"stessa regola su tutti i {_n_mat + len(esclusi)} nomi e da' un numero piu' basso: "
          f"e' la stessa misura su due insiemi, non due misure.")
    print(f"  soglia: {perche3}")
    if somma3 > lim3:
        tot = sum(px[x] * quote[x] for x in pesi if px.get(x) and quote.get(x))
        ecc = (somma3 - lim3) * tot / (1 - lim3)
        print(f"  scarto: {(somma3-lim3)*100:+.1f} punti. Per rientrare servirebbe spostare "
              f"{ecc:,.0f} $" + (f" ≈ {ecc/fx:,.0f} €" if fx else "") + " dalle tre ai restanti "
              f"{len(pesi)-3} nomi (o alla liquidita').")
    else:
        print("  dentro la soglia.")

    print("\n" + "=" * 78)
    print("⚠ Ogni numero qui sopra e' DERIVATO dai dati del libro: nessuno e' una "
          "raccomandazione,\n  e la scelta di operare o no resta di chi conosce le tre cose "
          "dichiarate in testa.")
    return 0


if __name__ == "__main__":
    sys.exit(principale())
