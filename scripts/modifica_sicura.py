#!/usr/bin/env python3
"""Scrittura sicura di un file sorgente: LEGGI → TRASFORMA → VERIFICA → SCRIVI.

═══ PERCHÉ ESISTE ═══════════════════════════════════════════════════════════════════════════
In una sola sessione ho lasciato QUATTRO tagli a metà su assets/app.js. Ogni volta lo schema
era identico: uno script ad hoc trovava i confini di una funzione con un'euristica ("la prossima
riga a colonna zero", "conta le parentesi"), sbagliava su un caso che non avevo previsto —
una regex che contiene virgolette, una funzione la cui chiusura non è seguita da una riga a
colonna zero — e scriveva comunque. Il file restava sintatticamente rotto, o peggio: una volta
ha PRODOTTO UN DUPLICATO di quattro funzioni, che in JavaScript non rompe niente (la seconda
definizione vince in silenzio) e passa tutti i gate.

La correzione non è "stare più attenti": è già stata provata quattro volte nello stesso turno.
È che **lo strumento non accetti più di scrivere un file che non regge**. Stessa regola già
scritta in questo progetto per `check()`, che accetta solo booleani dopo che cinque check erano
verdi a vuoto:

    > Un difetto di metodo ripetuto non si corregge con l'attenzione: si corregge cambiando lo
    > strumento perché non lo accetti più.

═══ COME SI USA ═════════════════════════════════════════════════════════════════════════════
    import sys; sys.path.insert(0, "scripts")
    from modifica_sicura import modifica

    def trasforma(s):
        assert s.count(VECCHIO) == 1        # ⚠ l'assert serve: un replace che non trova
        return s.replace(VECCHIO, NUOVO)    #    nulla è un no-op silenzioso

    modifica("assets/app.js", trasforma)    # scrive SOLO se il risultato è valido

Se la verifica fallisce, il file originale NON viene toccato e l'errore è rumoroso.
"""

from __future__ import annotations

import ast
import os
import subprocess
import sys
import tempfile
from pathlib import Path


class ModificaRifiutata(RuntimeError):
    """Il risultato non ha superato la verifica: il file non è stato scritto."""


# ── verificatori per tipo di file ───────────────────────────────────────────────────────────
# Ognuno riceve il testo NUOVO e ritorna None se va bene, o una stringa che spiega il problema.

def _verifica_js(testo: str, suffisso: str) -> str | None:
    """`node --check` su una copia temporanea: è l'unico giudice che conta per il JS."""
    tmp = tempfile.NamedTemporaryFile("w", suffix=suffisso, delete=False, encoding="utf-8")
    try:
        tmp.write(testo)
        tmp.close()
        r = subprocess.run(["node", "--check", tmp.name], capture_output=True, text=True)
        if r.returncode != 0:
            return "node --check: " + (r.stderr.strip().splitlines() or ["errore"])[0]
    finally:
        os.unlink(tmp.name)
    return None


def _verifica_py(testo: str, _suffisso: str) -> str | None:
    try:
        ast.parse(testo)
    except SyntaxError as e:
        return f"sintassi Python riga {e.lineno}: {e.msg}"
    return None


def _verifica_json(testo: str, _suffisso: str) -> str | None:
    import json
    try:
        json.loads(testo)
    except Exception as e:  # noqa: BLE001
        return f"JSON non valido: {e}"
    return None


def _verifica_html(testo: str, _suffisso: str) -> str | None:
    """Bilanciamento dei tag.
    ⚠ A CARATTERI, NON A REGEX, ed è una lezione già pagata (v225): il favicon di questa pagina
    è un data-URI che contiene `<svg><rect/><text>T</text></svg>` DENTRO un attributo. Una regex
    sui tag lo legge come markup vero e denuncia uno sbilanciamento inesistente."""
    VUOTI = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr"}
    pila: list[str] = []
    i, n = 0, len(testo)
    while i < n:
        if testo[i] != "<":
            i += 1
            continue
        if testo.startswith("<!--", i):
            j = testo.find("-->", i)
            i = n if j < 0 else j + 3
            continue
        if testo.startswith("<!", i):
            j = testo.find(">", i)
            i = n if j < 0 else j + 1
            continue
        # si legge il tag rispettando le virgolette degli attributi
        j, q = i + 1, None
        while j < n:
            c = testo[j]
            if q:
                if c == q:
                    q = None
            elif c in "\"'":
                q = c
            elif c == ">":
                break
            j += 1
        if j >= n:
            break
        corpo = testo[i + 1:j].strip()
        i = j + 1
        if not corpo:
            continue
        if corpo.startswith("/"):
            nome = corpo[1:].strip().split()[0].lower() if corpo[1:].strip() else ""
            if nome in VUOTI:
                continue
            if not pila:
                return f"</{nome}> di troppo: non c'è nessun tag aperto da chiudere"
            if pila[-1] != nome:
                return f"</{nome}> chiude mentre è aperto <{pila[-1]}>"
            pila.pop()
            continue
        if corpo.endswith("/"):
            continue
        nome = corpo.split()[0].lower()
        if nome in VUOTI or nome.startswith("?"):
            continue
        pila.append(nome)
    if pila:
        return f"tag mai chiusi: {', '.join(pila[-5:])}"
    return None


VERIFICATORI = {
    ".js": _verifica_js, ".mjs": _verifica_js, ".cjs": _verifica_js,
    ".py": _verifica_py,
    ".json": _verifica_json,
    ".html": _verifica_html, ".htm": _verifica_html,
}


def verifica(percorso: str | Path, testo: str) -> str | None:
    """Ritorna None se il testo è valido per quel tipo di file, altrimenti il motivo."""
    suff = Path(percorso).suffix.lower()
    v = VERIFICATORI.get(suff)
    if v is None:
        return None          # tipo senza verificatore: si scrive, ma senza promettere nulla
    return v(testo, suff)


def modifica(percorso: str | Path, trasforma, *, permetti_nessun_cambio: bool = False) -> str:
    """Applica `trasforma` al contenuto del file e scrive SOLO se il risultato regge.

    ⚠ Un cambiamento NULLO è un errore per default: nella stragrande maggioranza dei casi
    significa che un `replace` non ha trovato la stringa cercata — cioè un no-op silenzioso,
    la classe di difetto che questo progetto chiama "iniezione senza assert".
    """
    p = Path(percorso)
    prima = p.read_text(encoding="utf-8")
    dopo = trasforma(prima)
    if not isinstance(dopo, str):
        raise ModificaRifiutata(f"{p}: la trasformazione non ha restituito testo")
    if dopo == prima and not permetti_nessun_cambio:
        raise ModificaRifiutata(
            f"{p}: NESSUN CAMBIAMENTO. Quasi sempre vuol dire che un replace non ha trovato "
            f"la stringa cercata. Se è voluto, passa permetti_nessun_cambio=True.")
    motivo = verifica(p, dopo)
    if motivo:
        raise ModificaRifiutata(f"{p}: NON SCRITTO — {motivo}")
    p.write_text(dopo, encoding="utf-8")
    return dopo


# ── uso da riga di comando: verifica dei file già a disco ────────────────────────────────────
if __name__ == "__main__":
    bersagli = sys.argv[1:]
    if not bersagli:
        radice = Path(__file__).resolve().parent.parent
        bersagli = [str(radice / x) for x in
                    ("assets/app.js", "index.html", "scripts/update_data.py",
                     "scripts/test_app.mjs", "scripts/self_check.mjs",
                     "config/ui_watchlist.json")]
    guasti = 0
    for b in bersagli:
        p = Path(b)
        if not p.exists():
            print(f"FAIL  {p.name}: non esiste")
            guasti += 1
            continue
        motivo = verifica(p, p.read_text(encoding="utf-8"))
        print(f"{'FAIL' if motivo else 'PASS'}  {p.name}" + (f": {motivo}" if motivo else ""))
        guasti += bool(motivo)
    print(f"\nVERIFICA SORGENTI: {len(bersagli) - guasti}/{len(bersagli)} validi")
    sys.exit(1 if guasti else 0)
