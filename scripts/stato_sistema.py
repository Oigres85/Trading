#!/usr/bin/env python3
"""STATO DEL SISTEMA — v518. Il controllo generico che chiude ogni analisi e ogni giro di lavoro.

Uso:  python3 scripts/stato_sistema.py [--senza-rete]

═══ PERCHE' ESISTE ═══════════════════════════════════════════════════════════════════════════
Istruzione del CEO del 30/10/2026, testuale: *"Alla fine fai sempre un controllo generico dello stato del sistema
cercando di eliminare quanto piu possibile le dipendenze dal progetto GitHub e lavorare più qui con te, in modo da
rendere stabile il processo e non incappare in errori di calcolo. Se ritieni fammi sempre domande."*

Gli errori di calcolo di questo progetto sono nati quasi tutti in tre posti che nessuno strumento dell'analisi guarda:
  · il CODICE: un commit che non e' su `main` non e' online, e un push che manda `main` in rosso lo scopre il CI dopo
    la pubblicazione (v442, v462: `main` rossa da stamattina e nessuno se n'era accorto);
  · la PIPELINE su GitHub: i dati che solo lei produce invecchiano in silenzio quando il cron ritarda (99-263 minuti,
    v437) o una fonte la rifiuta (ICE 403 il 30/10 alle 16:29: il ripiego regge, ma va saputo);
  · le COPIE DEL LIBRO: posizioni, liquidita' e sorvegliati vivono in memoria/LIBRO.md E in config/ (la pagina e la
    pipeline leggono quelle), e i gate che le confrontano girano solo al commit — una modifica fatta dalla pagina non
    accende la CI (v479, v480). Qui si confrontano a OGNI analisi.

Non giudica e non decide: misura e mette in fila (v448). Le DIPENDENZE DA GITHUB si elencano con la loro data, cosi'
ogni analisi dice quanto del suo contenuto poggia ancora sulla pipeline; l'elenco viene da fonti_dirette.SOLO_PIPELINE
(una grandezza, un proprietario: v436) e un gate verifica nei due versi che ogni voce abbia qui la sua data.
Le DOMANDE APERTE al CEO vivono in memoria/LIBRO.md §1undecies, una tabella con la data d'apertura: una domanda in
prosa sparsa nel libro invecchia da sola e non si ritrova (la v483 per le decisioni rimandate).

Esce SEMPRE 0: un controllo che fallisce lo dichiara nella sua riga («NON CONTROLLATO», con l'errore) invece di far
sparire il resto, e i suoi avvisi vanno nella sezione 9 della risposta — non sono uno strumento fallito.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE / "scripts"))

NEW_YORK = ZoneInfo("America/New_York")
ROMA = ZoneInfo("Europe/Rome")
REPO = "oigres85/trading"
WF_DATI = "update-data.yml"
WF_TEST = "tests.yml"
ORE_CADUTE = 24                  # convenzione (v240): le cadute della pipeline si contano nelle ultime 24 ore
ORE_PIPELINE_FERMA = 24          # oltre, il run e' un guasto e non un ritardo (la stessa soglia di /aggiorna e del brief)
GIORNI_POSIZIONI = 7             # oltre, config/posizioni.json puo' descrivere un libro che non esiste piu' (/aggiorna)
GIORNI_DOMANDA = 3               # una domanda aperta da piu' giorni si dichiara VECCHIA: e' tornata a voce piu' volte
LIBRO = RADICE / "memoria" / "LIBRO.md"
DATI = RADICE / "data" / "data.json"
CDS_STORIA = RADICE / "data" / "cds_storia.jsonl"
TITOLO_DOMANDE = "DA CONFERMARE COL CEO"
AVVISO = "⚠"

# I percorsi si classificano per COSA chiedono: una memoria si committa, un dato del libro si committa dopo i gate, il
# codice si prova con le suite prima del commit, data/ lo riscrive la pipeline e non si committa a mano.
CODICE = ("scripts/", "assets/", "index.html", ".github/", ".githooks/", ".claude/", "CLAUDE.md")
LIBRO_E_CONFIG = ("config/", "memoria/LIBRO.md", "memoria/FORMATO_ANALISI.md", "memoria/OROLOGIO.md",
                  "memoria/concorrenti.json", "memoria/trimestri_ufficiali.json")


# ══════════════════════════════════ ACCESSO: git e gh, iniettabili ══════════════════════════════════════════════
def _git(*args, timeout=30):
    try:
        p = subprocess.run(["git", *args], cwd=RADICE, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, f"{type(e).__name__}: {e}"


def _gh(percorso, timeout=30):
    """L'API di GitHub attraverso il client della sessione. Solleva su qualunque errore: il chiamante lo dichiara."""
    p = subprocess.run(["gh", "api", percorso], cwd=RADICE, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip()[:200] or f"gh api uscito {p.returncode}")
    return json.loads(p.stdout)


def _quando(iso):
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _ore(dt, adesso):
    return None if dt is None else (adesso - dt).total_seconds() / 3600


def ora_it(dt):
    return f"{dt.astimezone(ROMA):%d/%m %H:%M}" if dt else "n.d."


MESI = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
        "novembre", "dicembre")


def giorno_it(s, mese=False):
    """AAAA-MM-GG in GG/MM/AAAA, o nel nome del mese quando la serie descrive un mese (v392)."""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(s or ""))
    if not m:
        return str(s) if s else "n.d."
    return f"{MESI[int(m.group(2)) - 1]} {m.group(1)}" if mese else f"{m.group(3)}/{m.group(2)}/{m.group(1)}"


def eta_testo(ore):
    if ore is None:
        return "eta' n.d."
    if ore < 1:
        return f"{max(0, round(ore * 60))} minuti fa"
    if ore < 48:
        return f"{ore:.1f} ore fa".replace(".", ",")
    return f"{round(ore / 24)} giorni fa"


# ══════════════════════════════════ 1. IL CODICE ════════════════════════════════════════════════════════════════
def classifica(percorso):
    """memoria · libro · codice · dati · altro — cosa chiede un file modificato e non committato."""
    import analisi
    memorie = {str(Path(p).relative_to(RADICE)) for p in (*analisi.MEMORIE, analisi.REGISTRO)}
    if percorso in memorie:
        return "memoria"
    if percorso.startswith("data/"):
        return "dati"
    if any(percorso == c or percorso.startswith(c) for c in LIBRO_E_CONFIG):
        return "libro"
    if any(percorso == c or percorso.startswith(c) for c in CODICE) or percorso.startswith("memoria/"):
        return "codice"
    return "altro"


def percorsi_ci(testo=None):
    """I percorsi che fanno partire i test, letti da .github/workflows/tests.yml (`push: paths:`): una fonte sola, perche'
    un secondo elenco qui invecchierebbe da solo (v519 — CODICE comprendeva CLAUDE.md, .claude/ e .githooks/, che il CI
    non guarda). None se il file non si legge: allora vale CODICE, il verso prudente."""
    import re
    try:
        testo = testo if testo is not None else (RADICE / ".github" / "workflows" / WF_TEST).read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"^\s*push:\s*\n(?:\s+.*\n)*?\s+paths:\s*\[([^\]]*)\]", testo, re.M)
    if not m:
        return None
    return tuple(x.strip().strip("'\"") for x in m.group(1).split(",") if x.strip())


def guardato_dal_ci(percorso, percorsi=None):
    """True se un file cambiato fa partire i test. «cartella/**» guarda tutta la cartella; un nome esatto, quel file."""
    percorsi = percorsi if percorsi is not None else percorsi_ci()
    if percorsi is None:
        return any(percorso == c or percorso.startswith(c) for c in CODICE)
    for x in percorsi:
        if x.endswith("/**") and percorso.startswith(x[:-2]):
            return True
        if percorso == x:
            return True
    return False


def stato_codice(git=_git, gh=_gh, rete=True):
    out = {"fetch": None, "head": None, "origin": None, "avanti": None, "indietro": None, "modificati": {},
           "ci": None, "ci_errore": None}
    if rete:
        c, testo = git("fetch", "-q", "origin", "main", timeout=60)
        out["fetch"] = c == 0 or testo.strip()[:160]
    c, h = git("rev-parse", "HEAD")
    out["head"] = h.strip() if c == 0 else None
    c, o = git("rev-parse", "origin/main")
    out["origin"] = o.strip() if c == 0 else None
    c, conta = git("rev-list", "--left-right", "--count", "HEAD...origin/main")
    if c == 0 and len(conta.split()) == 2:
        out["avanti"], out["indietro"] = (int(x) for x in conta.split())
    c, st = git("status", "--porcelain")
    if c == 0:
        for riga in st.splitlines():
            if len(riga) > 3:
                p = riga[3:].strip().strip('"')
                p = p.split(" -> ")[-1]
                out["modificati"].setdefault(classifica(p), []).append(p)
    if rete and out["head"]:
        try:
            runs = gh(f"repos/{REPO}/actions/workflows/{WF_TEST}/runs?branch=main&per_page=10").get("workflow_runs") or []
            ultimo = runs[0] if runs else None
            if ultimo:
                sha = ultimo.get("head_sha") or ""
                ci = {"sha": sha, "stato": ultimo.get("status"), "esito": ultimo.get("conclusion"),
                      "quando": ultimo.get("created_at"), "su_head": sha == out["head"], "dopo": None}
                if not ci["su_head"]:
                    c, diff = git("diff", "--name-only", sha, out["head"])
                    ci["dopo"] = [x for x in diff.splitlines() if x.strip()] if c == 0 else None
                out["ci"] = ci
        except Exception as e:                                       # un errore descritto, mai muto
            out["ci_errore"] = f"{type(e).__name__}: {e}"
    return out


def righe_codice(s):
    L = ["CODICE — main, i test, i file non committati"]
    if s["fetch"] is not True and s["fetch"] is not None:
        L.append(f"  {AVVISO} origin/main NON aggiornato ({s['fetch']}): il confronto qui sotto e' con l'ultimo fetch")
    if s["head"] is None:
        L.append(f"  {AVVISO} HEAD non letto: lo stato del codice NON e' controllato")
        return L
    a, i = s["avanti"], s["indietro"]
    if a is None:
        L.append(f"  {AVVISO} il confronto con origin/main non si legge")
    elif a == 0 and i == 0:
        L.append(f"  HEAD {s['head'][:7]} = origin/main: cio' che e' qui e' online")
    else:
        if a:
            L.append(f"  {AVVISO} {a} commit qui e NON su main: non sono online (GitHub Pages serve main) — "
                     "git pull --rebase origin main, poi git push")
        if i:
            L.append(f"  {i} commit su main e non qui (di solito i dati della pipeline): git pull --rebase origin main "
                     "prima di leggere i dati o di committare")
    m = s["modificati"]
    if m.get("memoria"):
        L.append(f"  {AVVISO} memorie da committare: {', '.join(sorted(m['memoria']))} — sedute lette una volta sola: "
                 "una riga non committata resta solo in questa sessione")
    if m.get("libro"):
        L.append(f"  {AVVISO} libro o configurazione modificati e non committati: {', '.join(sorted(m['libro']))} — "
                 "si committano dopo le suite (le copie del libro hanno un gate che le confronta)")
    if m.get("codice"):
        L.append(f"  {AVVISO} codice o documenti modificati e non committati: {', '.join(sorted(m['codice']))} — "
                 "vanno provati con le suite prima del commit")
    if m.get("dati"):
        L.append(f"  {AVVISO} data/ modificato in locale: {', '.join(sorted(m['dati']))} — lo riscrive la pipeline: "
                 "non si committa a mano, e in un conflitto vince la versione remota")
    if m.get("altro"):
        L.append(f"  {AVVISO} altri file non committati: {', '.join(sorted(m['altro']))}")
    if not m:
        L.append("  nessun file modificato e non committato")
    ci = s["ci"]
    if s["ci_errore"]:
        L.append(f"  {AVVISO} i test del CI NON letti ({s['ci_errore']}): lo stato di main non e' verificato")
    elif ci is None:
        L.append(f"  {AVVISO} nessun run dei test su main letto")
    else:
        esito = ci["esito"] or ci["stato"]
        base = f"test del CI {esito} sul commit {ci['sha'][:7]} ({ora_it(_quando(ci['quando']))})"
        if ci["su_head"]:
            L.append(f"  {'' if esito == 'success' else AVVISO + ' '}{base}, che e' HEAD")
        elif ci["dopo"] is not None and ci["dopo"] and all(x.startswith("data/") for x in ci["dopo"]):
            L.append(f"  {'' if esito == 'success' else AVVISO + ' '}{base}: dopo, solo commit dei dati (i test non "
                     "girano su data/)")
        elif ci["dopo"] and not any(guardato_dal_ci(x) for x in ci["dopo"]):
            # v519 — un commit che il CI non guarda non avra' mai i suoi test: annunciarli «non ancora girati» suonava
            #   dopo ogni registrazione nel libro (un avviso che suona sempre non avvisa, v421)
            L.append(f"  {'' if esito == 'success' else AVVISO + ' '}{base}: dopo, solo file che i test non guardano "
                     f"({', '.join(sorted(ci['dopo'])[:6])}{' …' if len(ci['dopo']) > 6 else ''}) — i percorsi dei test "
                     "sono quelli di .github/workflows/tests.yml")
        else:
            L.append(f"  {AVVISO} {base}, ma HEAD e' un altro commit che tocca il codice: i test di HEAD non sono "
                     "ancora girati o non sono letti")
        if esito not in ("success", None) and ci["stato"] == "completed":
            L.append(f"  {AVVISO} main e' ROSSA: e' lavoro adesso, prima di qualunque altra modifica (v442)")
    return L


# ══════════════════════════════════ 2. LA PIPELINE SU GITHUB ════════════════════════════════════════════════════
def stato_pipeline(dati, adesso, gh=_gh, rete=True):
    import fonti_dirette as FD
    out = {"run": None, "ore_run": None, "prima_chiusura": None, "ultimo_ok": None, "cadute": None, "in_corso": None,
           "issue": None, "gh_errore": None, "allarmi": [], "non_letti": []}
    run, ore = FD.eta_run(dati, adesso)
    out["run"], out["ore_run"] = run, ore
    chiusura = FD.ultima_chiusura_usa(adesso)
    out["chiusura"] = chiusura
    t = _quando(run)
    out["prima_chiusura"] = (t < chiusura) if t else None
    dq = (dati or {}).get("data_quality") or {}
    for c in dq.get("checks") or []:
        if c.get("status") not in ("ok", None):
            out["allarmi"].append(c)
        elif re.search(r"non lett|NON lett|non letto|HTTP [45]\d\d", str(c.get("note") or "")):
            out["non_letti"].append(c)
    if rete:
        try:
            runs = gh(f"repos/{REPO}/actions/workflows/{WF_DATI}/runs?per_page=40").get("workflow_runs") or []
            ok = next((r for r in runs if r.get("conclusion") == "success"), None)
            out["ultimo_ok"] = ok.get("updated_at") if ok else None
            out["cadute"] = [r for r in runs if r.get("conclusion") in ("failure", "timed_out")
                             and (_ore(_quando(r.get("created_at")), adesso) or 1e9) <= ORE_CADUTE]
            out["in_corso"] = sum(1 for r in runs if r.get("status") in ("queued", "in_progress", "waiting"))
            iss = gh(f"repos/{REPO}/issues?state=open&labels=pipeline&per_page=20") or []
            out["issue"] = [i for i in iss if "pull_request" not in i]
        except Exception as e:
            out["gh_errore"] = f"{type(e).__name__}: {e}"
    return out


def righe_pipeline(p, adesso):
    L = ["PIPELINE SU GITHUB — dipendenza esterna: il cron e' una coda (99-263 minuti di ritardo, v437)",
         # v522 — cosa tocca un suo guasto, detto una volta: un avviso qui sotto non vuol dire «l'analisi e' sbagliata»
         "  cosa tocca un suo guasto (v522): la PAGINA della dashboard e lo storico dei CDS — di quello la sessione tiene "
         "una riserva (memoria/cds_sessione.jsonl), che la pipeline unisce al run dopo. L'analisi in chat legge alla "
         "fonte righe dei titoli, SEC EDGAR, composizione degli ETF, macro, BTP e leva (DATI DI QUESTO GIRO); la "
         "pipeline resta la RISERVA di quelle letture, e viceversa"]
    if p["run"] is None:
        L.append(f"  {AVVISO} data/data.json senza ora del run: l'eta' dei dati della pipeline NON e' nota")
    else:
        ore = p["ore_run"]
        testo = f"  data/data.json: run delle {ora_it(_quando(p['run']))} ora italiana, {eta_testo(ore)}"
        if ore is not None and ore > ORE_PIPELINE_FERMA:
            L.append(f"  {AVVISO}{testo[1:]} — PIPELINE FERMA: oltre {ORE_PIPELINE_FERMA} ore e' un guasto, non un "
                     "ritardo")
        elif p["prima_chiusura"]:
            L.append(f"  {AVVISO}{testo[1:]} — PRECEDENTE all'ultima chiusura USA ({ora_it(p['chiusura'])}): cio' che "
                     "porta solo lei descrive la seduta prima (vedi DIPENDENZE)")
        else:
            L.append(testo + f" — dopo l'ultima chiusura USA ({ora_it(p['chiusura'])})")
    for c in p["allarmi"]:
        L.append(f"  {AVVISO} sorveglianza della pipeline: {c.get('key')} {str(c.get('status')).upper()} — "
                 f"{c.get('note') or 'rilevazione del ' + str(c.get('date'))}")
    for c in p["non_letti"]:
        L.append(f"  {AVVISO} fonte NON letta nell'ultimo run: {c.get('key')} — {c.get('note')}")
    if not p["allarmi"] and not p["non_letti"] and p["run"]:
        L.append("  sorveglianza della pipeline: nessun allarme, nessuna fonte non letta nell'ultimo run")
    if p["gh_errore"]:
        L.append(f"  {AVVISO} i run su GitHub NON letti ({p['gh_errore']}): cadute e Issue non controllate")
    elif p["cadute"] is not None:
        ok = _quando(p["ultimo_ok"])
        L.append(f"  ultimo run riuscito: {ora_it(ok)} ({eta_testo(_ore(ok, adesso))})"
                 + (f" · {p['in_corso']} in corso o in coda" if p["in_corso"] else ""))
        if p["cadute"]:
            L.append(f"  {AVVISO} {len(p['cadute'])} run CADUTI nelle ultime {ORE_CADUTE} ore: "
                     + ", ".join(ora_it(_quando(r.get('created_at'))) for r in p["cadute"][:6])
                     + " — il log del run dice perche' (non i sintomi)")
        else:
            L.append(f"  nessun run caduto nelle ultime {ORE_CADUTE} ore")
        if p["issue"]:
            L.append(f"  {AVVISO} {len(p['issue'])} Issue «pipeline» aperte: "
                     + ", ".join(f"#{i.get('number')} {str(i.get('title'))[:60]}" for i in p["issue"][:5]))
    return L


# ══════════════════════════════════ 3. I DATI DI QUESTO GIRO ════════════════════════════════════════════════════
def stato_giro(adesso, percorsi=None):
    import fonti_dirette as FD
    import fonti_titoli as FT
    percorsi = percorsi or {"fonti_dirette": FD.CACHE, "fonti_titoli": FT.CACHE}
    validita = {"fonti_dirette": FD.VALIDITA_MINUTI, "fonti_titoli": FT.VALIDITA_MINUTI}
    out = {}
    for k, p in percorsi.items():
        try:
            d = json.loads(Path(p).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            out[k] = {"letto": None, "errore": f"{type(e).__name__}"}
            continue
        t = _quando(d.get("letto"))
        r = {"letto": t, "minuti": None if t is None else (adesso - t).total_seconds() / 60,
             "validita": validita[k], "errore": None}
        if k == "fonti_dirette":
            r["serie"] = len(d.get("diretta") or {})
            r["errori"] = sorted((d.get("errori") or {}).keys())
        else:
            r["esiti"] = {b: (d.get(b) or {}).get("esito") for b in FT.BLOCCHI}
        out[k] = r
    return out


def righe_giro(g, nel_giro=True):
    """nel_giro: lo stato gira dentro un'analisi (analisi.py passa --giro). Fuori, a fine di un giro di lavoro, una lettura
    piu' vecchia di 30 minuti e' il caso normale: dirlo con ⚠ ogni volta sarebbe un avviso che suona sempre (v421, v427)."""
    L = ["DATI DI QUESTO GIRO — letti qui, alla fonte, all'ora dell'analisi (v511, v512)"]
    nomi = {"fonti_dirette": "serie macro (fonti_dirette.py)", "fonti_titoli": "dati per titolo (fonti_titoli.py)"}
    for k, nome in nomi.items():
        r = g.get(k) or {}
        if r.get("letto") is None:
            L.append(f"  {AVVISO} {nome}: NESSUNA lettura su disco ({r.get('errore') or 'file assente'}) — gli strumenti "
                     "hanno usato la pipeline")
            continue
        fresca = r["minuti"] is not None and r["minuti"] <= r["validita"]
        quando = f"letta alle {ora_it(r['letto'])} ({eta_testo(r['minuti'] / 60)})"
        if not fresca and not nel_giro:
            L.append(f"  {nome}: ultima lettura {quando} — fuori da un'analisi e' normale: la prossima analisi la rifa'")
            continue
        if not fresca:
            L.append(f"  {AVVISO} {nome}: {quando}, oltre i {r['validita']} minuti in cui gli strumenti la riusano — "
                     "non e' la lettura di questo giro: gli strumenti hanno usato la pipeline")
            continue
        if k == "fonti_dirette":
            err = r.get("errori") or []
            L.append(f"  {nome}: {quando}, {r['serie']} serie"
                     + (f" · {AVVISO} non lette alla fonte: {', '.join(err)}" if err else ", tutte lette alla fonte"))
        else:
            es = r.get("esiti") or {}
            dubbi = [b for b, e in es.items() if e == "non letto"]
            L.append(f"  {nome}: {quando} · " + ", ".join(f"{b} {e}" for b, e in es.items()))
            if dubbi:
                L.append(f"  {AVVISO} dati per titolo da guardare: {', '.join(dubbi)} (il blocco DATI PER TITOLO dice "
                         "cosa cercare in rete)")
    return L


# ══════════════════════════════════ 4. LE DIPENDENZE DA GITHUB ══════════════════════════════════════════════════
def _ultimo_cds(percorso=CDS_STORIA):
    try:
        righe = [x for x in Path(percorso).read_text(encoding="utf-8").splitlines() if x.strip()]
        r = json.loads(righe[-1])
        # la riga dello storico: d = giorno, p = {entita': [cedola, prezzo]}, i = {indice: …} (v497, v508)
        return {"giorno": r.get("d"), "entita": len(r.get("p") or {}), "indici": len(r.get("i") or {}),
                "parziale": r.get("parziale")}
    except (OSError, ValueError, IndexError):
        return None


def nota_cds(cds, run):
    """Il giorno raccolto senza gli indici CDX e' a meta': ICE pubblica a ondate (Asia, Europa, Nord America con gli indici
    fra le 19:50 e le 21:00 UTC, v508). Sul giorno del run e' il caso normale; su un giorno passato e' un giorno perso."""
    if not cds:
        return "storico non letto"
    testo = f"ultimo giorno raccolto con {cds['entita']} entita' e {cds['indici']} indici"
    if cds.get("indici") and not cds.get("parziale"):
        return testo
    if str(run or "")[:10] == str(cds.get("giorno")):
        return testo + " — a meta' come ogni giorno prima dell'ondata nordamericana (19:50-21:00 UTC)"
    return testo + f" — {AVVISO} raccolto a meta' e non completato: le misure di quel giorno lo dichiarano (v508)"


def _voce(parola):
    """La voce di fonti_dirette.SOLO_PIPELINE che contiene `parola`, e una sola. v519 — prima le voci si prendevano per
    POSIZIONE nell'elenco: togliere o aggiungere una voce spostava le date sulla voce accanto senza rompere niente."""
    import fonti_dirette as FD
    trovate = [x for x in FD.SOLO_PIPELINE if parola in x]
    if len(trovate) != 1:
        raise KeyError(f"{parola!r}: {len(trovate)} voci in fonti_dirette.SOLO_PIPELINE invece di una")
    return trovate[0]


def date_dipendenze(dati):
    """{voce di fonti_dirette.SOLO_PIPELINE: (data, nota)}. La chiave e' la stringa della voce: un gate verifica nei due
    versi che ogni voce abbia qui la sua data e che qui non ce ne sia una che l'elenco non ha (v387, v406)."""
    run = (dati or {}).get("updated_at")
    cds = _ultimo_cds()
    v = {
        _voce("storico dei CDS"): ((cds or {}).get("giorno"), nota_cds(cds, (dati or {}).get("updated_at"))),
        _voce("contributo al rischio"): (run, "si calcolano a ogni run sulla matrice dei rendimenti di tutti i titoli "
                                              "insieme e servono alla PAGINA: l'analisi non li legge, calcola i suoi "
                                              "sulle barre (numeri_libro.py, v460)"),
    }
    return v


def righe_dipendenze(dati, pipeline):
    import fonti_dirette as FD
    L = ["DIPENDENZE DA GITHUB CHE RESTANO — cio' che solo la pipeline produce, con la sua data"]
    try:
        dd = date_dipendenze(dati)
    except Exception as e:
        return L + [f"  {AVVISO} NON CONTROLLATO: {type(e).__name__}: {e}"]
    for voce in FD.SOLO_PIPELINE:
        data, nota = dd.get(voce, (None, "data non associata"))
        q = _quando(data) if data and "T" in str(data) else None
        quando = ora_it(q) if q else giorno_it(data)
        segno = f"{AVVISO} " if (data is None or (q is not None and pipeline.get("prima_chiusura"))) else ""
        L.append(f"  {segno}{voce}: {quando} — {nota}")
    L.append("  gia' letti qui alla fonte, non piu' dalla pipeline: " + "; ".join(FD.RILETTI_PER_TITOLO)
             + "; le serie macro del semaforo e del brief (fonti_dirette.py)")
    return L


# ══════════════════════════════════ 5. LA COERENZA DEL LIBRO ════════════════════════════════════════════════════
def _json(percorso):
    return json.loads(Path(percorso).read_text(encoding="utf-8"))


def _riferimento(t):
    return bool(re.search(r"(^\^|=[XF]$|-(USD|USDT|EUR)$)", t))


def coerenza_libro(libro=None, posizioni_cfg=None, stato_cfg=None, watchlist_cfg=None, registro_conc=None,
                   operazioni="leggi", oggi=None):
    """Le copie del libro confrontate, a ogni analisi. Ogni argomento None si legge dal suo file: i gate li passano."""
    import brief
    oggi = oggi or date.today()
    pos, cassa, sorv = libro if libro is not None else brief.leggi_libro()
    out = []
    cfg = posizioni_cfg if posizioni_cfg is not None else _json(RADICE / "config" / "posizioni.json")
    p_cfg = {x.get("ticker"): x for x in cfg.get("posizioni") or []}
    p_lib = {x["tk"]: x for x in pos}
    if set(p_cfg) != set(p_lib):
        out.append(f"posizioni diverse fra LIBRO.md e config/posizioni.json: solo nel libro {sorted(set(p_lib) - set(p_cfg))}"
                   f" · solo nella configurazione {sorted(set(p_cfg) - set(p_lib))} — la pipeline e la pagina leggono la "
                   "seconda")
    for tk in sorted(set(p_cfg) & set(p_lib)):
        a, b = p_lib[tk], p_cfg[tk]
        if abs(float(a["qta"]) - float(b.get("qta") or 0)) > 1e-9 or abs(float(a["pmc"]) - float(b.get("pmc") or 0)) > 1e-6:
            out.append(f"{tk}: LIBRO.md {a['qta']:g} a {a['pmc']:g} contro config/posizioni.json "
                       f"{b.get('qta')} a {b.get('pmc')}")
    agg = cfg.get("aggiornato")
    try:
        giorni = (oggi - date.fromisoformat(str(agg)[:10])).days
    except ValueError:
        giorni = None
    if giorni is None:
        out.append("config/posizioni.json senza data «aggiornato»: la sua eta' non e' nota")
    elif giorni > GIORNI_POSIZIONI:
        out.append(f"config/posizioni.json aggiornato {giorni} giorni fa (oltre {GIORNI_POSIZIONI}): e' ancora il libro "
                   "di oggi? Si conferma col CEO")
    st = stato_cfg if stato_cfg is not None else _json(RADICE / "config" / "portfolio_state.json")
    c_cfg = (st.get("cash") or {}).get("v")
    if not isinstance(cassa, (int, float)) or not isinstance(c_cfg, (int, float)) or abs(cassa - c_cfg) >= 0.5:
        out.append(f"liquidita' diversa: LIBRO.md {cassa} contro config/portfolio_state.json {c_cfg} — la pagina e il "
                   "pacchetto leggono la seconda, gli strumenti la prima (v479)")
    ui = watchlist_cfg if watchlist_cfg is not None else _json(RADICE / "config" / "ui_watchlist.json")
    resto = {t for t in ui if not _riferimento(t) and t not in p_lib}
    sv = {s["tk"] for s in sorv}
    if sv != resto:
        out.append(f"sorvegliati diversi: solo in config/ui_watchlist.json {sorted(resto - sv)} · solo in LIBRO.md "
                   f"{sorted(sv - resto)} (v480)")
    non_seguite = sorted(set(p_lib) - set(ui))
    if non_seguite:
        out.append(f"posizioni che la pipeline non segue: {non_seguite}")
    try:
        import concorrenti as KO
        reg = registro_conc if registro_conc is not None else KO.carica_registro()
        manca = [t for t, x in p_lib.items() if x.get("valuta") == "USD" and t not in reg]
        if manca:
            out.append(f"posizioni senza voce nel registro dei concorrenti: {manca} (FORMATO 7d-ter)")
    except Exception as e:
        out.append(f"registro dei concorrenti NON controllato: {type(e).__name__}: {e}")
    if operazioni == "leggi":
        import numeri_libro as NL
        operazioni = NL.leggi_operazioni()
    if operazioni is None:
        out.append("registro delle operazioni (§1decies) ASSENTE: il cambio delle operazioni non si legge")
    else:
        netto = {}
        for o in operazioni:
            q = o.get("qta") or 0
            netto[o["tk"]] = netto.get(o["tk"], 0) + (q if o.get("verso") == "acquisto" else -q if o.get("verso") else 0)
            if o.get("verso") is None:
                out.append(f"operazione di {o['tk']} del {o.get('data_testo')}: verso «{o.get('verso_testo')}» non "
                           "riconosciuto")
        for tk, q in netto.items():
            if q > float((p_lib.get(tk) or {}).get("qta") or 0) + 1e-9:
                out.append(f"{tk}: il registro delle operazioni porta {q:g} azioni nette, la posizione di §1 "
                           f"{(p_lib.get(tk) or {}).get('qta', 0):g}")
    return out


def righe_coerenza(c):
    L = ["COERENZA DEL LIBRO — le copie confrontate a ogni analisi (i gate lo fanno solo al commit)"]
    if not c:
        return L + ["  posizioni, quantita' e carichi, liquidita', sorvegliati, concorrenti e operazioni: coincidono"]
    return L + [f"  {AVVISO} {x}" for x in c]


# ══════════════════════════════════ 6. LE DOMANDE APERTE AL CEO ═════════════════════════════════════════════════
def leggi_domande(testo=None):
    """La tabella DA CONFERMARE COL CEO di LIBRO.md: [{aperta, cosa, perche, come}]. None = sezione ASSENTE, che si legge
    diverso da «nessuna domanda» (v389, v406). Si legge solo dentro il proprio titolo (v454)."""
    if testo is None:
        testo = LIBRO.read_text(encoding="utf-8")
    out, sez, trovata = [], False, False
    for riga in testo.splitlines():
        if riga.startswith("## "):
            sez = TITOLO_DOMANDE in riga.upper()
            trovata = trovata or sez
            continue
        if not sez or not riga.startswith("|"):
            continue
        celle = [x.strip() for x in riga.strip().strip("|").split("|")]
        if len(celle) < 4 or celle[0] in ("Aperta il", "") or set(celle[0]) <= set("-: "):
            continue
        out.append({"aperta": celle[0], "cosa": celle[1], "perche": celle[2], "come": celle[3]})
    return out if trovata else None


def _data_da_it(s):
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", str(s or ""))
    return date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def confermare_non_registrate(testo=None, domande=None):
    """I «da confermare» nelle tabelle di §1 (posizioni e liquidita') e §1decies (operazioni) che la tabella delle
    domande non nomina: una domanda scritta in una nota e non nel registro non si ritrova alla prossima analisi."""
    if testo is None:
        testo = LIBRO.read_text(encoding="utf-8")
    if domande is None:
        domande = leggi_domande(testo) or []
    nominati = " ".join(d["cosa"] + " " + d["perche"] for d in domande).upper()
    sez, out = None, []
    for riga in testo.splitlines():
        if riga.startswith("## "):
            u = riga.upper()
            sez = "pos" if u.startswith("## 1. ") else ("ops" if "OPERAZIONI E CAMBIO" in u else None)
            continue
        if sez is None or "da confermare" not in riga.lower():
            continue
        if riga.startswith("|"):
            tk = riga.strip("|").split("|")[0 if sez == "pos" else 1].strip()
            if tk and not re.search(rf"\b{re.escape(tk.upper())}\b", nominati):
                out.append(tk)
        elif "Liquidit" in riga and "LIQUIDIT" not in nominati:
            out.append("liquidita'")
    return out


def righe_domande(domande, scoperte, oggi):
    L = ["DOMANDE APERTE AL CEO — memoria/LIBRO.md §1undecies, «Da confermare col CEO»"]
    if domande is None:
        return L + [f"  {AVVISO} la tabella delle domande NON c'e' in LIBRO.md: le domande aperte non si leggono"]
    if not domande:
        L.append("  nessuna domanda aperta")
    for d in domande:
        g = _data_da_it(d["aperta"])
        giorni = (oggi - g).days if g else None
        vecchia = giorni is not None and giorni > GIORNI_DOMANDA
        L.append(f"  {AVVISO + ' ' if vecchia else ''}{d['cosa']} — aperta il {d['aperta']}"
                 + (f", {giorni} giorni fa" if giorni else "") + f" · conta perche': {d['perche']} · si chiude: {d['come']}")
    for s in scoperte:
        L.append(f"  {AVVISO} «da confermare» su {s} nelle tabelle del libro ma NON fra le domande: va aggiunta alla "
                 "tabella, o la nota tolta se la risposta c'e' gia'")
    return L


# ══════════════════════════════════ L'INSIEME ═══════════════════════════════════════════════════════════════════
def _sezione(f, *a, **k):
    """Un controllo che solleva diventa una riga che lo dichiara: il resto del rapporto non si perde."""
    try:
        return f(*a, **k)
    except Exception as e:
        return [f"{f.__name__.replace('righe_', '').upper()} — {AVVISO} NON CONTROLLATO: {type(e).__name__}: {e}"]


def rapporto(adesso=None, rete=True, git=_git, gh=_gh, dati=None, nel_giro=False):
    adesso = adesso or datetime.now(timezone.utc)
    if dati is None:
        try:
            dati = _json(DATI)
        except (OSError, ValueError):
            dati = {}
    blocchi = []
    blocchi.append(_sezione(lambda: righe_codice(stato_codice(git, gh, rete))))
    pipe = {}
    try:
        pipe = stato_pipeline(dati, adesso, gh, rete)
        blocchi.append(righe_pipeline(pipe, adesso))
    except Exception as e:
        blocchi.append([f"PIPELINE SU GITHUB — {AVVISO} NON CONTROLLATA: {type(e).__name__}: {e}"])
    blocchi.append(_sezione(lambda: righe_giro(stato_giro(adesso), nel_giro)))
    blocchi.append(_sezione(lambda: righe_dipendenze(dati, pipe)))
    blocchi.append(_sezione(lambda: righe_coerenza(coerenza_libro(oggi=adesso.astimezone(ROMA).date()))))
    oggi = adesso.astimezone(ROMA).date()
    try:
        testo = LIBRO.read_text(encoding="utf-8")
        dom = leggi_domande(testo)
        blocchi.append(righe_domande(dom, confermare_non_registrate(testo, dom or []), oggi))
    except Exception as e:
        dom = None
        blocchi.append([f"DOMANDE APERTE AL CEO — {AVVISO} NON LETTE: {type(e).__name__}: {e}"])
    da_sistemare = sum(1 for b in blocchi[:-1] for r in b if AVVISO in r)
    n_dom = len(dom or [])
    testa = [f"STATO DEL SISTEMA — {adesso.astimezone(ROMA):%d/%m/%Y %H:%M} ora italiana",
             f"  esito: {da_sistemare} punt{'o' if da_sistemare == 1 else 'i'} da guardare (le righe con {AVVISO}) · "
             f"{n_dom} domand{'a' if n_dom == 1 else 'e'} apert{'a' if n_dom == 1 else 'e'} al CEO"
             + ("" if rete else " · SENZA RETE: CI, run e Issue non controllati")]
    righe = testa
    for b in blocchi:
        righe += [""] + b
    return "\n".join(righe), da_sistemare, n_dom


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--senza-rete", action="store_true", help="niente git fetch ne' API di GitHub")
    ap.add_argument("--giro", action="store_true", help="dentro un'analisi: le letture del giro devono esserci")
    a = ap.parse_args()
    testo, _, _ = rapporto(rete=not a.senza_rete, nel_giro=a.giro)
    print(testo)


if __name__ == "__main__":
    main()
