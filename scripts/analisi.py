#!/usr/bin/env python3
"""«Analisi» e «Aggiorna analisi» del CEO in UN comando — v473.

Uso:  python3 scripts/analisi.py [--sedute N]

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Il 09/10/2026 alle 20:22 un «Aggiorna analisi» e' uscito SENZA la sezione 7 (watchlist e
rotazione), che il CEO aveva chiesto di avere sempre. Gli strumenti c'erano: li avevo lanciati a
mano, in processi separati, e un pezzo e' rimasto fuori dalla risposta. Il CEO: "Quando ti dico
aggiorna analisi devi darmi tutte le informazioni che ti ho chiesto di rendere strutturali".
Un difetto di metodo ripetuto non si corregge con l'attenzione: si corregge cambiando lo
strumento perche' non lo accetti piu'. Questo comando:
  · esegue in parallelo TUTTI gli strumenti dell'analisi giornaliera; un gate verifica nei due
    versi che siano esattamente quelli nominati in memoria/FORMATO_ANALISI.md (v387);
  · sceglie da solo pre-market, seduta, after-hours o chiusura dall'ora di New York, col FUSO,
    mai con uno scarto scritto a mano (v470). Le festivita' USA non le conosce: in quei giorni
    legge "seduta" e numeri_libro dichiara da se' quale barra usa;
  · stampa le uscite e, IN FONDO, la CHECKLIST delle sezioni che la risposta deve contenere,
    copiata da FORMATO_ANALISI.md e non riscritta qui (una grandezza, un proprietario: v436):
    sta sotto gli occhi nel momento in cui la risposta si scrive;
  · se uno strumento fallisce lo DICHIARA con l'errore e esce 1: un guasto descritto vale piu'
    di una sezione che manca in silenzio (v453).
Non giudica e non riassume: esegue e mette in fila (v448). L'uscita di ogni strumento passa da
un file su disco, non da una pipe che puo' troncarla (v443).

v474 — il giro principale di numeri_libro porta --registra: fuori dalla seduta scrive la riga della
seduta conclusa nel registro della performance contro QQQ (decisione del CEO del 09/10/2026). Il
registro vive nel repo: se il file cambia, il comando lo DICE in fondo, perche' una riga non
committata resta solo in questa sessione e il confronto con l'indice perde un giorno.

v499 — uno strumento in piu', indici.py (S&P 500 e Nasdaq-100: P/E con la storia della sua fonte, stagione delle
trimestrali, volatilita' implicita, concentrazione, ampiezza, tendenza), e due memorie in piu': il dark pool di
posizionamento.py e la storia raccolta del P/E del Nasdaq-100 di indici.py (decisione del CEO del 17/10/2026, sera).

v503 — concorrenti.py: i concorrenti di ogni posizione con le quote di mercato (dal registro, con fonte e data) e la
salute misurata con le stesse formule per tutti; la sua memoria delle letture (memoria/concorrenti_dati.json) va
committata come le altre (CEO, 18/10/2026).

v505 — LA SCHEDA COMPLETA (decisione del CEO del 19/10/2026, «B»): a ogni giro scripts/scheda.py raccoglie le uscite di
tutti gli strumenti, parola per parola, per sezione della risposta e per nome, con l'indice delle richieste del CEO e
quanti nomi portano ciascuna, e la scrive in memoria/dati/ (ignorata da git). Si manda al CEO come allegato; la risposta
in chat porta decisioni e giudizio. Il 19/10 la risposta aveva portato 16 richieste su 43 per intero: gli strumenti le
avevano calcolate tutte, e si perdevano nel riassunto. Una richiesta senza righe oggi fa uscire 1, come uno strumento
fallito: un buco descritto vale piu' di una sezione che manca in silenzio (v453).
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import scheda

RADICE = Path(__file__).resolve().parent.parent
FORMATO = RADICE / "memoria" / "FORMATO_ANALISI.md"
TITOLO_CHECKLIST = "## Cosa contiene la risposta"
TITOLO_REGOLE = "## Regole"
NEW_YORK = ZoneInfo("America/New_York")
ROMA = ZoneInfo("Europe/Rome")
STRUMENTI = ("fonti_dirette.py", "numeri_libro.py", "brief.py", "schede_progetto.py", "rotazione.py", "posizionamento.py",
             "indici.py", "concorrenti.py")
# v511 — fonti_dirette.py gira PRIMA degli altri, da solo: scrive la lettura alla fonte del giro che gli altri riusano
#   (una lettura per analisi, la stessa osservazione per tutti), e stampa il blocco FRESCHEZZA DEI DATI
PRIMA = ("fonti_dirette.py",)
REGISTRO = RADICE / "memoria" / "registro_performance.jsonl"
# v496 — le memorie che posizionamento.py costruisce: come il registro, vivono nel repo e vanno committate
# v499 — e il dark pool (posizionamento.py) e la storia del P/E del Nasdaq-100 (indici.py): stesse ragioni
MEMORIE = (RADICE / "memoria" / "cboe_putcall.jsonl", RADICE / "memoria" / "opzioni_titoli.jsonl",
           RADICE / "memoria" / "dark_pool.jsonl", RADICE / "memoria" / "indici.jsonl",
           RADICE / "memoria" / "concorrenti_dati.json")
LIMITE_SECONDI = 600


def fase(adesso=None):
    """pre-market · seduta · after-hours · chiuso (fine settimana), dall'ora di New York."""
    ny = (adesso or datetime.now(NEW_YORK)).astimezone(NEW_YORK)
    if ny.weekday() >= 5:
        return "chiuso"
    minuti = ny.hour * 60 + ny.minute
    if minuti < 9 * 60 + 30:
        return "pre-market"
    return "seduta" if minuti < 16 * 60 else "after-hours"


def comandi(f, sedute=1):
    """(etichetta, argomenti) di ogni strumento, nell'ordine in cui la risposta li usa.
    Fuori dalla seduta numeri_libro gira due volte: l'ultima seduta E il prezzo esteso
    (istruzione del CEO del 06/10: prima dell'apertura l'analisi parte dal pre-market)."""
    c = [("FRESCHEZZA DEI DATI — le serie macro lette alla fonte adesso, la pipeline come ripiego e la sua eta'",
          ["fonti_dirette.py"])]
    if f == "pre-market":
        c.append(("PRE-MARKET — il libro sul prezzo esteso (volumi sottili: e' un'indicazione)",
                  ["numeri_libro.py", "--esteso"]))
    c.append((f"NUMERI DEL LIBRO — semaforo, {'ultima seduta' if sedute == 1 else f'ultime {sedute} sedute'}, "
              "registro contro QQQ, decisioni aperte",
              ["numeri_libro.py", "--sedute", str(sedute), "--registra"]))
    if f == "after-hours":
        c.append(("AFTER-HOURS — il libro sul prezzo esteso dopo la chiusura", ["numeri_libro.py", "--esteso"]))
    c.append(("BRIEF — notizie, mossi in ATR, macro, aste del Tesoro",
              ["brief.py"] + (["--pomeriggio"] if f in ("seduta", "after-hours") else [])))
    c.append(("SCHEDE DEL PROGETTO — canali col loro R², revisioni, cassa, short, depositi SEC",
              ["schede_progetto.py"]))
    c.append(("ROTAZIONE, CANDIDATI PER SETTORE E WATCHLIST CON GLI INGRESSI", ["rotazione.py"]))
    c.append(("POSIZIONAMENTO — put/call, scadenze delle opzioni, gamma dei dealer, dark pool, grandi operatori (CFTC), "
              "bitcoin dall'ultima chiusura USA", ["posizionamento.py"]))
    c.append(("INDICI — S&P 500 e Nasdaq-100: P/E con la storia della sua fonte, stagione delle trimestrali, volatilita', "
              "concentrazione, ampiezza, tendenza", ["indici.py"]))
    c.append(("CONCORRENTI E QUOTE DI MERCATO — chi sono, quanta parte del mercato hanno (fonte e data), e la salute "
              "con le stesse formule per tutti", ["concorrenti.py"]))
    return c


def esegui_uno(etichetta, argv, cartella, n):
    """Un comando, con l'uscita su file. Restituisce l'esito senza mai sollevare: un'eccezione qui
    porterebbe via anche gli altri blocchi."""
    out, err = Path(cartella) / f"{n}.out", Path(cartella) / f"{n}.err"
    t0 = time.time()
    try:
        with open(out, "w") as fo, open(err, "w") as fe:
            codice = subprocess.run(argv, stdout=fo, stderr=fe, cwd=RADICE, timeout=LIMITE_SECONDI).returncode
    except subprocess.TimeoutExpired:
        codice = f"oltre {LIMITE_SECONDI} s"
    except OSError as e:
        codice = f"non avviato ({e})"
    return {"etichetta": etichetta, "argv": argv, "codice": codice, "secondi": round(time.time() - t0),
            "uscita": out.read_text(errors="replace") if out.exists() else "",
            "errore": err.read_text(errors="replace") if err.exists() else ""}


def esegui(lista):
    """lista: (etichetta, argv completo). In parallelo, nell'ordine dato."""
    with tempfile.TemporaryDirectory() as cartella:
        with ThreadPoolExecutor(len(lista) or 1) as ex:
            return list(ex.map(lambda x: esegui_uno(x[1][0], x[1][1], cartella, x[0]), enumerate(lista)))


def sezione(testo, titolo):
    i = testo.find(titolo)
    if i < 0:
        return None
    j = testo.find("\n## ", i + 1)
    return testo[i:j if j > 0 else len(testo)].strip()


def checklist(percorso=FORMATO):
    """Le sezioni «Cosa contiene la risposta» e «Regole» di FORMATO_ANALISI.md, parola per parola.
    Senza la prima non si ripiega su un elenco scritto qui: si dichiara, e il comando esce 1."""
    try:
        testo = Path(percorso).read_text(encoding="utf-8")
    except OSError:
        return None
    cl = sezione(testo, TITOLO_CHECKLIST)
    if cl is None:
        return None
    regole = sezione(testo, TITOLO_REGOLE)
    return cl + "\n\n" + (regole or f"⚠ '{TITOLO_REGOLE}' non trovata in {percorso}: le regole della risposta non si leggono")


def impronta(percorso=REGISTRO):
    """L'impronta del file, o None se non c'e': serve solo a sapere se il giro l'ha cambiato."""
    try:
        return hashlib.sha256(Path(percorso).read_bytes()).hexdigest()
    except OSError:
        return None


def scrivi_scheda(esiti, f, adesso, percorso=None):
    """v505 — la scheda completa del giro: (righe del riepilogo, codice, percorso). Non solleva mai: una scheda non
    scritta si DICHIARA ed esce 1, e gli strumenti del giro restano stampati sopra."""
    roma = adesso.astimezone(ROMA)
    try:
        testo, cop, r, _ = scheda.genera(esiti, fase=f, quando=f"{roma:%d/%m/%Y %H:%M} ora italiana")
        percorso = Path(percorso) if percorso else scheda.percorso_del_giorno(roma)
        percorso.parent.mkdir(parents=True, exist_ok=True)
        percorso.write_text(testo, encoding="utf-8")
        righe, codice = scheda.sommario(cop, r, percorso)
        return righe, codice, percorso
    except Exception as e:                                        # un guasto descritto, mai uno muto
        return [f"⚠ SCHEDA COMPLETA NON SCRITTA: {type(e).__name__}: {e} — dichiararlo in cima alla risposta"], 1, None


def resa(esiti, cl, intestazione="", registro_cambiato=False, memorie_cambiate=(), scheda_righe=None, scheda_codice=0):
    L = [intestazione] if intestazione else []
    falliti = []
    for k, e in enumerate(esiti, 1):
        comando = "python3 scripts/" + " ".join(str(a) for a in e["argv"][1:]).replace(str(RADICE / "scripts") + "/", "")
        L.append("")
        L.append(f"════════ {k}/{len(esiti)} {e['etichetta']} — {comando} · uscita {e['codice']} · {e['secondi']} s ════════")
        if e["codice"] != 0:
            falliti.append(e)
            L.append(f"⚠ STRUMENTO FALLITO (uscita {e['codice']}): le sezioni che ne dipendono si scrivono NON "
                     "DISPONIBILI, con questo errore — non si saltano")
            L.extend("   " + r for r in (e["errore"].strip().splitlines() or ["(nessun messaggio d'errore)"])[-15:])
        L.append(e["uscita"].rstrip())
    if scheda_righe:
        L.append("")
        L.append("════════ SCHEDA COMPLETA — scripts/scheda.py: tutte le uscite, per sezione e per nome ════════")
        L.extend(scheda_righe)
    L.append("")
    L.append("════════ CHECKLIST DELLA RISPOSTA — da memoria/FORMATO_ANALISI.md, parola per parola ════════")
    if cl is None:
        L.append(f"⚠ CHECKLIST NON TROVATA: '{TITOLO_CHECKLIST}' manca da {FORMATO}. Non e' 'nessuna sezione "
                 "richiesta': e' il formato che non si legge, e la risposta va scritta col formato completo 0-7.")
    else:
        L.append(cl)
    if registro_cambiato:
        L.append("")
        L.append("⚠ REGISTRO DELLA PERFORMANCE AGGIORNATO: memoria/registro_performance.jsonl va committato e pushato su "
                 "main (git add, git commit, git pull --rebase origin main, git push) — altrimenti la riga di oggi resta "
                 "solo in questa sessione e il confronto con QQQ perde un giorno")
    if memorie_cambiate:
        L.append("")
        L.append("⚠ MEMORIA AGGIORNATA: " + ", ".join(f"memoria/{Path(p).name}" for p in memorie_cambiate)
                 + " va committata e pushata su main insieme al registro — sono sedute lette una volta sola (v496), "
                 "e una riga non committata resta solo in questa sessione")
    if falliti:
        L.append("")
        L.append(f"⚠ {len(falliti)} strumento/i FALLITO/I: " + ", ".join(e["argv"][1].split("/")[-1] for e in falliti)
                 + " — dichiararlo in cima alla risposta")
    return "\n".join(L), (1 if falliti or cl is None or scheda_codice else 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sedute", type=int, default=1)
    a = ap.parse_args()
    adesso = datetime.now(NEW_YORK)
    f = fase(adesso)
    lista = [(et, [sys.executable, str(RADICE / "scripts" / argv[0])] + argv[1:]) for et, argv in comandi(f, a.sedute)]
    t0 = time.time()
    prima = impronta()
    prima_mem = {p: impronta(p) for p in MEMORIE}
    # v511 — prima la lettura alla fonte (da sola), poi tutti gli altri in parallelo: la riusano dal disco
    testa_l = [x for x in lista if Path(x[1][1]).name in PRIMA]
    esiti = esegui(testa_l) + esegui([x for x in lista if x not in testa_l])
    testa = (f"ANALISI DEL LIBRO — {adesso.astimezone(ROMA):%d/%m/%Y %H:%M} ora italiana · New York "
             f"{adesso:%H:%M} · fase: {f.upper()} · {len(lista)} strumenti in parallelo, {round(time.time() - t0)} s")
    sc_righe, sc_codice, _ = scrivi_scheda(esiti, f, adesso)
    testo, codice = resa(esiti, checklist(), testa, registro_cambiato=impronta() != prima,
                         memorie_cambiate=[p for p in MEMORIE if impronta(p) != prima_mem[p]],
                         scheda_righe=sc_righe, scheda_codice=sc_codice)
    print(testo)
    sys.exit(codice)


if __name__ == "__main__":
    main()
