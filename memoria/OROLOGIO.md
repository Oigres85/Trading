# OROLOGIO — perché i dati non arrivavano all'ora dichiarata, e dove vive l'orario adesso

> Sintesi in una riga: **il cron di GitHub non è un orario, è una coda.** Misurato su 100 run,
> ogni esecuzione parte in ritardo di **99–263 minuti**, sempre, e il ritardo varia di 2,7 volte.
> Quindi l'orario è uscito da GitHub: lo scheduler chiama dall'esterno, e il run parte in
> **6 secondi**.

## 1. La misura, prima di qualunque proposta

Cento run schedulati fra l'01/09 e il 09/09/2026, letti dall'API di GitHub. L'aggancio
slot→run non è un'ipotesi: nei due giorni di **weekend** ci sono esattamente 11 slot e 11 run, e
qualunque altro accoppiamento produrrebbe un run **prima** del proprio slot, che è impossibile.

| cron (UTC) | ora italiana che doveva servire | ritardo misurato | ora reale |
|---|---|---|---|
| 04:00 | 06:00 | +245 / +263 min | ~10:10 |
| 08:00 | 10:00 | +219 / +238 min | ~13:40 |
| 13:30 | 15:30 | +159 / +171 min | ~18:10 |
| 15:00 | 17:00 | +122 / +146 min | ~19:05 |
| 19:00 | 21:00 | +108 / +116 min | ~22:50 |
| 21:00 | 22:00 |  +99 / +103 min | ~00:40 del giorno dopo |

**Nessuna delle sei ore richieste è mai stata servita.** Il file `update-data.yml` le dichiarava
in un commento: era un'etichetta che affermava più del dato, la classe che questo progetto paga
da versioni, qui dentro al nostro stesso repository.

⚠ **Il ritardo non si compensa spostando il cron indietro.** Varia da 99 a 263 minuti:
sottrarre una costante a una distribuzione sposta l'errore, non lo toglie. E non era un problema
di run **saltati** — la diagnosi che avevo dato ieri era sbagliata: i run partono quasi tutti
(11 su 11 nei weekend, 14-15 su 16 nei feriali), semplicemente **ore dopo**.

## 2. La misura che ha deciso il disegno

Lo stesso workflow, chiamato dall'esterno con `workflow_dispatch` il 09/09 alle 09:28:13 UTC:
**run creato alle 09:28:19**, cioè in ≤ 6 secondi, compresa la latenza della chiamata.

| canale | ritardo |
|---|---|
| `schedule` (cron di GitHub) | **99 – 263 minuti** |
| `workflow_dispatch` (chiamata esterna) | **≤ 6 secondi** |

Sono due code diverse dentro GitHub, e solo la prima è congestionata. Quindi non serve spostare
la *pipeline* fuori da GitHub: serve spostarne l'**orologio**. È anche l'unico pezzo che può
uscire oggi a costo zero e senza toccare una riga di codice — `workflow_dispatch` è già attivo.

## 3. La ricetta — cinque minuti, una volta sola

**a) Il permesso, il più stretto possibile.**
GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** →
*Generate new token*:
- **Repository access**: *Only select repositories* → `Oigres85/Trading` — e nessun altro
- **Permissions → Repository permissions → Actions**: *Read and write* — e nient'altro
- Scadenza: un anno (segnarsela; alla scadenza lo scheduler smette e i cron di rete restano)

Questo permesso consente **solo** di far partire un workflow. Non consente di leggere i secret,
non consente di scrivere codice. ⚠ Il token non va mai incollato nel repository né in chat: vive
solo dentro lo scheduler.

**b) Lo scheduler: [cron-job.org](https://cron-job.org)** — gratuito, senza carta, risoluzione al
minuto, e soprattutto con **fuso orario Europe/Rome nativo**: imposta l'ora italiana e l'ora
legale la gestisce lui, quindi sparisce il doppione CEST/CET che oggi raddoppia ogni riga.

Un job per ciascuna delle sei ore (06:00 · 10:00 · 15:30 · 17:00 · 21:00 · 22:00), tutti uguali:

```
URL     POST  https://api.github.com/repos/Oigres85/Trading/actions/workflows/update-data.yml/dispatches
Headers Accept: application/vnd.github+json
        Authorization: Bearer IL_TUO_TOKEN
        X-GitHub-Api-Version: 2022-11-28
        Content-Type: application/json
Body    {"ref":"main"}
Fuso    Europe/Rome
```

Risposta attesa: **204 No Content**. Un 404 quasi sempre significa permesso mancante, non URL
sbagliato — GitHub risponde 404 anche quando la risorsa esiste ma il token non la può vedere.

⚠ **Accendere la notifica di fallimento del job** (*Notify me when… the job fails*). Senza, il
giorno che il token scade o GitHub rifiuta, lo scheduler **muore in silenzio** e i dati tornano
in ritardo senza che nessuno lo sappia: è esattamente il guasto della v433, dove l'allarme della
pipeline non poteva suonare perché mancava un'etichetta. Un orologio che si ferma deve dirlo.

⚠ **Il fuso vive DENTRO il singolo job** (`schedule.timezone`), non solo nelle impostazioni
dell'account — verificato sullo schema pubblicato dell'API. Impostarlo sul job è la forma robusta:
se un domani si tocca l'account, i sei job restano ancorati a Europe/Rome per conto proprio.

**b-bis) La stessa cosa in dieci secondi, se si preferisce l'API alla UI.** Console → Settings →
**API** → genera una chiave, poi un `PUT https://api.cron-job.org/jobs` per ciascuna delle sei ore
con `Authorization: Bearer <chiave>` e il corpo `{"job": {…}}` — schema in
<https://docs.cron-job.org/rest-api.html>, `requestMethod: 1` è POST. Il limite dichiarato è
**5 richieste al secondo**. ⚠ La chiave API è un segreto quanto la password: dà accesso all'intero
account, non al solo job.

**c) Alternative, con il loro difetto scritto accanto** (nessuna è meglio, sono ripieghi):
- *Cloudflare Workers Cron* — gratis e affidabile, ma il cron è **in UTC**: l'ora legale torna a
  mano, cioè torna il problema che stiamo togliendo.
- *Il Mac di casa* (`launchd`) — nessun terzo e nessun token in giro, ma aggiorna **solo quando
  il Mac è acceso**: alle 06:00 non lo è.
- *Nessuno scheduler, la pagina si aggiorna da sola quando la apri* — a costo zero e senza
  token nuovi, ma non copre l'unico caso che conta davvero, cioè trovare i dati **già pronti**.

## 4. Come si verifica che funzioni — misurando, non fidandosi

Dopo tre giorni, questo comando dice l'ora vera di ogni run e da quale canale è partito:

```bash
gh run list --workflow=update-data.yml --limit 60 \
  --json createdAt,event --jq '.[] | "\(.createdAt)  \(.event)"'
```

I run `workflow_dispatch` devono cadere **al minuto** delle sei ore italiane. Se ci cadono per
una settimana, allora — e solo allora — si potano i 12 cron di rete lasciandone due o tre.
⚠ **Non si cambiano le due cose insieme**: se si toglie il cron mentre si accende lo scheduler
esterno, e i dati smettono di arrivare, non si sa quale delle due sia stata.

## 5. «Uscire totalmente da GitHub» — il costo, misurato

L'orologio esce oggi. Il **resto** del sistema è GitHub in modo molto più profondo di quanto si
veda dalla pagina, e vale la pena avere il conto davanti prima di decidere:

| pezzo | cosa dipende da GitHub | cosa costerebbe uscire |
|---|---|---|
| la pagina viva | GitHub Pages serve `main` | spostare l'hosting (Netlify, Cloudflare Pages) — fattibile |
| lettura dei dati | 7 chiamate a `raw.githubusercontent` | segue l'hosting |
| **la persistenza** | **8 file di `config/` scritti dal browser con la Contents API** — diario, override macro, testata del prompt, ordine sezioni, parametri di rischio, posizioni, watchlist, stato patrimoniale | **è il "backend" del progetto: uscire vuol dire riscriverlo** |
| la pipeline | Actions esegue `update_data.py` 16 volte al giorno | serve una macchina accesa, ~90 secondi a run |
| gli allarmi | GitHub Issue è il canale unico | serve un canale nuovo |

Le prime due righe sono un trasloco. La terza è una **riscrittura**, ed è la parte che il
congelamento vieta: *meglio un sistema stabile ridotto che ampio ma da cui emergono
costantemente bug*.

> La conclusione onesta è che «uscire da GitHub» e «avere i dati all'ora giusta» sembravano la
> stessa cosa e non lo sono. Rotto era l'orologio, e l'orologio esce **gratis, oggi, senza
> toccare il codice**. Il resto non è rotto: costa, e non risolverebbe niente che non sia già
> risolto qui sopra.
