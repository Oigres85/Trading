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
# ⚠ v484 — la tolleranza viene dall'ARROTONDAMENTO PUBBLICATO, non da una costante: libro.json scrive le
#   correlazioni a 2 decimali, le volatilita' a 3 e i pesi a 4, e da quegli arrotondamenti la ricostruzione puo'
#   scostarsi fino al limite qui sotto (derivata prima, caso peggiore). Il 09/09 lo scarto era 0,000 pp e la
#   tolleranza fissa a 0,05 pp reggeva; il 14/10, con SKHY nella matrice su 67 sedute, lo scarto e' 0,054 pp —
#   dentro un limite di ~0,19 pp — e il check e' andato rosso su codice corretto (la classe v429: un check che
#   vale finche' i dati lo concedono). Una formula sbagliata sbaglia di punti interi, non di decimi.
def _limite_arrotondamento(pesi, corr, vol_nome, vol):
    t = [k for k in pesi if k in vol_nome and k in corr]
    w = {k: pesi[k] for k in t}; s = {k: vol_nome[k] for k in t}
    dv2 = sum(2 * w[i] * w[j] * s[i] * s[j] * 0.005 for a, i in enumerate(t) for j in t[a + 1:])
    for k in t:
        m = abs(sum(w[j] * s[j] * (corr[k].get(j) if corr[k].get(j) is not None else 0) for j in t))
        dv2 += 2 * w[k] * m * 0.0005 + 2 * s[k] * m * 0.00005
    return dv2 / (2 * vol) + 0.00005
_lim440 = _limite_arrotondamento(_lib["pesi"], _lib["correlazioni"], _lib["volatilita_nome"], _lib["volatilita"])
check("v440 la volatilita' ricostruita dalla matrice riproduce quella pubblicata, entro l'errore che l'arrotondamento "
      "pubblicato consente (e il limite stesso resta piccolo: sotto mezzo punto)",
      _v0 is not None and abs(_v0 - _lib["volatilita"]) <= _lim440 and _lim440 < 0.005,
      extra=f"ricostruita {_v0}, pubblicata {_lib['volatilita']}, limite {_lim440:.5f}")
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
# ⚠ v478 — riagganciato: la frase pretesa era la nota della riga dei Fed Funds, che ora porta
#   la data dell'EFFR del giorno (o il mese della media mensile). L'invariante resta e vale per
#   la riga che una data non ce l'ha davvero: il cambio dello snapshot.
check("v452 una serie senza rilevazione lo dichiara, non eredita la data del run",
      "rilevazione non dichiarata" in _BRIEF
      and "quotazione dello snapshot, non una serie datata" in _BRIEF)

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
      and _dd["AMD"]["livello"] == 645.0 and _dd["RGTI"]["confermata"] == "2026-10-08"
      # v481 — AMD revocata il 14/10 (regola di tenuta): lo stato APERTA segue la colonna Stato, non e' fissato qui
      and all(d["aperta"] == d["stato"].lower().startswith("aperta") for d in _dec474),
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
# v485 — la seduta del 12/10 si registra la SERA stessa (18:00 NY): le barre portano la chiusura confermata dalla
#   quotazione, come le produce brief.barre dopo la campana (il rifiuto delle non confermate e' nei gate v485)
_b2 = {"AAA": [{"t": "2026-10-12", "c": 110.0, "ufficiale": True}], "BBB": [{"t": "2026-10-12", "c": 45.0, "ufficiale": True}],
       "QQQ": [{"t": "2026-10-12", "c": 606.0, "ufficiale": True}]}
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

# ============================ v476 — LIQUIDITA' E RICAVI NEGLI STRUMENTI ============================
# Lo stato si COSTRUISCE: i dati del giorno sono quelli di prima della correzione, e un check che
# li aspetta sarebbe verde per il caso invece che per la proprieta' (v425, v429).
_c476n = {"fcf_ttm": -87.6e6, "cashflow_al": "2026-06-30", "cassa": 27.763e6, "titoli_breve": 365.946e6,
          "liquidita": 393.709e6, "liquidita_base": "aggregato", "mesi_operativi": 77.8, "mesi_capex": 175.9}
_rc476 = SP.riga_cassa({"combustione": _c476n, "credito": {}})
check("v476 schede: l'autonomia ha la LIQUIDITA' come numeratore, con la sua base, e due denominatori dichiarati",
      "la liquidita' (contanti e titoli a breve termine) copre" in _rc476 and "di perdita operativa" in _rc476
      and "di investimenti" in _rc476 and "non si confrontano" in _rc476, _rc476)
check("v476 schede: oltre cinque anni non si stampa il numero (v389), e nessun importo esce (v404)",
      "oltre 5 anni" in _rc476 and "175" not in _rc476 and "77,8" not in _rc476
      and not any(x in _rc476 for x in ("393", "27,7", "365", "mld", "mln")), _rc476)
_rc476v = SP.riga_cassa({"combustione": {"fcf_ttm": -87.6e6, "cashflow_al": "2026-06-30", "cassa": 27.763e6,
                                         "mesi_operativi": 5.5, "mesi_capex": 12.4}, "credito": {}})
check("v476 schede: su uno snapshot precedente la cassa si dichiara come soli contanti",
      "la cassa (soli contanti" in _rc476v and "5,5 mesi" in _rc476v, _rc476v)
check("v476 la base 'solo_cassa' si dichiara, e senza nessun dato la liquidita' e' un buco",
      SP.liquidita_societa({"liquidita": 5.0, "liquidita_base": "solo_cassa", "cassa": 5.0})[2] == "la fonte riporta solo i contanti"
      and SP.liquidita_societa({}) == (None, None, None))
_fmt476, _u476 = SP.scala_importi([13.102e6, 12.008e6, 10.79e6, 7.088e6])
check("v476 la scala si sceglie sul blocco: i ricavi di RGTI non escono piu' '0,0 mld' (v447)",
      _u476 == "mln" and _fmt476(7.088e6) == "7,09", (_u476, _fmt476(7.088e6)))

# i ricavi: il caso RGTI — trimestri in salita, esercizio chiuso in calo
_r476 = {"tv": {"conto_trim": [
            {"trim": "2026-06-30", "ricavi": 5.138e6, "operativo": -28.062e6},
            {"trim": "2026-03-31", "ricavi": 4.4e6, "operativo": -25.951e6},
            {"trim": "2025-12-31", "ricavi": 1.868e6, "operativo": -22.597e6},
            {"trim": "2025-09-30", "ricavi": 1.947e6, "operativo": -20.549e6},
            {"trim": "2025-06-30", "ricavi": 1.801e6, "operativo": -19.882e6}]},
         "financials": [{"year": 2024, "revenue": 10.79e6}, {"year": 2025, "revenue": 7.088e6}]}
_rr476 = SP.riga_ricavi(_r476)
check("v476 ricavi: la variazione e' sullo stesso trimestre dell'anno prima, trovato per DATA",
      "+185,3% sullo stesso trimestre dell'anno prima" in _rr476 and "+16,8% sul trimestre precedente" in _rr476, _rr476)
check("v476 ricavi: quando trimestri ed esercizio puntano in versi opposti, la riga lo dice",
      "VERSI OPPOSTI" in _rr476 and "-34,3% sul 2024" in _rr476 and "perdita operativa AMPLIATA" in _rr476, _rr476)
_r476c = {"tv": {"conto_trim": [{"trim": "2026-06-30", "ricavi": 12.0}, {"trim": "2025-06-30", "ricavi": 10.0}]},
          "financials": [{"year": 2024, "revenue": 30.0}, {"year": 2025, "revenue": 40.0}]}
check("v476 ricavi: quando concordano non grida un disaccordo che non c'e'",
      "VERSI OPPOSTI" not in SP.riga_ricavi(_r476c) and "+20,0%" in SP.riga_ricavi(_r476c))
# ⚠ per DATA, mai per posizione: manca un trimestre, e il quarto elemento NON e' l'anno prima
_r476b = {"tv": {"conto_trim": [{"trim": "2026-06-30", "ricavi": 20.0}, {"trim": "2026-03-31", "ricavi": 18.0},
                                {"trim": "2025-09-30", "ricavi": 15.0}, {"trim": "2025-06-30", "ricavi": 10.0}]}}
check("v476 ricavi: con un trimestre mancante il confronto annuo resta sulla data giusta (v207, v393)",
      "+100,0% sullo stesso trimestre dell'anno prima" in SP.riga_ricavi(_r476b), SP.riga_ricavi(_r476b))
check("v476 ricavi: senza trimestri ne' esercizi la riga non esce, invece di uscire vuota",
      SP.riga_ricavi({}) is None)
_src_sp476 = Path(__file__).with_name("schede_progetto.py").read_text()
_src_rp476 = Path(__file__).with_name("rapporto.py").read_text()
_extra476 = _corpo_di(_src_rp476, "extra")
check("v476 collegamento: le schede stampano i ricavi, e il rapporto usa liquidita' e ricavi dalla lettura unica",
      "for f in (riga_ricavi, riga_cassa, riga_short):" in _corpo_di(_src_sp476, "scheda")
      and "SP.liquidita_societa(cb)" in _extra476 and "SP.riga_ricavi(r)" in _extra476
      and 'cb.get("cassa")' not in _extra476 and "/1e9:.1f} mld" not in _extra476)

# ============================ v477 — INVESTIMENTI NON SEMPRE COSTRUZIONE, E GLI OBBLIGHI ============================
_c477 = {"fcf_ttm": -21749.4e6, "cashflow_al": "2026-06-30", "cassa": 1711.8e6, "titoli_breve": 736.2e6,
         "liquidita": 2448e6, "liquidita_base": "aggregato", "mesi_operativi": 1468.8, "mesi_capex": 1.4,
         "capex_impianti_ttm": -21.2e6, "capex_immateriali_ttm": -21708.2e6, "quota_immateriali_pct": 99.9,
         "investimenti_immateriali_prevalenti": True, "mesi_impianti": 1385.7,
         "dividendi_privilegiate_ttm": -952.3e6, "dividendi_privilegiate_ultimo_trim": -399.6e6,
         "dividendi_privilegiate_trimestri": 4, "mesi_obblighi": 30.2}
_rc477 = SP.riga_cassa({"combustione": _c477, "credito": {}})
check("v477 schede: gli investimenti fatti di attivita' immateriali si dichiarano, con l'autonomia sui soli impianti",
      "1,4 mesi di investimenti (⚠ il 99,9% sono acquisti di attivita' immateriali" in _rc477
      and "non e' un piano di costruzione" in _rc477 and "sui soli impianti oltre 5 anni" in _rc477, _rc477)
check("v477 schede: l'autonomia sulle due uscite (perdita piu' dividendi sulle privilegiate) col ritmo in salita",
      "30,2 mesi di perdita operativa piu' dividendi sulle privilegiate" in _rc477
      and "1,7 volte la media trimestrale" in _rc477 and "tre denominatori diversi, non si confrontano" in _rc477
      and not any(x in _rc477 for x in ("952", "399", "mld", "mln")), _rc477)
_rc477v = SP.riga_cassa({"combustione": {k: v for k, v in _c477.items() if k in (
    "fcf_ttm", "cashflow_al", "cassa", "titoli_breve", "liquidita", "liquidita_base", "mesi_operativi", "mesi_capex")},
    "credito": {}})
check("v477 schede: senza i campi nuovi la riga resta quella di prima, e non afferma una composizione",
      "immateriali" not in _rc477v and "privilegiate" not in _rc477v and "due denominatori diversi" in _rc477v, _rc477v)
_extra477 = _corpo_di(Path(__file__).with_name("rapporto.py").read_text(), "extra")
check("v477 rapporto: la composizione del capex e i dividendi sulle privilegiate sono nella riga CASSA",
      "capex_immateriali_ttm" in _extra477 and "dividendi_privilegiate_ttm" in _extra477
      and "investimenti_immateriali_prevalenti" in _extra477)

# ============================ v478 — IL TASSO EFFETTIVO DI OGGI NEL BRIEF ============================
# `fed_market.current_rate` e' la media MENSILE FEDFUNDS (3,75 a settembre) e il brief la chiamava
# "Fed Funds effettivo" con l'EFFR del giorno a 3,88. Lo stato si COSTRUISCE nei due versi.
def _mc478(macro):
    _t = _tf.mkdtemp()
    _os.makedirs(_os.path.join(_t, "data"))
    _js.dump({"updated_at": "2026-10-14T00:00:00Z", "macro": macro},
             open(_os.path.join(_t, "data", "data.json"), "w"))
    _r = brief.RADICE
    brief.RADICE = _t
    try:
        return brief.macro_dalla_pipeline()["serie"]
    finally:
        brief.RADICE = _r
_s478 = _mc478({"fed_market": {"current_rate": 3.75, "rate_date": "2026-09-01"},
                "fedwatch": {"effr": {"valore": 3.88, "data": "2026-10-09", "fonte": "NY Fed"}}})
_f478 = [s for s in _s478 if s["nome"].startswith("Fed Funds")]
check("v478 brief: con l'EFFR del giorno la riga e' quella, con la sua data e la fonte, e la media mensile non c'e'",
      len(_f478) == 1 and _f478[0]["valore"] == 3.88 and _f478[0]["data"] == "2026-10-09"
      and "EFFR del giorno" in _f478[0]["nome"] and "NY Fed" in (_f478[0]["nota"] or ""), str(_f478))
_s478b = _mc478({"fed_market": {"current_rate": 3.75, "rate_date": "2026-09-01"}})
_f478b = [s for s in _s478b if s["nome"].startswith("Fed Funds")]
check("v478 brief: senza l'EFFR la media mensile si NOMINA col suo mese e non si chiama effettivo",
      len(_f478b) == 1 and "MENSILE" in _f478b[0]["nome"] and "effettivo" not in _f478b[0]["nome"]
      and "settembre 2026" in (_f478b[0]["nota"] or "") and _f478b[0]["data"] is None, str(_f478b))

# ============================ v479 — LA LIQUIDITA' DELLA PAGINA E' QUELLA DEL LIBRO ============================
# config/portfolio_state.json (letto da pagina, pacchetto, conseguenze.py e stato_patrimoniale) e
# memoria/LIBRO.md §1 (letto da numeri_libro.py, rotazione.py e brief.py) annotano la STESSA
# dichiarazione del CEO. La prima e' rimasta a 10.000 € dell'08/08 mentre la seconda diceva
# ~59.000 €: la quota azionaria della pagina usciva circa 84% contro il 71% vero, cioe' il
# moltiplicatore che porta VaR, ES e drawdown dall'azionario al patrimonio (v432). Due copie dello
# stesso numero divergono in silenzio (v410, v439): il gate pretende che coincidano, e se il CEO ne
# aggiorna una il prossimo commit va rosso finche' non si allinea l'altra.
import brief as _b479
_liq_libro479 = _b479.leggi_libro()[1]
_liq_pagina479 = (_json.loads((_ROOT / "config" / "portfolio_state.json").read_text(encoding="utf-8"))
                  .get("cash") or {}).get("v")
check("v479 la liquidita' della pagina (portfolio_state.json) coincide con quella di LIBRO.md",
      isinstance(_liq_libro479, (int, float)) and isinstance(_liq_pagina479, (int, float))
      and abs(_liq_pagina479 - _liq_libro479) < 0.5,
      f"pagina {_liq_pagina479} contro LIBRO.md {_liq_libro479}")

# ============================ v480 — LA WATCHLIST HA DUE COPIE, E DEVONO DIRE GLI STESSI NOMI ============================
# config/ui_watchlist.json decide cosa SEGUE la pipeline (prezzi, target, revisioni, notizie);
# memoria/LIBRO.md §1bis decide cosa LEGGONO gli strumenti dell'analisi (brief, rotazione). Un nome
# scritto in una sola delle due e' seguito e mai letto, oppure letto senza target ne' revisioni — e
# non si rompe niente: la classe v479, una seconda copia che invecchia da sola. I riferimenti si
# riconoscono dalla FORMA del simbolo (v410), non da un elenco; il pavimento sui nomi trovati
# impedisce che il check passi perche' il parser non ha letto niente (v196).
import re as _re480
_ui480 = _json.loads((_ROOT / "config" / "ui_watchlist.json").read_text(encoding="utf-8"))
_pos480, _, _sorv480 = _b479.leggi_libro()
_posiz480 = {p["tk"] for p in _pos480}
_sv480 = {s["tk"] for s in _sorv480}
_resto480 = {t for t in _ui480
             if not _re480.search(r"(^\^|=[XF]$|-(USD|USDT|EUR)$)", t) and t not in _posiz480}
check("v480 ogni sorvegliato di LIBRO.md e' seguito dalla pipeline, e la pipeline non segue nomi che il libro non dichiara",
      len(_sv480) > 0 and _sv480 == _resto480,
      f"solo in ui_watchlist.json: {sorted(_resto480 - _sv480)} · solo in LIBRO.md: {sorted(_sv480 - _resto480)}")
check("v480 ogni posizione di LIBRO.md e' seguita dalla pipeline",
      len(_posiz480) > 0 and _posiz480 <= set(_ui480),
      f"posizioni non seguite: {sorted(_posiz480 - set(_ui480))}")

# ============================ v481-v482 — TENUTA DELLE POSIZIONI: IL BILANCIO DELL'EVIDENZA ============================
# v481 — decisione del CEO del 14/10/2026 (LIBRO.md §1sexies): si lascia correre, si vende per EVIDENZA.
# v482 — lo stesso giorno: "bisogna valutare l'insieme dei fattori macro news bilanci etc e non solo analisi
# tecnica". Le prove stanno nei DUE versi con la stessa soglia; il CONFLITTO (prezzo contro crescita) non e' una
# vendita. Lo stato si COSTRUISCE (v425, v429): oggi i nomi cadono in certi esiti, domani in altri, e un check sui
# dati del giorno sarebbe verde per il caso (v456).
import conseguenze as _C481, itertools as _it482
_s1sex = _lib474[_lib474.find("## 1sexies"):_lib474.find("\n## ", _lib474.find("## 1sexies") + 1)]
def _num481(rx):
    m = re.search(rx, _s1sex)
    return float(m.group(1).replace(",", ".")) if m else None
_dal_libro481 = {"media lunga": (_num481(r"sotto la media a \*\*(\d+)\*\* sedute"), NL.MEDIA_LUNGA),
                 "media breve": (_num481(r"media a \*\*(\d+)\*\* sotto quella a 200"), NL.MEDIA_BREVE),
                 "EPS a 90 giorni": (_num481(r"mossa di oltre il \*\*(\d+)%\*\*"), NL.SOGLIA_EPS_90),
                 "ricavi": (_num481(r"da \*\*\+(\d+)%\*\*"), NL.SOGLIA_RICAVI),
                 "bilancio corto": (_num481(r"meno di \*\*(\d+)\*\* mesi"), NL.AUTONOMIA_CORTA),
                 "bilancio solido": (_num481(r"da \*\*(\d+)\*\* mesi in su"), NL.AUTONOMIA_SOLIDA),
                 "aliquota": (_num481(r"imposta del \*\*(\d+)%\*\*"), _C481.ALIQUOTA * 100)}
check("v481-v482 le soglie della tenuta nel codice sono QUELLE di LIBRO.md §1sexies, lette dal libro",
      len(_s1sex) > 500 and all(a is not None and abs(a - b) < 1e-9 for a, b in _dal_libro481.values()),
      str(_dal_libro481))
check("v481-v482 ogni esito del codice e' nominato nel libro, e il libro porta le DUE decisioni del CEO parola per parola",
      all(f"**{e}**" in _s1sex for e in NL.ESITI) and "lasciar correre mu può portare a ottimi rendimenti" in _s1sex
      and "se ci sono margini di speculazione, ben venga" in _s1sex
      and "bisogna valutare l'insieme dei fattori macro news bilanci etc e non solo analisi" in _s1sex.replace("\n", " ")
      and "Media perché le avevo a 240" in _s1sex)

# --- tendenza: ROTTA = chiusura sotto la 200 E media 50 sotto la 200; la correzione non e' una rottura ---
_scende = [225 - i * 0.5 for i in range(250)]          # in discesa: media 50 ~113, media 200 ~150
_tz481 = {k: NL.tendenza(_barre474(v), _ALLE17) for k, v in (
    ("sale", _sale), ("sotto50", _sale[:-1] + [205.0]), ("sotto200", _sale[:-1] + [150.0]),
    ("scende", _scende), ("risale", _scende[:-1] + [160.0]), ("fra", _scende[:-1] + [130.0]),
    ("corta", _sale[:150]))}
check("v481 tendenza: intatta in salita, IN CORREZIONE sotto la 50, e un crollo sotto la 200 con la 50 sopra NON e' rotta",
      _tz481["sale"]["stato"] == "intatta" and _tz481["sotto50"]["stato"] == "in correzione"
      and _tz481["sotto200"]["stato"] == "in correzione" and not _tz481["sotto200"]["incrocio"],
      str({k: v["stato"] for k, v in _tz481.items()}))
check("v481 tendenza: ROTTA con la 50 sotto la 200 e la chiusura sotto la 200 (anche sopra la 50); sopra la 200 torna "
      "intatta e dichiara l'incrocio; sotto 200 sedute e' NON MISURABILE",
      _tz481["scende"]["stato"] == "rotta" and _tz481["fra"]["stato"] == "rotta" and _tz481["risale"]["stato"] == "intatta"
      and _tz481["risale"]["incrocio"] and _tz481["corta"]["stato"] == "non misurabile",
      str({k: v["stato"] for k, v in _tz481.items()}))
_oggi481 = _barre474(_scende[:-1] + [160.0, 120.0])
check("v481 tendenza: la barra della seduta in corso NON rompe la tendenza, la stessa barra a chiusura si'",
      NL.tendenza(_oggi481, _ALLE11)["stato"] == "intatta" and NL.tendenza(_oggi481, _ALLE11)["seduta"] == "2026-10-08"
      and NL.tendenza(_oggi481, _ALLE17)["stato"] == "rotta")

# --- le prove fondamentali: tre, ciascuna nei DUE versi con la stessa soglia; il verso dell'EPS dalla DIFFERENZA ---
def _riga481(su=5, giu=1, ora=2.0, prima=1.8, ric=(120.0, 100.0), comb=None, target=None):
    r = {"analisti": {"su_30g": su, "giu_30g": giu, "eps_ora": ora, "eps_90g_fa": prima}}
    if target is not None:
        r["analisti"].update({"target_mediana": target[0], "target_min": target[1], "target_max": target[2]})
    if ric:
        r["tv"] = {"conto_trim": [{"trim": "2026-06-30", "ricavi": ric[0]}, {"trim": "2025-06-30", "ricavi": ric[1]}]}
    if comb is not None:
        r["combustione"] = comb
    return r
_pf482 = lambda k, **kw: NL.prove_fondamentali(_riga481(**kw))[k]["verso"]
check("v482 stime: la perdita attesa che si ALLARGA oltre il 5% e' contro (CRWV -3,37 -> -4,33), che si RIDUCE e' a favore; "
      "dentro il 5% in mezzo (RGTI -0,2011 -> -0,206); un utile +7% a favore, -7% contro; i cambi di segno dal verso",
      _pf482("stime", ora=-4.33, prima=-3.37) == "contro" and _pf482("stime", ora=-0.3, prima=-0.5) == "favore"
      and _pf482("stime", ora=-0.206, prima=-0.2011) == "neutro" and _pf482("stime", ora=1.07, prima=1.0) == "favore"
      and _pf482("stime", ora=0.93, prima=1.0) == "contro" and _pf482("stime", ora=0.96, prima=1.0) == "neutro"
      and _pf482("stime", ora=-0.2, prima=0.5) == "contro" and _pf482("stime", ora=0.2, prima=-0.5) == "favore")
check("v482 revisioni: piu' tagli contro, piu' rialzi a favore, pari in mezzo; ricavi da +25% a favore, in calo contro, "
      "fra 0 e +25% in mezzo",
      _pf482("revisioni", su=1, giu=4) == "contro" and _pf482("revisioni", su=3, giu=1) == "favore"
      and _pf482("revisioni", su=2, giu=2) == "neutro" and _pf482("ricavi", ric=(130.0, 100.0)) == "favore"
      and _pf482("ricavi", ric=(125.0, 100.0)) == "favore" and _pf482("ricavi", ric=(124.0, 100.0)) == "neutro"
      and _pf482("ricavi", ric=(90.0, 100.0)) == "contro")
check("v482 una prova senza dati NON ha verso, mai 'neutro' (v406): stime, revisioni e ricavi mancanti; un nome che la "
      "pipeline non segue non ha nessuna prova fondamentale",
      _pf482("stime", prima=None) is None and _pf482("revisioni", su=None) is None and _pf482("ricavi", ric=None) is None
      and all(v["verso"] is None for v in NL.prove_fondamentali(None).values()))
_r481 = _riga481(ric=(130.0, 100.0))
_yoy481 = NL.prove_fondamentali(_r481)["ricavi"]["yoy"]
check("v481-v482 i ricavi della tenuta sono QUELLI delle schede: una funzione sola per la variazione sull'anno (v161)",
      _yoy481 is not None and abs(_yoy481 - SP.ultimo_trimestre(_r481)["yoy"]) < 1e-12
      and "+30,0% sullo stesso trimestre dell'anno prima" in SP.riga_ricavi(_r481)
      and "schede_progetto.ultimo_trimestre(" in _corpo_di(_src_nl, "prove_fondamentali")
      and "ultimo_trimestre(r)" in _corpo_di(Path(__file__).with_name("schede_progetto.py").read_text(), "riga_ricavi"))

# --- il bilancio: autofinanziato o autonomia sul denominatore che VINCOLA; gli immateriali non sono un cantiere (v477) ---
_pb482 = lambda **c: NL.prova_bilancio({"combustione": c})
_crwv482 = _pb482(fcf_ttm=-13.6e9, ocf_ttm=6.9e9, mesi_capex=3.2, liquidita=5.5e9, liquidita_base="aggregato")
_mstr482 = _pb482(fcf_ttm=-21.7e9, mesi_operativi=1462.3, mesi_capex=1.4, mesi_impianti=1392.2, mesi_obblighi=30.2,
                  investimenti_immateriali_prevalenti=True, quota_immateriali_pct=99.9, liquidita=2.4e9,
                  liquidita_base="aggregato", dividendi_privilegiate_ttm=-952.4e6, dividendi_privilegiate_ultimo_trim=-399.6e6)
check("v482 bilancio: CORTO sotto 12 mesi del denominatore che vincola (CRWV: investimenti, 3,2 mesi); SOLIDO chi si "
      "autofinanzia o da 24 mesi; in mezzo fra i due",
      _crwv482["verso"] == "contro" and _crwv482["denominatore"] == "investimenti" and abs(_crwv482["mesi"] - 3.2) < 1e-9
      and _pb482(fcf_ttm=5.0)["verso"] == "favore" and _pb482(fcf_ttm=5.0)["autofinanzia"]
      and _pb482(fcf_ttm=-1.0, mesi_operativi=77.8, mesi_capex=175.9)["verso"] == "favore"
      and _pb482(fcf_ttm=-1.0, mesi_operativi=18.0)["verso"] == "neutro"
      and _pb482(fcf_ttm=-1.0, mesi_operativi=11.9)["verso"] == "contro" and _pb482(fcf_ttm=-1.0, mesi_operativi=24.0)["verso"] == "favore",
      str(_crwv482))
check("v482 bilancio: su chi COMPRA attivita' immateriali (MSTR) gli investimenti contano sui soli impianti, mai sul "
      "totale (v477); vince la perdita piu' dividendi, col ritmo dell'ultimo trimestre dichiarato",
      _mstr482["verso"] == "favore" and _mstr482["denominatore"].startswith("perdita operativa più dividendi")
      and abs(_mstr482["mesi"] - 30.2) < 1e-9 and _mstr482["ritmo_dividendi"] is not None
      and abs(_mstr482["ritmo_dividendi"] - SP.ritmo_dividendi({"dividendi_privilegiate_ttm": -952.4e6,
                                                                  "dividendi_privilegiate_ultimo_trim": -399.6e6})) < 1e-12,
      str(_mstr482))
check("v482 bilancio: senza flusso di cassa, o chi brucia senza nessuna autonomia, NON ha verso; il ritmo dei dividendi e' "
      "una lettura sola con le schede (v161)",
      _pb482()["verso"] is None and _pb482(fcf_ttm=-1.0)["verso"] is None
      and "schede_progetto.ritmo_dividendi(" in _corpo_di(_src_nl, "prova_bilancio")
      and "ritmo_dividendi(c)" in _corpo_di(Path(__file__).with_name("schede_progetto.py").read_text(), "riga_cassa"))

# --- macro del nome: semaforo arancione/rosso, oppure chi brucia cassa col credito acceso; nessun verso a favore ---
_sem481 = lambda col="giallo", cred="acceso", minimo=False: {"colore": col, "minimo": minimo,
                                                             "famiglie": {"credito": {"stato": cred}}}
_mn481 = lambda fcf, sem: NL.macro_nome(fcf, sem)["stato"]
check("v481 macro: chi brucia cassa col credito acceso e' ACCESA, chi si autofinanzia no; in arancione o rosso e' accesa "
      "per tutti",
      _mn481(-1.0, _sem481()) == "acceso" and _mn481(1.0, _sem481()) == "spento"
      and _mn481(1.0, _sem481("arancione", "spento")) == "acceso" and _mn481(1.0, _sem481("rosso", "spento")) == "acceso"
      and _mn481(-1.0, _sem481(cred="spento")) == "spento")
check("v481 macro: flusso di cassa ignoto col credito acceso, credito non misurato, semaforo MINIMO o assente = NON "
      "MISURABILE, mai spenta",
      _mn481(None, _sem481()) == "non misurabile" and _mn481(-1.0, _sem481(cred="non misurabile")) == "non misurabile"
      and _mn481(1.0, _sem481(minimo=True)) == "non misurabile" and _mn481(1.0, None) == "non misurabile"
      and _mn481(None, _sem481(cred="spento")) == "spento")

# --- l'esito: QUALI prove, non quante (v200). Il CONFLITTO e' prezzo contro crescita, e non e' una vendita ---
_re482 = NL.regola_esito
check("v482 esito: il caso CRWV — tendenza rotta, perdita attesa allargata, bilancio corto e macro accesa, MA ricavi "
      "raddoppiati — e' CONFLITTO, non VENDITA; il caso AMD a 170 (rotta, crescita a favore, nient'altro) idem",
      _re482({"tendenza": "contro", "stime": "contro", "revisioni": "favore", "ricavi": "favore", "bilancio": "contro",
              "macro": "contro"}) == NL.CONFLITTO
      and _re482({"tendenza": "contro", "stime": "favore", "ricavi": "favore", "bilancio": "favore", "macro": "neutro"}) == NL.CONFLITTO)
check("v482 esito: VENDITA solo con l'evidenza tutta da una parte — rotta + un'altra prova contro e NESSUNA crescita a "
      "favore; un bilancio solido da solo non apre un conflitto",
      _re482({"tendenza": "contro", "revisioni": "contro", "ricavi": "neutro", "bilancio": "favore"}) == "VENDITA PER EVIDENZA"
      and _re482({"tendenza": "contro", "macro": "contro"}) == "VENDITA PER EVIDENZA"
      and _re482({"tendenza": "contro"}) == "IN OSSERVAZIONE"
      and _re482({"tendenza": "contro", "bilancio": "favore"}) == "IN OSSERVAZIONE"
      and _re482({"tendenza": "neutro", "macro": "contro", "stime": "favore"}) == "IN OSSERVAZIONE"
      and _re482({"tendenza": "favore", "stime": "favore"}) == "LASCIAR CORRERE"
      and _re482({"tendenza": "neutro"}) == "LASCIAR CORRERE")
# le proprieta' su TUTTE le combinazioni (3^5 x 2): una regola sbagliata non le soddisfa per caso (v326)
_ordine482 = {"favore": 0, "neutro": 1, "contro": 2}
_tutte482 = [dict(zip(NL.PROVE, c)) for c in _it482.product(*(NL.VERSI_POSSIBILI[k] for k in NL.PROVE))]
def _peggiora482(v):
    for k in NL.PROVE:
        for w in NL.VERSI_POSSIBILI[k]:
            if _ordine482[w] > _ordine482[v[k]]:
                yield {**v, k: w}
_viol482 = []
for _v in _tutte482:
    _e = _re482(_v)
    _rotta, _crescita = _v["tendenza"] == "contro", any(_v[k] == "favore" for k in NL.CRESCITA)
    _altre = any(_v[k] == "contro" for k in NL.PROVE if k != "tendenza")
    if (_e == NL.CONFLITTO) != (_rotta and _crescita):
        _viol482.append(("conflitto", _v))
    if (_e == "VENDITA PER EVIDENZA") != (_rotta and _altre and not _crescita):
        _viol482.append(("vendita", _v))
    if (_e == "LASCIAR CORRERE") != (not any(x == "contro" for x in _v.values())):
        _viol482.append(("correre", _v))
    if _e == "VENDITA PER EVIDENZA" and any(_re482(w) != "VENDITA PER EVIDENZA" for w in _peggiora482(_v)):
        _viol482.append(("peggiorare toglie la vendita", _v))
check("v482 esito su TUTTE le " + str(len(_tutte482)) + " combinazioni: CONFLITTO se e solo se rotta con crescita a favore; "
      "VENDITA se e solo se rotta, un'altra contro e nessuna crescita; LASCIAR CORRERE se e solo se nessuna contro; e "
      "peggiorare una prova non toglie mai una vendita",
      len(_tutte482) == 486 and not _viol482, str(_viol482[:3]))

# --- PROVVISORIO: un dato mancante che potrebbe cambiare l'esito si dichiara, coi possibili (era il MINIMO v481) ---
_eb482 = lambda **v: NL.esito_bilancio({k: {"verso": v.get(k)} for k in NL.PROVE})
_skhy482 = _eb482(revisioni="favore", ricavi="favore", bilancio="favore", macro="neutro")
check("v482 provvisorio: la tendenza non misurata (SKHY, 66 sedute) con la crescita a favore lascia correre DICHIARANDO "
      "che col dato potrebbe essere CONFLITTO; tutto misurato non e' provvisorio; nulla misurato e' NON MISURABILE",
      _skhy482["esito"] == "LASCIAR CORRERE" and _skhy482["provvisorio"] and NL.CONFLITTO in _skhy482["possibili"]
      and "tendenza" in _skhy482["ignoti"]
      and not _eb482(tendenza="favore", stime="favore", revisioni="favore", ricavi="favore", bilancio="favore",
                     macro="neutro")["provvisorio"]
      and _eb482()["esito"] == "NON MISURABILE", str(_skhy482))
_viol482p = []
for _v in _tutte482[::7]:
    for _n in range(1, 4):
        for _ign in _it482.combinations(NL.PROVE, _n):
            _noti = {k: x for k, x in _v.items() if k not in _ign}
            _r = NL.esito_bilancio({k: {"verso": _noti.get(k)} for k in NL.PROVE})
            _compl = {_re482({**_noti, **dict(zip(_ign, c))}) for c in _it482.product(*(NL.VERSI_POSSIBILI[k] for k in _ign))}
            if _compl != {_r["esito"], *_r["possibili"]} or _r["provvisorio"] != (len(_compl) > 1):
                _viol482p.append((_ign, _v))
check("v482 provvisorio: l'esito dichiarato e i possibili sono ESATTAMENTE gli esiti di ogni completamento dei dati "
      "mancanti, mai uno in meno (v474: nessun esito definitivo che un dato mancante cambierebbe)",
      not _viol482p, str(_viol482p[:2]))

# --- l'interesse composto: il pareggio fiscale e' il calo che ridà le stesse azioni dopo l'imposta ---
_pf481 = NL.pareggio_fiscale(953.19, 87.63, 70)
_netto481 = 953.19 - _C481.ALIQUOTA * (953.19 - 87.63)
check("v481 pareggio fiscale: vendere e ricomprare dopo un calo pari al pareggio ridà le STESSE azioni; imposta = "
      "aliquota x plusvalenza; in perdita nessun pareggio e la minusvalenza si dichiara",
      abs(_netto481 / (953.19 * (1 - _pf481["pareggio_pct"] / 100)) - 1) < 1e-12
      and abs(_pf481["imposta"] - _C481.ALIQUOTA * 70 * (953.19 - 87.63)) < 1e-9 and 23.5 < _pf481["pareggio_pct"] < 23.7
      and NL.pareggio_fiscale(77.81, 97.199, 105)["pareggio_pct"] is None
      and abs(NL.pareggio_fiscale(77.81, 97.199, 105)["minus"] - 105 * (97.199 - 77.81)) < 1e-9
      and NL.pareggio_fiscale(None, 10.0, 5) is None)
check("v481 l'aliquota e' un FATTO che vive in conseguenze.py: nessuna copia del numero in numeri_libro",
      "conseguenze.ALIQUOTA" in _corpo_di(_src_nl, "pareggio_fiscale") and "0.26" not in _src_nl)

# --- la media: il caso di AMD reso aritmetica, su un'unita' di calcolo e con le funzioni degli ingressi ---
_rt482 = {f"2026-{m:02d}-{g:02d}": 0.01 * ((m * 31 + g) % 7 - 3) for m in range(1, 10) for g in range(1, 29)}
_rl482 = {t: 0.6 * x + 0.004 * ((i % 5) - 2) for i, (t, x) in enumerate(sorted(_rt482.items()))}
_rq482 = {t: 0.4 * x + 0.002 * ((i % 3) - 1) for i, (t, x) in enumerate(sorted(_rt482.items()))}
_ma482 = NL.media_aritmetica(77.81, 97.199, 105, 0.029, 270_000.0, 1.12, _rt482, _rl482, _rq482, 26)
check("v482 media: azioni INTERE nell'unita' (n x prezzo <= unita' < (n+1) x prezzo), carico nuovo = media ponderata, "
      "fra il prezzo e il carico; il rialzo per tornare al carico si accorcia e il peso sale",
      _ma482 is not None and not _ma482.get("errore")
      and _ma482["azioni"] * 77.81 <= ROT.UNITA_EUR * 1.12 < (_ma482["azioni"] + 1) * 77.81
      and abs((105 + _ma482["azioni"]) * _ma482["carico_dopo"] - (105 * 97.199 + _ma482["azioni"] * 77.81)) < 1e-6
      and 77.81 < _ma482["carico_dopo"] < 97.199 and _ma482["rientro_dopo"] < _ma482["rientro_prima"]
      and abs(_ma482["rientro_prima"] - (97.199 / 77.81 - 1) * 100) < 1e-9
      and _ma482["peso_dopo"] > _ma482["peso_prima"] and _ma482["conseguenze"] is not None, str(_ma482))
check("v482 media: solo per le posizioni IN PERDITA; senza cambio lo dice invece di inventare l'unita' in dollari; "
      "un'azione che costa piu' dell'unita' si dichiara",
      NL.media_aritmetica(953.19, 87.63, 70, 0.2, 270_000.0, 1.12) is None
      and "cambio" in NL.media_aritmetica(77.81, 97.199, 105, 0.03, 270_000.0, None)["errore"]
      and "costa più" in NL.media_aritmetica(9000.0, 9500.0, 1, 0.03, 270_000.0, 1.12)["errore"])
check("v482 media: unita' e conseguenze vengono da rotazione — UNITA_EUR e conseguenze() — e numeri_libro non ne tiene "
      "una copia (una derivazione sola, v161)",
      "rotazione.UNITA_EUR" in _corpo_di(_src_nl, "media_aritmetica")
      and "rotazione.conseguenze(" in _corpo_di(_src_nl, "media_aritmetica") and "5000" not in _src_nl
      and _ma482["conseguenze"] == ROT.conseguenze(_rt482, _rl482, _rq482, 270_000.0, _ma482["spesa"]))

# --- il blocco: ordine per urgenza, decisioni gia' prese contro proposte, conflitti, vendite aperte da ridiscutere ---
_comb_brucia482 = {"fcf_ttm": -1.0, "mesi_capex": 3.0, "liquidita": 1.0, "liquidita_base": "aggregato"}
_bt481 = {"AAA": _barre474(_scende), "BBB": _barre474(_sale), "CCC": _barre474(_sale), "DDD": _barre474(_scende),
          "EEE": _barre474(_scende)}
_vend482 = dict(su=0, giu=4, ora=1.0, prima=1.0, ric=(100.0, 100.0))     # rotta + tagli, nessuna crescita: VENDITA
_rt481 = {"AAA": _riga481(**_vend482), "BBB": _riga481(), "CCC": _riga481(), "DDD": _riga481(**_vend482),
          "EEE": _riga481(su=1, giu=1, ora=1.0, prima=1.0, ric=(150.0, 100.0), comb=_comb_brucia482)}
_dec481 = [{"tk": "AAA", "aperta": True, "verso": "vendita"}, {"tk": "CCC", "aperta": True, "verso": "vendita"},
           {"tk": "BBB", "aperta": False, "verso": "vendita"}, {"tk": "EEE", "aperta": True, "verso": "vendita"}]
_px481 = {k: 100.0 for k in _bt481}
_tn481 = NL.tenuta_posizioni(["BBB", "CCC", "AAA", "DDD", "EEE"], _bt481, _rt481, _sem481(), _px481,
                             {**{k: 50.0 for k in _bt481}, "EEE": 120.0}, {k: 10 for k in _bt481},
                             {"AAA": 0.1, "BBB": 0.2, "CCC": 0.4, "DDD": 0.2, "EEE": 0.1}, _ALLE17, _dec481,
                             {"fx": 1.12, "valore": 5000.0, "rlibro": {}, "rqqq": {}, "rend": {}, "trim": {"EEE": 5}})
_rtn481 = "\n".join(NL.righe_tenuta(_tn481))
check("v481-v482 blocco: in ordine di URGENZA e poi di peso; una vendita gia' aperta si distingue da una da PROPORRE al CEO",
      [r["tk"] for r in _tn481["righe"]] == ["DDD", "AAA", "EEE", "CCC", "BBB"]
      and "con la decisione già aperta (blocco DECISIONI APERTE): AAA" in _rtn481
      and "VENDITA PER EVIDENZA SENZA decisione aperta: DDD — si PROPONE al CEO" in _rtn481, _rtn481[-900:])
check("v482 blocco: il CONFLITTO si nomina e si lascia al CEO; una vendita APERTA su un nome in conflitto o da lasciar "
      "correre e' una premessa da ridiscutere; una decisione chiusa non conta",
      _tn481["righe"][2]["esito"] == NL.CONFLITTO and f"{NL.CONFLITTO}: EEE" in _rtn481
      and "vendita APERTA che la regola non sostiene da sola: EEE (CONFLITTO — DA VALUTARE), CCC (LASCIAR CORRERE)" in _rtn481
      and "BBB (" not in _rtn481.split("non sostiene da sola")[-1])
_riga_eee482 = _rtn481[_rtn481.find("  EEE"):_rtn481.find("  CCC")]
check("v482 resa: contro e a favore su righe proprie; macro e bilancio dello stesso canale dichiarati una prova; la media "
      "sulla posizione in perdita avverte della vendita aperta e della trimestrale vicina",
      "      contro: tendenza ROTTA" in _riga_eee482 and "bilancio CORTO" in _riga_eee482
      and "      a favore: ricavi +50,0%" in _riga_eee482 and "una prova, non due" in _riga_eee482
      and "      media (un'unità di calcolo, non una quantità)" in _riga_eee482
      and "c'è una vendita APERTA su questo nome" in _riga_eee482 and "trimestrale fra 5 giorni" in _riga_eee482,
      _riga_eee482)
check("v482 resa: le notizie si cercano NEI DUE VERSI (catalizzatori e fatti che rompono la tesi) ogni volta; imposta e "
      "pareggio dichiarano dollari e cambio di carico; la media si dichiara unita' di calcolo col caso AMD",
      "notizie: NON calcolate" in _rtn481 and "NEI DUE VERSI" in _rtn481 and "catalizzatori" in _rtn481
      and "il conto vero lo fa il broker in euro col cambio di carico" in _rtn481
      and "pareggio fiscale 13,0%" in _rtn481 and "§1sexies" in _rtn481.splitlines()[0]
      and "NON una quantità" in _rtn481 and "il caso di AMD" in _rtn481)
_rd482 = "\n".join(NL.righe_tenuta(NL.tenuta_posizioni(
    ["FFF"], {"FFF": _barre474(_scende)}, {"FFF": _riga481(ora=-4.33, prima=-3.37, su=3, giu=1, target=(147.5, 39.0, 278.0))},
    _sem481(), {"FFF": 100.0}, {"FFF": 120.0}, {"FFF": 10}, {"FFF": 1.0}, _ALLE17, None, None)))
_ch482 = NL.tendenza(_barre474(_scende), _ALLE17)["chiusura"]
check("v482 resa: stime e revisioni in versi opposti sono la stessa famiglia e si dichiara; il consenso esce come DISTANZA "
      "dalla chiusura e mai col valore del target, che sta nelle schede (v415); senza media dice che non e' calcolata",
      "puntano in versi opposti" in _rd482 and f"mediana {NL._sg((147.5 / _ch482 - 1) * 100)}% dalla chiusura" in _rd482
      and "147,5" not in _rd482 and "278" not in _rd482 and "aritmetica NON calcolata" in _rd482, _rd482)
_tn481_ar = NL.tenuta_posizioni(["BBB"], _bt481, _rt481, _sem481("arancione"), {"BBB": 100.0},
                                {"BBB": 120.0}, {"BBB": 10}, {"BBB": 1.0}, _ALLE17, None)
_rar481 = "\n".join(NL.righe_tenuta(_tn481_ar))
# v486 — RIAGGANCIATO, non zittito: pretendeva che in arancione «la sua reazione vale anche per i nomi da lasciar
#   correre», cioe' la regola che il CEO ha cambiato il 15/10 («non vendi sui ribassi ma sui massimi»). L'invariante
#   che resta e' il resto della riga: in arancione il colore entra nella tenuta come prova CONTRO, e si dice che non
#   e' una vendita — un colore che compare senza dire cosa comporta si legge come un ordine.
check("v481 resa: in arancione il colore e' una prova CONTRO e NON una vendita (v486); in perdita si dichiara la "
      "minusvalenza invece del pareggio; un libro vuoto lo dice",
      "semaforo arancione: è una prova CONTRO per ogni nome (famiglia macro), non una vendita" in _rar481
      and "vale anche per i nomi da lasciar correre" not in _rar481
      and "minusvalenza ~200 $" in _rar481 and _tn481_ar["righe"][0]["esito"] == "IN OSSERVAZIONE"
      and NL.righe_tenuta({"righe": []}) == ["TENUTA DELLE POSIZIONI: nessuna posizione azionaria"], _rar481)
_tn482_pv = NL.tenuta_posizioni(["GGG"], {"GGG": _barre474(_sale[:120])}, {"GGG": _riga481(prima=None)}, _sem481(),
                                {"GGG": 100.0}, {"GGG": 50.0}, {"GGG": 10}, {"GGG": 1.0}, _ALLE17, None)
_rpv482 = "\n".join(NL.righe_tenuta(_tn482_pv))
check("v482 resa: un esito PROVVISORIO si marca sulla riga coi possibili e si spiega in fondo; le prove non misurate si "
      "nominano",
      _tn482_pv["righe"][0]["provvisorio"] and "LASCIAR CORRERE (PROVVISORIO: con i dati mancanti può essere" in _rpv482
      and "esito PROVVISORIO per GGG" in _rpv482 and "non misurate: tendenza NON MISURABILE" in _rpv482, _rpv482)

# --- collegamento (v399, v443): calcola produce la tenuta con decisioni e media, la sintesi la stampa ---
check("v481-v482 collegamento: calcola produce la tenuta di TUTTE le posizioni con le decisioni del libro e la media sulle "
      "serie degli ingressi; il cambio si legge una volta sola per tenuta e registro; la sintesi la stampa",
      "tenuta_posizioni(TK, B, righe_pipeline(pipe), out[\"semaforo\"]" in _calc474
      and "decisioni, media" in _calc474.split("tenuta_posizioni(")[1][:200]   # v489: segue «, pav)»
      and "rotazione.serie_libro(" in _calc474 and "rotazione.rendimenti_per_data(B[\"QQQ\"])" in _calc474
      and _calc474.count("patrimonio_pipeline(") == 1 and "cassa_eur, pat_pipe," in _calc474
      and "righe_tenuta(o[\"tenuta\"])" in _corpo_di(_src_nl, "sintesi"))

# --- la stessa regola sui sorvegliati: rotazione usa la STESSA funzione e la STESSA resa (v161) ---
_src_rot481 = Path(__file__).with_name("rotazione.py").read_text()
_racc481 = _corpo_di(_src_rot481, "raccogli")
check("v481-v482 collegamento: la raccolta calcola il semaforo sugli stessi dati e la tenuta di ogni sorvegliato con la "
      "funzione delle posizioni; SMH e i leader si scaricano sempre",
      '"tenuta": numeri_libro.valuta_tenuta(B.get(s["tk"]), pipe.get(s["tk"]), sem)' in _racc481
      and "numeri_libro.semaforo(B.get(\"SMH\")" in _racc481
      and '"SMH"}' in _racc481 and "set(numeri_libro.LEADER)" in _racc481
      and "riga_tenuta(t['tenuta'])" in _corpo_di(_src_rot481, "righe_ingresso")
      and "numeri_libro.riga_prove(v)" in _corpo_di(_src_rot481, "riga_tenuta")
      and "numeri_libro.etichetta_esito(v)" in _corpo_di(_src_rot481, "riga_tenuta"))
_v481 = NL.valuta_tenuta(_barre474(_scende), _riga481(**_vend482), _sem481(), _ALLE17)
_v482c = NL.valuta_tenuta(_barre474(_scende), _riga481(**{**_vend482, "ric": (150.0, 100.0)}), _sem481(), _ALLE17)
_o481 = {"watchlist": [_w473("SPEC", tenuta=_v481), _w473("OCCA", tenuta=_v482c)],
         "calendario": {"finestra": 45, "giorni_non_letti": []},
         "asof_target": "2026-10-09T15:44:12Z", "semaforo": {"colore": "giallo", "minimo": False}}
_rw481 = "\n".join(ROT.righe_watchlist(_o481))
check("v481-v482 resa dei sorvegliati: CONTRO l'evidenza e' speculativo, ammesso e dichiarato; un CONFLITTO e' il caso "
      "AMD visto da fuori; contro e a favore sulla stessa riga; l'intestazione porta il semaforo",
      "tenuta se fosse in portafoglio (LIBRO.md §1sexies): VENDITA PER EVIDENZA — un ingresso qui e' speculativo, "
      "CONTRO l'evidenza" in _rw481 and f"tenuta se fosse in portafoglio (LIBRO.md §1sexies): {NL.CONFLITTO}" in _rw481
      and "un'occasione (AMD" in _rw481 and "contro: tendenza ROTTA" in _rw481 and "a favore: ricavi +50,0%" in _rw481
      and "semaforo giallo sugli stessi dati" in _rw481 and set(ROT.LETTURA_INGRESSO) == set(NL.ESITI), _rw481[-1200:])

# --- il piano e il libro: niente vendite a fascia di prezzo, ricerca nei due versi, RGTI da ridiscutere ---
_fmt481 = (_ROOT / "memoria" / "FORMATO_ANALISI.md").read_text(encoding="utf-8")
_s6_481 = _fmt481[_fmt481.find("6. **Tenuta e piano**"):_fmt481.find("7. **Watchlist e rotazione**")]
check("v481-v482 il piano (FORMATO §6) porta il bilancio dell'evidenza, la ricerca nei due versi e la media, e NON ha "
      "piu' vendite a fascia di prezzo; il giallo non prende profitti per prezzo; il registro delle richieste porta le regole",
      "TENUTA DELLE POSIZIONI" in _s6_481 and "Niente vendite a fascia di prezzo" in _s6_481
      and "nei due versi" in _s6_481 and NL.CONFLITTO in _s6_481 and "aritmetica della media" in _s6_481
      and "compensando la plusvalenza" not in _s6_481
      and "Nessuna presa di profitto per prezzo" in NL.reazioni_libro(_lib474).get("giallo", "")
      and "tenuta delle posizioni" in _fmt481.split("Richieste del CEO rese strutturali")[1][:2000]
      and "bilancio dell'evidenza" in _fmt481.split("Richieste del CEO rese strutturali")[1][:2500])
_s5q482 = _lib474[_lib474.find("## 1quinquies"):_lib474.find("## 1sexies")]
check("v482 il libro non afferma piu' che la vendita di RGTI 'regge anche con la regola' — e lo stato delle decisioni NON "
      "si fissa qui: il 14/10 il CEO l'ha revocata, e un gate che pretendeva 'aperta' pinnava una decisione (v481)",
      "regge anche con la regola di tenuta" not in _s5q482)

# ============================ v483 — LE DECISIONI RIMANDATE DI PROPOSITO ============================
# Decisione del CEO del 14/10/2026 sulla media di CRWV: "per ora attendo i conti". Una decisione che aspetta un
# evento si dichiara (LIBRO.md §1quater, regola 4) e lo strumento la riporta a ogni analisi. Lo stato si COSTRUISCE:
# le rimandate del libro cambiano, e un gate che pretendesse CRWV pinnerebbe una decisione (la lezione v481).
_txt483 = (_tab474 + "\n**Rimandate di proposito** (§1quater): spiegazione\nche va a capo.\n\n"
           "- CRWV — la media dopo i conti\n- SKHY — l'ingresso dopo la quotazione piena\n\naltro testo\n"
           "- MU — fuori dalla lista\n## 2. ALTRO\n**Rimandate di proposito**\n- NVDA — fuori dalla sezione\n")
_rr483 = NL.leggi_rimandate(_txt483)
check("v483 le rimandate si leggono solo sotto il loro titoletto e dentro la sezione delle decisioni; la lista finisce alla "
      "prima riga vuota; sezione assente = None, nessuna = []",
      _rr483 == [{"tk": "CRWV", "testo": "la media dopo i conti"}, {"tk": "SKHY", "testo": "l'ingresso dopo la quotazione piena"}]
      and NL.leggi_rimandate("## 1. POSIZIONI\n- CRWV — x\n") is None and NL.leggi_rimandate(_tab474) == [],
      str(_rr483))
_cal483 = {"attesi": [{"tk": "CRWV", "data": "2026-11-09", "giorni": 26}, {"tk": "CRWV", "data": "2026-12-01", "giorni": 48}]}
_rrr483 = "\n".join(NL.righe_rimandate(_rr483, _cal483))
check("v483 ogni rimandata esce con la PRIMA trimestrale dichiarata dalla fonte; senza data nella finestra lo dice e non e' "
      "'nessuna uscita'; senza rimandate il blocco tace, senza sezione lo dichiara",
      "CRWV — la media dopo i conti · prima trimestrale 2026-11-09 (26 g)" in _rrr483 and "2026-12-01" not in _rrr483
      and "SKHY — l'ingresso dopo la quotazione piena · nessuna trimestrale dichiarata dalla fonte nei 45 giorni" in _rrr483
      and NL.righe_rimandate([], _cal483) == [] and "NON trovata" in NL.righe_rimandate(None, _cal483)[0], _rrr483)
_o483 = {"rischio": {"vol_ann": 0.4, "var95": 0.03, "es95": 0.04, "scommesse_eff": 2.0, "mcr": {}, "n_sedute": 250,
                     "beta_libro": {"QQQ": (2.0, 0.8)}},
         "bench": {"QQQ": 0.01, "SMH": 0.02, "SPY": 0.005, "RSP": 0.0}, "inizio": "2026-10-12", "fine": "2026-10-13",
         "sedute": 1, "tot_usd": 270000.0, "ret_libro": 0.01, "pnl_libro": 2700.0, "ret_21": 0.05,
         "bench_21": {"SMH": 0.03, "QQQ": 0.02}, "esclusi_matrice": [], "titoli": [], "stress": {},
         "decisioni": [], "rimandate": _rr483, "calendario": _cal483}
_sint483 = NL.sintesi(_o483)
check("v483 collegamento: calcola legge le rimandate dal libro, e la sintesi le STAMPA — provato eseguendola, non "
      "leggendo il sorgente: un ramo spento che contiene la chiamata passerebbe (v234)",
      'out["rimandate"] = leggi_rimandate()' in _calc474 and "RIMANDATE DI PROPOSITO" in _sint483
      and "CRWV — la media dopo i conti · prima trimestrale 2026-11-09" in _sint483, _sint483[-400:])
_rr483_lib = NL.leggi_rimandate(_lib474)
check("v483 il libro vero si legge: la sezione delle decisioni c'e', e ogni rimandata ha un ticker e un testo (lo stato "
      "delle decisioni non si fissa qui: lo decide il CEO)",
      _rr483_lib is not None and all(r["tk"].isupper() and len(r["testo"]) > 5 for r in _rr483_lib), str(_rr483_lib))


# ============================ v484 — PIANO DI RIDUZIONE, SALVAVITA, SCADENZE DEI CONFLITTI ============================
# Decisioni del CEO del 14/10/2026, sera: «1 tra b e c» (il gradino dell'arancione in proporzione al rischio), «2a»
# (il salvavita a -30% dal massimo dell'azionario), «3a» (ogni CONFLITTO si decide ai conti, con l'esame scritto prima),
# «4b» (il rallentamento della crescita non e' una prova: nessun codice). Lo stato si COSTRUISCE: libro, rischio e
# registro di oggi cambiano, e un gate che leggesse i dati del giorno sarebbe verde per il caso (v429). Le proprieta'
# sono quelle che una formula sbagliata non soddisfa per caso (v326): somma, proporzionalita', tetto, verso dell'imposta.
import copy as _cp484

# --- l'elenco dei semiconduttori si legge dal libro; senza la riga e' None, che si dichiara (v406) ---
_semi484 = NL.semiconduttori_libro(_lib474)
check("v484 l'elenco dei semiconduttori si legge da LIBRO.md §1ter (riga in grassetto, nomi dopo i due punti); senza la "
      "riga e' None, non una lista vuota; la riga sta dentro §1ter e non altrove",
      bool(_semi484) and all(re.fullmatch(r"[A-Z][A-Z0-9\-]*", t) for t in _semi484)
      and NL.semiconduttori_libro("## 1ter. X\n**I semiconduttori del libro** (a, b): MU, NVDA. Altro.\n## 2. Y\n") == ["MU", "NVDA"]
      and NL.semiconduttori_libro("## 1ter. X\nniente\n## 2. Y\n**I semiconduttori del libro** (a): MU.\n") is None,
      str(_semi484))

# --- il piano: un terzo, in proporzione al rischio; fuori matrice per peso; mai oltre la posizione ---
_val484 = {"AAA": 600.0, "BBB": 300.0, "CCC": 100.0, "DDD": 50.0, "FUO": 400.0}
_qty484 = {"AAA": 60, "BBB": 30, "CCC": 10, "DDD": 5, "FUO": 40}
_px484 = {k: 10.0 for k in _val484}
_pmc484 = {"AAA": 5.0, "BBB": 12.0, "CCC": 2.0, "DDD": 10.0, "FUO": 1.0}
_mcr484 = {"AAA": 0.50, "BBB": 0.20, "CCC": 0.05, "FUO": 0.25}            # DDD fuori matrice: senza misura
_p484 = NL.piano_riduzione(["AAA", "BBB", "CCC", "DDD"], _val484, _qty484, _px484, _pmc484, _mcr484)
_r484 = {r["tk"]: r for r in _p484["righe"]}
_quota_ok = abs(sum(r["teorico"] for r in _p484["righe"]) - (600 + 300 + 100 + 50) / 3) < 1e-6
_prop_ok = all(abs(_r484[t]["teorico"] / _mcr484[t] - _r484["AAA"]["teorico"] / _mcr484["AAA"]) < 1e-6 for t in ("BBB", "CCC"))
check("v484 piano: il gradino vale UN TERZO dei semiconduttori presenti; fra quelli misurati si ripartisce in PROPORZIONE "
      "AL RISCHIO (venduto/contributo costante); chi e' fuori matrice si taglia per PESO; chi non e' nell'elenco resta fuori "
      "e si nomina",
      _quota_ok and _prop_ok and _r484["DDD"]["per_peso"] and abs(_r484["DDD"]["teorico"] - 50 / 3) < 1e-9
      and _p484["fuori_piano"] == ["FUO"] and _p484["fuori_elenco"] == [],
      str({t: round(r["teorico"], 3) for t, r in _r484.items()}))
check("v484 piano «tra b e c»: chi porta piu' rischio di quanto pesa si taglia di PIU' di un terzo, chi ne porta meno di "
      "MENO — fra i soli MU e AMD (b) e un terzo di ciascuno (c)",
      _r484["AAA"]["teorico"] / _val484["AAA"] > 1 / 3 > _r484["BBB"]["teorico"] / _val484["BBB"]
      and _r484["CCC"]["teorico"] / _val484["CCC"] < 1 / 3,
      str({t: round(r["teorico"] / _val484[t], 3) for t, r in _r484.items()}))
check("v484 piano: azioni INTERE, le piu' vicine; l'imposta solo sulla plusvalenza delle azioni vendute (aliquota di "
      "conseguenze.py), una posizione in perdita porta la minusvalenza e nessuna imposta",
      _r484["AAA"]["azioni"] == 22 and _r484["BBB"]["azioni"] == 9 and _r484["CCC"]["azioni"] == 2
      and abs(_r484["AAA"]["imposta"] - _C.ALIQUOTA * 22 * 5) < 1e-9 and _r484["BBB"]["imposta"] == 0
      and abs(_r484["BBB"]["minus"] - 18) < 1e-9 and abs(_p484["venduto"] - sum(r["azioni"] * 10 for r in _p484["righe"])) < 1e-9,
      str({t: (r["azioni"], round(r["imposta"], 2), r["minus"]) for t, r in _r484.items()}))
_cap484 = NL.piano_riduzione(["XXX", "YYY"], {"XXX": 30.0, "YYY": 970.0}, {"XXX": 3, "YYY": 97},
                              {"XXX": 10.0, "YYY": 10.0}, {"XXX": 1.0, "YYY": 1.0}, {"XXX": 0.9, "YYY": 0.1})
_rc484 = {r["tk"]: r for r in _cap484["righe"]}
_nul484 = NL.piano_riduzione(["P", "Z"], {"P": 100.0, "Z": 500.0}, {"P": 10, "Z": 50}, {"P": 10.0, "Z": 10.0},
                             {"P": 1.0, "Z": 1.0}, {"P": 0.5, "Z": -0.1})
check("v484 piano: un nome non si vende OLTRE la posizione e l'eccedenza va agli altri; un contributo al rischio nullo o "
      "negativo non si vende; quello che non trova posto si DICHIARA, non sparisce",
      _rc484["XXX"]["azioni"] == 3 and abs(_rc484["YYY"]["teorico"] - (1000 / 3 - 30)) < 1e-6 and not _cap484["non_ripartito"]
      and _nul484["righe"][1]["nullo"] and _nul484["righe"][1]["azioni"] == 0
      and abs(_nul484["non_ripartito"] - 100) < 1e-6
      and "non trovano posto" in "\n".join(NL.righe_piano(_nul484, "arancione")),
      str((_rc484, _nul484["non_ripartito"])))
_rng484 = np.random.default_rng(484)
_R484 = _rng484.normal(0, 0.02, (250, 2))
_pr484 = NL.piano_riduzione(["A1", "A2"], {"A1": 700.0, "A2": 300.0}, {"A1": 70, "A2": 30}, {"A1": 10.0, "A2": 10.0},
                            {"A1": 5.0, "A2": 5.0}, {"A1": 0.6, "A2": 0.4}, _R484, ["A1", "A2"])
_C484 = np.cov(_R484, rowvar=False) * 252
_v0 = np.array([700.0, 300.0])
check("v484 piano: il rischio prima e' sqrt(v'Cv) annuo sulla stessa matrice (rifatto qui in modo indipendente), e dopo "
      "la vendita e' minore; senza rendimenti il rischio e' n.d. e la resa lo dice",
      abs(_pr484["rischio"]["prima"] - math.sqrt(_v0 @ _C484 @ _v0)) < 1e-9
      and _pr484["rischio"]["dopo"] < _pr484["rischio"]["prima"] and _p484["rischio"] is None
      and "rischio prima e dopo n.d." in "\n".join(NL.righe_piano(_p484, "giallo")))
_rg484 = "\n".join(NL.righe_piano(_p484, "giallo"))
_ra484 = "\n".join(NL.righe_piano(_p484, "arancione"))
_rs484 = "\n".join(NL.righe_piano(_p484, "giallo", {"scattato_il": "2026-10-20"}))
# v486 — RIAGGANCIATO, non zittito: pretendeva «DA ESEGUIRE» in arancione, cioe' la regola che il CEO ha cambiato il
#   15/10 alle due domande («Solo il salvavita», «Solo col semaforo acceso»). L'invariante nuovo si percorre su TUTTI
#   gli stati, non su quello comodo (v419, v420): DA ESEGUIRE se e solo se il salvavita e' scattato, in ogni colore —
#   un salvavita scattato in giallo vende, un arancione senza salvavita no, e lo dice.
_stati486 = [(c, s) for c in ("verde", "giallo", "arancione", "rosso", None)
             for s in (None, {"scattato_il": None}, {"scattato_il": "2026-10-20"})]
_sbagliati486 = []
for _c486, _s486 in _stati486:
    if ("DA ESEGUIRE" in "\n".join(NL.righe_piano(_p484, _c486, _s486))) != bool((_s486 or {}).get("scattato_il")):
        _sbagliati486.append(f"{_c486}/{_s486}")
_rr486 = "\n".join(NL.righe_piano(_p484, "rosso"))
check("v486 resa del piano: DA ESEGUIRE se e solo se il salvavita e' scattato, in OGNI colore (15 stati); arancione e "
      "rosso senza salvavita dicono di essere un segnale e non una vendita; nome per nome con azioni e imposta; chi e' "
      "fuori dal piano si nomina; non e' una raccomandazione; senza elenco si dichiara",
      not _sbagliati486 and "si esegue SOLO col salvavita scattato" in _rg484
      and "il semaforo arancione è un segnale, non una vendita" in _ra484 and "DA ESEGUIRE: il salvavita è scattato" in _rs484
      and "il semaforo rosso è un segnale, non una vendita" in _rr486
      and "un segnale, non una vendita" not in _rg484 and "il prossimo è il rosso" not in _ra484
      and "AAA   vendere 22 azioni" in _rg484
      and "fuori dal piano (non nell'elenco dei semiconduttori): FUO" in _rg484 and "non una raccomandazione" in _rg484
      and "NON calcolato" in NL.righe_piano(NL.piano_riduzione(None, {}, {}, {}, {}, {}))[0],
      "stati sbagliati: " + ", ".join(_sbagliati486) + "\n" + _ra484)
_rz484 = NL.reazioni_libro(_lib474)


def _reazione_salvavita486(testo):
    """La riga «- **Reazione**» del salvavita in LIBRO.md §1ter, con le sue righe di continuazione."""
    i = testo.find("**Il salvavita sul patrimonio**")
    j = testo.find("- **Reazione**", i) if i >= 0 else -1
    if j < 0:
        return ""
    out = []
    for riga in testo[j:].splitlines():
        if out and not riga.startswith("  "):
            break
        out.append(riga.strip())
    return " ".join(out).replace("**", "")


_rsv486 = _reazione_salvavita486(_lib474)
# v486 — RIAGGANCIATO, non zittito: pretendeva «un terzo» nella reazione dell'arancione e «un altro terzo» in quella
#   del rosso. Dopo il 15/10 quelle parole restano nel libro solo come STORIA («Fino al 15/10 l'arancione toglieva un
#   terzo…»), e il check vecchio passava ancora leggendo la storia invece della regola: l'ottava volta che un gate
#   trova la prosa che spiega il cambiamento (v213, v240, v393, v395, v418). Il gradino oggi vive nella reazione del
#   SALVAVITA; arancione e rosso devono dire «nessuna vendita».
check("v486 il gradino del codice e' QUELLO del libro: un terzo dei semiconduttori in proporzione al rischio, nella "
      "reazione del SALVAVITA, che e' l'unica vendita automatica; arancione e rosso dicono «nessuna vendita» "
      "(LIBRO.md §1ter, letto dal libro come le soglie del v474)",
      abs(NL.QUOTA_GRADINO - 1 / 3) < 1e-12 and "un terzo dei semiconduttori" in _rsv486
      and "in proporzione al rischio" in _rsv486 and "unica vendita automatica" in _rsv486
      and "nessuna vendita" in _rz484.get("arancione", "") and "nessuna vendita" in _rz484.get("rosso", ""),
      _rsv486[:300] + " | " + str(_rz484.get("arancione", ""))[:200])

# --- il salvavita: sul rendimento ponderato per il tempo, le operazioni non lo falsano; una volta per discesa ---
def _rg484f(seduta, pos, px):
    return {"seduta": seduta, "posizioni": pos, "prezzi": px, "qqq": 100.0}
_reg484 = [_rg484f("2026-10-01", {"A": 10}, {"A": 100.0}), _rg484f("2026-10-02", {"A": 10}, {"A": 110.0}),
           _rg484f("2026-10-05", {"A": 5}, {"A": 110.0}), _rg484f("2026-10-06", {"A": 5}, {"A": 75.0}),
           _rg484f("2026-10-07", {"A": 5}, {"A": 80.0}), _rg484f("2026-10-08", {"A": 5}, {"A": 120.0})]
_sv3 = NL.salvavita(_reg484[:3])
_sv5 = NL.salvavita(_reg484[:5])
_sv6 = NL.salvavita(_reg484)
check("v484 salvavita: la VENDITA di meta' delle azioni a prezzo fermo non e' un calo (rendimento ponderato per il "
      "tempo, posizioni dell'inizio di ogni intervallo) e il massimo e' l'ULTIMA seduta al livello piu' alto; oltre -30% "
      "dal massimo scatta, e la data e' la PRIMA seduta oltre",
      _sv3["calo"] == 0 and _sv3["massimo"] == "2026-10-05" and _sv3["scattato_il"] is None
      and _sv5["scattato_il"] == "2026-10-06" and abs(_sv5["calo"] - (80 / 110 - 1)) < 1e-9
      and abs(_sv5["peggiore"] - (75 / 110 - 1)) < 1e-9,
      str((_sv3, _sv5)))
check("v484 salvavita: scatta UNA volta per discesa (risalire sopra la soglia senza un massimo nuovo non lo riarma) e si "
      "riarma col massimo nuovo; meno di due sedute non si misura; un intervallo senza prezzi si salta e si nomina",
      _sv5["scattato_il"] == "2026-10-06" and _sv6["scattato_il"] is None and _sv6["massimo"] == "2026-10-08"
      and NL.salvavita(_reg484[:1])["stato"] == "non misurabile"
      and NL.salvavita([_reg484[0], _rg484f("2026-10-02", {"A": 10}, {"A": None}), _reg484[2]])["saltati"]
      and NL.salvavita(_reg484[:2], _rg484f("2026-10-02", {"A": 10}, {"A": 50.0}))["provvisoria"] is False
      and NL.salvavita(_reg484[:2], _rg484f("2026-10-05", {"A": 10}, {"A": 50.0}))["scattato_il"] == "2026-10-05",
      str(_sv6))
_m484 = re.search(r"\*\*Soglia: [−-](\d+)%\*\*", _lib474)
check("v484 la soglia del salvavita nel codice e' QUELLA di LIBRO.md §1ter, letta dal libro (v474: una regola in due "
      "posti diverge)",
      _m484 is not None and abs(-int(_m484.group(1)) / 100 - NL.SOGLIA_SALVAVITA) < 1e-9,
      str(_m484.group(0) if _m484 else None))
_rsv5 = "\n".join(NL.righe_salvavita(_sv5))
_rsv3 = "\n".join(NL.righe_salvavita(_sv3))
check("v484 resa del salvavita: scattato va in cima con la data, il massimo e il gradino da eseguire; altrimenti dice "
      "quanto manca da qui; non misurabile si dichiara",
      "SALVAVITA SCATTATO il 2026-10-06" in _rsv5 and "PIANO DI RIDUZIONE" in _rsv5 and "va in cima alla risposta" in _rsv5
      and "scatta a -30%" in _rsv3 and "un altro -30" in _rsv3
      and "NON MISURABILE" in NL.righe_salvavita(NL.salvavita([]))[0], _rsv5 + "\n" + _rsv3)

# --- la scadenza dei conflitti e gli esami scritti prima ---
_txt484 = (_tab474 + "\n**Rimandate di proposito**\n\n- CRWV — la media\n\n**Esami dei conflitti** (§1sexies)\n"
           "spiegazione.\n\n- RGTI — conti del 2026-11-09 · tenere se X · vendere se Y\n- ZZZ — senza data\n\n(altro)\n"
           "- MU — fuori dalla lista\n")
_es484 = NL.leggi_esami(_txt484)
check("v484 gli esami si leggono sotto il loro titoletto con la data dei conti, e finiscono alla riga vuota; rimandate ed "
      "esami non si mescolano; sezione delle decisioni assente = None",
      [e["tk"] for e in _es484] == ["RGTI", "ZZZ"] and _es484[0]["conti"] == "2026-11-09" and _es484[1]["conti"] is None
      and [r["tk"] for r in NL.leggi_rimandate(_txt484)] == ["CRWV"] and NL.leggi_esami("## 1. X\n- RGTI — y\n") is None,
      str(_es484))
_c484 = lambda **kw: {"tk": "X", "esito": NL.CONFLITTO, **kw}
_ts484 = NL.testo_scadenza
check("v484 la scadenza di un CONFLITTO: i conti dichiarati dalla fonte con l'esame da mandare 7 giorni prima; entro 7 "
      "giorni DA SCRIVERE ORA; esame scritto si dice; conti usciti si confrontano; senza data si dichiara (non 'nessuna "
      "uscita'); non calcolata si dice",
      "esame da mandare al CEO dal 2026-11-02 (fra 19 g)" in _ts484(_c484(scadenza={"data": "2026-11-09", "giorni": 26}, esame=None))
      and "DA SCRIVERE ORA" in _ts484(_c484(scadenza={"data": "2026-10-20", "giorni": 6}, esame=None))
      and "esame scritto" in _ts484(_c484(scadenza={"data": "2026-10-20", "giorni": 6}, esame={"conti": "2026-10-20"}), "2026-10-14")
      and "USCITI" in _ts484(_c484(scadenza=None, esame={"conti": "2026-10-20"}), "2026-10-21")
      and "nessuna trimestrale dichiarata dalla fonte nei prossimi 45 giorni" in _ts484(_c484(scadenza=None, esame=None), "2026-10-14", 45)
      and "NON calcolata" in _ts484({"tk": "X", "esito": NL.CONFLITTO}))
_tn484 = NL.con_scadenze(_cp484.deepcopy(_tn481), {"EEE": {"tk": "EEE", "data": "2026-11-09", "giorni": 26}}, [], 45, _ALLE17)
_rtn484 = "\n".join(NL.righe_tenuta(_tn484))
check("v484 resa: la scadenza esce sotto ogni CONFLITTO e sotto nessun altro esito; la riga di chiusura dice che ciascuno "
      "si decide ai propri conti con l'esame scritto prima",
      _rtn484.count("scadenza (LIBRO.md §1sexies") == sum(1 for r in _tn484["righe"] if r["esito"] == NL.CONFLITTO) == 1
      and "si decide coi conti del 2026-11-09 (26 g)" in _rtn484 and "con l'esame scritto prima" in _rtn484, _rtn484[-700:])

# --- collegamento (v399, v443): calcola produce piano, salvavita ed esami; la sintesi li STAMPA sotto il semaforo ---
_o484 = {**_o483, "salvavita": _sv5, "piano": _p484, "semaforo": None}
_sint484 = NL.sintesi(_o484)
check("v484 collegamento: calcola produce il piano dall'elenco del libro, il salvavita dal registro e le scadenze dei "
      "conflitti; la sintesi stampa salvavita e piano PRIMA del resto — provato eseguendola, non leggendo il sorgente (v234)",
      'out["piano"] = piano_riduzione(semiconduttori_libro(), val, qty, px, pmc, ris["mcr"], R, lunghi)' in _calc474 and 'out["salvavita"] = salvavita(' in _calc474
      and 'out["esami"] = leggi_esami()' in _calc474 and 'con_scadenze(out["tenuta"], scad, out["esami"]' in _calc474
      and "SALVAVITA SCATTATO" in _sint484 and "PIANO DI RIDUZIONE" in _sint484
      and _sint484.find("SALVAVITA") < _sint484.find("PIANO DI RIDUZIONE") < _sint484.find("Periodo "), _sint484[:500])
_s0_484 = _fmt481[_fmt481.find("0. **Semaforo d'uscita**"):_fmt481.find("0bis.")]
check("v484 il formato porta salvavita e piano nella sezione 0, la scadenza e l'esame dei conflitti nella sezione 6, e il "
      "registro delle richieste le elenca (analisi.py stampa la checklist da qui)",
      "SALVAVITA" in _s0_484 and "PIANO DI RIDUZIONE" in _s0_484 and "esame scritto prima" in _s6_481
      and "salvavita" in _fmt481.split("Richieste del CEO rese strutturali")[1][:3500])
_es484_lib = NL.leggi_esami(_lib474)
check("v484 il libro vero si legge: la sezione delle decisioni c'e', e ogni esame ha un ticker (lo stato degli esami non "
      "si fissa qui: lo decide il CEO, v481)",
      _es484_lib is not None and all(e["tk"].isupper() for e in _es484_lib), str(_es484_lib))

# ================================================================ v485 — la chiusura ufficiale dopo la campana
# Misurato il 14/10/2026 alle 16:26 ET: lo storico dava NVDA 223,715 e MU 921,30 dove le chiusure ufficiali
# erano 221,30 e 914,13, e --registra le aveva scritte nel registro. Lo stato si COSTRUISCE (v429): nessun
# check aspetta che la fonte sia lenta proprio mentre gira la suite, e l'orologio si inietta (v402).
import brief as _bf485
from datetime import datetime as _dt485
_NY485 = _bf485.NEW_YORK
_d485 = [{"t": "2026-10-13", "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1000, "a": 10.5},
         {"t": "2026-10-14", "o": 10.6, "h": 11.2, "l": 10.1, "c": 10.9, "v": 600, "a": 10.9}]
_q485 = {"p": 10.4, "o": 10.6, "h": 11.3, "l": 10.0, "v": 1500, "cp": -0.95, "td": "2026-10-14", "ms": "closed"}
_u485 = _bf485.chiusura_ufficiale(_d485, _q485)
check("v485 dopo la campana l'ultima barra prende chiusura, apertura, massimo, minimo e volume dalla quotazione ed e' "
      "marcata ufficiale; le barre prima restano identiche e l'ingresso non si modifica",
      _u485[-1]["c"] == 10.4 and _u485[-1]["a"] == 10.4 and _u485[-1]["l"] == 10.0 and _u485[-1]["h"] == 11.3
      and _u485[-1]["v"] == 1500 and _u485[-1].get("ufficiale") is True and _u485[0] == _d485[0]
      and _d485[-1]["c"] == 10.9 and "ufficiale" not in _d485[-1], str(_u485))
_aperta485 = _bf485.chiusura_ufficiale(_d485, dict(_q485, ms="open"))
_altra485 = _bf485.chiusura_ufficiale(_d485, dict(_q485, td="2026-10-15"))
_senza485 = _bf485.chiusura_ufficiale(_d485, dict(_q485, p=None))
check("v485 senza conferma la barra resta com'e' e NON marcata: seduta ancora aperta, data diversa, chiusura assente",
      all(x == _d485 and "ufficiale" not in x[-1] for x in (_aperta485, _altra485, _senza485)),
      str((_aperta485[-1], _altra485[-1], _senza485[-1])))

# --- collegamento (v399, v443): brief.barre la usa davvero, e solo la sera stessa (costo: una richiesta in piu') ---
_url485 = []
def _jget485(url, timeout=20):
    _url485.append(url)
    if "/history" in url:
        return {"data": [dict(x) for x in _d485]}
    if "/quotes/" in url:
        return {"data": dict(_q485)}
    raise AssertionError(url)
def _jget_rotta485(url, timeout=20):
    if "/quotes/" in url:
        raise OSError("quotazione non raggiungibile")
    return {"data": [dict(x) for x in _d485]}
_jget_vero485 = _bf485.jget
try:
    _bf485.jget = _jget485
    _sera485 = _bf485.barre("AAA", _dt485(2026, 10, 14, 16, 30, tzinfo=_NY485)); _n_sera485 = len(_url485); _url485.clear()
    _giorno485 = _bf485.barre("AAA", _dt485(2026, 10, 14, 15, 30, tzinfo=_NY485)); _n_giorno485 = len(_url485); _url485.clear()
    _domani485 = _bf485.barre("AAA", _dt485(2026, 10, 15, 8, 0, tzinfo=_NY485)); _n_domani485 = len(_url485); _url485.clear()
    _bf485.jget = _jget_rotta485
    _rotta485 = _bf485.barre("AAA", _dt485(2026, 10, 14, 16, 30, tzinfo=_NY485))
finally:
    _bf485.jget = _jget_vero485
check("v485 collegamento: brief.barre la sera stessa chiede la quotazione e conferma la chiusura; durante la seduta e il "
      "giorno dopo non la chiede e non tocca la barra; se la quotazione non risponde la barra resta NON marcata, senza eccezione",
      _sera485[-1]["c"] == 10.4 and _sera485[-1].get("ufficiale") is True and _n_sera485 == 2
      and _giorno485[-1]["c"] == 10.9 and _n_giorno485 == 1 and _domani485[-1]["c"] == 10.9 and _n_domani485 == 1
      and _rotta485[-1]["c"] == 10.9 and "ufficiale" not in _rotta485[-1],
      str((_n_sera485, _n_giorno485, _n_domani485, _sera485[-1], _rotta485[-1])))

# --- una regola sola per l'ora della campana (v161): sullo stesso giorno 'dopo la campana' e 'seduta in corso' sono complementari ---
_ore485 = [_dt485(2026, 10, 14, h, m, tzinfo=_NY485) for h in range(24) for m in (0, 59)]
check("v485 sullo stesso giorno 'dopo la campana' e' esattamente il complemento di 'seduta in corso'; su un altro giorno "
      "sono entrambi falsi",
      all(_bf485.dopo_la_campana("2026-10-14", a) == (not ROT.seduta_in_corso([{"t": "2026-10-14", "c": 1.0}], a)) for a in _ore485)
      and not any(_bf485.dopo_la_campana("2026-10-13", a) or ROT.seduta_in_corso([{"t": "2026-10-13", "c": 1.0}], a)
                  for a in _ore485))

# --- il registro: la sera stessa scrive solo chiusure confermate; il giorno dopo lo storico e' definitivo ---
_b485 = {"AAA": [{"t": "2026-10-14", "c": 110.0, "ufficiale": True}], "BBB": [{"t": "2026-10-14", "c": 45.0}],
         "QQQ": [{"t": "2026-10-14", "c": 606.0}]}
_b485ok = {k: [dict(x, ufficiale=True) for x in v] for k, v in _b485.items()}
_pat485 = (1.25, "x", {"BTP": (101.5, "pipeline")})
_SERA485, _MATTINA485 = _dt485(2026, 10, 14, 16, 30, tzinfo=_NY485), _dt485(2026, 10, 15, 8, 0, tzinfo=_NY485)
with _tf474.TemporaryDirectory() as _dr485:
    _pr485 = _os474.path.join(_dr485, "reg.jsonl")
    _no485 = NL.aggiorna_registro(_b485, {"AAA": 10, "BBB": 20}, {"BTP": 10000}, 25000.0, _pat485, "arancione", True,
                                  _SERA485, _pr485)
    _n_no485 = len(NL.leggi_registro(_pr485)[0])
    _si485 = NL.aggiorna_registro(_b485ok, {"AAA": 10, "BBB": 20}, {"BTP": 10000}, 25000.0, _pat485, "arancione", True,
                                  _SERA485, _pr485)
    _riga485 = NL.leggi_registro(_pr485)[0]
with _tf474.TemporaryDirectory() as _dr485b:
    _pr485b = _os474.path.join(_dr485b, "reg.jsonl")
    _mat485 = NL.aggiorna_registro(_b485, {"AAA": 10, "BBB": 20}, {"BTP": 10000}, 25000.0, _pat485, "arancione", True,
                                   _MATTINA485, _pr485b)
check("v485 la sera stessa il registro NON scrive chiusure non confermate e nomina quali, QQQ compreso (meglio una riga "
      "in meno che una sbagliata, v396); confermate tutte, scrive",
      _no485["esito"].startswith("non scritto") and "per BBB, QQQ —" in _no485["esito"] and _n_no485 == 0
      and _si485["esito"].startswith("scritto") and len(_riga485) == 1 and _riga485[0]["prezzi"] == {"AAA": 110.0, "BBB": 45.0},
      str((_no485["esito"], _si485["esito"])))
check("v485 il giorno dopo la stessa seduta si scrive con lo storico, senza conferma: e' gia' definitivo (righe scritte 1,5 "
      "e 12 ore dopo la campana: 11 prezzi su 11 coincidono con lo storico del giorno dopo)",
      _mat485["esito"].startswith("scritto") and "2026-10-14" in _mat485["esito"], str(_mat485["esito"]))

# ================================================================ v486 — arancione e rosso non vendono, resta il salvavita
# Decisione del CEO del 15/10/2026, al primo arancione, testuale: «mantenere le posizioni di Mu e amd e gli altri.
# Non vendi sui ribassi ma sui massimi»; poi, alle due domande: «Solo il salvavita» e «Solo col semaforo acceso».
# I colori restano (un segnale, e una prova CONTRO nella tenuta), il gradino si esegue solo col salvavita scattato,
# e nessuna resa deve ancora presentare arancione o rosso come una vendita: un colore letto come un ordine e' la
# classe delle etichette che affermano piu' del dato (v240, v405).
check("v486 semaforo in arancione: la reazione letta dal libro dice «nessuna vendita» e chi pesa nel rischio esce "
      "come informazione, non come le azioni da vendere",
      "nessuna vendita" in _r_ar and "un'informazione, non una vendita" in _r_ar and "le azioni da vendere" not in _r_ar,
      _r_ar[-600:])
check("v486 rotazione: il piano della liquidita' e la watchlist dicono che il semaforo non vieta ingressi in nessun "
      "colore, e non rimandano piu' alla riduzione del gradino in arancione e rosso",
      "il SEMAFORO non vieta ingressi" in _tp474 and "vale prima la riduzione del gradino" not in _tp474
      and "il SEMAFORO non vieta ingressi in nessun colore" in _rw481 and "decide cosa e' ammesso" not in _rw481,
      _tp474[:400])
_q1486 = _lib474[_lib474.find("## 1quinquies"):_lib474.find("\n## ", _lib474.find("## 1quinquies") + 1)]
check("v486 la decisione del 15/10 e' nel libro, con le parole del CEO: nella reazione dell'arancione e fra le "
      "decisioni (§1quinquies) — una decisione riassunta a memoria cambia verso senza rompere niente (v474)",
      "non vendi sui ribassi ma sui massimi" in _rz484.get("arancione", "") and "15/10/2026" in _rz484.get("arancione", "")
      and "NON è stato eseguito" in _q1486 and "15/10/2026" in _q1486 and "una volta per discesa" in _rsv486,
      _q1486[-500:])

# ================================================================ v487 — i pavimenti: entrare sui minimi
# Decisione del CEO del 15/10/2026, testuale: «Non voglio entrare quando risalgono, ma voglio entrare sui minimi»;
# poi «Si» a renderli un calcolo con le stesse regole per tutti i titoli (LIBRO.md §1bis). Ogni stato si COSTRUISCE
# (v425, v429): una serie sintetica dove il fenomeno c'e' per costruzione, a qualunque data giri la suite.
from datetime import date as _d487, timedelta as _td487, datetime as _dt487
def _serie487(lows, inizio="2025-01-06", a=None, alto=6.0):
    """Barre sintetiche: minimo dato, massimo = minimo + alto (6 > ogni passo, quindi nessun vuoto non voluto),
    chiusura a meta', volume crescente. `a` = rapporto rettificato/grezzo per barra (default 1)."""
    out, g = [], _d487.fromisoformat(inizio)
    for i, lo in enumerate(lows):
        while g.weekday() >= 5:
            g += _td487(days=1)
        c = lo + alto / 2
        out.append({"t": g.isoformat(), "o": c, "h": lo + alto, "l": lo, "c": c,
                    "a": c * (1.0 if a is None else a[i]), "v": 1000 + i})
        g += _td487(days=1)
    return out
def _V487(fondo):
    return [fondo + 5, fondo + 4, fondo + 3, fondo + 2, fondo + 1, fondo, fondo + 1, fondo + 2, fondo + 3, fondo + 4, fondo + 5]

# --- un minimo di oscillazione sotto il prezzo e' un pavimento; ordine al bordo alto, stop 1 ATR sotto il fondo ---
_s487 = _serie487([100] * 6 + _V487(90) + [100] * 15)
_pv487 = ROT.pavimenti(_s487, 110.0, 2.0)
_z487 = (_pv487 or {}).get("minimi") or [{}]
check("v487 un minimo di oscillazione sotto il prezzo e' un pavimento: un tocco, il rimbalzo nelle 20 sedute dopo, "
      "l'ordine con limite al bordo alto e lo stop una chiusura sotto il fondo meno 1 ATR, con la perdita per 5.000 €",
      len(_pv487["minimi"]) == 1 and _z487[0]["alto"] == 90 and _z487[0]["fondo"] == 90 and len(_z487[0]["tocchi"]) == 1
      and _z487[0]["tocchi"][0]["data"] == _s487[11]["t"] and abs(_z487[0]["tocchi"][0]["rimbalzo_pct"] - (106 / 90 - 1) * 100) < 1e-9
      and _z487[0]["ordine"] == 90 and abs(_z487[0]["stop"] - 88.0) < 1e-9
      and abs(_z487[0]["perdita_eur"] - 5000 * (88 / 90 - 1)) < 1e-9 and not _pv487["vuoti"], str(_z487[0])[:400])
check("v487 un minimo non ancora confermato (meno di 5 sedute dopo) o sopra il prezzo NON e' un pavimento; un tratto "
      "piatto ne da' uno solo, non un tocco per seduta",
      not ROT.pavimenti(_serie487([100] * 20 + [95, 90, 95, 96]), 110.0, 2.0)["minimi"]
      and not ROT.pavimenti(_s487, 85.0, 2.0)["minimi"]
      and len(ROT.pavimenti(_serie487([104] * 8 + [100] * 12 + [104] * 8), 110.0, 2.0)["minimi"]) == 1)

# --- raggruppati entro mezzo ATR: un pavimento e' largo al massimo mezzo ATR ---
_g1 = ROT.pavimenti(_serie487([100] * 6 + _V487(90) + [100] * 6 + _V487(90.8) + [100] * 10), 110.0, 2.0)["minimi"]
_g2 = ROT.pavimenti(_serie487([100] * 6 + _V487(90) + [100] * 6 + _V487(91.2) + [100] * 10), 110.0, 2.0)["minimi"]
_g3 = ROT.pavimenti(_serie487([100] * 6 + _V487(92) + [100] * 6 + _V487(91.4) + [100] * 6 + _V487(90.8) + [100] * 10),
                    110.0, 2.0)["minimi"]
check("v487 minimi entro mezzo ATR sono lo stesso pavimento (due tocchi, ordine al piu' alto, stop sotto il piu' basso); "
      "oltre mezzo ATR sono due pavimenti, il piu' vicino per primo; e la catena non allarga un pavimento oltre mezzo ATR",
      len(_g1) == 1 and len(_g1[0]["tocchi"]) == 2 and _g1[0]["alto"] == 90.8 and _g1[0]["fondo"] == 90
      and abs(_g1[0]["stop"] - 88.0) < 1e-9 and len(_g2) == 2 and _g2[0]["alto"] == 91.2 and _g2[1]["alto"] == 90
      and [(z["alto"], z["fondo"]) for z in _g3] == [(92, 91.4), (90.8, 90.8)],
      str((_g1, _g2, [(z["alto"], z["fondo"]) for z in _g3]))[:400])

# --- i vuoti di prezzo: a parte, e solo quelli mai richiusi; la parte ancora libera ---
_vu487 = ROT.pavimenti(_serie487([100] * 10 + [110] * 10 + [108] * 5), 120.0, 2.0)
_vu487b = ROT.pavimenti(_serie487([100] * 10 + [110] * 10 + [105] * 5), 120.0, 2.0)
check("v487 un vuoto di prezzo mai richiuso si scrive a parte con la sola parte mai scambiata (dal massimo del giorno "
      "prima al minimo toccato da allora); richiuso, sparisce; un vuoto non diventa mai un pavimento",
      len(_vu487["vuoti"]) == 1 and _vu487["vuoti"][0]["fondo"] == 106 and _vu487["vuoti"][0]["alto"] == 108
      and not _vu487["minimi"] and not _vu487b["vuoti"], str((_vu487["vuoti"], _vu487b["vuoti"])))

# --- un'operazione societaria taglia la serie: prima di li' i prezzi non sono confrontabili (WDC, Sandisk) ---
_lw487 = [70] * 6 + _V487(60) + [70] * 13 + [100] * 6 + _V487(90) + [100] * 10
_aw487 = [0.75] * 30 + [1.0] * (len(_lw487) - 30)
_ws487 = _serie487(_lw487, a=_aw487)
_wp487 = ROT.pavimenti(_ws487, 110.0, 2.0)
_wp487s = ROT.pavimenti(_serie487(_lw487), 110.0, 2.0)
check("v487 un salto oltre il 3% del rapporto fra prezzo rettificato e grezzo (uno scorporo) taglia la serie: il minimo "
      "di prima sparisce e la data del taglio si dichiara; senza salto lo stesso minimo e' un pavimento",
      _wp487["taglio"] == _ws487[30]["t"] and [z["alto"] for z in _wp487["minimi"]] == [90]
      and _wp487s["taglio"] is None and 60 in [z["alto"] for z in _wp487s["minimi"]],
      str((_wp487["taglio"], [z["alto"] for z in _wp487["minimi"]], [z["alto"] for z in _wp487s["minimi"]])))

# --- la finestra e' di due anni, per DATA (v207) ---
_lunga487 = _serie487([100] * 6 + _V487(80) + [100] * 700 + _V487(90) + [100] * 10)
_lp487 = ROT.pavimenti(_lunga487, 110.0, 2.0)
check("v487 la finestra e' di due anni per DATA: un minimo di tre anni fa non e' un pavimento, e la serie parte "
      "esattamente due anni prima dell'ultima seduta",
      [z["alto"] for z in _lp487["minimi"]] == [90] and _lp487["da"] >= (_d487.fromisoformat(_lunga487[-1]["t"])
          .replace(year=_d487.fromisoformat(_lunga487[-1]["t"]).year - 2)).isoformat()
      and _lp487["minimo_serie"]["minimo"] == 90, str(([z["alto"] for z in _lp487["minimi"]], _lp487["da"])))

# --- la seduta in corso si toglie: il suo minimo puo' ancora scendere (v471) ---
_sc487 = _serie487([100] * 10 + [95, 94, 93, 92, 91, 90, 91, 92, 93, 94, 95])
_g487 = _d487.fromisoformat(_sc487[-1]["t"])
_in487 = ROT.pavimenti(_sc487, 110.0, 2.0, adesso=_dt487(_g487.year, _g487.month, _g487.day, 11, 0, tzinfo=brief.NEW_YORK))
_fu487 = ROT.pavimenti(_sc487, 110.0, 2.0, adesso=_dt487(_g487.year, _g487.month, _g487.day, 17, 0, tzinfo=brief.NEW_YORK))
check("v487 durante la seduta l'ultima barra e' in formazione e non conferma un minimo; dopo la campana si",
      not _in487["minimi"] and [z["alto"] for z in _fu487["minimi"]] == [90])

# --- i tre piu' vicini, e in coda il piu' toccato se sta piu' in basso e ha piu' tocchi di tutti (il triplo minimo di OKLO) ---
def _coda487(triplo, singolo=None):
    s = [105] * 6
    for f in (99, 97, 95):
        s += _V487(f) + [105] * 6
    for f in triplo:
        s += _V487(f) + [105] * 6
    if singolo is not None:
        s += _V487(singolo) + [105] * 6
    return ROT.pavimenti(_serie487(s), 110.0, 2.0)["minimi"]
_pm487 = _coda487((91.4, 91.7, 92.0))            # subito sotto: 95 - 92 = 3, cioe' 1,5 ATR
_pm487b = _coda487((), singolo=92.0)             # un solo tocco: non e' piu' forte dei mostrati
_pm487c = _coda487((70.0, 70.3, 70.6))           # la base lontana: 95 - 70,6 = 24,4, cioe' 12 ATR (MU a 118, -87%)
check("v487-v488 si mostrano i tre pavimenti piu' vicini e, in coda, quello con PIU' TOCCHI se sta SUBITO SOTTO "
      "(entro 2 ATR dall'ultimo mostrato); a pari tocchi niente; la base lontana di due anni fa non rientra",
      [z["alto"] for z in _pm487] == [99, 97, 95, 92.0] and _pm487[-1].get("piu_toccato") and len(_pm487[-1]["tocchi"]) == 3
      and [z["alto"] for z in _pm487b] == [99, 97, 95] and [z["alto"] for z in _pm487c] == [99, 97, 95],
      str(([z["alto"] for z in _pm487], [z["alto"] for z in _pm487b], [z["alto"] for z in _pm487c])))

# --- la resa: tre esiti distinti (v389) e i vuoti dichiarati come convenzione ---
_r487 = "\n".join(ROT.righe_pavimenti(_pv487))
_rv487 = "\n".join(ROT.righe_pavimenti(_vu487))
check("v487 resa: pavimento con ordine, stop e perdita per 5.000 €; 'nessun pavimento' dice dove sta il minimo della "
      "serie; storico non letto NON e' 'nessun pavimento'; il vuoto e' una convenzione, non una misura",
      "1) 90,00 (" in _r487 and "ordine con limite 90,00" in _r487 and "stop 88,00" in _r487 and "111 € ogni 5.000 €" in _r487
      and "nessun pavimento sotto il prezzo nella finestra: il minimo della serie e' 100,00" in _rv487
      and "convenzione di lettura dei grafici, NON una misura" in _rv487
      and "storico NON letto" in ROT.righe_pavimenti(None)[0]
      and "nessun pavimento sotto il prezzo" not in ROT.righe_pavimenti(None)[0],
      _r487 + "\n" + _rv487)

# --- il piano: SUI PAVIMENTI, per distanza; chi non ha un pavimento e chi non ha lo storico si nominano (v406) ---
def _vp487(tk, atr_dist, giorni=None, pv="ok", ha=True):
    z = {"alto": 90.0, "fondo": 89.0, "tocchi": [{"data": "2026-03-01"}], "ordine": 90.0, "stop": 87.0, "pct": -5.0,
         "atr": atr_dist, "perdita_pct": -3.3, "perdita_eur": -167.0}
    p = None if pv is None else {"minimi": [] if pv == "vuoto" else [z], "vuoti": []}
    return {"tk": tk, "px": 95.0, "gruppo": "DIVERSIFICA", "corr": 0.1, "conseguenze": {"dvol": -0.8},
            "trimestrale": {"data": "2026-10-25", "giorni": giorni} if giorni is not None else None,
            "pavimenti": p, "ha_pavimenti": ha}
_rpp487 = "\n".join(ROT.righe_piano_pavimenti([_vp487("LONT", -2.0, 30), _vp487("VICI", -0.5, 5), _vp487("SENZ", -1.0, pv="vuoto"),
                                                _vp487("NOLE", -1.0, pv=None), _vp487("CAND", -0.1, ha=False)]))
check("v487 piano: il gruppo SUI PAVIMENTI ordina per distanza in ATR, avvisa sui conti vicini, nomina chi non ha un "
      "pavimento e chi non ha lo storico, e lascia fuori i candidati di settore (la decisione riguarda la watchlist)",
      "■ SUI PAVIMENTI" in _rpp487 and _rpp487.find("    VICI") < _rpp487.find("    LONT")
      and "ordine con limite 90,00" in _rpp487 and "stop 87,00: 167 € ogni 5.000 €" in _rpp487
      and "si decide prima se tenerlo aperto" in _rpp487.split("    VICI")[1].split("\n")[0]
      and "si decide prima" not in _rpp487.split("    LONT")[1].split("\n")[0]
      and "nei 2 anni (nessun minimo di oscillazione sotto): SENZ" in _rpp487
      and "storico NON letto (non vuol dire 'nessun pavimento'): NOLE" in _rpp487 and "CAND" not in _rpp487, _rpp487)

# --- il collegamento, ESEGUITO e non letto nel testo (v399, v483) ---
_rac487 = _corpo_di(Path(__file__).with_name("rotazione.py").read_text(), "raccogli")
_ri487 = "\n".join(ROT.righe_ingresso(_w473("PAVX", pavimenti=_pv487), {"finestra": 45}))
_vo487 = ROT.voce_piano({**_vb, "pavimenti": _pv487}, "watchlist", _rx, _rl, _rq, 280000.0, 5600.0)
_vc487 = ROT.voce_piano(_vb, "candidato di settore", _rx, _rl, _rq, 280000.0, 5600.0)
_rpl487 = "\n".join(ROT.righe_piano({"piano": {**_pv474, "voci": _pv474["voci"] + [_vo487]}}))
check("v487 collegamento: la raccolta legge lo storico lungo dei sorvegliati e ne calcola i pavimenti; la riga del "
      "sorvegliato li stampa; la voce del piano li porta e il piano stampa il gruppo SUI PAVIMENTI",
      "ex.map(barre_lunghe" in _rac487 and "pavimenti(BL.get(" in _rac487
      and "pavimenti (LIBRO.md §1bis" in _ri487 and "1) 90,00" in _ri487
      and _vo487["ha_pavimenti"] and not _vc487["ha_pavimenti"] and "■ SUI PAVIMENTI" in _rpl487
      and "    XX " in _rpl487.split("■ SUI PAVIMENTI")[1], _rpl487[-700:])

# --- le soglie stanno nel libro e il codice le rilegge (v474: un numero, un posto) ---
_sez487 = _lib474[_lib474.find("**Ingressi sui minimi: i PAVIMENTI**"):_lib474.find("## 1ter")]
_m487 = {"anni": re.search(r"ultimi \*\*(\d+) anni\*\*", _sez487), "salto": re.search(r"oltre il\s+\*\*(\d+)%\*\*", _sez487),
         "lato": re.search(r"\*\*(\d+) sedute prima e (\d+) dopo\*\*", _sez487),
         "stop": re.search(r"meno \*\*(\d+) ATR\*\*", _sez487),
         "coda": re.search(r"entro \*\*(\d+) ATR\*\* dall'ultimo mostrato", _sez487)}
check("v487 le soglie dei pavimenti si rileggono da LIBRO.md §1bis e coincidono col codice: due anni, salto del 3%, "
      "5 sedute per lato, mezzo ATR, stop 1 ATR sotto il fondo",
      all(_m487.values()) and int(_m487["anni"].group(1)) == ROT.ANNI_PAVIMENTI
      and int(_m487["salto"].group(1)) / 100 == ROT.PAV_SALTO
      and int(_m487["lato"].group(1)) == int(_m487["lato"].group(2)) == ROT.PAV_LATO
      and "entro **mezzo ATR**" in _sez487 and ROT.PAV_LARGHEZZA_ATR == 0.5
      and int(_m487["stop"].group(1)) == ROT.PAV_STOP_ATR and int(_m487["coda"].group(1)) == ROT.PAV_CODA_ATR
      and "Non voglio entrare" in _sez487,
      str({k: (v.group(0) if v else None) for k, v in _m487.items()}))
_cl487 = AN.checklist() or ""
check("v487 il formato porta i pavimenti nella sezione 7 e nel registro delle richieste rese strutturali",
      "7d-bis. **i PAVIMENTI**" in _cl487 and "ingressi sui minimi: i pavimenti di ogni nome" in _cl487
      and "SUI PAVIMENTI" in _cl487)


# ================================================================ v489 — la conversazione del 15/10 resa strutturale
# Il CEO, testuale: «Rendi questa conversazione di oggi parte strutturale dell'analisi globale che ti chiedo». Quel
# giorno: tre ordini con limite inseriti (ORCL, OKLO, SMCI) e la domanda se alzarli per prendere lo storno; la media
# su SK hynix valutata sui pavimenti; i volumi a seduta aperta; i conti di SK hynix che il calendario non portava.
# Ogni stato si COSTRUISCE (v425, v429): la seduta aperta e' un orario fisso, i pavimenti una serie sintetica.
_ny489 = _dt474(2026, 10, 9, 11, 0, tzinfo=_NY474)            # seduta aperta da 90 minuti
_lib489 = ("## 1septies. ORDINI APERTI — x\n\n| Nome | Verso | Quantità | Limite | Inserito | Stato |\n"
           "|---|---|---|---|---|---|\n| AAA | acquisto | 100 | 105,00 | 2026-10-09 | attivo |\n"
           "| BBB | acquisto | 100 | 95,00 | 2026-10-09 | attivo |\n| CCC | acquisto | 100 | 100,00 | 2026-10-09 | attivo |\n"
           "| DDD | acquisto | 50 | 1.200,50 | 2026-10-08 | eseguito il 09/10 |\n## 2. ALTRO\n"
           "| EEE | acquisto | 1 | 1 | x | attivo |\n")
_or489 = NL.leggi_ordini(_lib489)
check("v489 gli ordini aperti si leggono solo dentro il loro titolo: quantità e limite con la virgola e il punto delle "
      "migliaia, lo stato decide se l'ordine è attivo; sezione assente = None, che non è 'nessun ordine'",
      [o["tk"] for o in _or489] == ["AAA", "BBB", "CCC", "DDD"] and _or489[3]["limite"] == 1200.5
      and [o["attivo"] for o in _or489] == [True, True, True, False] and _or489[0]["verso"] == "acquisto"
      and NL.leggi_ordini("## 1. POSIZIONI\n| AAA | acquisto | 1 | 1 | x | attivo |\n") is None, str(_or489))

# --- un pavimento a 100 e uno a 90 sotto il prezzo 110 (ATR 2): il limite sopra, sul e sotto il pavimento vicino ---
_lu489 = _serie487([120] * 6 + _V487(90) + [120] * 6 + _V487(100) + [120] * 15)
_pv489 = ROT.pavimenti(_lu489, 110.0, 2.0)
def _tec489(vp=-2.0, lo=104.0, quota="2026-10-09", px=110.0):
    return {"px": px, "atr": 2.0, "var_pct": vp, "seduta_quota": quota, "minimo_oggi": lo, "vol_oggi": 300_000,
            "quota_ora": "Oct 9, 2026, 11:00 AM EDT", "sma20": 112.0, "sma50": 115.0, "sma200": 118.0}
_b489 = {"AAA": _barre474(_sale, fine="2026-10-08"), "BBB": _barre474(_scende, fine="2026-10-08"),
         "CCC": _barre474(_sale[:150], fine="2026-10-08")}
_rl489 = ROT.rendimenti_per_data(_barre474([100 + i * 0.3 + (i % 7) for i in range(250)], fine="2026-10-08"))
_rq489 = ROT.rendimenti_per_data(_barre474([100 + i * 0.2 + (i % 5) for i in range(250)], fine="2026-10-08"))
_cal489 = {"attesi": [{"tk": "AAA", "data": "2026-10-16", "giorni": 7, "fonte": "calendario Nasdaq"},
                      {"tk": "BBB", "data": "2026-11-20", "giorni": 42,
                       "fonte": "dichiarata dall'emittente: 6-K, depositato il 2026-10-01"}]}
def _vo489(tec=None, ordini=None):
    t = {"AAA": _tec489(), "BBB": _tec489(lo=96.0), "CCC": _tec489()}
    t.update(tec or {})
    return NL.valuta_ordini(_or489 if ordini is None else ordini, _b489, t, {k: _lu489 for k in _b489}, _cal489, {},
                            _sem481(), _rl489, _rq489, 100000.0, 1.12, _ny489)
_o489 = _vo489()
_x489 = {x["tk"]: x for x in _o489["righe"]}
check("v489 STORNO o DISCESA dalla tendenza della tenuta: intatta o in correzione = STORNO, rotta = DISCESA, sotto 200 "
      "sedute NON MISURABILE — e la regola la mappa in un posto solo",
      _x489["AAA"]["natura"] == "STORNO" and _x489["BBB"]["natura"] == "DISCESA"
      and _x489["CCC"]["natura"] == "NON MISURABILE"
      and NL.NATURA == {"intatta": "STORNO", "in correzione": "STORNO", "rotta": "DISCESA"},
      str({k: (v.get("natura"), v.get("tendenza", {}).get("stato")) for k, v in _x489.items()}))
_ri489 = NL.valuta_ordini(_or489[:1], _b489, {"AAA": _tec489(vp=1.0)}, {"AAA": _lu489}, _cal489, {}, _sem481(),
                          _rl489, _rq489, 100000.0, 1.12, _ny489)["righe"][0]
check("v489 alzare il limite è COERENTE solo su uno STORNO con il titolo in calo nella seduta; su uno storno che sale è "
      "comprare la risalita; su una DISCESA non lo è mai",
      _x489["AAA"]["alzare"] == "coerente" and _ri489["alzare"] == "risalita" and _x489["BBB"]["alzare"] == "discesa"
      and _x489["CCC"]["alzare"] == "non misurabile", str((_x489["AAA"]["alzare"], _ri489["alzare"], _x489["BBB"]["alzare"])))
check("v489 lo stop è quello del pavimento SOTTO IL LIMITE, non del pavimento più vicino al prezzo: limite sopra il "
      "pavimento a 100 → stop 98; sul pavimento → stop 98; sotto (95) → il pavimento a 90, stop 88",
      (_x489["AAA"]["posizione"], _x489["CCC"]["posizione"], _x489["BBB"]["posizione"]) == ("sopra", "sul", "sotto")
      and abs(_x489["AAA"]["stop"] - 98) < 1e-9 and abs(_x489["CCC"]["stop"] - 98) < 1e-9
      and abs(_x489["BBB"]["stop"] - 88) < 1e-9 and _x489["BBB"]["pavimento_vicino"]["alto"] == 100,
      str({k: (v.get("posizione"), v.get("stop")) for k, v in _x489.items()}))
check("v489 il rischio fino allo stop si conta dal limite, e col limite alzato al prezzo di adesso è maggiore: alzare il "
      "limite allunga la distanza dallo stop (AAA 700 $ → 1.200 $, BBB 700 $ → 2.200 $)",
      abs(_x489["AAA"]["rischio"] - 700) < 1e-6 and abs(_x489["AAA"]["rischio_mercato"] - 1200) < 1e-6
      and abs(_x489["BBB"]["rischio"] - 700) < 1e-6 and abs(_x489["BBB"]["rischio_mercato"] - 2200) < 1e-6
      and abs(_x489["CCC"]["rischio"] - 200) < 1e-6
      and all(x["rischio_mercato"] > x["rischio"] for x in _x489.values()),
      str({k: (v.get("rischio"), v.get("rischio_mercato")) for k, v in _x489.items()}))
_tc489 = [NL.valuta_ordini(_or489[:1], _b489, {"AAA": t}, {"AAA": _lu489}, _cal489, {}, _sem481(), _rl489, _rq489,
                           100000.0, 1.12, _ny489)["righe"][0]["toccato_oggi"]
          for t in (_tec489(lo=104.0), _tec489(lo=104.0, quota="2026-10-08"), _tec489(lo=106.0))]
check("v489 «il minimo di oggi ha toccato il limite» solo se la quota è DI OGGI e il minimo sta sotto il limite: una "
      "quota di ieri non dice niente sulla seduta di oggi",
      _tc489 == [True, False, False], str(_tc489))
check("v489 i conti entro 14 giorni accendono l'avviso dell'ordine attivo durante i conti; la fonte della data viaggia "
      "con la voce; il volume della seduta col tempo trascorso; gli ordini non attivi si nominano",
      _x489["AAA"]["conti_vicini"] and not _x489["BBB"]["conti_vicini"]
      and abs(_x489["AAA"]["volume"]["pct_media"] - 30) < 1e-9 and _x489["AAA"]["volume"]["minuti"] == 90
      and [o["tk"] for o in _o489["inattivi"]] == ["DDD"], str((_x489["AAA"]["volume"], _o489["inattivi"])))
_sp489 = {"AAA": 100 * 105.0, "BBB": 100 * 95.0, "CCC": 100 * 100.0}
_rt489 = {k: ROT.rendimenti_per_data(_b489[k]) for k in _sp489}
_cm489 = set.intersection(*[set(v) for v in _rt489.values()])
_atteso489 = ROT.conseguenze({d: sum(_sp489[k] * _rt489[k][d] for k in _sp489) / sum(_sp489.values()) for d in _cm489},
                             _rl489, _rq489, 100000.0, sum(_sp489.values()))
check("v489 l'INSIEME degli ordini: la spesa ai limiti, il rischio totale fino agli stop, e le conseguenze sul libro "
      "della serie COMBINATA — le stesse di rotazione.conseguenze (una derivazione, v161)",
      abs(_o489["insieme"]["spesa"] - 30000) < 1e-6 and abs(_o489["insieme"]["rischio"] - 1600) < 1e-6
      and _o489["insieme"]["rischio_completo"] and _o489["insieme"]["conseguenze"] == _atteso489
      and _atteso489 is not None, str(_o489["insieme"]))
_err489 = NL.valuta_ordini([{**_or489[0], "verso": "vendita", "verso_testo": "vendita"}, {**_or489[1], "tk": "ZZZ"}],
                           _b489, {"AAA": _tec489()}, {}, _cal489, {}, _sem481(), _rl489, _rq489, 100000.0, 1.12, _ny489)
check("v489 un ordine di vendita, o senza prezzo, si dichiara non valutabile invece di sparire; senza sezione il blocco "
      "dice None",
      [("errore" in x) for x in _err489["righe"]] == [True, True] and _err489["insieme"] is None
      and NL.valuta_ordini(None, {}, {}, {}, {}, {}, None, {}, {}, 1.0, 1.0, _ny489) is None, str(_err489["righe"])[:300])

# --- la resa degli ordini: tre esiti, la regola, l'avviso del tocco solo dove serve, l'insieme ---
_ro489 = "\n".join(NL.righe_ordini(_o489))
# il blocco di un ordine va dalla sua testa alla testa successiva (due spazi e un ticker): le righe interne
#   hanno sei spazi, quindi la divisione su "a capo + due spazi" le spezzava tutte (la prima stesura)
_blk489 = {tk: re.split(r"\n  (?=[A-Z])", _ro489.split(f"\n  {tk} acquisto")[1])[0] for tk in ("AAA", "BBB", "CCC")}
check("v489 resa degli ordini: STORNO coerente, DISCESA col primo segnale (la media più vicina sopra il prezzo), il "
      "limite sopra/sul/sotto il pavimento, l'avviso del tocco e dei conti solo dove valgono, il volume, l'insieme",
      "STORNO" in _blk489["AAA"] and "alzare il limite è COERENTE" in _blk489["AAA"]
      and "DISCESA" in _blk489["BBB"] and "NON è coerente" in _blk489["BBB"] and "media 20 (112,00)" in _blk489["BBB"]
      and "SOPRA il pavimento più vicino" in _blk489["AAA"] and "SUL pavimento più vicino" in _blk489["CCC"]
      and "SOTTO il pavimento più vicino" in _blk489["BBB"] and "il minimo di oggi" in _blk489["AAA"]
      and "il minimo di oggi" not in _blk489["BBB"] and "conti entro 14 giorni" in _blk489["AAA"]
      and "conti entro 14 giorni" not in _blk489["BBB"] and "dichiarata dall'emittente" in _blk489["BBB"]
      and "seduta IN CORSO: 300 mila azioni finora = 30% di una seduta media, in 90 minuti su 390" in _blk489["AAA"]
      and "INSIEME, se eseguiti tutti ai limiti: 30.000 $ su 3 nomi" in _ro489 and "fino agli stop 1.600 $" in _ro489
      and "DDD (eseguito il 09/10)" in _ro489 and "lo stop resta quello del pavimento sotto il limite" in _ro489,
      _ro489[:1500])
check("v489 resa: senza sezione il blocco lo dichiara; senza ordini attivi lo dice; un ordine non valutabile resta scritto",
      "NON trovata" in NL.righe_ordini(None)[0]
      and "nessuno attivo" in NL.righe_ordini({"righe": [], "insieme": None, "inattivi": []})[0]
      and "non valutabile" in "\n".join(NL.righe_ordini(_err489)))

# --- la media sui pavimenti: solo sotto il carico, con la funzione della media, e il peso al valore di oggi ---
_md489 = {"fx": 1.12, "valore": 100000.0, "trim": {}, "rlibro": {}, "rqqq": {}, "rend": {}}
_mp489 = NL.media_pavimenti(_pv489, 105.0, 10, 0.05, _md489, "PPP", 110.0)
_mpn489 = NL.media_pavimenti(_pv489, 95.0, 10, 0.05, _md489, "PPP", 110.0)
_m100 = NL.media_aritmetica(100.0, 105.0, 10, 0.05, 100000.0, 1.12)
check("v489 la media sui pavimenti prende SOLO i pavimenti sotto il carico, con media_aritmetica (la stessa funzione "
      "della media al prezzo di adesso, v161), e il peso dopo al valore di OGGI (posizione e libro alla stessa data)",
      [x["pavimento"]["alto"] for x in _mp489] == [100, 90] and [x["pavimento"]["alto"] for x in _mpn489] == [90]
      and NL.media_pavimenti(_pv489, 85.0, 10, 0.05, _md489, "PPP", 110.0) == []
      and _mp489[0]["media"]["carico_dopo"] == _m100["carico_dopo"] and _mp489[0]["media"]["azioni"] == _m100["azioni"]
      and abs(_mp489[0]["media"]["peso_dopo"] - (10 * 110.0 + _m100["spesa"]) / (100000.0 + _m100["spesa"])) < 1e-12,
      str(_mp489)[:400])
_tn489 = NL.tenuta_posizioni(["PPP", "RRR"], {"PPP": _b489["AAA"], "RRR": _b489["AAA"]}, {"PPP": _riga481(), "RRR": _riga481()},
                             _sem481(), {"PPP": 110.0, "RRR": 110.0}, {"PPP": 105.0, "RRR": 50.0}, {"PPP": 10, "RRR": 10},
                             {"PPP": 0.05, "RRR": 0.05}, _ny489, [], _md489, {"PPP": _pv489, "RRR": _pv489})
_rt489r = "\n".join(NL.righe_tenuta(_tn489))
_tn489_no = NL.tenuta_posizioni(["PPP"], {"PPP": _b489["AAA"]}, {"PPP": _riga481()}, _sem481(), {"PPP": 110.0},
                                {"PPP": 105.0}, {"PPP": 10}, {"PPP": 0.05}, _ny489, [], _md489)
check("v489 resa della tenuta: ogni posizione porta i pavimenti; sotto il carico la media sui pavimenti con lo stop; chi "
      "ha tutti i pavimenti sopra il carico si nomina una volta in fondo (è un incremento, non una media); senza "
      "pavimenti calcolati la resa tace",
      "pavimenti: 100,00 (-9,1%, 1 tocco) stop 98,00 · 90,00 (-18,2%, 1 tocco) stop 88,00" in _rt489r
      and "media sui pavimenti (sotto il carico 105,00" in _rt489r and "a 100,00 →" in _rt489r and "a 90,00 →" in _rt489r
      and "nessun pavimento sotto il carico per RRR" in _rt489r
      and "pavimenti:" not in "\n".join(NL.righe_tenuta(_tn489_no)), _rt489r[-1800:])

# --- il volume della seduta in corso: solo a seduta aperta, con la quota di oggi, e la media senza la barra in formazione ---
_vb489 = _barre474(_sale, fine="2026-10-08")
_vs489 = lambda t, adesso, b=_vb489: ROT.volume_seduta(t, b, adesso)
_ts489 = {"seduta_quota": "2026-10-09", "vol_oggi": 300_000}
_inc489 = _barre474(_sale, fine="2026-10-09", vol=[1_000_000] * 249 + [5_000_000])
check("v489 il volume della seduta in corso: a seduta aperta, con la quota di oggi, sulle 20 sedute CONCLUSE (la barra in "
      "formazione esce dalla media); prima dell'apertura, dopo la campana, nel fine settimana o con la quota di un altro "
      "giorno è None",
      abs(_vs489(_ts489, _ny489)["pct_media"] - 30) < 1e-9 and _vs489(_ts489, _ny489)["minuti"] == 90
      and abs(_vs489(_ts489, _ny489, _inc489)["pct_media"] - 30) < 1e-9
      and _vs489(_ts489, _dt474(2026, 10, 9, 9, 0, tzinfo=_NY474)) is None
      and _vs489(_ts489, _dt474(2026, 10, 9, 16, 5, tzinfo=_NY474)) is None
      and _vs489({**_ts489, "seduta_quota": "2026-10-10"}, _dt474(2026, 10, 10, 11, 0, tzinfo=_NY474)) is None
      and _vs489({**_ts489, "seduta_quota": "2026-10-08"}, _ny489) is None, str(_vs489(_ts489, _ny489)))
check("v489 la riga dei volumi aggiunge la seduta in corso solo quando c'è",
      "seduta IN CORSO: 300 mila azioni finora = 30%" in ROT.riga_volumi({"vol_seduta_corso": _vs489(_ts489, _ny489)})
      and "IN CORSO" not in ROT.riga_volumi({}))

# --- le date dei conti dichiarate dall'emittente ---
from datetime import date as _gd489, timedelta as _tdd489
_cd489 = ROT.brief.leggi_conti_dichiarati("## 1octies. CONTI DICHIARATI DALL'EMITTENTE\n| Nome | Conti | Fonte | Depositato |\n"
                                          "|---|---|---|---|\n| SKHY | 2026-10-28 | 6-K | 2026-10-14 |\n| XXX | n.d. | x | y |\n"
                                          "## 2. ALTRO\n| ZZZ | 2026-10-29 | a | b |\n")
_cc489 = ROT.brief.con_conti_dichiarati(
    [{"tk": "SKHY", "data": "2026-10-27", "giorni": 12}, {"tk": "MU", "data": "2026-10-20", "giorni": 5}],
    {"SKHY", "MU", "OLD", "FAR"}, _gd489(2026, 10, 15), 45,
    [{"tk": "SKHY", "data": "2026-10-28", "fonte": "6-K", "depositato": "2026-10-14"},
     {"tk": "OLD", "data": "2026-10-10", "fonte": "x", "depositato": "y"},
     {"tk": "FAR", "data": "2026-12-31", "fonte": "x", "depositato": "y"},
     {"tk": "NON", "data": "2026-10-20", "fonte": "x", "depositato": "y"}])
check("v489 le date dichiarate dall'emittente: si leggono solo dentro il loro titolo e solo con una data vera; vince "
      "l'emittente e la data di Nasdaq resta accanto; una data passata, oltre la finestra o di un nome non cercato non "
      "entra; ogni voce porta la sua fonte e l'elenco resta in ordine di data",
      _cd489 == [{"tk": "SKHY", "data": "2026-10-28", "fonte": "6-K", "depositato": "2026-10-14"}]
      and ROT.brief.leggi_conti_dichiarati("## 1. POSIZIONI\n") is None
      and [(c["tk"], c["data"]) for c in _cc489] == [("MU", "2026-10-20"), ("SKHY", "2026-10-28")]
      and _cc489[1]["nasdaq"] == "2026-10-27" and _cc489[1]["giorni"] == 13 and "dichiarata dall'emittente" in _cc489[1]["fonte"]
      and _cc489[0]["fonte"] == "calendario Nasdaq", str(_cc489))
_or_tg, _or_lc = ROT.brief._trim_giorno, ROT.brief.leggi_conti_dichiarati
_dd489 = (_dt474.now(_tz.utc).date() + _tdd489(days=3)).isoformat()
try:
    ROT.brief._trim_giorno = lambda g: (g, [], None)
    ROT.brief.leggi_conti_dichiarati = lambda testo=None: [{"tk": "SKHY", "data": _dd489, "fonte": "6-K", "depositato": "x"}]
    _ct489 = ROT.brief.calendario_trimestrali(["SKHY"], giorni=10)
finally:
    ROT.brief._trim_giorno, ROT.brief.leggi_conti_dichiarati = _or_tg, _or_lc
check("v489 collegamento: il calendario delle trimestrali aggiunge davvero le date dichiarate dall'emittente — provato "
      "eseguendolo con Nasdaq muto, non leggendo il sorgente",
      [(a["tk"], a["data"]) for a in _ct489["attesi"]] == [("SKHY", _dd489)], str(_ct489))
check("v489 la trimestrale dice da quale fonte viene, e se Nasdaq dice un'altra data la scrive accanto; la scadenza del "
      "libro marca la data dell'emittente",
      "(13 g, dichiarata dall'emittente: 6-K" in ROT.riga_trimestrale({"trimestrale": _cc489[1]})
      and "il calendario Nasdaq dice 2026-10-27" in ROT.riga_trimestrale({"trimestrale": _cc489[1]})
      and "(5 g, calendario Nasdaq)" in ROT.riga_trimestrale({"trimestrale": {"data": "2026-10-20", "giorni": 5}})
      and "SKHY 2026-10-28 (13 g, dichiarata dall'emittente)" in "\n".join(NL.righe_attesa(NL.costo_attesa(
          100000.0, 0.4, 0.03, 0.04, {"attesi": _cc489, "finestra": 45}, ["SKHY", "MU"])))
      and "MU 2026-10-20 (5 g)" in "\n".join(NL.righe_attesa(NL.costo_attesa(
          100000.0, 0.4, 0.03, 0.04, {"attesi": _cc489, "finestra": 45}, ["SKHY", "MU"]))))

# --- collegamenti: la quota porta la seduta, calcola e sintesi portano ordini e pavimenti ---
_oq489 = ROT.brief.quota
try:
    ROT.brief.quota = lambda tk: {"p": 110.0, "cp": -1.0, "v": 123456, "l": 104.5, "h": 112.0, "td": "2026-10-09",
                                  "u": "Oct 9, 2026, 11:00 AM EDT", "ms": "open"}
    _tq489 = ROT.brief.tecnica("AAA", d=_barre474(_sale, fine="2026-10-08"))
finally:
    ROT.brief.quota = _oq489
check("v489 la tecnica porta dalla quota il volume, il minimo e il massimo della seduta e l'ora dell'aggiornamento",
      tuple(_tq489.get(k) for k in ("vol_oggi", "minimo_oggi", "massimo_oggi", "quota_ora"))
      == (123456, 104.5, 112.0, "Oct 9, 2026, 11:00 AM EDT"), str(_tq489)[:300])
check("v489 collegamento in calcola: gli ordini si leggono dal libro, i loro nomi si scaricano, i pavimenti delle posizioni "
      "vanno alla tenuta e gli ordini si valutano; la scheda dei sorvegliati porta il volume della seduta",
      "ordini = leggi_ordini()" in _calc474 and "set(in_ordine)" in _calc474 and "aperte + in_ordine" in _calc474
      # v492 — riagganciato all'invariante: la chiamata passa i pavimenti dopo decisioni e media (prima pretendeva la
      #   parentesi chiusa subito dopo, e i due argomenti nuovi della lettura a 5 anni lo hanno fatto andare rosso)
      and "decisioni, media, pav" in _calc474 and 'out["ordini"] = valuta_ordini(ordini, B, TEC, BL,' in _calc474
      and '"vol_seduta_corso": volume_seduta(t, barre)' in _corpo_di(Path(ROT.__file__).read_text(), "scheda"))
_o489s = {**_o483, "ordini": _o489}
check("v489 collegamento: la sintesi STAMPA il blocco degli ordini — provato eseguendola",
      "ORDINI APERTI (LIBRO.md §1septies" in NL.sintesi(_o489s) and "AAA acquisto 100 a 105,00" in NL.sintesi(_o489s))
_ma489 = ROT.piano_ingresso({"px": 100.0, "atr": 2.0, "sma20": 104.0, "sma50": 110.0, "sma200": 150.0, "pend50": -1.0})
check("v489 il primo segnale del piano d'ingresso e quello degli ordini vengono dalla stessa funzione: la media più vicina "
      "sopra il prezzo",
      ROT.prima_media_sopra({"px": 100.0, "sma20": 104.0, "sma50": 110.0, "sma200": 150.0}) == ("media 20", 104.0)
      and ROT.prima_media_sopra({"px": 200.0, "sma20": 104.0}) is None
      and (_ma489["primo_segnale"] is None or _ma489["primo_segnale"][0] == "media 20"), str(_ma489.get("primo_segnale")))

# --- il libro e il formato: le sezioni ci sono, si leggono, e le regole coincidono col codice ---
_ol489 = NL.leggi_ordini(_lib474)
_cl489 = ROT.brief.leggi_conti_dichiarati(_lib474)
check("v489 il libro vero si legge: la sezione degli ordini c'è e ogni riga ha quantità, limite e verso leggibili (lo stato "
      "degli ordini non si fissa qui: lo decide il CEO); i conti dichiarati hanno una data e una fonte",
      _ol489 is not None and all(o["qta"] and o["limite"] and o["verso"] for o in _ol489)
      and _cl489 is not None and all(re.match(r"\d{4}-\d{2}-\d{2}$", c["data"]) and len(c["fonte"]) > 3 for c in _cl489),
      str((_ol489, _cl489))[:400])
_sb489 = _lib474[_lib474.find("**Storno o discesa"):_lib474.find("## 1quinquies")]
check("v489 la regola storno/discesa sta in LIBRO.md §1bis con le definizioni del codice: STORNO = tendenza intatta o in "
      "correzione, DISCESA = tendenza rotta, lo stop resta quello del pavimento sotto il limite",
      "**STORNO**" in _sb489 and "intatta o in correzione" in _sb489 and "**DISCESA**" in _sb489
      and "tendenza rotta" in _sb489 and "lo stop resta quello del pavimento sotto il limite" in _sb489
      and "se nella seduta il" in _sb489, _sb489[:300])
_cl489f = AN.checklist() or ""
check("v489 il formato porta gli ordini aperti, la media sui pavimenti, i volumi della seduta, l'ordine d'interesse coi suoi "
      "criteri, e il registro delle richieste del 15/10",
      "il blocco **ORDINI APERTI**" in _cl489f and "**media sui pavimenti**" in _cl489f and "seduta in corso" in _cl489f
      and "7d-ter. **gli ingressi in ordine d'interesse**" in _cl489f and "non un punteggio del sistema" in _cl489f
      and "gli ordini aperti seguiti a ogni analisi" in _cl489f and "le date dei conti dichiarate" in _cl489f)


# ================================================================ v490 — gli ordini giornalieri e la liquidità bloccata
# Il CEO, 15/10/2026 sera: «Ordini giornalieri per ora» e «Liquidità è 56.600 euro senza contare la liquidità bloccata
# per gli ordini non ancora eseguiti». Un ordine giornaliero, dopo la campana della sua seduta, non è più attivo: è
# ESEGUITO o SCADUTO, e lo sa il conto. Senza questo l'analisi del mattino dopo lo mostrava ancora attivo e ne contava la
# spesa come liquidità bloccata (un registro che invecchia da solo, v410). Ogni stato si COSTRUISCE (v425, v429): orari
# fissi, barre sintetiche.
_lib490 = ("## 1septies. ORDINI APERTI — x\n\n| Nome | Verso | Quantità | Limite | Inserito | Stato | Validità |\n"
           "|---|---|---|---|---|---|---|\n| AAA | acquisto | 100 | 105,00 | 2026-10-09 | attivo | giornaliero |\n"
           "| BBB | acquisto | 100 | 95,00 | 2026-10-09 | attivo | Fino a revoca |\n"
           "| CCC | acquisto | 100 | 100,00 | 2026-10-09 | attivo |\n"
           "| DDD | acquisto | 10 | 50,00 | 2026-10-09 | attivo | GTD 20/10 |\n"
           "| EEE | acquisto | 10 | 50,00 | ieri | attivo | giornaliera |\n")
_or490 = NL.leggi_ordini(_lib490)
check("v490 la validità si legge dall'ultima colonna senza spostare le prime sei: giornaliero, fino a revoca, non "
      "dichiarata (None), un testo non riconosciuto resta com'è scritto",
      [o["validita"] for o in _or490] == ["giornaliero", "fino a revoca", None, "gtd 20/10", "giornaliero"]
      and [o["tk"] for o in _or490] == ["AAA", "BBB", "CCC", "DDD", "EEE"] and _or490[1]["limite"] == 95.0
      and all(o["attivo"] for o in _or490) and _or490[3]["validita_testo"] == "GTD 20/10"
      and _or490[0]["inserito"] == "2026-10-09", str(_or490))

_bA490 = _barre474(_sale, fine="2026-10-09")              # la barra del 09/10 ha il minimo a ~222: non tocca 105
_bA490t = [dict(x) for x in _bA490]
_bA490t[-1]["l"] = 104.0                                   # qui la seduta del 09/10 ha toccato il limite (105)
def _vo490(adesso, barre_a=None, cassa=100000.0):
    b = {"AAA": barre_a or _bA490, "BBB": _b489["BBB"], "CCC": _b489["CCC"]}
    t = {"AAA": _tec489(), "BBB": _tec489(lo=96.0), "CCC": _tec489()}
    return NL.valuta_ordini(_or490, b, t, {k: _lu489 for k in b}, _cal489, {}, _sem481(), _rl489, _rq489,
                            100000.0, 1.12, adesso, cassa_eur=cassa)
_in490 = _vo490(_ny489)                                                    # 09/10 alle 11:00: seduta aperta
_ch490 = _vo490(_dt474(2026, 10, 9, 16, 30, tzinfo=_NY474))               # lo stesso giorno, dopo la campana
_lu490 = _vo490(_dt474(2026, 10, 12, 10, 0, tzinfo=_NY474), _bA490t)       # il lunedì dopo
_qu490 = _vo490(_dt474(2026, 10, 9, 16, 30, tzinfo=_NY474), _b489["AAA"])  # senza la barra del 09/10: decide la quota
def _tk490(o):
    return [x["tk"] for x in o["righe"]]
check("v490 un ordine giornaliero è attivo durante la sua seduta e non più dopo la campana — lo stesso giorno e i giorni "
      "dopo; fino a revoca e senza validità dichiarata restano attivi; una data illeggibile non si decide",
      _tk490(_in490) == ["AAA", "BBB", "CCC", "DDD", "EEE"] and _tk490(_ch490) == ["BBB", "CCC", "DDD", "EEE"]
      and _tk490(_lu490) == ["BBB", "CCC", "DDD", "EEE"] and _in490["chiusi"] == []
      and [o["tk"] for o in _ch490["chiusi"]] == ["AAA"] and [o["tk"] for o in _lu490["chiusi"]] == ["AAA"],
      str((_tk490(_in490), _tk490(_ch490), _tk490(_lu490), [o["tk"] for o in _ch490.get("chiusi", [])])))
_c490 = [((o.get("chiusi") or [{}])[0]).get("toccato") for o in (_ch490, _lu490, _qu490)]
check("v490 eseguito o scaduto dal minimo di QUELLA seduta: sopra il limite = scaduto, al limite o sotto = può essere "
      "eseguito; la barra della seduta vince sulla quota, e senza barra decide la quota della stessa seduta",
      _c490 == [False, True, True] and abs(_ch490["chiusi"][0]["minimo_seduta"] - 224.5 * 0.99) < 1e-9
      and _qu490["chiusi"][0]["minimo_seduta"] == 104.0, str(_c490))
_imp490 = 100 * 105 + 100 * 95 + 100 * 100 + 10 * 50 + 10 * 50          # gli acquisti attivi, anche i non valutabili
check("v490 la liquidità bloccata è la spesa ai limiti degli ordini ATTIVI (anche di quelli non valutabili: il broker la "
      "blocca lo stesso), in euro al cambio; la libera è la liquidità di LIBRO.md §1 meno la bloccata; dopo la campana "
      "l'ordine giornaliero non blocca più niente",
      abs(_in490["insieme"]["impegnata_usd"] - _imp490) < 1e-6
      and abs(_in490["insieme"]["impegnata_eur"] - _imp490 / 1.12) < 1e-6
      and abs(_in490["insieme"]["libera_eur"] - (100000.0 - _imp490 / 1.12)) < 1e-6
      and abs(_ch490["insieme"]["impegnata_usd"] - (_imp490 - 100 * 105)) < 1e-6,
      str((_in490["insieme"].get("impegnata_usd"), _ch490["insieme"].get("impegnata_usd"))))
_r490 = "\n".join(NL.righe_ordini(_in490))
check("v490 resa: la testa porta la validità — la scadenza giornaliera in ora italiana, fino a revoca, non dichiarata o "
      "non riconosciuta, la data illeggibile; l'INSIEME porta la liquidità bloccata e la libera",
      "giornaliero: scade alla campana delle 22:00 italiane del 09/10, se non eseguito" in _r490
      and "BBB acquisto 100 a 95,00 (inserito 2026-10-09) · fino a revoca" in _r490
      and "CCC acquisto 100 a 100,00 (inserito 2026-10-09) · validità non dichiarata" in _r490
      and "validità «GTD 20/10» non riconosciuta" in _r490 and "la data d'inserimento non si legge" in _r490
      and f"liquidità bloccata dagli ordini attivi ≈ {NL._it(_imp490 / 1.12, 0)} €" in _r490
      and f"libera ≈ {NL._it(100000.0 - _imp490 / 1.12, 0)} € sui 100.000 € di LIBRO.md §1" in _r490, _r490[:2500])
_rc490 = "\n".join(NL.righe_ordini(_lu490))
_rx490 = "\n".join(NL.righe_ordini(_ch490))
check("v490 resa degli ordini chiusi: fuori dagli attivi, nominati con la loro seduta e col minimo accanto al limite — "
      "ESEGUITO possibile o SCADUTO senza esecuzione",
      "ordini GIORNALIERI di sedute già chiuse: ESEGUITI o SCADUTI" in _rc490
      and ("AAA acquisto 100 a 105,00 (seduta del 2026-10-09) · il minimo della seduta (104,00) ha raggiunto il limite: "
           "può essere stato ESEGUITO") in _rc490
      and f"({NL._it(224.5 * 0.99)}) non ha raggiunto il limite: SCADUTO senza esecuzione" in _rx490
      and "\n  AAA acquisto" not in _rc490 and "\n  AAA acquisto" not in _rx490, _rc490[-1500:])
_nc490 = "\n".join(NL.righe_ordini(_vo490(_ny489, cassa=None)))
check("v490 senza la liquidità di LIBRO.md la libera non si calcola, e lo si dice invece di stamparne una",
      "la liquidità di LIBRO.md §1 non si legge: la libera non si calcola" in _nc490 and "libera ≈" not in _nc490,
      _nc490[-700:])
_dst490 = [NL.chiusura_seduta(g) for g in ("2026-10-15", "2026-10-27", "2026-11-03", "2026-03-10")]
check("v490 la campana in ora italiana viene dal fuso, mai da uno scarto a mano: 22:00 di solito, 21:00 nelle settimane "
      "in cui le due ore legali non coincidono (fine ottobre, marzo); un giorno illeggibile non ha campana",
      [x.hour if x else None for x in _dst490] == [22, 21, 22, 21] and NL.chiusura_seduta("ieri") is None, str(_dst490))
check("v490 la seduta di un giorno finisce alla campana delle 16:00 di New York (la regola di brief.dopo_la_campana, "
      "v485): alle 15:59 no, alle 16:00 sì, il giorno dopo sì, il giorno prima no",
      [NL.seduta_finita("2026-10-09", _dt474(2026, 10, 9, h, m, tzinfo=_NY474)) for h, m in ((15, 59), (16, 0))]
      == [False, True] and NL.seduta_finita("2026-10-09", _dt474(2026, 10, 10, 9, 0, tzinfo=_NY474)) is True
      and NL.seduta_finita("2026-10-09", _dt474(2026, 10, 8, 18, 0, tzinfo=_NY474)) is False)
check("v490 collegamento in calcola: la liquidità di LIBRO.md arriva agli ordini aperti",
      "cassa_eur=cassa_eur" in _calc474.split("valuta_ordini(")[1][:300], _calc474.split("valuta_ordini(")[1][:300])
_lv490 = NL.testo_libro()
_s1_490 = _lv490[_lv490.find("## 1. POSIZIONI"):_lv490.find("\n## 1bis")]
check("v490 LIBRO.md §1 dichiara la liquidità IN TUTTO, bloccata compresa: è la premessa su cui la libera si calcola "
      "togliendo gli ordini attivi",
      any("Liquidità:" in r and "bloccata compresa" in r for r in _s1_490.splitlines()), _s1_490[:300])

# ================================================================ v491 — dopo l'ultima verifica, dalle barre a 5 minuti
# Il 15/10/2026 ORCL, OKLO e SMCI hanno toccato i loro limiti fra le 15:30 e le 15:54 italiane; alle 18:02 il conto li
# mostrava ancora attivi e non eseguiti; dopo, nessuno è più sceso al limite. La resa della v490 diceva «può essere
# stato ESEGUITO, se l'ordine era già sul conto in quel momento»: vera, e incapace di distinguere. L'ultima verifica
# (colonna «Attivo alle») separa il prima dal dopo. Ogni stato si COSTRUISCE (v425, v429): barre sintetiche, orari fissi.
from datetime import timezone as _tz491
def _b5_491(giorno, minimi=None, massimi=None, fino="16:00", base=106.0):
    """Barre a 5 minuti sintetiche di una seduta (ora di New York): minimo `base`, massimo base+1, salvo le eccezioni."""
    g = _giorno474.fromisoformat(giorno)
    t = _dt474(g.year, g.month, g.day, 9, 30, tzinfo=_NY474)
    hh, mm = map(int, fino.split(":"))
    stop = _dt474(g.year, g.month, g.day, hh, mm, tzinfo=_NY474)
    out = []
    while t < stop:
        k = t.strftime("%H:%M")
        lo = (minimi or {}).get(k, base)
        hi = (massimi or {}).get(k, base + 1.0)
        out.append({"dt": t, "o": base, "h": max(hi, lo), "l": lo, "c": base, "v": 1000})
        t += _td474(minutes=5)
    return out
def _ord491(alle="18:02", lim=100.0, verso="acquisto", giorno="2026-10-15"):
    return {"tk": "AAA", "verso": verso, "verso_testo": verso, "limite": lim, "qta": 100, "inserito": giorno,
            "attivo_alle": NL.ora_attivo(alle, giorno), "attivo_alle_testo": alle}
_DV491 = lambda o, **k: NL.dopo_verifica(o, _b5_491(o["inserito"], **k))

_oa491 = [NL.ora_attivo(a, g) for a, g in (("18:02", "2026-10-15"), ("15:40", "2026-10-27"), ("15:40", "2026-11-03"))]
check("v491 «Attivo alle» è ORA ITALIANA e diventa ora di New York dal fuso, mai da uno scarto a mano: 18:02 del 15/10 "
      "= 12:02, 15:40 del 27/10 (la settimana in cui le due ore legali non coincidono) = 10:40, 15:40 del 03/11 = "
      "09:40; un giorno esplicito vince su quello d'inserimento; vuoto, illeggibile o fuori scala = None",
      [x.astimezone(_NY474).strftime("%H:%M") for x in _oa491] == ["12:02", "10:40", "09:40"]
      and NL.ora_attivo("2026-10-14 9.30", "2026-10-15").strftime("%Y-%m-%d %H:%M") == "2026-10-14 09:30"
      and [NL.ora_attivo(a, "2026-10-15") for a in ("", "ieri", "25:00", "18:75")] == [None] * 4,
      str([x.isoformat() for x in _oa491]))

_lib491 = ("## 1septies. ORDINI APERTI — x\n\n| Nome | Verso | Quantità | Limite | Inserito | Stato | Validità | Attivo alle |\n"
           "|---|---|---|---|---|---|---|---|\n| AAA | acquisto | 100 | 105,00 | 2026-10-09 | attivo | giornaliero | 18:02 |\n"
           "| BBB | acquisto | 100 | 105,00 | 2026-10-09 | attivo | giornaliero |  |\n"
           "| CCC | acquisto | 100 | 105,00 | 2026-10-09 | attivo | giornaliero | ieri |\n"
           "| DDD | acquisto | 100 | 95,00 | 2026-10-09 | attivo | giornaliero | 18:02 |\n")
_or491 = NL.leggi_ordini(_lib491)
check("v491 la colonna «Attivo alle» si legge in CODA, dopo la validità, senza spostare le altre: un'ora, una cella "
      "vuota, un testo illeggibile (che resta com'è scritto, per la resa)",
      [o["tk"] for o in _or491] == ["AAA", "BBB", "CCC", "DDD"] and [o["validita"] for o in _or491] == ["giornaliero"] * 4
      and _or491[0]["attivo_alle"].strftime("%Y-%m-%d %H:%M") == "2026-10-09 18:02"
      and _or491[1]["attivo_alle"] is None and _or491[2]["attivo_alle"] is None
      and _or491[2]["attivo_alle_testo"] == "ieri" and _or491[0]["limite"] == 105.0, str(_or491))

_v491 = {"prima": _DV491(_ord491(), minimi={"10:00": 99.0}),
         "dopo": _DV491(_ord491(), minimi={"10:00": 99.0, "13:00": 99.5}),
         "cavallo": _DV491(_ord491(), minimi={"12:00": 99.0}),
         "minuto_dopo": _DV491(_ord491("18:04"), minimi={"12:05": 99.0}),
         "minuto_cavallo": _DV491(_ord491("18:05"), minimi={"12:05": 99.0}),
         "soffio": _DV491(_ord491(), minimi={"13:00": 100.05}),
         "fuori_margine": _DV491(_ord491(), minimi={"13:00": 100.2}),
         "in_arrivo": _DV491(_ord491(), minimi={"10:00": 99.0}, fino="13:00"),
         "dopo_campana": _DV491(_ord491("22:30"), minimi={"10:00": 99.0}),
         "vendita_si": _DV491(_ord491(lim=110.0, verso="vendita"), massimi={"14:00": 111.0}),
         "vendita_no": _DV491(_ord491(lim=110.0, verso="vendita"), minimi={"14:00": 50.0})}
_e491 = {k: (v.get("letto"), v.get("toccato"), v.get("motivo")) for k, v in _v491.items()}
check("v491 dopo l'ultima verifica: un minimo PRIMA non esegue niente (il conto diceva «attivo»), uno DOPO sì; la barra "
      "che contiene l'ora della verifica non decide («cavallo»); l'ora annotata vale per tutto il suo minuto; a meno "
      "di MARGINE_5MIN dal limite non si decide («soffio»), oltre sì; se le barre non arrivano alla campana è «in "
      "arrivo»; dopo la campana non c'è più niente da eseguire; una vendita si esegue sul MASSIMO",
      _e491 == {"prima": (True, False, None), "dopo": (True, True, None), "cavallo": (True, None, "cavallo"),
                "minuto_dopo": (True, True, None), "minuto_cavallo": (True, None, "cavallo"),
                "soffio": (True, None, "soffio"), "fuori_margine": (True, False, None),
                "in_arrivo": (True, None, "in arrivo"), "dopo_campana": (True, False, None),
                "vendita_si": (True, True, None), "vendita_no": (True, False, None)}
      and _v491["prima"]["estremo"] == 106.0 and _v491["dopo"]["estremo"] == 99.5
      and _v491["vendita_si"]["nome"] == "massimo" and _v491["vendita_si"]["estremo"] == 111.0
      and _v491["in_arrivo"]["fino"].strftime("%H:%M") == "13:00", str(_e491))
_nl491 = [NL.dopo_verifica(_ord491(alle=""), _b5_491("2026-10-15")),
          NL.dopo_verifica(_ord491(alle="ieri"), _b5_491("2026-10-15")),
          NL.dopo_verifica(_ord491(), "barre a 5 minuti NON lette (prova)"),
          NL.dopo_verifica(_ord491(giorno="2026-10-20"), _b5_491("2026-10-15"))]
check("v491 quando non si può dire, si dice perché — mai un esito: ora non annotata, ora illeggibile, barre non lette, "
      "seduta fuori dai cinque giorni della fonte",
      [x["letto"] for x in _nl491] == [False] * 4 and "non è annotata" in _nl491[0]["perche"]
      and "«ieri» non si legge" in _nl491[1]["perche"] and _nl491[2]["perche"] == "barre a 5 minuti NON lette (prova)"
      and "non è nelle barre a 5 minuti" in _nl491[3]["perche"] and all("toccato" not in x for x in _nl491),
      str([x.get("perche") for x in _nl491]))

_vera491 = ROT.brief.jget
def _sa491(reale):
    out = []
    for g in ("2026-10-14", "2026-10-15"):
        y, m, d = map(int, g.split("-"))
        base = _dt474(y, m, d, 9, 30, tzinfo=(_NY474 if reale else _tz491.utc))
        out += [{"t": int(base.timestamp()) + 300 * i, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.0, "v": 10} for i in range(78)]
    return {"status": 200, "data": out}
try:
    ROT.brief.jget = lambda url, timeout=20: _sa491(False)
    _bb491 = ROT.brief.barre_5min("AAA")
    ROT.brief.jget = lambda url, timeout=20: _sa491(True)
    try:
        ROT.brief.barre_5min("AAA")
        _err491 = None
    except ValueError as e:
        _err491 = str(e)
finally:
    ROT.brief.jget = _vera491
check("v491 le barre a 5 minuti portano l'ora di PARETE di New York scritta come UTC, e la lettura si VERIFICA: ogni "
      "giornata deve cominciare alle 09:30; con la codifica cambiata l'ora sbaglierebbe di 4-5 ore e un prezzo di prima "
      "diventerebbe un prezzo di dopo — quindi si dichiara illeggibile, non si usa",
      len(_bb491) == 156 and _bb491[0]["dt"].strftime("%Y-%m-%d %H:%M") == "2026-10-14 09:30"
      and _bb491[0]["dt"].tzinfo is _NY474 and _bb491[-1]["dt"].strftime("%H:%M") == "15:55"
      and _err491 is not None and "09:30" in _err491 and "13:30" in _err491, str((len(_bb491), _err491)))

_chiam491 = []
def _intra491(minimi=None, fino="16:00", errore=None):
    def f(tk):
        _chiam491.append(tk)
        if errore:
            raise RuntimeError(errore)
        return _b5_491("2026-10-09", minimi=minimi, fino=fino)
    return f
def _vo491(adesso, intraday, ordini=None):
    b = {k: _bA490t for k in ("AAA", "BBB", "CCC", "DDD")}          # la seduta del 09/10 ha il minimo a 104
    t = {k: _tec489() for k in b}                                     # la quota del 09/10: minimo di oggi 104
    return NL.valuta_ordini(_or491 if ordini is None else ordini, b, t, {k: _lu489 for k in b}, _cal489, {},
                            _sem481(), _rl489, _rq489, 100000.0, 1.12, adesso, cassa_eur=100000.0, intraday=intraday)
_LUN491 = _dt474(2026, 10, 12, 10, 0, tzinfo=_NY474)
_chiam491.clear()
_s491 = _vo491(_LUN491, _intra491(minimi={"10:00": 104.0}))
_cs491 = {o["tk"]: o for o in _s491["chiusi"]}
_rs491 = "\n".join(NL.righe_ordini(_s491))
check("v491 le barre a 5 minuti si chiedono SOLO quando servono: un limite raggiunto nella seduta E un'ora di verifica "
      "annotata — e una volta per nome; un ordine non toccato (DDD) o senza ora (BBB, CCC) non costa una richiesta",
      _chiam491 == ["AAA"] and _cs491["DDD"]["verifica"] is None and _cs491["DDD"]["toccato"] is False
      and _cs491["AAA"]["verifica"]["toccato"] is False, str(_chiam491))
check("v491 resa degli ordini chiusi: il limite raggiunto PRIMA della verifica e non dopo = SCADUTO, col minimo dopo e "
      "la distanza dal limite; senza ora, o con un'ora illeggibile, resta la frase della v490 e si dice il perché",
      ("AAA acquisto 100 a 105,00 (seduta del 2026-10-09) · il minimo della seduta (104,00) ha raggiunto il limite, ma "
       "prima delle 18:02 italiane, quando l'ordine risultava ancora attivo e non eseguito: dopo, il minimo è stato "
       "106,00 (+1,0% dal limite) → SCADUTO senza esecuzione") in _rs491
      and ("BBB acquisto 100 a 105,00 (seduta del 2026-10-09) · il minimo della seduta (104,00) ha raggiunto il limite: "
           "può essere stato ESEGUITO, se l'ordine era già sul conto in quel momento · l'ora dell'ultima verifica non è "
           "annotata") in _rs491
      and "«Attivo alle» «ieri» non si legge" in _rs491
      and "DDD acquisto 100 a 95,00 (seduta del 2026-10-09) · il minimo della seduta (104,00) non ha raggiunto il limite: "
          "SCADUTO" in _rs491, _rs491[-1600:])
_t491 = "\n".join(NL.righe_ordini(_vo491(_LUN491, _intra491(minimi={"10:00": 104.0, "13:00": 104.5}))))
_x491 = "\n".join(NL.righe_ordini(_vo491(_LUN491, _intra491(errore="rete giù"))))
check("v491 il limite raggiunto anche DOPO la verifica = può essere stato ESEGUITO; barre non lette = la frase della "
      "v490 col perché, MAI uno SCADUTO dedotto da un dato che manca",
      ("il minimo della seduta (104,00) ha raggiunto il limite, e anche DOPO le 18:02 italiane, quando l'ordine "
       "risultava ancora attivo e non eseguito (minimo dopo: 104,50): può essere stato ESEGUITO") in _t491
      and "barre a 5 minuti NON lette (rete giù)" in _x491
      and "AAA acquisto 100 a 105,00 (seduta del 2026-10-09) · il minimo della seduta (104,00) ha raggiunto il limite: " \
          "può essere stato ESEGUITO" in _x491 and "\n    AAA" in _x491
      and "SCADUTO" not in [r for r in _x491.splitlines() if r.strip().startswith("AAA")][0], _x491[-900:])
_or491b = NL.leggi_ordini(_lib491.replace("| giornaliero | 18:02 |\n| BBB", "| giornaliero | 2026-10-08 18:02 |\n| BBB"))
_ab491 = {o["tk"]: o for o in _vo491(_LUN491, _intra491(), _or491b)["chiusi"]}["AAA"]
check("v491 un'ultima verifica di un altro giorno non separa il prima dal dopo di QUESTA seduta: si dichiara",
      _ab491["verifica"]["letto"] is False and "non è della seduta del 2026-10-09" in _ab491["verifica"]["perche"],
      str(_ab491.get("verifica")))
_ALLE14_491 = _dt474(2026, 10, 9, 14, 0, tzinfo=_NY474)              # seduta aperta: l'ordine è ancora attivo
_at491 = NL.valuta_ordini(_or491[:1], {"AAA": _bA490t}, {"AAA": _tec489()}, {"AAA": _lu489}, _cal489, {}, _sem481(),
                          _rl489, _rq489, 100000.0, 1.12, _ALLE14_491, cassa_eur=100000.0,
                          intraday=_intra491(minimi={"10:00": 104.0}, fino="14:00"))
_ra491 = "\n".join(NL.righe_ordini(_at491))
check("v491 durante la seduta: la testa porta l'ultima verifica, e «il minimo di oggi ha toccato il limite» dice se è "
      "successo prima o dopo — finora, fino all'ultima barra letta, in ora italiana",
      _at491["righe"][0]["toccato_oggi"] is True
      and "AAA acquisto 100 a 105,00 (inserito 2026-10-09, attivo e non eseguito alle 18:02 italiane)" in _ra491
      and ("il minimo di oggi (104,00) ha raggiunto il limite, ma prima delle 18:02 italiane, quando l'ordine risultava "
           "ancora attivo e non eseguito: dopo, il minimo è stato 106,00 (+1,0% dal limite), fino alle 20:00 → finora "
           "non eseguito") in _ra491
      and "se l'ordine era già attivo in quel momento" not in _ra491, _ra491[:1400])
check("v491 collegamento in calcola: le barre a 5 minuti arrivano agli ordini aperti",
      "intraday=brief.barre_5min" in _calc474.split("valuta_ordini(")[1][:400], _calc474.split("valuta_ordini(")[1][:400])
_lv491 = NL.testo_libro()
_s7_491 = _lv491[_lv491.find("## 1septies"):_lv491.find("\n## 1octies")]
check("v491 LIBRO.md §1septies ha la colonna «Attivo alle» in coda e ogni ora scritta si legge: un'ora illeggibile "
      "farebbe tornare la resa al dubbio della v490 senza che nessuno se ne accorga",
      "| Validità | Attivo alle |" in _s7_491
      and all(o["attivo_alle"] is not None or not o["attivo_alle_testo"].strip() for o in (NL.leggi_ordini() or [])),
      _s7_491[:400])

# ================================================================ v492 — lettura a 5 anni, veicolo di quotazione, P/E
# Decisione del CEO del 16/10/2026: "Si" alla lettura a 5 anni in ogni ingresso, "inoltre inserisci anche il fattore P/e
# come metrica di analisi delle azioni". Gli stati si COSTRUISCONO (v425, v429): oggi OKLO ha il veicolo nello storico e
# SKHY e' quotato da 13 settimane, domani potrebbero non esserci piu' nomi cosi'.
_d492 = _giorno474
def _giorni492(n, inizio="2021-10-18"):
    g, out = _d492.fromisoformat(inizio), []
    while len(out) < n:
        if g.weekday() < 5:
            out.append(g.isoformat())
        g += _td474(days=1)
    return out
def _serie492(chiusure, inizio="2021-10-18", lo=None, hi=None):
    """Barre giornaliere col minimo e il massimo dati (default chiusura -/+ 1%)."""
    return [{"t": t, "o": c, "h": (hi[i] if hi else c * 1.01), "l": (lo[i] if lo else c * 0.99), "c": c, "a": c, "v": 1000}
            for i, (t, c) in enumerate(zip(_giorni492(len(chiusure), inizio), chiusure))]
# un sabato a mezzogiorno di New York: tutte le settimane della serie sono concluse
_DOPO492 = _dt474(2026, 10, 17, 12, 0, tzinfo=_NY474)

# --- le chiusure settimanali: l'ultima seduta della settimana, e la settimana in corso NON entra fino al venerdi' 16:00 ---
_sw492 = _serie492([10 + i for i in range(10)], inizio="2026-10-05")       # due settimane: lun 05/10 - ven 16/10
_venerdi_prima = ROT.settimane_concluse(_sw492, _dt474(2026, 10, 16, 15, 59, tzinfo=_NY474))
_venerdi_dopo = ROT.settimane_concluse(_sw492, _dt474(2026, 10, 16, 16, 0, tzinfo=_NY474))
check("v492 chiusure settimanali: l'ultima seduta della settimana, per data; la settimana in corso entra solo dalle 16:00 "
      "di New York del suo venerdi' — col fuso, non con uno scarto",
      _venerdi_prima == [("2026-10-09", 14)] and _venerdi_dopo == [("2026-10-09", 14), ("2026-10-16", 19)],
      str((_venerdi_prima, _venerdi_dopo)))
_sv492 = _serie492([10, 11, 12, 13], inizio="2026-03-30")                   # lun 30/03 - gio 02/04, venerdi' santo chiuso
check("v492 una settimana senza la seduta del venerdi' (festiva) si chiude lo stesso dopo le 16:00 di quel venerdi', con la "
      "chiusura del giovedi': un giorno di ritardo dichiarato, non un prezzo inventato",
      ROT.settimane_concluse(_sv492, _dt474(2026, 4, 2, 17, 0, tzinfo=_NY474)) == []
      and ROT.settimane_concluse(_sv492, _dt474(2026, 4, 3, 16, 0, tzinfo=_NY474)) == [("2026-04-02", 13)])

# --- le medie a 30, 50 e 200 settimane: la media delle ultime k chiusure, la pendenza su 13, mai su meno settimane ---
_c492 = [50.0 + (i % 7) * 0.5 + i * 0.01 for i in range(1300)]                 # ~260 settimane
_s492 = _serie492(_c492)
_l492 = ROT.lettura_5anni(_s492, 60.0, _DOPO492)
_w492 = [c for _, c in ROT.settimane_concluse(_s492, _DOPO492)]
_att492 = {k: sum(_w492[-k:]) / k for k in (30, 50, 200)}
_pen492 = {k: (sum(_w492[-k:]) / k) / (sum(_w492[-k - 13:-13]) / k) - 1 for k in (30, 50, 200)}
check("v492 le medie settimanali sono la media delle ultime k chiusure settimanali concluse, con la distanza del prezzo e la "
      "pendenza su 13 settimane — ricalcolate qui, a mano, sulle stesse settimane",
      _l492 is not None and all(abs(_l492["medie"][k]["valore"] - _att492[k]) < 1e-9
                                and abs(_l492["medie"][k]["dist_pct"] - (60.0 / _att492[k] - 1) * 100) < 1e-9
                                and abs(_l492["medie"][k]["pend_pct"] - _pen492[k] * 100) < 1e-9 for k in (30, 50, 200)),
      str(_l492 and _l492["medie"]))
_cor492 = ROT.lettura_5anni(_serie492(_c492[:400]), 60.0, _DOPO492)                # ~80 settimane, come CRWV
check("v492 con meno settimane della media, la media e' n.d. e la riga dice quante ne servono e quante ce ne sono — mai "
      "una media calcolata su meno",
      _cor492["medie"][200] is None and _cor492["medie"][50] is not None and _cor492["breve"] is True
      and "200 n.d. (servono 200 settimane, ce ne sono 80)" in "\n".join(ROT.righe_5anni(_cor492)),
      "\n".join(ROT.righe_5anni(_cor492))[:500])

# --- massimo, minimo, posizione e rialzo restituito, su un percorso costruito: da 10 a 100, poi giu' a 40 ---
_p492 = [10.0] * 50 + [10.0 + 90.0 * i / 400 for i in range(1, 401)] + [100.0 - 60.0 * i / 300 for i in range(1, 301)]
_m492 = ROT.lettura_5anni(_serie492(_p492, lo=_p492, hi=_p492), 40.0, _DOPO492)
check("v492 massimo e minimo con la data, posizione nell'intervallo (0 = minimo, 100 = massimo) e quota del rialzo — dal "
      "minimo che precede il massimo al massimo — che il prezzo ha gia' restituito: da 10 a 100 e giu' a 40 = 33/100 e 67%",
      _m492["massimo"]["prezzo"] == 100.0 and _m492["minimo"]["prezzo"] == 10.0
      and abs(_m492["posizione"] - 100 / 3) < 1e-9 and abs(_m492["rialzo"]["restituito_pct"] - 200 / 3) < 1e-9
      and _m492["rialzo"]["da"] == 10.0 and abs(_m492["dmax_pct"] + 60.0) < 1e-9
      and "posizione nell'intervallo 33/100" in "\n".join(ROT.righe_5anni(_m492))
      and "ne ha restituito il 67%" in "\n".join(ROT.righe_5anni(_m492)), str(_m492 and {k: _m492[k] for k in ("posizione", "rialzo")}))
_r492 = "\n".join(ROT.righe_5anni(ROT.lettura_5anni(_serie492(_p492, lo=_p492, hi=_p492), 120.0, _DOPO492)))
_g492 = "\n".join(ROT.righe_5anni(ROT.lettura_5anni(_serie492(_p492, lo=_p492, hi=_p492), 5.0, _DOPO492)))
check("v492 un prezzo oltre gli estremi lo dice in parole, non con una posizione fuori scala: SOPRA il massimo (e nessun "
      "rialzo restituito), SOTTO il minimo (tutto restituito, e oltre)",
      "SOPRA il massimo" in _r492 and "non ha restituito nulla" in _r492
      and "SOTTO il minimo" in _g492 and "oltre il punto di partenza" in _g492, _r492[-400:] + " || " + _g492[-400:])
_disc492 = [100.0 - 90.0 * i / 1299 for i in range(1300)]
check("v492 se il massimo sta all'inizio della serie non c'e' un rialzo da misurare, e si dice",
      "nessun rialzo da misurare" in "\n".join(ROT.righe_5anni(ROT.lettura_5anni(_serie492(_disc492), 10.0, _DOPO492))))
_in492 = _serie492([20.0] * 1299 + [20.0], lo=[19.8] * 1299 + [2.0])
_in492[-1]["t"] = "2026-10-16"
check("v492 la seduta IN CORSO non entra: il suo minimo puo' ancora scendere, e un minimo di cinque anni non si scrive su "
      "una barra in formazione (v471)",
      ROT.lettura_5anni(_in492, 20.0, _dt474(2026, 10, 16, 12, 0, tzinfo=_NY474))["minimo"]["prezzo"] == 19.8
      and ROT.lettura_5anni(_in492, 20.0, _dt474(2026, 10, 16, 17, 0, tzinfo=_NY474))["minimo"]["prezzo"] == 2.0)

# --- il veicolo di quotazione (SPAC): la serie della societa' di oggi comincia il giorno dopo la sua fine ---
_vg492 = [10.0] * 650 + [30.0 + (i % 5) for i in range(650)]                     # 130 settimane di veicolo, poi la societa'
_sv492b = _serie492(_vg492)
_fine492 = _sv492b[649]["t"]
_V492 = {"verificato": True, "fine": _fine492, "deposito": "2024-05-13"}
_con492 = ROT.lettura_5anni(_sv492b, 31.0, _DOPO492, veicolo=_V492)
_senza492 = ROT.lettura_5anni(_sv492b, 31.0, _DOPO492, veicolo={"verificato": False, "perche": "prova"})
check("v492 VEICOLO DI QUOTAZIONE verificato sul registro SEC: la serie parte dal giorno dopo la sua fine, la media a 200 "
      "settimane non esiste (la societa' ne ha 130) e il minimo non e' quello del veicolo — il caso OKLO, da AltC",
      _con492["da"] > _fine492 and _con492["motivo"] == "veicolo" and _con492["medie"][200] is None
      and _con492["minimo"]["prezzo"] > 20 and _senza492["medie"][200] is not None and _senza492["minimo"]["prezzo"] < 11,
      str((_con492 and _con492["da"], _con492 and _con492["medie"][200], _senza492 and _senza492["minimo"])))
_rv492 = "\n".join(ROT.righe_5anni(_con492, _V492))
_rn492 = "\n".join(ROT.righe_5anni(_senza492, {"verificato": False, "perche": "la pipeline non pubblica ancora il dato del registro SEC"}))
_rok492 = "\n".join(ROT.righe_5anni(_senza492, {"verificato": True, "fine": None, "deposito": None}))
check("v492 la resa dice da dove parte la serie e perche' (8-K con item 5.06 e la sua data); un titolo NON verificato lo "
      "dichiara invece di passare per 'nessun veicolo'; uno verificato senza veicolo non porta l'avviso",
      "VEICOLO DI QUOTAZIONE" in _rv492 and "8-K del 2024-05-13 con item 5.06" in _rv492
      and "storia della quotazione NON verificata — la pipeline non pubblica ancora" in _rn492
      and "NON verificata" not in _rok492 and "VEICOLO" not in _rok492, _rv492[:400])
check("v492 tre esiti distinti: storico NON letto (None) non e' 'nessun livello'",
      ROT.righe_5anni(None) == ["lettura a 5 anni: storico NON letto (o prezzo mancante) — non vuol dire 'nessun livello'"]
      and ROT.lettura_5anni(None, 10.0) is None and ROT.lettura_5anni(_s492, None) is None)
_pv492 = ROT.pavimenti(_serie487([10.5] * 6 + _V487(9.6) + [10.5] * 6 + _V487(30) + [42] * 15), 40.0, 1.0,
                       veicolo={"verificato": True, "fine": _serie487([10.5] * 6 + _V487(9.6) + [10.5] * 6)[-1]["t"],
                                "deposito": "x"})
check("v492 i PAVIMENTI usano la stessa serie della societa': un minimo del veicolo non diventa un pavimento, e la resa "
      "dice che la serie parte dopo il veicolo (una regola sola per pavimenti e lettura a 5 anni, v161)",
      _pv492 is not None and _pv492["taglio_motivo"] == "veicolo"
      and all(z["fondo"] > 20 for z in _pv492["minimi"]) and "VEICOLO DI QUOTAZIONE" in "\n".join(ROT.righe_pavimenti(_pv492)),
      str(_pv492 and [(z["fondo"], z["alto"]) for z in _pv492["minimi"]]))
_a492 = [c * (1.0 if i < 600 else 0.75) for i, c in enumerate([20.0] * 1300)]
_sc492 = [dict(b, a=a) for b, a in zip(_serie492([20.0] * 1300), _a492)]
_both492 = ROT.serie_della_societa(_sc492, {"verificato": True, "fine": _sc492[300]["t"]})
check("v492 lo scorporo dopo la fine del veicolo vince (la serie parte dal piu' recente dei due tagli); senza verifica il "
      "veicolo non taglia niente",
      _both492[2] == "societaria" and _both492[1] == _sc492[600]["t"]
      and ROT.serie_della_societa(_sv492b, {"verificato": False, "fine": _fine492})[2] is None
      and ROT.serie_della_societa(_sv492b, None)[0] == _sv492b, str(_both492[1:]))

# --- la storia della quotazione arriva dalla pipeline: quattro stati, e nessuno passa per 'nessun veicolo' ---
_dq492 = {"macro": {"sec_calendario": {"storia_quotazione": {"per_titolo": {
    "OKL": {"fine_veicolo": "2024-05-09", "deposito": "2024-05-13"}, "MUU": {"fine_veicolo": None, "verificato_dal": "2017-09-06"},
    "EST": {"non_verificabile": "nessun 8-K fra i depositi letti"}}}}}}
check("v492 veicolo_pipeline: verificato con veicolo · verificato senza · non verificabile (con la ragione) · non letto · "
      "pipeline che non lo pubblica ancora",
      ROT.veicolo_pipeline(_dq492, "OKL") == {"verificato": True, "fine": "2024-05-09", "deposito": "2024-05-13"}
      and ROT.veicolo_pipeline(_dq492, "MUU") == {"verificato": True, "fine": None, "deposito": None}
      and ROT.veicolo_pipeline(_dq492, "EST") == {"verificato": False, "perche": "nessun 8-K fra i depositi letti"}
      and ROT.veicolo_pipeline(_dq492, "ZZZ")["perche"] == "SEC EDGAR non letto per questo nome"
      and "non pubblica ancora" in ROT.veicolo_pipeline({}, "OKL")["perche"])

# --- il P/E come metrica: i multipli dell'aggregatore, la perdita detta come perdita, i due utili attesi ---
_pe492 = lambda st, an=None: SP.riga_valutazione({"stats": st, "analisti": an or {}})
_p_ok = _pe492({"pe_ttm": 13.06, "forward_pe": 4.55, "eps_ttm": 71.28, "eps_forward": 204.47, "peg": 0.16},
               {"eps_ora": 204.47})
check("v492 P/E: trailing e prospettico con l'utile per azione; un trailing almeno 2 volte il prospettico si dichiara (le due "
      "letture non si distinguono da qui); il PEG con la sua riserva; nessun avviso dei due utili quando coincidono",
      "P/E ultimi 12 mesi 13,1× (EPS 71,28)" in _p_ok and "P/E prospettico 4,5× (EPS atteso 204,47)" in _p_ok
      and "il trailing e' 2,9 volte il prospettico" in _p_ok and "PEG 0,16" in _p_ok and "⚠" not in _p_ok, _p_ok)
_p_loss = _pe492({"pe_ttm": None, "forward_pe": -37.5, "eps_ttm": -3.12, "eps_forward": -1.86, "ps": 5.06},
                 {"eps_ora": -4.33})
check("v492 un utile NEGATIVO non da' un P/E basso, non da' un P/E: niente multiplo stampato, prezzo/ricavi al suo posto, e "
      "i due utili attesi diversi si dichiarano (v414)",
      "NEGATIVO (EPS -3,12): nessun P/E" in _p_loss and "nessun P/E prospettico" in _p_loss and "-37" not in _p_loss
      and "prezzo/ricavi: 5,06×" in _p_loss and "un altro utile atteso (-4,33)" in _p_loss, _p_loss)
_p_mix = _pe492({"pe_ttm": None, "forward_pe": 3.06, "eps_ttm": -93.26, "eps_forward": 49.49, "ps": 128.5}, {"eps_ora": 13.17})
_p_giu = _pe492({"pe_ttm": 20.0, "forward_pe": 30.0, "eps_ttm": 3.0, "eps_forward": 2.0})
_p_vic = _pe492({"pe_ttm": 30.0, "forward_pe": 20.0, "eps_ttm": 2.0, "eps_forward": 3.0}, {"eps_ora": 3.1})
check("v492 utile passato negativo e atteso positivo: il prospettico esce, il confronto fra i due no; prospettico piu' alto "
      "= utile atteso PIU' BASSO; sotto la soglia del 2 e con utili vicini entro il 5% nessun avviso",
      "P/E prospettico 3,1×" in _p_mix and "volte il prospettico" not in _p_mix and "un altro utile atteso (13,17)" in _p_mix
      and "PIU' BASSO" in _p_giu and "volte il prospettico" not in _p_vic and "⚠" not in _p_vic,
      _p_mix + " || " + _p_giu + " || " + _p_vic)
check("v492 senza utili ne' multipli il P/E e' n.d. e lo si dice; un trailing mancante con l'utile positivo resta n.d.: "
      "il multiplo non si ricalcola qui (v161)",
      "P/E n.d." in _pe492({}) and "P/E ultimi 12 mesi n.d." in _pe492({"eps_ttm": 2.0, "forward_pe": 10.0}))
_rif492 = SP.riferimento_valutazione({"forward_pe": {"value": 19.6, "avg_hist": 16.5, "source": "WSJ (estimate)",
                                                     "fetched_at": "2026-10-15"},
                                      "sp500_pe": {"current": 26.4, "nasdaq_pe": 27.9, "source": "multpl",
                                                   "fetched_at": "2026-10-15"}})
check("v492 il riferimento dell'S&P 500 ha fonte e data; la media storica senza provenienza e il P/E del Nasdaq senza base "
      "dichiarata restano fuori; senza dati lo si dice",
      "prospettico 19,6× [WSJ (estimate), 2026-10-15]" in _rif492 and "ultimi 12 mesi 26,4× [multpl, 2026-10-15]" in _rif492
      and "16,5" not in _rif492 and "27,9" not in _rif492 and "indicativo" in _rif492
      and "n.d. (la pipeline non lo pubblica)" in SP.riferimento_valutazione({}), _rif492)
check("v492 il P/E degli ingressi e' la resa delle schede (una sola, v161); fuori dalla pipeline si dichiara n.d. invece di "
      "cercare il multiplo altrove",
      ROT.riga_valutazione({"in_pipeline": True, "stats": {"pe_ttm": 20.0, "eps_ttm": 2.0}, "analisti": {}})
      == SP.riga_valutazione({"stats": {"pe_ttm": 20.0, "eps_ttm": 2.0}, "analisti": {}})
      and "titolo non seguito dalla pipeline" in ROT.riga_valutazione({"in_pipeline": False}))

# --- collegamenti, ESEGUITI dove si puo' (v399, v483): schede, watchlist, candidati, ordini, tenuta ---
_rsch492 = SP.genera({"watchlist": [{"ticker": "AAA", "name": "A", "stats": {"pe_ttm": 20.0, "eps_ttm": 2.0}},
                                    {"ticker": "BBB", "name": "B", "stats": {"eps_ttm": -1.0}}],
                      "macro": {"forward_pe": {"value": 19.6, "source": "WSJ", "fetched_at": "2026-10-15"}}}, ["AAA"], ["BBB"])
check("v492 collegamento: le schede stampano la riga «valutazione» di ogni nome e il riferimento UNA volta in testa",
      _rsch492.count("valutazione (decisione del CEO del 16/10/2026") == 1 and _rsch492.count("  valutazione: ") == 2
      and "P/E ultimi 12 mesi 20,0×" in _rsch492, _rsch492[:600])
_ri492 = "\n".join(ROT.righe_ingresso(_w473("FIVE", cinque_anni=_m492, veicolo=_V492,
                                            stats={"pe_ttm": 20.0, "eps_ttm": 2.0}), {"finestra": 45}))
check("v492 collegamento: ogni sorvegliato porta la lettura a 5 anni e la riga «valutazione» — provato eseguendo la resa",
      "lettura a 5 anni" in _ri492 and "posizione nell'intervallo 33/100" in _ri492 and "valutazione: P/E ultimi 12 mesi 20,0×" in _ri492,
      _ri492[-1500:])
_oc492 = {**_ocand, "settori": [{**_ocand["settori"][0], "titoli": [
    {**_ocand["settori"][0]["titoli"][0], "cinque_anni": _m492, "veicolo": _V492, "in_pipeline": True,
     "stats": {"pe_ttm": 20.0, "eps_ttm": 2.0}}]}]}
_rc492 = "\n".join(ROT.righe_candidati(_oc492, {"AAA": {"stato": "ok", "voci": []}}))
_rw492 = "\n".join(ROT.righe_watchlist({**_o473, "valutazione_rif": "valutazione (prova del riferimento)"}))
check("v492 collegamento: i candidati di settore portano lettura a 5 anni e P/E, e l'intestazione della watchlist dichiara "
      "le convenzioni a 5 anni e il riferimento dei multipli una volta",
      "lettura a 5 anni" in _rc492 and "valutazione: P/E ultimi 12 mesi 20,0×" in _rc492
      and _rw492.count("lettura a 5 anni (decisione del CEO del 16/10/2026)") == 1
      and _rw492.count("valutazione (prova del riferimento)") == 1, _rc492[-800:])
_src_rac492 = _corpo_di(Path(ROT.__file__).read_text(), "raccogli")
check("v492 collegamento in raccogli: la lettura a 5 anni su sorvegliati E candidati (anche quelli in watchlist), i "
      "pavimenti e la lettura con la storia della quotazione dalla pipeline, il riferimento dei multipli nel risultato",
      'cand = [t for s in settori for t in s["titoli"] if e_candidato(t)]' in _src_rac492
      and 't["cinque_anni"] = lettura_5anni(BL.get(t["tk"]), t.get("px"), veicolo=t["veicolo"])' in _src_rac492
      and 'veicolo=t["veicolo"])' in _src_rac492.split('t["pavimenti"] = pavimenti(')[1][:120]
      and '"veicolo": veicolo_pipeline(d, s["tk"])' in _src_rac492
      and '"valutazione_rif": schede_progetto.riferimento_valutazione(d.get("macro"))' in _src_rac492)
# ⚠ v494 — pinnava la parentesi chiusa dopo storia=storia, e la v494 ha aggiunto la struttura alla stessa chiamata:
#   l'invariante e' che la tenuta riceva cinque anni e storia, non che siano gli ultimi argomenti (la svista della v489,
#   che pinnava «decisioni, media)» e poi «media, pav)»)
check("v492 collegamento in calcola: la storia della quotazione va a pavimenti, lettura a 5 anni, tenuta e ordini",
      "storia = {t: rotazione.veicolo_pipeline(pipe, t) for t in con_pav}" in _calc474
      and "cinque=cinque, storia=storia" in _calc474 and "intraday=brief.barre_5min, storia=storia)" in _calc474
      and "veicolo=storia.get(t))" in _calc474)

# --- gli ordini: la lettura a 5 anni di ogni ordine, e lo STOP del pavimento uguale a quello della watchlist ---
_smc492 = _serie487([40] * 6 + _V487(31.03) + [40] * 6 + _V487(29.90) + [40] * 6 + _V487(29.68) + [40] * 6
                    + _V487(29.0) + [40] * 6 + _V487(28.64) + [40] * 15)
_pz492 = ROT.pavimenti(_smc492, 32.2, 2.44)
_or492 = [{"tk": "SMX", "verso": "acquisto", "verso_testo": "acquisto", "qta": 250.0, "limite": 31.0, "inserito": "2026-10-09",
           "attivo": True, "stato": "attivo", "validita": "fino a revoca", "attivo_alle": None, "attivo_alle_testo": ""}]
_vo492 = NL.valuta_ordini(_or492, {"SMX": _b489["AAA"]}, {"SMX": _tec489(px=32.2) | {"atr": 2.44}}, {"SMX": _smc492},
                          _cal489, {}, _sem481(), _rl489, _rq489, 100000.0, 1.12, _ny489)["righe"][0]
check("v492 lo stop di un ordine col limite DENTRO il pavimento e' lo stop di quel pavimento, lo stesso della watchlist: il "
      "16/10 su SMCI il raggruppamento rifatto sul limite dava 26,34 nell'ordine e 27,46 nella watchlist (v161)",
      _vo492.get("posizione") == "sul" and abs(_vo492["stop"] - _pz492["minimi"][0]["stop"]) < 1e-9
      and abs(_vo492["stop"] - (29.90 - 2.44)) < 1e-9, str((_vo492.get("posizione"), _vo492.get("stop"), _pz492["minimi"][:2])))
_vo492s = NL.valuta_ordini([dict(_or492[0], limite=28.0)], {"SMX": _b489["AAA"]}, {"SMX": _tec489(px=32.2) | {"atr": 2.44}},
                           {"SMX": _smc492}, _cal489, {}, _sem481(), _rl489, _rq489, 100000.0, 1.12, _ny489)["righe"][0]
check("v492 col limite sotto tutte le zone mostrate il pavimento si cerca sotto il limite (ricalcolato li': qui non ce n'e', "
      "e lo stop e' n.d. invece di prendere quello di una zona sopra il limite), e la riga porta la lettura a 5 anni",
      _vo492s.get("posizione") == "sotto" and _vo492s.get("stop") is None and _vo492s.get("cinque_anni") is not None,
      str((_vo492s.get("posizione"), _vo492s.get("stop"))))
_ro492 = "\n".join(NL.righe_ordini({"righe": [dict(_vo492, cinque_anni=_m492, veicolo=_V492)], "insieme": None,
                                    "inattivi": []}))
check("v492 collegamento: la resa degli ordini stampa la lettura a 5 anni di ciascuno",
      "lettura a 5 anni" in _ro492 and "posizione nell'intervallo 33/100" in _ro492, _ro492[-900:])
_tm492 = NL.tenuta_posizioni(["AAA", "BBB"], {"AAA": _b489["AAA"], "BBB": _b489["BBB"]}, {}, _sem481(),
                             {"AAA": 100.0, "BBB": 100.0}, {"AAA": 150.0, "BBB": 50.0}, {"AAA": 10, "BBB": 10},
                             {"AAA": 0.5, "BBB": 0.5}, _ny489, None,
                             {"fx": 1.12, "valore": 2000.0, "trim": {}, "rlibro": _rl489, "rqqq": _rq489, "rend": {}},
                             None, cinque={"AAA": _m492, "BBB": _m492}, storia={"AAA": _V492, "BBB": _V492})
_rtm492 = "\n".join(NL.righe_tenuta(_tm492))
# ⚠ si spezza solo sulle righe di TESTA (due spazi e il nome): le righe interne cominciano con sei spazi, e spezzando
#   su "a capo + due spazi" ogni blocco andava in frantumi (la sonda sbagliata della v489, rifatta)
_blocchi492 = {r.split()[0]: r for r in re.split(r"\n  (?=[A-Z]{3} )", _rtm492) if r[:3] in ("AAA", "BBB")}
check("v492 nella tenuta la lettura a 5 anni accompagna la MEDIA, cioe' le sole posizioni in perdita: AAA (carico 150, "
      "prezzo 100) la porta, BBB (in guadagno) no",
      "lettura a 5 anni" in _blocchi492.get("AAA", "") and "lettura a 5 anni" not in _blocchi492.get("BBB", "x"),
      _rtm492[:1500])

# --- il formato: la richiesta e' registrata, e la sezione 7 la chiede ---
_fmt492 = (Path(__file__).resolve().parent.parent / "memoria" / "FORMATO_ANALISI.md").read_text(encoding="utf-8")
check("v492 FORMATO_ANALISI: la lettura a 5 anni e il P/E sono nel registro delle richieste del 16/10 e nella sezione 7",
      "7d-quater. **la LETTURA A 5 ANNI e il P/E**" in _fmt492
      and "la lettura\na 5 anni in ogni ingresso, sulla serie della società di oggi, e il P/E come metrica di ogni azione (16/10)"
      in _fmt492)


# ================================================================ v494 — la STRUTTURA DELLE OSCILLAZIONI e le notizie
# Il CEO, testuale (17/10/2026): «In generale analizza anche massimi e minimi decrescenti oltre, se possibile,
#   tecnicamente i grafici quando si presenta la possibilità di ingresso o si attivano i parametri di uscita fermo
#   restando che anche le ultimissime news sono importanti». Lo stato si COSTRUISCE (v425, v429, v435): il 16/10 sei
#   nomi avevano chiuso sotto l'ultimo minimo di oscillazione, domani forse nessuno, e un check che leggesse i dati del
#   giorno sarebbe verde per caso.
from datetime import date as _d494, timedelta as _td494, timezone as _tz494


def _giorni494(n, inizio="2025-06-02"):
    d, out = _d494.fromisoformat(inizio), []
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += _td494(days=1)
    return out


def _zz494(punti, passo=7, inizio="2025-06-02", vol=None):
    """Una serie a zig-zag fra i punti dati (chiusure), `passo` sedute per gamba; massimo e minimo all'1% dalla chiusura,
    cosi' i punti di svolta SONO i punti di oscillazione. vol(chiusura di ieri, di oggi) -> volume."""
    c = [float(punti[0])]
    for a, b in zip(punti, punti[1:]):
        c += [a + (b - a) * k / passo for k in range(1, passo + 1)]
    out = []
    for i, (t, x) in enumerate(zip(_giorni494(len(c), inizio), c)):
        out.append({"t": t, "o": x, "h": x * 1.01, "l": x * 0.99, "c": x, "a": x,
                    "v": vol(c[i - 1] if i else x, x) if vol else 1000})
    return out


_ad494 = _dt471(2026, 10, 17, 12, 0, tzinfo=_NY)       # un sabato: nessuna seduta in corso
_st494 = lambda punti, **kw: ROT.struttura(_zz494(punti), punti[-1], 1.0, _ad494, **kw)

# --- i punti: la regola dei pavimenti, una sola (v161) ---
_l494 = [10, 9, 8, 7, 6, 5, 5, 5, 6, 7, 8, 9, 10, 11, 12]
check("v494 perni: il piu' basso di 5 sedute prima e 5 dopo e il PRIMO a toccarlo — un tratto piatto da' un punto solo, "
      "al suo inizio; coi massimi lo stesso a specchio; un buco nella finestra non da' un punto (v205)",
      ROT.perni([{"l": x} for x in _l494], "l") == [5]
      and ROT.perni([{"h": -x} for x in _l494], "h", massimi=True) == [5]
      and ROT.perni([{"l": (None if i == 3 else x)} for i, x in enumerate(_l494)], "l") == [],
      str(ROT.perni([{"l": x} for x in _l494], "l")))
_zzp494 = _zz494([100, 90, 98, 86, 94, 82, 90, 84])
_pvp494 = ROT.pavimenti(_zzp494, 200.0, 1.0, _ad494)
check("v494 collegamento: i pavimenti nascono dai punti di perni — eseguiti, non letti: le date dei tocchi sono "
      "ESATTAMENTE quelle dei minimi di oscillazione",
      'perni(serie, "l")' in _corpo_di(_src_rot473, "pavimenti")
      and sorted(m["data"] for z in _pvp494["minimi"] for m in z["tocchi"])
      == sorted(_zzp494[i]["t"] for i in ROT.perni(_zzp494, "l"))[-len([m for z in _pvp494["minimi"] for m in z["tocchi"]]):]
      and len(ROT.perni(_zzp494, "l")) == 3, str(_pvp494["minimi"]))
_rr494 = [100 + 7 * math.sin(i / 4) + i * 0.05 for i in range(160)]
check("v494 rsi_serie: l'ultimo valore e' rsi_wilder, una derivazione sola (v161); None prima di 14 variazioni",
      abs(ROT.rsi_serie(_rr494)[-1] - ROT.rsi_wilder([{"c": x} for x in _rr494])) < 1e-12
      and ROT.rsi_serie(_rr494)[13] is None and ROT.rsi_serie(_rr494)[14] is not None)

# --- lo stato: il verso degli ultimi due, e quanti di fila ---
_rib494 = _st494([100, 90, 98, 86, 94, 82, 90, 84])
check("v494 massimi e minimi DECRESCENTI = RIBASSISTA, con quanti punti di fila e i due livelli che cambiano la sequenza",
      _rib494["stato"] == "RIBASSISTA" and _rib494["verso_massimi"] == _rib494["verso_minimi"] == "decrescenti"
      and _rib494["fila_massimi"] == 3 and _rib494["fila_minimi"] == 3 and _rib494["rottura"] is None
      and abs(_rib494["su"]["prezzo"] - 90 * 1.01) < 1e-9 and abs(_rib494["giu"]["prezzo"] - 82 * 0.99) < 1e-9
      and [round(x["prezzo"], 2) for x in _rib494["massimi"]] == [98.98, 94.94, 90.9], str(_rib494)[:600])
check("v494 crescenti = RIALZISTA · massimi giu' e minimi su = IN COMPRESSIONE · il contrario = IN ESPANSIONE",
      _st494([80, 90, 84, 94, 88, 98, 92, 96])["stato"] == "RIALZISTA"
      and _st494([80, 100, 82, 96, 84, 92, 86, 90])["stato"] == "IN COMPRESSIONE"
      and _st494([90, 94, 86, 98, 82, 102, 78, 90])["stato"] == "IN ESPANSIONE")
_fila494 = _st494([100, 90, 120, 86, 116, 82, 112, 84])        # massimi: 120 -> 116 -> 112, il primo dopo un minimo
check("v494 «di fila» conta i punti che seguono lo stesso verso, non tutti quelli dell'anno",
      _fila494["fila_massimi"] == 3 and _st494([100, 90, 98, 94, 99, 82, 90, 84])["fila_minimi"] == 2,
      str((_fila494["fila_massimi"], _st494([100, 90, 98, 94, 99, 82, 90, 84])["fila_minimi"])))

# --- alla pari: la regola dei pavimenti, mezzo ATR — e i doppi col loro collo ---
_dm494 = _st494([90, 100, 80, 95, 80.2, 88, 84])
_dmc494 = _st494([90, 100, 80, 95, 80.2, 97])
_dmr494 = _st494([90, 100, 80, 95, 80.2, 88, 77])
_d0 = lambda s, tipo: next((d for d in s["doppi"] if d["tipo"] == tipo), {})
check("v494 due minimi entro mezzo ATR sono ALLA PARI (LATERALE) e fanno un doppio minimo: il collo e' il massimo FRA i "
      "due; l'esito si legge dalla chiusura conclusa — da confermare, confermato sopra il collo, rotto sotto i due minimi",
      _dm494["verso_minimi"] == "alla pari" and _dm494["stato"] == "LATERALE"
      and abs(_d0(_dm494, "minimo").get("collo", 0) - 95 * 1.01) < 1e-9
      and _d0(_dm494, "minimo").get("esito") == "da confermare" and _d0(_dmc494, "minimo").get("esito") == "confermato"
      and _d0(_dmr494, "minimo").get("esito") == "rotto" and _d0(_dmc494, "minimo").get("sedute_dal") == 0,
      str((_dm494["doppi"], _dmc494["doppi"], _dmr494["doppi"])))
check("v494 oltre mezzo ATR due minimi NON sono alla pari: nessun doppio, e il verso e' quello vero",
      not [d for d in _st494([90, 100, 80, 95, 80.7, 88, 84])["doppi"] if d["tipo"] == "minimo"]
      and _st494([90, 100, 80, 95, 80.7, 88, 84])["verso_minimi"] == "crescenti")
_dx494 = _st494([100, 80, 95, 82, 95.2, 78])
check("v494 doppio massimo: il collo e' il minimo FRA i due, confermato con la chiusura sotto il collo, e da quando — "
      "un doppio confermato a fine agosto e' storia, uno confermato ieri e' un segnale",
      _d0(_dx494, "massimo").get("esito") == "confermato" and abs(_d0(_dx494, "massimo")["collo"] - 82 * 0.99) < 1e-9
      and _d0(_dx494, "massimo").get("sedute_dal") == 1, str(_dx494["doppi"]))

# --- la rottura: la chiusura conclusa oltre l'ultimo punto, prima che un punto nuovo la confermi ---
check("v494 ROTTA AL RIBASSO: la chiusura sotto l'ultimo minimo, l'estremo toccato da allora e quante sedute fa",
      _dmr494["rottura"] == "ribasso" and abs(_dmr494["estremo"]["prezzo"] - 77 * 0.99) < 1e-9
      and _dmr494["estremo"]["sedute_dopo"] == 0 and _dmc494["rottura"] == "rialzo" and _dm494["rottura"] is None,
      str((_dmr494["rottura"], _dmr494["estremo"])))
_bo494 = _zz494([100, 90, 98, 86, 94, 82, 90, 84])
_oggi494 = _d494.fromisoformat(_bo494[-1]["t"]) + _td494(days=3 if _d494.fromisoformat(_bo494[-1]["t"]).weekday() == 4 else 1)
_bo494 = _bo494 + [{"t": _oggi494.isoformat(), "o": 84, "h": 84.5, "l": 78, "c": 79, "a": 79, "v": 1000}]
_s11 = ROT.struttura(_bo494, 79.0, 1.0, _dt471(_oggi494.year, _oggi494.month, _oggi494.day, 11, 0, tzinfo=_NY))
_s17 = ROT.struttura(_bo494, 79.0, 1.0, _dt471(_oggi494.year, _oggi494.month, _oggi494.day, 17, 0, tzinfo=_NY))
check("v494 la seduta IN CORSO non rompe la struttura: il suo minimo puo' ancora scendere e la sua chiusura non esiste "
      "(v471); dopo la campana si'",
      _s11["rottura"] is None and _s17["rottura"] == "ribasso", str((_s11["rottura"], _s17["rottura"])))

# --- la divergenza dell'RSI: costruita, e misurata con la definizione stessa ---
def _div494(prima, rimbalzo, seconda, base=120):
    """Un'oscillazione di base, poi due discese al primo e al secondo minimo, ciascuna (passo, sedute), e un rimbalzo
    finale che conferma il secondo minimo."""
    c = [100 + 2 * math.sin(i / 3) for i in range(base)]
    for passo, n in (prima, rimbalzo, seconda, (1.5, 7)):
        c += [c[-1] + passo * k for k in range(1, n + 1)]
    return [{"t": t, "o": x, "h": x * 1.005, "l": x * 0.995, "c": x, "a": x, "v": 1000}
            for t, x in zip(_giorni494(len(c), "2025-03-03"), c)]
_bdv494 = _div494((-3, 8), (2, 6), (-0.9, 14))          # prima discesa ripida, seconda lenta: l'RSI risale (9 -> 24)
_bdn494 = _div494((-1, 12), (1, 5), (-3, 6))            # l'RSI sale di poco (14,0 -> 15,2): sotto i 3 punti e' rumore
_bdc494 = _div494((-3, 8), (2, 6), (-0.9, 14), base=20)  # poche chiusure prima: l'RSI dei punti non c'e'
_dv494 = ROT.struttura(_bdv494, _bdv494[-1]["c"], 1.0, _ad494)
_dvn494 = ROT.struttura(_bdn494, _bdn494[-1]["c"], 1.0, _ad494)
_dvc494 = ROT.struttura(_bdc494, _bdc494[-1]["c"], 1.0, _ad494)
def _atteso494(s):
    a, b = s["minimi"][-2], s["minimi"][-1]
    return (a["rsi"] is not None and b["rsi"] is not None and b["prezzo"] < a["prezzo"] - ROT.PAV_LARGHEZZA_ATR
            and b["rsi"] - a["rsi"] >= ROT.STR_RSI)
check("v494 divergenza RIALZISTA: minimo piu' basso con RSI piu' alto di almeno 3 punti — c'e' quando la definizione lo "
      "dice e solo allora; senza 100 chiusure prima del punto l'RSI non c'e' e la divergenza nemmeno (v436)",
      [d["tipo"] for d in _dv494["divergenze"]] == ["rialzista"] and _atteso494(_dv494)
      and not _dvn494["divergenze"] and not _atteso494(_dvn494)
      and _dvc494["minimi"][-2]["rsi"] is None and not _dvc494["divergenze"],
      str((_dv494["minimi"], _dvn494["minimi"], _dv494["divergenze"])))

# --- i volumi in salita e in discesa ---
_vv494 = _zz494([100, 90, 98, 86, 94, 82, 90, 84], vol=lambda a, b: 200 if b > a else 100)
_sv494 = ROT.struttura(_vv494, 84.0, 1.0, _ad494)
_su494 = sum(1 for a, b in zip(_vv494[-21:], _vv494[-20:]) if b["c"] > a["c"])
_vb494 = [dict(b) for b in _vv494]
_vb494[-3]["v"] = None
check("v494 le ultime 20 sedute concluse: quante in salita e in discesa, e il volume medio delle une contro le altre; un "
      "volume mancante e' un buco, non uno zero (v205)",
      _sv494["volumi"]["su"] == _su494 and _sv494["volumi"]["giu"] == 20 - _su494
      and abs(_sv494["volumi"]["rapporto"] - 2.0) < 1e-9 and ROT.struttura(_vb494, 84.0, 1.0, _ad494)["volumi"] is None,
      str(_sv494["volumi"]))

# --- la finestra, il taglio, i buchi ---
_lunga494 = _zz494([100, 90, 98, 86, 94, 82, 90, 84] * 7, inizio="2024-03-04")
_sl494 = ROT.struttura(_lunga494, 84.0, 1.0, _ad494)
_fv494 = _sl494["fino_a"][:4] + "-" + _sl494["fino_a"][5:]
_vei494 = {"verificato": True, "fine": _lunga494[-60]["t"]}
_sv494v = ROT.struttura(_lunga494, 84.0, 1.0, _ad494, veicolo=_vei494)
check("v494 l'ultimo anno PER DATA (v207): nessun punto prima dell'inizio della finestra; e un veicolo di quotazione "
      "dentro la finestra la taglia e lo dichiara (v492)",
      _sl494["da"] >= _sl494["inizio_finestra"] and all(x["data"] >= _sl494["inizio_finestra"]
                                                        for x in _sl494["massimi"] + _sl494["minimi"])
      and _sl494["taglio"] is None and _sv494v["motivo"] == "veicolo" and _sv494v["da"] > _vei494["fine"]
      and _sv494v["taglio"] is not None, str((_sl494["da"], _sl494["inizio_finestra"], _sv494v["da"])))
check("v494 senza barre, prezzo o ATR la struttura e' None — storico non letto, non 'nessuna struttura' (v389); con un "
      "punto solo per verso e' NON MISURABILE",
      ROT.struttura(None, 1.0, 1.0) is None and ROT.struttura(_zzp494, None, 1.0) is None
      and ROT.struttura(_zzp494, 84.0, None) is None
      and _st494([100, 90, 98, 92])["stato"] == "NON MISURABILE")

# --- la resa ---
_rs494 = "\n".join(ROT.righe_struttura(_rib494))
_rsr494 = "\n".join(ROT.righe_struttura(_dmr494))
check("v494 la resa: lo stato, la sequenza coi punti di fila, i due livelli, e la lettura dei grafici DICHIARATA "
      "convenzione di lettura, non misura (v240)",
      "— RIBASSISTA: massimi DECRESCENTI, gli ultimi 3 di fila" in _rs494 and "una chiusura sopra 90,90" in _rs494
      and "una chiusura sotto 81,18" in _rs494 and "lettura dei grafici (convenzioni di lettura, non misure)" in _rs494, _rs494)
check("v494 la resa della ROTTURA: la chiusura, l'ultimo minimo, l'estremo e quante sedute mancano perche' diventi un "
      "punto; il livello gia' rotto non si ripete come se fosse da rompere; il doppio minimo che non ha tenuto",
      "⚠ ROTTA AL RIBASSO" in _rsr494 and "sta sotto l'ultimo minimo di oscillazione" in _rsr494
      and "nelle prossime 5 sedute concluse" in _rsr494 and "una chiusura sotto" not in _rsr494
      and "il doppio minimo NON ha tenuto" in _rsr494, _rsr494)
check("v494 la resa dei tre esiti (v389): storico NON letto · NON MISURABILE con un punto solo · letta",
      "storico NON letto" in ROT.righe_struttura(None)[0]
      and "NON MISURABILE" in ROT.righe_struttura(_st494([100, 90, 98, 92]))[0]
      and "un punto solo" in ROT.righe_struttura(_st494([100, 90, 98, 92]))[0])

# --- i segnali: ingresso possibile, uscita accesa ---
_ti494 = lambda **kw: {"tk": "AAA", "stato": "SOTTO LA 200", **kw}
check("v494 INGRESSO POSSIBILE = un pavimento entro 1 ATR (la decisione del CEO del 15/10), un candidato, il prezzo nella "
      "zona; la RISALITA no — una chiusura sopra l'ultimo massimo o sopra il collo di un doppio minimo resta un segnale, "
      "e il CEO non la compra",
      ROT.segnali_ingresso(_ti494(pavimenti={"minimi": [{"atr": -0.8, "ordine": 95.0}]}))
      == ["pavimento entro 1 ATR (ordine 95,00)"]
      and ROT.segnali_ingresso(_ti494(pavimenti={"minimi": [{"atr": -1.2, "ordine": 95.0}]})) == []
      and ROT.segnali_ingresso(_ti494(stato="CANDIDATO")) == ["candidato"]
      and ROT.segnali_ingresso(_ti494(struttura={"rottura": "rialzo", "doppi": [
          {"tipo": "minimo", "esito": "confermato", "sedute_dal": 0, "dal": "2026-10-16"}]})) == []
      and ROT.segnali_ingresso({"tk": "X", "errore": "non letto"}) == [])
_doppiom494 = lambda k: {"doppi": [{"tipo": "massimo", "esito": "confermato", "sedute_dal": k, "dal": "2026-10-08"}]}
check("v494 USCITA ACCESA = la tenuta che non lascia correre, la chiusura sotto l'ultimo minimo, massimi e minimi "
      "decrescenti, un doppio massimo sotto il collo da non piu' di 10 sedute — e niente se non c'e' niente",
      NL.segnali_uscita({"esito": "LASCIAR CORRERE", "struttura": None}) == []
      and NL.segnali_uscita({"esito": NL.CONFLITTO}) == [f"tenuta: {NL.CONFLITTO}"]
      and NL.segnali_uscita({"esito": "LASCIAR CORRERE", "struttura": {"rottura": "ribasso"}})
      == ["chiusura sotto l'ultimo minimo di oscillazione"]
      and NL.segnali_uscita({"esito": "LASCIAR CORRERE", "struttura": {"stato": "RIBASSISTA"}})
      == ["massimi e minimi decrescenti"]
      and NL.segnali_uscita({"esito": "LASCIAR CORRERE", "struttura": _doppiom494(3)})
      == ["doppio massimo sotto il collo dal 2026-10-08"]
      and NL.segnali_uscita({"esito": "LASCIAR CORRERE", "struttura": _doppiom494(ROT.STR_RECENTE + 1)}) == [])
_sl494b = NL.segnali_libro({"righe": [{"tk": "AAA", "esito": "IN OSSERVAZIONE"}, {"tk": "BBB", "esito": "LASCIAR CORRERE"}]},
                           {"righe": [{"tk": "CCC", "verso": "acquisto", "limite": 24.0},
                                      {"tk": "DDD", "verso": "vendita", "limite": 50.0}]})
check("v494 i segnali del libro: le posizioni con un'uscita accesa, poi gli ordini d'ACQUISTO attivi (un ordine e' un "
      "ingresso possibile per definizione)",
      _sl494b == {"AAA": ["tenuta: IN OSSERVAZIONE"], "CCC": ["ordine d'acquisto attivo a 24,00"]}, str(_sl494b))

# --- le ultimissime notizie: la finestra, i tre esiti, la copertura del feed ---
_ora494 = _dt471(2026, 10, 17, 10, 0, tzinfo=_tz494.utc)
_chiamate494 = []
def _feed494(tk):
    _chiamate494.append(tk)
    v = lambda ore, tit: {"titolo": tit, "quando": _ora494 - _td494(hours=ore)}
    return {"AAA": (tk, "ok", [v(1, "uno"), v(50, "due"), v(100, "vecchia"), {"titolo": "senza data", "quando": None}]),
            "BBB": (tk, "ok", [v(1, "b1"), v(2, "b2")]), "CCC": (tk, "HTTP 429", []),
            "DDD": (tk, "ok", [])}[tk]
_nr494 = ROT.notizie_recenti(["AAA", "BBB", "CCC", "DDD", "AAA"], adesso=_ora494, leggi=_feed494)
check("v494 notizie: le ultime 72 ore dalla piu' recente, una voce senza data fuori, tre esiti distinti (v389), una "
      "lettura per nome; se il feed restituisce voci tutte dentro la finestra, si dichiara fin dove arriva",
      [v["titolo"] for v in _nr494["AAA"]["voci"]] == ["uno", "due"] and _nr494["AAA"]["copre_da"] is None
      and _nr494["BBB"]["copre_da"] == _ora494 - _td494(hours=2) and _nr494["CCC"]["stato"] == "HTTP 429"
      and _nr494["DDD"] == {"stato": "ok", "lette": 0, "copre_da": None, "voci": []}
      and sorted(_chiamate494) == ["AAA", "BBB", "CCC", "DDD"], str(_nr494))
_vv = lambda ore, tit: {"titolo": tit, "quando": _ora494 - _td494(hours=ore)}
_news494 = {"AAA": {"stato": "ok", "voci": [_vv(1, "Stocks Plunge")] + [_vv(2 + k, f"AAA propria {k}") for k in range(8)],
                    "copre_da": _ora494 - _td494(hours=9), "lette": 9},
            "BBB": {"stato": "ok", "voci": [_vv(1, "stocks plunge ")], "copre_da": None, "lette": 15},
            "CCC": {"stato": "HTTP 429", "voci": []}, "DDD": {"stato": "ok", "voci": [], "copre_da": None, "lette": 0}}
_rn494 = "\n".join(ROT.righe_notizie("NOTIZIE ULTIMISSIME — PROVA", {"AAA": ["x"], "BBB": ["y"], "CCC": ["z"],
                                                                     "DDD": ["w"], "EEE": ["v"]}, _news494,
                                     altrove={"EEE": "CANDIDATI"}))
check("v494 la resa delle notizie: la STESSA voce nel feed di piu' nomi e' cronaca di mercato, scritta una volta in "
      "fondo (v451); le voci proprie per nome, quelle oltre il tetto CONTATE (v393); feed non letto e nessuna voce "
      "DIVERSI (v389); la copertura del feed dichiarata; chi ha le notizie altrove lo dice",
      _rn494.count("Stocks Plunge") == 1 and "(nel feed di AAA, BBB)" in _rn494 and "[AAA] " in _rn494
      and "… e altre 2 voci nelle stesse ore, non mostrate" in _rn494 and "+ 1 voce di cronaca di mercato" in _rn494
      and "nessuna voce propria: le 1 del feed sono cronaca di mercato" in _rn494
      and "feed NON letto (HTTP 429)" in _rn494 and "feed letto, nessuna voce nelle ultime 72 ore" in _rn494
      and "arriva solo fino al" in _rn494 and "notizie: nel blocco CANDIDATI" in _rn494
      and ROT.righe_notizie("T", {}, {}) == ["T: nessun nome con un segnale in questo giro"], _rn494)

# --- collegamenti: eseguiti dove si puo', letti dove la rete serve (v399, v483) ---
_racc494 = _corpo_di(_src_rot473, "raccogli")
_ciclo494 = _racc494[_racc494.find("for t in watch + cand:"):_racc494.find("# v474 — il piano per la liquidita'")]
check("v494 collegamento: la raccolta calcola la struttura per sorvegliati e candidati, sulle stesse barre lunghe dei "
      "pavimenti, e il comando stampa le notizie dei sorvegliati con un ingresso possibile",
      't["struttura"] = struttura(BL.get(t["tk"]), t.get("px"), t.get("atr"), veicolo=t["veicolo"])' in _ciclo494
      and "segnali_watchlist(o)" in _src_rot473.split("if __name__")[-1]
      and "righe_notizie(" in _src_rot473.split("if __name__")[-1])
_ti494r = "\n".join(ROT.righe_ingresso(_w473("STRU", struttura=_rib494)))
_ti494n = "\n".join(ROT.righe_ingresso(_w473("NOST")))
check("v494 collegamento ESEGUITO: la riga di un sorvegliato porta la struttura quando c'e', e tace quando non e' "
      "calcolata; l'intestazione della watchlist la dichiara una volta",
      "struttura delle oscillazioni (ultimo anno" in _ti494r and "struttura delle oscillazioni" not in _ti494n
      and ROT.INTESTAZIONE_STRUTTURA in _tw473, _ti494r[-900:])
_oc494 = {**_ocand, "settori": [{**_ocand["settori"][0], "titoli": [dict(_ocand["settori"][0]["titoli"][0],
                                                                          struttura=_dmr494)]}]}
check("v494 collegamento ESEGUITO: anche i candidati di settore portano la struttura",
      "ROTTA AL RIBASSO" in "\n".join(ROT.righe_candidati(_oc494, {"AAA": {"stato": "ok", "voci": []}})))
_calc494 = _corpo_di(Path(__file__).with_name("numeri_libro.py").read_text(), "calcola")
check("v494 collegamento: calcola passa la struttura alla tenuta, e i segnali con le loro notizie al risultato",
      "rotazione.struttura(BL.get(t)" in _calc494 and "struttura=strutt" in _calc494
      and 'out["segnali"] = segnali_libro(out["tenuta"], out["ordini"])' in _calc494
      and 'rotazione.notizie_recenti(list(out["segnali"])' in _calc494)
check("v494 collegamento ESEGUITO: valuta_ordini da' a ogni ordine la sua struttura (un ordine e' un ingresso), e la "
      "resa degli ordini la stampa",
      "struttura" in _vo492 and "struttura delle oscillazioni" in "\n".join(
          NL.righe_ordini({"righe": [dict(_vo492, struttura=_rib494)], "insieme": None, "inattivi": []})))
_tm494 = NL.tenuta_posizioni(["AAA"], {"AAA": _b489["AAA"]}, {}, _sem481(), {"AAA": 100.0}, {"AAA": 50.0}, {"AAA": 10},
                             {"AAA": 1.0}, _ny489, struttura={"AAA": _dmr494})
_rtm494 = "\n".join(NL.righe_tenuta(_tm494))
_rtm494n = "\n".join(NL.righe_tenuta(NL.tenuta_posizioni(["AAA"], {"AAA": _b489["AAA"]}, {}, _sem481(), {"AAA": 100.0},
                                                         {"AAA": 50.0}, {"AAA": 10}, {"AAA": 1.0}, _ny489)))
check("v494 collegamento ESEGUITO: la tenuta porta la struttura di ogni posizione e la dichiara informazione, non prova "
      "e non vendita; senza struttura calcolata non dice niente",
      "ROTTA AL RIBASSO" in _rtm494 and "non una prova in piu' (B3) — e non vende" in _rtm494
      and "struttura delle oscillazioni" not in _rtm494n, _rtm494[:1200])
_sint494 = NL.sintesi({**_o483, "segnali": {"AAA": ["tenuta: IN OSSERVAZIONE"]},
                       "notizie": {"AAA": {"stato": "ok", "voci": [_vv(3, "AAA wins a contract")], "copre_da": None,
                                           "lette": 15}}})
check("v494 collegamento ESEGUITO: la sintesi stampa il blocco delle ultimissime notizie con il perche' di ogni nome",
      "NOTIZIE ULTIMISSIME — POSIZIONI CON UN PARAMETRO D'USCITA ACCESO" in _sint494
      and "AAA — tenuta: IN OSSERVAZIONE" in _sint494 and "AAA wins a contract" in _sint494
      and "NOTIZIE ULTIMISSIME" not in NL.sintesi(_o483), _sint494[-600:])

# --- le soglie stanno nel libro e il codice le rilegge (v474: un numero, un posto) ---
_lib494 = (Path(__file__).resolve().parent.parent / "memoria" / "LIBRO.md").read_text(encoding="utf-8")
_sez494 = _lib494[_lib494.find("**Massimi e minimi: la STRUTTURA DELLE OSCILLAZIONI**"):_lib494.find("## 1ter")]
_m494 = {"anno": re.search(r"nell'\*\*ultimo anno\*\*", _sez494), "mostra": re.search(r"Si mostrano gli \*\*ultimi (\d+)\*\*", _sez494),
         "rsi": re.search(r"almeno \*\*(\d+) punti\*\* di RSI", _sez494), "vol": re.search(r"le ultime (\d+) concluse", _sez494),
         "vicino": re.search(r"entro \*\*(\d+) ATR\*\* dal prezzo", _sez494),
         "recente": re.search(r"da non più di \*\*(\d+) sedute\*\*", _sez494), "ore": re.search(r"ultime \*\*(\d+) ore\*\*", _sez494),
         "lato": re.search(r"(\d+) sedute prima e (\d+) dopo", _sez494)}
check("v494 le soglie della struttura si rileggono da LIBRO.md §1bis e coincidono col codice: un anno, 3 punti per verso, "
      "3 punti di RSI, 20 sedute, 1 ATR, 10 sedute, 72 ore, 5 sedute per lato, alla pari entro mezzo ATR",
      all(_m494.values()) and ROT.ANNI_STRUTTURA == 1 and int(_m494["mostra"].group(1)) == ROT.STR_MOSTRA
      and int(_m494["rsi"].group(1)) == ROT.STR_RSI and int(_m494["vol"].group(1)) == ROT.STR_VOLUMI
      and int(_m494["vicino"].group(1)) == ROT.VICINO_ATR and int(_m494["recente"].group(1)) == ROT.STR_RECENTE
      and int(_m494["ore"].group(1)) == ROT.NOTIZIE_ORE
      and int(_m494["lato"].group(1)) == int(_m494["lato"].group(2)) == ROT.PAV_LATO
      and "entro mezzo ATR" in _sez494 and ROT.PAV_LARGHEZZA_ATR == 0.5 and "massimi e minimi decrescenti" in _sez494,
      str({k: (v.group(0) if v else None) for k, v in _m494.items()}))
_fmt494 = (Path(__file__).resolve().parent.parent / "memoria" / "FORMATO_ANALISI.md").read_text(encoding="utf-8")
check("v494 FORMATO_ANALISI: la struttura e le ultimissime notizie nella sezione 6 e negli ingressi (7d-quinquies), e la "
      "richiesta nel registro del 17/10",
      "7d-quinquies. **la STRUTTURA e le ULTIMISSIME NOTIZIE**" in _fmt494 and "**STRUTTURA DELLE OSCILLAZIONI**" in _fmt494
      and "NOTIZIE ULTIMISSIME** di `numeri_libro.py`" in _fmt494
      and "e le ultimissime notizie dei nomi con un ingresso possibile o un'uscita accesa (17/10)" in _fmt494)

# ================================================================ v495 — la struttura e' «solo informazione»
# Decisione del CEO del 17/10/2026, alla domanda se la struttura delle oscillazioni dovesse entrare come prova nel bilancio
# dell'evidenza (LIBRO.md §1sexies), testuale: "solo informazione". La proprieta' che la decisione impone: la riga della
# tenuta — esito, prove, esiti possibili, media, fisco — e' la STESSA con qualunque struttura accanto, o senza. La
# struttura e' la famiglia del prezzo, la stessa della tendenza: contarla accanto alla tendenza sarebbe il prezzo che parla
# due volte (B3). Le strutture si costruiscono nei tre versi che contano — ribassista, rotta al ribasso, rialzista — e i
# nomi coprono i tre esiti del bilancio, perche' un gate che guarda un esito solo non vede gli altri (v419, v420).
_tk495 = ["BBB", "CCC", "AAA", "DDD", "EEE"]
def _tn495(st):
    return NL.tenuta_posizioni(_tk495, _bt481, _rt481, _sem481(), _px481, {**{k: 50.0 for k in _bt481}, "EEE": 120.0},
                               {k: 10 for k in _bt481}, {"AAA": 0.1, "BBB": 0.2, "CCC": 0.4, "DDD": 0.2, "EEE": 0.1},
                               _ALLE17, _dec481, {"fx": 1.12, "valore": 5000.0, "rlibro": {}, "rqqq": {}, "rend": {},
                                                  "trim": {"EEE": 5}},
                               struttura=None if st is None else {k: st for k in _tk495})
_senza495 = lambda tn: _json.dumps([{k: v for k, v in r.items() if k != "struttura"} for r in tn["righe"]],
                                   sort_keys=True, default=str)
_ril495 = _st494([80, 90, 84, 94, 88, 98, 92, 96])
_var495 = {n: _tn495(st) for n, st in (("senza", None), ("ribassista", _rib494), ("rotta", _dmr494), ("rialzista", _ril495))}
check("v495 la struttura e' «solo informazione» (CEO, 17/10): esito, prove e il resto della riga della tenuta sono gli "
      "stessi con una struttura ribassista, rotta al ribasso, rialzista o assente — e la struttura c'e' davvero accanto",
      _rib494["stato"] == "RIBASSISTA" and _dmr494["rottura"] == "ribasso" and _ril495["stato"] == "RIALZISTA"
      and all(_senza495(v) == _senza495(_var495["senza"]) for v in _var495.values())
      and all("struttura" in r for n, v in _var495.items() if n != "senza" for r in v["righe"])
      and {r["esito"] for r in _var495["senza"]["righe"]} >= {"VENDITA PER EVIDENZA", NL.CONFLITTO, "LASCIAR CORRERE"},
      str({n: [(r["tk"], r["esito"]) for r in v["righe"]] for n, v in _var495.items()}))

# ============================== v496 — POSIZIONAMENTO: PUT E CALL, SCADENZE, GRANDI OPERATORI, BITCOIN ==============================
# Il CEO, 17/10/2026: «Effettua anche analisi su put e call e sui grandi movimenti che vengono effettuati il week end … Rendi
# sempre tutto strutturale»; alla domanda su quali movimenti: «Scadenza delle opzioni, Posizioni dei grandi operatori, Bitcoin
# nel weekend». E: «Recupera altrove dati variazione annua della leva». Lo stato si COSTRUISCE (v425, v429): nessuna rete.
import posizionamento as PZ
import urllib.error as _ue496
from datetime import date as _d496, datetime as _dt496, timedelta as _td496


def _opz496(tk, scad, tipo, strike, oi, vol, bid, ask, ultimo=None):
    return {"option": f"{tk}{scad[2:4]}{scad[5:7]}{scad[8:10]}{tipo}{int(round(strike * 1000)):08d}",
            "open_interest": oi, "volume": vol, "bid": bid, "ask": ask, "last_trade_price": ultimo}


_O496 = []
for _s496 in ("2026-10-16", "2026-10-23", "2026-11-20", "2026-12-18"):
    for _k496 in (90, 95, 100, 105, 110):
        _O496.append(_opz496("XYZ", _s496, "C", _k496, 10, 1, max(0.05, 100 - _k496) + 2.0, max(0.05, 100 - _k496) + 2.2))
        _O496.append(_opz496("XYZ", _s496, "P", _k496, 10, 1, max(0.05, _k496 - 100) + 1.8, max(0.05, _k496 - 100) + 2.0))
# la mensile di novembre: open interest costruito perche' il max pain sia 100 (2500 a 95 e a 105, 1000 a 100)
for _x496 in _O496:
    if "XYZ261120" in _x496["option"]:
        _x496["open_interest"] = {"C00095000": 100, "C00100000": 300, "P00100000": 300, "P00105000": 100}.get(
            _x496["option"][9:], 0)
# i piu' scambiati: la scadenza della seduta (16/10) ha il volume maggiore ma non conta; fuori dal denaro vincono
# call 110 del 23/10 e put 90 del 20/11
for _x496 in _O496:
    _x496["volume"] = {"XYZ261016C00110000": 9000, "XYZ261016P00090000": 9000, "XYZ261023C00110000": 700,
                       "XYZ261120C00105000": 300, "XYZ261120P00090000": 800, "XYZ261023P00095000": 500,
                       "XYZ261023C00090000": 5000}.get(_x496["option"], _x496["volume"])
_O496.append(_opz496("XYZ1", "2026-11-20", "C", 50, 99999, 99999, 50, 51))       # radice rettificata: fuori
# ⚠ una radice di sole LETTERE diversa dal simbolo: la regex la legge, e solo il controllo della radice la toglie (la
#   prima stesura aveva solo XYZ1, che la regex scarta da se': l'iniezione del controllo tolto non mordeva)
_O496.append(_opz496("XYZQ", "2026-11-20", "P", 60, 88888, 88888, 40, 41))
_CAT496 = {"data": {"current_price": 101.0, "close": 100.0, "iv30": 50.0, "last_trade_time": "2026-10-16T15:59:59",
                    "options": _O496}}
_OGGI496 = _d496(2026, 10, 17)
_ct496 = PZ.contratti(_CAT496, "XYZ")
check("v496 la catena CBOE si legge per radice del simbolo: i contratti di un'altra radice (XYZ1, XYZQ) restano fuori, "
      "scadenza, tipo e strike dal simbolo dell'opzione",
      len(_ct496) == 40 and all(c["strike"] not in (50, 60) for c in _ct496)
      and {"scad": "2026-11-20", "tipo": "P", "strike": 105.0} in [{k: c[k] for k in ("scad", "tipo", "strike")} for c in _ct496])
check("v496 il terzo venerdi' del mese, col calendario (ottobre 2026 il 16, novembre il 20, dicembre il 18)",
      [PZ.terzo_venerdi(2026, m) for m in (10, 11, 12)] == [_d496(2026, 10, 16), _d496(2026, 11, 20), _d496(2026, 12, 18)])
_mens496 = PZ.scadenze_mensili(["2026-10-16", "2026-10-23", "2026-11-20", "2026-12-18"], _OGGI496)
check("v496 le scadenze MENSILI si scelgono fra quelle LISTATE, dopo oggi: novembre a 34 giorni, dicembre trimestrale "
      "(«tre streghe»); una scadenza passata e una settimanale no",
      _mens496 == [{"data": "2026-11-20", "trimestrale": False, "giorni": 34},
                   {"data": "2026-12-18", "trimestrale": True, "giorni": 62}], str(_mens496))
_gf496 = PZ.scadenze_mensili(["2025-04-11", "2025-04-17", "2025-04-25", "2025-05-16"], _d496(2025, 4, 1))
_gf496b = PZ.scadenze_mensili(["2025-04-17", "2025-04-18", "2025-05-16"], _d496(2025, 4, 1))
check("v496 col venerdi' festivo (Venerdi' Santo, 18/04/2025) la mensile e' il giovedi' listato; se il venerdi' e' listato "
      "vince il venerdi', e il giovedi' prima e' una scadenza qualunque",
      [m["data"] for m in _gf496] == ["2025-04-17", "2025-05-16"] and [m["data"] for m in _gf496b] == ["2025-04-18", "2025-05-16"])
check("v496 il max pain e' lo strike a cui il valore delle opzioni in scadenza e' MINIMO (qui 100: 1.000 contro 2.500 a 95 "
      "e a 105), fra gli strike plausibili attorno al prezzo",
      PZ.max_pain(_ct496, "2026-11-20", 100.0) == 100 and PZ.max_pain(_ct496, "2026-11-20", 300.0) is None)
_conti496 = lambda q: PZ.scadenza_dei_conti(["2026-10-23", "2026-11-20"], {"data": "2026-10-23", "quando": q}, _OGGI496)
check("v496 la scadenza che comprende i conti: lo stesso giorno solo se escono prima dell'apertura; dopo la chiusura, o "
      "senza ora dichiarata, la successiva (il verso prudente)",
      _conti496("time-pre-market") == "2026-10-23" and _conti496("time-after-hours") == "2026-11-20"
      and _conti496("time-not-supplied") == "2026-11-20" and PZ.scadenza_dei_conti(["2026-10-23"], None, _OGGI496) is None)
_ps496 = PZ.piu_scambiati(_ct496, 100.0, "2026-10-16")
check("v496 le piu' scambiate: solo FUORI dal denaro (call sopra il prezzo, put sotto), esclusa la scadenza della seduta "
      "(9.000 contratti il 16/10 non contano) e in contratti, non in premio (la call 90 del 23/10 e' nel denaro)",
      (_ps496["C"]["strike"], _ps496["C"]["scad"]) == (110.0, "2026-10-23")
      and (_ps496["P"]["strike"], _ps496["P"]["scad"]) == (90.0, "2026-11-20"), str(_ps496))
_rie496 = PZ.riepilogo(_CAT496, "XYZ", _OGGI496, {"data": "2026-10-23", "quando": "time-after-hours"}, in_seduta=False)
_ries496 = PZ.riepilogo(_CAT496, "XYZ", _OGGI496, None, in_seduta=True)
check("v496 il riepilogo: prezzo di CHIUSURA fuori seduta e quello corrente in seduta; la mensile appena scaduta (16/10) che "
      "l'istantanea porta ancora; la quota d'open interest che scade alla mensile; la seduta dei volumi",
      _rie496["spot"] == 100.0 and _ries496["spot"] == 101.0 and _rie496["mensile_scaduta"] == "2026-10-16"
      and _rie496["mensile"]["data"] == "2026-11-20" and abs(_rie496["mensile"]["quota_oi"] - 800 / (800 + 20 * 10) * 100) < 1e-9
      and _rie496["seduta"] == "2026-10-16" and _rie496["scadenza_conti"] == "2026-11-20" and _rie496["distacco_conti"] == 28)
check("v496 put/call dei VOLUMI su tutta la seduta (compresa la scadenza del giorno), dell'OPEN INTEREST sulle sole scadenze "
      "vive",
      abs(_rie496["pc_vol"] - sum(c["vol"] for c in _ct496 if c["tipo"] == "P") / sum(c["vol"] for c in _ct496 if c["tipo"] == "C")) < 1e-12
      and abs(_rie496["pc_oi"] - sum(c["oi"] for c in _ct496 if c["tipo"] == "P" and c["scad"] >= "2026-10-17")
              / sum(c["oi"] for c in _ct496 if c["tipo"] == "C" and c["scad"] >= "2026-10-17")) < 1e-12)

# --- il movimento implicito e' LO STESSO di app.js: le due lingue sulla stessa catena (v161, il contratto v323) ---
_JS496 = r"""
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(process.argv[2], "utf8");
const el = () => ({addEventListener(){}, classList:{add(){},remove(){},toggle(){},contains:()=>false}, style:{}, dataset:{},
  hidden:true, querySelector:()=>el(), querySelectorAll:()=>[], closest:()=>null});
const ctx = {console:{log(){},warn(){},error(){}}, document:{querySelector:()=>el(), querySelectorAll:()=>[],
  getElementById:()=>el(), createElement:()=>el(), addEventListener(){}, body:el()},
  localStorage:{getItem:()=>null, setItem(){}, removeItem(){}}, window:{addEventListener(){}, matchMedia:()=>({matches:false})},
  navigator:{clipboard:{}}, fetch:()=>Promise.reject(new Error("offline")), setInterval:()=>0, clearInterval(){},
  setTimeout:()=>0, clearTimeout(){}, Event:class{}, MutationObserver:class{observe(){}}};
vm.createContext(ctx); vm.runInContext(src, ctx, {filename: "app.js"});
const casi = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
process.stdout.write(JSON.stringify(casi.map(o => vm.runInContext("movimentoImplicito(" + JSON.stringify(o) + ")", ctx))));
"""
def _casojs496(spot, scad):
    cs = [c for c in _ct496 if c["scad"] == scad]
    riga = lambda c: {"strike": c["strike"], "bid": c["bid"], "ask": c["ask"], "iv": 50, "vol": c["vol"], "oi": c["oi"]}
    return {"spot": spot, "expiries": [{"date": scad, "calls": [riga(c) for c in sorted(cs, key=lambda c: c["strike"]) if c["tipo"] == "C"],
                                         "puts": [riga(c) for c in sorted(cs, key=lambda c: c["strike"]) if c["tipo"] == "P"]}]}
_casi496 = [(100.0, "2026-11-20"), (102.5, "2026-11-20"), (97.0, "2026-12-18"), (100.0, "2026-10-23")]
with tempfile.TemporaryDirectory() as _td496d:
    _jsf496, _inf496 = Path(_td496d) / "mi.js", Path(_td496d) / "casi.json"
    _jsf496.write_text(_JS496, encoding="utf-8")
    _inf496.write_text(_json.dumps([_casojs496(s, d) for s, d in _casi496]), encoding="utf-8")
    _rj496 = subprocess.run(["node", str(_jsf496), str(Path(__file__).resolve().parent.parent / "assets" / "app.js"),
                             str(_inf496)], capture_output=True, text=True, timeout=120)
try:
    _js496 = _json.loads(_rj496.stdout)
except ValueError:
    _js496 = None
_py496 = [PZ.movimento_implicito(_ct496, s, d) for s, d in _casi496]
_conf496 = lambda j, p: (j is not None and p is not None and j["scadenze"][0]["strike"] == p["strike"]
                         and abs(j["scadenze"][0]["pct"] - p["pct"]) < 1e-9 and abs(j["scadenze"][0]["straddle"] - p["straddle"]) < 1e-9
                         and (j["scadenze"][0]["putVicino"] or {}).get("strike") == (p["put_vicino"] or {}).get("strike")
                         and (j["scadenze"][0]["callVicino"] or {}).get("strike") == (p["call_vicino"] or {}).get("strike"))
check("v496 il movimento implicito della catena CBOE e' LA STESSA definizione di movimentoImplicito in app.js: stesso strike "
      "(a parita' di distanza il piu' basso), stesso straddle, stessa percentuale, stesso open interest dentro il movimento — "
      "eseguite le due lingue sugli stessi quattro casi",
      _js496 is not None and len(_js496) == 4 and all(_conf496(j, p) for j, p in zip(_js496, _py496)),
      f"js {str(_js496)[:300]} · py {str(_py496)[:300]} · err {_rj496.stderr[-300:]}")

# --- il put/call di mercato: la memoria delle sedute, tre esiti per giorno (v389) ---
_pcj496 = {"ratios": [{"name": "TOTAL PUT/CALL RATIO", "value": "0.92"}, {"name": "EQUITY PUT/CALL RATIO", "value": "0.65"},
                      {"name": "INDEX PUT/CALL RATIO", "value": "1.05"}, {"name": "SPX + SPXW PUT/CALL RATIO", "value": "1.46"},
                      {"name": "CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO", "value": "0.32"}],
           "EQUITY OPTIONS": [{"name": "VOLUME", "call": 3284761, "put": 2130650, "total": 5415411}]}
check("v496 il file CBOE di una seduta: i rapporti PUBBLICATI dalla borsa (non ricalcolati dai volumi: v415) e i volumi "
      "delle azioni",
      PZ.leggi_pc(_pcj496, "2026-10-16") == {"data": "2026-10-16", "totale": 0.92, "azioni": 0.65, "indici": 1.05, "spx": 1.46,
                                             "vix": 0.32, "azioni_put": 2130650, "azioni_call": 3284761})


def _leggi496(url):
    d = url.split("/")[-1][:10]
    if d == "2026-10-15":
        raise _ue496.URLError("rete")
    if d in ("2026-10-16", "2026-09-07"):
        raise _ue496.HTTPError(url, 403, "Forbidden", {}, None)
    return _json.dumps({"ratios": [{"name": "EQUITY PUT/CALL RATIO", "value": "0.60"}]}).encode()


_mem496 = {}
_ag496 = PZ.aggiorna_pc(_OGGI496, _mem496, leggi=_leggi496, paralleli=2)
check("v496 la memoria del put/call: un 403 VECCHIO e' una borsa chiusa e si registra (non si chiede piu'), un 403 di ieri e' "
      "un file non ancora pubblicato e NON si registra, un errore di rete non e' un'assenza e si conta fra le NON lette",
      _mem496.get("2026-09-07") == {"data": "2026-09-07", "assente": 403} and "2026-10-16" not in _mem496
      and "2026-10-15" not in _mem496 and _ag496["non_lette"] == ["2026-10-15"]
      and _ag496["non_ancora_pubblicate"] == ["2026-10-16"] and _mem496.get("2026-10-14", {}).get("azioni") == 0.60
      and "2026-10-17" not in PZ.giorni_mancanti(_OGGI496, {}) and "2026-10-11" not in PZ.giorni_mancanti(_OGGI496, {}),
      str(_ag496))
_memst496 = {f"2026-09-{g:02d}": {"data": f"2026-09-{g:02d}", "azioni": a, "totale": a + 0.3}
             for g, a in zip(range(1, 31), [0.5 + (i % 7) * 0.05 for i in range(30)])}
_memst496["2026-09-15"] = {"data": "2026-09-15", "assente": 403}
_st496 = PZ.stato_pc(_memst496)
_az496 = [r["azioni"] for k, r in sorted(_memst496.items()) if r.get("azioni") is not None]
_me496 = [sum(_az496[i - 9:i + 1]) / 10 for i in range(9, len(_az496))]
check("v496 lo stato del put/call: percentile midrank dell'ultima seduta fra tutte, media di 10 sedute col suo percentile "
      "fra le medie, le assenze fuori dalla distribuzione",
      _st496["n"] == 29 and _st496["rango"] == int(ROT.percentile_midrank(_az496[-1], _az496) + 0.5)
      and abs(_st496["media"] - _me496[-1]) < 1e-12 and _st496["n_medie"] == 20
      and _st496["rango_media"] == int(ROT.percentile_midrank(_me496[-1], _me496) + 0.5), str(_st496)[:300])

# --- la storia per titolo: si registra solo a seduta conclusa, una volta sola ---
_NY496 = PZ.NEW_YORK
_rr496 = {"XYZ": {"seduta": "2026-10-16", "pc_vol": 0.8, "pc_oi": 1.1, "iv30": 50.0}, "VUO": None}
_reg496 = lambda fase, h, m, mem: PZ.registra_titoli(_rr496, mem, fase, _dt496(2026, 10, 16, h, m, tzinfo=_NY496))
_m1, _m2, _m3, _m4 = [], [], [], []
check("v496 la storia delle opzioni per titolo si scrive solo a seduta CONCLUSA — a borsa chiusa o dalle 16:30 di New York "
      "(dati differiti di 15 minuti) — e una volta sola per seduta",
      _reg496("seduta", 14, 0, _m1) == 0 and _reg496("after-hours", 16, 20, _m2) == 0 and _reg496("after-hours", 16, 40, _m3) == 1
      and _reg496("chiuso", 12, 0, _m4) == 1 and _reg496("chiuso", 12, 0, _m4) == 0 and _m4[0]["data"] == "2026-10-16")
_sto496 = [{"data": f"2026-08-{g:02d}", "tk": "XYZ", "pc_vol": 0.5 + g / 100, "pc_oi": 1.0, "iv30": 40 + g} for g in range(1, 26)]
_testo496 = PZ.storia_titolo(_sto496, "XYZ")
check("v496 sotto 20 sedute registrate la storia DICE quante ce ne sono invece di pubblicare un percentile; da 20 il "
      "percentile dell'ultima seduta fra le registrate",
      "in costruzione: 5 sedute registrate" in PZ.storia_titolo(_sto496[:5], "XYZ")
      and "put/call dei volumi al 98° percentile" in _testo496 and "sulle 25 sedute registrate" in _testo496, _testo496)

# --- i grandi operatori (CFTC): per CODICE, la settimana prima per DATA ---
_hdr496 = ("Market_and_Exchange_Names,Report_Date_as_YYYY-MM-DD,CFTC_Contract_Market_Code,Open_Interest_All,"
           "Dealer_Positions_Long_All,Dealer_Positions_Short_All,Asset_Mgr_Positions_Long_All,Asset_Mgr_Positions_Short_All,"
           "Lev_Money_Positions_Long_All,Lev_Money_Positions_Short_All")
_righe496 = [_hdr496,
             "NASDAQ-100 Consolidated - CME,2026-10-13,20974+,1000,100,300,400,100,50,150",
             "NASDAQ-100 Consolidated - CME,2026-09-29,20974+,1000,100,300,400,100,50,250",
             "NASDAQ-100 Consolidated - CME,2026-10-06,20974+,1000,100,300,400,100,50,200",
             "ALTRO MERCATO,2026-10-13,999999,1000,1,1,1,1,1,1"]
_cot496 = PZ.cot_stato(PZ.cot_righe("\n".join(_righe496)))
_nq496 = _cot496["20974+"]["categorie"]["lev"]
check("v496 CFTC: i mercati per CODICE del regolatore; netto = lunghe meno corte in % dell'open interest; la variazione sulla "
      "rilevazione PRECEDENTE PER DATA (le righe arrivano in disordine); un codice assente si dichiara, non sparisce",
      abs(_nq496["pct"] - (-10.0)) < 1e-9 and abs(_nq496["var_pct"] - 5.0) < 1e-9 and _nq496["n"] == 3
      and _nq496["rango"] == int(ROT.percentile_midrank(-10.0, [-20.0, -15.0, -10.0]) + 0.5)
      and _cot496["20974+"]["precedente"] == "2026-10-06" and _cot496.get("13874+", {}).get("assente") is True,
      str(_cot496)[:400])
_rcot496 = "\n".join(PZ.righe_cot(_cot496, ["2023 (URLError)"]))
check("v496 la resa CFTC dichiara la data del MARTEDI' e la pubblicazione del venerdi', gli archivi non letti, il codice non "
      "trovato, la definizione del percentile e la base su Treasury e bitcoin",
      "martedi' 13/10/2026" in _rcot496 and "archivi NON letti: 2023" in _rcot496 and "codice 13874+ NON trovato" in _rcot496
      and "un corto al 100° percentile e' il MENO corto" in _rcot496 and "operazione sulla BASE" in _rcot496, _rcot496[:600])

# --- il bitcoin dall'ultima chiusura USA ---
_cand496 = PZ.candele_btc([[1792008000, 1, 1, 1, 81000.0, 1], [1792004400, 1, 1, 1, 80000.0, 1], ["x"]])
_camp496 = _dt496(2026, 10, 16, 16, 0, tzinfo=_NY496)          # 20:00 UTC: candela che inizia alle 19:00 UTC
_cand496b = PZ.candele_btc([[int(_camp496.timestamp()) - 3600, 1, 1, 1, 80000.0, 1],
                            [int(_camp496.timestamp()), 1, 1, 1, 80500.0, 1],
                            [int(_camp496.timestamp()) + 60 * 3600, 1, 1, 1, 84000.0, 1]])
check("v496 le candele del bitcoin in ordine di tempo; il prezzo alla campana e' la chiusura della candela che FINISCE alle "
      "16:00 di New York, e una candela mancante e' un buco, non la vicina (v207)",
      [c["t"] for c in _cand496] == [1792004400, 1792008000] and PZ.prezzo_alle(_cand496b, _camp496) == 80000.0
      and PZ.prezzo_alle(_cand496b, _camp496 + _td496(hours=5)) is None)
_bsab496 = _barre474([100.0] * 5, fine="2026-10-16")
_bgio496 = _barre474([100.0] * 5, fine="2026-10-15") + [{"t": "2026-10-16", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
check("v496 l'ultima chiusura USA CONCLUSA: di sabato e' venerdi' alle 16:00 di New York; durante la seduta e' quella di ieri",
      PZ.ultima_chiusura_usa(_bsab496, _dt496(2026, 10, 17, 9, 0, tzinfo=_NY496)) == (_d496(2026, 10, 16), _camp496)
      and PZ.ultima_chiusura_usa(_bgio496, _dt496(2026, 10, 16, 11, 0, tzinfo=_NY496))[0] == _d496(2026, 10, 15))
_ib496 = [100.0]
for _i496 in range(120):
    _ib496.append(_ib496[-1] * (1 + (0.02 if _i496 % 3 == 0 else -0.01)))
_ms496 = [50.0]
for _a496, _b496 in zip(_ib496, _ib496[1:]):
    _ms496.append(_ms496[-1] * math.exp(2 * math.log(_b496 / _a496)))
_btc496 = PZ.bitcoin(_cand496b, _barre474(_ms496, fine="2026-10-16"), _barre474(_ib496, fine="2026-10-16"), 100,
                     _dt496(2026, 10, 19, 6, 0, tzinfo=_NY496))
check("v496 MSTR sul bitcoin: beta e R² MISURATI su IBIT per data (qui costruiti a 2 e 1), il movimento del bitcoin dalla "
      "campana di venerdi' ad adesso, il livello delle 17:00 (future CME) e l'equivalente in dollari sulla posizione",
      _btc496 is not None and abs(_btc496["beta"] - 2.0) < 1e-9 and abs(_btc496["r2"] - 1.0) < 1e-9
      and abs(_btc496["var"] - 5.0) < 1e-9 and _btc496["venerdi"] and _btc496["cme"] == 80500.0
      and abs(_btc496["mstr_equivalente"] - 10.0) < 1e-9
      and abs(_btc496["dollari"] - 0.10 * _ms496[-1] * 100) < 1e-6, str(_btc496)[:400])
_rbtc496 = "\n".join(PZ.righe_btc(_btc496))
check("v496 la resa del bitcoin dice che e' un conto su una relazione misurata, non una previsione dell'apertura, e che il "
      "salto del future CME e' una convenzione di lettura",
      "NON una previsione dell'apertura" in _rbtc496 and "convenzione di lettura" in _rbtc496 and "R² 1,00" in _rbtc496, _rbtc496)

# --- i tre esiti delle rese: senza dati si dice, non si salta (v389) ---
check("v496 senza dati ogni blocco lo DICHIARA: put/call, CFTC, bitcoin, catene, scadenze",
      "NON DISPONIBILE" in "\n".join(PZ.righe_pc(None, {"non_lette": []}))
      and "NON DISPONIBILE" in "\n".join(PZ.righe_cot({}, []))
      and "NON DISPONIBILE: rete giu'" in "\n".join(PZ.righe_btc(None, "rete giu'"))
      and "catena NON letta" in "\n".join(PZ.righe_opzioni({"XYZ": None}, {"XYZ": 10}))
      and "NON DISPONIBILE" in "\n".join(PZ.righe_scadenze({}, _OGGI496)))
_rop496 = "\n".join(PZ.righe_opzioni({"XYZ": _rie496}, {"XYZ": 10}, {"XYZ": "storia delle opzioni in costruzione: 1 seduta registrata"}))
check("v496 la resa delle opzioni: la seduta dei volumi, il movimento implicito fino ai conti col distacco dichiarato quando la "
      "scadenza listata cade oltre una settimana dopo, le piu' scambiate col verso dichiarato ignoto, la storia",
      "seduta del 16/10/2026" in _rop496 and "cade 28 giorni dopo i conti" in _rop496
      and "il verso, comprate o vendute, non e' nei dati" in _rop496 and "1 seduta registrata" in _rop496
      and "volatilita' implicita a 30 giorni 50,0%" in _rop496 and "punti)" not in _rop496.split("XYZ —")[1].split("\n")[0], _rop496[:900])
_rsc496 = "\n".join(PZ.righe_scadenze({"SPY": _rie496}, _OGGI496))
check("v496 la resa delle scadenze: la mensile appena SCADUTA, la prossima mensile e la trimestrale coi giorni",
      "la mensile del 16/10/2026 e' SCADUTA" in _rsc496 and "prossima mensile: 20/11/2026 (fra 34 giorni)" in _rsc496
      and "prossima trimestrale: 18/12/2026 (fra 62 giorni)" in _rsc496, _rsc496)
check("v496 il segno non resta su un movimento che si arrotonda a zero («-0,0%» si legge come un calo)",
      PZ._sg(-0.04) == "0,0" and PZ._sg(0.04) == "0,0" and PZ._sg(0.06) == "+0,1" and PZ._sg(None) == "n.d.")

# --- i collegamenti: il comando unico, il formato, le memorie ---
_cm496 = {f: [a for _, a in AN.comandi(f)] for f in ("pre-market", "seduta", "after-hours", "chiuso")}
check("v496 il comando unico esegue posizionamento.py in ogni fase, e lo dichiara fra gli strumenti",
      all(["posizionamento.py"] in v for v in _cm496.values()) and "posizionamento.py" in AN.STRUMENTI)
_tm496, _ = AN.resa([], "## Cosa contiene la risposta\nx", memorie_cambiate=[AN.MEMORIE[0]])
_tn496, _ = AN.resa([], "## Cosa contiene la risposta\nx", memorie_cambiate=[])
check("v496 se le memorie del posizionamento cambiano il comando lo DICE (vanno committate col registro), altrimenti tace; e "
      "main le confronta prima e dopo il giro",
      "MEMORIA AGGIORNATA: memoria/cboe_putcall.jsonl" in _tm496 and "MEMORIA AGGIORNATA" not in _tn496
      and "memorie_cambiate=[p for p in MEMORIE if impronta(p) != prima_mem[p]]"
      in _corpo_di(Path(__file__).with_name("analisi.py").read_text(), "main"))
_fa496 = (Path(__file__).resolve().parent.parent / "memoria" / "FORMATO_ANALISI.md").read_text(encoding="utf-8")
_cl496 = AN.checklist() or ""
check("v496 il formato porta la sezione 5bis del posizionamento — informazione, non prove — e la richiesta del 17/10 nel registro "
      "delle richieste rese strutturali; la checklist la stampa",
      "5bis. **Posizionamento**" in _cl496 and "È tutto INFORMAZIONE" in _cl496 and "grandi operatori (CFTC)" in _cl496
      and "variazione\nannua della leva" in _fa496 and "un'uscita accesa (17/10)" in _fa496)
check("v496 il posizionamento e' dichiarato nel censimento di /aggiorna con la sua ragione (v387)",
      "`scripts/posizionamento.py` resta **fuori**" in (Path(__file__).resolve().parent.parent / ".claude" / "commands" / "aggiorna.md")
      .read_text(encoding="utf-8"))
_main496 = _corpo_di(Path(__file__).with_name("posizionamento.py").read_text(), "main")
check("v496 collegamento in main: le catene delle posizioni E di SPY e QQQ, quattro archivi CFTC, le candele del bitcoin, MSTR "
      "e IBIT, il calendario dei conti; le memorie scritte solo senza --no-memoria",
      'simboli = sorted(qta) + ["SPY", "QQQ"]' in _main496 and "range(ANNI_COT + 1)" in _main496
      and 'brief.barre, "IBIT"' in _main496 and "brief.calendario_trimestrali" in _main496
      and "if not a.no_memoria:\n        scrivi_memoria_pc(memoria)" in _main496 and "righe_opzioni(rie, qta, storia)" in _main496)

# --- la leva: la variazione annua accanto al semaforo, per data ---
_lv496 = NL.famiglia_leva({"storia": [["2026-08-01", 1453832], ["2026-09-01", 1480054]], "yoy": 31.4, "yoy_rango": 82,
                           "yoy_campione": {"n": 345, "dal": "1998-01-01", "al": "2026-09-01"},
                           "yoy_max": {"value": 80.5, "date": "2000-03-01"}, "history": [9, 1]})
check("v496 leva: il mese prima si cerca per DATA nello storico datato (la lista posizionale direbbe un calo che non c'e'), "
      "e un mese mancante e' non misurabile",
      _lv496["stato"] == "spento" and abs(_lv496["var_mese"] - (1480054 / 1453832 - 1)) < 1e-12
      and NL.famiglia_leva({"storia": [["2026-07-01", 1], ["2026-09-01", 2]]})["stato"] == "non misurabile"
      and NL.famiglia_leva({"history": [100, 102], "date": "2026-08-01"})["stato"] == "spento")
check("v496 leva: la variazione annua col suo percentile e il massimo storico, dichiarata contesto e non colore; senza lo "
      "storico FINRA il buco si dice",
      NL.resa_anno_leva(_lv496) == ("sull'anno +31,4% (82° percentile delle 345 variazioni annue da gennaio 1998; massimo "
                                    "+80,5% a marzo 2000) — contesto, non entra nel colore")
      and "NON calcolabile" in NL.resa_anno_leva(NL.famiglia_leva({"history": [1, 2]})))
_seg496 = {**_seg474, "margin": {"storia": [["2026-08-01", 1453832], ["2026-09-01", 1480054]], "yoy": 31.4, "yoy_rango": 82,
                                 "yoy_campione": {"n": 345, "dal": "1998-01-01", "al": "2026-09-01"}}}
_sm496 = NL.semaforo(_barre474(_sale), {k: _barre474(_sale, vol=_alto) for k in NL.LEADER}, _seg496, _ALLE17)
_sm496["reazioni"] = _rz
_rl496 = [r for r in NL.righe_semaforo(_sm496, None) if r.strip().startswith("leva:")]
check("v496 collegamento: la riga della leva nel semaforo porta la variazione annua col percentile",
      len(_rl496) == 1 and "sull'anno +31,4% (82° percentile delle 345" in _rl496[0] and "settembre 2026" in _rl496[0], str(_rl496))

_T = len(ESEGUITI)
print(f"\n{'TUTTI I ' + str(_T - len(FALLITI)) + f'/{_T} CHECK OK' if not FALLITI else str(len(FALLITI)) + f'/{_T} FALLITI: ' + ', '.join(FALLITI)}")
sys.exit(1 if FALLITI else 0)
