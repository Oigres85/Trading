# Decisioni del progetto — perché è fatto così

Scritto perché una sessione nuova non riparta da zero. Ogni voce ha la ragione, non solo la scelta.

## Agosto 2026 — dal pacchetto da 17.000 token all'analisi diretta

**Com'era.** Il sistema generava un pacchetto di testo (~61.000 caratteri, ~17.000 token) che il
CEO incollava in ChatGPT. Il 36% era la coda macro duplicata; ~14.000 caratteri erano istruzioni,
più altre ~10.000 di glosse dentro i dati.

**Perché è cambiato.** Quelle istruzioni esistevano per insegnare a un modello cieco tutto ciò che
non poteva vedere del sistema. È un'architettura che deve crescere in modo non lineare: ogni dato
nuovo richiede la prosa che spiega cosa non è. In tre giorni di lavoro sono emersi difetti che il
pacchetto non poteva rilevare da solo:

- la pipeline morta per tre giorni mentre il pacchetto annunciava sereno il prossimo aggiornamento
- il prezzo sbagliato dell'11% su un titolo caduto del 10% dopo la trimestrale
- «prossima trimestrale» riferita a una data già passata
- le scommesse effettive cieche ai pesi, nella riga il cui compito era isolare l'effetto dei pesi
- `debito/mezzi propri 28,97` senza unità: letto come 29× invece di 0,29×
- il denominatore del rischio: solo azionario invece del patrimonio, −20% di errore

**Cosa si è tenuto.** La pipeline (`data.json`), la dashboard, e soprattutto **il motore di misura**:
i numeri del vecchio sistema e quelli calcolati da zero convergono (drawdown −24,3% contro −24,4%).
Il motore era giusto; era lo strato di istruzioni attorno che non lo era.

**Cosa si è congelato.** Il pacchetto-prompt. Non cresce più.

## L'analisi non dipende dalla pipeline — è una scelta

`analisi_libro.py` legge le **posizioni** da `config/posizioni.json` (che scrive la dashboard) e i
**prezzi** da yfinance. Se la pipeline muore, l'analisi continua a dire la verità. È la lezione dei
tre giorni in cui è stata ferma senza che nessuno se ne accorgesse.

**Conseguenza da conoscere:** le posizioni non le aggiorna nessuno automaticamente. Se la dashboard
non viene usata dopo un acquisto o una vendita, l'analisi produce numeri esatti su un libro che non
esiste più — peggio che non averla. L'età si dichiara a ogni esecuzione.

## Il confine sulle raccomandazioni

Il sistema misura e diagnostica; non dice di comprare, vendere o alleggerire, e non dimensiona.
Il confine è fra un fatto sul titolo («sotto X la discesa entra nel 10% peggiore della sua storia»)
e una decisione sul capitale («vendi a X»). Non cambia se la seconda si chiama ipotesi.
`soglie.py` arriva fino a quel confine deliberatamente, e i suoi test lo presidiano.

### Settembre 2026 — il confine spostato, e cosa la misura ha corretto

Il CEO ha chiesto di ricevere anche alleggerimenti, vendite, incrementi e dimensionamento.
Rileggendo **perché** il confine stava lì è emerso che la ragione era più stretta di come era
stata applicata: non «i numeri sulle quantità sono vietati», ma **«senza liquidità, altri conti
e situazione fiscale una quantità è un'invenzione travestita da misura»**. Due dei tre buchi si
sono chiusi da soli — la liquidità l'ha confermata il CEO, l'aliquota è pubblica — e il terzo
impedisce di dire *quale* mossa fare, non di calcolare *cosa comporta* una mossa.

Da qui `scripts/conseguenze.py`: azioni da spostare per raggiungere una soglia dichiarata,
effetto misurato sul libro ricalcolato dalla matrice vera, conto fiscale, e il prezzo a cui la
soglia si raggiunge senza operare. Il divieto che resta è di **presentare un'aritmetica come la
quantità giusta**, e di colmare in silenzio i due buchi rimasti.

⚠⚠ **E la misura ha subito smentito l'intuizione, che è la ragione per cui va calcolata invece
che stimata**: portare NVDA dal 20% al 15% **alza** la volatilità del libro da 49,3% a 50,8%.
NVDA ha volatilità 39% contro l'87% di MU: dentro questo libro fa da zavorra, e ridurla
concentra il resto. *Alleggerire la seconda posizione più grande peggiora il rischio*, e chi si
fosse fidato del ragionamento invece del ricalcolo avrebbe fatto l'opposto di quello che voleva.
È la stessa lezione delle scommesse effettive cieche ai pesi, in un'altra forma.

## Perché la dashboard resta

Non per leggere l'analisi: per **scrivere le posizioni**. È l'unico punto in cui è indispensabile.

## Cosa è stato provato e scartato

- **Un terminale a pagamento**: perde lo strato epistemico (la datazione di ogni numero, la
  dichiarazione di ogni etichetta) che è la parte costata mesi e la ragione dell'affidabilità.
- **Chiedere a un LLM senza pacchetto**: perde tutta la storia misurata del libro, che è l'unica
  parte non reperibile online — e il modello inventa una parte dei numeri con sicurezza.
- **Un Progetto su claude.ai**: legge `data/libro.json` (4 KB, pubblico) e basta per l'analisi di
  routine, ma non può calcolare misure nuove né diagnosticare il sistema. Scartato a favore di
  Claude Code, che fa entrambe.
- **La distanza al default alla Merton**: calcolabile, ma sarebbe l'ennesimo numero nostro
  travestito da probabilità — la categoria che il detector C17 vieta.

## Le fonti, tutte gratuite e verificate

yfinance (prezzi, bilanci, conto economico, consenso) · FRED (macro, richiede chiave su CI) ·
FINRA (ATS/dark pool e volume short, senza autenticazione) · SEC EDGAR (filing, senza chiave).
**Non ottenibili gratis**: CDS su singolo nome (Markit/ICE), TRACE (401 senza credenziali).
