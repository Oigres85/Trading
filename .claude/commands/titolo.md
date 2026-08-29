---
description: Analisi di un singolo titolo del libro — livelli, soglie, contesto e notizie
argument-hint: TICKER
---

Analizza **$1** come posizione dentro il libro del CEO (mandato growth, 13 nomi concentrati).

1. `git pull`
2. Leggi `config/AVVIO_SESSIONE.md` e seguilo.
3. Esegui `python3 scripts/analisi_libro.py $1` e `python3 scripts/soglie.py $1`.
4. Cerca in rete: ultima trimestrale (risultati contro consenso e guidance), notizie delle
   ultime 48 ore, revisioni recenti. Fonte, data e URL.
5. Scrivi l'analisi: il fatto che spiega il movimento, se è ordinario o una rottura **per questo
   nome** (usa la soglia di anomalia che `soglie.py` calcola), il posto della posizione nel
   rischio del libro e con chi si muove insieme, cosa romperebbe la tesi.

Dichiara sempre le età dei dati e gli avvisi ⚠. Niente indicazioni operative né dimensionamento:
livelli e soglie sì, comprare/vendere/alleggerire no.
