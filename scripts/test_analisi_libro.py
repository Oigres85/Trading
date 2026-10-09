# -*- coding: utf-8 -*-
"""Test di analisi_libro.py. Nessuna rete: dati sintetici costruiti per far scattare
esattamente le trappole gia' pagate sul campo."""
import math, re, sys
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

# ── 5c. ogni blocco raccolto dice come si chiama (v387) ────────────────────────────────
# ⚠ Cinque riquadri senza intestazione: il CEO vedeva i grafici della dashboard e non poteva
#   sapere quale fosse quale. Un blocco senza nome non e' meno grave di un titolo che mente —
#   e' la stessa classe, l'etichetta che non fa il suo lavoro.
check("ogni blocco raccolto porta un'intestazione", _pag.count("<h3>") >= _pag.count('data-da="#'))
# ⚠⚠ LA PROPRIETA' CHE CONTA, e si prova cambiando index.html: il titolo si RICAVA dal markup.
#   Con una mappa selettore→titolo scritta dentro grafici.mjs questo check passerebbe lo stesso
#   ma la pagina mentirebbe al primo rinomino — la classe C10 (il registro che invecchia da
#   solo). Qui la sezione viene rinominata davvero e si verifica che la pagina la segua.
_idx = Path(__file__).resolve().parent.parent / "index.html"
_orig_idx = _idx.read_text(encoding="utf-8")
_MARCA = "Il rischio del libro, e con che cosa si confronta"
assert _MARCA in _orig_idx, "iniezione a vuoto: intestazione di riferimento non in index.html"
try:
    _idx.write_text(_orig_idx.replace(_MARCA, "TITOLO CAMBIATO PER PROVA"), encoding="utf-8")
    _r2 = subprocess.run(["node", str(Path(__file__).resolve().parent / "grafici.mjs"), str(_out)],
                         capture_output=True, text=True,
                         cwd=str(Path(__file__).resolve().parent.parent))
    _pag2 = _out.read_text(encoding="utf-8") if _out.exists() else ""
finally:
    _idx.write_text(_orig_idx, encoding="utf-8")
check("rinominando la sezione in index.html il titolo del blocco cambia con lei",
      "TITOLO CAMBIATO PER PROVA" in _pag2 and _MARCA not in _pag2, f"exit {_r2.returncode}")
check("nessuna mappa selettore→titolo scritta a mano dentro il raccoglitore",
      "titoloDi" in srcG and "MARKUP.indexOf" in srcG and _MARCA not in srcG)

# ── 6. le posizioni si leggono dalla FONTE, non dallo snapshot della pipeline ──────────
src = (Path(__file__).resolve().parent / "analisi_libro.py").read_text(encoding="utf-8")
# ⚠⚠ v439 — TRENTADUESIMA ROTTURA DI UN CHECK ANCORATO A UNA STRINGA LETTERALE, e aveva
#   torto: pretendeva che "data.json" non comparisse MAI nel sorgente, ed e' andato rosso
#   quando `stato_patrimoniale` ha cominciato a leggere da li' il PREZZO del BTP — che non e'
#   una posizione. L'invariante scritto nel commento qui sopra e in DECISIONI.md e' piu'
#   stretto e piu' vero: le POSIZIONI non devono venire dalla pipeline, cosi' che se la
#   pipeline muore l'analisi continui a dire la verita'. Ora si guarda il CORPO della funzione
#   che le legge, e si pretende che ogni lettura della pipeline abbia il proprio ripiego.
def _corpo_di(sorgente, nome):
    """Il corpo di una funzione di primo livello, fino alla prossima a colonna zero."""
    i = sorgente.find(f"def {nome}(")
    assert i >= 0, f"funzione {nome} non trovata"
    resto = sorgente[i:]
    j = resto.find("\ndef ", 1)
    return resto[:j] if j > 0 else resto

_corpo_pos = _corpo_di(src, "carica_posizioni")
check("le posizioni vengono da config/posizioni.json, non da data/data.json",
      "config\" / \"posizioni.json" in src and "data.json" not in _corpo_pos)
# ⚠ e una lettura della pipeline che NON ha ripiego reintrodurrebbe la dipendenza dall'altra
#   porta: se data.json manca, lo script deve degradare dichiarando, non fallire (v203).
_letture_pipe = [n for n in ("carica_posizioni", "stato_patrimoniale")
                 if "data.json" in _corpo_di(src, n)]
check("ogni lettura della pipeline in analisi_libro.py porta il proprio ripiego dichiarato",
      all("except" in _corpo_di(src, n) for n in _letture_pipe),
      extra=f"funzioni che leggono la pipeline: {_letture_pipe or 'nessuna'}")
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
import io, contextlib, logging
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

# ── 9. il muro di yfinance: riassunto per CAUSA, non silenzio (v387) ───────────────────
# ⚠ La dichiarazione del ripiego ESISTEVA gia' ed era corretta — stava pero' in fondo a ~200
#   righe che yfinance scrive su stderr, e quelle righe dicono "possibly delisted" di societa'
#   vive. E' la classe v315 (una dichiarazione che c'e' e non si trova non e' una dichiarazione)
#   applicata all'output di un comando. Qui NON si prova che il rumore sparisce: si prova che
#   la CAUSA sopravvive, che e' l'unica cosa che il muro faceva perdere.
import rumore_yf as RY
_racc = RY.RaccoltaYF()
_racc.righe = (["Failed to perform, curl: (7) CONNECT tunnel failed, response 403"] * 3
               + ["$MU: possibly delisted; no price data found"] * 5
               + ["Cookie/crumb fetch failed (ConnectionError), continuing without crumb"] * 2
               + ["qualcosa che non abbiamo mai visto"])
_r = _racc.riassunto()
check("il riassunto NON perde messaggi: le classi coprono tutto cio' che e' arrivato",
      sum(int(x.split()[0]) for x in _r) == len(_racc.righe))
# ⚠ LA PROPRIETA' CHE IL DIFETTO VIOLAVA: col muro, l'ultima cosa letta erano 13 "delisted".
#   La causa vera (la rete) deve venire PRIMA, e il delisting essere dichiarato conseguenza.
check("la causa di rete viene prima del delisting, che e' dichiarato una conseguenza",
      "403" in _r[0] and any("delisting" in x and "conseguenza" in x for x in _r))
check("un messaggio mai visto non viene inghiottito: viene contato e citato",
      any("non classificati" in x and "mai visto" in x for x in _r))
check("senza proteste il riassunto e' vuoto — non inventa una causa",
      RY.RaccoltaYF().riassunto() == [])

# ⚠ COMPORTAMENTALE: si prova sul logger VERO, non rileggendo il sorgente. Un messaggio
#   emesso mentre la cattura e' attiva deve finire nella raccolta e NON su stderr; e dopo
#   il ripristino deve tornare a propagare, altrimenti zittiremmo yfinance per sempre.
_lg = logging.getLogger("yfinance")
# ⚠ QUESTO CHECK E' ANDATO ROSSO E AVEVA RAGIONE. scripts/update_data.py alza lo stesso
#   logger a CRITICAL quando viene importato, e questa suite lo importa: il messaggio spariva
#   PRIMA di arrivare a qualunque handler. In produzione la cattura funzionava solo perche'
#   rapporto.py non importa la pipeline — cioe' per l'ordine degli import, non per costruzione.
#   Qui la condizione ostile si RIPRODUCE apposta, invece di essere aggirata.
_lg.setLevel(logging.CRITICAL)
# ⚠ LA PROPRIETA' E' "torna ESATTAMENTE com'era", non "torna vuoto". La prima stesura asseriva
#   handlers == [], e si e' rotta appena la pipeline ha cominciato a tenere la propria raccolta
#   attiva: l'assunzione era sul valore, non sull'invariante. Si fotografa lo stato e si verifica
#   che il ripristino lo rimetta, chiunque altro abbia toccato il logger prima.
_stato_prima = (list(_lg.handlers), _lg.propagate, _lg.level)
_prima_p = _lg.propagate
_err = io.StringIO()
_racc2, _ripristina = RY.zittisci_yfinance()
with contextlib.redirect_stderr(_err):
    _lg.error("possibly delisted; no price data found")
_ripristina()
check("mentre la cattura e' attiva il messaggio va nella raccolta, non su stderr",
      _racc2.righe == ["possibly delisted; no price data found"] and _err.getvalue() == "")
check("dopo il ripristino il logger torna ESATTAMENTE com'era: handler, propagate, livello",
      (list(_lg.handlers), _lg.propagate, _lg.level) == _stato_prima)
_lg.setLevel(logging.NOTSET)
check("il ripristino avviene anche quando analizza() esplode: e' in un finally",
      "finally:" in srcR and "ripristina()" in srcR)
# ⚠ UNA COPIA SOLA. La raccolta serve al rapporto E alla pipeline: due implementazioni della
#   stessa domanda divergono al primo ritocco (classe v161/v207, pagata piu' volte). Il check
#   verifica che nessuno dei due la reimplementi in casa.
_srcU_txt = (Path(__file__).resolve().parent / "update_data.py").read_text(encoding="utf-8")
check("la raccolta ha UNA fonte sola, importata sia dal rapporto sia dalla pipeline",
      "from rumore_yf import" in srcR and "from rumore_yf import" in _srcU_txt
      and "class RaccoltaYF" not in srcR and "class RaccoltaYF" not in _srcU_txt)

# ── 10. il comando /aggiorna non resta indietro rispetto al sistema (v387) ─────────────
# ⚠⚠ Il modo in cui un comando smette di essere utile non e' rompersi: e' RESTARE INDIETRO.
#   Prima di questa versione /aggiorna citava 5 script su 22 — backtest_signals, backtest_diary
#   ed emit_macro_pack esistevano, funzionavano, e nessuno li eseguiva mai. Un comando che cita
#   uno script rimosso, o che ignora uno strumento nuovo, degrada in silenzio: e' la classe del
#   registro fisso (C10, red team I6, MACRO_CARD_BY_PANEL) applicata a un comando.
_CMD = Path(__file__).resolve().parent.parent / ".claude" / "commands" / "aggiorna.md"
_cmd = _CMD.read_text(encoding="utf-8")
_scripts = sorted(p.name for p in (Path(__file__).resolve().parent).glob("*.py"))
_scripts += sorted(p.name for p in (Path(__file__).resolve().parent).glob("*.mjs"))
# ⚠ L'ANCORAGGIO VA CHIUSO: `update_data.py` e' sottostringa di `test_update_data.py`, quindi
#   un `in` semplice dichiarava citato uno script mai nominato e vietato uno consentito. E' la
#   trappola gia' scritta due volte in CLAUDE.md (`mg-card` che matcha `mg-card-head`,
#   `sc-fonte` che matcha `sc-fonte-qualsiasi`), e il check l'ha ripetuta appena scritto.
def _nominato(nome, testo):
    return re.search(r"(?<![\w-])" + re.escape(nome), testo) is not None
_ignoti = [s for s in _scripts if not _nominato(s, _cmd)]
check("ogni script del repo e' o eseguito da /aggiorna o dichiarato fuori, con la sua ragione",
      not _ignoti, f"mai nominati: {', '.join(_ignoti)}")
# ⚠ e il verso opposto: un comando che cita uno script inesistente promette un passo che non
#   avviene. Verde per assenza di esecuzione, la trappola gia' pagata in v205 e v226.
_citati = sorted(set(re.findall(r"scripts/([A-Za-z0-9_]+\.(?:py|mjs))", _cmd)))
_fantasmi = [s for s in _citati if not (Path(__file__).resolve().parent / s).exists()]
check("nessuno script citato dal comando e' un fantasma", not _fantasmi, f"assenti: {_fantasmi}")
# ⚠ IL DIVIETO E' STRUTTURALE, non una buona intenzione: il CEO ha chiesto che nessun
#   aggiornamento parta da solo. Se un domani qualcuno mette update_data.py fra i passi da
#   eseguire, questo check lo trova — la riga deve stare SOLO nella sezione dei divieti.
_divieto = _cmd.split("## Cosa questo comando NON fa")[-1]
_passi = _cmd.split("## Cosa questo comando NON fa")[0]
check("update_data.py compare solo fra i divieti, mai fra i passi da eseguire",
      _nominato("update_data.py", _divieto) and not _nominato("update_data.py", _passi))
check("anche notify_alerts e log_verdict stanno solo fra i divieti: scrivono fuori",
      all(_nominato(x, _divieto) and not _nominato(x, _passi)
          for x in ("notify_alerts.py", "log_verdict.mjs")))
# ⚠ e il gate della pipeline deve restare fra i PASSI: e' l'unico modo di sapere OGGI che la
#   pipeline di domani e' rotta, invece di scoprirlo dall'eta' il giorno dopo (v369).
check("test_update_data.py resta invece fra i passi: sorveglia la pipeline senza eseguirla",
      _nominato("test_update_data.py", _passi))
check("il divieto di armare trigger e schedulazioni e' scritto, non sottinteso",
      "trigger" in _divieto.lower() and "schedulazion" in _divieto.lower())
# ⚠ il backtest e' l'unica forma di "previsione" che questo sistema ammette, e va letto come
#   curriculum misurato, non come profezia: il comando deve chiedere il campione REALE.
check("il comando chiede il campione REALE dei backtest, non le osservazioni sovrapposte",
      "campione REALE" in _cmd and "5 titoli distinti" in _cmd)
check("il comando impone R² accanto al beta: un canale sotto 0,05 non si racconta",
      "R²" in _cmd and "0,05" in _cmd)


# ═══ v439 — LE TRE CORREZIONI DEL GIRO DEL 09/09 ═════════════════════════════════════════
# ⚠ Tutti e tre COSTRUISCONO lo stato che misurano invece di aspettarlo dai dati del giorno:
#   un check che vale finche' i dati lo concedono va rosso da solo (v429, v431, v435).

# --- 1. il BTP si valorizza a MERCATO, non al carico ---
# La quota azionaria e' il MOLTIPLICATORE con cui ogni misura di rischio passa al patrimonio:
# se il BTP entra al costo dentro un totale che e' a mercato, quel moltiplicatore mescola due
# convenzioni. L'invariante non e' un numero, e' che il prezzo VINCA sul carico quando c'e'.
import json as _json
_ROOT = Path(__file__).resolve().parent.parent
_orig_stato = (_ROOT / "config" / "portfolio_state.json").read_text(encoding="utf-8")
_orig_dati = (_ROOT / "data" / "data.json").read_text(encoding="utf-8")
try:
    _st = {"cash": {"v": 1000, "at": "x"}, "btp": {"v": {"qty": 40000, "pmc": 100}, "at": ""}}
    (_ROOT / "config" / "portfolio_state.json").write_text(_json.dumps(_st), encoding="utf-8")
    _dd = _json.loads(_orig_dati)
    _dd["portfolio"] = [{"ticker": "BTP-V28", "price": 110.0, "qty": 40000}]
    (_ROOT / "data" / "data.json").write_text(_json.dumps(_dd), encoding="utf-8")
    import importlib as _il; _il.reload(A)
    _sp = A.stato_patrimoniale()
    check("v439 il BTP entra al PREZZO di mercato, non al carico",
          _sp and abs(_sp["btp"] - 44000.0) < 0.01 and _sp.get("btp_base") == "prezzo di mercato",
          extra=f"ottenuto {_sp}")
    # ⚠ e il ripiego sul carico deve restare, DICHIARATO: senza riga di pipeline il BTP non
    #   puo' sparire dal denominatore — sarebbe un patrimonio piu' piccolo del vero.
    _dd["portfolio"] = []
    (_ROOT / "data" / "data.json").write_text(_json.dumps(_dd), encoding="utf-8")
    _il.reload(A)
    _sp2 = A.stato_patrimoniale()
    check("v439 senza la riga della pipeline si ripiega sul carico E lo dichiara",
          _sp2 and abs(_sp2["btp"] - 40000.0) < 0.01 and "carico" in (_sp2.get("btp_base") or ""),
          extra=f"ottenuto {_sp2}")
finally:
    (_ROOT / "config" / "portfolio_state.json").write_text(_orig_stato, encoding="utf-8")
    (_ROOT / "data" / "data.json").write_text(_orig_dati, encoding="utf-8")
    import importlib as _il2; _il2.reload(A)

# --- 2. portfolio_state.json non ospita una seconda copia del libro ---
# Le posizioni vivono in config/posizioni.json e in memoria/LIBRO.md. Una copia in piu' non si
# rompe: invecchia in silenzio, ed e' come RGTI ci e' rimasta a 595 quote contro 463.
_stato_chiavi = set(_json.loads(_orig_stato))
check("v439 portfolio_state.json porta solo cassa e BTP, non una copia delle posizioni",
      "holdings" not in _stato_chiavi and {"cash", "btp"} <= _stato_chiavi,
      extra=f"chiavi trovate: {sorted(_stato_chiavi)}")

# --- 3. riconciliazione: la barra in formazione non e' una cache vecchia ---
# ⚠ Le due cause hanno rimedi diversi e uno dei due NON ESISTE: a mercato aperto rigenerare la
#   raccolta e' lavoro sprecato. L'ora si INIETTA, cosi' il check non dipende da quando gira
#   (v402: un ramo temporale che nessun test puo' esercitare non e' una protezione).
sys.path.insert(0, str(_ROOT / "scripts"))
import riconciliazione as _ric
from datetime import datetime as _dt, timezone as _tz
_aperto = _dt(2026, 9, 9, 17, 30, tzinfo=_tz.utc)    # 13:30 ET, campana non suonata
_chiuso = _dt(2026, 9, 9, 21, 30, tzinfo=_tz.utc)    # 17:30 ET, seduta finita
check("v439 a sessione aperta la barra di oggi risulta IN FORMAZIONE",
      _ric.barra_in_formazione("2026-09-09", _aperto) is True)
check("v439 a sessione chiusa la stessa barra risulta CHIUSA",
      _ric.barra_in_formazione("2026-09-09", _chiuso) is False)
check("v439 una seduta che non e' oggi e' sempre chiusa, a qualunque ora",
      _ric.barra_in_formazione("2026-09-08", _aperto) is False
      and _ric.barra_in_formazione("2026-09-08", _chiuso) is False)
# ⚠ il COLLEGAMENTO, non solo il controllo: togliendo la riga che aggancia la funzione al
#   messaggio i tre check qui sopra restano verdi e il gate torna a dare il rimedio sbagliato
#   (lezione v399 — il check provava il controllo, non il collegamento).
_src_ric = (_ROOT / "scripts" / "riconciliazione.py").read_text(encoding="utf-8")
_corpo_ric = "\n".join(l for l in _src_ric.splitlines() if not l.lstrip().startswith("#"))
check("v439 il messaggio del gate e' agganciato a barra_in_formazione, non solo definito",
      "barra_in_formazione(seduta_pipe)" in _corpo_ric
      and "IN FORMAZIONE" in _corpo_ric and "cache della raccolta e' indietro" in _corpo_ric)


# ═══ v440 — I GATE DELLO STRUMENTO NUOVO ═════════════════════════════════════════════════
# ⚠⚠ `scripts/conseguenze.py` e' nato ieri e nessun check lo guardava: *una fonte che nessun
#   gate sorveglia puo' morire il giorno in cui nasce* (v390). E qui il costo sarebbe piu' alto
#   che altrove, perche' e' lo strumento che il CEO usa per decidere QUANTO muovere: un numero
#   sbagliato qui non produce un'analisi imprecisa, produce un ordine sbagliato.
# ⚠ I check guardano PROPRIETA' che una formula sbagliata non puo' soddisfare per caso — non i
#   valori che mi aspetto, che si possono sbagliare insieme al codice (v326).
import subprocess as _sp, re as _re
_CONS = _sp.run([sys.executable, str(_ROOT / "scripts" / "conseguenze.py")],
                capture_output=True, text=True, cwd=str(_ROOT))
_out = _CONS.stdout
check("v440 conseguenze.py esegue e parla", _CONS.returncode == 0 and len(_out) > 500,
      extra=f"exit {_CONS.returncode}, {len(_out)} caratteri, stderr: {_CONS.stderr[:200]}")

_lib = _json.loads((_ROOT / "data" / "libro.json").read_text(encoding="utf-8"))
_dati = _json.loads((_ROOT / "data" / "data.json").read_text(encoding="utf-8"))
_px = {r["ticker"]: float(r["price"]) for r in
       ((_dati.get("watchlist") or []) + (_dati.get("portfolio") or []))
       if r.get("ticker") and isinstance(r.get("price"), (int, float))}
_pos = {r["ticker"]: r for r in
        _json.loads((_ROOT / "config" / "posizioni.json").read_text(encoding="utf-8"))["posizioni"]}

# --- 1. la ricostruzione COINCIDE con cio' che la pipeline pubblica ---
# ⚠⚠ E' il check che rende affidabile tutto il resto: l'effetto di una mossa si calcola
#   RIFACENDO sqrt(w' S w) dalla matrice, non scalando la volatilita' pubblicata (v391 — un
#   numero plausibile e divergente e' peggio di uno dichiarato mancante). Se la ricostruzione
#   non riproduce il punto di partenza, ogni "dopo la mossa" e' costruito su una base diversa.
#   Misurato il 09/09: 49,30% contro 49,30%, scarto 0,000 pp.
sys.path.insert(0, str(_ROOT / "scripts"))
import conseguenze as _C
_v0 = _C.vol_libro(_lib["pesi"], _lib["correlazioni"], _lib["volatilita_nome"])
_s0 = _C.scommesse(_lib["pesi"], _lib["correlazioni"])
check("v440 la volatilita' ricostruita dalla matrice riproduce quella pubblicata",
      _v0 is not None and abs(_v0 - _lib["volatilita"]) < 0.0005,
      extra=f"ricostruita {_v0}, pubblicata {_lib['volatilita']}")
check("v440 le scommesse effettive ricostruite riproducono quelle pubblicate",
      _s0 is not None and abs(_s0 - _lib["scommesse_effettive"]) < 0.01,
      extra=f"ricostruite {_s0}, pubblicate {_lib['scommesse_effettive']}")

# --- 2. il numero di azioni PORTA DAVVERO ALLA SOGLIA (giro di andata e ritorno) ---
# ⚠ Si legge dall'OUTPUT vero e si riapplica ai prezzi veri: un check che ricalcolasse la
#   formula confermerebbe la mia stessa assunzione invece di misurare la proprieta' (v326).
_SOGLIA = _C.SOGLIE["nome"][0]
_tot = sum(_px[t] * _pos[t]["qta"] for t in _lib["pesi"] if t in _px and t in _pos)
_mosse = _re.findall(r"▸ (\w+) — oggi[^\n]*\n\s+per arrivare al \d+%: ([\d.,]+) azioni su ([\d.,]+)", _out)
def _num(s): return float(s.replace(",", ""))
_esiti, _passi = [], []
for _tk, _m, _q in _mosse:
    _p = _px.get(_tk)
    if not _p: continue
    _qn = _num(_q) - _num(_m)
    _nuovoTot = _tot - _num(_m) * _p
    _esiti.append((_tk, _qn * _p / _nuovoTot))
    _passi.append(_p / _nuovoTot)          # quanto pesa UNA azione sul libro dopo la mossa
# ⚠ Con le azioni INTERE il peso non cade esattamente sulla soglia: l'invariante e' che la
#   RAGGIUNGA (stia sotto) e che non la superi di piu' di quanto vale una singola azione —
#   spostarne una in meno la lascerebbe sopra, una in piu' sarebbe di troppo.
check("v440 le azioni da spostare portano il peso alla soglia, a meno di un'azione intera",
      len(_esiti) >= 1 and all(w <= _SOGLIA + 1e-9 and (_SOGLIA - w) < _passo
                               for (_, w), _passo in zip(_esiti, _passi)),
      extra=f"pesi risultanti: {[(t, round(w*100, 3)) for t, w in _esiti]} contro {_SOGLIA*100}%")

# --- 3. il PREZZO a cui la soglia si raggiunge da sola la raggiunge davvero ---
# Il ramo "senza operare" e' quello che evita una vendita: se il prezzo e' sbagliato, il CEO
# aspetta un livello che non riporta niente dove dice.
_prezzi = _re.findall(r"▸ (\w+) —[\s\S]*?si raggiunge se \w+ scende a ([\d.,]+) \$", _out)
_esitiP = []
for _tk, _ps in _prezzi:
    _p, _q = _px.get(_tk), (_pos.get(_tk) or {}).get("qta")
    if not (_p and _q): continue
    _altri = _tot - _q * _p
    _nuovo = _num(_ps)
    _esitiP.append((_tk, _q * _nuovo / (_altri + _q * _nuovo)))
check("v440 il prezzo 'senza operare' porta il peso alla soglia, non a un altro livello",
      len(_esitiP) >= 1 and all(abs(w - _SOGLIA) < 0.005 for _, w in _esitiP),
      extra=f"pesi a quel prezzo: {[(t, round(w*100, 2)) for t, w in _esitiP]}")

# --- 3bis. le cifre stampate sono coerenti fra loro: non si vende mezza azione ---
# ⚠⚠ E' il difetto chiuso in v440: le azioni si stampavano arrotondate e controvalore,
#   plusvalenza e imposta si calcolavano sul numero con la virgola. Il CEO leggeva "29 azioni"
#   accanto al controvalore di 28,94. Classe v433/v415 — due derivazioni della stessa
#   grandezza, una arrotondata e una no — su uno strumento che dice QUANTO muovere.
_coer = _re.findall(r"▸ (\w+) — oggi[^\n]*\n\s+per arrivare al \d+%: ([\d.,]+) azioni su [\d.,]+\s+\(([\d.,]+) \$", _out)
check("v440 il controvalore stampato e' le azioni STAMPATE per il prezzo, non una frazione",
      len(_coer) >= 1 and all(abs(_num(c) - _num(m) * _px[t]) < 1 for t, m, c in _coer if t in _px),
      extra=f"terne (titolo, azioni, controvalore): {_coer}")

# --- 4. il conto fiscale e' il 26% della plusvalenza di CIO' CHE SI MUOVE ---
# ⚠ Non della posizione intera: e' l'errore naturale, e darebbe un'imposta 2-3 volte piu' alta
#   su MU. L'aliquota e' un FATTO (partecipazioni non qualificate), non una convenzione nostra.
_fisc = _re.findall(r"▸ (\w+) —[\s\S]*?plusvalenza ([\d.,]+) \$ → imposta ([\d.,]+) \$", _out)
check("v440 l'imposta e' il 26% della plusvalenza delle sole azioni spostate",
      len(_fisc) >= 1 and all(abs(_num(i) - _num(p) * _C.ALIQUOTA) < 2 for _, p, i in _fisc)
      and all(abs(_num(p) - (_px[t] - _pos[t]["pmc"]) * _num(dict((a, b) for a, b, c in _mosse)[t])) < 2
              for t, p, i in _fisc if t in _px and t in _pos),
      extra=f"coppie plus/imposta: {_fisc}")

# --- 5. le tre cose che il sistema NON sa restano dichiarate in testa ---
# ⚠⚠ E' la riga che tiene lo strumento dalla parte dei fatti: senza, l'aritmetica si legge come
#   la quantita' GIUSTA invece che come la conseguenza di una soglia. Il divieto di dimensionare
#   e' stato spostato, non tolto (v439), e poggia su questa dichiarazione.
check("v440 lo strumento dichiara in testa i due buchi che nessun numero colma",
      "altri conti" in _out and "fiscale pregressa" in _out
      and "non quale mossa fare" in _out and "nessuno e' una raccomandazione" in _out)

# --- 6. il denominatore delle prime tre e' NOMINATO ---
# La disciplina del pacchetto pubblica la stessa regola su tutti i nomi e da' un numero piu'
# basso: affiancarli senza dirlo e' cio' che il collaudo ordina a chi legge di segnalare (v414).
check("v440 la riga delle prime tre nomina il proprio denominatore e l'altro",
      "denominatore: i" in _out and "nomi DENTRO la matrice" in _out
      and "stessa misura su due insiemi" in _out)


# ═══ v448 — SORVEGLIANZA: il selettore su cui la Routine oraria decide ═══════════════════════
# ⚠⚠ LO STATO SI COSTRUISCE, NON SI ASPETTA. Nessuno di questi fenomeni esiste nello snapshot di
#   oggi (zero voci fuori finestra, zero pipeline ferme, zero movimenti oltre 2x ATR): un check
#   che li leggesse sarebbe verde per ASSENZA DEL FENOMENO, la trappola gia' pagata cinque volte
#   in questo progetto (v196, v229, v421, v429, v431). Qui i dati sono sintetici e contengono il
#   caso per costruzione, a qualunque ora giri la suite.
import datetime as _dt
import subprocess as _sub
import sorveglianza as _S

_ORA = _dt.datetime(2026, 9, 11, 16, 0, tzinfo=_dt.timezone.utc)


def _snap(voci_tk=None, voci_macro=None, righe=None, **kw):
    """Uno snapshot minimo che contiene esattamente il fenomeno da misurare."""
    nt = {"per_titolo": voci_tk if voci_tk is not None else {}, "letto_il": "2026-09-11T15:00:00Z",
          "non_letti": kw.get("non_letti", []), "senza_notizie": kw.get("senza_notizie", [])}
    d = {"updated_at": kw.get("updated_at", "2026-09-11T15:00:00Z"),
         "portfolio": righe or [], "watchlist": [],
         "macro": {"news": ({"voci": voci_macro, "fonti": ["F1"], "fonti_mute": kw.get("mute", []),
                             "fonti_non_lette": kw.get("non_lette", [])}
                            if voci_macro is not None else {}),
                   "credit": {"spread_hy": kw.get("hy", 2.7)},
                   "fedwatch": {"meetings": kw.get("meetings", [])}}}
    if voci_tk is not None or kw.get("forza_nt"):
        d["news_titoli"] = nt
    return d


def _voce(quando, titolo, url="u"):
    return {"quando": quando, "titolo": titolo, "fonte": "Nasdaq", "url": url}


# --- 1. la finestra E' la deduplica: una voce vecchia non rientra all'ora dopo ---
# ⚠ E' il perno dell'intero disegno: la Routine accende una sessione NUOVA a ogni scatto e non ha
#   memoria, quindi senza la finestra la stessa notizia suonerebbe ogni ora finche' resta nel feed
#   (il feed ha una finestra di 14 giorni).
_b = _S.raccogli(_snap(voci_tk={"MU": [_voce("2026-09-11T15:30:00Z", "dentro"),
                                       _voce("2026-09-11T14:00:00Z", "fuori")]}), _ORA, 70, {"MU"})
check("v448 la finestra tiene la voce fresca e lascia fuori quella vecchia",
      [v["titolo"] for v in _b["titoli"]] == ["dentro"],
      extra=f"raccolte: {[v['titolo'] for v in _b['titoli']]}")

# --- 2. l'orologio e' un PARAMETRO, non l'ora in cui gira la suite (v402) ---
_d2 = _snap(voci_tk={"MU": [_voce("2026-09-11T15:30:00Z", "x")]})
check("v448 spostando l'orologio avanti la stessa voce esce dalla finestra",
      len(_S.raccogli(_d2, _ORA, 70, {"MU"})["titoli"]) == 1
      and len(_S.raccogli(_d2, _ORA + _dt.timedelta(hours=3), 70, {"MU"})["titoli"]) == 0)

# --- 3. il marcatore del ticker e' SENSIBILE AL MAIUSCOLO ---
# ⚠ `BE` e `MU` sono parole inglesi comuni: un ancoraggio aperto accenderebbe il marcatore su
#   quasi ogni titolo. E' la trappola mg-card/mg-card-head, gia' pagata quattro volte.
_nomi = {"BE": "Bloom Energy Corporation", "MU": "Micron Technology, Inc."}
check("v448 'be' minuscolo non marca BE, '(BE)' si'",
      _S.nomi_citati("This could be a good day for chips", _nomi) == []
      and "BE" in _S.nomi_citati("Bloom Energy (BE) beats estimates", _nomi),
      extra=f"minuscolo={_S.nomi_citati('This could be a good day for chips', _nomi)}")

# --- 4. una parola generica del nome non accende il marcatore ---
# Difetto vero, visto sul feed del giorno: `Bloom Energy` marcava BE su "PBF Energy and Lennar
# have been highlighted..." perche' si provavano TUTTI i token del nome e "Energy" e' il settore.
check("v448 'PBF Energy' non marca Bloom Energy, 'Bloom' si'",
      _S.nomi_citati("PBF Energy and Lennar have been highlighted", _nomi) == []
      and _S.nomi_citati("Bloom beats on revenue", _nomi) == ["BE"])
# ⚠ Il caso sopra e' il difetto REALE visto sul feed, e da solo non discrimina: lo chiude gia'
#   l'elenco delle parole generiche. Questo secondo caso misura la proprieta' che resta —
#   SOLO il primo token identifica la societa' — con un secondo token che generico non e'.
check("v448 il secondo token del nome non identifica la societa'",
      _S.nomi_citati("Beacon Roofing Supply rises", {"XX": "Alpha Beacon Holdings"}) == []
      and _S.nomi_citati("Alpha Beacon wins contract", {"XX": "Alpha Beacon Holdings"}) == ["XX"])
# ⚠⚠ E il caso PIU' pericoloso del libro di oggi: MSTR si chiama `Strategy Inc`. Senza l'elenco
#   delle parole generiche, ogni titolo che contiene la parola "strategy" — e ne contiene una
#   valanga — marcherebbe MSTR, cioe' il marcatore sarebbe acceso sempre e non direbbe piu'
#   niente. Il ticker resta la strada che funziona.
check("v448 un nome che E' una parola comune non accende il marcatore, il ticker si'",
      _S.nomi_citati("Company outlines new growth strategy", {"MSTR": "Strategy Inc"}) == []
      and _S.nomi_citati("MSTR jumps on buyback", {"MSTR": "Strategy Inc"}) == ["MSTR"])

# --- 5. la stessa voce in piu' feed e' UNA riga, e i feed si sommano ---
# In quanti feed compare e' informazione: uno = notizia sul nome, sei = cronaca di mercato.
_b5 = _S.raccogli(_snap(voci_tk={"MU": [_voce("2026-09-11T15:30:00Z", "cronaca")],
                                 "AMD": [_voce("2026-09-11T15:30:00Z", "cronaca")],
                                 "NVDA": [_voce("2026-09-11T15:31:00Z", "propria")]}),
                  _ORA, 70, {"MU", "AMD", "NVDA"})
_per = {v["titolo"]: v["feed"] for v in _b5["titoli"]}
check("v448 una voce in due feed resta una riga e dichiara entrambi i feed",
      len(_b5["titoli"]) == 2 and sorted(_per["cronaca"]) == ["AMD", "MU"]
      and _per["propria"] == ["NVDA"], extra=str(_per))

# --- 6. il MOVIMENTO non esce nello scatto orario, esce solo dopo la campana ---
# ⚠⚠ `change_pct` e' la variazione dalla chiusura precedente: sopra soglia resterebbe tale per
#   tutta la seduta, quindi nello scatto orario suonerebbe OGNI VOLTA. Un avviso che suona sempre
#   non avvisa (v421, v427). E' una proprieta' della resa, non un dettaglio di stampa.
_righe6 = [{"ticker": "MU", "name": "Micron", "change_pct": -12.0, "atr_pct": 5.0,
            "risk_contrib_pct": 33.7}]
_b6 = _S.raccogli(_snap(righe=_righe6, voci_tk={}), _ORA, 70, {"MU"})
_orario = _S.stampa(_b6, _ORA, 70, False, "2026-08-23")
_dopo = _S.stampa(_b6, _ORA, 70, True, "2026-08-23")
check("v448 il movimento oltre soglia esce con --chiusura e NON nello scatto orario",
      "MOVIMENTO OLTRE" not in _orario and "MU:" not in _orario
      and "MOVIMENTO OLTRE" in _dopo and "MU:" in _dopo)

# --- 7. la soglia e' sull'ampiezza DEL TITOLO, non una percentuale uguale per tutti ---
# ⚠ Lezione v210: una soglia percentuale segnala sempre lo stesso nome, quello piu' volatile.
#   Qui i due titoli si muovono dello STESSO 8% e solo quello stretto deve scattare.
_b7 = _S.raccogli(_snap(righe=[
    {"ticker": "LARGO", "change_pct": 8.0, "atr_pct": 7.0},
    {"ticker": "STRETTO", "change_pct": 8.0, "atr_pct": 2.0}], voci_tk={}),
    _ORA, 70, {"LARGO", "STRETTO"})
check("v448 a parita' di variazione scatta solo chi supera la PROPRIA ampiezza",
      [v["tk"] for v in _b7["movimenti"]] == ["STRETTO"],
      extra=str([(v["tk"], round(v["rap"], 2)) for v in _b7["movimenti"]]))

# --- 7b. l'ESCURSIONE e' la seconda meta' della domanda ---
# ⚠⚠ Il caso reale che ha aperto questo ramo: l'11/09 ORCL ha percorso il 10,1% fra minimo e
#   massimo dopo la trimestrale — due volte la propria ampiezza — e ha chiuso a +0,04%. Con la
#   sola variazione da chiusura a chiusura il brief sarebbe stato MUTO sull'unico nome del libro
#   che avesse avuto una giornata. E l'etichetta non afferma una direzione che il dato non
#   porta (v405): un'escursione che chiude piatta dice che il prezzo e' tornato, non dove e'
#   andato.
_b7b = _S.raccogli(_snap(righe=[
    {"ticker": "TORNA", "change_pct": 0.04, "atr_pct": 5.0, "day_high": 166.0,
     "day_low": 150.0, "price": 153.0},
    {"ticker": "FERMO", "change_pct": 0.5, "atr_pct": 5.0, "day_high": 101.0,
     "day_low": 99.0, "price": 100.0}], voci_tk={}), _ORA, 70, {"TORNA", "FERMO"})
_t7b = _S.stampa(_b7b, _ORA, 70, True, "x")
check("v448 l'escursione oltre soglia entra anche con la chiusura piatta, e dichiara il ritorno",
      [v["tk"] for v in _b7b["movimenti"]] == ["TORNA"]
      and "escursione della seduta" in _t7b and "ed e' tornato" in _t7b,
      extra=str([v["tk"] for v in _b7b["movimenti"]]))

# --- 7c. quando le due misure CONCORDANO la riga non dice che il prezzo e' tornato ---
_b7c = _S.raccogli(_snap(righe=[{"ticker": "CROLLA", "change_pct": -14.0, "atr_pct": 5.0,
                                 "day_high": 101.0, "day_low": 85.0, "price": 86.0}],
                         voci_tk={}), _ORA, 70, {"CROLLA"})
_t7c = _S.stampa(_b7c, _ORA, 70, True, "x")
check("v448 con chiusura ed escursione entrambe oltre soglia la riga parla di conferma, non di ritorno",
      "la chiusura conferma la direzione" in _t7c and "ed e' tornato" not in _t7c)

# --- 7d. senza minimo e massimo il titolo non sparisce: resta la chiusura ---
# ⚠ Un ripiego che fa sparire una riga e' peggio del dato mancante (v187, v406).
_b7d = _S.raccogli(_snap(righe=[{"ticker": "SENZA", "change_pct": -13.0, "atr_pct": 5.0}],
                        voci_tk={}), _ORA, 70, {"SENZA"})
check("v448 senza minimo e massimo la soglia sulla chiusura funziona lo stesso",
      [v["tk"] for v in _b7d["movimenti"]] == ["SENZA"]
      and _b7d["movimenti"][0]["rap_esc"] is None)

# --- 8. fonte ASSENTE, fonte NON LETTA e fonte MUTA si dichiarano in tre modi diversi ---
# ⚠⚠ "nessuna notizia" e "la fonte non ha risposto" si leggono uguali e significano l'opposto
#   (v389, v421). E' la classe che ha tenuto le news macro morte per un anno.
_ass = _S.stampa(_S.raccogli(_snap(voci_tk=None), _ORA, 70, {"MU"}), _ORA, 70, False, "x")
_nl = _S.stampa(_S.raccogli(_snap(voci_tk={"MU": []}, non_letti=["SKHY"], senza_notizie=["BE"]),
                            _ORA, 70, {"MU"}), _ORA, 70, False, "x")
check("v448 assente, non letta e muta producono tre dichiarazioni distinte",
      "ASSENTE dallo snapshot" in _ass and "misura che manca" in _ass
      and "NON letti (la fonte non ha risposto): SKHY" in _nl
      and "letti e senza voci: BE" in _nl and "FEED PER-TITOLO: ASSENTE" not in _nl)
# ⚠ La sonda e' stata sbagliata alla prima stesura: cercava "ASSENTE" in tutto il brief, che lo
#   contiene legittimamente nella riga del feed MACRO (in quello scenario macro.news e' vuoto).
#   Un check rosso e' prima di tutto una sonda da verificare contro il testo vero (v433).

# --- 9. la pipeline ferma oltre 24 ore e' un GUASTO dichiarato, non un ritardo ---
_vecchio = _S.stampa(_S.raccogli(_snap(voci_tk={}, updated_at="2026-09-09T15:00:00Z"),
                                 _ORA, 70, {"MU"}), _ORA, 70, False, "x")
check("v448 oltre 24 ore il brief dichiara la pipeline ferma e che i prezzi non sono di adesso",
      "PIPELINE FERMA" in _vecchio and "NON sono quelli di adesso" in _vecchio
      and "49.0 ore" in _vecchio)

# --- 10. ogni soglia stampata si DICHIARA convenzione (v240) ---
# Nel file non esiste nessun limite di movimento e nessuna soglia di spread: sono affermazioni
# del mestiere, e una tacca disegnata senza provenienza e' esattamente il difetto della v240.
_conv = _S.stampa(_S.raccogli(_snap(voci_tk={}, hy=2.7, meetings=[
    {"date": "2026-09-16", "mosse_25bp": 1.97, "prezzata_dal_contratto": True}]),
    _ORA, 70, {"MU"}), _ORA, 70, True, "x")
check("v448 movimento, credito e FOMC dichiarano cosa e' convenzione e cosa e' calcolo nostro",
      "e' una CONVENZIONE" in _conv and "convenzione, non un dato del file" in _conv
      and "nostro calcolo sul future, NON una probabilita'" in _conv)

# --- 11. IL COLLEGAMENTO, non il controllo (v399, v443) ---
# ⚠⚠ I dieci check sopra passano un dizionario costruito a mano: se domani la pipeline
#   rinominasse una chiave, resterebbero tutti verdi e il brief uscirebbe vuoto in silenzio —
#   che e' letteralmente il guasto per cui le news macro sono morte un anno. Questo check legge
#   il data.json VERO e pretende che le chiavi che lo script interroga esistano davvero.
_vero = _S._dati()
_nt_vero = _vero.get("news_titoli") or {}
_mn_vero = (_vero.get("macro") or {}).get("news") or {}
check("v448 le chiavi che il selettore legge esistono nel data.json vero",
      isinstance(_nt_vero.get("per_titolo"), dict) and len(_nt_vero["per_titolo"]) > 0
      and isinstance(_mn_vero.get("voci"), list)
      and all("quando" in v and "titolo" in v for v in _mn_vero["voci"][:3])
      and isinstance(((_vero.get("macro") or {}).get("fedwatch") or {}).get("meetings"), list),
      extra=f"per_titolo={len(_nt_vero.get('per_titolo') or {})} macro={len(_mn_vero.get('voci') or [])}")

# --- 12. gira davvero, sui dati veri, ed esce 0 ---
# Un modulo che importa non e' un comando che funziona: la Routine lo invoca da riga di comando.
_run = _sub.run([sys.executable, str(Path(__file__).resolve().parent / "sorveglianza.py"),
                 "--chiusura", "--adesso", "2026-09-11T16:00:00Z"],
                capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent.parent))
check("v448 il comando gira sui dati veri, esce 0 e stampa tutte le sezioni",
      _run.returncode == 0 and "SORVEGLIANZA LIBRO" in _run.stdout
      and "NOTIZIE SUI NOMI DEL LIBRO" in _run.stdout and "MACRO, ultimi" in _run.stdout
      and "MOVIMENTO OLTRE" in _run.stdout and "CREDITO:" in _run.stdout,
      extra=(_run.stderr or "")[-300:])



# ============================ v451 — BRIEF QUOTIDIANO ============================
# Lo strumento nasce SORVEGLIATO: una fonte che nessun check guarda puo' morire il giorno in
# cui nasce (v390) — le news macro sono state morte un anno prima che qualcuno se ne accorgesse.
_BRIEF = Path("scripts/brief.py").read_text(encoding="utf-8")
# ⚠ Chi cerca l'ASSENZA di una costruzione guarda il CODICE: i commenti e le docstring che
# SPIEGANO la misura contengono per forza le stringhe cercate — e' il gate che trova se stesso
# (v213, v240, v393, v395). Qui si tolgono sia i commenti sia le docstring.
def _solo_codice_py(sorgente):
    import ast as _ast
    albero = _ast.parse(sorgente)
    docs = set()
    for nodo in _ast.walk(albero):
        if isinstance(nodo, (_ast.Module, _ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)):
            corpo = getattr(nodo, "body", [])
            if corpo and isinstance(corpo[0], _ast.Expr) and isinstance(corpo[0].value, _ast.Constant) \
               and isinstance(corpo[0].value.value, str):
                docs.add(id(corpo[0]))
    righe = sorgente.splitlines()
    fuori = set()
    for nodo in _ast.walk(albero):
        if id(nodo) in docs:
            for n in range(nodo.lineno - 1, nodo.end_lineno):
                fuori.add(n)
    return "\n".join(r.split("#")[0] for i, r in enumerate(righe) if i not in fuori)

_BRIEF_CODICE = _solo_codice_py(_BRIEF)

import importlib.util as _ilu
_sp = _ilu.spec_from_file_location("_bf", "scripts/brief.py")
_bf = _ilu.module_from_spec(_sp); _sp.loader.exec_module(_bf)

check("v451 l'ATR e' quello di WILDER, non la media semplice a 14",
      "def atr_wilder" in _BRIEF_CODICE and "a = (a * (n - 1) + x) / n" in _BRIEF_CODICE)

# Lo stato si COSTRUISCE (v425, v429, v431): barre in cui l'ampiezza CROLLA a meta' serie, dove
# Wilder (memoria lunga) e la media a 14 (memoria corta) devono divergere per costruzione.
_b = [{"t": f"d{i}", "o": 100, "h": 100 + (10 if i < 20 else 1),
       "l": 100 - (10 if i < 20 else 1), "c": 100} for i in range(40)]
_w = _bf.atr_wilder(_b)
_m14 = sum(max(_b[i]["h"] - _b[i]["l"], abs(_b[i]["h"] - _b[i-1]["c"]), abs(_b[i]["l"] - _b[i-1]["c"]))
           for i in range(len(_b) - 14, len(_b))) / 14
check("v451 Wilder ha memoria lunga: su ampiezza in calo sta SOPRA la media a 14",
      _w is not None and _w > _m14 * 1.5, extra=f"wilder={_w:.2f} media14={_m14:.2f}")

# ⚠ NON basta che il NOME esista: il gate deve vedere la DIVISIONE per l'ampiezza, altrimenti
# resta verde su un confronto fatto in percentuale (iniezione che non mordeva, 12/09/2026).
check("v451 la soglia del movimento e' in ATR, mai in percentuale",
      "SOGLIA_ATR" in _BRIEF_CODICE and "non una percentuale" in _BRIEF
      and 'r["escursione_pct"] / r["atr_pct"]' in _BRIEF_CODICE
      and 'abs(q["cp"]) / r["atr_pct"]' in _BRIEF_CODICE)

check("v451 si guarda l'ESCURSIONE oltre alla chiusura (v449)",
      "escursione_pct" in _BRIEF_CODICE
      and 'r.get("escursione_atr")' in _BRIEF_CODICE)

check("v451 le tre sorti di una fonte sono distinte e rese tutte e tre",
      all(x in _BRIEF_CODICE for x in ("titoli_non_letti", "titoli_muti",
                                       "macro_non_lette", "macro_mute"))
      and "NON LETTI (diverso da" in _BRIEF and "letti e senza voci in finestra" in _BRIEF)

check("v451 il filtro macro dichiara di essere a parole e fallibile nei due versi",
      "_e_macro" in _BRIEF_CODICE and "TERMINI_MACRO" in _BRIEF_CODICE
      and "filtro A PAROLE" in _BRIEF and "fallibile in entrambi i versi" in _BRIEF)

# ⚠⚠ WSJ risponde 200 con venti voci ben formate datate GENNAIO 2025. Misurato il 12/09/2026.
check("v451 WSJ resta ESCLUSO e la ragione e' scritta, non dimenticata",
      "feeds.a.dj.com" not in _BRIEF_CODICE and "ESCLUSO DELIBERATAMENTE" in _BRIEF
      and "GENNAIO 2025" in _BRIEF)

check("v451 Reddit, X e StockTwits non sono fonti del brief",
      not any(x in _BRIEF_CODICE for x in ("reddit.com", "//x.com", "twitter.com", "stocktwits")))

# ⚠ RIAGGANCIATO in v452. L'invariante non e' "data.json non compare mai": da v452 il blocco
# macro legge le serie dalla pipeline, che le pubblica con la chiave FRED nei secret di GitHub
# (il repo e' pubblico e l'ambiente delle Routine non eredita variabili: non c'e' altro posto).
# L'invariante vero, scritto nel commento del gate originale, e' piu' stretto: le POSIZIONI non
# devono venire dalla pipeline, cosi' che se la pipeline muore il libro resti vero (v439 —
# stesso riaggancio, stessa ragione, sulla stessa classe).
_CORPO_LIBRO = _BRIEF_CODICE[_BRIEF_CODICE.index("def leggi_libro"):]
_CORPO_LIBRO = _CORPO_LIBRO[:_CORPO_LIBRO.index("\ndef ", 5)]
check("v451 le POSIZIONI vengono da memoria/LIBRO.md, mai dalla pipeline",
      "LIBRO.md" in _CORPO_LIBRO and "data.json" not in _CORPO_LIBRO)
check("v452 il blocco macro legge la pipeline e ne DICHIARA l'eta'",
      "def macro_dalla_pipeline" in _BRIEF_CODICE
      and "updated_at" in _BRIEF_CODICE and "eta_ore" in _BRIEF_CODICE
      and "PIPELINE FERMA DA" in _BRIEF)

# ⚠ RIAGGANCIATO in v452: la chiave FRED non esiste piu' in questo strumento. L'invariante
# che contava non era "senza chiave" ma **senza il dato si dichiara il buco** (v396).
check("v452 senza i dati della pipeline si dichiara il buco invece di tacere",
      "data.json ASSENTE" in _BRIEF_CODICE and "data.json ILLEGGIBILE" in _BRIEF_CODICE
      and "e' il dato che manca" in _BRIEF and "nessun movimento" in _BRIEF)
check("v452 nessuna chiamata diretta a FRED e nessuna chiave nel brief",
      "stlouisfed.org" not in _BRIEF_CODICE and "FRED_API_KEY" not in _BRIEF_CODICE
      and "api_key" not in _BRIEF_CODICE)
# ⚠ Una riga che non porta la data lo DICHIARA invece di prendere quella del run, che sarebbe
#   la data di un'altra cosa (classe v431: l'etichetta dall'orologio e il valore dai dati).
check("v452 una serie senza rilevazione lo dichiara, non eredita la data del run",
      "rilevazione non dichiarata" in _BRIEF
      and "il file non dichiara la rilevazione di questo campo" in _BRIEF)

check("v451 l'etichetta del feed dichiara la PROVENIENZA, non l'attribuzione",
      "NON 'notizia su TK'" in _BRIEF and "in_feed" in _BRIEF_CODICE)

check("v451 le variazioni nominano la seduta e non usano un avverbio (v416)",
      "nell'ultima seduta" in _BRIEF and "seduta del {r.get(" in _BRIEF)

check("v451 il brief dichiara il confine: livelli si', quantita' no",
      "Direzione e livelli si', quantita' no" in _BRIEF and "NON conosce: altri conti" in _BRIEF)

# Il libro si legge davvero: un modulo che importa non e' un parser che funziona.
_pos, _cassa, _sorv = _bf.leggi_libro()
# ⚠ v459: il check pretendeva 13 azioni e 10.000 € — i numeri di UN giorno. Il CEO ha chiuso
#   GOOGL e WDC e dichiarato ~50.000 €, e il check e' andato rosso su un parser corretto mentre
#   il difetto vero (la tilde che faceva sparire la liquidita') gli passava accanto. Ora si
#   confronta il parser con un CONTEGGIO INDIPENDENTE dello stesso file, e la liquidita' deve
#   essere letta qualunque forma il CEO le dia (classe v233/v429: lo stato del giorno non e'
#   una proprieta').
_sez_pos, _usd_ind, _liq_ind = False, 0, None
for _r in Path("memoria/LIBRO.md").read_text(encoding="utf-8").splitlines():
    if _r.startswith("## "):
        _sez_pos = "POSIZIONI" in _r.upper()
    if _sez_pos and re.search(r"\|\s*USD\s*\|", _r):
        _usd_ind += 1
    _ml = re.search(r"Liquidit[^:]*:\D*([\d.]+)", _r)
    if _ml and _liq_ind is None:
        _liq_ind = float(_ml.group(1).replace(".", ""))
check("v451 il parser del libro trova tutte le azioni, il BTP e la liquidita'",
      _usd_ind > 0 and len([p for p in _pos if p["valuta"] == "USD"]) == _usd_ind
      and any(p["tk"].startswith("BTP") for p in _pos)
      and _cassa is not None and _cassa == _liq_ind,
      extra=f"parser {len([p for p in _pos if p['valuta'] == 'USD'])} USD contro {_usd_ind}, cassa={_cassa} contro {_liq_ind}")
check("v451 il PMC di NVDA e' quello confermato dal CEO, non quello vecchio",
      any(p["tk"] == "NVDA" and abs(p["pmc"] - 87.1667) < 0.001 for p in _pos))

# --- le trimestrali: dichiarate DALLA FONTE, non proiettate da noi (v396)
check("v451 il calendario NON passa da FMP (le Routine non portano connettori)",
      "api.nasdaq.com/api/calendar/earnings" in _BRIEF_CODICE
      and "mcp__FMP" not in _BRIEF_CODICE and "le Routine non portano connettori" in _BRIEF)

check("v451 i giorni non letti si distinguono da 'nessuna uscita'",
      "giorni_non_letti" in _BRIEF_CODICE
      and "diverso da 'nessuna uscita'" in _BRIEF
      and "non e' 'nessuna trimestrale mai'" in _BRIEF.lower())

# ⚠ Lo stato si COSTRUISCE, non si prende da un file in /tmp: un check che dipende da cosa
#   c'e' sul disco e' verde o rosso a seconda dell'ambiente, non della proprieta' (v425, v429).
import importlib.util as _ilu2
_sp2 = _ilu2.spec_from_file_location("_bp", "scripts/brief_pagina.py")
_bp = _ilu2.module_from_spec(_sp2); _sp2.loader.exec_module(_bp)

_BASE = {
    "ora": "2026-09-12T14:00:00+00:00", "ora_utc": "2026-09-12T12:00:00+00:00",
    "modo": "mattina", "finestra_h": 16.0, "seduta_base": "2026-09-11",
    "cassa_eur": 10000.0, "secondi": 9.9,
    "tecnica": [{"tk": "MU", "barre": 252, "seduta": "2026-09-11", "px": 975.26,
                 "var_pct": -0.22, "atr": 51.84, "atr_pct": 5.32, "peso": 23.2,
                 "sma20": 964.0, "d20_atr": 0.2, "sma50": 930.0, "d50_atr": 0.9,
                 "sma200": 620.0, "d200_atr": 6.8, "supporto20": 887.61, "resistenza20": 1042.40,
                 "supp_atr": 1.7, "res_atr": 1.3, "dmax52_pct": -22.3,
                 "escursione_pct": None, "escursione_atr": None, "var_atr": 0.04}],
    "news": {"per_titolo": [], "macro": [], "macro_scartate": 0, "titoli_non_letti": [],
             "titoli_muti": [], "macro_non_lette": [], "macro_mute": []},
    "macro_fred": {"stato": "CHIAVE ASSENTE", "serie": []},
}

_vuoto = dict(_BASE); _vuoto["trimestrali"] = {"attesi": [], "giorni_non_letti": [], "finestra": 21}
_html = _bp.genera(_vuoto)
check("v451 senza trimestrali la pagina DICHIARA il buco invece di far sparire il blocco",
      "Trimestrali in arrivo" in _html and "Nessuna trimestrale dichiarata dalla fonte" in _html)

_pieno = dict(_BASE)
_pieno["trimestrali"] = {"finestra": 21, "giorni_non_letti": [],
                         "attesi": [{"tk": "MU", "data": "2026-09-30", "quando": "time-after-hours",
                                     "eps_atteso": "$31.17", "trimestre": "Aug/2026", "giorni": 18}]}
_html2 = _bp.genera(_pieno)
check("v451 con una trimestrale la pagina la pubblica con data, orario e consenso",
      "2026-09-30" in _html2 and "dopo la campana" in _html2
      and "31.17" in _html2 and "fra 18g" in _html2)

check("v451 senza chiave FRED la pagina dichiara il buco, non lo tace",
      "Serie macro assenti" in _html and "e' il dato che manca".replace("e'", "\u00e8") in _html
      or "il dato che manca" in _html)

_PAGINA = Path("scripts/brief_pagina.py").read_text(encoding="utf-8")
check("v451 la pagina non ricalcola e non va in rete: rende gli stessi numeri del testo",
      "atr_wilder" not in _PAGINA and "urllib" not in _PAGINA and "requests" not in _PAGINA)

# ⚠⚠ IL REPO E' PUBBLICO (verificato il 12/09/2026: visibility "public"). Una chiave API
#    committata qui dentro e' una chiave pubblicata. La chiave FRED vive nel prompt delle
#    Routine, che e' privato dell'account, e arriva allo script come variabile d'ambiente.
_CHIAVI_VIETATE = [p for p in Path("config").glob("*key*") if p.is_file()]
check("v451 nessun file di chiavi in config/ (il repo e' pubblico)",
      not _CHIAVI_VIETATE, extra=", ".join(str(p) for p in _CHIAVI_VIETATE))
check("v451 .gitignore blocca comunque config/fred_key.txt",
      "config/fred_key.txt" in Path(".gitignore").read_text(encoding="utf-8"))
# Una chiave FRED e' 32 caratteri esadecimali minuscoli: si cerca la FORMA, non un valore.
import re as _re
_SOSPETTI = []
for _p in list(Path("scripts").glob("*.py")) + list(Path("scripts").glob("*.mjs")) + \
          [Path("CLAUDE.md"), Path("index.html")]:
    if not _p.exists():
        continue
    for _m in _re.finditer(r"(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])", _p.read_text(encoding="utf-8")):
        _SOSPETTI.append(f"{_p}:{_m.group()[:6]}...")
check("v451 nessuna stringa con la forma di una chiave API nei sorgenti",
      not _SOSPETTI, extra=" · ".join(_SOSPETTI[:4]))

# ═══ v454 — IL PARSER LEGGE SOLO LA SEZIONE CHE DICHIARA DI LEGGERE ════════════════════
# Trovato il 14/09/2026 misurando il libro: leggi_libro() scorreva il FILE INTERO e raccoglieva
# anche la tabella delle correlazioni (sezione 4), dove "| MU | 0,40 | 0,71 | WDC |" diventava
# quantita' 0,40, PMC 0,71, valuta WDC. 26 righe invece di 14. Nessun effetto sull'uscita solo
# perche' il filtro valuta=="USD" le scartava PER COINCIDENZA — nessuna correlazione si chiama
# "USD". Il gate v451 verificava la PROVENIENZA (le posizioni vengono da LIBRO.md) e non
# l'ESTRAZIONE (quale tabella). Lo stato si COSTRUISCE: si scrive un LIBRO.md finto con una
# tabella estranea della stessa forma, cosi' il check non dipende da cosa contiene il file vero.
import tempfile as _tf, shutil as _sh, importlib as _il
_FINTO = """# LIBRO finto per il gate

## 1. POSIZIONI — confermate

| Ticker | Quantita | PMC | Valuta | Note |
|---|---|---|---|---|
| AAA | 10 | 5,00 | USD | |
| BBB | 20 | 7,50 | USD | |

**Liquidita: 1.000 €**

## 1bis. SORVEGLIATI

| Ticker | Nota |
|---|---|
| ZZZ | candidato |

## 4. Correlazione media e massima per posizione

| Ticker | media | massima | con | a | b | c |
|---|---|---|---|---|---|---|
| AAA | 0,40 | 0,71 | BBB | 2,87 | 2,51 | 4,06 |
| BBB | 0,38 | 0,71 | AAA | 2,44 | 2,01 | 3,08 |
"""
def _leggi_finto():
    import brief as _b
    _d = _tf.mkdtemp()
    import os as _os
    _os.makedirs(_os.path.join(_d, "memoria"), exist_ok=True)
    open(_os.path.join(_d, "memoria", "LIBRO.md"), "w", encoding="utf-8").write(_FINTO)
    _old = _b.RADICE
    try:
        _b.RADICE = _d
        return _b.leggi_libro()
    finally:
        _b.RADICE = _old
        _sh.rmtree(_d, ignore_errors=True)

_POS_F, _CASSA_F, _SORV_F = _leggi_finto()
check("v454 il parser NON raccoglie la tabella delle correlazioni fra le posizioni",
      len(_POS_F) == 2 and {p["tk"] for p in _POS_F} == {"AAA", "BBB"},
      extra=f"{len(_POS_F)} righe: {[p['tk'] for p in _POS_F]}")
# ⚠ La coincidenza da cui il difetto era coperto: nessuna correlazione si chiama "USD". Se un
#   domani ne nascesse una, il filtro valuta cadrebbe. Qui si verifica che le righe estranee non
#   arrivino proprio, non che il filtro le scarti.
check("v454 nessuna riga con valuta che e' un ticker (era la forma del difetto)",
      all(p["valuta"] in ("USD", "EUR") for p in _POS_F),
      extra=str([(p["tk"], p["valuta"]) for p in _POS_F]))
check("v454 i sorvegliati si leggono, e la riga separatore |---| non e' un ticker",
      [s["tk"] for s in _SORV_F] == ["ZZZ"], extra=str([s["tk"] for s in _SORV_F]))
check("v454 la liquidita' continua a leggersi", _CASSA_F == 1000.0, extra=str(_CASSA_F))

# I SORVEGLIATI non devono toccare NESSUN aggregato del libro: il peso si calcola sul solo
# elenco delle posizioni. Un titolo non posseduto che diluisse i pesi sarebbe la classe v439
# (una seconda copia del libro che invecchia da sola), qui in forma peggiore.
_CORPO_MAIN = _BRIEF_CODICE[_BRIEF_CODICE.index("azioni = [p for p in pos"):]
_CORPO_MAIN = _CORPO_MAIN[:_CORPO_MAIN.index("ora_utc = datetime")]
check("v454 il peso e il patrimonio si calcolano SOLO sulle posizioni, mai sui sorvegliati",
      'tot = sum((idx[p["tk"]].get("px") or 0) * p["qta"] for p in azioni)' in _CORPO_MAIN
      and 'for p in azioni:' in _CORPO_MAIN
      and 'for s in sorv:' in _CORPO_MAIN
      and '"peso"' not in _CORPO_MAIN.split("for s in sorv:")[1])
check("v454 i sorvegliati entrano nella tecnica (altrimenti il monitoraggio non esiste)",
      'tickers = [p["tk"] for p in azioni] + [s["tk"] for s in sorv]' in _BRIEF_CODICE)
# E la riga deve DICHIARARE che non sono posizioni: «sorvegliato» e «posseduto» si leggono
# uguali in una tabella di livelli, ed e' la classe v406.
check("v454 il blocco dei sorvegliati dichiara che non sono posizioni",
      "NON in posizione" in _BRIEF and "zero peso" in _BRIEF)

# ═══ v455 — LA PAGINA DEVE SEPARARE I SORVEGLIATI COME LI SEPARA IL TESTO ═══════════════
# La v454 ha diviso posizioni e sorvegliati nel TESTO del brief e ha lasciato indietro la
# PAGINA: `brief_pagina.py` li ordinava per peso (None -> 0) dentro la stessa griglia, cioe'
# in fondo alle posizioni, indistinguibili da una posizione il cui peso non e' stato
# calcolato. Due rese della stessa domanda che divergono (v161, v207, v443), e qui quella
# sbagliata AFFERMA un possesso che non esiste.
# ⚠ Lo stato si COSTRUISCE: oggi i sorvegliati nel libro sono due, domani potrebbero essere
#   zero e il gate sarebbe verde per assenza del fenomeno (v425, v429, v431, v435).
_spp = _ilu.spec_from_file_location("_bp", "scripts/brief_pagina.py")
_bp = _ilu.module_from_spec(_spp); _spp.loader.exec_module(_bp)

def _riga_finta(tk, peso, sorv=False):
    r = {"tk": tk, "px": 100.0, "var_pct": 0.5, "var_atr": 0.2, "escursione_pct": 1.0,
         "escursione_atr": 0.3, "supporto20": 90.0, "resistenza20": 110.0,
         "sma20": 99.0, "sma50": 98.0, "sma200": 95.0, "seduta": "2026-09-14",
         "atr_pct": 2.5, "peso": peso}
    if sorv:
        r["sorvegliato"] = True; r["peso"] = None
    return r

_DATI_F = {"ora": "2026-09-14T15:45:00", "ora_utc": "2026-09-14T13:45:00", "modo": "pomeriggio",
           "finestra_h": 8.0, "seduta_base": "2026-09-14", "cassa_eur": 10000.0, "secondi": 12.0,
           "tecnica": [_riga_finta("AAA", 60.0), _riga_finta("BBB", 40.0),
                       _riga_finta("ZZZ", None, sorv=True)],
           "news": {"per_titolo": [], "macro": [], "titoli_muti": [], "titoli_non_letti": [],
                    "macro_non_lette": [], "macro_scartate": 0},
           "macro_fred": {"stato": "ok", "eta_ore": 1.0, "serie": []},
           "trimestrali": {"attesi": [], "giorni_non_letti": [], "finestra": 21}}
# ⚠ Nessun try/except intorno a `genera`: un'eccezione inghiottita rende il gate verde per
#   assenza del fenomeno invece che per assenza del difetto, ed e' la trappola pagata quattro
#   volte in questo progetto. Se la resa esplode, la suite deve morire rumorosamente.
_HTML_F = _bp.genera(_DATI_F)

_i_pos = _HTML_F.find("Dove sta ogni posizione")
_i_sorv = _HTML_F.find("Sorvegliati")
check("v455 la pagina rende un blocco SORVEGLIATI separato da quello delle posizioni",
      _i_pos > 0 and _i_sorv > _i_pos, extra=f"pos={_i_pos} sorv={_i_sorv}")
_griglia_pos = _HTML_F[_i_pos:_i_sorv] if _i_sorv > _i_pos > 0 else _HTML_F
check("v455 il sorvegliato NON compare fra le posizioni",
      ">ZZZ<" not in _griglia_pos and ">AAA<" in _griglia_pos,
      extra=f"ZZZ tra le posizioni: {_griglia_pos.count('>ZZZ<')}")
check("v455 il sorvegliato compare nel proprio blocco",
      _i_sorv > 0 and ">ZZZ<" in _HTML_F[_i_sorv:])
# Comparire separati non basta: la pagina deve DIRE cosa sono (v406 — «non ho il dato» e
# «ce l'ho e non te lo passo» si leggono uguali, e qui si legge «posizione senza peso»).
check("v455 il blocco dichiara che non sono posizioni e non hanno peso",
      "non in posizione" in _HTML_F.lower() and "zero peso" in _HTML_F.lower())
# Un sorvegliato che si muove resta nell'elenco dei mossi — e' il motivo per cui e' sorvegliato
# — ma li' dev'essere marcato, altrimenti si legge come una posizione che si e' mossa.
_DATI_M = dict(_DATI_F)
_DATI_M["tecnica"] = [_riga_finta("AAA", 100.0), dict(_riga_finta("ZZZ", None, sorv=True),
                                                      var_atr=3.0, escursione_atr=3.2)]
_HTML_M = _bp.genera(_DATI_M)
_i_m = _HTML_M.find(">ZZZ<")
check("v455 un sorvegliato fra i mossi e' marcato come tale",
      _i_m > 0 and "sorvegliato, non in posizione" in _HTML_M[_i_m:_i_m + 400],
      extra=_HTML_M[_i_m:_i_m + 160].replace(chr(10), " "))
# Senza sorvegliati il blocco NON deve comparire: una sezione vuota si legge come un dato
# mancante, ed e' il ramo che il libro percorre ogni volta che il CEO non ne segue nessuno.
_DATI_V = dict(_DATI_F); _DATI_V["tecnica"] = [_riga_finta("AAA", 100.0)]
check("v455 senza sorvegliati il blocco non compare affatto",
      "Sorvegliati" not in _bp.genera(_DATI_V))

# ============================ v459 — LA SEDUTA DELLA QUOTA ============================
# Variazione ed escursione vengono dalla QUOTA; la data stampata veniva dall'ultima barra
# STORICA, che a seduta in corso e' quella di ieri: "seduta del 01/10" su un -10,8% del 02/10.
# Classe v431 (l'etichetta da una fonte, il valore da un'altra). Lo stato si COSTRUISCE: barre
# che finiscono ieri, quota che dichiara oggi — a qualunque ora giri la suite.
_orig_b, _orig_q = _bf.barre, _bf.quota
try:
    _bf.barre = lambda tk: [{"t": f"2026-09-{g:02d}", "o": 100, "h": 101, "l": 99, "c": 100}
                            for g in range(1, 31)] + [{"t": "2026-10-01", "o": 100, "h": 101, "l": 99, "c": 100}]
    _bf.quota = lambda tk: {"p": 90.0, "cp": -10.0, "h": 101.0, "l": 89.0, "td": "2026-10-02", "ms": "open"}
    _tq = _bf.tecnica("ZZZ")
finally:
    _bf.barre, _bf.quota = _orig_b, _orig_q
check("v459 la tecnica porta la seduta dichiarata dalla QUOTA, distinta dall'ultima barra",
      _tq.get("seduta_quota") == "2026-10-02" and _tq.get("seduta") == "2026-10-01",
      extra=str({k: _tq.get(k) for k in ("seduta", "seduta_quota")}))
check("v459 la riga dei mossi stampa la seduta della quota, non quella della barra",
      "seduta del {r.get('seduta_quota') or r.get('seduta'" in _BRIEF_CODICE)


# ============================ v460 — I NUMERI DELL'ANALISI GIORNALIERA ============================
# Lo strumento dice al CEO quanto rischio porta ogni nome: invarianti che una formula sbagliata
# non soddisfa per caso (v326), su dati COSTRUITI, perche' il fenomeno ci sia (v425).
import numeri_libro as NL
_rg = np.random.default_rng(11)
_f = _rg.normal(0, 0.02, 300)
_R = np.column_stack([_f * b + _rg.normal(0, 0.01, 300) for b in (1.8, 1.0, 0.4)])
_w = np.array([0.5, 0.3, 0.2])
_m = NL.misure_rischio(_R, _w)
check("v460 il contributo al rischio somma a 1 (Euler)", abs(sum(_m["mcr"]) - 1) < 1e-9, str(_m["mcr"]))
check("v460 la volatilita' coincide con sqrt(w'Sw) annualizzata",
      abs(_m["vol_ann"] - math.sqrt(_w @ np.cov(_R, rowvar=False) @ _w * 252)) < 1e-12)
_rho = np.corrcoef(_R, rowvar=False)[np.triu_indices(3, 1)].mean()
check("v460 le scommesse effettive usano l'Herfindahl dei pesi VERI, non 1/k (v430)",
      abs(_m["scommesse_eff"] - 1 / ((1 - _rho) * (_w ** 2).sum() + _rho)) < 1e-9
      and abs(_m["scommesse_eff"] - 1 / (1 / 3 + 2 / 3 * _rho)) > 1e-3, f"{_m['scommesse_eff']}")
check("v460 l'ES al 95% non e' minore del VaR al 95%", _m["es95"] >= _m["var95"] > 0)
check("v460 il nome piu' sensibile al fattore porta piu' rischio del suo peso", _m["mcr"][0] > _w[0])
_pnl, _ret = NL.attribuzione({"A": 10, "B": 5}, {"A": 100.0, "B": None}, {"A": 110.0, "B": 50.0})
check("v460 un titolo senza prezzo iniziale e' un buco, non uno zero (v205)",
      _pnl["B"] is None and _pnl["A"] == 100.0 and abs(_ret - 0.10) < 1e-12, str((_pnl, _ret)))
_src_nl = Path(__file__).with_name("numeri_libro.py").read_text()
check("v460 le posizioni vengono da LIBRO.md, mai dalla pipeline (v439)",
      "leggi_libro()" in _src_nl and "data.json" not in _corpo_di(_src_nl, "calcola"))
check("v460 chi e' fuori dalla matrice si NOMINA nella sintesi (v406)",
      "esclusi_matrice" in _corpo_di(_src_nl, "sintesi") and "fuori matrice" in _src_nl)

# ============================ v461 — PRE-MARKET ============================
_rig = {"A": {"px": 100.0, "esteso_px": 103.0, "atr": 2.0, "resistenza20": 102.0, "supporto20": 90.0, "esteso_fase": "Pre-market"},
        "B": {"px": 50.0, "esteso_px": None, "atr": 1.0, "resistenza20": 55.0, "supporto20": 45.0},
        "C": {"px": 20.0, "esteso_px": 19.0, "atr": 0.5, "resistenza20": 25.0, "supporto20": 19.5}}
_o, _p, _r = NL.movimento_esteso(_rig, {"A": 10, "B": 4})
_d = {x["tk"]: x for x in _o}
check("v461 il P&L esteso usa solo le posizioni e il prezzo esteso", abs(_p - 30.0) < 1e-9 and "pnl" not in _d["C"], str((_p, _d["C"])))
check("v461 la base del rendimento esclude chi non e' quotato fuori sessione (buco, non zero)",
      _d["B"]["esteso"] is None and abs(_r - 30.0 / 1000.0) < 1e-12, str((_d["B"], _r)))
check("v461 un prezzo esteso oltre il livello lo dichiara, nei due versi",
      _d["A"]["oltre"] == "SOPRA la resistenza" and _d["C"]["oltre"] == "SOTTO il supporto" and abs(_d["A"]["res_atr"] + 0.5) < 1e-9)

# ============================ v462 — LE SCHEDE DEL PROGETTO ============================
# Lo stato si COSTRUISCE: i dati del giorno possono non contenere una perdita, un canale sotto
# il rumore o un nome mancante, e il check sarebbe verde per assenza del fenomeno (v425, v429).
import schede_progetto as SP
_riga_perdita = SP.riga_revisioni({"eps_ora": -4.33, "eps_90g_fa": -3.37})
check("v462 su una perdita la revisione si legge dalla DIFFERENZA, non dal rapporto (v400)",
      "AMPLIATA" in _riga_perdita and "28" not in _riga_perdita and "salita" not in _riga_perdita, _riga_perdita)
_riga_utile = SP.riga_revisioni({"eps_ora": 12.0, "eps_90g_fa": 10.0})
check("v462 su un utile la revisione porta verso e percentuale", "in salita del 20,0%" in _riga_utile, _riga_utile)
_f = SP.finestra({"beta": 1.42, "r2": 0.02, "r2_soglia": 0.065, "campione": 60})
check("v462 un canale sotto il rumore non pubblica il beta (v316, v415)",
      "non misurabile" in _f and "1,42" not in _f, _f)
_rc = SP.riga_cassa({"combustione": {"fcf_ttm": -13655000000.0, "cashflow_al": "2026-06-30", "mesi_capex": 3.2,
                                     "cassa": 5524000000.0, "debito": 51608000000.0},
                     "credito": {"copertura": -0.03, "oneri_ttm": 1874199000.0}})
check("v462 la cassa esce solo in rapporti, mai in importi (v404, v447)",
      "3,2 mesi" in _rc and "2026-06-30" in _rc and not any(x in _rc for x in ("5524", "51608", "1874", "13655", "mld")), _rc)
_dati = {"updated_at": "2026-10-06T11:36:10Z",
         "watchlist": [{"ticker": "AAA", "name": "A", "price_asof": "2026-10-05"}], "macro": {}}
_g = SP.genera(_dati, ["AAA"], ["ZZZ"])
check("v462 un nome del libro assente dalla pipeline si NOMINA, non si salta (v406)",
      "ZZZ [SORVEGLIATO] — NON E' NELLA PIPELINE" in _g and "1 nome senza dati" in _g, _g[-200:])
_src_sp = Path(__file__).with_name("schede_progetto.py").read_text()
check("v462 i nomi vengono da LIBRO.md, mai dalla pipeline (v439)",
      "brief.leggi_libro()" in _corpo_di(_src_sp, "main"))

# ============================ v464 — IL COSTO DELL'ATTESA ============================
# Lo stato si COSTRUISCE (v425): un calendario con due date per lo stesso nome, un nome senza
# data, un sorvegliato che non deve entrare fra le scadenze del libro.
_cal = {"finestra": 45, "giorni_non_letti": ["2026-10-20"],
        "attesi": [{"tk": "AAA", "data": "2026-10-27", "giorni": 21}, {"tk": "AAA", "data": "2026-11-30", "giorni": 55},
                   {"tk": "BBB", "data": "2026-10-15", "giorni": 9}, {"tk": "ZZZ", "data": "2026-10-08", "giorni": 2}]}
_a = NL.costo_attesa(100000.0, 0.504, 0.05, 0.07, _cal, ["AAA", "BBB", "CCC"])
check("v464 il costo di una seduta e' il patrimonio per la volatilita' su radice di 252",
      abs(_a["seduta_1s"] - 100000 * 0.504 / math.sqrt(252)) < 1e-6, str(_a["seduta_1s"]))
check("v464 la settimana e' la seduta per radice di 5, e la convenzione si dichiara",
      abs(_a["settimana_1s"] - _a["seduta_1s"] * math.sqrt(5)) < 1e-6
      and "radice di 5" in " ".join(NL.righe_attesa(_a)))
check("v464 VaR ed ES in dollari, e l'ES non e' minore del VaR",
      abs(_a["var_usd"] - 5000) < 1e-6 and abs(_a["es_usd"] - 7000) < 1e-6 and _a["es_usd"] >= _a["var_usd"])
check("v464 la scadenza e' la PRIMA trimestrale del nome, ordinata per data, solo per il libro",
      [(s["tk"], s["data"]) for s in _a["scadenze"]] == [("BBB", "2026-10-15"), ("AAA", "2026-10-27")]
      and _a["prima"]["tk"] == "BBB", str(_a["scadenze"]))
_ra = "\n".join(NL.righe_attesa(_a))
check("v464 un nome senza data si NOMINA e non si legge come 'nessuna uscita' (v406)",
      _a["senza_data"] == ["CCC"] and "CCC" in _ra and "non 'nessuna uscita'" in _ra, _ra)
check("v464 i giorni del calendario non letti si dichiarano", "NON letti" in _ra, _ra)
_a0 = NL.costo_attesa(1.0, 0.1, 0.01, 0.02, {"finestra": 45, "attesi": []}, ["AAA"])
check("v464 senza scadenze lo dice invece di tacere", "nessuna trimestrale dichiarata" in "\n".join(NL.righe_attesa(_a0)))
check("v464 il costo dell'attesa entra nella sintesi giornaliera (collegamento, v399)",
      "costo_attesa(" in _corpo_di(_src_nl, "calcola") and "righe_attesa(" in _corpo_di(_src_nl, "sintesi"))

# ============================ v465 — SPREAD CCC NEL BRIEF ============================
import tempfile as _tf, json as _js, os as _os
import brief
_tmp = _tf.mkdtemp()
_os.makedirs(_os.path.join(_tmp, "data"))
_js.dump({"updated_at": "2026-10-06T10:00:00Z", "macro": {"credit_ccc": {
    "valore": 12.11, "data": "2026-10-05", "min_60": 9.69, "salita_60_pp": 2.42, "mese_fa": 10.55}}},
    open(_os.path.join(_tmp, "data", "data.json"), "w"))
_rad = brief.RADICE
brief.RADICE = _tmp
try:
    _mc = brief.macro_dalla_pipeline()
finally:
    brief.RADICE = _rad
_rcc = [s for s in _mc["serie"] if s["nome"].startswith("Spread CCC")]
check("v465 il brief porta lo spread CCC con la sua data e la salita dal minimo",
      len(_rcc) == 1 and _rcc[0]["data"] == "2026-10-05" and "+2.42 pp" in (_rcc[0]["nota"] or ""),
      str(_rcc))

# ============================ v467 — IL CREDITO ARRIVA AL LIBRO? ============================
# Lo stato si COSTRUISCE (v425, v429): domani il libro puo' non avere nessun nome che brucia cassa.
_tit = [{"tk": "AAA", "peso": 0.5, "pnl_21": 100.0, "valore": 1100.0},     # si autofinanzia, +10%
        {"tk": "BBB", "peso": 0.3, "pnl_21": -100.0, "valore": 900.0},     # brucia cassa, -10%
        {"tk": "CCC", "peso": 0.1, "pnl_21": 0.0, "valore": 300.0},        # brucia cassa, 0%
        {"tk": "DDD", "peso": 0.1, "pnl_21": 50.0, "valore": 300.0}]       # flusso ignoto
_tec = [{"tk": "AAA", "d50_atr": 1.0}, {"tk": "BBB", "d50_atr": -0.5}, {"tk": "CCC", "d50_atr": 0.4},
        {"tk": "DDD", "d50_atr": -2.0}]
_fcf = {"AAA": 5.0, "BBB": -1.0, "CCC": -1.0, "DDD": None}
_c = NL.dipendenti_credito(_tit, _tec, _fcf, {"salita_60_pp": 2.0})
check("v467 il gruppo e' chi ha flusso di cassa NEGATIVO, letto dal segno (v404)",
      [d["tk"] for d in _c["dipendenti"]] == ["BBB", "CCC"] and abs(_c["peso_dipendenti"] - 0.4) < 1e-9, str(_c["dipendenti"]))
check("v467 un nome senza flusso di cassa NON finisce fra gli autofinanziati: si nomina (v406)",
      _c["ignoti"] == ["DDD"] and "DDD" in "\n".join(NL.righe_credito(_c)), str(_c["ignoti"]))
check("v467 rendimento del gruppo = P&L su valore INIZIALE (-100 su 1000 e 0 su 300 = -7,69%)",
      abs(_c["ret21_dipendenti"] - (-100 / 1300)) < 1e-9 and abs(_c["ret21_autofinanziati"] - 100 / 1000) < 1e-9,
      str((_c["ret21_dipendenti"], _c["ret21_autofinanziati"])))
check("v467 la quota sotto la media 50 e' sul PESO del gruppo, non sul numero di nomi (0,3/0,4)",
      abs(_c["quota_sotto_50"] - 0.75) < 1e-9, str(_c["quota_sotto_50"]))
check("v467 tre condizioni vere -> conferma ACCESA, e dichiara di non essere un secondo segnale (B3)",
      _c["arrivato_al_libro"] and "ACCESA" in "\n".join(NL.righe_credito(_c))
      and "non un secondo segnale" in "\n".join(NL.righe_credito(_c)))
_c2 = NL.dipendenti_credito(_tit, _tec, _fcf, {"salita_60_pp": 1.0})
check("v467 con il CCC sotto la soglia del semaforo la conferma e' spenta (la soglia e' la STESSA, 1,5)",
      not _c2["arrivato_al_libro"] and _c2["misurabile"] and NL.SOGLIA_CCC_PP == 1.5)
_c3 = NL.dipendenti_credito(_tit, _tec, _fcf, None)
check("v467 senza CCC la conferma e' NON MISURABILE, non 'spenta' (un buco non e' uno zero)",
      not _c3["misurabile"] and "NON MISURABILE" in "\n".join(NL.righe_credito(_c3)))
_c4 = NL.dipendenti_credito(_tit, _tec, {"AAA": 1.0, "BBB": 1.0, "CCC": 1.0, "DDD": 1.0}, {"salita_60_pp": 2.0})
check("v467 senza nomi che bruciano cassa lo dice invece di tacere",
      _c4["dipendenti"] == [] and "nessuna posizione" in "\n".join(NL.righe_credito(_c4)))
check("v467 il blocco entra nella sintesi giornaliera (collegamento, v399)",
      "dipendenti_credito(" in _corpo_di(_src_nl, "calcola") and "credito_dalla_pipeline(" in _corpo_di(_src_nl, "calcola")
      and "righe_credito(" in _corpo_di(_src_nl, "sintesi"))
_tmp2 = _tf.mkdtemp(); _os.makedirs(_os.path.join(_tmp2, "data"))
_js.dump({"portfolio": [], "watchlist": [{"ticker": "BBB", "combustione": {"fcf_ttm": -3.0}}],
          "macro": {"credit_ccc": {"salita_60_pp": 2.42}}}, open(_os.path.join(_tmp2, "data", "data.json"), "w"))
brief.RADICE = _tmp2
try:
    _f, _cc = NL.credito_dalla_pipeline(["BBB", "ZZZ"])
finally:
    brief.RADICE = _rad
check("v467 la lettura dalla pipeline: segno del flusso e CCC dalle chiavi VERE (v196, v416)",
      _f == {"BBB": -3.0, "ZZZ": None} and _cc == {"salita_60_pp": 2.42}, str((_f, _cc)))

# ============================ v468 — ROTAZIONE SU PREZZI DI OGGI ============================
import rotazione as ROT
check("v468 settore IN TENDENZA solo con prezzo sopra la 200 E media 50 in salita",
      ROT.stato_settore(110, 100, 1.0) == "IN TENDENZA" and ROT.stato_settore(110, 100, -1.0) == "MISTO"
      and ROT.stato_settore(90, 100, -1.0) == "IN RIBASSO" and ROT.stato_settore(None, 100, 1.0) == "NON MISURABILE")
_st = lambda d50, corr, px=110, s200=100, p=1.0: ROT.stato_titolo(px, s200, p, d50, corr)
check("v468 stato del titolo: ogni ramo raggiungibile (v234)",
      _st(0.5, 0.1) == "CANDIDATO" and _st(3.5, 0.1) == "ESTESO" and _st(2.5, 0.1) == "TIRATO"
      and _st(-1.5, 0.1) == "DEBOLE" and _st(0.5, 0.1, p=-0.5) == "DEBOLE"
      and _st(0.5, 0.1, px=90) == "SOTTO LA 200" and _st(0.5, 0.7) == "LEGATO AL LIBRO"
      and _st(None, 0.1) == "NON MISURABILE" and _st(0.5, None).startswith("CANDIDATO (correlazione non"))
check("v468 un nome molto correlato al libro NON e' candidato: non aggiunge una scommessa (v410)",
      _st(0.5, ROT.SOGLIA_CORR) == "LEGATO AL LIBRO" and _st(0.5, ROT.SOGLIA_CORR - 0.01) == "CANDIDATO")
# correlazione allineata per DATA, mai per posizione (v207): stesse serie, una con un buco.
import random as _rnd
_r = _rnd.Random(7)
_date = [f"2026-{m:02d}-{g:02d}" for m in range(1, 7) for g in range(1, 21)]
_a = {t: _r.gauss(0, 0.01) for t in _date}
_b = dict(_a); del _b[_date[100]]   # dentro la finestra delle ultime 60 date: fuori non discrimina
check("v468 correlazione per DATA: un buco in una serie non sfasa le altre (identiche -> 1)",
      abs(ROT.correlazione(_a, _b) - 1) < 1e-9, str(ROT.correlazione(_a, _b)))
check("v468 sotto 30 date comuni la correlazione e' un buco, non un numero",
      ROT.correlazione({t: _a[t] for t in _date[:20]}, _a) is None)
_bp = {"AAA": [{"t": "d1", "c": 100}, {"t": "d2", "c": 110}, {"t": "d3", "c": 121}],
       "BBB": [{"t": "d1", "c": 50}, {"t": "d3", "c": 50}]}
_sl = ROT.serie_libro(_bp, {"AAA": 1, "BBB": 2})
check("v468 serie del libro: un titolo senza la data esce da quella data, non vale zero (v205)",
      abs(_sl["d2"] - math.log(1.1)) < 1e-9, str(_sl))
check("v468 senza la composizione degli ETF lo dice, non tace (v406)",
      "NON DISPONIBILE" in "\n".join(ROT.righe({"universo_assente": True})))
check("v468 i prezzi si scrivono con la virgola decimale (v442)", ROT.prezzo(1045.56) == "1.045,56")
_src_rot = Path(__file__).with_name("rotazione.py").read_text()
check("v468 l'universo viene dalla composizione dichiarata (macro.tilt), non da un elenco a mano (C10)",
      "tilt" in _corpo_di(_src_rot, "raccogli") and "prime" in _corpo_di(_src_rot, "raccogli"))
check("v468 le posizioni vengono da LIBRO.md (v439)", "leggi_libro()" in _corpo_di(_src_rot, "raccogli"))
_fa = (Path(__file__).resolve().parent.parent / "memoria" / "FORMATO_ANALISI.md").read_text()
check("v468 la rotazione e' nel formato dell'analisi giornaliera (collegamento, v399)",
      "rotazione.py" in _fa)

# ============================ v469 — CANDIDATI CON TECNICA, VOLUMI E NOTIZIE ============================
_up = [{"t": f"d{i:03d}", "c": 100 + i, "v": 1000} for i in range(150)]
check("v469 RSI: serie che sale sempre vale 100 (perdita media zero, v316)", ROT.rsi_wilder(_up) == 100.0)
check("v469 RSI sotto 100 barre e' un buco, non un numero (v436)", ROT.rsi_wilder(_up[:99]) is None)
_alt = [{"t": f"d{i:03d}", "c": 100 + (1 if i % 2 else -1), "v": 1000} for i in range(150)]
check("v469 RSI: rialzi e ribassi uguali stanno a 50", abs(ROT.rsi_wilder(_alt) - 50) < 2, str(ROT.rsi_wilder(_alt)))
_vb = [{"t": f"d{i:03d}", "c": 100, "v": 1000} for i in range(100)]
_vb[-1] = {"t": "d099", "c": 100, "v": 3000}
_vo = ROT.volumi(_vb)
check("v469 volume dell'ultima seduta contro la media delle 20 PRECEDENTI (3000/1000 = 3)",
      abs(_vo["vol_ultima_rel"] - 3.0) < 1e-9 and _vo["vol_seduta"] == "d099", str(_vo))
_vb2 = list(_vb); _vb2[-5] = {"t": "d095", "c": 100, "v": None}
check("v469 una seduta senza volume rende il dato non misurabile, non zero (v205)",
      ROT.volumi(_vb2)["vol_ultima_rel"] is None)
_ocand = {"universo_assente": False, "settori": [{"etf": "XXX", "nome": "Prova", "stato": "IN TENDENZA",
          "m1": 1.0, "m3": 5.0, "d50_atr": 1.0, "d200_atr": 2.0, "corr_libro": 0.1, "titoli": [
          {"tk": "AAA", "stato": "CANDIDATO", "nel_libro": False, "px": 10.0, "m1": 1, "m3": 2, "dmax52": -3,
           "rsi": 55, "atr_pct": 2, "sma20": 9.9, "d20_atr": 0.2, "sma50": 9.5, "d50_atr": 1.0, "pend50": 2,
           "sma200": 9, "d200_atr": 2, "supp": 9.5, "supp_atr": 1, "res": 11, "res_atr": 2,
           "vol_ultima_rel": 1.2, "vol_20_su_60": 1.1, "vol_seduta": "2026-10-06", "corr_libro": 0.1},
          {"tk": "BBB", "stato": "ESTESO", "nel_libro": False},
          {"tk": "CCC", "stato": "CANDIDATO", "nel_libro": True}]}]}
# CCC ha i campi completi: se il filtro sul libro cadesse, deve comparire, non far esplodere la resa
_ocand["settori"][0]["titoli"][2] = {**_ocand["settori"][0]["titoli"][0], "tk": "CCC", "nel_libro": True}
_rc = "\n".join(ROT.righe_candidati(_ocand, {"AAA": {"stato": "HTTP 429", "voci": []}}))
check("v469 si elencano SOLO i candidati fuori dal libro, e il settore dichiara quanti su quanti",
      "AAA (" in _rc and "BBB" not in _rc and "CCC (" not in _rc and "candidati 1 su 3" in _rc, _rc)
check("v469 feed non letto e nessuna notizia si leggono DIVERSI (v389)",
      "NON letto" in _rc and "nessuna voce" in "\n".join(ROT.righe_candidati(_ocand, {"AAA": {"stato": "ok", "voci": []}})))
check("v469 la vista dei candidati e' quella di default (collegamento, v399)",
      "righe_candidati(o, notizie_candidati(o))" in _src_rot)


# ============================ v470 — ASTE DEL TESORO USA ============================
# Il 07/10/2026 l'analisi ha scritto tre volte "asta del decennale alle 17:00" presa da un
# calendario web: era l'ora UTC, in Italia erano le 19:00. L'orario ora si legge dalla fonte
# ufficiale (TreasuryDirect, ora di New York) e si converte col FUSO. Lo stato si COSTRUISCE
# (v425, v429): una http finta, nessuna rete, nessuna dipendenza dal giorno in cui gira.
from datetime import datetime as _dt470, timezone as _tz470
_R = _bf.ROMA
_casi_fuso = {("2026-10-07T00:00:00", "19:00"),   # entrambe in ora legale: 6 ore
              ("2026-10-28T00:00:00", "18:00"),   # Roma gia' in ora solare, New York no: 5 ore
              ("2026-11-10T00:00:00", "19:00"),   # entrambe in ora solare: 6 ore
              ("2026-03-10T00:00:00", "18:00")}   # New York gia' in ora legale, Roma no: 5 ore
_esiti_fuso = {(g, (_bf.ora_da_new_york(g, "01:00 PM") or _dt470(2000, 1, 1)).strftime("%H:%M"))
               for g, _ in _casi_fuso}
check("v470 l'ora di New York si converte col FUSO: un +6 o un +5 a mano sbagliano due casi su quattro",
      _esiti_fuso == _casi_fuso, str(sorted(_esiti_fuso)))
check("v470 un'ora illeggibile resta un buco, non un orario indovinato (v199)",
      _bf.ora_da_new_york("2026-10-07T00:00:00", "") is None
      and _bf.ora_da_new_york(None, "01:00 PM") is None)

def _asta(term, orig, giorno, tipo="Note", ora="01:00 PM", mld=None, tips="No", frn="No",
          rend=None, cop=None, cusip=None, rip="No"):
    return {"securityType": tipo, "securityTerm": term, "originalSecurityTerm": orig,
            "auctionDate": giorno + "T00:00:00", "closingTimeCompetitive": ora,
            "offeringAmount": str(int(mld * 1e9)) if mld else "", "tips": tips, "floatingRate": frn,
            "highYield": rend or "", "bidToCoverRatio": cop or "", "cusip": cusip or term + giorno,
            "reopening": rip}

_ANNUNCIATE = [
    _asta("9-Year 10-Month", "10-Year", "2026-10-07", mld=39, cusip="C10", rip="Yes"),
    _asta("29-Year 10-Month", "30-Year", "2026-10-08", tipo="Bond", mld=22, cusip="C30", rip="Yes"),
    _asta("17-Week", "17-Week", "2026-10-07", tipo="Bill", ora="11:30 AM", mld=75),
    _asta("2-Year", "2-Year", "2026-10-08", mld=28, frn="Yes"),
    _asta("5-Year", "5-Year", "2026-10-09", mld=24, tips="Yes"),
    _asta("20-Year", "20-Year", "2026-10-30", tipo="Bond", mld=13),          # fuori finestra
]
_NOTE = [
    _asta("9-Year 11-Month", "10-Year", "2026-09-09", rend="4.8340", cop="2.710000"),
    _asta("10-Year", "10-Year", "2026-08-12", rend="4.2000", cop="2.500000"),
    _asta("3-Year", "3-Year", "2026-10-06", rend="4.9320", cop="2.620000"),
    _asta("3-Year", "3-Year", "2026-09-08", rend="4.4740", cop="2.720000"),
    _asta("5-Year", "5-Year", "2026-09-23", rend="5.0330", cop="2.210000"),  # NOMINALE, non TIPS
]
_BOND = [_asta("29-Year 11-Month", "30-Year", "2026-09-10", tipo="Bond", rend="5.3080", cop="2.610000")]

def _http_finta(annunciate=_ANNUNCIATE, note=_NOTE, bond=_BOND, guasto=None):
    def leggi(url, timeout=20):
        if guasto and guasto in url:
            raise RuntimeError("HTTP 503")
        if "/upcoming" in url:
            return annunciate
        return note if "type=Note" in url else bond
    return leggi

_alle13 = _dt470(2026, 10, 7, 13, 0, tzinfo=_R)
_a = _bf.aste_tesoro(adesso=_alle13, leggi=_http_finta())
_sc = [x["scadenza"] for x in _a["prossime"]]
check("v470 solo note e bond nella finestra: fuori bills, tasso variabile e aste oltre i 7 giorni",
      _sc == ["10 anni", "30 anni", "5 anni indicizzato all'inflazione"], str(_sc))
_d10 = _a["prossime"][0] if _a["prossime"] else {}
check("v470 il decennale porta l'ora italiana DICHIARATA dalla fonte: 07/10 19:00, 39 mld, riapertura",
      _d10.get("quando") == "07/10 19:00" and _d10.get("importo_mld") == 39 and _d10.get("riapertura") is True,
      str(_d10))
check("v470 la riapertura si confronta col PROPRIO titolo (termine originale) e con l'asta piu' recente",
      (_d10.get("precedente") or {}).get("data") == "09/09"
      and (_d10.get("precedente") or {}).get("rendimento") == 4.834, str(_d10.get("precedente")))
_tips = [x for x in _a["prossime"] if "indicizzato" in x["scadenza"]]
check("v470 un titolo indicizzato non si confronta con il nominale della stessa durata",
      len(_tips) == 1 and _tips[0]["precedente"] is None, str(_tips))
check("v470 gli esiti degli ultimi tre giorni escono con l'asta precedente accanto",
      [(x["data"], x["scadenza"], (x["precedente"] or {}).get("data")) for x in _a["concluse"]]
      == [("06/10", "3 anni", "08/09")], str(_a["concluse"]))

_alle20 = _dt470(2026, 10, 7, 20, 0, tzinfo=_R)
_b20 = _bf.aste_tesoro(adesso=_alle20, leggi=_http_finta())
_ch = {x["scadenza"]: x["chiusa"] for x in _b20["prossime"]}
_t20 = "\n".join(_bf.righe_aste(_b20))
check("v470 passata l'ora di chiusura l'asta non si legge piu' come un appuntamento",
      _ch.get("10 anni") is True and _ch.get("30 anni") is False and "CHIUSA" in _t20, str(_ch))
_con_esito = _NOTE + [_asta("9-Year 10-Month", "10-Year", "2026-10-07", rend="5.2500",
                            cop="2.400000", cusip="C10")]
_c = _bf.aste_tesoro(adesso=_alle20, leggi=_http_finta(note=_con_esito))
check("v470 un'asta con l'esito pubblicato sta fra gli esiti e NON anche fra le prossime",
      "10 anni" not in [x["scadenza"] for x in _c["prossime"]]
      and ("07/10", "10 anni") in [(x["data"], x["scadenza"]) for x in _c["concluse"]], str(_c))

# Le tre sorti distinte, per ciascuna delle due letture (v389)
_t_ko = "\n".join(_bf.righe_aste(_bf.aste_tesoro(adesso=_alle13, leggi=_http_finta(guasto="/upcoming"))))
_t_vuoto = "\n".join(_bf.righe_aste(_bf.aste_tesoro(adesso=_alle13, leggi=_http_finta(annunciate=[]))))
_t_esiti = "\n".join(_bf.righe_aste(_bf.aste_tesoro(adesso=_alle13, leggi=_http_finta(guasto="/auctioned"))))
check("v470 calendario NON letto e nessuna asta si leggono DIVERSI",
      "calendario NON letto" in _t_ko and "diverso da 'nessuna asta'" in _t_ko
      and "nessuna asta annunciata" in _t_vuoto and "NON letto" not in _t_vuoto, _t_ko + " || " + _t_vuoto)
check("v470 esiti non letti si dichiarano, e il calendario resta",
      "esiti NON letti" in _t_esiti and "07/10 19:00 ora italiana" in _t_esiti, _t_esiti)
check("v470 senza il blocco il brief lo dice invece di tacerlo",
      "non lette in questo run" in "\n".join(_bf.righe_aste(None)))

# Collegamento, non controllo (v399, v443): la fetch arriva nel brief e nella pagina
check("v470 il brief chiama le aste e le passa alla resa (collegamento)",
      "aste = aste_tesoro()" in _corpo_di(_BRIEF_CODICE, "main")
      and '"aste": aste' in _corpo_di(_BRIEF_CODICE, "main")
      and 'righe_aste(dati.get("aste"))' in _corpo_di(_BRIEF_CODICE, "componi"))
_dati470 = {"ora": _alle13, "ora_utc": _alle13.astimezone(_tz470.utc), "modo": "pomeriggio",
            "finestra_h": 8.0, "tecnica": [], "seduta_base": "2026-10-06", "aste": _a,
            "trimestrali": {"attesi": [], "giorni_non_letti": [], "finestra": 21},
            "news": {"per_titolo": [], "macro": [], "macro_scartate": 0, "titoli_non_letti": [],
                     "titoli_muti": [], "macro_non_lette": [], "macro_mute": []},
            "macro_fred": {"stato": "CHIAVE ASSENTE", "serie": []}}
_testo470 = _bf.componi("pomeriggio", _dati470)
check("v470 il testo del brief porta il blocco e l'ora italiana nell'intestazione",
      "07/10 19:00 ora italiana · 10 anni" in _testo470
      and _testo470.splitlines()[0].endswith("13:00 ora italiana"), _testo470[:300])

# L'ora italiana dal FUSO anche per l'intestazione: il "+2 ore" a mano era giusto solo d'estate
_main470 = _corpo_di(_BRIEF_CODICE, "main")
check("v470 nessuno scarto orario scritto a mano, e nessun 'CEST' fisso nel brief o nella pagina",
      "timedelta(hours=2)" not in _BRIEF_CODICE and "astimezone(ROMA)" in _main470
      and "CEST" not in _BRIEF_CODICE and "CEST" not in _solo_codice_py(_PAGINA))

# ⚠ un modulo proprio: il nome _bp e' stato riusato piu' sotto per un dizionario (v468)
_sp470 = _ilu.spec_from_file_location("_bp470", "scripts/brief_pagina.py")
_pagmod470 = _ilu.module_from_spec(_sp470); _sp470.loader.exec_module(_pagmod470)
_pag470 = dict(_BASE); _pag470["trimestrali"] = {"attesi": [], "giorni_non_letti": [], "finestra": 21}
_pag470["aste"] = _a
_h470 = _pagmod470.genera(_pag470)
_pag470b = dict(_pag470); _pag470b.pop("aste")
check("v470 la pagina rende le STESSE ore del testo, e dichiara il blocco mancante",
      "Aste del Tesoro USA" in _h470 and "07/10 19:00 ora italiana" in _h470
      and "10 anni (riapertura)" in _h470 and "39 mld $" in _h470
      and "Aste non lette in questo run" in _pagmod470.genera(_pag470b))


# ============================ v471 — TARGET, BETA, VOLATILITA', VOLUMI CONCLUSI ============================
# Richiesta del CEO (07/10/2026): nella sezione 7 target, movimento a un mese, volumi e beta.
# E il difetto dei volumi trovato lo stesso giorno: a borsa aperta la barra di OGGI e' in
# formazione e dava 0,03-0,3x la media su tutti i titoli. Lo stato si COSTRUISCE (v425).
from datetime import datetime as _dt471
_NY = ROT.brief.NEW_YORK
_vb471 = [{"t": f"2026-06-{(i % 28) + 1:02d}" if i < 99 else "x", "c": 100, "v": 1000} for i in range(101)]
for _i in range(101):
    _vb471[_i]["t"] = f"2026-{6 + _i // 30:02d}-{(_i % 30) + 1:02d}"
_vb471[-1] = {"t": "2026-10-07", "c": 100, "v": 50}        # la barra di oggi, appena iniziata
_vb471[-2] = {"t": "2026-10-06", "c": 100, "v": 3000}      # l'ultima seduta conclusa
_alle11 = _dt471(2026, 10, 7, 11, 0, tzinfo=_NY)
_alle17 = _dt471(2026, 10, 7, 17, 0, tzinfo=_NY)
check("v471 a borsa aperta la barra di oggi e' in formazione, dopo la campana no",
      ROT.seduta_in_corso(_vb471, _alle11) is True and ROT.seduta_in_corso(_vb471, _alle17) is False
      and ROT.seduta_in_corso(_vb471, _dt471(2026, 10, 8, 11, 0, tzinfo=_NY)) is False)
_v11 = ROT.volumi(_vb471, _alle11)
check("v471 i volumi parlano dell'ultima seduta CONCLUSA, non di quella in corso",
      _v11["vol_seduta"] == "2026-10-06" and abs(_v11["vol_ultima_rel"] - 3.0) < 1e-9, str(_v11))
_v17 = ROT.volumi(_vb471, _alle17)
check("v471 dopo la campana la seduta di oggi e' conclusa e conta",
      _v17["vol_seduta"] == "2026-10-07" and _v17["vol_ultima_rel"] < 0.1, str(_v17))

# Beta: un titolo che fa il doppio del mercato ha beta 2 e R2 1, anche con una data mancante
# (allineamento per DATA, v207); sotto 60 date comuni non e' una misura.
_rm = {f"d{i:03d}": ((i * 37) % 11 - 5) / 1000 for i in range(200)}
_rt = {k: 2 * v for k, v in _rm.items() if k != "d100"}
_b, _r2, _nb = ROT.beta_mercato(_rt, _rm)
check("v471 beta sull'S&P 500 allineato per data, col suo R2",
      _b is not None and abs(_b - 2) < 1e-9 and abs(_r2 - 1) < 1e-9 and _nb == 199, f"{_b} {_r2} {_nb}")
check("v471 sotto 60 date comuni il beta e' un buco, non un numero",
      ROT.beta_mercato({k: _rt[k] for k in list(_rt)[:40]}, _rm)[0] is None)
_alt = {f"d{i:03d}": (0.01 if i % 2 else -0.01) for i in range(250)}
check("v471 volatilita' annua = deviazione giornaliera x radice di 252",
      abs(ROT.vol_annua(_alt) - 0.01 * (250 / 249) ** 0.5 * 252 ** 0.5 * 100) < 1e-6, str(ROT.vol_annua(_alt)))

# Target: dalla pipeline, e se il titolo non e' seguito si DICHIARA (v396)
_tg = ROT.target_pipeline({"watchlist": [{"ticker": "AAA", "analisti": {"target_mediana": 120, "target_min": 90,
                                                                        "target_max": 150}},
                                         {"ticker": "BBB", "analisti": {}}]})
check("v471 il target viene dalla pipeline e chi non ce l'ha non riceve un numero",
      _tg == {"AAA": {"mediana": 120, "min": 90, "max": 150}}, str(_tg))
_rtb_si = ROT.riga_target_beta({"target": _tg["AAA"], "target_dist": 20.0, "beta_spy": 1.5, "r2_spy": 0.3,
                                "sedute_beta": 250, "vol_annua": 40})
_rtb_no = ROT.riga_target_beta({"target": None, "beta_spy": None})
check("v471 la riga porta target con distanza, beta col suo R2 e campione, volatilita'",
      "120,00 (+20,0% dal prezzo)" in _rtb_si and "beta S&P 500 1,50 (R2 0,30, 250 sedute)" in _rtb_si
      and "40%" in _rtb_si, _rtb_si)
check("v471 senza target e senza beta la riga lo dichiara",
      "titolo non seguito dalla pipeline" in _rtb_no and "beta S&P 500 n.d." in _rtb_no, _rtb_no)

# Collegamento, non controllo (v399, v443)
_racc471 = _corpo_di(_src_rot, "raccogli")
check("v471 la scheda riceve la serie dell'S&P 500 e i target, e la watchlist esce di default",
      'rendimenti_per_data(B["SPY"])' in _racc471 and "scheda(tk, B.get(tk), rlibro, rspy, target)" in _racc471
      and "righe_watchlist(o)" in _src_rot.split("if __name__")[-1] and "riga_target_beta(t)" in _corpo_di(_src_rot, "righe_candidati"))

# ============================ v472 — VOLUMI COME PERCENTILE DELL'ANNO ============================
# Il CEO: "non capisco il valore dei volumi (dammi una % da 0 a 100)". Lo stato si COSTRUISCE:
# un anno di volumi crescenti 1..250, cosi' la posizione di ogni seduta e' nota per costruzione.
_vp = [{"t": f"d{i:03d}", "c": 100, "v": 1000 + i} for i in range(250)]
_vpo = ROT.volumi(_vp)
check("v472 la seduta piu' scambiata dell'anno sta vicino a 100, e la media a 20 piu' alta anche",
      _vpo["vol_pct_seduta"] > 99 and _vpo["vol_pct_20"] > 99 and _vpo["vol_campione"] == 250, str(_vpo))
_vp_min = list(_vp); _vp_min[-1] = {"t": "d249", "c": 100, "v": 1}
check("v472 la seduta meno scambiata dell'anno sta vicino a 0",
      ROT.volumi(_vp_min)["vol_pct_seduta"] < 1, str(ROT.volumi(_vp_min)))
_vp_mid = list(_vp); _vp_mid[-1] = {"t": "d249", "c": 100, "v": 1124.5}
check("v472 una seduta a meta' dell'anno sta a 50, cioe' nella norma",
      abs(ROT.volumi(_vp_mid)["vol_pct_seduta"] - 50) < 1, str(ROT.volumi(_vp_mid)["vol_pct_seduta"]))
check("v472 midrank: un anno di volumi tutti uguali da' 50, non 0 ne' 100",
      ROT.percentile_midrank(5, [5] * 100) == 50.0 and ROT.percentile_midrank(5, []) is None)
_vp_buco = list(_vp); _vp_buco[100] = {"t": "d100", "c": 100, "v": None}
_vpb = ROT.volumi(_vp_buco)
check("v472 una seduta senza volume esce dal confronto: un buco non e' uno zero (v205)",
      _vpb["vol_campione"] == 249 and _vpb["vol_pct_seduta"] > 99, str(_vpb))
_rv = ROT.riga_volumi({"vol_seduta": "2026-10-06", "vol_pct_seduta": 12.3, "vol_pct_20": 71.0, "vol_campione": 250})
check("v472 la riga dice cosa significano 0, 50 e 100, e porta i due percentili e il campione",
      "0 = minimo dell'anno, 100 = massimo, 50 = norma" in _rv and "12/100" in _rv and "71/100" in _rv
      and "250 sedute" in _rv and "x la media" not in _rv, _rv)
check("v472 senza dato la riga dice n.d., non zero",
      ROT.riga_volumi({}).count("n.d.") == 3, ROT.riga_volumi({}))

# ============================ v473 — GLI INGRESSI SULLA WATCHLIST E IL COMANDO UNICO ============================
# Il CEO (09/10/2026): "rendi strutturale questa ultima analisi. Quando ti dico aggiorna analisi
# devi darmi tutte le informazioni che ti ho chiesto di rendere strutturali". Lo stato si
# COSTRUISCE (v425, v429): nessuna rete, nessuna dipendenza dal giorno in cui gira la suite.
import random as _rnd473
_g473 = _rnd473.Random(473)
_disaccordi = []
for _ in range(3000):
    _s50 = _g473.uniform(50, 150); _atr = _g473.uniform(0.5, 8)
    _s200 = _s50 + _g473.uniform(-25, 25); _px = _s50 + _g473.uniform(-6, 6) * _atr
    _pend = _g473.uniform(-3, 3); _corr = _g473.uniform(-0.5, 0.9)
    _z = ROT.zona_ingresso({"px": _px, "sma50": _s50, "sma200": _s200, "atr": _atr})
    _dentro = (not _z["vuota"]) and _z["basso"] <= _px <= _z["alto"]
    _cand = ROT.stato_titolo(_px, _s200, _pend, (_px - _s50) / _atr, _corr) == "CANDIDATO"
    if _cand != (_dentro and _pend > 0 and _corr < ROT.SOGLIA_CORR):
        _disaccordi.append((round(_px, 2), round(_s50, 2), round(_s200, 2), round(_atr, 2)))
check("v473 la zona d'ingresso e' la convenzione CANDIDATO tradotta in prezzi: le due letture non divergono",
      not _disaccordi, f"{len(_disaccordi)} disaccordi su 3000, es. {_disaccordi[:3]}")

_base473 = {"px": 100.0, "sma20": 97.0, "sma50": 105.0, "sma200": 110.0, "atr": 2.0, "pend50": -1.0,
            "corr_libro": 0.2, "supp": 95.0, "res": 112.0}
_p1 = ROT.piano_ingresso({**_base473, "sma200": 108.0})
check("v473 sotto la zona il livello e' il bordo basso (qui la media a 200), con distanze in % e in ATR",
      _p1["posizione"] == "sotto" and _p1["zona"]["quale"] == "media a 200"
      and abs(_p1["livello"]["prezzo"] - 108) < 1e-9 and abs(_p1["livello"]["pct"] - 8) < 1e-9
      and abs(_p1["livello"]["atr"] - 4) < 1e-9, str(_p1["livello"]))
check("v473 il primo segnale e' la media piu' vicina sopra il prezzo se viene PRIMA del livello; "
      "il rischio va dall'ingresso allo stop",
      (_p1["primo_segnale"] or ("", {}))[0] == "media 50" and abs(_p1["primo_segnale"][1]["prezzo"] - 105) < 1e-9
      and abs(_p1["rischio"]["pct"] - (95 / 108 - 1) * 100) < 1e-9 and abs(_p1["rischio"]["atr"] + 6.5) < 1e-9,
      str(_p1))
_pv = ROT.piano_ingresso(_base473)
check("v473 zona VUOTA quando la 200 sta oltre 2 ATR sopra la 50: nessun livello inventato, resta il primo segnale",
      _pv["posizione"] == "zona vuota" and _pv["livello"] is None and _pv["rischio"] is None
      and (_pv["primo_segnale"] or ("",))[0] == "media 50", str(_pv))
_p2 = ROT.piano_ingresso({**_base473, "sma200": 90.0})
check("v473 con la 200 piu' in basso il bordo e' la media a 50 meno 1 ATR, e un primo segnale che viene DOPO il livello non esce",
      _p2["posizione"] == "sotto" and _p2["zona"]["quale"] == "media a 50 meno 1 ATR"
      and abs(_p2["livello"]["prezzo"] - 103) < 1e-9 and _p2["primo_segnale"] is None, str(_p2))
_p3 = ROT.piano_ingresso({**_base473, "sma200": 90.0, "px": 112.0, "pend50": 1.0})
check("v473 sopra la zona non si insegue: il livello e' il ritorno sotto la media 50 + 2 ATR",
      _p3["posizione"] == "sopra" and abs(_p3["livello"]["prezzo"] - 109) < 1e-9
      and abs(_p3["livello"]["atr"] + 1.5) < 1e-9 and abs(_p3["rischio"]["pct"] - (95 / 109 - 1) * 100) < 1e-9, str(_p3))
check("v473 una resistenza alla pari col prezzo e' ancora da rompere: sta fra i livelli SOPRA",
      [nm for nm, _ in _p3["sopra"]] == ["resistenza 20s"], str(_p3["sopra"]))
_p4 = ROT.piano_ingresso({**_base473, "sma200": 90.0, "px": 106.0, "pend50": 1.0})
check("v473 dentro la zona: niente livello e niente rischio ripetuto (lo stop e' gia' fra i livelli)",
      _p4["posizione"] == "dentro" and _p4["livello"] is None and _p4["rischio"] is None
      and _p4["distanza_atr"] == 0.0 and _p4["primo_segnale"] is None, str(_p4))
check("v473 senza media a 200 o senza ATR il piano si dichiara non misurabile e non inventa un livello",
      ROT.piano_ingresso({**_base473, "sma200": None})["posizione"] == "non misurabile"
      and ROT.piano_ingresso({**_base473, "atr": None})["posizione"] == "non misurabile")
check("v473 il gruppo lo decide la correlazione in qualunque stato: sotto la 200 ma legato al libro e' la stessa scommessa",
      ROT.gruppo_watchlist({"stato": "SOTTO LA 200", "corr_libro": 0.66}) == "stessa"
      and ROT.gruppo_watchlist({"stato": "SOTTO LA 200", "corr_libro": ROT.SOGLIA_CORR}) == "stessa"
      and ROT.gruppo_watchlist({"stato": "DEBOLE", "corr_libro": ROT.SOGLIA_CORR - 0.01}) == "diversifica"
      and ROT.gruppo_watchlist({"stato": "CANDIDATO", "corr_libro": 0.1}) == "candidato"
      and ROT.gruppo_watchlist({"stato": "ESTESO", "corr_libro": None}) == "ignota")

# La base: minimi crescenti o decrescenti, sulle sedute CONCLUSE (v471)
_bm = [{"t": f"2026-09-{i + 1:02d}", "c": 100, "l": (90 if i == 3 else 92) if i < 10 else (95 if i == 15 else 97)}
       for i in range(20)]
_bm_oggi = _bm + [{"t": "2026-10-09", "c": 100, "l": 80}]
_m11 = ROT.struttura_minimi(_bm_oggi, _dt471(2026, 10, 9, 11, 0, tzinfo=_NY))
_m17 = ROT.struttura_minimi(_bm_oggi, _dt471(2026, 10, 9, 17, 0, tzinfo=_NY))
check("v473 minimi crescenti/decrescenti sulle sedute CONCLUSE: il minimo della seduta in corso puo' ancora scendere",
      ROT.struttura_minimi(_bm)["verso"] == "crescenti" and (_m11 or {}).get("verso") == "crescenti"
      and (_m17 or {}).get("verso") == "decrescenti" and (_m17 or {}).get("ora") == 80, f"{_m11} {_m17}")
check("v473 sotto 20 sedute, o con un minimo mancante, la struttura e' un buco e non un verdetto (v205)",
      ROT.struttura_minimi(_bm[:19]) is None
      and ROT.struttura_minimi(_bm[:-1] + [{"t": "2026-09-20", "c": 100, "l": None}]) is None)
_dm473 = ROT.dal_minimo([{"t": "a", "l": 50}, {"t": "b", "l": 40}, {"t": "c", "l": 45}, {"t": "d", "l": 40},
                         {"t": "e", "l": 48}], 44.0)
check("v473 il minimo dell'anno: l'ULTIMA volta che e' stato toccato, le sedute dopo, e quanto il prezzo ne sta sopra",
      _dm473["data"] == "d" and _dm473["sedute"] == 1 and abs(_dm473["sopra_pct"] - 10) < 1e-9, str(_dm473))

# La trimestrale: Nasdaq per primo (la fonte delle SCADENZE), yfinance solo se diversa, tre esiti (v389)
_tr473 = {"data": "2026-11-05", "giorni": 27}
_rt1 = ROT.riga_trimestrale({"trimestrale": _tr473, "trimestrale_yf": "2026-11-05"}, {"finestra": 45})
_rt2 = ROT.riga_trimestrale({"trimestrale": _tr473, "trimestrale_yf": "2026-11-09"}, {"finestra": 45})
_rt3 = ROT.riga_trimestrale({"trimestrale_yf": "2026-12-02"}, {"finestra": 45, "giorni_non_letti": []})
_rt4 = ROT.riga_trimestrale({}, {"errore": "HTTP 503"})
_rt5 = ROT.riga_trimestrale({}, {"giorni_non_letti": ["2026-10-12", "2026-10-13"]})
check("v473 trimestrale: Nasdaq per primo, la stima yfinance solo se diversa e chiamata col suo nome",
      "2026-11-05 (27 g, calendario Nasdaq)" in _rt1 and "yfinance" not in _rt1
      and "(yfinance) stima 2026-11-09" in _rt2, _rt1 + " || " + _rt2)
check("v473 trimestrale: nessuna data, calendario NON letto e giorni mancanti si leggono DIVERSI (v389)",
      "nessuna data nel calendario Nasdaq a 45 giorni" in _rt3 and "STIMA, non una data confermata" in _rt3
      and "NON letto" in _rt4 and "non vuol dire 'nessuna uscita'" in _rt4
      and "2 giorni del calendario Nasdaq NON letti" in _rt5, " || ".join((_rt3, _rt4, _rt5)))
_orig_cal473 = ROT.brief.calendario_trimestrali
try:
    def _cal_rotto(*a, **k):
        raise RuntimeError("rete giu'")
    ROT.brief.calendario_trimestrali = _cal_rotto
    _cs473 = ROT.calendario_sicuro(["AAA"])
finally:
    ROT.brief.calendario_trimestrali = _orig_cal473
check("v473 un calendario che esplode non si porta via la watchlist: diventa 'NON letto'",
      _cs473["attesi"] == [] and "rete" in _cs473.get("errore", "") and "NON letto" in ROT.riga_trimestrale({}, _cs473),
      str(_cs473))

# La resa: ogni nome in UN gruppo, i conteggi dichiarati, chi non e' letto nominato, la nota del CEO parola per parola
def _w473(tk, **kw):
    d = {"tk": tk, "px": 100.0, "stato": "SOTTO LA 200", "corr_libro": 0.2, "m1": -2.0, "m3": -5.0, "rsi": 45.0,
         "atr_pct": 2.0, "sma20": 97.0, "sma50": 105.0, "sma200": 108.0, "atr": 2.0, "pend50": -1.0,
         "res": 112.0, "supp": 95.0, "minimi": {"ora": 96.0, "prima": 94.0, "verso": "crescenti", "fino_a": "2026-10-08"},
         "dal_minimo": {"minimo": 90.0, "data": "2026-09-01", "sedute": 27, "sopra_pct": 11.1},
         "vol_seduta": "2026-10-08", "vol_pct_seduta": 60.0, "vol_pct_20": 40.0, "vol_campione": 250,
         "target": None, "beta_spy": 1.1, "r2_spy": 0.3, "sedute_beta": 250, "vol_annua": 30.0,
         "trimestrale": {"data": "2026-11-05", "giorni": 27}, "trimestrale_yf": "2026-11-05",
         "analisti": {"eps_ora": 5.0, "eps_90g_fa": 5.5, "su_30g": 1, "giu_30g": 3, "target_mediana": 130.0},
         "in_pipeline": True, "nota": f"regola del CEO su {tk}: niente sotto 95"}
    d.update(kw)
    return d
_o473 = {"watchlist": [_w473("CAND", stato="CANDIDATO", sma200=90.0, px=106.0, pend50=1.0, corr_libro=0.1),
                       _w473("DIVA"), _w473("STES", corr_libro=0.7), _w473("FUOR", in_pipeline=False),
                       {"tk": "NOLE", "errore": "non letto"}],
         "calendario": {"finestra": 45, "giorni_non_letti": []}, "asof_target": "2026-10-09T15:44:12Z"}
_rw473 = ROT.righe_watchlist(_o473)
_tw473 = "\n".join(_rw473)
def _gruppo_di(tk):
    g = None
    for r in _rw473:
        if r.startswith("■ "):
            g = r
        elif r.startswith(f"   {tk} "):
            return g
_nomi473 = [r.split()[0] for r in _rw473 if r.startswith("   ") and not r.startswith("    ") and r.split()[0].isupper()
            and len(r.split()[0]) == 4]
check("v473 ogni nome compare UNA volta, nel suo gruppo, e l'intestazione conta i gruppi",
      sorted(_nomi473) == ["CAND", "DIVA", "FUOR", "STES"]
      and "5 nomi: 1 candidati · 2 diversificano · 1 stessa scommessa · 0 correlazione non misurabile · 1 non letti" in _tw473
      and _gruppo_di("CAND").startswith("■ CANDIDATI") and _gruppo_di("DIVA").startswith("■ DIVERSIFICANO")
      and _gruppo_di("STES").startswith("■ STESSA SCOMMESSA"), _tw473[:600])
check("v473 chi non e' letto si NOMINA, non sparisce (v406)", "■ NON LETTI — 1: NOLE" in _tw473)
check("v473 il livello d'ingresso, il primo segnale e la base escono nella resa",
      "CHIUSURA sopra media a 200 108,00 (+8,0%, +4,0 ATR)" in _tw473
      and "primo segnale, NON un ingresso: chiusura sopra la media 50 105,00" in _tw473
      and "minimi delle ultime 10 sedute concluse CRESCENTI" in _tw473, _tw473)
check("v473 la nota del CEO in LIBRO.md esce parola per parola accanto ai livelli di oggi",
      "«regola del CEO su DIVA: niente sotto 95»" in _tw473)
check("v473 le revisioni passano dalla funzione di schede_progetto, senza ripetere il target, e chi non e' seguito lo dice",
      "ultimi 30 giorni 1 su, 3 giu'" in _tw473 and "target mediano" not in _tw473
      and "revisioni: titolo non seguito dalla pipeline" in _tw473
      and "schede_progetto.riga_revisioni(t.get(\"analisti\"), con_target=False)" in _corpo_di(_src_rot, "righe_ingresso"))
_a473 = {"eps_ora": 5.0, "eps_90g_fa": 5.5, "su_30g": 1, "giu_30g": 3, "target_mediana": 130.0,
         "target_min": 100, "target_max": 150}
check("v473 riga_revisioni: di default porta il target (schede invariate), con_target=False no, e il resto coincide",
      "target mediano" in SP.riga_revisioni(_a473) and "target mediano" not in SP.riga_revisioni(_a473, con_target=False)
      and SP.riga_revisioni(_a473).startswith(SP.riga_revisioni(_a473, con_target=False)))
# Collegamento, non controllo (v399, v443): la raccolta porta nota, trimestrale e revisioni, e la scheda la base
_src_rot473 = Path(__file__).with_name("rotazione.py").read_text()
_racc473 = _corpo_di(_src_rot473, "raccogli")
check("v473 la raccolta passa alla watchlist la nota del CEO, il calendario e le revisioni, e la scheda la base",
      '"nota": s.get("nota")' in _racc473 and 'prima_trim.get(s["tk"])' in _racc473
      and "submit(calendario_sicuro," in _racc473 and "cal = fut_cal.result()" in _racc473
      and '"analisti":' in _racc473
      and "struttura_minimi(barre)" in _corpo_di(_src_rot473, "scheda")
      and "dal_minimo(barre" in _corpo_di(_src_rot473, "scheda"))

# ---- il comando unico ----
import analisi as AN
from datetime import datetime as _dt473
_ny473, _roma473 = AN.NEW_YORK, AN.ROMA
check("v473 la fase dall'ora di New York col fuso: pre-market, seduta, after-hours, chiuso",
      AN.fase(_dt473(2026, 10, 9, 9, 29, tzinfo=_ny473)) == "pre-market"
      and AN.fase(_dt473(2026, 10, 9, 9, 30, tzinfo=_ny473)) == "seduta"
      and AN.fase(_dt473(2026, 10, 9, 15, 59, tzinfo=_ny473)) == "seduta"
      and AN.fase(_dt473(2026, 10, 9, 16, 0, tzinfo=_ny473)) == "after-hours"
      and AN.fase(_dt473(2026, 10, 10, 12, 0, tzinfo=_ny473)) == "chiuso")
# ⚠ dal 25/10 al 01/11 Roma e New York distano 5 ore invece di 6 (v470): un +6 a mano sbaglierebbe qui
check("v473 nella settimana a 5 ore di distanza le 14:45 di Roma sono gia' seduta, le 14:25 no",
      AN.fase(_dt473(2026, 10, 27, 14, 45, tzinfo=_roma473)) == "seduta"
      and AN.fase(_dt473(2026, 10, 27, 14, 25, tzinfo=_roma473)) == "pre-market")
_cm473 = {f: [a for _, a in AN.comandi(f)] for f in ("pre-market", "seduta", "after-hours", "chiuso")}
check("v473 fuori seduta numeri_libro gira due volte (ultima seduta E prezzo esteso), in seduta e a borse chiuse una",
      ["numeri_libro.py", "--esteso"] in _cm473["pre-market"] and ["numeri_libro.py", "--esteso"] in _cm473["after-hours"]
      and ["numeri_libro.py", "--esteso"] not in _cm473["seduta"] and ["numeri_libro.py", "--esteso"] not in _cm473["chiuso"]
      and all(any(x[:3] == ["numeri_libro.py", "--sedute", "1"] for x in v) for v in _cm473.values()), str(_cm473))
check("v473 il brief del pomeriggio solo da sessione aperta in poi",
      ["brief.py", "--pomeriggio"] in _cm473["seduta"] and ["brief.py", "--pomeriggio"] in _cm473["after-hours"]
      and ["brief.py"] in _cm473["pre-market"] and ["brief.py"] in _cm473["chiuso"])
_fa473 = (Path(__file__).resolve().parent.parent / "memoria" / "FORMATO_ANALISI.md").read_text(encoding="utf-8")
_usati473 = {a[0] for v in _cm473.values() for a in v}
_nominati473 = set(re.findall(r"scripts/([a-z_]+\.py)", AN.sezione(_fa473, "## Come si produce") or ""))
check("v473 gli strumenti del comando sono ESATTAMENTE quelli del formato, nei due versi (v387)",
      _usati473 == set(AN.STRUMENTI) == _nominati473, f"comando {sorted(_usati473)} · formato {sorted(_nominati473)}")
check("v473 il formato dice che «Aggiorna analisi» e' il formato COMPLETO e nomina il comando",
      "python3 scripts/analisi.py" in _fa473 and "formato COMPLETO" in _fa473 and "non si salta" in _fa473)
_cl473 = AN.checklist()
check("v473 la checklist stampata e' quella del formato: sezione 7d degli ingressi, registro delle richieste, regole",
      _cl473 is not None and _cl473.startswith(AN.TITOLO_CHECKLIST) and "7d." in _cl473 and "INGRESSI" in _cl473
      and "ingressi sulla watchlist (09/10)" in _cl473 and AN.TITOLO_REGOLE in _cl473
      and "conflitto di interessi" in _cl473)
import tempfile as _tf473
with _tf473.TemporaryDirectory() as _d473:
    _f473 = Path(_d473) / "F.md"
    _f473.write_text("# x\n\n## Cosa contiene la risposta, in quest'ordine\nMARCATORE-473\n\n## Regole\n- r\n",
                     encoding="utf-8")
    _cl_finta = AN.checklist(_f473)
    _f473.write_text("# x\n\n## Altro\nniente\n", encoding="utf-8")
    _cl_assente = AN.checklist(_f473)
_t_ok473, _c_ok473 = AN.resa([], _cl_finta)
_t_no473, _c_no473 = AN.resa([], _cl_assente)
check("v473 la checklist si LEGGE dal file (collegamento): senza la sezione il comando lo dichiara ed esce 1",
      "MARCATORE-473" in (_cl_finta or "") and _cl_assente is None and _c_ok473 == 0
      and _c_no473 == 1 and "CHECKLIST NON TROVATA" in _t_no473, _t_no473[-300:])
_es473 = AN.esegui([("FINTO OK", [sys.executable, "-c", "print('blocco buono')"]),
                    ("FINTO KO", [sys.executable, "-c",
                                  "import sys; print('mezzo'); sys.stderr.write('guasto-473'); sys.exit(3)"])])
_t_es473, _c_es473 = AN.resa(_es473, "## Cosa contiene la risposta\nx")
check("v473 uno strumento che fallisce si DICHIARA con l'errore, gli altri blocchi restano, e il comando esce 1 (v453)",
      _c_es473 == 1 and "STRUMENTO FALLITO (uscita 3)" in _t_es473 and "guasto-473" in _t_es473
      and "blocco buono" in _t_es473 and "mezzo" in _t_es473
      and [e["etichetta"] for e in _es473] == ["FINTO OK", "FINTO KO"], _t_es473[-500:])

# ============================ v474 — SEMAFORO CALCOLATO, DECISIONI APERTE, REGISTRO, PIANO ============================
# Decisioni del CEO del 09/10/2026: riferimento QQQ; in giallo nessun divieto ma le conseguenze di rischio di ogni
# ingresso; semaforo calcolato, costo delle decisioni aperte, registro della performance, piano per la liquidita'.
# Lo stato si COSTRUISCE (v425, v429): nessuna rete, nessuna dipendenza dal giorno in cui gira la suite.
from datetime import datetime as _dt474, timedelta as _td474, date as _giorno474
import tempfile as _tf474, os as _os474, json as _js474
_NY474 = ROT.brief.NEW_YORK

def _giorni474(fine, n):
    """n date lavorative che finiscono a `fine` (ISO), in ordine."""
    g, out = _giorno474.fromisoformat(fine), []
    while len(out) < n:
        if g.weekday() < 5:
            out.append(g.isoformat())
        g -= _td474(days=1)
    return out[::-1]

def _barre474(chiusure, fine="2026-10-09", vol=None):
    d = _giorni474(fine, len(chiusure))
    v = vol or [1_000_000] * len(chiusure)
    return [{"t": t, "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": vv} for t, c, vv in zip(d, chiusure, v)]

_sale = [100 + i * 0.5 for i in range(250)]            # in salita: media 50 ~213, media 200 ~188
_ALLE17, _ALLE11 = _dt474(2026, 10, 9, 17, 0, tzinfo=_NY474), _dt474(2026, 10, 9, 11, 0, tzinfo=_NY474)

# --- le soglie del codice sono QUELLE scritte nel libro (una regola in due posti diverge, v161/v207) ---
_lib474 = NL.testo_libro()
_s1ter = _lib474[_lib474.find("## 1ter"):_lib474.find("\n## ", _lib474.find("## 1ter") + 1)]
def _soglia474(rx):
    m = re.search(rx, _s1ter)
    return float(m.group(1).replace(",", ".")) if m else None
_dal_libro = {"CCC": (_soglia474(r"salito di \*\*(\d+,\d) punti"), NL.SOGLIA_CCC_PP),
              "HY": (_soglia474(r"\(HY OAS\) sopra (\d+,\d)"), NL.SOGLIA_HY),
              "HY rosso": (_soglia474(r"secondo gradino: sopra (\d+,\d)"), NL.SOGLIA_HY_ROSSO),
              "10 anni": (_soglia474(r"Treasury 10 anni sopra (\d+,\d)%"), NL.SOGLIA_T10),
              "volumi": (_soglia474(r"oltre il (\d+)° percentile"), NL.SOGLIA_VOL_ALTI)}
check("v474 le soglie del semaforo nel codice sono QUELLE di LIBRO.md §1ter, lette dal libro",
      all(a is not None and abs(a - b) < 1e-9 for a, b in _dal_libro.values()), str(_dal_libro))

# --- prezzo: SMH sotto la 50 o sotto la 200, sulle chiusure CONCLUSE ---
_p_su = NL.famiglia_prezzo(_barre474(_sale), _ALLE17)
_p_50 = NL.famiglia_prezzo(_barre474(_sale[:-1] + [205.0]), _ALLE17)
_p_200 = NL.famiglia_prezzo(_barre474(_sale[:-1] + [150.0]), _ALLE17)
check("v474 prezzo: spento sopra le medie, acceso sotto la 50, e sotto la 200 e' il gradino del rosso",
      _p_su["stato"] == "spento" and not _p_su["sotto200"] and _p_50["stato"] == "acceso" and not _p_50["sotto200"]
      and _p_200["stato"] == "acceso" and _p_200["sotto200"], str((_p_su["stato"], _p_50["stato"], _p_200["stato"])))
# a seduta aperta l'ultima barra e' in formazione: il semaforo legge CHIUSURE (v471)
_crollo_oggi = _barre474(_sale[:-1] + [150.0])
check("v474 prezzo: la barra della seduta in corso NON accende il semaforo, la stessa barra a chiusura si'",
      NL.famiglia_prezzo(_crollo_oggi, _ALLE11)["stato"] == "spento"
      and NL.famiglia_prezzo(_crollo_oggi, _ALLE11)["seduta"] == "2026-10-08"
      and NL.famiglia_prezzo(_crollo_oggi, _ALLE17)["stato"] == "acceso")
check("v474 prezzo: con meno di 200 sedute concluse la famiglia e' NON MISURABILE, non spenta",
      NL.famiglia_prezzo(_barre474(_sale[:150]), _ALLE17)["stato"] == "non misurabile")

# --- leader: NVDA, AMD e MU INSIEME sotto la 50, con volumi alti per tutti e tre ---
_giu = _sale[:-1] + [150.0]
_alto = [1_000_000] * 249 + [3_000_000]
_basso = [1_000_000] * 249 + [10]
_L_acc = {"NVDA": _barre474(_giu, vol=_alto), "AMD": _barre474(_giu, vol=_alto), "MU": _barre474(_giu, vol=_alto)}
_L_vol = {**_L_acc, "MU": _barre474(_giu, vol=_basso)}
_L_su = {**_L_acc, "NVDA": _barre474(_sale, vol=_alto)}
_L_buco = {**_L_acc, "MU": []}
_L_buco_su = {**_L_su, "MU": []}
_fl = {k: NL.famiglia_leader(v, _ALLE17) for k, v in
       (("acc", _L_acc), ("vol", _L_vol), ("su", _L_su), ("buco", _L_buco), ("buco_su", _L_buco_su))}
check("v474 leader: tutti e tre sotto con volumi alti = ACCESO; un volume basso = spento ma 'in osservazione'",
      _fl["acc"]["stato"] == "acceso" and _fl["vol"]["stato"] == "spento" and _fl["vol"]["tutti_sotto"],
      str({k: v["stato"] for k, v in _fl.items()}))
check("v474 leader: uno sopra la media basta a dirla spenta; un nome NON misurato la rende non misurabile solo se "
      "gli altri sono tutti sotto",
      _fl["su"]["stato"] == "spento" and _fl["buco"]["stato"] == "non misurabile" and _fl["buco_su"]["stato"] == "spento",
      str({k: v["stato"] for k, v in _fl.items()}))

# --- credito, tassi, fondamentali, leva ---
_cr = lambda ccc, hy: NL.famiglia_credito(None if ccc is None else {"salita_60_pp": ccc},
                                          None if hy is None else {"valore": hy, "data": "2026-10-08"})
check("v474 credito: CCC +1,5 o HY sopra 3,5 accendono; un dato mancante con l'altro spento e' NON MISURABILE; "
      "HY sopra 4,0 e' il gradino del rosso",
      _cr(1.5, 3.0)["stato"] == "acceso" and _cr(1.4, 3.6)["stato"] == "acceso" and _cr(1.4, 3.5)["stato"] == "spento"
      and _cr(None, 3.0)["stato"] == "non misurabile" and _cr(2.0, None)["stato"] == "acceso"
      and _cr(1.0, 4.1)["rosso"] and not _cr(1.0, 4.0)["rosso"])
check("v474 tassi: strettamente sopra 5,4 accende; senza dato non misurabile",
      NL.famiglia_tassi({"valore": 5.41})["stato"] == "acceso" and NL.famiglia_tassi({"valore": 5.4})["stato"] == "spento"
      and NL.famiglia_tassi(None)["stato"] == "non misurabile")
_fo = lambda n, m: NL.famiglia_fondamentali({"NVDA": n, "MU": m})["stato"]
check("v474 fondamentali: piu' tagli che rialzi su ALMENO UNO fra NVDA e MU accende; un nome senza dato e' non misurabile",
      _fo({"su_30g": 46, "giu_30g": 0}, {"su_30g": 1, "giu_30g": 4}) == "acceso"
      and _fo({"su_30g": 46, "giu_30g": 0}, {"su_30g": 4, "giu_30g": 4}) == "spento"
      and _fo({"su_30g": 46, "giu_30g": 0}, None) == "non misurabile"
      and _fo({"su_30g": 0, "giu_30g": 2}, None) == "acceso")
check("v474 leva: il margin debt che scende sul mese accende, dallo STORICO e non dal campo 'qoq' (v326)",
      NL.famiglia_leva({"history": [100, 99], "qoq": 5.0})["stato"] == "acceso"
      and NL.famiglia_leva({"history": [99, 100], "qoq": -5.0})["stato"] == "spento"
      and NL.famiglia_leva({"history": [100]})["stato"] == "non misurabile")

# --- il colore: prezzo e leader sono UNA famiglia (B3); il rosso chiede SMH sotto la 200 E credito sopra 4,0 ---
def _fam474(**accesi):
    f = {k: {"stato": "spento"} for k in ("prezzo", "leader", "credito", "tassi", "fondamentali", "leva")}
    for k, v in accesi.items():
        f[k] = v if isinstance(v, dict) else {"stato": v}
    return f
_c = NL.colore_semaforo
check("v474 colore: una famiglia gialla; prezzo e leader insieme restano UNA (B3); due famiglie diverse arancione",
      _c(_fam474(credito="acceso"))["colore"] == "giallo"
      and _c(_fam474(prezzo="acceso", leader="acceso"))["colore"] == "giallo"
      and _c(_fam474(credito="acceso", tassi="acceso"))["colore"] == "arancione"
      and _c(_fam474())["colore"] == "verde")
check("v474 colore: rosso solo con SMH sotto la 200 E HY sopra 4,0; senza il credito resta il dubbio della guida capex",
      _c(_fam474(prezzo={"stato": "acceso", "sotto200": True}, credito={"stato": "acceso", "rosso": True}))["colore"] == "rosso"
      and _c(_fam474(credito={"stato": "acceso", "rosso": True}))["colore"] == "giallo"
      and _c(_fam474(prezzo={"stato": "acceso", "sotto200": True}))["rosso_possibile"])
_cm = _c(_fam474(tassi="non misurabile"))
check("v474 colore: una famiglia non misurabile rende il colore un MINIMO e si nomina, non diventa 'spenta'",
      _cm["colore"] == "verde" and _cm["minimo"] and _cm["non_misurabili"] == ["tassi"])

# --- la reazione si LEGGE dal libro (v436), e porta la regola nuova del giallo ---
_rz = NL.reazioni_libro(_lib474)
check("v474 la reazione di ogni colore si legge da LIBRO.md §1ter, e il giallo porta la decisione del CEO del 09/10",
      set(_rz) == {"verde", "giallo", "arancione", "rosso"} and "nessun divieto d'ingresso" in _rz["giallo"]
      and "conseguenze di rischio" in _rz["giallo"] and "niente nuovi acquisti di semiconduttori" not in _rz["giallo"],
      str(_rz)[:400])
check("v474 senza la sezione del semaforo nel libro le reazioni mancano, e la resa lo dichiara",
      NL.reazioni_libro("# altro\n## 2. niente\n") == {})

# --- la resa: colore cambiato in cima, invariato, minimo, rosso possibile, reazione non letta ---
_seg474 = {"ccc": {"valore": 12.5, "data": "2026-10-08", "salita_60_pp": 2.8}, "hy": {"valore": 3.15, "data": "2026-10-08"},
           "t10": {"valore": 5.28, "data": "2026-10-07"},
           "analisti": {"NVDA": {"su_30g": 46, "giu_30g": 0}, "MU": {"su_30g": 4, "giu_30g": 1}},
           "margin": {"history": [100, 102], "date": "2026-08-01"}}
_sm474 = NL.semaforo(_barre474(_sale), {k: _barre474(_sale, vol=_alto) for k in NL.LEADER}, _seg474, _ALLE17)
_sm474["reazioni"] = _rz
_r_cambiato = "\n".join(NL.righe_semaforo(_sm474, {"seduta": "2026-10-08", "colore": "verde"}))
_r_uguale = "\n".join(NL.righe_semaforo(_sm474, {"seduta": "2026-10-08", "colore": "giallo"}))
_r_nessuno = "\n".join(NL.righe_semaforo(_sm474, None))
check("v474 resa: giallo dal solo credito; COLORE CAMBIATO quando il registro dice un altro colore, 'invariato' quando no",
      _sm474["colore"] == "giallo" and _sm474["accesi"] == ["credito"] and "COLORE CAMBIATO: da verde" in _r_cambiato
      and "giallo → invariato" in _r_uguale and "n.d." in _r_nessuno.split("colore della seduta precedente")[1][:20],
      _r_cambiato[:300])
check("v474 resa: la reazione del colore esce parola per parola dal libro, e la guida capex si dichiara non calcolata",
      "reazione del giallo (LIBRO.md §1ter, parola per parola)" in _r_uguale and "nessun divieto d'ingresso" in _r_uguale
      and "hyperscaler NON è calcolata" in _r_uguale and "agosto 2026" in _r_uguale)
_sm_min = NL.semaforo(_barre474(_sale), {k: _barre474(_sale, vol=_alto) for k in NL.LEADER}, {**_seg474, "t10": None}, _ALLE17)
_sm_min["reazioni"] = {}
_r_min = "\n".join(NL.righe_semaforo(_sm_min, None))
check("v474 resa: un dato mancante rende il colore MINIMO nell'intestazione, e una reazione non letta si dichiara",
      "(MINIMO)" in _r_min.splitlines()[0] and "colore MINIMO: tassi non misurabile" in _r_min and "NON letta da LIBRO.md" in _r_min)
_sm_ar = NL.semaforo(_barre474(_sale[:-1] + [150.0]), {k: _barre474(_sale, vol=_alto) for k in NL.LEADER}, _seg474, _ALLE17)
_sm_ar["reazioni"] = _rz
_r_ar = "\n".join(NL.righe_semaforo(_sm_ar, None, {"MU": 0.35, "AMD": 0.25, "NVDA": 0.12}))
check("v474 resa: SMH sotto la 200 + credito = arancione, il dubbio del rosso si dichiara e si nomina chi pesa nel rischio",
      _sm_ar["colore"] == "arancione" and "il rosso scatta col credito sopra 4,0" in _r_ar and "MU 35,0%" in _r_ar,
      _r_ar[-400:])

# --- la pipeline si legge dalle chiavi VERE (v196, v416) ---
_d474 = {"macro": {"credit_ccc": {"valore": 12.52, "salita_60_pp": 2.82}, "credit": {"spread_hy": 3.15, "date": "2026-10-08"},
                   "tassi": {"scadenze": [{"key": "a2", "value": 4.0}, {"key": "a10", "value": 5.28, "observation_date": "2026-10-07"}]},
                   "margin_debt": {"history": [1, 2], "date": "2026-08-01"}},
         "watchlist": [{"ticker": "NVDA", "analisti": {"su_30g": 46, "giu_30g": 0}}],
         "portfolio": [{"ticker": "MU", "analisti": {"su_30g": 4, "giu_30g": 1}}]}
_sp474 = NL.segnali_pipeline(_d474)
check("v474 segnali dalla pipeline: CCC, HY con la sua data, 10 anni con la sua data, revisioni da watchlist E portafoglio",
      _sp474["hy"] == {"valore": 3.15, "data": "2026-10-08"} and _sp474["t10"] == {"valore": 5.28, "data": "2026-10-07"}
      and _sp474["analisti"]["MU"]["su_30g"] == 4 and _sp474["analisti"]["NVDA"]["su_30g"] == 46
      and _sp474["ccc"]["salita_60_pp"] == 2.82 and NL.segnali_pipeline(None)["hy"] is None, str(_sp474))

# --- collegamento (v399, v443): il semaforo e' calcolato in calcola e stampato PER PRIMO ---
_calc474 = _corpo_di(_src_nl := Path(__file__).with_name("numeri_libro.py").read_text(), "calcola")
_sint474 = _corpo_di(_src_nl, "sintesi")
check("v474 collegamento: calcola produce semaforo, reazioni, decisioni e registro; la sintesi apre col semaforo",
      "semaforo(B[\"SMH\"]" in _calc474 and "reazioni_libro(testo_libro())" in _calc474
      and "costo_decisioni(" in _calc474 and "aggiorna_registro(" in _calc474
      and 0 <= _sint474.find("righe_semaforo(") < _sint474.find("Periodo")
      and "righe_registro(" in _sint474 and "righe_decisioni(" in _sint474)

# ---------------------------------------------------------------- le decisioni aperte
_dec474 = NL.leggi_decisioni(_lib474)
_dd = {d["tk"]: d for d in (_dec474 or [])}
check("v474 la tabella DECISIONI APERTE del libro si legge: RGTI uscita 463, AMD alleggerimento da decidere, livelli e date",
      set(_dd) >= {"RGTI", "AMD"} and _dd["RGTI"]["qta"] == 463 and _dd["RGTI"]["verso"] == "vendita"
      and _dd["RGTI"]["livello"] == 14.41 and _dd["AMD"]["qta"] is None and not _dd["AMD"]["qta_illeggibile"]
      and _dd["AMD"]["livello"] == 645.0 and _dd["RGTI"]["confermata"] == "2026-10-08" and _dd["AMD"]["aperta"],
      str(_dec474))
_tab474 = ("## 1quinquies. DECISIONI APERTE\n\n| Nome | Decisione | Quantità | Condizione | Livello | Confermata | Stato |\n"
           "|---|---|---|---|---|---|---|\n")
check("v474 sezione assente = None (si legge diversa da 'nessuna decisione'); sezione vuota = []; solo dentro il titolo (v454)",
      NL.leggi_decisioni("## 1. POSIZIONI\n| RGTI | uscita | 463 | chiusura sotto | 14,41 | 2026-10-08 | aperta |\n") is None
      and NL.leggi_decisioni(_tab474) == [] and NL.righe_decisioni(None)[0].startswith("DECISIONI APERTE: sezione NON trovata")
      and NL.righe_decisioni([]) == ["DECISIONI APERTE: nessuna in LIBRO.md §1quinquies"])
_righe_dec = _tab474 + ("| RGTI | uscita | 463 | chiusura sotto | 14,41 | 2026-10-08 | aperta |\n"
                        "| AMD | alleggerimento | da decidere | respinto sotto | 645 | 2026-10-08 | aperta |\n"
                        "| ZZZ | ingresso | 10 | chiusura sopra | 50 | 2026-10-08 | aperta |\n"
                        "| OLD | uscita | 5 | chiusura sotto | 9 | 2026-10-01 | eseguita il 02/10 |\n"
                        "| QQQ | uscita | circa 7 | chiusura sotto | 1 | 2026-10-08 | aperta |\n")
_bd = {"RGTI": [{"t": "2026-10-07", "c": 14.5}, {"t": "2026-10-08", "c": 14.14}, {"t": "2026-10-09", "c": 14.03}],
       "AMD": [{"t": "2026-10-08", "c": 620.68}, {"t": "2026-10-09", "c": 630.68}],
       "ZZZ": [{"t": "2026-10-08", "c": 52.0}, {"t": "2026-10-09", "c": 51.0}]}
_cal474 = {"finestra": 45, "attesi": [{"tk": "RGTI", "data": "2026-11-09", "giorni": 31}]}
_cd = {x["tk"]: x for x in NL.costo_decisioni(NL.leggi_decisioni(_righe_dec), _bd,
                                                {"RGTI": 14.03, "AMD": 630.68, "ZZZ": 51.0, "QQQ": 2.0}, _cal474, _ALLE17)}
check("v474 vendita: effetto = quantita' x (adesso - conferma); RGTI 463 x (14,03 - 14,14) = -50,93 $; condizione valida; 1 seduta",
      abs(_cd["RGTI"]["effetto"] - 463 * (14.03 - 14.14)) < 1e-9 and _cd["RGTI"]["conferma_px"] == 14.14
      and _cd["RGTI"]["vale_ancora"] is True and _cd["RGTI"]["sedute"] == 1 and _cd["RGTI"]["scadenza"]["data"] == "2026-11-09",
      str(_cd["RGTI"]))
check("v474 quantita' da decidere: il conto e' per 10 azioni e lo dice; un acquisto ha il segno opposto",
      _cd["AMD"]["per_unita"] and abs(_cd["AMD"]["effetto"] - 10 * 10.0) < 1e-9
      and abs(_cd["ZZZ"]["effetto"] - 10 * (52.0 - 51.0)) < 1e-9 and "OLD" not in _cd)
check("v474 una quantita' scritta male non diventa in silenzio 10 azioni: si dichiara ILLEGGIBILE",
      _cd["QQQ"]["qta_illeggibile"] and "ILLEGGIBILE" in "\n".join(NL.righe_decisioni([_cd["QQQ"]])))
_rd474 = "\n".join(NL.righe_decisioni(list(_cd.values())))
check("v474 resa: COSTATA per un effetto negativo, FATTO GUADAGNARE per uno positivo, unita' dichiarata, nessuna data inventata",
      "l'attesa è COSTATA 51 $" in _rd474 and "l'attesa ha FATTO GUADAGNARE 100 $" in _rd474
      and "unità di calcolo, non una quantità consigliata" in _rd474 and "1 seduta conclusa dalla conferma" in _rd474
      and "AMD alleggerimento" in _rd474 and "nessuna trimestrale dichiarata dalla fonte" in _rd474, _rd474)
_cd_rientr = NL.costo_decisioni(NL.leggi_decisioni(_righe_dec), _bd, {"RGTI": 15.0}, _cal474, _ALLE17)
_cd_r = {x["tk"]: x for x in _cd_rientr}
check("v474 una condizione RIENTRATA si dice (la decisione resta, la premessa va ridiscussa); una conferma senza barra e' n.d.",
      _cd_r["RGTI"]["vale_ancora"] is False and "RIENTRATA" in "\n".join(NL.righe_decisioni([_cd_r["RGTI"]]))
      and "NON trovata nelle barre" in "\n".join(NL.righe_decisioni(NL.costo_decisioni(
          NL.leggi_decisioni(_righe_dec)[:1], {"RGTI": [{"t": "2026-10-09", "c": 14.0}]}, {"RGTI": 14.0}, _cal474, _ALLE17))))
_bd_oggi = {"RGTI": _bd["RGTI"] + [{"t": "2026-10-12", "c": 13.0}]}
check("v474 le sedute trascorse sono CONCLUSE: la barra della seduta in corso non conta",
      NL.costo_decisioni(NL.leggi_decisioni(_righe_dec)[:1], _bd_oggi, {"RGTI": 13.0}, _cal474,
                         _dt474(2026, 10, 12, 11, 0, tzinfo=_NY474))[0]["sedute"] == 1
      and NL.costo_decisioni(NL.leggi_decisioni(_righe_dec)[:1], _bd_oggi, {"RGTI": 13.0}, _cal474,
                             _dt474(2026, 10, 12, 17, 0, tzinfo=_NY474))[0]["sedute"] == 2)

# ---------------------------------------------------------------- il registro della performance
_pat474 = (1.2, "pipeline, run x", {"BTP": (101.0, "pipeline")})
_b1 = {"AAA": [{"t": "2026-10-09", "c": 100.0}], "BBB": [{"t": "2026-10-09", "c": 50.0}], "QQQ": [{"t": "2026-10-09", "c": 600.0}]}
_b2 = {"AAA": [{"t": "2026-10-12", "c": 110.0}], "BBB": [{"t": "2026-10-12", "c": 45.0}], "QQQ": [{"t": "2026-10-12", "c": 606.0}]}
_r1 = NL.nuova_riga("2026-10-09", {"AAA": 10, "BBB": 20}, {"BTP": 10000}, _b1, 5000.0, _pat474, "giallo", None, _ALLE17)
# fra le due righe il CEO vende BBB e deposita 20.000 EUR: il TWR non deve vedere ne' l'uno ne' l'altro
_r2 = NL.nuova_riga("2026-10-12", {"AAA": 10}, {"BTP": 10000}, _b2, 25000.0, (1.25, "x", {"BTP": (101.5, "pipeline")}),
                    "arancione", _r1, _ALLE17)
check("v474 la riga salva i prezzi delle posizioni di oggi E di quelle della riga prima (la venduta resta prezzata)",
      _r2["prezzi"] == {"AAA": 110.0, "BBB": 45.0} and _r2["posizioni"] == {"AAA": 10} and _r2["qqq"] == 606.0
      and _r2["semaforo"] == "arancione" and _r2["prezzi_obbligazioni"]["BTP"] == {"prezzo": 101.5, "fonte": "pipeline"})
_tw = NL.twr([_r1, _r2])
_p0 = 2000 / 1.2 + 5000 + 10000 * 101.0 / 100
_p1 = 2000 / 1.25 + 5000 + 10000 * 101.5 / 100
check("v474 TWR: l'intervallo usa le posizioni registrate al suo INIZIO (AAA +10% e BBB -10% a pesi 1:1 = 0), "
      "non quelle di dopo (sarebbe +10%)",
      abs(_tw["libro"]) < 1e-12 and abs(_tw["qqq"] - 0.01) < 1e-12, str(_tw))
check("v474 TWR: il patrimonio usa la liquidita' di INIZIO intervallo: un deposito non e' rendimento; QQQ in euro col cambio",
      abs(_tw["patrimonio"] - (_p1 / _p0 - 1)) < 1e-12
      and abs(_tw["qqq_eur"] - ((606 / 1.25) / (600 / 1.2) - 1)) < 1e-12, str(_tw))
_r3 = dict(_r2, seduta="2026-10-13", prezzi={"AAA": None}, qqq=612.0, posizioni={"AAA": 10})
_r4 = dict(_r2, seduta="2026-10-14", prezzi={"AAA": 121.0}, qqq=618.0)
_tw2 = NL.twr([_r1, _r2, _r3, _r4])
check("v474 TWR: un prezzo mancante salta l'intervallo per il libro E per QQQ (stessi giorni), e lo si nomina",
      _tw2["intervalli"] == 1 and len(_tw2["saltati"]) == 2 and "manca il prezzo di AAA" in _tw2["saltati"][0]
      and abs(_tw2["qqq"] - 0.01) < 1e-12, str(_tw2))
with _tf474.TemporaryDirectory() as _dr474:
    _pr = _os474.path.join(_dr474, "reg.jsonl")
    _e_seduta = NL.registra(_r1, _pr, _ALLE11)
    _e_ok = NL.registra(_r1, _pr, _ALLE17)
    _e_dopp = NL.registra(_r1, _pr, _ALLE17)
    _e_vecchia = NL.registra(dict(_r1, seduta="2026-10-08"), _pr, _ALLE17)
    _e_noqqq = NL.registra(dict(_r2, qqq=None), _pr, _ALLE17)
    with open(_pr, "a", encoding="utf-8") as _fh:
        _fh.write("{rotta\n")
    _lr, _rotte = NL.leggi_registro(_pr)
    _ag = NL.aggiorna_registro(_b2, {"AAA": 10}, {"BTP": 10000}, 25000.0, (1.25, "x", {"BTP": (101.5, "pipeline")}),
                               "giallo", True, _dt474(2026, 10, 12, 18, 0, tzinfo=_NY474), _pr)
    _ag2 = NL.aggiorna_registro(_b2, {"AAA": 10}, {"BTP": 10000}, 25000.0, (1.25, "x", {"BTP": (101.5, "pipeline")}),
                                "giallo", True, _dt474(2026, 10, 12, 18, 5, tzinfo=_NY474), _pr)
check("v474 il registro NON si scrive durante la seduta, ne' due volte, ne' all'indietro, ne' senza QQQ",
      _e_seduta[0] is False and "seduta in corso" in _e_seduta[1] and _e_ok[0] is True and _e_dopp[0] is False
      and _e_vecchia[0] is False and _e_noqqq[0] is False, str((_e_seduta, _e_ok, _e_dopp, _e_vecchia, _e_noqqq)))
check("v474 una riga illeggibile si CONTA e si dichiara, non sparisce in silenzio",
      _rotte == 1 and len(_lr) == 1 and "1 riga del registro illeggibile" in "\n".join(NL.righe_registro(_ag)))
check("v474 aggiorna_registro scrive la seduta conclusa, confronta, e la seconda volta dice 'gia' registrata'",
      _ag["esito"].startswith("scritto") and _ag["twr"]["righe"] == 2 and abs(_ag["twr"]["libro"]) < 1e-12
      and "già registrata" in _ag2["esito"] and [u["semaforo"] for u in _ag["ultime"]] == ["giallo", "giallo"],
      str(_ag["esito"]) + " " + str(_ag2["esito"]))
check("v474 il colore precedente viene dal registro, dalla riga PRIMA della seduta di oggi",
      NL.precedente_semaforo({"ultime": [{"seduta": "2026-10-08", "semaforo": "verde"}, {"seduta": "2026-10-09", "semaforo": "giallo"}]},
                             "2026-10-09") == {"seduta": "2026-10-08", "colore": "verde"}
      and NL.precedente_semaforo({"ultime": []}, "2026-10-09") is None)
_rr474 = "\n".join(NL.righe_registro({"twr": _tw, "esito": None, "rotte": 0}))
check("v474 resa del registro: libro e patrimonio contro QQQ con la differenza, e le convenzioni del TWR dichiarate",
      "libro azionario in dollari 0,00% · QQQ +1,00% · differenza -1,00 punti" in _rr474
      and "patrimonio intero in euro" in _rr474 and "posizioni registrate al suo inizio" in _rr474
      and "1 intervallo," in _rr474, _rr474)
check("v474 senza cambio il patrimonio e' n.d. e il libro si confronta lo stesso",
      NL.twr([dict(_r1, eurusd=None), _r2])["patrimonio"] is None and NL.twr([dict(_r1, eurusd=None), _r2])["libro"] is not None)
check("v474 patrimonio_pipeline: cambio e prezzo del BTP dalla pipeline; senza riga il BTP resta AL CARICO, dichiarato",
      NL.patrimonio_pipeline({"updated_at": "x", "macro": {"markets": [{"key": "EURUSD=X", "value": "1.1204"}]},
                              "portfolio": [{"ticker": "BTP", "price": 101.69}]}, {"BTP": 100.0, "ALT": 99.0})
      == (1.1204, "pipeline, run x", {"BTP": (101.69, "pipeline"), "ALT": (99.0, "carico: la pipeline non ha il prezzo")})
      and NL.patrimonio_pipeline(None, {"BTP": 100.0})[0] is None)

# ---------------------------------------------------------------- il comando unico registra
_cm474 = {f: [a for _, a in AN.comandi(f)] for f in ("pre-market", "seduta", "after-hours", "chiuso")}
check("v474 il giro principale di numeri_libro porta --registra in ogni fase; il prezzo esteso no",
      all(any(x[0] == "numeri_libro.py" and "--sedute" in x and "--registra" in x for x in v) for v in _cm474.values())
      and all("--registra" not in x for v in _cm474.values() for x in v if "--esteso" in x), str(_cm474))
_t474, _ = AN.resa([], "## Cosa contiene la risposta\nx", registro_cambiato=True)
_t474n, _ = AN.resa([], "## Cosa contiene la risposta\nx", registro_cambiato=False)
check("v474 se il registro cambia il comando lo DICE (va committato), e se non cambia tace",
      "REGISTRO DELLA PERFORMANCE AGGIORNATO" in _t474 and "REGISTRO DELLA PERFORMANCE AGGIORNATO" not in _t474n
      and "impronta() != prima" in _corpo_di(Path(__file__).with_name("analisi.py").read_text(), "main"))

# ---------------------------------------------------------------- il piano per la liquidita'
import random as _rnd474
_g474 = _rnd474.Random(474)
_date474 = _giorni474("2026-10-09", 260)
_rq = {t: _g474.gauss(0, 0.01) for t in _date474}
_rl = {t: 2.0 * _rq[t] + _g474.gauss(0, 0.01) for t in _date474}
_rx = {t: 0.5 * _rq[t] + _g474.gauss(0, 0.015) for t in _date474}
_cs = ROT.conseguenze(_rl, _rl, _rq, 280000.0, 5600.0)
_cx = ROT.conseguenze(_rx, _rl, _rq, 280000.0, 5600.0)
_cn = ROT.conseguenze({t: -_rl[t] for t in _date474}, _rl, _rq, 280000.0, 5600.0)
_bx = ROT.beta_mercato({t: _rx[t] for t in sorted(_rx)[-250:]}, _rq)[0]
_bl = ROT.beta_mercato({t: _rl[t] for t in sorted(_rl)[-250:]}, _rq)[0]
check("v474 conseguenze: aggiungere al libro il libro stesso non cambia volatilita' ne' beta",
      abs(_cs["dvol"]) < 1e-9 and abs(_cs["dbeta"]) < 1e-9, str(_cs))
check("v474 conseguenze: il beta e' lineare nei pesi — la variazione e' peso x (beta del titolo - beta del libro), esatta",
      abs(_cx["dbeta"] - _cx["peso"] * (_bx - _bl)) < 1e-9 and abs(_cx["peso"] - 5600 / 285600) < 1e-12, str(_cx))
check("v474 conseguenze: chi va contro il libro abbassa la volatilita' piu' di chi lo diversifica soltanto",
      _cn["dvol"] < _cx["dvol"] < 0, f"{_cn['dvol']} {_cx['dvol']}")
check("v474 conseguenze: sotto 60 date comuni, o senza cambio, non e' una misura (un buco, v205)",
      ROT.conseguenze(dict(list(_rx.items())[:50]), _rl, _rq, 280000.0, 5600.0) is None
      and ROT.conseguenze(_rx, _rl, _rq, 280000.0, None) is None)
_vb = {"tk": "XX", "px": 100.0, "sma20": 99.0, "sma50": 98.0, "sma200": 90.0, "atr": 2.0, "pend50": 1.0, "corr_libro": 0.2,
       "supp": 95.0, "res": 104.0, "stato": "CANDIDATO", "trimestrale": {"data": "2026-10-20", "giorni": 11}}
_vd = ROT.voce_piano(_vb, "watchlist", _rx, _rl, _rq, 280000.0, 5600.0)
_vs = ROT.voce_piano({**_vb, "px": 92.0, "pend50": -0.5}, "watchlist", _rx, _rl, _rq, 280000.0, 5600.0)
_vv = ROT.voce_piano({**_vb, "sma200": 110.0}, "watchlist", _rx, _rl, _rq, 280000.0, 5600.0)
_vstop = ROT.voce_piano({**_vb, "supp": 101.0}, "watchlist", _rx, _rl, _rq, 280000.0, 5600.0)
check("v474 voce del piano: dentro la zona l'ingresso e' il prezzo di adesso, sotto e' il bordo della zona; "
      "perdita allo stop = unita' x (stop / ingresso - 1)",
      _vd["posizione"] == "dentro" and _vd["ingresso"] == 100.0 and abs(_vd["perdita_eur"] - 5000 * (95 / 100 - 1)) < 1e-9
      and _vs["posizione"] == "sotto" and abs(_vs["ingresso"] - 96.0) < 1e-9
      and abs(_vs["perdita_eur"] - 5000 * (95 / 96 - 1)) < 1e-9, str((_vd["ingresso"], _vs["ingresso"])))
check("v474 voce del piano: zona vuota = nessun ingresso inventato; uno stop sopra l'ingresso non da' una perdita",
      _vv["posizione"] == "zona vuota" and _vv["ingresso"] is None and _vv["perdita_eur"] is None
      and _vstop["perdita_eur"] is None and _vstop["ingresso"] == 100.0)
_pv474 = {"voci": [_vd, dict(_vd, tk="YY", gruppo="STESSA SCOMMESSA DEL LIBRO", corr=0.7,
                              conseguenze=dict(_vd["conseguenze"], dvol=0.2), trimestrale={"data": "2026-11-20", "giorni": 42}),
                   _vs, _vv],
          "liquidita": 59000.0, "patrimonio": {"azionario": 256921.0, "liquidita": 59000.0, "obbligazioni": 40676.0,
                                               "totale": 356597.0},
          "cambio": 1.1204, "fonte_cambio": "pipeline, run x", "qqq_assente": False}
_rp474 = ROT.righe_piano({"piano": _pv474})
_tp474 = "\n".join(_rp474)
_op = [r.split()[0] for r in _tp474.split("■ OPERABILI")[1].split("■ CON")[0].splitlines()[1:]]
check("v474 resa del piano: quota della liquidita' sul patrimonio, unita' dichiarata NON quantita' consigliata, quota azionaria",
      "59.000 € dichiarati in LIBRO.md, 16,5% del patrimonio" in _tp474 and "NON una quantità consigliata" in _tp474
      and "da 72,0% a 73,5%" in _tp474, _tp474[:600])
check("v474 resa del piano: operabili per riduzione della volatilita'; la stessa scommessa e' DICHIARATA, non vietata",
      _op == ["XX", "YY"] and "STESSA SCOMMESSA del libro (corr +0,70)" in _tp474
      and "nella stessa scommessa del libro (correlazione da 0,5 in su): YY" in _tp474, str(_op))
check("v474 resa del piano: avvisi col loro livello, zona vuota fra i senza livello, trimestrale vicina segnalata (14 giorni)",
      "avviso: CHIUSURA sopra 96,00" in _tp474 and "XX (zona vuota)" in _tp474
      and "trimestrale 2026-10-20 (11 g) ⚠ entro 14 giorni" in _tp474 and "2026-11-20 (42 g) ⚠" not in _tp474)
check("v474 resa del piano: senza cambio il patrimonio NON e' calcolabile e lo dice, invece di sommare dollari ed euro (v432)",
      ROT.righe_piano({"piano": {**_pv474, "patrimonio": None, "cambio": None}})[0].startswith(
          "PIANO PER LA LIQUIDITÀ — patrimonio NON calcolabile: cambio EUR/USD non letto"))
_racc474 = _corpo_di(_src_rot474 := Path(__file__).with_name("rotazione.py").read_text(), "raccogli")
check("v474 collegamento: la raccolta legge QQQ, il calendario di tutto l'universo, il patrimonio da numeri_libro, "
      "e il piano si stampa",
      '"QQQ"' in _racc474 and "submit(calendario_sicuro, tutti)" in _racc474
      and "numeri_libro.patrimonio_pipeline(" in _racc474 and "numeri_libro.patrimonio_eur(" in _racc474
      and "voce_piano(" in _racc474 and "righe_piano(o)" in _src_rot474.split("if __name__")[-1])

# ---------------------------------------------------------------- il libro e il formato
check("v474 il libro dichiara il riferimento QQQ e il registro; la regola nuova del giallo; la tabella delle decisioni",
      "## 0. OBIETTIVO E RIFERIMENTO" in _lib474 and "**QQQ (Nasdaq 100)**" in _lib474
      and "registro_performance.jsonl" in _lib474 and "## 1quinquies. DECISIONI APERTE" in _lib474)
_cl474 = AN.checklist()
check("v474 la checklist porta il piano per la liquidita' (7e), le decisioni aperte, il registro, e il giallo SENZA divieto",
      "7e." in _cl474 and "PIANO PER LA LIQUIDITÀ" in _cl474 and "DECISIONI APERTE" in _cl474
      and "registro della performance" in _cl474 and "nessun divieto" in _cl474.lower()
      and "in giallo\n   niente nuovi semiconduttori" not in _cl474 and "piano per la liquidità (09/10)" in _cl474)

_T = len(ESEGUITI)
print(f"\n{'TUTTI I ' + str(_T - len(FALLITI)) + f'/{_T} CHECK OK' if not FALLITI else str(len(FALLITI)) + f'/{_T} FALLITI: ' + ', '.join(FALLITI)}")
sys.exit(1 if FALLITI else 0)
