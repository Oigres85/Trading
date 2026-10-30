#!/usr/bin/env python3
"""LA SCHEDA COMPLETA DELL'ANALISI — v505 (decisione del CEO del 19/10/2026, testuale: «B»).

Uso:  python3 scripts/scheda.py --da USCITA_DI_ANALISI.txt [--out FILE.md]
      (di norma la scrive scripts/analisi.py a ogni giro, senza bisogno di chiamarla)

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il 19/10/2026 il CEO, dopo l'«Analisi» del mattino: *"Ho la sensazione che questa analisi si apriva di tante
parti strutturali che ci diceva di inserire, ma che in realta' non ci sono vengono riportate in questo report"*.
Aveva ragione, ed era misurabile: delle 43 voci del registro delle richieste rese strutturali la risposta ne
portava 16 per intero, 18 ridotte e 9 per niente — VWAP, lettura a 5 anni, P/E, volumi, target e beta, notizie
dei sorvegliati, concorrenti, la variazione annua della leva, il pre-market per nome. Gli strumenti le avevano
calcolate tutte: si perdevano nel RIASSUNTO, cioe' nel solo passaggio che nessun gate guardava. E' la classe
v393 — contato e poi nascosto — nella sua forma piu' larga: ~4.000 righe dette in qualche centinaio.

Le tre strade proposte: A) tutto in chat, B) decisioni e giudizio in chat piu' una scheda completa scritta dallo
script, C) come prima. Il CEO ha scelto la B. Questa e' la scheda:
  · NON ricalcola e NON riassume niente: raccoglie le righe che gli strumenti stampano, PAROLA PER PAROLA, e le
    mette in fila per sezione della risposta e per NOME — tutto cio' che il sistema dice su MU sta sotto MU.
    Una grandezza, un proprietario (v436): il numero lo calcola lo strumento, qui si sposta e basta;
  · ogni riga degli strumenti finisce da qualche parte: un gate lo verifica (conservazione), e le righe che il
    catalogo non sa collocare restano dove sono e si DICHIARANO, invece di sparire;
  · in testa, l'INDICE delle richieste del CEO: per ogni voce del registro di memoria/FORMATO_ANALISI.md la sua
    sezione e quanti nomi la portano oggi. La corrispondenza fra il registro e questo catalogo e' verificata nei
    DUE versi (classe v387, v406): una richiesta nuova senza la sua sezione fa andare rossa la suite, e una voce
    del catalogo che non sta piu' nel registro anche;
  · cio' che uno strumento non ha potuto produrre si dice: strumento fallito, blocco non trovato, richiesta senza
    righe oggi. E scripts/analisi.py esce 1, come per uno strumento che fallisce (v453).
Non costa token: la scrive lo script, e la risposta in chat resta quella delle decisioni e del giudizio.

═══ COME LEGGE LE USCITE ════════════════════════════════════════════════════════════════════
Per ogni strumento un CATALOGO dei blocchi: l'intestazione a colonna 0 (espressione regolare all'inizio della
riga) e la sezione della risposta in cui il blocco va. Le righe dopo un'intestazione appartengono al suo blocco
fino all'intestazione successiva. Dentro un blocco, la riga che apre il blocco di un NOME (un'espressione col
ticker nel gruppo «tk», e il ticker deve essere del libro: posizioni o sorvegliati di memoria/LIBRO.md) porta con
se' le righe piu' rientrate che la seguono:
  · «sposta»: il blocco va nella scheda del nome; nella sezione resta la riga d'apertura come sommario, oppure —
    per i blocchi lunghi senza una riga di sommario utile — un rimando con l'elenco dei nomi;
  · «copia»: la riga resta nella sua tabella (si confronta fra i nomi) e si copia anche nella scheda del nome.
Le righe fatte solo di «=» o «-» sono decorazione, non contenuto: non entrano. Nessun numero viene letto.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
FORMATO = RADICE / "memoria" / "FORMATO_ANALISI.md"
CARTELLA = RADICE / "memoria" / "dati"           # ignorata da git: la scheda non vive nel repo
VERSIONE = 505
TK = r"(?P<tk>[A-Z][A-Z0-9.\-]*)"

# ── le sezioni della risposta, nell'ordine di memoria/FORMATO_ANALISI.md ─────────────────────────────────────
SEZIONI = (
    ("freschezza", "0 · Freschezza dei dati: chi ha servito ogni serie, e l'eta' della pipeline"),     # v511
    ("freschezza_titoli", "0 · Dati per titolo: analisti, FedWatch, CDS, short, depositi SEC e trimestri — la fonte "
                          "letta adesso contro la pipeline, e cosa cercare in rete"),                     # v512
    ("semaforo", "0 · Semaforo d'uscita"),
    ("salvavita", "0 · Salvavita e piano di riduzione"),
    ("attesa", "0bis · Costo dell'attesa e scadenze"),
    ("cambio", "0bis · Cambio euro/dollaro: l'esposizione del libro al dollaro e le operazioni col loro cambio"),  # v516
    ("decisioni", "0bis · Decisioni aperte e rimandate"),
    ("ordini", "0bis · Ordini aperti"),
    ("credito_libro", "0ter · Credito sul libro"),
    ("premarket", "1 · Pre-market o after-hours: il libro e i sorvegliati sul prezzo esteso"),
    ("risultato", "2 · Risultato contro i riferimenti"),
    ("registro", "2 · Registro della performance contro QQQ"),
    ("rischio", "3 · Rischio del libro: volatilità, beta, peso e quota del rischio, stress"),
    ("brief", "4-5 · Brief: chi si è mosso oltre la propria ampiezza, dove sta ogni nome, notizie"),
    ("trimestrali", "5 · Trimestrali dichiarate dalla fonte"),
    ("aste", "5 · Aste del Tesoro USA"),
    ("credito_brief", "5 · Credito nel brief: gli eventi del CDS"),
    ("macro", "5 · Macro: i canali che toccano il libro"),
    ("schede_testa", "5 · Schede del progetto: intestazione e riferimenti"),
    ("cds", "5 · CDS a 5 anni: indici CDX e Repubblica Italiana"),
    ("credito_salute", "5 · Salute del credito: i segnali"),
    ("posizionamento", "5bis · Posizionamento"),
    ("putcall", "5bis · Put/call di mercato"),
    ("scadenze_opzioni", "5bis · Scadenze delle opzioni"),
    ("opzioni", "5bis · Opzioni sulle posizioni"),
    ("gamma", "5bis · Gamma dei dealer"),
    ("dark_pool", "5bis · Dark pool"),
    ("short", "5bis · Vendite allo scoperto: posizioni corte aperte (FINRA)"),
    ("flottante", "5bis · Flottante e diluizione: azioni in circolazione, flottante, rotazione, quotazione"),
    ("cftc", "5bis · Grandi operatori (CFTC)"),
    ("bitcoin", "5bis · Bitcoin dall'ultima chiusura USA"),
    ("indici", "5ter · Indici: S&P 500 e Nasdaq-100"),
    ("concorrenti", "5quater · Concorrenti e quote di mercato"),
    ("tenuta", "6 · Tenuta delle posizioni"),
    ("notizie_posizioni", "6 · Notizie ultimissime delle posizioni e degli ordini"),
    ("candidati", "7 · Rotazione e candidati per settore"),
    ("watchlist", "7 · Watchlist e ingressi"),
    ("fine_anno", "7 · Calendario fiscale di fine anno (da ottobre a gennaio): informazione"),            # v512
    ("notizie_sorvegliati", "7 · Notizie ultimissime dei sorvegliati"),
    ("liquidita", "7e · Piano per la liquidità"),
)
TITOLI = dict(SEZIONI)

# ── i sotto-blocchi della scheda di un nome, nell'ordine in cui si leggono ────────────────────────────────────
TIPI = (
    ("tenuta", "Tenuta, pavimenti, media, VWAP, lettura a 5 anni, struttura — numeri_libro.py"),
    ("watchlist", "Ingresso, pavimenti, VWAP, lettura a 5 anni, struttura, volumi, target, tenuta se fosse in "
                  "portafoglio — rotazione.py"),
    ("liquidita", "Piano per la liquidità: cosa fa al libro un'unità di 5.000 € — rotazione.py"),
    ("rischio", "Peso, quota del rischio e risultato del periodo — numeri_libro.py"),
    ("cambio", "Carico in euro, risultato in euro fra prezzo e cambio, imposta in euro — numeri_libro.py"),   # v516
    ("piano_riduzione", "Se scatta il salvavita: il gradino del piano di riduzione — numeri_libro.py"),
    ("premarket", "Prezzo esteso (pre-market o after-hours) — numeri_libro.py --esteso"),
    ("mossi", "Oltre la propria ampiezza nell'ultima seduta — brief.py"),
    ("trimestrale", "Trimestrale dichiarata dalla fonte — brief.py"),
    ("schede", "Canali col loro R², revisioni, valutazione, ricavi, cassa, short, CDS, credito, le due solidità, "
               "Altman, debito — schede_progetto.py"),
    ("concorrenti", "Concorrenti e quote di mercato — concorrenti.py"),
    ("opzioni", "Opzioni — posizionamento.py"),
    ("gamma", "Gamma dei dealer — posizionamento.py"),
    ("dark_pool", "Dark pool — posizionamento.py"),
    ("notizie", "Notizie ultimissime (72 ore) — numeri_libro.py e rotazione.py"),
    ("fine_anno", "Calendario fiscale di fine anno: il risultato dell'anno e la capitalizzazione — rotazione.py"),   # v512
)
ETICHETTE_TIPI = dict(TIPI)
BREVI = {"tenuta": "tenuta", "watchlist": "watchlist e ingresso", "liquidita": "piano per la liquidità",
         "rischio": "peso e rischio", "piano_riduzione": "piano di riduzione", "premarket": "prezzo esteso",
         "mossi": "mossi oltre l'ampiezza", "trimestrale": "trimestrale", "schede": "schede del progetto",
         "concorrenti": "concorrenti", "opzioni": "opzioni", "gamma": "gamma dei dealer", "dark_pool": "dark pool",
         "notizie": "notizie", "fine_anno": "fine anno", "cambio": "cambio euro/dollaro"}


@dataclass(frozen=True)
class Nome:
    """La riga che apre il blocco di un nome: espressione col ticker nel gruppo «tk», cercata all'inizio della
    riga. modo «sposta» o «copia»; sommario: nella sezione resta la riga d'apertura (solo per «sposta»)."""
    regex: str
    tipo: str
    modo: str = "sposta"
    sommario: bool = True


@dataclass(frozen=True)
class Blocco:
    """Un'intestazione a colonna 0 (espressione all'inizio della riga) e la sezione in cui va il suo blocco."""
    regex: str
    sezione: str
    nomi: tuple = ()


@dataclass(frozen=True)
class Strumento:
    sezione: str                     # dove vanno le righe prima della prima intestazione catalogata
    blocchi: tuple = ()
    nomi_col0: tuple = ()            # nomi che aprono un blocco a colonna 0 (schede, concorrenti)


# ── IL CATALOGO: per ogni strumento, le intestazioni che stampa ───────────────────────────────────────────────
# ⚠ una riga si riconosce dalla parola che SEGUE il ticker, mai dagli spazi che lo incolonnano: numeri_libro scrive
#   f"  {tk:5} …", e un ticker di cinque lettere (GOOGL) ha uno spazio solo dopo di se'
_RIGA_PREZZO = Nome(rf"  {TK} +(?:[0-9]|non quotato)", "premarket", "copia")
CATALOGO = {
    "fonti_dirette": Strumento("freschezza", (Blocco(r"FRESCHEZZA DEI DATI", "freschezza"),)),        # v511
    "fonti_titoli": Strumento("freschezza_titoli", (Blocco(r"DATI PER TITOLO", "freschezza_titoli"),)),  # v512
    "numeri_libro_esteso": Strumento("premarket", (
        Blocco(r"FUORI SESSIONE|POSIZIONI$|RIFERIMENTI$|SORVEGLIATI$", "premarket", (_RIGA_PREZZO,)),
    )),
    "numeri_libro": Strumento("semaforo", (
        Blocco(r"SEMAFORO D'USCITA", "semaforo"),
        Blocco(r"SALVAVITA", "salvavita"),
        Blocco(r"PIANO DI RIDUZIONE", "salvavita", (Nome(rf"  {TK} +vendere ", "piano_riduzione", "copia"),)),
        Blocco(r"Periodo ", "risultato"),
        Blocco(r"REGISTRO DELLA PERFORMANCE", "registro"),
        Blocco(r"Vol [0-9]", "rischio", (Nome(rf"  {TK} +peso ", "rischio", "copia"),)),
        Blocco(r"COSTO DELL'ATTESA", "attesa"),
        Blocco(r"SCADENZE", "attesa"),
        Blocco(r"CAMBIO EURO/DOLLARO", "cambio", (Nome(rf"  {TK} +carico ", "cambio", "copia"),)),        # v516
        Blocco(r"DECISIONI APERTE", "decisioni"),
        Blocco(r"RIMANDATE DI PROPOSITO", "decisioni"),
        Blocco(r"ORDINI APERTI", "ordini"),
        Blocco(r"CREDITO SUL LIBRO", "credito_libro"),
        Blocco(r"TENUTA DELLE POSIZIONI", "tenuta", (Nome(rf"  {TK} +[A-Z]", "tenuta"),)),
        Blocco(r"NOTIZIE ULTIMISSIME", "notizie_posizioni", (Nome(rf"  {TK} — ", "notizie"),)),
    )),
    "brief": Strumento("brief", (
        Blocco(r"BRIEF ", "brief"),
        Blocco(r"OLTRE LA PROPRIA AMPIEZZA", "brief", (Nome(rf"  {TK} +seduta del ", "mossi", "copia"),)),
        Blocco(r"TRIMESTRALI DICHIARATE", "trimestrali", (Nome(rf"  {TK} +20[0-9][0-9]-", "trimestrale", "copia"),)),
        Blocco(r"ASTE DEL TESORO", "aste"),
        Blocco(r"CREDITO — ", "credito_brief"),
        Blocco(r"DOVE STA OGNI POSIZIONE", "brief"),
        Blocco(r"SORVEGLIATI — ", "brief"),
        Blocco(r"NOTIZIE SUI TUOI NOMI", "brief"),
        Blocco(r"MACRO — ", "macro"),
    )),
    "schede_progetto": Strumento("schede_testa", (
        Blocco(r"Dati del progetto", "schede_testa"),
        Blocco(r"CDS a 5 anni", "cds"),
        Blocco(r"SALUTE DEL CREDITO", "credito_salute"),
        Blocco(r"SEGNALI DEL CREDITO", "credito_salute"),
        Blocco(r"[A-Z][A-Z0-9\-]* \[POSIZIONE, titolo di Stato\]", "cds"),
        Blocco(r"VENDITE ALLO SCOPERTO", "short"),                       # v506
        Blocco(r"FLOTTANTE E DILUIZIONE", "flottante"),                  # v514
    ), nomi_col0=(Nome(rf"{TK} \[(?:POSIZIONE|SORVEGLIATO)\]", "schede", sommario=False),)),
    "rotazione": Strumento("candidati", (
        Blocco(r"CANDIDATI PER SETTORE", "candidati"),
        Blocco(r"WATCHLIST DEL LIBRO", "watchlist", (Nome(rf"   {TK} +[0-9]", "watchlist"),)),
        Blocco(r"CALENDARIO FISCALE DI FINE ANNO", "fine_anno", (Nome(rf"  {TK} — anno ", "fine_anno", "copia"),)),
        Blocco(r"NOTIZIE ULTIMISSIME", "notizie_sorvegliati", (Nome(rf"  {TK} — ", "notizie"),)),
        Blocco(r"PIANO PER LA LIQUIDIT", "liquidita",
               (Nome(rf"    {TK} (?:\((?:watchlist|candidato)[^)]*\) )?[0-9]", "liquidita", "copia"),)),
    )),
    "posizionamento": Strumento("posizionamento", (
        Blocco(r"POSIZIONAMENTO", "posizionamento"),
        Blocco(r"PUT/CALL DI MERCATO", "putcall"),
        Blocco(r"SCADENZE DELLE OPZIONI", "scadenze_opzioni"),
        Blocco(r"OPZIONI SULLE POSIZIONI", "opzioni", (Nome(rf"  {TK} — ", "opzioni"),)),
        Blocco(r"GAMMA DEI DEALER", "gamma", (Nome(rf"  {TK} [0-9]", "gamma", "copia"),)),
        Blocco(r"DARK POOL", "dark_pool", (Nome(rf"  {TK}: DPI", "dark_pool", "copia"),)),
        Blocco(r"GRANDI OPERATORI", "cftc"),
        Blocco(r"BITCOIN", "bitcoin"),
    )),
    "indici": Strumento("indici", (
        Blocco(r"INDICI|VALUTAZIONE|STAGIONE DELLE TRIMESTRALI|VOLATILITA'|SENTIMENT|STAGIONALITA' DEL NASDAQ|CONCENTRAZIONE|"
               r"AMPIEZZA|TENDENZA", "indici"),
    )),
    "concorrenti": Strumento("concorrenti", (
        Blocco(r"CONCORRENTI E QUOTE", "concorrenti"),
        Blocco(r"SENZA REGISTRO", "concorrenti"),
    ), nomi_col0=(Nome(rf"{TK} \[(?:POSIZIONE|SORVEGLIATO)\]", "concorrenti", sommario=False),)),
}


@dataclass(frozen=True)
class Marcatore:
    """Una richiesta che vive DENTRO i blocchi per nome: si contano i nomi il cui blocco di quel tipo ha una riga
    che comincia (dopo il rientro) col testo dato — o lo contiene, con dentro=True. attesi: la popolazione che
    deve portarlo («posizioni», «sorvegliati», «tutti»), o None se dipende dal nome (si conta e basta)."""
    tipo: str
    testo: str | None = None
    attesi: str | None = None
    dentro: bool = False


@dataclass(frozen=True)
class Voce:
    sezioni: tuple = ()
    marcatori: tuple = ()
    righe: tuple = ()                # (sezione, inizio di una riga che deve esserci)
    fasi: tuple | None = None        # solo in queste fasi (pre-market e after-hours per il prezzo esteso)
    regola: str | None = None        # una regola, non un dato: si dice dove si applica
    giudizio: str | None = None      # un giudizio della risposta: la scheda porta i dati, non il giudizio


# ── IL REGISTRO DELLE RICHIESTE DEL CEO, voce per voce: dove stanno nella scheda ─────────────────────────────
# Le chiavi sono quelle di memoria/FORMATO_ANALISI.md («Richieste del CEO rese strutturali»): un gate le confronta
# nei due versi. Una richiesta nuova si aggiunge li' E qui, nello stesso giorno in cui diventa uno strumento.
REGISTRO = {
    "freschezza": Voce(("freschezza",)),                                                             # v511
    "freschezza_titoli": Voce(("freschezza_titoli",)),                                               # v512
    "comunicati": Voce(("freschezza_titoli",), righe=(("freschezza_titoli", "· CONTI DAL COMUNICATO UFFICIALE"),)),  # v513
    "fine_anno": Voce(("fine_anno",)),                                                               # v512
    "semaforo": Voce(("semaforo",)),
    "attesa": Voce(("attesa",)),
    "cambio": Voce(("cambio",)),                                                                       # v516
    "premarket": Voce(("premarket",), (Marcatore("premarket", None, "tutti"),), fasi=("pre-market", "after-hours")),
    "schede": Voce(("schede_testa",), (Marcatore("schede", None, "tutti"),)),
    "credito_libro": Voce(("credito_libro",)),
    "rotazione": Voce(("candidati",)),
    "target_beta": Voce((), (Marcatore("watchlist", "beta S&P 500", "sorvegliati", dentro=True),
                             Marcatore("watchlist", "target", "sorvegliati", dentro=True))),
    "volumi": Voce((), (Marcatore("watchlist", "volumi (0 = minimo dell'anno", "sorvegliati"),)),
    "aste": Voce(("aste",)),
    "ingressi": Voce(("watchlist",), (Marcatore("watchlist", "ingresso:", "sorvegliati"),)),
    "registro": Voce(("risultato", "registro")),
    "conseguenze": Voce(("liquidita",), (Marcatore("liquidita", None, None),)),
    "decisioni": Voce(("decisioni",)),
    "liquidita": Voce(("liquidita",)),
    "memorie": Voce(regola="nessun tetto di peso alle memorie (MU, SK hynix): nessuno strumento ne applica uno, e "
                           "il peso di ciascuna sta nella sezione 3 e nella sua scheda — decisione del CEO del 14/10"),
    "tenuta": Voce(("tenuta",), (Marcatore("tenuta", None, "posizioni"),
                                 Marcatore("watchlist", "tenuta se fosse in portafoglio", "sorvegliati"))),
    "speculativi": Voce((), (Marcatore("watchlist", "speculativo, CONTRO l'evidenza", None, dentro=True),)),
    "media": Voce((), (Marcatore("tenuta", "media (un'unità di calcolo", None),)),
    "salvavita": Voce(("salvavita",)),
    "conflitti": Voce((), (Marcatore("tenuta", "scadenza (LIBRO.md §1sexies", None),)),
    "pavimenti": Voce(("liquidita",), (Marcatore("tenuta", "pavimenti:", "posizioni"),
                                       Marcatore("watchlist", "pavimenti (LIBRO.md §1bis", "sorvegliati"),
                                       Marcatore("tenuta", "media sui pavimenti", None))),
    "ordini": Voce(("ordini",)),
    "conti_emittente": Voce(("attesa", "trimestrali")),
    "ordine_interesse": Voce(("watchlist", "liquidita"),
                             giudizio="l'ordine d'interesse e' un giudizio della risposta in chat (v200: non un "
                                      "punteggio del sistema); qui i dati su cui si fa"),
    "cinque_anni": Voce((), (Marcatore("watchlist", "lettura a 5 anni", "sorvegliati"),
                             Marcatore("tenuta", "lettura a 5 anni", None))),
    "pe": Voce((), (Marcatore("schede", "valutazione:", "tutti"), Marcatore("watchlist", "valutazione:", "sorvegliati"))),
    "struttura": Voce((), (Marcatore("tenuta", "struttura delle oscillazioni", "posizioni"),
                           Marcatore("watchlist", "struttura delle oscillazioni", "sorvegliati"))),
    "notizie": Voce(("notizie_posizioni", "notizie_sorvegliati"), (Marcatore("notizie", None, "tutti"),)),
    "leva": Voce(("semaforo",), righe=(("semaforo", "leva:"),)),
    "opzioni": Voce(("putcall", "scadenze_opzioni", "opzioni"), (Marcatore("opzioni", None, "posizioni"),)),
    "cftc": Voce(("cftc",)),
    "bitcoin": Voce(("bitcoin",)),
    "cds": Voce(("cds",), (Marcatore("schede", "CDS 5 anni", "tutti"),)),
    "dark_pool": Voce(("dark_pool",), (Marcatore("dark_pool", None, None),)),
    "short": Voce(("short",), (Marcatore("schede", "short:", "tutti"),)),                     # v506
    "flottante": Voce(("flottante",), (Marcatore("schede", "flottante:", "tutti"),)),         # v514
    "gamma": Voce(("gamma",), (Marcatore("gamma", None, "posizioni"),)),
    "indici": Voce(("indici",)),
    "fear_greed": Voce(("indici",), righe=(("indici", "Fear & Greed (CNN):"),)),                       # v510
    "vwap": Voce((), (Marcatore("tenuta", "VWAP dai conti", "posizioni"),
                      Marcatore("watchlist", "VWAP dai conti", "sorvegliati"))),
    "segnali_misurati": Voce(("posizionamento",),
                             regola="misurati il 18/10 (LIBRO.md §1ter, scripts/misura_segnali_mercato.py): nessun "
                                    "segnale di posizionamento anticipa i cali piu' del caso — si leggono come "
                                    "termometri dello stress in corso"),
    "credito_salute": Voce(("credito_salute",), (Marcatore("schede", "Altman", "tutti"),
                                                 Marcatore("schede", "debito", "tutti"))),
    "credito_brief": Voce(("credito_brief",)),
    "concorrenti": Voce(("concorrenti",), (Marcatore("concorrenti", None, "posizioni"),)),
    "solidita": Voce((), (Marcatore("schede", "solidita'", "tutti"),)),
    "scheda": Voce(regola="questa scheda: scritta dallo script a ogni giro, con l'indice qui sopra"),
    # v511 — ipervenduto e ipercomprato coi quattro oscillatori, supporto e accumulo contato, stagionalita' del titolo e
    #   del Nasdaq-100 (domanda del CEO del 24/10, «Ok» del 25/10), e il flusso in due tempi
    "ipervenduto": Voce((), (Marcatore("tenuta", "oscillatori", "posizioni"),
                             Marcatore("watchlist", "oscillatori", "sorvegliati"),
                             Marcatore("tenuta", "supporto e accumulo", "posizioni"),
                             Marcatore("watchlist", "supporto e accumulo", "sorvegliati"))),
    "stagionalita": Voce(("indici",), (Marcatore("tenuta", "stagionalita' del titolo", "posizioni"),
                                       Marcatore("watchlist", "stagionalita' del titolo", "sorvegliati")),
                         righe=(("indici", "STAGIONALITA' DEL NASDAQ-100"),)),
    "due_tempi": Voce(regola="l'analisi in due tempi (CEO, 25/10): la risposta chiude con le domande mirate (sezione 8 "
                             "del formato), e il ragionamento sulle risposte si fa in chat — la scheda porta i dati, le "
                             "domande le scrive la risposta"),
}


# ── il registro di FORMATO_ANALISI.md ────────────────────────────────────────────────────────────────────────
TITOLO_REGISTRO = "**Richieste del CEO rese strutturali"
VOCE_FORMATO = re.compile(r"^- `\[([a-z_]+)\]` (.+)$")


def leggi_registro(percorso=FORMATO):
    """[(chiave, testo)] delle voci del registro in FORMATO_ANALISI.md, nell'ordine in cui stanno. Una voce e' una
    riga «- `[chiave]` testo» (le righe che seguono, rientrate, la continuano). None se il registro non c'e'."""
    try:
        testo = Path(percorso).read_text(encoding="utf-8")
    except OSError:
        return None
    i = testo.find(TITOLO_REGISTRO)
    if i < 0:
        return None
    voci = []
    for riga in testo[i:].splitlines()[1:]:
        if riga.startswith("## "):
            break
        m = VOCE_FORMATO.match(riga)
        if m:
            voci.append([m.group(1), m.group(2).strip()])
        elif voci and riga.startswith("  ") and riga.strip():
            voci[-1][1] += " " + riga.strip()
    return [tuple(v) for v in voci]


# ── le uscite degli strumenti ─────────────────────────────────────────────────────────────────────────────────
SEPARATORE = re.compile(r"^════════ (\d+)/(\d+) (.*) — python3 scripts/(\S+)(.*?) · uscita (.+?) · (\d+) s ════════$")


def esiti_da_testo(testo):
    """Gli esiti degli strumenti dall'uscita stampata di scripts/analisi.py (per rifare la scheda da un giro
    salvato, e per i gate). La CHECKLIST in fondo non e' uno strumento: si ferma li'."""
    esiti, cur = [], None
    for riga in testo.splitlines():
        m = SEPARATORE.match(riga)
        if m:
            cur = {"etichetta": m.group(3), "argv": ["python3", m.group(4)] + m.group(5).split(),
                   "codice": 0 if m.group(6) == "0" else m.group(6), "righe": []}
            esiti.append(cur)
            continue
        if riga.startswith("════════ "):
            cur = None
            continue
        if cur is not None:
            cur["righe"].append(riga)
    for e in esiti:
        righe = e.pop("righe")
        if e["codice"] != 0:                       # analisi.py stampa il guasto e l'errore prima dell'uscita
            righe = [r for r in righe if not r.startswith("⚠ STRUMENTO FALLITO")]
        e["uscita"] = "\n".join(righe)
    return esiti


def testa_da_testo(testo):
    """(data e ora italiana, fase) dalla prima riga dell'uscita di analisi.py, o (None, None)."""
    m = re.search(r"ANALISI DEL LIBRO — (\d\d/\d\d/\d{4} \d\d:\d\d) ora italiana .*?fase: ([A-Z\-]+)", testo)
    return (m.group(1), m.group(2).lower()) if m else (None, None)


def chiave_strumento(argv):
    nome = Path(str(argv[1] if len(argv) > 1 else argv[0])).name.replace(".py", "")
    if nome == "numeri_libro" and "--esteso" in [str(a) for a in argv]:
        return "numeri_libro_esteso"
    return nome


def decorativa(riga):
    s = riga.strip()
    return len(s) >= 5 and set(s) <= set("=-")


def rientro(riga):
    return len(riga) - len(riga.lstrip(" "))


def da_intestazione(riga):
    """Una riga a colonna 0 che SEMBRA un'intestazione: le prime due parole in maiuscolo, o la prima di almeno
    cinque lettere. Serve solo a DICHIARARE i blocchi che il catalogo non conosce."""
    parole = riga.split()
    def maiuscola(p, minimo):
        lettere = [c for c in p if c.isalpha()]
        return len(lettere) >= minimo and all(c.isupper() for c in lettere) and all(c.isalpha() or c in "'/&-" for c in p)
    return bool(parole) and (maiuscola(parole[0], 5) or (len(parole) > 1 and maiuscola(parole[0], 2)
                                                        and maiuscola(parole[1], 2)))


@dataclass
class Raccolta:
    sezioni: dict = field(default_factory=dict)        # chiave -> [righe]
    schede: dict = field(default_factory=dict)         # tk -> {tipo: [[righe], ...]}
    rimandi: dict = field(default_factory=dict)        # sezione -> [tk] dei blocchi spostati senza sommario
    fuori_catalogo: list = field(default_factory=list)  # (strumento, riga)
    blocchi_trovati: set = field(default_factory=set)   # (strumento, regex)
    falliti: list = field(default_factory=list)          # (strumento, codice, errore)
    strumenti: list = field(default_factory=list)        # chiavi degli strumenti eseguiti
    gruppi: dict = field(default_factory=dict)          # tk -> il gruppo «■» della watchlist
    righe_lette: int = 0


def _apri_nome(r, tk, nome, riga, sezione):
    blocco = [riga]
    r.schede.setdefault(tk, {}).setdefault(nome.tipo, []).append(blocco)
    if nome.modo == "copia" or nome.sommario:
        r.sezioni.setdefault(sezione, []).append(riga)
    else:
        r.rimandi.setdefault(sezione, [])
        if tk not in r.rimandi[sezione]:
            r.rimandi[sezione].append(tk)
    return blocco


def raccogli(esiti, universo):
    """Le righe di ogni strumento nelle sezioni e nelle schede dei nomi. `universo`: i ticker del libro
    (posizioni e sorvegliati); un nome fuori dal libro resta nella sua sezione."""
    r = Raccolta()
    for e in esiti:
        k = chiave_strumento(e["argv"])
        r.strumenti.append(k)
        if e.get("codice") != 0:
            r.falliti.append((k, e.get("codice"), (e.get("errore") or "").strip()))
        spec = CATALOGO.get(k)
        if spec is None:
            r.fuori_catalogo.append((k, f"(strumento non catalogato: {k} — le sue {len(e.get('uscita', '').splitlines())} "
                                        "righe stanno qui sotto, fuori dalle sezioni)"))
            r.sezioni.setdefault("_fuori", []).extend(x for x in e.get("uscita", "").splitlines()
                                                      if x.strip() and not decorativa(x))
            continue
        sezione, blocco, aperto = spec.sezione, None, None      # aperto = (lista delle righe, rientro, modo, sezione)
        for riga in e.get("uscita", "").splitlines():
            if not riga.strip() or decorativa(riga):
                continue
            r.righe_lette += 1
            ind = rientro(riga)
            if aperto and ind > aperto[1]:
                aperto[0].append(riga)
                if aperto[2] == "copia":
                    r.sezioni.setdefault(aperto[3], []).append(riga)
                continue
            aperto = None
            if ind == 0:
                b = next((b for b in spec.blocchi if re.match(b.regex, riga)), None)
                if b is not None:
                    blocco, sezione = b, b.sezione
                    r.blocchi_trovati.add((k, b.regex))
                    r.sezioni.setdefault(sezione, []).append(riga)
                    continue
            candidati = ([(n, spec.sezione) for n in spec.nomi_col0] if ind == 0 else []) + \
                [(n, sezione) for n in (blocco.nomi if blocco else ())]
            trovato = False
            for nome, dove in candidati:          # i nomi a colonna 0 rimandano dalla sezione dello strumento
                m = re.match(nome.regex, riga)
                if m and m.group("tk") in universo:
                    aperto = (_apri_nome(r, m.group("tk"), nome, riga, dove), ind, nome.modo, dove)
                    if nome.tipo == "watchlist" and sezione in r.sezioni:
                        gruppo = next((x for x in reversed(r.sezioni[sezione]) if x.startswith("■ ")), None)
                        if gruppo:
                            r.gruppi[m.group("tk")] = gruppo[2:].split(" — ")[0].strip()
                    trovato = True
                    break
            if trovato:
                continue
            if ind == 0 and da_intestazione(riga):
                r.fuori_catalogo.append((k, riga))
            r.sezioni.setdefault(sezione, []).append(riga)
    return r


# ── la copertura del registro ─────────────────────────────────────────────────────────────────────────────────
def _riga_ha(riga, testo, dentro):
    s = riga.strip()
    return testo in s if dentro else s.startswith(testo)


def nomi_con(r, m, universo):
    """I nomi il cui blocco di tipo m.tipo porta la richiesta (una riga che comincia col testo, o lo contiene)."""
    out = []
    for tk in universo:
        blocchi = (r.schede.get(tk) or {}).get(m.tipo) or []
        if not blocchi:
            continue
        if m.testo is None or any(_riga_ha(x, m.testo, m.dentro) for b in blocchi for x in b):
            out.append(tk)
    return out


def popolazione(attesi, posizioni, sorvegliati):
    return {"posizioni": list(posizioni), "sorvegliati": list(sorvegliati),
            "tutti": list(posizioni) + list(sorvegliati)}.get(attesi)


def copertura(r, registro, posizioni, sorvegliati, fase=None):
    """Per ogni voce del registro: stato («presente», «parziale», «ASSENTE», «non in questa fase», «regola»,
    «giudizio»), le sezioni, i conteggi per nome e il perche' di cio' che manca."""
    universo = list(posizioni) + list(sorvegliati)
    sez_strumento = {}
    for k, spec in CATALOGO.items():
        for b in spec.blocchi:
            sez_strumento.setdefault(b.sezione, set()).add(k)
        sez_strumento.setdefault(spec.sezione, set()).add(k)
    falliti = {k for k, _, _ in r.falliti}
    out = {}
    for chiave, _testo in registro:
        v = REGISTRO.get(chiave)
        if v is None:
            out[chiave] = {"stato": "ASSENTE", "perche": ["la voce del registro non ha una sezione nel catalogo della scheda"],
                           "conteggi": [], "sezioni": ()}
            continue
        if v.fasi is not None and fase is not None and fase not in v.fasi:
            out[chiave] = {"stato": "non in questa fase", "perche": [f"si calcola in {' e '.join(v.fasi)}; adesso: {fase}"],
                           "conteggi": [], "sezioni": v.sezioni}
            continue
        perche, conteggi, assente, parziale = [], [], False, False
        for s in v.sezioni:
            if not r.sezioni.get(s) and not r.rimandi.get(s):
                strum = sez_strumento.get(s, set())
                if strum & falliti:
                    perche.append(f"«{TITOLI.get(s, s)}»: NON DISPONIBILE — strumento fallito ({', '.join(sorted(strum & falliti))})")
                elif not strum & set(r.strumenti):
                    perche.append(f"«{TITOLI.get(s, s)}»: lo strumento che la produce non e' stato eseguito")
                else:
                    perche.append(f"«{TITOLI.get(s, s)}»: nessuna riga nelle uscite di oggi")
                assente = True
        for s, inizio in v.righe:
            if not any(x.strip().startswith(inizio) for x in r.sezioni.get(s) or []):
                perche.append(f"«{TITOLI.get(s, s)}»: manca la riga «{inizio}…»")
                assente = True
        for m in v.marcatori:
            chi = nomi_con(r, m, universo)
            pop = popolazione(m.attesi, posizioni, sorvegliati)
            etichetta = f"«{BREVI.get(m.tipo, m.tipo)}»"
            cosa = f"«{m.testo}…»" if m.testo else "il blocco"
            if pop is None:
                conteggi.append(f"{cosa} in {etichetta}: {len(chi)} {'nome' if len(chi) == 1 else 'nomi'}"
                                + (f" ({', '.join(chi)})" if 0 < len(chi) <= 12 else ""))
                continue
            mancano = [x for x in pop if x not in chi]
            conteggi.append(f"{cosa} in {etichetta}: {len(pop) - len(mancano)} su {len(pop)}"
                            + (f" — mancano: {', '.join(mancano)}" if mancano else ""))
            if pop and len(mancano) == len(pop):
                assente = True
                perche.append(f"{cosa} in {etichetta}: nessuno dei {len(pop)} nomi attesi lo porta")
            elif mancano:
                parziale = True
        if v.regola and not v.sezioni and not v.marcatori:
            stato = "regola"
        elif assente:
            stato = "ASSENTE"
        elif parziale:
            stato = "parziale"
        elif v.giudizio:
            stato = "giudizio"
        else:
            stato = "presente"
        out[chiave] = {"stato": stato, "perche": perche, "conteggi": conteggi, "sezioni": v.sezioni}
    return out


# ── la resa in Markdown ───────────────────────────────────────────────────────────────────────────────────────
_SPECIALI = re.compile(r"([\\`*_\[\]<>|~$#])")


def md_testo(s):
    """Il testo di una riga, con la sintassi di Markdown resa inerte: un asterisco resta un asterisco, un dollaro
    non apre una formula, una riga che comincia con «1)» non diventa un elenco numerato."""
    s = _SPECIALI.sub(r"\\\1", s.strip())
    s = re.sub(r"^(\d+)([.)])(\s|$)", r"\1\\\2\3", s)
    if s[:1] in "-+" and (len(s) == 1 or s[1] == " "):
        s = "\\" + s
    return s


def md_elenco(righe):
    """Le righe come elenco puntato, il rientro dello strumento come annidamento: il livello e' il rango del
    rientro fra quelli presenti nel blocco (0, 2, 6, 9 → 0, 1, 2, 3)."""
    livelli = sorted({rientro(x) for x in righe})
    rango = {v: i for i, v in enumerate(livelli)}
    return [("  " * rango[rientro(x)]) + "- " + md_testo(x) for x in righe]


def _riassunto_copertura(cop):
    conta = {}
    for c in cop.values():
        conta[c["stato"]] = conta.get(c["stato"], 0) + 1
    ordine = ("presente", "parziale", "giudizio", "regola", "non in questa fase", "ASSENTE")
    return " · ".join(f"{conta[s]} {s}" for s in ordine if conta.get(s))


def rendi(r, registro, cop, posizioni, sorvegliati, quando="", fase=None):
    L = [f"# Scheda completa dell'analisi — {quando}".rstrip(" —"), ""]
    L.append(f"Fase: **{(fase or 'n.d.').upper()}** · strumenti eseguiti: {len(r.strumenti)}, falliti: "
             f"{len(r.falliti)} · righe degli strumenti: {r.righe_lette}, tutte qui sotto — quelle di un nome nella "
             "sua scheda, quelle di mercato nella loro sezione.")
    L.append("")
    L.append("Scritta da `scripts/scheda.py` con le uscite degli strumenti, **parola per parola**: nessun numero è "
             "ricalcolato, riassunto o tolto. Le decisioni e il giudizio stanno nella risposta in chat (decisione del "
             "CEO del 19/10/2026).")
    if r.falliti:
        L.append("")
        for k, c, err in r.falliti:
            L.append(f"> ⚠ **STRUMENTO FALLITO: {k}** (uscita {c}) — le sezioni che ne dipendono sono NON DISPONIBILI. "
                     + md_testo((err.splitlines() or ['nessun messaggio'])[-1]))
    if r.fuori_catalogo:
        L.append("")
        L.append(f"> ⚠ **{len(r.fuori_catalogo)} blocchi che il catalogo della scheda non conosce**: restano dove li "
                 "ha stampati lo strumento, e il catalogo va aggiornato — " + "; ".join(
                     md_testo(f"{k}: {x[:90]}") for k, x in r.fuori_catalogo[:8]))
    L += ["", "## Le richieste del CEO rese strutturali — dove stanno oggi", "",
          f"{len(registro)} voci del registro di `memoria/FORMATO_ANALISI.md`: {_riassunto_copertura(cop)}.", ""]
    for chiave, testo in registro:
        c = cop.get(chiave, {"stato": "ASSENTE", "perche": [], "conteggi": [], "sezioni": ()})
        v = REGISTRO.get(chiave)
        dove = [TITOLI.get(s, s) for s in c["sezioni"]]
        tipi = sorted({m.tipo for m in (v.marcatori if v else ())}, key=lambda t: [x for x, _ in TIPI].index(t)
                      if t in ETICHETTE_TIPI else 99)
        if tipi:
            dove.append("schede per nome: " + ", ".join(BREVI.get(t, t) for t in tipi))
        segno = {"presente": "✅", "parziale": "🟡", "ASSENTE": "❌", "non in questa fase": "⏸", "regola": "📏",
                 "giudizio": "💬"}.get(c["stato"], "•")
        L.append(f"- {segno} **{chiave}** — {md_testo(testo)}")
        L.append(f"  - stato: **{c['stato']}**" + (f" · dove: {md_testo('; '.join(dove))}" if dove else ""))
        for x in c["conteggi"]:
            L.append(f"  - {md_testo(x)}")
        for x in c["perche"]:
            L.append(f"  - ⚠ {md_testo(x)}")
        if v and v.regola:
            L.append(f"  - regola: {md_testo(v.regola)}")
        if v and v.giudizio:
            L.append(f"  - {md_testo(v.giudizio)}")
    L += ["", "## Le sezioni del giorno, nell'ordine della risposta", ""]
    for chiave, titolo in SEZIONI:
        righe, rim = r.sezioni.get(chiave) or [], r.rimandi.get(chiave) or []
        if not righe and not rim:
            continue
        L += [f"### {titolo}", ""]
        L += md_elenco(righe)
        if rim:
            L.append(f"- → il blocco di ciascuno di questi {len(rim)} nomi è nella sua scheda, sotto: {', '.join(rim)}")
        L.append("")
    if r.sezioni.get("_fuori"):
        L += ["### Righe di strumenti fuori catalogo", ""] + md_elenco(r.sezioni["_fuori"]) + [""]
    ordine = _ordine_nomi(r, posizioni, sorvegliati)
    L += ["## Le schede per nome", "",
          f"Posizioni ({len(ordine['posizioni'])}): {', '.join(ordine['posizioni']) or 'nessuna'}.", "",
          f"Sorvegliati ({len(ordine['sorvegliati'])}): {', '.join(ordine['sorvegliati']) or 'nessuno'}.", ""]
    for gruppo, nomi in (("posizioni", ordine["posizioni"]), ("sorvegliati", ordine["sorvegliati"])):
        L += [f"### {'Posizioni' if gruppo == 'posizioni' else 'Sorvegliati'}", ""]
        for tk in nomi:
            sotto = r.gruppi.get(tk)
            L.append(f"#### {tk} — {'in portafoglio' if gruppo == 'posizioni' else 'sorvegliato'}"
                     + (f" · {md_testo(sotto)}" if sotto else ""))
            L.append("")
            blocchi = r.schede.get(tk) or {}
            if not blocchi:
                L += ["- ⚠ nessun blocco su questo nome nelle uscite degli strumenti di oggi", ""]
                continue
            for tipo, etichetta in TIPI:
                for b in blocchi.get(tipo) or []:
                    L += [f"**{md_testo(etichetta)}**", ""] + md_elenco(b) + [""]
    return "\n".join(L).rstrip() + "\n"


def _ordine_nomi(r, posizioni, sorvegliati):
    """L'ordine lo danno gli strumenti, non la scheda (ordinare e' gia' un giudizio, v200): le posizioni come le
    mette in fila la TENUTA, i sorvegliati come li raggruppa la WATCHLIST; chi non compare la' segue, in ordine
    di libro."""
    def come(nomi, tipo):
        visti = [tk for tk in r.schede if tk in nomi and (r.schede[tk].get(tipo))]
        return visti + [tk for tk in nomi if tk not in visti]
    return {"posizioni": come(list(posizioni), "tenuta"), "sorvegliati": come(list(sorvegliati), "watchlist")}


# ── tutto insieme ─────────────────────────────────────────────────────────────────────────────────────────────
def libro():
    """(posizioni azionarie, sorvegliati) da memoria/LIBRO.md, col parser del brief (una regola sola, v161). Il
    BTP non e' un'azione: la sua riga (la Repubblica Italiana) resta nella sezione dei CDS."""
    sys.path.insert(0, str(RADICE / "scripts"))
    import brief
    pos, _cassa, sorv = brief.leggi_libro()
    return [p["tk"] for p in pos if p.get("valuta") == "USD"], [s["tk"] for s in sorv]


def genera(esiti, fase=None, quando="", posizioni=None, sorvegliati=None, percorso_formato=FORMATO):
    """(testo Markdown, copertura, raccolta, registro). Il registro si legge da FORMATO_ANALISI.md: senza, la
    copertura e' vuota e la scheda lo dice."""
    if posizioni is None or sorvegliati is None:
        posizioni, sorvegliati = libro()
    registro = leggi_registro(percorso_formato)
    r = raccogli(esiti, set(posizioni) | set(sorvegliati))
    cop = copertura(r, registro or [], posizioni, sorvegliati, fase)
    testo = rendi(r, registro or [], cop, posizioni, sorvegliati, quando, fase)
    if registro is None:
        testo = testo.replace("## Le richieste del CEO", "> ⚠ REGISTRO DELLE RICHIESTE NON TROVATO in "
                              "memoria/FORMATO_ANALISI.md: la copertura non si misura\n\n## Le richieste del CEO", 1)
    return testo, cop, r, registro


def sommario(cop, r, percorso):
    """Le righe che scripts/analisi.py stampa in fondo: dove sta la scheda e cosa manca. Restituisce (righe,
    codice): 1 se una richiesta e' ASSENTE o il registro non si legge."""
    assenti = [k for k, c in cop.items() if c["stato"] == "ASSENTE"]
    L = [f"SCHEDA COMPLETA (v505, decisione del CEO del 19/10/2026): {percorso}",
         f"   {len(cop)} richieste del registro: {_riassunto_copertura(cop)} · righe degli strumenti: {r.righe_lette}"]
    if not cop:
        L.append("   ⚠ REGISTRO DELLE RICHIESTE NON TROVATO in memoria/FORMATO_ANALISI.md: la copertura non si misura")
    for k in assenti:
        L.append(f"   ⚠ RICHIESTA SENZA RIGHE OGGI: {k} — " + "; ".join(cop[k]["perche"])[:400])
    for k, c in cop.items():
        if c["stato"] == "parziale":
            L.append(f"   🟡 {k}: " + "; ".join(x for x in c["conteggi"] if "mancano" in x)[:400])
    if r.fuori_catalogo:
        L.append(f"   ⚠ {len(r.fuori_catalogo)} blocchi fuori catalogo — aggiornare scripts/scheda.py: "
                 + "; ".join(f"{k}: {x[:70]}" for k, x in r.fuori_catalogo[:5]))
    L.append("   → la scheda si manda al CEO come allegato (SendUserFile), la risposta in chat porta decisioni e giudizio")
    return L, (1 if assenti or not cop else 0)


def percorso_del_giorno(adesso=None):
    adesso = adesso or datetime.now()
    return CARTELLA / f"scheda_analisi_{adesso:%Y-%m-%d_%H%M}.md"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--da", required=True, help="l'uscita stampata di scripts/analisi.py")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    testo = Path(a.da).read_text(encoding="utf-8")
    quando, fase = testa_da_testo(testo)
    md, cop, r, _ = genera(esiti_da_testo(testo), fase=fase, quando=(f"{quando} ora italiana" if quando else ""))
    out = Path(a.out) if a.out else percorso_del_giorno(
        datetime.strptime(quando, "%d/%m/%Y %H:%M") if quando else None)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    righe, codice = sommario(cop, r, out)
    print("\n".join(righe))
    sys.exit(codice)


if __name__ == "__main__":
    main()
