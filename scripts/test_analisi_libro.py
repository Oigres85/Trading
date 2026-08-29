# -*- coding: utf-8 -*-
"""Test di analisi_libro.py. Nessuna rete: dati sintetici costruiti per far scattare
esattamente le trappole gia' pagate sul campo."""
import math, sys
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analisi_libro as A

FALLITI = []; ESEGUITI = []
def check(nome, ok, extra=""):
    ESEGUITI.append(nome)
    print(("PASS  " if ok else "FAIL  ") + nome + (("\n      ↳ " + extra) if not ok and extra else ""))
    if not ok: FALLITI.append(nome)

rng = np.random.default_rng(7)
idx = pd.bdate_range("2026-01-01", periods=200)

def serie(n, corr=0.4, semi=0):
    """n serie con correlazione approssimativa `corr` fra loro."""
    r = np.random.default_rng(semi)
    comune = r.normal(0, .02, len(idx))
    out = {}
    for i in range(n):
        e = r.normal(0, .02, len(idx))
        out[f"T{i}"] = 100 * np.cumprod(1 + math.sqrt(corr) * comune + math.sqrt(1 - corr) * e)
    return pd.DataFrame(out, index=idx)

# ── 1. le scommesse effettive vedono i pesi ────────────────────────────────────────────
px = serie(6, .4)
tk = list(px.columns)
eq = {t: 1 / len(tk) for t in tk}
conc = {t: (.6 if t == tk[0] else .4 / (len(tk) - 1)) for t in tk}
m_eq = A.misura(tk, px, eq, bench=None)
m_cc = A.misura(tk, px, conc, bench=None)
check("le scommesse effettive scendono se il libro e' concentrato",
      m_cc["eff"] < m_eq["eff"] - .1, f"equipesato {m_eq['eff']:.2f} · concentrato {m_cc['eff']:.2f}")
# ⚠ l'equipeso deve coincidere con la formula classica 1/(1/k + (k-1)/k*rho)
k = len(tk); rho = m_eq["rho"]
classica = 1 / (1 / k + (k - 1) / k * rho)
check("con pesi uguali la formula generale coincide con quella classica",
      abs(m_eq["eff"] - classica) < 1e-9, f"{m_eq['eff']:.6f} vs {classica:.6f}")

# ── 2. un nome con storia corta non deve troncare gli altri ────────────────────────────
px2 = serie(5, .4, semi=3)
px2["CORTO"] = np.nan
px2.loc[px2.index[-30:], "CORTO"] = 100 + np.arange(30)   # solo 30 sedute
lunghi = [t for t in px2.columns if px2[t].notna().sum() >= A.MIN_SEDUTE]
check("il filtro esclude il nome con storia corta", "CORTO" not in lunghi and len(lunghi) == 5)
m2 = A.misura(lunghi, px2, {t: 1 / len(lunghi) for t in lunghi}, bench=None)
check("escludendolo, la finestra resta lunga (non troncata a 30 sedute)",
      m2["sedute"] > 150, f"sedute usate: {m2['sedute']}")

# ── 3. il contributo al rischio somma a 1 ──────────────────────────────────────────────
check("i contributi al rischio sommano a 1", abs(sum(m_cc["contrib"].values()) - 1) < 1e-9,
      f"somma {sum(m_cc['contrib'].values()):.6f}")
check("la posizione piu' pesante porta il contributo maggiore",
      max(m_cc["contrib"], key=m_cc["contrib"].get) == tk[0])

# ── 4. degrada dichiarando, invece di inventare ────────────────────────────────────────
check("senza benchmark la correlazione al ribasso resta n.d. invece di essere stimata male",
      m_eq["eff_giu"] is None and m_eq["sedute_giu"] == 0)

# ── 5. la volatilita' e' annualizzata e plausibile ─────────────────────────────────────
check("la volatilita' e' annualizzata (serie a 2% giornaliero → ~30%)",
      .20 < m_eq["vol"] < .45, f"vol {m_eq['vol']*100:.1f}%")

# ── 5bis. un NaN non deve mai finire nell'uscita pubblicata ────────────────────────────
# ⚠ successo davvero: yfinance ha restituito una colonna vuota per NVDA e ORCL, float(NaN)*qta
#   ha reso NaN il controvalore, poi il totale, poi la quota — e il file conteneva
#   "quota_azionaria": NaN. Un NaN pubblicato e' peggio di un errore: sembra un numero.
check("_n() converte NaN e None in null, non li propaga",
      A._n(float("nan")) is None and A._n(None) is None and A._n("x") is None
      and A._n(0.12345) == 0.1235)
srcA = (Path(__file__).resolve().parent / "analisi_libro.py").read_text(encoding="utf-8")
check("i nomi senza prezzo utilizzabile sono esclusi dal totale, non lo avvelenano",
      "senza_prezzo" in srcA and "non (tot_az == tot_az)".replace("non ", "not ") in srcA)
check("nessun round() nudo nell'uscita compatta: passa tutto da _n()",
      srcA[srcA.index("def compatto("):].count("round(") == 0)

# ── 5ter. l'eta' delle posizioni si dichiara: e' l'unico punto in cui la dashboard resta
#          indispensabile, e un file vecchio produce numeri esatti su un libro che non esiste
check("l'eta' del file delle posizioni entra nell'analisi e nell'uscita compatta",
      "posizioni_giorni" in srcA and "posizioni_al" in srcA
      and srcA.count("posizioni_giorni") >= 3)
check("sopra i 7 giorni la stampa avverte, non si limita a mostrare la data",
      "g > 7" in srcA and "un libro che non hai piu'" in srcA)

# ── 5quater. gli scenari a fattore: un beta senza R² e' mezzo numero ───────────────────
srcS = (Path(__file__).resolve().parent / "scenari.py").read_text(encoding="utf-8")
check("ogni riga di scenario porta il proprio R², non solo il beta",
      'R² {r2:.3f}' in srcS and "R2_MIN" in srcS)
check("uno scenario in cui quasi nessun nome ha un legame misurabile si dichiara inaffidabile",
      "SCENARIO NON AFFIDABILE" in srcS and "peso_buono" in srcS)
check("i nomi con R² basso restano NEL conto, dichiarati: toglierli fingerebbe che non si muovano",
      "il contributo e' comunque incluso" in srcS)

# ── 5quinquies. la seduta incompleta si dichiara, non sparisce ─────────────────────────
# ⚠ trovato da una sessione su telefono: "venerdi' manca anche se il CI ha girato". Il dropna()
#   scarta l'ultima riga se UN SOLO nome non ha ancora la barra, e l'analisi finiva un giorno
#   prima senza dirlo. E' la trappola n.1 applicata alle DATE invece che ai titoli.
check("la seduta scartata perche' incompleta viene dichiarata",
      "sedute_scartate" in srcA and "NON USATA" in srcA)
check("le righe incomplete NON vengono tenute (mischierebbero giorni diversi)",
      "mischierebbe giorni diversi" in srcA and ".dropna()" in srcA)

# ── 5sexies. senza rete si degrada sui valori pubblicati, dichiarandolo ────────────────
check("esiste il degrado su data/libro.json invece della traccia di errore",
      "def da_pubblicato(" in srcA and "NON CALCOLATO ORA" in srcA)
check("il degrado NON ricalcola: rimette i valori pubblicati nella forma di stampa()",
      "Non ricalcola nulla" in srcA)

# ── 5septies. soglie.py: arriva fino al confine e non lo attraversa ────────────────────
srcT = (Path(__file__).resolve().parent / "soglie.py").read_text(encoding="utf-8")
check("le barre vuote si tolgono prima di calcolare i livelli",
      srcT.count('dropna()') >= 3 and "il NaN\n    si propaga" in srcT.replace("\r", ""))
check("ogni livello dichiara da dove viene",
      "convenzione di Fibonacci, non una previsione" in srcT and "resistenza recente" in srcT)
check("esiste la soglia di anomalia, calcolata dalla storia del titolo stesso",
      "SOGLIA DI ANOMALIA" in srcT and "dd_p10" in srcT)
# ⚠ il confine: misure si', imperativi no. Se una di queste parole entra, il file ha cambiato natura.
_VIETATE = ["consiglio di vendere", "ti consiglio", "dovresti vendere", "dovresti comprare",
            "raccomando", "conviene vendere", "conviene comprare", "esci a ", "entra a "]
check("nessun imperativo operativo nel testo prodotto da soglie.py",
      not [v for v in _VIETATE if v in srcT.lower()],
      ", ".join(v for v in _VIETATE if v in srcT.lower()))
check("il file dichiara esplicitamente cosa non fa",
      "NON FA:" in srcT and "non propone quantita'" in srcT)

# ── 5octies. rapporto.py: un comando per tutto il libro ────────────────────────────────
srcR = (Path(__file__).resolve().parent / "rapporto.py").read_text(encoding="utf-8")
check("il rapporto dichiara TRE eta' separate: prezzi, fondamentali, posizioni",
      "prezzi e tecnica:" in srcR and "fondamentali:" in srcR and "posizioni:" in srcR)
check("il rapporto degrada sui valori pubblicati invece di fallire",
      "da_pubblicato()" in srcR and "(Exception, SystemExit)" in srcR)
# ⚠ la prima stesura indovinava i nomi delle chiavi macro e ne stampava tre su otto, in silenzio
check("se legge meno di 4 voci macro lo dichiara, invece di stampare quel che trova",
      "stampate < 4" in srcR and "le chiavi potrebbero essere" in srcR)
check("il rapporto dice che notizie e trimestrali NON sono dentro",
      "si cercano in rete" in srcR)

# ── 5novies. il rapporto arricchito e i grafici ────────────────────────────────────────
srcR2 = (Path(__file__).resolve().parent / "rapporto.py").read_text(encoding="utf-8")
for et in ("CASSA", "DEBITO", "CONTO", "FLUSSO", "SHORT", "CANALI", "STAGION.", "TARGET", "CONSENSO+"):
    check(f"il rapporto pubblica il blocco {et}", et in srcR2)
# ⚠ la chiave era `positivi_pct`, non `pos_pct`: il .get() con default 0 stampava "0% positivi"
#   su medie positive. Un default silenzioso su una chiave sbagliata e' peggio di un KeyError.
check("la stagionalita' usa la chiave vera (positivi_pct), non un default silenzioso",
      "positivi_pct" in srcR2 and "pos_pct" not in srcR2)
# ── 5b. i grafici vengono RACCOLTI dalla dashboard, non ridisegnati (v385) ─────────────
# ⚠⚠ grafici.py disegnava a mano tre SVG in Python mentre la dashboard ha gia' il proprio
#   sistema di grafici in app.js: DUE IMPLEMENTAZIONI DELLA STESSA DOMANDA, la classe che in
#   questo progetto ha gia' fatto divergere usRegularSessionOpen (v161), i rami FedWatch (v207)
#   e la consegna del pacchetto (v316). Ora si raccoglie l'HTML vero della dashboard.
#   I check ESEGUONO lo script sui dati veri invece di leggerne il sorgente: un check ancorato
#   al testo si e' rotto NOVE volte qui dentro.
import subprocess, tempfile
srcG = (Path(__file__).resolve().parent / "grafici.mjs").read_text(encoding="utf-8")
_out = Path(tempfile.gettempdir()) / "test_grafici_raccolti.html"
_r = subprocess.run(["node", str(Path(__file__).resolve().parent / "grafici.mjs"), str(_out)],
                    capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent.parent))
_pag = _out.read_text(encoding="utf-8") if _out.exists() else ""
check("il raccoglitore gira sui dati veri e produce una pagina", _r.returncode == 0 and len(_pag) > 5000,
      f"exit {_r.returncode}, {len(_pag)} byte · {_r.stderr[:120]}")
check("la pagina porta grafici VERI presi dalla dashboard, non segnaposto",
      _pag.count("<svg") >= 3 and 'data-da="#' in _pag, f"{_pag.count(chr(60)+'svg')} svg")
# ⚠ v233: si estraggono <svg> E <table> — le tabelle sono l'analisi finanziaria e di rischio
check("si raccolgono anche le tabelle, non solo i grafici", _pag.count("<table") >= 1)
check("la pagina dei grafici funziona in tema chiaro e scuro",
      "prefers-color-scheme: dark" in srcG and "data-theme=dark" in srcG)
check("ogni pagina di grafici porta la propria data e i propri avvisi",
      "snapshot pipeline" in _pag and "matrice al" in _pag and "posizioni al" in _pag)
check("la pagina dichiara che i grafici sono RACCOLTI e non ridisegnati",
      "RACCOLTI dalla dashboard" in _pag)
# ⚠ NIENTE REGISTRO DI ID SCRITTO A MANO: un elenco fisso di bersagli invecchia da solo e in
#   silenzio (C10, red team I6, MACRO_CARD_BY_PANEL che copriva 7 pannelli su 37).
check("le funzioni da eseguire si RICAVANO dal sorgente, non sono elencate a mano",
      "src.matchAll" in srcG and "function\\s+(render" in srcG)
# ⚠ un allarme sempre acceso e' un allarme che nessuno legge: cripto e cambi hanno
#   legittimamente una seduta diversa dalle azioni ogni fine settimana (classe C14)
check("l'avviso sulle sedute diverse esclude cripto e cambi, che hanno un altro calendario",
      "calendarioUSA" in srcG and "-USD$|=X$" in srcG)
# ⚠ una pagina senza grafici NON e' un successo: uscire 0 sarebbe "verde per assenza"
check("senza grafici raccolti lo script esce 1 invece di fingere un successo",
      "if (!blocchi.length) process.exit(1)" in srcG)
check("il raccoglitore non disegna: nessun SVG scritto a mano nel sorgente",
      "<svg viewBox" not in srcG)
_out.unlink(missing_ok=True)

# ── 6. le posizioni si leggono dalla FONTE, non dallo snapshot della pipeline ──────────
src = (Path(__file__).resolve().parent / "analisi_libro.py").read_text(encoding="utf-8")
check("le posizioni vengono da config/posizioni.json, non da data/data.json",
      "config\" / \"posizioni.json" in src and "data.json" not in src)
check("la soglia di esclusione e' dichiarata come costante, non sparsa nel codice",
      "MIN_SEDUTE = " in src and src.count("MIN_SEDUTE") >= 2)
# ⚠ yfinance e' la dipendenza unica di questa strada e oggi ha restituito colonne vuote su due
#   chiamate a un minuto di distanza: senza ritentativo il libro cambia forma per fortuna.
check("il download ritenta prima di arrendersi a una colonna vuota",
      "for tentativo in range(" in src and "ritento" in src)

# ── 7. il prezzo piu' fresco vince, e l'altro si dichiara (v382) ───────────────────────
# ⚠ Nato dal 29/08/2026: libro.json fermo al 27/08 (dropna listwise: 12 nomi senza barra il 28)
#   mentre data.json, gia' aperto dal rapporto per i fondamentali, portava il 28. MRVL era sceso
#   del 10,3% in mezzo. I check sono sulle PROPRIETA' delle due funzioni pure, non su stringhe
#   del sorgente: un check ancorato al testo si e' rotto sette volte in questo progetto.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import rapporto as RP

# ⚠⚠ v383 — SI CONFRONTANO LE SEDUTE, NON GLI OROLOGI. La prima stesura confrontava
#   `updated_at` (quando la pipeline ha girato) con la seduta di libro.json, ed era sbagliata:
#   il 29/08/2026 due run hanno ripubblicato il 27 dopo che quattro avevano il 28, quindi uno
#   snapshot con l'orologio piu' avanti portava una seduta piu' INDIETRO.
VEN = {"price": 216.62, "price_asof": "2026-08-28"}     # MRVL venerdi', dopo la trimestrale
GIO = {"price": 241.45, "price_asof": "2026-08-27"}     # MRVL giovedi'

p, sed, sc, arr = RP.prezzo_da_usare(241.45, VEN, "2026-08-27")
check("una seduta piu' recente nello snapshot vince, e la sua data viene dichiarata",
      p == 216.62 and sed == "2026-08-28" and arr is False)
check("lo scarto dichiarato e' quello vero fra le due fonti",
      sc is not None and abs(sc - (216.62 / 241.45 - 1) * 100) < 1e-9, f"scarto {sc}")
check("uno scarto oltre soglia su un caso reale viene segnalato",
      abs(sc) > RP.SCARTO_PREZZO, f"{sc:.2f}% contro soglia {RP.SCARTO_PREZZO}")

# ⚠ IL CASO CHE L'OROLOGIO SBAGLIAVA: snapshot generato DOPO ma su una seduta PRECEDENTE
p2, sed2, sc2, arr2 = RP.prezzo_da_usare(216.62, GIO, "2026-08-28")
check("uno snapshot ARRETRATO non spodesta libro.json e viene segnalato come tale",
      p2 == 216.62 and sed2 == "2026-08-28" and sc2 is None and arr2 is True)

p3, _, sc3, arr3 = RP.prezzo_da_usare(241.45, GIO, "2026-08-27")
check("sulla STESSA seduta non si cambia fonte e non si dichiara nessuno scarto",
      p3 == 241.45 and sc3 is None and arr3 is False)

# ⚠ price_asof e' None sui LIVE override (cripto, futures, indici esteri): senza data non si
#   confronta niente, e si resta sulla fonte dichiarata invece di indovinare.
for descr, riga in (("senza price_asof", {"price": 216.62}),
                    ("con price_asof nullo", {"price": 216.62, "price_asof": None}),
                    ("senza prezzo", {"price_asof": "2026-08-28"})):
    p4, _, sc4, arr4 = RP.prezzo_da_usare(241.45, riga, "2026-08-27")
    check(f"una riga {descr} non spodesta libro.json ne' inventa uno scarto",
          p4 == 241.45 and sc4 is None and arr4 is False)
check("senza la seduta di libro.json non si sceglie e non si segnala",
      RP.prezzo_da_usare(241.45, VEN, None) == (241.45, None, None, False))

# ⚠ MU si e' mosso dello 0,27%: sotto soglia, la riga NON deve sporcare il rapporto
_, _, sc5, _ = RP.prezzo_da_usare(935.39, {"price": 932.86, "price_asof": "2026-08-28"}, "2026-08-27")
check("uno scarto sotto soglia resta calcolato ma non supera la soglia di segnalazione",
      sc5 is not None and abs(sc5) < RP.SCARTO_PREZZO, f"{sc5:.2f}%")

# ⚠ OTTAVA volta in questo progetto che un check ancorato a una STRINGA del sorgente si rompe:
#   la prima stesura pretendeva che "updated_at" non comparisse dopo prezzo_da_usare, ma quel
#   campo serve legittimamente altrove (l'eta' dei fondamentali). La proprieta' vera e' che un
#   OROLOGIO nella riga non cambia la scelta: solo la seduta conta.
check("la seduta viene letta da price_asof, e un orologio nella riga non cambia la scelta",
      RP.seduta_snapshot(VEN) == "2026-08-28" and RP.seduta_snapshot({}) is None
      and RP.prezzo_da_usare(241.45, {**VEN, "updated_at": "2099-01-01T00:00:00Z"}, "2026-08-27")
          == RP.prezzo_da_usare(241.45, VEN, "2026-08-27")
      and RP.prezzo_da_usare(216.62, {**GIO, "updated_at": "2099-01-01T00:00:00Z"}, "2026-08-28")
          == RP.prezzo_da_usare(216.62, GIO, "2026-08-28"))

# ── 9. la pipeline dichiara quando ripubblica una seduta piu' vecchia (v383) ───────────
srcU = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")
import update_data as UD
UD.PREV_DATA = {"watchlist": [{"ticker": "MRVL", "price_asof": "2026-08-28"}]}
check("una seduta ARRETRATA rispetto al run precedente viene riconosciuta e datata",
      UD.seduta_arretrata("MRVL", "2026-08-27") == "2026-08-28")
check("una seduta uguale o piu' avanti non viene segnalata",
      UD.seduta_arretrata("MRVL", "2026-08-28") is None
      and UD.seduta_arretrata("MRVL", "2026-08-29") is None)
check("un titolo mai visto prima non produce un falso allarme",
      UD.seduta_arretrata("PIPPO", "2026-08-27") is None)
check("senza price_asof (live override) non si segnala niente",
      UD.seduta_arretrata("MRVL", None) is None)
# ⚠ un titolo puo' passare da watchlist a portafoglio fra due run: il confronto non deve
#   perdersi proprio quando la posizione viene aperta
UD.PREV_DATA = {"portfolio": [{"ticker": "MRVL", "price_asof": "2026-08-28"}]}
check("il confronto trova il titolo anche se ha cambiato lista fra i due run",
      UD.seduta_arretrata("MRVL", "2026-08-27") == "2026-08-28")
UD.PREV_DATA = {}
check("senza snapshot precedente non si segnala niente",
      UD.seduta_arretrata("MRVL", "2026-08-27") is None)
# ⚠⚠ L'ALLARME DEVE RESTARE ACCESO. Al secondo run arretrato di fila, price_asof del run
#   precedente porta gia' la data vecchia: senza memoria del flag l'allarme tacerebbe proprio
#   mentre il sistema e' ancora indietro. Il 29/08/2026 la regressione e' durata quattro run.
UD.PREV_DATA = {"watchlist": [{"ticker": "MRVL", "price_asof": "2026-08-27",
                               "price_asof_arretrata_da": "2026-08-28"}]}
check("al secondo run arretrato di fila l'allarme resta acceso, non tace",
      UD.seduta_arretrata("MRVL", "2026-08-27") == "2026-08-28")
check("e si spegne da solo quando la seduta persa viene recuperata",
      UD.seduta_arretrata("MRVL", "2026-08-28") is None
      and UD.seduta_arretrata("MRVL", "2026-08-31") is None)
# ⚠ la pipeline DICHIARA, non rattoppa: splicciare un prezzo piu' recente su tecnica calcolata
#   senza quella barra darebbe una riga a due eta' (la classe che coherence_check sorveglia)
check("la pipeline dichiara la regressione invece di riscrivere il prezzo",
      "price_asof_arretrata_da" in srcU and "NON SI RATTOPPA IL PREZZO" in srcU)

# ── 10. la fonte di riserva scatta anche quando manca UNA SOLA seduta (v384) ───────────
# ⚠⚠ backup_daily (Stooq → Tiingo) esisteva da sempre ma era agganciata al solo `hist.empty`,
#   cioe' Yahoo che non risponde affatto. Il caso reale del 29/08/2026 era l'opposto: Yahoo
#   risponde con un anno di barre e ne manca UNA, l'ultima. Il piano B non poteva scattare.
#   Qui si prova senza rete, sostituendo backup_daily: cosi' il ramo si esercita davvero
#   invece di essere solo letto (la lezione v234: un ramo mai raggiunto non e' una protezione).
def _storico(fine, barre):
    idx = pd.bdate_range(end=fine, periods=barre)
    return pd.DataFrame({"Open": 100.0, "High": 101.0, "Low": 99.0,
                         "Close": 100.0, "Volume": 1000.0}, index=idx)

YAHOO_GIO = _storico("2026-08-27", 250)      # Yahoo si ferma a giovedi'
RISERVA_VEN = _storico("2026-08-28", 250)    # la riserva ha venerdi'
RISERVA_CORTA = _storico("2026-08-28", 40)   # ha venerdi' ma quasi nessuna storia

def _con_riserva(ritorno):
    """Sostituisce backup_daily e ritorna (hist, price_src) di recupera_seduta_persa."""
    orig = UD.backup_daily
    UD.backup_daily = lambda tk: ritorno
    try:
        return UD.recupera_seduta_persa("MRVL", YAHOO_GIO, "yahoo")
    finally:
        UD.backup_daily = orig

UD.PREV_DATA = {"watchlist": [{"ticker": "MRVL", "price_asof": "2026-08-28"}]}
h, src = _con_riserva((RISERVA_VEN, "stooq"))
check("quando manca UNA seduta la riserva viene provata e la seduta si recupera",
      UD.ultima_seduta(h) == "2026-08-28" and src == "stooq")
check("si sostituisce TUTTO lo storico, non il solo prezzo (niente riga a due eta')",
      len(h) == len(RISERVA_VEN) and h is not YAHOO_GIO)

# ⚠ non si baratta la storia per una seduta: SMA200 e i massimi a 52 settimane valgono di piu'
h2, src2 = _con_riserva((RISERVA_CORTA, "stooq"))
check("una riserva troppo corta NON sostituisce Yahoo: non si perde SMA200 per un giorno",
      UD.ultima_seduta(h2) == "2026-08-27" and src2 == "yahoo")
check("la soglia di storia minima e' una costante dichiarata, non un numero sparso",
      isinstance(UD.MIN_STORIA_RISERVA, int) and UD.MIN_STORIA_RISERVA >= 200)

# ⚠ una riserva che si ferma dove si ferma Yahoo non e' un recupero: non va spacciata per tale
h3, src3 = _con_riserva((_storico("2026-08-27", 250), "stooq"))
check("una riserva ferma alla stessa seduta non viene spacciata per un recupero",
      UD.ultima_seduta(h3) == "2026-08-27" and src3 == "yahoo")
h4, src4 = _con_riserva(None)
check("se la riserva non risponde si tiene Yahoo e la regressione resta dichiarata",
      UD.ultima_seduta(h4) == "2026-08-27" and src4 == "yahoo")

# ⚠ nessuna seduta persa = nessuna chiamata alla riserva. Un fetch inutile per titolo per run
#   e' un costo vero su una fonte gratuita e rate-limited.
UD.PREV_DATA = {"watchlist": [{"ticker": "MRVL", "price_asof": "2026-08-27"}]}
_chiamate = []
_orig = UD.backup_daily
UD.backup_daily = lambda tk: _chiamate.append(tk) or (RISERVA_VEN, "stooq")
try:
    h5, src5 = UD.recupera_seduta_persa("MRVL", YAHOO_GIO, "yahoo")
finally:
    UD.backup_daily = _orig
check("senza seduta persa la riserva non viene nemmeno interrogata",
      _chiamate == [] and src5 == "yahoo" and h5 is YAHOO_GIO)

# ⚠ il recupero e' AGGANCIATO alla guardia: le due cose devono leggere la stessa memoria,
#   altrimenti divergono (due implementazioni della stessa domanda — gia' successo tre volte)
# ⚠ NONA rottura di un check ancorato a una stringa del sorgente: la prima stesura cercava
#   "seduta_gia_pubblicata" nei primi 400 caratteri dopo `def seduta_arretrata`, e la docstring
#   e' piu' lunga di cosi'. La proprieta' vera si prova SENZA leggere il sorgente: si mette la
#   seduta buona SOLO nel flag, e si verifica che la vedano entrambe. Se una delle due leggesse
#   solo `price_asof` (qui il 25, piu' VECCHIO di Yahoo) non scatterebbe ne' l'allarme ne' il
#   recupero — cioe' il difetto si manifesterebbe, invece di nascondersi in una stringa.
UD.PREV_DATA = {"watchlist": [{"ticker": "MRVL", "price_asof": "2026-08-25",
                               "price_asof_arretrata_da": "2026-08-28"}]}
check("guardia e recupero leggono la STESSA memoria, flag di arretramento compreso",
      UD.seduta_gia_pubblicata("MRVL") == "2026-08-28"
      and UD.seduta_arretrata("MRVL", "2026-08-27") == "2026-08-28"
      and UD.ultima_seduta(_con_riserva((RISERVA_VEN, "stooq"))[0]) == "2026-08-28")
check("la riserva NON viene usata su indici, futures e cripto (simbologia diversa su Stooq)",
      "riserva_possibile = currency ==" in srcU and "elif riserva_possibile:" in srcU)
check("la soglia di dichiarazione e' una costante, non sparsa nel codice",
      isinstance(RP.SCARTO_PREZZO, (int, float)) and srcR.count("SCARTO_PREZZO") >= 3)

# ── 8. gli scenari non fingono un ripiego che non esiste (v382) ────────────────────────
srcS = (Path(__file__).resolve().parent / "scenari.py").read_text(encoding="utf-8")
import scenari as SC
check("scenari.py non muore piu' con un traceback quando la rete manca",
      "except (Exception, SystemExit)" in srcS and "non_si_puo" in srcS)
# ⚠ la PROPRIETA' che conta: spiega senza produrre numeri di scenario inventati
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    SC.non_si_puo(RuntimeError("meno di tre titoli con storia sufficiente"))
uscita = buf.getvalue()
check("quando non puo', scenari.py dichiara la causa e cosa servirebbe",
      "NON CALCOLABILI" in uscita and "RuntimeError" in uscita and "rendimenti giornalieri" in uscita)
check("e dichiara ESPLICITAMENTE che un ripiego su libro.json non esiste",
      "NON c'e' un ripiego" in uscita and "libro.json" in uscita)
check("non stampa nessuna riga di scenario quando non ha i dati per calcolarla",
      "sull'azionario" not in uscita and "beta" not in uscita.lower().replace("i beta verso", ""))
check("il codice d'uscita dice la verita': non esce 0 senza aver prodotto scenari",
      "sys.exit(main() or 0)" in srcS and "return 1" in srcS)

_T = len(ESEGUITI)
print(f"\n{'TUTTI I ' + str(_T - len(FALLITI)) + f'/{_T} CHECK OK' if not FALLITI else str(len(FALLITI)) + f'/{_T} FALLITI: ' + ', '.join(FALLITI)}")
sys.exit(1 if FALLITI else 0)
