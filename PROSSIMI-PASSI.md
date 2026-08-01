# Da dove ripartire — handoff del 01/08/2026

> Scritto alla fine di una sessione lunga, per non dover ricostruire il contesto.
> Leggi anche `CLAUDE.md`, che contiene le regole d'ingaggio e i difetti già vissuti.

## Come lavora davvero il CEO (accertato, non supposto)

- Guarda **investing.com più volte al giorno**: premarket, orario esteso, volumi, massimi/minimi.
  Quella è la sua dashboard vera, ed è migliore della nostra per il suo processo.
- Macro e notizie da **YouTube** (FX Evolution, Finvid, Bloomberg) — di cui si fida più dei nostri dati.
- **TradingView** quando ha tempo, con indicatori Pine.
- **Cambia posizione più volte al giorno oppure sta fermo per mesi.** Non c'è una cadenza:
  serve qualcosa di disponibile *quando decide*, non un report periodico.
- Ha guadagnato con questo metodo. Il sistema deve stargli **ai bordi**, non al centro.

## Stato del sistema (v204)

Funzionante e con tutti i gate verdi: 161 test JS · red team 32 campagne · pipeline 63 test ·
coerenza 18 controlli su 15 classi · gate valuta · audit dati.

**Rimossi di recente e da NON reintrodurre senza misurare:**
- motore predittivo (verdetto, punteggi 0-100, classifica) — track record misurato: 7 segnali,
  −11% medio, −7,5pp vs Nasdaq, hit-rate 29%
- memoria storica e ciclo semiconduttori — mai girati con dati veri (FRED irraggiungibile dallo
  sviluppo) e uno mostrava la serie sbagliata
- barra di stato e coda decisioni

## Il lavoro concordato: RIMODULAZIONE GRAFICA

Il problema non sono i dati, è che sono **mille numeri da leggere**. Obiettivo: impatto visivo
immediato.

**Struttura**: barra laterale con le macro-sezioni, centro con grafici.

⚠️ **Il vincolo che decide il progetto**: i dati si aggiornano su cron (GitHub Actions), non
tick-by-tick. Quindi **NON si disegnano grafici di prezzo** — investing.com e TradingView li fanno
meglio e in tempo reale. Si disegna ciò che **nessuno dei due può disegnare**, perché non conosce
il suo libro:

1. **Concentrazione**: peso NAV contro quota di varianza (MCR), a barre affiancate. Si vede in un
   secondo che MU pesa ~21% e genera ~40% del rischio.
2. **Mappa di correlazione** delle posizioni: dove il libro si muove insieme.
3. **Deriva della concentrazione** nel tempo, da `metrics_history`.
4. **Allocazione** per settore/valuta.
5. **Stop**: distanza di ogni posizione dal proprio stop ratchet.

Tutto il resto resta accessibile ma non in primo piano.

## Flusso d'uso previsto

Colpo d'occhio sulla struttura → copia il prompt → incolla in un LLM con accesso web la mattina o
all'apertura del cash → prosegue su TradingView.

## Le tre cose per cui il CEO usa Claude

1. **Struttura del libro** dopo un'operazione o quando serve
2. **Verifica** di ciò che sente su YouTube o legge su investing.com, prima di agire
3. **Script Pine**

## Osservazione utile emersa dalle sue schermate

Sulla pagina titolo di investing.com convivono, adiacenti e con la stessa autorità,
**"Analisi tecnica: VENDI ADESSO"** e **"Previsioni: COMPRA ADESSO — target +83%"**. Nessuna riga
dichiara che sono metodologie diverse. È la stessa classe di difetto che i nostri detector C1/C4
intercettano: due letture della stessa cosa presentate come una sola. Vale la pena ricordarglielo
quando cita quei riquadri.
