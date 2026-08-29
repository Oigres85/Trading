---
description: Il sistema sta funzionando? Pipeline, età dei dati, gate
---

Verifica lo stato del sistema e riferisci in dieci righe, senza cerimonie:

1. `git pull`
2. Età di `data/data.json` (la pipeline) e di `config/posizioni.json` (la dashboard).
   Sopra 24 ore la prima e sopra 7 giorni la seconda sono problemi, non dettagli.
3. `python3 scripts/analisi_libro.py` — gira? degrada? cosa dichiara in testa?
4. I gate: `node scripts/self_check.mjs` e `python3 scripts/test_analisi_libro.py`.
5. Se qualcosa è rotto, **diagnosticalo guardando** — il log, il run, il file — non deducendolo
   dai sintomi. È la regola che questo progetto ha pagato più volte.

Chiudi dicendo se il sistema è utilizzabile adesso, e per cosa non lo è.
