# Da dove ripartire — handoff del 01/08/2026 (dopo v205)

> Leggi anche `CLAUDE.md`, che contiene le regole d'ingaggio e i difetti già vissuti.

## Come lavora davvero il CEO (accertato, non supposto)

- Guarda **investing.com più volte al giorno**: premarket, orario esteso, volumi, massimi/minimi.
  Quella è la sua dashboard vera, ed è migliore della nostra per il suo processo.
- Macro e notizie da **YouTube** (FX Evolution, Finvid, Bloomberg) — di cui si fida più dei nostri dati.
- **TradingView** quando ha tempo, con indicatori Pine.
- **Cambia posizione più volte al giorno oppure sta fermo per mesi.** Non c'è una cadenza:
  serve qualcosa di disponibile *quando decide*, non un report periodico.
- Ha guadagnato con questo metodo. Il sistema deve stargli **ai bordi**, non al centro.

## Stato del sistema (v205)

Tutti i gate verdi: **176 test JS** · red team 32 campagne · **pipeline 67 test** · coerenza 18
controlli su 15 classi · gate valuta · audit dati.

**Rimossi di recente e da NON reintrodurre senza misurare:**
- motore predittivo (verdetto, punteggi 0-100, classifica) — track record misurato: 7 segnali,
  −11% medio, −7,5pp vs Nasdaq, hit-rate 29%
- memoria storica e ciclo semiconduttori — mai girati con dati veri
- barra di stato e coda decisioni

## ✅ FATTO in v205: la rimodulazione grafica

Barra laterale con le macro-sezioni, centro con i grafici. La scheda **Struttura** è quella
d'ingresso (una sola volta, e mai sopra una preferenza già espressa).

Nessun grafico di prezzo, per la ragione concordata: i dati arrivano su cron e investing.com e
TradingView li fanno meglio in tempo reale. Ci sono i cinque grafici che **solo noi** possiamo
fare, perché solo noi conosciamo il libro:

1. **Concentrazione** — peso contro quota di varianza (MCR), barre affiancate, ordinate per
   rischio, con lo scarto in evidenza. Oggi: MU 26,0% del capitale → 39,9% del rischio (+13,9 pp).
2. **Mappa di correlazione** — heatmap di tutte le coppie. Oggi la più legata è AMD–MU a 0,66.
3. **Deriva della concentrazione** — MCR dei primi quattro nel tempo + linea Top-3.
4. **Allocazione** — settore / valuta, con l'esposizione al dollaro non coperta.
5. **Distanza dallo stop** — barre divergenti dallo zero, i violati a sinistra.

In cima, tre numeri grandi: rischio nei primi 3, massimo scarto, stop violati. Sono le voci che,
se cambiano, cambiano cosa puoi fare oggi.

Il payload è rimasto **identico al byte**: la vista legge, non scrive, e c'è un check che lo prova.

## Flusso d'uso previsto

Colpo d'occhio sulla struttura → copia il prompt → incolla in un LLM con accesso web la mattina o
all'apertura del cash → prosegue su TradingView.

## Le tre cose per cui il CEO usa Claude

1. **Struttura del libro** dopo un'operazione o quando serve
2. **Verifica** di ciò che sente su YouTube o legge su investing.com, prima di agire
3. **Script Pine**

## Da dove ripartire

- **La matrice di correlazione a 12 mesi arriva al primo run del CI.** Finché non arriva, la
  mappa la calcola in locale su 6 mesi e lo dichiara. Al prossimo run di `update-data.yml`
  verificare che l'avviso "Base a 6 mesi" sparisca da solo: se resta, `corr_matrix` non è
  finita in `data.json` e va capito perché.
- **Quattro grafici su cinque leggono numeri già nel payload, la deriva no.** Se serve, la
  deriva della concentrazione è l'unico contenuto della vista che l'LLM non riceve.
- **Il gate dei test era spento e ora non lo è più** (vedi CLAUDE.md, sezione v205): i check
  dopo il blocco `report` erano contati ma non facevano fallire la CI. Se in futuro si aggiunge
  un gruppo di check in fondo a `test_app.mjs`, il blocco `report` deve restare l'ultima cosa
  del file.

## Osservazione utile emersa dalle sue schermate

Sulla pagina titolo di investing.com convivono, adiacenti e con la stessa autorità,
**"Analisi tecnica: VENDI ADESSO"** e **"Previsioni: COMPRA ADESSO — target +83%"**. Nessuna riga
dichiara che sono metodologie diverse. È la stessa classe di difetto che i nostri detector C1/C4
intercettano: due letture della stessa cosa presentate come una sola. Vale la pena ricordarglielo
quando cita quei riquadri.
